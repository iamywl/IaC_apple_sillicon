# Day 4: Identity Brokering, Kubernetes 연동, 보안 모범 사례

> 이 문서에서는 Identity Brokering & Federation(소셜 로그인, LDAP/AD 연동, Identity Provider Mappers), Kubernetes 연동(OIDC 인증, RBAC 매핑, Ingress 보호, ArgoCD/Grafana SSO 통합), 그리고 보안 모범 사례를 다룬다.

---

## Identity Brokering & Federation

### Social Login 설정

Keycloak은 다양한 소셜 로그인 제공자를 빌트인으로 지원한다. 각 제공자별 설정 방법을 기술한다.

#### Google 설정

1. Google Cloud Console에서 OAuth 2.0 Client 생성:
   - OAuth 동의 화면 설정
   - Authorized redirect URI: `https://{keycloak-host}/realms/{realm}/broker/google/endpoint`
2. Keycloak에서 Identity Provider 추가:
   - Identity Providers > Add provider > Google
   - Client ID와 Client Secret 입력
   - Default Scopes: `openid profile email`

```
Keycloak Admin Console 설정:
┌─────────────────────────────────────────────┐
│ Identity Provider: Google                    │
│                                             │
│ Client ID: xxxx.apps.googleusercontent.com  │
│ Client Secret: GOCSPX-xxxxxxxxxx            │
│ Default Scopes: openid profile email        │
│ Store Tokens: OFF                           │
│ Trust Email: ON                             │
│ First Login Flow: first broker login        │
│ Sync Mode: import                           │
└─────────────────────────────────────────────┘
```

#### GitHub 설정

1. GitHub > Settings > Developer settings > OAuth Apps > New OAuth App
   - Authorization callback URL: `https://{keycloak-host}/realms/{realm}/broker/github/endpoint`
2. Keycloak에서 Identity Provider 추가:
   - Identity Providers > Add provider > GitHub
   - Client ID와 Client Secret 입력

#### Apple 설정

Apple Sign In은 다른 소셜 로그인과 다소 다른 설정이 필요하다.

1. Apple Developer > Certificates, Identifiers & Profiles
2. App ID 등록 (Sign in with Apple 활성화)
3. Service ID 등록 (Web Authentication Configuration에 Keycloak redirect URI 등록)
4. Key 생성 (Sign in with Apple 권한 포함)
5. Keycloak에서 설정:
   - Identity Providers > Add provider > Apple
   - Client ID (Service ID), Team ID, Key ID, Private Key(p8 파일 내용) 입력

### SAML 2.0 IdP 연동

SAML 2.0은 엔터프라이즈 환경에서 널리 사용되는 SSO 프로토콜이다. ADFS(Active Directory Federation Services)와의 연동 예시를 기술한다.

ADFS 연동 설정:

1. ADFS 측 설정:
   - Relying Party Trust 추가
   - Keycloak의 SAML SP Metadata URL 입력: `https://{keycloak-host}/realms/{realm}/protocol/saml/descriptor`
   - Claim Rules 설정 (Name ID, email, name 등 전달)

2. Keycloak 측 설정:
   - Identity Providers > Add provider > SAML v2.0
   - ADFS의 Federation Metadata URL 입력: `https://{adfs-host}/FederationMetadata/2007-06/FederationMetadata.xml`

주요 설정 항목:
```
Single Sign-On Service URL: https://adfs.example.com/adfs/ls/
Single Logout Service URL: https://adfs.example.com/adfs/ls/
NameID Policy Format: urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress
Want AuthnRequests Signed: ON
Want Assertions Signed: ON
Want Assertions Encrypted: OFF
Validating X509 Certificates: <ADFS 인증서 PEM>
```

### LDAP/Active Directory Federation 상세

LDAP Federation은 기존 디렉토리 서비스의 사용자 정보를 Keycloak에서 직접 사용하는 기능이다.

#### 연결 설정

```
Connection URL: ldap://ldap.example.com:389
         또는: ldaps://ldap.example.com:636 (TLS)
Bind DN: cn=admin,dc=example,dc=com
Bind Credential: <admin-password>
Users DN: ou=users,dc=example,dc=com
User Object Classes: inetOrgPerson, organizationalPerson
Username LDAP attribute: uid (또는 sAMAccountName for AD)
RDN LDAP attribute: uid (또는 cn)
UUID LDAP attribute: entryUUID (또는 objectGUID for AD)
Connection Pooling: ON
Connection Pooling Size: 10
```

#### Sync Modes

| 모드 | 설명 |
|------|------|
| Import | LDAP 사용자를 Keycloak 로컬 DB에 복사한다. 주기적으로 동기화한다 |
| Force | Import와 유사하지만 매 동기화 시 LDAP 데이터로 덮어쓴다 |
| Unlinked | LDAP에서 가져오되, 연결을 유지하지 않는다 |

LDAP 동기화 설정:
```
Import Users: ON
Sync Registrations: OFF (Keycloak에서 생성한 사용자를 LDAP에 쓸지 여부)
Periodic Full Sync: ON (주기: 86400초 = 24시간)
Periodic Changed Users Sync: ON (주기: 300초 = 5분)
```

#### LDAP Mappers

| Mapper | 설명 |
|--------|------|
| `user-attribute-ldap-mapper` | LDAP 속성을 Keycloak 사용자 속성에 매핑한다 |
| `full-name-ld-mapper` | LDAP의 `cn`을 Keycloak의 firstName + lastName으로 분리한다 |
| `group-ldap-mapper` | LDAP 그룹을 Keycloak 그룹에 매핑한다 |
| `role-ldap-mapper` | LDAP 그룹/역할을 Keycloak Realm 역할에 매핑한다 |
| `msad-user-account-control-mapper` | Active Directory의 `userAccountControl` 속성을 매핑한다 |
| `msad-lds-user-account-control-mapper` | AD LDS의 계정 제어를 매핑한다 |
| `certificate-ldap-mapper` | X.509 인증서를 매핑한다 |
| `hardcoded-ldap-role-mapper` | LDAP 사용자에게 고정 역할을 부여한다 |

#### Connection Pooling

LDAP 서버와의 연결 풀링을 설정하여 성능을 최적화할 수 있다.

```
Connection Pooling: ON
Connection Pool Authentication: simple
Connection Pool Debug: fine (디버깅 시)
Connection Pool Initial Size: 1
Connection Pool Max Size: 10
Connection Pool Preferred Size: 5
Connection Pool Protocol: plain ssl
Connection Pool Timeout: 300000 (밀리초)
```

### First Broker Login Flow

외부 IdP로 최초 로그인 시 실행되는 흐름이다. 기본 설정은 다음과 같다.

```
First Broker Login Flow
├── Review Profile (REQUIRED)
│   → 사용자에게 프로필 정보 확인/수정 기회를 제공한다
├── Create User If Unique (ALTERNATIVE)
│   → 이메일/사용자명이 고유하면 자동으로 새 계정을 생성한다
└── Handle Existing Account (ALTERNATIVE)
    ├── Confirm Link Existing Account (REQUIRED)
    │   → 기존 계정이 있으면 연결 여부를 확인한다
    └── Verify Existing Account By Re-authentication (ALTERNATIVE)
        → 기존 계정으로 재인증하여 연결을 확인한다
```

### Account Linking

사용자가 하나의 Keycloak 계정에 여러 외부 IdP 계정을 연결하는 기능이다. Account Console(`/realms/{realm}/account`)에서 사용자가 직접 관리할 수 있다.

연결 가능한 시나리오:
- Google + GitHub를 동일한 Keycloak 계정에 연결
- 회사 LDAP 계정 + 소셜 로그인 계정 연결
- SAML IdP + OIDC IdP를 동일 계정에 연결

### Identity Provider Mappers

외부 IdP에서 전달받은 사용자 정보를 Keycloak 속성에 매핑하는 기능이다.

| Mapper 유형 | 설명 |
|------------|------|
| Attribute Importer | 외부 IdP의 사용자 속성을 Keycloak 사용자 속성에 매핑한다 |
| Hardcoded Role | 외부 IdP로 로그인한 사용자에게 고정 역할을 부여한다 |
| Hardcoded Group | 외부 IdP로 로그인한 사용자를 고정 그룹에 추가한다 |
| Username Template Importer | 외부 IdP의 여러 속성을 조합하여 Keycloak 사용자명을 생성한다 |
| Advanced Claim to Role | 외부 토큰의 claim 값에 따라 조건부로 역할을 부여한다 |

---

## Kubernetes 연동 심화

### OIDC를 이용한 Kubernetes API Server 인증

Kubernetes API Server는 OIDC를 지원하여, Keycloak을 IdP로 사용한 사용자 인증이 가능하다. 이를 통해 kubeconfig에 정적 인증서나 토큰 대신 OIDC 기반 인증을 사용할 수 있다.

API Server 설정:
```yaml
# kube-apiserver 매니페스트 (/etc/kubernetes/manifests/kube-apiserver.yaml)
spec:
  containers:
  - command:
    - kube-apiserver
    # OIDC 설정
    - --oidc-issuer-url=https://keycloak.example.com/realms/k8s-realm
    - --oidc-client-id=kubernetes
    - --oidc-username-claim=preferred_username
    - --oidc-username-prefix=oidc:
    - --oidc-groups-claim=groups
    - --oidc-groups-prefix=oidc:
    - --oidc-ca-file=/etc/kubernetes/pki/keycloak-ca.pem
    # 기존 설정...
```

OIDC 인증 후 Kubernetes RBAC 설정:
```yaml
# oidc-clusterrolebinding.yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: oidc-admin-binding
subjects:
  - kind: User
    name: "oidc:admin-user"       # --oidc-username-prefix + username
    apiGroup: rbac.authorization.k8s.io
roleRef:
  kind: ClusterRole
  name: cluster-admin
  apiGroup: rbac.authorization.k8s.io
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: oidc-developers-binding
subjects:
  - kind: Group
    name: "oidc:developers"       # --oidc-groups-prefix + group
    apiGroup: rbac.authorization.k8s.io
roleRef:
  kind: ClusterRole
  name: edit
  apiGroup: rbac.authorization.k8s.io
```

### kubectl + OIDC 플러그인 (kubelogin)

kubelogin(oidc-login)은 kubectl에서 OIDC 인증을 수행하기 위한 플러그인이다. 브라우저 기반 로그인 또는 ROPC(Resource Owner Password Credentials) 인증을 지원한다.

설치:
```bash
# krew를 통한 설치
kubectl krew install oidc-login

# 또는 직접 설치
# macOS
brew install int128/kubelogin/kubelogin

# Linux
curl -LO https://github.com/int128/kubelogin/releases/latest/download/kubelogin_linux_amd64.zip
unzip kubelogin_linux_amd64.zip
mv kubelogin /usr/local/bin/kubectl-oidc_login
```

kubeconfig 설정:
```yaml
# ~/.kube/config
apiVersion: v1
kind: Config
clusters:
  - name: k8s-cluster
    cluster:
      server: https://k8s-api.example.com:6443
      certificate-authority: /path/to/ca.pem
users:
  - name: oidc-user
    user:
      exec:
        apiVersion: client.authentication.k8s.io/v1beta1
        command: kubectl
        args:
          - oidc-login
          - get-token
          - --oidc-issuer-url=https://keycloak.example.com/realms/k8s-realm
          - --oidc-client-id=kubernetes
          - --oidc-client-secret=<secret>
          - --oidc-extra-scope=groups
contexts:
  - name: oidc-context
    context:
      cluster: k8s-cluster
      user: oidc-user
current-context: oidc-context
```

사용:
```bash
# 로그인 (브라우저가 열린다)
kubectl get pods
# → 브라우저에서 Keycloak 로그인 → 토큰 자동 획득 → kubectl 명령 실행

# 토큰 확인
kubectl oidc-login get-token \
  --oidc-issuer-url=https://keycloak.example.com/realms/k8s-realm \
  --oidc-client-id=kubernetes | jq .
```

### Ingress/Service Mesh JWT 검증

Ingress Controller나 Service Mesh에서 JWT를 검증하여, 애플리케이션에 도달하기 전에 인증을 수행할 수 있다.

#### Nginx Ingress + OAuth2 Proxy

```yaml
# oauth2-proxy deployment
apiVersion: apps/v1
kind: Deployment
metadata:
  name: oauth2-proxy
spec:
  replicas: 1
  selector:
    matchLabels:
      app: oauth2-proxy
  template:
    metadata:
      labels:
        app: oauth2-proxy
    spec:
      containers:
        - name: oauth2-proxy
          image: quay.io/oauth2-proxy/oauth2-proxy:latest
          args:
            - --provider=keycloak-oidc
            - --client-id=oauth2-proxy
            - --client-secret=$(CLIENT_SECRET)
            - --oidc-issuer-url=https://keycloak.example.com/realms/demo-realm
            - --cookie-secret=$(COOKIE_SECRET)
            - --email-domain=*
            - --upstream=static://200
            - --http-address=0.0.0.0:4180
            - --reverse-proxy=true
            - --skip-provider-button=true
          ports:
            - containerPort: 4180
---
# Ingress with OAuth2 Proxy annotation
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: protected-app
  annotations:
    nginx.ingress.kubernetes.io/auth-url: "http://oauth2-proxy.default.svc.cluster.local:4180/oauth2/auth"
    nginx.ingress.kubernetes.io/auth-signin: "https://oauth2-proxy.example.com/oauth2/start?rd=$scheme://$host$request_uri"
    nginx.ingress.kubernetes.io/auth-response-headers: "X-Auth-Request-User,X-Auth-Request-Email"
spec:
  rules:
    - host: app.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: my-app
                port:
                  number: 80
```

#### Istio JWT 검증

```yaml
# Istio RequestAuthentication
apiVersion: security.istio.io/v1
kind: RequestAuthentication
metadata:
  name: keycloak-jwt
  namespace: default
spec:
  jwtRules:
    - issuer: "https://keycloak.example.com/realms/demo-realm"
      jwksUri: "https://keycloak.example.com/realms/demo-realm/protocol/openid-connect/certs"
      forwardOriginalToken: true
---
# Istio AuthorizationPolicy
apiVersion: security.istio.io/v1
kind: AuthorizationPolicy
metadata:
  name: require-jwt
  namespace: default
spec:
  action: ALLOW
  rules:
    - from:
        - source:
            requestPrincipals: ["*"]
      when:
        - key: request.auth.claims[realm_access][roles]
          values: ["app-admin"]
```

### Keycloak Operator

Keycloak Operator는 Kubernetes에서 Keycloak을 선언적으로 관리하기 위한 Kubernetes Operator이다. CRD(Custom Resource Definition)를 사용하여 Keycloak 인스턴스, Realm, Client, User 등을 Kubernetes 리소스로 관리한다.

설치:
```bash
# OLM(Operator Lifecycle Manager)을 통한 설치
kubectl apply -f https://github.com/keycloak/keycloak-k8s-resources/releases/latest/download/kubernetes.yml
```

CRD 예시:
```yaml
# Keycloak 인스턴스 생성
apiVersion: k8s.keycloak.org/v2alpha1
kind: Keycloak
metadata:
  name: keycloak
  namespace: keycloak
spec:
  instances: 2
  hostname:
    hostname: auth.example.com
  db:
    vendor: postgres
    host: postgres-db
    usernameSecret:
      name: keycloak-db-secret
      key: username
    passwordSecret:
      name: keycloak-db-secret
      key: password
  http:
    tlsSecret: keycloak-tls-secret
  additionalOptions:
    - name: proxy
      value: edge
---
# Realm Import
apiVersion: k8s.keycloak.org/v2alpha1
kind: KeycloakRealmImport
metadata:
  name: demo-realm-import
  namespace: keycloak
spec:
  keycloakCRName: keycloak
  realm:
    realm: demo-realm
    enabled: true
    clients:
      - clientId: demo-app
        protocol: openid-connect
        publicClient: false
        redirectUris:
          - "https://app.example.com/*"
    roles:
      realm:
        - name: app-admin
        - name: app-viewer
```

### HA 배포 (StatefulSet + PostgreSQL + Infinispan)

프로덕션 환경에서 Keycloak을 고가용성(HA)으로 배포하려면, 외부 PostgreSQL과 Infinispan 클러스터를 구성해야 한다.

HA 구성 아키텍처:
```
                    ┌─────────────┐
                    │   Ingress   │
                    │   (L7 LB)   │
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
        ┌─────▼─────┐ ┌───▼───────┐ ┌──▼──────────┐
        │ Keycloak  │ │ Keycloak  │ │  Keycloak   │
        │  Pod 0    │ │  Pod 1    │ │  Pod 2      │
        │ ┌───────┐ │ │ ┌───────┐ │ │ ┌─────────┐ │
        │ │Infini-│◄──►│Infini-│◄──►│ │Infini-  │ │
        │ │ span  │ │ │ │ span  │ │ │ │  span   │ │
        │ └───────┘ │ │ └───────┘ │ │ └─────────┘ │
        └─────┬─────┘ └─────┬─────┘ └──────┬──────┘
              │              │              │
              └──────────────┼──────────────┘
                             │
                    ┌────────▼────────┐
                    │   PostgreSQL    │
                    │  (Primary +    │
                    │   Replica)     │
                    └─────────────────┘
```

---

## 보안 모범 사례

### Token Lifetime 설정 가이드

토큰 수명은 보안과 사용자 경험의 균형을 고려하여 설정해야 한다.

| 토큰 | 권장 수명 | 설명 |
|------|----------|------|
| Access Token | 5~15분 | 짧을수록 안전하다. 탈취되어도 짧은 시간만 유효하다 |
| Refresh Token | 8~24시간 | SSO Session Max와 동일하게 설정한다. Rotation 활성화를 권장한다 |
| ID Token | 5~15분 | Access Token과 동일한 수명으로 설정한다 |
| Offline Token | 30일 | 모바일 앱 등 장기 접근이 필요한 경우에만 사용한다 |
| SSO Session Idle | 30분 | 비활동 타임아웃이다. 보안 수준에 따라 15~60분으로 조정한다 |
| SSO Session Max | 10시간 | 절대 타임아웃이다. 하루 근무 시간 기준으로 설정한다 |
| Authorization Code | 60초 | 일회용이며 빠르게 만료되어야 한다 |

프로덕션 권장 설정:
```
Realm Settings > Sessions:
  SSO Session Idle: 30분
  SSO Session Max: 10시간
  SSO Session Idle Remember Me: 7일
  SSO Session Max Remember Me: 30일

Realm Settings > Tokens:
  Default Signature Algorithm: RS256
  Access Token Lifespan: 5분
  Access Token Lifespan For Implicit Flow: 15분
  Client Login Timeout: 5분
  User-Initiated Action Lifespan: 5분
```

### Refresh Token 관리

- **Refresh Token Rotation 활성화**: `Realm Settings > Tokens > Revoke Refresh Token = ON`으로 설정한다
- **Reuse Interval 설정**: 네트워크 지연으로 인한 중복 요청을 허용하기 위해 짧은 재사용 구간(2~5초)을 설정할 수 있다
- **Offline Token 제한**: 필요한 Client에만 `offline_access` scope를 허용한다
- **Refresh Token 바인딩**: DPoP(Demonstrating Proof-of-Possession)를 통해 Refresh Token을 특정 클라이언트에 바인딩한다

### CORS 정책

- Client별 Web Origins를 최소한으로 설정한다
- 와일드카드(`*`)는 개발 환경에서만 사용한다
- 프로덕션에서는 정확한 origin URL을 지정한다 (예: `https://app.example.com`)
- 서브도메인 와일드카드(예: `https://*.example.com`)도 주의하여 사용한다

### Content Security Policy

Keycloak Admin Console과 로그인 페이지의 CSP를 설정하여 XSS 공격을 방지한다.

```
Realm Settings > Security Defenses > Headers:
  X-Frame-Options: SAMEORIGIN
  Content-Security-Policy: frame-src 'self'; frame-ancestors 'self'; object-src 'none';
  X-Content-Type-Options: nosniff
  X-Robots-Tag: none
  X-XSS-Protection: 1; mode=block
  Strict-Transport-Security: max-age=31536000; includeSubDomains
```

### TLS 설정

프로덕션 환경에서는 반드시 HTTPS를 사용해야 한다.

```bash
# Keycloak TLS 설정
./kc.sh start \
  --https-certificate-file=/etc/certs/tls.crt \
  --https-certificate-key-file=/etc/certs/tls.key \
  --https-protocols=TLSv1.3,TLSv1.2 \
  --https-cipher-suites=TLS_AES_256_GCM_SHA384,TLS_AES_128_GCM_SHA256 \
  --hostname=auth.example.com \
  --hostname-strict=true
```

Kubernetes에서는 Ingress에서 TLS를 처리하고, Keycloak은 `proxy=edge` 모드로 실행하는 것이 일반적이다.

```yaml
# TLS Secret 생성
kubectl create secret tls keycloak-tls \
  --cert=tls.crt --key=tls.key -n keycloak

# Ingress TLS 설정
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: keycloak-ingress
  annotations:
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
    nginx.ingress.kubernetes.io/proxy-buffer-size: "128k"
spec:
  tls:
    - hosts:
        - auth.example.com
      secretName: keycloak-tls
  rules:
    - host: auth.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: keycloak
                port:
                  number: 8080
```

### Admin Console 보안

- Master Realm의 admin 계정에 강력한 비밀번호를 설정한다
- MFA(TOTP)를 admin 계정에 적용한다
- Admin Console을 내부 네트워크에서만 접근 가능하도록 제한한다
- 관리 작업 전용 네트워크 정책(NetworkPolicy)을 설정한다
- Admin Event Logging을 활성화하여 관리 작업을 감사한다
- 필요에 따라 Admin Console 접근 IP를 화이트리스트로 관리한다

```yaml
# NetworkPolicy: Admin Console 접근 제한
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: keycloak-admin-restrict
  namespace: keycloak
spec:
  podSelector:
    matchLabels:
      app: keycloak
  ingress:
    - from:
        - ipBlock:
            cidr: 10.0.0.0/8     # 내부 네트워크만 허용
      ports:
        - protocol: TCP
          port: 8080
```

### Brute Force Protection

- Brute Force Detection을 반드시 활성화한다
- 관리자 계정에 대한 Brute Force 보호를 강화한다
- 실패 카운터 리셋 시간(Failure Reset Time)을 적절히 설정한다 (너무 짧으면 공격자가 리셋 후 재시도 가능)
- 잠금 시 사용자에게 명확한 에러 메시지를 표시하되, 잠금 사유나 잠금 해제 시간을 노출하지 않는다 (공격자에게 정보 제공 방지)
- Account Lockout 이벤트를 모니터링 시스템에 연동하여 실시간 알림을 받는다

---

