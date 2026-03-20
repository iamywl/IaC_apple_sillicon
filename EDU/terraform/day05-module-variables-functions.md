# Day 5: Module, Variables & Outputs, Functions

Module 구조와 설계 원칙, Module 소스와 버전 관리, Module Composition 패턴, Variable 타입과 검증, 변수 값 전달 우선순위, Output Values, 그리고 Terraform 내장 함수 레퍼런스를 다룬다.

---

## Part 9: Module 심화

### 9.1 Module 구조와 설계 원칙

Module은 재사용 가능한 Terraform 설정의 패키지이다. 표준 Module 구조는 다음과 같다.

```
modules/
└── tart-vm/
    ├── main.tf          # 리소스 정의 (핵심 로직)
    ├── variables.tf     # 입력 변수 선언
    ├── outputs.tf       # 출력 값 선언
    ├── versions.tf      # required_providers (선택)
    ├── locals.tf        # 로컬 값 (선택)
    ├── data.tf          # Data Sources (선택)
    └── README.md        # 모듈 문서 (선택)
```

Module 설계 원칙은 다음과 같다.

```
1. Single Responsibility: 하나의 모듈은 하나의 논리적 단위를 관리한다
   좋음: modules/tart-vm, modules/k8s-cluster, modules/helm-releases
   나쁨: modules/everything

2. Encapsulation: 내부 구현을 숨기고 input/output으로만 통신한다
   좋음: variable "clusters" → output "vm_ips"
   나쁨: 모듈 내부 리소스를 외부에서 직접 참조

3. Composability: 모듈을 조합하여 더 큰 구조를 만든다
   이 프로젝트: vms → k8s → helm (3단계 조합)

4. Minimal Interface: 필요한 최소한의 변수만 노출한다
   좋음: variable "clusters" (필수), variable "base_image" (기본값 있음)
   나쁨: 수십 개의 세부 설정 변수

5. Sensible Defaults: 합리적인 기본값을 제공한다
   variable "base_image" {
     default = "ghcr.io/cirruslabs/ubuntu:latest"
   }
```

### 9.2 Module 소스와 버전 관리

Module은 다양한 소스에서 가져올 수 있다.

```hcl
# 1. 로컬 경로 (이 프로젝트에서 사용)
module "vms" {
  source = "./modules/tart-vm"
}

# 2. Terraform Registry
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "5.0.0"    # 정확한 버전
}

module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 20.0"  # 20.x 범위
}

# 3. GitHub (HTTPS)
module "network" {
  source = "github.com/example/terraform-modules//network?ref=v1.0.0"
  # //로 레포 내 하위 디렉토리 지정
  # ?ref=로 브랜치, 태그, 커밋 해시 지정
}

# 4. GitHub (SSH)
module "network" {
  source = "git@github.com:example/terraform-modules.git//network?ref=v1.0.0"
}

# 5. Generic Git
module "config" {
  source = "git::https://example.com/terraform-modules.git//config?ref=main"
}

# 6. S3 Bucket
module "config" {
  source = "s3::https://s3-ap-northeast-2.amazonaws.com/my-bucket/modules/config.zip"
}

# 7. GCS Bucket
module "storage" {
  source = "gcs::https://www.googleapis.com/storage/v1/modules/storage.zip"
}
```

Module 버전 관리 시 의미적 버전(Semantic Versioning)을 따르는 것이 좋다.

```
v1.0.0 → v1.0.1  (patch: 버그 수정, 호환성 유지)
v1.0.0 → v1.1.0  (minor: 기능 추가, 하위 호환)
v1.0.0 → v2.0.0  (major: 호환성 깨짐, 마이그레이션 필요)
```

### 9.3 Module Composition 패턴

#### 플랫 구조 (이 프로젝트)

```
terraform/
├── main.tf           # 모든 모듈을 호출
├── variables.tf
├── outputs.tf
└── modules/
    ├── tart-vm/
    ├── k8s-cluster/
    └── helm-releases/
```

#### 환경별 분리 구조

```
terraform/
├── modules/              # 재사용 모듈
│   ├── tart-vm/
│   ├── k8s-cluster/
│   └── helm-releases/
├── environments/
│   ├── dev/
│   │   ├── main.tf       # module "vm" { source = "../../modules/tart-vm" }
│   │   ├── variables.tf
│   │   └── terraform.tfvars
│   ├── staging/
│   │   ├── main.tf
│   │   └── terraform.tfvars
│   └── prod/
│       ├── main.tf
│       └── terraform.tfvars
```

#### Terragrunt 패턴

```
infrastructure/
├── terragrunt.hcl            # 공통 설정 (backend, providers)
├── modules/
│   └── tart-vm/
├── dev/
│   ├── terragrunt.hcl        # include root + dev 변수
│   └── vm/
│       └── terragrunt.hcl    # module "tart-vm" 호출
├── staging/
│   └── ...
└── prod/
    └── ...
```

#### for_each와 Module

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

### 9.4 Module Testing

```hcl
# tests/tart_vm.tftest.hcl

# 모듈의 로컬 변환을 테스트
run "verify_node_map_structure" {
  command = plan

  variables {
    clusters = [
      {
        name         = "test"
        pod_cidr     = "10.10.0.0/16"
        service_cidr = "10.96.0.0/16"
        nodes = [
          { name = "test-master", role = "master", cpu = 2, memory = 4096, disk = 20 },
          { name = "test-worker", role = "worker", cpu = 2, memory = 4096, disk = 20 },
        ]
      }
    ]
    base_image   = "ghcr.io/cirruslabs/ubuntu:latest"
    project_root = "/tmp/test"
  }

  assert {
    condition     = length(module.vms.vm_ips) == 0 || true
    error_message = "노드 맵이 올바르게 생성되어야 한다."
  }
}
```

---

## Part 10: Variables & Outputs

### 10.1 Variable 타입과 선언

```hcl
# 기본 변수 선언
variable "name" {
  description = "VM 이름"          # 설명 (문서화 및 prompt 시 표시)
  type        = string             # 타입 제약
  default     = "worker"           # 기본값 (없으면 필수 변수)
  nullable    = false              # null 허용 여부 (Terraform 1.1+)
}

# 필수 변수 (default 없음)
variable "project_root" {
  type        = string
  description = "Absolute path to the tart-infra project root"
  # default가 없으므로 반드시 값을 제공해야 한다
}

# 민감 변수
variable "ssh_password" {
  type      = string
  default   = "admin"
  sensitive = true    # plan/apply 출력에서 마스킹
}

# 복합 타입 변수 (이 프로젝트의 핵심 변수)
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
    # ... dev, staging, prod 클러스터들
  ]
}
```

### 10.2 Variable Validation

```hcl
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

variable "environment" {
  type = string

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment는 dev, staging, prod 중 하나여야 한다."
  }
}

variable "cidr_block" {
  type = string

  validation {
    condition     = can(cidrhost(var.cidr_block, 0))
    error_message = "유효한 CIDR 블록이어야 한다. (예: 10.0.0.0/16)"
  }
}

variable "email" {
  type = string

  validation {
    condition     = can(regex("^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$", var.email))
    error_message = "유효한 이메일 주소여야 한다."
  }
}

# 복합 validation (Terraform 1.9+: cross-variable validation)
variable "min_nodes" {
  type    = number
  default = 1
}

variable "max_nodes" {
  type    = number
  default = 10

  validation {
    condition     = var.max_nodes >= var.min_nodes
    error_message = "max_nodes는 min_nodes 이상이어야 한다."
  }
}
```

### 10.3 변수 값 전달 우선순위

Terraform은 여러 소스에서 변수 값을 받을 수 있다. 우선순위가 높은 것이 낮은 것을 덮어쓴다.

```
낮음 ─────────────────────────────────────────────── 높음

1. default 값 (variable 블록 내)
2. 환경변수 (TF_VAR_name)
3. terraform.tfvars 파일 (자동 로드)
4. *.auto.tfvars 파일 (자동 로드, 알파벳 순)
5. -var-file="file.tfvars" (명시적 파일 지정)
6. -var="name=value" (CLI 인자)
```

```bash
# 환경변수로 전달
export TF_VAR_project_root="/Users/ywlee/tart-infra"
export TF_VAR_ssh_password="secure-password"
terraform apply

# terraform.tfvars 자동 로드 (이 프로젝트에서 사용)
# terraform.tfvars
# project_root = "/Users/ywlee/tart-infra"

# 명시적 파일 지정
terraform apply -var-file="prod.tfvars"

# CLI 인자로 전달
terraform apply -var="cpu_count=4" -var="memory_mb=8192"

# 복합 변수는 JSON 또는 HCL 형식으로 전달
terraform apply -var='clusters=[{"name":"dev","pod_cidr":"10.20.0.0/16",...}]'
```

### 10.4 Sensitive Variables

```hcl
variable "db_password" {
  type      = string
  sensitive = true
}

# sensitive = true 효과:
# 1. terraform plan 출력에서 (sensitive value)로 표시
# 2. terraform apply 출력에서 마스킹
# 3. terraform output에서 마스킹

# 주의: State 파일에는 여전히 평문으로 저장된다!

# sensitive 변수를 참조하는 값도 자동으로 sensitive로 전파
locals {
  connection_string = "postgresql://admin:${var.db_password}@host:5432/db"
  # 이 local도 sensitive로 취급된다
}
```

### 10.5 Output Values

```hcl
# 기본 output
output "vm_ips" {
  description = "Map of VM name to IP address"
  value       = module.vms.vm_ips
}

# 민감 output
output "db_password" {
  value     = var.db_password
  sensitive = true
}

# 조건부 output
output "load_balancer_dns" {
  value       = var.create_lb ? aws_lb.main[0].dns_name : null
  description = "Load Balancer DNS name (if created)"
}

# precondition이 있는 output (Terraform 1.2+)
output "cluster_endpoint" {
  value = module.k8s.endpoint

  precondition {
    condition     = module.k8s.status == "active"
    error_message = "클러스터가 active 상태가 아니다."
  }
}
```

```bash
# Output 조회
terraform output                    # 모든 output
terraform output vm_ips             # 특정 output
terraform output -json              # JSON 형식
terraform output -json vm_ips       # 특정 output을 JSON으로
terraform output -raw vm_ip         # 따옴표 없는 raw 값 (스크립트용)

# 민감 output 조회
terraform output -json db_password  # JSON 모드에서는 민감 값도 표시
```

### 10.6 Local Values

Local Values는 모듈 내부에서만 사용하는 계산된 값이다. 복잡한 표현식에 이름을 부여하여 가독성을 높인다.

```hcl
locals {
  # 이 프로젝트에서 사용하는 locals (실제 코드)
  kubeconfig_dir = "${var.project_root}/kubeconfig"

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

  # 마스터 노드 맵
  masters = {
    for n in local.all_nodes : n.cluster_name => n.node_name
    if n.role == "master"
  }

  # 공통 태그
  common_tags = {
    Project   = "tart-infra"
    ManagedBy = "terraform"
    CreatedAt = timestamp()
  }
}
```

---

## Part 11: Functions 레퍼런스

Terraform은 다양한 내장 함수를 제공한다. `terraform console`에서 대화형으로 테스트할 수 있다.

```bash
# 함수 테스트
terraform console
> upper("hello")
"HELLO"
> cidrsubnet("10.0.0.0/16", 8, 1)
"10.0.1.0/24"
```

### 11.1 Numeric Functions

```hcl
locals {
  # abs: 절대값
  positive = abs(-5)            # 5

  # ceil: 올림
  rounded_up = ceil(4.3)        # 5

  # floor: 내림
  rounded_down = floor(4.7)     # 4

  # log: 로그 (log(number, base))
  log_value = log(100, 10)      # 2

  # max: 최대값
  maximum = max(5, 12, 9)       # 12

  # min: 최소값
  minimum = min(5, 12, 9)       # 5

  # parseint: 문자열을 정수로 변환
  port = parseint("8080", 10)   # 8080

  # pow: 거듭제곱
  squared = pow(2, 10)          # 1024

  # signum: 부호 (-1, 0, 1)
  sign = signum(-42)            # -1
}
```

### 11.2 String Functions

```hcl
locals {
  # chomp: 후행 개행문자 제거
  clean = chomp("hello\n")               # "hello"

  # endswith / startswith (Terraform 1.5+)
  is_yaml = endswith("config.yaml", ".yaml")  # true
  is_prod = startswith("prod-server", "prod") # true

  # format: 형식화된 문자열
  msg = format("Hello, %s! You have %d CPUs", "VM", 4)
  # "Hello, VM! You have 4 CPUs"

  # formatlist: 리스트의 각 요소에 format 적용
  names = formatlist("worker-%s", ["a", "b", "c"])
  # ["worker-a", "worker-b", "worker-c"]

  # indent: 첫 줄 이후의 모든 줄에 들여쓰기 적용
  indented = indent(4, "line1\nline2\nline3")

  # join: 리스트를 문자열로 합침
  csv = join(",", ["a", "b", "c"])        # "a,b,c"

  # lower / upper: 대소문자 변환
  low  = lower("HELLO")                   # "hello"
  high = upper("hello")                   # "HELLO"

  # title: 각 단어의 첫 글자를 대문자로
  titled = title("hello world")           # "Hello World"

  # regex: 정규표현식 매칭 (첫 번째 매치)
  version = regex("v(\\d+\\.\\d+)", "app-v1.2-beta")  # "1.2"

  # regexall: 모든 매치
  all_nums = regexall("\\d+", "a1b2c3")   # ["1", "2", "3"]

  # replace: 문자열 치환
  fixed = replace("hello world", "world", "terraform")  # "hello terraform"

  # split: 문자열을 리스트로 분리
  parts = split(",", "a,b,c")             # ["a", "b", "c"]

  # strrev: 문자열 뒤집기
  reversed = strrev("hello")              # "olleh"

  # substr: 부분 문자열
  sub = substr("hello world", 0, 5)       # "hello"

  # trim / trimprefix / trimsuffix / trimspace
  trimmed   = trim("  hello  ", " ")       # "hello"
  no_prefix = trimprefix("helloworld", "hello")  # "world"
  no_suffix = trimsuffix("helloworld", "world")  # "hello"
  no_space  = trimspace("  hello  ")       # "hello"

  # templatestring (Terraform 1.8+): 동적 템플릿 렌더링
  rendered = templatestring("Hello, ${name}!", { name = "World" })
}
```

### 11.3 Collection Functions

```hcl
locals {
  # alltrue / anytrue
  all = alltrue([true, true, true])       # true
  any = anytrue([false, false, true])     # true

  # chunklist: 리스트를 고정 크기 청크로 분할
  chunks = chunklist(["a", "b", "c", "d", "e"], 2)
  # [["a", "b"], ["c", "d"], ["e"]]

  # coalesce: null이 아닌 첫 번째 값 반환
  value = coalesce(null, null, "default")  # "default"

  # coalescelist: 비어있지 않은 첫 번째 리스트 반환
  list = coalescelist([], [], ["a", "b"])  # ["a", "b"]

  # compact: null과 빈 문자열 제거
  clean = compact(["a", "", "b", null, "c"])  # ["a", "b", "c"]

  # concat: 리스트 결합
  merged = concat(["a", "b"], ["c", "d"])  # ["a", "b", "c", "d"]

  # contains: 리스트에 요소 포함 여부
  has = contains(["dev", "staging", "prod"], "prod")  # true

  # distinct: 중복 제거
  unique = distinct(["a", "b", "a", "c"])  # ["a", "b", "c"]

  # element: 인덱스로 요소 접근 (순환)
  elem = element(["a", "b", "c"], 4)       # "b" (4 % 3 = 1)

  # flatten: 중첩 리스트 평탄화 (이 프로젝트에서 핵심)
  flat = flatten([["a", "b"], ["c", ["d", "e"]]])
  # ["a", "b", "c", "d", "e"]

  # index: 요소의 인덱스 반환
  idx = index(["a", "b", "c"], "b")        # 1

  # keys / values: 맵의 키/값 리스트
  k = keys({ a = 1, b = 2 })              # ["a", "b"]
  v = values({ a = 1, b = 2 })            # [1, 2]

  # length: 길이
  len = length(["a", "b", "c"])            # 3

  # lookup: 맵에서 키로 값 조회 (기본값 지정 가능)
  ip = lookup({ web = "10.0.0.1" }, "web", "unknown")  # "10.0.0.1"
  missing = lookup({ web = "10.0.0.1" }, "db", "unknown")  # "unknown"

  # merge: 맵 병합 (나중 값이 우선)
  combined = merge(
    { a = 1, b = 2 },
    { b = 3, c = 4 }
  )  # { a = 1, b = 3, c = 4 }

  # one: 단일 요소 리스트에서 요소 추출 (빈 리스트면 null)
  single = one(["only"])                    # "only"
  empty  = one([])                          # null

  # range: 숫자 범위 생성
  nums = range(5)                          # [0, 1, 2, 3, 4]
  evens = range(0, 10, 2)                  # [0, 2, 4, 6, 8]

  # reverse: 리스트 뒤집기
  rev = reverse(["a", "b", "c"])           # ["c", "b", "a"]

  # setintersection / setsubtract / setunion: 집합 연산
  inter = setintersection(["a", "b"], ["b", "c"])  # ["b"]
  diff  = setsubtract(["a", "b", "c"], ["b"])      # ["a", "c"]
  union = setunion(["a", "b"], ["b", "c"])          # ["a", "b", "c"]

  # slice: 리스트 슬라이스
  sub = slice(["a", "b", "c", "d"], 1, 3)  # ["b", "c"]

  # sort: 문자열 리스트 정렬
  sorted = sort(["c", "a", "b"])           # ["a", "b", "c"]

  # sum: 숫자 리스트 합계
  total = sum([1, 2, 3, 4, 5])             # 15

  # transpose: 맵의 키와 값을 전치
  transposed = transpose({
    a = ["1", "2"]
    b = ["2", "3"]
  })
  # { "1" = ["a"], "2" = ["a", "b"], "3" = ["b"] }

  # zipmap: 두 리스트를 맵으로 합침
  zipped = zipmap(["a", "b", "c"], [1, 2, 3])
  # { a = 1, b = 2, c = 3 }
}
```

### 11.4 Encoding Functions

```hcl
locals {
  # base64encode / base64decode
  encoded = base64encode("hello")           # "aGVsbG8="
  decoded = base64decode("aGVsbG8=")        # "hello"

  # base64gzip: gzip 압축 후 base64 인코딩
  compressed = base64gzip("long content...")

  # csvdecode: CSV 문자열을 맵 리스트로
  data = csvdecode(file("${path.module}/data.csv"))
  # [{ name = "a", value = "1" }, ...]

  # jsondecode / jsonencode
  obj = jsondecode("{\"name\": \"test\"}")   # { name = "test" }
  json_str = jsonencode({ name = "test" })   # "{\"name\":\"test\"}"

  # textencodebase64 / textdecodebase64
  utf16 = textencodebase64("hello", "UTF-16LE")

  # urlencode
  url = urlencode("hello world")            # "hello+world"

  # yamldecode / yamlencode
  yaml_obj = yamldecode(file("${path.module}/config.yaml"))
  yaml_str = yamlencode({ name = "test", count = 3 })
}
```

### 11.5 Filesystem Functions

```hcl
locals {
  # abspath: 절대 경로 반환
  abs = abspath("./config")

  # basename: 파일명만 추출
  name = basename("/path/to/file.txt")      # "file.txt"

  # dirname: 디렉토리 경로만 추출
  dir = dirname("/path/to/file.txt")        # "/path/to"

  # file: 파일 내용을 문자열로 읽기
  content = file("${path.module}/config.yaml")

  # fileexists: 파일 존재 여부
  exists = fileexists("${path.module}/config.yaml")  # true/false

  # fileset: 글로브 패턴으로 파일 목록
  yaml_files = fileset("${path.module}", "*.yaml")
  # ["config.yaml", "values.yaml"]

  # filebase64: 파일 내용을 base64로 읽기 (바이너리 파일용)
  binary = filebase64("${path.module}/cert.pem")

  # pathexpand: ~ 확장
  home = pathexpand("~/.ssh/id_rsa")         # "/Users/ywlee/.ssh/id_rsa"

  # templatefile: 템플릿 파일 렌더링
  rendered = templatefile("${path.module}/template.tftpl", {
    name = "world"
    items = ["a", "b", "c"]
  })

  # path.module: 현재 모듈의 파일시스템 경로
  # path.root: 루트 모듈의 경로
  # path.cwd: 현재 작업 디렉토리
}
```

### 11.6 Date/Time Functions

```hcl
locals {
  # formatdate: 날짜 형식화
  date = formatdate("YYYY-MM-DD", timestamp())
  # "2026-03-19"

  time = formatdate("HH:mm:ss", timestamp())
  # "14:30:00"

  iso = formatdate("YYYY-MM-DD'T'HH:mm:ssZ", timestamp())
  # "2026-03-19T14:30:00Z"

  # plantimestamp: Plan 시점의 타임스탬프 (Terraform 1.5+)
  # timestamp()는 Apply마다 변경되지만 plantimestamp()는 Plan에서 고정
  plan_time = plantimestamp()

  # timeadd: 시간 더하기
  tomorrow = timeadd(timestamp(), "24h")
  later    = timeadd(timestamp(), "1h30m")

  # timecmp: 시간 비교 (-1, 0, 1)
  cmp = timecmp("2026-01-01T00:00:00Z", "2026-12-31T00:00:00Z")  # -1

  # timestamp: 현재 UTC 시간 (RFC 3339)
  now = timestamp()   # "2026-03-19T05:30:00Z"
}
```

### 11.7 Hash & Crypto Functions

```hcl
locals {
  # md5
  hash_md5 = md5("hello")
  # "5d41402abc4b2a76b9719d911017c592"

  # sha1 / sha256 / sha512
  hash_sha1   = sha1("hello")
  hash_sha256 = sha256("hello")
  hash_sha512 = sha512("hello")

  # bcrypt (비밀번호 해싱)
  password_hash = bcrypt("my-password")
  # 실행할 때마다 다른 결과 (salt 포함)

  # filemd5 / filesha1 / filesha256 / filesha512
  config_hash = filemd5("${path.module}/config.yaml")

  # uuid: UUID v4 생성 (매 실행마다 다른 값)
  id = uuid()

  # uuidv5: 결정적 UUID v5 (namespace + name)
  deterministic_id = uuidv5("dns", "example.com")
}
```

### 11.8 Type Conversion Functions

```hcl
locals {
  # can: 표현식이 에러 없이 평가되는지 확인
  valid = can(regex("^[a-z]+$", "hello"))   # true
  invalid = can(regex("^[a-z]+$", "HELLO")) # false

  # try: 첫 번째로 성공하는 표현식의 결과 반환
  value = try(var.map["key"], "default")

  # nonsensitive: sensitive 마킹 제거 (주의: 의도적으로만 사용)
  public = nonsensitive(var.non_secret_but_marked_sensitive)

  # sensitive: 값을 sensitive로 마킹
  secret = sensitive("my-api-key")

  # tobool / tolist / tomap / tonumber / toset / tostring
  num  = tonumber("42")                     # 42
  str  = tostring(42)                       # "42"
  bool = tobool("true")                     # true
  lst  = tolist(toset(["a", "b", "c"]))     # ["a", "b", "c"]

  # type: 값의 타입 반환 (디버깅용, terraform console에서만)
  # > type("hello")
  # string
}
```

### 11.9 IP Network Functions

```hcl
locals {
  # cidrhost: CIDR 블록에서 특정 호스트 주소
  host = cidrhost("10.0.0.0/24", 5)         # "10.0.0.5"

  # cidrnetmask: CIDR 블록의 네트마스크
  mask = cidrnetmask("10.0.0.0/24")         # "255.255.255.0"

  # cidrsubnet: CIDR 블록을 서브넷으로 분할
  subnet1 = cidrsubnet("10.0.0.0/16", 8, 0)  # "10.0.0.0/24"
  subnet2 = cidrsubnet("10.0.0.0/16", 8, 1)  # "10.0.1.0/24"
  subnet3 = cidrsubnet("10.0.0.0/16", 8, 2)  # "10.0.2.0/24"
  # cidrsubnet(prefix, newbits, netnum)
  # prefix: 기본 CIDR
  # newbits: 추가할 비트 수 (16 + 8 = /24)
  # netnum: 서브넷 번호

  # cidrsubnets: 여러 서브넷을 한 번에 생성 (Terraform 0.12+)
  subnets = cidrsubnets("10.0.0.0/16", 8, 8, 8, 4)
  # ["10.0.0.0/24", "10.0.1.0/24", "10.0.2.0/24", "10.0.0.0/20"]

  # 이 프로젝트에서의 CIDR 사용
  # platform: pod_cidr = "10.10.0.0/16", service_cidr = "10.96.0.0/16"
  # dev:      pod_cidr = "10.20.0.0/16", service_cidr = "10.97.0.0/16"
  # staging:  pod_cidr = "10.30.0.0/16", service_cidr = "10.98.0.0/16"
  # prod:     pod_cidr = "10.40.0.0/16", service_cidr = "10.99.0.0/16"
}
```

---

