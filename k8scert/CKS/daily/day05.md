# CKS Day 5: System Hardening (1/2) - AppArmor, seccomp 프로파일

> 학습 목표 | CKS 도메인: System Hardening (15%) | 예상 소요 시간: 2시간

---

## 오늘의 학습 목표

- AppArmor 프로파일을 작성하고 Pod에 적용할 수 있다
- seccomp 프로파일(RuntimeDefault, Localhost)을 이해하고 Pod에 적용할 수 있다
- 불필요한 패키지/서비스를 식별하고 제거하여 공격 표면을 줄인다
- 커널 파라미터(sysctl) 보안 설정을 이해한다
- Pod에서 위험한 시스템콜을 차단하는 방법을 안다

---

## 1. AppArmor 완전 정복

### 1.0 AppArmor 등장 배경

```
AppArmor가 필요한 이유 - DAC의 한계
════════════════════════════════════

기존 방식의 한계 (DAC만 사용하는 경우):
  - 전통적 UNIX DAC(Discretionary Access Control)는 파일 소유자가 퍼미션을 결정한다
  - root(UID 0)는 모든 DAC 검사를 우회하므로, 컨테이너가 root로 실행되면
    파일시스템 전체에 접근 가능하다
  - 컨테이너 런타임 취약점이나 커널 exploit으로 root 권한을 획득하면
    DAC만으로는 방어할 수 없다

공격-방어 매핑:
  공격 벡터                         → AppArmor 방어
  ──────────────────────────────── → ──────────────────────────────
  /proc/sysrq-trigger 쓰기로 패닉   → deny /proc/** w로 차단
  /etc/shadow 읽기                  → deny /etc/shadow rw로 차단
  raw 소켓으로 ARP spoofing          → deny network raw로 차단
  악성 바이너리 /usr/bin 드롭         → deny /usr/bin/** w로 차단
  커널 모듈 로드                     → deny capability sys_admin으로 차단

SELinux와의 비교:
  - SELinux: 라벨(label) 기반, 정밀하지만 정책 작성이 복잡하다. RHEL/CentOS 기본.
  - AppArmor: 경로(path) 기반, 정책이 직관적이다. Ubuntu/Debian 기본.
  - CKS 시험에서는 AppArmor만 출제된다.
```

### 1.1 AppArmor 아키텍처 및 MAC 모델

```
AppArmor - LSM 기반 강제 접근 제어(MAC) 메커니즘
═════════════════════════════════════════════════

AppArmor는 Linux Security Module(LSM) 프레임워크에 등록된 커널 모듈로,
DAC(Discretionary Access Control)를 보완하는 MAC(Mandatory Access Control) 정책을 구현한다.

동작 원리:
  프로세스가 시스템콜을 호출하면 → 커널의 LSM hook 지점에서 AppArmor 모듈이
  해당 프로세스에 연결된 프로파일(profile)을 참조하여 접근 판정을 수행한다.

프로파일이 제어하는 리소스 유형:
  - 파일 접근: 경로 기반으로 read(r), write(w), execute(x) 퍼미션을 정의
  - 네트워크: socket type(inet, inet6, raw 등) 및 프로토콜(tcp, udp) 제어
  - Capabilities: CAP_NET_RAW, CAP_SYS_ADMIN 등 POSIX capability 제어
  - Mount/Umount: 파일시스템 마운트 작업 제어

AppArmor는 경로 기반(path-based) 정책 모델을 사용하며,
프로세스별로 프로파일을 작성하여 enforce(위반 시 차단) 또는
complain(위반 시 로깅만) 모드로 동작한다.
```

### 1.2 AppArmor 동작 원리

```
AppArmor 동작 흐름
═══════════════════

1. 관리자가 프로파일 작성 (/etc/apparmor.d/k8s-deny-write)
   │
   ▼
2. apparmor_parser로 커널에 로드 (enforce 모드)
   │
   ▼
3. Pod YAML에서 프로파일 지정
   │
   ▼
4. kubelet이 컨테이너 런타임에 프로파일 적용 요청
   │
   ▼
5. 컨테이너 런타임(containerd)이 컨테이너 생성 시 프로파일 적용
   │
   ▼
6. 컨테이너 내 프로세스가 파일/네트워크에 접근할 때마다
   커널의 AppArmor 모듈이 프로파일 규칙 확인
   │
   ├─ 허용: 접근 허용
   └─ 거부: 접근 차단 + 로그 기록 (enforce 모드)
         접근 허용 + 로그 기록 (complain 모드)

중요 사항:
  - 프로파일은 Pod가 스케줄링되는 "노드"에 로드되어 있어야 한다!
  - 프로파일이 없는 노드에서 Pod가 실행되면 에러 발생
  - K8s 1.30+: securityContext 방식 (GA)
  - K8s 1.29-: annotation 방식 (beta)
```

### 1.3 AppArmor 모드

```
AppArmor 세 가지 모드
════════════════════

모드         | 동작                       | 사용 사례
─────────────┼───────────────────────────┼─────────────────────
enforce      | 정책 위반 시 차단 + 로그    | 프로덕션 환경
complain     | 정책 위반 시 로그만 기록    | 테스트/디버깅
unconfined   | AppArmor 미적용            | 기본 상태

명령어:
  enforce 모드로 로드:  apparmor_parser -r <파일>
  complain 모드로 로드: apparmor_parser -C <파일>
  프로파일 제거:        apparmor_parser -R <파일>
  상태 확인:           aa-status
```

### 1.4 AppArmor 프로파일 작성 상세

```
# ═══════════════════════════════════════════
# 프로파일 1: 파일 쓰기 제한 (가장 기본적인 패턴)
# ═══════════════════════════════════════════
# 파일: /etc/apparmor.d/k8s-deny-write
```

```
#include <tunables/global>
# ↑ 전역 변수/매크로 포함 (시스템 경로 등 정의)

profile k8s-deny-write flags=(attach_disconnected,mediate_deleted) {
# ↑ 프로파일 이름: k8s-deny-write
# ↑ flags:
#   attach_disconnected = 부모 없는 프로세스에도 적용
#   mediate_deleted = 삭제된 파일에 대한 접근도 중재

  #include <abstractions/base>
  # ↑ 기본 라이브러리, /dev/null 등 기본 접근 허용

  file,
  # ↑ 기본 파일 접근 허용 (아래 deny 규칙이 우선)

  # === 쓰기 제한 규칙 ===
  deny /** w,
  # ↑ 모든 경로(/**)에 대해 쓰기(w) 거부
  # deny = 명시적 거부 (로그에도 기록됨)
  # ** = 재귀적 (하위 디렉토리 포함)
  # w = write (쓰기)

  # === 예외: 쓰기 허용 경로 ===
  /tmp/** rw,
  # ↑ /tmp와 하위 경로에 읽기(r)+쓰기(w) 허용
  /var/tmp/** rw,

  # === 커널 인터페이스 보호 ===
  deny /proc/** w,
  # ↑ /proc (프로세스 정보) 쓰기 거부
  deny /sys/** w,
  # ↑ /sys (커널 파라미터) 쓰기 거부
}
```

```
# ═══════════════════════════════════════════
# 프로파일 2: 네트워크 제한 (raw 소켓 차단)
# ═══════════════════════════════════════════
# 파일: /etc/apparmor.d/k8s-restrict-network
```

```
#include <tunables/global>

profile k8s-restrict-network flags=(attach_disconnected,mediate_deleted) {
  #include <abstractions/base>

  file,

  # === 허용할 네트워크 프로토콜 ===
  network tcp,
  # ↑ TCP 소켓 허용 (HTTP, HTTPS 등)
  network udp,
  # ↑ UDP 소켓 허용 (DNS 등)

  # === 차단할 네트워크 프로토콜 ===
  deny network raw,
  # ↑ raw 소켓 차단 (ping, 패킷 캡처 등)
  # raw 소켓 = 커널을 우회하여 직접 패킷 조작
  # 공격자가 네트워크 스니핑에 사용 가능 → 차단!
  deny network packet,
  # ↑ packet 소켓 차단 (tcpdump 등)
}
```

```
# ═══════════════════════════════════════════
# 프로파일 3: 종합 보안 프로파일
# ═══════════════════════════════════════════
# 파일: /etc/apparmor.d/k8s-hardened
```

```
#include <tunables/global>

profile k8s-hardened flags=(attach_disconnected,mediate_deleted) {
  #include <abstractions/base>

  # === 파일 접근 규칙 ===
  file,

  # 쓰기 가능 경로 (최소한)
  /tmp/** rw,
  /var/tmp/** rw,
  /var/log/** rw,

  # 읽기만 가능
  /etc/** r,
  /usr/** r,
  /lib/** r,

  # 쓰기 거부 (중요 경로)
  deny /proc/** w,
  deny /sys/** w,
  deny /etc/shadow rw,
  deny /etc/passwd w,

  # 바이너리 디렉토리 쓰기 거부
  deny /usr/bin/** w,
  deny /usr/sbin/** w,
  deny /usr/local/bin/** w,
  deny /bin/** w,
  deny /sbin/** w,

  # === 네트워크 규칙 ===
  network tcp,
  network udp,
  deny network raw,
  deny network packet,

  # === capability 제한 ===
  deny capability sys_admin,
  # ↑ sys_admin = 시스템 관리 능력 (마운트, 커널 모듈 등)
  deny capability sys_ptrace,
  # ↑ sys_ptrace = 다른 프로세스 추적 (디버깅)
  deny capability net_raw,
  # ↑ net_raw = raw 소켓 생성
}
```

### 1.5 프로파일 관리 명령어

```bash
# ═══ 프로파일 로드/관리 ═══

# enforce 모드로 로드 (프로덕션)
sudo apparmor_parser -r /etc/apparmor.d/k8s-deny-write
# -r = replace (기존 프로파일 교체)

# complain 모드로 로드 (디버깅)
sudo apparmor_parser -C /etc/apparmor.d/k8s-deny-write
# -C = complain mode

# 프로파일 제거
sudo apparmor_parser -R /etc/apparmor.d/k8s-deny-write
# -R = remove

# 로드된 프로파일 확인
sudo aa-status
# 출력:
# 42 profiles are loaded.
# 40 profiles are in enforce mode.
#   k8s-deny-write
#   k8s-restrict-network
#   ...
# 2 profiles are in complain mode.

# 특정 프로파일 확인
sudo aa-status | grep k8s
```

### 1.6 Pod에 AppArmor 적용

```yaml
# ═══════════════════════════════════════════
# K8s 1.30+ (securityContext 방식 - GA)
# CKS 시험에서는 이 방식을 사용한다
# ═══════════════════════════════════════════
apiVersion: v1
kind: Pod
metadata:
  name: apparmor-pod
spec:
  nodeName: worker-node              # 프로파일이 로드된 노드를 지정해야 함!
  containers:
  - name: app
    image: nginx:1.25
    securityContext:
      appArmorProfile:               # AppArmor 프로파일 설정
        type: Localhost              # Localhost = 노드에 로드된 프로파일
        localhostProfile: k8s-deny-write
                                     # 프로파일 이름 (aa-status에서 확인)
    volumeMounts:
    - name: tmp
      mountPath: /tmp                # 쓰기 가능 경로 마운트
  volumes:
  - name: tmp
    emptyDir: {}

# ═══════════════════════════════════════════
# K8s 1.29 이하 (annotation 방식 - beta)
# ═══════════════════════════════════════════
---
apiVersion: v1
kind: Pod
metadata:
  name: apparmor-pod-legacy
  annotations:
    # 형식: container.apparmor.security.beta.kubernetes.io/<컨테이너이름>: localhost/<프로파일이름>
    container.apparmor.security.beta.kubernetes.io/app: localhost/k8s-deny-write
spec:
  nodeName: worker-node
  containers:
  - name: app                       # annotation의 컨테이너 이름과 일치해야!
    image: nginx:1.25
```

```
AppArmor Profile 타입:
═════════════════════

type: RuntimeDefault   → 컨테이너 런타임의 기본 AppArmor 프로파일
type: Localhost        → 노드에 로드된 커스텀 프로파일
type: Unconfined       → AppArmor 미적용 (비권장)

CKS에서는 Localhost를 사용하여 커스텀 프로파일을 적용하는 문제가 나온다.
```

### 1.7 AppArmor 실습 검증

```bash
# 1. 프로파일이 커널에 로드되었는지 확인
sudo aa-status | grep k8s-deny-write
```

```text
   k8s-deny-write
```

enforce mode 목록에 프로파일 이름이 표시되면 정상이다.

```bash
# 2. Pod 생성 후 쓰기 차단 검증
kubectl exec apparmor-pod -- touch /root/test.txt 2>&1
```

```text
touch: cannot touch '/root/test.txt': Permission denied
```

AppArmor가 deny /** w 규칙에 의해 쓰기를 차단한 것이다.

```bash
# 3. 허용된 경로 쓰기 확인
kubectl exec apparmor-pod -- touch /tmp/test.txt && echo "SUCCESS"
```

```text
SUCCESS
```

/tmp/** rw 규칙에 의해 /tmp 경로는 쓰기가 허용된다.

```bash
# 4. 읽기 확인
kubectl exec apparmor-pod -- cat /etc/passwd | head -1
```

```text
root:x:0:0:root:/root:/bin/bash
```

읽기는 file, 규칙에 의해 허용된다. deny 규칙은 w(쓰기)만 차단한다.

```bash
# 5. /etc 쓰기 차단 확인
kubectl exec apparmor-pod -- sh -c "echo test > /etc/test" 2>&1
```

```text
sh: can't create /etc/test: Permission denied
```

```bash
# 6. 커널 로그에서 AppArmor 차단 이벤트 확인 (노드에서)
dmesg | grep "apparmor.*DENIED" | tail -3
```

```text
[12345.678] audit: type=1400 audit(1711756800.000:100): apparmor="DENIED" operation="mknod" profile="k8s-deny-write" name="/root/test.txt" pid=12345 comm="touch" requested_mask="c" denied_mask="c" fsuid=0 ouid=0
```

커널의 LSM hook에서 AppArmor 모듈이 차단한 이벤트가 audit 로그에 기록된다. operation, profile, name, requested_mask 필드로 차단 원인을 파악할 수 있다.

---

## 2. seccomp 완전 정복

### 2.1 seccomp 커널 메커니즘

```
seccomp(Secure Computing Mode) - 시스템콜 필터링 메커니즘
═════════════════════════════════════════════════════════

seccomp은 리눅스 커널의 시스템콜 필터링 메커니즘으로,
prctl(PR_SET_SECCOMP) 또는 seccomp(2) 시스템콜을 통해 활성화된다.
BPF(Berkeley Packet Filter) 프로그램을 사용하여 시스템콜 번호를
검사하고 ALLOW, KILL, ERRNO, TRACE, LOG 등의 액션을 수행한다.

리눅스 커널에는 약 400개의 시스템콜이 있다:
  - read, write, openat → 정상적인 파일 I/O에 필수
  - execve → 프로세스 생성에 필수
  - mount → 파일시스템 마운트 (컨테이너에서 대부분 불필요, 권한 상승에 악용 가능)
  - ptrace → 프로세스 메모리 접근/디버깅 (컨테이너 이스케이프에 악용 가능)
  - reboot → 시스템 재부팅 (컨테이너에서 절대 불필요)

seccomp-bpf 프로파일은 JSON 형식으로 defaultAction과 syscalls 배열을 정의한다.
Kubernetes에서는 securityContext.seccompProfile로 Pod/Container에 적용하며,
RuntimeDefault 프로파일은 containerd/CRI-O가 제공하는 기본 화이트리스트를 사용한다.
```

### 2.2 seccomp 동작 원리

```
seccomp 동작 흐름
════════════════

1. seccomp 프로파일 정의 (JSON 파일)
   - defaultAction: 기본 동작 (허용 또는 차단)
   - syscalls: 시스템콜 목록과 동작
   │
   ▼
2. Pod YAML에서 seccomp 프로파일 지정
   │
   ▼
3. 컨테이너 런타임이 컨테이너 생성 시 프로파일 적용
   │
   ▼
4. 컨테이너 내 프로세스가 시스템콜을 호출할 때마다
   커널의 seccomp 필터가 확인
   │
   ├─ SCMP_ACT_ALLOW: 시스템콜 실행 허용
   ├─ SCMP_ACT_ERRNO: 시스템콜 차단 (에러 반환, 프로세스 계속)
   ├─ SCMP_ACT_LOG:   시스템콜 허용 + 로그 기록
   └─ SCMP_ACT_KILL:  시스템콜 차단 (프로세스 즉시 종료!)
```

### 2.3 seccomp 프로파일 타입

```
seccomp 프로파일 타입 비교
═════════════════════════

타입           | 설명                              | 사용 시기
───────────────┼──────────────────────────────────┼──────────────────
RuntimeDefault | 컨테이너 런타임의 기본 프로파일      | 대부분의 워크로드 (권장)
               | containerd/CRI-O가 제공            |
               | 약 60개 시스템콜 차단               |
               | mount, ptrace, reboot 등 차단      |
Localhost      | 노드의 로컬 커스텀 프로파일           | 특별한 보안 요구사항
               | /var/lib/kubelet/seccomp/ 하위      |
               | 사용자가 직접 작성                   |
Unconfined     | seccomp 미적용                      | 절대 비권장!
               | 모든 시스템콜 허용                   | 레거시 호환용
```

### 2.4 RuntimeDefault 적용

```yaml
# ═══════════════════════════════════════════
# RuntimeDefault 적용 (가장 기본적인 seccomp 보안)
# ═══════════════════════════════════════════
apiVersion: v1
kind: Pod
metadata:
  name: seccomp-default
spec:
  securityContext:
    seccompProfile:
      type: RuntimeDefault           # 컨테이너 런타임의 기본 프로파일
                                     # containerd: 약 60개 위험 시스템콜 차단
                                     # mount, ptrace, reboot 등 차단
  containers:
  - name: app
    image: nginx:1.25
    securityContext:
      allowPrivilegeEscalation: false  # 권한 상승 방지
                                       # RuntimeDefault와 함께 사용 권장

# Pod 레벨 vs 컨테이너 레벨:
#   - seccompProfile은 Pod 레벨에서 설정하면 모든 컨테이너에 적용
#   - 컨테이너 레벨에서도 설정 가능 (컨테이너 설정이 우선)
```

### 2.5 커스텀 seccomp 프로파일 작성

```json
// ═══════════════════════════════════════════
// 차단 목록 방식 (denylist): 특정 시스템콜만 차단
// ═══════════════════════════════════════════
// 파일: /var/lib/kubelet/seccomp/profiles/deny-mkdir.json
{
  "defaultAction": "SCMP_ACT_ALLOW",     // 기본: 모든 시스템콜 허용
  "syscalls": [
    {
      "names": ["mkdir", "mkdirat"],       // mkdir, mkdirat 시스템콜
      "action": "SCMP_ACT_ERRNO",          // 차단 (에러 반환)
      "errnoRet": 1                        // EPERM 에러
    }
  ]
}
```

```json
// ═══════════════════════════════════════════
// 허용 목록 방식 (allowlist): 특정 시스템콜만 허용 (더 안전)
// ═══════════════════════════════════════════
// 파일: /var/lib/kubelet/seccomp/profiles/strict.json
{
  "defaultAction": "SCMP_ACT_ERRNO",      // 기본: 모든 시스템콜 차단!
  "architectures": [
    "SCMP_ARCH_X86_64",                    // x86_64 아키텍처
    "SCMP_ARCH_AARCH64"                    // ARM64 아키텍처
  ],
  "syscalls": [
    {
      "names": [
        // === 파일 시스템 ===
        "access", "close", "dup", "dup2", "dup3",
        "faccessat", "faccessat2", "fchmod", "fchown", "fcntl",
        "fstat", "fstatfs", "getcwd", "getdents64",
        "lseek", "newfstatat", "open", "openat",
        "read", "readlink", "readlinkat", "rename",
        "stat", "statfs", "statx", "unlink", "unlinkat",
        "write", "writev", "pread64", "pwrite64",
        "sendfile",

        // === 프로세스 관리 ===
        "arch_prctl", "brk", "clone", "execve",
        "exit", "exit_group", "futex",
        "getegid", "geteuid", "getgid", "getpid",
        "getppid", "getuid", "kill", "tgkill",
        "prctl", "prlimit64", "set_robust_list",
        "set_tid_address", "wait4",
        "capget", "capset",
        "setgid", "setgroups", "setuid",
        "sigaltstack", "rt_sigaction", "rt_sigprocmask", "rt_sigreturn",

        // === 메모리 관리 ===
        "mmap", "mprotect", "munmap", "madvise",

        // === 네트워크 ===
        "accept4", "bind", "connect", "listen",
        "getsockname", "getsockopt", "setsockopt",
        "recvfrom", "recvmsg", "sendmsg", "sendto",
        "socket", "socketpair",

        // === 기타 ===
        "epoll_create1", "epoll_ctl", "epoll_pwait",
        "getrandom", "ioctl", "nanosleep",
        "pipe", "pipe2", "poll", "ppoll", "select",
        "sysinfo", "uname"
      ],
      "action": "SCMP_ACT_ALLOW"           // 위 목록만 허용
    }
  ]
}
// 위 목록에 없는 시스템콜(mount, ptrace, reboot, unshare 등)은
// defaultAction에 의해 차단된다
```

### 2.6 Localhost 프로파일 적용

```yaml
# ═══════════════════════════════════════════
# Localhost 커스텀 seccomp 프로파일 적용
# ═══════════════════════════════════════════
apiVersion: v1
kind: Pod
metadata:
  name: seccomp-custom
spec:
  nodeName: worker-node              # 프로파일 파일이 있는 노드!
  securityContext:
    seccompProfile:
      type: Localhost                # 로컬 커스텀 프로파일
      localhostProfile: profiles/deny-mkdir.json
      # ↑ /var/lib/kubelet/seccomp/ 기준 상대 경로
      # 전체 경로: /var/lib/kubelet/seccomp/profiles/deny-mkdir.json
  containers:
  - name: app
    image: nginx:1.25
    securityContext:
      allowPrivilegeEscalation: false
```

```
중요: 파일 경로 규칙
════════════════════

localhostProfile의 기준 경로: /var/lib/kubelet/seccomp/

localhostProfile: profiles/custom.json
→ 실제 경로: /var/lib/kubelet/seccomp/profiles/custom.json

localhostProfile: my-profile.json
→ 실제 경로: /var/lib/kubelet/seccomp/my-profile.json

프로파일 파일이 해당 경로에 없으면 Pod 생성 실패!
```

### 2.7 seccomp 실습 검증

```bash
# mkdir 차단 검증
kubectl exec seccomp-custom -- mkdir /tmp/testdir 2>&1
```

```text
mkdir: can't create directory '/tmp/testdir': Operation not permitted
```

seccomp BPF 필터가 mkdir 시스템콜(번호 83)을 인터셉트하여 SCMP_ACT_ERRNO를 반환한 것이다.

```bash
# RuntimeDefault로 차단되는 것들 검증
kubectl exec seccomp-default -- unshare --user /bin/sh 2>&1
```

```text
unshare: unshare(0x10000000): Operation not permitted
```

RuntimeDefault 프로파일은 unshare 시스템콜을 차단한다. 이 시스템콜은 새 user namespace를 생성하여 권한 상승에 악용될 수 있다.

```bash
# Pod의 seccomp 상태 확인
kubectl get pod seccomp-custom -o jsonpath='{.spec.securityContext.seccompProfile}' | python3 -m json.tool
```

```text
{
    "localhostProfile": "profiles/deny-mkdir.json",
    "type": "Localhost"
}
```

```bash
# 커널 수준에서 seccomp 상태 확인 (노드에서)
# 컨테이너의 PID를 찾아서 /proc/<pid>/status 확인
crictl inspect <container-id> | jq '.info.pid'
cat /proc/<pid>/status | grep Seccomp
```

```text
Seccomp:	2
Seccomp_filters:	1
```

Seccomp 값 의미: 0=SECCOMP_MODE_DISABLED, 1=SECCOMP_MODE_STRICT, 2=SECCOMP_MODE_FILTER(BPF 사용). 값이 2이면 seccomp-bpf 필터가 적용된 것이다.

### 2.8 seccomp 액션 상세

```
seccomp 액션 비교
════════════════

액션              | 동작                    | 프로세스 상태
──────────────────┼────────────────────────┼──────────────
SCMP_ACT_ALLOW    | 시스템콜 허용            | 정상 실행
SCMP_ACT_ERRNO    | 시스템콜 차단, 에러 반환  | 계속 실행 (에러 처리)
SCMP_ACT_LOG      | 시스템콜 허용, 로그 기록  | 정상 실행
SCMP_ACT_KILL     | 시스템콜 차단, SIGKILL    | 즉시 종료!
SCMP_ACT_KILL_PROCESS | 프로세스 전체 종료   | 즉시 종료!

CKS 시험에서:
  - SCMP_ACT_ERRNO가 가장 많이 사용된다 (차단하되 프로세스는 유지)
  - SCMP_ACT_ALLOW는 허용 목록에서 사용
  - SCMP_ACT_KILL은 극단적인 보안이 필요한 경우
```

---

## 3. 불필요한 패키지/서비스 제거

### 3.1 원칙

```
공격 표면 최소화(Attack Surface Reduction) 원칙
═══════════════════════════════════════════════

공격 표면(attack surface)은 시스템에서 외부 입력을 수신하거나
권한 있는 작업을 수행하는 모든 인터페이스(네트워크 포트, IPC, 파일 등)의
총합이다. 공격 표면이 클수록 취약점이 존재할 확률과 공격 벡터가 증가한다.

최소화 원칙: 시스템에서 불필요한 서비스와 패키지를 제거하여
노출된 인터페이스 수를 줄이고, 잠재적 취약점을 사전에 제거한다.

쿠버네티스 노드에서 필수적인 프로세스만 유지한다:
  필수: kubelet, containerd, kube-proxy, sshd (관리용)
  불필요: cups (프린터 데몬), avahi-daemon (mDNS), bluetoothd, snapd 등
  → 각 불필요 서비스는 네트워크 리스닝 소켓 또는 로컬 권한 상승 경로를 제공할 수 있다
```

### 3.2 노드 보안 점검 명령어

```bash
# ═══ 실행 중인 서비스 확인 ═══
systemctl list-units --type=service --state=running

# 필수 서비스:
#   kubelet.service        - 컨테이너 오케스트레이션
#   containerd.service     - 컨테이너 런타임
#   sshd.service          - 원격 관리
#   systemd-* 관련        - 시스템 필수

# 불필요한 서비스 (있으면 제거):
#   cups.service          - 프린터 서비스
#   avahi-daemon.service  - 네트워크 디스커버리
#   bluetooth.service     - 블루투스
#   snapd.service         - Snap 패키지 매니저
#   apache2.service       - 웹 서버 (노드에서 불필요)

# ═══ 서비스 중지 및 비활성화 ═══
sudo systemctl stop snapd
sudo systemctl disable snapd
# stop: 즉시 중지
# disable: 부팅 시 자동 시작 비활성화

# 상태 확인
systemctl status snapd
# ● snapd.service
#    Active: inactive (dead)

# ═══ 열려 있는 포트 확인 ═══
ss -tlnp
# -t: TCP
# -l: LISTEN 상태
# -n: 포트 번호 (이름 변환 안 함)
# -p: 프로세스 정보

# 예상 필수 포트:
#   6443    - API Server (마스터)
#   10250   - kubelet
#   10256   - kube-proxy health check
#   2379    - etcd (마스터)
#   2380    - etcd peer (마스터)
#   30000-32767 - NodePort 범위

# 불필요한 포트가 열려 있으면 해당 서비스를 중지한다

# ═══ 불필요한 패키지 확인/제거 ═══
dpkg -l | grep -E "vim|curl|wget|netcat|nmap|tcpdump"
# 보안 관련 불필요한 도구:
#   netcat, nmap, tcpdump → 네트워크 스캔/스니핑 도구
#   telnet → 비암호화 원격 접속

sudo apt-get remove --purge netcat nmap tcpdump
sudo apt-get autoremove

# ═══ SUID 바이너리 검색 ═══
find / -perm -4000 -type f 2>/dev/null
# SUID = Set User ID
# SUID 비트가 설정된 바이너리는 소유자(보통 root) 권한으로 실행됨
# 공격자가 이를 악용하여 권한 상승 가능

# ═══ 불필요한 사용자 확인 ═══
cat /etc/passwd | grep -v "nologin\|false"
# 셸 접근이 가능한 사용자 목록
# 불필요한 사용자가 있으면 셸을 /usr/sbin/nologin으로 변경

# ═══ 불필요한 커널 모듈 비활성화 ═══
# /etc/modprobe.d/k8s-security.conf
echo "install cramfs /bin/true" | sudo tee -a /etc/modprobe.d/k8s-security.conf
echo "install freevxfs /bin/true" | sudo tee -a /etc/modprobe.d/k8s-security.conf
echo "install udf /bin/true" | sudo tee -a /etc/modprobe.d/k8s-security.conf
```

---

## 4. 커널 파라미터 보안 (sysctl)

### 4.1 주요 보안 커널 파라미터

```bash
# ═══ 커널 파라미터 확인 ═══

# IP 포워딩 (K8s에서는 1 필요)
sysctl net.ipv4.ip_forward
# 값: 1 (쿠버네티스 노드에서는 1이어야 한다)

# ICMP 리다이렉트 수신 (0 권장)
sysctl net.ipv4.conf.all.accept_redirects
# 값: 0 (MITM 공격 방지)

# ICMP 리다이렉트 전송 (0 권장)
sysctl net.ipv4.conf.all.send_redirects
# 값: 0

# SYN Cookie (1 권장)
sysctl net.ipv4.tcp_syncookies
# 값: 1 (SYN 플러드 공격 방어)

# ASLR (2 권장)
sysctl kernel.randomize_va_space
# 값: 2 (메모리 주소 무작위화 → 버퍼 오버플로우 공격 방어)

# 하드링크 보호 (1 권장)
sysctl fs.protected_hardlinks
# 값: 1 (하드링크를 통한 권한 상승 방지)

# 심볼릭링크 보호 (1 권장)
sysctl fs.protected_symlinks
# 값: 1 (심볼릭링크를 통한 접근 우회 방지)

# 설정 변경 (영구 적용)
echo "net.ipv4.conf.all.accept_redirects = 0" | sudo tee -a /etc/sysctl.d/99-security.conf
sudo sysctl -p /etc/sysctl.d/99-security.conf
```

### 4.2 Pod에서 sysctl 설정

```yaml
# ═══════════════════════════════════════════
# Pod에서 sysctl 설정
# ═══════════════════════════════════════════
apiVersion: v1
kind: Pod
metadata:
  name: sysctl-pod
spec:
  securityContext:
    sysctls:
    - name: net.ipv4.ip_unprivileged_port_start
      value: "0"
      # ↑ safe sysctl: 별도 설정 없이 사용 가능
      # 비특권 사용자가 0번 포트부터 바인딩 가능
    # - name: net.ipv4.ip_forward
    #   value: "1"
    #   # ↑ unsafe sysctl: kubelet에서 --allowed-unsafe-sysctls로 허용 필요
  containers:
  - name: app
    image: nginx:1.25
```

```
safe sysctl vs unsafe sysctl
═════════════════════════════

safe sysctl: 네임스페이스가 분리되어 다른 Pod에 영향 없음
  - net.ipv4.ip_unprivileged_port_start
  - kernel.shm_rmid_forced

unsafe sysctl: 호스트나 다른 Pod에 영향을 줄 수 있음
  - net.ipv4.ip_forward
  - net.core.somaxconn
  → kubelet의 --allowed-unsafe-sysctls 플래그로 허용 필요
```

---

## 5. AppArmor/seccomp 트러블슈팅

```
System Hardening 보안 설정 장애 시나리오
════════════════════════════════════════

시나리오 1: AppArmor 프로파일을 적용한 Pod가 생성 실패한다
  에러: "cannot enforce AppArmor: profile k8s-deny-write is not loaded"
  원인: Pod가 스케줄링된 노드에 프로파일이 로드되어 있지 않다
  디버깅:
    kubectl describe pod <pod-name>  # Events 섹션에서 에러 확인
    ssh <node> && aa-status | grep k8s-deny-write
  해결: 해당 노드에서 apparmor_parser -r로 프로파일을 로드하거나, nodeName으로 프로파일이 있는 노드를 지정한다

시나리오 2: seccomp Localhost 프로파일을 적용했는데 Pod가 CreateContainerError 상태이다
  에러: "failed to generate security options: cannot load seccomp profile"
  원인: /var/lib/kubelet/seccomp/ 경로에 프로파일 파일이 없다
  디버깅:
    kubectl describe pod <pod-name>  # Events에서 정확한 에러 확인
    ssh <node> && ls -la /var/lib/kubelet/seccomp/profiles/
  해결: 올바른 경로에 JSON 프로파일 파일을 생성한다. localhostProfile은 /var/lib/kubelet/seccomp/ 기준 상대 경로이다.

시나리오 3: AppArmor 프로파일을 enforce 모드로 로드했는데 아무것도 차단되지 않는다
  원인: 프로파일 문법 오류로 기본 허용(file, 규칙)만 적용되었다
  디버깅:
    sudo apparmor_parser -p /etc/apparmor.d/<profile>  # 문법 검증
    dmesg | grep apparmor  # 커널 로그에서 에러 확인
  해결: 프로파일 문법을 수정하고 apparmor_parser -r로 재로드한다

시나리오 4: seccomp 프로파일로 특정 시스템콜을 차단했는데 애플리케이션이 죽는다
  원인: SCMP_ACT_KILL 액션이 프로세스를 SIGKILL로 종료시킨다
  디버깅:
    kubectl logs <pod>  # 애플리케이션 로그 확인
    dmesg | grep seccomp  # 커널에서 차단된 시스템콜 확인
  해결: SCMP_ACT_KILL 대신 SCMP_ACT_ERRNO를 사용하면 프로세스는 유지되고 에러만 반환한다
```

---

## tart-infra 실습

### 실습 환경 설정

```bash
# dev 클러스터 접속
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/dev.yaml

# 클러스터 및 demo 네임스페이스 확인
kubectl get nodes
kubectl get pods -n demo
```

### 과제 1: SecurityContext 보안 설정 점검

demo 네임스페이스의 Pod들에 적용된 SecurityContext를 점검하여 seccomp, capabilities, 권한 상승 방지 설정 상태를 확인한다.

```bash
# 모든 Pod의 SecurityContext 확인
kubectl get pods -n demo -o jsonpath='{range .items[*]}=== {.metadata.name} ==={"\n"}  runAsNonRoot: {.spec.securityContext.runAsNonRoot}{"\n"}  seccompProfile: {.spec.securityContext.seccompProfile.type}{"\n"}{range .spec.containers[*]}  container[{.name}] allowPrivilegeEscalation: {.securityContext.allowPrivilegeEscalation}{"\n"}  container[{.name}] readOnlyRootFilesystem: {.securityContext.readOnlyRootFilesystem}{"\n"}{end}{"\n"}{end}'

# 예상 출력:
# === frontend-xxx ===
#   runAsNonRoot: true
#   seccompProfile: RuntimeDefault
#   container[frontend] allowPrivilegeEscalation: false
#   container[frontend] readOnlyRootFilesystem: true

# capabilities 확인 (drop ALL이 권장)
kubectl get pods -n demo -o jsonpath='{range .items[*]}{.metadata.name}: {range .spec.containers[*]}drop={.securityContext.capabilities.drop} add={.securityContext.capabilities.add}{end}{"\n"}{end}'
# 예상 출력: drop=["ALL"] add=[] (모든 capability 제거, 필요한 것만 추가)
```

**동작 원리:** SecurityContext의 seccompProfile: RuntimeDefault는 containerd 기본 seccomp 프로파일을 적용하여 mount, ptrace 등 약 60개 위험 시스템콜을 차단한다. allowPrivilegeEscalation: false는 커널의 no_new_privs 비트를 설정하여 setuid/setgid 바이너리를 통한 권한 상승을 방지한다.

### 과제 2: 권한 상승 시도 검증

SecurityContext가 올바르게 적용되었을 때 실제로 권한 상승이 차단되는지 검증한다.

```bash
# 컨테이너 내에서 권한 있는 작업 시도
# 1) 파일시스템 쓰기 시도 (readOnlyRootFilesystem: true인 경우)
kubectl exec -n demo deploy/frontend -- touch /etc/test 2>&1
# 예상 출력: touch: /etc/test: Read-only file system

# 2) 프로세스 UID 확인 (runAsNonRoot: true인 경우)
kubectl exec -n demo deploy/frontend -- id
# 예상 출력: uid=1000(appuser) gid=1000(appgroup) → root가 아님

# 3) raw 소켓 생성 시도 (capabilities drop ALL인 경우)
kubectl exec -n demo deploy/frontend -- ping -c 1 127.0.0.1 2>&1
# 예상 출력: ping: permission denied (raw socket requires CAP_NET_RAW)
```

**동작 원리:** readOnlyRootFilesystem은 컨테이너의 rootfs를 읽기 전용으로 마운트하여 악성코드 드롭/설정 변조를 방지한다. capabilities drop ALL은 POSIX capability를 모두 제거하므로, CAP_NET_RAW가 없어 raw 소켓(ping)을 생성할 수 없다.

### 과제 3: 멀티 클러스터 보안 수준 비교

dev와 prod 클러스터의 SecurityContext 적용률을 비교하여 환경별 보안 경 hardening 수준을 점검한다.

```bash
# dev 클러스터: seccomp 적용 Pod 비율
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/dev.yaml
echo "=== dev 클러스터 ==="
TOTAL=$(kubectl get pods -A --no-headers --field-selector=metadata.namespace!=kube-system 2>/dev/null | wc -l)
SECCOMP=$(kubectl get pods -A -o json --field-selector=metadata.namespace!=kube-system 2>/dev/null | jq '[.items[] | select(.spec.securityContext.seccompProfile.type != null)] | length')
echo "전체 Pod: $TOTAL, seccomp 적용: $SECCOMP"

# prod 클러스터
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/prod.yaml
echo "=== prod 클러스터 ==="
TOTAL=$(kubectl get pods -A --no-headers --field-selector=metadata.namespace!=kube-system 2>/dev/null | wc -l)
SECCOMP=$(kubectl get pods -A -o json --field-selector=metadata.namespace!=kube-system 2>/dev/null | jq '[.items[] | select(.spec.securityContext.seccompProfile.type != null)] | length')
echo "전체 Pod: $TOTAL, seccomp 적용: $SECCOMP"
```

**동작 원리:** seccomp 프로파일이 적용되지 않은 Pod(Unconfined)는 약 400개 시스템콜을 모두 사용할 수 있어 컨테이너 이스케이프 공격에 취약하다. 프로덕션 환경에서는 모든 Pod에 최소 RuntimeDefault를 적용하여 공격 표면을 줄여야 한다.

---

> **내일 예고:** Day 6에서는 System Hardening 도메인의 나머지 주제인 위험한 시스템콜과 capabilities, 불필요한 서비스 제거, 커널 파라미터 보안, 시험 실전 문제를 다룬다.
