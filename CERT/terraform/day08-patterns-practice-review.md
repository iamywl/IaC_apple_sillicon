# Day 8: 실전 패턴, 실습, 자가 점검

Multi-Environment 패턴, Zero-Downtime 배포, 실습 가이드(Terraform 기본 명령어, 프로젝트 분석, Console), 자가 점검 문제, 그리고 참고문헌을 다룬다.

---

## Part 19: 실전 패턴

### 19.1 Multi-Environment 아키텍처

이 프로젝트는 하나의 Terraform 설정으로 4개 환경(platform, dev, staging, prod)을 관리한다. `clusters` 변수를 통해 환경별 차이를 표현한다.

```hcl
# 이 프로젝트의 Multi-Environment 패턴 (실제 코드)
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

  default = [
    {
      name         = "platform"
      pod_cidr     = "10.10.0.0/16"
      service_cidr = "10.96.0.0/16"
      nodes = [
        { name = "platform-master",  role = "master", cpu = 2, memory = 4096,  disk = 20 },
        { name = "platform-worker1", role = "worker", cpu = 3, memory = 12288, disk = 20 },
        { name = "platform-worker2", role = "worker", cpu = 2, memory = 8192,  disk = 20 }
      ]
    },
    {
      name         = "dev"
      pod_cidr     = "10.20.0.0/16"
      service_cidr = "10.97.0.0/16"
      nodes = [
        { name = "dev-master",  role = "master", cpu = 2, memory = 4096, disk = 20 },
        { name = "dev-worker1", role = "worker", cpu = 2, memory = 8192, disk = 20 }
      ]
    },
    # staging, prod...
  ]
}
```

이 패턴의 장점은 다음과 같다.
- 하나의 `apply`로 전체 인프라를 관리할 수 있다
- 환경별 차이가 데이터(변수)로 표현되므로 코드 중복이 없다
- `for_each`와 `flatten`으로 모든 노드를 동적으로 생성한다

단점은 다음과 같다.
- 하나의 State에 모든 환경이 포함되어 Blast Radius가 크다
- 특정 환경만 변경하려면 `-target`이 필요하다

#### 대안: 환경별 State 분리

```hcl
# environments/dev/main.tf
module "infra" {
  source = "../../modules/cluster"

  cluster = {
    name         = "dev"
    pod_cidr     = "10.20.0.0/16"
    service_cidr = "10.97.0.0/16"
    nodes = [
      { name = "dev-master",  role = "master", cpu = 2, memory = 4096, disk = 20 },
      { name = "dev-worker1", role = "worker", cpu = 2, memory = 8192, disk = 20 }
    ]
  }
}

# environments/dev/backend.tf
terraform {
  backend "s3" {
    bucket = "terraform-state"
    key    = "dev/terraform.tfstate"
    region = "ap-northeast-2"
  }
}
```

### 19.2 Modular Infrastructure

이 프로젝트의 모듈 구성은 인프라 계층을 반영한다.

```
계층 구조:

┌────────────────────────────────────────────┐
│              main.tf (Root Module)          │
│                                            │
│  ┌──────────────────────────────────────┐  │
│  │        Phase 1: tart-vm              │  │
│  │  null_resource → local_file → output │  │
│  │  (VM 생성)    (IP 기록)   (IP 맵)    │  │
│  └──────────────┬───────────────────────┘  │
│                 │ vm_ips (output)           │
│  ┌──────────────▼───────────────────────┐  │
│  │        Phase 2: k8s-cluster          │  │
│  │  ssh_wait → prepare → kubeadm →     │  │
│  │  init_cluster → cilium/hubble        │  │
│  └──────────────┬───────────────────────┘  │
│                 │ depends_on               │
│  ┌──────────────▼───────────────────────┐  │
│  │        Phase 3: helm-releases        │  │
│  │  prometheus → loki → argocd →       │  │
│  │  jenkins                             │  │
│  └──────────────────────────────────────┘  │
│                                            │
│  ┌──────────────────────────────────────┐  │
│  │        Phase 4: null_resource        │  │
│  │  (dev/staging Helm: metrics-server,  │  │
│  │   Istio)                             │  │
│  └──────────────────────────────────────┘  │
└────────────────────────────────────────────┘
```

모듈 간 데이터 흐름:
1. `tart-vm` 모듈이 VM IP 맵을 output으로 내보낸다
2. `k8s-cluster` 모듈이 VM IP를 input으로 받아 SSH 접속한다
3. `helm-releases` 모듈이 kubeconfig 경로를 받아 Helm Chart를 배포한다
4. Root의 `null_resource`가 추가 스크립트를 실행한다

### 19.3 Zero-Downtime Deployment

```hcl
# 패턴 1: create_before_destroy
resource "aws_instance" "web" {
  ami           = var.ami_id
  instance_type = "t3.micro"

  lifecycle {
    create_before_destroy = true
  }
}

# 패턴 2: Blue-Green with Terraform
variable "active_color" {
  default = "blue"    # "blue" 또는 "green"
}

resource "aws_lb_target_group" "blue" {
  name     = "web-blue"
  port     = 80
  protocol = "HTTP"
}

resource "aws_lb_target_group" "green" {
  name     = "web-green"
  port     = 80
  protocol = "HTTP"
}

resource "aws_lb_listener_rule" "main" {
  listener_arn = aws_lb_listener.main.arn

  action {
    type             = "forward"
    target_group_arn = var.active_color == "blue" ? aws_lb_target_group.blue.arn : aws_lb_target_group.green.arn
  }

  condition {
    path_pattern {
      values = ["/*"]
    }
  }
}

# 배포 과정:
# 1. active_color = "blue" 상태에서 green 인스턴스 생성
# 2. green 인스턴스에 새 버전 배포 및 검증
# 3. active_color = "green"으로 변경하여 apply
# 4. blue 인스턴스 정리

# 패턴 3: Rolling Update (ASG)
resource "aws_autoscaling_group" "web" {
  min_size         = 3
  max_size         = 6
  desired_capacity = 3

  instance_refresh {
    strategy = "Rolling"
    preferences {
      min_healthy_percentage = 66    # 최소 66% 유지
      instance_warmup        = 300   # 5분 워밍업
    }
  }
}
```

#### 이 프로젝트에서의 Zero-Downtime 고려사항

```hcl
# Helm Release의 무중단 업데이트
resource "helm_release" "kube_prometheus_stack" {
  name      = "kube-prometheus-stack"
  chart     = "kube-prometheus-stack"
  namespace = "monitoring"

  # atomic: 실패 시 자동 롤백
  atomic = true

  # wait: 모든 Pod이 Ready 상태가 될 때까지 대기
  wait    = true
  timeout = 600

  # recreate_pods: false (기본값)
  # 변경 시 Pod을 삭제 후 재생성하지 않고 Rolling Update 사용
}
```

---

## 실습 가이드

### 실습 1: Terraform 기본 명령어

```bash
# Terraform 설치
brew install terraform

# 버전 확인
terraform version

# 프로젝트 디렉토리로 이동
cd terraform/

# 초기화 (Provider 다운로드)
terraform init

# 현재 상태 확인
terraform show

# 설정 유효성 검사
terraform validate

# 코드 포맷팅
terraform fmt -recursive

# Plan 실행 (변경사항 미리보기)
terraform plan

# Apply 실행 (실제 적용) - 주의!
terraform apply

# Plan을 파일로 저장 후 적용 (안전한 방법)
terraform plan -out=tfplan
terraform apply tfplan
```

### 실습 2: State 관리

```bash
# State 목록 확인
terraform state list

# 특정 리소스 상태 확인
terraform state show 'module.vms.null_resource.vm_clone["platform-master"]'

# State 새로고침 (실제 인프라와 동기화)
terraform apply -refresh-only

# 리소스를 State에서 제거 (인프라는 유지)
terraform state rm 'module.vms.null_resource.vm_clone["dev-worker1"]'

# State를 다른 Backend로 마이그레이션
terraform init -migrate-state
```

### 실습 3: 변수와 출력

```bash
# 변수 파일 확인
cat variables.tf
cat terraform.tfvars

# 변수 오버라이드
terraform plan -var="base_image=ghcr.io/cirruslabs/ubuntu:22.04"

# 출력값 확인
terraform output
terraform output -json
terraform output vm_ips
terraform output access_urls
```

### 실습 4: 프로젝트 Terraform 코드 분석

```bash
# 메인 설정 파일 분석
cat main.tf

# 모듈 구조 확인
ls modules/
cat modules/tart-vm/main.tf
cat modules/k8s-cluster/main.tf
cat modules/helm-releases/main.tf

# 의존 그래프 생성
terraform graph | dot -Tpng > graph.png

# Plan으로 어떤 리소스가 관리되는지 확인
terraform plan
```

### 실습 5: Workspace 사용

```bash
# 워크스페이스 생성
terraform workspace new dev

# 워크스페이스에서 Plan 실행
terraform plan

# 기본 워크스페이스로 복귀
terraform workspace select default

# 워크스페이스 목록 확인
terraform workspace list
```

### 실습 6: Console과 함수 테스트

```bash
# Terraform Console 시작
terraform console

# 함수 테스트
> upper("hello")
"HELLO"

> flatten([["a", "b"], ["c"]])
["a", "b", "c"]

> cidrsubnet("10.0.0.0/16", 8, 1)
"10.0.1.0/24"

> lookup({a = 1, b = 2}, "a", 0)
1

> formatdate("YYYY-MM-DD", timestamp())
"2026-03-19"

# 프로젝트 변수 확인
> var.clusters[0].name
"platform"

> var.clusters[0].nodes[0].name
"platform-master"

> length(var.clusters)
4

# 종료
> exit
```

### 실습 7: 리소스 그래프 시각화

```bash
# DOT 형식으로 리소스 그래프 출력
terraform graph

# Graphviz로 이미지 생성 (graphviz 설치 필요)
brew install graphviz
terraform graph | dot -Tpng > graph.png
terraform graph | dot -Tsvg > graph.svg

# 특정 모듈의 그래프
terraform graph -target=module.vms | dot -Tpng > vms-graph.png
```

### 실습 8: Import 실습

```bash
# 1. 수동으로 생성된 리소스를 코드에 정의
# (예: 수동으로 생성한 VM을 Terraform 관리로 전환)

# 2. import 블록 작성 (Terraform 1.5+)
cat > import.tf <<'EOF'
import {
  to = null_resource.manual_vm
  id = "manual-vm-id"
}
EOF

# 3. 설정 코드 자동 생성
terraform plan -generate-config-out=generated.tf

# 4. 생성된 코드 검토 및 수정
cat generated.tf

# 5. Plan으로 차이 확인
terraform plan
```

---

## 자가 점검

### IaC 기초
- [ ] Infrastructure as Code의 핵심 원칙 5가지를 설명할 수 있는가?
- [ ] 명령형(Bash)과 선언적(Terraform) 방식의 차이를 설명할 수 있는가?
- [ ] 멱등성(Idempotency)이 왜 IaC에서 중요한지, 그리고 Terraform이 어떻게 멱등성을 구현하는지 설명할 수 있는가?
- [ ] Configuration Drift가 무엇이며, Terraform이 어떻게 감지하는지 설명할 수 있는가?
- [ ] State Reconciliation의 세 가지 전략(코드 우선, 실제 상태 수용, 선택적 무시)을 설명할 수 있는가?

### Terraform 아키텍처
- [ ] Terraform Core의 네 가지 역할 (Config Parsing, State Management, Graph Building, Plan/Apply)을 설명할 수 있는가?
- [ ] Provider가 gRPC로 통신하며, CRUD 연산이 어떻게 매핑되는지 설명할 수 있는가?
- [ ] `terraform init`의 내부 동작 과정을 설명할 수 있는가?
- [ ] DAG 기반 실행 계획과 `-parallelism` 플래그의 관계를 설명할 수 있는가?
- [ ] `.terraform.lock.hcl`의 역할과 `terraform init -upgrade`의 동작을 설명할 수 있는가?

### HCL 심화
- [ ] `for` 표현식의 다양한 패턴(리스트 → 리스트, 맵 → 맵, 필터링, 그룹화)을 사용할 수 있는가?
- [ ] Splat 표현식(`[*]`)의 제약사항과 대안을 알고 있는가?
- [ ] Dynamic block을 사용하여 반복되는 중첩 블록을 생성할 수 있는가?
- [ ] `object`, `optional`, `tuple` 등 Type Constraint를 정확하게 정의할 수 있는가?
- [ ] `try()`, `can()`, `coalesce()` 함수를 활용하여 안전한 표현식을 작성할 수 있는가?

### Provider / Resource / Data Source
- [ ] Provider alias를 사용하여 멀티 리전/멀티 계정 구성을 할 수 있는가?
- [ ] Resource Lifecycle (`create_before_destroy`, `prevent_destroy`, `ignore_changes`, `replace_triggered_by`)을 적절히 사용할 수 있는가?
- [ ] `precondition`과 `postcondition`의 차이, 그리고 `variable validation`과의 차이를 설명할 수 있는가?
- [ ] `null_resource`와 `terraform_data`의 차이를 설명할 수 있는가?
- [ ] `count`와 `for_each`의 장단점과 선택 기준을 설명할 수 있는가?
- [ ] Data Source와 Resource의 차이, Data Source의 실행 시점을 설명할 수 있는가?

### State
- [ ] State 파일의 구조(JSON)와 `serial`, `lineage`의 역할을 설명할 수 있는가?
- [ ] State Locking의 필요성과 DynamoDB를 이용한 잠금 방식을 설명할 수 있는가?
- [ ] State 파일에 민감한 값이 평문으로 저장되는 문제와 대응 방법을 설명할 수 있는가?
- [ ] `terraform state mv`, `rm`, `import`, `replace-provider` 명령을 적절히 사용할 수 있는가?
- [ ] Remote Backend (S3, GCS, Terraform Cloud)의 설정 방법을 알고 있는가?

### Module
- [ ] Module의 다양한 소스(local, registry, GitHub, S3)와 버전 관리를 설명할 수 있는가?
- [ ] Module에 `for_each`를 적용하여 동적으로 생성할 수 있는가?
- [ ] Module Composition 패턴(플랫, 환경별 분리, Terragrunt)의 장단점을 비교할 수 있는가?

### Variables & Outputs
- [ ] 변수 값 전달 우선순위(default → env → tfvars → auto.tfvars → -var-file → -var)를 알고 있는가?
- [ ] Variable validation으로 입력값을 검증할 수 있는가?
- [ ] `sensitive = true`의 효과와 한계(State 평문 저장)를 이해하고 있는가?

### Workspaces & Import
- [ ] CLI Workspace와 Terraform Cloud Workspace의 차이를 설명할 수 있는가?
- [ ] `import` 블록(Terraform 1.5+)과 `-generate-config-out`을 사용할 수 있는가?
- [ ] `moved` 블록의 용도와 `terraform state mv`와의 차이를 설명할 수 있는가?

### Testing & CI/CD
- [ ] `terraform test`(Terraform 1.6+)로 설정을 검증하는 방법을 설명할 수 있는가?
- [ ] Mock Provider를 사용하여 실제 인프라 없이 테스트할 수 있는가?
- [ ] GitHub Actions에서 Terraform Plan/Apply 파이프라인을 구성할 수 있는가?
- [ ] Atlantis의 워크플로우(PR 코멘트 기반 Plan/Apply)를 설명할 수 있는가?

### 보안 & 성능
- [ ] OIDC를 사용하여 장기 자격 증명 없이 클라우드에 인증하는 방법을 설명할 수 있는가?
- [ ] Policy as Code (Sentinel, OPA)로 인프라 정책을 강제하는 방법을 알고 있는가?
- [ ] State Splitting으로 대규모 인프라의 Blast Radius를 줄이는 방법을 설명할 수 있는가?
- [ ] Provider Caching과 Refresh 최적화 방법을 알고 있는가?

### 트러블슈팅 & 실전
- [ ] Dependency Cycle 에러를 분석하고 해결할 수 있는가?
- [ ] State Corruption 시 복구 절차를 알고 있는가?
- [ ] `TF_LOG`를 사용하여 디버그 로그를 분석할 수 있는가?
- [ ] 이 프로젝트의 3단계 오케스트레이션 패턴(VM → K8s → Helm)을 설명할 수 있는가?
- [ ] `flatten`, `for_each`, `locals`를 조합하여 동적 인프라를 구성할 수 있는가?

---

## 참고문헌

### 공식 문서
- [Terraform 공식 문서](https://developer.hashicorp.com/terraform/docs) - Configuration Language, CLI, Provider 등 전체 레퍼런스이다
- [Terraform Language Specification](https://developer.hashicorp.com/terraform/language) - HCL 문법 및 표현식 상세이다
- [Terraform CLI Documentation](https://developer.hashicorp.com/terraform/cli) - CLI 명령어 레퍼런스이다
- [Terraform State 문서](https://developer.hashicorp.com/terraform/language/state) - State 관리 및 Backend 설정이다
- [Terraform Backend Configuration](https://developer.hashicorp.com/terraform/language/backend) - 지원하는 Backend 목록과 설정이다
- [Terraform Import 문서](https://developer.hashicorp.com/terraform/language/import) - import 블록과 설정 자동 생성이다
- [Terraform Test 문서](https://developer.hashicorp.com/terraform/language/tests) - terraform test 프레임워크이다
- [Terraform Module 개발 가이드](https://developer.hashicorp.com/terraform/language/modules/develop) - Module 작성 모범 사례이다
- [Terraform Functions](https://developer.hashicorp.com/terraform/language/functions) - 내장 함수 전체 목록이다

### Provider 관련
- [Terraform Registry](https://registry.terraform.io/) - Provider 및 Module 저장소이다
- [Terraform Provider 개발 문서](https://developer.hashicorp.com/terraform/plugin/framework) - Provider Plugin Framework 가이드이다
- [Tart Terraform Provider](https://registry.terraform.io/providers/cirruslabs/tart/latest/docs) - 이 프로젝트에서 참고하는 Provider이다
- [Helm Provider](https://registry.terraform.io/providers/hashicorp/helm/latest/docs) - 이 프로젝트에서 사용하는 Helm Provider이다
- [Null Provider](https://registry.terraform.io/providers/hashicorp/null/latest/docs) - null_resource를 제공하는 Provider이다

### 소스 코드 & 커뮤니티
- [Terraform GitHub Repository](https://github.com/hashicorp/terraform) - Terraform Core 소스 코드이다
- [OpenTofu](https://opentofu.org/) - Terraform의 오픈소스 포크 (CNCF Sandbox)이다
- [OpenTofu GitHub](https://github.com/opentofu/opentofu) - OpenTofu 소스 코드이다

### 도구 & 생태계
- [Terragrunt](https://terragrunt.gruntwork.io/) - Terraform wrapper 도구이다. DRY 원칙과 멀티 환경 관리이다
- [Terratest](https://terratest.gruntwork.io/) - Go 기반 인프라 테스트 프레임워크이다
- [tflint](https://github.com/terraform-linters/tflint) - Terraform linter이다. 규칙 기반 코드 검사이다
- [Checkov](https://www.checkov.io/) - IaC 보안 스캐너이다. Terraform, CloudFormation 등 지원이다
- [Infracost](https://www.infracost.io/) - Terraform 비용 추정 도구이다
- [Atlantis](https://www.runatlantis.io/) - PR 기반 Terraform 자동화 도구이다
- [Spacelift](https://spacelift.io/) - Terraform 관리 플랫폼이다
- [env0](https://www.env0.com/) - Terraform 자동화 및 거버넌스 플랫폼이다

### 보안 & 정책
- [Sentinel](https://developer.hashicorp.com/sentinel) - HashiCorp의 Policy as Code 프레임워크이다
- [OPA (Open Policy Agent)](https://www.openpolicyagent.org/) - CNCF 졸업 프로젝트, 범용 정책 엔진이다
- [Conftest](https://www.conftest.dev/) - OPA 기반 구성 파일 테스트 도구이다
- [HashiCorp Vault](https://www.vaultproject.io/) - 시크릿 관리 도구이다. Terraform과 통합이다

### 학습 자료
- [Terraform Up & Running (O'Reilly)](https://www.terraformupandrunning.com/) - Yevgeniy Brikman의 Terraform 실전 가이드이다
- [Terraform Best Practices](https://www.terraform-best-practices.com/) - 커뮤니티 기반 모범 사례 모음이다
- [HashiCorp Learn](https://developer.hashicorp.com/terraform/tutorials) - 공식 튜토리얼이다
