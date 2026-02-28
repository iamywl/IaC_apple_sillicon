# Tart — macOS 네이티브(Native) VM(Virtual Machine) 런타임(Runtime)

## 개요(Overview)

[Tart](https://github.com/cirruslabs/tart)는 macOS에서 가벼운 VM을 생성하고 관리하기 위한 도구. 내부적으로 Apple의 `Hypervisor.framework`를 활용하여 ARM(Advanced RISC Machine) 기반 Mac에서 네이티브 성능으로 가상 머신을 실행한다.

## 특징(Features)

- **macOS 네이티브(Native)**: Hypervisor.framework 사용 — 성능 및 전력 효율 우수
- **OCI(Open Container Initiative) 이미지 사용**: 컨테이너 이미지 포맷으로 VM 이미지 관리
- **간단한 CLI(Command Line Interface)**: `tart clone`, `tart set`, `tart run`, `tart ip`, `tart stop`, `tart delete` 등
- **Softnet 네트워킹(Networking)**: `--net-softnet-allow` 플래그로 VM 간 직접 통신 지원

## 설치(Installation)

```bash
brew install tart
```

## 본 프로젝트에서의 사용법(Usage in This Project)

### 기본 이미지(Base Image)

```
ghcr.io/cirruslabs/ubuntu:latest    # Ubuntu 24.04 ARM64
```

골든 이미지(Golden Image) 빌드 후:
```
k8s-golden                          # containerd + kubeadm + K8s/Cilium 이미지 내장
```

### 주요 명령어(Key Commands)

| 명령(Command) | 설명(Description) |
|------|------|
| `tart clone <이미지> <vm-name>` | OCI 이미지로부터 VM 복제(Clone) |
| `tart set <vm-name> --cpu <n> --memory <MB>` | CPU/메모리(Memory) 리소스(Resource) 설정 |
| `tart run <vm-name> --no-graphics --net-softnet-allow=0.0.0.0/0` | VM 부팅(Boot) — **softnet 필수** |
| `tart ip <vm-name>` | VM의 DHCP(Dynamic Host Configuration Protocol) 할당 IP(Internet Protocol) 확인 |
| `tart stop <vm-name>` | VM 정지(Stop) |
| `tart delete <vm-name>` | VM 삭제(Delete) |
| `tart list` | 전체 VM 목록 및 상태(Status) 확인 |

### Softnet 네트워킹(Software Networking) — 필수 설정

Tart 기본 shared networking(NAT, Network Address Translation)에서는 **VM 간 직접 통신이 차단**됨.
멀티클러스터(Multi-cluster) K8s(Kubernetes) 환경에서는 `--net-softnet-allow` 플래그가 **필수**:

```bash
# 이 플래그 없이는 kubeadm join 실패 (VM→VM 통신 불가)
tart run "$vm_name" --no-graphics --net-softnet-allow=0.0.0.0/0 &
```

- Softnet 모드에서 IP 대역은 `192.168.65.x`
- 기본 NAT 모드의 `192.168.66.x`와 다름에 주의
- 상세: [BUG-003 — VM 간 통신 불가](bug-reports/20260227_010000_installation.md#bug-003-vm-간-통신communication-불가--shared-network)

### VM 라이프사이클(Lifecycle) — `scripts/lib/vm.sh`

```
tart clone (이미지 복제)
  → tart set (CPU/메모리 할당)
    → tart run --net-softnet-allow (부팅)
      → tart ip (IP 대기 — 폴링)
        → SSH 접속 (admin:admin)
          → tart stop (종료)
            → tart delete (삭제)
```

### SSH(Secure Shell) 접속

모든 VM 공통:
```bash
ssh admin@$(tart ip dev-worker1)    # 비밀번호(Password): admin
```

## 참고 링크(References)

- Tart GitHub: https://github.com/cirruslabs/tart
- Tart 공식 문서(Official Docs): https://tart.run/
- 설치: `brew install tart`
