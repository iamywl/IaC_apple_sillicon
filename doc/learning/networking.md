# 네트워크 설계 심화(Advanced Network Design) — CNI, NetworkPolicy, Service Mesh

## 1. 네트워크 레이어별 동작 원리(Network Layer Operation Principles)

이 프로젝트의 네트워크는 **5개 레이어(Layers)**로 구성된다. 각 레이어가 어떤 역할을 하고 패킷(Packet)이 어떻게 흘러가는지 이해하는 것이 핵심이다.

```
┌── L5: Service Mesh (Istio Envoy Sidecar) ─────────────────┐
│ Pod 내부 envoy-proxy가 L7 트래픽 제어(Traffic Control)       │
│ mTLS(Mutual TLS) 암호화(Encryption), 카나리 라우팅(Canary    │
│ Routing), 서킷브레이커(Circuit Breaker)                     │
├── L4: NetworkPolicy (CiliumNetworkPolicy) ────────────────┤
│ eBPF(extended Berkeley Packet Filter)로 커널 레벨(Kernel     │
│ Level)에서 패킷 필터링(Packet Filtering)                     │
│ L3/L4: IP/Port 기반, L7: HTTP 메서드/경로(Method/Path) 기반  │
├── L3: CNI (Cilium) ───────────────────────────────────────┤
│ Pod IP 할당(Assignment) — IPAM(IP Address Management)       │
│ cluster-pool                                               │
│ Pod → Pod 라우팅(Routing) — veth pair → eBPF                │
│ Service → Pod 로드밸런싱(Load Balancing) — kube-proxy 대체   │
├── L2: VM Network (Tart softnet) ──────────────────────────┤
│ vmnet.framework → VM 간 L2 브릿지(Bridge)                   │
│ DHCP로 VM IP 할당 (192.168.65.x)                            │
├── L1: Physical (macOS Host) ──────────────────────────────┤
│ M4 Max NIC → 외부 네트워크(External Network)                 │
└───────────────────────────────────────────────────────────┘
```

---

## 2. VM 네트워크(VM Network) — Tart Softnet

### 2.1 문제: 기본 NAT에서 VM 간 통신 불가(Inter-VM Communication Failure)

Tart의 기본 네트워크 모드(Default Network Mode, shared)는 **NAT 기반**이다:
```
Host ──NAT──→ VM1 (192.168.66.2)
                  VM2 (192.168.66.3)
```

- Host → VM: 가능
- VM → Host: 가능
- **VM → VM: 불가** — 각 VM이 독립 NAT 뒤에 존재

K8s 클러스터에서는 **master ↔ worker 간 직접 통신(Direct Communication)이 필수**이므로 이 모드로는 `kubeadm join`이 불가능하다.

### 2.2 해결: --net-softnet-allow

```bash
tart run "$vm_name" --no-graphics --net-softnet-allow=0.0.0.0/0 &
```

Softnet 모드는 **소프트웨어 브릿지(Software Bridge)**를 사용하여 모든 VM이 같은 L2 세그먼트(Segment)에 위치한다:
```
Host ──softnet bridge──→ VM1 (192.168.65.2)
                     └──→ VM2 (192.168.65.42)
                     └──→ VM3 (192.168.65.43)
```

- VM → VM: **가능** — 같은 브릿지
- IP 대역 변경(IP Range Change): 192.168.66.x → 192.168.65.x

### 2.3 DHCP와 IP 가변성(IP Variability)

Tart VM은 DHCP로 IP를 받으므로 **재부팅할 때마다 IP가 바뀔 수 있다**.

이를 처리하는 패턴(Pattern):
```bash
# 매번 현재 IP를 동적으로 조회(Dynamic Query)
ip=$(tart ip "$vm_name")

# Terraform에서는 파일에 저장(File Persistence)
tart ip "$vm_name" > .terraform-vm-ips/${vm_name}.ip
```

**프로덕션(Production)에서의 대안**: 고정 IP 할당(Static IP), DNS 기반 서비스 디스커버리(Service Discovery), Consul

---

## 3. Cilium CNI 심화(Advanced Cilium CNI)

### 3.1 왜 Cilium인가?(Why Cilium?)

전통적 CNI (Calico, Flannel)는 **iptables** 기반이다:
```
패킷(Packet) → iptables 규칙 체인(Rule Chain) → 라우팅(Routing)
```

Cilium은 **eBPF(extended Berkeley Packet Filter)** 기반이다:
```
패킷 → 커널 eBPF 프로그램(Kernel eBPF Program) → 직접 라우팅(Direct Routing) — iptables 우회(Bypass)
```

| 비교(Comparison) | iptables | eBPF (Cilium) |
|------|----------|---------------|
| 규칙 수에 따른 성능(Performance by Rule Count) | O(n) — 규칙 순차 평가(Sequential Evaluation) | O(1) — 해시맵 조회(HashMap Lookup) |
| Service 로드밸런싱(Load Balancing) | kube-proxy (userspace) | 커널 내 직접 처리(In-kernel Processing) |
| 네트워크 정책(Network Policy) | L3/L4만 | L3/L4 + **L7** |
| 관측성(Observability) | 없음 | Hubble (내장, Built-in) |

### 3.2 kubeProxyReplacement: true

이 프로젝트에서 가장 중요한 설정:

```yaml
# manifests/cilium-values.yaml
kubeProxyReplacement: true
```

이것이 의미하는 것:
1. kubeadm init에서 `--skip-phases=addon/kube-proxy` → kube-proxy 미설치
2. Cilium이 **Service → Pod 로드밸런싱을 직접 수행** (eBPF)
3. ClusterIP, NodePort, LoadBalancer 모두 Cilium이 처리

**부트스트랩 문제(Bootstrap Problem)**: Cilium이 아직 시작 전인데 K8s API (ClusterIP 10.96.0.1)에 접근해야 함
- 해결: `k8sServiceHost`를 마스터 노드의 실제 IP(Actual IP)로 지정

```bash
helm install cilium cilium/cilium \
  --set k8sServiceHost="$master_ip" \  # ClusterIP 대신 실제 IP
  --set k8sServicePort=6443
```

### 3.3 IPAM(IP Address Management)

```yaml
ipam:
  mode: cluster-pool
  operator:
    clusterPoolIPv4PodCIDRList: ["10.10.0.0/16"]  # 클러스터별 설정
```

Pod 생성(Creation) 시 IP 할당 흐름(IP Assignment Flow):
```
Pod 생성 요청(Creation Request)
    │
    ▼
kubelet → containerd → Cilium CNI 플러그인(Plugin)
    │
    ▼
Cilium Agent → cluster-pool에서 IP 할당(IP Assignment)
    │
    ▼
veth pair 생성 — Pod 네임스페이스(Namespace) ↔ 호스트(Host)
    │
    ▼
eBPF 라우팅 테이블(Routing Table) 업데이트
```

---

## 4. CiliumNetworkPolicy — L7 네트워크 보안(L7 Network Security)

### 4.1 Zero Trust 모델(Model)

**Default Deny 패턴(Pattern)**: 모든 트래픽을 차단(Block)하고, 필요한 것만 명시적으로 허용(Explicitly Allow)한다.

```yaml
# manifests/network-policies/default-deny.yaml
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: default-deny-all
  namespace: demo
spec:
  endpointSelector: {}     # 네임스페이스의 모든 Pod에 적용(Apply to All Pods)
  ingress:
    - {}                    # 아무것도 허용하지 않음 — 빈 규칙(Empty Rule) = 차단
  egress:
    - toEndpoints:
        - matchLabels:
            k8s:io.kubernetes.pod.namespace: kube-system
            k8s-app: kube-dns
      toPorts:
        - ports:
            - port: "53"
              protocol: UDP
```

**정책 적용 순서(Policy Application Order) — 중요!**:
```
1. default-deny-all          → 모든 트래픽 차단 — DNS만 허용
2. allow-external-to-nginx   → 외부(External) → nginx:80
3. allow-nginx-to-httpbin    → nginx → httpbin — GET만(GET Only)
4. allow-nginx-to-redis      → nginx → redis:6379
5. allow-nginx-egress        → nginx 아웃바운드(Outbound)
```

### 4.2 L7 HTTP 필터링(Filtering) — Cilium의 차별점(Differentiator)

일반 NetworkPolicy (Calico 등):
```
"nginx가 httpbin의 80번 포트에 접근 허용" (L3/L4)
→ 모든 HTTP 메서드(Method) — GET, POST, DELETE 허용
```

CiliumNetworkPolicy:
```yaml
# nginx → httpbin: HTTP GET만 허용(GET Only)
rules:
  http:
    - method: GET
```

이것은 **마이크로서비스 보안(Microservice Security)에서 매우 중요**하다:
- 읽기 전용 서비스(Read-only Service)에 GET만 허용 → DELETE/PUT 등 위험한 메서드 차단
- API Gateway 패턴에서 경로별 필터링(Path-based Filtering) 가능

### 4.3 Hubble로 네트워크 관측(Network Observation)

```bash
# 차단된 트래픽 실시간 관찰(Real-time Dropped Traffic Observation)
hubble observe --namespace demo --verdict DROPPED

# 특정 Pod 간 통신 추적(Inter-Pod Communication Tracing)
hubble observe --from-pod demo/nginx-web --to-pod demo/httpbin
```

Hubble이 제공하는 정보:
```
TIMESTAMP   SOURCE           DESTINATION      TYPE    VERDICT
12:00:01    demo/nginx       demo/httpbin     L7/HTTP FORWARDED  GET /get
12:00:02    demo/nginx       demo/httpbin     L7/HTTP DROPPED    POST /post
12:00:03    demo/redis       demo/httpbin     L4/TCP  DROPPED    → port 80
```

---

## 5. Istio Service Mesh — L7 트래픽 관리(L7 Traffic Management)

### 5.1 사이드카 패턴(Sidecar Pattern)

Istio는 **모든 Pod에 Envoy 프록시(Proxy)를 자동 주입(Auto Injection)**한다:

```
일반 Pod(Normal Pod):
┌───────────────┐
│  App Container │
│  (nginx)       │
└───────────────┘

Istio 사이드카 주입 후(After Sidecar Injection):
┌───────────────────────────┐
│  ┌─── App Container ───┐  │
│  │  nginx               │  │
│  └────────┬─────────────┘  │
│           │ localhost       │
│  ┌────────▼─────────────┐  │
│  │  istio-proxy (Envoy) │  │  ← 모든 inbound/outbound 트래픽 가로챔(Intercept)
│  └──────────────────────┘  │
└───────────────────────────┘
```

활성화(Activation):
```bash
kubectl label namespace demo istio-injection=enabled
kubectl rollout restart deployment -n demo  # 기존 Pod 재시작 → 사이드카 주입
```

### 5.2 mTLS(Mutual TLS) — STRICT 모드(Mode)

```yaml
# manifests/istio/peer-authentication.yaml
apiVersion: security.istio.io/v1
kind: PeerAuthentication
metadata:
  name: strict-mtls
  namespace: demo
spec:
  mtls:
    mode: STRICT   # 암호화되지 않은 통신 거부(Reject Unencrypted)
```

동작 원리(Operation Principle):
```
nginx Pod                              httpbin Pod
┌──────────┐                          ┌──────────┐
│  nginx   │                          │  httpbin  │
│    │     │                          │    ▲      │
│    ▼     │                          │    │      │
│  envoy   │ ──── TLS 1.3 ────────→  │  envoy   │
│ (client) │   mTLS 상호 인증서 검증    │ (server) │
│          │   (Mutual Certificate    │          │
│          │    Verification)         │          │
└──────────┘                          └──────────┘
```

- 양쪽 envoy가 **서로의 인증서를 검증(Mutual Verification)**
- Istio CA(Certificate Authority, Citadel)가 인증서 자동 발급/갱신(Auto Issue/Renew)
- 애플리케이션 코드 변경 없이 암호화 적용(Encryption without Code Change)

### 5.3 카나리 배포(Canary Deployment)

```yaml
# manifests/istio/virtual-service.yaml
spec:
  http:
    - match:
        - headers:
            x-canary:
              exact: "true"
      route:
        - destination:
            host: httpbin
            subset: v2          # 헤더(Header) 있으면 v2로
    - route:
        - destination:
            host: httpbin
            subset: v1
          weight: 80            # 일반 트래픽 80% → v1
        - destination:
            host: httpbin
            subset: v2
          weight: 20            # 20% → v2
```

트래픽 흐름(Traffic Flow):
```
요청(Request) 100건 → Istio VirtualService
                │
                ├── x-canary: true → 100% v2
                │
                ├── 일반 트래픽(Normal Traffic) 80건 → httpbin v1
                │
                └── 일반 트래픽 20건 → httpbin v2 (카나리, Canary)
```

**프로덕션(Production)에서의 활용**:
1. 새 버전(v2) 배포 후 20% 트래픽만 전달
2. 에러율(Error Rate)/지연(Latency) 모니터링
3. 문제 없으면 50% → 80% → 100%로 점진적 이전(Gradual Migration)
4. 문제 발생 시 즉시 0%로 롤백(Rollback) — 코드 재배포 없이

### 5.4 서킷브레이커(Circuit Breaker)

```yaml
# manifests/istio/destination-rule.yaml
spec:
  trafficPolicy:
    outlierDetection:
      consecutive5xxErrors: 3     # 연속 5xx 3회 발생 시
      interval: 30s               # 30초 주기로 체크(Check)
      baseEjectionTime: 30s       # 30초간 트래픽 차단(Traffic Block)
      maxEjectionPercent: 50      # 최대 50% 인스턴스(Instance) 격리(Ejection)
```

동작(Operation):
```
정상 상태(Normal State):
  요청 → httpbin-pod-1 ✓
  요청 → httpbin-pod-2 ✓

pod-1이 연속 3회 5xx 반환(Return):
  요청 → httpbin-pod-1 ✗✗✗ → 서킷 OPEN (30초간 격리, 30s Ejection)
  요청 → httpbin-pod-2 ✓   (나머지 인스턴스로만 라우팅)

30초 후(After 30s):
  요청 → httpbin-pod-1 ✓   → 서킷 CLOSED (복귀, Recovery)
```

### 5.5 Cilium과 Istio의 공존(Coexistence)

이 프로젝트에서 Cilium과 Istio는 **서로 다른 레이어에서 동작(Operate at Different Layers)**한다:

| 레이어(Layer) | Cilium 역할(Role) | Istio 역할(Role) |
|--------|-------------|------------|
| L3 (IP) | Pod IP 라우팅(Routing), IPAM | - |
| L4 (TCP) | Service 로드밸런싱(Load Balancing), NetworkPolicy | - |
| L7 (HTTP) | CiliumNetworkPolicy (선택적, Optional) | VirtualService, mTLS, 카나리(Canary) |

**공존이 가능한 이유(Why Coexistence Works)**:
- Cilium은 **커널 eBPF**에서 동작 — 패킷 레벨(Packet Level)
- Istio는 **Pod 내 사이드카 프록시(Sidecar Proxy)**로 동작 — 애플리케이션 레벨(Application Level)
- 패킷은 먼저 Cilium eBPF를 통과하고, 그 후 Envoy 사이드카에 도달

---

## 6. 패킷의 전체 여정(Full Packet Journey)

nginx Pod에서 httpbin으로 HTTP GET 요청을 보내는 경우:

```
1. nginx 컨테이너(Container) → localhost — Istio sidecar 가로챔(Intercept)
2. Envoy (client) → mTLS 암호화(Encryption) → Pod network namespace
3. veth pair → Host network namespace
4. Cilium eBPF:
   a. CiliumNetworkPolicy 평가(Evaluation) — HTTP GET → 허용(Allow)
   b. Service → Pod 해석(Resolution) — httpbin ClusterIP → Pod IP
   c. 대상 노드로 라우팅(Route to Target Node)
5. (다른 노드인 경우) VXLAN/Direct → 대상 노드 커널(Target Node Kernel)
6. 대상 Cilium eBPF → 대상 veth pair
7. httpbin Pod network namespace → Envoy (server)
8. Envoy (server) → mTLS 복호화(Decryption) → 인증서 검증(Certificate Verification)
9. httpbin 컨테이너에 평문(Plaintext) HTTP 전달
```

---

## 7. 검증 명령 모음(Verification Commands)

```bash
# Cilium 상태 확인(Status Check)
kubectl --kubeconfig kubeconfig/dev.yaml exec -n kube-system ds/cilium -- cilium status

# NetworkPolicy 적용 상태(Applied Policies)
kubectl --kubeconfig kubeconfig/dev.yaml get cnp -n demo

# Hubble 네트워크 관찰(Network Observation)
kubectl --kubeconfig kubeconfig/dev.yaml -n kube-system port-forward svc/hubble-relay 4245:80 &
hubble observe --namespace demo

# Istio 사이드카 주입 확인(Sidecar Injection Verification)
kubectl --kubeconfig kubeconfig/dev.yaml get pods -n demo -o jsonpath='{.items[*].spec.containers[*].name}' | tr ' ' '\n' | sort | uniq

# mTLS 검증(Verification) — 사이드카 없는 Pod에서 접근 시도 (차단되어야 함, Should Be Blocked)
kubectl --kubeconfig kubeconfig/dev.yaml run test --rm -it --image=curlimages/curl -- curl http://httpbin.demo/get

# 카나리(Canary) 트래픽 확인
for i in $(seq 1 20); do
  kubectl --kubeconfig kubeconfig/dev.yaml -n demo exec deploy/nginx-web -c nginx -- \
    curl -s http://httpbin/get 2>/dev/null | grep -o '"version": "[^"]*"'
done | sort | uniq -c
```
