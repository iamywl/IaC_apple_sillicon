# Day 3: xDS 프로토콜, Cluster 관리, 로드밸런싱

> xDS Discovery Service 프로토콜(LDS, RDS, CDS, EDS, SDS)의 동작 원리, Cluster 관리 방식, 그리고 다양한 로드밸런싱 알고리즘을 학습한다.

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

### xDS 프로토콜 메시지 구조

모든 xDS API는 공통된 메시지 구조를 따른다:

**DiscoveryRequest (Envoy → Control Plane):**
```protobuf
message DiscoveryRequest {
  string version_info = 1;        // 마지막으로 수신한 버전 (ACK/NACK 용도)
  Node node = 2;                  // Envoy 노드 식별 정보
  repeated string resource_names = 3;  // 요청하는 리소스 이름 목록
  string type_url = 4;            // 리소스 타입 URL
  Status error_detail = 5;        // NACK인 경우 에러 상세
  string response_nonce = 6;      // 응답 nonce (ACK/NACK 대상 식별)
}
```

**DiscoveryResponse (Control Plane → Envoy):**
```protobuf
message DiscoveryResponse {
  string version_info = 1;        // 이 응답의 버전
  repeated Any resources = 2;      // 리소스 목록
  bool canary = 3;                // 카나리 배포 여부
  string type_url = 4;            // 리소스 타입 URL
  string nonce = 5;               // 이 응답의 고유 식별자
  ControlPlane control_plane = 6;  // 컨트롤 플레인 정보
}
```

**ACK/NACK 메커니즘:**

```
Control Plane                          Envoy
     │                                   │
     │ DiscoveryResponse (version=1)     │
     │──────────────────────────────────▶│
     │                                   │ 설정 적용 성공
     │ DiscoveryRequest (version_info=1) │ ← ACK
     │◀──────────────────────────────────│
     │                                   │
     │ DiscoveryResponse (version=2)     │
     │──────────────────────────────────▶│
     │                                   │ 설정 적용 실패!
     │ DiscoveryRequest (version_info=1, │ ← NACK (이전 버전 유지)
     │   error_detail="invalid config") │
     │◀──────────────────────────────────│
     │                                   │
```

ACK는 `version_info`에 수신한 응답의 버전을 담아 보내는 것이다. NACK는 `version_info`에 이전에 성공한 버전을 담고, `error_detail`에 실패 원인을 기록하여 보내는 것이다. 이 메커니즘으로 컨트롤 플레인은 각 Envoy 인스턴스가 어떤 버전의 설정을 실행 중인지 추적할 수 있다.

### xDS 통신 방식

**1. State of the World (SotW) xDS**
- 전체 리소스 목록을 매번 전송하는 방식이다
- 리소스가 하나 변경되면 해당 타입의 전체 리소스를 다시 전송한다
- 구현이 단순하지만, 대규모 클러스터에서는 비효율적일 수 있다

```
예: 10,000개의 Endpoint 중 1개가 변경된 경우

SotW: 10,000개 전체를 재전송한다
      → 네트워크 대역폭과 CPU 낭비
      → istiod의 xDS push 크기가 수 MB에 달할 수 있다
```

**2. Incremental (Delta) xDS**
- 변경된 리소스만 전송하는 방식이다
- 리소스 추가/수정/삭제를 개별적으로 전달한다
- 대규모 클러스터에서 네트워크 대역폭과 처리 시간을 크게 절약한다

```
예: 10,000개의 Endpoint 중 1개가 변경된 경우

Delta: 변경된 1개만 전송한다
       → 네트워크 대역폭 절약 (수 KB)
       → 처리 시간 단축
```

**Delta xDS 메시지 구조:**

```protobuf
message DeltaDiscoveryRequest {
  Node node = 1;
  string type_url = 2;
  // 구독할 리소스 이름 (추가)
  repeated string resource_names_subscribe = 3;
  // 구독 해제할 리소스 이름 (삭제)
  repeated string resource_names_unsubscribe = 4;
  // 현재 가지고 있는 리소스의 버전 맵
  map<string, string> initial_resource_versions = 5;
  string response_nonce = 6;
  Status error_detail = 7;
}

message DeltaDiscoveryResponse {
  string system_version_info = 1;
  // 추가/변경된 리소스
  repeated Resource resources = 2;
  string type_url = 4;
  // 삭제된 리소스 이름
  repeated string removed_resources = 6;
  string nonce = 5;
}
```

**3. ADS (Aggregated Discovery Service)**
- 여러 xDS API를 하나의 gRPC 스트림으로 통합하는 방식이다
- 설정 업데이트의 순서를 보장한다 (예: CDS가 먼저 적용된 후 EDS가 적용됨)
- Istio는 ADS를 사용하여 설정 일관성을 보장한다

ADS 없이 각 xDS를 개별 스트림으로 사용하면 다음 문제가 발생할 수 있다:

```
문제 시나리오 (ADS 미사용):

시간 T1: RDS 업데이트 수신 → Route가 cluster_new를 참조한다
시간 T2: CDS 업데이트 아직 미수신 → cluster_new가 아직 정의되지 않았다
→ 결과: 503 에러 (No cluster found)

ADS 사용 시:

시간 T1: CDS 업데이트 수신 → cluster_new 정의
시간 T2: CDS warming 완료 후 RDS 업데이트 수신 → Route가 cluster_new를 참조
→ 결과: 정상 라우팅
```

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

### Warming 메커니즘 상세

"Warming"이란 새로운 Listener나 Cluster가 실제로 트래픽을 처리하기 전에 필요한 모든 종속 리소스가 준비되는 과정이다:

```
새 Listener "listener_A" 수신
     │
     ▼
┌────────────────────────────────┐
│  Warming 상태                   │
│                                 │
│  ① Route Config 대기            │ ← RDS에서 Route 설정 수신 대기
│  ② Route가 참조하는 Cluster 확인 │
│  ③ 해당 Cluster의 EDS 대기      │ ← 최소 1개 이상의 healthy endpoint 필요
│  ④ TLS 인증서 로드 (SDS)        │
│                                 │
│  모든 종속 리소스 준비 완료       │
└────────────────┬───────────────┘
                 │
                 ▼
           Active 상태
     (트래픽 처리 시작)
```

Warming 중인 Listener는 `config_dump`에서 `warming` 상태로 표시된다:

```bash
export KUBECONFIG=kubeconfig/dev.yaml
kubectl exec -it <pod-name> -n demo -c istio-proxy -- \
  curl -s localhost:15000/config_dump?resource=dynamic_listeners | \
  python3 -c "import sys,json; d=json.load(sys.stdin); [print(l.get('warming_state',{}).get('listener',{}).get('name','')) for l in d.get('configs',[{}])[0].get('dynamic_listeners',[])]"
```

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

### istiod → Envoy xDS Push 상세 과정

istiod가 xDS 설정을 생성하는 과정을 더 자세히 살펴보면:

```
Kubernetes API Server
     │
     │ Watch Events:
     │ - Service 생성/수정/삭제
     │ - Endpoints 변경
     │ - Pod 생성/종료
     │ - Istio CRD 변경 (VirtualService, DestinationRule 등)
     │
     ▼
┌─────────────────────────────────────┐
│  istiod 내부 처리                     │
│                                      │
│  1. Config Store                     │
│     ├── Kubernetes Config 수집        │
│     ├── Istio CRD 수집               │
│     └── MCP (Mesh Config Protocol)   │
│                                      │
│  2. Service Registry                 │
│     ├── Kubernetes Service           │
│     ├── Kubernetes Endpoints         │
│     └── ServiceEntry (외부 서비스)    │
│                                      │
│  3. Push Context 생성                │
│     ├── 어떤 Envoy가 영향을 받는가?   │
│     ├── 어떤 xDS 타입이 변경되었는가? │
│     └── Full Push vs Incremental?    │
│                                      │
│  4. xDS 응답 생성                    │
│     ├── Sidecar CRD → 노출 범위 결정 │
│     ├── AuthorizationPolicy → RBAC   │
│     ├── VirtualService → RDS         │
│     ├── DestinationRule → CDS/EDS    │
│     └── PeerAuthentication → TLS/SDS │
└──────────────────┬──────────────────┘
                   │
                   ▼
          xDS Push to Envoy Sidecars
```

**Sidecar CRD와 xDS 범위 제한:**

대규모 클러스터에서는 모든 서비스의 정보를 모든 Envoy에 push하면 메모리와 CPU가 낭비된다. Istio의 `Sidecar` CRD를 사용하면 각 워크로드가 알아야 하는 서비스 범위를 제한할 수 있다:

```yaml
apiVersion: networking.istio.io/v1beta1
kind: Sidecar
metadata:
  name: default
  namespace: demo
spec:
  egress:
    - hosts:
        - "./*"                    # 같은 네임스페이스의 모든 서비스
        - "istio-system/*"         # istio-system의 모든 서비스
        - "~/*.external-api.com"   # 특정 외부 서비스
  outboundTrafficPolicy:
    mode: REGISTRY_ONLY            # 등록된 서비스만 접근 허용
```

이 설정을 적용하면 해당 네임스페이스의 Envoy는 지정된 서비스에 대한 xDS 설정만 수신한다. 수천 개의 서비스가 있는 클러스터에서 Envoy 메모리 사용량을 크게 줄일 수 있다.

---

## Cluster 관리 심화

### Cluster Discovery Type

Cluster는 업스트림 엔드포인트를 어떻게 발견하는지에 따라 여러 타입으로 나뉜다:

| 타입 | 설명 | 사용 시나리오 |
|------|------|-------------|
| `STATIC` | 설정 파일에 엔드포인트를 고정적으로 정의한다 | 변하지 않는 외부 서비스 |
| `STRICT_DNS` | DNS를 주기적으로 쿼리하여 엔드포인트를 업데이트한다. DNS 결과의 모든 IP를 사용한다 | DNS 기반 서비스 디스커버리 |
| `LOGICAL_DNS` | DNS 쿼리 결과의 첫 번째 IP만 사용한다. 새 연결에만 새 IP를 적용한다 | 대규모 DNS 라운드로빈 (S3 등) |
| `EDS` | Endpoint Discovery Service를 통해 동적으로 수신한다 | Istio/Kubernetes 환경 |
| `ORIGINAL_DST` | iptables redirect의 원래 목적지를 그대로 사용한다 | Istio Passthrough |

**STRICT_DNS vs LOGICAL_DNS:**

```
STRICT_DNS:
  DNS Query: backend.example.com → [10.0.0.1, 10.0.0.2, 10.0.0.3]
  결과: 3개 엔드포인트 모두에 로드밸런싱한다
  DNS TTL 만료 시: 다시 쿼리하여 전체 목록을 교체한다
  주의: DNS 결과가 수천 개이면 모두 관리해야 하므로 비효율적이다

LOGICAL_DNS:
  DNS Query: s3.amazonaws.com → [10.0.0.1, 10.0.0.2, ...]
  결과: 첫 번째 IP(10.0.0.1)만 사용한다
  새 연결 시: DNS를 다시 쿼리하여 새 IP를 사용할 수 있다
  기존 연결: 이미 연결된 IP를 계속 사용한다
  적합: S3처럼 수백 개의 IP를 반환하는 대규모 서비스
```

### DNS 해석 설정

```yaml
clusters:
  - name: external_service
    type: STRICT_DNS
    dns_lookup_family: V4_ONLY     # IPv4만 사용 (V4_PREFERRED, V6_ONLY, AUTO 등)
    dns_refresh_rate: 60s           # DNS 재쿼리 주기 (기본 60s)
    dns_failure_refresh_rate:
      base_interval: 1s            # DNS 실패 시 재쿼리 초기 간격
      max_interval: 10s            # DNS 실패 시 재쿼리 최대 간격
    respect_dns_ttl: true           # DNS TTL을 존중할지 여부
    dns_resolvers:                  # 커스텀 DNS 서버 지정
      - socket_address:
          address: "8.8.8.8"
          port_value: 53
    typed_dns_resolver_config:
      name: envoy.network.dns_resolver.cares
      typed_config:
        "@type": type.googleapis.com/envoy.extensions.network.dns_resolver.cares.v3.CaresDnsResolverConfig
```

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

### 로드밸런싱 알고리즘 심화

#### Round Robin 상세

Weighted Round Robin을 지원하며, 엔드포인트에 가중치를 부여할 수 있다:

```yaml
clusters:
  - name: weighted_backend
    lb_policy: ROUND_ROBIN
    load_assignment:
      cluster_name: weighted_backend
      endpoints:
        - lb_endpoints:
            - endpoint:
                address:
                  socket_address: { address: backend-1, port_value: 8080 }
              load_balancing_weight: 3    # 3/5 비율로 트래픽 수신
            - endpoint:
                address:
                  socket_address: { address: backend-2, port_value: 8080 }
              load_balancing_weight: 2    # 2/5 비율로 트래픽 수신
```

Slow Start Mode를 활성화하면 새로 추가된 엔드포인트에 점진적으로 트래픽을 증가시킬 수 있다:

```yaml
clusters:
  - name: backend_with_slow_start
    lb_policy: ROUND_ROBIN
    round_robin_lb_config:
      slow_start_config:
        slow_start_window: 60s          # 60초에 걸쳐 점진적으로 가중치 증가
        aggression:                      # 가중치 증가 곡선의 공격성
          default_value: 1.0             # 1.0 = 선형, >1.0 = 더 공격적
```

#### Least Request 상세

"Power of 2 Choices" 알고리즘의 확장이다. N개의 무작위 엔드포인트 중 가장 요청이 적은 것을 선택한다:

```yaml
clusters:
  - name: least_request_backend
    lb_policy: LEAST_REQUEST
    least_request_lb_config:
      choice_count: 5               # 5개 후보 중 가장 적은 것 선택 (기본 2)
      active_request_bias:           # 활성 요청 수에 대한 편향
        default_value: 1.0           # 1.0이면 활성 요청 수에 비례
      slow_start_config:
        slow_start_window: 30s
```

`choice_count`가 클수록 더 정확하지만, 약간의 CPU 오버헤드가 있다. 실무에서는 2~5가 적절하다.

#### Ring Hash 상세

일관성 해싱(Consistent Hashing)을 사용한다. 엔드포인트가 추가/제거되어도 대부분의 키가 동일한 엔드포인트로 매핑된다:

```yaml
clusters:
  - name: cache_cluster
    lb_policy: RING_HASH
    ring_hash_lb_config:
      minimum_ring_size: 1024        # 해시 링의 최소 크기
      maximum_ring_size: 8388608     # 해시 링의 최대 크기 (8M)
      hash_function: XX_HASH         # 해시 함수 (XX_HASH 또는 MURMUR_HASH_2)
```

해시 키를 지정하는 Route 설정:
```yaml
routes:
  - match:
      prefix: "/"
    route:
      cluster: cache_cluster
      hash_policy:
        # 헤더 기반 해시
        - header:
            header_name: "x-user-id"
        # 쿠키 기반 해시 (세션 어피니티)
        - cookie:
            name: "session_id"
            ttl: 0s                    # 0이면 세션 쿠키 (브라우저 종료 시 삭제)
        # 소스 IP 기반 해시
        - connection_properties:
            source_ip: true
        # Query Parameter 기반 해시
        - query_parameter:
            name: "cache_key"
```

**Ring Hash의 동작 원리:**

```
해시 링 (크기: 1024)

        0
       ╱│╲
     ╱  │  ╲
   ╱    │    ╲
  768───┼───256
   ╲    │    ╱
     ╲  │  ╱
       ╲│╱
       512

Endpoint A의 가상 노드: [50, 250, 600, 900]
Endpoint B의 가상 노드: [150, 450, 700, 1000]
Endpoint C의 가상 노드: [100, 350, 550, 800]

hash("user-123") = 425 → 시계 방향으로 탐색 → Endpoint B(450)
hash("user-456") = 620 → 시계 방향으로 탐색 → Endpoint B(700)
hash("user-789") = 890 → 시계 방향으로 탐색 → Endpoint A(900)

Endpoint B 제거 시:
hash("user-123") = 425 → Endpoint C(550)으로 재매핑 (변경됨)
hash("user-789") = 890 → Endpoint A(900) (변경 없음!)
```

#### Maglev 상세

Google의 Maglev 논문에 기반한 일관성 해싱 알고리즘이다. Ring Hash에 비해 다음 장점이 있다:

1. **더 균등한 분산**: 룩업 테이블을 사용하여 엔드포인트 간 부하 편차가 적다
2. **빠른 테이블 재구성**: 엔드포인트 변경 시 테이블 재구성이 O(M log M)이다 (M = 테이블 크기)
3. **고정 크기 테이블**: 기본 테이블 크기는 65537 (소수)이다

```yaml
clusters:
  - name: maglev_cluster
    lb_policy: MAGLEV
    maglev_lb_config:
      table_size: 65537              # Maglev 룩업 테이블 크기 (소수여야 한다)
```

**Maglev vs Ring Hash 비교:**

| 특성 | Ring Hash | Maglev |
|------|-----------|--------|
| 부하 균등성 | 가상 노드 수에 따라 달라진다 | 항상 균등하다 |
| 메모리 사용 | 가변 (ring_size에 비례) | 고정 (table_size) |
| 엔드포인트 추가/제거 시 재매핑 비율 | 1/N (이론적 최소) | 약간 더 높을 수 있다 |
| 성능 | 이진 탐색 O(log N) | 직접 인덱싱 O(1) |
| 적합한 경우 | 세밀한 가상 노드 제어가 필요할 때 | 대부분의 일관성 해싱 시나리오 |

### Zone-Aware Load Balancing

Zone-aware 로드밸런싱은 가능한 한 같은 가용 영역(Availability Zone) 내의 엔드포인트로 트래픽을 라우팅한다. 이는 네트워크 지연을 줄이고 cross-zone 트래픽 비용을 절약한다:

```yaml
clusters:
  - name: zone_aware_backend
    lb_policy: ROUND_ROBIN
    common_lb_config:
      zone_aware_lb_config:
        routing_enabled:
          default_value: 100           # zone-aware 라우팅 활성화 비율 (100%)
        min_cluster_size: 6            # zone-aware를 활성화할 최소 클러스터 크기
        fail_traffic_on_panic: false   # 패닉 모드에서 트래픽 실패 여부
    load_assignment:
      cluster_name: zone_aware_backend
      endpoints:
        - locality:
            region: "us-east-1"
            zone: "us-east-1a"
          lb_endpoints:
            - endpoint:
                address:
                  socket_address: { address: 10.0.1.1, port_value: 8080 }
        - locality:
            region: "us-east-1"
            zone: "us-east-1b"
          lb_endpoints:
            - endpoint:
                address:
                  socket_address: { address: 10.0.2.1, port_value: 8080 }
```

**Zone-aware 동작 원리:**

```
Envoy가 us-east-1a에 위치한 경우:

조건 1: 로컬 zone의 엔드포인트 비율 ≥ 기대 비율
  → 100% 로컬 zone으로 라우팅한다

조건 2: 로컬 zone의 엔드포인트 비율 < 기대 비율
  → 비율에 따라 로컬/원격 zone으로 분배한다

패닉 모드: 로컬 zone의 healthy 엔드포인트가 너무 적으면
  → 모든 zone으로 분산한다 (최소 서비스 가용성 보장)
```

### Priority Level 로드밸런싱

Envoy는 엔드포인트에 우선순위(Priority)를 부여하여 계층적 장애 조치(failover)를 구현할 수 있다:

```yaml
load_assignment:
  cluster_name: tiered_backend
  endpoints:
    # Priority 0: 기본 (로컬 데이터센터)
    - priority: 0
      locality:
        region: "us-east-1"
      lb_endpoints:
        - endpoint:
            address:
              socket_address: { address: primary-1, port_value: 8080 }
        - endpoint:
            address:
              socket_address: { address: primary-2, port_value: 8080 }

    # Priority 1: 백업 (원격 데이터센터)
    - priority: 1
      locality:
        region: "us-west-2"
      lb_endpoints:
        - endpoint:
            address:
              socket_address: { address: backup-1, port_value: 8080 }

    # Priority 2: 최후 수단 (DR 사이트)
    - priority: 2
      locality:
        region: "eu-west-1"
      lb_endpoints:
        - endpoint:
            address:
              socket_address: { address: dr-1, port_value: 8080 }
```

**Priority Failover 동작:**

```
Priority 0 healthy 비율     트래픽 분배
──────────────────────     ────────────
100%                        P0: 100%, P1: 0%, P2: 0%
72%                         P0: 100%, P1: 0%, P2: 0%  (Panic Threshold 미만이 아니면)
70% (Panic Threshold)       P0: 100%, P1: 0%, P2: 0%  (패닉 모드 진입 직전)
50%                         P0: 50%,  P1: 50%, P2: 0%
0%                          P0: 0%,   P1: 100%, P2: 0%
P1도 0%                     P0: 0%,   P1: 0%,  P2: 100%
```

기본 패닉 임계치는 50%이다. `common_lb_config.healthy_panic_threshold`로 변경할 수 있다:

```yaml
common_lb_config:
  healthy_panic_threshold:
    value: 30                       # healthy 비율이 30% 미만이면 패닉 모드
```

패닉 모드에서는 healthy 여부와 관계없이 모든 엔드포인트에 트래픽을 분배한다. 이는 "일부 서비스라도 가용한 것이 전혀 불가용한 것보다 낫다"는 철학에 기반한다.

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

