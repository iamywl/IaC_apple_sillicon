# Day 1: containerd 기본 개념 및 아키텍처 심층

> containerd의 핵심 개념, gRPC API, Core Services, Plugin System, Metadata Store, CRI Plugin Architecture, Snapshotter Types(overlayfs/devmapper/stargz), Shim v2 Architecture를 다룬다.

## 개념

### containerd란?
- 업계 표준 고성능 컨테이너 런타임이다 (CNCF Graduated, 2019년 졸업)
- 원래 Docker 내부 컴포넌트였으나 2016년에 독립 프로젝트로 분리되었다
- CRI(Container Runtime Interface)를 내장 플러그인으로 지원하여 Kubernetes와 직접 통신한다
- 컨테이너의 전체 생명주기(이미지 Pull → 스냅샷 생성 → 컨테이너 생성 → Task 실행 → 삭제)를 관리한다
- gRPC API를 통해 클라이언트(kubelet, ctr, nerdctl 등)와 통신한다

### 핵심 개념
| 개념 | 설명 |
|------|------|
| CRI | Kubernetes가 컨테이너 런타임과 통신하는 표준 gRPC 인터페이스이다. Pod 생명주기와 이미지 관리 두 가지 서비스를 정의한다 |
| OCI Runtime | Open Container Initiative 표준을 따르는 저수준 런타임(runc 등)이다. OCI Runtime Spec에 따라 컨테이너 프로세스를 실제로 생성한다 |
| OCI Image Spec | 컨테이너 이미지의 포맷을 정의하는 표준이다. manifest, config, layer로 구성된다 |
| Content Store | 이미지 레이어, manifest, config 등을 content-addressable 방식(SHA-256 digest)으로 저장하는 불변 저장소이다 |
| Metadata Store | 컨테이너, 이미지, 스냅샷 등의 메타데이터를 bbolt(embedded key-value DB)에 저장하는 컴포넌트이다 |
| Snapshotter | 컨테이너 파일시스템 레이어를 관리하는 컴포넌트이다. overlayfs, native, devmapper 등 다양한 구현체가 있다 |
| Namespace | containerd 내부에서 리소스(컨테이너, 이미지, 스냅샷)를 논리적으로 격리하는 멀티테넌시 메커니즘이다 |
| Task | 컨테이너 내부에서 실행되는 프로세스의 런타임 상태를 나타내는 객체이다 |
| Shim | containerd와 OCI runtime(runc) 사이의 중간 프로세스이다. containerd 재시작 시에도 컨테이너가 유지되도록 한다 |
| SystemdCgroup | systemd를 통해 cgroup을 관리하는 방식이다. kubelet의 cgroupDriver 설정과 반드시 일치해야 한다 |

---

### containerd Architecture Deep Dive

#### Client API (gRPC)

containerd는 모든 클라이언트와 gRPC 프로토콜을 통해 통신한다. 기본 소켓 경로는 `/run/containerd/containerd.sock` 이다. 클라이언트는 이 소켓에 연결하여 containerd의 서비스들을 호출한다.

주요 gRPC 서비스 목록:

| 서비스 | 설명 |
|--------|------|
| `containerd.services.containers.v1` | 컨테이너 메타데이터 CRUD를 담당한다 |
| `containerd.services.content.v1` | Content Store(CAS)의 읽기/쓰기를 담당한다 |
| `containerd.services.images.v1` | 이미지 메타데이터(이름, target descriptor)를 관리한다 |
| `containerd.services.leases.v1` | 리소스 가비지 컬렉션을 방지하기 위한 lease를 관리한다 |
| `containerd.services.namespaces.v1` | 멀티테넌시를 위한 namespace CRUD를 담당한다 |
| `containerd.services.snapshots.v1` | Snapshotter를 통한 파일시스템 스냅샷을 관리한다 |
| `containerd.services.tasks.v1` | 컨테이너 프로세스(Task)의 생성/시작/종료를 관리한다 |
| `containerd.services.events.v1` | 이벤트 발행/구독(pub/sub)을 담당한다 |
| `containerd.services.diff.v1` | 스냅샷 간의 diff를 계산하거나 diff를 적용한다 |
| `containerd.services.introspection.v1` | 플러그인 목록, 서버 정보 등 내부 상태를 조회한다 |

클라이언트 라이브러리는 Go 언어로 작성되어 있으며, `github.com/containerd/containerd/v2/client` 패키지를 통해 프로그래밍 방식으로 접근할 수 있다. Go 외에도 gRPC를 지원하는 모든 언어에서 protobuf 정의를 기반으로 클라이언트를 생성할 수 있다.

```go
// Go 클라이언트 예시
client, err := containerd.New("/run/containerd/containerd.sock")
defer client.Close()

// 특정 namespace에서 작업
ctx := namespaces.WithNamespace(context.Background(), "k8s.io")

// 이미지 pull
image, err := client.Pull(ctx, "docker.io/library/nginx:alpine",
    containerd.WithPullUnpack)

// 컨테이너 생성
container, err := client.NewContainer(ctx, "my-nginx",
    containerd.WithNewSnapshot("my-nginx-snapshot", image),
    containerd.WithNewSpec(oci.WithImageConfig(image)))

// Task 생성 및 시작
task, err := container.NewTask(ctx, cio.NewCreator(cio.WithStdio))
err = task.Start(ctx)
```

#### Core Services 상세

containerd 내부의 core service들은 각각 독립적인 책임 영역을 가진다:

1. **Containers Service**: 컨테이너 메타데이터(ID, labels, image reference, runtime info, spec)를 Metadata Store에 저장하고 관리한다. 이 서비스가 관리하는 것은 메타데이터일 뿐, 실제 프로세스와는 무관하다.

2. **Content Service**: Content-Addressable Storage(CAS)를 관리한다. 모든 데이터는 SHA-256 digest를 키로 사용하며, 동일 content에 대한 중복 저장을 방지한다. `Writer`를 통해 데이터를 `ingest/` 에 임시 저장하고, 커밋 시 `blobs/sha256/` 으로 이동한다.

3. **Images Service**: 이미지 이름(예: `docker.io/library/nginx:alpine`)과 해당 manifest의 descriptor(mediaType + digest + size)를 매핑한다. 실제 이미지 데이터는 Content Store에 저장되며, Images Service는 참조만 관리한다.

4. **Leases Service**: 가비지 컬렉션(GC)으로부터 리소스를 보호하는 메커니즘이다. 이미지 pull 중 레이어가 GC에 의해 삭제되는 것을 방지한다. lease에 리소스를 연결하면 해당 lease가 삭제될 때까지 GC 대상에서 제외된다.

5. **Namespaces Service**: 멀티테넌시를 위한 논리적 격리 단위이다. 각 namespace는 독립적인 컨테이너, 이미지, 스냅샷 공간을 가진다. namespace 간에는 리소스 공유가 일어나지 않는다.

6. **Snapshots Service**: Snapshotter 플러그인을 통해 컨테이너 파일시스템을 관리한다. `Prepare` (writable snapshot 생성), `Commit` (read-only로 전환), `View` (read-only snapshot 생성), `Remove` (삭제) 등의 연산을 제공한다.

7. **Tasks Service**: 실제 컨테이너 프로세스의 생명주기를 관리한다. shim 프로세스를 시작하고, shim을 통해 runc를 호출하여 컨테이너를 생성/시작/종료한다. stdin/stdout/stderr 스트림도 관리한다.

#### Plugin System

containerd는 철저한 플러그인 기반 아키텍처로 설계되어 있다. 핵심 기능을 포함한 거의 모든 것이 플러그인으로 구현되어 있다.

**Built-in 플러그인**: containerd 바이너리에 컴파일되어 포함된 플러그인이다. 별도의 설치 없이 즉시 사용 가능하다.

| 플러그인 타입 | 역할 | 예시 |
|-------------|------|------|
| `io.containerd.grpc.v1` | gRPC 서비스 플러그인 | CRI, introspection |
| `io.containerd.snapshotter.v1` | Snapshotter 구현체 | overlayfs, native, devmapper |
| `io.containerd.runtime.v2` | 런타임 shim 구현체 | runc v2, kata-containers |
| `io.containerd.service.v1` | 내부 서비스 | tasks-service, containers-service |
| `io.containerd.differ.v1` | 이미지 diff 처리 | walking differ |
| `io.containerd.gc.v1` | 가비지 컬렉션 | scheduler |
| `io.containerd.content.v1` | Content Store | content |
| `io.containerd.metadata.v1` | 메타데이터 저장 | bolt |

**External 플러그인 (Proxy 플러그인)**: containerd 외부에서 별도 프로세스로 실행되며, gRPC/ttrpc를 통해 containerd와 통신한다. containerd를 재컴파일하지 않고도 기능을 확장할 수 있다.

```toml
# 외부 snapshotter 플러그인 등록 예시 (config.toml)
[proxy_plugins]
  [proxy_plugins.stargz]
    type = "snapshot"
    address = "/run/containerd-stargz-grpc/containerd-stargz-grpc.sock"
```

플러그인 초기화 순서는 의존성에 따라 자동 결정된다. 예를 들어, Content Store 플러그인은 Metadata Store보다 먼저 초기화되어야 하며, containerd가 이를 자동으로 관리한다.

```bash
# 등록된 플러그인 목록 확인
sudo ctr plugins list

# 플러그인 상태 확인 (TYPE, ID, PLATFORMS, STATUS)
sudo ctr plugins list | grep -v ok  # 문제가 있는 플러그인 확인
```

#### Metadata Store (bbolt/boltdb)

containerd는 메타데이터 저장에 bbolt(이전 이름: boltdb)를 사용한다. bbolt는 Go 언어로 작성된 임베디드 key-value 데이터베이스로, 별도의 서버 프로세스 없이 단일 파일(`meta.db`)에 모든 메타데이터를 저장한다.

- **저장 경로**: `/var/lib/containerd/io.containerd.metadata.v1.bolt/meta.db`
- **트랜잭션 모델**: 읽기는 동시에 여러 트랜잭션이 가능하지만, 쓰기는 단일 트랜잭션만 허용된다 (MVCC)
- **Bucket 구조**: namespace를 최상위 bucket으로 사용하고, 그 하위에 containers, images, snapshots 등의 bucket이 존재한다
- **GC (Garbage Collection)**: 메타데이터에서 참조되지 않는 content와 snapshot을 주기적으로 정리한다. GC는 metadata의 참조 그래프를 기반으로 동작한다

```
meta.db (bbolt)
├── v1/
│   ├── k8s.io/                    (namespace)
│   │   ├── containers/            (컨테이너 메타데이터)
│   │   │   ├── <container-id-1>
│   │   │   └── <container-id-2>
│   │   ├── images/                (이미지 참조)
│   │   │   ├── docker.io/library/nginx:alpine
│   │   │   └── registry.k8s.io/pause:3.9
│   │   ├── snapshots/             (스냅샷 정보)
│   │   └── leases/                (lease 정보)
│   ├── moby/                      (Docker namespace)
│   └── default/                   (기본 namespace)
└── ...
```

---

### CRI Plugin Architecture

CRI(Container Runtime Interface)는 kubelet이 컨테이너 런타임과 통신하기 위한 표준 gRPC 인터페이스이다. containerd는 CRI를 built-in 플러그인(`io.containerd.grpc.v1.cri`)으로 구현한다.

#### CRI API: RuntimeService + ImageService

CRI API는 두 개의 gRPC 서비스로 구성된다:

**RuntimeService** - Pod와 컨테이너의 생명주기를 관리한다:

| RPC 메서드 | 설명 |
|-----------|------|
| `RunPodSandbox` | Pod sandbox(pause 컨테이너 + network namespace)를 생성하고 시작한다 |
| `StopPodSandbox` | Pod sandbox를 중지한다 (네트워크 teardown 포함) |
| `RemovePodSandbox` | 중지된 Pod sandbox를 삭제한다 |
| `PodSandboxStatus` | Pod sandbox의 상태를 조회한다 |
| `ListPodSandbox` | 필터 조건에 맞는 Pod sandbox 목록을 반환한다 |
| `CreateContainer` | sandbox 내에 새 컨테이너를 생성한다 |
| `StartContainer` | 생성된 컨테이너를 시작한다 |
| `StopContainer` | 실행 중인 컨테이너를 중지한다 |
| `RemoveContainer` | 중지된 컨테이너를 삭제한다 |
| `ContainerStatus` | 컨테이너 상태를 조회한다 |
| `ListContainers` | 컨테이너 목록을 반환한다 |
| `ExecSync` | 컨테이너 내에서 동기 명령을 실행한다 |
| `Exec` | 컨테이너 내에서 스트리밍 명령을 실행한다 (kubectl exec) |
| `Attach` | 실행 중인 컨테이너에 attach한다 (kubectl attach) |
| `PortForward` | Pod의 포트를 포워딩한다 (kubectl port-forward) |
| `UpdateContainerResources` | 컨테이너 리소스 제한을 업데이트한다 |
| `ReopenContainerLog` | 컨테이너 로그 파일을 재개방한다 (logrotate 후) |
| `RuntimeStatus` | 런타임의 전체 상태를 조회한다 |

**ImageService** - 컨테이너 이미지를 관리한다:

| RPC 메서드 | 설명 |
|-----------|------|
| `ListImages` | 사용 가능한 이미지 목록을 반환한다 |
| `ImageStatus` | 특정 이미지의 상태를 조회한다 |
| `PullImage` | 레지스트리에서 이미지를 pull한다 |
| `RemoveImage` | 이미지를 삭제한다 |
| `ImageFsInfo` | 이미지 저장소의 파일시스템 정보를 반환한다 |

#### Pod Sandbox 개념

Pod Sandbox는 Pod 내 모든 컨테이너가 공유하는 격리 환경이다. `pause` 컨테이너(`registry.k8s.io/pause:3.9`)가 sandbox의 핵심을 구성한다.

```
┌──────────────────────────────────────────────────────────────────┐
│  Pod Sandbox                                                      │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │  pause 컨테이너 (PID 1 = /pause)                             │ │
│  │  - Network Namespace 소유 (eth0, veth pair, IP 할당)          │ │
│  │  - IPC Namespace 소유                                        │ │
│  │  - PID Namespace 소유 (선택적, ShareProcessNamespace 설정)     │ │
│  │  - UTS Namespace 소유 (hostname)                              │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                    │
│  ┌─────────────────────┐  ┌─────────────────────┐                 │
│  │  App Container 1     │  │  App Container 2     │                 │
│  │  (namespace join)    │  │  (namespace join)    │                 │
│  │  - 자체 Mount NS     │  │  - 자체 Mount NS     │                 │
│  │  - 자체 PID NS (옵션)│  │  - 자체 PID NS (옵션)│                 │
│  │  - Net/IPC: pause와  │  │  - Net/IPC: pause와  │                 │
│  │    공유               │  │    공유               │                 │
│  └─────────────────────┘  └─────────────────────┘                 │
│                                                                    │
│  공유 리소스:                                                       │
│  - IP 주소 (모든 컨테이너가 동일 IP, localhost로 통신)                │
│  - Network namespace (동일 네트워크 스택 공유)                       │
│  - IPC namespace (공유 메모리, 세마포어 등 공유)                     │
│  - Volumes (Pod spec에 정의된 볼륨 마운트)                          │
└──────────────────────────────────────────────────────────────────┘
```

pause 컨테이너의 역할:
- Linux namespace(network, IPC, PID 등)를 보유하고 유지한다
- Pod 내 다른 컨테이너들은 pause 컨테이너의 namespace에 join한다
- 이를 통해 같은 Pod의 컨테이너들은 localhost로 통신할 수 있다
- CNI(Container Network Interface)는 Sandbox 생성 시 호출되어 네트워크를 구성한다
- pause 프로세스 자체는 `SIGCHLD`를 무시하며 좀비 프로세스를 수확(reap)하는 역할도 한다

#### Streaming API (exec / attach / port-forward)

`kubectl exec`, `kubectl attach`, `kubectl port-forward` 같은 스트리밍 연산은 CRI의 Streaming API를 통해 처리된다. 이 과정은 두 단계로 이루어진다:

```
1단계: Streaming URL 요청 (gRPC)
kubelet ──── Exec(request) ────► containerd CRI Plugin
kubelet ◄── streaming URL ────── containerd CRI Plugin
                                    │
                                    ▼
                        내장 Streaming Server 시작
                        (HTTP/WebSocket endpoint)

2단계: 스트리밍 연결 (HTTP/WebSocket)
kubelet ──── HTTP Upgrade ────► containerd Streaming Server
        ◄─── WebSocket ────►  (stdin/stdout/stderr 스트리밍)
                                    │
                                    ▼ (shim ttrpc)
                            containerd-shim-runc-v2
                                    │
                                    ▼ (nsenter / runc exec)
                            컨테이너 프로세스
```

containerd의 CRI 플러그인은 자체적으로 HTTP streaming server를 내장하고 있다. kubelet은 gRPC를 통해 streaming URL을 받고, 이후 해당 URL로 직접 WebSocket 연결을 수립하여 I/O를 스트리밍한다. 이 설계는 장시간 실행되는 스트리밍 연결이 gRPC 연결을 점유하지 않도록 분리하기 위한 것이다.

---

### Snapshotter Types

Snapshotter는 컨테이너의 rootfs를 구성하는 핵심 컴포넌트이다. 이미지 레이어를 효율적으로 관리하여 컨테이너의 파일시스템을 만든다.

| Snapshotter 유형 | 설명 | 사용 환경 |
|-----------------|------|----------|
| **overlayfs** | Linux OverlayFS를 사용한다. 가장 널리 사용되며 성능이 우수하다. 여러 레이어를 union mount로 합친다 | Linux (커널 4.0+, 기본값) |
| **native** | 단순 파일 복사 방식이다. 특별한 커널 기능이 필요 없지만 느리고 디스크를 많이 사용한다 | OverlayFS 미지원 환경, 테스트용 |
| **devmapper** | Device Mapper thin provisioning을 사용한다. 블록 레벨 스냅샷으로 동작한다 | 프로덕션 고성능 환경 (Amazon Linux 등) |
| **zfs** | ZFS 파일시스템의 스냅샷 기능을 활용한다 | ZFS 사용 환경 |
| **btrfs** | Btrfs 파일시스템의 서브볼륨 기능을 활용한다 | Btrfs 사용 환경 |
| **stargz** | eStargz(Seekable tar.gz) 포맷을 활용하여 lazy pulling을 구현한다. 전체 이미지를 다운로드하지 않고도 컨테이너를 시작할 수 있다 | 대용량 이미지 환경, 빠른 시작 필요 시 |

#### overlayfs 상세

overlayfs는 가장 널리 사용되는 snapshotter이다. Linux 커널의 OverlayFS를 활용하여 여러 디렉토리를 하나의 파일시스템처럼 합친다(union mount).

```
┌──────────────────────────────┐
│   Container Layer (R/W)      │  ← upperdir (컨테이너 쓰기 레이어)
├──────────────────────────────┤
│   Image Layer 3 (R/O)        │  ← lowerdir
├──────────────────────────────┤
│   Image Layer 2 (R/O)        │  ← lowerdir
├──────────────────────────────┤
│   Image Layer 1 (R/O)        │  ← lowerdir (base layer)
└──────────────────────────────┘
         │
         ▼
┌──────────────────────────────┐
│   Merged View (mountpoint)   │  ← 컨테이너가 보는 최종 파일시스템
└──────────────────────────────┘
```

mount 명령 예시:
```bash
mount -t overlay overlay \
  -o lowerdir=/var/lib/containerd/io.containerd.snapshotter.v1.overlayfs/snapshots/3/fs:\
/var/lib/containerd/io.containerd.snapshotter.v1.overlayfs/snapshots/2/fs:\
/var/lib/containerd/io.containerd.snapshotter.v1.overlayfs/snapshots/1/fs,\
upperdir=/var/lib/containerd/io.containerd.snapshotter.v1.overlayfs/snapshots/4/fs,\
workdir=/var/lib/containerd/io.containerd.snapshotter.v1.overlayfs/snapshots/4/work \
/run/containerd/io.containerd.runtime.v2.task/k8s.io/<container-id>/rootfs
```

Copy-on-Write(CoW) 동작 원리:
- **파일 읽기**: merged view에서 upperdir → lowerdir 순서로 검색하여 먼저 발견된 파일을 반환한다
- **파일 수정**: lowerdir의 파일을 수정하면 해당 파일이 upperdir로 복사된 후 수정된다 (copy-up)
- **파일 삭제**: lowerdir의 파일을 삭제하면 upperdir에 whiteout 파일(character device 0,0)이 생성되어 해당 파일을 가린다
- **디렉토리 삭제**: opaque whiteout이 생성되어 하위의 모든 lowerdir 파일을 숨긴다

#### devmapper 상세

devmapper snapshotter는 Linux Device Mapper의 thin provisioning 기능을 사용한다. 블록 레벨에서 동작하므로 파일시스템 레벨의 overlayfs와는 근본적으로 다르다.

```
┌─────────────────────────────────────────────┐
│             Thin Pool                        │
│  ┌────────────┐  ┌────────────┐             │
│  │ Thin Device │  │ Thin Device │  ...        │
│  │ (Layer 1)   │  │ (Layer 2)   │             │
│  └────────────┘  └────────────┘             │
│         │                │                   │
│         └────────┬───────┘                   │
│                  ▼                           │
│         ┌────────────────┐                   │
│         │ Thin Snapshot   │ (R/W, container) │
│         │ (CoW at block   │                  │
│         │  level)         │                  │
│         └────────────────┘                   │
└─────────────────────────────────────────────┘
```

- **장점**: 블록 레벨 CoW로 대용량 파일 수정 시 overlayfs보다 효율적이다. copy-up이 블록 단위로 발생하므로 대용량 파일의 일부만 수정할 때 유리하다
- **단점**: 설정이 복잡하고, thin pool 용량 관리가 필요하다
- **사용 사례**: Amazon Linux 2에서 기본 snapshotter로 사용한다 (EKS with Amazon Linux)

#### stargz (Lazy Pulling) 상세

stargz snapshotter는 eStargz(Extended Seekable tar.gz) 포맷을 활용하여 이미지를 완전히 다운로드하지 않고도 컨테이너를 시작할 수 있게 한다.

```
기존 Pull 방식:
Registry ──── 전체 이미지 다운로드 (수 GB) ────► containerd ──► 컨테이너 시작
              (모든 레이어 완료까지 대기)

stargz Lazy Pull 방식:
Registry ──── 필수 파일만 on-demand 다운로드 ──► containerd ──► 컨테이너 즉시 시작
              (나머지는 백그라운드에서               │
               접근 시점에 다운로드)                  ▼
                                              FUSE/OverlayFS를 통해
                                              파일 접근 시 HTTP Range Request
```

- **원리**: eStargz 포맷은 tar.gz 내부에 파일별 인덱스(Table of Contents)를 포함하고 있다. 이를 통해 전체 아카이브를 다운로드하지 않고도 개별 파일에 HTTP Range Request로 접근할 수 있다
- **효과**: 대용량 이미지(ML 모델, 데이터 처리 등)의 시작 시간을 수십 초에서 수 초로 단축할 수 있다
- **설정**: 외부 proxy 플러그인(`containerd-stargz-grpc`)으로 동작하므로 별도 설치가 필요하다

---

### Shim v2 Architecture

containerd-shim-runc-v2는 containerd와 runc 사이의 중간 프로세스이다.

```
containerd ◄──── ttrpc ────► containerd-shim-runc-v2 ──── exec ────► runc
                                      │
                                      ├── 컨테이너 stdin/stdout/stderr 관리
                                      ├── 컨테이너 exit status 수집
                                      ├── OOM 이벤트 모니터링
                                      └── containerd 독립적으로 실행
```

#### 핵심 특징

1. **containerd 독립성**: containerd 프로세스가 재시작(업그레이드 등)되어도 shim은 독립적으로 컨테이너를 유지한다. containerd가 다시 시작되면 기존 shim들을 발견하고 재연결한다. 이로써 containerd 업그레이드 시에도 다운타임 없이 컨테이너가 계속 실행된다.

2. **ttrpc 통신**: gRPC의 경량화 버전인 ttrpc(Tiny Transport RPC)를 사용한다. ttrpc는 HTTP/2 프레이밍과 protobuf 인코딩을 사용하되, gRPC의 복잡한 기능(metadata, interceptor 등)을 제거하여 메모리 사용량을 크게 줄였다. 로컬 Unix domain socket 통신에 최적화되어 있다.

3. **Pod당 하나의 shim (v2)**: v1에서는 컨테이너당 하나의 shim 프로세스가 필요했다. v2에서는 Pod당 하나의 shim으로 개선되어 리소스 효율이 높아졌다. 하나의 shim이 Pod 내 모든 컨테이너(pause + app containers)를 관리한다.

4. **runc 호출 방식**: shim이 runc 바이너리를 exec하여 컨테이너를 생성/시작/삭제한다. runc 자체는 컨테이너 프로세스를 fork한 후 즉시 종료된다. 컨테이너 프로세스는 shim의 자식 프로세스로 남게 된다.

#### Shim 생명주기 (Lifecycle)

```
1. containerd가 Task Create 요청을 받는다
        │
        ▼
2. containerd가 containerd-shim-runc-v2 바이너리를 실행한다
   (shim binary는 자기 자신을 daemonize한다)
        │
        ▼
3. shim은 ttrpc 서버를 시작하고, Unix socket 주소를 stdout으로 반환한다
   (containerd가 이 주소로 ttrpc 연결을 수립한다)
        │
        ▼
4. containerd가 shim에게 Create 요청을 보낸다
   (shim이 runc create를 호출하여 컨테이너를 생성한다)
        │
        ▼
5. containerd가 shim에게 Start 요청을 보낸다
   (shim이 runc start를 호출하여 프로세스를 실행한다)
        │
        ▼
6. shim은 컨테이너 프로세스를 모니터링한다
   - exit status 수집
   - stdout/stderr 스트림 관리
   - OOM kill 감지 (cgroup memory.oom_control)
        │
        ▼
7. 컨테이너 프로세스가 종료되면 shim이 이벤트를 발행한다
   (containerd에 TaskExit 이벤트를 전달한다)
        │
        ▼
8. containerd가 Task Delete 요청을 보내면 shim이 리소스를 정리하고 종료한다
```

#### containerd 재시작 시의 동작

```
정상 동작 상태:
containerd ◄──── ttrpc ────► shim-1 (Pod A)
           ◄──── ttrpc ────► shim-2 (Pod B)

containerd 재시작:
containerd (종료)
                               shim-1 (Pod A) ← 독립적으로 계속 실행
                               shim-2 (Pod B) ← 독립적으로 계속 실행

containerd 재시작 완료:
containerd (새 프로세스)
    │
    ├── /run/containerd/io.containerd.runtime.v2.task/ 디렉토리를 스캔한다
    │   각 task 디렉토리에서 shim의 address 파일을 읽는다
    │
    ├── shim-1에 ttrpc 재연결 ──► shim-1 (Pod A, 계속 실행 중)
    └── shim-2에 ttrpc 재연결 ──► shim-2 (Pod B, 계속 실행 중)
```

#### runc 호출 과정

```bash
# shim이 내부적으로 수행하는 runc 호출 흐름

# 1. 컨테이너 생성 (namespace, cgroup, rootfs 설정 후 프로세스 대기)
runc create --bundle /run/containerd/io.containerd.runtime.v2.task/k8s.io/<id> <container-id>

# 2. 컨테이너 시작 (init 프로세스 실행)
runc start <container-id>

# 3. 추가 프로세스 실행 (exec)
runc exec <container-id> <command>

# 4. 컨테이너 종료
runc kill <container-id> SIGTERM

# 5. 컨테이너 삭제
runc delete <container-id>
```

---
