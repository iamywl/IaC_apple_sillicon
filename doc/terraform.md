# Terraform — 선언형(Declarative) IaC(Infrastructure as Code) 구현

## 개요(Overview)

[Terraform](https://www.terraform.io/)을 사용하여 Tart VM(Virtual Machine) 생성부터 K8s(Kubernetes) 클러스터(Cluster) 구성, Helm 차트(Chart) 배포까지를 선언형(Declarative)으로 관리한다. Bash 스크립트(`./scripts/install.sh`)와 **동일한 결과**를 생성하며, 상태 추적(State Tracking)과 변경 미리보기(`terraform plan`)를 제공한다.

```bash
cd terraform
terraform init
terraform plan     # 변경 사항 미리보기(Preview Changes)
terraform apply    # 인프라 프로비저닝(Provision Infrastructure)
```

---

## Bash vs Terraform 비교(Comparison)

| 항목(Aspect) | Bash (`install.sh`) | Terraform (`terraform apply`) |
|------|------|------|
| 패러다임(Paradigm) | 명령형(Imperative) | 선언형(Declarative) |
| 상태 관리(State Management) | 없음 | `terraform.tfstate` 자동 추적 |
| 변경 미리보기(Change Preview) | 없음 | `terraform plan` |
| 롤백(Rollback) | 수동 | `terraform destroy` |
| 멱등성(Idempotency) | 스크립트 내 직접 구현 | 프레임워크(Framework) 내장 |
| 디버깅(Debugging) | 직관적 — `set -x` | `TF_LOG=DEBUG` |
| 실행 속도(Speed) | 빠름 | 약간 느림 (의존성 그래프 계산) |

---

## 모듈 구조(Module Structure)

```
terraform/
├── main.tf              ← 모듈 조합(Module Composition) — vms → k8s → helm
├── variables.tf         ← clusters.json의 HCL(HashiCorp Configuration Language) 버전
├── outputs.tf           ← VM IP, kubeconfig 경로(Path), 서비스 URL(Uniform Resource Locator)
├── providers.tf         ← Helm 프로바이더(Provider) — platform.yaml 참조
├── terraform.tfvars     ← project_root 변수(Variable)
└── modules/
    ├── tart-vm/         ← VM 생성(Create) → 시작(Start) → IP 대기(Wait)
    ├── k8s-cluster/     ← kubeadm init/join → Cilium/Hubble 설치
    └── helm-releases/   ← Platform 클러스터 Helm 릴리스(Releases)
```

### 4단계 실행 흐름(Execution Flow)

```
1. Module: tart-vm (null_resource)
   └─ pull base image → clone 10 VMs → set CPU/RAM → start → wait for DHCP IP
      IP를 .terraform-vm-ips/*.ip 파일에 저장

2. Module: k8s-cluster (null_resource, depends_on: tart-vm)
   └─ SSH wait → prepare_node → install_containerd → install_kubeadm
      → kubeadm init → kubeadm join → install_cilium + hubble

3. Module: helm-releases (helm_release, depends_on: k8s-cluster)
   └─ kube-prometheus-stack, Loki, ArgoCD, Jenkins (platform 클러스터)

4. null_resource: install_dev_staging (local-exec, depends_on: k8s-cluster)
   └─ 11-install-hpa.sh + 12-install-istio.sh 실행
```

### `null_resource`로 Tart CLI(Command Line Interface) 래핑(Wrapping)

Tart용 Terraform 프로바이더(Provider)가 없으므로 `null_resource` + `local-exec` 프로비저너(Provisioner)로 래핑:

```hcl
resource "null_resource" "vm_create" {
  for_each = var.all_nodes

  provisioner "local-exec" {
    interpreter = ["bash", "-c"]
    command     = <<-EOT
      source ${var.project_root}/scripts/lib/common.sh
      source ${var.project_root}/scripts/lib/vm.sh
      vm_clone "${var.base_image}" "${each.key}"
      vm_set_resources "${each.key}" "${each.value.cpu}" "${each.value.memory}"
      vm_start "${each.key}"
      vm_wait_for_ip "${each.key}"
    EOT
  }
}
```

Bash 라이브러리(`scripts/lib/*.sh`)의 함수를 그대로 재사용하므로, Bash 스크립트와 Terraform이 **동일한 동작(Same Behavior)**을 보장한다.

### DHCP(Dynamic Host Configuration Protocol) IP 해결 패턴(Resolution Pattern)

Tart VM은 DHCP로 IP를 받으므로 사전에 알 수 없음. 해결 방식:

```
1. VM 생성 → tart ip 폴링 → IP 확인
2. .terraform-vm-ips/<vm-name>.ip 파일에 저장
3. 후속 모듈에서 파일 읽기로 IP 참조
```

### `variables.tf` — clusters.json의 HCL 버전

`config/clusters.json`과 동일한 클러스터/노드 정의를 HCL(HashiCorp Configuration Language)로 선언:

```hcl
variable "clusters" {
  type = list(object({
    name         = string
    pod_cidr     = string
    service_cidr = string
    nodes = list(object({
      name   = string
      role   = string
      cpu    = number
      memory = number
      disk   = number
    }))
  }))
}
```

> **주의(Note)**: `clusters.json`과 `variables.tf`는 양쪽 모두 동기화(Sync) 필요.
> BUG-007 (prod-master CPU 1→2)에서 양쪽 파일 수정이 필요했던 사례 참조.

---

## 삭제(Destroy)

```bash
cd terraform
terraform destroy    # 모든 VM + K8s 클러스터 + Helm 릴리스 삭제
```

---

## 참고 링크(References)

- Terraform 공식(Official): https://www.terraform.io/
- Terraform 문서(Docs): https://developer.hashicorp.com/terraform/docs
- HCL(HashiCorp Configuration Language) 문법: https://developer.hashicorp.com/terraform/language
- 상세 설계: [IaC와 자동화 학습 문서](learning/iac-automation.md)
