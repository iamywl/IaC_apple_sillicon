# KCSA Day 9: Audit Logging, Compliance 프레임워크

> **시험 비중:** Compliance and Security Frameworks — 10%
> **목표:** Audit Logging 4단계 레벨과 정책 설계를 마스터하고, 주요 Compliance 프레임워크를 이해한다.

---

## 1. Audit Logging 심화

### 1.0 등장 배경

```
기존 방식의 한계:
Audit Logging이 없는 Kubernetes 클러스터에서는:

1. "누가 Secret을 삭제했는가?"를 추적할 방법이 없다
2. RBAC 정책이 언제, 누구에 의해 변경되었는지 알 수 없다
3. 침해 사고 발생 시 공격 경로를 재구성(포렌식)할 수 없다
4. SOC 2, PCI DSS 등 규정 준수 감사에서 증빙을 제출할 수 없다

공격-방어 매핑:
- Repudiation(STRIDE) → Audit Logging으로 부인 방지(Non-Repudiation) 구현
- Defense Evasion(MITRE ATT&CK) → Audit Log로 공격자의 행위 추적

해결:
Audit Logging은 API Server를 통과하는 모든 요청을 구조화된 JSON 이벤트로 기록한다.
4단계 레벨(None/Metadata/Request/RequestResponse)로 상세도를 조절하여
민감 데이터 노출 방지와 보안 감사 요구사항을 동시에 충족한다.
```

### 1.1 Audit Logging의 목적과 보안 기능

```
Audit Logging은 API Server의 모든 요청에 대한 구조화된 이벤트 기록 시스템이다.

기록 필드: 주체(user), 타임스탬프(timestamp), 대상 리소스(resource), 동작(verb), 소스 IP, 응답 코드

Audit Log가 없을 때의 보안 위협:
- 부인 방지(Non-Repudiation) 불가: "누가 Secret을 삭제했는지" 추적 불가
- 변경 추적 불가: RBAC 정책 변경 이력 없음
- 포렌식(Forensics) 불가: 침해 사고 발생 시 공격 경로 분석 불가

Audit Log 활성화 시:
- Incident Response: 보안 사고 타임라인 재구성 가능
- Compliance: SOC 2, PCI DSS 등 규정 준수 감사 증빙
- Anomaly Detection: 비정상 API 호출 패턴 탐지 (UEBA 연동)
```

### 1.2 Audit 레벨 4단계 상세

```
Audit 레벨 (상세도 순서):

None < Metadata < Request < RequestResponse

┌───────────────────────────────────────────────┐
│ None                                          │
│ - 기록하지 않음                                │
│ - 용도: 노이즈 제거 (헬스 체크, kube-proxy)     │
│ - 예: /healthz, /readyz 요청                   │
├───────────────────────────────────────────────┤
│ Metadata                                      │
│ - 메타데이터만 기록                              │
│   (사용자, 타임스탬프, 리소스, 동사, 응답코드)     │
│ - 요청/응답 본문은 기록하지 않음                  │
│ - 용도: Secret 접근 (본문에 민감 데이터 있으므로) │
│ - 예: "admin이 13:05에 secret/db-pass를 GET"   │
├───────────────────────────────────────────────┤
│ Request                                       │
│ - 메타데이터 + 요청 본문                         │
│ - 응답 본문은 기록하지 않음                      │
│ - 용도: RBAC 변경 (어떤 변경이 요청됐는지 확인)   │
│ - 예: "admin이 Role을 이렇게 변경 요청"          │
├───────────────────────────────────────────────┤
│ RequestResponse                               │
│ - 메타데이터 + 요청 본문 + 응답 본문              │
│ - 가장 상세하지만 저장 공간 많이 사용              │
│ - 용도: Pod exec/attach (보안 감사)              │
│ - 예: "admin이 pod에서 exec 실행, 명령과 결과"    │
└───────────────────────────────────────────────┘

핵심 기억사항:
- Secret → Metadata (본문에 비밀번호가 있으므로!)
- Pod exec → RequestResponse (보안 감사를 위해)
- 읽기(get, list) → Metadata (과다 로깅 방지)
- 변경(create, update, delete) → Request 이상
```

### 1.3 Audit 단계(Stage)

| 단계 | 설명 | 시점 |
|------|------|------|
| `RequestReceived` | 요청 수신 직후 | 처리 전 |
| `ResponseStarted` | 응답 헤더 전송 시 | long-running만 (watch) |
| `ResponseComplete` | 응답 완료 시 | 대부분의 요청 |
| `Panic` | 패닉 발생 시 | 오류 상황 |

### 1.4 Audit Policy YAML 상세

```yaml
# /etc/kubernetes/audit/policy.yaml
apiVersion: audit.k8s.io/v1
kind: Policy

# 규칙 순서가 중요! 첫 번째로 매칭되는 규칙이 적용됨

rules:
  # ========== 1. 노이즈 제거 (None) ==========

  # 헬스 체크 제외
  - level: None
    nonResourceURLs:
      - /healthz*                 # API Server 헬스 체크
      - /readyz*                  # 레디니스 체크
      - /livez*                   # 라이브니스 체크
      - /version                  # 버전 정보

  # 시스템 사용자의 일상적인 요청 제외
  - level: None
    users:
      - system:kube-proxy         # kube-proxy의 watch 요청
      - system:kube-controller-manager
    verbs: ["watch", "list"]
    resources:
      - group: ""
        resources: ["endpoints", "services", "services/status"]

  # kube-system 네임스페이스의 일상적 요청 제외
  - level: None
    userGroups: ["system:nodes"]  # kubelet의 요청
    verbs: ["get"]
    resources:
      - group: ""
        resources: ["nodes", "nodes/status"]

  # ========== 2. 민감 데이터 보호 (Metadata) ==========

  # Secret 접근: 메타데이터만 (데이터 노출 방지!)
  - level: Metadata
    resources:
      - group: ""
        resources: ["secrets"]    # Secret 내용이 로그에 남지 않도록
    omitStages:
      - RequestReceived           # 이 단계는 생략

  # ConfigMap 접근: 메타데이터만
  - level: Metadata
    resources:
      - group: ""
        resources: ["configmaps"]
    omitStages:
      - RequestReceived

  # TokenReview, SubjectAccessReview: 메타데이터만
  - level: Metadata
    resources:
      - group: "authentication.k8s.io"
        resources: ["tokenreviews"]
      - group: "authorization.k8s.io"
        resources: ["subjectaccessreviews"]

  # ========== 3. 보안 감사 (RequestResponse) ==========

  # Pod exec/attach: 전체 기록 (보안 감사 필수!)
  - level: RequestResponse
    resources:
      - group: ""
        resources:
          - pods/exec             # kubectl exec
          - pods/attach           # kubectl attach
          - pods/portforward      # kubectl port-forward
    omitStages:
      - RequestReceived

  # ========== 4. 변경 요청 (Request) ==========

  # RBAC 변경: 요청 본문 포함 (누가 어떤 권한을 변경했는지)
  - level: Request
    resources:
      - group: "rbac.authorization.k8s.io"
        resources:
          - roles
          - clusterroles
          - rolebindings
          - clusterrolebindings
    omitStages:
      - RequestReceived

  # 네임스페이스, 노드 변경
  - level: Request
    resources:
      - group: ""
        resources: ["namespaces", "nodes"]
    verbs: ["create", "update", "delete", "patch"]

  # ========== 5. 기본 규칙 (Metadata) ==========

  # 나머지 모든 요청: 메타데이터
  - level: Metadata
    omitStages:
      - RequestReceived
```

### 1.5 Audit 백엔드 설정

```yaml
# API Server의 Audit 관련 플래그
spec:
  containers:
    - command:
        - kube-apiserver

        # === Log 백엔드 ===
        - --audit-log-path=/var/log/kubernetes/audit.log
          # 감사 로그 파일 경로

        - --audit-policy-file=/etc/kubernetes/audit/policy.yaml
          # 감사 정책 파일

        - --audit-log-maxage=30
          # 로그 파일 최대 보관 기간 (일)

        - --audit-log-maxbackup=10
          # 최대 백업 파일 수

        - --audit-log-maxsize=100
          # 로그 파일 최대 크기 (MB)

        # === Webhook 백엔드 ===
        # - --audit-webhook-config-file=/etc/kubernetes/audit/webhook.yaml
        #   # 외부 서비스로 감사 로그 전송
        #   # Falco, Elasticsearch, Loki 등과 연동
```

### 1.6 Audit 로그 분석 예시

```json
// 감사 로그 항목 (JSON 형태)
{
  "kind": "Event",
  "apiVersion": "audit.k8s.io/v1",
  "level": "Metadata",                    // 기록 레벨

  "auditID": "abc-123-def-456",            // 고유 ID

  "stage": "ResponseComplete",             // 단계

  "requestURI": "/api/v1/namespaces/production/secrets/db-password",
  // 요청 URI

  "verb": "get",                           // 동작
  // 주요 verb: get, list, watch, create, update, delete, patch

  "user": {                                // 요청자 정보
    "username": "jane@example.com",
    "groups": ["dev-team", "system:authenticated"]
  },

  "sourceIPs": ["10.0.1.50"],              // 출발지 IP

  "objectRef": {                           // 대상 오브젝트
    "resource": "secrets",
    "namespace": "production",
    "name": "db-password",
    "apiVersion": "v1"
  },

  "responseStatus": {                      // 응답 상태
    "metadata": {},
    "code": 200                            // 200: 성공, 403: 권한 없음
  },

  "requestReceivedTimestamp": "2025-03-19T10:30:00.000Z",
  "stageTimestamp": "2025-03-19T10:30:00.050Z"
}
```

### 1.7 리소스별 Audit 레벨 권장 매핑

| 리소스 | 권장 레벨 | 이유 |
|--------|---------|------|
| Secret, ConfigMap | Metadata | 본문에 민감 데이터 포함 가능 |
| Pod exec/attach/portforward | RequestResponse | 보안 감사 필수 |
| RBAC (Role, Binding) | Request | 권한 변경 내용 추적 |
| Namespace | Request | 중요 리소스 변경 추적 |
| Pod, Deployment | Metadata | 일반 워크로드 변경 |
| 헬스 체크 (/healthz) | None | 노이즈 제거 |
| kube-proxy watch | None | 노이즈 제거 |

---

## 2. 규정 준수 프레임워크 (Compliance Frameworks)

### 2.1 CIS Benchmark

```
CIS (Center for Internet Security) Kubernetes Benchmark

CIS(Center for Internet Security)가 합의 기반(consensus-based) 프로세스로 발행하는
Kubernetes 클러스터 컴포넌트의 보안 설정 평가 및 하드닝(Hardening) 표준이다.

점검 도구: kube-bench (Aqua Security)
결과: PASS / FAIL / WARN / INFO

주요 점검 항목:
1. Control Plane
   - API Server: anonymous-auth, authorization-mode, admission-plugins
   - etcd: TLS, client-cert-auth
   - Controller Manager: profiling, bind-address
   - Scheduler: profiling, bind-address

2. Worker Node
   - kubelet: anonymous-auth, authorization-mode, read-only-port
   - kube-proxy: metrics-bind-address

3. Policies
   - RBAC: cluster-admin 최소화, 와일드카드 금지
   - Pod Security: PSS Restricted 적용
   - Network: NetworkPolicy default-deny
   - Secrets: Encryption at Rest
```

### 2.2 NIST Cybersecurity Framework (CSF)

```
NIST CSF 5가지 기능:

┌─────────────────────────────────────────────────┐
│ 1. Identify (식별)                               │
│    "우리가 보호해야 할 것이 무엇인지 파악"         │
│    K8s: 클러스터 인벤토리, RBAC 감사,            │
│         자산 목록, 위험 평가                      │
├─────────────────────────────────────────────────┤
│ 2. Protect (보호)                                │
│    "보안 통제를 구현"                             │
│    K8s: RBAC, NetworkPolicy, PSA, 암호화,       │
│         이미지 서명, Admission Control            │
├─────────────────────────────────────────────────┤
│ 3. Detect (탐지)                                 │
│    "보안 이벤트를 발견"                            │
│    K8s: Falco, Audit Log, Prometheus 알림,       │
│         이미지 스캐닝, 로그 분석                   │
├─────────────────────────────────────────────────┤
│ 4. Respond (대응)                                │
│    "사고 발생 시 대응"                            │
│    K8s: Incident Response 계획, Pod 격리,        │
│         RBAC 비활성화, NetworkPolicy 차단          │
├─────────────────────────────────────────────────┤
│ 5. Recover (복구)                                │
│    "정상 운영으로 복구"                            │
│    K8s: etcd 백업/복원, 재배포,                   │
│         Disaster Recovery, 사후 분석              │
└─────────────────────────────────────────────────┘

★ 시험 빈출: "Falco와 Audit Log가 해당하는 NIST 기능은?" → Detect
```

### 2.3 SOC 2

```
SOC 2 (Service Organization Control)

제3자 독립 감사(Third-Party Audit) 기반 보안 통제 인증

AICPA(미국공인회계사협회)가 정의한 Trust Service Criteria에 따라
독립 감사법인이 조직의 보안 통제 설계 및 운영 효과를 평가/인증한다.

Trust Service Criteria (TSC):
┌──────────────────────────────────────┐
│ 1. 보안 (Security) ← 필수!           │
│    데이터 보호, 접근 제어, 위협 탐지  │
│                                      │
│ 2. 가용성 (Availability)              │
│    시스템 가동 시간, 백업              │
│                                      │
│ 3. 처리 무결성 (Processing Integrity) │
│    데이터 처리의 정확성                │
│                                      │
│ 4. 기밀성 (Confidentiality)           │
│    민감 정보 보호                      │
│                                      │
│ 5. 프라이버시 (Privacy)               │
│    개인정보 보호                       │
└──────────────────────────────────────┘

Type I vs Type II:
┌──────────────────────────────────────┐
│ Type I: 특정 시점의 통제 설계 평가     │
│   "지금 이 순간 보안 설계가 적절한가?" │
│   특정 시점의 통제 설계 적절성 평가     │
│                                      │
│ Type II: 일정 기간의 운영 효과 평가    │
│   "6~12개월 동안 실제로 잘 운영했는가?" │
│   6~12개월 운영 기간의 통제 효과 검증   │
│   → 더 높은 신뢰도                    │
└──────────────────────────────────────┘

K8s에서 SOC 2 관련:
- RBAC → 접근 제어 증빙
- Audit Log → 활동 추적 증빙
- GitOps (ArgoCD) → 변경 관리 증빙
- 모니터링 (Prometheus/Grafana) → 가용성 증빙
- Encryption at Rest → 데이터 보호 증빙
```

### 2.4 PCI DSS

```
PCI DSS (Payment Card Industry Data Security Standard)

PCI SSC(Payment Card Industry Security Standards Council)가 제정한 카드 데이터 보호 표준

카드회원 데이터(CHD)를 처리/저장/전송하는 모든 조직에 의무 적용

12가지 요구사항 중 K8s 관련:

┌──────────────────────────────────────────────┐
│ 요구사항 1: 방화벽 설치/유지                    │
│   → NetworkPolicy, 방화벽 규칙                  │
│                                               │
│ 요구사항 3: 저장된 카드 데이터 보호               │
│   → Encryption at Rest, Secret 관리             │
│                                               │
│ 요구사항 6: 안전한 시스템/애플리케이션 개발         │
│   → 이미지 스캐닝, 패치 관리                     │
│                                               │
│ 요구사항 7: 카드 데이터 접근 제한                  │
│   → RBAC, 최소 권한                             │
│                                               │
│ 요구사항 8: 사용자 식별/인증                      │
│   → 인증 강화 (OIDC, MFA)                       │
│                                               │
│ 요구사항 10: 네트워크/데이터 접근 모니터링           │
│   → Audit Log, Falco, 모니터링                   │
│                                               │
│ 요구사항 11: 보안 시스템/프로세스 정기 테스트        │
│   → 취약점 스캔, 침투 테스트                      │
└──────────────────────────────────────────────┘
```

### 2.5 GDPR (General Data Protection Regulation)

```
GDPR: EU 개인정보 보호 규정

K8s 관련:
- 데이터 암호화 (전송 중 + 저장 시)
- 접근 통제 (RBAC)
- 감사 로그 (데이터 접근 기록)
- 데이터 삭제 권리 (잊힐 권리)
- 데이터 이동 권리
```

### 2.6 프레임워크 비교 요약표

| 프레임워크 | 목적 | 핵심 특징 | K8s 도구 |
|-----------|------|---------|---------|
| **CIS Benchmark** | 클러스터 보안 설정 표준 | 자동 점검 (kube-bench) | kube-bench |
| **NIST CSF** | 사이버보안 관리 프레임워크 | 5기능: ID/PR/DE/RS/RC | 전체 |
| **SOC 2** | 서비스 조직 보안 인증 | Type I/II, 5개 TSC | RBAC, Audit |
| **PCI DSS** | 카드 데이터 보안 | 12가지 요구사항 | NP, Encryption |
| **GDPR** | EU 개인정보 보호 | 데이터 주체 권리 | Encryption, RBAC |

### 2.7 Compliance 프레임워크-K8s 도구 매핑

```
프레임워크별 K8s 구현 매핑:

┌─────────────────┬──────────────────────────────────┐
│ 프레임워크 요구  │ K8s 구현                          │
├─────────────────┼──────────────────────────────────┤
│ 접근 제어        │ RBAC, SA, OIDC                   │
│ 데이터 암호화    │ TLS, mTLS, Encryption at Rest     │
│ 감사 추적        │ Audit Logging, GitOps             │
│ 네트워크 분리    │ NetworkPolicy, default-deny        │
│ 취약점 관리      │ Trivy 이미지 스캔, 패치 관리        │
│ 인시던트 대응    │ Falco 탐지, Pod 격리, 로그 분석     │
│ 변경 관리        │ GitOps (ArgoCD), Audit Log         │
│ 백업/복구        │ etcd 스냅샷, Velero                │
│ 보안 테스트      │ kube-bench, 침투 테스트            │
│ 자산 인벤토리    │ kubectl get all, 라벨링 정책        │
└─────────────────┴──────────────────────────────────┘
```

---

## 3. 핵심 암기 항목

```
Audit Logging:
- 4레벨: None < Metadata < Request < RequestResponse
- Secret → Metadata (데이터 노출 방지!)
- Pod exec → RequestResponse (보안 감사)
- Audit 백엔드: Log(파일) / Webhook(외부)
- 규칙 순서: 첫 번째 매칭 규칙 적용

Compliance:
- CIS Benchmark: kube-bench 자동 점검 → PASS/FAIL/WARN/INFO
- NIST CSF: Identify/Protect/Detect/Respond/Recover
  - Falco + Audit = Detect
- SOC 2: Type I(시점) / Type II(기간, 6~12개월)
  - 핵심: 운영 효과성 입증
- PCI DSS: 카드 데이터 보안 12가지 요구사항
- GDPR: EU 개인정보 보호 (암호화, 접근 통제, 감사 로그)
```

---

## 4. 복습 체크리스트

- [ ] Audit 4레벨을 상세도 순서대로 나열할 수 있다
- [ ] Secret은 Metadata, Pod exec는 RequestResponse인 이유를 설명할 수 있다
- [ ] Audit Policy YAML을 작성할 수 있다
- [ ] CIS Benchmark와 kube-bench의 역할을 안다
- [ ] NIST CSF 5기능을 나열하고 K8s 매핑을 안다
- [ ] SOC 2 Type I/II 차이를 설명할 수 있다

---

## 내일 예고: Day 10 - 종합 모의시험 50문제, 채점, 시험 전략

- 종합 모의시험 50문제 (전 도메인)
- 채점 및 약점 분석
- 시험 당일 전략 (시간 관리, 키워드 매핑, 흔한 함정)
- tart-infra 실습

---

## tart-infra 실습

### 실습 환경 설정

```bash
alias kp='export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/platform.yaml'
alias kd='export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/dev.yaml'
```

### 실습 1: Audit Logging 확인

```bash
kp  # platform 클러스터

# API Server의 audit 설정 확인
kubectl get pod kube-apiserver-platform-master -n kube-system -o yaml | grep -E "audit" || echo "Audit 미설정"
```

**검증 — 기대 출력:**
```text
    - --audit-log-path=/var/log/kubernetes/audit.log
    - --audit-policy-file=/etc/kubernetes/audit/policy.yaml
    - --audit-log-maxage=30
    - --audit-log-maxbackup=10
```
audit 관련 플래그가 출력되지 않으면 Audit Logging이 미설정된 상태이므로 즉시 구성이 필요하다.

**동작 원리:** Audit Policy 4단계 레벨:
1. **None**: 이벤트 기록하지 않음
2. **Metadata**: 요청 메타데이터만 기록 (사용자, 리소스, verb, 시간)
3. **Request**: 메타데이터 + 요청 본문 기록
4. **RequestResponse**: 메타데이터 + 요청 본문 + 응답 본문 기록

### 실습 2: Compliance 프레임워크 점검

```bash
kd  # dev 클러스터

echo "=== CIS Benchmark 주요 항목 점검 ==="
echo ""

# 1. API Server 보안
echo "[1.1] Authorization Mode:"
kubectl get pod kube-apiserver-dev-master -n kube-system -o yaml | grep authorization-mode

# 2. etcd 보안
echo "[2.1] etcd client-cert-auth:"
kubectl get pod etcd-dev-master -n kube-system -o yaml | grep client-cert-auth

# 3. NetworkPolicy 존재 여부
echo "[5.1] NetworkPolicy count:"
kubectl get ciliumnetworkpolicies -n demo --no-headers 2>/dev/null | wc -l

# 4. Secret 관리
echo "[5.4] Secret encryption:"
kubectl get pod kube-apiserver-dev-master -n kube-system -o yaml | grep encryption-provider || echo "  Not configured"
```

**검증 — 기대 출력:**
```text
=== CIS Benchmark 주요 항목 점검 ===

[1.1] Authorization Mode:
    - --authorization-mode=Node,RBAC
[2.1] etcd client-cert-auth:
    - --client-cert-auth=true
[5.1] NetworkPolicy count:
       5
[5.4] Secret encryption:
  Not configured
```

**동작 원리:** 주요 Compliance 프레임워크:
1. **CIS Benchmark**: K8s 보안 설정 가이드라인 -- kube-bench로 자동 점검
2. **NIST CSF**: 식별(Identify) -> 보호(Protect) -> 탐지(Detect) -> 대응(Respond) -> 복구(Recover)
3. **SOC 2**: 서비스 조직의 보안, 가용성, 처리 무결성, 기밀성, 프라이버시
4. **PCI DSS**: 결제 카드 데이터 보안 표준

### 트러블슈팅: Audit Logging 및 Compliance 문제

```
장애 시나리오 1: Audit Log 활성화 후 API Server 성능 저하
  증상: API 응답 시간 증가, kubectl 명령 지연
  원인: RequestResponse 레벨을 모든 리소스에 적용하여 로그 양이 폭증
  디버깅:
    ls -lh /var/log/kubernetes/audit.log
    du -sh /var/log/kubernetes/
  해결: Audit Policy에서 노이즈를 제거한다:
    - 헬스 체크(/healthz, /readyz)를 None으로 설정
    - kube-proxy, kubelet의 watch 요청을 None으로 설정
    - 일반 리소스는 Metadata 레벨로 낮춘다
    - audit-log-maxsize와 audit-log-maxbackup을 적절히 설정한다

장애 시나리오 2: Audit Log에 Secret 내용이 노출됨
  증상: 감사 로그에 Secret의 data 필드(비밀번호)가 기록됨
  공격-방어 매핑: Information Disclosure → Audit Log를 통한 민감 데이터 노출
  원인: Secret에 Request 또는 RequestResponse 레벨이 적용됨
  해결: Secret과 ConfigMap은 반드시 Metadata 레벨로 설정한다:
    - level: Metadata
      resources:
        - group: ""
          resources: ["secrets", "configmaps"]
```
