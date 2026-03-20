# Day 3: Datapath 및 Network Policy 심화

> Cilium의 eBPF 기반 Datapath 동작 원리와 L3/L4/L7 Network Policy 설정 및 적용 방법을 심층 학습한다.

---

## 제4장: Datapath 심화

### 패킷 흐름 상세: Pod-to-Pod (같은 노드)

```
┌──────────────────────────────────────────────────────────────┐
│  같은 노드 내 Pod A → Pod B 패킷 흐름                        │
│                                                              │
│  Pod A (netns)                                               │
│  ├── 1. App이 connect()/send() 호출                          │
│  ├── 2. [Socket LB] Service ClusterIP → Backend IP 변환     │
│  │       (cgroup/connect4 eBPF 프로그램)                     │
│  ├── 3. TCP/IP 스택에서 패킷 생성                            │
│  └── 4. eth0 (veth) → lxc-aaaa (host netns)                 │
│                                                              │
│  Host Network Namespace                                      │
│  ├── 5. lxc-aaaa TC ingress eBPF 실행                       │
│  │   ├── src Identity lookup (ipcache Map)                   │
│  │   ├── dst Identity lookup (ipcache Map)                   │
│  │   ├── Policy Map 검사 → ALLOW/DENY                       │
│  │   ├── Conntrack 업데이트                                  │
│  │   └── L7 정책 있으면 → Envoy redirect                    │
│  │                                                           │
│  ├── 6. [Host-Routing 모드]                                  │
│  │   └── bpf_redirect_peer() → 직접 Pod B의 eth0로 전달    │
│  │       (iptables 완전 우회, 커널 5.10+)                    │
│  │                                                           │
│  ├── 6'. [일반 veth 모드]                                    │
│  │   └── bpf_redirect() → lxc-bbbb TC ingress              │
│  │       → TC ingress eBPF (수신측 정책 검사)               │
│  │       → Pod B의 eth0                                     │
│  │                                                           │
│  Pod B (netns)                                               │
│  └── 7. eth0에서 패킷 수신 → TCP/IP 스택 → App              │
└──────────────────────────────────────────────────────────────┘
```

### 패킷 흐름 상세: Pod-to-Pod (다른 노드, VXLAN)

```
┌──────────────────────────────────────────────────────────────┐
│  다른 노드 Pod A → Pod B (VXLAN Encapsulation)               │
│                                                              │
│  Node A                                                      │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ Pod A (10.0.1.5)                                      │    │
│  │  └── eth0 → lxc-aaaa                                  │    │
│  │       │                                                │    │
│  │  TC ingress eBPF                                      │    │
│  │  ├── Policy 검사                                      │    │
│  │  ├── dst IP 10.0.2.8 → ipcache lookup                │    │
│  │  │   → tunnel_endpoint: 192.168.1.2 (Node B)         │    │
│  │  ├── Conntrack 생성                                   │    │
│  │  └── bpf_redirect() → cilium_vxlan                   │    │
│  │       │                                                │    │
│  │  cilium_vxlan (VXLAN 인터페이스)                       │    │
│  │  ├── VXLAN encapsulation                               │    │
│  │  │   ├── Outer Ethernet: Node A MAC → Node B MAC      │    │
│  │  │   ├── Outer IP: 192.168.1.1 → 192.168.1.2         │    │
│  │  │   ├── Outer UDP: sport=random, dport=8472          │    │
│  │  │   ├── VXLAN Header: VNI = Security Identity        │    │
│  │  │   └── Inner: 원본 패킷 (10.0.1.5 → 10.0.2.8)     │    │
│  │  └── 물리 NIC → 네트워크                               │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                              │
│  네트워크 (L2/L3 전달)                                       │
│                                                              │
│  Node B                                                      │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ 물리 NIC → cilium_vxlan                                │    │
│  │  ├── VXLAN decapsulation                               │    │
│  │  ├── VXLAN Header에서 Security Identity 추출           │    │
│  │  └── TC ingress eBPF                                   │    │
│  │       ├── src Identity (VXLAN에서 전달됨) 검증         │    │
│  │       ├── Policy 검사                                  │    │
│  │       ├── Conntrack 생성 (reverse direction)           │    │
│  │       └── bpf_redirect() → lxc-bbbb                   │    │
│  │            │                                           │    │
│  │ Pod B (10.0.2.8)                                       │    │
│  │  └── eth0에서 수신                                     │    │
│  └──────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────┘
```

### Connection Tracking (CT) 상세

Cilium은 자체 eBPF 기반 conntrack 테이블을 유지한다. 커널의 nf_conntrack 모듈 대신 eBPF Hash Map을 사용한다.

```
┌──────────────────────────────────────────────────────────────┐
│  Cilium CT 테이블 구조                                        │
│                                                              │
│  Key (5-tuple + direction):                                  │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ src_ip    │ dst_ip    │ src_port │ dst_port │ proto  │    │
│  │ 10.0.1.5  │ 10.0.2.8  │ 45678    │ 8080     │ TCP    │    │
│  │                                               dir=TX │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                              │
│  Value:                                                      │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ lifetime      │ 남은 수명 (초)                        │    │
│  │ rx_packets    │ 수신 패킷 수                          │    │
│  │ rx_bytes      │ 수신 바이트 수                        │    │
│  │ tx_packets    │ 송신 패킷 수                          │    │
│  │ tx_bytes      │ 송신 바이트 수                        │    │
│  │ flags         │ 연결 상태 플래그                      │    │
│  │ last_rx_report│ 마지막 Hubble 보고 시간               │    │
│  │ last_tx_report│ 마지막 Hubble 보고 시간               │    │
│  │ rev_nat_index │ Reverse NAT 인덱스                    │    │
│  │ src_identity  │ 소스 Security Identity                │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                              │
│  CT 테이블 크기 설정:                                         │
│  --bpf-ct-global-tcp-max: TCP 엔트리 최대 수 (기본 512K)    │
│  --bpf-ct-global-any-max: UDP/ICMP 엔트리 최대 수 (기본 256K)│
│                                                              │
│  CT 타이머:                                                   │
│  TCP established: 21600초 (6시간)                            │
│  TCP SYN:         60초                                       │
│  TCP FIN:         10초                                       │
│  UDP:             30초                                       │
│  ICMP:            10초                                       │
└──────────────────────────────────────────────────────────────┘
```

### NAT 테이블과 SNAT/Masquerade

```
┌──────────────────────────────────────────────────────────────┐
│  SNAT/Masquerade 동작                                         │
│                                                              │
│  Pod → 외부 (인터넷) 트래픽:                                 │
│                                                              │
│  1. Pod A (10.0.1.5) → 외부 서버 (1.2.3.4:443)             │
│  2. TC egress eBPF에서 SNAT 수행                             │
│     ├── src IP: 10.0.1.5 → 192.168.1.1 (노드 IP)           │
│     ├── src port: 45678 → 50000 (NAT 포트)                  │
│     └── NAT Map에 매핑 기록                                  │
│  3. 응답 패킷: 1.2.3.4:443 → 192.168.1.1:50000             │
│  4. TC ingress eBPF에서 Reverse SNAT 수행                    │
│     ├── NAT Map lookup → 원래 src 복원                      │
│     ├── dst IP: 192.168.1.1 → 10.0.1.5                      │
│     └── dst port: 50000 → 45678                              │
│  5. 패킷이 Pod A에 전달된다                                  │
│                                                              │
│  eBPF Masquerade vs iptables Masquerade:                     │
│  ┌──────────────┬─────────────────┬────────────────────┐     │
│  │              │ eBPF            │ iptables           │     │
│  ├──────────────┼─────────────────┼────────────────────┤     │
│  │ 처리 위치    │ TC eBPF hook    │ POSTROUTING chain  │     │
│  │ 성능         │ O(1) Map lookup │ O(n) 규칙 순회     │     │
│  │ Conntrack    │ eBPF CT Map     │ nf_conntrack       │     │
│  │ lock 경합    │ per-CPU Map     │ 글로벌 lock        │     │
│  └──────────────┴─────────────────┴────────────────────┘     │
└──────────────────────────────────────────────────────────────┘
```

### DSR (Direct Server Return)

```
┌──────────────────────────────────────────────────────────────┐
│  DSR 모드 동작                                                │
│                                                              │
│  Client → NodePort (Node A) → Backend Pod (Node B)          │
│                                                              │
│  일반 모드 (SNAT):                                           │
│  Client → Node A → SNAT(src=NodeA) → Node B (Pod)          │
│  Client ← Node A ← SNAT reverse  ← Node B (Pod)           │
│  (응답이 반드시 Node A를 경유해야 한다)                      │
│                                                              │
│  DSR 모드:                                                    │
│  Client → Node A → (src=Client 유지) → Node B (Pod)        │
│  Client ← ──────── 직접 응답 ────────── Node B (Pod)        │
│  (응답이 Node A를 경유하지 않고 직접 클라이언트로 전달)      │
│                                                              │
│  DSR 구현 방식:                                               │
│  ┌────────────────┬────────────────────────────────────┐     │
│  │ IP-in-IP       │ 원본 패킷을 IP 터널로 감싸서 전달  │     │
│  │ (기본값)       │ Backend에서 decap 후 원본 src 확인  │     │
│  ├────────────────┼────────────────────────────────────┤     │
│  │ Geneve         │ Geneve 터널의 옵션 헤더에 원본      │     │
│  │                │ 클라이언트 정보를 인코딩              │     │
│  └────────────────┴────────────────────────────────────┘     │
│                                                              │
│  장점: 비대칭 경로로 응답 지연 감소, 노드 간 트래픽 절반     │
│  단점: MTU 감소 (IP-in-IP 헤더), 비대칭 라우팅 지원 필요    │
└──────────────────────────────────────────────────────────────┘
```

### Datapath 모드 비교

Cilium은 노드 간 Pod 트래픽을 전달하는 두 가지 Datapath 모드를 지원한다:

#### Encapsulation 모드 (기본값)

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

#### Direct Routing 모드 (Native Routing)

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

## 제5장: Network Policy 심화

### CiliumNetworkPolicy vs Kubernetes NetworkPolicy

| 특성 | K8s NetworkPolicy | CiliumNetworkPolicy |
|------|-------------------|---------------------|
| API 그룹 | networking.k8s.io/v1 | cilium.io/v2 |
| L3/L4 정책 | 지원 | 지원 |
| L7 정책 (HTTP, gRPC) | 미지원 | 지원 |
| DNS/FQDN 기반 정책 | 미지원 | 지원 |
| Entity 기반 정책 (world, host 등) | 미지원 | 지원 |
| 클러스터 전역 정책 | 미지원 | CiliumClusterwideNetworkPolicy |
| Node 레벨 정책 | 미지원 | nodeSelector로 호스트 방화벽 |
| Deny 정책 | 미지원 (기본 deny만) | egressDeny/ingressDeny 명시적 지원 |
| 정책 감사 모드 | 미지원 | 지원 (audit 모드) |
| CIDR 기반 Egress | ipBlock으로 제한적 | toCIDR/toCIDRSet으로 유연 |

### L3 정책 (Identity 기반)

L3 정책은 Source/Destination의 Identity(label)를 기반으로 트래픽을 제어한다.

```yaml
# L3 정책: label 기반 접근 제어
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: l3-policy
  namespace: demo
spec:
  endpointSelector:
    matchLabels:
      app: backend
  ingress:
    - fromEndpoints:
        - matchLabels:
            app: frontend        # frontend label을 가진 Pod에서만 허용
        - matchLabels:
            app: monitoring      # monitoring label도 허용
      fromRequires:
        - matchLabels:
            env: production      # 추가 조건: env=production이어야 함
```

### L4 정책 (포트/프로토콜)

L4 정책은 L3 조건에 포트/프로토콜 제한을 추가한다.

```yaml
# L4 정책: 포트 기반 제어
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: l4-policy
  namespace: demo
spec:
  endpointSelector:
    matchLabels:
      app: database
  ingress:
    - fromEndpoints:
        - matchLabels:
            app: backend
      toPorts:
        - ports:
            - port: "5432"       # PostgreSQL
              protocol: TCP
            - port: "6379"       # Redis
              protocol: TCP
```

### L7 정책 (Application Layer)

L7 정책은 HTTP, gRPC, Kafka 등 애플리케이션 프로토콜 수준에서 트래픽을 제어한다.

```yaml
# L7 HTTP 정책: 메서드/경로 기반 제어
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
                path: "/api/v1/users"
              - method: GET
                path: "/api/v1/products"
              - method: POST
                path: "/api/v1/orders"
                headers:
                  - 'Content-Type: application/json'
```

```yaml
# L7 gRPC 정책
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: l7-grpc-policy
spec:
  endpointSelector:
    matchLabels:
      app: grpc-service
  ingress:
    - fromEndpoints:
        - matchLabels:
            app: grpc-client
      toPorts:
        - ports:
            - port: "50051"
              protocol: TCP
          rules:
            http:                           # gRPC는 HTTP/2 기반
              - method: POST
                path: "/mypackage.MyService/GetItem"
```

```yaml
# L7 Kafka 정책
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: l7-kafka-policy
spec:
  endpointSelector:
    matchLabels:
      app: kafka
  ingress:
    - fromEndpoints:
        - matchLabels:
            app: producer
      toPorts:
        - ports:
            - port: "9092"
              protocol: TCP
          rules:
            kafka:
              - apiKey: "produce"
                topic: "orders"
              - apiKey: "metadata"
              - apiKey: "apiversions"
```

### DNS/FQDN 기반 정책

DNS 기반 정책은 도메인 이름으로 외부 접근을 제어한다. Cilium의 DNS proxy가 DNS 응답을 가로채서 FQDN → IP 매핑을 학습한다.

```
┌──────────────────────────────────────────────────────────────┐
│  FQDN 정책 동작 과정                                          │
│                                                              │
│  1. Pod가 DNS 질의: api.example.com                          │
│       │                                                      │
│  2. Cilium DNS proxy가 질의를 가로챈다                       │
│       │                                                      │
│  3. 실제 DNS 서버(kube-dns)에 질의를 전달한다                │
│       │                                                      │
│  4. DNS 응답 수신: api.example.com → 93.184.216.34          │
│       │                                                      │
│  5. FQDN 캐시에 매핑 저장                                    │
│     cilium_fqdn_cache[api.example.com] = {93.184.216.34}    │
│       │                                                      │
│  6. ipcache Map에 93.184.216.34 → FQDN Identity 추가       │
│       │                                                      │
│  7. Policy Map에 해당 Identity에 대한 Allow 규칙 삽입       │
│       │                                                      │
│  8. 이후 93.184.216.34로의 트래픽이 허용된다                 │
│       │                                                      │
│  9. DNS TTL 만료 시 → 매핑 삭제 → 트래픽 차단               │
└──────────────────────────────────────────────────────────────┘
```

```yaml
# FQDN 기반 Egress 정책 (상세)
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: fqdn-egress-detailed
  namespace: demo
spec:
  endpointSelector:
    matchLabels:
      app: backend
  egress:
    # 1단계: DNS 질의 허용 (필수!)
    - toEndpoints:
        - matchLabels:
            io.kubernetes.pod.namespace: kube-system
            k8s-app: kube-dns
      toPorts:
        - ports:
            - port: "53"
              protocol: ANY
          rules:
            dns:
              - matchPattern: "*.example.com"   # 이 패턴의 DNS만 허용
              - matchName: "api.github.com"
    # 2단계: 학습된 IP로의 실제 트래픽 허용
    - toFQDNs:
        - matchPattern: "*.example.com"
        - matchName: "api.github.com"
      toPorts:
        - ports:
            - port: "443"
              protocol: TCP
```

### Entity 기반 정책

Entity는 Cilium이 사전 정의한 논리적 네트워크 엔티티이다.

| Entity | 설명 |
|--------|------|
| `host` | 현재 노드의 호스트 네트워크 |
| `remote-node` | 다른 노드의 호스트 네트워크 |
| `world` | 클러스터 외부의 모든 IP (인터넷) |
| `all` | 위의 모든 엔티티 |
| `cluster` | 클러스터 내부의 모든 엔티티 |
| `init` | Identity 미결정 상태의 Endpoint |
| `health` | Cilium health check Endpoint |
| `unmanaged` | Cilium이 관리하지 않는 Endpoint |
| `kube-apiserver` | Kubernetes API server |
| `ingress` | Ingress controller |

```yaml
# Entity 기반 정책 예시
# 본 프로젝트의 allow-external-to-nginx.yaml과 동일한 패턴
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: entity-based-policy
  namespace: demo
spec:
  endpointSelector:
    matchLabels:
      app: nginx-web
  ingress:
    - fromEntities:
        - world       # 외부(인터넷)에서의 접근 허용
        - cluster      # 클러스터 내부에서의 접근 허용
      toPorts:
        - ports:
            - port: "80"
              protocol: TCP
```

### Host Policy (노드 방화벽)

```yaml
# 노드 레벨 방화벽 정책
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
    - fromEntities:
        - cluster
      toPorts:
        - ports:
            - port: "10250"    # kubelet
              protocol: TCP
            - port: "4240"     # cilium health
              protocol: TCP
  egress:
    - toEntities:
        - world
      toPorts:
        - ports:
            - port: "443"
              protocol: TCP
```

### 정책 감사 모드 (Audit Mode)

운영 환경에서 정책을 적용하기 전에 감사 모드로 테스트할 수 있다. 감사 모드에서는 정책 위반 트래픽을 차단하지 않고 로그만 남긴다.

```bash
# 네임스페이스 레벨에서 감사 모드 활성화
kubectl annotate ns demo \
  policy.cilium.io/enforcement-mode=audit

# 감사 로그 확인
hubble observe --verdict AUDIT

# 감사 모드 해제 (실제 정책 적용)
kubectl annotate ns demo \
  policy.cilium.io/enforcement-mode-
```

---

