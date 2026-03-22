# Day 3: Provider와 Resource 심화

Provider 설정과 버전 제약, Provider Alias, Resource Lifecycle(create_before_destroy, prevent_destroy, ignore_changes), Precondition/Postcondition, Provisioners, count vs for_each를 다룬다.

---

## Part 5: Provider 심화

### 5.1 Provider 설정과 버전 제약

```hcl
# terraform 블록에서 required_providers를 선언한다
terraform {
  required_version = ">= 1.5"

  required_providers {
    # 이 프로젝트에서 사용하는 Provider들
    null = {
      source  = "hashicorp/null"
      version = "~> 3.2"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.12"
    }
    local = {
      source  = "hashicorp/local"
      version = "~> 2.4"
    }

    # AWS Provider 예제
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0, < 6.0"
    }

    # 커뮤니티 Provider 예제
    tart = {
      source  = "cirruslabs/tart"
      version = ">= 0.3"
    }
  }
}

# Provider 설정 블록
provider "aws" {
  region  = "ap-northeast-2"
  profile = "my-profile"

  # 기본 태그 (모든 리소스에 자동 적용)
  default_tags {
    tags = {
      Project     = "tart-infra"
      ManagedBy   = "terraform"
      Environment = var.environment
    }
  }
}

# 이 프로젝트의 Helm Provider 설정 (실제 코드)
provider "helm" {
  kubernetes {
    config_path = "${local.kubeconfig_dir}/platform.yaml"
  }
}
```

### 5.2 Provider Alias

동일한 Provider를 여러 설정으로 사용할 때 alias를 지정한다. 멀티 리전, 멀티 계정 구성에서 필수적이다.

```hcl
# 기본 Provider (alias 없음)
provider "aws" {
  region = "ap-northeast-2"
}

# 별도의 리전을 위한 alias Provider
provider "aws" {
  alias  = "us_east"
  region = "us-east-1"
}

# 별도의 계정을 위한 alias Provider
provider "aws" {
  alias  = "production"
  region = "ap-northeast-2"
  assume_role {
    role_arn = "arn:aws:iam::123456789012:role/TerraformRole"
  }
}

# alias Provider를 리소스에서 사용
resource "aws_s3_bucket" "logs" {
  provider = aws.us_east     # us-east-1 리전에 생성
  bucket   = "my-logs-bucket"
}

# Module에 alias Provider 전달
module "cdn" {
  source = "./modules/cdn"

  providers = {
    aws           = aws             # 기본 Provider
    aws.us_east_1 = aws.us_east     # alias Provider 전달
  }
}

# 멀티 클러스터 Helm 예제 (이 프로젝트 확장 패턴)
provider "helm" {
  alias = "dev"
  kubernetes {
    config_path = "${local.kubeconfig_dir}/dev.yaml"
  }
}

provider "helm" {
  alias = "staging"
  kubernetes {
    config_path = "${local.kubeconfig_dir}/staging.yaml"
  }
}

resource "helm_release" "metrics_server_dev" {
  provider = helm.dev
  name     = "metrics-server"
  chart    = "metrics-server"
}
```

### 5.3 Provider 개발 기초 (Plugin Framework)

Terraform Provider는 Go 언어로 작성하며, HashiCorp의 Plugin Framework를 사용한다. 기존의 SDKv2는 유지보수 모드이며, 신규 개발은 Plugin Framework를 권장한다.

```go
// Provider의 기본 구조 (Go)
package provider

import (
    "context"
    "github.com/hashicorp/terraform-plugin-framework/datasource"
    "github.com/hashicorp/terraform-plugin-framework/provider"
    "github.com/hashicorp/terraform-plugin-framework/resource"
)

// Provider 정의
type ExampleProvider struct {
    version string
}

func (p *ExampleProvider) Metadata(ctx context.Context,
    req provider.MetadataRequest, resp *provider.MetadataResponse) {
    resp.TypeName = "example"
    resp.Version = p.version
}

func (p *ExampleProvider) Schema(ctx context.Context,
    req provider.SchemaRequest, resp *provider.SchemaResponse) {
    resp.Schema = schema.Schema{
        Attributes: map[string]schema.Attribute{
            "api_key": schema.StringAttribute{
                Optional:  true,
                Sensitive: true,
            },
        },
    }
}

func (p *ExampleProvider) Resources(ctx context.Context) []func() resource.Resource {
    return []func() resource.Resource{
        NewVMResource,       // resource "example_vm"
        NewNetworkResource,  // resource "example_network"
    }
}

func (p *ExampleProvider) DataSources(ctx context.Context) []func() datasource.DataSource {
    return []func() datasource.DataSource{
        NewVMDataSource,     // data "example_vm"
    }
}
```

```go
// Resource의 CRUD 구현 (간략화)
type VMResource struct {
    client *api.Client
}

func (r *VMResource) Create(ctx context.Context,
    req resource.CreateRequest, resp *resource.CreateResponse) {
    // 1. Plan에서 원하는 상태를 읽는다
    var plan VMModel
    diags := req.Plan.Get(ctx, &plan)
    resp.Diagnostics.Append(diags...)

    // 2. API를 호출하여 리소스를 생성한다
    vm, err := r.client.CreateVM(plan.Name, plan.CPU, plan.Memory)
    if err != nil {
        resp.Diagnostics.AddError("Failed to create VM", err.Error())
        return
    }

    // 3. 생성된 리소스의 상태를 State에 저장한다
    state := VMModel{
        ID:     vm.ID,
        Name:   vm.Name,
        CPU:    vm.CPU,
        Memory: vm.Memory,
        IP:     vm.IP,
    }
    diags = resp.State.Set(ctx, &state)
    resp.Diagnostics.Append(diags...)
}

func (r *VMResource) Read(ctx context.Context,
    req resource.ReadRequest, resp *resource.ReadResponse) {
    // State에서 현재 ID를 읽어 API로 조회한다
    // 리소스가 삭제되었으면 resp.State.RemoveResource(ctx)를 호출한다
}

func (r *VMResource) Update(ctx context.Context,
    req resource.UpdateRequest, resp *resource.UpdateResponse) {
    // Plan과 State를 비교하여 변경된 속성만 API로 업데이트한다
}

func (r *VMResource) Delete(ctx context.Context,
    req resource.DeleteRequest, resp *resource.DeleteResponse) {
    // API를 호출하여 리소스를 삭제한다
}
```

Provider 개발 후에는 Terraform Registry에 등록하거나, 로컬에서 개발용으로 사용할 수 있다.

```bash
# 로컬 Provider 개발 시 ~/.terraformrc 설정
cat > ~/.terraformrc <<EOF
provider_installation {
  dev_overrides {
    "example.com/myorg/myprovider" = "/path/to/go/bin"
  }
  direct {}
}
EOF
```

---

## Part 6: Resource 심화

### 6.1 Resource Lifecycle

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
    #
    #    기본 동작: destroy → create
    #    CBD 동작:  create(new) → update references → destroy(old)
    create_before_destroy = true

    # 2. prevent_destroy
    #    실수로 리소스를 삭제하는 것을 방지한다
    #    terraform destroy 시 에러가 발생한다
    #    데이터베이스, S3 버킷 등 중요 리소스에 사용한다
    prevent_destroy = true

    # 3. ignore_changes
    #    특정 속성의 변경을 무시한다
    #    외부에서 수동으로 변경하는 값이 있을 때 사용한다
    ignore_changes = [
      tags,          # tags 변경 무시
      # all          # 모든 변경 무시
    ]

    # 4. replace_triggered_by (Terraform 1.2+)
    #    지정한 리소스나 속성이 변경되면 이 리소스를 교체한다
    replace_triggered_by = [
      null_resource.trigger.id
    ]
  }
}
```

#### create_before_destroy 심화

```
기본 replace 동작:
1. destroy(old resource) ← 여기서 다운타임 발생
2. create(new resource)
3. 참조 업데이트

create_before_destroy = true:
1. create(new resource) ← 새 리소스가 먼저 준비됨
2. 참조를 새 리소스로 업데이트
3. destroy(old resource)

주의사항:
- 이름 충돌: 리소스 이름이 unique해야 하는 경우 (예: VM 이름)
  → 임시로 이름을 생성하는 로직이 필요할 수 있다
- 비용: 잠시 동안 두 리소스가 동시에 존재하므로 비용이 발생한다
- 전파: create_before_destroy가 설정된 리소스에 의존하는 리소스도
  자동으로 create_before_destroy가 적용된다
```

#### ignore_changes 활용 패턴

```hcl
# 패턴 1: Auto Scaling에 의한 변경 무시
resource "aws_autoscaling_group" "web" {
  min_size         = 2
  max_size         = 10
  desired_capacity = 4

  lifecycle {
    ignore_changes = [desired_capacity]
    # Auto Scaling 정책에 의해 desired_capacity가 변경되어도
    # Terraform이 4로 되돌리지 않는다
  }
}

# 패턴 2: 외부 시스템이 관리하는 태그 무시
resource "aws_instance" "web" {
  tags = { Name = "web-server" }

  lifecycle {
    ignore_changes = [tags["LastModifiedBy"]]
    # 모니터링 시스템이 추가하는 태그를 무시한다
  }
}

# 패턴 3: 모든 변경 무시 (Terraform 외부에서 전적으로 관리)
resource "aws_instance" "legacy" {
  lifecycle {
    ignore_changes = all
    # 이 리소스는 Terraform이 생성만 하고, 이후 변경을 추적하지 않는다
  }
}
```

### 6.2 Precondition / Postcondition

Terraform 1.2부터 리소스에 대한 사전/사후 검증 조건을 정의할 수 있다. `validation`이 변수 수준의 검증이라면, `precondition/postcondition`은 리소스 수준의 검증이다.

```hcl
resource "tart_vm" "worker" {
  name   = "worker-1"
  cpu    = var.cpu_count
  memory = var.memory_mb

  lifecycle {
    # Apply 전에 검증한다 (Plan 시점)
    precondition {
      condition     = var.cpu_count >= 2
      error_message = "CPU 코어 수는 최소 2개 이상이어야 한다."
    }

    precondition {
      condition     = var.memory_mb >= 2048
      error_message = "메모리는 최소 2048MB 이상이어야 한다."
    }

    # Apply 후에 검증한다 (리소스 생성/수정 직후)
    postcondition {
      condition     = self.ip != ""
      error_message = "VM에 IP가 할당되지 않았다."
    }

    postcondition {
      condition     = self.status == "running"
      error_message = "VM이 running 상태가 아니다."
    }
  }
}

# Data Source에서의 postcondition 활용
data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"]

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-*"]
  }

  lifecycle {
    postcondition {
      condition     = self.architecture == "x86_64"
      error_message = "AMI는 x86_64 아키텍처여야 한다."
    }
  }
}
```

#### precondition vs validation 비교

| 특성 | variable validation | precondition |
|------|-------------------|--------------|
| 적용 대상 | variable 블록 | resource/data 블록 |
| 검증 시점 | Plan 초기 (변수 평가 시) | Plan 중 (리소스 평가 시) |
| 참조 가능 대상 | 해당 변수만 | 다른 리소스, data source, locals 등 |
| 사용 예 | "포트 번호는 1-65535" | "서브넷이 존재하는가" |

### 6.3 Provisioners

Provisioner는 리소스 생성 후 스크립트를 실행하는 기능이다. `local-exec`, `remote-exec`, `file` 등이 존재한다. 그러나 HashiCorp은 Provisioner 사용을 권장하지 않으며 deprecated로 분류하였다. 그 이유는 다음과 같다.

1. **멱등성 미보장**: Provisioner는 Plan에 나타나지 않으며, 실패 시 부분적으로 적용된 상태가 된다
2. **State 불일치**: Provisioner의 실행 결과가 State에 기록되지 않는다
3. **대안 존재**: cloud-init, Packer, Ansible 등 전용 도구가 더 적합하다

```hcl
# local-exec: 로컬 머신에서 명령을 실행한다
resource "null_resource" "example" {
  provisioner "local-exec" {
    command     = "echo ${self.triggers.name}"
    interpreter = ["bash", "-c"]           # 기본값은 시스템 셸
    working_dir = "/tmp"                   # 작업 디렉토리
    environment = {                        # 환경변수
      VM_NAME = "worker-1"
    }
  }
}

# remote-exec: 원격 서버에서 명령을 실행한다
resource "aws_instance" "web" {
  # ...

  provisioner "remote-exec" {
    inline = [
      "sudo apt-get update",
      "sudo apt-get install -y nginx",
    ]

    connection {
      type        = "ssh"
      user        = "ubuntu"
      private_key = file("~/.ssh/id_rsa")
      host        = self.public_ip
    }
  }
}

# file: 로컬 파일을 원격 서버로 복사한다
resource "aws_instance" "web" {
  provisioner "file" {
    source      = "conf/app.conf"
    destination = "/etc/app/app.conf"

    connection {
      type     = "ssh"
      user     = "ubuntu"
      host     = self.public_ip
    }
  }
}

# destroy-time provisioner
resource "null_resource" "cleanup" {
  provisioner "local-exec" {
    when    = destroy                # 리소스 삭제 시 실행
    command = "echo 'Cleaning up ${self.triggers.name}'"
  }
}

# on_failure 설정
resource "null_resource" "risky" {
  provisioner "local-exec" {
    command    = "some-risky-command"
    on_failure = continue    # 실패해도 계속 진행 (기본값: fail)
  }
}
```

#### 이 프로젝트의 Provisioner 활용 패턴

이 프로젝트에서는 Tart VM 관리에 `null_resource` + `local-exec`를 적극적으로 사용한다. 공식 Terraform Provider 대신 CLI를 직접 호출하는 패턴이다.

```hcl
# terraform/modules/tart-vm/main.tf (실제 코드에서 발췌)
resource "null_resource" "vm_clone" {
  for_each = local.node_map

  # triggers: 이 값들이 변경되면 리소스를 재생성(destroy+create)한다
  triggers = {
    vm_name    = each.key
    base_image = var.base_image
    cpu        = each.value.cpu
    memory     = each.value.memory
  }

  # 생성 시: tart clone + tart set
  provisioner "local-exec" {
    command = <<-EOT
      if ! tart list | grep -q "local.*${each.key}"; then
        tart clone "${var.base_image}" "${each.key}"
      fi
      tart set "${each.key}" --cpu ${each.value.cpu} --memory ${each.value.memory}
    EOT
  }

  # 삭제 시: tart stop + tart delete
  provisioner "local-exec" {
    when    = destroy
    command = <<-EOT
      tart stop "${self.triggers.vm_name}" 2>/dev/null || true
      sleep 2
      if tart list | grep -q "local.*${self.triggers.vm_name}"; then
        tart delete "${self.triggers.vm_name}"
      fi
    EOT
  }
}
```

### 6.4 null_resource와 terraform_data

#### null_resource

`null_resource`는 hashicorp/null Provider가 제공하는 리소스이다. 실제 인프라를 생성하지 않으며, `triggers`와 `provisioner`를 결합하여 셸 스크립트 실행을 관리한다.

```hcl
# triggers가 변경되면 리소스를 재생성한다 (destroy + create)
resource "null_resource" "rebuild" {
  triggers = {
    # 이 값이 변경될 때마다 provisioner가 다시 실행된다
    config_hash = md5(file("${path.module}/config.yaml"))
  }

  provisioner "local-exec" {
    command = "apply-config.sh"
  }
}

# always run: 항상 실행되는 패턴 (timestamp는 매번 변경)
resource "null_resource" "always" {
  triggers = {
    always_run = timestamp()
  }

  provisioner "local-exec" {
    command = "echo 'This runs every apply'"
  }
}
```

#### terraform_data (Terraform 1.4+)

`terraform_data`는 `null_resource`의 내장 대체재이다. hashicorp/null Provider가 필요 없다.

```hcl
# null_resource 대신 terraform_data 사용
resource "terraform_data" "rebuild" {
  triggers_replace = [
    md5(file("${path.module}/config.yaml"))
  ]

  provisioner "local-exec" {
    command = "apply-config.sh"
  }
}

# 값 저장 용도 (input → output)
resource "terraform_data" "version" {
  input = "v1.2.3"
}

output "app_version" {
  value = terraform_data.version.output  # "v1.2.3"
}
```

| 비교 | null_resource | terraform_data |
|------|--------------|----------------|
| Provider | hashicorp/null (외부) | 내장 (Provider 불필요) |
| Terraform 버전 | 모든 버전 | 1.4+ |
| 트리거 | `triggers` (map) | `triggers_replace` (list) |
| 값 저장 | 불가 | `input`/`output` 지원 |

### 6.5 count vs for_each

```hcl
# count: 인덱스 기반. 단순 반복에 적합하다
resource "tart_vm" "worker" {
  count  = 3
  name   = "worker-${count.index + 1}"
  cpu    = 2
  memory = 4096
}
# 참조: tart_vm.worker[0], tart_vm.worker[1], tart_vm.worker[2]

# count의 문제점: 중간 요소 삭제 시 인덱스가 밀린다
# worker-1, worker-2, worker-3에서 worker-2를 삭제하면
# worker-3의 인덱스가 2→1로 변경되어 replace가 발생한다

# for_each: 키 기반. 동적이고 안정적인 반복에 적합하다
resource "null_resource" "vm_clone" {
  for_each = local.node_map  # { "platform-master" => {...}, ... }
}
# 참조: null_resource.vm_clone["platform-master"]
# 중간 요소를 삭제해도 다른 요소에 영향이 없다

# for_each에 사용 가능한 타입
# 1. map
for_each = { key1 = "val1", key2 = "val2" }

# 2. set(string)
for_each = toset(["a", "b", "c"])

# 3. map 변환 패턴
for_each = { for n in var.nodes : n.name => n }
```

#### 선택 기준

| 기준 | count | for_each |
|------|-------|----------|
| 단순 반복 (N개 동일 리소스) | 적합 | 가능 |
| 각 리소스가 고유한 속성을 가짐 | 부적합 | 적합 |
| 중간 요소 삭제/추가 | 인덱스 밀림 | 안전 |
| 조건부 생성 (0 or 1) | `count = var.enabled ? 1 : 0` | 가능하나 복잡 |
| known value 제약 | 없음 | for_each의 키는 Plan 시점에 알려져야 한다 |

---

