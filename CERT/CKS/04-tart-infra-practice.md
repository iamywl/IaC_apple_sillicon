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

---

## 1. Cluster Setup (10%) 실습

### 실습 1.1: CiliumNetworkPolicy 전체 분석 [난이도: ★★☆]

**학습 목표:** dev 클러스터의 11개 CiliumNetworkPolicy를 분석하고 트래픽 흐름을 이해한다.

```bash
# 1. 전체 정책 목록
kubectl get ciliumnetworkpolicy -n demo
# 예상: 11개 정책

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

# 5. 정책 적용 상태 확인
kubectl get cnp -n demo -o jsonpath='{range .items[*]}{.metadata.name}: {.status.conditions[0].type}={.status.conditions[0].status}{"\n"}{end}'
```

**트래픽 흐름도:**
```
외부 → nginx-web(30080) → httpbin(GET only) → redis
                                              → postgres
keycloak(30880) ← 외부
rabbitmq ← 내부 only
DNS(53) ← 모든 Pod
```

**자기 점검:**
- [ ] Default Deny + Explicit Allow 패턴을 설명할 수 있는가?
- [ ] L7 규칙의 동작 원리를 설명할 수 있는가?
- [ ] CiliumNetworkPolicy와 표준 NetworkPolicy의 차이점은?

**관련 CKS 시험 주제:** NetworkPolicy를 사용한 클러스터 레벨 접근 제어

---

### 실습 1.2: NetworkPolicy 직접 작성 및 테스트 [난이도: ★★★]

**학습 목표:** 표준 K8s NetworkPolicy를 직접 작성하고 트래픽 제어를 검증한다.

```bash
# 1. 테스트 네임스페이스 생성
kubectl create ns netpol-lab

# 2. 테스트 워크로드 배포
kubectl run web --image=nginx:alpine --port=80 -n netpol-lab
kubectl run api --image=nginx:alpine --port=80 -n netpol-lab --labels="role=api"
kubectl run db --image=nginx:alpine --port=80 -n netpol-lab --labels="role=db"
kubectl run attacker --image=busybox:1.36 --restart=Never -n netpol-lab --labels="role=attacker" -- sleep 3600

kubectl wait --for=condition=ready pod --all -n netpol-lab --timeout=60s

# 3. 정책 적용 전 — 모든 통신 가능
kubectl exec attacker -n netpol-lab -- wget -qO- --timeout=3 http://web
kubectl exec attacker -n netpol-lab -- wget -qO- --timeout=3 http://api
kubectl exec attacker -n netpol-lab -- wget -qO- --timeout=3 http://db
# 모두 성공

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

# 5. 모든 통신 차단 확인
kubectl exec attacker -n netpol-lab -- wget -qO- --timeout=3 http://web 2>&1
# 예상: 타임아웃

# 6. 선택적 허용 — web → api (80) → db (80) 체인
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

# api → db 허용
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

# 7. 검증
# web → api (허용)
kubectl exec web -n netpol-lab -- wget -qO- --timeout=3 http://api
# 예상: 성공

# web → db (차단)
kubectl exec web -n netpol-lab -- wget -qO- --timeout=3 http://db 2>&1
# 예상: 타임아웃

# api → db (허용)
kubectl exec api -n netpol-lab -- wget -qO- --timeout=3 http://db
# 예상: 성공

# attacker → 모든 곳 (차단)
kubectl exec attacker -n netpol-lab -- wget -qO- --timeout=3 http://web 2>&1
# 예상: 타임아웃

# 정리
kubectl delete ns netpol-lab
```

**자기 점검:**
- [ ] 3-tier (web→api→db) 구조의 NetworkPolicy를 직접 작성할 수 있는가?
- [ ] Ingress/Egress 정책의 방향성을 정확히 이해하는가?
- [ ] namespaceSelector를 활용한 cross-namespace 정책을 작성할 수 있는가?

**관련 CKS 시험 주제:** NetworkPolicy 설계 및 구현

---

### 실습 1.3: CIS Kubernetes Benchmark 실행 [난이도: ★★★]

**학습 목표:** kube-bench로 CIS Benchmark를 실행하고 FAIL 항목을 수정한다.

```bash
# 1. kube-bench Job 배포
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

echo "=== Master Node Results ==="
kubectl logs job/kube-bench-master | grep -E "PASS|FAIL|WARN" | sort | uniq -c | sort -rn

echo "=== Worker Node Results ==="
kubectl logs job/kube-bench-worker | grep -E "PASS|FAIL|WARN" | sort | uniq -c | sort -rn

# 4. FAIL 항목 상세 확인
kubectl logs job/kube-bench-master | grep -B 1 -A 5 "\[FAIL\]"

# 5. 정리
kubectl delete job kube-bench-master kube-bench-worker
```

**자기 점검:**
- [ ] CIS Benchmark의 PASS/FAIL/WARN 의미를 설명할 수 있는가?
- [ ] FAIL 항목의 수정 절차를 알고 있는가?

**관련 CKS 시험 주제:** CIS Benchmark, kube-bench

---

### 실습 1.4: 바이너리 검증 [난이도: ★★☆]

**학습 목표:** Kubernetes 바이너리의 무결성을 검증한다.

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

# 5. 공식 릴리스와 비교
# K8s GitHub releases 페이지에서 해당 버전의 SHA512 체크섬 다운로드
# curl -LO https://dl.k8s.io/v1.XX.Y/kubernetes-server-linux-amd64.tar.gz.sha512
# 로컬 해시와 비교

# 6. containerd 바이너리 검증
ssh admin@<dev-master-ip> 'sha256sum /usr/bin/containerd'
ssh admin@<dev-master-ip> 'containerd --version'
```

**자기 점검:**
- [ ] 바이너리 검증의 보안 목적을 설명할 수 있는가?
- [ ] sha512sum으로 무결성을 확인하는 절차를 수행할 수 있는가?

**관련 CKS 시험 주제:** Verify platform binaries

---

### 실습 1.5: Ingress 보안 설정 [난이도: ★★★]

**학습 목표:** Ingress 리소스의 보안 설정을 확인하고 TLS를 적용한다.

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

# 4. 확인
kubectl describe ingress secure-ingress -n demo

# 정리
kubectl delete ingress secure-ingress -n demo
kubectl delete secret demo-tls -n demo
```

**자기 점검:**
- [ ] Ingress TLS 설정 방법을 알고 있는가?
- [ ] 자체 서명 인증서와 CA 서명 인증서의 차이를 설명할 수 있는가?

**관련 CKS 시험 주제:** Ingress Security, TLS

---

## 2. Cluster Hardening (15%) 실습

### 실습 2.1: RBAC 최소 권한 원칙 [난이도: ★★★]

**학습 목표:** RBAC을 분석하고 최소 권한 원칙에 맞게 Role을 설계한다.

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

# 5. 권한 검증
kubectl auth can-i get pods --as=system:serviceaccount:demo:dev-viewer -n demo
# 예상: yes

kubectl auth can-i create pods --as=system:serviceaccount:demo:dev-viewer -n demo
# 예상: no

kubectl auth can-i delete deployments --as=system:serviceaccount:demo:dev-viewer -n demo
# 예상: no

kubectl auth can-i get secrets --as=system:serviceaccount:demo:dev-viewer -n demo
# 예상: no

# 정리
kubectl delete role dev-pod-viewer -n demo
kubectl delete rolebinding dev-pod-viewer-binding -n demo
kubectl delete sa dev-viewer -n demo
```

**자기 점검:**
- [ ] Role과 ClusterRole을 적절히 선택할 수 있는가?
- [ ] pods/log, pods/exec 등 subresource에 대한 권한을 설정할 수 있는가?
- [ ] 특정 리소스 이름에 대한 접근만 허용하는 Rule을 작성할 수 있는가?

**관련 CKS 시험 주제:** RBAC, Least Privilege

---

### 실습 2.2: ServiceAccount 보안 강화 [난이도: ★★★]

**학습 목표:** ServiceAccount의 보안을 강화하고 토큰 관리를 이해한다.

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

# 5. 토큰으로 API 접근 테스트
kubectl exec $NGINX_POD -n demo -- sh -c '
TOKEN=$(cat /var/run/secrets/kubernetes.io/serviceaccount/token 2>/dev/null)
if [ -n "$TOKEN" ]; then
  curl -sk -H "Authorization: Bearer $TOKEN" \
    https://kubernetes.default.svc/api/v1/namespaces/demo/secrets
else
  echo "No token mounted"
fi
' 2>/dev/null

# 6. 보안 강화된 Pod 배포
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

# 토큰 마운트 확인
kubectl exec hardened-pod -n demo -- ls /var/run/secrets/ 2>/dev/null
# 예상: 디렉토리 없음

# 정리
kubectl delete pod hardened-pod -n demo
kubectl delete sa hardened-sa -n demo
```

**자기 점검:**
- [ ] ServiceAccount 토큰 자동 마운트를 비활성화할 수 있는가?
- [ ] Bound Service Account Token의 개념을 설명할 수 있는가?

**관련 CKS 시험 주제:** ServiceAccount Security

---

### 실습 2.3: API Server 보안 설정 감사 [난이도: ★★★]

**학습 목표:** kube-apiserver의 보안 설정을 감사하고 강화 방법을 이해한다.

```bash
# 1. API Server 매니페스트 전체 확인
ssh admin@<dev-master-ip> 'sudo cat /etc/kubernetes/manifests/kube-apiserver.yaml'

# 2. 보안 관련 플래그 추출
ssh admin@<dev-master-ip> 'sudo cat /etc/kubernetes/manifests/kube-apiserver.yaml' | grep -E -- \
  '--authorization-mode|--anonymous-auth|--enable-admission|--insecure-port|--profiling|--audit|--encryption|--kubelet-certificate|--tls-cipher'

# 체크리스트:
# [x] --authorization-mode=Node,RBAC
# [x] --anonymous-auth=false (또는 true → 강화 필요)
# [x] --enable-admission-plugins=NodeRestriction,...
# [x] --insecure-port=0
# [x] --profiling=false
# [ ] --audit-log-path 설정 여부
# [ ] --encryption-provider-config 설정 여부
# [x] --kubelet-certificate-authority

# 3. Admission Plugin 목록 확인
ssh admin@<dev-master-ip> 'sudo cat /etc/kubernetes/manifests/kube-apiserver.yaml' | grep enable-admission
# 권장 플러그인: NodeRestriction, PodSecurity, AlwaysPullImages

# 4. deprecated API 사용 확인
kubectl get --raw /metrics | grep apiserver_requested_deprecated_apis 2>/dev/null | head -5

# 5. 인증서 만료 확인
ssh admin@<dev-master-ip> 'sudo kubeadm certs check-expiration'
```

**자기 점검:**
- [ ] API Server의 핵심 보안 플래그 5개를 나열할 수 있는가?
- [ ] 각 Admission Controller의 역할을 설명할 수 있는가?

**관련 CKS 시험 주제:** API Server Configuration, Admission Controllers

---

### 실습 2.4: Kubernetes 업그레이드 보안 [난이도: ★★☆]

**학습 목표:** K8s 버전을 확인하고 보안 패치의 중요성을 이해한다.

```bash
# 1. 현재 버전 확인
kubectl version
kubectl get nodes -o jsonpath='{range .items[*]}{.metadata.name}: {.status.nodeInfo.kubeletVersion}{"\n"}{end}'

# 2. API 버전 확인
kubectl api-versions | sort

# 3. deprecated API 사용 여부
kubectl get --raw /metrics 2>/dev/null | grep deprecated | head -10

# 4. kubeadm 업그레이드 계획 확인
ssh admin@<dev-master-ip> 'sudo kubeadm upgrade plan 2>/dev/null'

# 5. CVE 관련 확인
# K8s 보안 게시판: https://kubernetes.io/docs/reference/issues-security/
# 현재 버전에 알려진 CVE 확인
```

**자기 점검:**
- [ ] K8s 버전 업그레이드 절차(drain → upgrade → uncordon)를 설명할 수 있는가?
- [ ] 보안 패치 적용의 중요성을 설명할 수 있는가?

**관련 CKS 시험 주제:** Kubernetes Version Security

---

### 실습 2.5: etcd 암호화 [난이도: ★★★]

**학습 목표:** etcd에 저장되는 Secret의 암호화 상태를 확인하고 설정 방법을 이해한다.

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

**자기 점검:**
- [ ] EncryptionConfiguration의 providers 순서가 중요한 이유를 설명할 수 있는가?
- [ ] aescbc, aesgcm, secretbox의 차이를 설명할 수 있는가?
- [ ] identity provider의 역할을 설명할 수 있는가?

**관련 CKS 시험 주제:** Encryption at Rest, etcd Security

---

## 3. System Hardening (15%) 실습

### 실습 3.1: AppArmor 프로파일 적용 [난이도: ★★★]

**학습 목표:** AppArmor 프로파일을 생성하고 Pod에 적용한다.

```bash
# 1. AppArmor 상태 확인
ssh admin@<dev-worker-ip> 'sudo aa-status'
# AppArmor 모듈 로드 여부 확인

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

# 4. 프로파일 확인
ssh admin@<dev-worker-ip> 'sudo aa-status | grep k8s-deny-write'

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

# 6. AppArmor 동작 확인
# 파일 읽기 (허용)
kubectl exec apparmor-test -n demo -- cat /etc/hostname
# 예상: 성공

# /etc에 쓰기 (차단)
kubectl exec apparmor-test -n demo -- sh -c 'echo test > /etc/test' 2>&1
# 예상: Permission denied

# 7. 정리
kubectl delete pod apparmor-test -n demo
```

**자기 점검:**
- [ ] AppArmor 프로파일의 enforce/complain 모드 차이를 설명할 수 있는가?
- [ ] Pod에 AppArmor 프로파일을 적용하는 방법을 알고 있는가?

**관련 CKS 시험 주제:** AppArmor, Linux Security Modules

---

### 실습 3.2: seccomp 프로파일 적용 [난이도: ★★★]

**학습 목표:** seccomp 프로파일을 이해하고 Pod에 적용한다.

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

# 3. seccomp 상태 확인
kubectl get pod seccomp-runtime -n demo -o jsonpath='{.spec.securityContext.seccompProfile}'
# {"type":"RuntimeDefault"}

kubectl get pod seccomp-unconfined -n demo -o jsonpath='{.spec.securityContext.seccompProfile}'
# {"type":"Unconfined"}

# 4. 시스템 콜 테스트
# RuntimeDefault에서 차단되는 시스템 콜 테스트
kubectl exec seccomp-runtime -n demo -- unshare --user 2>&1
# 예상: Operation not permitted (RuntimeDefault가 unshare 차단)

# 5. 커스텀 seccomp 프로파일 (참고)
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

**자기 점검:**
- [ ] RuntimeDefault, Unconfined, Localhost 프로파일의 차이를 설명할 수 있는가?
- [ ] 커스텀 seccomp 프로파일을 작성할 수 있는가?

**관련 CKS 시험 주제:** seccomp, System Call Filtering

---

### 실습 3.3: OS 레벨 보안 점검 [난이도: ★★☆]

**학습 목표:** Worker 노드의 OS 보안 설정을 점검한다.

```bash
# 1. 불필요한 서비스 확인
ssh admin@<dev-worker-ip> 'systemctl list-unit-files --state=enabled | grep -v "@"'

# 2. 열린 포트 확인
ssh admin@<dev-worker-ip> 'ss -tlnp'
# 필요한 포트만 열려 있어야 함:
# 10250 (kubelet), 30000-32767 (NodePort range)

# 3. 불필요한 패키지 확인
ssh admin@<dev-worker-ip> 'dpkg -l | wc -l'

# 4. 사용자 계정 확인
ssh admin@<dev-worker-ip> 'cat /etc/passwd | grep -v nologin | grep -v false'
# 불필요한 로그인 가능 계정이 없어야 함

# 5. SSH 설정 확인
ssh admin@<dev-worker-ip> 'cat /etc/ssh/sshd_config | grep -E "PermitRootLogin|PasswordAuthentication|X11Forwarding"'
# PermitRootLogin no
# PasswordAuthentication no (키 기반 인증만)

# 6. 파일 시스템 권한 확인
ssh admin@<dev-worker-ip> 'ls -la /etc/kubernetes/'
ssh admin@<dev-worker-ip> 'ls -la /var/lib/kubelet/'

# 7. 커널 파라미터 확인
ssh admin@<dev-worker-ip> 'sysctl net.ipv4.ip_forward'
# 1이어야 함 (K8s 네트워킹 필수)
ssh admin@<dev-worker-ip> 'sysctl kernel.panic'
ssh admin@<dev-worker-ip> 'sysctl kernel.panic_on_oops'
```

**자기 점검:**
- [ ] Worker 노드에서 불필요한 서비스를 식별할 수 있는가?
- [ ] SSH 보안 설정의 best practice를 알고 있는가?

**관련 CKS 시험 주제:** OS Security, Host Hardening

---

### 실습 3.4: 네트워크 레벨 보안 [난이도: ★★☆]

**학습 목표:** 호스트 네트워크와 Pod 네트워크의 보안을 점검한다.

```bash
# 1. hostNetwork 사용 Pod 확인
kubectl get pods -A -o jsonpath='{range .items[*]}{.metadata.namespace}/{.metadata.name}: hostNetwork={.spec.hostNetwork}{"\n"}{end}' | grep "true"
# hostNetwork=true인 Pod는 호스트의 네트워크 스택을 공유 → 보안 위험

# 2. hostPort 사용 확인
kubectl get pods -A -o jsonpath='{range .items[*]}{.metadata.namespace}/{.metadata.name}: hostPort={.spec.containers[*].ports[*].hostPort}{"\n"}{end}' | grep -v "hostPort=$"

# 3. hostPID 사용 확인
kubectl get pods -A -o jsonpath='{range .items[*]}{.metadata.namespace}/{.metadata.name}: hostPID={.spec.hostPID}{"\n"}{end}' | grep "true"

# 4. Pod의 네트워크 격리 확인
NGINX_POD=$(kubectl get pods -n demo -l app=nginx-web -o jsonpath='{.items[0].metadata.name}')
kubectl exec $NGINX_POD -n demo -- ip addr
# eth0: Pod 네트워크 인터페이스 (호스트와 격리)

# 5. Cilium 상태 확인
kubectl get pods -n kube-system -l k8s-app=cilium
kubectl exec -n kube-system $(kubectl get pods -n kube-system -l k8s-app=cilium -o jsonpath='{.items[0].metadata.name}') -- cilium status
```

**자기 점검:**
- [ ] hostNetwork, hostPort, hostPID의 보안 위험을 설명할 수 있는가?
- [ ] Pod 네트워크 격리의 원리를 설명할 수 있는가?

**관련 CKS 시험 주제:** Network Security, Pod Network Isolation

---

## 4. Minimize Microservice Vulnerabilities (20%) 실습

### 실습 4.1: Pod Security Admission 실습 [난이도: ★★★]

**학습 목표:** Pod Security Standards의 3개 레벨을 테스트하고 적용한다.

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
# 예상: 생성 성공

# 2. baseline 레벨 네임스페이스
kubectl create ns psa-baseline
kubectl label ns psa-baseline \
  pod-security.kubernetes.io/enforce=baseline \
  pod-security.kubernetes.io/warn=baseline

# privileged Pod (거부)
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
# 예상: Error — violations

# hostNetwork Pod (거부)
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
# 예상: Error — violations

# baseline 준수 Pod (허용)
kubectl run baseline-ok --image=busybox:1.36 -n psa-baseline -- sleep 3600
# 예상: 생성 성공

# 3. restricted 레벨 네임스페이스
kubectl create ns psa-restricted
kubectl label ns psa-restricted \
  pod-security.kubernetes.io/enforce=restricted \
  pod-security.kubernetes.io/warn=restricted

# 일반 Pod (거부 — runAsNonRoot 등 미설정)
kubectl run test --image=nginx -n psa-restricted 2>&1
# 예상: Error 또는 Warning

# restricted 준수 Pod (허용)
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
# 예상: 생성 성공

# 정리
kubectl delete ns psa-privileged psa-baseline psa-restricted
```

**자기 점검:**
- [ ] 3개 레벨의 위반 조건을 5개 이상 나열할 수 있는가?
- [ ] enforce, warn, audit 모드의 차이를 설명할 수 있는가?

**관련 CKS 시험 주제:** Pod Security Standards, Pod Security Admission

---

### 실습 4.2: SecurityContext 심층 실습 [난이도: ★★★]

**학습 목표:** SecurityContext의 모든 옵션을 이해하고 적용한다.

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
        # procMount: Default (기본값)
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

# 3. 보안 설정 검증
# 사용자 확인
kubectl exec max-security -n demo -- id
# uid=65534(nobody) gid=65534(nogroup)

# 파일시스템 읽기 전용 확인
kubectl exec max-security -n demo -- sh -c 'echo test > /etc/test' 2>&1
# 예상: Read-only file system

# /tmp 쓰기 (emptyDir이므로 가능)
kubectl exec max-security -n demo -- sh -c 'echo test > /tmp/test && cat /tmp/test'
# 예상: test

# capabilities 확인
kubectl exec max-security -n demo -- cat /proc/1/status | grep -i cap
# CapBnd: 0000000000000000 (모든 capabilities 제거)

# 4. 위험한 capabilities 테스트
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: v1
kind: Pod
metadata:
  name: cap-test
spec:
  containers:
    - name: app
      image: busybox:1.36
      command: ["sleep", "3600"]
      securityContext:
        capabilities:
          add: ["NET_ADMIN", "SYS_TIME"]
          drop: ["ALL"]
EOF

kubectl exec cap-test -n demo -- cat /proc/1/status | grep -i cap
# NET_ADMIN, SYS_TIME만 활성화

# 정리
kubectl delete pod max-security cap-test -n demo
```

**capabilities 위험도 분류:**

| capability | 위험도 | 설명 |
|-----------|--------|------|
| SYS_ADMIN | 최고 | 거의 root 수준 |
| NET_ADMIN | 고 | 네트워크 설정 변경 |
| SYS_PTRACE | 고 | 다른 프로세스 추적 |
| NET_RAW | 중 | raw 소켓 생성 |
| SYS_TIME | 저 | 시스템 시간 변경 |

**자기 점검:**
- [ ] drop: ["ALL"] + 필요한 capability만 add 패턴을 사용할 수 있는가?
- [ ] readOnlyRootFilesystem 적용 시 writable 경로 설정 방법을 알고 있는가?

**관련 CKS 시험 주제:** SecurityContext, Container Security

---

### 실습 4.3: mTLS 및 서비스 메시 보안 [난이도: ★★★]

**학습 목표:** Istio mTLS의 동작을 검증하고 보안 설정을 분석한다.

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

# 4. mTLS STRICT에서 비-mesh 클라이언트 차단 확인
kubectl create ns no-mesh-test
kubectl run curl --image=curlimages/curl --restart=Never -n no-mesh-test -- \
  sh -c 'curl -s --connect-timeout 5 http://httpbin.demo.svc:8080/get; echo "exit: $?"'
sleep 10
kubectl logs curl -n no-mesh-test
# 예상: connection refused 또는 reset (mTLS 인증서 없으므로)

# 5. AuthorizationPolicy 확인 (있는 경우)
kubectl get authorizationpolicy -n demo -o yaml 2>/dev/null

# 6. Istio 보안 메트릭 확인
kubectl exec $NGINX_POD -c istio-proxy -n demo -- \
  curl -s localhost:15000/stats | grep -E "ssl|tls|auth" | head -10

# 정리
kubectl delete ns no-mesh-test
```

**자기 점검:**
- [ ] STRICT/PERMISSIVE/DISABLE 모드의 차이를 설명할 수 있는가?
- [ ] AuthorizationPolicy로 L7 접근 제어를 구현할 수 있는가?

**관련 CKS 시험 주제:** Service Mesh Security, mTLS

---

### 실습 4.4: Secret 보안 강화 [난이도: ★★☆]

**학습 목표:** Secret의 보안 취약점을 분석하고 강화 방법을 실습한다.

```bash
# 1. 현재 Secret 목록
kubectl get secret -n demo -o custom-columns='NAME:.metadata.name,TYPE:.type'

# 2. base64 디코딩 (Secret은 암호화가 아님!)
kubectl get secret -n demo -o jsonpath='{range .items[*]}{.metadata.name}: {.data}{"\n"}{end}' 2>/dev/null | head -10

# postgres Secret
kubectl get secret -n demo -l app=postgres -o jsonpath='{.items[0].data.POSTGRES_PASSWORD}' | base64 -d
# 예상: demo123

# 3. Secret Volume Mount vs 환경변수 비교
# 환경변수 방식 (보안 약함 — /proc/<pid>/environ에서 읽을 수 있음)
kubectl get pods -n demo -o jsonpath='{range .items[*]}{.metadata.name}: env={.spec.containers[0].env[*].valueFrom.secretKeyRef.name}{"\n"}{end}' | grep -v "=$"

# Volume 방식 (상대적으로 안전)
kubectl get pods -n demo -o jsonpath='{range .items[*]}{.metadata.name}: volumes={.spec.volumes[*].secret.secretName}{"\n"}{end}' | grep -v "=$"

# 4. RBAC으로 Secret 접근 제한 확인
kubectl auth can-i get secrets --as=system:serviceaccount:demo:default -n demo
# no여야 안전

# 5. Secret을 immutable로 설정
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

# 변경 시도 (실패해야 함)
kubectl patch secret immutable-secret -n demo --type='json' -p='[{"op":"replace","path":"/data/api-key","value":"bmV3LXZhbHVl"}]' 2>&1
# 예상: Error — immutable field

# 정리
kubectl delete secret immutable-secret -n demo
```

**자기 점검:**
- [ ] Secret immutable 설정의 장점을 설명할 수 있는가?
- [ ] Volume mount vs 환경변수 방식의 보안 차이를 설명할 수 있는가?

**관련 CKS 시험 주제:** Secret Management, Data Protection

---

### 실습 4.5: OPA Gatekeeper 정책 엔진 [난이도: ★★★]

**학습 목표:** OPA Gatekeeper를 설치하고 보안 정책을 적용한다.

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

# 4. 테스트
kubectl create ns gatekeeper-test

# latest 태그 (거부)
kubectl run test --image=nginx:latest -n gatekeeper-test 2>&1
# 예상: denied

# 태그 없음 (거부)
kubectl run test2 --image=nginx -n gatekeeper-test 2>&1
# 예상: denied

# 구체적 태그 (허용)
kubectl run test3 --image=nginx:1.25-alpine -n gatekeeper-test 2>&1
# 예상: 성공

# 5. ConstraintTemplate — 리소스 제한 필수
cat <<'EOF' | kubectl apply -f -
apiVersion: templates.gatekeeper.sh/v1
kind: ConstraintTemplate
metadata:
  name: k8srequiredresources
spec:
  crd:
    spec:
      names:
        kind: K8sRequiredResources
  targets:
    - target: admission.k8s.gatekeeper.sh
      rego: |
        package k8srequiredresources
        violation[{"msg": msg}] {
          container := input.review.object.spec.containers[_]
          not container.resources.limits
          msg := sprintf("container <%v> has no resource limits", [container.name])
        }
        violation[{"msg": msg}] {
          container := input.review.object.spec.containers[_]
          not container.resources.requests
          msg := sprintf("container <%v> has no resource requests", [container.name])
        }
EOF

cat <<'EOF' | kubectl apply -f -
apiVersion: constraints.gatekeeper.sh/v1beta1
kind: K8sRequiredResources
metadata:
  name: require-resources
spec:
  match:
    kinds:
      - apiGroups: [""]
        kinds: ["Pod"]
    namespaces: ["gatekeeper-test"]
EOF

# 리소스 없는 Pod (거부)
kubectl run no-resources --image=nginx:1.25 -n gatekeeper-test 2>&1
# 예상: denied

# 정리
kubectl delete ns gatekeeper-test
kubectl delete k8sdisallowedtags no-latest-tag
kubectl delete k8srequiredresources require-resources
kubectl delete constrainttemplate k8sdisallowedtags k8srequiredresources
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

```bash
# 1. Trivy 설치 확인
trivy --version 2>/dev/null || echo "Trivy not installed"
# 설치: brew install trivy (macOS) 또는 apt install trivy

# 2. demo 앱 이미지 스캔
# nginx
trivy image nginx:alpine
trivy image --severity CRITICAL,HIGH nginx:alpine

# postgres
trivy image postgres:16-alpine
trivy image --severity CRITICAL postgres:16-alpine

# redis
trivy image redis:7-alpine

# keycloak
trivy image quay.io/keycloak/keycloak

# 3. 결과를 JSON으로 저장
trivy image --format json --output /tmp/nginx-scan.json nginx:alpine

# 4. CVE 세부 정보 확인
trivy image --severity CRITICAL nginx:alpine 2>/dev/null | grep -E "CVE-|Total:"

# 5. 특정 CVE 무시 (정상 의도적 허용)
cat <<'EOF' > /tmp/.trivyignore
CVE-2023-XXXXX
CVE-2024-YYYYY
EOF
trivy image --ignorefile /tmp/.trivyignore nginx:alpine

# 6. Trivy를 K8s 내에서 실행 (CronJob)
cat <<'EOF'
apiVersion: batch/v1
kind: CronJob
metadata:
  name: image-scan
spec:
  schedule: "0 2 * * *"
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: trivy
              image: aquasec/trivy:latest
              command: ["trivy", "image", "--severity", "CRITICAL,HIGH", "nginx:alpine"]
          restartPolicy: Never
EOF
```

**자기 점검:**
- [ ] Trivy의 스캔 대상(image, filesystem, config)을 구분할 수 있는가?
- [ ] CRITICAL 취약점이 발견되었을 때 대응 절차를 설명할 수 있는가?

**관련 CKS 시험 주제:** Image Vulnerability Scanning

---

### 실습 5.2: 이미지 정책 및 보안 [난이도: ★★★]

**학습 목표:** 이미지 보안 정책을 수립하고 적용한다.

```bash
# 1. 현재 사용 중인 이미지 분석
echo "=== 이미지 목록 ==="
kubectl get pods -n demo -o jsonpath='{range .items[*]}{.spec.containers[*].image}{"\n"}{end}' | sort -u

echo "=== ImagePullPolicy ==="
kubectl get pods -n demo -o jsonpath='{range .items[*]}{.metadata.name}: {.spec.containers[0].imagePullPolicy}{"\n"}{end}'

# 2. 이미지 다이제스트 확인
kubectl get pods -n demo -o jsonpath='{range .items[*]}{.metadata.name}: imageID={.status.containerStatuses[0].imageID}{"\n"}{end}'
# imageID에 sha256 다이제스트가 포함됨

# 3. 태그 vs 다이제스트 사용
# 위험: nginx:alpine → 같은 태그에 다른 이미지가 push될 수 있음
# 안전: nginx@sha256:abc123... → 정확한 이미지 지정

# 다이제스트 확인 방법
# docker pull nginx:alpine
# docker inspect nginx:alpine | jq '.[0].RepoDigests'

# 4. AlwaysPullImages Admission Controller 확인
ssh admin@<dev-master-ip> 'sudo cat /etc/kubernetes/manifests/kube-apiserver.yaml' | grep AlwaysPullImages
# 활성화 시 모든 Pod가 항상 레지스트리에서 이미지를 pull

# 5. Private Registry 인증 확인
kubectl get secret -n demo -o jsonpath='{range .items[*]}{.metadata.name}: {.type}{"\n"}{end}' | grep docker
# kubernetes.io/dockerconfigjson 타입 Secret

# 6. 이미지 서명 (cosign) — 참고
# cosign sign --key cosign.key docker.io/myrepo/myimage:v1
# cosign verify --key cosign.pub docker.io/myrepo/myimage:v1
```

**이미지 보안 체크리스트:**

| 항목 | 권장 | 현재 |
|------|------|------|
| 태그 대신 다이제스트 사용 | sha256:... | 태그 사용 |
| alpine 기반 이미지 | 최소 이미지 | ✅ |
| root가 아닌 사용자 | USER non-root | 부분 |
| AlwaysPullImages | 활성화 | 확인 필요 |
| 이미지 서명 | cosign/notary | 미적용 |
| 취약점 스캔 | CI/CD에서 자동 | 수동 |

**자기 점검:**
- [ ] ImagePolicyWebhook의 역할을 설명할 수 있는가?
- [ ] 이미지 서명 검증의 원리를 설명할 수 있는가?

**관련 CKS 시험 주제:** Image Policy, Supply Chain Security

---

### 실습 5.3: Dockerfile 보안 분석 [난이도: ★★☆]

**학습 목표:** Dockerfile의 보안 best practice를 이해하고 분석한다.

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

# 문제점:
# - FROM ubuntu:latest → 크고 취약점 많음
# - latest 태그 → 재현 불가능
# - apt-get install → 불필요한 패키지
# - ENV DB_PASSWORD → 민감정보 하드코딩
# - root 사용자로 실행

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

# 개선점:
# - Multi-stage build → 최소 이미지
# - scratch 베이스 → 공격 표면 최소화
# - 특정 버전 태그 사용
# - USER non-root
# - 민감정보 없음

# 3. Trivy로 Dockerfile 보안 분석
# trivy config /tmp/Dockerfile.insecure
# trivy config /tmp/Dockerfile.secure

# 4. demo 앱 이미지 분석
# 각 이미지의 레이어 수 확인
for img in nginx:alpine redis:7-alpine postgres:16-alpine; do
  echo "=== $img ==="
  # docker inspect $img | jq '.[0].RootFS.Layers | length'
  trivy image --severity CRITICAL $img 2>/dev/null | tail -5
done

# 정리
rm -f /tmp/Dockerfile.insecure /tmp/Dockerfile.secure
```

**자기 점검:**
- [ ] Multi-stage build의 보안 이점을 설명할 수 있는가?
- [ ] scratch vs alpine vs distroless 이미지의 차이를 설명할 수 있는가?

**관련 CKS 시험 주제:** Dockerfile Security, Image Hardening

---

### 실습 5.4: 허용된 레지스트리 정책 [난이도: ★★★]

**학습 목표:** 특정 레지스트리의 이미지만 허용하는 정책을 구현한다.

```bash
# 1. 현재 사용 중인 레지스트리 확인
kubectl get pods -n demo -o jsonpath='{range .items[*]}{.spec.containers[*].image}{"\n"}{end}' | sort -u | sed 's|/.*||' | sort -u
# docker.io, quay.io, gcr.io 등

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

# 3. 테스트
kubectl create ns registry-test

# 허용된 이미지 (성공)
kubectl run ok --image=nginx:alpine -n registry-test 2>&1

# 비허용 이미지 (거부)
kubectl run blocked --image=some-unknown-registry.io/app:v1 -n registry-test 2>&1
# 예상: denied

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

# 3. Audit Log 레벨 설명
# None — 로깅하지 않음
# Metadata — who, what, when, outcome (본문 없음)
# Request — Metadata + 요청 본문
# RequestResponse — Metadata + 요청 + 응답 본문

# 4. API Server에 Audit 설정 추가 (참고)
# /etc/kubernetes/manifests/kube-apiserver.yaml에 추가:
# --audit-log-path=/var/log/kubernetes/audit/audit.log
# --audit-log-maxage=30
# --audit-log-maxbackup=10
# --audit-log-maxsize=100
# --audit-policy-file=/etc/kubernetes/audit-policy.yaml

# 5. Audit Log 분석 (설정된 경우)
ssh admin@<dev-master-ip> 'sudo cat /var/log/kubernetes/audit/audit.log 2>/dev/null | tail -1 | jq .'
# 필드: requestURI, verb, user, sourceIP, objectRef, responseStatus

# 6. 보안 이벤트 필터링
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

# 3. 기본 Falco 규칙 확인
kubectl get configmap falco-rules -n falco -o yaml | grep "rule:" | head -20

# 4. 의심스러운 활동 시뮬레이션

# 4-1. 컨테이너 내 셸 실행
NGINX_POD=$(kubectl get pods -n demo -l app=nginx-web -o jsonpath='{.items[0].metadata.name}')
kubectl exec -it $NGINX_POD -n demo -- /bin/sh -c 'whoami; exit'

# 4-2. 민감 파일 읽기
kubectl exec $NGINX_POD -n demo -- cat /etc/shadow 2>/dev/null

# 4-3. 패키지 관리자 실행
kubectl exec $NGINX_POD -n demo -- apk add --no-cache curl 2>/dev/null

# 4-4. 네트워크 도구 실행
kubectl exec $NGINX_POD -n demo -- wget -q http://example.com 2>/dev/null

# 4-5. /etc 하위 파일 수정 시도
kubectl exec $NGINX_POD -n demo -- sh -c 'echo "test" >> /etc/hosts' 2>/dev/null

# 5. Falco 로그 확인
kubectl logs -l app.kubernetes.io/name=falco -n falco --tail=30 | grep -E "Warning|Error|Critical"

# 6. 커스텀 Falco 규칙 추가 (참고)
cat <<'EOF'
customRules:
  custom-rules.yaml: |
    - rule: Detect kubectl exec
      desc: Detect any kubectl exec into a container
      condition: >
        spawned_process and container and
        proc.name in (sh, bash, ash) and
        proc.pname = runc
      output: >
        Shell spawned in container
        (user=%user.name container=%container.name image=%container.image.repository)
      priority: WARNING
EOF

# 정리 (선택)
# helm uninstall falco -n falco
# kubectl delete ns falco
```

**Falco 탐지 규칙 매트릭스:**

| 규칙 | 심각도 | 시뮬레이션 |
|------|--------|----------|
| Terminal shell in container | WARNING | kubectl exec -- sh |
| Read sensitive file | WARNING | cat /etc/shadow |
| Launch package management | ERROR | apk add, apt install |
| Write below /etc | WARNING | echo >> /etc/hosts |
| Outbound connection | NOTICE | wget http://... |
| Contact K8s API Server | NOTICE | curl https://kubernetes.default |

**자기 점검:**
- [ ] Falco의 동작 원리(syscall 감시)를 설명할 수 있는가?
- [ ] 커스텀 Falco 규칙을 작성할 수 있는가?
- [ ] Falco 알림을 외부 시스템(Slack, PagerDuty)으로 전송하는 방법을 알고 있는가?

**관련 CKS 시험 주제:** Runtime Security, Behavioral Detection, Falco

---

### 실습 6.3: 컨테이너 불변성 (Immutability) [난이도: ★★☆]

**학습 목표:** 컨테이너 불변성을 적용하고 검증한다.

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

# 2. 불변성 테스트
# 루트 파일시스템 쓰기 (실패)
kubectl exec immutable-test -n demo -- sh -c 'echo test > /etc/test' 2>&1
# 예상: Read-only file system

# /tmp 쓰기 (성공 — emptyDir)
kubectl exec immutable-test -n demo -- sh -c 'echo test > /tmp/test && cat /tmp/test'
# 예상: test

# nginx 설정 변경 시도 (실패)
kubectl exec immutable-test -n demo -- sh -c 'echo "# modified" >> /etc/nginx/nginx.conf' 2>&1
# 예상: Read-only file system

# 3. 기존 demo 앱의 불변성 확인
kubectl get pods -n demo -o jsonpath='{range .items[*]}{.metadata.name}: readOnlyFS={.spec.containers[0].securityContext.readOnlyRootFilesystem}{"\n"}{end}'

# 4. startupProbe와 함께 사용 (nginx는 시작 시 임시 파일 필요)
kubectl describe pod immutable-test -n demo | grep -A 5 "State"

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
# 8개 AlertRule

# 2. 보안 관련 Alert 확인
kubectl get prometheusrule -n monitoring -o yaml | grep -B 2 -A 15 "alert:"

# 주요 보안 관련 Alert:
# PodCrashLooping — 반복 크래시 (침입 시도 가능)
# PodOOMKilled — 메모리 초과 (DoS)
# HighCPUUsage — CPU 과사용 (크립토마이닝)
# NodeNotReady — 노드 장애

# 3. Grafana 대시보드 확인
# 브라우저: http://<platform-node-ip>:30300
# Kubernetes Security 관련 대시보드:
# - Kubernetes / Compute Resources / Pod
# - Node Exporter / Nodes
# - Kubernetes / Networking

# 4. 보안 메트릭 PromQL 쿼리 (Prometheus UI에서)
# Pod 재시작 횟수 (비정상 활동 지표)
# kube_pod_container_status_restarts_total{namespace="demo"} > 3

# 인증 실패 (API Server)
# apiserver_authentication_attempts{result="failure"}

# 403 응답 (권한 거부)
# apiserver_request_total{code="403"}

# 5. Loki 로그 쿼리 (Grafana에서)
# {namespace="demo"} |= "error"
# {namespace="demo"} |= "denied"
# {namespace="kube-system", container="cilium-agent"} |= "Policy denied"

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

```bash
# 1. strace로 시스템 콜 추적 (Worker 노드에서)
ssh admin@<dev-worker-ip> 'sudo crictl ps | head -5'
# 컨테이너 ID 확인

# 특정 컨테이너의 PID 확인
ssh admin@<dev-worker-ip> 'sudo crictl inspect <container-id> | jq .info.pid'

# strace로 시스템 콜 추적 (참고)
# ssh admin@<dev-worker-ip> 'sudo strace -p <pid> -c -t 10'

# 2. /proc 파일시스템으로 프로세스 정보 확인
NGINX_POD=$(kubectl get pods -n demo -l app=nginx-web -o jsonpath='{.items[0].metadata.name}')

# 프로세스 목록
kubectl exec $NGINX_POD -n demo -- ps aux

# 프로세스 capabilities
kubectl exec $NGINX_POD -n demo -- cat /proc/1/status | grep -i cap

# 프로세스 네임스페이스
kubectl exec $NGINX_POD -n demo -- ls -la /proc/1/ns/

# 3. 열린 파일 디스크립터 확인
kubectl exec $NGINX_POD -n demo -- ls /proc/1/fd/ 2>/dev/null | wc -l

# 4. 네트워크 연결 확인
kubectl exec $NGINX_POD -n demo -- cat /proc/net/tcp 2>/dev/null | head -5
kubectl exec $NGINX_POD -n demo -- cat /proc/net/tcp6 2>/dev/null | head -5
```

**자기 점검:**
- [ ] 시스템 콜 모니터링의 보안 목적을 설명할 수 있는가?
- [ ] seccomp과 strace의 관계를 설명할 수 있는가?

**관련 CKS 시험 주제:** System Call Monitoring, Runtime Security

---

## 모의 시험 시나리오

### 모의 시험 1: 클러스터 보안 강화 (30분)

**문제 1** (5분): demo 네임스페이스에 default-deny NetworkPolicy를 적용하라. (표준 K8s NetworkPolicy 사용)

**문제 2** (7분): `secure-ns` 네임스페이스를 생성하고 Pod Security Standards restricted 레벨을 적용하라. restricted를 준수하는 nginx Pod를 배포하라.

**문제 3** (8분): `dev-readonly` ServiceAccount를 생성하고, demo 네임스페이스에서 pods, services, configmaps를 get/list만 할 수 있는 Role과 RoleBinding을 생성하라.

**문제 4** (5분): 현재 클러스터에서 privileged 컨테이너로 실행 중인 Pod를 모두 찾아라.

**문제 5** (5분): kube-apiserver의 --anonymous-auth 설정을 확인하고, audit-log-path 설정 여부를 확인하라.

---

### 모의 시험 2: 런타임 보안 (35분)

**문제 1** (8분): `immutable-nginx`라는 이름의 Pod를 생성하라. 조건:
- nginx:1.25-alpine 이미지
- readOnlyRootFilesystem: true
- runAsNonRoot: true, runAsUser: 101
- capabilities drop ALL
- /var/cache/nginx, /var/run, /tmp에 emptyDir 마운트

**문제 2** (7분): demo 네임스페이스의 모든 Pod에서 사용 중인 이미지를 나열하고, 각 이미지의 CRITICAL 취약점 수를 확인하라. (Trivy 사용)

**문제 3** (10분): OPA Gatekeeper ConstraintTemplate을 작성하라. 조건:
- 모든 Pod에 `security-scan: passed` 라벨이 필수
- `security-test` 네임스페이스에만 적용

**문제 4** (5분): nginx-web Pod에서 httpbin으로 POST 요청이 차단되는지 확인하라. 어떤 NetworkPolicy가 차단하는지 식별하라.

**문제 5** (5분): etcd에서 Secret이 평문으로 저장되어 있는지 확인하라.

---

### 모의 시험 3: 공급망 및 감사 (40분)

**문제 1** (10분): Audit Policy를 작성하라. 조건:
- secrets에 대한 모든 접근: RequestResponse 레벨
- pods 생성/삭제: Request 레벨
- configmaps 읽기: Metadata 레벨
- 나머지: None

**문제 2** (8분): `hardened-app` Deployment를 작성하라. 조건:
- busybox:1.36 이미지, replica 2
- automountServiceAccountToken: false
- seccompProfile: RuntimeDefault
- 모든 SecurityContext 강화 적용
- Resource requests/limits 설정

**문제 3** (7분): demo 네임스페이스의 ServiceAccount 중 과도한 권한을 가진 것을 식별하라. auth can-i를 사용하여 각 SA의 secret 접근 권한을 확인하라.

**문제 4** (8분): CIS Benchmark를 실행하고 FAIL 항목 중 가장 위험한 3개를 식별하라. 각 항목의 수정 방법을 설명하라.

**문제 5** (7분): 컨테이너에서 의심스러운 활동을 시뮬레이션하고 Falco 로그에서 해당 이벤트를 확인하라. (셸 실행, /etc/shadow 읽기, 패키지 설치)

---

### 모의 시험 4: 네트워크 및 인증 보안 (35분)

**문제 1** (10분): 3-tier NetworkPolicy를 구현하라.
- frontend → backend(8080) 허용
- backend → database(5432) 허용
- 다른 모든 통신 차단

**문제 2** (8분): Istio mTLS STRICT 모드가 동작하는지 검증하라. 비-mesh Pod에서 demo 서비스 접근이 차단되는지 확인하라.

**문제 3** (7분): API Server의 인증서 만료일을 확인하고, 인증서 갱신 절차를 설명하라.

**문제 4** (5분): etcd의 TLS 설정을 확인하라. client-cert-auth가 활성화되어 있는지 확인하라.

**문제 5** (5분): kubelet의 anonymous-auth와 readOnlyPort 설정을 확인하고, 보안 권장 값과 비교하라.

---

### 모의 시험 5: 종합 보안 시나리오 (45분)

**시나리오:** demo 네임스페이스에서 보안 침해가 의심된다. 다음 단계를 수행하라.

1. (5분) 모든 Pod의 상태와 최근 이벤트를 확인하라.
2. (5분) nginx-web Pod의 프로세스와 네트워크 연결을 확인하라.
3. (7분) NetworkPolicy로 nginx-web을 즉시 격리하라 (모든 ingress/egress 차단).
4. (5분) 격리된 Pod의 로그를 수집하고 보존하라.
5. (8분) 새로운 보안 강화 Deployment로 nginx-web을 교체하라 (모든 SecurityContext 강화).
6. (5분) 교체된 Pod가 정상 동작하는지 확인하라.
7. (5분) RBAC을 점검하여 불필요한 권한을 제거하라.
8. (5분) 사후 분석 보고서 작성을 위한 정보를 수집하라.

---

## CKS 보안 강화 체크리스트

### Cluster Setup (10%)

| 항목 | 설명 | 완료 |
|------|------|------|
| NetworkPolicy | Default Deny + Explicit Allow | [ ] |
| CIS Benchmark | kube-bench 실행 및 분석 | [ ] |
| 바이너리 검증 | kubelet/kubectl SHA 확인 | [ ] |
| Ingress TLS | TLS 인증서 적용 | [ ] |

### Cluster Hardening (15%)

| 항목 | 설명 | 완료 |
|------|------|------|
| RBAC | 최소 권한 Role 설계 | [ ] |
| ServiceAccount | automountServiceAccountToken: false | [ ] |
| API Server | 보안 플래그 확인 | [ ] |
| etcd 암호화 | EncryptionConfiguration | [ ] |
| K8s 업그레이드 | 보안 패치 적용 | [ ] |

### System Hardening (15%)

| 항목 | 설명 | 완료 |
|------|------|------|
| AppArmor | 프로파일 생성 및 적용 | [ ] |
| seccomp | RuntimeDefault 적용 | [ ] |
| OS 보안 | 불필요한 서비스/패키지 제거 | [ ] |
| 네트워크 보안 | hostNetwork/hostPID 확인 | [ ] |

### Minimize Microservice Vulnerabilities (20%)

| 항목 | 설명 | 완료 |
|------|------|------|
| PSA | Pod Security Standards 적용 | [ ] |
| SecurityContext | 모든 옵션 강화 | [ ] |
| mTLS | STRICT 모드 확인 | [ ] |
| Secret 보안 | immutable, 암호화 | [ ] |
| OPA Gatekeeper | 정책 엔진 적용 | [ ] |

### Supply Chain Security (20%)

| 항목 | 설명 | 완료 |
|------|------|------|
| Trivy | 이미지 취약점 스캔 | [ ] |
| 이미지 정책 | 다이제스트 사용, AlwaysPull | [ ] |
| Dockerfile | 보안 best practice | [ ] |
| 레지스트리 | 허용 레지스트리 제한 | [ ] |

### Monitoring, Logging and Runtime Security (20%)

| 항목 | 설명 | 완료 |
|------|------|------|
| Audit Policy | 감사 정책 설정 | [ ] |
| Falco | 런타임 탐지 | [ ] |
| 컨테이너 불변성 | readOnlyRootFilesystem | [ ] |
| Prometheus | 보안 메트릭 모니터링 | [ ] |
| 시스템 콜 | seccomp/strace 활용 | [ ] |

---

## 참고: 클러스터 접근 방법

```bash
# dev 클러스터 접근 (주 실습 환경)
export KUBECONFIG=kubeconfig/dev-kubeconfig

# platform 클러스터 접근 (Prometheus/Grafana/Loki)
export KUBECONFIG=kubeconfig/platform-kubeconfig

# staging 클러스터 접근
export KUBECONFIG=kubeconfig/staging-kubeconfig

# prod 클러스터 접근
export KUBECONFIG=kubeconfig/prod-kubeconfig
```
