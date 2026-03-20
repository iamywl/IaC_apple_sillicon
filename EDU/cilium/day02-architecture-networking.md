# Day 2: Cilium 아키텍처 및 네트워킹 심화

> Cilium의 내부 아키텍처(Agent, Operator, CNI Plugin)와 네트워킹 모델(Overlay, Direct Routing, DSR)을 상세히 학습한다.

---

## 제2장: Cilium 아키텍처 상세

### 전체 구조

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Kubernetes Cluster                              │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                    Control Plane                                  │  │
│  │  ┌──────────────────────┐    ┌──────────────────────────────┐   │  │
│  │  │   cilium-operator     │    │   Hubble Relay               │   │  │
│  │  │   (Deployment)        │    │   (Deployment)               │   │  │
│  │  │                       │    │                               │   │  │
│  │  │ - IPAM 할당           │    │ - 분산 이벤트 수집            │   │  │
│  │  │ - CiliumIdentity GC  │    │ - gRPC API 제공              │   │  │
│  │  │ - CES 관리            │    │ - Hubble UI 백엔드           │   │  │
│  │  │ - CRD 동기화          │    └──────────────────────────────┘   │  │
│  │  └──────────────────────┘                                        │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                        │
│  ┌─────────────────────────┐    ┌─────────────────────────────┐       │
│  │  Node A                  │    │  Node B                      │       │
│  │  ┌─────────────────────┐│    │  ┌─────────────────────────┐ │       │
│  │  │   cilium-agent       ││    │  │   cilium-agent           │ │       │
│  │  │   (DaemonSet)        ││    │  │   (DaemonSet)            │ │       │
│  │  │                      ││    │  │                           │ │       │
│  │  │ ┌──────────────────┐ ││    │  │ ┌──────────────────────┐ │ │       │
│  │  │ │ Envoy Proxy      │ ││    │  │ │ Envoy Proxy          │ │ │       │
│  │  │ │ (L7 정책 처리)   │ ││    │  │ │ (L7 정책 처리)       │ │ │       │
│  │  │ └──────────────────┘ ││    │  │ └──────────────────────┘ │ │       │
│  │  │ ┌──────────────────┐ ││    │  │ ┌──────────────────────┐ │ │       │
│  │  │ │ eBPF Datapath    │ ││    │  │ │ eBPF Datapath        │ │ │       │
│  │  │ │ - TC programs    │ ││    │  │ │ - TC programs        │ │ │       │
│  │  │ │ - XDP programs   │ ││    │  │ │ - XDP programs       │ │ │       │
│  │  │ │ - Socket LB      │ ││    │  │ │ - Socket LB          │ │ │       │
│  │  │ │ - Conntrack      │ ││    │  │ │ - Conntrack          │ │ │       │
│  │  │ └──────────────────┘ ││    │  │ └──────────────────────┘ │ │       │
│  │  │ ┌──────────────────┐ ││    │  │ ┌──────────────────────┐ │ │       │
│  │  │ │ IPAM             │ ││    │  │ │ IPAM                 │ │ │       │
│  │  │ │ (Pod IP 할당)    │ ││    │  │ │ (Pod IP 할당)        │ │ │       │
│  │  │ └──────────────────┘ ││    │  │ └──────────────────────┘ │ │       │
│  │  └─────────────────────┘│    │  └─────────────────────────┘ │       │
│  │  ┌────┐ ┌────┐ ┌────┐  │    │  ┌────┐ ┌────┐ ┌────┐       │       │
│  │  │Pod1│ │Pod2│ │Pod3│  │    │  │Pod4│ │Pod5│ │Pod6│       │       │
│  │  └────┘ └────┘ └────┘  │    │  └────┘ └────┘ └────┘       │       │
│  └─────────────────────────┘    └─────────────────────────────┘       │
└────────────────────────────────────────────────────────────────────────┘
```

### cilium-agent (DaemonSet) 심화

cilium-agent는 각 노드에서 실행되는 핵심 컴포넌트이다. 주요 역할은 다음과 같다:

**1. eBPF Datapath 관리**
- eBPF 프로그램을 컴파일하고 커널에 로드한다
- TC(Traffic Control) hook에 ingress/egress 프로그램을 부착하여 Pod 간 트래픽을 제어한다
- XDP hook을 통해 NodePort, LoadBalancer 서비스 트래픽을 처리한다
- Connection Tracking(conntrack) 테이블을 eBPF Map으로 관리한다

**2. Envoy 통합**
- cilium-agent 프로세스 내에 Envoy proxy를 내장(embedded)하여 실행한다
- L7 네트워크 정책(HTTP, gRPC, Kafka 등)이 적용된 트래픽을 Envoy로 리다이렉트한다
- eBPF에서 L3/L4 필터링 후 L7 검사가 필요한 경우에만 Envoy를 경유하므로, 불필요한 오버헤드를 방지한다

**3. IPAM (IP Address Management)**
- Pod에 IP 주소를 할당한다
- cilium-operator와 협력하여 노드별 PodCIDR을 관리한다

**4. Kubernetes API 연동**
- Pod, Service, Endpoint, NetworkPolicy 등 Kubernetes 리소스를 watch한다
- CiliumNetworkPolicy, CiliumClusterwideNetworkPolicy 등 CRD를 처리한다
- 리소스 변경 시 eBPF 프로그램과 Map을 업데이트한다

#### cilium-agent 내부 아키텍처

```
┌──────────────────────────────────────────────────────────────┐
│  cilium-agent 프로세스 내부 구조                              │
│                                                              │
│  ┌───────────────────────────────────────────────────────┐   │
│  │  K8s Watchers                                          │   │
│  │  ├── Pod Watcher: Pod 생성/삭제 감지                   │   │
│  │  ├── Service Watcher: Service/Endpoint 변경 감지       │   │
│  │  ├── NetworkPolicy Watcher: CNP/CCNP 변경 감지        │   │
│  │  ├── Node Watcher: 노드 추가/제거 감지                 │   │
│  │  └── CiliumNode Watcher: IPAM 상태 동기화              │   │
│  └───────────────────────────────────────────────────────┘   │
│       │                                                      │
│       ▼                                                      │
│  ┌───────────────────────────────────────────────────────┐   │
│  │  Endpoint Manager                                      │   │
│  │  ├── Endpoint 생명주기 관리 (create/update/delete)     │   │
│  │  ├── Security Identity 할당/갱신                       │   │
│  │  ├── Policy 계산 및 적용                               │   │
│  │  └── eBPF 프로그램 재생성 트리거                       │   │
│  └───────────────────────────────────────────────────────┘   │
│       │                                                      │
│       ▼                                                      │
│  ┌───────────────────────────────────────────────────────┐   │
│  │  Datapath (eBPF) Layer                                 │   │
│  │  ├── BPF Compiler: C → eBPF 바이트코드 컴파일          │   │
│  │  ├── Map Manager: eBPF Map CRUD                        │   │
│  │  ├── Program Loader: TC/XDP/Socket 프로그램 로드       │   │
│  │  └── Regeneration Queue: 비동기 프로그램 재생성 큐     │   │
│  └───────────────────────────────────────────────────────┘   │
│       │                                                      │
│       ▼                                                      │
│  ┌───────────────────────────────────────────────────────┐   │
│  │  Service Handler                                       │   │
│  │  ├── ClusterIP/NodePort/LoadBalancer 서비스 관리       │   │
│  │  ├── eBPF LB Map 업데이트                              │   │
│  │  ├── Maglev 해시 테이블 관리                           │   │
│  │  └── Session Affinity 처리                             │   │
│  └───────────────────────────────────────────────────────┘   │
│       │                                                      │
│       ▼                                                      │
│  ┌───────────────────────────────────────────────────────┐   │
│  │  Envoy (Embedded)                                      │   │
│  │  ├── L7 정책 적용 (HTTP, gRPC, Kafka, DNS)            │   │
│  │  ├── xDS API로 cilium-agent와 통신                     │   │
│  │  └── 노드당 1개 인스턴스 (Pod별 sidecar 아님)         │   │
│  └───────────────────────────────────────────────────────┘   │
│       │                                                      │
│       ▼                                                      │
│  ┌───────────────────────────────────────────────────────┐   │
│  │  IPAM                                                  │   │
│  │  ├── Pod IP 할당/해제                                  │   │
│  │  ├── CiliumNode CRD와 동기화                           │   │
│  │  └── IP 풀 고갈 시 operator에게 추가 할당 요청        │   │
│  └───────────────────────────────────────────────────────┘   │
│       │                                                      │
│       ▼                                                      │
│  ┌───────────────────────────────────────────────────────┐   │
│  │  Health Manager                                        │   │
│  │  ├── 노드 간 connectivity 프로브                      │   │
│  │  ├── Endpoint health check                             │   │
│  │  └── /healthz API 제공                                 │   │
│  └───────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

### cilium-operator (Deployment) 심화

cilium-operator는 클러스터 전역 작업을 담당하는 컴포넌트이다. 각 노드의 cilium-agent가 처리할 수 없는 클러스터 수준의 관리 작업을 수행한다:

- **IPAM 관리**: cluster-pool 모드에서 노드별 PodCIDR 블록을 할당한다. CiliumNode CRD를 통해 각 노드의 IP 풀 상태를 추적한다
- **CiliumIdentity Garbage Collection**: 더 이상 사용되지 않는 Security Identity 리소스를 정리한다
- **CiliumEndpointSlice(CES) 관리**: 대규모 클러스터에서 CiliumEndpoint 리소스를 CES로 집계하여 API server 부하를 줄인다
- **CRD 등록**: Cilium이 사용하는 CustomResourceDefinition을 Kubernetes에 등록한다

#### cilium-operator Leader Election

cilium-operator는 Deployment로 배포되지만, 핵심 기능은 리더 선출(leader election)을 통해 하나의 인스턴스만 수행한다:

```
┌──────────────────────────────────────────────────────────────┐
│  cilium-operator 리더 선출                                    │
│                                                              │
│  ┌────────────────┐  ┌────────────────┐                     │
│  │ operator-1     │  │ operator-2     │                     │
│  │ (Leader)       │  │ (Standby)      │                     │
│  │                │  │                │                     │
│  │ ✓ IPAM 할당   │  │ ✗ 대기 중      │                     │
│  │ ✓ Identity GC │  │ ✗ health check │                     │
│  │ ✓ CES 관리    │  │   만 수행       │                     │
│  └────────────────┘  └────────────────┘                     │
│                                                              │
│  Lease 기반 리더 선출:                                       │
│  - kube-system 네임스페이스의 Lease 리소스 사용              │
│  - 리더가 죽으면 standby가 15초 내 인계                     │
│  - 본 프로젝트: replicas: 1 (단일 인스턴스 운영)            │
└──────────────────────────────────────────────────────────────┘
```

### cilium-cni 플러그인

cilium-cni는 Kubernetes kubelet이 호출하는 CNI 바이너리이다. Pod 생성/삭제 시 kubelet이 이 바이너리를 실행한다.

```
┌──────────────────────────────────────────────────────────────┐
│  CNI 호출 흐름                                                │
│                                                              │
│  kubelet                                                     │
│    │                                                         │
│    ├── Pod 생성 요청 (CRI → containerd)                      │
│    │                                                         │
│    ├── CNI ADD 호출                                          │
│    │   └── /opt/cni/bin/cilium-cni ADD                      │
│    │       ├── 1. cilium-agent API에 Endpoint 생성 요청     │
│    │       ├── 2. veth pair 생성 (Pod ↔ Host)                │
│    │       ├── 3. IP 주소 할당 (IPAM)                        │
│    │       ├── 4. eBPF 프로그램 부착                         │
│    │       ├── 5. 라우팅 규칙 설정                           │
│    │       └── 6. CNI 결과 반환 (IP, Gateway, Routes)        │
│    │                                                         │
│    └── CNI DEL 호출 (Pod 삭제 시)                            │
│        └── /opt/cni/bin/cilium-cni DEL                      │
│            ├── 1. Endpoint 삭제                               │
│            ├── 2. IP 반환 (IPAM)                             │
│            ├── 3. eBPF 프로그램 분리                         │
│            └── 4. veth pair 삭제                              │
└──────────────────────────────────────────────────────────────┘
```

### Datapath 모드: veth, IPVLAN, Host-Routing

#### veth 모드 (기본값)

```
┌──────────────────────────────────────────────────────────────┐
│  veth pair 기반 datapath                                      │
│                                                              │
│  Pod Network Namespace          Host Network Namespace        │
│  ┌────────────────┐            ┌────────────────────────┐    │
│  │  eth0           │            │  lxc-xxxxx              │    │
│  │  (veth 한쪽)    │◄──veth──►│  (veth 다른쪽)           │    │
│  │                 │            │      │                   │    │
│  │  IP: 10.0.1.5   │            │  TC ingress/egress      │    │
│  │                 │            │  eBPF 프로그램 부착      │    │
│  └────────────────┘            │      │                   │    │
│                                 │  cilium_host / cilium_net│    │
│                                 │      │                   │    │
│                                 │  물리 NIC (eth0)         │    │
│                                 └────────────────────────┘    │
│                                                              │
│  장점: 가장 안정적, 모든 커널 버전 지원                      │
│  단점: veth를 통과할 때 CPU 오버헤드 발생                    │
└──────────────────────────────────────────────────────────────┘
```

#### Host-Routing 모드

Host-Routing 모드는 eBPF를 사용하여 패킷을 직접 라우팅하며 iptables를 완전히 우회한다. 커널 5.10+ 에서 최고 성능을 달성한다.

```
┌──────────────────────────────────────────────────────────────┐
│  Host-Routing (eBPF-based)                                    │
│                                                              │
│  패킷 경로:                                                  │
│  Pod A (lxc-a) → TC egress eBPF →                           │
│      bpf_redirect_peer() → Pod B (lxc-b)                    │
│                                                              │
│  iptables 완전 우회:                                         │
│  - netfilter/iptables를 거치지 않는다                       │
│  - bpf_redirect_peer()로 직접 peer veth로 전달               │
│  - 같은 노드 내 Pod 간 통신에서 최대 효과                    │
│                                                              │
│  활성화 조건:                                                 │
│  - 커널 5.10 이상                                            │
│  - Cilium Helm: routingMode=native, bpf.masquerade=true     │
│  - kube-proxy 대체 모드 활성화                               │
│                                                              │
│  성능 비교 (같은 노드 내 Pod-to-Pod, TCP_RR):                │
│  ┌─────────────────────┬─────────────┬──────────────┐        │
│  │ 모드                │ 지연 (p99)  │ 처리량       │        │
│  ├─────────────────────┼─────────────┼──────────────┤        │
│  │ iptables (kube-proxy)│ ~35 μs     │ baseline     │        │
│  │ Cilium veth          │ ~28 μs     │ +20%         │        │
│  │ Cilium host-routing  │ ~18 μs     │ +50%         │        │
│  └─────────────────────┴─────────────┴──────────────┘        │
└──────────────────────────────────────────────────────────────┘
```

### 데이터 저장 백엔드

Cilium의 상태 정보 저장에는 두 가지 백엔드 옵션이 있다:

| 백엔드 | 설명 | 적합한 환경 |
|--------|------|-------------|
| CRD (기본값) | Kubernetes CRD로 상태를 저장한다. 별도 인프라가 필요 없다 | 대부분의 환경 |
| etcd (외부) | 전용 etcd 클러스터에 상태를 저장한다. 대규모 클러스터에서 kube-apiserver 부하를 줄인다 | 1,000+ 노드 |

#### Cilium CRD 목록

| CRD | 약칭 | 용도 |
|-----|------|------|
| CiliumNetworkPolicy | cnp | 네임스페이스 레벨 L3/L4/L7 네트워크 정책 |
| CiliumClusterwideNetworkPolicy | ccnp | 클러스터 전역 네트워크 정책 |
| CiliumEndpoint | cep | Pod endpoint 상태 (Identity, policy, health) |
| CiliumEndpointSlice | ces | CiliumEndpoint의 집계 (API server 부하 감소) |
| CiliumIdentity | - | Security Identity (label set → numerical ID) |
| CiliumNode | cn | 노드별 IPAM 상태, 터널링 IP, encryption key |
| CiliumExternalWorkload | cew | VM 등 외부 워크로드 등록 |
| CiliumLocalRedirectPolicy | clrp | 로컬 리다이렉트 정책 (node-local DNS 등) |
| CiliumEgressGatewayPolicy | cegp | Egress Gateway 정책 |
| CiliumBGPPeeringPolicy | bgpp | BGP 피어링 설정 |
| CiliumLoadBalancerIPPool | lbpool | LoadBalancer IP 풀 관리 |
| CiliumNodeConfig | - | 노드별 agent 설정 오버라이드 |

---

## 제3장: 네트워킹 심화

### Identity 기반 네트워킹

Cilium의 보안 모델은 IP 주소가 아닌 **Security Identity**에 기반한다. 이 방식은 Pod이 재스케줄링되어 IP가 변경되더라도 보안 정책이 즉시 적용되는 장점이 있다.

#### Identity 할당 과정

```
1. Pod 생성 → cilium-agent가 Pod의 label 세트를 수집한다
   예: {app=frontend, env=prod, team=platform}

2. Label 세트의 SHA256 해시를 계산한다

3. 동일 해시를 가진 CiliumIdentity CRD가 이미 존재하는지 확인한다
   - 존재: 해당 Identity의 Numerical ID를 재사용한다
   - 미존재: 새로운 CiliumIdentity CRD를 생성하고 Numerical ID를 할당한다

4. Numerical ID(16비트 정수)를 eBPF Map에 기록한다
   - 패킷의 source identity는 eBPF 프로그램이 lookup하여 결정한다

5. 네트워크 정책 평가 시:
   Source Identity + Destination Identity + Port/Protocol → Allow/Deny
```

#### Identity 기반 정책 적용

```
┌──────────────┐      eBPF Datapath       ┌──────────────┐
│  Pod A       │                           │  Pod B       │
│  Identity:   │──── 패킷 전송 ───────────▶│  Identity:   │
│  12345       │                           │  67890       │
│  (frontend)  │                           │  (backend)   │
└──────────────┘                           └──────────────┘
                        │
                        ▼
              ┌─────────────────┐
              │  eBPF Policy Map │
              │                  │
              │  src=12345       │
              │  dst=67890       │
              │  port=8080/TCP   │
              │  → ALLOW         │
              └─────────────────┘
```

이 방식의 핵심 이점은 다음과 같다:

- **IP 무관**: Pod IP가 변경되어도 label이 동일하면 동일 Identity가 부여된다
- **O(1) 정책 평가**: eBPF Hash Map lookup으로 정책을 평가하므로 정책 수에 영향을 받지 않는다
- **클러스터 간 공유**: Cluster Mesh 환경에서 Identity를 클러스터 간에 공유할 수 있다

#### 예약된 Identity

Cilium은 특수 목적의 예약된 Identity를 사용한다:

| Identity ID | 이름 | 설명 |
|-------------|------|------|
| 1 | `host` | 노드 자체 (호스트 네트워크) |
| 2 | `world` | 클러스터 외부의 모든 엔티티 |
| 3 | `unmanaged` | Cilium이 관리하지 않는 Endpoint |
| 4 | `health` | Cilium health check Endpoint |
| 5 | `init` | 아직 Identity가 결정되지 않은 Endpoint (부팅 중) |
| 6 | `remote-node` | 다른 노드의 호스트 네트워크 |
| 8 | `kube-apiserver` | Kubernetes API server |

#### Identity 범위

| 범위 | 숫자 대역 | 설명 |
|------|-----------|------|
| Reserved | 1~15 | 예약된 시스템 Identity |
| Cluster-local | 16~65535 | 클러스터 내 자동 할당 |
| Cluster Mesh | 최대 16,777,215 | 클러스터 ID 프리픽스 포함 |
| CIDR Identity | 16,777,216+ | CIDR 기반 정책에서 동적 생성 |

### CIDR 정책과 Identity

CIDR 기반 정책이 적용될 때, Cilium은 CIDR 범위에 대해 특별한 Identity를 생성한다:

```
┌──────────────────────────────────────────────────────────────┐
│  CIDR Identity 생성 과정                                      │
│                                                              │
│  CiliumNetworkPolicy:                                        │
│    egress:                                                   │
│      - toCIDR: ["203.0.113.0/24"]                           │
│                                                              │
│  Cilium 동작:                                                │
│  1. 203.0.113.0/24 에 대한 CIDR Identity를 생성한다          │
│  2. ipcache Map에 이 CIDR → Identity 매핑을 추가한다        │
│  3. 정책 Map에 이 Identity에 대한 Allow 규칙을 삽입한다     │
│  4. 패킷의 목적지 IP가 203.0.113.0/24 범위이면:            │
│     ipcache LPM Trie lookup → CIDR Identity 획득            │
│     → Policy Map에서 Allow/Deny 판정                        │
│                                                              │
│  LPM Trie 동작:                                              │
│  - Longest Prefix Match로 가장 구체적인 CIDR 매칭           │
│  - 예: 203.0.113.5 → /32 매칭 > /24 매칭 > /16 매칭        │
└──────────────────────────────────────────────────────────────┘
```

### Endpoint Management

Endpoint는 Cilium이 관리하는 네트워크 엔드포인트이다. 각 Pod는 하나의 Endpoint에 대응된다.

```
┌──────────────────────────────────────────────────────────────┐
│  Endpoint 생명주기                                            │
│                                                              │
│  1. Pod 생성 → kubelet이 CNI ADD 호출                        │
│       │                                                      │
│  2. cilium-cni → cilium-agent에 Endpoint 생성 요청          │
│       │                                                      │
│  3. Endpoint 초기화                                          │
│     ├── veth pair 생성                                       │
│     ├── IP 할당 (IPAM)                                       │
│     ├── Security Identity 결정 (label → Identity)           │
│     └── 상태: "restoring" → "waiting-for-identity"          │
│       │                                                      │
│  4. eBPF 프로그램 생성 (Regeneration)                        │
│     ├── 정책을 eBPF C 코드로 변환                           │
│     ├── Clang/LLVM으로 컴파일                                │
│     ├── TC hook에 부착                                       │
│     └── 상태: "regenerating" → "ready"                      │
│       │                                                      │
│  5. 정상 운영                                                │
│     ├── 정책 변경 시 → Regeneration 재실행                   │
│     ├── Identity 변경 시 → 정책 재평가 + Regeneration       │
│     └── 상태: "ready"                                        │
│       │                                                      │
│  6. Pod 삭제 → CNI DEL → Endpoint 정리                      │
│     ├── eBPF 프로그램 분리                                   │
│     ├── IP 반환                                              │
│     ├── veth pair 삭제                                       │
│     └── CiliumEndpoint CRD 삭제                              │
└──────────────────────────────────────────────────────────────┘
```

### IPAM 모드 상세

Cilium은 Pod에 IP 주소를 할당하는 여러 IPAM 모드를 지원한다:

| 모드 | 설명 | 적합한 환경 |
|------|------|-------------|
| `cluster-pool` | cilium-operator가 노드별 PodCIDR을 할당한다. Cilium 자체적으로 IP 풀을 관리한다 | 대부분의 온프레미스/베어메탈 환경 (본 프로젝트에서 사용) |
| `kubernetes` | Kubernetes가 할당한 Node의 `spec.podCIDR`을 사용한다. 기존 Kubernetes IPAM과 호환된다 | kube-controller-manager IPAM 유지 시 |
| `multi-pool` | 여러 IP 풀을 정의하고 Pod annotation으로 선택한다 | 서로 다른 네트워크 대역이 필요한 경우 |
| `azure` | Azure IPAM과 통합하여 VNet IP를 직접 할당한다 | AKS (Azure) |
| `eni` | AWS ENI(Elastic Network Interface)에서 IP를 할당한다. VPC native routing이 가능하다 | EKS (AWS) |
| `crd` | CiliumNode CRD를 통해 외부 시스템이 IP를 관리한다 | 커스텀 IPAM 통합 시 |

본 프로젝트(`cilium-values.yaml`)에서는 `cluster-pool` 모드를 사용하며, `clusterPoolIPv4PodCIDRList`는 클러스터별로 override하여 설정한다.

#### cluster-pool IPAM 동작 상세

```
┌──────────────────────────────────────────────────────────────┐
│  cluster-pool IPAM 동작 과정                                  │
│                                                              │
│  cilium-operator                                             │
│  ├── clusterPoolIPv4PodCIDRList에서 전체 CIDR 범위 관리      │
│  ├── 새 노드 등록 시 → CiliumNode CRD에 PodCIDR 할당       │
│  │   예: Node A → 10.0.1.0/24, Node B → 10.0.2.0/24        │
│  └── 노드 삭제 시 → PodCIDR 회수                            │
│                                                              │
│  cilium-agent (각 노드)                                      │
│  ├── CiliumNode CRD에서 할당받은 PodCIDR 확인               │
│  ├── Pod 생성 시 → 해당 CIDR에서 미사용 IP 할당             │
│  ├── Pod 삭제 시 → IP 반환 (재사용 가능)                    │
│  └── IP 고갈 시 → operator에게 추가 CIDR 블록 요청          │
│                                                              │
│  본 프로젝트 설정:                                           │
│  ipam:                                                       │
│    mode: cluster-pool                                        │
│    operator:                                                 │
│      clusterPoolIPv4PodCIDRList: []  # 클러스터별 override   │
└──────────────────────────────────────────────────────────────┘
```

#### AWS ENI IPAM 모드 (참고)

```
┌──────────────────────────────────────────────────────────────┐
│  AWS ENI IPAM 동작                                            │
│                                                              │
│  1. cilium-operator가 AWS API를 호출하여 ENI를 생성한다      │
│  2. ENI에 Secondary IP를 할당한다                            │
│  3. 각 Secondary IP가 Pod IP로 사용된다                      │
│  4. VPC 라우팅 테이블에 자동 등록 → 네이티브 라우팅          │
│                                                              │
│  장점:                                                        │
│  - Overlay(VXLAN/Geneve) 불필요                              │
│  - VPC 수준의 보안 그룹 적용 가능                            │
│  - 네이티브 성능 (encapsulation 오버헤드 없음)               │
│                                                              │
│  단점:                                                        │
│  - ENI당 IP 수 제한 (인스턴스 타입별 상이)                   │
│  - IP 사전 할당(pre-allocation) 필요 → 리소스 낭비 가능     │
└──────────────────────────────────────────────────────────────┘
```

---

