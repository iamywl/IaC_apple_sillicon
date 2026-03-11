# 06. Infrastructure as Code — Bash 스크립트와 Terraform

> 시리즈: Apple Silicon Mac 위에 프로덕션급 멀티 클러스터 쿠버네티스 구축하기 (6/6)

---

## 들어가며

지금까지 VM 생성, 쿠버네티스 초기화, 네트워킹, 모니터링을 다뤘습니다. 각 단계마다 수십 개의 명령어가 필요합니다. 이것을 매번 손으로 치겠습니까?

"아, 그거 지난번에 어떻게 설치했더라?"

이런 상황은 **반드시** 옵니다. 그리고 기억에 의존하는 순간 사고가 납니다.

Infrastructure as Code(IaC)는 이런 문제를 해결합니다. **인프라를 코드로 정의하면, 코드를 실행하는 것만으로 동일한 인프라를 반복적으로 만들 수 있습니다.** 이번 글에서는 우리 프로젝트의 두 가지 IaC 접근법 -- Bash 스크립트와 Terraform -- 을 비교하며 살펴보겠습니다.

---

## IaC란? — "코드로 인프라를"

### 비유: 레시피 vs 요리사의 감

요리사가 두 명 있습니다.

- **요리사 A**: "소금은 이 정도? 불은 이 정도?" (감으로 요리)
- **요리사 B**: "소금 5g, 중불 3분, 물 200ml" (레시피대로 요리)

요리사 A가 휴가를 가면? 아무도 그 맛을 재현하지 못합니다. 요리사 B의 레시피가 있으면? **누구나 같은 요리**를 만들 수 있습니다.

IaC는 **인프라의 레시피**입니다.

### 왜 이게 필요한가?

수동으로 인프라를 구축하면 생기는 문제들:

| 문제 | 설명 |
|------|------|
| **재현 불가** | "지난번엔 됐는데 왜 안 되지?" |
| **문서화 부재** | "그때 어떤 옵션을 줬더라?" |
| **환경 차이** | "내 PC에서는 되는데?" |
| **리뷰 불가** | 인프라 변경을 누가 검토하나? |
| **롤백 불가** | 문제가 생겼을 때 이전 상태로 되돌리기 어려움 |

코드로 정의하면:

```
인프라 변경 → Git에 커밋 → 코드 리뷰 → 승인 → 자동 적용
                              ↑
                          누가, 언제, 왜 바꿨는지 기록됨
```

---

## Imperative vs Declarative — 두 가지 접근

### 비유: 택시 vs 자율주행

**Imperative(명령형)** — 택시 기사에게 길을 알려주는 방식:
```
"직진하세요 → 사거리에서 좌회전 → 300m 가서 우회전 → 여기서 세워주세요"
```

**Declarative(선언형)** — 내비게이션에 목적지만 찍는 방식:
```
"강남역으로 가주세요"
```

명령형은 **"어떻게(How)"** 할지를 설명합니다. 선언형은 **"무엇을(What)"** 원하는지만 말합니다.

### 우리 프로젝트의 두 가지 접근

| | Bash 스크립트 | Terraform |
|-|-------------|-----------|
| 방식 | Imperative (명령형) | Declarative (선언형) |
| 정의 | "이 명령을 이 순서로 실행해" | "이런 상태가 되어야 해" |
| 위치 | `scripts/` | `terraform/` |
| 장점 | 직관적, 디버깅 쉬움 | 상태 관리, 변경 미리보기 |
| 단점 | 멱등성 직접 구현 필요 | 학습 곡선 |

---

## clusters.json — Single Source of Truth

### 왜 이게 필요한가?

4개 클러스터, 10개 VM, 각각의 CPU/메모리/IP 대역... 이 정보가 여러 파일에 흩어져 있으면 어떻게 될까요?

```
문제 상황:
- install-vms.sh에서는 platform-worker1의 메모리가 12GB
- install-cilium.sh에서는 platform-worker1의 메모리가 8GB  ← 불일치!
```

**Single Source of Truth(단일 진실의 원천)**는 "이 정보는 딱 한 곳에만 있다"는 원칙입니다.

### config/clusters.json

우리 프로젝트의 모든 인프라 정보는 이 한 파일에 정의됩니다:

```json
{
  "base_image": "ghcr.io/cirruslabs/ubuntu:latest",
  "ssh_user": "admin",
  "ssh_password": "admin",
  "clusters": [
    {
      "name": "platform",
      "pod_cidr": "10.10.0.0/16",
      "service_cidr": "10.96.0.0/16",
      "nodes": [
        { "name": "platform-master", "role": "master", "cpu": 2, "memory": 4096, "disk": 20 },
        { "name": "platform-worker1", "role": "worker", "cpu": 3, "memory": 12288, "disk": 20 },
        { "name": "platform-worker2", "role": "worker", "cpu": 2, "memory": 8192, "disk": 20 }
      ]
    },
    {
      "name": "dev",
      "pod_cidr": "10.20.0.0/16",
      "service_cidr": "10.97.0.0/16",
      "nodes": [
        { "name": "dev-master", "role": "master", "cpu": 2, "memory": 4096, "disk": 20 },
        { "name": "dev-worker1", "role": "worker", "cpu": 2, "memory": 8192, "disk": 20 }
      ]
    },
    {
      "name": "staging",
      "pod_cidr": "10.30.0.0/16",
      "service_cidr": "10.98.0.0/16",
      "nodes": [
        { "name": "staging-master", "role": "master", "cpu": 2, "memory": 4096, "disk": 20 },
        { "name": "staging-worker1", "role": "worker", "cpu": 2, "memory": 8192, "disk": 20 }
      ]
    },
    {
      "name": "prod",
      "pod_cidr": "10.40.0.0/16",
      "service_cidr": "10.99.0.0/16",
      "nodes": [
        { "name": "prod-master", "role": "master", "cpu": 2, "memory": 3072, "disk": 20 },
        { "name": "prod-worker1", "role": "worker", "cpu": 2, "memory": 8192, "disk": 20 },
        { "name": "prod-worker2", "role": "worker", "cpu": 2, "memory": 8192, "disk": 20 }
      ]
    }
  ]
}
```

이 파일 하나로:
- VM 이름, CPU, 메모리가 결정됩니다
- 각 클러스터의 Pod CIDR, Service CIDR이 결정됩니다
- SSH 접속 정보가 결정됩니다
- 기반 이미지가 결정됩니다

**클러스터를 하나 추가하고 싶다면?** 이 JSON에 항목 하나만 추가하면 됩니다. 나머지 모든 스크립트가 이 파일을 읽어서 동작합니다.

---

## Bash 스크립트 — 12단계 파이프라인

### install.sh 전체 흐름

`scripts/install.sh`는 전체 설치를 12개의 Phase(단계)로 나누어 실행합니다:

```
Phase 1:  VM 생성 (clone + 리소스 설정)
Phase 2:  노드 준비 (swap off, 커널 모듈, sysctl)
Phase 3:  컨테이너 런타임 설치 (containerd)
Phase 4:  kubeadm/kubelet/kubectl 설치
Phase 5:  클러스터 초기화 (kubeadm init + join)
Phase 6:  Cilium + Hubble 설치
Phase 7:  모니터링 스택 설치 (Prometheus, Grafana, Loki)
Phase 8:  CI/CD 설치 (ArgoCD, Jenkins)
Phase 9:  AlertManager + 알림 규칙
Phase 10: NetworkPolicy (Cilium 네트워크 정책)
Phase 11: metrics-server + HPA (오토스케일링)
Phase 12: Istio Service Mesh (dev 클러스터)
```

### 코드로 보기

```bash
#!/usr/bin/env bash
set -euo pipefail

# Phase 1: Create VMs
bash "$SCRIPT_DIR/install/01-create-vms.sh"

# Start all VMs
source "$SCRIPT_DIR/lib/vm.sh"
vm_start_all

# Wait for SSH on all nodes
source "$SCRIPT_DIR/lib/ssh.sh"
for cluster_name in $(get_cluster_names); do
  for node_name in $(get_nodes_for_cluster "$cluster_name"); do
    ip=$(vm_get_ip "$node_name")
    ssh_wait_ready "$ip"
  done
done

# Phase 2-4 (골든 이미지가 있으면 건너뛰기)
if [[ "$USE_GOLDEN" == true ]]; then
  log_section "Phase 2~4: Skipped (golden image)"
else
  bash "$SCRIPT_DIR/install/02-prepare-nodes.sh"
  bash "$SCRIPT_DIR/install/03-install-runtime.sh"
  bash "$SCRIPT_DIR/install/04-install-kubeadm.sh"
fi

# Phase 5-12
bash "$SCRIPT_DIR/install/05-init-clusters.sh"
bash "$SCRIPT_DIR/install/06-install-cilium.sh"
bash "$SCRIPT_DIR/install/07-install-monitoring.sh"
bash "$SCRIPT_DIR/install/08-install-cicd.sh"
bash "$SCRIPT_DIR/install/09-install-alerting.sh"
bash "$SCRIPT_DIR/install/10-install-network-policies.sh"
bash "$SCRIPT_DIR/install/11-install-hpa.sh"
bash "$SCRIPT_DIR/install/12-install-istio.sh"
```

### 왜 이게 필요한가? — 골든 이미지 최적화

주목할 부분은 Phase 2~4의 건너뛰기 로직입니다:

```bash
USE_GOLDEN=false
BASE_IMG="$(get_base_image)"
if [[ "$BASE_IMG" == "k8s-golden" ]]; then
  USE_GOLDEN=true
  log_info "Golden image detected -> Phase 2~4 will be skipped"
  log_info "Estimated time: 15-20 minutes"
else
  log_info "Estimated time: 45-60 minutes"
fi
```

골든 이미지는 Phase 2~4(노드 준비, containerd, kubeadm 설치)를 미리 해둔 이미지입니다. 설치 시간이 45분에서 15분으로 줄어듭니다.

---

## lib/ 디렉토리 패턴 — 코드 재사용의 핵심

### 비유: 레고 블록

레고로 집을 만들 때, 벽돌, 창문, 문 블록이 있으면 다양한 집을 만들 수 있습니다. `lib/` 디렉토리는 이 **레고 블록**입니다.

### 4개의 라이브러리 파일

```
scripts/lib/
  ├── common.sh   — 공통 유틸리티 (로그, 설정 읽기, 의존성 체크)
  ├── vm.sh       — VM 관리 (생성, 시작, 중지, 삭제, IP 조회)
  ├── ssh.sh      — SSH 연결 (원격 명령 실행, 파일 전송, 대기)
  └── k8s.sh      — 쿠버네티스 (노드 준비, containerd, kubeadm, Cilium)
```

### common.sh — 기초 블록

```bash
# 설정 파일에서 값을 읽는 함수
get_config() {
  jq -r "$1" "$CONFIG_FILE"     # jq로 JSON 파싱
}

# 클러스터 이름 목록 가져오기
get_cluster_names() {
  get_config '.clusters[].name'  # → platform, dev, staging, prod
}

# 특정 클러스터의 노드 목록 가져오기
get_nodes_for_cluster() {
  local cluster_name="$1"
  get_config ".clusters[] | select(.name==\"$cluster_name\") | .nodes[].name"
}

# 클러스터별 Pod CIDR 가져오기
get_pod_cidr() {
  local cluster_name="$1"
  get_config ".clusters[] | select(.name==\"$cluster_name\") | .pod_cidr"
}
```

모든 함수가 `clusters.json`에서 데이터를 읽습니다. 이것이 Single Source of Truth의 핵심입니다.

### vm.sh — VM 관리 블록

```bash
# VM 복제 (이미 있으면 건너뛰기 = 멱등성!)
vm_clone() {
  local vm_name="$1"
  if vm_exists "$vm_name"; then
    log_warn "VM '$vm_name' already exists, skipping clone."
    return 0                    # ← 이미 있으면 아무것도 안 함
  fi
  tart clone "$base_image" "$vm_name"
}

# 모든 VM 생성 (clusters.json을 순회)
vm_create_all() {
  for cluster_name in $(get_cluster_names); do
    for node_name in $(get_nodes_for_cluster "$cluster_name"); do
      local cpu memory
      cpu=$(get_node_cpu "$cluster_name" "$node_name")
      memory=$(get_node_memory "$cluster_name" "$node_name")
      vm_clone "$node_name"
      vm_set_resources "$node_name" "$cpu" "$memory"
    done
  done
}
```

### ssh.sh — SSH 연결 블록

```bash
# 원격 명령 실행 (sudo)
ssh_exec_sudo() {
  local ip="$1"
  shift
  sshpass -p "$password" ssh $SSH_OPTS "${user}@${ip}" sudo bash -s <<EOF
$*
EOF
}

# SSH가 준비될 때까지 대기 (최대 40번 시도, 3초 간격)
ssh_wait_ready() {
  local ip="$1"
  for ((i=1; i<=max_attempts; i++)); do
    if ssh_exec "$ip" "echo ok" &>/dev/null; then
      return 0
    fi
    sleep 3
  done
  die "Timeout waiting for SSH on $ip"
}
```

### k8s.sh — 쿠버네티스 블록

이 파일이 가장 복잡하고 핵심적입니다. 다른 3개 라이브러리를 모두 사용합니다:

```bash
source "$(dirname ...)/common.sh"    # 설정 읽기
source "$(dirname ...)/vm.sh"        # VM IP 조회
source "$(dirname ...)/ssh.sh"       # 원격 명령 실행
```

그리고 클러스터 초기화, Cilium 설치 등 고수준 함수를 제공합니다. 의존 관계를 그리면:

```
common.sh    ← 모든 라이브러리의 기반
    ↑
  vm.sh      ← common.sh에 의존
    ↑
  ssh.sh     ← common.sh에 의존
    ↑
  k8s.sh     ← common.sh + vm.sh + ssh.sh 모두에 의존
```

---

## Terraform — 선언형 인프라

### Terraform이란?

HashiCorp가 만든 IaC 도구입니다. **"이런 인프라가 존재해야 한다"** 라고 선언하면, Terraform이 현재 상태와 비교해서 필요한 변경만 수행합니다.

### 비유: 내비게이션

```
당신: "서울에서 부산까지 가고 싶어"
내비: "현재 대전에 있으시네요. 대전→부산 경로를 안내합니다"
     (서울→대전 구간은 이미 지나갔으므로 안내하지 않음)
```

Terraform도 마찬가지입니다:

```
당신: "VM 10개와 클러스터 4개가 있어야 해"
Terraform: "현재 VM 8개가 있네요. 2개만 더 만들겠습니다"
          (이미 있는 8개는 건드리지 않음)
```

### plan, apply, destroy — 3가지 핵심 명령

```bash
# 1. plan: "이렇게 바뀔 예정입니다" 미리보기
terraform plan

# 출력 예시:
# + null_resource.vm_clone["dev-worker2"]    ← 새로 만들 것
# ~ null_resource.vm_clone["dev-worker1"]    ← 변경할 것
#   null_resource.vm_clone["dev-master"]     ← 변경 없음
#
# Plan: 1 to add, 1 to change, 0 to destroy.

# 2. apply: 실제로 적용
terraform apply

# 3. destroy: 전부 삭제
terraform destroy
```

`plan`이 특히 중요합니다. 실제로 변경을 가하기 전에 **무엇이 바뀔지 미리 볼 수 있습니다**. Bash 스크립트에는 없는 기능입니다.

---

## terraform/main.tf — 전체 구조

우리 프로젝트의 Terraform은 4단계로 구성됩니다:

```hcl
# Phase 1: VM Lifecycle
module "vms" {
  source = "./modules/tart-vm"

  base_image   = var.base_image
  clusters     = var.clusters
  project_root = var.project_root
}

# Phase 2: K8s Cluster Setup
module "k8s" {
  source = "./modules/k8s-cluster"

  depends_on = [module.vms]         # ← VM이 먼저 만들어져야 함

  clusters       = var.clusters
  vm_ips         = module.vms.vm_ips
  project_root   = var.project_root
  ssh_user       = var.ssh_user
  ssh_password   = var.ssh_password
  kubeconfig_dir = local.kubeconfig_dir
}

# Phase 3: Helm Releases (platform cluster)
module "helm" {
  source = "./modules/helm-releases"

  depends_on = [module.k8s]         # ← 클러스터가 먼저 준비되어야 함

  clusters       = var.clusters
  vm_ips         = module.vms.vm_ips
  project_root   = var.project_root
  kubeconfig_dir = local.kubeconfig_dir
}
```

`depends_on`이 실행 순서를 보장합니다. Bash에서는 스크립트를 순서대로 나열해야 했지만, Terraform에서는 **의존성을 선언**하면 순서를 자동으로 결정합니다.

---

## terraform/modules/ — 모듈화

### 비유: 부서별 업무 분장

회사에서:
- 총무부: 사무실 관리 (= tart-vm 모듈: VM 관리)
- IT부: 시스템 설정 (= k8s-cluster 모듈: 쿠버네티스 설정)
- 운영부: 서비스 배포 (= helm-releases 모듈: 앱 설치)

```
terraform/modules/
  ├── tart-vm/           # VM 생성, 시작, IP 할당
  │   ├── main.tf
  │   ├── variables.tf
  │   └── outputs.tf
  ├── k8s-cluster/       # 노드 준비, kubeadm init, Cilium
  │   ├── main.tf
  │   ├── variables.tf
  │   └── outputs.tf
  └── helm-releases/     # Prometheus, Grafana, ArgoCD 등
      ├── main.tf
      ├── variables.tf
      └── outputs.tf
```

### tart-vm 모듈 살펴보기

```hcl
# 모든 노드를 평탄화(flatten)하여 맵으로 변환
locals {
  all_nodes = flatten([
    for cluster in var.clusters : [
      for node in cluster.nodes : {
        cluster_name = cluster.name
        node_name    = node.name
        role         = node.role
        cpu          = node.cpu
        memory       = node.memory
      }
    ]
  ])

  node_map = { for n in local.all_nodes : n.node_name => n }
}

# VM 복제 — for_each로 모든 노드에 대해 수행
resource "null_resource" "vm_clone" {
  for_each = local.node_map

  provisioner "local-exec" {
    command = <<-EOT
      if ! tart list | grep -q "local.*${each.key}"; then
        tart clone "${var.base_image}" "${each.key}"
      fi
      tart set "${each.key}" --cpu ${each.value.cpu} --memory ${each.value.memory}
    EOT
  }

  # destroy 시 VM 삭제
  provisioner "local-exec" {
    when    = destroy
    command = <<-EOT
      tart stop "${self.triggers.vm_name}" 2>/dev/null || true
      sleep 2
      tart delete "${self.triggers.vm_name}"
    EOT
  }
}
```

주목할 점:

1. **`for_each`**: clusters.json의 모든 노드에 대해 자동으로 반복합니다. 노드가 10개면 10번, 20개면 20번.
2. **`when = destroy`**: `terraform destroy` 시 VM을 자동으로 정리합니다. Bash에서는 별도의 shutdown 스크립트가 필요했지만, Terraform은 생성과 삭제가 한 곳에 정의됩니다.

### helm-releases 모듈

```hcl
resource "helm_release" "kube_prometheus_stack" {
  name       = "kube-prometheus-stack"
  repository = "https://prometheus-community.github.io/helm-charts"
  chart      = "kube-prometheus-stack"
  namespace  = "monitoring"

  create_namespace = true
  wait             = true
  timeout          = 600

  values = [file("${var.project_root}/manifests/monitoring-values.yaml")]
}

resource "helm_release" "loki" {
  depends_on = [helm_release.kube_prometheus_stack]

  name       = "loki"
  repository = "https://grafana.github.io/helm-charts"
  chart      = "loki-stack"
  namespace  = "monitoring"

  values = [file("${var.project_root}/manifests/loki-values.yaml")]
}
```

Terraform의 `helm_release` 리소스는 `helm upgrade --install`과 동일한 효과입니다. 하지만 상태를 추적하므로, 다음에 `terraform apply`를 하면 변경된 부분만 업데이트합니다.

---

## Bash vs Terraform — 어느 것을 언제 쓸까?

### 왜 이게 필요한가?

"그냥 Terraform만 쓰면 되지 않나?"라고 생각할 수 있습니다. 하지만 현실은 더 복잡합니다.

| 상황 | 더 나은 선택 | 이유 |
|------|-------------|------|
| 빠르게 프로토타이핑 | Bash | 바로 실행, 디버깅이 직관적 |
| 복잡한 프로비저닝 로직 | Bash | 조건문, 루프가 자연스러움 |
| 인프라 상태 관리 | Terraform | 현재 상태와 원하는 상태를 비교 |
| 변경 미리보기 | Terraform | `terraform plan`으로 확인 |
| 팀 협업 | Terraform | 상태 파일로 공유, 코드 리뷰 용이 |
| 자동 정리(삭제) | Terraform | `destroy`로 한 번에 정리 |

우리 프로젝트는 **두 가지 모두 제공**합니다. 이것은 의도된 설계입니다:

- 학습 단계에서는 Bash 스크립트로 각 단계를 이해합니다
- 운영 단계에서는 Terraform으로 상태를 관리합니다
- Terraform 모듈이 내부적으로 Bash 라이브러리 함수를 재사용합니다

---

## Bash와 Terraform의 대응 관계

Terraform 모듈이 Bash 스크립트를 어떻게 미러링하는지 살펴보겠습니다:

```
Bash 스크립트                          Terraform 모듈
─────────────                         ──────────────
scripts/install/01-create-vms.sh  →   terraform/modules/tart-vm/
scripts/install/02-prepare-nodes.sh   terraform/modules/k8s-cluster/
scripts/install/03-install-runtime.sh     (prepare_node, install_containerd,
scripts/install/04-install-kubeadm.sh      install_kubeadm, init_cluster,
scripts/install/05-init-clusters.sh        install_cilium을 순차 실행)
scripts/install/06-install-cilium.sh
scripts/install/07-install-monitoring.sh → terraform/modules/helm-releases/
scripts/install/08-install-cicd.sh            (helm_release 리소스로 정의)
scripts/install/09-install-alerting.sh
```

핵심 차이: Terraform의 k8s-cluster 모듈은 Bash 라이브러리 함수를 직접 호출합니다:

```hcl
provisioner "local-exec" {
    command = <<-EOT
      source "${var.project_root}/scripts/lib/k8s.sh"
      prepare_node "${each.key}"
    EOT
    interpreter = ["bash", "-c"]
  }
```

**코드 중복 없이** Bash의 검증된 로직을 Terraform에서 재사용하는 패턴입니다.

---

## 멱등성 (Idempotency)

### 비유: 엘리베이터 버튼

엘리베이터의 "5층" 버튼을 한 번 누르든 열 번 누르든, 결과는 같습니다. 5층에 갑니다. 이것이 **멱등성**입니다.

### 왜 이게 필요한가?

인프라 스크립트를 실행하다가 Phase 7에서 에러가 났습니다. 고친 후 처음부터 다시 실행합니다. Phase 1~6이 이미 완료된 상태인데... **다시 실행해도 괜찮을까?**

멱등성이 보장되면 괜찮습니다. 이미 존재하는 것은 건너뛰고, 없는 것만 생성합니다.

### Bash에서의 멱등성

```bash
# vm.sh — 이미 존재하면 건너뛰기
vm_clone() {
  if vm_exists "$vm_name"; then
    log_warn "VM '$vm_name' already exists, skipping clone."
    return 0          # ← 에러가 아니라 정상 종료
  fi
  tart clone "$base_image" "$vm_name"
}

# k8s.sh — 초기화 전에 기존 상태 정리
init_cluster() {
  ssh_exec_sudo "$master_ip" "
    kubeadm reset -f 2>/dev/null || true    # 기존 상태 초기화
    rm -rf /etc/kubernetes /var/lib/kubelet  # 잔여 파일 삭제
  "
  # 이후 kubeadm init 실행
}
```

두 가지 전략이 보입니다:
1. **존재 확인 후 건너뛰기** (`vm_clone`): 이미 있으면 아무것도 안 함
2. **완전 초기화 후 재생성** (`init_cluster`): 기존 상태를 깨끗이 지우고 다시 만듬

### Terraform에서의 멱등성

Terraform은 **상태 파일(terraform.tfstate)**을 사용하여 멱등성을 자동으로 보장합니다:

```
첫 번째 apply:
  현재 상태: 비어있음
  원하는 상태: VM 10개
  → 10개 생성

두 번째 apply:
  현재 상태: VM 10개 (상태 파일에 기록됨)
  원하는 상태: VM 10개
  → 변경 없음 (No changes. Infrastructure is up-to-date.)

세 번째 apply (clusters.json에 노드 추가 후):
  현재 상태: VM 10개
  원하는 상태: VM 12개
  → 2개만 추가 생성
```

---

## 실제 프로젝트에서는

### 대규모 인프라에서의 IaC

우리 프로젝트는 10개 VM을 관리합니다. 실제 기업에서는:

- **수백~수천 대의 서버**를 Terraform으로 관리
- **Terraform Cloud** 또는 **Atlantis**로 팀 협업
- **상태 파일을 S3 같은 원격 저장소**에 보관 (로컬에 두면 다른 팀원과 공유 불가)
- **GitOps 워크플로**: Git에 Terraform 코드를 커밋하면 CI/CD 파이프라인이 자동으로 `terraform plan` → 리뷰 → `terraform apply`

### Bash 스크립트의 현실적 가치

Terraform이 대세이지만 Bash가 사라진 것은 아닙니다:

- **부트스트래핑**: Terraform 자체를 설치하는 것은 Bash로 합니다
- **헬퍼 스크립트**: `boot.sh`, `shutdown.sh` 같은 운영 스크립트
- **디버깅**: 문제가 발생했을 때 수동으로 한 단계씩 실행
- **CI/CD 파이프라인**: GitHub Actions, Jenkins 등에서 Bash는 기본 도구

### 다른 IaC 도구들

| 도구 | 특징 |
|------|------|
| **Terraform** | 클라우드 중립적, 가장 넓은 생태계 |
| **Pulumi** | 일반 프로그래밍 언어(Python, Go 등)로 인프라 정의 |
| **Ansible** | 서버 설정 관리에 강점 (SSH 기반) |
| **CloudFormation** | AWS 전용 |
| **Crossplane** | 쿠버네티스 위에서 인프라를 관리 |

---

## 전체 아키텍처 요약

```
config/clusters.json                    ← Single Source of Truth
         │
         ├──→ scripts/lib/common.sh     ← JSON 파싱, 유틸리티
         │         │
         │         ├── vm.sh            ← VM 관리 함수
         │         ├── ssh.sh           ← SSH 연결 함수
         │         └── k8s.sh           ← 쿠버네티스 함수
         │              │
         │              ▼
         │    scripts/install.sh        ← 12단계 파이프라인 (Bash 방식)
         │    scripts/install/01~12     ← 각 단계별 스크립트
         │
         └──→ terraform/main.tf         ← 모듈 오케스트레이션 (Terraform 방식)
              terraform/modules/
                ├── tart-vm/            ← VM 생성/삭제
                ├── k8s-cluster/        ← 클러스터 설정 (lib/ 함수 재사용)
                └── helm-releases/      ← 앱 배포
```

---

## 정리

| 개념 | 한 줄 설명 |
|------|-----------|
| IaC | 인프라를 코드로 정의하고 버전 관리하는 방법론 |
| Imperative | "이 단계를 이 순서로 실행해" (Bash) |
| Declarative | "이런 상태가 되어야 해" (Terraform) |
| Single Source of Truth | 모든 설정 정보가 한 곳(clusters.json)에 존재 |
| 멱등성 | 같은 작업을 여러 번 실행해도 결과가 동일 |
| terraform plan | 변경 사항을 미리 확인하는 명령 |
| terraform apply | 실제로 인프라를 변경하는 명령 |
| terraform destroy | 인프라를 삭제하는 명령 |
| Module | Terraform 코드를 재사용 가능한 단위로 분리 |

### 관련 파일

| 파일 | 역할 |
|------|------|
| `config/clusters.json` | 전체 인프라의 Single Source of Truth |
| `scripts/install.sh` | 12단계 설치 파이프라인 (메인 스크립트) |
| `scripts/lib/common.sh` | 공통 유틸리티 (로그, 설정 파싱) |
| `scripts/lib/vm.sh` | VM 관리 함수 라이브러리 |
| `scripts/lib/ssh.sh` | SSH 연결 함수 라이브러리 |
| `scripts/lib/k8s.sh` | 쿠버네티스 관리 함수 라이브러리 |
| `terraform/main.tf` | Terraform 메인 설정 (모듈 오케스트레이션) |
| `terraform/modules/tart-vm/` | VM 생성/삭제 모듈 |
| `terraform/modules/k8s-cluster/` | 클러스터 설정 모듈 |
| `terraform/modules/helm-releases/` | Helm 차트 배포 모듈 |

---

이것으로 시리즈를 마칩니다. 우리는 Apple Silicon Mac 한 대 위에서 프로덕션급 멀티 클러스터 쿠버네티스 인프라를 구축하는 전체 과정을 살펴보았습니다. VM 생성부터 네트워킹, 모니터링, 그리고 이 모든 것을 자동화하는 IaC까지. 이 프로젝트의 모든 코드는 실제로 동작하며, 누구나 `./scripts/install.sh` 한 줄로 전체 인프라를 재현할 수 있습니다.
