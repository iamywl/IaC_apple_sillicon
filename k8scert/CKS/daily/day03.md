# CKS Day 3: Cluster Hardening (1/2) - RBAC, ServiceAccount, API Server 보안

> 학습 목표 | CKS 도메인: Cluster Hardening (15%) | 예상 소요 시간: 2시간

---

## 오늘의 학습 목표

- RBAC 최소 권한 원칙을 이해하고 과도한 권한을 축소할 수 있다
- ServiceAccount 토큰 자동 마운트를 비활성화하여 공격 표면을 줄인다
- API Server 보안 설정 플래그를 이해하고 매니페스트를 수정할 수 있다
- Audit Policy를 작성하여 감사 로그를 설정할 수 있다
- kubeadm 클러스터 업그레이드 절차를 수행할 수 있다

---

## 1. RBAC 완전 정복

### 1.1 RBAC 등장 배경

```
RBAC 이전의 Kubernetes 인가 모델
════════════════════════════════

K8s 초기에는 ABAC(Attribute-Based Access Control)를 사용했다.
ABAC는 JSON 파일에 정적 정책을 정의하고, 변경 시 API Server를 재시작해야 했다.
정책 파일이 커질수록 관리가 불가능해졌고, 동적 변경이 불가능했다.

RBAC(K8s v1.6, 2017년 GA)가 도입된 이유:
  - ABAC의 정적 파일 기반 → RBAC는 Kubernetes API 오브젝트로 관리
  - 파일 수정 + 재시작 필요 → kubectl로 동적 생성/수정/삭제
  - 세밀한 권한 제어 불가 → apiGroups/resources/verbs 조합으로 세밀한 제어
  - 감사 불가 → kubectl auth can-i로 권한 검증 가능

공격-방어 매핑:
  공격 벡터                       → 방어 수단(RBAC)
  ─────────────────────────────  → ──────────────────────────────
  SA 토큰 탈취 후 Secret 조회     → Secret 접근 불가한 Role 바인딩
  escalate로 RBAC 자체 변경       → bind/escalate verb 제한
  pods/exec로 셸 접근             → pods/exec 리소스 제외
  와일드카드(*)로 과도한 권한      → 최소 권한 원칙 적용
```

### 1.2 RBAC 인가 모델 개요

```
RBAC(Role-Based Access Control) 인가 모델
══════════════════════════════════════════

RBAC은 주체(Subject)에게 역할(Role)을 바인딩하여 API 리소스에 대한
접근 권한을 제어하는 인가(Authorization) 메커니즘이다.
kube-apiserver의 --authorization-mode=RBAC 플래그로 활성화된다.

구성 요소:
- Subject: User, Group, ServiceAccount — API 요청의 인증된 주체
- Role: 특정 네임스페이스 범위 내에서 apiGroups, resources, verbs 조합으로 권한을 정의
- ClusterRole: 클러스터 전역 범위의 권한 정의 (네임스페이스 비종속 리소스 포함)
- RoleBinding: Subject와 Role을 연결하여 네임스페이스 범위 내 인가를 부여
- ClusterRoleBinding: Subject와 ClusterRole을 연결하여 클러스터 전역 인가를 부여
- Verbs: get, list, watch, create, update, patch, delete 등 API 동작 단위

인가 판정 흐름:
  API 요청 수신 → 인증(Authentication) → RBAC 인가(Authorization)
  → 해당 Subject에 바인딩된 Role/ClusterRole의 rules를 순회
  → 매칭되는 allow 규칙이 있으면 ALLOW, 없으면 DENY (기본 거부 정책)
```

### 1.3 RBAC 동작 원리

```
RBAC 인가 흐름도
════════════════

사용자/ServiceAccount → API Server 요청
                           │
                           ▼
                    1. 인증(Authentication)
                    "이 사용자가 누구인가?"
                    (인증서, 토큰, OIDC 등)
                           │
                           ▼
                    2. 인가(Authorization)
                    "이 사용자가 이 작업을 할 수 있는가?"
                    ┌──────────────────────────────┐
                    │ RBAC 엔진이 확인하는 것:       │
                    │                              │
                    │ Q1. 이 사용자에게 바인딩된     │
                    │     Role/ClusterRole이 있는가? │
                    │                              │
                    │ Q2. 해당 Role에 이 리소스에    │
                    │     대한 이 verb가 있는가?     │
                    │                              │
                    │ Q3. 네임스페이스가 일치하는가?  │
                    │     (Role: 네임스페이스 범위)   │
                    │     (ClusterRole: 클러스터 범위)│
                    └──────────────────────────────┘
                           │
                    ├─ 허용: 요청 처리
                    └─ 거부: 403 Forbidden

중요: RBAC는 "허용" 모델이다.
      명시적으로 허용하지 않은 모든 것은 거부된다.
      "거부" 규칙은 없다 (허용만 있다).
```

### 1.4 RBAC 4가지 리소스 상세

```yaml
# ═══════════════════════════════════════════
# 1. Role: 네임스페이스 범위의 권한 정의
# ═══════════════════════════════════════════
apiVersion: rbac.authorization.k8s.io/v1  # RBAC API 그룹
kind: Role                                 # 네임스페이스 범위
metadata:
  name: pod-reader                         # Role 이름
  namespace: production                    # 이 네임스페이스 내에서만 유효
rules:
- apiGroups: [""]                          # "" = core API 그룹 (Pod, Service, Secret 등)
                                           # "apps" = Deployment, StatefulSet 등
                                           # "rbac.authorization.k8s.io" = RBAC 리소스
  resources: ["pods", "pods/log"]          # 접근할 리소스 종류
                                           # pods/log = 하위 리소스 (kubectl logs)
                                           # pods/exec = kubectl exec
  verbs: ["get", "list", "watch"]          # 허용할 동작
                                           # get: 단일 조회, list: 목록 조회
                                           # watch: 변경 감시 (실시간)

# ═══════════════════════════════════════════
# 2. ClusterRole: 클러스터 전체 범위의 권한 정의
# ═══════════════════════════════════════════
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole                          # 클러스터 전체 범위
metadata:
  name: node-reader                        # ClusterRole 이름
  # namespace 없음! 클러스터 전체에 적용
rules:
- apiGroups: [""]
  resources: ["nodes"]                     # Node는 네임스페이스가 없는 리소스
  verbs: ["get", "list", "watch"]          # 읽기만 허용
- apiGroups: [""]
  resources: ["persistentvolumes"]         # PV도 클러스터 범위 리소스
  verbs: ["get", "list"]

# ═══════════════════════════════════════════
# 3. RoleBinding: Role/ClusterRole을 주체에 바인딩 (네임스페이스 범위)
# ═══════════════════════════════════════════
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: read-pods                          # RoleBinding 이름
  namespace: production                    # 이 네임스페이스에서만 유효
subjects:                                  # 권한을 받을 주체 (누구에게)
- kind: User                              # 사용자
  name: jane                               # 사용자 이름
  apiGroup: rbac.authorization.k8s.io
- kind: ServiceAccount                    # 서비스 어카운트
  name: app-sa                             # SA 이름
  namespace: production                    # SA가 속한 네임스페이스
- kind: Group                             # 그룹
  name: dev-team                           # 그룹 이름
  apiGroup: rbac.authorization.k8s.io
roleRef:                                   # 참조할 Role (무엇을)
  kind: Role                               # Role 또는 ClusterRole
  name: pod-reader                         # Role 이름
  apiGroup: rbac.authorization.k8s.io

# ═══════════════════════════════════════════
# 4. ClusterRoleBinding: ClusterRole을 클러스터 전체에 바인딩
# ═══════════════════════════════════════════
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: read-nodes-global                  # ClusterRoleBinding 이름
  # namespace 없음!
subjects:
- kind: User
  name: jane
  apiGroup: rbac.authorization.k8s.io
roleRef:
  kind: ClusterRole                        # ClusterRole만 참조 가능
  name: node-reader
  apiGroup: rbac.authorization.k8s.io
```

### 1.5 최소 권한 원칙 - BAD vs GOOD

```yaml
# ═══════════════════════════════════════════
# BAD: 과도한 권한 (시험에서 "이것을 수정하라"로 출제)
# ═══════════════════════════════════════════
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: dev-team-bad
  namespace: production
rules:
- apiGroups: ["*"]       # 모든 API 그룹 → 위험!
  resources: ["*"]       # 모든 리소스 → 위험!
  verbs: ["*"]           # 모든 동작 → 위험!
# 이것은 사실상 namespace-admin이다.
# Secret 조회, Pod exec, RBAC 변경 모두 가능 → 보안 위반

# ═══════════════════════════════════════════
# GOOD: 최소 권한만 명시적으로 지정
# ═══════════════════════════════════════════
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: dev-team-good
  namespace: production
rules:
- apiGroups: [""]               # core 그룹만
  resources: ["pods", "services"]  # Pod, Service만
  verbs: ["get", "list", "watch"]  # 읽기만
- apiGroups: ["apps"]           # apps 그룹
  resources: ["deployments"]    # Deployment만
  verbs: ["get", "list", "watch", "update"]  # 읽기 + 업데이트
- apiGroups: [""]
  resources: ["configmaps"]     # ConfigMap만
  verbs: ["get", "list"]        # 읽기만
# Secret은 포함하지 않음! → 민감 정보 접근 차단
# delete는 포함하지 않음! → 실수로 삭제 방지
# create는 포함하지 않음! → 무분별한 리소스 생성 방지
```

### 1.6 주요 verb 상세

```
RBAC verb 목록과 설명
════════════════════

verb              | kubectl 명령어       | 설명
──────────────────┼─────────────────────┼──────────────────────────
get               | kubectl get pod X    | 특정 리소스 한 개 조회
list              | kubectl get pods     | 리소스 목록 조회
watch             | kubectl get -w       | 리소스 변경 실시간 감시
create            | kubectl create/apply | 새 리소스 생성
update            | kubectl edit/apply   | 리소스 전체 수정
patch             | kubectl patch        | 리소스 부분 수정
delete            | kubectl delete pod X | 특정 리소스 삭제
deletecollection  | kubectl delete pods  | 리소스 일괄 삭제
bind              |                      | RoleBinding 생성 (특수)
escalate          |                      | RBAC 권한 상승 (특수)
impersonate       | --as=jane            | 다른 사용자로 가장

주의해야 할 위험한 권한 조합:
  - pods/exec + create → 컨테이너 내에서 명령어 실행 가능 → 사실상 root
  - secrets + get/list → 모든 Secret(비밀번호, 토큰) 조회 가능
  - * (와일드카드) → 해당 범위의 모든 권한
  - bind/escalate → RBAC 자체를 변경하여 권한 상승 가능
```

### 1.7 권한 확인 명령어와 실습 검증

```bash
# 특정 사용자의 권한 확인
kubectl auth can-i create pods --as=jane -n production
```

```text
yes
```

```bash
# ServiceAccount의 권한 확인 (형식: system:serviceaccount:<ns>:<name>)
kubectl auth can-i get secrets \
  --as=system:serviceaccount:production:app-sa -n production
```

```text
no
```

```bash
# 모든 권한 나열
kubectl auth can-i --list --as=jane -n production
```

```text
Resources                                       Non-Resource URLs   Resource Names   Verbs
pods                                            []                  []               [get list watch]
services                                        []                  []               [get list watch]
deployments.apps                                []                  []               [get list watch update]
selfsubjectaccessreviews.authorization.k8s.io   []                  []               [create]
```

```bash

# cluster-admin 바인딩된 주체 찾기 (보안 감사)
kubectl get clusterrolebindings -o json | \
  jq '.items[] | select(.roleRef.name == "cluster-admin") |
  {name: .metadata.name, subjects: .subjects}'

# 특정 네임스페이스의 모든 Role/RoleBinding 확인
kubectl get roles,rolebindings -n production -o wide

# 클러스터 수준 RBAC 확인
kubectl get clusterroles,clusterrolebindings | head -30
```

### 1.8 imperative 명령어로 RBAC 생성 (시험에서 빠르게 작성)

```bash
# Role 생성
kubectl create role pod-reader \
  --verb=get,list,watch \
  --resource=pods \
  -n production

# RoleBinding 생성 (ServiceAccount에 바인딩)
kubectl create rolebinding pod-reader-binding \
  --role=pod-reader \
  --serviceaccount=production:app-sa \
  -n production

# RoleBinding 생성 (User에 바인딩)
kubectl create rolebinding pod-reader-jane \
  --role=pod-reader \
  --user=jane \
  -n production

# ClusterRole 생성
kubectl create clusterrole node-reader \
  --verb=get,list,watch \
  --resource=nodes

# ClusterRoleBinding 생성
kubectl create clusterrolebinding node-reader-binding \
  --clusterrole=node-reader \
  --user=jane

# ClusterRole을 RoleBinding으로 바인딩 (네임스페이스 범위 제한)
# → 이것이 CKS에서 자주 출제되는 패턴!
kubectl create rolebinding secret-reader-in-prod \
  --clusterrole=secret-reader \
  --user=jane \
  -n production
# jane은 production 네임스페이스에서만 secret-reader 권한을 가진다

# dry-run으로 YAML 확인 후 적용
kubectl create role pod-reader \
  --verb=get,list,watch \
  --resource=pods \
  -n production --dry-run=client -o yaml
```

### 1.9 ClusterRole을 RoleBinding으로 범위 제한

```
ClusterRole + RoleBinding = 네임스페이스 범위로 제한
═══════════════════════════════════════════════════

이 패턴은 CKS에서 매우 자주 출제된다!

ClusterRole: "secrets에 대한 get, list 권한"
  ↓
ClusterRoleBinding으로 바인딩 → 모든 네임스페이스의 Secret 접근 가능
  ↓
RoleBinding으로 바인딩 → 특정 네임스페이스의 Secret만 접근 가능

예: jane이 production에서만 Secret을 읽을 수 있게 하고 싶다면?
  → ClusterRole + RoleBinding (namespace: production)
```

```yaml
# ClusterRole 정의 (클러스터 전체에서 재사용 가능한 템플릿)
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: secret-reader                     # 이 ClusterRole은 여러 곳에서 재사용 가능
rules:
- apiGroups: [""]
  resources: ["secrets"]
  verbs: ["get", "list"]
---
# RoleBinding으로 바인딩 → production 네임스페이스로 범위 제한!
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding                          # ClusterRoleBinding이 아님!
metadata:
  name: read-secrets-in-production
  namespace: production                    # 이 네임스페이스에서만 유효
subjects:
- kind: User
  name: jane
  apiGroup: rbac.authorization.k8s.io
roleRef:
  kind: ClusterRole                        # ClusterRole을 참조하되
  name: secret-reader
  apiGroup: rbac.authorization.k8s.io
# 결과: jane은 production 네임스페이스의 Secret만 get, list 가능
#       다른 네임스페이스의 Secret은 접근 불가!
```

---

## 2. ServiceAccount 토큰 제한

### 2.1 ServiceAccount 토큰 메커니즘

```
ServiceAccount 토큰 발급 및 인증 구조
═════════════════════════════════════

ServiceAccount는 Pod 내 프로세스가 kube-apiserver에 인증할 때 사용하는
Kubernetes 네이티브 인증 주체(identity)이다.

토큰 메커니즘:
- kubelet이 Pod 생성 시 TokenRequest API를 통해 시간 제한(bound) JWT를 발급받는다
- 발급된 JWT는 /var/run/secrets/kubernetes.io/serviceaccount/token에 projected volume으로 마운트된다
- JWT의 payload에는 iss(issuer), sub(subject=SA), aud(audience), exp(expiry) 클레임이 포함된다
- kube-apiserver는 이 JWT의 서명을 검증하여 요청 주체를 인증(Authentication)한다

보안 위험:
- 모든 Pod는 기본적으로 "default" ServiceAccount의 토큰을 자동 마운트한다
- 대부분의 애플리케이션은 kube-apiserver API 호출이 불필요하므로 토큰이 불필요하다
- 토큰이 노출되면 공격자가 해당 SA에 바인딩된 RBAC 권한으로 클러스터 API를 호출할 수 있다
- automountServiceAccountToken: false 설정으로 불필요한 토큰 마운트를 차단해야 한다
```

### 2.2 토큰 자동 마운트 비활성화

```yaml
# ═══════════════════════════════════════════
# 방법 1: ServiceAccount에서 설정
# ═══════════════════════════════════════════
apiVersion: v1
kind: ServiceAccount
metadata:
  name: secure-sa
  namespace: production
automountServiceAccountToken: false        # SA 수준에서 비활성화
                                           # 이 SA를 사용하는 모든 Pod에 적용

# ═══════════════════════════════════════════
# 방법 2: Pod에서 설정 (SA 설정보다 우선)
# ═══════════════════════════════════════════
---
apiVersion: v1
kind: Pod
metadata:
  name: secure-pod
  namespace: production
spec:
  serviceAccountName: secure-sa            # 커스텀 SA 사용
  automountServiceAccountToken: false      # Pod 수준에서 비활성화
                                           # Pod 설정이 SA 설정보다 우선!
  containers:
  - name: app
    image: nginx:1.25
```

```
토큰 마운트 우선순위:
══════════════════

1. Pod spec에 automountServiceAccountToken이 있으면 → Pod 설정 적용
2. Pod spec에 없으면 → ServiceAccount 설정 적용
3. 둘 다 없으면 → 기본값 true (토큰 마운트됨)

CKS 시험에서는 둘 다 설정하는 것이 안전하다:
  - SA에 automountServiceAccountToken: false
  - Pod에도 automountServiceAccountToken: false
```

### 2.3 토큰 마운트 검증

```bash
# 토큰이 마운트되지 않았는지 확인
kubectl exec secure-pod -n production -- \
  ls /var/run/secrets/kubernetes.io/serviceaccount/ 2>&1
```

```text
ls: /var/run/secrets/kubernetes.io/serviceaccount/: No such file or directory
```

토큰이 마운트되지 않은 것을 확인했다. 이는 automountServiceAccountToken: false 설정이 정상 적용된 것이다.

```bash
# 대조군: 기본 Pod에서 토큰 확인
kubectl run default-pod --image=nginx:alpine -n production
kubectl exec default-pod -n production -- \
  ls /var/run/secrets/kubernetes.io/serviceaccount/
```

```text
ca.crt  namespace  token
```

기본 Pod에는 토큰이 마운트되어 있다. 이 토큰으로 API Server에 인증이 가능하므로 보안 위험이 존재한다.

```bash
# JWT 토큰의 payload 확인 (디버깅용)
kubectl exec default-pod -n production -- \
  cat /var/run/secrets/kubernetes.io/serviceaccount/token | \
  cut -d'.' -f2 | base64 -d 2>/dev/null | python3 -m json.tool
```

```text
{
    "aud": ["https://kubernetes.default.svc.cluster.local"],
    "exp": 1743388800,
    "iss": "https://kubernetes.default.svc.cluster.local",
    "sub": "system:serviceaccount:production:default"
}
```

### 2.4 워크로드별 전용 ServiceAccount 패턴

```yaml
# 전용 SA + 최소 권한 Role + RoleBinding + Pod
# ─────────────────────────────────────────────
# 모범 사례: default SA 사용 금지, 워크로드별 전용 SA 생성

# 1. 전용 ServiceAccount
apiVersion: v1
kind: ServiceAccount
metadata:
  name: web-app-sa                         # 워크로드 전용 SA
  namespace: production
automountServiceAccountToken: false        # 기본 비활성화
---
# 2. 최소 권한 Role
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: web-app-role
  namespace: production
rules:
- apiGroups: [""]
  resources: ["configmaps"]                # ConfigMap만 읽기
  verbs: ["get"]
  resourceNames: ["web-app-config"]        # 특정 리소스 이름만! (최소 권한)
---
# 3. RoleBinding
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: web-app-binding
  namespace: production
subjects:
- kind: ServiceAccount
  name: web-app-sa
  namespace: production
roleRef:
  kind: Role
  name: web-app-role
  apiGroup: rbac.authorization.k8s.io
---
# 4. Pod
apiVersion: v1
kind: Pod
metadata:
  name: web-app
  namespace: production
spec:
  serviceAccountName: web-app-sa           # 전용 SA 사용
  automountServiceAccountToken: false      # 불필요하면 비활성화
  containers:
  - name: web
    image: nginx:1.25
```

---

## 3. API Server 보안 설정

### 3.1 API Server 보안 아키텍처

```
kube-apiserver 보안 구성 요소
═════════════════════════════

kube-apiserver는 클러스터의 유일한 API 엔드포인트로, 모든 클러스터 상태 변경이
이 프로세스를 통과한다. 요청 처리 파이프라인은 다음 단계를 거친다:
  Authentication → Authorization → Admission Control → etcd 저장

핵심 보안 플래그:
  - --anonymous-auth=false: 인증되지 않은 요청을 거부 (기본값 true이므로 명시적 비활성화 필요)
  - --authorization-mode=Node,RBAC: Node 인가 + RBAC 인가 모드 활성화
  - --enable-admission-plugins: NodeRestriction, PodSecurity 등 Admission Controller 활성화
  - --audit-log-path: API 요청에 대한 감사 로그 파일 경로 지정
  - --insecure-port=0: 비인증/비암호화 포트 완전 비활성화 (v1.24+에서 제거됨)

API Server Static Pod 수정 절차:
  1. /etc/kubernetes/manifests/kube-apiserver.yaml 수정
  2. kubelet의 staticPodPath watcher가 매니페스트 변경을 감지하여 Pod를 자동 재생성
  3. API Server 프로세스가 재시작될 때까지 대기 (약 30-60초)
  4. kubectl get nodes로 정상 동작 확인
```

### 3.2 핵심 보안 플래그 상세

```yaml
# /etc/kubernetes/manifests/kube-apiserver.yaml
spec:
  containers:
  - command:
    - kube-apiserver

    # ═══ 인증(Authentication) 관련 ═══
    - --anonymous-auth=false               # 익명 요청 거부
                                           # true: 인증 없이 API 접근 가능 → 위험!
                                           # false: 인증 필수 → 권장

    # ═══ 인가(Authorization) 관련 ═══
    - --authorization-mode=Node,RBAC       # 인가 모드
                                           # Node: kubelet의 요청을 인가
                                           # RBAC: 역할 기반 접근 제어
                                           # AlwaysAllow → 절대 사용 금지!

    # ═══ Admission Controller ═══
    - --enable-admission-plugins=NodeRestriction,PodSecurity
                                           # NodeRestriction: kubelet이 자기 노드의
                                           #   Pod/Node만 수정 가능하게 제한
                                           # PodSecurity: Pod Security Standards 적용
                                           # 추가 가능: ImagePolicyWebhook

    # ═══ 비암호화 접근 차단 ═══
    # --insecure-bind-address 라인이 있으면 삭제!
    # --insecure-port=0                    # 비암호화 포트 비활성화

    # ═══ 프로파일링 ═══
    - --profiling=false                    # 프로파일링 비활성화
                                           # true: /debug/pprof/ 엔드포인트 노출

    # ═══ kubelet 통신 보안 ═══
    - --kubelet-certificate-authority=/etc/kubernetes/pki/ca.crt
                                           # kubelet의 인증서를 CA로 검증
                                           # 없으면 kubelet 위장 공격 가능

    # ═══ etcd 통신 보안 ═══
    - --etcd-cafile=/etc/kubernetes/pki/etcd/ca.crt
    - --etcd-certfile=/etc/kubernetes/pki/apiserver-etcd-client.crt
    - --etcd-keyfile=/etc/kubernetes/pki/apiserver-etcd-client.key
                                           # etcd와 TLS로 통신
                                           # 설정 안 하면 평문 통신 → 데이터 탈취 가능
```

### 3.3 Admission Controller 상세

```
Admission Controller 처리 흐름
═════════════════════════════

API 요청 → 인증 → 인가 → Mutating Admission → Validating Admission → etcd 저장
                          │                      │
                          │ 요청을 수정          │ 요청을 검증
                          │ (기본값 추가 등)      │ (정책 위반 시 거부)
                          │                      │
                          ├─ MutatingAdmission    ├─ ValidatingAdmission
                          │   Webhook             │   Webhook
                          └─ 빌트인 Mutating      └─ 빌트인 Validating
                              Admission               Admission

CKS에서 중요한 Admission Controller:
─────────────────────────────────────

NodeRestriction
  - kubelet이 자기 노드에 할당된 Pod/Node만 수정 가능
  - 다른 노드의 라벨 수정 불가 (node-restriction.kubernetes.io/ 접두사)
  - 없으면: 침해된 kubelet이 다른 노드를 조작 가능

PodSecurity
  - Pod Security Standards (Privileged/Baseline/Restricted) 적용
  - PSP(PodSecurityPolicy)의 후속 → K8s 1.25부터 PSP 제거됨

ImagePolicyWebhook
  - Pod가 사용하는 이미지를 외부 웹훅으로 검증
  - 승인된 레지스트리의 이미지만 허용 가능
  - defaultAllow: false → fail-closed (보안 권장)
```

---

## 4. RBAC/ServiceAccount/API Server 트러블슈팅

```
Cluster Hardening 보안 설정 장애 시나리오
════════════════════════════════════════

시나리오 1: RBAC 권한 수정 후 사용자가 여전히 Secret에 접근 가능하다
  원인: ClusterRoleBinding이 남아 있어 ClusterRole이 전역 범위로 적용된다
  디버깅:
    kubectl get clusterrolebindings -o json | \
      jq '.items[] | select(.subjects[]?.name == "jane") | .metadata.name'
  해결: 불필요한 ClusterRoleBinding을 삭제한다

시나리오 2: automountServiceAccountToken: false를 설정했는데 토큰이 여전히 마운트된다
  원인: Pod spec에 명시적으로 automountServiceAccountToken: true가 있으면 SA 설정보다 우선한다
  디버깅:
    kubectl get pod <pod> -o jsonpath='{.spec.automountServiceAccountToken}'
  해결: Pod spec에서도 automountServiceAccountToken: false를 설정한다

시나리오 3: API Server에 --anonymous-auth=false 설정 후 liveness probe가 실패한다
  원인: kubelet의 liveness probe가 인증 없이 /livez 엔드포인트에 접근하기 때문이다
  디버깅:
    crictl logs <apiserver-container-id> 2>&1 | grep "livez"
  해결: --anonymous-auth=false와 함께 kubelet이 인증서 기반으로 API Server에 접근하도록 구성한다.
        또는 liveness probe를 인증 가능한 경로로 변경한다.

시나리오 4: kubectl auth can-i에서 yes인데 실제 요청은 403 Forbidden이다
  원인: Admission Controller(PodSecurity, OPA Gatekeeper)가 인가 후 추가 검증에서 거부한다
  디버깅:
    kubectl create <resource> --dry-run=server -o yaml 2>&1  # Admission 에러 확인
  해결: RBAC는 인가(Authorization) 단계이고, Admission은 별도 단계이다. Admission 정책을 확인한다.
```

---

## tart-infra 실습

### 실습 환경 설정

```bash
# dev 클러스터 접속
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/dev.yaml

# 클러스터 상태 확인
kubectl get nodes
kubectl get ns
```

### 과제 1: ServiceAccount 토큰 마운트 상태 점검

demo 네임스페이스의 Pod들이 불필요한 ServiceAccount 토큰을 마운트하고 있는지 점검한다.

```bash
# demo 네임스페이스의 모든 Pod에서 automountServiceAccountToken 설정 확인
kubectl get pods -n demo -o jsonpath='{range .items[*]}Pod: {.metadata.name}  automount: {.spec.automountServiceAccountToken}{"\n"}{end}'

# 예상 출력:
# Pod: frontend-xxx  automount: false
# Pod: backend-xxx   automount: false

# 토큰이 실제로 마운트되지 않았는지 검증
kubectl exec -n demo deploy/frontend -- \
  ls /var/run/secrets/kubernetes.io/serviceaccount/ 2>&1
# 예상 출력: No such file or directory (토큰 미마운트 → 보안 양호)

# SecurityContext 설정 확인 (보안 관련 필드)
kubectl get pods -n demo -o jsonpath='{range .items[*]}Pod: {.metadata.name}  SA: {.spec.serviceAccountName}{"\n"}{end}'
```

**동작 원리:** automountServiceAccountToken: false가 설정되면 kubelet이 Pod 생성 시 TokenRequest API를 호출하지 않으므로 projected volume이 마운트되지 않는다. 토큰이 없으면 공격자가 Pod를 침해하더라도 kube-apiserver에 인증할 수 없어 클러스터 API 접근이 차단된다.

### 과제 2: RBAC 권한 감사 - cluster-admin 바인딩 확인

클러스터에서 cluster-admin 권한이 바인딩된 주체를 식별하고 과도한 권한이 없는지 점검한다.

```bash
# cluster-admin ClusterRoleBinding 확인
kubectl get clusterrolebindings -o json | \
  jq -r '.items[] | select(.roleRef.name == "cluster-admin") | "\(.metadata.name): \(.subjects // [] | map("\(.kind)/\(.name)") | join(", "))"'

# 예상 출력:
# cluster-admin: User/kubernetes-admin
# system:masters: Group/system:masters

# demo 네임스페이스의 Role/RoleBinding 확인
kubectl get roles,rolebindings -n demo

# 특정 ServiceAccount의 실제 권한 범위 확인
kubectl auth can-i --list --as=system:serviceaccount:demo:default -n demo
```

**동작 원리:** RBAC 엔진은 요청마다 Subject에 바인딩된 모든 Role/ClusterRole의 rules를 순회한다. cluster-admin은 모든 리소스에 대한 와일드카드(*) 권한을 가지므로, 이 바인딩이 불필요한 주체에 할당되면 최소 권한 원칙 위반이다.

### 과제 3: 멀티 클러스터 RBAC 비교

dev/staging/prod 클러스터 간 RBAC 설정 차이를 비교하여 환경별 보안 수준을 점검한다.

```bash
# dev 클러스터의 ClusterRoleBinding 수
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/dev.yaml
echo "=== dev ===" && kubectl get clusterrolebindings --no-headers | wc -l

# staging 클러스터
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/staging.yaml
echo "=== staging ===" && kubectl get clusterrolebindings --no-headers | wc -l

# prod 클러스터
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/prod.yaml
echo "=== prod ===" && kubectl get clusterrolebindings --no-headers | wc -l

# 예상: prod가 가장 적은 바인딩을 가져야 한다 (최소 권한 원칙)
```

**동작 원리:** 프로덕션 환경에서는 최소 권한 원칙을 더 엄격하게 적용해야 한다. ClusterRoleBinding 수가 많을수록 공격 표면이 넓어지며, 특히 cluster-admin 바인딩은 프로덕션에서 최소화해야 한다.

---

> **내일 예고:** Day 4에서는 Cluster Hardening 도메인의 나머지 주제인 감사 로그(Audit Policy), kubeadm 업그레이드, 시험 출제 패턴, 실전 문제를 다룬다.
