# Day 8: 실습, 예제, 자가 점검

> Envoy 설정 실습 과제, 예제 시나리오, 자가 점검 문제를 통해 학습 내용을 정리한다.

## 실습

### 실습 1: Envoy Sidecar 설정 확인
```bash
# Pod의 Envoy 설정 전체 덤프
istioctl proxy-config all <pod-name> -n demo

# Listener 확인 (어떤 포트에서 트래픽을 수신하는지)
istioctl proxy-config listener <pod-name> -n demo

# Cluster 확인 (어떤 업스트림 서비스에 연결되는지)
istioctl proxy-config cluster <pod-name> -n demo

# Route 확인 (어떤 규칙으로 라우팅되는지)
istioctl proxy-config route <pod-name> -n demo

# Endpoint 확인 (실제 Pod IP 목록)
istioctl proxy-config endpoint <pod-name> -n demo

# 특정 Cluster의 상세 설정 (JSON 출력)
istioctl proxy-config cluster <pod-name> -n demo --fqdn "outbound|80||backend.demo.svc.cluster.local" -o json

# Bootstrap 설정 확인 (Envoy 초기 부트스트랩 설정)
istioctl proxy-config bootstrap <pod-name> -n demo -o json
```

### 실습 2: Envoy 통계 확인 및 분석
```bash
# Envoy Admin 인터페이스 — 전체 통계 확인
kubectl exec -it <pod-name> -n demo -c istio-proxy -- \
  curl -s localhost:15000/stats

# 업스트림 연결 관련 통계 (연결 수, 실패, 타임아웃)
kubectl exec -it <pod-name> -n demo -c istio-proxy -- \
  curl -s localhost:15000/stats | grep upstream_cx

# 서킷 브레이커 관련 통계 (overflow 발생 여부 확인)
kubectl exec -it <pod-name> -n demo -c istio-proxy -- \
  curl -s localhost:15000/stats | grep circuit_breakers

# 업스트림 요청 통계 (성공, 실패, 재시도 횟수)
kubectl exec -it <pod-name> -n demo -c istio-proxy -- \
  curl -s localhost:15000/stats | grep upstream_rq

# HTTP 응답 코드별 통계
kubectl exec -it <pod-name> -n demo -c istio-proxy -- \
  curl -s localhost:15000/stats | grep "downstream_rq_[0-9]"

# Outlier Detection 관련 통계 (퇴출 발생 여부)
kubectl exec -it <pod-name> -n demo -c istio-proxy -- \
  curl -s localhost:15000/stats | grep outlier

# Prometheus 형식 메트릭 확인
kubectl exec -it <pod-name> -n demo -c istio-proxy -- \
  curl -s localhost:15000/stats/prometheus

# 서버 정보 (Envoy 버전, 가동 시간, Hot Restart 세대 등)
kubectl exec -it <pod-name> -n demo -c istio-proxy -- \
  curl -s localhost:15000/server_info | python3 -m json.tool

# 클러스터별 엔드포인트 상태 (health, weight, priority)
kubectl exec -it <pod-name> -n demo -c istio-proxy -- \
  curl -s localhost:15000/clusters
```

### 실습 3: Admin 인터페이스로 디버깅
```bash
# 전체 설정 덤프 (JSON, 현재 적용된 모든 설정 확인)
kubectl exec -it <pod-name> -n demo -c istio-proxy -- \
  curl -s localhost:15000/config_dump | python3 -m json.tool | head -100

# 특정 리소스 타입만 덤프 (예: dynamic_listeners)
kubectl exec -it <pod-name> -n demo -c istio-proxy -- \
  curl -s "localhost:15000/config_dump?resource=dynamic_listeners"

# ready 상태 확인 (Listener/Cluster가 모두 warming 완료되었는지)
kubectl exec -it <pod-name> -n demo -c istio-proxy -- \
  curl -s localhost:15000/ready

# 통계 카운터 리셋 (디버깅 시 유용)
kubectl exec -it <pod-name> -n demo -c istio-proxy -- \
  curl -X POST localhost:15000/reset_counters

# 특정 커넥션의 drain 수행
kubectl exec -it <pod-name> -n demo -c istio-proxy -- \
  curl -X POST localhost:15000/drain_listeners

# 특정 컴포넌트의 로그 레벨만 변경
kubectl exec -it <pod-name> -n demo -c istio-proxy -- \
  curl -X POST "localhost:15000/logging?connection=debug&upstream=debug"
```

### 실습 4: Envoy 로그 분석
```bash
# Envoy 액세스 로그 확인
kubectl logs <pod-name> -n demo -c istio-proxy

# 실시간 로그 스트리밍 (트래픽 발생 시 확인)
kubectl logs -f <pod-name> -n demo -c istio-proxy

# 5xx 에러만 필터링
kubectl logs <pod-name> -n demo -c istio-proxy | grep " 5[0-9][0-9] "

# RESPONSE_FLAGS가 있는 요청만 필터링 (문제가 있는 요청)
kubectl logs <pod-name> -n demo -c istio-proxy | grep -E "UF|UO|NR|URX|NC|UT"

# 로그 레벨 변경 (디버깅용)
kubectl exec -it <pod-name> -n demo -c istio-proxy -- \
  curl -X POST "localhost:15000/logging?level=debug"

# 현재 로그 레벨 확인
kubectl exec -it <pod-name> -n demo -c istio-proxy -- \
  curl -s localhost:15000/logging

# 로그 레벨 복원 (디버깅 완료 후 반드시 복원)
kubectl exec -it <pod-name> -n demo -c istio-proxy -- \
  curl -X POST "localhost:15000/logging?level=warning"
```

### 실습 5: 연결 문제 디버깅 시나리오
```bash
# 시나리오: 서비스 A → 서비스 B 호출이 실패할 때

# 1단계: 소스 Pod의 Envoy에서 목적지 클러스터 확인
istioctl proxy-config cluster <source-pod> -n demo | grep <dest-service>

# 2단계: 해당 클러스터의 엔드포인트 상태 확인
istioctl proxy-config endpoint <source-pod> -n demo \
  --cluster "outbound|80||<dest-service>.demo.svc.cluster.local"

# 3단계: 엔드포인트가 HEALTHY인지 확인
kubectl exec -it <source-pod> -n demo -c istio-proxy -- \
  curl -s localhost:15000/clusters | grep <dest-service>

# 4단계: 업스트림 연결 실패 통계 확인
kubectl exec -it <source-pod> -n demo -c istio-proxy -- \
  curl -s localhost:15000/stats | grep "<dest-service>" | grep -E "cx_connect_fail|rq_error|rq_timeout"

# 5단계: xDS 동기화 상태 확인 (SYNCED인지 확인)
istioctl proxy-status <source-pod> -n demo
```

### 실습 6: TLS/mTLS 디버깅
```bash
export KUBECONFIG=kubeconfig/dev.yaml

# SDS 인증서 상태 확인
istioctl proxy-config secret <pod-name> -n demo

# 인증서 상세 정보 (만료일, 발급자, SAN 등)
istioctl proxy-config secret <pod-name> -n demo -o json | \
  python3 -c "
import sys, json, base64
from datetime import datetime
data = json.load(sys.stdin)
for secret in data.get('dynamicActiveSecrets', []):
    name = secret.get('name', 'unknown')
    print(f'Secret: {name}')
    tls_cert = secret.get('secret', {}).get('tlsCertificate', {})
    cert_chain = tls_cert.get('certificateChain', {}).get('inlineBytes', '')
    if cert_chain:
        print(f'  Certificate present: Yes')
    print()
"

# PeerAuthentication 설정 확인
kubectl get peerauthentication -n demo -o yaml

# mTLS 모드 확인 (STRICT/PERMISSIVE/DISABLE)
istioctl authn tls-check <pod-name>.demo

# TLS 핸드셰이크 실패 통계
kubectl exec -it <pod-name> -n demo -c istio-proxy -- \
  curl -s localhost:15000/stats | grep "ssl.handshake\|ssl.fail_verify"
```

### 실습 7: 성능 프로파일링
```bash
export KUBECONFIG=kubeconfig/dev.yaml

# 연결 풀 사용량 확인
kubectl exec -it <pod-name> -n demo -c istio-proxy -- \
  curl -s localhost:15000/stats | grep "upstream_cx_active\|upstream_cx_total\|upstream_cx_pool"

# 요청 지연 분포 확인 (히스토그램)
kubectl exec -it <pod-name> -n demo -c istio-proxy -- \
  curl -s localhost:15000/stats | grep "upstream_rq_time"

# 메모리 사용량 확인
kubectl exec -it <pod-name> -n demo -c istio-proxy -- \
  curl -s localhost:15000/stats | grep "server.memory"

# Worker Thread당 연결 분포 확인
kubectl exec -it <pod-name> -n demo -c istio-proxy -- \
  curl -s localhost:15000/stats | grep "listener.*downstream_cx_active"

# Envoy 가동 시간 및 버전 확인
kubectl exec -it <pod-name> -n demo -c istio-proxy -- \
  curl -s localhost:15000/server_info | python3 -m json.tool
```

---

## 예제

### 예제 1: Envoy 독립 실행 (학습용)
```yaml
# envoy-config.yaml
# 가장 단순한 Envoy 설정 예제이다
static_resources:
  listeners:
    - name: listener_0
      address:
        socket_address:
          address: 0.0.0.0
          port_value: 10000
      filter_chains:
        - filters:
            - name: envoy.filters.network.http_connection_manager
              typed_config:
                "@type": type.googleapis.com/envoy.extensions.filters.network.http_connection_manager.v3.HttpConnectionManager
                stat_prefix: ingress_http
                access_log:
                  - name: envoy.access_loggers.stdout
                    typed_config:
                      "@type": type.googleapis.com/envoy.extensions.access_loggers.stream.v3.StdoutAccessLog
                      log_format:
                        text_format_source:
                          inline_string: "[%START_TIME%] \"%REQ(:METHOD)% %REQ(X-ENVOY-ORIGINAL-PATH?:PATH)% %PROTOCOL%\" %RESPONSE_CODE% %RESPONSE_FLAGS% %BYTES_RECEIVED% %BYTES_SENT% %DURATION% \"%UPSTREAM_HOST%\"\n"
                route_config:
                  name: local_route
                  virtual_hosts:
                    - name: local_service
                      domains: ["*"]
                      routes:
                        - match:
                            prefix: "/"
                          route:
                            cluster: backend_service
                http_filters:
                  - name: envoy.filters.http.router
                    typed_config:
                      "@type": type.googleapis.com/envoy.extensions.filters.http.router.v3.Router

  clusters:
    - name: backend_service
      connect_timeout: 5s
      type: STRICT_DNS
      lb_policy: ROUND_ROBIN
      load_assignment:
        cluster_name: backend_service
        endpoints:
          - lb_endpoints:
              - endpoint:
                  address:
                    socket_address:
                      address: nginx
                      port_value: 80

admin:
  address:
    socket_address:
      address: 0.0.0.0
      port_value: 9901
```

### 예제 2: 서킷 브레이커 + Outlier Detection 통합 설정
```yaml
# Istio DestinationRule로 설정하는 서킷 브레이커 + Outlier Detection 예제이다
apiVersion: networking.istio.io/v1beta1
kind: DestinationRule
metadata:
  name: backend-dr
  namespace: demo
spec:
  host: backend.demo.svc.cluster.local
  trafficPolicy:
    connectionPool:
      tcp:
        maxConnections: 100          # max_connections
      http:
        h2UpgradePolicy: DEFAULT
        http1MaxPendingRequests: 100  # max_pending_requests
        http2MaxRequests: 100         # max_requests
        maxRetries: 3                 # max_retries
        maxRequestsPerConnection: 10
    outlierDetection:
      consecutive5xxErrors: 5
      interval: 10s
      baseEjectionTime: 30s
      maxEjectionPercent: 50
    loadBalancer:
      simple: LEAST_REQUEST
```

### 예제 3: Rate Limiting 설정
```yaml
# Istio EnvoyFilter를 사용한 Local Rate Limiting 예제이다
apiVersion: networking.istio.io/v1alpha3
kind: EnvoyFilter
metadata:
  name: ratelimit-filter
  namespace: demo
spec:
  workloadSelector:
    labels:
      app: backend
  configPatches:
    - applyTo: HTTP_FILTER
      match:
        context: SIDECAR_INBOUND
        listener:
          filterChain:
            filter:
              name: "envoy.filters.network.http_connection_manager"
              subFilter:
                name: "envoy.filters.http.router"
      patch:
        operation: INSERT_BEFORE
        value:
          name: envoy.filters.http.local_ratelimit
          typed_config:
            "@type": type.googleapis.com/envoy.extensions.filters.http.local_ratelimit.v3.LocalRateLimit
            stat_prefix: http_local_rate_limiter
            token_bucket:
              max_tokens: 100
              tokens_per_fill: 100
              fill_interval: 60s
            filter_enabled:
              runtime_key: local_rate_limit_enabled
              default_value:
                numerator: 100
                denominator: HUNDRED
            filter_enforced:
              runtime_key: local_rate_limit_enforced
              default_value:
                numerator: 100
                denominator: HUNDRED
            response_headers_to_add:
              - append_action: OVERWRITE_IF_EXISTS_OR_ADD
                header:
                  key: x-local-rate-limit
                  value: "true"
```

### 예제 4: 종합 Envoy 설정 (Edge Proxy + 인증 + Rate Limit + Tracing)
```yaml
# 프로덕션 수준의 종합 Envoy 설정 예제이다
static_resources:
  listeners:
    - name: https_listener
      address:
        socket_address: { address: 0.0.0.0, port_value: 443 }
      listener_filters:
        - name: envoy.filters.listener.tls_inspector
          typed_config:
            "@type": type.googleapis.com/envoy.extensions.filters.listener.tls_inspector.v3.TlsInspector
      filter_chains:
        - filter_chain_match:
            server_names: ["api.example.com"]
          transport_socket:
            name: envoy.transport_sockets.tls
            typed_config:
              "@type": type.googleapis.com/envoy.extensions.transport_sockets.tls.v3.DownstreamTlsContext
              common_tls_context:
                tls_params:
                  tls_minimum_protocol_version: TLSv1_2
                tls_certificates:
                  - certificate_chain: { filename: "/certs/api.example.com.crt" }
                    private_key: { filename: "/certs/api.example.com.key" }
                alpn_protocols: ["h2", "http/1.1"]
          filters:
            - name: envoy.filters.network.http_connection_manager
              typed_config:
                "@type": type.googleapis.com/envoy.extensions.filters.network.http_connection_manager.v3.HttpConnectionManager
                stat_prefix: api_ingress
                codec_type: AUTO
                use_remote_address: true
                normalize_path: true
                merge_slashes: true

                # 액세스 로그 (JSON)
                access_log:
                  - name: envoy.access_loggers.file
                    typed_config:
                      "@type": type.googleapis.com/envoy.extensions.access_loggers.file.v3.FileAccessLog
                      path: "/dev/stdout"
                      log_format:
                        json_format:
                          timestamp: "%START_TIME%"
                          method: "%REQ(:METHOD)%"
                          path: "%REQ(:PATH)%"
                          status: "%RESPONSE_CODE%"
                          flags: "%RESPONSE_FLAGS%"
                          duration_ms: "%DURATION%"
                          upstream: "%UPSTREAM_HOST%"
                          trace_id: "%REQ(X-REQUEST-ID)%"

                # 라우팅
                route_config:
                  name: api_routes
                  virtual_hosts:
                    - name: api
                      domains: ["api.example.com"]
                      routes:
                        - match: { prefix: "/v1/users" }
                          route:
                            cluster: user_service
                            timeout: 15s
                            retry_policy:
                              retry_on: "5xx,reset"
                              num_retries: 2
                              per_try_timeout: 5s
                        - match: { prefix: "/v1/orders" }
                          route:
                            cluster: order_service
                            timeout: 30s
                        - match: { prefix: "/" }
                          direct_response:
                            status: 404
                            body: { inline_string: '{"error":"Not Found"}' }

                # HTTP Filter Chain (순서 중요!)
                http_filters:
                  # 1. JWT 인증
                  - name: envoy.filters.http.jwt_authn
                    typed_config:
                      "@type": type.googleapis.com/envoy.extensions.filters.http.jwt_authn.v3.JwtAuthentication
                      providers:
                        main_provider:
                          issuer: "https://auth.example.com"
                          remote_jwks:
                            http_uri:
                              uri: "https://auth.example.com/.well-known/jwks.json"
                              cluster: auth_jwks
                              timeout: 5s
                          forward: true
                      rules:
                        - match: { prefix: "/v1/" }
                          requires:
                            provider_name: main_provider

                  # 2. Rate Limiting
                  - name: envoy.filters.http.local_ratelimit
                    typed_config:
                      "@type": type.googleapis.com/envoy.extensions.filters.http.local_ratelimit.v3.LocalRateLimit
                      stat_prefix: api_ratelimit
                      token_bucket:
                        max_tokens: 5000
                        tokens_per_fill: 5000
                        fill_interval: 60s

                  # 3. 라우터 (마지막)
                  - name: envoy.filters.http.router
                    typed_config:
                      "@type": type.googleapis.com/envoy.extensions.filters.http.router.v3.Router

  clusters:
    - name: user_service
      connect_timeout: 3s
      type: STRICT_DNS
      lb_policy: LEAST_REQUEST
      circuit_breakers:
        thresholds:
          - max_connections: 200
            max_pending_requests: 200
            max_requests: 200
            max_retries: 3
      health_checks:
        - timeout: 3s
          interval: 10s
          unhealthy_threshold: 3
          healthy_threshold: 2
          http_health_check:
            path: "/healthz"
      outlier_detection:
        consecutive_5xx: 5
        interval: 10s
        base_ejection_time: 30s
      load_assignment:
        cluster_name: user_service
        endpoints:
          - lb_endpoints:
              - endpoint:
                  address:
                    socket_address: { address: user-service, port_value: 8080 }

    - name: order_service
      connect_timeout: 3s
      type: STRICT_DNS
      lb_policy: ROUND_ROBIN
      circuit_breakers:
        thresholds:
          - max_connections: 100
            max_pending_requests: 100
            max_requests: 100
            max_retries: 2
      load_assignment:
        cluster_name: order_service
        endpoints:
          - lb_endpoints:
              - endpoint:
                  address:
                    socket_address: { address: order-service, port_value: 8080 }

    - name: auth_jwks
      connect_timeout: 5s
      type: STRICT_DNS
      lb_policy: ROUND_ROBIN
      transport_socket:
        name: envoy.transport_sockets.tls
        typed_config:
          "@type": type.googleapis.com/envoy.extensions.transport_sockets.tls.v3.UpstreamTlsContext
          sni: "auth.example.com"
      load_assignment:
        cluster_name: auth_jwks
        endpoints:
          - lb_endpoints:
              - endpoint:
                  address:
                    socket_address: { address: auth.example.com, port_value: 443 }

admin:
  address:
    socket_address: { address: 127.0.0.1, port_value: 9901 }
```

---

## 자가 점검
- [ ] Envoy의 Downstream → Listener → Network Filter → HCM → HTTP Filter → Route → Cluster → Upstream 전체 흐름을 설명할 수 있는가?
- [ ] Main Thread와 Worker Thread의 역할 차이를 설명할 수 있는가?
- [ ] Thread Local Storage (TLS) 메커니즘이 왜 필요하고, 어떻게 락 없이 데이터를 공유하는지 설명할 수 있는가?
- [ ] Connection Pool이 Worker Thread별로 독립적인 이유와 그로 인한 서킷 브레이커 설정 시 고려사항을 아는가?
- [ ] 공유 메모리의 역할과 Hot Restart에서의 활용을 설명할 수 있는가?
- [ ] Network Filter와 HTTP Filter의 차이점과 대표적인 예시를 알고 있는가?
- [ ] HTTP Filter의 decode/encode 콜백 구조와 반환값(Continue, StopIteration 등)의 의미를 이해하는가?
- [ ] Filter 순서가 보안과 성능에 미치는 영향을 예시와 함께 설명할 수 있는가?
- [ ] ext_authz와 ext_proc의 차이점과 각각의 적합한 사용 시나리오를 아는가?
- [ ] xDS API의 각 종류(LDS, RDS, CDS, EDS, SDS)가 어떤 설정을 담당하는지 설명할 수 있는가?
- [ ] ADS가 왜 필요하고, xDS 업데이트 순서가 왜 중요한지 설명할 수 있는가?
- [ ] SotW xDS와 Delta xDS의 차이점과 각각의 장단점을 알고 있는가?
- [ ] ACK/NACK 메커니즘이 어떻게 동작하는지 설명할 수 있는가?
- [ ] Warming 과정이 무엇이고, 왜 필요한지 설명할 수 있는가?
- [ ] Istio의 istiod(Pilot)가 어떻게 xDS를 통해 Envoy 설정을 push하는지 설명할 수 있는가?
- [ ] Sidecar CRD를 사용하여 xDS 범위를 제한하는 이유와 방법을 아는가?
- [ ] Cluster Discovery Type(STATIC, STRICT_DNS, LOGICAL_DNS, EDS, ORIGINAL_DST)의 차이를 설명할 수 있는가?
- [ ] 로드밸런싱 알고리즘(Round Robin, Least Request, Ring Hash, Maglev)의 차이와 적합한 사용 사례를 알고 있는가?
- [ ] Zone-aware 로드밸런싱의 동작 원리와 패닉 모드를 설명할 수 있는가?
- [ ] Priority Level 로드밸런싱을 사용한 계층적 장애 조치를 설계할 수 있는가?
- [ ] Active Health Checking과 Passive Health Checking(Outlier Detection)의 차이를 설명할 수 있는가?
- [ ] Outlier Detection의 세 가지 감지 방식(Consecutive Errors, Success Rate, Failure Percentage)을 설명할 수 있는가?
- [ ] 서킷 브레이커 파라미터(max_connections, max_pending_requests, max_requests, max_retries)의 의미를 알고 있는가?
- [ ] 서킷 브레이커와 재시도 정책의 상호작용을 이해하는가?
- [ ] Hot Restart가 어떻게 무중단 업데이트를 달성하는지 설명할 수 있는가?
- [ ] TLS/mTLS 설정에서 SDS의 역할과 Istio의 인증서 관리 과정을 설명할 수 있는가?
- [ ] SPIFFE ID의 형식과 RBAC에서의 활용을 아는가?
- [ ] RESPONSE_FLAGS(UF, UO, NR, UT 등)를 보고 문제를 진단할 수 있는가?
- [ ] Admin 인터페이스의 주요 엔드포인트와 각각의 용도를 알고 있는가?
- [ ] Local Rate Limit과 Global Rate Limit의 차이점과 조합 전략을 설명할 수 있는가?
- [ ] `istioctl proxy-config`과 Admin 인터페이스를 사용하여 Envoy 설정과 상태를 확인할 수 있는가?
- [ ] Wasm Filter의 Proxy-Wasm ABI 구조와 개발 방법을 이해하는가?
- [ ] Istio의 Sidecar Injection 과정과 iptables 규칙을 설명할 수 있는가?
- [ ] Overload Manager의 역할과 설정 방법을 아는가?
- [ ] 카나리 배포, 장애 격리(Bulkhead), Fault Injection 등의 실전 패턴을 구현할 수 있는가?

---

## 참고문헌

### 공식 문서
- Envoy 공식 문서: https://www.envoyproxy.io/docs/
- Envoy GitHub 저장소: https://github.com/envoyproxy/envoy
- Envoy API Reference (v3): https://www.envoyproxy.io/docs/envoy/latest/api-v3/api
- Envoy 아키텍처 개요: https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/arch_overview

### xDS 프로토콜
- xDS REST and gRPC Protocol: https://www.envoyproxy.io/docs/envoy/latest/api-docs/xds_protocol
- data-plane-api (xDS API 정의): https://github.com/envoyproxy/data-plane-api
- Universal Data Plane API: https://blog.envoyproxy.io/the-universal-data-plane-api-d15cec7a

### Wasm 확장
- Proxy-Wasm Specification: https://github.com/proxy-wasm/spec
- Proxy-Wasm Rust SDK: https://github.com/proxy-wasm/proxy-wasm-rust-sdk
- Proxy-Wasm Go SDK: https://github.com/tetratelabs/proxy-wasm-go-sdk
- Proxy-Wasm ABI Specification: https://github.com/proxy-wasm/spec/tree/master/abi-versions

### Istio 연동
- Istio의 Envoy 설정 이해: https://istio.io/latest/docs/ops/diagnostic-tools/proxy-cmd/
- Istio EnvoyFilter API: https://istio.io/latest/docs/reference/config/networking/envoy-filter/
- Istio WasmPlugin API: https://istio.io/latest/docs/reference/config/proxy_extensions/wasm-plugin/
- Istio Ambient Mode: https://istio.io/latest/docs/ambient/

### 심화 학습
- Envoy 스레딩 모델 (공식 블로그): https://blog.envoyproxy.io/envoy-threading-model-a8d44b922310
- Envoy Hot Restart 구현: https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/operations/hot_restart
- Envoy 통계 개요: https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/observability/statistics
- Life of a Request: https://www.envoyproxy.io/docs/envoy/latest/intro/life_of_a_request
- Envoy Performance Best Practices: https://www.envoyproxy.io/docs/envoy/latest/faq/performance/performance

### Rate Limiting
- Envoy Rate Limit 서비스: https://github.com/envoyproxy/ratelimit
- Rate Limit 설계 패턴: https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/other_features/global_rate_limiting

### 보안
- Envoy TLS 설정 가이드: https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/security/ssl
- SPIFFE 표준: https://spiffe.io/docs/latest/spiffe/overview/
- Istio Security: https://istio.io/latest/docs/concepts/security/
