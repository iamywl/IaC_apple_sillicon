# Day 2: Terraform 아키텍처와 HCL 심화

Terraform Core 내부 구조, Provider 동작 원리, CLI Workflow, DAG 기반 실행 엔진, 그리고 HCL 심화(표현식, 조건, for, Splat, Dynamic Block, Type Constraints, String Templates)를 다룬다.

---

## Part 3: Terraform 아키텍처 심화

### 3.1 Terraform Core 내부 구조

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
│  │  │  null   │  │  helm   │  │  local   │  │  aws       │  │ │
│  │  │Provider │  │Provider │  │Provider  │  │ Provider   │  │ │
│  │  └────┬────┘  └────┬────┘  └─────┬────┘  └─────┬──────┘  │ │
│  └───────┼────────────┼─────────────┼──────────────┼─────────┘ │
│          ▼            ▼             ▼              ▼            │
│    null (no-op)   K8s API     Local FS        AWS API          │
└─────────────────────────────────────────────────────────────────┘
```

Terraform Core는 Go 언어로 작성되었으며, 내부적으로 다음 컴포넌트로 구성된다.

#### Config Parser

HCL 파일을 파싱하여 Abstract Syntax Tree(AST)를 생성한 뒤, 내부 구조체(Configuration)로 변환한다. 이 과정에서 다음이 처리된다.

```
Config Parsing 과정:
1. Lexical Analysis
   └─► .tf 파일을 토큰(token)으로 분해
   └─► 문자열, 숫자, 식별자, 연산자 등 인식

2. Syntax Analysis
   └─► 토큰을 AST(추상 구문 트리)로 변환
   └─► resource, data, module, variable 등 블록 구조 파악

3. Semantic Analysis
   └─► 타입 검사: variable의 type constraint 검증
   └─► 참조 해석: var.name, module.x.output 등의 참조를 해석
   └─► Schema 검증: Provider가 제공하는 Schema와 비교하여 유효성 확인

4. Expression Evaluation
   └─► 변수 바인딩: terraform.tfvars, -var, 환경변수 등에서 값 주입
   └─► 함수 호출: file(), lookup(), flatten() 등 평가
   └─► 조건/반복: for, if, ternary 표현식 평가
```

#### State Manager

State Manager는 State 파일의 읽기, 쓰기, 잠금, 버전 관리를 담당한다. Backend 인터페이스를 통해 다양한 저장소(Local, S3, GCS, Terraform Cloud 등)를 추상화한다.

```go
// Terraform 내부의 Backend 인터페이스 (간략화)
type Backend interface {
    StateMgr(workspace string) (statemgr.Full, error)
    DeleteWorkspace(name string) error
    Workspaces() ([]string, error)
}

type StateMgr interface {
    Lock(info *LockInfo) (string, error)    // State 잠금
    Unlock(id string) error                  // State 잠금 해제
    State() *states.State                    // 현재 State 반환
    WriteState(*states.State) error          // State 쓰기
    PersistState(schemas *Schemas) error     // State를 Backend에 저장
    RefreshState() error                     // Backend에서 State 다시 읽기
}
```

#### Graph Builder

Graph Builder는 리소스 간 의존관계를 DAG(Directed Acyclic Graph)로 구성한다. 그래프의 각 노드는 리소스, 데이터 소스, 모듈, Provider 등이며, 엣지는 의존관계를 나타낸다.

```
이 프로젝트의 DAG 예시:

  null_resource.pull_base_image
           │
           ▼
  null_resource.vm_clone["platform-master"]
  null_resource.vm_clone["platform-worker1"]   (병렬)
  null_resource.vm_clone["dev-master"]
           │
           ▼
  null_resource.vm_start["platform-master"]
  null_resource.vm_start["platform-worker1"]   (병렬)
           │
           ▼
  null_resource.vm_wait_ip["platform-master"]
           │
           ▼
  data.local_file.vm_ips["platform-master"]
           │
           ▼
  module.k8s (ssh_wait → prepare_node → install_runtime → ...)
           │
           ▼
  module.helm (helm_release.kube_prometheus_stack → ...)
```

#### Diff Engine

Diff Engine은 Configuration(코드에 정의된 원하는 상태)과 State(현재 상태)를 비교하여 각 리소스에 대해 다음 중 하나를 결정한다.

| Diff 결과 | 의미 | Plan 표시 |
|-----------|------|----------|
| no-op | 변경 없음 | (표시 안 함) |
| create | 새로 생성 | `+` (초록색) |
| update | in-place 수정 | `~` (노란색) |
| replace | 삭제 후 재생성 | `-/+` (빨간/초록) |
| delete | 삭제 | `-` (빨간색) |
| read | Data Source 읽기 | `<=` |

replace가 발생하는 경우는 Provider가 해당 속성의 in-place 수정을 지원하지 않을 때이다. 예를 들어 AWS EC2의 `ami`를 변경하면 인스턴스를 삭제 후 재생성해야 한다. Provider Schema에서 `ForceNew: true`로 표시된 속성이 변경되면 replace가 된다.

### 3.2 Provider 내부 동작

Provider는 Terraform Core와 별도의 프로세스로 실행되며, gRPC(go-plugin 프레임워크)를 통해 통신한다. Provider는 다음 CRUD 연산을 구현한다.

| Provider 연산 | Terraform 동작 | 설명 |
|--------------|---------------|------|
| Create | `terraform apply` (신규) | 새로운 리소스를 생성한다 |
| Read | `terraform refresh` / `plan` | 리소스의 현재 상태를 읽어온다 |
| Update | `terraform apply` (변경) | 기존 리소스를 수정한다 (in-place 또는 replace) |
| Delete | `terraform destroy` | 리소스를 삭제한다 |

#### Provider 초기화 과정

```
terraform init 실행 시:

1. required_providers 블록 파싱
   └─► source와 version 제약 조건 확인

2. Provider 레지스트리에서 메타데이터 조회
   └─► registry.terraform.io/hashicorp/null
   └─► 사용 가능한 버전 목록 조회

3. 버전 해결 (Version Resolution)
   └─► version 제약 조건을 만족하는 최신 버전 선택
   └─► .terraform.lock.hcl에 선택된 버전과 해시 기록

4. Provider 바이너리 다운로드
   └─► .terraform/providers/ 디렉토리에 저장
   └─► OS/아키텍처별 바이너리 (darwin_arm64, linux_amd64 등)

5. 무결성 검증
   └─► 다운로드된 바이너리의 해시를 lock 파일과 비교
```

#### Provider Schema

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
- `~> 1.0.4`: 최소 1.0.4 이상, 1.1.0 미만이다
- `>= 1.0, < 2.0`: 범위를 직접 지정한다
- `!= 1.2.3`: 특정 버전을 제외한다

#### .terraform.lock.hcl

Lock 파일은 `terraform init` 시 자동 생성되며, 선택된 Provider 버전과 해시를 기록한다. Git에 커밋하여 팀 전체가 동일한 Provider 버전을 사용하도록 보장한다.

```hcl
# .terraform.lock.hcl (자동 생성)
provider "registry.terraform.io/hashicorp/null" {
  version     = "3.2.4"
  constraints = "~> 3.2"
  hashes = [
    "h1:XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX=",
    "zh:XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX=",
  ]
}
```

```bash
# 다른 플랫폼용 해시도 추가 (CI/CD 환경 등)
terraform providers lock -platform=linux_amd64 -platform=darwin_arm64

# Provider 업그레이드
terraform init -upgrade  # version 제약 범위 내에서 최신 버전으로 업그레이드
```

### 3.3 CLI Workflow 내부 동작

#### terraform init

```
terraform init 내부 동작:

1. Backend 초기화
   ├─► backend 블록이 있으면 해당 Backend 설정
   ├─► 없으면 local Backend 사용
   └─► State 마이그레이션이 필요하면 -migrate-state 프롬프트

2. Module 다운로드
   ├─► 모든 module 블록의 source 해석
   ├─► 로컬 경로: 심볼릭 링크 또는 직접 참조
   ├─► 원격 소스: .terraform/modules/ 에 다운로드
   └─► .terraform/modules/modules.json에 메타데이터 기록

3. Provider 설치
   ├─► required_providers 수집 (모듈 포함)
   ├─► .terraform.lock.hcl 확인
   ├─► 레지스트리에서 다운로드 또는 캐시 사용
   └─► .terraform/providers/ 에 바이너리 저장

4. Backend State 검증
   └─► State 파일이 존재하면 접근 가능한지 확인
```

#### terraform plan

```
terraform plan 내부 동작:

1. Configuration Loading
   └─► 현재 디렉토리의 .tf 파일 파싱
   └─► Module 트리 구성
   └─► 변수 바인딩 (tfvars, -var, env)

2. Provider Initialization
   └─► Provider 프로세스 시작 (gRPC 서버)
   └─► Configure 호출 (인증 정보 등 전달)

3. State Refresh (기본 동작, -refresh=false로 생략 가능)
   └─► State의 모든 리소스에 대해 Provider.Read 호출
   └─► 실제 인프라 상태를 가져와 State를 업데이트
   └─► 삭제된 리소스 감지 (Read가 빈 결과를 반환)

4. Graph Construction
   └─► Plan Graph 구성 (Config + State + Diff)
   └─► 의존관계 엣지 추가 (암시적 + 명시적)
   └─► 순환 의존성 검사 (cycle이면 에러)

5. Diff Calculation (Graph Walk)
   └─► DAG를 topological sort하여 실행 순서 결정
   └─► 각 노드에 대해 desired state vs current state 비교
   └─► create/update/replace/delete 결정

6. Plan 직렬화
   └─► Plan 결과를 메모리 또는 파일(-out=tfplan)로 저장
   └─► 화면에 변경사항 출력
```

#### terraform apply

```
terraform apply 내부 동작:

1. Plan 생성 (또는 저장된 Plan 파일 로드)
   └─► terraform apply만 실행하면 내부적으로 plan 먼저 수행
   └─► terraform apply tfplan이면 저장된 Plan 로드

2. 사용자 확인 (interactive mode)
   └─► Plan 결과 출력 + "yes" 입력 대기
   └─► -auto-approve 플래그로 생략 가능

3. Apply Walk
   └─► Apply Graph 구성
   └─► DAG topological sort 후 병렬 실행
   └─► 각 노드에 대해 Provider의 Create/Update/Delete 호출
   └─► 성공 시 즉시 State 업데이트 (각 리소스별)

4. Post-Apply
   └─► 모든 리소스 처리 완료 확인
   └─► State 파일 최종 저장
   └─► Output 값 계산 및 출력
   └─► Provider 프로세스 종료
```

#### terraform destroy

```
terraform destroy 내부 동작:

1. Destroy Plan 생성
   └─► State의 모든 리소스에 대해 delete 계획 생성
   └─► DAG의 엣지 방향을 뒤집어서 (역순) 삭제 순서 결정
   └─► 의존하는 리소스가 먼저 삭제된다

2. 이 프로젝트에서의 삭제 순서:
   module.helm (Helm releases 삭제)
   → module.k8s (K8s 클러스터 해체)
   → module.vms (VM 삭제)
   → null_resource.install_dev_staging (Phase 4 정리)
```

### 3.4 DAG 기반 실행 엔진

Terraform의 실행 엔진은 DAG(Directed Acyclic Graph)를 기반으로 동작한다. DAG를 사용하는 이유는 다음과 같다.

1. **순서 보장**: 의존하는 리소스가 먼저 생성된다
2. **병렬 실행**: 독립적인 리소스는 동시에 처리할 수 있다
3. **순환 감지**: 순환 의존성을 빌드 타임에 감지하여 에러를 방지한다

```
DAG 실행 예시 (이 프로젝트):

Topological Sort 결과:
Level 0: null_resource.pull_base_image
Level 1: null_resource.vm_clone (11개 VM 병렬)
Level 2: null_resource.vm_start (11개 VM 병렬)
Level 3: null_resource.vm_wait_ip (11개 VM 병렬)
Level 4: data.local_file.vm_ips (11개 병렬)
Level 5: null_resource.ssh_wait (11개 병렬)
Level 6: null_resource.prepare_node (11개 병렬)
...
Level N: helm_release.kube_prometheus_stack
Level N+1: helm_release.loki (depends_on prometheus)
```

```bash
# DAG 시각화
terraform graph | dot -Tpng > graph.png

# 특정 리소스를 대상으로 그래프 확인
terraform graph -target=module.k8s

# 병렬 처리 수 조정
terraform apply -parallelism=20    # 동시에 20개 리소스 처리
terraform apply -parallelism=1     # 디버깅 시 순차 처리 (의존성 문제 분석용)
```

#### 의존관계 유형

```hcl
# 1. 암시적 의존 (Implicit Dependency)
# 표현식에서 다른 리소스를 참조하면 자동으로 의존관계가 형성된다
resource "null_resource" "a" { }
resource "null_resource" "b" {
  triggers = { a_id = null_resource.a.id }  # a에 암시적으로 의존
}

# 2. 명시적 의존 (Explicit Dependency)
# depends_on으로 직접 지정한다. 암시적 의존으로 표현할 수 없을 때 사용한다
module "k8s" {
  source     = "./modules/k8s-cluster"
  depends_on = [module.vms]  # vms 모듈 전체에 의존
}

# 3. Provider 의존
# Provider 설정이 다른 리소스의 output을 참조하면 Provider 수준의 의존이 생긴다
provider "helm" {
  kubernetes {
    config_path = "${local.kubeconfig_dir}/platform.yaml"
  }
}
# 이 Provider를 사용하는 모든 리소스는 kubeconfig 파일 생성 이후에 실행된다
```

---

## Part 4: HCL 심화

HCL(HashiCorp Configuration Language)은 Terraform의 설정 언어이다. JSON 호환 문법(`*.tf.json`)도 지원하지만, 일반적으로 HCL 문법을 사용한다.

### 4.1 기본 표현식과 연산자

```hcl
# 산술 연산자
locals {
  total_cpu = 2 + 4                  # 6
  remaining = 10 - 3                 # 7
  memory    = 4 * 1024               # 4096
  per_node  = 8192 / 4               # 2048
  modulo    = 10 % 3                 # 1
  negative  = -1 * var.offset        # 부호 반전
}

# 비교 연산자
locals {
  is_prod     = var.env == "prod"      # true/false
  not_dev     = var.env != "dev"       # true/false
  high_cpu    = var.cpu > 4            # 4보다 큰가
  has_enough  = var.memory >= 4096     # 4096 이상인가
}

# 논리 연산자
locals {
  needs_scaling = var.cpu > 4 && var.memory > 8192   # AND
  is_test_env   = var.env == "dev" || var.env == "staging"  # OR
  is_disabled   = !var.enabled                        # NOT
}

# 문자열 보간 (String Interpolation)
locals {
  vm_name = "${var.cluster_name}-${var.role}-${var.index}"
  message = "VM ${local.vm_name} has ${var.cpu} CPUs"
}

# Heredoc (여러 줄 문자열)
locals {
  # 들여쓰기 포함 heredoc
  script = <<EOT
#!/bin/bash
echo "Hello"
echo "World"
EOT

  # 들여쓰기 제거 heredoc (<<- 사용)
  indented_script = <<-EOT
    #!/bin/bash
    echo "Hello"
    echo "World"
  EOT
  # 결과: 앞쪽 공통 들여쓰기가 제거된다
}
```

### 4.2 조건 표현식

```hcl
# 기본 삼항 연산자
locals {
  instance_type = var.environment == "prod" ? "m5.xlarge" : "t3.micro"
  cpu_count     = var.environment == "prod" ? 4 : 2
  memory_mb     = var.environment == "prod" ? 8192 : 4096
}

# 중첩 조건 (가독성이 떨어지므로 locals로 분리하는 것이 좋다)
locals {
  size = (
    var.env == "prod" ? "large" :
    var.env == "staging" ? "medium" :
    "small"
  )
}

# 조건부 리소스 생성 (count 활용)
resource "helm_release" "monitoring" {
  count = var.enable_monitoring ? 1 : 0
  # count가 0이면 리소스가 생성되지 않는다
  name  = "kube-prometheus-stack"
  chart = "kube-prometheus-stack"
}

# 조건부 값 (null 활용)
resource "aws_instance" "web" {
  # var.public이 true면 public subnet, false면 null (= 생략)
  associate_public_ip_address = var.public ? true : null
}

# try() 함수로 안전한 참조
locals {
  # 키가 없으면 에러 대신 기본값을 반환한다
  ip = try(var.vm_ips["platform-master"], "0.0.0.0")
}

# can() 함수로 표현식 유효성 검사
locals {
  has_master = can(var.vm_ips["platform-master"])  # true/false
}
```

### 4.3 for 표현식

```hcl
# 리스트 → 리스트 변환
variable "names" {
  default = ["worker-1", "worker-2", "worker-3"]
}

locals {
  upper_names = [for name in var.names : upper(name)]
  # 결과: ["WORKER-1", "WORKER-2", "WORKER-3"]

  # 인덱스 포함
  indexed = [for i, name in var.names : "${i}: ${name}"]
  # 결과: ["0: worker-1", "1: worker-2", "2: worker-3"]
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

# 리스트 → 맵 변환
variable "users" {
  default = [
    { name = "alice", role = "admin" },
    { name = "bob", role = "user" },
  ]
}

locals {
  user_map = { for u in var.users : u.name => u.role }
  # 결과: { alice = "admin", bob = "user" }
}

# 그룹화 (... 연산자)
variable "instances" {
  default = [
    { name = "web-1", zone = "a" },
    { name = "web-2", zone = "a" },
    { name = "db-1", zone = "b" },
  ]
}

locals {
  by_zone = { for inst in var.instances : inst.zone => inst.name... }
  # 결과: { a = ["web-1", "web-2"], b = ["db-1"] }
  # ... 연산자: 같은 키에 대해 값을 리스트로 그룹화한다
}

# 이 프로젝트에서의 활용 (실제 코드)
locals {
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
  # 중첩된 for 표현식으로 2차원 리스트를 만든 뒤, flatten으로 평탄화한다
  # clusters[0].nodes[0], clusters[0].nodes[1], clusters[1].nodes[0], ...
}
```

### 4.4 Splat 표현식

```hcl
# [*]는 for 표현식의 축약이다
resource "tart_vm" "worker" {
  count = 3
  name  = "worker-${count.index + 1}"
}

output "all_names" {
  value = tart_vm.worker[*].name
  # 위와 동일: [for vm in tart_vm.worker : vm.name]
  # 결과: ["worker-1", "worker-2", "worker-3"]
}

output "all_ips" {
  value = tart_vm.worker[*].ip
}

# Splat은 리스트(count)에만 사용 가능하다
# for_each로 생성된 리소스에는 사용할 수 없다
# for_each의 경우 values() 함수를 사용한다
output "all_ips_for_each" {
  value = values(tart_vm.worker)[*].ip
}

# 중첩 속성에 대한 Splat
# tart_vm.worker[*].disk[0].size
# → 각 worker의 첫 번째 disk size를 리스트로 반환
```

### 4.5 Dynamic Block

반복되는 중첩 블록을 동적으로 생성한다. `dynamic` 블록은 `for_each`와 유사하지만, 리소스 내부의 중첩 블록에 사용한다.

```hcl
variable "ingress_rules" {
  default = [
    { port = 80,   description = "HTTP" },
    { port = 443,  description = "HTTPS" },
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

# iterator를 사용하여 반복 변수 이름을 변경할 수 있다
resource "aws_security_group" "custom" {
  name = "custom-sg"

  dynamic "ingress" {
    for_each = var.ingress_rules
    iterator = rule  # 기본값은 블록 이름(ingress)이다
    content {
      from_port   = rule.value.port
      to_port     = rule.value.port
      protocol    = "tcp"
      cidr_blocks = ["0.0.0.0/0"]
      description = rule.value.description
    }
  }
}

# 중첩 dynamic block
resource "aws_lb_listener" "https" {
  # ...
  dynamic "default_action" {
    for_each = var.actions
    content {
      type             = default_action.value.type
      target_group_arn = default_action.value.target_group_arn

      dynamic "redirect" {
        for_each = default_action.value.type == "redirect" ? [1] : []
        content {
          port        = "443"
          protocol    = "HTTPS"
          status_code = "HTTP_301"
        }
      }
    }
  }
}
```

주의: Dynamic block을 과도하게 사용하면 코드 가독성이 떨어진다. HashiCorp은 "필요한 경우에만 사용"을 권장한다.

### 4.6 Type Constraints 심화

Terraform은 정적 타입 시스템을 갖추고 있다. Variable의 `type`으로 타입을 명시하면 Terraform이 값의 유효성을 검증한다.

```hcl
# Primitive Types
variable "name" {
  type = string    # 문자열
}
variable "count" {
  type = number    # 정수 또는 부동소수점
}
variable "enabled" {
  type = bool      # true 또는 false
}

# Collection Types
variable "names" {
  type = list(string)         # 문자열 리스트
  # 예: ["a", "b", "c"]
}
variable "tags" {
  type = map(string)          # 문자열 값의 맵
  # 예: { env = "prod", team = "infra" }
}
variable "ports" {
  type = set(number)          # 숫자 집합 (중복 없음, 순서 없음)
  # 예: [80, 443, 8080]
}

# Structural Types
variable "vm_config" {
  type = object({
    name    = string
    cpu     = number
    memory  = number
    tags    = map(string)
    disk    = optional(object({     # optional (Terraform 1.3+)
      size = number
      type = optional(string, "ssd")  # 기본값 지정 가능
    }))
    enabled = optional(bool, true)    # optional + 기본값
  })
}

variable "node_list" {
  type = tuple([string, number, bool])
  # 예: ["worker-1", 4, true]
  # 각 요소의 타입이 다를 수 있다
}

# any 타입 (타입 검증을 하지 않는다)
variable "metadata" {
  type = any
  # 어떤 타입의 값이든 받을 수 있다
  # 가능하면 사용을 피하는 것이 좋다
}

# 복합 타입 (이 프로젝트에서 사용하는 실제 패턴)
variable "clusters" {
  type = list(object({
    name         = string
    pod_cidr     = string
    service_cidr = string
    nodes = list(object({
      name   = string
      role   = string        # "master" 또는 "worker"
      cpu    = number
      memory = number
      disk   = number
    }))
  }))
}
# 중첩된 object와 list를 조합하여 복잡한 구조를 정의한다
# 이 타입 제약 덕분에 잘못된 형식의 입력값은 plan 단계에서 거부된다
```

### 4.7 String Templates

```hcl
# 기본 보간 (Interpolation)
locals {
  greeting = "Hello, ${var.name}!"
}

# Directive (조건/반복을 문자열 내에서 사용)
locals {
  # 조건 directive
  status = "Server is %{if var.running}running%{else}stopped%{endif}"

  # 반복 directive
  hosts_content = <<-EOT
%{for ip in var.ips~}
${ip} server-${index(var.ips, ip)}
%{endfor~}
EOT
  # ~는 trailing newline을 제거한다
}

# templatefile() 함수로 외부 템플릿 파일 사용
# templates/user_data.tftpl
# #!/bin/bash
# %{ for mount in mounts ~}
# mkdir -p ${mount.path}
# mount ${mount.device} ${mount.path}
# %{ endfor ~}

resource "aws_instance" "web" {
  user_data = templatefile("${path.module}/templates/user_data.tftpl", {
    mounts = [
      { device = "/dev/xvdb", path = "/data" },
      { device = "/dev/xvdc", path = "/logs" },
    ]
  })
}
```

---

