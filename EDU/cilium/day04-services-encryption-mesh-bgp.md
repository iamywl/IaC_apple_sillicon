# Day 4: kube-proxy 대체, 암호화, Cluster Mesh, BGP

> kube-proxy를 대체하는 eBPF 기반 Service Load Balancing, WireGuard/IPsec 투명 암호화, Cluster Mesh 멀티 클러스터 연결, BGP Control Plane, Bandwidth Manager를 학습한다.

---

## 제6장: kube-proxy 대체와 Service Load Balancing

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

### Maglev 해싱

Maglev는 Google이 개발한 consistent hashing 알고리즘이다. Cilium은 이를 Service 로드밸런싱에 적용한다.

```
┌──────────────────────────────────────────────────────────────┐
│  Maglev 해싱 동작                                             │
│                                                              │
│  기존 방식 (random):                                         │
│  - Backend 추가/제거 시 기존 연결이 다른 Backend로 재분배    │
│  - 커넥션 유실 발생                                          │
│                                                              │
│  Maglev consistent hashing:                                  │
│  - 해시 테이블 크기: 소수 (기본 65537)                       │
│  - 각 Backend가 테이블의 균등한 영역을 점유                  │
│  - Backend 추가/제거 시 영향받는 연결 최소화                 │
│                                                              │
│  예시 (3개 Backend, 테이블 크기 7):                          │
│  ┌─────┬─────┬─────┬─────┬─────┬─────┬─────┐               │
│  │  B1 │  B2 │  B3 │  B1 │  B3 │  B2 │  B1 │               │
│  └─────┴─────┴─────┴─────┴─────┴─────┴─────┘               │
│    [0]   [1]   [2]   [3]   [4]   [5]   [6]                  │
│                                                              │
│  hash(src_ip, src_port, dst_ip, dst_port) % 7 = 인덱스      │
│  → 해당 인덱스의 Backend로 트래픽 전달                       │
│                                                              │
│  Backend B2 장애 시:                                         │
│  ┌─────┬─────┬─────┬─────┬─────┬─────┬─────┐               │
│  │  B1 │  B3 │  B3 │  B1 │  B3 │  B1 │  B1 │               │
│  └─────┴─────┴─────┴─────┴─────┴─────┴─────┘               │
│  → 인덱스 [1], [5]만 변경, 나머지는 동일 Backend 유지       │
│                                                              │
│  활성화:                                                      │
│  Helm: loadBalancer.algorithm=maglev                         │
│  기본값: random                                               │
└──────────────────────────────────────────────────────────────┘
```

### Session Affinity

Session Affinity(ClientIP 기반)를 eBPF로 구현한다.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: my-service
spec:
  type: ClusterIP
  sessionAffinity: ClientIP
  sessionAffinityConfig:
    clientIP:
      timeoutSeconds: 10800  # 3시간
  ports:
    - port: 80
  selector:
    app: my-app
```

```
eBPF 구현:
1. 첫 연결: hash(clientIP) → Backend 선택 → Affinity Map에 기록
2. 이후 연결: Affinity Map에서 clientIP lookup → 동일 Backend 반환
3. 타임아웃 경과 후 → Affinity Map 엔트리 삭제 → 새로운 Backend 선택
```

### Topology Aware Hints

Topology Aware Hints를 사용하면 같은 zone의 Backend를 우선 선택하여 cross-zone 트래픽을 줄인다.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: my-service
  annotations:
    service.kubernetes.io/topology-mode: Auto
spec:
  ports:
    - port: 80
  selector:
    app: my-app
```

---

## 제7장: Encryption (투명 암호화)

### WireGuard 기반 암호화

Cilium은 WireGuard를 사용하여 노드 간 트래픽을 투명하게 암호화한다.

```
┌──────────────────────────────────────────────────────────────┐
│  WireGuard 투명 암호화 동작                                   │
│                                                              │
│  Node A                              Node B                  │
│  ┌────────────┐                    ┌────────────┐            │
│  │ Pod A      │                    │ Pod B      │            │
│  │ (평문)     │                    │ (평문)     │            │
│  └─────┬──────┘                    └─────▲──────┘            │
│        │                                  │                   │
│  ┌─────▼──────┐                    ┌─────┴──────┐            │
│  │ eBPF TC    │                    │ eBPF TC    │            │
│  │ (정책검사) │                    │ (정책검사) │            │
│  └─────┬──────┘                    └─────▲──────┘            │
│        │                                  │                   │
│  ┌─────▼──────┐                    ┌─────┴──────┐            │
│  │ cilium_wg0 │                    │ cilium_wg0 │            │
│  │ (WireGuard)│                    │ (WireGuard)│            │
│  │ 암호화     │────── 암호문 ─────▶│ 복호화     │            │
│  └─────┬──────┘                    └─────▲──────┘            │
│        │                                  │                   │
│  ┌─────▼──────┐                    ┌─────┴──────┐            │
│  │ eth0 (NIC) │── 물리 네트워크 ──▶│ eth0 (NIC) │            │
│  └────────────┘                    └────────────┘            │
│                                                              │
│  특징:                                                        │
│  - Pod, 애플리케이션 수정 없이 투명하게 암호화               │
│  - ChaCha20-Poly1305 암호화 알고리즘 (커널 내장)             │
│  - 각 노드가 WireGuard 키 쌍을 자동 생성                     │
│  - CiliumNode CRD를 통해 공개키를 클러스터에 배포            │
│  - 약 5~10% CPU 오버헤드 (하드웨어 가속 시 더 낮음)         │
│                                                              │
│  활성화:                                                      │
│  Helm: encryption.enabled=true, encryption.type=wireguard    │
└──────────────────────────────────────────────────────────────┘
```

### IPsec 기반 암호화

```
┌──────────────────────────────────────────────────────────────┐
│  IPsec 암호화                                                 │
│                                                              │
│  동작 방식:                                                   │
│  - ESP(Encapsulating Security Payload) 모드 사용             │
│  - 커널의 XFRM 프레임워크 활용                               │
│  - AES-GCM-128/256 암호화                                    │
│                                                              │
│  키 관리:                                                     │
│  - Kubernetes Secret으로 PSK(Pre-Shared Key) 관리            │
│  - cilium-agent가 XFRM SA(Security Association) 설정         │
│  - 키 로테이션 지원 (Secret 업데이트 시 자동 적용)           │
│                                                              │
│  활성화:                                                      │
│  # IPsec 키 생성                                             │
│  kubectl create -n kube-system secret generic cilium-ipsec \  │
│    --from-literal=keys="3 rfc4106(gcm(aes)) $(xxd -l 20     │
│    -p /dev/urandom) 128"                                     │
│                                                              │
│  # Helm values                                               │
│  encryption:                                                  │
│    enabled: true                                              │
│    type: ipsec                                                │
│                                                              │
│  WireGuard vs IPsec 비교:                                    │
│  ┌──────────────┬───────────────┬──────────────────┐         │
│  │              │ WireGuard     │ IPsec            │         │
│  ├──────────────┼───────────────┼──────────────────┤         │
│  │ 성능         │ 더 높음       │ 중간             │         │
│  │ 코드 복잡도  │ 간단 (~4K LoC)│ 복잡             │         │
│  │ 키 관리      │ 자동          │ Secret 기반      │         │
│  │ 키 로테이션  │ 자동          │ 수동 (Secret)    │         │
│  │ FIPS 준수    │ 미지원        │ 지원             │         │
│  │ 커널 요구    │ 5.6+          │ 4.19+            │         │
│  └──────────────┴───────────────┴──────────────────┘         │
└──────────────────────────────────────────────────────────────┘
```

---

## 제8장: Cluster Mesh

### 멀티 클러스터 연결 아키텍처

여러 Kubernetes 클러스터를 하나의 네트워크 평면으로 연결한다:

```
┌──────────────────────────────────────────────────────────────┐
│  Cluster Mesh 아키텍처                                        │
│                                                              │
│  Cluster 1 (ID=1)              Cluster 2 (ID=2)             │
│  ┌────────────────────┐       ┌────────────────────┐        │
│  │ ┌────────────────┐ │       │ ┌────────────────┐ │        │
│  │ │ clustermesh-   │ │◄─────▶│ │ clustermesh-   │ │        │
│  │ │ apiserver      │ │ gRPC  │ │ apiserver      │ │        │
│  │ │ (etcd 내장)    │ │       │ │ (etcd 내장)    │ │        │
│  │ └────────────────┘ │       │ └────────────────┘ │        │
│  │        ▲            │       │        ▲            │        │
│  │        │            │       │        │            │        │
│  │ ┌──────┴─────────┐ │       │ ┌──────┴─────────┐ │        │
│  │ │ cilium-agent   │ │       │ │ cilium-agent   │ │        │
│  │ │ (각 노드)      │ │       │ │ (각 노드)      │ │        │
│  │ │                │ │       │ │                │ │        │
│  │ │ - 원격 클러스터│ │       │ │ - 원격 클러스터│ │        │
│  │ │   상태 동기화  │ │       │ │   상태 동기화  │ │        │
│  │ │ - Pod CIDR:    │ │       │ │ - Pod CIDR:    │ │        │
│  │ │   10.1.0.0/16  │ │       │ │   10.2.0.0/16  │ │        │
│  │ └────────────────┘ │       │ └────────────────┘ │        │
│  │ ┌────┐ ┌────┐      │       │ ┌────┐ ┌────┐      │        │
│  │ │PodA│ │PodB│      │       │ │PodC│ │PodD│      │        │
│  │ └────┘ └────┘      │       │ └────┘ └────┘      │        │
│  └────────────────────┘       └────────────────────┘        │
│                                                              │
│  요구사항:                                                    │
│  - 각 클러스터의 Pod CIDR이 겹치지 않아야 한다               │
│  - 각 클러스터에 고유한 Cluster ID를 할당해야 한다           │
│  - 클러스터 간 IP 연결성이 있어야 한다 (VPN, VPC peering)   │
└──────────────────────────────────────────────────────────────┘
```

### Global Services

```yaml
# 멀티 클러스터 Global Service 선언
apiVersion: v1
kind: Service
metadata:
  name: backend
  namespace: default
  annotations:
    service.cilium.io/global: "true"           # 글로벌 서비스 선언
    service.cilium.io/shared: "true"           # 다른 클러스터와 공유
    service.cilium.io/affinity: "local"        # 로컬 Backend 우선
spec:
  type: ClusterIP
  ports:
    - port: 80
  selector:
    app: backend
```

```
Global Service 동작:
┌──────────────────────────────────────────────────────────────┐
│  affinity: local                                              │
│  - 로컬 클러스터의 Backend가 있으면 로컬 우선                │
│  - 로컬 Backend가 모두 죽으면 원격 클러스터로 failover       │
│                                                              │
│  affinity: remote                                             │
│  - 원격 클러스터의 Backend 우선                               │
│  - 원격 Backend 불가 시 로컬로 fallback                      │
│                                                              │
│  affinity: none (기본값)                                      │
│  - 모든 클러스터의 Backend를 균등하게 사용                   │
└──────────────────────────────────────────────────────────────┘
```

---

## 제9장: BGP Control Plane

### CiliumBGPPeeringPolicy

Cilium은 자체 BGP 스피커를 내장하여 네트워크 라우터와 BGP 피어링을 수행한다.

```yaml
# BGP 피어링 설정
apiVersion: cilium.io/v2alpha1
kind: CiliumBGPPeeringPolicy
metadata:
  name: bgp-peering
spec:
  nodeSelector:
    matchLabels:
      bgp: "true"
  virtualRouters:
    - localASN: 65001
      exportPodCIDR: true          # Pod CIDR를 BGP로 광고
      neighbors:
        - peerAddress: "192.168.1.254/32"
          peerASN: 65000
          connectRetryTimeSeconds: 120
          holdTimeSeconds: 90
          keepAliveTimeSeconds: 30
          gracefulRestart:
            enabled: true
            restartTimeSeconds: 120
      serviceSelector:
        matchExpressions:
          - key: app
            operator: In
            values:
              - nginx
              - api
```

```
┌──────────────────────────────────────────────────────────────┐
│  BGP 라우트 광고                                              │
│                                                              │
│  Cilium Node (AS 65001)                                      │
│  ├── Pod CIDR: 10.0.1.0/24                                  │
│  ├── LoadBalancer VIP: 198.51.100.10                         │
│  │                                                           │
│  │   BGP UPDATE 메시지:                                      │
│  │   ├── NLRI: 10.0.1.0/24 (Pod CIDR)                      │
│  │   ├── NLRI: 198.51.100.10/32 (Service VIP)              │
│  │   └── Next-Hop: 192.168.1.1 (노드 IP)                   │
│  │                                                           │
│  └──── BGP ────▶ ToR Switch (AS 65000)                      │
│                   ├── 라우팅 테이블에 추가                    │
│                   └── 10.0.1.0/24 via 192.168.1.1           │
│                                                              │
│  LoadBalancer IP 할당:                                        │
│  CiliumLoadBalancerIPPool CRD로 IP 풀을 정의하고,           │
│  Service type=LoadBalancer에 자동으로 IP를 할당한다.         │
└──────────────────────────────────────────────────────────────┘
```

```yaml
# LoadBalancer IP 풀 정의
apiVersion: cilium.io/v2alpha1
kind: CiliumLoadBalancerIPPool
metadata:
  name: lb-pool
spec:
  blocks:
    - cidr: "198.51.100.0/24"
  serviceSelector:
    matchLabels:
      exposed: "true"
```

---

## 제10장: Bandwidth Manager

### EDT 기반 Rate Limiting

eBPF 기반의 Pod 대역폭 제어 기능이다. 기존 Linux tc의 rate limiting을 대체한다:

```
┌──────────────────────────────────────────────────────────────┐
│  Bandwidth Manager 동작 원리                                  │
│                                                              │
│  기존 방식 (tc-based):                                       │
│  ├── TBF(Token Bucket Filter) 또는 HTB 사용                 │
│  ├── 큐에 패킷을 쌓고 토큰 속도로 전송                      │
│  └── 문제: 큐잉 지연(bufferbloat) 발생                      │
│                                                              │
│  Cilium EDT 방식:                                            │
│  ├── EDT(Earliest Departure Time): 각 패킷에 전송 시각 태깅 │
│  ├── 커널의 FQ(Fair Queue) 스케줄러가 해당 시각까지 대기     │
│  ├── 큐잉 없이 정밀한 속도 제어                              │
│  └── BBR 혼잡 제어와 자연스럽게 통합                         │
│                                                              │
│  EDT 계산:                                                    │
│  packet.departure_time =                                     │
│    max(now, prev_packet.departure_time)                      │
│    + packet.size / rate_limit                                │
│                                                              │
│  예: rate=10Mbps, packet=1500B                               │
│  departure_time = prev + 1500*8/10M = prev + 1.2ms          │
│                                                              │
│  BBR 통합:                                                    │
│  ├── BBR(Bottleneck Bandwidth and RTT)은 Google이 개발한    │
│  │   혼잡 제어 알고리즘이다                                  │
│  ├── EDT와 BBR을 함께 사용하면:                              │
│  │   1. BBR이 최적 전송 속도를 탐지한다                      │
│  │   2. EDT가 해당 속도로 패킷 간격을 조정한다              │
│  │   3. 결과: 높은 처리량 + 낮은 지연                        │
│  └── 활성화: sysctl net.ipv4.tcp_congestion_control=bbr     │
└──────────────────────────────────────────────────────────────┘
```

- EDT(Earliest Departure Time) 기반으로 패킷 전송 시점을 제어한다
- Pod annotation(`kubernetes.io/egress-bandwidth`)으로 대역폭을 설정한다
- BBR 혼잡 제어 알고리즘과 통합하여 효율적인 대역폭 활용이 가능하다

```yaml
apiVersion: v1
kind: Pod
metadata:
  annotations:
    kubernetes.io/egress-bandwidth: "10M"  # 10Mbps 제한
    kubernetes.io/ingress-bandwidth: "50M" # 50Mbps 제한 (ingress도 지원)
```

```bash
# Bandwidth Manager 활성화 확인
cilium status | grep BandwidthManager

# Pod별 대역폭 설정 확인
kubectl -n kube-system exec -it ds/cilium -- \
  cilium bpf bandwidth list
```

---

