# Day 8: Helm/Kustomize 통합, 트러블슈팅, 실전 패턴

Helm/Kustomize 통합, Config Management Plugin(CMP), 트러블슈팅 가이드, App of Apps 패턴, 환경별 배포 전략, Progressive Delivery(Argo Rollouts), 그리고 Sync 상태 흐름을 다룬다.

---

## 15장: Helm/Kustomize 통합

### Helm 통합 상세

#### Helm Chart 리포지토리 소스

```yaml
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

#### Helm values 우선순위

ArgoCD에서 Helm values가 적용되는 우선순위는 다음과 같다:

```
낮은 우선순위 ──────────────────────────► 높은 우선순위

Chart 기본값     valueFiles      values (inline)    parameters
(values.yaml)   (순서대로)                          (개별 키=값)

예시:
  source:
    helm:
      valueFiles:
        - values-base.yaml        # 2번째로 적용
        - values-production.yaml  # 3번째로 적용 (base를 오버라이드)
      values: |                   # 4번째로 적용
        replicas: 5
      parameters:                 # 5번째로 적용 (최고 우선순위)
        - name: replicas
          value: "10"             # 이 값이 최종 적용됨
```

#### Helm Release Name

```yaml
source:
  helm:
    releaseName: my-custom-release  # 기본값: Application 이름
    # Helm이 생성하는 리소스의 이름에 영향을 미친다
    # 예: {{ .Release.Name }}-nginx → my-custom-release-nginx
```

#### Helm Skip CRDs

```yaml
source:
  helm:
    skipCrds: true    # CRD 설치를 건너뛴다
    # Operator를 설치할 때 CRD를 별도로 관리하는 경우에 유용하다
    # 예: cert-manager CRD를 별도 Application으로 관리
```

#### Git 리포지토리의 Helm Chart

```yaml
# Git 리포지토리에 Helm chart가 있는 경우
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: my-app
  namespace: argocd
spec:
  source:
    repoURL: https://github.com/org/my-app.git
    targetRevision: main
    path: charts/my-app          # Chart.yaml이 있는 경로
    helm:
      valueFiles:
        - ../../values/production.yaml   # 상대 경로로 values 파일 지정
      values: |
        image:
          tag: v1.2.3
```

### Kustomize 통합 상세

#### 기본 Kustomize 설정

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
      nameSuffix: -v1
      commonLabels:
        env: production
        team: backend
      commonAnnotations:
        managed-by: argocd
      images:
        - my-app=registry.example.com/my-app:v1.2.3
        - nginx=nginx:1.25-alpine
      forceCommonLabels: true     # 기존 레이블을 덮어쓸지 여부
      forceCommonAnnotations: true
  destination:
    server: https://kubernetes.default.svc
    namespace: production
```

#### Kustomize 디렉토리 구조 패턴

```
manifests/
├── base/                        # 공통 매니페스트
│   ├── kustomization.yaml
│   ├── deployment.yaml
│   ├── service.yaml
│   └── configmap.yaml
├── components/                  # 재사용 가능한 컴포넌트
│   ├── monitoring/
│   │   ├── kustomization.yaml
│   │   └── service-monitor.yaml
│   └── hpa/
│       ├── kustomization.yaml
│       └── hpa.yaml
└── overlays/
    ├── dev/
    │   ├── kustomization.yaml   # resources: [../../base]
    │   ├── patch-replicas.yaml  # replicas: 1
    │   └── configmap-patch.yaml
    ├── staging/
    │   ├── kustomization.yaml
    │   └── patch-replicas.yaml  # replicas: 2
    └── production/
        ├── kustomization.yaml   # resources + components 참조
        ├── patch-replicas.yaml  # replicas: 3
        └── patch-resources.yaml
```

#### Kustomize 버전 지정

```yaml
# argocd-cm ConfigMap
data:
  kustomize.buildOptions: "--load-restrictor LoadRestrictionsNone --enable-helm"
  # --load-restrictor: 외부 경로 참조를 허용한다
  # --enable-helm: Kustomize에서 Helm chart를 사용할 수 있다

  # Kustomize 버전별 경로 (여러 버전을 동시에 사용)
  kustomize.path.v4.5.7: /usr/local/bin/kustomize-4.5.7
  kustomize.path.v5.0.3: /usr/local/bin/kustomize-5.0.3

# Application에서 Kustomize 버전 지정
# source:
#   kustomize:
#     version: v5.0.3
```

### Config Management Plugins (CMP)

Helm과 Kustomize 외에 커스텀 도구를 사용하여 매니페스트를 생성할 수 있다:

```yaml
# CMP sidecar 설정
apiVersion: v1
kind: ConfigMap
metadata:
  name: cmp-plugin
  namespace: argocd
data:
  plugin.yaml: |
    apiVersion: argoproj.io/v1alpha1
    kind: ConfigManagementPlugin
    metadata:
      name: envsubst
    spec:
      version: v1.0
      init:
        command: [sh, -c, "echo Initializing..."]
      generate:
        command: [sh, -c]
        args:
          - |
            for f in *.yaml; do
              envsubst < "$f"
            done
      discover:
        fileName: ".envsubst"    # 이 파일이 있으면 이 플러그인을 사용한다

---
# Application에서 CMP 사용
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: my-app
  namespace: argocd
spec:
  source:
    repoURL: https://github.com/org/manifests.git
    targetRevision: main
    path: deploy
    plugin:
      name: envsubst
      env:
        - name: APP_NAME
          value: my-app
        - name: REPLICAS
          value: "3"
```

---

## 16장: 트러블슈팅

### Sync 실패 원인과 해결

#### 1. ComparisonError: 매니페스트 렌더링 실패

```
증상: Application 상태가 "Unknown"이고 conditions에 ComparisonError가 표시된다

원인:
  - Git 리포지토리에 접근할 수 없다 (인증 실패, 네트워크 오류)
  - Helm chart 렌더링 실패 (values 파일 오류, 잘못된 파라미터)
  - Kustomize build 실패 (잘못된 kustomization.yaml)

진단:
  argocd app get <app-name>               # 에러 메시지 확인
  kubectl logs -n argocd deployment/argocd-repo-server  # Repo Server 로그 확인

해결:
  # Git 접근 확인
  argocd repo list
  argocd repo get <repo-url>

  # 로컬에서 매니페스트 렌더링 테스트
  helm template my-release ./chart -f values.yaml
  kustomize build overlays/production

  # Hard Refresh
  argocd app get <app-name> --hard-refresh
```

#### 2. SyncError: apply 실패

```
증상: Sync가 "Failed" 상태이고 리소스 적용 에러가 표시된다

원인:
  - RBAC 권한 부족 (ArgoCD ServiceAccount에 필요한 권한이 없다)
  - 리소스 validation 실패
  - Admission Webhook이 요청을 거부했다
  - 리소스 충돌 (다른 도구가 동일 리소스를 관리하고 있다)

진단:
  argocd app sync <app-name> --dry-run    # dry-run으로 에러 확인
  kubectl describe <resource-type> <resource-name>  # 이벤트 확인

해결:
  # 권한 확인
  kubectl auth can-i <verb> <resource> --as system:serviceaccount:argocd:argocd-application-controller

  # Validation 건너뛰기 (임시 해결)
  # syncOptions: Validate=false

  # Server-Side Apply로 전환 (충돌 해결)
  # syncOptions: ServerSideApply=true
```

#### 3. OutOfSync가 해소되지 않는 경우

```
증상: Sync를 실행해도 계속 OutOfSync 상태가 유지된다

원인:
  - Kubernetes defaulting으로 인한 오탐 (false positive)
  - Admission Webhook이 필드를 변경한다 (예: Istio sidecar injection)
  - 다른 controller가 필드를 수정한다 (예: HPA가 replicas를 변경)
  - annotation size limit 초과 (kubectl.kubernetes.io/last-applied-configuration)

진단:
  argocd app diff <app-name>              # 정확한 diff 확인
  argocd app diff <app-name> --local ./   # 로컬 매니페스트와 비교

해결:
  # 1. ignoreDifferences 설정
  spec:
    ignoreDifferences:
      - group: apps
        kind: Deployment
        jqPathExpressions:
          - .spec.replicas                # HPA가 관리하는 필드

  # 2. Server-Side Diff 활성화
  # argocd-cm: controller.diff.server.side: "true"

  # 3. ServerSideApply 사용 (annotation size limit 해결)
  # syncOptions: ServerSideApply=true
```

#### 4. Resource Hook 실패

```
증상: PreSync/PostSync hook Job이 실패하여 Sync가 중단된다

진단:
  # Hook Job 상태 확인
  kubectl get jobs -n <namespace> -l argocd.argoproj.io/hook

  # Job의 Pod 로그 확인
  kubectl logs -n <namespace> job/<hook-job-name>

  # Hook 이벤트 확인
  kubectl describe job -n <namespace> <hook-job-name>

해결:
  # 1. Hook Job의 backoffLimit 확인
  # 2. Hook의 command/script 오류 수정
  # 3. 필요시 hook-delete-policy를 BeforeHookCreation으로 변경
  #    (이전 실패한 Job을 삭제하고 재실행)
```

#### 5. App-of-Apps 패턴 문제

```
증상: 자식 Application이 생성되지 않거나 OutOfSync 상태이다

원인:
  - root Application의 destination이 argocd 네임스페이스가 아니다
  - 자식 Application YAML에 문법 오류가 있다
  - AppProject 제한으로 자식 Application 생성이 차단된다

진단:
  # root Application 상태 확인
  argocd app get root-app

  # root Application의 리소스 트리 확인
  argocd app resources root-app

  # 자식 Application 목록 확인
  argocd app list

해결:
  # root Application의 destination이 올바른지 확인
  # destination:
  #   server: https://kubernetes.default.svc
  #   namespace: argocd    # Application CRD는 argocd 네임스페이스에 생성해야 한다
```

#### 6. Git 리포지토리 연결 문제

```
진단:
  # 리포지토리 연결 테스트
  argocd repo add <url> --username <user> --password <pass>

  # 또는 SSH 키 사용
  argocd repo add <url> --ssh-private-key-path ~/.ssh/id_rsa

  # Repo Server 로그 확인
  kubectl logs -n argocd deployment/argocd-repo-server -f

  # 리포지토리 목록 및 상태 확인
  argocd repo list

일반적인 문제:
  - HTTPS: 자체 서명 인증서 → --insecure-skip-server-verification
  - SSH: known_hosts 미등록 → argocd cert add-ssh
  - 토큰 만료 → 리포지토리 credential 갱신
  - 방화벽: ArgoCD Pod에서 Git 서버로의 아웃바운드 차단
```

### 유용한 디버깅 명령어

```bash
# Application 상세 정보
argocd app get <app-name> -o yaml

# Application 이벤트 히스토리
argocd app history <app-name>

# Application 리소스 트리
argocd app resources <app-name>
argocd app resources <app-name> --tree

# Diff 확인
argocd app diff <app-name>

# Hard Refresh (캐시 무시)
argocd app get <app-name> --hard-refresh

# 컴포넌트 로그 확인
kubectl logs -n argocd deployment/argocd-server -f
kubectl logs -n argocd deployment/argocd-repo-server -f
kubectl logs -n argocd statefulset/argocd-application-controller -f
kubectl logs -n argocd deployment/argocd-notifications-controller -f
kubectl logs -n argocd deployment/argocd-applicationset-controller -f

# Redis 상태 확인
kubectl exec -n argocd deployment/argocd-redis -- redis-cli info memory
kubectl exec -n argocd deployment/argocd-redis -- redis-cli dbsize

# ArgoCD 버전 확인
argocd version

# 클러스터 연결 상태 확인
argocd cluster list
```

---

## 17장: 실전 패턴

### App-of-Apps 패턴

모든 Application을 관리하는 최상위 Application을 두는 패턴이다:

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

App-of-Apps 패턴의 장단점은 다음과 같다:

```
장점:
  - 모든 Application을 하나의 진입점으로 관리할 수 있다
  - 새로운 Application 추가가 파일 추가만으로 가능하다
  - Application의 lifecycle을 Git으로 관리한다
  - Bootstrap이 간단하다 (root-app 하나만 생성하면 된다)

단점:
  - root Application이 삭제되면 모든 자식 Application이 삭제될 수 있다
  - 대규모 환경에서 단일 root가 병목이 될 수 있다
  - ApplicationSet이 대부분의 사용 사례를 더 잘 처리한다

권장 사항:
  - 소규모 팀/프로젝트에서는 App-of-Apps가 적합하다
  - 대규모/멀티 팀 환경에서는 ApplicationSet을 권장한다
  - root Application에 finalizer를 설정하지 않는 것이 안전하다
  - 자식 Application에 cascade 삭제 정책을 신중히 설정한다
```

### App-of-Apps vs ApplicationSet

| 항목 | App-of-Apps | ApplicationSet |
|------|-------------|----------------|
| 구현 방식 | Application YAML 파일을 직접 작성한다 | 템플릿 + Generator로 자동 생성한다 |
| 유연성 | 각 Application을 완전히 다르게 설정 가능 | 템플릿 기반이므로 구조가 유사해야 한다 |
| 확장성 | 파일을 수동으로 추가해야 한다 | Generator가 자동으로 Application을 생성한다 |
| 동적 생성 | 불가 (수동 파일 추가) | PR Generator, SCM Provider 등으로 자동 생성 |
| 삭제 시 동작 | Application CRD 삭제 정책에 따른다 | preserveResourcesOnDeletion 정책 적용 |
| 복잡도 | 낮음 | 중간 |
| 추천 사례 | 소규모, 이기종 Application | 대규모, 균일한 구조의 Application |

### Mono-Repo vs Multi-Repo

#### Mono-Repo 패턴

```
infra-manifests/                # 단일 리포지토리
├── apps/
│   ├── app-a/
│   │   ├── base/
│   │   └── overlays/
│   │       ├── dev/
│   │       ├── staging/
│   │       └── production/
│   ├── app-b/
│   │   ├── base/
│   │   └── overlays/
│   └── app-c/
├── infrastructure/
│   ├── monitoring/
│   ├── logging/
│   └── ingress/
├── argocd/
│   ├── root-app.yaml
│   └── projects/
└── cluster-config/
    ├── namespaces/
    └── rbac/

장점:
  - 모든 매니페스트가 한 곳에 있어 검색/변경이 쉽다
  - 여러 앱에 걸친 변경을 하나의 PR로 처리할 수 있다
  - ArgoCD 설정이 단순하다 (리포지토리 하나만 등록)
  - 의존성 관계를 한눈에 파악할 수 있다

단점:
  - 리포지토리가 커지면 Git 성능이 저하될 수 있다
  - 팀 간 접근 제어가 어렵다 (Git branch protection으로 부분적 해결)
  - 하나의 앱 변경이 다른 앱에 영향을 줄 수 있다 (의도치 않은 변경)
```

#### Multi-Repo 패턴

```
org/
├── app-a-manifests/            # 앱별 별도 리포지토리
│   ├── base/
│   └── overlays/
├── app-b-manifests/
│   ├── base/
│   └── overlays/
├── infra-manifests/            # 인프라 전용 리포지토리
│   ├── monitoring/
│   └── logging/
├── cluster-config/             # 클러스터 설정 리포지토리
│   ├── namespaces/
│   └── rbac/
└── argocd-config/              # ArgoCD 설정 리포지토리
    ├── apps/
    └── projects/

장점:
  - 팀별 독립적인 리포지토리 관리가 가능하다
  - 접근 제어가 리포지토리 수준에서 자연스럽다
  - 각 앱의 변경 이력이 분리된다
  - 리포지토리 크기가 작아 Git 성능이 좋다

단점:
  - ArgoCD에 여러 리포지토리를 등록해야 한다
  - 여러 앱에 걸친 변경이 복잡하다 (여러 PR 필요)
  - 공통 설정을 공유하기 어렵다
  - 전체 상태를 파악하기 위해 여러 리포지토리를 확인해야 한다
```

#### 권장 사항

```
소규모 팀 (1~3개 팀, ~30 서비스):
  → Mono-Repo 권장
  → 관리 오버헤드가 낮고, 전체 상태를 한눈에 파악할 수 있다

대규모 조직 (5개+ 팀, 50+ 서비스):
  → Multi-Repo 권장
  → 팀 자율성과 접근 제어가 중요하다

하이브리드:
  → 인프라/플랫폼은 Mono-Repo, 앱은 Multi-Repo
  → 가장 일반적인 실전 패턴이다
```

### Environment Promotion (환경 승격)

개발 → 스테이징 → 프로덕션 순서로 변경 사항을 승격하는 패턴이다:

#### 브랜치 기반 승격

```
Git 브랜치:
  develop  → dev 환경에 자동 배포
  staging  → staging 환경에 자동 배포
  main     → production 환경에 자동 배포

승격 흐름:
  develop에 merge → dev 자동 배포 → 테스트 통과
    ↓
  develop → staging PR 생성 → 코드 리뷰 → merge → staging 자동 배포
    ↓
  staging → main PR 생성 → 승인 → merge → production 자동 배포
```

```yaml
# 환경별 Application
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: my-app-dev
spec:
  source:
    targetRevision: develop    # develop 브랜치
    path: overlays/dev
---
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: my-app-staging
spec:
  source:
    targetRevision: staging    # staging 브랜치
    path: overlays/staging
---
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: my-app-production
spec:
  source:
    targetRevision: main       # main 브랜치
    path: overlays/production
  syncPolicy:
    automated:
      selfHeal: true
      prune: false             # production에서는 auto-prune 비활성화
```

#### 디렉토리 기반 승격

```
Git 구조:
  manifests/
  ├── overlays/
  │   ├── dev/
  │   │   ├── kustomization.yaml
  │   │   └── patch.yaml          # image: my-app:v1.3.0
  │   ├── staging/
  │   │   ├── kustomization.yaml
  │   │   └── patch.yaml          # image: my-app:v1.2.0
  │   └── production/
  │       ├── kustomization.yaml
  │       └── patch.yaml          # image: my-app:v1.1.0

승격 흐름:
  1. dev overlay의 이미지 태그를 v1.3.0으로 업데이트 → PR → merge → dev 배포
  2. 테스트 통과 후 staging overlay의 태그를 v1.3.0으로 업데이트 → PR → merge
  3. staging 검증 후 production overlay의 태그를 v1.3.0으로 업데이트 → PR → 승인 → merge
```

### Progressive Delivery with Argo Rollouts

ArgoCD와 Argo Rollouts를 함께 사용하여 Canary/Blue-Green 배포를 구현할 수 있다:

```yaml
# Argo Rollouts의 Rollout 리소스 (Deployment 대신 사용)
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata:
  name: my-app
spec:
  replicas: 5
  strategy:
    canary:
      # Canary 단계 정의
      steps:
        - setWeight: 10           # 트래픽의 10%를 canary로
        - pause: {duration: 5m}   # 5분 대기
        - setWeight: 30           # 30%로 증가
        - pause: {duration: 5m}   # 5분 대기
        - setWeight: 50           # 50%로 증가
        - pause: {}               # 수동 승인 대기
        - setWeight: 100          # 전체 트래픽 전환
      # Analysis를 통한 자동 판단
      analysis:
        templates:
          - templateName: success-rate
        startingStep: 2           # 2번째 step부터 분석 시작
        args:
          - name: service-name
            value: my-app

  selector:
    matchLabels:
      app: my-app
  template:
    metadata:
      labels:
        app: my-app
    spec:
      containers:
        - name: my-app
          image: my-app:v1.2.3
          ports:
            - containerPort: 8080

---
# AnalysisTemplate: Canary 성공 여부를 자동 판단
apiVersion: argoproj.io/v1alpha1
kind: AnalysisTemplate
metadata:
  name: success-rate
spec:
  args:
    - name: service-name
  metrics:
    - name: success-rate
      interval: 1m
      count: 5
      successCondition: result[0] >= 0.95   # 성공률 95% 이상
      failureLimit: 3
      provider:
        prometheus:
          address: http://prometheus.monitoring.svc:9090
          query: |
            sum(rate(http_requests_total{service="{{args.service-name}}",status=~"2.."}[5m]))
            /
            sum(rate(http_requests_total{service="{{args.service-name}}"}[5m]))
```

ArgoCD에서 Rollout 리소스를 관리하는 Application:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: my-app
  namespace: argocd
spec:
  source:
    repoURL: https://github.com/org/manifests.git
    path: deploy/production
  destination:
    server: https://kubernetes.default.svc
    namespace: my-app
  syncPolicy:
    automated:
      selfHeal: true
```

### 이 프로젝트에서의 실전 적용

이 프로젝트의 구조를 기반으로 한 실전 패턴은 다음과 같다:

```
tart-infra/
├── kubeconfig/
│   └── platform.yaml           # platform 클러스터 kubeconfig
├── manifests/
│   ├── argocd/
│   │   └── demo-app.yaml       # 데모 Application 정의
│   ├── argocd-values.yaml      # ArgoCD Helm values
│   ├── demo/                   # 데모 앱 매니페스트 (ArgoCD가 감시)
│   └── ...
├── scripts/
│   └── install/
│       └── 08-install-cicd.sh  # ArgoCD + Jenkins 설치 스크립트
└── EDU/
    └── argocd/
        └── README.md           # 이 문서
```

실습 시 권장하는 작업 흐름:

```bash
# 1. 환경 설정
export KUBECONFIG=kubeconfig/platform.yaml

# 2. ArgoCD 설치 확인
kubectl get pods -n argocd

# 3. ArgoCD 로그인
ARGOCD_PASSWORD=$(kubectl get secret argocd-initial-admin-secret -n argocd \
  -o jsonpath='{.data.password}' | base64 -d)
argocd login <worker-ip>:30800 --username admin --password $ARGOCD_PASSWORD --insecure

# 4. 데모 Application 배포
kubectl apply -f manifests/argocd/demo-app.yaml

# 5. Application 상태 확인
argocd app list
argocd app get demo-apps

# 6. Self-Heal 테스트
kubectl scale deployment -n demo <deployment-name> --replicas=5
# ArgoCD가 자동으로 원래 상태로 복구하는지 확인
argocd app get demo-apps

# 7. 매니페스트 변경 후 Sync 확인
# manifests/demo/ 디렉토리의 파일을 수정하고 Git push
# ArgoCD가 3분 이내에 변경을 감지하고 자동 Sync하는지 확인
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

