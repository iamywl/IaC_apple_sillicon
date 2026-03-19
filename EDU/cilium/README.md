# Cilium - eBPF 기반 CNI

## 개념

### Cilium이란?

Cilium은 eBPF(extended Berkeley Packet Filter) 기반의 Kubernetes CNI(Container Network Interface) 플러그인이다. CNCF Graduated 프로젝트로서, Linux 커널 내부에서 네트워킹, 보안, Observability를 처리한다. kube-proxy를 완전히 대체할 수 있으며, L3/L4/L7 네트워크 정책, 투명 암호화, 멀티 클러스터 연결 등 광범위한 기능을 제공한다.

핵심 설계 원칙은 다음과 같다:

- **커널 레벨 처리**: 패킷이 userspace를 거치지 않고 커널 내 eBPF 프로그램에서 직접 처리되어 높은 성능을 보장한다
- **Identity 기반 보안**: IP 주소가 아닌 Kubernetes label 기반의 Security Identity로 네트워크 정책을 적용한다
- **API-Aware**: HTTP, gRPC, Kafka 등 L7 프로토콜 수준의 가시성과 정책 제어를 지원한다

---

## eBPF 내부 구조

### eBPF란?

eBPF(extended Berkeley Packet Filter)는 Linux 커널 내부에서 샌드박스화된 프로그램을 실행하는 기술이다. 커널 소스 코드를 수정하거나 커널 모듈을 로드하지 않고도 커널의 동작을 확장할 수 있다. 원래 패킷 필터링 목적으로 만들어진 cBPF(classic BPF)에서 발전하여, 현재는 네트워킹, 보안, 트레이싱, 프로파일링 등 범용적인 커널 프로그래밍 프레임워크로 자리잡았다.

### eBPF 프로그램 로딩 과정

eBPF 프로그램이 커널에 로드되는 과정은 다음과 같다:

```
┌──────────────────────────────────────────────────────────────────┐
│  1. C 코드 작성 → Clang/LLVM으로 eBPF 바이트코드 컴파일          │
│                        │                                         │
│  2. bpf() 시스템 콜 → 커널에 프로그램 로드 요청                   │
│                        │                                         │
│  3. Verifier 검증                                                │
│     - 무한 루프 없음 확인 (DAG 분석)                              │
│     - 메모리 접근 범위 검증 (out-of-bounds 방지)                  │
│     - 모든 실행 경로가 반환값을 갖는지 확인                       │
│     - 권한 없는 메모리 접근 차단                                  │
│                        │                                         │
│  4. JIT Compilation                                              │
│     - eBPF 바이트코드를 네이티브 머신코드(x86_64, ARM64 등)로     │
│       변환한다                                                    │
│     - 네이티브 코드와 동등한 실행 속도를 달성한다                 │
│                        │                                         │
│  5. Hook 지점에 프로그램 부착                                     │
│     - XDP (네트워크 드라이버 레벨, 가장 빠름)                     │
│     - TC (Traffic Control, ingress/egress)                       │
│     - Socket (connect, sendmsg 등)                               │
│     - cgroup (프로세스 그룹 단위)                                 │
└──────────────────────────────────────────────────────────────────┘
```

### eBPF Maps

eBPF Map은 커널 공간과 유저 공간 사이, 또는 eBPF 프로그램 간에 데이터를 공유하는 자료구조이다. Cilium은 다양한 Map 타입을 활용한다:

| Map 타입 | 용도 | Cilium 활용 |
|----------|------|-------------|
| Hash Map | key-value 저장 | Service endpoint 매핑, conntrack 테이블 |
| Array Map | 인덱스 기반 접근 | 설정값, 통계 카운터 |
| LRU Hash | 자동 만료 | Connection tracking |
| LPM Trie | Longest Prefix Match | CIDR 기반 정책 매칭 |
| Ring Buffer | 이벤트 스트리밍 | Hubble 이벤트 전달 |

### Verifier의 역할

Verifier는 eBPF 프로그램의 안전성을 보장하는 핵심 컴포넌트이다. 프로그램이 커널에 로드되기 전에 정적 분석을 수행하여, 커널을 crash시키거나 보안을 위협하는 프로그램의 로드를 차단한다. 검증 항목은 다음과 같다:

- **프로그램 크기 제한**: 명령어 수 상한(커널 5.2+ 기준 100만 개)을 초과하면 거부한다
- **루프 검증**: bounded loop만 허용한다 (커널 5.3+에서 bounded loop 지원 추가)
- **메모리 안전성**: 스택 크기(512바이트)를 초과하거나 범위 밖 메모리에 접근하면 거부한다
- **Helper 함수 권한**: 프로그램 타입에 따라 호출 가능한 Helper 함수를 제한한다

---

## Cilium 아키텍처

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

### cilium-agent (DaemonSet)

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

### cilium-operator (Deployment)

cilium-operator는 클러스터 전역 작업을 담당하는 컴포넌트이다. 각 노드의 cilium-agent가 처리할 수 없는 클러스터 수준의 관리 작업을 수행한다:

- **IPAM 관리**: cluster-pool 모드에서 노드별 PodCIDR 블록을 할당한다. CiliumNode CRD를 통해 각 노드의 IP 풀 상태를 추적한다
- **CiliumIdentity Garbage Collection**: 더 이상 사용되지 않는 Security Identity 리소스를 정리한다
- **CiliumEndpointSlice(CES) 관리**: 대규모 클러스터에서 CiliumEndpoint 리소스를 CES로 집계하여 API server 부하를 줄인다
- **CRD 등록**: Cilium이 사용하는 CustomResourceDefinition을 Kubernetes에 등록한다

### 데이터 저장 백엔드

Cilium의 상태 정보 저장에는 두 가지 백엔드 옵션이 있다:

| 백엔드 | 설명 | 적합한 환경 |
|--------|------|-------------|
| CRD (기본값) | Kubernetes CRD로 상태를 저장한다. 별도 인프라가 필요 없다 | 대부분의 환경 |
| etcd (외부) | 전용 etcd 클러스터에 상태를 저장한다. 대규모 클러스터에서 kube-apiserver 부하를 줄인다 | 1,000+ 노드 |

---

## kube-proxy 대체 원리

### iptables 기반 kube-proxy의 한계

기존 kube-proxy는 iptables 규칙으로 Service를 구현한다. 이 방식에는 구조적 한계가 있다:

- **O(n) 규칙 매칭**: iptables는 순차적으로 규칙을 매칭하므로, Service/Endpoint 수에 비례하여 지연이 증가한다
- **규칙 업데이트 비용**: Service가 변경되면 전체 iptables 규칙 체인을 재작성한다. 대규모 클러스터에서 수 초가 소요될 수 있다
- **Conntrack 경합**: iptables의 conntrack 모듈이 높은 동시 연결에서 race condition을 일으킬 수 있다
- **제한된 로드밸런싱**: 확률 기반(random) 분배만 가능하며, Least Connection 등 고급 알고리즘을 지원하지 않는다

### Cilium의 eBPF 기반 서비스 로드밸런싱

Cilium은 eBPF를 사용하여 kube-proxy의 모든 기능을 대체한다:

```
┌─────────────────────────────────────────────────────────────────┐
│  kube-proxy (iptables):                                         │
│                                                                  │
│  App → socket → TCP/IP stack → iptables(PREROUTING) →           │
│        conntrack → iptables(FORWARD) → routing →                │
│        iptables(POSTROUTING) → NIC                              │
│                                                                  │
│  문제: 모든 패킷이 iptables 규칙 체인을 순회한다                │
├─────────────────────────────────────────────────────────────────┤
│  Cilium Socket-Level LB:                                        │
│                                                                  │
│  App → connect() 시스템콜 시점에 eBPF가 개입 →                  │
│        Service ClusterIP를 Backend Pod IP로 직접 변환 →         │
│        TCP/IP stack → NIC                                       │
│                                                                  │
│  장점: TCP/IP 스택 진입 전에 변환이 완료된다.                    │
│        NAT가 발생하지 않으므로 conntrack 항목이 불필요하다       │
├─────────────────────────────────────────────────────────────────┤
│  Cilium XDP LB (NodePort/LoadBalancer 외부 트래픽):             │
│                                                                  │
│  NIC → XDP (드라이버 레벨) → 즉시 DNAT 수행 →                  │
│        TCP/IP stack → Pod                                       │
│                                                                  │
│  장점: 패킷이 커널 네트워크 스택에 진입하기 전에 처리된다.      │
│        NodePort 트래픽의 지연시간을 최소화한다                   │
└─────────────────────────────────────────────────────────────────┘
```

### Socket-Level LB vs XDP LB

| 구분 | Socket-Level LB | XDP LB |
|------|-----------------|--------|
| Hook 지점 | connect(), sendmsg() 시스템콜 | NIC 드라이버 (ingress) |
| 대상 트래픽 | Pod에서 나가는 ClusterIP 트래픽 | 외부에서 들어오는 NodePort/LB 트래픽 |
| NAT 필요 여부 | 불필요 (connect 시 직접 주소 변환) | DNAT 수행 |
| 성능 특성 | conntrack-free, 매우 낮은 지연 | sk_buff 할당 전 처리, 최고 throughput |

### Connection Tracking (Conntrack)

Cilium은 자체 eBPF 기반 conntrack 테이블을 유지한다. 커널의 nf_conntrack 모듈 대신 eBPF Hash Map을 사용하므로 다음과 같은 이점이 있다:

- eBPF Map의 lookup은 O(1)이다
- 각 CPU 코어별로 독립적인 Map을 운영하여 lock contention을 줄인다
- Socket-Level LB를 사용하는 East-West 트래픽은 conntrack 자체가 불필요하다

### NAT 처리

- **East-West (Pod-to-Pod via Service)**: Socket-Level LB를 사용하면 connect() 시스템콜 시점에 목적지 IP가 변환되므로, TCP 레벨에서는 NAT가 발생하지 않는다. 애플리케이션 관점에서는 직접 Backend Pod에 연결하는 것과 동일하다
- **North-South (외부 → NodePort/LB)**: XDP 또는 TC hook에서 DNAT를 수행한다. 응답 패킷은 eBPF conntrack을 참조하여 reverse SNAT를 적용한다

---

## IPAM (IP Address Management) 모드

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

---

## Security Identity 시스템

### Identity 할당 원리

Cilium의 보안 모델은 IP 주소가 아닌 **Security Identity**에 기반한다. 이 방식은 Pod이 재스케줄링되어 IP가 변경되더라도 보안 정책이 즉시 적용되는 장점이 있다.

Identity 할당 과정은 다음과 같다:

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

### Identity 기반 정책 적용

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

### 예약된 Identity

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

---

## Datapath 모드

Cilium은 노드 간 Pod 트래픽을 전달하는 두 가지 Datapath 모드를 지원한다:

### Encapsulation 모드 (기본값)

```
Node A                                    Node B
┌──────────────┐                         ┌──────────────┐
│ Pod (10.0.1.5)│                         │ Pod (10.0.2.8)│
│       │       │                         │       ▲       │
│   eBPF TC     │                         │   eBPF TC     │
│       │       │                         │       │       │
│   VXLAN/Geneve│                         │   VXLAN/Geneve│
│   Encap       │  ──── 터널링 ────────▶  │   Decap       │
│  (outer IP:   │                         │               │
│   192.168.1.1)│                         │ (192.168.1.2) │
└──────────────┘                         └──────────────┘
```

- **VXLAN**: 표준적인 overlay 프로토콜이다. UDP 포트 8472를 사용한다. 대부분의 네트워크 환경에서 동작한다
- **Geneve**: VXLAN의 후속 프로토콜로, 가변 길이 메타데이터를 지원한다. OVN/OVS 환경과 호환성이 좋다
- 장점: 하부 네트워크 구성 변경 없이 동작한다. Pod CIDR 라우팅을 네트워크 장비에 설정할 필요가 없다
- 단점: encapsulation 오버헤드(약 50바이트)로 인해 MTU가 줄어들고 약간의 CPU 오버헤드가 발생한다

### Direct Routing 모드 (Native Routing)

```
Node A                                    Node B
┌──────────────┐                         ┌──────────────┐
│ Pod (10.0.1.5)│                         │ Pod (10.0.2.8)│
│       │       │                         │       ▲       │
│   eBPF TC     │                         │   eBPF TC     │
│       │       │                         │       │       │
│   Linux       │  ──── 직접 라우팅 ───▶  │   Linux       │
│   Routing     │  (BGP 또는 static       │   Routing     │
│               │   route 필요)           │               │
└──────────────┘                         └──────────────┘
```

- Pod 패킷이 encapsulation 없이 원본 IP 헤더 그대로 전달된다
- 하부 네트워크가 Pod CIDR에 대한 라우팅을 알아야 한다 (BGP, 클라우드 VPC 라우팅 등)
- 장점: MTU 손실이 없고 오버헤드가 최소이다. 클라우드 환경(AWS ENI, GCE 등)에서 최적이다
- 단점: 네트워크 인프라 설정이 필요하다

---

## 추가 기능

### Bandwidth Manager

eBPF 기반의 Pod 대역폭 제어 기능이다. 기존 Linux tc의 rate limiting을 대체한다:

- EDT(Earliest Departure Time) 기반으로 패킷 전송 시점을 제어한다
- Pod annotation(`kubernetes.io/egress-bandwidth`)으로 대역폭을 설정한다
- BBR 혼잡 제어 알고리즘과 통합하여 효율적인 대역폭 활용이 가능하다

```yaml
apiVersion: v1
kind: Pod
metadata:
  annotations:
    kubernetes.io/egress-bandwidth: "10M"  # 10Mbps 제한
```

### Host Firewall

노드(호스트) 자체에 대한 네트워크 정책을 적용한다. CiliumClusterwideNetworkPolicy의 `nodeSelector`를 사용하여 노드 레벨의 ingress/egress 트래픽을 제어한다:

```yaml
apiVersion: cilium.io/v2
kind: CiliumClusterwideNetworkPolicy
metadata:
  name: host-firewall
spec:
  nodeSelector:
    matchLabels:
      role: worker
  ingress:
    - fromCIDR:
        - "10.0.0.0/8"
      toPorts:
        - ports:
            - port: "22"
              protocol: TCP
```

### Egress Gateway

특정 Pod의 외부 트래픽을 지정된 노드를 통해 고정 IP로 나가도록 한다. 외부 방화벽 규칙이 고정 IP를 요구하는 환경에 유용하다:

```yaml
apiVersion: cilium.io/v2
kind: CiliumEgressGatewayPolicy
metadata:
  name: egress-db
spec:
  selectors:
    - podSelector:
        matchLabels:
          app: backend
  destinationCIDRs:
    - "203.0.113.0/24"       # 외부 DB 대역
  egressGateway:
    nodeSelector:
      matchLabels:
        egress-gw: "true"
    egressIP: "198.51.100.10"  # 고정 SNAT IP
```

### Cluster Mesh

여러 Kubernetes 클러스터를 하나의 네트워크 평면으로 연결한다:

- 클러스터 간 Pod-to-Pod 직접 통신이 가능하다
- Global Service를 정의하여 멀티 클러스터 서비스 디스커버리를 지원한다
- 클러스터 간 Security Identity를 공유하여 통합 네트워크 정책을 적용한다
- 각 클러스터의 cilium-agent가 다른 클러스터의 etcd(또는 clustermesh-apiserver)에 연결하여 상태를 동기화한다

### Service Mesh (Sidecar-less)

Cilium은 사이드카 없이 Service Mesh 기능을 제공한다. 기존 Istio/Linkerd와 달리 Pod마다 sidecar proxy를 주입하지 않는다:

```
기존 Service Mesh (Istio):
  App Container ←→ Sidecar (Envoy) ←→ Network ←→ Sidecar (Envoy) ←→ App Container
  (Pod 당 Envoy 1개, 메모리/CPU 오버헤드)

Cilium Service Mesh:
  App Container ←→ eBPF (커널) ←→ Network ←→ eBPF (커널) ←→ App Container
  (L4: eBPF로 직접 처리)
  (L7 필요 시: 노드당 1개의 공유 Envoy 인스턴스 사용)
```

주요 기능:
- **mTLS**: WireGuard 또는 IPsec 기반의 투명 암호화로 Pod 간 트래픽을 암호화한다. SPIFFE identity를 지원한다
- **Traffic Management**: CiliumEnvoyConfig CRD를 통해 L7 트래픽 라우팅, 가중치 기반 분배 등을 설정한다
- **Observability**: Hubble을 통해 L3/L4/L7 수준의 네트워크 플로우를 실시간 모니터링한다

---

## 핵심 개념 요약

| 개념 | 설명 |
|------|------|
| eBPF | 커널 내부에서 샌드박스 프로그램을 실행하는 기술이다. Verifier가 안전성을 보장하고 JIT가 네이티브 코드로 변환한다 |
| CNI | Kubernetes Pod 네트워크를 구성하는 표준 인터페이스이다 |
| kube-proxy 대체 | iptables 대신 eBPF(Socket-Level LB, XDP)로 서비스 로드밸런싱을 수행한다 |
| CiliumNetworkPolicy | Kubernetes NetworkPolicy를 확장한 L7 지원 정책이다. FQDN, CIDR 기반 egress 제어도 가능하다 |
| Security Identity | IP가 아닌 Pod label 기반의 Numerical ID로 보안 정책을 적용한다 |
| Endpoint | Cilium이 관리하는 네트워크 엔드포인트(Pod)이다. 각 Endpoint에 Identity가 할당된다 |
| Hubble | Cilium의 네트워크 Observability 플랫폼이다. eBPF를 통해 모든 네트워크 플로우를 수집한다 |
| Cluster Mesh | 여러 Kubernetes 클러스터를 하나의 네트워크로 연결하는 멀티 클러스터 솔루션이다 |

---

### 이 프로젝트에서의 실습 환경

이 프로젝트에서 Cilium은 모든 4개 클러스터의 CNI로 사용된다.

- 설치 스크립트: `scripts/install/06-install-cilium.sh`
- Helm values: `manifests/cilium-values.yaml`
- kubeProxyReplacement: `true` (kube-proxy 완전 대체)
- IPAM 모드: cluster-pool
- 네트워크 정책: `manifests/network-policies/` 디렉토리에 11개 정책 정의
- 실습 대상 클러스터: dev (`kubeconfig/dev.yaml`)

```bash
# dev 클러스터에서 Cilium 상태 확인
export KUBECONFIG=kubeconfig/dev.yaml
cilium status
kubectl get ciliumnetworkpolicies -n demo
```

## 실습

### 실습 1: Cilium 상태 확인

```bash
# Cilium CLI 설치
brew install cilium-cli

# Cilium 상태 확인
cilium status

# Cilium 연결 테스트 (전체 기능 검증, 약 5~10분 소요)
cilium connectivity test

# Cilium 에이전트 목록
kubectl -n kube-system get pods -l k8s-app=cilium

# Cilium 버전 확인
cilium version

# Cilium 설정 확인 (ConfigMap)
kubectl -n kube-system get configmap cilium-config -o yaml
```

### 실습 2: Cilium Endpoint 및 Identity 확인

```bash
# 모든 Endpoint 목록 (Identity ID 포함)
kubectl -n kube-system exec -it ds/cilium -- cilium endpoint list

# 특정 Pod의 Endpoint 상세 정보
kubectl -n kube-system exec -it ds/cilium -- cilium endpoint get <endpoint-id>

# Security Identity 목록 확인
kubectl get ciliumidentities

# 특정 Identity의 label 확인
kubectl get ciliumidentity <identity-id> -o yaml

# Identity가 어떤 Endpoint에 할당되었는지 확인
kubectl -n kube-system exec -it ds/cilium -- cilium identity list
```

### 실습 3: eBPF Map 및 서비스 확인

```bash
# eBPF 기반 Service 로드밸런서 테이블 확인
kubectl -n kube-system exec -it ds/cilium -- cilium bpf lb list

# Conntrack 테이블 확인
kubectl -n kube-system exec -it ds/cilium -- cilium bpf ct list global

# NAT 테이블 확인
kubectl -n kube-system exec -it ds/cilium -- cilium bpf nat list

# Policy Map 확인 (Identity 기반 Allow/Deny)
kubectl -n kube-system exec -it ds/cilium -- cilium bpf policy get --all

# eBPF Map 메모리 사용량 확인
kubectl -n kube-system exec -it ds/cilium -- cilium bpf map list
```

### 실습 4: CiliumNetworkPolicy 적용

```bash
# 기본 Deny 정책 적용
kubectl apply -f - <<EOF
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: default-deny
  namespace: default
spec:
  endpointSelector: {}
  ingress: []
  egress: []
EOF

# 정책 적용 상태 확인
kubectl get cnp -A

# 정책이 실제로 eBPF에 반영되었는지 확인
kubectl -n kube-system exec -it ds/cilium -- cilium endpoint list
# → "policy-enabled" 컬럼이 "Ingress, Egress"로 표시되는지 확인

# 정책 삭제
kubectl delete cnp default-deny -n default
```

### 실습 5: 프로젝트의 Cilium 설정 분석

```bash
# Helm values 확인
cat ../../manifests/cilium-values.yaml

# kube-proxy 대체 설정 확인
grep -A 5 "kubeProxyReplacement" ../../manifests/cilium-values.yaml

# IPAM 모드 확인
grep -A 5 "ipam" ../../manifests/cilium-values.yaml
```

### 실습 6: Hubble을 통한 네트워크 플로우 관찰

```bash
# Hubble CLI 설치
brew install hubble

# Hubble 상태 확인
hubble status

# 실시간 네트워크 플로우 관찰
hubble observe

# 특정 네임스페이스의 플로우 필터링
hubble observe --namespace default

# 특정 Pod의 트래픽 모니터링
hubble observe --pod default/frontend-xxxx

# Drop된 패킷만 확인 (정책 위반 트래픽)
hubble observe --verdict DROPPED

# L7 HTTP 플로우 확인
hubble observe --protocol http

# JSON 형식으로 출력 (스크립트 연동 시)
hubble observe --output json
```

---

## 예제

### 예제 1: L3/L4 네트워크 정책

```yaml
# l4-policy.yaml
# 특정 네임스페이스에서 오는 트래픽만 허용한다
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: allow-frontend-to-backend
  namespace: demo
spec:
  endpointSelector:
    matchLabels:
      app: backend
  ingress:
    - fromEndpoints:
        - matchLabels:
            app: frontend
      toPorts:
        - ports:
            - port: "8080"
              protocol: TCP
```

### 예제 2: L7 HTTP 정책

```yaml
# l7-policy.yaml
# GET 메서드와 특정 경로만 허용하는 L7 정책이다
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: l7-http-policy
  namespace: demo
spec:
  endpointSelector:
    matchLabels:
      app: api-server
  ingress:
    - fromEndpoints:
        - matchLabels:
            app: frontend
      toPorts:
        - ports:
            - port: "80"
              protocol: TCP
          rules:
            http:
              - method: GET
                path: "/api/.*"
```

### 예제 3: FQDN 기반 Egress 정책

```yaml
# fqdn-egress.yaml
# 특정 도메인으로의 외부 트래픽만 허용한다
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: allow-external-api
  namespace: demo
spec:
  endpointSelector:
    matchLabels:
      app: backend
  egress:
    - toEndpoints:
        - matchLabels:
            k8s:io.kubernetes.pod.namespace: kube-system
            k8s-app: kube-dns
      toPorts:
        - ports:
            - port: "53"
              protocol: ANY
          rules:
            dns:
              - matchPattern: "*"
    - toFQDNs:
        - matchName: "api.external-service.com"
      toPorts:
        - ports:
            - port: "443"
              protocol: TCP
```

### 예제 4: 제로 트러스트 네트워크 구성

```yaml
# zero-trust.yaml
# 1단계: 모든 트래픽을 차단한다
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: deny-all
  namespace: production
spec:
  endpointSelector: {}
  ingress: []
  egress: []
---
# 2단계: DNS 조회를 허용한다 (기본 인프라 통신)
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: allow-dns
  namespace: production
spec:
  endpointSelector: {}
  egress:
    - toEndpoints:
        - matchLabels:
            k8s:io.kubernetes.pod.namespace: kube-system
            k8s-app: kube-dns
      toPorts:
        - ports:
            - port: "53"
              protocol: UDP
---
# 3단계: 서비스 간 필요한 통신만 명시적으로 허용한다
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: allow-frontend-to-api
  namespace: production
spec:
  endpointSelector:
    matchLabels:
      app: api
  ingress:
    - fromEndpoints:
        - matchLabels:
            app: frontend
      toPorts:
        - ports:
            - port: "8080"
              protocol: TCP
```

### 예제 5: CiliumClusterwideNetworkPolicy (클러스터 전역 정책)

```yaml
# cluster-wide-policy.yaml
# 모든 네임스페이스에 적용되는 기본 egress 정책이다
apiVersion: cilium.io/v2
kind: CiliumClusterwideNetworkPolicy
metadata:
  name: default-external-lockdown
spec:
  endpointSelector:
    matchExpressions:
      - key: k8s:io.kubernetes.pod.namespace
        operator: NotIn
        values:
          - kube-system
  egress:
    - toEndpoints:
        - {}       # 클러스터 내부 통신 허용
    - toEntities:
        - kube-apiserver  # API server 통신 허용
    - toCIDR:
        - "10.0.0.0/8"   # 내부 네트워크 허용
  egressDeny:
    - toCIDR:
        - "0.0.0.0/0"    # 나머지 외부 통신 차단
```

---

## 디버깅 시나리오

### 시나리오 1: Pod 간 통신이 안 되는 경우

```bash
# 1. Cilium agent 상태 확인
cilium status

# 2. 양쪽 Pod의 Endpoint 상태 확인
kubectl -n kube-system exec -it ds/cilium -- cilium endpoint list
# → "ready" 상태인지 확인한다. "not-ready"이면 eBPF 프로그램 로드 실패 가능성이 있다

# 3. 정책으로 인한 Drop 확인
hubble observe --pod <source-pod> --verdict DROPPED
# → DROPPED 이벤트가 있으면 어떤 정책이 차단했는지 확인한다

# 4. cilium monitor로 실시간 패킷 추적
kubectl -n kube-system exec -it ds/cilium -- cilium monitor --type drop
# → drop reason이 표시된다 (예: POLICY_DENIED, CT_NO_MAP_FOUND 등)

# 5. 특정 Endpoint의 정책 상태 확인
kubectl -n kube-system exec -it ds/cilium -- cilium endpoint get <id> -o json | jq '.status.policy'
```

### 시나리오 2: Service 접근이 안 되는 경우

```bash
# 1. Service가 eBPF LB 테이블에 등록되었는지 확인
kubectl -n kube-system exec -it ds/cilium -- cilium bpf lb list | grep <service-clusterip>

# 2. Backend Pod가 등록되었는지 확인
kubectl -n kube-system exec -it ds/cilium -- cilium service list

# 3. Conntrack 테이블에서 연결 상태 확인
kubectl -n kube-system exec -it ds/cilium -- cilium bpf ct list global | grep <service-ip>

# 4. kube-proxy 대체 모드가 정상인지 확인
kubectl -n kube-system exec -it ds/cilium -- cilium status | grep KubeProxyReplacement
# → "True" 또는 "Strict"여야 한다

# 5. Service 동기화 상태 확인
kubectl -n kube-system exec -it ds/cilium -- cilium service list | wc -l
kubectl get svc --all-namespaces | wc -l
# → 두 수치가 대략 일치해야 한다 (headless service 등 제외)
```

### 시나리오 3: DNS 기반 정책이 동작하지 않는 경우

```bash
# 1. DNS proxy 상태 확인
kubectl -n kube-system exec -it ds/cilium -- cilium status | grep DNS

# 2. FQDN 캐시 확인
kubectl -n kube-system exec -it ds/cilium -- cilium fqdn cache list

# 3. DNS 조회 허용 정책이 있는지 확인 (port 53 egress)
kubectl get cnp -A -o yaml | grep -A 10 "port.*53"

# 4. DNS proxy 로그 확인
kubectl -n kube-system exec -it ds/cilium -- cilium monitor --type l7 --related-to <endpoint-id>
```

### 시나리오 4: cilium-agent가 NotReady인 경우

```bash
# 1. Pod 로그 확인
kubectl -n kube-system logs ds/cilium --tail=100

# 2. cilium-agent 내부 상태 확인
kubectl -n kube-system exec -it ds/cilium -- cilium status --verbose

# 3. eBPF 프로그램 로드 상태 확인
kubectl -n kube-system exec -it ds/cilium -- cilium bpf prog list

# 4. 커널 버전 호환성 확인 (최소 4.19.57, 권장 5.10+)
kubectl -n kube-system exec -it ds/cilium -- uname -r

# 5. BPF filesystem 마운트 확인
kubectl -n kube-system exec -it ds/cilium -- mount | grep bpf
```

### 시나리오 5: 성능 문제 진단

```bash
# 1. eBPF Map 사용량 확인 (CT 테이블 가득 찬 경우 성능 저하)
kubectl -n kube-system exec -it ds/cilium -- cilium bpf ct list global | wc -l
kubectl -n kube-system exec -it ds/cilium -- cilium status | grep "CT"

# 2. cilium-agent 리소스 사용량 확인
kubectl -n kube-system top pod -l k8s-app=cilium

# 3. Datapath 모드 확인 (VXLAN vs Direct Routing)
kubectl -n kube-system exec -it ds/cilium -- cilium status | grep "Datapath"

# 4. eBPF 프로그램 실행 통계 확인
kubectl -n kube-system exec -it ds/cilium -- cilium bpf prog list

# 5. Metrics 확인 (Prometheus 형식)
kubectl -n kube-system exec -it ds/cilium -- cilium metrics list | grep -E "drop|forward|policy"
```

---

## 자가 점검

- [ ] eBPF가 무엇이고, Verifier와 JIT의 역할을 설명할 수 있는가?
- [ ] eBPF Map의 종류와 Cilium에서의 활용 방식을 설명할 수 있는가?
- [ ] cilium-agent, cilium-operator, Envoy의 역할을 각각 설명할 수 있는가?
- [ ] Cilium이 kube-proxy를 대체하는 원리(Socket-Level LB, XDP)를 설명할 수 있는가?
- [ ] IPAM 모드(cluster-pool, kubernetes, eni 등)의 차이를 설명할 수 있는가?
- [ ] Security Identity 시스템의 동작 원리를 설명할 수 있는가?
- [ ] Encapsulation(VXLAN, Geneve)과 Direct Routing의 차이를 설명할 수 있는가?
- [ ] CiliumNetworkPolicy와 Kubernetes NetworkPolicy의 차이를 설명할 수 있는가?
- [ ] L3/L4/L7 정책의 차이를 예제와 함께 설명할 수 있는가?
- [ ] FQDN 기반 Egress 정책의 동작 원리를 설명할 수 있는가?
- [ ] Cluster Mesh의 구조와 활용 시나리오를 설명할 수 있는가?
- [ ] Cilium Service Mesh가 기존 sidecar 방식과 어떻게 다른지 설명할 수 있는가?
- [ ] 제로 트러스트 네트워크 모델의 핵심 원칙을 설명할 수 있는가?
- [ ] Cilium 네트워크 문제를 Hubble과 cilium CLI로 디버깅할 수 있는가?

---

## 참고문헌

- [Cilium 공식 문서](https://docs.cilium.io/) - 설치, 설정, 운영에 관한 포괄적인 문서이다
- [Cilium GitHub 저장소](https://github.com/cilium/cilium) - 소스 코드, Issue, Release Note를 확인할 수 있다
- [eBPF.io](https://ebpf.io/) - eBPF 기술에 대한 공식 소개 사이트이다. eBPF 개념, 사용 사례, 생태계를 설명한다
- [Cilium Architecture Guide](https://docs.cilium.io/en/stable/overview/component-overview/) - Cilium 컴포넌트 아키텍처 상세 문서이다
- [Cilium Network Policy Guide](https://docs.cilium.io/en/stable/security/policy/) - 네트워크 정책 작성 가이드이다
- [Cilium Service Mesh](https://docs.cilium.io/en/stable/network/servicemesh/) - Sidecar-less Service Mesh 설정 가이드이다
- [Cilium Cluster Mesh](https://docs.cilium.io/en/stable/network/clustermesh/) - 멀티 클러스터 설정 가이드이다
- [Hubble 문서](https://docs.cilium.io/en/stable/observability/) - 네트워크 Observability 설정 및 사용법이다
- [BPF and XDP Reference Guide](https://docs.cilium.io/en/stable/bpf/) - Cilium의 eBPF/XDP 구현 상세이다
- [Isovalent Blog](https://isovalent.com/blog/) - Cilium 개발사의 기술 블로그이다. 심화 주제와 사용 사례를 다룬다
