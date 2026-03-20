# Day 2: OAuth 2.0 심화, OpenID Connect 심화

> 이 문서에서는 OAuth 2.0의 심화 내용(Authorization Code Flow 상세, PKCE, Token Endpoint, Scope, 보안 고려사항)과 OpenID Connect(ID Token, UserInfo Endpoint, Discovery, Session Management, Logout 흐름)를 다룬다.

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

