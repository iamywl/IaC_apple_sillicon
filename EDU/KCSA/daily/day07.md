# KCSA Day 7: MITRE ATT&CK, 공급망 보안 심화, 런타임 보안

> **시험 비중:** Kubernetes Threat Model — 16%, Platform Security — 16%
> **목표:** MITRE ATT&CK for Containers의 9대 전술을 이해하고, 이미지 서명/검증 파이프라인과 런타임 보안 도구(Falco, seccomp, AppArmor, SELinux)를 마스터한다.

---

## 1. MITRE ATT&CK for Containers

### 1.1 MITRE ATT&CK이란?

```
MITRE ATT&CK = 실제 공격 사례 기반의 전술/기술 프레임워크

MITRE Corporation이 실제 사이버 공격을 분석하여 만든 지식 베이스이다.
"공격자가 어떤 단계를 거쳐 목표를 달성하는가"를 체계적으로 분류한다.

MITRE ATT&CK for Containers:
- Kubernetes/Docker 환경에 특화된 공격 전술/기술 매트릭스
- 컨테이너 환경 고유의 공격 벡터를 분류
- 방어 전략 수립의 기준 프레임워크
```

### 1.2 9대 전술(Tactics) 상세

```
MITRE ATT&CK for Containers 9대 전술:

┌──────────────────────────────────────────────────────────────┐
│ 1. Initial Access (초기 접근)                                 │
│    "클러스터에 최초 진입"                                      │
│    - 취약한 공개 서비스 악용                                    │
│    - 취약한 이미지 배포                                        │
│    - 노출된 kubeconfig/API Server                             │
│    - 공급망 공격 (악성 이미지)                                  │
│    방어: NetworkPolicy, 이미지 스캔, API Server 접근 제한       │
├──────────────────────────────────────────────────────────────┤
│ 2. Execution (실행)                                           │
│    "악성 코드/명령 실행"                                       │
│    - kubectl exec로 컨테이너 내 명령 실행                       │
│    - 악성 이미지 실행                                          │
│    - 크립토마이너 배포                                         │
│    방어: PSA Restricted, RBAC, Falco 모니터링                  │
├──────────────────────────────────────────────────────────────┤
│ 3. Persistence (지속성)                                       │
│    "접근을 유지"                                               │
│    - 백도어 Pod 배포                                           │
│    - 악성 CronJob 생성                                        │
│    - Static Pod 매니페스트 삽입                                 │
│    - 악성 Admission Webhook 등록                               │
│    방어: RBAC 최소 권한, 이미지 서명 검증, 파일 무결성 모니터링   │
├──────────────────────────────────────────────────────────────┤
│ 4. Privilege Escalation (권한 상승)                             │
│    "더 높은 권한 획득"                                         │
│    - privileged: true 컨테이너                                 │
│    - hostPID/hostNetwork 사용                                  │
│    - RBAC escalate/bind verb 악용                              │
│    - 노드에서 kubelet 자격 증명 탈취                            │
│    방어: PSA Restricted, RBAC 최소 권한, NodeRestriction        │
├──────────────────────────────────────────────────────────────┤
│ 5. Defense Evasion (방어 회피)                                 │
│    "탐지를 피함"                                               │
│    - Pod 로그 삭제                                             │
│    - 이미지 없이 실행 (exec 활용)                               │
│    - 정상 프로세스로 위장                                       │
│    방어: Audit Logging, Falco, 불변 컨테이너                   │
├──────────────────────────────────────────────────────────────┤
│ 6. Credential Access (자격 증명 접근)                           │
│    "인증 정보 탈취"                                            │
│    - SA 토큰 탈취 (/var/run/secrets/.../token)                 │
│    - Secret 오브젝트 접근                                      │
│    - 169.254.169.254 IMDS 접근 (클라우드 IAM 자격 증명 탈취)    │
│    - etcd 직접 접근                                            │
│    방어: automount 비활성화, RBAC, NP로 IMDS 차단              │
├──────────────────────────────────────────────────────────────┤
│ 7. Discovery (탐색)                                           │
│    "환경 정보 수집"                                            │
│    - kubectl get pods/secrets/configmaps                      │
│    - API Server 디스커버리 엔드포인트                           │
│    - 네트워크 스캐닝                                           │
│    방어: RBAC 최소 권한, NetworkPolicy                         │
├──────────────────────────────────────────────────────────────┤
│ 8. Lateral Movement (횡적 이동)                                │
│    "다른 컨테이너/노드로 이동"                                  │
│    - 탈취한 SA 토큰으로 다른 NS 접근                            │
│    - 클러스터 내부 서비스 악용                                   │
│    - 컨테이너 탈출 후 노드 접근                                 │
│    방어: NetworkPolicy, mTLS, 네임스페이스 격리                 │
├──────────────────────────────────────────────────────────────┤
│ 9. Impact (영향)                                               │
│    "최종 목표 달성"                                            │
│    - 데이터 유출                                               │
│    - 크립토마이닝                                              │
│    - 서비스 중단 (DoS)                                         │
│    - 데이터 파괴                                               │
│    방어: 백업, ResourceQuota, 모니터링, 알림                    │
└──────────────────────────────────────────────────────────────┘
```

### 1.3 MITRE ATT&CK 시험 빈출 매핑

```
키워드 → 전술 매핑 (시험 빈출):

"kubectl exec로 명령 실행"        → Execution
"백도어 Pod 배포"                 → Persistence
"privileged: true"               → Privilege Escalation
"169.254.169.254 접근"           → Credential Access ★
"SA 토큰 탈취"                   → Credential Access
"다른 NS의 Pod 접근"             → Lateral Movement
"크립토마이너 배포"               → Impact
"Pod 로그 삭제"                  → Defense Evasion
"취약한 이미지 배포"              → Initial Access
```

---

## 2. 공급망 보안 심화 (Supply Chain Security)

### 2.1 이미지 서명/검증 파이프라인

```
공급망 보안 파이프라인:

[소스 코드]
    │
    ▼
[빌드] ──────────── SLSA: 빌드 환경 보안
    │
    ▼
[이미지 생성]
    │
    ▼
[SBOM 생성] ──────── Syft: 의존성 목록 추출
    │                  형식: SPDX, CycloneDX
    │
    ▼
[취약점 스캔] ─────── Trivy, Grype: CVE 스캔
    │                  ★ 정적 분석 (Static Analysis)
    │
    ▼
[이미지 서명] ─────── Cosign (Sigstore): 키리스 서명
    │                  서명 = OCI 레지스트리에 저장
    │
    ▼
[레지스트리 저장] ──── 서명된 이미지 + SBOM + 취약점 보고서
    │
    ▼
[배포 시 검증] ─────── Kyverno/Connaisseur: 서명 검증
    │                   미서명 이미지 → 배포 거부
    │
    ▼
[런타임 모니터링] ──── Falco: 런타임 행위 탐지
                       ★ 동적 분석 (Dynamic Analysis)
```

### 2.2 Cosign 상세

```
Cosign (Sigstore 프로젝트):

컨테이너 이미지 서명/검증 도구

서명 방식:
1. 키 기반 서명 (Key-based)
   - cosign generate-key-pair → cosign.key, cosign.pub
   - cosign sign --key cosign.key myimage:v1
   - cosign verify --key cosign.pub myimage:v1

2. 키리스 서명 (Keyless) ★ 권장
   - OIDC 인증 기반 (GitHub, Google 등)
   - 별도 키 관리 불필요
   - Sigstore의 Fulcio CA가 임시 인증서 발급
   - 서명 이력은 Rekor 투명성 로그에 기록

서명 저장 위치:
- OCI 레지스트리에 별도 태그로 저장
- 이미지와 함께 배포/관리
```

### 2.3 SLSA (Supply-chain Levels for Software Artifacts)

```
SLSA 4단계 레벨:

┌─────────────────────────────────────────────────────┐
│ Level 1: 문서화 (Documentation)                      │
│   - 빌드 프로세스가 문서화됨                          │
│   - 출처 증명(Provenance) 생성                       │
│   - 자동화 불필요                                    │
├─────────────────────────────────────────────────────┤
│ Level 2: 서명된 출처 증명 (Signed Provenance)         │
│   - 출처 증명에 서명 추가                             │
│   - 호스팅된 빌드 서비스 사용                          │
│   - 위변조 탐지 가능                                  │
├─────────────────────────────────────────────────────┤
│ Level 3: 격리된 빌드 (Isolated Build)                 │
│   - 빌드 환경이 격리됨                                │
│   - 빌드 정의에 의해 완전히 결정 (Hermetic)            │
│   - 빌드 환경 변조 방지                               │
├─────────────────────────────────────────────────────┤
│ Level 4: 2인 검토 (Two-Person Review)                 │
│   - 모든 변경에 2인 이상 검토 필요                     │
│   - 가장 높은 보안 수준                               │
│   - 내부자 위협 방지                                  │
└─────────────────────────────────────────────────────┘

★ 시험 빈출: "SLSA Level 2에서 요구하는 것은?" → 서명된 출처 증명
★ 암기법: L1(문서) → L2(서명) → L3(격리) → L4(검토)
```

### 2.4 이미지 스캐닝 도구 비교

```
정적 분석(Static) vs 동적 분석(Dynamic):

┌──────────────────┬─────────────────┬─────────────────┐
│                  │ 정적 분석        │ 동적 분석        │
├──────────────────┼─────────────────┼─────────────────┤
│ 시점             │ 빌드/배포 전     │ 런타임 중        │
│ 대상             │ 이미지 파일      │ 실행 중 컨테이너  │
│ 도구             │ Trivy, Grype    │ Falco            │
│ 탐지 대상        │ CVE, 설정 오류   │ 비정상 행위       │
│ CNCF 상태        │ -               │ Graduated (Falco)│
│ 한계             │ 0-day 탐지 불가  │ 성능 영향 가능    │
└──────────────────┴─────────────────┴─────────────────┘

★ 시험 빈출: "Trivy와 Falco의 차이는?"
→ Trivy = 정적 분석 (이미지 스캔), Falco = 동적 분석 (런타임 행위)
```

---

## 3. 런타임 보안 (Runtime Security)

### 3.1 Falco 심화

```
Falco: CNCF Graduated 프로젝트

Falco의 동작 원리:

[커널 레벨]
    │ eBPF 드라이버 (또는 커널 모듈)
    │ 시스템 콜(syscall) 수집
    ▼
[Falco 엔진]
    │ 규칙(Rule) 기반 패턴 매칭
    │ YAML 규칙 파일
    ▼
[알림]
    → stdout, syslog, Slack, webhook
    → Falcosidekick으로 다양한 출력 연동

Falco가 탐지하는 것:
✓ 컨테이너 내 쉘 실행 (bash, sh)
✓ 민감 파일 접근 (/etc/shadow, /etc/passwd)
✓ 예상치 못한 네트워크 연결
✓ 권한 상승 시도
✓ 크립토마이너 프로세스
✓ 컨테이너 탈출 시도

Falco가 탐지할 수 없는 것:
✗ 코드의 SQL Injection 취약점 → SAST 도구 필요
✗ 이미지의 알려진 CVE → Trivy 필요
✗ 네트워크 트래픽 내용 분석 → IDS/WAF 필요

Falco 데이터 소스:
1. 시스템 콜 (eBPF) ← 핵심
2. K8s Audit Log
3. AWS CloudTrail
```

### 3.2 Falco 규칙 예제

```yaml
# Falco 규칙 구조
- rule: Terminal Shell in Container
  desc: 컨테이너 내에서 터미널 쉘이 실행됨
  condition: >
    spawned_process and
    container and
    proc.name in (bash, sh, zsh) and
    not proc.pname in (cron, supervisord)
  output: >
    Shell spawned in container
    (user=%user.name container=%container.name
     image=%container.image.repository
     shell=%proc.name parent=%proc.pname)
  priority: WARNING
  tags: [container, shell, mitre_execution]

- rule: Read Sensitive Files
  desc: 민감한 파일이 읽혔음
  condition: >
    open_read and
    container and
    fd.name in (/etc/shadow, /etc/passwd, /etc/kubernetes/admin.conf)
  output: >
    Sensitive file read (file=%fd.name container=%container.name)
  priority: CRITICAL
  tags: [container, filesystem, mitre_credential_access]
```

### 3.3 seccomp (Secure Computing Mode)

```
seccomp는 컨테이너가 사용할 수 있는 시스템 콜(syscall)을 제한한다.

3가지 프로파일:

┌────────────────────────────────────────────────────────┐
│ RuntimeDefault                                         │
│   - 컨테이너 런타임(containerd/CRI-O)이 제공하는       │
│     기본 프로파일                                       │
│   - 대부분의 위험한 syscall 차단                         │
│   - PSS Restricted에서 허용                             │
│   - ★ 권장 설정                                        │
├────────────────────────────────────────────────────────┤
│ Localhost                                              │
│   - 노드의 로컬 파일에 정의된 커스텀 프로파일            │
│   - 워크로드에 맞게 세밀하게 조정 가능                   │
│   - /var/lib/kubelet/seccomp/ 디렉토리에 저장           │
│   - PSS Restricted에서 허용                             │
├────────────────────────────────────────────────────────┤
│ Unconfined                                             │
│   - seccomp 미적용 (모든 syscall 허용)                  │
│   - ★ PSS Restricted에서 금지!                         │
│   - 보안 위험                                          │
└────────────────────────────────────────────────────────┘
```

#### seccomp 설정 YAML

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: seccomp-pod
spec:
  securityContext:
    seccompProfile:
      type: RuntimeDefault          # ★ 권장

  # 또는 Localhost 프로파일:
  # securityContext:
  #   seccompProfile:
  #     type: Localhost
  #     localhostProfile: profiles/my-profile.json

  containers:
    - name: app
      image: nginx:1.27
```

### 3.4 AppArmor

```
AppArmor: Linux 커널 보안 모듈 (MAC - Mandatory Access Control)

3가지 모드:

┌────────────────────────────────────────────────────────┐
│ enforce (강제)                                         │
│   - 정책 위반 시 차단 + 로그 기록                       │
│   - 프로덕션 환경 권장                                  │
├────────────────────────────────────────────────────────┤
│ complain (불평/학습)                                    │
│   - 정책 위반 시 로그만 기록 (차단하지 않음!)            │
│   - 정책 개발/테스트 시 사용                             │
│   - ★ 시험 빈출: "complain 모드의 동작은?" → 로그만     │
├────────────────────────────────────────────────────────┤
│ unconfined                                             │
│   - AppArmor 미적용                                    │
│   - 보안 위험                                          │
└────────────────────────────────────────────────────────┘

AppArmor vs SELinux:
★★★ 상호 배타적! 하나의 시스템에서 둘 중 하나만 사용!

┌──────────────────┬──────────────────┐
│ AppArmor         │ SELinux          │
├──────────────────┼──────────────────┤
│ 경로 기반        │ 라벨 기반         │
│ Ubuntu/SUSE      │ RHEL/CentOS      │
│ 설정 쉬움        │ 설정 복잡         │
│ 프로파일 로드     │ 정책 로드         │
└──────────────────┴──────────────────┘
```

#### AppArmor 설정 YAML (K8s 1.30+)

```yaml
# K8s 1.30+ AppArmor 설정 (securityContext 방식)
apiVersion: v1
kind: Pod
metadata:
  name: apparmor-pod
spec:
  containers:
    - name: app
      image: nginx:1.27
      securityContext:
        appArmorProfile:
          type: RuntimeDefault      # 런타임 기본 프로파일
          # type: Localhost
          # localhostProfile: my-custom-profile
```

### 3.5 SELinux

```
SELinux: Security-Enhanced Linux

라벨 기반 접근 제어 (Label-based MAC):
- 모든 파일, 프로세스, 포트에 보안 라벨(컨텍스트) 부여
- 라벨 규칙에 의해 접근 허용/차단

SELinux 컨텍스트 형식:
user:role:type:level
예: system_u:system_r:container_t:s0

K8s Pod에서 SELinux 설정:
```

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: selinux-pod
spec:
  securityContext:
    seLinuxOptions:
      level: "s0:c123,c456"    # MCS 라벨 (Multi-Category Security)
  containers:
    - name: app
      image: nginx:1.27
```

### 3.6 위험한 SecurityContext 설정

```
컨테이너 보안 위험 설정:

┌─────────────────────────┬─────────────────────────────────────┐
│ 위험 설정               │ 위험 이유                            │
├─────────────────────────┼─────────────────────────────────────┤
│ privileged: true        │ 호스트의 모든 디바이스 접근 가능       │
│                         │ 컨테이너 탈출 용이!                   │
├─────────────────────────┼─────────────────────────────────────┤
│ hostNetwork: true       │ 호스트 네트워크 네임스페이스 공유      │
│                         │ 네트워크 격리 무효화                   │
├─────────────────────────┼─────────────────────────────────────┤
│ hostPID: true           │ 호스트 프로세스 목록 접근 가능         │
│                         │ 프로세스 신호 전송 가능                │
├─────────────────────────┼─────────────────────────────────────┤
│ hostIPC: true           │ 호스트 IPC 네임스페이스 공유           │
│                         │ 다른 프로세스와 메모리 공유            │
├─────────────────────────┼─────────────────────────────────────┤
│ hostPath 볼륨           │ 호스트 파일시스템 직접 접근            │
│ (특히 /, /etc, /var)    │ /etc/shadow, docker.sock 접근 가능   │
├─────────────────────────┼─────────────────────────────────────┤
│ capabilities.add:       │ 거의 privileged와 동일한 권한         │
│   - SYS_ADMIN           │ 네임스페이스 조작, 마운트 등          │
└─────────────────────────┴─────────────────────────────────────┘

★ 시험 빈출:
"privileged: true의 위험은?" → 호스트 디바이스 접근, 컨테이너 탈출
"hostPath 볼륨의 위험은?" → 호스트 파일시스템 접근, 컨테이너 탈출
```

### 3.7 컨테이너 격리 강화 기술

```
격리 강화 기술 비교:

┌──────────────────────────────────────────────────────────┐
│ gVisor (Google)                                          │
│   - 사용자 공간 커널 (User-space Kernel)                   │
│   - syscall을 가로채서 제한된 커널로 처리                   │
│   - 경량이지만 일부 호환성 문제                            │
│   - RuntimeClass: runsc                                   │
├──────────────────────────────────────────────────────────┤
│ Kata Containers                                          │
│   - 경량 VM 기반 격리                                     │
│   - 각 컨테이너가 별도 마이크로 VM에서 실행                 │
│   - 가장 강력한 격리 (하드웨어 수준)                        │
│   - 오버헤드 있음                                         │
│   - RuntimeClass: kata                                    │
├──────────────────────────────────────────────────────────┤
│ ★ Docker Compose는 격리 기술이 아니다!                    │
│   시험 함정: "격리를 강화하는 것은?" 선택지에 Docker Compose  │
│   가 있으면 이것은 오답!                                   │
└──────────────────────────────────────────────────────────┘
```

---

## 4. 핵심 암기 항목

```
MITRE ATT&CK:
- 9전술: Initial Access → Execution → Persistence → PrivEsc
         → Defense Evasion → Credential Access → Discovery
         → Lateral Movement → Impact
- kubectl exec → Execution
- 백도어 Pod → Persistence
- privileged → Privilege Escalation
- 169.254.169.254 → Credential Access ★
- SA 토큰 탈취 → Credential Access
- 크립토마이너 → Impact

공급망 보안:
- SLSA: L1(문서) → L2(서명) → L3(격리) → L4(검토)
- Cosign: 이미지 서명/검증 (Sigstore)
- Trivy: 정적 분석 (이미지 스캔)
- Falco: 동적 분석 (런타임)
- SBOM: SPDX(Linux Foundation), CycloneDX(OWASP)

런타임 보안:
- Falco: CNCF Graduated, eBPF, 런타임 행위 탐지
  - 탐지 가능: 쉘 실행, 민감 파일 접근, 네트워크 연결
  - 탐지 불가: SQL Injection (코드 취약점)
- seccomp: RuntimeDefault(권장) / Localhost / Unconfined(위험)
- AppArmor: enforce(차단) / complain(로그만!) / unconfined
- AppArmor ↔ SELinux: 상호 배타적! ★★★
- 위험 설정: privileged, hostNetwork, hostPID, hostPath, SYS_ADMIN
- 격리 강화: gVisor, Kata Containers (Docker Compose 아님!)
```

---

## 5. 복습 체크리스트

- [ ] MITRE ATT&CK 9대 전술을 순서대로 나열할 수 있다
- [ ] 키워드-전술 매핑 (exec→Execution, 169.254→Credential Access 등)을 안다
- [ ] SLSA 4단계 레벨을 순서대로 기억한다
- [ ] Cosign의 키리스 서명 방식을 설명할 수 있다
- [ ] 정적 분석(Trivy)과 동적 분석(Falco)을 구분할 수 있다
- [ ] Falco의 동작 원리(eBPF)와 탐지 범위를 알고 있다
- [ ] seccomp 3가지 프로파일을 나열할 수 있다
- [ ] AppArmor 3가지 모드와 complain의 동작을 안다
- [ ] AppArmor와 SELinux가 상호 배타적임을 알고 있다
- [ ] 위험한 SecurityContext 설정을 나열할 수 있다
- [ ] gVisor/Kata Containers의 격리 방식 차이를 안다

---

## 내일 예고: Day 8 - 네트워크 보안, 노드 하드닝, 보안 시나리오, 연습 문제

- 네트워크 보안 (mTLS, CNI, Service Mesh)
- 노드 하드닝 (최소 OS, 커널 보안)
- 보안 시나리오 분석
- 연습 문제 18문제 + 상세 해설
- tart-infra 실습

---

## tart-infra 실습

### 실습 환경 설정

```bash
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/dev.yaml
kubectl get nodes
```

### 실습 1: 컨테이너 보안 컨텍스트 확인

```bash
echo "=== Pod SecurityContext 확인 ==="
kubectl get pods -n demo -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{.spec.securityContext}{"\n\n"}{end}' 2>/dev/null || echo "Pod 없음"
```

**동작 원리:** SecurityContext 확인 항목:
1. `runAsNonRoot: true` — root 실행 방지
2. `allowPrivilegeEscalation: false` — 권한 상승 방지
3. `capabilities.drop: ["ALL"]` — 모든 capability 제거
4. `seccompProfile.type: RuntimeDefault` — syscall 제한

### 실습 2: 위험한 설정 탐지

```bash
echo "=== privileged 컨테이너 탐지 ==="
kubectl get pods -A -o jsonpath='{range .items[*]}{range .spec.containers[*]}{.name}{"\t"}{.securityContext.privileged}{"\n"}{end}{end}' 2>/dev/null | grep true || echo "privileged 컨테이너 없음"

echo ""
echo "=== hostNetwork 사용 Pod ==="
kubectl get pods -A -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.hostNetwork}{"\n"}{end}' 2>/dev/null | grep true || echo "hostNetwork 사용 Pod 없음"
```

**동작 원리:** 위험한 SecurityContext:
1. `privileged: true` → 호스트 디바이스 접근, 컨테이너 탈출 가능
2. `hostNetwork: true` → 네트워크 격리 무효화
3. `hostPID: true` → 호스트 프로세스 접근
4. `hostPath` → 호스트 파일시스템 접근

### 실습 3: 이미지 태그 점검

```bash
echo "=== 이미지 태그 점검 ==="
echo "[latest 태그 사용]:"
kubectl get pods -n demo -o jsonpath='{range .items[*]}{range .spec.containers[*]}{.image}{"\n"}{end}{end}' 2>/dev/null | grep -E "(:latest$|[^:]+$)" || echo "  없음"

echo ""
echo "[고정 태그 사용]:"
kubectl get pods -n demo -o jsonpath='{range .items[*]}{range .spec.containers[*]}{.image}{"\n"}{end}{end}' 2>/dev/null | grep -v -E "(:latest$|[^:]+$)" || echo "  없음"
```

**동작 원리:** 이미지 보안:
1. latest 태그 → 재현 불가, 의도치 않은 업데이트 위험
2. 고정 태그(버전) 또는 다이제스트(@sha256:...) 사용 권장
3. Cosign으로 서명/검증하여 무결성 보장
4. Kyverno/OPA로 latest 태그 금지 정책 적용

### 실습 4: MITRE ATT&CK 매핑 확인

```bash
echo "=== MITRE ATT&CK 방어 현황 ==="
echo ""

echo "[Initial Access 방어]"
echo "  API Server 접근 제한: $(kubectl get pod kube-apiserver-dev-master -n kube-system -o yaml 2>/dev/null | grep -c 'authorization-mode=Node,RBAC') (1=활성화)"

echo ""
echo "[Credential Access 방어]"
echo "  etcd TLS: $(kubectl get pod etcd-dev-master -n kube-system -o yaml 2>/dev/null | grep -c 'client-cert-auth=true') (1=활성화)"

echo ""
echo "[Execution 방어]"
echo "  PSA 레이블: $(kubectl get ns demo --show-labels 2>/dev/null | grep -c 'pod-security')"
```

**동작 원리:** MITRE ATT&CK 방어 매핑:
1. Initial Access → NetworkPolicy, 이미지 스캔, API Server 인증
2. Execution → PSA Restricted, RBAC, Falco
3. Credential Access → automount 비활성화, etcd TLS, RBAC
4. Lateral Movement → NetworkPolicy, mTLS, NS 격리
