# Day 6: SSO & RBAC, Notifications, Image Updater

Dex 기반 SSO(OIDC, SAML) 설정, RBAC 정책과 역할 기반 접근 제어, Notification 서비스(Slack, Email, Webhook), 그리고 ArgoCD Image Updater를 다룬다.

---

## 9장: SSO & RBAC 상세

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

### Dex Connector 종류와 설정

Dex는 다양한 Identity Provider를 지원한다:

```yaml
dex.config: |
  connectors:
    # 1. GitHub OAuth
    - type: github
      id: github
      name: GitHub
      config:
        clientID: $dex.github.clientID
        clientSecret: $dex.github.clientSecret
        orgs:
          - name: my-org

    # 2. GitLab OAuth
    - type: gitlab
      id: gitlab
      name: GitLab
      config:
        baseURL: https://gitlab.example.com
        clientID: $dex.gitlab.clientID
        clientSecret: $dex.gitlab.clientSecret
        groups:
          - my-group

    # 3. Google OIDC
    - type: oidc
      id: google
      name: Google
      config:
        issuer: https://accounts.google.com
        clientID: $dex.google.clientID
        clientSecret: $dex.google.clientSecret

    # 4. SAML 2.0
    - type: saml
      id: saml
      name: Corporate SSO
      config:
        ssoURL: https://sso.example.com/saml/login
        caData: $dex.saml.caData
        redirectURI: https://argocd.example.com/api/dex/callback
        entityIssuer: https://argocd.example.com/api/dex/callback
        usernameAttr: name
        emailAttr: email
        groupsAttr: groups

    # 5. Microsoft Azure AD
    - type: microsoft
      id: azure
      name: Azure AD
      config:
        clientID: $dex.azure.clientID
        clientSecret: $dex.azure.clientSecret
        tenant: my-tenant-id
        groups:
          - argocd-admins
          - argocd-developers
```

### AppProject RBAC

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

### RBAC 리소스와 액션 전체 목록

```
리소스(Resource):
  applications     - Application CRUD 및 Sync
  applicationsets   - ApplicationSet CRUD
  logs             - Application 로그 조회
  exec             - Pod exec (kubectl exec)
  clusters         - 클러스터 관리
  repositories     - Git 리포지토리 관리
  projects         - AppProject 관리
  accounts         - 사용자 계정 관리
  certificates     - TLS/SSH 인증서 관리
  gpgkeys          - GPG 키 관리
  extensions       - UI 확장 기능

액션(Action):
  get       - 조회
  create    - 생성
  update    - 수정
  delete    - 삭제
  sync      - 동기화 실행
  override  - 매니페스트 오버라이드
  action/*  - 리소스 액션 (restart, scale 등)
  *         - 모든 액션
```

### JWT Token 기반 인증

CI/CD 파이프라인이나 자동화 스크립트에서 ArgoCD API를 호출할 때 JWT 토큰을 사용할 수 있다:

```bash
# ArgoCD 계정 생성 (argocd-cm ConfigMap에 추가)
# data:
#   accounts.ci-bot: apiKey, login
#   accounts.ci-bot.enabled: "true"

# API 키 생성
argocd account generate-token --account ci-bot

# 생성된 토큰으로 API 호출
export ARGOCD_TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
argocd app list --auth-token $ARGOCD_TOKEN

# 또는 REST API 직접 호출
curl -H "Authorization: Bearer $ARGOCD_TOKEN" \
  https://argocd.example.com/api/v1/applications
```

### CLI Login 방법

```bash
# 1. 사용자/비밀번호 로그인
argocd login argocd.example.com --username admin --password <password>

# 2. SSO 로그인 (브라우저가 열린다)
argocd login argocd.example.com --sso

# 3. SSO 로그인 (headless 모드, 서버에서)
argocd login argocd.example.com --sso --sso-port 8085

# 4. 토큰 기반 로그인
argocd login argocd.example.com --auth-token $ARGOCD_TOKEN

# 5. 이 프로젝트에서의 로그인
argocd login <platform-worker-ip>:30800 \
  --username admin \
  --password $(kubectl get secret argocd-initial-admin-secret -n argocd \
    -o jsonpath='{.data.password}' | base64 -d) \
  --insecure
```

---

## 10장: Notifications (알림)

### 개요

argocd-notifications는 ArgoCD 2.3부터 내장된 알림 컴포넌트이다. Application 상태 변경 시 다양한 채널로 알림을 전송한다.

### Notifications 아키텍처

```
┌──────────────────────────────────────────────────────┐
│             Notifications Controller                  │
│                                                       │
│  1. Application CRD를 watch한다                       │
│  2. annotations에서 구독 정보를 읽는다                 │
│  3. trigger 조건을 평가한다                            │
│  4. 조건이 일치하면 template을 렌더링한다               │
│  5. 설정된 서비스(Slack, webhook 등)로 알림을 전송한다  │
│                                                       │
│  ConfigMap: argocd-notifications-cm                    │
│  Secret: argocd-notifications-secret                   │
└──────────────────────────────────────────────────────┘
```

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

### 알림 서비스 종류

```yaml
# 1. Slack
service.slack: |
  token: $slack-token
  # 또는 Webhook URL 사용
  # apiURL: https://hooks.slack.com/services/T.../B.../xxx

# 2. Email (SMTP)
service.email: |
  host: smtp.gmail.com
  port: 587
  from: argocd@example.com
  username: $email-username
  password: $email-password

# 3. Webhook (범용)
service.webhook.custom: |
  url: https://hooks.example.com/argocd
  headers:
    - name: Content-Type
      value: application/json
    - name: Authorization
      value: Bearer $webhook-token

# 4. Microsoft Teams
service.teams: |
  # Teams Incoming Webhook URL을 사용한다

# 5. Grafana
service.grafana: |
  apiUrl: https://grafana.example.com/api
  apiKey: $grafana-api-key

# 6. PagerDuty
service.pagerduty: |
  serviceKeys:
    my-service: $pagerduty-service-key

# 7. Opsgenie
service.opsgenie: |
  apiUrl: https://api.opsgenie.com
  apiKeys:
    my-team: $opsgenie-api-key

# 8. Rocket.Chat
service.rocketchat: |
  email: $rocketchat-email
  password: $rocketchat-password
  serverUrl: https://rocketchat.example.com
```

### 트리거 조건 고급 설정

```yaml
# 상태 변경 감지
trigger.on-health-degraded: |
  - description: Application health has degraded
    send:
      - app-health-degraded
    when: app.status.health.status == 'Degraded'

# 특정 시간 이상 Progressing 상태인 경우
trigger.on-sync-running-long: |
  - description: Application sync is running for more than 5 minutes
    send:
      - app-sync-long
    when: app.status.operationState.phase == 'Running' and time.Now().Sub(time.Parse(app.status.operationState.startedAt)).Minutes() > 5

# 새 이미지가 배포된 경우
trigger.on-image-updated: |
  - description: Application image has been updated
    send:
      - app-image-updated
    when: app.status.operationState.phase in ['Succeeded'] and app.status.summary.images != app.status.operationState.previousImages

# 커스텀 조건 조합
trigger.on-prod-deploy: |
  - description: Production deployment completed
    send:
      - prod-deployed
    when: >
      app.metadata.labels.env == 'production' and
      app.status.operationState.phase in ['Succeeded'] and
      app.status.health.status == 'Healthy'
    oncePer: app.status.sync.revision    # 동일 revision에 대해 한 번만 알림
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

    # Email로 알림 전송
    notifications.argoproj.io/subscribe.on-health-degraded.email: ops@example.com

    # Webhook으로 알림 전송
    notifications.argoproj.io/subscribe.on-deployed.webhook.custom: ""

    # 여러 채널에 동시 전송
    # 형식: notifications.argoproj.io/subscribe.<trigger>.<service>: <target>
```

---

## 11장: Image Updater

### ArgoCD Image Updater 개요

ArgoCD Image Updater는 ArgoCD가 관리하는 Application의 컨테이너 이미지를 자동으로 업데이트하는 별도 컴포넌트이다. 새로운 이미지 태그가 레지스트리에 push되면 자동으로 감지하여 Application을 업데이트한다.

```
┌──────────────┐     ┌──────────────────┐     ┌──────────────┐
│  Container   │     │  ArgoCD Image    │     │  ArgoCD      │
│  Registry    │◄────│  Updater         │────►│  Application │
│  (DockerHub, │     │                  │     │              │
│   ECR, GCR)  │     │  • 이미지 태그    │     │  • 이미지 태그│
│              │     │    주기적 조회    │     │    업데이트   │
└──────────────┘     └──────────────────┘     └──────────────┘
```

### Image Updater 설치

```bash
# Helm으로 설치
helm repo add argo https://argoproj.github.io/argo-helm
helm install argocd-image-updater argo/argocd-image-updater \
  --namespace argocd

# 또는 manifests로 설치
kubectl apply -n argocd \
  -f https://raw.githubusercontent.com/argoproj-labs/argocd-image-updater/stable/manifests/install.yaml
```

### Application에 Image Updater 설정

Image Updater는 Application의 annotations으로 설정한다:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: my-app
  namespace: argocd
  annotations:
    # 모니터링할 이미지 목록
    argocd-image-updater.argoproj.io/image-list: >
      myapp=registry.example.com/my-app,
      nginx=nginx

    # 업데이트 전략 지정
    argocd-image-updater.argoproj.io/myapp.update-strategy: semver
    argocd-image-updater.argoproj.io/nginx.update-strategy: latest

    # 태그 필터 (정규식)
    argocd-image-updater.argoproj.io/myapp.allow-tags: "regexp:^v[0-9]+\\.[0-9]+\\.[0-9]+$"
    argocd-image-updater.argoproj.io/nginx.allow-tags: "regexp:^1\\.25\\."

    # 무시할 태그
    argocd-image-updater.argoproj.io/myapp.ignore-tags: "latest, dev-*"

    # write-back 방식 (Git에 반영)
    argocd-image-updater.argoproj.io/write-back-method: git
    argocd-image-updater.argoproj.io/write-back-target: "kustomization:../../base"
    argocd-image-updater.argoproj.io/git-branch: main
spec:
  # ...
```

### Update 전략

| 전략 | 설명 |
|------|------|
| **semver** | Semantic Versioning 규칙에 따라 최신 버전을 선택한다 |
| **latest** | 가장 최근에 push된 이미지를 선택한다 (태그 이름 무관) |
| **digest** | 특정 태그의 digest 변경을 감지한다 (immutable tag 용) |
| **name** | 태그 이름을 알파벳 순으로 정렬하여 최신을 선택한다 |

#### Semver 전략 상세

```yaml
annotations:
  # 기본 semver (최신 버전 자동 선택)
  argocd-image-updater.argoproj.io/myapp.update-strategy: semver

  # 특정 major 버전으로 제한
  argocd-image-updater.argoproj.io/myapp.allow-tags: "regexp:^2\\."

  # semver constraint 사용
  argocd-image-updater.argoproj.io/myapp.update-strategy: "semver"
  # ~1.2: >= 1.2.0, < 1.3.0
  # ^1.2: >= 1.2.0, < 2.0.0
  # >= 1.0, < 2.0: 범위 지정
```

#### Digest 전략 상세

```yaml
annotations:
  argocd-image-updater.argoproj.io/image-list: myapp=registry.example.com/my-app:latest
  argocd-image-updater.argoproj.io/myapp.update-strategy: digest
  # "latest" 태그가 가리키는 실제 이미지가 변경되면 업데이트한다
  # 태그는 동일하지만 digest(sha256 해시)가 다른 경우를 감지한다
```

### Write-Back 방식

Image Updater가 업데이트된 이미지 정보를 반영하는 방식이다:

```
1. argocd (기본값)
   - ArgoCD Application의 parameter override를 직접 수정한다
   - Git에는 반영되지 않는다
   - 빠르지만 GitOps 원칙에 위배될 수 있다

2. git
   - Git 리포지토리에 직접 커밋한다
   - GitOps 원칙에 부합한다
   - .argocd-source-<app-name>.yaml 파일을 생성/수정한다
   - 또는 kustomization.yaml의 images를 수정한다

설정 예시:
  # Git write-back
  argocd-image-updater.argoproj.io/write-back-method: git
  argocd-image-updater.argoproj.io/git-branch: main

  # Git write-back (Kustomize)
  argocd-image-updater.argoproj.io/write-back-method: git
  argocd-image-updater.argoproj.io/write-back-target: kustomization

  # Git write-back (Helm values)
  argocd-image-updater.argoproj.io/write-back-method: git
  argocd-image-updater.argoproj.io/write-back-target: helmvalues:values.yaml
```

### 레지스트리 인증 설정

```yaml
# argocd-image-updater-config ConfigMap
apiVersion: v1
kind: ConfigMap
metadata:
  name: argocd-image-updater-config
  namespace: argocd
data:
  registries.conf: |
    registries:
      - name: Docker Hub
        api_url: https://registry-1.docker.io
        prefix: docker.io
        ping: yes
        credentials: secret:argocd/dockerhub-creds#credentials

      - name: GitHub Container Registry
        api_url: https://ghcr.io
        prefix: ghcr.io
        credentials: secret:argocd/ghcr-creds#credentials

      - name: Private Registry
        api_url: https://registry.example.com
        prefix: registry.example.com
        insecure: false
        credentials: secret:argocd/private-registry-creds#credentials
```

---

