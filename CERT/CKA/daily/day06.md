# CKA Day 6: RBAC 시험 문제 심화 & YAML 예제

> CKA 도메인: Cluster Architecture (25%) - Part 3 실전 | 예상 소요 시간: 2시간

---

### 문제 7. ClusterRoleBinding 생성 [4%]

**컨텍스트:** `kubectl config use-context platform`

`ops-team` 그룹에게 클러스터 전체에서 노드를 조회(get, list, watch)할 수 있는 권한을 부여하라.

<details>
<summary>풀이 과정</summary>

```bash
kubectl config use-context platform

# ClusterRole 생성
kubectl create clusterrole node-viewer \
  --verb=get,list,watch \
  --resource=nodes

# ClusterRoleBinding 생성
kubectl create clusterrolebinding ops-node-viewer \
  --clusterrole=node-viewer \
  --group=ops-team

# 확인
kubectl auth can-i list nodes --as=jane --as-group=ops-team    # yes
kubectl auth can-i delete nodes --as=jane --as-group=ops-team  # no
```

</details>

---

### 문제 8. 기존 RBAC 분석 [4%]

**컨텍스트:** `kubectl config use-context platform`

`cluster-admin` ClusterRole의 권한 규칙을 확인하고 `/tmp/cluster-admin-rules.txt`에 저장하라.

<details>
<summary>풀이 과정</summary>

```bash
kubectl config use-context platform

kubectl describe clusterrole cluster-admin > /tmp/cluster-admin-rules.txt
# 또는
kubectl get clusterrole cluster-admin -o yaml > /tmp/cluster-admin-rules.txt

cat /tmp/cluster-admin-rules.txt
# PolicyRule:
#   Resources  Non-Resource URLs  Resource Names  Verbs
#   ---------  -----------------  --------------  -----
#   *.*        []                 []              [*]
#   [*]                           []              [*]
```

</details>

---

### 문제 9. Pod에서 SA 토큰 확인 [4%]

**컨텍스트:** `kubectl config use-context dev`

1. `demo` 네임스페이스에 `api-checker` SA를 생성하라
2. `api-checker` SA를 사용하는 Pod `sa-test`를 생성하라 (이미지: busybox:1.36)
3. Pod 내부에서 SA 토큰 경로를 확인하라

<details>
<summary>풀이 과정</summary>

```bash
kubectl config use-context dev

# SA 생성
kubectl create serviceaccount api-checker -n demo

# Pod 생성
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: sa-test
  namespace: demo
spec:
  serviceAccountName: api-checker
  containers:
  - name: app
    image: busybox:1.36
    command: ["sh", "-c", "ls -la /var/run/secrets/kubernetes.io/serviceaccount/ && sleep 3600"]
EOF

# 토큰 경로 확인
kubectl exec sa-test -n demo -- ls /var/run/secrets/kubernetes.io/serviceaccount/
# ca.crt  namespace  token

kubectl exec sa-test -n demo -- cat /var/run/secrets/kubernetes.io/serviceaccount/namespace
# demo

# 정리
kubectl delete pod sa-test -n demo
kubectl delete serviceaccount api-checker -n demo
```

</details>

---

### 문제 10. 토큰 자동 마운트 비활성화 [4%]

**컨텍스트:** `kubectl config use-context dev`

`demo` 네임스페이스에 SA 토큰이 자동 마운트되지 않는 Pod를 생성하라.

<details>
<summary>풀이 과정</summary>

```bash
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: no-token-pod
  namespace: demo
spec:
  automountServiceAccountToken: false
  containers:
  - name: app
    image: busybox:1.36
    command: ["sh", "-c", "ls /var/run/secrets/kubernetes.io/serviceaccount/ 2>&1 || echo 'No token mounted' && sleep 3600"]
EOF

# 확인: 토큰이 마운트되지 않았는지
kubectl exec no-token-pod -n demo -- ls /var/run/secrets/kubernetes.io/serviceaccount/
# ls: /var/run/secrets/kubernetes.io/serviceaccount/: No such file or directory

kubectl delete pod no-token-pod -n demo
```

</details>

---

### 문제 11. CSR 거부 [4%]

**컨텍스트:** `kubectl config use-context platform`

`suspicious-user`라는 이름의 CSR이 Pending 상태이다. 이 CSR을 거부(deny)하라.

<details>
<summary>풀이 과정</summary>

```bash
kubectl config use-context platform

# CSR 확인
kubectl get csr

# CSR 거부
kubectl certificate deny suspicious-user

# 확인
kubectl get csr suspicious-user
# CONDITION: Denied
```

</details>

---

### 문제 12. 권한 감사 (auth can-i --list) [7%]

**컨텍스트:** `kubectl config use-context dev`

사용자 `tom`이 `demo` 네임스페이스에서 수행할 수 있는 모든 작업을 확인하여 `/tmp/tom-permissions.txt`에 저장하라.

<details>
<summary>풀이 과정</summary>

```bash
kubectl config use-context dev

kubectl auth can-i --list --as=tom -n demo > /tmp/tom-permissions.txt

cat /tmp/tom-permissions.txt
# Resources                                       Non-Resource URLs   Resource Names   Verbs
# selfsubjectaccessreviews.authorization.k8s.io   []                  []               [create]
# selfsubjectrulesreviews.authorization.k8s.io    []                  []               [create]
# pods                                            []                  []               [get list watch create delete]
# ...
```

</details>

---

## 8. 추가 YAML 예제

### 8.1 리소스 이름 기반 제한

```yaml
# 특정 리소스 이름에 대해서만 권한을 부여하는 Role
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: specific-pod-admin
  namespace: demo
rules:
- apiGroups: [""]
  resources: ["pods"]
  resourceNames: ["nginx-web", "redis"]    # 이 이름의 Pod에 대해서만 권한
  verbs: ["get", "update", "delete"]
- apiGroups: [""]
  resources: ["configmaps"]
  resourceNames: ["app-config"]            # 이 ConfigMap에 대해서만
  verbs: ["get", "update"]
```

### 8.2 하위 리소스(Sub-resource) 권한

```yaml
# Pod의 하위 리소스(로그, exec 등)에 대한 권한
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: pod-debug
  namespace: demo
rules:
- apiGroups: [""]
  resources: ["pods"]
  verbs: ["get", "list"]
- apiGroups: [""]
  resources: ["pods/log"]                  # Pod 로그 조회
  verbs: ["get"]
- apiGroups: [""]
  resources: ["pods/exec"]                 # Pod exec 실행
  verbs: ["create"]
- apiGroups: [""]
  resources: ["pods/portforward"]          # Pod 포트 포워딩
  verbs: ["create"]
```

### 8.3 비-네임스페이스 리소스용 ClusterRole

```yaml
# 비-네임스페이스 리소스(노드, PV 등)에 대한 ClusterRole
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: infrastructure-viewer
rules:
- apiGroups: [""]
  resources: ["nodes"]                     # 노드 (비-네임스페이스)
  verbs: ["get", "list", "watch"]
- apiGroups: [""]
  resources: ["persistentvolumes"]         # PV (비-네임스페이스)
  verbs: ["get", "list"]
- apiGroups: ["storage.k8s.io"]
  resources: ["storageclasses"]            # StorageClass (비-네임스페이스)
  verbs: ["get", "list"]
- apiGroups: [""]
  resources: ["namespaces"]                # 네임스페이스 자체도 비-네임스페이스 리소스
  verbs: ["get", "list"]
```

### 8.4 Aggregated ClusterRole

```yaml
# 라벨 기반으로 자동 집계되는 ClusterRole
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: monitoring-view
  labels:
    rbac.authorization.k8s.io/aggregate-to-view: "true"    # view ClusterRole에 자동 집계
rules:
- apiGroups: ["monitoring.coreos.com"]
  resources: ["servicemonitors", "prometheusrules"]
  verbs: ["get", "list", "watch"]
```

### 8.5 kubeconfig 전체 예제

```yaml
# 완전한 kubeconfig 파일 예제
apiVersion: v1
kind: Config
preferences: {}
current-context: dev-admin                  # 현재 사용할 컨텍스트

clusters:
- name: dev-cluster
  cluster:
    server: https://192.168.64.20:6443     # API 서버 주소
    certificate-authority-data: LS0tLS...   # CA 인증서 (base64)

- name: prod-cluster
  cluster:
    server: https://192.168.64.40:6443
    certificate-authority-data: LS0tLS...

users:
- name: admin
  user:
    client-certificate-data: LS0tLS...      # 클라이언트 인증서 (base64)
    client-key-data: LS0tLS...              # 클라이언트 개인키 (base64)

- name: dev-user
  user:
    token: eyJhbGciOiJSUzI1NiIs...         # Bearer 토큰 방식

contexts:
- name: dev-admin
  context:
    cluster: dev-cluster
    user: admin
    namespace: demo                         # 기본 네임스페이스

- name: prod-admin
  context:
    cluster: prod-cluster
    user: admin
    namespace: default
```

---

## 9. 복습 체크리스트

### 개념 확인

- [ ] Role과 ClusterRole의 범위 차이를 설명할 수 있는가?
- [ ] RoleBinding이 ClusterRole을 참조하면 어떻게 되는지 이해하는가?
- [ ] Core API 그룹의 apiGroups가 `[""]`인 것을 기억하는가?
- [ ] SA의 `--as` 형식 (`system:serviceaccount:<ns>:<name>`)을 암기했는가?
- [ ] CSR 처리 5단계(키생성 → CSR생성 → K8s CSR → 승인 → 인증서추출)를 외웠는가?

### 시험 팁

1. **RBAC 빠른 생성** -- `kubectl create role`과 `kubectl create rolebinding`이 YAML보다 빠르다
2. **권한 확인** -- `kubectl auth can-i --as=<user> -n <ns>`로 항상 검증한다
3. **SA 형식** -- `--as=system:serviceaccount:<ns>:<sa-name>`
4. **CSR request 필드** -- base64 인코딩 시 `tr -d '\n'` 줄바꿈 제거 필수
5. **API 그룹** -- pods/services는 `""`, deployments는 `"apps"`, networkpolicies는 `"networking.k8s.io"`

---

## 내일 예고

**Day 7: Deployment & Rolling Update** -- Deployment 전략, ReplicaSet 관리, 롤링업데이트/롤백을 실습한다. `kubectl create deployment --dry-run=client -o yaml`을 반드시 연습해오자.

---

## tart-infra 실습

### 실습 환경 설정

```bash
# platform 클러스터에서 RBAC 구성 확인
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/platform.yaml
kubectl get nodes
```

### 실습 1: 기존 ClusterRole 분석

```bash
# 시스템 ClusterRole 목록 확인
kubectl get clusterroles | head -20
```

**예상 출력:**
```
NAME                                                                   CREATED AT
admin                                                                  2024-xx-xx
cluster-admin                                                          2024-xx-xx
edit                                                                   2024-xx-xx
system:aggregate-to-admin                                              2024-xx-xx
system:aggregate-to-edit                                               2024-xx-xx
system:aggregate-to-view                                               2024-xx-xx
view                                                                   2024-xx-xx
...
```

**동작 원리:** ClusterRole은 클러스터 범위의 권한 정의이다:
1. API Server가 etcd에서 ClusterRole 오브젝트 목록을 조회한다
2. `admin`, `edit`, `view`는 K8s가 기본 제공하는 aggregated ClusterRole이다
3. `cluster-admin`은 모든 리소스에 대한 모든 동작을 허용하는 최상위 권한이다
4. `system:` 접두사는 K8s 내부 구성요소가 사용하는 Role을 나타낸다

```bash
# cluster-admin의 구체적 권한 확인
kubectl describe clusterrole cluster-admin
```

**예상 출력:**
```
Name:         cluster-admin
PolicyRule:
  Resources  Non-Resource URLs  Resource Names  Verbs
  ---------  -----------------  --------------  -----
  *.*        []                 []              [*]
             [*]                []              [*]
```

### 실습 2: RBAC 권한 테스트

```bash
# 현재 사용자의 권한 확인
kubectl auth can-i create deployments
kubectl auth can-i delete nodes

# ServiceAccount 권한 확인
kubectl auth can-i list pods --as=system:serviceaccount:kube-system:coredns -n kube-system
kubectl auth can-i list pods --as=system:serviceaccount:kube-system:coredns -n default
```

**예상 출력:**
```
yes
yes
yes
no
```

**동작 원리:** `kubectl auth can-i`는 SubjectAccessReview API를 사용한다:
1. kubectl이 `/apis/authorization.k8s.io/v1/selfsubjectaccessreviews` 엔드포인트에 요청을 보낸다
2. API Server가 RBAC 인가 모듈에서 해당 사용자/SA의 Role/ClusterRole 바인딩을 확인한다
3. `--as` 플래그는 impersonation(사칭) 기능으로, 다른 사용자의 권한을 시뮬레이션한다
4. coredns SA는 kube-system에서 pods를 볼 수 있지만, default 네임스페이스에서는 권한이 없다

### 실습 3: Role과 RoleBinding 생성

```bash
# 실습용 네임스페이스 생성
kubectl create namespace rbac-test

# Role 생성 (pods와 services의 get, list, watch 권한)
kubectl create role pod-reader \
  --verb=get,list,watch \
  --resource=pods,services \
  -n rbac-test

# RoleBinding 생성
kubectl create rolebinding pod-reader-binding \
  --role=pod-reader \
  --serviceaccount=rbac-test:default \
  -n rbac-test

# 권한 확인
kubectl auth can-i list pods -n rbac-test --as=system:serviceaccount:rbac-test:default
kubectl auth can-i create pods -n rbac-test --as=system:serviceaccount:rbac-test:default
```

**예상 출력:**
```
role.rbac.authorization.k8s.io/pod-reader created
rolebinding.rbac.authorization.k8s.io/pod-reader-binding created
yes
no
```

**동작 원리:** Role → RoleBinding → Subject 바인딩 흐름:
1. Role은 "어떤 리소스에 어떤 동작을 허용할지"를 정의한다 (verbs + resources)
2. RoleBinding은 Role을 특정 Subject(User, Group, ServiceAccount)에 바인딩한다
3. Role은 네임스페이스 범위이므로, rbac-test 네임스페이스에서만 유효하다
4. 같은 SA가 다른 네임스페이스의 pods를 조회하려면 해당 네임스페이스에도 별도 RoleBinding이 필요하다

```bash
# 실습 후 정리
kubectl delete namespace rbac-test
```

### 실습 4: 인증서 정보 확인

```bash
# API Server 인증서 만료일 확인 (SSH로 master 접속 후)
# tart ssh platform-master
# sudo kubeadm certs check-expiration
```

**예상 출력:**
```
CERTIFICATE                EXPIRES                  RESIDUAL TIME
admin.conf                 Jan 15, 2026 00:00 UTC   364d
apiserver                  Jan 15, 2026 00:00 UTC   364d
apiserver-etcd-client      Jan 15, 2026 00:00 UTC   364d
apiserver-kubelet-client   Jan 15, 2026 00:00 UTC   364d
controller-manager.conf    Jan 15, 2026 00:00 UTC   364d
etcd-healthcheck-client    Jan 15, 2026 00:00 UTC   364d
etcd-peer                  Jan 15, 2026 00:00 UTC   364d
etcd-server                Jan 15, 2026 00:00 UTC   364d
front-proxy-client         Jan 15, 2026 00:00 UTC   364d
scheduler.conf             Jan 15, 2026 00:00 UTC   364d
```

**동작 원리:** kubeadm이 생성하는 인증서 체계(PKI):
1. `/etc/kubernetes/pki/ca.crt` — 클러스터 루트 CA (10년 유효)
2. 나머지 인증서 — CA가 서명한 개별 인증서 (1년 유효, kubeadm으로 갱신)
3. `kubeadm certs renew all`로 모든 인증서를 한 번에 갱신할 수 있다
4. 인증서 갱신 후 Static Pod가 자동 재시작되어 새 인증서를 로드한다

---

## 추가 심화 학습: RBAC 고급 패턴과 CSR 처리

### RBAC 4가지 리소스 비교표

```
RBAC 리소스 비교 (네임스페이스/클러스터 범위별 인가 구조)
═══════════════════════════════════════════════

                    네임스페이스 범위          클러스터 범위
                  ┌──────────────────┐    ┌──────────────────┐
 권한 정의         │     Role          │    │   ClusterRole     │
 (rules: API       │  "dev NS에서       │    │  "모든 NS에서      │
  리소스+verb)     │   pods GET 가능"   │    │   pods GET 가능"   │
                  └──────────────────┘    └──────────────────┘

                  ┌──────────────────┐    ┌──────────────────┐
 권한 부여         │   RoleBinding     │    │ClusterRoleBinding │
 (Subject에       │  "user:jane에게    │    │  "user:jane에게    │
  바인딩)         │   dev NS Role     │    │   ClusterRole     │
                  │   부여"           │    │   부여"           │
                  └──────────────────┘    └──────────────────┘

중요한 조합:
  - Role + RoleBinding: 특정 NS에서만 유효 (가장 일반적)
  - ClusterRole + ClusterRoleBinding: 클러스터 전체에서 유효
  - ClusterRole + RoleBinding: ClusterRole을 특정 NS에만 적용! (재사용)
  - Role + ClusterRoleBinding: ❌ 불가능! (Role은 NS 범위이므로)
```

### ClusterRole + RoleBinding 재사용 패턴 (YAML 상세)

```yaml
# 하나의 ClusterRole을 여러 네임스페이스에서 재사용하는 패턴
# ── 이 패턴은 CKA 시험에서 자주 출제된다 ──

# Step 1: ClusterRole 정의 (한 번만)
apiVersion: rbac.authorization.k8s.io/v1   # RBAC API 그룹
kind: ClusterRole                          # 클러스터 범위 역할
metadata:
  name: pod-reader                         # 역할 이름
rules:
  - apiGroups: [""]         # 코어 API 그룹 (Pod, Service, ConfigMap 등)
    resources: ["pods"]     # 대상 리소스: Pod
    verbs: ["get", "watch", "list"]  # 허용 동작: 읽기만 가능
---
# Step 2: dev 네임스페이스에 RoleBinding
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding                          # 네임스페이스 범위 바인딩
metadata:
  name: pod-reader-binding-dev             # 바인딩 이름
  namespace: dev                           # 이 NS에서만 유효!
subjects:
  - kind: User                             # 사용자에게 부여
    name: jane                             # 사용자 이름
    apiGroup: rbac.authorization.k8s.io
roleRef:
  kind: ClusterRole                        # ClusterRole을 참조
  name: pod-reader                         # 위에서 정의한 ClusterRole
  apiGroup: rbac.authorization.k8s.io
---
# Step 3: staging 네임스페이스에도 동일 ClusterRole 재사용
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: pod-reader-binding-staging
  namespace: staging                       # staging NS에서만 유효!
subjects:
  - kind: User
    name: jane
    apiGroup: rbac.authorization.k8s.io
roleRef:
  kind: ClusterRole
  name: pod-reader                         # 같은 ClusterRole 재사용!
  apiGroup: rbac.authorization.k8s.io
```

**동작 원리:** ClusterRole + RoleBinding 조합:
1. ClusterRole을 한 번 정의하면 여러 NS에서 RoleBinding으로 재사용 가능
2. ClusterRoleBinding을 쓰면 모든 NS에 적용되지만, RoleBinding은 특정 NS만
3. 이 패턴은 "최소 권한 원칙"을 지키면서 역할을 재사용하는 모범 사례

### ServiceAccount 동작 원리 상세

```
ServiceAccount 토큰 마운트 흐름
══════════════════════════════

1. Pod 생성 요청
   kubectl apply -f pod.yaml
       │
       ▼
2. API Server가 Admission Controller 실행
   - ServiceAccount Admission Controller가 동작
   - Pod에 spec.serviceAccountName이 없으면 "default" SA 자동 할당
       │
       ▼
3. TokenRequest API로 단기 토큰 생성 (K8s 1.24+)
   - 유효기간: 기본 1시간 (자동 갱신)
   - 이전(1.22 이전): Secret 기반 영구 토큰 (보안 취약)
       │
       ▼
4. 토큰이 Pod에 마운트됨
   경로: /var/run/secrets/kubernetes.io/serviceaccount/
   ├── token      ← JWT 토큰 (API Server 인증용)
   ├── ca.crt     ← 클러스터 CA 인증서
   └── namespace  ← Pod의 네임스페이스 이름
       │
       ▼
5. Pod 내부 앱이 API Server에 요청
   curl -H "Authorization: Bearer $(cat /var/run/secrets/...token)" \
     https://kubernetes.default.svc/api/v1/pods
```

### ServiceAccount YAML 상세 예제

```yaml
# ServiceAccount 생성
apiVersion: v1
kind: ServiceAccount            # 서비스 어카운트 리소스
metadata:
  name: monitoring-sa            # SA 이름
  namespace: monitoring          # 소속 네임스페이스
automountServiceAccountToken: true  # Pod에 토큰 자동 마운트 여부
---
# 이 SA에 부여할 ClusterRole
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: monitoring-reader
rules:
  - apiGroups: [""]
    resources: ["pods", "nodes", "services"]  # 읽기 대상 리소스
    verbs: ["get", "list", "watch"]           # 읽기 전용
  - apiGroups: ["apps"]
    resources: ["deployments", "replicasets"] # apps 그룹 리소스
    verbs: ["get", "list", "watch"]
  - apiGroups: ["metrics.k8s.io"]             # metrics API
    resources: ["pods", "nodes"]
    verbs: ["get", "list"]
---
# SA에 ClusterRole 바인딩
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: monitoring-reader-binding
subjects:
  - kind: ServiceAccount           # Subject 타입: ServiceAccount
    name: monitoring-sa            # 위에서 만든 SA
    namespace: monitoring          # SA가 속한 네임스페이스 (필수!)
roleRef:
  kind: ClusterRole
  name: monitoring-reader
  apiGroup: rbac.authorization.k8s.io
---
# SA를 사용하는 Pod
apiVersion: v1
kind: Pod
metadata:
  name: monitoring-agent
  namespace: monitoring
spec:
  serviceAccountName: monitoring-sa  # 이 SA의 토큰으로 API 인증
  containers:
    - name: agent
      image: monitoring-agent:1.0
      # Pod 내부에서 자동으로 /var/run/secrets/... 에 토큰이 마운트됨
```

### CertificateSigningRequest (CSR) 처리 절차

```bash
# CKA 시험 출제 패턴: 새로운 사용자에게 인증서를 발급하는 절차

# Step 1: 개인 키 생성
openssl genrsa -o user-jane.key 2048

# Step 2: CSR 생성 (CN = 사용자 이름, O = 그룹)
openssl req -new -key user-jane.key \
  -out user-jane.csr \
  -subj "/CN=jane/O=developers"

# Step 3: CSR을 Base64로 인코딩
CSR_BASE64=$(cat user-jane.csr | base64 | tr -d '\n')

# Step 4: CertificateSigningRequest 오브젝트 생성
cat <<EOF | kubectl apply -f -
apiVersion: certificates.k8s.io/v1
kind: CertificateSigningRequest
metadata:
  name: jane-csr
spec:
  request: ${CSR_BASE64}
  signerName: kubernetes.io/kube-apiserver-client
  expirationSeconds: 86400    # 24시간 유효
  usages:
    - client auth              # 클라이언트 인증용
EOF

# Step 5: CSR 승인
kubectl certificate approve jane-csr

# Step 6: 승인된 인증서 추출
kubectl get csr jane-csr -o jsonpath='{.status.certificate}' | base64 -d > user-jane.crt

# Step 7: kubeconfig에 사용자 추가
kubectl config set-credentials jane \
  --client-certificate=user-jane.crt \
  --client-key=user-jane.key

kubectl config set-context jane-ctx \
  --cluster=kubernetes \
  --namespace=dev \
  --user=jane
```

**동작 원리:** CSR 승인 흐름:
1. 사용자가 개인 키로 CSR을 생성 → 클러스터 CA에게 서명을 요청하는 것
2. CSR 오브젝트를 API Server에 제출 → Pending 상태
3. 관리자가 `certificate approve` → K8s CA가 인증서에 서명
4. 서명된 인증서(.crt)로 kubeconfig를 구성하면 해당 사용자로 인증 가능
5. CN(Common Name)이 사용자 이름, O(Organization)가 그룹이 된다

### 연습 문제: RBAC 시나리오

**문제 1:** `dev` 네임스페이스에서 Deployment만 생성/수정/삭제할 수 있는 Role을 만들고, 사용자 `john`에게 바인딩하시오.

```bash
# 정답 (kubectl 명령어 - 시험에서 빠른 풀이용):
kubectl create role deploy-manager \
  --verb=create,update,delete,get,list \
  --resource=deployments \
  -n dev

kubectl create rolebinding deploy-manager-binding \
  --role=deploy-manager \
  --user=john \
  -n dev

# 확인
kubectl auth can-i create deployments -n dev --as=john    # yes
kubectl auth can-i delete pods -n dev --as=john           # no (pods 권한 없음)
kubectl auth can-i create deployments -n prod --as=john   # no (dev NS만 유효)
```

**문제 2:** 모든 네임스페이스에서 Pod 로그를 볼 수 있는 ClusterRole을 만들고, 그룹 `sre-team`에 바인딩하시오.

```bash
# 정답:
kubectl create clusterrole log-reader \
  --verb=get,list \
  --resource=pods,pods/log    # pods/log = 서브리소스!

kubectl create clusterrolebinding log-reader-binding \
  --clusterrole=log-reader \
  --group=sre-team

# 확인
kubectl auth can-i get pods/log --all-namespaces --as-group=sre-team --as=test
```

**동작 원리:** 서브리소스(subresource):
1. `pods/log`: Pod 로그 접근 권한
2. `pods/exec`: Pod에 exec 접근 권한
3. `pods/portforward`: 포트포워딩 권한
4. `nodes/proxy`: 노드 프록시 접근
5. 서브리소스는 별도로 권한을 부여해야 한다 (pods 권한만으로는 logs 접근 불가)

### kubeconfig 수동 생성 (시험 대비)

```yaml
# kubeconfig 구조 상세 설명
apiVersion: v1
kind: Config
current-context: jane-ctx            # 현재 활성 컨텍스트

clusters:                            # 클러스터 목록
  - cluster:
      certificate-authority-data: LS0t...  # CA 인증서 (Base64)
      server: https://10.0.0.10:6443       # API Server 주소
    name: kubernetes                       # 클러스터 이름

users:                               # 사용자 목록
  - name: jane                       # 사용자 이름
    user:
      client-certificate-data: LS0t...  # 클라이언트 인증서 (Base64)
      client-key-data: LS0t...          # 클라이언트 키 (Base64)

contexts:                            # 컨텍스트 = 클러스터 + 사용자 + 네임스페이스
  - context:
      cluster: kubernetes            # 어떤 클러스터에
      namespace: dev                 # 어떤 네임스페이스에서
      user: jane                     # 어떤 사용자로
    name: jane-ctx                   # 컨텍스트 이름
```

**동작 원리:** kubeconfig 3요소:
1. **Cluster**: API Server 주소 + CA 인증서 (서버 신뢰)
2. **User**: 클라이언트 인증서 + 키 (사용자 증명) 또는 토큰
3. **Context**: Cluster + User + Namespace의 조합 (편의를 위한 단축키)

### CKA 시험 팁: RBAC 빠른 풀이 전략

```
RBAC 시험 풀이 체크리스트
═════════════════════════

1. 문제를 읽고 판단:
   □ 네임스페이스 범위? → Role + RoleBinding
   □ 클러스터 범위? → ClusterRole + ClusterRoleBinding
   □ 특정 NS에 ClusterRole 적용? → ClusterRole + RoleBinding

2. kubectl 명령어로 빠르게 생성 (YAML 작성보다 빠르다!):
   kubectl create role <name> --verb=<verbs> --resource=<resources> -n <ns>
   kubectl create rolebinding <name> --role=<role> --user=<user> -n <ns>

3. 확인 방법:
   kubectl auth can-i <verb> <resource> -n <ns> --as=<user>

4. 자주 실수하는 포인트:
   - apiGroups를 빠뜨림 (kubectl 명령어는 자동 설정)
   - 서브리소스(pods/log, pods/exec) 별도 권한 필요
   - RoleBinding에 namespace 빠뜨림
   - ClusterRoleBinding의 subjects에 SA namespace 빠뜨림
```
