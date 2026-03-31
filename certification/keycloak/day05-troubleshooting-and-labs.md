# Day 5: 트러블슈팅, 실습

> 이 문서에서는 Keycloak 트러블슈팅(로그인 실패, 토큰 오류, 성능 문제, 인증서 문제, DB 연결 문제)과 기초부터 고급까지의 실습(Realm/Client 설정, 로그인 테스트, RBAC, Token 분석, PKCE, Service Account)을 다룬다.

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

