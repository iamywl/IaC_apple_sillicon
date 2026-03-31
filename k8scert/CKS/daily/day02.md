# CKS Day 2: Cluster Setup (2/2) - 시험 패턴, 실전 문제, NetworkPolicy 실습

> 학습 목표 | CKS 도메인: Cluster Setup (10%) | 예상 소요 시간: 2시간

---

## 오늘의 학습 목표

- Cluster Setup 도메인의 CKS 시험 출제 패턴을 분석한다
- NetworkPolicy, kube-bench, TLS 관련 실전 문제 12개를 풀어본다
- NetworkPolicy 검증 실습으로 정책 적용과 테스트를 수행한다
- CiliumNetworkPolicy와 표준 NetworkPolicy의 차이를 이해한다

---

## 5. 이 주제가 시험에서 어떻게 나오는가

### 5.1 CKS 시험 출제 패턴 분석

```
Cluster Setup 도메인 출제 패턴 (10%)
═══════════════════════════════════

1. NetworkPolicy 문제 (거의 매 시험 출제)
   - "Default Deny All 정책을 작성하라"
   - "특정 Pod 간 통신만 허용하라" (DNS 허용 포함)
   - "다른 네임스페이스에서 오는 트래픽만 허용하라"
   - "메타데이터 API(169.254.169.254)를 차단하라"
   의도: Pod 네트워크 격리 능력 평가

2. kube-bench 문제 (빈출)
   - "kube-bench를 실행하고 FAIL 항목을 PASS로 수정하라"
   - "특정 CIS 체크 항목을 수정하라"
   의도: CIS Benchmark 이해도와 매니페스트 수정 능력 평가

3. TLS Secret + Ingress 문제 (가끔 출제)
   - "인증서로 TLS Secret을 생성하고 Ingress에 적용하라"
   의도: TLS 설정 능력 평가

4. 바이너리 검증 문제 (가끔 출제)
   - "kubelet 바이너리가 변조되었는지 확인하고 교체하라"
   의도: 무결성 검증 능력 평가

핵심 전략:
  → NetworkPolicy는 외워서 빠르게 작성할 수 있어야 한다
  → kube-bench 수정은 매니페스트 구조를 잘 이해해야 한다
  → TLS Secret 생성 명령어를 암기하라
```

### 5.2 NetworkPolicy 등장 배경과 공격-방어 매핑

```
Kubernetes 네트워크 보안의 진화
══════════════════════════════

K8s 초기 (v1.3 이전):
  - Pod 간 네트워크 격리 메커니즘이 존재하지 않았다
  - flat network 모델에서 모든 Pod가 상호 접근 가능했다
  - 하나의 취약한 Pod가 침해되면 전체 클러스터가 위험에 노출되었다

K8s v1.3 (2016): NetworkPolicy API 도입
  - CNI 플러그인 기반의 선언적 네트워크 정책 모델이 추가되었다
  - L3/L4 수준의 ingress/egress 트래픽 제어가 가능해졌다

실제 공격 사례:
  - 2019년 Tesla 사례: 침해된 Pod에서 내부 Kubernetes Dashboard에 접근하여
    클러스터 전체를 크립토마이닝에 악용한 사건이다
  - NetworkPolicy Default Deny가 있었다면 lateral movement가 차단되었을 것이다
```

### 5.3 실전 문제 (10개 이상)

### 문제 1. Default Deny All NetworkPolicy

`restricted` 네임스페이스에 default deny all NetworkPolicy를 적용하라. 모든 Pod에 대해 Ingress와 Egress 트래픽을 모두 차단해야 한다. 정책 이름은 `default-deny-all`로 하라.

<details>
<summary>풀이</summary>

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
  namespace: restricted
spec:
  podSelector: {}
  policyTypes:
  - Ingress
  - Egress
```

```bash
kubectl apply -f deny-all.yaml
kubectl get networkpolicy -n restricted
```

검증:
```bash
# 적용 후 통신 차단 확인
kubectl run test --image=busybox:1.36 --restart=Never -n restricted -- sleep 3600
kubectl exec test -n restricted -- wget -qO- --timeout=3 http://any-svc 2>&1
```

```text
wget: download timed out
```

**핵심 포인트:**
- `podSelector: {}`는 네임스페이스의 모든 Pod를 선택한다
- ingress/egress 규칙이 없으므로 모든 트래픽이 차단된다
- policyTypes에 Ingress와 Egress 모두 포함해야 양방향 차단

</details>

### 문제 2. DNS 허용 + 특정 Pod 간 Egress 통신

`restricted` 네임스페이스에서 `app=frontend` Pod가 DNS(53)와 `app=backend` Pod의 포트 8080으로만 Egress 통신하도록 NetworkPolicy를 작성하라. 정책 이름은 `frontend-egress`로 하라.

<details>
<summary>풀이</summary>

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: frontend-egress
  namespace: restricted
spec:
  podSelector:
    matchLabels:
      app: frontend
  policyTypes:
  - Egress
  egress:
  - to: []
    ports:
    - protocol: UDP
      port: 53
    - protocol: TCP
      port: 53
  - to:
    - podSelector:
        matchLabels:
          app: backend
    ports:
    - protocol: TCP
      port: 8080
```

**핵심 포인트:**
- DNS를 허용하지 않으면 서비스명으로 통신할 수 없다
- `to: []`는 "모든 대상"을 의미한다 (kube-dns가 어디에 있든 접근 가능)
- DNS 규칙과 backend 규칙이 별도의 egress 항목이므로 OR 관계

</details>

### 문제 3. kube-bench FAIL 항목 수정

마스터 노드에서 kube-bench를 실행하고 다음 항목을 PASS로 수정하라:
- 1.2.1: `--anonymous-auth=false`
- 1.2.16: `--profiling=false`
- 1.2.20: `--audit-log-path=/var/log/kubernetes/audit/audit.log`

<details>
<summary>풀이</summary>

```bash
# 현재 상태 확인
kube-bench run --targets master --check 1.2.1,1.2.16,1.2.20

# 매니페스트 백업
cp /etc/kubernetes/manifests/kube-apiserver.yaml /tmp/kube-apiserver.yaml.bak

# 매니페스트 수정
vi /etc/kubernetes/manifests/kube-apiserver.yaml
```

수정할 내용:
```yaml
spec:
  containers:
  - command:
    - kube-apiserver
    - --anonymous-auth=false           # 추가 또는 true→false 수정
    - --profiling=false                # 추가
    - --audit-log-path=/var/log/kubernetes/audit/audit.log  # 추가
    # 기존 옵션들은 유지...
    volumeMounts:
    - name: audit-log
      mountPath: /var/log/kubernetes/audit/
  volumes:
  - name: audit-log
    hostPath:
      path: /var/log/kubernetes/audit/
      type: DirectoryOrCreate
```

```bash
# 디렉토리 생성
mkdir -p /var/log/kubernetes/audit/

# API Server 재시작 대기 (static pod이므로 kubelet이 자동 감지)
watch crictl ps | grep kube-apiserver

# 재점검
kube-bench run --targets master --check 1.2.1,1.2.16,1.2.20
# 모두 [PASS]
```

</details>

### 문제 4. Ingress TLS Secret 생성 및 적용

`app-namespace`에서 `myapp.example.com` 도메인에 TLS를 적용하라. 인증서 파일 `/tmp/tls.crt`와 키 파일 `/tmp/tls.key`가 제공된다. Secret 이름은 `myapp-tls`, Ingress 이름은 `myapp-ingress`로 하라.

<details>
<summary>풀이</summary>

```bash
# TLS Secret 생성
kubectl create secret tls myapp-tls \
  --cert=/tmp/tls.crt \
  --key=/tmp/tls.key \
  -n app-namespace
```

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: myapp-ingress
  namespace: app-namespace
spec:
  tls:
  - hosts:
    - myapp.example.com
    secretName: myapp-tls
  rules:
  - host: myapp.example.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: myapp-svc
            port:
              number: 80
```

**핵심 포인트:**
- Secret 타입은 `kubernetes.io/tls`
- Secret과 Ingress는 같은 네임스페이스에 있어야 한다
- Secret에 `tls.crt`와 `tls.key` 키가 필요

</details>

### 문제 5. 바이너리 무결성 검증

워커 노드의 kubelet 바이너리(v1.31.0)가 변조되지 않았는지 확인하라. 변조된 경우 공식 바이너리로 교체하라.

<details>
<summary>풀이</summary>

```bash
ssh node01

# 현재 바이너리 해시값
sha512sum /usr/bin/kubelet

# 공식 해시값 다운로드
curl -LO https://dl.k8s.io/v1.31.0/bin/linux/amd64/kubelet.sha512

# 비교
echo "$(cat kubelet.sha512)  /usr/bin/kubelet" | sha512sum --check
# OK → 무결성 확인
# FAILED → 변조됨, 교체 필요

# 변조된 경우 교체
curl -LO https://dl.k8s.io/v1.31.0/bin/linux/amd64/kubelet
chmod +x kubelet
sudo mv kubelet /usr/bin/kubelet
sudo systemctl restart kubelet

# 재검증
echo "$(cat kubelet.sha512)  /usr/bin/kubelet" | sha512sum --check
# OK
```

</details>

### 문제 6. 메타데이터 API 차단

`cloud-ns` 네임스페이스의 모든 Pod에서 클라우드 인스턴스 메타데이터 API(169.254.169.254)에 접근하는 것을 차단하라. DNS와 그 외 모든 통신은 허용해야 한다. 정책 이름은 `deny-metadata`로 하라.

<details>
<summary>풀이</summary>

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: deny-metadata
  namespace: cloud-ns
spec:
  podSelector: {}
  policyTypes:
  - Egress
  egress:
  - to: []
    ports:
    - protocol: UDP
      port: 53
    - protocol: TCP
      port: 53
  - to:
    - ipBlock:
        cidr: 0.0.0.0/0
        except:
        - 169.254.169.254/32
```

**핵심 포인트:**
- `except`로 메타데이터 IP만 제외
- DNS는 별도 규칙으로 허용
- `/32`는 단일 IP 주소를 의미

</details>

### 문제 7. 네임스페이스 간 통신 허용

`production` 네임스페이스의 `app=web` Pod에 대해, `monitoring` 네임스페이스(`name=monitoring` 라벨)의 `app=prometheus` Pod에서만 Ingress를 허용하라. 포트 9090만 허용한다.

<details>
<summary>풀이</summary>

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-prometheus-ingress
  namespace: production
spec:
  podSelector:
    matchLabels:
      app: web
  policyTypes:
  - Ingress
  ingress:
  - from:
    - namespaceSelector:
        matchLabels:
          name: monitoring
      podSelector:
        matchLabels:
          app: prometheus
    ports:
    - protocol: TCP
      port: 9090
```

**핵심 포인트:**
- `namespaceSelector`와 `podSelector`가 같은 `from` 항목 → AND 조건
- monitoring 네임스페이스에 `name=monitoring` 라벨이 있어야 한다
- 별도의 `from` 항목이면 OR 조건이 된다 (주의!)

</details>

### 문제 8. AND 조건과 OR 조건 구분

`production` 네임스페이스의 `app=api` Pod에 대해:
1. `app=frontend` Pod에서 오는 Ingress 허용 (같은 네임스페이스)
2. `monitoring` 네임스페이스에서 오는 Ingress 허용 (모든 Pod)
정책 이름은 `api-ingress-policy`로 하라.

<details>
<summary>풀이</summary>

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: api-ingress-policy
  namespace: production
spec:
  podSelector:
    matchLabels:
      app: api
  policyTypes:
  - Ingress
  ingress:
  # 규칙 1: 같은 네임스페이스의 frontend Pod (OR)
  - from:
    - podSelector:
        matchLabels:
          app: frontend
    ports:
    - protocol: TCP
      port: 8080
  # 규칙 2: monitoring 네임스페이스의 모든 Pod (OR)
  - from:
    - namespaceSelector:
        matchLabels:
          name: monitoring
    ports:
    - protocol: TCP
      port: 9090
```

**핵심 포인트:**
- 두 규칙이 별도의 ingress 항목 → OR 관계
- 규칙 1 또는 규칙 2 중 하나만 충족하면 허용
- AND를 원하면 같은 from 항목 안에 넣어야 한다

</details>

### 문제 9. kubelet 보안 설정

워커 노드 `node01`에서 kubelet의 다음 보안 설정을 수정하라:
- 익명 인증 비활성화
- 인가 모드를 Webhook으로 변경
- 읽기 전용 포트 비활성화

<details>
<summary>풀이</summary>

```bash
ssh node01

# 현재 설정 확인
cat /var/lib/kubelet/config.yaml

# 설정 수정
vi /var/lib/kubelet/config.yaml
```

수정 내용:
```yaml
authentication:
  anonymous:
    enabled: false         # 익명 인증 비활성화
  webhook:
    enabled: true
authorization:
  mode: Webhook            # AlwaysAllow → Webhook 변경
readOnlyPort: 0            # 10255 → 0 (비활성화)
```

```bash
# kubelet 재시작
systemctl restart kubelet

# 상태 확인
systemctl status kubelet

# 익명 접근 테스트 (차단되어야 함)
curl -sk https://localhost:10250/pods
# 401 Unauthorized → 성공
```

</details>

### 문제 10. 복합 NetworkPolicy - 3계층 아키텍처

`three-tier` 네임스페이스에 다음 정책을 모두 적용하라:
1. Default Deny All
2. DNS 허용 (모든 Pod)
3. `tier=frontend` Pod → `tier=backend` Pod (포트 8080)만 Egress 허용
4. `tier=backend` Pod → `tier=database` Pod (포트 5432)만 Egress 허용
5. 외부에서 `tier=frontend` Pod (포트 80)만 Ingress 허용

<details>
<summary>풀이</summary>

```yaml
# 1. Default Deny
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
  namespace: three-tier
spec:
  podSelector: {}
  policyTypes:
  - Ingress
  - Egress
---
# 2. DNS 허용
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-dns
  namespace: three-tier
spec:
  podSelector: {}
  policyTypes:
  - Egress
  egress:
  - to: []
    ports:
    - protocol: UDP
      port: 53
    - protocol: TCP
      port: 53
---
# 3. frontend → backend Egress
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: frontend-to-backend
  namespace: three-tier
spec:
  podSelector:
    matchLabels:
      tier: frontend
  policyTypes:
  - Egress
  egress:
  - to:
    - podSelector:
        matchLabels:
          tier: backend
    ports:
    - protocol: TCP
      port: 8080
---
# 3-1. backend Ingress from frontend
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: backend-from-frontend
  namespace: three-tier
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
---
# 4. backend → database Egress
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: backend-to-database
  namespace: three-tier
spec:
  podSelector:
    matchLabels:
      tier: backend
  policyTypes:
  - Egress
  egress:
  - to:
    - podSelector:
        matchLabels:
          tier: database
    ports:
    - protocol: TCP
      port: 5432
---
# 4-1. database Ingress from backend
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: database-from-backend
  namespace: three-tier
spec:
  podSelector:
    matchLabels:
      tier: database
  policyTypes:
  - Ingress
  ingress:
  - from:
    - podSelector:
        matchLabels:
          tier: backend
    ports:
    - protocol: TCP
      port: 5432
---
# 5. 외부 → frontend Ingress
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: frontend-external-ingress
  namespace: three-tier
spec:
  podSelector:
    matchLabels:
      tier: frontend
  policyTypes:
  - Ingress
  ingress:
  - ports:
    - protocol: TCP
      port: 80
```

**핵심 포인트:**
- Default Deny 후 필요한 것만 허용하는 패턴
- Egress와 Ingress 양쪽 모두 허용해야 통신 가능
- 여러 NetworkPolicy는 합집합(UNION)으로 적용됨

</details>

### 문제 11. Egress 제한 - 외부 HTTPS만 허용

`secure-ns` 네임스페이스의 `app=payment` Pod가 DNS와 외부 HTTPS(443)로만 Egress 통신하도록 하라. 내부 클러스터 통신은 차단한다.

<details>
<summary>풀이</summary>

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: payment-egress-https-only
  namespace: secure-ns
spec:
  podSelector:
    matchLabels:
      app: payment
  policyTypes:
  - Egress
  egress:
  - to: []
    ports:
    - protocol: UDP
      port: 53
    - protocol: TCP
      port: 53
  - to:
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

</details>

### 문제 12. Ingress TLS - 인증서 직접 생성부터

`secure-app` 네임스페이스에서 도메인 `secure.example.com`에 대한 TLS Ingress를 설정하라. 자체 서명 인증서를 직접 생성하고, TLS Secret을 만들고, Ingress에 적용하라.

<details>
<summary>풀이</summary>

```bash
# 인증서 생성
openssl req -x509 -nodes -days 365 \
  -newkey rsa:2048 \
  -keyout /tmp/tls.key \
  -out /tmp/tls.crt \
  -subj "/CN=secure.example.com"

# TLS Secret 생성
kubectl create ns secure-app
kubectl create secret tls secure-tls \
  --cert=/tmp/tls.crt \
  --key=/tmp/tls.key \
  -n secure-app
```

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: secure-ingress
  namespace: secure-app
  annotations:
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
spec:
  tls:
  - hosts:
    - secure.example.com
    secretName: secure-tls
  rules:
  - host: secure.example.com
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

</details>

---

## 6. 실습: NetworkPolicy 검증

### 6.1 테스트 환경 구성

```bash
# 네임스페이스 생성
kubectl create ns netpol-lab

# 테스트 워크로드 배포
kubectl run web --image=nginx:alpine --port=80 -n netpol-lab
kubectl run api --image=nginx:alpine --port=80 -n netpol-lab --labels="role=api"
kubectl run attacker --image=busybox:1.36 --restart=Never \
  -n netpol-lab --labels="role=attacker" -- sleep 3600
kubectl wait --for=condition=ready pod --all -n netpol-lab --timeout=60s

# 정책 적용 전 — 모든 통신 가능
kubectl exec attacker -n netpol-lab -- wget -qO- --timeout=3 http://web
kubectl exec attacker -n netpol-lab -- wget -qO- --timeout=3 http://api
# 모두 성공
```

### 6.2 Default Deny 적용 및 검증

```bash
cat <<'EOF' | kubectl apply -n netpol-lab -f -
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
spec:
  podSelector: {}
  policyTypes:
    - Ingress
    - Egress
EOF

# 모든 통신 차단 확인
kubectl exec attacker -n netpol-lab -- wget -qO- --timeout=3 http://web 2>&1
# 타임아웃
```

### 6.3 선택적 허용 — DNS + web→api 체인

```bash
# DNS 허용
cat <<'EOF' | kubectl apply -n netpol-lab -f -
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-dns
spec:
  podSelector: {}
  policyTypes:
    - Egress
  egress:
    - to: []
      ports:
        - protocol: UDP
          port: 53
        - protocol: TCP
          port: 53
EOF

# web → api 허용
cat <<'EOF' | kubectl apply -n netpol-lab -f -
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: web-to-api-egress
spec:
  podSelector:
    matchLabels:
      run: web
  policyTypes:
    - Egress
  egress:
    - to:
        - podSelector:
            matchLabels:
              role: api
      ports:
        - protocol: TCP
          port: 80
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: api-ingress-from-web
spec:
  podSelector:
    matchLabels:
      role: api
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              run: web
      ports:
        - protocol: TCP
          port: 80
EOF

# 검증
kubectl exec -n netpol-lab web -- wget -qO- --timeout=3 http://api     # 성공
kubectl exec -n netpol-lab attacker -- wget -qO- --timeout=3 http://api  # 실패
```

### 6.4 kube-bench 실행 실습

```bash
# kube-bench 설치 (없는 경우)
curl -L https://github.com/aquasecurity/kube-bench/releases/download/v0.8.0/kube-bench_0.8.0_linux_amd64.tar.gz | tar xz
sudo mv kube-bench /usr/local/bin/

# 마스터 노드 점검
kube-bench run --targets master

# 실패 항목만 확인
kube-bench run --targets master 2>&1 | grep "\[FAIL\]"

# 특정 항목 점검
kube-bench run --targets master --check 1.2.1,1.2.16,1.2.20

# API Server 매니페스트 확인
cat /etc/kubernetes/manifests/kube-apiserver.yaml

# 주요 보안 설정 확인
grep -E "anonymous-auth|authorization-mode|enable-admission-plugins|profiling" \
  /etc/kubernetes/manifests/kube-apiserver.yaml
```

### 6.5 TLS Secret 실습

```bash
# 자체 서명 인증서 생성
openssl req -x509 -nodes -days 365 \
  -newkey rsa:2048 \
  -keyout /tmp/tls.key \
  -out /tmp/tls.crt \
  -subj "/CN=nginx.tart-infra.local"

# TLS Secret 생성
kubectl create secret tls nginx-tls \
  --cert=/tmp/tls.crt \
  --key=/tmp/tls.key \
  -n netpol-lab

# Secret 확인
kubectl get secret nginx-tls -n netpol-lab -o jsonpath='{.data.tls\.crt}' | \
  base64 -d | openssl x509 -text -noout

# 정리
kubectl delete ns netpol-lab
```

---

## 7. CiliumNetworkPolicy vs 표준 NetworkPolicy

### 7.1 차이점 정리

```
표준 K8s NetworkPolicy vs CiliumNetworkPolicy
═══════════════════════════════════════════════

항목              | 표준 NetworkPolicy          | CiliumNetworkPolicy
─────────────────┼────────────────────────────┼────────────────────────
API 버전         | networking.k8s.io/v1       | cilium.io/v2
L3/L4 지원       | O                          | O
L7 (HTTP) 지원   | X                          | O (GET/POST 등 제어)
FQDN 기반 정책   | X                          | O (도메인 기반 허용)
Identity 기반    | X                          | O (Cilium Identity)
TLS 검사         | X                          | O (투명 프록시)
eBPF 기반        | CNI에 따라 다름            | O (항상 eBPF)
클러스터 범위     | X (네임스페이스 범위)       | O (CiliumClusterwideNetworkPolicy)

CKS 시험에서는 표준 NetworkPolicy만 출제된다.
하지만 실무에서는 CiliumNetworkPolicy가 더 강력하다.
```

### 7.2 CiliumNetworkPolicy L7 예시 (참고)

```yaml
# CiliumNetworkPolicy - L7 HTTP 규칙
# ──────────────────────────────────
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: allow-get-only
  namespace: demo
spec:
  endpointSelector:
    matchLabels:
      app: httpbin
  ingress:
  - fromEndpoints:
    - matchLabels:
        app: nginx
    toPorts:
    - ports:
      - port: "8080"
        protocol: TCP
      rules:
        http:
        - method: "GET"        # GET 요청만 허용
          path: "/.*"           # 모든 경로
        - method: "HEAD"       # HEAD 요청도 허용
  # POST, PUT, DELETE 등은 차단된다
```

---

## 8. 트러블슈팅 종합

```
Cluster Setup 도메인 트러블슈팅 정리
════════════════════════════════════

시나리오 1: NetworkPolicy 적용 후 정상 트래픽도 차단된다
  디버깅:
    kubectl describe networkpolicy <name> -n <ns>  # 정책 상세 확인
    # podSelector가 의도한 Pod를 선택하는지 라벨 대조
    kubectl get pods -n <ns> --show-labels
  원인: podSelector 라벨이 잘못되었거나 DNS 허용 정책이 누락되었다
  해결: 라벨 수정 또는 allow-dns 정책 추가

시나리오 2: kube-bench 수정 후 kubectl이 응답하지 않는다
  디버깅:
    crictl ps -a | grep kube-apiserver  # API Server 컨테이너 상태
    crictl logs <container-id> 2>&1 | tail -20  # 에러 확인
  원인: 매니페스트 YAML 문법 오류 또는 플래그 값 오타이다
  해결: 백업(/tmp/kube-apiserver.yaml.bak)에서 복원 후 재수정

시나리오 3: TLS Secret을 생성했는데 Ingress가 HTTPS를 서빙하지 않는다
  디버깅:
    kubectl describe ingress <name> -n <ns>  # TLS 섹션 확인
    kubectl get secret <secret-name> -n <ns> -o jsonpath='{.type}'
    # kubernetes.io/tls인지 확인
  원인: Secret과 Ingress가 다른 네임스페이스에 있거나, Secret 타입이 Opaque이다
  해결: 같은 네임스페이스에 kubernetes.io/tls 타입 Secret 생성

시나리오 4: sha512sum 비교에서 FAILED가 나온다
  디버깅:
    kubelet --version   # 현재 바이너리 버전 확인
    cat kubelet.sha512  # 다운로드한 해시의 대상 버전 확인
  원인: 바이너리 버전과 해시 파일의 버전이 불일치하거나, 실제 변조되었다
  해결: 버전이 일치하는 공식 바이너리로 교체한다
```

---

## 9. 복습 체크리스트

- [ ] Default Deny All NetworkPolicy YAML을 외우지 않고 작성할 수 있는가?
- [ ] DNS 허용 + 특정 Pod만 Egress 허용 패턴을 작성할 수 있는가?
- [ ] `namespaceSelector`와 `podSelector`의 AND/OR 조건 차이를 설명할 수 있는가?
- [ ] Default Deny 후 Egress만 허용하면 왜 통신이 안 되는지 설명할 수 있는가?
- [ ] kube-bench 명령어와 결과 해석 방법을 알고 있는가?
- [ ] FAIL 항목 수정 후 API server 재시작 절차를 수행할 수 있는가?
- [ ] kubelet 설정 파일의 보안 항목을 수정할 수 있는가?
- [ ] TLS Secret 생성과 Ingress 적용 절차를 수행할 수 있는가?
- [ ] sha512sum으로 바이너리 무결성을 검증할 수 있는가?
- [ ] 메타데이터 API(169.254.169.254) 차단 NetworkPolicy를 작성할 수 있는가?
- [ ] 네임스페이스 간 통신을 허용하는 NetworkPolicy를 작성할 수 있는가?
- [ ] ipBlock의 cidr과 except를 활용할 수 있는가?

---

> **내일 예고:** Day 3에서는 Cluster Hardening 도메인(15%)의 RBAC 인가 모델, ServiceAccount 토큰 제한, API Server 보안 설정을 학습한다.

---

## tart-infra 실습

### 실습 환경 설정

```bash
# dev 클러스터에 접속 (CiliumNetworkPolicy + Zero Trust 적용된 환경)
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/dev.yaml
kubectl get nodes
```

**예상 출력:**
```
NAME          STATUS   ROLES           AGE   VERSION
dev-master    Ready    control-plane   30d   v1.31.0
dev-worker1   Ready    <none>          30d   v1.31.0
```

### 실습 1: Default Deny NetworkPolicy 확인

```bash
# dev 클러스터에 적용된 CiliumNetworkPolicy 목록
kubectl get ciliumnetworkpolicies -n demo
```

**예상 출력:**
```
NAME                          AGE
allow-dns                     5d
allow-httpbin-from-nginx      5d
allow-nginx-ingress           5d
allow-postgres-from-httpbin   5d
allow-redis-from-httpbin      5d
allow-rabbitmq-from-httpbin   5d
default-deny-all              5d
...
```

**동작 원리:** Zero Trust 네트워크 구현:
1. `default-deny-all` 정책이 demo 네임스페이스의 모든 ingress/egress를 차단한다
2. 이후 각 서비스 간 필요한 통신만 개별 정책으로 허용한다 (Allow List 방식)
3. Cilium이 eBPF 프로그램으로 커널 공간에서 패킷 필터링을 수행한다
4. 표준 K8s NetworkPolicy보다 L7(HTTP 메서드, 경로)까지 제어 가능하다

```bash
# default-deny-all 정책 내용 확인
kubectl get ciliumnetworkpolicy default-deny-all -n demo -o yaml
```

### 실습 2: NetworkPolicy 통신 테스트

```bash
# 허용된 통신: nginx → httpbin (allow-httpbin-from-nginx 정책)
kubectl exec -n demo deploy/nginx-web -- curl -s -o /dev/null -w "%{http_code}" --max-time 3 http://httpbin:8000/get
echo ""

# 차단된 통신: nginx → postgres (직접 통신 정책 없음)
kubectl exec -n demo deploy/nginx-web -- curl -s -o /dev/null -w "%{http_code}" --max-time 3 http://postgres-svc:5432 2>&1 || echo "BLOCKED"
```

**예상 출력:**
```
200
BLOCKED
```

**동작 원리:** NetworkPolicy 매칭 과정:
1. Pod에서 패킷이 나갈 때 Cilium eBPF가 egress 정책을 확인한다
2. 목적지 Pod에 패킷이 도착할 때 ingress 정책을 확인한다
3. 양쪽(egress + ingress) 모두 허용되어야 통신이 성공한다
4. DNS(allow-dns 정책)가 있어야 Service 이름으로 통신 가능하다 (그렇지 않으면 IP 직접 지정 필요)

### 실습 3: kube-bench 스타일 점검

```bash
# API Server 보안 설정 확인 (SSH 없이 Pod YAML로 확인)
kubectl get pod kube-apiserver-dev-master -n kube-system -o yaml | grep -E "(--anonymous-auth|--authorization-mode|--enable-admission-plugins|--audit-log)"
```

**예상 출력 (주요 부분):**
```
    - --authorization-mode=Node,RBAC
    - --enable-admission-plugins=NodeRestriction
```

**동작 원리:** CIS Benchmark 주요 점검 항목:
1. `--anonymous-auth=false`: 익명 접근 차단 (기본값은 true)
2. `--authorization-mode=Node,RBAC`: RBAC 인가 활성화
3. `--enable-admission-plugins=NodeRestriction`: kubelet이 자신의 노드 리소스만 수정 가능
4. `--audit-log-path`: 감사 로그 경로 설정 — 미설정 시 감사 불가

### 실습 4: TLS 인증서 확인

```bash
# API Server 인증서 정보 확인
kubectl get pod kube-apiserver-dev-master -n kube-system -o yaml | grep -E "(--tls-cert-file|--tls-private-key-file|--client-ca-file)"
```

**예상 출력:**
```
    - --tls-cert-file=/etc/kubernetes/pki/apiserver.crt
    - --tls-private-key-file=/etc/kubernetes/pki/apiserver.key
    - --client-ca-file=/etc/kubernetes/pki/ca.crt
```

**동작 원리:** K8s PKI(Public Key Infrastructure):
1. `/etc/kubernetes/pki/ca.crt`: 클러스터 루트 CA — 모든 컴포넌트의 인증서를 서명한다
2. `apiserver.crt/key`: API Server의 TLS 인증서 — 클라이언트가 이 인증서로 API Server를 검증
3. `client-ca-file`: 클라이언트 인증서를 검증할 CA — kubectl의 인증서를 확인한다
4. kubeadm이 클러스터 생성 시 이 인증서들을 자동으로 생성한다
