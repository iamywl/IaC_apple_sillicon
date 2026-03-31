# Day 5: ApplicationSet과 Multi-Cluster 관리

ApplicationSet Generator 유형(List, Cluster, Git Directory, Git File, Matrix, Merge), 템플릿 기반 대량 Application 생성, 그리고 Multi-Cluster 관리를 다룬다.

---

## 7장: ApplicationSet 상세

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

### Generator 상세 설명

#### List Generator

가장 단순한 generator이다. 정적 리스트에서 파라미터를 가져온다:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: env-apps
  namespace: argocd
spec:
  generators:
    - list:
        elements:
          - env: dev
            cluster: https://dev-api.example.com
            namespace: my-app-dev
            replicas: "1"
          - env: staging
            cluster: https://staging-api.example.com
            namespace: my-app-staging
            replicas: "2"
          - env: production
            cluster: https://prod-api.example.com
            namespace: my-app-prod
            replicas: "3"
  template:
    metadata:
      name: "my-app-{{env}}"
    spec:
      project: default
      source:
        repoURL: https://github.com/org/manifests.git
        targetRevision: main
        path: "overlays/{{env}}"
        kustomize:
          images:
            - "my-app=registry.example.com/my-app:latest"
      destination:
        server: "{{cluster}}"
        namespace: "{{namespace}}"
      syncPolicy:
        automated:
          selfHeal: true
          prune: true
```

#### Cluster Generator

ArgoCD에 등록된 클러스터를 기반으로 Application을 생성한다:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: monitoring
  namespace: argocd
spec:
  generators:
    - clusters:
        # 모든 클러스터 선택
        selector: {}
        # 또는 레이블로 필터링
        # selector:
        #   matchLabels:
        #     env: production
        #   matchExpressions:
        #     - key: region
        #       operator: In
        #       values: [us-east, eu-west]
        values:
          # 추가 커스텀 값을 정의할 수 있다
          alertmanagerReplicas: "2"
  template:
    metadata:
      name: "monitoring-{{name}}"     # {{name}}: 클러스터 이름
    spec:
      project: default
      source:
        repoURL: https://prometheus-community.github.io/helm-charts
        chart: kube-prometheus-stack
        targetRevision: 45.0.0
        helm:
          values: |
            alertmanager:
              replicas: {{values.alertmanagerReplicas}}
      destination:
        server: "{{server}}"          # {{server}}: 클러스터 URL
        namespace: monitoring
```

Cluster Generator에서 사용 가능한 내장 변수는 다음과 같다:
- `{{name}}`: 클러스터 이름
- `{{server}}`: 클러스터 URL
- `{{metadata.labels.<key>}}`: 클러스터 레이블 값
- `{{metadata.annotations.<key>}}`: 클러스터 어노테이션 값

#### Git Directory Generator

Git 리포지토리의 디렉토리 구조를 기반으로 Application을 자동 생성한다:

```yaml
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
          # 특정 디렉토리 제외
          - path: "apps/deprecated-app"
            exclude: true
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
```

Git Directory Generator에서 사용 가능한 변수:
- `{{path}}`: 전체 디렉토리 경로 (예: `apps/nginx`)
- `{{path.basename}}`: 디렉토리 이름 (예: `nginx`)
- `{{path[0]}}`, `{{path[1]}}`: 경로 세그먼트 (예: `apps`, `nginx`)

#### Git File Generator

Git 리포지토리의 JSON/YAML 파일에서 파라미터를 읽는다:

```yaml
# config.json 파일 예시:
# [
#   {"name": "app-a", "image": "registry/app-a:v1", "replicas": 3},
#   {"name": "app-b", "image": "registry/app-b:v2", "replicas": 1}
# ]

apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: file-based-apps
  namespace: argocd
spec:
  generators:
    - git:
        repoURL: https://github.com/org/config.git
        revision: main
        files:
          - path: "config/apps/*.json"
          # YAML 파일도 지원한다
          # - path: "config/apps/*.yaml"
  template:
    metadata:
      name: "{{name}}"
    spec:
      project: default
      source:
        repoURL: https://github.com/org/manifests.git
        targetRevision: main
        path: "apps/{{name}}"
        kustomize:
          images:
            - "app={{image}}"
      destination:
        server: https://kubernetes.default.svc
        namespace: "{{name}}"
```

#### Matrix Generator

두 Generator를 조합하여 카르테시안 곱(Cartesian product)을 생성한다:

```yaml
# 결과: 3 클러스터 x 5 앱 = 15개 Application 생성
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
      name: "{{name}}-{{path.basename}}"  # 클러스터이름-앱이름
    spec:
      project: default
      source:
        repoURL: https://github.com/org/infra-manifests.git
        targetRevision: main
        path: "{{path}}"
      destination:
        server: "{{server}}"
        namespace: "{{path.basename}}"
```

#### Merge Generator

여러 Generator의 결과를 병합한다. 기본값을 정의하고 특정 항목만 오버라이드하는 패턴에 유용하다:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: merged-apps
  namespace: argocd
spec:
  generators:
    - merge:
        mergeKeys:
          - env          # 이 키를 기준으로 병합한다
        generators:
          # 기본값 정의
          - list:
              elements:
                - env: dev
                  replicas: "1"
                  autoscaling: "false"
                - env: staging
                  replicas: "2"
                  autoscaling: "false"
                - env: production
                  replicas: "3"
                  autoscaling: "true"
          # production에 대한 오버라이드
          - list:
              elements:
                - env: production
                  replicas: "5"        # 기본값 3에서 5로 오버라이드
  template:
    metadata:
      name: "my-app-{{env}}"
    spec:
      project: default
      source:
        repoURL: https://github.com/org/manifests.git
        targetRevision: main
        path: "overlays/{{env}}"
      destination:
        server: https://kubernetes.default.svc
        namespace: "my-app-{{env}}"
```

#### Pull Request Generator

GitHub/GitLab PR을 기반으로 preview 환경을 자동 생성한다:

```yaml
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
          labels:                      # 특정 레이블이 있는 PR만 대상
            - preview
        requeueAfterSeconds: 60        # 60초마다 PR 상태를 확인한다
        filters:                       # 추가 필터 (ArgoCD 2.7+)
          - branchMatch: "feature/*"   # feature 브랜치 PR만 대상
  template:
    metadata:
      name: "preview-{{number}}"       # {{number}}: PR 번호
    spec:
      project: default
      source:
        repoURL: https://github.com/my-org/my-app.git
        targetRevision: "{{head_sha}}"  # {{head_sha}}: PR의 최신 커밋 해시
        path: deploy/preview
        kustomize:
          namePrefix: "pr-{{number}}-"
          images:
            - "my-app=registry.example.com/my-app:pr-{{number}}"
      destination:
        server: https://kubernetes.default.svc
        namespace: "preview-{{number}}"
      syncPolicy:
        automated:
          selfHeal: true
        syncOptions:
          - CreateNamespace=true
```

PR Generator에서 사용 가능한 변수:
- `{{number}}`: PR 번호
- `{{branch}}`: 소스 브랜치 이름
- `{{branch_slug}}`: URL-safe 브랜치 이름
- `{{target_branch}}`: 대상 브랜치 이름
- `{{head_sha}}`: 최신 커밋 SHA
- `{{head_short_sha}}`: 짧은 커밋 SHA (7자)
- `{{labels}}`: PR 레이블 목록

#### SCM Provider Generator

GitHub Organization 또는 GitLab Group의 리포지토리를 자동 탐색한다:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: org-repos
  namespace: argocd
spec:
  generators:
    - scmProvider:
        github:
          organization: my-org
          tokenRef:
            secretName: github-token
            key: token
          allBranches: false           # main 브랜치만 사용
        filters:
          - repositoryMatch: "^service-.*"  # service-로 시작하는 리포만
          - pathsExist:
              - deploy/k8s               # 이 경로가 있는 리포만
  template:
    metadata:
      name: "{{repository}}"
    spec:
      project: default
      source:
        repoURL: "{{url}}"
        targetRevision: "{{branch}}"
        path: deploy/k8s
      destination:
        server: https://kubernetes.default.svc
        namespace: "{{repository}}"
```

### Progressive Rollout (점진적 배포)

ApplicationSet은 Progressive Rollout 전략을 지원한다. 여러 클러스터에 순차적으로 배포할 수 있다:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: progressive-deploy
  namespace: argocd
spec:
  generators:
    - clusters:
        selector:
          matchLabels:
            env: production
  strategy:
    type: RollingSync
    rollingSync:
      steps:
        # 1단계: canary 클러스터에 먼저 배포
        - matchExpressions:
            - key: role
              operator: In
              values:
                - canary
          maxUpdate: 1            # 동시에 1개 클러스터만 업데이트
        # 2단계: 나머지 클러스터에 배포
        - matchExpressions:
            - key: role
              operator: NotIn
              values:
                - canary
          maxUpdate: "25%"        # 동시에 25%씩 업데이트
  template:
    metadata:
      name: "app-{{name}}"
    spec:
      project: default
      source:
        repoURL: https://github.com/org/manifests.git
        targetRevision: main
        path: deploy/production
      destination:
        server: "{{server}}"
        namespace: my-app
```

### ApplicationSet 정책 설정

```yaml
apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: my-apps
  namespace: argocd
spec:
  # Application 삭제 정책
  # true: ApplicationSet이 삭제되면 생성된 Application도 삭제된다 (기본값)
  # false: ApplicationSet이 삭제되어도 Application은 유지된다
  syncPolicy:
    preserveResourcesOnDeletion: false

  # Application 업데이트 정책
  # 기존 Application의 spec 변경을 허용할지 여부
  # true: 기존 Application을 업데이트한다 (기본값)
  # false: 새 Application만 생성하고 기존 것은 변경하지 않는다
  # syncPolicy:
  #   applicationsSync: create-only

  generators:
    # ...
  template:
    # ...
```

---

## 8장: Multi-Cluster 관리

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

### Cluster Secret 구조

ArgoCD에 등록된 클러스터는 Secret으로 저장된다:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: my-cluster-secret
  namespace: argocd
  labels:
    # 이 레이블이 있어야 ArgoCD가 클러스터로 인식한다
    argocd.argoproj.io/secret-type: cluster
type: Opaque
stringData:
  # 클러스터 이름 (Application에서 destination.name으로 참조)
  name: production-east
  # 클러스터 API Server URL
  server: https://production-east-api.example.com
  # 연결 설정 (JSON)
  config: |
    {
      "bearerToken": "eyJhbGciOiJSUzI1...",
      "tlsClientConfig": {
        "insecure": false,
        "caData": "LS0tLS1CRUdJTi..."
      }
    }
```

config 필드에서 지원하는 인증 방식은 다음과 같다:

```json
// 1. Bearer Token 인증 (ServiceAccount token)
{
  "bearerToken": "eyJhbGciOiJSUzI1...",
  "tlsClientConfig": {
    "insecure": false,
    "caData": "base64-encoded-ca-cert"
  }
}

// 2. 클라이언트 인증서 인증
{
  "tlsClientConfig": {
    "insecure": false,
    "caData": "base64-encoded-ca-cert",
    "certData": "base64-encoded-client-cert",
    "keyData": "base64-encoded-client-key"
  }
}

// 3. AWS EKS IAM 인증
{
  "awsAuthConfig": {
    "clusterName": "my-eks-cluster",
    "roleARN": "arn:aws:iam::123456789:role/argocd-role"
  }
}

// 4. GKE 인증
{
  "execProviderConfig": {
    "command": "gke-gcloud-auth-plugin",
    "apiVersion": "client.authentication.k8s.io/v1beta1"
  }
}
```

### 클러스터별 RBAC

AppProject에서 클러스터별로 접근을 제어할 수 있다:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: AppProject
metadata:
  name: team-backend
  namespace: argocd
spec:
  # 허용된 배포 대상
  destinations:
    # dev 클러스터의 모든 네임스페이스 허용
    - server: https://dev-api.example.com
      namespace: "*"
    # staging 클러스터의 특정 네임스페이스만 허용
    - server: https://staging-api.example.com
      namespace: "backend-*"
    # production 클러스터의 특정 네임스페이스만 허용
    - server: https://prod-api.example.com
      namespace: "backend-prod"

  # 클러스터 스코프 리소스 제한
  clusterResourceWhitelist:
    - group: ""
      kind: Namespace

  # 소스 리포지토리 제한
  sourceRepos:
    - "https://github.com/org/backend-*"
```

### 이 프로젝트에서의 Multi-Cluster 구성

이 프로젝트에서는 다음과 같이 클러스터를 구성한다:

```
platform 클러스터:
  - ArgoCD가 설치된 관리 클러스터이다
  - kubeconfig: kubeconfig/platform.yaml
  - URL: https://kubernetes.default.svc (자동 등록)

dev-cluster:
  - 개발 환경 클러스터이다
  - demo-app.yaml에서 destination.name: dev-cluster로 참조한다
  - ArgoCD에 별도로 등록되어 있어야 한다
```

---

