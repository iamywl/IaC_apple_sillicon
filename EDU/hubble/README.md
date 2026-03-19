# Hubble - Cilium 네트워크 옵저버빌리티

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

## Hubble Metrics 심화

### Prometheus 메트릭 내보내기 구조

Hubble 메트릭 시스템은 Flow 데이터를 실시간으로 분석하여 Prometheus Counter, Histogram 등의 메트릭으로 변환한다.

```
┌──────────────────────────────────────────────────────────┐
│                  cilium-agent                              │
│                                                          │
│  ┌─────────────────────┐                                 │
│  │  Hubble Observer     │                                 │
│  │  (Flow 생성)         │                                 │
│  └──────────┬──────────┘                                 │
│             │ Flow                                        │
│             ▼                                             │
│  ┌─────────────────────┐    ┌─────────────────────┐      │
│  │  Ring Buffer         │    │  Metrics Handler    │      │
│  │  (hubble observe용)  │    │                     │      │
│  └─────────────────────┘    │  Flow → Metric 변환: │      │
│                              │  - dns handler       │      │
│             │ Flow (병렬)    │  - drop handler      │      │
│             └───────────►    │  - flow handler      │      │
│                              │  - http handler      │      │
│                              │  - tcp handler       │      │
│                              │  - icmp handler      │      │
│                              │  - port-distribution │      │
│                              └──────────┬──────────┘      │
│                                         │                  │
│  ┌──────────────────────────────────────▼──────────────┐  │
│  │        Prometheus Registry                           │  │
│  │        HTTP endpoint :9965/metrics                   │  │
│  └──────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
                     │ HTTP scrape
                     ▼
            Prometheus Server
```

**메트릭 핸들러 활성화**: Helm chart의 `hubble.metrics.enabled` 배열에 핸들러 이름을 나열하여 활성화한다. 이 프로젝트에서는 다음 핸들러를 사용한다:

```yaml
# manifests/hubble-values.yaml
hubble:
  metrics:
    enabled:
      - dns
      - drop
      - tcp
      - flow
      - icmp
      - http
```

각 핸들러는 해당 유형의 Flow만 처리하여 메트릭을 생성한다. 핸들러를 많이 활성화할수록 CPU 부하가 증가하므로, 필요한 핸들러만 활성화하는 것이 좋다.

### 주요 메트릭 전체 목록

**Flow 메트릭 (flow handler)**:

| 메트릭 | 타입 | Label | 설명 |
|--------|------|-------|------|
| `hubble_flows_processed_total` | Counter | type, subtype, verdict | 처리된 총 Flow 수이다 |

Label 값 예시:
- `type`: `L3_L4`, `L7`, `Trace`, `Drop`, `PolicyVerdict`
- `subtype`: `to-endpoint`, `to-stack`, `from-endpoint`, `dns-request` 등
- `verdict`: `FORWARDED`, `DROPPED`, `ERROR`, `AUDIT`

**Drop 메트릭 (drop handler)**:

| 메트릭 | 타입 | Label | 설명 |
|--------|------|-------|------|
| `hubble_drop_total` | Counter | reason, protocol | 드롭된 패킷 총 수이다 |
| `hubble_drop_bytes_total` | Counter | reason, protocol | 드롭된 바이트 총 수이다 |

reason label 값: `POLICY_DENIED`, `CT_NO_MAP_FOUND`, `INVALID_SOURCE_IP`, `STALE_OR_UNROUTABLE` 등

**TCP 메트릭 (tcp handler)**:

| 메트릭 | 타입 | Label | 설명 |
|--------|------|-------|------|
| `hubble_tcp_flags_total` | Counter | flag, family | TCP flag별 패킷 수이다 |

flag label 값: `SYN`, `SYN-ACK`, `ACK`, `FIN`, `RST`, `PSH`

**DNS 메트릭 (dns handler)**:

| 메트릭 | 타입 | Label | 설명 |
|--------|------|-------|------|
| `hubble_dns_queries_total` | Counter | rcode, qtypes, ips_returned | DNS 쿼리 총 수이다 |
| `hubble_dns_responses_total` | Counter | rcode, qtypes, ips_returned | DNS 응답 총 수이다 |
| `hubble_dns_response_types_total` | Counter | type, qtypes | DNS 응답 타입별 카운트이다 |

rcode label 값: `No Error`, `Format Error`, `Server Failure`, `Non-Existent Domain`, `Refused`

**HTTP 메트릭 (http handler)**:

| 메트릭 | 타입 | Label | 설명 |
|--------|------|-------|------|
| `hubble_http_requests_total` | Counter | method, protocol, reporter | HTTP 요청 총 수이다 |
| `hubble_http_responses_total` | Counter | method, status, reporter | HTTP 응답 총 수이다 |
| `hubble_http_request_duration_seconds` | Histogram | method, reporter | HTTP 요청 처리 시간 분포이다 |

httpV2 handler를 사용하면 추가 label context를 지정할 수 있다:
```yaml
httpV2:exemplars=true;labelsContext=source_ip,source_namespace,source_workload,destination_ip,destination_namespace,destination_workload
```

**ICMP 메트릭 (icmp handler)**:

| 메트릭 | 타입 | Label | 설명 |
|--------|------|-------|------|
| `hubble_icmp_total` | Counter | family, type | ICMP 메시지 총 수이다 |

**Port Distribution 메트릭 (port-distribution handler)**:

| 메트릭 | 타입 | Label | 설명 |
|--------|------|-------|------|
| `hubble_port_distribution_total` | Counter | port, protocol | 포트별 트래픽 분포이다 |

### Grafana 대시보드: 네트워크 가시성 대시보드 구성

Grafana 대시보드는 Hubble 메트릭을 시각적으로 표현하여 네트워크 상태를 한눈에 파악할 수 있게 해준다.

**권장 대시보드 패널 구성**:

```
┌───────────────────────────────────────────────────────────────┐
│  Hubble Network Observability Dashboard                       │
│                                                               │
│  ┌─────────────────────────────┬─────────────────────────────┐│
│  │  Flow Rate (flows/sec)      │  Drop Rate (drops/sec)      ││
│  │  [시계열 그래프]              │  [시계열 그래프, reason별]    ││
│  │  verdict별 색상 구분          │  빨간색 강조                 ││
│  └─────────────────────────────┴─────────────────────────────┘│
│  ┌─────────────────────────────┬─────────────────────────────┐│
│  │  DNS Query Rate             │  DNS Error Rate             ││
│  │  [시계열 그래프]              │  [시계열 그래프]              ││
│  │  rcode별 구분                │  Non-NOERROR 비율            ││
│  └─────────────────────────────┴─────────────────────────────┘│
│  ┌─────────────────────────────┬─────────────────────────────┐│
│  │  HTTP Request Rate          │  HTTP Error Rate (4xx/5xx)  ││
│  │  [시계열 그래프]              │  [시계열 그래프]              ││
│  │  method별 구분               │  status 코드별 구분          ││
│  └─────────────────────────────┴─────────────────────────────┘│
│  ┌─────────────────────────────┬─────────────────────────────┐│
│  │  HTTP Latency P50/P95/P99   │  TCP Flags Distribution     ││
│  │  [시계열 그래프]              │  [stacked bar chart]        ││
│  │  백분위수별 라인              │  SYN/FIN/RST 비율           ││
│  └─────────────────────────────┴─────────────────────────────┘│
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  Top Drop Reasons (table)                                │ │
│  │  [테이블] reason | count | protocol                      │ │
│  └──────────────────────────────────────────────────────────┘ │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  Port Distribution (top 20)                              │ │
│  │  [bar chart] port별 트래픽 양                              │ │
│  └──────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────┘
```

**주요 PromQL 쿼리 (대시보드 패널별)**:

```promql
# 1. 초당 Flow 처리율 (verdict별)
sum by (verdict) (rate(hubble_flows_processed_total[5m]))

# 2. 초당 Drop율 (reason별, top 10)
topk(10, sum by (reason) (rate(hubble_drop_total[5m])))

# 3. DNS 쿼리율 (rcode별)
sum by (rcode) (rate(hubble_dns_queries_total[5m]))

# 4. DNS 에러 비율 (%)
(
  sum(rate(hubble_dns_queries_total{rcode!="No Error"}[5m]))
  /
  sum(rate(hubble_dns_queries_total[5m]))
) * 100

# 5. HTTP 요청율 (method별)
sum by (method) (rate(hubble_http_requests_total[5m]))

# 6. HTTP 5xx 에러율 (%)
(
  sum(rate(hubble_http_responses_total{status=~"5.."}[5m]))
  /
  sum(rate(hubble_http_responses_total[5m]))
) * 100

# 7. HTTP 레이턴시 P50
histogram_quantile(0.50, sum by (le) (rate(hubble_http_request_duration_seconds_bucket[5m])))

# 8. HTTP 레이턴시 P95
histogram_quantile(0.95, sum by (le) (rate(hubble_http_request_duration_seconds_bucket[5m])))

# 9. HTTP 레이턴시 P99
histogram_quantile(0.99, sum by (le) (rate(hubble_http_request_duration_seconds_bucket[5m])))

# 10. TCP RST 비율
rate(hubble_tcp_flags_total{flag="RST"}[5m])

# 11. TCP SYN 대비 RST 비율 (연결 실패율 추정)
(
  rate(hubble_tcp_flags_total{flag="RST"}[5m])
  /
  rate(hubble_tcp_flags_total{flag="SYN"}[5m])
) * 100

# 12. ICMP 메시지율 (type별)
sum by (type) (rate(hubble_icmp_total[5m]))

# 13. 포트별 트래픽 분포 (top 10)
topk(10, sum by (port) (rate(hubble_port_distribution_total[5m])))
```

### 커스텀 메트릭 정의

httpV2 핸들러를 사용하면 다양한 label context를 추가하여 더 세밀한 메트릭을 생성할 수 있다.

**labelsContext 옵션**:

| Label Context | 설명 | 사용 예 |
|--------------|------|--------|
| `source_ip` | 출발지 IP | IP 기반 트래픽 분석 |
| `source_namespace` | 출발지 namespace | namespace별 HTTP 트래픽 |
| `source_workload` | 출발지 workload 이름 | Deployment별 요청 수 |
| `source_workload_kind` | 출발지 workload 종류 | Deployment/DaemonSet 구분 |
| `source_pod` | 출발지 Pod 이름 | Pod 단위 분석 (카디널리티 주의) |
| `destination_ip` | 도착지 IP | - |
| `destination_namespace` | 도착지 namespace | - |
| `destination_workload` | 도착지 workload 이름 | - |
| `destination_workload_kind` | 도착지 workload 종류 | - |
| `destination_pod` | 도착지 Pod 이름 | - |

**카디널리티 주의사항**: `source_pod`이나 `destination_pod`을 label context로 추가하면, Pod 수에 비례하여 시계열 수가 폭증한다. 예를 들어, 100개의 source Pod와 50개의 destination Pod가 있으면 최대 5,000개의 시계열이 생성될 수 있다. `source_workload` / `destination_workload` 수준에서 관리하는 것이 안전하다.

**고급 설정 예시**:
```yaml
hubble:
  metrics:
    enabled:
      - dns:query;ignoreAAAA
      - drop:sourceContext=pod;destinationContext=pod
      - tcp
      - flow:sourceContext=workload;destinationContext=workload
      - icmp
      - httpV2:exemplars=true;labelsContext=source_namespace,source_workload,destination_namespace,destination_workload
    enableOpenMetrics: true  # OpenMetrics 형식 활성화
```

---

## hubble observe CLI 심화

### 모든 필터 옵션 레퍼런스

`hubble observe` 명령은 다양한 필터 옵션을 제공한다. 전체 옵션을 카테고리별로 정리한다.

**Namespace / Pod / Label / Service 필터**:

| 옵션 | 설명 | 예시 |
|------|------|------|
| `--namespace` | namespace 필터 (양방향) | `--namespace demo` |
| `--from-namespace` | 출발지 namespace | `--from-namespace frontend` |
| `--to-namespace` | 도착지 namespace | `--to-namespace backend` |
| `--pod` | Pod 이름 필터 (양방향) | `--pod demo/nginx-web` |
| `--from-pod` | 출발지 Pod | `--from-pod demo/frontend-abc123` |
| `--to-pod` | 도착지 Pod | `--to-pod demo/backend-def456` |
| `--label` | label 필터 (양방향) | `--label "app=nginx"` |
| `--from-label` | 출발지 label | `--from-label "app=frontend"` |
| `--to-label` | 도착지 label | `--to-label "app=backend,version=v2"` |
| `--service` | Service 이름 필터 (양방향) | `--service demo/nginx-svc` |
| `--from-service` | 출발지 Service | `--from-service demo/frontend-svc` |
| `--to-service` | 도착지 Service | `--to-service demo/backend-svc` |
| `--workload` | Workload 이름 필터 (양방향) | `--workload demo/nginx` |
| `--from-workload` | 출발지 Workload | `--from-workload demo/frontend` |
| `--to-workload` | 도착지 Workload | `--to-workload demo/backend` |

**IP / CIDR 필터**:

| 옵션 | 설명 | 예시 |
|------|------|------|
| `--ip` | IP 주소 필터 (양방향) | `--ip 10.0.1.5` |
| `--from-ip` | 출발지 IP | `--from-ip 10.0.0.0/16` |
| `--to-ip` | 도착지 IP | `--to-ip 172.16.0.100` |
| `--ip-version` | IP 버전 필터 | `--ip-version 4` 또는 `--ip-version 6` |

**프로토콜 / 포트 필터**:

| 옵션 | 설명 | 예시 |
|------|------|------|
| `--protocol` | L4/L7 프로토콜 | `--protocol tcp`, `--protocol http`, `--protocol dns` |
| `--port` | 포트 번호 (양방향) | `--port 443` |
| `--from-port` | 출발지 포트 | `--from-port 5432` |
| `--to-port` | 도착지 포트 | `--to-port 80` |

**이벤트 타입 / Verdict 필터**:

| 옵션 | 설명 | 예시 |
|------|------|------|
| `--type` | 이벤트 타입 | `--type l7`, `--type drop`, `--type trace`, `--type policy-verdict` |
| `--verdict` | verdict 필터 | `--verdict FORWARDED`, `--verdict DROPPED`, `--verdict AUDIT` |
| `--traffic-direction` | 트래픽 방향 | `--traffic-direction ingress`, `--traffic-direction egress` |

**L7 세부 필터**:

| 옵션 | 설명 | 예시 |
|------|------|------|
| `--http-method` | HTTP 메서드 | `--http-method GET`, `--http-method POST` |
| `--http-path` | HTTP URL 경로 (정규식) | `--http-path "/api/v1/.*"` |
| `--http-status` | HTTP 상태 코드 | `--http-status 200`, `--http-status "5+"` (5xx 전체) |
| `--http-url` | HTTP URL (전체) | `--http-url "/health"` |
| `--dns-query` | DNS 쿼리 도메인 | `--dns-query "kubernetes.default"` |

**Identity / Node 필터**:

| 옵션 | 설명 | 예시 |
|------|------|------|
| `--identity` | Cilium identity 번호 | `--identity 12345` |
| `--from-identity` | 출발지 identity | `--from-identity 1` (host) |
| `--to-identity` | 도착지 identity | `--to-identity 2` (world) |
| `--node-name` | 노드 이름 필터 | `--node-name worker-1` |
| `--from-all` | 모든 출발지 허용 | `--from-all` |
| `--to-all` | 모든 도착지 허용 | `--to-all` |

**시간 / 수량 제어**:

| 옵션 | 설명 | 예시 |
|------|------|------|
| `--last` | 최근 N개 Flow만 조회 | `--last 100` |
| `--first` | 가장 오래된 N개 Flow 조회 | `--first 50` |
| `--follow` (`-f`) | 실시간 스트리밍 모드 | `--follow` |
| `--since` | 특정 시간 이후 | `--since "2025-01-01T00:00:00Z"`, `--since 5m` |
| `--until` | 특정 시간 이전 | `--until "2025-01-01T01:00:00Z"`, `--until 1m` |

### 출력 형식: compact, dict, json, jsonpb, table

| 형식 | 옵션 | 설명 | 용도 |
|------|------|------|------|
| compact | `-o compact` | 한 줄 요약 형식 | 실시간 모니터링, 빠른 확인 |
| dict | `-o dict` | key-value 상세 형식 | 개별 Flow 상세 분석 |
| json | `-o json` | JSON 형식 | jq 파이프라인, 스크립트 연동 |
| jsonpb | `-o jsonpb` | Protocol Buffers JSON | API 호환 처리 |
| table | `-o table` | 테이블 형식 (기본) | 터미널 가독성 |

**각 형식의 출력 예시**:

compact 형식:
```
Jan  1 12:00:00.000: demo/frontend:54321 (ID:12345) -> demo/backend:80 (ID:67890) to-endpoint FORWARDED (TCP Flags: SYN)
```

dict 형식:
```
  time: "Jan  1 12:00:00.000"
  source: demo/frontend (ID: 12345, labels: [k8s:app=frontend])
  destination: demo/backend (ID: 67890, labels: [k8s:app=backend])
  ...
```

json 형식:
```json
{"flow":{"time":"2025-01-01T12:00:00.000Z","verdict":"FORWARDED","source":{"namespace":"demo","pod_name":"frontend","identity":12345},"destination":{"namespace":"demo","pod_name":"backend","identity":67890},"l4":{"TCP":{"source_port":54321,"destination_port":80}}}}
```

### Follow 모드와 시간 범위 지정

**Follow 모드** (`--follow` 또는 `-f`):

```bash
# 실시간 스트리밍 — 새 Flow가 발생할 때마다 즉시 출력
hubble observe --follow

# follow + 필터 조합 — 특정 조건의 Flow만 실시간 감시
hubble observe --follow --namespace demo --verdict DROPPED

# follow + 출력 형식 — 실시간 JSON 스트림
hubble observe --follow --output json
```

Follow 모드에서는 ring buffer의 현재 위치부터 시작하여 새로운 Flow만 출력한다. `Ctrl+C`로 종료한다.

**시간 범위 지정**:

```bash
# 상대 시간 — 최근 5분간의 Flow
hubble observe --since 5m

# 상대 시간 — 최근 1시간간의 Flow
hubble observe --since 1h

# 절대 시간 — 특정 시간 범위
hubble observe --since "2025-01-01T09:00:00Z" --until "2025-01-01T10:00:00Z"

# since + follow — 과거부터 시작하여 실시간 스트리밍
hubble observe --since 10m --follow

# since + last 조합 — 최근 5분 중 마지막 50개
hubble observe --since 5m --last 50
```

주의: ring buffer는 고정 크기이므로, `--since`로 오래된 시간을 지정하더라도 ring buffer에 남아있는 Flow만 조회할 수 있다. 기본 4096 entries 버퍼에서 초당 100 Flow가 발생하면, 약 40초 이전의 데이터만 보존된다.

### jq를 이용한 JSON 후처리

`hubble observe --output json`의 결과를 jq로 가공하면 강력한 분석이 가능하다.

**기본 필드 추출**:
```bash
# source → destination 매핑 요약
hubble observe -o json --last 100 \
  | jq -r '.flow | "\(.source.namespace)/\(.source.pod_name) → \(.destination.namespace)/\(.destination.pod_name)"'

# verdict별 카운트
hubble observe -o json --last 1000 \
  | jq -r '.flow.verdict' | sort | uniq -c | sort -rn

# drop reason 분포
hubble observe -o json --last 500 --verdict DROPPED \
  | jq -r '.flow.drop_reason_desc' | sort | uniq -c | sort -rn
```

**L7 정보 추출**:
```bash
# HTTP 요청 상세 (method, url, status)
hubble observe -o json --protocol http --last 100 \
  | jq -r 'select(.flow.l7 != null) | .flow | "\(.l7.type): \(.l7.http.method // "-") \(.l7.http.url // "-") → \(.l7.http.code // "-")"'

# DNS 쿼리와 응답 코드
hubble observe -o json --protocol dns --last 100 \
  | jq -r 'select(.flow.l7.dns != null) | .flow | "\(.source.pod_name): \(.l7.dns.query) → \(.l7.dns.rcode)"'

# HTTP 응답 시간 통계 (ms)
hubble observe -o json --protocol http --last 500 \
  | jq -r 'select(.flow.l7.latency_ns != null) | .flow.l7.latency_ns / 1000000' \
  | sort -n | awk '{a[NR]=$1} END {print "min:", a[1], "median:", a[int(NR/2)], "max:", a[NR], "count:", NR}'
```

**고급 분석**:
```bash
# namespace 간 통신 매트릭스
hubble observe -o json --last 5000 \
  | jq -r 'select(.flow.source.namespace != null and .flow.destination.namespace != null) |
    "\(.flow.source.namespace) → \(.flow.destination.namespace)"' \
  | sort | uniq -c | sort -rn | head -20

# 시간대별 Flow 수 (분 단위)
hubble observe -o json --last 5000 \
  | jq -r '.flow.time[:16]' | sort | uniq -c

# 특정 Pod의 통신 대상 목록
hubble observe -o json --from-pod demo/frontend --last 500 \
  | jq -r '.flow | "\(.destination.namespace)/\(.destination.pod_name):\(.l4.TCP.destination_port // .l4.UDP.destination_port)"' \
  | sort -u

# JSON 결과를 CSV로 변환
hubble observe -o json --last 100 \
  | jq -r '.flow | [.time, .source.namespace, .source.pod_name, .destination.namespace, .destination.pod_name, .verdict, (.l4.TCP.destination_port // .l4.UDP.destination_port // "")] | @csv'
```

---

## 네트워크 트러블슈팅 시나리오

### 시나리오 1: Pod 간 통신 실패 디버깅 (DROPPED verdict 추적)

**증상**: frontend Pod에서 backend Pod로 HTTP 요청을 보내면 connection timeout이 발생한다.

**디버깅 절차**:

```bash
# Step 1: 차단된 트래픽 확인
hubble observe --from-label "app=frontend" --to-label "app=backend" --verdict DROPPED --last 20

# Step 2: drop reason 확인
hubble observe --from-label "app=frontend" --to-label "app=backend" --verdict DROPPED -o json --last 10 \
  | jq '.flow | {
    src: "\(.source.namespace)/\(.source.pod_name)",
    dst: "\(.destination.namespace)/\(.destination.pod_name)",
    port: .l4.TCP.destination_port,
    drop_reason: .drop_reason_desc,
    direction: .traffic_direction
  }'

# Step 3: 관련 CiliumNetworkPolicy 확인
kubectl get cnp -n demo -o yaml

# Step 4: identity 확인 (정책 매칭 문제 진단)
kubectl -n kube-system exec -it ds/cilium -- cilium identity list | grep frontend
kubectl -n kube-system exec -it ds/cilium -- cilium identity list | grep backend

# Step 5: endpoint 상태 확인
kubectl -n kube-system exec -it ds/cilium -- cilium endpoint list | grep -E "frontend|backend"

# Step 6: 정책 수정 후 트래픽 허용 확인
hubble observe --from-label "app=frontend" --to-label "app=backend" --follow
```

**일반적 원인**: `POLICY_DENIED` drop reason이 나타나면, CiliumNetworkPolicy에 해당 트래픽을 허용하는 규칙이 없는 것이다. 특히 default-deny 정책이 적용된 namespace에서 흔히 발생한다.

### 시나리오 2: DNS 해석 실패 디버깅 (DNS query/response 관찰)

**증상**: Pod 내부에서 `nslookup`이나 `curl` 실행 시 DNS 해석이 실패한다.

**디버깅 절차**:

```bash
# Step 1: 해당 Pod의 DNS 쿼리 관찰
hubble observe --from-pod demo/frontend --protocol dns --follow

# Step 2: DNS 응답 코드 확인
hubble observe --from-pod demo/frontend --protocol dns -o json --last 50 \
  | jq 'select(.flow.l7.dns != null) | .flow | {
    query: .l7.dns.query,
    rcode: .l7.dns.rcode,
    ips: .l7.dns.ips,
    source: .source.pod_name,
    dst: .destination.pod_name
  }'

# Step 3: kube-dns로의 트래픽이 차단되고 있는지 확인
hubble observe --from-pod demo/frontend --to-label "k8s-app=kube-dns" --verdict DROPPED

# Step 4: DNS 트래픽이 egress 정책에 의해 차단되는지 확인
hubble observe --from-pod demo/frontend --to-port 53 --verdict DROPPED

# Step 5: NXDOMAIN 응답 탐색 (도메인이 존재하지 않는 경우)
hubble observe --protocol dns -o json --last 200 \
  | jq -r 'select(.flow.l7.dns.rcode == "Non-Existent Domain") |
    .flow | "\(.source.pod_name): \(.l7.dns.query)"'

# Step 6: CoreDNS 자체의 외부 DNS 해석 확인
hubble observe --from-label "k8s-app=kube-dns" --protocol dns --follow
```

**일반적 원인**:
- default-deny 정책에서 DNS(53/UDP, 53/TCP) egress를 허용하지 않음
- CoreDNS Pod 자체의 egress가 차단됨 (외부 forwarder 접근 불가)
- search domain 설정 오류로 잘못된 FQDN 쿼리

### 시나리오 3: NetworkPolicy 검증 (허용/차단 트래픽 확인)

**증상**: 새로운 CiliumNetworkPolicy를 적용했는데, 의도한 대로 동작하는지 확인이 필요하다.

**디버깅 절차**:

```bash
# Step 1: 정책 적용 전 baseline 관찰 (audit 모드 권장)
hubble observe --namespace demo --last 100

# Step 2: 정책 적용
kubectl apply -f manifests/network-policies/default-deny.yaml
kubectl apply -f manifests/network-policies/allow-nginx-to-httpbin.yaml

# Step 3: 허용된 트래픽 확인
hubble observe --namespace demo --verdict FORWARDED --follow

# Step 4: 차단된 트래픽 확인
hubble observe --namespace demo --verdict DROPPED --follow

# Step 5: 특정 정책의 효과 검증 — nginx→httpbin GET만 허용되는지
# 허용 확인
hubble observe --from-label "app=nginx-web" --to-label "app=httpbin" \
  --to-port 80 --verdict FORWARDED --follow

# 차단 확인 (POST는 차단되어야 함)
hubble observe --from-label "app=nginx-web" --to-label "app=httpbin" \
  --verdict DROPPED --follow

# Step 6: 정책 verdict 이벤트만 관찰
hubble observe --namespace demo --type policy-verdict --follow

# Step 7: 종합 보고서 생성
hubble observe --namespace demo -o json --last 500 \
  | jq -r '.flow | "\(.verdict): \(.source.labels // [] | join(",")) → \(.destination.labels // [] | join(","))"' \
  | sort | uniq -c | sort -rn
```

### 시나리오 4: 서비스 간 레이턴시 분석 (HTTP 응답 시간)

**증상**: 사용자 응답 시간이 느리다. 어떤 마이크로서비스 구간에서 지연이 발생하는지 파악해야 한다.

**디버깅 절차**:

```bash
# Step 1: L7 가시성 활성화 확인
hubble observe --namespace demo --type l7 --last 10

# Step 2: HTTP 응답 시간 조회
hubble observe --namespace demo --protocol http -o json --last 200 \
  | jq 'select(.flow.l7.type == "RESPONSE" and .flow.l7.latency_ns != null) | .flow | {
    service: "\(.source.namespace)/\(.source.pod_name) → \(.destination.namespace)/\(.destination.pod_name)",
    method: .l7.http.method,
    url: .l7.http.url,
    status: .l7.http.code,
    latency_ms: (.l7.latency_ns / 1000000)
  }'

# Step 3: 느린 요청 식별 (100ms 이상)
hubble observe --namespace demo --protocol http -o json --last 500 \
  | jq 'select(.flow.l7.type == "RESPONSE" and (.flow.l7.latency_ns // 0) > 100000000) | .flow | {
    from: .source.pod_name,
    to: .destination.pod_name,
    url: .l7.http.url,
    latency_ms: (.l7.latency_ns / 1000000)
  }'

# Step 4: 서비스별 평균 레이턴시 비교
hubble observe --namespace demo --protocol http -o json --last 1000 \
  | jq -r 'select(.flow.l7.type == "RESPONSE" and .flow.l7.latency_ns != null) |
    "\(.flow.destination.pod_name | split("-")[0:2] | join("-"))\t\(.flow.l7.latency_ns / 1000000)"' \
  | awk -F'\t' '{sum[$1]+=$2; count[$1]++} END {for (svc in sum) printf "%s\tavg: %.2f ms\tcount: %d\n", svc, sum[svc]/count[svc], count[svc]}' \
  | sort -t$'\t' -k2 -rn

# Step 5: 특정 엔드포인트의 레이턴시 추이 (실시간)
hubble observe --to-label "app=backend" --protocol http -o json --follow \
  | jq 'select(.flow.l7.type == "RESPONSE") | "\(.flow.time): \(.flow.l7.http.url) → \(.flow.l7.http.code) (\(.flow.l7.latency_ns / 1000000)ms)"'
```

### 시나리오 5: 외부 트래픽 차단 원인 분석 (egress policy)

**증상**: Pod에서 외부 API(예: api.github.com)에 접근하려 하지만 연결이 거부된다.

**디버깅 절차**:

```bash
# Step 1: 외부 트래픽 차단 확인
hubble observe --from-pod demo/frontend --to-identity world --verdict DROPPED --follow

# Step 2: 어떤 외부 IP/포트로의 접근이 차단되는지 확인
hubble observe --from-pod demo/frontend --to-identity world --verdict DROPPED -o json --last 20 \
  | jq '.flow | {
    dst_ip: .IP.destination,
    dst_port: (.l4.TCP.destination_port // .l4.UDP.destination_port),
    protocol: (if .l4.TCP then "TCP" elif .l4.UDP then "UDP" else "other" end),
    drop_reason: .drop_reason_desc,
    dst_names: .destination_names
  }'

# Step 3: DNS로 해석된 FQDN 확인 (destination_names 필드)
hubble observe --from-pod demo/frontend -o json --last 50 \
  | jq -r 'select(.flow.destination_names != null and (.flow.destination_names | length) > 0) |
    "\(.flow.IP.destination) → \(.flow.destination_names | join(", "))"' | sort -u

# Step 4: egress 정책에 toFQDNs 규칙 추가
cat <<EOF | kubectl apply -f -
apiVersion: "cilium.io/v2"
kind: CiliumNetworkPolicy
metadata:
  name: allow-github-egress
  namespace: demo
spec:
  endpointSelector:
    matchLabels:
      app: frontend
  egress:
    - toFQDNs:
        - matchPattern: "*.github.com"
      toPorts:
        - ports:
            - port: "443"
              protocol: TCP
EOF

# Step 5: 정책 적용 후 확인
hubble observe --from-pod demo/frontend --to-identity world --follow
```

### 시나리오 6: TCP RST/FIN 비정상 연결 종료 분석

**증상**: 서비스 간 통신에서 간헐적으로 "connection reset by peer" 에러가 발생한다.

**디버깅 절차**:

```bash
# Step 1: TCP RST 패킷 관찰
hubble observe --namespace demo --protocol tcp -o json --follow \
  | jq 'select(.flow.l4.TCP.flags.RST == true) | .flow | {
    time: .time,
    src: "\(.source.namespace)/\(.source.pod_name):\(.l4.TCP.source_port)",
    dst: "\(.destination.namespace)/\(.destination.pod_name):\(.l4.TCP.destination_port)",
    direction: .traffic_direction,
    verdict: .verdict
  }'

# Step 2: TCP flag 분포 확인 (RST 비율이 높은지)
hubble observe --namespace demo -o json --last 2000 \
  | jq -r 'select(.flow.l4.TCP != null) |
    if .flow.l4.TCP.flags.RST then "RST"
    elif .flow.l4.TCP.flags.SYN and .flow.l4.TCP.flags.ACK then "SYN-ACK"
    elif .flow.l4.TCP.flags.SYN then "SYN"
    elif .flow.l4.TCP.flags.FIN then "FIN"
    else "OTHER"
    end' | sort | uniq -c | sort -rn

# Step 3: RST가 빈번한 source-destination 쌍 식별
hubble observe --namespace demo -o json --last 5000 \
  | jq -r 'select(.flow.l4.TCP.flags.RST == true) |
    "\(.flow.source.pod_name) → \(.flow.destination.pod_name):\(.flow.l4.TCP.destination_port)"' \
  | sort | uniq -c | sort -rn | head -10

# Step 4: 비정상 FIN 패턴 (FIN 없이 RST로 종료되는 연결) 분석
hubble observe --from-label "app=backend" --to-label "app=frontend" -o json --follow \
  | jq 'select(.flow.l4.TCP.flags.RST == true or .flow.l4.TCP.flags.FIN == true) |
    "\(.flow.time): \(if .flow.l4.TCP.flags.RST then "RST" else "FIN" end) | \(.flow.source.pod_name) → \(.flow.destination.pod_name)"'

# Step 5: Prometheus에서 RST 비율 모니터링 (PromQL)
# rate(hubble_tcp_flags_total{flag="RST"}[5m]) / rate(hubble_tcp_flags_total{flag="SYN"}[5m])
```

**일반적 원인**:
- 서비스의 readiness probe 실패로 트래픽이 종료 중인 Pod로 전달됨
- 커넥션 풀 설정 불일치 (idle timeout 차이)
- 서버 측 리소스 부족 (accept backlog 초과)

### 시나리오 7: 보안 감사 — 의심스러운 lateral movement 탐지

**증상**: 보안팀에서 클러스터 내 횡이동(lateral movement) 시도가 의심된다는 경보를 수신했다.

**디버깅 절차**:

```bash
# Step 1: 비정상적인 cross-namespace 통신 탐색
hubble observe -o json --last 5000 \
  | jq -r 'select(.flow.source.namespace != null and .flow.destination.namespace != null and
    .flow.source.namespace != .flow.destination.namespace and
    .flow.source.namespace != "kube-system" and .flow.destination.namespace != "kube-system") |
    "\(.flow.source.namespace)/\(.flow.source.pod_name) → \(.flow.destination.namespace)/\(.flow.destination.pod_name):\(.flow.l4.TCP.destination_port // .flow.l4.UDP.destination_port)"' \
  | sort | uniq -c | sort -rn | head -20

# Step 2: API 서버 접근 시도 모니터링
hubble observe --to-identity kube-apiserver --follow \
  | grep -v "kube-system"  # kube-system 이외에서의 접근

# Step 3: 민감 포트 접근 탐지
# etcd(2379,2380), kubelet(10250), kube-scheduler(10251), kube-controller-manager(10252)
hubble observe --to-port 2379 --follow
hubble observe --to-port 10250 --follow

# Step 4: metadata 서비스 접근 시도 (클라우드 SSRF)
hubble observe --to-ip 169.254.169.254 --follow

# Step 5: 단시간 내 다수 목적지 접근 (포트 스캔 의심)
hubble observe -o json --verdict DROPPED --last 5000 \
  | jq -r '.flow | "\(.source.namespace)/\(.source.pod_name)"' \
  | sort | uniq -c | sort -rn | head -10
# → 특정 Pod에서 비정상적으로 많은 DROPPED 이벤트가 발생하면 포트 스캔 의심

# Step 6: 의심 Pod의 모든 통신 기록 수집
SUSPECT_POD="suspicious-namespace/suspicious-pod"
hubble observe --from-pod "$SUSPECT_POD" -o json --last 1000 \
  | jq '{
    time: .flow.time,
    dst: "\(.flow.destination.namespace // "external")/\(.flow.destination.pod_name // .flow.IP.destination)",
    port: (.flow.l4.TCP.destination_port // .flow.l4.UDP.destination_port),
    verdict: .flow.verdict,
    protocol: (if .flow.l7 then .flow.l7.type else "L3_L4" end)
  }' > /tmp/suspect-flows.json

# Step 7: 외부 C2(Command and Control) 서버 통신 탐지
hubble observe --to-identity world --traffic-direction egress -o json --last 5000 \
  | jq -r 'select(.flow.l4.TCP.destination_port != 443 and .flow.l4.TCP.destination_port != 80) |
    "\(.flow.source.namespace)/\(.flow.source.pod_name) → \(.flow.IP.destination):\(.flow.l4.TCP.destination_port)"' \
  | sort -u
```

### 시나리오 8: Kafka/gRPC L7 트래픽 분석

**증상**: Kafka consumer의 lag가 증가하거나 gRPC 서비스의 에러율이 상승한다.

**Kafka 트래픽 분석**:

```bash
# Step 1: Kafka L7 이벤트 관찰
hubble observe --protocol kafka --follow

# Step 2: Kafka API별 트래픽 분석
hubble observe --protocol kafka -o json --last 500 \
  | jq 'select(.flow.l7.kafka != null) | .flow | {
    from: .source.pod_name,
    to: .destination.pod_name,
    api: .l7.kafka.api_key,
    topic: .l7.kafka.topic,
    error: .l7.kafka.error_code
  }'

# Step 3: Kafka 에러 발생 확인
hubble observe --protocol kafka -o json --last 1000 \
  | jq 'select(.flow.l7.kafka.error_code != null and .flow.l7.kafka.error_code != 0) | .flow | {
    from: .source.pod_name,
    topic: .l7.kafka.topic,
    error_code: .l7.kafka.error_code,
    api: .l7.kafka.api_key
  }'

# Step 4: topic별 트래픽 분포
hubble observe --protocol kafka -o json --last 2000 \
  | jq -r 'select(.flow.l7.kafka.topic != null) | .flow.l7.kafka.topic' \
  | sort | uniq -c | sort -rn
```

**gRPC 트래픽 분석**:

```bash
# Step 1: gRPC 요청/응답 관찰
hubble observe --protocol http --http-path "/.*" -o json --follow \
  | jq 'select(.flow.l7.http.protocol == "HTTP/2" and (.flow.l7.http.url | test("^/"))) | .flow | {
    from: .source.pod_name,
    to: .destination.pod_name,
    method: .l7.http.url,
    type: .l7.type,
    status: .l7.http.code,
    latency_ms: ((.l7.latency_ns // 0) / 1000000)
  }'

# Step 2: gRPC 에러 응답 (grpc-status != 0) 확인
hubble observe --protocol http -o json --last 500 \
  | jq 'select(.flow.l7.http.protocol == "HTTP/2" and .flow.l7.type == "RESPONSE") | .flow | {
    service: .l7.http.url,
    http_status: .l7.http.code,
    grpc_status: (.l7.http.headers["grpc-status"] // "unknown"),
    latency_ms: ((.l7.latency_ns // 0) / 1000000)
  }'

# Step 3: gRPC 서비스별 에러율
hubble observe --protocol http -o json --last 2000 \
  | jq -r 'select(.flow.l7.http.protocol == "HTTP/2" and .flow.l7.type == "RESPONSE") |
    .flow.l7.http | "\(.url)\t\(.code)"' \
  | awk -F'\t' '{total[$1]++; if ($2 != "200") error[$1]++} END {
    for (svc in total) printf "%s: %d/%d (%.1f%% error)\n", svc, (error[svc]+0), total[svc], (error[svc]+0)/total[svc]*100
  }'
```

---

## 보안 감사 및 컴플라이언스

### Flow 로그를 이용한 보안 감사

Hubble Flow 로그는 클러스터 내 모든 네트워크 통신의 감사 추적(audit trail)을 제공한다. 보안 감사의 핵심 관점은 다음과 같다.

**감사 대상 이벤트 분류**:

| 감사 카테고리 | 관찰 대상 | Hubble 필터 |
|-------------|----------|-------------|
| 비인가 접근 시도 | DROPPED verdict 트래픽 | `--verdict DROPPED` |
| 외부 통신 | world identity 대상 트래픽 | `--to-identity world` |
| 권한 상승 시도 | API 서버 접근 | `--to-port 6443` |
| 데이터 유출 의심 | 대량 egress 트래픽 | `--traffic-direction egress --to-identity world` |
| 정책 우회 시도 | AUDIT verdict (감사 모드) | `--verdict AUDIT` |
| 내부 횡이동 | cross-namespace 통신 | source.namespace != destination.namespace |

**정기 감사 스크립트 예시**:

```bash
#!/bin/bash
# hubble-audit.sh - 일일 네트워크 보안 감사 보고서 생성

REPORT_FILE="/tmp/hubble-audit-$(date +%Y%m%d).txt"
echo "=== Hubble 네트워크 보안 감사 보고서 ===" > "$REPORT_FILE"
echo "생성 시각: $(date)" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"

echo "--- 1. 차단된 트래픽 Top 20 ---" >> "$REPORT_FILE"
hubble observe --verdict DROPPED -o json --last 10000 \
  | jq -r '.flow | "\(.source.namespace)/\(.source.pod_name) → \(.destination.namespace // "external")/\(.destination.pod_name // .IP.destination):\(.l4.TCP.destination_port // .l4.UDP.destination_port) | \(.drop_reason_desc)"' \
  | sort | uniq -c | sort -rn | head -20 >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"

echo "--- 2. 외부 통신 대상 (world identity) ---" >> "$REPORT_FILE"
hubble observe --to-identity world -o json --last 10000 \
  | jq -r '.flow | "\(.source.namespace)/\(.source.pod_name) → \(.IP.destination):\(.l4.TCP.destination_port // .l4.UDP.destination_port) [\(.verdict)]"' \
  | sort | uniq -c | sort -rn | head -20 >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"

echo "--- 3. API 서버 접근 시도 ---" >> "$REPORT_FILE"
hubble observe --to-port 6443 -o json --last 5000 \
  | jq -r '.flow | "\(.source.namespace)/\(.source.pod_name) [\(.verdict)]"' \
  | sort | uniq -c | sort -rn >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"

echo "--- 4. Drop Reason 분포 ---" >> "$REPORT_FILE"
hubble observe --verdict DROPPED -o json --last 10000 \
  | jq -r '.flow.drop_reason_desc' | sort | uniq -c | sort -rn >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"

echo "--- 5. Cross-Namespace 통신 ---" >> "$REPORT_FILE"
hubble observe -o json --last 10000 \
  | jq -r 'select(.flow.source.namespace != null and .flow.destination.namespace != null and
    .flow.source.namespace != .flow.destination.namespace) |
    "\(.flow.source.namespace) → \(.flow.destination.namespace)"' \
  | sort | uniq -c | sort -rn >> "$REPORT_FILE"

echo "보고서 생성 완료: $REPORT_FILE"
cat "$REPORT_FILE"
```

### 네트워크 세그먼테이션 검증

네트워크 세그먼테이션(segmentation)은 마이크로서비스 환경에서 blast radius를 줄이기 위한 핵심 보안 전략이다. Hubble을 사용하면 세그먼테이션이 의도대로 적용되었는지 검증할 수 있다.

**검증 방법론**:

1. **Positive Test**: 허용된 통신이 실제로 동작하는지 확인한다
2. **Negative Test**: 차단되어야 할 통신이 실제로 차단되는지 확인한다
3. **Gap Analysis**: 정책에 명시되지 않은 암묵적 허용 트래픽이 있는지 확인한다

```bash
# Positive Test: 허용된 통신 확인
# 이 프로젝트의 allow-nginx-to-httpbin 정책 검증
hubble observe --from-label "app=nginx-web" --to-label "app=httpbin" \
  --to-port 80 --verdict FORWARDED --last 10

# Negative Test: 차단 확인 (httpbin → nginx는 차단되어야 함)
hubble observe --from-label "app=httpbin" --to-label "app=nginx-web" \
  --verdict DROPPED --last 10

# Gap Analysis: 정책에 명시되지 않은 통신 탐색
hubble observe --namespace demo --verdict FORWARDED -o json --last 5000 \
  | jq -r '.flow | "\(.source.labels // [] | map(select(startswith("k8s:app="))) | join(",")) → \(.destination.labels // [] | map(select(startswith("k8s:app="))) | join(","))"' \
  | sort -u
```

### 데이터 유출 탐지 패턴

데이터 유출(data exfiltration)은 클러스터 내 민감 데이터가 외부로 전송되는 것을 의미한다. Hubble로 다음 패턴을 탐지할 수 있다.

**탐지 패턴**:

| 패턴 | 설명 | 탐지 방법 |
|------|------|----------|
| 대량 외부 전송 | 외부 IP로 비정상적으로 많은 트래픽 전송 | egress world traffic 볼륨 모니터링 |
| 비표준 포트 외부 통신 | 80/443 이외 포트로 외부 통신 | `--to-identity world --to-port`에서 비표준 포트 필터 |
| DNS 터널링 | DNS 쿼리를 이용한 데이터 전송 | 비정상적으로 긴 DNS 쿼리 도메인 |
| 비인가 외부 서비스 접근 | 허용 목록에 없는 외부 서비스 접근 | toFQDNs 정책 위반 |

```bash
# 비표준 포트 외부 통신 탐지
hubble observe --to-identity world --traffic-direction egress -o json --last 5000 \
  | jq -r 'select((.flow.l4.TCP.destination_port // 0) != 443 and
    (.flow.l4.TCP.destination_port // 0) != 80 and
    (.flow.l4.UDP.destination_port // 0) != 53) |
    .flow | "\(.source.namespace)/\(.source.pod_name) → \(.IP.destination):\(.l4.TCP.destination_port // .l4.UDP.destination_port)"' \
  | sort | uniq -c | sort -rn

# DNS 터널링 의심 탐지 (긴 도메인 쿼리)
hubble observe --protocol dns -o json --last 5000 \
  | jq -r 'select(.flow.l7.dns.query != null and (.flow.l7.dns.query | length) > 50) |
    "\(.flow.source.pod_name): \(.flow.l7.dns.query) (length: \(.flow.l7.dns.query | length))"'
```

### Hubble Timescape (장기 저장)

Hubble의 기본 ring buffer는 제한된 용량만 보유하므로 장기적인 보안 감사에는 적합하지 않다. Hubble Timescape(또는 외부 저장소 연동)를 사용하면 Flow 데이터를 장기 보관할 수 있다.

**장기 저장 옵션**:

| 방법 | 설명 | 적합한 상황 |
|------|------|-----------|
| Hubble Timescape | Isovalent Enterprise 기능으로, TimescaleDB에 Flow 저장 | 엔터프라이즈 환경 |
| Fluentd/Fluent Bit 연동 | hubble observe JSON 출력을 로그 수집기로 전달 | 기존 로그 파이프라인 활용 |
| Prometheus + Thanos | 메트릭 수준의 장기 저장 | 집계된 통계 장기 보존 |
| Custom exporter | gRPC API로 Flow를 수신하여 S3/Elasticsearch 등에 저장 | 커스텀 요구사항 |

**Fluentd 연동 예시**:

```bash
# hubble observe의 JSON 출력을 파일로 저장하는 DaemonSet
# 이후 Fluentd가 파일을 수집하여 Elasticsearch/S3에 전달

# 간단한 파이프라인 (PoC용):
hubble observe --follow --output json > /var/log/hubble/flows.json &

# Fluent Bit 설정 예:
# [INPUT]
#     Name tail
#     Path /var/log/hubble/flows.json
#     Parser json
#     Tag hubble.flows
#
# [OUTPUT]
#     Name es
#     Match hubble.flows
#     Host elasticsearch.logging.svc
#     Port 9200
#     Index hubble-flows
```

---

## 성능 튜닝

### Ring buffer 크기 최적화

Ring buffer 크기는 Hubble의 데이터 보존 능력과 메모리 사용량의 트레이드오프이다.

**최적 크기 산출 공식**:

```
필요 buffer 크기 = 초당 Flow 수 x 보존하고자 하는 시간(초)

예시:
- 초당 500 flows, 5분(300초) 보존 → 150,000 entries
- 초당 100 flows, 10분(600초) 보존 → 60,000 entries
- 초당 50 flows, 30분(1800초) 보존 → 90,000 entries
```

**현재 Flow rate 측정 방법**:
```bash
# hubble status로 현재 상태 확인
hubble status

# 출력 예시:
# Healthcheck (via localhost:4245): Ok
# Current/Max Flows: 4096/4096 (100.00%)
# Flows/s: 142.37

# Prometheus 메트릭으로 정확한 rate 확인
# rate(hubble_flows_processed_total[5m])
```

**Helm chart에서 buffer 크기 조정**:
```yaml
# cilium-values.yaml 또는 hubble-values.yaml
hubble:
  eventBufferCapacity: 65536   # 기본 4096에서 증가
  # 또는 cilium-agent의 args로 직접 지정:
  # --hubble-event-buffer-capacity=65536
```

**주의**: buffer 크기를 늘리면 각 노드의 cilium-agent 메모리 사용량이 증가한다. 노드 수가 많은 클러스터에서는 전체 메모리 영향을 고려해야 한다.

### 메트릭 수집 부하 관리

Hubble 메트릭 핸들러의 수와 label 카디널리티에 따라 CPU/메모리 부하가 달라진다.

**핸들러별 부하 수준**:

| 핸들러 | CPU 부하 | 시계열 수 | 권장 여부 |
|--------|---------|----------|----------|
| flow | 낮음 | ~10 | 항상 권장 |
| drop | 낮음 | ~20 (reason별) | 항상 권장 |
| tcp | 낮음 | ~10 (flag별) | 항상 권장 |
| dns | 중간 | ~50 (rcode별) | 권장 |
| http | 중간-높음 | ~100+ (method x status) | 필요 시 |
| httpV2 + labelsContext | 높음 | ~1000+ (workload 쌍) | 주의 필요 |
| port-distribution | 높음 | ~1000+ (포트별) | 주의 필요 |
| icmp | 낮음 | ~10 | 선택적 |

**부하 최적화 전략**:
1. 필수 핸들러(flow, drop, tcp)만 활성화하고, 필요에 따라 추가한다
2. httpV2의 labelsContext는 workload 수준까지만 사용한다 (pod 수준은 피한다)
3. port-distribution은 디버깅 시에만 일시적으로 활성화한다
4. Prometheus scrape interval을 15초에서 30초로 늘려 부하를 줄일 수 있다

### L7 visibility 활성화 시 성능 영향

L7 가시성을 활성화하면 해당 트래픽이 Envoy proxy를 통과하게 되어 추가적인 지연과 리소스 소비가 발생한다.

**성능 영향**:

| 항목 | L7 비활성화 | L7 활성화 | 영향 |
|------|-----------|----------|------|
| 추가 레이턴시 | 0 | 0.1-1ms | Envoy proxy 경유에 의한 지연 |
| CPU (per 1000 req/s) | 0 | ~50-100m CPU | proxy 프로세스의 CPU 사용 |
| 메모리 | 0 | ~30-50 MB | Envoy 프로세스 메모리 |
| 연결 수 | 직접 연결 | 2x 연결 | proxy 양쪽으로 연결 설정 |

**최적화 권장사항**:
1. 전체 트래픽에 L7 가시성을 활성화하지 말고, 필요한 서비스에만 선택적으로 적용한다
2. Pod annotation 방식(`policy.cilium.io/proxy-visibility`)으로 개별 Pod에 적용하면 범위를 제한할 수 있다
3. 프로덕션 환경에서는 모니터링할 프로토콜을 한정한다 (예: HTTP만 활성화, DNS는 toFQDNs로 자동)
4. proxy의 리소스 제한을 설정하여 과도한 리소스 사용을 방지한다

### hubble-relay 리소스 설정

hubble-relay의 리소스 요구사항은 클러스터 규모와 Flow throughput에 따라 결정된다.

**규모별 권장 리소스**:

| 클러스터 규모 | CPU requests | CPU limits | Memory requests | Memory limits | Replicas |
|-------------|-------------|-----------|----------------|--------------|----------|
| ~10 노드 | 50m | 500m | 64Mi | 256Mi | 1 |
| ~50 노드 | 100m | 1000m | 128Mi | 512Mi | 2 |
| ~100 노드 | 200m | 2000m | 256Mi | 1Gi | 2-3 |
| ~500 노드 | 500m | 4000m | 512Mi | 2Gi | 3 |

**Helm chart 설정**:

```yaml
hubble:
  relay:
    replicas: 2
    resources:
      requests:
        cpu: 100m
        memory: 128Mi
      limits:
        cpu: 1000m
        memory: 512Mi
    # gRPC 연결 관련 튜닝
    dialTimeout: 5s           # 연결 타임아웃
    retryTimeout: 10s         # 재시도 타임아웃
    sortBufferLenMax: 100     # 정렬 버퍼 최대 길이
    sortBufferDrainTimeout: 1s # 정렬 버퍼 drain 타임아웃
```

---

## 실습

### 실습 1: Hubble CLI 설치 및 기본 사용

```bash
# Hubble CLI 설치 (macOS)
brew install hubble

# 또는 직접 다운로드
HUBBLE_VERSION=$(curl -s https://raw.githubusercontent.com/cilium/hubble/master/stable.txt)
curl -L --remote-name-all \
  https://github.com/cilium/hubble/releases/download/$HUBBLE_VERSION/hubble-darwin-amd64.tar.gz
tar xzvf hubble-darwin-amd64.tar.gz
sudo mv hubble /usr/local/bin/

# hubble-relay에 포트포워딩 (클러스터 외부에서 접근 시 필요)
kubectl port-forward -n kube-system svc/hubble-relay 4245:80 &

# Hubble 상태 확인
hubble status

# 실시간 트래픽 플로우 관찰
hubble observe

# 실시간 스트리밍 모드 (새로운 Flow가 발생할 때마다 출력)
hubble observe --follow

# 특정 네임스페이스 트래픽만 관찰
hubble observe --namespace demo

# 최근 N개 Flow만 조회
hubble observe --last 20

# 차단된 트래픽만 필터링
hubble observe --verdict DROPPED

# HTTP 트래픽만 관찰
hubble observe --protocol http
```

### 실습 2: 다양한 필터 조합

```bash
# === Pod 기반 필터 ===
# 특정 Pod로 들어오는 트래픽
hubble observe --to-pod demo/nginx-web

# 특정 Pod에서 나가는 트래픽
hubble observe --from-pod demo/frontend

# === IP 기반 필터 ===
# 특정 IP에서 오는 트래픽
hubble observe --ip 10.0.1.5

# 특정 IP 대역 필터링 (CIDR)
hubble observe --from-ip 10.0.0.0/16

# 도착지 IP 필터링
hubble observe --to-ip 172.16.0.100

# === 포트 기반 필터 ===
# 특정 포트로 향하는 트래픽
hubble observe --port 443

# 도착지 포트 필터링
hubble observe --to-port 80

# 출발지 포트 필터링
hubble observe --from-port 5432

# === Label 기반 필터 ===
# 특정 label을 가진 Pod의 트래픽
hubble observe --from-label "app=frontend"
hubble observe --to-label "app=backend,version=v2"

# === 프로토콜 및 L7 필터 ===
# DNS 쿼리 관찰
hubble observe --protocol dns

# HTTP 상태 코드 필터링
hubble observe --http-status 500
hubble observe --http-status "5+"    # 5xx 전체
hubble observe --http-status "4+"    # 4xx 전체

# HTTP 메서드 필터링
hubble observe --http-method GET
hubble observe --http-method POST

# HTTP 경로 필터링
hubble observe --http-path "/api/v1/users"

# DNS 쿼리 도메인 필터링
hubble observe --dns-query "kubernetes.default"

# === 이벤트 타입 필터 ===
# 특정 이벤트 타입만 필터링
hubble observe --type l7           # L7 이벤트만
hubble observe --type drop         # 드롭 이벤트만
hubble observe --type trace        # 트레이스 이벤트만
hubble observe --type policy-verdict  # 정책 판정 이벤트만

# === 복합 필터 ===
# 특정 namespace에서 차단된 DNS 트래픽
hubble observe --namespace demo --verdict DROPPED --protocol dns

# frontend에서 backend로의 HTTP 5xx 응답
hubble observe --from-label "app=frontend" --to-label "app=backend" --http-status "5+"

# === 출력 형식 ===
# JSON 형식 출력 (파이프라인 분석용)
hubble observe --output json | head -5

# compact 형식 (간결한 한 줄 출력)
hubble observe --output compact

# dict 형식 (key-value 상세 출력)
hubble observe --output dict

# jsonpb 형식 (Protocol Buffers JSON)
hubble observe --output jsonpb
```

### 실습 3: Hubble UI 접속

```bash
# Hubble UI 포트포워딩
kubectl port-forward -n kube-system svc/hubble-ui 12000:80

# 브라우저에서 http://localhost:12000 접속
# 1. 좌측 상단에서 namespace를 선택한다
# 2. Service Map에서 서비스 간 통신 관계를 확인한다
# 3. 특정 서비스 노드를 클릭하면 해당 서비스의 상세 Flow를 볼 수 있다
# 4. 빨간색 엣지가 있다면 차단된 트래픽이 존재하는 것이다
```

### 실습 4: 네트워크 정책 효과 검증

```bash
# 1. 정책 적용 전 트래픽 관찰
hubble observe --namespace demo --verdict FORWARDED

# 2. 네트워크 정책 적용 (deny-all)
kubectl apply -f deny-all-policy.yaml

# 3. 정책 적용 후 차단된 트래픽 확인
hubble observe --namespace demo --verdict DROPPED

# 4. 어떤 트래픽이 차단되었는지 상세 분석
hubble observe --namespace demo --verdict DROPPED --output json \
  | jq '.flow | {
    src: .source.labels,
    dst: .destination.labels,
    port: .l4,
    drop_reason: .drop_reason_desc
  }'

# 5. 특정 drop reason별로 분류
hubble observe --namespace demo --verdict DROPPED --output json \
  | jq -r '.flow.drop_reason_desc' | sort | uniq -c | sort -rn
```

### 실습 5: DNS 해석 문제 트러블슈팅

DNS 해석 실패는 Kubernetes 환경에서 흔한 문제이다. Hubble을 사용하면 DNS 쿼리/응답을 실시간으로 추적할 수 있다.

```bash
# 1. 특정 Pod의 DNS 쿼리를 실시간으로 관찰
hubble observe --from-pod demo/frontend --protocol dns --follow

# 2. DNS 응답 코드별 분류 (NXDOMAIN은 도메인이 존재하지 않음을 의미)
hubble observe --protocol dns --output json --last 100 \
  | jq -r 'select(.flow.l7.dns.rcode != null) | .flow.l7.dns | "\(.query) -> \(.rcode)"' \
  | sort | uniq -c | sort -rn

# 3. NXDOMAIN 응답만 필터링 (존재하지 않는 도메인 쿼리 식별)
hubble observe --protocol dns --output json --follow \
  | jq -r 'select(.flow.l7.dns.rcode == "Non-Existent Domain") | .flow | "\(.source.pod_name) -> \(.l7.dns.query)"'

# 4. 특정 도메인에 대한 DNS 쿼리 추적
hubble observe --dns-query "api.external-service.com" --follow

# 5. DNS 응답 시간이 긴 쿼리 식별
hubble observe --protocol dns --output json --last 500 \
  | jq 'select(.flow.l7.type == "RESPONSE") | {query: .flow.l7.dns.query, latency_ms: (.flow.l7.latency_ns / 1000000)}'

# 6. kube-dns/coredns로 향하는 트래픽 확인
hubble observe --to-label "k8s-app=kube-dns" --namespace kube-system --follow
```

### 실습 6: Lateral Movement(횡이동) 탐지

공격자가 클러스터 내부에서 횡이동하는 패턴을 Hubble로 탐지할 수 있다.

```bash
# 1. 비정상적인 namespace 간 통신 탐지
# 일반적으로 통신하지 않는 namespace 간 트래픽을 확인한다
hubble observe --verdict FORWARDED --output json --last 1000 \
  | jq -r 'select(.flow.source.namespace != .flow.destination.namespace) | "\(.flow.source.namespace)/\(.flow.source.pod_name) -> \(.flow.destination.namespace)/\(.flow.destination.pod_name)"' \
  | sort | uniq -c | sort -rn

# 2. 차단된 cross-namespace 트래픽 (정책이 적용된 경우)
hubble observe --verdict DROPPED --output json --follow \
  | jq -r 'select(.flow.source.namespace != .flow.destination.namespace) | "\(.flow.source.namespace) -> \(.flow.destination.namespace): \(.flow.drop_reason_desc)"'

# 3. Kubernetes API 서버 접근 시도 모니터링
hubble observe --to-port 6443 --follow

# 4. 비정상 포트 스캔 탐지 (짧은 시간 내 다수 포트 접근)
hubble observe --from-pod suspicious-namespace/suspicious-pod --verdict DROPPED --follow

# 5. 클러스터 외부로의 비정상 아웃바운드 트래픽 탐지
hubble observe --type trace --traffic-direction egress --to-identity world --follow

# 6. metadata 서비스 접근 시도 탐지 (클라우드 환경 SSRF 공격)
hubble observe --to-ip 169.254.169.254 --follow
```

### 실습 7: Inter-Namespace 트래픽 모니터링

마이크로서비스 아키텍처에서 namespace 간 트래픽 패턴을 분석할 수 있다.

```bash
# 1. 특정 namespace 간 트래픽 관찰
hubble observe --from-namespace frontend-ns --to-namespace backend-ns --follow

# 2. namespace 간 트래픽 매트릭스 생성
hubble observe --output json --last 5000 \
  | jq -r 'select(.flow.source.namespace != null and .flow.destination.namespace != null) | "\(.flow.source.namespace) -> \(.flow.destination.namespace)"' \
  | sort | uniq -c | sort -rn

# 3. 특정 namespace로 들어오는 모든 인바운드 트래픽 분석
hubble observe --to-namespace production --output json --last 1000 \
  | jq -r '"\(.flow.source.namespace // "external")/\(.flow.source.pod_name // .flow.IP.source) -> \(.flow.destination.pod_name):\(.flow.l4.TCP.destination_port // .flow.l4.UDP.destination_port)"' \
  | sort | uniq -c | sort -rn

# 4. namespace 간 HTTP 에러 응답 모니터링
hubble observe --from-namespace frontend-ns --to-namespace backend-ns --http-status "5+" --follow

# 5. 특정 서비스 간 통신 레이턴시 관찰 (L7 활성화 필요)
hubble observe --from-label "app=gateway" --to-label "app=user-service" --protocol http --output json \
  | jq 'select(.flow.l7.type == "RESPONSE") | {path: .flow.l7.http.url, status: .flow.l7.http.code, latency_ms: (.flow.l7.latency_ns / 1000000)}'
```

### 실습 8: Hubble Metrics → Prometheus → Grafana 대시보드 구성

이 실습에서는 Hubble 메트릭을 Prometheus로 수집하고 Grafana에서 시각화하는 전체 파이프라인을 구성한다.

```bash
# Step 1: Hubble 메트릭이 활성화되어 있는지 확인
# 이 프로젝트에서는 manifests/hubble-values.yaml에 메트릭이 이미 설정되어 있다
kubectl get pods -n kube-system -l k8s-app=cilium -o name | head -1 | \
  xargs -I{} kubectl -n kube-system exec {} -- curl -s http://localhost:9965/metrics | head -30

# Step 2: Prometheus ServiceMonitor 확인 (Prometheus Operator 사용 시)
kubectl get servicemonitor -n kube-system | grep hubble

# Step 3: Prometheus에서 hubble 메트릭이 수집되는지 확인
# Prometheus UI에서 확인하거나 API로 조회:
kubectl port-forward -n monitoring svc/prometheus-operated 9090:9090 &
curl -s 'http://localhost:9090/api/v1/query?query=hubble_flows_processed_total' | jq '.data.result | length'

# Step 4: Grafana에 Hubble 대시보드 Import
# 방법 1: Grafana Labs에서 공식 대시보드 import (Dashboard ID: 16611)
# 방법 2: 아래 JSON 모델을 직접 import (예제 섹션 참조)

# Step 5: 주요 패널 PromQL 테스트
# Flow rate
curl -s 'http://localhost:9090/api/v1/query?query=sum(rate(hubble_flows_processed_total[5m]))' | jq '.data.result'

# Drop rate
curl -s 'http://localhost:9090/api/v1/query?query=sum(rate(hubble_drop_total[5m]))' | jq '.data.result'

# HTTP error rate
curl -s 'http://localhost:9090/api/v1/query?query=sum(rate(hubble_http_responses_total{status=~"5.."}[5m]))' | jq '.data.result'
```

### 실습 9: 특정 HTTP 경로별 트래픽 필터링

L7 가시성이 활성화된 환경에서 특정 API 엔드포인트의 트래픽을 분석한다.

```bash
# Step 1: L7 가시성 활성화 확인
hubble observe --namespace demo --type l7 --last 5

# Step 2: 특정 HTTP 경로 필터링
# /api/v1/* 경로만 관찰
hubble observe --namespace demo --http-path "/api/v1/.*" --follow

# /health 엔드포인트 트래픽
hubble observe --namespace demo --http-path "/health" --last 20

# /api/v1/users 관련 모든 요청
hubble observe --http-path "/api/v1/users" --follow

# Step 3: 경로별 요청 수 통계
hubble observe --namespace demo --protocol http -o json --last 1000 \
  | jq -r 'select(.flow.l7.http.url != null) | .flow.l7.http | "\(.method) \(.url)"' \
  | sort | uniq -c | sort -rn | head -20

# Step 4: 경로별 에러율 분석
hubble observe --namespace demo --protocol http -o json --last 2000 \
  | jq -r 'select(.flow.l7.type == "RESPONSE" and .flow.l7.http.url != null) |
    .flow.l7.http | "\(.url)\t\(.code)"' \
  | awk -F'\t' '{
    total[$1]++;
    if ($2 >= 400) error[$1]++
  } END {
    for (url in total)
      printf "%s: %d requests, %d errors (%.1f%%)\n", url, total[url], error[url]+0, (error[url]+0)/total[url]*100
  }' | sort -t: -k2 -rn

# Step 5: 특정 경로의 레이턴시 분포
hubble observe --namespace demo --http-path "/api/v1/users" -o json --last 500 \
  | jq -r 'select(.flow.l7.type == "RESPONSE" and .flow.l7.latency_ns != null) |
    .flow.l7.latency_ns / 1000000' \
  | sort -n \
  | awk '{
    a[NR]=$1; sum+=$1
  } END {
    printf "Count: %d\nMin: %.2f ms\nMedian: %.2f ms\nP95: %.2f ms\nP99: %.2f ms\nMax: %.2f ms\nAvg: %.2f ms\n",
      NR, a[1], a[int(NR/2)], a[int(NR*0.95)], a[int(NR*0.99)], a[NR], sum/NR
  }'
```

### 실습 10: 시간 범위 지정 조회

```bash
# 상대 시간: 최근 5분간의 Flow
hubble observe --since 5m --last 100

# 상대 시간: 최근 1시간 중 차단된 트래픽
hubble observe --since 1h --verdict DROPPED --last 50

# 상대 시간: 최근 10분간, 계속 follow
hubble observe --since 10m --follow

# 절대 시간 범위 지정
hubble observe --since "2025-06-01T09:00:00Z" --until "2025-06-01T10:00:00Z"

# since와 last 조합: 최근 30분 중 마지막 20개 DROP 이벤트
hubble observe --since 30m --verdict DROPPED --last 20

# 시간 범위 내 verdict 분포 확인
hubble observe --since 1h -o json --last 5000 \
  | jq -r '.flow.verdict' | sort | uniq -c | sort -rn

# 시간대별 Flow 수 분석 (분 단위)
hubble observe --since 1h -o json --last 10000 \
  | jq -r '.flow.time[:16]' | sort | uniq -c | tail -20
```

### 실습 11: JSON 출력 + jq 가공

```bash
# 기본: JSON 출력으로 전체 Flow 확인
hubble observe -o json --last 1 | jq .

# 특정 필드만 추출
hubble observe -o json --last 10 \
  | jq '.flow | {time, verdict, src: .source.pod_name, dst: .destination.pod_name}'

# CSV 변환 (스프레드시트 분석용)
hubble observe -o json --last 100 \
  | jq -r '.flow | [.time, .source.namespace, .source.pod_name,
    .destination.namespace, .destination.pod_name, .verdict,
    (.l4.TCP.destination_port // .l4.UDP.destination_port // "")] | @csv' \
  > /tmp/hubble-flows.csv

# TSV 변환 (탭 구분)
hubble observe -o json --last 100 \
  | jq -r '.flow | [.time, .source.namespace, .source.pod_name,
    .destination.namespace, .destination.pod_name, .verdict] | @tsv'

# verdict별 그룹핑 + 카운트
hubble observe -o json --last 1000 \
  | jq -s 'group_by(.flow.verdict) | map({verdict: .[0].flow.verdict, count: length})'

# 유니크한 source-destination 쌍 추출 (통신 관계 맵)
hubble observe -o json --last 5000 \
  | jq -r '.flow | "\(.source.labels // [] | map(select(startswith("k8s:app="))) | .[0] // "unknown") → \(.destination.labels // [] | map(select(startswith("k8s:app="))) | .[0] // "unknown")"' \
  | sort -u

# Flow를 시간 기반으로 분석 (5초 단위 카운트)
hubble observe -o json --last 5000 \
  | jq -r '.flow.time[:19]' \
  | uniq -c | awk '{print $2, $1}' | tail -20

# 중첩 JSON 필터: DNS 쿼리 중 특정 도메인 패턴 추출
hubble observe -o json --protocol dns --last 500 \
  | jq 'select(.flow.l7.dns.query != null and (.flow.l7.dns.query | test("github|google|aws"))) |
    {pod: .flow.source.pod_name, query: .flow.l7.dns.query, rcode: .flow.l7.dns.rcode}'
```

### 실습 12: 이 프로젝트의 network-policies 검증

이 프로젝트의 `manifests/network-policies/` 디렉토리에 있는 실제 CiliumNetworkPolicy를 Hubble로 검증하는 실습이다.

```bash
# 이 프로젝트에서 사용하는 네트워크 정책 확인
ls manifests/network-policies/
# 출력:
# allow-external-to-keycloak.yaml
# allow-external-to-nginx.yaml
# allow-httpbin-to-keycloak.yaml
# allow-httpbin-to-postgres.yaml
# allow-httpbin-to-rabbitmq.yaml
# allow-istio-sidecars.yaml
# allow-keycloak-to-postgres.yaml
# allow-nginx-egress.yaml
# allow-nginx-to-httpbin.yaml
# allow-nginx-to-redis.yaml
# default-deny.yaml

# === default-deny 정책 검증 ===
# default-deny는 demo namespace에서 DNS(53)만 허용하고 나머지를 차단한다

# Step 1: 정책 적용
kubectl apply -f manifests/network-policies/default-deny.yaml

# Step 2: DNS 트래픽은 허용되는지 확인
hubble observe --namespace demo --to-port 53 --verdict FORWARDED --last 10

# Step 3: DNS 이외 트래픽은 차단되는지 확인
hubble observe --namespace demo --verdict DROPPED --last 20

# === allow-nginx-to-httpbin 정책 검증 ===
# nginx-web → httpbin:80 TCP GET만 허용

# Step 1: 정책 적용
kubectl apply -f manifests/network-policies/allow-nginx-to-httpbin.yaml

# Step 2: nginx → httpbin GET 요청 허용 확인
hubble observe --from-label "app=nginx-web" --to-label "app=httpbin" \
  --to-port 80 --verdict FORWARDED --follow

# Step 3: nginx → httpbin POST는 L7 정책에 의해 차단되는지 확인
# (L7 정책이므로 HTTP method 수준에서 차단)
hubble observe --from-label "app=nginx-web" --to-label "app=httpbin" \
  --http-method POST --verdict DROPPED --follow

# === allow-nginx-to-redis 정책 검증 ===
kubectl apply -f manifests/network-policies/allow-nginx-to-redis.yaml
hubble observe --from-label "app=nginx-web" --to-label "app=redis" --follow

# === allow-httpbin-to-postgres 정책 검증 ===
kubectl apply -f manifests/network-policies/allow-httpbin-to-postgres.yaml
hubble observe --from-label "app=httpbin" --to-label "app=postgres" --to-port 5432 --follow

# === 전체 정책 적용 후 종합 검증 ===
# 모든 정책 적용
kubectl apply -f manifests/network-policies/

# 허용된 통신 관계 매트릭스
hubble observe --namespace demo --verdict FORWARDED -o json --last 2000 \
  | jq -r '.flow | "\(.source.labels // [] | map(select(startswith("k8s:app="))) | .[0] // "unknown") → \(.destination.labels // [] | map(select(startswith("k8s:app="))) | .[0] // "unknown")"' \
  | sort | uniq -c | sort -rn

# 차단된 통신 관계 (정책 미비 항목 발견용)
hubble observe --namespace demo --verdict DROPPED -o json --last 2000 \
  | jq -r '.flow | "\(.source.labels // [] | map(select(startswith("k8s:app="))) | .[0] // "unknown") → \(.destination.labels // [] | map(select(startswith("k8s:app="))) | .[0] // "unknown"):(\(.l4.TCP.destination_port // .l4.UDP.destination_port // "N/A"))"' \
  | sort | uniq -c | sort -rn

# 정책 검증 보고서 생성
echo "=== Network Policy Verification Report ===" > /tmp/np-report.txt
echo "Date: $(date)" >> /tmp/np-report.txt
echo "" >> /tmp/np-report.txt
echo "--- Applied Policies ---" >> /tmp/np-report.txt
kubectl get cnp -n demo >> /tmp/np-report.txt
echo "" >> /tmp/np-report.txt
echo "--- Allowed Traffic Pairs ---" >> /tmp/np-report.txt
hubble observe --namespace demo --verdict FORWARDED -o json --last 2000 \
  | jq -r '.flow | "\(.source.labels // [] | map(select(startswith("k8s:app="))) | .[0] // .source.pod_name) → \(.destination.labels // [] | map(select(startswith("k8s:app="))) | .[0] // .destination.pod_name)"' \
  | sort | uniq -c | sort -rn >> /tmp/np-report.txt
echo "" >> /tmp/np-report.txt
echo "--- Denied Traffic Pairs ---" >> /tmp/np-report.txt
hubble observe --namespace demo --verdict DROPPED -o json --last 2000 \
  | jq -r '.flow | "\(.source.labels // [] | map(select(startswith("k8s:app="))) | .[0] // .source.pod_name) → \(.destination.labels // [] | map(select(startswith("k8s:app="))) | .[0] // .destination.pod_name)"' \
  | sort | uniq -c | sort -rn >> /tmp/np-report.txt
cat /tmp/np-report.txt
```

---

## 예제

### 예제 1: 종합 트래픽 모니터링 스크립트

```bash
#!/bin/bash
# traffic-monitor.sh - 네임스페이스별 트래픽 현황을 출력한다

NAMESPACE=${1:-"demo"}
COUNT=${2:-10}

echo "=== $NAMESPACE 트래픽 현황 ==="
echo ""

echo "--- 허용된 트래픽 (최근 ${COUNT}건) ---"
hubble observe --namespace "$NAMESPACE" --verdict FORWARDED --last "$COUNT"

echo ""
echo "--- 차단된 트래픽 (최근 ${COUNT}건) ---"
hubble observe --namespace "$NAMESPACE" --verdict DROPPED --last "$COUNT"

echo ""
echo "--- HTTP 요청 (최근 ${COUNT}건) ---"
hubble observe --namespace "$NAMESPACE" --protocol http --last "$COUNT"

echo ""
echo "--- DNS 쿼리 (최근 ${COUNT}건) ---"
hubble observe --namespace "$NAMESPACE" --protocol dns --last "$COUNT"

echo ""
echo "--- 통신 대상 요약 ---"
hubble observe --namespace "$NAMESPACE" --output json --last 500 \
  | jq -r '.flow | "\(.source.pod_name // .IP.source) -> \(.destination.pod_name // .IP.destination)"' \
  | sort | uniq -c | sort -rn | head -20
```

### 예제 2: 네트워크 정책 디버깅

```bash
#!/bin/bash
# debug-network-policy.sh - 네트워크 정책 문제를 진단한다

NAMESPACE=${1:-"default"}

echo "=== 차단된 트래픽 분석 ($NAMESPACE) ==="
hubble observe --namespace "$NAMESPACE" --verdict DROPPED --last 20 -o compact

echo ""
echo "=== Drop Reason 분류 ==="
hubble observe --namespace "$NAMESPACE" --verdict DROPPED --output json --last 100 \
  | jq -r '.flow.drop_reason_desc // "UNKNOWN"' | sort | uniq -c | sort -rn

echo ""
echo "=== 차단된 트래픽 상세 (source -> destination) ==="
hubble observe --namespace "$NAMESPACE" --verdict DROPPED --output json --last 50 \
  | jq -r '.flow | "\(.source.labels // [] | join(",")) -> \(.destination.labels // [] | join(",")) | port: \(.l4.TCP.destination_port // .l4.UDP.destination_port // "N/A") | reason: \(.drop_reason_desc // "N/A")"'

echo ""
echo "=== 현재 적용된 네트워크 정책 ==="
kubectl get cnp -n "$NAMESPACE"
kubectl get ccnp

echo ""
echo "=== Cilium Endpoint 상태 ==="
kubectl -n kube-system exec -it ds/cilium -- cilium endpoint list
```

### 예제 3: Hubble 메트릭 기반 Grafana 대시보드용 PromQL 쿼리

```promql
# 초당 Flow 처리량 (verdict별)
rate(hubble_flows_processed_total[5m])

# 초당 Drop된 패킷 수 (reason별)
sum by (reason) (rate(hubble_drop_total[5m]))

# DNS 쿼리 에러율
sum(rate(hubble_dns_queries_total{rcode!="No Error"}[5m])) /
sum(rate(hubble_dns_queries_total[5m])) * 100

# HTTP 5xx 에러율 (서비스별)
sum by (destination) (rate(hubble_http_responses_total{status=~"5.."}[5m])) /
sum by (destination) (rate(hubble_http_responses_total[5m])) * 100

# HTTP 요청 P99 레이턴시
histogram_quantile(0.99, rate(hubble_http_request_duration_seconds_bucket[5m]))

# TCP RST 비율 (연결 문제 탐지)
rate(hubble_tcp_flags_total{flag="RST"}[5m])
```

### 예제 4: Grafana Hubble 대시보드 JSON 모델

다음은 Grafana에 import할 수 있는 Hubble 네트워크 가시성 대시보드의 JSON 모델이다. Grafana UI에서 Import > "Import via panel json"으로 입력한다.

```json
{
  "dashboard": {
    "title": "Hubble Network Observability",
    "uid": "hubble-network-observability",
    "timezone": "browser",
    "refresh": "30s",
    "time": { "from": "now-1h", "to": "now" },
    "panels": [
      {
        "title": "Flow Rate by Verdict",
        "type": "timeseries",
        "gridPos": { "x": 0, "y": 0, "w": 12, "h": 8 },
        "targets": [
          {
            "expr": "sum by (verdict) (rate(hubble_flows_processed_total[5m]))",
            "legendFormat": "{{ verdict }}"
          }
        ],
        "fieldConfig": {
          "overrides": [
            { "matcher": { "id": "byName", "options": "FORWARDED" }, "properties": [{ "id": "color", "value": { "fixedColor": "green", "mode": "fixed" } }] },
            { "matcher": { "id": "byName", "options": "DROPPED" }, "properties": [{ "id": "color", "value": { "fixedColor": "red", "mode": "fixed" } }] }
          ]
        }
      },
      {
        "title": "Drop Rate by Reason",
        "type": "timeseries",
        "gridPos": { "x": 12, "y": 0, "w": 12, "h": 8 },
        "targets": [
          {
            "expr": "topk(10, sum by (reason) (rate(hubble_drop_total[5m])))",
            "legendFormat": "{{ reason }}"
          }
        ]
      },
      {
        "title": "DNS Query Rate by Response Code",
        "type": "timeseries",
        "gridPos": { "x": 0, "y": 8, "w": 12, "h": 8 },
        "targets": [
          {
            "expr": "sum by (rcode) (rate(hubble_dns_queries_total[5m]))",
            "legendFormat": "{{ rcode }}"
          }
        ]
      },
      {
        "title": "DNS Error Rate (%)",
        "type": "stat",
        "gridPos": { "x": 12, "y": 8, "w": 6, "h": 4 },
        "targets": [
          {
            "expr": "(sum(rate(hubble_dns_queries_total{rcode!=\"No Error\"}[5m])) / sum(rate(hubble_dns_queries_total[5m]))) * 100"
          }
        ],
        "fieldConfig": {
          "defaults": { "unit": "percent", "thresholds": { "steps": [
            { "value": 0, "color": "green" },
            { "value": 5, "color": "yellow" },
            { "value": 10, "color": "red" }
          ]}}
        }
      },
      {
        "title": "HTTP Request Rate by Method",
        "type": "timeseries",
        "gridPos": { "x": 0, "y": 16, "w": 12, "h": 8 },
        "targets": [
          {
            "expr": "sum by (method) (rate(hubble_http_requests_total[5m]))",
            "legendFormat": "{{ method }}"
          }
        ]
      },
      {
        "title": "HTTP Response Rate by Status",
        "type": "timeseries",
        "gridPos": { "x": 12, "y": 16, "w": 12, "h": 8 },
        "targets": [
          {
            "expr": "sum by (status) (rate(hubble_http_responses_total[5m]))",
            "legendFormat": "{{ status }}"
          }
        ]
      },
      {
        "title": "HTTP Latency Percentiles",
        "type": "timeseries",
        "gridPos": { "x": 0, "y": 24, "w": 12, "h": 8 },
        "targets": [
          {
            "expr": "histogram_quantile(0.50, sum by (le) (rate(hubble_http_request_duration_seconds_bucket[5m])))",
            "legendFormat": "P50"
          },
          {
            "expr": "histogram_quantile(0.95, sum by (le) (rate(hubble_http_request_duration_seconds_bucket[5m])))",
            "legendFormat": "P95"
          },
          {
            "expr": "histogram_quantile(0.99, sum by (le) (rate(hubble_http_request_duration_seconds_bucket[5m])))",
            "legendFormat": "P99"
          }
        ],
        "fieldConfig": { "defaults": { "unit": "s" } }
      },
      {
        "title": "TCP Flags Distribution",
        "type": "timeseries",
        "gridPos": { "x": 12, "y": 24, "w": 12, "h": 8 },
        "targets": [
          {
            "expr": "sum by (flag) (rate(hubble_tcp_flags_total[5m]))",
            "legendFormat": "{{ flag }}"
          }
        ]
      },
      {
        "title": "Top 10 Drop Reasons (Table)",
        "type": "table",
        "gridPos": { "x": 0, "y": 32, "w": 12, "h": 8 },
        "targets": [
          {
            "expr": "topk(10, sum by (reason, protocol) (increase(hubble_drop_total[1h])))",
            "format": "table",
            "instant": true
          }
        ]
      },
      {
        "title": "Port Distribution (Top 20)",
        "type": "barchart",
        "gridPos": { "x": 12, "y": 32, "w": 12, "h": 8 },
        "targets": [
          {
            "expr": "topk(20, sum by (port) (rate(hubble_port_distribution_total[5m])))",
            "legendFormat": "port {{ port }}"
          }
        ]
      }
    ]
  }
}
```

### 예제 5: 네트워크 감사 자동화 스크립트

```bash
#!/bin/bash
# hubble-security-audit.sh - 자동화된 네트워크 보안 감사 스크립트
# 사용법: ./hubble-security-audit.sh [namespace] [flow_count]

set -euo pipefail

NAMESPACE=${1:-"demo"}
FLOW_COUNT=${2:-5000}
REPORT_DIR="/tmp/hubble-audit"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
REPORT_FILE="${REPORT_DIR}/audit_${NAMESPACE}_${TIMESTAMP}.txt"

mkdir -p "$REPORT_DIR"

log() {
    echo "[$(date '+%H:%M:%S')] $1" | tee -a "$REPORT_FILE"
}

separator() {
    echo "" | tee -a "$REPORT_FILE"
    echo "================================================================" | tee -a "$REPORT_FILE"
}

# 헤더
log "=== Hubble 네트워크 보안 감사 보고서 ==="
log "Namespace: $NAMESPACE"
log "Flow Count: $FLOW_COUNT"
log "생성 시각: $(date)"
separator

# 1. Hubble 상태 확인
log "--- 1. Hubble 상태 ---"
hubble status 2>&1 | tee -a "$REPORT_FILE" || log "WARNING: hubble status 실패"
separator

# 2. Verdict 분포
log "--- 2. Verdict 분포 ---"
hubble observe --namespace "$NAMESPACE" -o json --last "$FLOW_COUNT" \
  | jq -r '.flow.verdict' | sort | uniq -c | sort -rn | tee -a "$REPORT_FILE"
separator

# 3. Drop Reason 분석
log "--- 3. Drop Reason 상세 ---"
hubble observe --namespace "$NAMESPACE" --verdict DROPPED -o json --last "$FLOW_COUNT" \
  | jq -r '.flow.drop_reason_desc // "UNKNOWN"' | sort | uniq -c | sort -rn | tee -a "$REPORT_FILE"
separator

# 4. 외부(world) 통신 현황
log "--- 4. 외부 통신 (world identity) ---"
hubble observe --namespace "$NAMESPACE" --to-identity world -o json --last "$FLOW_COUNT" \
  | jq -r '.flow | "\(.source.pod_name // "unknown") → \(.IP.destination):\(.l4.TCP.destination_port // .l4.UDP.destination_port // "N/A") [\(.verdict)]"' \
  | sort | uniq -c | sort -rn | head -20 | tee -a "$REPORT_FILE"
separator

# 5. Cross-Namespace 통신
log "--- 5. Cross-Namespace 통신 ---"
hubble observe --namespace "$NAMESPACE" -o json --last "$FLOW_COUNT" \
  | jq -r 'select(.flow.source.namespace != .flow.destination.namespace and .flow.destination.namespace != null) |
    "\(.flow.source.namespace)/\(.flow.source.pod_name // "?") → \(.flow.destination.namespace)/\(.flow.destination.pod_name // "?")"' \
  | sort | uniq -c | sort -rn | head -20 | tee -a "$REPORT_FILE"
separator

# 6. API 서버 접근 시도
log "--- 6. API 서버(6443) 접근 ---"
hubble observe --namespace "$NAMESPACE" --to-port 6443 -o json --last "$FLOW_COUNT" \
  | jq -r '.flow | "\(.source.pod_name // "unknown") [\(.verdict)]"' \
  | sort | uniq -c | sort -rn | tee -a "$REPORT_FILE"
separator

# 7. 비표준 포트 외부 통신 (80/443/53 이외)
log "--- 7. 비표준 포트 외부 통신 ---"
hubble observe --namespace "$NAMESPACE" --to-identity world -o json --last "$FLOW_COUNT" \
  | jq -r 'select(
    (.flow.l4.TCP.destination_port // 0) != 443 and
    (.flow.l4.TCP.destination_port // 0) != 80 and
    (.flow.l4.UDP.destination_port // 0) != 53 and
    ((.flow.l4.TCP.destination_port // .flow.l4.UDP.destination_port // 0) != 0)
  ) | .flow | "\(.source.pod_name // "unknown") → \(.IP.destination):\(.l4.TCP.destination_port // .l4.UDP.destination_port)"' \
  | sort | uniq -c | sort -rn | head -20 | tee -a "$REPORT_FILE"
separator

# 8. 현재 적용된 네트워크 정책
log "--- 8. 적용된 CiliumNetworkPolicy ---"
kubectl get cnp -n "$NAMESPACE" -o wide 2>&1 | tee -a "$REPORT_FILE"
separator

# 9. DNS 에러 (NXDOMAIN, SERVFAIL 등)
log "--- 9. DNS 에러 응답 ---"
hubble observe --namespace "$NAMESPACE" --protocol dns -o json --last "$FLOW_COUNT" \
  | jq -r 'select(.flow.l7.dns.rcode != null and .flow.l7.dns.rcode != "No Error") |
    .flow | "\(.source.pod_name // "?"): \(.l7.dns.query) → \(.l7.dns.rcode)"' \
  | sort | uniq -c | sort -rn | head -20 | tee -a "$REPORT_FILE"
separator

# 10. 감사 요약
TOTAL_FLOWS=$(hubble observe --namespace "$NAMESPACE" -o json --last "$FLOW_COUNT" | wc -l)
DROPPED_FLOWS=$(hubble observe --namespace "$NAMESPACE" --verdict DROPPED -o json --last "$FLOW_COUNT" | wc -l)
EXTERNAL_FLOWS=$(hubble observe --namespace "$NAMESPACE" --to-identity world -o json --last "$FLOW_COUNT" | wc -l)

log "--- 10. 감사 요약 ---"
log "분석된 총 Flow 수: $TOTAL_FLOWS"
log "차단된 Flow 수: $DROPPED_FLOWS"
log "외부 통신 Flow 수: $EXTERNAL_FLOWS"
if [ "$TOTAL_FLOWS" -gt 0 ]; then
    DROP_RATE=$(echo "scale=2; $DROPPED_FLOWS * 100 / $TOTAL_FLOWS" | bc)
    log "차단 비율: ${DROP_RATE}%"
fi
separator

log "보고서 저장 위치: $REPORT_FILE"
```

### 예제 6: 이상 트래픽 탐지 스크립트

```bash
#!/bin/bash
# hubble-anomaly-detector.sh - 이상 트래픽 패턴을 실시간으로 탐지한다
# 사용법: ./hubble-anomaly-detector.sh [namespace]

set -euo pipefail

NAMESPACE=${1:-""}
NS_FILTER=""
if [ -n "$NAMESPACE" ]; then
    NS_FILTER="--namespace $NAMESPACE"
fi

ALERT_LOG="/tmp/hubble-alerts-$(date +%Y%m%d).log"

alert() {
    local severity=$1
    local message=$2
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo "[$timestamp] [$severity] $message" | tee -a "$ALERT_LOG"
}

echo "=== Hubble 이상 트래픽 탐지 시작 ==="
echo "Alert 로그: $ALERT_LOG"
echo ""

# 탐지 1: metadata 서비스 접근 (SSRF 공격 의심)
echo "[탐지 1] metadata 서비스 접근 감시 시작..."
hubble observe $NS_FILTER --to-ip 169.254.169.254 -o json --follow 2>/dev/null | while read -r line; do
    pod=$(echo "$line" | jq -r '.flow.source.pod_name // "unknown"')
    ns=$(echo "$line" | jq -r '.flow.source.namespace // "unknown"')
    alert "CRITICAL" "metadata 서비스 접근 시도: $ns/$pod → 169.254.169.254"
done &
PID_META=$!

# 탐지 2: 대량 DROP 이벤트 (포트 스캔 의심)
echo "[탐지 2] 대량 DROP 이벤트 감시 시작..."
hubble observe $NS_FILTER --verdict DROPPED -o json --follow 2>/dev/null | \
  jq --unbuffered -r '.flow | "\(.source.namespace)/\(.source.pod_name // "unknown")"' | \
  while read -r src; do
    # 10초 내 같은 source에서 50건 이상 DROP이면 알림
    count=$(grep -c "$src" /tmp/hubble-drop-buffer.tmp 2>/dev/null || echo 0)
    echo "$src" >> /tmp/hubble-drop-buffer.tmp
    if [ "$count" -gt 50 ]; then
        alert "HIGH" "포트 스캔 의심 - $src 에서 대량 DROPPED 이벤트 ($count건)"
        > /tmp/hubble-drop-buffer.tmp  # 버퍼 초기화
    fi
done &
PID_SCAN=$!

# 탐지 3: 비표준 포트 외부 통신
echo "[탐지 3] 비표준 포트 외부 통신 감시 시작..."
hubble observe $NS_FILTER --to-identity world -o json --follow 2>/dev/null | \
  jq --unbuffered -r 'select(
    (.flow.l4.TCP.destination_port // 0) != 443 and
    (.flow.l4.TCP.destination_port // 0) != 80 and
    (.flow.l4.UDP.destination_port // 0) != 53 and
    ((.flow.l4.TCP.destination_port // .flow.l4.UDP.destination_port // 0) > 0)
  ) | "\(.flow.source.namespace // "?")/\(.flow.source.pod_name // "?") → \(.flow.IP.destination):\(.flow.l4.TCP.destination_port // .flow.l4.UDP.destination_port)"' | \
  while read -r line; do
    alert "MEDIUM" "비표준 포트 외부 통신: $line"
done &
PID_PORT=$!

# 탐지 4: 민감 포트 접근 (etcd, kubelet)
echo "[탐지 4] 민감 포트 접근 감시 시작..."
for port in 2379 2380 10250 10251 10252; do
    hubble observe $NS_FILTER --to-port $port -o json --follow 2>/dev/null | \
      jq --unbuffered -r '.flow | "\(.source.namespace // "?")/\(.source.pod_name // "?") → \(.destination.pod_name // .IP.destination):'"$port"'"' | \
      while read -r line; do
        alert "CRITICAL" "민감 포트($port) 접근: $line"
    done &
done

echo ""
echo "모든 탐지 프로세스가 백그라운드에서 실행 중이다."
echo "Ctrl+C로 종료한다."

# cleanup on exit
trap "kill $PID_META $PID_SCAN $PID_PORT 2>/dev/null; exit" INT TERM

wait
```

---

## 자가 점검

### 기본 개념 (기존)

- [ ] Hubble이 eBPF datapath에서 Flow 데이터를 수집하는 과정(ring buffer 메커니즘)을 설명할 수 있는가?
- [ ] hubble-relay가 gRPC streaming으로 모든 노드의 데이터를 집계하는 방식을 설명할 수 있는가?
- [ ] Flow 데이터 구조에 어떤 필드들이 포함되는지 알고 있는가? (identity, labels, IP, port, L7 info)
- [ ] `hubble observe` 명령으로 다양한 필터(--ip, --port, --label, --http-status, --dns-query, --type)를 조합할 수 있는가?
- [ ] DNS 해석 실패 문제를 Hubble로 트러블슈팅할 수 있는가?
- [ ] 네트워크 정책의 효과를 Hubble로 검증하고, drop reason을 분석할 수 있는가?
- [ ] Hubble 메트릭을 Prometheus로 수집하고, 주요 메트릭(hubble_flows_processed_total, hubble_drop_total 등)을 이해하는가?
- [ ] L7 가시성(HTTP, DNS, Kafka)을 활성화하는 방법을 알고 있는가?
- [ ] Hubble UI의 Service Map이 Flow 데이터로부터 어떻게 생성되는지 설명할 수 있는가?
- [ ] Lateral movement 탐지, inter-namespace 트래픽 분석 등 보안 시나리오에 Hubble을 활용할 수 있는가?

### 내부 아키텍처 심화

- [ ] Monitor 컴포넌트의 perf event 수집 파이프라인을 커널/유저 공간 구분하여 설명할 수 있는가?
- [ ] per-CPU perf event ring buffer가 lock-free 구조를 사용하는 이유를 설명할 수 있는가?
- [ ] send_trace_notify(), send_drop_notify(), send_policy_verdict_notify() 등 eBPF notify 함수의 차이를 알고 있는가?
- [ ] Flow 파싱 엔진의 Identity 해석 과정(numeric ID → label set → namespace/pod)을 설명할 수 있는가?
- [ ] IPv4/IPv6 헤더에서 Hubble이 추출하는 필드들을 나열할 수 있는가?
- [ ] TCP 헤더의 flags 필드가 hubble_tcp_flags_total 메트릭과 어떻게 연결되는지 설명할 수 있는가?

### L7 프로토콜 파싱

- [ ] HTTP 파서가 요청/응답을 별도 Flow로 기록하는 이유를 설명할 수 있는가?
- [ ] DNS 파서가 L7 정책 없이도 toFQDNs 규칙만으로 동작하는 이유를 설명할 수 있는가?
- [ ] Kafka 파서가 추출하는 API Key 타입(Produce, Fetch, Metadata 등)의 의미를 알고 있는가?
- [ ] gRPC 요청이 HTTP/2 위에서 파싱되는 구조를 이해하고, grpc-status 헤더의 의미를 알고 있는가?

### Ring Buffer 및 메모리

- [ ] 커널 perf event ring buffer와 유저 공간 in-memory ring buffer의 역할 차이를 설명할 수 있는가?
- [ ] ring buffer 크기(기본 4096)가 Flow 보존 시간에 미치는 영향을 계산할 수 있는가?
- [ ] buffer capacity를 65,536으로 설정했을 때 예상 메모리 사용량을 산출할 수 있는가?
- [ ] hubble_lost_events_total 메트릭이 증가할 때의 대처 방법을 알고 있는가?

### gRPC API

- [ ] GetFlows, GetAgentEvents, GetDebugEvents, ServerStatus RPC의 용도를 각각 설명할 수 있는가?
- [ ] GetFlowsRequest의 whitelist/blacklist 필터가 서버사이드에서 적용되는 방식을 설명할 수 있는가?
- [ ] ServerStatusResponse에서 num_flows, max_flows, seen_flows 필드의 의미를 구분할 수 있는가?

### Flow 데이터 구조

- [ ] Flow 타입(L3_L4, L7, SOCK, TRACE, DROP, POLICY_VERDICT, CAPTURE, DEBUG)의 차이를 설명할 수 있는가?
- [ ] Verdict 중 AUDIT의 용도(점진적 정책 적용)를 설명할 수 있는가?
- [ ] Drop Reason 코드 중 가장 흔한 POLICY_DENIED(5)의 대처 방법을 알고 있는가?
- [ ] Reserved Identity(host=1, world=2, kube-apiserver=7 등)의 의미와 용도를 설명할 수 있는가?
- [ ] TrafficDirection(INGRESS/EGRESS)이 정책 평가와 어떻게 연결되는지 설명할 수 있는가?

### hubble-relay 심화

- [ ] Peer Discovery가 노드 추가/제거를 자동 반영하는 메커니즘을 설명할 수 있는가?
- [ ] Flow Merging의 min-heap 기반 정렬 알고리즘을 이해하고 있는가?
- [ ] hubble-relay와 cilium-agent 간 mTLS를 설정할 수 있는가?
- [ ] 서버사이드 필터링과 클라이언트사이드 필터링의 성능 차이를 설명할 수 있는가?

### Hubble UI 심화

- [ ] Hubble UI의 gRPC-Web → gRPC 변환 아키텍처를 설명할 수 있는가?
- [ ] Service Map의 force-directed layout 알고리즘의 기본 원리를 이해하고 있는가?
- [ ] Flow Table의 실시간 스트리밍이 GetFlows follow 모드를 사용함을 알고 있는가?

### Hubble Metrics 심화

- [ ] 메트릭 핸들러(dns, drop, tcp, flow, http, icmp, port-distribution)를 필요에 따라 선택 설정할 수 있는가?
- [ ] httpV2 핸들러의 labelsContext 옵션과 카디널리티 주의사항을 이해하고 있는가?
- [ ] Grafana 대시보드에서 hubble_drop_total을 reason별로 시각화하는 PromQL을 작성할 수 있는가?
- [ ] HTTP P99 레이턴시를 계산하는 histogram_quantile PromQL 쿼리를 작성할 수 있는가?
- [ ] TCP SYN 대비 RST 비율로 연결 실패율을 추정하는 쿼리를 작성할 수 있는가?

### 트러블슈팅 및 보안

- [ ] Pod 간 통신 실패 시 DROPPED verdict 추적 → drop reason 분석 → 정책 수정의 워크플로우를 수행할 수 있는가?
- [ ] DNS NXDOMAIN 응답을 Hubble로 탐지하고 원인을 진단할 수 있는가?
- [ ] 새로 적용한 CiliumNetworkPolicy를 Hubble로 positive/negative test할 수 있는가?
- [ ] TCP RST 패킷 분석을 통해 비정상 연결 종료의 원인을 추정할 수 있는가?
- [ ] metadata 서비스(169.254.169.254) 접근 시도를 탐지하여 SSRF 공격을 식별할 수 있는가?
- [ ] 비표준 포트 외부 통신을 탐지하여 데이터 유출 가능성을 판단할 수 있는가?
- [ ] DNS 터널링 의심 패턴(비정상적으로 긴 도메인 쿼리)을 탐지할 수 있는가?

### 성능 튜닝

- [ ] Ring buffer 크기를 Flow rate에 기반하여 최적값을 산출할 수 있는가?
- [ ] 메트릭 핸들러 수와 label 카디널리티가 CPU/메모리에 미치는 영향을 이해하고 있는가?
- [ ] L7 visibility 활성화 시 추가 레이턴시와 리소스 소비를 예상할 수 있는가?
- [ ] hubble-relay의 리소스 설정을 클러스터 규모에 맞게 조정할 수 있는가?

### 실습 종합

- [ ] 이 프로젝트의 manifests/network-policies/ 정책들을 Hubble로 검증할 수 있는가?
- [ ] hubble observe의 JSON 출력을 jq로 가공하여 CSV 보고서를 생성할 수 있는가?
- [ ] Hubble 메트릭을 Prometheus에서 조회하고 Grafana 대시보드를 구성할 수 있는가?
- [ ] 네트워크 보안 감사 스크립트를 작성하여 주기적으로 실행할 수 있는가?
- [ ] 이상 트래픽 탐지를 위한 실시간 모니터링 파이프라인을 구축할 수 있는가?

---

## 참고문헌

- [Hubble 공식 문서 - Cilium Docs](https://docs.cilium.io/en/stable/observability/hubble/) - Hubble 설정, 활성화, 트러블슈팅 가이드
- [Hubble GitHub 리포지토리](https://github.com/cilium/hubble) - Hubble CLI 소스 코드 및 릴리스
- [Cilium 공식 문서 - Observability](https://docs.cilium.io/en/stable/observability/) - Cilium 옵저버빌리티 전반
- [Hubble Relay 소스 코드](https://github.com/cilium/cilium/tree/main/pkg/hubble) - cilium-agent 내장 Hubble 구현
- [Hubble UI GitHub 리포지토리](https://github.com/cilium/hubble-ui) - Hubble UI 소스 코드
- [Cilium eBPF Datapath 문서](https://docs.cilium.io/en/stable/network/ebpf/) - eBPF 데이터플레인 아키텍처
- [Hubble Metrics 설정 가이드](https://docs.cilium.io/en/stable/observability/metrics/) - Prometheus 메트릭 export 설정
- [Hubble Flow API (Protocol Buffers)](https://github.com/cilium/cilium/blob/main/api/v1/flow/flow.proto) - Flow 메시지 스키마 정의
- [Cilium L7 Protocol Visibility](https://docs.cilium.io/en/stable/observability/visibility/) - L7 프로토콜 파싱 설정
