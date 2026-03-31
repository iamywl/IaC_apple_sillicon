# Day 2: 컨테이너 생성 흐름 및 이미지 관리

> 이미지 Pull부터 프로세스 실행까지의 전체 Container Creation Flow, Content Store와 OCI Image Spec, Layer Deduplication, Registry Authentication, Namespace Isolation, Runtime Classes, NRI, Transfer Service를 다룬다.

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

