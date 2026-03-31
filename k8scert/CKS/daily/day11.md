# CKS Day 11: Monitoring, Logging & Runtime Security (1/2) - Falco, Audit Log, Sysdig, 컨테이너 불변성

> 학습 목표 | CKS 도메인: Monitoring, Logging & Runtime Security (20%) | 예상 소요 시간: 2시간

---

## 오늘의 학습 목표

- Falco 규칙을 작성하여 syscall 기반 이상 행위를 탐지할 수 있다
- Kubernetes Audit Log를 분석하여 보안 이벤트를 식별할 수 있다
- 이상 행위를 탐지하고 대응 절차를 수행할 수 있다
- Sysdig로 시스템콜을 분석할 수 있다
- 컨테이너 불변성(Immutable Infrastructure)을 구현할 수 있다

---

### 등장 배경: 런타임 보안이 필요한 이유

```
기존 방식의 한계와 공격-방어 매핑
══════════════════════════════════

기존 방식: 이미지 스캔(Trivy), 정적 분석(kubesec), 정책 엔진(Gatekeeper)은
  모두 배포 전(pre-deployment) 보안이다. 런타임에 발생하는 이상 행위는
  탐지하지 못한다.

한계: 0-day 취약점, 합법적 이미지 내부의 악성 스크립트 실행, 런타임
  credential 탈취 등은 배포 전 검사로 방지할 수 없다.

[공격] 컨테이너 내 셸 실행 후 lateral movement
  - 공격자가 웹 취약점으로 RCE를 획득, 컨테이너 내에서 bash를 실행한다
  - SA 토큰(/var/run/secrets/)을 탈취하여 API Server에 접근한다
  → [방어] Falco: spawned_process + container + proc.name in (bash, sh)

[공격] 크립토마이닝 (Cryptojacking)
  - 공격자가 컨테이너에 마이닝 바이너리를 다운로드하고 실행한다
  - CPU 사용량이 급증하며 외부 마이닝 풀로 네트워크 연결이 발생한다
  → [방어] Falco: 외부 IP 연결 탐지 + 바이너리 디렉토리 쓰기 탐지
  → [방어] Prometheus: CPU 사용량 임계값 알림

[공격] Credential 파일 접근
  - /etc/shadow, SA 토큰, kubeconfig 등 민감 파일을 읽어 권한을 탈취한다
  → [방어] Falco: open_read + fd.name = /etc/shadow 탐지

내부 동작 원리 — eBPF 기반 syscall 모니터링:
  - eBPF(extended Berkeley Packet Filter)는 커널 공간에서 안전하게 실행되는
    샌드박스 프로그램이다. JIT 컴파일러가 eBPF 바이트코드를 네이티브 코드로
    변환하여 커널 내에서 실행한다.
  - Falco의 eBPF 프로브는 tracepoint(sys_enter_openat, sys_enter_execve 등)에
    attach되어 모든 syscall 이벤트를 캡처한다.
  - 캡처된 이벤트는 perf ring buffer를 통해 사용자 공간의 libsinsp
    라이브러리로 전달된다. libsinsp는 /proc 파일시스템과 CRI API를
    조회하여 프로세스명, 컨테이너명, Pod명 등의 메타데이터를 enrichment한다.
  - enrichment된 이벤트가 Falco 룰 엔진의 condition과 매칭되면 알림이 발생한다.

  커널 모듈 vs eBPF 드라이버:
    커널 모듈: 성능이 우수하지만 커널 버전 의존성이 있고 보안 위험이 있다
    eBPF: 커널 검증기(verifier)가 프로그램 안전성을 보장하므로 커널 패닉 위험이 없다
          최근 Falco의 기본 드라이버로 채택되었다
```

---

## 1. Falco 완전 정복

### 1.1 Falco 런타임 보안 아키텍처

```
Falco - eBPF/커널 모듈 기반 런타임 위협 탐지 엔진
═══════════════════════════════════════════════════

Kubernetes Audit Log는 API 수준의 이벤트만 기록하는 반면, Falco는
커널 수준(시스템콜)의 런타임 이벤트를 실시간으로 모니터링하여
이상 행위(anomaly)를 탐지하는 HIDS(Host-based Intrusion Detection System)이다.

동작 메커니즘:
  - eBPF 프로브 또는 커널 모듈을 통해 시스템콜 이벤트를 커널에서 직접 캡처
  - 캡처된 이벤트를 사용자 공간의 Falco 엔진으로 전달
  - YAML 기반 규칙 엔진이 조건(condition)을 평가하여 위협 여부를 판정
  - 매칭 시 알림(stdout, syslog, gRPC, HTTP webhook)을 발생

탐지 예시:
  - execve("bash") in container → 컨테이너 내 대화형 셸 실행 탐지
  - open("/etc/shadow") → credential 파일 접근 탐지
  - execve("apt-get"|"pip") → 불변 컨테이너 원칙 위반(런타임 패키지 설치) 탐지
  - connect() to non-RFC1918 IP → 외부 IP 대상 아웃바운드 연결(C2 통신 의심) 탐지
```

### 1.2 Falco 아키텍처 상세

```
Falco 아키텍처 흐름도
════════════════════

[애플리케이션 프로세스]
       │
       │ 시스템콜 호출 (open, execve, connect 등)
       ▼
[리눅스 커널]
       │
       │ eBPF probe / kernel module이 시스템콜 캡처
       ▼
[Falco 드라이버 (eBPF/kernel module)]
       │
       │ 시스템콜 이벤트를 사용자 공간으로 전달
       ▼
[Falco 라이브러리 (libsinsp)]
       │
       │ 이벤트 파싱: 프로세스명, 파일명, 사용자, 컨테이너 정보 추출
       ▼
[Falco 룰 엔진]
       │
       │ 이벤트를 룰의 condition과 매칭
       │
       ├─ 매칭: 알림 생성 (output 필드의 메시지)
       └─ 불일치: 이벤트 무시
       │
       ▼
[출력 채널]
       ├─ stdout (기본)
       ├─ 파일 (/var/log/falco.log)
       ├─ syslog
       ├─ HTTP endpoint (Slack, PagerDuty 등)
       └─ gRPC (Falcosidekick 등)
```

### 1.3 Falco 설정 파일 구조

```
Falco 설정 파일 경로
═══════════════════

/etc/falco/falco.yaml                → 메인 설정 파일
                                        (출력 설정, 로그 레벨, 드라이버 등)

/etc/falco/falco_rules.yaml          → 기본 룰 파일
                                        *** 절대 수정하지 않는다! ***
                                        업데이트 시 덮어쓰기됨

/etc/falco/falco_rules.local.yaml    → 커스텀 룰 파일
                                        *** 여기에 추가/오버라이드! ***
                                        CKS 시험에서는 이 파일에 작성

룰 우선순위:
  - 같은 이름의 룰이 두 파일에 있으면, local.yaml의 룰이 우선
  - 기본 룰을 수정하고 싶으면 local.yaml에 같은 이름으로 재정의
```

### 1.4 Falco 룰 구성 요소 상세

```yaml
# ═══════════════════════════════════════════
# Falco 룰의 구조
# ═══════════════════════════════════════════

- rule: Shell Spawned in Container
  # ↑ 룰 이름 (고유해야 함)
  # 같은 이름이 local.yaml에 있으면 오버라이드

  desc: 컨테이너 내에서 셸 프로세스가 실행되면 탐지한다
  # ↑ 룰 설명 (사람이 읽기 위한 것)

  condition: >
    spawned_process and
    container and
    proc.name in (bash, sh, zsh, ksh, csh, dash)
  # ↑ 탐지 조건 (시스템콜 필터 표현식)
  # spawned_process = evt.type=execve and evt.dir=< (새 프로세스 생성)
  # container = 컨테이너 내부 이벤트
  # proc.name = 프로세스 이름이 셸 중 하나

  output: >
    셸이 컨테이너에서 실행됨
    (user=%user.name container_id=%container.id
    container_name=%container.name shell=%proc.name
    parent=%proc.pname cmdline=%proc.cmdline
    image=%container.image.repository:%container.image.tag
    pod=%k8s.pod.name ns=%k8s.ns.name)
  # ↑ 알림 메시지 (변수 치환 가능)
  # %user.name = 사용자 이름
  # %container.id = 컨테이너 ID
  # %proc.name = 프로세스 이름
  # %proc.pname = 부모 프로세스 이름
  # %proc.cmdline = 전체 명령어
  # %k8s.pod.name = K8s Pod 이름
  # %k8s.ns.name = K8s 네임스페이스

  priority: WARNING
  # ↑ 우선순위
  # EMERGENCY > ALERT > CRITICAL > ERROR > WARNING > NOTICE > INFORMATIONAL > DEBUG

  tags: [container, shell, mitre_execution]
  # ↑ 분류 태그 (MITRE ATT&CK 프레임워크 참조)

  enabled: true
  # ↑ 활성화 여부 (false로 비활성화 가능)
```

### 1.5 주요 매크로와 필터 필드

```
Falco 주요 매크로 (미리 정의된 조건)
═════════════════════════════════

매크로            | 의미                              | 원본 조건
──────────────────┼──────────────────────────────────┼─────────────────────
spawned_process   | 새 프로세스 실행                   | evt.type=execve and evt.dir=<
container         | 컨테이너 내부 이벤트                | container.id != host
open_write        | 파일 쓰기 모드 열기                | (evt.type=open or evt.type=openat)
                  |                                  |   and evt.is_open_write=true
open_read         | 파일 읽기 모드 열기                | (evt.type=open or evt.type=openat)
                  |                                  |   and evt.is_open_read=true
sensitive_files   | 민감한 파일 경로                   | /etc/shadow, /etc/passwd 등
shell_procs       | 셸 프로세스 목록                   | proc.name in (bash, sh, zsh, ...)
package_mgmt_procs| 패키지 매니저 프로세스               | proc.name in (apt, yum, pip, ...)

주요 필터 필드:
───────────────
proc.name          = 프로세스 이름 (bash, nginx, python 등)
proc.pname         = 부모 프로세스 이름
proc.cmdline       = 전체 명령어 줄
proc.exepath       = 실행 파일 경로
fd.name            = 파일 디스크립터 이름 (파일 경로, 소켓 주소)
fd.directory       = 파일이 속한 디렉토리
fd.snet            = 네트워크 서브넷 (CIDR 형식)
fd.ip              = 대상 IP 주소
fd.port            = 대상 포트
fd.typechar        = 파일 타입 (f=file, 4=IPv4, 6=IPv6)
container.id       = 컨테이너 ID
container.name     = 컨테이너 이름
container.image.repository = 이미지 이름
container.image.tag = 이미지 태그
user.name          = 사용자 이름
user.uid           = 사용자 UID
evt.type           = 이벤트 타입 (open, connect, execve 등)
evt.dir            = 이벤트 방향 (< = 진입, > = 종료)
k8s.pod.name       = K8s Pod 이름
k8s.ns.name        = K8s 네임스페이스
```

### 1.6 Falco 룰 작성 예제 모음 (15개 이상)

```yaml
# ═══════════════════════════════════════════
# 룰 1: 컨테이너 내 셸 실행 탐지
# ═══════════════════════════════════════════
- rule: Shell Spawned in Container
  desc: 컨테이너 내에서 셸이 실행되면 탐지
  condition: >
    spawned_process and container and
    proc.name in (bash, sh, zsh, ksh, csh, dash, ash)
  output: >
    셸 실행 (user=%user.name container=%container.name
    shell=%proc.name parent=%proc.pname cmdline=%proc.cmdline
    image=%container.image.repository pod=%k8s.pod.name ns=%k8s.ns.name)
  priority: WARNING
  tags: [container, shell, mitre_execution]

# ═══════════════════════════════════════════
# 룰 2: 민감한 파일 읽기 탐지
# ═══════════════════════════════════════════
- rule: Read Sensitive File in Container
  desc: /etc/shadow, /etc/passwd, kubeconfig 등 민감 파일 읽기
  condition: >
    open_read and container and
    (fd.name = /etc/shadow or
     fd.name = /etc/passwd or
     fd.name startswith /etc/kubernetes/ or
     fd.name startswith /root/.kube or
     fd.name startswith /var/run/secrets/kubernetes.io/)
  output: >
    민감 파일 읽기 (user=%user.name file=%fd.name
    container=%container.name image=%container.image.repository
    pod=%k8s.pod.name ns=%k8s.ns.name cmdline=%proc.cmdline)
  priority: CRITICAL
  tags: [filesystem, sensitive_file, mitre_credential_access]

# ═══════════════════════════════════════════
# 룰 3: 패키지 매니저 실행 탐지 (불변성 위반)
# ═══════════════════════════════════════════
- rule: Package Management in Container
  desc: apt, pip, npm 등 패키지 매니저 실행 (불변 컨테이너 위반)
  condition: >
    spawned_process and container and
    proc.name in (apt, apt-get, dpkg, yum, dnf, rpm,
                  apk, pip, pip3, npm, gem, composer, cargo)
  output: >
    패키지 매니저 실행 (user=%user.name pkg=%proc.name
    cmdline=%proc.cmdline container=%container.name
    image=%container.image.repository
    pod=%k8s.pod.name ns=%k8s.ns.name)
  priority: ERROR
  tags: [container, package_management, mitre_persistence]

# ═══════════════════════════════════════════
# 룰 4: 외부 네트워크 연결 탐지
# ═══════════════════════════════════════════
- rule: Unexpected Outbound Connection
  desc: 컨테이너에서 외부(비내부) IP로 네트워크 연결
  condition: >
    evt.type = connect and evt.dir = < and container and
    fd.typechar = 4 and fd.ip != "0.0.0.0" and
    not fd.snet in (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 127.0.0.0/8)
  output: >
    외부 연결 (user=%user.name connection=%fd.name
    container=%container.name image=%container.image.repository
    pod=%k8s.pod.name ns=%k8s.ns.name)
  priority: WARNING
  tags: [network, container, mitre_command_and_control]

# ═══════════════════════════════════════════
# 룰 5: 바이너리 디렉토리에 파일 쓰기
# ═══════════════════════════════════════════
- rule: Write to Binary Directory in Container
  desc: /usr/bin, /bin 등에 파일 생성/수정 (백도어 설치 의심)
  condition: >
    open_write and container and
    (fd.directory = /usr/bin or fd.directory = /usr/sbin or
     fd.directory = /usr/local/bin or fd.directory = /bin or
     fd.directory = /sbin)
  output: >
    바이너리 디렉토리 쓰기 (user=%user.name file=%fd.name
    container=%container.name image=%container.image.repository
    pod=%k8s.pod.name ns=%k8s.ns.name)
  priority: ERROR
  tags: [filesystem, container, mitre_persistence]

# ═══════════════════════════════════════════
# 룰 6: /etc 디렉토리 수정 탐지
# ═══════════════════════════════════════════
- rule: Write to etc Directory in Container
  desc: /etc 설정 파일 수정 (설정 변조 의심)
  condition: >
    open_write and container and
    fd.name startswith /etc/
  output: >
    /etc 파일 수정 (user=%user.name file=%fd.name
    container=%container.name image=%container.image.repository
    pod=%k8s.pod.name ns=%k8s.ns.name cmdline=%proc.cmdline)
  priority: ERROR
  tags: [filesystem, container, mitre_persistence]

# ═══════════════════════════════════════════
# 룰 7: 리버스 셸 탐지
# ═══════════════════════════════════════════
- rule: Reverse Shell in Container
  desc: 리버스 셸 명령어 패턴 탐지
  condition: >
    spawned_process and container and
    ((proc.name = bash and proc.cmdline contains "/dev/tcp") or
     (proc.name = python and proc.cmdline contains "socket") or
     (proc.name = perl and proc.cmdline contains "socket") or
     (proc.name = nc and proc.cmdline contains "-e") or
     (proc.name = ncat and proc.cmdline contains "-e"))
  output: >
    리버스 셸 의심 (user=%user.name cmdline=%proc.cmdline
    container=%container.name image=%container.image.repository
    pod=%k8s.pod.name ns=%k8s.ns.name)
  priority: CRITICAL
  tags: [container, shell, mitre_execution, mitre_command_and_control]

# ═══════════════════════════════════════════
# 룰 8: 컨테이너 드리프트 탐지 (새 실행 파일)
# ═══════════════════════════════════════════
- rule: Container Drift Detected
  desc: 이미지에 없던 새로운 실행 파일이 실행됨
  condition: >
    spawned_process and container and
    not proc.is_exe_from_memfd and
    evt.arg.flags contains "clone_vm" = false and
    proc.is_container_healthcheck = false and
    not proc.exepath in (known_binaries)
  output: >
    컨테이너 드리프트 (user=%user.name proc=%proc.name
    exe=%proc.exepath container=%container.name
    pod=%k8s.pod.name ns=%k8s.ns.name)
  priority: ERROR
  tags: [container, mitre_execution]
  enabled: false  # 사전 준비 필요

# ═══════════════════════════════════════════
# 룰 9: ServiceAccount 토큰 접근 탐지
# ═══════════════════════════════════════════
- rule: Access Service Account Token
  desc: 컨테이너에서 SA 토큰 파일 접근
  condition: >
    open_read and container and
    fd.name startswith /var/run/secrets/kubernetes.io/serviceaccount/
  output: >
    SA 토큰 접근 (user=%user.name file=%fd.name proc=%proc.name
    container=%container.name image=%container.image.repository
    pod=%k8s.pod.name ns=%k8s.ns.name)
  priority: WARNING
  tags: [kubernetes, container, mitre_credential_access]

# ═══════════════════════════════════════════
# 룰 10: 권한 상승 시도 탐지
# ═══════════════════════════════════════════
- rule: Privilege Escalation Attempt
  desc: setuid, setgid 시스템콜 또는 sudo 사용
  condition: >
    spawned_process and container and
    (proc.name in (sudo, su, doas) or
     (evt.type in (setuid, setgid) and user.uid != 0))
  output: >
    권한 상승 시도 (user=%user.name proc=%proc.name
    cmdline=%proc.cmdline container=%container.name
    pod=%k8s.pod.name ns=%k8s.ns.name)
  priority: CRITICAL
  tags: [container, mitre_privilege_escalation]
```

### 1.7 기존 룰 오버라이드

```yaml
# /etc/falco/falco_rules.local.yaml
# ═══════════════════════════════════════════
# 기본 룰의 우선순위를 변경하는 방법
# 같은 이름의 룰을 재정의하면 오버라이드된다
# ═══════════════════════════════════════════

# 기본 룰 "Terminal shell in container"의 우선순위를
# WARNING → ALERT로 변경
- rule: Terminal shell in container
  desc: A shell was used as the entrypoint/exec point into a container
  condition: >
    spawned_process and container and shell_procs and
    proc.tty != 0 and container_entrypoint
  output: >
    Terminal shell in container
    (user=%user.name %container.info shell=%proc.name
    parent=%proc.pname cmdline=%proc.cmdline
    container_id=%container.id image=%container.image.repository)
  priority: ALERT              # WARNING → ALERT로 변경!
  tags: [container, shell, mitre_execution]
```

### 1.8 Falco 관리 명령어

```bash
# ═══ Falco 실행/관리 ═══

# 서비스로 실행
sudo systemctl start falco
sudo systemctl status falco
sudo systemctl restart falco

# 로그 모니터링
sudo journalctl -u falco -f

# 최근 5분 로그
sudo journalctl -u falco --since "5 minutes ago"

# 특정 키워드 필터링
sudo journalctl -u falco --since "5 minutes ago" | grep -E "Shell|Sensitive|Package"

# 룰 검증 (문법 오류 확인)
sudo falco --dry-run \
  -r /etc/falco/falco_rules.yaml \
  -r /etc/falco/falco_rules.local.yaml
```

기대 출력 (정상):
```text
Loading rules from file /etc/falco/falco_rules.yaml
Loading rules from file /etc/falco/falco_rules.local.yaml
Rules loaded successfully
```

기대 출력 (문법 오류 시):
```text
FATAL Runtime error: Could not load rules file: /etc/falco/falco_rules.local.yaml: yaml-cpp: error at line 5
```

```bash
# Falco 룰 트리거 테스트 및 검증
kubectl exec -n demo deploy/nginx -- /bin/sh -c "echo test"
sudo journalctl -u falco --since "1 minute ago" | grep "Shell"
```

기대 출력:
```text
Warning Shell spawned in container (user=root container=nginx shell=sh parent=runc cmdline=sh -c echo test image=nginx pod=nginx-xxxx ns=demo)

# 포그라운드 실행 (디버깅)
sudo falco -r /etc/falco/falco_rules.yaml \
  -r /etc/falco/falco_rules.local.yaml
```

---

## 2. Kubernetes Audit Log 분석

### 2.1 Audit Log 필드 상세

```
Audit Log 주요 필드
═══════════════════

필드                           | 설명
──────────────────────────────┼────────────────────────────
user.username                 | 요청한 사용자 이름
user.groups                   | 사용자 그룹
verb                          | 동작 (get, create, delete 등)
objectRef.resource            | 대상 리소스 타입 (pods, secrets)
objectRef.namespace           | 대상 네임스페이스
objectRef.name                | 대상 리소스 이름
objectRef.subresource         | 하위 리소스 (exec, log, portforward)
responseStatus.code           | HTTP 응답 코드 (200, 403, 404)
requestReceivedTimestamp      | 요청 수신 시간
sourceIPs                     | 요청 출발 IP 주소
requestObject                 | 요청 본문 (Request/RequestResponse 레벨)
responseObject                | 응답 본문 (RequestResponse 레벨)
annotations                   | 추가 메타데이터
```

### 2.2 Audit Log 분석 명령어 모음

```bash
# ═══ 기본 분석 ═══

# 전체 로그 실시간 모니터링
tail -f /var/log/kubernetes/audit/audit.log | jq .

# ═══ 리소스별 필터링 ═══

# Secret 관련 활동
cat /var/log/kubernetes/audit/audit.log | \
  jq 'select(.objectRef.resource == "secrets") |
  {user: .user.username, verb: .verb, name: .objectRef.name,
   ns: .objectRef.namespace, time: .requestReceivedTimestamp}'

# Pod 삭제 기록
cat /var/log/kubernetes/audit/audit.log | \
  jq 'select(.objectRef.resource == "pods" and .verb == "delete") |
  {user: .user.username, pod: .objectRef.name,
   ns: .objectRef.namespace, time: .requestReceivedTimestamp}'

# ═══ 사용자별 필터링 ═══

# 특정 사용자의 모든 활동
cat /var/log/kubernetes/audit/audit.log | \
  jq 'select(.user.username == "jane") |
  {verb: .verb, resource: .objectRef.resource, name: .objectRef.name,
   ns: .objectRef.namespace, time: .requestReceivedTimestamp}'

# 비시스템 사용자의 활동 (보안 감사)
cat /var/log/kubernetes/audit/audit.log | \
  jq 'select(.user.username | startswith("system:") | not) |
  {user: .user.username, verb: .verb,
   resource: .objectRef.resource, name: .objectRef.name}'

# ═══ 보안 이벤트 분석 ═══

# 403 Forbidden 응답 (권한 부족 → 공격 시도 의심)
cat /var/log/kubernetes/audit/audit.log | \
  jq 'select(.responseStatus.code == 403) |
  {user: .user.username, verb: .verb,
   resource: .objectRef.resource, ns: .objectRef.namespace,
   time: .requestReceivedTimestamp}'

# kubectl exec 기록 (셸 접근)
cat /var/log/kubernetes/audit/audit.log | \
  jq 'select(.objectRef.subresource == "exec") |
  {user: .user.username, pod: .objectRef.name,
   ns: .objectRef.namespace, time: .requestReceivedTimestamp}'

# RBAC 변경 기록
cat /var/log/kubernetes/audit/audit.log | \
  jq 'select(.objectRef.resource | test("roles|rolebindings|clusterroles|clusterrolebindings")) |
  {user: .user.username, verb: .verb,
   resource: .objectRef.resource, name: .objectRef.name}'

# ═══ 시간 기반 분석 ═══

# 시간별 요청 빈도 (비정상적 트래픽 탐지)
cat /var/log/kubernetes/audit/audit.log | \
  jq -r '.requestReceivedTimestamp' | cut -d'T' -f2 | cut -d':' -f1 | sort | uniq -c

# 최근 1시간 Secret 접근
cat /var/log/kubernetes/audit/audit.log | \
  jq 'select(.objectRef.resource == "secrets") |
  select(.requestReceivedTimestamp > "2024-01-01T10:00:00Z") |
  {user: .user.username, verb: .verb, secret: .objectRef.name}'
```

---

## 3. 이상 행위 탐지 및 대응

### 3.1 이상 행위 유형과 탐지 방법

```
이상 행위 탐지 매트릭스
═══════════════════════

행위                        | 탐지 도구      | 우선순위
───────────────────────────┼───────────────┼─────────
컨테이너 내 셸 실행          | Falco         | WARNING
민감 파일 접근               | Falco         | CRITICAL
패키지 매니저 실행           | Falco         | ERROR
바이너리 디렉토리 쓰기       | Falco         | ERROR
외부 네트워크 연결           | Falco         | WARNING
리버스 셸 실행              | Falco         | CRITICAL
권한 상승 시도              | Falco         | CRITICAL
Secret 무단 접근            | Audit Log     | CRITICAL
kubectl exec 사용          | Audit Log     | WARNING
RBAC 변경                  | Audit Log     | ERROR
403 반복 (브루트포스)        | Audit Log     | ERROR
비정상 트래픽 패턴           | Network Policy | WARNING
CPU/메모리 급증 (크립토마이닝)| Prometheus    | ERROR
```

### 3.2 이상 행위 대응 절차

```
이상 행위 대응 흐름도
════════════════════

1. 탐지 (Detection)
   ├─ Falco 알림 수신
   └─ Audit Log에서 이상 패턴 발견
   │
   ▼
2. 증거 수집 (Evidence Collection)
   ├─ kubectl logs <pod> > /tmp/pod-logs.txt
   ├─ kubectl describe pod <pod> > /tmp/pod-describe.txt
   ├─ kubectl get pod <pod> -o yaml > /tmp/pod-yaml.txt
   ├─ kubectl exec <pod> -- ps aux > /tmp/pod-processes.txt
   └─ kubectl exec <pod> -- netstat -tlnp > /tmp/pod-network.txt
   │
   ▼
3. 격리 (Isolation)
   ├─ NetworkPolicy로 네트워크 차단
   │   (모든 Ingress/Egress 차단)
   └─ 또는 노드 드레인으로 Pod 이동 방지
   │
   ▼
4. 제거 (Eradication)
   ├─ 의심 Pod 삭제
   └─ 의심 컨테이너가 있는 노드 점검
   │
   ▼
5. 복구 (Recovery)
   ├─ 깨끗한 이미지로 재배포
   └─ Secret 로테이션 (유출 의심 시)
   │
   ▼
6. 사후 분석 (Post-mortem)
   ├─ 근본 원인 분석
   ├─ 보안 정책 강화
   └─ Falco 룰 추가/수정
```

### 3.3 대응 예제 - NetworkPolicy로 격리

```yaml
# 의심 Pod를 네트워크에서 완전 격리
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: isolate-suspicious-pod
  namespace: demo
spec:
  podSelector:
    matchLabels:
      app: suspicious-app              # 의심 Pod의 라벨
  policyTypes:
  - Ingress
  - Egress
  # 규칙 없음 = 모든 Ingress/Egress 트래픽 차단
  # → Pod는 네트워크적으로 완전히 격리됨
  # → 증거 수집 후 Pod 삭제
```

---

## 4. Sysdig 시스템콜 분석

### 4.1 Sysdig 기본 사용법

```bash
# ═══ 기본 명령어 ═══

# 모든 시스템콜 캡처 (실시간)
sysdig

# 특정 컨테이너의 시스템콜
sysdig container.name=nginx

# 특정 이벤트 타입만
sysdig evt.type=open           # 파일 열기
sysdig evt.type=connect        # 네트워크 연결
sysdig evt.type=execve         # 프로세스 실행

# ═══ 캡처 및 분석 ═══

# 캡처 파일 저장 (10초간)
sudo sysdig -w /tmp/capture.scap &
sleep 10
kill %1

# 캡처 파일 분석
sudo sysdig -r /tmp/capture.scap

# 셸 프로세스 필터링
sudo sysdig -r /tmp/capture.scap \
  "evt.type=execve and proc.name in (bash,sh,zsh)"

# 파일 접근 분석
sudo sysdig -r /tmp/capture.scap \
  "evt.type in (open,openat) and fd.name contains /etc/"

# 네트워크 연결 분석
sudo sysdig -r /tmp/capture.scap evt.type=connect

# ═══ Chisel (미리 작성된 분석 스크립트) ═══
sysdig -c topprocs_cpu         # CPU 사용량 상위 프로세스
sysdig -c topfiles_bytes       # 파일 I/O 상위
sysdig -c spy_users            # 사용자별 명령어 추적
sysdig -c topconns             # 네트워크 연결 상위
sysdig -c fileslower 1000      # 1초 이상 걸리는 파일 I/O
```

### 4.2 Sysdig 검증 명령어 기대 출력

```bash
# 컨테이너에서 실행된 프로세스 확인
sudo sysdig -r /tmp/capture.scap "evt.type=execve and container.name=nginx" -p "%proc.name %proc.cmdline"
```

```text
sh sh -c echo test
nginx nginx: worker process
```

```bash
# 파일 접근 확인
sudo sysdig -r /tmp/capture.scap "evt.type in (open,openat) and container.name=nginx and fd.name contains /etc/" -p "%fd.name %proc.name"
```

```text
/etc/nginx/nginx.conf nginx
/etc/passwd getent
```

---

## 트러블슈팅: 런타임 보안 장애 시나리오

### 시나리오 1: Falco 재시작 후 이벤트가 수집되지 않는다

```
증상: systemctl restart falco 후 journalctl에 이벤트가 나타나지 않는다.
원인 1: eBPF 프로브 로드 실패 (커널 헤더 미설치)
원인 2: falco_rules.local.yaml 문법 오류로 Falco가 시작 직후 종료
```

```bash
# 진단: Falco 서비스 상태 확인
sudo systemctl status falco
```

```text
● falco.service - Falco: Container Native Runtime Security
   Active: failed (Result: exit-code) since ...
```

```bash
# 진단: 상세 에러 확인
sudo journalctl -u falco --no-pager | tail -20
```

```text
FATAL Runtime error: Could not load rules file: yaml-cpp: error at line 12, column 3: expected a value
```

```bash
# 해결: YAML 문법 검증 후 재시작
sudo falco --dry-run -r /etc/falco/falco_rules.yaml -r /etc/falco/falco_rules.local.yaml
# 에러 라인 수정 후
sudo systemctl restart falco
```

### 시나리오 2: Audit Log가 생성되지 않는다

```
증상: /var/log/kubernetes/audit/audit.log 파일이 비어 있거나 존재하지 않는다.
원인 1: --audit-policy-file 플래그가 API Server에 설정되지 않았다
원인 2: audit-policy.yaml에 catch-all 규칙이 None으로 설정되어 있다
원인 3: volume mount가 누락되었다
```

```bash
# 진단: API Server 플래그 확인
ps aux | grep kube-apiserver | grep audit
```

```text
kube-apiserver --audit-policy-file=/etc/kubernetes/audit-policy.yaml --audit-log-path=/var/log/kubernetes/audit/audit.log
```

위 출력이 없으면 audit 플래그가 설정되지 않은 것이다.

```bash
# 진단: audit 디렉토리 존재 여부 확인
ls -la /var/log/kubernetes/audit/
```

```text
ls: cannot access '/var/log/kubernetes/audit/': No such file or directory
```

```bash
# 해결: 디렉토리 생성 + API Server 매니페스트에 volume mount 추가
sudo mkdir -p /var/log/kubernetes/audit/
```

---

## 5. 컨테이너 불변성 (Immutable Infrastructure)

```
불변성 원칙
══════════

"컨테이너는 한번 배포되면 내부를 변경하지 않는다"

구현 방법:
  1. readOnlyRootFilesystem: true
     → 루트 파일시스템을 읽기 전용으로
  2. capabilities.drop: ["ALL"]
     → 시스템 수준 변경 불가
  3. allowPrivilegeEscalation: false
     → 권한 상승 불가
  4. Falco 룰로 불변성 위반 탐지
     → 패키지 설치, 바이너리 수정 등 실시간 감시

위반 탐지 Falco 룰:
  - 패키지 매니저 실행 = 불변성 위반
  - /usr/bin 등에 파일 쓰기 = 불변성 위반
  - 새 실행 파일 생성 = 불변성 위반
```

```yaml
# 불변 컨테이너 + Falco 모니터링 조합
apiVersion: v1
kind: Pod
metadata:
  name: immutable-monitored-pod
spec:
  securityContext:
    runAsNonRoot: true
    runAsUser: 1000
    seccompProfile:
      type: RuntimeDefault
  containers:
  - name: app
    image: nginx:1.25
    securityContext:
      readOnlyRootFilesystem: true
      allowPrivilegeEscalation: false
      capabilities:
        drop: ["ALL"]
    volumeMounts:
    - name: tmp
      mountPath: /tmp
    - name: cache
      mountPath: /var/cache/nginx
    - name: run
      mountPath: /var/run
  volumes:
  - name: tmp
    emptyDir: {}
  - name: cache
    emptyDir: {}
  - name: run
    emptyDir: {}
# + Falco가 런타임에서 불변성 위반을 추가 감시
```

---

---

## tart-infra 실습

### 실습 환경 설정

```bash
# dev 클러스터 접속 (demo 네임스페이스의 앱들로 런타임 보안 실습)
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/dev.yaml
kubectl config current-context
# dev

# demo 네임스페이스 Pod 확인
kubectl get pods -n demo
# nginx, httpbin-v1, httpbin-v2, postgresql, redis, rabbitmq, keycloak
```

---

### 실습 1: demo 네임스페이스 Pod의 불변성(Immutability) 검증

demo 네임스페이스의 Pod들이 불변 컨테이너 원칙을 따르는지 검증한다. readOnlyRootFilesystem, capabilities drop, allowPrivilegeEscalation 설정을 점검하고, 실제로 파일시스템 쓰기가 차단되는지 테스트한다.

```bash
# 모든 Pod의 불변성 관련 설정 점검
kubectl get pods -n demo -o jsonpath='{range .items[*]}
Pod: {.metadata.name}
{range .spec.containers[*]}  Container: {.name}
    readOnlyRootFilesystem: {.securityContext.readOnlyRootFilesystem}
    allowPrivilegeEscalation: {.securityContext.allowPrivilegeEscalation}
    capabilities.drop: {.securityContext.capabilities.drop}
{end}---{end}'
```

예상 출력:
```
Pod: nginx-xxxx
  Container: nginx
    readOnlyRootFilesystem: true
    allowPrivilegeEscalation: false
    capabilities.drop: ["ALL"]
---
Pod: redis-xxxx
  Container: redis
    readOnlyRootFilesystem: true
    allowPrivilegeEscalation: false
    capabilities.drop: ["ALL"]
---
```

```bash
# nginx Pod에서 루트 파일시스템 쓰기 시도 (차단되어야 함)
kubectl exec -n demo deploy/nginx -- touch /usr/share/nginx/html/hack.html 2>&1
# touch: /usr/share/nginx/html/hack.html: Read-only file system

# emptyDir 마운트 경로에서 쓰기 시도 (허용되어야 함)
kubectl exec -n demo deploy/nginx -- touch /tmp/test.txt 2>&1
# (에러 없음 → 성공)

# 패키지 설치 시도 (불변성 위반 - 차단되어야 함)
kubectl exec -n demo deploy/nginx -- apt-get update 2>&1
# E: List directory /var/lib/apt/lists/partial is missing.
# → readOnlyRootFilesystem으로 인해 패키지 매니저 실행 불가
```

**동작 원리:**
- `readOnlyRootFilesystem: true`는 컨테이너의 rootfs를 read-only로 마운트하여 런타임 파일 변조를 차단한다
- `capabilities.drop: ["ALL"]`은 모든 Linux capability를 제거하여 시스템 수준 변경을 방지한다
- `allowPrivilegeEscalation: false`는 no_new_privs 커널 플래그를 설정하여 SUID 바이너리 실행을 차단한다
- emptyDir로 마운트된 /tmp 등의 경로에서만 쓰기가 가능하며, 이는 애플리케이션 동작에 필요한 최소한의 쓰기 경로이다
- Falco 룰과 결합하면 readOnlyRootFilesystem을 우회하는 시도(emptyDir에 악성 바이너리 드롭 등)도 탐지할 수 있다

---

### 실습 2: Kubernetes Audit Log 분석 - demo 네임스페이스 보안 이벤트

platform 클러스터의 API Server Audit Log를 분석하여 demo 네임스페이스에서 발생한 보안 관련 이벤트를 식별한다.

```bash
# platform 클러스터로 전환 (Audit Log가 설정된 클러스터)
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/platform.yaml

# dev 클러스터 master에 SSH 접속하여 audit log 분석
# (audit log 경로: /var/log/kubernetes/audit/audit.log)
ssh admin@dev-master  # password: admin

# Secret 접근 이벤트 필터링
cat /var/log/kubernetes/audit/audit.log 2>/dev/null | \
  jq 'select(.objectRef.resource == "secrets" and .objectRef.namespace == "demo") |
  {user: .user.username, verb: .verb, secret: .objectRef.name,
   time: .requestReceivedTimestamp, code: .responseStatus.code}' 2>/dev/null | head -30
```

예상 출력:
```json
{
  "user": "system:serviceaccount:demo:default",
  "verb": "get",
  "secret": "postgresql-credentials",
  "time": "2026-03-20T08:15:30Z",
  "code": 200
}
{
  "user": "system:serviceaccount:demo:default",
  "verb": "get",
  "secret": "redis-credentials",
  "time": "2026-03-20T08:15:31Z",
  "code": 200
}
```

```bash
# kubectl exec 이벤트 확인 (셸 접근 기록)
cat /var/log/kubernetes/audit/audit.log 2>/dev/null | \
  jq 'select(.objectRef.subresource == "exec" and .objectRef.namespace == "demo") |
  {user: .user.username, pod: .objectRef.name,
   time: .requestReceivedTimestamp}' 2>/dev/null | head -20

# 403 Forbidden 응답 (권한 부족 → 공격 시도 의심)
cat /var/log/kubernetes/audit/audit.log 2>/dev/null | \
  jq 'select(.responseStatus.code == 403 and .objectRef.namespace == "demo") |
  {user: .user.username, verb: .verb,
   resource: .objectRef.resource, time: .requestReceivedTimestamp}' 2>/dev/null | head -10

exit  # SSH 종료
```

**동작 원리:**
- Kubernetes Audit Log는 kube-apiserver가 수신하는 모든 API 요청을 기록한다
- Audit Policy의 레벨(None/Metadata/Request/RequestResponse)에 따라 기록 상세도가 달라진다
- Secret 접근 기록은 credential 유출 시도를 추적하는 데 핵심적이며, RequestResponse 레벨로 설정하면 요청/응답 본문까지 기록된다
- kubectl exec 기록은 컨테이너에 대한 대화형 셸 접근을 추적하며, 비인가 접근 탐지에 사용된다
- 403 Forbidden 반복은 브루트포스 공격이나 권한 상승 시도의 징후일 수 있다

---

### 실습 3: 이상 행위 탐지 후 NetworkPolicy 격리 시뮬레이션

demo 네임스페이스에서 의심 Pod를 식별하고, CiliumNetworkPolicy로 네트워크를 격리하는 인시던트 대응 절차를 연습한다.

```bash
# dev 클러스터로 복귀
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/dev.yaml

# 1. 증거 수집: 의심 Pod(예: nginx)의 상태 기록
kubectl logs -n demo deploy/nginx --tail=50 > /tmp/nginx-logs.txt
kubectl describe pod -n demo -l app=nginx > /tmp/nginx-describe.txt
kubectl get pod -n demo -l app=nginx -o yaml > /tmp/nginx-yaml.txt

# 2. 현재 적용된 CiliumNetworkPolicy 확인
kubectl get ciliumnetworkpolicy -n demo
# 11개의 Zero Trust 정책이 이미 적용되어 있음

# 3. 격리 정책 생성 (모든 Ingress/Egress 차단)
cat <<'EOF' | kubectl apply -f -
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: isolate-suspicious-pod
  namespace: demo
spec:
  endpointSelector:
    matchLabels:
      quarantine: "true"
  ingressDeny:
  - fromEntities:
    - world
    - cluster
  egressDeny:
  - toEntities:
    - world
    - cluster
EOF

# 4. 의심 Pod에 quarantine 라벨 부여하여 격리
# (실제 인시던트에서만 실행 - 연습 시에는 확인만)
# kubectl label pod <pod-name> -n demo quarantine=true

# 5. 격리 정책 확인
kubectl get ciliumnetworkpolicy isolate-suspicious-pod -n demo -o yaml
```

예상 출력:
```
ciliumnetworkpolicy.cilium.io/isolate-suspicious-pod created
```

```bash
# 6. 정리 (실습 후 격리 정책 제거)
kubectl delete ciliumnetworkpolicy isolate-suspicious-pod -n demo
```

**동작 원리:**
- 인시던트 대응의 핵심은 탐지 → 증거 수집 → 격리 → 제거 → 복구 순서로 진행하는 것이다
- 증거 수집 단계에서 Pod의 로그, 상태, YAML을 모두 파일로 저장해야 사후 분석이 가능하다
- CiliumNetworkPolicy의 `ingressDeny`/`egressDeny`를 사용하면 명시적 거부 규칙을 생성할 수 있다
- `quarantine: "true"` 라벨을 부여하는 방식으로, 의심 Pod만 선택적으로 격리할 수 있다
- dev 클러스터에는 이미 11개의 CiliumNetworkPolicy가 Zero Trust로 적용되어 있어, 기본적으로 허용되지 않은 통신은 차단된다. 격리 정책은 이미 허용된 통신까지 완전히 차단하는 추가 조치이다

> **내일 예고:** Day 12에서는 Monitoring, Logging & Runtime Security 도메인의 시험 출제 패턴, 실전 문제 10개, tart-infra 실습을 다룬다.
