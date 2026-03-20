# Day 3: 아키텍처 종합, 동작 메커니즘, 런타임 비교, 실습

> containerd 전체 아키텍처 다이어그램, 핵심 컴포넌트 상세, 이미지 Pull/컨테이너 생성 과정, CRI Plugin과 kubelet 통신 흐름, containerd vs CRI-O vs Docker 비교, 그리고 containerd 상태 확인부터 ctr/nerdctl/crictl 사용까지의 실습을 다룬다.

## 아키텍처

### 전체 아키텍처
containerd는 플러그인 기반 아키텍처로 설계되어 있다. 모든 주요 기능이 플러그인으로 구현되어 있어 확장성이 뛰어나다.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                            Clients                                      │
│   kubelet (CRI)          ctr           nerdctl          BuildKit        │
└──────────┬──────────────┬──────────────┬─────────────────┬──────────────┘
           │              │              │                 │
           ▼              ▼              ▼                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        containerd (gRPC API)                            │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                        CRI Plugin                                │   │
│  │  (io.containerd.grpc.v1.cri)                                     │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌───────────────────┐      │   │
│  │  │ Pod Sandbox   │  │ Container    │  │ Image             │      │   │
│  │  │ Management    │  │ Management   │  │ Management        │      │   │
│  │  └──────────────┘  └──────────────┘  └───────────────────┘      │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌──────────┐ ┌───────────┐ ┌────────────┐ ┌──────────┐ ┌──────────┐  │
│  │ Content  │ │ Metadata  │ │ Snapshotter│ │  Task    │ │ Transfer │  │
│  │ Store    │ │ Store     │ │ (overlayfs)│ │ Service  │ │ Service  │  │
│  │ (CAS)    │ │ (bbolt)   │ │            │ │          │ │ (2.0)    │  │
│  └──────────┘ └───────────┘ └────────────┘ └────┬─────┘ └──────────┘  │
│                                                  │                     │
│  ┌──────────┐ ┌───────────┐ ┌────────────┐ ┌────┴─────┐              │
│  │ Diff     │ │ Event     │ │ Lease      │ │   NRI    │              │
│  │ Service  │ │ Service   │ │ Service    │ │ Plugin   │              │
│  └──────────┘ └───────────┘ └────────────┘ └──────────┘              │
└──────────────────────────────────────────────────────────┬─────────────┘
                                                           │
                                                           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        containerd-shim-runc-v2                          │
│                        (Pod당 하나의 shim 프로세스)                       │
│                     ttrpc (경량 gRPC for local communication)            │
└──────────────────────────────────┬──────────────────────────────────────┘
                                   │ exec
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                              runc / kata / gVisor                       │
│                  (OCI Runtime - 컨테이너 프로세스 생성)                    │
│              namespace, cgroup, seccomp, rootfs 설정                     │
└─────────────────────────────────────────────────────────────────────────┘
```

### 핵심 컴포넌트 상세

#### Content Store (Content-Addressable Storage)
- 모든 이미지 데이터를 SHA-256 digest를 키로 하여 불변(immutable)하게 저장한다
- 동일한 레이어를 여러 이미지가 공유할 수 있어 디스크 효율이 높다
- 기본 저장 경로는 `/var/lib/containerd/io.containerd.content.v1.content/` 이다
- blob 데이터는 `ingest/` 디렉토리에서 임시 저장 후, 검증이 완료되면 `blobs/sha256/` 으로 이동한다

#### Task Service
- Task는 컨테이너 안에서 실행되는 프로세스의 런타임 상태를 관리하는 객체이다
- 컨테이너(메타데이터) 자체와 Task(런타임 인스턴스)는 분리되어 있다
- 하나의 컨테이너 정의로 여러 Task를 생성하거나, Task를 종료 후 재생성할 수 있다
- Task 상태: Created → Running → Stopped (Paused 가능)
- `task.Exec()`을 통해 실행 중인 컨테이너에 추가 프로세스(exec)를 생성할 수 있다

#### Event Service
- containerd 내부에서 발생하는 모든 이벤트를 발행/구독(pub/sub) 방식으로 전달한다
- 이벤트 종류: 컨테이너 생성/삭제, Task 시작/종료/OOM, 이미지 Pull/삭제, 스냅샷 생성/삭제 등
- 클라이언트는 이벤트를 구독하여 실시간으로 상태 변화를 추적할 수 있다
- `ctr events` 명령으로 실시간 이벤트 스트림을 확인할 수 있다

---

## 동작 메커니즘 상세

### 이미지 Pull 과정
containerd가 이미지를 Pull하는 과정은 Content-Addressable Storage를 핵심으로 한다.

```
1. Resolve    : 이미지 태그(nginx:alpine)를 레지스트리에서 manifest digest로 변환한다
                ↓
2. Fetch      : manifest(JSON)를 다운로드하여 Content Store에 저장한다
   Manifest   : manifest에는 config digest와 layer digest 목록이 포함되어 있다
                ↓
3. Fetch      : image config(JSON)를 다운로드한다 (환경변수, 엔트리포인트 등)
   Config     : Content Store에 sha256 digest를 키로 저장한다
                ↓
4. Fetch      : 각 layer(tar.gz)를 병렬로 다운로드한다
   Layers     : 이미 Content Store에 동일 digest가 있으면 스킵한다 (중복 제거)
                : ingest/ 에 임시 저장 → 검증 후 blobs/sha256/ 로 이동한다
                ↓
5. Unpack     : 각 layer를 Snapshotter를 통해 파일시스템으로 언팩한다
                : overlayfs의 경우 각 레이어가 별도 디렉토리로 관리된다
                ↓
6. Register   : Metadata Store에 이미지 정보(이름, 태그, digest)를 등록한다
```

### 컨테이너 생성 과정
containerd에서 컨테이너가 실행되기까지의 단계이다.

```
1. Snapshot 생성
   : 이미지 레이어(read-only) 위에 writable 레이어(active snapshot)를 생성한다
   : overlayfs mount: lowerdir=image_layers, upperdir=container_layer
                ↓
2. Container 객체 생성
   : Metadata Store에 컨테이너 메타데이터(ID, 이미지 참조, 스냅샷 키, spec 등)를 저장한다
   : OCI Runtime Spec(config.json)을 생성한다 (namespace, cgroup, mount, seccomp 등)
                ↓
3. Task 생성
   : containerd-shim-runc-v2 프로세스를 시작한다
   : shim이 runc create를 호출하여 컨테이너 프로세스를 생성한다 (아직 실행은 안 됨)
   : rootfs 마운트, namespace 설정, cgroup 할당이 이루어진다
                ↓
4. Task 시작
   : runc start를 호출하여 컨테이너 초기 프로세스(PID 1)를 실행한다
   : Event Service에 TaskStart 이벤트가 발행된다
                ↓
5. 실행 중
   : shim이 컨테이너 프로세스의 stdin/stdout/stderr을 관리한다
   : containerd가 재시작되어도 shim이 독립적으로 컨테이너를 유지한다
```

### CRI Plugin과 kubelet 통신 흐름
Kubernetes에서 Pod를 생성할 때 kubelet과 containerd CRI 플러그인 간의 통신 흐름이다.

```
kubelet                    containerd (CRI Plugin)              shim + runc
  │                              │                                  │
  │  RunPodSandbox()             │                                  │
  ├─────────────────────────────►│                                  │
  │                              │  1. pause 이미지 확인/Pull        │
  │                              │  2. sandbox 네트워크 namespace    │
  │                              │     생성 (CNI 호출)              │
  │                              │  3. pause 컨테이너 생성/실행      │
  │                              ├─────────────────────────────────►│
  │         sandbox_id           │                                  │
  │◄─────────────────────────────┤                                  │
  │                              │                                  │
  │  PullImage()                 │                                  │
  ├─────────────────────────────►│                                  │
  │                              │  Content Store에 이미지 저장      │
  │         image_ref            │                                  │
  │◄─────────────────────────────┤                                  │
  │                              │                                  │
  │  CreateContainer()           │                                  │
  ├─────────────────────────────►│                                  │
  │                              │  1. snapshot 생성 (rootfs)        │
  │                              │  2. OCI spec 생성                │
  │                              │  3. 컨테이너 메타데이터 저장       │
  │       container_id           │                                  │
  │◄─────────────────────────────┤                                  │
  │                              │                                  │
  │  StartContainer()            │                                  │
  ├─────────────────────────────►│                                  │
  │                              │  Task 생성 및 시작               │
  │                              ├─────────────────────────────────►│
  │                              │  shim → runc create → runc start │
  │         success              │                                  │
  │◄─────────────────────────────┤                                  │
```

---

## 런타임 비교: containerd vs CRI-O vs Docker

| 항목 | containerd | CRI-O | Docker (dockerd + containerd) |
|------|-----------|-------|-------------------------------|
| CNCF 상태 | Graduated | Incubating (2019~) | 해당 없음 |
| 주 용도 | 범용 컨테이너 런타임 | Kubernetes 전용 CRI 런타임 | 개발/빌드/범용 |
| CRI 지원 | 내장 플러그인 | 네이티브 (CRI가 핵심 설계) | dockershim 필요 (K8s 1.24에서 제거) |
| OCI Runtime | runc (기본), kata 등 | runc (기본), kata, crun 등 | runc (containerd를 통해) |
| 이미지 빌드 | 자체 미지원 (BuildKit 연동) | 자체 미지원 (Buildah 연동) | docker build 기본 지원 |
| CLI 도구 | ctr, nerdctl, crictl | crictl | docker CLI |
| 컨테이너 구조 | dockerd 없이 직접 동작 | dockerd 없이 직접 동작 | dockerd → containerd → runc |
| 기능 범위 | 이미지/컨테이너/스냅샷/네임스페이스 | CRI에 필요한 최소 기능 | 네트워킹, 볼륨, 빌드 등 풀스택 |
| 메모리 사용량 | 중간 | 낮음 (경량) | 높음 (dockerd + containerd) |
| 채택 현황 | EKS, AKS, GKE 기본 | OpenShift(Red Hat) 기본 | 개발 환경, CI/CD |

### Docker와의 관계
```
[Docker 아키텍처]
Docker CLI → dockerd (Docker daemon) → containerd → containerd-shim → runc
                                          ↑
[Kubernetes 아키텍처]                      │
kubelet ─── CRI (gRPC) ──────────────────┘  (containerd에 직접 연결)
```
- Kubernetes 1.20에서 dockershim deprecation이 발표되었고, 1.24(2022년)에서 완전히 제거되었다
- Docker로 빌드한 이미지는 OCI 표준을 따르므로 containerd에서 그대로 사용 가능하다
- 이 프로젝트에서도 containerd를 CRI로 직접 사용한다

---

### 이 프로젝트에서의 실습 환경

이 프로젝트에서 containerd는 모든 Kubernetes 노드의 컨테이너 런타임이다.

- 설치 스크립트: `scripts/install/03-install-runtime.sh`
- 설정 파일 경로 (VM 내부): `/etc/containerd/config.toml`
- SystemdCgroup: `true` (kubelet의 cgroupDriver와 일치)
- SSH 접속 후 실습: `ssh admin@$(tart ip <vm-name>)`
- Kubernetes가 사용하는 containerd 네임스페이스: `k8s.io`

```bash
# 프로젝트 VM에 접속하여 containerd 확인
ssh admin@$(tart ip dev-master)
sudo systemctl status containerd
sudo ctr -n k8s.io containers list
```

## 실습

### 실습 1: containerd 상태 및 설정 확인
```bash
# VM에 SSH 접속 후 수행

# containerd 서비스 상태 확인
sudo systemctl status containerd

# containerd 버전 확인
containerd --version

# runc 버전 확인
runc --version

# containerd 설정 파일 확인
sudo cat /etc/containerd/config.toml

# SystemdCgroup 설정 확인 (true여야 kubelet과 호환)
sudo cat /etc/containerd/config.toml | grep SystemdCgroup

# 기본 설정 생성 (참고용)
containerd config default
```

### 실습 2: 플러그인 및 내부 상태 확인
```bash
# 등록된 플러그인 목록 확인
sudo ctr plugins list

# 특정 타입 플러그인만 필터링 (예: snapshotter)
sudo ctr plugins list | grep snapshotter

# containerd 정보 요약
sudo ctr version
```

### 실습 3: Namespace 관리
```bash
# 네임스페이스 목록 확인
sudo ctr namespaces list

# 새 네임스페이스 생성
sudo ctr namespaces create test-ns

# 특정 네임스페이스에서 작업
sudo ctr -n test-ns images list

# Kubernetes 네임스페이스(k8s.io) 확인
sudo ctr -n k8s.io containers list

# 네임스페이스 삭제
sudo ctr namespaces remove test-ns
```

### 실습 4: ctr 명령어로 컨테이너 관리
```bash
# ctr은 containerd의 저수준 CLI 도구이다

# 이미지 Pull
sudo ctr images pull docker.io/library/nginx:alpine

# 이미지 목록 확인
sudo ctr images list

# 이미지 상세 정보 (manifest, config 등)
sudo ctr images check

# 컨테이너 생성 (메타데이터만, 아직 실행되지 않음)
sudo ctr containers create docker.io/library/nginx:alpine my-nginx

# 컨테이너 목록 확인
sudo ctr containers list

# 컨테이너 상세 정보
sudo ctr containers info my-nginx

# Task 시작 (실제 프로세스 실행, -d는 detach)
sudo ctr task start -d my-nginx

# Task 목록 확인 (실행 중인 프로세스)
sudo ctr task list

# Task에 exec (실행 중인 컨테이너에 명령 실행)
sudo ctr task exec --exec-id shell1 my-nginx /bin/sh

# Task에서 프로세스 목록 확인
sudo ctr task ps my-nginx

# Task 중지
sudo ctr task kill my-nginx

# Task 삭제
sudo ctr task delete my-nginx

# 컨테이너 삭제
sudo ctr containers delete my-nginx

# 이미지 삭제
sudo ctr images remove docker.io/library/nginx:alpine

# Kubernetes 네임스페이스의 이미지/컨테이너 확인
sudo ctr -n k8s.io images list
sudo ctr -n k8s.io containers list
```

### 실습 5: containerd Socket 및 API Inspection
```bash
# containerd 소켓 파일 확인
ls -la /run/containerd/containerd.sock

# 소켓 타입 확인
file /run/containerd/containerd.sock

# grpcurl을 사용하여 gRPC API 직접 호출 (grpcurl 설치 필요)
# 서비스 목록 조회
grpcurl -plaintext -unix /run/containerd/containerd.sock list

# containerd 버전 정보 조회 (gRPC)
grpcurl -plaintext -unix /run/containerd/containerd.sock \
  containerd.services.version.v1.Version/Version

# namespace 목록 조회 (gRPC)
grpcurl -plaintext -unix /run/containerd/containerd.sock \
  containerd.services.namespaces.v1.Namespaces/List

# 이미지 목록 조회 (gRPC, 특정 namespace)
grpcurl -plaintext -unix -H "containerd-namespace: k8s.io" \
  /run/containerd/containerd.sock \
  containerd.services.images.v1.Images/List

# containerd의 introspection API로 플러그인 정보 조회
grpcurl -plaintext -unix /run/containerd/containerd.sock \
  containerd.services.introspection.v1.Introspection/Plugins
```

### 실습 6: Snapshotter 비교 및 탐색
```bash
# 현재 사용 중인 snapshotter 확인
sudo cat /etc/containerd/config.toml | grep snapshotter

# 전체 snapshot 목록 확인
sudo ctr snapshots list

# 특정 namespace의 snapshot 목록
sudo ctr -n k8s.io snapshots list

# snapshot 상세 정보 (parent, kind 등)
sudo ctr snapshots info <snapshot-key>

# snapshot 디스크 사용량 확인
sudo ctr snapshots usage <snapshot-key>

# snapshot tree 구조 확인 (parent-child 관계)
sudo ctr snapshots tree

# overlayfs mount 정보 확인 (실행 중인 컨테이너)
mount | grep overlay

# snapshotter 저장 디렉토리 탐색
sudo ls -la /var/lib/containerd/io.containerd.snapshotter.v1.overlayfs/
sudo ls -la /var/lib/containerd/io.containerd.snapshotter.v1.overlayfs/snapshots/
```

### 실습 7: Task 생명주기 관리
```bash
# Task 목록 확인 (PID, STATUS 포함)
sudo ctr task list

# Kubernetes namespace의 Task 목록
sudo ctr -n k8s.io task list

# Task 상세 프로세스 목록 (PID 정보)
sudo ctr -n k8s.io task ps <container-id>

# Task에 시그널 전송
sudo ctr task kill --signal SIGTERM <container-id>

# Task 강제 종료
sudo ctr task kill --signal SIGKILL <container-id>

# Task 삭제 (종료된 task 정리)
sudo ctr task delete <container-id>

# Task의 exit status 확인
sudo ctr task list  # STATUS 컬럼에서 STOPPED(exit_code) 확인

# 실행 중인 Task에 추가 프로세스 실행 (exec)
sudo ctr task exec --exec-id debug1 <container-id> /bin/sh -c "ps aux"
sudo ctr task exec --exec-id debug2 <container-id> /bin/sh -c "cat /proc/1/status"

# Task의 cgroup 정보 확인
sudo ctr task metrics <container-id>
```

### 실습 8: Content Store 탐색
```bash
# Content Store 전체 목록 (digest, size, created)
sudo ctr content list

# Kubernetes namespace의 content
sudo ctr -n k8s.io content list

# 특정 content 내용 읽기 (manifest, config 등 JSON 데이터)
sudo ctr content get sha256:<digest> | python3 -m json.tool

# Content Store 디렉토리 구조 확인
sudo ls -la /var/lib/containerd/io.containerd.content.v1.content/blobs/sha256/ | head -20

# content의 labels 확인
sudo ctr content list --quiet | head -5

# 사용하지 않는 content 정리 (GC)
sudo ctr content prune references

# ingest 중인 (미완성) 다운로드 확인
sudo ls -la /var/lib/containerd/io.containerd.content.v1.content/ingest/ 2>/dev/null
```

### 실습 9: containerd Metrics Endpoint
```bash
# containerd는 Prometheus 호환 metrics endpoint를 제공한다
# config.toml에서 metrics address 설정 확인
sudo cat /etc/containerd/config.toml | grep -A 3 "\[metrics\]"

# metrics가 활성화된 경우 (기본: 비활성)
# config.toml에 다음을 추가:
# [metrics]
#   address = "127.0.0.1:1338"

# metrics 조회
curl -s http://127.0.0.1:1338/v1/metrics 2>/dev/null | head -50

# 주요 metrics 항목
# - containerd_container_count: 컨테이너 수
# - containerd_task_count: task 수
# - containerd_snapshot_count: snapshot 수
# - containerd_image_pull_duration_seconds: 이미지 pull 소요 시간
# - containerd_grpc_request_duration_seconds: gRPC 요청 처리 시간

# containerd 프로세스의 리소스 사용량 직접 확인
ps aux | grep containerd
sudo cat /proc/$(pgrep -x containerd)/status | grep -E "VmRSS|VmSize|Threads"
```

### 실습 10: nerdctl (Docker-Compatible CLI for containerd)
```bash
# nerdctl은 Docker CLI와 호환되는 containerd 전용 CLI이다
# Docker 사용자가 containerd로 쉽게 전환할 수 있도록 설계되었다

# nerdctl 버전 확인
nerdctl version

# 이미지 pull (Docker와 동일한 명령)
sudo nerdctl pull nginx:alpine

# 컨테이너 실행 (Docker와 동일한 명령)
sudo nerdctl run -d --name web -p 8080:80 nginx:alpine

# 컨테이너 목록
sudo nerdctl ps

# 컨테이너 로그
sudo nerdctl logs web

# 컨테이너 exec
sudo nerdctl exec -it web /bin/sh

# 이미지 빌드 (BuildKit 기반)
sudo nerdctl build -t myapp:latest .

# 이미지 목록
sudo nerdctl images

# 컨테이너 중지 및 삭제
sudo nerdctl stop web
sudo nerdctl rm web

# Kubernetes namespace의 컨테이너 확인
sudo nerdctl -n k8s.io ps

# Docker Compose 호환 (nerdctl compose)
sudo nerdctl compose up -d
sudo nerdctl compose ps
sudo nerdctl compose down

# ctr vs nerdctl vs crictl 비교
# ctr       : containerd 저수준 디버깅 도구, 사용자 친화적이지 않다
# nerdctl   : Docker 호환 CLI, 일반 사용자와 개발자를 위한 도구이다
# crictl    : CRI 인터페이스 디버깅 도구, Kubernetes 환경 전용이다
```

### 실습 11: crictl로 CRI 인터페이스 확인
```bash
# crictl은 CRI 호환 런타임을 위한 CLI이다
# kubelet이 사용하는 것과 동일한 CRI 인터페이스로 통신한다

# crictl 설정 확인
sudo cat /etc/crictl.yaml

# 런타임 정보 확인
sudo crictl info

# Pod 목록 확인
sudo crictl pods

# Pod 상세 정보 (JSON)
sudo crictl inspectp <pod-id>

# 컨테이너 목록 확인 (실행 중인 것만)
sudo crictl ps

# 모든 컨테이너 (종료된 것 포함)
sudo crictl ps -a

# 특정 Pod의 컨테이너만 필터링
sudo crictl ps --pod <pod-id>

# 이미지 목록 확인
sudo crictl images

# 이미지 상세 정보
sudo crictl inspecti <image-id>

# 특정 컨테이너 상세 정보
sudo crictl inspect <container-id>

# 컨테이너 로그 확인
sudo crictl logs <container-id>

# 컨테이너 로그 실시간 확인 (tail -f 와 유사)
sudo crictl logs -f <container-id>

# 최근 N줄만 확인
sudo crictl logs --tail 50 <container-id>

# 컨테이너 내부에 exec
sudo crictl exec -it <container-id> /bin/sh

# 컨테이너 리소스 사용량 (stats)
sudo crictl stats

# 특정 컨테이너 stats
sudo crictl stats <container-id>

# 이미지 Pull (CRI 경유)
sudo crictl pull nginx:alpine

# 이미지 삭제
sudo crictl rmi <image-id>
```

### 실습 12: 이벤트 모니터링
```bash
# containerd 이벤트 실시간 스트림 (다른 터미널에서 컨테이너 조작 시 이벤트 확인)
sudo ctr events
```

### 실습 13: containerd 설정 파일 분석
```bash
# 프로젝트에서 사용하는 containerd 설정 확인
cat ../../scripts/setup-*.sh | grep -A 20 "containerd"
```

---
