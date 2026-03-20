# KCSA Day 5: RBAC 심화, ServiceAccount, Pod Security Standards

> **시험 비중:** Kubernetes Security Fundamentals — 22% (Cluster Component와 공동 최고 비중)
> **목표:** RBAC 4대 구성 요소를 완벽히 이해하고, ServiceAccount/Bound Token 메커니즘, PSS 3단계 레벨과 PSA 적용 방법을 마스터한다.

---

## 1. RBAC (Role-Based Access Control) 심화

### 1.1 RBAC의 4대 리소스

```
RBAC는 "누가(Subject) + 무엇을(Resource) + 어떻게(Verb)" 할 수 있는지 정의한다.

4대 리소스 구조:

┌───────────────────────────────────────────────────────────┐
│                    RBAC 4대 리소스                          │
│                                                           │
│  권한 정의 (What)              바인딩 (Who + What)         │
│  ┌──────────────┐             ┌────────────────────┐      │
│  │ Role         │─────────────│ RoleBinding        │      │
│  │ (NS 범위)    │             │ (NS 범위)          │      │
│  └──────────────┘             └────────────────────┘      │
│                                                           │
│  ┌──────────────┐             ┌────────────────────┐      │
│  │ ClusterRole  │─────────────│ ClusterRoleBinding │      │
│  │ (클러스터 범위)│             │ (클러스터 범위)     │      │
│  └──────────────┘             └────────────────────┘      │
│                                                           │
│  중요: ClusterRole + RoleBinding = 해당 NS에서만 적용!     │
│  (ClusterRole 재사용의 유용한 패턴)                        │
└───────────────────────────────────────────────────────────┘
```

### 1.2 Role vs ClusterRole 범위 비교

| 구분 | Role | ClusterRole |
|------|------|-------------|
| **범위** | 단일 네임스페이스 | 클러스터 전체 |
| **리소스** | NS 리소스 (pods, services 등) | 모든 리소스 + 비리소스 URL |
| **비리소스 URL** | 불가 (/healthz, /metrics 등) | 가능 |
| **노드** | 불가 | 가능 |
| **PV** | 불가 | 가능 |
| **NS** | 불가 | 가능 |
| **생성 위치** | 특정 네임스페이스 내 | 클러스터 레벨 |

### 1.3 RBAC YAML 상세

#### Role 예제 (NS 범위)

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: pod-reader
  namespace: production    # 이 네임스페이스에서만 유효
rules:
  - apiGroups: [""]        # "" = core API group
    resources: ["pods"]    # 대상 리소스
    verbs: ["get", "watch", "list"]  # 허용 동작
    # resourceNames: ["my-pod"]  ← 특정 리소스 이름으로 제한 가능

  - apiGroups: [""]
    resources: ["pods/log"]  # 서브리소스
    verbs: ["get"]

  # 주요 verb:
  # get, list, watch      ← 읽기
  # create                ← 생성
  # update, patch         ← 수정
  # delete, deletecollection ← 삭제
  # ★ escalate, bind, impersonate ← 위험! (권한 상승 가능)
```

#### ClusterRole 예제 (클러스터 범위)

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: secret-reader
  # namespace 없음 (클러스터 범위)
rules:
  - apiGroups: [""]
    resources: ["secrets"]
    verbs: ["get", "list"]

  # 비리소스 URL 접근 (ClusterRole만 가능!)
  - nonResourceURLs: ["/healthz", "/metrics"]
    verbs: ["get"]
```

#### RoleBinding 예제

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: read-pods
  namespace: production
subjects:
  # 사용자 바인딩
  - kind: User
    name: jane@example.com
    apiGroup: rbac.authorization.k8s.io

  # 그룹 바인딩
  - kind: Group
    name: dev-team
    apiGroup: rbac.authorization.k8s.io

  # ServiceAccount 바인딩
  - kind: ServiceAccount
    name: monitoring-sa
    namespace: monitoring    # SA의 네임스페이스 (다른 NS도 가능)

roleRef:
  kind: ClusterRole          # ★ ClusterRole을 RoleBinding으로!
  name: secret-reader        #   → production NS에서만 적용
  apiGroup: rbac.authorization.k8s.io
  # roleRef는 변경 불가! → 삭제 후 재생성 필요
```

#### ClusterRoleBinding 예제

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: cluster-admin-binding
subjects:
  - kind: User
    name: admin@example.com
    apiGroup: rbac.authorization.k8s.io
roleRef:
  kind: ClusterRole
  name: cluster-admin        # 모든 리소스에 모든 권한
  apiGroup: rbac.authorization.k8s.io
  # ★ cluster-admin = system:masters 수준
  # 최소 권한 원칙에 따라 꼭 필요한 경우에만 사용!
```

### 1.4 ClusterRole + RoleBinding 패턴 (핵심!)

```
ClusterRole을 다양한 네임스페이스에서 재사용하는 패턴:

[ClusterRole: pod-manager]
  rules: pods에 대한 get/create/delete

                    ┌──────── [RoleBinding in ns-a]
                    │         → ns-a에서만 pod-manager 권한
                    │
[ClusterRole] ──────┼──────── [RoleBinding in ns-b]
                    │         → ns-b에서만 pod-manager 권한
                    │
                    └──────── [ClusterRoleBinding]
                              → 모든 NS에서 pod-manager 권한

★ 시험 빈출: "ClusterRole을 RoleBinding으로 바인딩하면?" → 해당 NS에서만!
```

### 1.5 RBAC 위험 verb 분석

```
위험한 verb (권한 상승 가능):

┌──────────────────────────────────────────────────┐
│ escalate                                         │
│  → Role/ClusterRole의 권한을 확대할 수 있음        │
│  → 자기 자신보다 높은 권한을 부여 가능!            │
│                                                  │
│ bind                                             │
│  → RoleBinding/ClusterRoleBinding 생성 가능       │
│  → 임의의 Role에 자신을 바인딩 가능!               │
│                                                  │
│ impersonate                                      │
│  → 다른 사용자/그룹/SA로 위장 가능                 │
│  → kubectl --as=admin 형태로 사용                 │
│                                                  │
│ ★ 이 3개 verb는 절대 일반 사용자에게 부여하면 안 됨! │
└──────────────────────────────────────────────────┘

시험 패턴: "RBAC에서 escalate verb가 위험한 이유는?"
→ Role 권한을 상승시킬 수 있기 때문
```

### 1.6 기본 제공 ClusterRole

```
Kubernetes 기본 제공 ClusterRole:

┌──────────────┬───────────────────────────────────────┐
│ cluster-admin │ 모든 리소스에 모든 권한                 │
│              │ ★ system:masters 그룹에 바인딩됨        │
│              │ ★ 모든 RBAC를 우회! 비상 시에만 사용!    │
├──────────────┼───────────────────────────────────────┤
│ admin        │ 네임스페이스 내 대부분 리소스 관리        │
│              │ RBAC/ResourceQuota 편집 불가            │
├──────────────┼───────────────────────────────────────┤
│ edit         │ 네임스페이스 내 리소스 읽기/쓰기         │
│              │ Role/RoleBinding 편집 불가               │
├──────────────┼───────────────────────────────────────┤
│ view         │ 네임스페이스 내 리소스 읽기 전용          │
│              │ Secret 읽기 불가                        │
└──────────────┴───────────────────────────────────────┘

시험 패턴: "system:masters 그룹의 특징은?"
→ 모든 RBAC 검사를 우회한다 (매우 위험!)
```

### 1.7 RBAC 권한 확인 명령어

```bash
# 현재 사용자 권한 확인
kubectl auth can-i create pods
kubectl auth can-i delete secrets -n production

# 다른 사용자 권한 확인 (관리자만)
kubectl auth can-i create pods --as=jane@example.com
kubectl auth can-i get secrets --as=system:serviceaccount:default:my-sa

# 모든 권한 나열
kubectl auth can-i --list
kubectl auth can-i --list --as=jane@example.com -n production

# RBAC 리소스 조회
kubectl get roles,rolebindings -n production
kubectl get clusterroles,clusterrolebindings
```

### 1.8 RBAC 보안 모범 사례

```
RBAC 보안 Best Practice:

1. 최소 권한 원칙 (Least Privilege)
   - 와일드카드(*) 사용 금지
   - 필요한 리소스/verb만 명시
   - resourceNames로 특정 리소스 제한

2. 정기적 권한 감사
   - 미사용 Role/Binding 정리
   - cluster-admin 바인딩 최소화
   - kubectl auth can-i --list로 권한 검토

3. 위험 verb 제한
   - escalate, bind, impersonate 부여 금지
   - create pods/exec 신중히 부여 (컨테이너 내 명령 실행)

4. 네임스페이스 분리
   - 환경(dev/staging/prod)별 네임스페이스 분리
   - 팀별 네임스페이스 할당
   - ClusterRole + RoleBinding 패턴으로 재사용
```

### 1.9 RBAC 권한 점검 도구

```
RBAC 점검 도구:

┌────────────────┬─────────────────────────────────────┐
│ kubectl auth   │ 기본 내장 권한 확인                    │
│ can-i          │ kubectl auth can-i verb resource     │
├────────────────┼─────────────────────────────────────┤
│ rakkess        │ 전체 리소스에 대한 접근 행렬 표시       │
│                │ kubectl access-matrix                │
├────────────────┼─────────────────────────────────────┤
│ rbac-lookup    │ RBAC 바인딩 조회 도구                  │
│                │ 사용자/SA별 바인딩 관계 시각화           │
├────────────────┼─────────────────────────────────────┤
│ kubectl-who-can│ "누가 이 리소스에 이 동작을 할 수       │
│                │  있는가?" 역방향 조회                   │
└────────────────┴─────────────────────────────────────┘
```

---

## 2. ServiceAccount와 Token 관리

### 2.1 ServiceAccount 기본 개념

```
ServiceAccount(SA)는 Pod가 API Server에 접근할 때 사용하는 ID이다.

SA 핵심 규칙:
1. 각 네임스페이스에 "default" SA가 자동 생성된다
2. Pod 생성 시 명시하지 않으면 "default" SA가 자동 할당된다
3. SA 토큰은 Projected Volume으로 Pod에 마운트된다

SA 마운트 경로:
/var/run/secrets/kubernetes.io/serviceaccount/
├── token       ← JWT 토큰 (API Server 인증용)
├── ca.crt      ← API Server CA 인증서
└── namespace   ← Pod의 네임스페이스 이름
```

### 2.2 Bound ServiceAccount Token (1.22+)

```
Kubernetes 1.22부터 Bound ServiceAccount Token이 기본이다.

Legacy Token (1.21 이전):
- Secret 오브젝트에 저장
- 만료 없음 (영구 유효!)
- 삭제하지 않으면 계속 사용 가능
- ★ 보안 위험: 토큰 탈취 시 무기한 접근

Bound Token (1.22+):
- TokenRequest API로 발급
- 만료 시간 있음 (기본 1시간, 최대 48시간)
- audience 제한 (특정 대상에서만 유효)
- Pod에 바인딩 (Pod 삭제 시 토큰 무효)
- kubelet이 자동 갱신

Bound Token 흐름:
[Pod 생성]
    │
    ▼
[kubelet] → [TokenRequest API] → [API Server]
    │                                  │
    │     JWT 발급:                     │
    │     - iss: kubernetes/serviceaccount
    │     - sub: system:serviceaccount:NS:SA
    │     - aud: ["https://kubernetes.default.svc"]
    │     - exp: 3600 (1시간)
    │                                  │
    ▼                                  │
[Projected Volume으로 마운트]           │
/var/run/secrets/.../token             │
    │                                  │
    ▼                                  │
[만료 전 kubelet이 자동 갱신]            │

★ 시험 빈출: "Bound SA Token의 특성이 아닌 것은? → 영구 유효"
```

### 2.3 automountServiceAccountToken

```yaml
# 방법 1: ServiceAccount 수준 (해당 SA를 사용하는 모든 Pod에 적용)
apiVersion: v1
kind: ServiceAccount
metadata:
  name: no-api-access
  namespace: production
automountServiceAccountToken: false
  # 이 SA를 사용하는 Pod에는 토큰이 마운트되지 않음

---
# 방법 2: Pod 수준 (개별 Pod에 적용, SA 설정보다 우선)
apiVersion: v1
kind: Pod
metadata:
  name: web-app
spec:
  serviceAccountName: no-api-access
  automountServiceAccountToken: false
  # Pod 수준 설정이 SA 수준보다 우선!
  containers:
    - name: app
      image: nginx:1.27
```

```
automountServiceAccountToken: false 사용 시기:

✓ API Server에 접근할 필요가 없는 워크로드 (웹 서버, DB 등)
✓ 최소 권한 원칙 적용
✓ SA 토큰 탈취 위험 제거

✗ 사용하면 안 되는 경우:
  - API Server에 접근해야 하는 오퍼레이터/컨트롤러
  - kubectl exec가 필요한 디버그 Pod
```

### 2.4 ServiceAccount 보안 모범 사례

```
SA 보안 Best Practice:

1. default SA 사용 금지
   - 각 워크로드에 전용 SA 생성
   - default SA에는 최소 권한만 (또는 권한 없음)

2. 불필요한 토큰 마운트 비활성화
   - automountServiceAccountToken: false
   - API 접근 불필요 시 반드시 설정

3. SA별 최소 권한 RBAC
   - SA에 필요한 최소한의 Role만 바인딩
   - 와일드카드(*) 사용 금지

4. 토큰 갱신 보장
   - Bound Token의 자동 갱신에 의존 (kubelet)
   - Legacy Secret 기반 토큰 사용 금지

5. SA 토큰을 Git에 커밋 금지
   - .gitignore에 토큰/kubeconfig 추가
```

### 2.5 SA 토큰 수동 발급

```bash
# TokenRequest API로 임시 토큰 발급
kubectl create token my-sa -n production --duration=600s

# 토큰 디코딩 (JWT 구조 확인)
kubectl create token my-sa | cut -d. -f2 | base64 -d | jq .
# {
#   "iss": "https://kubernetes.default.svc",
#   "sub": "system:serviceaccount:production:my-sa",
#   "aud": ["https://kubernetes.default.svc"],
#   "exp": 1710878400
# }
```

---

## 3. Pod Security Standards (PSS) / Pod Security Admission (PSA)

### 3.1 PodSecurityPolicy(PSP) → PSS/PSA 전환 역사

```
보안 정책 발전 역사:

PodSecurityPolicy (PSP):
- K8s 1.0부터 존재
- 1.21: deprecated 선언
- 1.25: 완전 제거! ★ 시험 빈출
- 문제점: 복잡한 설정, RBAC와의 혼동, 디버깅 어려움

Pod Security Standards (PSS):
- 3개의 보안 레벨 정의 (Privileged/Baseline/Restricted)
- K8s 공식 보안 표준

Pod Security Admission (PSA):
- PSS를 적용하는 내장 Admission Controller
- 네임스페이스 레이블로 설정
- 1.23: Beta, 1.25: Stable (GA)
```

### 3.2 PSS 3단계 레벨 상세

```
PSS 3단계 레벨 비교:

┌─────────────────────────────────────────────────────────────┐
│ Privileged (특권)                                           │
│   제한 없음                                                 │
│   모든 SecurityContext 허용                                  │
│   용도: 시스템 컴포넌트 (CNI, CSI, 모니터링 에이전트)         │
│   네임스페이스: kube-system                                  │
├─────────────────────────────────────────────────────────────┤
│ Baseline (기준선)                                           │
│   알려진 권한 상승 경로 차단                                  │
│   hostNetwork, hostPID, hostIPC 금지                        │
│   privileged: true 금지                                     │
│   일부 hostPath 제한                                        │
│   용도: 대부분의 워크로드 최소 기준                           │
├─────────────────────────────────────────────────────────────┤
│ Restricted (제한)                                           │
│   Pod 하드닝 모범 사례를 강제                                │
│   Baseline의 모든 제한 + 추가 제한:                          │
│                                                             │
│   ★ 필수 요구사항:                                          │
│   ✓ runAsNonRoot: true                                     │
│   ✓ allowPrivilegeEscalation: false                        │
│   ✓ capabilities.drop: ["ALL"]                             │
│   ✓ seccomp profile: RuntimeDefault 또는 Localhost          │
│                                                             │
│   ★ 비필수 (모범 사례이지만 Restricted에서 강제하지 않음):    │
│   ✗ readOnlyRootFilesystem ← 시험 함정!                    │
│                                                             │
│   ★ 유일하게 add 가능한 capability:                          │
│   ✓ NET_BIND_SERVICE (1024 미만 포트 바인딩)                │
│                                                             │
│   용도: 보안이 중요한 프로덕션 워크로드                       │
└─────────────────────────────────────────────────────────────┘
```

### 3.3 PSS Restricted Pod YAML 예제

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: restricted-pod
  namespace: production
spec:
  securityContext:
    runAsNonRoot: true           # ★ 필수: root로 실행 금지
    runAsUser: 1000
    runAsGroup: 1000
    fsGroup: 1000
    seccompProfile:
      type: RuntimeDefault       # ★ 필수: seccomp 프로파일

  containers:
    - name: app
      image: nginx:1.27
      securityContext:
        allowPrivilegeEscalation: false  # ★ 필수: 권한 상승 금지
        readOnlyRootFilesystem: true     # 모범 사례 (필수 아님!)
        capabilities:
          drop: ["ALL"]                  # ★ 필수: 모든 capability 제거
          add: ["NET_BIND_SERVICE"]      # ★ 유일한 add 가능 capability
      resources:
        requests:
          cpu: "100m"
          memory: "64Mi"
        limits:
          cpu: "500m"
          memory: "256Mi"

  # 추가 보안 설정 (Restricted에서 금지되는 항목)
  # hostNetwork: true    ← 금지!
  # hostPID: true        ← 금지!
  # hostIPC: true        ← 금지!
```

### 3.4 PSA 3가지 모드

```
PSA는 네임스페이스 레이블로 설정하며, 3가지 모드가 있다:

┌────────────────────────────────────────────────────────┐
│ enforce (강제)                                         │
│   정책 위반 Pod → 생성 거부 (403 Forbidden)             │
│   가장 엄격한 모드                                     │
├────────────────────────────────────────────────────────┤
│ audit (감사)                                           │
│   정책 위반 Pod → 생성 허용 + Audit Log에 기록          │
│   위반 현황 파악에 유용                                 │
├────────────────────────────────────────────────────────┤
│ warn (경고)                                            │
│   정책 위반 Pod → 생성 허용 + kubectl에 경고 메시지      │
│   사용자에게 알림                                       │
└────────────────────────────────────────────────────────┘

점진적 적용 전략 (권장):
1단계: audit + warn으로 시작 → 위반 현황 파악
2단계: enforce=baseline + audit=restricted → 기본 차단
3단계: enforce=restricted → 최종 강화
```

### 3.5 PSA 네임스페이스 레이블 설정

```yaml
# 네임스페이스에 PSA 레이블 적용
apiVersion: v1
kind: Namespace
metadata:
  name: production
  labels:
    # enforce: 위반 시 거부
    pod-security.kubernetes.io/enforce: restricted
    pod-security.kubernetes.io/enforce-version: latest

    # audit: 위반 시 Audit Log 기록
    pod-security.kubernetes.io/audit: restricted
    pod-security.kubernetes.io/audit-version: latest

    # warn: 위반 시 경고 메시지
    pod-security.kubernetes.io/warn: restricted
    pod-security.kubernetes.io/warn-version: latest
```

```bash
# 기존 네임스페이스에 레이블 추가
kubectl label namespace production \
  pod-security.kubernetes.io/enforce=restricted \
  pod-security.kubernetes.io/warn=restricted \
  pod-security.kubernetes.io/audit=restricted

# 적용 전 dry-run 점검
kubectl label namespace production \
  pod-security.kubernetes.io/enforce=restricted \
  --dry-run=server --overwrite
```

### 3.6 PSA 적용 시 주의사항

```
PSA 적용 시 주의사항:

1. kube-system 네임스페이스
   → Privileged 레벨 유지 (시스템 컴포넌트에 특권 필요)
   → CNI, CSI, kube-proxy 등이 hostNetwork/hostPID 사용

2. Static Pod에는 PSA 미적용
   → kubelet이 직접 관리하므로 Admission Control 우회
   → /etc/kubernetes/manifests/ 파일 보안으로 보호

3. 기존 Pod는 영향 없음
   → enforce는 새로 생성/업데이트되는 Pod에만 적용
   → 기존 실행 중인 Pod는 계속 실행

4. version 레이블
   → "latest"를 사용하면 K8s 업그레이드 시 자동으로 최신 PSS 적용
   → 특정 버전(v1.31)을 지정하면 해당 버전의 PSS로 고정
```

---

## 4. 핵심 암기 항목

```
RBAC:
- 4종: Role(NS) / ClusterRole(Cluster) / RoleBinding(NS) / ClusterRoleBinding(Cluster)
- ClusterRole + RoleBinding = 해당 NS에서만! ★★★
- roleRef: 변경 불가 → 삭제 후 재생성
- 위험 verb: escalate, bind, impersonate
- system:masters: 모든 RBAC 우회 → 비상 시에만!
- view ClusterRole: Secret 읽기 불가

SA:
- default SA: 네임스페이스마다 자동 생성
- automountServiceAccountToken: false → API 접근 불필요 시
- Bound Token: 만료 + audience 제한 + Pod 바인딩 + 자동 갱신
- Legacy Token: 영구 유효 → 사용 금지!

PSS/PSA:
- PSP: 1.25에서 제거! ★
- PSS 3레벨: Privileged / Baseline / Restricted
- Restricted 필수: runAsNonRoot, allowPrivilegeEscalation:false,
                   drop:ALL, seccomp(RuntimeDefault/Localhost)
- Restricted 비필수: readOnlyRootFilesystem ★★★ (시험 함정!)
- Restricted 유일 add capability: NET_BIND_SERVICE
- PSA 3모드: enforce(거부) / audit(감사) / warn(경고)
```

---

## 5. 복습 체크리스트

- [ ] RBAC 4종 리소스의 범위(NS/Cluster)를 구분할 수 있다
- [ ] ClusterRole + RoleBinding 효과를 설명할 수 있다
- [ ] roleRef가 변경 불가임을 알고 있다
- [ ] escalate/bind/impersonate verb의 위험성을 설명할 수 있다
- [ ] system:masters 그룹의 특수성을 알고 있다
- [ ] Bound SA Token과 Legacy Token의 차이를 설명할 수 있다
- [ ] automountServiceAccountToken의 용도를 알고 있다
- [ ] PSS 3단계 레벨의 차이를 표로 정리할 수 있다
- [ ] Restricted 필수/비필수 항목을 구분할 수 있다
- [ ] PSA 3모드를 설명할 수 있다
- [ ] PSP가 1.25에서 제거됨을 알고 있다

---

## 내일 예고: Day 6 - NetworkPolicy, Secret 관리, OPA/Kyverno, 연습 문제

- NetworkPolicy 심화 (AND/OR 규칙, default-deny)
- Secret 관리 (Base64 vs 암호화, Volume vs 환경변수)
- OPA Gatekeeper / Kyverno 비교
- 연습 문제 18문제 + 상세 해설
- tart-infra 실습

---

## tart-infra 실습

### 실습 환경 설정

```bash
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/dev.yaml
kubectl get nodes
```

### 실습 1: RBAC 구조 확인

```bash
# ClusterRole 목록 (기본 제공)
echo "=== 기본 ClusterRole ==="
kubectl get clusterroles | grep -E "^(cluster-admin|admin|edit|view) "

# ClusterRoleBinding 확인
echo ""
echo "=== cluster-admin 바인딩 ==="
kubectl get clusterrolebinding cluster-admin -o yaml | grep -A 5 subjects
```

**동작 원리:** RBAC 4종 리소스:
1. **Role**: 네임스페이스 범위의 권한 정의
2. **ClusterRole**: 클러스터 범위의 권한 정의 (비리소스 URL 포함)
3. **RoleBinding**: 네임스페이스 범위에서 Subject와 Role을 연결
4. **ClusterRoleBinding**: 클러스터 범위에서 Subject와 ClusterRole을 연결

### 실습 2: ServiceAccount 확인

```bash
# 네임스페이스별 SA 확인
echo "=== demo 네임스페이스 ServiceAccount ==="
kubectl get sa -n demo

# Pod의 SA 토큰 마운트 확인
echo ""
echo "=== Pod의 SA 토큰 마운트 ==="
kubectl get pods -n demo -o jsonpath='{range .items[0]}{.spec.serviceAccountName}{"\n"}{range .spec.containers[*]}{.volumeMounts}{"\n"}{end}{end}' 2>/dev/null || echo "Pod 없음"
```

**동작 원리:** ServiceAccount 보안:
1. 각 NS에 `default` SA가 자동 생성됨
2. Pod에 명시하지 않으면 default SA 사용
3. `automountServiceAccountToken: false`로 불필요한 토큰 마운트 방지
4. Bound Token은 1시간 만료 + 자동 갱신

### 실습 3: PSA 레이블 확인

```bash
# 네임스페이스 PSA 레이블 확인
echo "=== 네임스페이스 PSA 레이블 ==="
kubectl get namespaces --show-labels | grep pod-security || echo "PSA 레이블 미설정"

# kube-system은 Privileged 레벨 (기본)
echo ""
echo "=== kube-system 레이블 ==="
kubectl get namespace kube-system --show-labels
```

**동작 원리:** PSA(Pod Security Admission):
1. 네임스페이스 레이블로 PSS 레벨 적용
2. 3모드: enforce(거부), audit(감사), warn(경고)
3. kube-system은 Privileged 유지 (시스템 컴포넌트에 특권 필요)
4. Static Pod에는 적용되지 않음 (kubelet 직접 관리)

### 실습 4: 권한 확인

```bash
# 현재 사용자의 권한 확인
echo "=== 현재 사용자 권한 (demo NS) ==="
kubectl auth can-i create pods -n demo
kubectl auth can-i delete secrets -n demo
kubectl auth can-i create clusterroles

# SA 권한 확인
echo ""
echo "=== default SA 권한 ==="
kubectl auth can-i get pods --as=system:serviceaccount:demo:default -n demo
```

**동작 원리:** 최소 권한 원칙:
1. `kubectl auth can-i`로 권한 검증
2. 와일드카드(*) 사용 지양
3. escalate/bind/impersonate verb는 일반 사용자에게 부여 금지
4. cluster-admin은 비상 시에만 사용
