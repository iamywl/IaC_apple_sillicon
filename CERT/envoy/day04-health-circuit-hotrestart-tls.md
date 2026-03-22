# Day 4: 헬스체크, 서킷 브레이커, Hot Restart, TLS/mTLS

> Envoy의 헬스체크(Active/Passive) 메커니즘, 서킷 브레이커 설정, 무중단 업데이트를 위한 Hot Restart, TLS/mTLS 보안 설정을 학습한다.

## 헬스체크 (Health Checking)

### Active Health Checking

Envoy가 주기적으로 업스트림 엔드포인트에 직접 헬스체크 요청을 보내는 방식이다.

| 타입 | 설명 |
|------|------|
| HTTP | 지정된 path로 HTTP 요청을 보내고, 응답 코드로 건강 상태를 판단한다 |
| TCP | TCP 연결 수립 가능 여부로 건강 상태를 판단한다. 선택적으로 페이로드 매칭도 가능하다 |
| gRPC | gRPC Health Checking Protocol (`grpc.health.v1.Health`)을 사용한다 |

```yaml
clusters:
  - name: backend_service
    health_checks:
      - timeout: 5s
        interval: 10s                    # 체크 주기
        unhealthy_threshold: 3           # 연속 3회 실패 시 unhealthy 판정
        healthy_threshold: 2             # 연속 2회 성공 시 healthy 복귀
        http_health_check:
          path: "/healthz"
          expected_statuses:
            - start: 200
              end: 299
```

### Active Health Check 상세 설정

```yaml
health_checks:
  - timeout: 3s
    interval: 10s
    initial_jitter: 1s                  # 첫 번째 체크의 지터 (동시 체크 방지)
    interval_jitter: 1s                 # 체크 간격의 지터
    interval_jitter_percent: 10         # 체크 간격의 지터 비율
    unhealthy_threshold: 3
    healthy_threshold: 2
    no_traffic_interval: 60s            # 트래픽이 없는 엔드포인트의 체크 간격 (길게)
    no_traffic_healthy_interval: 30s    # 트래픽 없는 healthy 엔드포인트의 체크 간격
    unhealthy_interval: 5s             # unhealthy 엔드포인트의 체크 간격 (짧게)
    unhealthy_edge_interval: 3s        # healthy→unhealthy 전환 직후의 체크 간격
    healthy_edge_interval: 5s          # unhealthy→healthy 전환 직후의 체크 간격
    always_log_health_check_failures: true

    http_health_check:
      path: "/healthz"
      host: "health.backend.local"      # Host 헤더 (SNI 기반 라우팅 시 필요)
      request_headers_to_add:
        - header:
            key: "x-health-check"
            value: "envoy"
          append_action: OVERWRITE_IF_EXISTS_OR_ADD
      expected_statuses:
        - start: 200
          end: 200
      codec_client_type: HTTP2          # HTTP/2로 헬스체크

    event_log_path: "/dev/stdout"       # 헬스체크 이벤트 로그
```

### Passive Health Checking (Outlier Detection)

실제 트래픽의 응답을 분석하여 비정상 엔드포인트를 자동 감지하고 제거하는 방식이다. Active Health Checking과 병행하여 사용하는 것이 권장된다.

```yaml
clusters:
  - name: backend_service
    outlier_detection:
      consecutive_5xx: 5                  # 연속 5xx 에러 5회 시 퇴출
      interval: 10s                       # 분석 주기
      base_ejection_time: 30s             # 기본 퇴출 시간 (횟수에 따라 증가)
      max_ejection_percent: 50            # 최대 퇴출 비율 (50% 이상 퇴출 방지)
      consecutive_gateway_failure: 3      # 연속 게이트웨이 실패 3회 시 퇴출
      success_rate_minimum_hosts: 3       # 성공률 분석 최소 호스트 수
      success_rate_stdev_factor: 1900     # 성공률 표준편차 팩터 (19 = 평균 - 1.9*표준편차)
```

### Outlier Detection 상세 메커니즘

Outlier Detection은 세 가지 감지 방식을 제공한다:

**1. Consecutive Errors (연속 에러):**
```
Endpoint A 응답: 200, 200, 500, 500, 500, 500, 500
                                          ↑ consecutive_5xx: 5 도달
                                          → 퇴출!
```

**2. Success Rate (성공률):**
```
분석 주기(interval)마다 각 엔드포인트의 성공률을 계산한다:
  Endpoint A: 성공률 95%
  Endpoint B: 성공률 92%
  Endpoint C: 성공률 60%  ← 평균(82.3%) - 1.9 * 표준편차 미만
                            → 퇴출!

success_rate_stdev_factor: 1900 = 1.9 (100으로 나눈 값)
```

**3. Failure Percentage (실패 비율):**
```yaml
outlier_detection:
  failure_percentage_threshold: 85       # 실패 비율 임계치
  failure_percentage_minimum_hosts: 5    # 최소 호스트 수
  failure_percentage_request_volume: 50  # 최소 요청량
  enforcing_failure_percentage: 100      # 적용 비율 (100%)
```

**퇴출 시간 증가:**

반복적으로 퇴출되는 엔드포인트는 점점 더 오래 퇴출된다:

```
퇴출 시간 = base_ejection_time × 퇴출 횟수

1회째: 30s × 1 = 30s
2회째: 30s × 2 = 60s
3회째: 30s × 3 = 90s
...
최대: max_ejection_time (기본 300s)까지 증가
```

**Active Health Check와 Outlier Detection의 조합:**

| 상황 | Active HC 결과 | Outlier Detection | 최종 상태 |
|------|----------------|-------------------|----------|
| 정상 운영 | Healthy | 정상 | HEALTHY |
| 간헐적 에러 | Healthy | 퇴출 | UNHEALTHY (퇴출) |
| 서비스 다운 | Unhealthy | 퇴출 | UNHEALTHY |
| 에러 후 복구 | Healthy | 퇴출 기간 만료 | HEALTHY |

Active HC가 Healthy로 판정하면 Outlier Detection의 퇴출이 즉시 해제될 수 있다 (`successful_active_health_check_uneject_host` 설정).

---

## 서킷 브레이커 (Circuit Breaking)

Envoy는 Cluster 단위로 서킷 브레이커를 설정하여 업스트림 서비스의 과부하를 방지한다.

### 주요 파라미터

| 파라미터 | 기본값 | 설명 |
|----------|--------|------|
| `max_connections` | 1024 | 클러스터에 대한 최대 동시 TCP 연결 수이다. 초과 시 새 연결 요청이 큐잉되거나 거부된다 |
| `max_pending_requests` | 1024 | 연결 풀에서 대기 중인 최대 요청 수이다. 초과 시 즉시 503 응답을 반환한다 |
| `max_requests` | 1024 | 클러스터에 대한 최대 동시 요청 수이다 (HTTP/2 멀티플렉싱 기준) |
| `max_retries` | 3 | 클러스터에 대한 최대 동시 재시도 수이다. 재시도 폭주(retry storm)를 방지한다 |
| `max_connection_pools` | 무제한 | 최대 연결 풀 수이다 |

```yaml
clusters:
  - name: backend_service
    circuit_breakers:
      thresholds:
        - priority: DEFAULT
          max_connections: 100
          max_pending_requests: 100
          max_requests: 100
          max_retries: 3
          track_remaining: true     # 남은 리소스 수를 통계에 노출한다
        - priority: HIGH            # 높은 우선순위 요청에 대해 별도 임계치 설정
          max_connections: 200
          max_pending_requests: 200
          max_requests: 200
          max_retries: 5
```

서킷 브레이커가 트리거되면 `upstream_cx_overflow`, `upstream_rq_pending_overflow` 등의 통계 카운터가 증가한다. 이를 모니터링하여 적절한 임계치를 조정해야 한다.

### 서킷 브레이커 동작 시나리오

```
시나리오: max_pending_requests = 100, 업스트림이 느려진 경우

시간 T0: 정상 상태, pending = 0
시간 T1: 업스트림 응답 지연 시작, pending 증가
시간 T2: pending = 100 도달
시간 T3: 새 요청 도착 → 즉시 503 응답 (RESPONSE_FLAGS: UO)
         → upstream_rq_pending_overflow 카운터 +1

이 503 응답은 업스트림에 전달되지 않는다.
→ 이미 과부하 상태인 업스트림에 추가 부하를 주지 않는 것이 핵심이다.
```

**서킷 브레이커 모니터링:**

```bash
export KUBECONFIG=kubeconfig/dev.yaml

# 서킷 브레이커 통계 확인
kubectl exec -it <pod-name> -n demo -c istio-proxy -- \
  curl -s localhost:15000/stats | grep "circuit_breakers"

# 주요 관찰 메트릭:
# cluster.<name>.circuit_breakers.default.cx_open           현재 열린 연결 수
# cluster.<name>.circuit_breakers.default.rq_pending_open   현재 대기 중인 요청 수
# cluster.<name>.circuit_breakers.default.rq_open           현재 활성 요청 수
# cluster.<name>.circuit_breakers.default.rq_retry_open     현재 재시도 수
# cluster.<name>.circuit_breakers.default.remaining_cx      남은 연결 용량
# cluster.<name>.circuit_breakers.default.remaining_pending 남은 대기 용량
# cluster.<name>.circuit_breakers.default.remaining_rq      남은 요청 용량
# cluster.<name>.circuit_breakers.default.remaining_retries 남은 재시도 용량

# overflow 카운터 (서킷 브레이커 발동 횟수)
kubectl exec -it <pod-name> -n demo -c istio-proxy -- \
  curl -s localhost:15000/stats | grep "upstream_rq_pending_overflow\|upstream_cx_overflow"
```

---

## Hot Restart 메커니즘

Hot Restart는 Envoy가 무중단으로 바이너리 또는 설정을 교체하는 메커니즘이다.

### 동작 과정
```
시간 ──────────────────────────────────────────▶

 Old Envoy Process (Parent)
 ┌─────────────────────────────────────┐
 │  정상 운영 중                         │
 │  ① 새 프로세스 시작 신호 수신           │
 │  ② 리스닝 소켓을 새 프로세스에 전달      │
 │  ③ drain 시작 (기존 연결 종료 대기)     │
 │  ④ drain 기간 만료 후 종료             │
 └─────────────────────────────────────┘

 New Envoy Process (Child)
                ┌──────────────────────────────┐
                │  ② 소켓 수신, 리스닝 시작       │
                │  ③ 새 연결 수락                 │
                │  ④ 완전 인수 완료               │
                │  정상 운영 계속                  │
                └──────────────────────────────┘

         ↑                        ↑
     새 프로세스 시작          drain 완료, 이전 프로세스 종료
```

- **Unix Domain Socket(UDS)**을 통해 부모-자식 프로세스 간 통신한다
- **소켓 전달**: 부모 프로세스의 리스닝 소켓 FD를 자식 프로세스에 전달하여, 동일 포트에서 즉시 수신을 시작한다
- **공유 메모리**: 통계 카운터를 공유 메모리에 저장하여 프로세스 교체 시에도 통계가 유지된다
- **Drain 기간**: `--drain-time-s` 플래그로 설정하며, 기본값은 600초이다. 이 기간 동안 기존 연결을 우아하게(gracefully) 종료한다
- **Parent Shutdown 기간**: `--parent-shutdown-time-s` 플래그로 설정하며, 기본값은 900초이다

### Hot Restart 상세 과정

```
Phase 1: 초기화
  새 프로세스가 --restart-epoch N+1 플래그와 함께 시작된다
  UDS(/dev/shm/envoy_domain_socket_N)를 통해 부모 프로세스에 연결한다

Phase 2: 소켓 전달
  새 프로세스가 부모에게 리스닝 소켓 FD를 요청한다
  부모가 SCM_RIGHTS ancillary message로 소켓 FD를 전달한다
  새 프로세스가 전달받은 소켓에서 즉시 accept()를 시작한다
  → 이 시점부터 두 프로세스 모두 새 연결을 수락할 수 있다

Phase 3: 통계 전달
  새 프로세스가 부모에게 통계 데이터를 요청한다
  공유 메모리 영역을 통해 Counter 값을 전달받는다
  → 통계의 연속성이 보장된다

Phase 4: Drain
  부모 프로세스가 drain 모드에 진입한다
  - 새 연결 수락을 중단한다 (리스닝 소켓 닫음)
  - 기존 연결은 계속 서비스한다
  - HTTP/2 GOAWAY 프레임을 전송한다
  - drain_time_s 동안 기존 연결이 자연스럽게 종료되기를 기다린다

Phase 5: 종료
  parent_shutdown_time_s 만료 후 부모 프로세스가 강제 종료된다
  남아있는 연결이 있으면 강제로 끊는다
```

### Kubernetes에서의 Hot Restart

Istio 사이드카 환경에서는 Envoy의 Hot Restart 대신 Kubernetes의 Pod 롤링 업데이트가 사용된다. 그러나 Envoy 설정 변경(xDS push)은 Hot Restart 없이 실시간으로 반영된다. xDS를 통한 동적 설정 업데이트는 프로세스 재시작이 필요 없다.

Istio가 Envoy 바이너리를 업그레이드할 때는 Pod를 재생성하는 방식을 사용한다. `istio-proxy` 컨테이너의 이미지가 변경되면 Pod가 새로 생성되고, 기존 Pod는 `terminationGracePeriodSeconds` 동안 drain된다.

---

## TLS/mTLS 설정 심화

### TLS Context 구조

Envoy의 TLS 설정은 Downstream(클라이언트 방향)과 Upstream(서버 방향)으로 구분된다:

```yaml
# Downstream TLS (클라이언트 → Envoy)
transport_socket:
  name: envoy.transport_sockets.tls
  typed_config:
    "@type": type.googleapis.com/envoy.extensions.transport_sockets.tls.v3.DownstreamTlsContext
    require_client_certificate: true    # mTLS: 클라이언트 인증서 요구
    common_tls_context:
      tls_params:
        tls_minimum_protocol_version: TLSv1_2
        tls_maximum_protocol_version: TLSv1_3
        cipher_suites:
          - "[ECDHE-ECDSA-AES128-GCM-SHA256|ECDHE-ECDSA-CHACHA20-POLY1305]"
          - "[ECDHE-RSA-AES128-GCM-SHA256|ECDHE-RSA-CHACHA20-POLY1305]"
      tls_certificates:
        - certificate_chain: { filename: "/certs/server.crt" }
          private_key: { filename: "/certs/server.key" }
      validation_context:
        trusted_ca: { filename: "/certs/ca.crt" }        # 클라이언트 인증서 검증용 CA
        match_typed_subject_alt_names:
          - san_type: URI
            matcher:
              exact: "spiffe://cluster.local/ns/demo/sa/frontend"
```

```yaml
# Upstream TLS (Envoy → 백엔드)
transport_socket:
  name: envoy.transport_sockets.tls
  typed_config:
    "@type": type.googleapis.com/envoy.extensions.transport_sockets.tls.v3.UpstreamTlsContext
    sni: "backend.example.com"           # TLS SNI
    common_tls_context:
      tls_certificates:
        - certificate_chain: { filename: "/certs/client.crt" }
          private_key: { filename: "/certs/client.key" }
      validation_context:
        trusted_ca: { filename: "/certs/ca.crt" }
        match_typed_subject_alt_names:
          - san_type: DNS
            matcher:
              exact: "backend.example.com"
```

### SDS (Secret Discovery Service)

SDS를 사용하면 인증서를 파일 시스템 대신 동적으로 수신할 수 있다. Istio에서는 SDS가 핵심적인 역할을 한다:

```yaml
# SDS를 통한 TLS 인증서 로드
transport_socket:
  name: envoy.transport_sockets.tls
  typed_config:
    "@type": type.googleapis.com/envoy.extensions.transport_sockets.tls.v3.DownstreamTlsContext
    common_tls_context:
      tls_certificate_sds_secret_configs:
        - name: "default"                    # SDS 리소스 이름
          sds_config:
            resource_api_version: V3
            api_config_source:
              api_type: GRPC
              grpc_services:
                - envoy_grpc:
                    cluster_name: sds_server
      combined_validation_context:
        default_validation_context: {}
        validation_context_sds_secret_config:
          name: "ROOTCA"                     # Root CA의 SDS 리소스 이름
          sds_config:
            resource_api_version: V3
            api_config_source:
              api_type: GRPC
              grpc_services:
                - envoy_grpc:
                    cluster_name: sds_server
```

### Istio의 인증서 관리와 SDS

Istio에서 mTLS 인증서의 전체 생명주기:

```
1. Pod 생성 시:
   ┌─────────────┐     ┌──────────┐     ┌──────────────┐
   │ istio-agent  │────▶│  istiod   │────▶│ Kubernetes   │
   │ (pilot-agent)│     │  (CA)    │     │ CA / Cert    │
   └──────┬──────┘     └──────────┘     │ Manager      │
          │                              └──────────────┘
          │ CSR (Certificate Signing Request) 생성
          │ → istiod에 전송
          │ → istiod가 서명하여 인증서 반환
          │
          ▼
   ┌─────────────┐
   │ SDS Server  │  ← istio-agent가 내장 SDS 서버를 실행한다
   │ (in-process)│     UDS: /var/run/secrets/workload-spiffe-uds/socket
   └──────┬──────┘
          │
          │ SDS API (gRPC over UDS)
          │
          ▼
   ┌──────────────┐
   │    Envoy     │  ← SDS를 통해 인증서를 수신한다
   │  (Sidecar)   │     파일 시스템에 인증서를 저장하지 않는다!
   └──────────────┘

2. 인증서 로테이션 (기본 24시간마다):
   istio-agent가 인증서 만료 전에 자동으로 새 CSR을 생성한다
   istiod가 새 인증서를 서명하여 반환한다
   SDS를 통해 Envoy에 즉시 반영된다
   → Envoy 재시작 불필요, 연결 중단 없음
```

### SPIFFE (Secure Production Identity Framework for Everyone)

Istio는 SPIFFE 표준을 사용하여 워크로드 ID를 관리한다. 각 워크로드의 인증서에는 SPIFFE ID가 SAN(Subject Alternative Name)으로 포함된다:

```
SPIFFE ID 형식:
spiffe://<trust-domain>/ns/<namespace>/sa/<service-account>

예시:
spiffe://cluster.local/ns/demo/sa/frontend
spiffe://cluster.local/ns/demo/sa/backend
```

이 SPIFFE ID는 Envoy의 RBAC 필터에서 접근 제어에 사용된다:

```yaml
# Istio AuthorizationPolicy → Envoy RBAC로 변환
apiVersion: security.istio.io/v1
kind: AuthorizationPolicy
metadata:
  name: backend-policy
  namespace: demo
spec:
  selector:
    matchLabels:
      app: backend
  rules:
    - from:
        - source:
            principals: ["cluster.local/ns/demo/sa/frontend"]  # SPIFFE ID
      to:
        - operation:
            methods: ["GET", "POST"]
            paths: ["/api/*"]
```

이 정책은 Envoy의 RBAC 필터 설정으로 변환된다:

```yaml
# Envoy에 적용되는 실제 RBAC 설정
typed_per_filter_config:
  envoy.filters.http.rbac:
    "@type": type.googleapis.com/envoy.extensions.filters.http.rbac.v3.RBACPerRoute
    rbac:
      rules:
        action: ALLOW
        policies:
          backend-policy:
            permissions:
              - and_rules:
                  rules:
                    - url_path:
                        path: { prefix: "/api/" }
                    - or_rules:
                        rules:
                          - header:
                              name: ":method"
                              string_match: { exact: "GET" }
                          - header:
                              name: ":method"
                              string_match: { exact: "POST" }
            principals:
              - authenticated:
                  principal_name:
                    exact: "spiffe://cluster.local/ns/demo/sa/frontend"
```

### Istio PeerAuthentication과 TLS 모드

```yaml
apiVersion: security.istio.io/v1
kind: PeerAuthentication
metadata:
  name: default
  namespace: demo
spec:
  mtls:
    mode: STRICT          # 모든 트래픽에 mTLS를 강제한다

# 다른 모드 옵션:
# PERMISSIVE: mTLS와 plaintext 모두 허용 (마이그레이션 시 유용)
# DISABLE: mTLS 비활성화
# UNSET: 상위 설정을 상속
```

**PERMISSIVE 모드의 동작:**

```
Envoy Listener (Inbound, port 15006)
     │
     ├── TLS Inspector가 ClientHello를 감지하는가?
     │    ├── Yes → TLS Filter Chain 선택 → mTLS 핸드셰이크
     │    └── No  → Plaintext Filter Chain 선택 → 그대로 처리
```

PERMISSIVE 모드는 메시 마이그레이션 시 유용하다. 사이드카가 주입되지 않은 서비스에서 오는 plaintext 트래픽과 사이드카가 있는 서비스에서 오는 mTLS 트래픽을 모두 처리할 수 있다.

---

