# CKS Day 4: Cluster Hardening (2/2) - Audit Policy, kubeadm 업그레이드, 시험 실전

> 학습 목표 | CKS 도메인: Cluster Hardening (15%) | 예상 소요 시간: 2시간

---

## 오늘의 학습 목표

- Kubernetes Audit Policy를 작성하여 감사 로그를 설정할 수 있다
- kubeadm 클러스터 업그레이드 절차를 수행할 수 있다
- kubeconfig 보안 관리를 이해한다
- Cluster Hardening 도메인의 시험 출제 패턴을 분석하고 실전 문제를 풀어본다

---


## 4. 감사 로그 (Audit Policy)

### 4.1 Kubernetes Audit 메커니즘

```
Audit Policy 기반 API 요청 기록 메커니즘
════════════════════════════════════════

Kubernetes Audit은 kube-apiserver를 경유하는 모든 API 요청에 대해
구조화된 감사 이벤트(audit event)를 생성하는 메커니즘이다.
--audit-policy-file 플래그로 정책을 지정하고, --audit-log-path로 출력 경로를 설정한다.

4단계 기록 수준(audit level):
  - None: 해당 요청에 대해 감사 이벤트를 생성하지 않는다
  - Metadata: 요청 메타데이터(사용자, 타임스탬프, 리소스, verb)만 기록한다
  - Request: 메타데이터 + 요청 본문(request body)을 기록한다
  - RequestResponse: 메타데이터 + 요청 본문 + 응답 본문(response body)을 모두 기록한다

보안 관점의 설정 원칙:
  - Secret 리소스 접근은 RequestResponse로 기록 (데이터 유출 추적)
  - Pod/Deployment 관련은 Metadata로 기록 (변경 이력 추적)
  - system:nodes 등 시스템 컴포넌트의 반복 요청은 None (로그 볼륨 최적화)
```

### 4.2 4가지 Audit 레벨

```
Audit 레벨 비교
═══════════════

레벨             | 기록 내용                          | 로그 크기
─────────────────┼───────────────────────────────────┼──────────
None             | 기록하지 않음                       | 0
Metadata         | 사용자, 타임스탬프, 리소스, verb    | 작음
Request          | Metadata + 요청 본문               | 중간
RequestResponse  | Metadata + 요청 본문 + 응답 본문   | 큼

CKS 시험에서의 사용:
  Secret → RequestResponse (누가 어떤 Secret을 조회했는지 값까지)
  Pod/exec/log → Metadata (셸 접근 기록)
  RBAC 변경 → Metadata (권한 변경 기록)
  시스템 컴포넌트 → None (노이즈 제거)
  기본 → Metadata (catch-all)
```

### 4.3 Audit Policy 작성 상세

```yaml
# /etc/kubernetes/audit-policy.yaml
# ─────────────────────────────────
apiVersion: audit.k8s.io/v1        # Audit API 버전
kind: Policy                        # Audit 정책
rules:
  # ═══ 규칙 1: Secret에 대한 모든 요청을 최고 수준으로 기록 ═══
  # Secret은 비밀번호, 토큰 등 민감 정보를 담고 있으므로
  # 누가, 언제, 어떤 Secret을, 어떤 값으로 변경했는지 모두 기록
  - level: RequestResponse           # 요청 + 응답 본문 모두 기록
    resources:
    - group: ""                      # core API 그룹
      resources: ["secrets"]         # Secret 리소스

  # ═══ 규칙 2: Pod 관련 활동 기록 ═══
  # kubectl exec, kubectl logs 등 보안에 민감한 활동 기록
  - level: Metadata                  # 메타데이터만 기록 (본문은 불필요)
    resources:
    - group: ""
      resources: ["pods", "pods/log", "pods/exec", "pods/portforward"]
                                     # pods/exec = kubectl exec
                                     # pods/log = kubectl logs
                                     # pods/portforward = kubectl port-forward

  # ═══ 규칙 3: RBAC 변경 기록 ═══
  # 권한 변경은 보안에 직결되므로 반드시 기록
  - level: Metadata
    resources:
    - group: "rbac.authorization.k8s.io"
      resources: ["roles", "rolebindings", "clusterroles", "clusterrolebindings"]

  # ═══ 규칙 4: ConfigMap 변경만 기록 ═══
  # 조회는 기록하지 않고, 생성/수정/삭제만 기록
  - level: Request                   # 요청 본문까지 기록
    resources:
    - group: ""
      resources: ["configmaps"]
    verbs: ["create", "update", "patch", "delete"]
                                     # get, list, watch는 제외

  # ═══ 규칙 5: 시스템 컴포넌트의 반복 요청 제외 ═══
  # kube-scheduler, kube-proxy 등은 매 초마다 API 요청을 보내므로
  # 이것을 모두 기록하면 로그 볼륨이 폭발한다
  - level: None                      # 기록하지 않음
    users:
    - "system:kube-scheduler"
    - "system:kube-proxy"
    - "system:apiserver"
    verbs: ["get", "list", "watch"]  # 읽기 요청만 제외

  # ═══ 규칙 6: 헬스 체크 엔드포인트 제외 ═══
  - level: None
    nonResourceURLs:
    - "/healthz*"                    # 헬스 체크
    - "/livez*"                      # 라이브니스
    - "/readyz*"                     # 레디니스
    - "/api"                         # API 디스커버리
    - "/api/*"

  # ═══ 규칙 7: 이벤트 제외 ═══
  # 이벤트는 매우 많이 생성되므로 제외
  - level: None
    resources:
    - group: ""
      resources: ["events"]

  # ═══ 규칙 8: 기본 catch-all ═══
  # 위 규칙에 매칭되지 않은 모든 요청을 Metadata로 기록
  - level: Metadata
    omitStages:
    - "RequestReceived"              # 요청 수신 단계는 제외 (중복 방지)
```

```
규칙 매칭 원리 (중요!)
═════════════════════

1. 위에서 아래로 순서대로 평가된다
2. 첫 번째로 매칭되는 규칙이 적용된다
3. 나머지 규칙은 무시된다

예: Secret GET 요청
  → 규칙 1 매칭 (resources: secrets) → RequestResponse 레벨로 기록
  → 규칙 5는 평가되지 않음 (이미 매칭됨)

예: kube-scheduler의 Pod GET 요청
  → 규칙 2 매칭? → resources: pods → 매칭! → Metadata 레벨로 기록
  ※ 규칙 5보다 규칙 2가 먼저이므로 기록됨!

→ 시스템 컴포넌트를 제외하려면 더 위에 배치해야 한다!
```

### 4.4 API Server에 Audit 적용

```yaml
# /etc/kubernetes/manifests/kube-apiserver.yaml에 추가
spec:
  containers:
  - command:
    - kube-apiserver
    # === Audit 플래그 추가 ===
    - --audit-policy-file=/etc/kubernetes/audit-policy.yaml
                                           # Audit 정책 파일 경로
    - --audit-log-path=/var/log/kubernetes/audit/audit.log
                                           # 로그 파일 경로
    - --audit-log-maxage=30                # 로그 보관 기간 (일)
    - --audit-log-maxbackup=10             # 최대 백업 파일 수
    - --audit-log-maxsize=100              # 최대 파일 크기 (MB)

    # === 볼륨 마운트 추가 ===
    volumeMounts:
    - name: audit-policy                   # Audit 정책 파일 마운트
      mountPath: /etc/kubernetes/audit-policy.yaml
      readOnly: true                       # 읽기 전용 (보안)
    - name: audit-log                      # 로그 디렉토리 마운트
      mountPath: /var/log/kubernetes/audit/

  # === 볼륨 추가 ===
  volumes:
  - name: audit-policy
    hostPath:
      path: /etc/kubernetes/audit-policy.yaml
      type: File                           # 파일이 존재해야 함!
  - name: audit-log
    hostPath:
      path: /var/log/kubernetes/audit/
      type: DirectoryOrCreate              # 디렉토리 없으면 생성
```

```bash
# 적용 절차
# 1. Audit Policy 파일 생성
sudo vi /etc/kubernetes/audit-policy.yaml

# 2. 로그 디렉토리 생성
sudo mkdir -p /var/log/kubernetes/audit/

# 3. API Server 매니페스트 수정
sudo vi /etc/kubernetes/manifests/kube-apiserver.yaml

# 4. API Server 재시작 대기
watch crictl ps | grep kube-apiserver

# 5. 정상 동작 확인
kubectl get nodes

# 6. Audit 로그 확인
tail -f /var/log/kubernetes/audit/audit.log | jq .
```

---

## 5. kubeadm 클러스터 업그레이드

### 5.1 업그레이드가 보안에 중요한 이유

```
보안 업데이트의 중요성
═════════════════════

쿠버네티스는 정기적으로 보안 취약점(CVE)이 발견된다.
구버전을 사용하면 알려진 취약점에 노출된다.

예: CVE-2021-25741 (심각도: HIGH)
  - 심볼릭 링크를 통한 호스트 파일시스템 접근
  - 컨테이너에서 호스트 파일시스템의 파일을 읽고 수정 가능
  - v1.22.2, v1.21.5, v1.20.11에서 패치됨

→ 최신 패치 버전으로 업그레이드해야 안전하다
→ CKS에서는 업그레이드 절차를 실제로 수행해야 할 수 있다
```

### 5.2 업그레이드 절차

```bash
# ═══ 컨트롤 플레인 업그레이드 ═══

# 1. 업그레이드 가능 버전 확인
kubeadm upgrade plan

# 2. kubeadm 업그레이드
apt-get update
apt-get install -y kubeadm=1.31.x-*

# 3. 클러스터 업그레이드 적용
kubeadm upgrade apply v1.31.x

# 4. 노드 드레인 (워크로드 이동)
kubectl drain <node-name> --ignore-daemonsets --delete-emptydir-data

# 5. kubelet, kubectl 업그레이드
apt-get install -y kubelet=1.31.x-* kubectl=1.31.x-*
systemctl daemon-reload
systemctl restart kubelet

# 6. 노드 uncordon (워크로드 스케줄링 재개)
kubectl uncordon <node-name>

# ═══ 워커 노드 업그레이드 ═══
# 워커 노드마다 반복:

# 1. 드레인
kubectl drain <worker-node> --ignore-daemonsets --delete-emptydir-data

# 2. 워커 노드에서 kubeadm 업그레이드
ssh <worker-node>
apt-get update
apt-get install -y kubeadm=1.31.x-*
kubeadm upgrade node

# 3. kubelet 업그레이드
apt-get install -y kubelet=1.31.x-*
systemctl daemon-reload
systemctl restart kubelet

# 4. uncordon
kubectl uncordon <worker-node>

# 5. 확인
kubectl get nodes
# 모든 노드 v1.31.x, Ready
```

---

## 6. kubeconfig 보안 관리

```bash
# kubeconfig 파일 권한 제한 (소유자만 읽기/쓰기)
chmod 600 ~/.kube/config

# 불필요한 context 제거
kubectl config delete-context old-cluster

# 불필요한 클러스터/사용자 정보 제거
kubectl config delete-cluster old-cluster
kubectl config delete-user old-user

# 현재 context 확인
kubectl config current-context
kubectl config get-contexts

# kubeconfig에 민감 정보가 있는지 확인
# (client-key-data, token 등이 포함되어 있으면 파일 보안 중요)
grep -c "client-key-data\|token" ~/.kube/config
```

---

## 7. 이 주제가 시험에서 어떻게 나오는가

### 7.1 출제 패턴 분석

```
Cluster Hardening 도메인 출제 패턴 (15%)
════════════════════════════════════════

1. RBAC 과도한 권한 축소 (매우 빈출)
   - "Role의 * 와일드카드를 제거하고 최소 권한으로 수정하라"
   - "불필요한 ClusterRoleBinding을 삭제하라"
   - "ClusterRole을 RoleBinding으로 네임스페이스에 제한하라"
   의도: 최소 권한 원칙 이해도 평가

2. ServiceAccount 토큰 비활성화 (빈출)
   - "SA를 생성하고 토큰 자동 마운트를 비활성화하라"
   - "기존 Pod의 토큰 마운트를 비활성화하라"
   의도: 공격 표면 줄이기 능력 평가

3. API Server 보안 설정 (빈출)
   - "anonymous-auth, authorization-mode 등을 수정하라"
   의도: API Server 매니페스트 수정 능력 평가

4. Audit Policy (가끔 출제, 배점 높음)
   - "요구사항에 맞는 Audit Policy를 작성하고 적용하라"
   의도: Audit 레벨 이해도와 볼륨 마운트 설정 능력 평가

5. kubeadm 업그레이드 (가끔 출제)
   - "클러스터를 특정 버전으로 업그레이드하라"
   의도: 업그레이드 절차 숙지도 평가
```

### 7.2 실전 문제 (10개 이상)

### 문제 1. RBAC 과도한 권한 축소

`production` 네임스페이스의 `dev-team` Role이 모든 리소스에 대해 `*` 권한을 가지고 있다. 다음과 같이 수정하라:
- Pod, Service: get, list, watch
- Deployment: get, list, watch, update
- ConfigMap: get, list

<details>
<summary>풀이</summary>

```bash
kubectl edit role dev-team -n production
```

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: dev-team
  namespace: production
rules:
- apiGroups: [""]
  resources: ["pods", "services"]
  verbs: ["get", "list", "watch"]
- apiGroups: ["apps"]
  resources: ["deployments"]
  verbs: ["get", "list", "watch", "update"]
- apiGroups: [""]
  resources: ["configmaps"]
  verbs: ["get", "list"]
```

검증:
```bash
kubectl auth can-i delete pods --as=system:serviceaccount:production:dev-sa -n production  # no
kubectl auth can-i get pods --as=system:serviceaccount:production:dev-sa -n production     # yes
kubectl auth can-i get secrets --as=system:serviceaccount:production:dev-sa -n production  # no
```

</details>

### 문제 2. ServiceAccount 토큰 비활성화

`webapp` 네임스페이스에 `api-sa` ServiceAccount를 생성하되, 토큰 자동 마운트를 비활성화하라. 이 SA를 사용하는 Pod `api-pod`(nginx:1.25)를 생성하고 토큰이 마운트되지 않았는지 확인하라.

<details>
<summary>풀이</summary>

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: api-sa
  namespace: webapp
automountServiceAccountToken: false
---
apiVersion: v1
kind: Pod
metadata:
  name: api-pod
  namespace: webapp
spec:
  serviceAccountName: api-sa
  automountServiceAccountToken: false
  containers:
  - name: app
    image: nginx:1.25
```

검증:
```bash
kubectl apply -f sa-pod.yaml
kubectl exec api-pod -n webapp -- ls /var/run/secrets/kubernetes.io/serviceaccount/ 2>&1
# No such file or directory → 성공
```

</details>

### 문제 3. API Server 보안 설정

API Server에 다음 보안 설정을 적용하라:
- 익명 인증 비활성화
- authorization-mode를 Node,RBAC으로 설정
- NodeRestriction Admission Controller 활성화
- profiling 비활성화

<details>
<summary>풀이</summary>

```bash
cp /etc/kubernetes/manifests/kube-apiserver.yaml /tmp/kube-apiserver.yaml.bak
vi /etc/kubernetes/manifests/kube-apiserver.yaml
```

```yaml
spec:
  containers:
  - command:
    - kube-apiserver
    - --anonymous-auth=false
    - --authorization-mode=Node,RBAC
    - --enable-admission-plugins=NodeRestriction
    - --profiling=false
    # 기존 플래그들 유지...
```

```bash
watch crictl ps | grep kube-apiserver
kubectl get nodes
```

</details>

### 문제 4. Audit Policy 작성 및 적용

다음 요구사항에 맞는 Audit Policy를 작성하고 API Server에 적용하라:
- Secret에 대한 모든 요청: RequestResponse 레벨
- ConfigMap 변경(create, update, delete): Request 레벨
- 나머지: Metadata 레벨

<details>
<summary>풀이</summary>

```yaml
# /etc/kubernetes/audit-policy.yaml
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
      resources: ["configmaps"]
    verbs: ["create", "update", "delete"]
  - level: Metadata
```

API Server에 적용:
```yaml
# 매니페스트에 추가
- --audit-policy-file=/etc/kubernetes/audit-policy.yaml
- --audit-log-path=/var/log/kubernetes/audit/audit.log
- --audit-log-maxage=30
- --audit-log-maxbackup=10
- --audit-log-maxsize=100
```

볼륨:
```yaml
volumeMounts:
- name: audit-policy
  mountPath: /etc/kubernetes/audit-policy.yaml
  readOnly: true
- name: audit-log
  mountPath: /var/log/kubernetes/audit/
volumes:
- name: audit-policy
  hostPath:
    path: /etc/kubernetes/audit-policy.yaml
    type: File
- name: audit-log
  hostPath:
    path: /var/log/kubernetes/audit/
    type: DirectoryOrCreate
```

```bash
mkdir -p /var/log/kubernetes/audit/
watch crictl ps | grep kube-apiserver
tail -f /var/log/kubernetes/audit/audit.log | jq .
```

</details>

### 문제 5. ClusterRole을 네임스페이스 범위로 제한

`secret-reader` ClusterRole(secrets에 대한 get,list 권한)을 `production` 네임스페이스에서만 사용자 `jane`에게 바인딩하라. 다른 네임스페이스에서는 접근 불가해야 한다.

<details>
<summary>풀이</summary>

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: secret-reader
rules:
- apiGroups: [""]
  resources: ["secrets"]
  verbs: ["get", "list"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: read-secrets-in-production
  namespace: production
subjects:
- kind: User
  name: jane
  apiGroup: rbac.authorization.k8s.io
roleRef:
  kind: ClusterRole
  name: secret-reader
  apiGroup: rbac.authorization.k8s.io
```

검증:
```bash
kubectl auth can-i get secrets --as=jane -n production  # yes
kubectl auth can-i get secrets --as=jane -n default     # no
kubectl auth can-i get secrets --as=jane -n kube-system  # no
```

핵심: ClusterRole을 RoleBinding으로 바인딩하면 네임스페이스 범위로 제한된다.

</details>

### 문제 6. cluster-admin 바인딩 감사

클러스터에서 `cluster-admin` ClusterRole에 바인딩된 모든 주체를 찾아라. 시스템 컴포넌트 외의 불필요한 바인딩이 있으면 삭제하라.

<details>
<summary>풀이</summary>

```bash
# cluster-admin 바인딩 찾기
kubectl get clusterrolebindings -o json | \
  jq '.items[] | select(.roleRef.name == "cluster-admin") |
  {name: .metadata.name, subjects: .subjects}'

# 시스템 컴포넌트 확인 (삭제하면 안 됨)
# - system:masters 그룹
# - kubeadm:cluster-admins

# 불필요한 바인딩 삭제 (예: dev-admin이 cluster-admin인 경우)
kubectl delete clusterrolebinding dev-admin-binding
```

</details>

### 문제 7. 복합 RBAC - 여러 리소스 권한 설정

`monitoring` 네임스페이스에 `monitor-sa` ServiceAccount를 생성하라. 이 SA에 다음 권한을 부여하라:
- 모든 네임스페이스의 pods: get, list, watch (ClusterRole + ClusterRoleBinding)
- monitoring 네임스페이스의 configmaps: get, create, update (Role + RoleBinding)

<details>
<summary>풀이</summary>

```bash
kubectl create ns monitoring
kubectl create sa monitor-sa -n monitoring

# ClusterRole: pods 읽기 (클러스터 전체)
kubectl create clusterrole pod-watcher \
  --verb=get,list,watch \
  --resource=pods

# ClusterRoleBinding
kubectl create clusterrolebinding monitor-pod-watcher \
  --clusterrole=pod-watcher \
  --serviceaccount=monitoring:monitor-sa

# Role: configmaps 관리 (monitoring 네임스페이스만)
kubectl create role cm-manager \
  --verb=get,create,update \
  --resource=configmaps \
  -n monitoring

# RoleBinding
kubectl create rolebinding monitor-cm-manager \
  --role=cm-manager \
  --serviceaccount=monitoring:monitor-sa \
  -n monitoring

# 검증
kubectl auth can-i get pods --as=system:serviceaccount:monitoring:monitor-sa -n default     # yes
kubectl auth can-i get pods --as=system:serviceaccount:monitoring:monitor-sa -n production   # yes
kubectl auth can-i get configmaps --as=system:serviceaccount:monitoring:monitor-sa -n monitoring  # yes
kubectl auth can-i get configmaps --as=system:serviceaccount:monitoring:monitor-sa -n default    # no
```

</details>

### 문제 8. Audit Policy - 복잡한 요구사항

다음 요구사항에 맞는 Audit Policy를 작성하라:
1. Secret에 대한 get, list, delete 요청: RequestResponse
2. Namespace 생성/삭제: Request
3. system:nodes 그룹의 모든 요청: None
4. /healthz, /readyz 엔드포인트: None
5. 기본: Metadata (RequestReceived 단계 제외)

<details>
<summary>풀이</summary>

```yaml
apiVersion: audit.k8s.io/v1
kind: Policy
rules:
  - level: RequestResponse
    resources:
    - group: ""
      resources: ["secrets"]
    verbs: ["get", "list", "delete"]
  - level: Request
    resources:
    - group: ""
      resources: ["namespaces"]
    verbs: ["create", "delete"]
  - level: None
    userGroups: ["system:nodes"]
  - level: None
    nonResourceURLs: ["/healthz*", "/readyz*"]
  - level: Metadata
    omitStages: ["RequestReceived"]
```

</details>

### 문제 9. ServiceAccount에 RBAC 바인딩 후 Pod 배포

`app-ns` 네임스페이스에:
1. `app-sa` SA 생성 (토큰 자동 마운트 비활성화)
2. configmaps에 대한 get,list 권한을 가진 `config-reader` Role 생성
3. `app-sa`에 바인딩
4. `app-sa`를 사용하는 Pod `app-pod` 생성 (토큰은 마운트하되, automount 사용하지 않고 projected volume으로)

<details>
<summary>풀이</summary>

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: app-sa
  namespace: app-ns
automountServiceAccountToken: false
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: config-reader
  namespace: app-ns
rules:
- apiGroups: [""]
  resources: ["configmaps"]
  verbs: ["get", "list"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: app-sa-config-reader
  namespace: app-ns
subjects:
- kind: ServiceAccount
  name: app-sa
  namespace: app-ns
roleRef:
  kind: Role
  name: config-reader
  apiGroup: rbac.authorization.k8s.io
---
apiVersion: v1
kind: Pod
metadata:
  name: app-pod
  namespace: app-ns
spec:
  serviceAccountName: app-sa
  automountServiceAccountToken: false
  containers:
  - name: app
    image: nginx:1.25
```

</details>

### 문제 10. kubeadm 업그레이드

컨트롤 플레인을 v1.31.0에서 v1.31.1로 업그레이드하라.

<details>
<summary>풀이</summary>

```bash
# 1. kubeadm 업그레이드
apt-get update
apt-get install -y kubeadm=1.31.1-*

# 2. 업그레이드 계획 확인
kubeadm upgrade plan

# 3. 업그레이드 적용
kubeadm upgrade apply v1.31.1

# 4. 노드 드레인
kubectl drain <master-node> --ignore-daemonsets --delete-emptydir-data

# 5. kubelet, kubectl 업그레이드
apt-get install -y kubelet=1.31.1-* kubectl=1.31.1-*
systemctl daemon-reload
systemctl restart kubelet

# 6. uncordon
kubectl uncordon <master-node>

# 7. 확인
kubectl get nodes
```

</details>

### 문제 11. 불필요한 ClusterRoleBinding 제거

`qa-team` 사용자가 `cluster-admin` ClusterRole에 바인딩되어 있다. 이를 `production` 네임스페이스에서만 pods, deployments에 대한 get, list, watch 권한을 가지도록 변경하라.

<details>
<summary>풀이</summary>

```bash
# 1. 기존 ClusterRoleBinding 삭제
kubectl delete clusterrolebinding qa-team-admin

# 2. 새 Role 생성
kubectl create role qa-viewer \
  --verb=get,list,watch \
  --resource=pods,deployments.apps \
  -n production

# 3. RoleBinding 생성
kubectl create rolebinding qa-team-viewer \
  --role=qa-viewer \
  --user=qa-team \
  -n production

# 검증
kubectl auth can-i get pods --as=qa-team -n production    # yes
kubectl auth can-i delete pods --as=qa-team -n production # no
kubectl auth can-i get pods --as=qa-team -n default       # no
```

</details>

---

## 8. 복습 체크리스트

- [ ] Role과 ClusterRole의 차이, RoleBinding과 ClusterRoleBinding의 차이를 설명할 수 있는가?
- [ ] `kubectl auth can-i` 명령어를 사용하여 권한을 확인할 수 있는가?
- [ ] 과도한 RBAC 권한을 식별하고 최소 권한으로 수정할 수 있는가?
- [ ] ClusterRole을 RoleBinding으로 네임스페이스 범위로 제한하는 방법을 아는가?
- [ ] `automountServiceAccountToken: false`를 SA와 Pod 모두에 설정할 수 있는가?
- [ ] default SA에 추가 권한을 부여하면 안 되는 이유를 설명할 수 있는가?
- [ ] API Server 매니페스트의 주요 보안 플래그를 알고 있는가?
- [ ] 매니페스트 수정 후 API server 재시작 절차를 수행할 수 있는가?
- [ ] Audit Policy의 4가지 레벨을 구분할 수 있는가?
- [ ] Audit Policy를 작성하고 API Server에 볼륨 마운트까지 설정할 수 있는가?
- [ ] kubeadm upgrade 절차를 순서대로 수행할 수 있는가?
- [ ] imperative 명령어로 Role, RoleBinding을 빠르게 생성할 수 있는가?

---

> **내일 예고:** Day 5에서는 System Hardening 도메인(15%)의 AppArmor와 seccomp 프로파일을 학습한다.

---

## tart-infra 실습

### 실습 환경 설정

```bash
# platform 클러스터에서 RBAC, SA, API Server 보안 확인
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/platform.yaml
kubectl get nodes
```

### 실습 1: RBAC 최소 권한 원칙 점검

```bash
# ClusterRoleBinding 중 cluster-admin에 바인딩된 Subject 확인
kubectl get clusterrolebindings -o json | python3 -c "
import json, sys
data = json.load(sys.stdin)
for item in data['items']:
    if item.get('roleRef', {}).get('name') == 'cluster-admin':
        subjects = item.get('subjects', [])
        for s in subjects:
            print(f\"{item['metadata']['name']}: {s.get('kind')} {s.get('name')} (ns: {s.get('namespace', 'N/A')})\")" 2>/dev/null || \
kubectl get clusterrolebindings -o custom-columns=NAME:.metadata.name,ROLE:.roleRef.name | grep cluster-admin
```

**동작 원리:** cluster-admin 남용 확인:
1. `cluster-admin` ClusterRole은 모든 리소스에 대한 모든 동작을 허용한다
2. 이 권한에 바인딩된 Subject가 많을수록 보안 위험이 증가한다
3. CKS 시험에서 "과도한 권한을 가진 바인딩을 찾아 수정하라"는 문제가 자주 출제된다
4. 최소 권한 원칙: 필요한 리소스에 대해 필요한 verb만 허용하는 Role을 생성해야 한다

### 실습 2: ServiceAccount 보안 점검

```bash
# 모든 네임스페이스의 ServiceAccount automount 설정 확인
kubectl get serviceaccount -A -o custom-columns=\
NS:.metadata.namespace,\
NAME:.metadata.name,\
AUTOMOUNT:.automountServiceAccountToken
```

**동작 원리:** ServiceAccount 보안 모범 사례:
1. `automountServiceAccountToken: false`를 기본으로 설정하여 불필요한 토큰 마운트를 방지한다
2. default SA에 추가 권한을 부여하면 안 된다 — 전용 SA를 생성해야 한다
3. K8s v1.24+에서는 Bound Token(시간 제한, audience 제한)이 기본이다
4. SA 토큰이 유출되면 해당 SA의 RBAC 권한으로 클러스터에 접근 가능하다

### 실습 3: API Server 보안 플래그 확인

```bash
# API Server 매니페스트의 보안 관련 플래그 확인
kubectl get pod kube-apiserver-platform-master -n kube-system -o yaml | grep -E "(--anonymous|--authorization|--admission|--audit|--profiling|--insecure)"
```

**예상 출력:**
```
    - --authorization-mode=Node,RBAC
    - --enable-admission-plugins=NodeRestriction
```

**동작 원리:** API Server 보안 강화 항목:
1. `--anonymous-auth=false`: 인증되지 않은 요청 차단
2. `--authorization-mode=Node,RBAC`: Node 인가 + RBAC 인가 활성화
3. `--enable-admission-plugins=NodeRestriction`: kubelet이 자신의 노드 리소스만 수정 가능
4. `--profiling=false`: 프로파일링 엔드포인트 비활성화 (정보 노출 방지)
5. `--audit-log-path`: 감사 로그 활성화 — 누가, 언제, 무엇을 했는지 기록

### 실습 4: Audit Policy 확인

```bash
# API Server의 audit 관련 설정 확인
kubectl get pod kube-apiserver-platform-master -n kube-system -o yaml | grep -E "(--audit-)" || echo "Audit logging이 설정되지 않았습니다"
```

**동작 원리:** Audit Policy의 4가지 레벨:
1. **None**: 이벤트 기록하지 않음
2. **Metadata**: 요청 메타데이터(사용자, 리소스, verb 등)만 기록
3. **Request**: 메타데이터 + 요청 본문 기록
4. **RequestResponse**: 메타데이터 + 요청 본문 + 응답 본문 기록

```bash
# Audit Policy 적용 시 필요한 API Server 플래그:
# --audit-policy-file=/etc/kubernetes/audit-policy.yaml
# --audit-log-path=/var/log/kubernetes/audit.log
# --audit-log-maxage=30
# --audit-log-maxsize=100
# --audit-log-maxbackup=10
```
