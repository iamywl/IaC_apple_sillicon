# Day 7: CI/CD, 보안, 성능 최적화, 트러블슈팅

GitHub Actions/Atlantis/Terraform Cloud CI/CD 연동, Secrets Management와 OIDC, Policy as Code, 성능 최적화(Parallelism, Targeted Apply, State Splitting), 그리고 트러블슈팅을 다룬다.

---

## Part 15: CI/CD Integration

### 15.1 GitHub Actions

```yaml
# .github/workflows/terraform.yml
name: Terraform

on:
  pull_request:
    paths:
      - 'terraform/**'
  push:
    branches: [main]
    paths:
      - 'terraform/**'

permissions:
  contents: read
  pull-requests: write

jobs:
  plan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: hashicorp/setup-terraform@v3
        with:
          terraform_version: 1.9.0

      - name: Terraform Init
        working-directory: terraform
        run: terraform init

      - name: Terraform Format Check
        working-directory: terraform
        run: terraform fmt -check -recursive

      - name: Terraform Validate
        working-directory: terraform
        run: terraform validate

      - name: Terraform Plan
        id: plan
        working-directory: terraform
        run: terraform plan -no-color -out=tfplan
        env:
          TF_VAR_project_root: ${{ github.workspace }}

      - name: Comment Plan on PR
        if: github.event_name == 'pull_request'
        uses: actions/github-script@v7
        with:
          script: |
            const plan = `${{ steps.plan.outputs.stdout }}`;
            const body = `### Terraform Plan
            \`\`\`
            ${plan.substring(0, 65000)}
            \`\`\``;
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: body
            });

  apply:
    needs: plan
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4

      - uses: hashicorp/setup-terraform@v3

      - name: Terraform Init
        working-directory: terraform
        run: terraform init

      - name: Terraform Apply
        working-directory: terraform
        run: terraform apply -auto-approve
        env:
          TF_VAR_project_root: ${{ github.workspace }}
```

#### AWS OIDC 인증 패턴

```yaml
# GitHub Actions에서 AWS에 OIDC로 인증 (시크릿 키 불필요)
jobs:
  deploy:
    permissions:
      id-token: write
      contents: read
    steps:
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789012:role/GitHubActions
          aws-region: ap-northeast-2

      - name: Terraform Apply
        run: terraform apply -auto-approve
```

### 15.2 Atlantis

Atlantis는 Terraform의 Pull Request 자동화 도구이다. PR에 코멘트를 달면 Plan/Apply를 자동 실행한다.

```yaml
# atlantis.yaml
version: 3
projects:
  - name: tart-infra
    dir: terraform
    workspace: default
    terraform_version: v1.9.0
    autoplan:
      when_modified:
        - "*.tf"
        - "*.tfvars"
        - "modules/**/*.tf"
      enabled: true
    apply_requirements:
      - approved        # PR 승인 필요
      - mergeable       # PR가 머지 가능한 상태
```

```
Atlantis 워크플로우:

1. 개발자가 .tf 파일을 수정하고 PR 생성
2. Atlantis가 자동으로 terraform plan 실행
3. Plan 결과를 PR 코멘트로 게시
4. 팀원이 코드 리뷰 및 Plan 결과 확인
5. 승인 후 PR에 "atlantis apply" 코멘트
6. Atlantis가 terraform apply 실행
7. 결과를 PR 코멘트로 게시
8. PR 머지
```

### 15.3 Terraform Cloud / Enterprise

```
Terraform Cloud 워크플로우:

┌─────────┐    ┌──────────────┐    ┌──────────────┐
│   Git   │───►│  TF Cloud    │───►│   Apply      │
│  Push   │    │  Plan (remote│    │  (approval   │
│         │    │   execution) │    │   required)  │
└─────────┘    └──────────────┘    └──────────────┘
                      │
                ┌─────▼─────┐
                │  Policy   │
                │  Check    │    ← Sentinel / OPA
                │ (optional)│
                └───────────┘

주요 기능:
- Remote State 관리 (암호화, 잠금, 버전 관리)
- Remote Execution (클라우드에서 Plan/Apply 실행)
- VCS Integration (GitHub, GitLab, Bitbucket 연동)
- Private Registry (내부 모듈/프로바이더 배포)
- Policy as Code (Sentinel, OPA)
- Cost Estimation (리소스 비용 추정)
- Team Management (역할 기반 접근 제어)
- Run Triggers (Workspace 간 연쇄 실행)
```

### 15.4 GitOps 패턴

```
GitOps for Infrastructure:

1. 모든 인프라 변경은 PR을 통해서만 수행한다
2. main 브랜치가 "desired state"를 나타낸다
3. PR에서 Plan을 자동 실행하고 결과를 리뷰한다
4. 머지 시 자동으로 Apply를 실행한다
5. Drift Detection을 정기적으로 수행한다

┌──────────┐   PR   ┌──────────┐  Merge  ┌──────────┐
│Developer │──────►│  Review  │───────►│  Apply   │
│ Branch   │       │  + Plan  │        │ (auto)   │
└──────────┘       └──────────┘        └──────────┘
                                              │
                                       ┌──────▼──────┐
                                       │ Drift Check │ ← 주기적 실행
                                       │ (scheduled) │
                                       └─────────────┘
```

---

## Part 16: 보안

### 16.1 Secrets Management

Terraform에서 민감한 값을 안전하게 관리하는 방법은 다음과 같다.

```hcl
# 방법 1: 환경변수로 전달 (CI/CD 시크릿)
# export TF_VAR_db_password="secret"
variable "db_password" {
  type      = string
  sensitive = true
}

# 방법 2: Vault에서 동적으로 가져오기
data "vault_generic_secret" "db" {
  path = "secret/data/database"
}

resource "aws_db_instance" "main" {
  password = data.vault_generic_secret.db.data["password"]
}

# 방법 3: AWS Secrets Manager
data "aws_secretsmanager_secret_version" "db" {
  secret_id = "prod/database/password"
}

resource "aws_db_instance" "main" {
  password = jsondecode(data.aws_secretsmanager_secret_version.db.secret_string)["password"]
}

# 방법 4: SOPS (Mozilla) 암호화된 파일
data "sops_file" "secrets" {
  source_file = "secrets.enc.yaml"
}

# 방법 5: 1Password (1Password CLI + Provider)
data "onepassword_item" "db" {
  vault = "Infrastructure"
  title = "Database Credentials"
}

# 이 프로젝트에서의 접근 (sensitive 변수 + 기본값)
variable "ssh_password" {
  type      = string
  default   = "admin"
  sensitive = true    # plan/apply 출력에서 마스킹
}
```

#### 절대 하지 말아야 할 것

```hcl
# 코드에 시크릿 하드코딩 (절대 금지)
provider "aws" {
  access_key = "AKIAIOSFODNN7EXAMPLE"          # 절대 금지!
  secret_key = "wJalrXUtnFEMI/K7MDENG/bPxRfiCY" # 절대 금지!
}

# .tfvars에 시크릿을 넣고 Git에 커밋 (절대 금지)
# terraform.tfvars
# db_password = "my-secret-password"
# → .gitignore에 *.tfvars 추가하거나 *.auto.tfvars만 제외
```

### 16.2 OIDC Authentication

OIDC(OpenID Connect)를 사용하면 장기 자격 증명(Access Key) 없이 클라우드에 인증할 수 있다.

```hcl
# AWS OIDC Provider 설정 (GitHub Actions용)
resource "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"

  client_id_list = ["sts.amazonaws.com"]

  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}

# OIDC를 사용하는 IAM Role
resource "aws_iam_role" "github_actions" {
  name = "GitHubActionsRole"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Federated = aws_iam_openid_connect_provider.github.arn
      }
      Action = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
        }
        StringLike = {
          "token.actions.githubusercontent.com:sub" = "repo:myorg/tart-infra:*"
        }
      }
    }]
  })
}

# Terraform State 접근 권한
resource "aws_iam_role_policy" "terraform_state" {
  role = aws_iam_role.github_actions.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:ListBucket",
        ]
        Resource = [
          "arn:aws:s3:::my-terraform-state",
          "arn:aws:s3:::my-terraform-state/*",
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:DeleteItem",
        ]
        Resource = "arn:aws:dynamodb:*:*:table/terraform-locks"
      }
    ]
  })
}
```

### 16.3 Policy as Code

#### Sentinel (HashiCorp)

Sentinel은 Terraform Cloud/Enterprise에서 사용하는 정책 언어이다.

```sentinel
# policy/require-tags.sentinel
import "tfplan/v2" as tfplan

# 모든 EC2 인스턴스에 필수 태그가 있는지 확인
required_tags = ["Environment", "Owner", "Project"]

ec2_instances = filter tfplan.resource_changes as _, rc {
    rc.type is "aws_instance" and
    (rc.change.actions contains "create" or rc.change.actions contains "update")
}

deny_missing_tags = rule {
    all ec2_instances as _, instance {
        all required_tags as tag {
            instance.change.after.tags contains tag
        }
    }
}

main = rule {
    deny_missing_tags
}
```

#### OPA (Open Policy Agent) + Conftest

OPA는 CNCF 졸업 프로젝트로, 범용 정책 엔진이다. Rego 언어로 정책을 작성한다.

```rego
# policy/terraform.rego
package terraform

import future.keywords.in

# VM CPU는 16을 초과할 수 없다
deny[msg] {
    resource := input.resource_changes[_]
    resource.type == "tart_vm"
    resource.change.after.cpu > 16
    msg := sprintf("VM %s: CPU는 16을 초과할 수 없다 (현재: %d)", [resource.name, resource.change.after.cpu])
}

# 모든 리소스에 태그가 있어야 한다
deny[msg] {
    resource := input.resource_changes[_]
    resource.change.actions[_] == "create"
    not resource.change.after.tags
    msg := sprintf("리소스 %s.%s: 태그가 없다", [resource.type, resource.name])
}

# 금지된 리소스 타입
deny[msg] {
    resource := input.resource_changes[_]
    resource.type in ["aws_iam_user_login_profile", "aws_iam_access_key"]
    msg := sprintf("리소스 타입 %s는 사용 금지이다", [resource.type])
}
```

```bash
# OPA/Conftest를 CI에서 실행
terraform plan -out=tfplan
terraform show -json tfplan > tfplan.json
conftest test tfplan.json -p policy/ --all-namespaces
```

### 16.4 Drift Detection 자동화

```yaml
# .github/workflows/drift-detection.yml
name: Drift Detection

on:
  schedule:
    - cron: '0 */6 * * *'    # 6시간마다 실행

jobs:
  drift-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: hashicorp/setup-terraform@v3

      - name: Terraform Init
        working-directory: terraform
        run: terraform init

      - name: Check for Drift
        id: drift
        working-directory: terraform
        run: |
          terraform plan -detailed-exitcode -no-color 2>&1 | tee plan.txt
          echo "exit_code=$?" >> $GITHUB_OUTPUT
        continue-on-error: true

      - name: Notify on Drift
        if: steps.drift.outputs.exit_code == '2'
        run: |
          # Slack 알림 등
          echo "Drift detected! Check plan output."

      - name: Create Issue on Drift
        if: steps.drift.outputs.exit_code == '2'
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const plan = fs.readFileSync('terraform/plan.txt', 'utf8');
            github.rest.issues.create({
              owner: context.repo.owner,
              repo: context.repo.repo,
              title: 'Infrastructure Drift Detected',
              body: `### Drift Detection Alert\n\`\`\`\n${plan.substring(0, 60000)}\n\`\`\``,
              labels: ['drift', 'infrastructure']
            });
```

---

## Part 17: 성능 최적화

### 17.1 Parallelism 튜닝

```bash
# 기본 병렬 처리: 10개 리소스 동시 처리
terraform apply

# 병렬 처리 수 증가 (네트워크 I/O가 주 병목일 때)
terraform apply -parallelism=20

# 병렬 처리 수 감소 (API Rate Limit 문제 시)
terraform apply -parallelism=5

# 순차 처리 (디버깅 시)
terraform apply -parallelism=1

# 이 프로젝트에서: 11개 VM을 동시에 처리하려면
terraform apply -parallelism=15
```

#### 병렬 처리와 API Rate Limit

```
문제: AWS API Rate Limit 초과
  Error: Throttling: Rate exceeded

해결 방법:
1. parallelism 감소: terraform apply -parallelism=5
2. Provider의 retry 설정:
   provider "aws" {
     retry_mode  = "adaptive"
     max_retries = 10
   }
3. State 분리: 큰 인프라를 여러 State로 분리
```

### 17.2 Targeted Apply

특정 리소스만 대상으로 Plan/Apply를 실행한다. 대규모 인프라에서 부분 변경 시 유용하다.

```bash
# 특정 리소스만 대상
terraform apply -target='module.vms.null_resource.vm_clone["platform-master"]'

# 특정 모듈 전체
terraform apply -target=module.vms
terraform apply -target=module.k8s
terraform apply -target=module.helm

# 여러 대상
terraform apply \
  -target=module.vms \
  -target=module.k8s

# Plan에서 대상 확인
terraform plan -target=module.helm
```

주의: `-target`은 일시적 도구이다. 정상적인 워크플로우에서는 전체 Apply를 권장한다. `-target`을 자주 사용한다면 State 분리를 고려해야 한다.

### 17.3 State Splitting

대규모 인프라에서 State가 커지면 다음 문제가 발생한다.
- Plan/Apply 시간 증가 (모든 리소스에 대해 Refresh)
- State Locking 경합 (동시 작업 불가)
- Blast Radius 증가 (실수의 영향 범위가 넓음)

```
모놀리식 State (안 좋은 예):
terraform/
├── main.tf          # 모든 인프라가 하나의 State
├── network.tf
├── compute.tf
├── database.tf
├── kubernetes.tf
└── monitoring.tf

분리된 State (좋은 예):
terraform/
├── network/         # State 1: 네트워크 (VPC, Subnet, SG)
│   ├── main.tf
│   └── outputs.tf   # 다른 State에서 terraform_remote_state로 참조
├── compute/         # State 2: 컴퓨팅 (EC2, ASG)
│   └── main.tf
├── database/        # State 3: 데이터베이스 (RDS, ElastiCache)
│   └── main.tf
└── platform/        # State 4: 플랫폼 (K8s, Helm)
    └── main.tf
```

State 분리 기준은 다음과 같다.
- **변경 빈도**: 자주 변경되는 것과 거의 변경되지 않는 것을 분리한다
- **소유 팀**: 다른 팀이 관리하는 인프라는 분리한다
- **위험도**: 데이터베이스 같은 중요 리소스는 별도 State로 분리한다
- **의존 관계**: 의존성이 적은 그룹으로 분리한다

### 17.4 Provider Caching

```bash
# Provider 플러그인 캐시 설정 (~/.terraformrc)
plugin_cache_dir = "$HOME/.terraform.d/plugin-cache"

# 또는 환경변수로 설정
export TF_PLUGIN_CACHE_DIR="$HOME/.terraform.d/plugin-cache"

# 캐시 디렉토리 생성
mkdir -p ~/.terraform.d/plugin-cache

# CI/CD에서 Provider 캐시 (GitHub Actions 예시)
# - uses: actions/cache@v4
#   with:
#     path: ~/.terraform.d/plugin-cache
#     key: terraform-providers-${{ hashFiles('**/.terraform.lock.hcl') }}
```

#### Refresh 최적화

```bash
# Refresh를 건너뛰어 Plan 속도 향상
terraform plan -refresh=false

# State가 최신이라고 확신할 때만 사용
# Drift Detection이 별도로 수행되는 경우에 유용

# 특정 리소스만 Refresh
# (Terraform 1.x에서는 직접 지원하지 않음, target으로 우회)
terraform plan -refresh=true -target=module.vms
```

---

## Part 18: 트러블슈팅

### 18.1 Dependency Cycle

```
에러 메시지:
Error: Cycle: aws_security_group.a, aws_security_group.b
```

```hcl
# 순환 의존 예시 (에러 발생)
resource "aws_security_group" "a" {
  ingress {
    security_groups = [aws_security_group.b.id]  # B에 의존
  }
}

resource "aws_security_group" "b" {
  ingress {
    security_groups = [aws_security_group.a.id]  # A에 의존 → 순환!
  }
}

# 해결 방법 1: Security Group Rule을 별도 리소스로 분리
resource "aws_security_group" "a" {
  name = "sg-a"
}

resource "aws_security_group" "b" {
  name = "sg-b"
}

resource "aws_security_group_rule" "a_from_b" {
  type                     = "ingress"
  security_group_id        = aws_security_group.a.id
  source_security_group_id = aws_security_group.b.id
  from_port                = 443
  to_port                  = 443
  protocol                 = "tcp"
}

resource "aws_security_group_rule" "b_from_a" {
  type                     = "ingress"
  security_group_id        = aws_security_group.b.id
  source_security_group_id = aws_security_group.a.id
  from_port                = 443
  to_port                  = 443
  protocol                 = "tcp"
}

# 해결 방법 2: depends_on 제거 (불필요한 명시적 의존)
# depends_on이 과도하게 사용되면 순환이 생길 수 있다
```

```bash
# 의존 그래프 확인
terraform graph | dot -Tpng > graph.png
# 순환이 있는 부분을 시각적으로 확인

# 디버그 로그로 상세 분석
TF_LOG=TRACE terraform plan 2>&1 | grep -i cycle
```

### 18.2 State Corruption

```
에러 메시지:
Error: Failed to load state: ...
Error: state snapshot was created by Terraform v1.X.X, which is newer than current v1.Y.Y
```

```bash
# 시나리오 1: State 파일이 손상됨
# 백업에서 복원
terraform state pull > current.tfstate.backup  # 현재 State 백업
# S3 버전 관리에서 이전 버전 복원
aws s3api list-object-versions \
  --bucket my-terraform-state \
  --prefix prod/terraform.tfstate

aws s3api get-object \
  --bucket my-terraform-state \
  --key prod/terraform.tfstate \
  --version-id XXXXX \
  restored.tfstate

terraform state push restored.tfstate

# 시나리오 2: State의 serial이 맞지 않음
# 강제 push (주의: 다른 변경사항 덮어쓸 수 있음)
terraform state push -force modified.tfstate

# 시나리오 3: 잘못된 State로 인해 리소스가 고아 상태
# State에서 제거 후 다시 import
terraform state rm 'aws_instance.broken'
terraform import 'aws_instance.broken' 'i-1234567890'

# 시나리오 4: 완전히 새로 시작 (최후의 수단)
# 1. 기존 State 백업
terraform state pull > backup.tfstate
# 2. State 초기화
# 3. 모든 리소스를 import
```

### 18.3 Provider Version Conflict

```
에러 메시지:
Error: Failed to query available provider packages
Error: Inconsistent dependency lock file
```

```bash
# Lock 파일과 현재 설정이 맞지 않을 때
terraform init -upgrade

# 특정 Provider만 업그레이드
terraform init -upgrade -get-plugins=false

# Lock 파일 재생성
rm .terraform.lock.hcl
terraform init

# 다중 플랫폼 해시 추가 (CI/CD 환경)
terraform providers lock \
  -platform=linux_amd64 \
  -platform=darwin_arm64 \
  -platform=darwin_amd64

# Module의 Provider 요구사항 충돌
# Module A: aws >= 4.0
# Module B: aws < 5.0
# Root:     aws ~> 5.0
# → Module B를 업데이트하거나, 호환 버전 범위를 찾아야 한다
```

### 18.4 Plan/Apply 에러 패턴

```bash
# 1. "known after apply" 관련 에러
# for_each의 키가 다른 리소스의 output에 의존할 때
# 해결: for_each의 키를 Plan 시점에 알 수 있는 값으로 변경

# 2. "Resource already exists" 에러
# State에는 없지만 실제 인프라에 이미 존재할 때
# 해결: terraform import로 기존 리소스를 State에 등록

# 3. "Error: Provider produced inconsistent result"
# Apply 후 리소스 상태가 Plan과 다를 때 (Provider 버그 가능성)
# 해결: terraform apply -refresh-only로 State 동기화 후 재시도

# 4. Timeout 에러
# 리소스 생성/삭제가 지정된 시간 내에 완료되지 않을 때
resource "aws_db_instance" "main" {
  # ...
  timeouts {
    create = "60m"    # 기본값보다 긴 시간 설정
    delete = "60m"
  }
}

# 5. Permission 에러
# IAM 권한이 부족할 때
# 해결: 필요한 권한을 IAM 정책에 추가
# 디버깅: TF_LOG=DEBUG로 API 호출 확인

# 6. 디버그 로그 활용
TF_LOG=DEBUG terraform plan 2>&1 | tee debug.log
TF_LOG=TRACE terraform apply 2>&1 | tee trace.log

# 7. 특정 Provider의 디버그 로그만
TF_LOG_PROVIDER=TRACE terraform plan
TF_LOG_CORE=TRACE terraform plan
```

#### 일반적인 디버깅 플로우

```
1. 에러 메시지 확인
   └─► "Error:" 이후의 메시지를 정확히 읽는다

2. Plan 확인
   └─► terraform plan으로 변경 사항 재확인
   └─► -target으로 문제 리소스만 분리

3. State 확인
   └─► terraform state show 'resource.name'
   └─► State의 값과 코드의 값 비교

4. 디버그 로그
   └─► TF_LOG=DEBUG terraform plan
   └─► API 호출/응답 확인

5. 최소 재현
   └─► 문제가 되는 리소스만 남기고 나머지 주석 처리
   └─► 의존성 문제인지, 설정 문제인지 분리
```

---

