# KCSA Day 10: 종합 모의시험 50문제, 채점, 시험 전략

> **목표:** 종합 모의시험 50문제로 전 범위를 점검하고, 약점 분석 및 시험 당일 전략을 수립한다.
> **시험 조건:** 총 50문제, 75분 제한, 67% (34문제) 이상 합격

---

## 0. KCSA 시험의 등장 배경

```
기존 방식의 한계:
Kubernetes 보안 관련 인증이 CKS(Certified Kubernetes Security Specialist)
하나뿐이었다. CKS는 실습 기반의 고급 시험으로 진입 장벽이 높았다.

1. CKS는 CKA 합격이 전제 조건이므로 보안 전문 인력이 접근하기 어렵다
2. 보안 아키텍트, 관리자, 의사결정자에게는 개념적 이해가 더 중요하다
3. 클라우드 네이티브 보안의 전체 그림(프레임워크, 도구, 프로세스)을
   포괄하는 인증이 부재했다

해결:
KCSA(Kubernetes and Cloud Native Security Associate)는 개념 기반
시험으로, 4C 모델, STRIDE, MITRE ATT&CK, CIS Benchmark, NIST CSF 등
보안 프레임워크와 도구의 이해도를 측정한다. 객관식 50문제, 75분, 67% 합격이다.
```

## 1. 종합 모의시험 (50문제)

> **도메인 배분:** Overview 7문제 / Cluster 11문제 / Fundamentals 11문제 / Threat 8문제 / Platform 8문제 / Compliance 5문제

---

### [Overview] 문제 1.
4C 보안 모델에서 Kubernetes RBAC가 속하는 계층은?

A) Cloud
B) Cluster
C) Container
D) Code

<details><summary>정답</summary>

**B) Cluster** — RBAC, NetworkPolicy, Admission Control은 Cluster 계층이다.

</details>

### [Overview] 문제 2.
STRIDE 위협 모델에서 감사 로그가 없어서 리소스 삭제 행위를 부인하는 것은?

A) Spoofing
B) Tampering
C) Repudiation
D) Information Disclosure

<details><summary>정답</summary>

**C) Repudiation** — 행위를 부인하는 것. Audit Logging으로 대응한다.

</details>

### [Overview] 문제 3.
Zero Trust의 네트워크 기본 정책은?

A) Allow All
B) Deny All (명시적 허용만 통과)
C) 내부 네트워크는 허용
D) VPN 연결만 허용

<details><summary>정답</summary>

**B) Deny All** — "Never trust, always verify". default-deny NetworkPolicy가 구현.

</details>

### [Overview] 문제 4.
SBOM의 주요 형식이 아닌 것은?

A) SPDX
B) CycloneDX
C) YAML
D) 둘 다 아님

<details><summary>정답</summary>

**C) YAML** — SBOM 형식은 SPDX(Linux Foundation)와 CycloneDX(OWASP)이다.

</details>

### [Overview] 문제 5.
Shift Left에서 CI/CD에 통합하는 보안 활동이 아닌 것은?

A) 이미지 취약점 스캐닝
B) SAST
C) 프로덕션 서버 물리적 보안 점검
D) 의존성 취약점 분석

<details><summary>정답</summary>

**C) 물리적 보안 점검** — CI/CD에 통합할 수 없는 활동이다.

</details>

### [Overview] 문제 6.
CNCF Security TAG의 역할이 아닌 것은?

A) 보안 백서 발행
B) 프로젝트 보안 감사
C) Kubernetes 릴리스 관리
D) 공급망 보안 가이드

<details><summary>정답</summary>

**C) Kubernetes 릴리스 관리** — SIG Release의 역할이다.

</details>

### [Overview] 문제 7.
공유 책임 모델에서 클라우드 제공자의 책임은?

A) RBAC 설정
B) NetworkPolicy 설정
C) 데이터센터 물리적 보안
D) 이미지 스캐닝

<details><summary>정답</summary>

**C) 데이터센터 물리적 보안** — 인프라 수준의 물리적 보안은 클라우드 제공자 책임이다.

</details>

---

### [Cluster] 문제 8.
API Server의 요청 처리 순서는?

A) 인증 → Admission → 인가
B) 인가 → 인증 → Admission
C) 인증 → 인가 → Admission
D) Admission → 인증 → 인가

<details><summary>정답</summary>

**C) 인증 → 인가 → Admission**

</details>

### [Cluster] 문제 9.
API Server에서 권장하는 authorization-mode는?

A) AlwaysAllow
B) Node,RBAC
C) ABAC
D) AlwaysDeny

<details><summary>정답</summary>

**B) Node,RBAC** — Node는 kubelet 접근 제한, RBAC는 역할 기반 제어.

</details>

### [Cluster] 문제 10.
etcd의 Encryption at Rest에서 프로덕션에 가장 권장되는 프로바이더는?

A) identity
B) aescbc
C) kms v2
D) aesgcm

<details><summary>정답</summary>

**C) kms v2** — 외부 KMS로 키를 관리하므로 가장 안전하다.

</details>

### [Cluster] 문제 11.
kubelet의 읽기 전용 포트를 비활성화하는 설정은?

A) --read-only-port=10255
B) --read-only-port=0
C) --disable-read-only-port
D) --read-only-port=false

<details><summary>정답</summary>

**B) --read-only-port=0** — 0으로 설정하면 비활성화된다.

</details>

### [Cluster] 문제 12.
Admission Controller의 실행 순서는?

A) Validating → Mutating
B) Mutating → Validating
C) 동시 병렬
D) 랜덤

<details><summary>정답</summary>

**B) Mutating → Validating** — Mutating에서 수정 후 Validating에서 검증.

</details>

### [Cluster] 문제 13.
NodeRestriction admission controller의 역할은?

A) 노드 CPU 제한
B) kubelet이 자신의 노드/Pod만 수정 가능하도록 제한
C) 새 노드 참여 제한
D) 노드 간 트래픽 제한

<details><summary>정답</summary>

**B) kubelet이 자신의 노드/Pod만 수정 가능하도록 제한**

</details>

### [Cluster] 문제 14.
kubeadm 클러스터에서 인증서가 저장되는 기본 디렉토리는?

A) /var/lib/kubelet/pki/
B) /etc/kubernetes/pki/
C) /opt/kubernetes/certs/
D) ~/.kube/certs/

<details><summary>정답</summary>

**B) /etc/kubernetes/pki/**

</details>

### [Cluster] 문제 15.
API Server와 etcd 사이의 TLS 유형은?

A) 단방향 TLS
B) mTLS (상호 TLS)
C) 평문
D) SSH

<details><summary>정답</summary>

**B) mTLS** — 양쪽 모두 상대방의 인증서를 검증한다.

</details>

### [Cluster] 문제 16.
Kubernetes 인증서 기본 유효 기간은?

A) 인증서 1년, CA 1년
B) 인증서 1년, CA 10년
C) 인증서 10년, CA 10년
D) 인증서 90일, CA 1년

<details><summary>정답</summary>

**B) 인증서 1년, CA 10년**

</details>

### [Cluster] 문제 17.
Static Pod의 보안 특성으로 올바른 것은?

A) API Server의 Admission Control이 완전히 적용된다
B) kubelet이 직접 관리하며 Admission Control이 적용되지 않을 수 있다
C) etcd에 직접 저장된다
D) RBAC로 삭제 가능하다

<details><summary>정답</summary>

**B) kubelet이 직접 관리하며 Admission Control이 적용되지 않을 수 있다**

</details>

### [Cluster] 문제 18.
EncryptionConfiguration에서 providers 순서의 의미는?

A) 순서 무관
B) 첫 번째로 새 데이터 암호화, 나머지는 기존 데이터 복호화
C) 마지막으로 새 데이터 암호화
D) 모든 프로바이더로 중복 암호화

<details><summary>정답</summary>

**B) 첫 번째로 새 데이터 암호화, 나머지는 기존 데이터 복호화**

</details>

---

### [Fundamentals] 문제 19.
RBAC에서 ClusterRole을 RoleBinding으로 바인딩하면?

A) 클러스터 전체 적용
B) 해당 네임스페이스에서만 적용
C) 바인딩 실패
D) 자동 변환

<details><summary>정답</summary>

**B) 해당 네임스페이스에서만 적용** — ClusterRole 재사용의 유용한 패턴이다.

</details>

### [Fundamentals] 문제 20.
PSS Restricted 필수 요구사항이 아닌 것은?

A) runAsNonRoot: true
B) allowPrivilegeEscalation: false
C) readOnlyRootFilesystem: true
D) capabilities.drop: ["ALL"]

<details><summary>정답</summary>

**C) readOnlyRootFilesystem** — 모범 사례이지만 Restricted 필수 아님!

</details>

### [Fundamentals] 문제 21.
NetworkPolicy에서 podSelector: {}의 의미는?

A) Pod 없음
B) 모든 Pod
C) 라벨 없는 Pod만
D) default NS만

<details><summary>정답</summary>

**B) 모든 Pod** — 빈 셀렉터는 모든 것을 선택한다.

</details>

### [Fundamentals] 문제 22.
Secret의 기본 저장 방식은?

A) AES-256 암호화
B) Base64 인코딩 (평문)
C) Vault 자동 저장
D) 노드 로컬 파일

<details><summary>정답</summary>

**B) Base64 인코딩** — 암호화가 아닌 인코딩! Encryption at Rest 필요.

</details>

### [Fundamentals] 문제 23.
automountServiceAccountToken: false를 설정하는 경우는?

A) 모든 Pod
B) API Server 접근이 불필요한 Pod
C) 관리자 Pod만
D) DaemonSet만

<details><summary>정답</summary>

**B) API Server 접근이 불필요한 Pod** — 불필요한 토큰은 탈취 위험 증가.

</details>

### [Fundamentals] 문제 24.
NetworkPolicy의 같은 from 항목 내 셀렉터 관계는?

A) OR
B) AND
C) XOR
D) 무관

<details><summary>정답</summary>

**B) AND** — 같은 항목 = AND, 별도 항목 = OR.

</details>

### [Fundamentals] 문제 25.
Bound ServiceAccount Token의 특성이 아닌 것은?

A) 만료 시간 있음
B) audience 제한
C) Pod 삭제 시 무효
D) 영구 유효

<details><summary>정답</summary>

**D) 영구 유효** — Bound Token은 시간 제한이 있다.

</details>

### [Fundamentals] 문제 26.
Secret 전달 시 더 안전한 방법은?

A) 환경 변수
B) Volume 마운트
C) 동일
D) ConfigMap

<details><summary>정답</summary>

**B) Volume 마운트** — 환경 변수는 로그/프로세스에 노출 가능.

</details>

### [Fundamentals] 문제 27.
PSS Restricted에서 추가 가능한 유일한 capability는?

A) NET_ADMIN
B) SYS_PTRACE
C) NET_BIND_SERVICE
D) SYS_ADMIN

<details><summary>정답</summary>

**C) NET_BIND_SERVICE** — 1024 미만 포트 바인딩에 필요.

</details>

### [Fundamentals] 문제 28.
Flannel CNI의 NetworkPolicy 지원은?

A) 완전 지원
B) 부분 지원
C) 미지원
D) L7 지원

<details><summary>정답</summary>

**C) 미지원** — Flannel은 기본 오버레이만. Cilium, Calico 사용.

</details>

### [Fundamentals] 문제 29.
RBAC에서 escalate verb의 위험성은?

A) Pod 삭제
B) Role 권한 상승 가능
C) Secret 읽기
D) NS 삭제

<details><summary>정답</summary>

**B) Role 권한 상승 가능** — 자기 자신의 권한을 높일 수 있다.

</details>

---

### [Threat] 문제 30.
MITRE ATT&CK에서 kubectl exec로 명령 실행은?

A) Initial Access
B) Execution
C) Persistence
D) Discovery

<details><summary>정답</summary>

**B) Execution** — 악성 코드/명령 실행 전술.

</details>

### [Threat] 문제 31.
SLSA Level 2에서 요구하는 것은?

A) 문서화
B) 서명된 출처 증명
C) 격리 빌드
D) 2인 검토

<details><summary>정답</summary>

**B) 서명된 출처 증명** — L1:문서화, L2:서명, L3:격리, L4:검토.

</details>

### [Threat] 문제 32.
hostPath 볼륨 마운트의 위험은?

A) 디스크 부족
B) 호스트 파일시스템 접근으로 컨테이너 탈출 가능
C) 네트워크 저하
D) 스케줄링 지연

<details><summary>정답</summary>

**B) 호스트 파일시스템 접근으로 컨테이너 탈출 가능** — /etc/shadow, docker.sock 등 접근.

</details>

### [Threat] 문제 33.
Falco가 탐지할 수 없는 것은?

A) 컨테이너 내 쉘 실행
B) 민감 파일 접근
C) 코드의 SQL Injection 취약점
D) 예상치 못한 네트워크 연결

<details><summary>정답</summary>

**C) SQL Injection 취약점** — Falco는 런타임 행위 모니터링. 코드 취약점은 SAST 도구.

</details>

### [Threat] 문제 34.
169.254.169.254 접근은 MITRE ATT&CK의 어떤 전술?

A) Execution
B) Credential Access
C) Impact
D) Persistence

<details><summary>정답</summary>

**B) Credential Access** — 클라우드 IAM 자격 증명 탈취.

</details>

### [Threat] 문제 35.
컨테이너 격리를 강화하는 기술이 아닌 것은?

A) gVisor
B) Kata Containers
C) Docker Compose
D) seccomp

<details><summary>정답</summary>

**C) Docker Compose** — 조합 도구이지 격리 기술이 아니다.

</details>

### [Threat] 문제 36.
privileged: true의 위험성은?

A) 메모리 증가
B) 호스트의 모든 디바이스 접근 가능, 컨테이너 탈출 용이
C) 네트워크 지연
D) 로그 증가

<details><summary>정답</summary>

**B) 호스트의 모든 디바이스 접근 가능, 컨테이너 탈출 용이**

</details>

### [Threat] 문제 37.
백도어 Pod를 배포하여 영구 접근을 유지하는 것은?

A) Execution
B) Persistence
C) Lateral Movement
D) Impact

<details><summary>정답</summary>

**B) Persistence** — 접근을 유지하기 위한 기술.

</details>

---

### [Platform] 문제 38.
Kubernetes에서 Ingress TLS 종료(termination)가 발생하는 위치는?

A) Pod
B) Ingress Controller
C) kube-proxy
D) kubelet

<details><summary>정답</summary>

**B) Ingress Controller** — Ingress에서 TLS를 종료하고 백엔드로 평문 전달 (또는 re-encrypt).

</details>

### [Platform] 문제 39.
OPA Gatekeeper의 ConstraintTemplate이 정의하는 것은?

A) RBAC 정책
B) Rego 기반 정책 로직 (매개변수화된 정책 템플릿)
C) NetworkPolicy 규칙
D) Pod 스케줄링 규칙

<details><summary>정답</summary>

**B) Rego 기반 정책 로직** — ConstraintTemplate은 정책 로직을, Constraint는 적용 대상과 매개변수를 정의한다.

</details>

### [Platform] 문제 40.
이미지 서명 검증에 사용되는 도구는?

A) Trivy
B) cosign (Sigstore)
C) kube-bench
D) Falco

<details><summary>정답</summary>

**B) cosign** — Sigstore 프로젝트의 이미지 서명/검증 도구. Trivy는 취약점 스캔.

</details>

### [Platform] 문제 41.
컨테이너 이미지에서 distroless 이미지를 사용하는 이유는?

A) 빌드 속도 향상
B) 공격 표면 최소화 (쉘, 패키지 관리자 없음)
C) 디버깅 용이
D) 이미지 캐싱 향상

<details><summary>정답</summary>

**B) 공격 표면 최소화** — 쉘, 패키지 관리자가 없어 공격자가 활용할 도구가 없다.

</details>

### [Platform] 문제 42.
Kubernetes에서 ServiceAccount 토큰을 자동 마운트하지 않으려면?

A) RBAC에서 권한 제거
B) automountServiceAccountToken: false 설정
C) ServiceAccount 삭제
D) NetworkPolicy 적용

<details><summary>정답</summary>

**B) automountServiceAccountToken: false** — Pod spec 또는 ServiceAccount에 설정.

</details>

### [Platform] 문제 43.
멀티 스테이지 Docker 빌드의 보안 이점은?

A) 빌드 속도 향상
B) 빌드 도구와 소스 코드가 최종 이미지에 포함되지 않음
C) 캐시 효율 증가
D) 레이어 수 감소

<details><summary>정답</summary>

**B) 빌드 도구와 소스 코드 미포함** — 최종 이미지에는 실행 바이너리만 포함되어 공격 표면 감소.

</details>

### [Platform] 문제 44.
RuntimeClass의 용도는?

A) Pod 우선순위 설정
B) 컨테이너 런타임 선택 (gVisor, Kata 등)
C) 리소스 제한
D) 네트워크 정책

<details><summary>정답</summary>

**B) 컨테이너 런타임 선택** — Pod에 RuntimeClass를 지정하여 gVisor, Kata 등 격리 런타임 사용.

</details>

### [Platform] 문제 45.
이미지 태그 `:latest`의 보안 문제는?

A) 이미지 크기 증가
B) 동일 태그에 다른 이미지가 배포될 수 있어 무결성 보장 불가
C) 레지스트리 부하
D) 네트워크 지연

<details><summary>정답</summary>

**B) 무결성 보장 불가** — 다이제스트(@sha256:...)를 사용해야 이미지 무결성 보장.

</details>

---

### [Compliance] 문제 46.
CIS Benchmark 점검 자동화 도구는?

A) Falco
B) kube-bench
C) Trivy
D) cosign

<details><summary>정답</summary>

**B) kube-bench** — Aqua Security가 개발한 CIS Benchmark 자동 점검 도구.

</details>

### [Compliance] 문제 47.
NIST CSF에서 Falco와 Audit Log가 해당하는 기능은?

A) Identify
B) Protect
C) Detect
D) Respond

<details><summary>정답</summary>

**C) Detect** — 보안 이벤트를 발견하는 탐지 기능.

</details>

### [Compliance] 문제 48.
SOC 2 Type II가 Type I보다 높은 신뢰도를 갖는 이유는?

A) 더 많은 항목을 점검하므로
B) 6~12개월 운영 기간의 통제 효과를 검증하므로
C) 외부 감사인이 더 많으므로
D) 자동화 도구를 사용하므로

<details><summary>정답</summary>

**B) 6~12개월 운영 기간 검증** — Type I은 시점, Type II는 기간 동안의 운영 효과성 평가.

</details>

### [Compliance] 문제 49.
Audit Policy에서 Secret 리소스에 권장되는 레벨은?

A) None
B) Metadata
C) Request
D) RequestResponse

<details><summary>정답</summary>

**B) Metadata** — Secret 본문에 비밀번호가 포함되므로 본문을 로깅하면 안 된다.

</details>

### [Compliance] 문제 50.
PCI DSS에서 "네트워크/데이터 접근 모니터링"에 해당하는 K8s 구현은?

A) RBAC
B) NetworkPolicy
C) Audit Log + Falco
D) PSA

<details><summary>정답</summary>

**C) Audit Log + Falco** — PCI DSS 요구사항 10번: 접근 모니터링 및 추적.

</details>

---

## 2. 채점 및 약점 분석

```
=== 종합 모의시험 채점표 ===

| 도메인 | 문항 번호 | 시험 비중 | 정답 수 / 전체 | 목표 | 복습 Day |
|--------|-----------|----------|---------------|------|---------|
| Overview (14%) | 1-7 | 7문제 | __/7 | 5+ | Day 1 |
| Cluster (22%) | 8-18 | 11문제 | __/11 | 7+ | Day 2-3 |
| Fundamentals (22%) | 19-29 | 11문제 | __/11 | 7+ | Day 4-5 |
| Threat (16%) | 30-37 | 8문제 | __/8 | 5+ | Day 6-7 |
| Platform (16%) | 38-45 | 8문제 | __/8 | 5+ | Day 7-8 |
| Compliance (10%) | 46-50 | 5문제 | __/5 | 3+ | Day 9 |
| **합계** | **1-50** | **100%** | **__/50** | **34+** | |

합격 기준: 34/50 (67%) 이상
```

---

## 3. 전 범위 핵심 암기 항목 총정리

### 3.1 Overview (Day 1)

```
- 4C 모델: Cloud > Cluster > Container > Code
- STRIDE: Spoofing/Tampering/Repudiation/Info Disclosure/DoS/Elevation
- Zero Trust: "Never trust, always verify" → default-deny
- Defense in Depth: 다층 보안 (하나 뚫려도 다음 방어)
- Shift Left: 개발 초기에 보안 통합 (CI/CD에 스캐닝)
- SBOM: SPDX(Linux Foundation), CycloneDX(OWASP)
- 공유 책임: 클라우드=인프라, 사용자=설정/워크로드
```

### 3.2 Cluster Security (Day 2-3)

```
- API 요청 흐름: 인증 → 인가 → Admission → etcd
- authorization-mode: Node,RBAC (권장)
- Admission: Mutating → Validating 순서
- etcd 보안: mTLS, Encryption at Rest, kms v2 권장
- kubelet: --read-only-port=0, anonymous-auth=false
- 인증서: 클라이언트 1년, CA 10년
- NodeRestriction: kubelet이 자기 노드/Pod만 수정
- Static Pod: Admission Control 미적용 가능
```

### 3.3 Kubernetes Security Fundamentals (Day 4-5)

```
- RBAC: Role/ClusterRole + RoleBinding/ClusterRoleBinding
- ClusterRole + RoleBinding = 네임스페이스 범위로 제한
- 위험 verb: escalate, bind, impersonate
- PSS 3레벨: Privileged > Baseline > Restricted
- Restricted 필수: runAsNonRoot, drop ALL, no privilege escalation
- readOnlyRootFilesystem: Restricted 필수 아님! (모범 사례)
- NetworkPolicy: 빈 셀렉터 = 모든 것 선택
- 같은 from = AND, 별도 from = OR
- Secret: Base64 인코딩 (암호화 아님!)
- Volume 마운트 > 환경 변수 (보안)
- Bound SA Token: 만료 시간, audience 제한, Pod 삭제 시 무효
- Flannel: NetworkPolicy 미지원
```

### 3.4 Kubernetes Threat Model (Day 6-7)

```
- MITRE ATT&CK: Initial Access → Execution → Persistence → ...
  - kubectl exec = Execution
  - 백도어 Pod = Persistence
  - 169.254.169.254 = Credential Access
- SLSA: L1(문서화) L2(서명) L3(격리) L4(검토)
- Falco: 런타임 행위 탐지 (syscall 기반)
  - 코드 취약점(SAST)은 탐지 불가
- 컨테이너 탈출: privileged, hostPath, hostPID/hostNetwork
- 격리 강화: gVisor, Kata Containers, seccomp
```

### 3.5 Platform Security (Day 7-8)

```
- Ingress TLS 종료: Ingress Controller에서 수행
- OPA Gatekeeper: ConstraintTemplate(로직) + Constraint(적용)
- 이미지 서명: cosign (Sigstore)
- 이미지 스캐닝: Trivy
- distroless: 공격 표면 최소화
- :latest 금지: @sha256 다이제스트 사용
- 멀티 스테이지 빌드: 빌드 도구 미포함
- RuntimeClass: gVisor/Kata 등 런타임 선택
```

### 3.6 Compliance (Day 9)

```
- CIS Benchmark: kube-bench → PASS/FAIL/WARN/INFO
- NIST CSF: Identify/Protect/Detect/Respond/Recover
  - Falco + Audit = Detect
- SOC 2: Type I(시점) / Type II(기간, 더 높은 신뢰도)
- PCI DSS: 카드 데이터 보안 12가지 요구사항
- GDPR: EU 개인정보 보호
- Audit 4레벨: None < Metadata < Request < RequestResponse
  - Secret → Metadata / Pod exec → RequestResponse
```

---

## 4. 시험 당일 전략

### 4.1 시간 관리

```
총 50문제 / 75분 = 문제당 1.5분

전략:
1. 1회차 (50분): 전체 문제를 순서대로 풀기
   - 확신 있는 문제: 즉시 답 선택 (30초)
   - 애매한 문제: 표시(flag)하고 최선의 답 선택 후 넘기기 (1분)
   - 모르는 문제: 표시하고 소거법으로 답 선택 후 넘기기 (1분)

2. 2회차 (20분): 표시한 문제 재검토
   - 키워드 다시 확인
   - 소거법 재적용

3. 마지막 5분: 전체 검토
   - 빈 답 없는지 확인 (무응답 = 0점)
   - 직감 변경 자제 (첫 답이 맞을 확률 높음)
```

### 4.2 키워드-정답 매핑 (빈출)

```
키워드 → 정답:
- "부인 방지" / "누가 했는지" → Audit Logging / Repudiation
- "Never trust" → Zero Trust
- "기본 거부" → default-deny NetworkPolicy
- "kube-bench" → CIS Benchmark
- "Falco" → 런타임 탐지 / NIST Detect
- "cosign" → 이미지 서명 (Sigstore)
- "Trivy" → 이미지 취약점 스캐닝
- "kms v2" → Encryption at Rest 권장
- "Metadata 레벨" → Secret audit
- "RequestResponse" → Pod exec/attach audit
- "Mutating → Validating" → Admission 순서
- "Node,RBAC" → authorization-mode 권장
- "Base64" → Secret 기본 (암호화 아님!)
- "readOnlyRootFilesystem" → Restricted 필수 아님
- "NET_BIND_SERVICE" → Restricted에서 유일한 추가 capability
- "Type II" → SOC 2 장기 운영 검증
```

### 4.3 흔한 함정

```
1. readOnlyRootFilesystem은 PSS Restricted 필수가 아니다
   → 모범 사례이지만 필수 요구사항은 아님

2. Secret은 Base64 인코딩이지 암호화가 아니다
   → Encryption at Rest를 별도 설정해야 함

3. Flannel은 NetworkPolicy를 지원하지 않는다
   → Cilium, Calico를 사용해야 함

4. Falco는 코드 취약점을 탐지하지 못한다
   → SAST/DAST 도구가 필요함

5. ClusterRole + RoleBinding = 네임스페이스 범위
   → 클러스터 전체가 아님!

6. Audit 레벨 순서: None < Metadata < Request < RequestResponse
   → Request와 RequestResponse 혼동 주의

7. SLSA 레벨: L1(문서화) L2(서명) L3(격리) L4(검토)
   → 레벨별 요구사항 순서 혼동 주의
```

---

## 5. 복습 체크리스트

- [ ] 모의시험 50문제를 34문제 이상 맞출 수 있다
- [ ] 약점 도메인을 파악하고 해당 Day를 복습했다
- [ ] 키워드-정답 매핑을 빠르게 떠올릴 수 있다
- [ ] 흔한 함정 7가지를 모두 기억한다
- [ ] 시간 관리 전략을 숙지했다
- [ ] 전 범위 핵심 암기 항목을 한 번 더 훑어봤다

---

## tart-infra 실습

### 실습 환경 설정

```bash
alias kp='export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/platform.yaml'
alias kd='export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/dev.yaml'
```

### 실습 1: 모의시험 자가 채점

```bash
echo "=== 종합 모의시험 채점표 ==="
echo ""
echo "| 도메인 | 문항 번호 | 정답 수 / 전체 | 목표 |"
echo "|--------|-----------|---------------|------|"
echo "| Overview (14%) | 1-7 | __/7 | 5+ |"
echo "| Cluster (22%) | 8-18 | __/11 | 7+ |"
echo "| Fundamentals (22%) | 19-29 | __/11 | 7+ |"
echo "| Threat (16%) | 30-37 | __/8 | 5+ |"
echo "| Platform (16%) | 38-45 | __/8 | 5+ |"
echo "| Compliance (10%) | 46-50 | __/5 | 3+ |"
echo ""
echo "약점 도메인을 파악하고 해당 Day를 복습하세요."
```

### 실습 2: 전 범위 보안 점검 종합

```bash
kd  # dev 클러스터

echo "=== KCSA 전 범위 보안 점검 ==="
echo ""

# 1. Cluster Security
echo "[Cluster] Authorization Mode:"
kubectl get pod kube-apiserver-dev-master -n kube-system -o yaml 2>/dev/null | grep authorization-mode || echo "  확인 불가"

# 2. RBAC
echo "[Fundamentals] ClusterRoleBindings with cluster-admin:"
kubectl get clusterrolebindings -o json 2>/dev/null | grep -c '"cluster-admin"' || echo "  0"

# 3. NetworkPolicy
echo "[Fundamentals] NetworkPolicies:"
kubectl get networkpolicies --all-namespaces --no-headers 2>/dev/null | wc -l

# 4. Pod Security
echo "[Fundamentals] PSA labels on namespaces:"
kubectl get ns --show-labels 2>/dev/null | grep -c "pod-security" || echo "  0"

# 5. Secret Encryption
echo "[Cluster] Encryption at Rest:"
kubectl get pod kube-apiserver-dev-master -n kube-system -o yaml 2>/dev/null | grep encryption-provider || echo "  미설정"

# 6. Audit Logging
echo "[Compliance] Audit Policy:"
kubectl get pod kube-apiserver-dev-master -n kube-system -o yaml 2>/dev/null | grep audit-policy || echo "  미설정"

echo ""
echo "=== 점검 완료 ==="
```

**검증 — 기대 출력:**
```text
=== KCSA 전 범위 보안 점검 ===

[Cluster] Authorization Mode:
    - --authorization-mode=Node,RBAC
[Fundamentals] ClusterRoleBindings with cluster-admin:
  2
[Fundamentals] NetworkPolicies:
       5
[Fundamentals] PSA labels on namespaces:
  0
[Cluster] Encryption at Rest:
  미설정
[Compliance] Audit Policy:
  미설정

=== 점검 완료 ===
```

**동작 원리:** KCSA 시험의 전 도메인을 실제 클러스터에서 점검:
1. **Cluster**: API Server 인가 모드 확인
2. **Fundamentals**: RBAC, NetworkPolicy, PSA 확인
3. **Compliance**: Encryption at Rest, Audit Logging 확인

### 트러블슈팅: 시험 전 종합 점검

```
자가 진단 체크리스트:
1. cluster-admin 바인딩이 2개 이상이면 과도한 권한 부여 상태다
   → 필요 없는 바인딩을 제거한다
2. PSA 레이블이 0이면 Pod Security가 미적용된 상태다
   → 최소한 audit+warn 모드로 시작한다
3. Encryption at Rest가 미설정이면 Secret이 etcd에 평문 저장된다
   → EncryptionConfiguration을 생성한다
4. Audit Policy가 미설정이면 모든 API 요청이 추적 불가능하다
   → Audit Policy를 생성하고 API Server에 연결한다

시험 대비 핵심:
- 문제에서 "가장 안전한" → 가장 제한적인 옵션을 선택한다
- "~가 아닌 것은?" → 소거법을 적용한다. 확실한 정답 3개를 제거한다
- "기본값은?" → Kubernetes의 기본값은 대부분 보안에 불리하다
  (anonymous-auth=true, readOnlyPort=10255, authorization-mode=AlwaysAllow)
```
