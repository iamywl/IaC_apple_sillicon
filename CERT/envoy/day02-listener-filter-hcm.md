# Day 2: Listener, Filter Chain, HTTP Connection Manager

> Envoy의 Listener 구조 심화, Filter Chain 매칭 및 처리 메커니즘, HTTP Connection Manager(HCM)의 라우팅/재시도/타임아웃 설정을 학습한다.

## Listener 구조 심화

Listener는 Envoy가 다운스트림 연결을 수신하는 진입점이다. 단순히 "포트를 열고 트래픽을 받는 것" 이상의 복잡한 구조를 가진다.

### Listener의 전체 구조

```
Listener
├── address: 0.0.0.0:15006 (Inbound) 또는 0.0.0.0:15001 (Outbound)
├── listener_filters:                    ← 연결 수준 필터 (프로토콜 판별)
│   ├── envoy.filters.listener.tls_inspector
│   ├── envoy.filters.listener.http_inspector
│   └── envoy.filters.listener.original_dst
├── filter_chains:                       ← 프로토콜/SNI별 필터 체인
│   ├── filter_chain_match:              ← 매칭 조건
│   │   ├── server_names: ["*.example.com"]
│   │   ├── transport_protocol: "tls"
│   │   ├── application_protocols: ["h2", "http/1.1"]
│   │   └── destination_port: 8080
│   ├── transport_socket:                ← TLS 설정
│   │   └── DownstreamTlsContext
│   └── filters:                         ← Network Filter 목록
│       └── envoy.filters.network.http_connection_manager
├── default_filter_chain:                ← 매칭되지 않는 연결의 기본 처리
├── per_connection_buffer_limit_bytes: 1048576
└── use_original_dst: true               ← iptables redirect 원래 목적지 사용
```

### Listener Filter 상세

Listener Filter는 TCP 연결이 수립된 직후, Filter Chain이 선택되기 전에 실행된다. 주 목적은 연결의 메타데이터를 추출하여 올바른 Filter Chain을 선택할 수 있게 하는 것이다.

| Listener Filter | 동작 |
|-----------------|------|
| `tls_inspector` | ClientHello 메시지를 파싱하여 SNI(Server Name Indication)와 ALPN(Application-Layer Protocol Negotiation)을 추출한다. TLS 연결의 경우 반드시 필요하다 |
| `http_inspector` | 연결의 첫 번째 바이트를 검사하여 HTTP 프로토콜인지 판별한다. 비TLS 연결에서 HTTP와 TCP 트래픽을 구분하는 데 사용된다 |
| `original_dst` | `SO_ORIGINAL_DST` 소켓 옵션을 사용하여 iptables REDIRECT 전의 원래 목적지 주소를 복원한다. Istio 사이드카에서 필수적이다 |
| `proxy_protocol` | HAProxy PROXY Protocol 헤더를 파싱하여 원래 클라이언트 IP를 추출한다. L4 로드밸런서 뒤에 위치할 때 사용한다 |

**Listener Filter의 타이머**: Listener Filter는 `listener_filters_timeout` 설정에 의해 시간 제한이 있다. 기본값은 15초이다. 이 시간 내에 필요한 데이터를 수신하지 못하면 연결을 종료한다. 이는 slowloris 공격 같은 시나리오에서 중요하다.

### Filter Chain Match 규칙

하나의 Listener에 여러 Filter Chain이 정의될 수 있다. Envoy는 가장 구체적인 매칭을 선택한다:

```yaml
filter_chains:
  # Chain 1: TLS + HTTP/2, *.example.com
  - filter_chain_match:
      server_names: ["*.example.com"]
      transport_protocol: "tls"
      application_protocols: ["h2"]
    transport_socket:
      name: envoy.transport_sockets.tls
      typed_config:
        "@type": type.googleapis.com/envoy.extensions.transport_sockets.tls.v3.DownstreamTlsContext
        common_tls_context:
          tls_certificates:
            - certificate_chain: { filename: "/certs/example.com.crt" }
              private_key: { filename: "/certs/example.com.key" }
    filters:
      - name: envoy.filters.network.http_connection_manager
        typed_config:
          "@type": type.googleapis.com/envoy.extensions.filters.network.http_connection_manager.v3.HttpConnectionManager
          codec_type: HTTP2
          stat_prefix: ingress_h2
          # ... HTTP Filter 설정

  # Chain 2: TLS + HTTP/1.1, 모든 도메인
  - filter_chain_match:
      transport_protocol: "tls"
      application_protocols: ["http/1.1"]
    filters:
      - name: envoy.filters.network.http_connection_manager
        # ...

  # Chain 3: 비TLS TCP 트래픽
  - filter_chain_match:
      transport_protocol: "raw_buffer"
    filters:
      - name: envoy.filters.network.tcp_proxy
        typed_config:
          "@type": type.googleapis.com/envoy.extensions.filters.network.tcp_proxy.v3.TcpProxy
          cluster: passthrough_cluster
          stat_prefix: tcp_passthrough
```

매칭 우선순위: `destination_port` > `server_names` > `transport_protocol` > `application_protocols` > `source_type` > `source_prefix_ranges` > `source_ports` 순이다. 가장 많은 조건이 일치하는 Filter Chain이 선택된다.

### Istio Sidecar의 Listener 구조

Istio 사이드카의 Envoy는 두 개의 주요 Listener를 가진다:

```
Istio Sidecar Envoy Listeners
│
├── virtualInbound (0.0.0.0:15006)
│   ├── 외부에서 이 Pod로 들어오는 모든 인바운드 트래픽을 처리한다
│   ├── Filter Chain:
│   │   ├── mTLS 연결 → TLS 종단 + HTTP 처리
│   │   ├── Plaintext HTTP → HTTP 처리 (permissive mode)
│   │   └── TCP → TCP Proxy (비HTTP 프로토콜)
│   └── 최종적으로 localhost:<app-port>로 전달한다
│
├── virtualOutbound (0.0.0.0:15001)
│   ├── 이 Pod에서 나가는 모든 아웃바운드 트래픽을 처리한다
│   ├── use_original_dst: true
│   │   → iptables redirect 전의 원래 목적지로 라우팅한다
│   ├── 매칭되는 서비스가 있으면 해당 Cluster로 라우팅한다
│   └── 매칭되지 않으면 PassthroughCluster 또는 BlackHoleCluster로 전달한다
│
├── 0.0.0.0_80 (서비스별 Listener)
│   ├── 특정 포트에 대한 아웃바운드 트래픽을 처리한다
│   └── Virtual Host별로 라우팅 규칙이 정의된다
│
└── 0.0.0.0_443, 0.0.0.0_8080 ... (추가 서비스별 Listener)
```

이 구조를 확인하려면:
```bash
export KUBECONFIG=kubeconfig/dev.yaml
istioctl proxy-config listener <pod-name> -n demo
```

---

## Filter Chain 메커니즘

Envoy의 확장성은 Filter Chain 구조에서 비롯된다. Filter는 크게 **Network Filter**와 **HTTP Filter** 두 계층으로 나뉜다.

### Network Filter (L3/L4)

Listener에 직접 연결되는 필터이다. TCP 연결 레벨에서 동작한다.

| Filter | 설명 |
|--------|------|
| `envoy.filters.network.tcp_proxy` | TCP 프록시. L4에서 그대로 트래픽을 업스트림으로 전달한다 |
| `envoy.filters.network.http_connection_manager` (HCM) | HTTP 프로토콜을 파싱하고, 내부의 HTTP Filter Chain을 실행한다. 가장 핵심적인 Network Filter이다 |
| `envoy.filters.network.redis_proxy` | Redis 프로토콜 인식 프록시이다 |
| `envoy.filters.network.mongo_proxy` | MongoDB 프로토콜 인식 프록시이다 |
| `envoy.filters.network.mysql_proxy` | MySQL 프로토콜 인식 프록시이다 |

Network Filter는 세 가지 타입이 있다:
- **Read Filter**: 다운스트림에서 데이터를 수신할 때 호출된다
- **Write Filter**: 다운스트림에 데이터를 전송할 때 호출된다
- **Read/Write Filter**: 양방향 모두에서 호출된다

#### Network Filter 콜백 상세

Network Filter는 다음 콜백 인터페이스를 구현한다:

```cpp
// Read Filter 인터페이스
class ReadFilter {
  // 다운스트림에서 데이터가 도착했을 때 호출된다
  FilterStatus onData(Buffer::Instance& data, bool end_stream);

  // 새 연결이 수립되었을 때 호출된다
  FilterStatus onNewConnection();

  // Filter Chain 초기화 완료 후 호출된다
  void initializeReadFilterCallbacks(ReadFilterCallbacks& callbacks);
};

// 반환값
enum class FilterStatus {
  Continue,       // 다음 필터로 진행한다
  StopIteration   // 현재 필터에서 중단한다 (비동기 작업 대기)
};
```

`StopIteration`을 반환하면 해당 필터에서 처리가 멈추고, 필터가 명시적으로 `continueReading()`을 호출할 때까지 대기한다. 이 메커니즘은 외부 인증 서비스 호출 같은 비동기 작업에 사용된다.

### HTTP Filter (L7)

HCM 내부에서 실행되며, HTTP 요청/응답을 처리한다. 순서가 중요하다 — 설정에 정의된 순서대로 실행된다.

| Filter | 설명 |
|--------|------|
| `envoy.filters.http.router` | 최종 라우팅을 수행하는 필터이다. 반드시 HTTP Filter Chain의 마지막에 위치해야 한다 |
| `envoy.filters.http.rbac` | Role-Based Access Control. 요청의 소스 IP, 헤더, path 등을 기반으로 접근을 제어한다 |
| `envoy.filters.http.ratelimit` | 외부 Rate Limit 서비스와 연동하여 요청 빈도를 제한한다 |
| `envoy.filters.http.lua` | Lua 스크립트로 요청/응답을 동적으로 조작한다. 간단한 커스텀 로직에 적합하다 |
| `envoy.filters.http.wasm` | WebAssembly 모듈을 로드하여 실행한다. 고성능 커스텀 필터 개발에 사용된다 |
| `envoy.filters.http.ext_authz` | 외부 인가 서비스에 요청을 위임한다. HTTP 또는 gRPC로 통신한다 |
| `envoy.filters.http.jwt_authn` | JWT 토큰 검증을 수행한다. JWKS 엔드포인트에서 공개키를 가져와 서명을 확인한다 |
| `envoy.filters.http.fault` | 장애 주입(Fault Injection)을 수행한다. 지연이나 에러를 인위적으로 발생시켜 복원력을 테스트한다 |
| `envoy.filters.http.cors` | Cross-Origin Resource Sharing 정책을 적용한다 |
| `envoy.filters.http.ext_proc` | External Processing. 외부 gRPC 서비스에 요청/응답 처리를 위임한다 |
| `envoy.filters.http.compressor` | 응답 본문을 gzip/brotli/zstd로 압축한다 |
| `envoy.filters.http.grpc_json_transcoder` | gRPC 서비스를 REST JSON API로 변환한다 |
| `envoy.filters.http.header_to_metadata` | 요청 헤더 값을 동적 메타데이터로 변환한다. 다른 필터에서 참조할 수 있다 |

#### HTTP Filter 콜백 상세

HTTP Filter는 요청 경로(decode)와 응답 경로(encode)에서 각각 콜백을 받는다:

```
요청 경로 (Decode Path):     응답 경로 (Encode Path):
Client → Envoy               Envoy → Client

decodeHeaders()               encodeHeaders()
     │                              ▲
     ▼                              │
decodeData()                  encodeData()
     │                              ▲
     ▼                              │
decodeTrailers()              encodeTrailers()
     │                              ▲
     ▼                              │
 Router Filter ──────────── Upstream 응답 수신
```

각 콜백에서 반환할 수 있는 상태:

| 반환값 | 의미 |
|--------|------|
| `Continue` | 다음 필터로 진행한다 |
| `StopIteration` | 현재 필터에서 중단한다. 데이터를 버퍼링한다 |
| `StopAndBuffer` | 중단하고, 추가 데이터를 버퍼에 축적한다 |
| `StopAndWatermark` | 중단하고, 워터마크 기반 흐름 제어를 적용한다 |
| `StopAllIterationAndBuffer` | 헤더부터 모든 후속 데이터까지 버퍼링한다 |
| `StopAllIterationAndWatermark` | 헤더부터 워터마크 기반 버퍼링한다 |

### Filter Chain 실행 흐름
```
요청 수신 (Downstream)
     │
     ▼
┌─ Network Filter Chain ──────────────────────────┐
│                                                   │
│  [TLS Inspector] → [RBAC Network] → [HCM]       │
│                                        │          │
│                        ┌───────────────▼────┐    │
│                        │ HTTP Filter Chain   │    │
│                        │                     │    │
│                        │  jwt_authn          │    │
│                        │    ↓                │    │
│                        │  ext_authz          │    │
│                        │    ↓                │    │
│                        │  rbac               │    │
│                        │    ↓                │    │
│                        │  ratelimit          │    │
│                        │    ↓                │    │
│                        │  fault              │    │
│                        │    ↓                │    │
│                        │  router (마지막)     │    │
│                        └─────────────────────┘    │
└───────────────────────────────────────────────────┘
     │
     ▼
  Upstream 선택 → Backend Service
```

### Filter 순서의 중요성

HTTP Filter Chain의 순서는 보안과 성능에 직접적인 영향을 미친다. 다음은 권장 순서이다:

```
1. envoy.filters.http.jwt_authn        ← 인증 (가장 먼저)
2. envoy.filters.http.ext_authz        ← 인가 (인증 후)
3. envoy.filters.http.rbac             ← 접근 제어
4. envoy.filters.http.ratelimit        ← 요청 제한 (인증된 요청만 카운트)
5. envoy.filters.http.fault            ← 장애 주입 (테스트용)
6. envoy.filters.http.cors             ← CORS 처리
7. envoy.filters.http.lua / wasm       ← 커스텀 로직
8. envoy.filters.http.compressor       ← 응답 압축
9. envoy.filters.http.router           ← 라우팅 (반드시 마지막)
```

잘못된 순서의 예: `ratelimit`을 `jwt_authn` 앞에 배치하면, 인증되지 않은 요청도 rate limit 카운터를 소비한다. 공격자가 대량의 잘못된 토큰으로 rate limit을 고갈시켜 정상 사용자의 접근을 방해할 수 있다.

### HTTP Filter 상세: ext_authz

`ext_authz` 필터는 외부 인가 서비스에 요청 결정을 위임한다. OPA(Open Policy Agent), Keycloak 등과 연동할 수 있다.

```yaml
http_filters:
  - name: envoy.filters.http.ext_authz
    typed_config:
      "@type": type.googleapis.com/envoy.extensions.filters.http.ext_authz.v3.ExtAuthz
      # gRPC 방식
      grpc_service:
        envoy_grpc:
          cluster_name: ext_authz_cluster
        timeout: 0.5s
      # 실패 시 요청 허용 여부
      failure_mode_allow: false
      # 인가 서비스에 전달할 헤더
      with_request_body:
        max_request_bytes: 8192
        allow_partial_message: true
      # 인가 서비스의 응답 헤더를 업스트림에 전달
      transport_api_version: V3
      # 특정 경로는 인가 건너뛰기
      filter_enabled_metadata:
        filter: "envoy.filters.http.ext_authz"
        path:
          - key: "bypass"
            value:
              string_match: { exact: "true" }
```

Istio에서 ext_authz를 사용하려면 `AuthorizationPolicy`의 `CUSTOM` action을 사용한다:

```yaml
apiVersion: security.istio.io/v1
kind: AuthorizationPolicy
metadata:
  name: ext-authz
  namespace: demo
spec:
  selector:
    matchLabels:
      app: backend
  action: CUSTOM
  provider:
    name: my-ext-authz-provider   # meshconfig에 정의된 provider
  rules:
    - to:
        - operation:
            paths: ["/api/*"]
```

### HTTP Filter 상세: ext_proc (External Processing)

`ext_proc`는 `ext_authz`보다 더 세밀한 제어를 제공한다. 외부 gRPC 서비스가 요청/응답의 헤더와 바디를 직접 수정할 수 있다:

```yaml
http_filters:
  - name: envoy.filters.http.ext_proc
    typed_config:
      "@type": type.googleapis.com/envoy.extensions.filters.http.ext_proc.v3.ExternalProcessor
      grpc_service:
        envoy_grpc:
          cluster_name: ext_proc_cluster
        timeout: 2s
      processing_mode:
        request_header_mode: SEND        # 요청 헤더를 외부 서비스에 전송
        response_header_mode: SEND       # 응답 헤더를 외부 서비스에 전송
        request_body_mode: BUFFERED      # 요청 바디를 버퍼링하여 전송
        response_body_mode: NONE         # 응답 바디는 전송하지 않음
      failure_mode_allow: true
```

`ext_proc`는 다음과 같은 시나리오에 적합하다:
- 요청/응답 헤더의 동적 수정 (예: 토큰 교환, 헤더 추가/삭제)
- 요청 바디의 변환 (예: JSON 스키마 검증, 데이터 마스킹)
- 응답 바디의 후처리 (예: 민감 데이터 제거)

---

## HTTP Connection Manager (HCM) 심화

HCM은 Envoy에서 가장 중요한 Network Filter이다. HTTP 프로토콜을 파싱하고, HTTP Filter Chain을 관리하며, 라우팅을 수행한다.

### HCM의 주요 구성 요소

```yaml
http_connection_manager:
  codec_type: AUTO              # HTTP/1.1과 HTTP/2를 자동 감지한다
  stat_prefix: ingress_http     # 통계 접두사
  use_remote_address: true      # 클라이언트 IP를 X-Forwarded-For에서 추출한다

  # HTTP/2 관련 설정
  http2_protocol_options:
    max_concurrent_streams: 100   # 연결당 최대 동시 스트림 수
    initial_stream_window_size: 65536
    initial_connection_window_size: 1048576

  # 타임아웃 설정
  stream_idle_timeout: 300s      # 스트림 유휴 타임아웃
  request_timeout: 0s            # 요청 전체 타임아웃 (0=무제한)
  request_headers_timeout: 60s   # 요청 헤더 수신 타임아웃
  drain_timeout: 5s              # Drain 시 기존 연결 종료 대기 시간

  # 요청/응답 크기 제한
  max_request_headers_kb: 60     # 최대 요청 헤더 크기 (KB)

  # 서버 헤더
  server_name: "envoy"           # Server 응답 헤더 값
  server_header_transformation: OVERWRITE

  # 경로 정규화
  normalize_path: true           # //foo → /foo, /foo/../bar → /bar
  merge_slashes: true            # //foo//bar → /foo/bar
  path_with_escaped_slashes_action: UNESCAPE_AND_REDIRECT

  # 라우팅 설정
  route_config:
    name: local_route
    virtual_hosts: [...]

  # HTTP Filter 체인
  http_filters:
    - name: envoy.filters.http.router
      typed_config:
        "@type": type.googleapis.com/envoy.extensions.filters.http.router.v3.Router

  # 액세스 로그
  access_log:
    - name: envoy.access_loggers.file
      typed_config:
        "@type": type.googleapis.com/envoy.extensions.access_loggers.file.v3.FileAccessLog
        path: "/dev/stdout"
        log_format:
          text_format_source:
            inline_string: "[%START_TIME%] \"%REQ(:METHOD)% %REQ(:PATH)% %PROTOCOL%\" %RESPONSE_CODE% %RESPONSE_FLAGS%\n"

  # 분산 추적
  tracing:
    provider:
      name: envoy.tracers.opentelemetry
      typed_config:
        "@type": type.googleapis.com/envoy.config.trace.v3.OpenTelemetryConfig
        grpc_service:
          envoy_grpc:
            cluster_name: otel_collector
```

### Codec (HTTP 코덱)

Envoy는 세 가지 HTTP 코덱을 지원한다:

**HTTP/1.1 코덱:**
- 전통적인 텍스트 기반 프로토콜을 파싱한다
- Keep-alive로 연결을 재사용한다
- `max_requests_per_connection`으로 연결당 최대 요청 수를 제한할 수 있다
- Chunked Transfer Encoding을 지원한다

**HTTP/2 코덱:**
- 바이너리 프레이밍 프로토콜을 사용한다
- 단일 연결에서 여러 스트림을 멀티플렉싱한다
- 흐름 제어(flow control)를 지원한다
- HPACK 헤더 압축을 사용한다
- Server Push 기능이 있다 (Envoy에서는 제한적)

**HTTP/3 코덱 (QUIC):**
- UDP 기반의 QUIC 프로토콜을 사용한다
- Head-of-Line Blocking 문제를 해결한다
- 0-RTT 연결 수립을 지원한다
- 연결 마이그레이션 (IP가 변경되어도 연결 유지)

```yaml
# HTTP/3 활성화 예제
listeners:
  - name: listener_quic
    address:
      socket_address:
        protocol: UDP          # QUIC는 UDP를 사용한다
        address: 0.0.0.0
        port_value: 443
    udp_listener_config:
      quic_options: {}
    filter_chains:
      - transport_socket:
          name: envoy.transport_sockets.quic
          typed_config:
            "@type": type.googleapis.com/envoy.extensions.transport_sockets.quic.v3.QuicDownstreamTransport
            downstream_tls_context:
              common_tls_context:
                tls_certificates:
                  - certificate_chain: { filename: "/certs/cert.pem" }
                    private_key: { filename: "/certs/key.pem" }
        filters:
          - name: envoy.filters.network.http_connection_manager
            typed_config:
              "@type": type.googleapis.com/envoy.extensions.filters.network.http_connection_manager.v3.HttpConnectionManager
              codec_type: HTTP3
              stat_prefix: ingress_h3
              # ...
```

### 라우팅 구조

HCM의 라우팅은 Virtual Host → Route → Route Action 계층 구조를 따른다:

```yaml
route_config:
  name: local_route
  virtual_hosts:
    - name: backend_vhost
      domains: ["backend.example.com", "backend"]    # Host 헤더 매칭
      routes:
        # 1. Prefix 매칭 (가장 일반적)
        - match:
            prefix: "/api/v1/"
          route:
            cluster: backend_v1
            timeout: 30s

        # 2. Exact 매칭 (정확히 일치)
        - match:
            path: "/healthz"
          direct_response:
            status: 200
            body: { inline_string: "OK" }

        # 3. Regex 매칭 (정규표현식)
        - match:
            safe_regex:
              regex: "/api/v[0-9]+/users/[0-9]+"
          route:
            cluster: user_service
            retry_policy:
              retry_on: "5xx,reset,connect-failure"
              num_retries: 3
              per_try_timeout: 10s

        # 4. Header 기반 매칭
        - match:
            prefix: "/"
            headers:
              - name: "x-canary"
                string_match: { exact: "true" }
          route:
            cluster: backend_canary
            request_headers_to_add:
              - header: { key: "x-routed-to", value: "canary" }
                append_action: OVERWRITE_IF_EXISTS_OR_ADD

        # 5. Query Parameter 매칭
        - match:
            prefix: "/"
            query_parameters:
              - name: "debug"
                string_match: { exact: "true" }
          route:
            cluster: backend_debug

        # 6. 가중치 기반 라우팅 (트래픽 분할)
        - match:
            prefix: "/"
          route:
            weighted_clusters:
              clusters:
                - name: backend_v1
                  weight: 90
                - name: backend_v2
                  weight: 10

      # Virtual Host 레벨 재시도 정책
      retry_policy:
        retry_on: "5xx"
        num_retries: 2

      # Virtual Host 레벨 CORS 정책
      cors:
        allow_origin_string_match:
          - safe_regex: { regex: ".*\\.example\\.com" }
        allow_methods: "GET, POST, PUT, DELETE"
        allow_headers: "Authorization, Content-Type"
        max_age: "86400"
```

### 재시도 정책 (Retry Policy)

재시도 정책은 Route 또는 Virtual Host 레벨에서 설정할 수 있다:

```yaml
retry_policy:
  retry_on: "5xx,reset,connect-failure,retriable-4xx,refused-stream"
  num_retries: 3
  per_try_timeout: 5s               # 각 시도의 타임아웃
  per_try_idle_timeout: 2s           # 각 시도의 유휴 타임아웃
  retry_back_off:
    base_interval: 0.025s            # 초기 백오프 간격 (25ms)
    max_interval: 0.250s             # 최대 백오프 간격 (250ms)
  retry_host_predicate:
    - name: envoy.retry_host_predicates.previous_hosts    # 이전에 실패한 호스트 회피
  host_selection_retry_max_attempts: 5
  retriable_status_codes: [503, 429]  # 재시도할 상태 코드
  retriable_headers:
    - name: "x-envoy-retriable"       # 이 헤더가 있으면 재시도
```

**retry_on 값 상세:**

| 값 | 설명 |
|----|------|
| `5xx` | 업스트림이 5xx 응답을 반환하거나 전혀 응답하지 않았을 때 재시도한다 |
| `gateway-error` | 502, 503, 504 응답에서만 재시도한다 |
| `reset` | 업스트림이 연결을 리셋했을 때 재시도한다 |
| `connect-failure` | 업스트림 연결 수립 실패 시 재시도한다 |
| `retriable-4xx` | 409 (Conflict) 응답에서 재시도한다 |
| `refused-stream` | 업스트림이 REFUSED_STREAM 에러 코드로 스트림을 거부했을 때 재시도한다 |
| `retriable-status-codes` | `retriable_status_codes`에 지정된 상태 코드에서 재시도한다 |
| `retriable-headers` | 응답에 특정 헤더가 있을 때 재시도한다 |

**재시도와 서킷 브레이커의 상호작용:**

재시도는 서킷 브레이커의 `max_retries` 제한을 받는다. 기본값은 3이다. 동시에 진행 중인 재시도가 이 값을 초과하면 추가 재시도는 수행되지 않는다. 이는 "재시도 폭주(retry storm)"를 방지하는 핵심 메커니즘이다.

### 타임아웃 계층 구조

Envoy에는 여러 레벨의 타임아웃이 있다. 이들의 관계를 이해하는 것이 중요하다:

```
┌─────────────────────────────────────────────────────────┐
│ stream_idle_timeout (HCM, 기본 300s)                     │
│  요청/응답 데이터가 없는 유휴 시간. 이 안에:               │
│                                                          │
│  ┌───────────────────────────────────────────────────┐   │
│  │ request_timeout (Route, 기본 0=무제한)              │   │
│  │  전체 요청 처리 시간. 재시도 포함. 이 안에:           │   │
│  │                                                    │   │
│  │  ┌─────────────────────────────────────────────┐   │   │
│  │  │ per_try_timeout (Retry Policy)               │   │   │
│  │  │  각 개별 시도의 타임아웃                       │   │   │
│  │  └─────────────────────────────────────────────┘   │   │
│  │                                                    │   │
│  │  ┌─────────────────────────────────────────────┐   │   │
│  │  │ connect_timeout (Cluster, 기본 5s)           │   │   │
│  │  │  업스트림 TCP 연결 수립 타임아웃              │   │   │
│  │  └─────────────────────────────────────────────┘   │   │
│  └───────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

---

