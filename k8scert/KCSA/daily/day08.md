# KCSA Day 8: 네트워크 보안, 노드 하드닝, 보안 시나리오, 연습 문제

> **시험 비중:** Platform Security — 16%, Kubernetes Threat Model — 16%
> **목표:** mTLS/Service Mesh 보안, 노드 하드닝, 실전 보안 시나리오를 학습하고, 연습 문제로 Day 7~8 범위를 점검한다.

---

## 1. 네트워크 보안 심화

### 1.0 등장 배경

```
기존 방식의 한계:
마이크로서비스 아키텍처에서 서비스 간 통신은 기본적으로 평문(HTTP)이다.
Kubernetes 내부 네트워크를 "신뢰 영역"으로 간주하는 경우가 많았지만:

1. Pod 네트워크는 기본적으로 암호화되지 않는다
2. 공격자가 하나의 Pod를 침해하면 네트워크 트래픽을 스니핑할 수 있다
3. 서비스 간 인증이 없으면 위조된 요청을 구분할 수 없다
4. 노드 간 통신도 평문이므로 물리 네트워크 탭핑에 취약하다

공격-방어 매핑:
- Spoofing(STRIDE) → mTLS 양방향 인증으로 서비스 신원 확인
- Information Disclosure(STRIDE) → TLS 암호화로 전송 중 데이터 보호

해결:
mTLS는 서비스 간 양방향 인증과 암호화를 제공한다.
Service Mesh(Istio, Linkerd)나 Cilium WireGuard로 구현하며,
애플리케이션 코드 변경 없이 투명하게 적용할 수 있다.
```

### 1.1 mTLS (Mutual TLS)

```
mTLS = 양방향 TLS 인증

일반 TLS:
  클라이언트 → 서버 인증서 검증 (단방향)
  예: 브라우저 → HTTPS 웹서버

mTLS:
  클라이언트 ←→ 서버 양방향 인증서 검증
  예: 마이크로서비스 A ←→ 마이크로서비스 B

mTLS의 보안 기능:
1. 암호화 (Encryption): 전송 중 데이터 보호
2. 인증 (Authentication): 양측 모두 신원 확인
3. 무결성 (Integrity): 데이터 변조 탐지

K8s에서 mTLS 구현:
┌──────────────────────────────────────────────┐
│ Service Mesh (Istio, Linkerd)                │
│   - 사이드카 프록시가 자동 mTLS               │
│   - 애플리케이션 코드 변경 불필요              │
│   - 인증서 자동 발급/갱신                      │
├──────────────────────────────────────────────┤
│ Cilium (WireGuard)                           │
│   - eBPF 기반 투명한 암호화                    │
│   - 사이드카 없이 노드 레벨 암호화             │
│   - 성능 영향 최소화                           │
└──────────────────────────────────────────────┘
```

### 1.2 Istio mTLS 모드

```
Istio PeerAuthentication mTLS 모드:

┌────────────────────────────────────────────────────────┐
│ STRICT (엄격)                                          │
│   - mTLS만 허용                                        │
│   - 평문 통신 거부                                      │
│   - ★ 프로덕션 권장                                    │
│                                                        │
│   apiVersion: security.istio.io/v1                     │
│   kind: PeerAuthentication                             │
│   metadata:                                            │
│     name: default                                      │
│     namespace: production                              │
│   spec:                                                │
│     mtls:                                              │
│       mode: STRICT                                     │
├────────────────────────────────────────────────────────┤
│ PERMISSIVE (허용적)                                     │
│   - mTLS + 평문 모두 수용                               │
│   - 마이그레이션 과도기에 사용                           │
│   - 사이드카가 없는 서비스와 통신 가능                   │
├────────────────────────────────────────────────────────┤
│ DISABLE                                                │
│   - mTLS 비활성화                                       │
│   - 보안 위험                                           │
└────────────────────────────────────────────────────────┘

★ 시험 빈출: "STRICT vs PERMISSIVE 차이는?"
→ STRICT = mTLS만 허용, PERMISSIVE = mTLS + 평문 모두 허용
```

### 1.3 Cilium 네트워크 보안

```
Cilium: eBPF 기반 CNI

Cilium의 보안 기능:

1. L3/L4 NetworkPolicy
   - 표준 K8s NetworkPolicy 지원
   - IP, 포트 기반 제어

2. L7 정책 (HTTP, gRPC, Kafka)
   - ★ 표준 NP에 없는 기능!
   - HTTP 메서드, 경로 기반 제어
   - 예: GET /api/v1/pods만 허용

3. WireGuard 투명 암호화
   - 노드 간 모든 트래픽 자동 암호화
   - 사이드카 불필요

4. Hubble (네트워크 관찰성)
   - 실시간 네트워크 흐름 시각화
   - 정책 위반 트래픽 식별

CiliumNetworkPolicy L7 예제:
```

```yaml
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: l7-api-policy
  namespace: production
spec:
  endpointSelector:
    matchLabels:
      app: api-server
  ingress:
    - fromEndpoints:
        - matchLabels:
            app: frontend
      toPorts:
        - ports:
            - port: "8080"
              protocol: TCP
          rules:
            http:
              - method: "GET"           # GET만 허용
                path: "/api/v1/.*"      # /api/v1/ 경로만
              - method: "POST"
                path: "/api/v1/orders"
```

### 1.4 Service Mesh 보안 비교

```
Service Mesh 보안 기능 비교:

┌──────────────┬──────────────┬──────────────┐
│              │ Istio        │ Linkerd      │
├──────────────┼──────────────┼──────────────┤
│ mTLS         │ ✓ STRICT     │ ✓ 기본 활성화 │
│ 인증 정책    │ ✓ 세밀       │ ✓ 기본       │
│ 인가 정책    │ ✓ RBAC 기반  │ ✓ Server 기반│
│ 외부 인증    │ ✓ JWT/OIDC   │ ✗            │
│ CNCF 상태    │ Graduated    │ Graduated    │
│ 리소스 사용  │ 높음         │ 낮음          │
│ 학습 곡선    │ 높음         │ 낮음          │
└──────────────┴──────────────┴──────────────┘
```

---

## 2. 노드 하드닝 (Node Hardening)

### 2.1 컨테이너 최적화 OS

```
컨테이너 워크로드 전용 최소 OS:

┌──────────────────────────────────────────────────────────┐
│ Bottlerocket (AWS)                                       │
│   - AWS 관리형 컨테이너 전용 OS                           │
│   - 불변 루트 파일시스템                                   │
│   - API 기반 설정 (SSH 없음)                               │
│   - 자동 업데이트                                         │
├──────────────────────────────────────────────────────────┤
│ Talos (Sidero Labs)                                      │
│   - K8s 전용 OS                                          │
│   - SSH 없음, API만으로 관리                               │
│   - 불변, 최소, 보안 강화                                  │
├──────────────────────────────────────────────────────────┤
│ Flatcar Container Linux                                  │
│   - CoreOS의 후속                                         │
│   - 자동 업데이트                                         │
│   - 컨테이너 전용 최소 OS                                  │
└──────────────────────────────────────────────────────────┘

컨테이너 최적화 OS를 사용하는 이유:
★ 공격 표면 축소 (Reduce Attack Surface)
  - 최소 패키지만 포함 → 취약점 감소
  - 불필요한 서비스 없음 → 공격 경로 차단
  - 불변 파일시스템 → 변조 방지
```

### 2.2 노드 보안 설정

```
Worker Node 보안 체크리스트:

1. OS 보안
   □ 최소 OS 사용 (Bottlerocket, Talos)
   □ 불필요한 패키지 제거
   □ 자동 보안 패치 적용
   □ SSH 접근 제한 (키 기반만, root 비활성화)

2. kubelet 보안 (Day 3 복습)
   □ anonymous-auth=false
   □ authorization-mode=Webhook
   □ read-only-port=0
   □ rotateCertificates=true
   □ protectKernelDefaults=true

3. 커널 보안
   □ seccomp 기본 프로파일 적용
   □ AppArmor 또는 SELinux 활성화
   □ sysctl 보안 파라미터 설정

4. 파일시스템 보안
   □ /etc/kubernetes/manifests/ 권한 700
   □ /var/lib/etcd/ 권한 700
   □ kubelet 인증서 파일 권한 600
   □ 파일 무결성 모니터링 (AIDE, Tripwire)

5. 네트워크 보안
   □ 방화벽으로 불필요한 포트 차단
   □ Control Plane 포트 (6443, 2379, 10250) 접근 제한
   □ 메타데이터 서비스(169.254.169.254) 접근 차단
```

### 2.3 메타데이터 서비스 보안

```
클라우드 메타데이터 서비스 (IMDS):

169.254.169.254 = 클라우드 인스턴스 메타데이터 서비스 주소

IMDS 공격 시나리오:
1. 공격자가 Pod 내에서 IMDS에 접근
2. 노드의 IAM 역할 자격 증명 탈취
3. 클라우드 리소스(S3, RDS 등)에 무단 접근

방어 방법:
1. NetworkPolicy로 IMDS 접근 차단
2. IMDSv2 사용 (토큰 기반, AWS)
3. Pod에 특정 IAM 역할만 할당 (IRSA, Workload Identity)
```

```yaml
# IMDS 접근 차단 NetworkPolicy
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: block-metadata
  namespace: production
spec:
  podSelector: {}
  policyTypes:
    - Egress
  egress:
    - to:
        - ipBlock:
            cidr: 0.0.0.0/0
            except:
              - 169.254.169.254/32    # IMDS 차단
```

---

## 3. 보안 시나리오 분석

### 시나리오 1: 컨테이너 탈출 공격

```
공격 흐름:
1. 공격자가 취약한 웹 앱의 RCE 취약점 악용
2. 컨테이너 내부에서 쉘 획득 (Execution)
3. privileged: true → 호스트 디바이스 접근
4. chroot /host → 호스트 파일시스템 접근
5. kubelet 자격 증명 탈취 (Credential Access)
6. 다른 노드로 이동 (Lateral Movement)

방어:
✓ PSA Restricted → privileged 금지
✓ Falco → 쉘 실행 탐지
✓ seccomp RuntimeDefault → 위험 syscall 차단
✓ RBAC → Pod 생성 권한 최소화
```

### 시나리오 2: SA 토큰 탈취

```
공격 흐름:
1. 공격자가 Pod 내에서 SA 토큰 읽기
   /var/run/secrets/kubernetes.io/serviceaccount/token
2. SA에 과도한 RBAC 권한이 있는 경우
3. 토큰으로 API Server에 접근
4. Secret 읽기, Pod 생성 등 악용

방어:
✓ automountServiceAccountToken: false → 불필요 시 비활성화
✓ Bound Token → 시간 제한 + Pod 삭제 시 무효
✓ RBAC 최소 권한 → SA에 필요한 최소 권한만
✓ Falco → /var/run/secrets 파일 접근 탐지
```

### 시나리오 3: 공급망 공격

```
공격 흐름:
1. 공격자가 인기 베이스 이미지에 백도어 삽입
2. 개발자가 해당 이미지로 빌드
3. CI/CD 파이프라인에서 이미지 스캔 없이 배포
4. 프로덕션에서 백도어 활성화
5. 데이터 탈취 (Impact)

방어:
✓ 이미지 스캔 (Trivy) → CVE 탐지
✓ 이미지 서명 (Cosign) → 무결성 검증
✓ SBOM 생성 (Syft) → 의존성 추적
✓ Admission Policy → 미서명 이미지 거부
✓ 프라이빗 레지스트리 → 검증된 이미지만 사용
```

---

## 4. 시험 출제 패턴 분석

```
패턴 1: "mTLS의 주요 기능은?"
  → 서비스 간 암호화 및 양방향 인증

패턴 2: "Istio STRICT vs PERMISSIVE?"
  → STRICT = mTLS만, PERMISSIVE = mTLS + 평문

패턴 3: "컨테이너 최적화 OS를 사용하는 이유는?"
  → 공격 표면 축소

패턴 4: "AppArmor complain vs enforce?"
  → complain = 로그만, enforce = 차단 + 로그

패턴 5: "seccomp RuntimeDefault의 특징은?"
  → 런타임이 제공하는 기본 프로파일, PSS Restricted에서 허용

패턴 6: "Falco가 탐지할 수 없는 것은?"
  → 코드의 SQL Injection 취약점 (SAST 도구 필요)
```

---

## 5. 연습 문제 (18문제 + 상세 해설)

### 문제 1.
MITRE ATT&CK에서 kubectl exec로 명령 실행은?

A) Initial Access
B) Execution
C) Persistence
D) Discovery

<details><summary>정답 확인</summary>

**정답: B) Execution**

**왜 정답인가:** kubectl exec는 이미 접근 가능한 컨테이너에서 악성 명령을 실행하는 것이므로 Execution 전술에 해당한다.

</details>

### 문제 2.
169.254.169.254 접근은 MITRE ATT&CK의 어떤 전술?

A) Execution
B) Credential Access
C) Impact
D) Persistence

<details><summary>정답 확인</summary>

**정답: B) Credential Access**

**왜 정답인가:** 클라우드 IMDS에서 IAM 자격 증명을 탈취하는 것은 Credential Access 전술이다.

</details>

### 문제 3.
SLSA Level 2에서 요구하는 것은?

A) 문서화
B) 서명된 출처 증명
C) 격리된 빌드
D) 2인 검토

<details><summary>정답 확인</summary>

**정답: B) 서명된 출처 증명**

**왜 정답인가:** L1=문서화, L2=서명된 출처 증명, L3=격리된 빌드, L4=2인 검토이다.

</details>

### 문제 4.
Falco가 탐지할 수 없는 것은?

A) 컨테이너 내 쉘 실행
B) 민감 파일 접근
C) 코드의 SQL Injection 취약점
D) 예상치 못한 네트워크 연결

<details><summary>정답 확인</summary>

**정답: C) 코드의 SQL Injection 취약점**

**왜 정답인가:** Falco는 런타임 행위(syscall) 모니터링 도구이다. 코드 취약점 탐지는 SAST 도구(SonarQube 등)의 영역이다.

</details>

### 문제 5.
mTLS의 주요 기능은?

A) 로드 밸런싱
B) 서비스 간 암호화 및 양방향 인증
C) 헬스 체크
D) 오토 스케일링

<details><summary>정답 확인</summary>

**정답: B) 서비스 간 암호화 및 양방향 인증**

**왜 정답인가:** mTLS는 클라이언트와 서버가 서로의 인증서를 검증하며, 통신을 암호화한다.

</details>

### 문제 6.
privileged: true의 위험성은?

A) 메모리 증가
B) 호스트의 모든 디바이스 접근 가능, 컨테이너 탈출 용이
C) 네트워크 지연
D) 로그 증가

<details><summary>정답 확인</summary>

**정답: B) 호스트의 모든 디바이스 접근 가능, 컨테이너 탈출 용이**

**왜 정답인가:** privileged 모드는 컨테이너에 호스트의 모든 디바이스와 커널 기능에 대한 접근 권한을 부여한다.

</details>

### 문제 7.
hostPath 볼륨 마운트의 위험은?

A) 디스크 부족
B) 호스트 파일시스템 접근으로 컨테이너 탈출 가능
C) 네트워크 저하
D) 스케줄링 지연

<details><summary>정답 확인</summary>

**정답: B) 호스트 파일시스템 접근으로 컨테이너 탈출 가능**

**왜 정답인가:** /etc/shadow, docker.sock 등 민감한 호스트 파일에 접근할 수 있다.

</details>

### 문제 8.
Istio STRICT vs PERMISSIVE의 차이는?

A) STRICT=외부 차단, PERMISSIVE=허용
B) STRICT=mTLS만, PERMISSIVE=mTLS+평문
C) 차이 없음
D) STRICT=갱신 안 함

<details><summary>정답 확인</summary>

**정답: B) STRICT=mTLS만, PERMISSIVE=mTLS+평문**

**왜 정답인가:** STRICT는 mTLS 연결만 허용하고, PERMISSIVE는 마이그레이션 과도기에 mTLS와 평문 모두 수용한다.

</details>

### 문제 9.
컨테이너 최적화 OS를 사용하는 이유는?

A) GUI 제공
B) 공격 표면 축소
C) 더 많은 앱 설치
D) 빠른 네트워크

<details><summary>정답 확인</summary>

**정답: B) 공격 표면 축소**

**왜 정답인가:** 최소 패키지만 포함하여 취약점을 줄이고, 불변 파일시스템으로 변조를 방지한다.

</details>

### 문제 10.
AppArmor complain vs enforce 차이는?

A) complain=차단, enforce=로그
B) complain=로그만, enforce=차단+로그
C) 차이 없음
D) complain=커널, enforce=사용자

<details><summary>정답 확인</summary>

**정답: B) complain=로그만, enforce=차단+로그**

**왜 정답인가:** complain 모드는 위반을 로그에만 기록하고 차단하지 않는다. enforce 모드는 차단하고 로그에도 기록한다.

</details>

### 문제 11.
seccomp RuntimeDefault 프로파일의 특징은?

A) 모든 시스템 콜 허용
B) 런타임 기본 프로파일
C) 커스텀만
D) 비활성화

<details><summary>정답 확인</summary>

**정답: B) 런타임 기본 프로파일**

**왜 정답인가:** containerd/CRI-O가 제공하는 기본 프로파일이며, PSS Restricted에서 허용되는 프로파일이다.

</details>

### 문제 12.
AppArmor와 SELinux의 관계는?

A) 동시 사용
B) 상호 배타적
C) AppArmor가 대체
D) 독립

<details><summary>정답 확인</summary>

**정답: B) 상호 배타적**

**왜 정답인가:** 하나의 시스템에서 AppArmor와 SELinux 중 하나만 사용할 수 있다. Ubuntu는 AppArmor, RHEL은 SELinux를 기본 사용한다.

</details>

### 문제 13.
컨테이너 격리를 강화하는 기술이 아닌 것은?

A) gVisor
B) Kata Containers
C) Docker Compose
D) seccomp

<details><summary>정답 확인</summary>

**정답: C) Docker Compose**

**왜 정답인가:** Docker Compose는 다중 컨테이너 조합 도구이지 격리 강화 기술이 아니다.

</details>

### 문제 14.
백도어 Pod를 배포하여 영구 접근을 유지하는 것은?

A) Execution
B) Persistence
C) Lateral Movement
D) Impact

<details><summary>정답 확인</summary>

**정답: B) Persistence**

**왜 정답인가:** 재부팅이나 Pod 삭제 후에도 접근을 유지하기 위한 기술은 Persistence 전술이다.

</details>

### 문제 15.
Cilium이 표준 NetworkPolicy보다 우수한 점은?

A) 기본 통신 허용
B) L7(HTTP) 정책 적용
C) RBAC 관리
D) Secret 암호화

<details><summary>정답 확인</summary>

**정답: B) L7(HTTP) 정책 적용**

**왜 정답인가:** Cilium은 eBPF 기반으로 HTTP 메서드, 경로 등 L7 수준의 접근 제어가 가능하다.

</details>

### 문제 16.
Falco의 CNCF 상태는?

A) Sandbox
B) Incubating
C) Graduated
D) Archived

<details><summary>정답 확인</summary>

**정답: C) Graduated**

**왜 정답인가:** Falco는 CNCF 졸업(Graduated) 프로젝트이다.

</details>

### 문제 17.
Pod에서 IMDS(169.254.169.254) 접근을 차단하는 방법은?

A) RBAC
B) NetworkPolicy egress deny
C) PSA
D) Audit Log

<details><summary>정답 확인</summary>

**정답: B) NetworkPolicy egress deny**

**왜 정답인가:** NetworkPolicy로 169.254.169.254/32를 except 목록에 추가하여 IMDS 접근을 차단한다.

</details>

### 문제 18.
Trivy와 Falco의 차이로 올바른 것은?

A) 둘 다 정적 분석
B) Trivy=정적 분석(이미지 스캔), Falco=동적 분석(런타임)
C) 둘 다 동적 분석
D) Trivy=런타임, Falco=빌드 타임

<details><summary>정답 확인</summary>

**정답: B) Trivy=정적 분석(이미지 스캔), Falco=동적 분석(런타임)**

**왜 정답인가:** Trivy는 이미지의 알려진 CVE를 스캔하는 정적 분석 도구이고, Falco는 실행 중인 컨테이너의 비정상 행위를 탐지하는 동적 분석 도구이다.

</details>

---

## 6. 핵심 암기 항목

```
네트워크 보안:
- mTLS: 양방향 TLS 인증 + 암호화
- Istio: STRICT(mTLS만) / PERMISSIVE(둘 다) / DISABLE
- Cilium: L7 정책, WireGuard 암호화, eBPF
- Flannel: NetworkPolicy 미지원!

노드 하드닝:
- 컨테이너 최적화 OS: Bottlerocket, Talos, Flatcar
- 사용 이유: 공격 표면 축소
- kubelet 보안: anonymous-auth=false, Webhook, port=0
- IMDS(169.254.169.254): NetworkPolicy로 차단

보안 시나리오:
- privileged → 컨테이너 탈출 → 호스트 접근
- SA 토큰 탈취 → API Server 접근 → Secret 읽기
- 공급망 → 악성 이미지 → 백도어 → 데이터 탈취
```

---

## 7. 복습 체크리스트

- [ ] mTLS의 양방향 인증 개념을 설명할 수 있다
- [ ] Istio STRICT/PERMISSIVE 차이를 안다
- [ ] Cilium의 L7 정책과 WireGuard를 설명할 수 있다
- [ ] 컨테이너 최적화 OS의 목적(공격 표면 축소)을 안다
- [ ] 노드 보안 체크리스트를 알고 있다
- [ ] IMDS(169.254.169.254) 방어 방법을 안다
- [ ] 컨테이너 탈출 시나리오와 방어를 설명할 수 있다
- [ ] SA 토큰 탈취 시나리오와 방어를 설명할 수 있다
- [ ] 연습 문제 18문제를 모두 풀 수 있다

---

## 내일 예고: Day 9 - Audit Logging, Compliance 프레임워크, 종합 모의시험 (전반)

- Audit Logging 4단계 레벨과 정책 설계
- Compliance 프레임워크 (CIS, NIST CSF, SOC 2, PCI DSS, GDPR)
- 종합 모의시험 37문제 (Overview, Cluster, Fundamentals, Threat 도메인)
- tart-infra 실습

---

## tart-infra 실습

### 실습 환경 설정

```bash
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/dev.yaml
kubectl get nodes
```

### 실습 1: mTLS 설정 확인

```bash
echo "=== mTLS 설정 확인 ==="

# Istio PeerAuthentication 확인
kubectl get peerauthentication -A 2>/dev/null || echo "Istio PeerAuthentication 미설정"

# Cilium 암호화 확인
kubectl get configmap cilium-config -n kube-system -o yaml 2>/dev/null | grep -E "(enable-wireguard|encrypt)" || echo "Cilium WireGuard 미설정"
```

**검증 — 기대 출력:**
```text
=== mTLS 설정 확인 ===
Istio PeerAuthentication 미설정
enable-wireguard: "false"
```
WireGuard가 false이고 Istio PeerAuthentication이 없으면 클러스터 내 통신이 암호화되지 않은 상태다.

**동작 원리:** mTLS 구현 방법:
1. **Istio**: PeerAuthentication STRICT 모드 → 사이드카 기반 자동 mTLS
2. **Cilium**: WireGuard → 노드 레벨 투명 암호화, 사이드카 불필요
3. **Linkerd**: 기본 활성화 → 경량 사이드카 기반 mTLS

### 실습 2: 노드 보안 점검

```bash
echo "=== 노드 보안 점검 ==="

# kubelet 포트 확인
echo "[kubelet 보안 포트]"
kubectl get pod kube-apiserver-dev-master -n kube-system -o yaml | grep -c "10250" || echo "10250 포트 미확인"

# Control Plane 컴포넌트 확인
echo ""
echo "[Control Plane Static Pods]"
kubectl get pods -n kube-system -o wide | grep -E "(apiserver|etcd|controller|scheduler)"
```

**동작 원리:** 노드 하드닝:
1. 컨테이너 최적화 OS(Bottlerocket, Talos)로 공격 표면 축소
2. kubelet 보안 설정 (anonymous-auth=false, Webhook, port=0)
3. 파일 권한 제한 (/etc/kubernetes/manifests/ = 700)
4. IMDS(169.254.169.254) 접근 차단

### 실습 3: 보안 위험 탐지

```bash
echo "=== 보안 위험 탐지 ==="

# privileged 컨테이너 탐지
echo "[privileged 컨테이너]"
kubectl get pods -A -o json | python3 -c "
import json, sys
data = json.load(sys.stdin)
for pod in data.get('items', []):
    ns = pod['metadata']['namespace']
    name = pod['metadata']['name']
    for c in pod['spec'].get('containers', []):
        sc = c.get('securityContext', {})
        if sc.get('privileged'):
            print(f'  {ns}/{name}/{c[\"name\"]}: privileged=true')
" 2>/dev/null || echo "  점검 실패"

# hostNetwork 사용
echo ""
echo "[hostNetwork 사용 Pod]"
kubectl get pods -A -o json | python3 -c "
import json, sys
data = json.load(sys.stdin)
for pod in data.get('items', []):
    if pod['spec'].get('hostNetwork'):
        print(f'  {pod[\"metadata\"][\"namespace\"]}/{pod[\"metadata\"][\"name\"]}')
" 2>/dev/null || echo "  점검 실패"
```

**검증 — 기대 출력:**
```text
=== 보안 위험 탐지 ===
[privileged 컨테이너]
  kube-system/kube-proxy-.../kube-proxy: privileged=true

[hostNetwork 사용 Pod]
  kube-system/kube-apiserver-dev-master
  kube-system/etcd-dev-master
```
kube-system의 Control Plane 컴포넌트는 특권이 필요하므로 정상이다. 사용자 네임스페이스에서 발견되면 보안 위험이다.

**동작 원리:** 위험 설정 탐지:
1. `privileged: true` → 호스트 디바이스 접근, 컨테이너 탈출 가능
2. `hostNetwork: true` → 네트워크 격리 무효화
3. `hostPath` → 호스트 파일시스템 접근
4. PSA Restricted로 이러한 설정을 자동 차단 가능

### 트러블슈팅: 네트워크 보안 및 노드 하드닝 문제

```
장애 시나리오 1: Istio mTLS STRICT 적용 후 서비스 통신 실패
  증상: 503 Service Unavailable, "upstream connect error"
  원인: 사이드카가 주입되지 않은 Pod가 STRICT 정책 대상 서비스에 접근
  디버깅:
    kubectl get pod <pod-name> -o jsonpath='{.spec.containers[*].name}'
    # istio-proxy가 없으면 사이드카 미주입 상태
    istioctl analyze -n <namespace>
  해결: PERMISSIVE 모드로 전환 후 사이드카 주입을 완료하고
        단계적으로 STRICT로 전환한다

장애 시나리오 2: IMDS(169.254.169.254) 접근으로 IAM 자격 증명 탈취
  증상: Pod 내부에서 curl 169.254.169.254로 노드의 IAM 역할 토큰 획득
  공격-방어 매핑: Credential Access(MITRE ATT&CK) → IMDS를 통한 자격 증명 탈취
  디버깅:
    kubectl exec <pod> -- curl -s http://169.254.169.254/latest/meta-data/
  해결: NetworkPolicy로 IMDS 접근을 차단하고,
        IMDSv2(토큰 기반)로 전환하며,
        IRSA/Workload Identity로 Pod별 IAM 역할을 할당한다
```
