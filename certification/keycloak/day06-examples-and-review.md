# Day 6: 고급 예제, 자가 점검

> 이 문서에서는 프로덕션 환경 Keycloak 설정 예제(Realm Export, Helm Values, Terraform), Kubernetes OIDC 연동 예제, OAuth2 Proxy 연동, 그리고 전체 학습 내용에 대한 자가 점검 체크리스트와 참고문헌을 다룬다.

---

## 예제

### 예제 1: Kubernetes 배포 매니페스트
```yaml
# keycloak-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: keycloak
  namespace: demo
spec:
  replicas: 1
  selector:
    matchLabels:
      app: keycloak
  template:
    metadata:
      labels:
        app: keycloak
    spec:
      containers:
        - name: keycloak
          image: quay.io/keycloak/keycloak:latest
          args: ["start-dev"]
          ports:
            - containerPort: 8080
          env:
            - name: KEYCLOAK_ADMIN
              value: admin
            - name: KEYCLOAK_ADMIN_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: keycloak-secret
                  key: password
            - name: KC_DB
              value: postgres
            - name: KC_DB_URL
              value: jdbc:postgresql://postgres:5432/keycloak
          resources:
            limits:
              cpu: 500m
              memory: 512Mi
---
apiVersion: v1
kind: Service
metadata:
  name: keycloak
  namespace: demo
spec:
  selector:
    app: keycloak
  ports:
    - port: 8080
      targetPort: 8080
```

### 예제 2: Realm Export (설정을 코드로 관리)
```json
{
  "realm": "demo-realm",
  "enabled": true,
  "clients": [
    {
      "clientId": "demo-app",
      "protocol": "openid-connect",
      "publicClient": false,
      "redirectUris": ["http://localhost:3000/*"],
      "directAccessGrantsEnabled": true
    }
  ],
  "roles": {
    "realm": [
      { "name": "app-admin" },
      { "name": "app-viewer" }
    ]
  },
  "users": [
    {
      "username": "testuser",
      "enabled": true,
      "email": "test@example.com",
      "credentials": [
        { "type": "password", "value": "test123" }
      ],
      "realmRoles": ["app-admin"]
    }
  ]
}
```

### 예제 3: Kubernetes OIDC 인증 설정

Keycloak을 사용하여 Kubernetes API Server의 사용자 인증을 구성하는 전체 예제이다.

```yaml
# 1. Keycloak Realm 및 Client 설정 (Realm Import JSON)
# k8s-realm.json
{
  "realm": "k8s-realm",
  "enabled": true,
  "sslRequired": "external",
  "clients": [
    {
      "clientId": "kubernetes",
      "protocol": "openid-connect",
      "publicClient": false,
      "directAccessGrantsEnabled": true,
      "standardFlowEnabled": true,
      "redirectUris": ["http://localhost:8000", "http://localhost:18000"],
      "defaultClientScopes": ["openid", "profile", "email", "groups"],
      "optionalClientScopes": ["offline_access"]
    }
  ],
  "clientScopes": [
    {
      "name": "groups",
      "protocol": "openid-connect",
      "protocolMappers": [
        {
          "name": "groups",
          "protocol": "openid-connect",
          "protocolMapper": "oidc-group-membership-mapper",
          "config": {
            "claim.name": "groups",
            "full.path": "false",
            "id.token.claim": "true",
            "access.token.claim": "true",
            "userinfo.token.claim": "true"
          }
        }
      ]
    }
  ],
  "groups": [
    { "name": "cluster-admins" },
    { "name": "developers" },
    { "name": "viewers" }
  ],
  "roles": {
    "realm": [
      { "name": "k8s-admin" },
      { "name": "k8s-developer" },
      { "name": "k8s-viewer" }
    ]
  }
}
```

```yaml
# 2. kube-apiserver OIDC 설정 (kubeadm ClusterConfiguration)
apiVersion: kubeadm.k8s.io/v1beta3
kind: ClusterConfiguration
apiServer:
  extraArgs:
    oidc-issuer-url: "https://keycloak.example.com/realms/k8s-realm"
    oidc-client-id: "kubernetes"
    oidc-username-claim: "preferred_username"
    oidc-username-prefix: "oidc:"
    oidc-groups-claim: "groups"
    oidc-groups-prefix: "oidc:"
    oidc-ca-file: "/etc/kubernetes/pki/keycloak-ca.pem"
  extraVolumes:
    - name: keycloak-ca
      hostPath: /etc/kubernetes/pki/keycloak-ca.pem
      mountPath: /etc/kubernetes/pki/keycloak-ca.pem
      readOnly: true
```

```yaml
# 3. Kubernetes RBAC 설정
# cluster-admin-binding.yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: oidc-cluster-admins
subjects:
  - kind: Group
    name: "oidc:cluster-admins"
    apiGroup: rbac.authorization.k8s.io
roleRef:
  kind: ClusterRole
  name: cluster-admin
  apiGroup: rbac.authorization.k8s.io
---
# developer-binding.yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: oidc-developers
subjects:
  - kind: Group
    name: "oidc:developers"
    apiGroup: rbac.authorization.k8s.io
roleRef:
  kind: ClusterRole
  name: edit
  apiGroup: rbac.authorization.k8s.io
---
# viewer-binding.yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: oidc-viewers
subjects:
  - kind: Group
    name: "oidc:viewers"
    apiGroup: rbac.authorization.k8s.io
roleRef:
  kind: ClusterRole
  name: view
  apiGroup: rbac.authorization.k8s.io
```

```yaml
# 4. kubeconfig (kubelogin 사용)
apiVersion: v1
kind: Config
clusters:
  - name: production
    cluster:
      server: https://k8s-api.example.com:6443
      certificate-authority-data: <base64-ca-cert>
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
          - --oidc-extra-scope=offline_access
contexts:
  - name: production-oidc
    context:
      cluster: production
      user: oidc-user
      namespace: default
current-context: production-oidc
```

### 예제 4: Keycloak HA 배포 매니페스트

프로덕션 환경을 위한 Keycloak HA(High Availability) 배포 매니페스트이다.

```yaml
# 1. PostgreSQL StatefulSet
apiVersion: v1
kind: Secret
metadata:
  name: postgres-secret
  namespace: keycloak
type: Opaque
stringData:
  POSTGRES_USER: keycloak
  POSTGRES_PASSWORD: "<strong-password>"
  POSTGRES_DB: keycloak
---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: postgres
  namespace: keycloak
spec:
  serviceName: postgres
  replicas: 1
  selector:
    matchLabels:
      app: postgres
  template:
    metadata:
      labels:
        app: postgres
    spec:
      containers:
        - name: postgres
          image: postgres:16-alpine
          ports:
            - containerPort: 5432
          envFrom:
            - secretRef:
                name: postgres-secret
          volumeMounts:
            - name: postgres-data
              mountPath: /var/lib/postgresql/data
          resources:
            requests:
              cpu: 250m
              memory: 256Mi
            limits:
              cpu: 1000m
              memory: 1Gi
          livenessProbe:
            exec:
              command: ["pg_isready", "-U", "keycloak"]
            initialDelaySeconds: 30
            periodSeconds: 10
          readinessProbe:
            exec:
              command: ["pg_isready", "-U", "keycloak"]
            initialDelaySeconds: 5
            periodSeconds: 5
  volumeClaimTemplates:
    - metadata:
        name: postgres-data
      spec:
        accessModes: ["ReadWriteOnce"]
        storageClassName: standard
        resources:
          requests:
            storage: 10Gi
---
apiVersion: v1
kind: Service
metadata:
  name: postgres
  namespace: keycloak
spec:
  selector:
    app: postgres
  ports:
    - port: 5432
      targetPort: 5432
  clusterIP: None
---
# 2. Keycloak Secret
apiVersion: v1
kind: Secret
metadata:
  name: keycloak-secret
  namespace: keycloak
type: Opaque
stringData:
  KEYCLOAK_ADMIN: admin
  KEYCLOAK_ADMIN_PASSWORD: "<strong-admin-password>"
  KC_DB_USERNAME: keycloak
  KC_DB_PASSWORD: "<strong-password>"
---
# 3. Keycloak StatefulSet (HA)
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: keycloak
  namespace: keycloak
spec:
  serviceName: keycloak-headless
  replicas: 3
  selector:
    matchLabels:
      app: keycloak
  template:
    metadata:
      labels:
        app: keycloak
    spec:
      terminationGracePeriodSeconds: 60
      containers:
        - name: keycloak
          image: quay.io/keycloak/keycloak:25.0
          args:
            - start
            - --optimized
          ports:
            - name: http
              containerPort: 8080
            - name: https
              containerPort: 8443
            - name: jgroups
              containerPort: 7800
          env:
            - name: KEYCLOAK_ADMIN
              valueFrom:
                secretKeyRef:
                  name: keycloak-secret
                  key: KEYCLOAK_ADMIN
            - name: KEYCLOAK_ADMIN_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: keycloak-secret
                  key: KEYCLOAK_ADMIN_PASSWORD
            - name: KC_DB
              value: postgres
            - name: KC_DB_URL
              value: jdbc:postgresql://postgres:5432/keycloak
            - name: KC_DB_USERNAME
              valueFrom:
                secretKeyRef:
                  name: keycloak-secret
                  key: KC_DB_USERNAME
            - name: KC_DB_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: keycloak-secret
                  key: KC_DB_PASSWORD
            - name: KC_HOSTNAME
              value: auth.example.com
            - name: KC_HOSTNAME_STRICT
              value: "true"
            - name: KC_PROXY
              value: edge
            - name: KC_HTTP_ENABLED
              value: "true"
            - name: KC_HEALTH_ENABLED
              value: "true"
            - name: KC_METRICS_ENABLED
              value: "true"
            - name: KC_CACHE
              value: ispn
            - name: KC_CACHE_STACK
              value: kubernetes
            - name: KC_DB_POOL_MIN_SIZE
              value: "5"
            - name: KC_DB_POOL_MAX_SIZE
              value: "20"
            - name: JAVA_OPTS_APPEND
              value: >-
                -Djgroups.dns.query=keycloak-headless.keycloak.svc.cluster.local
                -Xms512m -Xmx1024m
          resources:
            requests:
              cpu: 500m
              memory: 768Mi
            limits:
              cpu: 2000m
              memory: 1536Mi
          readinessProbe:
            httpGet:
              path: /health/ready
              port: 8080
            initialDelaySeconds: 60
            periodSeconds: 10
            failureThreshold: 3
          livenessProbe:
            httpGet:
              path: /health/live
              port: 8080
            initialDelaySeconds: 120
            periodSeconds: 30
            failureThreshold: 3
          startupProbe:
            httpGet:
              path: /health/started
              port: 8080
            initialDelaySeconds: 30
            periodSeconds: 5
            failureThreshold: 30
          lifecycle:
            preStop:
              exec:
                command: ["sh", "-c", "sleep 10"]
---
# 4. Headless Service (JGroups 디스커버리용)
apiVersion: v1
kind: Service
metadata:
  name: keycloak-headless
  namespace: keycloak
spec:
  selector:
    app: keycloak
  ports:
    - name: http
      port: 8080
      targetPort: 8080
    - name: jgroups
      port: 7800
      targetPort: 7800
  clusterIP: None
---
# 5. ClusterIP Service (외부 트래픽용)
apiVersion: v1
kind: Service
metadata:
  name: keycloak
  namespace: keycloak
spec:
  selector:
    app: keycloak
  ports:
    - name: http
      port: 8080
      targetPort: 8080
---
# 6. Ingress
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: keycloak-ingress
  namespace: keycloak
  annotations:
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
    nginx.ingress.kubernetes.io/proxy-buffer-size: "128k"
    nginx.ingress.kubernetes.io/proxy-buffers-number: "4"
    nginx.ingress.kubernetes.io/affinity: "cookie"
    nginx.ingress.kubernetes.io/session-cookie-name: "KC_ROUTE"
    nginx.ingress.kubernetes.io/session-cookie-max-age: "3600"
spec:
  ingressClassName: nginx
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
---
# 7. PodDisruptionBudget
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: keycloak-pdb
  namespace: keycloak
spec:
  minAvailable: 2
  selector:
    matchLabels:
      app: keycloak
```

### 예제 5: Terraform으로 Realm/Client 프로비저닝

Terraform의 Keycloak Provider를 사용하여 Realm, Client, Role, User 등을 코드로 관리하는 예제이다.

```hcl
# providers.tf
terraform {
  required_providers {
    keycloak = {
      source  = "mrparkers/keycloak"
      version = ">= 4.0.0"
    }
  }
}

provider "keycloak" {
  client_id = "admin-cli"
  username  = "admin"
  password  = var.keycloak_admin_password
  url       = var.keycloak_url
}

variable "keycloak_url" {
  description = "Keycloak server URL"
  type        = string
  default     = "http://localhost:8080"
}

variable "keycloak_admin_password" {
  description = "Keycloak admin password"
  type        = string
  sensitive   = true
}
```

```hcl
# realm.tf
resource "keycloak_realm" "demo" {
  realm   = "demo-realm"
  enabled = true

  # 로그인 설정
  login_theme            = "keycloak"
  registration_allowed   = false
  reset_password_allowed = true
  remember_me            = true
  verify_email           = true

  # 세션 설정
  sso_session_idle_timeout    = "30m"
  sso_session_max_lifespan    = "10h"
  access_token_lifespan       = "5m"
  offline_session_idle_timeout = "720h"  # 30일

  # Brute Force 설정
  brute_force_detection {
    permanent_lockout                = false
    max_login_failures               = 5
    wait_increment_seconds           = 60
    quick_login_check_milli_seconds  = 1000
    minimum_quick_login_wait_seconds = 60
    max_failure_wait_seconds         = 900
    failure_reset_time_seconds       = 43200
  }

  # Password Policy
  password_policy = "length(12) and digits(1) and upperCase(1) and lowerCase(1) and specialChars(1) and notUsername and passwordHistory(5)"

  # 보안 헤더
  security_defenses {
    headers {
      x_frame_options                     = "SAMEORIGIN"
      content_security_policy             = "frame-src 'self'; frame-ancestors 'self'; object-src 'none';"
      x_content_type_options              = "nosniff"
      x_robots_tag                        = "none"
      x_xss_protection                    = "1; mode=block"
      strict_transport_security           = "max-age=31536000; includeSubDomains"
    }
  }

  # SMTP 설정
  smtp_server {
    host = "smtp.example.com"
    port = "587"
    from = "noreply@example.com"
    auth {
      username = "smtp-user"
      password = var.smtp_password
    }
    starttls = true
  }

  # 국제화
  internationalization {
    supported_locales = ["en", "ko"]
    default_locale    = "ko"
  }
}
```

```hcl
# clients.tf
resource "keycloak_openid_client" "frontend" {
  realm_id  = keycloak_realm.demo.id
  client_id = "frontend-app"
  name      = "Frontend Application"
  enabled   = true

  access_type              = "PUBLIC"
  standard_flow_enabled    = true
  implicit_flow_enabled    = false
  direct_access_grants_enabled = false

  valid_redirect_uris = [
    "https://app.example.com/*",
    "http://localhost:3000/*"
  ]
  web_origins = [
    "https://app.example.com",
    "http://localhost:3000"
  ]

  pkce_code_challenge_method = "S256"

  login_theme = "keycloak"
}

resource "keycloak_openid_client" "backend" {
  realm_id  = keycloak_realm.demo.id
  client_id = "backend-service"
  name      = "Backend Service"
  enabled   = true

  access_type                  = "CONFIDENTIAL"
  standard_flow_enabled        = false
  implicit_flow_enabled        = false
  direct_access_grants_enabled = false
  service_accounts_enabled     = true

  valid_redirect_uris = []
}

# Client Scope
resource "keycloak_openid_client_scope" "custom_scope" {
  realm_id    = keycloak_realm.demo.id
  name        = "custom-api"
  description = "Custom API scope"
}

# Protocol Mapper - User Attribute
resource "keycloak_openid_user_attribute_protocol_mapper" "department" {
  realm_id        = keycloak_realm.demo.id
  client_scope_id = keycloak_openid_client_scope.custom_scope.id
  name            = "department-mapper"

  user_attribute   = "department"
  claim_name       = "department"
  claim_value_type = "String"

  add_to_id_token     = true
  add_to_access_token = true
  add_to_userinfo     = true
}

# Default Client Scope 할당
resource "keycloak_openid_client_default_scopes" "frontend_scopes" {
  realm_id  = keycloak_realm.demo.id
  client_id = keycloak_openid_client.frontend.id

  default_scopes = [
    "openid",
    "profile",
    "email",
    "roles",
    keycloak_openid_client_scope.custom_scope.name
  ]
}
```

```hcl
# roles.tf
resource "keycloak_role" "admin" {
  realm_id    = keycloak_realm.demo.id
  name        = "app-admin"
  description = "애플리케이션 관리자"
}

resource "keycloak_role" "developer" {
  realm_id    = keycloak_realm.demo.id
  name        = "app-developer"
  description = "개발자"
}

resource "keycloak_role" "viewer" {
  realm_id    = keycloak_realm.demo.id
  name        = "app-viewer"
  description = "읽기 전용 사용자"
}

# Composite Role (admin은 developer + viewer 권한 포함)
resource "keycloak_role" "admin_composite" {
  realm_id    = keycloak_realm.demo.id
  name        = "app-admin"
  description = "애플리케이션 관리자 (모든 권한)"

  composite_roles = [
    keycloak_role.developer.id,
    keycloak_role.viewer.id
  ]
}
```

```hcl
# groups.tf
resource "keycloak_group" "engineering" {
  realm_id = keycloak_realm.demo.id
  name     = "Engineering"
}

resource "keycloak_group" "backend" {
  realm_id  = keycloak_realm.demo.id
  parent_id = keycloak_group.engineering.id
  name      = "Backend"
}

resource "keycloak_group" "frontend" {
  realm_id  = keycloak_realm.demo.id
  parent_id = keycloak_group.engineering.id
  name      = "Frontend"
}

# 그룹에 역할 할당
resource "keycloak_group_roles" "engineering_roles" {
  realm_id = keycloak_realm.demo.id
  group_id = keycloak_group.engineering.id
  role_ids = [
    keycloak_role.developer.id
  ]
}
```

```hcl
# identity-providers.tf
resource "keycloak_oidc_identity_provider" "google" {
  realm         = keycloak_realm.demo.id
  alias         = "google"
  display_name  = "Google"
  provider_id   = "google"

  client_id     = var.google_client_id
  client_secret = var.google_client_secret
  default_scopes = "openid profile email"

  trust_email    = true
  store_token    = false
  sync_mode      = "IMPORT"

  extra_config = {
    "hideOnLoginPage" = "false"
  }
}

# IdP Mapper - Google 그룹 매핑
resource "keycloak_custom_identity_provider_mapper" "google_group" {
  realm                    = keycloak_realm.demo.id
  name                     = "google-to-engineering"
  identity_provider_alias  = keycloak_oidc_identity_provider.google.alias
  identity_provider_mapper = "hardcoded-group-idp-mapper"

  extra_config = {
    "group" = keycloak_group.engineering.id
  }
}
```

```bash
# Terraform 실행
terraform init
terraform plan
terraform apply

# 변경 사항 확인
terraform show

# 특정 리소스 상태 확인
terraform state show keycloak_realm.demo
```

---

## 자가 점검
- [ ] OAuth 2.0과 OpenID Connect의 차이를 설명할 수 있는가?
- [ ] Authorization Code + PKCE 흐름을 단계별로 설명할 수 있는가?
- [ ] Client Credentials Flow의 사용 사례를 설명할 수 있는가?
- [ ] JWT 토큰의 구조(Header, Payload, Signature)와 각 표준 claim의 의미를 설명할 수 있는가?
- [ ] JWKS endpoint를 이용한 토큰 서명 검증 과정을 설명할 수 있는가?
- [ ] ID Token, Access Token, Refresh Token의 차이와 용도를 설명할 수 있는가?
- [ ] Realm, Client, Role의 관계를 설명할 수 있는가?
- [ ] Confidential Client와 Public Client의 차이를 설명할 수 있는가?
- [ ] Identity Brokering과 User Federation의 차이를 설명할 수 있는가?
- [ ] SSO가 왜 필요한지 설명할 수 있는가?
- [ ] Keycloak Authorization Services의 Resource, Scope, Policy, Permission 관계를 설명할 수 있는가?
- [ ] PKCE의 code_verifier와 code_challenge의 관계를 수학적으로 설명할 수 있는가?
- [ ] Refresh Token Rotation이 무엇이고, 왜 필요한지 설명할 수 있는가?
- [ ] Token Introspection과 JWT 자체 검증의 차이(장단점)를 설명할 수 있는가?
- [ ] Device Authorization Grant의 흐름과 사용 사례를 설명할 수 있는가?
- [ ] Token Exchange(RFC 8693)의 사용 사례(위임, 가장)를 설명할 수 있는가?
- [ ] Keycloak의 SPI 아키텍처를 설명하고, 커스텀 SPI를 작성하는 방법을 알고 있는가?
- [ ] Infinispan의 로컬 캐시와 분산 캐시의 차이를 설명할 수 있는가?
- [ ] UserSession, AuthenticationSession, OfflineSession의 차이와 라이프사이클을 설명할 수 있는가?
- [ ] Keycloak의 주요 데이터베이스 테이블 구조를 설명할 수 있는가?
- [ ] WildFly에서 Quarkus로의 마이그레이션이 가져온 이점을 설명할 수 있는가?
- [ ] OIDC Discovery 엔드포인트의 역할과 반환하는 정보를 설명할 수 있는가?
- [ ] Back-Channel Logout과 Front-Channel Logout의 차이를 설명할 수 있는가?
- [ ] JWS와 JWE의 차이를 설명할 수 있는가?
- [ ] RS256, ES256, PS256 알고리즘의 차이와 각각의 장단점을 설명할 수 있는가?
- [ ] Key Rotation이 무엇이고, JWKS에서 어떻게 처리되는지 설명할 수 있는가?
- [ ] Keycloak에서 Authentication Flow를 커스터마이징하는 방법을 알고 있는가?
- [ ] Password Policy의 주요 설정 항목과 프로덕션 권장 설정을 알고 있는가?
- [ ] Protocol Mapper의 종류와 각각의 용도를 설명할 수 있는가?
- [ ] UMA 2.0의 흐름과 사용 사례를 설명할 수 있는가?
- [ ] LDAP Federation에서 Import 모드와 Non-import 모드의 차이를 설명할 수 있는가?
- [ ] Kubernetes API Server에서 OIDC 인증을 설정하는 방법을 알고 있는가?
- [ ] Keycloak HA 배포를 위해 필요한 인프라 구성 요소를 나열할 수 있는가?
- [ ] OAuth 2.0의 주요 보안 위협(CSRF, Token Leakage, Code Injection)과 대응 방안을 설명할 수 있는가?
- [ ] Token Lifetime 설정 시 보안과 사용자 경험의 트레이드오프를 설명할 수 있는가?
- [ ] Keycloak 로그에서 인증 오류를 진단하는 방법을 알고 있는가?
- [ ] Terraform을 사용하여 Keycloak Realm과 Client를 프로비저닝하는 방법을 알고 있는가?

---

## 참고문헌

- [Keycloak 공식 문서](https://www.keycloak.org/documentation) - Server Administration Guide, Securing Applications Guide 등 포함
- [Keycloak GitHub 저장소](https://github.com/keycloak/keycloak) - 소스 코드, 이슈 트래커, 릴리스 노트
- [Keycloak REST API 문서](https://www.keycloak.org/docs-api/latest/rest-api/index.html) - Admin REST API 전체 스펙
- [OAuth 2.0 RFC 6749](https://datatracker.ietf.org/doc/html/rfc6749) - OAuth 2.0 Authorization Framework 표준
- [OAuth 2.0 PKCE RFC 7636](https://datatracker.ietf.org/doc/html/rfc7636) - Proof Key for Code Exchange 표준
- [OpenID Connect Core 1.0](https://openid.net/specs/openid-connect-core-1_0.html) - OIDC 핵심 사양
- [JWT RFC 7519](https://datatracker.ietf.org/doc/html/rfc7519) - JSON Web Token 표준
- [JWKS RFC 7517](https://datatracker.ietf.org/doc/html/rfc7517) - JSON Web Key Set 표준
- [Token Introspection RFC 7662](https://datatracker.ietf.org/doc/html/rfc7662) - OAuth 2.0 Token Introspection 표준
- [Token Revocation RFC 7009](https://datatracker.ietf.org/doc/html/rfc7009) - OAuth 2.0 Token Revocation 표준
- [Device Authorization Grant RFC 8628](https://datatracker.ietf.org/doc/html/rfc8628) - OAuth 2.0 Device Authorization Grant 표준
- [Token Exchange RFC 8693](https://datatracker.ietf.org/doc/html/rfc8693) - OAuth 2.0 Token Exchange 표준
- [UMA 2.0](https://docs.kantarainitiative.org/uma/wg/rec-oauth-uma-grant-2.0.html) - User-Managed Access 2.0 표준
- [OpenID Connect RP-Initiated Logout 1.0](https://openid.net/specs/openid-connect-rpinitiated-1_0.html) - RP-Initiated Logout 사양
- [OpenID Connect Back-Channel Logout 1.0](https://openid.net/specs/openid-connect-backchannel-1_0.html) - Back-Channel Logout 사양
- [Keycloak Terraform Provider](https://registry.terraform.io/providers/mrparkers/keycloak/latest/docs) - Terraform Keycloak Provider 문서
