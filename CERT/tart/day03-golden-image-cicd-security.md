# Day 3: Golden Image 전략, CI/CD 환경, 보안

> Golden Image 설계 원칙, 이미지 빌드 자동화(Packer), 계층화 전략, 크기 최적화, 버전 관리, CI/CD 파이프라인에서의 Tart 활용(Cirrus CI, GitHub Actions, Orchard), Ephemeral VM 패턴, VM 격리 보안, 네트워크 격리, 이미지 서명, SSH 키 관리, 디스크 암호화를 다룬다.

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
