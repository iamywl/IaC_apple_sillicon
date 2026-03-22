# Day 1: IaC 기초와 실습 환경

Infrastructure as Code 개념, 선언적 vs 명령형 방식, 멱등성, Drift Detection, Terraform 핵심 개념 총정리, 그리고 tart-infra 프로젝트에서의 Terraform 실습 환경을 다룬다.

---

# Terraform - Infrastructure as Code

## 목차

- [Part 1: IaC 기초와 핵심 개념](#part-1-iac-기초와-핵심-개념)
  - [1.1 Infrastructure as Code란?](#11-infrastructure-as-code란)
  - [1.2 선언적 vs 명령형](#12-선언적-vs-명령형)
  - [1.3 멱등성(Idempotency)](#13-멱등성idempotency)
  - [1.4 Drift Detection과 State Reconciliation](#14-drift-detection과-state-reconciliation)
  - [1.5 Terraform이란?](#15-terraform이란)
  - [1.6 핵심 개념 총정리](#16-핵심-개념-총정리)
- [Part 2: 이 프로젝트에서의 실습 환경](#part-2-이-프로젝트에서의-실습-환경)
- [Part 3: Terraform 아키텍처 심화](#part-3-terraform-아키텍처-심화)
  - [3.1 Terraform Core 내부 구조](#31-terraform-core-내부-구조)
  - [3.2 Provider 내부 동작](#32-provider-내부-동작)
  - [3.3 CLI Workflow 내부 동작](#33-cli-workflow-내부-동작)
  - [3.4 DAG 기반 실행 엔진](#34-dag-기반-실행-엔진)
- [Part 4: HCL 심화](#part-4-hcl-심화)
  - [4.1 기본 표현식과 연산자](#41-기본-표현식과-연산자)
  - [4.2 조건 표현식](#42-조건-표현식)
  - [4.3 for 표현식](#43-for-표현식)
  - [4.4 Splat 표현식](#44-splat-표현식)
  - [4.5 Dynamic Block](#45-dynamic-block)
  - [4.6 Type Constraints 심화](#46-type-constraints-심화)
  - [4.7 String Templates](#47-string-templates)
- [Part 5: Provider 심화](#part-5-provider-심화)
  - [5.1 Provider 설정과 버전 제약](#51-provider-설정과-버전-제약)
  - [5.2 Provider Alias](#52-provider-alias)
  - [5.3 Provider 개발 기초 (Plugin Framework)](#53-provider-개발-기초-plugin-framework)
- [Part 6: Resource 심화](#part-6-resource-심화)
  - [6.1 Resource Lifecycle](#61-resource-lifecycle)
  - [6.2 Precondition / Postcondition](#62-precondition--postcondition)
  - [6.3 Provisioners](#63-provisioners)
  - [6.4 null_resource와 terraform_data](#64-null_resource와-terraform_data)
  - [6.5 count vs for_each](#65-count-vs-for_each)
- [Part 7: Data Sources](#part-7-data-sources)
  - [7.1 Data Source 기본](#71-data-source-기본)
  - [7.2 의존성과 실행 시점](#72-의존성과-실행-시점)
  - [7.3 external Data Source](#73-external-data-source)
- [Part 8: State 심화](#part-8-state-심화)
  - [8.1 State 파일 구조](#81-state-파일-구조)
  - [8.2 Remote Backend 설정](#82-remote-backend-설정)
  - [8.3 State Locking](#83-state-locking)
  - [8.4 State 보안](#84-state-보안)
  - [8.5 State 조작 명령어](#85-state-조작-명령어)
- [Part 9: Module 심화](#part-9-module-심화)
  - [9.1 Module 구조와 설계 원칙](#91-module-구조와-설계-원칙)
  - [9.2 Module 소스와 버전 관리](#92-module-소스와-버전-관리)
  - [9.3 Module Composition 패턴](#93-module-composition-패턴)
  - [9.4 Module Testing](#94-module-testing)
- [Part 10: Variables & Outputs](#part-10-variables--outputs)
  - [10.1 Variable 타입과 선언](#101-variable-타입과-선언)
  - [10.2 Variable Validation](#102-variable-validation)
  - [10.3 변수 값 전달 우선순위](#103-변수-값-전달-우선순위)
  - [10.4 Sensitive Variables](#104-sensitive-variables)
  - [10.5 Output Values](#105-output-values)
  - [10.6 Local Values](#106-local-values)
- [Part 11: Functions 레퍼런스](#part-11-functions-레퍼런스)
  - [11.1 Numeric Functions](#111-numeric-functions)
  - [11.2 String Functions](#112-string-functions)
  - [11.3 Collection Functions](#113-collection-functions)
  - [11.4 Encoding Functions](#114-encoding-functions)
  - [11.5 Filesystem Functions](#115-filesystem-functions)
  - [11.6 Date/Time Functions](#116-datetime-functions)
  - [11.7 Hash & Crypto Functions](#117-hash--crypto-functions)
  - [11.8 Type Conversion Functions](#118-type-conversion-functions)
  - [11.9 IP Network Functions](#119-ip-network-functions)
- [Part 12: Workspaces](#part-12-workspaces)
  - [12.1 CLI Workspaces](#121-cli-workspaces)
  - [12.2 Terraform Cloud Workspaces](#122-terraform-cloud-workspaces)
  - [12.3 Multi-Environment 패턴 비교](#123-multi-environment-패턴-비교)
- [Part 13: Import & Migration](#part-13-import--migration)
  - [13.1 terraform import 명령어](#131-terraform-import-명령어)
  - [13.2 import 블록 (Terraform 1.5+)](#132-import-블록-terraform-15)
  - [13.3 moved 블록 (Terraform 1.1+)](#133-moved-블록-terraform-11)
  - [13.4 State Surgery](#134-state-surgery)
- [Part 14: Testing](#part-14-testing)
  - [14.1 terraform test (Terraform 1.6+)](#141-terraform-test-terraform-16)
  - [14.2 Mock과 Override](#142-mock과-override)
  - [14.3 Terratest (Go 기반)](#143-terratest-go-기반)
  - [14.4 Unit vs Integration Testing 전략](#144-unit-vs-integration-testing-전략)
- [Part 15: CI/CD Integration](#part-15-cicd-integration)
  - [15.1 GitHub Actions](#151-github-actions)
  - [15.2 Atlantis](#152-atlantis)
  - [15.3 Terraform Cloud / Enterprise](#153-terraform-cloud--enterprise)
  - [15.4 GitOps 패턴](#154-gitops-패턴)
- [Part 16: 보안](#part-16-보안)
  - [16.1 Secrets Management](#161-secrets-management)
  - [16.2 OIDC Authentication](#162-oidc-authentication)
  - [16.3 Policy as Code](#163-policy-as-code)
  - [16.4 Drift Detection 자동화](#164-drift-detection-자동화)
- [Part 17: 성능 최적화](#part-17-성능-최적화)
  - [17.1 Parallelism 튜닝](#171-parallelism-튜닝)
  - [17.2 Targeted Apply](#172-targeted-apply)
  - [17.3 State Splitting](#173-state-splitting)
  - [17.4 Provider Caching](#174-provider-caching)
- [Part 18: 트러블슈팅](#part-18-트러블슈팅)
  - [18.1 Dependency Cycle](#181-dependency-cycle)
  - [18.2 State Corruption](#182-state-corruption)
  - [18.3 Provider Version Conflict](#183-provider-version-conflict)
  - [18.4 Plan/Apply 에러 패턴](#184-planapply-에러-패턴)
- [Part 19: 실전 패턴](#part-19-실전-패턴)
  - [19.1 Multi-Environment 아키텍처](#191-multi-environment-아키텍처)
  - [19.2 Modular Infrastructure](#192-modular-infrastructure)
  - [19.3 Zero-Downtime Deployment](#193-zero-downtime-deployment)
- [실습 가이드](#실습-가이드)
- [자가 점검](#자가-점검)
- [참고문헌](#참고문헌)

---

## Part 1: IaC 기초와 핵심 개념

### 1.1 Infrastructure as Code란?

Infrastructure as Code(IaC)는 인프라를 코드로 정의하고 관리하는 실천 방법이다. 수동으로 서버를 설치하고 설정하는 대신, 코드 파일에 원하는 인프라 상태를 기술하면 도구가 자동으로 해당 상태를 구현한다.

IaC가 등장하기 전에는 다음과 같은 문제가 있었다.

1. **Snowflake Server**: 각 서버가 수동으로 설정되어 미묘하게 다른 환경이 되는 현상이다. 동일한 "프로덕션 서버"라고 해도 설치 시점, 담당자, 패치 이력에 따라 서로 다른 상태가 된다
2. **Configuration Drift**: 시간이 지남에 따라 서버의 실제 상태가 의도한 상태와 점차 달라지는 현상이다. 긴급 패치, 수동 디버깅 과정에서의 변경 등이 누적된다
3. **재현 불가능성**: 장애 발생 시 동일한 환경을 다시 구축하기 어렵다. "이 서버에서만 동작하는" 상황이 발생한다
4. **감사 불가**: 누가, 언제, 어떤 변경을 했는지 추적할 수 없다

IaC는 이 모든 문제를 해결한다. 코드는 버전 관리 시스템(Git)에 저장되므로 변경 이력이 추적되고, 코드 리뷰를 통해 변경 사항을 검증할 수 있으며, 동일한 코드를 실행하면 항상 동일한 결과를 얻을 수 있다.

IaC 도구는 크게 두 가지 카테고리로 나뉜다.

| 카테고리 | 도구 | 초점 |
|---------|------|------|
| **Infrastructure Provisioning** | Terraform, CloudFormation, Pulumi | VM, 네트워크, 스토리지 등 인프라 리소스 생성 |
| **Configuration Management** | Ansible, Chef, Puppet, Salt | OS 설정, 패키지 설치, 서비스 구성 |

Terraform은 Infrastructure Provisioning 카테고리에 속한다. 인프라 리소스를 생성하고 관리하는 데 특화되어 있다. OS 내부 설정은 cloud-init, Ansible 등과 결합하여 처리하는 것이 일반적이다.

#### IaC의 핵심 원칙

```
1. 모든 인프라는 코드로 정의한다
   → 수동 작업 금지 (ClickOps 금지)

2. 코드는 버전 관리 시스템에 저장한다
   → Git으로 변경 이력 추적

3. 변경 사항은 리뷰를 거친다
   → Pull Request를 통한 인프라 변경 리뷰

4. 테스트를 자동화한다
   → Plan 검증, 정책 검사, 통합 테스트

5. 동일한 코드는 동일한 결과를 보장한다
   → 멱등성(Idempotency) 원칙
```

### 1.2 선언적 vs 명령형

IaC에서 가장 중요한 구분은 **선언적(Declarative)** 접근과 **명령형(Imperative)** 접근의 차이이다.

#### 명령형(Imperative) - "어떻게(HOW)" 기술

```bash
# Bash 스크립트 (명령형): VM 3대를 생성하는 과정을 단계별로 기술
#!/bin/bash
for i in 1 2 3; do
  # 1단계: VM이 이미 존재하는지 확인
  if ! tart list | grep -q "worker-$i"; then
    # 2단계: 존재하지 않으면 이미지 클론
    tart clone ghcr.io/cirruslabs/ubuntu:latest "worker-$i"
    # 3단계: CPU/메모리 설정
    tart set "worker-$i" --cpu 2 --memory 4096
    # 4단계: VM 시작
    tart run --no-graphics "worker-$i" &
  else
    echo "worker-$i already exists"
    # 5단계: 기존 VM의 설정이 다르면 업데이트
    CURRENT_CPU=$(tart get "worker-$i" --cpu)
    if [ "$CURRENT_CPU" != "2" ]; then
      tart stop "worker-$i"
      tart set "worker-$i" --cpu 2
      tart run --no-graphics "worker-$i" &
    fi
  fi
done
```

명령형의 문제점은 다음과 같다.
- **순서 의존적**: 단계의 순서가 바뀌면 결과가 달라진다
- **에러 처리 부담**: 각 단계에서 발생할 수 있는 모든 에러를 개발자가 처리해야 한다
- **부분 실패 복구 어려움**: 3번째 VM 생성 중 실패하면 1, 2번은 이미 생성된 상태이다. 재실행 로직이 복잡해진다
- **상태 추적 불가**: 스크립트만으로는 현재 인프라 상태를 알 수 없다

#### 선언적(Declarative) - "무엇(WHAT)"만 기술

```hcl
# Terraform (선언적): 원하는 최종 상태만 기술
resource "tart_vm" "worker" {
  count  = 3
  name   = "worker-${count.index + 1}"
  image  = "ghcr.io/cirruslabs/ubuntu:latest"
  cpu    = 2
  memory = 4096
}
# VM이 없으면 → 생성
# VM이 있고 설정이 다르면 → 수정
# VM이 있고 설정이 같으면 → 아무것도 하지 않음
# 코드에 없는 VM이 State에 있으면 → 삭제
```

선언적 접근의 장점은 다음과 같다.
- **의도 명확**: 코드를 읽으면 최종 상태가 즉시 파악된다
- **자동 상태 관리**: 현재 상태에서 원하는 상태로의 변환 경로를 도구가 계산한다
- **에러 복구**: 중간에 실패해도 다시 실행하면 나머지 작업을 이어서 진행한다
- **Plan 가능**: 실제 적용 전에 무엇이 변경될지 미리 확인할 수 있다

#### 비교 정리

| 관점 | 명령형 (Bash/Ansible) | 선언적 (Terraform/CloudFormation) |
|------|---------------------|----------------------------------|
| 기술 대상 | 절차(HOW) | 결과(WHAT) |
| 상태 추적 | 직접 구현 필요 | State 파일로 자동 추적 |
| 멱등성 | 개발자가 보장해야 한다 | 도구가 보장한다 |
| Plan/Preview | 없음 (dry-run은 제한적) | `terraform plan`으로 정확한 변경 미리보기 |
| 학습 곡선 | 낮다 (셸 스크립트) | 높다 (DSL 학습 필요) |
| 복잡한 로직 | 자유롭게 작성 가능 | 제한적 (HCL의 한계) |

### 1.3 멱등성(Idempotency)

멱등성은 **동일한 작업을 여러 번 수행해도 결과가 동일**한 성질이다. 수학적으로 표현하면 `f(f(x)) = f(x)`이다. IaC에서 멱등성이 중요한 이유는 다음과 같다.

```
시나리오: terraform apply 중 네트워크 오류로 중단됨

멱등성이 없는 도구:
  1차 실행: VM 3대 중 2대 생성 → 실패
  2차 실행: VM 3대를 다시 생성 시도 → 이미 존재하는 2대와 충돌 → 에러

멱등성이 있는 도구 (Terraform):
  1차 실행: VM 3대 중 2대 생성 → 실패 (State에 2대 기록)
  2차 실행: State 확인 → 2대는 이미 존재 → 나머지 1대만 생성 → 성공
```

Terraform은 State 파일을 통해 멱등성을 구현한다. 매 실행 시 다음 과정을 거친다.

1. State 파일에서 현재 관리 중인 리소스 목록을 읽는다
2. Provider의 Read 연산으로 실제 인프라 상태를 확인한다
3. 코드에 정의된 원하는 상태와 비교한다
4. 차이가 있는 부분만 변경한다 (Create/Update/Delete)
5. 변경 결과를 State 파일에 기록한다

이 과정 덕분에 `terraform apply`를 100번 실행해도 결과는 동일하다. 변경할 것이 없으면 "No changes. Your infrastructure matches the configuration." 메시지가 출력된다.

#### 멱등성이 깨지는 경우

Terraform에서도 멱등성이 보장되지 않는 예외 상황이 존재한다.

```hcl
# 1. Provisioner 사용 시 (deprecated인 이유 중 하나)
resource "null_resource" "example" {
  provisioner "local-exec" {
    command = "echo $(date) >> log.txt"  # 실행할 때마다 새 줄이 추가된다
  }
}

# 2. 외부 상태에 의존하는 Data Source
data "http" "api" {
  url = "https://api.example.com/latest"  # API 응답이 매번 달라질 수 있다
}

# 3. Random Provider 사용 시 (의도적으로 멱등성을 포기)
resource "random_password" "db" {
  length = 16
  # 한번 생성되면 State에 저장되어 멱등성이 유지되지만,
  # State를 잃으면 새로운 패스워드가 생성된다
}
```

### 1.4 Drift Detection과 State Reconciliation

#### Configuration Drift란?

Drift는 Terraform이 관리하는 인프라의 실제 상태가 코드(`.tf`)나 State 파일에 기록된 상태와 달라지는 현상이다. 다음과 같은 상황에서 발생한다.

```
Drift 발생 시나리오:

1. 수동 변경 (가장 흔한 원인)
   → AWS 콘솔에서 직접 Security Group 규칙을 변경
   → kubectl로 직접 리소스를 수정

2. 외부 시스템에 의한 변경
   → Auto Scaling이 인스턴스 수를 변경
   → Kubernetes Operator가 리소스를 수정

3. 다른 도구에 의한 변경
   → Ansible이 Terraform이 관리하는 서버의 패키지를 업데이트
   → CI/CD 파이프라인이 설정을 덮어쓰기
```

#### Terraform의 Drift Detection 메커니즘

Terraform은 `plan` 또는 `apply` 실행 시 자동으로 drift를 감지한다. 내부적으로는 다음 과정이 일어난다.

```
terraform plan 실행 시:

1. State 파일 로드
   └─► 마지막으로 알고 있는 인프라 상태를 메모리에 로드

2. State Refresh (기본 동작)
   └─► 각 리소스에 대해 Provider의 Read 연산을 호출
   └─► 실제 인프라의 현재 상태를 가져옴
   └─► Drift 감지: State와 실제 상태가 다르면 State를 업데이트

3. Diff 계산
   └─► Configuration (.tf) vs Refreshed State 비교
   └─► 변경 필요한 리소스 식별

4. Plan 출력
   └─► 어떤 리소스가 create/update/destroy되는지 표시
   └─► Drift에 의한 변경은 "~ update in-place"로 표시
```

```bash
# Drift를 포함한 상세 Plan 확인
terraform plan -detailed-exitcode
# Exit code 0: 변경 없음
# Exit code 1: 에러 발생
# Exit code 2: 변경 있음 (drift 포함)

# Refresh만 수행하여 drift 확인 (인프라 변경 없음)
terraform plan -refresh-only
# State와 실제 인프라 차이만 보여준다
# apply -refresh-only 하면 State만 업데이트한다
```

#### State Reconciliation

State Reconciliation은 State 파일을 실제 인프라 상태와 일치시키는 과정이다.

```hcl
# 시나리오: AWS 콘솔에서 VM의 instance_type을 수동으로 t3.large로 변경

# Terraform 코드에는 t3.micro로 정의되어 있음
resource "aws_instance" "web" {
  instance_type = "t3.micro"  # 코드의 의도
}

# terraform plan 결과:
# ~ aws_instance.web
#     instance_type: "t3.large" -> "t3.micro"
#     # 실제 상태(t3.large)를 코드의 의도(t3.micro)로 되돌린다

# 만약 수동 변경을 유지하고 싶다면:
# 1. 코드를 수정하여 t3.large로 맞추거나
# 2. ignore_changes를 사용하여 해당 속성 변경을 무시한다
```

State Reconciliation 전략은 크게 세 가지이다.

| 전략 | 방법 | 적합한 상황 |
|------|------|-----------|
| 코드 우선 | `terraform apply` 실행 | Terraform이 유일한 변경 경로인 경우 |
| 실제 상태 수용 | `terraform apply -refresh-only` | 수동 변경을 인정하는 경우 |
| 선택적 무시 | `ignore_changes` lifecycle | 외부에서 관리하는 속성이 있는 경우 |

### 1.5 Terraform이란?

Terraform은 HashiCorp이 2014년에 발표한 선언적 IaC 도구이다. Go 언어로 작성되었으며, 단일 바이너리로 배포된다. 주요 특징은 다음과 같다.

- **HCL(HashiCorp Configuration Language)**: 인프라를 정의하는 전용 DSL(Domain Specific Language)이다. JSON 호환 문법도 지원한다
- **Provider 생태계**: 4,000개 이상의 Provider를 통해 AWS, GCP, Azure, Kubernetes, GitHub 등 다양한 인프라를 관리한다
- **State 기반 관리**: JSON 형식의 State 파일로 인프라 상태를 추적한다
- **Plan & Apply**: 변경 사항을 미리 확인(Plan)한 후 적용(Apply)하는 안전한 워크플로우를 제공한다
- **Module 시스템**: 재사용 가능한 인프라 패키지를 만들 수 있다

#### 라이선스 변경과 OpenTofu

2023년 8월, HashiCorp은 Terraform을 포함한 자사 제품의 라이선스를 MPL 2.0에서 BSL(Business Source License) 1.1로 변경하였다. v1.5.6이 마지막 MPL 버전이다.

이에 대응하여 Linux Foundation 산하에서 **OpenTofu**가 포크되었다. OpenTofu는 CNCF Sandbox 프로젝트이며, MPL 2.0 라이선스를 유지한다. Terraform과의 주요 차이점은 다음과 같다.

| 항목 | Terraform | OpenTofu |
|------|-----------|----------|
| 라이선스 | BSL 1.1 (v1.6+) | MPL 2.0 |
| 관리 | HashiCorp (IBM 인수) | Linux Foundation / CNCF |
| State 암호화 | 미지원 (Backend 암호화만) | 네이티브 State 암호화 지원 |
| 기능 호환성 | 기준 | v1.6 기준으로 대부분 호환 |
| CLI 명령어 | `terraform` | `tofu` |

### 1.6 핵심 개념 총정리

| 개념 | 설명 |
|------|------|
| Provider | 인프라 API와 통신하는 플러그인이다 (aws, null, helm, local 등) |
| Resource | Terraform이 생성하고 관리하는 인프라 요소이다 (VM, 네트워크, 저장소 등) |
| Data Source | 외부에서 읽어오는 읽기 전용 데이터이다 |
| State | 현재 인프라 상태를 기록한 JSON 파일이다 (terraform.tfstate) |
| Plan | 변경사항을 미리 확인하는 단계이다 (dry-run) |
| Module | 재사용 가능한 인프라 코드 패키지이다 |
| Variable | 설정값을 외부에서 주입할 수 있는 변수이다 |
| Output | 다른 모듈이나 사용자에게 값을 출력하는 선언이다 |
| Local | 모듈 내부에서만 사용하는 계산된 값이다 |
| Backend | State를 저장하는 위치를 결정하는 설정이다 |
| Provisioner | 리소스 생성 후 스크립트를 실행하는 기능이다 (deprecated) |
| 멱등성 | 같은 코드를 여러 번 실행해도 동일한 결과를 보장하는 성질이다 |
| Drift | 실제 인프라와 코드/State 사이의 불일치이다 |
| DAG | 리소스 간 의존관계를 표현하는 방향 비순환 그래프이다 |

---

## Part 2: 이 프로젝트에서의 실습 환경

이 프로젝트 전체가 Terraform으로 관리된다. 4개의 Kubernetes 클러스터(platform, dev, staging, prod)를 Tart VM 위에 구축하며, 3단계 오케스트레이션 패턴을 사용한다.

```
프로젝트 Terraform 구조:
terraform/
├── main.tf              ← 3단계 오케스트레이션 (VM → K8s → Helm)
├── variables.tf         ← 클러스터 설정 변수
├── providers.tf         ← Provider 정의 (null, helm, local)
├── outputs.tf           ← VM IP, kubeconfig, 접근 URL 출력
├── terraform.tfvars     ← 프로젝트 루트 경로 등 변수값
└── modules/
    ├── tart-vm/         ← Phase 1: Tart VM 생성/관리
    ├── k8s-cluster/     ← Phase 2: kubeadm 클러스터 구축
    └── helm-releases/   ← Phase 3: 모니터링/CI-CD Helm 배포
```

#### Phase 1: tart-vm 모듈 분석

tart-vm 모듈은 `null_resource`와 `local-exec` provisioner를 사용하여 Tart VM을 관리한다. Tart에는 공식 Terraform Provider가 존재하지만, 이 프로젝트에서는 `null_resource` 패턴으로 CLI 기반 VM 관리를 구현한다.

```hcl
# terraform/modules/tart-vm/main.tf (실제 코드)
locals {
  # flatten + for: 중첩된 클러스터/노드 구조를 평탄화한다
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
  # map 변환: 노드 이름을 키로 하는 맵을 생성한다
  node_map = { for n in local.all_nodes : n.node_name => n }
}

# VM 클론 + 설정 (for_each로 모든 노드에 대해 실행)
resource "null_resource" "vm_clone" {
  for_each = local.node_map
  triggers = {
    vm_name    = each.key
    base_image = var.base_image
    cpu        = each.value.cpu
    memory     = each.value.memory
  }
  # ... provisioner로 tart clone, tart set 실행
}
```

핵심 패턴은 다음과 같다.
- `flatten` + `for`: 중첩된 `list(object)` 구조를 1차원 리스트로 변환한다
- `for_each` + `node_map`: 각 노드에 대해 독립적인 리소스 인스턴스를 생성한다
- `triggers`: 트리거 값이 변경되면 리소스를 재생성한다 (destroy + create)
- `data "local_file"`: 파일에 저장된 VM IP를 읽어서 output으로 전달한다

#### Phase 2: k8s-cluster 모듈 분석

```hcl
# terraform/modules/k8s-cluster/main.tf (실제 코드)
locals {
  # 클러스터별 마스터 노드를 식별한다
  masters = {
    for n in local.all_nodes : n.cluster_name => n.node_name
    if n.role == "master"
  }
}

# depends_on 체인으로 순서를 보장한다
# ssh_wait → prepare_node → install_runtime → install_kubeadm → init_cluster → install_cilium
```

이 모듈은 `depends_on`을 활용한 순차 실행 패턴을 보여준다. 각 단계가 이전 단계에 의존하므로 반드시 순서대로 실행되어야 한다.

#### Phase 3: helm-releases 모듈 분석

```hcl
# terraform/modules/helm-releases/main.tf (실제 코드)
resource "helm_release" "kube_prometheus_stack" {
  name       = "kube-prometheus-stack"
  repository = "https://prometheus-community.github.io/helm-charts"
  chart      = "kube-prometheus-stack"
  namespace  = "monitoring"
  create_namespace = true
  values = [file("${var.project_root}/manifests/monitoring-values.yaml")]
}
```

`helm_release`는 Terraform의 Helm Provider가 제공하는 네이티브 리소스이다. `null_resource` + provisioner 패턴과 달리 State에서 리소스 상태를 정확하게 추적한다.

#### 3단계 오케스트레이션

```hcl
# terraform/main.tf (실제 코드) - depends_on으로 Phase 순서 보장
module "vms" {
  source = "./modules/tart-vm"
  # ...
}

module "k8s" {
  source     = "./modules/k8s-cluster"
  depends_on = [module.vms]          # VM이 먼저 생성되어야 한다
  vm_ips     = module.vms.vm_ips     # Phase 1의 output을 input으로 전달
  # ...
}

module "helm" {
  source     = "./modules/helm-releases"
  depends_on = [module.k8s]          # 클러스터가 먼저 구축되어야 한다
  vm_ips     = module.vms.vm_ips
  # ...
}
```

```bash
# Terraform 상태 확인
cd terraform
terraform plan
terraform output

# 특정 모듈만 적용
terraform apply -target=module.tart_vms

# 전체 인프라 구축
terraform apply

# 특정 VM만 재생성
terraform apply -target='module.vms.null_resource.vm_clone["platform-worker1"]'
```

#### 프로젝트에서 사용하는 Provider

```hcl
# terraform/providers.tf (실제 코드)
terraform {
  required_version = ">= 1.5"
  required_providers {
    null = { source = "hashicorp/null", version = "~> 3.2" }
    helm = { source = "hashicorp/helm", version = "~> 2.12" }
    local = { source = "hashicorp/local", version = "~> 2.4" }
  }
}
```

| Provider | 역할 |
|----------|------|
| null | `null_resource`로 셸 스크립트 실행을 관리한다 |
| helm | Helm Chart를 Terraform 리소스로 배포한다 |
| local | 로컬 파일 읽기/쓰기를 수행한다 (`data "local_file"`) |

#### 프로젝트의 Output 구조

```hcl
# terraform/outputs.tf (실제 코드)
output "vm_ips" {
  description = "Map of VM name to IP address"
  value       = module.vms.vm_ips
}

output "cluster_kubeconfigs" {
  description = "Kubeconfig paths per cluster"
  value = {
    for cluster in var.clusters : cluster.name =>
      "${local.kubeconfig_dir}/${cluster.name}.yaml"
  }
}

output "access_urls" {
  description = "Service access URLs"
  value = {
    grafana      = "http://${lookup(module.vms.vm_ips, "platform-worker1", "unknown")}:30300"
    argocd       = "http://${lookup(module.vms.vm_ips, "platform-worker1", "unknown")}:30800"
    jenkins      = "http://${lookup(module.vms.vm_ips, "platform-worker1", "unknown")}:30900"
    alertmanager = "http://${lookup(module.vms.vm_ips, "platform-worker1", "unknown")}:30903"
  }
}
```

`for` 표현식과 `lookup` 함수를 사용하여 동적으로 URL을 구성하는 패턴이다. `lookup`의 세 번째 인자(`"unknown"`)는 키가 없을 때의 기본값이다.

---

