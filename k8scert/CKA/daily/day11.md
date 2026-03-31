# CKA Day 11: Service 타입 & DNS & YAML 예제

> CKA 도메인: **Services & Networking (20%)** - Part 1 | 예상 소요 시간: 3시간

---

## 학습 목표

- [ ] 4가지 Service 타입(ClusterIP, NodePort, LoadBalancer, ExternalName)의 내부 동작을 완벽히 이해한다
- [ ] Headless Service의 DNS 동작 원리를 파악한다
- [ ] CoreDNS 구조와 서비스 디스커버리 메커니즘을 숙지한다
- [ ] Service가 생성될 때 kube-proxy가 iptables/IPVS 규칙을 만드는 과정을 이해한다
- [ ] 시험 패턴 12개 이상을 시간 내에 해결한다

---

## 1. Service란 무엇인가?

### 1.1 Service의 설계 원리

> **Service = Label Selector 기반 L4 로드밸런싱 추상화 계층**
>
> Pod는 ReplicaSet에 의해 동적으로 생성/삭제되므로 IP가 불확정적이다.
> Service는 고정된 Virtual IP(ClusterIP)를 할당하고, Label Selector로 매칭되는 Pod 집합을
> Endpoints/EndpointSlice 오브젝트로 추적한다.
>
> kube-proxy(또는 eBPF datapath)가 ClusterIP 목적지 패킷을 커널 수준에서
> DNAT 처리하여 실제 Pod IP로 전달한다. 이를 통해 서비스 디스커버리와 로드밸런싱을 투명하게 제공한다.

### 1.2 등장 배경: 왜 Service가 필요한가?

Kubernetes 이전 시대에는 로드밸런서 앞에 고정 IP를 가진 서버를 등록하는 방식이었다. 그러나 컨테이너 환경에서는 Pod가 수시로 죽고 다시 생성되며, 그때마다 IP가 바뀐다. 클라이언트가 모든 Pod의 IP를 추적하는 것은 현실적으로 불가능하다. Service는 이 문제를 해결하기 위해 고정 VIP(Virtual IP) + Label Selector 기반 동적 멤버십 모델을 도입하였다. Pod가 아무리 교체되어도 Label만 일치하면 자동으로 트래픽 대상에 포함된다.

```
문제 상황:
┌──────────┐     ┌──────────┐     ┌──────────┐
│ Pod A    │     │ Pod B    │     │ Pod C    │
│ IP:10.1  │     │ IP:10.2  │     │ IP:10.3  │
└──────────┘     └──────────┘     └──────────┘
     ↑                                  ↑
  죽으면 새 Pod 생성                    새 IP 할당
     ↓                                  ↓
┌──────────┐                      ┌──────────┐
│ Pod A'   │                      │ Pod C'   │
│ IP:10.7  │  ← IP가 바뀜!       │ IP:10.9  │
└──────────┘                      └──────────┘

해결: Service (고정 IP)
┌──────────────────────────────────────────────┐
│  Service: my-app-svc                         │
│  ClusterIP: 10.96.100.50 (고정!)             │
│                                              │
│  ┌────────┐  ┌────────┐  ┌────────┐         │
│  │ Pod A' │  │ Pod B  │  │ Pod C' │         │
│  │ 10.7   │  │ 10.2   │  │ 10.9   │         │
│  └────────┘  └────────┘  └────────┘         │
│                                              │
│  → Pod IP가 바뀌어도 Service IP는 고정       │
│  → 클라이언트는 Service IP만 알면 됨         │
└──────────────────────────────────────────────┘
```

### 1.3 Service의 내부 동작 원리

```
Service 생성 시 내부 처리 흐름:

1. 사용자가 Service YAML을 API Server에 제출
   kubectl apply -f service.yaml
        │
        ▼
2. API Server가 etcd에 Service 객체 저장
        │
        ▼
3. Endpoint Controller가 Service의 selector와
   일치하는 Pod를 찾아 Endpoints 객체 생성
        │
        ▼
4. kube-proxy (모든 노드에서 실행)가 변경 감지
        │
        ▼
5. kube-proxy가 각 노드에 iptables/IPVS 규칙 생성
   (ClusterIP → Pod IP로 변환하는 NAT 규칙)
        │
        ▼
6. 클라이언트가 Service IP로 요청 보내면
   iptables/IPVS가 적절한 Pod으로 라우팅

※ Cilium 사용 시: kube-proxy 대신 eBPF가 이 역할을 수행
  (kubeProxyReplacement=true)
```

---

## 2. Service 타입 완벽 비교

### 2.1 4가지 Service 타입 비교표

| 구분 | ClusterIP | NodePort | LoadBalancer | ExternalName |
|---|---|---|---|---|
| **접근 범위** | 클러스터 내부만 | 외부 (노드 IP) | 외부 (LB IP) | DNS CNAME |
| **IP 할당** | 가상 ClusterIP | ClusterIP + 노드포트 | ClusterIP + LB IP | 없음 |
| **포트 범위** | 임의 | 30000-32767 | 임의 | 없음 |
| **사용 사례** | 내부 마이크로서비스 | 개발/테스트 외부 접근 | 프로덕션 외부 서비스 | 외부 서비스 참조 |
| **네트워크 동작** | DNAT via iptables/eBPF | NodePort→ClusterIP 체인 | External LB→NodePort→ClusterIP | CoreDNS CNAME 레코드 반환 |

### 2.2 ClusterIP Service (기본값)

> **ClusterIP**: 클러스터 내부에서만 라우팅 가능한 Virtual IP를 할당한다. kube-proxy가 iptables DNAT 규칙 또는 IPVS virtual server를 생성하여, ClusterIP:port 목적지 패킷을 Endpoints에 등록된 Pod IP:targetPort로 분산 전달한다.

```yaml
# ClusterIP Service 전체 YAML (한 줄씩 설명)
apiVersion: v1              # Service는 핵심 API 그룹(v1)에 속한다
kind: Service               # 리소스 종류: Service
metadata:
  name: backend-svc          # Service의 이름. DNS에서 이 이름으로 조회된다
  namespace: demo            # Service가 속할 네임스페이스
  labels:                    # Service 자체에 붙는 레이블 (선택사항)
    app: backend             # 관리/조회 용도
    tier: api                # 계층 구분
spec:
  type: ClusterIP            # Service 타입. 생략하면 기본값이 ClusterIP이다
  selector:                  # 이 Service가 트래픽을 전달할 Pod를 선택하는 기준
    app: backend             # app=backend 레이블을 가진 Pod로 트래픽 전달
  ports:
  - name: http               # 포트 이름 (멀티 포트 시 필수)
    protocol: TCP            # 프로토콜 (TCP가 기본값)
    port: 80                 # Service가 노출하는 포트 (클라이언트가 접속하는 포트)
    targetPort: 8080         # Pod 컨테이너가 실제로 리스닝하는 포트
  sessionAffinity: None      # None(기본) 또는 ClientIP(같은 클라이언트→같은 Pod)
```

**ClusterIP 내부 동작 원리:**

ClusterIP는 실제 네트워크 인터페이스에 바인딩되지 않는 가상 IP이다. 이 IP로 향하는 패킷은 커널의 netfilter(iptables) 또는 eBPF 훅에서 가로채어 DNAT(Destination NAT) 처리된다. kube-proxy는 Endpoints 변경을 감시하여 iptables 체인에 확률 기반 분산 규칙(probability matching)을 삽입한다. 예를 들어 Endpoint가 3개이면 각각 33% 확률로 선택된다.

**ClusterIP 패킷 흐름:**

```
클라이언트 Pod
    │
    │  dst: 10.96.100.50:80 (Service ClusterIP)
    ▼
iptables/eBPF (커널 레벨에서 NAT 수행)
    │
    │  dst 변환: 10.244.1.5:8080 (실제 Pod IP:포트)
    ▼
백엔드 Pod (app=backend)
```

**검증 명령어:**

```bash
# ClusterIP Service 생성 후 검증
kubectl apply -f clusterip-svc.yaml
kubectl get svc backend-svc -n demo
```

```text
NAME          TYPE        CLUSTER-IP      EXTERNAL-IP   PORT(S)   AGE
backend-svc   ClusterIP   10.96.100.50    <none>        80/TCP    5s
```

```bash
# Endpoints 확인
kubectl get endpoints backend-svc -n demo
```

```text
NAME          ENDPOINTS                                   AGE
backend-svc   10.244.1.5:8080,10.244.2.8:8080             5s
```

### 2.3 NodePort Service

> **NodePort**: ClusterIP를 확장하여, 모든 노드의 특정 포트(30000-32767)에서 인바운드 트래픽을 수신한다. 각 노드의 kube-proxy가 해당 NodePort로 들어온 패킷을 ClusterIP의 DNAT 체인으로 전달하므로, 어떤 노드에 요청하든 동일한 Service Endpoints로 라우팅된다.

```yaml
# NodePort Service 전체 YAML
apiVersion: v1
kind: Service
metadata:
  name: web-nodeport         # Service 이름
  namespace: default
spec:
  type: NodePort             # NodePort 타입: 외부에서 노드IP:노드포트로 접근 가능
  selector:
    app: web-app             # app=web-app 레이블을 가진 Pod 선택
  ports:
  - name: http
    protocol: TCP
    port: 80                 # 클러스터 내부에서 사용하는 Service 포트
    targetPort: 8080         # Pod 컨테이너 포트
    nodePort: 30080          # 모든 노드에서 열리는 외부 포트 (30000-32767)
                             # 생략하면 범위 내에서 자동 할당
  externalTrafficPolicy: Cluster  # Cluster(기본): 모든 노드의 Pod로 분산
                                   # Local: 해당 노드의 Pod만 응답 (소스 IP 보존)
```

**NodePort 접근 경로:**

```
외부 클라이언트
    │
    │  dst: <NodeIP>:30080
    ▼
┌─────────────────────────────────────────┐
│  Node (어떤 노드든 가능)                │
│                                         │
│  iptables/eBPF: 30080 → Service 규칙    │
│      │                                  │
│      ▼                                  │
│  ClusterIP:80                           │
│      │                                  │
│      ▼                                  │
│  Pod IP:8080 (랜덤 선택)                │
└─────────────────────────────────────────┘

포트 구조:
nodePort(30080) → port(80) → targetPort(8080)
   외부접근용       Service      Pod 실제 포트
```

**externalTrafficPolicy 비교:**

| 구분 | Cluster (기본) | Local |
|---|---|---|
| 트래픽 분산 | 모든 노드의 Pod | 해당 노드의 Pod만 |
| 소스 IP | SNAT로 변경됨 | 원본 클라이언트 IP 보존 |
| 부하 분산 | 균등 | 불균등 가능 |
| Pod 없는 노드 | 다른 노드로 전달 | 연결 실패 |

### 2.4 LoadBalancer Service

> **LoadBalancer**: NodePort를 확장하여, Cloud Controller Manager가 클라우드 프로바이더 API를 호출해 외부 L4 로드밸런서(NLB/ALB 등)를 프로비저닝한다. 외부 LB는 할당된 External IP로 트래픽을 수신하고, 각 노드의 NodePort로 분산 전달한다. 즉 LoadBalancer = ClusterIP + NodePort + 외부 LB 3계층 구조이다.

```yaml
# LoadBalancer Service 전체 YAML
apiVersion: v1
kind: Service
metadata:
  name: web-lb
  namespace: production
  annotations:
    # 클라우드별 어노테이션 예시 (AWS)
    service.beta.kubernetes.io/aws-load-balancer-type: nlb
    service.beta.kubernetes.io/aws-load-balancer-internal: "false"
spec:
  type: LoadBalancer         # 외부 로드밸런서 프로비저닝 요청
  selector:
    app: web
  ports:
  - name: http
    port: 80                 # LB가 리스닝하는 포트
    targetPort: 8080         # Pod 포트
  - name: https
    port: 443
    targetPort: 8443
  loadBalancerSourceRanges:  # LB에 접근 가능한 소스 IP 제한
  - 203.0.113.0/24           # 이 CIDR에서만 접근 가능
  externalTrafficPolicy: Local  # 소스 IP 보존
```

**LoadBalancer 계층 구조:**

```
클라이언트
    │
    ▼
External Load Balancer (클라우드 제공)
    │  External IP: 52.78.100.50
    ▼
NodePort (자동 생성)
    │  nodePort: 32xxx (자동 할당)
    ▼
ClusterIP (자동 생성)
    │  clusterIP: 10.96.xxx.xxx
    ▼
Pod (selector 일치)

→ LoadBalancer = ClusterIP + NodePort + 외부 LB
```

### 2.5 ExternalName Service

> **ExternalName**: ClusterIP를 할당하지 않고, CoreDNS에 CNAME 레코드만 등록한다. 클러스터 내부에서 Service DNS 이름을 조회하면 spec.externalName에 지정된 외부 도메인의 CNAME이 반환되어, 별도의 프록시 없이 DNS 수준에서 외부 서비스로 리다이렉션된다.

```yaml
# ExternalName Service 전체 YAML
apiVersion: v1
kind: Service
metadata:
  name: external-db          # 클러스터 내부에서 사용할 이름
  namespace: demo
spec:
  type: ExternalName         # DNS CNAME을 생성하는 특수 타입
  externalName: db.example.com  # 외부 서비스의 실제 도메인
  # selector가 없다! Pod를 선택하지 않는다
  # ports도 없다! 포트 변환을 하지 않는다
```

**ExternalName DNS 동작:**

```
Pod에서 nslookup external-db.demo.svc.cluster.local 실행
    │
    ▼
CoreDNS가 CNAME 레코드 반환
    → external-db.demo.svc.cluster.local = db.example.com
    │
    ▼
Pod가 db.example.com의 실제 IP로 연결

※ 주의: ExternalName은 IP를 반환하지 않고 CNAME만 반환한다
※ HTTPS 사용 시 인증서 호스트명 검증에 주의해야 한다
```

### 2.6 Headless Service

> **Headless Service**: `clusterIP: None`으로 설정하면 Virtual IP가 할당되지 않는다. DNS A 레코드 조회 시 ClusterIP 대신 매칭된 모든 Pod의 개별 IP 주소가 반환된다. StatefulSet과 결합하면 각 Pod에 대해 `<pod-name>.<service-name>` 형식의 개별 DNS 레코드가 생성되어, 클라이언트가 특정 Pod를 직접 지정하여 통신할 수 있다.

```yaml
# Headless Service 전체 YAML
apiVersion: v1
kind: Service
metadata:
  name: db-headless           # Service 이름
  namespace: demo
spec:
  clusterIP: None             # 핵심! None으로 설정하면 Headless Service가 된다
  selector:
    app: postgres             # 일반 Service와 동일하게 Pod를 선택
  ports:
  - name: postgres
    port: 5432
    targetPort: 5432
```

**Headless vs 일반 ClusterIP 비교:**

```
일반 ClusterIP Service:
  nslookup my-svc → 10.96.100.50 (Service의 가상 IP 1개)

Headless Service (clusterIP: None):
  nslookup db-headless → 10.244.1.5   (Pod A의 실제 IP)
                          10.244.2.8   (Pod B의 실제 IP)
                          10.244.3.12  (Pod C의 실제 IP)

StatefulSet과 함께 사용 시:
  nslookup postgres-0.db-headless → 10.244.1.5  (특정 Pod에 직접 접근)
  nslookup postgres-1.db-headless → 10.244.2.8
  nslookup postgres-2.db-headless → 10.244.3.12
```

**Headless Service 사용 사례:**
- StatefulSet(데이터베이스, 메시지 큐)에서 개별 Pod에 안정적인 DNS로 접근
- 클라이언트가 직접 로드밸런싱을 수행하고 싶을 때
- 서비스 디스커버리를 위해 모든 Pod IP를 알아야 할 때

---

## 3. Service 관련 핵심 오브젝트

### 3.1 Endpoints 오브젝트

Service를 생성하면 자동으로 같은 이름의 Endpoints 오브젝트가 생성된다. Endpoints는 selector와 일치하는 Pod의 IP:Port 목록을 관리한다.

```
Service 생성 시:
┌──────────────┐     자동 생성     ┌──────────────────────┐
│  Service     │ ──────────────→  │  Endpoints           │
│  name: web   │                  │  name: web           │
│  selector:   │                  │  subsets:             │
│    app: web  │                  │  - addresses:         │
│  port: 80    │                  │    - ip: 10.244.1.5   │
└──────────────┘                  │    - ip: 10.244.2.8   │
                                  │    ports:             │
                                  │    - port: 8080       │
                                  └──────────────────────┘
```

```yaml
# Endpoints를 수동으로 확인
# kubectl get endpoints <service-name>

# 수동 Endpoints 생성 (selector 없는 Service에 연결)
apiVersion: v1
kind: Endpoints
metadata:
  name: external-service      # Service와 같은 이름이어야 한다
  namespace: demo
subsets:
- addresses:
  - ip: 192.168.1.100         # 외부 서버 IP
  - ip: 192.168.1.101
  ports:
  - port: 3306                # 외부 서버 포트
    protocol: TCP
---
apiVersion: v1
kind: Service
metadata:
  name: external-service      # Endpoints와 같은 이름
  namespace: demo
spec:
  # selector 없음! 수동 Endpoints와 연결
  ports:
  - port: 3306
    targetPort: 3306
```

### 3.2 EndpointSlice (v1.21+)

**등장 배경:** 기존 Endpoints 오브젝트는 Service당 하나만 존재하며, Pod가 수천 개인 대규모 클러스터에서 하나의 Endpoints 오브젝트가 매우 커진다. Pod 하나만 변경되어도 전체 Endpoints 오브젝트가 업데이트되어 kube-proxy에 전파되므로 API Server와 네트워크에 큰 부하를 유발하였다. EndpointSlice는 이 문제를 해결하기 위해 도입되었다.

```
Endpoints: 하나의 오브젝트에 모든 Pod IP가 포함
  → Pod 1000개면 하나의 거대한 Endpoints 오브젝트

EndpointSlice: 여러 작은 오브젝트로 분할 (기본 100개씩)
  → Pod 1000개면 10개의 EndpointSlice 오브젝트
  → 변경 시 해당 슬라이스만 업데이트 → 네트워크 효율 향상
```

### 3.3 sessionAffinity

```yaml
# sessionAffinity: 같은 클라이언트의 요청을 같은 Pod으로 보내는 설정
apiVersion: v1
kind: Service
metadata:
  name: sticky-svc
spec:
  selector:
    app: web
  ports:
  - port: 80
    targetPort: 8080
  sessionAffinity: ClientIP     # 같은 클라이언트 IP → 같은 Pod
  sessionAffinityConfig:
    clientIP:
      timeoutSeconds: 10800     # 3시간 동안 유지 (기본값)
```

---

## 4. CoreDNS 구조와 서비스 디스커버리

### 4.1 CoreDNS란?

> **CoreDNS**: 클러스터 내부 DNS 서버로, Kubernetes API를 Watch하여 Service/Pod 생성·삭제 이벤트를 실시간 반영한다. `<service>.<namespace>.svc.cluster.local` 형식의 FQDN에 대해 A/AAAA 레코드(ClusterIP) 또는 SRV 레코드(포트 정보)를 반환한다. kubelet이 각 Pod의 `/etc/resolv.conf`에 CoreDNS의 ClusterIP(기본 10.96.0.10)를 nameserver로 설정하여 자동으로 서비스 디스커버리가 동작한다.

```
CoreDNS 위치와 구성:

Namespace: kube-system
    │
    ├── Deployment: coredns (2개 레플리카)
    │   ├── Pod: coredns-xxxxxxxx-aaaaa
    │   └── Pod: coredns-xxxxxxxx-bbbbb
    │
    ├── Service: kube-dns
    │   └── ClusterIP: 10.96.0.10 (고정)
    │       ├── TCP 53 (DNS)
    │       └── UDP 53 (DNS)
    │
    └── ConfigMap: coredns
        └── Corefile (설정 파일)

모든 Pod의 /etc/resolv.conf:
  nameserver 10.96.0.10  ← kube-dns Service IP
  search demo.svc.cluster.local svc.cluster.local cluster.local
  ndots:5
```

### 4.2 DNS 레코드 형식 (반드시 암기!)

| 리소스 | DNS 형식 | 예시 |
|---|---|---|
| **Service** | `<svc>.<ns>.svc.cluster.local` | `nginx-web.demo.svc.cluster.local` |
| **Pod** | `<pod-ip-dashed>.<ns>.pod.cluster.local` | `10-244-1-5.demo.pod.cluster.local` |
| **StatefulSet Pod** | `<pod-name>.<svc>.<ns>.svc.cluster.local` | `postgres-0.db-headless.demo.svc.cluster.local` |

```
DNS 조회 단축 규칙:
같은 네임스페이스 내:
  curl http://nginx-web                              ← 가장 짧은 형태
  curl http://nginx-web.demo                         ← 네임스페이스 명시
  curl http://nginx-web.demo.svc                     ← svc까지
  curl http://nginx-web.demo.svc.cluster.local       ← FQDN (완전한 형태)

다른 네임스페이스:
  curl http://nginx-web.other-ns                     ← 최소한 네임스페이스 필요
  curl http://nginx-web.other-ns.svc.cluster.local   ← FQDN 권장
```

### 4.3 CoreDNS ConfigMap (Corefile)

```yaml
# CoreDNS ConfigMap 구조
apiVersion: v1
kind: ConfigMap
metadata:
  name: coredns
  namespace: kube-system
data:
  Corefile: |
    .:53 {                          # 포트 53에서 모든 DNS 쿼리 처리
        errors                      # 에러 로깅
        health {                    # /health 엔드포인트 (헬스체크)
            lameduck 5s             # 종료 전 5초 대기
        }
        ready                       # /ready 엔드포인트 (readiness)
        kubernetes cluster.local in-addr.arpa ip6.arpa {
            # 클러스터 도메인(cluster.local) DNS 처리
            pods insecure           # Pod DNS 레코드 생성 (insecure 모드)
            fallthrough in-addr.arpa ip6.arpa
            ttl 30                  # DNS 캐시 TTL 30초
        }
        prometheus :9153            # Prometheus 메트릭 노출
        forward . /etc/resolv.conf {# 클러스터 외부 도메인은 상위 DNS로 전달
            max_concurrent 1000     # 최대 동시 쿼리
        }
        cache 30                    # DNS 응답 30초 캐시
        loop                        # DNS 루프 감지
        reload                      # ConfigMap 변경 시 자동 리로드
        loadbalance                 # DNS 응답의 A 레코드 순서 라운드로빈
    }
```

### 4.4 Pod DNS 정책 (dnsPolicy)

```yaml
# dnsPolicy 종류별 설명
apiVersion: v1
kind: Pod
metadata:
  name: dns-example
spec:
  dnsPolicy: ClusterFirst      # 기본값. CoreDNS를 먼저 사용
  # dnsPolicy: Default          # 노드의 /etc/resolv.conf 사용
  # dnsPolicy: None             # dnsConfig에서 수동 지정
  # dnsPolicy: ClusterFirstWithHostNet  # hostNetwork=true일 때 CoreDNS 사용

  # dnsPolicy: None일 때 수동 설정
  dnsConfig:
    nameservers:
    - 8.8.8.8                   # Google DNS
    - 1.1.1.1                   # Cloudflare DNS
    searches:
    - my-domain.com             # 검색 도메인 추가
    options:
    - name: ndots
      value: "2"                # . 이 2개 미만이면 search 도메인 추가

  containers:
  - name: app
    image: nginx
```

### 4.5 DNS 조회 흐름

```
Pod에서 "nginx-web" 접속 요청:

1. Pod의 /etc/resolv.conf 확인
   nameserver 10.96.0.10
   search demo.svc.cluster.local svc.cluster.local cluster.local
   ndots:5

2. "nginx-web"에 dot(.)이 0개 → ndots(5)보다 작으므로
   search 도메인을 차례로 추가하여 조회:
   ① nginx-web.demo.svc.cluster.local → 성공! (Service 발견)

   만약 실패하면:
   ② nginx-web.svc.cluster.local
   ③ nginx-web.cluster.local
   ④ nginx-web (절대 이름으로 조회)

3. CoreDNS가 Service의 ClusterIP 반환
   → 10.96.50.100

4. Pod가 10.96.50.100으로 TCP 연결
```

---

## 5. kube-proxy와 Service 라우팅

### 5.1 kube-proxy 동작 모드

```
kube-proxy 3가지 모드:

1. iptables 모드 (기본)
   - 각 Service/Endpoints에 대해 iptables 규칙 생성
   - 커널 레벨에서 패킷 처리 → 빠름
   - 규칙 수가 많아지면 업데이트 느림 (O(n))

2. IPVS 모드
   - 리눅스 커널 IPVS(IP Virtual Server) 사용
   - 더 많은 로드밸런싱 알고리즘 지원
   - 대규모 클러스터에 적합 (O(1) 룩업)

3. eBPF 모드 (Cilium)
   - kube-proxy 완전 대체
   - 커널 레벨에서 eBPF 프로그램으로 처리
   - tart-infra가 사용하는 방식 (kubeProxyReplacement=true)
```

### 5.2 iptables 규칙 예시

```bash
# Service에 대한 iptables 규칙 확인
sudo iptables -t nat -L KUBE-SERVICES -n | grep <service-name>

# 예시 규칙 흐름:
# KUBE-SERVICES → KUBE-SVC-XXXX (Service 체인)
#   → KUBE-SEP-AAAA (Endpoint 1: 10.244.1.5:8080) - 33% 확률
#   → KUBE-SEP-BBBB (Endpoint 2: 10.244.2.8:8080) - 33% 확률
#   → KUBE-SEP-CCCC (Endpoint 3: 10.244.3.12:8080) - 33% 확률
```

### 5.3 트러블슈팅: Service 라우팅 문제

```
Service 트래픽이 Pod에 도달하지 않을 때 진단 흐름:

1. kubectl get endpoints <svc> → ENDPOINTS가 비어있는가?
   ├→ 비어있다 → selector와 Pod label 불일치 (가장 흔한 원인)
   │   해결: kubectl get svc <svc> -o jsonpath='{.spec.selector}'
   │         kubectl get pods --show-labels
   │         → selector 또는 Pod label 수정
   │
   └→ 채워져 있다 → targetPort 불일치 또는 Pod 내부 문제
       해결: kubectl get svc <svc> -o jsonpath='{.spec.ports[0].targetPort}'
             kubectl get pod <pod> -o jsonpath='{.spec.containers[0].ports[0].containerPort}'
             → 두 값이 일치하는지 확인

2. kube-proxy 또는 eBPF 규칙 확인
   sudo iptables -t nat -L KUBE-SERVICES -n | grep <svc-clusterip>
   → 규칙이 없으면 kube-proxy 재시작 필요

3. NetworkPolicy 확인
   kubectl get networkpolicy -n <ns>
   → 트래픽 차단 정책이 있는지 확인
```

---

## 6. Service 관련 kubectl 명령어 총정리

```bash
# ===== 빠른 생성 =====
# Deployment를 Service로 노출
kubectl expose deployment web-app --port=80 --target-port=8080 --type=ClusterIP
kubectl expose deployment web-app --port=80 --target-port=8080 --type=NodePort
kubectl expose deployment web-app --port=80 --type=NodePort --name=web-svc

# Pod를 Service로 노출
kubectl expose pod my-pod --port=80 --target-port=80 --name=pod-svc

# dry-run으로 YAML 생성 (시험에서 유용!)
kubectl expose deployment web-app --port=80 --type=NodePort \
  --dry-run=client -o yaml > svc.yaml

# ===== 조회 =====
kubectl get svc                          # 현재 네임스페이스의 Service
kubectl get svc -A                       # 모든 네임스페이스의 Service
kubectl get svc -o wide                  # selector 포함
kubectl get svc -n demo -o yaml          # YAML 형식
kubectl describe svc <name>              # 상세 정보
kubectl get endpoints <name>             # Endpoints 확인 (핵심!)
kubectl get endpointslices -l kubernetes.io/service-name=<name>

# ===== 수정 =====
kubectl edit svc <name>                  # 직접 편집
kubectl patch svc <name> -p '{"spec":{"type":"NodePort"}}'
kubectl patch svc <name> --type='json' \
  -p='[{"op":"replace","path":"/spec/ports/0/nodePort","value":31080}]'

# ===== DNS 테스트 =====
kubectl run dns-test --image=busybox:1.28 --rm -it --restart=Never -- \
  nslookup <svc-name>.<namespace>.svc.cluster.local
kubectl run dns-test --image=busybox:1.28 --rm -it --restart=Never -- \
  nslookup kubernetes.default.svc.cluster.local

# ===== 접근 테스트 =====
kubectl run curl-test --image=curlimages/curl --rm -it --restart=Never -- \
  curl -s http://<svc-name>.<namespace>.svc.cluster.local
```

---

## 7. 실전 YAML 예제 모음 (17개)

### 예제 1: 기본 ClusterIP Service

```yaml
apiVersion: v1
kind: Service
metadata:
  name: api-svc
  namespace: demo
spec:
  selector:
    app: api-server
  ports:
  - port: 8080
    targetPort: 8080
```

### 예제 2: NodePort 특정 포트 지정

```yaml
apiVersion: v1
kind: Service
metadata:
  name: web-nodeport
spec:
  type: NodePort
  selector:
    app: web
  ports:
  - port: 80
    targetPort: 8080
    nodePort: 30080       # 특정 NodePort 지정
```

### 예제 3: 멀티 포트 Service

```yaml
apiVersion: v1
kind: Service
metadata:
  name: rabbitmq-svc
  namespace: demo
spec:
  selector:
    app: rabbitmq
  ports:
  - name: amqp             # 멀티 포트 시 name 필수!
    port: 5672
    targetPort: 5672
  - name: management        # 각 포트에 이름 부여
    port: 15672
    targetPort: 15672
```

### 예제 4: Headless Service + StatefulSet

```yaml
apiVersion: v1
kind: Service
metadata:
  name: postgres-headless
  namespace: demo
spec:
  clusterIP: None           # Headless!
  selector:
    app: postgres
  ports:
  - name: postgres
    port: 5432
    targetPort: 5432
---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: postgres
  namespace: demo
spec:
  serviceName: postgres-headless   # Headless Service와 연결
  replicas: 3
  selector:
    matchLabels:
      app: postgres
  template:
    metadata:
      labels:
        app: postgres
    spec:
      containers:
      - name: postgres
        image: postgres:15
        ports:
        - containerPort: 5432
        env:
        - name: POSTGRES_PASSWORD
          value: "password"
  volumeClaimTemplates:
  - metadata:
      name: pgdata
    spec:
      accessModes: ["ReadWriteOnce"]
      resources:
        requests:
          storage: 5Gi
```

### 예제 5: ExternalName Service

```yaml
apiVersion: v1
kind: Service
metadata:
  name: external-api
  namespace: demo
spec:
  type: ExternalName
  externalName: api.external-service.com
```

### 예제 6: 수동 Endpoints (외부 서비스 연결)

```yaml
apiVersion: v1
kind: Service
metadata:
  name: legacy-db
  namespace: demo
spec:
  ports:
  - port: 3306
    targetPort: 3306
# selector 없음!
---
apiVersion: v1
kind: Endpoints
metadata:
  name: legacy-db           # Service와 동일한 이름
  namespace: demo
subsets:
- addresses:
  - ip: 192.168.1.50        # 외부 DB 서버 IP
  ports:
  - port: 3306
```

### 예제 7: sessionAffinity 활성화

```yaml
apiVersion: v1
kind: Service
metadata:
  name: sticky-web
spec:
  selector:
    app: web
  ports:
  - port: 80
    targetPort: 8080
  sessionAffinity: ClientIP
  sessionAffinityConfig:
    clientIP:
      timeoutSeconds: 3600   # 1시간 동안 같은 Pod으로
```

### 예제 8: externalTrafficPolicy: Local

```yaml
apiVersion: v1
kind: Service
metadata:
  name: web-local-traffic
spec:
  type: NodePort
  selector:
    app: web
  ports:
  - port: 80
    targetPort: 8080
    nodePort: 30090
  externalTrafficPolicy: Local  # 소스 IP 보존
```

### 예제 9: LoadBalancer 소스 IP 제한

```yaml
apiVersion: v1
kind: Service
metadata:
  name: restricted-lb
spec:
  type: LoadBalancer
  selector:
    app: secure-web
  ports:
  - port: 443
    targetPort: 8443
  loadBalancerSourceRanges:
  - 10.0.0.0/8               # 내부 네트워크만 허용
  - 203.0.113.50/32           # 특정 IP만 허용
```

### 예제 10: 포트 이름으로 targetPort 지정

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: flexible-app
spec:
  replicas: 2
  selector:
    matchLabels:
      app: flexible
  template:
    metadata:
      labels:
        app: flexible
    spec:
      containers:
      - name: app
        image: my-app:v1
        ports:
        - name: http-port        # 포트에 이름 부여
          containerPort: 8080
---
apiVersion: v1
kind: Service
metadata:
  name: flexible-svc
spec:
  selector:
    app: flexible
  ports:
  - port: 80
    targetPort: http-port        # 이름으로 참조! 컨테이너 포트가 바뀌어도 Service 수정 불필요
```

### 예제 11: Pod의 dnsPolicy와 dnsConfig

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: custom-dns-pod
spec:
  dnsPolicy: None
  dnsConfig:
    nameservers:
    - 8.8.8.8
    - 8.8.4.4
    searches:
    - my-company.com
    - svc.cluster.local
    options:
    - name: ndots
      value: "3"
  containers:
  - name: app
    image: nginx
```

### 예제 12: CoreDNS 커스텀 도메인 추가

```yaml
# CoreDNS ConfigMap 수정으로 커스텀 도메인 추가
apiVersion: v1
kind: ConfigMap
metadata:
  name: coredns
  namespace: kube-system
data:
  Corefile: |
    .:53 {
        errors
        health
        ready
        kubernetes cluster.local in-addr.arpa ip6.arpa {
            pods insecure
            fallthrough in-addr.arpa ip6.arpa
            ttl 30
        }
        forward . /etc/resolv.conf
        cache 30
        loop
        reload
        loadbalance
    }
    # 커스텀 도메인 추가
    example.local:53 {
        errors
        cache 30
        forward . 10.0.0.53    # 내부 DNS 서버로 전달
    }
```

### 예제 13: Service + Deployment 조합 (완전한 앱 배포)

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nginx-app
  namespace: demo
spec:
  replicas: 3
  selector:
    matchLabels:
      app: nginx-app
  template:
    metadata:
      labels:
        app: nginx-app
        version: v1
    spec:
      containers:
      - name: nginx
        image: nginx:1.24
        ports:
        - containerPort: 80
        resources:
          requests:
            cpu: 50m
            memory: 64Mi
          limits:
            cpu: 100m
            memory: 128Mi
        readinessProbe:
          httpGet:
            path: /
            port: 80
          initialDelaySeconds: 5
          periodSeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: nginx-app-svc
  namespace: demo
spec:
  type: NodePort
  selector:
    app: nginx-app            # Deployment의 Pod 레이블과 일치
  ports:
  - name: http
    port: 80
    targetPort: 80
    nodePort: 30088
```

### 예제 14: Headless Service DNS 테스트 Pod

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: dns-debug
  namespace: demo
spec:
  containers:
  - name: debug
    image: busybox:1.28
    command: ["sh", "-c", "while true; do sleep 3600; done"]
  # 이 Pod에서 다음 명령으로 DNS 테스트:
  # kubectl exec dns-debug -n demo -- nslookup nginx-web.demo.svc.cluster.local
  # kubectl exec dns-debug -n demo -- nslookup kubernetes.default.svc.cluster.local
```

### 예제 15: Service 여러 개가 같은 Pod를 가리키는 구성

```yaml
# 하나의 Pod에 여러 Service가 연결될 수 있다
apiVersion: v1
kind: Pod
metadata:
  name: multi-service-pod
  labels:
    app: web
    tier: frontend
    env: production
spec:
  containers:
  - name: web
    image: nginx
    ports:
    - containerPort: 80
    - containerPort: 443
---
# Service 1: 내부용 (ClusterIP)
apiVersion: v1
kind: Service
metadata:
  name: web-internal
spec:
  selector:
    app: web
  ports:
  - port: 80
    targetPort: 80
---
# Service 2: 외부용 (NodePort)
apiVersion: v1
kind: Service
metadata:
  name: web-external
spec:
  type: NodePort
  selector:
    app: web
    env: production       # 더 구체적인 selector
  ports:
  - port: 443
    targetPort: 443
    nodePort: 30443
```

### 예제 16: ipFamilyPolicy (IPv4/IPv6 듀얼 스택)

```yaml
apiVersion: v1
kind: Service
metadata:
  name: dual-stack-svc
spec:
  type: ClusterIP
  ipFamilyPolicy: PreferDualStack   # SingleStack, PreferDualStack, RequireDualStack
  ipFamilies:
  - IPv4
  - IPv6
  selector:
    app: web
  ports:
  - port: 80
    targetPort: 8080
```

### 예제 17: kubectl create service 명령으로 빠른 생성

```bash
# ClusterIP Service 빠른 생성
kubectl create service clusterip my-svc --tcp=80:8080

# NodePort Service 빠른 생성
kubectl create service nodeport my-np-svc --tcp=80:8080 --node-port=30080

# ExternalName Service 빠른 생성
kubectl create service externalname ext-svc --external-name=db.example.com
```

---

## tart-infra 실습

### 실습 환경 설정

```bash
# dev 클러스터 접속 (다양한 Service 타입이 배포된 환경)
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/dev.yaml
kubectl config use-context dev
```

### 실습 1: Service 타입별 실제 동작 확인

```bash
# demo 네임스페이스의 모든 Service 확인
kubectl get svc -n demo -o wide

# nginx NodePort Service 상세 확인
kubectl get svc nginx -n demo -o jsonpath='{.spec.type}{"\t"}{.spec.ports[0].nodePort}{"\n"}'

# Endpoints 확인 (Service와 Pod의 연결)
kubectl get endpoints -n demo
```

**예상 출력:**
```
NAME         TYPE        CLUSTER-IP      EXTERNAL-IP   PORT(S)          SELECTOR
nginx        NodePort    10.96.x.x       <none>        80:30080/TCP     app=nginx
postgresql   ClusterIP   10.96.x.x       <none>        5432/TCP         app=postgresql
redis        ClusterIP   10.96.x.x       <none>        6379/TCP         app=redis
rabbitmq     ClusterIP   10.96.x.x       <none>        5672/TCP         app=rabbitmq
keycloak     NodePort    10.96.x.x       <none>        8080:30888/TCP   app=keycloak
```

**동작 원리:**
1. ClusterIP는 클러스터 내부에서만 접근 가능한 가상 IP를 할당한다
2. NodePort는 ClusterIP에 추가로 모든 노드의 특정 포트(30080, 30888)를 열어 외부 접근을 허용한다
3. kube-proxy가 iptables/IPVS 규칙을 생성하여 ClusterIP → Pod IP로 DNAT 처리한다
4. Endpoints 오브젝트에 Label Selector와 매칭되는 Pod IP가 자동 등록된다

### 실습 2: CoreDNS와 서비스 디스커버리

```bash
# CoreDNS Pod 확인
kubectl get pods -n kube-system -l k8s-app=kube-dns

# DNS 조회 테스트 Pod 실행
kubectl run dnstest --image=busybox:1.36 -n demo --rm -it --restart=Never -- \
  nslookup nginx.demo.svc.cluster.local

# 다른 네임스페이스의 Service도 FQDN으로 접근 가능한지 확인
kubectl run dnstest2 --image=busybox:1.36 -n demo --rm -it --restart=Never -- \
  nslookup kubernetes.default.svc.cluster.local
```

**예상 출력:**
```
Name:      nginx.demo.svc.cluster.local
Address 1: 10.96.x.x nginx.demo.svc.cluster.local
```

**동작 원리:**
1. CoreDNS는 kube-system에서 실행되며 모든 Service의 DNS 레코드를 자동 생성한다
2. DNS 형식: `<service>.<namespace>.svc.cluster.local`
3. 같은 네임스페이스에서는 Service 이름만으로 접근 가능하다 (search domain 자동 설정)
4. Pod의 `/etc/resolv.conf`에 CoreDNS의 ClusterIP가 nameserver로 설정된다

### 실습 3: Service와 Pod 연결 관계 추적

```bash
# nginx Service의 Selector 확인
kubectl get svc nginx -n demo -o jsonpath='{.spec.selector}' | python3 -m json.tool

# 해당 Selector에 매칭되는 Pod 확인
kubectl get pods -n demo -l app=nginx -o wide

# EndpointSlice 상세 확인
kubectl get endpointslices -n demo -l kubernetes.io/service-name=nginx
```

**동작 원리:**
1. Service는 `spec.selector`로 대상 Pod를 동적으로 선택한다
2. Endpoints Controller가 Selector에 매칭되는 Ready Pod의 IP를 EndpointSlice에 등록한다
3. Pod가 추가/삭제되면 EndpointSlice가 자동 갱신되어 로드밸런싱 대상이 변경된다

