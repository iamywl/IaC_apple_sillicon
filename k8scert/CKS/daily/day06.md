# CKS Day 6: System Hardening (2/2) - 시스템콜, capabilities, 서비스 강화, 시험 실전

> 학습 목표 | CKS 도메인: System Hardening (15%) | 예상 소요 시간: 2시간

---

## 오늘의 학습 목표

- 위험한 시스템콜과 Linux capabilities를 이해한다
- 불필요한 패키지/서비스를 식별하고 제거하여 공격 표면을 줄인다
- 커널 파라미터(sysctl) 보안 설정을 이해한다
- System Hardening 도메인의 시험 출제 패턴을 분석하고 실전 문제를 풀어본다

---


## 5. 위험한 시스템콜과 capabilities

### 5.0 시스템콜과 Capabilities의 커널 수준 동작 원리

```
Linux 커널의 시스템콜 처리 과정
══════════════════════════════

1. 사용자 공간 프로세스가 시스템콜을 호출한다 (예: mount(2))
2. CPU가 syscall 명령어로 커널 모드로 전환한다 (x86_64: SYSCALL 인스트럭션)
3. 커널의 sys_call_table에서 시스템콜 번호로 핸들러 함수를 찾는다
4. 핸들러 실행 전, 보안 검사 체인이 순서대로 수행된다:
   a) seccomp BPF 필터 검사 — 시스템콜 번호 기반으로 ALLOW/DENY 판정
   b) LSM(AppArmor/SELinux) 검사 — 경로/라벨 기반 접근 제어
   c) capability 검사 — 해당 작업에 필요한 capability 비트 확인
   d) DAC(파일 퍼미션) 검사 — uid/gid 기반 접근 제어
5. 모든 검사를 통과하면 핸들러 함수가 실행된다

컨테이너 보안에서의 의미:
  - seccomp: 시스템콜 자체를 차단하므로 가장 먼저 검사된다 (최소 오버헤드)
  - AppArmor: 시스템콜이 접근하려는 리소스(파일, 네트워크)를 검사한다
  - capabilities: 특권 작업에 필요한 capability가 프로세스에 있는지 검사한다
  - 3가지를 조합하면 다층 방어(defense-in-depth)가 구성된다
```

### 5.1 위험한 시스템콜

```
CKS에서 알아야 할 위험한 시스템콜
═══════════════════════════════

시스템콜    | 위험성                              | seccomp으로 차단
───────────┼─────────────────────────────────────┼─────────────────
ptrace     | 다른 프로세스 디버깅/추적              | RuntimeDefault 차단
           | 컨테이너 이스케이프에 악용 가능          |
mount      | 파일시스템 마운트                      | RuntimeDefault 차단
           | 호스트 파일시스템 접근 악용 가능          |
reboot     | 시스템 재부팅                         | RuntimeDefault 차단
sethostname| 호스트명 변경                         | RuntimeDefault 차단
unshare    | 새 네임스페이스 생성                    | RuntimeDefault 차단
           | 권한 상승에 악용 가능                   |
init_module| 커널 모듈 로드                        | RuntimeDefault 차단
           | 커널 수준 악성코드 설치 가능             |
clone      | 새 프로세스/스레드 생성                  | 기본 허용 (필요)
           | CLONE_NEWUSER 플래그와 함께 사용 시 위험  |
```

### 5.2 리눅스 capabilities

```
Linux Capabilities - POSIX 권한 세분화 메커니즘
═══════════════════════════════════════════════

전통적 UNIX 권한 모델은 UID 0(root)에 모든 특권을 부여하는 이진적 구조이다.
Linux capabilities(7)는 이 특권을 약 40개의 개별 capability 비트로 분리하여,
프로세스에 필요한 최소 특권만 부여하는 세분화된 권한 모델을 제공한다.
커널은 특권 작업 수행 시 해당 capability 비트를 검사한다.

주요 capabilities:
  CAP_NET_BIND_SERVICE - 1024 미만 포트 bind(2) 허용 (nginx 80/443 등)
  CAP_NET_RAW          - AF_PACKET raw 소켓 생성 허용 (ping, tcpdump)
  CAP_SYS_ADMIN        - mount, bpf, namespace 등 광범위한 특권 → 컨테이너 이스케이프 경로
  CAP_SYS_PTRACE       - ptrace(2) 시스템콜 허용 → 프로세스 메모리 접근 가능
  CAP_DAC_OVERRIDE     - 파일 DAC 퍼미션 검사 우회 → 임의 파일 접근 가능
  CAP_SYS_CHROOT       - chroot(2) 시스템콜 허용

CKS 보안 모범 사례:
  1. capabilities.drop: ["ALL"]  → effective/permitted 셋에서 모든 capability 제거
  2. capabilities.add: ["NET_BIND_SERVICE"]  → 필요한 capability만 선택적 추가
  3. CAP_SYS_ADMIN, CAP_SYS_PTRACE는 컨테이너 이스케이프 경로이므로 절대 추가하지 않는다
```

```yaml
# capabilities 설정 예제
apiVersion: v1
kind: Pod
metadata:
  name: cap-pod
spec:
  containers:
  - name: app
    image: nginx:1.25
    securityContext:
      capabilities:
        drop: ["ALL"]                # 모든 capability 제거
        add: ["NET_BIND_SERVICE"]    # 80번 포트 바인딩에 필요한 것만 추가
      # 결과: 이 컨테이너는 NET_BIND_SERVICE만 가지고 있다
      # ping(NET_RAW 필요)도, mount(SYS_ADMIN 필요)도 할 수 없다
```

### 5.3 Capabilities 실습 검증

```bash
# 컨테이너의 현재 capabilities 확인
kubectl exec cap-pod -- cat /proc/1/status | grep -i cap
```

```text
CapInh:	0000000000000400
CapPrm:	0000000000000400
CapEff:	0000000000000400
CapBnd:	0000000000000400
CapAmb:	0000000000000000
```

0x400은 10진수 1024이며, CAP_NET_BIND_SERVICE(비트 10)만 설정된 것이다.

```bash
# ping 시도 (CAP_NET_RAW 필요 → 차단)
kubectl exec cap-pod -- ping -c 1 127.0.0.1 2>&1
```

```text
ping: permission denied (are you root?)
```

```bash
# 80번 포트 바인딩 (CAP_NET_BIND_SERVICE → 허용)
kubectl exec cap-pod -- nginx -t 2>&1
```

```text
nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
nginx: configuration file /etc/nginx/nginx.conf test is successful
```

```bash
# capsh로 capabilities 해독 (노드에서)
capsh --decode=0000000000000400
```

```text
0x0000000000000400=cap_net_bind_service
```

---

## 6. 이 주제가 시험에서 어떻게 나오는가

### 6.1 출제 패턴 분석

```
System Hardening 도메인 출제 패턴 (15%)
════════════════════════════════════════

1. AppArmor 프로파일 작성 및 Pod 적용 (매우 빈출)
   - "노드에 AppArmor 프로파일을 작성하고 Pod에 적용하라"
   - "특정 디렉토리에 대한 쓰기를 차단하라"
   의도: AppArmor 프로파일 문법과 Pod 적용 능력 평가

2. seccomp 프로파일 적용 (빈출)
   - "RuntimeDefault seccomp을 Pod에 적용하라"
   - "커스텀 seccomp 프로파일을 Pod에 적용하라"
   의도: seccomp 타입과 경로 규칙 이해도 평가

3. 불필요한 서비스 제거 (가끔 출제)
   - "노드에서 불필요한 서비스를 찾아서 비활성화하라"
   의도: 공격 표면 줄이기 능력 평가

4. 커널 파라미터 (드물게 출제)
   - "특정 sysctl 값을 수정하라"

핵심 전략:
  → AppArmor 프로파일 문법을 암기하라 (deny /** w 패턴)
  → seccomp RuntimeDefault 적용 YAML을 외워라
  → Localhost 프로파일 경로 규칙을 확실히 이해하라
```

### 6.2 실전 문제 (10개 이상)

### 문제 1. AppArmor 프로파일 작성 및 적용

노드 `node01`에 AppArmor 프로파일 `k8s-deny-proc-write`를 생성하라. 이 프로파일은 `/proc` 디렉토리에 대한 쓰기를 거부하고, 나머지 파일은 허용해야 한다. 이 프로파일을 `secure-app` Pod의 `app` 컨테이너에 적용하라.

<details>
<summary>풀이</summary>

```bash
ssh node01

sudo tee /etc/apparmor.d/k8s-deny-proc-write > /dev/null <<'EOF'
#include <tunables/global>

profile k8s-deny-proc-write flags=(attach_disconnected,mediate_deleted) {
  #include <abstractions/base>
  file,
  deny /proc/** w,
}
EOF

sudo apparmor_parser -r /etc/apparmor.d/k8s-deny-proc-write
aa-status | grep k8s-deny-proc-write
```

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: secure-app
spec:
  nodeName: node01
  containers:
  - name: app
    image: nginx:1.25
    securityContext:
      appArmorProfile:
        type: Localhost
        localhostProfile: k8s-deny-proc-write
```

검증:
```bash
kubectl exec secure-app -- touch /proc/test 2>&1
# Permission denied
kubectl exec secure-app -- touch /tmp/test
# 성공
```

</details>

### 문제 2. seccomp RuntimeDefault 적용

`secure-ns` 네임스페이스의 모든 Pod에 seccomp RuntimeDefault 프로파일이 적용되도록 Pod Security Admission을 설정하라.

<details>
<summary>풀이</summary>

```bash
kubectl label namespace secure-ns \
  pod-security.kubernetes.io/enforce=restricted \
  pod-security.kubernetes.io/enforce-version=latest \
  pod-security.kubernetes.io/warn=restricted
```

또는 개별 Pod에 직접 적용:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: secure-pod
  namespace: secure-ns
spec:
  securityContext:
    seccompProfile:
      type: RuntimeDefault
    runAsNonRoot: true
  containers:
  - name: app
    image: nginx:1.25
    securityContext:
      allowPrivilegeEscalation: false
      runAsUser: 1000
      capabilities:
        drop: ["ALL"]
```

</details>

### 문제 3. 커스텀 seccomp 프로파일 적용

노드의 `/var/lib/kubelet/seccomp/profiles/custom.json`에 커스텀 seccomp 프로파일이 있다. 이 프로파일을 `seccomp-pod` Pod에 적용하라.

<details>
<summary>풀이</summary>

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: seccomp-pod
spec:
  securityContext:
    seccompProfile:
      type: Localhost
      localhostProfile: profiles/custom.json
  containers:
  - name: app
    image: nginx:1.25
    securityContext:
      allowPrivilegeEscalation: false
```

핵심: `localhostProfile`은 `/var/lib/kubelet/seccomp/` 기준 상대 경로이다.

</details>

### 문제 4. 불필요한 서비스 제거

워커 노드 `node01`에서 `snapd` 서비스가 실행 중이다. 이 서비스를 중지하고 비활성화하라. 불필요한 포트가 열려 있는지 확인하라.

<details>
<summary>풀이</summary>

```bash
ssh node01

# 서비스 중지 및 비활성화
sudo systemctl stop snapd
sudo systemctl disable snapd

# 확인
systemctl status snapd
# inactive (dead)

# 열린 포트 확인
ss -tlnp

# 필수 포트만 남아있는지 확인:
# 10250 - kubelet
# 10256 - kube-proxy
# 30000-32767 - NodePort
```

</details>

### 문제 5. AppArmor 네트워크 제한

raw 소켓 사용을 차단하는 AppArmor 프로파일 `k8s-restrict-network`를 작성하고 Pod에 적용하라.

<details>
<summary>풀이</summary>

```bash
ssh node01

sudo tee /etc/apparmor.d/k8s-restrict-network > /dev/null <<'EOF'
#include <tunables/global>

profile k8s-restrict-network flags=(attach_disconnected,mediate_deleted) {
  #include <abstractions/base>
  file,
  network tcp,
  network udp,
  deny network raw,
  deny network packet,
}
EOF

sudo apparmor_parser -r /etc/apparmor.d/k8s-restrict-network
```

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: network-restricted
spec:
  nodeName: node01
  containers:
  - name: app
    image: nginx:1.25
    securityContext:
      appArmorProfile:
        type: Localhost
        localhostProfile: k8s-restrict-network
```

검증:
```bash
kubectl exec network-restricted -- ping -c 1 8.8.8.8 2>&1
# Permission denied (raw 소켓 차단)

kubectl exec network-restricted -- wget -qO- --timeout=3 http://example.com
# 성공 (TCP 허용)
```

</details>

### 문제 6. AppArmor + seccomp 복합 적용

노드에 AppArmor 프로파일 `k8s-hardened`를 작성하라. /proc, /sys 쓰기 거부, /tmp만 쓰기 허용. 이 프로파일과 seccomp RuntimeDefault를 동시에 적용한 `hardened-pod`를 생성하라.

<details>
<summary>풀이</summary>

```bash
ssh node01

sudo tee /etc/apparmor.d/k8s-hardened > /dev/null <<'EOF'
#include <tunables/global>

profile k8s-hardened flags=(attach_disconnected,mediate_deleted) {
  #include <abstractions/base>
  file,
  deny /** w,
  /tmp/** rw,
  deny /proc/** w,
  deny /sys/** w,
  network tcp,
  network udp,
  deny network raw,
}
EOF

sudo apparmor_parser -r /etc/apparmor.d/k8s-hardened
```

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: hardened-pod
spec:
  nodeName: node01
  securityContext:
    runAsNonRoot: true
    runAsUser: 1000
    seccompProfile:
      type: RuntimeDefault
  containers:
  - name: app
    image: nginx:1.25
    securityContext:
      appArmorProfile:
        type: Localhost
        localhostProfile: k8s-hardened
      allowPrivilegeEscalation: false
      readOnlyRootFilesystem: true
      capabilities:
        drop: ["ALL"]
    volumeMounts:
    - name: tmp
      mountPath: /tmp
  volumes:
  - name: tmp
    emptyDir: {}
```

</details>

### 문제 7. seccomp 프로파일 작성 (denylist 방식)

노드에 seccomp 프로파일을 작성하라. `mkdir`, `mkdirat`, `unlink` 시스템콜을 차단하고 나머지는 허용한다. 이 프로파일을 `restricted-ops` Pod에 적용하라.

<details>
<summary>풀이</summary>

```bash
ssh node01

sudo mkdir -p /var/lib/kubelet/seccomp/profiles

sudo tee /var/lib/kubelet/seccomp/profiles/deny-fs-ops.json > /dev/null <<'EOF'
{
  "defaultAction": "SCMP_ACT_ALLOW",
  "syscalls": [
    {
      "names": ["mkdir", "mkdirat", "unlink"],
      "action": "SCMP_ACT_ERRNO",
      "errnoRet": 1
    }
  ]
}
EOF
```

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: restricted-ops
spec:
  nodeName: node01
  securityContext:
    seccompProfile:
      type: Localhost
      localhostProfile: profiles/deny-fs-ops.json
  containers:
  - name: app
    image: busybox
    command: ["sleep", "3600"]
    securityContext:
      allowPrivilegeEscalation: false
```

검증:
```bash
kubectl exec restricted-ops -- mkdir /tmp/test 2>&1
# Operation not permitted

kubectl exec restricted-ops -- touch /tmp/test
# 성공 (touch는 open+close, mkdir 아님)
```

</details>

### 문제 8. 노드 보안 감사

노드 `node01`에서 다음을 수행하라:
1. SUID 비트가 설정된 바이너리를 모두 찾아라
2. 불필요한 서비스를 식별하고 비활성화하라
3. SSH 설정에서 root 로그인이 허용되어 있는지 확인하라

<details>
<summary>풀이</summary>

```bash
ssh node01

# 1. SUID 바이너리 검색
find / -perm -4000 -type f 2>/dev/null
# /usr/bin/sudo, /usr/bin/passwd 등은 정상
# 비정상적인 SUID 바이너리가 있으면 조사 필요

# 2. 불필요한 서비스 식별
systemctl list-units --type=service --state=running
# 불필요한 서비스 비활성화
sudo systemctl stop cups.service 2>/dev/null
sudo systemctl disable cups.service 2>/dev/null

# 3. SSH root 로그인 확인
grep "PermitRootLogin" /etc/ssh/sshd_config
# PermitRootLogin no → 안전
# PermitRootLogin yes → 위험! → no로 변경
sudo sed -i 's/PermitRootLogin yes/PermitRootLogin no/' /etc/ssh/sshd_config
sudo systemctl restart sshd
```

</details>

### 문제 9. AppArmor 프로파일 모드 변경

현재 `k8s-deny-write` 프로파일이 complain 모드로 동작하고 있다. enforce 모드로 변경하라.

<details>
<summary>풀이</summary>

```bash
ssh node01

# 현재 모드 확인
aa-status | grep k8s-deny-write
# k8s-deny-write (complain)

# enforce 모드로 변경
sudo apparmor_parser -r /etc/apparmor.d/k8s-deny-write
# -r = replace (enforce 모드가 기본)

# 또는
sudo aa-enforce /etc/apparmor.d/k8s-deny-write

# 확인
aa-status | grep k8s-deny-write
# k8s-deny-write (enforce)
```

</details>

### 문제 10. 커널 파라미터 보안 설정

노드 `node01`에서 다음 커널 파라미터를 보안 설정으로 변경하라:
- ICMP 리다이렉트 수신 비활성화
- ICMP 리다이렉트 전송 비활성화
- SYN Cookie 활성화

<details>
<summary>풀이</summary>

```bash
ssh node01

# 현재 값 확인
sysctl net.ipv4.conf.all.accept_redirects
sysctl net.ipv4.conf.all.send_redirects
sysctl net.ipv4.tcp_syncookies

# 변경
sudo sysctl -w net.ipv4.conf.all.accept_redirects=0
sudo sysctl -w net.ipv4.conf.all.send_redirects=0
sudo sysctl -w net.ipv4.tcp_syncookies=1

# 영구 적용
cat <<'EOF' | sudo tee /etc/sysctl.d/99-security.conf
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.all.send_redirects = 0
net.ipv4.tcp_syncookies = 1
EOF

sudo sysctl -p /etc/sysctl.d/99-security.conf
```

</details>

### 문제 11. 종합 문제 - 완전히 보안 강화된 Pod

다음 요구사항을 모두 만족하는 Pod `ultra-secure-pod`를 생성하라:
- AppArmor: k8s-deny-write 프로파일 적용
- seccomp: RuntimeDefault
- runAsNonRoot: true, runAsUser: 1000
- readOnlyRootFilesystem: true
- allowPrivilegeEscalation: false
- capabilities: ALL drop
- /tmp에만 emptyDir 마운트

<details>
<summary>풀이</summary>

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: ultra-secure-pod
spec:
  nodeName: node01
  securityContext:
    runAsNonRoot: true
    runAsUser: 1000
    runAsGroup: 3000
    fsGroup: 2000
    seccompProfile:
      type: RuntimeDefault
  containers:
  - name: app
    image: nginx:1.25
    securityContext:
      appArmorProfile:
        type: Localhost
        localhostProfile: k8s-deny-write
      readOnlyRootFilesystem: true
      allowPrivilegeEscalation: false
      capabilities:
        drop: ["ALL"]
    volumeMounts:
    - name: tmp
      mountPath: /tmp
  volumes:
  - name: tmp
    emptyDir: {}
```

</details>

---

## 7. 실습

### 7.1 AppArmor 프로파일 생성 및 적용

```bash
# 워커 노드에서 프로파일 작성
ssh admin@dev-worker

# AppArmor 상태 확인
aa-status
aa-enabled  # Yes 출력 확인

# 프로파일 작성
sudo tee /etc/apparmor.d/k8s-deny-write > /dev/null <<'EOF'
#include <tunables/global>

profile k8s-deny-write flags=(attach_disconnected,mediate_deleted) {
  #include <abstractions/base>
  file,
  deny /** w,
  /tmp/** rw,
  /var/tmp/** rw,
  deny /proc/** w,
  deny /sys/** w,
}
EOF

# enforce 모드로 로드
sudo apparmor_parser -r /etc/apparmor.d/k8s-deny-write
aa-status | grep k8s-deny-write
```

```bash
# 마스터에서 Pod 생성
ssh admin@dev-master

cat <<'EOF' | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: apparmor-test
spec:
  nodeName: dev-worker
  containers:
  - name: app
    image: nginx:alpine
    securityContext:
      appArmorProfile:
        type: Localhost
        localhostProfile: k8s-deny-write
    volumeMounts:
    - name: tmp
      mountPath: /tmp
  volumes:
  - name: tmp
    emptyDir: {}
EOF

kubectl wait --for=condition=ready pod/apparmor-test --timeout=60s

# 검증
kubectl exec apparmor-test -- touch /root/test.txt 2>&1
# Permission denied

kubectl exec apparmor-test -- touch /tmp/test.txt
# 성공
```

### 7.2 seccomp 프로파일 생성 및 적용

```bash
# 워커 노드에서 seccomp 프로파일 작성
ssh admin@dev-worker

sudo mkdir -p /var/lib/kubelet/seccomp/profiles

sudo tee /var/lib/kubelet/seccomp/profiles/deny-mkdir.json > /dev/null <<'EOF'
{
  "defaultAction": "SCMP_ACT_ALLOW",
  "syscalls": [
    {
      "names": ["mkdir", "mkdirat"],
      "action": "SCMP_ACT_ERRNO",
      "errnoRet": 1
    }
  ]
}
EOF
```

```bash
# 마스터에서 Pod 생성
ssh admin@dev-master

# Localhost seccomp 적용
cat <<'EOF' | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: seccomp-custom
spec:
  nodeName: dev-worker
  securityContext:
    seccompProfile:
      type: Localhost
      localhostProfile: profiles/deny-mkdir.json
  containers:
  - name: app
    image: nginx:alpine
    securityContext:
      allowPrivilegeEscalation: false
EOF

kubectl wait --for=condition=ready pod/seccomp-custom --timeout=60s

# 검증
kubectl exec seccomp-custom -- mkdir /tmp/testdir 2>&1
# Operation not permitted

# 정리
kubectl delete pod apparmor-test seccomp-custom --ignore-not-found
```

---

## 8. System Hardening 트러블슈팅

```
시스템 강화 시 발생하는 장애 시나리오
════════════════════════════════════

시나리오 1: capabilities drop ALL 후 nginx가 시작되지 않는다
  에러: "bind() to 0.0.0.0:80 failed (13: Permission denied)"
  원인: 80번 포트 바인딩에 CAP_NET_BIND_SERVICE가 필요한데 drop ALL로 제거되었다
  디버깅:
    kubectl logs <pod>  # nginx 에러 확인
  해결: capabilities.add: ["NET_BIND_SERVICE"]를 추가한다

시나리오 2: 불필요한 서비스를 disable했는데 노드가 NotReady가 된다
  원인: kubelet.service 또는 containerd.service를 잘못 중지한 것이다
  디버깅:
    systemctl status kubelet containerd
  해결: 필수 서비스(kubelet, containerd)는 절대 중지하지 않는다

시나리오 3: sysctl 변경 후 Pod 네트워크가 안 된다
  원인: net.ipv4.ip_forward=0으로 설정하여 Pod 간 IP 포워딩이 비활성화되었다
  디버깅:
    sysctl net.ipv4.ip_forward  # 값이 0이면 문제
  해결: K8s 노드에서 net.ipv4.ip_forward는 반드시 1이어야 한다

시나리오 4: AppArmor enforce 모드에서 정상 애플리케이션이 동작하지 않는다
  원인: deny 규칙이 너무 광범위하여 애플리케이션이 필요한 파일 접근도 차단된다
  디버깅:
    # complain 모드로 전환하여 차단 로그 수집
    sudo aa-complain /etc/apparmor.d/<profile>
    dmesg | grep "apparmor.*ALLOWED"  # complain 모드에서 허용된 접근 확인
  해결: complain 모드 로그를 분석하여 필요한 경로를 허용 규칙에 추가한 뒤 enforce로 전환한다
```

---

## 9. 복습 체크리스트

- [ ] AppArmor 프로파일의 enforce/complain/unconfined 모드를 구분할 수 있는가?
- [ ] AppArmor 프로파일을 작성하고 노드에 로드할 수 있는가? (apparmor_parser -r)
- [ ] `deny /** w` 패턴의 의미를 이해하고 변형할 수 있는가?
- [ ] Pod에 AppArmor 프로파일을 securityContext 방식으로 적용할 수 있는가?
- [ ] seccomp의 RuntimeDefault, Localhost, Unconfined 타입을 구분할 수 있는가?
- [ ] 커스텀 seccomp 프로파일 JSON을 작성할 수 있는가?
- [ ] `/var/lib/kubelet/seccomp/` 경로의 의미와 상대 경로 규칙을 알고 있는가?
- [ ] SCMP_ACT_ALLOW, SCMP_ACT_ERRNO, SCMP_ACT_LOG, SCMP_ACT_KILL의 차이를 아는가?
- [ ] 불필요한 서비스를 systemctl로 식별하고 비활성화할 수 있는가?
- [ ] `ss -tlnp`로 열린 포트를 확인할 수 있는가?
- [ ] 위험한 시스템콜(ptrace, mount, unshare)을 나열할 수 있는가?
- [ ] capabilities drop ALL + add 패턴을 적용할 수 있는가?

---

> **내일 예고:** Day 7에서는 Minimize Microservice Vulnerabilities 도메인(20%)의 Pod Security Standards, SecurityContext, OPA Gatekeeper, Secret Encryption, RuntimeClass, mTLS를 학습한다.

---

## tart-infra 실습

### 실습 환경 설정

```bash
# dev 클러스터에 접속
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/dev.yaml
kubectl get nodes
```

### 실습 1: SecurityContext 기반 강화 확인

```bash
# demo 네임스페이스 Pod의 SecurityContext 확인
kubectl get pods -n demo -o custom-columns=\
NAME:.metadata.name,\
RUN_AS_USER:.spec.securityContext.runAsUser,\
RUN_AS_NON_ROOT:.spec.securityContext.runAsNonRoot,\
READ_ONLY_FS:.spec.containers[0].securityContext.readOnlyRootFilesystem
```

**동작 원리:** SecurityContext 보안 강화 항목:
1. `runAsNonRoot: true` — 컨테이너가 root(UID 0)로 실행되면 kubelet이 시작을 거부한다
2. `readOnlyRootFilesystem: true` — 파일시스템을 읽기 전용으로 설정 (쓰기 필요 시 emptyDir 사용)
3. `allowPrivilegeEscalation: false` — setuid 등으로 권한 상승을 방지한다
4. `capabilities.drop: ["ALL"]` — 모든 Linux capability를 제거하고 필요한 것만 add한다

### 실습 2: Capabilities 확인

```bash
# Pod에서 현재 capabilities 확인
kubectl exec -n demo deploy/nginx-web -- cat /proc/1/status | grep -i cap 2>/dev/null || echo "capabilities 확인 (노드 SSH 접속 필요할 수 있음)"
```

**동작 원리:** Linux Capabilities:
1. 전통적 root 권한을 세분화한 것이다 (예: NET_BIND_SERVICE, SYS_PTRACE)
2. `capabilities.drop: ["ALL"]` + `capabilities.add: ["NET_BIND_SERVICE"]` 패턴이 권장된다
3. drop ALL 없이 특정 capability만 add하면 기본 capability가 유지된다
4. 위험한 capability: SYS_ADMIN, SYS_PTRACE, NET_ADMIN → 반드시 제거해야 한다

### 실습 3: seccomp 프로파일 확인

```bash
# Pod의 seccomp 설정 확인
kubectl get pod -n demo -l app=nginx-web -o jsonpath='{.items[0].spec.securityContext.seccompProfile}' && echo ""
```

**동작 원리:** seccomp 프로파일 타입:
1. **RuntimeDefault**: 컨테이너 런타임(containerd)의 기본 프로파일 사용 — 대부분의 위험한 syscall 차단
2. **Localhost**: 커스텀 프로파일 사용 — `/var/lib/kubelet/seccomp/` 디렉터리에 JSON 파일 배치
3. **Unconfined**: seccomp 미적용 — 모든 syscall 허용 (보안 취약)
4. CKS 시험에서는 Localhost 타입의 커스텀 프로파일을 작성하고 Pod에 적용하는 문제가 출제된다

### 실습 4: 노드 보안 상태 확인

```bash
# 노드의 열린 포트 확인 (SSH 접속 후)
# tart ssh dev-master
# ss -tlnp | grep -E "(6443|2379|2380|10250|10257|10259)"
```

**예상 출력:**
```
LISTEN  0  4096  *:6443   *:*  users:(("kube-apiserver",pid=xxx,fd=7))
LISTEN  0  4096  *:2379   *:*  users:(("etcd",pid=xxx,fd=7))
LISTEN  0  4096  *:2380   *:*  users:(("etcd",pid=xxx,fd=8))
LISTEN  0  4096  *:10250  *:*  users:(("kubelet",pid=xxx,fd=20))
LISTEN  0  4096  *:10257  *:*  users:(("kube-controller",pid=xxx,fd=7))
LISTEN  0  4096  *:10259  *:*  users:(("kube-scheduler",pid=xxx,fd=7))
```

**동작 원리:** K8s 컴포넌트 포트:
1. 6443: API Server (HTTPS) — 유일하게 외부 노출이 필요한 포트
2. 2379/2380: etcd 클라이언트/피어 — Control Plane 내부에서만 접근
3. 10250: kubelet (HTTPS) — API Server가 Pod exec/logs에 사용
4. 10255: kubelet (HTTP, 읽기전용) — 비활성화 권장 (`--read-only-port=0`)
5. 10257/10259: controller-manager/scheduler — localhost에서만 접근 가능해야 안전
