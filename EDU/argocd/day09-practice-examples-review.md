# Day 9: 실습, 예제, 자가 점검

ArgoCD CLI 기본 실습, Application 관리 실습, Self-Heal/Sync Wave/ApplicationSet 실습, 예제 모음, 자가 점검 문제, 그리고 참고문헌을 다룬다.

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

### 실습 6: Sync Wave와 Hook

```bash
# Sync Wave가 설정된 매니페스트 배포
# wave가 낮은 순서대로 리소스가 적용되는 것을 확인한다

# 1. 다음과 같은 구조의 매니페스트를 생성한다
#    namespace.yaml   (wave: -2)
#    configmap.yaml   (wave: -1)
#    deployment.yaml  (wave: 0)
#    service.yaml     (wave: 1)
#    ingress.yaml     (wave: 2)

# 2. Application을 생성하고 Sync를 실행한다
argocd app sync my-app

# 3. 리소스가 wave 순서대로 적용되는 것을 확인한다
argocd app get my-app --refresh
```

### 실습 7: ApplicationSet

```bash
# Git Directory Generator를 사용하여 디렉토리별 Application 자동 생성

# 1. ApplicationSet YAML을 작성한다
# 2. kubectl apply -f applicationset.yaml
# 3. 자동 생성된 Application 확인
argocd app list

# 4. 새 디렉토리를 추가하고 push하면 Application이 자동 생성되는지 확인
```

### 실습 8: RBAC 테스트

```bash
# 1. 새 계정 생성 (argocd-cm ConfigMap에 추가)
kubectl edit cm argocd-cm -n argocd
# data:
#   accounts.developer: apiKey, login

# 2. 비밀번호 설정
argocd account update-password --account developer --new-password <password>

# 3. RBAC 정책 설정 (argocd-rbac-cm ConfigMap)
kubectl edit cm argocd-rbac-cm -n argocd
# data:
#   policy.csv: |
#     p, role:developer, applications, get, */*, allow
#     p, role:developer, applications, sync, */*, allow
#     g, developer, role:developer

# 4. developer 계정으로 로그인
argocd login <server> --username developer --password <password>

# 5. 권한 테스트
argocd app list           # 성공 (get 권한)
argocd app sync my-app    # 성공 (sync 권한)
argocd app delete my-app  # 실패 (delete 권한 없음)
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

### 예제 3: Kustomize Application

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

### 예제 4: Multiple Sources (ArgoCD 2.6+)

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

### 예제 5: 완전한 프로덕션 Application

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: production-api
  namespace: argocd
  labels:
    team: backend
    env: production
    tier: critical
  annotations:
    notifications.argoproj.io/subscribe.on-deployed.slack: prod-deploys
    notifications.argoproj.io/subscribe.on-sync-failed.slack: prod-alerts
    notifications.argoproj.io/subscribe.on-health-degraded.slack: prod-alerts
  finalizers:
    - resources-finalizer.argocd.argoproj.io
spec:
  project: production

  sources:
    - repoURL: https://charts.example.com
      chart: backend-api
      targetRevision: 3.2.1
      helm:
        releaseName: production-api
        valueFiles:
          - $config/production/values.yaml
          - $config/production/secrets.yaml
    - repoURL: https://github.com/org/app-config.git
      targetRevision: main
      ref: config

  destination:
    server: https://production-api.example.com
    namespace: backend

  syncPolicy:
    automated:
      selfHeal: true
      prune: false               # production에서는 수동 prune
      allowEmpty: false
    syncOptions:
      - CreateNamespace=false    # 네임스페이스는 별도 관리
      - ServerSideApply=true
      - ApplyOutOfSyncOnly=true
      - RespectIgnoreDifferences=true
      - PruneLast=true
    retry:
      limit: 3
      backoff:
        duration: 10s
        factor: 2
        maxDuration: 5m

  ignoreDifferences:
    - group: apps
      kind: Deployment
      jqPathExpressions:
        - .spec.replicas
    - group: ""
      kind: Service
      jsonPointers:
        - /spec/clusterIP
    - group: "*"
      kind: "*"
      managedFieldsManagers:
        - kube-controller-manager

  info:
    - name: Owner
      value: backend-team
    - name: Runbook
      value: https://wiki.example.com/backend-api/runbook
    - name: Monitoring
      value: https://grafana.example.com/d/backend-api

  revisionHistoryLimit: 5
```

### 예제 6: 이 프로젝트를 위한 ApplicationSet

```yaml
# tart-infra 프로젝트의 manifests/ 하위 디렉토리별 Application 자동 생성
apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: tart-infra-apps
  namespace: argocd
spec:
  generators:
    - git:
        repoURL: https://github.com/iamywl/IaC_apple_sillicon.git
        revision: HEAD
        directories:
          - path: "manifests/*"
          - path: "manifests/argocd"
            exclude: true          # ArgoCD 자체 설정은 제외
  template:
    metadata:
      name: "{{path.basename}}"
    spec:
      project: default
      source:
        repoURL: https://github.com/iamywl/IaC_apple_sillicon.git
        targetRevision: HEAD
        path: "{{path}}"
      destination:
        name: dev-cluster
        namespace: "{{path.basename}}"
      syncPolicy:
        automated:
          selfHeal: true
          prune: true
        syncOptions:
          - CreateNamespace=true
```

---

## 자가 점검

### 기본 개념

- [ ] GitOps의 4가지 원칙(선언적, 버전 관리, 자동 적용, 자가 치유)을 설명할 수 있는가?
- [ ] Push 모델과 Pull 모델의 차이를 보안, 드리프트 감지, 롤백 관점에서 설명할 수 있는가?
- [ ] CI와 CD의 분리가 왜 중요한지 설명할 수 있는가?

### 아키텍처

- [ ] ArgoCD의 5가지 핵심 컴포넌트(API Server, Repo Server, Application Controller, Redis, Dex)의 역할을 설명할 수 있는가?
- [ ] Reconciliation Loop의 동작 방식과 기본 polling 주기(3분)를 설명할 수 있는가?
- [ ] Repo Server의 매니페스트 생성 파이프라인을 설명할 수 있는가?
- [ ] Application Controller의 worker 모델(status/operation processors)을 설명할 수 있는가?

### Application CRD

- [ ] Application CRD의 주요 spec 필드(source, destination, syncPolicy, ignoreDifferences)를 설명할 수 있는가?
- [ ] Multi-Source Application의 사용 사례와 $ref 문법을 설명할 수 있는가?
- [ ] Application의 finalizer가 삭제 동작에 미치는 영향을 설명할 수 있는가?

### Sync 메커니즘

- [ ] ArgoCD에서 Sync, Self-Heal, Auto-Prune의 차이를 설명할 수 있는가?
- [ ] Sync Wave와 Hook(PreSync, Sync, PostSync, SyncFail)의 용도를 설명할 수 있는가?
- [ ] Apply 방식(kubectl apply, Server-Side Apply, replace, create)의 차이를 설명할 수 있는가?
- [ ] Sync Window를 설정하여 배포 시간을 제한하는 방법을 설명할 수 있는가?

### Health & Diff

- [ ] Health Status의 종류(Healthy, Progressing, Degraded, Suspended)와 판별 기준을 설명할 수 있는가?
- [ ] 커스텀 리소스에 대해 Lua 스크립트로 Health Check를 작성할 수 있는가?
- [ ] ignoreDifferences에서 jsonPointers, jqPathExpressions, managedFieldsManagers의 차이를 설명할 수 있는가?
- [ ] Server-Side Diff의 장점을 설명할 수 있는가?

### ApplicationSet

- [ ] ApplicationSet의 Generator 종류와 사용 사례를 설명할 수 있는가?
- [ ] Matrix Generator로 클러스터 x 앱 조합을 생성할 수 있는가?
- [ ] Pull Request Generator로 PR별 preview 환경을 자동 생성할 수 있는가?
- [ ] Progressive Rollout 전략을 설명할 수 있는가?

### RBAC & 보안

- [ ] AppProject를 활용한 RBAC 설정 방법을 설명할 수 있는가?
- [ ] Casbin CSV 형식의 RBAC 정책을 작성할 수 있는가?
- [ ] JWT 토큰을 생성하여 자동화 스크립트에서 ArgoCD API를 호출할 수 있는가?
- [ ] ArgoCD 보안 강화를 위한 체크리스트(TLS, RBAC, Network Policy 등)를 설명할 수 있는가?

### Notifications & Image Updater

- [ ] argocd-notifications를 통해 Slack 알림을 설정할 수 있는가?
- [ ] 커스텀 trigger와 template을 작성할 수 있는가?
- [ ] ArgoCD Image Updater의 update 전략(semver, latest, digest)을 설명할 수 있는가?
- [ ] Image Updater의 write-back 방식(argocd, git)의 차이를 설명할 수 있는가?

### Secrets 관리

- [ ] GitOps 환경에서 Secret을 관리하는 4가지 접근 방식(Sealed Secrets, ESO, AVP, SOPS)을 비교할 수 있는가?
- [ ] 각 방식의 장단점을 프로젝트 요구사항에 맞게 선택할 수 있는가?

### 실전 운영

- [ ] Jenkins(CI)와 ArgoCD(CD)의 연동 방식을 설명할 수 있는가?
- [ ] App of Apps 패턴과 ApplicationSet의 차이를 설명할 수 있는가?
- [ ] Mono-Repo와 Multi-Repo 패턴의 장단점을 설명할 수 있는가?
- [ ] Environment Promotion(환경 승격) 전략을 설명할 수 있는가?
- [ ] Argo Rollouts와 ArgoCD를 통합하여 Canary 배포를 구현할 수 있는가?
- [ ] OutOfSync 상태가 발생하는 원인을 진단하고 해결할 수 있는가?
- [ ] Controller sharding과 resource exclusion을 사용한 성능 최적화를 설명할 수 있는가?

---

## 참고문헌

- [ArgoCD 공식 문서](https://argo-cd.readthedocs.io/en/stable/) - 설치, 설정, 운영 가이드 전체를 포함한다
- [ArgoCD GitHub 리포지토리](https://github.com/argoproj/argo-cd) - 소스 코드, 이슈 트래커, 릴리스 노트를 확인할 수 있다
- [ArgoCD Operator Manual](https://argo-cd.readthedocs.io/en/stable/operator-manual/) - 클러스터 관리자를 위한 운영 매뉴얼이다
- [ArgoCD User Guide](https://argo-cd.readthedocs.io/en/stable/user-guide/) - 사용자를 위한 가이드이다
- [ApplicationSet Controller 문서](https://argo-cd.readthedocs.io/en/stable/operator-manual/applicationset/) - ApplicationSet의 Generator와 템플릿 문법을 설명한다
- [ArgoCD Notifications 문서](https://argo-cd.readthedocs.io/en/stable/operator-manual/notifications/) - 알림 설정과 커스터마이징 가이드이다
- [ArgoCD RBAC 설정](https://argo-cd.readthedocs.io/en/stable/operator-manual/rbac/) - 역할 기반 접근 제어 설정 가이드이다
- [ArgoCD Image Updater](https://argocd-image-updater.readthedocs.io/) - 이미지 자동 업데이트 도구의 공식 문서이다
- [ArgoCD Autopilot](https://argocd-autopilot.readthedocs.io/) - ArgoCD 초기 설정과 GitOps 리포지토리 구조를 자동화하는 도구이다
- [Argo Rollouts 문서](https://argo-rollouts.readthedocs.io/) - Canary/Blue-Green 배포를 위한 Argo Rollouts 가이드이다
- [Argo Project 공식 사이트](https://argoproj.github.io/) - Argo Workflows, Argo Events, Argo Rollouts 등 Argo 생태계 전체 정보를 제공한다
- [CNCF ArgoCD 졸업 발표](https://www.cncf.io/announcements/2022/12/06/the-cloud-native-computing-foundation-announces-argo-has-graduated/) - CNCF Graduated 프로젝트 승인 공식 발표이다
- [GitOps Principles (OpenGitOps)](https://opengitops.dev/) - CNCF Sandbox 프로젝트로, GitOps의 공식 원칙을 정의한다
- [Sealed Secrets](https://github.com/bitnami-labs/sealed-secrets) - Bitnami의 Sealed Secrets 프로젝트이다
- [External Secrets Operator](https://external-secrets.io/) - 외부 Secret Manager 통합을 위한 ESO 공식 문서이다
- [SOPS](https://github.com/getsops/sops) - Mozilla의 Secret 암호화 도구이다
