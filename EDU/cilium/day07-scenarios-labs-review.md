# Day 7: 실전 시나리오, 실습, 예제, 자가 점검

> 실전 시나리오(마이그레이션, Service Mesh, 멀티테넌시 등), 추가 기능, 핵심 개념 요약, 실습 과제, 예제 매니페스트, 디버깅 시나리오, 자가 점검 문항, 참고문헌을 다룬다.

---

## 제16장: 실전 시나리오

### 시나리오 A: Microsegmentation 구현

마이크로세그먼테이션은 각 서비스 간 통신을 최소 권한으로 제한하는 보안 패턴이다. 본 프로젝트의 네트워크 정책이 이 패턴을 구현하고 있다.

```bash
# tart-infra 프로젝트에서 microsegmentation 상태 확인

# 1. dev 클러스터 연결
export KUBECONFIG=kubeconfig/dev.yaml

# 2. 적용된 정책 확인
kubectl get cnp -n demo
# NAME                        AGE
# default-deny-all            ...
# allow-external-to-nginx     ...
# allow-nginx-to-httpbin      ...
# allow-nginx-to-redis        ...
# allow-nginx-egress          ...
# allow-httpbin-to-postgres   ...
# allow-httpbin-to-rabbitmq   ...
# allow-httpbin-to-keycloak   ...
# allow-keycloak-to-postgres  ...
# allow-external-to-keycloak  ...
# allow-istio-control-plane   ...

# 3. 정책 적용 상태 확인 (Endpoint별)
kubectl -n kube-system exec -it ds/cilium -- cilium endpoint list

# 4. 차단된 트래픽 확인
hubble observe -n demo --verdict DROPPED

# 5. 허용된 트래픽 확인
hubble observe -n demo --verdict FORWARDED
```

### 시나리오 B: 규정 준수 (Compliance)

금융, 의료 등 규제 환경에서 네트워크 격리가 법적 요구사항인 경우의 구현 패턴이다.

```yaml
# PCI-DSS 규정 준수: 카드 데이터 환경(CDE) 격리
apiVersion: cilium.io/v2
kind: CiliumClusterwideNetworkPolicy
metadata:
  name: pci-dss-isolation
spec:
  endpointSelector:
    matchLabels:
      compliance: pci-dss
  ingress:
    - fromEndpoints:
        - matchLabels:
            compliance: pci-dss        # PCI 범위 내 Pod만 허용
      toPorts:
        - ports:
            - port: "443"
              protocol: TCP
  egress:
    - toEndpoints:
        - matchLabels:
            compliance: pci-dss        # PCI 범위 내로만 통신
    - toEndpoints:
        - matchLabels:
            io.kubernetes.pod.namespace: kube-system
            k8s-app: kube-dns
      toPorts:
        - ports:
            - port: "53"
              protocol: ANY
  egressDeny:
    - toEntities:
        - world                         # 인터넷 접근 명시적 차단
```

### 시나리오 C: Egress Gateway

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

```
┌──────────────────────────────────────────────────────────────┐
│  Egress Gateway 동작                                          │
│                                                              │
│  일반 egress:                                                 │
│  Pod (10.0.1.5) → SNAT(노드 IP: 192.168.1.1) → 외부        │
│  Pod (10.0.2.8) → SNAT(노드 IP: 192.168.1.2) → 외부        │
│  → 노드마다 다른 소스 IP (외부 방화벽 규칙 관리 어려움)      │
│                                                              │
│  Egress Gateway:                                              │
│  Pod (10.0.1.5) → 터널 → Gateway 노드                       │
│                           → SNAT(고정 IP: 198.51.100.10)     │
│                           → 외부                             │
│  Pod (10.0.2.8) → 터널 → Gateway 노드                       │
│                           → SNAT(고정 IP: 198.51.100.10)     │
│                           → 외부                             │
│  → 항상 동일한 소스 IP (외부 방화벽에 단일 IP만 등록)        │
│                                                              │
│  활용 사례:                                                   │
│  - 외부 DB/API가 IP 기반 화이트리스트를 요구하는 경우        │
│  - SaaS 서비스의 IP 기반 접근 제어                           │
│  - 감사 로그에서 출발지 IP 추적이 필요한 경우                │
└──────────────────────────────────────────────────────────────┘
```

### 시나리오 D: Service Mesh 통합

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

본 프로젝트에서는 Cilium CNI와 Istio를 함께 사용하고 있다. `allow-istio-control-plane.yaml` 정책이 이 통합을 지원한다:

```
Cilium + Istio 공존 모드:
┌──────────────────────────────────────────────────────────────┐
│  L3/L4 정책: Cilium eBPF (CiliumNetworkPolicy)              │
│  L7 정책:    Istio Envoy sidecar (AuthorizationPolicy)      │
│  mTLS:       Istio mTLS (PeerAuthentication)                 │
│  관찰성:     Hubble (L3/L4) + Istio telemetry (L7)          │
│                                                              │
│  정책 적용 순서:                                              │
│  패킷 → Cilium TC eBPF (L3/L4) → Istio sidecar (L7)       │
│                                                              │
│  Cilium이 Istio sidecar 포트를 허용해야 한다:               │
│  - 15010: gRPC (istiod xDS)                                  │
│  - 15012: gRPC (istiod CA)                                   │
│  - 15014: HTTP (istiod debug)                                │
│  - 15017: Webhook (injection)                                │
│  - 15001: Envoy outbound                                     │
│  - 15006: Envoy inbound                                      │
└──────────────────────────────────────────────────────────────┘
```

### 시나리오 E: Gateway API 구현

Cilium은 Kubernetes Gateway API를 네이티브로 지원한다.

```yaml
# Gateway 리소스
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: cilium-gateway
spec:
  gatewayClassName: cilium
  listeners:
    - name: http
      protocol: HTTP
      port: 80
    - name: https
      protocol: HTTPS
      port: 443
      tls:
        mode: Terminate
        certificateRefs:
          - name: tls-secret
---
# HTTPRoute
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: api-route
spec:
  parentRefs:
    - name: cilium-gateway
  rules:
    - matches:
        - path:
            type: PathPrefix
            value: /api/v1
      backendRefs:
        - name: api-v1
          port: 80
          weight: 90
        - name: api-v2
          port: 80
          weight: 10      # 카나리 배포: 10% 트래픽
```

---

## 추가 기능

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

### Cluster Mesh 상세 설정

여러 Kubernetes 클러스터를 하나의 네트워크 평면으로 연결한다:

- 클러스터 간 Pod-to-Pod 직접 통신이 가능하다
- Global Service를 정의하여 멀티 클러스터 서비스 디스커버리를 지원한다
- 클러스터 간 Security Identity를 공유하여 통합 네트워크 정책을 적용한다
- 각 클러스터의 cilium-agent가 다른 클러스터의 etcd(또는 clustermesh-apiserver)에 연결하여 상태를 동기화한다

### Service Mesh (Sidecar-less) 상세

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
| Tetragon | eBPF 기반 런타임 보안 도구이다. 프로세스, 파일, 네트워크 활동을 커널 레벨에서 모니터링한다 |
| Maglev | Google의 consistent hashing 알고리즘이다. Backend 변경 시 커넥션 유실을 최소화한다 |
| DSR | Direct Server Return이다. 응답 패킷이 입구 노드를 우회하여 직접 클라이언트로 전달된다 |
| WireGuard | 노드 간 투명 암호화 프로토콜이다. 애플리케이션 수정 없이 모든 트래픽을 암호화한다 |

---

### 이 프로젝트에서의 실습 환경

이 프로젝트에서 Cilium은 모든 4개 클러스터의 CNI로 사용된다.

- 설치 스크립트: `scripts/install/06-install-cilium.sh`
- Helm values: `manifests/cilium-values.yaml`
- Hubble values: `manifests/hubble-values.yaml`
- kubeProxyReplacement: `true` (kube-proxy 완전 대체)
- IPAM 모드: cluster-pool
- 네트워크 정책: `manifests/network-policies/` 디렉토리에 11개 정책 정의
- 실습 대상 클러스터: dev (`kubeconfig/dev.yaml`)
- 클러스터 목록: platform, dev, staging, prod (`kubeconfig/` 디렉토리)

#### 클러스터별 kubeconfig 경로

| 클러스터 | kubeconfig | 용도 |
|----------|------------|------|
| platform | `kubeconfig/platform.yaml` | 모니터링, CI/CD, 인프라 도구 |
| dev | `kubeconfig/dev.yaml` | 개발 환경, Hubble UI 활성화, 정책 테스트 |
| staging | `kubeconfig/staging.yaml` | 스테이징 환경 |
| prod | `kubeconfig/prod.yaml` | 프로덕션 환경 |

#### 프로젝트 Cilium 설정 상세

```yaml
# manifests/cilium-values.yaml (본 프로젝트 설정)
kubeProxyReplacement: true     # kube-proxy 완전 대체

ipam:
  mode: cluster-pool            # Cilium 자체 IPAM
  operator:
    clusterPoolIPv4PodCIDRList: []  # 클러스터별 override

operator:
  replicas: 1                   # 단일 operator (소규모 클러스터)

resources:
  requests:
    cpu: 100m
    memory: 128Mi
  limits:
    memory: 512Mi
```

```yaml
# manifests/hubble-values.yaml (본 프로젝트 설정)
hubble:
  enabled: true
  relay:
    enabled: true               # Hubble Relay 활성화
  ui:
    enabled: true               # Hubble UI 활성화
    service:
      type: NodePort
      nodePort: 31235           # NodePort로 UI 접근
  metrics:
    enabled:
      - dns                     # DNS 질의/응답 메트릭
      - drop                    # 드롭 패킷 메트릭
      - tcp                     # TCP 연결 메트릭
      - flow                    # 플로우 메트릭
      - icmp                    # ICMP 메트릭
      - http                    # HTTP 요청/응답 메트릭
```

#### 프로젝트 네트워크 정책 요약 (11개)

| 파일 | 정책 이름 | 동작 |
|------|-----------|------|
| `default-deny.yaml` | default-deny-all | 모든 ingress 차단, DNS egress만 허용 |
| `allow-external-to-nginx.yaml` | allow-external-to-nginx | world/cluster → nginx-web:80 |
| `allow-external-to-keycloak.yaml` | allow-external-to-keycloak | world/cluster → keycloak:8080 |
| `allow-nginx-to-httpbin.yaml` | allow-nginx-to-httpbin | nginx-web → httpbin:80 (GET만, L7) |
| `allow-nginx-to-redis.yaml` | allow-nginx-to-redis | nginx-web → redis:6379 |
| `allow-nginx-egress.yaml` | allow-nginx-egress | nginx-web egress: httpbin, redis, DNS |
| `allow-httpbin-to-postgres.yaml` | allow-httpbin-to-postgres | httpbin → postgres:5432 |
| `allow-httpbin-to-rabbitmq.yaml` | allow-httpbin-to-rabbitmq | httpbin → rabbitmq:5672 |
| `allow-httpbin-to-keycloak.yaml` | allow-httpbin-to-keycloak | httpbin → keycloak:8080 |
| `allow-keycloak-to-postgres.yaml` | allow-keycloak-to-postgres | keycloak → postgres:5432 |
| `allow-istio-sidecars.yaml` | allow-istio-control-plane | istio-system ↔ demo (control plane 포트) |

```bash
# dev 클러스터에서 Cilium 상태 확인
export KUBECONFIG=kubeconfig/dev.yaml
cilium status
kubectl get ciliumnetworkpolicies -n demo

# 모든 정책 한번에 적용
kubectl apply -f manifests/network-policies/ -n demo

# 정책 적용 후 Endpoint 상태 확인
kubectl -n kube-system exec -it ds/cilium -- cilium endpoint list
```

---

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
# 프로젝트의 모든 네트워크 정책 적용
kubectl apply -f manifests/network-policies/

# 정책 적용 상태 확인
kubectl get cnp -n demo

# 정책이 실제로 eBPF에 반영되었는지 확인
kubectl -n kube-system exec -it ds/cilium -- cilium endpoint list
# → "policy-enabled" 컬럼이 "Ingress, Egress"로 표시되는지 확인

# 특정 정책의 상세 확인
kubectl get cnp allow-nginx-to-httpbin -n demo -o yaml

# 정책 효과 테스트: nginx에서 httpbin GET 요청 (허용)
kubectl exec -n demo deploy/nginx-web -- curl -s httpbin/get

# 정책 효과 테스트: nginx에서 httpbin POST 요청 (L7 정책에 의해 차단)
kubectl exec -n demo deploy/nginx-web -- curl -s -X POST httpbin/post
```

### 실습 5: 프로젝트의 Cilium 설정 분석

```bash
# Helm values 확인
cat manifests/cilium-values.yaml

# Hubble values 확인
cat manifests/hubble-values.yaml

# kube-proxy 대체 설정 확인
grep -A 5 "kubeProxyReplacement" manifests/cilium-values.yaml

# IPAM 모드 확인
grep -A 5 "ipam" manifests/cilium-values.yaml

# 네트워크 정책 파일 목록 확인
ls -la manifests/network-policies/
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
hubble observe --namespace demo

# 특정 Pod의 트래픽 모니터링
hubble observe --pod demo/nginx-web-xxxx

# Drop된 패킷만 확인 (정책 위반 트래픽)
hubble observe --verdict DROPPED

# L7 HTTP 플로우 확인
hubble observe --protocol http

# JSON 형식으로 출력 (스크립트 연동 시)
hubble observe --output json

# Hubble UI 접근 (NodePort)
# 브라우저에서 http://<노드IP>:31235 접속

# 또는 포트 포워딩
kubectl port-forward -n kube-system svc/hubble-ui 12000:80
# 브라우저에서 http://localhost:12000 접속
```

### 실습 7: cilium monitor를 통한 실시간 패킷 추적

```bash
# 모든 이벤트 관찰
kubectl -n kube-system exec -it ds/cilium -- cilium monitor

# 드롭된 패킷만 관찰
kubectl -n kube-system exec -it ds/cilium -- cilium monitor --type drop

# 특정 Endpoint의 트래픽만 관찰
kubectl -n kube-system exec -it ds/cilium -- cilium monitor --related-to <endpoint-id>

# L7 이벤트만 관찰 (HTTP, DNS 등)
kubectl -n kube-system exec -it ds/cilium -- cilium monitor --type l7

# 디버그 레벨 모니터링
kubectl -n kube-system exec -it ds/cilium -- cilium monitor -v

# Policy verdict 이벤트만
kubectl -n kube-system exec -it ds/cilium -- cilium monitor --type policy-verdict
```

### 실습 8: 멀티 클러스터 Cilium 상태 비교

```bash
# 모든 클러스터의 Cilium 상태를 순차적으로 확인
for cluster in platform dev staging prod; do
  echo "=== Cluster: $cluster ==="
  KUBECONFIG=kubeconfig/${cluster}.yaml cilium status 2>/dev/null || echo "Not reachable"
  echo ""
done

# 특정 클러스터의 Cilium 버전 확인
for cluster in platform dev staging prod; do
  echo -n "$cluster: "
  KUBECONFIG=kubeconfig/${cluster}.yaml \
    kubectl -n kube-system exec ds/cilium -- cilium version 2>/dev/null \
    | head -1 || echo "N/A"
done
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

### 예제 6: Bandwidth Limiting

```yaml
# bandwidth-limited-pod.yaml
apiVersion: v1
kind: Pod
metadata:
  name: bandwidth-test
  namespace: demo
  annotations:
    kubernetes.io/egress-bandwidth: "10M"   # Egress 10Mbps 제한
    kubernetes.io/ingress-bandwidth: "50M"  # Ingress 50Mbps 제한
spec:
  containers:
    - name: iperf
      image: networkstatic/iperf3
      command: ["iperf3", "-s"]
```

### 예제 7: WireGuard 암호화 활성화

```yaml
# cilium-encryption-values.yaml
encryption:
  enabled: true
  type: wireguard
  wireguard:
    userspaceFallback: false    # 커널 모드만 사용
```

```bash
# WireGuard 상태 확인
cilium status | grep Encryption

# 노드 간 WireGuard 터널 확인
kubectl -n kube-system exec -it ds/cilium -- \
  cilium encrypt status

# WireGuard 인터페이스 확인
kubectl -n kube-system exec -it ds/cilium -- \
  ip link show cilium_wg0
```

---

## 디버깅 시나리오

### 시나리오 1: Pod 간 통신이 안 되는 경우

위 실습 참조 (제15장 시나리오 1)

### 시나리오 2: Service 접근이 안 되는 경우

위 실습 참조 (제15장 시나리오 2)

### 시나리오 3: DNS 기반 정책이 동작하지 않는 경우

위 실습 참조 (제15장 시나리오 3)

### 시나리오 4: cilium-agent가 NotReady인 경우

위 실습 참조 (제15장 시나리오 4)

### 시나리오 5: 성능 문제 진단

위 실습 참조 (제15장 시나리오 5)

---

## 자가 점검

### eBPF 기초
- [ ] eBPF가 무엇이고, Verifier와 JIT의 역할을 설명할 수 있는가?
- [ ] eBPF 레지스터 구성(R0~R10)과 각 레지스터의 용도를 설명할 수 있는가?
- [ ] eBPF Map의 종류(Hash, Array, LRU, LPM Trie, Ring Buffer)와 Cilium에서의 활용 방식을 설명할 수 있는가?
- [ ] eBPF Helper Function이 무엇이고, 프로그램 타입별로 사용 가능한 Helper가 다른 이유를 설명할 수 있는가?
- [ ] Tail Call의 용도와 제한사항을 설명할 수 있는가?
- [ ] XDP, TC, Socket, cgroup 프로그램 타입의 차이를 설명할 수 있는가?

### Cilium 아키텍처
- [ ] cilium-agent, cilium-operator, cilium-cni, Envoy의 역할을 각각 설명할 수 있는가?
- [ ] cilium-agent 내부 구조(K8s Watchers, Endpoint Manager, Datapath Layer)를 설명할 수 있는가?
- [ ] Endpoint의 생명주기(create → regeneration → ready → delete)를 설명할 수 있는가?
- [ ] CiliumNode, CiliumIdentity, CiliumEndpoint 등 CRD의 용도를 설명할 수 있는가?

### 네트워킹
- [ ] Cilium이 kube-proxy를 대체하는 원리(Socket-Level LB, XDP)를 설명할 수 있는가?
- [ ] IPAM 모드(cluster-pool, kubernetes, eni 등)의 차이를 설명할 수 있는가?
- [ ] Security Identity 시스템의 동작 원리를 설명할 수 있는가?
- [ ] Encapsulation(VXLAN, Geneve)과 Direct Routing의 차이를 설명할 수 있는가?
- [ ] Host-Routing 모드의 성능 이점과 활성화 조건을 설명할 수 있는가?
- [ ] DSR(Direct Server Return)의 동작 원리와 장단점을 설명할 수 있는가?

### 보안
- [ ] CiliumNetworkPolicy와 Kubernetes NetworkPolicy의 차이를 설명할 수 있는가?
- [ ] L3/L4/L7 정책의 차이를 예제와 함께 설명할 수 있는가?
- [ ] FQDN 기반 Egress 정책의 동작 원리를 설명할 수 있는가?
- [ ] Entity 기반 정책(world, host, cluster 등)을 활용할 수 있는가?
- [ ] 제로 트러스트 네트워크 모델의 핵심 원칙과 구현 단계를 설명할 수 있는가?
- [ ] Mutual Authentication(SPIFFE)의 동작 원리를 설명할 수 있는가?
- [ ] 정책 감사 모드(Audit Mode)의 용도를 설명할 수 있는가?

### 고급 기능
- [ ] Cluster Mesh의 구조와 활용 시나리오를 설명할 수 있는가?
- [ ] Cilium Service Mesh가 기존 sidecar 방식과 어떻게 다른지 설명할 수 있는가?
- [ ] WireGuard와 IPsec 투명 암호화의 차이를 설명할 수 있는가?
- [ ] Maglev 해싱의 동작 원리와 이점을 설명할 수 있는가?
- [ ] Bandwidth Manager(EDT, BBR)의 동작 원리를 설명할 수 있는가?
- [ ] BGP Control Plane을 사용한 라우트 광고를 설명할 수 있는가?
- [ ] Egress Gateway의 동작 원리와 활용 시나리오를 설명할 수 있는가?
- [ ] Tetragon의 TracingPolicy로 런타임 보안을 구현할 수 있는가?

### 운영
- [ ] Hubble을 사용하여 네트워크 플로우를 모니터링할 수 있는가?
- [ ] Cilium 메트릭을 Prometheus/Grafana로 수집하고 대시보드를 구성할 수 있는가?
- [ ] CT/NAT 테이블 크기 튜닝과 성능 영향을 이해하고 있는가?
- [ ] cilium status, monitor, bpf 명령어로 문제를 진단할 수 있는가?
- [ ] 공통 Drop Reason(POLICY_DENIED, CT_MAP_INSERTION_FAILED 등)의 원인과 해결법을 알고 있는가?
- [ ] 본 프로젝트의 11개 네트워크 정책이 구현하는 통신 흐름을 설명할 수 있는가?

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
- [Tetragon 문서](https://tetragon.io/docs/) - Tetragon 런타임 보안 도구의 공식 문서이다
- [SPIFFE 표준](https://spiffe.io/) - Workload Identity Framework 표준이다
- [Maglev 논문](https://research.google/pubs/pub44824/) - Google의 Maglev consistent hashing 논문이다
- [WireGuard 백서](https://www.wireguard.com/papers/wireguard.pdf) - WireGuard 프로토콜 기술 명세이다
- [Cilium BGP Control Plane](https://docs.cilium.io/en/stable/network/bgp-control-plane/) - BGP 피어링 설정 가이드이다
- [Kubernetes Gateway API](https://gateway-api.sigs.k8s.io/) - Gateway API 표준 문서이다
