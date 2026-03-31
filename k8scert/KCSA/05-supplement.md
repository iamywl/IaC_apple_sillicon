# KCSA 보충 학습 자료

> 기존 학습 자료(01-concepts.md ~ 03-exam-questions.md)에서 누락되었거나 깊이가 부족한 주제를 보강하고, 추가 실전 예제와 확인 문제를 제공한다.

---

## Part 0: 보안 메커니즘 체계 총정리

Kubernetes 보안 메커니즘은 API 요청의 라이프사이클에 따라 다음과 같이 배치된다. 각 단계의 보안 도구와 그 동작 원리를 이해하는 것이 KCSA 시험의 핵심이다.

```
[빌드/배포 전]                    [API 요청 처리]                        [런타임]
 Trivy (이미지 스캔)              인증 (Authentication)                 Falco (시스템 콜 모니터링)
 cosign (이미지 서명)              ↓                                   Tetragon (eBPF 차단)
 SBOM (컴포넌트 목록)             인가 (Authorization: RBAC)            Prometheus (메트릭 감시)
 SLSA (빌드 증명)                  ↓
                               Mutating Admission
                               (Kyverno mutate, Istio sidecar inject)
                                  ↓
                               Schema Validation
                                  ↓
                               Validating Admission
                               (OPA Gatekeeper, Kyverno validate, PSA)
                                  ↓
                               etcd 저장
                               (EncryptionConfiguration, KMS v2)
```

각 단계의 실패 시 동작:

| 단계 | 실패 시 동작 | HTTP 응답 코드 |
|------|-----------|--------------|
| 인증 실패 | 요청 거부 | 401 Unauthorized |
| 인가 실패 | 요청 거부 | 403 Forbidden |
| Admission 거부 | 요청 거부 | 403 Forbidden (webhook denied) |
| Schema 검증 실패 | 요청 거부 | 422 Unprocessable Entity |
| etcd 저장 실패 | 요청 거부 | 500 Internal Server Error |

#### 검증 명령어: 요청 처리 파이프라인 확인

```bash
# 인증 단계 확인 — 현재 사용자 정보
kubectl auth whoami 2>/dev/null || kubectl config view --minify -o jsonpath='{.contexts[0].context.user}'
```

```text
kubernetes-admin
```

```bash
# 인가 단계 확인 — 권한 테스트
kubectl auth can-i create pods -n default
```

```text
yes
```

```bash
# Admission 단계 확인 — 등록된 webhook 목록
kubectl get validatingwebhookconfiguration --no-headers 2>/dev/null | wc -l
kubectl get mutatingwebhookconfiguration --no-headers 2>/dev/null | wc -l
```

```text
3
2
```

---

## Part 1: 누락된 개념 보강

### 1.1 OPA Gatekeeper

#### 기존 방식의 한계

OPA Gatekeeper 이전에는 Kubernetes 클러스터에서 커스텀 정책을 강제할 수단이 부족했다. RBAC는 "누가 무엇을 할 수 있는가"를 제어하지만, "생성되는 리소스의 내용이 조직 정책에 부합하는가"는 제어하지 못한다. 예를 들어 RBAC로는 "모든 Namespace에 team 레이블이 반드시 있어야 한다"거나 "privileged 컨테이너 생성을 금지한다"는 정책을 표현할 수 없다. 이런 정책을 적용하려면 관리자가 수동으로 YAML을 리뷰하거나, 직접 Validating Admission Webhook 서버를 개발해야 했다. 이는 유지보수 부담이 크고, 정책 변경마다 코드를 수정/배포해야 하는 비효율적인 구조였다.

OPA Gatekeeper는 이 문제를 해결한다. 정책을 Rego 언어로 선언적으로 정의하고, CRD 기반으로 클러스터에 적용함으로써 코드 변경 없이 정책을 추가/수정/삭제할 수 있다. 이것이 "Policy as Code"의 핵심이다.

#### 대응하는 공격 벡터와 위험

OPA Gatekeeper가 방어하는 주요 위험은 다음과 같다:

| 위험 | 설명 |
|------|------|
| 정책 미준수 리소스 생성 | 개발자가 보안 정책을 무시하거나 모르고 위반하는 리소스를 배포하는 경우이다. |
| 설정 드리프트(Configuration Drift) | 수동 리뷰 기반 프로세스에서 시간이 지남에 따라 정책 준수율이 하락하는 현상이다. |
| 권한 상승 경로 | privileged 컨테이너, hostPath 마운트 등 위험한 설정이 리뷰 없이 배포되는 경우이다. |

#### 핵심 아키텍처

```
API 요청 → API Server → Mutating Admission → Validating Admission → etcd
                                                      ↑
                                            Gatekeeper Webhook
                                                      ↑
                                          ConstraintTemplate (Rego 로직)
                                                      +
                                          Constraint (파라미터/적용 범위)
```

Gatekeeper의 동작 메커니즘은 다음과 같다. API Server가 리소스 생성/수정 요청을 받으면, Validating Admission 단계에서 Gatekeeper Webhook으로 AdmissionReview 요청을 전송한다. Gatekeeper는 등록된 모든 Constraint를 평가하고, 각 Constraint에 연결된 ConstraintTemplate의 Rego 코드를 실행한다. violation이 발생하면 API Server에 거부 응답을 반환한다. 이 과정은 동기적으로 수행되므로, Gatekeeper가 응답하지 않으면 API Server의 요청 처리가 지연된다. 이를 방지하기 위해 Gatekeeper는 failurePolicy를 설정할 수 있다.

#### ConstraintTemplate과 Constraint

| 리소스 | 역할 | 언어 |
|--------|------|------|
| **ConstraintTemplate** | 정책 로직을 Rego 언어로 정의한다. 새로운 CRD(Custom Resource Definition)를 생성한다. | Rego |
| **Constraint** | ConstraintTemplate이 생성한 CRD의 인스턴스이다. 구체적인 파라미터와 적용 대상(match)을 지정한다. | YAML |

이 2단계 구조의 설계 의도는 정책 로직(ConstraintTemplate)과 정책 적용 범위(Constraint)를 분리하여, 동일한 로직을 서로 다른 파라미터와 범위로 재사용할 수 있도록 하는 것이다. 예를 들어 "필수 레이블 검증" 로직을 한 번 작성하고, Namespace용 Constraint와 Deployment용 Constraint를 별도로 생성할 수 있다.

#### Rego 언어 기초

Rego는 OPA의 정책 언어로, 선언적(declarative) 스타일로 작성한다.

```rego
# 위반 조건을 정의하는 기본 구조
violation[{"msg": msg}] {
  # 조건문: 입력 리소스에서 필요한 라벨이 없는 경우
  provided := {label | input.review.object.metadata.labels[label]}
  required := {label | label := input.parameters.labels[_]}
  missing := required - provided
  count(missing) > 0
  msg := sprintf("필수 레이블 누락: %v", [missing])
}
```

핵심 규칙:
- `violation` 블록 내의 모든 조건이 참(true)이면 정책 위반으로 판정한다.
- `input.review.object`는 API Server로 들어온 요청의 리소스 오브젝트이다.
- `input.parameters`는 Constraint에서 전달하는 파라미터이다.

#### Gatekeeper 배포 구성 요소

| 컴포넌트 | 역할 |
|----------|------|
| `gatekeeper-controller-manager` | Webhook 서버로 동작하며 admission 요청을 처리한다. |
| `gatekeeper-audit` | 기존 리소스에 대한 주기적 감사(audit)를 수행한다. |
| `Config` CRD | Gatekeeper의 동기화 대상 리소스를 설정한다. |

#### Gatekeeper 동작 모드

| 모드 | 설명 |
|------|------|
| **deny** | 정책 위반 시 리소스 생성/수정을 거부한다(기본값). |
| **dryrun** | 위반을 감사 로그에 기록하되 요청을 허용한다. |
| **warn** | 경고 메시지를 반환하되 요청을 허용한다. |

Constraint의 `spec.enforcementAction` 필드로 설정한다.

#### 트러블슈팅 가이드

**문제 1: Gatekeeper webhook이 응답하지 않아 API 요청이 지연되는 경우**

```bash
# Gatekeeper Pod 상태 확인
kubectl get pods -n gatekeeper-system
```

```text
NAME                                            READY   STATUS    RESTARTS   AGE
gatekeeper-audit-xxxxx                          1/1     Running   0          10d
gatekeeper-controller-manager-xxxxx             1/1     Running   0          10d
gatekeeper-controller-manager-yyyyy             1/1     Running   0          10d
gatekeeper-controller-manager-zzzzz             1/1     Running   0          10d
```

```bash
# Webhook 설정에서 failurePolicy 확인
kubectl get validatingwebhookconfiguration gatekeeper-validating-webhook-configuration -o jsonpath='{.webhooks[0].failurePolicy}'
```

```text
Fail
```

`failurePolicy: Fail`이면 Gatekeeper가 응답하지 않을 때 모든 API 요청이 거부된다. 프로덕션에서는 `Ignore`로 설정하여 Gatekeeper 장애가 클러스터 운영에 영향을 주지 않도록 할 수 있다. 단, `Ignore`는 정책 우회를 허용하므로 보안 수준이 저하된다.

**문제 2: Constraint가 적용되지 않는 경우**

```bash
# ConstraintTemplate의 status 확인
kubectl get constrainttemplate k8srequiredlabels -o jsonpath='{.status.created}' 2>/dev/null
```

```text
true
```

`created: true`가 아니면 ConstraintTemplate의 Rego 코드에 문법 오류가 있는 것이다.

```bash
# ConstraintTemplate의 에러 확인
kubectl describe constrainttemplate k8srequiredlabels | grep -A5 "Status:"
```

```text
Status:
  Created:  true
  By Pod:
    Id:                  gatekeeper-controller-manager-xxxxx
    Observed Generation: 1
```

#### Gatekeeper 성능 최적화

Gatekeeper는 모든 Admission 요청을 처리하므로 성능에 영향을 줄 수 있다. 대규모 클러스터에서의 최적화 방법:

| 최적화 항목 | 방법 | 효과 |
|-----------|------|------|
| 레플리카 수 | controller-manager를 3개 이상 배포 | 가용성 및 처리량 향상 |
| 타임아웃 설정 | webhook timeout을 3-5초로 설정 | 응답 지연 시 빠른 실패 |
| 네임스페이스 제외 | `excludedNamespaces`로 kube-system 등 제외 | 불필요한 평가 감소 |
| audit 주기 | `audit-interval`을 기본 60초에서 조정 | 기존 리소스 감사 부하 조절 |

---

### 1.2 Kyverno 정책과 이미지 검증(Image Verification)

#### 기존 방식의 한계

OPA Gatekeeper는 강력한 정책 엔진이지만, Rego라는 전용 언어를 배워야 한다는 진입 장벽이 존재한다. Rego는 Datalog 기반의 선언적 언어로, 명령형 프로그래밍에 익숙한 Kubernetes 운영자에게는 학습 곡선이 가파르다. 또한 ConstraintTemplate + Constraint의 2단계 구조는 단순한 정책에도 두 개의 리소스를 작성해야 하므로 관리 부담이 있다.

Kyverno는 이 문제를 해결하기 위해 설계되었다. 정책을 Kubernetes 네이티브 YAML로 작성하므로 별도 언어 학습이 불필요하다. `kubectl`로 정책을 관리하고, Kubernetes 리소스와 동일한 방식으로 다룰 수 있다. 단일 ClusterPolicy 리소스로 정책 로직과 적용 범위를 모두 정의할 수 있어 구조가 단순하다.

#### 대응하는 공격 벡터와 위험

Kyverno가 방어하는 위험은 OPA Gatekeeper와 유사하지만, 추가로 다음을 제공한다:

| 위험 | Kyverno의 대응 |
|------|---------------|
| 서명되지 않은 이미지 배포 | `verifyImages` 규칙으로 cosign/Notary 서명을 자동 검증한다. |
| 보안 설정 누락 | `mutate` 규칙으로 기본 보안 설정을 자동 주입한다. |
| 연관 리소스 부재 | `generate` 규칙으로 NetworkPolicy 등을 자동 생성한다. |

#### Kyverno 정책 유형

| 정책 종류 | 범위 | 설명 |
|-----------|------|------|
| **ClusterPolicy** | 클러스터 전체 | 모든 네임스페이스에 적용되는 정책이다. |
| **Policy** | 네임스페이스 | 특정 네임스페이스에만 적용되는 정책이다. |

#### 정책 규칙 유형

| 규칙 유형 | 동작 |
|-----------|------|
| **validate** | 리소스가 규칙을 충족하는지 검증한다. 위반 시 거부 또는 경고한다. |
| **mutate** | 리소스를 자동으로 수정한다(기본값 주입, 사이드카 추가 등). |
| **generate** | 특정 리소스 생성 시 다른 리소스를 자동 생성한다(예: NetworkPolicy 자동 생성). |
| **verifyImages** | 컨테이너 이미지의 서명(signature)과 증명(attestation)을 검증한다. |

#### 이미지 검증(verifyImages) 상세

Kyverno의 `verifyImages` 규칙은 cosign 또는 Notary로 서명된 이미지의 무결성을 검증한다.

```yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: verify-image-signature
spec:
  validationFailureAction: Enforce   # Enforce(거부) 또는 Audit(감사)
  background: false
  rules:
    - name: verify-cosign-signature
      match:
        any:
          - resources:
              kinds:
                - Pod
      verifyImages:
        - imageReferences:
            - "myregistry.io/*"       # 검증 대상 이미지 패턴
          attestors:
            - count: 1                # 필요한 서명자 수
              entries:
                - keys:
                    publicKeys: |-     # cosign 공개 키
                      -----BEGIN PUBLIC KEY-----
                      MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE...
                      -----END PUBLIC KEY-----
```

**검증 명령어:**

```bash
# 정책 적용 확인
kubectl get clusterpolicy verify-image-signature -o jsonpath='{.status.ready}'
# 기대 출력: true

# 서명되지 않은 이미지로 테스트 (거부되어야 한다)
kubectl run unsigned-test --image=myregistry.io/unsigned-app:latest --dry-run=server
# 기대 출력:
# Error from server: admission webhook "mutate.kyverno.svc-fail" denied the request:
# resource Pod/default/unsigned-test was blocked due to the following policies
# verify-image-signature:
#   verify-cosign-signature: 'image verification failed for myregistry.io/unsigned-app:latest: signature not found'

# 정책 위반 리포트 확인
kubectl get policyreport -A
# 기대 출력: 위반 건수가 FAIL 열에 표시된다
```

핵심 필드:
- `imageReferences`: 검증 대상 이미지의 글로브 패턴이다.
- `attestors`: 서명 검증에 사용할 키 또는 인증 기관이다.
- `attestations`: SLSA provenance 등 빌드 증명을 검증한다.
- `mutateDigest`: 태그를 다이제스트로 자동 변환할지 설정한다(기본 true).

#### OPA Gatekeeper vs Kyverno 아키텍처 비교

두 도구는 동일한 목적(Admission 기반 정책 적용)을 수행하지만 아키텍처가 근본적으로 다르다.

**OPA Gatekeeper의 아키텍처:**
- OPA 엔진을 Kubernetes에 통합한 것이다. OPA는 범용 정책 엔진으로, Kubernetes 외에도 Terraform, Envoy, CI/CD 파이프라인 등 다양한 환경에서 사용할 수 있다.
- Rego 언어는 Datalog에 기반한 선언적 쿼리 언어이다. 복잡한 조건(집합 연산, 중첩 순회, 외부 데이터 참조)을 표현하는 데 강점이 있다.
- ConstraintTemplate + Constraint 2단계 구조는 정책 라이브러리(Gatekeeper Library)를 조직 전체에서 공유할 수 있도록 설계되었다.
- OPA/Rego 기술을 이미 보유한 조직에 적합하다.

**Kyverno의 아키텍처:**
- Kubernetes 전용으로 설계되었다. Kubernetes 외 환경에서는 사용할 수 없다.
- YAML 기반이므로 Kubernetes 운영자의 기존 지식을 활용할 수 있다.
- 단일 ClusterPolicy에 로직, 파라미터, 적용 범위를 모두 포함하여 관리가 단순하다.
- validate 외에 mutate, generate, verifyImages를 하나의 정책에서 조합할 수 있어, "정책 위반 시 거부" 외에 "자동 교정"까지 가능하다.
- Kubernetes 운영에 집중하는 팀에 적합하다.

| 비교 항목 | OPA Gatekeeper | Kyverno |
|-----------|---------------|---------|
| **정책 언어** | Rego (전용 언어) | YAML (Kubernetes 네이티브) |
| **CNCF 상태** | Graduated (OPA) | Graduated (2024년 7월 졸업) |
| **학습 곡선** | 높음 (Rego 학습 필요) | 낮음 (YAML만으로 작성) |
| **정책 유형** | Validate + Mutate (v3.10+) | Validate, Mutate, Generate, VerifyImages |
| **이미지 검증** | 별도 구현 필요 | 내장 지원 (cosign, Notary 연동) |
| **정책 구조** | ConstraintTemplate + Constraint (2단계) | ClusterPolicy 단일 리소스 |
| **기존 리소스 감사** | 내장 audit 지원 | 내장 background scan 지원 |
| **리소스 자동 생성** | 미지원 | generate 규칙으로 지원 |
| **범용성** | Kubernetes 외 환경에도 적용 가능 | Kubernetes 전용 |
| **CLI 도구** | `gator` CLI | `kyverno` CLI (정책 테스트, 적용 미리보기) |

---

### 1.3 Falco 규칙 구문과 배포 상세

#### 등장 배경과 기존 한계점

컨테이너 런타임 보안의 발전 과정:

1. **이미지 스캔 (정적 분석)**: Trivy, Grype 등으로 이미지에 포함된 CVE 취약점을 스캔한다. 그러나 알려지지 않은 취약점(zero-day)이나 실행 시점의 비정상 행위는 탐지할 수 없다.
2. **Admission 정책 (배포 시점)**: OPA Gatekeeper, Kyverno로 위험한 Pod 설정을 차단한다. 그러나 정상적으로 배포된 Pod 내부에서 발생하는 위협은 탐지할 수 없다.
3. **런타임 보안 (실행 시점)**: Falco, Tetragon으로 실행 중인 컨테이너의 비정상 행위를 실시간 탐지한다. 이것이 "shift right" 보안이다.

Falco는 Sysdig(현 Sysdig Inc.)가 2016년에 개발하고 CNCF에 기증한 오픈소스 프로젝트이다. 2024년 CNCF Graduated로 승격되었다. Falco가 해결하는 핵심 문제는 "컨테이너가 정상적으로 배포된 후 발생하는 위협"이다. 공격자가 정상 이미지의 취약점을 이용하여 쉘을 획득하고, 민감 파일을 읽거나 패키지를 설치하는 등의 행위는 배포 시점의 보안 도구로는 탐지할 수 없다.

Falco와 Tetragon의 비교:

| 비교 항목 | Falco | Tetragon |
|----------|-------|----------|
| 개발 주체 | Sysdig → CNCF | Isovalent (Cilium) → CNCF |
| CNCF 상태 | Graduated (2024) | Incubating |
| 기능 | 탐지(Detection)만 | 탐지 + 차단(Enforcement) |
| 드라이버 | kmod, eBPF, modern eBPF | eBPF only |
| 규칙 언어 | Falco 전용 YAML | CRD 기반 (TracingPolicy) |
| 차단 기능 | 미지원 (경보만 발생) | sigkill로 프로세스 즉시 종료 가능 |
| 이벤트 소스 | syscall, k8s_audit, plugin | syscall (커널 함수 수준) |

#### 대응하는 공격 벡터와 위험

Falco는 CNCF Graduated 프로젝트로, 커널 시스템 콜(syscall)을 모니터링하여 런타임 위협을 탐지하는 보안 도구이다.

Admission 정책(OPA, Kyverno)과 이미지 스캔(Trivy)은 "배포 전" 단계의 보안이다. 그러나 컨테이너가 실행된 이후에 발생하는 위협(쉘 실행, 민감 파일 접근, 네트워크 리스닝 포트 변경, 패키지 설치 등)은 이들 도구로 탐지할 수 없다. Falco는 이 "런타임" 단계의 보안 공백을 메운다.

Falco가 탐지하는 주요 공격 벡터:

| 공격 벡터 | MITRE ATT&CK 전술 | Falco 탐지 방식 |
|----------|-------------------|----------------|
| 컨테이너 내 쉘 실행 | Execution | `proc.name in (bash, sh, zsh)` 조건으로 프로세스 생성 시스템 콜 감시 |
| /etc/shadow 읽기 | Credential Access | `open_read` 시스템 콜에서 `fd.name` 필터링 |
| 패키지 매니저 실행 | Persistence | 이미지 변조 시도를 프로세스명으로 탐지 |
| ServiceAccount 토큰 접근 | Credential Access | 토큰 파일 경로에 대한 open 시스템 콜 감시 |

#### 동작 메커니즘

Falco는 커널 레벨에서 시스템 콜을 가로채는 방식으로 동작한다. 드라이버(eBPF 프로브 또는 커널 모듈)가 커널에서 발생하는 모든 시스템 콜 이벤트를 캡처하고, 유저 스페이스의 Falco 엔진이 이 이벤트를 규칙과 대조한다. 규칙의 condition이 참이면 경보(alert)를 발생시킨다. 이 구조는 애플리케이션 코드 수정 없이 동작하며, 컨테이너 내부에 에이전트를 설치할 필요가 없다.

#### Falco 아키텍처

```
컨테이너 프로세스
      ↓ (시스템 콜 발생)
Linux 커널 ← Falco 드라이버 (eBPF 프로브 또는 커널 모듈)
      ↓ (이벤트 캡처)
Falco 엔진 (규칙 매칭)
      ↓ (경보 발생)
출력 채널 (stdout, syslog, gRPC, HTTP webhook, Kafka 등)
```

#### Falco 드라이버 유형

| 드라이버 | 설명 | 장단점 |
|----------|------|--------|
| **커널 모듈(kmod)** | 커널 모듈로 시스템 콜을 캡처한다. | 성능이 우수하나 커널 버전 의존성이 높다. |
| **eBPF 프로브** | eBPF를 통해 시스템 콜을 캡처한다. | 커널 모듈보다 안전하고 커널 호환성이 좋다. |
| **modern eBPF** | CO-RE(Compile Once, Run Everywhere) 기반 eBPF이다. | 커널 5.8+ 필요하나 별도 빌드 불필요이다. |
| **플러그인** | Kubernetes audit log, AWS CloudTrail 등 외부 소스를 입력으로 사용한다. | 시스템 콜 외 다양한 이벤트 소스를 지원한다. |

#### Falco 규칙 구문

Falco 규칙은 세 가지 요소로 구성된다.

**1) 매크로(Macro)**: 재사용 가능한 조건 블록이다.

```yaml
- macro: container
  condition: container.id != host

- macro: sensitive_files
  condition: >
    fd.name startswith /etc and
    (fd.name in (/etc/shadow, /etc/passwd, /etc/sudoers))
```

**2) 리스트(List)**: 값 목록을 정의한다.

```yaml
- list: allowed_images
  items: [nginx, redis, postgres]

- list: sensitive_mount_paths
  items: [/proc, /sys, /var/run/docker.sock]
```

**3) 규칙(Rule)**: 실제 탐지 로직을 정의한다.

```yaml
- rule: 컨테이너에서 쉘 실행 탐지
  desc: 컨테이너 내부에서 bash/sh 등의 쉘이 실행될 때 경보를 발생시킨다.
  condition: >
    spawned_process and
    container and
    proc.name in (bash, sh, zsh, csh, ksh)
  output: >
    컨테이너에서 쉘 실행 감지
    (user=%user.name container=%container.name
     image=%container.image.repository
     command=%proc.cmdline
     namespace=%k8s.ns.name pod=%k8s.pod.name)
  priority: WARNING
  tags: [container, shell, mitre_execution]
  source: syscall
```

**검증 명령어:**

```bash
# Falco가 정상 동작하는지 확인
kubectl get pods -n falco
# 기대 출력: falco-xxxxx Pod가 각 노드에서 Running 상태이다

# Falco 로그에서 규칙 로딩 확인
kubectl logs -n falco -l app.kubernetes.io/name=falco --tail=20 | grep "Rules loaded"
# 기대 출력: Rules loaded 메시지와 로딩된 규칙 수가 표시된다

# 쉘 실행 탐지 테스트 (별도 터미널에서 Falco 로그 모니터링)
kubectl exec -it <test-pod> -- /bin/sh
# Falco 로그 기대 출력:
# WARNING 컨테이너에서 쉘 실행 감지 (user=root container=test-pod image=nginx ...)

# falcosidekick 웹 UI로 경보 확인 (설치된 경우)
kubectl port-forward -n falco svc/falco-falcosidekick-ui 2802:2802
# 브라우저에서 http://localhost:2802 접속
```

#### 규칙 필드 상세

| 필드 | 설명 |
|------|------|
| `rule` | 규칙 이름이다. 고유해야 한다. |
| `desc` | 규칙에 대한 설명이다. |
| `condition` | Falco 필터 구문으로 작성한 탐지 조건이다. |
| `output` | 경보 발생 시 출력할 메시지 형식이다. `%`로 필드를 참조한다. |
| `priority` | 심각도이다. EMERGENCY, ALERT, CRITICAL, ERROR, WARNING, NOTICE, INFO, DEBUG 중 하나이다. |
| `tags` | 규칙 분류 태그이다. MITRE ATT&CK 매핑에 활용한다. |
| `source` | 이벤트 소스이다. `syscall`, `k8s_audit`, `plugin` 등이다. |
| `enabled` | `false`로 설정하면 규칙을 비활성화한다. |
| `exceptions` | 특정 조건을 예외 처리한다(Falco 0.28+). |

#### Falco 배포 방법

| 배포 방식 | 설명 | 적합 환경 |
|-----------|------|-----------|
| **DaemonSet** | 각 노드에 Falco Pod를 배포한다. | 일반 Kubernetes 클러스터 |
| **Helm Chart** | `falcosecurity/falco` Helm 차트로 배포한다. | 프로덕션 권장 방식 |
| **호스트 설치** | 패키지 매니저로 노드에 직접 설치한다. | 비 Kubernetes 환경 |

Helm 배포 시 주요 설정:

```bash
helm install falco falcosecurity/falco \
  --namespace falco --create-namespace \
  --set driver.kind=ebpf \
  --set falcosidekick.enabled=true \
  --set falcosidekick.webui.enabled=true
```

- `falcosidekick`: Falco 경보를 Slack, PagerDuty, Elasticsearch 등으로 전달하는 컴포넌트이다.
- `driver.kind`: 드라이버 유형을 지정한다(`module`, `ebpf`, `modern_ebpf`).

**배포 검증:**

```bash
# Helm 릴리스 상태 확인
helm status falco -n falco
# 기대 출력: STATUS: deployed

# 모든 Falco Pod가 Running인지 확인
kubectl get pods -n falco -o wide
# 기대 출력: 각 노드에 하나씩 falco Pod가 Running 상태이다

# 드라이버 로딩 확인
kubectl logs -n falco -l app.kubernetes.io/name=falco | grep "driver"
# 기대 출력: "eBPF probe loaded" 또는 해당 드라이버 로딩 메시지
```

---

### 1.4 Secret 키 로테이션(Key Rotation) 절차

#### 등장 배경과 기존 한계점

암호화 키 로테이션은 암호학의 기본 원칙 중 하나이다. 동일한 키를 장기간 사용하면 다음 위험이 발생한다:
1. 키가 유출되었으나 탐지하지 못한 경우, 유출 시점 이후의 모든 데이터가 위험에 노출된다.
2. 동일한 키로 대량의 데이터를 암호화하면 통계적 분석에 의한 키 추정 가능성이 증가한다.
3. 컴플라이언스 프레임워크(PCI DSS, SOC 2 등)는 정기적인 키 로테이션을 의무화한다.

Kubernetes에서 키 로테이션이 특히 중요한 이유: EncryptionConfiguration의 키가 API Server 매니페스트 파일에 평문으로 저장되기 때문이다. 이 파일에 접근할 수 있는 운영자가 퇴사하거나, 파일이 백업/로그에 포함되어 유출될 수 있다. 키 로테이션을 통해 이전 키를 무효화하면 피해 범위를 제한할 수 있다.

KMS v2를 사용하면 키 로테이션이 자동화되고, API Server 설정 파일에 평문 키를 두지 않아도 된다. 이것이 프로덕션 환경에서 KMS 사용이 권장되는 주요 이유이다.

#### 대응하는 공격 벡터와 위험

Kubernetes에서 Secret의 암호화 키 로테이션은 EncryptionConfiguration의 키를 주기적으로 교체하는 과정이다. 키 로테이션이 필요한 이유는 다음과 같다:

| 위험 | 설명 |
|------|------|
| 키 유출 | 암호화 키가 유출되면 etcd에 저장된 모든 Secret을 복호화할 수 있다. |
| 장기 사용에 의한 암호 분석 | 동일한 키로 오랫동안 암호화하면 암호 분석에 의한 키 추정 위험이 증가한다. |
| 컴플라이언스 요구사항 | PCI DSS, SOC 2 등의 규정은 정기적인 키 로테이션을 요구한다. |

#### 동작 메커니즘

EncryptionConfiguration의 `providers` 배열에서 **첫 번째** 프로바이더의 **첫 번째** 키가 새 데이터의 암호화에 사용된다. 나머지 키와 프로바이더는 기존 데이터의 복호화에만 사용된다. 이 메커니즘 덕분에 키 로테이션 시 다운타임 없이 점진적으로 전환할 수 있다.

#### 전체 로테이션 절차

```
1. 새 키 생성
      ↓
2. EncryptionConfiguration에 새 키를 첫 번째로 추가
      ↓
3. API Server 재시작
      ↓
4. 모든 Secret을 다시 쓰기(re-encrypt)
      ↓
5. 이전 키 제거 (선택 사항, 안전 확인 후)
      ↓
6. API Server 재시작
```

#### 단계별 상세

**1단계: 새 암호화 키 생성**

```bash
# 32바이트 랜덤 키 생성 (aescbc용)
head -c 32 /dev/urandom | base64
```

**2단계: EncryptionConfiguration 업데이트**

새 키를 `keys` 배열의 첫 번째 위치에 추가한다. 첫 번째 키가 새 데이터 암호화에 사용되고, 나머지 키는 기존 데이터 복호화에만 사용된다.

```yaml
apiVersion: apiserver.config.k8s.io/v1
kind: EncryptionConfiguration
resources:
  - resources:
      - secrets
    providers:
      - aescbc:
          keys:
            - name: key-2024-new      # 새 키 (첫 번째 = 암호화에 사용)
              secret: <새로-생성한-base64-키>
            - name: key-2024-old      # 이전 키 (복호화에만 사용)
              secret: <이전-base64-키>
      - identity: {}                  # 암호화되지 않은 데이터 읽기 폴백
```

**3단계: API Server 재시작**

```bash
# kubeadm 클러스터의 경우 static pod 매니페스트 수정으로 자동 재시작
# EncryptionConfiguration 파일은 API Server의 --encryption-provider-config 경로에 위치
```

**4단계: 기존 Secret을 새 키로 다시 암호화**

```bash
# 모든 네임스페이스의 Secret을 다시 쓴다
kubectl get secrets --all-namespaces -o json | \
  kubectl replace -f -
```

이 명령은 모든 Secret을 읽어서 다시 저장하므로, 새 첫 번째 키로 재암호화된다.

**5단계: 이전 키 제거 (확인 후)**

모든 Secret이 새 키로 재암호화되었음을 확인한 후 이전 키를 제거한다.

**검증 명령어:**

```bash
# 키 로테이션 후 etcd에서 암호화 확인
ETCDCTL_API=3 etcdctl \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key \
  get /registry/secrets/default/my-secret | hexdump -C
# 기대 출력: "k8s:enc:aescbc:v1:key-2024-new" 프리픽스가 보여야 한다.
# "key-2024-old"가 보이면 해당 Secret이 아직 재암호화되지 않은 것이다.

# 특정 Secret을 생성하여 새 키로 암호화되는지 테스트
kubectl create secret generic rotation-test --from-literal=test=value
ETCDCTL_API=3 etcdctl \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key \
  get /registry/secrets/default/rotation-test | hexdump -C
# 기대 출력: "k8s:enc:aescbc:v1:key-2024-new" 프리픽스 확인
kubectl delete secret rotation-test
```

#### KMS(Key Management Service) 사용 시

프로덕션 환경에서는 로컬 키 대신 KMS를 사용하는 것이 권장된다.

| 항목 | 로컬 키 (aescbc/secretbox) | KMS v2 |
|------|---------------------------|--------|
| 키 저장 위치 | EncryptionConfiguration 파일 내 평문 | 외부 KMS (AWS KMS, GCP KMS, Vault 등) |
| 키 로테이션 | 수동 (위 절차) | KMS에서 자동 로테이션 가능 |
| 키 보호 수준 | 파일 시스템 권한에 의존 | HSM(Hardware Security Module) 지원 |
| DEK/KEK 분리 | 미지원 | DEK(Data Encryption Key)를 KEK(Key Encryption Key)로 암호화 |

---

### 1.5 External Secrets Operator (ESO)

#### 등장 배경과 발전 과정

Kubernetes Secret 관리 도구의 발전 과정:

1. **Kubernetes Secret (기본)**: base64 인코딩으로 etcd에 저장된다. EncryptionConfiguration으로 암호화 가능하지만, Secret 값 자체는 클러스터 내부에 존재한다. Git 관리가 어렵다(평문 노출 위험).

2. **Sealed Secrets (Bitnami, 2017)**: 공개키로 암호화된 SealedSecret CRD를 Git에 저장한다. 클러스터 내부에서 개인키로 복호화하여 Kubernetes Secret을 생성한다. 장점은 Git 친화적이나, 단일 클러스터 키에 의존하고 외부 저장소와 연동되지 않는다.

3. **External Secrets Operator (2020+)**: 외부 비밀 저장소(HashiCorp Vault, AWS Secrets Manager, Azure Key Vault, GCP Secret Manager, 1Password 등)와 Kubernetes Secret을 자동 동기화한다. 외부 저장소에서 Secret이 변경되면 다음 동기화 주기에 자동 반영된다.

4. **CSI Secret Store Driver (2020+)**: 외부 저장소의 Secret을 Volume으로 직접 마운트한다. etcd에 저장하지 않는 옵션이 있어 Secret 데이터가 클러스터 외부에만 존재할 수 있다.

각 방식의 사용 시나리오:

| 시나리오 | 적합한 도구 | 이유 |
|---------|-----------|------|
| 단일 클러스터, GitOps | Sealed Secrets | Git에 암호화된 Secret 저장 |
| 멀티 클러스터, 중앙 관리 | External Secrets Operator | 외부 저장소에서 일괄 관리 |
| etcd에 Secret 미저장 필요 | CSI Secret Store Driver | Volume 마운트만 사용 |
| 프로덕션 + 자동 로테이션 | ESO + Vault | Vault에서 동적 Secret 발급 |

#### 기존 방식의 한계

Kubernetes 기본 Secret은 etcd에 저장된다. `EncryptionConfiguration`으로 etcd 암호화를 설정할 수 있지만, Secret 값 자체는 클러스터 내부에 존재한다. 멀티 클러스터 환경이나 Kubernetes 외 시스템과 Secret을 공유해야 하는 경우, 운영 팀이 HashiCorp Vault, AWS Secrets Manager 등 외부 저장소에서 수동으로 값을 가져와 Kubernetes Secret을 생성/업데이트해야 했다. 이 수동 프로세스는 다음 문제를 발생시킨다:

| 문제 | 설명 |
|------|------|
| 동기화 지연 | 외부 저장소에서 Secret이 변경되어도 Kubernetes에 수동 반영 전까지 구 버전이 사용된다. |
| 운영 부담 | Secret 수가 많아지면 수동 동기화가 현실적으로 불가능하다. |
| 보안 위험 | 수동 동기화 과정에서 Secret 값이 로컬 파일, 쉘 히스토리, CI/CD 로그 등에 노출될 수 있다. |
| 감사 추적 불가 | 누가 언제 Secret을 업데이트했는지 추적이 어렵다. |

External Secrets Operator(ESO)는 이 수동 동기화를 자동화한다. ExternalSecret CRD를 선언하면 ESO 컨트롤러가 주기적으로 외부 저장소에서 값을 가져와 Kubernetes Secret을 생성/업데이트한다.

#### 아키텍처와 동작 메커니즘

```
외부 비밀 저장소                  Kubernetes 클러스터
┌──────────────────┐          ┌───────────────────────────────┐
│ AWS Secrets Mgr  │          │  ExternalSecret (CR)          │
│ HashiCorp Vault  │◄────────►│       ↓                       │
│ Azure Key Vault  │   동기화  │  ESO Controller               │
│ GCP Secret Mgr   │          │       ↓                       │
│ 1Password        │          │  Kubernetes Secret (자동 생성) │
└──────────────────┘          └───────────────────────────────┘
```

ESO의 동작 흐름은 다음과 같다:
1. 운영자가 SecretStore(외부 저장소 연결 정보)와 ExternalSecret(동기화 대상)을 생성한다.
2. ESO 컨트롤러가 ExternalSecret의 `refreshInterval`에 따라 주기적으로 외부 저장소에 접근한다.
3. 외부 저장소에서 가져온 값으로 Kubernetes Secret을 생성하거나 업데이트한다.
4. 외부 저장소에서 값이 변경되면 다음 동기화 주기에 자동 반영된다.

#### 핵심 CRD

| CRD | 범위 | 설명 |
|-----|------|------|
| **SecretStore** | 네임스페이스 | 외부 비밀 저장소와의 연결 정보를 정의한다. |
| **ClusterSecretStore** | 클러스터 전체 | 클러스터 범위의 외부 비밀 저장소 연결이다. 여러 네임스페이스에서 공유한다. |
| **ExternalSecret** | 네임스페이스 | 외부 저장소에서 가져올 비밀과 동기화 설정을 정의한다. |
| **ClusterExternalSecret** | 클러스터 전체 | 여러 네임스페이스에 동일한 ExternalSecret을 생성한다. |

#### SecretStore 예시 (AWS Secrets Manager)

```yaml
apiVersion: external-secrets.io/v1beta1
kind: SecretStore
metadata:
  name: aws-secrets-manager
  namespace: production
spec:
  provider:
    aws:
      service: SecretsManager
      region: ap-northeast-2
      auth:
        jwt:
          serviceAccountRef:
            name: eso-service-account   # IRSA 사용
```

**검증 명령어:**

```bash
# SecretStore 연결 상태 확인
kubectl get secretstore aws-secrets-manager -n production
# 기대 출력:
# NAME                    AGE   STATUS   CAPABILITIES   READY
# aws-secrets-manager     10m   Valid    ReadWrite      True

# 상세 상태 확인
kubectl describe secretstore aws-secrets-manager -n production | grep -A5 "Status:"
# 기대 출력: Conditions에 "SecretStoreReady" 상태가 True이다
```

#### ExternalSecret 예시

```yaml
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: db-credentials
  namespace: production
spec:
  refreshInterval: 1h              # 동기화 주기
  secretStoreRef:
    name: aws-secrets-manager      # 사용할 SecretStore
    kind: SecretStore
  target:
    name: db-credentials           # 생성될 Kubernetes Secret 이름
    creationPolicy: Owner          # ESO가 Secret의 소유자가 된다
  data:
    - secretKey: username          # Kubernetes Secret의 키
      remoteRef:
        key: production/db         # 외부 저장소의 비밀 경로
        property: username         # 비밀 내 특정 필드
    - secretKey: password
      remoteRef:
        key: production/db
        property: password
```

**검증 명령어:**

```bash
# ExternalSecret 동기화 상태 확인
kubectl get externalsecret db-credentials -n production
# 기대 출력:
# NAME              STORE                   REFRESH INTERVAL   STATUS         READY
# db-credentials    aws-secrets-manager     1h                 SecretSynced   True

# 생성된 Kubernetes Secret 확인
kubectl get secret db-credentials -n production
# 기대 출력: Secret이 존재하며 data에 username, password 키가 포함되어 있다

# Secret 데이터 내용 확인 (디코딩)
kubectl get secret db-credentials -n production -o jsonpath='{.data.username}' | base64 -d
# 기대 출력: 외부 저장소에 저장된 username 값이 출력된다

# 동기화 이벤트 확인
kubectl describe externalsecret db-credentials -n production | grep -A10 "Events:"
# 기대 출력: "Updated" 이벤트와 동기화 시간이 표시된다
```

#### ESO vs 다른 Secret 관리 방식 비교

| 방식 | 장점 | 단점 |
|------|------|------|
| **Kubernetes Secret (기본)** | 추가 설정 불필요 | 평문 저장(etcd), Git 관리 어려움 |
| **Sealed Secrets** | Git에 암호화된 Secret 저장 가능 | 단일 클러스터 키 의존, 외부 저장소 미연동 |
| **External Secrets Operator** | 외부 저장소 연동, 자동 로테이션, 다중 백엔드 지원 | 외부 의존성, 추가 인프라 필요 |
| **CSI Secret Store Driver** | Volume으로 마운트, etcd에 저장하지 않음 | Kubernetes Secret으로의 동기화는 선택 사항 |
| **SOPS** | Git 친화적 암호화, 다중 KMS 지원 | 수동 암/복호화, 자동 동기화 미지원 |

---

### 1.6 kubectl auth can-i 패턴

#### 등장 배경과 기존 한계점

RBAC 도입 이전에는 Kubernetes의 접근 제어가 ABAC(Attribute-Based Access Control) 기반이었다. ABAC는 JSON 파일에 정책을 정의하고 API Server 재시작이 필요하여 운영이 어려웠다. RBAC(Kubernetes 1.8 stable)로 전환된 이후에도, Role/ClusterRole/RoleBinding/ClusterRoleBinding의 4가지 리소스가 여러 계층으로 중첩되면 특정 주체의 실제 권한을 수동으로 파악하기 극도로 어려웠다.

`kubectl auth can-i`는 이 문제를 해결하기 위해 Kubernetes에 내장된 RBAC 검증 도구이다. 내부적으로 SubjectAccessReview/SelfSubjectAccessReview API를 호출하여 API Server의 인가 엔진이 실제로 반환하는 결과를 확인한다. 이는 RBAC 규칙을 수동으로 추적하는 것보다 정확하다.

보안 감사에서 `kubectl auth can-i`가 필수적인 이유:
1. **권한 크리프(Permission Creep) 탐지**: 시간이 지남에 따라 불필요한 권한이 누적되는 현상을 발견한다.
2. **과도한 권한 식별**: `kubectl auth can-i '*' '*'`으로 와일드카드 권한을 가진 주체를 찾는다.
3. **권한 상승 경로 분석**: `escalate`, `bind`, `impersonate` verb를 가진 주체를 식별한다.
4. **컴플라이언스 증거**: 감사에서 "최소 권한 원칙이 적용되어 있다"는 증거로 활용한다.

#### 대응하는 공격 벡터와 위험

`kubectl auth can-i`는 현재 사용자 또는 특정 주체(Subject)가 특정 리소스에 대한 작업 권한이 있는지 확인하는 명령이다. RBAC 구성의 검증과 보안 감사에 핵심적인 도구이다.

이 도구가 필요한 이유는 RBAC 설정의 복잡성에 있다. Role, ClusterRole, RoleBinding, ClusterRoleBinding이 여러 계층으로 중첩되면 특정 주체의 실제 권한을 수동으로 파악하기 어렵다. 특히 다음 위험을 사전에 탐지하는 데 필수적이다:

| 위험 | 검증 명령어 |
|------|------------|
| 과도한 Secret 접근 | `kubectl auth can-i list secrets --as=...` |
| 불필요한 exec 권한 | `kubectl auth can-i create pods/exec --as=...` |
| 권한 상승 가능성 | `kubectl auth can-i escalate clusterroles --as=...` |
| 와일드카드 권한 | `kubectl auth can-i '*' '*' --as=...` |

#### 기본 문법

```bash
kubectl auth can-i <verb> <resource> [--namespace <ns>] [flags]
```

#### 주요 사용 패턴

**1) 현재 사용자의 권한 확인**

```bash
# Secret을 조회할 수 있는지 확인
kubectl auth can-i get secrets -n production
# 기대 출력: yes 또는 no

# 모든 네임스페이스에서 Pod를 삭제할 수 있는지 확인
kubectl auth can-i delete pods --all-namespaces
# 기대 출력: yes 또는 no
```

**2) 특정 사용자의 권한 확인 (impersonation)**

```bash
# 특정 사용자로 확인
kubectl auth can-i create deployments --as=jane -n development
# 기대 출력: yes 또는 no

# 특정 그룹으로 확인
kubectl auth can-i get nodes --as-group=developers
# 기대 출력: yes 또는 no

# ServiceAccount로 확인
kubectl auth can-i list secrets \
  --as=system:serviceaccount:production:my-app-sa -n production
# 기대 출력: yes 또는 no
```

**3) 전체 권한 목록 조회**

```bash
# 현재 사용자의 현재 네임스페이스 내 모든 권한 조회
kubectl auth can-i --list
# 기대 출력:
# Resources                          Non-Resource URLs   Resource Names   Verbs
# selfsubjectaccessreviews.auth...   []                  []               [create]
# selfsubjectrulesreviews.auth...    []                  []               [create]
# ...

# 특정 네임스페이스에서 특정 ServiceAccount의 전체 권한 조회
kubectl auth can-i --list \
  --as=system:serviceaccount:kube-system:default -n kube-system
```

**4) 하위 리소스(Sub-resource) 권한 확인**

```bash
# Pod의 로그를 볼 수 있는지 확인
kubectl auth can-i get pods/log -n production
# 기대 출력: yes 또는 no

# Pod에 exec 할 수 있는지 확인
kubectl auth can-i create pods/exec -n production
# 기대 출력: yes 또는 no

# Node의 proxy에 접근할 수 있는지 확인
kubectl auth can-i create nodes/proxy
# 기대 출력: yes 또는 no
```

**5) 비-리소스 URL 접근 확인**

```bash
# 헬스 체크 엔드포인트 접근 확인
kubectl auth can-i get /healthz
# 기대 출력: yes 또는 no

# 메트릭 엔드포인트 접근 확인
kubectl auth can-i get /metrics
# 기대 출력: yes 또는 no
```

#### 보안 감사 활용 스크립트 예시

```bash
#!/bin/bash
# 위험한 권한을 가진 ServiceAccount를 검사하는 스크립트

DANGEROUS_VERBS=("create" "delete" "patch")
SENSITIVE_RESOURCES=("secrets" "pods/exec" "clusterroles" "clusterrolebindings")

for ns in $(kubectl get ns -o jsonpath='{.items[*].metadata.name}'); do
  for sa in $(kubectl get sa -n "$ns" -o jsonpath='{.items[*].metadata.name}'); do
    for resource in "${SENSITIVE_RESOURCES[@]}"; do
      for verb in "${DANGEROUS_VERBS[@]}"; do
        result=$(kubectl auth can-i "$verb" "$resource" \
          --as="system:serviceaccount:${ns}:${sa}" -n "$ns" 2>/dev/null)
        if [ "$result" = "yes" ]; then
          echo "[경고] ${ns}/${sa} 는 ${resource}에 대해 ${verb} 권한이 있다."
        fi
      done
    done
  done
done
```

**스크립트 실행 결과 확인:**

```bash
# 스크립트 실행
chmod +x audit-rbac.sh && ./audit-rbac.sh
# 기대 출력 예시:
# [경고] kube-system/default 는 secrets에 대해 create 권한이 있다.
# [경고] production/admin-sa 는 pods/exec에 대해 create 권한이 있다.
# 출력이 없으면 위험한 권한이 부여된 ServiceAccount가 없는 것이다.
```

#### SelfSubjectAccessReview / SubjectAccessReview API

`kubectl auth can-i`는 내부적으로 Kubernetes API를 호출한다.

| API 리소스 | 설명 |
|-----------|------|
| **SelfSubjectAccessReview** | 현재 사용자 자신의 권한을 확인한다. `kubectl auth can-i`의 기본 동작이다. |
| **SubjectAccessReview** | 다른 주체의 권한을 확인한다. `--as` 플래그 사용 시 호출된다. |
| **SelfSubjectRulesReview** | 현재 사용자의 전체 권한 목록을 조회한다. `--list` 플래그 사용 시 호출된다. |

---

## Part 2: 추가 실전 예제

### 보안 도구 체인의 계층별 배치

실전 예제를 학습하기 전에, 각 보안 도구가 워크로드 라이프사이클의 어느 단계에서 동작하는지 이해해야 한다. 도구를 잘못된 단계에 배치하면 보안 공백이 발생한다.

| 단계 | 도구 | 동작 | 탐지/차단 대상 |
|------|------|------|-------------|
| 빌드 시 | Trivy, Grype, Snyk | 이미지 정적 분석 | CVE 취약점, 악성 패키지 |
| 빌드 시 | cosign, Notary | 이미지 서명 | 변조되지 않은 이미지 보장 |
| 빌드 시 | Syft, Trivy | SBOM 생성 | 컴포넌트 목록화 |
| 배포 시 | OPA Gatekeeper, Kyverno | Admission 검증 | 정책 위반 리소스 |
| 배포 시 | PSA | Pod 보안 표준 적용 | 위험한 Pod 설정 |
| 런타임 | Falco | 시스템 콜 모니터링 | 쉘 실행, 민감 파일 접근 |
| 런타임 | Tetragon | eBPF 모니터링 + 차단 | 프로세스 실행, 네트워크 활동 |
| 런타임 | CiliumNetworkPolicy | 네트워크 트래픽 제어 | 무단 통신, L7 공격 |
| 런타임 | Istio mTLS | 서비스 간 암호화 | 도청, MITM |

#### 검증 명령어: 보안 도구 동작 확인

```bash
# Admission webhook 동작 확인 — 등록된 webhook 목록
kubectl get validatingwebhookconfiguration -o custom-columns='NAME:.metadata.name,WEBHOOKS:.webhooks[*].name'
```

```text
NAME                                              WEBHOOKS
gatekeeper-validating-webhook-configuration        validation.gatekeeper.sh
kyverno-resource-validating-webhook-cfg            validate.kyverno.svc
```

```bash
# PSA 적용 네임스페이스 확인
kubectl get ns -o jsonpath='{range .items[*]}{.metadata.name}{" enforce="}{.metadata.labels.pod-security\.kubernetes\.io/enforce}{"\n"}{end}' | grep -v "enforce=$"
```

```text
production enforce=restricted
kube-system enforce=privileged
```

### 예제 1: OPA Gatekeeper ConstraintTemplate - 필수 레이블 강제

#### 기존 방식의 한계

이 정책이 없으면 레이블 없는 Namespace가 생성될 수 있고, 리소스 소유 추적, 비용 할당, 정책 적용이 불가능해진다. 수동 코드 리뷰로 이를 방지하는 것은 확장 불가능한 방법이다.

```yaml
# 1) ConstraintTemplate: 필수 레이블 검증 로직 정의
apiVersion: templates.gatekeeper.sh/v1
kind: ConstraintTemplate
metadata:
  name: k8srequiredlabels
spec:
  crd:
    spec:
      names:
        kind: K8sRequiredLabels
      validation:
        openAPIV3Schema:
          type: object
          properties:
            labels:
              type: array
              items:
                type: string
              description: "필수 레이블 목록"
  targets:
    - target: admission.k8s.gatekeeper.sh
      rego: |
        package k8srequiredlabels

        violation[{"msg": msg, "details": {"missing_labels": missing}}] {
          provided := {label | input.review.object.metadata.labels[label]}
          required := {label | label := input.parameters.labels[_]}
          missing := required - provided
          count(missing) > 0
          msg := sprintf("리소스 '%v'에 필수 레이블이 누락되었다: %v", [input.review.object.metadata.name, missing])
        }
---
# 2) Constraint: 모든 네임스페이스에 app, team 레이블 강제
apiVersion: constraints.gatekeeper.sh/v1beta1
kind: K8sRequiredLabels
metadata:
  name: ns-must-have-labels
spec:
  enforcementAction: deny
  match:
    kinds:
      - apiGroups: [""]
        kinds: ["Namespace"]
    excludedNamespaces:
      - kube-system
      - kube-public
      - gatekeeper-system
  parameters:
    labels:
      - "app"
      - "team"
```

**검증 명령어:**

```bash
# ConstraintTemplate 적용 확인
kubectl get constrainttemplate k8srequiredlabels
# 기대 출력:
# NAME                  AGE
# k8srequiredlabels     30s

# Constraint 적용 확인
kubectl get k8srequiredlabels ns-must-have-labels
# 기대 출력:
# NAME                   ENFORCEMENT-ACTION   TOTAL-VIOLATIONS
# ns-must-have-labels    deny                 0

# 정책 테스트: 레이블 없는 Namespace 생성 시도 (거부되어야 한다)
kubectl create namespace test-no-labels
# 기대 출력:
# Error from server (Forbidden): admission webhook "validation.gatekeeper.sh" denied the request:
# [ns-must-have-labels] 리소스 'test-no-labels'에 필수 레이블이 누락되었다: {"app", "team"}

# 정책 준수: 레이블이 있는 Namespace 생성 (성공해야 한다)
kubectl create namespace test-with-labels --dry-run=server -o yaml <<EOF
apiVersion: v1
kind: Namespace
metadata:
  name: test-with-labels
  labels:
    app: myapp
    team: platform
EOF
# 기대 출력: namespace/test-with-labels created (server dry run)

# 기존 리소스에 대한 위반 확인 (audit 결과)
kubectl get k8srequiredlabels ns-must-have-labels -o jsonpath='{.status.violations}' | jq .
# 기대 출력: 기존 Namespace 중 레이블이 누락된 것들의 목록이 표시된다
```

---

### 예제 2: Kyverno ClusterPolicy - 이미지 레지스트리 제한

#### 기존 방식의 한계

이 정책이 없으면 개발자가 Docker Hub 등 공개 레지스트리에서 임의의 이미지를 Pull하여 사용할 수 있다. 공격자가 공개 레지스트리에 악성 이미지를 게시하고, 이름을 정상 이미지와 유사하게 만드는 typosquatting 공격이 가능하다.

```yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: restrict-image-registries
  annotations:
    policies.kyverno.io/title: 허용된 레지스트리만 사용
    policies.kyverno.io/category: Supply Chain Security
    policies.kyverno.io/severity: high
spec:
  validationFailureAction: Enforce
  background: true
  rules:
    - name: validate-registries
      match:
        any:
          - resources:
              kinds:
                - Pod
      validate:
        message: >-
          허용되지 않은 이미지 레지스트리이다.
          허용된 레지스트리: ghcr.io/myorg/*, docker.io/library/*
        pattern:
          spec:
            containers:
              - image: "ghcr.io/myorg/* | docker.io/library/*"
            =(initContainers):
              - image: "ghcr.io/myorg/* | docker.io/library/*"
            =(ephemeralContainers):
              - image: "ghcr.io/myorg/* | docker.io/library/*"
```

**검증 명령어:**

```bash
# 정책 적용 확인
kubectl get clusterpolicy restrict-image-registries
# 기대 출력:
# NAME                          ADMISSION   BACKGROUND   VALIDATE ACTION   READY   AGE
# restrict-image-registries     true        true         Enforce           True    30s

# 허용되지 않은 레지스트리 테스트 (거부되어야 한다)
kubectl run malicious-test --image=evil-registry.io/backdoor:latest --dry-run=server
# 기대 출력:
# Error from server: admission webhook "validate.kyverno.svc" denied the request:
# resource Pod/default/malicious-test was blocked due to the following policies
# restrict-image-registries:
#   validate-registries: '허용되지 않은 이미지 레지스트리이다. ...'

# 허용된 레지스트리 테스트 (성공해야 한다)
kubectl run allowed-test --image=ghcr.io/myorg/app:v1.0 --dry-run=server
# 기대 출력: pod/allowed-test created (server dry run)

# background scan으로 기존 위반 Pod 확인
kubectl get policyreport -A -o wide
# 기대 출력: 기존 Pod 중 정책을 위반하는 것들이 FAIL로 표시된다
```

---

### 예제 3: Falco 커스텀 규칙 YAML

#### 대응하는 공격 벡터

이 규칙 세트는 MITRE ATT&CK for Containers의 Credential Access, Persistence 전술에 해당하는 런타임 공격을 탐지한다. 이미지 스캔이나 Admission 정책으로는 이 단계의 위협을 방어할 수 없다.

```yaml
# falco-custom-rules.yaml (ConfigMap 또는 파일로 배포)
customRules:
  custom-rules.yaml: |-
    # 민감 파일 접근 탐지
    - rule: 컨테이너에서 /etc/shadow 읽기 시도
      desc: 컨테이너 내부에서 shadow 파일에 대한 읽기 접근을 탐지한다.
      condition: >
        open_read and
        container and
        fd.name = /etc/shadow
      output: >
        컨테이너에서 민감 파일 접근 탐지
        (user=%user.name command=%proc.cmdline file=%fd.name
         container=%container.name image=%container.image.repository
         namespace=%k8s.ns.name pod=%k8s.pod.name)
      priority: CRITICAL
      tags: [filesystem, mitre_credential_access]

    # Kubernetes ServiceAccount 토큰 접근 탐지
    - rule: ServiceAccount 토큰 파일 접근
      desc: 컨테이너에서 ServiceAccount 토큰 파일에 접근하는 것을 탐지한다.
      condition: >
        open_read and
        container and
        fd.name startswith /var/run/secrets/kubernetes.io/serviceaccount
      output: >
        ServiceAccount 토큰 접근 탐지
        (user=%user.name command=%proc.cmdline
         container=%container.name namespace=%k8s.ns.name
         pod=%k8s.pod.name file=%fd.name)
      priority: WARNING
      tags: [kubernetes, mitre_credential_access]

    # 컨테이너에서 패키지 관리자 실행 탐지
    - rule: 컨테이너에서 패키지 설치 시도
      desc: 컨테이너 내부에서 패키지 관리자가 실행되면 이미지 변조 시도일 수 있다.
      condition: >
        spawned_process and
        container and
        proc.name in (apt, apt-get, yum, dnf, apk, pip, npm)
      output: >
        컨테이너에서 패키지 관리자 실행
        (command=%proc.cmdline container=%container.name
         image=%container.image.repository
         namespace=%k8s.ns.name pod=%k8s.pod.name)
      priority: ERROR
      tags: [container, mitre_persistence]
```

**검증 명령어:**

```bash
# 커스텀 규칙이 로딩되었는지 확인
kubectl logs -n falco -l app.kubernetes.io/name=falco | grep "custom-rules"
# 기대 출력: 커스텀 규칙 파일 로딩 관련 메시지

# /etc/shadow 읽기 탐지 테스트
kubectl exec -it <test-pod> -- cat /etc/shadow
# Falco 로그 확인 (별도 터미널):
kubectl logs -n falco -l app.kubernetes.io/name=falco -f | grep "민감 파일 접근"
# 기대 출력:
# CRITICAL 컨테이너에서 민감 파일 접근 탐지 (user=root command=cat /etc/shadow ...)

# 패키지 설치 시도 탐지 테스트
kubectl exec -it <test-pod> -- apt-get update
# Falco 로그 확인:
kubectl logs -n falco -l app.kubernetes.io/name=falco -f | grep "패키지 관리자"
# 기대 출력:
# ERROR 컨테이너에서 패키지 관리자 실행 (command=apt-get update ...)

# ServiceAccount 토큰 접근 탐지 테스트
kubectl exec -it <test-pod> -- cat /var/run/secrets/kubernetes.io/serviceaccount/token
# Falco 로그 확인:
kubectl logs -n falco -l app.kubernetes.io/name=falco -f | grep "토큰 접근"
# 기대 출력:
# WARNING ServiceAccount 토큰 접근 탐지 (command=cat ... file=/var/run/secrets/...)
```

---

### 예제 4: EncryptionConfiguration - Secrets at Rest 암호화

#### 등장 배경과 기존 한계점

Kubernetes 초기(v1.0~v1.6)에는 etcd에 저장되는 데이터를 암호화하는 메커니즘이 없었다. 모든 데이터가 base64 인코딩 상태로 저장되었으며, etcd에 접근할 수 있는 공격자는 모든 Secret을 평문으로 읽을 수 있었다. base64는 인코딩(encoding)이지 암호화(encryption)가 아니다. base64는 가역적 변환이므로 보안 기능을 제공하지 않는다.

Kubernetes 1.7에서 EncryptionConfiguration이 도입되어 etcd에 저장되는 리소스를 암호화할 수 있게 되었다. 이후 Kubernetes 1.10에서 KMS v1, 1.27에서 KMS v2가 도입되어 외부 키 관리 서비스와의 연동이 가능해졌다.

암호화 프로바이더 발전 과정:

| 프로바이더 | 도입 버전 | 알고리즘 | 특징 |
|----------|---------|---------|------|
| `identity` | - | 없음 (평문) | 암호화 미적용 — 폴백 전용 |
| `aescbc` | 1.7 | AES-CBC-256 | 초기 기본 프로바이더 |
| `aesgcm` | 1.7 | AES-GCM-256 | 인증된 암호화(AEAD) — 무결성 검증 포함 |
| `secretbox` | 1.7 | XSalsa20+Poly1305 | 현대적 AEAD 알고리즘 — 권장 |
| `kms` v1 | 1.10 | 외부 KMS | DEK/KEK 분리, 외부 키 관리 |
| `kms` v2 | 1.27 (stable) | 외부 KMS | KMS v1 대비 성능 개선, DEK 캐싱 |

#### 공격-방어 매핑

| 공격 시나리오 | 암호화 미적용 시 | EncryptionConfiguration 적용 시 | KMS v2 적용 시 |
|-------------|-------------|------------------------------|--------------|
| etcd 백업 파일 탈취 | 모든 Secret 평문 읽기 | 복호화 키 없이는 읽기 불가 | KEK 없이는 DEK 복호화 불가 |
| etcd API 직접 접근 | 모든 데이터 읽기/수정 가능 | 암호화된 데이터만 보임 | 암호화된 데이터만 보임 |
| EncryptionConfig 파일 탈취 | 해당 없음 | 키가 파일에 평문 존재 — 복호화 가능 | 키가 파일에 없음 — KMS 접근 필요 |
| 디스크 포렌식 | etcd 데이터 파일에서 Secret 추출 | 복호화 키 필요 | KEK + KMS 접근 필요 |

#### 기존 방식의 한계

EncryptionConfiguration이 적용되지 않은 클러스터에서는 Secret이 etcd에 base64 인코딩 상태로 저장된다. base64는 암호화가 아니며, etcd에 접근할 수 있는 공격자는 모든 Secret을 평문으로 읽을 수 있다.

```yaml
# /etc/kubernetes/encryption-config.yaml
apiVersion: apiserver.config.k8s.io/v1
kind: EncryptionConfiguration
resources:
  # Secret 리소스 암호화
  - resources:
      - secrets
    providers:
      - aescbc:                          # 첫 번째 프로바이더가 암호화에 사용된다
          keys:
            - name: key-2024-03          # 키 이름 (로테이션 추적용)
              secret: Y2hhbmdlLW1lLXRvLWEtcmVhbC0zMmJ5dGUta2V5IQ==  # base64 인코딩된 32바이트 키
      - identity: {}                     # 폴백: 암호화되지 않은 데이터도 읽을 수 있도록
  # ConfigMap 리소스도 암호화 가능
  - resources:
      - configmaps
    providers:
      - identity: {}                     # ConfigMap은 암호화하지 않음 (선택 사항)
```

API Server 플래그:

```
--encryption-provider-config=/etc/kubernetes/encryption-config.yaml
```

**검증 명령어:**

```bash
# 테스트 Secret 생성
kubectl create secret generic encryption-test \
  --from-literal=mykey=mydata -n default

# etcd에서 직접 데이터를 읽어 암호화 여부 확인
ETCDCTL_API=3 etcdctl \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key \
  get /registry/secrets/default/encryption-test | hexdump -C
# 기대 출력 (암호화된 경우):
# "k8s:enc:aescbc:v1:key-2024-03" 프리픽스가 보이고, 이후 데이터가 바이너리(암호화된 형태)이다.
# 기대 출력 (암호화되지 않은 경우):
# "mydata" 같은 평문이 직접 보인다. 이 경우 EncryptionConfiguration이 적용되지 않은 것이다.

# API Server를 통해 Secret이 정상적으로 복호화되는지 확인
kubectl get secret encryption-test -n default -o jsonpath='{.data.mykey}' | base64 -d
# 기대 출력: mydata

# 테스트 Secret 정리
kubectl delete secret encryption-test -n default
```

Audit Level 정리:

| 수준 | 기록 내용 |
|------|----------|
| **None** | 기록하지 않는다. |
| **Metadata** | 요청 메타데이터(사용자, 타임스탬프, 리소스, verb)만 기록한다. 요청/응답 본문은 제외한다. |
| **Request** | 메타데이터와 요청 본문을 기록한다. 응답 본문은 제외한다. |
| **RequestResponse** | 메타데이터, 요청 본문, 응답 본문을 모두 기록한다. 가장 상세하다. |

---

### 예제 5: Audit Policy - 다중 규칙 구성

#### 대응하는 공격 벡터

Audit 로그가 없으면 공격자의 행동을 추적할 수 없다(STRIDE의 Repudiation). 또한 보안 인시던트 발생 시 영향 범위를 파악할 수 없고, 컴플라이언스 감사를 통과할 수 없다.

```yaml
# /etc/kubernetes/audit-policy.yaml
apiVersion: audit.k8s.io/v1
kind: Policy
# 전역 기본 규칙: catch-all
omitStages:
  - "RequestReceived"      # RequestReceived 단계의 이벤트는 생략한다
rules:
  # 규칙 1: Secret 관련 모든 작업을 Metadata 수준으로 기록 (본문 제외)
  - level: Metadata
    resources:
      - group: ""
        resources: ["secrets"]

  # 규칙 2: ConfigMap 변경은 RequestResponse 수준으로 기록
  - level: RequestResponse
    resources:
      - group: ""
        resources: ["configmaps"]
    verbs: ["create", "update", "patch", "delete"]

  # 규칙 3: 인증/인가 관련 API 호출은 상세 기록
  - level: RequestResponse
    resources:
      - group: "rbac.authorization.k8s.io"
        resources: ["clusterroles", "clusterrolebindings", "roles", "rolebindings"]

  # 규칙 4: Pod exec/attach/portforward는 반드시 기록
  - level: Metadata
    resources:
      - group: ""
        resources: ["pods/exec", "pods/attach", "pods/portforward"]

  # 규칙 5: 시스템 컴포넌트의 읽기 요청은 기록하지 않는다 (노이즈 감소)
  - level: None
    users:
      - "system:kube-controller-manager"
      - "system:kube-scheduler"
    userGroups:
      - "system:serviceaccounts:kube-system"
    verbs: ["get", "list", "watch"]

  # 규칙 6: 헬스 체크 엔드포인트는 기록하지 않는다
  - level: None
    nonResourceURLs:
      - "/healthz*"
      - "/livez*"
      - "/readyz*"

  # 규칙 7: 나머지 모든 요청은 Metadata 수준으로 기록
  - level: Metadata
```

**검증 명령어:**

```bash
# API Server에 audit 설정이 적용되었는지 확인
ps aux | grep kube-apiserver | grep audit-policy
# 기대 출력: --audit-policy-file=/etc/kubernetes/audit-policy.yaml 플래그가 보여야 한다

# audit 로그 파일 존재 확인
ls -la /var/log/apiserver/audit.log
# 기대 출력: 파일이 존재하고 크기가 증가하고 있어야 한다

# Secret 접근 감사 테스트
kubectl get secret -n kube-system
# audit 로그에서 해당 이벤트 확인:
tail -5 /var/log/apiserver/audit.log | jq 'select(.objectRef.resource=="secrets")'
# 기대 출력: stage: "ResponseComplete", verb: "list", objectRef.resource: "secrets"
# 요청/응답 본문(requestObject, responseObject)은 포함되지 않아야 한다 (Metadata 수준)

# Pod exec 감사 테스트
kubectl exec -it <test-pod> -- echo test
# audit 로그에서 확인:
tail -10 /var/log/apiserver/audit.log | jq 'select(.objectRef.subresource=="exec")'
# 기대 출력: verb: "create", objectRef.resource: "pods", objectRef.subresource: "exec"
```

---

### 예제 6: RBAC - 최소 권한 ServiceAccount 구성

#### 등장 배경과 기존 한계점

Kubernetes의 ServiceAccount 보안은 버전에 따라 크게 변화하였다.

**Kubernetes 1.23 이전**: ServiceAccount를 생성하면 자동으로 `<sa-name>-token-xxxxx` Secret이 생성되었다. 이 Secret에는 만료 기간 없는 JWT 토큰이 포함되어 있었다. 토큰이 유출되면 영구적으로 사용 가능하여 보안 위험이 컸다.

**Kubernetes 1.24+**: ServiceAccount 자동 Secret 생성이 중단되었다. 대신 TokenRequest API를 통해 만료 시간(기본 1시간), 대상(audience), 바인딩 대상(Pod)이 지정된 바운드 토큰(Bound Token)이 발급된다. 이 토큰은 Pod 삭제 시 자동 무효화되어 유출 시 피해를 최소화한다.

**default ServiceAccount의 위험**: 모든 Namespace에 자동 생성되는 `default` ServiceAccount는 모든 Pod가 기본적으로 사용한다. `automountServiceAccountToken`이 기본 `true`이므로, API Server에 접근할 필요 없는 Pod에도 토큰이 마운트된다. 하나의 Pod 침해 시 해당 ServiceAccount의 권한으로 클러스터 API에 접근할 수 있다.

최소 권한 원칙(Principle of Least Privilege)을 ServiceAccount에 적용하는 방법:
1. 워크로드별 전용 ServiceAccount를 생성한다.
2. 필요한 최소한의 RBAC 권한만 부여한다.
3. `automountServiceAccountToken: false`를 기본으로 설정한다.
4. API 접근이 필요한 Pod에서만 명시적으로 토큰을 마운트한다.
5. `resourceNames`를 사용하여 특정 리소스에만 접근을 허용한다.

#### 공격-방어 매핑

| 공격 벡터 | default SA 사용 시 | 전용 SA + 최소 권한 시 |
|----------|-----------------|---------------------|
| Pod 침해 후 API 접근 | default SA 토큰으로 API 접근 가능 | automountServiceAccountToken=false로 토큰 없음 |
| Secret 탈취 | default SA에 Secret 접근 권한 가능 | Secret 접근 권한 미부여 |
| Pod exec로 다른 Pod 침투 | exec 권한이 있을 수 있음 | exec 권한 미부여 |
| 횡적 이동 (Lateral Movement) | 제한 없는 API 접근 가능 | 특정 리소스만 접근 가능 |

#### 기존 방식의 한계

Kubernetes의 default ServiceAccount는 각 Namespace에 자동 생성되며, 별도 RBAC 설정 없이도 기본적인 API 접근이 가능하다. 모든 Pod가 default ServiceAccount를 사용하면 하나의 Pod 침해 시 해당 ServiceAccount의 권한으로 다른 리소스에 접근할 수 있다. 전용 ServiceAccount를 생성하고 최소 권한만 부여하는 것이 필수적이다.

```yaml
# 1) 전용 ServiceAccount 생성
apiVersion: v1
kind: ServiceAccount
metadata:
  name: monitoring-agent
  namespace: production
  annotations:
    description: "모니터링 에이전트용 최소 권한 ServiceAccount"
automountServiceAccountToken: false   # 토큰 자동 마운트 비활성화
---
# 2) 필요한 최소 권한만 부여하는 Role
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: monitoring-agent-role
  namespace: production
rules:
  # Pod 상태 조회만 허용
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list", "watch"]
  # Pod 메트릭 조회
  - apiGroups: ["metrics.k8s.io"]
    resources: ["pods"]
    verbs: ["get", "list"]
  # ConfigMap 읽기 (설정 참조용)
  - apiGroups: [""]
    resources: ["configmaps"]
    verbs: ["get"]
    resourceNames: ["monitoring-config"]  # 특정 ConfigMap만 허용
  # Secret은 접근 불가 - 명시적으로 권한을 부여하지 않음
---
# 3) RoleBinding
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: monitoring-agent-binding
  namespace: production
subjects:
  - kind: ServiceAccount
    name: monitoring-agent
    namespace: production
roleRef:
  kind: Role
  name: monitoring-agent-role
  apiGroup: rbac.authorization.k8s.io
---
# 4) Pod에서 명시적으로 토큰 마운트 설정
apiVersion: v1
kind: Pod
metadata:
  name: monitoring-agent
  namespace: production
spec:
  serviceAccountName: monitoring-agent
  automountServiceAccountToken: true   # Pod 레벨에서 명시적 활성화
  containers:
    - name: agent
      image: ghcr.io/myorg/monitoring-agent:v1.2.3
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
        allowPrivilegeEscalation: false
        readOnlyRootFilesystem: true
        capabilities:
          drop: ["ALL"]
```

**검증 명령어:**

```bash
# ServiceAccount 생성 확인
kubectl get sa monitoring-agent -n production
# 기대 출력: monitoring-agent ServiceAccount가 존재한다

# 권한 검증: Pod 조회 가능 여부 (yes여야 한다)
kubectl auth can-i get pods \
  --as=system:serviceaccount:production:monitoring-agent -n production
# 기대 출력: yes

# 권한 검증: Secret 접근 불가 여부 (no여야 한다)
kubectl auth can-i get secrets \
  --as=system:serviceaccount:production:monitoring-agent -n production
# 기대 출력: no

# 권한 검증: Pod 삭제 불가 여부 (no여야 한다)
kubectl auth can-i delete pods \
  --as=system:serviceaccount:production:monitoring-agent -n production
# 기대 출력: no

# 권한 검증: 특정 ConfigMap만 접근 가능한지 확인
kubectl auth can-i get configmaps \
  --as=system:serviceaccount:production:monitoring-agent -n production
# 기대 출력: yes (단, resourceNames 제한이 있으므로 실제로는 monitoring-config만 접근 가능)

# 전체 권한 목록 조회
kubectl auth can-i --list \
  --as=system:serviceaccount:production:monitoring-agent -n production
# 기대 출력: pods [get list watch], configmaps [get] 등 최소 권한만 표시된다
```

---

### 예제 7: NetworkPolicy - namespaceSelector AND/OR 패턴

#### 등장 배경과 기존 한계점

NetworkPolicy의 AND/OR 패턴은 KCSA 시험에서 가장 빈출되는 주제 중 하나이다. 이 패턴이 혼동을 일으키는 이유는 YAML의 배열 구문과 Kubernetes의 의미론 사이의 괴리 때문이다.

YAML에서 `-`는 배열의 새 항목을 나타낸다. NetworkPolicy의 `from` 필드는 배열이며, 배열의 각 항목은 OR 관계이다. 그러나 하나의 배열 항목 내에서 `namespaceSelector`와 `podSelector`를 동시에 지정하면 AND 관계가 된다. 이 미묘한 차이를 YAML 들여쓰기만으로 판단해야 하므로 실수가 빈번하다.

이 설계가 채택된 이유: NetworkPolicy는 Kubernetes 1.3에서 도입되었으며, 표현력과 단순성 사이의 균형을 위해 이 방식이 선택되었다. 별도의 `and`/`or` 키워드를 도입하면 YAML 구조가 더 복잡해지기 때문이다.

실전에서의 위험: AND와 OR를 혼동하면 의도하지 않은 트래픽이 허용되거나 차단될 수 있다.
- AND로 의도했으나 OR로 작성: 예상보다 넓은 범위의 트래픽이 허용되어 보안 공백 발생
- OR로 의도했으나 AND로 작성: 정상 트래픽이 차단되어 서비스 장애 발생

#### 트러블슈팅 가이드

**문제: NetworkPolicy AND/OR 패턴 디버깅**

```bash
# NetworkPolicy의 실제 적용 상태를 describe로 확인
kubectl describe networkpolicy allow-prod-backend-and -n database
```

```text
Spec:
  PodSelector:     app=postgres
  Allowing ingress traffic:
    To Port: 5432/TCP
    From:
      NamespaceSelector: environment=production
      PodSelector: role=backend
```

`From:` 아래에 `NamespaceSelector`와 `PodSelector`가 같은 수준에 표시되면 AND 조건이다.

```bash
kubectl describe networkpolicy allow-prod-or-monitoring -n database
```

```text
Spec:
  PodSelector:     app=postgres
  Allowing ingress traffic:
    To Port: 5432/TCP
    From:
      NamespaceSelector: environment=production
    From:
      PodSelector: role=monitoring
```

`From:`이 두 번 표시되면 OR 조건이다.

#### 대응하는 공격 벡터

NetworkPolicy가 없는 Kubernetes 클러스터는 flat network이다. 하나의 Pod가 침해되면 공격자가 같은 클러스터 내 모든 Pod와 통신할 수 있어, 횡적 이동(Lateral Movement)이 용이하다. NetworkPolicy의 AND/OR 패턴을 정확히 이해하지 못하면 의도하지 않은 트래픽을 허용하거나 차단하는 결과를 초래한다.

```yaml
# 패턴 1: AND 조건 (같은 from 항목 내)
# "environment: production 레이블을 가진 네임스페이스"의 "role: backend 레이블을 가진 Pod"만 허용
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-prod-backend-and
  namespace: database
spec:
  podSelector:
    matchLabels:
      app: postgres
  policyTypes:
    - Ingress
  ingress:
    - from:
        # AND 조건: namespaceSelector와 podSelector가 같은 항목에 있으면 AND이다
        - namespaceSelector:
            matchLabels:
              environment: production
          podSelector:                  # 들여쓰기 주의: namespaceSelector와 동일 레벨
            matchLabels:
              role: backend
      ports:
        - protocol: TCP
          port: 5432
---
# 패턴 2: OR 조건 (별도의 from 항목)
# "environment: production 네임스페이스의 모든 Pod" 또는 "아무 네임스페이스의 role: monitoring Pod" 허용
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-prod-or-monitoring
  namespace: database
spec:
  podSelector:
    matchLabels:
      app: postgres
  policyTypes:
    - Ingress
  ingress:
    - from:
        # OR 조건: 별도의 배열 항목이면 OR이다
        - namespaceSelector:            # 조건 A: production 네임스페이스의 모든 Pod
            matchLabels:
              environment: production
        - podSelector:                  # 조건 B: 같은 네임스페이스의 monitoring Pod
            matchLabels:
              role: monitoring
      ports:
        - protocol: TCP
          port: 5432
```

**AND vs OR 구분 핵심 규칙:**

| 패턴 | YAML 구조 | 의미 |
|------|----------|------|
| **AND** | `namespaceSelector`와 `podSelector`가 같은 배열 항목(`-`) 아래에 있다 | 두 조건을 모두 만족해야 한다 |
| **OR** | `namespaceSelector`와 `podSelector`가 각각 별도의 배열 항목(`-`)이다 | 하나라도 만족하면 된다 |

```yaml
# AND: 하나의 - 아래에 두 셀렉터
- from:
    - namespaceSelector: ...
      podSelector: ...        # 들여쓰기가 namespaceSelector와 같은 레벨

# OR: 각각 별도의 -
- from:
    - namespaceSelector: ...
    - podSelector: ...        # 별도의 배열 항목 (앞에 - 가 있다)
```

**검증 명령어:**

```bash
# NetworkPolicy 적용 확인
kubectl get networkpolicy -n database
# 기대 출력:
# NAME                       POD-SELECTOR    AGE
# allow-prod-backend-and     app=postgres    30s
# allow-prod-or-monitoring   app=postgres    30s

# 정책 상세 확인
kubectl describe networkpolicy allow-prod-backend-and -n database
# 기대 출력:
# Allowing ingress traffic:
#   To Port: 5432/TCP
#   From:
#     NamespaceSelector: environment=production
#     PodSelector: role=backend
# (AND 조건이므로 두 셀렉터가 같은 From 항목에 표시된다)

# AND 조건 테스트: production 네임스페이스의 backend Pod에서 접근 (허용되어야 한다)
kubectl exec -n production -l role=backend -- nc -zv postgres.database.svc.cluster.local 5432
# 기대 출력: Connection to postgres.database.svc.cluster.local 5432 port [tcp/*] succeeded!

# AND 조건 테스트: production 네임스페이스의 frontend Pod에서 접근 (차단되어야 한다)
kubectl exec -n production -l role=frontend -- nc -zv -w3 postgres.database.svc.cluster.local 5432
# 기대 출력: 타임아웃 발생 (연결 불가)
```

---

### 예제 8: Pod Security Admission 네임스페이스 레이블

#### 등장 배경과 기존 한계점

Pod Security Admission(PSA)은 PodSecurityPolicy(PSP)의 후속 기능이다. PSP는 Kubernetes 1.0부터 존재했으나, 여러 근본적인 문제로 Kubernetes 1.21에서 deprecated, 1.25에서 제거되었다.

PSP의 한계:
1. **복잡한 바인딩 모델**: PSP는 RBAC를 통해 간접적으로 적용되어, 어떤 PSP가 어떤 Pod에 적용되는지 파악하기 어려웠다. `use` verb를 가진 ServiceAccount에만 PSP가 적용되었는데, 이 관계를 추적하기가 매우 어려웠다.
2. **우선순위 문제**: 여러 PSP가 매칭될 때 우선순위 결정 규칙이 복잡하고 예측하기 어려웠다. mutating PSP가 먼저 적용되고, 그중 이름 알파벳 순으로 우선순위가 결정되는 등 직관적이지 않았다.
3. **Dry-run 미지원**: 기존 워크로드에 PSP를 적용했을 때의 영향을 사전에 파악할 수 없었다.
4. **Mutating과 Validating 혼합**: PSP는 Pod 스펙을 수정(mutate)하고 검증(validate)하는 기능을 동시에 수행하여 동작 예측이 어려웠다.

PSA는 이 문제를 해결하기 위해 설계되었다:
- **네임스페이스 레이블 기반**: 단순한 레이블로 정책 적용 — RBAC 바인딩 불필요
- **3가지 표준화된 프로파일**: privileged, baseline, restricted — 명확한 보안 수준 계층
- **3가지 동작 모드**: enforce(차단), audit(감사), warn(경고) — 점진적 적용 가능
- **Dry-run 지원**: `--dry-run=server`로 영향 사전 파악 가능

#### 공격-방어 매핑

| Pod 설정 | 공격 벡터 | baseline | restricted |
|----------|---------|----------|-----------|
| `privileged: true` | 호스트의 모든 디바이스 접근, 커널 기능 무제한 | 차단 | 차단 |
| `hostNetwork: true` | 호스트 네트워크 스택 접근, 네트워크 스니핑 | 차단 | 차단 |
| `hostPID: true` | 호스트의 모든 프로세스 가시성, 프로세스 종료 | 차단 | 차단 |
| `hostPath` 볼륨 | 호스트 파일시스템 접근, 데이터 탈취/변조 | 차단 | 차단 |
| `runAsUser: 0` | root 권한으로 시스템 파일 수정, setuid 활용 | 허용 | 차단 |
| capabilities 무제한 | CAP_SYS_ADMIN으로 컨테이너 탈출 | 허용 | 차단 |
| seccomp 미설정 | 커널 취약점 악용 시스템 콜 실행 | 허용 | 차단 |

#### 대응하는 공격 벡터

Pod Security Admission(PSA)은 PodSecurityPolicy(PSP)의 후속 기능이다. PSP는 Kubernetes 1.25에서 제거되었고, PSA가 이를 대체한다. PSA가 없으면 privileged 컨테이너, hostNetwork 사용, root 실행 등 위험한 Pod 설정을 허용하게 된다.

PSA의 동작 메커니즘은 Namespace 레이블 기반이다. API Server의 PodSecurity admission controller가 Pod 생성/수정 요청 시 해당 Namespace의 레이블을 확인하고, 지정된 수준(privileged, baseline, restricted)에 따라 허용/경고/감사를 수행한다.

```yaml
# Restricted 수준 적용 네임스페이스
apiVersion: v1
kind: Namespace
metadata:
  name: production
  labels:
    # enforce: 위반 시 Pod 생성 거부
    pod-security.kubernetes.io/enforce: restricted
    pod-security.kubernetes.io/enforce-version: v1.30
    # audit: 감사 로그에 기록
    pod-security.kubernetes.io/audit: restricted
    pod-security.kubernetes.io/audit-version: v1.30
    # warn: 사용자에게 경고 표시
    pod-security.kubernetes.io/warn: restricted
    pod-security.kubernetes.io/warn-version: v1.30
---
# Baseline 수준 적용 네임스페이스 (개발 환경)
apiVersion: v1
kind: Namespace
metadata:
  name: development
  labels:
    pod-security.kubernetes.io/enforce: baseline
    pod-security.kubernetes.io/enforce-version: latest
    # restricted 수준으로 경고만 표시 (점진적 마이그레이션)
    pod-security.kubernetes.io/warn: restricted
    pod-security.kubernetes.io/warn-version: latest
---
# Privileged 수준 네임스페이스 (시스템 컴포넌트용)
apiVersion: v1
kind: Namespace
metadata:
  name: kube-system
  labels:
    pod-security.kubernetes.io/enforce: privileged
    pod-security.kubernetes.io/enforce-version: latest
```

**검증 명령어:**

```bash
# 네임스페이스 레이블 확인
kubectl get ns production --show-labels
# 기대 출력: pod-security.kubernetes.io/enforce=restricted 등의 레이블이 표시된다

# restricted 위반 테스트: privileged Pod 생성 시도 (거부되어야 한다)
kubectl run priv-test -n production --image=nginx \
  --overrides='{"spec":{"containers":[{"name":"priv-test","image":"nginx","securityContext":{"privileged":true}}]}}'  \
  --dry-run=server
# 기대 출력:
# Error from server (Forbidden): pods "priv-test" is forbidden: violates PodSecurity "restricted:v1.30":
# privileged (container "priv-test" must not set securityContext.privileged=true)

# restricted 준수 Pod 생성 테스트 (성공해야 한다)
cat <<EOF | kubectl apply -n production --dry-run=server -f -
apiVersion: v1
kind: Pod
metadata:
  name: compliant-test
spec:
  securityContext:
    runAsNonRoot: true
    runAsUser: 1000
    seccompProfile:
      type: RuntimeDefault
  containers:
    - name: app
      image: nginx
      securityContext:
        allowPrivilegeEscalation: false
        capabilities:
          drop: ["ALL"]
EOF
# 기대 출력: pod/compliant-test created (server dry run)

# development 네임스페이스에서 baseline 위반 테스트
kubectl run hostnet-test -n development --image=nginx \
  --overrides='{"spec":{"hostNetwork":true,"containers":[{"name":"hostnet-test","image":"nginx"}]}}' \
  --dry-run=server
# 기대 출력: baseline enforce에 의해 거부된다 (hostNetwork은 baseline에서 금지)
```

---

### 예제 9: seccomp RuntimeDefault 프로파일 적용

#### 등장 배경과 기존 한계점

seccomp(Secure Computing Mode)은 2005년 Linux 커널 2.6.12에 도입된 보안 기능이다. 초기 seccomp(strict mode)은 `read`, `write`, `exit`, `sigreturn` 4개 시스템 콜만 허용하여 실용성이 제한적이었다. 2012년 Linux 3.5에서 seccomp-bpf(filter mode)가 도입되어 BPF 프로그램으로 시스템 콜을 세밀하게 필터링할 수 있게 되었다.

seccomp이 컨테이너 보안에 중요한 이유: Linux 커널은 300개 이상의 시스템 콜을 제공하지만, 일반 웹 애플리케이션은 50-70개 정도만 사용한다. 나머지 시스템 콜은 공격자가 커널 취약점을 악용하는 데 사용될 수 있다. seccomp은 불필요한 시스템 콜을 차단하여 커널 공격 표면(attack surface)을 축소한다.

Kubernetes에서 seccomp 지원의 발전 과정:
- **Kubernetes 1.3**: annotation 기반 seccomp 프로파일 지정 (`seccomp.security.alpha.kubernetes.io/pod`)
- **Kubernetes 1.19**: securityContext에 `seccompProfile` 필드 추가 (GA)
- **Kubernetes 1.22**: PSA restricted 수준에서 seccomp RuntimeDefault 또는 Localhost 필수화
- **Kubernetes 1.27**: kubelet의 `--seccomp-default=true` 플래그로 모든 Pod에 RuntimeDefault 기본 적용 가능

RuntimeDefault 프로파일은 containerd 또는 CRI-O가 제공하는 기본 프로파일이다. 약 40-60개의 위험한 시스템 콜을 차단하며, 대부분의 일반 워크로드에 호환된다.

#### 공격-방어 매핑

| CVE/공격 | 악용 시스템 콜 | RuntimeDefault 차단 여부 | 위험도 |
|---------|-------------|----------------------|--------|
| CVE-2022-0185 (fsconfig overflow) | `fsconfig` | 차단 | CRITICAL |
| CVE-2022-0847 (Dirty Pipe) | `splice` | 허용 (커널 패치 필요) | CRITICAL |
| CVE-2021-31440 (BPF verifier) | `bpf` | 차단 | HIGH |
| Container escape via mount | `mount` | 차단 | CRITICAL |
| Namespace escape via unshare | `unshare` | 차단 | HIGH |
| Kernel module loading | `init_module`, `finit_module` | 차단 | CRITICAL |

#### 트러블슈팅 가이드

**문제: seccomp 프로파일 적용 후 앱이 실행되지 않는 경우**

```bash
# Pod 이벤트 확인
kubectl describe pod <pod-name> -n <namespace> | grep -A5 "Events:"
```

```text
Events:
  Type     Reason     Age   From     Message
  ----     ------     ----  ----     -------
  Warning  Failed     10s   kubelet  Error: container has runAsNonRoot and image will run as root
```

seccomp과 무관한 다른 securityContext 오류일 수 있다. 정확한 원인을 확인한다.

```bash
# seccomp에 의한 시스템 콜 거부 확인 (dmesg 로그)
ssh admin@<node-ip> 'sudo dmesg | grep "seccomp" | tail -5'
```

```text
[12345.678] audit: type=1326 audit(...): auid=4294967295 uid=1000 gid=1000 ses=4294967295 pid=12345 comm="app" exe="/usr/bin/app" sig=31 arch=aarch64 syscall=165 compat=0 ip=0x7f... code=0x80000000
```

`syscall=165`는 `mount` 시스템 콜이다. 앱이 파일시스템을 마운트하려 하여 차단된 것이다. 앱이 실제로 mount를 필요로 하는지 확인하고, 필요한 경우 커스텀 seccomp 프로파일을 작성한다.

#### 대응하는 공격 벡터

seccomp(Secure Computing Mode)는 컨테이너에서 사용할 수 있는 시스템 콜을 제한하는 Linux 커널 기능이다. seccomp이 없으면 컨테이너가 커널의 모든 시스템 콜을 호출할 수 있어, 커널 취약점을 악용한 컨테이너 탈출(Container Escape) 공격에 취약하다. RuntimeDefault 프로파일은 `mount`, `reboot`, `ptrace`, `kexec_load` 등 약 40~60개의 위험한 시스템 콜을 차단한다.

```yaml
# Pod 수준에서 seccomp 프로파일 적용
apiVersion: v1
kind: Pod
metadata:
  name: secure-app
  namespace: production
spec:
  securityContext:
    # Pod 전체에 seccomp 프로파일 적용
    seccompProfile:
      type: RuntimeDefault       # 컨테이너 런타임의 기본 seccomp 프로파일 사용
    runAsNonRoot: true
    runAsUser: 1000
    runAsGroup: 3000
    fsGroup: 2000
  containers:
    - name: app
      image: ghcr.io/myorg/app:v2.0.0
      securityContext:
        allowPrivilegeEscalation: false
        readOnlyRootFilesystem: true
        capabilities:
          drop: ["ALL"]
          add: ["NET_BIND_SERVICE"]   # 1024 미만 포트 바인딩이 필요한 경우만
      volumeMounts:
        - name: tmp
          mountPath: /tmp
  volumes:
    - name: tmp
      emptyDir: {}                    # 읽기 전용 파일시스템에서 임시 쓰기 공간 제공
```

seccomp 프로파일 유형:

| type | 설명 |
|------|------|
| **RuntimeDefault** | 컨테이너 런타임(containerd, CRI-O)이 제공하는 기본 프로파일이다. 위험한 시스템 콜을 차단한다. |
| **Localhost** | 노드의 로컬 프로파일을 사용한다. `localhostProfile` 필드로 경로를 지정한다. |
| **Unconfined** | seccomp을 적용하지 않는다. PSA restricted 수준에서 금지된다. |

**검증 명령어:**

```bash
# Pod가 정상적으로 실행되는지 확인
kubectl get pod secure-app -n production
# 기대 출력: Running 상태이다

# seccomp 프로파일 적용 확인
kubectl get pod secure-app -n production -o jsonpath='{.spec.securityContext.seccompProfile}'
# 기대 출력: {"type":"RuntimeDefault"}

# 컨테이너의 seccomp 상태 확인 (노드에서 실행)
# 컨테이너의 PID를 찾은 후:
crictl inspect <container-id> | grep -A5 seccomp
# 기대 출력: seccomp 프로파일이 적용된 상태가 표시된다

# seccomp에 의한 시스템 콜 차단 테스트 (RuntimeDefault에서 차단되는 시스템 콜)
kubectl exec secure-app -n production -- unshare --mount /bin/sh
# 기대 출력: Operation not permitted (unshare는 RuntimeDefault에서 차단된다)

# 보안 설정 전체 확인
kubectl get pod secure-app -n production -o jsonpath='{.spec.containers[0].securityContext}' | jq .
# 기대 출력:
# {
#   "allowPrivilegeEscalation": false,
#   "readOnlyRootFilesystem": true,
#   "capabilities": { "drop": ["ALL"], "add": ["NET_BIND_SERVICE"] }
# }
```

---

### 예제 10: CiliumNetworkPolicy - L7 HTTP 필터링

#### 등장 배경과 기존 방식의 한계

네트워크 정책의 발전 과정은 방화벽 기술의 발전과 유사하다:

1. **1세대: 패킷 필터링 방화벽 (L3/L4)**: IP 주소와 포트 번호만으로 트래픽을 제어한다. Kubernetes 표준 NetworkPolicy가 이 수준이다.
2. **2세대: 상태 기반 방화벽 (Stateful)**: 연결 상태를 추적하여 응답 트래픽을 자동 허용한다. CiliumNetworkPolicy의 conntrack이 이 수준이다.
3. **3세대: 애플리케이션 방화벽 (L7)**: HTTP 메서드, URL 경로, 헤더 등 애플리케이션 프로토콜을 인식하여 제어한다. CiliumNetworkPolicy의 L7 규칙이 이 수준이다.

표준 Kubernetes NetworkPolicy의 한계: "포트 8080 허용"이라는 규칙만 설정할 수 있으므로, 해당 포트의 모든 HTTP 요청(GET, POST, DELETE 등)이 허용된다. 공격자가 허용된 포트를 통해 의도하지 않은 API 엔드포인트(예: `/admin`, `/debug/pprof`, `/actuator`)에 접근하는 것을 차단할 수 없다. 이는 웹 애플리케이션 방화벽(WAF)이 필요한 영역이었으나, CiliumNetworkPolicy가 이를 네트워크 정책 수준에서 해결한다.

Cilium L7 정책의 동작 원리: Cilium은 L7 정책이 적용된 트래픽을 사이드카 Envoy 프록시로 리다이렉트한다. Envoy가 HTTP 요청을 파싱하여 메서드, 경로, 헤더를 검사하고, 정책에 부합하지 않으면 HTTP 403 Forbidden을 반환한다. L4 차단(패킷 드롭)과 달리 L7 차단은 HTTP 응답을 반환하므로, 클라이언트는 "연결 불가"가 아닌 "접근 거부"를 인지할 수 있다.

#### 대응하는 공격 벡터와 기존 방식의 한계

표준 Kubernetes NetworkPolicy는 L3(IP)/L4(포트) 수준에서만 트래픽을 제어한다. 이는 "포트 8080을 허용하면 해당 포트의 모든 HTTP 요청이 허용된다"는 의미이다. 공격자가 허용된 포트를 통해 의도하지 않은 API 엔드포인트(예: `/admin`, `/debug/pprof`)에 접근하는 것을 차단할 수 없다.

CiliumNetworkPolicy는 eBPF 기반으로 L7(HTTP method, path, header) 수준의 트래픽 필터링을 제공한다. 이를 통해 "frontend Pod는 GET /api/v1/products만 호출할 수 있고, POST /admin은 차단된다"와 같은 세밀한 정책을 적용할 수 있다.

```yaml
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: api-l7-policy
  namespace: production
spec:
  endpointSelector:
    matchLabels:
      app: api-server
  ingress:
    # 규칙 1: frontend에서 GET, POST만 허용 (특정 경로)
    - fromEndpoints:
        - matchLabels:
            app: frontend
      toPorts:
        - ports:
            - port: "8080"
              protocol: TCP
          rules:
            http:
              - method: GET
                path: "/api/v1/products"
              - method: GET
                path: "/api/v1/products/[0-9]+"   # 정규표현식 지원
              - method: POST
                path: "/api/v1/orders"
                headers:
                  - 'Content-Type: application/json'
    # 규칙 2: monitoring에서 헬스 체크만 허용
    - fromEndpoints:
        - matchLabels:
            app: monitoring
      toPorts:
        - ports:
            - port: "8080"
              protocol: TCP
          rules:
            http:
              - method: GET
                path: "/healthz"
              - method: GET
                path: "/metrics"
  egress:
    # 규칙 3: database로의 통신만 허용
    - toEndpoints:
        - matchLabels:
            app: postgres
      toPorts:
        - ports:
            - port: "5432"
              protocol: TCP
    # 규칙 4: DNS 조회 허용 (필수)
    - toEndpoints:
        - matchLabels:
            k8s:io.kubernetes.pod.namespace: kube-system
            k8s-app: kube-dns
      toPorts:
        - ports:
            - port: "53"
              protocol: UDP
          rules:
            dns:
              - matchPattern: "*.production.svc.cluster.local"
```

CiliumNetworkPolicy가 표준 NetworkPolicy보다 강화된 점:

| 기능 | 표준 NetworkPolicy | CiliumNetworkPolicy |
|------|-------------------|---------------------|
| L3/L4 필터링 | 지원 | 지원 |
| L7 HTTP 필터링 | 미지원 | method, path, header 필터링 |
| L7 DNS 필터링 | 미지원 | DNS 도메인 기반 필터링 |
| L7 Kafka/gRPC | 미지원 | 프로토콜 인식 필터링 |
| FQDN 기반 egress | 미지원 | toFQDNs로 외부 도메인 제어 |
| 클러스터 범위 정책 | 미지원 | CiliumClusterwideNetworkPolicy |

**검증 명령어:**

```bash
# CiliumNetworkPolicy 적용 확인
kubectl get cnp -n production
# 기대 출력:
# NAME             AGE
# api-l7-policy    30s

# 정책 상세 확인
kubectl describe cnp api-l7-policy -n production
# 기대 출력: Ingress/Egress 규칙이 L7 HTTP 필터와 함께 표시된다

# Hubble CLI로 트래픽 흐름 모니터링 (Cilium Hubble이 설치된 경우)
hubble observe --namespace production --pod api-server --protocol http
# 기대 출력: 허용/거부된 HTTP 요청이 실시간으로 표시된다

# L7 정책 테스트: 허용된 경로 (성공해야 한다)
kubectl exec -n production -l app=frontend -- \
  curl -s http://api-server:8080/api/v1/products
# 기대 출력: 200 OK 응답

# L7 정책 테스트: 허용되지 않은 경로 (차단되어야 한다)
kubectl exec -n production -l app=frontend -- \
  curl -s http://api-server:8080/admin
# 기대 출력: 403 Forbidden 또는 연결 거부

# Cilium 엔드포인트 상태에서 정책 적용 확인
kubectl exec -n kube-system -l k8s-app=cilium -- \
  cilium endpoint list | grep api-server
# 기대 출력: 해당 엔드포인트에 정책이 적용된 상태(Enabled)가 표시된다
```

---

## Part 3: 개념별 확인 문제 (40문항)

### Overview of Cloud Native Security (6문항)

#### 문제 1.
4C 보안 모델에서 Code 계층의 보안 범위에 해당하지 않는 것은?

A) 애플리케이션의 입력 검증(Input Validation)
B) TLS를 통한 서비스 간 통신 암호화
C) 노드의 OS 패치 및 커널 업데이트
D) 의존성 라이브러리의 취약점 스캔

<details><summary>정답 확인</summary>

**정답: C) 노드의 OS 패치 및 커널 업데이트 ✅**

노드의 OS 패치와 커널 업데이트는 Cloud 계층 또는 Cluster 계층의 인프라 보안에 해당한다. Code 계층은 애플리케이션 소스 코드, 의존성 관리, 시크릿 하드코딩 방지, TLS 통신, 입력 검증 등 개발자가 직접 통제하는 영역이다.

</details>

#### 문제 2.
CNCF Security TAG에서 발행한 Cloud Native Security Whitepaper의 주요 목적은?

A) 특정 보안 제품의 사용법을 안내한다
B) 클라우드 네이티브 환경의 보안 원칙과 모범 사례를 정의한다
C) Kubernetes 인증 시험의 출제 범위를 공지한다
D) CNCF 프로젝트의 라이선스를 규정한다

<details><summary>정답 확인</summary>

**정답: B) 클라우드 네이티브 환경의 보안 원칙과 모범 사례를 정의한다 ✅**

Cloud Native Security Whitepaper는 클라우드 네이티브 환경에서의 보안 라이프사이클(개발, 배포, 런타임), 위협 모델, 보안 보장(Security Assurance) 원칙을 체계적으로 정의한 문서이다. 특정 벤더나 제품에 종속되지 않는 중립적 가이드이다.

</details>

#### 문제 3.
소프트웨어 공급망 보안에서 SLSA(Supply-chain Levels for Software Artifacts) 프레임워크의 Level 3 요구사항으로 올바른 것은?

A) 소스 코드에 대한 코드 리뷰만 수행하면 된다
B) 빌드 프로세스가 격리되고 변조 불가능한 빌드 증명(provenance)을 생성해야 한다
C) 컨테이너 이미지를 private 레지스트리에 저장하면 된다
D) SBOM을 JSON 형식으로 생성하면 된다

<details><summary>정답 확인</summary>

**정답: B) 빌드 프로세스가 격리되고 변조 불가능한 빌드 증명(provenance)을 생성해야 한다 ✅**

SLSA Level 3은 빌드 플랫폼이 보안 강화(hardened)되어야 하며, 빌드가 격리된 환경에서 수행되고, 빌드 증명(provenance)이 변조 불가능해야 한다. Level 1은 빌드 프로세스 문서화, Level 2는 빌드 서비스에서의 provenance 생성을 요구한다. 참고: SLSA v1.0(2023년)에서 레벨 체계가 Level 0~3으로 재구성되어 Level 4는 더 이상 별도 레벨로 존재하지 않는다.

</details>

#### 문제 4.
컨테이너 이미지의 취약점 스캔 도구와 그 특성으로 올바르지 않은 것은?

A) Trivy - OS 패키지와 애플리케이션 의존성 모두 스캔할 수 있다
B) Grype - Anchore에서 개발한 오픈소스 취약점 스캐너이다
C) Clair - CoreOS에서 시작한 정적 분석 기반 취약점 스캐너이다
D) Falco - 이미지 빌드 시 취약점을 스캔하여 리포트를 생성한다

<details><summary>정답 확인</summary>

**정답: D) Falco - 이미지 빌드 시 취약점을 스캔하여 리포트를 생성한다 ✅**

Falco는 이미지 취약점 스캐너가 아니라 런타임 보안 모니터링 도구이다. 커널 시스템 콜을 모니터링하여 컨테이너의 비정상 행위를 실시간 탐지한다. 이미지 취약점 스캔은 Trivy, Grype, Clair, Snyk 등이 담당한다.

</details>

#### 문제 5.
클라우드 네이티브 보안에서 "Defense in Depth(심층 방어)"의 핵심 원칙으로 올바른 것은?

A) 가장 바깥 계층(Cloud)의 보안만 강화하면 내부는 안전하다
B) 각 계층에 독립적인 보안 통제를 적용하여 한 계층의 침해가 전체 침해로 이어지지 않도록 한다
C) 모든 보안 도구를 하나의 계층에 집중 배치한다
D) 가장 안쪽 계층(Code)만 보호하면 외부 공격을 막을 수 있다

<details><summary>정답 확인</summary>

**정답: B) 각 계층에 독립적인 보안 통제를 적용하여 한 계층의 침해가 전체 침해로 이어지지 않도록 한다 ✅**

심층 방어는 여러 계층에 걸쳐 독립적인 보안 통제를 배치하여, 한 계층이 뚫려도 다음 계층이 추가 방어를 제공하는 전략이다. 4C 모델(Cloud, Cluster, Container, Code) 각각에 보안을 적용하는 것이 이 원칙의 실천이다.

</details>

#### 문제 6.
다음 중 CNCF Graduated 프로젝트가 아닌 것은?

A) OPA (Open Policy Agent)
B) Falco
C) Kubescape
D) TUF (The Update Framework)

<details><summary>정답 확인</summary>

**정답: C) Kubescape ✅**

Kubescape는 CNCF Sandbox 프로젝트이다. OPA, Falco, TUF는 모두 CNCF Graduated 프로젝트이다. Kyverno 역시 2024년 7월에 Graduated로 승격되었다. Graduated는 CNCF에서 가장 성숙한 프로젝트 단계로, 광범위한 채택과 보안 감사를 통과했음을 의미한다.

</details>

---

### Kubernetes Cluster Component Security (9문항)

#### 문제 7.
API Server의 admission control 단계에서 OPA Gatekeeper와 Kyverno는 어떤 유형의 webhook으로 동작하는가?

A) Mutating Admission Webhook으로만 동작한다
B) Validating Admission Webhook으로만 동작한다
C) Mutating과 Validating 양쪽 모두로 동작할 수 있다
D) API Server 내장 Admission Controller로 동작한다

<details><summary>정답 확인</summary>

**정답: C) Mutating과 Validating 양쪽 모두로 동작할 수 있다 ✅**

OPA Gatekeeper는 주로 Validating Webhook으로 동작하지만, Mutating Webhook 기능도 지원한다(Gatekeeper v3.10+의 mutation 기능). Kyverno는 validate, mutate, generate 규칙에 따라 Mutating과 Validating 양쪽 Webhook으로 등록되어 동작한다.

</details>

#### 문제 8.
etcd의 Encryption at Rest 설정에서 `providers` 배열의 순서가 중요한 이유는?

A) 모든 프로바이더가 동시에 데이터를 암호화하기 때문이다
B) 첫 번째 프로바이더가 새 데이터의 암호화에 사용되고, 나머지는 기존 데이터의 복호화에만 사용되기 때문이다
C) 마지막 프로바이더가 가장 높은 우선순위를 가지기 때문이다
D) 순서와 관계없이 항상 가장 안전한 프로바이더가 자동 선택되기 때문이다

<details><summary>정답 확인</summary>

**정답: B) 첫 번째 프로바이더가 새 데이터의 암호화에 사용되고, 나머지는 기존 데이터의 복호화에만 사용되기 때문이다 ✅**

EncryptionConfiguration의 `providers` 배열에서 첫 번째 프로바이더가 새로 저장되는 데이터의 암호화에 사용된다. 나머지 프로바이더는 기존 데이터를 복호화할 때만 사용된다. 따라서 키 로테이션 시 새 키를 첫 번째 위치에 배치해야 한다.

</details>

#### 문제 9.
Kubernetes audit 로그에서 Secret 리소스에 대한 감사 수준을 `Metadata`로 설정하는 주된 이유는?

A) Secret의 생성 시간만 기록하기 위해서이다
B) Secret의 실제 데이터가 감사 로그에 노출되는 것을 방지하면서도 접근 기록을 남기기 위해서이다
C) Metadata 수준이 가장 상세한 로깅이기 때문이다
D) Secret에 대해서는 RequestResponse 수준이 지원되지 않기 때문이다

<details><summary>정답 확인</summary>

**정답: B) Secret의 실제 데이터가 감사 로그에 노출되는 것을 방지하면서도 접근 기록을 남기기 위해서이다 ✅**

Secret에 대해 `RequestResponse` 수준을 사용하면 Secret의 실제 값이 감사 로그에 기록되어 오히려 보안 위험이 된다. `Metadata` 수준은 누가, 언제, 어떤 Secret에 접근했는지만 기록하고 데이터 본문은 제외하므로, 보안과 감사의 균형을 맞출 수 있다.

</details>

#### 문제 10.
ValidatingAdmissionPolicy(Kubernetes 1.28+)의 특징으로 올바른 것은?

A) Rego 언어로 정책을 작성한다
B) CEL(Common Expression Language) 표현식으로 검증 규칙을 인라인 정의한다
C) 외부 webhook 서버가 반드시 필요하다
D) Mutating 기능만 제공한다

<details><summary>정답 확인</summary>

**정답: B) CEL(Common Expression Language) 표현식으로 검증 규칙을 인라인 정의한다 ✅**

ValidatingAdmissionPolicy는 Kubernetes 내장 기능으로, CEL 표현식을 사용하여 별도의 webhook 서버 없이 검증 정책을 정의할 수 있다. 외부 프로세스에 의존하지 않으므로 지연 시간이 적고 가용성 문제가 없다. OPA Gatekeeper나 Kyverno의 대안이 될 수 있다.

</details>

#### 문제 11.
Kubernetes 1.24 이후 ServiceAccount 토큰의 변경 사항으로 올바른 것은?

A) ServiceAccount 토큰이 더 이상 생성되지 않는다
B) TokenRequest API를 통해 시간 제한이 있는 바운드 토큰(Bound Token)이 발급된다
C) 모든 토큰이 OIDC 프로바이더에서 발급된다
D) 토큰이 etcd에 암호화되어 저장된다

<details><summary>정답 확인</summary>

**정답: B) TokenRequest API를 통해 시간 제한이 있는 바운드 토큰(Bound Token)이 발급된다 ✅**

Kubernetes 1.24부터 ServiceAccount에 대한 자동 Secret 생성이 중단되었다. 대신 TokenRequest API를 통해 만료 시간(기본 1시간), 대상(audience), 바인딩 대상(Pod 등)이 지정된 바운드 토큰이 발급된다. 이는 유출 시 피해를 최소화하기 위한 보안 강화이다.

</details>

#### 문제 12.
kube-apiserver의 `--authorization-mode=Node,RBAC` 설정에서 Node 인가 모드의 역할은?

A) 모든 노드에 클러스터 관리자 권한을 부여한다
B) kubelet이 자신의 노드에 스케줄된 Pod 관련 리소스만 접근할 수 있도록 제한한다
C) 노드 간 통신을 암호화한다
D) 노드의 IP 주소 기반으로 인가를 결정한다

<details><summary>정답 확인</summary>

**정답: B) kubelet이 자신의 노드에 스케줄된 Pod 관련 리소스만 접근할 수 있도록 제한한다 ✅**

Node 인가 모드는 NodeRestriction admission plugin과 함께 사용하여, kubelet이 자신이 관리하는 노드와 해당 노드에 스케줄된 Pod에 관련된 리소스만 접근할 수 있도록 제한한다. 한 노드의 kubelet이 다른 노드의 Secret이나 Pod 정보에 접근하는 것을 방지한다.

</details>

#### 문제 13.
API Server로의 요청이 인증-인가-Admission Control 단계를 모두 통과한 후 etcd에 저장되기 전에 수행되는 추가 단계는?

A) NetworkPolicy 평가
B) 오브젝트 스키마 검증(Schema Validation)
C) Pod 스케줄링
D) 컨테이너 이미지 풀

<details><summary>정답 확인</summary>

**정답: B) 오브젝트 스키마 검증(Schema Validation) ✅**

전체 처리 순서는 인증(Authentication) → 인가(Authorization) → Mutating Admission → 오브젝트 스키마 검증(Schema Validation) → Validating Admission → etcd 저장이다. 스키마 검증은 리소스가 API 스키마에 부합하는지 확인하는 단계이다.

</details>

#### 문제 14.
Kubernetes 인증서를 `kubeadm certs renew all`로 갱신한 후 반드시 수행해야 하는 작업은?

A) etcd 데이터를 삭제한다
B) 컨트롤 플레인의 static Pod를 재시작한다
C) 모든 워커 노드를 클러스터에서 제거한다
D) NetworkPolicy를 재적용한다

<details><summary>정답 확인</summary>

**정답: B) 컨트롤 플레인의 static Pod를 재시작한다 ✅**

인증서 갱신 후 API Server, Controller Manager, Scheduler 등의 컨트롤 플레인 컴포넌트가 새 인증서를 로드하도록 재시작해야 한다. kubeadm 환경에서는 `/etc/kubernetes/manifests/` 디렉터리의 static pod 매니페스트 파일을 갱신하거나, kubelet이 자동으로 변경을 감지하여 재시작한다.

</details>

#### 문제 15.
다음 중 etcd 접근을 제한하는 방법으로 올바르지 않은 것은?

A) etcd를 API Server만 접근 가능한 별도의 네트워크 세그먼트에 배치한다
B) etcd 클라이언트 인증서를 API Server에만 발급한다
C) etcd 포트(2379, 2380)에 대한 방화벽 규칙을 설정한다
D) etcd에 RBAC를 적용하여 Kubernetes Role로 접근을 제어한다

<details><summary>정답 확인</summary>

**정답: D) etcd에 RBAC를 적용하여 Kubernetes Role로 접근을 제어한다 ✅**

Kubernetes RBAC는 API Server 레벨의 인가 메커니즘이며, etcd 자체에 직접 적용되지 않는다. etcd 접근 제어는 TLS 클라이언트 인증, 네트워크 격리, 방화벽 규칙으로 수행한다. etcd에 직접 접근할 수 있는 주체는 API Server뿐이어야 한다.

</details>

---

### Kubernetes Security Fundamentals (9문항)

#### 문제 16.
Kyverno 정책에서 `validationFailureAction: Audit`과 `validationFailureAction: Enforce`의 차이는?

A) Audit은 위반을 감사 로그에만 기록하고, Enforce는 리소스 생성을 거부한다
B) Audit은 리소스를 수정하고, Enforce는 삭제한다
C) 둘 다 리소스 생성을 거부하되 로그 수준만 다르다
D) Audit은 경고를 표시하고, Enforce는 알림을 전송한다

<details><summary>정답 확인</summary>

**정답: A) Audit은 위반을 감사 로그에만 기록하고, Enforce는 리소스 생성을 거부한다 ✅**

`Audit` 모드는 정책 위반 시 리소스 생성을 허용하되 위반 사항을 기록한다. 기존 워크로드에 정책을 점진적으로 적용할 때 유용하다. `Enforce` 모드는 위반 시 리소스 생성을 거부한다. 프로덕션에서는 충분한 테스트 후 Enforce를 적용하는 것이 권장된다.

</details>

#### 문제 17.
NetworkPolicy에서 `policyTypes`에 Ingress만 지정하고 `ingress` 규칙을 비워두면(규칙 없이) 어떤 결과가 발생하는가?

A) 모든 인바운드 트래픽이 허용된다
B) 모든 인바운드 트래픽이 차단된다
C) 인바운드와 아웃바운드 모두 차단된다
D) NetworkPolicy가 무시된다

<details><summary>정답 확인</summary>

**정답: B) 모든 인바운드 트래픽이 차단된다 ✅**

`policyTypes`에 Ingress가 포함되어 있지만 `ingress` 규칙이 비어있으면, 해당 Pod으로의 모든 인바운드 트래픽이 차단된다. 이것이 "default deny ingress" 정책의 원리이다. Egress는 policyTypes에 포함되지 않았으므로 영향 없이 허용된다.

</details>

#### 문제 18.
RBAC에서 `escalate` verb의 의미는?

A) Pod의 리소스 사용량을 증가시킨다
B) Role 또는 ClusterRole에 자신이 가지지 않은 권한을 추가할 수 있다
C) 네임스페이스를 다른 네임스페이스로 이동한다
D) ServiceAccount의 토큰을 갱신한다

<details><summary>정답 확인</summary>

**정답: B) Role 또는 ClusterRole에 자신이 가지지 않은 권한을 추가할 수 있다 ✅**

`escalate` verb는 사용자가 Role 또는 ClusterRole 오브젝트를 수정하여 자신이 현재 갖지 않은 권한을 추가할 수 있게 한다. 이는 매우 위험한 권한이므로 반드시 최소한의 주체에게만 부여해야 한다. `bind` verb(RoleBinding을 통해 권한 부여)도 마찬가지로 위험하다.

</details>

#### 문제 19.
External Secrets Operator에서 `refreshInterval: 1h` 설정의 의미는?

A) 외부 비밀 저장소의 토큰을 1시간마다 갱신한다
B) Kubernetes Secret을 1시간마다 외부 저장소와 동기화하여 최신 값으로 업데이트한다
C) ExternalSecret 리소스를 1시간 후에 삭제한다
D) 외부 저장소 연결을 1시간 동안 유지한다

<details><summary>정답 확인</summary>

**정답: B) Kubernetes Secret을 1시간마다 외부 저장소와 동기화하여 최신 값으로 업데이트한다 ✅**

`refreshInterval`은 ESO가 외부 비밀 저장소에서 값을 가져와 Kubernetes Secret을 업데이트하는 주기이다. 외부 저장소에서 비밀이 변경되면 다음 동기화 주기에 Kubernetes Secret에 반영된다. 이를 통해 수동 개입 없이 Secret 로테이션이 가능하다.

</details>

#### 문제 20.
`kubectl auth can-i --list --as=system:serviceaccount:default:my-sa -n production` 명령의 동작은?

A) my-sa ServiceAccount를 삭제한다
B) default 네임스페이스의 my-sa ServiceAccount가 production 네임스페이스에서 가진 모든 권한 목록을 조회한다
C) production 네임스페이스의 모든 ServiceAccount를 나열한다
D) my-sa ServiceAccount에 production 네임스페이스 접근 권한을 부여한다

<details><summary>정답 확인</summary>

**정답: B) default 네임스페이스의 my-sa ServiceAccount가 production 네임스페이스에서 가진 모든 권한 목록을 조회한다 ✅**

`--as` 플래그는 impersonation(가장)을 통해 특정 주체의 관점에서 권한을 확인한다. `--list`는 해당 주체의 모든 권한을 나열한다. ServiceAccount는 `system:serviceaccount:<namespace>:<name>` 형식으로 지정한다. 이 명령은 내부적으로 SelfSubjectRulesReview API를 호출한다.

</details>

#### 문제 21.
Falco의 규칙에서 `priority` 필드가 `CRITICAL`로 설정된 경우의 의미는?

A) 규칙이 비활성화된다
B) 경보가 즉시 자동으로 해결된다
C) 탐지된 이벤트의 심각도가 매우 높아 즉각 대응이 필요하다
D) 규칙이 다른 모든 규칙보다 먼저 평가된다

<details><summary>정답 확인</summary>

**정답: C) 탐지된 이벤트의 심각도가 매우 높아 즉각 대응이 필요하다 ✅**

Falco의 priority는 탐지된 이벤트의 심각도를 나타내며, EMERGENCY > ALERT > CRITICAL > ERROR > WARNING > NOTICE > INFO > DEBUG 순서이다. CRITICAL은 시스템에 심각한 보안 위협이 감지되었음을 의미한다. priority는 평가 순서와 무관하며, 모든 규칙은 이벤트에 대해 평가된다.

</details>

#### 문제 22.
Secret 암호화에서 KMS v2 프로바이더가 로컬 키(aescbc) 대비 갖는 장점이 아닌 것은?

A) DEK(Data Encryption Key)와 KEK(Key Encryption Key) 분리
B) 하드웨어 보안 모듈(HSM) 기반 키 보호
C) API Server 설정 파일에 암호화 키가 평문으로 저장되지 않음
D) 암호화 키 없이도 etcd 데이터를 복호화할 수 있음

<details><summary>정답 확인</summary>

**정답: D) 암호화 키 없이도 etcd 데이터를 복호화할 수 있음 ✅**

KMS를 사용해도 적절한 키 없이 etcd 데이터를 복호화하는 것은 불가능하다. 오히려 KMS의 장점은 키 관리를 더 안전하게 하는 것이다. DEK/KEK 분리, HSM 지원, KMS에서의 자동 키 로테이션, API Server 설정 파일에 평문 키를 두지 않는 것이 KMS의 핵심 이점이다.

</details>

#### 문제 23.
OPA Gatekeeper에서 `spec.enforcementAction: dryrun`으로 설정된 Constraint의 동작은?

A) 리소스 생성을 거부하고 경고를 표시한다
B) 리소스 생성을 허용하되 정책 위반을 Constraint의 status에 기록한다
C) Constraint 자체가 비활성화된다
D) Rego 코드를 실행하지 않는다

<details><summary>정답 확인</summary>

**정답: B) 리소스 생성을 허용하되 정책 위반을 Constraint의 status에 기록한다 ✅**

`dryrun` 모드는 리소스 생성을 허용하면서 정책 위반 여부를 Constraint 리소스의 `status.violations` 필드에 기록한다. 기존 클러스터에 새 정책을 도입할 때 영향 범위를 사전에 파악하는 데 유용하다. 이후 `deny`로 변경하여 실제 차단을 활성화한다.

</details>

#### 문제 24.
Pod Security Standards의 `baseline` 수준에서 허용되지 않는 설정은?

A) `runAsUser: 0` (root 사용자)
B) `hostNetwork: true`
C) `readOnlyRootFilesystem: false`
D) `seccompProfile.type`을 설정하지 않은 경우

<details><summary>정답 확인</summary>

**정답: B) `hostNetwork: true` ✅**

`baseline` 수준은 `hostNetwork`, `hostPID`, `hostIPC`, `privileged` 등 호스트 리소스 공유를 금지한다. 그러나 `runAsUser: 0`(root 실행)은 `restricted` 수준에서만 금지된다. `readOnlyRootFilesystem`은 PSA의 어떤 수준에서도 필수가 아니며, seccomp 프로파일 미설정도 `baseline`에서는 허용된다.

</details>

---

### Kubernetes Threat Model (6문항)

#### 문제 25.
STRIDE 위협 모델에서 "Tampering(변조)"에 해당하는 Kubernetes 위협 시나리오는?

A) 공격자가 다른 사용자의 ServiceAccount 토큰을 탈취하여 API Server에 접근한다
B) 공격자가 etcd에 직접 접근하여 Deployment의 이미지를 악성 이미지로 변경한다
C) 공격자가 Pod에서 대량의 요청을 보내 API Server를 과부하시킨다
D) 공격자가 감사 로그를 비활성화하여 자신의 행위를 숨긴다

<details><summary>정답 확인</summary>

**정답: B) 공격자가 etcd에 직접 접근하여 Deployment의 이미지를 악성 이미지로 변경한다 ✅**

Tampering은 데이터나 코드를 무단으로 변경하는 것이다. etcd의 데이터를 직접 수정하거나, 컨테이너 이미지를 변조하거나, ConfigMap/Secret을 변경하는 것이 해당한다. A는 Spoofing, C는 Denial of Service, D는 Repudiation에 해당한다.

</details>

#### 문제 26.
MITRE ATT&CK for Containers 프레임워크에서 "Initial Access(초기 접근)" 전술에 해당하는 공격 기법은?

A) 컨테이너에서 호스트 파일시스템에 접근한다
B) 취약한 애플리케이션이 실행 중인 노출된 서비스를 통해 클러스터에 침입한다
C) DaemonSet을 생성하여 모든 노드에 악성 코드를 배포한다
D) ServiceAccount 토큰을 사용하여 클러스터 내부에서 횡적 이동한다

<details><summary>정답 확인</summary>

**정답: B) 취약한 애플리케이션이 실행 중인 노출된 서비스를 통해 클러스터에 침입한다 ✅**

Initial Access는 공격자가 처음으로 클러스터에 접근하는 단계이다. 노출된 취약한 서비스, 공개된 Kubernetes 대시보드, 유출된 kubeconfig 파일 등이 해당한다. A는 Privilege Escalation, C는 Execution/Persistence, D는 Lateral Movement 전술에 해당한다.

</details>

#### 문제 27.
Kubernetes 환경에서 "Lateral Movement(횡적 이동)"을 방지하기 위한 가장 효과적인 통제는?

A) Pod에 리소스 제한(resource limits)을 설정한다
B) NetworkPolicy로 Pod 간 통신을 최소한으로 제한한다
C) 모든 Pod에 readinessProbe를 설정한다
D) 컨테이너 이미지의 크기를 최소화한다

<details><summary>정답 확인</summary>

**정답: B) NetworkPolicy로 Pod 간 통신을 최소한으로 제한한다 ✅**

횡적 이동은 공격자가 하나의 Pod를 침해한 후 네트워크를 통해 다른 Pod나 서비스로 이동하는 것이다. default-deny NetworkPolicy를 적용하고 필요한 통신만 명시적으로 허용하면 횡적 이동 범위를 크게 줄일 수 있다. RBAC와 ServiceAccount 권한 최소화도 함께 적용해야 한다.

</details>

#### 문제 28.
컨테이너 런타임에서 `privileged: true`가 위험한 이유로 올바르지 않은 것은?

A) 호스트의 모든 디바이스(/dev)에 접근할 수 있다
B) 모든 Linux Capabilities가 부여된다
C) seccomp 프로파일이 자동으로 Unconfined로 설정된다
D) 컨테이너의 네트워크 대역폭이 무제한으로 설정된다

<details><summary>정답 확인</summary>

**정답: D) 컨테이너의 네트워크 대역폭이 무제한으로 설정된다 ✅**

privileged 모드의 위험은 호스트 디바이스 접근, 모든 Linux Capabilities 부여, seccomp/AppArmor 비활성화, 호스트 PID/네트워크 네임스페이스 접근 가능 등이다. 네트워크 대역폭은 privileged 모드와 직접적인 관련이 없으며, QoS와 네트워크 제한은 별도의 메커니즘이다.

</details>

#### 문제 29.
Kubernetes 환경에서 Falco가 탐지할 수 있는 런타임 위협이 아닌 것은?

A) 컨테이너에서 예상치 못한 셸 프로세스 실행
B) 민감한 파일(/etc/shadow)에 대한 읽기 시도
C) 컨테이너 이미지에 포함된 CVE 취약점
D) 컨테이너에서 네트워크 리스닝 포트 변경

<details><summary>정답 확인</summary>

**정답: C) 컨테이너 이미지에 포함된 CVE 취약점 ✅**

Falco는 런타임(실행 시점)에 시스템 콜을 모니터링하여 비정상 행위를 탐지한다. 이미지에 포함된 정적 취약점(CVE)은 Trivy, Grype 같은 이미지 스캐너가 빌드/배포 단계에서 탐지해야 한다. Falco는 프로세스 실행, 파일 접근, 네트워크 활동 등 실행 시점의 행위를 감시한다.

</details>

#### 문제 30.
STRIDE 모델에서 "Repudiation(부인)"에 대한 Kubernetes의 주요 대응 방안은?

A) NetworkPolicy 적용
B) Pod Security Standards 적용
C) Audit 로그 활성화 및 불변 저장소에 보관
D) 이미지 서명 검증

<details><summary>정답 확인</summary>

**정답: C) Audit 로그 활성화 및 불변 저장소에 보관 ✅**

Repudiation은 행위자가 자신의 행동을 부인하는 위협이다. 이를 방지하려면 모든 API 요청에 대한 감사 로그를 활성화하고, 로그를 변조 불가능한 저장소(WORM 스토리지, 별도 로그 서버 등)에 보관해야 한다. 로그에는 행위자, 시간, 대상 리소스, 수행 작업이 포함된다.

</details>

---

### Platform Security (6문항)

#### 문제 31.
gVisor(runsc)와 Kata Containers의 공통된 보안 목적은?

A) 이미지 취약점을 자동으로 수정한다
B) 컨테이너와 호스트 커널 사이에 추가 격리 계층을 제공한다
C) NetworkPolicy를 자동으로 생성한다
D) Secret을 자동으로 암호화한다

<details><summary>정답 확인</summary>

**정답: B) 컨테이너와 호스트 커널 사이에 추가 격리 계층을 제공한다 ✅**

일반 컨테이너는 호스트 커널을 직접 공유하므로 커널 취약점을 통한 탈출 위험이 있다. gVisor는 사용자 공간에서 커널 시스템 콜을 중재하는 방식으로, Kata Containers는 경량 VM을 사용하는 방식으로 호스트 커널과의 직접 상호작용을 차단한다.

</details>

#### 문제 32.
Istio 서비스 메시에서 AuthorizationPolicy의 `action: DENY` 규칙의 특징은?

A) ALLOW 규칙보다 나중에 평가된다
B) DENY 규칙이 ALLOW 규칙보다 우선하여 먼저 평가된다
C) DENY와 ALLOW가 동시에 매칭되면 ALLOW가 우선한다
D) DENY 규칙은 메시 외부 트래픽에만 적용된다

<details><summary>정답 확인</summary>

**정답: B) DENY 규칙이 ALLOW 규칙보다 우선하여 먼저 평가된다 ✅**

Istio AuthorizationPolicy의 평가 순서는 CUSTOM → DENY → ALLOW이다. DENY 규칙에 매칭되면 ALLOW 규칙의 존재 여부와 관계없이 요청이 거부된다. 이를 통해 특정 경로나 소스에 대한 명시적 차단이 가능하다.

</details>

#### 문제 33.
CIS Kubernetes Benchmark에서 검사하는 항목이 아닌 것은?

A) API Server의 인증 및 인가 설정
B) etcd의 TLS 및 접근 제어 설정
C) 애플리케이션 코드의 SQL Injection 취약점
D) kubelet의 보안 설정

<details><summary>정답 확인</summary>

**정답: C) 애플리케이션 코드의 SQL Injection 취약점 ✅**

CIS Kubernetes Benchmark는 Kubernetes 클러스터 컴포넌트의 보안 설정을 검사하는 표준이다. API Server, etcd, kubelet, Controller Manager, Scheduler 등의 설정과 RBAC, Pod Security, 네트워크 정책 등을 검사한다. 애플리케이션 코드 레벨의 취약점은 범위에 포함되지 않는다.

</details>

#### 문제 34.
Cilium CNI가 eBPF를 기반으로 제공하는 보안 기능이 아닌 것은?

A) L7 프로토콜 인식 네트워크 정책
B) 투명한 암호화(WireGuard/IPsec)
C) 자동 RBAC Role 생성
D) DNS 기반 네트워크 정책(toFQDNs)

<details><summary>정답 확인</summary>

**정답: C) 자동 RBAC Role 생성 ✅**

Cilium은 eBPF를 활용하여 L3/L4/L7 네트워크 정책, WireGuard/IPsec 기반 투명 암호화, DNS 기반 egress 제어, Hubble을 통한 네트워크 가시성 등을 제공한다. RBAC는 Kubernetes API Server의 인가 메커니즘이며 CNI 플러그인의 기능 범위가 아니다.

</details>

#### 문제 35.
Kubernetes에서 RuntimeClass를 사용하는 목적은?

A) Pod의 런타임 시간 제한을 설정한다
B) Pod에 다른 컨테이너 런타임(gVisor, Kata 등)을 지정할 수 있도록 한다
C) 컨테이너의 환경 변수를 자동 주입한다
D) Pod의 네트워크 모드를 설정한다

<details><summary>정답 확인</summary>

**정답: B) Pod에 다른 컨테이너 런타임(gVisor, Kata 등)을 지정할 수 있도록 한다 ✅**

RuntimeClass는 Pod가 사용할 컨테이너 런타임 핸들러를 지정하는 리소스이다. 보안에 민감한 워크로드는 gVisor(runsc)나 Kata Containers 같은 강화된 런타임을 사용하고, 일반 워크로드는 기본 runc를 사용하는 식으로 워크로드별 격리 수준을 차별화할 수 있다.

</details>

#### 문제 36.
SPIFFE/SPIRE가 Kubernetes 환경에서 제공하는 보안 기능은?

A) 이미지 취약점 스캔
B) 워크로드에 대한 암호학적 신원(identity) 발급 및 mTLS 인증
C) 네트워크 패킷 필터링
D) 감사 로그 분석

<details><summary>정답 확인</summary>

**정답: B) 워크로드에 대한 암호학적 신원(identity) 발급 및 mTLS 인증 ✅**

SPIFFE(Secure Production Identity Framework For Everyone)는 워크로드에 대한 보편적 신원 표준이며, SPIRE는 그 구현체이다. 각 워크로드에 SVID(SPIFFE Verifiable Identity Document)를 발급하여 서비스 간 상호 인증(mTLS)을 수행할 수 있다. CNCF Graduated 프로젝트이다.

</details>

---

### Compliance and Security Frameworks (4문항)

#### 문제 37.
CIS Benchmark 점검을 자동화하는 도구로 가장 적합한 것은?

A) Helm
B) kube-bench
C) kubectl
D) ArgoCD

<details><summary>정답 확인</summary>

**정답: B) kube-bench ✅**

kube-bench는 CIS Kubernetes Benchmark에 정의된 점검 항목을 자동으로 실행하고 결과를 리포트하는 도구이다. API Server, etcd, kubelet, Controller Manager 등의 설정을 CIS 표준과 비교하여 Pass/Fail/Warn 결과를 제공한다. Aqua Security에서 개발한 오픈소스 도구이다.

</details>

#### 문제 38.
Kubernetes 보안 컨텍스트에서 Compliance as Code의 의미는?

A) 보안 규정을 수동으로 문서화한다
B) 규정 준수 요구사항을 자동화된 정책 코드로 정의하고 클러스터에 적용한다
C) 소스 코드에 보안 주석을 추가한다
D) 모든 코드를 암호화하여 저장한다

<details><summary>정답 확인</summary>

**정답: B) 규정 준수 요구사항을 자동화된 정책 코드로 정의하고 클러스터에 적용한다 ✅**

Compliance as Code는 규정 준수 요구사항(CIS Benchmark, SOC 2, PCI DSS 등)을 OPA Gatekeeper, Kyverno 같은 정책 엔진의 코드로 표현하여, 규정 위반을 자동으로 탐지하고 차단하는 접근법이다. Git으로 버전 관리되어 감사 추적이 용이하다.

</details>

#### 문제 39.
SOC 2(Service Organization Control 2) Type II 감사에서 Kubernetes 환경과 관련된 통제 영역이 아닌 것은?

A) 시스템의 가용성(Availability)
B) 데이터의 기밀성(Confidentiality)
C) 컨테이너 이미지의 빌드 성능(Build Performance)
D) 변경 관리(Change Management)

<details><summary>정답 확인</summary>

**정답: C) 컨테이너 이미지의 빌드 성능(Build Performance) ✅**

SOC 2는 보안(Security), 가용성(Availability), 처리 무결성(Processing Integrity), 기밀성(Confidentiality), 프라이버시(Privacy)의 5가지 신뢰 서비스 기준(TSC)을 평가한다. 빌드 성능은 보안 규정과 무관하며, 변경 관리, 접근 통제, 로깅/모니터링 등이 핵심 통제 영역이다.

</details>

#### 문제 40.
PCI DSS 규정 준수를 위해 Kubernetes 환경에서 반드시 구현해야 하는 통제가 아닌 것은?

A) 네트워크 세그멘테이션(NetworkPolicy를 통한 카드 데이터 환경 격리)
B) 전송 중 데이터 암호화(mTLS)
C) 감사 로그의 최소 1년 보관
D) 모든 Pod를 privileged 모드로 실행

<details><summary>정답 확인</summary>

**정답: D) 모든 Pod를 privileged 모드로 실행 ✅**

PCI DSS는 카드 데이터 환경(CDE)의 보호를 위해 네트워크 격리, 데이터 암호화, 접근 제어, 감사 로그 등을 요구한다. privileged 모드 실행은 PCI DSS 요구사항에 정반대되는 설정이며, 최소 권한 원칙 위반이다. PCI DSS는 감사 로그의 최소 1년 보관(3개월 즉시 접근 가능)을 요구한다.

</details>

---

## Part 4: 기출 유형 덤프 문제 (30문항)

### 문제 1.
4C 보안 모델에서 Kubernetes NetworkPolicy는 어느 계층에 해당하는가?

A) Code
B) Container
C) Cluster
D) Cloud

<details><summary>정답 확인</summary>

**정답: C) Cluster ✅**

NetworkPolicy는 Kubernetes 클러스터 레벨에서 Pod 간 네트워크 트래픽을 제어하는 리소스이므로 Cluster 계층에 해당한다. Container 계층은 이미지 보안, seccomp 등 컨테이너 자체의 보안이고, Cloud 계층은 인프라 방화벽이다.

</details>

### 문제 2.
STRIDE 프레임워크에서 각 위협 유형과 Kubernetes 대응 방안의 연결이 올바르지 않은 것은?

A) Spoofing → 강력한 인증(X.509, OIDC)
B) Tampering → 이미지 서명(cosign), etcd 암호화
C) Information Disclosure → RBAC, Secret 암호화
D) Denial of Service → privileged 모드 활성화

<details><summary>정답 확인</summary>

**정답: D) Denial of Service → privileged 모드 활성화 ✅**

Denial of Service에 대한 올바른 대응은 ResourceQuota, LimitRange, Pod 리소스 제한(requests/limits), API Priority and Fairness 등이다. privileged 모드는 오히려 보안을 약화시켜 DoS 공격 가능성을 높인다.

</details>

### 문제 3.
Kubernetes API Server의 인증(Authentication) 단계에서 여러 인증 모듈이 구성되어 있을 때의 동작은?

A) 모든 인증 모듈을 순차적으로 통과해야 한다
B) 하나의 인증 모듈이라도 성공하면 인증이 완료된다
C) 마지막 인증 모듈의 결과만 사용한다
D) 가장 제한적인 인증 모듈의 결과만 사용한다

<details><summary>정답 확인</summary>

**정답: B) 하나의 인증 모듈이라도 성공하면 인증이 완료된다 ✅**

API Server의 인증 단계에서는 여러 인증 모듈(X.509, Bearer Token, OIDC 등)이 OR 관계로 평가된다. 하나의 모듈이 요청을 인증하면 나머지 모듈은 건너뛴다. 모든 모듈이 인증에 실패하면 401 Unauthorized가 반환된다.

</details>

### 문제 4.
API Server의 `--authorization-mode=Node,RBAC` 설정에서 인가 모듈의 평가 순서와 동작은?

A) Node와 RBAC가 모두 허용해야 요청이 승인된다
B) Node 모듈이 먼저 평가되고, 결정하지 못하면 RBAC로 넘어간다
C) RBAC가 먼저 평가되고, Node는 무시된다
D) 두 모듈이 병렬로 평가되어 하나라도 거부하면 거부된다

<details><summary>정답 확인</summary>

**정답: B) Node 모듈이 먼저 평가되고, 결정하지 못하면 RBAC로 넘어간다 ✅**

인가 모듈은 설정된 순서대로 평가된다. 각 모듈은 허용(allow), 거부(deny), 의견 없음(no opinion)을 반환할 수 있다. 하나의 모듈이 허용하면 즉시 승인되고, 의견이 없으면 다음 모듈로 넘어간다. 모든 모듈이 의견이 없으면 기본 거부된다.

</details>

### 문제 5.
Pod Security Standards에서 `restricted` 수준이 `baseline` 수준에 추가로 요구하는 설정이 아닌 것은?

A) `runAsNonRoot: true`
B) `seccompProfile.type: RuntimeDefault` 또는 `Localhost`
C) `readOnlyRootFilesystem: true`
D) `allowPrivilegeEscalation: false`

<details><summary>정답 확인</summary>

**정답: C) `readOnlyRootFilesystem: true` ✅**

`restricted` 수준은 `baseline`의 모든 제한에 더해 `runAsNonRoot`, `allowPrivilegeEscalation: false`, `capabilities.drop: ALL`, `seccompProfile` 설정을 요구한다. `readOnlyRootFilesystem`은 보안 모범 사례이지만 PSA restricted 수준의 필수 요구사항이 아니다.

</details>

### 문제 6.
RBAC에서 다음 중 가장 위험한 권한 조합은?

A) `pods` 리소스에 대한 `get`, `list` verb
B) `secrets` 리소스에 대한 `get`, `list` verb
C) `pods/log` 리소스에 대한 `get` verb
D) `configmaps` 리소스에 대한 `get`, `list` verb

<details><summary>정답 확인</summary>

**정답: B) `secrets` 리소스에 대한 `get`, `list` verb ✅**

Secret에 대한 읽기 권한은 클러스터의 모든 비밀(패스워드, API 키, TLS 인증서 등)에 접근할 수 있으므로 매우 위험하다. 특히 `list`는 네임스페이스의 모든 Secret을 열람할 수 있다. Secret 접근은 RBAC에서 가장 엄격하게 제한해야 하는 리소스이다.

</details>

### 문제 7.
다음 NetworkPolicy에서 `from` 배열 내 두 항목의 논리 관계는 무엇인가?

```yaml
ingress:
  - from:
      - namespaceSelector:
          matchLabels:
            env: production
      - podSelector:
          matchLabels:
            role: frontend
```

A) AND - 두 조건을 모두 만족해야 한다
B) OR - 하나라도 만족하면 허용된다
C) XOR - 정확히 하나만 만족해야 한다
D) NOT - 두 조건 모두 만족하지 않아야 한다

<details><summary>정답 확인</summary>

**정답: B) OR - 하나라도 만족하면 허용된다 ✅**

`from` 배열에서 각 항목(각각 `-`로 시작)은 OR 관계이다. 따라서 "production 네임스페이스의 모든 Pod" 또는 "같은 네임스페이스의 role=frontend Pod"가 허용된다. AND 조건을 만들려면 `namespaceSelector`와 `podSelector`를 하나의 배열 항목(같은 `-`) 아래에 작성해야 한다.

</details>

### 문제 8.
다음 NetworkPolicy에서 `from` 내의 논리 관계는 무엇인가?

```yaml
ingress:
  - from:
      - namespaceSelector:
          matchLabels:
            env: production
        podSelector:
          matchLabels:
            role: frontend
```

A) OR - 하나라도 만족하면 허용된다
B) AND - 두 조건을 모두 만족해야 한다
C) namespaceSelector만 적용되고 podSelector는 무시된다
D) 문법 오류로 NetworkPolicy가 적용되지 않는다

<details><summary>정답 확인</summary>

**정답: B) AND - 두 조건을 모두 만족해야 한다 ✅**

`namespaceSelector`와 `podSelector`가 하나의 배열 항목(같은 `-`) 아래에 있으면 AND 관계이다. "production 네임스페이스"이면서 동시에 "role=frontend 레이블을 가진 Pod"만 허용된다. 이 AND/OR 구분은 KCSA 시험에서 자주 출제되는 핵심 개념이다.

</details>

### 문제 9.
SBOM(Software Bill of Materials)의 주요 표준 형식 두 가지는?

A) JSON과 YAML
B) SPDX와 CycloneDX
C) CSV와 XML
D) Protobuf와 Avro

<details><summary>정답 확인</summary>

**정답: B) SPDX와 CycloneDX ✅**

SPDX(Software Package Data Exchange)는 Linux Foundation 프로젝트로 ISO 표준(ISO/IEC 5962:2021)이다. CycloneDX는 OWASP에서 개발한 경량 SBOM 표준이다. 두 형식 모두 JSON, XML 등 다양한 직렬화 형식을 지원하지만, JSON/YAML 자체는 SBOM 표준이 아니다.

</details>

### 문제 10.
cosign으로 컨테이너 이미지를 서명할 때 사용되는 Sigstore의 핵심 구성요소가 아닌 것은?

A) Rekor - 투명성 로그(Transparency Log)
B) Fulcio - 임시 인증서 발급 CA
C) Trivy - 이미지 취약점 스캔
D) cosign - 이미지 서명/검증 도구

<details><summary>정답 확인</summary>

**정답: C) Trivy - 이미지 취약점 스캔 ✅**

Sigstore 프로젝트의 핵심 구성요소는 cosign(서명/검증), Rekor(투명성 로그, 서명 이벤트의 변조 불가능한 기록), Fulcio(keyless 서명을 위한 임시 인증서 발급 CA)이다. Trivy는 Aqua Security의 취약점 스캐너로 Sigstore 프로젝트에 포함되지 않는다.

</details>

### 문제 11.
SLSA(Supply-chain Levels for Software Artifacts) 프레임워크의 레벨과 요구사항이 올바르게 연결된 것은?

A) Level 1 - 빌드 프로세스가 완전 자동화되고 격리되어야 한다
B) Level 2 - 빌드 서비스에서 provenance(빌드 증명)를 생성해야 한다
C) Level 3 - 소스 코드만 버전 관리하면 된다
D) Level 4 - SBOM 생성만 필요하다

<details><summary>정답 확인</summary>

**정답: B) Level 2 - 빌드 서비스에서 provenance(빌드 증명)를 생성해야 한다 ✅**

SLSA 레벨: Level 1은 빌드 프로세스의 문서화(provenance 존재), Level 2는 호스팅된 빌드 서비스에서의 provenance 생성, Level 3은 보안 강화된 빌드 플랫폼에서의 변조 불가 provenance, Level 4(현재는 Level 3으로 통합됨)은 모든 변경에 대한 이중 리뷰를 요구한다.

</details>

### 문제 12.
MITRE ATT&CK for Containers에서 "Persistence(지속성)" 전술에 해당하는 공격 기법은?

A) kubelet API를 통해 컨테이너에서 명령을 실행한다
B) 악성 DaemonSet을 생성하여 노드가 추가될 때마다 자동으로 악성 코드가 배포되도록 한다
C) ServiceAccount 토큰을 탈취하여 다른 네임스페이스에 접근한다
D) DNS 스푸핑으로 트래픽을 가로챈다

<details><summary>정답 확인</summary>

**정답: B) 악성 DaemonSet을 생성하여 노드가 추가될 때마다 자동으로 악성 코드가 배포되도록 한다 ✅**

Persistence는 공격자가 클러스터에 대한 접근을 유지하는 기법이다. 악성 DaemonSet, CronJob, 백도어가 포함된 이미지, 변조된 admission webhook 등이 해당한다. A는 Execution, C는 Lateral Movement, D는 네트워크 공격에 해당한다.

</details>

### 문제 13.
CIS Kubernetes Benchmark의 주요 검사 카테고리가 아닌 것은?

A) Control Plane Components (API Server, etcd, Controller Manager, Scheduler)
B) Worker Nodes (kubelet, kube-proxy)
C) Policies (RBAC, Pod Security, NetworkPolicy)
D) Application Code Quality (코드 복잡도, 테스트 커버리지)

<details><summary>정답 확인</summary>

**정답: D) Application Code Quality (코드 복잡도, 테스트 커버리지) ✅**

CIS Kubernetes Benchmark는 Control Plane Components, Worker Nodes, Policies(RBAC, PSP/PSA, NetworkPolicy, Secret 관리 등), 그리고 Managed Services 관련 설정을 검사한다. 애플리케이션 코드 품질은 CIS Benchmark의 범위가 아니다.

</details>

### 문제 14.
Falco와 다른 런타임 보안 도구의 비교로 올바르지 않은 것은?

A) Falco는 시스템 콜을 기반으로 탐지하고, Tetragon은 eBPF 기반으로 탐지한다
B) Falco는 탐지(detection)에 집중하고, Tetragon은 탐지와 차단(enforcement)을 모두 지원한다
C) Falco는 CNCF Graduated이고, Tetragon은 Cilium/Isovalent 프로젝트이다
D) Falco는 이미지 빌드 시점에서만 동작하고, Tetragon은 런타임에만 동작한다

<details><summary>정답 확인</summary>

**정답: D) Falco는 이미지 빌드 시점에서만 동작하고, Tetragon은 런타임에만 동작한다 ✅**

Falco와 Tetragon 모두 런타임 보안 도구이다. Falco는 시스템 콜을 모니터링하여 위협을 탐지하고, Tetragon은 eBPF를 사용하여 탐지뿐 아니라 프로세스 차단(kill)까지 수행할 수 있다. Falco도 eBPF 드라이버를 지원한다.

</details>

### 문제 15.
Kubernetes Audit 로그에서 `level: Request`와 `level: RequestResponse`의 차이는?

A) Request는 요청 메타데이터만, RequestResponse는 메타데이터와 요청 본문을 기록한다
B) Request는 메타데이터와 요청 본문을 기록하고, RequestResponse는 추가로 응답 본문도 기록한다
C) Request는 GET 요청만, RequestResponse는 모든 HTTP 메서드를 기록한다
D) 차이가 없으며 동일한 정보를 기록한다

<details><summary>정답 확인</summary>

**정답: B) Request는 메타데이터와 요청 본문을 기록하고, RequestResponse는 추가로 응답 본문도 기록한다 ✅**

Audit 로그 수준: None(기록 안 함) < Metadata(메타데이터만) < Request(메타데이터 + 요청 본문) < RequestResponse(메타데이터 + 요청 본문 + 응답 본문). RequestResponse는 가장 상세하지만 저장 공간과 성능에 영향을 줄 수 있다.

</details>

### 문제 16.
다음 RBAC 설정에서 `dev-user`가 수행할 수 없는 작업은?

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  namespace: development
  name: dev-role
rules:
  - apiGroups: ["apps"]
    resources: ["deployments"]
    verbs: ["get", "list", "create", "update"]
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list", "watch"]
```

A) development 네임스페이스에서 Deployment 생성
B) development 네임스페이스에서 Pod 목록 조회
C) development 네임스페이스에서 Deployment 삭제
D) development 네임스페이스에서 Deployment 업데이트

<details><summary>정답 확인</summary>

**정답: C) development 네임스페이스에서 Deployment 삭제 ✅**

Role의 Deployment에 대한 verb에 `delete`가 포함되어 있지 않다. 허용된 verb는 `get`, `list`, `create`, `update`뿐이다. RBAC는 명시적으로 허용되지 않은 모든 작업을 거부하는 화이트리스트 방식이다.

</details>

### 문제 17.
Pod Security Admission에서 `enforce`, `audit`, `warn` 세 가지 모드를 동시에 사용하는 이유는?

A) 세 모드 중 하나만 활성화되어야 한다
B) enforce로 위반을 차단하고, audit으로 로그에 기록하며, warn으로 사용자에게 즉각 피드백을 제공한다
C) audit 모드만으로 충분하며 다른 모드는 불필요하다
D) warn이 enforce보다 더 강력한 차단 효과가 있다

<details><summary>정답 확인</summary>

**정답: B) enforce로 위반을 차단하고, audit으로 로그에 기록하며, warn으로 사용자에게 즉각 피드백을 제공한다 ✅**

세 모드를 함께 사용하면 다층적 방어가 가능하다. enforce는 위반 Pod 생성을 실제로 차단하고, audit은 감사 로그에 기록하여 컴플라이언스를 지원하며, warn은 `kubectl` 사용자에게 즉시 경고를 표시한다. 또한 enforce와 warn에 다른 수준을 설정하여 점진적 마이그레이션에 활용할 수 있다.

</details>

### 문제 18.
4C 보안 모델에서 Container 계층에 해당하는 보안 통제가 아닌 것은?

A) seccomp 프로파일 적용
B) 컨테이너 이미지 취약점 스캔
C) RBAC Role/ClusterRole 구성
D) 비특권(non-root) 사용자로 실행

<details><summary>정답 확인</summary>

**정답: C) RBAC Role/ClusterRole 구성 ✅**

RBAC는 Kubernetes API Server의 인가 메커니즘으로 Cluster 계층에 해당한다. Container 계층은 이미지 스캔, 최소 기본 이미지(distroless), 비특권 실행, seccomp/AppArmor, 읽기 전용 파일시스템, capabilities drop 등 컨테이너 자체의 보안을 다룬다.

</details>

### 문제 19.
Kubernetes에서 `automountServiceAccountToken: false`를 설정하는 이유는?

A) Pod의 시작 시간을 단축하기 위해
B) Pod가 API Server에 불필요하게 접근하는 것을 방지하여 공격 표면을 줄이기 위해
C) ServiceAccount 토큰의 만료 시간을 연장하기 위해
D) Pod의 네트워크 성능을 향상시키기 위해

<details><summary>정답 확인</summary>

**정답: B) Pod가 API Server에 불필요하게 접근하는 것을 방지하여 공격 표면을 줄이기 위해 ✅**

API Server에 접근할 필요가 없는 Pod에 ServiceAccount 토큰을 마운트하면, Pod가 침해되었을 때 공격자가 해당 토큰을 사용하여 API Server에 접근할 수 있다. `automountServiceAccountToken: false`로 불필요한 토큰 마운트를 차단하는 것이 최소 권한 원칙의 실천이다.

</details>

### 문제 20.
NetworkPolicy가 없는 Kubernetes 네임스페이스에서 Pod 간 통신의 기본 동작은?

A) 모든 인바운드와 아웃바운드 트래픽이 차단된다
B) 같은 네임스페이스 내 트래픽만 허용된다
C) 모든 인바운드와 아웃바운드 트래픽이 허용된다
D) DNS 트래픽만 허용된다

<details><summary>정답 확인</summary>

**정답: C) 모든 인바운드와 아웃바운드 트래픽이 허용된다 ✅**

Kubernetes의 기본 네트워킹 모델은 모든 Pod가 다른 모든 Pod와 통신할 수 있는 "flat network"이다. NetworkPolicy가 하나도 없으면 모든 트래픽이 허용된다. 이것이 Zero Trust 원칙에 따라 default-deny NetworkPolicy를 먼저 적용해야 하는 이유이다.

</details>

### 문제 21.
다음 중 `kubectl auth can-i create pods/exec -n production --as=system:serviceaccount:default:app-sa`의 결과가 "yes"일 때의 보안 위험은?

A) app-sa가 production 네임스페이스의 모든 Pod에 exec으로 접속하여 임의 명령을 실행할 수 있다
B) app-sa가 production 네임스페이스에 새 Pod를 생성할 수 있다
C) app-sa가 production 네임스페이스의 Secret을 조회할 수 있다
D) 보안 위험이 없다

<details><summary>정답 확인</summary>

**정답: A) app-sa가 production 네임스페이스의 모든 Pod에 exec으로 접속하여 임의 명령을 실행할 수 있다 ✅**

`pods/exec` create 권한은 Pod 내부에서 임의의 명령을 실행할 수 있는 매우 강력한 권한이다. 공격자가 이 ServiceAccount를 사용하는 Pod를 침해하면 다른 Pod에 exec으로 접속하여 데이터 탈취, 횡적 이동 등을 수행할 수 있다. 이 권한은 최소한의 주체에게만 부여해야 한다.

</details>

### 문제 22.
MITRE ATT&CK for Containers에서 "Credential Access(인증정보 접근)" 전술에 해당하는 공격은?

A) Pod 내에서 Kubernetes API Server의 ServiceAccount 토큰을 탈취한다
B) 악성 DaemonSet을 클러스터에 배포한다
C) 컨테이너에서 호스트의 네트워크 인터페이스를 스캔한다
D) 클러스터의 DNS 설정을 변경한다

<details><summary>정답 확인</summary>

**정답: A) Pod 내에서 Kubernetes API Server의 ServiceAccount 토큰을 탈취한다 ✅**

Credential Access는 클러스터 내의 인증 정보를 탈취하는 전술이다. ServiceAccount 토큰 탈취, Secret에 저장된 자격 증명 접근, 환경 변수에서 API 키 추출 등이 해당한다. B는 Persistence, C는 Discovery, D는 Tampering에 해당한다.

</details>

### 문제 23.
CIS Benchmark에서 kube-apiserver에 대한 권장 설정이 아닌 것은?

A) `--anonymous-auth=false`
B) `--insecure-port=8080`
C) `--audit-log-path=/var/log/apiserver/audit.log`
D) `--authorization-mode=Node,RBAC`

<details><summary>정답 확인</summary>

**정답: B) `--insecure-port=8080` ✅**

`--insecure-port`는 암호화되지 않고 인증이 필요 없는 HTTP 포트로, CIS Benchmark는 이를 `0`으로 설정하여 비활성화할 것을 요구한다. 참고로 Kubernetes 1.20부터 이 플래그는 더 이상 사용되지 않으며, 1.24에서 완전히 제거되었다.

</details>

### 문제 24.
Kubernetes에서 Pod에 `seccompProfile.type: RuntimeDefault`를 설정했을 때 차단되는 시스템 콜의 예시로 올바른 것은?

A) read, write
B) open, close
C) mount, reboot, ptrace
D) fork, exec

<details><summary>정답 확인</summary>

**정답: C) mount, reboot, ptrace ✅**

RuntimeDefault seccomp 프로파일은 컨테이너에서 위험한 시스템 콜(mount, umount, reboot, ptrace, kexec_load 등)을 차단한다. read, write, open, close, fork, exec 등 일반적인 프로세스 동작에 필요한 시스템 콜은 허용된다.

</details>

### 문제 25.
다음 중 Kubernetes 감사(Audit) 로그의 `omitStages` 필드에서 `RequestReceived`를 제외하는 이유는?

A) RequestReceived 단계는 보안상 가장 중요하기 때문이다
B) 요청이 처리되기 전의 초기 이벤트로, 최종 결과를 알 수 없어 노이즈가 될 수 있기 때문이다
C) RequestReceived 이벤트는 자동으로 암호화되기 때문이다
D) RequestReceived는 etcd에만 기록되기 때문이다

<details><summary>정답 확인</summary>

**정답: B) 요청이 처리되기 전의 초기 이벤트로, 최종 결과를 알 수 없어 노이즈가 될 수 있기 때문이다 ✅**

RequestReceived 단계는 API Server가 요청을 받은 직후, 핸들러로 위임하기 전의 이벤트이다. 요청의 최종 결과(성공/실패)를 알 수 없으므로, ResponseStarted나 ResponseComplete 단계의 이벤트가 더 유용하다. 불필요한 중복 이벤트를 줄여 로그 볼륨과 성능 영향을 최소화한다.

</details>

### 문제 26.
OPA Gatekeeper의 ConstraintTemplate에서 Rego 코드의 `input.review.object`가 참조하는 것은?

A) Gatekeeper의 설정 파일
B) API Server로 들어온 admission 요청의 대상 Kubernetes 리소스 오브젝트
C) etcd에 저장된 기존 리소스
D) Constraint의 파라미터 값

<details><summary>정답 확인</summary>

**정답: B) API Server로 들어온 admission 요청의 대상 Kubernetes 리소스 오브젝트 ✅**

`input.review.object`는 AdmissionReview 요청에 포함된 대상 리소스(예: 생성하려는 Pod, Deployment 등)이다. `input.review.oldObject`는 업데이트 시 이전 버전의 리소스이며, `input.parameters`는 Constraint에서 전달한 파라미터이다.

</details>

### 문제 27.
Kubernetes에서 Pod가 사용하는 ServiceAccount에 아무런 RBAC 바인딩이 없을 때 해당 Pod의 API 접근 권한은?

A) 클러스터 관리자 권한을 가진다
B) 해당 네임스페이스의 모든 리소스에 접근할 수 있다
C) 기본적으로 매우 제한된 권한만 가지며, 자기 자신에 대한 discovery API 접근 정도만 가능하다
D) API Server에 전혀 접근할 수 없다

<details><summary>정답 확인</summary>

**정답: C) 기본적으로 매우 제한된 권한만 가지며, 자기 자신에 대한 discovery API 접근 정도만 가능하다 ✅**

RBAC가 활성화된 클러스터에서 명시적 바인딩이 없는 ServiceAccount는 `system:authenticated` 그룹에 속하여 기본적인 discovery API(API 그룹과 리소스 목록 조회)에만 접근할 수 있다. 특정 리소스에 대한 CRUD 작업은 명시적 RoleBinding/ClusterRoleBinding이 필요하다.

</details>

### 문제 28.
다음 중 Supply Chain Security에서 "image provenance(이미지 출처 증명)"가 제공하는 정보가 아닌 것은?

A) 이미지가 어떤 소스 코드로부터 빌드되었는지
B) 이미지가 어떤 빌드 시스템에서 빌드되었는지
C) 이미지의 런타임 성능 벤치마크 결과
D) 이미지가 어떤 빌드 파라미터로 빌드되었는지

<details><summary>정답 확인</summary>

**정답: C) 이미지의 런타임 성능 벤치마크 결과 ✅**

Image provenance는 이미지의 빌드 과정을 증명하는 메타데이터로, 소스 코드 위치, 빌드 시스템, 빌드 파라미터, 빌드 시간, 빌드 트리거(commit SHA 등) 정보를 포함한다. 런타임 성능은 보안 provenance와 무관하다. SLSA 프레임워크가 provenance의 수준을 정의한다.

</details>

### 문제 29.
Kubernetes 환경에서 다음 보안 도구와 그 주요 목적의 연결이 올바른 것은?

A) Trivy - 런타임 위협 탐지
B) kube-bench - CIS Benchmark 자동 검사
C) Falco - 이미지 레지스트리 관리
D) Cosign - NetworkPolicy 자동 생성

<details><summary>정답 확인</summary>

**정답: B) kube-bench - CIS Benchmark 자동 검사 ✅**

kube-bench는 CIS Kubernetes Benchmark 점검 항목을 자동으로 실행하는 도구이다. Trivy는 이미지 취약점 스캐너(런타임 위협 탐지가 아님), Falco는 런타임 위협 탐지 도구(레지스트리 관리가 아님), cosign은 이미지 서명/검증 도구(NetworkPolicy와 무관)이다.

</details>

### 문제 30.
Kubernetes에서 다음 default-deny NetworkPolicy가 적용된 네임스페이스에서 Pod가 외부 인터넷에 접근하려면 추가로 필요한 설정은?

```yaml
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

A) Ingress 규칙만 추가하면 된다
B) Egress 규칙을 추가하여 외부 IP 대역과 DNS(UDP 53) 트래픽을 허용해야 한다
C) NetworkPolicy를 삭제해야 한다
D) Pod에 특별한 annotation을 추가하면 자동으로 허용된다

<details><summary>정답 확인</summary>

**정답: B) Egress 규칙을 추가하여 외부 IP 대역과 DNS(UDP 53) 트래픽을 허용해야 한다 ✅**

default-deny-all 정책은 Ingress와 Egress 모두를 차단한다. 외부 인터넷에 접근하려면 Egress NetworkPolicy에서 대상 IP 대역(또는 `0.0.0.0/0`)과 함께 DNS 해석을 위한 kube-dns(UDP 53) 트래픽도 반드시 허용해야 한다. DNS를 허용하지 않으면 도메인 이름으로의 통신이 불가능하다.

</details>

---

---

## Part 5: 보안 메커니즘 트러블슈팅 종합

### 5.1 Admission Webhook 장애 대응

Admission Webhook(OPA Gatekeeper, Kyverno)의 장애는 클러스터 전체의 리소스 생성/수정을 차단할 수 있으므로 신속한 대응이 필요하다.

#### 증상과 진단

**증상**: 모든 `kubectl apply`, `kubectl create` 명령이 타임아웃 또는 500 에러를 반환한다.

```bash
# 증상 확인
kubectl create namespace test-ns
```

```text
Error from server (InternalError): Internal error occurred: failed calling webhook "validation.gatekeeper.sh":
failed to call webhook: Post "https://gatekeeper-webhook-service.gatekeeper-system.svc:443/v1/admit":
dial tcp 10.96.x.x:443: connect: connection refused
```

#### 대응 절차

```bash
# 1) webhook Pod 상태 확인
kubectl get pods -n gatekeeper-system
```

```text
NAME                                            READY   STATUS             RESTARTS   AGE
gatekeeper-controller-manager-xxxxx             0/1     CrashLoopBackOff   5          10m
```

```bash
# 2) failurePolicy 확인 (Fail이면 webhook 장애 = API 전체 차단)
kubectl get validatingwebhookconfiguration gatekeeper-validating-webhook-configuration -o jsonpath='{.webhooks[0].failurePolicy}'
```

```text
Fail
```

```bash
# 3) 긴급 대응: webhook 비활성화 (클러스터 운영 복구 우선)
kubectl delete validatingwebhookconfiguration gatekeeper-validating-webhook-configuration
```

```text
validatingwebhookconfiguration.admissionregistration.k8s.io "gatekeeper-validating-webhook-configuration" deleted
```

```bash
# 4) Gatekeeper Pod 문제 해결 후 재배포
kubectl rollout restart deployment gatekeeper-controller-manager -n gatekeeper-system
```

```text
deployment.apps/gatekeeper-controller-manager restarted
```

> **주의**: webhook을 삭제하면 정책 검증 없이 모든 리소스가 생성 가능해진다. 이는 보안 공백이므로 가능한 빨리 webhook을 복구해야 한다.

### 5.2 NetworkPolicy 디버깅 패턴

NetworkPolicy가 의도대로 동작하지 않는 경우의 체계적 진단 방법이다.

#### 트래픽이 차단되어야 하는데 허용되는 경우

```bash
# 1) 정책이 실제로 존재하는지 확인
kubectl get networkpolicy -n demo
kubectl get cnp -n demo
```

```text
NAME                           AGE
default-deny-all               10d
allow-external-to-nginx        10d
```

```bash
# 2) 정책의 podSelector가 대상 Pod와 매칭되는지 확인
kubectl get cnp default-deny-all -n demo -o jsonpath='{.spec.endpointSelector}'
```

```text
{}
```

`{}`는 모든 Pod에 적용된다. 특정 레이블이 지정된 경우 대상 Pod의 레이블과 일치하는지 확인한다.

```bash
# 3) CNI 플러그인이 정책을 지원하는지 확인 (kubenet은 NetworkPolicy 미지원)
kubectl get pods -n kube-system -l k8s-app=cilium
```

```text
NAME           READY   STATUS    RESTARTS   AGE
cilium-xxxxx   1/1     Running   0          10d
```

Cilium Pod가 Running이 아니면 정책이 적용되지 않는다.

#### 트래픽이 허용되어야 하는데 차단되는 경우

```bash
# 1) egress와 ingress 양방향 정책 확인
# 소스 Pod의 egress 정책에서 대상이 허용되는지 확인
kubectl get cnp -n demo -o yaml | grep -A20 "allow-nginx-egress"

# 대상 Pod의 ingress 정책에서 소스가 허용되는지 확인
kubectl get cnp -n demo -o yaml | grep -A20 "allow-nginx-to-httpbin"
```

```bash
# 2) DNS 조회가 허용되는지 확인 (DNS 차단 시 서비스 이름 해석 불가)
kubectl exec -n demo <pod-name> -- nslookup httpbin.demo.svc.cluster.local
```

```text
Server:    10.96.0.10
Address 1: 10.96.0.10 kube-dns.kube-system.svc.cluster.local

Name:      httpbin.demo.svc.cluster.local
Address 1: 10.96.x.x
```

DNS 해석이 실패하면 egress 정책에서 kube-dns(53/UDP)가 허용되어 있는지 확인한다.

### 5.3 Secret 관련 보안 사고 대응 체크리스트

Secret이 노출된 경우의 표준 대응 절차이다.

| 단계 | 작업 | 검증 명령어 |
|------|------|-----------|
| 1. 탐지 | Secret 노출 경로 확인 | `kubectl get secret -o yaml` 로그, Git 히스토리, 채팅 로그 점검 |
| 2. 범위 분석 | 노출된 Secret을 사용하는 서비스 파악 | `kubectl get pods -A -o json \| grep secretKeyRef` |
| 3. 격리 | 노출된 자격 증명으로의 접근 차단 | 데이터베이스 비밀번호 변경, API 키 무효화 |
| 4. 교체 | 새로운 Secret 생성 및 배포 | `kubectl create secret generic new-secret ...` |
| 5. 감사 | 노출 기간 동안의 비정상 접근 확인 | Audit 로그 분석, 데이터베이스 접근 로그 확인 |
| 6. 재발 방지 | RBAC 강화, Encryption at Rest 적용 | `kubectl auth can-i get secrets --as=...` |

```bash
# Secret 노출 범위 파악 — 환경 변수에서 Secret을 참조하는 Pod 검색
kubectl get pods -A -o json | python3 -c "
import json, sys
data = json.load(sys.stdin)
for pod in data['items']:
    ns = pod['metadata']['namespace']
    name = pod['metadata']['name']
    for c in pod['spec'].get('containers', []):
        for env in c.get('env', []):
            if 'valueFrom' in env and 'secretKeyRef' in env.get('valueFrom', {}):
                ref = env['valueFrom']['secretKeyRef']
                print(f'{ns}/{name}: {env[\"name\"]} -> secret/{ref[\"name\"]}.{ref[\"key\"]}')
" 2>/dev/null
```

```text
production/app-xxx: DB_PASSWORD -> secret/db-credentials.password
production/worker-yyy: API_KEY -> secret/api-keys.key
```

### 5.4 인증서 만료 사전 탐지

Kubernetes 클러스터의 인증서가 만료되면 컴포넌트 간 통신이 불가능해진다. 사전 탐지가 필수적이다.

```bash
# 모든 인증서의 만료일을 한 번에 확인하는 스크립트
ssh admin@<dev-master-ip> 'for cert in /etc/kubernetes/pki/*.crt /etc/kubernetes/pki/etcd/*.crt; do
  EXPIRY=$(sudo openssl x509 -in "$cert" -noout -enddate 2>/dev/null | cut -d= -f2)
  DAYS_LEFT=$(( ($(date -d "$EXPIRY" +%s 2>/dev/null || date -j -f "%b %d %T %Y %Z" "$EXPIRY" +%s 2>/dev/null) - $(date +%s)) / 86400 ))
  [ "$DAYS_LEFT" -lt 90 ] && STATUS="[WARNING]" || STATUS="[OK]"
  echo "$STATUS $cert: $DAYS_LEFT days remaining ($EXPIRY)"
done' 2>/dev/null
```

```text
[OK] /etc/kubernetes/pki/apiserver.crt: 340 days remaining (Jan 15 10:00:00 2025 GMT)
[OK] /etc/kubernetes/pki/ca.crt: 3640 days remaining (Jan 15 10:00:00 2034 GMT)
[WARNING] /etc/kubernetes/pki/front-proxy-client.crt: 45 days remaining (Mar 01 10:00:00 2024 GMT)
```

`[WARNING]`이 표시되면 인증서 갱신을 계획해야 한다. 일반적으로 90일 이내 만료되는 인증서는 갱신 대상이다.

```bash
# kubeadm 환경에서 인증서 일괄 갱신
ssh admin@<dev-master-ip> 'sudo kubeadm certs check-expiration'
```

```text
CERTIFICATE                EXPIRES                  RESIDUAL TIME   CERTIFICATE AUTHORITY   EXTERNALLY MANAGED
admin.conf                 Jan 15, 2025 10:00 UTC   340d            ca                      no
apiserver                  Jan 15, 2025 10:00 UTC   340d            ca                      no
apiserver-etcd-client      Jan 15, 2025 10:00 UTC   340d            etcd-ca                 no
apiserver-kubelet-client   Jan 15, 2025 10:00 UTC   340d            ca                      no
controller-manager.conf    Jan 15, 2025 10:00 UTC   340d            ca                      no
etcd-healthcheck-client    Jan 15, 2025 10:00 UTC   340d            etcd-ca                 no
etcd-peer                  Jan 15, 2025 10:00 UTC   340d            etcd-ca                 no
etcd-server                Jan 15, 2025 10:00 UTC   340d            etcd-ca                 no
front-proxy-client         Jan 15, 2025 10:00 UTC   340d            front-proxy-ca          no
scheduler.conf             Jan 15, 2025 10:00 UTC   340d            ca                      no

CERTIFICATE AUTHORITY   EXPIRES                  RESIDUAL TIME   EXTERNALLY MANAGED
ca                      Jan 13, 2034 10:00 UTC   3640d           no
etcd-ca                 Jan 13, 2034 10:00 UTC   3640d           no
front-proxy-ca          Jan 13, 2034 10:00 UTC   3640d           no
```

---

> 이 보충 자료는 기존 01-concepts.md, 02-examples.md, 03-exam-questions.md의 내용과 중복되지 않도록 구성되었다. 기존 자료와 함께 학습하면 KCSA 시험 범위를 포괄적으로 다룰 수 있다.
