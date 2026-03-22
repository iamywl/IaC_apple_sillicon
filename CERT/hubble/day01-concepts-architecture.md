# Day 1: 개념과 내부 아키텍처 심화

Hubble의 핵심 개념, eBPF 데이터 수집 메커니즘, hubble-relay 아키텍처, Flow 데이터 구조, L7 프로토콜 가시성, Hubble Metrics, UI, 아키텍처 전체도, Monitor 컴포넌트, Flow 파싱 엔진, L7 프로토콜 파서, Ring Buffer, gRPC API를 학습한다.

---

## 개념

### Hubble이란?

Hubble은 Cilium 위에 구축된 네트워크 옵저버빌리티 플랫폼이다. Cilium이 eBPF 기반으로 데이터플레인을 처리하는 과정에서 생성되는 이벤트를 수집하여, L3/L4/L7 수준의 트래픽 플로우를 실시간으로 관찰할 수 있게 해준다. DNS 쿼리, HTTP 요청, Kafka 메시지 등 애플리케이션 계층 프로토콜까지 가시화하며, CLI(hubble observe)와 Web UI(hubble-ui)를 모두 제공한다.

Hubble의 핵심 가치는 다음과 같다:
- **심층 가시성**: eBPF를 활용하므로 사이드카 프록시 없이도 L7 프로토콜 파싱이 가능하다
- **실시간 모니터링**: 패킷이 커널을 통과하는 시점에 이벤트를 생성하므로 지연 없이 관찰할 수 있다
- **정책 검증**: CiliumNetworkPolicy에 의해 허용/차단된 트래픽을 즉시 확인할 수 있다
- **서비스 의존성 파악**: Service Map을 통해 마이크로서비스 간 통신 관계를 시각적으로 파악할 수 있다

### 핵심 개념

| 개념 | 설명 |
|------|------|
| Flow | 네트워크 이벤트의 메타데이터이다. 출발/도착 identity, IP, port, 프로토콜, verdict 등을 포함한다 |
| Verdict | 트래픽의 처리 결과이다. FORWARDED(허용), DROPPED(차단), ERROR, AUDIT, REDIRECTED 등이 있다 |
| Identity | Cilium이 Pod에 부여하는 보안 식별자이다. label 기반으로 할당되며, Flow에서 source/destination을 식별하는 데 사용된다 |
| hubble-relay | 클러스터 내 모든 노드의 Hubble 데이터를 집계하는 컴포넌트이다. Deployment로 배포된다 |
| hubble-ui | 웹 기반 네트워크 토폴로지 시각화 도구이다. Service Map과 Flow 테이블을 제공한다 |
| Service Map | 서비스 간 통신 관계를 방향 그래프(directed graph)로 보여준다 |
| Ring Buffer | 각 노드에서 Flow 이벤트를 저장하는 고정 크기 순환 버퍼이다 |

### eBPF 데이터 수집 메커니즘

Hubble의 Flow 데이터 수집은 eBPF datapath와 밀접하게 연결되어 있다.

```
┌─────────────────────────────────────────────────────────┐
│                     Kernel Space                         │
│                                                         │
│  Packet ──► eBPF Program (TC/XDP) ──► 정책 평가          │
│                      │                                   │
│                      ▼                                   │
│              eBPF Perf Event Ring Buffer                  │
│              (per-CPU, 고정 크기)                          │
│                      │                                   │
└──────────────────────┼──────────────────────────────────┘
                       │ perf event read
┌──────────────────────┼──────────────────────────────────┐
│                      ▼           User Space              │
│              Hubble Observer                             │
│              (cilium-agent 내장)                          │
│                      │                                   │
│                      ▼                                   │
│              In-Memory Ring Buffer                       │
│              (기본 4096 entries)                          │
│                      │                                   │
│                      ▼                                   │
│              gRPC Server (:4245)                         │
└─────────────────────────────────────────────────────────┘
```

동작 과정은 다음과 같다:

1. **eBPF 이벤트 생성**: Cilium의 eBPF 프로그램이 패킷을 처리할 때(TC ingress/egress 또는 XDP hook), 정책 평가 결과와 함께 이벤트를 per-CPU perf event ring buffer에 기록한다
2. **User Space 전달**: cilium-agent 내부의 Hubble monitor가 perf event ring buffer를 polling하여 이벤트를 읽어온다
3. **Flow 변환**: raw 이벤트를 파싱하여 구조화된 Flow 객체로 변환한다. 이 과정에서 IP, port, identity, label 등의 메타데이터를 enrichment한다
4. **Ring Buffer 저장**: 변환된 Flow를 in-memory ring buffer에 저장한다. 기본 크기는 4096 entries이며, `--hubble-event-buffer-capacity` 옵션으로 조정할 수 있다. Ring buffer이므로 가장 오래된 항목부터 덮어쓴다
5. **gRPC 제공**: 로컬 Unix domain socket 또는 TCP(:4245)를 통해 gRPC API로 Flow를 제공한다

### hubble-relay 아키텍처

hubble-relay는 클러스터 전체의 Flow 데이터를 단일 엔드포인트로 통합하는 역할을 한다.

```
┌────────────────────────────────────────────────────────────┐
│                    hubble-relay (Deployment)                │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              Peer Discovery                          │  │
│  │  (CiliumInternalEndpoint 또는 Peer Service를 통해     │  │
│  │   모든 노드의 cilium-agent 주소를 자동 탐색)            │  │
│  └───────────────────┬──────────────────────────────────┘  │
│                      │                                      │
│  ┌───────────────────▼──────────────────────────────────┐  │
│  │           gRPC Streaming Connections                  │  │
│  │                                                      │  │
│  │  Node1:4245 ──► stream ──┐                           │  │
│  │  Node2:4245 ──► stream ──┼──► Merge & Sort           │  │
│  │  Node3:4245 ──► stream ──┘    (timestamp 기반)        │  │
│  └───────────────────┬──────────────────────────────────┘  │
│                      │                                      │
│  ┌───────────────────▼──────────────────────────────────┐  │
│  │         Unified gRPC API (:4245)                     │  │
│  │         hubble CLI / hubble-ui 가 연결                 │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
```

hubble-relay의 핵심 동작은 다음과 같다:

- **Peer Discovery**: hubble-relay는 클러스터 내 모든 cilium-agent의 위치를 자동으로 탐색한다. Cilium의 Peer Service를 통해 노드 목록을 조회하고, 노드가 추가/제거될 때 자동으로 반영한다
- **gRPC Bidirectional Streaming**: 각 노드의 Hubble gRPC 서버에 장기 연결(long-lived connection)을 유지하며, `GetFlows` RPC를 통해 Flow 스트림을 수신한다. 연결이 끊어지면 자동 재연결을 시도한다
- **Flow 병합**: 여러 노드에서 들어오는 Flow를 timestamp 기준으로 정렬하여 단일 스트림으로 병합한다. 이를 통해 클라이언트는 클러스터 전체의 Flow를 시간 순서대로 확인할 수 있다
- **Fan-out**: 다수의 클라이언트(hubble CLI, hubble-ui 등)가 동시에 연결할 수 있으며, 각 클라이언트의 필터 조건에 따라 독립적으로 Flow를 전달한다

### Flow 데이터 구조

Hubble Flow는 다음 필드들을 포함하는 Protocol Buffers 메시지이다:

| 카테고리 | 필드 | 설명 |
|----------|------|------|
| **식별 정보** | `source.identity` | 출발지 Cilium security identity 번호이다 |
| | `source.labels` | 출발지 Pod의 Kubernetes label 목록이다 (예: `k8s:app=frontend`) |
| | `source.namespace` | 출발지 Pod의 namespace이다 |
| | `source.pod_name` | 출발지 Pod 이름이다 |
| | `destination.identity` | 도착지 Cilium security identity 번호이다 |
| | `destination.labels` | 도착지 Pod의 Kubernetes label 목록이다 |
| | `destination.namespace` | 도착지 Pod의 namespace이다 |
| | `destination.pod_name` | 도착지 Pod 이름이다 |
| **네트워크 정보** | `IP.source` | 출발지 IP 주소이다 |
| | `IP.destination` | 도착지 IP 주소이다 |
| | `l4.TCP.source_port` | TCP 출발 포트이다 |
| | `l4.TCP.destination_port` | TCP 도착 포트이다 |
| | `l4.UDP.source_port` | UDP 출발 포트이다 |
| | `l4.UDP.destination_port` | UDP 도착 포트이다 |
| **이벤트 정보** | `verdict` | FORWARDED, DROPPED, ERROR, AUDIT, REDIRECTED 중 하나이다 |
| | `drop_reason` | 차단된 경우의 사유이다 (예: `POLICY_DENIED`, `CT_NO_MAP_FOUND`) |
| | `event_type` | 이벤트 유형이다 (예: `L3_L4`, `L7`, `DROP`, `TRACE`) |
| | `traffic_direction` | INGRESS 또는 EGRESS이다 |
| | `time` | 이벤트 발생 timestamp이다 |
| **L7 정보** | `l7.type` | REQUEST 또는 RESPONSE이다 |
| | `l7.http.method` | HTTP 메서드이다 (GET, POST 등) |
| | `l7.http.url` | 요청 URL 경로이다 |
| | `l7.http.code` | HTTP 응답 상태 코드이다 |
| | `l7.dns.query` | DNS 쿼리 도메인 이름이다 |
| | `l7.dns.rcode` | DNS 응답 코드이다 (NOERROR, NXDOMAIN 등) |
| | `l7.kafka.topic` | Kafka 토픽 이름이다 |
| | `l7.kafka.api_key` | Kafka API 타입이다 (Produce, Fetch 등) |

### L7 프로토콜 가시성

Hubble은 eBPF 기반 L7 프로토콜 파싱을 지원한다. L7 가시성을 활성화하려면 CiliumNetworkPolicy에 L7 규칙을 정의하거나 Pod annotation을 사용해야 한다.

**지원 프로토콜과 파싱 정보**:

| 프로토콜 | 파싱 정보 | 활성화 방법 |
|----------|----------|-------------|
| **HTTP** | method, URL, status code, headers | CiliumNetworkPolicy L7 rules 또는 annotation `policy.cilium.io/proxy-visibility: "<Ingress/80/TCP/HTTP>"` |
| **DNS** | query name, query type, response code, TTL, IP 응답 | Cilium의 DNS proxy를 통해 자동 파싱된다. `toFQDNs` 정책 사용 시 활성화된다 |
| **Kafka** | topic, API key (Produce/Fetch/Metadata 등), correlation ID | CiliumNetworkPolicy의 `kafka` L7 rules 정의 시 활성화된다 |
| **gRPC** | service name, method name, status code | HTTP/2 기반으로 파싱되며, HTTP와 동일한 방식으로 활성화된다 |

L7 가시성 annotation 예시:
```yaml
apiVersion: v1
kind: Pod
metadata:
  annotations:
    policy.cilium.io/proxy-visibility: "<Ingress/80/TCP/HTTP>,<Egress/53/UDP/DNS>"
```

이 annotation은 해당 Pod의 ingress 80번 포트 HTTP 트래픽과 egress 53번 포트 DNS 트래픽에 대해 L7 파싱을 활성화한다.

### Hubble Metrics

Hubble은 Flow 데이터를 기반으로 Prometheus 메트릭을 생성하여 export할 수 있다. cilium-agent의 `--enable-hubble-metrics` 옵션으로 활성화하며, Helm chart에서는 `hubble.metrics.enabled`를 사용한다.

**주요 메트릭**:

| 메트릭 이름 | 타입 | 설명 |
|------------|------|------|
| `hubble_flows_processed_total` | Counter | 처리된 총 Flow 수이다. `type`, `subtype`, `verdict` label을 가진다 |
| `hubble_dns_queries_total` | Counter | DNS 쿼리 총 수이다. `rcode`, `qtypes`, `ips_returned` label을 가진다 |
| `hubble_dns_responses_total` | Counter | DNS 응답 총 수이다 |
| `hubble_dns_response_types_total` | Counter | DNS 응답 유형별 카운트이다 |
| `hubble_drop_total` | Counter | 드롭된 패킷 총 수이다. `reason`, `protocol` label을 가진다 |
| `hubble_http_requests_total` | Counter | HTTP 요청 총 수이다. `method`, `protocol`, `reporter` label을 가진다 |
| `hubble_http_responses_total` | Counter | HTTP 응답 총 수이다. `method`, `status` label을 가진다 |
| `hubble_http_request_duration_seconds` | Histogram | HTTP 요청 처리 시간 분포이다 |
| `hubble_tcp_flags_total` | Counter | TCP flag별 패킷 수이다 (SYN, FIN, RST 등) |
| `hubble_port_distribution_total` | Counter | 포트별 트래픽 분포이다 |

Helm chart에서 메트릭을 활성화하는 예시:
```yaml
hubble:
  enabled: true
  metrics:
    enabled:
      - dns
      - drop
      - tcp
      - flow
      - port-distribution
      - icmp
      - httpV2:exemplars=true;labelsContext=source_ip,source_namespace,destination_ip,destination_namespace
    serviceMonitor:
      enabled: true  # Prometheus Operator ServiceMonitor 자동 생성
```

메트릭은 cilium-agent Pod의 `:9965/metrics` 엔드포인트에서 Prometheus scrape 형식으로 노출된다.

### Hubble UI 내부 동작

Hubble UI는 hubble-relay의 gRPC API에 연결하여 실시간 Flow 데이터를 수신하고, 이를 시각화한다.

**Service Dependency Map 생성 과정**:

1. **Flow 수집**: 사용자가 선택한 namespace의 Flow 데이터를 hubble-relay로부터 실시간 스트리밍으로 수신한다
2. **그래프 구성**: 각 Flow의 `source`와 `destination` 정보를 추출하여 방향 그래프(directed graph)의 노드와 엣지를 구성한다. Pod label 중 `app` 또는 `k8s-app` label을 기준으로 서비스 단위로 그룹핑한다
3. **엣지 어노테이션**: 각 엣지에 프로토콜 정보(HTTP, DNS, TCP 등), verdict(허용/차단), 트래픽 양을 부가 정보로 표시한다
4. **레이아웃 렌더링**: 그래프 레이아웃 알고리즘을 적용하여 노드 위치를 계산하고, 실시간으로 업데이트한다

Hubble UI의 주요 화면 구성은 다음과 같다:
- **Service Map**: 서비스 간 통신 관계를 방향 그래프로 시각화한다. 녹색 엣지는 허용된 트래픽, 빨간색 엣지는 차단된 트래픽을 의미한다
- **Flow Table**: 개별 Flow를 시간순으로 나열하며, 필터링과 검색을 지원한다
- **Policy Verdict**: 각 Flow에 대해 어떤 정책이 적용되었는지 표시한다

### 아키텍처 전체도

```
┌─────────────────────────────────────────────────────────────────┐
│                        Client Layer                             │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐│
│  │  hubble CLI   │  │  hubble-ui   │  │ Prometheus + Grafana   ││
│  │  (observe)    │  │  (Web UI)    │  │ (메트릭 수집/시각화)      ││
│  └──────┬───────┘  └──────┬───────┘  └───────────┬────────────┘│
└─────────┼─────────────────┼──────────────────────┼─────────────┘
          │ gRPC             │ gRPC                  │ HTTP scrape
          │                  │                       │ :9965/metrics
┌─────────▼──────────────────▼───────────────────────┼─────────────┐
│                hubble-relay (Deployment)            │             │
│                gRPC streaming aggregation           │             │
│                :4245                                │             │
└────────┬───────────────────┬────────────────────────┼────────────┘
         │ gRPC stream        │ gRPC stream            │
┌────────▼─────────┐  ┌──────▼──────────┐  ┌─────────▼──────────┐
│  cilium-agent    │  │  cilium-agent   │  │  cilium-agent      │
│  + Hubble        │  │  + Hubble       │  │  + Hubble          │
│  (Node 1)        │  │  (Node 2)       │  │  (Node 3)          │
│                  │  │                 │  │                    │
│  ┌────────────┐  │  │  ┌────────────┐ │  │  ┌────────────┐   │
│  │ Ring Buffer │  │  │  │ Ring Buffer│ │  │  │ Ring Buffer│   │
│  │ (4096)      │  │  │  │ (4096)     │ │  │  │ (4096)     │   │
│  └─────┬──────┘  │  │  └─────┬──────┘ │  │  └─────┬──────┘   │
│        │         │  │        │        │  │        │          │
│  ┌─────▼──────┐  │  │  ┌─────▼──────┐ │  │  ┌─────▼──────┐   │
│  │ eBPF       │  │  │  │ eBPF       │ │  │  │ eBPF       │   │
│  │ Datapath   │  │  │  │ Datapath   │ │  │  │ Datapath   │   │
│  └────────────┘  │  │  └────────────┘ │  │  └────────────┘   │
└──────────────────┘  └────────────────┘  └────────────────────┘
```

---

### 이 프로젝트에서의 실습 환경

이 프로젝트에서 Hubble은 모든 클러스터에서 Cilium과 함께 배포된다.

- 설치 스크립트: `scripts/install/06-install-cilium.sh` (Cilium과 함께 설치)
- Helm values: `manifests/hubble-values.yaml`
- Hubble UI: NodePort 31235
- Hubble Metrics: DNS, drop, TCP, flow, ICMP, HTTP
- 실습 대상 클러스터: dev (`kubeconfig/dev.yaml`)

```bash
# dev 클러스터에서 Hubble 상태 확인
export KUBECONFIG=kubeconfig/dev.yaml
cilium hubble port-forward &
hubble status
hubble observe --namespace demo
```

---

## Hubble 내부 아키텍처 심화

### Monitor 컴포넌트: perf event 수집 파이프라인

Hubble의 데이터 수집은 cilium-agent 내부에 내장된 Monitor 컴포넌트에서 시작된다. Monitor는 eBPF datapath가 생성하는 perf event를 수집하여 Flow 객체로 변환하는 전체 파이프라인을 관장한다.

**perf event 수집 파이프라인 상세 구조**:

```
┌──────────────────────────────────────────────────────────────────────┐
│                          Kernel Space                                │
│                                                                      │
│  ┌────────────────┐    ┌────────────────┐    ┌────────────────┐     │
│  │ TC ingress hook │    │ TC egress hook  │    │   XDP hook     │     │
│  │ (bpf_redirect)  │    │ (bpf_redirect)  │    │ (early drop)   │     │
│  └───────┬────────┘    └───────┬────────┘    └───────┬────────┘     │
│          │                     │                     │               │
│          ▼                     ▼                     ▼               │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │              send_trace_notify() / send_drop_notify()        │   │
│  │              send_policy_verdict_notify()                     │   │
│  │              send_l7_notify()                                 │   │
│  └──────────────────────────┬───────────────────────────────────┘   │
│                              │                                       │
│                              ▼                                       │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │           Per-CPU Perf Event Ring Buffer                      │   │
│  │           (CPU 0) (CPU 1) (CPU 2) ... (CPU N)                │   │
│  │           각 CPU별 독립적 버퍼, lock-free 구조                  │   │
│  └──────────────────────────┬───────────────────────────────────┘   │
│                              │                                       │
└──────────────────────────────┼───────────────────────────────────────┘
                               │ epoll / perf_event_read
┌──────────────────────────────┼───────────────────────────────────────┐
│                              ▼              User Space                │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │           Monitor (perf event reader goroutine)              │   │
│  │                                                              │   │
│  │  1. perf_event_open() 으로 각 CPU의 perf buffer fd 획득       │   │
│  │  2. epoll_wait() 로 이벤트 도착 대기                           │   │
│  │  3. 이벤트 도착 시 mmap된 ring buffer에서 직접 read             │   │
│  │  4. MonitorEvent 구조체로 디코딩                                │   │
│  └──────────────────────────┬───────────────────────────────────┘   │
│                              │                                       │
│                              ▼                                       │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │           Observer (Flow 변환 엔진)                            │   │
│  │                                                              │   │
│  │  1. MonitorEvent → Flow 변환                                  │   │
│  │  2. Identity 해석: numeric ID → label set                     │   │
│  │  3. Endpoint 해석: IP → Pod name, namespace                   │   │
│  │  4. Service 해석: ClusterIP:port → service name               │   │
│  │  5. DNS cache enrichment: IP → FQDN                          │   │
│  └──────────────────────────┬───────────────────────────────────┘   │
│                              │                                       │
│                              ▼                                       │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │           Container (In-Memory Ring Buffer)                   │   │
│  │           기본 4096 entries, 덮어쓰기 방식                      │   │
│  └──────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────┘
```

**Monitor 이벤트 타입**: eBPF 프로그램은 패킷 처리 과정에서 여러 종류의 notify 함수를 호출한다.

| Notify 함수 | 발생 시점 | 포함 정보 |
|-------------|----------|----------|
| `send_trace_notify()` | 패킷이 정상적으로 처리(forwarding)될 때 | source/destination identity, ifindex, 이유 코드 |
| `send_drop_notify()` | 패킷이 드롭될 때 | drop reason 코드, 드롭 위치, 패킷 헤더 |
| `send_policy_verdict_notify()` | 정책 평가가 완료될 때 | match type, audit/enforce 모드, 적용된 정책 정보 |
| `send_l7_notify()` | L7 프록시가 요청/응답을 처리할 때 | L7 프로토콜별 파싱 결과 |
| `send_capture_notify()` | 패킷 캡처가 활성화된 경우 | 전체 패킷 데이터 또는 일부 |

**per-CPU 설계의 이유**: perf event ring buffer는 CPU별로 독립적으로 운영된다. 이는 여러 CPU에서 동시에 패킷을 처리할 때 lock contention을 완전히 제거하기 위한 설계이다. 각 CPU의 eBPF 프로그램은 자기 CPU의 ring buffer에만 쓰기를 수행하므로, 다른 CPU와의 동기화가 전혀 필요하지 않다. User space의 monitor는 모든 CPU의 ring buffer를 epoll로 동시에 감시하여 이벤트를 수집한다.

### Flow 파싱 엔진: L3/L4 헤더 디코딩

Monitor가 수집한 raw perf event는 Observer의 Flow 파싱 엔진에 전달되어 구조화된 Flow 객체로 변환된다. 이 과정에서 L3/L4 헤더를 디코딩하여 네트워크 메타데이터를 추출한다.

**L3 헤더 디코딩**:

```
IPv4 Header 디코딩:
┌─────────────────────────────────────────────────────────┐
│ Version(4) │ IHL(4) │ DSCP(6) │ ECN(2) │ Total Len(16) │
├─────────────────────────────────────────────────────────┤
│ Identification(16) │ Flags(3) │ Fragment Offset(13)     │
├─────────────────────────────────────────────────────────┤
│ TTL(8) │ Protocol(8) │ Header Checksum(16)              │
├─────────────────────────────────────────────────────────┤
│ Source IP Address (32)                                   │
├─────────────────────────────────────────────────────────┤
│ Destination IP Address (32)                              │
└─────────────────────────────────────────────────────────┘

추출 필드:
- IP.source        ← Source IP Address
- IP.destination   ← Destination IP Address
- ip_version       ← Version (4 또는 6)
- Protocol         ← 다음 헤더 프로토콜 (6=TCP, 17=UDP, 1=ICMP)
```

```
IPv6 Header 디코딩:
┌─────────────────────────────────────────────────────────┐
│ Version(4) │ Traffic Class(8) │ Flow Label(20)          │
├─────────────────────────────────────────────────────────┤
│ Payload Length(16) │ Next Header(8) │ Hop Limit(8)      │
├─────────────────────────────────────────────────────────┤
│ Source Address (128)                                     │
├─────────────────────────────────────────────────────────┤
│ Destination Address (128)                                │
└─────────────────────────────────────────────────────────┘
```

**L4 헤더 디코딩**:

```
TCP Header:
┌─────────────────────────────────────────────────────────┐
│ Source Port(16) │ Destination Port(16)                   │
├─────────────────────────────────────────────────────────┤
│ Sequence Number(32)                                      │
├─────────────────────────────────────────────────────────┤
│ Acknowledgment Number(32)                                │
├─────────────────────────────────────────────────────────┤
│ Data Offset(4) │ Reserved(3) │ Flags(9)                 │
│                │             │ NS CWR ECE URG ACK PSH   │
│                │             │ RST SYN FIN              │
├─────────────────────────────────────────────────────────┤
│ Window Size(16) │ Checksum(16)                           │
├─────────────────────────────────────────────────────────┤
│ Urgent Pointer(16) │ Options(variable)                   │
└─────────────────────────────────────────────────────────┘

추출 필드:
- l4.TCP.source_port       ← Source Port
- l4.TCP.destination_port  ← Destination Port
- l4.TCP.flags             ← SYN, ACK, FIN, RST 등 (hubble_tcp_flags_total 메트릭용)
```

```
UDP Header:
┌─────────────────────────────────────────────────────────┐
│ Source Port(16) │ Destination Port(16)                   │
├─────────────────────────────────────────────────────────┤
│ Length(16) │ Checksum(16)                                │
└─────────────────────────────────────────────────────────┘

추출 필드:
- l4.UDP.source_port       ← Source Port
- l4.UDP.destination_port  ← Destination Port
```

```
ICMPv4 Header:
┌─────────────────────────────────────────────────────────┐
│ Type(8) │ Code(8) │ Checksum(16)                        │
├─────────────────────────────────────────────────────────┤
│ Message Body (variable, type에 따라 다름)                │
└─────────────────────────────────────────────────────────┘

추출 필드:
- l4.ICMPv4.type  ← Type (0=Echo Reply, 3=Dest Unreachable, 8=Echo Request 등)
- l4.ICMPv4.code  ← Code (세부 에러 코드)
```

**Identity 해석 과정**: Flow 파싱 엔진은 raw IP 주소를 Cilium의 identity 시스템과 매핑한다. cilium-agent는 내부적으로 IP → Identity 캐시를 유지하며, 이를 통해 source/destination endpoint의 label set, namespace, pod name 등을 enrichment한다. Identity 해석이 실패하면 `UNKNOWN` identity로 기록된다.

### L7 프로토콜 파서: HTTP, DNS, Kafka, gRPC 각각의 파싱 로직

L7 프로토콜 파싱은 Cilium의 Envoy 기반 L7 proxy를 통해 이루어진다. L7 정책이 적용된 트래픽은 커널에서 proxy로 리다이렉트되며, proxy가 프로토콜을 파싱한 후 결과를 Hubble에 전달한다.

**HTTP 파서**:

HTTP 파서는 HTTP/1.1과 HTTP/2 프로토콜을 모두 처리한다. Envoy의 HTTP connection manager가 요청/응답을 파싱하며, 다음 정보를 추출한다:

| 추출 필드 | 설명 | 예시 값 |
|-----------|------|---------|
| `l7.http.method` | HTTP 메서드 | GET, POST, PUT, DELETE, PATCH |
| `l7.http.url` | 요청 URL 경로 (query string 포함) | /api/v1/users?page=1 |
| `l7.http.code` | 응답 상태 코드 | 200, 404, 500 |
| `l7.http.protocol` | HTTP 프로토콜 버전 | HTTP/1.1, HTTP/2 |
| `l7.http.headers` | 요청/응답 헤더 (설정에 따라 선택적) | Content-Type, Authorization 등 |
| `l7.latency_ns` | 요청-응답 간 지연 시간 (나노초) | 15000000 (15ms) |

HTTP 파싱 시 요청과 응답은 별도의 Flow로 기록된다. 요청 Flow의 `l7.type`은 `REQUEST`이고, 응답 Flow의 `l7.type`은 `RESPONSE`이다. 두 Flow는 동일한 trace context로 연결된다.

**DNS 파서**:

DNS 파서는 Cilium의 내장 DNS proxy를 통해 동작한다. `toFQDNs` 정책이 적용되면 DNS 트래픽이 Cilium의 DNS proxy를 경유하게 되며, 이때 DNS 메시지를 파싱한다.

| 추출 필드 | 설명 | 예시 값 |
|-----------|------|---------|
| `l7.dns.query` | 쿼리 도메인 이름 | api.example.com. |
| `l7.dns.query_type` | 쿼리 타입 | A, AAAA, CNAME, SRV, MX |
| `l7.dns.rcode` | 응답 코드 | NoError, NXDomain, ServFail, Refused |
| `l7.dns.ips` | 응답 IP 목록 (A/AAAA 레코드) | ["10.0.1.5", "10.0.1.6"] |
| `l7.dns.ttl` | TTL 값 (초) | 300 |
| `l7.dns.rrtypes` | 응답 레코드 타입 | A, AAAA, CNAME |
| `l7.dns.observation_source` | 관찰 소스 | proxy |

DNS 파서의 특수성은, L7 정책 없이도 `toFQDNs` 규칙만으로 DNS 가시성이 확보된다는 점이다. Cilium은 DNS 응답을 캐시하여 이후 해당 FQDN으로의 IP 기반 필터링에 활용한다.

**Kafka 파서**:

Kafka 파서는 Kafka 프로토콜의 request/response 메시지를 파싱한다. CiliumNetworkPolicy에 `kafka` L7 규칙을 정의하면 활성화된다.

| 추출 필드 | 설명 | 예시 값 |
|-----------|------|---------|
| `l7.kafka.error_code` | Kafka 에러 코드 | 0 (성공), 3 (UnknownTopicOrPartition) |
| `l7.kafka.api_version` | API 버전 | 0, 1, 2 ... |
| `l7.kafka.api_key` | API 타입 | Produce(0), Fetch(1), Metadata(3) |
| `l7.kafka.correlation_id` | 요청-응답 매칭 ID | 12345 |
| `l7.kafka.topic` | 대상 토픽 이름 | orders, user-events |

Kafka API Key 주요 목록:

| API Key | 이름 | 설명 |
|---------|------|------|
| 0 | Produce | 메시지 전송 |
| 1 | Fetch | 메시지 소비 |
| 2 | ListOffsets | 오프셋 조회 |
| 3 | Metadata | 브로커/토픽 메타데이터 조회 |
| 8 | OffsetCommit | 오프셋 커밋 |
| 9 | OffsetFetch | 커밋된 오프셋 조회 |
| 10 | FindCoordinator | 그룹 코디네이터 탐색 |
| 11 | JoinGroup | 컨슈머 그룹 참가 |
| 12 | Heartbeat | 그룹 멤버 heartbeat |
| 13 | LeaveGroup | 그룹 탈퇴 |
| 14 | SyncGroup | 그룹 동기화 |

**gRPC 파서**:

gRPC는 HTTP/2 위에서 동작하므로, HTTP 파서의 확장으로 처리된다. gRPC 요청의 content-type이 `application/grpc`인 HTTP/2 요청을 gRPC로 인식한다.

| 추출 필드 | 설명 | 예시 값 |
|-----------|------|---------|
| `l7.http.method` | 항상 POST | POST |
| `l7.http.url` | gRPC service/method 경로 | /package.ServiceName/MethodName |
| `l7.http.protocol` | HTTP/2 | HTTP/2 |
| `l7.http.code` | HTTP 상태 코드 (보통 200) | 200 |
| `l7.http.headers["grpc-status"]` | gRPC 상태 코드 | 0 (OK), 2 (UNKNOWN), 13 (INTERNAL) |

gRPC 상태 코드 목록:

| 코드 | 이름 | 설명 |
|------|------|------|
| 0 | OK | 성공 |
| 1 | CANCELLED | 클라이언트에 의해 취소 |
| 2 | UNKNOWN | 알 수 없는 에러 |
| 3 | INVALID_ARGUMENT | 잘못된 인자 |
| 4 | DEADLINE_EXCEEDED | 타임아웃 |
| 5 | NOT_FOUND | 리소스 없음 |
| 7 | PERMISSION_DENIED | 권한 없음 |
| 8 | RESOURCE_EXHAUSTED | 리소스 소진 |
| 12 | UNIMPLEMENTED | 미구현 메서드 |
| 13 | INTERNAL | 내부 서버 에러 |
| 14 | UNAVAILABLE | 서비스 불가 |
| 16 | UNAUTHENTICATED | 인증 실패 |

### Ring Buffer 구현 상세

Hubble의 Ring Buffer는 두 계층으로 구분된다: 커널 공간의 per-CPU perf event ring buffer와, 유저 공간의 in-memory ring buffer이다.

**커널 공간 per-CPU Perf Event Ring Buffer**:

```
CPU 0 Ring Buffer:          CPU 1 Ring Buffer:
┌───────────────┐          ┌───────────────┐
│ ███ event 3   │ ← write  │ ██ event 2    │ ← write
│ ██ event 2    │          │ █ event 1     │
│ █ event 1     │          │ (empty)       │
│ (empty)       │          │ (empty)       │
│ (empty)       │          │ (empty)       │
└───────────────┘          └───────────────┘
      ↑ read                    ↑ read
      │                         │
      └───────────┬─────────────┘
                  │
          Monitor goroutine
          (epoll_wait on all CPU fds)
```

- 각 CPU는 독립적인 ring buffer를 보유한다
- eBPF 프로그램은 `bpf_perf_event_output()` helper로 이벤트를 자기 CPU의 buffer에 기록한다
- 버퍼 크기는 `--monitor-queue-size` 옵션으로 조정한다 (기본 값은 CPU당 수십 KB)
- 버퍼가 가득 차면 가장 오래된 이벤트를 덮어쓰며, `lost events` 카운터가 증가한다

**유저 공간 In-Memory Ring Buffer**:

```
Ring Buffer (기본 4096 entries):
┌────┬────┬────┬────┬────┬────┬────┬────┐
│ F0 │ F1 │ F2 │ F3 │ ... │ F4094│F4095│    │
└────┴────┴────┴────┴────┴────┴────┴────┘
                                    ↑
                              write pointer
                    ↑
              read pointer (oldest entry)
```

- `--hubble-event-buffer-capacity` 옵션으로 entries 수를 지정한다 (기본 4096)
- 각 entry는 하나의 Flow 객체를 저장한다
- 순환(circular) 구조로 동작하여, 버퍼가 가득 차면 가장 오래된 entry를 덮어쓴다
- gRPC `GetFlows` 요청 시, 클라이언트는 이 ring buffer에서 Flow를 읽어간다
- `--follow` 모드에서는 새로운 Flow가 추가될 때마다 클라이언트에 push된다

**오버플로우 처리**: Ring buffer 오버플로우 시, Hubble은 이를 감지하고 `hubble_lost_events_total` 메트릭을 증가시킨다. 지속적으로 lost events가 발생하면 buffer 크기를 늘려야 한다. 다만, buffer 크기를 무한정 늘리면 메모리 사용량이 증가하므로 적정 크기를 산출해야 한다.

### 메모리 풋프린트

Ring buffer 크기에 따른 메모리 소비를 계산할 수 있다. 하나의 Flow 객체는 대략 다음과 같은 메모리를 소비한다:

| 구성 요소 | 대략적 크기 |
|-----------|-----------|
| Flow Protocol Buffers 기본 필드 | ~200 bytes |
| source/destination Endpoint 정보 | ~300 bytes (labels 포함) |
| L4 헤더 정보 | ~50 bytes |
| L7 정보 (HTTP/DNS/Kafka) | ~100-500 bytes (프로토콜에 따라) |
| Go 런타임 오버헤드 (포인터, GC 메타) | ~100 bytes |
| **합계 (평균)** | **~750 bytes - 1.2 KB** |

**buffer 크기별 예상 메모리 사용량**:

| buffer capacity | L3/L4 전용 (750B/entry) | L7 포함 (1.2KB/entry) |
|-----------------|------------------------|----------------------|
| 4,096 (기본) | ~3 MB | ~4.8 MB |
| 16,384 | ~12 MB | ~19.2 MB |
| 65,536 | ~48 MB | ~76.8 MB |
| 131,072 | ~96 MB | ~153.6 MB |
| 524,288 | ~384 MB | ~614.4 MB |

대규모 클러스터에서는 노드당 메모리를 고려해야 한다. 100개 노드 클러스터에서 buffer capacity를 65,536으로 설정하면, 클러스터 전체에서 Hubble ring buffer가 소비하는 메모리는 4.8GB ~ 7.7GB 정도이다.

### gRPC API 상세

Hubble의 gRPC API는 `observer.proto`에 정의되어 있으며, 다음 RPC를 제공한다:

**Observer Service**:

```protobuf
service Observer {
  // GetFlows: Flow 스트림을 반환한다
  rpc GetFlows(GetFlowsRequest) returns (stream GetFlowsResponse);

  // GetAgentEvents: agent 내부 이벤트를 반환한다
  rpc GetAgentEvents(GetAgentEventsRequest) returns (stream GetAgentEventsResponse);

  // GetDebugEvents: 디버그 이벤트를 반환한다
  rpc GetDebugEvents(GetDebugEventsRequest) returns (stream GetDebugEventsResponse);

  // GetNodes: 연결된 노드 목록을 반환한다 (relay 전용)
  rpc GetNodes(GetNodesRequest) returns (GetNodesResponse);

  // GetNamespaces: 관찰 가능한 namespace 목록을 반환한다
  rpc GetNamespaces(GetNamespacesRequest) returns (GetNamespacesResponse);

  // ServerStatus: Hubble 서버 상태를 반환한다
  rpc ServerStatus(ServerStatusRequest) returns (ServerStatusResponse);
}
```

**GetFlows RPC**: 가장 핵심적인 RPC이다. `GetFlowsRequest`에 필터 조건을 지정하면, 조건에 맞는 Flow를 스트리밍으로 반환한다.

```protobuf
message GetFlowsRequest {
  uint64 number = 1;                    // 반환할 Flow 최대 수
  bool follow = 3;                      // true이면 실시간 스트리밍
  repeated FlowFilter blacklist = 5;    // 제외 필터
  repeated FlowFilter whitelist = 6;    // 포함 필터
  google.protobuf.Timestamp since = 7;  // 시작 시간
  google.protobuf.Timestamp until = 8;  // 종료 시간
  bool first = 9;                       // 가장 오래된 것부터
}
```

**GetAgentEvents RPC**: cilium-agent의 내부 이벤트를 제공한다. Endpoint 생성/삭제, policy 업데이트, IPCache 변경 등의 이벤트를 관찰할 수 있어 에이전트 동작 디버깅에 유용하다.

**GetDebugEvents RPC**: eBPF datapath의 디버그 이벤트를 제공한다. 패킷 경로 추적, 정책 매칭 과정 등 저수준 디버깅 정보를 확인할 수 있다.

**ServerStatus RPC**: Hubble 서버의 상태를 반환한다.

```protobuf
message ServerStatusResponse {
  uint64 num_flows = 1;               // ring buffer에 저장된 현재 Flow 수
  uint64 max_flows = 2;               // ring buffer 최대 용량
  uint64 seen_flows = 3;              // 시작 이후 처리한 총 Flow 수
  google.protobuf.Duration uptime = 4; // 서버 가동 시간
  repeated string unavailable_nodes = 5; // 연결 불가 노드 목록 (relay)
  string version = 6;                  // Hubble 버전
}
```

---

