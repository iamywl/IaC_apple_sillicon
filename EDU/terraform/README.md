# Terraform - Infrastructure as Code

## 개념

### Terraform이란?
- HashiCorp이 개발한 선언적 IaC(Infrastructure as Code) 도구이다
- HCL(HashiCorp Configuration Language)로 인프라를 정의한다
- Provider를 통해 다양한 인프라를 관리한다 (AWS, GCP, Azure, Tart 등)
- State 파일로 현재 인프라 상태를 추적한다
- BSL(Business Source License) 1.1로 라이선스가 변경되었다 (v1.5.6 이후)
- 오픈소스 포크인 OpenTofu(CNCF Sandbox)가 존재한다

### 핵심 개념
| 개념 | 설명 |
|------|------|
| Provider | 인프라 API와 통신하는 플러그인이다 (aws, tart 등) |
| Resource | 관리할 인프라 요소이다 (VM, 네트워크, 저장소 등) |
| Data Source | 외부에서 읽어오는 읽기 전용 데이터이다 |
| State | 현재 인프라 상태를 기록한 파일이다 (terraform.tfstate) |
| Plan | 변경사항을 미리 확인하는 단계이다 |
| Module | 재사용 가능한 인프라 코드 패키지이다 |
| Variable | 설정값을 외부에서 주입할 수 있는 변수이다 |
| Output | 다른 모듈이나 사용자에게 값을 출력한다 |
| Backend | State를 저장하는 위치를 결정하는 설정이다 |
| Provisioner | 리소스 생성 후 스크립트를 실행하는 기능이다 (deprecated) |
| 멱등성 | 같은 코드를 여러 번 실행해도 동일한 결과를 보장하는 성질이다 |

### 명령형 vs 선언적
```
명령형 (Bash):
  1. VM이 있는지 확인
  2. 없으면 생성
  3. 설정 변경
  4. 에러 처리
  → "어떻게(HOW)" 기술

선언적 (Terraform):
  resource "tart_vm" "node" {
    name   = "worker-1"
    cpu    = 2
    memory = 4096
  }
  → "무엇(WHAT)"만 기술 → Terraform이 HOW를 처리
```

---

### 이 프로젝트에서의 실습 환경

이 프로젝트 전체가 Terraform으로 관리된다.

```
프로젝트 Terraform 구조:
terraform/
├── main.tf              ← 3단계 오케스트레이션 (VM → K8s → Helm)
├── variables.tf         ← 클러스터 설정 변수
├── providers.tf         ← Provider 정의 (null, helm, local)
├── outputs.tf           ← VM IP, kubeconfig, 접근 URL 출력
└── modules/
    ├── tart-vm/         ← Phase 1: Tart VM 생성/관리
    ├── k8s-cluster/     ← Phase 2: kubeadm 클러스터 구축
    └── helm-releases/   ← Phase 3: 모니터링/CI-CD Helm 배포
```

```bash
# Terraform 상태 확인
cd terraform
terraform plan
terraform output

# 특정 모듈만 적용
terraform apply -target=module.tart_vms
```

---

## 아키텍처

### Terraform Core 구조
```
┌─────────────────────────────────────────────────────────────────┐
│                       Terraform CLI                             │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                    Terraform Core                          │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌─────────────────┐  │ │
│  │  │ Config Parser │  │ State Manager│  │ Graph Builder   │  │ │
│  │  │ (HCL → AST)  │  │ (Read/Write) │  │ (DAG 생성)      │  │ │
│  │  └──────┬───────┘  └──────┬───────┘  └────────┬────────┘  │ │
│  │         └─────────┬───────┘                    │           │ │
│  │              ┌────▼────┐              ┌────────▼────────┐  │ │
│  │              │ Diff    │              │ Walk (DAG 순회)  │  │ │
│  │              │ Engine  │◄────────────►│ Parallel Execute │  │ │
│  │              └────┬────┘              └─────────────────┘  │ │
│  │                   │                                        │ │
│  │              ┌────▼────┐                                   │ │
│  │              │Plan/Apply│                                  │ │
│  │              └────┬────┘                                   │ │
│  └───────────────────┼────────────────────────────────────────┘ │
│                      │ gRPC (go-plugin)                         │
│  ┌───────────────────▼────────────────────────────────────────┐ │
│  │                   Providers                                │ │
│  │  ┌─────────┐  ┌─────────┐  ┌──────────┐  ┌────────────┐  │ │
│  │  │  AWS    │  │  GCP    │  │  Azure   │  │  Tart      │  │ │
│  │  │Provider │  │Provider │  │Provider  │  │ Provider   │  │ │
│  │  └────┬────┘  └────┬────┘  └─────┬────┘  └─────┬──────┘  │ │
│  └───────┼────────────┼─────────────┼──────────────┼─────────┘ │
│          ▼            ▼             ▼              ▼            │
│     AWS API      GCP API      Azure API      Tart CLI          │
└─────────────────────────────────────────────────────────────────┘
```

Terraform Core는 크게 네 가지 역할을 수행한다.

1. **Config Parsing**: `.tf` 파일(HCL)을 파싱하여 내부 구조체로 변환한다
2. **State Management**: State 파일을 읽고 쓰며, 실제 인프라와 코드 사이의 매핑을 유지한다
3. **Graph Building**: 리소스 간 의존관계를 DAG(Directed Acyclic Graph)로 구성한다
4. **Plan/Apply**: 현재 State와 원하는 설정의 차이(diff)를 계산하고, Provider를 통해 변경을 적용한다

### Provider 내부 동작
Provider는 Terraform Core와 별도의 프로세스로 실행되며, gRPC(go-plugin 프레임워크)를 통해 통신한다. Provider는 다음 CRUD 연산을 구현한다.

| Provider 연산 | Terraform 동작 | 설명 |
|--------------|---------------|------|
| Create | `terraform apply` (신규) | 새로운 리소스를 생성한다 |
| Read | `terraform refresh` / `plan` | 리소스의 현재 상태를 읽어온다 |
| Update | `terraform apply` (변경) | 기존 리소스를 수정한다 (in-place 또는 replace) |
| Delete | `terraform destroy` | 리소스를 삭제한다 |

Provider는 자체적으로 Schema를 정의한다. Schema에는 각 리소스의 속성(attribute), 타입, 필수 여부, 기본값, 계산 여부(Computed) 등이 포함된다. Terraform Core는 이 Schema를 기반으로 설정값을 검증한다.

```hcl
# Provider 버전 제약 조건
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"     # >= 5.0.0, < 6.0.0
    }
    tart = {
      source  = "cirruslabs/tart"
      version = ">= 0.3"
    }
  }
}
```

버전 제약 연산자는 다음과 같다.
- `= 1.0.0`: 정확히 해당 버전이다
- `>= 1.0.0`: 해당 버전 이상이다
- `~> 1.0`: 최소 1.0 이상, 2.0 미만이다 (pessimistic constraint)
- `>= 1.0, < 2.0`: 범위를 직접 지정한다

### Provisioner (deprecated)
Provisioner는 리소스 생성 후 스크립트를 실행하는 기능이다. `local-exec`, `remote-exec`, `file` 등이 존재한다. 그러나 HashiCorp은 Provisioner 사용을 권장하지 않으며 deprecated로 분류하였다. 그 이유는 다음과 같다.

1. **멱등성 미보장**: Provisioner는 Plan에 나타나지 않으며, 실패 시 부분적으로 적용된 상태가 된다
2. **State 불일치**: Provisioner의 실행 결과가 State에 기록되지 않는다
3. **대안 존재**: cloud-init, Packer, Ansible 등 전용 도구가 더 적합하다

```hcl
# Provisioner 예제 (권장하지 않음)
resource "tart_vm" "example" {
  name = "example"
  # ...

  # 대신 cloud-init이나 user_data를 사용하는 것이 좋다
  provisioner "local-exec" {
    command = "echo ${self.ip} >> hosts.txt"
  }
}
```

---

## 워크플로우

### 기본 워크플로우
```
┌──────────┐     ┌──────────┐     ┌──────────┐
│  Write   │────►│  Plan    │────►│  Apply   │
│  (.tf)   │     │(변경 미리 │     │(실제 적용)│
│          │     │  확인)    │     │          │
└──────────┘     └──────────┘     └──────────┘
                       │
                       ▼
                 ┌──────────┐
                 │  State   │  ← 현재 상태 기록
                 │ (.tfstate)│
                 └──────────┘
```

### 실행 계획 (Execution Plan) 상세
Terraform의 Plan/Apply는 DAG(Directed Acyclic Graph) 기반으로 동작한다.

```
1. Configuration Loading
   └─► .tf 파일 파싱 + 변수 바인딩

2. State Refresh (기본 동작)
   └─► 모든 리소스에 대해 Provider Read 호출
   └─► 실제 인프라 상태를 State에 반영
   └─► -refresh=false 플래그로 생략 가능

3. Graph Construction
   └─► 리소스 간 의존 관계를 DAG로 구성
   └─► 암시적 의존: 표현식 내 참조 (예: aws_instance.x.id)
   └─► 명시적 의존: depends_on 속성

4. Diff Calculation
   └─► Config(원하는 상태) vs State(현재 상태) 비교
   └─► 각 리소스별 create / update / destroy / no-op 결정

5. Walk & Apply
   └─► DAG를 위상 정렬(topological sort)하여 순서 결정
   └─► 독립적인 리소스는 병렬 실행 (-parallelism=N, 기본값 10)
   └─► 의존성이 있는 리소스는 순서대로 실행
```

```bash
# 병렬 처리 수 조정
terraform apply -parallelism=20    # 동시에 20개 리소스 처리
terraform apply -parallelism=1     # 디버깅 시 순차 처리

# Refresh 생략 (대규모 인프라에서 속도 향상)
terraform plan -refresh=false

# Plan 결과를 파일로 저장 후 적용
terraform plan -out=tfplan
terraform apply tfplan
```

---

## State 심층 분석

### State 파일 구조
State 파일(`terraform.tfstate`)은 JSON 형식이며, Terraform이 관리하는 모든 리소스의 현재 상태를 기록한다.

```json
{
  "version": 4,
  "terraform_version": "1.9.0",
  "serial": 42,
  "lineage": "a1b2c3d4-e5f6-...",
  "outputs": {
    "vm_ip": {
      "value": "192.168.64.10",
      "type": "string"
    }
  },
  "resources": [
    {
      "mode": "managed",
      "type": "tart_vm",
      "name": "worker",
      "provider": "provider[\"registry.terraform.io/cirruslabs/tart\"]",
      "instances": [
        {
          "index_key": 0,
          "schema_version": 0,
          "attributes": {
            "id": "worker-1",
            "name": "worker-1",
            "cpu": 2,
            "memory": 4096,
            "ip": "192.168.64.10"
          }
        }
      ]
    }
  ]
}
```

주요 필드 설명은 다음과 같다.
- `version`: State 파일 형식 버전이다 (현재 4)
- `serial`: State가 변경될 때마다 증가하는 일련번호이다. 동시 변경 감지에 사용한다
- `lineage`: State의 고유 식별자이다. 다른 환경의 State를 실수로 덮어쓰는 것을 방지한다
- `resources[].mode`: `managed`(resource)와 `data`(data source) 두 종류이다

### State Locking
여러 사용자가 동시에 `terraform apply`를 실행하면 State가 손상될 수 있다. State Locking은 이를 방지한다.

| Backend | Locking 방식 | 설명 |
|---------|-------------|------|
| local | 파일 시스템 lock | `.terraform.tfstate.lock.info` 파일이다 |
| S3 | DynamoDB 테이블 | LockID를 키로 사용한다 |
| GCS | 객체 잠금 | GCS의 native locking이다 |
| Azure Blob | Blob Lease | lease 기반 잠금이다 |
| Consul | KV lock | Consul의 세션 기반 잠금이다 |
| pg (PostgreSQL) | Advisory Lock | PostgreSQL advisory lock이다 |

```hcl
# S3 Backend + DynamoDB Locking 설정 예제
terraform {
  backend "s3" {
    bucket         = "my-terraform-state"
    key            = "prod/terraform.tfstate"
    region         = "ap-northeast-2"
    dynamodb_table = "terraform-locks"
    encrypt        = true
  }
}
```

### Remote Backend
State를 팀과 공유하려면 Remote Backend를 사용한다.

| Backend | 특징 |
|---------|------|
| S3 | AWS 환경에서 가장 보편적이다. 버전 관리 + 암호화 지원이다 |
| GCS | GCP 환경에서 사용한다. 객체 버전 관리를 지원한다 |
| Azure Blob | Azure 환경에서 사용한다 |
| Terraform Cloud | HashiCorp의 SaaS이다. State 관리 + 실행 환경 + 정책 관리를 제공한다 |
| pg (PostgreSQL) | RDBMS 기반 Backend이다. 자체 호스팅 환경에 적합하다 |
| Consul | HashiCorp Consul KV를 Backend로 사용한다 |

### State 보안 주의사항
State 파일에는 **민감한 값(password, secret key 등)이 평문으로 저장**된다. 이는 Terraform의 알려진 한계이다.

대응 방법은 다음과 같다.
1. **Backend 암호화**: S3의 `encrypt = true`, GCS의 기본 암호화 등을 사용한다
2. **State 접근 제어**: IAM 정책으로 State 파일 접근을 제한한다
3. **Git에 커밋 금지**: `.gitignore`에 `*.tfstate`와 `*.tfstate.*`를 반드시 추가한다
4. **sensitive 표시**: `sensitive = true`로 표시하면 CLI 출력에서 마스킹되지만, State 파일에는 여전히 평문으로 저장된다

```hcl
variable "db_password" {
  type      = string
  sensitive = true    # plan/apply 출력에서 마스킹된다
}

output "password" {
  value     = var.db_password
  sensitive = true    # output 명령에서 마스킹된다
}
```

---

## Resource Lifecycle

### lifecycle 블록
리소스의 생성, 수정, 삭제 동작을 세밀하게 제어할 수 있다.

```hcl
resource "tart_vm" "worker" {
  name   = "worker-1"
  cpu    = 2
  memory = 4096

  lifecycle {
    # 1. create_before_destroy
    #    리소스 교체 시 새 리소스를 먼저 생성한 후 기존 리소스를 삭제한다
    #    다운타임을 최소화할 때 사용한다
    create_before_destroy = true

    # 2. prevent_destroy
    #    실수로 리소스를 삭제하는 것을 방지한다
    #    terraform destroy 시 에러가 발생한다
    prevent_destroy = true

    # 3. ignore_changes
    #    특정 속성의 변경을 무시한다
    #    외부에서 수동으로 변경하는 값이 있을 때 사용한다
    ignore_changes = [
      tags,          # tags 변경 무시
      # all          # 모든 변경 무시 (주석 해제하여 사용)
    ]

    # 4. replace_triggered_by (Terraform 1.2+)
    #    지정한 리소스나 속성이 변경되면 이 리소스를 교체한다
    replace_triggered_by = [
      null_resource.trigger.id
    ]
  }
}
```

### Precondition / Postcondition (Terraform 1.2+)
리소스에 대한 사전/사후 검증 조건을 정의할 수 있다.

```hcl
resource "tart_vm" "worker" {
  name   = "worker-1"
  cpu    = var.cpu_count
  memory = var.memory_mb

  lifecycle {
    # Apply 전에 검증한다
    precondition {
      condition     = var.cpu_count >= 2
      error_message = "CPU 코어 수는 최소 2개 이상이어야 한다."
    }

    # Apply 후에 검증한다
    postcondition {
      condition     = self.ip != ""
      error_message = "VM에 IP가 할당되지 않았다."
    }
  }
}
```

---

## Data Source

Data Source는 Resource와 달리 인프라를 생성하거나 관리하지 않는다. 기존에 존재하는 리소스나 외부 데이터를 **읽기 전용**으로 조회한다.

```hcl
# Resource: Terraform이 생성하고 관리한다
resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}

# Data Source: 이미 존재하는 리소스를 읽어온다
data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"]    # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-*"]
  }
}

# Data Source 값을 Resource에서 참조한다
resource "aws_instance" "web" {
  ami           = data.aws_ami.ubuntu.id
  instance_type = "t3.micro"
  subnet_id     = aws_vpc.main.id
}
```

Data Source를 사용하는 경우는 다음과 같다.
- 다른 팀이 관리하는 리소스(VPC, AMI 등)를 참조할 때
- 외부 데이터(DNS, IAM 정책 등)를 조회할 때
- 계정 정보(`aws_caller_identity`)나 리전 정보(`aws_region`)를 조회할 때

---

## Module 심층 분석

### Module 소스
Module은 다양한 소스에서 가져올 수 있다.

```hcl
# 1. 로컬 경로
module "vm" {
  source = "./modules/vm"
}

# 2. Terraform Registry
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "5.0.0"
}

# 3. GitHub
module "network" {
  source = "github.com/example/terraform-modules//network?ref=v1.0.0"
}

# 4. S3 Bucket
module "config" {
  source = "s3::https://s3-ap-northeast-2.amazonaws.com/my-bucket/modules/config.zip"
}

# 5. GCS Bucket
module "storage" {
  source = "gcs::https://www.googleapis.com/storage/v1/modules/storage.zip"
}
```

### Module 버전 관리
Registry 기반 모듈은 `version` 제약 조건을 지정할 수 있다.

```hcl
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.0"     # >= 5.0.0, < 6.0.0

  # 모듈 입력 변수
  name = "my-vpc"
  cidr = "10.0.0.0/16"
}
```

### for_each와 Module
Terraform 0.13+부터 `for_each`를 모듈에 적용할 수 있다.

```hcl
variable "environments" {
  default = {
    dev  = { cpu = 2, memory = 4096 }
    prod = { cpu = 4, memory = 8192 }
  }
}

module "vm" {
  source   = "./modules/vm"
  for_each = var.environments

  name   = each.key
  cpu    = each.value.cpu
  memory = each.value.memory
}

# 특정 환경의 출력값 참조
output "prod_ip" {
  value = module.vm["prod"].ip
}
```

### Module 구성 패턴 (Composition)
```
# 플랫 모듈 구조 (단순한 프로젝트)
terraform/
├── main.tf
├── variables.tf
├── outputs.tf
└── modules/
    ├── vm/
    └── network/

# 환경별 분리 구조 (대규모 프로젝트)
terraform/
├── modules/              # 재사용 모듈
│   ├── vm/
│   ├── network/
│   └── kubernetes/
├── environments/
│   ├── dev/
│   │   ├── main.tf       # module "vm" { source = "../../modules/vm" }
│   │   └── terraform.tfvars
│   └── prod/
│       ├── main.tf
│       └── terraform.tfvars
```

---

## 표현식 (Expressions)

### for 표현식
```hcl
# 리스트 → 리스트 변환
variable "names" {
  default = ["worker-1", "worker-2", "worker-3"]
}

locals {
  upper_names = [for name in var.names : upper(name)]
  # 결과: ["WORKER-1", "WORKER-2", "WORKER-3"]
}

# 맵 → 맵 변환
variable "vms" {
  default = {
    web  = { cpu = 2 }
    db   = { cpu = 4 }
  }
}

locals {
  vm_descriptions = { for k, v in var.vms : k => "CPU: ${v.cpu}" }
  # 결과: { web = "CPU: 2", db = "CPU: 4" }
}

# 필터링 (if 절)
locals {
  high_cpu_vms = { for k, v in var.vms : k => v if v.cpu >= 4 }
  # 결과: { db = { cpu = 4 } }
}
```

### Splat 표현식
```hcl
# [*]는 for 표현식의 축약이다
output "all_ips" {
  value = tart_vm.worker[*].ip
  # 위와 동일: [for vm in tart_vm.worker : vm.ip]
}
```

### Dynamic Block
반복되는 중첩 블록을 동적으로 생성한다.

```hcl
variable "ingress_rules" {
  default = [
    { port = 80, description = "HTTP" },
    { port = 443, description = "HTTPS" },
    { port = 8080, description = "Alt HTTP" },
  ]
}

resource "aws_security_group" "web" {
  name = "web-sg"

  dynamic "ingress" {
    for_each = var.ingress_rules
    content {
      from_port   = ingress.value.port
      to_port     = ingress.value.port
      protocol    = "tcp"
      cidr_blocks = ["0.0.0.0/0"]
      description = ingress.value.description
    }
  }
}
```

### 조건 표현식과 타입 제약
```hcl
# 조건 표현식
locals {
  instance_type = var.environment == "prod" ? "m5.xlarge" : "t3.micro"
}

# 타입 제약 (type constraints)
variable "config" {
  type = object({
    name    = string
    cpu     = number
    tags    = map(string)
    enabled = optional(bool, true)     # optional (Terraform 1.3+)
  })
}

# Validation Block
variable "cpu_count" {
  type    = number
  default = 2

  validation {
    condition     = var.cpu_count >= 1 && var.cpu_count <= 16
    error_message = "CPU 수는 1~16 사이여야 한다."
  }

  validation {
    condition     = var.cpu_count == floor(var.cpu_count)
    error_message = "CPU 수는 정수여야 한다."
  }
}
```

---

## Workspace

### CLI Workspace
동일한 설정을 여러 환경에 적용할 때 사용한다. State를 워크스페이스별로 분리한다.

```bash
# 워크스페이스 목록
terraform workspace list

# 새 워크스페이스 생성 및 전환
terraform workspace new dev
terraform workspace new prod

# 워크스페이스 전환
terraform workspace select dev

# 현재 워크스페이스 확인
terraform workspace show
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
```

### CLI Workspace vs Terraform Cloud Workspace
| 구분 | CLI Workspace | Terraform Cloud Workspace |
|------|-------------|--------------------------|
| State 저장 | 동일 Backend 내 경로 분리이다 | 각 Workspace가 독립 State이다 |
| 변수 관리 | `.tfvars` 파일을 별도로 관리한다 | UI/API로 변수를 설정한다 |
| 실행 환경 | 로컬 머신이다 | Cloud에서 실행한다 (Remote Execution) |
| 접근 제어 | Backend 수준이다 | 세분화된 팀/사용자 권한이다 |
| 용도 | 소규모 팀, 간단한 환경 분리이다 | 대규모 팀, 거버넌스가 필요한 경우이다 |

---

## Import

### terraform import 명령어 (기존 방식)
이미 존재하는 인프라를 Terraform 관리 하에 가져온다.

```bash
# 1. 먼저 .tf 파일에 빈 리소스 블록을 작성한다
# 2. import 명령으로 State에 등록한다
terraform import aws_instance.web i-1234567890abcdef0

# 3. terraform plan으로 차이를 확인하고 .tf 코드를 맞춘다
terraform plan
```

### import 블록 (Terraform 1.5+)
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

### 설정 자동 생성 (Terraform 1.5+)
`-generate-config-out` 플래그를 사용하면 import 대상의 설정 코드를 자동 생성할 수 있다.

```bash
# import 블록만 작성한 후 설정 코드를 자동 생성한다
terraform plan -generate-config-out=generated.tf
```

---

## Moved Block (Terraform 1.1+)

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
```

`moved` 블록이 없으면 리소스를 삭제 후 재생성하는 것으로 Plan이 나타난다. `moved`를 사용하면 State에서 주소만 변경되므로 인프라에 영향이 없다.

---

## Testing (Terraform 1.6+)

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
```

```bash
# 테스트 실행
terraform test

# 특정 테스트 파일만 실행
terraform test -filter=tests/vm.tftest.hcl

# 상세 출력
terraform test -verbose
```

---

## 이 프로젝트의 Terraform 구조
```
terraform/
├── main.tf           # Tart Provider 설정
├── variables.tf      # 변수 정의
├── outputs.tf        # 출력값 정의
├── terraform.tfvars  # 변수값 설정
└── modules/
    ├── vm/           # VM 생성 모듈
    ├── network/      # 네트워크 설정 모듈
    └── kubernetes/   # K8s 초기화 모듈
```

---

## 실습

### 실습 1: Terraform 기본 명령어
```bash
# Terraform 설치
brew install terraform

# 버전 확인
terraform version

# 프로젝트 디렉토리로 이동
cd ../../terraform/

# 초기화 (Provider 다운로드)
terraform init

# 현재 상태 확인
terraform show

# Plan 실행 (변경사항 미리보기)
terraform plan

# Apply 실행 (실제 적용) - 주의!
terraform apply
```

### 실습 2: State 관리
```bash
# State 목록 확인
terraform state list

# 특정 리소스 상태 확인
terraform state show tart_vm.worker_1

# State 새로고침 (실제 인프라와 동기화)
terraform refresh

# 리소스를 State에서 제거 (인프라는 유지)
terraform state rm tart_vm.test

# State를 다른 Backend로 마이그레이션
terraform init -migrate-state
```

### 실습 3: 변수와 출력
```bash
# 변수 파일 확인
cat variables.tf
cat terraform.tfvars

# 변수 오버라이드
terraform plan -var="cpu_count=4"

# 출력값 확인
terraform output
terraform output -json
```

### 실습 4: 프로젝트 Terraform 코드 분석
```bash
# 메인 설정 파일 분석
cat ../../terraform/main.tf

# 모듈 구조 확인
ls ../../terraform/modules/

# Plan으로 어떤 리소스가 관리되는지 확인
cd ../../terraform && terraform plan
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

### 실습 6: 리소스 그래프 시각화
```bash
# DOT 형식으로 리소스 그래프 출력
terraform graph

# Graphviz로 이미지 생성 (graphviz 설치 필요)
terraform graph | dot -Tpng > graph.png
```

---

## 예제

### 예제 1: 기본 Terraform 코드
```hcl
# main.tf
terraform {
  required_version = ">= 1.5"

  required_providers {
    tart = {
      source  = "cirruslabs/tart"
      version = ">= 0.3"
    }
  }
}

provider "tart" {}

# VM 리소스 정의
resource "tart_vm" "worker" {
  count  = 2
  name   = "worker-${count.index + 1}"
  image  = "ghcr.io/cirruslabs/ubuntu:latest"
  cpu    = var.cpu_count
  memory = var.memory_mb

  disk {
    size = var.disk_gb
  }
}

# variables.tf
variable "cpu_count" {
  description = "VM CPU 코어 수"
  type        = number
  default     = 2
}

variable "memory_mb" {
  description = "VM 메모리 (MB)"
  type        = number
  default     = 4096
}

variable "disk_gb" {
  description = "VM 디스크 크기 (GB)"
  type        = number
  default     = 20
}

# outputs.tf
output "vm_ips" {
  description = "생성된 VM들의 IP 주소"
  value       = tart_vm.worker[*].ip
}
```

### 예제 2: 모듈 사용
```hcl
# modules/vm/main.tf
variable "name" {}
variable "cpu" { default = 2 }
variable "memory" { default = 4096 }

resource "tart_vm" "this" {
  name   = var.name
  image  = "ghcr.io/cirruslabs/ubuntu:latest"
  cpu    = var.cpu
  memory = var.memory
}

output "ip" {
  value = tart_vm.this.ip
}

# main.tf (모듈 호출)
module "master" {
  source = "./modules/vm"
  name   = "master"
  cpu    = 2
  memory = 4096
}

module "workers" {
  source   = "./modules/vm"
  count    = 3
  name     = "worker-${count.index + 1}"
  cpu      = 2
  memory   = 4096
}

output "master_ip" {
  value = module.master.ip
}

output "worker_ips" {
  value = module.workers[*].ip
}
```

### 예제 3: Bash vs Terraform 비교
```bash
# Bash (명령형) - 30줄
#!/bin/bash
for i in 1 2 3; do
  if ! tart list | grep -q "worker-$i"; then
    tart clone ghcr.io/cirruslabs/ubuntu:latest "worker-$i"
    tart set "worker-$i" --cpu 2 --memory 4096
    tart run --no-graphics "worker-$i" &
  else
    echo "worker-$i already exists"
    CURRENT_CPU=$(tart get "worker-$i" --cpu)
    if [ "$CURRENT_CPU" != "2" ]; then
      tart stop "worker-$i"
      tart set "worker-$i" --cpu 2
      tart run --no-graphics "worker-$i" &
    fi
  fi
done
```

```hcl
# Terraform (선언적) - 10줄
resource "tart_vm" "worker" {
  count  = 3
  name   = "worker-${count.index + 1}"
  image  = "ghcr.io/cirruslabs/ubuntu:latest"
  cpu    = 2
  memory = 4096
}
# 존재 여부 확인, 에러 처리 → Terraform이 알아서 처리
```

---

## 자가 점검
- [ ] 명령형(Bash)과 선언적(Terraform) 방식의 차이를 설명할 수 있는가?
- [ ] `terraform init → plan → apply` 워크플로우를 설명할 수 있는가?
- [ ] Terraform Core의 역할 (Config Parsing, State Management, Graph Building, Plan/Apply)을 설명할 수 있는가?
- [ ] Provider가 gRPC로 통신하며, CRUD 연산이 어떻게 매핑되는지 설명할 수 있는가?
- [ ] State 파일의 구조(JSON)와 `serial`, `lineage`의 역할을 설명할 수 있는가?
- [ ] State Locking의 필요성과 DynamoDB를 이용한 잠금 방식을 설명할 수 있는가?
- [ ] State 파일에 민감한 값이 평문으로 저장되는 문제와 대응 방법을 설명할 수 있는가?
- [ ] DAG 기반 실행 계획과 `-parallelism` 플래그를 설명할 수 있는가?
- [ ] Resource Lifecycle (`create_before_destroy`, `prevent_destroy`, `ignore_changes`)을 설명할 수 있는가?
- [ ] Data Source와 Resource의 차이를 설명할 수 있는가?
- [ ] Module의 다양한 소스(local, registry, GitHub, S3)와 `for_each` 활용을 설명할 수 있는가?
- [ ] `for` 표현식, splat 표현식, dynamic block을 사용할 수 있는가?
- [ ] CLI Workspace와 Terraform Cloud Workspace의 차이를 설명할 수 있는가?
- [ ] `import` 블록(Terraform 1.5+)과 `moved` 블록의 용도를 설명할 수 있는가?
- [ ] `terraform test`(Terraform 1.6+)로 설정을 검증하는 방법을 설명할 수 있는가?
- [ ] 멱등성(Idempotency)이 왜 IaC에서 중요한지 설명할 수 있는가?

---

## 참고문헌
- [Terraform 공식 문서](https://developer.hashicorp.com/terraform/docs) - Configuration Language, CLI, Provider 등 전체 레퍼런스이다
- [Terraform GitHub Repository](https://github.com/hashicorp/terraform) - Terraform Core 소스 코드이다
- [Terraform Registry](https://registry.terraform.io/) - Provider 및 Module 저장소이다
- [Terraform Provider 개발 문서](https://developer.hashicorp.com/terraform/plugin/framework) - Provider Plugin Framework 가이드이다
- [Terraform Language Specification](https://developer.hashicorp.com/terraform/language) - HCL 문법 및 표현식 상세이다
- [Terraform State 문서](https://developer.hashicorp.com/terraform/language/state) - State 관리 및 Backend 설정이다
- [Terraform Backend Configuration](https://developer.hashicorp.com/terraform/language/backend) - 지원하는 Backend 목록과 설정이다
- [Terraform Import 문서](https://developer.hashicorp.com/terraform/language/import) - import 블록과 설정 자동 생성이다
- [Terraform Test 문서](https://developer.hashicorp.com/terraform/language/tests) - terraform test 프레임워크이다
- [Terraform Module 개발 가이드](https://developer.hashicorp.com/terraform/language/modules/develop) - Module 작성 모범 사례이다
- [Tart Terraform Provider](https://registry.terraform.io/providers/cirruslabs/tart/latest/docs) - 이 프로젝트에서 사용하는 Provider이다
