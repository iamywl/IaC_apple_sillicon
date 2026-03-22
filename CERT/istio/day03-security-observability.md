# Day 3: 보안 심화, 관찰성(Observability)

> 이 문서에서는 Istio 보안(mTLS, PeerAuthentication, RequestAuthentication, AuthorizationPolicy, 인증서 관리)과 관찰성(메트릭, 분산 트레이싱, 접근 로그, Kiali 서비스 토폴로지, Envoy 통계)을 다룬다.

---

## 4. 보안 심화

### 4.1 Istio 보안 아키텍처 개요

Istio의 보안은 세 가지 축으로 구성된다.

```
┌──────────────────────────────────────────────────────────────┐
│                    Istio 보안 아키텍처                         │
│                                                               │
│  ┌──────────────────┐  ┌──────────────┐  ┌────────────────┐  │
│  │  Identity (식별)  │  │  AuthN (인증) │  │  AuthZ (인가)   │  │
│  │                   │  │              │  │                │  │
│  │  SPIFFE ID 기반   │  │  두 가지 레벨: │  │  세 가지 액션: │  │
│  │  워크로드 식별     │  │              │  │                │  │
│  │                   │  │  - Peer AuthN │  │  - ALLOW       │  │
│  │  X.509 인증서에   │  │    (mTLS)     │  │  - DENY        │  │
│  │  SPIFFE ID 포함   │  │              │  │  - CUSTOM      │  │
│  │                   │  │  - Request   │  │                │  │
│  │  자동 발급/갱신   │  │    AuthN(JWT) │  │  RBAC 기반     │  │
│  └──────────────────┘  └──────────────┘  └────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

### 4.2 SPIFFE (Secure Production Identity Framework For Everyone)

SPIFFE는 분산 시스템에서 워크로드를 식별하기 위한 오픈 표준이다. Istio는 SPIFFE를 채택하여 각 워크로드에 고유한 ID를 부여한다.

**SPIFFE ID 형식:**
```
spiffe://<trust-domain>/ns/<namespace>/sa/<service-account>
```

**tart-infra 프로젝트에서의 SPIFFE ID 예제:**

| 서비스 | Service Account | SPIFFE ID |
|--------|----------------|-----------|
| nginx-web | default | `spiffe://cluster.local/ns/demo/sa/default` |
| httpbin | default | `spiffe://cluster.local/ns/demo/sa/default` |
| redis | default | `spiffe://cluster.local/ns/demo/sa/default` |
| postgres | default | `spiffe://cluster.local/ns/demo/sa/default` |
| keycloak | default | `spiffe://cluster.local/ns/demo/sa/default` |

> 보안 모범 사례: 각 서비스에 개별 Service Account를 할당해야 세밀한 인가 정책을 적용할 수 있다. 모든 서비스가 `default` Service Account를 사용하면 서비스 간 구분이 불가능하다.

**SPIFFE ID가 X.509 인증서에 포함되는 방식:**

```
Certificate:
    Subject: O = cluster.local
    Subject Alternative Name:
        URI: spiffe://cluster.local/ns/demo/sa/httpbin
    Issuer: O = cluster.local
    Validity:
        Not Before: 2026-03-19 00:00:00 UTC
        Not After:  2026-03-20 00:00:00 UTC    ← 기본 24시간
    ...
```

### 4.3 mTLS 심층 분석

**mTLS 핸드셰이크 과정:**

```
┌──────────────┐                              ┌──────────────┐
│  Envoy A     │                              │  Envoy B     │
│  (클라이언트)  │                              │  (서버)       │
└──────┬───────┘                              └──────┬───────┘
       │                                             │
       │ 1. ClientHello                              │
       │   - 지원하는 TLS 버전, 암호 스위트 제안       │
       ├────────────────────────────────────────────►│
       │                                             │
       │ 2. ServerHello                              │
       │   - 선택한 TLS 버전, 암호 스위트              │
       │                                             │
       │ 3. Server Certificate                       │
       │   - 서버의 X.509 인증서 (SPIFFE ID 포함)     │
       │                                             │
       │ 4. CertificateRequest                       │
       │   - 클라이언트 인증서 요청 (mTLS이므로)       │
       │◄────────────────────────────────────────────┤
       │                                             │
       │ 5. Client Certificate                       │
       │   - 클라이언트의 X.509 인증서 (SPIFFE ID 포함)│
       │                                             │
       │ 6. Client Key Exchange                      │
       ├────────────────────────────────────────────►│
       │                                             │
       │ 7. 양방향 인증 완료                           │
       │   - 양쪽 모두 상대방의 SPIFFE ID를 확인       │
       │                                             │
       │ 8. 암호화된 애플리케이션 데이터 교환           │
       │◄──────────────────────────────────────────►│
```

**인증서 라이프사이클:**
1. Envoy가 시작되면 SDS API를 통해 istiod에 인증서를 요청한다
2. istiod는 워크로드의 Kubernetes Service Account를 확인한다
3. SPIFFE ID가 포함된 X.509 인증서를 발급한다
4. 인증서는 기본 24시간 유효하며, 만료 전에 자동으로 갱신(rotation)된다
5. 갱신 시 Envoy의 연결이 끊기지 않는다 (hot reload)

### 4.4 PeerAuthentication 상세

PeerAuthentication은 서비스 간 mTLS 모드를 제어한다. 메시 전체, 네임스페이스, 워크로드 수준에서 적용할 수 있다.

**적용 우선순위 (좁은 범위가 우선):**

```
워크로드 레벨 (selector 있음, 특정 네임스페이스)
    ↑ 우선
네임스페이스 레벨 (selector 없음, 특정 네임스페이스, name: default)
    ↑ 우선
메시 레벨 (selector 없음, istio-system 네임스페이스, name: default)
```

**PeerAuthentication vs RequestAuthentication:**

| 구분 | PeerAuthentication | RequestAuthentication |
|------|-------------------|----------------------|
| 대상 | 서비스 간 통신 (transport layer) | 최종 사용자 인증 (application layer) |
| 인증 방식 | mTLS 인증서 | JWT 토큰 |
| 적용 범위 | 메시 전체, 네임스페이스, 워크로드 | 워크로드 |
| 모드 | STRICT, PERMISSIVE, DISABLE | - |
| 사용 예 | 서비스 간 통신을 반드시 mTLS로 강제 | 외부 사용자의 JWT 유효성 검증 |

**mTLS 모드:**

| 모드 | 동작 |
|------|------|
| PERMISSIVE (기본값) | mTLS와 평문(plaintext) 트래픽을 모두 허용한다. 메시 마이그레이션 시 유용하다 |
| STRICT | mTLS 트래픽만 허용한다. 평문 트래픽은 거부된다 |
| DISABLE | mTLS를 비활성화한다. 평문 트래픽만 허용한다 |
| UNSET | 상위 범위의 설정을 상속한다 |

> 주의: PERMISSIVE에서 STRICT로 전환하기 전에 모든 클라이언트가 mTLS를 사용하고 있는지 확인해야 한다. 그렇지 않으면 트래픽이 차단된다.

**포트별 mTLS 모드 설정:**

```yaml
apiVersion: security.istio.io/v1beta1
kind: PeerAuthentication
metadata:
  name: httpbin-mtls
  namespace: demo
spec:
  selector:
    matchLabels:
      app: httpbin
  mtls:
    mode: STRICT
  portLevelMtls:
    # 헬스체크 포트는 mTLS 제외
    8080:
      mode: DISABLE
    # 메트릭 포트는 PERMISSIVE
    15090:
      mode: PERMISSIVE
```

### 4.5 RequestAuthentication (JWT 검증) 상세

RequestAuthentication은 HTTP 요청에 포함된 JWT 토큰의 유효성을 검증한다. 유효하지 않은 JWT가 있으면 요청을 거부한다. 다만, JWT가 없는 요청은 기본적으로 통과시킨다 (AuthorizationPolicy와 결합하여 필수화할 수 있다).

```yaml
apiVersion: security.istio.io/v1beta1
kind: RequestAuthentication
metadata:
  name: keycloak-jwt
  namespace: demo
spec:
  selector:
    matchLabels:
      app: httpbin
  jwtRules:
    - issuer: "https://keycloak.demo.svc.cluster.local/realms/demo"
      # JWKS URI (공개 키 세트를 가져오는 URL)
      jwksUri: "https://keycloak.demo.svc.cluster.local/realms/demo/protocol/openid-connect/certs"
      # 또는 인라인 JWKS 사용:
      # jwks: |
      #   { "keys": [...] }

      # JWT를 추출할 위치 (기본: Authorization 헤더)
      fromHeaders:
        - name: Authorization
          prefix: "Bearer "
      # 쿼리 파라미터에서도 추출 가능
      fromParams:
        - access_token
      # 쿠키에서도 추출 가능
      fromCookies:
        - session-token

      # JWT의 audiences 필드 검증
      audiences:
        - "httpbin-api"
        - "demo-app"

      # 클레임을 헤더로 전달 (백엔드 앱에서 사용)
      outputClaimToHeaders:
        - header: x-jwt-sub
          claim: sub
        - header: x-jwt-email
          claim: email

      # 클레임을 요청 속성으로 전달 (AuthorizationPolicy에서 사용)
      outputPayloadToHeader: x-jwt-payload

      # JWT 공개 키 캐시 TTL
      # jwksRefreshInterval: 20m
```

**JWT 검증 흐름:**

```
클라이언트 요청 (Authorization: Bearer <token>)
     │
     ▼
Envoy (istio-proxy)
     │
     ├── 1. JWT 추출 (헤더/쿠키/쿼리)
     │
     ├── 2. jwksUri에서 공개 키 가져오기 (캐시됨)
     │
     ├── 3. JWT 서명 검증
     │
     ├── 4. issuer 필드 검증
     │
     ├── 5. audiences 필드 검증
     │
     ├── 6. 만료 시간(exp) 검증
     │
     ├── 7. 검증 성공 → 요청 통과, 클레임을 헤더로 전달
     │   검증 실패 → 401 Unauthorized 반환
     │
     ▼
앱 컨테이너 (x-jwt-sub, x-jwt-email 헤더 수신)
```

### 4.6 AuthorizationPolicy 상세

AuthorizationPolicy는 워크로드에 대한 접근 제어를 정의한다. Envoy의 RBAC(Role-Based Access Control) 필터로 변환된다.

**액션 유형:**

| 액션 | 동작 |
|------|------|
| ALLOW | 매칭되는 요청을 허용한다. ALLOW 정책이 없으면 모든 요청이 허용된다 |
| DENY | 매칭되는 요청을 거부한다. DENY는 ALLOW보다 먼저 평가된다 |
| CUSTOM | 외부 인가 서비스(OPA, ext_authz 등)에 위임한다 |
| AUDIT | 매칭되는 요청을 감사 로그에 기록한다 (허용/거부에 영향 없음) |

**평가 순서:**

```
요청 도착
  │
  ▼
CUSTOM 정책 평가 → 거부 시 → 403 반환
  │ 허용
  ▼
DENY 정책 평가 → 매칭 시 → 403 반환
  │ 매칭 없음
  ▼
ALLOW 정책 존재? ─ 아니요 ─→ 허용 (정책 없음 = 모든 요청 허용)
  │ 예
  ▼
ALLOW 정책 매칭? ─ 아니요 ─→ 403 반환
  │ 예
  ▼
허용
```

**AuthorizationPolicy 전체 필드:**

```yaml
apiVersion: security.istio.io/v1beta1
kind: AuthorizationPolicy
metadata:
  name: httpbin-authz
  namespace: demo
spec:
  # 이 정책이 적용될 워크로드
  selector:
    matchLabels:
      app: httpbin

  # 액션
  action: ALLOW                        # ALLOW, DENY, CUSTOM, AUDIT

  # 규칙 (여러 규칙은 OR로 평가)
  rules:
    - from:                            # 소스 조건 (AND)
        - source:
            # SPIFFE principal (서비스 ID)
            principals:
              - "cluster.local/ns/demo/sa/nginx-web"
            # 부정: 지정된 것을 제외한 모든 principal
            # notPrincipals:
            #   - "cluster.local/ns/demo/sa/untrusted"

            # 요청 principal (JWT의 iss/sub)
            requestPrincipals:
              - "https://keycloak.demo.svc.cluster.local/realms/demo/*"
            # notRequestPrincipals: ["*"]  # JWT 없는 요청 거부

            # 소스 네임스페이스
            namespaces:
              - "demo"
              - "staging"
            # notNamespaces:
            #   - "untrusted-ns"

            # 소스 IP 범위
            ipBlocks:
              - "10.0.0.0/8"
            # notIpBlocks:
            #   - "10.0.99.0/24"

      to:                              # 대상 조건 (AND)
        - operation:
            # HTTP 메서드
            methods:
              - "GET"
              - "POST"
            # notMethods:
            #   - "DELETE"

            # 요청 경로
            paths:
              - "/api/*"
              - "/health"
            # notPaths:
            #   - "/admin/*"

            # 호스트
            hosts:
              - "httpbin.demo.svc.cluster.local"

            # 포트
            ports:
              - "80"
              - "8080"

      when:                            # 추가 조건 (AND)
        - key: request.headers[x-custom-header]
          values:
            - "allowed-value"
        - key: source.namespace
          values:
            - "demo"
        # 사용 가능한 키:
        # request.headers[<name>]
        # source.ip
        # source.namespace
        # source.principal
        # destination.port
        # connection.sni
        # request.auth.principal    (JWT iss/sub)
        # request.auth.audiences    (JWT aud)
        # request.auth.claims[<name>] (JWT 커스텀 클레임)
```

**실용적인 AuthorizationPolicy 예제:**

```yaml
# 1. 특정 서비스만 접근 허용 (Zero Trust)
apiVersion: security.istio.io/v1beta1
kind: AuthorizationPolicy
metadata:
  name: redis-access
  namespace: demo
spec:
  selector:
    matchLabels:
      app: redis
  action: ALLOW
  rules:
    - from:
        - source:
            principals:
              - "cluster.local/ns/demo/sa/nginx-web"
              - "cluster.local/ns/demo/sa/httpbin"
---
# 2. JWT 클레임 기반 접근 제어
apiVersion: security.istio.io/v1beta1
kind: AuthorizationPolicy
metadata:
  name: admin-only
  namespace: demo
spec:
  selector:
    matchLabels:
      app: httpbin
  action: ALLOW
  rules:
    - from:
        - source:
            requestPrincipals: ["*"]   # JWT가 있는 요청만
      to:
        - operation:
            paths: ["/admin/*"]
      when:
        - key: request.auth.claims[role]
          values: ["admin"]
---
# 3. 모든 요청 거부 (기본 거부 정책)
apiVersion: security.istio.io/v1beta1
kind: AuthorizationPolicy
metadata:
  name: deny-all
  namespace: demo
spec:
  # selector 없음 = 네임스페이스 전체
  # rules 없음 = 모든 요청 매칭
  # action 생략 = ALLOW
  # ALLOW 정책이 있지만 rules가 비어있으면 아무것도 매칭되지 않으므로
  # 모든 요청이 거부된다
  {}
```

### 4.7 mTLS 마이그레이션 전략

기존 서비스를 Istio 메시로 마이그레이션할 때 mTLS를 단계적으로 적용하는 전략이다.

**단계별 전환 과정:**

```
Phase 1: PERMISSIVE (준비)
  - 사이드카 주입을 활성화한다
  - PeerAuthentication을 PERMISSIVE로 설정한다
  - mTLS와 평문 트래픽이 모두 허용된다
  - Kiali에서 mTLS 상태를 모니터링한다
       │
       ▼
Phase 2: 검증
  - 모든 서비스에 사이드카가 주입되었는지 확인한다
  - istioctl authn tls-check로 mTLS 상태를 확인한다
  - 비메시 클라이언트가 있는지 확인한다
       │
       ▼
Phase 3: STRICT (적용)
  - PeerAuthentication을 STRICT로 변경한다
  - 비메시 트래픽이 차단되는지 확인한다
  - 문제 발생 시 즉시 PERMISSIVE로 롤백할 수 있다
       │
       ▼
Phase 4: 포트별 예외 (필요 시)
  - 헬스체크, 메트릭 등 특수 포트는 DISABLE로 설정한다
  - portLevelMtls를 사용한다
```

---

## 5. 관찰성 (Observability)

Istio는 애플리케이션 코드 변경 없이 세 가지 옵저버빌리티 신호를 자동 생성한다.

### 5.1 메트릭 (Metrics)

Envoy 사이드카가 자동으로 생성하는 주요 메트릭:

**표준 Istio 메트릭:**

| 메트릭 | 유형 | 설명 |
|--------|------|------|
| `istio_requests_total` | Counter | 총 요청 수 |
| `istio_request_duration_milliseconds` | Histogram | 요청 처리 시간 |
| `istio_request_bytes` | Histogram | 요청 크기 |
| `istio_response_bytes` | Histogram | 응답 크기 |
| `istio_tcp_sent_bytes_total` | Counter | TCP 전송 바이트 |
| `istio_tcp_received_bytes_total` | Counter | TCP 수신 바이트 |
| `istio_tcp_connections_opened_total` | Counter | TCP 연결 열린 수 |
| `istio_tcp_connections_closed_total` | Counter | TCP 연결 닫힌 수 |

**메트릭에 포함되는 레이블:**

| 레이블 | 설명 |
|--------|------|
| `source_workload` | 요청을 보낸 워크로드 이름 |
| `source_workload_namespace` | 소스 네임스페이스 |
| `destination_workload` | 요청을 받은 워크로드 이름 |
| `destination_workload_namespace` | 대상 네임스페이스 |
| `destination_service` | 대상 서비스 이름 |
| `response_code` | HTTP 응답 코드 (200, 404, 503 등) |
| `response_flags` | Envoy 응답 플래그 (NR, UO, DC 등) |
| `connection_security_policy` | mTLS 사용 여부 (mutual_tls, none) |
| `request_protocol` | HTTP/1.1, HTTP/2, gRPC |

**유용한 PromQL 쿼리:**

```promql
# 서비스별 요청 성공률 (최근 5분)
sum(rate(istio_requests_total{
  response_code!~"5.*",
  destination_service="httpbin.demo.svc.cluster.local"
}[5m])) /
sum(rate(istio_requests_total{
  destination_service="httpbin.demo.svc.cluster.local"
}[5m])) * 100

# 서비스별 P99 지연시간
histogram_quantile(0.99,
  sum(rate(istio_request_duration_milliseconds_bucket{
    destination_service="httpbin.demo.svc.cluster.local"
  }[5m])) by (le))

# 서비스별 초당 요청 수 (RPS)
sum(rate(istio_requests_total{
  destination_service="httpbin.demo.svc.cluster.local"
}[5m]))

# mTLS가 적용되지 않은 트래픽 탐지
sum(rate(istio_requests_total{
  connection_security_policy="none"
}[5m])) by (source_workload, destination_service)

# 서킷 브레이커에 의해 거부된 요청
sum(rate(istio_requests_total{
  response_flags="UO"
}[5m])) by (destination_service)
```

**Telemetry API를 사용한 메트릭 커스터마이징:**

```yaml
apiVersion: telemetry.istio.io/v1alpha1
kind: Telemetry
metadata:
  name: custom-metrics
  namespace: demo
spec:
  # 특정 워크로드에만 적용
  selector:
    matchLabels:
      app: httpbin
  metrics:
    - providers:
        - name: prometheus
      overrides:
        # 커스텀 레이블 추가
        - match:
            metric: REQUEST_COUNT
            mode: CLIENT_AND_SERVER
          tagOverrides:
            custom_dimension:
              value: "request.headers['x-custom-header']"
        # 불필요한 레이블 제거 (카디널리티 감소)
        - match:
            metric: ALL_METRICS
          tagOverrides:
            request_protocol:
              operation: REMOVE
```

### 5.2 분산 트레이싱 (Distributed Tracing)

Envoy는 각 요청에 대해 trace span을 자동 생성한다. 단, **trace context propagation**(추적 컨텍스트 전파)은 애플리케이션이 수행해야 한다.

애플리케이션이 전파해야 하는 헤더:
- `x-request-id`
- `x-b3-traceid`, `x-b3-spanid`, `x-b3-parentspanid`, `x-b3-sampled`, `x-b3-flags` (Zipkin B3)
- `traceparent`, `tracestate` (W3C Trace Context)

> 핵심: Envoy가 span을 자동 생성하지만, 서비스 A -> B -> C 호출 시 B 애플리케이션이 수신한 trace 헤더를 C로의 요청에 포함시켜야 전체 트레이스가 연결된다. 헤더를 전파하지 않으면 각 구간이 별도 트레이스로 기록된다.

**트레이싱 동작 원리:**

```
클라이언트 → Envoy A → App A → Envoy A → Envoy B → App B → Envoy B
              │                   │         │                   │
              │ Span 1 생성       │         │ Span 2 생성       │
              │ (inbound)         │         │ (inbound)         │
              │                   │         │                   │
              │         Span 3 생성│         │                   │
              │         (outbound)│         │                   │
              │                   │         │                   │

App A가 수신한 trace 헤더를 App B 호출 시 전파해야
Span 1, 2, 3이 하나의 Trace로 연결된다.
```

**트레이싱 설정:**

```yaml
apiVersion: telemetry.istio.io/v1alpha1
kind: Telemetry
metadata:
  name: tracing-config
  namespace: demo
spec:
  tracing:
    - providers:
        - name: zipkin                     # 또는 jaeger, datadog 등
      randomSamplingPercentage: 10.0       # 10% 샘플링
      customTags:
        environment:
          literal:
            value: "dev"
        cluster:
          environment:
            name: CLUSTER_NAME
```

**Jaeger 백엔드 설정:**

```yaml
# Istio 설치 시 meshConfig에 트레이싱 백엔드 설정
meshConfig:
  enableTracing: true
  defaultConfig:
    tracing:
      zipkin:
        address: jaeger-collector.observability.svc:9411
      sampling: 10.0                       # 10% 샘플링
```

### 5.3 접근 로그 (Access Logging)

Envoy 접근 로그를 활성화하여 모든 요청의 상세 정보를 기록할 수 있다.

```yaml
apiVersion: telemetry.istio.io/v1alpha1
kind: Telemetry
metadata:
  name: mesh-default
  namespace: istio-system
spec:
  accessLogging:
    - providers:
        - name: envoy
      # 필터링 (선택사항)
      # filter:
      #   expression: "response.code >= 400"
```

**접근 로그 형식 커스터마이징:**

```yaml
# meshConfig에서 설정
meshConfig:
  accessLogFile: /dev/stdout               # stdout으로 출력
  accessLogEncoding: JSON                  # TEXT 또는 JSON
  accessLogFormat: |
    [%START_TIME%] "%REQ(:METHOD)% %REQ(X-ENVOY-ORIGINAL-PATH?:PATH)% %PROTOCOL%"
    %RESPONSE_CODE% %RESPONSE_FLAGS% %RESPONSE_CODE_DETAILS%
    %CONNECTION_TERMINATION_DETAILS%
    "%UPSTREAM_TRANSPORT_FAILURE_REASON%" %BYTES_RECEIVED% %BYTES_SENT%
    %DURATION% %RESP(X-ENVOY-UPSTREAM-SERVICE-TIME)%
    "%REQ(X-FORWARDED-FOR)%" "%REQ(USER-AGENT)%"
    "%REQ(X-REQUEST-ID)%" "%REQ(:AUTHORITY)%"
    "%UPSTREAM_HOST%" %UPSTREAM_CLUSTER%
    %UPSTREAM_LOCAL_ADDRESS% %DOWNSTREAM_LOCAL_ADDRESS%
    %DOWNSTREAM_REMOTE_ADDRESS% %REQUESTED_SERVER_NAME%
    %ROUTE_NAME%
```

**주요 로그 필드 설명:**

| 필드 | 설명 |
|------|------|
| `%RESPONSE_FLAGS%` | Envoy 응답 플래그 (아래 표 참조) |
| `%UPSTREAM_HOST%` | 실제 연결된 업스트림 Pod IP:Port |
| `%UPSTREAM_CLUSTER%` | Envoy 내부 클러스터 이름 |
| `%DURATION%` | 전체 요청 처리 시간 (ms) |
| `%RESP(X-ENVOY-UPSTREAM-SERVICE-TIME)%` | 업스트림 서비스의 처리 시간 |
| `%DOWNSTREAM_REMOTE_ADDRESS%` | 클라이언트 IP:Port |
| `%REQUESTED_SERVER_NAME%` | TLS SNI 호스트 이름 |

**Envoy 응답 플래그 (RESPONSE_FLAGS):**

| 플래그 | 설명 |
|--------|------|
| UH | 건강한 업스트림 호스트가 없다 |
| UF | 업스트림 연결 실패 |
| UO | 업스트림 오버플로 (서킷 브레이커 동작) |
| NR | 매칭되는 라우트가 없다 |
| URX | 재시도 횟수 초과 |
| NC | 업스트림 클러스터를 찾을 수 없다 |
| DT | 요청 타임아웃 |
| DC | 다운스트림 연결 종료 |
| LH | 로컬 헬스체크 실패 |
| UT | 업스트림 요청 타임아웃 |
| LR | 로컬 리셋 |
| UR | 업스트림 리셋 |
| RL | Rate Limited |
| UAEX | 외부 인가 거부 |
| RLSE | Rate Limit 서비스 에러 |
| IH | 잘못된 헤더로 인한 거부 |

### 5.4 Kiali - 서비스 메시 관리 대시보드

Kiali는 Istio 서비스 메시의 전용 관찰성 도구이다.

**Kiali가 제공하는 기능:**

| 기능 | 설명 |
|------|------|
| 서비스 그래프 | 서비스 간 통신을 실시간 그래프로 시각화한다 |
| 트래픽 흐름 | 요청 성공률, 지연시간, 트래픽 양을 시각화한다 |
| 설정 검증 | VirtualService, DestinationRule 등의 설정 오류를 탐지한다 |
| mTLS 상태 | 각 서비스 간 mTLS 적용 여부를 표시한다 |
| 헬스 체크 | 서비스, 워크로드, 애플리케이션의 건강 상태를 표시한다 |
| 설정 관리 | YAML 편집기를 통해 Istio 리소스를 직접 수정할 수 있다 |
| 트레이스 연동 | Jaeger/Zipkin과 연동하여 트레이스를 직접 조회할 수 있다 |

```bash
# Kiali 접속
istioctl dashboard kiali

# 또는 port-forward로 접속
kubectl port-forward -n istio-system svc/kiali 20001:20001
# 브라우저에서 http://localhost:20001 접속
```

### 5.5 Grafana 대시보드

Istio는 Grafana용 기본 대시보드를 제공한다.

| 대시보드 | 설명 |
|---------|------|
| Mesh Dashboard | 메시 전체의 요약 정보 (총 요청 수, 성공률, P50/P90/P99 지연) |
| Service Dashboard | 개별 서비스의 상세 메트릭 |
| Workload Dashboard | 개별 워크로드(Deployment)의 상세 메트릭 |
| Performance Dashboard | 리소스 사용량, GC, 메모리 등 Envoy/istiod 성능 메트릭 |
| Control Plane Dashboard | istiod의 xDS push 성능, 에러율 등 |

---

