# Day 3: JWT/JWK 심화, Realm 구성 심화, Client 구성 심화

> 이 문서에서는 JWT/JWK 심화(토큰 구조, 서명 검증, JWKS Endpoint, 토큰 교환, Token Introspection), Realm 구성(로그인 설정, Brute Force Protection, Session 정책, OTP), Client 구성(Client Scopes, Protocol Mappers, Service Account, Fine-Grained Authorization)을 다룬다.

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

