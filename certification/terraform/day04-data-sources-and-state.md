# Day 4: Data Sources와 State 심화

Data Source 기본과 의존성, external Data Source, Remote Backend 설정, State Locking, State 보안, State 조작 명령어를 다룬다.

---

## Part 7: Data Sources

### 7.1 Data Source 기본

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

#### 이 프로젝트의 Data Source 활용

```hcl
# terraform/modules/tart-vm/main.tf (실제 코드)
# 파일에 저장된 VM IP를 Data Source로 읽어온다
data "local_file" "vm_ips" {
  for_each = local.node_map

  depends_on = [null_resource.vm_wait_ip]

  filename = "${var.project_root}/.terraform-vm-ips/${each.key}.ip"
}

# Output으로 전달
output "vm_ips" {
  value = {
    for vm_name, file_data in data.local_file.vm_ips :
    vm_name => trimspace(file_data.content)
  }
}
```

이 패턴은 `null_resource`가 파일에 IP를 기록하고, `data "local_file"`이 해당 파일을 읽는 구조이다. Data Source이므로 Plan 시점에 값을 사용할 수 있다.

Data Source를 사용하는 주요 경우는 다음과 같다.
- 다른 팀이 관리하는 리소스(VPC, AMI 등)를 참조할 때
- 외부 데이터(DNS, IAM 정책 등)를 조회할 때
- 계정 정보(`aws_caller_identity`)나 리전 정보(`aws_region`)를 조회할 때
- 다른 Terraform State의 output을 참조할 때 (`terraform_remote_state`)

### 7.2 의존성과 실행 시점

Data Source는 기본적으로 Plan 단계에서 읽기가 실행된다. 그러나 Data Source가 아직 생성되지 않은 리소스에 의존하면 Apply 시점까지 읽기가 지연된다.

```hcl
# 시나리오 1: 독립적인 Data Source → Plan 시점에 읽기
data "aws_availability_zones" "available" {
  state = "available"
}
# Plan 시점에 AZ 목록이 확인된다

# 시나리오 2: 리소스에 의존하는 Data Source → Apply 시점에 읽기
resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}

data "aws_subnets" "main" {
  filter {
    name   = "vpc-id"
    values = [aws_vpc.main.id]  # VPC가 생성된 후에야 ID를 알 수 있다
  }
}
# Apply 시점에 서브넷 목록이 확인된다 (Plan에서는 (known after apply))
```

### 7.3 external Data Source

`external` Data Source는 외부 프로그램을 실행하여 JSON 형식의 데이터를 반환한다. Terraform이 지원하지 않는 데이터를 조회할 때 사용한다.

```hcl
# 외부 스크립트를 실행하여 데이터를 조회한다
data "external" "vm_info" {
  program = ["bash", "${path.module}/scripts/get_vm_info.sh"]

  query = {
    vm_name = "platform-master"
  }
}

# scripts/get_vm_info.sh
# #!/bin/bash
# eval "$(jq -r '@sh "VM_NAME=\(.vm_name)"')"
# IP=$(tart ip "$VM_NAME" 2>/dev/null || echo "unknown")
# CPU=$(tart get "$VM_NAME" --cpu 2>/dev/null || echo "0")
# jq -n --arg ip "$IP" --arg cpu "$CPU" '{"ip": $ip, "cpu": $cpu}'

output "vm_ip" {
  value = data.external.vm_info.result.ip
}
```

주의사항은 다음과 같다.
- 프로그램은 stdin으로 JSON을 받고, stdout으로 JSON을 반환해야 한다
- 반환값은 `map(string)` 타입이다 (모든 값이 문자열)
- 프로그램이 비결정적이면 매 Plan마다 결과가 달라질 수 있다
- stderr 출력은 Terraform의 로그에 포함된다

#### terraform_remote_state

다른 Terraform 프로젝트의 State에서 output 값을 읽어온다. 대규모 인프라에서 State를 분리할 때 필수적이다.

```hcl
# 네트워크 팀이 관리하는 State에서 VPC 정보를 읽어온다
data "terraform_remote_state" "network" {
  backend = "s3"
  config = {
    bucket = "terraform-state"
    key    = "network/terraform.tfstate"
    region = "ap-northeast-2"
  }
}

# 참조
resource "aws_instance" "web" {
  subnet_id = data.terraform_remote_state.network.outputs.subnet_id
}
```

---

## Part 8: State 심화

### 8.1 State 파일 구조

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
      "module": "module.vms",
      "mode": "managed",
      "type": "null_resource",
      "name": "vm_clone",
      "provider": "provider[\"registry.terraform.io/hashicorp/null\"]",
      "instances": [
        {
          "index_key": "platform-master",
          "schema_version": 0,
          "attributes": {
            "id": "1234567890",
            "triggers": {
              "vm_name": "platform-master",
              "base_image": "ghcr.io/cirruslabs/ubuntu:latest",
              "cpu": "2",
              "memory": "4096"
            }
          }
        },
        {
          "index_key": "platform-worker1",
          "schema_version": 0,
          "attributes": {
            "id": "1234567891",
            "triggers": {
              "vm_name": "platform-worker1",
              "cpu": "3",
              "memory": "12288"
            }
          }
        }
      ]
    },
    {
      "module": "module.vms",
      "mode": "data",
      "type": "local_file",
      "name": "vm_ips",
      "provider": "provider[\"registry.terraform.io/hashicorp/local\"]",
      "instances": [
        {
          "index_key": "platform-master",
          "attributes": {
            "content": "192.168.64.10",
            "filename": "/Users/ywlee/tart-infra/.terraform-vm-ips/platform-master.ip"
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
- `resources[].module`: 모듈 경로이다 (예: `module.vms`)
- `resources[].instances[].index_key`: `for_each`의 키 또는 `count`의 인덱스이다

### 8.2 Remote Backend 설정

State를 팀과 공유하려면 Remote Backend를 사용한다.

#### S3 Backend (AWS)

```hcl
terraform {
  backend "s3" {
    bucket         = "my-terraform-state"
    key            = "prod/terraform.tfstate"
    region         = "ap-northeast-2"
    dynamodb_table = "terraform-locks"    # State Locking
    encrypt        = true                  # 서버 측 암호화
    kms_key_id     = "arn:aws:kms:..."    # KMS 키 (선택)

    # 교차 계정 접근
    # role_arn     = "arn:aws:iam::123456789012:role/TerraformState"
  }
}
```

S3 Backend를 위한 인프라 설정은 다음과 같다.

```hcl
# bootstrap/main.tf - State Backend 인프라 자체는 별도로 관리한다
resource "aws_s3_bucket" "state" {
  bucket = "my-terraform-state"
}

resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id
  versioning_configuration {
    status = "Enabled"    # State 파일 버전 관리
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_dynamodb_table" "locks" {
  name         = "terraform-locks"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }
}
```

#### GCS Backend (GCP)

```hcl
terraform {
  backend "gcs" {
    bucket = "my-terraform-state"
    prefix = "prod"
  }
}
```

#### Terraform Cloud Backend

```hcl
terraform {
  cloud {
    organization = "my-org"

    workspaces {
      name = "my-workspace"
      # 또는 태그 기반 선택
      # tags = ["app:web", "env:prod"]
    }
  }
}
```

#### PostgreSQL Backend

```hcl
terraform {
  backend "pg" {
    conn_str = "postgres://user:pass@db.example.com/terraform_backend"
  }
}
```

| Backend | 특징 |
|---------|------|
| local | 기본값이다. 개인 개발 환경에 적합하다 |
| S3 | AWS 환경에서 가장 보편적이다. 버전 관리 + 암호화 + DynamoDB 잠금이다 |
| GCS | GCP 환경에서 사용한다. 객체 버전 관리 + 네이티브 잠금이다 |
| Azure Blob | Azure 환경에서 사용한다. Blob Lease 기반 잠금이다 |
| Terraform Cloud | HashiCorp의 SaaS이다. State 관리 + 실행 환경 + 정책 관리이다 |
| pg (PostgreSQL) | RDBMS 기반이다. 자체 호스팅 환경에 적합하다 |
| Consul | HashiCorp Consul KV를 사용한다. Session 기반 잠금이다 |
| cos (Tencent Cloud) | Tencent Cloud Object Storage이다 |
| http | 임의의 REST API endpoint를 Backend로 사용한다 |

### 8.3 State Locking

여러 사용자가 동시에 `terraform apply`를 실행하면 State가 손상될 수 있다. State Locking은 이를 방지한다.

```
State Locking 동작 과정:

1. terraform apply 시작
   └─► Backend.Lock() 호출
   └─► Lock 정보 기록: Who, Operation, Created, Path

2. Lock 획득 성공
   └─► Plan + Apply 진행
   └─► State 파일 쓰기

3. Lock 획득 실패 (다른 사용자가 이미 Lock 보유)
   └─► "Error acquiring the state lock" 에러
   └─► 다른 작업이 완료될 때까지 대기 또는 수동 해제

4. Apply 완료
   └─► Backend.Unlock() 호출
   └─► Lock 정보 삭제
```

```bash
# Lock이 걸려있을 때 강제 해제 (주의: 데이터 손실 가능)
terraform force-unlock <LOCK_ID>

# Lock 정보 확인 (S3 Backend + DynamoDB)
aws dynamodb get-item \
  --table-name terraform-locks \
  --key '{"LockID": {"S": "my-terraform-state/prod/terraform.tfstate"}}'
```

| Backend | Locking 방식 | 설명 |
|---------|-------------|------|
| local | 파일 시스템 lock | `.terraform.tfstate.lock.info` 파일이다 |
| S3 | DynamoDB 테이블 | LockID를 키로 사용한다 |
| GCS | 객체 잠금 | GCS의 native locking이다 |
| Azure Blob | Blob Lease | lease 기반 잠금이다 |
| Consul | KV lock | Consul의 세션 기반 잠금이다 |
| pg (PostgreSQL) | Advisory Lock | PostgreSQL advisory lock이다 |

### 8.4 State 보안

State 파일에는 **민감한 값(password, secret key 등)이 평문으로 저장**된다. 이는 Terraform의 알려진 한계이다.

```json
// State에 저장되는 민감 정보 예시
{
  "resources": [{
    "type": "aws_db_instance",
    "instances": [{
      "attributes": {
        "password": "my-secret-password-in-plaintext",
        "endpoint": "mydb.xxxxx.rds.amazonaws.com:3306"
      }
    }]
  }]
}
```

대응 방법은 다음과 같다.

1. **Backend 암호화**: S3의 `encrypt = true`, GCS의 기본 암호화 등을 사용한다
2. **State 접근 제어**: IAM 정책으로 State 파일 접근을 제한한다
3. **Git에 커밋 금지**: `.gitignore`에 `*.tfstate`와 `*.tfstate.*`를 반드시 추가한다
4. **sensitive 표시**: `sensitive = true`로 표시하면 CLI 출력에서 마스킹되지만, State 파일에는 여전히 평문으로 저장된다

```hcl
# sensitive 변수
variable "db_password" {
  type      = string
  sensitive = true    # plan/apply 출력에서 (sensitive value)로 마스킹된다
}

# sensitive output
output "password" {
  value     = var.db_password
  sensitive = true    # terraform output 명령에서 마스킹된다
}

# sensitive 함수 (Terraform 1.4+)
locals {
  connection_string = sensitive("postgresql://admin:${var.password}@host:5432/db")
  # 이 값을 참조하는 모든 곳에서 마스킹된다
}
```

```gitignore
# .gitignore에 반드시 추가
*.tfstate
*.tfstate.*
*.tfvars          # 민감한 변수가 포함될 수 있다
.terraform/       # Provider 바이너리
crash.log         # 에러 로그에 민감 정보 포함 가능
```

### 8.5 State 조작 명령어

```bash
# State 리소스 목록 확인
terraform state list
# module.vms.null_resource.pull_base_image
# module.vms.null_resource.vm_clone["platform-master"]
# module.vms.null_resource.vm_clone["platform-worker1"]
# module.vms.data.local_file.vm_ips["platform-master"]
# ...

# 특정 리소스 상태 상세 확인
terraform state show 'module.vms.null_resource.vm_clone["platform-master"]'

# 리소스를 State에서 제거 (인프라는 유지, Terraform 관리에서 빠짐)
terraform state rm 'module.vms.null_resource.vm_clone["dev-worker1"]'

# 리소스 주소 변경 (이름 변경 또는 모듈 이동)
terraform state mv 'null_resource.old_name' 'null_resource.new_name'
terraform state mv 'null_resource.vm' 'module.vms.null_resource.vm'

# 외부 리소스를 State에 등록 (import)
terraform import 'aws_instance.web' 'i-1234567890abcdef0'

# State 새로고침 (실제 인프라와 동기화)
terraform refresh    # deprecated
terraform apply -refresh-only  # 권장 방법 (Plan 확인 후 적용)

# State를 다른 Backend로 마이그레이션
terraform init -migrate-state

# Provider 교체 (포크 마이그레이션 등)
terraform state replace-provider 'hashicorp/aws' 'registry.example.com/custom/aws'

# State 전체를 stdout에 JSON으로 출력
terraform state pull

# 외부에서 수정한 State를 업로드 (위험: 직접 수정은 최후의 수단)
terraform state push modified.tfstate
```

#### State Surgery 시나리오

```bash
# 시나리오 1: 모듈로 리팩토링
# 기존: resource "null_resource" "vm" { ... }
# 변경: module "vms" { ... } 내부로 이동

# moved 블록 (선호)
# moved {
#   from = null_resource.vm
#   to   = module.vms.null_resource.vm
# }

# 또는 state mv
terraform state mv 'null_resource.vm' 'module.vms.null_resource.vm'

# 시나리오 2: count → for_each 마이그레이션
terraform state mv 'null_resource.vm[0]' 'null_resource.vm["worker-1"]'
terraform state mv 'null_resource.vm[1]' 'null_resource.vm["worker-2"]'

# 시나리오 3: State 파일 분리 (하나의 State를 두 개로 분리)
# 1. 원본 State에서 리소스 제거
terraform state rm 'module.network'
# 2. 새 디렉토리에서 import
cd network/
terraform import 'aws_vpc.main' 'vpc-12345'
```

---

