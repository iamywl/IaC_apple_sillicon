# IaC(Infrastructure as Code)와 자동화 파이프라인(Automation Pipeline) 설계

## 1. Infrastructure as Code 개요(Overview)

이 프로젝트는 **동일한 인프라(Infrastructure)를 두 가지 방식으로 관리**한다:

| 방식(Approach) | 도구(Tool) | 장점(Pros) | 단점(Cons) |
|------|------|------|------|
| 명령형(Imperative) | Bash 스크립트 | 빠른 프로토타이핑(Rapid Prototyping), 디버깅 용이 | 상태 추적(State Tracking) 불가, 멱등성(Idempotency) 수동 보장 |
| 선언형(Declarative) | Terraform | 상태 관리(State Management), 변경 계획 미리보기(Plan Preview) | 학습 곡선(Learning Curve), Tart CLI 래핑(Wrapping) 필요 |

### 핵심 원칙(Core Principles)

```
명령형(Imperative): "이 순서대로 실행해라" (How)
  → tart clone ubuntu prod-master
  → tart set prod-master --cpu 2 --memory 3072
  → tart run prod-master --no-graphics &

선언형(Declarative): "이 상태가 되어야 한다" (What)
  → resource "null_resource" "vm_clone" {
      provisioner "local-exec" { ... }
    }
```

---

## 2. Bash 스크립트 설계(Bash Script Design)

### 2.1 실행 흐름(Execution Flow)

```
install.sh (진입점, Entry Point)
    │
    ├── source lib/common.sh     ← 설정 파싱(Config Parsing), 로깅(Logging)
    ├── check_dependencies       ← brew 패키지 확인(Package Verification)
    │
    ├── Phase 1:  01-create-vms.sh      ← tart clone + set
    ├── (inline)  vm_start_all          ← tart run (백그라운드, Background)
    ├── (inline)  ssh_wait_ready        ← SSH 연결 대기(Connection Wait)
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
    ├── Phase 11: 11-install-hpa.sh         ← metrics-server + HPA(Horizontal Pod Autoscaler)
    └── Phase 12: 12-install-istio.sh       ← Istio Service Mesh
```

### 2.2 함수 라이브러리 설계(Function Library Design)

```
common.sh
├── 설정 접근 함수(Config Access Functions)
│   ├── get_cluster_names()        → jq '.clusters[].name'
│   ├── get_pod_cidr()             → jq '.clusters[] | select(.name==...) | .pod_cidr'
│   ├── get_master_for_cluster()   → role=="master"인 노드명(Node Name)
│   └── get_workers_for_cluster()  → role=="worker"인 노드명들
│
├── 로깅 함수(Logging Functions)
│   ├── log_info()    → 녹색 [INFO]
│   ├── log_warn()    → 노랑 [WARN]
│   ├── log_error()   → 빨강 [ERROR]
│   └── log_section() → 시안(Cyan) ========== 섹션(Section) ==========
│
└── 유틸리티(Utilities)
    ├── die()              → 에러 출력 + exit 1
    ├── check_dependencies → 필수 도구 확인(Required Tool Check)
    └── kubectl_cmd()      → kubeconfig 자동 주입(Auto Inject) kubectl

vm.sh
├── vm_clone()         → tart clone — 존재하면 skip (멱등, Idempotent)
├── vm_set_resources() → tart set --cpu --memory
├── vm_start()         → tart run --no-graphics --net-softnet-allow=0.0.0.0/0 &
├── vm_stop()          → tart stop
├── vm_get_ip()        → tart ip
├── vm_wait_for_ip()   → 최대 60회(3초 간격) 폴링(Polling)
├── vm_create_all()    → clusters.json 순회하며 전체 VM 생성(Create All VMs)
└── vm_start_all()     → 전체 VM 시작(Start All) + IP 대기(Wait)

ssh.sh
├── ssh_exec()         → sshpass + ssh — 일반 사용자(Normal User)
├── ssh_exec_sudo()    → sshpass + ssh + sudo bash -s (heredoc)
├── scp_to() / scp_from() → 파일 전송(File Transfer)
├── ssh_wait_ready()   → SSH 응답 대기(Response Wait) — 최대 40회
└── ssh_node_exec()    → 노드명 → IP 자동 해석(Auto Resolve) + ssh_exec

k8s.sh
├── prepare_node()      → swap off, kernel modules, sysctl
├── install_containerd() → apt + config + systemd
├── install_kubeadm()   → K8s 저장소(Repository) + apt + hold
├── init_cluster()      → kubeadm reset → init → kubeconfig → join
├── wait_nodes_ready()  → 노드 Ready 상태 폴링(Status Polling)
├── install_cilium()    → helm upgrade --install
└── install_hubble()    → helm upgrade --reuse-values
```

### 2.3 멱등성 패턴(Idempotency Patterns)

스크립트가 여러 번 실행되어도 안전한 이유:

```bash
# 1. VM 중복 생성 방지(Duplicate Prevention)
vm_clone() {
  if vm_exists "$vm_name"; then
    log_warn "VM '$vm_name' already exists, skipping clone."
    return 0    # ← 에러 없이 스킵(Skip without Error)
  fi
  tart clone "$base_image" "$vm_name"
}

# 2. Helm upgrade --install — 없으면 설치, 있으면 업그레이드(Install or Upgrade)
helm upgrade --install cilium cilium/cilium ...

# 3. kubeadm reset -f — 이전 상태 정리(Cleanup) 후 init
kubeadm reset -f 2>/dev/null || true
kubeadm init ...

# 4. kubectl apply — 선언적 적용(Declarative Apply)
kubectl apply -f manifests/demo/nginx-app.yaml
```

---

## 3. Terraform 설계(Terraform Design)

### 3.1 모듈 구조(Module Structure)

```
terraform/
├── providers.tf      ← 필요한 프로바이더(Provider) 선언
├── variables.tf      ← 클러스터 정의(Cluster Definition) — clusters.json의 HCL 버전
├── terraform.tfvars  ← 환경별 변수값(Environment-specific Variables)
├── main.tf           ← 모듈 조합(Module Composition) + 실행 순서(Execution Order)
├── outputs.tf        ← 결과 출력(Output) — IP, URL 등
└── modules/
    ├── tart-vm/      ← VM 생명주기 관리(Lifecycle Management)
    ├── k8s-cluster/  ← kubeadm init/join
    └── helm-releases/ ← Helm 차트 배포(Chart Deployment)
```

### 3.2 Tart CLI를 Terraform으로 래핑(Wrapping Tart CLI with Terraform)

Tart는 Terraform 프로바이더(Provider)가 없으므로 `null_resource` + `local-exec`로 CLI를 래핑한다:

```hcl
# modules/tart-vm/main.tf

# Step 1: 베이스 이미지 풀(Base Image Pull)
resource "null_resource" "pull_base_image" {
  provisioner "local-exec" {
    command = "tart pull ${var.base_image}"
  }
}

# Step 2: VM 클론(Clone) — destroy 시 삭제(Delete on Destroy)
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
- `clusters.json`의 모든 노드를 평탄화(Flatten)하여 각각에 대해 리소스(Resource) 생성
- `each.key` = 노드명 (예: "prod-master")
- `each.value` = 노드 설정(Node Configuration) — cpu, memory 등

### 3.3 의존성 관리(Dependency Management)

```hcl
# main.tf — 모듈 간 의존성(Inter-module Dependencies)

module "vms" {
  source = "./modules/tart-vm"
  ...
}

module "k8s" {
  source     = "./modules/k8s-cluster"
  depends_on = [module.vms]        # VM 생성 후 K8s 초기화(Init after VM Creation)
  vm_ips     = module.vms.vm_ips   # VM IP를 입력으로 전달(Pass as Input)
  ...
}

module "helm" {
  source     = "./modules/helm-releases"
  depends_on = [module.k8s]        # K8s 초기화 후 Helm 배포(Deploy after K8s Init)
  ...
}
```

실행 순서(Execution Order): `vms` → `k8s` → `helm` — Terraform이 자동으로 보장(Auto-guaranteed)

### 3.4 DHCP IP 문제 해결(DHCP IP Problem Resolution)

Tart VM의 IP가 동적(Dynamic)이므로 Terraform에서 어떻게 다음 모듈에 전달하는가:

```hcl
# modules/tart-vm/main.tf

# VM 시작 후 IP를 파일에 저장(Save IP to File after VM Start)
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

# 파일에서 IP 읽기(Read IP from File)
data "local_file" "vm_ips" {
  for_each = { for node in local.all_nodes : node.name => node }
  filename = "${var.project_root}/.terraform-vm-ips/${each.key}.ip"
  depends_on = [null_resource.vm_wait_ip]
}

# 출력(Output)
output "vm_ips" {
  value = { for name, file in data.local_file.vm_ips : name => trimspace(file.content) }
}
```

이 패턴: **CLI 출력(Output) → 파일(File) → data source → output → 다음 모듈 input**

### 3.5 Terraform vs Bash 비교(Comparison)

| 관점(Aspect) | Bash | Terraform |
|------|------|-----------|
| 상태 관리(State Management) | 없음 — 매번 현재 상태 확인 | `terraform.tfstate` 파일 |
| 변경 미리보기(Change Preview) | 불가 | `terraform plan` |
| 롤백(Rollback) | 수동(Manual) — `tart delete`, `kubeadm reset` | `terraform destroy` (자동, Auto) |
| 부분 실행(Partial Execution) | Phase 번호로 수동 선택 | `-target` 모듈 지정 |
| 병렬 실행(Parallel Execution) | 수동 `&` + `wait` | 자동 병렬화(Auto Parallelization) — 의존성 기반 |
| 재현성(Reproducibility) | 환경에 따라 다를 수 있음 | 상태 파일(State File)로 완벽 재현 |

---

## 4. CI/CD 파이프라인 설계(CI/CD Pipeline Design)

### 4.1 Jenkins — 빌드 파이프라인(Build Pipeline)

Platform 클러스터에서 운영. PVC(Persistent Volume Claim) + local-path-provisioner로 데이터 영속성(Data Persistence) 확보.

```
개발자 코드 Push(Developer Code Push) → Jenkins 빌드/테스트(Build/Test)
→ 컨테이너 이미지 빌드(Container Image Build)
                                              │
                                              ▼
                                     이미지 레지스트리(Image Registry)
```

### 4.2 ArgoCD — GitOps 배포(GitOps Deployment)

```
Git Repository (원하는 상태, Desired State)
    │
    ▼
ArgoCD (platform 클러스터)
    │ 동기화 감지(Sync Detection)
    ├──→ dev 클러스터에 배포(Deploy to Dev)
    ├──→ staging 클러스터에 배포(Deploy to Staging)
    └──→ prod 클러스터에 배포(Deploy to Prod)
```

**GitOps 원칙(Principles)**:
1. Git이 진실의 단일 소스(Single Source of Truth)
2. 선언적 매니페스트(Declarative Manifests)로 원하는 상태 정의
3. ArgoCD가 실제 상태(Actual State)와 원하는 상태(Desired State)를 지속적으로 비교
4. 차이(Drift)가 발생하면 자동 또는 수동으로 동기화(Sync)

### 4.3 배포 전략 비교(Deployment Strategy Comparison)

| 전략(Strategy) | 구현(Implementation) | 위험도(Risk) | 롤백(Rollback) |
|------|------|--------|------|
| Rolling Update | K8s Deployment 기본(Default) | 낮음(Low) | kubectl rollout undo |
| Blue-Green | ArgoCD Rollout | 중간(Medium) | 즉시(Instant) — 트래픽 전환(Traffic Switch) |
| 카나리(Canary) | Istio VirtualService | 낮음 | weight 조절만으로 롤백 |
| A/B Testing | Istio 헤더 매칭(Header Matching) | 낮음 | 헤더 규칙 제거(Remove Header Rule) |

이 프로젝트에서는 **카나리 배포(Canary Deployment)**를 Istio VirtualService로 구현:
- v1: 80% 트래픽
- v2: 20% 트래픽
- `x-canary: true` 헤더(Header) 시 100% v2

---

## 5. 자동화 수준 분류(Automation Level Classification)

### 5.1 Day 0 — 초기 프로비저닝(Initial Provisioning)

| 작업(Task) | 자동화 도구(Automation Tool) | 수동 작업(Manual Work) |
|------|-------------|-----------|
| VM 생성(Creation) | `install.sh` 또는 `terraform apply` | 없음(None) |
| K8s 초기화(Init) | install.sh Phase 5 | 없음 |
| 모니터링 설치(Monitoring Install) | install.sh Phase 7 | Grafana 대시보드 커스텀(Custom) |
| CI/CD 설치 | install.sh Phase 8 | Jenkins Job 설정(Configuration) |

### 5.2 Day 1 — 일상 운영(Daily Operations)

| 작업(Task) | 자동화(Automation) | 수동(Manual) |
|------|--------|------|
| 노트북 시작(Start) | `boot.sh` | 없음 |
| 노트북 종료(Shutdown) | `shutdown.sh` | 없음 |
| 상태 확인(Status Check) | `status.sh` + Dashboard | 없음 |
| Pod 오토스케일링(Auto-scaling) | HPA (자동, Auto) | 없음 |
| 알림 발송(Alert Dispatch) | AlertManager (자동) | 대응(Response)은 수동 |

### 5.3 Day 2 — 변경 관리(Change Management)

| 작업(Task) | 자동화(Automation) | 수동(Manual) |
|------|--------|------|
| 클러스터 추가(Cluster Addition) | `clusters.json` 수정 → `install.sh` | 설정 파일 편집(Config File Edit) |
| 앱 배포(App Deployment) | ArgoCD (Git push) | Git commit |
| 카나리 배포(Canary Deploy) | Istio VirtualService 수정 | YAML 편집(Edit) |
| 인프라 변경(Infra Change) | `terraform plan/apply` | 변경사항 검토(Change Review) |

---

## 6. Helm 차트 관리(Helm Chart Management)

### 6.1 Values 오버라이드 패턴(Override Pattern)

이 프로젝트의 모든 Helm 차트는 **커스텀 values 파일(Custom Values File)**로 관리한다:

```bash
helm upgrade --install kube-prometheus-stack prometheus-community/kube-prometheus-stack \
  --values manifests/monitoring-values.yaml   # ← 커스텀 설정(Custom Config)
```

values 파일이 제공하는 것:
- **재현 가능한 설정(Reproducible Configuration)**: 동일 values 파일로 어디서든 동일한 환경 재현
- **Git 추적(Git Tracking)**: 설정 변경 이력(Change History) 관리
- **리뷰 가능(Reviewable)**: PR(Pull Request)로 인프라 변경 검토

### 6.2 차트 목록(Chart List)

| 차트(Chart) | 레포지토리(Repository) | values 파일(Values File) | 클러스터(Cluster) |
|------|-----------|-------------|----------|
| cilium | cilium/cilium | cilium-values.yaml | 전체(All) |
| kube-prometheus-stack | prometheus-community | monitoring-values.yaml | platform |
| loki-stack | grafana/loki-stack | loki-values.yaml | platform |
| argo-cd | argo/argo-cd | argocd-values.yaml | platform |
| jenkins | jenkins/jenkins | jenkins-values.yaml | platform |
| metrics-server | metrics-server/metrics-server | metrics-server-values.yaml | dev, staging |
| istio-base | istio/base | - | dev |
| istiod | istio/istiod | istio-values.yaml | dev |
| istio-ingressgateway | istio/gateway | - | dev |

---

## 7. 학습 포인트 정리(Learning Points Summary)

### 소프트웨어 공학 원칙 적용(Software Engineering Principle Application)

| 원칙(Principle) | 적용 사례(Application Example) |
|------|-----------|
| DRY(Don't Repeat Yourself) | clusters.json → 모든 도구의 Single Source of Truth |
| SRP(Single Responsibility Principle) | 각 스크립트는 하나의 Phase만 담당 |
| OCP(Open-Closed Principle) | 새 Phase 추가 시 기존 코드 수정 불필요 |
| 퍼사드(Facade) | install.sh가 12개 Phase의 진입점(Entry Point) |
| 전략(Strategy) | ssh_exec / ssh_exec_sudo |
| 멱등성(Idempotency) | helm upgrade --install, kubectl apply |
| Fail-Fast | set -euo pipefail |
| Graceful Degradation | Promise.allSettled (대시보드, Dashboard) |
