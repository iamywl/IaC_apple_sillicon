# Day 2: Tart 내부 아키텍처 및 네트워킹 심화

> Tart의 Swift CLI 구조, VM 상태 머신, OCI 이미지 레이어 관리, 로컬 저장소 구조, Lock 메커니즘, IP 할당 메커니즘, Packer 플러그인, vmnet.framework 내부 구조, NAT/Bridged/Softnet 모드 상세, 포트 포워딩, DNS, 네트워크 성능 튜닝을 다룬다.

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
