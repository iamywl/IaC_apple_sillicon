# Envoy - 고성능 L7 프록시

## 개념

### Envoy란?
- 고성능 L4/L7 프록시이자 통신 버스이다 (CNCF Graduated)
- Lyft에서 개발하여 2016년 오픈소스로 공개했다
- C++로 작성되어 매우 높은 성능과 낮은 메모리 사용량을 제공한다
- Istio, AWS App Mesh, Consul Connect 등 주요 서비스 메시의 데이터 플레인으로 채택되었다
- 비동기 이벤트 기반 아키텍처로 설계되어 수만 개의 동시 연결을 효율적으로 처리한다
- HTTP/1.1, HTTP/2, HTTP/3(QUIC), gRPC, TCP, UDP 프로토콜을 지원한다

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

---

## xDS 프로토콜 (Discovery Service)

xDS는 Envoy가 컨트롤 플레인으로부터 동적으로 설정을 수신하는 API 프로토콜이다. gRPC 스트리밍 또는 REST를 통해 동작한다.

### xDS API 종류

| API | 전체 이름 | 설명 |
|-----|-----------|------|
| LDS | Listener Discovery Service | Listener 설정을 동적으로 수신한다 |
| RDS | Route Discovery Service | Route 설정을 동적으로 수신한다 |
| CDS | Cluster Discovery Service | Cluster 설정을 동적으로 수신한다 |
| EDS | Endpoint Discovery Service | 클러스터 내 엔드포인트(IP:Port) 목록을 동적으로 수신한다 |
| SDS | Secret Discovery Service | TLS 인증서와 키를 동적으로 수신한다. Istio에서 mTLS 인증서 로테이션에 사용된다 |
| VHDS | Virtual Host Discovery Service | Virtual Host 설정을 동적으로 수신한다 |
| SRDS | Scoped Route Discovery Service | Scoped Route 설정을 수신한다 |
| ECDS | Extension Config Discovery Service | 확장 설정을 동적으로 수신한다 |

### xDS 통신 방식

**1. State of the World (SotW) xDS**
- 전체 리소스 목록을 매번 전송하는 방식이다
- 리소스가 하나 변경되면 해당 타입의 전체 리소스를 다시 전송한다
- 구현이 단순하지만, 대규모 클러스터에서는 비효율적일 수 있다

**2. Incremental (Delta) xDS**
- 변경된 리소스만 전송하는 방식이다
- 리소스 추가/수정/삭제를 개별적으로 전달한다
- 대규모 클러스터에서 네트워크 대역폭과 처리 시간을 크게 절약한다

**3. ADS (Aggregated Discovery Service)**
- 여러 xDS API를 하나의 gRPC 스트림으로 통합하는 방식이다
- 설정 업데이트의 순서를 보장한다 (예: CDS가 먼저 적용된 후 EDS가 적용됨)
- Istio는 ADS를 사용하여 설정 일관성을 보장한다

### xDS 업데이트 순서 (Warming)

Envoy는 설정 업데이트 시 순서 의존성을 관리한다:

```
1. CDS 업데이트 (새 Cluster 정의)
      ↓
2. EDS 업데이트 (새 Cluster의 Endpoint)
      ↓
3. LDS 업데이트 (새 Listener 정의)
      ↓
4. RDS 업데이트 (새 Listener의 Route)
```

이 순서를 지키지 않으면 트래픽 유실이 발생할 수 있다. ADS는 이 순서를 컨트롤 플레인이 명시적으로 관리할 수 있게 한다.

### Istio와 xDS의 관계

```
┌─────────────────────────────────┐
│        istiod (Pilot)           │
│                                  │
│  Kubernetes API 감시             │
│  (Service, Endpoint, Pod 등)     │
│         │                        │
│         ▼                        │
│  내부 설정 모델 생성               │
│         │                        │
│         ▼                        │
│  xDS 응답 생성 (LDS/RDS/CDS/EDS) │
│         │                        │
└─────────┼────────────────────────┘
          │ gRPC 스트리밍 (ADS)
          │
    ┌─────▼─────┐  ┌───────────┐  ┌───────────┐
    │ Envoy #1  │  │ Envoy #2  │  │ Envoy #N  │
    │ (Sidecar) │  │ (Sidecar) │  │ (Sidecar) │
    └───────────┘  └───────────┘  └───────────┘
```

istiod(Pilot)는 Kubernetes API Server를 Watch하여 서비스, 엔드포인트, Pod 변경을 감지한다. 변경이 발생하면 내부 설정 모델을 업데이트하고, 연결된 모든 Envoy Sidecar에 xDS push를 수행한다.

---

## 로드밸런싱 알고리즘

Envoy는 Cluster 단위로 로드밸런싱 정책을 설정한다.

| 알고리즘 | 설명 | 사용 사례 |
|----------|------|----------|
| Round Robin | 엔드포인트를 순서대로 돌아가며 선택한다 | 균일한 처리 능력의 서버군 |
| Least Request | 활성 요청 수가 가장 적은 엔드포인트를 선택한다. 가중치(weight) 적용이 가능하다 | 요청 처리 시간이 불균등한 경우 |
| Random | 무작위로 엔드포인트를 선택한다. 단순하지만 대규모에서 통계적으로 균등하다 | 특별한 요구사항이 없는 경우 |
| Ring Hash | 일관성 해시링을 사용하여 특정 키(헤더, 쿠키 등)에 따라 동일 엔드포인트로 라우팅한다 | 캐시 서버, 세션 어피니티 |
| Maglev | Google의 Maglev 알고리즘을 사용한다. Ring Hash보다 더 균등한 분산과 빠른 테이블 재구성을 제공한다 | 대규모 분산 시스템 |

### 로드밸런싱 설정 예제
```yaml
clusters:
  - name: backend_service
    connect_timeout: 5s
    type: STRICT_DNS
    lb_policy: LEAST_REQUEST    # 로드밸런싱 알고리즘 선택
    least_request_lb_config:
      choice_count: 3           # N개 중 가장 요청이 적은 것 선택 (Power of 2 choices 확장)
    load_assignment:
      cluster_name: backend_service
      endpoints:
        - lb_endpoints:
            - endpoint:
                address:
                  socket_address:
                    address: backend-1
                    port_value: 8080
              load_balancing_weight: 80   # 가중치 설정
            - endpoint:
                address:
                  socket_address:
                    address: backend-2
                    port_value: 8080
              load_balancing_weight: 20
```

---

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

---

## Access Logging

Envoy는 요청/응답에 대한 상세한 액세스 로그를 제공한다.

### 주요 Format String 변수

| 변수 | 설명 |
|------|------|
| `%START_TIME%` | 요청 시작 시간이다 |
| `%REQ(:METHOD)%` | HTTP 메서드이다 |
| `%REQ(X-ENVOY-ORIGINAL-PATH?:PATH)%` | 요청 경로이다 |
| `%PROTOCOL%` | HTTP 프로토콜 버전이다 |
| `%RESPONSE_CODE%` | HTTP 응답 코드이다 |
| `%RESPONSE_FLAGS%` | 응답 플래그이다 (UF=upstream failure, UO=upstream overflow 등) |
| `%BYTES_RECEIVED%` | 수신 바이트 수이다 |
| `%BYTES_SENT%` | 송신 바이트 수이다 |
| `%DURATION%` | 총 요청 처리 시간(ms)이다 |
| `%UPSTREAM_HOST%` | 선택된 업스트림 호스트 주소이다 |
| `%UPSTREAM_CLUSTER%` | 선택된 업스트림 클러스터 이름이다 |
| `%UPSTREAM_SERVICE_TIME%` | 업스트림 서비스 처리 시간(ms)이다 |

### RESPONSE_FLAGS 주요 값

| 플래그 | 의미 |
|--------|------|
| `UF` | Upstream connection Failure이다 |
| `UO` | Upstream Overflow (서킷 브레이커 발동)이다 |
| `NR` | No Route configured이다 |
| `URX` | Upstream Retry limit exceeded이다 |
| `NC` | No Cluster found이다 |
| `DT` | Downstream request Timeout이다 |
| `DC` | Downstream Connection termination이다 |
| `RL` | Rate Limited이다 |
| `UAEX` | Unauthorized External service이다 |
| `UT` | Upstream request Timeout이다 |

### Access Log Sink

Envoy는 로그를 다양한 대상으로 전송할 수 있다:
- **파일 출력**: 로컬 파일에 기록한다. 가장 일반적이다.
- **gRPC Access Log Service (ALS)**: gRPC 스트리밍으로 외부 로그 수집 서비스에 전송한다. 중앙 집중형 로그 관리에 적합하다.
- **stdout/stderr**: 컨테이너 환경에서 표준 출력으로 내보내고, 로그 수집기(Fluentd, Vector 등)가 수집한다.

---

## Wasm (WebAssembly) 확장

Envoy는 Proxy-Wasm ABI를 통해 WebAssembly 모듈을 HTTP Filter로 로드할 수 있다. C++로 Envoy를 직접 수정하지 않고도 고성능 커스텀 로직을 구현할 수 있다.

### 특징
- **다양한 언어 지원**: Rust, Go, C++, AssemblyScript 등으로 Wasm 필터를 작성할 수 있다
- **샌드박스 실행**: Wasm 모듈은 격리된 환경에서 실행되어 Envoy 프로세스의 안정성을 보장한다
- **동적 로딩**: Envoy를 재시작하지 않고 Wasm 모듈을 교체할 수 있다 (ECDS 활용)
- **Istio WasmPlugin**: Istio에서는 `WasmPlugin` CRD를 통해 Wasm 필터를 Sidecar에 배포할 수 있다

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

---

## Istio에서의 역할

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

### iptables 트래픽 인터셉트

Istio init 컨테이너가 iptables 규칙을 설정하여, Pod 내 모든 인바운드/아웃바운드 트래픽을 Envoy로 리다이렉트한다:

```
Outbound 흐름:
App(8080) → OUTPUT chain → ISTIO_OUTPUT → REDIRECT → Envoy(15001) → 외부 서비스

Inbound 흐름:
외부 → PREROUTING chain → ISTIO_INBOUND → REDIRECT → Envoy(15006) → App(8080)
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

---

## 자가 점검
- [ ] Envoy의 Downstream → Listener → Network Filter → HCM → HTTP Filter → Route → Cluster → Upstream 전체 흐름을 설명할 수 있는가?
- [ ] Main Thread와 Worker Thread의 역할 차이를 설명할 수 있는가?
- [ ] Network Filter와 HTTP Filter의 차이점과 대표적인 예시를 알고 있는가?
- [ ] xDS API의 각 종류(LDS, RDS, CDS, EDS, SDS)가 어떤 설정을 담당하는지 설명할 수 있는가?
- [ ] ADS가 왜 필요하고, xDS 업데이트 순서가 왜 중요한지 설명할 수 있는가?
- [ ] Istio의 istiod(Pilot)가 어떻게 xDS를 통해 Envoy 설정을 push하는지 설명할 수 있는가?
- [ ] 로드밸런싱 알고리즘(Round Robin, Least Request, Ring Hash, Maglev)의 차이와 적합한 사용 사례를 알고 있는가?
- [ ] Active Health Checking과 Passive Health Checking(Outlier Detection)의 차이를 설명할 수 있는가?
- [ ] 서킷 브레이커 파라미터(max_connections, max_pending_requests, max_requests, max_retries)의 의미를 알고 있는가?
- [ ] Hot Restart가 어떻게 무중단 업데이트를 달성하는지 설명할 수 있는가?
- [ ] RESPONSE_FLAGS(UF, UO, NR 등)를 보고 문제를 진단할 수 있는가?
- [ ] `istioctl proxy-config`과 Admin 인터페이스를 사용하여 Envoy 설정과 상태를 확인할 수 있는가?
- [ ] Wasm Filter의 목적과 장점을 설명할 수 있는가?

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

### Wasm 확장
- Proxy-Wasm Specification: https://github.com/proxy-wasm/spec
- Proxy-Wasm Rust SDK: https://github.com/proxy-wasm/proxy-wasm-rust-sdk
- Proxy-Wasm Go SDK: https://github.com/tetratelabs/proxy-wasm-go-sdk

### Istio 연동
- Istio의 Envoy 설정 이해: https://istio.io/latest/docs/ops/diagnostic-tools/proxy-cmd/
- Istio EnvoyFilter API: https://istio.io/latest/docs/reference/config/networking/envoy-filter/
- Istio WasmPlugin API: https://istio.io/latest/docs/reference/config/proxy_extensions/wasm-plugin/

### 심화 학습
- Envoy 스레딩 모델 (공식 블로그): https://blog.envoyproxy.io/envoy-threading-model-a8d44b922310
- Envoy Hot Restart 구현: https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/operations/hot_restart
- Envoy 통계 개요: https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/observability/statistics
- Life of a Request: https://www.envoyproxy.io/docs/envoy/latest/intro/life_of_a_request
