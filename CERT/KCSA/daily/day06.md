# KCSA Day 6: NetworkPolicy, Secret 관리, OPA/Kyverno, 연습 문제

> **시험 비중:** Kubernetes Security Fundamentals — 22%
> **목표:** NetworkPolicy의 AND/OR 규칙과 default-deny를 이해하고, Secret 관리 모범 사례, 정책 엔진(OPA/Kyverno)을 학습한 후 연습 문제로 점검한다.

---

## 1. NetworkPolicy 심화

### 1.1 NetworkPolicy 기본 개념

```
NetworkPolicy가 없는 네임스페이스:
→ 모든 Pod 간 통신이 허용된다 (All Allow)
→ ★ 시험 빈출: "NetworkPolicy가 없으면?" → 모든 통신 허용!

NetworkPolicy가 있으면:
→ 선택된 Pod에 대해 명시적으로 허용된 트래픽만 통과
→ 나머지는 모두 차단 (Whitelist 방식)
```

### 1.2 Default Deny 정책 (Zero Trust 구현)

```yaml
# Ingress Default Deny (모든 인바운드 차단)
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-ingress
  namespace: production
spec:
  podSelector: {}           # {} = 모든 Pod 선택
  policyTypes:
    - Ingress               # Ingress만 차단
  # ingress 규칙 없음 → 모든 인바운드 트래픽 차단

---
# Egress Default Deny (모든 아웃바운드 차단)
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-egress
  namespace: production
spec:
  podSelector: {}
  policyTypes:
    - Egress
  # egress 규칙 없음 → 모든 아웃바운드 트래픽 차단
  # ★ 주의: DNS(53번 포트)도 차단됨!

---
# Ingress + Egress 모두 Default Deny
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
  namespace: production
spec:
  podSelector: {}
  policyTypes:
    - Ingress
    - Egress
```

### 1.3 AND/OR 규칙 (핵심!)

```yaml
# ★★★ 시험 빈출: AND vs OR 구분

# 패턴 1: AND (같은 from 항목 내 복수 셀렉터)
spec:
  ingress:
    - from:
        - namespaceSelector:       # ← 이 두 조건이
            matchLabels:            #    하나의 from 항목에 있으므로
              env: production       #    AND로 결합
          podSelector:              # ←
            matchLabels:
              role: frontend
      # 의미: production NS에 있는 AND frontend Pod만 허용

# 패턴 2: OR (별도 from 항목)
spec:
  ingress:
    - from:
        - namespaceSelector:       # ← 별도 항목 1
            matchLabels:
              env: production
        - podSelector:             # ← 별도 항목 2
            matchLabels:
              role: frontend
      # 의미: production NS의 모든 Pod OR 같은 NS의 frontend Pod

# 핵심 구분법:
# - 같은 "- from:" 아래 하이픈(-)이 하나 → AND
# - 같은 "- from:" 아래 하이픈(-)이 여러 개 → OR
```

```
AND vs OR 시각적 비교:

AND (하나의 from 항목에 두 셀렉터):
  - from:
      - namespaceSelector: {env: prod}   ←─┐
        podSelector: {role: frontend}    ←─┘ AND

OR (두 개의 from 항목):
  - from:
      - namespaceSelector: {env: prod}   ←── OR
      - podSelector: {role: frontend}    ←── OR
```

### 1.4 NetworkPolicy 실전 예제

```yaml
# 웹 서버에 대한 NetworkPolicy
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: web-policy
  namespace: production
spec:
  podSelector:
    matchLabels:
      app: web

  policyTypes:
    - Ingress
    - Egress

  ingress:
    # 인그레스 컨트롤러에서 오는 HTTP 트래픽 허용
    - from:
        - namespaceSelector:
            matchLabels:
              name: ingress-nginx
      ports:
        - protocol: TCP
          port: 8080

  egress:
    # DNS 허용 (필수!)
    - to:
        - namespaceSelector: {}     # 모든 NS의 DNS 서비스
      ports:
        - protocol: UDP
          port: 53
        - protocol: TCP
          port: 53

    # 백엔드 API 호출 허용
    - to:
        - podSelector:
            matchLabels:
              app: api
      ports:
        - protocol: TCP
          port: 3000
```

### 1.5 CNI와 NetworkPolicy 지원

```
CNI별 NetworkPolicy 지원:

┌────────────┬──────────────┬───────────────────────────┐
│ CNI        │ NP 지원      │ 비고                       │
├────────────┼──────────────┼───────────────────────────┤
│ Cilium     │ ✓ L3/L4/L7  │ eBPF 기반, L7 HTTP 정책    │
│ Calico     │ ✓ L3/L4     │ iptables/eBPF              │
│ Weave      │ ✓ L3/L4     │ 기본 지원                   │
│ Flannel    │ ✗ 미지원!    │ 기본 오버레이만             │
│ Canal      │ ✓ L3/L4     │ Flannel + Calico NP        │
└────────────┴──────────────┴───────────────────────────┘

★ 시험 빈출: "Flannel의 NetworkPolicy 지원은?" → 미지원!
★ 시험 빈출: "Cilium이 표준 NP보다 우수한 점은?" → L7(HTTP) 정책
```

---

## 2. Secret 관리 심화

### 2.1 Secret의 기본 저장 방식

```
★★★ 핵심 암기: Secret은 Base64 인코딩이지 암호화가 아니다!

$ echo "password123" | base64
cGFzc3dvcmQxMjMK

$ echo "cGFzc3dvcmQxMjMK" | base64 -d
password123

Base64는 누구나 디코딩 가능! → 암호화 아님!

Secret 보안을 위한 추가 조치:
1. Encryption at Rest → etcd에 암호화 저장
2. RBAC → Secret 읽기 권한 제한
3. 외부 시크릿 관리자 → Vault, AWS Secrets Manager
```

### 2.2 Secret 전달 방법 비교

```
Secret을 Pod에 전달하는 2가지 방법:

┌───────────────────────────────────────────────────┐
│ 방법 1: 환경 변수 (덜 안전)                        │
│                                                   │
│ env:                                              │
│   - name: DB_PASSWORD                             │
│     valueFrom:                                    │
│       secretKeyRef:                               │
│         name: db-secret                           │
│         key: password                             │
│                                                   │
│ ✗ 위험: 환경 변수는 로그, 프로세스 목록에 노출 가능  │
│ ✗ 위험: 환경 변수 변경 시 Pod 재시작 필요            │
│ ✗ 위험: 자식 프로세스에 자동 상속                    │
├───────────────────────────────────────────────────┤
│ 방법 2: Volume 마운트 (더 안전) ★                  │
│                                                   │
│ volumes:                                          │
│   - name: db-secret-vol                           │
│     secret:                                       │
│       secretName: db-secret                       │
│ containers:                                       │
│   - volumeMounts:                                 │
│       - name: db-secret-vol                       │
│         mountPath: /etc/secrets                   │
│         readOnly: true                            │
│                                                   │
│ ✓ 파일 시스템 권한으로 접근 제어                    │
│ ✓ Secret 업데이트 시 자동 반영 (재시작 불필요)       │
│ ✓ tmpfs에 마운트 (디스크에 저장 안 됨)              │
└───────────────────────────────────────────────────┘

★ 시험 빈출: "Secret 전달 시 더 안전한 방법은?" → Volume 마운트
```

### 2.3 Secret 유형

```
Kubernetes Secret 유형:

| 유형 | 용도 |
|------|------|
| Opaque | 일반 목적 (기본값) |
| kubernetes.io/tls | TLS 인증서 (tls.crt + tls.key) |
| kubernetes.io/dockerconfigjson | 컨테이너 레지스트리 인증 |
| kubernetes.io/service-account-token | SA 토큰 (Legacy) |
| kubernetes.io/basic-auth | 기본 인증 (username + password) |
| kubernetes.io/ssh-auth | SSH 키 |
```

### 2.4 외부 시크릿 관리

```
외부 시크릿 관리자와 K8s 통합:

┌────────────────────────────────────────────────────────┐
│ HashiCorp Vault                                        │
│   - 동적 시크릿 생성/갱신                               │
│   - 자동 만료                                          │
│   - K8s 통합: Vault Agent Injector, CSI Driver          │
├────────────────────────────────────────────────────────┤
│ AWS Secrets Manager / GCP Secret Manager               │
│   - 클라우드 네이티브 통합                               │
│   - 자동 로테이션                                       │
│   - K8s 통합: External Secrets Operator                 │
├────────────────────────────────────────────────────────┤
│ Sealed Secrets (Bitnami)                               │
│   - Secret을 암호화하여 Git에 저장 가능                  │
│   - 클러스터의 공개 키로 암호화                           │
│   - GitOps 친화적                                       │
└────────────────────────────────────────────────────────┘
```

---

## 3. OPA Gatekeeper / Kyverno

### 3.1 정책 엔진의 역할

```
정책 엔진은 Validating/Mutating Admission Webhook으로 동작한다.

PSA만으로 부족한 이유:
- PSA는 Pod SecurityContext만 검증
- 정책 엔진은 모든 K8s 리소스에 대해 커스텀 정책 적용 가능

정책 엔진으로 가능한 것:
✓ 이미지 레지스트리 제한 (특정 레지스트리만 허용)
✓ 라벨 필수 요구 (app, team 라벨 없으면 거부)
✓ latest 태그 금지
✓ 리소스 제한 필수 요구
✓ 특정 hostPath 마운트 금지
```

### 3.2 OPA Gatekeeper vs Kyverno 비교

```
┌────────────────┬──────────────────┬──────────────────┐
│                │ OPA Gatekeeper   │ Kyverno          │
├────────────────┼──────────────────┼──────────────────┤
│ 정책 언어      │ Rego (학습 필요)  │ YAML (K8s 네이티브)│
│ CNCF 상태      │ Graduated        │ Incubating       │
│ 학습 난이도     │ 높음             │ 낮음              │
│ 유연성         │ 매우 높음        │ 높음              │
│ Mutate 지원    │ 제한적           │ ✓ 완전 지원       │
│ Generate 지원  │ ✗                │ ✓ 리소스 자동 생성 │
│ 이미지 검증     │ 외부 도구 필요    │ ✓ 내장            │
│ 감사(Audit)    │ ✓                │ ✓                │
└────────────────┴──────────────────┴──────────────────┘

시험 빈출: "YAML 기반 정책 엔진은?" → Kyverno
시험 빈출: "Rego 언어를 사용하는 것은?" → OPA Gatekeeper
```

### 3.3 Kyverno 정책 예제

```yaml
# Kyverno: latest 태그 금지 정책
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: disallow-latest-tag
spec:
  validationFailureAction: Enforce    # Enforce(거부) / Audit(감사)
  rules:
    - name: require-image-tag
      match:
        any:
          - resources:
              kinds:
                - Pod
      validate:
        message: "latest 태그 사용이 금지되어 있습니다. 구체적인 버전 태그를 사용하세요."
        pattern:
          spec:
            containers:
              - image: "!*:latest"    # latest가 아닌 것만 허용
```

```yaml
# Kyverno: 필수 라벨 강제
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: require-labels
spec:
  validationFailureAction: Enforce
  rules:
    - name: require-app-label
      match:
        any:
          - resources:
              kinds:
                - Pod
      validate:
        message: "app 라벨이 필요합니다."
        pattern:
          metadata:
            labels:
              app: "?*"              # 비어있지 않은 값 필수
```

### 3.4 OPA Gatekeeper ConstraintTemplate 예제

```yaml
# ConstraintTemplate 정의 (Rego 언어)
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
          msg := sprintf("이미지 '%v'는 허용되지 않은 레지스트리입니다", [container.image])
        }

---
# Constraint 적용 (어떤 네임스페이스에 어떤 정책을)
apiVersion: constraints.gatekeeper.sh/v1beta1
kind: K8sAllowedRepos
metadata:
  name: allowed-repos
spec:
  match:
    kinds:
      - apiGroups: [""]
        kinds: ["Pod"]
    namespaces: ["production"]
  parameters:
    repos:
      - "registry.k8s.io/"
      - "docker.io/library/"
      - "ghcr.io/myorg/"
```

---

## 4. 시험 출제 패턴 분석

```
패턴 1: "NetworkPolicy가 없는 네임스페이스에서 Pod 간 통신은?"
  → 모든 통신 허용 (All Allow)

패턴 2: "같은 from 항목 내 두 셀렉터의 관계는?"
  → AND

패턴 3: "Secret의 기본 저장 방식은?"
  → Base64 인코딩 (암호화 아님!)

패턴 4: "Secret 전달 시 더 안전한 방법은?"
  → Volume 마운트

패턴 5: "YAML 기반 정책 엔진은?"
  → Kyverno

패턴 6: "Flannel CNI의 NetworkPolicy 지원은?"
  → 미지원
```

---

## 5. 연습 문제 (18문제 + 상세 해설)

### 문제 1.
NetworkPolicy가 없는 네임스페이스에서 Pod 간 통신 기본 동작은?

A) 모든 트래픽 차단
B) 모든 트래픽 허용
C) 같은 NS만 허용
D) DNS만 허용

<details><summary>정답 확인</summary>

**정답: B) 모든 트래픽 허용**

**왜 정답인가:** NetworkPolicy가 없으면 K8s는 기본적으로 모든 Pod 간 통신을 허용한다. default-deny 정책을 수동으로 생성해야 한다.

</details>

### 문제 2.
NetworkPolicy에서 `podSelector: {}`의 의미는?

A) Pod 없음
B) 모든 Pod
C) 라벨 없는 Pod만
D) default NS만

<details><summary>정답 확인</summary>

**정답: B) 모든 Pod**

**왜 정답인가:** 빈 셀렉터 `{}`는 모든 것을 선택한다. default-deny 정책에서 사용된다.

</details>

### 문제 3.
NetworkPolicy의 같은 from 항목 내 셀렉터 관계는?

A) OR
B) AND
C) XOR
D) 무관

<details><summary>정답 확인</summary>

**정답: B) AND**

**왜 정답인가:** 같은 from 항목 내 = AND, 별도 from 항목 = OR. YAML 들여쓰기로 구분한다.

</details>

### 문제 4.
Egress default-deny 적용 시 반드시 허용해야 하는 포트는?

A) 80 (HTTP)
B) 443 (HTTPS)
C) 53 (DNS)
D) 22 (SSH)

<details><summary>정답 확인</summary>

**정답: C) 53 (DNS)**

**왜 정답인가:** DNS가 차단되면 서비스 디스커버리가 불가능하다. UDP/TCP 53을 반드시 허용해야 한다.

</details>

### 문제 5.
Flannel CNI의 NetworkPolicy 지원은?

A) 완전 지원
B) 부분 지원
C) 미지원
D) L7 지원

<details><summary>정답 확인</summary>

**정답: C) 미지원**

**왜 정답인가:** Flannel은 기본 오버레이 네트워크만 제공한다. NetworkPolicy가 필요하면 Cilium이나 Calico를 사용해야 한다.

</details>

### 문제 6.
Secret의 기본 저장 방식은?

A) AES-256 암호화
B) Base64 인코딩 (평문)
C) Vault 자동 저장
D) 노드 로컬 파일

<details><summary>정답 확인</summary>

**정답: B) Base64 인코딩 (평문)**

**왜 정답인가:** Base64는 인코딩이지 암호화가 아니다! 누구나 디코딩 가능. Encryption at Rest를 별도로 설정해야 한다.

</details>

### 문제 7.
Secret 전달 시 더 안전한 방법은?

A) 환경 변수
B) Volume 마운트
C) 동일
D) ConfigMap

<details><summary>정답 확인</summary>

**정답: B) Volume 마운트**

**왜 정답인가:** 환경 변수는 로그, 프로세스 목록, 자식 프로세스에 노출될 수 있다. Volume은 파일 권한으로 보호되며 tmpfs에 저장된다.

</details>

### 문제 8.
automountServiceAccountToken: false를 설정하는 경우는?

A) 모든 Pod
B) API Server 접근이 불필요한 Pod
C) 관리자 Pod만
D) DaemonSet만

<details><summary>정답 확인</summary>

**정답: B) API Server 접근이 불필요한 Pod**

**왜 정답인가:** 불필요한 SA 토큰은 탈취 위험을 증가시킨다. API Server 접근이 필요 없다면 마운트를 비활성화한다.

</details>

### 문제 9.
RBAC에서 ClusterRole을 RoleBinding으로 바인딩하면?

A) 클러스터 전체 적용
B) 해당 네임스페이스에서만 적용
C) 바인딩 실패
D) 자동 변환

<details><summary>정답 확인</summary>

**정답: B) 해당 네임스페이스에서만 적용**

**왜 정답인가:** ClusterRole을 여러 네임스페이스에서 재사용하는 유용한 패턴이다. ClusterRoleBinding을 사용해야 클러스터 전체에 적용된다.

</details>

### 문제 10.
PSS Restricted 필수 요구사항이 아닌 것은?

A) runAsNonRoot: true
B) allowPrivilegeEscalation: false
C) readOnlyRootFilesystem: true
D) capabilities.drop: ["ALL"]

<details><summary>정답 확인</summary>

**정답: C) readOnlyRootFilesystem: true**

**왜 정답인가:** readOnlyRootFilesystem은 모범 사례이지만 PSS Restricted에서 강제하지 않는다! 시험 단골 함정이다.

</details>

### 문제 11.
Bound ServiceAccount Token의 특성이 아닌 것은?

A) 만료 시간 있음
B) audience 제한
C) Pod 삭제 시 무효
D) 영구 유효

<details><summary>정답 확인</summary>

**정답: D) 영구 유효**

**왜 정답인가:** Bound Token은 시간 제한이 있으며 (기본 1시간), audience가 제한되고, Pod에 바인딩된다. 영구 유효한 것은 Legacy Token이다.

</details>

### 문제 12.
PSS Restricted에서 추가 가능한 유일한 capability는?

A) NET_ADMIN
B) SYS_PTRACE
C) NET_BIND_SERVICE
D) SYS_ADMIN

<details><summary>정답 확인</summary>

**정답: C) NET_BIND_SERVICE**

**왜 정답인가:** 1024 미만 포트 바인딩에 필요한 capability이다. Restricted에서는 capabilities.drop: ["ALL"] 후 이것만 add 가능하다.

</details>

### 문제 13.
RBAC에서 escalate verb의 위험성은?

A) Pod 삭제
B) Role 권한 상승 가능
C) Secret 읽기
D) NS 삭제

<details><summary>정답 확인</summary>

**정답: B) Role 권한 상승 가능**

**왜 정답인가:** escalate verb가 있으면 자기 자신보다 높은 권한을 가진 Role을 만들 수 있다.

</details>

### 문제 14.
Kyverno와 OPA Gatekeeper의 차이로 올바른 것은?

A) Kyverno는 Rego 사용
B) OPA는 YAML 기반
C) Kyverno는 YAML, OPA는 Rego
D) 둘 다 동일

<details><summary>정답 확인</summary>

**정답: C) Kyverno는 YAML, OPA는 Rego**

**왜 정답인가:** Kyverno는 K8s 네이티브 YAML로 정책을 작성하고, OPA Gatekeeper는 Rego라는 별도 언어를 사용한다.

</details>

### 문제 15.
PSA에서 정책 위반 Pod를 거부하는 모드는?

A) audit
B) warn
C) enforce
D) deny

<details><summary>정답 확인</summary>

**정답: C) enforce**

**왜 정답인가:** enforce는 위반 시 생성을 거부한다. audit은 로그만 기록, warn은 경고만 표시한다.

</details>

### 문제 16.
PodSecurityPolicy(PSP)가 완전히 제거된 K8s 버전은?

A) 1.21
B) 1.23
C) 1.25
D) 1.27

<details><summary>정답 확인</summary>

**정답: C) 1.25**

**왜 정답인가:** PSP는 1.21에서 deprecated, 1.25에서 완전히 제거되었다. 후속은 PSS/PSA이다.

</details>

### 문제 17.
Cilium이 표준 NetworkPolicy보다 우수한 점은?

A) 기본 통신 허용
B) L7(HTTP) 정책 적용
C) RBAC 관리
D) Secret 암호화

<details><summary>정답 확인</summary>

**정답: B) L7(HTTP) 정책 적용**

**왜 정답인가:** Cilium은 eBPF 기반으로 HTTP 메서드, 경로 등 L7 수준의 접근 제어가 가능하다.

</details>

### 문제 18.
roleRef의 특성으로 올바른 것은?

A) 언제든 수정 가능
B) update로 변경 가능
C) 변경 불가, 삭제 후 재생성 필요
D) patch로만 변경 가능

<details><summary>정답 확인</summary>

**정답: C) 변경 불가, 삭제 후 재생성 필요**

**왜 정답인가:** RoleBinding/ClusterRoleBinding의 roleRef는 immutable(불변)이다. 다른 Role/ClusterRole로 변경하려면 바인딩을 삭제하고 새로 생성해야 한다.

</details>

---

## 6. 핵심 암기 항목

```
NetworkPolicy:
- 없으면 = 모든 통신 허용 (All Allow)
- podSelector: {} = 모든 Pod
- 같은 from 항목 = AND / 별도 from 항목 = OR
- Egress default-deny 시 DNS(53) 반드시 허용
- Flannel: NetworkPolicy 미지원!
- Cilium: L7(HTTP) 정책 지원

Secret:
- Base64 = 인코딩 ≠ 암호화!
- Volume 마운트 > 환경 변수 (보안)
- Encryption at Rest 필수

OPA/Kyverno:
- OPA Gatekeeper: Rego 언어, CNCF Graduated
- Kyverno: YAML 기반, CNCF Incubating
- 용도: 이미지 레지스트리 제한, 라벨 강제, latest 금지 등
```

---

## 7. 복습 체크리스트

- [ ] NetworkPolicy가 없을 때의 기본 동작을 알고 있다
- [ ] default-deny 정책 YAML을 작성할 수 있다
- [ ] AND/OR 규칙을 구분할 수 있다
- [ ] Egress deny 시 DNS 허용이 필요한 이유를 안다
- [ ] Flannel의 NP 미지원을 알고 있다
- [ ] Secret의 Base64 인코딩 ≠ 암호화를 이해한다
- [ ] Volume vs 환경 변수의 보안 차이를 설명할 수 있다
- [ ] OPA Gatekeeper와 Kyverno의 차이를 설명할 수 있다
- [ ] 연습 문제 18문제를 모두 풀 수 있다

---

## 내일 예고: Day 7 - MITRE ATT&CK, 공급망 보안 심화, 런타임 보안

- MITRE ATT&CK for Containers 9대 전술
- 공급망 보안 심화 (이미지 서명, 정책 적용)
- 런타임 보안 (Falco, seccomp, AppArmor, SELinux)
- tart-infra 실습

---

## tart-infra 실습

### 실습 환경 설정

```bash
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/dev.yaml
kubectl get nodes
```

### 실습 1: NetworkPolicy 확인

```bash
# CiliumNetworkPolicy 확인
echo "=== NetworkPolicy 목록 ==="
kubectl get ciliumnetworkpolicies -n demo 2>/dev/null || echo "CiliumNetworkPolicy 없음"
kubectl get networkpolicies -n demo 2>/dev/null || echo "NetworkPolicy 없음"
```

**동작 원리:** NetworkPolicy:
1. NetworkPolicy가 없으면 모든 Pod 간 통신이 허용된다
2. default-deny 정책으로 Zero Trust 구현
3. 필요한 트래픽만 명시적으로 허용 (Whitelist)
4. Egress deny 시 DNS(53번 포트)를 반드시 허용

### 실습 2: Secret 관리 확인

```bash
echo "=== Secret 목록 ==="
kubectl get secrets -n demo

echo ""
echo "=== Secret 유형 ==="
kubectl get secrets -n demo -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.type}{"\n"}{end}'

echo ""
echo "=== Encryption at Rest 설정 ==="
kubectl get pod kube-apiserver-dev-master -n kube-system -o yaml | grep encryption-provider || echo "Encryption at Rest 미설정"
```

**동작 원리:** Secret 보안:
1. Base64 인코딩은 암호화가 아님 → Encryption at Rest 필요
2. Volume 마운트가 환경 변수보다 안전
3. automountServiceAccountToken: false로 불필요한 토큰 제거
4. 외부 시크릿 관리자(Vault) 연동 권장

### 실습 3: RBAC 권한 테스트

```bash
# 현재 사용자 권한
echo "=== 현재 사용자 권한 ==="
kubectl auth can-i create pods -n demo
kubectl auth can-i delete secrets -n demo
kubectl auth can-i '*' '*'

# default SA 권한
echo ""
echo "=== default SA 권한 ==="
kubectl auth can-i get pods --as=system:serviceaccount:demo:default -n demo
kubectl auth can-i create pods --as=system:serviceaccount:demo:default -n demo
```

**동작 원리:** RBAC 보안 점검:
1. 최소 권한 원칙: 필요한 권한만 부여
2. 와일드카드(*) 사용 지양
3. cluster-admin 바인딩 최소화
4. 정기적 권한 감사

### 실습 4: PSA 레이블 테스트

```bash
# PSA 적용 테스트 (dry-run)
echo "=== PSA Restricted 적용 시뮬레이션 ==="
kubectl label namespace demo \
  pod-security.kubernetes.io/enforce=restricted \
  --dry-run=server --overwrite 2>&1 || echo "dry-run 결과 확인"

echo ""
echo "=== 현재 demo NS 레이블 ==="
kubectl get namespace demo --show-labels
```

**동작 원리:** PSA 점진적 적용:
1. audit + warn으로 시작 → 위반 현황 파악
2. enforce=baseline + audit=restricted → 기본 차단
3. enforce=restricted → 최종 강화
