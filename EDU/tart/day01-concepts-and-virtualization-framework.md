# Day 1: 개념 및 Virtualization.framework 심층 분석

> Tart의 기본 개념, Apple Virtualization.framework의 핵심 클래스 구조, 부트로더, 네트워크/디스크/파일 공유 구성, macOS 버전별 API, 성능 분석을 다룬다.

## 개념

### Tart란?
- Apple Silicon(M1/M2/M3/M4) 전용 가상머신 관리 도구이다
- Apple **Virtualization.framework**를 사용하는 Type 2 Hypervisor이다 (Hypervisor.framework가 아님에 주의)
- OCI(Open Container Initiative) 호환 이미지 형식으로 VM을 저장하고 배포한다
- CLI 기반으로 VM 생성, 실행, 관리, 레지스트리 push/pull이 가능하다
- macOS 13.0 (Ventura) 이상에서 동작하며, Swift로 작성되었다
- Cirrus Labs에서 개발하였으며, 오픈소스(Fair Source License)로 공개되어 있다

### Virtualization.framework vs Hypervisor.framework

Tart는 Apple의 **Virtualization.framework**를 사용한다. 두 프레임워크의 차이는 다음과 같다.

| 구분 | Virtualization.framework | Hypervisor.framework |
|------|--------------------------|----------------------|
| 추상화 수준 | 고수준 API이다 | 저수준 API이다 |
| 용도 | 완전한 VM 환경을 제공한다 | CPU 가상화만 제공한다 |
| 제공 기능 | 가상 디스크, 네트워크, GPU, 디스플레이, 공유 디렉토리 등을 포함한다 | vCPU와 메모리 매핑만 제공하며, 나머지는 직접 구현해야 한다 |
| 사용 사례 | Tart, UTM(일부) 등에서 사용한다 | QEMU, Docker Desktop 등에서 사용한다 |
| M1 최적화 | Apple Silicon과 함께 설계되어 네이티브 성능을 제공한다 | 범용적이지만 추가 구현이 필요하다 |

Virtualization.framework는 Apple이 M1 칩과 함께 도입한 고수준 가상화 프레임워크이다. VM에 필요한 가상 하드웨어(디스크, 네트워크 인터페이스, 디스플레이, 공유 파일 시스템 등)를 모두 내장하고 있어, Tart는 이 프레임워크 위에서 VM 라이프사이클 관리와 OCI 이미지 통합에 집중할 수 있다.

### 핵심 개념

| 개념 | 설명 |
|------|------|
| Virtualization.framework | Apple이 제공하는 고수준 네이티브 가상화 API이다. VM에 필요한 전체 하드웨어 스택을 추상화한다 |
| OCI Image | 컨테이너 이미지 표준(Open Container Initiative)으로, Tart VM 이미지도 이 형식을 따른다. Docker Hub, GHCR 등의 레지스트리에 push/pull이 가능하다 |
| Golden Image | 사전 구성된 기본 VM 이미지로, 모든 VM의 템플릿 역할을 한다. `tart clone`으로 복제하여 사용한다 |
| Headless Mode | GUI(VNC 디스플레이) 없이 VM을 실행하는 모드이다. CI/CD 환경에서 주로 사용한다 |
| Softnet | Tart 전용 네트워크 격리 모드이다. VM 간 통신과 호스트 접근을 차단한다 |
| VirtioFS | Apple Virtualization.framework가 제공하는 파일 공유 프로토콜이다. 호스트와 게스트 간 디렉토리를 공유한다 |

### OCI 이미지 형식

Tart는 VM 디스크 이미지를 OCI(Open Container Initiative) 형식으로 저장한다. 이는 Docker 컨테이너 이미지와 동일한 표준을 따르는 것이다.

- VM 이미지는 OCI manifest, config, layer로 구성된다
- 디스크 이미지는 layer로 압축되어 레지스트리에 저장된다
- `tart push`/`tart pull` 명령으로 Docker Hub, GHCR, ACR 등 모든 OCI 호환 레지스트리와 연동할 수 있다
- 태그 기반 버전 관리가 가능하다 (예: `ghcr.io/cirruslabs/ubuntu:latest`)
- 로컬 캐시는 `~/.tart/cache/OCIs/` 경로에 저장된다
- 자동 정리(pruning) 기능이 있어 `tart pull`과 `tart clone` 시 오래된 캐시를 제거한다. 기본 제한은 100GB이며, `TART_NO_AUTO_PRUNE` 환경변수로 비활성화할 수 있다

### Rosetta 지원

Tart는 Linux VM에서 Apple의 Rosetta 2 번역 레이어를 활용할 수 있다.

- Linux VM 내에서 x86_64(AMD64) 바이너리를 ARM64 환경에서 실행할 수 있다
- `tart run --rosetta` 플래그로 활성화한다
- 게스트 Linux에서 Rosetta를 마운트하면 x86_64 바이너리를 투명하게 실행할 수 있다
- Docker의 `--platform linux/amd64` 이미지를 ARM64 VM에서 실행할 때 유용하다

### 디스크 관리

Tart의 VM 데이터는 로컬 파일 시스템에 저장된다.

| 경로 | 용도 |
|------|------|
| `~/.tart/vms/` | 로컬 VM 이미지가 저장되는 디렉토리이다. 각 VM은 하위 디렉토리로 존재한다 |
| `~/.tart/cache/OCIs/` | 레지스트리에서 pull한 원격 이미지의 캐시이다 |
| `/var/db/dhcpd_leases` | macOS vmnet의 DHCP 임대 정보가 저장되는 파일이다 |

- `tart set` 명령의 `--disk-size` 옵션으로 디스크 크기를 조정할 수 있다
- macOS VM의 디스크 축소는 Recovery Mode에서 수동으로 파티션을 조정해야 한다
- Linux VM의 디스크 확장은 `tart set`으로 크기를 늘린 후 게스트 내에서 파티션을 확장하면 된다

### 네트워킹

Tart는 세 가지 네트워크 모드를 지원한다.

| 모드 | 설명 | 사용 시나리오 |
|------|------|---------------|
| Shared (NAT) | 기본 모드이다. VM이 호스트의 NAT를 통해 외부에 접근한다 | 일반적인 개발 환경에 적합하다 |
| Bridged | VM이 호스트와 동일한 네트워크에 직접 연결된다 | VM에 외부에서 직접 접근해야 할 때 사용한다 |
| Softnet | 격리된 네트워크이다. VM 간 통신과 호스트 접근을 차단한다 | 보안이 중요한 CI/CD 환경에 적합하다 |

**IP 할당 메커니즘:**
- Shared(NAT) 모드에서는 macOS의 `vmnet` 프레임워크가 DHCP를 제공한다
- 기본 서브넷은 `192.168.64.0/24`이다
- DHCP 임대 기간은 기본 86,400초(1일)이다
- 서브넷 설정은 `/Library/Preferences/SystemConfiguration/com.apple.vmnet.plist`에서 변경할 수 있다
- DHCP 임대 기간은 `/Library/Preferences/com.apple.InternetSharing.default.plist`에서 조정할 수 있다
- `tart ip <vm-name>` 명령으로 VM의 IP를 확인한다
- Bridged 모드에서는 `tart ip --resolver=arp` 옵션을 사용하여 ARP 테이블에서 IP를 조회한다
- 호스트에서 라우터 IP는 `netstat -nr | awk '/default/{print $2; exit}'`로 확인할 수 있다

### 공유 디렉토리 (Directory Sharing)

Tart는 VirtioFS를 통해 호스트와 게스트 간 디렉토리를 공유할 수 있다.

```bash
# 읽기/쓰기 모드로 디렉토리 공유
tart run --dir=project:~/src/project my-vm

# 읽기 전용 모드로 디렉토리 공유
tart run --dir=project:~/src/project:ro my-vm
```

- **macOS 게스트**: 자동으로 `/Volumes/My Shared Files/` 경로에 마운트된다
- **Linux 게스트**: 수동으로 `mount -t virtiofs project /mnt/project` 명령으로 마운트해야 한다

### 아키텍처
```
┌──────────────────────────────────────────────┐
│          macOS Host (Apple Silicon)           │
├──────────────────────────────────────────────┤
│  Tart CLI                                    │
│  ├── VM Lifecycle (create/clone/run/stop)     │
│  ├── OCI Registry (push/pull/login)           │
│  └── VM Config (set cpu/memory/disk)          │
├──────────────────────────────────────────────┤
│  Apple Virtualization.framework               │
│  ├── Virtual CPU / Memory                     │
│  ├── Virtual Disk (raw disk image)            │
│  ├── Virtual Network (vmnet)                  │
│  ├── VirtioFS (shared directories)            │
│  └── Virtual Display (VNC)                    │
├──────────────────────────────────────────────┤
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐        │
│  │ VM 1 │ │ VM 2 │ │ VM 3 │ │ VM 4 │        │
│  │(ARM) │ │(ARM) │ │(ARM) │ │(ARM) │        │
│  └──────┘ └──────┘ └──────┘ └──────┘        │
├──────────────────────────────────────────────┤
│  Storage: ~/.tart/vms/    Cache: ~/.tart/cache│
└──────────────────────────────────────────────┘
```

### Nested Virtualization

- M3/M4 칩에서 macOS 15 이상을 실행할 때만 지원된다
- `tart run --nested` 플래그로 활성화한다
- VM 내부에서 또 다른 VM을 실행할 수 있다

---

### 이 프로젝트에서의 실습 환경

이 프로젝트(tart-infra)에서 Tart는 전체 인프라의 기반이다. Terraform의 `tart` 프로바이더를 통해 VM을 선언적으로 관리하며, 기본 계정은 `admin`/`admin`이다.

```
프로젝트 구조:
├── config/clusters.json     ← 4개 클러스터 정의 (platform, dev, staging, prod)
├── scripts/install.sh       ← 전체 설치 스크립트
├── scripts/install/
│   ├── 01-create-vms.sh     ← Tart VM 생성
│   └── ...
├── scripts/boot.sh          ← 기존 VM 부팅
├── scripts/shutdown.sh      ← VM 종료
└── scripts/destroy.sh       ← VM 삭제
```

| 클러스터 | 마스터 | 워커 | 용도 |
|---------|--------|------|------|
| platform | 1 (2CPU/4GB) | 2 (3CPU/12GB + 2CPU/8GB) | 모니터링, CI/CD |
| dev | 1 (2CPU/4GB) | 1 (2CPU/8GB) | 데모 앱, Istio, 부하 테스트 |
| staging | 1 (2CPU/4GB) | 1 (2CPU/8GB) | 사전 검증 |
| prod | 1 (2CPU/3GB) | 2 (2CPU/8GB each) | 프로덕션 |

- 총 10개 VM이 macOS Apple Silicon 호스트에서 실행된다
- 기본 이미지: `ghcr.io/cirruslabs/ubuntu:latest`
- Golden Image(`k8s-golden`) 사용 시 설치 시간을 45분→15분으로 단축할 수 있다
- VM 관리 명령: `./scripts/boot.sh` (시작), `./scripts/shutdown.sh` (종료), `./scripts/status.sh` (상태 확인)

---

## Virtualization.framework 심층 분석

### Apple Hypervisor.framework와의 내부 관계

Virtualization.framework는 내부적으로 Hypervisor.framework를 사용하는 구조이다. 두 프레임워크의 관계를 계층적으로 나타내면 다음과 같다.

```
┌─────────────────────────────────────────────┐
│         Application Layer (Tart)             │
├─────────────────────────────────────────────┤
│     Virtualization.framework (고수준)         │
│     ├── VZVirtualMachine                     │
│     ├── VZVirtualMachineConfiguration        │
│     ├── VZVirtioNetworkDeviceConfiguration   │
│     ├── VZVirtioBlockDeviceConfiguration     │
│     └── VZVirtioFileSystemDeviceConfiguration│
├─────────────────────────────────────────────┤
│     Hypervisor.framework (저수준)             │
│     ├── hv_vcpu_create()                     │
│     ├── hv_vcpu_run()                        │
│     ├── hv_vm_map()                          │
│     └── hv_vm_protect()                      │
├─────────────────────────────────────────────┤
│     macOS Kernel (XNU)                       │
│     └── Apple Silicon Hardware Virtualization │
└─────────────────────────────────────────────┘
```

Hypervisor.framework는 CPU 가상화(vCPU 생성, 레지스터 접근, 메모리 매핑)만을 제공하는 저수준 API이다. QEMU, Docker Desktop 등은 이 프레임워크를 직접 사용하여 가상 디바이스를 직접 에뮬레이션한다. 반면 Virtualization.framework는 Hypervisor.framework 위에 가상 하드웨어 스택 전체를 구축한 고수준 API이다. 개발자가 Virtualization.framework를 사용하면 Hypervisor.framework를 직접 다룰 필요가 없다. Apple이 내부적으로 두 프레임워크 간의 연동을 관리하기 때문이다.

이 구조 덕분에 Tart는 가상 하드웨어 에뮬레이션을 신경 쓸 필요 없이, VM 라이프사이클 관리와 OCI 이미지 통합이라는 상위 레벨의 기능에만 집중할 수 있다.

### 핵심 클래스 구조

Virtualization.framework의 핵심은 `VZVirtualMachine`과 `VZVirtualMachineConfiguration` 두 클래스이다.

#### VZVirtualMachineConfiguration

VM의 전체 하드웨어 구성을 정의하는 클래스이다. Tart에서 `tart set` 명령으로 설정하는 모든 값이 이 Configuration 객체에 매핑된다.

```swift
// Tart 내부에서 구성하는 Configuration의 개념적 구조
let config = VZVirtualMachineConfiguration()

// CPU 설정
config.cpuCount = 4                          // tart set --cpu 4
config.memorySize = 8 * 1024 * 1024 * 1024   // tart set --memory 8192 (8GB)

// 부트로더 설정 (Linux vs macOS)
config.bootLoader = VZLinuxBootLoader(...)    // Linux VM인 경우
// 또는
config.bootLoader = VZMacOSBootLoader()      // macOS VM인 경우

// 디바이스 구성
config.storageDevices = [diskConfig]          // 디스크
config.networkDevices = [networkConfig]       // 네트워크
config.directorySharingDevices = [shareConfig] // VirtioFS 공유
config.pointingDevices = [pointingConfig]     // 마우스/트랙패드
config.keyboards = [keyboardConfig]           // 키보드
```

주요 프로퍼티는 다음과 같다.

| 프로퍼티 | 타입 | 설명 |
|---------|------|------|
| `cpuCount` | `Int` | 가상 CPU 코어 수이다. 최소 1, 최대는 호스트 물리 코어 수이다 |
| `memorySize` | `UInt64` | 메모리 크기(바이트)이다. 최소 512MB이다 |
| `bootLoader` | `VZBootLoader` | 부트로더이다. Linux 또는 macOS 타입을 지정한다 |
| `storageDevices` | `[VZStorageDeviceConfiguration]` | 가상 디스크 목록이다 |
| `networkDevices` | `[VZNetworkDeviceConfiguration]` | 가상 NIC 목록이다 |
| `directorySharingDevices` | `[VZDirectorySharingDeviceConfiguration]` | 공유 디렉토리 목록이다 |
| `entropyDevices` | `[VZEntropyDeviceConfiguration]` | 엔트로피(난수) 소스이다 |
| `serialPorts` | `[VZSerialPortConfiguration]` | 시리얼 포트이다 |

#### VZVirtualMachine

Configuration으로부터 실제 VM 인스턴스를 생성하고 실행하는 클래스이다.

```swift
let vm = VZVirtualMachine(configuration: config)

// VM 상태 전이
vm.start(completionHandler: { error in ... })  // 시작
vm.pause(completionHandler: { error in ... })  // 일시정지
vm.resume(completionHandler: { error in ... }) // 재개
vm.stop(completionHandler: { error in ... })   // 정지

// 상태 확인
vm.state  // .stopped, .running, .paused, .error, .starting, .stopping 등
```

VZVirtualMachine의 상태 전이 다이어그램은 다음과 같다.

```
                  ┌────────────┐
                  │   Stopped   │◄──────────────────┐
                  └──────┬─────┘                    │
                         │ start()                  │ stop() / error
                         ▼                          │
                  ┌────────────┐              ┌─────┴──────┐
                  │  Starting   │─────────────►│  Running    │
                  └────────────┘              └──────┬─────┘
                                                     │ pause()
                                                     ▼
                                              ┌────────────┐
                                              │   Paused    │
                                              └──────┬─────┘
                                                     │ resume()
                                                     ▼
                                              ┌────────────┐
                                              │  Running    │
                                              └────────────┘
```

### VZLinuxBootLoader vs VZMacOSBootLoader

Tart는 Linux VM과 macOS VM을 모두 지원하며, 각각 다른 부트로더를 사용한다.

**VZLinuxBootLoader:**
- Linux 커널을 직접 지정하여 부팅하는 방식이다
- 커널 이미지(`vmlinux`), initrd(초기 RAM 디스크), 커널 커맨드 라인을 지정한다
- EFI 부트로더 없이 커널을 직접 로드하므로 부팅이 빠르다

```swift
let bootLoader = VZLinuxBootLoader(kernelURL: kernelURL)
bootLoader.initialRamdiskURL = initrdURL
bootLoader.commandLine = "console=hvc0 root=/dev/vda1"
```

**VZEFIBootLoader (macOS VM에서 사용):**
- macOS 13(Ventura)부터 도입된 EFI 기반 부트로더이다
- NVRAM(비휘발성 메모리)에 부팅 설정을 저장한다
- macOS VM의 경우 IPSW(Apple의 macOS 복원 이미지)에서 OS를 설치한다
- `VZMacOSInstaller`를 통해 설치 과정을 자동화할 수 있다

```swift
let bootLoader = VZEFIBootLoader()
bootLoader.variableStore = VZEFIVariableStore(url: nvramURL)
```

| 항목 | VZLinuxBootLoader | VZEFIBootLoader (macOS) |
|------|-------------------|--------------------------|
| 대상 OS | Linux | macOS |
| 부팅 방식 | 커널 직접 로드이다 | EFI 부트 체인을 따른다 |
| NVRAM | 불필요하다 | 필수이다 (nvram 파일 저장) |
| 설치 방식 | 이미지 pull 후 즉시 사용이다 | IPSW에서 설치 과정이 필요하다 |
| 부팅 속도 | 매우 빠르다 (수 초) | 상대적으로 느리다 (십여 초) |

### VZVirtioNetworkDeviceConfiguration (vmnet 통합)

VM의 네트워크 인터페이스를 정의하는 클래스이다. Tart에서 `--net-bridged`, `--net-softnet` 등의 옵션으로 제어하는 것이 이 Configuration에 해당한다.

```swift
let networkConfig = VZVirtioNetworkDeviceConfiguration()

// NAT 모드 (기본)
networkConfig.attachment = VZNATNetworkDeviceAttachment()

// Bridged 모드
let interface = VZBridgedNetworkInterface.networkInterfaces.first!
networkConfig.attachment = VZBridgedNetworkDeviceAttachment(interface: interface)

// MAC 주소 설정
networkConfig.macAddress = VZMACAddress.randomLocallyAdministered()
```

vmnet.framework와의 통합 관계는 다음과 같다.

```
┌─────────────────────┐     ┌─────────────────────┐
│  Virtualization.fw   │     │    vmnet.framework    │
│                     │     │                       │
│  VZVirtioNetwork    │────►│  vmnet_start_interface│
│  DeviceConfig       │     │  vmnet_read           │
│                     │     │  vmnet_write          │
│  VZNATNetwork       │────►│  VMNET_SHARED_MODE    │
│  DeviceAttachment   │     │                       │
│                     │     │  VMNET_BRIDGED_MODE   │
│  VZBridgedNetwork   │────►│                       │
│  DeviceAttachment   │     │  DHCP Server          │
└─────────────────────┘     │  (192.168.64.0/24)    │
                            └─────────────────────┘
```

Tart는 `VZNATNetworkDeviceAttachment`를 기본으로 사용하며, 이것이 내부적으로 vmnet.framework의 `VMNET_SHARED_MODE`를 활성화한다. vmnet이 자체 DHCP 서버를 운영하여 VM에 IP를 할당한다.

### VZVirtioBlockDeviceConfiguration (디스크 I/O)

VM의 가상 디스크를 정의하는 클래스이다. Tart VM의 디스크 이미지(`disk.img`)가 이 Configuration을 통해 VM에 연결된다.

```swift
// 디스크 이미지 열기
let diskImageAttachment = try VZDiskImageStorageDeviceAttachment(
    url: diskImageURL,
    readOnly: false,
    cachingMode: .automatic,  // macOS가 캐싱 전략을 자동 결정
    synchronizationMode: .full // 데이터 무결성 보장
)

let blockDevice = VZVirtioBlockDeviceConfiguration(attachment: diskImageAttachment)
config.storageDevices = [blockDevice]
```

주요 설정 옵션은 다음과 같다.

| 옵션 | 값 | 설명 |
|------|---|------|
| `cachingMode` | `.automatic` | macOS가 최적의 캐싱 전략을 자동으로 선택한다 |
| | `.cached` | 호스트 OS가 디스크 I/O를 캐싱한다. 성능은 좋지만 정전 시 데이터 손실 위험이 있다 |
| | `.uncached` | 캐싱하지 않는다. 데이터 무결성이 보장되지만 성능이 낮다 |
| `synchronizationMode` | `.full` | 모든 쓰기 요청이 물리 디스크에 동기화된다 |
| | `.none` | 동기화를 수행하지 않는다 |

Tart의 디스크 이미지는 raw 포맷(`.img`)을 사용한다. qcow2 같은 COW(Copy-on-Write) 포맷은 사용하지 않는다. raw 포맷의 장점은 I/O 오버헤드가 없다는 것이고, 단점은 디스크 공간을 미리 할당해야 한다는 것이다. 다만 macOS의 APFS 파일 시스템이 sparse file을 지원하므로, 실제로 데이터가 기록된 부분만 물리적 공간을 차지한다.

### VZVirtioFileSystemDeviceConfiguration (VirtioFS)

호스트와 게스트 간 파일 공유를 위한 VirtioFS 구성 클래스이다. `tart run --dir` 옵션이 이 Configuration에 매핑된다.

```swift
let sharedDirectory = VZSharedDirectory(url: directoryURL, readOnly: false)
let share = VZSingleDirectoryShare(directory: sharedDirectory)

let fsConfig = VZVirtioFileSystemDeviceConfiguration(tag: "project")
fsConfig.share = share

config.directorySharingDevices = [fsConfig]
```

VirtioFS의 특성은 다음과 같다.

| 특성 | 설명 |
|------|------|
| 프로토콜 | FUSE over Virtio이다. 호스트에서 FUSE 데몬이 동작한다 |
| 성능 | NFS, SMB보다 훨씬 빠르다. near-native 파일 시스템 성능을 제공한다 |
| 일관성 | 호스트와 게스트 간 파일 변경이 즉시 반영된다 |
| 지원 FS | 호스트의 어떤 파일 시스템이든 공유할 수 있다 (APFS, HFS+ 등) |
| 제한사항 | macOS 게스트는 자동 마운트되지만, Linux 게스트는 수동 마운트가 필요하다 |

### VZUSBScreenCoordinatePointingDeviceConfiguration

GUI 모드에서 마우스/트랙패드 입력을 VM에 전달하는 구성이다. Headless 모드(`--no-graphics`)에서는 사용되지 않는다.

```swift
let pointingDevice = VZUSBScreenCoordinatePointingDeviceConfiguration()
config.pointingDevices = [pointingDevice]
```

이 클래스는 USB HID(Human Interface Device) 규격을 따르는 포인팅 디바이스를 에뮬레이션한다. VNC를 통해 VM에 접속할 때 마우스 커서의 위치를 절대 좌표로 전달하여, 호스트와 게스트 간 커서 위치가 정확하게 동기화된다.

### macOS 버전별 API 추가 기능

Virtualization.framework는 macOS 버전이 올라갈 때마다 새로운 기능이 추가되고 있다.

#### macOS 13 Ventura (2022)

| 추가 기능 | 설명 |
|-----------|------|
| VZEFIBootLoader | EFI 부팅을 지원하여 macOS VM 생성이 가능해졌다 |
| VZMacOSInstaller | IPSW 파일에서 macOS를 자동 설치하는 API이다 |
| VZVirtioFileSystemDeviceConfiguration | VirtioFS 파일 공유가 도입되었다 |
| VZMacGraphicsDeviceConfiguration | macOS VM에서 GPU 가속 디스플레이를 지원한다 |
| Rosetta 지원 | Linux VM에서 x86_64 바이너리 실행이 가능해졌다 |
| VZLinuxRosettaDirectoryShare | Rosetta 바이너리를 VM에 공유하는 API이다 |

#### macOS 14 Sonoma (2023)

| 추가 기능 | 설명 |
|-----------|------|
| VZMacHardwareModel 개선 | 더 많은 Mac 하드웨어 모델을 에뮬레이션한다 |
| 네트워크 성능 개선 | vmnet 프레임워크의 내부 최적화가 이루어졌다 |
| VZVirtioSoundDeviceConfiguration 개선 | 오디오 입출력 품질이 향상되었다 |
| 메모리 Balloon 지원 개선 | 동적 메모리 조절이 더 안정적으로 동작한다 |
| 클립보드 공유 | 호스트와 게스트 간 클립보드 동기화가 가능해졌다 |

#### macOS 15 Sequoia (2024)

| 추가 기능 | 설명 |
|-----------|------|
| Nested Virtualization | M3/M4 칩에서 VM 내부에 또 다른 VM을 실행할 수 있다 |
| VZGenericPlatformConfiguration 개선 | Linux VM의 플랫폼 에뮬레이션이 개선되었다 |
| NVME 디바이스 지원 | VZNVMExpressControllerDeviceConfiguration이 추가되었다 |
| USB 디바이스 지원 확대 | USB 3.0 대용량 저장장치를 VM에 연결할 수 있다 |
| 네트워크 격리 개선 | Softnet 모드의 격리 수준이 강화되었다 |

### 성능: near-native 특성과 overhead 분석

Virtualization.framework는 하드웨어 가상화(Hardware-assisted virtualization)를 사용하므로, 소프트웨어 에뮬레이션 대비 극히 적은 오버헤드만 발생한다.

**CPU 성능:**
- Apple Silicon의 하드웨어 가상화 지원(EL2, Exception Level 2)을 직접 활용한다
- VM Exit(게스트에서 호스트로의 전환) 빈도가 최소화되어 있다
- 벤치마크 결과 네이티브 대비 **95~99%** 수준의 CPU 성능을 보인다
- ARM 명령어를 번역 없이 네이티브로 실행하므로, Intel의 VT-x와 유사한 수준의 효율성을 제공한다

**메모리 성능:**
- Stage-2 Address Translation을 하드웨어에서 처리한다
- TLB(Translation Lookaside Buffer) 기반의 주소 변환으로 메모리 접근 오버헤드가 거의 없다
- 메모리 대역폭은 네이티브 대비 **98%** 이상이다

**디스크 I/O 성능:**
- Virtio 블록 디바이스를 사용하여 준가상화(paravirtualization) 방식으로 동작한다
- raw 디스크 포맷 사용으로 이미지 포맷 변환 오버헤드가 없다
- 호스트 SSD의 성능을 거의 그대로 활용할 수 있다
- 순차 읽기/쓰기 기준 네이티브 대비 **90~95%** 수준이다

**네트워크 성능:**
- Virtio 네트워크 디바이스를 사용한다
- vmnet.framework가 커널 수준에서 패킷을 처리하므로 사용자 공간 전환이 최소화된다
- NAT 모드에서의 추가 오버헤드는 미미하다
- 대역폭은 호스트 네트워크 인터페이스의 성능에 의존한다

**오버헤드 비교표:**

| 리소스 | 네이티브 대비 성능 | 주요 오버헤드 원인 |
|--------|-------------------|-------------------|
| CPU 연산 | 95~99% | VM Exit (I/O, 인터럽트 처리 시) |
| 메모리 접근 | 98%+ | Stage-2 주소 변환 |
| 디스크 순차 I/O | 90~95% | Virtio 큐 처리, 호스트 파일 시스템 계층 |
| 디스크 랜덤 I/O | 85~92% | Virtio 큐 처리, 캐시 미스 |
| 네트워크 대역폭 | 90~95% | vmnet 패킷 처리, NAT 변환 |
| 네트워크 레이턴시 | 85~90% | vmnet 큐 지연, NAT 테이블 조회 |

---
