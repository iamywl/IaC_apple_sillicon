# Day 5: 예제, 자가 점검, 참고문헌

> VM 생성 스크립트, 다중 VM 생성, 이미지 빌드 및 배포, Packer HCL 예제, GitHub Actions CI/CD 워크플로우, VM 모니터링 스크립트 등의 실전 예제와 학습 내용 자가 점검, 참고문헌을 다룬다.

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
