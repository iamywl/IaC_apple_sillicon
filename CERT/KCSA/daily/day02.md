# KCSA Day 2: 공급망 보안, 시험 패턴, 연습 문제

> **시험 비중:** Overview of Cloud Native Security — 14%
> **목표:** 공급망 보안(SBOM, Cosign, SLSA)을 이해하고, 시험 출제 패턴을 분석하며, 연습 문제로 Day 1~2 범위를 점검한다.

---

## 1. 공급망 보안 (Supply Chain Security) 기초

### 1.1 공급망 공격이란?

```
공급망 공격의 실제 사례 흐름:

[시나리오 1: 악성 베이스 이미지]
공격자 → 인기 베이스 이미지에 백도어 삽입
       → 개발자가 해당 이미지로 빌드
       → 프로덕션에 배포
       → 백도어 활성화 → 데이터 탈취

[시나리오 2: 의존성 혼란 (Dependency Confusion)]
공격자 → 내부 패키지와 같은 이름의 악성 패키지를 공개 레지스트리에 업로드
       → 빌드 시스템이 공개 레지스트리에서 악성 버전을 다운로드
       → 악성 코드가 빌드에 포함

[시나리오 3: CI/CD 파이프라인 침해]
공격자 → CI/CD 시스템 (Jenkins, GitHub Actions) 침해
       → 빌드 스크립트에 악성 코드 주입
       → 정상적인 빌드 결과물에 백도어 포함
       → 정상적인 서명/배포 과정을 통해 프로덕션에 배포

방어 체계:
┌─────────────┐   ┌─────────┐   ┌──────────┐   ┌───────────┐
│ SBOM 생성    │ → │ 스캔     │ → │ 서명      │ → │ 검증/배포  │
│ (Syft)      │   │ (Trivy) │   │ (Cosign)  │   │ (Kyverno) │
└─────────────┘   └─────────┘   └──────────┘   └───────────┘
```

### 1.2 SBOM (Software Bill of Materials)

```
SBOM = 소프트웨어 재료 목록

이미지에 포함된 모든 패키지/라이브러리의 목록이다.
CVE(취약점)가 발표되면 SBOM을 검색하여 영향받는 서비스를 즉시 파악할 수 있다.

SBOM 형식 비교:
- SPDX: Linux Foundation, ISO 국제 표준
- CycloneDX: OWASP, 보안 중심, 취약점 정보 포함 가능

생성 도구:
- Syft: Anchore, 대표적 SBOM 생성 도구
- Trivy: Aqua Security, SBOM 생성 기능 내장

# SBOM 생성 예시
syft myapp:v1.0 -o spdx-json > sbom.json
trivy image --format spdx myapp:v1.0
```

### 1.3 이미지 서명 (Cosign)

```bash
# Cosign 이미지 서명 흐름

# 1. 키 쌍 생성
cosign generate-key-pair
# → cosign.key (개인 키) + cosign.pub (공개 키)

# 2. 이미지 서명
cosign sign --key cosign.key myregistry.io/myapp:v1.0
# 서명이 OCI 레지스트리에 별도 아티팩트로 저장됨

# 3. 서명 검증
cosign verify --key cosign.pub myregistry.io/myapp:v1.0
# Verified OK → 서명 유효
# Error → 서명 없거나 변조됨

# 키리스(Keyless) 서명:
# 별도 키 관리 없이 OIDC 계정으로 서명
cosign sign --identity-token=<oidc-token> myregistry.io/myapp:v1.0
# Fulcio: 단기 인증서 발급
# Rekor: 투명성 로그에 기록 (변조 불가)
```

### 1.4 SLSA (Supply Chain Levels for Software Artifacts)

```
SLSA (Supply Chain Levels for Software Artifacts)
발음: "살사"

Level 0: 보안 없음
  → 누가, 어떻게 빌드했는지 기록 없음

Level 1: 빌드 프로세스 문서화
  → 빌드 스크립트가 버전 관리됨
  → Provenance(출처 증명)가 존재하지만 서명되지 않음

Level 2: 서명된 출처 증명
  → 빌드 서비스가 Provenance에 서명
  → 빌드가 자동화된 서비스에서 수행됨

Level 3: 격리된 빌드 환경
  → 빌드 환경이 다른 작업과 격리
  → 빌드 중 외부 개입 불가능 (Hermetic Build)

Level 4: 모든 의존성에 대한 2인 검토
  → 모든 변경에 2명 이상의 리뷰
  → 전체 의존성 트리에 대한 재귀적 Provenance 검증

시험 출제 형태:
"SLSA Level 3에서 요구하는 것은?"
→ 격리된 빌드 환경
```

### 1.5 이미지 스캐닝 도구 비교

```
이미지 스캐닝 도구 비교표:

┌──────────┬──────────────────────────────────────┐
│   Trivy  │ Aqua Security. 가장 널리 사용          │
│          │ 이미지, 파일시스템, Git 리포, K8s 스캔   │
│          │ CVE, 설정 오류, 시크릿 탐지              │
│          │ SBOM 생성 기능 내장                     │
├──────────┼──────────────────────────────────────┤
│   Grype  │ Anchore. 빠른 취약점 스캐너             │
│          │ SBOM 기반 스캔 (Syft와 연동)            │
├──────────┼──────────────────────────────────────┤
│   Clair  │ CoreOS/Red Hat. 정적 분석              │
│          │ 레이어 기반 분석                        │
├──────────┼──────────────────────────────────────┤
│   Snyk   │ 상용. 코드 + 이미지 + IaC 스캔          │
│          │ 수정 제안 기능                          │
└──────────┴──────────────────────────────────────┘

핵심 기억사항:
이미지 스캐너 = 정적 분석 (빌드 시점)
Falco = 동적 분석 (런타임)
둘은 상호 보완적!
```

---

## 2. KCSA 시험 출제 패턴 분석

### 2.1 Day 1~2 범위 출제 패턴

```
패턴 1: "~는 STRIDE의 어떤 위협에 해당하는가?"
  예: "감사 로그 없이 Secret 삭제를 부인하는 것은?"
  → Repudiation (부인)

패턴 2: "~의 주요 기능은?" (개념 이해)
  예: "SBOM의 목적은?"
  → 소프트웨어 구성 요소 목록을 관리하여 취약점 추적

패턴 3: "~가 아닌 것은?" (소거법)
  예: "SBOM의 주요 형식이 아닌 것은?"
  → YAML (SPDX, CycloneDX만 정답)

패턴 4: "~에서 적합한 도구는?" (도구 매핑)
  예: "런타임 보안 모니터링에 적합한 도구는?"
  → Falco (정적 분석: Trivy)

패턴 5: "Shift Left에서 ~하는 보안 활동이 아닌 것은?"
  예: "CI/CD에 통합하는 보안 활동이 아닌 것은?"
  → 물리적 보안 점검

패턴 6: "CNCF Security TAG의 역할이 아닌 것은?"
  → Kubernetes 릴리스 관리 (SIG Release의 역할)

패턴 7: "공유 책임 모델에서 클라우드 제공자의 책임은?"
  → 데이터센터 물리적 보안
```

---

## 3. 연습 문제 (17문제 + 상세 해설)

### 문제 1.
4C 보안 모델에서 가장 바깥쪽 계층은?

A) Code
B) Container
C) Cluster
D) Cloud

<details><summary>정답 확인</summary>

**정답: D) Cloud**

**왜 정답인가:** 4C 모델은 바깥에서 안쪽으로 Cloud → Cluster → Container → Code 순서이다. Cloud가 가장 바깥쪽(인프라) 계층이며, Code가 가장 안쪽(애플리케이션) 계층이다.

</details>

### 문제 2.
STRIDE 위협 모델에서 SA 토큰을 탈취하여 다른 사용자로 API에 접근하는 것은?

A) Tampering
B) Spoofing
C) Information Disclosure
D) Elevation of Privilege

<details><summary>정답 확인</summary>

**정답: B) Spoofing**

**왜 정답인가:** Spoofing(위장)은 타인의 자격 증명을 도용하여 시스템에 접근하는 것이다. SA 토큰 탈취 후 다른 사용자/서비스로 위장하여 API에 접근하는 것은 Spoofing에 해당한다.

**왜 오답인가:**
- A) Tampering은 데이터 변조
- C) Information Disclosure는 정보 노출
- D) Elevation of Privilege는 자신의 권한을 상승시키는 것

</details>

### 문제 3.
Zero Trust 보안 모델의 핵심 원칙을 가장 잘 설명한 것은?

A) 내부 네트워크는 신뢰한다
B) Never trust, always verify
C) 방화벽만 설정하면 안전하다
D) VPN으로 모든 통신을 보호한다

<details><summary>정답 확인</summary>

**정답: B) Never trust, always verify**

**왜 정답인가:** Zero Trust는 네트워크 위치(내부/외부)에 관계없이 모든 접근 요청에 대해 인증/인가를 수행한다. 암묵적 신뢰를 제거하고 명시적 검증을 요구하는 것이 핵심이다.

</details>

### 문제 4.
Defense in Depth(심층 방어)의 핵심 개념은?

A) 하나의 강력한 보안 솔루션에 의존
B) 여러 계층에 독립적인 보안 통제를 배치하여 단일 장애점을 제거
C) 가장 바깥 방화벽만 강화
D) 공격 발생 후 빠르게 복구

<details><summary>정답 확인</summary>

**정답: B) 여러 계층에 독립적인 보안 통제를 배치하여 단일 장애점을 제거**

**왜 정답인가:** 심층 방어는 4C 모델처럼 각 계층(Cloud/Cluster/Container/Code)에 독립적인 보안 통제를 배치하여, 하나의 계층이 침해되더라도 다른 계층이 추가 방어선을 형성하는 원칙이다.

</details>

### 문제 5.
SBOM의 주요 형식이 아닌 것은?

A) SPDX
B) CycloneDX
C) YAML
D) 둘 다 아님

<details><summary>정답 확인</summary>

**정답: C) YAML**

**왜 정답인가:** SBOM 형식은 SPDX(Linux Foundation, ISO 표준)와 CycloneDX(OWASP)이다. YAML은 일반 설정 파일 형식이지 SBOM 형식이 아니다.

</details>

### 문제 6.
Cosign으로 이미지를 서명하는 주요 목적은?

A) 이미지 크기 줄이기
B) 이미지의 출처와 무결성을 검증
C) 이미지 다운로드 속도 향상
D) 이미지 포맷 변환

<details><summary>정답 확인</summary>

**정답: B) 이미지의 출처와 무결성을 검증**

**왜 정답인가:** Cosign은 이미지에 디지털 서명을 추가하여 (1) 누가 이미지를 빌드/배포했는지(출처), (2) 이미지가 변조되지 않았는지(무결성)를 검증할 수 있게 한다. Admission Webhook과 연동하여 미서명 이미지 배포를 차단할 수 있다.

</details>

### 문제 7.
SLSA Level 2에서 요구하는 것은?

A) 빌드 프로세스 문서화
B) 서명된 출처 증명 (Signed Provenance)
C) 격리된 빌드 환경
D) 모든 의존성에 대한 2인 검토

<details><summary>정답 확인</summary>

**정답: B) 서명된 출처 증명**

**왜 정답인가:** SLSA Level 1은 문서화, Level 2는 서명된 출처 증명, Level 3은 격리된 빌드 환경, Level 4는 2인 검토이다.

</details>

### 문제 8.
Shift Left에서 CI/CD에 통합하는 보안 활동이 아닌 것은?

A) 이미지 취약점 스캐닝
B) SAST (정적 코드 분석)
C) 프로덕션 서버 물리적 보안 점검
D) 의존성 취약점 분석

<details><summary>정답 확인</summary>

**정답: C) 프로덕션 서버 물리적 보안 점검**

**왜 정답인가:** 물리적 보안 점검은 클라우드 제공자의 책임이며 CI/CD 파이프라인에 통합할 수 없는 활동이다. Shift Left는 보안 검사를 개발 초기 단계로 앞당기는 것으로, SAST, SCA, 이미지 스캔, 시크릿 스캔 등이 해당된다.

</details>

### 문제 9.
CNCF Security TAG의 역할이 아닌 것은?

A) 보안 백서 발행
B) 프로젝트 보안 감사
C) Kubernetes 릴리스 관리
D) 공급망 보안 가이드

<details><summary>정답 확인</summary>

**정답: C) Kubernetes 릴리스 관리**

**왜 정답인가:** K8s 릴리스 관리는 SIG Release의 역할이다. CNCF Security TAG는 보안 백서 발행, 프로젝트 보안 평가, 공급망 보안 가이드 등 보안 자문 역할을 수행한다.

</details>

### 문제 10.
공유 책임 모델에서 클라우드 제공자의 책임은?

A) RBAC 설정
B) NetworkPolicy 설정
C) 데이터센터 물리적 보안
D) 이미지 스캐닝

<details><summary>정답 확인</summary>

**정답: C) 데이터센터 물리적 보안**

**왜 정답인가:** 물리적 인프라(데이터센터, 하드웨어, 네트워크 인프라, 하이퍼바이저)의 보안은 클라우드 제공자의 책임이다. RBAC, NetworkPolicy, 이미지 스캐닝 등 클라우드 위에서 실행되는 것의 보안은 고객 책임이다.

</details>

### 문제 11.
STRIDE에서 리소스 고갈로 서비스를 방해하는 것은?

A) Spoofing
B) Tampering
C) Denial of Service
D) Elevation of Privilege

<details><summary>정답 확인</summary>

**정답: C) Denial of Service**

**왜 정답인가:** DoS는 시스템의 가용성(Availability)을 침해하여 정상 사용자의 서비스 접근을 방해하는 공격이다. K8s에서는 ResourceQuota, LimitRange로 대응한다.

</details>

### 문제 12.
4C 모델에서 RBAC, NetworkPolicy, Admission Control이 속하는 계층은?

A) Cloud
B) Cluster
C) Container
D) Code

<details><summary>정답 확인</summary>

**정답: B) Cluster**

**왜 정답인가:** RBAC, NetworkPolicy, Admission Control은 Kubernetes 컨트롤 플레인 수준의 보안 통제로, Cluster 계층에 속한다. Cloud는 IAM/방화벽, Container는 SecurityContext/seccomp, Code는 TLS/Secret 관리이다.

</details>

### 문제 13.
다음 중 CNCF Graduated 보안 프로젝트가 아닌 것은?

A) Falco
B) OPA
C) Kyverno
D) TUF

<details><summary>정답 확인</summary>

**정답: C) Kyverno**

**왜 정답인가:** Kyverno는 CNCF Incubating 프로젝트이다. Falco, OPA, TUF는 모두 CNCF Graduated 프로젝트이다.

</details>

### 문제 14.
Zero Trust의 5가지 원칙이 아닌 것은?

A) 신원 확인
B) 경계 보안만으로 충분
C) 마이크로 세그멘테이션
D) 지속적 검증

<details><summary>정답 확인</summary>

**정답: B) 경계 보안만으로 충분**

**왜 정답인가:** Zero Trust는 경계 보안(Perimeter Security)을 부정한다. 5원칙은 신원 확인, 최소 권한, 마이크로 세그멘테이션, 암호화, 지속적 검증이다.

</details>

### 문제 15.
DevSecOps에서 SAST와 DAST의 차이는?

A) 둘 다 동적 분석이다
B) SAST는 정적 코드 분석, DAST는 실행 중 동적 분석
C) SAST는 런타임, DAST는 빌드 시점
D) 차이 없다

<details><summary>정답 확인</summary>

**정답: B) SAST는 정적 코드 분석, DAST는 실행 중 동적 분석**

**왜 정답인가:** SAST(Static Application Security Testing)는 소스 코드를 분석하여 취약점을 탐지하고(SonarQube, Semgrep), DAST(Dynamic Application Security Testing)는 실행 중인 애플리케이션에 대해 공격을 시뮬레이션한다(OWASP ZAP).

</details>

### 문제 16.
이미지 다이제스트(sha256)를 사용하는 이유는?

A) 이미지 다운로드 속도 향상
B) 이미지의 무결성을 보장하여 태그 변조 공격 방지
C) 이미지 크기 줄이기
D) 이미지 포맷 변환

<details><summary>정답 확인</summary>

**정답: B) 이미지의 무결성을 보장하여 태그 변조 공격 방지**

**왜 정답인가:** 태그(예: v1.0)는 mutable하여 동일 태그에 다른 이미지가 매핑될 수 있다. SHA256 다이제스트는 이미지 내용의 해시값으로, 이미지가 변조되면 해시가 변경되어 탐지 가능하다.

</details>

### 문제 17.
STRIDE에서 etcd 데이터를 직접 수정하여 RBAC 정책을 변경하는 것은?

A) Spoofing
B) Tampering
C) Repudiation
D) Denial of Service

<details><summary>정답 확인</summary>

**정답: B) Tampering**

**왜 정답인가:** Tampering(변조)은 데이터의 무결성을 침해하여 시스템 상태나 구성을 비인가로 수정하는 공격이다. etcd 데이터 직접 수정, 이미지 변조, ConfigMap/Secret 무단 수정이 해당한다. TLS + Encryption at Rest + 서명으로 대응한다.

</details>

---

## 4. 보안 용어 사전 및 약어 정리

```
주요 보안 약어:

4C         : Cloud, Cluster, Container, Code (보안 계층)
STRIDE     : Spoofing, Tampering, Repudiation, Info Disclosure, DoS, Elevation
ZTA        : Zero Trust Architecture
RBAC       : Role-Based Access Control
PSS/PSA    : Pod Security Standards / Pod Security Admission
NP         : NetworkPolicy
SA         : ServiceAccount
mTLS       : Mutual TLS (상호 인증)
SBOM       : Software Bill of Materials (소프트웨어 재료 목록)
SLSA       : Supply Chain Levels for Software Artifacts
SAST/DAST  : Static/Dynamic Application Security Testing
SCA        : Software Composition Analysis
CVE        : Common Vulnerabilities and Exposures
MAC        : Mandatory Access Control
DAC        : Discretionary Access Control
OIDC       : OpenID Connect
PKI        : Public Key Infrastructure
CA         : Certificate Authority
CSR        : Certificate Signing Request
KMS        : Key Management Service
DEK/KEK    : Data Encryption Key / Key Encryption Key
CIS        : Center for Internet Security
NIST CSF   : National Institute of Standards Cybersecurity Framework
SOC 2      : Service Organization Control Type 2
PCI DSS    : Payment Card Industry Data Security Standard
CNCF       : Cloud Native Computing Foundation
TAG        : Technical Advisory Group
```

---

## 5. CNCF 보안 프로젝트 상태 요약

```
CNCF 보안 관련 프로젝트 상태:

Graduated (졸업):
  ✓ Falco      — 런타임 보안 모니터링 (eBPF, 시스템 콜)
  ✓ OPA        — 범용 정책 엔진 (Rego 언어)
  ✓ TUF        — 업데이트 프레임워크 (안전한 소프트웨어 배포)

Incubating (인큐베이팅):
  ○ SPIFFE/SPIRE — 서비스 아이덴티티 (워크로드 인증)
  ○ Notary     — 아티팩트 서명 (이미지 무결성)
  ○ cert-manager — 인증서 자동 관리 (Let's Encrypt, X.509)
  ○ Kyverno    — K8s 네이티브 정책 엔진 (YAML 기반)

시험 팁: "Falco의 CNCF 상태는?" → Graduated
         "Kyverno의 CNCF 상태는?" → Incubating
```

---

## 6. 핵심 개념 정리 (시험 직전 리뷰용)

### 6.1 공급망 보안 요약

```
공급망 보안 핵심 도구:
  SBOM: 소프트웨어 재료 목록 (SPDX, CycloneDX)
  Cosign: 이미지 서명/검증 (Sigstore, Keyless)
  Trivy: 이미지 취약점 스캔 (CVE)
  SLSA: 공급망 보안 성숙도 (L1~L4)

Shift Left:
  보안 검사를 개발 초기로 앞당김
  CI/CD: 시크릿 스캔 → SAST → SCA → 이미지 스캔 → 서명 → 배포
```

### 6.2 Day 1~2 키워드 매핑

```
문제에 이 키워드가 보이면 → 이 답을 선택:

"4C 모델 바깥 계층" → Cloud
"Never trust" → Zero Trust
"행위 부인" → Repudiation (STRIDE)
"심층 방어" → Defense in Depth
"재료 목록" → SBOM
"이미지 서명" → Cosign
"L1→L2→L3→L4" → SLSA
"런타임 보안" → Falco
"정적 분석, 이미지 스캔" → Trivy
"릴리스 관리" → SIG Release (Security TAG 아님!)
"물리적 보안" → 클라우드 제공자 책임
```

---

## 7. 복습 체크리스트

- [ ] SBOM의 두 가지 형식(SPDX, CycloneDX)을 알고 있다
- [ ] Cosign의 서명/검증 흐름을 설명할 수 있다
- [ ] SLSA 4개 레벨을 순서대로 기억한다 (문서화→서명→격리→검토)
- [ ] Trivy(정적)와 Falco(동적)의 차이를 설명할 수 있다
- [ ] SAST와 DAST의 차이를 알고 있다
- [ ] 이미지 다이제스트를 사용하는 이유를 설명할 수 있다
- [ ] CNCF Security TAG의 역할(릴리스 관리가 아님!)을 알고 있다
- [ ] 공유 책임 모델에서 고객/클라우드 제공자의 책임을 구분할 수 있다
- [ ] Day 1~2 연습 문제 17문제를 모두 풀 수 있다

---

## 내일 예고: Day 3 - API Server, etcd, kubelet 보안

- API Server 3단계 요청 처리 (인증 → 인가 → Admission)
- 6가지 인증 방법 비교
- etcd 보안 설정 (TLS, Encryption at Rest)
- kubelet 보안 (10250 vs 10255 포트)
- Control Plane TLS 통신 전체 지도

---

## tart-infra 실습

### 실습 환경 설정

```bash
# dev 클러스터에 접속 (Zero Trust + mTLS가 적용된 보안 환경)
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/dev.yaml
kubectl get nodes
```

### 실습 1: 공급망 보안 점검 — 이미지 분석

```bash
# 사용 중인 이미지 목록 추출
kubectl get pods -n demo -o jsonpath='{range .items[*]}{range .spec.containers[*]}{.image}{"\n"}{end}{end}' | sort -u

# 보안 점검 포인트:
# 1. :latest 태그 사용 여부 확인
# 2. @sha256 다이제스트 사용 여부 확인
# 3. 공개 레지스트리(docker.io) vs 프라이빗 레지스트리
```

**동작 원리:** 공급망 보안 점검 포인트:
1. `:latest` 태그 사용 — 버전이 고정되지 않아 위험
2. 다이제스트(`@sha256:...`) 미사용 — 이미지 변조 감지 불가
3. 공개 레지스트리(docker.io) 사용 — 프라이빗 레지스트리(Harbor) 권장
4. Trivy로 취약점 스캔: `trivy image nginx:1.25 --severity CRITICAL,HIGH`
5. SBOM 생성: `trivy image --format spdx nginx:1.25`

### 실습 2: STRIDE 위협 모델 적용

```bash
# [Spoofing] 인증 확인 — 누가 접근할 수 있는가?
kubectl auth can-i --list | head -10

# [Tampering] 변조 방지 — etcd 데이터 암호화 여부
kubectl get pod kube-apiserver-dev-master -n kube-system -o yaml | grep encryption-provider || echo "Encryption at Rest 미설정"

# [Information Disclosure] 정보 노출 — Secret이 평문으로 조회 가능한지
kubectl get secret -n demo -o jsonpath='{.items[0].metadata.name}' && echo " (Base64 인코딩만 됨, 암호화 아님)"

# [Denial of Service] 서비스 거부 — ResourceQuota/LimitRange 설정 여부
kubectl get resourcequota,limitrange -n demo 2>/dev/null || echo "ResourceQuota/LimitRange 미설정"
```

**동작 원리:** STRIDE 위협 모델:
1. **S**poofing(위장): 인증 메커니즘으로 방어 — X.509 인증서, OIDC, SA Token
2. **T**ampering(변조): RBAC + Admission Controller로 무단 변경 방지
3. **R**epudiation(부인): Audit Log로 모든 API 요청을 기록
4. **I**nformation Disclosure(정보 노출): Secret 암호화, RBAC으로 접근 제한
5. **D**enial of Service(서비스 거부): ResourceQuota, LimitRange, PDB로 방어
6. **E**levation of Privilege(권한 상승): PSA, SecurityContext로 컨테이너 권한 제한

### 실습 3: Zero Trust 네트워크 확인

```bash
# Default Deny 정책 확인
kubectl get ciliumnetworkpolicy default-deny-all -n demo -o yaml | head -20

# 허용된 통신 경로 확인
kubectl get ciliumnetworkpolicies -n demo -o custom-columns=NAME:.metadata.name
```

**동작 원리:** Zero Trust 네트워크 구현:
1. "아무것도 신뢰하지 않는다" — 기본적으로 모든 트래픽을 차단한다
2. `default-deny-all`: Ingress + Egress 모두 차단하는 기본 정책
3. 각 `allow-*` 정책이 필요한 통신만 명시적으로 허용한다
4. 허용 경로: nginx → httpbin → postgres/redis/rabbitmq (계층적 접근)
5. DNS(53 포트) 허용이 없으면 Service 이름으로 통신할 수 없다
