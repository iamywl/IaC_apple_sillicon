# Day 7: 트러블슈팅 및 실전 시나리오

> Envoy 운영 시 자주 발생하는 문제의 진단 및 해결 방법, 실전 시나리오(Canary 배포, gRPC 프록시, WebSocket, 멀티클러스터 등)를 학습한다.

## 트러블슈팅

### 체계적인 디버깅 접근법

Envoy 트러블슈팅은 다음 순서로 접근하는 것이 효율적이다:

```
문제 발생
  │
  ├── 1단계: 증상 확인
  │   ├── HTTP 응답 코드는?
  │   ├── RESPONSE_FLAGS는?
  │   └── 에러 메시지는?
  │
  ├── 2단계: 통계 확인
  │   ├── 서킷 브레이커 overflow가 있는가?
  │   ├── 업스트림 연결 실패가 있는가?
  │   └── 재시도 횟수는?
  │
  ├── 3단계: 설정 확인
  │   ├── Route 설정이 올바른가?
  │   ├── Cluster 엔드포인트가 있는가?
  │   └── TLS 설정이 일치하는가?
  │
  ├── 4단계: 엔드포인트 상태 확인
  │   ├── 엔드포인트가 HEALTHY인가?
  │   ├── Outlier Detection으로 퇴출되었는가?
  │   └── Active Health Check 결과는?
  │
  └── 5단계: 로그 레벨 올리기
      ├── 관련 컴포넌트의 로그를 debug로 변경
      └── 트래픽 재현 후 로그 분석
```

### RESPONSE_FLAGS별 디버깅 가이드

**UF (Upstream connection Failure):**
```bash
export KUBECONFIG=kubeconfig/dev.yaml

# 업스트림 연결 실패 통계
kubectl exec -it <pod-name> -n demo -c istio-proxy -- \
  curl -s localhost:15000/stats | grep "upstream_cx_connect_fail"

# 엔드포인트 상태 확인
istioctl proxy-config endpoint <pod-name> -n demo | grep UNHEALTHY

# 업스트림 서비스가 실행 중인지 확인
kubectl get pods -n demo -l app=<upstream-service>
```

**UO (Upstream Overflow - 서킷 브레이커):**
```bash
# 서킷 브레이커 통계 확인
kubectl exec -it <pod-name> -n demo -c istio-proxy -- \
  curl -s localhost:15000/stats | grep "upstream_rq_pending_overflow\|upstream_cx_overflow"

# 현재 활성 연결/요청 수 확인
kubectl exec -it <pod-name> -n demo -c istio-proxy -- \
  curl -s localhost:15000/stats | grep "circuit_breakers.*remaining"

# 조치: DestinationRule에서 connectionPool 값 증가
```

**NR (No Route):**
```bash
# Route 설정 확인
istioctl proxy-config route <pod-name> -n demo -o json

# Virtual Host 매칭 확인 (Host 헤더가 올바른가?)
istioctl proxy-config route <pod-name> -n demo | grep <destination-host>

# VirtualService 설정 확인
kubectl get virtualservice -n demo -o yaml
```

**NC (No Cluster):**
```bash
# Cluster 존재 여부 확인
istioctl proxy-config cluster <pod-name> -n demo | grep <service-name>

# 서비스가 Kubernetes에 등록되어 있는가?
kubectl get svc -n demo

# xDS 동기화 상태 확인
istioctl proxy-status
```

**UT (Upstream Timeout):**
```bash
# 타임아웃 설정 확인
istioctl proxy-config route <pod-name> -n demo -o json | grep -A 5 timeout

# 업스트림 응답 시간 통계
kubectl exec -it <pod-name> -n demo -c istio-proxy -- \
  curl -s localhost:15000/stats | grep "upstream_rq_time"

# 조치: VirtualService에서 timeout 값 증가
```

### config_dump 분석

```bash
export KUBECONFIG=kubeconfig/dev.yaml

# 전체 설정 덤프 (JSON)
kubectl exec -it <pod-name> -n demo -c istio-proxy -- \
  curl -s localhost:15000/config_dump > /tmp/envoy_config.json

# 특정 리소스만 덤프
# Listener 설정
kubectl exec -it <pod-name> -n demo -c istio-proxy -- \
  curl -s "localhost:15000/config_dump?resource=dynamic_listeners"

# Cluster 설정
kubectl exec -it <pod-name> -n demo -c istio-proxy -- \
  curl -s "localhost:15000/config_dump?resource=dynamic_active_clusters"

# Route 설정
kubectl exec -it <pod-name> -n demo -c istio-proxy -- \
  curl -s "localhost:15000/config_dump?resource=dynamic_route_configs"

# Secret (인증서) 설정
kubectl exec -it <pod-name> -n demo -c istio-proxy -- \
  curl -s "localhost:15000/config_dump?resource=dynamic_active_secrets"

# Bootstrap 설정
kubectl exec -it <pod-name> -n demo -c istio-proxy -- \
  curl -s "localhost:15000/config_dump?resource=bootstrap"
```

### 로그 레벨 관리

```bash
# 현재 로그 레벨 확인
kubectl exec -it <pod-name> -n demo -c istio-proxy -- \
  curl -s localhost:15000/logging

# 전체 레벨 변경
kubectl exec -it <pod-name> -n demo -c istio-proxy -- \
  curl -X POST "localhost:15000/logging?level=debug"

# 특정 컴포넌트만 변경 (추천 - 노이즈 감소)
kubectl exec -it <pod-name> -n demo -c istio-proxy -- \
  curl -X POST "localhost:15000/logging?router=debug"

kubectl exec -it <pod-name> -n demo -c istio-proxy -- \
  curl -X POST "localhost:15000/logging?connection=debug"

kubectl exec -it <pod-name> -n demo -c istio-proxy -- \
  curl -X POST "localhost:15000/logging?upstream=debug"

# 주요 로그 컴포넌트:
# admin      - Admin API
# client     - HTTP 클라이언트
# config     - 설정 관리
# connection - 연결 처리
# http       - HTTP 코덱
# http2      - HTTP/2 코덱
# pool       - Connection Pool
# router     - 라우터
# runtime    - 런타임 설정
# upstream   - 업스트림 관리

# 디버깅 완료 후 반드시 복원!
kubectl exec -it <pod-name> -n demo -c istio-proxy -- \
  curl -X POST "localhost:15000/logging?level=warning"
```

### xDS 동기화 상태 확인

```bash
# 모든 Envoy의 xDS 동기화 상태
istioctl proxy-status

# 출력 예시:
# NAME                    CDS     LDS     EDS     RDS     ECDS    ISTIOD
# backend-xxx.demo        SYNCED  SYNCED  SYNCED  SYNCED  -       istiod-xxx
# frontend-xxx.demo       SYNCED  SYNCED  STALE   SYNCED  -       istiod-xxx
#                                          ↑ EDS가 STALE! 엔드포인트 불일치

# 특정 Pod의 상세 xDS 상태
istioctl proxy-status <pod-name>.demo

# 두 Envoy 간 설정 차이 확인
istioctl proxy-config diff <pod-a>.demo <pod-b>.demo
```

### 일반적인 문제와 해결책

**문제 1: 503 UC (Upstream Connection termination)**
- 원인: 업스트림 서비스가 연결을 먼저 끊었다 (idle timeout 불일치)
- 해결: 업스트림의 keep-alive timeout > Envoy의 idle timeout이 되도록 설정

**문제 2: 503 UF (Upstream Failure) + mTLS**
- 원인: PeerAuthentication이 STRICT인데 클라이언트에 사이드카가 없다
- 해결: PERMISSIVE 모드로 변경하거나 클라이언트에 사이드카를 주입

**문제 3: 높은 p99 latency**
- 원인: 연결 풀 경합, 업스트림 지연, 재시도 폭주
- 진단:
```bash
# 업스트림 응답 시간 확인
kubectl exec -it <pod-name> -n demo -c istio-proxy -- \
  curl -s localhost:15000/stats | grep "upstream_rq_time"

# 재시도 비율 확인
kubectl exec -it <pod-name> -n demo -c istio-proxy -- \
  curl -s localhost:15000/stats | grep "upstream_rq_retry"

# 연결 풀 사용량 확인
kubectl exec -it <pod-name> -n demo -c istio-proxy -- \
  curl -s localhost:15000/stats | grep "upstream_cx_active"
```

**문제 4: Listener warming이 끝나지 않는다**
- 원인: RDS, CDS, 또는 SDS가 준비되지 않았다
- 진단:
```bash
kubectl exec -it <pod-name> -n demo -c istio-proxy -- \
  curl -s "localhost:15000/config_dump?resource=dynamic_listeners" | \
  python3 -m json.tool | grep -A 5 warming
```

---

## 실전 시나리오

### 시나리오 1: Edge Proxy (Ingress Gateway)

Edge Proxy는 외부 트래픽이 클러스터에 진입하는 첫 번째 지점이다. Istio에서는 Ingress Gateway가 이 역할을 한다:

```
인터넷
  │
  ▼
┌──────────────────┐
│  Cloud LB        │ (L4 Load Balancer)
│  (NLB/ALB)       │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Istio Ingress   │ (Envoy, 독립 Pod)
│  Gateway         │
│  ┌────────────┐  │
│  │ TLS 종단    │  │ ← 외부 TLS 인증서 관리
│  │ 라우팅      │  │ ← VirtualService 규칙 적용
│  │ Rate Limit  │  │ ← 글로벌 Rate Limiting
│  │ WAF        │  │ ← Wasm 기반 보안 필터
│  └────────────┘  │
└────────┬─────────┘
         │ mTLS
         ▼
┌──────────────────┐
│  내부 서비스      │ (Envoy Sidecar 포함)
└──────────────────┘
```

```yaml
# Istio Gateway 설정
apiVersion: networking.istio.io/v1beta1
kind: Gateway
metadata:
  name: main-gateway
  namespace: istio-system
spec:
  selector:
    istio: ingressgateway
  servers:
    - port:
        number: 443
        name: https
        protocol: HTTPS
      tls:
        mode: SIMPLE
        credentialName: main-tls-cert    # Kubernetes Secret 참조
      hosts:
        - "*.example.com"
    - port:
        number: 80
        name: http
        protocol: HTTP
      hosts:
        - "*.example.com"
      tls:
        httpsRedirect: true              # HTTP → HTTPS 리다이렉트

---
# VirtualService로 라우팅 규칙 정의
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: api-routing
  namespace: demo
spec:
  hosts:
    - "api.example.com"
  gateways:
    - istio-system/main-gateway
  http:
    - match:
        - uri:
            prefix: "/v2/"
      route:
        - destination:
            host: backend-v2
            port:
              number: 8080
      timeout: 30s
      retries:
        attempts: 3
        perTryTimeout: 10s
        retryOn: "5xx,reset,connect-failure"

    - match:
        - uri:
            prefix: "/v1/"
      route:
        - destination:
            host: backend-v1
            port:
              number: 8080

    # 기본 라우트
    - route:
        - destination:
            host: backend-v1
            port:
              number: 8080
```

### 시나리오 2: 카나리 배포 (Canary Deployment)

트래픽 가중치를 점진적으로 변경하여 새 버전을 안전하게 배포한다:

```yaml
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: backend-canary
  namespace: demo
spec:
  hosts:
    - backend
  http:
    # 특정 헤더가 있는 요청은 무조건 v2로 (개발팀 테스트용)
    - match:
        - headers:
            x-canary:
              exact: "true"
      route:
        - destination:
            host: backend
            subset: v2

    # 일반 트래픽은 가중치 기반 분할
    - route:
        - destination:
            host: backend
            subset: v1
          weight: 90
        - destination:
            host: backend
            subset: v2
          weight: 10

---
apiVersion: networking.istio.io/v1beta1
kind: DestinationRule
metadata:
  name: backend-subsets
  namespace: demo
spec:
  host: backend
  subsets:
    - name: v1
      labels:
        version: v1
    - name: v2
      labels:
        version: v2
  trafficPolicy:
    connectionPool:
      http:
        http2MaxRequests: 100
    outlierDetection:
      consecutive5xxErrors: 3
      interval: 10s
      baseEjectionTime: 30s
```

**카나리 배포 진행 순서:**

```
1. weight: v1=100, v2=0   (v2 배포, 트래픽 없음)
2. weight: v1=95,  v2=5   (5% 트래픽으로 검증)
3. weight: v1=80,  v2=20  (에러율, 지연 시간 모니터링)
4. weight: v1=50,  v2=50  (50:50 분할)
5. weight: v1=0,   v2=100 (전체 전환)
```

### 시나리오 3: API Gateway 패턴

Envoy를 API Gateway로 사용하여 인증, Rate Limiting, 변환 등을 수행한다:

```yaml
# EnvoyFilter를 사용한 API Gateway 패턴
apiVersion: networking.istio.io/v1alpha3
kind: EnvoyFilter
metadata:
  name: api-gateway-filter
  namespace: istio-system
spec:
  workloadSelector:
    labels:
      istio: ingressgateway
  configPatches:
    # JWT 인증 추가
    - applyTo: HTTP_FILTER
      match:
        context: GATEWAY
        listener:
          filterChain:
            filter:
              name: "envoy.filters.network.http_connection_manager"
              subFilter:
                name: "envoy.filters.http.router"
      patch:
        operation: INSERT_BEFORE
        value:
          name: envoy.filters.http.jwt_authn
          typed_config:
            "@type": type.googleapis.com/envoy.extensions.filters.http.jwt_authn.v3.JwtAuthentication
            providers:
              keycloak:
                issuer: "https://keycloak.example.com/realms/main"
                remote_jwks:
                  http_uri:
                    uri: "https://keycloak.example.com/realms/main/protocol/openid-connect/certs"
                    cluster: keycloak_jwks
                    timeout: 5s
                  cache_duration: 600s
                forward: true
                from_headers:
                  - name: Authorization
                    value_prefix: "Bearer "
            rules:
              - match:
                  prefix: "/api/"
                requires:
                  provider_name: keycloak
              - match:
                  prefix: "/public/"
                # 인증 불필요

    # 요청 변환 (Lua 필터)
    - applyTo: HTTP_FILTER
      match:
        context: GATEWAY
        listener:
          filterChain:
            filter:
              name: "envoy.filters.network.http_connection_manager"
              subFilter:
                name: "envoy.filters.http.router"
      patch:
        operation: INSERT_BEFORE
        value:
          name: envoy.filters.http.lua
          typed_config:
            "@type": type.googleapis.com/envoy.extensions.filters.http.lua.v3.Lua
            default_source_code:
              inline_string: |
                function envoy_on_request(request_handle)
                  -- JWT에서 추출한 사용자 ID를 헤더에 추가
                  local token = request_handle:headers():get("authorization")
                  if token then
                    -- Base64 디코딩 후 sub claim 추출 (간략화)
                    request_handle:headers():add("x-user-id", "extracted-user-id")
                  end

                  -- 요청 로깅
                  local path = request_handle:headers():get(":path")
                  local method = request_handle:headers():get(":method")
                  request_handle:logInfo("API Request: " .. method .. " " .. path)
                end

                function envoy_on_response(response_handle)
                  -- CORS 헤더 추가
                  response_handle:headers():add("access-control-allow-origin", "*")
                  -- 보안 헤더 추가
                  response_handle:headers():add("x-content-type-options", "nosniff")
                  response_handle:headers():add("x-frame-options", "DENY")
                end
```

### 시나리오 4: 서비스 간 통신 장애 격리 (Bulkhead 패턴)

서비스별로 독립적인 서킷 브레이커와 연결 풀을 설정하여 장애를 격리한다:

```yaml
# 각 업스트림 서비스별로 독립적인 DestinationRule 설정
apiVersion: networking.istio.io/v1beta1
kind: DestinationRule
metadata:
  name: payment-service-dr
  namespace: demo
spec:
  host: payment-service.demo.svc.cluster.local
  trafficPolicy:
    connectionPool:
      tcp:
        maxConnections: 50               # 결제 서비스는 연결 수 제한
      http:
        http1MaxPendingRequests: 50
        http2MaxRequests: 50
        maxRetries: 2                    # 결제는 재시도 최소화 (멱등성 문제)
    outlierDetection:
      consecutive5xxErrors: 3
      interval: 10s
      baseEjectionTime: 60s             # 결제 서비스 장애 시 긴 퇴출 시간
      maxEjectionPercent: 30            # 최대 30%만 퇴출 (가용성 유지)

---
apiVersion: networking.istio.io/v1beta1
kind: DestinationRule
metadata:
  name: notification-service-dr
  namespace: demo
spec:
  host: notification-service.demo.svc.cluster.local
  trafficPolicy:
    connectionPool:
      tcp:
        maxConnections: 200              # 알림 서비스는 넉넉하게
      http:
        http1MaxPendingRequests: 200
        http2MaxRequests: 200
        maxRetries: 5                    # 알림은 재시도 OK
    outlierDetection:
      consecutive5xxErrors: 10           # 알림은 에러 허용도 높음
      interval: 30s
      baseEjectionTime: 10s             # 빠른 복구
```

### 시나리오 5: Fault Injection을 통한 복원력 테스트

프로덕션 배포 전에 장애 시나리오를 시뮬레이션한다:

```yaml
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: backend-fault-injection
  namespace: demo
spec:
  hosts:
    - backend
  http:
    # 테스트 헤더가 있을 때만 장애 주입
    - match:
        - headers:
            x-fault-inject:
              exact: "delay"
      fault:
        delay:
          percentage:
            value: 50                    # 50%의 요청에 지연 주입
          fixedDelay: 5s                 # 5초 지연
      route:
        - destination:
            host: backend

    - match:
        - headers:
            x-fault-inject:
              exact: "abort"
      fault:
        abort:
          percentage:
            value: 30                    # 30%의 요청에 에러 주입
          httpStatus: 503                # 503 에러 반환
      route:
        - destination:
            host: backend

    # 일반 트래픽은 정상 처리
    - route:
        - destination:
            host: backend
```

테스트 실행:
```bash
export KUBECONFIG=kubeconfig/dev.yaml

# 지연 주입 테스트
kubectl exec -it <client-pod> -n demo -- \
  curl -H "x-fault-inject: delay" http://backend:8080/api/test -w "\nTotal time: %{time_total}s\n"

# 에러 주입 테스트 (10회 반복)
for i in $(seq 1 10); do
  kubectl exec -it <client-pod> -n demo -- \
    curl -s -o /dev/null -w "%{http_code}\n" \
    -H "x-fault-inject: abort" http://backend:8080/api/test
done
```

---

### 이 프로젝트에서의 실습 환경

이 프로젝트에서 Envoy는 Istio의 사이드카 프록시로 사용된다.

- dev 클러스터의 `demo` 네임스페이스에 사이드카가 자동 주입된다
- Envoy 설정은 istiod에 의해 xDS API로 자동 관리된다
- 실습 대상 클러스터: dev (`kubeconfig/dev.yaml`)

```bash
# Envoy 사이드카 확인 (Pod당 2개 컨테이너: 앱 + istio-proxy)
export KUBECONFIG=kubeconfig/dev.yaml
kubectl get pods -n demo  # 2/2 READY 확인
istioctl proxy-config all <pod-name> -n demo
```

