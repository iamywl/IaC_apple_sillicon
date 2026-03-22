# KCSA Day 1: 클라우드 네이티브 보안 개요 — 4C 모델, STRIDE, Zero Trust

> **시험 비중:** Overview of Cloud Native Security — 14%
> **목표:** 클라우드 네이티브 보안의 기본 프레임워크(4C 모델, STRIDE, Zero Trust, CNCF Security TAG)를 완벽히 이해한다.

---

## 1. 클라우드 네이티브 보안이란?

### 1.1 4C 계층 구조와 심층 방어(Defense in Depth) 원칙

클라우드 네이티브 보안은 동심원형 계층 구조(Concentric Security Layers)로 설계된다.

```
4C 보안 계층 구조 (바깥 → 안쪽):

[Cloud 계층] ─── 인프라 보안 경계
    IAM, VPC/방화벽, KMS, CloudTrail
    → 물리적/논리적 인프라 수준의 접근 제어

  [Cluster 계층] ─── 오케스트레이션 보안 경계
      RBAC, NetworkPolicy, API Server 인증/인가/Admission
      → Kubernetes 컨트롤 플레인 및 데이터 플레인 보안

    [Container 계층] ─── 워크로드 격리 경계
        SecurityContext, seccomp, AppArmor, 이미지 서명 검증
        → Linux 커널 보안 기능을 활용한 프로세스 격리

      [Code 계층] ─── 애플리케이션 보안 경계
          Secret 관리, TLS, 입력 검증, 의존성 분석
          → 애플리케이션 수준의 기밀성/무결성 보호
```

**핵심 원리:** 각 계층은 독립적인 보안 도메인(Security Domain)으로 작동하며, 외부 계층이 침해되더라도 내부 계층의 보안 통제가 추가 방어선을 형성한다. 이것이 **심층 방어(Defense in Depth)** 원칙이며, 단일 장애점(Single Point of Failure)을 제거하는 보안 아키텍처 설계 패턴이다.

### 1.2 왜 클라우드 네이티브 보안이 중요한가?

전통적인 보안 모델은 "경계 보안(Perimeter Security)"이었다. 방화벽 안쪽은 신뢰하고 바깥만 차단하는 방식이다. 하지만 클라우드 네이티브 환경에서는:

1. **마이크로서비스:** 수십~수백 개의 서비스가 네트워크로 통신 → 공격 표면 확대
2. **동적 환경:** Pod가 수시로 생성/삭제 → IP 기반 보안 불가
3. **공유 인프라:** 여러 팀/서비스가 같은 클러스터 사용 → 격리 필수
4. **공급망 복잡성:** 수많은 오픈소스 의존성 → 취약점 관리 어려움

```
전통적 보안 vs 클라우드 네이티브 보안 비교

전통적 보안 (경계 중심):
┌─────────────────────────────┐
│       방화벽 (Firewall)      │  ← 이것만 믿는다
│  ┌───────────────────────┐  │
│  │  내부 네트워크 = 신뢰   │  │  ← 내부는 자유롭게 통신
│  │  서버A ←──→ 서버B      │  │
│  │  서버C ←──→ 서버D      │  │
│  └───────────────────────┘  │
└─────────────────────────────┘
문제: 내부 침입자나 내부 서비스가 탈취되면 전체가 위험

클라우드 네이티브 보안 (심층 방어):
┌─────────────────────────────────┐
│  Cloud: IAM, 방화벽, 암호화       │
│  ┌───────────────────────────┐  │
│  │ Cluster: RBAC, Admission  │  │
│  │ ┌──────────────────────┐  │  │
│  │ │ Container: seccomp   │  │  │
│  │ │ ┌─────────────────┐  │  │  │
│  │ │ │ Code: TLS,검증   │  │  │  │
│  │ │ └─────────────────┘  │  │  │
│  │ └──────────────────────┘  │  │
│  └───────────────────────────┘  │
└─────────────────────────────────┘
각 계층이 독립적으로 방어 → 하나가 뚫려도 나머지가 보호
```

---

## 2. 4C 보안 모델 심화

### 2.1 각 계층 상세 설명

#### Cloud 계층 (가장 바깥)

```
클라우드 제공자가 제공하는 인프라 수준의 보안 경계이다.
하위 계층(Cluster, Container, Code)의 모든 보안 통제는 Cloud 계층의 인프라 보안이
전제되어야 유효하다. 인프라 계층이 침해되면 상위 계층의 보안 통제가 무력화된다.
```

| 보안 영역 | 구체적 내용 | 도구/서비스 예시 |
|----------|-----------|---------------|
| IAM (Identity & Access Management) | 클라우드 리소스 접근 제어 | AWS IAM, GCP IAM, Azure AD |
| 네트워크 보안 | VPC, 보안 그룹, 방화벽 | AWS VPC, GCP VPC, 서브넷 격리 |
| 데이터 암호화 | 전송 중/저장 시 암호화 | AWS KMS, GCP Cloud KMS |
| 감사 로그 | 클라우드 API 호출 기록 | AWS CloudTrail, GCP Cloud Audit |
| 물리적 보안 | 데이터센터 물리적 접근 제어 | 클라우드 제공자 책임 |
| 컴플라이언스 | 규정 준수 인증 | SOC 2, ISO 27001, HIPAA |

**공유 책임 모델 (Shared Responsibility Model):**
```
┌────────────────────────────────────────────┐
│              고객 책임                       │
│  데이터, 애플리케이션, OS, 네트워크 설정      │
│  IAM 정책, 암호화 키 관리, 보안 그룹 설정     │
├────────────────────────────────────────────┤
│          클라우드 제공자 책임                  │
│  물리적 보안, 하드웨어, 네트워크 인프라         │
│  하이퍼바이저, 글로벌 인프라                   │
└────────────────────────────────────────────┘

핵심: "보안의 책임은 클라우드 '위에서' 실행되는 것에 대해서는 고객에게 있다"
```

#### Cluster 계층

```
Kubernetes 컨트롤 플레인 수준의 보안 경계이다.
API Server의 3단계 요청 처리 파이프라인(Authentication → Authorization → Admission Control)이
클러스터 리소스에 대한 모든 접근을 제어한다. 인증되지 않은 요청은 401로 거부되고,
인가되지 않은 요청은 403으로 거부되며, 정책 위반 요청은 Admission Controller에서 차단된다.
```

| 보안 영역 | 구체적 내용 | 관련 K8s 기능 |
|----------|-----------|-------------|
| API Server 보안 | 인증, 인가, Admission Control | X.509, OIDC, RBAC, PSA |
| etcd 보안 | 저장 데이터 암호화, TLS 통신 | EncryptionConfiguration |
| 네트워크 정책 | Pod 간 통신 제어 | NetworkPolicy, CNI |
| 클러스터 업그레이드 | 보안 패치 적용 | kubeadm upgrade |
| Audit 로깅 | API 요청 기록 | Audit Policy |

#### Container 계층

```
Linux 커널의 보안 메커니즘을 활용한 프로세스 격리 경계이다.
각 컨테이너는 namespace, cgroup, seccomp, capabilities 등
커널 수준의 격리 기능으로 보호된다:
- runAsNonRoot: UID 0(root) 실행을 금지하여 권한 상승 경로를 차단
- readOnlyRootFilesystem: 루트 파일시스템을 읽기 전용으로 마운트하여 런타임 변조 방지
- capabilities.drop: ["ALL"]: 모든 Linux capability를 제거하여 커널 기능 접근을 최소화
```

| 보안 영역 | 구체적 내용 | 관련 설정 |
|----------|-----------|---------|
| 이미지 보안 | 취약점 스캐닝, 서명 검증 | Trivy, Cosign |
| 런타임 보안 | 시스템 콜 제한, MAC | seccomp, AppArmor |
| SecurityContext | 컨테이너 실행 권한 설정 | runAsNonRoot, capabilities |
| 리소스 제한 | CPU/메모리 제한 | resources.limits |
| 최소 이미지 | 불필요한 패키지 제거 | distroless, scratch |

#### Code 계층 (가장 안쪽)

```
애플리케이션 코드 수준의 보안 경계이다.
OWASP Top 10 등 애플리케이션 보안 위협에 대응하는 계층이다:
- 시크릿 하드코딩 금지: 자격 증명은 Vault/External Secrets로 외부화
- TLS/mTLS: 전송 계층 암호화로 기밀성(Confidentiality)과 무결성(Integrity) 보장
- 입력 검증(Input Validation): SQL Injection, XSS 등 Injection 공격 방어
```

| 보안 영역 | 구체적 내용 | 도구/방법 |
|----------|-----------|---------|
| 시크릿 관리 | 하드코딩 금지, 안전한 저장 | Vault, External Secrets |
| TLS 통신 | 모든 통신 암호화 | cert-manager, Istio mTLS |
| 입력 검증 | SQL Injection, XSS 방어 | 프레임워크 내장 검증 |
| 의존성 관리 | 취약한 라이브러리 탐지 | Snyk, Dependabot |
| SAST/DAST | 정적/동적 보안 분석 | SonarQube, OWASP ZAP |

### 2.2 4C 모델 YAML 연관 예제

각 계층의 보안이 Kubernetes YAML에서 어떻게 표현되는지 살펴본다.

#### 예제 1: Cluster 계층 - NetworkPolicy (기본 거부)

```yaml
# Cluster 계층: 네트워크 격리
# Zero Trust 네트워크 구현: Default Deny 정책으로 명시적 허용 규칙 없는 트래픽을 모두 차단
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all          # 정책 이름
  namespace: production           # 적용할 네임스페이스
spec:
  podSelector: {}                 # {} = 이 네임스페이스의 '모든' Pod에 적용
                                  # 특정 Pod만 선택하려면 matchLabels 사용
  policyTypes:                    # 어떤 방향의 트래픽을 제어할지
    - Ingress                     # 들어오는 트래픽 (수신)
    - Egress                      # 나가는 트래픽 (송신)
  # ingress/egress 규칙이 비어있으면 = 모든 트래픽 차단
  # 이것이 "Default Deny" 전략의 핵심이다
```

#### 예제 2: Container 계층 - SecurityContext (최소 권한)

```yaml
# Container 계층: 컨테이너 실행 권한 최소화
apiVersion: v1
kind: Pod
metadata:
  name: secure-app
  namespace: production
spec:
  # Pod 레벨 보안 설정 (모든 컨테이너에 적용)
  securityContext:
    runAsNonRoot: true            # root(UID 0)로 실행 금지
                                  # UID 0 프로세스는 커널 수준 권한을 가지므로 권한 상승 공격의 기반이 된다
    runAsUser: 1000               # UID 1000으로 실행
    runAsGroup: 3000              # GID 3000으로 실행
    fsGroup: 2000                 # 볼륨의 파일 시스템 그룹
    seccompProfile:               # 시스템 콜 제한 프로파일
      type: RuntimeDefault        # 런타임 기본 프로파일 사용
                                  # 허용된 syscall 화이트리스트 외의 시스템 콜을 차단하여 커널 공격 표면을 축소

  automountServiceAccountToken: false  # SA 토큰 자동 마운트 비활성화
                                       # API Server에 접근할 필요 없는 Pod에 필수
                                       # 불필요한 자격 증명 노출을 제거하여 Credential Access 공격 경로를 차단

  containers:
    - name: app
      image: myapp:v1.2.3@sha256:abc123...  # 다이제스트로 이미지 고정
                                              # SHA256 해시로 이미지의 무결성(Integrity)을 보장
                                              # 태그는 mutable하여 동일 태그에 다른 이미지가 매핑될 수 있으므로 위험

      securityContext:
        allowPrivilegeEscalation: false  # 권한 상승 금지
                                          # setuid/setgid 비트를 통한 프로세스 권한 상승(Privilege Escalation)을 차단
        readOnlyRootFilesystem: true     # 루트 파일시스템 읽기 전용
                                          # 런타임에 바이너리 변조나 악성 파일 기록을 방지하여 Tampering 위협에 대응
        capabilities:
          drop:
            - ALL                         # 모든 Linux capability 제거
                                          # CAP_NET_RAW, CAP_SYS_ADMIN 등 커널 권한을 모두 해제
          add:
            - NET_BIND_SERVICE            # 필요한 것만 추가 (1024 미만 포트 바인딩)
                                          # 최소 권한 원칙(Least Privilege)에 따라 필요한 capability만 명시적으로 부여

      resources:                          # 리소스 제한 (DoS 방지)
        requests:
          memory: "64Mi"
          cpu: "100m"
        limits:
          memory: "128Mi"
          cpu: "250m"

      volumeMounts:
        - name: secret-vol
          mountPath: /etc/secrets          # Secret을 파일로 마운트
          readOnly: true                   # 읽기 전용 마운트

  volumes:
    - name: secret-vol
      secret:
        secretName: app-credentials
        defaultMode: 0400                  # 파일 권한: 소유자만 읽기
```

#### 예제 3: Cluster 계층 - RBAC (최소 권한)

```yaml
# 읽기 전용 Role 정의
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  namespace: production           # 이 네임스페이스에서만 유효
  name: pod-reader                # Role 이름
rules:
  - apiGroups: [""]               # "" = core API 그룹 (Pod, Service, Secret 등)
                                  # apps, networking.k8s.io 등 다른 그룹도 있음
    resources: ["pods"]           # 접근할 리소스 종류
    verbs: ["get", "list", "watch"]  # 허용할 동작 (읽기만)
                                     # create, update, delete는 포함하지 않음
  - apiGroups: [""]
    resources: ["pods/log"]       # Pod 로그 조회 (하위 리소스)
    verbs: ["get"]
---
# Role을 ServiceAccount에 바인딩
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: read-pods
  namespace: production           # Role과 같은 네임스페이스
subjects:                         # 누구에게 권한을 부여할지
  - kind: ServiceAccount          # ServiceAccount, User, Group 가능
    name: monitoring-sa           # SA 이름
    namespace: production         # SA가 있는 네임스페이스
roleRef:                          # 어떤 Role을 바인딩할지
  kind: Role                     # Role 또는 ClusterRole
  name: pod-reader               # 위에서 정의한 Role
  apiGroup: rbac.authorization.k8s.io
```

#### 예제 4: Code 계층 - Secret 관리

```yaml
# Secret 생성 (Base64 인코딩 - 암호화가 아님!)
apiVersion: v1
kind: Secret
metadata:
  name: app-credentials
  namespace: production
type: Opaque                      # 일반 시크릿 (다른 타입: kubernetes.io/tls 등)
data:
  # Base64 인코딩된 값
  # echo -n 'mypassword' | base64 → bXlwYXNzd29yZA==
  # 주의: Base64는 누구나 디코딩 가능! 암호화가 아니다!
  password: bXlwYXNzd29yZA==
  api-key: c2VjcmV0LWtleS0xMjM=
# stringData를 사용하면 평문으로 작성 가능 (K8s가 자동 인코딩)
# stringData:
#   password: mypassword
```

#### 예제 5: Encryption at Rest 설정

```yaml
# etcd에 저장되는 Secret을 암호화하는 설정
# API Server의 --encryption-provider-config 플래그로 지정
apiVersion: apiserver.config.k8s.io/v1
kind: EncryptionConfiguration
resources:
  - resources:                    # 암호화할 리소스 목록
      - secrets                   # Secret 리소스를 암호화
      - configmaps                # ConfigMap도 암호화 가능
    providers:                    # 암호화 프로바이더 (순서 중요!)
      - aescbc:                   # 첫 번째 프로바이더로 새 데이터 암호화
          keys:
            - name: key1          # 키 이름 (로테이션 시 식별용)
              secret: <base64-encoded-32-byte-key>  # 256비트 키
      - identity: {}              # 두 번째: 기존 평문 데이터 읽기용
                                  # 암호화되지 않은 기존 데이터를 읽을 수 있게 함
# 프로바이더 순서의 의미:
# - 첫 번째 프로바이더: 새로 저장되는 데이터 암호화에 사용
# - 나머지 프로바이더: 기존 데이터 복호화에 사용
#
# 프로덕션 권장: kms v2 (외부 KMS 사용)
# 로컬 권장: secretbox (XSalsa20 + Poly1305)
```

---

## 3. 공격 표면(Attack Surface) 심화

### 3.1 Kubernetes 공격 표면 전체 지도

```
Kubernetes 공격 표면 지도

                    외부 인터넷
                        │
          ┌─────────────┼─────────────┐
          │             │             │
    ┌─────▼──────┐ ┌───▼────┐ ┌──────▼──────┐
    │ Ingress    │ │ API    │ │ NodePort    │
    │ Controller │ │ Server │ │ Services    │
    │ (80/443)   │ │ (6443) │ │ (30000+)    │
    └─────┬──────┘ └───┬────┘ └──────┬──────┘
          │            │             │
    ┌─────▼────────────▼─────────────▼──────┐
    │          Kubernetes Cluster            │
    │                                        │
    │  ┌──────┐  ┌──────┐  ┌──────────┐    │
    │  │ etcd │  │kubelet│  │Container │    │
    │  │(2379)│  │(10250)│  │ Runtime  │    │
    │  └──────┘  └──────┘  └──────────┘    │
    │                                        │
    │  ┌──────────┐  ┌───────────────────┐  │
    │  │ Pod      │  │ Image Registry    │  │
    │  │ Network  │  │ (공급망)           │  │
    │  └──────────┘  └───────────────────┘  │
    └────────────────────────────────────────┘

각 진입점은 하나의 공격 표면이다.
```

### 3.2 주요 공격 표면 상세

#### API Server (포트 6443)

```
공격 시나리오:

1. 공격자가 노출된 API Server 발견
2. anonymous-auth=true이면 인증 없이 접근 가능
3. system:anonymous에 과도한 권한이 있으면 정보 탈취

방어:
--anonymous-auth=false           # 익명 접근 차단
--authorization-mode=Node,RBAC   # RBAC으로 인가
--enable-admission-plugins=NodeRestriction,PodSecurity  # Admission 검증

흐름도:
[공격자] → 6443 포트 접근
           → --anonymous-auth=false → 차단! (인증 실패)
           → 유효한 인증 → RBAC 검사 → 권한 없음 → 차단!
           → 유효한 인증 + 권한 있음 → Admission → 정책 위반 → 차단!
```

#### etcd (포트 2379/2380)

```
공격 시나리오:

1. etcd가 네트워크에 직접 노출됨
2. TLS 없이 평문 통신
3. 공격자가 etcd에 직접 접근하여 모든 Secret 탈취

방어:
- etcd를 별도 네트워크에 격리
- 클라이언트 인증서 요구 (--client-cert-auth=true)
- TLS 통신 강제
- Encryption at Rest 설정

위험도 평가:
[최고 위험] etcd = 클러스터의 "두뇌"
            모든 Secret, 설정, 상태 데이터가 저장됨
            etcd가 탈취되면 = 클러스터 전체가 탈취된 것
```

#### kubelet (포트 10250/10255)

```
공격 시나리오:

1. kubelet의 읽기 전용 포트(10255) 노출
2. 인증 없이 노드의 Pod 정보, 환경 변수 조회 가능
3. 10250 포트에 인증 없이 접근하면 Pod에서 명령 실행 가능

방어:
--anonymous-auth=false            # 익명 접근 차단
--authorization-mode=Webhook      # API Server에 인가 위임
--read-only-port=0                # 10255 포트 비활성화

포트 비교:
10250: HTTPS, 인증 필요 → 보안 포트
10255: HTTP, 인증 없음 → 위험! 반드시 비활성화
```

#### 컨테이너 이미지 (공급망)

```
공격 시나리오 (공급망 공격):

1. 공격자가 인기 있는 베이스 이미지에 백도어 삽입
2. 개발자가 해당 이미지를 사용하여 애플리케이션 빌드
3. 프로덕션에 배포 → 백도어 실행

방어:
- 신뢰할 수 있는 레지스트리만 사용 (프라이빗 레지스트리)
- 이미지 서명 검증 (Cosign)
- 이미지 스캐닝 (Trivy)
- SBOM 생성 및 관리
- Admission Webhook으로 미서명/미스캔 이미지 차단

흐름:
[이미지 빌드] → [Trivy 스캔] → [Cosign 서명] → [레지스트리 업로드]
                                                       │
[Pod 생성 요청] → [Admission Webhook] → 서명 검증 → ✓ 배포 허용
                                       → 미서명 → ✗ 배포 차단
```

---

## 4. 위협 모델링 — STRIDE 심화

### 4.1 STRIDE 각 위협 유형 상세 설명

#### S - Spoofing (위장)

```
정의: 인증 메커니즘을 우회하거나 타 주체(Subject)의 자격 증명을 도용하여
      시스템에 비인가 접근하는 공격 기법이다.

Kubernetes 예시:
1. 탈취한 ServiceAccount 토큰으로 API Server에 접근
2. 가짜 인증서로 kubelet 통신 가로채기
3. Pod가 다른 서비스의 ServiceAccount를 사용

대응 방법:
- 강력한 인증 메커니즘 (X.509, OIDC)
- SA 토큰 만료 시간 설정 (Bound Token)
- mTLS로 서비스 간 상호 인증
- automountServiceAccountToken: false
```

#### T - Tampering (변조)

```
정의: 전송 중(In-Transit) 또는 저장 중(At-Rest)인 데이터의 무결성(Integrity)을
      침해하여 시스템 상태나 구성을 비인가로 수정하는 공격이다.

Kubernetes 예시:
1. etcd 데이터를 직접 수정하여 RBAC 정책 변조
2. 컨테이너 이미지를 변조하여 악성 코드 삽입
3. ConfigMap/Secret을 무단으로 수정

대응 방법:
- etcd TLS 통신 + Encryption at Rest
- 이미지 서명 (Cosign) + 다이제스트 사용
- RBAC로 ConfigMap/Secret 수정 권한 제한
- Admission Webhook으로 정책 준수 강제
```

#### R - Repudiation (부인)

```
정의: 감사 추적(Audit Trail)이 부재하여 특정 주체의 행위를 사후에 증명할 수 없는
      보안 취약점이다. 비부인성(Non-Repudiation) 통제가 없으면 악의적 행위의 추적과 포렌식이 불가능하다.

Kubernetes 예시:
1. Audit Log 없이 Secret을 조회/삭제한 후 행위를 부인
2. RBAC 변경 이력이 없어 누가 권한을 변경했는지 추적 불가

대응 방법:
- Kubernetes Audit Logging 활성화
- 감사 로그를 외부 불변 저장소에 보관 (Loki, Elasticsearch)
- 모든 변경을 GitOps로 추적 (ArgoCD)
```

#### I - Information Disclosure (정보 노출)

```
정의: 기밀성(Confidentiality)이 침해되어 비인가 주체에게 민감 데이터가 노출되는 위협이다.
      접근 제어 미비, 암호화 부재, 부적절한 에러 처리 등이 원인이 된다.

Kubernetes 예시:
1. Secret이 etcd에 평문으로 저장되어 노출
2. 환경 변수로 전달된 Secret이 로그에 기록
3. kubelet 10255 포트를 통해 Pod 정보 노출
4. 에러 메시지에 내부 구조 정보 포함

대응 방법:
- Encryption at Rest로 etcd 데이터 암호화
- Secret은 환경 변수 대신 Volume 마운트
- 읽기 전용 포트 비활성화
- RBAC로 Secret 접근 권한 최소화
```

#### D - Denial of Service (서비스 거부)

```
정의: 시스템의 가용성(Availability)을 침해하여 정상 사용자의 서비스 접근을 방해하는 공격이다.
      리소스 고갈(Resource Exhaustion), 대량 요청(Flooding) 등의 기법이 사용된다.

Kubernetes 예시:
1. 리소스 제한 없는 Pod가 노드의 CPU/메모리를 모두 소진
2. API Server에 대량의 요청을 보내 과부하
3. etcd 저장 공간 고갈
4. CrashLoopBackOff Pod가 대량의 로그 생성

대응 방법:
- ResourceQuota로 네임스페이스 리소스 총량 제한
- LimitRange로 Pod/Container 리소스 기본값/최대값 설정
- API Server Rate Limiting
- Pod Priority와 Preemption 설정
```

#### E - Elevation of Privilege (권한 상승)

```
정의: 낮은 권한의 주체가 시스템 취약점이나 설정 오류를 악용하여 상위 권한을 획득하는 공격이다.
      수직적 권한 상승(Vertical Escalation)과 수평적 권한 이동(Lateral Movement)이 포함된다.

Kubernetes 예시:
1. privileged: true 컨테이너에서 호스트 탈출
2. hostPath로 호스트의 /etc/shadow 접근
3. SA 토큰 탈취 후 RBAC 권한 상승
4. container에서 Docker 소켓 접근하여 새 컨테이너 생성

대응 방법:
- Pod Security Standards (Restricted 레벨)
- seccomp 프로파일 적용
- capabilities.drop: ["ALL"]
- RBAC에서 escalate, bind verb 제한
```

### 4.2 STRIDE를 Kubernetes에 매핑한 종합표

```yaml
# STRIDE 위협 매핑 참조 표
# 시험에서 "~는 STRIDE의 어떤 위협에 해당하는가?" 형태로 출제

Spoofing:
  - SA 토큰 탈취 → API 접근
  - 가짜 인증서 사용
  - Pod의 SA 위조
  대응: "인증 강화" 키워드

Tampering:
  - etcd 데이터 변조
  - 이미지 변조
  - ConfigMap/Secret 무단 수정
  대응: "무결성 검증, 서명" 키워드

Repudiation:
  - 감사 로그 없이 행위 부인
  - 변경 이력 미추적
  대응: "Audit Logging, 추적" 키워드

Information_Disclosure:
  - Secret 평문 저장/노출
  - 로그에 민감 정보
  - kubelet 10255 포트
  대응: "암호화, 접근 제한" 키워드

Denial_of_Service:
  - 리소스 고갈
  - API Server 과부하
  대응: "ResourceQuota, LimitRange" 키워드

Elevation_of_Privilege:
  - privileged 컨테이너
  - hostPath 마운트
  - 컨테이너 탈출
  대응: "PSS, seccomp, 최소 권한" 키워드
```

---

## 5. CNCF Security TAG 심화

### 5.1 CNCF Security TAG의 역할

```
CNCF (Cloud Native Computing Foundation)
  └── TAG (Technical Advisory Group)
       └── Security TAG
            │
            ├── 보안 백서 발행
            │   └── Cloud Native Security Whitepaper
            │   └── Supply Chain Security Best Practices
            │
            ├── 프로젝트 보안 평가
            │   └── 졸업(Graduated) 프로젝트 보안 감사
            │   └── 인큐베이팅 프로젝트 보안 리뷰
            │
            ├── 보안 관련 프로젝트
            │   └── Falco (런타임 보안)
            │   └── OPA (정책 엔진)
            │   └── SPIFFE/SPIRE (서비스 ID)
            │   └── TUF/Notary (아티팩트 서명)
            │   └── cert-manager (인증서 관리)
            │
            └── 커뮤니티 교육
                └── 보안 모범 사례 가이드
                └── 위협 모델링 방법론
```

### 5.2 주요 CNCF 보안 프로젝트

| 프로젝트 | 상태 | 역할 | 핵심 키워드 |
|---------|------|------|-----------|
| **Falco** | Graduated | 런타임 보안 모니터링 | eBPF, 시스템 콜, 이상 탐지 |
| **OPA** | Graduated | 범용 정책 엔진 | Rego, Gatekeeper, Admission |
| **TUF** | Graduated | 업데이트 프레임워크 | 안전한 소프트웨어 배포 |
| **SPIFFE/SPIRE** | Incubating | 서비스 아이덴티티 | 워크로드 인증, SVID |
| **Notary** | Incubating | 아티팩트 서명 | 이미지 무결성, 서명 검증 |
| **cert-manager** | Incubating | 인증서 자동 관리 | Let's Encrypt, X.509 |
| **Kyverno** | Incubating | K8s 네이티브 정책 엔진 | YAML 기반 정책 |

---

## 6. Zero Trust 보안 모델 심화

### 6.1 Zero Trust의 핵심 원칙

```
Zero Trust Architecture(ZTA)는 NIST SP 800-207에서 정의한 보안 아키텍처 모델이다.

핵심 원칙: "Never trust, always verify"
- 네트워크 위치(내부/외부)에 관계없이 모든 접근 요청에 대해 인증/인가를 수행한다
- 암묵적 신뢰(Implicit Trust)를 제거하고, 모든 세션에서 명시적 검증(Explicit Verification)을 요구한다
- 최소 권한 원칙(Least Privilege)과 마이크로 세그멘테이션(Microsegmentation)을 적용한다

전통적 경계 보안(Perimeter Security)과의 차이:
- 경계 보안: 방화벽 내부 = 신뢰 영역 → 내부자 위협(Insider Threat)에 취약
- Zero Trust: 모든 주체, 모든 요청을 개별 검증 → 내부 침해 시에도 횡적 이동(Lateral Movement) 차단
```

### 6.2 Zero Trust의 5가지 원칙

| 원칙 | 설명 | K8s 구현 |
|------|------|---------|
| **신원 확인** | 모든 접근에 인증 요구 | X.509, OIDC, SA Token |
| **최소 권한** | 필요 최소한의 권한만 부여 | RBAC, Role 분리 |
| **마이크로 세그멘테이션** | 네트워크를 세분화하여 격리 | NetworkPolicy, default-deny |
| **암호화** | 모든 통신 암호화 | mTLS, TLS, WireGuard |
| **지속적 검증** | 접근을 지속적으로 모니터링 | Audit Log, Falco |

### 6.3 Zero Trust를 Kubernetes에서 구현하는 방법

```yaml
# 1. 기본 거부 NetworkPolicy (마이크로 세그멘테이션)
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
  namespace: production
spec:
  podSelector: {}           # 모든 Pod
  policyTypes:
    - Ingress
    - Egress
# 효과: 모든 Pod의 인바운드/아웃바운드 트래픽 차단
# 이후 필요한 통신만 명시적으로 허용
---
# 2. 필요한 통신만 허용 (화이트리스트)
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-frontend-to-backend
  namespace: production
spec:
  podSelector:
    matchLabels:
      app: backend            # backend Pod에 대해
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: frontend   # frontend Pod에서 오는 것만 허용
      ports:
        - protocol: TCP
          port: 8080          # 8080 포트만 허용
```

```yaml
# 3. mTLS 강제 (Istio PeerAuthentication)
apiVersion: security.istio.io/v1beta1
kind: PeerAuthentication
metadata:
  name: strict-mtls
  namespace: production       # 네임스페이스 전체에 적용
spec:
  mtls:
    mode: STRICT              # mTLS만 허용, 평문 트래픽 거부
                              # PERMISSIVE: mTLS + 평문 모두 허용 (마이그레이션용)
                              # DISABLE: mTLS 비활성화
```

---

## 7. DevSecOps와 Shift Left 심화

### 7.1 Shift Left란?

```
전통적인 개발 파이프라인:
[코딩] → [빌드] → [테스트] → [스테이징] → [프로덕션] → [보안 검사 ← 여기서!]
                                                         문제 발견이 너무 늦다!
                                                         수정 비용이 매우 높다!

Shift Left 파이프라인:
[코딩 + 보안!] → [빌드 + 스캔!] → [테스트 + DAST!] → [스테이징] → [프로덕션]
 ↑ 여기서부터!     ↑ 이미지 스캔     ↑ 동적 분석
 IDE 플러그인      SAST              침투 테스트
 의존성 검사       SBOM 생성
 시크릿 스캔       이미지 서명
```

### 7.2 CI/CD 보안 파이프라인 예시

```
완전한 보안 CI/CD 파이프라인:

[1. 코드 커밋]
    ↓
[2. Pre-commit Hook]
    - 시크릿 스캔 (git-secrets, trufflehog)
    - 린팅 (보안 규칙 포함)
    ↓
[3. CI Pipeline (Jenkins/GitHub Actions)]
    - SAST: 정적 코드 분석 (SonarQube, Semgrep)
    - SCA: 의존성 취약점 검사 (Snyk, Dependabot)
    - 단위/통합 테스트
    ↓
[4. 이미지 빌드]
    - 최소 베이스 이미지 (distroless)
    - 멀티스테이지 빌드
    ↓
[5. 이미지 스캔]
    - Trivy: CVE 스캔
    - SBOM 생성 (Syft)
    ↓
[6. 이미지 서명]
    - Cosign으로 서명
    - 프라이빗 레지스트리에 푸시
    ↓
[7. CD Pipeline (ArgoCD)]
    - Admission Webhook: 서명 검증, 정책 준수 확인
    - GitOps: 선언적 배포
    ↓
[8. 런타임 모니터링]
    - Falco: 이상 행위 탐지
    - Prometheus/Grafana: 메트릭 모니터링
    - Audit Logging: API 요청 기록
```

### 7.3 주요 도구 비교

| 단계 | 도구 | 설명 | 유형 |
|------|------|------|------|
| 시크릿 스캔 | git-secrets, trufflehog | 코드에 하드코딩된 시크릿 탐지 | 정적 |
| SAST | SonarQube, Semgrep | 소스 코드 보안 분석 | 정적 |
| SCA | Snyk, Dependabot | 의존성 취약점 분석 | 정적 |
| 이미지 스캔 | Trivy, Grype, Clair | 이미지 CVE 스캔 | 정적 |
| SBOM | Syft, Trivy | 소프트웨어 구성 목록 생성 | 정적 |
| 이미지 서명 | Cosign, Notary | 이미지 출처/무결성 검증 | 서명 |
| DAST | OWASP ZAP | 동적 보안 분석 (실행 중 테스트) | 동적 |
| 런타임 | Falco, Sysdig | 런타임 이상 행위 탐지 | 동적 |

---

## 8. 핵심 개념 정리 (시험 직전 리뷰용)

### 8.1 4C 모델 요약

```
Cloud → Cluster → Container → Code (바깥 → 안쪽)

Cloud:     IAM, 방화벽, 물리 보안, 암호화
Cluster:   RBAC, NetworkPolicy, Admission, etcd 암호화
Container: SecurityContext, seccomp, 이미지 보안
Code:      TLS, Secret 관리, 입력 검증, 의존성 관리
```

### 8.2 STRIDE 요약

```
S - Spoofing     (위장)    → 인증 강화
T - Tampering    (변조)    → 무결성 검증, 서명
R - Repudiation  (부인)    → Audit Logging
I - Info Disclosure (정보노출) → 암호화, 접근 제한
D - Denial of Service (DoS) → ResourceQuota, LimitRange
E - Elevation    (권한상승)  → PSS, seccomp, 최소 권한
```

### 8.3 Zero Trust 요약

```
핵심: "Never trust, always verify"
5원칙: 신원확인 + 최소권한 + 마이크로세그멘테이션 + 암호화 + 지속적검증
K8s 구현: RBAC + default-deny NetworkPolicy + mTLS + Audit Log
```

---

## 9. 복습 체크리스트

- [ ] 4C 모델의 4개 계층을 순서대로 말할 수 있다 (Cloud → Cluster → Container → Code)
- [ ] 각 계층의 대표적인 보안 통제를 3개 이상 설명할 수 있다
- [ ] Defense in Depth 원칙을 한 문장으로 설명할 수 있다
- [ ] STRIDE 6가지 위협 유형을 모두 나열하고 K8s 예시를 들 수 있다
- [ ] Zero Trust의 핵심 원칙("Never trust, always verify")을 설명할 수 있다
- [ ] Zero Trust의 5가지 원칙과 K8s 구현 방법을 알고 있다
- [ ] CNCF Security TAG의 역할과 주요 산출물을 알고 있다
- [ ] Shift Left의 의미와 CI/CD에서의 적용을 설명할 수 있다
- [ ] 정적 분석(Trivy)과 동적 분석(Falco)의 차이를 설명할 수 있다
- [ ] 공유 책임 모델에서 고객과 클라우드 제공자의 책임 범위를 구분할 수 있다

---

## 내일 예고: Day 2 - 공급망 보안, 시험 패턴, 연습 문제

- 공급망 보안 (SBOM, Cosign, SLSA) 상세
- KCSA 시험 출제 패턴 분석
- 연습 문제 17문제 + 상세 해설
- 보안 용어 사전 및 약어 정리
- tart-infra 실습

---

## tart-infra 실습

### 실습 환경 설정

```bash
# dev 클러스터에 접속 (Zero Trust + mTLS가 적용된 보안 환경)
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/dev.yaml
kubectl get nodes
```

**예상 출력:**
```
NAME          STATUS   ROLES           AGE   VERSION
dev-master    Ready    control-plane   30d   v1.31.0
dev-worker1   Ready    <none>          30d   v1.31.0
```

### 실습 1: 4C 보안 모델 실습 — Cloud/Cluster/Container/Code

```bash
# [Cluster 레이어] API Server 보안 설정 확인
kubectl get pod kube-apiserver-dev-master -n kube-system -o yaml | grep -E "(--authorization-mode|--enable-admission)"

# [Cluster 레이어] NetworkPolicy 확인 (Zero Trust)
kubectl get ciliumnetworkpolicies -n demo --no-headers | wc -l
echo "CiliumNetworkPolicy 수 (Zero Trust 구현)"

# [Container 레이어] Pod SecurityContext 확인
kubectl get pods -n demo -o jsonpath='{range .items[*]}{.metadata.name}{" runAsNonRoot="}{.spec.securityContext.runAsNonRoot}{"\n"}{end}'

# [Container 레이어] mTLS 확인
kubectl get peerauthentication -n demo 2>/dev/null || echo "PeerAuthentication 확인"
```

**동작 원리:** 4C 보안 모델(Cloud, Cluster, Container, Code):
1. **Cloud**: 인프라 보안 — tart-infra는 로컬 VM이므로 호스트 OS(macOS) 보안이 해당
2. **Cluster**: K8s 보안 — RBAC, NetworkPolicy, Admission Controller, 인증서 관리
3. **Container**: 컨테이너 보안 — SecurityContext, 이미지 스캔, seccomp, AppArmor
4. **Code**: 애플리케이션 보안 — 시크릿 관리, 입력 검증, 의존성 취약점 점검
5. 각 레이어가 독립적으로 보안을 제공하여 Defense in Depth(심층 방어)를 구현한다

### 실습 2: Zero Trust 네트워크 확인

```bash
# Default Deny 정책 확인
kubectl get ciliumnetworkpolicy default-deny-all -n demo -o yaml | head -20

# 허용된 통신 경로 확인
kubectl get ciliumnetworkpolicies -n demo -o custom-columns=NAME:.metadata.name
```

**예상 출력:**
```
NAME
allow-dns
allow-httpbin-from-nginx
allow-nginx-ingress
allow-postgres-from-httpbin
allow-rabbitmq-from-httpbin
allow-redis-from-httpbin
default-deny-all
...
```

**동작 원리:** Zero Trust 네트워크 구현:
1. "아무것도 신뢰하지 않는다" — 기본적으로 모든 트래픽을 차단한다
2. `default-deny-all`: Ingress + Egress 모두 차단하는 기본 정책
3. 각 `allow-*` 정책이 필요한 통신만 명시적으로 허용한다
4. 허용 경로: nginx → httpbin → postgres/redis/rabbitmq (계층적 접근)
5. DNS(53 포트) 허용이 없으면 Service 이름으로 통신할 수 없다

### 실습 3: STRIDE 위협 모델 적용

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
