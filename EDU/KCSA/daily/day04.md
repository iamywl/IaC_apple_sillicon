# KCSA Day 4: CIS Benchmark, Static Pod, 보안 YAML, 연습 문제

> **시험 비중:** Kubernetes Cluster Component Security — 22% (가장 높은 비중)
> **목표:** CIS Benchmark, Static Pod 보안, 보안 YAML 예제, Pod 생성 보안 흐름을 이해하고, 연습 문제로 점검한다.

---

## 1. CIS Benchmark와 kube-bench

### 1.1 CIS Benchmark란?

```
CIS Kubernetes Benchmark — 보안 구성 기준선(Security Configuration Baseline)

CIS(Center for Internet Security)가 발행하는 합의 기반 보안 점검 표준이다.

점검 카테고리:
├── 1. Control Plane Components
│   ├── 1.1 API Server
│   ├── 1.2 Controller Manager
│   ├── 1.3 Scheduler
│   └── 1.4 etcd
├── 2. etcd (독립 항목)
├── 3. Control Plane Configuration
│   ├── 3.1 Authentication
│   └── 3.2 Logging
├── 4. Worker Nodes
│   ├── 4.1 kubelet
│   └── 4.2 kube-proxy
└── 5. Policies
    ├── 5.1 RBAC
    ├── 5.2 Pod Security
    ├── 5.3 Network Policies
    └── 5.4 Secrets Management
```

### 1.2 kube-bench 사용법

```yaml
# kube-bench를 Job으로 실행
apiVersion: batch/v1
kind: Job
metadata:
  name: kube-bench
  namespace: kube-system
spec:
  template:
    spec:
      hostPID: true
      containers:
        - name: kube-bench
          image: aquasec/kube-bench:v0.8.0
          command: ["kube-bench"]
          volumeMounts:
            - name: var-lib-etcd
              mountPath: /var/lib/etcd
              readOnly: true
            - name: etc-kubernetes
              mountPath: /etc/kubernetes
              readOnly: true
            - name: var-lib-kubelet
              mountPath: /var/lib/kubelet
              readOnly: true
      restartPolicy: Never
      volumes:
        - name: var-lib-etcd
          hostPath:
            path: /var/lib/etcd
        - name: etc-kubernetes
          hostPath:
            path: /etc/kubernetes
        - name: var-lib-kubelet
          hostPath:
            path: /var/lib/kubelet
```

### 1.3 kube-bench 결과 해석

```
결과 유형:
[PASS] : 보안 설정이 권장 값과 일치
[FAIL] : 보안 설정이 권장 값과 불일치 → 수정 필요
[WARN] : 수동 확인 필요
[INFO] : 정보성 메시지

예시 결과:
[PASS] 1.2.1 Ensure that the --anonymous-auth argument is set to false
[FAIL] 1.2.6 Ensure that the --profiling argument is set to false
[WARN] 1.2.10 Ensure that the admission control plugin EventRateLimit is set

FAIL 항목은 반드시 수정해야 한다.
```

---

## 2. Static Pod 보안 특성

```
Static Pod는 kubelet이 API Server를 거치지 않고 직접 관리하는 Pod이다.

일반 Pod:
[kubectl apply] → [API Server] → [etcd 저장] → [Scheduler] → [kubelet]

Static Pod:
[kubelet] ← /etc/kubernetes/manifests/ 디렉토리 감시
           → 파일이 있으면 직접 Pod 생성
           → API Server에 미러 Pod 등록 (읽기 전용)

보안 특성:
1. API Server의 Admission Control이 적용되지 않을 수 있다
   → PSA 정책이 적용되지 않음!
2. RBAC으로 삭제 불가 (kubelet이 직접 관리)
3. 매니페스트 파일이 변조되면 즉시 반영됨
4. 컨트롤 플레인 컴포넌트(API Server, etcd, scheduler, controller-manager)가 Static Pod

보안 권장사항:
- /etc/kubernetes/manifests/ 디렉토리 권한 제한 (700)
- 매니페스트 파일 권한 제한 (600)
- 파일 무결성 모니터링 (IDS)
```

---

## 3. 보안 관련 YAML 예제 모음

### 예제 1: API Server 보안 강화 매니페스트

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: kube-apiserver
  namespace: kube-system
spec:
  containers:
    - name: kube-apiserver
      command:
        - kube-apiserver
        # 인증
        - --anonymous-auth=false
        - --client-ca-file=/etc/kubernetes/pki/ca.crt
        # 인가
        - --authorization-mode=Node,RBAC
        # Admission
        - --enable-admission-plugins=NodeRestriction,PodSecurity,ServiceAccount,LimitRanger,ResourceQuota
        # etcd 연결
        - --etcd-servers=https://127.0.0.1:2379
        - --etcd-cafile=/etc/kubernetes/pki/etcd/ca.crt
        - --etcd-certfile=/etc/kubernetes/pki/apiserver-etcd-client.crt
        - --etcd-keyfile=/etc/kubernetes/pki/apiserver-etcd-client.key
        # Encryption at Rest
        - --encryption-provider-config=/etc/kubernetes/enc/encryption-config.yaml
        # Audit
        - --audit-log-path=/var/log/kubernetes/audit.log
        - --audit-policy-file=/etc/kubernetes/audit/policy.yaml
        - --audit-log-maxage=30
        - --audit-log-maxbackup=10
        - --audit-log-maxsize=100
        # 보안 강화
        - --profiling=false
```

### 예제 2: Audit Policy

```yaml
apiVersion: audit.k8s.io/v1
kind: Policy
rules:
  # 헬스 체크 제외
  - level: None
    nonResourceURLs:
      - /healthz*
      - /readyz*
      - /livez*

  # Secret 접근: 메타데이터만 (데이터 노출 방지!)
  - level: Metadata
    resources:
      - group: ""
        resources: ["secrets", "configmaps"]

  # Pod exec/attach: 전체 기록 (보안 감사)
  - level: RequestResponse
    resources:
      - group: ""
        resources: ["pods/exec", "pods/attach", "pods/portforward"]

  # RBAC 변경: 요청 본문 포함
  - level: Request
    resources:
      - group: "rbac.authorization.k8s.io"
        resources: ["roles", "clusterroles", "rolebindings", "clusterrolebindings"]

  # 나머지: 메타데이터
  - level: Metadata
    omitStages:
      - RequestReceived
```

### 예제 3: ResourceQuota (DoS 방지)

```yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: compute-quota
  namespace: production
spec:
  hard:
    requests.cpu: "4"
    requests.memory: "8Gi"
    limits.cpu: "8"
    limits.memory: "16Gi"
    pods: "20"
    secrets: "10"
    services.nodeports: "2"
```

### 예제 4: LimitRange (Pod 리소스 기본값)

```yaml
apiVersion: v1
kind: LimitRange
metadata:
  name: default-limits
  namespace: production
spec:
  limits:
    - type: Container
      default:
        cpu: "500m"
        memory: "256Mi"
      defaultRequest:
        cpu: "100m"
        memory: "64Mi"
      max:
        cpu: "2"
        memory: "1Gi"
      min:
        cpu: "50m"
        memory: "32Mi"
```

### 예제 5: ServiceAccount 보안 설정

```yaml
# API 접근이 불필요한 워크로드용 ServiceAccount
apiVersion: v1
kind: ServiceAccount
metadata:
  name: no-api-access
  namespace: production
automountServiceAccountToken: false
  # SA 토큰 자동 마운트 비활성화
```

### 예제 6: kubeconfig 보안

```yaml
apiVersion: v1
kind: Config
clusters:
  - cluster:
      server: https://10.0.0.5:6443
      certificate-authority-data: <base64>
    name: kubernetes
users:
  - user:
      client-certificate-data: <base64>
      client-key-data: <base64>
    name: kubernetes-admin

# 보안 주의사항:
# 1. kubeconfig에 개인 키가 포함됨 → chmod 600
# 2. system:masters 그룹 인증서는 RBAC 우회 → 비상 시에만
# 3. Git에 kubeconfig 절대 커밋 금지
```

---

## 4. Pod 생성 전체 보안 흐름

```
[사용자: kubectl apply -f pod.yaml]
    │
    ▼
[1. kubectl → API Server (TLS)]
    kubeconfig의 클라이언트 인증서로 인증
    │
    ▼
[2. API Server: 인증 (Authentication)]
    X.509 인증서의 CN/O 추출
    │
    ▼
[3. API Server: 인가 (Authorization)]
    RBAC → pods 리소스 create 권한 확인
    │
    ▼
[4. API Server: Mutating Admission]
    → ServiceAccount 할당, LimitRanger, 사이드카 주입
    │
    ▼
[5. API Server: Schema Validation]
    → YAML 스키마 검증
    │
    ▼
[6. API Server: Validating Admission]
    → PodSecurity (PSS 레벨 확인)
    → OPA/Kyverno 정책 확인
    │
    ▼
[7. etcd에 저장]
    → TLS + Encryption at Rest
    │
    ▼
[8. Scheduler: 노드 선택]
    │
    ▼
[9. kubelet: Pod 실행]
    → 이미지 풀, SecurityContext 적용
    → seccomp/cgroup 적용
    → SA 토큰 Projected Volume 마운트
```

---

## 5. 시험 출제 패턴 분석

```
패턴 1: "~하는 플래그는?" (정확한 플래그명)
  예: "kubelet의 읽기 전용 포트를 비활성화하는 설정은?"
  → --read-only-port=0

패턴 2: "~의 순서는?" (처리 순서)
  예: "API Server의 요청 처리 순서는?"
  → 인증 → 인가 → Admission

패턴 3: "~에서 가장 권장되는 것은?" (모범 사례)
  예: "Encryption at Rest 프로덕션 권장 프로바이더는?"
  → kms v2

패턴 4: "올바르지 않은 것은?" (오류 찾기)
  예: "kubelet 보안 설정으로 올바르지 않은 것은?"
  → --read-only-port=10255

패턴 5: "~의 역할은?" (컴포넌트 역할)
  예: "NodeRestriction admission controller의 역할은?"
  → kubelet이 자신의 노드/Pod만 수정 가능하도록 제한
```

---

## 6. 연습 문제 (18문제 + 상세 해설)

### 문제 1.
kube-apiserver에서 익명 접근을 비활성화하는 플래그는?

A) `--disable-anonymous-auth`
B) `--anonymous-auth=false`
C) `--no-anonymous`
D) `--authentication-mode=strict`

<details><summary>정답 확인</summary>

**정답: B) `--anonymous-auth=false`**

**왜 정답인가:** `--anonymous-auth`는 boolean 플래그로 기본값은 true이다. false로 설정하면 인증 없는 요청에 401을 반환한다.

</details>

### 문제 2.
API Server에서 요청 처리의 올바른 순서는?

A) Admission → 인증 → 인가
B) 인가 → 인증 → Admission
C) 인증 → 인가 → Admission
D) 인증 → Admission → 인가

<details><summary>정답 확인</summary>

**정답: C) 인증 → 인가 → Admission**

**왜 정답인가:** 먼저 "누구인지"(인증), "무엇을 할 수 있는지"(인가), "정책에 맞는지"(Admission) 순서로 처리한다.

</details>

### 문제 3.
etcd의 데이터를 보호하기 위해 가장 중요한 두 가지 보안 설정은?

A) 데이터 압축과 로그 로테이션
B) TLS 통신 암호화와 데이터 암호화(Encryption at Rest)
C) 백업과 스냅샷
D) 디스크 성능 최적화

<details><summary>정답 확인</summary>

**정답: B) TLS 통신 암호화와 데이터 암호화(Encryption at Rest)**

**왜 정답인가:** (1) TLS로 전송 중 데이터를 보호하고, (2) Encryption at Rest로 저장된 데이터를 보호하는 것이 가장 중요하다.

</details>

### 문제 4.
kubelet의 보안 설정으로 올바르지 않은 것은?

A) `--anonymous-auth=false`로 익명 접근 차단
B) `--authorization-mode=Webhook`으로 API Server 인가
C) `--read-only-port=10255`로 읽기 전용 포트 활성화
D) `--rotate-certificates=true`로 인증서 자동 갱신

<details><summary>정답 확인</summary>

**정답: C) `--read-only-port=10255`로 읽기 전용 포트를 활성화한다**

**왜 정답인가:** 10255 포트는 인증 없이 노드 정보를 노출하므로 `--read-only-port=0`으로 비활성화해야 한다.

</details>

### 문제 5.
Admission Controller의 실행 순서로 올바른 것은?

A) Validating → Mutating
B) Mutating → Validating
C) 동시 병렬
D) 순서 없이 랜덤

<details><summary>정답 확인</summary>

**정답: B) Mutating → Validating**

**왜 정답인가:** Mutating이 요청을 수정한 후 Validating이 최종 검증한다. Mutating에서 추가된 필드를 Validating에서 검증해야 하므로 이 순서가 필수적이다.

</details>

### 문제 6.
kubeadm 클러스터에서 인증서가 저장되는 기본 디렉토리는?

A) `/var/lib/kubelet/pki/`
B) `/etc/kubernetes/pki/`
C) `/opt/kubernetes/certs/`
D) `~/.kube/certs/`

<details><summary>정답 확인</summary>

**정답: B) `/etc/kubernetes/pki/`**

</details>

### 문제 7.
API Server의 인증(Authentication) 방식이 아닌 것은?

A) X.509 클라이언트 인증서
B) Bearer Token
C) NetworkPolicy
D) OpenID Connect (OIDC)

<details><summary>정답 확인</summary>

**정답: C) NetworkPolicy**

**왜 정답인가:** NetworkPolicy는 Pod 간 네트워크 트래픽을 제어하는 리소스이지, 인증 방식이 아니다.

</details>

### 문제 8.
Static Pod의 보안 관점에서의 특징은?

A) API Server를 통해 생성되므로 RBAC가 완전히 적용된다
B) kubelet이 직접 관리하며 Admission Control이 적용되지 않을 수 있다
C) etcd에 저장되어 암호화 보호를 받는다
D) NetworkPolicy에 의해 자동으로 보호된다

<details><summary>정답 확인</summary>

**정답: B) kubelet이 직접 관리하며 Admission Control이 적용되지 않을 수 있다**

**왜 정답인가:** Static Pod는 `/etc/kubernetes/manifests/`의 YAML을 kubelet이 직접 읽어 생성한다. API Server를 거치지 않으므로 PSA 정책 등이 적용되지 않는다.

</details>

### 문제 9.
etcd의 Encryption at Rest에서 프로덕션에 가장 권장되는 프로바이더는?

A) identity
B) aescbc
C) kms (v2)
D) aesgcm

<details><summary>정답 확인</summary>

**정답: C) kms (v2)**

**왜 정답인가:** KMS는 외부 키 관리 서비스(AWS KMS, Vault 등)를 사용하여 키가 etcd나 API Server에 평문으로 남지 않는다. v2는 DEK 캐싱으로 성능도 향상된다.

</details>

### 문제 10.
NodeRestriction admission controller의 역할은?

A) 노드의 CPU 사용량을 제한한다
B) kubelet이 자신의 노드와 해당 Pod만 수정할 수 있도록 제한한다
C) 새 노드의 클러스터 참여를 제한한다
D) 노드 간 네트워크 트래픽을 제한한다

<details><summary>정답 확인</summary>

**정답: B) kubelet이 자신의 노드와 해당 Pod만 수정할 수 있도록 제한한다**

</details>

### 문제 11.
API Server의 `--authorization-mode`에서 권장되는 설정은?

A) `AlwaysAllow`
B) `Node,RBAC`
C) `ABAC`
D) `Webhook`

<details><summary>정답 확인</summary>

**정답: B) `Node,RBAC`**

**왜 정답인가:** Node는 kubelet 접근을 제한하고, RBAC는 역할 기반 접근 제어를 제공한다.

</details>

### 문제 12.
Control Plane에서 API Server와 etcd 사이의 TLS 유형은?

A) 단방향 TLS
B) 상호 TLS (mTLS)
C) 평문
D) SSH 터널

<details><summary>정답 확인</summary>

**정답: B) 상호 TLS (mTLS)**

**왜 정답인가:** API Server는 etcd의 서버 인증서를 검증하고, etcd는 API Server의 클라이언트 인증서를 검증한다.

</details>

### 문제 13.
Kubernetes 인증서의 기본 유효 기간(kubeadm)은?

A) 인증서 1년, CA 1년
B) 인증서 1년, CA 10년
C) 인증서 10년, CA 10년
D) 인증서 90일, CA 1년

<details><summary>정답 확인</summary>

**정답: B) 인증서 1년, CA 10년**

</details>

### 문제 14.
kube-controller-manager가 관리하는 보안 관련 기능이 아닌 것은?

A) ServiceAccount 토큰 발급
B) 인증서 서명 요청(CSR) 승인
C) Namespace 삭제 시 리소스 정리
D) 네트워크 패킷 필터링

<details><summary>정답 확인</summary>

**정답: D) 네트워크 패킷 필터링**

**왜 정답인가:** 네트워크 패킷 필터링은 CNI 플러그인(Cilium, Calico)이나 kube-proxy가 담당한다.

</details>

### 문제 15.
`--enable-admission-plugins`에 포함되어야 하는 보안 컨트롤러로 적절하지 않은 것은?

A) PodSecurity
B) NodeRestriction
C) AlwaysAdmit
D) ServiceAccount

<details><summary>정답 확인</summary>

**정답: C) AlwaysAdmit**

**왜 정답인가:** AlwaysAdmit은 모든 요청을 무조건 승인하므로 보안상 사용하면 안 된다.

</details>

### 문제 16.
EncryptionConfiguration에서 providers 순서의 의미는?

A) 순서 무관
B) 첫 번째로 새 데이터 암호화, 나머지는 기존 데이터 복호화
C) 마지막으로 새 데이터 암호화
D) 모든 프로바이더로 중복 암호화

<details><summary>정답 확인</summary>

**정답: B) 첫 번째로 새 데이터 암호화, 나머지는 기존 데이터 복호화**

</details>

### 문제 17.
kubelet의 `--authorization-mode`를 `AlwaysAllow`로 설정하면?

A) kubelet이 시작되지 않는다
B) 인증된 모든 사용자가 kubelet API를 통해 Pod에서 명령을 실행할 수 있다
C) kubelet이 API Server와 통신할 수 없다
D) 로그만 기록되고 접근은 차단된다

<details><summary>정답 확인</summary>

**정답: B) 인증된 모든 사용자가 kubelet API를 통해 Pod에서 명령을 실행할 수 있다**

**왜 정답인가:** AlwaysAllow는 모든 인가 요청을 허용한다. Webhook 모드로 API Server에 인가를 위임해야 한다.

</details>

### 문제 18.
Audit Logging에서 Secret 접근을 `Metadata` 레벨로 기록하는 이유는?

A) Secret은 감사할 필요가 없어서
B) 감사 로그에 Secret 데이터가 노출되는 것을 방지하기 위해
C) 저장 공간을 절약하기 위해
D) Metadata 레벨이 가장 상세한 레벨이라서

<details><summary>정답 확인</summary>

**정답: B) 감사 로그에 Secret 데이터가 노출되는 것을 방지하기 위해**

**왜 정답인가:** Request/RequestResponse 레벨은 요청/응답 본문을 포함하므로 Secret의 실제 비밀번호가 감사 로그에 노출된다. Metadata 레벨은 "누가, 언제, 어떤 Secret에 접근했는지"만 기록한다.

</details>

---

## 7. 복습 체크리스트

- [ ] CIS Benchmark와 kube-bench의 역할을 알고 있다
- [ ] kube-bench 결과(PASS/FAIL/WARN/INFO)를 해석할 수 있다
- [ ] Static Pod의 보안 특성(Admission Control 미적용)을 알고 있다
- [ ] API Server 보안 강화 매니페스트의 핵심 플래그를 기억한다
- [ ] Pod 생성 전체 보안 흐름을 설명할 수 있다
- [ ] 연습 문제 18문제를 모두 풀 수 있다

---

## 내일 예고: Day 5 - RBAC, ServiceAccount, Pod Security Standards

- RBAC 4대 구성 요소와 YAML 상세
- ServiceAccount와 Bound Token
- PSS 3단계 레벨 (Privileged/Baseline/Restricted)
- PSA 설정과 점진적 적용 전략

---

## tart-infra 실습

### 실습 환경 설정

```bash
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/dev.yaml
kubectl get nodes
```

### 실습 1: CIS Benchmark 주요 항목 점검

```bash
echo "=== CIS Benchmark 주요 항목 점검 ==="

# 1. API Server 보안
echo "[1.1] Authorization Mode:"
kubectl get pod kube-apiserver-dev-master -n kube-system -o yaml | grep authorization-mode

# 2. etcd 보안
echo "[2.1] etcd client-cert-auth:"
kubectl get pod etcd-dev-master -n kube-system -o yaml | grep client-cert-auth

# 3. NetworkPolicy 존재 여부
echo "[5.1] NetworkPolicy count:"
kubectl get ciliumnetworkpolicies -n demo --no-headers | wc -l

# 4. Secret encryption
echo "[5.4] Secret encryption:"
kubectl get pod kube-apiserver-dev-master -n kube-system -o yaml | grep encryption-provider || echo "  Not configured"
```

**동작 원리:** CIS Benchmark는 K8s 보안 설정 가이드라인이며 kube-bench로 자동 점검할 수 있다. PASS/FAIL/WARN/INFO 결과를 제공한다.

### 실습 2: Pod 생성 보안 흐름 추적

```bash
# API Server의 보안 플래그 확인
kubectl get pod kube-apiserver-dev-master -n kube-system -o yaml | grep -E "(--anonymous|--authorization|--enable-admission|--encryption)"
```

**동작 원리:** Pod 생성 시 API Server의 3단계 처리:
1. 인증: 클라이언트 인증서 CN/O로 사용자/그룹 식별
2. 인가: RBAC으로 pods create 권한 확인
3. Admission: Mutating(SA 할당, LimitRange) → Validating(PSA, Kyverno)
