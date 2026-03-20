# Day 2: Flow 데이터 구조 심화, hubble-relay 심화, Hubble UI 심화

Flow 데이터의 Protocol Buffers 정의, Flow 타입, Verdict, Drop Reason, Identity 구조, hubble-relay의 Peer Discovery/Connection Pool/Flow Merging, Hubble UI의 React 프론트엔드와 Service Map 렌더링을 학습한다.

---

## Flow 데이터 구조 심화

### Protocol Buffers 정의 상세

Hubble의 Flow 메시지는 `flow.proto`에 정의되어 있다. 전체 필드를 카테고리별로 정리하면 다음과 같다.

**최상위 Flow 메시지**:

```protobuf
message Flow {
  google.protobuf.Timestamp time = 1;
  Verdict verdict = 2;
  uint32 drop_reason = 3;
  Ethernet ethernet = 4;
  IP IP = 5;
  Layer4 l4 = 6;
  Endpoint source = 8;
  Endpoint destination = 9;
  FlowType Type = 10;
  string node_name = 11;
  repeated string source_names = 13;
  repeated string destination_names = 14;
  Layer7 l7 = 15;
  bool reply = 16;
  EventTypeFilter event_type = 18;
  CiliumEventType source_service = 19;
  Service destination_service = 20;
  TrafficDirection traffic_direction = 22;
  uint32 policy_match_type = 23;
  TraceObservationPoint trace_observation_point = 24;
  uint32 drop_reason_desc = 25;
  bool is_reply = 26;
  DebugCapturePoint debug_capture_point = 27;
  FlowInterface interface = 28;
  uint32 proxy_port = 29;
  TraceContext trace_context = 30;
  uint32 sock_xlate_point = 31;
  int32 socket_cookie = 32;
  uint32 cgroup_id = 33;
  Summary summary = 100;
}
```

**Endpoint 메시지** (source/destination 공통):

```protobuf
message Endpoint {
  uint32 ID = 1;
  uint32 identity = 2;
  string namespace = 3;
  repeated string labels = 4;
  string pod_name = 5;
  repeated Workload workloads = 6;
}

message Workload {
  string name = 1;
  string kind = 2;  // "Deployment", "DaemonSet", "StatefulSet" 등
}
```

### Flow 타입 전체 목록

| FlowType | 값 | 설명 |
|-----------|---|------|
| `UNKNOWN_TYPE` | 0 | 알 수 없는 타입이다 |
| `L3_L4` | 1 | L3/L4 수준 이벤트이다. IP/TCP/UDP 헤더 정보를 포함한다 |
| `L7` | 2 | L7 프로토콜 이벤트이다. HTTP, DNS, Kafka 등의 파싱 결과를 포함한다 |
| `SOCK` | 3 | Socket-level 이벤트이다. connect/close 등 소켓 라이프사이클을 추적한다 |
| `TRACE` | 4 | 패킷 경로 추적 이벤트이다. 패킷이 datapath의 어느 지점을 통과했는지 기록한다 |
| `DROP` | 5 | 패킷 드롭 이벤트이다. 드롭 사유와 위치를 포함한다 |
| `POLICY_VERDICT` | 6 | 정책 평가 결과 이벤트이다. 어떤 정책이 매칭되었는지 기록한다 |
| `CAPTURE` | 7 | 패킷 캡처 이벤트이다. 전체 패킷 데이터를 포함할 수 있다 |
| `DEBUG` | 8 | 디버그 이벤트이다. 개발/트러블슈팅 목적이다 |

### TrafficDirection 상세

| TrafficDirection | 값 | 설명 |
|-----------------|---|------|
| `TRAFFIC_DIRECTION_UNKNOWN` | 0 | 방향을 판별할 수 없는 경우이다 |
| `INGRESS` | 1 | Pod으로 들어오는 트래픽이다. TC ingress hook에서 관찰된다 |
| `EGRESS` | 2 | Pod에서 나가는 트래픽이다. TC egress hook에서 관찰된다 |

TrafficDirection은 정책 평가의 핵심이다. CiliumNetworkPolicy의 `ingress` 규칙은 `INGRESS` 방향 트래픽에, `egress` 규칙은 `EGRESS` 방향 트래픽에 적용된다. 동일한 패킷이라도 관찰 지점에 따라 source Pod에서는 EGRESS로, destination Pod에서는 INGRESS로 기록될 수 있다.

### Verdict 상세

| Verdict | 값 | 설명 | 발생 조건 |
|---------|---|------|----------|
| `VERDICT_UNKNOWN` | 0 | 판정 불가 | 내부 에러 시 |
| `FORWARDED` | 1 | 전달 허용 | 정책에 의해 허용되었거나 정책이 없는 경우 |
| `DROPPED` | 2 | 드롭 | 정책에 의해 차단되었거나 커넥션 트래킹 실패 |
| `ERROR` | 3 | 에러 발생 | 처리 과정에서 내부 에러 발생 |
| `AUDIT` | 4 | 감사 모드 허용 | 정책이 audit 모드로 설정된 경우 (차단하지 않고 기록만) |
| `REDIRECTED` | 5 | 리다이렉트 | L7 proxy로 리다이렉트된 경우 |
| `TRACED` | 6 | 추적됨 | trace 목적으로 기록된 경우 |

`AUDIT` verdict는 새로운 정책을 점진적으로 적용할 때 유용하다. 정책을 enforce 모드가 아닌 audit 모드로 배포하면, 실제 차단 없이 어떤 트래픽이 영향을 받는지 미리 확인할 수 있다.

### Drop Reason 코드 전체 목록

Drop reason은 패킷이 드롭된 구체적 사유를 나타낸다. 트러블슈팅 시 가장 중요한 정보이다.

| Drop Reason 코드 | 이름 | 설명 | 대처 방법 |
|------------------|------|------|----------|
| 0 | `SUCCESS` | 성공 (드롭이 아님) | - |
| 2 | `INVALID_SOURCE_MAC` | 출발지 MAC 주소 무효 | NIC/드라이버 점검 |
| 3 | `INVALID_DESTINATION_MAC` | 도착지 MAC 주소 무효 | ARP 테이블 점검 |
| 4 | `INVALID_SOURCE_IP` | 출발지 IP 무효 | IP 할당 확인 |
| 5 | `POLICY_DENIED` | 정책에 의해 차단 | CiliumNetworkPolicy 확인 |
| 6 | `INVALID_PACKET_DROPPED` | 무효 패킷 | 패킷 형식 점검 |
| 7 | `CT_TRUNCATED_OR_INVALID_HEADER` | conntrack 헤더 오류 | 패킷 손상 확인 |
| 8 | `CT_MISSING_TCP_ACK_FLAG` | TCP ACK 없음 | TCP 상태 머신 확인 |
| 9 | `CT_UNKNOWN_L4_PROTOCOL` | 알 수 없는 L4 프로토콜 | 프로토콜 지원 여부 확인 |
| 10 | `CT_CANNOT_CREATE_ENTRY_FROM_PACKET` | CT 항목 생성 불가 | CT 테이블 용량 확인 |
| 11 | `UNSUPPORTED_L3_PROTOCOL` | 미지원 L3 프로토콜 | - |
| 12 | `MISSED_TAIL_CALL` | tail call 실패 | eBPF 프로그램 로딩 확인 |
| 13 | `ERROR_WRITING_TO_PACKET` | 패킷 쓰기 에러 | 커널 버그 의심, 버전 확인 |
| 14 | `UNKNOWN_L4_PROTOCOL` | 알 수 없는 L4 프로토콜 | - |
| 15 | `UNKNOWN_ICMPV4_CODE` | 알 수 없는 ICMPv4 코드 | - |
| 16 | `UNKNOWN_ICMPV4_TYPE` | 알 수 없는 ICMPv4 타입 | - |
| 17 | `UNKNOWN_ICMPV6_CODE` | 알 수 없는 ICMPv6 코드 | - |
| 18 | `UNKNOWN_ICMPV6_TYPE` | 알 수 없는 ICMPv6 타입 | - |
| 19 | `ERROR_RETRIEVING_TUNNEL_KEY` | 터널 키 조회 실패 | VXLAN/Geneve 설정 확인 |
| 20 | `ERROR_RETRIEVING_TUNNEL_OPTIONS` | 터널 옵션 조회 실패 | 터널 설정 확인 |
| 21 | `INVALID_GENEVE_OPTION` | Geneve 옵션 무효 | 터널 설정 확인 |
| 22 | `UNKNOWN_L3_TARGET` | L3 대상 불명 | 라우팅 테이블 확인 |
| 23 | `STALE_OR_UNROUTABLE` | 만료된 경로 또는 라우팅 불가 | 라우팅 확인 |
| 24 | `NO_TUNNEL_OR_ENCAPSULATION_ENDPOINT` | 터널 엔드포인트 없음 | 노드 간 터널 확인 |
| 26 | `NO_MAPPING_FOR_NAT_MASQUERADE` | NAT/Masquerade 매핑 없음 | masquerade 설정 확인 |
| 27 | `UNSUPPORTED_L2_PROTOCOL` | 미지원 L2 프로토콜 | - |
| 28 | `NO_MAPPING_FOR_SNAT` | SNAT 매핑 없음 | SNAT 설정 확인 |
| 130 | `POLICY_DENY` | 명시적 deny 정책 | deny 정책 확인 |
| 131 | `VLAN_FILTERED` | VLAN 필터링 | VLAN 설정 확인 |
| 132 | `INVALID_VNI` | VNI 무효 | VXLAN VNI 확인 |
| 133 | `INVALID_TC_BUFFER` | TC 버퍼 무효 | 커널/드라이버 확인 |
| 140 | `NO_SID` | SRv6 SID 없음 | SRv6 설정 확인 |
| 181 | `IS_A_CLUSTERIP` | ClusterIP로의 직접 접근 | kube-proxy 없는 모드에서 서비스 라우팅 확인 |

가장 흔하게 마주하는 drop reason은 `POLICY_DENIED`(5)이다. 이는 CiliumNetworkPolicy에 의해 트래픽이 차단되었음을 의미하며, 정책을 추가하거나 수정하여 해결한다.

### Identity 구조: Reserved Identities

Cilium은 특수한 목적의 reserved identity를 내장하고 있다. 이 identity들은 고정된 번호를 가지며, 특정 종류의 트래픽을 식별하는 데 사용된다.

| Identity 번호 | 이름 | 설명 | 용도 |
|--------------|------|------|------|
| 0 | `unknown` | 알 수 없는 identity | identity 해석 실패 시 |
| 1 | `host` | 로컬 호스트 | 노드 자체에서 발생하는 트래픽 |
| 2 | `world` | 클러스터 외부 | 클러스터 외부 IP와의 통신 |
| 3 | `unmanaged` | Cilium 관리 외 | Cilium이 관리하지 않는 endpoint |
| 4 | `health` | Cilium 헬스 체크 | cilium-health 프로브 트래픽 |
| 5 | `init` | 초기화 중 | endpoint identity 할당 전 상태 |
| 6 | `remote-node` | 원격 노드 | 다른 노드에서 발생한 트래픽 |
| 7 | `kube-apiserver` | Kubernetes API 서버 | kube-apiserver와의 통신 |
| 8 | `ingress` | Ingress | Ingress 컨트롤러 트래픽 |
| 9 | `world-ipv4` | 외부 IPv4 | 클러스터 외부 IPv4 |
| 10 | `world-ipv6` | 외부 IPv6 | 클러스터 외부 IPv6 |
| 11 | `encrypted-overlay` | 암호화된 오버레이 | WireGuard/IPsec 오버레이 트래픽 |

일반 Pod의 identity는 16384 이상의 번호가 동적으로 할당된다. 같은 label set을 가진 Pod들은 동일한 identity를 공유한다.

### IP, Ethernet, TCP, UDP, ICMPv4, ICMPv6 레이어 구조

**Ethernet 레이어**:
```protobuf
message Ethernet {
  string source = 1;       // 출발지 MAC (예: "0a:58:0a:f4:00:01")
  string destination = 2;  // 도착지 MAC (예: "0a:58:0a:f4:00:02")
}
```

**IP 레이어**:
```protobuf
message IP {
  string source = 1;       // 출발지 IP (예: "10.244.0.5")
  string destination = 2;  // 도착지 IP (예: "10.244.1.10")
  IPVersion ipVersion = 3; // IPv4 또는 IPv6
  bool encrypted = 4;      // IPsec/WireGuard 암호화 여부
}
```

**Layer4 레이어**:
```protobuf
message Layer4 {
  oneof protocol {
    TCP TCP = 1;
    UDP UDP = 2;
    ICMPv4 ICMPv4 = 3;
    ICMPv6 ICMPv6 = 4;
    SCTP SCTP = 5;
  }
}

message TCP {
  uint32 source_port = 1;
  uint32 destination_port = 2;
  TCPFlags flags = 3;       // SYN, ACK, FIN, RST, PSH, URG 등
}

message UDP {
  uint32 source_port = 1;
  uint32 destination_port = 2;
}

message ICMPv4 {
  uint32 type = 1;   // 0=Echo Reply, 3=Dest Unreachable, 8=Echo Request, 11=Time Exceeded
  uint32 code = 2;   // Type별 세부 코드
}

message ICMPv6 {
  uint32 type = 1;   // 1=Dest Unreachable, 128=Echo Request, 129=Echo Reply, 135=Neighbor Solicitation
  uint32 code = 2;
}
```

---

## hubble-relay 심화

### 아키텍처: Peer Discovery, Connection Pool, Flow Merging

hubble-relay는 세 개의 핵심 서브시스템으로 구성된다.

**1. Peer Discovery 서브시스템**:

```
┌──────────────────────────────────────────────────────────┐
│                  Peer Discovery                           │
│                                                          │
│  ┌──────────────────────────────────────────────────┐    │
│  │         Cilium Peer Service gRPC API              │    │
│  │         (cilium-agent :4244)                      │    │
│  └──────────────────┬───────────────────────────────┘    │
│                     │                                     │
│                     ▼                                     │
│  ┌──────────────────────────────────────────────────┐    │
│  │         Peer Watcher                              │    │
│  │                                                   │    │
│  │  - ChangeNotification 스트림 수신                   │    │
│  │  - 노드 추가: Peer 목록에 추가 + Connection Pool     │    │
│  │    에 연결 요청                                      │    │
│  │  - 노드 제거: Connection Pool에서 연결 해제          │    │
│  │  - 노드 변경: IP 변경 시 재연결                      │    │
│  └──────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘
```

Peer Discovery는 Cilium의 Peer Service를 통해 클러스터 내 모든 cilium-agent의 주소를 실시간으로 추적한다. 노드가 추가되면 자동으로 해당 노드의 Hubble gRPC 서버에 연결을 설정하고, 노드가 제거되면 연결을 정리한다.

**2. Connection Pool 서브시스템**:

```
┌──────────────────────────────────────────────────────────┐
│                  Connection Pool                          │
│                                                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐               │
│  │ Conn #1  │  │ Conn #2  │  │ Conn #3  │  ...          │
│  │ Node A   │  │ Node B   │  │ Node C   │               │
│  │ :4245    │  │ :4245    │  │ :4245    │               │
│  │          │  │          │  │          │               │
│  │ state:   │  │ state:   │  │ state:   │               │
│  │ READY    │  │ READY    │  │ CONNECTING│              │
│  └──────────┘  └──────────┘  └──────────┘               │
│                                                          │
│  연결 상태 관리:                                           │
│  - IDLE → CONNECTING → READY                             │
│  - READY → DISCONNECTED → CONNECTING (자동 재연결)         │
│  - backoff: 지수 백오프 (1s → 2s → 4s → ... → 30s max)   │
└──────────────────────────────────────────────────────────┘
```

각 노드에 대한 gRPC 연결을 관리한다. 연결이 끊어지면 지수 백오프(exponential backoff)로 자동 재연결을 시도한다. 최대 백오프 간격은 30초이다.

**3. Flow Merging 서브시스템**:

```
Node A flows:  t=1, t=3, t=5, t=8
Node B flows:  t=2, t=4, t=7
Node C flows:  t=6, t=9, t=10

          │           │           │
          ▼           ▼           ▼
┌──────────────────────────────────────────┐
│         Heap-based Merge Sort             │
│                                          │
│  Priority Queue (min-heap by timestamp): │
│  ┌──┬──┬──┐                              │
│  │t1│t2│t6│ ← 각 노드의 가장 오래된 Flow    │
│  └──┴──┴──┘                              │
│                                          │
│  Pop t=1 (Node A) → emit                 │
│  Push t=3 (Node A의 다음 Flow)             │
│  Pop t=2 (Node B) → emit                 │
│  Push t=4 (Node B의 다음 Flow)             │
│  ...                                     │
│                                          │
│  출력: t=1, t=2, t=3, t=4, t=5, t=6 ...  │
└──────────────────────────────────────────┘
```

여러 노드에서 도착하는 Flow 스트림을 timestamp 기준으로 정렬하여 단일 스트림으로 병합한다. 내부적으로 min-heap(priority queue)을 사용하여 O(log N) 복잡도로 병합한다 (N = 노드 수).

### 성능: 노드 수 증가에 따른 확장성

hubble-relay의 성능은 클러스터 규모에 따라 다음과 같이 변화한다:

| 클러스터 규모 | relay 연결 수 | 초당 Flow 처리량 (예상) | CPU 사용량 | 메모리 사용량 |
|-------------|-------------|----------------------|-----------|-------------|
| 10 노드 | 10 | ~10,000 flows/s | 0.1-0.3 core | 50-100 MB |
| 50 노드 | 50 | ~50,000 flows/s | 0.5-1.0 core | 200-400 MB |
| 100 노드 | 100 | ~100,000 flows/s | 1.0-2.0 core | 400-800 MB |
| 500 노드 | 500 | ~500,000 flows/s | 3.0-5.0 core | 1-2 GB |

병목 지점은 주로 다음에서 발생한다:
- **gRPC 스트림 관리**: 노드 수에 비례하여 goroutine과 소켓이 증가한다
- **Flow 병합**: heap 연산은 O(log N)이지만, 높은 throughput에서 CPU 부하가 증가한다
- **클라이언트 fan-out**: 다수의 hubble CLI / UI 클라이언트가 동시 접속하면 각 클라이언트에 대해 독립적 병합이 필요하다

### TLS 설정: hubble-relay ↔ cilium-agent 간 mTLS

hubble-relay와 cilium-agent 간 통신은 mTLS(mutual TLS)로 암호화할 수 있다. 프로덕션 환경에서는 반드시 활성화해야 한다.

**Helm chart에서 mTLS 활성화**:

```yaml
hubble:
  tls:
    enabled: true
    auto:
      enabled: true              # certgen 또는 cert-manager로 자동 인증서 발급
      method: certgen            # certgen (기본), helm, cronJob 중 선택
      certValidityDuration: 1095 # 인증서 유효 기간 (일)
      schedule: "0 0 1 */4 *"    # cronJob 방식 시 인증서 갱신 주기
  relay:
    tls:
      server:
        enabled: true            # relay의 gRPC 서버 TLS 활성화
        # relay → client (hubble CLI, UI) 간 TLS
```

mTLS 활성화 시 인증서 체인:
1. **CA 인증서**: Cilium에서 자체 발급하거나 cert-manager를 통해 발급한다
2. **Server 인증서**: 각 cilium-agent의 Hubble gRPC 서버가 사용한다
3. **Client 인증서**: hubble-relay가 cilium-agent에 연결할 때 사용한다

인증서는 Kubernetes Secret으로 저장되며, cilium-agent와 hubble-relay Pod에 volume mount된다.

### High Availability: 복수 relay 인스턴스

hubble-relay는 Deployment로 배포되므로 replica 수를 늘려 고가용성을 확보할 수 있다.

```yaml
hubble:
  relay:
    replicas: 2  # 또는 3
    resources:
      requests:
        cpu: 100m
        memory: 128Mi
      limits:
        cpu: 1000m
        memory: 1Gi
```

복수 relay 인스턴스를 운영할 때 주의할 점이 있다:
- 각 relay 인스턴스는 독립적으로 모든 노드에 연결한다. 즉, 3개의 relay가 있으면 각 cilium-agent는 3개의 gRPC 연결을 수신한다
- hubble CLI / UI는 Kubernetes Service를 통해 relay에 접근하므로, Service의 load balancing에 의해 하나의 relay 인스턴스에 연결된다
- relay 인스턴스가 죽으면 Service가 자동으로 다른 인스턴스로 트래픽을 전환한다
- relay 인스턴스 간 상태 동기화는 불필요하다. 각 인스턴스가 독립적으로 전체 클러스터의 Flow를 제공한다

### 필터 푸시다운: 서버사이드 필터링 vs 클라이언트사이드

hubble-relay의 필터링은 두 가지 방식으로 동작한다:

**서버사이드 필터링 (권장)**:
```
hubble observe --namespace demo --verdict DROPPED

Client → relay → cilium-agent (필터 적용) → 매칭 Flow만 전송
                                             네트워크 대역폭 절약
```

hubble CLI에서 지정한 필터 조건은 gRPC `GetFlowsRequest`의 `whitelist`/`blacklist` 필드에 포함된다. relay는 이 필터를 각 cilium-agent에 전달(push down)하며, agent는 ring buffer에서 Flow를 읽을 때 필터를 적용하여 매칭되는 Flow만 스트리밍한다.

**클라이언트사이드 필터링**:
```
hubble observe --output json | jq 'select(.flow.verdict == "DROPPED")'

Client → relay → cilium-agent → 모든 Flow 전송
                                 클라이언트에서 필터링
                                 네트워크 대역폭 낭비
```

jq 등 외부 도구로 필터링하면 모든 Flow가 네트워크를 통해 전송된 후 클라이언트에서 걸러진다. 대규모 클러스터에서는 불필요한 네트워크 부하를 유발한다.

따라서 가능한 한 `hubble observe`의 내장 필터 옵션을 사용하여 서버사이드 필터링을 활용하는 것이 바람직하다.

---

## Hubble UI 심화

### React 기반 프론트엔드

Hubble UI는 TypeScript + React 기반의 단일 페이지 애플리케이션(SPA)이다. 주요 기술 스택은 다음과 같다:

| 기술 | 용도 |
|------|------|
| React | UI 컴포넌트 프레임워크 |
| TypeScript | 타입 안전성 확보 |
| MobX | 상태 관리 (Flow 데이터, 필터 상태, 선택된 namespace 등) |
| gRPC-Web | hubble-relay와 gRPC 통신 (HTTP/1.1로 변환) |
| D3.js / custom renderer | Service Map 그래프 렌더링 |
| Protocol Buffers (protobuf-ts) | Flow 메시지 직렬화/역직렬화 |

**아키텍처 구조**:

```
┌──────────────────────────────────────────────────────────┐
│                  Hubble UI (Browser)                      │
│                                                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│  │ Namespace    │  │ Service Map │  │ Flow Table  │     │
│  │ Selector    │  │ View        │  │ View        │     │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘     │
│         │                │                │              │
│         ▼                ▼                ▼              │
│  ┌──────────────────────────────────────────────────┐   │
│  │               State Store (MobX)                  │   │
│  │  - flows: Flow[]                                  │   │
│  │  - services: Map<string, ServiceInfo>             │   │
│  │  - links: Map<string, LinkInfo>                   │   │
│  │  - selectedNamespace: string                      │   │
│  │  - filters: FilterState                           │   │
│  └──────────────────────┬───────────────────────────┘   │
│                         │                                │
│  ┌──────────────────────▼───────────────────────────┐   │
│  │          gRPC-Web Client                          │   │
│  │          GetFlows() streaming RPC                 │   │
│  └──────────────────────┬───────────────────────────┘   │
│                         │                                │
└─────────────────────────┼────────────────────────────────┘
                          │ gRPC-Web (HTTP/1.1)
┌─────────────────────────▼────────────────────────────────┐
│              hubble-ui-backend (Go)                       │
│              gRPC-Web → gRPC 변환                         │
│              hubble-relay:4245 연결                        │
└──────────────────────────────────────────────────────────┘
```

Hubble UI는 별도의 backend 컴포넌트(hubble-ui-backend)를 통해 hubble-relay에 연결한다. 브라우저는 gRPC를 직접 사용할 수 없으므로, gRPC-Web 프로토콜로 backend와 통신하고, backend가 이를 gRPC로 변환하여 relay에 전달한다.

### Service Map 렌더링: 방향 그래프 알고리즘

Service Map은 Flow 데이터로부터 방향 그래프(directed graph)를 구성하고 시각적으로 렌더링한다.

**그래프 구성 과정**:

1. **노드(Node) 추출**: 각 Flow의 `source.labels`와 `destination.labels`에서 `app` 또는 `k8s-app` label 값을 추출한다. 동일한 label 값을 가진 Pod들은 하나의 노드로 그룹핑된다
2. **엣지(Edge) 추출**: source 노드 → destination 노드 방향으로 엣지를 생성한다. 같은 방향의 엣지는 하나로 통합되며, 엣지에 프로토콜, verdict 정보를 어노테이션한다
3. **외부 엔터티 표현**: `world` identity(클러스터 외부)는 특별한 "world" 노드로 표시된다. `kube-dns`, `kube-apiserver` 등 시스템 컴포넌트도 개별 노드로 표현된다

**레이아웃 알고리즘**: Hubble UI는 force-directed layout 기반의 커스텀 레이아웃 알고리즘을 사용한다.

```
Force-Directed Layout 원리:
- 모든 노드 간에 척력(repulsive force)이 작용한다 (겹침 방지)
- 연결된 노드 간에 인력(attractive force)이 작용한다 (관련 서비스 근접 배치)
- 반복적 시뮬레이션으로 안정 상태에 도달한다

최적화:
- Barnes-Hut 알고리즘으로 O(N log N) 복잡도 달성
- 초기 배치 시 topological sort를 활용하여 수렴 속도 향상
- 노드 수가 적을 때(<30) 계층적 레이아웃 적용 가능
```

**엣지 색상 코드**:
| 색상 | 의미 |
|------|------|
| 녹색 | FORWARDED - 허용된 트래픽 |
| 빨간색 | DROPPED - 차단된 트래픽 |
| 노란색 | AUDIT - 감사 모드 (차단하지 않지만 기록) |
| 회색 | 판정 불가 또는 혼합 |

### Namespace 별 뷰

Hubble UI는 namespace 단위로 Service Map을 제공한다. 좌측 드롭다운에서 namespace를 선택하면 해당 namespace의 Pod들만 포함하는 Service Map이 렌더링된다.

**주요 기능**:
- **namespace 선택**: 드롭다운에서 namespace를 선택하면 해당 namespace로 들어오거나 나가는 모든 Flow를 수집한다
- **cross-namespace 표현**: 다른 namespace의 서비스는 외부 엔터티로 표시되며, namespace 이름이 prefix로 붙는다
- **All Namespaces 모드**: 전체 namespace를 선택하면 클러스터 전체의 통신 관계를 볼 수 있다 (대규모 클러스터에서는 과부하 주의)

### Flow Table: 실시간 스트리밍

Flow Table은 개별 Flow를 시간순으로 나열하는 뷰이다.

**컬럼 구성**:
| 컬럼 | 내용 |
|------|------|
| Timestamp | Flow 발생 시간 |
| Source | 출발지 Pod/서비스 이름 |
| Destination | 도착지 Pod/서비스 이름 |
| Verdict | FORWARDED / DROPPED / AUDIT 등 |
| Type | L3_L4 / L7 / DROP 등 |
| L7 Info | HTTP method+URL, DNS query, Kafka topic 등 |

**실시간 스트리밍**: Flow Table은 `GetFlows` RPC의 `follow=true` 모드를 사용하여 새로운 Flow가 발생할 때마다 실시간으로 테이블에 추가한다. 브라우저에서 스크롤이 맨 아래에 있으면 자동 스크롤되며, 사용자가 위로 스크롤하면 자동 스크롤이 멈추어 특정 Flow를 상세히 분석할 수 있다.

### 커스텀 필터 작성

Hubble UI에서는 상단 필터 바를 통해 다양한 조건으로 Flow를 필터링할 수 있다.

**필터 카테고리**:
- **Verdict**: FORWARDED, DROPPED, AUDIT 체크박스
- **Source/Destination**: Pod, Service, IP, Label 기반 필터
- **Protocol**: TCP, UDP, HTTP, DNS 등
- **HTTP**: Method, Status Code, Path
- **DNS**: Query domain

필터를 적용하면 Service Map과 Flow Table이 동시에 업데이트되어, 필터 조건에 맞는 트래픽만 시각화된다. 예를 들어, verdict=DROPPED 필터를 적용하면 Service Map에서 차단된 트래픽 엣지만 표시된다.

---

