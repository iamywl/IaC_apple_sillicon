# CKS 실습 가이드 — tart-infra 환경 활용

> CKS(Certified Kubernetes Security Specialist) 시험 범위에 맞춰 tart-infra 실제 인프라를 활용하는 보안 실습 가이드이다.
> CKS는 K8s 자격증 중 가장 높은 난이도이며, CKA 합격이 선수 조건이다.
> 4개 클러스터(platform, dev, staging, prod)를 활용하며, dev 클러스터의 demo 네임스페이스를 주로 사용한다.

---

## 인프라 보안 구성 요약

| 구성요소 | 설정 | 보안 관련성 |
|---------|------|-----------|
| Cilium CNI | 11개 CiliumNetworkPolicy | L3/L4/L7 네트워크 보안 |
| Istio | mTLS STRICT | 전송 암호화, 서비스 인증 |
| RBAC | ClusterRole/Role 바인딩 | 접근 제어 |
| Secret | postgres(demo123), rabbitmq(demo/demo123) | 민감정보 관리 |
| ArgoCD | auto-sync, github.com/iamywl/IaC_apple_sillicon.git | GitOps 보안 |
| Prometheus | 8개 AlertRule | 이상 탐지 |
| HPA | nginx 3→10, httpbin 2→6 | DoS 완화 |
| PDB | minAvailable | 가용성 보장 |

---

## 사전 준비

```bash
export KUBECONFIG=kubeconfig/dev-kubeconfig
kubectl get nodes
kubectl get pods -n demo
```

### 검증: 환경 접근 확인

```bash
# 검증 1: 클러스터 연결 상태 확인
kubectl cluster-info
```

```text
Kubernetes control plane is running at https://192.168.64.X:6443
CoreDNS is running at https://192.168.64.X:6443/api/v1/namespaces/kube-system/services/kube-dns:dns/proxy
```

```bash
# 검증 2: 노드 상태 확인
kubectl get nodes -o wide
```

```text
NAME           STATUS   ROLES           AGE   VERSION   INTERNAL-IP      OS-IMAGE
dev-master     Ready    control-plane   Xd    v1.29.X   192.168.64.X     Ubuntu 22.04
dev-worker-1   Ready    <none>          Xd    v1.29.X   192.168.64.X     Ubuntu 22.04
```

```bash
# 검증 3: demo 네임스페이스 Pod 상태 확인
kubectl get pods -n demo -o wide
```

```text
NAME                          READY   STATUS    RESTARTS   AGE
httpbin-xxxxx-xxxxx           2/2     Running   0          Xd
nginx-web-xxxxx-xxxxx         2/2     Running   0          Xd
postgres-0                    2/2     Running   0          Xd
redis-0                       2/2     Running   0          Xd
```

---

## 1. Cluster Setup (10%) 실습

### 실습 1.1: CiliumNetworkPolicy 전체 분석 [난이도: ★★☆]

**학습 목표:** dev 클러스터의 11개 CiliumNetworkPolicy를 분석하고 트래픽 흐름을 이해한다.

#### 등장 배경과 기존 한계점

쿠버네티스 표준 NetworkPolicy는 L3/L4(IP/포트) 수준의 트래픽 제어만 지원한다. HTTP 메서드(GET/POST), URL 경로, gRPC 서비스 등 L7 수준의 세밀한 제어가 불가능하다. 또한 표준 NetworkPolicy는 CIDR 기반 외부 트래픽 제어가 제한적이며, FQDN 기반 정책을 지원하지 않는다.

CiliumNetworkPolicy는 eBPF 기반 CNI인 Cilium이 제공하는 확장된 네트워크 정책이다. Linux 커널의 eBPF 프로그램으로 패킷을 처리하므로 iptables 기반 CNI보다 성능이 우수하며, L7 HTTP/gRPC/Kafka 프로토콜 수준의 트래픽 제어가 가능하다.

#### 커널 레벨 동작 원리

Cilium은 eBPF 프로그램을 커널의 TC(Traffic Control) 훅에 attach하여 패킷을 처리한다. eBPF 프로그램은 커널 공간에서 실행되므로 사용자 공간으로의 컨텍스트 스위칭이 없다. 패킷이 네트워크 인터페이스에 도착하면 커널이 eBPF 프로그램을 호출하고, eBPF 프로그램이 CiliumNetworkPolicy의 규칙과 대조하여 패킷을 허용하거나 차단한다.

```
패킷 수신 → NIC → TC ingress hook → eBPF 프로그램 실행
    → Policy Map 조회 → 허용/차단 결정 → 패킷 전달 또는 드롭
```

L7 정책의 경우, eBPF 프로그램이 패킷의 페이로드까지 검사한다. HTTP 요청이면 메서드와 경로를 파싱하고, 정책에 정의된 규칙과 대조한다.

#### 방어하는 공격 벡터

| 공격 시나리오 | CiliumNetworkPolicy의 방어 효과 |
|---|---|
| Lateral movement (측면 이동) | Default Deny로 Pod 간 비인가 통신을 차단한다 |
| API 악용 (POST/DELETE 남용) | L7 HTTP 규칙으로 허용된 메서드만 통과시킨다 |
| DNS 터널링 | DNS Egress를 kube-dns로 제한하여 외부 DNS 서버를 통한 데이터 유출을 차단한다 |
| 데이터 유출 (Egress) | Egress 정책으로 허용된 대상 서비스로만 트래픽을 허용한다 |
| 서비스 스캔/열거 | 허용되지 않은 포트로의 접근을 차단하여 서비스 디스커버리를 방해한다 |

```bash
# 1. 전체 정책 목록
kubectl get ciliumnetworkpolicy -n demo
```

```text
NAME                         AGE
allow-dns-egress             Xd
allow-httpbin-to-postgres    Xd
allow-httpbin-to-redis       Xd
allow-nginx-to-httpbin       Xd
default-deny-egress          Xd
default-deny-ingress         Xd
...
```

```bash
# 2. Default Deny 정책 확인
kubectl get cnp default-deny-ingress -n demo -o yaml
kubectl get cnp default-deny-egress -n demo -o yaml

# 3. 각 Allow 정책 분석
for policy in $(kubectl get cnp -n demo -o name); do
  echo "=== $policy ==="
  kubectl get $policy -n demo -o yaml | grep -A 20 "spec:"
  echo ""
done

# 4. L7 HTTP 규칙 확인
kubectl get cnp allow-nginx-to-httpbin -n demo -o yaml | grep -A 10 "http"
# method: GET만 허용
```

#### 검증: L7 정책 동작 확인

```bash
# 검증 1: nginx에서 httpbin으로 GET 요청 (허용)
NGINX_POD=$(kubectl get pods -n demo -l app=nginx-web -o jsonpath='{.items[0].metadata.name}')
kubectl exec $NGINX_POD -n demo -c nginx -- wget -qO- --timeout=5 http://httpbin.demo:8080/get
```

```text
{
  "args": {},
  "headers": {
    "Host": "httpbin.demo:8080",
    ...
  },
  "url": "http://httpbin.demo:8080/get"
}
```

```bash
# 검증 2: nginx에서 httpbin으로 POST 요청 (L7 규칙에 의해 차단)
kubectl exec $NGINX_POD -n demo -c nginx -- wget -qO- --timeout=5 --post-data='test=1' http://httpbin.demo:8080/post 2>&1
```

```text
wget: server returned error: HTTP/1.1 403 Forbidden
```

```bash
# 검증 3: 정책 적용 상태 확인
kubectl get cnp -n demo -o jsonpath='{range .items[*]}{.metadata.name}: {.status.conditions[0].type}={.status.conditions[0].status}{"\n"}{end}'
```

```text
allow-dns-egress: Ready=True
allow-httpbin-to-postgres: Ready=True
...
default-deny-ingress: Ready=True
```

```bash
# 검증 4: Cilium 엔드포인트의 정책 적용 상태 확인
kubectl exec -n kube-system $(kubectl get pods -n kube-system -l k8s-app=cilium -o jsonpath='{.items[0].metadata.name}') -- cilium endpoint list | head -10
```

```text
ENDPOINT   POLICY (ingress)   POLICY (egress)   IDENTITY   LABELS (source:key[=value])
1234       Enabled            Enabled           12345      k8s:app=nginx-web
5678       Enabled            Enabled           12346      k8s:app=httpbin
```

**트래픽 흐름도:**
```
외부 → nginx-web(30080) → httpbin(GET only) → redis
                                              → postgres
keycloak(30880) ← 외부
rabbitmq ← 내부 only
DNS(53) ← 모든 Pod
```

#### 트러블슈팅: 정책이 적용되지 않는 경우

```bash
# 1. Cilium agent 상태 확인
kubectl exec -n kube-system $(kubectl get pods -n kube-system -l k8s-app=cilium -o jsonpath='{.items[0].metadata.name}') -- cilium status
```

```text
KVStore:         Ok   Disabled
Kubernetes:      Ok   1.29 (v1.29.X) [linux/arm64]
...
Controller Status:   XX/XX healthy
```

```bash
# 2. 정책이 eBPF map에 로드되었는지 확인
kubectl exec -n kube-system $(kubectl get pods -n kube-system -l k8s-app=cilium -o jsonpath='{.items[0].metadata.name}') -- cilium policy get | grep -c "rule"

# 3. 특정 트래픽이 차단된 원인 확인 (Hubble 사용)
kubectl exec -n kube-system $(kubectl get pods -n kube-system -l k8s-app=cilium -o jsonpath='{.items[0].metadata.name}') -- hubble observe --verdict DROPPED --from-pod demo/nginx-web --last 10 2>/dev/null
```

```text
TIMESTAMP             SOURCE              DESTINATION          TYPE     VERDICT   SUMMARY
2024-01-15T10:30:00   demo/nginx-web      demo/httpbin         L7/HTTP  DROPPED   POST http://httpbin.demo:8080/post
```

**자기 점검:**
- [ ] Default Deny + Explicit Allow 패턴을 설명할 수 있는가?
- [ ] L7 규칙이 eBPF를 통해 커널에서 어떻게 강제되는지 설명할 수 있는가?
- [ ] CiliumNetworkPolicy와 표준 NetworkPolicy의 차이점은?
- [ ] Hubble을 사용하여 차단된 트래픽을 디버깅할 수 있는가?

**관련 CKS 시험 주제:** NetworkPolicy를 사용한 클러스터 레벨 접근 제어

---

### 실습 1.2: NetworkPolicy 직접 작성 및 테스트 [난이도: ★★★]

**학습 목표:** 표준 K8s NetworkPolicy를 직접 작성하고 트래픽 제어를 검증한다.

#### 등장 배경과 기존 한계점

쿠버네티스는 기본적으로 flat network 구조를 채택한다. 모든 Pod는 클러스터 내 다른 모든 Pod와 직접 통신이 가능하다. 이 설계는 개발 편의성을 높이지만 보안상 치명적이다. 하나의 Pod가 침해되면 공격자는 동일 네트워크 내 모든 서비스에 접근할 수 있다. 데이터베이스, 캐시 서버, 내부 API 등에 대한 네트워크 레벨 격리가 없기 때문이다.

NetworkPolicy는 쿠버네티스 1.3에서 도입된 네트워크 격리 메커니즘이다. Pod 레벨에서 Ingress(유입 트래픽)와 Egress(유출 트래픽)를 제어한다. CNI 플러그인(Calico, Cilium, Weave Net 등)이 이 정책을 Linux 커널의 iptables 규칙 또는 eBPF 프로그램으로 변환하여 실제 커널에서 강제한다.

#### 커널 레벨 동작 원리 (iptables 기반 CNI)

iptables 기반 CNI(예: Calico)에서 NetworkPolicy가 적용되면 다음과 같은 iptables 체인이 생성된다:

```
FORWARD chain → cali-FORWARD → cali-to-wl-dispatch → cali-tw-<endpoint>
                                                       → policy match → ACCEPT/DROP
```

각 Pod의 veth 인터페이스에 대응하는 iptables 체인이 생성되고, NetworkPolicy의 규칙이 iptables 규칙으로 변환된다. 패킷이 Pod의 veth 인터페이스를 통과할 때 커널의 netfilter 프레임워크가 이 규칙을 평가하여 허용/차단을 결정한다.

NetworkPolicy의 핵심 특성:
- **Additive(누적적)**: 같은 Pod에 여러 NetworkPolicy가 적용되면 허용 규칙이 합산된다. 즉, 하나의 정책이라도 트래픽을 허용하면 통과한다
- **Default Allow**: NetworkPolicy가 없으면 모든 트래픽이 허용된다
- **Default Deny 패턴**: `podSelector: {}`와 빈 ingress/egress 규칙으로 모든 트래픽을 차단한 후, 필요한 트래픽만 명시적으로 허용하는 패턴이 보안의 기본이다

```bash
# 1. 테스트 네임스페이스 생성
kubectl create ns netpol-lab

# 2. 테스트 워크로드 배포
kubectl run web --image=nginx:alpine --port=80 -n netpol-lab
kubectl run api --image=nginx:alpine --port=80 -n netpol-lab --labels="role=api"
kubectl run db --image=nginx:alpine --port=80 -n netpol-lab --labels="role=db"
kubectl run attacker --image=busybox:1.36 --restart=Never -n netpol-lab --labels="role=attacker" -- sleep 3600

kubectl wait --for=condition=ready pod --all -n netpol-lab --timeout=60s
```

#### 검증: 정책 적용 전 통신 테스트

```bash
# 검증 1: 정책 적용 전 — 모든 통신 가능
kubectl exec attacker -n netpol-lab -- wget -qO- --timeout=3 http://web
```

```text
<!DOCTYPE html>
<html>
<head>
<title>Welcome to nginx!</title>
...
```

```bash
kubectl exec attacker -n netpol-lab -- wget -qO- --timeout=3 http://api
kubectl exec attacker -n netpol-lab -- wget -qO- --timeout=3 http://db
# 모두 성공 — NetworkPolicy가 없으므로 모든 Pod 간 통신이 가능하다
```

```bash
# 4. Default Deny 적용
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
```

#### 검증: Default Deny 적용 후

```bash
# 검증 2: 모든 통신 차단 확인
kubectl exec attacker -n netpol-lab -- wget -qO- --timeout=3 http://web 2>&1
```

```text
wget: download timed out
```

```bash
# 검증 3: DNS도 차단됨 확인
kubectl exec attacker -n netpol-lab -- nslookup web 2>&1
```

```text
;; connection timed out; no servers could be reached
```

```bash
# 5. 선택적 허용 — DNS 허용
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

# 6. web → api 허용 (Egress + Ingress 양방향 필요)
cat <<'EOF' | kubectl apply -n netpol-lab -f -
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: web-to-api
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

# 7. api → db 허용
cat <<'EOF' | kubectl apply -n netpol-lab -f -
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: api-to-db
spec:
  podSelector:
    matchLabels:
      role: api
  policyTypes:
    - Egress
  egress:
    - to:
        - podSelector:
            matchLabels:
              role: db
      ports:
        - protocol: TCP
          port: 80
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: db-ingress-from-api
spec:
  podSelector:
    matchLabels:
      role: db
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              role: api
      ports:
        - protocol: TCP
          port: 80
EOF
```

#### 검증: 선택적 허용 동작 확인

```bash
# 검증 4: web → api (허용)
kubectl exec web -n netpol-lab -- wget -qO- --timeout=3 http://api
```

```text
<!DOCTYPE html>
<html>
<head>
<title>Welcome to nginx!</title>
...
```

```bash
# 검증 5: web → db (차단 — 직접 경로 없음)
kubectl exec web -n netpol-lab -- wget -qO- --timeout=3 http://db 2>&1
```

```text
wget: download timed out
```

```bash
# 검증 6: api → db (허용)
kubectl exec api -n netpol-lab -- wget -qO- --timeout=3 http://db
```

```text
<!DOCTYPE html>
<html>
...
```

```bash
# 검증 7: attacker → 모든 곳 (차단 — attacker에 대한 Egress 허용 정책 없음)
kubectl exec attacker -n netpol-lab -- wget -qO- --timeout=3 http://web 2>&1
```

```text
wget: download timed out
```

```bash
# 검증 8: 적용된 NetworkPolicy 목록 확인
kubectl get networkpolicy -n netpol-lab
```

```text
NAME                  POD-SELECTOR    AGE
default-deny-all      <none>          2m
allow-dns             <none>          90s
web-to-api            run=web         60s
api-ingress-from-web  role=api        60s
api-to-db             role=api        30s
db-ingress-from-api   role=db         30s
```

```bash
# 정리
kubectl delete ns netpol-lab
```

#### 트러블슈팅: NetworkPolicy가 동작하지 않는 경우

| 증상 | 원인 | 해결 방법 |
|---|---|---|
| 정책 적용 후에도 통신 가능 | CNI가 NetworkPolicy를 지원하지 않음 | CNI 플러그인 확인 (flannel은 미지원) |
| DNS 해석 실패 | Default Deny가 DNS Egress도 차단 | allow-dns 정책 추가 |
| 정책이 특정 Pod에 적용되지 않음 | podSelector의 라벨 불일치 | `kubectl get pod --show-labels`로 확인 |
| 양방향 통신 불가 | Ingress만 설정하고 Egress 미설정 | 양쪽 Pod에 Ingress/Egress 정책 모두 필요 |

**자기 점검:**
- [ ] 3-tier (web→api→db) 구조의 NetworkPolicy를 직접 작성할 수 있는가?
- [ ] Ingress/Egress 정책의 방향성을 정확히 이해하는가?
- [ ] namespaceSelector를 활용한 cross-namespace 정책을 작성할 수 있는가?
- [ ] NetworkPolicy의 additive(누적적) 특성을 설명할 수 있는가?

**관련 CKS 시험 주제:** NetworkPolicy 설계 및 구현

---

### 실습 1.3: CIS Kubernetes Benchmark 실행 [난이도: ★★★]

**학습 목표:** kube-bench로 CIS Benchmark를 실행하고 FAIL 항목을 수정한다.

#### 등장 배경과 기존 한계점

쿠버네티스 기본 설치는 기능 동작에 초점을 맞추며, 보안 최적화가 되어 있지 않다. API 서버의 anonymous 접근이 활성화되어 있거나, audit 로그가 설정되지 않거나, kubelet의 인증이 약한 경우가 흔하다. 수백 개의 보안 설정을 수동으로 점검하는 것은 비현실적이다.

CIS(Center for Internet Security) Benchmark는 업계 표준 보안 가이드라인이다. 쿠버네티스 CIS Benchmark는 API 서버, etcd, Controller Manager, Scheduler, kubelet 등 각 컴포넌트의 보안 설정 항목을 정의한다. kube-bench는 이 벤치마크에 대한 자동화된 점검 도구로, 노드에서 실행되어 실제 설정 파일과 프로세스 인자를 검사한다.

#### 방어하는 공격 벡터

| CIS 항목 | 공격 시나리오 | 방어 효과 |
|---|---|---|
| 1.2.1 anonymous-auth | 미인증 사용자가 API에 접근 | anonymous 접근 비활성화로 인증 강제 |
| 1.2.6 kubelet-certificate-authority | kubelet과 API 서버 간 MITM | kubelet 인증서 검증으로 MITM 차단 |
| 1.2.16 PodSecurity admission | 특권 컨테이너 생성 | PodSecurity admission으로 위험한 Pod 차단 |
| 1.2.18 audit-log-path | 침해 사고 시 추적 불가 | Audit 로그로 모든 API 요청 기록 |
| 4.2.6 protectKernelDefaults | Pod가 커널 파라미터 변경 | kubelet이 unsafe sysctl 사용 차단 |

```bash
# 1. kube-bench Job 배포 (Master 노드)
cat <<'EOF' | kubectl apply -f -
apiVersion: batch/v1
kind: Job
metadata:
  name: kube-bench-master
spec:
  template:
    spec:
      hostPID: true
      containers:
        - name: kube-bench
          image: aquasec/kube-bench:latest
          command: ["kube-bench", "run", "--targets", "master"]
          volumeMounts:
            - name: var-lib-kubelet
              mountPath: /var/lib/kubelet
              readOnly: true
            - name: etc-kubernetes
              mountPath: /etc/kubernetes
              readOnly: true
            - name: etc-systemd
              mountPath: /etc/systemd
              readOnly: true
      volumes:
        - name: var-lib-kubelet
          hostPath:
            path: /var/lib/kubelet
        - name: etc-kubernetes
          hostPath:
            path: /etc/kubernetes
        - name: etc-systemd
          hostPath:
            path: /etc/systemd
      restartPolicy: Never
      nodeSelector:
        node-role.kubernetes.io/control-plane: ""
      tolerations:
        - key: node-role.kubernetes.io/control-plane
          effect: NoSchedule
EOF

# 2. Worker 노드 벤치마크
cat <<'EOF' | kubectl apply -f -
apiVersion: batch/v1
kind: Job
metadata:
  name: kube-bench-worker
spec:
  template:
    spec:
      hostPID: true
      containers:
        - name: kube-bench
          image: aquasec/kube-bench:latest
          command: ["kube-bench", "run", "--targets", "node"]
          volumeMounts:
            - name: var-lib-kubelet
              mountPath: /var/lib/kubelet
              readOnly: true
            - name: etc-kubernetes
              mountPath: /etc/kubernetes
              readOnly: true
      volumes:
        - name: var-lib-kubelet
          hostPath:
            path: /var/lib/kubelet
        - name: etc-kubernetes
          hostPath:
            path: /etc/kubernetes
      restartPolicy: Never
      affinity:
        nodeAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
            nodeSelectorTerms:
              - matchExpressions:
                  - key: node-role.kubernetes.io/control-plane
                    operator: DoesNotExist
EOF

# 3. 결과 확인
kubectl wait --for=condition=complete job/kube-bench-master --timeout=300s
kubectl wait --for=condition=complete job/kube-bench-worker --timeout=300s
```

#### 검증: kube-bench 결과 분석

```bash
# 검증 1: Master 노드 결과 요약
kubectl logs job/kube-bench-master | grep -E "PASS|FAIL|WARN" | sort | uniq -c | sort -rn
```

```text
     45 [PASS]
      8 [FAIL]
     12 [WARN]
```

```bash
# 검증 2: Worker 노드 결과 요약
kubectl logs job/kube-bench-worker | grep -E "PASS|FAIL|WARN" | sort | uniq -c | sort -rn
```

```text
     30 [PASS]
      3 [FAIL]
      7 [WARN]
```

```bash
# 검증 3: FAIL 항목 상세 확인
kubectl logs job/kube-bench-master | grep -B 1 -A 5 "\[FAIL\]"
```

```text
[FAIL] 1.2.6 Ensure that the --kubelet-certificate-authority argument is set (Automated)
[FAIL] 1.2.18 Ensure that the --audit-log-path argument is set (Automated)
...
```

```bash
# 검증 4: 특정 항목의 수정 가이드 확인
kubectl logs job/kube-bench-master | grep -A 10 "1.2.6"
```

```text
[FAIL] 1.2.6 Ensure that the --kubelet-certificate-authority argument is set (Automated)
Remediation:
Follow the Kubernetes documentation and set up the TLS connection between the apiserver
and kubelets. Then, edit the API server pod specification file
/etc/kubernetes/manifests/kube-apiserver.yaml and set the
--kubelet-certificate-authority parameter to the path to the cert file for the
certificate authority.
--kubelet-certificate-authority=<path/to/ca.crt>
```

```bash
# 5. 정리
kubectl delete job kube-bench-master kube-bench-worker
```

#### 트러블슈팅: kube-bench 실행 실패

| 증상 | 원인 | 해결 방법 |
|---|---|---|
| Job이 Pending 상태 | nodeSelector/toleration 불일치 | control-plane 라벨과 taint 확인 |
| "cannot find config" 에러 | K8s 버전과 kube-bench 버전 불일치 | kube-bench 이미지 버전 업데이트 |
| volume mount 실패 | 노드에 경로가 없음 | hostPath의 type을 DirectoryOrCreate로 변경 |

**자기 점검:**
- [ ] CIS Benchmark의 PASS/FAIL/WARN 의미를 설명할 수 있는가?
- [ ] FAIL 항목의 수정 절차를 알고 있는가?
- [ ] Automated와 Manual 항목의 차이를 설명할 수 있는가?

**관련 CKS 시험 주제:** CIS Benchmark, kube-bench

---

### 실습 1.4: 바이너리 검증 [난이도: ★★☆]

**학습 목표:** Kubernetes 바이너리의 무결성을 검증한다.

#### 등장 배경과 기존 한계점

공급망 공격(Supply Chain Attack)에서 공격자는 정상 바이너리를 변조된 바이너리로 교체한다. 변조된 kubelet은 API 서버와 정상 통신하면서 동시에 백도어를 열거나 데이터를 유출할 수 있다. 바이너리 파일의 크기나 이름만으로는 변조를 탐지할 수 없다.

SHA-512 해시는 파일의 고유한 지문이다. 파일 내용이 1비트만 변경되어도 해시값이 완전히 달라진다. 공식 릴리스의 체크섬과 로컬 바이너리의 해시를 비교하면 변조 여부를 즉시 판별할 수 있다.

#### 방어하는 공격 벡터

| 공격 시나리오 | 해시 검증의 방어 효과 |
|---|---|
| 백도어가 삽입된 kubelet | 해시 불일치로 변조를 즉시 탐지한다 |
| 다운그레이드 공격 (CVE가 있는 구버전으로 교체) | 버전별 해시 비교로 다운그레이드를 탐지한다 |
| 중간자 공격으로 다운로드 중 변조 | HTTPS + 해시 검증 이중 보호 |

```bash
# 1. kubelet 바이너리 해시 확인
ssh admin@<dev-master-ip> 'sha512sum /usr/bin/kubelet'

# 2. kubectl 바이너리 해시 확인
ssh admin@<dev-master-ip> 'sha512sum /usr/bin/kubectl'

# 3. kubeadm 바이너리 해시 확인
ssh admin@<dev-master-ip> 'sha512sum /usr/bin/kubeadm'

# 4. 버전 확인
ssh admin@<dev-master-ip> 'kubelet --version'
ssh admin@<dev-master-ip> 'kubectl version --client'
ssh admin@<dev-master-ip> 'kubeadm version'
```

#### 검증: 바이너리 무결성 확인

```bash
# 검증 1: 현재 kubelet 버전과 해시 확인
ssh admin@<dev-master-ip> 'kubelet --version'
```

```text
Kubernetes v1.29.0
```

```bash
# 검증 2: 로컬 해시 계산
ssh admin@<dev-master-ip> 'sha512sum /usr/bin/kubelet'
```

```text
a1b2c3d4e5f6...  /usr/bin/kubelet
```

```bash
# 검증 3: 공식 릴리스 해시 다운로드 및 비교
ssh admin@<dev-master-ip> 'KUBE_VERSION=$(kubelet --version | awk "{print \$2}") && \
  curl -sLO "https://dl.k8s.io/release/${KUBE_VERSION}/bin/linux/arm64/kubelet.sha512" && \
  LOCAL_HASH=$(sha512sum /usr/bin/kubelet | awk "{print \$1}") && \
  OFFICIAL_HASH=$(cat kubelet.sha512 | awk "{print \$1}") && \
  if [ "$LOCAL_HASH" = "$OFFICIAL_HASH" ]; then echo "PASS: 해시 일치"; else echo "FAIL: 해시 불일치 - 변조 의심"; fi'
```

```text
PASS: 해시 일치
```

```bash
# 검증 4: containerd 바이너리 검증
ssh admin@<dev-master-ip> 'sha256sum /usr/bin/containerd'
ssh admin@<dev-master-ip> 'containerd --version'
```

```text
x1y2z3...  /usr/bin/containerd
containerd github.com/containerd/containerd v1.7.X ...
```

**자기 점검:**
- [ ] 바이너리 검증의 보안 목적을 설명할 수 있는가?
- [ ] sha512sum으로 무결성을 확인하는 절차를 수행할 수 있는가?
- [ ] 해시 불일치 시 취해야 할 조치를 설명할 수 있는가?

**관련 CKS 시험 주제:** Verify platform binaries

---

### 실습 1.5: Ingress 보안 설정 [난이도: ★★★]

**학습 목표:** Ingress 리소스의 보안 설정을 확인하고 TLS를 적용한다.

#### 등장 배경과 기존 한계점

HTTP 평문 통신에서는 중간자 공격(MITM)으로 세션 하이재킹, 자격 증명 탈취, 데이터 변조가 가능하다. 특히 Ingress는 클러스터의 외부 진입점이므로 인터넷에 노출되며, TLS 없이 운용하면 공격 표면이 매우 넓다.

TLS(Transport Layer Security)는 전송 계층에서 데이터를 암호화하여 기밀성, 무결성, 인증을 보장한다. Ingress에 TLS를 적용하면 클라이언트와 Ingress Controller 사이의 통신이 암호화된다. Ingress Controller가 TLS를 종료(terminate)하고 백엔드 서비스로는 HTTP로 전달하는 것이 일반적이다.

#### 방어하는 공격 벡터

| 공격 시나리오 | TLS의 방어 효과 |
|---|---|
| 네트워크 스니핑 | 트래픽이 암호화되어 내용을 읽을 수 없다 |
| 세션 하이재킹 | 세션 쿠키가 암호화되어 탈취가 불가능하다 |
| MITM(중간자 공격) | 인증서 검증으로 서버 위장을 탐지한다 |
| 데이터 변조 | MAC(Message Authentication Code)으로 변조를 탐지한다 |

```bash
# 1. 현재 Ingress 확인
kubectl get ingress -A

# 2. Istio Gateway 확인 (Ingress 대안)
kubectl get gateway -n demo -o yaml

# 3. TLS가 적용된 Ingress 생성 실습
# 자체 서명 인증서 생성
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout /tmp/tls.key -out /tmp/tls.crt \
  -subj "/CN=demo.tart-infra.local"

# TLS Secret 생성
kubectl create secret tls demo-tls \
  --cert=/tmp/tls.crt --key=/tmp/tls.key -n demo

# TLS Ingress 생성
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: secure-ingress
  annotations:
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
    nginx.ingress.kubernetes.io/force-ssl-redirect: "true"
spec:
  tls:
    - hosts:
        - demo.tart-infra.local
      secretName: demo-tls
  rules:
    - host: demo.tart-infra.local
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: nginx-web
                port:
                  number: 80
EOF
```

#### 검증: TLS Ingress 동작 확인

```bash
# 검증 1: Ingress 리소스 확인
kubectl describe ingress secure-ingress -n demo
```

```text
Name:             secure-ingress
Namespace:        demo
...
TLS:
  demo-tls terminates demo.tart-infra.local
Rules:
  Host                     Path  Backends
  ----                     ----  --------
  demo.tart-infra.local    /     nginx-web:80
```

```bash
# 검증 2: TLS Secret 존재 확인
kubectl get secret demo-tls -n demo
```

```text
NAME       TYPE                DATA   AGE
demo-tls   kubernetes.io/tls   2      30s
```

```bash
# 검증 3: 인증서 내용 확인
kubectl get secret demo-tls -n demo -o jsonpath='{.data.tls\.crt}' | base64 -d | openssl x509 -noout -text | grep -E "Subject:|Not After"
```

```text
        Subject: CN = demo.tart-infra.local
            Not After : Mar 30 00:00:00 2027 GMT
```

```bash
# 정리
kubectl delete ingress secure-ingress -n demo
kubectl delete secret demo-tls -n demo
```

**자기 점검:**
- [ ] Ingress TLS 설정 방법을 알고 있는가?
- [ ] 자체 서명 인증서와 CA 서명 인증서의 차이를 설명할 수 있는가?
- [ ] TLS 종료(termination)와 TLS 패스스루(passthrough)의 차이를 설명할 수 있는가?

**관련 CKS 시험 주제:** Ingress Security, TLS

---

## 2. Cluster Hardening (15%) 실습

### 실습 2.1: RBAC 최소 권한 원칙 [난이도: ★★★]

**학습 목표:** RBAC을 분석하고 최소 권한 원칙에 맞게 Role을 설계한다.

#### 등장 배경과 기존 한계점

RBAC(Role-Based Access Control) 이전의 쿠버네티스는 ABAC(Attribute-Based Access Control)을 사용했다. ABAC은 JSON 파일에 정책을 정의하고 API 서버 재시작이 필요했다. 정책 변경이 어렵고, 세밀한 접근 제어가 불가능했다.

RBAC은 쿠버네티스 1.8에서 GA(General Availability)가 되었다. Role/ClusterRole로 권한을 정의하고, RoleBinding/ClusterRoleBinding으로 사용자/그룹/ServiceAccount에 바인딩한다. API 서버 재시작 없이 동적으로 정책을 변경할 수 있다.

#### 커널 레벨 동작 원리

RBAC은 커널이 아닌 API 서버의 인가(Authorization) 단계에서 동작한다. 클라이언트 요청이 인증(Authentication)을 통과하면, API 서버의 RBAC authorizer가 요청의 subject(사용자/SA), verb(동작), resource(리소스)를 추출하고, 모든 Role/RoleBinding과 ClusterRole/ClusterRoleBinding을 평가하여 허용/거부를 결정한다.

```
요청 → 인증(Authentication) → 인가(Authorization: RBAC 평가) → Admission Control → etcd
                                   ↓
                     Subject + Verb + Resource 추출
                                   ↓
                     RoleBinding/ClusterRoleBinding 검색
                                   ↓
                     매칭되는 Role/ClusterRole의 rules 평가
                                   ↓
                     허용(Allow) 또는 거부(Deny, 기본값)
```

RBAC의 핵심 특성:
- **Default Deny**: 명시적으로 허용되지 않은 모든 접근은 거부된다
- **Additive Only**: 거부 규칙이 없다. 허용 규칙만 추가할 수 있다
- **비계층적**: Role과 ClusterRole은 독립적이다. ClusterRole이 Role을 상속하지 않는다

#### 방어하는 공격 벡터

| 공격 시나리오 | RBAC의 방어 효과 |
|---|---|
| ServiceAccount 토큰 탈취 | SA에 최소 권한만 부여하면 피해 범위가 제한된다 |
| 권한 상승 (Privilege Escalation) | RoleBinding 생성 권한을 제한하면 자기 자신에게 권한 부여 불가 |
| Secret 유출 | Secret 접근 권한을 필요한 SA에만 부여한다 |
| cluster-admin 남용 | cluster-admin 바인딩을 최소화하여 전체 클러스터 장악을 방지한다 |

```bash
# 1. cluster-admin 바인딩 확인 (과도한 권한)
kubectl get clusterrolebinding -o json | jq '.items[] | select(.roleRef.name=="cluster-admin") | {name: .metadata.name, subjects: .subjects}'

# 2. 위험한 ClusterRole 식별
# 모든 리소스에 모든 권한
kubectl get clusterrole -o json | jq '.items[] | select(.rules[]?.resources[]? == "*" and .rules[]?.verbs[]? == "*") | .metadata.name'

# 3. 특정 ServiceAccount 권한 분석
kubectl auth can-i --list --as=system:serviceaccount:demo:default -n demo
kubectl auth can-i --list --as=system:serviceaccount:kube-system:default -n kube-system

# 4. 최소 권한 Role 생성
# 시나리오: 개발자가 demo 네임스페이스에서 Pod 조회/로그 확인만 가능
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: dev-pod-viewer
rules:
  - apiGroups: [""]
    resources: ["pods", "pods/log"]
    verbs: ["get", "list", "watch"]
  - apiGroups: [""]
    resources: ["services", "endpoints"]
    verbs: ["get", "list"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: dev-pod-viewer-binding
subjects:
  - kind: ServiceAccount
    name: dev-viewer
    namespace: demo
roleRef:
  kind: Role
  name: dev-pod-viewer
  apiGroup: rbac.authorization.k8s.io
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: dev-viewer
EOF
```

#### 검증: RBAC 권한 확인

```bash
# 검증 1: 허용된 권한 확인
kubectl auth can-i get pods --as=system:serviceaccount:demo:dev-viewer -n demo
```

```text
yes
```

```bash
# 검증 2: Pod 생성 권한 차단 확인
kubectl auth can-i create pods --as=system:serviceaccount:demo:dev-viewer -n demo
```

```text
no
```

```bash
# 검증 3: Deployment 삭제 권한 차단 확인
kubectl auth can-i delete deployments --as=system:serviceaccount:demo:dev-viewer -n demo
```

```text
no
```

```bash
# 검증 4: Secret 접근 차단 확인 (중요: Secret은 명시적으로 필요한 SA에만)
kubectl auth can-i get secrets --as=system:serviceaccount:demo:dev-viewer -n demo
```

```text
no
```

```bash
# 검증 5: 전체 권한 목록 확인
kubectl auth can-i --list --as=system:serviceaccount:demo:dev-viewer -n demo
```

```text
Resources                                       Non-Resource URLs   Resource Names   Verbs
pods                                            []                  []               [get list watch]
pods/log                                        []                  []               [get list watch]
services                                        []                  []               [get list]
endpoints                                       []                  []               [get list]
...
```

```bash
# 검증 6: 다른 네임스페이스에서는 권한 없음 확인
kubectl auth can-i get pods --as=system:serviceaccount:demo:dev-viewer -n kube-system
```

```text
no
```

```bash
# 정리
kubectl delete role dev-pod-viewer -n demo
kubectl delete rolebinding dev-pod-viewer-binding -n demo
kubectl delete sa dev-viewer -n demo
```

**자기 점검:**
- [ ] Role과 ClusterRole을 적절히 선택할 수 있는가?
- [ ] pods/log, pods/exec 등 subresource에 대한 권한을 설정할 수 있는가?
- [ ] 특정 리소스 이름에 대한 접근만 허용하는 Rule을 작성할 수 있는가?
- [ ] RoleBinding 생성 권한이 왜 위험한지 설명할 수 있는가?

**관련 CKS 시험 주제:** RBAC, Least Privilege

---

### 실습 2.2: ServiceAccount 보안 강화 [난이도: ★★★]

**학습 목표:** ServiceAccount의 보안을 강화하고 토큰 관리를 이해한다.

#### 등장 배경과 기존 한계점

쿠버네티스 1.24 이전에는 ServiceAccount가 생성되면 자동으로 비만료(non-expiring) 토큰이 Secret으로 생성되었다. 이 토큰은 만료되지 않으므로 유출 시 영구적으로 악용 가능했다. 또한 모든 Pod에 기본적으로 default ServiceAccount의 토큰이 마운트되어, 토큰이 필요하지 않은 워크로드에도 API 서버 접근 수단이 제공되었다.

쿠버네티스 1.22에서 BoundServiceAccountToken이 도입되었다. 이 토큰은 시간 제한이 있고(기본 1시간), 특정 audience에 바인딩되며, Pod가 삭제되면 무효화된다. 1.24부터는 SA 생성 시 자동 Secret 생성이 중단되었다.

#### 커널 레벨 동작 원리

SA 토큰은 JWT(JSON Web Token) 형식이다. Pod 내부의 `/var/run/secrets/kubernetes.io/serviceaccount/token` 파일에 마운트된다. 이 토큰을 HTTP Authorization 헤더에 포함하면 API 서버에 인증할 수 있다.

토큰 마운트는 kubelet이 수행한다. kubelet은 Pod 생성 시 TokenRequest API를 통해 시간 제한이 있는 토큰을 발급받고, Pod의 컨테이너에 projected volume으로 마운트한다.

```
Pod 생성 → kubelet → TokenRequest API → API 서버 → JWT 발급
    → projected volume으로 Pod에 마운트 (/var/run/secrets/kubernetes.io/serviceaccount/token)
    → Pod 내 애플리케이션이 토큰으로 API 서버에 인증
```

#### 방어하는 공격 벡터

| 공격 시나리오 | SA 보안 강화의 방어 효과 |
|---|---|
| 토큰 탈취 후 API 서버 접근 | automountServiceAccountToken: false로 토큰 자체를 제거한다 |
| 비만료 토큰 악용 | BoundServiceAccountToken은 시간 제한이 있어 유출 후 자동 만료된다 |
| default SA를 통한 권한 접근 | default SA에 automount를 비활성화하여 기본 접근 수단을 제거한다 |
| 토큰으로 Secret 읽기 | SA에 Secret 접근 권한을 부여하지 않으면 토큰이 있어도 읽기 불가 |

```bash
# 1. demo 네임스페이스 SA 목록
kubectl get sa -n demo

# 2. Pod별 SA 매핑
kubectl get pods -n demo -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.serviceAccountName}{"\n"}{end}'

# 3. automountServiceAccountToken 확인
kubectl get pods -n demo -o jsonpath='{range .items[*]}{.metadata.name}: automount={.spec.automountServiceAccountToken}{"\n"}{end}'

# 4. 토큰 마운트 여부 확인 (컨테이너 내부)
NGINX_POD=$(kubectl get pods -n demo -l app=nginx-web -o jsonpath='{.items[0].metadata.name}')
kubectl exec $NGINX_POD -n demo -- ls /var/run/secrets/kubernetes.io/serviceaccount/ 2>/dev/null
# 토큰이 마운트되어 있으면 → 불필요한 경우 비활성화 필요
```

#### 검증: 토큰 기반 API 접근 테스트

```bash
# 검증 1: 토큰이 마운트된 Pod에서 API 서버 접근 시도
kubectl exec $NGINX_POD -n demo -- sh -c '
TOKEN=$(cat /var/run/secrets/kubernetes.io/serviceaccount/token 2>/dev/null)
if [ -n "$TOKEN" ]; then
  curl -sk -H "Authorization: Bearer $TOKEN" \
    https://kubernetes.default.svc/api/v1/namespaces/demo/secrets
else
  echo "No token mounted"
fi
' 2>/dev/null
```

```text
{
  "kind": "Status",
  "apiVersion": "v1",
  "metadata": {},
  "status": "Failure",
  "message": "secrets is forbidden: User \"system:serviceaccount:demo:default\" cannot list resource \"secrets\" ...",
  "reason": "Forbidden",
  "code": 403
}
```

```bash
# 검증 2: 보안 강화된 Pod 배포
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: v1
kind: ServiceAccount
metadata:
  name: hardened-sa
automountServiceAccountToken: false
---
apiVersion: v1
kind: Pod
metadata:
  name: hardened-pod
spec:
  serviceAccountName: hardened-sa
  automountServiceAccountToken: false
  containers:
    - name: app
      image: busybox:1.36
      command: ["sh", "-c", "sleep 3600"]
      securityContext:
        runAsNonRoot: true
        runAsUser: 65534
        readOnlyRootFilesystem: true
        allowPrivilegeEscalation: false
        capabilities:
          drop: ["ALL"]
EOF

# 검증 3: 토큰 마운트 확인 — 마운트되지 않아야 한다
kubectl exec hardened-pod -n demo -- ls /var/run/secrets/ 2>/dev/null
```

```text
ls: /var/run/secrets/: No such file or directory
```

```bash
# 검증 4: SA 설정 확인
kubectl get sa hardened-sa -n demo -o jsonpath='{.automountServiceAccountToken}'
```

```text
false
```

```bash
# 정리
kubectl delete pod hardened-pod -n demo
kubectl delete sa hardened-sa -n demo
```

**자기 점검:**
- [ ] ServiceAccount 토큰 자동 마운트를 비활성화할 수 있는가?
- [ ] Bound Service Account Token의 개념을 설명할 수 있는가?
- [ ] SA 수준과 Pod 수준의 automountServiceAccountToken 우선순위를 설명할 수 있는가?

**관련 CKS 시험 주제:** ServiceAccount Security

---

### 실습 2.3: API Server 보안 설정 감사 [난이도: ★★★]

**학습 목표:** kube-apiserver의 보안 설정을 감사하고 강화 방법을 이해한다.

#### 등장 배경과 기존 한계점

API 서버는 쿠버네티스의 중앙 관문이다. 모든 클러스터 작업이 API 서버를 통과한다. API 서버의 보안 설정이 미흡하면 클러스터 전체가 위험에 노출된다. 기본 설치에서는 anonymous 접근이 활성화되어 있고, audit 로그가 없으며, 특정 admission controller가 비활성화되어 있는 경우가 많다.

```bash
# 1. API Server 매니페스트 전체 확인
ssh admin@<dev-master-ip> 'sudo cat /etc/kubernetes/manifests/kube-apiserver.yaml'

# 2. 보안 관련 플래그 추출
ssh admin@<dev-master-ip> 'sudo cat /etc/kubernetes/manifests/kube-apiserver.yaml' | grep -E -- \
  '--authorization-mode|--anonymous-auth|--enable-admission|--insecure-port|--profiling|--audit|--encryption|--kubelet-certificate|--tls-cipher'
```

#### 검증: API 서버 보안 플래그 확인

```bash
# 검증 1: authorization-mode 확인
ssh admin@<dev-master-ip> 'sudo cat /etc/kubernetes/manifests/kube-apiserver.yaml' | grep authorization-mode
```

```text
    - --authorization-mode=Node,RBAC
```

```bash
# 검증 2: anonymous-auth 확인
ssh admin@<dev-master-ip> 'sudo cat /etc/kubernetes/manifests/kube-apiserver.yaml' | grep anonymous-auth
```

```text
    - --anonymous-auth=false
```

```bash
# 검증 3: Admission Plugin 확인
ssh admin@<dev-master-ip> 'sudo cat /etc/kubernetes/manifests/kube-apiserver.yaml' | grep enable-admission
```

```text
    - --enable-admission-plugins=NodeRestriction
```

```bash
# 검증 4: 인증서 만료 확인
ssh admin@<dev-master-ip> 'sudo kubeadm certs check-expiration'
```

```text
CERTIFICATE                EXPIRES                  RESIDUAL TIME
admin.conf                 Jan 15, 2026 10:00 UTC   XXXd
apiserver                  Jan 15, 2026 10:00 UTC   XXXd
...
```

```bash
# 검증 5: deprecated API 사용 확인
kubectl get --raw /metrics | grep apiserver_requested_deprecated_apis 2>/dev/null | head -5
```

```text
# 출력이 없으면 deprecated API가 사용되지 않고 있다
```

**보안 플래그 체크리스트:**

| 플래그 | 권장 값 | 보안 효과 |
|---|---|---|
| `--authorization-mode` | Node,RBAC | Node와 RBAC 기반 인가 |
| `--anonymous-auth` | false | 미인증 접근 차단 |
| `--enable-admission-plugins` | NodeRestriction,PodSecurity | 위험한 요청 차단 |
| `--profiling` | false | 프로파일링 엔드포인트 비활성화 |
| `--audit-log-path` | 설정 필요 | API 요청 감사 로그 |
| `--encryption-provider-config` | 설정 필요 | etcd Secret 암호화 |
| `--kubelet-certificate-authority` | 설정 필요 | kubelet 인증서 검증 |

**자기 점검:**
- [ ] API Server의 핵심 보안 플래그 5개를 나열할 수 있는가?
- [ ] 각 Admission Controller의 역할을 설명할 수 있는가?
- [ ] NodeRestriction Admission Controller가 방어하는 공격을 설명할 수 있는가?

**관련 CKS 시험 주제:** API Server Configuration, Admission Controllers

---

### 실습 2.4: Kubernetes 업그레이드 보안 [난이도: ★★☆]

**학습 목표:** K8s 버전을 확인하고 보안 패치의 중요성을 이해한다.

#### 등장 배경과 기존 한계점

쿠버네티스에서는 정기적으로 보안 취약점(CVE)이 발견된다. 2022년의 CVE-2022-0185(커널 heap overflow)와 CVE-2022-0847(Dirty Pipe)은 컨테이너 탈출에 악용될 수 있었다. 2024년의 CVE-2024-21626(runc container breakout)은 runc의 취약점을 이용한 컨테이너 탈출이었다. 이러한 취약점은 보안 패치 업그레이드로만 해결할 수 있다.

쿠버네티스는 마이너 버전(예: 1.28 → 1.29)을 4개월 주기로 릴리스하며, 패치 버전(예: 1.29.0 → 1.29.1)은 보안 수정과 버그 수정을 포함한다. 3개의 최신 마이너 버전만 보안 패치를 받는다.

```bash
# 1. 현재 버전 확인
kubectl version
kubectl get nodes -o jsonpath='{range .items[*]}{.metadata.name}: {.status.nodeInfo.kubeletVersion}{"\n"}{end}'
```

#### 검증: 버전 및 업그레이드 상태 확인

```bash
# 검증 1: 클라이언트와 서버 버전 확인
kubectl version
```

```text
Client Version: v1.29.0
Server Version: v1.29.0
```

```bash
# 검증 2: 노드별 kubelet 버전 확인
kubectl get nodes -o jsonpath='{range .items[*]}{.metadata.name}: {.status.nodeInfo.kubeletVersion}{"\n"}{end}'
```

```text
dev-master: v1.29.0
dev-worker-1: v1.29.0
```

```bash
# 검증 3: 사용 가능한 업그레이드 확인
ssh admin@<dev-master-ip> 'sudo kubeadm upgrade plan 2>/dev/null'
```

```text
Components that must be upgraded manually after you have upgraded the control plane:
COMPONENT   CURRENT       TARGET
kubelet     v1.29.0       v1.29.X

Upgrade to the latest stable version:
COMPONENT                 CURRENT   TARGET
kube-apiserver            v1.29.0   v1.29.X
kube-controller-manager   v1.29.0   v1.29.X
kube-scheduler            v1.29.0   v1.29.X
...
```

```bash
# 검증 4: API 버전 확인 (deprecated API 사용 여부)
kubectl api-versions | sort
```

```text
admissionregistration.k8s.io/v1
apiextensions.k8s.io/v1
apps/v1
...
```

**자기 점검:**
- [ ] K8s 버전 업그레이드 절차(drain → upgrade → uncordon)를 설명할 수 있는가?
- [ ] 보안 패치 적용의 중요성을 설명할 수 있는가?
- [ ] 현재 버전에 알려진 CVE를 확인하는 방법을 알고 있는가?

**관련 CKS 시험 주제:** Kubernetes Version Security

---

### 실습 2.5: etcd 암호화 [난이도: ★★★]

**학습 목표:** etcd에 저장되는 Secret의 암호화 상태를 확인하고 설정 방법을 이해한다.

#### 등장 배경과 기존 한계점

etcd에 저장되는 쿠버네티스 Secret은 기본적으로 Base64 인코딩만 되어 있다. Base64는 암호화가 아니라 인코딩이다. `echo "bXlwYXNzd29yZA==" | base64 -d`만 실행하면 원문을 즉시 얻을 수 있다. etcd에 직접 접근할 수 있는 공격자(etcd 백업 파일 탈취, etcd 노드 침해)는 모든 Secret(데이터베이스 비밀번호, API 키, TLS 인증서 등)을 평문으로 읽을 수 있다.

EncryptionConfiguration은 API 서버가 etcd에 데이터를 쓰기 전에 암호화하고, 읽을 때 복호화하는 메커니즘이다. aescbc, aesgcm, secretbox 등의 암호화 알고리즘을 지원한다.

#### 암호화 동작 원리

```
kubectl create secret → API 서버 수신
    → EncryptionConfiguration의 첫 번째 provider로 암호화
    → 암호화된 데이터를 etcd에 저장 (접두사: k8s:enc:<provider>:v1:<key-name>:)
    → kubectl get secret → API 서버가 etcd에서 읽고 복호화 후 반환
```

provider 순서가 중요하다:
- **첫 번째** provider: 새 데이터 쓰기(암호화)에 사용된다
- **나머지** provider: 기존 데이터 읽기(복호화)에 사용된다
- `identity: {}`를 마지막에 두면 암호화 적용 전에 저장된 평문 Secret도 읽을 수 있다

```bash
# 1. 현재 암호화 설정 확인
ssh admin@<dev-master-ip> 'sudo cat /etc/kubernetes/manifests/kube-apiserver.yaml' | grep encryption-provider-config

# 2. etcd에서 Secret 직접 읽기
ssh admin@<dev-master-ip> 'sudo ETCDCTL_API=3 etcdctl \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key \
  get /registry/secrets/demo/ --prefix --keys-only' | head -10

# 3. Secret 값 읽기 (암호화 여부 확인)
ssh admin@<dev-master-ip> 'sudo ETCDCTL_API=3 etcdctl \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key \
  get /registry/secrets/demo/ --prefix --limit=1' | strings
# 평문이 보이면 → 암호화 미설정
```

#### 검증: etcd 암호화 상태 확인

```bash
# 검증 1: etcd에서 Secret의 raw 데이터 확인
ssh admin@<dev-master-ip> 'sudo ETCDCTL_API=3 etcdctl \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key \
  get /registry/secrets/demo/ --prefix --limit=1' | strings | head -5
```

암호화 미설정 시:
```text
k8s

v1
Secret
demo123
```

암호화 설정 시:
```text
k8s:enc:aescbc:v1:key1:
(바이너리 데이터)
```

```bash
# 검증 2: API 서버에 encryption-provider-config 플래그 확인
ssh admin@<dev-master-ip> 'ps aux | grep kube-apiserver | grep encryption-provider-config'
```

```text
# 출력이 없으면 암호화가 활성화되지 않은 것이다
# 출력이 있으면: --encryption-provider-config=/etc/kubernetes/enc/encryption-config.yaml
```

```bash
# 4. EncryptionConfiguration 작성 (참고)
cat <<'EOF'
# /etc/kubernetes/enc/encryption-config.yaml
apiVersion: apiserver.config.k8s.io/v1
kind: EncryptionConfiguration
resources:
  - resources:
      - secrets
    providers:
      - aescbc:
          keys:
            - name: key1
              secret: $(head -c 32 /dev/urandom | base64)
      - identity: {}
EOF

# 5. API Server에 설정 추가 (참고)
# kube-apiserver.yaml에 추가:
# --encryption-provider-config=/etc/kubernetes/enc/encryption-config.yaml
# Volume/VolumeMount도 추가 필요

# 6. 기존 Secret 재암호화 (참고)
# kubectl get secrets -A -o json | kubectl replace -f -
```

#### 트러블슈팅: etcd 암호화 관련 문제

| 증상 | 원인 | 해결 방법 |
|---|---|---|
| API 서버 시작 실패 | 잘못된 EncryptionConfiguration 형식 | YAML 문법 검증, apiVersion 확인 |
| Secret 읽기 실패 | 이전 암호화 키가 config에 없음 | identity provider를 fallback으로 추가 |
| 재암호화 후 일부 Secret 실패 | immutable Secret | immutable Secret은 replace 불가, recreate 필요 |

**자기 점검:**
- [ ] EncryptionConfiguration의 providers 순서가 중요한 이유를 설명할 수 있는가?
- [ ] aescbc, aesgcm, secretbox의 차이를 설명할 수 있는가?
- [ ] identity provider의 역할을 설명할 수 있는가?

**관련 CKS 시험 주제:** Encryption at Rest, etcd Security

---

## 3. System Hardening (15%) 실습

### 실습 3.1: AppArmor 프로파일 적용 [난이도: ★★★]

**학습 목표:** AppArmor 프로파일을 생성하고 Pod에 적용한다.

#### 등장 배경과 기존 한계점

컨테이너의 기본 격리는 Linux namespace와 cgroup으로 이루어진다. 그러나 이 격리만으로는 컨테이너 내부에서의 파일 접근, 네트워크 접근, capability 사용을 세밀하게 제어할 수 없다. `readOnlyRootFilesystem`은 전체 루트 파일시스템을 읽기 전용으로 만들지만, "특정 경로에만 쓰기를 허용하고 나머지는 차단"하는 세밀한 제어는 불가능하다.

AppArmor는 Linux 커널의 LSM(Linux Security Modules) 프레임워크를 사용하는 MAC(Mandatory Access Control) 시스템이다. 프로세스별로 파일 접근, 네트워크 접근, capability 사용 등을 세밀하게 제어한다. 커널이 프로세스의 syscall을 가로채서 AppArmor 프로파일과 대조하고, 위반 시 거부한다.

#### 커널 레벨 동작 원리

AppArmor는 LSM 프레임워크의 보안 훅(security hooks)에 등록된다. 프로세스가 파일을 열거나, 네트워크 소켓을 생성하거나, capability를 사용할 때 커널이 AppArmor 모듈을 호출한다. AppArmor 모듈은 프로세스에 할당된 프로파일을 확인하고, 요청된 작업이 프로파일에 허용되어 있는지 검사한다.

```
프로세스 → syscall(open, connect, ...) → 커널
    → LSM 보안 훅 호출 → AppArmor 모듈
    → 프로파일 조회 → 규칙 매칭
    → 허용(ALLOW) 또는 거부(DENY) + dmesg 로그 기록
```

두 가지 모드:
- **enforce**: 위반 시 작업을 차단하고 로그를 기록한다
- **complain**: 위반을 허용하되 로그에 기록한다 (정책 개발용)

#### 방어하는 공격 벡터

| 공격 시나리오 | AppArmor의 방어 효과 |
|---|---|
| /etc/shadow 읽기를 통한 비밀번호 해시 탈취 | deny /etc/shadow r 규칙으로 읽기 차단 |
| /usr/bin에 악성 바이너리 설치 | deny /usr/** w 규칙으로 쓰기 차단 |
| 설정 파일 변조 (/etc/nginx/nginx.conf) | deny /etc/** w 규칙으로 설정 변조 차단 |
| 네트워크 도구로 정보 수집 | deny network 규칙으로 네트워크 접근 차단 |

```bash
# 1. AppArmor 상태 확인
ssh admin@<dev-worker-ip> 'sudo aa-status'

# 2. 커스텀 프로파일 생성
ssh admin@<dev-worker-ip> 'sudo tee /etc/apparmor.d/k8s-deny-write <<PROFILE
#include <tunables/global>
profile k8s-deny-write flags=(attach_disconnected) {
  #include <abstractions/base>

  file,
  deny /etc/** w,
  deny /root/** w,
  deny /proc/** w,
}
PROFILE'

# 3. 프로파일 로드
ssh admin@<dev-worker-ip> 'sudo apparmor_parser -r /etc/apparmor.d/k8s-deny-write'
```

#### 검증: AppArmor 프로파일 동작 확인

```bash
# 검증 1: 프로파일 로드 확인
ssh admin@<dev-worker-ip> 'sudo aa-status | grep k8s-deny-write'
```

```text
   k8s-deny-write (enforce)
```

```bash
# 5. AppArmor가 적용된 Pod 생성
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: v1
kind: Pod
metadata:
  name: apparmor-test
  annotations:
    container.apparmor.security.beta.kubernetes.io/app: localhost/k8s-deny-write
spec:
  nodeName: <dev-worker-hostname>
  containers:
    - name: app
      image: busybox:1.36
      command: ["sh", "-c", "sleep 3600"]
EOF

# 검증 2: Pod 상태 확인
kubectl get pod apparmor-test -n demo
```

```text
NAME            READY   STATUS    RESTARTS   AGE
apparmor-test   1/1     Running   0          10s
```

```bash
# 검증 3: 파일 읽기 (허용)
kubectl exec apparmor-test -n demo -- cat /etc/hostname
```

```text
apparmor-test
```

```bash
# 검증 4: /etc에 쓰기 (차단)
kubectl exec apparmor-test -n demo -- sh -c 'echo test > /etc/test' 2>&1
```

```text
sh: can't create /etc/test: Permission denied
```

```bash
# 검증 5: AppArmor 거부 로그 확인 (호스트에서)
ssh admin@<dev-worker-ip> 'sudo dmesg | grep apparmor | tail -5'
```

```text
[xxxxx.xxxxxx] audit: type=1400 apparmor="DENIED" operation="mknod" profile="k8s-deny-write" name="/etc/test" ...
```

```bash
# 검증 6: annotation 확인
kubectl get pod apparmor-test -n demo -o jsonpath='{.metadata.annotations}'
```

```text
{"container.apparmor.security.beta.kubernetes.io/app":"localhost/k8s-deny-write"}
```

```bash
# 7. 정리
kubectl delete pod apparmor-test -n demo
```

#### 트러블슈팅: AppArmor 관련 문제

| 증상 | 원인 | 해결 방법 |
|---|---|---|
| Pod가 Blocked 상태 | 프로파일이 노드에 로드되지 않음 | `aa-status`로 확인, `apparmor_parser -r`로 로드 |
| Pod가 다른 노드에 스케줄링됨 | nodeName 미지정 | nodeName 또는 nodeSelector로 AppArmor 프로파일이 로드된 노드 지정 |
| 프로파일이 너무 제한적 | 필요한 파일 접근이 차단됨 | complain 모드로 변경 후 필요한 규칙 추가 |

**자기 점검:**
- [ ] AppArmor 프로파일의 enforce/complain 모드 차이를 설명할 수 있는가?
- [ ] Pod에 AppArmor 프로파일을 적용하는 방법을 알고 있는가?
- [ ] AppArmor와 SELinux의 차이를 설명할 수 있는가?

**관련 CKS 시험 주제:** AppArmor, Linux Security Modules

---

### 실습 3.2: seccomp 프로파일 적용 [난이도: ★★★]

**학습 목표:** seccomp 프로파일을 이해하고 Pod에 적용한다.

#### 등장 배경과 기존 한계점

Linux 커널은 약 300개 이상의 시스템 콜(syscall)을 제공한다. 컨테이너 프로세스는 기본적으로 이 모든 syscall을 호출할 수 있다. 그러나 대부분의 컨테이너 워크로드는 50~100개의 syscall만 필요하다. 나머지 syscall 중 상당수는 컨테이너 탈출에 악용될 수 있다.

- `ptrace`: 다른 프로세스의 메모리를 읽고 쓸 수 있다
- `mount`/`umount2`: 파일시스템을 마운트하여 호스트 파일에 접근할 수 있다
- `unshare`: 새로운 namespace를 생성하여 격리를 우회할 수 있다
- `reboot`: 호스트를 재부팅시킬 수 있다
- `init_module`/`finit_module`: 커널 모듈을 로드하여 호스트 커널을 장악할 수 있다

seccomp(Secure Computing Mode)은 Linux 커널 2.6.12에서 도입되었다. BPF(Berkeley Packet Filter) 프로그램으로 프로세스가 호출할 수 있는 syscall 목록을 제한한다. 허용되지 않은 syscall 호출 시 EPERM 에러를 반환하거나 프로세스를 종료한다.

#### 커널 레벨 동작 원리

seccomp은 커널의 `prctl(PR_SET_SECCOMP)` 또는 `seccomp()` syscall로 활성화된다. 컨테이너 런타임(containerd, CRI-O)이 컨테이너 프로세스 생성 시 seccomp 프로파일을 적용한다.

```
프로세스 → syscall 호출 → 커널 syscall 진입점
    → seccomp BPF 필터 평가
    → SCMP_ACT_ALLOW: syscall 실행
    → SCMP_ACT_ERRNO: EPERM 반환
    → SCMP_ACT_KILL: SIGKILL 전송
    → SCMP_ACT_LOG: syscall 실행 + 로그 기록
```

세 가지 프로파일 유형:
- **RuntimeDefault**: 컨테이너 런타임이 제공하는 기본 프로파일. 약 60개의 위험한 syscall을 차단한다
- **Localhost**: 노드에 저장된 커스텀 프로파일
- **Unconfined**: seccomp 비활성화 (모든 syscall 허용)

```bash
# 1. RuntimeDefault seccomp 프로파일 Pod
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: v1
kind: Pod
metadata:
  name: seccomp-runtime
spec:
  securityContext:
    seccompProfile:
      type: RuntimeDefault
  containers:
    - name: app
      image: busybox:1.36
      command: ["sh", "-c", "sleep 3600"]
      securityContext:
        allowPrivilegeEscalation: false
EOF

# 2. seccomp 미적용 Pod (비교용)
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: v1
kind: Pod
metadata:
  name: seccomp-unconfined
spec:
  securityContext:
    seccompProfile:
      type: Unconfined
  containers:
    - name: app
      image: busybox:1.36
      command: ["sh", "-c", "sleep 3600"]
EOF
```

#### 검증: seccomp 프로파일 동작 확인

```bash
# 검증 1: seccomp 프로파일 확인
kubectl get pod seccomp-runtime -n demo -o jsonpath='{.spec.securityContext.seccompProfile}'
```

```text
{"type":"RuntimeDefault"}
```

```bash
# 검증 2: Unconfined 프로파일 확인
kubectl get pod seccomp-unconfined -n demo -o jsonpath='{.spec.securityContext.seccompProfile}'
```

```text
{"type":"Unconfined"}
```

```bash
# 검증 3: RuntimeDefault에서 차단되는 syscall 테스트
kubectl exec seccomp-runtime -n demo -- unshare --user 2>&1
```

```text
unshare: unshare(0x10000000): Operation not permitted
```

```bash
# 검증 4: Unconfined에서는 동일 syscall이 허용될 수 있음
kubectl exec seccomp-unconfined -n demo -- unshare --user 2>&1
```

```text
# unshare가 성공하거나, capability 부족으로 실패할 수 있다
# seccomp이 아닌 capability에 의한 차단이면 에러 메시지가 다르다
```

```bash
# 검증 5: 커스텀 seccomp 프로파일 경로 확인 (참고)
# 프로파일은 /var/lib/kubelet/seccomp/profiles/ 에 위치해야 한다
cat <<'EOF'
# /var/lib/kubelet/seccomp/profiles/deny-chmod.json
{
  "defaultAction": "SCMP_ACT_ALLOW",
  "syscalls": [
    {
      "names": ["chmod", "fchmod", "fchmodat"],
      "action": "SCMP_ACT_ERRNO"
    }
  ]
}
EOF

# Pod에 적용:
# securityContext:
#   seccompProfile:
#     type: Localhost
#     localhostProfile: profiles/deny-chmod.json

# 정리
kubectl delete pod seccomp-runtime seccomp-unconfined -n demo
```

#### 트러블슈팅: seccomp 관련 문제

| 증상 | 원인 | 해결 방법 |
|---|---|---|
| CreateContainerConfigError | Localhost 프로파일 파일이 노드에 없음 | `/var/lib/kubelet/seccomp/profiles/`에 파일 존재 확인 |
| 애플리케이션이 비정상 동작 | RuntimeDefault가 필요한 syscall을 차단 | `strace`로 필요한 syscall 확인 후 커스텀 프로파일 작성 |
| seccomp 프로파일 JSON 에러 | JSON 문법 오류 | `jq . profile.json`으로 문법 검증 |

**자기 점검:**
- [ ] RuntimeDefault, Unconfined, Localhost 프로파일의 차이를 설명할 수 있는가?
- [ ] 커스텀 seccomp 프로파일을 작성할 수 있는가?
- [ ] seccomp과 AppArmor의 차이를 설명할 수 있는가?

**관련 CKS 시험 주제:** seccomp, System Call Filtering

---

### 실습 3.3: OS 레벨 보안 점검 [난이도: ★★☆]

**학습 목표:** Worker 노드의 OS 보안 설정을 점검한다.

#### 등장 배경과 기존 한계점

쿠버네티스 노드는 결국 Linux 운영체제 위에서 동작한다. 노드 OS의 보안이 미흡하면 컨테이너 격리가 무의미해진다. 불필요한 서비스(telnet, rpcbind), 불필요한 패키지(netcat, nmap), 약한 SSH 설정(비밀번호 인증 허용, root 로그인 허용)은 노드 침해의 진입점이 된다.

CIS Benchmark의 섹션 4(Worker Node)와 섹션 5(Policies)에서 OS 레벨 보안을 다루며, 최소 설치(Minimal Installation) 원칙을 따를 것을 권장한다.

```bash
# 1. 불필요한 서비스 확인
ssh admin@<dev-worker-ip> 'systemctl list-unit-files --state=enabled | grep -v "@"'

# 2. 열린 포트 확인
ssh admin@<dev-worker-ip> 'ss -tlnp'
```

#### 검증: OS 보안 점검 결과

```bash
# 검증 1: 열린 포트 확인 — 필요한 포트만 열려야 한다
ssh admin@<dev-worker-ip> 'ss -tlnp'
```

```text
State   Recv-Q   Send-Q   Local Address:Port   Peer Address:Port   Process
LISTEN  0        128      0.0.0.0:10250         0.0.0.0:*           users:(("kubelet",pid=xxxx))
LISTEN  0        128      0.0.0.0:22            0.0.0.0:*           users:(("sshd",pid=xxxx))
```

필요한 포트: 10250 (kubelet), 30000-32767 (NodePort range), 22 (SSH)
불필요한 포트: 23 (telnet), 111 (rpcbind), 3306 (mysql) 등

```bash
# 검증 2: 로그인 가능한 사용자 계정 확인
ssh admin@<dev-worker-ip> 'cat /etc/passwd | grep -v nologin | grep -v false'
```

```text
root:x:0:0:root:/root:/bin/bash
admin:x:1000:1000:admin:/home/admin:/bin/bash
```

```bash
# 검증 3: SSH 보안 설정 확인
ssh admin@<dev-worker-ip> 'cat /etc/ssh/sshd_config | grep -E "PermitRootLogin|PasswordAuthentication|X11Forwarding"'
```

```text
PermitRootLogin no
PasswordAuthentication no
X11Forwarding no
```

```bash
# 검증 4: 커널 파라미터 확인
ssh admin@<dev-worker-ip> 'sysctl net.ipv4.ip_forward'
```

```text
net.ipv4.ip_forward = 1
```

```bash
# 검증 5: 불필요한 패키지 확인
ssh admin@<dev-worker-ip> 'dpkg -l | grep -E "(netcat|ncat|socat|telnet)" | wc -l'
```

```text
0
```

**자기 점검:**
- [ ] Worker 노드에서 불필요한 서비스를 식별할 수 있는가?
- [ ] SSH 보안 설정의 best practice를 알고 있는가?
- [ ] SUID/SGID 비트가 설정된 위험한 파일을 찾는 방법을 알고 있는가?

**관련 CKS 시험 주제:** OS Security, Host Hardening

---

### 실습 3.4: 네트워크 레벨 보안 [난이도: ★★☆]

**학습 목표:** 호스트 네트워크와 Pod 네트워크의 보안을 점검한다.

#### 등장 배경과 기존 한계점

쿠버네티스 Pod는 기본적으로 고유한 네트워크 namespace에서 실행된다. Pod의 veth 인터페이스는 노드의 네트워크와 격리되어 있다. 그러나 `hostNetwork: true`, `hostPort`, `hostPID: true` 등의 설정은 이 격리를 우회한다.

`hostNetwork: true`인 Pod는 노드의 네트워크 스택을 직접 사용한다. 노드의 모든 네트워크 인터페이스에 접근 가능하고, 다른 Pod의 트래픽을 스니핑할 수 있다. `hostPID: true`인 Pod는 노드의 PID namespace를 공유하여 노드의 모든 프로세스를 볼 수 있다.

#### 방어하는 공격 벡터

| 설정 | 위험 | 공격 시나리오 |
|---|---|---|
| hostNetwork: true | 매우 높음 | 노드 네트워크 스니핑, ARP 스푸핑 |
| hostPID: true | 높음 | 노드 프로세스 목록 열거, 프로세스 메모리 접근 |
| hostPort | 중간 | 노드 포트 점유, 서비스 충돌 |
| hostIPC: true | 높음 | 노드의 IPC namespace 접근, 공유 메모리 탈취 |

```bash
# 1. hostNetwork 사용 Pod 확인
kubectl get pods -A -o jsonpath='{range .items[*]}{.metadata.namespace}/{.metadata.name}: hostNetwork={.spec.hostNetwork}{"\n"}{end}' | grep "true"
```

#### 검증: hostNetwork/hostPID 사용 Pod 식별

```bash
# 검증 1: hostNetwork=true인 Pod 목록
kubectl get pods -A -o jsonpath='{range .items[*]}{.metadata.namespace}/{.metadata.name}: hostNetwork={.spec.hostNetwork}{"\n"}{end}' | grep "true"
```

```text
kube-system/cilium-xxxxx: hostNetwork=true
kube-system/kube-proxy-xxxxx: hostNetwork=true
```

시스템 컴포넌트(cilium, kube-proxy)는 hostNetwork이 필요하다. 사용자 워크로드에 hostNetwork=true가 있으면 보안 위험이다.

```bash
# 검증 2: hostPID=true인 Pod 목록
kubectl get pods -A -o jsonpath='{range .items[*]}{.metadata.namespace}/{.metadata.name}: hostPID={.spec.hostPID}{"\n"}{end}' | grep "true"
```

```text
# 사용자 워크로드에 hostPID=true가 없어야 한다
```

```bash
# 검증 3: Pod 네트워크 격리 확인
NGINX_POD=$(kubectl get pods -n demo -l app=nginx-web -o jsonpath='{.items[0].metadata.name}')
kubectl exec $NGINX_POD -n demo -- ip addr
```

```text
1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536
    inet 127.0.0.1/8 scope host lo
2: eth0@if12: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500
    inet 10.0.0.X/32 scope global eth0
```

eth0에 Pod CIDR 대역의 IP가 할당되어 있다. 호스트 IP가 아닌 것을 확인한다.

```bash
# 검증 4: Cilium 상태 확인
kubectl get pods -n kube-system -l k8s-app=cilium
```

```text
NAME           READY   STATUS    RESTARTS   AGE
cilium-xxxxx   1/1     Running   0          Xd
```

**자기 점검:**
- [ ] hostNetwork, hostPort, hostPID의 보안 위험을 설명할 수 있는가?
- [ ] Pod 네트워크 격리의 원리(network namespace, veth pair)를 설명할 수 있는가?

**관련 CKS 시험 주제:** Network Security, Pod Network Isolation

---

## 4. Minimize Microservice Vulnerabilities (20%) 실습

### 실습 4.1: Pod Security Admission 실습 [난이도: ★★★]

**학습 목표:** Pod Security Standards의 3개 레벨을 테스트하고 적용한다.

#### 등장 배경과 기존 한계점

PodSecurityPolicy(PSP)는 쿠버네티스 초기부터 Pod의 보안 설정을 강제하는 메커니즘이었다. 그러나 PSP는 다음 한계점이 있었다:
1. **복잡한 RBAC 모델**: PSP는 RBAC과 별도의 인가 시스템이어서 관리가 복잡했다
2. **예측 불가능한 동작**: 여러 PSP가 존재할 때 어떤 PSP가 적용되는지 예측하기 어려웠다
3. **Fail Open**: PSP가 잘못 구성되면 모든 Pod가 통과할 수 있었다

PSP는 쿠버네티스 1.25에서 제거되었다. 대체로 PodSecurity Admission이 1.25에서 GA되었다.

PodSecurity Admission은 빌트인 Admission Controller이다. 네임스페이스 라벨로 3개의 보안 레벨(privileged, baseline, restricted)을 적용한다. PSP보다 단순하고 예측 가능한 동작을 제공한다.

#### 3개 보안 레벨 비교

| 레벨 | 허용 범위 | 차단 대상 |
|---|---|---|
| **privileged** | 제한 없음 | 없음 |
| **baseline** | 기본 보안 | privileged, hostNetwork, hostPID, hostIPC, hostPath(일부) |
| **restricted** | 최대 보안 | baseline + runAsNonRoot 필수, capabilities drop ALL 필수, seccomp 필수 |

3개 모드:
- **enforce**: 위반 시 Pod 생성을 거부한다
- **warn**: 위반 시 경고 메시지를 반환하지만 Pod는 생성된다
- **audit**: 위반을 audit 로그에 기록한다

```bash
# 1. privileged 레벨 네임스페이스
kubectl create ns psa-privileged
kubectl label ns psa-privileged pod-security.kubernetes.io/enforce=privileged

# privileged Pod (허용)
cat <<'EOF' | kubectl apply -n psa-privileged -f -
apiVersion: v1
kind: Pod
metadata:
  name: priv-pod
spec:
  containers:
    - name: app
      image: busybox:1.36
      command: ["sleep", "3600"]
      securityContext:
        privileged: true
EOF
```

#### 검증: PSA 레벨별 동작 확인

```bash
# 검증 1: privileged 레벨 — privileged Pod 생성 성공
kubectl get pod priv-pod -n psa-privileged
```

```text
NAME       READY   STATUS    RESTARTS   AGE
priv-pod   1/1     Running   0          10s
```

```bash
# 2. baseline 레벨 네임스페이스
kubectl create ns psa-baseline
kubectl label ns psa-baseline \
  pod-security.kubernetes.io/enforce=baseline \
  pod-security.kubernetes.io/warn=baseline

# 검증 2: baseline에서 privileged Pod 시도 (거부)
cat <<'EOF' | kubectl apply -n psa-baseline -f - 2>&1
apiVersion: v1
kind: Pod
metadata:
  name: priv-pod
spec:
  containers:
    - name: app
      image: busybox:1.36
      command: ["sleep", "3600"]
      securityContext:
        privileged: true
EOF
```

```text
Error from server (Forbidden): error when creating "STDIN": pods "priv-pod" is forbidden: violates PodSecurity "baseline:latest": privileged (container "app" must not set securityContext.privileged=true)
```

```bash
# 검증 3: baseline에서 hostNetwork Pod 시도 (거부)
cat <<'EOF' | kubectl apply -n psa-baseline -f - 2>&1
apiVersion: v1
kind: Pod
metadata:
  name: hostnet-pod
spec:
  hostNetwork: true
  containers:
    - name: app
      image: busybox:1.36
      command: ["sleep", "3600"]
EOF
```

```text
Error from server (Forbidden): ... violates PodSecurity "baseline:latest": host namespaces (hostNetwork=true)
```

```bash
# 검증 4: baseline 준수 Pod (허용)
kubectl run baseline-ok --image=busybox:1.36 -n psa-baseline -- sleep 3600
```

```text
pod/baseline-ok created
```

```bash
# 3. restricted 레벨 네임스페이스
kubectl create ns psa-restricted
kubectl label ns psa-restricted \
  pod-security.kubernetes.io/enforce=restricted \
  pod-security.kubernetes.io/warn=restricted

# 검증 5: restricted에서 일반 Pod 시도 (거부)
kubectl run test --image=nginx -n psa-restricted 2>&1
```

```text
Error from server (Forbidden): ... violates PodSecurity "restricted:latest": allowPrivilegeEscalation != false ... runAsNonRoot != true ... seccompProfile ...
```

```bash
# 검증 6: restricted 준수 Pod (허용)
cat <<'EOF' | kubectl apply -n psa-restricted -f -
apiVersion: v1
kind: Pod
metadata:
  name: restricted-ok
spec:
  securityContext:
    runAsNonRoot: true
    runAsUser: 65534
    seccompProfile:
      type: RuntimeDefault
  containers:
    - name: app
      image: busybox:1.36
      command: ["sleep", "3600"]
      securityContext:
        allowPrivilegeEscalation: false
        capabilities:
          drop: ["ALL"]
        readOnlyRootFilesystem: true
EOF
```

```text
pod/restricted-ok created
```

```bash
# 검증 7: 네임스페이스 라벨 확인
kubectl get ns psa-restricted --show-labels | grep pod-security
```

```text
psa-restricted   Active   ...   pod-security.kubernetes.io/enforce=restricted,...
```

```bash
# 정리
kubectl delete ns psa-privileged psa-baseline psa-restricted
```

**자기 점검:**
- [ ] 3개 레벨의 위반 조건을 5개 이상 나열할 수 있는가?
- [ ] enforce, warn, audit 모드의 차이를 설명할 수 있는가?
- [ ] PodSecurityPolicy와 PodSecurity Admission의 차이를 설명할 수 있는가?

**관련 CKS 시험 주제:** Pod Security Standards, Pod Security Admission

---

### 실습 4.2: SecurityContext 심층 실습 [난이도: ★★★]

**학습 목표:** SecurityContext의 모든 옵션을 이해하고 적용한다.

#### 등장 배경과 기존 한계점

컨테이너는 기본적으로 root(UID 0)로 실행될 수 있다. root 사용자는 컨테이너 격리를 우회하거나 호스트를 공격하는 데 필요한 모든 권한을 가진다. SecurityContext는 Pod과 컨테이너의 보안 설정을 선언적으로 정의하는 메커니즘이다.

SecurityContext의 각 필드가 커널에서 어떻게 동작하는지 이해하는 것이 중요하다:

| 필드 | 커널 메커니즘 | 동작 |
|---|---|---|
| runAsUser | setuid() syscall | 프로세스의 UID를 지정된 값으로 설정한다 |
| runAsGroup | setgid() syscall | 프로세스의 GID를 지정된 값으로 설정한다 |
| fsGroup | chown() on volume files | 볼륨 파일의 그룹 소유권을 변경한다 |
| readOnlyRootFilesystem | mount -o ro | 루트 파일시스템을 읽기 전용으로 마운트한다 |
| allowPrivilegeEscalation | prctl(PR_SET_NO_NEW_PRIVS) | setuid 비트를 통한 권한 상승을 차단한다 |
| capabilities | capset() syscall | 프로세스의 capability 집합을 조정한다 |
| seccompProfile | seccomp() syscall | syscall 필터를 적용한다 |

```bash
# 1. demo 앱의 SecurityContext 분석
kubectl get pods -n demo -o jsonpath='{range .items[*]}Pod: {.metadata.name}
  runAsNonRoot: {.spec.containers[0].securityContext.runAsNonRoot}
  runAsUser: {.spec.containers[0].securityContext.runAsUser}
  readOnlyFS: {.spec.containers[0].securityContext.readOnlyRootFilesystem}
  allowPrivEsc: {.spec.containers[0].securityContext.allowPrivilegeEscalation}
  capabilities: {.spec.containers[0].securityContext.capabilities}
{end}'

# 2. 보안 강화 Pod — 모든 SecurityContext 옵션 적용
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: v1
kind: Pod
metadata:
  name: max-security
spec:
  securityContext:
    runAsNonRoot: true
    runAsUser: 65534
    runAsGroup: 65534
    fsGroup: 65534
    seccompProfile:
      type: RuntimeDefault
    supplementalGroups: [65534]
  containers:
    - name: app
      image: busybox:1.36
      command: ["sh", "-c", "sleep 3600"]
      securityContext:
        allowPrivilegeEscalation: false
        readOnlyRootFilesystem: true
        capabilities:
          drop: ["ALL"]
      resources:
        requests:
          cpu: 50m
          memory: 64Mi
        limits:
          cpu: 100m
          memory: 128Mi
      volumeMounts:
        - name: tmp
          mountPath: /tmp
        - name: cache
          mountPath: /var/cache
  volumes:
    - name: tmp
      emptyDir:
        sizeLimit: 10Mi
    - name: cache
      emptyDir:
        sizeLimit: 50Mi
EOF
```

#### 검증: SecurityContext 동작 확인

```bash
# 검증 1: 사용자 확인
kubectl exec max-security -n demo -- id
```

```text
uid=65534(nobody) gid=65534(nogroup) groups=65534(nogroup)
```

```bash
# 검증 2: 파일시스템 읽기 전용 확인
kubectl exec max-security -n demo -- sh -c 'echo test > /etc/test' 2>&1
```

```text
sh: can't create /etc/test: Read-only file system
```

```bash
# 검증 3: /tmp 쓰기 (emptyDir이므로 가능)
kubectl exec max-security -n demo -- sh -c 'echo test > /tmp/test && cat /tmp/test'
```

```text
test
```

```bash
# 검증 4: capabilities 확인 — 모든 capability가 제거되어야 한다
kubectl exec max-security -n demo -- cat /proc/1/status | grep -i cap
```

```text
CapInh:	0000000000000000
CapPrm:	0000000000000000
CapEff:	0000000000000000
CapBnd:	0000000000000000
CapAmb:	0000000000000000
```

```bash
# 검증 5: seccomp 프로파일 확인
kubectl get pod max-security -n demo -o jsonpath='{.spec.securityContext.seccompProfile}'
```

```text
{"type":"RuntimeDefault"}
```

```bash
# 정리
kubectl delete pod max-security -n demo
```

**capabilities 위험도 분류:**

| capability | 위험도 | 설명 |
|-----------|--------|------|
| SYS_ADMIN | 최고 | 거의 root 수준 — mount, unshare 등 |
| NET_ADMIN | 고 | 네트워크 설정 변경 — iptables, 라우팅 |
| SYS_PTRACE | 고 | 다른 프로세스 추적 — 메모리 읽기/쓰기 |
| NET_RAW | 중 | raw 소켓 생성 — ARP 스푸핑 |
| SYS_TIME | 저 | 시스템 시간 변경 |
| NET_BIND_SERVICE | 저 | 1024 미만 포트 바인딩 |

**자기 점검:**
- [ ] drop: ["ALL"] + 필요한 capability만 add 패턴을 사용할 수 있는가?
- [ ] readOnlyRootFilesystem 적용 시 writable 경로 설정 방법을 알고 있는가?
- [ ] allowPrivilegeEscalation이 커널에서 어떻게 동작하는지 설명할 수 있는가?

**관련 CKS 시험 주제:** SecurityContext, Container Security

---

### 실습 4.3: mTLS 및 서비스 메시 보안 [난이도: ★★★]

**학습 목표:** Istio mTLS의 동작을 검증하고 보안 설정을 분석한다.

#### 등장 배경과 기존 한계점

쿠버네티스 내부 Pod 간 통신은 기본적으로 평문(HTTP)이다. 클러스터 네트워크에 접근할 수 있는 공격자(예: 하나의 Pod가 침해된 경우)는 다른 Pod 간의 트래픽을 스니핑할 수 있다. 또한 Pod가 다른 Pod를 사칭(spoofing)하여 서비스에 접근할 수 있다.

mTLS(mutual TLS)는 양쪽 통신 당사자가 서로의 인증서를 검증하는 방식이다. 서비스 메시(Istio, Linkerd)는 각 Pod에 사이드카 프록시를 주입하여 Pod 간 통신을 자동으로 mTLS로 암호화한다. 애플리케이션 코드 수정 없이 전송 암호화와 서비스 인증을 구현할 수 있다.

#### Istio mTLS의 커널 레벨 동작

```
Pod A의 앱 컨테이너 → localhost(HTTP 평문)
    → Envoy sidecar(Pod A) → TLS 핸드셰이크 + 인증서 교환
    → 네트워크 전송(암호화된 TLS 트래픽)
    → Envoy sidecar(Pod B) → TLS 종료 + 인증서 검증
    → localhost(HTTP 평문) → Pod B의 앱 컨테이너
```

```bash
# 1. PeerAuthentication 확인
kubectl get peerauthentication -n demo -o yaml
# mode: STRICT — 모든 통신 mTLS 필수

kubectl get peerauthentication -n istio-system -o yaml
# mesh-wide 설정

# 2. DestinationRule TLS 설정 확인
kubectl get destinationrule -n demo -o yaml | grep -A 5 "tls"

# 3. Istio 인증서 확인
NGINX_POD=$(kubectl get pods -n demo -l app=nginx-web -o jsonpath='{.items[0].metadata.name}')
kubectl exec $NGINX_POD -c istio-proxy -n demo -- \
  openssl s_client -connect httpbin.demo:8080 -showcerts </dev/null 2>/dev/null | head -30
```

#### 검증: mTLS 동작 확인

```bash
# 검증 1: PeerAuthentication STRICT 모드 확인
kubectl get peerauthentication -n demo -o jsonpath='{.items[0].spec.mtls.mode}'
```

```text
STRICT
```

```bash
# 검증 2: mTLS STRICT에서 비-mesh 클라이언트 차단 확인
kubectl create ns no-mesh-test
kubectl run curl --image=curlimages/curl --restart=Never -n no-mesh-test -- \
  sh -c 'curl -s --connect-timeout 5 http://httpbin.demo.svc:8080/get; echo "exit: $?"'
sleep 10
kubectl logs curl -n no-mesh-test
```

```text
exit: 56
```

Istio sidecar가 없는 Pod에서 STRICT mTLS 서비스에 접근하면 연결이 거부된다. exit code 56은 curl의 "Failure in receiving network data" 에러이다.

```bash
# 검증 3: Istio 보안 메트릭 확인
kubectl exec $NGINX_POD -c istio-proxy -n demo -- \
  curl -s localhost:15000/stats | grep -E "ssl|tls" | head -5
```

```text
ssl.handshake: 150
ssl.connection_error: 2
ssl.versions.TLSv1.3: 148
```

```bash
# 정리
kubectl delete ns no-mesh-test
```

**자기 점검:**
- [ ] STRICT/PERMISSIVE/DISABLE 모드의 차이를 설명할 수 있는가?
- [ ] AuthorizationPolicy로 L7 접근 제어를 구현할 수 있는가?
- [ ] mTLS와 NetworkPolicy의 역할 차이를 설명할 수 있는가?

**관련 CKS 시험 주제:** Service Mesh Security, mTLS

---

### 실습 4.4: Secret 보안 강화 [난이도: ★★☆]

**학습 목표:** Secret의 보안 취약점을 분석하고 강화 방법을 실습한다.

#### 등장 배경과 기존 한계점

쿠버네티스 Secret은 이름과 달리 기본적으로 "비밀"이 아니다. Base64 인코딩은 암호화가 아니며, RBAC이 적절히 설정되지 않으면 누구나 Secret을 읽을 수 있다. 또한 환경변수로 주입된 Secret은 `/proc/<pid>/environ`에서 읽을 수 있어 보안에 취약하다.

#### 방어하는 공격 벡터

| 공격 시나리오 | 방어 방법 |
|---|---|
| Base64 디코딩으로 Secret 읽기 | etcd 암호화(EncryptionConfiguration) 적용 |
| RBAC 미설정으로 모든 SA가 Secret 읽기 가능 | Secret 접근을 필요한 SA에만 제한 |
| /proc/*/environ에서 환경변수 Secret 읽기 | Volume mount 방식 사용 |
| Secret 변경으로 설정 변조 | immutable: true로 변경 방지 |

```bash
# 1. 현재 Secret 목록
kubectl get secret -n demo -o custom-columns='NAME:.metadata.name,TYPE:.type'

# 2. base64 디코딩 (Secret은 암호화가 아님!)
# postgres Secret
kubectl get secret -n demo -l app=postgres -o jsonpath='{.items[0].data.POSTGRES_PASSWORD}' | base64 -d
```

#### 검증: Secret 보안 확인

```bash
# 검증 1: postgres 비밀번호 확인 — Base64는 단순 인코딩이다
kubectl get secret -n demo -l app=postgres -o jsonpath='{.items[0].data.POSTGRES_PASSWORD}' | base64 -d
```

```text
demo123
```

```bash
# 검증 2: RBAC으로 Secret 접근 제한 확인
kubectl auth can-i get secrets --as=system:serviceaccount:demo:default -n demo
```

```text
no
```

```bash
# 검증 3: immutable Secret 생성 및 변경 시도
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: v1
kind: Secret
metadata:
  name: immutable-secret
type: Opaque
data:
  api-key: c2VjcmV0LWtleS12YWx1ZQ==
immutable: true
EOF

# 변경 시도 (실패해야 한다)
kubectl patch secret immutable-secret -n demo --type='json' -p='[{"op":"replace","path":"/data/api-key","value":"bmV3LXZhbHVl"}]' 2>&1
```

```text
The Secret "immutable-secret" is invalid: data: Forbidden: field is immutable when `immutable` is set
```

```bash
# 검증 4: 환경변수 vs Volume mount 방식 비교
# 환경변수 방식 — /proc/*/environ에서 읽을 수 있어 위험하다
kubectl get pods -n demo -o jsonpath='{range .items[*]}{.metadata.name}: env={.spec.containers[0].env[*].valueFrom.secretKeyRef.name}{"\n"}{end}' | grep -v "=$"

# Volume 방식 — 상대적으로 안전하다
kubectl get pods -n demo -o jsonpath='{range .items[*]}{.metadata.name}: volumes={.spec.volumes[*].secret.secretName}{"\n"}{end}' | grep -v "=$"
```

```bash
# 정리
kubectl delete secret immutable-secret -n demo
```

**자기 점검:**
- [ ] Secret immutable 설정의 장점을 설명할 수 있는가?
- [ ] Volume mount vs 환경변수 방식의 보안 차이를 설명할 수 있는가?
- [ ] Secret이 etcd에서 암호화되지 않는 기본 동작을 설명할 수 있는가?

**관련 CKS 시험 주제:** Secret Management, Data Protection

---

### 실습 4.5: OPA Gatekeeper 정책 엔진 [난이도: ★★★]

**학습 목표:** OPA Gatekeeper를 설치하고 보안 정책을 적용한다.

#### 등장 배경과 기존 한계점

PodSecurity Admission은 Pod의 보안 설정만 검증할 수 있다. "모든 컨테이너에 리소스 제한이 있어야 한다", "latest 태그를 사용하면 안 된다", "특정 레지스트리의 이미지만 허용한다" 같은 커스텀 정책은 구현할 수 없다.

OPA(Open Policy Agent) Gatekeeper는 Rego 정책 언어를 사용하여 임의의 정책을 정의할 수 있는 범용 정책 엔진이다. ValidatingAdmissionWebhook으로 동작하여 정책을 위반하는 요청을 거부한다.

Gatekeeper의 구조:
- **ConstraintTemplate**: 정책의 "종류"를 정의한다. Rego 코드가 포함된다
- **Constraint**: 정책의 "인스턴스"를 정의한다. 파라미터와 적용 범위를 지정한다

```bash
# 1. Gatekeeper 설치
kubectl apply -f https://raw.githubusercontent.com/open-policy-agent/gatekeeper/release-3.14/deploy/gatekeeper.yaml
kubectl wait --for=condition=ready pod -l control-plane=controller-manager -n gatekeeper-system --timeout=120s

# 2. ConstraintTemplate — latest 태그 금지
cat <<'EOF' | kubectl apply -f -
apiVersion: templates.gatekeeper.sh/v1
kind: ConstraintTemplate
metadata:
  name: k8sdisallowedtags
spec:
  crd:
    spec:
      names:
        kind: K8sDisallowedTags
      validation:
        openAPIV3Schema:
          type: object
          properties:
            tags:
              type: array
              items:
                type: string
  targets:
    - target: admission.k8s.gatekeeper.sh
      rego: |
        package k8sdisallowedtags
        violation[{"msg": msg}] {
          container := input.review.object.spec.containers[_]
          tag := split(container.image, ":")[1]
          tag == input.parameters.tags[_]
          msg := sprintf("container <%v> uses disallowed tag <%v>", [container.name, tag])
        }
        violation[{"msg": msg}] {
          container := input.review.object.spec.containers[_]
          not contains(container.image, ":")
          msg := sprintf("container <%v> has no tag (defaults to latest)", [container.name])
        }
EOF

# 3. Constraint — latest 태그 사용 금지
cat <<'EOF' | kubectl apply -f -
apiVersion: constraints.gatekeeper.sh/v1beta1
kind: K8sDisallowedTags
metadata:
  name: no-latest-tag
spec:
  match:
    kinds:
      - apiGroups: [""]
        kinds: ["Pod"]
    namespaces: ["gatekeeper-test"]
  parameters:
    tags: ["latest"]
EOF
```

#### 검증: Gatekeeper 정책 동작 확인

```bash
# 4. 테스트
kubectl create ns gatekeeper-test

# 검증 1: latest 태그 (거부)
kubectl run test --image=nginx:latest -n gatekeeper-test 2>&1
```

```text
Error from server (Forbidden): admission webhook "validation.gatekeeper.sh" denied the request: [no-latest-tag] container <test> uses disallowed tag <latest>
```

```bash
# 검증 2: 태그 없음 (거부)
kubectl run test2 --image=nginx -n gatekeeper-test 2>&1
```

```text
Error from server (Forbidden): admission webhook "validation.gatekeeper.sh" denied the request: [no-latest-tag] container <test2> has no tag (defaults to latest)
```

```bash
# 검증 3: 구체적 태그 (허용)
kubectl run test3 --image=nginx:1.25-alpine -n gatekeeper-test 2>&1
```

```text
pod/test3 created
```

```bash
# 검증 4: ConstraintTemplate과 Constraint 상태 확인
kubectl get constrainttemplates
```

```text
NAME                  AGE
k8sdisallowedtags     2m
```

```bash
kubectl get k8sdisallowedtags
```

```text
NAME             ENFORCEMENT-ACTION   TOTAL-VIOLATIONS
no-latest-tag    deny                 0
```

```bash
# 정리
kubectl delete ns gatekeeper-test
kubectl delete k8sdisallowedtags no-latest-tag
kubectl delete constrainttemplate k8sdisallowedtags
```

**자기 점검:**
- [ ] ConstraintTemplate과 Constraint의 관계를 설명할 수 있는가?
- [ ] Rego 정책 언어의 기본 구문을 이해하는가?
- [ ] Gatekeeper와 Pod Security Admission의 차이를 설명할 수 있는가?

**관련 CKS 시험 주제:** OPA Gatekeeper, Policy Engine, Admission Control

---

## 5. Supply Chain Security (20%) 실습

### 실습 5.1: Trivy 이미지 취약점 스캔 [난이도: ★★☆]

**학습 목표:** Trivy로 컨테이너 이미지의 취약점을 스캔한다.

#### 등장 배경과 기존 한계점

컨테이너 이미지에는 OS 패키지, 라이브러리, 애플리케이션 바이너리가 포함되어 있다. 이 중 상당수에 알려진 취약점(CVE)이 존재할 수 있다. 이미지 스캔 없이 배포하면 공개된 취약점이 있는 소프트웨어가 프로덕션에서 실행된다. 공격자는 CVE 데이터베이스를 검색하여 해당 취약점의 exploit을 찾고 공격할 수 있다.

Trivy는 Aqua Security가 개발한 오픈소스 취약점 스캐너이다. 컨테이너 이미지, 파일시스템, git 저장소, Dockerfile의 취약점을 스캔한다. CVE 데이터베이스와 대조하여 알려진 취약점을 식별하고 심각도(CRITICAL, HIGH, MEDIUM, LOW)를 분류한다.

```bash
# 1. Trivy 설치 확인
trivy --version 2>/dev/null || echo "Trivy not installed"
# 설치: brew install trivy (macOS) 또는 apt install trivy

# 2. demo 앱 이미지 스캔
trivy image --severity CRITICAL,HIGH nginx:alpine
```

#### 검증: 이미지 취약점 스캔 결과

```bash
# 검증 1: nginx 이미지 CRITICAL 취약점 스캔
trivy image --severity CRITICAL nginx:alpine 2>/dev/null | tail -10
```

```text
Total: 0 (CRITICAL: 0)
```

```bash
# 검증 2: postgres 이미지 스캔 — 일반적으로 더 많은 취약점이 발견된다
trivy image --severity CRITICAL postgres:16-alpine 2>/dev/null | tail -5
```

```text
Total: X (CRITICAL: X)
```

```bash
# 검증 3: JSON 출력으로 자동화
trivy image --format json --output /tmp/nginx-scan.json nginx:alpine
ls -la /tmp/nginx-scan.json
```

```text
-rw-r--r--  1 user  group  XXXXX  ... /tmp/nginx-scan.json
```

```bash
# 검증 4: exit code를 이용한 CI/CD 게이트
trivy image --severity CRITICAL --exit-code 1 nginx:alpine 2>/dev/null
echo "Exit code: $?"
```

```text
Exit code: 0
```

Exit code 0은 CRITICAL 취약점이 없다는 의미이다. CI/CD 파이프라인에서 exit code 1이 반환되면 빌드를 실패시킬 수 있다.

**자기 점검:**
- [ ] Trivy의 스캔 대상(image, filesystem, config)을 구분할 수 있는가?
- [ ] CRITICAL 취약점이 발견되었을 때 대응 절차를 설명할 수 있는가?
- [ ] CI/CD에서 이미지 스캔을 자동화하는 방법을 알고 있는가?

**관련 CKS 시험 주제:** Image Vulnerability Scanning

---

### 실습 5.2: 이미지 정책 및 보안 [난이도: ★★★]

**학습 목표:** 이미지 보안 정책을 수립하고 적용한다.

#### 등장 배경과 기존 한계점

태그 기반 이미지 참조(예: `nginx:latest`)는 보안 위험이 있다. 동일한 태그에 다른 이미지가 push될 수 있으며, 공격자가 레지스트리를 침해하면 악성 이미지를 같은 태그로 교체할 수 있다. digest(SHA256 해시) 기반 참조는 이미지의 내용이 변경되면 해시도 변경되므로 이 공격을 방어한다.

```bash
# 1. 현재 사용 중인 이미지 분석
echo "=== 이미지 목록 ==="
kubectl get pods -n demo -o jsonpath='{range .items[*]}{.spec.containers[*].image}{"\n"}{end}' | sort -u
```

#### 검증: 이미지 보안 상태 확인

```bash
# 검증 1: ImagePullPolicy 확인
kubectl get pods -n demo -o jsonpath='{range .items[*]}{.metadata.name}: {.spec.containers[0].imagePullPolicy}{"\n"}{end}'
```

```text
httpbin-xxxxx: IfNotPresent
nginx-web-xxxxx: IfNotPresent
postgres-0: IfNotPresent
redis-0: IfNotPresent
```

```bash
# 검증 2: 이미지 다이제스트 확인
kubectl get pods -n demo -o jsonpath='{range .items[*]}{.metadata.name}: imageID={.status.containerStatuses[0].imageID}{"\n"}{end}'
```

```text
nginx-web-xxxxx: imageID=docker.io/library/nginx@sha256:abc123...
```

**이미지 보안 체크리스트:**

| 항목 | 권장 | 현재 |
|------|------|------|
| 태그 대신 다이제스트 사용 | sha256:... | 태그 사용 |
| alpine 기반 이미지 | 최소 이미지 | 부분 적용 |
| root가 아닌 사용자 | USER non-root | 부분 적용 |
| AlwaysPullImages | 활성화 | 확인 필요 |
| 이미지 서명 | cosign/notary | 미적용 |
| 취약점 스캔 | CI/CD에서 자동 | 수동 |

**자기 점검:**
- [ ] ImagePolicyWebhook의 역할을 설명할 수 있는가?
- [ ] 이미지 서명 검증의 원리를 설명할 수 있는가?
- [ ] AlwaysPullImages admission controller의 보안 효과를 설명할 수 있는가?

**관련 CKS 시험 주제:** Image Policy, Supply Chain Security

---

### 실습 5.3: Dockerfile 보안 분석 [난이도: ★★☆]

**학습 목표:** Dockerfile의 보안 best practice를 이해하고 분석한다.

#### 등장 배경과 기존 한계점

Dockerfile은 컨테이너 이미지의 빌드 레시피이다. 보안이 취약한 Dockerfile은 큰 이미지(공격 표면 증가), 하드코딩된 비밀정보, root 사용자 실행 등의 문제를 야기한다.

```bash
# 1. 보안이 취약한 Dockerfile 예제
cat <<'EOF' > /tmp/Dockerfile.insecure
FROM ubuntu:latest
RUN apt-get update && apt-get install -y curl wget
COPY . /app
WORKDIR /app
ENV DB_PASSWORD=demo123
EXPOSE 8080
CMD ["./app"]
EOF

# 문제점 분석:
# - FROM ubuntu:latest → 크고 취약점 많음, 태그 고정 없음
# - latest 태그 → 빌드 재현 불가능
# - apt-get install curl wget → 공격 도구 포함
# - ENV DB_PASSWORD → 민감정보 하드코딩 (이미지 레이어에 영구 저장)
# - root 사용자로 실행 → 컨테이너 침해 시 root 권한
```

#### 검증: 보안 강화 Dockerfile

```bash
# 2. 보안 강화된 Dockerfile 예제
cat <<'EOF' > /tmp/Dockerfile.secure
FROM alpine:3.19 AS builder
WORKDIR /build
COPY . .
RUN apk add --no-cache go && go build -o /app

FROM scratch
COPY --from=builder /app /app
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
USER 65534:65534
EXPOSE 8080
ENTRYPOINT ["/app"]
EOF
```

| 보안 문제 | 취약한 Dockerfile | 강화된 Dockerfile |
|---|---|---|
| 베이스 이미지 | ubuntu:latest (100MB+) | scratch (0MB) |
| 태그 | latest (변경 가능) | alpine:3.19 (고정) |
| 불필요한 도구 | curl, wget 포함 | 빌드 도구만 builder 스테이지에 |
| 민감정보 | ENV에 하드코딩 | 없음 (런타임에 Secret으로 주입) |
| 사용자 | root (기본) | 65534 (nobody) |
| 빌드 방식 | 단일 스테이지 | 멀티스테이지 |

```bash
# 정리
rm -f /tmp/Dockerfile.insecure /tmp/Dockerfile.secure
```

**자기 점검:**
- [ ] Multi-stage build의 보안 이점을 설명할 수 있는가?
- [ ] scratch vs alpine vs distroless 이미지의 차이를 설명할 수 있는가?
- [ ] 이미지 레이어에 민감정보가 영구 저장되는 문제를 설명할 수 있는가?

**관련 CKS 시험 주제:** Dockerfile Security, Image Hardening

---

### 실습 5.4: 허용된 레지스트리 정책 [난이도: ★★★]

**학습 목표:** 특정 레지스트리의 이미지만 허용하는 정책을 구현한다.

#### 등장 배경과 기존 한계점

기본 쿠버네티스에서는 모든 컨테이너 레지스트리의 이미지를 pull할 수 있다. 공격자가 악성 이미지를 public 레지스트리에 업로드하고, 개발자가 실수로 해당 이미지를 사용하면 클러스터가 침해될 수 있다. 또한 내부 보안 스캔을 거치지 않은 이미지가 프로덕션에 배포될 위험이 있다.

레지스트리 화이트리스트 정책은 신뢰할 수 있는 레지스트리의 이미지만 허용한다. OPA Gatekeeper나 ImagePolicyWebhook으로 구현할 수 있다.

```bash
# 1. 현재 사용 중인 레지스트리 확인
kubectl get pods -n demo -o jsonpath='{range .items[*]}{.spec.containers[*].image}{"\n"}{end}' | sort -u | sed 's|/.*||' | sort -u

# 2. OPA Gatekeeper로 레지스트리 제한
cat <<'EOF' | kubectl apply -f -
apiVersion: templates.gatekeeper.sh/v1
kind: ConstraintTemplate
metadata:
  name: k8sallowedrepos
spec:
  crd:
    spec:
      names:
        kind: K8sAllowedRepos
      validation:
        openAPIV3Schema:
          type: object
          properties:
            repos:
              type: array
              items:
                type: string
  targets:
    - target: admission.k8s.gatekeeper.sh
      rego: |
        package k8sallowedrepos
        violation[{"msg": msg}] {
          container := input.review.object.spec.containers[_]
          not startswith(container.image, input.parameters.repos[_])
          msg := sprintf("container <%v> image <%v> is from a disallowed registry", [container.name, container.image])
        }
EOF

cat <<'EOF' | kubectl apply -f -
apiVersion: constraints.gatekeeper.sh/v1beta1
kind: K8sAllowedRepos
metadata:
  name: allowed-repos
spec:
  match:
    kinds:
      - apiGroups: [""]
        kinds: ["Pod"]
    namespaces: ["registry-test"]
  parameters:
    repos:
      - "docker.io/"
      - "nginx"
      - "busybox"
      - "redis"
      - "postgres"
EOF
```

#### 검증: 레지스트리 제한 동작 확인

```bash
# 3. 테스트
kubectl create ns registry-test

# 검증 1: 허용된 이미지 (성공)
kubectl run ok --image=nginx:alpine -n registry-test 2>&1
```

```text
pod/ok created
```

```bash
# 검증 2: 비허용 이미지 (거부)
kubectl run blocked --image=some-unknown-registry.io/app:v1 -n registry-test 2>&1
```

```text
Error from server (Forbidden): admission webhook "validation.gatekeeper.sh" denied the request: [allowed-repos] container <blocked> image <some-unknown-registry.io/app:v1> is from a disallowed registry
```

```bash
# 정리
kubectl delete ns registry-test
kubectl delete k8sallowedrepos allowed-repos
kubectl delete constrainttemplate k8sallowedrepos
```

**자기 점검:**
- [ ] 화이트리스트 vs 블랙리스트 레지스트리 정책의 장단점을 설명할 수 있는가?

**관련 CKS 시험 주제:** Image Registry Policy, Admission Control

---

## 6. Monitoring, Logging and Runtime Security (20%) 실습

### 실습 6.1: Audit Policy 설정 및 분석 [난이도: ★★★]

**학습 목표:** Kubernetes Audit Policy를 설정하고 감사 로그를 분석한다.

#### 등장 배경과 기존 한계점

Audit 로깅이 비활성화된 상태에서는 누가 언제 어떤 리소스에 접근했는지 추적할 수 없다. Secret이 유출되어도 유출 경로를 파악할 수 없고, 침해 사고 발생 시 타임라인을 재구성할 수 없다. 컴플라이언스(SOC 2, ISO 27001, PCI DSS 등)에서도 API 감사 로그는 필수 요구사항이다.

쿠버네티스 Audit 로깅은 API 서버에 대한 모든 요청을 기록한다. Audit Policy에서 리소스별, 사용자별, 동작별로 로깅 레벨을 세밀하게 설정할 수 있다.

#### Audit 레벨

| 레벨 | 기록 내용 | 사용 시점 |
|---|---|---|
| `None` | 로깅하지 않는다 | 노이즈가 많은 시스템 요청 |
| `Metadata` | who, what, when, outcome | 대부분의 요청 |
| `Request` | Metadata + 요청 본문 | Pod 생성/삭제 |
| `RequestResponse` | Metadata + 요청 + 응답 본문 | Secret 접근 (포렌식용) |

```bash
# 1. 현재 Audit 설정 확인
ssh admin@<dev-master-ip> 'sudo cat /etc/kubernetes/manifests/kube-apiserver.yaml' | grep -E "audit"

# 2. Audit Policy 작성 (참고)
cat <<'POLICY'
apiVersion: audit.k8s.io/v1
kind: Policy
rules:
  # Secret 접근은 반드시 로깅
  - level: Metadata
    resources:
      - group: ""
        resources: ["secrets"]
    verbs: ["get", "list", "watch", "create", "update", "delete"]

  # Pod 생성/삭제 로깅 (RequestResponse)
  - level: RequestResponse
    resources:
      - group: ""
        resources: ["pods"]
    verbs: ["create", "delete"]

  # RBAC 변경 로깅
  - level: RequestResponse
    resources:
      - group: "rbac.authorization.k8s.io"
        resources: ["roles", "rolebindings", "clusterroles", "clusterrolebindings"]

  # 나머지는 Metadata만
  - level: Metadata
    omitStages:
      - RequestReceived
POLICY
```

#### 검증: Audit 로그 분석

```bash
# 검증 1: Audit 로그 파일 존재 확인
ssh admin@<dev-master-ip> 'sudo ls -la /var/log/kubernetes/audit/audit.log 2>/dev/null'
```

설정된 경우:
```text
-rw------- 1 root root XXXXXX ... audit.log
```

```bash
# 검증 2: Audit 로그 내용 확인 (설정된 경우)
ssh admin@<dev-master-ip> 'sudo cat /var/log/kubernetes/audit/audit.log 2>/dev/null | tail -1 | jq .'
```

```text
{
  "kind": "Event",
  "apiVersion": "audit.k8s.io/v1",
  "level": "Metadata",
  "auditID": "xxx-xxx-xxx",
  "stage": "ResponseComplete",
  "requestURI": "/api/v1/namespaces/demo/pods",
  "verb": "list",
  "user": {
    "username": "kubernetes-admin",
    ...
  },
  "objectRef": {
    "resource": "pods",
    "namespace": "demo",
    ...
  },
  "responseStatus": {
    "code": 200
  },
  ...
}
```

```bash
# 검증 3: Secret 접근 기록 필터링 (설정된 경우)
ssh admin@<dev-master-ip> 'sudo cat /var/log/kubernetes/audit/audit.log 2>/dev/null | jq "select(.objectRef.resource==\"secrets\")" | head -20'
```

**자기 점검:**
- [ ] Audit Policy의 4개 레벨을 설명할 수 있는가?
- [ ] Secret 접근에 대한 Audit Policy를 작성할 수 있는가?
- [ ] omitStages의 역할을 설명할 수 있는가?

**관련 CKS 시험 주제:** Audit Logging, Security Monitoring

---

### 실습 6.2: Falco 런타임 보안 [난이도: ★★★]

**학습 목표:** Falco를 설치하고 런타임 위협을 탐지한다.

#### 등장 배경과 기존 한계점

기존 보안 도구(RBAC, NetworkPolicy, seccomp 등)는 예방적(preventive) 보안이다. 설정된 정책을 위반하는 행위를 차단한다. 그러나 허용된 범위 내에서 발생하는 악성 행위(예: 합법적으로 실행된 컨테이너에서 /etc/shadow 읽기, 패키지 관리자 실행, 리버스 셸 연결)는 감지할 수 없다.

Falco는 Sysdig에서 개발한 런타임 보안 도구이다. Linux 커널의 syscall을 실시간으로 감시하여 규칙 기반으로 의심스러운 행위를 탐지한다. eBPF 또는 커널 모듈을 통해 syscall을 캡처하므로, 컨테이너 코드 수정 없이 모든 활동을 감시할 수 있다.

#### 커널 레벨 동작 원리

```
컨테이너 프로세스 → syscall 호출 → 커널
    → eBPF tracepoint/kprobe에서 이벤트 캡처
    → Falco 엔진(사용자 공간)으로 이벤트 전달
    → Falco 규칙 엔진이 조건 평가
    → 매칭 시 알림 생성 (syslog, stdout, webhook 등)
```

```bash
# 1. Falco 설치
helm repo add falcosecurity https://falcosecurity.github.io/charts
helm repo update
helm install falco falcosecurity/falco \
  --namespace falco --create-namespace \
  --set falcosidekick.enabled=true \
  --set falcosidekick.webui.enabled=true

# 2. 설치 확인
kubectl get pods -n falco
kubectl wait --for=condition=ready pod -l app.kubernetes.io/name=falco -n falco --timeout=120s
```

#### 검증: Falco 런타임 탐지

```bash
# 검증 1: Falco Pod 상태 확인
kubectl get pods -n falco
```

```text
NAME                                      READY   STATUS    RESTARTS   AGE
falco-xxxxx                               2/2     Running   0          2m
falco-falcosidekick-xxxxx                 1/1     Running   0          2m
```

```bash
# 3. 의심스러운 활동 시뮬레이션

# 3-1. 컨테이너 내 셸 실행
NGINX_POD=$(kubectl get pods -n demo -l app=nginx-web -o jsonpath='{.items[0].metadata.name}')
kubectl exec -it $NGINX_POD -n demo -- /bin/sh -c 'whoami; exit'

# 3-2. 민감 파일 읽기
kubectl exec $NGINX_POD -n demo -- cat /etc/shadow 2>/dev/null

# 3-3. 패키지 관리자 실행
kubectl exec $NGINX_POD -n demo -- apk add --no-cache curl 2>/dev/null

# 4. Falco 로그 확인
kubectl logs -l app.kubernetes.io/name=falco -n falco --tail=30 | grep -E "Warning|Error|Critical"
```

```text
{"hostname":"falco-xxxxx","output":"Warning Terminal shell in container (user=root shell=sh ...)","priority":"Warning","rule":"Terminal shell in container","source":"syscall","time":"2024-01-15T10:30:00.000Z"}
{"hostname":"falco-xxxxx","output":"Warning Sensitive file opened for reading by non-trusted program ...","priority":"Warning","rule":"Read sensitive file","source":"syscall","time":"2024-01-15T10:30:05.000Z"}
```

**Falco 탐지 규칙 매트릭스:**

| 규칙 | 심각도 | 시뮬레이션 방법 |
|------|--------|----------------|
| Terminal shell in container | WARNING | kubectl exec -- sh |
| Read sensitive file | WARNING | cat /etc/shadow |
| Launch package management | ERROR | apk add, apt install |
| Write below /etc | WARNING | echo >> /etc/hosts |
| Outbound connection | NOTICE | wget http://... |
| Contact K8s API Server | NOTICE | curl https://kubernetes.default |

**자기 점검:**
- [ ] Falco의 동작 원리(eBPF/커널 모듈을 통한 syscall 감시)를 설명할 수 있는가?
- [ ] 커스텀 Falco 규칙을 작성할 수 있는가?
- [ ] Falco와 seccomp의 차이를 설명할 수 있는가? (탐지 vs 차단)

**관련 CKS 시험 주제:** Runtime Security, Behavioral Detection, Falco

---

### 실습 6.3: 컨테이너 불변성 (Immutability) [난이도: ★★☆]

**학습 목표:** 컨테이너 불변성을 적용하고 검증한다.

#### 등장 배경과 기존 한계점

컨테이너의 파일시스템이 쓰기 가능한 상태에서는 다음 공격이 가능하다:
1. **악성 바이너리 설치**: 공격자가 curl이나 wget으로 악성 코드를 다운로드하여 실행한다
2. **설정 파일 변조**: /etc/nginx/nginx.conf 등을 수정하여 트래픽을 가로채거나 백도어를 설치한다
3. **웹셸 배포**: /var/www/html에 웹셸을 작성하여 원격 접근 경로를 확보한다
4. **로그 삭제**: 침입 흔적을 제거하기 위해 로그 파일을 삭제하거나 수정한다

```bash
# 1. readOnlyRootFilesystem Pod 생성
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: v1
kind: Pod
metadata:
  name: immutable-test
spec:
  containers:
    - name: app
      image: nginx:alpine
      securityContext:
        readOnlyRootFilesystem: true
      volumeMounts:
        - name: tmp
          mountPath: /tmp
        - name: nginx-cache
          mountPath: /var/cache/nginx
        - name: nginx-run
          mountPath: /var/run
  volumes:
    - name: tmp
      emptyDir: {}
    - name: nginx-cache
      emptyDir: {}
    - name: nginx-run
      emptyDir: {}
EOF
```

#### 검증: 불변성 동작 확인

```bash
# 검증 1: 루트 파일시스템 쓰기 (실패)
kubectl exec immutable-test -n demo -- sh -c 'echo test > /etc/test' 2>&1
```

```text
sh: can't create /etc/test: Read-only file system
```

```bash
# 검증 2: /tmp 쓰기 (성공 — emptyDir)
kubectl exec immutable-test -n demo -- sh -c 'echo test > /tmp/test && cat /tmp/test'
```

```text
test
```

```bash
# 검증 3: nginx 설정 변경 시도 (실패 — 설정 변조 차단)
kubectl exec immutable-test -n demo -- sh -c 'echo "# modified" >> /etc/nginx/nginx.conf' 2>&1
```

```text
sh: can't create /etc/nginx/nginx.conf: Read-only file system
```

```bash
# 검증 4: 악성 바이너리 설치 시도 (실패)
kubectl exec immutable-test -n demo -- sh -c 'echo "malicious" > /bin/evil' 2>&1
```

```text
sh: can't create /bin/evil: Read-only file system
```

```bash
# 검증 5: readOnlyRootFilesystem 설정 확인
kubectl get pod immutable-test -n demo -o jsonpath='{.spec.containers[0].securityContext.readOnlyRootFilesystem}'
```

```text
true
```

```bash
# 정리
kubectl delete pod immutable-test -n demo
```

**자기 점검:**
- [ ] readOnlyRootFilesystem 적용 시 필요한 writable 경로를 식별할 수 있는가?
- [ ] emptyDir vs hostPath 마운트의 보안 차이를 설명할 수 있는가?

**관련 CKS 시험 주제:** Container Immutability

---

### 실습 6.4: Prometheus 보안 메트릭 모니터링 [난이도: ★★☆]

**학습 목표:** Prometheus로 보안 관련 메트릭을 모니터링한다.

```bash
# platform 클러스터로 전환
export KUBECONFIG=kubeconfig/platform-kubeconfig

# 1. PrometheusRule 확인
kubectl get prometheusrule -n monitoring

# 2. 보안 관련 Alert 확인
kubectl get prometheusrule -n monitoring -o yaml | grep -B 2 -A 15 "alert:"
```

#### 검증: 보안 메트릭 확인

```bash
# 검증 1: PrometheusRule 수 확인
kubectl get prometheusrule -n monitoring
```

```text
NAME              AGE
demo-alerts       Xd
...
```

```bash
# 검증 2: 보안 관련 PromQL 쿼리 (Prometheus UI에서)
# Pod 재시작 횟수 (비정상 활동 지표)
# kube_pod_container_status_restarts_total{namespace="demo"} > 3

# 인증 실패 (API Server)
# apiserver_authentication_attempts{result="failure"}

# 403 응답 (권한 거부)
# apiserver_request_total{code="403"}

# dev 클러스터로 복귀
export KUBECONFIG=kubeconfig/dev-kubeconfig
```

**자기 점검:**
- [ ] 보안 관련 Prometheus 메트릭을 5개 이상 나열할 수 있는가?
- [ ] AlertManager 규칙에서 보안 이벤트를 탐지하는 방법을 알고 있는가?

**관련 CKS 시험 주제:** Security Monitoring, Observability

---

### 실습 6.5: 시스템 콜 모니터링 [난이도: ★★★]

**학습 목표:** 컨테이너의 시스템 콜을 모니터링하고 비정상 활동을 탐지한다.

#### 등장 배경과 기존 한계점

컨테이너 런타임에서 어떤 일이 일어나는지 가시성이 없으면, 침해된 컨테이너가 악성 바이너리를 다운로드하거나, 민감한 파일을 읽거나, 비정상적인 네트워크 연결을 수립해도 감지할 수 없다. 로그 기반 모니터링은 애플리케이션이 로그를 남기는 행위만 감지하며, syscall 레벨의 악성 행위는 로그에 남지 않는다.

`/proc` 파일시스템은 커널이 제공하는 가상 파일시스템으로, 프로세스의 상태, capabilities, namespace, 네트워크 연결 등을 실시간으로 조회할 수 있다. sysdig, strace, Falco 등의 도구는 이 정보를 활용하여 컨테이너 활동을 모니터링한다.

```bash
# 1. /proc 파일시스템으로 프로세스 정보 확인
NGINX_POD=$(kubectl get pods -n demo -l app=nginx-web -o jsonpath='{.items[0].metadata.name}')

# 프로세스 목록
kubectl exec $NGINX_POD -n demo -- ps aux
```

#### 검증: 프로세스 보안 정보 확인

```bash
# 검증 1: 프로세스 capabilities
kubectl exec $NGINX_POD -n demo -- cat /proc/1/status | grep -i cap
```

```text
CapInh:	00000000a80425fb
CapPrm:	00000000a80425fb
CapEff:	00000000a80425fb
CapBnd:	00000000a80425fb
CapAmb:	0000000000000000
```

```bash
# 검증 2: 프로세스 네임스페이스
kubectl exec $NGINX_POD -n demo -- ls -la /proc/1/ns/
```

```text
lrwxrwxrwx 1 root root 0 ... cgroup -> 'cgroup:[4026532xxx]'
lrwxrwxrwx 1 root root 0 ... ipc -> 'ipc:[4026532xxx]'
lrwxrwxrwx 1 root root 0 ... mnt -> 'mnt:[4026532xxx]'
lrwxrwxrwx 1 root root 0 ... net -> 'net:[4026532xxx]'
lrwxrwxrwx 1 root root 0 ... pid -> 'pid:[4026532xxx]'
...
```

```bash
# 검증 3: 네트워크 연결 확인
kubectl exec $NGINX_POD -n demo -- cat /proc/net/tcp 2>/dev/null | head -5
```

```text
  sl  local_address rem_address   st tx_queue rx_queue ...
   0: 00000000:0050 00000000:0000 0A 00000000:00000000 ...
```

0050은 16진수로 80번 포트이다. 0A는 LISTEN 상태이다.

**자기 점검:**
- [ ] 시스템 콜 모니터링의 보안 목적을 설명할 수 있는가?
- [ ] seccomp과 strace의 관계를 설명할 수 있는가?
- [ ] /proc 파일시스템에서 프로세스 보안 정보를 추출할 수 있는가?

**관련 CKS 시험 주제:** System Call Monitoring, Runtime Security

---

## 모의 시험 시나리오

### 모의 시험 1: 클러스터 보안 강화 (30분)

**문제 1** (5분): demo 네임스페이스에 default-deny NetworkPolicy를 적용하라. (표준 K8s NetworkPolicy 사용)

<details>
<summary>풀이 확인</summary>

#### 등장 배경과 기존 한계점

쿠버네티스는 기본적으로 모든 Pod 간 통신을 허용한다. NetworkPolicy가 없는 네임스페이스에서는 임의의 Pod가 다른 Pod에 제한 없이 접근할 수 있다. 이는 한 Pod가 침해되면 동일 네임스페이스 내 모든 서비스로 측면 이동(lateral movement)이 가능하다는 것을 의미한다. Default Deny 정책은 "기본 차단, 명시적 허용" 원칙을 적용하여 이 문제를 해결한다.

#### 커널/네트워크 레벨 원리

NetworkPolicy는 CNI 플러그인이 구현한다. Cilium의 경우 eBPF 프로그램이 TC(Traffic Control) 훅에서 패킷의 소스/목적지 IP와 포트를 검사하여 허용/차단을 결정한다. Default Deny 정책이 적용되면 해당 네임스페이스의 모든 Pod에 대한 eBPF policy map에 "기본 DROP" 엔트리가 추가된다. 이후 명시적 허용 정책을 추가하면 해당 트래픽 패턴에 대한 "ALLOW" 엔트리가 policy map에 삽입된다.

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
  namespace: demo
spec:
  podSelector: {}
  policyTypes:
  - Ingress
  - Egress
```

```bash
kubectl apply -f - <<'EOF'
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
  namespace: demo
spec:
  podSelector: {}
  policyTypes:
  - Ingress
  - Egress
EOF
```

```bash
# 검증 1: NetworkPolicy 적용 확인
kubectl get networkpolicy default-deny-all -n demo
```

```text
NAME               POD-SELECTOR   AGE
default-deny-all   <none>         10s
```

```bash
# 검증 2: Pod 간 통신 차단 확인
NGINX_POD=$(kubectl get pods -n demo -l app=nginx-web -o jsonpath='{.items[0].metadata.name}')
kubectl exec $NGINX_POD -n demo -c nginx -- wget -qO- --timeout=3 http://httpbin.demo.svc:8000/get 2>&1
```

```text
wget: download timed out
```

```bash
# 검증 3: DNS도 차단되었는지 확인
kubectl exec $NGINX_POD -n demo -c nginx -- nslookup kubernetes.default.svc 2>&1
```

```text
;; connection timed out; no servers could be reached
```

DNS Egress까지 차단되었음을 확인할 수 있다. 실제 운영에서는 DNS Egress를 허용하는 추가 정책이 필요하다.

```bash
# 정리 (기존 CiliumNetworkPolicy와 충돌 방지)
kubectl delete networkpolicy default-deny-all -n demo
```

**트러블슈팅:**
- NetworkPolicy가 적용되었는데 통신이 차단되지 않는 경우: CNI 플러그인이 NetworkPolicy를 지원하는지 확인한다. Flannel은 NetworkPolicy를 지원하지 않는다.
- 기존 CiliumNetworkPolicy와 표준 NetworkPolicy가 공존할 때: Cilium은 두 정책 타입을 모두 평가하며, 가장 제한적인 결과를 적용한다.

</details>

---

**문제 2** (7분): `secure-ns` 네임스페이스를 생성하고 Pod Security Standards restricted 레벨을 적용하라. restricted를 준수하는 nginx Pod를 배포하라.

<details>
<summary>풀이 확인</summary>

#### 등장 배경과 기존 한계점

쿠버네티스 1.25 이전에는 PodSecurityPolicy(PSP)로 Pod 보안 표준을 적용했다. PSP는 설정이 복잡하고, RBAC과의 상호작용이 직관적이지 않아 운영 오류가 빈번했다. PSP는 1.25에서 완전 제거되었고, Pod Security Admission(PSA)이 대체한다. PSA는 네임스페이스 라벨 하나로 보안 표준을 적용하므로 설정이 단순하다.

#### Pod Security Standards 3단계

| 레벨 | 제한 내용 | 대상 |
|---|---|---|
| `privileged` | 제한 없음 | 시스템 데몬, CNI, 모니터링 에이전트 |
| `baseline` | hostNetwork, hostPID, privileged 컨테이너 차단 | 일반 워크로드 |
| `restricted` | runAsNonRoot, drop ALL capabilities, seccompProfile 필수 | 보안 민감 워크로드 |

```bash
# 1. 네임스페이스 생성 및 PSA 라벨 적용
kubectl create namespace secure-ns
kubectl label namespace secure-ns \
  pod-security.kubernetes.io/enforce=restricted \
  pod-security.kubernetes.io/enforce-version=latest \
  pod-security.kubernetes.io/warn=restricted \
  pod-security.kubernetes.io/audit=restricted
```

```bash
# 검증 1: 라벨 적용 확인
kubectl get namespace secure-ns --show-labels
```

```text
NAME        STATUS   AGE   LABELS
secure-ns   Active   10s   pod-security.kubernetes.io/enforce=restricted,...
```

```bash
# 2. 비준수 Pod 생성 시도 (거부됨)
kubectl run insecure --image=nginx --namespace=secure-ns 2>&1
```

```text
Error from server (Forbidden): pods "insecure" is forbidden: violates PodSecurity "restricted:latest": allowPrivilegeEscalation != false (container "insecure" must set securityContext.allowPrivilegeEscalation=false), unrestricted capabilities (container "insecure" must set securityContext.capabilities.drop=["ALL"]), runAsNonRoot != true (pod or container "insecure" must set securityContext.runAsNonRoot=true), seccompProfile (pod or container "insecure" must set securityContext.seccompProfile.type to "RuntimeDefault" or "Localhost")
```

```bash
# 3. restricted 준수 nginx Pod 배포
cat <<'EOF' | kubectl apply -n secure-ns -f -
apiVersion: v1
kind: Pod
metadata:
  name: secure-nginx
spec:
  securityContext:
    runAsNonRoot: true
    runAsUser: 101
    runAsGroup: 101
    seccompProfile:
      type: RuntimeDefault
  containers:
  - name: nginx
    image: nginxinc/nginx-unprivileged:1.25-alpine
    ports:
    - containerPort: 8080
    securityContext:
      allowPrivilegeEscalation: false
      capabilities:
        drop: ["ALL"]
      readOnlyRootFilesystem: true
    volumeMounts:
    - name: tmp
      mountPath: /tmp
    - name: cache
      mountPath: /var/cache/nginx
    - name: run
      mountPath: /var/run
  volumes:
  - name: tmp
    emptyDir: {}
  - name: cache
    emptyDir: {}
  - name: run
    emptyDir: {}
EOF
```

```bash
# 검증 2: Pod 정상 생성 확인
kubectl get pod secure-nginx -n secure-ns
```

```text
NAME           READY   STATUS    RESTARTS   AGE
secure-nginx   1/1     Running   0          15s
```

```bash
# 검증 3: SecurityContext 설정 확인
kubectl get pod secure-nginx -n secure-ns -o jsonpath='{.spec.containers[0].securityContext}' | jq .
```

```text
{
  "allowPrivilegeEscalation": false,
  "capabilities": {
    "drop": ["ALL"]
  },
  "readOnlyRootFilesystem": true
}
```

```bash
# 정리
kubectl delete namespace secure-ns
```

**트러블슈팅:**
- `nginx:alpine` 이미지는 기본적으로 root(UID 0)로 실행되므로 `runAsNonRoot: true` 위반이 발생한다. `nginxinc/nginx-unprivileged` 이미지를 사용하거나 `runAsUser`를 명시해야 한다.
- restricted 레벨에서는 `seccompProfile.type`이 반드시 `RuntimeDefault` 또는 `Localhost`여야 한다. `Unconfined`는 거부된다.

</details>

---

**문제 3** (8분): `dev-readonly` ServiceAccount를 생성하고, demo 네임스페이스에서 pods, services, configmaps를 get/list만 할 수 있는 Role과 RoleBinding을 생성하라.

<details>
<summary>풀이 확인</summary>

#### 등장 배경과 기존 한계점

쿠버네티스 RBAC(Role-Based Access Control)이 도입되기 전에는 ABAC(Attribute-Based Access Control)을 사용했다. ABAC은 JSON 파일로 정책을 정의하며, 변경 시 API 서버 재시작이 필요했다. RBAC은 쿠버네티스 API 오브젝트(Role, RoleBinding)로 정책을 정의하므로 동적 변경이 가능하다. 최소 권한 원칙(Principle of Least Privilege)은 사용자/서비스에 필요한 최소한의 권한만 부여하는 것이다.

```bash
# 1. ServiceAccount 생성
kubectl create serviceaccount dev-readonly -n demo

# 2. Role 생성
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: dev-readonly-role
  namespace: demo
rules:
- apiGroups: [""]
  resources: ["pods", "services", "configmaps"]
  verbs: ["get", "list"]
EOF

# 3. RoleBinding 생성
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: dev-readonly-binding
  namespace: demo
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: dev-readonly-role
subjects:
- kind: ServiceAccount
  name: dev-readonly
  namespace: demo
EOF
```

```bash
# 검증 1: pods get 권한 확인 (허용)
kubectl auth can-i get pods \
  --as=system:serviceaccount:demo:dev-readonly -n demo
```

```text
yes
```

```bash
# 검증 2: pods list 권한 확인 (허용)
kubectl auth can-i list pods \
  --as=system:serviceaccount:demo:dev-readonly -n demo
```

```text
yes
```

```bash
# 검증 3: pods delete 권한 확인 (차단)
kubectl auth can-i delete pods \
  --as=system:serviceaccount:demo:dev-readonly -n demo
```

```text
no
```

```bash
# 검증 4: secrets 접근 확인 (차단)
kubectl auth can-i get secrets \
  --as=system:serviceaccount:demo:dev-readonly -n demo
```

```text
no
```

```bash
# 검증 5: 다른 네임스페이스 접근 확인 (차단)
kubectl auth can-i get pods \
  --as=system:serviceaccount:demo:dev-readonly -n kube-system
```

```text
no
```

```bash
# 정리
kubectl delete serviceaccount dev-readonly -n demo
kubectl delete role dev-readonly-role -n demo
kubectl delete rolebinding dev-readonly-binding -n demo
```

**트러블슈팅:**
- Role과 RoleBinding의 namespace가 일치해야 한다. 다른 네임스페이스의 리소스에 접근하려면 ClusterRole + RoleBinding 조합을 사용한다.
- ServiceAccount의 subjects에서 namespace 필드를 빠뜨리면 바인딩이 동작하지 않는다.

</details>

---

**문제 4** (5분): 현재 클러스터에서 privileged 컨테이너로 실행 중인 Pod를 모두 찾아라.

<details>
<summary>풀이 확인</summary>

#### 공격-방어 매핑

privileged 컨테이너는 호스트의 모든 디바이스에 접근할 수 있고, 호스트 커널의 모든 capability를 보유한다. 컨테이너 내부에서 `mount`, `fdisk`, `nsenter` 등을 사용하여 호스트 파일시스템에 접근하고 컨테이너를 탈출할 수 있다. CKS 시험에서는 privileged Pod를 식별하고 제거하는 것이 빈출 유형이다.

```bash
# 방법 1: jsonpath로 privileged 컨테이너 검색
kubectl get pods -A -o jsonpath='{range .items[*]}{.metadata.namespace}{"/"}{.metadata.name}{": "}{range .spec.containers[*]}{.name}{"=privileged:"}{.securityContext.privileged}{" "}{end}{"\n"}{end}' | grep "true"
```

```text
kube-system/kube-proxy-xxxxx: kube-proxy=privileged:true
```

```bash
# 방법 2: 모든 네임스페이스에서 privileged Pod를 JSON으로 추출
kubectl get pods -A -o json | jq -r '
  .items[] |
  select(.spec.containers[]?.securityContext?.privileged == true) |
  "\(.metadata.namespace)/\(.metadata.name)"
'
```

```text
kube-system/kube-proxy-xxxxx
```

```bash
# 방법 3: initContainers도 포함하여 검색
kubectl get pods -A -o json | jq -r '
  .items[] |
  . as $pod |
  ((.spec.containers // []) + (.spec.initContainers // [])) |
  .[] |
  select(.securityContext?.privileged == true) |
  "\($pod.metadata.namespace)/\($pod.metadata.name) container=\(.name)"
'
```

```text
kube-system/kube-proxy-xxxxx container=kube-proxy
```

```bash
# 검증: 해당 Pod의 securityContext 상세 확인
kubectl get pod kube-proxy-xxxxx -n kube-system -o jsonpath='{.spec.containers[0].securityContext}' | jq .
```

```text
{
  "privileged": true
}
```

**트러블슈팅:**
- initContainers에도 privileged 설정이 있을 수 있으므로 반드시 함께 검색해야 한다.
- kube-proxy, CNI 관련 Pod는 정상적으로 privileged로 실행된다. 사용자 워크로드에서 privileged가 설정된 경우에만 보안 문제이다.

</details>

---

**문제 5** (5분): kube-apiserver의 --anonymous-auth 설정을 확인하고, audit-log-path 설정 여부를 확인하라.

<details>
<summary>풀이 확인</summary>

#### 등장 배경과 기존 한계점

anonymous-auth가 true(기본값)이면 인증 정보 없이 API 서버에 접근할 수 있다. RBAC이 적절히 설정되지 않은 경우 익명 사용자가 클러스터 정보를 조회할 수 있다. audit-log-path가 설정되지 않으면 API 서버에 대한 모든 요청이 기록되지 않아 침해 사고 시 포렌식이 불가능하다.

```bash
# 방법 1: kube-apiserver static Pod manifest에서 확인
ssh admin@<dev-master-ip> 'sudo cat /etc/kubernetes/manifests/kube-apiserver.yaml' | grep -E "anonymous-auth|audit-log-path"
```

```text
    - --anonymous-auth=false
    # audit-log-path가 출력되지 않으면 미설정 상태이다
```

```bash
# 방법 2: 실행 중인 프로세스에서 직접 확인
ssh admin@<dev-master-ip> 'ps aux | grep kube-apiserver' | tr ' ' '\n' | grep -E "anonymous-auth|audit-log-path"
```

```text
--anonymous-auth=false
```

audit-log-path가 출력되지 않으면 감사 로깅이 비활성화된 상태이다.

```bash
# 검증 1: 익명 접근 테스트
curl -sk https://<dev-master-ip>:6443/api/v1/namespaces 2>&1 | head -5
```

anonymous-auth=false인 경우:
```text
{
  "kind": "Status",
  "apiVersion": "v1",
  "status": "Failure",
  "message": "Unauthorized",
```

anonymous-auth=true인 경우:
```text
{
  "kind": "Status",
  "apiVersion": "v1",
  "status": "Failure",
  "message": "namespaces is forbidden: User \"system:anonymous\" cannot list resource ...",
```

```bash
# 검증 2: Audit 로그 파일 존재 확인
ssh admin@<dev-master-ip> 'sudo ls -la /var/log/kubernetes/audit/ 2>/dev/null'
```

설정된 경우:
```text
-rw------- 1 root root XXXXXX ... audit.log
```

미설정된 경우:
```text
ls: cannot access '/var/log/kubernetes/audit/': No such file or directory
```

**수정 방법 (필요 시):**

```yaml
# /etc/kubernetes/manifests/kube-apiserver.yaml에 다음 플래그 추가/수정
spec:
  containers:
  - command:
    - kube-apiserver
    - --anonymous-auth=false
    - --audit-log-path=/var/log/kubernetes/audit/audit.log
    - --audit-policy-file=/etc/kubernetes/audit/policy.yaml
    - --audit-log-maxage=30
    - --audit-log-maxbackup=10
    - --audit-log-maxsize=100
```

**트러블슈팅:**
- kube-apiserver.yaml 수정 후 kubelet이 자동으로 Pod를 재시작한다. `crictl ps | grep apiserver`로 재시작을 확인한다.
- audit-log-path의 디렉토리가 hostPath로 마운트되어야 한다. 디렉토리가 존재하지 않으면 API 서버가 시작되지 않는다.

</details>

---

### 모의 시험 2: 런타임 보안 (35분)

**문제 1** (8분): `immutable-nginx`라는 이름의 Pod를 생성하라. 조건:
- nginx:1.25-alpine 이미지
- readOnlyRootFilesystem: true
- runAsNonRoot: true, runAsUser: 101
- capabilities drop ALL
- /var/cache/nginx, /var/run, /tmp에 emptyDir 마운트

<details>
<summary>풀이 확인</summary>

#### 등장 배경과 기존 한계점

기본 컨테이너는 파일시스템이 쓰기 가능하다. 침해된 컨테이너에서 공격자가 악성 바이너리를 다운로드하거나, 웹셸을 배포하거나, 설정 파일을 변조할 수 있다. readOnlyRootFilesystem은 컨테이너의 루트 파일시스템을 읽기 전용으로 마운트하여 이러한 공격을 차단한다. 애플리케이션이 쓰기가 필요한 경로(캐시, PID 파일, 임시 파일)에만 emptyDir을 마운트한다.

#### 커널 레벨 원리

readOnlyRootFilesystem은 컨테이너 런타임이 `mount` syscall에서 루트 파일시스템을 `MS_RDONLY` 플래그로 마운트하는 것이다. 커널의 VFS(Virtual File System) 레이어에서 쓰기 작업(open with O_WRONLY/O_RDWR, mkdir, unlink 등)이 요청되면 `EROFS(Read-only file system)` 에러를 반환한다.

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: immutable-nginx
  namespace: demo
spec:
  securityContext:
    runAsNonRoot: true
    runAsUser: 101
    runAsGroup: 101
    seccompProfile:
      type: RuntimeDefault
  containers:
  - name: nginx
    image: nginx:1.25-alpine
    ports:
    - containerPort: 80
    securityContext:
      allowPrivilegeEscalation: false
      readOnlyRootFilesystem: true
      capabilities:
        drop: ["ALL"]
    volumeMounts:
    - name: cache
      mountPath: /var/cache/nginx
    - name: run
      mountPath: /var/run
    - name: tmp
      mountPath: /tmp
  volumes:
  - name: cache
    emptyDir: {}
  - name: run
    emptyDir: {}
  - name: tmp
    emptyDir: {}
```

```bash
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: v1
kind: Pod
metadata:
  name: immutable-nginx
spec:
  securityContext:
    runAsNonRoot: true
    runAsUser: 101
    runAsGroup: 101
    seccompProfile:
      type: RuntimeDefault
  containers:
  - name: nginx
    image: nginx:1.25-alpine
    ports:
    - containerPort: 80
    securityContext:
      allowPrivilegeEscalation: false
      readOnlyRootFilesystem: true
      capabilities:
        drop: ["ALL"]
    volumeMounts:
    - name: cache
      mountPath: /var/cache/nginx
    - name: run
      mountPath: /var/run
    - name: tmp
      mountPath: /tmp
  volumes:
  - name: cache
    emptyDir: {}
  - name: run
    emptyDir: {}
  - name: tmp
    emptyDir: {}
EOF
```

```bash
# 검증 1: Pod 상태 확인
kubectl get pod immutable-nginx -n demo
```

```text
NAME              READY   STATUS    RESTARTS   AGE
immutable-nginx   1/1     Running   0          10s
```

```bash
# 검증 2: 루트 파일시스템 쓰기 차단 확인
kubectl exec immutable-nginx -n demo -- sh -c 'echo test > /etc/test' 2>&1
```

```text
sh: can't create /etc/test: Read-only file system
```

```bash
# 검증 3: emptyDir 쓰기 허용 확인
kubectl exec immutable-nginx -n demo -- sh -c 'echo ok > /tmp/test && cat /tmp/test'
```

```text
ok
```

```bash
# 검증 4: capabilities 확인
kubectl exec immutable-nginx -n demo -- cat /proc/1/status | grep -i capeff
```

```text
CapEff:	0000000000000000
```

CapEff가 모두 0이면 모든 capability가 제거된 상태이다.

```bash
# 검증 5: 실행 사용자 확인
kubectl exec immutable-nginx -n demo -- id
```

```text
uid=101(nginx) gid=101(nginx)
```

```bash
# 검증 6: SecurityContext 전체 확인
kubectl get pod immutable-nginx -n demo -o jsonpath='{.spec.containers[0].securityContext}' | jq .
```

```text
{
  "allowPrivilegeEscalation": false,
  "capabilities": {
    "drop": ["ALL"]
  },
  "readOnlyRootFilesystem": true
}
```

```bash
# 정리
kubectl delete pod immutable-nginx -n demo
```

**트러블슈팅:**
- nginx:1.25-alpine은 기본적으로 root(UID 0)로 실행된다. `runAsUser: 101`로 nginx 사용자로 실행하면 80번 포트 바인딩이 실패할 수 있다. 이 경우 `NET_BIND_SERVICE` capability를 추가하거나 8080 등 비특권 포트를 사용한다.
- /var/cache/nginx과 /var/run에 emptyDir을 마운트하지 않으면 nginx가 시작에 실패한다. 이는 nginx가 캐시 파일과 PID 파일을 해당 경로에 쓰기 때문이다.

</details>

---

**문제 2** (7분): demo 네임스페이스의 모든 Pod에서 사용 중인 이미지를 나열하고, 각 이미지의 CRITICAL 취약점 수를 확인하라. (Trivy 사용)

<details>
<summary>풀이 확인</summary>

#### 등장 배경과 기존 한계점

컨테이너 이미지에는 OS 패키지와 라이브러리가 포함되어 있으며, 이 중 알려진 취약점(CVE)이 존재할 수 있다. 이미지 스캔 없이 배포하면 공격자가 알려진 취약점을 이용하여 컨테이너를 침해할 수 있다. CRITICAL 등급 취약점은 원격 코드 실행(RCE)이나 권한 상승이 가능한 취약점이므로 즉시 대응이 필요하다.

```bash
# 1. 현재 사용 중인 이미지 목록 추출
kubectl get pods -n demo -o jsonpath='{range .items[*]}{range .spec.containers[*]}{.image}{"\n"}{end}{end}' | sort -u
```

```text
docker.io/mccutchen/go-httpbin:v2.13.4
nginx:1.25-alpine
postgres:15-alpine
rabbitmq:3.12-management-alpine
redis:7-alpine
```

```bash
# 2. 각 이미지에 대해 Trivy 스캔 수행
for img in $(kubectl get pods -n demo -o jsonpath='{range .items[*]}{range .spec.containers[*]}{.image}{"\n"}{end}{end}' | sort -u); do
  echo "=== $img ==="
  trivy image --severity CRITICAL --quiet "$img" 2>/dev/null | tail -3
  echo ""
done
```

```text
=== docker.io/mccutchen/go-httpbin:v2.13.4 ===
Total: 0 (CRITICAL: 0)

=== nginx:1.25-alpine ===
Total: 2 (CRITICAL: 2)

=== postgres:15-alpine ===
Total: 1 (CRITICAL: 1)

=== rabbitmq:3.12-management-alpine ===
Total: 0 (CRITICAL: 0)

=== redis:7-alpine ===
Total: 0 (CRITICAL: 0)
```

```bash
# 3. CRITICAL 취약점 상세 확인 (예: nginx)
trivy image --severity CRITICAL nginx:1.25-alpine 2>/dev/null
```

```text
nginx:1.25-alpine (alpine 3.18.X)
Total: 2 (CRITICAL: 2)

┌──────────────┬────────────────┬──────────┬───────────────────┬───────────────┬──────────────────────────────────────────┐
│   Library    │ Vulnerability  │ Severity │ Installed Version │ Fixed Version │                  Title                   │
├──────────────┼────────────────┼──────────┼───────────────────┼───────────────┼──────────────────────────────────────────┤
│ libcrypto3   │ CVE-XXXX-XXXXX │ CRITICAL │ 3.1.X             │ 3.1.Y         │ openssl: ...                             │
│ libssl3      │ CVE-XXXX-XXXXX │ CRITICAL │ 3.1.X             │ 3.1.Y         │ openssl: ...                             │
└──────────────┴────────────────┴──────────┴───────────────────┴───────────────┴──────────────────────────────────────────┘
```

**대응 방법:**
1. Fixed Version이 있으면 이미지를 업데이트한다
2. Fixed Version이 없으면 해당 라이브러리를 사용하지 않는 대체 이미지를 검토한다
3. `trivy image --ignore-unfixed`로 수정 가능한 취약점만 필터링한다

**트러블슈팅:**
- Trivy가 설치되지 않은 경우: `curl -sfL https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh | sh`로 설치한다.
- 이미지 pull이 실패하는 경우: `trivy image --input`으로 로컬 tar 파일을 스캔하거나, `--username`/`--password` 플래그로 레지스트리 인증을 제공한다.

</details>

---

**문제 3** (10분): OPA Gatekeeper ConstraintTemplate을 작성하라. 조건:
- 모든 Pod에 `security-scan: passed` 라벨이 필수
- `security-test` 네임스페이스에만 적용

<details>
<summary>풀이 확인</summary>

#### 등장 배경과 기존 한계점

쿠버네티스 기본 Admission Controller는 Pod에 특정 라벨이나 어노테이션이 있는지 강제할 수 없다. OPA(Open Policy Agent) Gatekeeper는 ValidatingAdmissionWebhook을 통해 커스텀 정책을 적용한다. Rego 언어로 정책 로직을 정의하고, ConstraintTemplate(정책 템플릿)과 Constraint(정책 인스턴스)로 분리하여 재사용성을 높인다.

```bash
# 1. ConstraintTemplate 생성
cat <<'EOF' | kubectl apply -f -
apiVersion: templates.gatekeeper.sh/v1
kind: ConstraintTemplate
metadata:
  name: k8srequiredlabels
spec:
  crd:
    spec:
      names:
        kind: K8sRequiredLabels
      validation:
        openAPIV3Schema:
          type: object
          properties:
            labels:
              type: array
              items:
                type: object
                properties:
                  key:
                    type: string
                  allowedRegex:
                    type: string
  targets:
  - target: admission.k8s.gatekeeper.sh
    rego: |
      package k8srequiredlabels

      violation[{"msg": msg, "details": {"missing_labels": missing}}] {
        provided := {label | input.review.object.metadata.labels[label]}
        required := {label | label := input.parameters.labels[_].key}
        missing := required - provided
        count(missing) > 0
        msg := sprintf("Pod에 필수 라벨이 누락되었다: %v", [missing])
      }

      violation[{"msg": msg}] {
        label := input.parameters.labels[_]
        label.allowedRegex != ""
        value := input.review.object.metadata.labels[label.key]
        not re_match(label.allowedRegex, value)
        msg := sprintf("라벨 <%v>의 값 <%v>가 허용 패턴 <%v>과 불일치한다", [label.key, value, label.allowedRegex])
      }
EOF

# 2. Constraint 생성 (security-test 네임스페이스에만 적용)
cat <<'EOF' | kubectl apply -f -
apiVersion: constraints.gatekeeper.sh/v1beta1
kind: K8sRequiredLabels
metadata:
  name: require-security-scan-label
spec:
  match:
    kinds:
    - apiGroups: [""]
      kinds: ["Pod"]
    namespaces: ["security-test"]
  parameters:
    labels:
    - key: "security-scan"
      allowedRegex: "^passed$"
EOF
```

```bash
# 검증 준비: 테스트 네임스페이스 생성
kubectl create namespace security-test
```

```bash
# 검증 1: 라벨 없는 Pod 생성 (거부)
kubectl run no-label --image=nginx:alpine -n security-test 2>&1
```

```text
Error from server (Forbidden): admission webhook "validation.gatekeeper.sh" denied the request: [require-security-scan-label] Pod에 필수 라벨이 누락되었다: {"security-scan"}
```

```bash
# 검증 2: 잘못된 라벨 값 (거부)
kubectl run wrong-label --image=nginx:alpine -n security-test \
  --labels="security-scan=failed" 2>&1
```

```text
Error from server (Forbidden): admission webhook "validation.gatekeeper.sh" denied the request: [require-security-scan-label] 라벨 <security-scan>의 값 <failed>가 허용 패턴 <^passed$>과 불일치한다
```

```bash
# 검증 3: 올바른 라벨 (허용)
kubectl run ok-pod --image=nginx:alpine -n security-test \
  --labels="security-scan=passed" 2>&1
```

```text
pod/ok-pod created
```

```bash
# 검증 4: 다른 네임스페이스에서는 라벨 없이도 허용
kubectl run any-pod --image=nginx:alpine -n default 2>&1
```

```text
pod/any-pod created
```

```bash
# 정리
kubectl delete namespace security-test
kubectl delete k8srequiredlabels require-security-scan-label
kubectl delete constrainttemplate k8srequiredlabels
kubectl delete pod any-pod -n default 2>/dev/null
```

**트러블슈팅:**
- Gatekeeper가 설치되지 않은 경우 ConstraintTemplate CRD가 존재하지 않는다. `kubectl get crd | grep gatekeeper`로 설치 여부를 확인한다.
- Constraint 적용 후 기존 Pod에는 영향이 없다. Gatekeeper는 Admission Webhook이므로 새로운 생성/수정 요청만 검증한다.
- ConstraintTemplate이 Ready 상태가 아니면 Constraint가 동작하지 않는다. `kubectl get constrainttemplate k8srequiredlabels -o jsonpath='{.status}'`로 확인한다.

</details>

---

**문제 4** (5분): nginx-web Pod에서 httpbin으로 POST 요청이 차단되는지 확인하라. 어떤 NetworkPolicy가 차단하는지 식별하라.

<details>
<summary>풀이 확인</summary>

#### 공격-방어 매핑

L7 네트워크 정책은 HTTP 메서드 수준에서 트래픽을 제어한다. 예를 들어 GET 요청은 허용하되 POST/PUT/DELETE 요청은 차단할 수 있다. 이는 읽기 전용 서비스에서 데이터 변조 공격을 방지하는 데 유효하다.

```bash
# 1. nginx-web에서 httpbin으로 GET 요청 (허용 여부 확인)
NGINX_POD=$(kubectl get pods -n demo -l app=nginx-web -o jsonpath='{.items[0].metadata.name}')
kubectl exec $NGINX_POD -n demo -c nginx -- wget -qO- --timeout=5 http://httpbin.demo.svc:8000/get 2>&1 | head -5
```

```text
{
  "args": {},
  "headers": {
    ...
  },
```

```bash
# 2. POST 요청 시도
kubectl exec $NGINX_POD -n demo -c nginx -- wget -qO- --timeout=5 --post-data='test=1' http://httpbin.demo.svc:8000/post 2>&1
```

CiliumNetworkPolicy L7 규칙에 의해 차단되는 경우:
```text
wget: server returned error: HTTP/1.1 403 Forbidden
```

```bash
# 3. 차단하는 NetworkPolicy 식별
kubectl get ciliumnetworkpolicy -n demo -o yaml | grep -B 5 -A 20 "method"
```

```text
    rules:
      http:
      - method: GET
        path: "/.*"
```

GET만 허용하는 L7 규칙이 설정되어 있으면 POST가 차단된다.

```bash
# 4. CiliumNetworkPolicy 전체 목록에서 관련 정책 찾기
kubectl get ciliumnetworkpolicy -n demo
```

```text
NAME                          AGE
nginx-to-httpbin              Xd
...
```

```bash
# 5. 해당 정책 상세 확인
kubectl get ciliumnetworkpolicy nginx-to-httpbin -n demo -o yaml
```

해당 정책에서 `toPorts` 하위의 `rules.http` 섹션에 허용된 HTTP 메서드가 정의되어 있다. POST가 목록에 없으면 차단된다.

**트러블슈팅:**
- CiliumNetworkPolicy가 아닌 표준 NetworkPolicy만 있는 경우 L7 필터링이 불가능하다. 표준 NetworkPolicy는 L3/L4만 지원한다.
- `hubble observe` 명령으로 실시간 트래픽 흐름과 차단 사유를 확인할 수 있다: `hubble observe --namespace demo --verdict DROPPED`

</details>

---

**문제 5** (5분): etcd에서 Secret이 평문으로 저장되어 있는지 확인하라.

<details>
<summary>풀이 확인</summary>

#### 등장 배경과 기존 한계점

쿠버네티스 Secret은 기본적으로 etcd에 base64 인코딩으로 저장된다. base64는 암호화가 아니라 인코딩이므로, etcd에 직접 접근할 수 있는 공격자가 모든 Secret을 평문으로 읽을 수 있다. etcd 백업 파일이 유출되면 모든 데이터베이스 비밀번호, API 키, TLS 인증서가 노출된다. EncryptionConfiguration을 통해 etcd에 저장되는 Secret을 aescbc, aesgcm, secretbox 등으로 암호화해야 한다.

```bash
# 1. etcd에서 Secret 직접 조회
ssh admin@<dev-master-ip> 'sudo ETCDCTL_API=3 etcdctl get /registry/secrets/demo/postgres-secret \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key | hexdump -C | head -20'
```

암호화가 적용되지 않은 경우(평문):
```text
00000000  ... 2f 72 65 67 69 73 74 72  79 2f 73 65 63 72 65 74  |.../registry/secret|
00000010  73 2f 64 65 6d 6f 2f 70  6f 73 74 67 72 65 73 2d  |s/demo/postgres-|
00000020  ... 64 65 6d 6f 31 32 33 ...                        |...demo123...|
```

hexdump에서 Secret 값(demo123)이 평문으로 보이면 암호화가 적용되지 않은 것이다.

암호화가 적용된 경우:
```text
00000000  ... 6b 38 73 3a 65 6e 63 3a 61 65 73 63 62 63 3a  |...k8s:enc:aescbc:|
00000010  76 31 3a 6b 65 79 31 3a  XX XX XX XX XX XX XX XX  |v1:key1:........|
```

`k8s:enc:aescbc:v1:key1:` 접두사가 있으면 aescbc로 암호화된 것이다.

```bash
# 2. EncryptionConfiguration 설정 확인
ssh admin@<dev-master-ip> 'sudo cat /etc/kubernetes/manifests/kube-apiserver.yaml' | grep encryption-provider-config
```

설정된 경우:
```text
    - --encryption-provider-config=/etc/kubernetes/enc/enc.yaml
```

미설정된 경우 출력이 없다.

```bash
# 3. EncryptionConfiguration 내용 확인 (설정된 경우)
ssh admin@<dev-master-ip> 'sudo cat /etc/kubernetes/enc/enc.yaml 2>/dev/null'
```

```text
apiVersion: apiserver.config.k8s.io/v1
kind: EncryptionConfiguration
resources:
- resources:
  - secrets
  providers:
  - aescbc:
      keys:
      - name: key1
        secret: <base64-encoded-key>
  - identity: {}
```

providers 목록에서 `identity: {}`가 첫 번째이면 암호화가 비활성화된 것이다. `aescbc`나 `aesgcm`이 첫 번째여야 새로 저장되는 Secret이 암호화된다.

**트러블슈팅:**
- EncryptionConfiguration을 적용한 후 기존 Secret은 여전히 평문이다. `kubectl get secrets --all-namespaces -o json | kubectl replace -f -`로 모든 Secret을 재작성해야 기존 Secret도 암호화된다.
- etcdctl 바이너리가 노드에 설치되지 않은 경우: `kubectl exec -it etcd-master -n kube-system -- etcdctl` 형태로 etcd Pod에서 직접 실행한다.

</details>

---

### 모의 시험 3: 공급망 및 감사 (40분)

**문제 1** (10분): Audit Policy를 작성하라. 조건:
- secrets에 대한 모든 접근: RequestResponse 레벨
- pods 생성/삭제: Request 레벨
- configmaps 읽기: Metadata 레벨
- 나머지: None

<details>
<summary>풀이 확인</summary>

#### 등장 배경과 기존 한계점

Audit Policy가 없거나 부적절하면 두 가지 문제가 발생한다. 첫째, 모든 요청을 RequestResponse로 기록하면 로그 볼륨이 과도하게 커져 디스크를 소진하고 API 서버 성능이 저하된다. 둘째, 중요 리소스(Secret, RBAC)에 대한 로깅이 없으면 침해 사고 시 포렌식이 불가능하다. 적절한 Audit Policy는 리소스별 중요도에 따라 로깅 레벨을 차등 적용한다.

```yaml
apiVersion: audit.k8s.io/v1
kind: Policy
rules:
  # Secret 접근: 요청 및 응답 본문까지 기록 (포렌식용)
  - level: RequestResponse
    resources:
    - group: ""
      resources: ["secrets"]

  # Pod 생성/삭제: 요청 본문 기록
  - level: Request
    resources:
    - group: ""
      resources: ["pods"]
    verbs: ["create", "delete"]

  # ConfigMap 읽기: 메타데이터만 기록
  - level: Metadata
    resources:
    - group: ""
      resources: ["configmaps"]
    verbs: ["get", "list", "watch"]

  # 나머지: 기록하지 않음
  - level: None
```

```bash
# 1. Audit Policy 파일을 마스터 노드에 저장
ssh admin@<dev-master-ip> 'sudo mkdir -p /etc/kubernetes/audit && sudo tee /etc/kubernetes/audit/policy.yaml' <<'EOF'
apiVersion: audit.k8s.io/v1
kind: Policy
rules:
  - level: RequestResponse
    resources:
    - group: ""
      resources: ["secrets"]
  - level: Request
    resources:
    - group: ""
      resources: ["pods"]
    verbs: ["create", "delete"]
  - level: Metadata
    resources:
    - group: ""
      resources: ["configmaps"]
    verbs: ["get", "list", "watch"]
  - level: None
EOF
```

```bash
# 2. kube-apiserver.yaml에 Audit 플래그 추가
ssh admin@<dev-master-ip> 'sudo cat /etc/kubernetes/manifests/kube-apiserver.yaml'
# 다음 플래그를 command 섹션에 추가:
# - --audit-policy-file=/etc/kubernetes/audit/policy.yaml
# - --audit-log-path=/var/log/kubernetes/audit/audit.log
# - --audit-log-maxage=30
# - --audit-log-maxbackup=10
# - --audit-log-maxsize=100
# volumeMounts와 volumes에 해당 경로도 추가해야 한다.
```

```bash
# 검증 1: API 서버 재시작 후 Audit 로그 확인
ssh admin@<dev-master-ip> 'sudo tail -5 /var/log/kubernetes/audit/audit.log 2>/dev/null | jq .kind'
```

```text
"Event"
"Event"
"Event"
"Event"
"Event"
```

```bash
# 검증 2: Secret 접근 후 RequestResponse 레벨 확인
kubectl get secret -n demo
ssh admin@<dev-master-ip> 'sudo tail -50 /var/log/kubernetes/audit/audit.log | jq "select(.objectRef.resource==\"secrets\") | {level, verb, user: .user.username, resource: .objectRef.resource}"' 2>/dev/null | head -20
```

```text
{
  "level": "RequestResponse",
  "verb": "list",
  "user": "kubernetes-admin",
  "resource": "secrets"
}
```

```bash
# 검증 3: ConfigMap 접근 후 Metadata 레벨 확인
kubectl get configmap -n demo
ssh admin@<dev-master-ip> 'sudo tail -50 /var/log/kubernetes/audit/audit.log | jq "select(.objectRef.resource==\"configmaps\") | {level, verb}"' 2>/dev/null | head -10
```

```text
{
  "level": "Metadata",
  "verb": "list"
}
```

**트러블슈팅:**
- kube-apiserver.yaml 수정 시 문법 오류가 있으면 API 서버가 시작되지 않는다. 수정 전 반드시 백업(`sudo cp kube-apiserver.yaml kube-apiserver.yaml.bak`)한다.
- volumeMounts와 volumes를 추가하지 않으면 Audit Policy 파일과 로그 디렉토리에 접근할 수 없어 API 서버 시작에 실패한다.
- API 서버가 재시작되지 않으면 `sudo crictl ps -a | grep apiserver`로 컨테이너 상태를 확인하고, `sudo crictl logs <container-id>`로 에러를 확인한다.

</details>

---

**문제 2** (8분): `hardened-app` Deployment를 작성하라. 조건:
- busybox:1.36 이미지, replica 2
- automountServiceAccountToken: false
- seccompProfile: RuntimeDefault
- 모든 SecurityContext 강화 적용
- Resource requests/limits 설정

<details>
<summary>풀이 확인</summary>

#### 등장 배경과 기존 한계점

ServiceAccount 토큰이 자동으로 마운트되면 침해된 컨테이너에서 K8s API에 접근할 수 있다. seccompProfile이 Unconfined이면 컨테이너가 커널의 모든 syscall을 호출할 수 있다. Resource limits가 없으면 단일 Pod가 노드의 자원을 독점하여 DoS가 발생한다. 이러한 모든 보안 강화를 종합 적용하는 것이 CKS에서 요구하는 "hardened workload" 패턴이다.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: hardened-app
  namespace: demo
spec:
  replicas: 2
  selector:
    matchLabels:
      app: hardened-app
  template:
    metadata:
      labels:
        app: hardened-app
    spec:
      automountServiceAccountToken: false
      securityContext:
        runAsNonRoot: true
        runAsUser: 65534
        runAsGroup: 65534
        fsGroup: 65534
        seccompProfile:
          type: RuntimeDefault
      containers:
      - name: app
        image: busybox:1.36
        command: ["sh", "-c", "while true; do echo heartbeat; sleep 30; done"]
        securityContext:
          allowPrivilegeEscalation: false
          readOnlyRootFilesystem: true
          capabilities:
            drop: ["ALL"]
        resources:
          requests:
            cpu: 10m
            memory: 16Mi
          limits:
            cpu: 50m
            memory: 64Mi
        volumeMounts:
        - name: tmp
          mountPath: /tmp
      volumes:
      - name: tmp
        emptyDir:
          sizeLimit: 10Mi
```

```bash
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: hardened-app
spec:
  replicas: 2
  selector:
    matchLabels:
      app: hardened-app
  template:
    metadata:
      labels:
        app: hardened-app
    spec:
      automountServiceAccountToken: false
      securityContext:
        runAsNonRoot: true
        runAsUser: 65534
        runAsGroup: 65534
        seccompProfile:
          type: RuntimeDefault
      containers:
      - name: app
        image: busybox:1.36
        command: ["sh", "-c", "while true; do echo heartbeat; sleep 30; done"]
        securityContext:
          allowPrivilegeEscalation: false
          readOnlyRootFilesystem: true
          capabilities:
            drop: ["ALL"]
        resources:
          requests:
            cpu: 10m
            memory: 16Mi
          limits:
            cpu: 50m
            memory: 64Mi
        volumeMounts:
        - name: tmp
          mountPath: /tmp
      volumes:
      - name: tmp
        emptyDir:
          sizeLimit: 10Mi
EOF
```

```bash
# 검증 1: Deployment 상태 확인
kubectl get deployment hardened-app -n demo
```

```text
NAME           READY   UP-TO-DATE   AVAILABLE   AGE
hardened-app   2/2     2            2           15s
```

```bash
# 검증 2: automountServiceAccountToken 확인
kubectl get pod -l app=hardened-app -n demo -o jsonpath='{.items[0].spec.automountServiceAccountToken}'
```

```text
false
```

```bash
# 검증 3: ServiceAccount 토큰 마운트 부재 확인
HARDENED_POD=$(kubectl get pods -n demo -l app=hardened-app -o jsonpath='{.items[0].metadata.name}')
kubectl exec $HARDENED_POD -n demo -- ls /var/run/secrets/kubernetes.io/serviceaccount/ 2>&1
```

```text
ls: /var/run/secrets/kubernetes.io/serviceaccount/: No such file or directory
```

```bash
# 검증 4: capabilities 확인 (모두 제거)
kubectl exec $HARDENED_POD -n demo -- cat /proc/1/status | grep CapEff
```

```text
CapEff:	0000000000000000
```

```bash
# 검증 5: seccompProfile 확인
kubectl get pod $HARDENED_POD -n demo -o jsonpath='{.spec.securityContext.seccompProfile}' | jq .
```

```text
{
  "type": "RuntimeDefault"
}
```

```bash
# 검증 6: resource limits 확인
kubectl get pod $HARDENED_POD -n demo -o jsonpath='{.spec.containers[0].resources}' | jq .
```

```text
{
  "limits": {
    "cpu": "50m",
    "memory": "64Mi"
  },
  "requests": {
    "cpu": "10m",
    "memory": "16Mi"
  }
}
```

```bash
# 정리
kubectl delete deployment hardened-app -n demo
```

**트러블슈팅:**
- busybox는 기본적으로 root로 실행되지만 `runAsUser: 65534`(nobody)로 오버라이드한다. 파일시스템 쓰기가 필요한 경로에 emptyDir을 마운트해야 한다.
- `automountServiceAccountToken: false`는 Pod spec 레벨에서 설정해야 한다. ServiceAccount 오브젝트에서도 설정할 수 있지만, Pod spec이 우선한다.

</details>

---

**문제 3** (7분): demo 네임스페이스의 ServiceAccount 중 과도한 권한을 가진 것을 식별하라. auth can-i를 사용하여 각 SA의 secret 접근 권한을 확인하라.

<details>
<summary>풀이 확인</summary>

#### 공격-방어 매핑

과도한 권한을 가진 ServiceAccount는 침해 시 피해 범위를 확대한다. 특히 Secret 접근 권한이 있는 SA가 침해되면 데이터베이스 비밀번호, API 키, TLS 인증서 등이 유출된다. 정기적으로 SA의 권한을 감사하고, 불필요한 권한을 제거하는 것이 최소 권한 원칙이다.

```bash
# 1. demo 네임스페이스의 모든 ServiceAccount 나열
kubectl get serviceaccounts -n demo -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}'
```

```text
default
postgres
rabbitmq
```

```bash
# 2. 각 SA의 Secret 접근 권한 확인
for sa in $(kubectl get sa -n demo -o jsonpath='{range .items[*]}{.metadata.name}{" "}{end}'); do
  echo "=== SA: $sa ==="
  echo -n "  get secrets: "
  kubectl auth can-i get secrets --as=system:serviceaccount:demo:$sa -n demo 2>/dev/null
  echo -n "  list secrets: "
  kubectl auth can-i list secrets --as=system:serviceaccount:demo:$sa -n demo 2>/dev/null
  echo -n "  create secrets: "
  kubectl auth can-i create secrets --as=system:serviceaccount:demo:$sa -n demo 2>/dev/null
  echo -n "  delete secrets: "
  kubectl auth can-i delete secrets --as=system:serviceaccount:demo:$sa -n demo 2>/dev/null
done
```

```text
=== SA: default ===
  get secrets: no
  list secrets: no
  create secrets: no
  delete secrets: no
=== SA: postgres ===
  get secrets: no
  list secrets: no
  create secrets: no
  delete secrets: no
=== SA: rabbitmq ===
  get secrets: no
  list secrets: no
  create secrets: no
  delete secrets: no
```

```bash
# 3. 더 넓은 범위 검사: 전체 API 리소스 접근 확인
for sa in $(kubectl get sa -n demo -o jsonpath='{range .items[*]}{.metadata.name}{" "}{end}'); do
  echo "=== SA: $sa ==="
  kubectl auth can-i --list --as=system:serviceaccount:demo:$sa -n demo 2>/dev/null | grep -v "selfsubjectaccessreviews\|selfsubjectrulesreviews\|Resources"
done
```

```text
=== SA: default ===
                                                  [/api/*]               []
                                                  [/healthz]             []
...
```

```bash
# 4. ClusterRoleBinding도 확인 (클러스터 전체 권한)
kubectl get clusterrolebindings -o json | jq -r '
  .items[] |
  select(.subjects[]? | select(.kind == "ServiceAccount" and .namespace == "demo")) |
  "\(.metadata.name) -> \(.roleRef.name)"
'
```

과도한 ClusterRoleBinding(예: cluster-admin에 바인딩)이 발견되면 즉시 제거해야 한다.

**트러블슈팅:**
- `auth can-i --list`는 해당 SA가 가진 모든 권한을 나열한다. 출력이 많으면 `grep -E "secrets|configmaps|pods"`로 필터링한다.
- 기본 ServiceAccount(`default`)에 권한이 부여되어 있으면 해당 네임스페이스의 모든 Pod가 그 권한을 상속한다. default SA에는 추가 권한을 부여하지 않는 것이 원칙이다.

</details>

---

**문제 4** (8분): CIS Benchmark를 실행하고 FAIL 항목 중 가장 위험한 3개를 식별하라. 각 항목의 수정 방법을 설명하라.

<details>
<summary>풀이 확인</summary>

#### 등장 배경과 기존 한계점

CIS(Center for Internet Security) Kubernetes Benchmark는 쿠버네티스 클러스터의 보안 설정을 자동으로 점검하는 표준이다. 수동으로 API 서버, etcd, kubelet 등의 수백 개 설정을 하나씩 확인하는 것은 비현실적이다. kube-bench는 CIS Benchmark를 자동화하는 도구로, 설정 파일과 프로세스 인수를 검사하여 PASS/FAIL/WARN을 판정한다.

```bash
# 1. kube-bench 실행 (마스터 노드에서)
ssh admin@<dev-master-ip> 'sudo kube-bench run --targets master 2>/dev/null' | head -80
```

```text
[INFO] 1 Control Plane Security Configuration
[INFO] 1.1 Control Plane Node Configuration Files
[PASS] 1.1.1 Ensure that the API server pod specification file permissions are set to 600 or more restrictive
[PASS] 1.1.2 Ensure that the API server pod specification file ownership is set to root:root
...
[FAIL] 1.2.6 Ensure that the --kubelet-certificate-authority argument is set
[FAIL] 1.2.18 Ensure that the --audit-log-path argument is set
[FAIL] 1.2.19 Ensure that the --audit-log-maxage argument is set
...
```

```bash
# 2. FAIL 항목만 추출
ssh admin@<dev-master-ip> 'sudo kube-bench run --targets master 2>/dev/null' | grep "\[FAIL\]"
```

```text
[FAIL] 1.2.6 Ensure that the --kubelet-certificate-authority argument is set
[FAIL] 1.2.16 Ensure that the admission control plugin PodSecurity is set
[FAIL] 1.2.18 Ensure that the --audit-log-path argument is set
[FAIL] 1.2.19 Ensure that the --audit-log-maxage argument is set
[FAIL] 1.2.20 Ensure that the --audit-log-maxbackup argument is set
[FAIL] 1.2.21 Ensure that the --audit-log-maxsize argument is set
...
```

**가장 위험한 3개 항목과 수정 방법:**

**1. CIS 1.2.6: --kubelet-certificate-authority 미설정**

위험: API 서버가 kubelet의 인증서를 검증하지 않으므로 MITM(중간자) 공격에 취약하다. 공격자가 kubelet을 가장하여 Pod 정보를 조작할 수 있다.

```yaml
# /etc/kubernetes/manifests/kube-apiserver.yaml
spec:
  containers:
  - command:
    - kube-apiserver
    - --kubelet-certificate-authority=/etc/kubernetes/pki/ca.crt
```

**2. CIS 1.2.16: PodSecurity Admission Plugin 미활성화**

위험: privileged 컨테이너, hostNetwork/hostPID 사용 등을 제한할 수 없다. 악성 워크로드가 무제한 권한으로 실행될 수 있다.

```yaml
    - --enable-admission-plugins=NodeRestriction,PodSecurity
```

**3. CIS 1.2.18: --audit-log-path 미설정**

위험: API 요청이 기록되지 않아 침해 사고 시 포렌식이 불가능하다. 누가 Secret을 읽었는지, 어떤 Pod가 삭제되었는지 추적할 수 없다.

```yaml
    - --audit-log-path=/var/log/kubernetes/audit/audit.log
    - --audit-policy-file=/etc/kubernetes/audit/policy.yaml
    - --audit-log-maxage=30
    - --audit-log-maxbackup=10
    - --audit-log-maxsize=100
```

```bash
# 3. 수정 후 재검증
ssh admin@<dev-master-ip> 'sudo kube-bench run --targets master --check 1.2.6,1.2.16,1.2.18 2>/dev/null'
```

```text
[PASS] 1.2.6 Ensure that the --kubelet-certificate-authority argument is set
[PASS] 1.2.16 Ensure that the admission control plugin PodSecurity is set
[PASS] 1.2.18 Ensure that the --audit-log-path argument is set
```

**트러블슈팅:**
- kube-apiserver.yaml 수정 후 API 서버가 재시작되지 않으면 `sudo crictl logs $(sudo crictl ps -a --name kube-apiserver -q | head -1)`로 에러를 확인한다.
- audit-log-path의 디렉토리가 hostPath로 마운트되지 않으면 API 서버가 로그 파일을 생성할 수 없어 시작에 실패한다.
- kube-bench가 설치되지 않은 경우: `docker run --pid=host -v /etc:/etc -v /var:/var aquasec/kube-bench:latest run --targets master`로 실행한다.

</details>
