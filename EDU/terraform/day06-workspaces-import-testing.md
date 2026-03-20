# Day 6: Workspaces, Import & Migration, Testing

CLI/Cloud Workspaces, Multi-Environment 패턴 비교, terraform import와 import 블록, moved 블록, State Surgery, 그리고 terraform test와 Terratest를 다룬다.

---

## Part 12: Workspaces

### 12.1 CLI Workspaces

동일한 설정을 여러 환경에 적용할 때 사용한다. State를 워크스페이스별로 분리한다.

```bash
# 워크스페이스 목록
terraform workspace list
# * default
#   dev
#   prod

# 새 워크스페이스 생성 및 전환
terraform workspace new dev
terraform workspace new staging
terraform workspace new prod

# 워크스페이스 전환
terraform workspace select dev

# 현재 워크스페이스 확인
terraform workspace show
# dev

# 워크스페이스 삭제
terraform workspace delete staging
```

```hcl
# 워크스페이스 이름을 설정에서 활용
locals {
  env = terraform.workspace    # "dev" 또는 "prod"
}

resource "tart_vm" "worker" {
  name   = "${local.env}-worker-1"
  cpu    = local.env == "prod" ? 4 : 2
  memory = local.env == "prod" ? 8192 : 4096
}

# 워크스페이스별 변수 파일 사용 패턴
# terraform apply -var-file="${terraform.workspace}.tfvars"
```

#### CLI Workspace의 State 저장 구조

```
# Local Backend
terraform.tfstate.d/
├── dev/
│   └── terraform.tfstate
├── staging/
│   └── terraform.tfstate
└── prod/
    └── terraform.tfstate
# default 워크스페이스: terraform.tfstate (루트)

# S3 Backend
s3://my-bucket/
├── env:/dev/terraform.tfstate
├── env:/staging/terraform.tfstate
├── env:/prod/terraform.tfstate
└── terraform.tfstate               # default
```

### 12.2 Terraform Cloud Workspaces

Terraform Cloud의 Workspace는 CLI Workspace와 완전히 다른 개념이다. 독립된 State, 변수, 권한, 실행 환경을 갖춘 관리 단위이다.

```hcl
terraform {
  cloud {
    organization = "my-org"

    workspaces {
      # 이름으로 지정
      name = "tart-infra-prod"

      # 또는 태그로 선택 (여러 Workspace에 적용)
      # tags = ["app:tart-infra", "env:prod"]
    }
  }
}
```

```bash
# Terraform Cloud CLI 로그인
terraform login

# Workspace 목록 (API)
terraform workspace list

# Cloud에서 실행 (Remote Execution)
terraform plan    # Cloud에서 실행되고 결과를 로컬에 스트리밍
terraform apply   # Cloud에서 실행
```

### 12.3 Multi-Environment 패턴 비교

| 패턴 | 장점 | 단점 | 적합한 경우 |
|------|------|------|-----------|
| CLI Workspace | 설정 파일 하나로 관리 | 환경 간 차이 표현 제한적 | 동일 구성의 단순 복제 |
| 디렉토리 분리 | 환경별 완전한 독립 | 코드 중복 | 환경별 구성이 크게 다를 때 |
| tfvars 분리 | 코드는 공유, 변수만 분리 | 구조적 차이 불가 | 변수만 다른 경우 |
| Terragrunt | DRY 원칙 극대화 | 추가 도구 학습 | 대규모 멀티 환경 |
| TF Cloud Workspace | UI, 권한, 정책 | SaaS 의존 | 엔터프라이즈 환경 |

```hcl
# 패턴 1: tfvars 분리
# dev.tfvars
# cpu_count = 2
# memory_mb = 4096
# environment = "dev"
#
# prod.tfvars
# cpu_count = 4
# memory_mb = 8192
# environment = "prod"
#
# terraform apply -var-file="dev.tfvars"

# 패턴 2: 디렉토리 분리 + 공유 모듈
# environments/dev/main.tf
module "infra" {
  source = "../../modules/infra"
  cpu    = 2
  memory = 4096
}
# environments/prod/main.tf
module "infra" {
  source = "../../modules/infra"
  cpu    = 4
  memory = 8192
}

# 패턴 3: Workspace + locals 맵
locals {
  env_config = {
    dev = {
      cpu    = 2
      memory = 4096
    }
    prod = {
      cpu    = 4
      memory = 8192
    }
  }
  config = local.env_config[terraform.workspace]
}

resource "tart_vm" "worker" {
  cpu    = local.config.cpu
  memory = local.config.memory
}
```

---

## Part 13: Import & Migration

### 13.1 terraform import 명령어

이미 존재하는 인프라를 Terraform 관리 하에 가져온다.

```bash
# 1. 먼저 .tf 파일에 빈 리소스 블록을 작성한다
# resource "aws_instance" "web" { }

# 2. import 명령으로 State에 등록한다
terraform import aws_instance.web i-1234567890abcdef0

# 3. terraform plan으로 차이를 확인하고 .tf 코드를 맞춘다
terraform plan
# 차이가 나는 부분을 코드에 반영한다

# Module 내의 리소스 import
terraform import 'module.vms.null_resource.vm_clone["platform-master"]' 1234567890

# for_each 리소스 import
terraform import 'aws_instance.servers["web-1"]' i-1234567890abcdef0
```

### 13.2 import 블록 (Terraform 1.5+)

선언적 방식으로 import할 수 있다. 코드 리뷰와 자동화에 유리하다.

```hcl
import {
  to = aws_instance.web
  id = "i-1234567890abcdef0"
}

resource "aws_instance" "web" {
  ami           = "ami-0123456789abcdef0"
  instance_type = "t3.micro"
  # ... 기존 리소스에 맞게 작성
}
```

#### 설정 자동 생성 (Terraform 1.5+)

`-generate-config-out` 플래그를 사용하면 import 대상의 설정 코드를 자동 생성할 수 있다.

```hcl
# import 블록만 작성한다
import {
  to = aws_instance.web
  id = "i-1234567890abcdef0"
}
```

```bash
# 설정 코드를 자동 생성한다
terraform plan -generate-config-out=generated.tf

# generated.tf에 리소스 설정이 자동 생성된다
# 생성된 코드를 검토하고 필요한 부분을 수정한다
```

#### for_each를 사용한 대량 import (Terraform 1.7+)

```hcl
locals {
  existing_instances = {
    "web-1" = "i-1111111111"
    "web-2" = "i-2222222222"
    "web-3" = "i-3333333333"
  }
}

import {
  for_each = local.existing_instances
  to       = aws_instance.servers[each.key]
  id       = each.value
}

resource "aws_instance" "servers" {
  for_each      = local.existing_instances
  ami           = "ami-0123456789abcdef0"
  instance_type = "t3.micro"
}
```

### 13.3 moved 블록 (Terraform 1.1+)

리소스 이름을 변경하거나 모듈로 이동할 때, State를 깨뜨리지 않고 리팩토링할 수 있다.

```hcl
# 리소스 이름 변경
moved {
  from = tart_vm.worker
  to   = tart_vm.k8s_worker
}

# 모듈 안으로 이동
moved {
  from = tart_vm.worker
  to   = module.cluster.tart_vm.worker
}

# count에서 for_each로 마이그레이션
moved {
  from = tart_vm.worker[0]
  to   = tart_vm.worker["worker-1"]
}

moved {
  from = tart_vm.worker[1]
  to   = tart_vm.worker["worker-2"]
}

# 모듈 이름 변경
moved {
  from = module.old_name
  to   = module.new_name
}
```

`moved` 블록이 없으면 리소스를 삭제 후 재생성하는 것으로 Plan이 나타난다. `moved`를 사용하면 State에서 주소만 변경되므로 인프라에 영향이 없다.

`moved` 블록은 적용 후에도 코드에 남겨두는 것이 안전하다. 오래된 State를 가진 환경에서도 마이그레이션이 동작하기 때문이다. 정리할 때는 모든 환경에 적용된 것을 확인한 후 제거한다.

### 13.4 State Surgery

State를 직접 조작하는 것은 위험하지만, 특수한 상황에서 필요할 수 있다.

```bash
# 시나리오 1: 리소스를 Terraform 관리에서 제외 (인프라는 유지)
terraform state rm 'aws_instance.legacy'
# State에서만 제거되고 실제 인스턴스는 삭제되지 않는다
# 이후 해당 리소스는 Terraform이 추적하지 않는다

# 시나리오 2: State 백업 및 복원
terraform state pull > backup.tfstate
# ... 작업 수행 ...
terraform state push backup.tfstate  # 복원 (위험: serial 충돌 가능)

# 시나리오 3: 다른 State로 리소스 이동
# (State A에서 제거 → State B에서 import)
cd project-a/
terraform state rm 'module.network.aws_vpc.main'

cd ../project-b/
terraform import 'aws_vpc.main' 'vpc-12345'

# 시나리오 4: Provider 교체 (Terraform → OpenTofu 마이그레이션 등)
terraform state replace-provider \
  'registry.terraform.io/hashicorp/aws' \
  'registry.opentofu.org/hashicorp/aws'

# 시나리오 5: 삭제된 리소스의 State 정리
# 실제 인프라가 이미 삭제되었지만 State에 남아있을 때
terraform state rm 'aws_instance.deleted'
# 또는 terraform refresh로 State를 실제 상태와 동기화
terraform apply -refresh-only
```

---

## Part 14: Testing

### 14.1 terraform test (Terraform 1.6+)

`terraform test` 명령으로 Terraform 설정을 검증할 수 있다. 테스트 파일은 `.tftest.hcl` 확장자를 사용한다.

```hcl
# tests/vm.tftest.hcl

# 변수 설정
variables {
  cpu_count = 2
  memory_mb = 4096
}

# Plan 단계에서 검증 (인프라 생성 없음)
run "verify_plan" {
  command = plan

  assert {
    condition     = tart_vm.worker[0].cpu == 2
    error_message = "CPU 수가 올바르지 않다."
  }
}

# Apply 후 검증 (실제 인프라 생성 후 자동 정리)
run "verify_apply" {
  command = apply

  assert {
    condition     = tart_vm.worker[0].ip != ""
    error_message = "VM에 IP가 할당되어야 한다."
  }
}

# Module 테스트
run "test_module" {
  command = plan

  module {
    source = "./modules/tart-vm"
  }

  variables {
    clusters = [{
      name         = "test"
      pod_cidr     = "10.10.0.0/16"
      service_cidr = "10.96.0.0/16"
      nodes = [
        { name = "test-master", role = "master", cpu = 2, memory = 4096, disk = 20 }
      ]
    }]
    base_image   = "ghcr.io/cirruslabs/ubuntu:latest"
    project_root = "/tmp/test"
  }

  assert {
    condition     = length(keys(local.node_map)) == 1
    error_message = "노드 맵에 1개의 노드가 있어야 한다."
  }
}
```

```bash
# 테스트 실행
terraform test

# 특정 테스트 파일만 실행
terraform test -filter=tests/vm.tftest.hcl

# 상세 출력
terraform test -verbose

# JSON 출력 (CI/CD 통합용)
terraform test -json
```

### 14.2 Mock과 Override

Terraform 1.7+부터 테스트에서 Provider를 mock할 수 있다.

```hcl
# tests/mock_test.tftest.hcl

# Provider mock: 실제 API를 호출하지 않는다
mock_provider "aws" {
  mock_resource "aws_instance" {
    defaults = {
      id         = "i-mock123"
      public_ip  = "1.2.3.4"
      private_ip = "10.0.0.1"
    }
  }

  mock_data "aws_ami" {
    defaults = {
      id           = "ami-mock123"
      architecture = "x86_64"
    }
  }
}

run "test_with_mock" {
  command = apply

  assert {
    condition     = aws_instance.web.id == "i-mock123"
    error_message = "Mock 인스턴스 ID가 올바르지 않다."
  }
}

# Override: 특정 리소스/데이터의 값을 강제 지정
override_resource {
  target = aws_instance.web
  values = {
    id        = "i-override123"
    public_ip = "5.6.7.8"
  }
}

override_data {
  target = data.aws_ami.ubuntu
  values = {
    id = "ami-override123"
  }
}
```

### 14.3 Terratest (Go 기반)

Terratest는 Gruntwork에서 개발한 Go 기반 테스트 프레임워크이다. 실제 인프라를 생성하고 테스트한 후 정리한다.

```go
// tests/vm_test.go
package test

import (
    "testing"
    "github.com/gruntwork-io/terratest/modules/terraform"
    "github.com/stretchr/testify/assert"
)

func TestVMCreation(t *testing.T) {
    t.Parallel()

    terraformOptions := terraform.WithDefaultRetryableErrors(t, &terraform.Options{
        TerraformDir: "../terraform",
        Vars: map[string]interface{}{
            "project_root": "/tmp/test",
            "clusters": []map[string]interface{}{
                {
                    "name":         "test",
                    "pod_cidr":     "10.10.0.0/16",
                    "service_cidr": "10.96.0.0/16",
                    "nodes": []map[string]interface{}{
                        {"name": "test-master", "role": "master", "cpu": 2, "memory": 4096, "disk": 20},
                    },
                },
            },
        },
    })

    // 테스트 완료 후 인프라 정리
    defer terraform.Destroy(t, terraformOptions)

    // Apply
    terraform.InitAndApply(t, terraformOptions)

    // Output 검증
    vmIPs := terraform.OutputMap(t, terraformOptions, "vm_ips")
    assert.Contains(t, vmIPs, "test-master")
    assert.NotEmpty(t, vmIPs["test-master"])
}
```

```bash
# Terratest 실행
cd tests/
go test -v -timeout 30m
```

### 14.4 Unit vs Integration Testing 전략

```
테스트 피라미드:

         ▲
        / \
       / E2E \         # 전체 인프라 배포 + 애플리케이션 테스트
      /       \        # Terratest + 실제 환경
     ───────────
    / Integration \    # 모듈 Apply + 리소스 검증
   /               \   # terraform test (command = apply)
  ───────────────────
 /      Unit          \ # Plan 검증 + 변수/로직 테스트
/                       \ # terraform test (command = plan) + mock
─────────────────────────

비용: E2E > Integration > Unit
속도: Unit > Integration > E2E
```

| 테스트 레벨 | 도구 | 실행 시간 | 인프라 생성 | 적용 대상 |
|-----------|------|---------|-----------|---------|
| Static | `terraform validate`, `tflint` | 초 | 없음 | 문법, 타입, 규칙 |
| Unit | `terraform test` (plan) | 초~분 | 없음 | 로직, 변수 검증 |
| Contract | `terraform test` (mock) | 초~분 | 없음 | 입출력 계약 |
| Integration | `terraform test` (apply) | 분~시간 | 있음 (자동 정리) | 모듈 동작 |
| E2E | Terratest | 시간 | 있음 | 전체 시스템 |

---

