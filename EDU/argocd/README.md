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

### GitOps 원칙

```
1. 선언적 (Declarative)
   → 원하는 상태를 YAML로 선언한다
   → 명령형(kubectl apply) 대신 선언형으로 모든 리소스를 정의한다

2. 버전 관리 (Versioned & Immutable)
   → 모든 변경 이력을 Git에 기록한다
   → 감사 추적(audit trail)이 자동으로 생성된다

3. 자동 적용 (Pulled Automatically)
   → Git 변경 시 자동으로 클러스터에 반영한다
   → 에이전트(ArgoCD)가 클러스터 내부에서 Pull 방식으로 동작한다

4. 자가 치유 (Continuously Reconciled)
   → 수동 변경을 감지하고 Git 상태로 복구한다
   → 컨트롤러가 지속적으로 원하는 상태와 실제 상태를 비교한다
```

---

### 이 프로젝트에서의 실습 환경

이 프로젝트에서 ArgoCD는 platform 클러스터의 `argocd` 네임스페이스에 배포된다.

- 설치 스크립트: `scripts/install/08-install-cicd.sh`
- Helm Chart: `argo/argo-cd`
- NodePort: 30800
- Dex(외부 인증): 비활성화
- 데모 Application: `manifests/argocd/demo-app.yaml` (GitHub 리포지토리에서 `manifests/demo` 경로를 auto-sync)
- 실습 대상 클러스터: platform (`kubeconfig/platform.yaml`)

```bash
# platform 클러스터에서 ArgoCD 접근
export KUBECONFIG=kubeconfig/platform.yaml
# admin 비밀번호 조회
kubectl get secret argocd-initial-admin-secret -n argocd -o jsonpath='{.data.password}' | base64 -d; echo
# 브라우저에서 http://<platform-worker-ip>:30800 접속
argocd login <platform-worker-ip>:30800 --username admin --password <password> --insecure
```

---

## 아키텍처

### 핵심 컴포넌트

```
┌─────────────────────────────────────────────────────────────────────┐
│                         ArgoCD Server                              │
│                                                                     │
│  ┌───────────────────┐    ┌────────────────┐    ┌───────────────┐  │
│  │   API Server      │    │   Repo Server  │    │  Application  │  │
│  │                   │    │                │    │  Controller   │  │
│  │ • gRPC / REST API │    │ • Git clone    │    │               │  │
│  │ • Web UI 제공      │    │ • Helm render  │    │ • Reconcile   │  │
│  │ • RBAC 적용        │    │ • Kustomize    │    │   Loop        │  │
│  │ • SSO 통합         │    │   build        │    │ • K8s Watch   │  │
│  │ • Webhook 수신     │    │ • Plain YAML   │    │   (Informer)  │  │
│  │                   │    │ • Jsonnet      │    │ • Diff 계산    │  │
│  └────────┬──────────┘    └───────┬────────┘    └───────┬───────┘  │
│           │                       │                     │          │
│  ┌────────▼───────────────────────▼─────────────────────▼───────┐  │
│  │                        Redis                                 │  │
│  │   • Manifest 캐싱  • Repo 정보 캐싱  • App 상태 캐싱           │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌──────────────────┐                                              │
│  │   Dex (선택)      │                                              │
│  │   • OIDC / SSO   │                                              │
│  │   • GitHub OAuth  │                                              │
│  │   • LDAP 연동     │                                              │
│  └──────────────────┘                                              │
│                                                                     │
│  ┌──────────────────┐                                              │
│  │  Notifications   │                                              │
│  │  Controller      │                                              │
│  │  • Slack/Teams   │                                              │
│  │  • GitHub Status │                                              │
│  │  • Webhook       │                                              │
│  └──────────────────┘                                              │
└─────────────────────────────────────────────────────────────────────┘
         │                          │                      │
         ▼                          ▼                      ▼
   ┌──────────┐           ┌──────────────┐        ┌──────────────┐
   │ Web UI / │           │  Git Repo    │        │  Kubernetes  │
   │ CLI      │           │ (manifests)  │        │  Cluster(s)  │
   └──────────┘           └──────────────┘        └──────────────┘
```

### 컴포넌트 상세

#### API Server

- ArgoCD의 프론트 게이트웨이 역할을 한다
- gRPC와 REST API를 동시에 제공한다 (gRPC-Gateway를 통해 REST로 변환한다)
- Web UI의 백엔드로 동작하며, CLI(`argocd` 명령어)도 이 API를 호출한다
- RBAC(Role-Based Access Control) 정책을 적용하여 사용자별 권한을 제어한다
- SSO(Single Sign-On) 통합을 지원하며, Dex 또는 직접 OIDC 연동이 가능하다
- Git 웹훅(GitHub, GitLab, Bitbucket)을 수신하여 즉시 동기화를 트리거할 수 있다

#### Repo Server

- Git 리포지토리를 clone하고 매니페스트를 생성하는 전담 컴포넌트이다
- 지원하는 매니페스트 생성 방식은 다음과 같다:
  - **Helm**: `helm template`을 실행하여 Chart를 렌더링한다
  - **Kustomize**: `kustomize build`를 실행하여 overlay를 적용한다
  - **Plain YAML**: 디렉토리 내 YAML 파일을 그대로 사용한다
  - **Jsonnet**: `.jsonnet` 파일을 평가하여 JSON/YAML로 변환한다
  - **Custom Plugin (CMP)**: 사용자 정의 Config Management Plugin을 sidecar로 실행할 수 있다
- 보안상 네트워크 접근이 제한된 환경에서 실행되며, Kubernetes API에 직접 접근하지 않는다
- 생성된 매니페스트는 Redis에 캐싱하여 반복 요청 시 성능을 향상시킨다

#### Application Controller

- ArgoCD의 핵심 엔진으로, Kubernetes controller 패턴으로 구현되어 있다
- Kubernetes Informer를 사용하여 관리 대상 리소스의 변경 사항을 실시간으로 감시(watch)한다
- Reconciliation Loop를 통해 원하는 상태(Desired State)와 실제 상태(Live State)를 지속적으로 비교한다
- 차이(diff)가 발견되면 Sync Policy에 따라 자동 또는 수동으로 동기화를 수행한다
- Health Assessment를 실행하여 각 리소스의 상태를 판별한다

#### Redis

- ArgoCD 내부 캐싱 계층으로 사용된다
- Git 리포지토리 메타데이터, 렌더링된 매니페스트, Application 상태 정보를 캐싱한다
- HA 구성 시 Redis Sentinel 또는 Redis Cluster를 사용할 수 있다
- 영속 데이터를 저장하지 않으므로, Redis가 재시작되어도 데이터는 다시 생성된다

#### Dex (선택 사항)

- ArgoCD에 내장된 OIDC(OpenID Connect) 프로바이더이다
- 다양한 Identity Provider와 연동하는 커넥터를 제공한다:
  - GitHub / GitHub Enterprise OAuth
  - GitLab OAuth
  - LDAP / Active Directory
  - SAML 2.0
  - Google, Microsoft, Okta 등 OIDC 프로바이더
- Dex를 사용하지 않고 ArgoCD에 직접 OIDC를 설정할 수도 있다 (bundled Dex 비활성화 후 `oidc.config` 설정)

---

## Reconciliation Loop (상태 조정 루프)

### 동작 방식

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Git Repo    │     │  Repo Server │     │  Application │
│  (Desired)   │────►│  (Render)    │────►│  Controller  │
└──────────────┘     └──────────────┘     └──────┬───────┘
                                                  │
                                           Diff 계산
                                                  │
                                          ┌───────▼───────┐
                                          │  K8s Cluster  │
                                          │  (Live State) │
                                          └───────────────┘
```

- 기본 Polling 주기는 **3분**(180초)이다 (`timeout.reconciliation` 설정으로 변경 가능하다)
- `argocd-cm` ConfigMap의 `timeout.reconciliation` 값으로 주기를 조정한다
- Webhook 기반 트리거를 설정하면 Git push 이벤트 발생 시 즉시 동기화를 시작한다 (polling 대기 없이)
- 수동으로 Hard Refresh를 실행하면 캐시를 무시하고 Git에서 최신 매니페스트를 가져온다

### Diff 계산 방식

- ArgoCD는 자체 diff 엔진을 사용하여 Desired State와 Live State를 비교한다
- `kubectl diff`와 유사하지만 ArgoCD 고유의 정규화(normalization) 과정을 거친다
- Kubernetes가 자동으로 추가하는 필드(defaulting)를 고려하여 오탐(false positive)을 줄인다
- Server-Side Diff 모드를 활성화하면 Kubernetes API Server의 dry-run 기능을 활용하여 더 정확한 diff를 계산한다 (ArgoCD 2.10+)

### Resource Tracking 방식

ArgoCD가 관리 대상 리소스를 추적하는 방법은 세 가지이다:

| 방식 | 설명 |
|------|------|
| **annotation** (기본값) | `kubectl.kubernetes.io/last-applied-configuration` 어노테이션을 사용한다 |
| **label** | `app.kubernetes.io/instance` 레이블을 사용한다 |
| **annotation+label** | 두 방식을 모두 사용한다. ArgoCD 2.2+에서 권장하는 방식이다 |

- `argocd-cm` ConfigMap의 `application.resourceTrackingMethod` 값으로 설정한다

### Diff 커스터마이징

특정 필드를 diff 비교에서 제외하려면 Application 리소스에 `ignoreDifferences`를 설정한다:

```yaml
spec:
  ignoreDifferences:
    # jqPathExpressions: jq 문법으로 무시할 경로를 지정한다
    - group: apps
      kind: Deployment
      jqPathExpressions:
        - .spec.replicas
        - .spec.template.metadata.annotations."kubectl.kubernetes.io/restartedAt"

    # jsonPointers: JSON Pointer 문법으로 무시할 경로를 지정한다
    - group: ""
      kind: ConfigMap
      jsonPointers:
        - /data/generated-field

    # managedFieldsManagers: 특정 field manager가 관리하는 필드를 무시한다
    - group: "*"
      kind: "*"
      managedFieldsManagers:
        - kube-controller-manager
        - vpa-recommender
```

시스템 전체에 적용하려면 `argocd-cm` ConfigMap의 `resource.customizations.ignoreDifferences.all` 항목을 사용한다.

---

## Sync Waves와 Hooks

### Sync Phases

ArgoCD Sync는 세 단계로 실행된다:

```
PreSync → Sync → PostSync
                      │
                 (실패 시)
                      ▼
                  SyncFail
```

| Phase | 설명 |
|-------|------|
| **PreSync** | 메인 리소스 배포 전에 실행된다. DB 마이그레이션, 스키마 변경 등에 사용한다 |
| **Sync** | 실제 매니페스트를 클러스터에 적용하는 단계이다 |
| **PostSync** | 모든 리소스가 Healthy 상태가 된 후 실행된다. 통합 테스트, 알림 전송 등에 사용한다 |
| **SyncFail** | Sync가 실패했을 때 실행된다. 실패 알림, 롤백 트리거 등에 사용한다 |
| **Skip** | 해당 리소스를 Sync에서 제외한다 |

### Sync Wave 순서

`argocd.argoproj.io/sync-wave` 어노테이션으로 동일 Phase 내에서 리소스 적용 순서를 제어한다:

```yaml
# wave가 낮은 순서대로 적용된다 (음수도 가능하다)
# wave 0이 기본값이다

# 1단계: Namespace와 RBAC (wave -2)
apiVersion: v1
kind: Namespace
metadata:
  name: my-app
  annotations:
    argocd.argoproj.io/sync-wave: "-2"

---
# 2단계: ConfigMap과 Secret (wave -1)
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
  annotations:
    argocd.argoproj.io/sync-wave: "-1"

---
# 3단계: Database (wave 0, 기본값)
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: postgres
  # wave 미지정 시 기본값 0

---
# 4단계: Application (wave 1)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
  annotations:
    argocd.argoproj.io/sync-wave: "1"

---
# 5단계: Ingress (wave 2)
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: my-app-ingress
  annotations:
    argocd.argoproj.io/sync-wave: "2"
```

### Resource Hooks

Hook은 `argocd.argoproj.io/hook` 어노테이션으로 정의한다. 일반적으로 Job이나 Pod로 생성한다:

```yaml
# DB 마이그레이션 Hook 예시
apiVersion: batch/v1
kind: Job
metadata:
  name: db-migrate
  annotations:
    argocd.argoproj.io/hook: PreSync
    argocd.argoproj.io/hook-delete-policy: HookSucceeded
    argocd.argoproj.io/sync-wave: "-1"
spec:
  template:
    spec:
      containers:
        - name: migrate
          image: my-app:latest
          command: ["./migrate.sh"]
      restartPolicy: Never
  backoffLimit: 3
```

Hook 삭제 정책(`hook-delete-policy`)은 다음과 같다:

| 정책 | 설명 |
|------|------|
| `HookSucceeded` | Hook이 성공하면 삭제한다 |
| `HookFailed` | Hook이 실패하면 삭제한다 |
| `BeforeHookCreation` | 새 Hook 생성 전에 이전 Hook을 삭제한다 (기본값) |

---

## Health Assessment (상태 평가)

### Health Status

| 상태 | 설명 |
|------|------|
| **Healthy** | 리소스가 정상적으로 동작하고 있다 |
| **Progressing** | 리소스가 아직 원하는 상태에 도달하지 않았지만 진행 중이다 (예: Deployment rollout 중) |
| **Degraded** | 리소스에 문제가 발생했다 (예: Pod CrashLoopBackOff, Deployment 가용 replica 부족) |
| **Suspended** | 리소스가 일시 중단 상태이다 (예: CronJob suspended, Deployment paused) |
| **Missing** | 리소스가 클러스터에 존재하지 않는다 |
| **Unknown** | Health 상태를 판별할 수 없다 |

### 기본 제공 Health Check

ArgoCD는 주요 Kubernetes 리소스에 대해 내장 Health Check를 제공한다:

- **Deployment**: 모든 replica가 available이고 updated인지 확인한다
- **StatefulSet**: 모든 replica가 ready이고 current revision인지 확인한다
- **DaemonSet**: desired와 available 수가 일치하는지 확인한다
- **Service**: type이 LoadBalancer인 경우 external IP/hostname이 할당되었는지 확인한다
- **Ingress**: address가 할당되었는지 확인한다
- **PersistentVolumeClaim**: phase가 Bound인지 확인한다
- **Pod**: 모든 container가 ready인지 확인한다

### Custom Health Check (Lua 스크립트)

ArgoCD는 Lua 스크립트를 사용하여 CRD 등 커스텀 리소스에 대한 Health Check를 정의할 수 있다. `argocd-cm` ConfigMap에 설정한다:

```yaml
# argocd-cm ConfigMap
data:
  resource.customizations.health.certmanager.k8s.io_Certificate: |
    hs = {}
    if obj.status ~= nil then
      if obj.status.conditions ~= nil then
        for i, condition in ipairs(obj.status.conditions) do
          if condition.type == "Ready" and condition.status == "False" then
            hs.status = "Degraded"
            hs.message = condition.message
            return hs
          end
          if condition.type == "Ready" and condition.status == "True" then
            hs.status = "Healthy"
            hs.message = condition.message
            return hs
          end
        end
      end
    end
    hs.status = "Progressing"
    hs.message = "Waiting for certificate"
    return hs
```

---

## Sync 전략 (Sync Strategies)

### Apply 방식

| 방식 | 설명 |
|------|------|
| **kubectl apply** (기본값) | 3-way merge patch를 사용한다. 대부분의 경우 적합하다 |
| **Server-Side Apply** | Kubernetes API Server가 병합을 수행한다. 필드 소유권(field ownership)을 추적한다. `ServerSideApply=true` sync option으로 활성화한다 |
| **kubectl replace** | 리소스를 완전히 교체한다. 기존 리소스를 삭제하고 재생성한다. `Replace=true` sync option으로 활성화한다 |
| **kubectl create** | 리소스가 없을 때만 생성한다. 이미 존재하면 건너뛴다. `CreateOnly=true` sync option을 사용한다 |

### Sync Options

Application 또는 개별 리소스에 적용할 수 있는 sync option 목록이다:

```yaml
spec:
  syncPolicy:
    syncOptions:
      - CreateNamespace=true       # 대상 namespace가 없으면 자동 생성한다
      - PrunePropagationPolicy=foreground  # 삭제 전파 정책 (foreground/background/orphan)
      - PruneLast=true             # Prune 대상 리소스를 마지막에 삭제한다
      - ApplyOutOfSyncOnly=true    # OutOfSync 상태인 리소스만 apply한다 (Selective Sync)
      - ServerSideApply=true       # Server-Side Apply를 사용한다
      - Replace=true               # kubectl replace를 사용한다
      - Validate=false             # kubectl --validate=false로 적용한다
      - RespectIgnoreDifferences=true  # ignoreDifferences 설정을 Sync 시에도 반영한다
      - FailOnSharedResource=true  # 다른 Application이 관리하는 리소스와 충돌 시 실패한다
```

### Sync Windows

특정 시간대에만 Sync를 허용하거나 차단하는 정책이다. AppProject 단위로 설정한다:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: AppProject
metadata:
  name: production
  namespace: argocd
spec:
  syncWindows:
    # 평일 업무 시간에만 Sync를 허용한다
    - kind: allow
      schedule: "0 9 * * 1-5"    # cron 형식
      duration: 8h
      applications:
        - "*"
    # 주말에는 Sync를 차단한다
    - kind: deny
      schedule: "0 0 * * 0,6"
      duration: 24h
      applications:
        - "production-*"
    # 수동 Sync도 차단한다
    - kind: deny
      schedule: "0 0 * * 0,6"
      duration: 24h
      manualSync: true
      applications:
        - "production-*"
```

---

## Multi-Cluster 관리

### 외부 클러스터 등록

ArgoCD는 설치된 클러스터 외에 추가 클러스터를 등록하여 관리할 수 있다:

```bash
# 외부 클러스터 추가 (kubeconfig context 기반)
argocd cluster add my-production-cluster

# 클러스터 목록 확인
argocd cluster list

# 클러스터 정보 조회
argocd cluster get https://production-api.example.com
```

- 클러스터 자격 증명(credential)은 `argocd` 네임스페이스의 Secret으로 저장된다
- ServiceAccount 토큰 또는 kubeconfig 기반 인증을 지원한다
- ArgoCD가 설치된 클러스터는 `https://kubernetes.default.svc`로 자동 등록되어 있다
- 각 Application의 `spec.destination.server`에 대상 클러스터 URL을 지정한다

---

## ApplicationSet

### 개요

ApplicationSet Controller는 템플릿 기반으로 다수의 Application을 자동 생성하는 컴포넌트이다. ArgoCD 2.3부터 ArgoCD에 내장되어 있다.

### Generator 종류

| Generator | 설명 |
|-----------|------|
| **List** | 정적 리스트에서 파라미터를 가져온다 |
| **Cluster** | ArgoCD에 등록된 클러스터 목록을 기반으로 생성한다 |
| **Git Directory** | Git 리포지토리의 디렉토리 구조를 기반으로 생성한다 |
| **Git File** | Git 리포지토리의 JSON/YAML 파일에서 파라미터를 읽는다 |
| **Matrix** | 두 Generator를 조합하여 카르테시안 곱(Cartesian product)을 생성한다 |
| **Merge** | 여러 Generator의 결과를 병합한다 |
| **Pull Request** | GitHub/GitLab PR을 기반으로 preview 환경을 자동 생성한다 |
| **SCM Provider** | GitHub org / GitLab group의 리포지토리를 자동 탐색한다 |

### ApplicationSet 예시

```yaml
# Git Directory Generator: 디렉토리별 Application 자동 생성
apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: cluster-apps
  namespace: argocd
spec:
  generators:
    - git:
        repoURL: https://github.com/org/infra-manifests.git
        revision: main
        directories:
          - path: "apps/*"
  template:
    metadata:
      name: "{{path.basename}}"
    spec:
      project: default
      source:
        repoURL: https://github.com/org/infra-manifests.git
        targetRevision: main
        path: "{{path}}"
      destination:
        server: https://kubernetes.default.svc
        namespace: "{{path.basename}}"
      syncPolicy:
        automated:
          selfHeal: true
          prune: true
        syncOptions:
          - CreateNamespace=true

---
# Matrix Generator: 클러스터 x 환경 조합
apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: multi-cluster-apps
  namespace: argocd
spec:
  generators:
    - matrix:
        generators:
          - clusters:
              selector:
                matchLabels:
                  env: production
          - git:
              repoURL: https://github.com/org/infra-manifests.git
              revision: main
              directories:
                - path: "apps/*"
  template:
    metadata:
      name: "{{name}}-{{path.basename}}"
    spec:
      project: default
      source:
        repoURL: https://github.com/org/infra-manifests.git
        targetRevision: main
        path: "{{path}}"
      destination:
        server: "{{server}}"
        namespace: "{{path.basename}}"

---
# Pull Request Generator: PR별 preview 환경 자동 생성
apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: pr-previews
  namespace: argocd
spec:
  generators:
    - pullRequest:
        github:
          owner: my-org
          repo: my-app
          tokenRef:
            secretName: github-token
            key: token
        requeueAfterSeconds: 60
  template:
    metadata:
      name: "preview-{{number}}"
    spec:
      project: default
      source:
        repoURL: https://github.com/my-org/my-app.git
        targetRevision: "{{head_sha}}"
        path: deploy/preview
      destination:
        server: https://kubernetes.default.svc
        namespace: "preview-{{number}}"
      syncPolicy:
        automated:
          selfHeal: true
        syncOptions:
          - CreateNamespace=true
```

---

## RBAC (역할 기반 접근 제어)

### AppProject

AppProject는 Application을 논리적으로 그룹화하고 접근 제어를 적용하는 핵심 단위이다:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: AppProject
metadata:
  name: production
  namespace: argocd
spec:
  description: "Production 환경 프로젝트"

  # 허용된 소스 리포지토리
  sourceRepos:
    - "https://github.com/org/infra-*"
    - "https://charts.helm.sh/*"

  # 허용된 배포 대상 (클러스터 + 네임스페이스)
  destinations:
    - server: "https://production-api.example.com"
      namespace: "app-*"
    - server: "https://production-api.example.com"
      namespace: "monitoring"

  # 클러스터 스코프 리소스 허용 목록 (빈 배열이면 모두 차단)
  clusterResourceWhitelist:
    - group: ""
      kind: Namespace
    - group: "rbac.authorization.k8s.io"
      kind: ClusterRole
    - group: "rbac.authorization.k8s.io"
      kind: ClusterRoleBinding

  # 네임스페이스 스코프 리소스 차단 목록
  namespaceResourceBlacklist:
    - group: ""
      kind: ResourceQuota
    - group: ""
      kind: LimitRange

  # 프로젝트 내 역할 정의
  roles:
    - name: developer
      description: "개발자 역할: 조회 및 Sync만 가능하다"
      policies:
        - p, proj:production:developer, applications, get, production/*, allow
        - p, proj:production:developer, applications, sync, production/*, allow
      groups:
        - dev-team    # SSO 그룹과 매핑한다

    - name: admin
      description: "관리자 역할: 모든 작업이 가능하다"
      policies:
        - p, proj:production:admin, applications, *, production/*, allow
      groups:
        - platform-team
```

### RBAC 정책 형식

ArgoCD RBAC 정책은 Casbin CSV 형식을 사용한다. `argocd-rbac-cm` ConfigMap에 설정한다:

```csv
# 정책 형식: p, <role>, <resource>, <action>, <project>/<object>, <allow/deny>
# 그룹 매핑: g, <sso-group>, role:<role-name>

# 기본 정책 (인증된 사용자에게 적용)
p, role:readonly, applications, get, */*, allow
p, role:readonly, logs, get, */*, allow
p, role:readonly, clusters, get, *, allow
p, role:readonly, repositories, get, *, allow

# 개발자 역할
p, role:developer, applications, get, */*, allow
p, role:developer, applications, sync, */*, allow
p, role:developer, applications, action/*, */*, allow
p, role:developer, logs, get, */*, allow
p, role:developer, exec, create, */*, deny

# 관리자 역할
p, role:admin, *, *, */*, allow

# SSO 그룹과 역할 매핑
g, my-org:dev-team, role:developer
g, my-org:platform-team, role:admin
```

---

## SSO 통합

### Dex를 통한 SSO

Dex 설정은 `argocd-cm` ConfigMap에 정의한다:

```yaml
# argocd-cm ConfigMap
data:
  url: https://argocd.example.com

  dex.config: |
    connectors:
      # GitHub OAuth
      - type: github
        id: github
        name: GitHub
        config:
          clientID: $dex.github.clientID      # argocd-secret에서 참조한다
          clientSecret: $dex.github.clientSecret
          orgs:
            - name: my-org
              teams:
                - dev-team
                - platform-team

      # LDAP
      - type: ldap
        id: ldap
        name: Corporate LDAP
        config:
          host: ldap.example.com:636
          insecureNoSSL: false
          insecureSkipVerify: false
          rootCA: /etc/dex/ldap-ca.pem
          bindDN: cn=admin,dc=example,dc=com
          bindPW: $dex.ldap.bindPW
          userSearch:
            baseDN: ou=users,dc=example,dc=com
            filter: "(objectClass=person)"
            username: uid
            emailAttr: mail
            nameAttr: cn
          groupSearch:
            baseDN: ou=groups,dc=example,dc=com
            filter: "(objectClass=groupOfNames)"
            userMatchers:
              - userAttr: DN
                groupAttr: member
            nameAttr: cn
```

### 직접 OIDC 연동 (Dex 없이)

```yaml
# argocd-cm ConfigMap
data:
  url: https://argocd.example.com
  oidc.config: |
    name: Okta
    issuer: https://my-org.okta.com/oauth2/default
    clientID: xxxxxxxxxxxxxxxx
    clientSecret: $oidc.okta.clientSecret
    requestedScopes:
      - openid
      - profile
      - email
      - groups
    requestedIDTokenClaims:
      groups:
        essential: true
```

---

## Notifications (알림)

### 개요

argocd-notifications는 ArgoCD 2.3부터 내장된 알림 컴포넌트이다. Application 상태 변경 시 다양한 채널로 알림을 전송한다.

### 설정

`argocd-notifications-cm` ConfigMap에 서비스, 트리거, 템플릿을 정의한다:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: argocd-notifications-cm
  namespace: argocd
data:
  # 알림 서비스 정의
  service.slack: |
    token: $slack-token
    signingSecret: $slack-signing-secret

  service.webhook.github: |
    url: https://api.github.com
    headers:
      - name: Authorization
        value: token $github-token

  # 알림 템플릿 정의
  template.app-deployed: |
    message: |
      Application {{.app.metadata.name}} is now {{.app.status.sync.status}}.
      Revision: {{.app.status.sync.revision}}
    slack:
      attachments: |
        [{
          "color": "#18be52",
          "title": "{{.app.metadata.name}} deployed",
          "fields": [
            {"title": "Sync Status", "value": "{{.app.status.sync.status}}", "short": true},
            {"title": "Repository", "value": "{{.app.spec.source.repoURL}}", "short": true}
          ]
        }]

  template.app-sync-failed: |
    message: |
      Application {{.app.metadata.name}} sync failed.
      Error: {{.app.status.conditions | last | default "" }}
    slack:
      attachments: |
        [{
          "color": "#E96D76",
          "title": "{{.app.metadata.name}} sync failed"
        }]

  # 트리거 정의: 어떤 조건에서 어떤 템플릿을 사용할지 결정한다
  trigger.on-deployed: |
    - description: Application is synced and healthy
      send:
        - app-deployed
      when: app.status.operationState.phase in ['Succeeded'] and app.status.health.status == 'Healthy'

  trigger.on-sync-failed: |
    - description: Application sync has failed
      send:
        - app-sync-failed
      when: app.status.operationState.phase in ['Error', 'Failed']
```

### Application에 알림 적용

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: my-app
  namespace: argocd
  annotations:
    # Slack 채널로 배포 성공/실패 알림을 전송한다
    notifications.argoproj.io/subscribe.on-deployed.slack: deploy-notifications
    notifications.argoproj.io/subscribe.on-sync-failed.slack: deploy-alerts
```

---

## Sync 상태 흐름

```
OutOfSync ──► Syncing ──► Synced
                              │
                         ┌────▼─────┐
                         │ Health   │
                         │ Check    │
                         └────┬─────┘
                              │
              ┌───────────┬───┼───────────┬───────────┐
              ▼           ▼   ▼           ▼           ▼
          Healthy   Progressing  Degraded  Suspended  Missing
```

---

## 실습

### 실습 1: ArgoCD 접속

```bash
# ArgoCD CLI 설치
brew install argocd

# ArgoCD 포트포워딩
kubectl port-forward -n argocd svc/argocd-server 8443:443

# 초기 비밀번호 확인
kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath="{.data.password}" | base64 -d

# CLI 로그인
argocd login localhost:8443 --insecure

# 비밀번호 변경 (초기 설정 후 즉시 변경할 것을 권장한다)
argocd account update-password

# 브라우저에서 https://localhost:8443 접속
```

### 실습 2: Application 생성

```bash
# CLI로 Application 생성
argocd app create nginx-demo \
  --repo https://github.com/user/manifests.git \
  --path nginx \
  --dest-server https://kubernetes.default.svc \
  --dest-namespace demo \
  --sync-policy automated

# Application 목록 확인
argocd app list

# Application 상태 확인
argocd app get nginx-demo

# 수동 Sync
argocd app sync nginx-demo

# Application 로그 확인
argocd app logs nginx-demo
```

### 실습 3: Sync 정책 설정

```bash
# Auto-Sync 활성화
argocd app set nginx-demo --sync-policy automated

# Self-Heal 활성화 (수동 변경 자동 복구)
argocd app set nginx-demo --self-heal

# Auto-Prune 활성화 (Git에서 삭제된 리소스 자동 삭제)
argocd app set nginx-demo --auto-prune
```

### 실습 4: Self-Heal 동작 확인

```bash
# 1. ArgoCD가 관리하는 Deployment의 replica를 수동으로 변경
kubectl scale deployment nginx -n demo --replicas=5

# 2. ArgoCD가 자동으로 Git 상태(예: replicas=2)로 복구하는지 확인
argocd app get nginx-demo

# 3. ArgoCD 이벤트 로그 확인
argocd app history nginx-demo
```

### 실습 5: Diff 확인 및 Hard Refresh

```bash
# Application의 현재 diff 확인
argocd app diff nginx-demo

# Hard Refresh: 캐시를 무시하고 Git에서 최신 상태를 가져온다
argocd app get nginx-demo --hard-refresh

# 리소스 트리 확인
argocd app resources nginx-demo
```

---

## 예제

### 예제 1: Application CRD

```yaml
# application.yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: demo
  namespace: argocd
  # Finalizer를 설정하면 Application 삭제 시 클러스터 리소스도 함께 삭제된다
  finalizers:
    - resources-finalizer.argocd.argoproj.io
spec:
  project: default

  source:
    repoURL: https://github.com/user/manifests.git
    targetRevision: main
    path: demo

  destination:
    server: https://kubernetes.default.svc
    namespace: demo

  syncPolicy:
    automated:
      prune: true       # Git에서 삭제된 리소스를 클러스터에서도 삭제한다
      selfHeal: true     # 수동 변경을 자동 복구한다
    syncOptions:
      - CreateNamespace=true
      - ApplyOutOfSyncOnly=true
    retry:
      limit: 5
      backoff:
        duration: 5s
        factor: 2
        maxDuration: 3m
```

### 예제 2: Helm Chart를 ArgoCD로 배포

```yaml
# helm-app.yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: prometheus
  namespace: argocd
spec:
  project: default

  source:
    repoURL: https://prometheus-community.github.io/helm-charts
    chart: kube-prometheus-stack
    targetRevision: 45.0.0
    helm:
      # values 파일 지정 (Git repo에 있는 경우)
      valueFiles:
        - values-custom.yaml
      # 개별 파라미터 오버라이드
      parameters:
        - name: grafana.enabled
          value: "true"
      # inline values
      values: |
        alertmanager:
          enabled: true
        prometheus:
          prometheusSpec:
            retention: 30d

  destination:
    server: https://kubernetes.default.svc
    namespace: monitoring

  syncPolicy:
    automated:
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
      - ServerSideApply=true
```

### 예제 3: App of Apps 패턴

```yaml
# root-app.yaml
# 모든 Application을 관리하는 최상위 Application이다
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: root-app
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/user/manifests.git
    targetRevision: main
    path: apps  # 이 디렉토리에 개별 Application YAML이 있다
  destination:
    server: https://kubernetes.default.svc
    namespace: argocd
  syncPolicy:
    automated:
      selfHeal: true
      prune: true
```

```
# apps/ 디렉토리 구조
apps/
├── nginx-app.yaml
├── prometheus-app.yaml
├── grafana-app.yaml
└── demo-app.yaml
```

### 예제 4: Kustomize Application

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: my-app-production
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/user/manifests.git
    targetRevision: main
    path: overlays/production
    kustomize:
      namePrefix: prod-
      commonLabels:
        env: production
      images:
        - my-app=registry.example.com/my-app:v1.2.3
  destination:
    server: https://kubernetes.default.svc
    namespace: production
```

### 예제 5: Multiple Sources (ArgoCD 2.6+)

```yaml
# Helm chart의 values를 별도 Git repo에서 관리하는 패턴이다
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: my-app
  namespace: argocd
spec:
  project: default
  sources:
    # Helm chart 소스
    - repoURL: https://charts.example.com
      chart: my-app
      targetRevision: 1.0.0
      helm:
        valueFiles:
          - $values/envs/production/values.yaml
    # values 파일이 있는 Git repo
    - repoURL: https://github.com/org/app-config.git
      targetRevision: main
      ref: values
  destination:
    server: https://kubernetes.default.svc
    namespace: my-app
```

---

## 자가 점검

- [ ] GitOps의 4가지 원칙을 설명할 수 있는가?
- [ ] ArgoCD의 5가지 핵심 컴포넌트(API Server, Repo Server, Application Controller, Redis, Dex)의 역할을 설명할 수 있는가?
- [ ] Reconciliation Loop의 동작 방식과 기본 polling 주기(3분)를 설명할 수 있는가?
- [ ] ArgoCD에서 Sync, Self-Heal, Auto-Prune의 차이를 설명할 수 있는가?
- [ ] Sync Wave와 Hook(PreSync, Sync, PostSync, SyncFail)의 용도를 설명할 수 있는가?
- [ ] Health Status의 종류(Healthy, Progressing, Degraded, Suspended)와 판별 기준을 설명할 수 있는가?
- [ ] Application CRD를 작성할 수 있는가?
- [ ] ApplicationSet의 Generator 종류와 사용 사례를 설명할 수 있는가?
- [ ] AppProject를 활용한 RBAC 설정 방법을 설명할 수 있는가?
- [ ] Jenkins(CI)와 ArgoCD(CD)의 연동 방식을 설명할 수 있는가?
- [ ] App of Apps 패턴과 ApplicationSet의 차이를 설명할 수 있는가?
- [ ] OutOfSync 상태가 발생하는 원인을 설명할 수 있는가?
- [ ] ignoreDifferences를 사용하여 특정 필드를 diff에서 제외하는 방법을 설명할 수 있는가?
- [ ] Sync Window를 설정하여 배포 시간을 제한하는 방법을 설명할 수 있는가?
- [ ] argocd-notifications를 통해 Slack 알림을 설정할 수 있는가?

---

## 참고문헌

- [ArgoCD 공식 문서](https://argo-cd.readthedocs.io/en/stable/) - 설치, 설정, 운영 가이드 전체를 포함한다
- [ArgoCD GitHub 리포지토리](https://github.com/argoproj/argo-cd) - 소스 코드, 이슈 트래커, 릴리스 노트를 확인할 수 있다
- [ArgoCD Operator Manual](https://argo-cd.readthedocs.io/en/stable/operator-manual/) - 클러스터 관리자를 위한 운영 매뉴얼이다
- [ArgoCD User Guide](https://argo-cd.readthedocs.io/en/stable/user-guide/) - 사용자를 위한 가이드이다
- [ApplicationSet Controller 문서](https://argo-cd.readthedocs.io/en/stable/operator-manual/applicationset/) - ApplicationSet의 Generator와 템플릿 문법을 설명한다
- [ArgoCD Notifications 문서](https://argo-cd.readthedocs.io/en/stable/operator-manual/notifications/) - 알림 설정과 커스터마이징 가이드이다
- [ArgoCD RBAC 설정](https://argo-cd.readthedocs.io/en/stable/operator-manual/rbac/) - 역할 기반 접근 제어 설정 가이드이다
- [Argo Project 공식 사이트](https://argoproj.github.io/) - Argo Workflows, Argo Events, Argo Rollouts 등 Argo 생태계 전체 정보를 제공한다
- [CNCF ArgoCD 졸업 발표](https://www.cncf.io/announcements/2022/12/06/the-cloud-native-computing-foundation-announces-argo-has-graduated/) - CNCF Graduated 프로젝트 승인 공식 발표이다
