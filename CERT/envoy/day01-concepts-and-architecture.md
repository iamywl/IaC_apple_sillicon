# Day 1: 개념 및 아키텍처

> Envoy의 탄생 배경, 핵심 개념(Downstream/Upstream, Listener, Cluster, Filter, xDS), 설정 방식(Static/Dynamic), Bootstrap 설정, 그리고 요청 처리 흐름과 스레딩 모델을 학습한다.

## 개념

### Envoy란?
- 고성능 L4/L7 프록시이자 통신 버스이다 (CNCF Graduated)
- Lyft에서 개발하여 2016년 오픈소스로 공개했다
- C++로 작성되어 매우 높은 성능과 낮은 메모리 사용량을 제공한다
- Istio, AWS App Mesh, Consul Connect 등 주요 서비스 메시의 데이터 플레인으로 채택되었다
- 비동기 이벤트 기반 아키텍처로 설계되어 수만 개의 동시 연결을 효율적으로 처리한다
- HTTP/1.1, HTTP/2, HTTP/3(QUIC), gRPC, TCP, UDP 프로토콜을 지원한다

### Envoy의 탄생 배경과 철학

Envoy는 2015년 Lyft에서 마이크로서비스 아키텍처 전환 과정에서 탄생했다. 당시 Lyft는 수백 개의 마이크로서비스를 운영하면서 서비스 간 통신의 관찰성(Observability)과 신뢰성(Reliability) 문제에 직면했다. 각 서비스 팀이 개별적으로 HTTP 클라이언트 라이브러리를 구현하다 보니, 재시도(retry), 타임아웃(timeout), 서킷 브레이킹(circuit breaking) 등의 로직이 언어와 프레임워크마다 달랐다.

Matt Klein이 이끄는 팀은 "네트워크를 애플리케이션에게 투명하게 만들자"는 철학을 세웠다. 이 철학은 다음 세 가지 원칙으로 구체화된다:

1. **네트워크는 애플리케이션에 투명해야 한다**: 개발자는 네트워크 문제(재시도, 타임아웃, 로드밸런싱)를 코드에서 처리하지 않아야 한다. 프록시가 이를 대신 처리한다.
2. **문제가 발생했을 때 원인을 파악하기 쉬워야 한다**: 분산 시스템에서 가장 어려운 것은 디버깅이다. Envoy는 풍부한 통계, 분산 추적, 상세한 로깅을 기본으로 제공하여 문제의 근본 원인을 신속하게 찾을 수 있게 한다.
3. **확장 가능해야 한다**: 모든 기능을 하나의 바이너리에 하드코딩하는 대신, 필터 체인(Filter Chain) 아키텍처를 채택하여 기능을 모듈 단위로 추가/제거할 수 있게 한다.

### 핵심 개념
| 개념 | 설명 |
|------|------|
| Downstream | Envoy에 요청을 보내는 클라이언트(호스트)이다 |
| Upstream | Envoy가 요청을 전달하는 백엔드 서비스(호스트)이다 |
| Listener | Envoy가 수신하는 네트워크 주소/포트 설정이다. 하나의 Envoy에 여러 Listener를 구성할 수 있다 |
| Cluster | Envoy가 트래픽을 라우팅할 수 있는 업스트림 서비스 그룹이다. 로드밸런싱 정책과 헬스체크 설정을 포함한다 |
| Route | Listener로 들어온 요청을 Cluster로 라우팅하는 규칙이다. URL path, header, method 등을 기준으로 매칭한다 |
| Filter | 요청/응답을 처리하는 미들웨어 체인이다. Network Filter와 HTTP Filter로 나뉜다 |
| xDS | 동적 설정 업데이트 프로토콜이다. EDS, CDS, RDS, LDS, SDS 등으로 구성된다 |
| Hot Restart | 무중단으로 바이너리 및 설정을 업데이트하는 메커니즘이다 |

### 설정 구성 방식

Envoy의 설정은 크게 **Static Resources**와 **Dynamic Resources** 두 가지로 나뉜다.

**Static Resources**는 Envoy 기동 시 YAML/JSON 파일로 직접 정의하는 방식이다. 개발 환경이나 단순한 프록시 구성에 적합하다:

```yaml
static_resources:
  listeners:
    - name: listener_0
      address:
        socket_address: { address: 0.0.0.0, port_value: 10000 }
      filter_chains:
        - filters:
            - name: envoy.filters.network.http_connection_manager
              # ... (설정 생략)
  clusters:
    - name: backend_service
      connect_timeout: 5s
      type: STRICT_DNS
      # ... (설정 생략)
```

**Dynamic Resources**는 xDS API를 통해 컨트롤 플레인으로부터 설정을 수신하는 방식이다. Istio 환경에서는 이 방식을 사용한다:

```yaml
dynamic_resources:
  lds_config:
    resource_api_version: V3
    ads: {}
  cds_config:
    resource_api_version: V3
    ads: {}
  ads_config:
    api_type: GRPC
    transport_api_version: V3
    grpc_services:
      - envoy_grpc:
          cluster_name: xds_cluster
```

두 방식을 혼합하여 사용할 수도 있다. 예를 들어, Listener는 동적으로 관리하면서 특정 Cluster는 정적으로 정의할 수 있다.

### Bootstrap 설정

Envoy 프로세스가 기동될 때 가장 먼저 로드하는 설정이 Bootstrap 설정이다. Bootstrap에는 다음 요소가 포함된다:

```yaml
# Bootstrap 설정의 주요 구성 요소
node:
  id: "sidecar~10.244.0.5~productpage-v1-xxx.demo~demo.svc.cluster.local"
  cluster: "productpage.demo"
  metadata:
    # Istio가 주입하는 메타데이터
    ISTIO_VERSION: "1.20.0"
    MESH_ID: "cluster.local"
    CLUSTER_ID: "Kubernetes"

admin:
  address:
    socket_address: { address: 127.0.0.1, port_value: 15000 }

static_resources:
  clusters:
    - name: xds_cluster        # istiod와의 연결을 위한 클러스터
      type: STRICT_DNS
      connect_timeout: 1s
      load_assignment:
        cluster_name: xds_cluster
        endpoints:
          - lb_endpoints:
              - endpoint:
                  address:
                    socket_address:
                      address: istiod.istio-system.svc
                      port_value: 15012
      transport_socket:
        name: envoy.transport_sockets.tls
        typed_config:
          "@type": type.googleapis.com/envoy.extensions.transport_sockets.tls.v3.UpstreamTlsContext
          # SDS를 통해 인증서를 로드한다

dynamic_resources:
  lds_config: { ads: {}, resource_api_version: V3 }
  cds_config: { ads: {}, resource_api_version: V3 }
  ads_config:
    api_type: GRPC
    transport_api_version: V3
    grpc_services:
      - envoy_grpc: { cluster_name: xds_cluster }

layered_runtime:
  layers:
    - name: admin
      admin_layer: {}
```

`node` 섹션은 Envoy 인스턴스를 식별하는 정보를 담는다. Istio 환경에서 `node.id`는 `sidecar~<IP>~<POD_NAME>.<NAMESPACE>~<NAMESPACE>.svc.cluster.local` 형식을 따른다. 컨트롤 플레인(istiod)은 이 정보를 기반으로 해당 Envoy에 적절한 설정을 생성하여 push한다.

---

## 아키텍처

### 요청 흐름
```
Client Request (Downstream)
      │
      ▼
┌──────────────┐
│   Listener   │  ← 지정된 주소/포트에서 요청 수신
│ (IP:Port)    │
└──────┬───────┘
       │
┌──────▼───────┐
│   Network    │  ← TCP 레벨 처리 (TLS 종단, TCP Proxy 등)
│   Filters    │
└──────┬───────┘
       │
┌──────▼───────────────────┐
│ HTTP Connection Manager  │  ← HTTP 프로토콜 파싱 및 관리
│  ┌───────────────────┐   │
│  │   HTTP Filters    │   │  ← 인증, Rate Limiting, Lua, Wasm 등
│  └────────┬──────────┘   │
│  ┌────────▼──────────┐   │
│  │   Route Config    │   │  ← URL, Header 기반 라우팅 결정
│  └────────┬──────────┘   │
│  ┌────────▼──────────┐   │
│  │   Router Filter   │   │  ← 최종 업스트림 선택 및 요청 전달
│  └───────────────────┘   │
└──────────┬───────────────┘
           │
┌──────────▼───────┐
│     Cluster      │  ← 로드밸런싱 알고리즘으로 엔드포인트 선택
│  (Load Balancer) │
└──────────┬───────┘
           │
           ▼
   Backend Service (Upstream)
```

### 요청 처리의 세부 단계

요청이 Envoy를 통과하는 과정을 더 세밀하게 분해하면 다음과 같다:

```
1. TCP 연결 수립
   ├── OS 커널이 SYN 패킷을 수신한다
   ├── Worker Thread가 accept()를 호출한다 (SO_REUSEPORT로 분배)
   └── Downstream Connection 객체가 생성된다

2. Listener Filter 실행
   ├── TLS Inspector: ClientHello에서 SNI/ALPN을 추출한다
   ├── HTTP Inspector: 프로토콜이 HTTP인지 판별한다
   └── Original Destination: iptables redirect 전 원래 목적지를 복원한다

3. Filter Chain 선택
   ├── SNI, ALPN, 목적지 포트 등을 기반으로 매칭한다
   └── 매칭되는 Filter Chain이 없으면 연결을 거부한다

4. TLS Handshake (해당되는 경우)
   ├── DownstreamTlsContext에 설정된 인증서를 사용한다
   ├── mTLS의 경우 클라이언트 인증서를 검증한다
   └── ALPN 협상 (h2, http/1.1)

5. Network Filter 실행
   ├── Read Filter가 수신 데이터를 처리한다
   └── HCM(HTTP Connection Manager)이 HTTP 파싱을 시작한다

6. HTTP 파싱 (HCM 내부)
   ├── HTTP/1.1 또는 HTTP/2 코덱이 요청을 파싱한다
   ├── 요청 헤더가 완성되면 HTTP Filter Chain을 시작한다
   └── 스트리밍 모드: 헤더 → 바디 청크 → 트레일러 순서로 필터에 전달한다

7. HTTP Filter Chain 실행
   ├── decodeHeaders(): 요청 헤더 처리
   ├── decodeData(): 요청 바디 처리
   ├── decodeTrailers(): 요청 트레일러 처리
   └── 각 필터는 Continue 또는 StopIteration을 반환한다

8. 라우팅 결정
   ├── Virtual Host 매칭 (Host 헤더 기반)
   ├── Route 매칭 (path, headers, query parameters)
   └── Route의 대상 Cluster가 결정된다

9. Upstream 연결
   ├── Cluster의 Load Balancer가 엔드포인트를 선택한다
   ├── Connection Pool에서 연결을 획득한다 (또는 새로 생성)
   └── TLS Handshake (업스트림 mTLS인 경우)

10. 업스트림 요청 전송 및 응답 수신
    ├── 요청 헤더/바디를 업스트림에 전송한다
    ├── 업스트림 응답을 수신한다
    └── HTTP Filter Chain을 역순으로 실행한다 (encodeHeaders, encodeData)

11. 다운스트림 응답 전송
    ├── 응답 헤더/바디를 다운스트림에 전송한다
    ├── Access Log 기록
    └── 통계 카운터 업데이트
```

### 스레딩 모델 (Threading Model)

Envoy는 멀티스레드 아키텍처를 사용하며, Main Thread와 Worker Thread로 구성된다.

```
┌─────────────────────────────────────────────────┐
│                 Envoy Process                    │
│                                                  │
│  ┌──────────────────────┐                        │
│  │     Main Thread      │                        │
│  │  ┌────────────────┐  │                        │
│  │  │ xDS 클라이언트   │  │  ← 컨트롤 플레인과 통신   │
│  │  │ Admin API 처리   │  │  ← /stats, /config_dump │
│  │  │ Runtime 관리     │  │  ← 설정 오버라이드        │
│  │  │ Access Log 플러시 │  │  ← 비동기 로그 기록       │
│  │  └────────────────┘  │                        │
│  └──────────────────────┘                        │
│                                                  │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐   │
│  │ Worker #0  │ │ Worker #1  │ │ Worker #N  │   │
│  │ ┌────────┐ │ │ ┌────────┐ │ │ ┌────────┐ │   │
│  │ │Event   │ │ │ │Event   │ │ │ │Event   │ │   │
│  │ │Loop    │ │ │ │Loop    │ │ │ │Loop    │ │   │
│  │ └────────┘ │ │ └────────┘ │ │ └────────┘ │   │
│  │ Listener  │ │ │ Listener  │ │ │ Listener  │ │   │
│  │ 연결 처리   │ │ 연결 처리   │ │ 연결 처리   │   │
│  │ Filter 실행│ │ Filter 실행│ │ Filter 실행│   │
│  └────────────┘ └────────────┘ └────────────┘   │
└─────────────────────────────────────────────────┘
```

- **Main Thread**: xDS 업데이트 수신, Admin API 처리, 통계 플러시, 런타임 설정 관리 등 조정 역할을 담당한다. 실제 요청 처리는 하지 않는다.
- **Worker Thread**: 각 Worker는 독립적인 이벤트 루프(libevent 기반)를 가진다. Listener에 바인딩된 소켓의 연결을 수락하고, 해당 연결의 전체 생명주기(필터 체인 실행, 업스트림 연결, 응답 전달)를 담당한다.
- **Thread Local Storage (TLS)**: Worker 간 데이터 공유는 TLS 메커니즘을 통해 이루어진다. Main Thread가 설정을 업데이트하면, 각 Worker의 TLS 슬롯에 읽기 전용 데이터를 전파한다. 이로 인해 락(lock) 없이 고성능을 달성한다.
- Worker 수는 `--concurrency` 플래그로 설정하며, 기본값은 하드웨어 스레드 수이다.

### 스레딩 모델 심화: Thread Local Storage (TLS) 메커니즘

Envoy의 TLS(Thread Local Storage)는 멀티스레드 환경에서 성능과 데이터 일관성을 동시에 달성하는 핵심 메커니즘이다. 일반적인 멀티스레드 프로그램에서는 공유 데이터에 접근할 때 뮤텍스(mutex)나 읽기-쓰기 락(read-write lock)을 사용한다. 하지만 프록시처럼 초당 수십만 건의 요청을 처리해야 하는 환경에서는 락 경합(lock contention)이 심각한 성능 병목이 된다.

Envoy는 이 문제를 **"Main Thread가 업데이트, Worker Thread는 읽기만"** 패턴으로 해결한다:

```
Main Thread                        Worker Thread #0      Worker Thread #1
    │                                    │                     │
    │  1. xDS 업데이트 수신               │                     │
    │  2. 새 설정 객체 생성               │                     │
    │  3. TLS 슬롯에 포스팅              │                     │
    │──────── post() ──────────────────▶│                     │
    │──────── post() ──────────────────────────────────────▶│
    │                                    │                     │
    │                               4. 이벤트 루프에서         │
    │                                  콜백 실행              │
    │                               5. TLS 슬롯 업데이트      │
    │                               6. 이전 객체 참조 해제     │
    │                                    │              (동일 과정)
    │                                    │                     │
```

**핵심 동작 원리:**

1. **포스팅(Posting)**: Main Thread가 설정을 업데이트하면, 각 Worker Thread의 이벤트 루프에 콜백을 등록(post)한다. 이 과정에서 Worker Thread의 실행을 중단시키지 않는다.

2. **지연된 적용(Deferred Application)**: Worker Thread는 현재 처리 중인 요청을 완료한 후, 이벤트 루프의 다음 반복(iteration)에서 콜백을 실행하여 TLS 슬롯을 업데이트한다. 따라서 하나의 요청 처리 도중에 설정이 바뀌는 일은 없다.

3. **참조 카운팅(Reference Counting)**: 이전 설정 객체는 `std::shared_ptr`로 관리된다. 모든 Worker Thread가 새 설정으로 전환하면 이전 객체의 참조 카운트가 0이 되어 자동으로 해제된다.

이 설계의 결과로 Worker Thread 내부에서는 **일체의 락 없이** 설정 데이터를 읽을 수 있다. 각 Worker Thread가 가진 TLS 슬롯의 데이터는 해당 스레드만 읽으므로 데이터 경합이 원천적으로 불가능하다.

### 연결 처리 모델 (Connection Handling)

Envoy는 `SO_REUSEPORT` 소켓 옵션을 사용하여 여러 Worker Thread가 동일한 포트에서 연결을 수락한다. 이 옵션은 리눅스 커널이 들어오는 연결을 자동으로 Worker Thread 간에 분배하도록 한다.

```
                    ┌─────────────────────────────────┐
                    │        Linux Kernel              │
                    │                                   │
  Client ─── SYN ──▶│  SO_REUSEPORT Load Balancing     │
                    │       │          │          │     │
                    └───────┼──────────┼──────────┼─────┘
                            │          │          │
                     ┌──────▼──┐ ┌─────▼───┐ ┌───▼─────┐
                     │Worker #0│ │Worker #1│ │Worker #2│
                     │ Socket  │ │ Socket  │ │ Socket  │
                     │ accept()│ │ accept()│ │ accept()│
                     └─────────┘ └─────────┘ └─────────┘
```

**연결의 생명주기:**

1. **Accept**: Worker Thread가 커널로부터 새 연결을 수락한다. 이 시점에서 `Downstream Connection` 객체가 생성된다.
2. **Listener Filter 실행**: TLS Inspector, HTTP Inspector 등이 실행되어 프로토콜을 판별한다.
3. **Filter Chain 선택**: 판별된 프로토콜, SNI, 목적지 포트 등을 기반으로 적절한 Filter Chain을 선택한다.
4. **데이터 처리**: 선택된 Filter Chain의 Network Filter가 데이터를 처리한다. HCM이 포함된 경우 HTTP 파싱이 시작된다.
5. **업스트림 연결**: Router Filter가 업스트림 엔드포인트를 선택하고, Connection Pool에서 연결을 획득한다.
6. **응답 반환**: 업스트림 응답을 수신하여 Filter Chain을 역순으로 통과시킨 후 다운스트림에 전달한다.
7. **연결 종료**: Keep-alive 타이머가 만료되거나, 명시적 close가 발생하면 연결이 종료된다.

**한 가지 중요한 점**: 하나의 다운스트림 연결에 대한 모든 처리는 반드시 동일한 Worker Thread에서 수행된다. 연결이 한 Worker Thread에 할당되면, 해당 연결이 종료될 때까지 다른 Worker Thread로 이동하지 않는다. 이 보장 덕분에 Worker Thread 내부에서는 락이 필요 없다.

### Connection Pool 구조

업스트림으로의 연결은 Connection Pool에서 관리된다. Envoy는 프로토콜별로 다른 풀링 전략을 사용한다:

```
Worker Thread #0
├── Connection Pool (HTTP/1.1)
│   ├── Cluster A
│   │   ├── Host 10.0.0.1:8080 → [conn1, conn2, conn3] (max per host)
│   │   └── Host 10.0.0.2:8080 → [conn1, conn2]
│   └── Cluster B
│       └── Host 10.0.1.1:9090 → [conn1]
│
└── Connection Pool (HTTP/2)
    └── Cluster C
        ├── Host 10.0.2.1:443 → [conn1] (멀티플렉싱, 1개로 충분할 수 있음)
        └── Host 10.0.2.2:443 → [conn1]
```

**HTTP/1.1 Connection Pool:**
- 요청당 하나의 연결을 사용한다 (파이프라이닝은 지원하지 않는다)
- `max_connections`로 호스트당 최대 연결 수를 제한한다
- 연결이 모두 사용 중이면 요청을 큐에 넣거나 서킷 브레이커가 발동한다
- Keep-alive를 통해 연결을 재사용한다

**HTTP/2 Connection Pool:**
- 하나의 연결에 여러 요청을 멀티플렉싱한다
- `max_requests`로 연결당 최대 동시 스트림 수를 제한한다
- `max_concurrent_streams`가 초과되면 새 연결을 생성하거나 대기한다

**중요**: Connection Pool은 **Worker Thread별**로 독립적이다. 즉, Worker가 4개이면 실제 업스트림 연결 수는 `max_connections × 4`까지 증가할 수 있다. 이 점을 서킷 브레이커 설정 시 반드시 고려해야 한다.

### 공유 메모리 (Shared Memory)

Envoy는 Hot Restart 시 통계 데이터의 연속성을 보장하기 위해 공유 메모리를 사용한다. POSIX 공유 메모리(`shm_open`)를 통해 부모 프로세스와 자식 프로세스가 동일한 메모리 영역을 공유한다.

```
┌───────────────────────────────────────────────┐
│             Shared Memory Region               │
│                                                 │
│  ┌─────────────────────────────────────────┐   │
│  │  Stats Slots                             │   │
│  │  ┌──────────┬──────────┬──────────┐     │   │
│  │  │Counter #0│Counter #1│Counter #N│     │   │
│  │  │ name     │ name     │ name     │     │   │
│  │  │ value    │ value    │ value    │     │   │
│  │  │ used     │ used     │ used     │     │   │
│  │  └──────────┴──────────┴──────────┘     │   │
│  └─────────────────────────────────────────┘   │
│                                                 │
│  ┌─────────────────────────────────────────┐   │
│  │  Gauge Slots                             │   │
│  │  (현재 활성 연결 수 등 gauge 타입 통계)      │   │
│  └─────────────────────────────────────────┘   │
│                                                 │
│  ┌─────────────────────────────────────────┐   │
│  │  Hot Restart 메타데이터                    │   │
│  │  (세대 번호, 프로세스 상태 등)              │   │
│  └─────────────────────────────────────────┘   │
└───────────────────────────────────────────────┘
     ▲                              ▲
     │                              │
Old Envoy Process            New Envoy Process
(읽기/쓰기)                   (읽기/쓰기)
```

공유 메모리에 저장되는 주요 데이터:
- **Counter**: 누적 카운터 (예: 총 요청 수, 총 에러 수). 부호 없는 64비트 정수이다.
- **Gauge**: 현재 값 게이지 (예: 활성 연결 수, 메모리 사용량). 프로세스별로 독립적이다.
- **Histogram**: 분포 데이터 (예: 요청 지연 시간). 각 프로세스가 독립적으로 수집한 후 통합한다.

Hot Restart 시 새 프로세스는 공유 메모리에서 기존 Counter 값을 읽어 초기값으로 사용한다. 이로써 Envoy를 재시작해도 모니터링 시스템이 카운터 리셋을 감지하지 않는다.

---

