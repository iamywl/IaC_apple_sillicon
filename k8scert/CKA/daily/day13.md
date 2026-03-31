# CKA Day 13: NetworkPolicy & Ingress 기초

> CKA 도메인: **Services & Networking (20%)** - Part 2 | 예상 소요 시간: 3시간

---

## 학습 목표

- [ ] NetworkPolicy의 ingress/egress 규칙을 완벽히 이해한다
- [ ] AND 조건과 OR 조건의 차이를 YAML 들여쓰기로 정확히 구분할 수 있다
- [ ] Default Deny 패턴을 즉시 작성할 수 있다
- [ ] Egress 정책에서 DNS(포트 53) 허용의 중요성을 이해한다
- [ ] Ingress 리소스(path-based, host-based, TLS)를 생성한다
- [ ] CNI 플러그인의 역할과 확인 방법을 숙지한다
- [ ] 시험 패턴 12개 이상을 시간 내에 해결한다

---

## 1. NetworkPolicy란 무엇인가?

### 1.1 NetworkPolicy의 설계 원리

> **NetworkPolicy = Pod 수준 L3/L4 트래픽 필터링 규칙**
>
> Kubernetes 네트워크 모델은 기본적으로 모든 Pod 간 통신을 허용(Default Allow)한다.
> NetworkPolicy는 podSelector로 대상 Pod를 지정하고, Ingress/Egress 규칙을 통해
> 허용할 소스/목적지를 명시적으로 선언하는 화이트리스트 방식의 접근 제어를 수행한다.
>
> - Ingress 규칙: 지정된 Pod로 유입되는 인바운드 트래픽의 소스(Pod/Namespace/CIDR)와 포트를 제한
> - Egress 규칙: 지정된 Pod에서 나가는 아웃바운드 트래픽의 목적지와 포트를 제한
>
> 핵심 원칙: **하나 이상의 NetworkPolicy가 Pod에 적용되면 해당 방향의 트래픽은
> 명시적으로 허용된 것만 통과**하며, 매칭되는 NetworkPolicy가 없는 Pod는 여전히 Default Allow 상태이다.
> 실제 패킷 필터링은 CNI 플러그인(Cilium, Calico 등)이 eBPF 또는 iptables 규칙으로 구현한다.

### 1.2 등장 배경: 왜 NetworkPolicy가 필요한가?

Kubernetes의 기본 네트워크 모델은 모든 Pod 간 통신을 허용(Flat Network)한다. 이는 개발 편의성에는 좋지만, 프로덕션 환경에서는 보안 위험이다. 예를 들어 frontend Pod가 해킹당하면 database Pod에 직접 접근할 수 있다. 전통적인 방화벽 규칙은 IP 기반이므로 Pod IP가 동적으로 변경되는 Kubernetes 환경에 적합하지 않다. NetworkPolicy는 Label Selector 기반으로 동작하여 Pod IP에 의존하지 않고 접근 제어를 수행한다.

### 1.3 NetworkPolicy 핵심 원칙

```
NetworkPolicy 기본 규칙:

1. NetworkPolicy가 없으면 → 모든 트래픽 허용 (Default Allow)
2. NetworkPolicy가 하나라도 적용되면 → 명시적으로 허용한 트래픽만 통과
3. NetworkPolicy는 네임스페이스 수준 리소스이다
4. CNI 플러그인이 NetworkPolicy를 지원해야 한다
   지원: Cilium, Calico, Weave Net
   미지원: Flannel (NetworkPolicy 생성은 가능하지만 실제 적용 안 됨)

5. NetworkPolicy는 "화이트리스트" 방식이다
   → 정책이 있으면 기본 차단, 명시된 것만 허용
   → 정책이 없으면 전부 허용
```

### 1.4 NetworkPolicy의 내부 동작 원리

NetworkPolicy 객체 자체는 트래픽을 필터링하지 않는다. CNI 플러그인이 API Server를 Watch하여 NetworkPolicy 변경을 감지하고, 이를 실제 네트워크 규칙으로 변환한다. Cilium의 경우 eBPF 프로그램으로 변환하여 커널에 로드하고, Calico의 경우 iptables 체인을 생성한다. 여러 NetworkPolicy가 같은 Pod에 적용되면 모든 정책의 허용 규칙이 UNION(합집합)으로 결합된다. 즉, 어느 하나의 정책이라도 허용하면 트래픽은 통과한다. 반대로, 정책이 하나라도 적용되면 해당 방향의 기본 동작은 "전부 차단"으로 변경되며, 명시적으로 허용된 트래픽만 통과한다.

### 1.5 NetworkPolicy의 구조 (한 줄씩 설명)

```yaml
apiVersion: networking.k8s.io/v1    # NetworkPolicy API 그룹
kind: NetworkPolicy                  # 리소스 종류
metadata:
  name: backend-policy               # 정책 이름
  namespace: demo                    # 이 정책이 적용되는 네임스페이스
spec:
  podSelector:                       # ★ 이 정책이 "적용되는" Pod를 선택
    matchLabels:                     # 비어있으면({}) 네임스페이스의 모든 Pod
      app: backend                   # app=backend 레이블을 가진 Pod에 적용

  policyTypes:                       # ★ 정책 방향 (Ingress, Egress, 또는 둘 다)
  - Ingress                          # 인바운드(들어오는) 트래픽 제어
  - Egress                           # 아웃바운드(나가는) 트래픽 제어

  ingress:                           # ★ 인바운드 규칙 목록
  - from:                            # 트래픽 소스 정의
    - podSelector:                   # 소스 Pod 조건
        matchLabels:
          app: frontend              # app=frontend Pod에서 오는 트래픽 허용
    - namespaceSelector:             # 소스 네임스페이스 조건
        matchLabels:
          env: monitoring            # env=monitoring 네임스페이스에서 오는 트래픽 허용
    ports:                           # 허용할 포트
    - protocol: TCP
      port: 8080                     # TCP 8080 포트만 허용

  egress:                            # ★ 아웃바운드 규칙 목록
  - to:                              # 트래픽 대상 정의
    - podSelector:
        matchLabels:
          app: postgres              # app=postgres Pod로 나가는 트래픽 허용
    ports:
    - protocol: TCP
      port: 5432                     # TCP 5432 포트만 허용
  - to: []                           # 모든 대상 (DNS 허용용)
    ports:
    - protocol: UDP
      port: 53                       # DNS(UDP 53) 허용
    - protocol: TCP
      port: 53                       # DNS(TCP 53) 허용
```

---

## 2. OR 조건 vs AND 조건 (CKA 최빈출!)

### 2.1 이것이 가장 중요하다

> CKA 시험에서 NetworkPolicy 문제가 나오면, OR 조건과 AND 조건의 구분을 정확히 해야 한다.
> YAML에서 `-` (대시) 하나의 차이로 완전히 다른 의미가 된다.

### 2.2 OR 조건 (from 배열에 별도 항목)

```yaml
# OR 조건: "frontend Pod" 또는 "monitoring 네임스페이스의 모든 Pod"
# → 2개의 독립적인 규칙
ingress:
- from:
  - podSelector:                 # ← 첫 번째 규칙 (독립)
      matchLabels:
        app: frontend
  - namespaceSelector:           # ← 두 번째 규칙 (독립)
      matchLabels:
        env: monitoring
  ports:
  - protocol: TCP
    port: 8080
```

```
OR 조건 해석:
┌─────────────────────────────┐
│ 허용되는 트래픽:             │
│                             │
│ 규칙 1: 같은 네임스페이스의  │
│   app=frontend Pod에서      │ → TCP 8080
│         OR                  │
│ 규칙 2: env=monitoring      │
│   네임스페이스의 모든 Pod    │ → TCP 8080
└─────────────────────────────┘

핵심: 둘 중 하나만 만족하면 허용
```

### 2.3 AND 조건 (from 배열 내 하나의 항목)

```yaml
# AND 조건: "monitoring 네임스페이스"의 "frontend Pod"만
# → 1개의 규칙에 2개 조건
ingress:
- from:
  - podSelector:                 # ← 하나의 규칙에
      matchLabels:               #    두 조건이 결합
        app: frontend
    namespaceSelector:           # ← 들여쓰기 주의! `-` 없음!
      matchLabels:
        env: monitoring
  ports:
  - protocol: TCP
    port: 8080
```

```
AND 조건 해석:
┌─────────────────────────────┐
│ 허용되는 트래픽:             │
│                             │
│ 규칙: env=monitoring        │
│   네임스페이스에 속하면서    │
│         AND                 │
│   app=frontend 레이블을 가진│
│   Pod에서만                 │ → TCP 8080
└─────────────────────────────┘

핵심: 두 조건을 모두 만족해야 허용
```

### 2.4 시각적 비교

```yaml
# ===== OR 조건 =====
from:
- podSelector:         # ← '-' 있음 (독립 규칙 1)
    matchLabels:
      app: frontend
- namespaceSelector:   # ← '-' 있음 (독립 규칙 2)
    matchLabels:
      env: monitoring

# ===== AND 조건 =====
from:
- podSelector:         # ← '-' 있음 (규칙 시작)
    matchLabels:
      app: frontend
  namespaceSelector:   # ← '-' 없음! (같은 규칙 내 추가 조건)
    matchLabels:
      env: monitoring
```

> **암기법**: `-`가 2개이면 OR(또는), `-`가 1개이면 AND(그리고)

---

## 3. Default Deny 패턴 (시험 필수 암기!)

### 3.1 모든 인바운드 차단

```yaml
# 네임스페이스의 모든 Pod로 들어오는 모든 트래픽을 차단
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: deny-all-ingress        # 정책 이름
  namespace: demo                # 적용 네임스페이스
spec:
  podSelector: {}               # {} = 모든 Pod에 적용
  policyTypes:
  - Ingress                     # Ingress 방향만 제어
  # ingress 규칙을 비워둠 → 모든 인바운드 차단!
```

**검증 명령어 + 기대 출력:**

```bash
kubectl apply -f deny-all-ingress.yaml
kubectl describe networkpolicy deny-all-ingress -n demo
```

```text
Name:         deny-all-ingress
Namespace:    demo
Created on:   ...
Labels:       <none>
Spec:
  PodSelector:     <none> (Allowing the specific traffic to all pods in this namespace)
  Allowing ingress traffic:
    <none> (Selected pods are isolated for ingress connectivity)
  Not affecting egress traffic
  Policy Types: Ingress
```

**트러블슈팅:** Default Deny를 적용한 후 모든 통신이 안 된다면, 이 정책 위에 허용 정책을 추가해야 한다. NetworkPolicy는 UNION이므로 deny-all 위에 allow 정책을 추가하면 해당 트래픽만 허용된다.

### 3.2 모든 아웃바운드 차단

```yaml
# 네임스페이스의 모든 Pod에서 나가는 모든 트래픽을 차단
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: deny-all-egress
  namespace: demo
spec:
  podSelector: {}
  policyTypes:
  - Egress                      # Egress 방향만 제어
  # egress 규칙을 비워둠 → 모든 아웃바운드 차단!
  # 주의: DNS도 차단되므로 서비스 이름 해석 불가!
```

### 3.3 모든 트래픽 차단 (인바운드 + 아웃바운드)

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: deny-all
  namespace: demo
spec:
  podSelector: {}
  policyTypes:
  - Ingress
  - Egress
  # 양방향 모두 차단
```

### 3.4 특정 Pod만 격리

```yaml
# app=sensitive 레이블을 가진 Pod만 격리 (나머지는 영향 없음)
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: isolate-sensitive
  namespace: demo
spec:
  podSelector:
    matchLabels:
      app: sensitive            # 이 레이블을 가진 Pod만 격리
  policyTypes:
  - Ingress
  - Egress
  # 규칙 없음 → app=sensitive Pod는 모든 트래픽 차단
```

---

## 4. Egress에서 DNS 허용 (절대 잊지 마라!)

### 4.1 왜 DNS를 허용해야 하는가?

```
Egress 정책을 설정할 때 DNS(포트 53)를 허용하지 않으면:

Pod:  "postgres.demo.svc.cluster.local에 접속하고 싶다"
  │
  ├→ DNS 쿼리 (UDP 53) → CoreDNS
  │   ↑ 여기서 차단됨! Egress 정책이 53 포트를 막고 있으므로
  │
  └→ 서비스 이름을 IP로 변환할 수 없음
     → 연결 실패!

해결: Egress 정책에 항상 DNS 허용 규칙을 추가한다
```

### 4.2 DNS 허용 패턴

```yaml
egress:
# 규칙 1: DNS 허용 (필수!)
- ports:
  - protocol: UDP
    port: 53
  - protocol: TCP
    port: 53
  # to를 생략하면 모든 대상으로의 DNS 쿼리 허용

# 규칙 2: 실제 허용할 트래픽
- to:
  - podSelector:
      matchLabels:
        app: postgres
  ports:
  - protocol: TCP
    port: 5432
```

### 4.3 kube-system 네임스페이스의 CoreDNS로만 제한

```yaml
# 더 안전한 방법: CoreDNS Pod로만 DNS 쿼리 허용
egress:
- to:
  - namespaceSelector:
      matchLabels:
        kubernetes.io/metadata.name: kube-system
    podSelector:
      matchLabels:
        k8s-app: kube-dns
  ports:
  - protocol: UDP
    port: 53
  - protocol: TCP
    port: 53
```

---

## 5. NetworkPolicy 실전 패턴

### 5.1 특정 Pod 간 통신만 허용

```yaml
# web → backend → database 3계층 아키텍처
# database는 backend에서만 접근 가능

apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: db-access-policy
  namespace: demo
spec:
  podSelector:
    matchLabels:
      tier: database             # database Pod에 적용
  policyTypes:
  - Ingress
  ingress:
  - from:
    - podSelector:
        matchLabels:
          tier: backend          # backend Pod에서만 접근 허용
    ports:
    - protocol: TCP
      port: 5432                 # PostgreSQL 포트만 허용
```

### 5.2 네임스페이스 간 통신 허용

```yaml
# monitoring 네임스페이스에서 demo 네임스페이스의 메트릭 수집 허용
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-monitoring
  namespace: demo
spec:
  podSelector: {}               # demo의 모든 Pod에 적용
  policyTypes:
  - Ingress
  ingress:
  - from:
    - namespaceSelector:
        matchLabels:
          kubernetes.io/metadata.name: monitoring  # monitoring NS에서
      podSelector:
        matchLabels:
          app: prometheus        # prometheus Pod만 (AND 조건!)
    ports:
    - protocol: TCP
      port: 9090                 # 메트릭 포트만
```

### 5.3 외부(인터넷) 접근 제한

```yaml
# 특정 CIDR 대역만 접근 허용
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-external-cidr
  namespace: demo
spec:
  podSelector:
    matchLabels:
      app: web
  policyTypes:
  - Ingress
  ingress:
  - from:
    - ipBlock:
        cidr: 0.0.0.0/0          # 모든 IP에서
        except:
        - 10.0.0.0/8             # 단, 내부 네트워크 제외
    ports:
    - protocol: TCP
      port: 443
```

### 5.4 ipBlock 사용법

```yaml
# ipBlock: IP 주소 대역으로 트래픽 제어
from:
- ipBlock:
    cidr: 172.17.0.0/16          # 이 CIDR에서 오는 트래픽 허용
    except:                      # 단, 이 범위는 제외
    - 172.17.1.0/24              # 이 서브넷은 차단

# 주의: ipBlock은 Pod-to-Pod 트래픽에는 보통 사용하지 않는다
#        외부(클러스터 밖) IP를 제어할 때 사용한다
```

### 5.5 여러 포트 허용

```yaml
ingress:
- from:
  - podSelector:
      matchLabels:
        app: client
  ports:
  - protocol: TCP
    port: 8080                   # HTTP
  - protocol: TCP
    port: 8443                   # HTTPS
  - protocol: TCP
    port: 9090                   # 메트릭
    endPort: 9099                # 포트 범위 (9090-9099)
```

---

## 6. Ingress 리소스

### 6.1 Ingress란?

> **Ingress**: 클러스터 외부의 HTTP(S) 트래픽을 내부 Service로 라우팅하는 L7 규칙 선언 리소스이다.
> Host 헤더 기반 가상 호스트 라우팅과 URI Path 기반 라우팅을 지원하며,
> TLS termination, 경로 재작성 등 L7 기능을 선언적으로 정의한다.
>
> Ingress 리소스 자체는 규칙 정의에 불과하며, 실제 트래픽 처리는
> Ingress Controller(NGINX, Traefik, HAProxy 등)가 Ingress 오브젝트를 Watch하여
> 리버스 프록시 설정을 동적으로 생성·적용함으로써 수행된다.

**등장 배경:** NodePort나 LoadBalancer Service만으로는 경로 기반 라우팅(`/api` → api-svc, `/web` → web-svc)이 불가능하다. 서비스마다 별도의 LoadBalancer를 할당하면 비용이 증가한다. Ingress는 하나의 진입점(IP/포트)에서 Host 헤더와 URI Path를 기준으로 여러 Service에 트래픽을 분배하는 L7 라우팅을 제공한다.

### 6.2 Ingress 구성 요소

```
Ingress 관련 3가지 리소스:

1. Ingress Controller (실제 트래픽 라우팅 수행하는 Pod)
   - nginx-ingress-controller
   - traefik
   - HAProxy
   - 등등
   ※ 반드시 설치해야 Ingress가 동작한다!

2. IngressClass (어떤 Controller가 처리할지 지정)
   - nginx, traefik 등의 클래스 정의
   - 기본 IngressClass 설정 가능

3. Ingress (라우팅 규칙 정의)
   - 호스트 기반, 경로 기반 라우팅
   - TLS 종료

외부 트래픽 흐름:
  클라이언트 → Load Balancer → Ingress Controller Pod
      → Ingress 규칙에 따라 → 적절한 Service → Pod
```

### 6.3 Ingress 전체 YAML (한 줄씩 설명)

```yaml
apiVersion: networking.k8s.io/v1    # Ingress API 그룹 (v1, 정식 버전)
kind: Ingress                        # 리소스 종류
metadata:
  name: app-ingress                  # Ingress 이름
  namespace: demo                    # 네임스페이스
  annotations:                       # Controller별 추가 설정
    nginx.ingress.kubernetes.io/rewrite-target: /  # URL 재작성
    nginx.ingress.kubernetes.io/ssl-redirect: "false"  # HTTPS 리다이렉트 비활성
spec:
  ingressClassName: nginx            # 사용할 IngressClass (어떤 Controller가 처리)
  tls:                               # TLS/HTTPS 설정
  - hosts:
    - myapp.example.com              # TLS가 적용될 호스트
    secretName: tls-secret           # TLS 인증서가 저장된 Secret
  rules:                             # 라우팅 규칙
  - host: myapp.example.com         # 호스트 기반 라우팅 (생략하면 모든 호스트)
    http:
      paths:
      - path: /api                   # 경로 기반 라우팅
        pathType: Prefix             # 매칭 방식: Prefix, Exact, ImplementationSpecific
        backend:
          service:
            name: api-svc            # 트래픽을 전달할 Service 이름
            port:
              number: 80             # Service 포트
      - path: /                      # 기본 경로 (다른 규칙에 매칭되지 않으면)
        pathType: Prefix
        backend:
          service:
            name: web-svc            # 웹 프론트엔드 Service
            port:
              number: 80
  defaultBackend:                    # 어떤 규칙에도 매칭되지 않을 때
    service:
      name: default-svc
      port:
        number: 80
```

### 6.4 pathType 종류

```
pathType 비교:

1. Exact: 정확히 일치
   path: /api → /api만 매칭
                /api/ 매칭 안 됨
                /api/v1 매칭 안 됨

2. Prefix: 접두사 매칭 (가장 많이 사용)
   path: /api → /api 매칭
                /api/ 매칭
                /api/v1 매칭
                /api/v1/users 매칭
                /apiv2 매칭 안 됨 (/ 단위로 매칭)

3. ImplementationSpecific: Controller 구현에 따라 다름
   → 시험에서는 거의 사용하지 않음

시험에서는 대부분 Prefix를 사용한다!
```

### 6.5 Ingress 검증 방법

```bash
# Ingress 생성 후 검증
kubectl get ingress app-ingress -n demo
```

```text
NAME          CLASS   HOSTS              ADDRESS        PORTS     AGE
app-ingress   nginx   myapp.example.com  192.168.1.x    80, 443   10s
```

```bash
# Ingress 상세 확인
kubectl describe ingress app-ingress -n demo
```

```text
Rules:
  Host               Path  Backends
  ----               ----  --------
  myapp.example.com
                     /api   api-svc:80 (10.244.1.5:80,10.244.2.8:80)
                     /      web-svc:80 (10.244.3.12:80)
```

**트러블슈팅:** Ingress를 생성했는데 ADDRESS가 비어 있으면 Ingress Controller가 설치되어 있지 않거나, ingressClassName이 잘못 지정된 것이다. `kubectl get pods -n ingress-nginx`로 Controller Pod가 Running인지 확인하고, `kubectl get ingressclass`로 사용 가능한 IngressClass 목록을 확인한다.

### 6.5 호스트 기반 라우팅

```yaml
# 여러 도메인을 다른 Service로 라우팅
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: multi-host-ingress
spec:
  ingressClassName: nginx
  rules:
  - host: api.example.com           # api 도메인
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: api-service
            port:
              number: 80
  - host: admin.example.com         # admin 도메인
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: admin-service
            port:
              number: 80
  - host: "*.example.com"           # 와일드카드 도메인
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: default-service
            port:
              number: 80
```

### 6.6 TLS Ingress

```yaml
# TLS 인증서 Secret 생성
# kubectl create secret tls tls-secret \
#   --cert=tls.crt --key=tls.key -n demo

apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: tls-ingress
  namespace: demo
spec:
  ingressClassName: nginx
  tls:
  - hosts:
    - secure.example.com          # TLS 적용 호스트
    secretName: tls-secret        # kubernetes.io/tls 타입 Secret
  rules:
  - host: secure.example.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: secure-svc
            port:
              number: 443
```

### 6.7 IngressClass

```yaml
# IngressClass 정의
apiVersion: networking.k8s.io/v1
kind: IngressClass
metadata:
  name: nginx
  annotations:
    ingressclass.kubernetes.io/is-default-class: "true"  # 기본 IngressClass
spec:
  controller: k8s.io/ingress-nginx    # Controller 이름
  parameters:                          # 추가 파라미터 (선택사항)
    apiGroup: k8s.example.net
    kind: IngressParameters
    name: external-lb
```

### 6.8 kubectl create ingress (빠른 생성)

```bash
# Path-based Ingress 빠른 생성
kubectl create ingress app-ingress \
  --rule="myapp.example.com/api*=api-svc:80" \
  --rule="myapp.example.com/*=web-svc:80" \
  -n demo

# 여러 호스트 Ingress
kubectl create ingress multi-ingress \
  --rule="api.example.com/*=api-svc:80" \
  --rule="web.example.com/*=web-svc:80"

# TLS Ingress
kubectl create ingress tls-ingress \
  --rule="secure.example.com/*=web-svc:443,tls=tls-secret"

# dry-run으로 YAML 생성
kubectl create ingress app-ingress \
  --rule="myapp.example.com/api*=api-svc:80" \
  --dry-run=client -o yaml > ingress.yaml
```

---

## 7. CNI 플러그인

### 7.1 CNI란?

> **CNI(Container Network Interface)**: CNCF 표준 인터페이스 사양으로, 컨테이너 런타임이 Pod 생성/삭제 시 호출하는 네트워크 플러그인 바이너리의 규격을 정의한다. CNI 플러그인은 Pod에 veth pair를 생성하고 IP를 할당(IPAM)하며, Pod 간 라우팅 경로를 구성한다. CNI 플러그인이 설치되지 않으면 Pod는 네트워크 인터페이스를 갖지 못해 NotReady 상태에 머문다.

```
CNI 플러그인의 역할:
1. Pod에 IP 주소 할당
2. Pod 간 네트워크 연결 설정
3. NetworkPolicy 적용 (지원하는 CNI만)

주요 CNI 플러그인:
┌──────────┬─────────────┬──────────────┬─────────────┐
│ CNI      │ NetworkPolicy│ 특징         │ 사용처      │
├──────────┼─────────────┼──────────────┼─────────────┤
│ Cilium   │ ✅ L3-L7    │ eBPF 기반    │ tart-infra  │
│ Calico   │ ✅ L3-L4    │ BGP 지원     │ 많은 기업   │
│ Weave    │ ✅ L3-L4    │ 간단한 설정  │ 소규모      │
│ Flannel  │ ❌          │ 가장 간단    │ 테스트용    │
└──────────┴─────────────┴──────────────┴─────────────┘
```

### 7.2 CNI 관련 파일 위치

```bash
# CNI 설정 파일 위치 (노드에서 확인)
ls -la /etc/cni/net.d/
# 예: 05-cilium.conflist, 10-calico.conflist

# CNI 바이너리 위치
ls /opt/cni/bin/
# 예: cilium-cni, calico, bridge, host-local, loopback

# kubelet의 CNI 설정 확인
cat /var/lib/kubelet/config.yaml | grep -A2 cni
```

### 7.3 CNI 장애 증상

```
CNI가 설치되지 않거나 장애가 발생하면:

증상 1: 노드가 NotReady 상태
  kubectl get nodes
  → <node>  NotReady  <roles>  <age>  <version>

증상 2: Pod가 ContainerCreating에서 멈춤
  kubectl get pods
  → <pod>  0/1  ContainerCreating  0  5m

증상 3: Pod 이벤트에 CNI 관련 에러
  kubectl describe pod <name>
  → "network plugin is not ready: cni config uninitialized"

진단:
  ssh <node>
  ls /etc/cni/net.d/         # CNI 설정 파일 있는지
  ls /opt/cni/bin/            # CNI 바이너리 있는지
  systemctl status kubelet    # kubelet 로그에 CNI 에러
  crictl ps                   # 컨테이너 상태 확인
```

---

## 8. 실전 YAML 예제 모음 (15개)

### 예제 1: Default Deny All Ingress

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-ingress
  namespace: production
spec:
  podSelector: {}
  policyTypes:
  - Ingress
```

### 예제 2: Default Deny All Egress

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-egress
  namespace: production
spec:
  podSelector: {}
  policyTypes:
  - Egress
```

### 예제 3: 특정 Pod → 특정 Pod (Ingress)

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-frontend-to-backend
  namespace: demo
spec:
  podSelector:
    matchLabels:
      tier: backend
  policyTypes:
  - Ingress
  ingress:
  - from:
    - podSelector:
        matchLabels:
          tier: frontend
    ports:
    - protocol: TCP
      port: 8080
```

### 예제 4: 다른 네임스페이스에서 접근 허용 (OR 조건)

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-monitoring-or-backend
  namespace: demo
spec:
  podSelector:
    matchLabels:
      app: redis
  policyTypes:
  - Ingress
  ingress:
  - from:
    - namespaceSelector:             # OR: monitoring NS의 모든 Pod
        matchLabels:
          kubernetes.io/metadata.name: monitoring
    - podSelector:                   # OR: 같은 NS의 tier=backend Pod
        matchLabels:
          tier: backend
    ports:
    - protocol: TCP
      port: 6379
```

### 예제 5: 다른 네임스페이스의 특정 Pod만 허용 (AND 조건)

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-prometheus-only
  namespace: demo
spec:
  podSelector:
    matchLabels:
      app: api-server
  policyTypes:
  - Ingress
  ingress:
  - from:
    - namespaceSelector:             # AND: monitoring NS
        matchLabels:
          kubernetes.io/metadata.name: monitoring
      podSelector:                   # AND: 그 중 prometheus Pod만
        matchLabels:
          app: prometheus
    ports:
    - protocol: TCP
      port: 9090
```

### 예제 6: Egress + DNS 허용

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: api-egress-policy
  namespace: demo
spec:
  podSelector:
    matchLabels:
      role: api
  policyTypes:
  - Egress
  egress:
  - ports:                           # DNS 허용 (필수!)
    - protocol: UDP
      port: 53
    - protocol: TCP
      port: 53
  - to:                              # database로만 접근 허용
    - podSelector:
        matchLabels:
          tier: database
    ports:
    - protocol: TCP
      port: 5432
```

### 예제 7: ipBlock으로 외부 IP 제어

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-external-access
  namespace: demo
spec:
  podSelector:
    matchLabels:
      app: public-api
  policyTypes:
  - Ingress
  ingress:
  - from:
    - ipBlock:
        cidr: 0.0.0.0/0
        except:
        - 10.0.0.0/8
        - 172.16.0.0/12
        - 192.168.0.0/16
    ports:
    - protocol: TCP
      port: 443
```

### 예제 8: Ingress + Egress 동시 설정

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: full-policy
  namespace: demo
spec:
  podSelector:
    matchLabels:
      app: secure-app
  policyTypes:
  - Ingress
  - Egress
  ingress:
  - from:
    - podSelector:
        matchLabels:
          app: gateway
    ports:
    - protocol: TCP
      port: 8080
  egress:
  - ports:
    - protocol: UDP
      port: 53
    - protocol: TCP
      port: 53
  - to:
    - podSelector:
        matchLabels:
          app: cache
    ports:
    - protocol: TCP
      port: 6379
  - to:
    - podSelector:
        matchLabels:
          app: database
    ports:
    - protocol: TCP
      port: 5432
```

### 예제 9: 모든 Pod에서 특정 Pod로의 접근 허용

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-all-to-dns
  namespace: demo
spec:
  podSelector:
    matchLabels:
      app: dns-proxy
  policyTypes:
  - Ingress
  ingress:
  - from: []                        # 모든 소스 허용
    ports:
    - protocol: TCP
      port: 53
    - protocol: UDP
      port: 53
```

---

## tart-infra 실습

### 실습 환경 설정

```bash
# dev 클러스터 접속 (CiliumNetworkPolicy 11개가 적용된 환경)
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/dev.yaml
kubectl config use-context dev
```

### 실습 1: CiliumNetworkPolicy 분석

```bash
# dev 클러스터에 적용된 NetworkPolicy 확인
kubectl get networkpolicies -n demo
kubectl get ciliumnetworkpolicies -n demo
```

**예상 출력:**
```
NAME                          AGE
allow-nginx-ingress           30d
allow-postgresql-from-apps    30d
allow-redis-from-apps         30d
deny-all-default              30d
...
```

```bash
# 특정 정책 상세 확인 (PostgreSQL 접근 제한 정책)
kubectl describe ciliumnetworkpolicy allow-postgresql-from-apps -n demo
```

**동작 원리:**
1. `deny-all-default` 정책이 기본적으로 모든 ingress/egress를 차단한다 (Default Deny)
2. 이후 개별 정책으로 필요한 트래픽만 허용한다 (화이트리스트 방식)
3. CiliumNetworkPolicy는 표준 NetworkPolicy의 상위 호환으로 L7 정책도 지원한다
4. Cilium은 eBPF를 사용하여 커널 수준에서 패킷 필터링을 수행한다

### 실습 2: 네트워크 정책 동작 테스트

```bash
# demo 네임스페이스에서 nginx로의 접근 테스트
kubectl run nettest --image=busybox:1.36 -n demo --rm -it --restart=Never -- \
  wget -qO- --timeout=3 nginx.demo.svc.cluster.local

# 다른 네임스페이스에서 접근 시도 (정책에 따라 차단될 수 있음)
kubectl run nettest --image=busybox:1.36 -n default --rm -it --restart=Never -- \
  wget -qO- --timeout=3 nginx.demo.svc.cluster.local
```

**예상 출력:**
```
# demo 네임스페이스에서: HTML 응답 출력 (허용)
# default 네임스페이스에서: wget: download timed out (차단)
```

**동작 원리:**
1. NetworkPolicy의 `from` 필드에 `namespaceSelector`가 있으면 지정된 네임스페이스에서만 접근을 허용한다
2. 정책이 없는 네임스페이스에서의 요청은 Default Deny에 의해 차단된다
3. DNS(포트 53) egress가 허용되어야 Service 이름 해석이 가능하다

### 실습 3: Istio mTLS와 네트워크 보안 계층 확인

```bash
# Istio PeerAuthentication 정책 확인 (mTLS 설정)
kubectl get peerauthentication -n demo

# Istio sidecar가 주입된 Pod 확인
kubectl get pods -n demo -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{range .spec.containers[*]}{.name}{" "}{end}{"\n"}{end}'
```

**예상 출력:**
```
nginx-xxxxx         nginx istio-proxy
httpbin-v1-xxxxx    httpbin istio-proxy
```

**동작 원리:**
1. Istio의 `PeerAuthentication` STRICT 모드는 모든 Pod 간 통신에 mTLS를 강제한다
2. istio-proxy(Envoy sidecar)가 투명하게 TLS 암호화/복호화를 처리한다
3. NetworkPolicy(L3/L4)와 Istio mTLS(L7)는 서로 다른 계층에서 보안을 제공한다

