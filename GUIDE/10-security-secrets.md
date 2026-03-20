# 재연 가이드 10. 보안 & 시크릿 관리

이 문서는 Phase 13(Sealed Secrets)과 Phase 14(RBAC + OPA Gatekeeper)가 설치하는 보안 컴포넌트를 설명한다. 시크릿을 안전하게 관리하고, 역할 기반 접근을 제어하며, 정책을 자동으로 강제하는 방법을 다룬다.


## 1. Sealed Secrets — 시크릿 관리

### 1.1 개요

Kubernetes Secret은 base64 인코딩일 뿐 암호화되지 않는다. Git에 Secret YAML을 저장하면 평문 비밀번호가 노출된다.

Sealed Secrets는 이 문제를 해결한다:
- 공개키(Public Key)로 시크릿을 **암호화**하여 SealedSecret 객체 생성
- SealedSecret은 Git에 안전하게 저장 가능
- 클러스터의 컨트롤러만 개인키(Private Key)로 복호화 가능

### 1.2 아키텍처

```
개발자 워크스테이션                     Kubernetes 클러스터
┌─────────────────────┐            ┌──────────────────────────────┐
│                     │            │  sealed-secrets namespace     │
│  kubectl create     │            │  ┌──────────────────────────┐ │
│  secret (dry-run)   │            │  │ Sealed Secrets Controller│ │
│       │             │            │  │  • 개인키 보유            │ │
│       ▼             │            │  │  • SealedSecret 감시     │ │
│  kubeseal --cert    │   apply    │  │  • Secret 자동 생성      │ │
│  pub-cert.pem       │ ────────→  │  └──────────────────────────┘ │
│       │             │            │                                │
│       ▼             │            │  demo namespace                │
│  SealedSecret YAML  │            │  ┌──────────────────────────┐ │
│  (암호화됨, Git OK) │            │  │ Secret (복호화된 원본)   │ │
│                     │            │  └──────────────────────────┘ │
└─────────────────────┘            └──────────────────────────────┘
```

### 1.3 컨트롤러 확인

```bash
export KUBECONFIG=kubeconfig/platform.yaml
kubectl get pods -n sealed-secrets
```

예상 출력:

```
NAME                                         READY   STATUS    RESTARTS   AGE
sealed-secrets-controller-xxxxxxxxxx-xxxxx   1/1     Running   0          2d
```

### 1.4 공개키 가져오기

```bash
# kubeseal CLI 설치 (최초 1회)
brew install kubeseal

# 공개키 다운로드
kubeseal --fetch-cert \
  --kubeconfig kubeconfig/platform.yaml \
  --controller-name=sealed-secrets-controller \
  --controller-namespace=sealed-secrets \
  > pub-cert.pem
```

### 1.5 SealedSecret 생성

```bash
# 1. 일반 Secret 생성 (dry-run)
kubectl create secret generic my-app-secret \
  --from-literal=DB_PASSWORD='super-secret-pw' \
  --from-literal=API_KEY='my-api-key-123' \
  --dry-run=client -o yaml > my-secret.yaml

# 2. SealedSecret으로 암호화
kubeseal --cert pub-cert.pem \
  --format yaml \
  < my-secret.yaml > sealed-my-secret.yaml

# 3. 적용 (컨트롤러가 자동으로 Secret 생성)
kubectl --kubeconfig kubeconfig/dev.yaml apply -f sealed-my-secret.yaml

# 4. 생성된 Secret 확인
kubectl --kubeconfig kubeconfig/dev.yaml get secret my-app-secret
```

### 1.6 데모 시크릿 확인

Phase 13에서 자동 생성되는 데모 시크릿:

```bash
export KUBECONFIG=kubeconfig/dev.yaml

# DB 자격증명
kubectl get secret demo-db-credentials -n demo -o jsonpath='{.data.POSTGRES_USER}' | base64 -d
# demo_user

# API 자격증명
kubectl get secret demo-api-credentials -n demo -o jsonpath='{.data.API_KEY}' | base64 -d
# demo-api-key-change-me
```


## 2. RBAC — 역할 기반 접근 제어

### 2.1 개요

Phase 14에서 모든 클러스터에 3가지 커스텀 RBAC 역할을 적용한다:

| 역할 | 유형 | 권한 |
|------|------|------|
| `namespace-admin` | ClusterRole | demo 네임스페이스 내 모든 리소스 CRUD (Secret은 읽기만) |
| `cluster-readonly` | ClusterRole + Binding | 전체 클러스터 읽기 전용 |
| `developer-rolebinding` | RoleBinding | developers 그룹에 namespace-admin 연결 |

### 2.2 RBAC 확인

```bash
export KUBECONFIG=kubeconfig/dev.yaml

# 커스텀 ClusterRole 확인
kubectl get clusterrole namespace-admin -o yaml
kubectl get clusterrole cluster-readonly -o yaml

# RoleBinding 확인
kubectl get rolebinding -n demo developer-namespace-admin -o yaml
```

### 2.3 권한 테스트

```bash
# namespace-admin 역할로 수행 가능한 작업 확인
kubectl auth can-i create deployments -n demo --as=system:serviceaccount:demo:default
# yes

# Secret 쓰기는 차단됨
kubectl auth can-i create secrets -n demo --as=system:serviceaccount:demo:default
# no
```


## 3. OPA Gatekeeper — 정책 강제

### 3.1 개요

OPA Gatekeeper는 Admission Webhook으로 동작하며, 리소스 생성/수정 시 정책을 자동으로 검사한다.

Phase 14에서 dev 클러스터에 설치되며, 4가지 ConstraintTemplate과 4가지 Constraint가 적용된다.

### 3.2 ConstraintTemplate

| 이름 | 설명 |
|------|------|
| `K8sRequiredLabels` | 필수 라벨 검사 — Deployment/StatefulSet에 `app` 라벨 필수 |
| `K8sContainerLimits` | 리소스 제한 검사 — 컨테이너에 CPU/메모리 limits 필수 |
| `K8sBlockNodePort` | NodePort 차단 — `allow-nodeport` 라벨 없으면 NodePort 서비스 차단 |
| `K8sDisallowPrivileged` | 특권 컨테이너 차단 — privileged: true 금지 |

### 3.3 Constraint (적용 정책)

| Constraint | Template | 적용 범위 | 동작 |
|---|---|---|---|
| `require-app-label` | K8sRequiredLabels | demo 네임스페이스 | warn |
| `container-must-have-limits` | K8sContainerLimits | demo 네임스페이스 | warn |
| `block-nodeport-services` | K8sBlockNodePort | demo 네임스페이스 | warn |
| `disallow-privileged-containers` | K8sDisallowPrivileged | 시스템 NS 제외 전체 | deny |

> `warn`은 경고만 출력하고 리소스 생성을 허용한다. `deny`는 차단한다.

### 3.4 Gatekeeper 확인

```bash
export KUBECONFIG=kubeconfig/dev.yaml

# Gatekeeper Pod 상태
kubectl get pods -n gatekeeper-system

# 모든 Constraint 확인
kubectl get constraints

# 특정 Constraint 위반 내역
kubectl describe k8srequiredlabels require-app-label
```

예상 출력:

```
NAME                              ENFORCEMENT-ACTION   TOTAL-VIOLATIONS
require-app-label                 warn                 0
container-must-have-limits        warn                 2
block-nodeport-services           warn                 1
disallow-privileged-containers    deny                 0
```

### 3.5 정책 위반 테스트

```bash
# 특권 컨테이너 생성 시도 (차단됨)
kubectl --kubeconfig kubeconfig/dev.yaml run test-privileged \
  --image=nginx --restart=Never \
  --overrides='{"spec":{"containers":[{"name":"test","image":"nginx","securityContext":{"privileged":true}}]}}'
```

예상 출력:

```
Error from server (Forbidden): admission webhook "validation.gatekeeper.sh" denied the request:
[disallow-privileged-containers] Privileged container 'test' is not allowed
```

```bash
# 라벨 없는 Deployment 생성 (경고)
kubectl --kubeconfig kubeconfig/dev.yaml create deployment test-no-label \
  --image=nginx -n demo

# 경고 메시지 확인
kubectl --kubeconfig kubeconfig/dev.yaml describe k8srequiredlabels require-app-label | grep -A5 "Violations"

# 테스트 리소스 정리
kubectl --kubeconfig kubeconfig/dev.yaml delete deployment test-no-label -n demo
```


## 4. 보안 체크리스트

| 항목 | 구현 | Phase |
|------|------|-------|
| 시크릿 암호화 저장 | Sealed Secrets | 13 |
| 시크릿 접근 제한 | RBAC (Secret은 읽기 전용) | 14 |
| 역할 기반 접근 | ClusterRole + RoleBinding | 14 |
| 필수 라벨 강제 | OPA Gatekeeper Constraint | 14 |
| 리소스 제한 강제 | OPA Gatekeeper Constraint | 14 |
| 특권 컨테이너 차단 | OPA Gatekeeper Constraint (deny) | 14 |
| NodePort 제한 | OPA Gatekeeper Constraint | 14 |
| 네트워크 제로 트러스트 | CiliumNetworkPolicy | 10 |
| 서비스 간 mTLS | Istio PeerAuthentication | 12 |
