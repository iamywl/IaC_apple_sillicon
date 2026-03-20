# Day 3: Application CRD와 Sync 메커니즘

Application CRD 스펙 상세, Source/Destination 설정, Sync Policy, Sync Wave와 Hook, Resource Hook, Retry 전략, 그리고 Selective Sync를 다룬다.

---

## 3장: Application CRD 심화

### Application 리소스 전체 구조

Application CRD는 ArgoCD의 핵심 리소스이다. 각 필드를 상세히 살펴본다:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: my-app
  namespace: argocd                  # 반드시 argocd 네임스페이스에 생성해야 한다
  labels:
    team: backend
    env: production
  annotations:
    # 알림 설정
    notifications.argoproj.io/subscribe.on-deployed.slack: deploy-channel
  finalizers:
    # 이 finalizer가 있으면 Application 삭제 시 관리 대상 리소스도 삭제된다
    - resources-finalizer.argocd.argoproj.io
    # cascade 삭제를 foreground로 수행한다 (모든 자식 리소스가 삭제된 후 부모 삭제)
    # - resources-finalizer.argocd.argoproj.io/foreground
    # cascade 삭제를 background로 수행한다 (부모 먼저 삭제, 자식은 GC가 처리)
    # - resources-finalizer.argocd.argoproj.io/background
spec:
  # ──────────────────────────────────────────
  # project: 이 Application이 속하는 AppProject
  # ──────────────────────────────────────────
  project: default

  # ──────────────────────────────────────────
  # source: 매니페스트 소스 정의 (단일 소스)
  # ──────────────────────────────────────────
  source:
    repoURL: https://github.com/org/manifests.git
    targetRevision: main        # 브랜치, 태그, 커밋 해시 가능
    path: deploy/production     # 리포 내 매니페스트 경로

    # --- Helm 소스인 경우 ---
    # chart: my-chart          # Helm 차트 이름 (repoURL이 Helm repo일 때)
    helm:
      valueFiles:
        - values.yaml
        - values-production.yaml
      parameters:
        - name: image.tag
          value: "v1.2.3"
      values: |                # inline values (valueFiles와 병합된다)
        replicas: 3
      releaseName: my-release  # Helm release 이름
      passCredentials: false   # Helm repo 인증 시 자격 증명 전달 여부
      version: v3              # Helm 버전 (v2 또는 v3)
      skipCrds: false          # CRD 설치를 건너뛸지 여부

    # --- Kustomize 소스인 경우 ---
    kustomize:
      namePrefix: prod-
      nameSuffix: -v1
      commonLabels:
        env: production
      commonAnnotations:
        team: platform
      images:
        - my-app=registry.example.com/my-app:v1.2.3
      forceCommonLabels: true   # 기존 레이블을 덮어쓸지 여부
      forceCommonAnnotations: true

    # --- Directory 소스인 경우 ---
    directory:
      recurse: true            # 하위 디렉토리를 재귀적으로 포함한다
      jsonnet:                 # Jsonnet 설정
        tlas:                  # Top-Level Arguments
          - name: env
            value: production
        extVars:               # External Variables
          - name: cluster
            value: prod-east

    # --- Plugin 소스인 경우 ---
    plugin:
      name: my-plugin
      env:
        - name: ENV
          value: production

  # ──────────────────────────────────────────
  # sources: 다중 소스 정의 (ArgoCD 2.6+)
  # source와 sources는 상호 배타적이다
  # ──────────────────────────────────────────
  # sources:
  #   - repoURL: https://charts.example.com
  #     chart: my-chart
  #     targetRevision: 1.0.0
  #     helm:
  #       valueFiles:
  #         - $values/envs/prod/values.yaml
  #   - repoURL: https://github.com/org/config.git
  #     targetRevision: main
  #     ref: values              # $values로 참조할 수 있다

  # ──────────────────────────────────────────
  # destination: 배포 대상 정의
  # ──────────────────────────────────────────
  destination:
    server: https://kubernetes.default.svc  # 클러스터 URL
    # name: in-cluster                       # 또는 클러스터 이름 (server와 상호 배타적)
    namespace: my-app

  # ──────────────────────────────────────────
  # syncPolicy: 동기화 정책
  # ──────────────────────────────────────────
  syncPolicy:
    automated:
      prune: true              # Git에서 삭제된 리소스를 클러스터에서도 삭제한다
      selfHeal: true           # 수동 변경을 자동 복구한다
      allowEmpty: false        # 모든 리소스가 삭제되어도 허용할지 여부
    syncOptions:
      - CreateNamespace=true
      - PrunePropagationPolicy=foreground
      - PruneLast=true
      - ApplyOutOfSyncOnly=true
      - ServerSideApply=true
      - Validate=true
      - RespectIgnoreDifferences=true
      - FailOnSharedResource=true
    retry:
      limit: 5                 # 재시도 횟수 (-1이면 무제한)
      backoff:
        duration: 5s           # 초기 대기 시간
        factor: 2              # 지수 백오프 배수
        maxDuration: 3m        # 최대 대기 시간
    managedNamespaceMetadata:  # CreateNamespace=true일 때 네임스페이스 메타데이터
      labels:
        env: production
      annotations:
        team: platform

  # ──────────────────────────────────────────
  # ignoreDifferences: diff에서 제외할 필드
  # ──────────────────────────────────────────
  ignoreDifferences:
    - group: apps
      kind: Deployment
      jqPathExpressions:
        - .spec.replicas                    # HPA가 관리하는 replicas
    - group: ""
      kind: Service
      jsonPointers:
        - /spec/clusterIP                   # 자동 할당되는 ClusterIP
    - group: "*"
      kind: "*"
      managedFieldsManagers:
        - kube-controller-manager           # 시스템 컴포넌트가 관리하는 필드

  # ──────────────────────────────────────────
  # info: 추가 정보 (UI에 표시)
  # ──────────────────────────────────────────
  info:
    - name: Owner
      value: platform-team
    - name: Runbook
      value: https://wiki.example.com/my-app/runbook
    - name: Dashboard
      value: https://grafana.example.com/d/my-app

  # ──────────────────────────────────────────
  # revisionHistoryLimit: 유지할 이전 Sync 이력 수
  # ──────────────────────────────────────────
  revisionHistoryLimit: 10
```

### Application Status 필드

Application CRD의 status 필드는 ArgoCD가 자동으로 관리한다. 주요 status 필드는 다음과 같다:

```yaml
status:
  # Sync 상태
  sync:
    status: Synced              # Synced | OutOfSync | Unknown
    comparedTo:
      source:
        repoURL: https://github.com/org/manifests.git
        path: deploy/production
        targetRevision: main
      destination:
        server: https://kubernetes.default.svc
        namespace: my-app
    revision: a1b2c3d4e5f6      # 현재 동기화된 Git 커밋 해시

  # Health 상태
  health:
    status: Healthy             # Healthy | Progressing | Degraded | Suspended | Missing | Unknown
    message: ""

  # 마지막 작업 상태
  operationState:
    phase: Succeeded            # Succeeded | Failed | Error | Running
    operation:
      sync:
        revision: a1b2c3d4e5f6
    startedAt: "2024-01-15T10:00:00Z"
    finishedAt: "2024-01-15T10:00:30Z"
    message: "successfully synced"
    syncResult:
      resources:                # 각 리소스의 Sync 결과
        - group: apps
          version: v1
          kind: Deployment
          name: my-app
          namespace: my-app
          status: Synced
          message: "deployment.apps/my-app configured"
          hookPhase: Sync

  # 관리 대상 리소스 목록
  resources:
    - group: apps
      version: v1
      kind: Deployment
      name: my-app
      namespace: my-app
      status: Synced
      health:
        status: Healthy
    - group: ""
      version: v1
      kind: Service
      name: my-app
      namespace: my-app
      status: Synced
      health:
        status: Healthy

  # 조건 (경고/에러)
  conditions:
    - type: SyncError
      message: "ComparisonError: failed to load..."
      lastTransitionTime: "2024-01-15T10:00:00Z"

  # Sync 히스토리
  history:
    - revision: a1b2c3d4e5f6
      deployedAt: "2024-01-15T10:00:00Z"
      id: 1
      source:
        repoURL: https://github.com/org/manifests.git
        path: deploy/production
        targetRevision: main

  # 소스 타입
  sourceType: Kustomize         # Helm | Kustomize | Directory | Plugin

  # 요약
  summary:
    images:
      - "registry.example.com/my-app:v1.2.3"
      - "nginx:1.25"
```

### Multi-Source Applications (ArgoCD 2.6+)

Multi-Source Application은 여러 소스에서 매니페스트를 가져와 하나의 Application으로 관리하는 기능이다. 대표적인 사용 사례는 다음과 같다:

**사용 사례 1: Helm chart + 별도 values 리포지토리**

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: my-app
  namespace: argocd
spec:
  project: default
  sources:
    # 1. Helm chart 소스
    - repoURL: https://charts.example.com
      chart: my-app
      targetRevision: 2.1.0
      helm:
        valueFiles:
          - $values/envs/production/values.yaml    # $values는 아래 ref와 매칭
          - $values/envs/production/secrets.yaml
    # 2. Values 파일이 있는 Git 리포지토리
    - repoURL: https://github.com/org/app-config.git
      targetRevision: main
      ref: values        # 이 ref 이름으로 다른 소스에서 참조할 수 있다
  destination:
    server: https://kubernetes.default.svc
    namespace: my-app
```

**사용 사례 2: 여러 Git 리포지토리의 매니페스트를 합치기**

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: full-stack-app
  namespace: argocd
spec:
  project: default
  sources:
    # Frontend 매니페스트
    - repoURL: https://github.com/org/frontend.git
      targetRevision: main
      path: deploy/k8s
    # Backend 매니페스트
    - repoURL: https://github.com/org/backend.git
      targetRevision: main
      path: deploy/k8s
    # 공통 인프라 (Ingress, ConfigMap 등)
    - repoURL: https://github.com/org/infra.git
      targetRevision: main
      path: deploy/shared
  destination:
    server: https://kubernetes.default.svc
    namespace: full-stack
```

Multi-Source 사용 시 주의사항:
- `source`와 `sources`는 상호 배타적이다. 둘 다 지정하면 에러가 발생한다
- 각 소스의 매니페스트는 합쳐져서(union) 하나의 Application으로 관리된다
- 동일한 리소스가 여러 소스에 있으면 충돌이 발생할 수 있다
- `$ref` 문법은 `helm.valueFiles`에서만 사용할 수 있다

---

## 4장: Sync 메커니즘 상세

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

### Sync Phase 상세 실행 흐름

```
┌─────────────────────────────────────────────────────────────────────┐
│                      Sync 실행 흐름 상세                            │
│                                                                      │
│  1. PreSync Phase                                                    │
│     ┌─────────────────────────────────────────────────────────┐     │
│     │  a. PreSync hook 리소스를 wave 순서대로 생성한다          │     │
│     │  b. 각 hook이 완료(Succeeded/Failed)될 때까지 대기한다    │     │
│     │  c. 모든 PreSync hook이 성공하면 다음 단계로 진행한다     │     │
│     │  d. 하나라도 실패하면 Sync를 중단하고 SyncFail로 이동     │     │
│     └─────────────────────────────────────────────────────────┘     │
│                              │                                       │
│                              ▼                                       │
│  2. Sync Phase                                                       │
│     ┌─────────────────────────────────────────────────────────┐     │
│     │  a. 일반 리소스를 wave 순서대로 apply한다                 │     │
│     │  b. 동일 wave 내에서는 kind 순서로 적용한다:              │     │
│     │     Namespace → NetworkPolicy → ResourceQuota →          │     │
│     │     LimitRange → ServiceAccount → Secret → ConfigMap →   │     │
│     │     StorageClass → PV → PVC → Service → Deployment →    │     │
│     │     StatefulSet → DaemonSet → Ingress → ...              │     │
│     │  c. 각 wave의 모든 리소스가 Healthy가 될 때까지 대기      │     │
│     │  d. 이전 wave가 완료되어야 다음 wave를 시작한다           │     │
│     └─────────────────────────────────────────────────────────┘     │
│                              │                                       │
│                              ▼                                       │
│  3. PostSync Phase                                                   │
│     ┌─────────────────────────────────────────────────────────┐     │
│     │  a. 모든 Sync 리소스가 Healthy가 된 후 실행한다           │     │
│     │  b. PostSync hook을 wave 순서대로 생성한다                │     │
│     │  c. 통합 테스트, smoke test, 알림 전송 등에 사용한다      │     │
│     └─────────────────────────────────────────────────────────┘     │
│                              │                                       │
│                         (실패 시)                                    │
│                              ▼                                       │
│  4. SyncFail Phase                                                   │
│     ┌─────────────────────────────────────────────────────────┐     │
│     │  a. 어느 단계에서든 실패 시 실행된다                       │     │
│     │  b. 실패 알림 전송, 롤백 스크립트 실행 등에 사용한다      │     │
│     └─────────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────────┘
```

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

### Sync Wave 동작 규칙

Wave 내 리소스 적용 순서는 다음 규칙을 따른다:

```
1. Phase 순서: PreSync → Sync → PostSync
2. 동일 Phase 내에서 wave 숫자가 낮은 것부터 적용한다
3. 동일 wave 내에서는 Kubernetes 리소스 kind 순서를 따른다
4. 각 wave의 모든 리소스가 Healthy가 되어야 다음 wave로 진행한다
5. 하나의 리소스라도 실패하면 전체 Sync가 중단된다

리소스 kind 기본 순서 (wave 내):
  0  - Namespace
  1  - NetworkPolicy
  2  - ResourceQuota
  3  - LimitRange
  4  - PodSecurityPolicy
  5  - ServiceAccount
  6  - Secret
  7  - SecretProviderClass
  8  - ConfigMap
  9  - StorageClass
  10 - PersistentVolume
  11 - PersistentVolumeClaim
  12 - CustomResourceDefinition
  13 - ClusterRole
  14 - ClusterRoleBinding
  15 - Role
  16 - RoleBinding
  17 - Service
  18 - DaemonSet
  19 - Pod
  20 - ReplicationController
  21 - ReplicaSet
  22 - Deployment
  23 - StatefulSet
  24 - Job
  25 - CronJob
  26 - Ingress
  27 - APIService
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

### 고급 Hook 패턴

#### PostSync 통합 테스트

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: integration-test
  annotations:
    argocd.argoproj.io/hook: PostSync
    argocd.argoproj.io/hook-delete-policy: HookSucceeded
    argocd.argoproj.io/sync-wave: "0"
spec:
  template:
    spec:
      containers:
        - name: test
          image: curlimages/curl:latest
          command:
            - /bin/sh
            - -c
            - |
              echo "Running integration tests..."
              # 서비스 헬스 체크
              for i in $(seq 1 30); do
                if curl -sf http://my-app.my-namespace.svc.cluster.local/healthz; then
                  echo "Health check passed"
                  exit 0
                fi
                echo "Attempt $i failed, retrying..."
                sleep 2
              done
              echo "Integration test failed"
              exit 1
      restartPolicy: Never
  backoffLimit: 1
```

#### SyncFail 실패 알림

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: notify-failure
  annotations:
    argocd.argoproj.io/hook: SyncFail
    argocd.argoproj.io/hook-delete-policy: HookSucceeded
spec:
  template:
    spec:
      containers:
        - name: notify
          image: curlimages/curl:latest
          command:
            - /bin/sh
            - -c
            - |
              curl -X POST https://hooks.slack.com/services/xxx/yyy/zzz \
                -H "Content-Type: application/json" \
                -d '{"text":"Sync failed for my-app!"}'
      restartPolicy: Never
  backoffLimit: 0
```

### Sync Options 상세

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

#### 개별 리소스에 Sync Option 적용

Application 전체가 아닌 개별 리소스에 sync option을 적용할 수도 있다:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
  annotations:
    # 이 리소스에 대해서만 Server-Side Apply를 사용한다
    argocd.argoproj.io/sync-options: ServerSideApply=true

    # 여러 옵션을 쉼표로 구분한다
    # argocd.argoproj.io/sync-options: ServerSideApply=true,Prune=false
spec:
  # ...
```

자주 사용하는 리소스별 sync option은 다음과 같다:

```yaml
# CRD에 Server-Side Apply 적용 (대규모 CRD에 유용)
apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
metadata:
  name: certificates.cert-manager.io
  annotations:
    argocd.argoproj.io/sync-options: ServerSideApply=true

---
# 특정 리소스를 pruning에서 제외
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: important-data
  annotations:
    argocd.argoproj.io/sync-options: Prune=false
```

### Dry Run과 Preview

Sync를 실행하기 전에 변경 사항을 미리 확인하는 방법이다:

```bash
# CLI에서 dry run (실제 적용하지 않고 변경 사항만 표시)
argocd app sync my-app --dry-run

# diff만 확인 (dry run보다 가볍다)
argocd app diff my-app

# 특정 리소스만 선택적으로 Sync
argocd app sync my-app --resource apps:Deployment:my-app
argocd app sync my-app --resource :Service:my-app-svc

# 여러 리소스를 선택적으로 Sync
argocd app sync my-app \
  --resource apps:Deployment:my-app \
  --resource :Service:my-app-svc

# 특정 label의 리소스만 Sync
argocd app sync my-app --label component=frontend

# Prune만 실행 (삭제 대상만 처리)
argocd app sync my-app --prune

# Sync 시 특정 revision 지정
argocd app sync my-app --revision a1b2c3d
```

### Apply 방식

| 방식 | 설명 |
|------|------|
| **kubectl apply** (기본값) | 3-way merge patch를 사용한다. 대부분의 경우 적합하다 |
| **Server-Side Apply** | Kubernetes API Server가 병합을 수행한다. 필드 소유권(field ownership)을 추적한다. `ServerSideApply=true` sync option으로 활성화한다 |
| **kubectl replace** | 리소스를 완전히 교체한다. 기존 리소스를 삭제하고 재생성한다. `Replace=true` sync option으로 활성화한다 |
| **kubectl create** | 리소스가 없을 때만 생성한다. 이미 존재하면 건너뛴다. `CreateOnly=true` sync option을 사용한다 |

#### Server-Side Apply vs Client-Side Apply

```
Client-Side Apply (kubectl apply, 기본값):
  1. 클라이언트(ArgoCD)가 3-way merge patch를 계산한다
  2. PATCH 요청을 API Server에 전송한다
  3. 장점: 간단하고 대부분의 경우에 작동한다
  4. 단점: 대규모 CRD에서 annotation size limit (262144 bytes) 초과 가능
  5. 단점: 필드 소유권 추적이 불가능하다

Server-Side Apply (SSA):
  1. ArgoCD가 전체 매니페스트를 API Server에 전송한다
  2. API Server가 필드 소유권을 추적하며 병합을 수행한다
  3. 장점: annotation size limit 문제가 없다
  4. 장점: 여러 controller가 동일 리소스의 서로 다른 필드를 관리할 수 있다
  5. 장점: 더 정확한 diff를 생성한다
  6. 사용: syncOptions에 ServerSideApply=true를 추가한다

SSA가 권장되는 경우:
  - 대규모 CRD (cert-manager, Istio 등)
  - HPA와 Deployment의 replicas 필드 충돌 시
  - 여러 도구가 동일 리소스를 관리하는 경우
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

Sync Window 동작 규칙은 다음과 같다:
- `allow` window가 하나라도 정의되면, allow window가 열려 있을 때만 Sync가 가능하다
- `deny` window가 열려 있으면 Sync가 차단된다
- `deny`가 `allow`보다 우선한다 (deny window와 allow window가 겹치면 deny가 적용된다)
- `manualSync: true`를 설정하면 수동 Sync도 차단된다 (기본적으로 수동 Sync는 window 제한을 받지 않는다)

---

