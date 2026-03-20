# Day 1: GitOps 원칙과 ArgoCD 개념

ArgoCD의 기본 개념, GitOps 4대 원칙 심화, Push vs Pull 모델 비교, 그리고 tart-infra 프로젝트에서의 ArgoCD 실습 환경을 다룬다.

---

# ArgoCD - GitOps CD

## 개념

### ArgoCD란?

- Kubernetes를 위한 선언적 GitOps CD(Continuous Delivery) 도구이다 (CNCF Graduated, 2022년 12월 졸업)
- Git 리포지토리를 Single Source of Truth로 사용한다
- 클러스터 상태를 Git과 자동으로 동기화한다
- 웹 UI, CLI, gRPC/REST API를 모두 제공한다
- Kubernetes controller 패턴으로 구현되어 있으며, CRD(Custom Resource Definition)를 통해 Application을 정의한다

### 핵심 개념

| 개념 | 설명 |
|------|------|
| GitOps | Git을 통해 인프라와 앱의 원하는 상태를 선언하는 방법론이다 |
| Application | ArgoCD가 관리하는 배포 단위이다 (source repo + destination cluster/namespace) |
| AppProject | Application을 논리적으로 그룹화하고 접근 제어를 적용하는 단위이다 |
| Sync | Git의 원하는 상태(Desired State)와 클러스터 실제 상태(Live State)를 일치시키는 행위이다 |
| Sync Policy | 자동/수동 동기화 정책이다 (Auto-Sync, Self-Heal, Auto-Prune) |
| Health Status | 리소스의 상태 (Healthy, Degraded, Progressing, Suspended, Missing, Unknown)이다 |
| Sync Status | Git과의 동기화 상태 (Synced, OutOfSync)이다 |
| App of Apps | Application을 관리하는 Application 패턴이다 |
| ApplicationSet | 템플릿 기반으로 다수의 Application을 자동 생성하는 리소스이다 |

---

## 1장: GitOps 원칙 심화

### GitOps란 무엇인가

GitOps는 2017년 Weaveworks의 Alexis Richardson이 처음 제안한 운영 방법론이다. 핵심 아이디어는 Git 리포지토리를 인프라와 애플리케이션의 "원하는 상태(Desired State)"를 저장하는 유일한 진실의 원천(Single Source of Truth)으로 사용하는 것이다. 모든 변경은 Git을 통해 이루어지고, 자동화된 에이전트가 Git의 상태를 실제 시스템에 반영한다.

### GitOps 4대 원칙

```
1. 선언적 (Declarative)
   → 원하는 상태를 YAML로 선언한다
   → 명령형(kubectl apply) 대신 선언형으로 모든 리소스를 정의한다
   → "어떻게(How)"가 아니라 "무엇(What)"을 기술한다
   → 예: "nginx replica 3개가 실행 중이어야 한다"

2. 버전 관리 (Versioned & Immutable)
   → 모든 변경 이력을 Git에 기록한다
   → 감사 추적(audit trail)이 자동으로 생성된다
   → 누가, 언제, 무엇을, 왜 변경했는지 Git 커밋 히스토리로 추적할 수 있다
   → 이전 상태로의 롤백이 git revert로 가능하다

3. 자동 적용 (Pulled Automatically)
   → Git 변경 시 자동으로 클러스터에 반영한다
   → 에이전트(ArgoCD)가 클러스터 내부에서 Pull 방식으로 동작한다
   → 외부에서 클러스터로 Push하는 것이 아니라, 클러스터 내부 에이전트가
     Git을 감시하고 변경 사항을 가져온다(Pull)

4. 자가 치유 (Continuously Reconciled)
   → 수동 변경을 감지하고 Git 상태로 복구한다
   → 컨트롤러가 지속적으로 원하는 상태와 실제 상태를 비교한다
   → 드리프트(drift)가 발생하면 자동으로 원래 상태로 되돌린다
```

### GitOps 원칙 심화 해설

#### Declarative (선언적)

선언적 방식은 시스템의 "원하는 최종 상태"를 기술한다. 명령형(imperative) 방식과의 차이를 이해하는 것이 중요하다.

```bash
# 명령형 방식 (Non-GitOps)
kubectl create deployment nginx --image=nginx:1.25
kubectl scale deployment nginx --replicas=3
kubectl expose deployment nginx --port=80 --type=LoadBalancer
kubectl set image deployment/nginx nginx=nginx:1.26
# 문제: 이 명령들의 실행 순서와 이력을 추적할 수 없다
# 문제: 다른 환경에서 동일한 상태를 재현하기 어렵다
```

```yaml
# 선언적 방식 (GitOps)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nginx
spec:
  replicas: 3
  selector:
    matchLabels:
      app: nginx
  template:
    metadata:
      labels:
        app: nginx
    spec:
      containers:
        - name: nginx
          image: nginx:1.26
          ports:
            - containerPort: 80
# 장점: 이 YAML 하나로 원하는 최종 상태가 완전히 기술된다
# 장점: 어떤 환경에서든 동일한 결과를 보장한다 (멱등성)
```

선언적 방식의 핵심 특성은 **멱등성(Idempotency)**이다. 동일한 선언을 여러 번 적용해도 결과가 동일하다. ArgoCD는 이 선언적 매니페스트를 Git에서 가져와 클러스터에 적용한다.

#### Versioned & Immutable (버전 관리 및 불변성)

Git은 모든 변경에 대해 자동으로 감사 추적(audit trail)을 생성한다.

```
커밋 해시    작성자         메시지                          시점
───────────────────────────────────────────────────────────────────
a1b2c3d     kim@team.com   feat: add nginx deployment      2024-01-15
d4e5f6g     lee@team.com   fix: increase replica to 3      2024-01-16
h7i8j9k     park@team.com  chore: update nginx to 1.26     2024-01-17
l0m1n2o     kim@team.com   feat: add HPA for nginx         2024-01-18
```

이 이력을 통해 다음이 가능하다:
- **변경 원인 추적**: 누가, 언제, 왜 변경했는지 커밋 메시지와 PR로 확인한다
- **롤백**: `git revert`로 이전 상태로 즉시 복구한다
- **코드 리뷰**: PR(Pull Request)을 통해 인프라 변경도 코드 리뷰를 거친다
- **규정 준수**: SOC 2, ISO 27001 등 컴플라이언스 감사에 활용한다

#### Pulled Automatically (자동 Pull)

GitOps에서 "Pull" 모델은 보안과 운영 양면에서 핵심적인 차별점이다.

```
[Push 모델 - 전통적 CI/CD]

  CI 서버 ───push───► Kubernetes Cluster
  (Jenkins)          (kubectl apply)

  문제점:
  - CI 서버에 클러스터 자격 증명(kubeconfig)을 저장해야 한다
  - CI 서버가 침해되면 클러스터도 위험하다
  - 네트워크에서 인바운드 접근을 허용해야 한다

[Pull 모델 - GitOps]

  Git Repo ◄───poll───  ArgoCD (클러스터 내부)
                         │
                         └──► Kubernetes API
                              (localhost 통신)

  장점:
  - 클러스터 자격 증명이 외부에 노출되지 않는다
  - ArgoCD가 클러스터 내부에서 동작하므로 인바운드 포트가 불필요하다
  - Git만 읽으면 되므로 최소 권한 원칙(Least Privilege)을 준수한다
```

#### Continuously Reconciled (지속적 조정)

Reconciliation은 Kubernetes controller 패턴의 핵심이다. ArgoCD Application Controller는 지속적으로 다음을 수행한다:

```
┌─────────────────────────────────────────────────────────┐
│                  Reconciliation Loop                     │
│                                                          │
│   1. Git에서 원하는 상태(Desired State)를 가져온다        │
│      ↓                                                   │
│   2. 클러스터에서 실제 상태(Live State)를 조회한다         │
│      ↓                                                   │
│   3. Desired vs Live를 비교(diff)한다                    │
│      ↓                                                   │
│   4-a. 동일하면 → Synced 상태, 다음 주기까지 대기한다     │
│   4-b. 다르면 → OutOfSync 상태                           │
│      ↓                                                   │
│   5. Auto-Sync가 활성화되어 있으면 자동으로 적용한다      │
│      Self-Heal이 활성화되어 있으면 수동 변경을 복구한다   │
│                                                          │
│   [3분 주기로 반복 또는 Webhook 이벤트 시 즉시 실행]      │
└─────────────────────────────────────────────────────────┘
```

### GitOps vs 전통적 CI/CD

전통적 CI/CD 파이프라인과 GitOps 방식의 차이를 상세히 비교한다.

| 항목 | 전통적 CI/CD (Push) | GitOps (Pull) |
|------|---------------------|---------------|
| 배포 트리거 | CI 파이프라인이 직접 배포 명령을 실행한다 | Git 변경을 감지한 에이전트가 배포한다 |
| 자격 증명 위치 | CI 서버에 kubeconfig/토큰을 저장한다 | 클러스터 내부 에이전트만 접근 권한을 가진다 |
| 감사 추적 | CI 로그에 의존한다 (유실 가능) | Git 히스토리가 영구적인 감사 로그이다 |
| 롤백 | 이전 빌드를 재실행하거나 수동으로 복구한다 | `git revert` 한 번으로 완료한다 |
| 드리프트 감지 | 별도 도구가 필요하다 (없는 경우가 많다) | 에이전트가 지속적으로 감지하고 복구한다 |
| 보안 | CI 서버가 공격 표면(attack surface)이 된다 | 외부 접근이 불필요하다 |
| 멀티 클러스터 | 파이프라인을 클러스터 수만큼 복제해야 한다 | 하나의 ArgoCD가 여러 클러스터를 관리한다 |
| 장애 복구 | 수동 프로세스가 필요한 경우가 많다 | Git에서 자동으로 원하는 상태를 복구한다 |

### Pull vs Push 모델 심화

#### Push 모델의 문제점

```
Developer ─► Git Push ─► CI Server (Jenkins/GitHub Actions)
                            │
                            ├─ Build
                            ├─ Test
                            └─ Deploy (kubectl apply / helm upgrade)
                                │
                                ▼
                          Kubernetes Cluster

문제 1: CI 서버에 클러스터 접근 권한이 필요하다
  - ServiceAccount 토큰 또는 kubeconfig를 CI 서버에 저장해야 한다
  - CI 서버가 침해되면 클러스터에 대한 full access가 노출된다

문제 2: 실제 상태와 원하는 상태의 불일치를 감지할 수 없다
  - 누군가 kubectl로 직접 변경한 것을 CI 서버는 알 수 없다
  - 시간이 지나면서 "설정 드리프트(configuration drift)"가 누적된다

문제 3: 롤백이 복잡하다
  - 이전 빌드를 찾아서 재실행해야 한다
  - 데이터 마이그레이션이 있었다면 단순 재실행으로는 부족하다

문제 4: 멀티 클러스터 배포가 복잡하다
  - 클러스터마다 별도 파이프라인을 구성해야 한다
  - 각 클러스터의 자격 증명을 모두 관리해야 한다
```

#### Pull 모델의 장점

```
Developer ─► Git Push ─► Git Repository
                              │
                         (ArgoCD가 Poll)
                              │
                              ▼
                      ArgoCD (클러스터 내부)
                              │
                    ┌─────────┼──────────┐
                    ▼         ▼          ▼
               Cluster-1  Cluster-2  Cluster-3

장점 1: 보안이 강화된다
  - 외부에서 클러스터로의 인바운드 접근이 불필요하다
  - ArgoCD만 Git repo에 대한 read-only 접근 권한이 있으면 된다
  - 자격 증명이 클러스터 내부의 Secret으로만 관리된다

장점 2: 드리프트 감지 및 자동 복구가 가능하다
  - ArgoCD가 3분마다 실제 상태와 Git 상태를 비교한다
  - Self-Heal이 활성화되면 수동 변경을 자동으로 복구한다

장점 3: 롤백이 간단하다
  - git revert으로 이전 상태를 선언한다
  - ArgoCD가 자동으로 해당 상태를 클러스터에 적용한다

장점 4: 멀티 클러스터 관리가 용이하다
  - 하나의 ArgoCD 인스턴스에서 여러 클러스터를 관리할 수 있다
  - ApplicationSet을 통해 클러스터별 차이를 템플릿으로 관리한다
```

### CI와 CD의 분리

GitOps에서는 CI(Continuous Integration)와 CD(Continuous Delivery)를 명확히 분리하는 것이 핵심 패턴이다.

```
┌─────────────────────────────────┐     ┌──────────────────────────────┐
│         CI (Jenkins 등)         │     │        CD (ArgoCD)           │
│                                 │     │                              │
│  1. 코드 체크아웃               │     │  1. Git 리포 감시 (Poll)     │
│  2. 빌드                       │     │  2. 매니페스트 렌더링         │
│  3. 테스트 (unit, integration) │     │  3. Diff 계산                │
│  4. 컨테이너 이미지 빌드       │     │  4. Sync (Apply)             │
│  5. 이미지 레지스트리에 Push    │     │  5. Health Check             │
│  6. 매니페스트 업데이트         │     │  6. 자가 치유                │
│     (이미지 태그 변경)          │     │                              │
│  7. Config 리포에 커밋          │     │                              │
└─────────────────────────────────┘     └──────────────────────────────┘
          │                                         │
          └─── Config Git Repo ────────────────────┘
```

이 패턴에서 중요한 점은 다음과 같다:
- CI 파이프라인은 클러스터에 직접 접근하지 않는다
- CI의 결과물은 "이미지 빌드"와 "매니페스트 업데이트"이다
- CD(ArgoCD)는 매니페스트 리포지토리의 변경만 감지하고 적용한다
- 관심사의 분리(Separation of Concerns)가 명확하다

이 프로젝트에서는 Jenkins가 CI를 담당하고 ArgoCD가 CD를 담당한다. Jenkins는 `jenkins` 네임스페이스에, ArgoCD는 `argocd` 네임스페이스에 각각 배포된다.

---

## 이 프로젝트에서의 실습 환경

이 프로젝트에서 ArgoCD는 platform 클러스터의 `argocd` 네임스페이스에 배포된다.

- 설치 스크립트: `scripts/install/08-install-cicd.sh`
- Helm Chart: `argo/argo-cd`
- Helm Values: `manifests/argocd-values.yaml`
- NodePort: 30800
- Dex(외부 인증): 비활성화
- 데모 Application: `manifests/argocd/demo-app.yaml` (GitHub 리포지토리에서 `manifests/demo` 경로를 auto-sync)
- 실습 대상 클러스터: platform (`kubeconfig/platform.yaml`)
- API Server 실행 옵션: `--insecure` (TLS 없이 HTTP로 서비스, 개발 환경 전용)

### Helm Values 설정 분석

이 프로젝트의 ArgoCD Helm values(`manifests/argocd-values.yaml`)는 다음과 같이 구성되어 있다:

```yaml
server:
  service:
    type: NodePort
    nodePortHttp: 30800       # 외부 접근용 NodePort
  extraArgs:
    - --insecure              # TLS 비활성화 (개발 환경)

controller:
  resources:
    requests:
      cpu: 100m
      memory: 256Mi
    limits:
      memory: 1Gi             # Application Controller 메모리 제한

repoServer:
  resources:
    requests:
      cpu: 50m
      memory: 128Mi
    limits:
      memory: 512Mi           # Repo Server 메모리 제한

redis:
  resources:
    requests:
      cpu: 50m
      memory: 64Mi
    limits:
      memory: 256Mi           # Redis 메모리 제한

dex:
  enabled: false              # SSO 비활성화
```

각 컴포넌트의 리소스 설정 의미는 다음과 같다:
- **controller**: 메모리 1Gi로 제한한다. 관리하는 Application 수가 많아지면 이 값을 늘려야 한다
- **repoServer**: 메모리 512Mi로 제한한다. 대규모 Helm chart 렌더링 시 OOMKilled가 발생할 수 있다
- **redis**: 메모리 256Mi로 제한한다. 캐시 전용이므로 소규모 환경에서는 충분하다
- **dex**: 비활성화되어 있다. SSO가 필요하면 `enabled: true`로 변경하고 connector를 설정한다

### 데모 Application 분석

`manifests/argocd/demo-app.yaml` 파일은 이 프로젝트의 기본 ArgoCD Application을 정의한다:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: demo-apps
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/iamywl/IaC_apple_sillicon.git
    targetRevision: HEAD
    path: manifests/demo
  destination:
    name: dev-cluster        # 대상 클러스터 이름
    namespace: demo
  syncPolicy:
    automated:
      prune: true            # Git에서 삭제된 리소스를 클러스터에서도 삭제한다
      selfHeal: true         # 수동 변경을 자동 복구한다
    syncOptions:
      - CreateNamespace=true # demo 네임스페이스가 없으면 자동 생성한다
```

주요 설정 포인트는 다음과 같다:
- `destination.name: dev-cluster` - 클러스터 URL 대신 이름으로 참조한다. ArgoCD에 등록된 클러스터 이름과 매칭되어야 한다
- `targetRevision: HEAD` - 항상 최신 커밋을 추적한다. 프로덕션에서는 특정 태그나 브랜치를 지정하는 것이 안전하다
- `automated.prune: true` - Git에서 파일을 삭제하면 클러스터에서도 해당 리소스가 삭제된다
- `automated.selfHeal: true` - `kubectl edit`이나 `kubectl scale`로 직접 변경한 내용을 ArgoCD가 자동으로 원래 상태로 복구한다

```bash
# platform 클러스터에서 ArgoCD 접근
export KUBECONFIG=kubeconfig/platform.yaml

# admin 비밀번호 조회
kubectl get secret argocd-initial-admin-secret -n argocd -o jsonpath='{.data.password}' | base64 -d; echo

# 브라우저에서 http://<platform-worker-ip>:30800 접속
argocd login <platform-worker-ip>:30800 --username admin --password <password> --insecure

# 데모 Application 배포
kubectl apply -f manifests/argocd/demo-app.yaml

# Application 상태 확인
argocd app get demo-apps
argocd app list
```

### 설치 프로세스 상세

`scripts/install/08-install-cicd.sh` 스크립트는 다음 순서로 ArgoCD를 설치한다:

```
1. argocd 네임스페이스 생성
   kubectl create namespace argocd

2. Helm 리포지토리 추가
   helm repo add argo https://argoproj.github.io/argo-helm

3. ArgoCD 설치 (Helm)
   helm upgrade --install argocd argo/argo-cd \
     --namespace argocd \
     --values manifests/argocd-values.yaml \
     --wait --timeout 10m

4. 접속 정보 출력
   - URL: http://<worker-ip>:30800
   - 초기 비밀번호: argocd-initial-admin-secret에서 조회
```

---

