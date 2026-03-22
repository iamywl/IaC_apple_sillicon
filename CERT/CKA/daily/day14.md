# CKA Day 14: NetworkPolicy & Ingress 실전 & 시험 문제

> CKA 도메인: Services & Networking (20%) - Part 2 실전 | 예상 소요 시간: 2시간

---

### 예제 10: 경로 기반 Ingress

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: path-based-ingress
  namespace: demo
spec:
  ingressClassName: nginx
  rules:
  - host: myapp.example.com
    http:
      paths:
      - path: /api
        pathType: Prefix
        backend:
          service:
            name: api-svc
            port:
              number: 8080
      - path: /admin
        pathType: Prefix
        backend:
          service:
            name: admin-svc
            port:
              number: 8080
      - path: /
        pathType: Prefix
        backend:
          service:
            name: frontend-svc
            port:
              number: 80
```

### 예제 11: 호스트 기반 Ingress

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: host-based-ingress
  namespace: demo
spec:
  ingressClassName: nginx
  rules:
  - host: api.tart.local
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: api-svc
            port:
              number: 80
  - host: web.tart.local
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: web-svc
            port:
              number: 80
```

### 예제 12: TLS Ingress

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: tls-ingress
  namespace: demo
  annotations:
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
spec:
  ingressClassName: nginx
  tls:
  - hosts:
    - secure.tart.local
    secretName: tls-secret
  rules:
  - host: secure.tart.local
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

### 예제 13: defaultBackend가 있는 Ingress

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: with-default-backend
  namespace: demo
spec:
  ingressClassName: nginx
  defaultBackend:                   # 규칙에 매칭되지 않는 모든 요청
    service:
      name: default-svc
      port:
        number: 80
  rules:
  - host: myapp.example.com
    http:
      paths:
      - path: /api
        pathType: Prefix
        backend:
          service:
            name: api-svc
            port:
              number: 80
```

### 예제 14: Exact pathType Ingress

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: exact-path-ingress
spec:
  ingressClassName: nginx
  rules:
  - host: myapp.example.com
    http:
      paths:
      - path: /healthz              # 정확히 /healthz만 매칭
        pathType: Exact
        backend:
          service:
            name: health-svc
            port:
              number: 80
      - path: /                      # 나머지 모든 경로
        pathType: Prefix
        backend:
          service:
            name: web-svc
            port:
              number: 80
```

### 예제 15: 포트 범위를 사용하는 NetworkPolicy

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-port-range
  namespace: demo
spec:
  podSelector:
    matchLabels:
      app: multi-port-app
  policyTypes:
  - Ingress
  ingress:
  - from:
    - podSelector:
        matchLabels:
          role: client
    ports:
    - protocol: TCP
      port: 8000
      endPort: 8100               # 8000-8100 포트 범위 허용
```

---

## 9. 시험에서 이 주제가 어떻게 출제되는가?

### 출제 패턴 분석

```
CKA 시험의 NetworkPolicy & Ingress 관련 출제:

NetworkPolicy 출제 비중: 높음 (Services & Networking 20% 중 상당 부분)

주요 출제 유형:
1. Default Deny 정책 생성 — 매우 빈출!
2. 특정 Pod 간 통신 허용 — 빈출
3. 네임스페이스 간 통신 허용 — 빈출
4. OR vs AND 조건 구분 — 난이도 있는 문제
5. Egress + DNS 허용 — 빈출
6. Ingress 리소스 생성 — 빈출
7. CNI 플러그인 확인 — 가끔 출제

시험에서의 핵심:
- Default Deny YAML을 암기하고 즉시 작성할 수 있어야 한다
- OR vs AND: YAML 들여쓰기의 '-' 하나 차이를 정확히 구분
- Egress 정책에서 DNS(53) 허용을 절대 잊지 말 것
- Ingress는 kubectl create ingress 명령으로 빠르게 생성
- CNI 확인: /etc/cni/net.d/ 경로 기억
```

---

## 10. 시험 대비 연습 문제 (12문제)

### 문제 1. Default Deny Ingress [4%]

**컨텍스트:** `kubectl config use-context prod`

`default` 네임스페이스에 모든 인바운드 트래픽을 차단하는 NetworkPolicy `deny-all-ingress`를 생성하라.

<details>
<summary>풀이</summary>

```bash
kubectl config use-context prod

cat <<EOF | kubectl apply -f -
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: deny-all-ingress
  namespace: default
spec:
  podSelector: {}
  policyTypes:
  - Ingress
EOF

# 검증
kubectl get networkpolicy deny-all-ingress
kubectl describe networkpolicy deny-all-ingress

# 정리
kubectl delete networkpolicy deny-all-ingress
```

**핵심:**
- `podSelector: {}`는 네임스페이스의 모든 Pod에 적용
- `policyTypes: [Ingress]`만 지정하고 ingress 규칙을 비워두면 모든 인바운드 차단
- egress는 영향받지 않음 (policyTypes에 Egress가 없으므로)

</details>

---

### 문제 2. 특정 Pod 간 통신 허용 [7%]

**컨텍스트:** `kubectl config use-context dev`

`demo` 네임스페이스에서 다음 NetworkPolicy를 생성하라:
- 이름: `allow-web-to-db`
- 대상: `tier=database` 레이블을 가진 Pod
- 허용: `tier=web` 레이블을 가진 Pod에서 TCP 5432 포트로의 인바운드
- 그 외 인바운드는 차단

<details>
<summary>풀이</summary>

```bash
kubectl config use-context dev

cat <<EOF | kubectl apply -f -
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-web-to-db
  namespace: demo
spec:
  podSelector:
    matchLabels:
      tier: database            # database Pod에 적용
  policyTypes:
  - Ingress                     # 인바운드 제어
  ingress:
  - from:
    - podSelector:
        matchLabels:
          tier: web             # web Pod에서만 허용
    ports:
    - protocol: TCP
      port: 5432                # PostgreSQL 포트만
EOF

# 검증
kubectl describe networkpolicy allow-web-to-db -n demo

# 테스트 (Web Pod에서 접근 가능, 다른 Pod에서 차단)
# kubectl run web-test --image=busybox --labels="tier=web" -n demo --rm -it -- \
#   nc -zv <db-pod-ip> 5432

# 정리
kubectl delete networkpolicy allow-web-to-db -n demo
```

</details>

---

### 문제 3. 네임스페이스 간 통신 (OR 조건) [7%]

**컨텍스트:** `kubectl config use-context dev`

`demo` 네임스페이스의 `app=redis` Pod에 대해:
- `monitoring` 네임스페이스에서 오는 TCP 6379 포트 인바운드를 허용하라
- 같은 네임스페이스의 `tier=backend` Pod에서 오는 TCP 6379 포트 인바운드를 허용하라
- 그 외 인바운드는 차단하라

<details>
<summary>풀이</summary>

```bash
kubectl config use-context dev

# monitoring 네임스페이스에 레이블 추가 (필요 시)
kubectl label namespace monitoring purpose=monitoring --overwrite 2>/dev/null || true

cat <<EOF | kubectl apply -f -
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: redis-access
  namespace: demo
spec:
  podSelector:
    matchLabels:
      app: redis
  policyTypes:
  - Ingress
  ingress:
  - from:
    - namespaceSelector:           # 규칙 1: monitoring NS (OR)
        matchLabels:
          purpose: monitoring
    - podSelector:                 # 규칙 2: 같은 NS의 backend (OR)
        matchLabels:
          tier: backend
    ports:
    - protocol: TCP
      port: 6379
EOF

# 검증
kubectl describe networkpolicy redis-access -n demo

# 정리
kubectl delete networkpolicy redis-access -n demo
```

**핵심:** `from` 배열에 `-`가 2개이므로 OR 조건. monitoring NS의 모든 Pod 또는 같은 NS의 backend Pod 중 하나만 만족하면 허용.

</details>

---

### 문제 4. AND 조건 NetworkPolicy [7%]

**컨텍스트:** `kubectl config use-context dev`

`demo` 네임스페이스의 `app=api` Pod에 대해:
- `monitoring` 네임스페이스의 `app=prometheus` Pod에서만 TCP 9090 인바운드를 허용하라
- (monitoring 네임스페이스의 다른 Pod는 차단해야 한다)

<details>
<summary>풀이</summary>

```bash
kubectl config use-context dev

cat <<EOF | kubectl apply -f -
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-prometheus-only
  namespace: demo
spec:
  podSelector:
    matchLabels:
      app: api
  policyTypes:
  - Ingress
  ingress:
  - from:
    - namespaceSelector:           # AND 조건! (- 가 1개)
        matchLabels:
          kubernetes.io/metadata.name: monitoring
      podSelector:                 # 같은 규칙 내 추가 조건
        matchLabels:
          app: prometheus
    ports:
    - protocol: TCP
      port: 9090
EOF

# 검증
kubectl describe networkpolicy allow-prometheus-only -n demo

# 정리
kubectl delete networkpolicy allow-prometheus-only -n demo
```

**핵심:** `namespaceSelector`와 `podSelector`가 같은 `-` 아래에 있으므로 AND 조건. monitoring NS이면서 prometheus Pod인 경우에만 허용.

</details>

---

### 문제 5. Egress 정책 + DNS 허용 [7%]

**컨텍스트:** `kubectl config use-context prod`

`default` 네임스페이스의 `role=api` Pod에 대해:
- DNS 조회를 허용하라 (UDP/TCP 53)
- `tier=database` Pod로의 TCP 3306 접근을 허용하라
- 그 외 아웃바운드는 차단하라

<details>
<summary>풀이</summary>

```bash
kubectl config use-context prod

cat <<EOF | kubectl apply -f -
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: api-egress
  namespace: default
spec:
  podSelector:
    matchLabels:
      role: api
  policyTypes:
  - Egress
  egress:
  - ports:                         # DNS 허용 (필수!)
    - protocol: UDP
      port: 53
    - protocol: TCP
      port: 53
  - to:                            # database로만 접근
    - podSelector:
        matchLabels:
          tier: database
    ports:
    - protocol: TCP
      port: 3306
EOF

# 검증
kubectl describe networkpolicy api-egress

# 정리
kubectl delete networkpolicy api-egress
```

**핵심:** DNS 규칙에서 `to`를 생략하면 모든 대상으로의 DNS 쿼리를 허용. Egress 정책에서 DNS를 빠뜨리면 서비스 이름 해석이 불가능.

</details>

---

### 문제 6. 경로 기반 Ingress 생성 [7%]

**컨텍스트:** `kubectl config use-context dev`

다음 조건의 Ingress를 생성하라:
- 이름: `app-ingress`
- 네임스페이스: `demo`
- 호스트: `app.tart.local`
- `/api` 경로 → `httpbin` Service (포트 8000)
- `/` 경로 → `nginx-web` Service (포트 80)
- pathType: Prefix

<details>
<summary>풀이</summary>

```bash
kubectl config use-context dev

# 방법 1: YAML
cat <<EOF | kubectl apply -f -
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: app-ingress
  namespace: demo
spec:
  rules:
  - host: app.tart.local
    http:
      paths:
      - path: /api
        pathType: Prefix
        backend:
          service:
            name: httpbin
            port:
              number: 8000
      - path: /
        pathType: Prefix
        backend:
          service:
            name: nginx-web
            port:
              number: 80
EOF

# 방법 2: kubectl create ingress (빠른 방법)
kubectl create ingress app-ingress \
  --rule="app.tart.local/api*=httpbin:8000" \
  --rule="app.tart.local/*=nginx-web:80" \
  -n demo

# 검증
kubectl get ingress app-ingress -n demo
kubectl describe ingress app-ingress -n demo

# 정리
kubectl delete ingress app-ingress -n demo
```

**핵심:** 더 구체적인 경로(`/api`)를 먼저 정의해야 한다. Prefix 매칭이므로 `/api`는 `/api`, `/api/v1` 등과 매칭된다.

</details>

---

### 문제 7. 호스트 기반 Ingress [4%]

**컨텍스트:** `kubectl config use-context dev`

다음 Ingress를 생성하라:
- 이름: `multi-host`
- `api.tart.local` → `api-svc:8080`
- `web.tart.local` → `web-svc:80`
- 네임스페이스: `demo`

<details>
<summary>풀이</summary>

```bash
kubectl config use-context dev

cat <<EOF | kubectl apply -f -
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: multi-host
  namespace: demo
spec:
  rules:
  - host: api.tart.local
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: api-svc
            port:
              number: 8080
  - host: web.tart.local
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: web-svc
            port:
              number: 80
EOF

# 검증
kubectl get ingress multi-host -n demo
kubectl describe ingress multi-host -n demo

# 정리
kubectl delete ingress multi-host -n demo
```

</details>

---

### 문제 8. Default Deny + 특정 허용 조합 [7%]

**컨텍스트:** `kubectl config use-context dev`

`demo` 네임스페이스에서:
1. 모든 Pod의 인바운드를 차단하는 Default Deny 정책을 생성하라 (이름: `default-deny`)
2. `app=web` Pod에 대해서만 `app=gateway` Pod에서 TCP 80 인바운드를 허용하라 (이름: `allow-gateway`)

<details>
<summary>풀이</summary>

```bash
kubectl config use-context dev

# 1. Default Deny
cat <<EOF | kubectl apply -f -
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny
  namespace: demo
spec:
  podSelector: {}
  policyTypes:
  - Ingress
EOF

# 2. 특정 허용 (Default Deny 위에 추가)
cat <<EOF | kubectl apply -f -
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-gateway
  namespace: demo
spec:
  podSelector:
    matchLabels:
      app: web
  policyTypes:
  - Ingress
  ingress:
  - from:
    - podSelector:
        matchLabels:
          app: gateway
    ports:
    - protocol: TCP
      port: 80
EOF

# 검증
kubectl get networkpolicy -n demo
kubectl describe networkpolicy allow-gateway -n demo

# 정리
kubectl delete networkpolicy default-deny allow-gateway -n demo
```

**핵심:** NetworkPolicy는 OR 방식으로 결합된다. Default Deny가 있어도 allow-gateway 정책이 web Pod에 대한 인바운드를 허용한다. 같은 Pod에 여러 NetworkPolicy가 적용될 때, 모든 정책의 허용 규칙이 합산(UNION)된다.

</details>

---

### 문제 9. Egress Default Deny + DNS + 특정 Pod 허용 [7%]

**컨텍스트:** `kubectl config use-context dev`

`demo` 네임스페이스의 `role=worker` Pod에 대해:
- 모든 아웃바운드를 차단하되
- DNS(포트 53)는 허용하고
- `app=cache` Pod의 TCP 6379 포트만 허용하라
- 이름: `worker-egress`

<details>
<summary>풀이</summary>

```bash
kubectl config use-context dev

cat <<EOF | kubectl apply -f -
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: worker-egress
  namespace: demo
spec:
  podSelector:
    matchLabels:
      role: worker
  policyTypes:
  - Egress
  egress:
  # DNS 허용
  - ports:
    - protocol: UDP
      port: 53
    - protocol: TCP
      port: 53
  # cache Pod로만 접근 허용
  - to:
    - podSelector:
        matchLabels:
          app: cache
    ports:
    - protocol: TCP
      port: 6379
EOF

# 검증
kubectl describe networkpolicy worker-egress -n demo

# 정리
kubectl delete networkpolicy worker-egress -n demo
```

</details>

---

### 문제 10. CNI 플러그인 확인 [4%]

**컨텍스트:** `kubectl config use-context dev`

다음 정보를 `/tmp/cni-info.txt`에 저장하라:
1. 사용 중인 CNI 플러그인의 이름
2. CNI 설정 파일 경로

<details>
<summary>풀이</summary>

```bash
kubectl config use-context dev

# CNI 플러그인 확인 방법 1: kube-system의 CNI Pod 확인
kubectl get pods -n kube-system | grep -E "cilium|calico|flannel|weave" > /tmp/cni-info.txt

# CNI 플러그인 확인 방법 2: 노드에서 직접 확인 (SSH 접속 후)
# ssh admin@<node-ip>
# ls /etc/cni/net.d/
# cat /etc/cni/net.d/*.conflist

# Cilium 상태 확인 (tart-infra는 Cilium 사용)
echo "=== Cilium Pods ===" >> /tmp/cni-info.txt
kubectl get pods -n kube-system -l k8s-app=cilium >> /tmp/cni-info.txt
echo "" >> /tmp/cni-info.txt
echo "CNI Config Path: /etc/cni/net.d/" >> /tmp/cni-info.txt
echo "CNI Binary Path: /opt/cni/bin/" >> /tmp/cni-info.txt

cat /tmp/cni-info.txt
```

**핵심 포인트:**
- CNI 설정: `/etc/cni/net.d/`
- CNI 바이너리: `/opt/cni/bin/`
- Cilium Pod: `k8s-app=cilium` 레이블

</details>

---

### 문제 11. Ingress에 defaultBackend 설정 [4%]

**컨텍스트:** `kubectl config use-context dev`

다음 Ingress를 생성하라:
- 이름: `catch-all-ingress`
- `/api`로 들어오는 트래픽은 `api-svc:80`으로
- 나머지 모든 트래픽은 `default-svc:80`으로 (defaultBackend)
- 네임스페이스: `demo`

<details>
<summary>풀이</summary>

```bash
kubectl config use-context dev

cat <<EOF | kubectl apply -f -
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: catch-all-ingress
  namespace: demo
spec:
  defaultBackend:
    service:
      name: default-svc
      port:
        number: 80
  rules:
  - http:
      paths:
      - path: /api
        pathType: Prefix
        backend:
          service:
            name: api-svc
            port:
              number: 80
EOF

# 검증
kubectl get ingress catch-all-ingress -n demo
kubectl describe ingress catch-all-ingress -n demo

# 정리
kubectl delete ingress catch-all-ingress -n demo
```

**핵심:** `defaultBackend`는 어떤 규칙에도 매칭되지 않는 트래픽을 처리한다. host를 생략하면 모든 호스트에 적용된다.

</details>

---

### 문제 12. NetworkPolicy 트러블슈팅 [7%]

**컨텍스트:** `kubectl config use-context dev`

`demo` 네임스페이스에서 `app=backend` Pod가 `app=database` Pod의 TCP 5432에 접근하지 못한다. 다음 단계로 문제를 진단하고 해결하라:
1. 현재 적용된 NetworkPolicy를 확인하라
2. database Pod에 적용된 정책이 backend에서의 접근을 허용하는지 확인하라
3. 필요하다면 정책을 수정하라

<details>
<summary>풀이</summary>

```bash
kubectl config use-context dev

# 시뮬레이션: 잘못된 NetworkPolicy 생성
kubectl run db-pod --image=postgres:15 --labels="app=database" -n demo \
  --env="POSTGRES_PASSWORD=test" --port=5432
kubectl run backend-pod --image=busybox --labels="app=backend" -n demo -- sleep 3600

cat <<EOF | kubectl apply -f -
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: db-policy
  namespace: demo
spec:
  podSelector:
    matchLabels:
      app: database
  policyTypes:
  - Ingress
  ingress:
  - from:
    - podSelector:
        matchLabels:
          app: frontend        # backend가 아닌 frontend만 허용!
    ports:
    - protocol: TCP
      port: 5432
EOF

# === 진단 ===

# 1. NetworkPolicy 확인
kubectl get networkpolicy -n demo
kubectl describe networkpolicy db-policy -n demo

# 2. 정책 분석
# Allowing ingress traffic:
#   To Port: 5432/TCP
#   From: PodSelector: app=frontend  ← backend가 아니라 frontend!

# 3. 접근 테스트 (실패)
kubectl exec backend-pod -n demo -- nc -zv -w 3 db-pod 5432
# timeout!

# 4. 수정: backend도 허용하도록 정책 업데이트
cat <<EOF | kubectl apply -f -
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: db-policy
  namespace: demo
spec:
  podSelector:
    matchLabels:
      app: database
  policyTypes:
  - Ingress
  ingress:
  - from:
    - podSelector:
        matchLabels:
          app: frontend
    - podSelector:                # backend 추가 (OR 조건)
        matchLabels:
          app: backend
    ports:
    - protocol: TCP
      port: 5432
EOF

# 5. 검증
kubectl exec backend-pod -n demo -- nc -zv -w 3 db-pod 5432
# 연결 성공!

# 정리
kubectl delete networkpolicy db-policy -n demo
kubectl delete pod db-pod backend-pod -n demo
```

**진단 체크리스트:**
1. `kubectl get networkpolicy -n <ns>` — 어떤 정책이 있는지
2. `kubectl describe networkpolicy <name>` — 허용 규칙 확인
3. Pod의 레이블과 정책의 from/to selector 비교
4. 포트가 정확한지 확인
5. Egress 정책이 있다면 DNS(53)가 허용되는지 확인

</details>

---

## 11. 복습 체크리스트

### 개념 확인

- [ ] NetworkPolicy의 OR 조건(`-`가 2개)과 AND 조건(`-`가 1개)의 차이를 정확히 구분할 수 있는가?
- [ ] Default Deny Ingress/Egress YAML을 즉시 작성할 수 있는가?
- [ ] Egress 정책에서 DNS(포트 53)를 반드시 허용해야 하는 이유를 설명할 수 있는가?
- [ ] Ingress 리소스의 pathType(Exact, Prefix)의 차이를 아는가?
- [ ] IngressClass의 역할을 이해하는가?
- [ ] CNI 플러그인의 역할과 NetworkPolicy 지원 여부를 알고 있는가?
- [ ] 여러 NetworkPolicy가 같은 Pod에 적용될 때 어떻게 결합되는지 (UNION) 이해하는가?

### kubectl 명령어 확인

- [ ] `kubectl get networkpolicy -n <namespace>`
- [ ] `kubectl describe networkpolicy <name>`
- [ ] `kubectl create ingress <name> --rule="host/path=svc:port"`
- [ ] `kubectl get ingress -n <namespace>`

### 시험 핵심 팁

1. **Default Deny 먼저** — 문제에서 "그 외 차단"이 요구되면 policyTypes에 해당 방향을 명시하고 규칙을 비워두면 됨
2. **OR vs AND** — YAML의 `-` 들여쓰기를 정확히 확인. 실수하면 완전히 다른 정책이 된다
3. **Egress + DNS** — Egress 정책 문제에서는 반드시 DNS(UDP/TCP 53) 허용 추가
4. **Ingress 빠른 생성** — `kubectl create ingress` 명령이 시험에서 시간 절약
5. **CNI** — `/etc/cni/net.d/` 경로와 `/opt/cni/bin/` 경로 기억
6. **NetworkPolicy 합산** — 여러 정책이 같은 Pod에 적용되면 허용 규칙이 합산(UNION)됨

---

## 내일 예고

**Day 15: Storage** — PV, PVC, StorageClass, Volume Mount를 학습하고, hostPath/emptyDir/configMap 볼륨 타입을 실습한다.

---

## tart-infra 실습

### 실습 환경 설정

```bash
# dev 클러스터에 접속 (CiliumNetworkPolicy가 적용된 클러스터)
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/dev.yaml
kubectl get nodes
```

### 실습 1: CiliumNetworkPolicy 확인

```bash
# dev 클러스터에 적용된 CiliumNetworkPolicy 목록
kubectl get ciliumnetworkpolicies -n demo
```

**예상 출력:**
```
NAME                          AGE
allow-dns                     5d
allow-nginx-ingress           5d
allow-httpbin-from-nginx      5d
allow-postgres-from-httpbin   5d
allow-redis-from-httpbin      5d
allow-rabbitmq-from-httpbin   5d
default-deny-all              5d
...
```

**동작 원리:** CiliumNetworkPolicy는 표준 NetworkPolicy의 확장판이다:
1. Cilium Agent가 정책을 eBPF 프로그램으로 변환하여 커널에 로드한다
2. 패킷이 커널 공간에서 직접 필터링되므로 iptables보다 성능이 뛰어나다
3. L3/L4뿐만 아니라 L7(HTTP 경로, 메서드) 수준의 정책도 지원한다
4. `default-deny-all`이 모든 트래픽을 차단하고, 나머지 정책이 허용 규칙을 추가한다 (Zero Trust)

```bash
# default-deny-all 정책 상세 확인
kubectl get ciliumnetworkpolicy default-deny-all -n demo -o yaml
```

### 실습 2: NetworkPolicy 동작 테스트

```bash
# nginx에서 httpbin으로의 통신 테스트
kubectl exec -n demo deploy/nginx-web -- curl -s -o /dev/null -w "%{http_code}" http://httpbin:8000/get

# nginx에서 postgres로의 직접 통신 테스트 (차단되어야 함)
kubectl exec -n demo deploy/nginx-web -- curl -s --connect-timeout 3 http://postgres-svc:5432 || echo "Connection blocked by NetworkPolicy"
```

**예상 출력:**
```
200
Connection blocked by NetworkPolicy
```

**동작 원리:** Zero Trust 네트워크 정책의 동작:
1. `default-deny-all`이 demo 네임스페이스 내 모든 ingress/egress를 차단한다
2. `allow-httpbin-from-nginx`가 nginx → httpbin 통신만 허용한다
3. nginx → postgres 직접 통신 정책이 없으므로 Cilium eBPF가 패킷을 DROP한다
4. 허용된 경로: nginx → httpbin → postgres (httpbin이 중간 계층 역할)

### 실습 3: Ingress 리소스 확인

```bash
# Istio Ingress Gateway 확인
kubectl get gateway -n demo 2>/dev/null || echo "Gateway 리소스 확인"
kubectl get virtualservice -n demo
```

**예상 출력:**
```
NAME          GATEWAYS          HOSTS   AGE
httpbin-vs    [demo-gateway]    [*]     5d
```

**동작 원리:** Istio VirtualService의 트래픽 라우팅:
1. Istio Ingress Gateway가 외부 트래픽을 수신한다
2. VirtualService 규칙에 따라 httpbin-v1(90%)과 httpbin-v2(10%)로 카나리 라우팅한다
3. DestinationRule이 v1, v2 subset을 라벨(`version: v1`, `version: v2`)로 구분한다
4. 이 구조는 K8s 표준 Ingress보다 더 세밀한 트래픽 제어를 제공한다

### 실습 4: CNI 플러그인 구조 확인

```bash
# Cilium 상태 확인
kubectl get pods -n kube-system -l k8s-app=cilium -o wide

# Cilium CLI로 상태 확인 (SSH로 노드 접속 후)
# tart ssh dev-master
# cilium status
```

**동작 원리:** CNI 플러그인 구조:
1. kubelet이 Pod 생성 시 CNI 바이너리(`/opt/cni/bin/cilium-cni`)를 호출한다
2. CNI 설정 파일(`/etc/cni/net.d/05-cilium.conflist`)에서 플러그인 정보를 읽는다
3. Cilium이 veth pair를 생성하여 Pod를 노드 네트워크에 연결한다
4. eBPF 프로그램이 패킷 포워딩과 정책 적용을 커널 공간에서 처리한다
