# Keycloak - IAM / SSO

## 개념

### Keycloak이란?
- 오픈소스 IAM(Identity and Access Management) 솔루션이다
- SSO(Single Sign-On)를 제공한다
- OAuth 2.0, OpenID Connect, SAML 2.0을 지원한다
- Red Hat에서 관리하며 CNCF Incubating 프로젝트이다

### Keycloak 아키텍처
- Keycloak은 Java 기반이며, 25.x 버전부터 WildFly(Java EE 애플리케이션 서버)에서 Quarkus(클라우드 네이티브 Java 프레임워크)로 완전히 마이그레이션되었다
- Quarkus 기반으로 전환되면서 기동 시간과 메모리 사용량이 크게 줄었다
- 내부 데이터베이스로 H2를 사용할 수 있지만, 이는 개발/테스트 환경 전용이다. 프로덕션 환경에서는 PostgreSQL, MySQL, MariaDB, Oracle, MS SQL Server 등 외부 RDBMS를 사용해야 한다
- Theme 시스템을 통해 로그인 페이지, 계정 관리 콘솔, 이메일 템플릿 등의 UI를 커스터마이징할 수 있다. FreeMarker 템플릿 엔진을 사용하며, React 기반 Account Console(v3)도 제공한다
- SPI(Service Provider Interface) 아키텍처를 채택하여 인증 흐름, 사용자 저장소, 프로토콜 매퍼, 이벤트 리스너 등 거의 모든 기능을 플러그인 형태로 확장할 수 있다

```
┌─────────────────────────────────────────────────────────┐
│                    Keycloak Server                       │
│  ┌─────────────────────────────────────────────────┐    │
│  │              Quarkus Runtime                     │    │
│  │  ┌───────────┐  ┌───────────┐  ┌─────────────┐  │    │
│  │  │ OAuth 2.0 │  │   OIDC    │  │  SAML 2.0   │  │    │
│  │  │  Engine   │  │  Provider │  │  Provider   │  │    │
│  │  └───────────┘  └───────────┘  └─────────────┘  │    │
│  │  ┌───────────┐  ┌───────────┐  ┌─────────────┐  │    │
│  │  │  Theme    │  │   SPI     │  │   Event     │  │    │
│  │  │  Engine   │  │  Plugins  │  │  Listeners  │  │    │
│  │  └───────────┘  └───────────┘  └─────────────┘  │    │
│  └─────────────────────────────────────────────────┘    │
│                         │                                │
│              ┌──────────▼──────────┐                    │
│              │  Database (JDBC)    │                    │
│              │  PostgreSQL / MySQL │                    │
│              │  H2 (dev only)     │                    │
│              └─────────────────────┘                    │
└─────────────────────────────────────────────────────────┘
```

### 핵심 개념
| 개념 | 설명 |
|------|------|
| Realm | 사용자, 역할, 클라이언트를 격리하는 테넌트 단위이다. master realm은 관리용이며, 서비스별로 별도 realm을 생성한다 |
| Client | Keycloak에 인증을 요청하는 애플리케이션이다 |
| User | 인증 대상 사용자이다 |
| Role | 권한을 정의하는 역할이다 (admin, viewer 등). Realm Role과 Client Role로 나뉜다 |
| Group | 사용자를 논리적으로 묶는 단위이다. 그룹에 역할을 부여하면 소속 사용자 전체에 적용된다 |
| Token | 인증/인가 정보를 담은 JWT이다 |
| OAuth 2.0 | 인가(Authorization) 프로토콜이다 |
| OpenID Connect | OAuth 2.0 위에 인증(Authentication) 계층을 추가한 프로토콜이다 |
| SSO | 한 번 로그인으로 여러 서비스에 접근할 수 있는 방식이다 |

### Realm 상세 설정

Realm은 Keycloak의 가장 상위 격리 단위이다. 주요 설정 항목은 다음과 같다:

| 설정 항목 | 설명 |
|-----------|------|
| Login Settings | 사용자 등록 허용, 비밀번호 재설정, Remember Me 기능 등을 제어한다 |
| Email Verification | 이메일 인증을 필수로 설정할 수 있다. SMTP 서버 설정이 필요하다 |
| Brute Force Protection | 로그인 실패 횟수 제한, 임시 잠금 시간, 영구 잠금 등을 설정한다 |
| Session Timeout | SSO Session Idle (비활동 타임아웃), SSO Session Max (최대 세션 시간), Access Token Lifespan 등을 설정한다 |
| OTP Policy | TOTP(Time-based One-Time Password) 정책을 설정한다. 알고리즘(SHA1/SHA256/SHA512), 자릿수 등을 지정한다 |

### Client 유형

| 유형 | 설명 | 사용 사례 |
|------|------|-----------|
| Confidential | client_secret을 안전하게 보관할 수 있는 서버 측 애플리케이션이다 | 백엔드 웹 앱, API 서버 |
| Public | client_secret을 보관할 수 없는 클라이언트이다. PKCE를 사용해야 한다 | SPA, 모바일 앱 |
| Bearer-only | 자체 로그인을 수행하지 않고, 다른 클라이언트가 발급한 토큰만 검증한다 | REST API 서버 |

Client에는 다음과 같은 추가 설정이 있다:
- **Client Scopes**: 토큰에 포함할 claim을 정의한다. Default scope는 항상 포함되고, Optional scope는 요청 시에만 포함된다
- **Protocol Mappers**: 토큰에 사용자 속성, 역할, 그룹 등의 정보를 매핑하는 규칙이다. User Attribute Mapper, Role Mapper, Group Membership Mapper 등이 있다

### OAuth 2.0 인증 흐름

#### Authorization Code Flow (+ PKCE)
가장 보편적이고 안전한 흐름이다. 서버 측 애플리케이션에서 사용하며, Public Client(SPA/모바일)에서는 PKCE(Proof Key for Code Exchange)를 반드시 함께 사용해야 한다.

PKCE는 Authorization Code 탈취 공격을 방지한다. 클라이언트가 code_verifier(랜덤 문자열)를 생성하고, 이를 SHA256으로 해싱한 code_challenge를 인증 요청에 포함한다. 토큰 교환 시 원본 code_verifier를 전송하여 서버가 검증한다.

```
┌────────┐     ┌────────────┐     ┌──────────┐
│  User  │     │    App     │     │ Keycloak │
│(Browser)│    │  (Client)  │     │  (IdP)   │
└───┬────┘     └─────┬──────┘     └────┬─────┘
    │                │                  │
    │ 1. 로그인 클릭  │                  │
    │───────────────►│                  │
    │                │ 2. /authorize     │
    │                │ + code_challenge  │
    │                │ (PKCE)           │
    │                │─────────────────►│
    │                │                  │
    │ 3. 로그인 페이지 │                  │
    │◄──────────────────────────────────│
    │                │                  │
    │ 4. ID/PW 입력   │                  │
    │───────────────────────────────────►│
    │                │                  │
    │ 5. Authorization Code              │
    │◄──────────────────────────────────│
    │                │                  │
    │ 6. Code 전달    │                  │
    │───────────────►│                  │
    │                │ 7. Code → Token  │
    │                │ + code_verifier  │
    │                │─────────────────►│
    │                │ 8. Access Token  │
    │                │ + ID Token       │
    │                │ + Refresh Token  │
    │                │◄─────────────────│
    │                │                  │
    │ 9. 보호된 리소스  │                  │
    │◄───────────────│                  │
    │                │                  │
```

#### Client Credentials Flow
서비스 간(machine-to-machine) 통신에 사용한다. 사용자 개입 없이 client_id와 client_secret만으로 토큰을 발급받는다. 마이크로서비스 간 API 호출, 배치 처리 등에 적합하다.

```
┌────────────┐                    ┌──────────┐
│  Service A │                    │ Keycloak │
│  (Client)  │                    │  (IdP)   │
└─────┬──────┘                    └────┬─────┘
      │                                │
      │ 1. POST /token                 │
      │    grant_type=client_credentials│
      │    client_id + client_secret   │
      │───────────────────────────────►│
      │                                │
      │ 2. Access Token                │
      │◄───────────────────────────────│
      │                                │
      │ 3. API 호출 (Bearer Token)      │
      │───────────────────────────────►│ Service B
      │                                │
```

#### Device Authorization Flow
스마트 TV, IoT 디바이스 등 브라우저가 없거나 입력이 불편한 장치에서 사용한다. 디바이스에 코드가 표시되면 사용자가 별도 기기(스마트폰 등)로 인증을 수행한다.

#### Implicit Flow (Deprecated)
과거 SPA에서 사용했으나, Access Token이 URL fragment에 노출되는 보안 문제로 인해 현재는 Authorization Code + PKCE 사용이 권장된다. OAuth 2.1에서는 공식적으로 제거될 예정이다.

### OpenID Connect (OIDC) 상세

OIDC는 OAuth 2.0 위에 인증(Authentication) 레이어를 추가한 프로토콜이다. OAuth 2.0이 "이 사용자가 리소스에 접근할 수 있는가"(인가)를 다룬다면, OIDC는 "이 사용자가 누구인가"(인증)를 다룬다.

#### 토큰 종류

| 토큰 | 용도 | 수명 |
|------|------|------|
| ID Token | 사용자 인증 정보를 담고 있다. 클라이언트가 사용자를 식별하는 데 사용한다. `sub`, `name`, `email` 등의 claim이 포함된다 | 짧음 (수 분) |
| Access Token | 리소스 서버(API)에 접근하기 위한 토큰이다. `Authorization: Bearer <token>` 헤더로 전송한다. 사용자 역할, 권한 정보가 포함된다 | 짧음 (수 분 ~ 수십 분) |
| Refresh Token | Access Token이 만료되었을 때 새 토큰을 발급받기 위한 토큰이다. 클라이언트 측에 안전하게 보관해야 한다 | 김 (수 시간 ~ 수 일) |

#### 주요 Endpoint

| Endpoint | 경로 | 설명 |
|----------|------|------|
| Well-Known Configuration | `/.well-known/openid-configuration` | OIDC Provider의 모든 endpoint 정보를 반환한다. 클라이언트 자동 설정에 사용한다 |
| Authorization | `/protocol/openid-connect/auth` | 사용자 인증을 시작하는 endpoint이다 |
| Token | `/protocol/openid-connect/token` | 토큰 발급/갱신 endpoint이다 |
| UserInfo | `/protocol/openid-connect/userinfo` | Access Token으로 사용자 정보를 조회하는 endpoint이다 |
| JWKS | `/protocol/openid-connect/certs` | 토큰 서명 검증용 공개키를 제공하는 endpoint이다 |
| Introspection | `/protocol/openid-connect/token/introspect` | 토큰 유효성을 검사하는 endpoint이다 (Confidential Client 전용) |
| End Session | `/protocol/openid-connect/logout` | 로그아웃 처리 endpoint이다 |

Keycloak에서의 전체 경로는 `/realms/{realm-name}` 접두사가 붙는다. 예: `/realms/demo-realm/.well-known/openid-configuration`

#### OIDC Scopes

| Scope | 포함 Claim |
|-------|-----------|
| `openid` | 필수 scope이다. `sub` claim이 포함된다 |
| `profile` | `name`, `family_name`, `given_name`, `preferred_username` 등이 포함된다 |
| `email` | `email`, `email_verified`가 포함된다 |
| `roles` | Keycloak 확장 scope이다. `realm_access.roles`, `resource_access` 등이 포함된다 |
| `address` | 사용자 주소 정보가 포함된다 |
| `phone` | `phone_number`, `phone_number_verified`가 포함된다 |

### JWT 토큰 심층 분석

JWT(JSON Web Token)는 Base64URL로 인코딩된 세 부분(Header.Payload.Signature)으로 구성된다.

#### Header
서명 알고리즘과 토큰 타입 정보를 담는다.
```json
{
  "alg": "RS256",    // 서명 알고리즘 (RS256 = RSA + SHA-256)
  "typ": "JWT",      // 토큰 타입
  "kid": "abc123"    // Key ID - JWKS endpoint에서 해당 공개키를 찾는 데 사용한다
}
```

#### Payload (Claims)
토큰에 포함되는 정보(claim)를 담는다.
```json
{
  // Registered Claims (표준 claim)
  "iss": "https://keycloak.example.com/realms/demo-realm",  // 발급자
  "sub": "f4a2e6b8-1234-5678-9abc-def012345678",           // 사용자 고유 ID
  "aud": "demo-app",                                        // 대상 (이 토큰을 사용할 client)
  "exp": 1700003600,                                        // 만료 시각 (Unix timestamp)
  "iat": 1700000000,                                        // 발급 시각
  "nbf": 1700000000,                                        // 이 시각 이전에는 사용 불가 (Not Before)
  "jti": "unique-token-id-here",                            // 토큰 고유 ID (재사용 방지)

  // Keycloak Custom Claims
  "name": "홍길동",
  "email": "hong@example.com",
  "preferred_username": "testuser",
  "realm_access": {
    "roles": ["admin", "app-viewer"]
  },
  "resource_access": {
    "demo-app": {
      "roles": ["manage-users"]
    }
  },
  "scope": "openid profile email"
}
```

#### Signature 검증
- Keycloak은 기본적으로 RS256(RSA + SHA-256) 비대칭 서명을 사용한다
- 토큰 발급 시 Private Key로 서명하고, 검증 시 Public Key로 확인한다
- Public Key는 JWKS(JSON Web Key Set) endpoint(`/protocol/openid-connect/certs`)에서 제공된다
- 리소스 서버는 `kid`(Key ID) claim을 사용하여 JWKS endpoint에서 올바른 공개키를 찾아 서명을 검증한다
- Token Introspection은 Keycloak에 직접 토큰 유효성을 질의하는 방식이며, JWKS 검증과 달리 토큰 폐기(revocation) 여부도 확인할 수 있다

```
서명 검증 흐름:

Resource Server                     Keycloak
     │                                 │
     │  1. GET /certs (JWKS)           │
     │────────────────────────────────►│
     │  2. Public Keys (JSON)          │
     │◄────────────────────────────────│
     │                                 │
     │  3. kid로 해당 공개키 선택         │
     │  4. Header+Payload 서명 검증     │
     │  5. exp, nbf, iss, aud 검증     │
     │                                 │
```

### Identity Brokering (외부 IdP 연동)

Keycloak은 외부 Identity Provider와 연동하여 소셜 로그인 등을 지원한다.

| 연동 유형 | 지원 프로토콜 | 예시 |
|-----------|-------------|------|
| Social Login | OAuth 2.0 / OIDC | Google, GitHub, Facebook, Apple, Microsoft 등 |
| Enterprise IdP | SAML 2.0 | Active Directory Federation Services(ADFS), Okta, OneLogin 등 |
| Custom IdP | OIDC / SAML | 자체 구축 IdP 서버 |

- **First Broker Login Flow**: 외부 IdP로 최초 로그인 시 실행되는 인증 흐름이다. 기존 Keycloak 계정과 연결할지, 새 계정을 생성할지, 이메일 검증을 수행할지 등을 설정할 수 있다
- **Account Linking**: 하나의 Keycloak 사용자 계정에 여러 외부 IdP 계정을 연결할 수 있다. 사용자는 Google로 로그인하든 GitHub로 로그인하든 동일한 사용자로 인식된다

### User Federation (사용자 통합)

기존 디렉토리 서비스와 Keycloak을 연동하여 사용자 정보를 통합할 수 있다.

- **LDAP/Active Directory 연동**: 기존 LDAP 서버의 사용자 정보를 Keycloak에서 직접 사용한다. 사용자 인증은 LDAP에서 수행하고, 인가(역할/권한)는 Keycloak에서 관리하는 하이브리드 구성이 가능하다. Import 모드와 Non-import 모드를 선택할 수 있다
- **Custom User Storage SPI**: LDAP 외 다른 사용자 저장소(외부 DB, 레거시 시스템 등)와 연동하려면 Custom User Storage SPI를 구현한다. `UserStorageProvider`, `UserLookupProvider`, `CredentialInputValidator` 등의 인터페이스를 구현해야 한다

### Authorization Services (세밀한 인가)

Keycloak은 단순 역할 기반(RBAC) 외에도 리소스 기반 세밀한 인가를 지원한다.

- **Resource**: 보호 대상이다 (예: `/api/documents`, `/api/users/{id}`)
- **Scope**: 리소스에 대한 동작이다 (예: `read`, `write`, `delete`)
- **Policy**: 접근 허용 조건을 정의한다
  - Role Policy: 특정 역할 보유 시 허용
  - User Policy: 특정 사용자에게 허용
  - Group Policy: 특정 그룹 소속 시 허용
  - JavaScript Policy: 커스텀 JavaScript 로직으로 판단
  - Time Policy: 특정 시간대에만 허용
  - Aggregated Policy: 여러 정책을 조합 (AND/OR)
- **Permission**: Resource + Scope + Policy를 결합하여 최종 권한을 정의한다
- **Decision Strategy**: 여러 정책이 적용될 때 최종 결정 방식이다 (Unanimous: 모두 허용, Affirmative: 하나라도 허용, Consensus: 다수결)

### Admin REST API 및 Admin CLI

#### Admin REST API
Keycloak의 모든 관리 기능을 REST API로 제공한다. 기본 경로는 `/admin/realms/{realm-name}`이다. Realm 관리, 사용자 CRUD, 역할 관리, 클라이언트 설정 등 Admin Console에서 할 수 있는 모든 작업이 가능하다.

#### Admin CLI (kcadm.sh)
Keycloak에 포함된 명령줄 관리 도구이다. REST API를 래핑하여 쉘 스크립트에서 편리하게 사용할 수 있다.

```bash
# kcadm.sh 인증
kcadm.sh config credentials --server http://localhost:8080 \
  --realm master --user admin --password admin

# Realm 생성
kcadm.sh create realms -s realm=my-realm -s enabled=true

# 사용자 생성
kcadm.sh create users -r my-realm \
  -s username=newuser -s enabled=true -s email=new@example.com

# 비밀번호 설정
kcadm.sh set-password -r my-realm --username newuser --new-password secret123

# 역할 할당
kcadm.sh add-roles -r my-realm --uusername newuser --rolename app-admin

# Client 목록 조회
kcadm.sh get clients -r my-realm --fields clientId,id
```

---

### 이 프로젝트에서의 실습 환경

이 프로젝트에서 Keycloak은 dev 클러스터의 `demo` 네임스페이스에 배포된다.

- 매니페스트: `manifests/demo/keycloak-app.yaml`
- 이미지: `quay.io/keycloak/keycloak:latest`
- 실행 모드: `start-dev` (개발 모드)
- 관리자 계정: admin / admin
- NodePort: 30880
- 백엔드 DB: 같은 네임스페이스의 PostgreSQL (demo/demo123)
- Health 체크: `/health/ready`, `/health/live`
- 실습 대상 클러스터: dev (`kubeconfig/dev.yaml`)

```bash
# dev 클러스터에서 Keycloak 접근
export KUBECONFIG=kubeconfig/dev.yaml
# 브라우저에서 http://<dev-worker-ip>:30880 접속 (admin/admin)
# 또는 포트포워딩:
kubectl port-forward -n demo svc/keycloak 8080:8080
```

---

## Keycloak 아키텍처 심화

### Quarkus 기반 아키텍처

Keycloak 17 이전에는 WildFly(Java EE 풀스택 애플리케이션 서버)를 기반으로 동작했다. WildFly는 엔터프라이즈 기능이 풍부하지만, 컨테이너 환경에서는 과도한 리소스를 소비하고 기동 시간이 길다는 단점이 있었다.

Keycloak 17부터 Quarkus로 마이그레이션이 시작되었고, 20.x에서 WildFly 배포판이 완전히 제거되었다. Quarkus 전환의 주요 이점은 다음과 같다.

| 비교 항목 | WildFly 기반 | Quarkus 기반 |
|-----------|-------------|-------------|
| 기동 시간 | 30~60초 | 3~10초 |
| 메모리 사용량 | 500MB+ | 200~300MB |
| Docker 이미지 크기 | ~700MB | ~400MB |
| 설정 방식 | standalone.xml (XML) | conf/keycloak.conf 또는 환경변수 |
| 빌드 방식 | 런타임 설정 | Build-time optimization (kc.sh build) |
| 네이티브 빌드 | 불가 | GraalVM 네이티브 이미지 지원 |

Quarkus 기반 Keycloak은 **빌드 타임 최적화** 개념을 도입했다. `kc.sh build` 명령으로 데이터베이스 드라이버, Feature, SPI Provider 등을 미리 최적화한다. 빌드 후 `kc.sh start`로 실행하면 런타임에는 이미 최적화된 바이너리가 실행되므로 기동이 매우 빠르다.

```bash
# 빌드 타임 설정 (DB, Feature 등 결정)
./kc.sh build --db=postgres --features=token-exchange,admin-fine-grained-authz

# 런타임 실행 (빌드 결과물 활용)
./kc.sh start \
  --hostname=auth.example.com \
  --db-url=jdbc:postgresql://db:5432/keycloak \
  --db-username=keycloak \
  --db-password=secret \
  --https-certificate-file=/etc/certs/tls.crt \
  --https-certificate-key-file=/etc/certs/tls.key
```

Keycloak 설정 파일(`conf/keycloak.conf`)의 주요 항목은 다음과 같다.

```properties
# 데이터베이스
db=postgres
db-url=jdbc:postgresql://localhost:5432/keycloak
db-username=keycloak
db-password=secret
db-pool-initial-size=5
db-pool-min-size=5
db-pool-max-size=20

# HTTP
http-enabled=true
http-port=8080
https-port=8443
http-relative-path=/

# 호스트네임
hostname=auth.example.com
hostname-strict=true
hostname-strict-backchannel=false

# 프록시
proxy=edge

# 로깅
log=console,file
log-level=INFO
log-console-format=%d{yyyy-MM-dd HH:mm:ss,SSS} %-5p [%c] (%t) %s%e%n

# 메트릭
metrics-enabled=true
health-enabled=true

# 캐시
cache=ispn
cache-config-file=cache-ispn.xml
```

### 내부 SPI (Service Provider Interface) 구조

SPI는 Keycloak의 확장 메커니즘으로, 거의 모든 기능이 SPI를 통해 구현되어 있다. 사용자 인증, 사용자 저장소, 프로토콜 매퍼, 이벤트 처리, 테마 등 핵심 기능도 모두 SPI 기반이다. 커스텀 SPI를 작성하면 Keycloak의 동작을 원하는 대로 확장할 수 있다.

주요 SPI 목록은 다음과 같다.

| SPI | 인터페이스 | 용도 |
|-----|----------|------|
| Authenticator SPI | `Authenticator`, `AuthenticatorFactory` | 커스텀 인증 단계 추가 (예: SMS OTP 인증) |
| User Storage SPI | `UserStorageProvider`, `UserLookupProvider` | 외부 사용자 저장소 연동 (LDAP, 외부 DB 등) |
| Protocol Mapper SPI | `OIDCAccessTokenMapper`, `OIDCIDTokenMapper` | 토큰에 커스텀 claim 추가 |
| Event Listener SPI | `EventListenerProvider` | 로그인, 로그아웃, 에러 등 이벤트 핸들링 |
| Required Action SPI | `RequiredActionProvider` | 로그인 후 필수 동작 추가 (예: 약관 동의) |
| Theme SPI | `ThemeProvider` | 커스텀 테마 제공 |
| Realm Resource SPI | `RealmResourceProvider` | 커스텀 REST API 엔드포인트 추가 |

SPI 구현체는 JAR 파일로 패키징하여 `providers/` 디렉토리에 배치한다. Keycloak이 기동할 때 자동으로 로드된다.

```
keycloak/
├── conf/
│   └── keycloak.conf
├── providers/                    # 커스텀 SPI JAR 파일을 여기에 배치
│   ├── custom-authenticator.jar
│   └── custom-event-listener.jar
├── themes/                       # 커스텀 테마
│   └── my-theme/
│       ├── login/
│       ├── account/
│       └── email/
└── bin/
    └── kc.sh
```

SPI 구현 예시 - Event Listener:

```java
// MyEventListenerProviderFactory.java
public class MyEventListenerProviderFactory implements EventListenerProviderFactory {
    @Override
    public String getId() {
        return "my-event-listener";
    }

    @Override
    public EventListenerProvider create(KeycloakSession session) {
        return new MyEventListenerProvider(session);
    }

    @Override
    public void init(Config.Scope config) {}

    @Override
    public void postInit(KeycloakSessionFactory factory) {}

    @Override
    public void close() {}
}

// MyEventListenerProvider.java
public class MyEventListenerProvider implements EventListenerProvider {
    private final KeycloakSession session;

    public MyEventListenerProvider(KeycloakSession session) {
        this.session = session;
    }

    @Override
    public void onEvent(Event event) {
        if (event.getType() == EventType.LOGIN) {
            // 로그인 이벤트 처리 (예: 슬랙 알림, 감사 로그 등)
            System.out.println("User logged in: " + event.getUserId());
        }
    }

    @Override
    public void onEvent(AdminEvent event, boolean includeRepresentation) {
        // 관리자 이벤트 처리
    }

    @Override
    public void close() {}
}
```

SPI를 등록하려면 `META-INF/services/` 디렉토리에 서비스 로더 파일을 추가해야 한다.

```
META-INF/services/org.keycloak.events.EventListenerProviderFactory
```

파일 내용:
```
com.example.MyEventListenerProviderFactory
```

### 캐시 레이어: Infinispan

Keycloak은 Infinispan을 내부 캐시 레이어로 사용한다. Infinispan은 Red Hat이 개발한 분산 인메모리 데이터 그리드로, Keycloak의 성능에 핵심적인 역할을 한다.

Keycloak에서 사용하는 주요 캐시는 다음과 같다.

| 캐시 이름 | 유형 | 저장 데이터 |
|-----------|------|-----------|
| `realms` | 로컬 | Realm 설정, Client 설정 |
| `users` | 로컬 | 사용자 정보, Credential |
| `authorization` | 로컬 | Authorization 정책, 리소스, 스코프 |
| `keys` | 로컬 | 서명 키, 공개키 |
| `sessions` | 분산 | UserSession (현재 로그인한 사용자 세션) |
| `authenticationSessions` | 분산 | AuthenticationSession (로그인 진행 중 세션) |
| `offlineSessions` | 분산 | OfflineSession (오프라인 토큰 세션) |
| `clientSessions` | 분산 | Client별 세션 |
| `loginFailures` | 분산 | Brute force 감지를 위한 로그인 실패 기록 |
| `actionTokens` | 분산 | 이메일 인증 링크, 비밀번호 재설정 토큰 등 |

**로컬 캐시**는 각 Keycloak 인스턴스의 메모리에만 존재한다. 변경이 발생하면 다른 인스턴스에 무효화(invalidation) 메시지를 전송하여 일관성을 유지한다.

**분산 캐시**는 여러 Keycloak 인스턴스에 데이터가 분산 저장된다. 세션 데이터가 대표적이다. 기본적으로 2개의 복제본(owners)을 유지하여 하나의 노드가 장애를 겪어도 세션이 유실되지 않는다.

Infinispan 캐시 설정은 `cache-ispn.xml` 파일에서 관리한다.

```xml
<infinispan>
    <cache-container name="keycloak">
        <!-- 로컬 캐시: Realm/Client/User 메타데이터 -->
        <local-cache name="realms">
            <encoding>
                <key media-type="application/x-java-object"/>
                <value media-type="application/x-java-object"/>
            </encoding>
            <memory max-count="10000"/>
        </local-cache>

        <local-cache name="users">
            <encoding>
                <key media-type="application/x-java-object"/>
                <value media-type="application/x-java-object"/>
            </encoding>
            <memory max-count="10000"/>
            <expiration max-idle="3600000"/>  <!-- 1시간 미사용 시 제거 -->
        </local-cache>

        <!-- 분산 캐시: 세션 데이터 -->
        <distributed-cache name="sessions" owners="2">
            <expiration lifespan="-1"/>
        </distributed-cache>

        <distributed-cache name="authenticationSessions" owners="2">
            <expiration lifespan="1800000"/>  <!-- 30분 -->
        </distributed-cache>

        <distributed-cache name="offlineSessions" owners="2">
            <expiration lifespan="-1"/>
        </distributed-cache>
    </cache-container>
</infinispan>
```

HA(High Availability) 환경에서는 Infinispan 노드 간 통신을 위해 JGroups를 사용한다. Kubernetes 환경에서는 DNS_PING 또는 KUBE_PING 프로토콜을 사용하여 다른 Keycloak Pod를 자동으로 발견한다.

```
┌─────────────────────────────────────────────────────────────┐
│                    Kubernetes Cluster                        │
│                                                             │
│  ┌─────────────────┐    JGroups    ┌─────────────────┐     │
│  │  Keycloak Pod 1 │◄────────────►│  Keycloak Pod 2 │     │
│  │  ┌────────────┐ │              │  ┌────────────┐ │     │
│  │  │ Infinispan │ │  분산 캐시    │  │ Infinispan │ │     │
│  │  │ (sessions) │◄──────────────►│  │ (sessions) │ │     │
│  │  └────────────┘ │              │  └────────────┘ │     │
│  │  ┌────────────┐ │  무효화 통지  │  ┌────────────┐ │     │
│  │  │ Infinispan │ │◄────────────►│  │ Infinispan │ │     │
│  │  │  (realms)  │ │ (로컬 캐시)  │  │  (realms)  │ │     │
│  │  └────────────┘ │              │  └────────────┘ │     │
│  └────────┬────────┘              └────────┬────────┘     │
│           │                                 │              │
│           └────────────┬───────────────────┘              │
│                        ▼                                   │
│              ┌─────────────────┐                           │
│              │   PostgreSQL    │                           │
│              └─────────────────┘                           │
└─────────────────────────────────────────────────────────────┘
```

### 세션 관리

Keycloak은 여러 종류의 세션을 관리한다. 각 세션 유형의 역할과 라이프사이클을 이해하는 것이 중요하다.

#### AuthenticationSession

로그인 과정 중에 존재하는 임시 세션이다. 사용자가 로그인 페이지에 접속한 시점부터 인증이 완료될 때까지 유지된다. 인증이 완료되면 UserSession으로 전환되고, AuthenticationSession은 삭제된다.

- 생성 시점: `/authorize` 엔드포인트 호출 시
- 삭제 시점: 인증 완료 또는 타임아웃
- 기본 수명: 5분 (설정 변경 가능)
- 저장 위치: Infinispan 분산 캐시 (`authenticationSessions`)

#### UserSession

사용자가 인증에 성공한 후 생성되는 SSO 세션이다. 하나의 UserSession에 여러 Client Session이 연결될 수 있다. 이것이 SSO의 핵심으로, 한 번 로그인하면 같은 Realm의 다른 Client에 재로그인 없이 접근할 수 있다.

- 생성 시점: 인증 성공 시
- 삭제 시점: 로그아웃, SSO Session Max 타임아웃, SSO Session Idle 타임아웃
- SSO Session Idle: 비활동 타임아웃 (기본 30분)
- SSO Session Max: 절대 타임아웃 (기본 10시간)
- 저장 위치: Infinispan 분산 캐시 (`sessions`)

```
                    UserSession
                    ┌──────────────────────────────────────┐
                    │  Session ID: abc-123-def              │
                    │  User: testuser                       │
                    │  Login Time: 2024-01-01 10:00:00      │
                    │  Last Access: 2024-01-01 10:30:00     │
                    │  IP: 192.168.1.100                    │
                    │                                       │
                    │  ┌──────────────┐ ┌──────────────┐   │
                    │  │ClientSession │ │ClientSession │   │
                    │  │ demo-app     │ │ admin-app    │   │
                    │  │ AT: eyJ...   │ │ AT: eyJ...   │   │
                    │  └──────────────┘ └──────────────┘   │
                    └──────────────────────────────────────┘
```

#### OfflineSession

오프라인 토큰을 위한 장기 세션이다. 일반 세션과 달리 SSO Session Idle/Max 타임아웃에 영향을 받지 않으며, 서버 재시작 후에도 유지된다. 모바일 앱이나 장기 실행 배치 작업에서 사용한다.

- 생성 시점: `scope=offline_access`로 토큰 요청 시
- 삭제 시점: 관리자가 명시적으로 해지하거나 Offline Session Idle 타임아웃
- Offline Session Idle: 기본 30일
- 저장 위치: 데이터베이스 + Infinispan 분산 캐시 (`offlineSessions`)

### 데이터베이스 스키마 구조

Keycloak은 JPA(Hibernate)를 사용하여 데이터를 영속화한다. 주요 테이블 구조는 다음과 같다.

| 테이블 | 설명 | 주요 컬럼 |
|--------|------|-----------|
| `REALM` | Realm 정보 | `ID`, `NAME`, `ENABLED`, `SSL_REQUIRED`, `ACCESS_TOKEN_LIFESPAN` |
| `CLIENT` | Client 정보 | `ID`, `REALM_ID`, `CLIENT_ID`, `PROTOCOL`, `PUBLIC_CLIENT`, `SECRET` |
| `USER_ENTITY` | 사용자 정보 | `ID`, `REALM_ID`, `USERNAME`, `EMAIL`, `ENABLED`, `CREATED_TIMESTAMP` |
| `CREDENTIAL` | 사용자 인증 정보 | `ID`, `USER_ID`, `TYPE`, `SECRET_DATA`, `CREDENTIAL_DATA` |
| `USER_ROLE_MAPPING` | 사용자-역할 매핑 | `USER_ID`, `ROLE_ID` |
| `KEYCLOAK_ROLE` | 역할 정보 | `ID`, `REALM_ID`, `CLIENT_ROLE`, `NAME`, `DESCRIPTION` |
| `USER_GROUP_MEMBERSHIP` | 사용자-그룹 매핑 | `USER_ID`, `GROUP_ID` |
| `KEYCLOAK_GROUP` | 그룹 정보 | `ID`, `REALM_ID`, `NAME`, `PARENT_GROUP` |
| `USER_SESSION` | 사용자 세션 (persistent) | `ID`, `USER_ID`, `REALM_ID`, `LAST_SESSION_REFRESH`, `BROKER_SESSION_ID` |
| `CLIENT_SESSION` | 클라이언트 세션 | `ID`, `SESSION_ID`, `CLIENT_ID`, `TIMESTAMP` |
| `OFFLINE_USER_SESSION` | 오프라인 세션 | `USER_SESSION_ID`, `USER_ID`, `REALM_ID`, `DATA` |
| `OFFLINE_CLIENT_SESSION` | 오프라인 클라이언트 세션 | `CLIENT_SESSION_ID`, `USER_SESSION_ID`, `DATA` |
| `USER_ATTRIBUTE` | 사용자 커스텀 속성 | `ID`, `USER_ID`, `NAME`, `VALUE` |
| `IDENTITY_PROVIDER` | 외부 IdP 설정 | `INTERNAL_ID`, `REALM_ID`, `PROVIDER_ID`, `PROVIDER_ALIAS` |
| `COMPONENT` | SPI 컴포넌트 (LDAP 등) | `ID`, `REALM_ID`, `PROVIDER_TYPE`, `PROVIDER_ID` |
| `PROTOCOL_MAPPER` | 프로토콜 매퍼 | `ID`, `NAME`, `PROTOCOL`, `PROTOCOL_MAPPER_NAME`, `CLIENT_ID` |
| `EVENT_ENTITY` | 이벤트 로그 | `ID`, `REALM_ID`, `TYPE`, `USER_ID`, `IP_ADDRESS`, `EVENT_TIME` |

테이블 관계를 간략히 도식화하면 다음과 같다.

```
REALM (1) ──────────── (N) CLIENT
  │                         │
  │(1)                      │(1)
  │                         │
  ├── (N) USER_ENTITY       ├── (N) PROTOCOL_MAPPER
  │         │               │
  │         ├── (N) CREDENTIAL
  │         │
  │         ├── (N) USER_ROLE_MAPPING ──── KEYCLOAK_ROLE
  │         │
  │         ├── (N) USER_GROUP_MEMBERSHIP ── KEYCLOAK_GROUP
  │         │
  │         ├── (N) USER_ATTRIBUTE
  │         │
  │         └── (N) USER_SESSION ──── (N) CLIENT_SESSION
  │
  ├── (N) KEYCLOAK_ROLE
  │
  ├── (N) KEYCLOAK_GROUP
  │
  ├── (N) IDENTITY_PROVIDER
  │
  └── (N) COMPONENT
```

### 스레딩 모델: Vert.x 이벤트 루프

Quarkus 기반 Keycloak은 내부적으로 Vert.x를 사용한다. Vert.x는 이벤트 드리븐, 논블로킹 I/O 프레임워크로, Netty 위에서 동작한다.

Keycloak의 스레딩 모델은 다음과 같다.

- **이벤트 루프 스레드(Event Loop Thread)**: HTTP 요청 수신, 응답 전송 등 I/O 작업을 처리한다. CPU 코어 수 * 2개의 이벤트 루프 스레드가 생성된다. 이 스레드에서는 블로킹 작업을 절대로 수행해서는 안 된다
- **워커 스레드(Worker Thread)**: 블로킹 작업(데이터베이스 쿼리, LDAP 조회 등)을 처리한다. 기본 워커 스레드 풀 크기는 CPU 코어 수에 비례한다
- **Executor 스레드**: Infinispan 캐시 작업, 백그라운드 태스크 등을 처리한다

```
                    HTTP Request
                         │
                         ▼
              ┌─────────────────────┐
              │  Vert.x Event Loop  │  ← 논블로킹 I/O
              │  (수신/응답 처리)     │
              └──────────┬──────────┘
                         │
                    블로킹 작업?
                    ┌────┴────┐
                    │         │
                   Yes       No
                    │         │
                    ▼         ▼
          ┌─────────────┐  이벤트 루프에서
          │ Worker Pool │  직접 처리
          │ (DB 쿼리 등)│
          └─────────────┘
```

### Startup/Shutdown 라이프사이클

Keycloak의 기동(Startup) 과정은 다음과 같다.

1. **Quarkus 부트스트랩**: CDI(Context and Dependency Injection) 컨테이너 초기화, 확장 모듈 로드
2. **데이터베이스 연결**: JDBC 커넥션 풀 생성, 스키마 마이그레이션(Liquibase) 실행
3. **Infinispan 초기화**: 로컬 캐시 생성, 클러스터 환경이면 JGroups로 다른 노드 디스커버리
4. **SPI Provider 로드**: `providers/` 디렉토리의 JAR 파일 스캔, ServiceLoader로 등록
5. **Realm 로드**: Master Realm 로드 및 캐시 워밍
6. **HTTP 서버 시작**: Vert.x HTTP 서버 바인딩, 요청 수신 시작
7. **Health Check 활성화**: `/health/ready`, `/health/live` 엔드포인트 활성화

종료(Shutdown) 과정은 다음과 같다.

1. **HTTP 서버 종료**: 새로운 요청 수신 중단 (Graceful Shutdown)
2. **진행 중 요청 완료 대기**: 설정된 타임아웃 동안 진행 중인 요청 완료 대기
3. **Infinispan 종료**: 세션 데이터 다른 노드로 재분배(rebalancing), 캐시 플러시
4. **DB 커넥션 풀 종료**: 활성 커넥션 반환, 풀 종료
5. **JVM 종료**

Kubernetes 환경에서는 `preStop` 훅과 `terminationGracePeriodSeconds`를 적절히 설정하여 트래픽 중단 없는 Rolling Update를 보장해야 한다.

```yaml
# Graceful Shutdown 설정 예시
spec:
  terminationGracePeriodSeconds: 60
  containers:
    - name: keycloak
      lifecycle:
        preStop:
          exec:
            command: ["sh", "-c", "sleep 10"]  # L7 LB 반영 대기
      readinessProbe:
        httpGet:
          path: /health/ready
          port: 8080
        initialDelaySeconds: 30
        periodSeconds: 10
      livenessProbe:
        httpGet:
          path: /health/live
          port: 8080
        initialDelaySeconds: 60
        periodSeconds: 30
```

---

## OAuth 2.0 심화

### Authorization Code Flow + PKCE 전체 시퀀스

Authorization Code Flow + PKCE의 전체 과정을 세밀하게 단계별로 기술한다. 이 흐름은 SPA, 모바일 앱, 서버 애플리케이션 모두에서 권장되는 표준 흐름이다.

```
┌──────────┐          ┌──────────┐          ┌──────────┐          ┌──────────┐
│  User    │          │  Client  │          │ Keycloak │          │ Resource │
│ (Browser)│          │  (App)   │          │  (AuthZ) │          │  Server  │
└────┬─────┘          └────┬─────┘          └────┬─────┘          └────┬─────┘
     │                     │                     │                     │
     │ 1. 로그인 버튼 클릭   │                     │                     │
     │────────────────────►│                     │                     │
     │                     │                     │                     │
     │     2. code_verifier = random(43~128자)   │                     │
     │        code_challenge = BASE64URL(        │                     │
     │          SHA256(code_verifier))            │                     │
     │        state = random()                   │                     │
     │        nonce = random()                   │                     │
     │                     │                     │                     │
     │ 3. 302 Redirect     │                     │                     │
     │◄────────────────────│                     │                     │
     │  Location: /auth?   │                     │                     │
     │    response_type=code                     │                     │
     │    &client_id=demo-app                    │                     │
     │    &redirect_uri=https://app/callback     │                     │
     │    &scope=openid profile email            │                     │
     │    &state=xyz123                          │                     │
     │    &nonce=abc456                          │                     │
     │    &code_challenge=E9Melhoa...            │                     │
     │    &code_challenge_method=S256            │                     │
     │                     │                     │                     │
     │ 4. GET /auth (위 파라미터 포함)              │                     │
     │──────────────────────────────────────────►│                     │
     │                     │                     │                     │
     │ 5. 로그인 페이지 HTML │                     │                     │
     │◄──────────────────────────────────────────│                     │
     │                     │                     │                     │
     │ 6. POST (username + password)             │                     │
     │──────────────────────────────────────────►│                     │
     │                     │                     │                     │
     │                     │   7. 인증 성공 →      │                     │
     │                     │      UserSession 생성│                     │
     │                     │      AuthCode 생성   │                     │
     │                     │                     │                     │
     │ 8. 302 Redirect     │                     │                     │
     │◄──────────────────────────────────────────│                     │
     │  Location: https://app/callback?          │                     │
     │    code=SplxlOBeZQQYbYS6WxSbIA            │                     │
     │    &state=xyz123                          │                     │
     │                     │                     │                     │
     │ 9. GET /callback?code=...&state=...       │                     │
     │────────────────────►│                     │                     │
     │                     │                     │                     │
     │                     │ 10. state 검증       │                     │
     │                     │     (CSRF 방지)      │                     │
     │                     │                     │                     │
     │                     │ 11. POST /token      │                     │
     │                     │   grant_type=        │                     │
     │                     │     authorization_code                    │
     │                     │   code=SplxlO...     │                     │
     │                     │   redirect_uri=      │                     │
     │                     │     https://app/cb   │                     │
     │                     │   client_id=demo-app │                     │
     │                     │   code_verifier=     │                     │
     │                     │     dBjftJeZ4CVP...  │                     │
     │                     │────────────────────►│                     │
     │                     │                     │                     │
     │                     │   12. Keycloak 검증: │                     │
     │                     │   - code 유효성      │                     │
     │                     │   - redirect_uri 일치│                     │
     │                     │   - code_verifier →  │                     │
     │                     │     SHA256 →         │                     │
     │                     │     code_challenge   │                     │
     │                     │     일치 여부 검증    │                     │
     │                     │                     │                     │
     │                     │ 13. Token Response   │                     │
     │                     │   access_token       │                     │
     │                     │   id_token           │                     │
     │                     │   refresh_token      │                     │
     │                     │   token_type=Bearer  │                     │
     │                     │   expires_in=300     │                     │
     │                     │◄────────────────────│                     │
     │                     │                     │                     │
     │                     │ 14. id_token 검증:   │                     │
     │                     │   - signature        │                     │
     │                     │   - nonce 일치       │                     │
     │                     │   - iss, aud 검증    │                     │
     │                     │                     │                     │
     │                     │ 15. API 요청 (Bearer) │                     │
     │                     │──────────────────────────────────────────►│
     │                     │                     │                     │
     │                     │ 16. 보호된 리소스 응답  │                     │
     │                     │◄──────────────────────────────────────────│
     │                     │                     │                     │
     │ 17. 페이지 렌더링    │                     │                     │
     │◄────────────────────│                     │                     │
```

### Client Credentials Flow 상세

Client Credentials Flow는 사용자 컨텍스트가 없는 M2M(Machine-to-Machine) 통신에서 사용한다. 이 흐름에서는 ID Token이 발급되지 않으며, Refresh Token도 기본적으로 발급되지 않는다.

주요 특징:
- `grant_type=client_credentials`를 사용한다
- Client 인증(client_id + client_secret)만으로 토큰을 발급받는다
- 발급된 Access Token에는 사용자 정보(sub)가 서비스 계정(service-account-{client_id})으로 설정된다
- Keycloak에서는 Confidential Client에 "Service Accounts Enabled" 옵션을 활성화해야 한다

```bash
# Client Credentials Flow 토큰 요청
curl -X POST "http://localhost:8080/realms/demo-realm/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials" \
  -d "client_id=backend-service" \
  -d "client_secret=<client-secret>" \
  -d "scope=openid"
```

응답 예시:
```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expires_in": 300,
  "refresh_expires_in": 0,
  "token_type": "Bearer",
  "not-before-policy": 0,
  "scope": "openid profile email"
}
```

### Device Authorization Grant (RFC 8628)

Device Authorization Grant는 입력이 제한된 디바이스(스마트 TV, IoT, CLI 도구 등)에서 사용하는 OAuth 2.0 확장 흐름이다. Keycloak에서는 Feature 플래그를 통해 활성화할 수 있다.

전체 흐름은 다음과 같다.

```
┌──────────┐          ┌──────────┐          ┌──────────┐
│  Device  │          │ Keycloak │          │   User   │
│ (TV/IoT) │          │  (AuthZ) │          │ (Phone)  │
└────┬─────┘          └────┬─────┘          └────┬─────┘
     │                     │                     │
     │ 1. POST /device     │                     │
     │   client_id=tv-app  │                     │
     │────────────────────►│                     │
     │                     │                     │
     │ 2. 응답:             │                     │
     │   device_code       │                     │
     │   user_code=WDJB-MJHT                     │
     │   verification_uri= │                     │
     │   https://auth/device│                     │
     │   interval=5        │                     │
     │   expires_in=600    │                     │
     │◄────────────────────│                     │
     │                     │                     │
     │ 3. TV 화면에 표시:    │                     │
     │ "https://auth/device│                     │
     │  에서 코드 WDJB-MJHT│                     │
     │  를 입력하세요"      │                     │
     │                     │                     │
     │                     │ 4. 브라우저로 접속    │
     │                     │◄────────────────────│
     │                     │                     │
     │                     │ 5. user_code 입력    │
     │                     │◄────────────────────│
     │                     │                     │
     │                     │ 6. 로그인 + 동의     │
     │                     │◄────────────────────│
     │                     │                     │
     │ 7. 주기적 폴링 (5초) │                     │
     │   POST /token       │                     │
     │   grant_type=       │                     │
     │   urn:ietf:params:  │                     │
     │   oauth:grant-type: │                     │
     │   device_code       │                     │
     │   device_code=xxx   │                     │
     │────────────────────►│                     │
     │                     │                     │
     │ 8-a. 아직 미인증:    │                     │
     │   "authorization_   │                     │
     │    pending"         │                     │
     │◄────────────────────│                     │
     │                     │                     │
     │ ... (폴링 반복) ...  │                     │
     │                     │                     │
     │ 8-b. 인증 완료:      │                     │
     │   access_token      │                     │
     │   refresh_token     │                     │
     │◄────────────────────│                     │
```

### Token Exchange (RFC 8693)

Token Exchange는 하나의 토큰을 다른 유형의 토큰으로 교환하는 기능이다. 마이크로서비스 아키텍처에서 서비스 간 토큰 위임에 주로 사용한다. Keycloak에서는 Preview Feature로 제공되며, 빌드 시 활성화가 필요하다.

```bash
# Token Exchange Feature 활성화
./kc.sh build --features=token-exchange
```

주요 사용 사례:
- **위임(Delegation)**: Service A가 자신의 토큰을 Service B에서 사용할 수 있는 토큰으로 교환한다
- **가장(Impersonation)**: 관리자가 특정 사용자인 것처럼 토큰을 발급받는다
- **외부 토큰 교환**: 외부 IdP 토큰을 Keycloak 토큰으로 교환한다

```bash
# Token Exchange 요청
curl -X POST "http://localhost:8080/realms/demo-realm/protocol/openid-connect/token" \
  -d "grant_type=urn:ietf:params:oauth:grant-type:token-exchange" \
  -d "client_id=service-a" \
  -d "client_secret=<secret>" \
  -d "subject_token=<original-access-token>" \
  -d "subject_token_type=urn:ietf:params:oauth:token-type:access_token" \
  -d "requested_token_type=urn:ietf:params:oauth:token-type:access_token" \
  -d "audience=service-b"
```

### Refresh Token Rotation

Refresh Token Rotation은 Refresh Token을 사용할 때마다 새로운 Refresh Token을 발급하고, 이전 Refresh Token을 무효화하는 보안 메커니즘이다. 이를 통해 Refresh Token 탈취 공격의 피해를 최소화할 수 있다.

Keycloak에서의 동작 방식:
1. 클라이언트가 Refresh Token으로 새 Access Token을 요청한다
2. Keycloak은 새 Access Token과 함께 **새로운 Refresh Token**을 발급한다
3. 이전 Refresh Token은 즉시 무효화된다
4. 만약 이미 무효화된 Refresh Token으로 요청이 오면, 해당 사용자의 **모든** 세션을 무효화한다 (탈취 감지)

Keycloak Realm 설정에서 "Revoke Refresh Token"을 활성화하면 이 기능을 사용할 수 있다.

```
┌──────────┐                    ┌──────────┐
│  Client  │                    │ Keycloak │
└────┬─────┘                    └────┬─────┘
     │                               │
     │ 1. POST /token                │
     │   grant_type=refresh_token    │
     │   refresh_token=RT_v1         │
     │──────────────────────────────►│
     │                               │
     │ 2. 응답:                       │
     │   access_token=AT_v2          │
     │   refresh_token=RT_v2 (NEW)   │
     │◄──────────────────────────────│
     │                               │
     │   RT_v1은 이제 무효화됨         │
     │                               │
     │ 3. POST /token                │
     │   refresh_token=RT_v1 (재사용) │
     │──────────────────────────────►│
     │                               │
     │ 4. 에러: invalid_grant         │
     │   + 모든 세션 무효화 (탈취 감지) │
     │◄──────────────────────────────│
```

### Token Introspection (RFC 7662)

Token Introspection은 리소스 서버가 Authorization Server에 토큰의 유효성을 직접 질의하는 메커니즘이다. JWT의 자체 검증(서명 + 만료 시간)과 달리, 서버 측에서 토큰의 실시간 상태(폐기 여부, 세션 유효성 등)를 확인할 수 있다.

```bash
# Token Introspection 요청
curl -X POST \
  "http://localhost:8080/realms/demo-realm/protocol/openid-connect/token/introspect" \
  -d "token=<access-token-to-check>" \
  -d "client_id=resource-server" \
  -d "client_secret=<secret>"
```

활성 토큰의 응답 예시:
```json
{
  "active": true,
  "sub": "f4a2e6b8-1234-5678-9abc-def012345678",
  "username": "testuser",
  "email": "test@example.com",
  "realm_access": {
    "roles": ["app-admin"]
  },
  "client_id": "demo-app",
  "token_type": "Bearer",
  "exp": 1700003600,
  "iat": 1700000000,
  "scope": "openid profile email"
}
```

비활성(만료/폐기) 토큰의 응답:
```json
{
  "active": false
}
```

Introspection과 JWT 자체 검증의 비교:

| 항목 | JWT 자체 검증 | Token Introspection |
|------|-------------|---------------------|
| 네트워크 요청 | 불필요 (JWKS 캐싱 후) | 매 검증마다 필요 |
| 실시간 폐기 감지 | 불가 | 가능 |
| 성능 | 빠름 | 상대적으로 느림 |
| 의존성 | JWKS endpoint만 필요 | Keycloak 가용성 필요 |
| 사용 대상 | Public Client 포함 모두 가능 | Confidential Client만 가능 |

### Token Revocation (RFC 7009)

Token Revocation은 발급된 토큰을 명시적으로 무효화하는 메커니즘이다. 사용자 로그아웃, 비밀번호 변경, 보안 사고 발생 시 사용한다.

```bash
# Access Token 또는 Refresh Token 폐기
curl -X POST \
  "http://localhost:8080/realms/demo-realm/protocol/openid-connect/revoke" \
  -d "token=<token-to-revoke>" \
  -d "token_type_hint=refresh_token" \
  -d "client_id=demo-app" \
  -d "client_secret=<secret>"
```

Keycloak에서 Refresh Token을 폐기하면 해당 세션의 모든 관련 토큰(Access Token 포함)이 함께 무효화된다. 다만, JWT Access Token은 이미 발급된 후 자체적으로 유효하므로, 만료 시간까지는 리소스 서버에서 유효한 것으로 판단될 수 있다. 이를 해결하려면 Token Introspection을 병행해야 한다.

### OAuth 2.0 보안 위협과 대응

#### CSRF (Cross-Site Request Forgery)

공격 시나리오: 공격자가 피해자의 브라우저를 이용하여 Authorization Code를 자신의 계정에 연결하는 공격이다.

대응:
- `state` 파라미터를 사용한다. 클라이언트가 인증 요청 시 랜덤 `state` 값을 생성하고, 콜백에서 일치 여부를 검증한다
- PKCE를 사용하면 `state`와 유사한 CSRF 방어 효과를 얻을 수 있다

#### Token Leakage

공격 시나리오: 로그, Referer 헤더, 브라우저 히스토리 등을 통해 토큰이 유출되는 경우이다.

대응:
- Access Token 수명을 짧게 설정한다 (5~15분)
- Refresh Token Rotation을 활성화한다
- Authorization Code는 일회용으로 사용한다 (한 번 교환 후 무효화)
- `response_mode=fragment`를 사용하여 토큰이 서버 로그에 기록되는 것을 방지한다

#### Authorization Code Injection

공격 시나리오: 공격자가 탈취한 Authorization Code를 다른 클라이언트에서 사용하는 경우이다.

대응:
- PKCE를 필수로 사용한다. code_verifier를 모르면 탈취한 코드가 무용지물이다
- `redirect_uri`를 정확히 매칭한다 (와일드카드 사용 자제)

#### Open Redirect

공격 시나리오: `redirect_uri`에 공격자의 URL을 삽입하여 Authorization Code를 탈취하는 경우이다.

대응:
- Keycloak Client 설정에서 `Valid Redirect URIs`를 정확히 지정한다
- 와일드카드(`*`) 사용을 최소화한다
- `redirect_uri`가 등록된 URI와 정확히 일치하는지 검증한다

### PKCE의 code_verifier/code_challenge 수학적 원리

PKCE(Proof Key for Code Exchange, RFC 7636)는 Authorization Code 탈취 공격을 방지하기 위한 메커니즘이다. 핵심 원리는 "해시 함수의 일방향성"에 기반한다.

**1단계: code_verifier 생성**
```
code_verifier = random_string(43~128자, [A-Z][a-z][0-9]-._~)
예: dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk
```

**2단계: code_challenge 생성**
```
code_challenge = BASE64URL(SHA256(code_verifier))

계산 과정:
1. SHA256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")
   = 바이너리 해시값 (32바이트)
2. BASE64URL(해시값)
   = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
```

**3단계: 인증 요청 시 code_challenge 전송**
```
GET /authorize?
  response_type=code
  &client_id=demo-app
  &code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM
  &code_challenge_method=S256
```

**4단계: 토큰 교환 시 code_verifier 전송**
```
POST /token
  grant_type=authorization_code
  &code=<auth-code>
  &code_verifier=dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk
```

**5단계: 서버 검증**
```
서버 계산: BASE64URL(SHA256(수신한 code_verifier))
         = E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM

저장된 code_challenge와 비교 → 일치하면 유효

공격자는 code_challenge만 알고 있으므로,
SHA256의 일방향성으로 인해 원본 code_verifier를 역산할 수 없다.
```

`code_challenge_method`는 두 가지가 있다.
- `plain`: `code_challenge = code_verifier` (해시 없음, 보안상 비권장)
- `S256`: `code_challenge = BASE64URL(SHA256(code_verifier))` (권장)

---

## OpenID Connect 심화

### ID Token 구조 상세

ID Token은 OIDC의 핵심 산출물로, 사용자의 인증 정보를 담고 있는 JWT이다. OpenID Connect Core 1.0 사양에 정의된 모든 표준 claim은 다음과 같다.

| Claim | 필수 여부 | 설명 |
|-------|---------|------|
| `iss` | 필수 | 토큰 발급자 URL이다. Keycloak에서는 `https://{host}/realms/{realm}` 형식이다 |
| `sub` | 필수 | 사용자 고유 식별자이다. Keycloak에서는 UUID 형식이다 |
| `aud` | 필수 | 토큰의 대상(audience)이다. `client_id`가 포함되어야 한다. 배열 형태일 수 있다 |
| `exp` | 필수 | 토큰 만료 시각이다 (Unix timestamp) |
| `iat` | 필수 | 토큰 발급 시각이다 (Unix timestamp) |
| `auth_time` | 조건부 | 사용자가 실제로 인증한 시각이다. `max_age` 요청 시 또는 `auth_time` claim이 설정된 경우 필수이다 |
| `nonce` | 조건부 | Replay 공격 방지를 위한 값이다. 인증 요청에 `nonce`가 포함된 경우 필수이다 |
| `acr` | 선택 | Authentication Context Class Reference이다. 인증 강도를 나타낸다 (0: 비밀번호, 1: MFA 등) |
| `amr` | 선택 | Authentication Methods References이다. 사용된 인증 방법의 배열이다 (예: `["pwd", "otp"]`) |
| `azp` | 선택 | Authorized Party이다. `aud`에 여러 값이 있을 때, 토큰을 요청한 클라이언트를 나타낸다 |
| `at_hash` | 선택 | Access Token 해시이다. ID Token과 Access Token의 바인딩을 검증하는 데 사용한다 |
| `c_hash` | 선택 | Authorization Code 해시이다. Hybrid Flow에서 코드 바인딩을 검증한다 |
| `s_hash` | 선택 | State 해시이다. state 파라미터의 무결성을 검증한다 |
| `sid` | 선택 | Session ID이다. Back-Channel Logout에서 세션을 식별하는 데 사용한다 |

Profile Scope의 claim:
| Claim | 설명 |
|-------|------|
| `name` | 사용자 전체 이름이다 |
| `given_name` | 이름(First Name)이다 |
| `family_name` | 성(Last Name)이다 |
| `middle_name` | 중간 이름이다 |
| `nickname` | 별명이다 |
| `preferred_username` | 선호하는 사용자명이다. Keycloak에서는 `username`이다 |
| `profile` | 프로필 URL이다 |
| `picture` | 프로필 사진 URL이다 |
| `website` | 웹사이트 URL이다 |
| `gender` | 성별이다 |
| `birthdate` | 생년월일이다 (YYYY-MM-DD 형식) |
| `zoneinfo` | 시간대이다 (예: "Asia/Seoul") |
| `locale` | 로케일이다 (예: "ko-KR") |
| `updated_at` | 프로필 최종 업데이트 시각이다 (Unix timestamp) |

### UserInfo Endpoint

UserInfo Endpoint는 Access Token을 사용하여 사용자 정보를 조회하는 OIDC 표준 엔드포인트이다. ID Token에 포함되지 않은 추가 사용자 정보를 조회할 수 있다.

```bash
# UserInfo 조회
curl -H "Authorization: Bearer <access_token>" \
  "http://localhost:8080/realms/demo-realm/protocol/openid-connect/userinfo"
```

응답 예시:
```json
{
  "sub": "f4a2e6b8-1234-5678-9abc-def012345678",
  "email_verified": true,
  "name": "홍길동",
  "preferred_username": "testuser",
  "given_name": "길동",
  "family_name": "홍",
  "email": "test@example.com"
}
```

UserInfo Endpoint와 ID Token의 차이:
- ID Token은 인증 시점에 한 번 발급되며, 이후 사용자 정보가 변경되어도 갱신되지 않는다
- UserInfo Endpoint는 호출 시점의 최신 사용자 정보를 반환한다
- UserInfo 응답은 서명되지 않은 JSON이 기본이다 (설정에 따라 JWT로 반환 가능)

### OIDC Discovery

OIDC Discovery는 클라이언트가 OpenID Provider의 설정 정보를 자동으로 발견할 수 있게 하는 메커니즘이다. `/.well-known/openid-configuration` 엔드포인트에서 JSON 형식으로 모든 설정 정보를 제공한다.

```bash
curl -s "http://localhost:8080/realms/demo-realm/.well-known/openid-configuration" | jq .
```

응답에 포함되는 주요 필드:
```json
{
  "issuer": "http://localhost:8080/realms/demo-realm",
  "authorization_endpoint": "http://localhost:8080/realms/demo-realm/protocol/openid-connect/auth",
  "token_endpoint": "http://localhost:8080/realms/demo-realm/protocol/openid-connect/token",
  "userinfo_endpoint": "http://localhost:8080/realms/demo-realm/protocol/openid-connect/userinfo",
  "jwks_uri": "http://localhost:8080/realms/demo-realm/protocol/openid-connect/certs",
  "end_session_endpoint": "http://localhost:8080/realms/demo-realm/protocol/openid-connect/logout",
  "introspection_endpoint": "http://localhost:8080/realms/demo-realm/protocol/openid-connect/token/introspect",
  "revocation_endpoint": "http://localhost:8080/realms/demo-realm/protocol/openid-connect/revoke",
  "device_authorization_endpoint": "http://localhost:8080/realms/demo-realm/protocol/openid-connect/auth/device",
  "registration_endpoint": "http://localhost:8080/realms/demo-realm/clients-registrations/openid-connect",
  "token_endpoint_auth_methods_supported": [
    "client_secret_basic",
    "client_secret_post",
    "private_key_jwt",
    "client_secret_jwt"
  ],
  "grant_types_supported": [
    "authorization_code",
    "implicit",
    "refresh_token",
    "password",
    "client_credentials",
    "urn:ietf:params:oauth:grant-type:device_code",
    "urn:ietf:params:oauth:grant-type:token-exchange"
  ],
  "response_types_supported": [
    "code",
    "none",
    "id_token",
    "token",
    "id_token token",
    "code id_token",
    "code token",
    "code id_token token"
  ],
  "subject_types_supported": ["public", "pairwise"],
  "id_token_signing_alg_values_supported": ["PS384", "ES384", "RS384", "HS256", "HS512", "ES256", "RS256", "HS384", "ES512", "PS256", "PS512", "RS512"],
  "scopes_supported": ["openid", "profile", "email", "address", "phone", "offline_access", "roles", "web-origins", "microprofile-jwt", "acr"],
  "claims_supported": ["aud", "sub", "iss", "auth_time", "name", "given_name", "family_name", "preferred_username", "email", "acr"],
  "code_challenge_methods_supported": ["plain", "S256"],
  "backchannel_logout_supported": true,
  "backchannel_logout_session_supported": true
}
```

클라이언트 라이브러리(예: Spring Security, NextAuth.js)는 이 Discovery 엔드포인트를 사용하여 자동으로 OIDC Provider 설정을 구성한다. 따라서 클라이언트 측에서는 issuer URL만 설정하면 나머지 엔드포인트를 자동으로 발견한다.

### Dynamic Client Registration

Dynamic Client Registration은 클라이언트가 런타임에 자동으로 Keycloak에 등록되는 기능이다. 멀티테넌트 SaaS 환경에서 테넌트별 클라이언트를 자동 생성할 때 유용하다.

```bash
# 클라이언트 동적 등록 (Initial Access Token 필요)
curl -X POST "http://localhost:8080/realms/demo-realm/clients-registrations/openid-connect" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <initial-access-token>" \
  -d '{
    "client_name": "dynamic-app",
    "redirect_uris": ["https://dynamic-app.example.com/callback"],
    "grant_types": ["authorization_code", "refresh_token"],
    "response_types": ["code"],
    "token_endpoint_auth_method": "client_secret_basic"
  }'
```

응답에는 자동 생성된 `client_id`, `client_secret`, `registration_access_token` 등이 포함된다.

### Session Management

OIDC는 세션 관리를 위한 여러 표준을 정의한다.

#### RP-Initiated Logout (OpenID Connect RP-Initiated Logout 1.0)

클라이언트(Relying Party)가 사용자 로그아웃을 시작하는 표준이다.

```
GET /realms/demo-realm/protocol/openid-connect/logout?
  id_token_hint=<id-token>
  &post_logout_redirect_uri=https://app.example.com
  &state=random-state
```

#### Back-Channel Logout (OpenID Connect Back-Channel Logout 1.0)

Keycloak이 서버 간(Back-Channel) HTTP 요청으로 클라이언트에 로그아웃을 알리는 방식이다. 사용자 브라우저를 경유하지 않으므로 신뢰성이 높다.

```
┌──────────┐          ┌──────────┐          ┌──────────┐
│  Client  │          │ Keycloak │          │  Client  │
│    A     │          │          │          │    B     │
└────┬─────┘          └────┬─────┘          └────┬─────┘
     │                     │                     │
     │ 1. 로그아웃 요청     │                     │
     │────────────────────►│                     │
     │                     │                     │
     │                     │ 2. Back-Channel      │
     │                     │    Logout Token      │
     │                     │    POST /backchannel │
     │                     │────────────────────►│
     │                     │                     │
     │                     │ 3. 200 OK            │
     │                     │◄────────────────────│
     │                     │                     │
     │ 4. 로그아웃 완료     │                     │
     │◄────────────────────│                     │
```

Back-Channel Logout Token은 JWT 형태이며, `events` claim에 `http://schemas.openid.net/event/backchannel-logout` 값이 포함된다. `sid`(Session ID) claim으로 어떤 세션을 종료해야 하는지 식별한다.

#### Front-Channel Logout (OpenID Connect Front-Channel Logout 1.0)

사용자 브라우저를 통해 각 클라이언트의 로그아웃 URL을 호출하는 방식이다. Keycloak 로그아웃 페이지에 각 클라이언트의 로그아웃 URL이 `<iframe>` 또는 이미지 태그로 포함된다. 브라우저 보안 정책(SameSite Cookie, Third-party Cookie 차단)에 의해 동작하지 않을 수 있으므로, Back-Channel Logout이 더 권장된다.

### OIDC Scopes 상세

| Scope | 포함 Claim | 설명 |
|-------|-----------|------|
| `openid` | `sub` | OIDC 요청의 필수 scope이다. 이 scope 없이는 OIDC 프로토콜이 아닌 순수 OAuth 2.0으로 동작한다 |
| `profile` | `name`, `family_name`, `given_name`, `middle_name`, `nickname`, `preferred_username`, `profile`, `picture`, `website`, `gender`, `birthdate`, `zoneinfo`, `locale`, `updated_at` | 사용자 프로필 정보이다 |
| `email` | `email`, `email_verified` | 사용자 이메일 정보이다 |
| `address` | `address` (JSON 객체: `formatted`, `street_address`, `locality`, `region`, `postal_code`, `country`) | 사용자 주소 정보이다 |
| `phone` | `phone_number`, `phone_number_verified` | 사용자 전화번호 정보이다 |
| `offline_access` | - | Refresh Token에 오프라인 접근 권한을 부여한다. Offline Session이 생성되며, 사용자가 로그아웃해도 Refresh Token이 유효하다 |

Keycloak 확장 scope:
| Scope | 설명 |
|-------|------|
| `roles` | `realm_access.roles`, `resource_access.{client}.roles` claim이 포함된다 |
| `web-origins` | CORS 허용 origin 목록이 `allowed-origins` claim에 포함된다 |
| `microprofile-jwt` | MicroProfile JWT 호환 토큰을 생성한다. `upn`, `groups` claim이 포함된다 |
| `acr` | Authentication Context Class Reference를 토큰에 포함한다 |

---

## JWT/JWK 심화

### JWT 구조: Header, Payload, Signature 각 필드 상세

JWT는 점(`.`)으로 구분된 세 부분으로 구성된다.

```
eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6ImFiYzEyMyJ9.
eyJpc3MiOiJodHRwczovL2F1dGguZXhhbXBsZS5jb20iLCJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6Iu2Zjeq4uOuPmSJ9.
signature_bytes_here

│               Header               │           Payload            │  Signature  │
│         BASE64URL 인코딩             │      BASE64URL 인코딩         │ 바이너리     │
```

#### Header 필드 상세

| 필드 | 필수 | 설명 |
|------|------|------|
| `alg` | 필수 | 서명 알고리즘이다. `RS256`, `ES256`, `PS256`, `HS256`, `none` 등이 있다 |
| `typ` | 선택 | 토큰 타입이다. 보통 `JWT`이다. OIDC에서는 `at+jwt`(Access Token)도 사용한다 |
| `kid` | 선택 | Key ID이다. JWKS에서 서명 검증에 사용할 키를 식별한다 |
| `jku` | 선택 | JWK Set URL이다. 서명 키를 찾을 수 있는 URL을 가리킨다 (보안상 사용 자제) |
| `x5u` | 선택 | X.509 인증서 URL이다 |
| `x5c` | 선택 | X.509 인증서 체인이다 |
| `x5t` | 선택 | X.509 인증서 SHA-1 Thumbprint이다 |
| `x5t#S256` | 선택 | X.509 인증서 SHA-256 Thumbprint이다 |
| `cty` | 선택 | Content Type이다. 중첩 JWT에서 `JWT`로 설정한다 |

#### Payload 필드 (Registered Claims) 상세

| Claim | 약어 의미 | 설명 |
|-------|---------|------|
| `iss` | Issuer | 토큰 발급자 식별자이다. URL 형태이다 |
| `sub` | Subject | 토큰의 주체(사용자) 식별자이다 |
| `aud` | Audience | 토큰의 수신자(대상)이다. 문자열 또는 배열이다 |
| `exp` | Expiration Time | 만료 시각이다 (NumericDate, 초 단위 Unix timestamp) |
| `nbf` | Not Before | 이 시각 이전에는 토큰이 유효하지 않다 |
| `iat` | Issued At | 토큰 발급 시각이다 |
| `jti` | JWT ID | 토큰의 고유 식별자이다. Replay 공격 방지에 사용한다 |

#### Signature 계산 과정

```
// RS256 서명 과정
input = BASE64URL(header) + "." + BASE64URL(payload)
signature = RSA_SHA256_SIGN(input, privateKey)
jwt = input + "." + BASE64URL(signature)

// RS256 검증 과정
input = BASE64URL(header) + "." + BASE64URL(payload)
isValid = RSA_SHA256_VERIFY(input, BASE64URL_DECODE(signature), publicKey)
```

### JWS (JSON Web Signature) vs JWE (JSON Web Encryption)

JWT는 실제로 JWS 또는 JWE를 사용하여 보안을 제공한다.

| 특성 | JWS (서명) | JWE (암호화) |
|------|----------|------------|
| 목적 | 무결성 검증 + 발급자 인증 | 기밀성 (내용 숨김) |
| 구조 | 3파트 (Header.Payload.Signature) | 5파트 (Header.EncKey.IV.Ciphertext.Tag) |
| 페이로드 | 누구나 디코딩 가능 (BASE64URL) | 복호화 키 없이 열람 불가 |
| 사용 사례 | 대부분의 Access Token, ID Token | 민감 정보를 토큰에 포함할 때 |
| Keycloak 지원 | 기본 | 제한적 (커스텀 구현 필요) |

Keycloak은 기본적으로 JWS를 사용한다. 토큰의 payload는 BASE64URL 디코딩만으로 누구나 내용을 확인할 수 있다. 따라서 민감한 개인정보를 토큰에 직접 포함하는 것은 주의해야 한다.

JWE가 필요한 경우(예: 토큰 내용을 제3자로부터 숨겨야 하는 경우), Keycloak에서 커스텀 Protocol Mapper를 구현하거나 클라이언트 측에서 JWE 래핑을 추가할 수 있다.

### Algorithm 선택: RS256, ES256, PS256 비교

| 알고리즘 | 키 유형 | 키 크기 | 서명 크기 | 성능 (서명) | 성능 (검증) | 비고 |
|---------|--------|--------|----------|-----------|-----------|------|
| RS256 | RSA | 2048+ bit | 256 bytes | 느림 | 보통 | 가장 널리 사용된다. Keycloak 기본값이다 |
| RS384 | RSA | 2048+ bit | 384 bytes | 느림 | 보통 | RS256보다 더 강한 해시이다 |
| RS512 | RSA | 2048+ bit | 512 bytes | 느림 | 보통 | 가장 강한 RSA 서명이다 |
| ES256 | ECDSA (P-256) | 256 bit | 64 bytes | 빠름 | 빠름 | 작은 키/서명 크기이다. 모바일에 유리하다 |
| ES384 | ECDSA (P-384) | 384 bit | 96 bytes | 빠름 | 빠름 | ES256보다 강하다 |
| ES512 | ECDSA (P-521) | 521 bit | 132 bytes | 빠름 | 빠름 | 가장 강한 ECDSA이다 |
| PS256 | RSA-PSS | 2048+ bit | 256 bytes | 느림 | 보통 | PKCS#1 v2.1 패딩이다. RS256보다 안전하다 |
| HS256 | HMAC | 256+ bit | 32 bytes | 매우 빠름 | 매우 빠름 | 대칭키이다. 발급자와 검증자가 같은 키를 공유해야 한다 |

Keycloak에서 Realm의 Key Provider를 통해 서명 알고리즘을 설정할 수 있다. Admin Console의 Realm Settings > Keys 메뉴에서 확인 가능하다.

권장 사항:
- 새 프로젝트에서는 **ES256**을 권장한다. 성능이 좋고 키/서명 크기가 작다
- 호환성이 중요한 경우 **RS256**을 사용한다 (모든 라이브러리가 지원)
- **HS256은 사용하지 않는 것을 권장한다**. 대칭키이므로 클라이언트가 서명을 위조할 수 있다

### JWKS (JSON Web Key Set) 엔드포인트와 Key Rotation

JWKS 엔드포인트는 토큰 서명 검증에 필요한 공개키를 JSON 형태로 제공한다.

```bash
curl -s "http://localhost:8080/realms/demo-realm/protocol/openid-connect/certs" | jq .
```

응답 예시:
```json
{
  "keys": [
    {
      "kid": "abc123-current-key",
      "kty": "RSA",
      "alg": "RS256",
      "use": "sig",
      "n": "0vx7agoebGcQSuuPiLJXZptN9nndrQmbXEps2aiAFbWhM...",
      "e": "AQAB",
      "x5c": ["MIICmzCCAYMCBgF..."],
      "x5t": "NjVBRjY5MDlCMUIw...",
      "x5t#S256": "fUHyO2r2Z3DZ53E..."
    },
    {
      "kid": "def456-previous-key",
      "kty": "RSA",
      "alg": "RS256",
      "use": "sig",
      "n": "1bUAdpYvd7dnTT1vEMIwK...",
      "e": "AQAB"
    }
  ]
}
```

JWK 필드 설명:
| 필드 | 설명 |
|------|------|
| `kid` | Key ID이다. JWT Header의 `kid`와 매칭하여 검증 키를 선택한다 |
| `kty` | Key Type이다. `RSA`, `EC`, `oct` 등이다 |
| `alg` | 사용 알고리즘이다 |
| `use` | 용도이다. `sig`(서명) 또는 `enc`(암호화)이다 |
| `n` | RSA 모듈러스이다 (BASE64URL 인코딩) |
| `e` | RSA 공개 지수이다 (보통 `AQAB` = 65537) |
| `x`, `y` | ECDSA 곡선 좌표이다 (EC 키인 경우) |
| `crv` | ECDSA 곡선 이름이다 (예: `P-256`) |

#### Key Rotation

Key Rotation은 주기적으로 서명 키를 교체하는 보안 관행이다. Keycloak은 내장 Key Rotation을 지원한다.

Rotation 과정:
1. 새로운 키 쌍(Private/Public Key)을 생성한다
2. 새 키를 Active 상태로 설정한다. 이후 발급되는 토큰은 새 키로 서명된다
3. 이전 키를 Passive 상태로 변경한다. 더 이상 새 토큰 서명에 사용하지 않지만, JWKS에는 여전히 포함되어 기존 토큰 검증이 가능하다
4. 충분한 시간이 지나면(기존 토큰이 모두 만료) 이전 키를 Disabled 상태로 변경한다

```
시간 →

Key A: [  Active  ][    Passive    ][ Disabled ]
Key B:              [    Active    ][   Passive   ][ Disabled ]
Key C:                               [   Active   ][  Passive  ]

JWKS 포함 키:
  t1: Key A
  t2: Key A, Key B
  t3: Key B, Key C
```

클라이언트(리소스 서버)는 JWKS 응답을 캐싱해야 하지만, `kid`가 캐시에 없는 경우 JWKS를 다시 조회해야 한다. 이를 통해 Key Rotation 시에도 서비스 중단 없이 검증이 가능하다.

### JWT 검증 흐름 상세

리소스 서버에서 JWT Access Token을 검증하는 전체 흐름은 다음과 같다.

```
Access Token 수신
       │
       ▼
1. JWT 형식 검증 (3파트, BASE64URL 디코딩 가능?)
       │
       ▼
2. Header 파싱 → kid, alg 추출
       │
       ▼
3. JWKS 캐시에서 kid로 공개키 검색
       │
   키 없음? ──► JWKS 엔드포인트 재조회 → 캐시 갱신
       │
       ▼
4. Signature 검증 (공개키로 서명 확인)
       │
   실패? ──► 401 Unauthorized (invalid_token)
       │
       ▼
5. exp 검증 (현재 시각 < exp?)
       │
   만료? ──► 401 Unauthorized (token_expired)
       │
       ▼
6. nbf 검증 (현재 시각 >= nbf?)
       │
   미도달? ──► 401 Unauthorized
       │
       ▼
7. iss 검증 (신뢰할 수 있는 발급자인가?)
       │
   불일치? ──► 401 Unauthorized
       │
       ▼
8. aud 검증 (이 리소스 서버가 대상에 포함되는가?)
       │
   불일치? ──► 403 Forbidden
       │
       ▼
9. 토큰 유효! → 요청 처리 (claim 기반 인가)
```

### Claim 매핑과 커스텀 Claim

Keycloak의 Protocol Mapper를 사용하면 토큰에 포함되는 claim을 자유롭게 커스터마이징할 수 있다.

커스텀 claim 추가 예시 (Admin Console):

1. Clients > demo-app > Client scopes > dedicated 탭 클릭
2. "Add mapper" > "By configuration" 선택
3. 매퍼 유형 선택:
   - **User Attribute**: 사용자의 커스텀 속성을 claim으로 매핑
   - **User Property**: 사용자의 기본 속성(username, email 등)을 매핑
   - **User Realm Role**: Realm 역할을 claim으로 매핑
   - **User Client Role**: Client 역할을 claim으로 매핑
   - **Group Membership**: 사용자의 그룹 정보를 claim으로 매핑
   - **Hardcoded Claim**: 고정 값을 claim으로 추가
   - **JavaScript Mapper**: 커스텀 JavaScript로 claim 값을 생성

User Attribute Mapper 설정 예시:
```
Name: department-mapper
User Attribute: department
Token Claim Name: department
Claim JSON Type: String
Add to ID token: ON
Add to access token: ON
Add to userinfo: ON
```

결과 토큰:
```json
{
  "sub": "...",
  "name": "홍길동",
  "department": "Engineering",
  "custom_roles": ["developer", "reviewer"],
  ...
}
```

---

## Realm 구성 심화

### Realm vs Master Realm 차이

Keycloak에는 항상 `master` Realm이 존재한다. Master Realm과 일반 Realm의 차이는 다음과 같다.

| 항목 | Master Realm | 일반 Realm |
|------|-------------|-----------|
| 목적 | Keycloak 서버 전체 관리 전용이다 | 애플리케이션의 사용자/클라이언트 관리이다 |
| 관리자 | 슈퍼 관리자 (모든 Realm 관리 가능)이다 | 해당 Realm만 관리 가능한 관리자이다 |
| Client | `admin-cli`, `security-admin-console` 등 관리 클라이언트가 기본 포함된다 | 사용자 정의 클라이언트를 생성한다 |
| 사용자 등록 | 서비스 사용자를 등록하면 안 된다 | 서비스 사용자를 등록한다 |
| 삭제 | 삭제할 수 없다 | 삭제할 수 있다 |
| 보안 | 외부 노출을 최소화해야 한다 | 필요에 따라 외부에 노출한다 |

모범 사례:
- Master Realm은 Keycloak 관리 목적으로만 사용한다
- 애플리케이션별 또는 환경별(dev, staging, prod) Realm을 생성한다
- Master Realm의 admin 계정 비밀번호는 강력하게 설정하고, 가능하면 MFA를 적용한다

### Authentication Flow 커스터마이징

Authentication Flow는 사용자가 로그인할 때 거치는 인증 단계의 순서이다. Keycloak은 여러 빌트인 Flow를 제공하며, 커스터마이징도 가능하다.

기본 제공 Flow:
| Flow | 설명 |
|------|------|
| Browser Flow | 브라우저 기반 로그인이다. Cookie → Identity Provider Redirector → Username/Password → OTP 순서이다 |
| Direct Grant Flow | Resource Owner Password Credentials(ROPC)이다. API 기반 직접 인증이다 |
| Registration Flow | 사용자 자가 등록이다 |
| Reset Credentials Flow | 비밀번호 재설정이다 |
| First Broker Login Flow | 외부 IdP로 최초 로그인 시 실행된다 |
| Docker Auth Flow | Docker Registry 인증이다 |

커스텀 Flow 예시 - Conditional OTP:
```
Browser Flow (커스터마이징)
├── Cookie (Alternative)           → SSO 세션 쿠키가 있으면 패스
├── Kerberos (Disabled)            → 비활성
├── Identity Provider Redirector   → 외부 IdP 리다이렉트
└── Username Password Form (Required)
    └── Conditional OTP (Conditional)
        ├── Condition: User Configured  → 사용자가 OTP를 설정한 경우에만
        └── OTP Form (Required)         → OTP 입력 요구
```

WebAuthn(FIDO2) 인증을 추가하는 예시:
```
Browser Flow (커스터마이징)
├── Cookie (Alternative)
└── Authentication Options (Required)
    ├── Username Password Form (Alternative)
    └── WebAuthn Authenticator (Alternative)  → 생체 인증, 보안 키
```

### Required Actions

Required Action은 사용자가 로그인한 후 반드시 수행해야 하는 동작이다. 설정된 Required Action이 완료될 때까지 사용자는 애플리케이션에 접근할 수 없다.

| Required Action | 설명 |
|-----------------|------|
| `UPDATE_PASSWORD` | 비밀번호 변경을 요구한다. 관리자가 임시 비밀번호를 설정한 경우 사용한다 |
| `VERIFY_EMAIL` | 이메일 인증을 요구한다. 인증 링크가 포함된 이메일이 발송된다 |
| `CONFIGURE_TOTP` | TOTP 설정을 요구한다. Google Authenticator 등으로 OTP를 등록해야 한다 |
| `UPDATE_PROFILE` | 프로필 정보 업데이트를 요구한다 |
| `TERMS_AND_CONDITIONS` | 이용약관 동의를 요구한다 |
| `CONFIGURE_RECOVERY_AUTHN_CODES` | 복구 인증 코드 설정을 요구한다 |
| `UPDATE_EMAIL` | 이메일 주소 업데이트를 요구한다 |
| `WEBAUTHN_REGISTER` | WebAuthn(FIDO2) 기기 등록을 요구한다 |

커스텀 Required Action SPI를 구현하면, 약관 동의, 추가 정보 입력 등 사용자 정의 동작을 추가할 수 있다.

### Brute Force Detection 설정

Brute Force Detection은 반복적인 로그인 시도를 감지하고 차단하는 보안 기능이다. Realm Settings > Security Defenses에서 설정한다.

| 설정 항목 | 기본값 | 설명 |
|-----------|--------|------|
| Enabled | false | Brute Force Detection 활성화 여부이다 |
| Permanent Lockout | false | true이면 관리자가 수동 해제할 때까지 영구 잠금된다 |
| Max Login Failures | 30 | 잠금 전 최대 로그인 실패 횟수이다 |
| Wait Increment (초) | 60 | 잠금 시간의 증가 단위이다 |
| Quick Login Check (밀리초) | 1000 | 이 시간 내 연속 실패 시 빠른 잠금이 적용된다 |
| Minimum Quick Login Wait (초) | 60 | 빠른 잠금 시 최소 대기 시간이다 |
| Max Wait (초) | 900 | 최대 잠금 시간이다 (15분) |
| Failure Reset Time (초) | 43200 | 실패 카운터 리셋 시간이다 (12시간) |

점진적 잠금 예시:
```
실패 1~29회: 정상 로그인 시도 가능
실패 30회: 60초 잠금
실패 31회: 120초 잠금
실패 32회: 180초 잠금
...
최대 900초(15분) 잠금
```

### Password Policy

Password Policy는 사용자 비밀번호의 최소 요구사항을 정의한다. Realm Settings > Authentication > Password Policy에서 설정한다.

| 정책 | 설정값 예시 | 설명 |
|------|-----------|------|
| `length` | 8 | 최소 비밀번호 길이이다 |
| `digits` | 1 | 최소 숫자 포함 개수이다 |
| `upperCase` | 1 | 최소 대문자 포함 개수이다 |
| `lowerCase` | 1 | 최소 소문자 포함 개수이다 |
| `specialChars` | 1 | 최소 특수문자 포함 개수이다 |
| `notUsername` | - | 사용자명과 동일한 비밀번호를 금지한다 |
| `notEmail` | - | 이메일과 동일한 비밀번호를 금지한다 |
| `passwordHistory` | 3 | 최근 N개의 비밀번호 재사용을 금지한다 |
| `hashIterations` | 210000 | 비밀번호 해시 반복 횟수이다. 값이 클수록 안전하지만 느리다 |
| `hashAlgorithm` | pbkdf2-sha512 | 해시 알고리즘이다. `pbkdf2-sha256`, `pbkdf2-sha512`, `argon2` 등이다 |
| `maxLength` | 64 | 최대 비밀번호 길이이다 |
| `regexPattern` | `^(?=.*[!@#$%]).*$` | 정규표현식 패턴으로 비밀번호를 검증한다 |
| `forceExpiredPasswordChange` | 90 | N일 후 비밀번호 변경을 강제한다 |

프로덕션 환경 권장 설정:
```
length: 12
digits: 1
upperCase: 1
lowerCase: 1
specialChars: 1
notUsername: true
notEmail: true
passwordHistory: 5
hashAlgorithm: pbkdf2-sha512
hashIterations: 210000
```

### User Profile 커스터마이징

Keycloak은 사용자 프로필 속성을 유연하게 커스터마이징할 수 있다. Realm Settings > User Profile에서 설정한다.

기본 속성 외에 커스텀 속성을 추가할 수 있다.

```json
{
  "attributes": [
    {
      "name": "department",
      "displayName": "부서",
      "validations": {
        "length": { "min": 1, "max": 50 }
      },
      "permissions": {
        "view": ["admin", "user"],
        "edit": ["admin"]
      },
      "annotations": {
        "inputType": "select",
        "inputOptionLabels": {
          "engineering": "엔지니어링",
          "sales": "영업",
          "marketing": "마케팅"
        }
      },
      "required": {
        "roles": ["user"]
      }
    },
    {
      "name": "employeeId",
      "displayName": "사원번호",
      "validations": {
        "pattern": { "pattern": "^EMP-[0-9]{6}$", "error-message": "EMP-XXXXXX 형식이어야 합니다" }
      },
      "permissions": {
        "view": ["admin", "user"],
        "edit": ["admin"]
      }
    }
  ],
  "groups": [
    {
      "name": "company-info",
      "displayHeader": "회사 정보",
      "displayDescription": "회사 관련 정보를 입력하세요"
    }
  ]
}
```

---

## Client 구성 심화

### Client Types: confidential, public, bearer-only

각 Client Type의 상세한 차이와 설정을 기술한다.

#### Confidential Client

서버 측에서 안전하게 client_secret을 보관할 수 있는 애플리케이션이다.

설정:
```
Client authentication: ON
Authorization: 선택적 (Fine-grained authorization 사용 시)
Standard flow: ON (Authorization Code Flow)
Direct access grants: 선택적
Service accounts roles: 선택적 (Client Credentials Flow 사용 시)
```

인증 방식:
- `client_secret_basic`: Authorization 헤더에 BASE64(client_id:client_secret)을 전송한다
- `client_secret_post`: 요청 본문에 client_id, client_secret을 포함한다
- `private_key_jwt`: 클라이언트가 자체 키로 서명한 JWT로 인증한다

#### Public Client

client_secret을 안전하게 보관할 수 없는 클라이언트(SPA, 모바일 앱)이다. PKCE를 반드시 사용해야 한다.

설정:
```
Client authentication: OFF
Standard flow: ON
Direct access grants: OFF (권장)
```

#### Bearer-only Client (Deprecated)

Keycloak 최신 버전에서는 bearer-only 유형이 공식적으로 더 이상 사용되지 않는다. 대신 리소스 서버는 단순히 Access Token을 검증하는 역할만 수행하도록 구성한다. JWKS 엔드포인트를 통해 서명을 검증하거나, Token Introspection을 사용한다.

### Client Scopes: default vs optional

| 유형 | 설명 | 동작 |
|------|------|------|
| Default Client Scope | 클라이언트의 모든 토큰 요청에 자동으로 포함된다 | `scope` 파라미터와 무관하게 항상 적용된다 |
| Optional Client Scope | 요청 시 `scope` 파라미터에 명시적으로 포함해야 적용된다 | `scope=openid phone`처럼 지정한다 |

Keycloak에서 Client Scope는 Protocol Mapper의 묶음이다. 동일한 claim 설정을 여러 Client에서 재사용할 수 있다.

```
Client: demo-app
├── Default Scopes
│   ├── openid        → sub, iss, aud 등 기본 claim
│   ├── profile       → name, given_name 등
│   ├── email         → email, email_verified
│   ├── roles         → realm_access, resource_access
│   └── web-origins   → allowed-origins
└── Optional Scopes
    ├── phone         → phone_number
    ├── address       → address
    └── offline_access → 오프라인 세션 생성
```

### Protocol Mappers 상세

Protocol Mapper는 토큰에 포함될 claim을 정의하는 핵심 설정이다.

| Mapper 유형 | 설명 | 주요 설정 |
|-------------|------|-----------|
| User Attribute | 사용자의 커스텀 속성을 매핑한다 | User Attribute, Token Claim Name |
| User Property | 사용자의 기본 속성(username, email 등)을 매핑한다 | Property, Token Claim Name |
| User Realm Role | Realm 역할을 매핑한다 | Token Claim Name, Prefix |
| User Client Role | 특정 Client의 역할을 매핑한다 | Client ID, Token Claim Name |
| Group Membership | 사용자의 그룹 목록을 매핑한다 | Token Claim Name, Full Group Path |
| Audience Resolve | `aud` claim에 Client ID를 추가한다 | (자동) |
| Hardcoded Claim | 고정 값을 claim으로 추가한다 | Claim Value, Token Claim Name |
| JavaScript Mapper | 커스텀 JavaScript로 claim 값을 계산한다 | Script |
| Pairwise Subject | `sub` claim을 Client별로 다른 값으로 생성한다 | Salt, Sector Identifier URI |

JavaScript Mapper 예시 (사용자의 나이를 계산하여 claim에 추가):
```javascript
// Script
var birthdate = user.getFirstAttribute('birthdate');
if (birthdate) {
    var birth = new Date(birthdate);
    var today = new Date();
    var age = today.getFullYear() - birth.getFullYear();
    exports = age;
} else {
    exports = null;
}
```

### Fine-Grained Authorization

Keycloak의 Authorization Services는 리소스 기반 세밀한 인가를 제공한다. UMA 2.0(User-Managed Access) 표준을 기반으로 한다.

Authorization Services 아키텍처:

```
┌──────────────────────────────────────────────────────────┐
│                  Authorization Server                     │
│                     (Keycloak)                            │
│                                                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐  │
│  │Resources │  │  Scopes  │  │ Policies │  │Permission│  │
│  │/api/docs │  │  read    │  │ Role:    │  │ docs:   │  │
│  │/api/users│  │  write   │  │  admin   │  │  read → │  │
│  │/api/proj │  │  delete  │  │ Time:    │  │  Role   │  │
│  │          │  │  manage  │  │  9-18시  │  │  Policy │  │
│  └──────────┘  └──────────┘  └──────────┘  └─────────┘  │
└──────────────────────────────────────────────────────────┘
```

실제 설정 예시:

1. Resource 정의:
```json
{
  "name": "Document Resource",
  "type": "urn:demo-app:resources:document",
  "uris": ["/api/documents/*"],
  "scopes": [
    { "name": "read" },
    { "name": "write" },
    { "name": "delete" }
  ]
}
```

2. Policy 정의:
```json
{
  "name": "Admin Policy",
  "type": "role",
  "logic": "POSITIVE",
  "roles": [{ "id": "app-admin", "required": true }]
}
```

```json
{
  "name": "Business Hours Policy",
  "type": "time",
  "notBefore": "2024-01-01 00:00:00",
  "dayMonth": "*",
  "hour": 9,
  "hourEnd": 18
}
```

3. Permission 정의:
```json
{
  "name": "Document Write Permission",
  "type": "scope",
  "resources": ["Document Resource"],
  "scopes": ["write"],
  "policies": ["Admin Policy", "Business Hours Policy"],
  "decisionStrategy": "UNANIMOUS"
}
```

### UMA 2.0 (User-Managed Access)

UMA 2.0은 리소스 소유자가 다른 사용자에게 리소스 접근 권한을 직접 위임할 수 있는 표준이다. 예를 들어, 사용자 A가 자신의 문서를 사용자 B에게 공유하는 시나리오에서 사용한다.

UMA 2.0 흐름:
```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│ Resource │     │ Resource │     │ Keycloak │     │Requesting│
│  Owner   │     │  Server  │     │  (AuthZ) │     │  Party   │
└────┬─────┘     └────┬─────┘     └────┬─────┘     └────┬─────┘
     │                │                │                  │
     │ 1. 리소스 등록  │                │                  │
     │───────────────►│──register────►│                  │
     │                │                │                  │
     │ 2. 권한 설정    │                │                  │
     │  (사용자B에게   │                │                  │
     │   read 허용)   │                │                  │
     │───────────────────────────────►│                  │
     │                │                │                  │
     │                │                │  3. 리소스 접근    │
     │                │◄───────────────────────────────────│
     │                │                │                  │
     │                │ 4. Permission  │                  │
     │                │    Ticket 발급 │                  │
     │                │───────────────►│                  │
     │                │◄───────────────│                  │
     │                │ 5. 401 +       │                  │
     │                │ Permission     │                  │
     │                │ Ticket         │                  │
     │                │───────────────────────────────────►│
     │                │                │                  │
     │                │                │ 6. RPT 요청       │
     │                │                │  (Ticket 포함)    │
     │                │                │◄──────────────────│
     │                │                │                  │
     │                │                │ 7. RPT 발급      │
     │                │                │──────────────────►│
     │                │                │                  │
     │                │                │  8. RPT로 재요청  │
     │                │◄───────────────────────────────────│
     │                │                │                  │
     │                │ 9. 리소스 응답  │                  │
     │                │───────────────────────────────────►│
```

### Client Authentication 방식

| 방식 | 설명 | 보안 수준 |
|------|------|----------|
| `client_secret_basic` | HTTP Basic 인증 헤더에 client_id:client_secret을 BASE64 인코딩하여 전송한다 | 중간 |
| `client_secret_post` | 요청 본문(body)에 client_id와 client_secret을 포함한다 | 중간 |
| `private_key_jwt` | 클라이언트가 자체 개인키로 서명한 JWT를 `client_assertion`으로 전송한다. 가장 안전하다 | 높음 |
| `client_secret_jwt` | 공유 비밀(client_secret)로 서명한 JWT를 `client_assertion`으로 전송한다 | 중간-높음 |
| `tls_client_auth` | mTLS(Mutual TLS)로 클라이언트 인증서를 검증한다 | 높음 |

`private_key_jwt` 인증 예시:
```bash
# 클라이언트가 JWT assertion 생성 후 전송
curl -X POST "http://localhost:8080/realms/demo-realm/protocol/openid-connect/token" \
  -d "grant_type=client_credentials" \
  -d "client_id=demo-app" \
  -d "client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer" \
  -d "client_assertion=<signed-jwt>"
```

### CORS 설정

Keycloak Client에서 CORS(Cross-Origin Resource Sharing) 설정은 "Web Origins" 필드에서 관리한다.

| 설정 | 의미 |
|------|------|
| `+` | Valid Redirect URIs에서 origin을 자동 추출한다 |
| `*` | 모든 origin을 허용한다 (개발 환경에서만 사용) |
| `https://app.example.com` | 특정 origin만 허용한다 |

CORS가 올바르게 설정되면, Keycloak 응답에 `Access-Control-Allow-Origin` 헤더가 포함된다. 또한 `web-origins` scope를 통해 Access Token에 `allowed-origins` claim이 추가된다.

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

## 트러블슈팅

### 일반적인 로그인 오류

| 에러 코드 | 원인 | 해결 방법 |
|----------|------|-----------|
| `invalid_grant` | 잘못된 인증 코드, 만료된 코드, 잘못된 사용자 자격 증명이다 | 인증 코드가 일회용이며 만료 전에 사용되었는지 확인한다. redirect_uri가 정확히 일치하는지 확인한다 |
| `invalid_client` | 잘못된 client_id 또는 client_secret이다 | Client 설정을 확인하고, client_secret이 올바른지 확인한다 |
| `unauthorized_client` | 해당 Client에서 허용되지 않은 grant_type을 사용했다 | Client 설정에서 해당 grant type이 활성화되어 있는지 확인한다 |
| `invalid_scope` | 요청한 scope가 Client에 등록되지 않았다 | Client Scopes 설정을 확인한다 |
| `invalid_redirect_uri` | redirect_uri가 등록된 URI와 일치하지 않는다 | Valid Redirect URIs 설정을 확인한다. 정확한 URI 매칭이 필요하다 |
| `account_disabled` | 사용자 계정이 비활성화되었다 | Admin Console에서 사용자의 Enabled 상태를 확인한다 |
| `account_temporarily_disabled` | Brute Force Detection에 의해 임시 잠금되었다 | 잠금 시간이 경과하거나, 관리자가 수동 해제한다 |
| `user_not_found` | 사용자가 존재하지 않는다 | 사용자명/이메일이 올바른지, 해당 Realm에 사용자가 존재하는지 확인한다 |
| `expired_code` | Authorization Code가 만료되었다 | 코드 발급 후 빠르게 토큰 교환을 수행한다 (기본 60초) |
| `invalid_token` | 토큰이 유효하지 않다 (서명 불일치, 형식 오류) | 토큰의 발급자(iss)와 JWKS 엔드포인트를 확인한다 |

### Token 디버깅

#### jwt.io를 사용한 디버깅

[https://jwt.io](https://jwt.io)에 JWT 토큰을 붙여넣으면 Header, Payload, Signature를 시각적으로 확인할 수 있다.

주의: 프로덕션 토큰은 jwt.io에 붙여넣지 않는다 (토큰 유출 위험).

#### jq를 사용한 커맨드라인 디버깅

```bash
# JWT 토큰의 Payload 디코딩 (3번째 부분은 서명이므로 2번째 부분만 디코딩)
echo $ACCESS_TOKEN | cut -d'.' -f2 | base64 -d 2>/dev/null | jq .

# Header 디코딩
echo $ACCESS_TOKEN | cut -d'.' -f1 | base64 -d 2>/dev/null | jq .

# 토큰 만료 시각 확인 (사람이 읽을 수 있는 형식)
echo $ACCESS_TOKEN | cut -d'.' -f2 | base64 -d 2>/dev/null | \
  jq -r '.exp | todate'

# 토큰 남은 유효 시간 확인
echo $ACCESS_TOKEN | cut -d'.' -f2 | base64 -d 2>/dev/null | \
  jq -r '(.exp - now) | floor | tostring + " seconds remaining"'

# 토큰에 포함된 역할 확인
echo $ACCESS_TOKEN | cut -d'.' -f2 | base64 -d 2>/dev/null | \
  jq '.realm_access.roles'
```

#### step CLI를 사용한 JWT 검증

```bash
# step CLI 설치 (macOS)
brew install step

# JWT 검증 (JWKS endpoint 사용)
echo $ACCESS_TOKEN | step crypto jwt verify \
  --jwks="http://localhost:8080/realms/demo-realm/protocol/openid-connect/certs" \
  --iss="http://localhost:8080/realms/demo-realm" \
  --aud="demo-app"

# JWT 내용만 출력 (검증 없이)
echo $ACCESS_TOKEN | step crypto jwt inspect --insecure
```

### 세션 만료 문제

증상: 사용자가 예상보다 빨리 로그아웃된다.

확인 항목:
1. SSO Session Idle 값이 적절한지 확인한다 (기본 30분)
2. SSO Session Max 값이 적절한지 확인한다 (기본 10시간)
3. Access Token Lifespan이 너무 짧지 않은지 확인한다
4. Client의 세션 설정이 Realm 설정을 오버라이드하고 있지 않은지 확인한다
5. 로드밸런서의 sticky session이 설정되어 있는지 확인한다 (HA 환경)

```bash
# Admin REST API로 활성 세션 조회
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:8080/admin/realms/demo-realm/users/<user-id>/sessions" | jq .

# 특정 세션의 상세 정보
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:8080/admin/realms/demo-realm/sessions/<session-id>" | jq .
```

### DB 연결 문제

증상: Keycloak이 시작되지 않거나, 간헐적으로 에러가 발생한다.

확인 항목:
1. DB 연결 URL, 사용자명, 비밀번호가 올바른지 확인한다
2. DB 서버가 접근 가능한지 확인한다 (네트워크, 방화벽)
3. Connection Pool 설정이 적절한지 확인한다

```bash
# DB 연결 테스트
kubectl exec -it keycloak-0 -n keycloak -- \
  /bin/bash -c "curl -v telnet://postgres:5432"

# Keycloak 로그에서 DB 관련 에러 확인
kubectl logs keycloak-0 -n keycloak | grep -i "database\|jdbc\|connection\|pool"

# DB 커넥션 풀 상태 확인 (메트릭 활성화 필요)
curl -s "http://localhost:8080/metrics" | grep "db_pool"
```

DB Connection Pool 최적화:
```properties
# keycloak.conf
db-pool-initial-size=5     # 초기 커넥션 수
db-pool-min-size=5         # 최소 커넥션 수
db-pool-max-size=100       # 최대 커넥션 수 (동시 사용자 수에 비례)
```

### 성능 문제

증상: 로그인이 느리거나, 토큰 발급에 시간이 오래 걸린다.

확인 항목:

1. **세션 수 확인**: 활성 세션이 과도하지 않은지 확인한다
```bash
# Realm별 활성 세션 수 조회
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:8080/admin/realms/demo-realm" | jq '.activeSessions'
```

2. **캐시 히트율 확인**: Infinispan 캐시 통계를 확인한다
```bash
curl -s "http://localhost:8080/metrics" | grep "vendor_cache"
```

3. **DB 쿼리 성능**: slow query 로그를 활성화하여 병목을 식별한다

4. **JVM 메모리**: GC 빈도와 힙 사용량을 모니터링한다
```bash
# Keycloak JVM 메모리 옵션
JAVA_OPTS="-Xms512m -Xmx1024m -XX:+UseG1GC -XX:MaxGCPauseMillis=200"
```

5. **Infinispan 캐시 크기 조정**: 캐시 항목 수가 max-count에 도달하면 eviction이 발생하여 성능이 저하된다

성능 최적화 체크리스트:
- [ ] Access Token Lifespan을 적절히 설정했는가 (짧을수록 토큰 발급 요청 증가)
- [ ] Offline Session을 불필요하게 사용하지 않는가
- [ ] DB Connection Pool 크기가 적절한가
- [ ] Infinispan 캐시 max-count가 충분한가
- [ ] JVM 힙 크기가 적절한가 (최소 512MB, 권장 1GB+)
- [ ] 클러스터 환경에서 JGroups 통신이 원활한가

### Keycloak 로그 분석

Keycloak의 로그 레벨을 조정하여 문제를 진단할 수 있다.

```properties
# keycloak.conf
log=console
log-level=INFO

# 특정 카테고리만 DEBUG 레벨로 설정
log-level=INFO,org.keycloak.authentication:DEBUG,org.keycloak.broker:DEBUG

# 인증 흐름 디버깅
log-level=INFO,org.keycloak.authentication:TRACE

# LDAP 연동 디버깅
log-level=INFO,org.keycloak.storage.ldap:DEBUG

# 토큰 관련 디버깅
log-level=INFO,org.keycloak.protocol.oidc:DEBUG

# DB 쿼리 디버깅 (주의: 대량 로그 발생)
log-level=INFO,org.hibernate.SQL:DEBUG

# Infinispan 디버깅
log-level=INFO,org.infinispan:DEBUG
```

Kubernetes에서 로그 확인:
```bash
# 실시간 로그 확인
kubectl logs -f keycloak-0 -n keycloak

# 특정 패턴 검색
kubectl logs keycloak-0 -n keycloak | grep -i "error\|exception\|failed"

# 이전 컨테이너 로그 (재시작된 경우)
kubectl logs keycloak-0 -n keycloak --previous
```

주요 로그 패턴:
```
# 인증 성공
type=LOGIN, realmId=demo-realm, userId=xxx, ipAddress=xxx

# 인증 실패
type=LOGIN_ERROR, realmId=demo-realm, error=invalid_user_credentials

# Brute Force 잠금
type=LOGIN_ERROR, error=user_temporarily_disabled

# 토큰 에러
type=CODE_TO_TOKEN_ERROR, error=invalid_code

# LDAP 연결 실패
Unable to connect to LDAP server
```

---

## 실습

### 실습 1: Keycloak 접속
```bash
# Keycloak Pod 확인
kubectl get pods -n demo -l app=keycloak

# Keycloak 포트포워딩
kubectl port-forward -n demo svc/keycloak 8080:8080

# 브라우저에서 http://localhost:8080 접속
# Administration Console 클릭
# 기본 계정: admin / admin
```

### 실습 2: Realm 및 Client 생성
```
1. Realm 생성:
   좌측 상단 드롭다운 > Create Realm
   Name: demo-realm

2. Client 생성:
   Clients > Create client
   Client ID: demo-app
   Client Protocol: openid-connect
   Access Type: confidential
   Valid Redirect URIs: http://localhost:3000/*

3. User 생성:
   Users > Add user
   Username: testuser
   Email: test@example.com
   Credentials 탭에서 비밀번호 설정

4. Role 생성:
   Realm roles > Create role
   Role name: app-admin

5. User에 Role 할당:
   Users > testuser > Role mapping > Assign role
```

### 실습 3: OIDC Discovery 및 JWKS 확인
```bash
# Well-Known Configuration 조회
curl -s http://localhost:8080/realms/demo-realm/.well-known/openid-configuration | jq .

# JWKS (공개키) 조회
curl -s http://localhost:8080/realms/demo-realm/protocol/openid-connect/certs | jq .
```

### 실습 4: 토큰 발급 테스트
```bash
# 토큰 발급 (Resource Owner Password Credentials)
curl -X POST http://localhost:8080/realms/demo-realm/protocol/openid-connect/token \
  -d "grant_type=password" \
  -d "client_id=demo-app" \
  -d "client_secret=<client-secret>" \
  -d "username=testuser" \
  -d "password=<password>" \
  -d "scope=openid profile email"

# 토큰 내용 확인 (JWT 디코딩)
# https://jwt.io 에서 Access Token 붙여넣기

# Client Credentials Flow 토큰 발급
curl -X POST http://localhost:8080/realms/demo-realm/protocol/openid-connect/token \
  -d "grant_type=client_credentials" \
  -d "client_id=demo-app" \
  -d "client_secret=<client-secret>"

# Refresh Token으로 Access Token 갱신
curl -X POST http://localhost:8080/realms/demo-realm/protocol/openid-connect/token \
  -d "grant_type=refresh_token" \
  -d "client_id=demo-app" \
  -d "client_secret=<client-secret>" \
  -d "refresh_token=<refresh_token>"

# 토큰으로 userinfo 조회
curl -H "Authorization: Bearer <access_token>" \
  http://localhost:8080/realms/demo-realm/protocol/openid-connect/userinfo

# 토큰 검증 (Introspection)
curl -X POST http://localhost:8080/realms/demo-realm/protocol/openid-connect/token/introspect \
  -d "token=<access_token>" \
  -d "client_id=demo-app" \
  -d "client_secret=<client-secret>"
```

### 실습 5: Keycloak 관리 API
```bash
# 관리자 토큰 발급
ADMIN_TOKEN=$(curl -s -X POST http://localhost:8080/realms/master/protocol/openid-connect/token \
  -d "grant_type=password" \
  -d "client_id=admin-cli" \
  -d "username=admin" \
  -d "password=admin" | jq -r '.access_token')

# 사용자 목록 조회
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:8080/admin/realms/demo-realm/users

# Realm 설정 조회
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:8080/admin/realms/demo-realm

# Client 목록 조회
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:8080/admin/realms/demo-realm/clients | jq '.[].clientId'

# 역할 목록 조회
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:8080/admin/realms/demo-realm/roles
```

### 실습 6: OIDC Discovery 엔드포인트 상세 조회

```bash
# Discovery 엔드포인트 전체 조회
DISCOVERY=$(curl -s http://localhost:8080/realms/demo-realm/.well-known/openid-configuration)

# 지원 grant_types 확인
echo $DISCOVERY | jq '.grant_types_supported'

# 지원 scopes 확인
echo $DISCOVERY | jq '.scopes_supported'

# 지원 서명 알고리즘 확인
echo $DISCOVERY | jq '.id_token_signing_alg_values_supported'

# 지원 인증 방식 확인
echo $DISCOVERY | jq '.token_endpoint_auth_methods_supported'

# 주요 엔드포인트 추출
echo $DISCOVERY | jq '{
  authorization_endpoint,
  token_endpoint,
  userinfo_endpoint,
  jwks_uri,
  introspection_endpoint,
  revocation_endpoint,
  end_session_endpoint
}'

# JWKS URI에서 공개키 목록 조회
JWKS_URI=$(echo $DISCOVERY | jq -r '.jwks_uri')
curl -s $JWKS_URI | jq '.keys[] | {kid, kty, alg, use}'
```

### 실습 7: Authorization Code + PKCE 토큰 발급 (curl)

```bash
# 1. code_verifier 생성 (43~128자 랜덤 문자열)
CODE_VERIFIER=$(openssl rand -base64 32 | tr -d '=+/' | head -c 43)
echo "code_verifier: $CODE_VERIFIER"

# 2. code_challenge 생성 (SHA256 해시 후 BASE64URL 인코딩)
CODE_CHALLENGE=$(echo -n $CODE_VERIFIER | openssl dgst -sha256 -binary | base64 | tr '+/' '-_' | tr -d '=')
echo "code_challenge: $CODE_CHALLENGE"

# 3. 브라우저에서 아래 URL로 접속 (로그인 수행)
echo "브라우저에서 접속할 URL:"
echo "http://localhost:8080/realms/demo-realm/protocol/openid-connect/auth?\
response_type=code&\
client_id=demo-app&\
redirect_uri=http://localhost:3000/callback&\
scope=openid%20profile%20email&\
state=random-state-value&\
code_challenge=$CODE_CHALLENGE&\
code_challenge_method=S256"

# 4. 콜백 URL에서 code 파라미터 추출 후 토큰 교환
AUTH_CODE="<콜백에서_받은_code>"
curl -X POST http://localhost:8080/realms/demo-realm/protocol/openid-connect/token \
  -d "grant_type=authorization_code" \
  -d "client_id=demo-app" \
  -d "client_secret=<client-secret>" \
  -d "code=$AUTH_CODE" \
  -d "redirect_uri=http://localhost:3000/callback" \
  -d "code_verifier=$CODE_VERIFIER" | jq .
```

### 실습 8: JWT 디코딩 및 검증

```bash
# 토큰 발급
TOKEN_RESPONSE=$(curl -s -X POST http://localhost:8080/realms/demo-realm/protocol/openid-connect/token \
  -d "grant_type=password" \
  -d "client_id=demo-app" \
  -d "client_secret=<client-secret>" \
  -d "username=testuser" \
  -d "password=<password>" \
  -d "scope=openid profile email")

ACCESS_TOKEN=$(echo $TOKEN_RESPONSE | jq -r '.access_token')
ID_TOKEN=$(echo $TOKEN_RESPONSE | jq -r '.id_token')
REFRESH_TOKEN=$(echo $TOKEN_RESPONSE | jq -r '.refresh_token')

# Access Token Header 디코딩
echo "=== Access Token Header ==="
echo $ACCESS_TOKEN | cut -d'.' -f1 | base64 -d 2>/dev/null | jq .

# Access Token Payload 디코딩
echo "=== Access Token Payload ==="
echo $ACCESS_TOKEN | cut -d'.' -f2 | base64 -d 2>/dev/null | jq .

# ID Token Payload 디코딩
echo "=== ID Token Payload ==="
echo $ID_TOKEN | cut -d'.' -f2 | base64 -d 2>/dev/null | jq .

# 토큰 만료 시각 확인
echo "=== Token Expiry ==="
echo $ACCESS_TOKEN | cut -d'.' -f2 | base64 -d 2>/dev/null | \
  jq '{exp: .exp, exp_readable: (.exp | todate), iat: .iat, iat_readable: (.iat | todate)}'

# Introspection으로 실시간 검증
echo "=== Token Introspection ==="
curl -s -X POST http://localhost:8080/realms/demo-realm/protocol/openid-connect/token/introspect \
  -d "token=$ACCESS_TOKEN" \
  -d "client_id=demo-app" \
  -d "client_secret=<client-secret>" | jq .

# Token Revocation 테스트
echo "=== Token Revocation ==="
curl -s -X POST http://localhost:8080/realms/demo-realm/protocol/openid-connect/revoke \
  -d "token=$REFRESH_TOKEN" \
  -d "token_type_hint=refresh_token" \
  -d "client_id=demo-app" \
  -d "client_secret=<client-secret>"
echo "Revocation complete."

# Revocation 후 Introspection 재확인
curl -s -X POST http://localhost:8080/realms/demo-realm/protocol/openid-connect/token/introspect \
  -d "token=$ACCESS_TOKEN" \
  -d "client_id=demo-app" \
  -d "client_secret=<client-secret>" | jq .
```

### 실습 9: LDAP 연동

```
LDAP Federation 설정 (Admin Console):

1. User Federation > Add provider > ldap

2. 연결 설정:
   Connection URL: ldap://ldap-server:389
   Bind DN: cn=admin,dc=example,dc=com
   Bind Credential: <admin-password>
   (Test Connection 버튼으로 연결 확인)

3. 사용자 검색 설정:
   Users DN: ou=users,dc=example,dc=com
   User Object Classes: inetOrgPerson, organizationalPerson
   Username LDAP attribute: uid
   RDN LDAP attribute: uid
   UUID LDAP attribute: entryUUID
   (Test Authentication 버튼으로 인증 확인)

4. 동기화 설정:
   Import Users: ON
   Sync Registrations: OFF
   Periodic Full Sync: ON (간격: 86400초)
   Periodic Changed Users Sync: ON (간격: 300초)

5. Mapper 추가:
   - user-attribute-ldap-mapper: mail → email
   - user-attribute-ldap-mapper: cn → firstName
   - user-attribute-ldap-mapper: sn → lastName
   - group-ldap-mapper: ou=groups,dc=example,dc=com → Keycloak 그룹

6. 동기화 실행:
   "Synchronize all users" 버튼 클릭
   → Users 메뉴에서 LDAP 사용자가 보이는지 확인
```

Docker Compose로 테스트용 LDAP 서버 구성:
```yaml
# docker-compose-ldap.yaml
version: '3'
services:
  openldap:
    image: osixia/openldap:1.5.0
    ports:
      - "389:389"
      - "636:636"
    environment:
      LDAP_ORGANISATION: "Example Inc"
      LDAP_DOMAIN: "example.com"
      LDAP_ADMIN_PASSWORD: "admin-password"
    volumes:
      - ldap-data:/var/lib/ldap
      - ldap-config:/etc/ldap/slapd.d

  phpldapadmin:
    image: osixia/phpLDAPadmin:0.9.0
    ports:
      - "6443:443"
    environment:
      PHPLDAPADMIN_LDAP_HOSTS: openldap

volumes:
  ldap-data:
  ldap-config:
```

### 실습 10: Custom Protocol Mapper 작성

커스텀 Protocol Mapper를 작성하여 토큰에 사용자의 로그인 횟수를 추가하는 예시이다.

```java
// LoginCountMapper.java
package com.example.keycloak.mapper;

import org.keycloak.models.*;
import org.keycloak.protocol.oidc.mappers.*;
import org.keycloak.provider.ProviderConfigProperty;
import org.keycloak.representations.IDToken;

import java.util.*;

public class LoginCountMapper extends AbstractOIDCProtocolMapper
    implements OIDCAccessTokenMapper, OIDCIDTokenMapper, UserInfoTokenMapper {

    public static final String PROVIDER_ID = "login-count-mapper";

    private static final List<ProviderConfigProperty> configProperties =
        new ArrayList<>();

    static {
        OIDCAttributeMapperHelper.addTokenClaimNameConfig(configProperties);
        OIDCAttributeMapperHelper.addIncludeInTokensConfig(
            configProperties, LoginCountMapper.class);
    }

    @Override
    public String getId() {
        return PROVIDER_ID;
    }

    @Override
    public String getDisplayType() {
        return "Login Count";
    }

    @Override
    public String getDisplayCategory() {
        return TOKEN_MAPPER_CATEGORY;
    }

    @Override
    public String getHelpText() {
        return "사용자의 로그인 횟수를 토큰 claim에 추가한다";
    }

    @Override
    public List<ProviderConfigProperty> getConfigProperties() {
        return configProperties;
    }

    @Override
    protected void setClaim(IDToken token,
                           ProtocolMapperModel mapperModel,
                           UserSessionModel userSession,
                           KeycloakSession keycloakSession,
                           ClientSessionContext clientSessionCtx) {

        UserModel user = userSession.getUser();
        String loginCount = user.getFirstAttribute("login_count");
        int count = loginCount != null ? Integer.parseInt(loginCount) : 0;

        OIDCAttributeMapperHelper.mapClaim(token, mapperModel, count);
    }
}
```

빌드 및 배포:
```bash
# Maven 빌드
mvn clean package

# JAR 파일을 Keycloak providers 디렉토리에 복사
cp target/custom-mapper.jar /opt/keycloak/providers/

# Keycloak 재빌드 및 재시작
/opt/keycloak/bin/kc.sh build
/opt/keycloak/bin/kc.sh start
```

### 실습 11: Admin REST API 활용

```bash
# 1. 관리자 토큰 발급
ADMIN_TOKEN=$(curl -s -X POST http://localhost:8080/realms/master/protocol/openid-connect/token \
  -d "grant_type=password" \
  -d "client_id=admin-cli" \
  -d "username=admin" \
  -d "password=admin" | jq -r '.access_token')

# 2. Realm 생성
curl -s -X POST http://localhost:8080/admin/realms \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "realm": "api-test-realm",
    "enabled": true,
    "registrationAllowed": false,
    "bruteForceProtected": true,
    "maxFailureWaitSeconds": 900,
    "failureFactor": 5
  }'

# 3. Client 생성
curl -s -X POST http://localhost:8080/admin/realms/api-test-realm/clients \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "api-test-app",
    "protocol": "openid-connect",
    "publicClient": false,
    "directAccessGrantsEnabled": true,
    "serviceAccountsEnabled": true,
    "redirectUris": ["http://localhost:3000/*"],
    "webOrigins": ["+"]
  }'

# 4. Client ID 조회 (UUID)
CLIENT_UUID=$(curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:8080/admin/realms/api-test-realm/clients?clientId=api-test-app" | \
  jq -r '.[0].id')
echo "Client UUID: $CLIENT_UUID"

# 5. Client Secret 조회
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:8080/admin/realms/api-test-realm/clients/$CLIENT_UUID/client-secret" | jq .

# 6. 사용자 생성
curl -s -X POST http://localhost:8080/admin/realms/api-test-realm/users \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "api-user",
    "email": "api-user@example.com",
    "enabled": true,
    "emailVerified": true,
    "firstName": "API",
    "lastName": "User",
    "attributes": {
      "department": ["Engineering"],
      "employeeId": ["EMP-000001"]
    },
    "credentials": [{
      "type": "password",
      "value": "test1234",
      "temporary": false
    }]
  }'

# 7. 사용자 ID 조회
USER_ID=$(curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:8080/admin/realms/api-test-realm/users?username=api-user" | \
  jq -r '.[0].id')
echo "User ID: $USER_ID"

# 8. Realm Role 생성
curl -s -X POST http://localhost:8080/admin/realms/api-test-realm/roles \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "api-admin", "description": "API 관리자 역할"}'

# 9. 사용자에게 역할 할당
ROLE_ID=$(curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:8080/admin/realms/api-test-realm/roles/api-admin" | jq -r '.id')

curl -s -X POST "http://localhost:8080/admin/realms/api-test-realm/users/$USER_ID/role-mappings/realm" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "[{\"id\": \"$ROLE_ID\", \"name\": \"api-admin\"}]"

# 10. 사용자의 세션 목록 조회
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:8080/admin/realms/api-test-realm/users/$USER_ID/sessions" | jq .

# 11. 이벤트 로그 조회
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:8080/admin/realms/api-test-realm/events?type=LOGIN&max=10" | jq .

# 12. Realm 삭제 (정리)
curl -s -X DELETE http://localhost:8080/admin/realms/api-test-realm \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

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
