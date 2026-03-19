# containerd - 컨테이너 런타임

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

### Container Creation Flow

이미지 Pull부터 프로세스 실행까지의 전체 흐름을 단계별로 상세하게 설명한다.

```
┌─────────┐     ┌──────────┐     ┌─────────────┐     ┌──────────┐     ┌──────────┐
│ 1. Image │     │ 2. Unpack │     │ 3. Container│     │ 4. Task  │     │ 5. Task  │
│    Pull  │ ──► │ (Snapshot │ ──► │    Create   │ ──► │   Create │ ──► │   Start  │
│          │     │  rootfs)  │     │ (metadata)  │     │ (shim+   │     │ (process)│
│          │     │           │     │             │     │  runc)   │     │          │
└─────────┘     └──────────┘     └─────────────┘     └──────────┘     └──────────┘
```

#### 1단계: Image Pull

```
Client                     containerd                    Registry
  │                            │                            │
  │  Pull("nginx:alpine")     │                            │
  ├───────────────────────────►│                            │
  │                            │  GET /v2/library/nginx/    │
  │                            │  manifests/alpine          │
  │                            ├───────────────────────────►│
  │                            │  manifest (JSON)           │
  │                            │◄───────────────────────────┤
  │                            │                            │
  │                            │  manifest를 Content Store  │
  │                            │  에 저장 (sha256:xxxx)     │
  │                            │                            │
  │                            │  GET /v2/library/nginx/    │
  │                            │  blobs/sha256:<config>     │
  │                            ├───────────────────────────►│
  │                            │  config (JSON)             │
  │                            │◄───────────────────────────┤
  │                            │                            │
  │                            │  각 layer를 병렬 다운로드   │
  │                            │  GET /v2/.../blobs/sha256: │
  │                            ├───────────────────────────►│
  │                            │  layer (tar.gz)            │
  │                            │◄───────────────────────────┤
  │                            │                            │
  │                            │  이미 존재하는 digest는    │
  │                            │  다운로드를 스킵한다       │
  │                            │  (layer deduplication)     │
  │                            │                            │
  │  Pull complete             │                            │
  │◄───────────────────────────┤                            │
```

#### 2단계: Unpack (Snapshotter가 rootfs 생성)

```
containerd                          Snapshotter (overlayfs)
  │                                        │
  │  layer 1 tar.gz를 풀어서              │
  │  committed snapshot 생성 요청          │
  ├───────────────────────────────────────►│
  │                                        │  snapshots/1/fs/ 디렉토리 생성
  │                                        │  tar 내용을 해당 디렉토리에 추출
  │                                        │  snapshot을 committed (read-only)로 마킹
  │                                        │
  │  layer 2 tar.gz (parent: layer 1)     │
  ├───────────────────────────────────────►│
  │                                        │  snapshots/2/fs/ 디렉토리 생성
  │                                        │  tar 내용을 추출 (parent 참조 기록)
  │                                        │  committed로 마킹
  │                                        │
  │  ... (모든 레이어에 대해 반복)          │
  │                                        │
  │  최종 이미지 snapshot chain 완성        │
  │◄───────────────────────────────────────┤
```

#### 3단계: Container Create (메타데이터)

```
containerd                       Metadata Store (bbolt)
  │                                     │
  │  1. active snapshot 생성 요청       │
  │     (이미지 최상위 레이어 위에       │
  │      writable 레이어 추가)          │
  ├────────────────────────────────────►│
  │                                     │  Snapshotter에 Prepare() 호출
  │                                     │  → 새 writable snapshot 생성
  │                                     │
  │  2. OCI Runtime Spec 생성           │
  │     (config.json 준비)              │
  │     - root (rootfs 경로)            │
  │     - process (entrypoint, cmd)     │
  │     - mounts (volumes, proc, sys)   │
  │     - linux.namespaces              │
  │     - linux.resources (cgroup)      │
  │     - linux.seccomp                 │
  │                                     │
  │  3. 컨테이너 메타데이터 저장          │
  │     (ID, image, snapshot key,       │
  │      labels, runtime, spec)         │
  ├────────────────────────────────────►│
  │                                     │  bbolt에 저장
  │  container object 반환              │
  │◄────────────────────────────────────┤
```

#### 4단계: Task Create (shim + runc로 실제 프로세스 생성)

```
containerd                    shim (containerd-shim-runc-v2)         runc
  │                                  │                                 │
  │  shim binary 실행                │                                 │
  ├─────────────────────────────────►│                                 │
  │                                  │  self-daemonize                 │
  │  ttrpc address 반환              │  ttrpc server 시작              │
  │◄─────────────────────────────────┤                                 │
  │                                  │                                 │
  │  Create(bundle, rootfs, spec)    │                                 │
  ├─────────────────────────────────►│                                 │
  │                                  │  rootfs mount (overlayfs)       │
  │                                  │  config.json 준비               │
  │                                  │                                 │
  │                                  │  runc create --bundle <path>    │
  │                                  ├────────────────────────────────►│
  │                                  │                                 │
  │                                  │  runc가 컨테이너 환경 구성:      │
  │                                  │  - namespace 생성 (mnt, pid,    │
  │                                  │    net, ipc, uts, user)         │
  │                                  │  - cgroup 할당                  │
  │                                  │  - rootfs pivot_root            │
  │                                  │  - seccomp 필터 적용            │
  │                                  │  - capabilities 설정            │
  │                                  │  - 프로세스 생성 후 SIGSTOP 대기│
  │                                  │                                 │
  │                                  │  create 완료 (프로세스 대기중)   │
  │                                  │◄────────────────────────────────┤
  │  Create 완료                     │                                 │
  │◄─────────────────────────────────┤                                 │
```

#### 5단계: Task Start (프로세스 실행)

```
containerd                    shim                                  runc
  │                             │                                     │
  │  Start()                    │                                     │
  ├────────────────────────────►│                                     │
  │                             │  runc start <container-id>          │
  │                             ├────────────────────────────────────►│
  │                             │                                     │
  │                             │  SIGSTOP 해제 → init 프로세스 시작   │
  │                             │  (entrypoint/cmd 실행)              │
  │                             │                                     │
  │                             │  runc 자체는 종료                    │
  │                             │◄────────────────────────────────────┤
  │                             │                                     │
  │                             │  컨테이너 프로세스는 shim의          │
  │                             │  자식 프로세스로 계속 실행           │
  │                             │                                     │
  │  Start 완료                 │  stdout/stderr fifo 관리            │
  │  TaskStart 이벤트 발행      │  exit status 모니터링               │
  │◄────────────────────────────┤  OOM 이벤트 감지                    │
```

---

### Image Management

#### Content Store (Content-Addressable Storage)

Content Store는 모든 이미지 데이터를 SHA-256 digest를 키로 하여 불변(immutable)하게 저장한다.

- **저장 경로**: `/var/lib/containerd/io.containerd.content.v1.content/`
- **구조**:
  - `ingest/` : 다운로드 중인 데이터가 임시 저장되는 디렉토리이다
  - `blobs/sha256/` : 검증 완료된 불변 데이터가 저장되는 디렉토리이다

```
/var/lib/containerd/io.containerd.content.v1.content/
├── ingest/
│   └── <ref>/
│       ├── data       (다운로드 중인 임시 데이터)
│       ├── ref        (참조 이름)
│       ├── startedat  (시작 시간)
│       └── total      (전체 크기)
└── blobs/
    └── sha256/
        ├── a3ed95caeb... (image manifest)
        ├── 7b8b2a3f8e... (image config)
        ├── d1e8a8f33c... (layer tar.gz)
        └── ...
```

#### Image Manifest (OCI Image Spec)

OCI Image Specification은 컨테이너 이미지의 표준 포맷을 정의한다. 핵심 구성 요소는 다음과 같다:

```json
// Image Manifest (application/vnd.oci.image.manifest.v1+json)
{
  "schemaVersion": 2,
  "mediaType": "application/vnd.oci.image.manifest.v1+json",
  "config": {
    "mediaType": "application/vnd.oci.image.config.v1+json",
    "digest": "sha256:7b8b2a3f8e...",   // image config의 digest
    "size": 7023
  },
  "layers": [
    {
      "mediaType": "application/vnd.oci.image.layer.v1.tar+gzip",
      "digest": "sha256:d1e8a8f33c...",   // base layer
      "size": 32654
    },
    {
      "mediaType": "application/vnd.oci.image.layer.v1.tar+gzip",
      "digest": "sha256:5f70bf18a0...",   // second layer
      "size": 16724
    }
  ]
}
```

```json
// Image Config (application/vnd.oci.image.config.v1+json)
{
  "architecture": "amd64",
  "os": "linux",
  "config": {
    "Env": ["PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"],
    "Entrypoint": ["/docker-entrypoint.sh"],
    "Cmd": ["nginx", "-g", "daemon off;"],
    "ExposedPorts": {"80/tcp": {}},
    "WorkingDir": "/"
  },
  "rootfs": {
    "type": "layers",
    "diff_ids": [
      "sha256:abc123...",   // 각 레이어의 uncompressed digest
      "sha256:def456..."
    ]
  },
  "history": [...]
}
```

#### Layer Deduplication

Content-Addressable Storage의 핵심 장점은 레이어 중복 제거(deduplication)이다:

```
이미지 A (node:18-alpine):          이미지 B (node:20-alpine):
┌──────────────────────────┐        ┌──────────────────────────┐
│ Layer 3: app specific    │        │ Layer 3: app specific    │
│ sha256:aaa...            │        │ sha256:bbb...            │
├──────────────────────────┤        ├──────────────────────────┤
│ Layer 2: node runtime    │        │ Layer 2: node runtime    │
│ sha256:ccc...            │        │ sha256:ddd...            │
├──────────────────────────┤        ├──────────────────────────┤
│ Layer 1: alpine base     │        │ Layer 1: alpine base     │
│ sha256:eee...            │◄───────│ sha256:eee... (동일!)    │
└──────────────────────────┘        └──────────────────────────┘

Content Store:
blobs/sha256/
├── eee...  (alpine base - 한 번만 저장됨!)
├── ccc...  (node 18 runtime)
├── ddd...  (node 20 runtime)
├── aaa...  (app A)
└── bbb...  (app B)
```

동일한 digest를 가진 레이어는 Content Store에 한 번만 저장된다. 두 번째 이미지 pull 시 이미 존재하는 레이어는 다운로드를 건너뛴다.

#### Registry Authentication

containerd는 private registry 인증을 위해 여러 방식을 지원한다:

1. **config.toml을 통한 인증 설정** (containerd 2.0+)
2. **CRI Plugin의 registry 설정** (Kubernetes 환경)
3. **Docker 호환 credentials** (`~/.docker/config.json`)

```toml
# containerd 2.0+ 방식: /etc/containerd/certs.d/ 디렉토리 기반
[plugins."io.containerd.grpc.v1.cri".registry]
  config_path = "/etc/containerd/certs.d"
```

```
# /etc/containerd/certs.d/ 디렉토리 구조
/etc/containerd/certs.d/
├── docker.io/
│   └── hosts.toml           # Docker Hub 설정
├── ghcr.io/
│   └── hosts.toml           # GitHub Container Registry 설정
└── registry.example.com/
    ├── hosts.toml            # 프라이빗 레지스트리 설정
    └── ca.crt                # CA 인증서
```

#### Image Encryption

containerd는 OCI Image Encryption 표준을 지원하여 암호화된 이미지 레이어를 사용할 수 있다. `imgcrypt` 라이브러리를 통해 JWE(JSON Web Encryption), PKCS7, PGP 등의 암호화 방식을 지원한다. 암호화된 레이어는 복호화 키가 없으면 내용을 볼 수 없으므로, 민감한 데이터가 포함된 이미지를 안전하게 배포할 수 있다.

---

### Namespace Isolation

containerd의 Namespace는 Linux kernel namespace와는 다른 개념이다. containerd 자체의 멀티테넌시 기능이다.

- 각 Namespace는 완전히 독립된 리소스 공간을 가진다 (이미지, 컨테이너, 스냅샷 등)
- 서로 다른 Namespace의 리소스는 완전히 격리되어 상호 간섭이 없다

| Namespace | 사용 주체 | 용도 |
|-----------|----------|------|
| `k8s.io` | kubelet (CRI Plugin) | Kubernetes가 관리하는 모든 Pod, 컨테이너, 이미지가 이 namespace에 저장된다 |
| `moby` | Docker daemon (dockerd) | Docker가 containerd를 백엔드로 사용할 때 이 namespace에 저장한다 |
| `default` | ctr CLI | `ctr` 명령의 기본 namespace이다. `-n` 플래그로 변경 가능하다 |
| 사용자 정의 | BuildKit, 기타 클라이언트 | BuildKit은 `buildkit` namespace를 사용한다. 필요에 따라 임의의 namespace를 생성할 수 있다 |

```
containerd
├── Namespace: k8s.io (Kubernetes CRI가 사용)
│   ├── Images: pause:3.9, coredns, etcd, ...
│   ├── Containers: pod-sandbox-xxx, coredns-xxx, ...
│   └── Snapshots: ...
├── Namespace: moby (Docker가 사용)
│   ├── Images: nginx:alpine, ...
│   ├── Containers: web-server, ...
│   └── Snapshots: ...
└── Namespace: default (ctr 기본)
    ├── Images: ...
    └── Containers: ...
```

멀티테넌시 격리의 의미:
- `k8s.io` namespace에서 pull한 이미지는 `default` namespace에서 보이지 않는다
- Docker로 실행한 컨테이너(`moby`)와 Kubernetes로 실행한 컨테이너(`k8s.io`)는 서로 간섭하지 않는다
- 각 namespace의 리소스는 독립적으로 GC(가비지 컬렉션) 된다

---

### Runtime Classes

containerd는 단일 인스턴스에서 여러 OCI 호환 런타임을 동시에 지원한다. config.toml에 여러 런타임을 등록하고, Kubernetes의 RuntimeClass 리소스를 통해 Pod 단위로 런타임을 선택할 수 있다.

#### 지원 런타임 종류

| 런타임 | 격리 수준 | 특징 | 사용 사례 |
|--------|----------|------|----------|
| **runc** | Linux namespace + cgroup | 기본 OCI runtime이다. 호스트 커널을 공유한다 | 일반적인 워크로드 |
| **kata-containers** | 경량 VM (QEMU/Cloud Hypervisor) | 각 Pod가 독립된 커널과 VM에서 실행된다. 보안 격리가 강력하다 | 멀티테넌트, 보안 민감 워크로드 |
| **gVisor (runsc)** | 사용자 공간 커널 에뮬레이션 | Sentry라는 사용자 공간 커널이 syscall을 가로채어 처리한다 | 신뢰할 수 없는 코드 실행, 보안 강화 |
| **youki** | Linux namespace + cgroup | Rust로 작성된 OCI runtime이다. runc의 대안이다 | 성능, 메모리 안전성 |
| **crun** | Linux namespace + cgroup | C 언어로 작성된 경량 OCI runtime이다. runc보다 빠르고 메모리 사용량이 적다 | 고성능, 리소스 제약 환경 |

#### Kubernetes RuntimeClass 연동

containerd의 런타임 설정과 Kubernetes의 RuntimeClass를 함께 사용하면, Pod spec에서 원하는 런타임을 지정할 수 있다:

```
                                      ┌──────────────────────────┐
                                      │   containerd config.toml  │
                                      │                          │
Pod spec:                             │   runtimes:              │
  runtimeClassName: kata  ──────────► │     runc ──► runc binary │
                                      │     kata ──► kata-runtime│
                                      │     gvisor ► runsc binary│
                                      └──────────────────────────┘
                                              │
                                              ▼
                                      kata-containers VM에서
                                      Pod가 실행된다
```

---

### NRI (Node Resource Interface)

NRI(Node Resource Interface)는 containerd의 플러그인 프레임워크로, 컨테이너 생명주기 이벤트에 훅(hook)을 걸어 외부 플러그인이 개입할 수 있게 한다. CRI 요청 처리 과정에서 NRI 플러그인이 호출되어 컨테이너 spec을 수정하거나 리소스를 할당할 수 있다.

#### NRI 플러그인이 개입할 수 있는 이벤트

| 이벤트 | 설명 |
|--------|------|
| `RunPodSandbox` | Pod sandbox가 생성될 때 호출된다 |
| `StopPodSandbox` | Pod sandbox가 중지될 때 호출된다 |
| `RemovePodSandbox` | Pod sandbox가 삭제될 때 호출된다 |
| `CreateContainer` | 컨테이너가 생성될 때 호출된다. spec을 수정할 수 있다 |
| `StartContainer` | 컨테이너가 시작될 때 호출된다 |
| `UpdateContainer` | 컨테이너 리소스가 업데이트될 때 호출된다 |
| `StopContainer` | 컨테이너가 중지될 때 호출된다 |
| `RemoveContainer` | 컨테이너가 삭제될 때 호출된다 |
| `PostCreateContainer` | 컨테이너 생성 후 호출된다 |
| `PostStartContainer` | 컨테이너 시작 후 호출된다 |

#### NRI 사용 사례

1. **Device Assignment**: GPU, FPGA, SR-IOV NIC 등의 장치를 컨테이너에 자동 할당한다
2. **Topology-Aware Scheduling**: NUMA 토폴로지를 고려하여 CPU와 메모리를 할당한다
3. **Resource Adjustment**: 컨테이너 생성 시 cgroup 파라미터를 동적으로 조정한다
4. **Security Policy Enforcement**: 컨테이너 spec을 검증하고 보안 정책에 따라 수정한다
5. **Network Configuration**: Pod별로 커스텀 네트워크 설정을 적용한다

```toml
# NRI 활성화 설정 (config.toml)
[plugins."io.containerd.nri.v1.nri"]
  disable = false
  disable_connections = false
  plugin_config_path = "/etc/nri/conf.d"
  plugin_path = "/opt/nri/plugins"
  plugin_registration_timeout = "5s"
  plugin_request_timeout = "2s"
  socket_path = "/var/run/nri/nri.sock"
```

---

### Transfer Service

containerd 2.0에서 도입된 Transfer Service는 이미지 전송(pull/push)을 위한 새로운 통합 메커니즘이다. 기존에는 이미지 pull이 클라이언트 라이브러리에 의존했지만, Transfer Service는 서버 측에서 전송을 관리한다.

#### 주요 특징

1. **서버 측 전송**: 이미지 pull/push 로직이 containerd 서버에서 실행되므로, 클라이언트는 전송 요청만 보내면 된다. 이로 인해 클라이언트 구현이 단순해진다.

2. **스트리밍 지원**: 대용량 이미지 전송 시 스트리밍 방식으로 처리하여 메모리 효율이 높다. 전체 이미지를 메모리에 로드하지 않는다.

3. **Proxy 지원**: 중간 프록시를 통해 이미지를 전송할 수 있다. 에어갭(air-gap) 환경이나 레지스트리 미러링에 유용하다.

4. **진행률 추적**: 전송 진행률을 실시간으로 조회할 수 있는 API를 제공한다.

```
기존 방식 (containerd 1.x):
Client Library ──── 직접 Registry와 통신 ────► Registry
     │
     ▼
  Content Store에 저장

Transfer Service 방식 (containerd 2.0):
Client ──── Transfer(request) ────► containerd Transfer Service ──► Registry
                                         │
                                         ▼
                                    Content Store에 저장
                                    (서버 측에서 완료)
```

---

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
