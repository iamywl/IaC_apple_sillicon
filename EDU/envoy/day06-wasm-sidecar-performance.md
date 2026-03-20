# Day 6: Wasm 확장, Envoy as Sidecar (Istio), 성능 튜닝

> WebAssembly(Wasm) 기반 확장 개발, Istio 환경에서의 Envoy Sidecar 동작 방식, 성능 튜닝 전략을 학습한다.

## Wasm (WebAssembly) 확장

Envoy는 Proxy-Wasm ABI를 통해 WebAssembly 모듈을 HTTP Filter로 로드할 수 있다. C++로 Envoy를 직접 수정하지 않고도 고성능 커스텀 로직을 구현할 수 있다.

### 특징
- **다양한 언어 지원**: Rust, Go, C++, AssemblyScript 등으로 Wasm 필터를 작성할 수 있다
- **샌드박스 실행**: Wasm 모듈은 격리된 환경에서 실행되어 Envoy 프로세스의 안정성을 보장한다
- **동적 로딩**: Envoy를 재시작하지 않고 Wasm 모듈을 교체할 수 있다 (ECDS 활용)
- **Istio WasmPlugin**: Istio에서는 `WasmPlugin` CRD를 통해 Wasm 필터를 Sidecar에 배포할 수 있다

### Proxy-Wasm ABI (Application Binary Interface)

Proxy-Wasm ABI는 Envoy와 Wasm 모듈 간의 인터페이스를 정의한다:

```
┌────────────────────────────────────────────┐
│                 Envoy (Host)                │
│                                             │
│  ┌───────────────────────────────────────┐  │
│  │  Wasm VM (V8 / Wasmtime / WAMR)      │  │
│  │  ┌─────────────────────────────────┐  │  │
│  │  │       Wasm Module (Guest)       │  │  │
│  │  │                                  │  │  │
│  │  │  Exports (Guest → Host):        │  │  │
│  │  │  - proxy_on_request_headers()   │  │  │
│  │  │  - proxy_on_request_body()      │  │  │
│  │  │  - proxy_on_response_headers()  │  │  │
│  │  │  - proxy_on_response_body()     │  │  │
│  │  │  - proxy_on_log()              │  │  │
│  │  │                                  │  │  │
│  │  │  Imports (Host → Guest):        │  │  │
│  │  │  - proxy_get_header_map_value() │  │  │
│  │  │  - proxy_set_header_map_value() │  │  │
│  │  │  - proxy_log()                 │  │  │
│  │  │  - proxy_http_call()           │  │  │
│  │  │  - proxy_get_shared_data()     │  │  │
│  │  └─────────────────────────────────┘  │  │
│  └───────────────────────────────────────┘  │
└────────────────────────────────────────────┘
```

### Wasm Filter 개발 생명주기 (Rust 예시)

```rust
// 1. Cargo.toml
// [dependencies]
// proxy-wasm = "0.2"
// log = "0.4"

use proxy_wasm::traits::*;
use proxy_wasm::types::*;

// 2. Root Context: Wasm VM 시작 시 생성 (전역 설정)
struct MyFilterRoot {
    config: String,
}

impl Context for MyFilterRoot {}
impl RootContext for MyFilterRoot {
    fn on_configure(&mut self, _config_size: usize) -> bool {
        if let Some(config_bytes) = self.get_plugin_configuration() {
            self.config = String::from_utf8(config_bytes).unwrap();
        }
        true
    }

    fn create_http_context(&self, _context_id: u32) -> Option<Box<dyn HttpContext>> {
        Some(Box::new(MyFilter {
            config: self.config.clone(),
        }))
    }

    fn get_type(&self) -> Option<ContextType> {
        Some(ContextType::HttpContext)
    }
}

// 3. HTTP Context: 각 요청마다 생성
struct MyFilter {
    config: String,
}

impl Context for MyFilter {}
impl HttpContext for MyFilter {
    fn on_http_request_headers(&mut self, _num_headers: usize, _end_of_stream: bool) -> Action {
        // 요청 헤더 처리
        if let Some(path) = self.get_http_request_header(":path") {
            log::info!("Request path: {}", path);

            // 특정 경로 차단
            if path.starts_with("/blocked") {
                self.send_http_response(403, vec![], Some(b"Forbidden by Wasm filter"));
                return Action::Pause;
            }
        }

        // 커스텀 헤더 추가
        self.set_http_request_header("x-wasm-filter", Some("processed"));

        Action::Continue
    }

    fn on_http_response_headers(&mut self, _num_headers: usize, _end_of_stream: bool) -> Action {
        // 응답 헤더에 커스텀 정보 추가
        self.set_http_response_header("x-powered-by", Some("envoy-wasm"));
        Action::Continue
    }

    fn on_log(&mut self) {
        // 요청 완료 후 로깅
        if let Some(status) = self.get_http_response_header(":status") {
            log::info!("Response status: {}", status);
        }
    }
}

// 4. Entry point
proxy_wasm::main! {{
    proxy_wasm::set_root_context(|_| -> Box<dyn RootContext> {
        Box::new(MyFilterRoot {
            config: String::new(),
        })
    });
}}
```

### 빌드 및 배포

```bash
# Rust Wasm 빌드
cargo build --target wasm32-wasi --release

# 결과물: target/wasm32-wasi/release/my_filter.wasm
```

### Wasm Filter 설정 예제
```yaml
http_filters:
  - name: envoy.filters.http.wasm
    typed_config:
      "@type": type.googleapis.com/envoy.extensions.filters.http.wasm.v3.Wasm
      config:
        name: "my_custom_filter"
        root_id: "my_root_id"
        vm_config:
          runtime: "envoy.wasm.runtime.v8"
          code:
            local:
              filename: "/etc/envoy/filters/my_filter.wasm"
  - name: envoy.filters.http.router
    typed_config:
      "@type": type.googleapis.com/envoy.extensions.filters.http.router.v3.Router
```

### Istio WasmPlugin CRD

Istio에서 Wasm 필터를 배포하는 가장 간편한 방법:

```yaml
apiVersion: extensions.istio.io/v1alpha1
kind: WasmPlugin
metadata:
  name: my-wasm-filter
  namespace: demo
spec:
  selector:
    matchLabels:
      app: backend
  url: oci://registry.example.com/wasm-filters/my-filter:v1.0
  # 또는 HTTP URL
  # url: https://storage.example.com/wasm/my-filter.wasm
  phase: AUTHN                       # 필터 위치 (AUTHN, AUTHZ, STATS, UNSPECIFIED)
  priority: 10                        # 같은 phase 내 순서
  pluginConfig:                       # Wasm 모듈에 전달할 설정
    blocked_paths:
      - "/admin"
      - "/internal"
  imagePullPolicy: IfNotPresent
  vmConfig:
    env:
      - name: MY_ENV_VAR
        value: "some_value"
```

### Wasm 런타임 비교

| 런타임 | 설명 | 성능 |
|--------|------|------|
| V8 | Google의 JavaScript 엔진에서 파생. JIT 컴파일 지원 | 높음 (JIT 후) |
| Wasmtime | Bytecode Alliance의 공식 런타임. Cranelift 기반 AOT 컴파일 | 높음 |
| WAMR | WebAssembly Micro Runtime. 경량, 임베디드 환경에 적합 | 중간 |
| null (비활성) | Wasm 비활성화, 네이티브 필터만 사용 | N/A |

---

## Envoy as Sidecar in Istio

### Sidecar Injection 과정

Istio는 Kubernetes의 Mutating Admission Webhook을 사용하여 Pod에 Envoy 사이드카를 자동 주입한다:

```
1. Pod 생성 요청
   kubectl apply -f deployment.yaml
        │
        ▼
2. Kubernetes API Server
   ├── Authentication
   ├── Authorization
   └── Admission Controllers
        │
        ▼
3. Mutating Webhook (istiod)
   ├── 네임스페이스에 istio-injection=enabled 레이블 확인
   ├── Pod spec에 istio-proxy 컨테이너 추가
   ├── Pod spec에 istio-init 컨테이너 추가
   ├── Volume (istio-token, istio-data 등) 추가
   └── 환경 변수 (ISTIO_META_*, POD_NAME 등) 추가
        │
        ▼
4. 변형된 Pod spec으로 Pod 생성
```

주입되는 컨테이너:

```yaml
# istio-init (Init Container)
- name: istio-init
  image: docker.io/istio/proxyv2:1.20.0
  args: ["istio-iptables", "-p", "15001", "-z", "15006", "-u", "1337"]
  securityContext:
    capabilities:
      add: ["NET_ADMIN", "NET_RAW"]
    privileged: false
    runAsUser: 0

# istio-proxy (Sidecar Container)
- name: istio-proxy
  image: docker.io/istio/proxyv2:1.20.0
  args:
    - proxy
    - sidecar
    - --domain
    - $(POD_NAMESPACE).svc.cluster.local
    - --proxyLogLevel=warning
    - --proxyComponentLogLevel=misc:error
    - --log_output_level=default:info
    - --concurrency
    - "2"
  env:
    - name: ISTIO_META_CLUSTER_ID
      value: "Kubernetes"
    - name: ISTIO_META_MESH_ID
      value: "cluster.local"
  ports:
    - containerPort: 15090
      name: http-envoy-prom
      protocol: TCP
  resources:
    limits:
      cpu: "2"
      memory: 1Gi
    requests:
      cpu: 100m
      memory: 128Mi
```

### iptables 트래픽 인터셉트 상세

Istio init 컨테이너가 iptables 규칙을 설정하여, Pod 내 모든 인바운드/아웃바운드 트래픽을 Envoy로 리다이렉트한다:

```
Outbound 흐름:
App(8080) → OUTPUT chain → ISTIO_OUTPUT → REDIRECT → Envoy(15001) → 외부 서비스

Inbound 흐름:
외부 → PREROUTING chain → ISTIO_INBOUND → REDIRECT → Envoy(15006) → App(8080)
```

**iptables 규칙 상세:**

```bash
# istio-init이 설정하는 iptables 규칙 (간략화)

# NAT 테이블 - PREROUTING (인바운드)
-A PREROUTING -p tcp -j ISTIO_INBOUND

# ISTIO_INBOUND 체인
-A ISTIO_INBOUND -p tcp --dport 15008 -j RETURN    # HBONE 패스스루
-A ISTIO_INBOUND -p tcp --dport 15020 -j RETURN    # 헬스체크 패스스루
-A ISTIO_INBOUND -p tcp --dport 15021 -j RETURN    # 헬스체크 패스스루
-A ISTIO_INBOUND -p tcp --dport 15090 -j RETURN    # Prometheus 패스스루
-A ISTIO_INBOUND -p tcp -j ISTIO_IN_REDIRECT

# ISTIO_IN_REDIRECT: 인바운드 트래픽을 Envoy 15006으로 리다이렉트
-A ISTIO_IN_REDIRECT -p tcp -j REDIRECT --to-ports 15006

# NAT 테이블 - OUTPUT (아웃바운드)
-A OUTPUT -p tcp -j ISTIO_OUTPUT

# ISTIO_OUTPUT 체인
-A ISTIO_OUTPUT -s 127.0.0.6/32 -o lo -j RETURN    # InboundPassthroughCluster
-A ISTIO_OUTPUT ! -d 127.0.0.1/32 -o lo -m owner --uid-owner 1337 -j ISTIO_IN_REDIRECT
-A ISTIO_OUTPUT -o lo -m owner ! --uid-owner 1337 -j RETURN
-A ISTIO_OUTPUT -m owner --uid-owner 1337 -j RETURN  # Envoy 자체 트래픽은 패스스루
-A ISTIO_OUTPUT -m owner --gid-owner 1337 -j RETURN
-A ISTIO_OUTPUT -d 127.0.0.1/32 -j RETURN           # localhost 패스스루
-A ISTIO_OUTPUT -j ISTIO_REDIRECT

# ISTIO_REDIRECT: 아웃바운드 트래픽을 Envoy 15001로 리다이렉트
-A ISTIO_REDIRECT -p tcp -j REDIRECT --to-ports 15001
```

**핵심 포인트**: UID 1337은 `istio-proxy` 사이드카 컨테이너의 사용자 ID이다. Envoy 자신이 생성하는 아웃바운드 트래픽은 iptables 리다이렉트에서 제외된다. 그렇지 않으면 무한 루프가 발생한다.

### 포트 구조 (Istio Sidecar)
```
Pod
├── App Container
│   └── localhost:8080 (앱 포트)
└── Envoy Sidecar (istio-proxy)
    ├── Inbound:  외부 → iptables → Envoy(15006) → App(8080)
    ├── Outbound: App → iptables → Envoy(15001) → 외부 서비스
    └── Admin:    localhost:15000

포트 번호    용도
──────────────────────────────────────
15000      Envoy Admin 인터페이스 (stats, config_dump, clusters)
15001      Outbound 트래픽 가로채기 (iptables REDIRECT)
15004      디버그 인터페이스
15006      Inbound 트래픽 가로채기
15020      istiod 헬스체크 엔드포인트 (/healthz/ready)
15021      Sidecar 헬스체크 (Health Check)
15053      DNS 프록시 (istiod DNS)
15090      Prometheus 메트릭 엔드포인트 (/stats/prometheus)
```

### Istio Ambient Mode (Sidecarless)

Istio 1.18부터 도입된 Ambient Mode는 사이드카 없이 서비스 메시를 구현한다:

```
기존 Sidecar Mode:
┌──────────────────────┐
│ Pod                   │
│ ┌────────┐ ┌───────┐ │
│ │  App   │ │Envoy  │ │
│ │        │←→│Sidecar│ │
│ └────────┘ └───────┘ │
└──────────────────────┘

Ambient Mode:
┌──────────────────────┐     ┌──────────────┐
│ Pod (사이드카 없음)    │     │ ztunnel      │ ← Node당 1개 DaemonSet
│ ┌────────┐           │     │ (L4 프록시)   │
│ │  App   │───────────┼────▶│              │
│ └────────┘           │     └──────┬───────┘
└──────────────────────┘            │
                                    ▼
                             ┌──────────────┐
                             │ Waypoint     │ ← 네임스페이스당 선택적 배포
                             │ Proxy       │    (L7 프록시, Envoy 기반)
                             │ (Envoy)     │
                             └──────────────┘
```

Ambient Mode에서 Envoy는 Waypoint Proxy로 사용된다. L7 정책(트래픽 라우팅, 인가 등)이 필요한 경우에만 배포되므로 리소스를 절약할 수 있다.

---

## 성능 튜닝

### Connection Pool 설정

```yaml
clusters:
  - name: backend
    # HTTP Connection Pool
    typed_extension_protocol_options:
      envoy.extensions.upstreams.http.v3.HttpProtocolOptions:
        "@type": type.googleapis.com/envoy.extensions.upstreams.http.v3.HttpProtocolOptions
        explicit_http_config:
          http2_protocol_options:
            max_concurrent_streams: 100
            initial_stream_window_size: 1048576      # 1MB
            initial_connection_window_size: 2097152  # 2MB
        common_http_protocol_options:
          idle_timeout: 3600s                         # 유휴 연결 타임아웃
          max_requests_per_connection: 0              # 0 = 무제한
          max_stream_duration: 0s                     # 0 = 무제한
```

Istio에서 DestinationRule을 통해 Connection Pool을 설정한다:

```yaml
apiVersion: networking.istio.io/v1beta1
kind: DestinationRule
metadata:
  name: backend-pool-tuning
  namespace: demo
spec:
  host: backend.demo.svc.cluster.local
  trafficPolicy:
    connectionPool:
      tcp:
        maxConnections: 1000                # 최대 TCP 연결 수
        connectTimeout: 3s                  # TCP 연결 타임아웃
        tcpKeepalive:
          time: 7200s                       # Keep-alive 시작 시간
          interval: 75s                     # Keep-alive 프로브 간격
          probes: 9                         # Keep-alive 프로브 횟수
      http:
        h2UpgradePolicy: DEFAULT
        http1MaxPendingRequests: 1024       # HTTP/1.1 대기 큐 크기
        http2MaxRequests: 1024              # HTTP/2 최대 동시 요청
        maxRetries: 3
        maxRequestsPerConnection: 0         # 연결당 최대 요청 (0=무제한)
        idleTimeout: 3600s                  # 유휴 연결 타임아웃
```

### Buffer Limits

```yaml
# Listener 레벨 버퍼 제한
listeners:
  - name: listener_0
    per_connection_buffer_limit_bytes: 1048576    # 1MB (연결당 버퍼)

# HCM 레벨 버퍼 제한
http_connection_manager:
  # 요청 헤더 크기 제한
  max_request_headers_kb: 60                       # 60KB

  # HTTP/2 흐름 제어
  http2_protocol_options:
    initial_stream_window_size: 65536              # 64KB (스트림당)
    initial_connection_window_size: 1048576         # 1MB (연결당)

# Cluster 레벨 버퍼 제한
clusters:
  - name: backend
    per_connection_buffer_limit_bytes: 1048576    # 1MB
```

### Overload Manager

Envoy 자체의 과부하를 방지하기 위한 메커니즘이다. 메모리, 파일 디스크립터 등의 리소스 사용량을 모니터링하여 자동으로 부하를 조절한다:

```yaml
overload_manager:
  refresh_interval: 0.25s              # 리소스 모니터 체크 주기
  resource_monitors:
    # 힙 메모리 사용량 모니터
    - name: "envoy.resource_monitors.fixed_heap"
      typed_config:
        "@type": type.googleapis.com/envoy.extensions.resource_monitors.fixed_heap.v3.FixedHeapConfig
        max_heap_size_bytes: 1073741824   # 1GB

    # 파일 디스크립터 사용량 모니터
    - name: "envoy.resource_monitors.global_downstream_max_connections"
      typed_config:
        "@type": type.googleapis.com/envoy.extensions.resource_monitors.downstream_connections.v3.DownstreamConnectionsConfig
        max_active_downstream_connections: 50000

  actions:
    # 메모리 사용량 95% 초과 시 새 HTTP 스트림 거부
    - name: "envoy.overload_actions.stop_accepting_requests"
      triggers:
        - name: "envoy.resource_monitors.fixed_heap"
          threshold:
            value: 0.95

    # 메모리 사용량 90% 초과 시 HTTP/2 스트림 수 제한
    - name: "envoy.overload_actions.reduce_timeouts"
      triggers:
        - name: "envoy.resource_monitors.fixed_heap"
          scaled:
            scaling_threshold: 0.85
            saturation_threshold: 0.95

    # 메모리 사용량 98% 초과 시 새 연결 거부
    - name: "envoy.overload_actions.stop_accepting_connections"
      triggers:
        - name: "envoy.resource_monitors.fixed_heap"
          threshold:
            value: 0.98

    # 연결 수 초과 시 새 연결 거부
    - name: "envoy.overload_actions.stop_accepting_connections"
      triggers:
        - name: "envoy.resource_monitors.global_downstream_max_connections"
          threshold:
            value: 0.95
```

### Istio Sidecar 리소스 튜닝

```yaml
# Istio 글로벌 설정 (meshConfig)
apiVersion: install.istio.io/v1alpha1
kind: IstioOperator
spec:
  meshConfig:
    defaultConfig:
      concurrency: 2                    # Worker Thread 수 (0 = CPU 코어 수)
      proxyStatsMatcher:
        inclusionPrefixes:
          - "upstream_cx"
          - "upstream_rq"
          - "downstream_cx"
          - "downstream_rq"
      holdApplicationUntilProxyStarts: true   # Envoy 준비 전 앱 시작 방지

  # 사이드카 리소스 제한
  values:
    global:
      proxy:
        resources:
          requests:
            cpu: 100m
            memory: 128Mi
          limits:
            cpu: 2000m
            memory: 1Gi
```

### 성능 관련 주요 조정 포인트

| 항목 | 기본값 | 조정 방향 | 영향 |
|------|--------|----------|------|
| `--concurrency` | CPU 코어 수 | 트래픽 부하에 따라 | Worker Thread 수. 과다 설정 시 컨텍스트 스위칭 오버헤드 |
| `max_connections` | 1024 | 업스트림 서비스 용량에 맞춤 | 너무 높으면 업스트림 과부하, 너무 낮으면 503 |
| `connect_timeout` | 5s | 네트워크 지연에 맞춤 | 너무 길면 장애 감지 지연, 너무 짧으면 일시적 지연에 실패 |
| `idle_timeout` | 3600s (1h) | 연결 재사용 패턴에 맞춤 | 너무 길면 불필요한 연결 유지, 너무 짧으면 연결 재생성 오버헤드 |
| `per_connection_buffer_limit_bytes` | 1MB | 요청/응답 크기에 맞춤 | 너무 크면 메모리 낭비, 너무 작으면 대용량 전송 실패 |
| `http2_max_concurrent_streams` | 100 | 클라이언트 패턴에 맞춤 | HTTP/2 멀티플렉싱 효율에 영향 |

---

