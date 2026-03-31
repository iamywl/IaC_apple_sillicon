# Day 2: ArgoCD 아키텍처 상세

ArgoCD의 내부 컴포넌트(API Server, Repo Server, Application Controller, Redis, Dex, Notification Controller), 데이터 흐름, 그리고 각 컴포넌트의 역할을 다룬다.

---

## 2장: ArgoCD 아키텍처 상세

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
│                                                                     │
│  ┌──────────────────┐                                              │
│  │  ApplicationSet  │                                              │
│  │  Controller      │                                              │
│  │  • Generators    │                                              │
│  │  • Templating    │                                              │
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

#### API Server (`argocd-server`)

- ArgoCD의 프론트 게이트웨이 역할을 한다
- gRPC와 REST API를 동시에 제공한다 (gRPC-Gateway를 통해 REST로 변환한다)
- Web UI의 백엔드로 동작하며, CLI(`argocd` 명령어)도 이 API를 호출한다
- RBAC(Role-Based Access Control) 정책을 적용하여 사용자별 권한을 제어한다
- SSO(Single Sign-On) 통합을 지원하며, Dex 또는 직접 OIDC 연동이 가능하다
- Git 웹훅(GitHub, GitLab, Bitbucket)을 수신하여 즉시 동기화를 트리거할 수 있다

API Server의 내부 구조는 다음과 같다:

```
┌───────────────────────────────────────────────────────┐
│                    API Server                          │
│                                                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │              gRPC Server (:8083)                  │  │
│  │  ┌──────────────────────────────────────────┐    │  │
│  │  │  Application Service                      │    │  │
│  │  │  - List, Get, Create, Update, Delete      │    │  │
│  │  │  - Sync, Rollback, Terminate              │    │  │
│  │  │  - Watch (streaming)                      │    │  │
│  │  │  - GetManifests, ManagedResources         │    │  │
│  │  │  - ResourceTree, ResourceActions          │    │  │
│  │  └──────────────────────────────────────────┘    │  │
│  │  ┌──────────────────────────────────────────┐    │  │
│  │  │  Repository Service                       │    │  │
│  │  │  - List, Create, Update, Delete repos     │    │  │
│  │  │  - ValidateAccess                         │    │  │
│  │  └──────────────────────────────────────────┘    │  │
│  │  ┌──────────────────────────────────────────┐    │  │
│  │  │  Cluster Service                          │    │  │
│  │  │  - List, Create, Update, Delete clusters  │    │  │
│  │  │  - RotateAuth                             │    │  │
│  │  └──────────────────────────────────────────┘    │  │
│  │  ┌──────────────────────────────────────────┐    │  │
│  │  │  Session Service                          │    │  │
│  │  │  - Create (login)                         │    │  │
│  │  │  - Delete (logout)                        │    │  │
│  │  │  - GetUserInfo                            │    │  │
│  │  └──────────────────────────────────────────┘    │  │
│  │  ┌──────────────────────────────────────────┐    │  │
│  │  │  Project Service                          │    │  │
│  │  │  - List, Get, Create, Update, Delete      │    │  │
│  │  │  - GetSyncWindows                         │    │  │
│  │  │  - GetGlobalProjects                      │    │  │
│  │  └──────────────────────────────────────────┘    │  │
│  └──────────────────────────────────────────────────┘  │
│                                                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │        REST API (gRPC-Gateway) (:8080)           │  │
│  │  /api/v1/applications, /api/v1/repositories, ... │  │
│  └──────────────────────────────────────────────────┘  │
│                                                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │              Web UI (Static Files)                │  │
│  │  React SPA, WebSocket for real-time updates      │  │
│  └──────────────────────────────────────────────────┘  │
│                                                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │              Webhook Handler                      │  │
│  │  /api/webhook (GitHub, GitLab, Bitbucket)        │  │
│  └──────────────────────────────────────────────────┘  │
│                                                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │           RBAC Enforcement Layer                  │  │
│  │  Casbin policy engine                            │  │
│  │  - argocd-rbac-cm ConfigMap 기반                  │  │
│  │  - 모든 API 호출에 대해 권한 검사 수행            │  │
│  └──────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────┘
```

API Server의 주요 포트는 다음과 같다:
- **8080**: HTTP(REST API + Web UI + Webhook). 이 프로젝트에서는 NodePort 30800으로 외부에 노출한다
- **8083**: gRPC (CLI와 통신). `--insecure` 플래그가 없으면 TLS가 필요하다

#### Repo Server (`argocd-repo-server`)

- Git 리포지토리를 clone하고 매니페스트를 생성하는 전담 컴포넌트이다
- 지원하는 매니페스트 생성 방식은 다음과 같다:
  - **Helm**: `helm template`을 실행하여 Chart를 렌더링한다
  - **Kustomize**: `kustomize build`를 실행하여 overlay를 적용한다
  - **Plain YAML**: 디렉토리 내 YAML 파일을 그대로 사용한다
  - **Jsonnet**: `.jsonnet` 파일을 평가하여 JSON/YAML로 변환한다
  - **Custom Plugin (CMP)**: 사용자 정의 Config Management Plugin을 sidecar로 실행할 수 있다
- 보안상 네트워크 접근이 제한된 환경에서 실행되며, Kubernetes API에 직접 접근하지 않는다
- 생성된 매니페스트는 Redis에 캐싱하여 반복 요청 시 성능을 향상시킨다

##### Manifest Generation Pipeline (매니페스트 생성 파이프라인)

Repo Server의 매니페스트 생성 과정을 상세히 살펴본다:

```
┌──────────────┐
│  1. Git Clone │
│  또는 Fetch   │
│  (cache 확인)│
└──────┬───────┘
       ▼
┌──────────────┐
│  2. Checkout  │
│  (targetRev)  │  ← 특정 브랜치, 태그, 커밋 해시로 체크아웃
└──────┬───────┘
       ▼
┌──────────────────────────────────┐
│  3. 매니페스트 도구 감지          │
│                                   │
│  path에 다음 파일이 있는지 확인:  │
│  - Chart.yaml → Helm             │
│  - kustomization.yaml → Kustomize│
│  - *.jsonnet → Jsonnet            │
│  - 위에 해당 없으면 → Plain YAML  │
│  - plugin 설정이 있으면 → CMP     │
└──────┬───────────────────────────┘
       ▼
┌──────────────────────────────────┐
│  4. 매니페스트 렌더링             │
│                                   │
│  Helm:                            │
│    helm template <release> <chart>│
│    --values values.yaml           │
│    --set key=value                │
│                                   │
│  Kustomize:                       │
│    kustomize build <path>         │
│    --load-restrictor none         │
│                                   │
│  Plain YAML:                      │
│    디렉토리 내 *.yaml 파일 수집   │
│    재귀적으로 하위 디렉토리 포함  │
│                                   │
│  CMP (sidecar):                   │
│    plugin.generate 명령 실행      │
└──────┬───────────────────────────┘
       ▼
┌──────────────────────────────────┐
│  5. 결과 캐싱 (Redis)             │
│                                   │
│  캐시 키:                         │
│  repo URL + revision + path +     │
│  values hash + plugin config      │
│                                   │
│  TTL: 기본 24시간                 │
│  (ARGOCD_REPO_SERVER_MANIFEST_    │
│   CACHE_TTL 환경변수로 조정)      │
└──────┬───────────────────────────┘
       ▼
┌──────────────────────────────────┐
│  6. Application Controller에     │
│     렌더링 결과 반환              │
│     (gRPC response)              │
└──────────────────────────────────┘
```

##### Repo Server의 Git 저장소 관리

Repo Server는 Git 리포지토리를 로컬 파일시스템에 클론하여 관리한다:

```
/tmp/
└── _argocd-repo/
    ├── <repo-url-hash-1>/    # 리포지토리별 디렉토리
    │   ├── .git/
    │   └── ...
    ├── <repo-url-hash-2>/
    │   ├── .git/
    │   └── ...
    └── ...

동작 방식:
1. 처음 요청 시: git clone --depth 1 (shallow clone)
2. 이후 요청 시: git fetch + git checkout <revision>
3. 캐시가 유효하면: Git 조회 없이 캐시된 매니페스트를 반환
4. Hard Refresh 시: 캐시 무효화 + git fetch --force
```

Repo Server의 보안 격리 설계도 중요하다:
- Repo Server는 Kubernetes API Server에 접근하지 않는다
- Git credential만 접근할 수 있으며, 클러스터 자격 증명에는 접근하지 않는다
- 컨테이너 내에서 최소 권한으로 실행된다 (non-root, read-only filesystem)
- CMP sidecar도 동일한 보안 컨텍스트에서 실행된다

#### Application Controller (`argocd-application-controller`)

- ArgoCD의 핵심 엔진으로, Kubernetes controller 패턴으로 구현되어 있다
- Kubernetes Informer를 사용하여 관리 대상 리소스의 변경 사항을 실시간으로 감시(watch)한다
- Reconciliation Loop를 통해 원하는 상태(Desired State)와 실제 상태(Live State)를 지속적으로 비교한다
- 차이(diff)가 발견되면 Sync Policy에 따라 자동 또는 수동으로 동기화를 수행한다
- Health Assessment를 실행하여 각 리소스의 상태를 판별한다

##### Reconciliation Loop 내부 동작

Application Controller의 Reconciliation Loop는 다음과 같은 단계로 동작한다:

```
┌──────────────────────────────────────────────────────────────────┐
│                  Application Controller                          │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │            Informer Cache (in-memory)                   │     │
│  │                                                          │     │
│  │  Application CRD 변경 감시:                              │     │
│  │    Watch(Application) → Event Queue                      │     │
│  │                                                          │     │
│  │  관리 대상 리소스 변경 감시:                               │     │
│  │    Watch(Deployment, Service, ...) → Event Queue         │     │
│  └─────────────────┬───────────────────────────────────────┘     │
│                     │                                             │
│                     ▼                                             │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │              Work Queue                                  │     │
│  │                                                          │     │
│  │  rate-limited queue로 처리:                               │     │
│  │  - Application 변경 이벤트                                │     │
│  │  - 주기적 reconciliation (기본 3분)                       │     │
│  │  - Webhook 트리거 이벤트                                  │     │
│  │  - 리소스 변경 이벤트 (Self-Heal 용)                      │     │
│  └─────────────────┬───────────────────────────────────────┘     │
│                     │                                             │
│                     ▼                                             │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │         Reconcile 함수 (per Application)                 │     │
│  │                                                          │     │
│  │  Step 1: Repo Server에 매니페스트 요청                    │     │
│  │          → Desired State 획득                             │     │
│  │                                                          │     │
│  │  Step 2: Kubernetes API에서 Live State 조회               │     │
│  │          → Informer cache 또는 직접 API 호출              │     │
│  │                                                          │     │
│  │  Step 3: Desired vs Live Diff 계산                        │     │
│  │          → structured merge diff 알고리즘 사용            │     │
│  │                                                          │     │
│  │  Step 4: Health Assessment 실행                           │     │
│  │          → 내장 또는 커스텀 Lua 스크립트                   │     │
│  │                                                          │     │
│  │  Step 5: Application status 업데이트                      │     │
│  │          → sync.status, health.status 갱신                │     │
│  │                                                          │     │
│  │  Step 6: Auto-Sync 판단                                   │     │
│  │          → OutOfSync이고 Auto-Sync 활성화 시 Sync 실행    │     │
│  └─────────────────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────────────┘
```

##### Controller의 Processing 모델

Application Controller는 worker 기반의 병렬 처리 모델을 사용한다:

```
환경변수:
  ARGOCD_CONTROLLER_REPLICAS    : controller 인스턴스 수 (HA 구성 시)
  ARGOCD_CONTROLLER_STATUS_PROCESSORS : 상태 처리 worker 수 (기본 20)
  ARGOCD_CONTROLLER_OPERATION_PROCESSORS : 작업 처리 worker 수 (기본 10)

Status Processors:
  - Application의 sync/health 상태를 계산하는 worker이다
  - 관리하는 Application이 많을수록 이 값을 늘려야 한다
  - 각 worker는 하나의 Application을 순차적으로 처리한다

Operation Processors:
  - Sync, Rollback 등 실제 작업을 수행하는 worker이다
  - 동시에 실행 가능한 Sync 수를 결정한다
  - 기본값 10은 동시에 10개 Application을 Sync할 수 있다는 뜻이다
```

#### Redis (`argocd-redis`)

- ArgoCD 내부 캐싱 계층으로 사용된다
- Git 리포지토리 메타데이터, 렌더링된 매니페스트, Application 상태 정보를 캐싱한다
- HA 구성 시 Redis Sentinel 또는 Redis Cluster를 사용할 수 있다
- 영속 데이터를 저장하지 않으므로, Redis가 재시작되어도 데이터는 다시 생성된다

##### Redis 캐시 구조

```
Redis 내부 키 구조:

manifest|<repo-url>|<revision>|<path>|<values-hash>
  → 렌더링된 매니페스트 캐시
  → TTL: 24시간 (기본값)

git-refs|<repo-url>
  → Git 리포지토리의 브랜치/태그 목록
  → TTL: 짧은 주기 (빈번하게 갱신)

app|<app-name>
  → Application의 마지막 상태 캐시
  → Informer 재시작 시 빠른 복구에 사용

cluster|<cluster-url>
  → 클러스터 연결 정보 캐시
  → API Server 버전, 지원 리소스 목록 등
```

캐시 무효화 시점은 다음과 같다:
- **Hard Refresh**: 사용자가 명시적으로 요청하면 해당 Application의 캐시를 무효화한다
- **Git Webhook**: 새 커밋이 push되면 해당 리포지토리의 캐시를 무효화한다
- **TTL 만료**: 시간이 지나면 자동으로 캐시가 만료된다
- **Redis 재시작**: 모든 캐시가 초기화되며, 다음 reconciliation 시 재생성된다

#### Dex (선택 사항)

- ArgoCD에 내장된 OIDC(OpenID Connect) 프로바이더이다
- 다양한 Identity Provider와 연동하는 커넥터를 제공한다:
  - GitHub / GitHub Enterprise OAuth
  - GitLab OAuth
  - LDAP / Active Directory
  - SAML 2.0
  - Google, Microsoft, Okta 등 OIDC 프로바이더
- Dex를 사용하지 않고 ArgoCD에 직접 OIDC를 설정할 수도 있다 (bundled Dex 비활성화 후 `oidc.config` 설정)

이 프로젝트에서는 `dex.enabled: false`로 설정되어 Dex가 비활성화되어 있다. 로컬 admin 계정으로만 인증한다.

#### Notifications Controller (`argocd-notifications-controller`)

ArgoCD 2.3부터 내장된 알림 컴포넌트이다. Application의 상태 변경을 감시하고, 설정된 조건에 따라 알림을 전송한다.

#### ApplicationSet Controller (`argocd-applicationset-controller`)

ArgoCD 2.3부터 내장된 컴포넌트이다. ApplicationSet CRD를 감시하고, Generator의 출력에 따라 Application CRD를 자동으로 생성, 수정, 삭제한다.

### 컴포넌트 간 통신 흐름

ArgoCD 컴포넌트 간의 통신 흐름을 상세히 살펴본다:

```
사용자 → (HTTP/gRPC) → API Server
                            │
                            ├─ (gRPC) → Repo Server
                            │              │
                            │              └─ (HTTPS) → Git Repository
                            │
                            ├─ (Redis Protocol) → Redis
                            │
                            └─ (Kubernetes API) → Kubernetes Cluster

Application Controller ─┬─ (gRPC) → Repo Server
                        ├─ (Redis Protocol) → Redis
                        ├─ (Kubernetes API) → Kubernetes Cluster(s)
                        └─ (Kubernetes API) → Application CRD (watch)

Notifications Controller ─┬─ (Kubernetes API) → Application CRD (watch)
                          └─ (HTTPS) → Slack, Email, Webhook 등

ApplicationSet Controller ─┬─ (Kubernetes API) → ApplicationSet CRD (watch)
                           ├─ (Kubernetes API) → Application CRD (CRUD)
                           └─ (HTTPS) → GitHub/GitLab API (SCM/PR generators)
```

### HA(High Availability) 아키텍처

프로덕션 환경에서는 ArgoCD를 HA 모드로 배포할 수 있다:

```
┌─────────────────────────────────────────────────────────┐
│                    HA 구성                               │
│                                                          │
│  API Server:                                             │
│    - 여러 replica로 수평 확장 가능하다                    │
│    - LoadBalancer/Ingress 뒤에 배치한다                  │
│    - Stateless이므로 단순 확장이 가능하다                │
│                                                          │
│  Application Controller:                                 │
│    - Leader Election으로 하나만 활성화된다                │
│    - 나머지는 standby로 대기한다                         │
│    - 또는 sharding으로 Application을 분산 처리한다       │
│                                                          │
│  Repo Server:                                            │
│    - 여러 replica로 수평 확장 가능하다                    │
│    - Stateless이므로 단순 확장이 가능하다                │
│    - 각 replica가 독립적으로 Git clone/render 수행       │
│                                                          │
│  Redis:                                                  │
│    - Redis Sentinel 또는 Redis Cluster를 사용한다        │
│    - 3노드 이상의 Sentinel 구성을 권장한다              │
│    - 캐시 전용이므로 데이터 유실은 성능 저하만 초래한다  │
└─────────────────────────────────────────────────────────┘
```

---

