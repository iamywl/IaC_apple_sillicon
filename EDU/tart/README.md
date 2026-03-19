# Tart - Apple Silicon VM 관리 도구

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

## Tart 내부 아키텍처

### Swift CLI 구조

Tart는 Swift로 작성된 CLI 애플리케이션이다. Swift의 `ArgumentParser` 라이브러리를 사용하여 서브커맨드를 구현하고 있다.

```
tart (main entry point)
├── create      VM을 처음부터 생성한다 (macOS IPSW 또는 Linux ISO에서)
├── clone       기존 이미지를 복제하여 새 VM을 만든다
├── set         VM의 리소스(CPU, 메모리, 디스크)를 변경한다
├── run         VM을 실행한다
├── stop        실행 중인 VM을 정지한다
├── delete      VM을 삭제한다
├── list        로컬 VM 목록을 출력한다
├── ip          VM의 IP 주소를 조회한다
├── pull        OCI 레지스트리에서 이미지를 다운로드한다
├── push        로컬 VM을 OCI 레지스트리에 업로드한다
├── login       OCI 레지스트리에 인증한다
├── prune       사용하지 않는 캐시를 정리한다
└── get         VM의 현재 설정을 JSON으로 출력한다
```

각 서브커맨드는 독립적인 Swift 파일로 구현되어 있으며, 공통 로직(VM 경로 관리, OCI 이미지 처리, 네트워크 설정 등)은 별도의 모듈로 분리되어 있다. Tart의 코드 구조는 다음과 같다.

```
tart/
├── Sources/
│   ├── tart/
│   │   ├── Commands/           ← CLI 서브커맨드 구현
│   │   │   ├── Create.swift
│   │   │   ├── Clone.swift
│   │   │   ├── Run.swift
│   │   │   ├── Set.swift
│   │   │   └── ...
│   │   ├── VM/                 ← VM 관리 로직
│   │   │   ├── VMDirectory.swift
│   │   │   ├── VMConfig.swift
│   │   │   └── VMStorageLocal.swift
│   │   ├── OCI/                ← OCI 이미지 처리
│   │   │   ├── OCIRegistry.swift
│   │   │   ├── OCIManifest.swift
│   │   │   └── Layerizer.swift
│   │   └── Network/            ← 네트워크 관리
│   │       ├── Softnet.swift
│   │       └── IPResolver.swift
│   └── ...
└── Package.swift               ← Swift Package Manager 의존성 정의
```

### VM 상태 머신

Tart VM의 라이프사이클은 명확한 상태 머신으로 표현할 수 있다.

```
    tart clone / create          tart run              tart stop / error
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│ (없음)    │───►│ Created   │───►│ Running   │───►│ Stopped   │
└──────────┘    └──────────┘    └──────────┘    └─────┬────┘
                     ▲                                 │
                     │              tart run            │
                     │◄────────────────────────────────┘
                     │
                     │              tart delete
                     └──────────────────────────────────►  (삭제됨)
```

각 상태에서 가능한 작업은 다음과 같다.

| 현재 상태 | 가능한 명령 | 결과 상태 |
|-----------|------------|-----------|
| (없음) | `tart clone`, `tart create` | Created |
| Created | `tart run` | Running |
| Created | `tart set` | Created (설정 변경) |
| Created | `tart delete` | (삭제) |
| Running | `tart stop` | Stopped |
| Running | `tart ip` | Running (IP 조회) |
| Stopped | `tart run` | Running |
| Stopped | `tart set` | Stopped (설정 변경) |
| Stopped | `tart delete` | (삭제) |
| Stopped | `tart push` | Stopped (레지스트리 업로드) |

중요한 점은 `tart set` 명령은 VM이 **정지 상태**일 때만 실행할 수 있다는 것이다. 실행 중인 VM의 리소스를 변경하려면 먼저 `tart stop`으로 정지해야 한다.

### OCI 이미지 레이어 관리

Tart는 VM 이미지를 OCI(Open Container Initiative) 표준에 맞춰 저장하고 배포한다. Docker 컨테이너 이미지와 동일한 형식이므로, 기존의 컨테이너 레지스트리(Docker Hub, GHCR, ACR 등)를 그대로 활용할 수 있다.

OCI 이미지의 구성 요소는 다음과 같다.

```
OCI Image
├── manifest.json         ← 이미지 메타데이터: 레이어 목록, 설정 참조
├── config.json           ← VM 설정: CPU, 메모리, OS 유형 등
└── layers/
    ├── disk.img.gz       ← 디스크 이미지 (gzip 압축)
    └── nvram.gz          ← NVRAM 데이터 (macOS VM인 경우, gzip 압축)
```

**manifest.json** 구조:
```json
{
  "schemaVersion": 2,
  "mediaType": "application/vnd.oci.image.manifest.v1+json",
  "config": {
    "mediaType": "application/vnd.oci.image.config.v1+json",
    "digest": "sha256:abc123...",
    "size": 512
  },
  "layers": [
    {
      "mediaType": "application/vnd.oci.image.layer.v1.tar+gzip",
      "digest": "sha256:def456...",
      "size": 2147483648
    }
  ]
}
```

**config.json** 구조 (Tart 고유의 VM 설정):
```json
{
  "os": "linux",
  "arch": "arm64",
  "cpuCount": 2,
  "memorySize": 4294967296,
  "diskSize": 32212254720,
  "macAddress": "7e:05:a1:b2:c3:d4",
  "display": {
    "width": 1024,
    "height": 768
  }
}
```

`tart push` 명령의 내부 동작은 다음과 같다.

1. 로컬 VM의 disk.img를 gzip으로 압축한다
2. 압축된 이미지의 SHA256 해시를 계산한다
3. config.json에 VM 설정을 기록한다
4. manifest.json에 레이어 목록과 config 참조를 기록한다
5. OCI Registry API를 사용하여 레이어 → config → manifest 순서로 업로드한다

`tart pull` 명령은 이 과정의 역순으로 동작한다. 이미 로컬에 존재하는 레이어는 다시 다운로드하지 않으므로, 동일한 베이스 이미지를 공유하는 VM 간에는 중복 다운로드가 발생하지 않는다.

### 로컬 저장소 구조

Tart는 VM 데이터를 `~/.tart/` 디렉토리에 저장한다. 각 VM은 독립적인 디렉토리를 가진다.

```
~/.tart/
├── vms/                          ← 로컬 VM 저장소
│   ├── my-test-vm/
│   │   ├── config.json           ← VM 설정 (CPU, 메모리, 디스크, MAC 주소 등)
│   │   ├── disk.img              ← 디스크 이미지 (raw 포맷)
│   │   └── nvram                 ← NVRAM 데이터 (macOS VM인 경우)
│   ├── platform-master/
│   │   ├── config.json
│   │   └── disk.img
│   └── ...
├── cache/
│   └── OCIs/                     ← OCI 레지스트리 캐시
│       ├── ghcr.io/
│       │   └── cirruslabs/
│       │       └── ubuntu/
│       │           └── latest/
│       │               ├── manifest.json
│       │               ├── config.json
│       │               └── blobs/
│       │                   └── sha256/
│       │                       └── abc123...  ← 레이어 blob
│       └── ...
└── credentials.json              ← 레지스트리 인증 정보
```

`config.json`의 실제 내용은 다음과 같은 형태이다.

```json
{
  "cpuCount": 2,
  "memorySize": 4294967296,
  "os": "linux",
  "arch": "arm64",
  "macAddress": "7e:05:a1:b2:c3:d4",
  "display": {
    "width": 1024,
    "height": 768
  }
}
```

디스크 이미지(`disk.img`)는 sparse file이므로, `ls -la`로 표시되는 크기와 실제 사용 중인 공간이 다를 수 있다. 실제 사용량은 `du -sh`로 확인해야 한다.

```bash
# 표시 크기 (할당된 전체 크기)
ls -lh ~/.tart/vms/my-vm/disk.img
# -rw-r--r--  1 user  staff    20G  Mar 15 10:00 disk.img

# 실제 사용량 (데이터가 기록된 부분만)
du -sh ~/.tart/vms/my-vm/disk.img
# 3.2G    disk.img
```

### Lock 메커니즘

Tart는 동일한 VM에 대한 동시 접근을 방지하기 위해 파일 기반의 Lock 메커니즘을 사용한다. VM이 실행 중일 때 해당 VM의 디렉토리에 lock 파일이 생성되며, 다른 프로세스가 동일한 VM을 실행하거나 수정하려 하면 에러를 반환한다.

```bash
# 이미 실행 중인 VM을 다시 실행하려 하면
$ tart run my-vm --no-graphics
Error: VM 'my-vm' is already in use by another process

# 실행 중인 VM의 설정을 변경하려 하면
$ tart set my-vm --cpu 4
Error: VM 'my-vm' is locked by a running process
```

이 Lock 메커니즘이 중요한 이유는 디스크 이미지의 무결성을 보호하기 위해서이다. 두 프로세스가 동시에 동일한 disk.img를 쓰면 데이터가 손상될 수 있다.

Lock이 비정상적으로 남아 있는 경우(예: Tart 프로세스가 비정상 종료된 경우)에는 VM 디렉토리의 lock 파일을 수동으로 삭제해야 할 수 있다. 하지만 먼저 해당 VM을 사용하는 프로세스가 실제로 없는지 확인해야 한다.

### IP 할당 메커니즘 심화

Tart VM의 IP 할당은 다음의 과정을 거친다.

```
┌──────────┐     ┌───────────────┐     ┌─────────────────┐
│  VM 부팅  │────►│ vmnet 인터페이스│────►│ DHCP Discover    │
│          │     │ 생성           │     │ (브로드캐스트)     │
└──────────┘     └───────────────┘     └────────┬────────┘
                                                 │
                                                 ▼
                                        ┌─────────────────┐
                                        │ vmnet DHCP 서버  │
                                        │ IP 할당          │
                                        │ (192.168.64.x)   │
                                        └────────┬────────┘
                                                 │
                                                 ▼
                                        ┌─────────────────┐
                                        │ DHCP Offer/Ack   │
                                        │ → VM에 IP 할당    │
                                        └────────┬────────┘
                                                 │
                                                 ▼
                                        ┌─────────────────┐
                                        │ /var/db/         │
                                        │ dhcpd_leases     │
                                        │ 에 임대 기록      │
                                        └─────────────────┘
```

`tart ip` 명령은 이 DHCP 임대 파일(`/var/db/dhcpd_leases`)을 파싱하여 VM의 MAC 주소에 매핑된 IP를 찾는다. DHCP 임대 파일의 형식은 다음과 같다.

```
{
    name=my-test-vm
    ip_address=192.168.64.5
    hw_address=1,7e:05:a1:b2:c3:d4
    identifier=...
    lease=0x67890ABC
}
```

**ARP 테이블 기반 IP 조회:**

Bridged 모드에서는 vmnet의 DHCP가 아닌 외부 DHCP 서버(라우터)가 IP를 할당하므로, `/var/db/dhcpd_leases`에 정보가 없다. 이 경우 `tart ip --resolver=arp` 옵션을 사용하여 호스트의 ARP 테이블에서 MAC 주소-IP 매핑을 조회한다.

```bash
# ARP 테이블 확인
arp -a | grep "7e:05:a1:b2:c3:d4"
# ? (192.168.1.105) at 7e:05:a1:b2:c3:d4 on en0 ifscope [ethernet]
```

**임대 관리 관련 주의사항:**
- DHCP 임대는 기본 86,400초(1일)이다
- VM을 삭제해도 임대 레코드는 즉시 삭제되지 않는다
- 동일한 MAC 주소를 가진 VM을 재생성하면 이전 IP를 재할당받을 수 있다
- `tart set --random-mac`으로 MAC 주소를 변경하면 새 IP를 할당받는다
- 서브넷이 가득 차면(254개 이상 동시 임대) IP 할당이 실패할 수 있다

### Packer 플러그인 아키텍처 (packer-plugin-tart)

Packer는 HashiCorp이 개발한 이미지 빌드 자동화 도구이다. `packer-plugin-tart`는 Packer와 Tart를 연동하여 VM 이미지 생성을 자동화하는 플러그인이다.

플러그인 구조는 다음과 같다.

```
Packer
├── Builder (tart-cli)
│   ├── VM 생성 (clone 또는 create from IPSW)
│   ├── VM 설정 (CPU, 메모리, 디스크)
│   ├── VM 시작 (headless)
│   └── SSH 연결 대기
├── Communicator (SSH)
│   ├── Provisioner 실행 (shell, file, ansible 등)
│   └── 파일 전송
└── Post-Processor
    ├── VM 정지
    ├── OCI 이미지 생성
    └── 레지스트리 Push (선택)
```

Packer HCL 설정 파일에서 사용할 수 있는 주요 옵션은 다음과 같다.

| 옵션 | 설명 |
|------|------|
| `vm_name` | 빌드할 VM의 이름이다 |
| `from_ipsw` | macOS IPSW URL이다 (macOS VM 생성 시) |
| `from_iso` | Linux ISO 경로 또는 URL이다 |
| `cpu_count` | vCPU 수이다 |
| `memory_gb` | 메모리 크기(GB)이다 |
| `disk_size_gb` | 디스크 크기(GB)이다 |
| `headless` | GUI 없이 빌드할지 여부이다 |
| `ssh_username` | SSH 사용자명이다 |
| `ssh_password` | SSH 비밀번호이다 |
| `ssh_timeout` | SSH 연결 타임아웃이다 |
| `run_extra_args` | `tart run`에 전달할 추가 인자이다 |
| `create_grace_time` | VM 생성 후 대기 시간이다 |

---

## 네트워킹 심화

### vmnet.framework 내부 구조

vmnet.framework는 Apple이 macOS에 내장한 가상 네트워크 프레임워크이다. Virtualization.framework가 이 프레임워크를 사용하여 VM에 네트워크 인터페이스를 제공한다.

```
┌─────────────────────────────────────────────────┐
│                  macOS Host                      │
│                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │  VM 1    │  │  VM 2    │  │  VM 3    │       │
│  │ eth0     │  │ eth0     │  │ eth0     │       │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘       │
│       │              │              │             │
│  ┌────┴──────────────┴──────────────┴─────┐      │
│  │         vmnet Virtual Switch            │      │
│  │  ┌─────────────────────────────────┐   │      │
│  │  │  DHCP Server                    │   │      │
│  │  │  192.168.64.1 (게이트웨이)       │   │      │
│  │  │  서브넷: 192.168.64.0/24         │   │      │
│  │  └─────────────────────────────────┘   │      │
│  │  ┌─────────────────────────────────┐   │      │
│  │  │  NAT Engine                     │   │      │
│  │  │  호스트 IP ↔ VM IP 변환          │   │      │
│  │  └─────────────────────────────────┘   │      │
│  │  ┌─────────────────────────────────┐   │      │
│  │  │  DNS Proxy                      │   │      │
│  │  │  호스트 DNS 설정을 VM에 전달      │   │      │
│  │  └─────────────────────────────────┘   │      │
│  └────────────────────────────────────────┘      │
│       │                                          │
│  ┌────┴───────┐                                  │
│  │  en0 (WiFi) │  또는 en0 (Ethernet)            │
│  │  물리 NIC   │                                  │
│  └────────────┘                                  │
└─────────────────────────────────────────────────┘
```

vmnet.framework는 세 가지 동작 모드를 지원한다.

| 모드 | vmnet 상수 | 설명 |
|------|-----------|------|
| Shared | `VMNET_SHARED_MODE` | NAT를 통한 외부 접근이다. 가장 일반적인 모드이다 |
| Bridged | `VMNET_BRIDGED_MODE` | 물리 인터페이스에 직접 연결된다 |
| Host-Only | `VMNET_HOST_ONLY_MODE` | 호스트와 VM 간만 통신 가능하다 |

Tart는 이 세 가지 모드를 각각 `--net-shared`(기본), `--net-bridged`, 그리고 Tart 자체 구현인 `--net-softnet`으로 제공한다.

### NAT 모드 상세

NAT(Network Address Translation) 모드는 Tart의 기본 네트워크 모드이다. vmnet.framework가 가상 NAT 라우터 역할을 수행한다.

**네트워크 구성:**

| 항목 | 값 |
|------|---|
| 서브넷 | `192.168.64.0/24` |
| 게이트웨이 | `192.168.64.1` |
| DHCP 범위 | `192.168.64.2` ~ `192.168.64.254` |
| DNS 서버 | `192.168.64.1` (호스트의 DNS 설정을 프록시) |
| 서브넷 마스크 | `255.255.255.0` |

**NAT 동작 원리:**

```
VM (192.168.64.5)                   호스트 (en0: 192.168.1.100)
     │                                       │
     │  패킷: src=192.168.64.5:12345         │
     │         dst=8.8.8.8:443               │
     │                                       │
     ├──────────── vmnet NAT ──────────────►  │
     │                                       │
     │  변환된 패킷: src=192.168.1.100:54321  │
     │              dst=8.8.8.8:443          │
     │                                       │
     │                            ──────────►│  인터넷으로 전송
```

**서브넷 설정 변경:**

기본 서브넷(`192.168.64.0/24`)을 변경해야 하는 경우(예: 호스트 네트워크와 충돌할 때):

```bash
# 현재 vmnet 설정 확인
sudo defaults read /Library/Preferences/SystemConfiguration/com.apple.vmnet.plist

# 서브넷 변경 (예: 172.16.64.0/24로 변경)
sudo defaults write /Library/Preferences/SystemConfiguration/com.apple.vmnet.plist \
    Shared_Net_Address -string "172.16.64.1"
sudo defaults write /Library/Preferences/SystemConfiguration/com.apple.vmnet.plist \
    Shared_Net_Mask -string "255.255.255.0"

# 변경 후 VM을 재시작해야 적용된다
```

**주의사항:**
- NAT 모드에서는 외부에서 VM으로의 직접 접근이 불가능하다
- 호스트에서 VM으로는 `192.168.64.x` 주소로 접근할 수 있다
- VM에서 호스트로는 `192.168.64.1`(게이트웨이)로 접근할 수 있다

### Bridged 모드 상세

Bridged 모드에서는 VM이 호스트의 물리 네트워크 인터페이스에 직접 연결된다. VM은 호스트와 동일한 네트워크에 속하게 되며, 외부에서 VM에 직접 접근할 수 있다.

```bash
# 사용 가능한 인터페이스 확인
networksetup -listallhardwareports

# en0(WiFi)에 브릿지하여 VM 실행
tart run --no-graphics --net-bridged=en0 my-vm

# 유선 이더넷에 브릿지
tart run --no-graphics --net-bridged=en1 my-vm
```

**Bridged 모드의 동작 원리:**

```
외부 네트워크 (192.168.1.0/24)
    │
    ├── 라우터 (192.168.1.1)
    │     │
    │     ├── 호스트 Mac (192.168.1.100) ← en0
    │     │
    │     ├── VM 1 (192.168.1.105) ← vmnet bridged to en0
    │     │
    │     └── VM 2 (192.168.1.106) ← vmnet bridged to en0
    │
    └── 다른 기기들 (192.168.1.x)
```

**ARP 해석:**

Bridged 모드에서 VM은 자신의 MAC 주소로 ARP 응답을 보낸다. 라우터는 VM을 독립적인 네트워크 기기로 인식한다. IP 할당은 외부 DHCP 서버(일반적으로 라우터)가 담당하므로, vmnet의 내장 DHCP는 사용되지 않는다.

```bash
# VM의 IP를 ARP 테이블에서 조회
tart ip --resolver=arp my-vm

# 호스트에서 ARP 테이블 직접 확인
arp -a | grep "7e:05"
```

**주의사항:**
- WiFi에서 Bridged 모드를 사용할 때, 일부 WiFi AP는 MAC 주소 필터링을 수행하여 VM의 패킷을 차단할 수 있다
- 기업 네트워크에서는 802.1X 인증으로 인해 Bridged 모드가 동작하지 않을 수 있다
- Bridged 모드는 호스트의 물리 인터페이스가 활성 상태여야 동작한다

### Softnet 모드 상세

Softnet은 Tart 자체적으로 구현한 격리 네트워크 모드이다. vmnet.framework를 사용하지 않고, Tart가 직접 유저스페이스에서 네트워크 스택을 구현한다.

**Softnet의 특성:**

| 특성 | 설명 |
|------|------|
| 격리 수준 | VM 간 통신이 차단된다. 각 VM은 독립적인 네트워크에 존재한다 |
| 서브넷 | 각 VM에 독립적인 서브넷이 할당된다 |
| 외부 접근 | 기본적으로 차단된다. `--net-softnet-allow` 옵션으로 특정 대역만 허용할 수 있다 |
| root 권한 | 불필요하다. vmnet의 Shared/Bridged 모드와 달리 일반 사용자 권한으로 동작한다 |
| 성능 | vmnet보다 약간 느릴 수 있다 (유저스페이스 구현이므로) |

```bash
# 기본 Softnet 모드 (모든 외부 접근 차단)
tart run --no-graphics --net-softnet my-vm

# 특정 대역으로의 접근만 허용
tart run --no-graphics --net-softnet-allow=10.0.0.0/8 my-vm

# 모든 외부 접근 허용 (이 프로젝트에서 사용하는 방식)
tart run --no-graphics --net-softnet-allow=0.0.0.0/0 my-vm
```

이 프로젝트의 `scripts/lib/vm.sh`에서는 `--net-softnet-allow=0.0.0.0/0` 옵션을 사용한다. 이는 VM 간 네트워크 격리를 유지하면서도 외부 인터넷 접근은 허용하는 설정이다. Kubernetes 클러스터 노드들이 패키지 다운로드 등을 위해 외부 접근이 필요하기 때문이다.

### 포트 포워딩

Softnet 모드에서는 `--net-softnet-allow` 옵션으로 포트 포워딩을 세밀하게 제어할 수 있다.

```bash
# 특정 IP와 포트만 허용
tart run --no-graphics \
    --net-softnet-allow=192.168.1.100:8080 \
    my-vm

# 여러 대역 동시 허용
tart run --no-graphics \
    --net-softnet-allow=10.0.0.0/8 \
    --net-softnet-allow=172.16.0.0/12 \
    my-vm

# CIDR 표기법으로 서브넷 단위 허용
tart run --no-graphics \
    --net-softnet-allow=192.168.64.0/24 \
    my-vm
```

NAT 모드에서의 포트 포워딩은 macOS의 `pfctl`(Packet Filter)을 사용하여 구현할 수 있다.

```bash
# macOS pf를 이용한 포트 포워딩 (NAT 모드에서)
# /etc/pf.anchors/tart-forward 파일 생성:
# rdr pass on lo0 inet proto tcp from any to 127.0.0.1 port 8080 -> 192.168.64.5 port 80

# pf 규칙 로드
sudo pfctl -f /etc/pf.conf
sudo pfctl -e
```

### 다중 NIC 구성

Tart는 하나의 VM에 여러 네트워크 인터페이스를 연결할 수 있다. 여러 `--net-*` 옵션을 조합하여 사용한다.

```bash
# NAT + Bridged 이중 NIC
tart run --no-graphics \
    --net-bridged=en0 \
    my-vm
# 기본 NAT 인터페이스 + Bridged 인터페이스가 동시에 활성화된다

# Softnet + Bridged 조합
tart run --no-graphics \
    --net-softnet-allow=0.0.0.0/0 \
    --net-bridged=en0 \
    my-vm
```

게스트 OS에서는 여러 인터페이스가 `enp0s1`, `enp0s2` 등으로 나타난다. 각 인터페이스를 확인하고 설정하는 방법은 다음과 같다.

```bash
# 게스트 내에서 네트워크 인터페이스 확인
ip addr show

# 특정 인터페이스에 고정 IP 설정 (netplan 사용)
sudo vim /etc/netplan/01-netcfg.yaml
```

### DNS 해석

VM 내부에서의 DNS 해석은 네트워크 모드에 따라 다르게 동작한다.

**NAT 모드:**
- vmnet의 DHCP 서버가 DNS 서버 주소로 `192.168.64.1`을 전달한다
- `192.168.64.1`에서 DNS 프록시가 동작하며, 호스트의 DNS 설정을 그대로 전달한다
- VM의 `/etc/resolv.conf`에는 `nameserver 192.168.64.1`이 설정된다

**Bridged 모드:**
- 외부 DHCP 서버(라우터)가 DNS 서버 주소를 전달한다
- 일반적으로 라우터의 IP 또는 ISP의 DNS 서버가 설정된다

**수동 DNS 설정:**

```bash
# VM 내부에서 DNS 서버 변경
sudo vim /etc/resolv.conf

# systemd-resolved 사용 시
sudo systemctl restart systemd-resolved
resolvectl status

# 영구적 DNS 설정 (netplan)
# /etc/netplan/01-netcfg.yaml에 nameservers 추가
network:
  version: 2
  ethernets:
    enp0s1:
      dhcp4: true
      nameservers:
        addresses:
          - 8.8.8.8
          - 8.8.4.4
```

### 네트워크 성능 튜닝

VM의 네트워크 성능을 최적화하기 위한 설정 방법이다.

**MTU(Maximum Transmission Unit) 조정:**

```bash
# 기본 MTU 확인 (게스트 내에서)
ip link show enp0s1

# MTU를 점보 프레임으로 변경 (호스트 네트워크가 지원하는 경우)
sudo ip link set enp0s1 mtu 9000

# 영구적으로 적용 (netplan)
network:
  version: 2
  ethernets:
    enp0s1:
      dhcp4: true
      mtu: 9000
```

**TCP 버퍼 크기 조정:**

```bash
# 현재 TCP 버퍼 설정 확인
sysctl net.core.rmem_max
sysctl net.core.wmem_max

# TCP 버퍼 크기 증가 (대용량 전송 성능 개선)
sudo sysctl -w net.core.rmem_max=16777216
sudo sysctl -w net.core.wmem_max=16777216
sudo sysctl -w net.ipv4.tcp_rmem="4096 87380 16777216"
sudo sysctl -w net.ipv4.tcp_wmem="4096 87380 16777216"

# 영구 적용
echo 'net.core.rmem_max=16777216' | sudo tee -a /etc/sysctl.d/99-network-tuning.conf
echo 'net.core.wmem_max=16777216' | sudo tee -a /etc/sysctl.d/99-network-tuning.conf
sudo sysctl --system
```

**네트워크 성능 측정:**

```bash
# iperf3를 이용한 대역폭 측정
# 호스트에서 서버 시작
iperf3 -s

# VM에서 클라이언트로 측정
iperf3 -c 192.168.64.1 -t 10

# 역방향 측정 (호스트 → VM)
iperf3 -c 192.168.64.1 -t 10 -R
```

---

## Golden Image 전략

### Golden Image 설계 원칙

Golden Image란 모든 VM의 공통 기반이 되는 사전 구성된 이미지이다. 새로운 VM을 생성할 때마다 패키지를 설치하고 설정하는 대신, 미리 준비된 Golden Image를 복제하여 시간을 절약한다.

**설계 원칙:**

1. **최소 충분(Minimal Sufficient) 원칙**: 필요한 패키지만 포함한다. 불필요한 패키지는 이미지 크기를 증가시키고 보안 취약점의 표면을 넓힌다
2. **불변성(Immutability) 원칙**: Golden Image는 한 번 빌드하면 수정하지 않는다. 변경이 필요하면 새 버전을 빌드한다
3. **재현성(Reproducibility) 원칙**: 스크립트로 자동화하여 동일한 이미지를 언제든 다시 빌드할 수 있어야 한다
4. **계층화(Layering) 원칙**: 베이스 → 런타임 → 애플리케이션 순서로 계층을 나눈다
5. **버전 관리 원칙**: 모든 Golden Image에 명확한 버전 태그를 부여한다

### 이미지 빌드 자동화 (Packer + Tart)

Packer를 사용하면 Golden Image 빌드를 완전히 자동화할 수 있다. 수동으로 SSH 접속하여 설정하는 대신, Packer HCL 파일에 모든 빌드 과정을 선언적으로 정의한다.

Packer의 빌드 과정은 다음과 같다.

```
1. Source (Tart Builder)
   └── tart clone으로 베이스 이미지 복제
   └── VM 리소스 설정 (CPU, 메모리)
   └── VM 시작 및 SSH 대기

2. Provisioners
   └── Shell: 패키지 설치, 설정 변경
   └── File: 설정 파일 업로드
   └── Ansible: 복잡한 구성 관리

3. Post-Processors
   └── VM 정지
   └── 이미지 최적화
   └── 레지스트리 Push (선택)
```

### 이미지 계층화 전략

이미지를 계층적으로 관리하면 빌드 시간을 최소화하고 유지보수를 용이하게 할 수 있다.

```
Layer 0: Base Image
└── ghcr.io/cirruslabs/ubuntu:latest
    └── Ubuntu ARM64 기본 설치

Layer 1: OS Hardening
└── base-hardened
    └── 보안 설정, 시간대 설정, 기본 도구 설치
    └── swap 비활성화, 커널 모듈 로드

Layer 2: Runtime
└── k8s-golden (이 프로젝트에서 사용)
    └── containerd, kubeadm, kubelet, kubectl 설치
    └── Cilium, K8s 이미지 사전 다운로드

Layer 3: Application (선택)
└── app-golden
    └── 특정 애플리케이션의 의존성 사전 설치
```

각 계층에서의 변경은 해당 계층과 상위 계층만 다시 빌드하면 된다. 예를 들어 Kubernetes 버전을 업그레이드하면 Layer 2부터 다시 빌드한다.

### 이미지 크기 최적화

Golden Image의 크기를 최소화하면 clone 시간과 레지스트리 전송 시간이 단축된다.

```bash
# 빌드 스크립트에서 캐시 정리 (이 프로젝트의 build-golden-image.sh에서도 사용)
apt-get clean
rm -rf /var/lib/apt/lists/*

# 로그 파일 정리
truncate -s 0 /var/log/*.log
rm -rf /var/log/journal/*

# 임시 파일 정리
rm -rf /tmp/* /var/tmp/*

# 패키지 관리자 캐시 정리
apt-get autoremove -y
apt-get autoclean

# 사용하지 않는 로케일 제거
locale-gen --purge en_US.UTF-8

# bash 히스토리 정리
history -c
rm -f ~/.bash_history

# 디스크 여유 공간 제로 채우기 (압축 효율 향상)
dd if=/dev/zero of=/zero.fill bs=1M 2>/dev/null || true
rm -f /zero.fill
```

**크기 최적화 효과 비교:**

| 최적화 항목 | 절감 크기 (대략) |
|------------|----------------|
| apt 캐시 정리 | 200~500MB |
| 로그 파일 정리 | 50~200MB |
| 불필요 로케일 제거 | 100~300MB |
| 제로 채우기 + 압축 | 전체 크기의 30~50% 절감 |

### 이미지 버전 관리

Golden Image의 버전은 명확한 컨벤션을 따라야 한다. 권장하는 태그 형식은 다음과 같다.

```
{이미지명}:{major}.{minor}.{patch}-{날짜}

예시:
k8s-golden:1.31.0-20260319     # K8s 1.31.0, 2026년 3월 19일 빌드
k8s-golden:1.31.1-20260401     # K8s 1.31.1, 2026년 4월 1일 빌드
k8s-golden:latest              # 최신 빌드 (항상 가장 최근 버전을 가리킴)
```

**태그 컨벤션 규칙:**
- Major 버전: Kubernetes 메이저 버전 변경 시 (예: 1.30 → 1.31)
- Minor 버전: Kubernetes 패치 버전 변경 시 (예: 1.31.0 → 1.31.1)
- Patch 버전: Golden Image 자체의 구성 변경 시 (예: Cilium 버전 업데이트)
- 날짜 접미사: 동일 버전이라도 빌드 시점을 구분하기 위해 사용한다

### CI/CD 파이프라인에서의 Golden Image 갱신 자동화

Golden Image를 정기적으로 갱신하는 CI/CD 파이프라인을 구성할 수 있다.

```yaml
# 개념적인 CI/CD 파이프라인 (GitHub Actions 기준)
name: Golden Image Build

on:
  schedule:
    - cron: '0 2 * * 1'  # 매주 월요일 새벽 2시
  workflow_dispatch:       # 수동 트리거 가능

jobs:
  build-golden:
    runs-on: macos-latest  # Apple Silicon 러너 필요
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Build Golden Image
        run: ./scripts/build-golden-image.sh

      - name: Push to Registry
        run: |
          tart login ghcr.io
          tart push k8s-golden ghcr.io/my-org/k8s-golden:${{ github.run_number }}
          tart push k8s-golden ghcr.io/my-org/k8s-golden:latest
```

### 이 프로젝트의 build-golden-image.sh 스크립트 분석

이 프로젝트의 `scripts/build-golden-image.sh`는 Kubernetes 노드용 Golden Image를 자동으로 빌드하는 스크립트이다. 전체 흐름은 7단계로 구성된다.

```
Step 1/7: 베이스 이미지 Pull
    └── ghcr.io/cirruslabs/ubuntu:latest 다운로드

Step 2/7: 빌드 VM 생성
    └── tart clone으로 "k8s-golden-build" VM 생성
    └── CPU 2코어, 메모리 4096MB 설정

Step 3/7: VM 시작 및 SSH 대기
    └── Headless 모드로 VM 시작
    └── IP 할당 대기 (최대 60회 × 3초 = 180초)
    └── SSH 연결 가능 상태 확인

Step 4/7: OS 설정
    └── swap 비활성화 (K8s 요구사항)
    └── overlay, br_netfilter 커널 모듈 로드
    └── sysctl 설정 (ip_forward, bridge-nf-call)

Step 5/7: containerd 설치
    └── containerd, apt-transport-https, ca-certificates, curl, gnupg, conntrack 설치
    └── containerd 기본 설정 생성 및 SystemdCgroup 활성화
    └── containerd 서비스 시작 및 자동 시작 설정

Step 6/7: kubeadm 설치
    └── Kubernetes APT 저장소 추가 (v1.31)
    └── kubelet, kubeadm, kubectl 설치
    └── apt-mark hold로 자동 업그레이드 방지
    └── kubelet 서비스 자동 시작 설정

Step 7/7: 컨테이너 이미지 사전 다운로드
    └── kubeadm config images pull (K8s 핵심 이미지)
    └── Cilium 이미지 3개 다운로드 (v1.16.5):
        ├── quay.io/cilium/cilium
        ├── quay.io/cilium/operator-generic
        └── quay.io/cilium/hubble-relay

최종: 이미지 저장
    └── /etc/k8s-golden 마커 파일 생성
    └── apt 캐시 정리 (이미지 크기 최적화)
    └── VM 정지
    └── "k8s-golden-build" → "k8s-golden"으로 복제
    └── "k8s-golden-build" 삭제
```

스크립트에는 에러 핸들링을 위한 `trap cleanup ERR`이 설정되어 있어, 빌드 중 에러가 발생하면 빌드용 VM을 자동으로 정리한다. 또한 기존에 `k8s-golden` 이미지가 존재하면 중복 빌드를 방지하기 위해 에러를 반환한다.

이 Golden Image를 사용하면 `install.sh`의 Phase 2(OS 설정), Phase 3(containerd 설치), Phase 4(kubeadm 설치)를 건너뛸 수 있어 전체 설치 시간이 45분에서 15분으로 단축된다.

---

## CI/CD 환경에서의 Tart

### Cirrus CI 통합

Tart는 Cirrus Labs에서 개발한 도구이므로, Cirrus CI와의 통합이 가장 완성도가 높다. Cirrus CI는 Tart VM을 네이티브하게 실행할 수 있는 macOS CI 플랫폼이다.

```yaml
# .cirrus.yml 설정 예시
task:
  name: iOS Build
  macos_instance:
    image: ghcr.io/cirruslabs/macos-sonoma-xcode:latest
    cpu: 4
    memory: 8G

  build_script:
    - xcodebuild -project MyApp.xcodeproj -scheme MyApp build

  test_script:
    - xcodebuild -project MyApp.xcodeproj -scheme MyApp test
```

Cirrus CI에서의 Tart 동작 흐름은 다음과 같다.

```
1. CI 작업 트리거
   └── PR 생성, push 이벤트 등

2. Tart VM 프로비저닝
   └── tart clone으로 지정된 이미지 복제
   └── tart set으로 CPU/메모리 설정
   └── tart run으로 VM 시작

3. 빌드/테스트 실행
   └── SSH 또는 직접 실행으로 명령 수행

4. 결과 수집 및 VM 정리
   └── 아티팩트 수집
   └── tart stop → tart delete (Ephemeral 패턴)
```

### GitHub Actions에서 Tart 사용

GitHub Actions의 self-hosted 러너를 Apple Silicon Mac에서 실행하면 Tart를 CI/CD 환경에서 사용할 수 있다.

```yaml
# .github/workflows/build.yml
name: macOS Build

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build:
    runs-on: [self-hosted, macOS, ARM64]  # Apple Silicon self-hosted 러너
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Create VM
        run: |
          tart clone ghcr.io/cirruslabs/macos-sonoma-xcode:latest build-vm
          tart set build-vm --cpu 4 --memory 8192
          tart run --no-graphics build-vm &
          sleep 30

      - name: Get VM IP
        id: vm-ip
        run: |
          VM_IP=$(tart ip build-vm)
          echo "ip=$VM_IP" >> $GITHUB_OUTPUT

      - name: Run Build
        run: |
          ssh -o StrictHostKeyChecking=no admin@${{ steps.vm-ip.outputs.ip }} \
            "cd /path/to/project && xcodebuild build"

      - name: Cleanup
        if: always()
        run: |
          tart stop build-vm 2>/dev/null || true
          tart delete build-vm 2>/dev/null || true
```

또한 Cirrus Labs에서 제공하는 공식 GitHub Action인 `cirruslabs/tart`를 사용하면 더 간결하게 구성할 수 있다.

### Orchard: 대규모 Tart VM 오케스트레이션

Orchard는 Cirrus Labs에서 개발한 Tart VM 오케스트레이션 도구이다. 여러 대의 Apple Silicon Mac에 분산된 Tart VM을 중앙에서 관리할 수 있다.

```
┌─────────────────────────────────────┐
│         Orchard Controller           │
│  ├── Worker 관리                     │
│  ├── VM 스케줄링                     │
│  ├── 리소스 모니터링                  │
│  └── REST API 제공                   │
├─────────────────────────────────────┤
│         Worker Pool                  │
│                                      │
│  ┌──────────┐  ┌──────────┐         │
│  │ Mac Mini  │  │ Mac Mini  │        │
│  │ Worker 1  │  │ Worker 2  │        │
│  │ ├── VM A  │  │ ├── VM D  │        │
│  │ ├── VM B  │  │ ├── VM E  │        │
│  │ └── VM C  │  │ └── VM F  │        │
│  └──────────┘  └──────────┘         │
│                                      │
│  ┌──────────┐  ┌──────────┐         │
│  │ Mac Studio│  │ Mac Pro   │        │
│  │ Worker 3  │  │ Worker 4  │        │
│  │ ├── VM G  │  │ ├── VM J  │        │
│  │ ├── VM H  │  │ └── VM K  │        │
│  │ └── VM I  │  │           │        │
│  └──────────┘  └──────────┘         │
└─────────────────────────────────────┘
```

Orchard의 주요 기능은 다음과 같다.

| 기능 | 설명 |
|------|------|
| Worker 관리 | 여러 Mac을 Worker로 등록하고 상태를 모니터링한다 |
| VM 스케줄링 | 리소스 가용성에 따라 VM을 적절한 Worker에 배치한다 |
| 이미지 캐싱 | Worker에 이미지를 사전 배포하여 VM 생성 시간을 단축한다 |
| REST API | HTTP API로 VM 관리 작업을 자동화할 수 있다 |
| GitHub Actions 통합 | Orchard를 GitHub Actions의 self-hosted 러너 백엔드로 사용할 수 있다 |

### Ephemeral VM 패턴

CI/CD에서 가장 권장되는 패턴은 Ephemeral(일회용) VM 패턴이다. 테스트마다 새 VM을 생성하고, 완료 후 삭제한다.

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  CI 작업 시작  │────►│  VM 생성      │────►│  빌드/테스트   │
│              │     │  (tart clone) │     │  실행         │
└──────────────┘     └──────────────┘     └──────┬───────┘
                                                  │
                                                  ▼
                     ┌──────────────┐     ┌──────────────┐
                     │  VM 삭제      │◄────│  결과 수집     │
                     │  (tart delete)│     │              │
                     └──────────────┘     └──────────────┘
```

**Ephemeral VM의 장점:**

| 장점 | 설명 |
|------|------|
| 깨끗한 환경 | 매번 새 VM에서 시작하므로 이전 테스트의 부작용이 없다 |
| 재현성 | 동일한 Golden Image에서 출발하므로 결과가 재현 가능하다 |
| 보안 | 테스트 중 생성된 시크릿, 토큰 등이 VM과 함께 삭제된다 |
| 디스크 관리 | 사용하지 않는 VM이 디스크를 점유하지 않는다 |

**Ephemeral VM 스크립트 패턴:**

```bash
#!/bin/bash
set -euo pipefail

VM_NAME="ci-$(date +%s)"  # 타임스탬프 기반 고유 이름
IMAGE="k8s-golden"

# 종료 시 항상 VM 삭제
cleanup() {
    tart stop "$VM_NAME" 2>/dev/null || true
    tart delete "$VM_NAME" 2>/dev/null || true
}
trap cleanup EXIT

# VM 생성 및 실행
tart clone "$IMAGE" "$VM_NAME"
tart set "$VM_NAME" --cpu 4 --memory 8192
tart run --no-graphics "$VM_NAME" &
sleep 15

# IP 확인 및 작업 실행
VM_IP=$(tart ip "$VM_NAME")
ssh admin@"$VM_IP" "echo 'Hello from ephemeral VM'"

# cleanup은 trap에 의해 자동 실행
```

### macOS CI/CD에서의 장점

Tart가 macOS CI/CD 환경에서 특히 유용한 이유는 다음과 같다.

| 장점 | 설명 |
|------|------|
| iOS/macOS 빌드 | Xcode 빌드와 시뮬레이터 테스트를 VM에서 실행할 수 있다 |
| 격리된 환경 | 각 빌드가 독립적인 VM에서 실행되므로 상태 오염이 없다 |
| 빠른 프로비저닝 | Golden Image에서 clone하면 수 초 내에 VM이 준비된다 |
| Apple Silicon 네이티브 | ARM64 네이티브 실행으로 에뮬레이션 오버헤드가 없다 |
| Xcode 버전 관리 | 다양한 Xcode 버전이 설치된 Golden Image를 사전 준비할 수 있다 |
| 코드 서명 | VM에 코드 서명 인증서를 안전하게 배포할 수 있다 |

### 동시성 관리

여러 VM을 동시에 실행할 때 호스트의 리소스를 적절히 관리해야 한다.

**리소스 제한 가이드라인:**

| 호스트 사양 | 권장 최대 VM 수 | 이유 |
|------------|----------------|------|
| M1 (8코어/16GB) | 2~3 | 코어와 메모리가 제한적이다 |
| M1 Pro (10코어/32GB) | 4~6 | 적절한 오버커밋이 가능하다 |
| M1 Max (10코어/64GB) | 6~10 | 메모리가 충분하다 |
| M2 Ultra (24코어/192GB) | 15~20 | 대규모 CI/CD 팜에 적합하다 |
| M4 Max (16코어/128GB) | 10~15 | 높은 단일 코어 성능을 활용한다 |

**동시 실행 시 주의사항:**
- CPU 오버커밋은 1.5:1 이하로 유지하는 것이 권장된다 (예: 10코어 호스트에서 vCPU 총합 15개 이하)
- 메모리 오버커밋은 권장되지 않는다. VM에 할당한 메모리의 총합이 호스트 물리 메모리를 초과하면 swap이 발생하여 성능이 급격히 저하된다
- 디스크 I/O는 병목이 될 수 있다. 여러 VM이 동시에 디스크 집약적 작업을 수행하면 SSD 대역폭이 포화된다

이 프로젝트에서는 총 10개 VM을 동시에 실행한다. CPU 총합은 21코어, 메모리 총합은 약 72GB이므로, M1 Max(10코어/64GB) 이상의 사양이 권장된다.

---

## 보안

### VM 격리: Hypervisor 기반 보안

Tart VM은 하드웨어 수준의 가상화를 통해 격리된다. Apple Silicon의 EL2(Exception Level 2)에서 Hypervisor가 동작하며, 각 VM은 독립적인 가상 주소 공간을 가진다.

**격리 수준:**

| 격리 대상 | 메커니즘 | 설명 |
|-----------|---------|------|
| CPU | vCPU 스케줄링 | 각 VM은 독립적인 vCPU에서 실행된다. 호스트 스케줄러가 물리 코어에 매핑한다 |
| 메모리 | Stage-2 주소 변환 | VM은 자신에게 할당된 메모리 영역만 접근할 수 있다. 다른 VM이나 호스트의 메모리에 접근할 수 없다 |
| 디스크 | 파일 기반 격리 | 각 VM은 독립적인 disk.img 파일을 사용한다. VirtioFS 공유를 명시적으로 설정하지 않으면 호스트 파일에 접근할 수 없다 |
| 네트워크 | vmnet/Softnet 격리 | 네트워크 모드에 따라 격리 수준이 달라진다 |
| 프로세스 | Hypervisor 경계 | VM 내부의 프로세스는 호스트의 프로세스에 접근할 수 없다 |

**컨테이너 격리와의 비교:**

| 항목 | VM (Tart) | 컨테이너 (Docker) |
|------|-----------|------------------|
| 커널 | 독립적인 게스트 커널이다 | 호스트 커널을 공유한다 |
| 격리 수준 | 하드웨어 수준이다 | 프로세스/namespace 수준이다 |
| 탈출 난이도 | 매우 어렵다 (Hypervisor 탈출 필요) | 상대적으로 쉽다 (커널 취약점 악용 가능) |
| 성능 오버헤드 | 약간 있다 (5~10%) | 거의 없다 (1~3%) |
| 보안 인증 | 다수의 규제에서 VM 격리를 요구한다 | 추가 보안 조치가 필요할 수 있다 |

### 네트워크 격리: Softnet 모드의 보안 특성

Softnet 모드는 CI/CD 환경에서 보안을 강화하기 위해 설계된 네트워크 모드이다.

**Softnet의 보안 특성:**

| 특성 | 설명 |
|------|------|
| VM 간 격리 | 동일 호스트의 다른 VM과 통신할 수 없다 |
| 호스트 접근 차단 | VM에서 호스트의 서비스에 접근할 수 없다 |
| 선택적 외부 접근 | `--net-softnet-allow`로 허용된 대역만 접근 가능하다 |
| 비특권 실행 | root 권한 없이 동작한다 (vmnet의 Shared/Bridged와 다름) |

**보안 수준별 권장 설정:**

```bash
# 높은 보안: 모든 외부 접근 차단
tart run --no-graphics --net-softnet my-vm

# 중간 보안: 특정 레지스트리만 허용
tart run --no-graphics \
    --net-softnet-allow=ghcr.io \
    --net-softnet-allow=registry.k8s.io \
    my-vm

# 낮은 보안 (이 프로젝트): 모든 외부 접근 허용
tart run --no-graphics --net-softnet-allow=0.0.0.0/0 my-vm
```

### 이미지 서명 및 검증

OCI 이미지의 무결성을 보장하기 위해 이미지 서명을 사용할 수 있다. Tart 자체는 이미지 서명 기능을 내장하고 있지 않지만, OCI 표준을 따르므로 Cosign 등의 도구를 사용하여 서명할 수 있다.

```bash
# Cosign으로 Tart 이미지 서명
cosign sign ghcr.io/my-org/k8s-golden:v1.0

# 서명 검증
cosign verify ghcr.io/my-org/k8s-golden:v1.0

# 키페어 생성 (처음 한 번)
cosign generate-key-pair
```

**이미지 서명 워크플로우:**

```
빌드 → 서명 → Push → Pull → 검증 → 사용
  │       │              │       │
  │   cosign sign     tart pull  cosign verify
  │                              │
  └──── 서명 실패 시 사용 차단 ────┘
```

### SSH 키 관리

Tart VM의 기본 계정은 `admin`/`admin`이다. 프로덕션 환경에서는 반드시 다음 보안 조치를 적용해야 한다.

```bash
# 1. 기본 비밀번호 변경
ssh admin@$(tart ip my-vm) "sudo passwd admin"

# 2. SSH 키 배포
ssh-copy-id -i ~/.ssh/id_ed25519.pub admin@$(tart ip my-vm)

# 3. 비밀번호 인증 비활성화
ssh admin@$(tart ip my-vm) "sudo sed -i 's/PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config && sudo systemctl restart ssh"

# 4. root 로그인 비활성화
ssh admin@$(tart ip my-vm) "sudo sed -i 's/PermitRootLogin yes/PermitRootLogin no/' /etc/ssh/sshd_config && sudo systemctl restart ssh"
```

**Golden Image에 SSH 키를 사전 배포하는 방법:**

Golden Image 빌드 과정에서 authorized_keys를 미리 설정하면, clone된 모든 VM에서 키 기반 인증을 즉시 사용할 수 있다.

```bash
# Golden Image 빌드 시
ssh admin@$BUILD_IP "mkdir -p ~/.ssh && chmod 700 ~/.ssh"
scp ~/.ssh/id_ed25519.pub admin@$BUILD_IP:~/.ssh/authorized_keys
ssh admin@$BUILD_IP "chmod 600 ~/.ssh/authorized_keys"
```

### 디스크 암호화 고려사항

Tart VM의 디스크 이미지(`disk.img`)는 호스트 파일 시스템에 일반 파일로 저장된다. 호스트 Mac에서 FileVault(전체 디스크 암호화)가 활성화되어 있으면 VM 디스크도 자동으로 암호화된다.

| 시나리오 | 암호화 상태 | 권장사항 |
|---------|------------|---------|
| FileVault 활성 | 호스트 디스크 전체가 암호화된다. VM 이미지도 포함된다 | 별도 조치 불필요하다 |
| FileVault 비활성 | VM 디스크가 암호화되지 않는다 | FileVault 활성화를 권장한다 |
| 외부 스토리지 | 외부 디스크의 암호화 여부에 따른다 | APFS 암호화 볼륨을 사용한다 |

**VM 내부 디스크 암호화:**

게스트 OS 수준에서 LUKS(Linux Unified Key Setup)를 사용하여 추가 암호화를 적용할 수 있다. 하지만 이는 Golden Image 빌드를 복잡하게 만들고 성능 오버헤드가 발생하므로, FileVault로 충분한 경우에는 권장하지 않는다.

---

## 트러블슈팅

### VM이 시작되지 않는 경우

**증상:** `tart run` 명령이 에러를 반환하거나 즉시 종료된다.

**원인과 해결책:**

| 원인 | 증상 | 해결책 |
|------|------|--------|
| VM이 이미 실행 중 | "already in use" 에러 | `tart stop <vm>` 실행 후 재시도한다 |
| Lock 파일 잔존 | VM이 실행 중이 아닌데 lock 에러 발생 | `~/.tart/vms/<vm>/` 내 lock 파일을 확인하고 삭제한다 |
| 디스크 이미지 손상 | "disk image is corrupted" 에러 | VM을 삭제하고 Golden Image에서 다시 clone한다 |
| 리소스 부족 | "not enough resources" 에러 | 다른 VM을 정지하거나 CPU/메모리 할당을 줄인다 |
| macOS 버전 미달 | API 호환성 에러 | macOS 13 이상으로 업그레이드한다 |
| SIP 비활성화 필요 | 권한 에러 (일부 기능) | System Integrity Protection 설정을 확인한다 |

```bash
# VM 상태 확인
tart list

# 실행 중인 Tart 프로세스 확인
ps aux | grep tart

# 강제 종료 후 재시작
tart stop my-vm 2>/dev/null || true
sleep 2
tart run --no-graphics my-vm &
```

### IP 할당이 안 되는 경우

**증상:** `tart ip <vm>` 명령이 빈 결과를 반환하거나 타임아웃된다.

**원인과 해결책:**

```bash
# 1. DHCP 임대 파일 확인
cat /var/db/dhcpd_leases

# 2. VM의 MAC 주소 확인
tart get my-vm | jq '.macAddress'

# 3. DHCP 임대 파일에서 해당 MAC 검색
grep -A 5 "7e:05:a1:b2:c3:d4" /var/db/dhcpd_leases

# 4. 임대 테이블이 가득 찬 경우 (254개 초과)
# DHCP 임대 파일을 초기화 (주의: 모든 VM의 IP가 재할당된다)
sudo rm /var/db/dhcpd_leases
# 모든 VM을 재시작한다

# 5. MAC 주소 충돌 시
tart set my-vm --random-mac

# 6. vmnet 프레임워크 문제 시
# macOS를 재부팅하면 vmnet이 초기화된다
```

**IP 할당 대기 스크립트:**

```bash
#!/bin/bash
VM_NAME="$1"
MAX_WAIT=120  # 최대 120초 대기

for ((i=1; i<=MAX_WAIT; i++)); do
    IP=$(tart ip "$VM_NAME" 2>/dev/null)
    if [[ -n "$IP" ]]; then
        echo "$IP"
        exit 0
    fi
    sleep 1
done
echo "ERROR: IP 할당 타임아웃 ($MAX_WAIT초)" >&2
exit 1
```

### 디스크 공간 부족

**증상:** VM 생성이나 clone이 실패하고, 디스크 공간 부족 에러가 발생한다.

```bash
# 전체 디스크 사용량 확인
df -h /

# Tart VM 디스크 사용량 확인
du -sh ~/.tart/vms/*/
du -sh ~/.tart/cache/

# 사용하지 않는 VM 삭제
tart list
tart delete unused-vm-1
tart delete unused-vm-2

# OCI 캐시 정리
tart prune

# 수동으로 캐시 디렉토리 정리
rm -rf ~/.tart/cache/OCIs/*

# 환경변수로 자동 정리 한도 조정
export TART_CACHE_SIZE_LIMIT=50  # 50GB로 제한
```

**디스크 공간 관리 팁:**

| 항목 | 일반적인 크기 | 관리 방법 |
|------|-------------|----------|
| VM 이미지 (각) | 3~10GB | 사용하지 않는 VM을 삭제한다 |
| OCI 캐시 | 10~50GB | `tart prune`으로 정리한다 |
| DHCP 임대 파일 | 수 KB | 관리 불필요하다 |

### 네트워크 연결 실패

**증상:** VM 내부에서 외부 인터넷에 접근할 수 없다.

```bash
# VM 내부에서 네트워크 확인
ip addr show              # 인터페이스 상태 확인
ip route show             # 라우팅 테이블 확인
ping -c 3 192.168.64.1    # 게이트웨이 연결 확인
ping -c 3 8.8.8.8         # 외부 IP 연결 확인
nslookup google.com       # DNS 해석 확인

# DNS가 실패하는 경우
cat /etc/resolv.conf
echo "nameserver 8.8.8.8" | sudo tee /etc/resolv.conf

# 라우팅이 없는 경우
sudo ip route add default via 192.168.64.1
```

**네트워크 모드별 체크리스트:**

| 모드 | 확인사항 |
|------|---------|
| NAT | 게이트웨이(192.168.64.1) ping이 되는가? DNS가 설정되었는가? |
| Bridged | 호스트의 물리 인터페이스가 활성인가? 외부 DHCP에서 IP를 받았는가? |
| Softnet | `--net-softnet-allow` 옵션이 올바른가? 필요한 대역이 허용되었는가? |

### SSH 접속 실패

**증상:** `ssh admin@<ip>` 명령이 연결을 거부하거나 인증에 실패한다.

```bash
# 1. SSH 서비스 상태 확인 (VM 콘솔에서)
systemctl status ssh

# 2. SSH 서비스 시작
sudo systemctl start ssh
sudo systemctl enable ssh

# 3. 연결 거부 시 - 방화벽 확인
sudo ufw status
sudo ufw allow ssh

# 4. 호스트 키 변경으로 인한 접속 거부
ssh-keygen -R "192.168.64.5"  # 기존 호스트 키 삭제

# 5. strict host key checking 비활성화 (CI/CD 환경)
ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null admin@192.168.64.5

# 6. 비밀번호 인증 실패 시
# 기본 계정: admin / admin
sshpass -p admin ssh admin@192.168.64.5

# 7. SSH verbose 모드로 디버깅
ssh -vvv admin@192.168.64.5
```

### 성능 저하 원인 분석

**증상:** VM의 응답이 느리거나 빌드 시간이 비정상적으로 길다.

```bash
# 호스트에서 리소스 사용량 확인
top -l 1 | head -10          # CPU/메모리 사용량
vm_stat                       # 메모리 페이지 통계
iostat -w 1                   # 디스크 I/O

# 스왑 사용량 확인 (성능 저하의 주요 원인)
sysctl vm.swapusage

# VM 내부에서 확인
free -h                       # 메모리 사용량
iostat -x 1                   # 디스크 I/O 상세
vmstat 1                      # 시스템 전체 통계
```

**성능 저하 원인별 해결책:**

| 원인 | 진단 방법 | 해결책 |
|------|----------|--------|
| CPU 오버커밋 | `top`에서 CPU 사용률 100% | VM의 vCPU 수를 줄이거나 VM 수를 줄인다 |
| 메모리 부족 (호스트 swap) | `sysctl vm.swapusage`에서 swap used > 0 | VM 메모리 할당을 줄이거나 VM 수를 줄인다 |
| 디스크 I/O 병목 | `iostat`에서 높은 await | 동시 디스크 작업을 줄이거나 외부 SSD를 사용한다 |
| 네트워크 병목 | VM 내부에서 `iperf3` 측정 | MTU, TCP 버퍼를 조정한다 |

### 로그 확인 방법

Tart 자체는 별도의 로그 파일을 생성하지 않는다. 문제 진단을 위한 로그 확인 방법은 다음과 같다.

```bash
# macOS 시스템 로그에서 Virtualization.framework 관련 로그 확인
log show --predicate 'subsystem == "com.apple.Virtualization"' --last 1h

# vmnet 관련 로그 확인
log show --predicate 'subsystem == "com.apple.vmnet"' --last 1h

# Tart 프로세스 관련 로그
log show --predicate 'process == "tart"' --last 1h

# 실시간 로그 모니터링
log stream --predicate 'subsystem == "com.apple.Virtualization"'

# VM 내부 로그 (게스트 OS)
journalctl -xe                # systemd 로그
dmesg | tail -50              # 커널 메시지
cat /var/log/syslog           # 시스템 로그
```

---

## 성능 최적화

### CPU 할당 전략

VM에 할당하는 vCPU 수는 호스트의 물리 코어 수를 기준으로 결정해야 한다.

**CPU 오버커밋 비율 가이드:**

| 워크로드 유형 | 권장 오버커밋 비율 | 이유 |
|-------------|------------------|------|
| I/O 집중 (웹 서버, DB) | 2:1 | CPU 유휴 시간이 많으므로 오버커밋이 효과적이다 |
| CPU 집중 (빌드, 컴파일) | 1:1 | CPU를 지속적으로 사용하므로 오버커밋을 피해야 한다 |
| 혼합 워크로드 | 1.5:1 | 일반적인 권장 비율이다 |
| 유휴 대기 (K8s 노드 대기) | 3:1 | 대부분의 시간이 유휴 상태이다 |

**이 프로젝트의 CPU 할당:**

```
호스트: Apple Silicon (예: M1 Max 10코어)
총 vCPU 할당: 21코어 (2+3+2 + 2+2 + 2+2 + 2+2+2)
오버커밋 비율: 2.1:1

이 비율은 K8s 노드가 대부분 유휴 상태인 학습 환경에서는
적절하지만, 실제 워크로드를 실행할 때는 성능 저하가 발생할 수 있다.
```

**효율적인 CPU 할당 팁:**
- Master 노드는 etcd, API 서버 등 경량 프로세스만 실행하므로 2코어면 충분하다
- Worker 노드는 실제 워크로드에 따라 3~4코어를 할당한다
- 빌드 작업을 수행하는 CI/CD용 VM에는 4코어 이상을 권장한다

### 메모리 할당

**Balloon 드라이버:**

Virtio Balloon 드라이버는 VM의 메모리를 동적으로 조절하는 기술이다. VM이 사용하지 않는 메모리를 호스트에 반환하여, 다른 VM이나 호스트 프로세스가 사용할 수 있게 한다.

```
┌──────────────────────┐
│  VM (할당: 8GB)       │
│  ├── 실제 사용: 3GB    │
│  ├── Balloon: 4GB     │  ← 호스트에 반환된 영역
│  └── 여유: 1GB        │
└──────────────────────┘
         │
    Balloon 드라이버가
    사용하지 않는 메모리를
    호스트에 반환한다
         │
         ▼
┌──────────────────────┐
│  호스트               │
│  4GB를 다른 용도로    │
│  사용할 수 있다       │
└──────────────────────┘
```

Virtualization.framework는 Balloon 드라이버를 지원하지만, Tart에서 이를 명시적으로 활성화하는 옵션은 없다. 프레임워크 내부에서 자동으로 관리된다.

**메모리 오버커밋 고려사항:**

| 시나리오 | 결과 | 권장 여부 |
|---------|------|----------|
| 총 VM 메모리 < 호스트 물리 메모리 | 안정적으로 동작한다 | 권장한다 |
| 총 VM 메모리 = 호스트 물리 메모리 | 호스트 OS와 경합이 발생할 수 있다 | 주의가 필요하다 |
| 총 VM 메모리 > 호스트 물리 메모리 | swap 발생으로 심각한 성능 저하가 나타난다 | 권장하지 않는다 |

이 프로젝트의 메모리 할당 총합은 약 72GB이다. 따라서 최소 80GB 이상의 물리 메모리를 갖춘 호스트가 권장된다. M1 Max(64GB)에서는 swap이 발생할 수 있으므로, 일부 클러스터만 선택적으로 실행하는 것이 좋다.

### 디스크 I/O 최적화

**SSD vs 외부 스토리지:**

| 스토리지 유형 | 순차 읽기 | 순차 쓰기 | 랜덤 I/O | VM 동시 실행 적합성 |
|-------------|----------|----------|---------|-------------------|
| 내장 SSD (Apple) | 7GB/s | 5GB/s | 매우 높음 | 최적이다 |
| Thunderbolt SSD | 2~3GB/s | 2~3GB/s | 높음 | 양호하다 |
| USB-C SSD | 1GB/s | 1GB/s | 보통 | VM 수가 적을 때 사용한다 |
| HDD | 150MB/s | 150MB/s | 매우 낮음 | 권장하지 않는다 |

**APFS의 장점:**

macOS의 기본 파일 시스템인 APFS는 다음의 특성으로 VM 관리에 유리하다.

- **COW(Copy-on-Write)**: `tart clone` 시 실제 디스크 복사 대신 COW 방식으로 즉시 복제된다. 이후 변경된 부분만 추가 공간을 차지한다
- **Sparse file 지원**: 20GB로 설정된 disk.img가 실제로는 3GB만 차지할 수 있다
- **스냅샷**: APFS 스냅샷을 활용하면 VM 상태를 빠르게 저장하고 복구할 수 있다

```bash
# APFS clone 확인 (refcount 방식)
# tart clone이 APFS clone을 사용하므로 즉시 완료된다
time tart clone ghcr.io/cirruslabs/ubuntu:latest test-vm
# real    0m0.5s  ← 20GB 이미지인데도 0.5초 만에 완료
```

**디스크 I/O 최적화 팁:**

```bash
# VM 내에서 I/O 스케줄러 확인 및 변경
cat /sys/block/vda/queue/scheduler

# none 스케줄러로 변경 (VM에서는 호스트가 스케줄링하므로)
echo none | sudo tee /sys/block/vda/queue/scheduler

# 디스크 I/O 우선순위 조정 (호스트에서)
# 특정 VM의 tart 프로세스에 낮은 I/O 우선순위 부여
renice -n 10 -p $(pgrep -f "tart run my-vm")
```

### VM density 최적화

호스트당 최대 VM 수를 높이기 위한 전략이다.

**VM 리소스 최소화:**

```bash
# 최소 리소스 VM (테스트용)
tart set my-vm --cpu 1 --memory 1024 --disk-size 10

# K8s Master 노드 (최소 사양)
tart set master --cpu 2 --memory 2048 --disk-size 15

# K8s Worker 노드 (경량 워크로드)
tart set worker --cpu 2 --memory 4096 --disk-size 20
```

**호스트 사양별 최적 VM 구성 예시:**

| 호스트 | 코어 | RAM | 권장 VM 구성 |
|--------|-----|-----|-------------|
| M1 (8코어/16GB) | 8 | 16GB | Master 1 (2C/2G) + Worker 2 (2C/4G each) = 3 VM |
| M1 Pro (10코어/32GB) | 10 | 32GB | Master 2 (2C/2G) + Worker 3 (2C/6G each) = 5 VM |
| M1 Max (10코어/64GB) | 10 | 64GB | 이 프로젝트의 10 VM 구성이 가능하다 |
| M2 Ultra (24코어/192GB) | 24 | 192GB | Master 4 (2C/4G) + Worker 12 (2C/8G each) = 16 VM |

---

## 실습

### 실습 1: Tart 설치 및 기본 명령어
```bash
# Tart 설치 (Homebrew)
brew install cirruslabs/cli/tart

# 수동 설치 (Homebrew 없이)
curl -LO https://github.com/cirruslabs/tart/releases/latest/download/tart.tar.gz
tar -xzvf tart.tar.gz
./tart.app/Contents/MacOS/tart --version

# 버전 확인
tart --version

# 로컬 VM 목록 확인
tart list
```

### 실습 2: VM 생성 및 실행
```bash
# Ubuntu 이미지 Pull (OCI 레지스트리에서 다운로드)
tart pull ghcr.io/cirruslabs/ubuntu:latest

# 이미지를 기반으로 VM 클론 (Golden Image -> 로컬 VM)
tart clone ghcr.io/cirruslabs/ubuntu:latest my-test-vm

# VM 설정 변경 (CPU 2코어, RAM 4GB, 디스크 30GB)
tart set my-test-vm --cpu 2 --memory 4096 --disk-size 30

# VM 실행 (Headless 모드)
tart run --no-graphics my-test-vm

# VM IP 확인 (DHCP 할당 후)
tart ip my-test-vm
```

### 실습 3: `tart set` 상세 옵션
```bash
# CPU 코어 수 변경
tart set my-vm --cpu 4

# 메모리 변경 (MB 단위)
tart set my-vm --memory 8192

# 디스크 크기 변경 (GB 단위, 확장만 가능)
tart set my-vm --disk-size 50

# 디스플레이 해상도 변경
tart set my-vm --display 1920x1080

# MAC 주소 랜덤화 (DHCP에서 새 IP 할당받기 위해)
tart set my-vm --random-mac

# 여러 옵션 동시 적용
tart set my-vm --cpu 4 --memory 8192 --disk-size 50
```

### 실습 4: VM SSH 접속 및 관리
```bash
# VM에 SSH 접속 (기본 계정: admin/admin)
ssh admin@$(tart ip my-test-vm)

# VM 중지
tart stop my-test-vm

# VM 삭제
tart delete my-test-vm
```

### 실습 5: OCI 레지스트리 연동
```bash
# 레지스트리 로그인
tart login ghcr.io

# 환경변수를 이용한 인증 (CI/CD 환경)
export TART_REGISTRY_USERNAME=my-user
export TART_REGISTRY_PASSWORD=my-token
export TART_REGISTRY_HOSTNAME=ghcr.io

# 로컬 VM을 레지스트리에 Push
tart push my-custom-vm ghcr.io/my-org/my-vm:v1.0

# 레지스트리에서 VM Pull
tart pull ghcr.io/my-org/my-vm:v1.0

# 레지스트리에서 직접 Clone (pull + clone을 한 번에)
tart clone ghcr.io/my-org/my-vm:v1.0 local-vm-name
```

### 실습 6: 네트워크 모드 및 공유 디렉토리
```bash
# 기본 모드(Shared/NAT)로 실행
tart run --no-graphics my-vm

# Bridged 모드로 실행 (호스트 네트워크에 직접 연결)
tart run --no-graphics --net-bridged=en0 my-vm

# Softnet 모드로 실행 (격리된 네트워크)
tart run --no-graphics --net-softnet my-vm

# Bridged 모드에서 IP 확인 (ARP 조회)
tart ip --resolver=arp my-vm

# 디렉토리 공유와 함께 실행
tart run --no-graphics --dir=mydata:~/shared-data my-vm

# Rosetta 활성화 (Linux VM에서 x86_64 바이너리 실행)
tart run --no-graphics --rosetta my-vm

# Nested Virtualization 활성화 (M3/M4 + macOS 15+)
tart run --no-graphics --nested my-vm
```

### 실습 7: 프로젝트 설정 확인
```bash
# 프로젝트의 클러스터 설정 확인
cat ../../config/clusters.json | jq '.clusters[] | {name, cpu: (.nodes[] | .cpu), memory: (.nodes[] | .memory)}'

# DHCP 임대 현황 확인
cat /var/db/dhcpd_leases

# 로컬 VM 저장소 확인
ls -la ~/.tart/vms/

# OCI 캐시 확인
ls -la ~/.tart/cache/OCIs/
```

### 실습 8: clusters.json을 읽고 VM을 수동으로 생성하는 실습

이 프로젝트의 `config/clusters.json`을 파싱하여 VM을 수동으로 생성하는 과정을 실습한다. 실제 `scripts/lib/vm.sh`의 `vm_create_all()` 함수가 내부적으로 수행하는 작업을 단계별로 수동 실행해 보는 것이다.

```bash
# 1. clusters.json의 구조 확인
cat ../../config/clusters.json | jq '.'

# 2. base_image 확인
BASE_IMAGE=$(jq -r '.base_image' ../../config/clusters.json)
echo "Base Image: $BASE_IMAGE"
# 출력: ghcr.io/cirruslabs/ubuntu:latest

# 3. 모든 클러스터 이름 확인
jq -r '.clusters[].name' ../../config/clusters.json
# 출력:
# platform
# dev
# staging
# prod

# 4. 특정 클러스터(dev)의 노드 목록과 리소스 확인
jq '.clusters[] | select(.name=="dev") | .nodes[]' ../../config/clusters.json
# 출력:
# {"name": "dev-master", "role": "master", "cpu": 2, "memory": 4096, "disk": 20}
# {"name": "dev-worker1", "role": "worker", "cpu": 2, "memory": 8192, "disk": 20}

# 5. 베이스 이미지 Pull
tart pull "$BASE_IMAGE"

# 6. dev 클러스터의 노드를 수동으로 생성
# dev-master 생성
tart clone "$BASE_IMAGE" dev-master
tart set dev-master --cpu 2 --memory 4096
tart set dev-master --random-mac

# dev-worker1 생성
tart clone "$BASE_IMAGE" dev-worker1
tart set dev-worker1 --cpu 2 --memory 8192
tart set dev-worker1 --random-mac

# 7. 생성된 VM 확인
tart list

# 8. VM 실행
tart run --no-graphics --net-softnet-allow=0.0.0.0/0 dev-master &
sleep 5
tart run --no-graphics --net-softnet-allow=0.0.0.0/0 dev-worker1 &
sleep 5

# 9. IP 확인
tart ip dev-master
tart ip dev-worker1

# 10. SSH 접속 테스트
ssh -o StrictHostKeyChecking=no admin@$(tart ip dev-master) "hostname"
ssh -o StrictHostKeyChecking=no admin@$(tart ip dev-worker1) "hostname"

# 11. 정리
tart stop dev-master
tart stop dev-worker1
tart delete dev-master
tart delete dev-worker1
```

**jq를 활용한 자동화 스크립트:**

```bash
#!/bin/bash
# clusters.json에서 모든 노드를 자동으로 생성하는 스크립트
CONFIG="../../config/clusters.json"
BASE_IMAGE=$(jq -r '.base_image' "$CONFIG")

tart pull "$BASE_IMAGE" 2>/dev/null || true

# 모든 클러스터의 모든 노드를 순회하며 생성
jq -r '.clusters[].nodes[] | "\(.name) \(.cpu) \(.memory)"' "$CONFIG" | \
while read -r name cpu memory; do
    echo "Creating VM: $name (CPU: $cpu, Memory: ${memory}MB)"
    tart clone "$BASE_IMAGE" "$name"
    tart set "$name" --cpu "$cpu" --memory "$memory"
    tart set "$name" --random-mac
done

echo "All VMs created:"
tart list
```

### 실습 9: Golden Image 빌드 실습 (build-golden-image.sh 분석)

이 프로젝트의 Golden Image 빌드 스크립트를 단계별로 분석하고, 직접 실행해 보는 실습이다.

```bash
# 1. 스크립트 내용 확인
cat ../../scripts/build-golden-image.sh

# 2. 의존성 확인 (lib/common.sh, lib/ssh.sh)
cat ../../scripts/lib/common.sh
cat ../../scripts/lib/ssh.sh

# 3. 스크립트 실행 전 사전 조건 확인
tart --version          # Tart 설치 확인
command -v jq           # jq 설치 확인
command -v sshpass      # sshpass 설치 확인

# 4. 기존 Golden Image 존재 여부 확인
tart list | grep k8s-golden

# 5. Golden Image 빌드 실행 (~10분 소요)
cd ../../
./scripts/build-golden-image.sh

# 6. 빌드 결과 확인
tart list | grep k8s-golden

# 7. Golden Image의 디스크 크기 확인
du -sh ~/.tart/vms/k8s-golden/

# 8. Golden Image로 테스트 VM 생성
tart clone k8s-golden test-golden-vm
tart set test-golden-vm --cpu 2 --memory 4096
tart run --no-graphics test-golden-vm &
sleep 15

# 9. Golden Image에 사전 설치된 패키지 확인
VM_IP=$(tart ip test-golden-vm)
ssh admin@$VM_IP "which kubeadm && kubeadm version"
ssh admin@$VM_IP "which kubelet && kubelet --version"
ssh admin@$VM_IP "which kubectl && kubectl version --client"
ssh admin@$VM_IP "cat /etc/k8s-golden"  # 마커 파일 확인
ssh admin@$VM_IP "sudo ctr -n k8s.io images list"  # 사전 다운로드된 이미지 확인

# 10. 정리
tart stop test-golden-vm
tart delete test-golden-vm
```

**Golden Image 커스터마이징 예시:**

기존 build-golden-image.sh를 수정하여 추가 도구를 설치하는 방법이다.

```bash
# Step 7 이후에 추가 스크립트를 삽입한다 (개념적 예시):

# Step 8/8: 추가 도구 설치 (Helm, k9s 등)
ssh_exec_sudo "$BUILD_IP" "
    # Helm 설치
    curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash

    # k9s 설치
    curl -sS https://webinstall.dev/k9s | bash
"
```

### 실습 10: 포트 포워딩 설정 실습

VM 내부의 서비스를 호스트에서 접근할 수 있도록 포트 포워딩을 설정하는 실습이다.

```bash
# 1. VM 생성 및 실행
tart clone ghcr.io/cirruslabs/ubuntu:latest port-test-vm
tart set port-test-vm --cpu 2 --memory 2048
tart run --no-graphics port-test-vm &
sleep 15

# 2. VM IP 확인
VM_IP=$(tart ip port-test-vm)
echo "VM IP: $VM_IP"

# 3. VM 내부에서 간단한 웹 서버 시작
ssh admin@$VM_IP "sudo apt-get update && sudo apt-get install -y nginx"
ssh admin@$VM_IP "sudo systemctl start nginx"

# 4. 호스트에서 VM의 웹 서버에 직접 접근 (NAT 모드에서 가능)
curl http://$VM_IP:80

# 5. SSH 터널을 이용한 포트 포워딩
# 호스트의 localhost:8080 → VM의 80 포트로 포워딩
ssh -L 8080:localhost:80 -N admin@$VM_IP &
SSH_PID=$!

# 6. 포워딩된 포트로 접근
curl http://localhost:8080

# 7. 정리
kill $SSH_PID
tart stop port-test-vm
tart delete port-test-vm
```

**SSH 포트 포워딩 패턴 정리:**

```bash
# Local 포워딩: 호스트의 포트를 VM으로 전달
ssh -L <호스트포트>:<대상호스트>:<대상포트> admin@<VM_IP>

# 예시: 호스트 8080 → VM 80
ssh -L 8080:localhost:80 admin@192.168.64.5

# 예시: 호스트 6443 → VM 6443 (K8s API 서버)
ssh -L 6443:localhost:6443 admin@192.168.64.5

# 다중 포트 포워딩
ssh -L 8080:localhost:80 -L 3306:localhost:3306 admin@192.168.64.5
```

### 실습 11: VM 스냅샷과 복구

Tart 자체는 스냅샷 기능을 내장하고 있지 않지만, APFS 파일 시스템의 COW 특성과 `tart clone`을 활용하여 스냅샷과 유사한 기능을 구현할 수 있다.

```bash
# 1. 기본 VM 생성 및 설정
tart clone ghcr.io/cirruslabs/ubuntu:latest snapshot-test
tart set snapshot-test --cpu 2 --memory 4096
tart run --no-graphics snapshot-test &
sleep 15

# 2. VM에 변경 사항 적용
VM_IP=$(tart ip snapshot-test)
ssh admin@$VM_IP "sudo apt-get update && sudo apt-get install -y nginx"
ssh admin@$VM_IP "echo 'Hello World' | sudo tee /var/www/html/index.html"

# 3. "스냅샷" 생성 (VM 정지 → clone → VM 재시작)
tart stop snapshot-test
tart clone snapshot-test snapshot-test-backup-01  # 스냅샷 역할
tart run --no-graphics snapshot-test &
sleep 15

# 4. VM에 추가 변경 (실수로 잘못된 변경을 한다고 가정)
VM_IP=$(tart ip snapshot-test)
ssh admin@$VM_IP "sudo rm -rf /var/www/html/*"  # 웹 서버 콘텐츠 삭제
ssh admin@$VM_IP "sudo systemctl stop nginx"

# 5. "스냅샷"으로 복구
tart stop snapshot-test
tart delete snapshot-test
tart clone snapshot-test-backup-01 snapshot-test  # 백업에서 복구
tart run --no-graphics snapshot-test &
sleep 15

# 6. 복구 확인
VM_IP=$(tart ip snapshot-test)
ssh admin@$VM_IP "curl -s http://localhost"  # "Hello World" 확인
ssh admin@$VM_IP "systemctl is-active nginx"  # active 확인

# 7. 정리
tart stop snapshot-test
tart delete snapshot-test
tart delete snapshot-test-backup-01
```

**스냅샷 관리 스크립트:**

```bash
#!/bin/bash
# snapshot.sh - Tart VM의 스냅샷을 관리하는 유틸리티

VM_NAME="$1"
ACTION="$2"  # create, restore, list, delete

case "$ACTION" in
    create)
        SNAP_NAME="${VM_NAME}-snap-$(date +%Y%m%d-%H%M%S)"
        tart stop "$VM_NAME" 2>/dev/null || true
        sleep 2
        tart clone "$VM_NAME" "$SNAP_NAME"
        tart run --no-graphics "$VM_NAME" &
        echo "스냅샷이 생성되었다: $SNAP_NAME"
        ;;
    restore)
        SNAP_NAME="$3"
        if [[ -z "$SNAP_NAME" ]]; then
            echo "복구할 스냅샷 이름을 지정해야 한다"
            exit 1
        fi
        tart stop "$VM_NAME" 2>/dev/null || true
        sleep 2
        tart delete "$VM_NAME"
        tart clone "$SNAP_NAME" "$VM_NAME"
        tart run --no-graphics "$VM_NAME" &
        echo "스냅샷에서 복구되었다: $SNAP_NAME → $VM_NAME"
        ;;
    list)
        tart list | grep "${VM_NAME}-snap"
        ;;
    delete)
        SNAP_NAME="$3"
        tart delete "$SNAP_NAME"
        echo "스냅샷이 삭제되었다: $SNAP_NAME"
        ;;
esac
```

---

## 예제

### 예제 1: VM 생성 스크립트
```bash
#!/bin/bash
# vm-create.sh - VM을 생성하고 기본 설정을 적용하는 스크립트

VM_NAME="test-node"
IMAGE="ghcr.io/cirruslabs/ubuntu:latest"
CPU=2
MEMORY=4096
DISK=30

# 이미지 Pull (없는 경우)
tart pull "$IMAGE" 2>/dev/null || true

# VM 생성 (clone은 캐시된 이미지에서 복제)
tart clone "$IMAGE" "$VM_NAME"

# VM 리소스 설정
tart set "$VM_NAME" --cpu "$CPU" --memory "$MEMORY" --disk-size "$DISK"

# MAC 주소 랜덤화 (고유 IP 할당 보장)
tart set "$VM_NAME" --random-mac

# VM 실행 (Headless + 디렉토리 공유)
tart run --no-graphics --dir=workspace:~/workspace "$VM_NAME" &

# IP 할당 대기 (DHCP 임대 완료까지)
echo "DHCP 임대 대기 중..."
for i in $(seq 1 30); do
  VM_IP=$(tart ip "$VM_NAME" 2>/dev/null)
  if [ -n "$VM_IP" ]; then
    echo "VM이 생성되었다: $VM_NAME ($VM_IP)"
    exit 0
  fi
  sleep 2
done
echo "IP 할당 시간이 초과되었다"
exit 1
```

### 예제 2: 다중 VM 생성 (프로젝트 클러스터 구성)
```bash
#!/bin/bash
# multi-vm.sh - 클러스터 노드를 한 번에 생성하는 스크립트

IMAGE="ghcr.io/cirruslabs/ubuntu:latest"

# 노드 정의: 이름:CPU:메모리(MB):디스크(GB)
NODES=(
  "platform-master:2:4096:20"
  "platform-worker1:3:12288:20"
  "platform-worker2:2:8192:20"
)

# 이미지 사전 다운로드
tart pull "$IMAGE" 2>/dev/null || true

for spec in "${NODES[@]}"; do
  IFS=':' read -r name cpu mem disk <<< "$spec"
  echo "=== $name 생성 중 (CPU: $cpu, MEM: ${mem}MB, DISK: ${disk}GB) ==="

  tart clone "$IMAGE" "$name"
  tart set "$name" --cpu "$cpu" --memory "$mem" --disk-size "$disk"
  tart set "$name" --random-mac
  tart run --no-graphics "$name" &
  sleep 3
done

# 모든 VM의 IP 출력 (DHCP 안정화 대기)
echo ""
echo "=== IP 할당 대기 중 (30초) ==="
sleep 30

for spec in "${NODES[@]}"; do
  name=$(echo "$spec" | cut -d: -f1)
  ip=$(tart ip "$name" 2>/dev/null || echo "할당 중")
  echo "$name: $ip"
done
```

### 예제 3: VM 이미지 빌드 및 레지스트리 배포
```bash
#!/bin/bash
# build-and-push.sh - 커스텀 VM 이미지를 빌드하여 레지스트리에 배포하는 스크립트

BASE_IMAGE="ghcr.io/cirruslabs/ubuntu:latest"
BUILD_VM="build-temp"
REGISTRY="ghcr.io/my-org"
TAG="custom-ubuntu:v1.0"

# 1. 베이스 이미지에서 빌드용 VM 생성
tart clone "$BASE_IMAGE" "$BUILD_VM"
tart set "$BUILD_VM" --cpu 4 --memory 8192
tart run --no-graphics "$BUILD_VM" &
sleep 20

# 2. SSH로 접속하여 커스터마이징
VM_IP=$(tart ip "$BUILD_VM")
ssh -o StrictHostKeyChecking=no admin@"$VM_IP" << 'REMOTE'
  sudo apt-get update
  sudo apt-get install -y curl wget git vim
  sudo apt-get clean
REMOTE

# 3. VM 중지 후 레지스트리에 Push
tart stop "$BUILD_VM"
tart push "$BUILD_VM" "$REGISTRY/$TAG"

# 4. 빌드용 VM 정리
tart delete "$BUILD_VM"
echo "이미지가 배포되었다: $REGISTRY/$TAG"
```

### 예제 4: Packer를 이용한 자동화 빌드

packer-plugin-tart를 사용하여 Golden Image를 선언적으로 빌드하는 HCL 예제이다.

```hcl
# k8s-golden.pkr.hcl

packer {
  required_plugins {
    tart = {
      version = ">= 1.12.0"
      source  = "github.com/cirruslabs/tart"
    }
  }
}

source "tart-cli" "k8s-golden" {
  # 베이스 이미지 설정
  from_ipsw    = ""  # Linux VM이므로 비워둔다
  vm_base_name = "ghcr.io/cirruslabs/ubuntu:latest"
  vm_name      = "k8s-golden-packer"

  # VM 리소스 설정
  cpu_count   = 2
  memory_gb   = 4
  disk_size_gb = 20

  # SSH 접속 설정
  ssh_username = "admin"
  ssh_password = "admin"
  ssh_timeout  = "120s"

  # Headless 모드
  headless = true

  # 추가 tart run 인자
  run_extra_args = ["--net-softnet-allow=0.0.0.0/0"]

  # VM 생성 후 대기 시간
  create_grace_time = "30s"
}

build {
  sources = ["source.tart-cli.k8s-golden"]

  # Step 1: OS 기본 설정
  provisioner "shell" {
    inline = [
      "sudo swapoff -a",
      "sudo sed -i '/swap/d' /etc/fstab",

      # 커널 모듈 설정
      "echo 'overlay' | sudo tee /etc/modules-load.d/k8s.conf",
      "echo 'br_netfilter' | sudo tee -a /etc/modules-load.d/k8s.conf",
      "sudo modprobe overlay",
      "sudo modprobe br_netfilter",

      # sysctl 설정
      "echo 'net.bridge.bridge-nf-call-iptables = 1' | sudo tee /etc/sysctl.d/k8s.conf",
      "echo 'net.bridge.bridge-nf-call-ip6tables = 1' | sudo tee -a /etc/sysctl.d/k8s.conf",
      "echo 'net.ipv4.ip_forward = 1' | sudo tee -a /etc/sysctl.d/k8s.conf",
      "sudo sysctl --system"
    ]
  }

  # Step 2: containerd 설치
  provisioner "shell" {
    inline = [
      "sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq",
      "sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq containerd apt-transport-https ca-certificates curl gnupg conntrack",
      "sudo mkdir -p /etc/containerd",
      "containerd config default | sudo tee /etc/containerd/config.toml",
      "sudo sed -i 's/SystemdCgroup = false/SystemdCgroup = true/' /etc/containerd/config.toml",
      "sudo systemctl restart containerd",
      "sudo systemctl enable containerd"
    ]
  }

  # Step 3: kubeadm 설치
  provisioner "shell" {
    environment_vars = [
      "K8S_VERSION=1.31"
    ]
    inline = [
      "curl -fsSL https://pkgs.k8s.io/core:/stable:/v$${K8S_VERSION}/deb/Release.key | sudo gpg --dearmor -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg",
      "echo \"deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/v$${K8S_VERSION}/deb/ /\" | sudo tee /etc/apt/sources.list.d/kubernetes.list",
      "sudo apt-get update -qq",
      "sudo apt-get install -y -qq kubelet kubeadm kubectl",
      "sudo apt-mark hold kubelet kubeadm kubectl",
      "sudo systemctl enable kubelet"
    ]
  }

  # Step 4: 컨테이너 이미지 사전 다운로드
  provisioner "shell" {
    inline = [
      "sudo kubeadm config images pull",
      "sudo ctr -n k8s.io images pull quay.io/cilium/cilium:v1.16.5 || true",
      "sudo ctr -n k8s.io images pull quay.io/cilium/operator-generic:v1.16.5 || true",
      "sudo ctr -n k8s.io images pull quay.io/cilium/hubble-relay:v1.16.5 || true"
    ]
  }

  # Step 5: 정리 및 마커 파일 생성
  provisioner "shell" {
    inline = [
      "echo 'k8s-golden:1.31' | sudo tee /etc/k8s-golden",
      "sudo apt-get clean",
      "sudo rm -rf /var/lib/apt/lists/*"
    ]
  }
}
```

```bash
# Packer 플러그인 설치
packer plugins install github.com/cirruslabs/tart

# 설정 검증
packer validate k8s-golden.pkr.hcl

# Golden Image 빌드
packer build k8s-golden.pkr.hcl

# 빌드된 이미지 확인
tart list | grep k8s-golden-packer

# 레지스트리에 Push (선택)
tart push k8s-golden-packer ghcr.io/my-org/k8s-golden:v1.31.0
```

### 예제 5: GitHub Actions CI/CD 워크플로우

Apple Silicon self-hosted 러너에서 Tart를 활용한 CI/CD 워크플로우 예제이다.

```yaml
# .github/workflows/tart-ci.yml
name: Tart VM CI/CD

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

env:
  VM_IMAGE: "ghcr.io/cirruslabs/ubuntu:latest"

jobs:
  # Job 1: Golden Image가 최신인지 확인
  check-golden:
    runs-on: [self-hosted, macOS, ARM64]
    outputs:
      needs-rebuild: ${{ steps.check.outputs.needs-rebuild }}
    steps:
      - name: Check Golden Image age
        id: check
        run: |
          if ! tart list | grep -q "k8s-golden"; then
            echo "needs-rebuild=true" >> $GITHUB_OUTPUT
          else
            echo "needs-rebuild=false" >> $GITHUB_OUTPUT
          fi

  # Job 2: 테스트 실행 (Ephemeral VM 패턴)
  test:
    runs-on: [self-hosted, macOS, ARM64]
    strategy:
      matrix:
        test-suite: [unit, integration, e2e]
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Create ephemeral VM
        id: create-vm
        run: |
          VM_NAME="ci-${{ matrix.test-suite }}-${{ github.run_number }}"
          echo "vm-name=$VM_NAME" >> $GITHUB_OUTPUT

          tart clone "$VM_IMAGE" "$VM_NAME"
          tart set "$VM_NAME" --cpu 2 --memory 4096
          tart run --no-graphics --net-softnet-allow=0.0.0.0/0 "$VM_NAME" &

          # IP 할당 대기
          for i in $(seq 1 60); do
            IP=$(tart ip "$VM_NAME" 2>/dev/null || true)
            if [[ -n "$IP" ]]; then
              echo "vm-ip=$IP" >> $GITHUB_OUTPUT
              break
            fi
            sleep 3
          done

      - name: Run tests
        run: |
          VM_IP="${{ steps.create-vm.outputs.vm-ip }}"
          sshpass -p admin scp -o StrictHostKeyChecking=no \
            -r ./tests admin@$VM_IP:~/tests

          sshpass -p admin ssh -o StrictHostKeyChecking=no admin@$VM_IP \
            "cd ~/tests && ./run-${{ matrix.test-suite }}.sh"

      - name: Collect results
        if: always()
        run: |
          VM_IP="${{ steps.create-vm.outputs.vm-ip }}"
          sshpass -p admin scp -o StrictHostKeyChecking=no \
            admin@$VM_IP:~/tests/results.xml ./results-${{ matrix.test-suite }}.xml || true

      - name: Cleanup VM
        if: always()
        run: |
          VM_NAME="${{ steps.create-vm.outputs.vm-name }}"
          tart stop "$VM_NAME" 2>/dev/null || true
          sleep 2
          tart delete "$VM_NAME" 2>/dev/null || true

      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: test-results-${{ matrix.test-suite }}
          path: results-*.xml
```

### 예제 6: VM 모니터링 스크립트

실행 중인 모든 Tart VM의 상태를 모니터링하는 스크립트이다.

```bash
#!/bin/bash
# vm-monitor.sh - Tart VM 상태를 주기적으로 모니터링하는 스크립트

INTERVAL="${1:-10}"  # 기본 모니터링 간격: 10초
LOG_FILE="${2:-/tmp/tart-monitor.log}"

# 컬러 정의
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

header() {
    clear
    echo -e "${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║               Tart VM Monitor ($(date '+%Y-%m-%d %H:%M:%S'))            ║${NC}"
    echo -e "${CYAN}╠══════════════════════════════════════════════════════════════╣${NC}"
    printf "${CYAN}║${NC} %-20s %-8s %-16s %-6s %-6s ${CYAN}║${NC}\n" \
        "VM Name" "Status" "IP Address" "CPU" "MEM(MB)"
    echo -e "${CYAN}╠══════════════════════════════════════════════════════════════╣${NC}"
}

monitor_cycle() {
    header

    local running=0
    local stopped=0
    local total=0

    # tart list 출력을 파싱
    while IFS= read -r line; do
        # tart list 출력에서 VM 정보 추출
        local name=$(echo "$line" | awk '{print $2}')
        local status=$(echo "$line" | awk '{print $NF}')

        [[ -z "$name" || "$name" == "Name" ]] && continue

        total=$((total + 1))

        local ip="-"
        local cpu="-"
        local mem="-"

        if [[ "$status" == "running" ]]; then
            running=$((running + 1))
            ip=$(tart ip "$name" 2>/dev/null || echo "할당 중")

            # VM 설정 조회
            local config=$(tart get "$name" 2>/dev/null)
            if [[ -n "$config" ]]; then
                cpu=$(echo "$config" | jq -r '.cpuCount // "-"')
                mem=$(echo "$config" | jq -r '(.memorySize // 0) / 1048576 | floor')
            fi

            printf "${CYAN}║${NC} ${GREEN}%-20s %-8s${NC} %-16s %-6s %-6s ${CYAN}║${NC}\n" \
                "$name" "$status" "$ip" "$cpu" "$mem"
        else
            stopped=$((stopped + 1))
            printf "${CYAN}║${NC} ${RED}%-20s %-8s${NC} %-16s %-6s %-6s ${CYAN}║${NC}\n" \
                "$name" "$status" "$ip" "$cpu" "$mem"
        fi
    done < <(tart list 2>/dev/null)

    echo -e "${CYAN}╠══════════════════════════════════════════════════════════════╣${NC}"
    echo -e "${CYAN}║${NC} Total: $total | ${GREEN}Running: $running${NC} | ${RED}Stopped: $stopped${NC}          ${CYAN}║${NC}"

    # 호스트 리소스 표시
    local host_cpu=$(sysctl -n hw.ncpu)
    local host_mem=$(sysctl -n hw.memsize | awk '{printf "%.0f", $1/1073741824}')
    echo -e "${CYAN}║${NC} Host: ${host_cpu} cores, ${host_mem}GB RAM                              ${CYAN}║${NC}"

    # 디스크 사용량
    local tart_disk=$(du -sh ~/.tart/ 2>/dev/null | awk '{print $1}')
    echo -e "${CYAN}║${NC} Tart Storage: ${tart_disk:-N/A}                                    ${CYAN}║${NC}"
    echo -e "${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"

    # 로그 파일에 기록
    echo "$(date '+%Y-%m-%d %H:%M:%S') | Total:$total Running:$running Stopped:$stopped" >> "$LOG_FILE"
}

# SSH 연결 상태를 추가로 확인하는 함수
check_ssh() {
    local vm_name="$1"
    local ip=$(tart ip "$vm_name" 2>/dev/null)
    if [[ -n "$ip" ]]; then
        if timeout 3 bash -c "echo > /dev/tcp/$ip/22" 2>/dev/null; then
            echo "SSH OK"
        else
            echo "SSH FAIL"
        fi
    else
        echo "NO IP"
    fi
}

# 메인 루프
echo "Tart VM Monitor 시작 (간격: ${INTERVAL}초, 로그: ${LOG_FILE})"
echo "종료하려면 Ctrl+C를 누른다."

while true; do
    monitor_cycle
    sleep "$INTERVAL"
done
```

```bash
# 사용 방법
chmod +x vm-monitor.sh

# 기본 설정으로 실행 (10초 간격)
./vm-monitor.sh

# 5초 간격으로 실행
./vm-monitor.sh 5

# 30초 간격, 커스텀 로그 파일
./vm-monitor.sh 30 ~/tart-monitor.log
```

---

## 자가 점검

### 기본 개념
- [ ] Tart가 사용하는 Virtualization.framework와 Hypervisor.framework의 차이를 설명할 수 있는가?
- [ ] Virtualization.framework가 제공하는 가상 하드웨어 구성 요소(CPU, 디스크, 네트워크, VirtioFS, 디스플레이)를 나열할 수 있는가?
- [ ] OCI 이미지 형식이 무엇이며, Tart가 이를 어떻게 활용하는지 설명할 수 있는가?
- [ ] Golden Image의 개념과 `tart clone`의 동작 원리를 설명할 수 있는가?

### Virtualization.framework 심층
- [ ] VZVirtualMachineConfiguration의 주요 프로퍼티(cpuCount, memorySize, bootLoader, storageDevices, networkDevices)를 설명할 수 있는가?
- [ ] VZLinuxBootLoader와 VZEFIBootLoader의 차이를 설명하고, 각각 어떤 OS에서 사용되는지 아는가?
- [ ] Virtualization.framework가 내부적으로 Hypervisor.framework를 사용하는 계층 구조를 설명할 수 있는가?
- [ ] VZVirtioBlockDeviceConfiguration의 cachingMode(automatic, cached, uncached)의 차이를 설명할 수 있는가?
- [ ] macOS Ventura, Sonoma, Sequoia에서 각각 추가된 주요 Virtualization.framework 기능을 1개 이상 나열할 수 있는가?
- [ ] near-native 성능의 원리를 CPU, 메모리, 디스크 I/O 관점에서 설명할 수 있는가?

### Tart 내부 아키텍처
- [ ] Tart VM의 상태 전이(Created → Running → Stopped)와 각 상태에서 가능한 명령을 아는가?
- [ ] OCI 이미지의 세 구성 요소(manifest, config, layers)의 역할을 설명할 수 있는가?
- [ ] 로컬 저장소 구조(`~/.tart/vms/{name}/` 하위의 config.json, disk.img, nvram)를 설명할 수 있는가?
- [ ] Tart의 Lock 메커니즘이 왜 필요한지, 그리고 비정상 종료 시 어떻게 대처하는지 아는가?
- [ ] `tart ip` 명령이 내부적으로 DHCP 임대 파일(`/var/db/dhcpd_leases`)을 어떻게 파싱하는지 설명할 수 있는가?

### 네트워킹
- [ ] Shared(NAT), Bridged, Softnet 세 가지 네트워크 모드의 차이를 설명할 수 있는가?
- [ ] VM의 IP 할당 메커니즘(DHCP, vmnet, 서브넷 `192.168.64.0/24`)을 설명할 수 있는가?
- [ ] Bridged 모드에서 `--resolver=arp` 옵션이 필요한 이유를 설명할 수 있는가?
- [ ] vmnet.framework의 세 가지 동작 모드(VMNET_SHARED_MODE, VMNET_BRIDGED_MODE, VMNET_HOST_ONLY_MODE)를 설명할 수 있는가?
- [ ] Softnet 모드의 보안 특성(VM 간 격리, 호스트 접근 차단, 비특권 실행)을 설명할 수 있는가?
- [ ] NAT 모드에서 기본 서브넷(`192.168.64.0/24`)을 변경하는 방법을 아는가?
- [ ] SSH 포트 포워딩(-L 옵션)을 사용하여 VM 내부 서비스에 접근하는 방법을 아는가?
- [ ] VM 내부에서 DNS 설정(/etc/resolv.conf)을 변경하는 방법과 각 네트워크 모드별 DNS 동작을 아는가?

### Golden Image
- [ ] Golden Image의 설계 원칙(최소 충분, 불변성, 재현성, 계층화, 버전 관리)을 설명할 수 있는가?
- [ ] 이 프로젝트의 build-golden-image.sh가 수행하는 7단계를 순서대로 설명할 수 있는가?
- [ ] 이미지 크기 최적화 방법(apt 캐시 정리, 로그 정리, 제로 채우기)을 3가지 이상 나열할 수 있는가?

### 저장소 및 디스크
- [ ] `~/.tart/vms/`와 `~/.tart/cache/OCIs/`의 역할 차이를 설명할 수 있는가?
- [ ] 자동 정리(auto-prune) 기능의 동작 방식과 `TART_NO_AUTO_PRUNE` 환경변수의 용도를 아는가?
- [ ] `tart set --disk-size`로 디스크를 확장한 후 게스트 내에서 파티션을 확장하는 절차를 아는가?
- [ ] APFS의 COW 특성이 `tart clone`의 성능에 어떤 영향을 미치는지 설명할 수 있는가?
- [ ] disk.img가 sparse file인 이유와, `ls -la`와 `du -sh`의 결과가 다른 이유를 설명할 수 있는가?

### CI/CD 및 보안
- [ ] Ephemeral VM 패턴의 개념과 장점(깨끗한 환경, 재현성, 보안, 디스크 관리)을 설명할 수 있는가?
- [ ] Orchard의 역할과 대규모 Tart VM 오케스트레이션에서의 사용 방법을 아는가?
- [ ] VM 격리가 컨테이너 격리보다 보안적으로 강력한 이유를 설명할 수 있는가?
- [ ] SSH 키 기반 인증으로 전환하는 방법(ssh-copy-id, PasswordAuthentication 비활성화)을 아는가?

### 성능 최적화
- [ ] CPU 오버커밋 비율의 권장값과 워크로드 유형별 차이를 설명할 수 있는가?
- [ ] 메모리 오버커밋이 발생할 때의 증상(swap)과 대처법을 아는가?
- [ ] VM 내부에서 I/O 스케줄러를 none으로 변경하는 이유를 설명할 수 있는가?

### 트러블슈팅
- [ ] VM이 시작되지 않을 때의 주요 원인 3가지와 해결법을 아는가?
- [ ] IP 할당이 안 될 때의 진단 방법(DHCP 임대 파일 확인, MAC 주소 충돌 확인)을 아는가?
- [ ] macOS 시스템 로그에서 Virtualization.framework 관련 로그를 확인하는 `log show` 명령을 아는가?

### 실무 활용
- [ ] `tart push`/`tart pull`로 OCI 레지스트리에 이미지를 배포하고 가져올 수 있는가?
- [ ] `tart run --dir` 옵션으로 호스트 디렉토리를 게스트에 공유하고, macOS/Linux 각각에서 마운트하는 방법을 아는가?
- [ ] Headless 모드로 VM을 실행하고 SSH 접속할 수 있는가?
- [ ] 이 프로젝트에서 Tart가 4개 클러스터(platform, dev, staging, prod)의 VM을 어떻게 구성하는지 설명할 수 있는가?
- [ ] Rosetta를 활성화하여 Linux VM에서 x86_64 바이너리를 실행하는 방법을 아는가?
- [ ] packer-plugin-tart의 주요 옵션(vm_name, cpu_count, memory_gb, ssh_username, headless)을 아는가?
- [ ] tart clone을 활용한 VM 스냅샷/복구 패턴을 구현할 수 있는가?

---

## 참고문헌

- [Tart 공식 웹사이트](https://tart.run/) - 공식 문서, 퀵스타트, 통합 가이드
- [Tart GitHub 저장소](https://github.com/cirruslabs/tart) - 소스 코드, 이슈 트래커, 릴리스
- [Tart Quick Start 가이드](https://tart.run/quick-start/) - 설치, VM 생성, SSH 접속, 디렉토리 공유 가이드
- [Tart FAQ](https://tart.run/faq/) - 네트워킹, 디스크 관리, 트러블슈팅
- [Apple Virtualization.framework 문서](https://developer.apple.com/documentation/virtualization) - Tart가 사용하는 가상화 프레임워크 공식 문서
- [Apple Hypervisor.framework 문서](https://developer.apple.com/documentation/hypervisor) - 저수준 CPU 가상화 프레임워크 공식 문서
- [OCI Image Spec](https://github.com/opencontainers/image-spec) - Tart VM 이미지가 따르는 OCI 표준 명세
- [Tart Packer Plugin](https://github.com/cirruslabs/packer-plugin-tart) - Packer를 이용한 자동화된 VM 이미지 빌드
- [Orchard Orchestration](https://github.com/cirruslabs/orchard) - Tart VM을 대규모로 관리하는 오케스트레이션 도구
- [Tart GitHub Discussions](https://github.com/cirruslabs/tart/discussions) - 커뮤니티 질의응답 및 토론
- [vmnet.framework 개요](https://developer.apple.com/documentation/vmnet) - macOS 가상 네트워크 프레임워크 공식 문서
- [Cosign (Sigstore)](https://github.com/sigstore/cosign) - OCI 이미지 서명 및 검증 도구
- [Cirrus CI](https://cirrus-ci.org/) - Tart와 네이티브 통합되는 CI/CD 플랫폼
