# Day 4: 디버깅 가이드, 예제, 자가 점검, 참고문헌

> containerd 로그 분석, 자주 발생하는 문제(SystemdCgroup 불일치, 이미지 Pull 실패, 컨테이너 시작 실패, 소켓 통신 문제, 디스크 공간 부족) 해결, config.toml 설정 예제, RuntimeClass 리소스 정의, Registry Mirror/Private Registry 인증, systemd Unit File, 명령어 비교, 자가 점검, 참고문헌을 다룬다.

## 디버깅 가이드

### containerd 로그 분석
```bash
# containerd 서비스 로그 확인
sudo journalctl -u containerd --no-pager -n 100

# 실시간 로그 추적
sudo journalctl -u containerd -f

# 에러 로그만 필터링
sudo journalctl -u containerd --no-pager | grep -i "error\|fail\|panic"

# 특정 시간 이후의 로그
sudo journalctl -u containerd --since "2024-01-01 00:00:00"

# kubelet 로그에서 CRI 관련 메시지 확인
sudo journalctl -u kubelet --no-pager | grep -i "containerd\|cri\|runtime"
```

### 자주 발생하는 문제와 해결

#### 1. SystemdCgroup 불일치
```
# 증상: Pod가 CrashLoopBackOff 또는 시작 실패
# 원인: kubelet의 cgroupDriver와 containerd의 SystemdCgroup 설정이 불일치

# 확인 방법
sudo cat /etc/containerd/config.toml | grep SystemdCgroup
sudo cat /var/lib/kubelet/config.yaml | grep cgroupDriver

# 해결: 둘 다 systemd로 통일해야 한다
# containerd: SystemdCgroup = true
# kubelet: cgroupDriver: systemd
```

#### 2. 이미지 Pull 실패
```bash
# 증상: ImagePullBackOff

# 네트워크 확인
sudo ctr images pull docker.io/library/nginx:alpine 2>&1

# DNS 확인
nslookup registry.k8s.io

# containerd의 레지스트리 mirror 설정 확인
sudo cat /etc/containerd/config.toml | grep -A 10 "registry"

# Content Store 상태 확인
sudo ctr content list | head -10
```

#### 3. 컨테이너 시작 실패
```bash
# shim 로그 확인
sudo journalctl -u containerd | grep "shim"

# runc 직접 실행하여 디버깅
sudo runc list

# OCI runtime spec 확인
sudo cat /run/containerd/io.containerd.runtime.v2.task/k8s.io/<container-id>/config.json | python3 -m json.tool

# Snapshotter 상태 확인
sudo ctr -n k8s.io snapshots list | head -20
```

#### 4. containerd 소켓 통신 문제
```bash
# 소켓 파일 존재 확인
ls -la /run/containerd/containerd.sock

# 소켓으로 직접 health check
sudo ctr version

# crictl 설정이 올바른 소켓을 가리키는지 확인
sudo cat /etc/crictl.yaml
# runtime-endpoint: unix:///run/containerd/containerd.sock
```

#### 5. 디스크 공간 부족
```bash
# containerd 데이터 디렉토리 사용량 확인
sudo du -sh /var/lib/containerd/

# 사용하지 않는 이미지 정리
sudo crictl rmi --prune

# Content Store 정리 (GC)
sudo ctr content prune references

# Snapshot 정리
sudo ctr snapshots list | wc -l
```

---

## 예제

### 예제 1: containerd 설정 파일 (config.toml) - 기본 설정
```toml
# /etc/containerd/config.toml
version = 2

# root 디렉토리: 이미지, 스냅샷 등 영속 데이터 저장
root = "/var/lib/containerd"
# state 디렉토리: 런타임 상태(소켓, PID 등) 저장
state = "/run/containerd"

# gRPC 소켓 설정
[grpc]
  address = "/run/containerd/containerd.sock"

[plugins."io.containerd.grpc.v1.cri"]
  # Pod sandbox용 pause 이미지
  sandbox_image = "registry.k8s.io/pause:3.9"

  [plugins."io.containerd.grpc.v1.cri".containerd]
    # 기본 snapshotter
    snapshotter = "overlayfs"

    [plugins."io.containerd.grpc.v1.cri".containerd.runtimes]
      [plugins."io.containerd.grpc.v1.cri".containerd.runtimes.runc]
        runtime_type = "io.containerd.runc.v2"
        [plugins."io.containerd.grpc.v1.cri".containerd.runtimes.runc.options]
          # kubelet의 cgroupDriver: systemd 와 반드시 일치해야 한다
          SystemdCgroup = true
```

### 예제 2: containerd config.toml - 다중 Runtime Class 설정 (runc + kata + gVisor)
```toml
# /etc/containerd/config.toml
version = 2

root = "/var/lib/containerd"
state = "/run/containerd"

[grpc]
  address = "/run/containerd/containerd.sock"

# Prometheus metrics 활성화
[metrics]
  address = "127.0.0.1:1338"

[plugins."io.containerd.grpc.v1.cri"]
  sandbox_image = "registry.k8s.io/pause:3.9"

  [plugins."io.containerd.grpc.v1.cri".containerd]
    snapshotter = "overlayfs"
    # 기본 런타임 지정
    default_runtime_name = "runc"

    [plugins."io.containerd.grpc.v1.cri".containerd.runtimes]

      # ── runc (기본 OCI 런타임) ──
      [plugins."io.containerd.grpc.v1.cri".containerd.runtimes.runc]
        runtime_type = "io.containerd.runc.v2"
        [plugins."io.containerd.grpc.v1.cri".containerd.runtimes.runc.options]
          SystemdCgroup = true
          # runc 바이너리 경로 (기본: $PATH에서 검색)
          # BinaryName = "/usr/local/sbin/runc"

      # ── kata-containers (경량 VM 격리) ──
      [plugins."io.containerd.grpc.v1.cri".containerd.runtimes.kata]
        runtime_type = "io.containerd.kata.v2"
        # kata-containers는 Pod당 별도 VM을 실행한다
        # QEMU 또는 Cloud Hypervisor를 하이퍼바이저로 사용한다
        [plugins."io.containerd.grpc.v1.cri".containerd.runtimes.kata.options]
          ConfigPath = "/opt/kata/share/defaults/kata-containers/configuration.toml"

      # ── gVisor/runsc (사용자 공간 커널) ──
      [plugins."io.containerd.grpc.v1.cri".containerd.runtimes.gvisor]
        runtime_type = "io.containerd.runsc.v1"
        [plugins."io.containerd.grpc.v1.cri".containerd.runtimes.gvisor.options]
          TypeUrl = "io.containerd.runsc.v1.options"
          # runsc가 syscall을 사용자 공간에서 처리한다
          # 호스트 커널에 대한 공격 표면을 줄인다

      # ── youki (Rust OCI 런타임) ──
      [plugins."io.containerd.grpc.v1.cri".containerd.runtimes.youki]
        runtime_type = "io.containerd.runc.v2"
        [plugins."io.containerd.grpc.v1.cri".containerd.runtimes.youki.options]
          SystemdCgroup = true
          BinaryName = "/usr/local/bin/youki"

      # ── crun (경량 C 런타임) ──
      [plugins."io.containerd.grpc.v1.cri".containerd.runtimes.crun]
        runtime_type = "io.containerd.runc.v2"
        [plugins."io.containerd.grpc.v1.cri".containerd.runtimes.crun.options]
          SystemdCgroup = true
          BinaryName = "/usr/local/bin/crun"
```

### 예제 3: RuntimeClass Kubernetes 리소스 정의
```yaml
# ── runc RuntimeClass (기본, 보통은 생략 가능) ──
apiVersion: node.k8s.io/v1
kind: RuntimeClass
metadata:
  name: runc
handler: runc  # containerd config.toml의 runtime 이름과 일치해야 한다
---
# ── kata-containers RuntimeClass ──
apiVersion: node.k8s.io/v1
kind: RuntimeClass
metadata:
  name: kata
handler: kata  # containerd config.toml의 [runtimes.kata]와 일치해야 한다
scheduling:
  nodeSelector:
    # kata가 설치된 노드에만 스케줄링
    katacontainers.io/kata-runtime: "true"
overhead:
  # VM 오버헤드를 Kubernetes 스케줄러에 알린다
  podFixed:
    memory: "160Mi"
    cpu: "250m"
---
# ── gVisor RuntimeClass ──
apiVersion: node.k8s.io/v1
kind: RuntimeClass
metadata:
  name: gvisor
handler: gvisor  # containerd config.toml의 [runtimes.gvisor]와 일치해야 한다
scheduling:
  nodeSelector:
    gvisor.dev/runtime: "true"
---
# ── Pod에서 RuntimeClass 사용 ──
apiVersion: v1
kind: Pod
metadata:
  name: secure-workload
spec:
  runtimeClassName: kata  # 이 Pod는 kata-containers VM에서 실행된다
  containers:
  - name: app
    image: nginx:alpine
---
apiVersion: v1
kind: Pod
metadata:
  name: untrusted-workload
spec:
  runtimeClassName: gvisor  # 이 Pod는 gVisor sandbox에서 실행된다
  containers:
  - name: app
    image: nginx:alpine
```

### 예제 4: Registry Mirror 설정
```toml
# /etc/containerd/config.toml (containerd 1.x 방식)
[plugins."io.containerd.grpc.v1.cri".registry]
  [plugins."io.containerd.grpc.v1.cri".registry.mirrors]
    # Docker Hub 미러
    [plugins."io.containerd.grpc.v1.cri".registry.mirrors."docker.io"]
      endpoint = ["https://mirror.gcr.io", "https://registry-1.docker.io"]

    # 내부 레지스트리 미러
    [plugins."io.containerd.grpc.v1.cri".registry.mirrors."registry.example.com"]
      endpoint = ["https://registry-mirror.internal.example.com"]

    # 와일드카드 미러 (모든 레지스트리에 대해 내부 미러 우선 사용)
    [plugins."io.containerd.grpc.v1.cri".registry.mirrors."*"]
      endpoint = ["https://mirror.internal.example.com"]
```

```
# containerd 2.0+ 방식: /etc/containerd/certs.d/ 디렉토리 기반 (권장)

# /etc/containerd/certs.d/docker.io/hosts.toml
server = "https://registry-1.docker.io"

[host."https://mirror.gcr.io"]
  capabilities = ["pull", "resolve"]
  # 미러에서 먼저 시도, 실패 시 원본 레지스트리로 fallback

[host."https://mirror.internal.example.com"]
  capabilities = ["pull", "resolve"]
  skip_verify = false
  ca = "/etc/containerd/certs.d/docker.io/ca.crt"
```

### 예제 5: Private Registry 인증 설정
```toml
# /etc/containerd/config.toml (containerd 1.x 방식)
[plugins."io.containerd.grpc.v1.cri".registry]
  [plugins."io.containerd.grpc.v1.cri".registry.configs]
    # 프라이빗 레지스트리 인증 정보
    [plugins."io.containerd.grpc.v1.cri".registry.configs."registry.example.com".auth]
      username = "admin"
      password = "secretpassword"
      # 또는 auth 토큰 사용
      # auth = "base64(username:password)"

    # TLS 설정
    [plugins."io.containerd.grpc.v1.cri".registry.configs."registry.example.com".tls]
      ca_file = "/etc/containerd/certs.d/registry.example.com/ca.crt"
      cert_file = "/etc/containerd/certs.d/registry.example.com/client.crt"
      key_file = "/etc/containerd/certs.d/registry.example.com/client.key"
      # 자체 서명 인증서 허용 (프로덕션에서는 비권장)
      # insecure_skip_verify = true

    # GitHub Container Registry (ghcr.io) 인증
    [plugins."io.containerd.grpc.v1.cri".registry.configs."ghcr.io".auth]
      username = "github-username"
      password = "ghp_xxxxxxxxxxxx"  # Personal Access Token

    # AWS ECR (레지스트리 URL이 동적이므로 credential helper 사용 권장)
    [plugins."io.containerd.grpc.v1.cri".registry.configs."123456789012.dkr.ecr.ap-northeast-2.amazonaws.com".auth]
      username = "AWS"
      password = ""  # ecr-credential-helper를 사용하여 자동 갱신
```

```
# containerd 2.0+ 방식: /etc/containerd/certs.d/ 디렉토리 기반

# /etc/containerd/certs.d/registry.example.com/hosts.toml
server = "https://registry.example.com"

[host."https://registry.example.com"]
  capabilities = ["pull", "push", "resolve"]
  ca = "/etc/containerd/certs.d/registry.example.com/ca.crt"

  [host."https://registry.example.com".header]
    Authorization = ["Basic dXNlcm5hbWU6cGFzc3dvcmQ="]
```

Kubernetes 환경에서는 `imagePullSecrets`를 사용하여 Pod 수준에서 인증 정보를 제공하는 것이 권장된다:
```yaml
apiVersion: v1
kind: Secret
metadata:
  name: registry-credentials
type: kubernetes.io/dockerconfigjson
data:
  .dockerconfigjson: <base64-encoded-docker-config>
---
apiVersion: v1
kind: Pod
metadata:
  name: app
spec:
  imagePullSecrets:
  - name: registry-credentials
  containers:
  - name: app
    image: registry.example.com/myapp:latest
```

### 예제 6: containerd systemd Unit File
```ini
# /etc/systemd/system/containerd.service
# (containerd 패키지 설치 시 자동 생성되는 파일)

[Unit]
Description=containerd container runtime
Documentation=https://containerd.io
After=network.target local-fs.target dbus.service

[Service]
ExecStartPre=-/sbin/modprobe overlay
ExecStart=/usr/local/bin/containerd

# 프로세스 타입: notify (containerd가 systemd에 준비 완료 시그널을 보낸다)
Type=notify

# containerd 재시작 시 컨테이너에 영향을 주지 않기 위한 설정
# KillMode=process: containerd 프로세스만 종료, 자식(shim)은 유지
KillMode=process
Delegate=yes

# cgroup 관리를 containerd에 위임한다
# systemd가 containerd의 cgroup을 정리하지 않도록 한다
# Delegate=yes가 있어야 containerd가 자식 cgroup을 자유롭게 생성할 수 있다

# 재시작 정책
Restart=always
RestartSec=5

# 자원 제한
LimitNOFILE=1048576    # 파일 디스크립터 수 제한
LimitNPROC=infinity    # 프로세스 수 제한 없음
LimitCORE=infinity     # 코어 덤프 크기 제한 없음
TasksMax=infinity      # systemd 태스크 수 제한 없음

# OOM 조정 (containerd가 OOM killer에 의해 종료되지 않도록)
OOMScoreAdjust=-999

[Install]
WantedBy=multi-user.target
```

핵심 설정 설명:
- **`KillMode=process`**: systemd가 containerd를 중지할 때 containerd 프로세스만 종료하고, 자식 프로세스(shim)는 그대로 유지한다. 이것이 containerd 업그레이드 시 컨테이너가 중단되지 않는 핵심 메커니즘이다.
- **`Delegate=yes`**: systemd가 containerd의 cgroup 하위 트리를 containerd에 위임한다. containerd가 컨테이너별 cgroup을 자유롭게 생성/관리할 수 있게 한다.
- **`OOMScoreAdjust=-999`**: containerd 프로세스가 메모리 부족 시 OOM killer에 의해 종료되지 않도록 우선순위를 높인다.

### 예제 7: crictl.yaml 설정
```yaml
# /etc/crictl.yaml
runtime-endpoint: unix:///run/containerd/containerd.sock
image-endpoint: unix:///run/containerd/containerd.sock
timeout: 10
debug: false
```

### 예제 8: containerd vs Docker vs CRI 명령어 비교
```bash
# ─── 이미지 Pull ───
# Docker
docker pull nginx:alpine
# containerd (ctr)
sudo ctr images pull docker.io/library/nginx:alpine
# CRI (crictl)
sudo crictl pull nginx:alpine
# nerdctl (Docker 호환)
sudo nerdctl pull nginx:alpine

# ─── 컨테이너 실행 ───
# Docker (pull + create + start 한 번에)
docker run -d --name web nginx:alpine
# containerd (create + task start 분리)
sudo ctr containers create docker.io/library/nginx:alpine web
sudo ctr task start -d web
# containerd (run = create + start 한 번에)
sudo ctr run -d docker.io/library/nginx:alpine web
# nerdctl (Docker 호환)
sudo nerdctl run -d --name web nginx:alpine
# CRI: crictl은 Pod 기반이므로 직접 run 불가, Pod sandbox를 먼저 만들어야 한다

# ─── 컨테이너 목록 ───
# Docker
docker ps
# containerd
sudo ctr containers list    # 메타데이터 기준
sudo ctr task list           # 실행 중인 프로세스 기준
# nerdctl
sudo nerdctl ps
# CRI
sudo crictl ps               # 실행 중
sudo crictl ps -a            # 전체

# ─── 로그 확인 ───
# Docker
docker logs <container>
# containerd: ctr은 로그 명령이 없다 (stdout을 직접 관리하지 않음)
# nerdctl
sudo nerdctl logs <container>
# CRI
sudo crictl logs <container-id>
```

---

## 자가 점검

### 기본 개념
- [ ] CRI(Container Runtime Interface)의 역할과 두 가지 서비스(RuntimeService, ImageService)를 설명할 수 있는가?
- [ ] containerd의 Content Store가 content-addressable 방식으로 이미지를 저장하는 원리를 설명할 수 있는가?
- [ ] overlayfs Snapshotter가 이미지 레이어를 어떻게 합쳐서 rootfs를 구성하는지 설명할 수 있는가?
- [ ] containerd와 Docker의 관계, Kubernetes 1.24에서 dockershim 제거의 배경을 설명할 수 있는가?
- [ ] Pod Sandbox에서 pause 컨테이너의 역할을 설명할 수 있는가?
- [ ] SystemdCgroup 설정이 왜 kubelet과 일치해야 하는지 설명할 수 있는가?
- [ ] containerd의 Namespace가 Linux kernel namespace와 어떻게 다른지 설명할 수 있는가?
- [ ] containerd vs CRI-O의 설계 철학 차이를 설명할 수 있는가?

### Shim 및 런타임
- [ ] Shim 프로세스의 역할은 무엇이며, 왜 존재하는가? containerd와 runc 사이에 shim이 없다면 어떤 문제가 발생하는가?
- [ ] containerd가 재시작(업그레이드 등)되었을 때, 실행 중인 컨테이너에는 어떤 일이 일어나는가? shim이 이 과정에서 어떤 역할을 하는가?
- [ ] ttrpc(Tiny Transport RPC)는 무엇이며, 왜 일반 gRPC 대신 사용하는가?
- [ ] Shim v1과 Shim v2의 차이점은 무엇인가? (컨테이너당 vs Pod당)
- [ ] containerd가 여러 OCI 런타임(runc, kata, gVisor)을 동시에 지원하는 방법을 설명할 수 있는가? config.toml과 Kubernetes RuntimeClass의 관계는?

### Snapshotter
- [ ] Snapshotter의 역할은 무엇이며, 어떤 종류가 있는가? overlayfs, devmapper, stargz의 차이점은?
- [ ] overlayfs에서 Copy-on-Write(CoW)가 어떻게 동작하는가? upperdir, lowerdir, workdir, merged의 역할은?
- [ ] stargz snapshotter가 lazy pulling을 구현하는 원리를 설명할 수 있는가?

### Container Creation Flow
- [ ] 이미지 Pull부터 프로세스 실행까지의 전체 흐름(Image Pull → Unpack → Container Create → Task Create → Task Start)을 순서대로 설명할 수 있는가?
- [ ] Container 객체와 Task 객체의 차이점은 무엇인가? 왜 분리되어 있는가?
- [ ] runc create와 runc start가 분리되어 있는 이유는 무엇인가?

### CLI 도구
- [ ] ctr, crictl, nerdctl의 차이와 각각의 사용 목적을 설명할 수 있는가?
- [ ] crictl은 어떤 인터페이스(CRI)를 통해 containerd와 통신하는가? ctr은?
- [ ] nerdctl이 Docker CLI와 호환되는 이유와 내부 동작 방식을 설명할 수 있는가?

### 심화
- [ ] containerd의 GC(Garbage Collection) 메커니즘은 어떻게 동작하는가? lease의 역할은?
- [ ] NRI(Node Resource Interface)의 용도와 사용 사례를 설명할 수 있는가?
- [ ] Transfer Service(containerd 2.0)가 기존 이미지 pull 방식과 어떻게 다른가?
- [ ] containerd의 Event Service를 통해 어떤 이벤트를 모니터링할 수 있는가?
- [ ] systemd unit file에서 `KillMode=process`와 `Delegate=yes`가 containerd에 왜 중요한가?

---

## 참고문헌

### 공식 문서
- [containerd 공식 사이트](https://containerd.io/)
- [containerd 공식 문서](https://containerd.io/docs/)
- [containerd GitHub 저장소](https://github.com/containerd/containerd)
- [containerd Getting Started Guide](https://github.com/containerd/containerd/blob/main/docs/getting-started.md)
- [containerd 설정 (config.toml) 레퍼런스](https://github.com/containerd/containerd/blob/main/docs/man/containerd-config.toml.5.md)
- [containerd Plugin 아키텍처](https://github.com/containerd/containerd/blob/main/docs/PLUGINS.md)

### Kubernetes CRI 관련
- [Kubernetes CRI (Container Runtime Interface) 문서](https://kubernetes.io/docs/concepts/architecture/cri/)
- [Kubernetes Container Runtimes 설정 가이드](https://kubernetes.io/docs/setup/production-environment/container-runtimes/#containerd)
- [CRI Plugin Documentation](https://github.com/containerd/containerd/blob/main/docs/cri/config.md)
- [dockershim 제거 FAQ](https://kubernetes.io/blog/2022/02/17/dockershim-faq/)
- [CRI API 정의 (protobuf)](https://github.com/kubernetes/cri-api)

### OCI 표준
- [OCI Runtime Specification](https://github.com/opencontainers/runtime-spec)
- [OCI Image Specification](https://github.com/opencontainers/image-spec)
- [runc GitHub 저장소](https://github.com/opencontainers/runc)

### Snapshotter 관련
- [containerd Snapshotters](https://github.com/containerd/containerd/tree/main/docs/snapshotters)
- [Stargz Snapshotter (Lazy Pulling)](https://github.com/containerd/stargz-snapshotter)

### 비교 및 심화
- [CRI-O 공식 사이트](https://cri-o.io/)
- [containerd vs CRI-O - Kubernetes Runtime 비교](https://kubernetes.io/docs/setup/production-environment/container-runtimes/)
- [Shim v2 아키텍처 설계 문서](https://github.com/containerd/containerd/blob/main/runtime/v2/README.md)
- [NRI (Node Resource Interface)](https://github.com/containerd/nri)

### CLI 도구
- [ctr 사용법](https://github.com/containerd/containerd/blob/main/docs/man/ctr.1.md)
- [crictl 사용법 (Kubernetes 공식)](https://kubernetes.io/docs/tasks/debug/debug-cluster/crictl/)
- [nerdctl - Docker 호환 containerd CLI](https://github.com/containerd/nerdctl)
