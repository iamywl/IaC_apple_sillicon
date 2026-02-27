# IaC와 자동화 파이프라인 설계

## 1. Infrastructure as Code 개요

이 프로젝트는 **동일한 인프라를 두 가지 방식으로 관리**한다:

| 방식 | 도구 | 장점 | 단점 |
|------|------|------|------|
| 명령형(Imperative) | Bash 스크립트 | 빠른 프로토타이핑, 디버깅 용이 | 상태 추적 불가, 멱등성 수동 보장 |
| 선언형(Declarative) | Terraform | 상태 관리, 변경 계획 미리보기 | 학습 곡선, Tart CLI 래핑 필요 |

### 핵심 원칙

```
명령형: "이 순서대로 실행해라" (How)
  → tart clone ubuntu prod-master
  → tart set prod-master --cpu 2 --memory 3072
  → tart run prod-master --no-graphics &

선언형: "이 상태가 되어야 한다" (What)
  → resource "null_resource" "vm_clone" {
      provisioner "local-exec" { ... }
    }
```

---

## 2. Bash 스크립트 설계

### 2.1 실행 흐름

```
install.sh (진입점)
    │
    ├── source lib/common.sh     ← 설정 파싱, 로깅
    ├── check_dependencies       ← brew 패키지 확인
    │
    ├── Phase 1:  01-create-vms.sh      ← tart clone + set
    ├── (inline)  vm_start_all          ← tart run (백그라운드)
    ├── (inline)  ssh_wait_ready        ← SSH 연결 대기
    │
    ├── Phase 2:  02-prepare-nodes.sh   ← swap off, sysctl
    ├── Phase 3:  03-install-runtime.sh ← containerd
    ├── Phase 4:  04-install-kubeadm.sh ← kubelet, kubeadm, kubectl
    │
    ├── Phase 5:  05-init-clusters.sh   ← kubeadm init + join
    ├── Phase 6:  06-install-cilium.sh  ← helm install cilium
    │
    ├── Phase 7:  07-install-monitoring.sh  ← Prometheus + Grafana
    ├── Phase 8:  08-install-cicd.sh        ← Jenkins + ArgoCD
    ├── Phase 9:  09-install-alerting.sh    ← AlertManager
    ├── Phase 10: 10-install-network-policies.sh
    ├── Phase 11: 11-install-hpa.sh         ← metrics-server + HPA
    └── Phase 12: 12-install-istio.sh       ← Istio Service Mesh
```

### 2.2 함수 라이브러리 설계

```
common.sh
├── 설정 접근 함수
│   ├── get_cluster_names()        → jq '.clusters[].name'
│   ├── get_pod_cidr()             → jq '.clusters[] | select(.name==...) | .pod_cidr'
│   ├── get_master_for_cluster()   → role=="master"인 노드명
│   └── get_workers_for_cluster()  → role=="worker"인 노드명들
│
├── 로깅 함수
│   ├── log_info()    → 녹색 [INFO]
│   ├── log_warn()    → 노랑 [WARN]
│   ├── log_error()   → 빨강 [ERROR]
│   └── log_section() → 시안 ========== 섹션 ==========
│
└── 유틸리티
    ├── die()              → 에러 출력 + exit 1
    ├── check_dependencies → 필수 도구 확인
    └── kubectl_cmd()      → kubeconfig 자동 주입 kubectl

vm.sh
├── vm_clone()         → tart clone (존재하면 skip — 멱등)
├── vm_set_resources() → tart set --cpu --memory
├── vm_start()         → tart run --no-graphics --net-softnet-allow=0.0.0.0/0 &
├── vm_stop()          → tart stop
├── vm_get_ip()        → tart ip
├── vm_wait_for_ip()   → 최대 60회(3초 간격) polling
├── vm_create_all()    → clusters.json 순회하며 전체 VM 생성
└── vm_start_all()     → 전체 VM 시작 + IP 대기

ssh.sh
├── ssh_exec()         → sshpass + ssh (일반 사용자)
├── ssh_exec_sudo()    → sshpass + ssh + sudo bash -s (heredoc)
├── scp_to() / scp_from() → 파일 전송
├── ssh_wait_ready()   → SSH 응답 대기 (최대 40회)
└── ssh_node_exec()    → 노드명 → IP 자동 해석 + ssh_exec

k8s.sh
├── prepare_node()      → swap off, kernel modules, sysctl
├── install_containerd() → apt + config + systemd
├── install_kubeadm()   → K8s 저장소 + apt + hold
├── init_cluster()      → kubeadm reset → init → kubeconfig → join
├── wait_nodes_ready()  → 노드 Ready 상태 polling
├── install_cilium()    → helm upgrade --install
└── install_hubble()    → helm upgrade --reuse-values
```

### 2.3 멱등성 패턴

스크립트가 여러 번 실행되어도 안전한 이유:

```bash
# 1. VM 중복 생성 방지
vm_clone() {
  if vm_exists "$vm_name"; then
    log_warn "VM '$vm_name' already exists, skipping clone."
    return 0    # ← 에러 없이 스킵
  fi
  tart clone "$base_image" "$vm_name"
}

# 2. Helm upgrade --install (없으면 설치, 있으면 업그레이드)
helm upgrade --install cilium cilium/cilium ...

# 3. kubeadm reset -f (이전 상태 정리 후 init)
kubeadm reset -f 2>/dev/null || true
kubeadm init ...

# 4. kubectl apply (선언적 적용)
kubectl apply -f manifests/demo/nginx-app.yaml
```

---

## 3. Terraform 설계

### 3.1 모듈 구조

```
terraform/
├── providers.tf      ← 필요한 프로바이더 선언
├── variables.tf      ← 클러스터 정의 (clusters.json의 HCL 버전)
├── terraform.tfvars  ← 환경별 변수값
├── main.tf           ← 모듈 조합 + 실행 순서
├── outputs.tf        ← 결과 출력 (IP, URL 등)
└── modules/
    ├── tart-vm/      ← VM 생명주기 관리
    ├── k8s-cluster/  ← kubeadm init/join
    └── helm-releases/ ← Helm 차트 배포
```

### 3.2 Tart CLI를 Terraform으로 래핑

Tart는 Terraform 프로바이더가 없으므로 `null_resource` + `local-exec`로 CLI를 래핑한다:

```hcl
# modules/tart-vm/main.tf

# Step 1: 베이스 이미지 풀
resource "null_resource" "pull_base_image" {
  provisioner "local-exec" {
    command = "tart pull ${var.base_image}"
  }
}

# Step 2: VM 클론 (destroy 시 삭제)
resource "null_resource" "vm_clone" {
  for_each = { for node in local.all_nodes : node.name => node }

  provisioner "local-exec" {
    command = "tart clone ${var.base_image} ${each.key}"
  }

  provisioner "local-exec" {
    when    = destroy    # terraform destroy 시 VM 삭제
    command = "tart stop ${each.key} 2>/dev/null; tart delete ${each.key}"
  }
}
```

**`for_each` 패턴**:
- `clusters.json`의 모든 노드를 평탄화(flatten)하여 각각에 대해 리소스 생성
- `each.key` = 노드명 (예: "prod-master")
- `each.value` = 노드 설정 (cpu, memory 등)

### 3.3 의존성 관리

```hcl
# main.tf — 모듈 간 의존성

module "vms" {
  source = "./modules/tart-vm"
  ...
}

module "k8s" {
  source     = "./modules/k8s-cluster"
  depends_on = [module.vms]        # VM 생성 후 K8s 초기화
  vm_ips     = module.vms.vm_ips   # VM IP를 입력으로 전달
  ...
}

module "helm" {
  source     = "./modules/helm-releases"
  depends_on = [module.k8s]        # K8s 초기화 후 Helm 배포
  ...
}
```

실행 순서: `vms` → `k8s` → `helm` (Terraform이 자동으로 보장)

### 3.4 DHCP IP 문제 해결

Tart VM의 IP가 동적이므로 Terraform에서 어떻게 다음 모듈에 전달하는가:

```hcl
# modules/tart-vm/main.tf

# VM 시작 후 IP를 파일에 저장
resource "null_resource" "vm_wait_ip" {
  provisioner "local-exec" {
    command = <<-EOT
      for i in $(seq 1 60); do
        ip=$(tart ip ${each.key} 2>/dev/null || true)
        if [ -n "$ip" ]; then
          echo "$ip" > ${var.project_root}/.terraform-vm-ips/${each.key}.ip
          exit 0
        fi
        sleep 3
      done
      exit 1
    EOT
  }
}

# 파일에서 IP 읽기
data "local_file" "vm_ips" {
  for_each = { for node in local.all_nodes : node.name => node }
  filename = "${var.project_root}/.terraform-vm-ips/${each.key}.ip"
  depends_on = [null_resource.vm_wait_ip]
}

# 출력
output "vm_ips" {
  value = { for name, file in data.local_file.vm_ips : name => trimspace(file.content) }
}
```

이 패턴: **CLI 출력 → 파일 → data source → output → 다음 모듈 input**

### 3.5 Terraform vs Bash 비교

| 관점 | Bash | Terraform |
|------|------|-----------|
| 상태 관리 | 없음 (매번 현재 상태 확인) | `terraform.tfstate` 파일 |
| 변경 미리보기 | 불가 | `terraform plan` |
| 롤백 | 수동 (`tart delete`, `kubeadm reset`) | `terraform destroy` (자동) |
| 부분 실행 | Phase 번호로 수동 선택 | `-target` 모듈 지정 |
| 병렬 실행 | 수동 `&` + `wait` | 자동 병렬화 (의존성 기반) |
| 재현성 | 환경에 따라 다를 수 있음 | 상태 파일로 완벽 재현 |

---

## 4. CI/CD 파이프라인 설계

### 4.1 Jenkins — 빌드 파이프라인

Platform 클러스터에서 운영. PVC + local-path-provisioner로 데이터 영속성 확보.

```
개발자 코드 Push → Jenkins 빌드/테스트 → 컨테이너 이미지 빌드
                                              │
                                              ▼
                                     이미지 레지스트리
```

### 4.2 ArgoCD — GitOps 배포

```
Git Repository (원하는 상태)
    │
    ▼
ArgoCD (platform 클러스터)
    │ 동기화 감지
    ├──→ dev 클러스터에 배포
    ├──→ staging 클러스터에 배포
    └──→ prod 클러스터에 배포
```

**GitOps 원칙**:
1. Git이 진실의 단일 소스 (Single Source of Truth)
2. 선언적 매니페스트로 원하는 상태 정의
3. ArgoCD가 실제 상태와 원하는 상태를 지속적으로 비교
4. 차이가 발생하면 자동 또는 수동으로 동기화

### 4.3 배포 전략 비교

| 전략 | 구현 | 위험도 | 롤백 |
|------|------|--------|------|
| Rolling Update | K8s Deployment 기본 | 낮음 | kubectl rollout undo |
| Blue-Green | ArgoCD Rollout | 중간 | 즉시 (트래픽 전환) |
| Canary | Istio VirtualService | 낮음 | weight 조절만으로 롤백 |
| A/B Testing | Istio 헤더 매칭 | 낮음 | 헤더 규칙 제거 |

이 프로젝트에서는 **Canary 배포**를 Istio VirtualService로 구현:
- v1: 80% 트래픽
- v2: 20% 트래픽
- `x-canary: true` 헤더 시 100% v2

---

## 5. 자동화 수준 분류

### 5.1 Day 0 — 초기 프로비저닝

| 작업 | 자동화 도구 | 수동 작업 |
|------|-------------|-----------|
| VM 생성 | `install.sh` 또는 `terraform apply` | 없음 |
| K8s 초기화 | install.sh Phase 5 | 없음 |
| 모니터링 설치 | install.sh Phase 7 | Grafana 대시보드 커스텀 |
| CI/CD 설치 | install.sh Phase 8 | Jenkins Job 설정 |

### 5.2 Day 1 — 일상 운영

| 작업 | 자동화 | 수동 |
|------|--------|------|
| 노트북 시작 | `boot.sh` | 없음 |
| 노트북 종료 | `shutdown.sh` | 없음 |
| 상태 확인 | `status.sh` + Dashboard | 없음 |
| Pod 오토스케일링 | HPA (자동) | 없음 |
| 알림 발송 | AlertManager (자동) | 대응은 수동 |

### 5.3 Day 2 — 변경 관리

| 작업 | 자동화 | 수동 |
|------|--------|------|
| 클러스터 추가 | `clusters.json` 수정 → `install.sh` | 설정 파일 편집 |
| 앱 배포 | ArgoCD (Git push) | Git commit |
| 카나리 배포 | Istio VirtualService 수정 | YAML 편집 |
| 인프라 변경 | `terraform plan/apply` | 변경사항 검토 |

---

## 6. Helm 차트 관리

### 6.1 Values 오버라이드 패턴

이 프로젝트의 모든 Helm 차트는 **커스텀 values 파일**로 관리한다:

```bash
helm upgrade --install kube-prometheus-stack prometheus-community/kube-prometheus-stack \
  --values manifests/monitoring-values.yaml   # ← 커스텀 설정
```

values 파일이 제공하는 것:
- **재현 가능한 설정**: 동일 values 파일로 어디서든 동일한 환경 재현
- **Git 추적**: 설정 변경 이력 관리
- **리뷰 가능**: Pull Request로 인프라 변경 검토

### 6.2 차트 목록

| 차트 | 레포지토리 | values 파일 | 클러스터 |
|------|-----------|-------------|----------|
| cilium | cilium/cilium | cilium-values.yaml | 전체 |
| kube-prometheus-stack | prometheus-community | monitoring-values.yaml | platform |
| loki-stack | grafana/loki-stack | loki-values.yaml | platform |
| argo-cd | argo/argo-cd | argocd-values.yaml | platform |
| jenkins | jenkins/jenkins | jenkins-values.yaml | platform |
| metrics-server | metrics-server/metrics-server | metrics-server-values.yaml | dev, staging |
| istio-base | istio/base | - | dev |
| istiod | istio/istiod | istio-values.yaml | dev |
| istio-ingressgateway | istio/gateway | - | dev |

---

## 7. 학습 포인트 정리

### 소프트웨어 공학 원칙 적용

| 원칙 | 적용 사례 |
|------|-----------|
| DRY | clusters.json → 모든 도구의 Single Source of Truth |
| SRP | 각 스크립트는 하나의 Phase만 담당 |
| OCP | 새 Phase 추가 시 기존 코드 수정 불필요 |
| Facade | install.sh가 12개 Phase의 진입점 |
| Strategy | ssh_exec / ssh_exec_sudo |
| Idempotency | helm upgrade --install, kubectl apply |
| Fail-Fast | set -euo pipefail |
| Graceful Degradation | Promise.allSettled (대시보드) |
