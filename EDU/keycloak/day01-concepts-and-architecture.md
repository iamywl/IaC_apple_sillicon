# Day 1: 개념, 아키텍처, 핵심 구성 요소

> 이 문서에서는 Keycloak의 기본 개념(Realm, Client, User, Role, Group, Token), 아키텍처(Quarkus 기반), OAuth 2.0 인증 흐름(Authorization Code Flow, Client Credentials, Device Authorization), JWT 구조, 그리고 이 프로젝트에서의 실습 환경을 다룬다.

---

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

