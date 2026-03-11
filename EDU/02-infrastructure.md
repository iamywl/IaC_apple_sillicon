# 02. 인프라 계층 - Tart VM + Terraform

## Tart란?

Tart는 Apple Silicon macOS에서 ARM64 가상머신을 실행하는 도구입니다.
Apple의 Hypervisor.framework를 사용하므로 네이티브 성능에 가깝습니다.

## VM 관리 코드: scripts/lib/vm.sh

이 파일이 모든 VM 생명주기를 관리합니다.

### 핵심 함수들

```bash
# VM 복제 - 베이스 이미지에서 새 VM 생성
vm_clone() {
    local name=$1
    tart clone "$BASE_IMAGE" "$name"
}

# 리소스 설정 - CPU, 메모리 할당
vm_set_resources() {
    local name=$1 cpu=$2 memory=$3
    tart set "$name" --cpu "$cpu" --memory "$memory"
}

# VM 시작 - softnet 네트워킹으로 실행
vm_start() {
    local name=$1
    tart run "$name" --net-softnet-allow=0.0.0.0/0 --no-display &
}

# IP 대기 - DHCP로 IP가 할당될 때까지 폴링
vm_wait_for_ip() {
    local name=$1
    for i in $(seq 1 60); do
        ip=$(tart ip "$name" 2>/dev/null)
        if [[ -n "$ip" ]]; then
            echo "$ip"
            return 0
        fi
        sleep 3
    done
}
```

### 배치 작업 함수

```bash
# clusters.json에서 모든 노드를 읽어서 VM 생성
vm_create_all() {
    for node in $(get_all_nodes); do
        local cpu=$(get_node_cpu "$node")
        local memory=$(get_node_memory "$node")
        vm_clone "$node"
        vm_set_resources "$node" "$cpu" "$memory"
    done
}

# 모든 VM 시작
vm_start_all()  # → 각 VM에 vm_start() 호출
vm_stop_all()   # → tart stop으로 안전 종료
vm_delete_all() # → tart delete로 완전 삭제
```

### 코드 수정 포인트

| 하고 싶은 것 | 수정할 곳 |
|-------------|----------|
| VM 리소스 변경 | `config/clusters.json`의 cpu, memory 값 |
| 새 VM 추가 | `config/clusters.json`에 노드 항목 추가 |
| 네트워크 설정 변경 | `vm_start()` 함수의 `--net-softnet-allow` 옵션 |
| IP 대기 시간 변경 | `vm_wait_for_ip()`의 `seq 1 60`과 `sleep 3` |

## SSH 실행 계층: scripts/lib/ssh.sh

VM 안에서 명령을 실행할 때 SSH를 사용합니다.

### 핵심 함수들

```bash
# 기본 SSH 실행
ssh_exec() {
    local ip=$1 cmd=$2
    sshpass -p "$SSH_PASSWORD" ssh \
        -o StrictHostKeyChecking=no \
        -o ConnectTimeout=10 \
        "$SSH_USER@$ip" "$cmd"
}

# sudo 권한으로 실행 (설치 작업에 사용)
ssh_exec_sudo() {
    local ip=$1 cmd=$2
    # 스크립트를 stdin으로 전달하여 sudo 실행
    echo "$cmd" | sshpass -p "$SSH_PASSWORD" ssh ... "sudo bash -s"
}

# 파일 전송
scp_to()   # 호스트 → VM으로 파일 복사
scp_from() # VM → 호스트로 파일 복사

# SSH 준비 대기 (부팅 후 SSH 서비스가 뜰 때까지)
ssh_wait_ready() {
    for i in $(seq 1 40); do
        ssh_exec "$ip" "echo ok" && return 0
        sleep 3
    done
}
```

## 설정 파싱: scripts/lib/common.sh

`clusters.json`을 jq로 파싱하여 다른 스크립트에 제공합니다.

### 핵심 함수들

```bash
# 전체 클러스터 이름 목록
get_clusters()      # → "platform dev staging prod"

# 특정 클러스터의 노드 목록
get_nodes()         # → "platform-master platform-worker1 platform-worker2"

# 노드별 정보 조회
get_node_cpu()      # → 2
get_node_memory()   # → 4096
get_node_role()     # → "master" 또는 "worker"
get_node_ip()       # → tart ip 명령으로 현재 IP 조회

# 클러스터별 네트워크 정보
get_pod_cidr()      # → "10.10.0.0/16"
get_service_cidr()  # → "10.96.0.0/16"

# 로깅 헬퍼
log_info()          # 파란색 [INFO] 출력
log_success()       # 초록색 [OK] 출력
log_error()         # 빨간색 [ERROR] 출력
log_phase()         # 단계 번호와 제목 출력
```

## Terraform 인프라

Terraform은 Bash 스크립트와 동일한 작업을 선언적으로 수행합니다.

### 모듈 구조

```
terraform/main.tf
  ├── module "vms"   → tart-vm 모듈 (VM 생성/시작)
  ├── module "k8s"   → k8s-cluster 모듈 (kubeadm 초기화)
  └── module "helm"  → helm-releases 모듈 (Helm 차트 배포)
```

### tart-vm 모듈 (terraform/modules/tart-vm/main.tf)

```hcl
# 각 노드마다 실행
resource "null_resource" "vm_clone" {
  for_each = var.nodes

  provisioner "local-exec" {
    command = "tart clone ${var.base_image} ${each.key}"
  }
  provisioner "local-exec" {
    command = "tart set ${each.key} --cpu ${each.value.cpu} --memory ${each.value.memory}"
  }

  # 삭제 시 정리
  provisioner "local-exec" {
    when    = destroy
    command = "tart stop ${each.key}; tart delete ${each.key}"
  }
}
```

### k8s-cluster 모듈 (terraform/modules/k8s-cluster/main.tf)

SSH로 각 노드에 접속하여 kubeadm 설치를 수행합니다.
`local-exec` provisioner 안에서 Bash 스크립트를 실행합니다.

### helm-releases 모듈 (terraform/modules/helm-releases/main.tf)

Terraform Helm provider를 사용하여 차트를 배포합니다.

```hcl
resource "helm_release" "prometheus" {
  name       = "prometheus"
  repository = "https://prometheus-community.github.io/helm-charts"
  chart      = "kube-prometheus-stack"
  namespace  = "monitoring"
  values     = [file("${path.root}/../manifests/monitoring-values.yaml")]
}
```

### Bash vs Terraform

| 항목 | Bash (scripts/) | Terraform (terraform/) |
|------|-----------------|----------------------|
| 실행 방식 | `./scripts/install.sh` | `terraform apply` |
| 장점 | 조건 분기, 대화형 디버깅 | 상태 관리, 멱등성, 의존성 그래프 |
| 단점 | 상태 추적 없음 | 복잡한 쉘 로직 표현 어려움 |
| 용도 | 빠른 개발/디버깅 | 재현 가능한 인프라 배포 |

둘 다 같은 인프라를 만듭니다. 필요에 따라 선택하세요.
