# 재연 가이드 09. Terraform으로 구축하기

이 프로젝트는 Bash 스크립트(`demo.sh`, `install.sh`)로 구축하는 방식과 Terraform으로 구축하는 방식을 모두 제공한다. 이 문서는 Terraform 대안의 구조와 사용 방법을 설명한다.

---

## 1. Bash 스크립트 vs Terraform

### Bash 스크립트 방식

| 항목 | 내용 |
|------|------|
| 진입점 | `demo.sh` 또는 `install.sh` |
| 실행 구조 | 17개 Phase 스크립트를 순차 실행 |
| 상태 관리 | 없음. 매번 현재 상태를 확인하고 멱등성을 코드로 구현한다 |
| 에러 처리 | `set -euo pipefail`로 즉시 중단한다 |
| 장점 | 단순하다. 디버깅이 쉽다. 의존성이 적다 |
| 단점 | 상태 추적이 안 된다. 부분 삭제가 어렵다 |

### Terraform 방식

| 항목 | 내용 |
|------|------|
| 진입점 | `terraform/main.tf` |
| 실행 구조 | 3개 모듈이 의존성 그래프에 따라 실행된다 |
| 상태 관리 | `terraform.tfstate`에 모든 리소스 상태를 기록한다 |
| 에러 처리 | 리소스 단위로 실패를 추적한다 |
| 장점 | 선언적이다. 상태 관리가 자동이다. plan으로 사전 검토가 가능하다 |
| 단점 | Terraform 설치가 필요하다. null_resource 사용이 많아 Terraform의 이점이 제한적이다 |

### 언제 Terraform을 사용하는가

- 인프라 변경 이력을 추적하고 싶을 때 사용한다.
- `terraform plan`으로 변경 사항을 사전에 확인하고 싶을 때 사용한다.
- `terraform destroy`로 깔끔하게 정리하고 싶을 때 사용한다.
- IaC(Infrastructure as Code) 도구 경험을 쌓고 싶을 때 사용한다.

Bash 스크립트 방식은 빠르게 구축하고 실험하는 데 적합하다. Terraform 방식은 체계적으로 관리하는 데 적합하다.

---

## 2. Terraform 구조

```
terraform/
├── main.tf              # 모듈 오케스트레이션 및 Phase 4 리소스
├── variables.tf         # 변수 정의 (클러스터, SSH, 이미지)
├── outputs.tf           # 출력값 (VM IP, kubeconfig 경로, 서비스 URL)
├── providers.tf         # Terraform 버전 및 Provider 요구사항
├── terraform.tfvars     # 변수 값 설정
└── modules/
    ├── tart-vm/         # VM 생성 및 IP 할당
    │   ├── main.tf
    │   ├── variables.tf
    │   └── outputs.tf
    ├── k8s-cluster/     # Kubernetes 클러스터 초기화
    │   ├── main.tf
    │   ├── variables.tf
    │   └── outputs.tf
    └── helm-releases/   # Helm 차트 배포
        ├── main.tf
        ├── variables.tf
        └── outputs.tf
```

### 실행 의존성 그래프

```
module.vms (tart-vm)
    │
    ▼
module.k8s (k8s-cluster)    ← VM IP를 입력으로 받는다
    │
    ├──▶ module.helm (helm-releases)       ← platform 클러스터에 Helm 배포
    │
    └──▶ null_resource.install_dev_staging ← dev/staging에 metrics-server, Istio 배포
```

---

## 3. 사전 준비

### Terraform 설치

```bash
brew install terraform

# 버전 확인 (1.5 이상 필요)
terraform version
```

### 프로젝트 루트 경로 설정

`terraform/terraform.tfvars`에 프로젝트의 절대 경로를 설정한다.

```hcl
project_root = "/Users/<username>/tart-infra"
```

현재 설정된 값을 확인한다.

```bash
cat terraform/terraform.tfvars
```

실제 프로젝트 경로와 일치하지 않으면 수정한다.

---

## 4. 실행 방법

### 4.1 초기화

```bash
cd terraform
terraform init
```

이 명령은 다음을 수행한다:
- `.terraform/` 디렉토리를 생성한다.
- `hashicorp/null` (v3.2), `hashicorp/helm` (v2.12), `hashicorp/local` (v2.4) Provider를 다운로드한다.
- 모듈 의존성을 해석한다.

### 4.2 실행 계획 확인

```bash
terraform plan
```

생성될 리소스 목록이 출력된다. 이 프로젝트에서 생성되는 주요 리소스는 다음과 같다:

| 리소스 유형 | 수량 | 설명 |
|-------------|------|------|
| `null_resource.pull_base_image` | 1 | 베이스 이미지 다운로드 |
| `null_resource.vm_clone` | 10 | VM 복제 (4 클러스터, 10 노드) |
| `null_resource.vm_start` | 10 | VM 시작 |
| `null_resource.vm_wait_ip` | 10 | IP 할당 대기 |
| `data.local_file.vm_ips` | 10 | IP 파일 읽기 |
| `null_resource.ssh_wait` | 10 | SSH 준비 대기 |
| `null_resource.prepare_node` | 10 | 노드 준비 (swap, sysctl) |
| `null_resource.install_runtime` | 10 | containerd 설치 |
| `null_resource.install_kubeadm` | 10 | kubeadm/kubelet/kubectl 설치 |
| `null_resource.init_cluster` | 4 | kubeadm init + join |
| `null_resource.install_cilium` | 4 | Cilium + Hubble 설치 |
| `helm_release.kube_prometheus_stack` | 1 | Prometheus + Grafana |
| `helm_release.loki` | 1 | Loki 로그 수집 |
| `helm_release.argocd` | 1 | ArgoCD |
| `helm_release.jenkins` | 1 | Jenkins |
| `null_resource.install_dev_staging` | 1 | metrics-server + Istio |

### 4.3 적용

```bash
terraform apply
```

확인 프롬프트에 `yes`를 입력한다. 전체 실행 시간은 약 45~60분이다.

자동 승인으로 실행하려면 다음과 같이 한다.

```bash
terraform apply -auto-approve
```

### 4.4 출력값 확인

적용이 완료되면 출력값을 확인한다.

```bash
terraform output
```

출력 예시:

```
vm_ips = {
  "platform-master"   = "192.168.64.2"
  "platform-worker1"  = "192.168.64.3"
  "platform-worker2"  = "192.168.64.4"
  "dev-master"        = "192.168.64.5"
  "dev-worker1"       = "192.168.64.6"
  "staging-master"    = "192.168.64.7"
  "staging-worker1"   = "192.168.64.8"
  "prod-master"       = "192.168.64.9"
  "prod-worker1"      = "192.168.64.10"
  "prod-worker2"      = "192.168.64.11"
}

cluster_kubeconfigs = {
  "platform" = "/Users/<username>/tart-infra/kubeconfig/platform.yaml"
  "dev"      = "/Users/<username>/tart-infra/kubeconfig/dev.yaml"
  "staging"  = "/Users/<username>/tart-infra/kubeconfig/staging.yaml"
  "prod"     = "/Users/<username>/tart-infra/kubeconfig/prod.yaml"
}

access_urls = {
  "grafana"      = "http://192.168.64.3:30300"
  "argocd"       = "http://192.168.64.3:30800"
  "jenkins"      = "http://192.168.64.3:30900"
  "alertmanager" = "http://192.168.64.3:30903"
}
```

---

## 5. 각 모듈 상세

### 5.1 tart-vm 모듈

VM 생명주기를 관리한다. Tart는 Terraform Provider가 없으므로 `null_resource`와 `local-exec` provisioner로 `tart` CLI를 호출한다.

**실행 순서:**

1. `null_resource.pull_base_image` -- 베이스 이미지(`ghcr.io/cirruslabs/ubuntu:latest`)를 로컬에 캐시한다. 이미 존재하면 건너뛴다.
2. `null_resource.vm_clone` -- 베이스 이미지를 각 노드 이름으로 복제하고 CPU/메모리를 설정한다. `destroy` provisioner가 정의되어 있어 `terraform destroy` 시 VM을 자동 삭제한다.
3. `null_resource.vm_start` -- `tart run --no-graphics --net-softnet-allow=0.0.0.0/0`으로 VM을 백그라운드 실행한다.
4. `null_resource.vm_wait_ip` -- 3초 간격으로 최대 60회(180초) `tart ip`를 폴링하여 IP를 `.terraform-vm-ips/<vm-name>.ip` 파일에 저장한다.
5. `data.local_file.vm_ips` -- IP 파일을 읽어서 다른 모듈에 전달한다.

**클러스터별 노드 구성 (variables.tf 기본값):**

| 클러스터 | 노드 | 역할 | CPU | 메모리(MB) |
|----------|------|------|-----|-----------|
| platform | platform-master | master | 2 | 4096 |
| platform | platform-worker1 | worker | 3 | 12288 |
| platform | platform-worker2 | worker | 2 | 8192 |
| dev | dev-master | master | 2 | 4096 |
| dev | dev-worker1 | worker | 2 | 8192 |
| staging | staging-master | master | 2 | 4096 |
| staging | staging-worker1 | worker | 2 | 8192 |
| prod | prod-master | master | 2 | 4096 |
| prod | prod-worker1 | worker | 2 | 8192 |
| prod | prod-worker2 | worker | 2 | 8192 |

---

### 5.2 k8s-cluster 모듈

VM 위에 Kubernetes 클러스터를 구성한다. `scripts/lib/` 라이브러리 함수를 SSH를 통해 호출한다.

**실행 순서:**

1. `null_resource.ssh_wait` -- 모든 노드에서 SSH 접속이 가능해질 때까지 대기한다. `ssh_wait_ready` 함수는 3초 간격으로 최대 40회(120초) 시도한다.
2. `null_resource.prepare_node` -- swap 비활성화, 커널 모듈 로드(`br_netfilter`, `overlay`), sysctl 파라미터 설정을 수행한다.
3. `null_resource.install_runtime` -- containerd를 설치하고 설정한다.
4. `null_resource.install_kubeadm` -- kubeadm, kubelet, kubectl을 설치한다.
5. `null_resource.init_cluster` -- 클러스터별로 `kubeadm init`을 실행하고, worker 노드를 `kubeadm join`으로 합류시킨다.
6. `null_resource.install_cilium` -- Cilium CNI와 Hubble을 설치하고, 모든 노드가 Ready 상태가 될 때까지 대기한다.

**클러스터별 네트워크 설정:**

| 클러스터 | Pod CIDR | Service CIDR |
|----------|----------|--------------|
| platform | 10.10.0.0/16 | 10.96.0.0/16 |
| dev | 10.20.0.0/16 | 10.97.0.0/16 |
| staging | 10.30.0.0/16 | 10.98.0.0/16 |
| prod | 10.40.0.0/16 | 10.99.0.0/16 |

Pod CIDR과 Service CIDR은 클러스터 간에 겹치지 않도록 설정되어 있다.

---

### 5.3 helm-releases 모듈

platform 클러스터에 모니터링과 CI/CD 도구를 Helm 차트로 배포한다. 이 모듈은 `null_resource`가 아닌 Terraform의 `helm_release` 리소스를 사용한다.

**배포 대상:**

| Helm Release | Chart | Namespace | 설명 |
|-------------|-------|-----------|------|
| `kube-prometheus-stack` | prometheus-community/kube-prometheus-stack | monitoring | Prometheus, Grafana, AlertManager |
| `loki` | grafana/loki-stack | monitoring | Loki 로그 수집 (Prometheus Stack에 의존) |
| `argocd` | argoproj/argo-cd | argocd | GitOps CD |
| `jenkins` | jenkins/jenkins | jenkins | CI 서버 |

**Helm Provider 설정:**

`main.tf`의 최상위에서 Helm Provider가 platform 클러스터의 kubeconfig를 참조하도록 설정되어 있다.

```hcl
provider "helm" {
  kubernetes {
    config_path = "${local.kubeconfig_dir}/platform.yaml"
  }
}
```

각 Helm Release의 values 파일은 `manifests/` 디렉토리에 위치한다.

---

### 5.4 Phase 4: dev/staging 추가 설치

`main.tf`의 `null_resource.install_dev_staging`에서 처리한다. Helm Provider가 platform 클러스터에 고정되어 있으므로, dev/staging 클러스터에는 기존 Bash 스크립트를 `local-exec`으로 호출한다.

```hcl
resource "null_resource" "install_dev_staging" {
  depends_on = [module.k8s]

  provisioner "local-exec" {
    command = <<-EOT
      bash "${var.project_root}/scripts/install/11-install-hpa.sh"
      bash "${var.project_root}/scripts/install/12-install-istio.sh"
    EOT
  }
}
```

이 리소스는 다음을 수행한다:
- dev, staging 클러스터에 metrics-server를 설치한다 (HPA 지원).
- dev 클러스터에 Istio 서비스 메시를 설치한다.

---

## 6. 상태 관리

### 6.1 terraform.tfstate의 역할

Terraform은 관리하는 모든 리소스의 현재 상태를 `terraform.tfstate` 파일에 JSON 형식으로 저장한다.

```bash
# 상태 파일 확인
ls -la terraform/terraform.tfstate

# 관리 중인 리소스 목록 확인
cd terraform && terraform state list

# 특정 리소스의 상태 확인
terraform state show 'module.vms.null_resource.vm_clone["platform-master"]'
```

이 프로젝트에서 `terraform.tfstate`에는 다음이 기록된다:
- 각 VM의 clone/start/ip 리소스 상태
- 각 노드의 SSH wait/prepare/runtime/kubeadm 리소스 상태
- 각 클러스터의 init/cilium 리소스 상태
- 각 Helm Release의 배포 상태

### 6.2 드리프트 감지

Terraform 외부에서 인프라를 변경하면 상태 파일과 실제 상태가 불일치(drift)한다.

```bash
# 드리프트 확인
terraform plan
```

`terraform plan`이 변경 사항을 표시하면 드리프트가 발생한 것이다. 다만 이 프로젝트는 `null_resource`를 많이 사용하므로, 드리프트 감지에 한계가 있다. `null_resource`는 `triggers`에 지정된 값이 변경될 때만 재생성을 감지한다.

다음 경우에 드리프트가 발생한다:
- 수동으로 VM을 삭제하거나 정지한 경우
- SSH로 접속하여 Kubernetes 설정을 변경한 경우
- `kubectl`로 직접 Helm Release를 삭제한 경우

### 6.3 상태 파일 주의사항

```bash
# 상태 파일에 민감 정보가 포함될 수 있다
# terraform.tfstate를 .gitignore에 추가한다
echo "terraform.tfstate*" >> terraform/.gitignore

# 상태 파일 백업
cp terraform/terraform.tfstate terraform/terraform.tfstate.backup
```

이 프로젝트는 로컬 상태 파일(local backend)을 사용한다. 팀 환경에서는 remote backend(S3, GCS 등)를 사용하는 것이 좋다. 그러나 이 프로젝트는 단일 Mac에서 실행되므로 로컬 상태 파일로 충분하다.

---

## 7. terraform destroy로 정리

전체 인프라를 삭제한다.

```bash
cd terraform
terraform destroy
```

확인 프롬프트에 `yes`를 입력한다. 다음이 순서대로 삭제된다:

1. Helm Release 삭제 (Jenkins, ArgoCD, Loki, Prometheus)
2. Kubernetes 클러스터 관련 리소스 정리
3. VM 정지 및 삭제 (`vm_clone`의 `destroy` provisioner가 실행된다)

자동 승인으로 삭제하려면 다음과 같이 한다.

```bash
terraform destroy -auto-approve
```

### 부분 삭제

특정 리소스만 삭제할 수 있다.

```bash
# 특정 VM만 삭제
terraform destroy -target='module.vms.null_resource.vm_clone["dev-worker1"]'

# 특정 Helm Release만 삭제
terraform destroy -target='module.helm.helm_release.jenkins'

# 특정 모듈 전체 삭제
terraform destroy -target=module.helm
```

### 상태에서 리소스 제거 (삭제 없이)

실제 리소스는 유지하면서 Terraform 관리에서만 제외하려면 다음과 같이 한다.

```bash
terraform state rm 'module.vms.null_resource.vm_clone["dev-worker1"]'
```

---

## 8. 변수 커스터마이징

### 클러스터 구성 변경

`terraform.tfvars`에서 클러스터 수, 노드 수, 리소스를 변경할 수 있다. 기본 변수 정의는 `variables.tf`에 있다.

```hcl
# terraform.tfvars 예시: platform 클러스터만 구축
project_root = "/Users/<username>/tart-infra"

clusters = [
  {
    name         = "platform"
    pod_cidr     = "10.10.0.0/16"
    service_cidr = "10.96.0.0/16"
    nodes = [
      { name = "platform-master",  role = "master", cpu = 2, memory = 4096,  disk = 20 },
      { name = "platform-worker1", role = "worker", cpu = 3, memory = 12288, disk = 20 },
    ]
  }
]
```

### 베이스 이미지 변경

```hcl
# Golden Image 사용 시
base_image = "local:golden-k8s"
```

### SSH 자격 증명 변경

```hcl
ssh_user     = "admin"
ssh_password = "admin"
```

`ssh_password`는 `sensitive = true`로 선언되어 있어 `terraform plan` 출력에서 마스킹된다.

---

## 9. Bash 스크립트 방식과의 대응 관계

| Bash 스크립트 | Terraform 리소스 |
|-------------|-----------------|
| `01-create-vms.sh` | `module.vms` (pull, clone, start, wait_ip) |
| `02-prepare-nodes.sh` | `module.k8s.null_resource.prepare_node` |
| `03-install-runtime.sh` | `module.k8s.null_resource.install_runtime` |
| `04-install-kubeadm.sh` | `module.k8s.null_resource.install_kubeadm` |
| `05-init-clusters.sh` | `module.k8s.null_resource.init_cluster` |
| `06-install-cilium.sh` | `module.k8s.null_resource.install_cilium` |
| `07-install-monitoring.sh` | `module.helm.helm_release.kube_prometheus_stack` + `loki` |
| `08-install-cicd.sh` | `module.helm.helm_release.argocd` + `jenkins` |
| `09-install-alerting.sh` | `module.helm` (monitoring-values.yaml에 포함) |
| `10-install-network-policies.sh` | (Terraform에서 미구현) |
| `11-install-hpa.sh` | `null_resource.install_dev_staging` |
| `12-install-istio.sh` | `null_resource.install_dev_staging` |
| `destroy.sh` | `terraform destroy` |
| `status.sh` | `terraform output` + `terraform state list` |

`10-install-network-policies.sh`는 Terraform에서 구현되어 있지 않다. 필요하면 `null_resource`로 추가하거나, Terraform 적용 후 수동으로 실행한다.

```bash
bash scripts/install/10-install-network-policies.sh
```
