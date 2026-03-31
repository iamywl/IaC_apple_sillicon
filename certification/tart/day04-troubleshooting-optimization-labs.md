# Day 4: 트러블슈팅, 성능 최적화, 실습

> VM 시작 문제, IP 할당 문제, 디스크 공간 부족, 네트워크 연결 실패, SSH 접속 실패, 성능 저하 진단, CPU/메모리/디스크 I/O 최적화, VM density 최적화, 그리고 Tart 설치부터 Golden Image 빌드, 포트 포워딩, 스냅샷까지의 실습을 다룬다.

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
