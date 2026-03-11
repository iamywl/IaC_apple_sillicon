# 02. 가상화란 무엇인가 -- Tart와 Apple Silicon

> **시리즈**: Apple Silicon Mac 한 대로 프로덕션급 멀티클러스터 Kubernetes 구축하기
>
> **대상 독자**: "가상 머신"이라는 단어를 들어봤지만, 실제로 만들어본 적은 없는 분.

---

## 가상화란 무엇인가?

### 비유: 하나의 건물, 여러 개의 아파트

큰 건물 한 채가 있다고 하자. 이 건물을 통째로 한 가족이 쓸 수도 있지만, 벽을 세우고 층을 나눠서 여러 가구가 독립적으로 살 수 있게 할 수도 있다.

각 가구는:
- **자기만의 주방, 화장실, 거실**이 있다 (독립된 자원)
- **옆집에서 무슨 일이 일어나는지 모른다** (격리)
- **건물 전체의 전기, 수도는 공유한다** (물리 자원 공유)

**가상화(Virtualization)**도 똑같다.

- **건물** = 여러분의 MacBook (물리 컴퓨터)
- **아파트** = VM (가상 머신)
- **벽과 층** = 하이퍼바이저 (가상화 소프트웨어)

하나의 MacBook에서 10개의 독립된 "컴퓨터"를 만들어 쓸 수 있다. 각 VM은 자기만의 운영체제, 자기만의 CPU 할당량, 자기만의 메모리를 가진다.

### 왜 이게 필요한가?

쿠버네티스 클러스터를 구축하려면 **여러 대의 컴퓨터**가 필요하다. 실제 회사에서는 서버실에 물리 서버 10대를 놓지만, 학습이나 실험을 위해 서버 10대를 사는 건 현실적이지 않다.

가상화를 쓰면:

| 물리 서버 10대 | VM 10대 |
|--------------|---------|
| 비용: 수천만 원 | 비용: 0원 (이미 갖고 있는 Mac 사용) |
| 공간: 서버실 필요 | 공간: 노트북 한 대 |
| 관리: 전기세, 냉각, 네트워크 배선 | 관리: `tart start`, `tart stop` 명령어 |
| 초기화: 운영체제 재설치 | 초기화: `tart delete` 후 다시 `tart clone` |

이 프로젝트에서는 Mac 한 대에 **10개의 Ubuntu VM**을 만들어서, 4개의 쿠버네티스 클러스터를 구성한다.

---

## 하이퍼바이저: 가상화를 가능하게 하는 핵심

### Type 1 vs Type 2 하이퍼바이저

하이퍼바이저(Hypervisor)는 VM을 만들고 관리하는 소프트웨어다. 아파트 비유에서 "벽과 층을 만드는 건설 시스템"에 해당한다.

하이퍼바이저에는 두 가지 타입이 있다:

```
[Type 1: 베어메탈 하이퍼바이저]

  +--------+  +--------+  +--------+
  |  VM 1  |  |  VM 2  |  |  VM 3  |
  +--------+  +--------+  +--------+
  +------------------------------------+
  |        하이퍼바이저 (Type 1)        |    <-- OS 없이 하드웨어 위에 직접
  +------------------------------------+
  +------------------------------------+
  |           물리 하드웨어              |
  +------------------------------------+

  예시: VMware ESXi, Microsoft Hyper-V, KVM


[Type 2: 호스트형 하이퍼바이저]

  +--------+  +--------+  +--------+
  |  VM 1  |  |  VM 2  |  |  VM 3  |
  +--------+  +--------+  +--------+
  +------------------------------------+
  |        하이퍼바이저 (Type 2)        |    <-- 일반 앱처럼 OS 위에서 실행
  +------------------------------------+
  +------------------------------------+
  |           호스트 운영체제            |    <-- macOS, Windows 등
  +------------------------------------+
  +------------------------------------+
  |           물리 하드웨어              |
  +------------------------------------+

  예시: VirtualBox, VMware Workstation
```

**Type 1**은 하드웨어 위에 직접 올라간다. 데이터센터의 서버에서 사용한다. 성능이 좋지만 일반 PC에서는 쓰기 어렵다.

**Type 2**는 운영체제(macOS, Windows) 위에서 일반 앱처럼 실행된다. VirtualBox를 설치해본 적이 있다면 Type 2를 사용해본 것이다. 편리하지만 한 계층을 더 거치므로 성능 손실이 있다.

### Apple Hypervisor.framework -- 둘의 장점을 합치다

Apple Silicon(M1, M2, M3, M4) Mac에는 특별한 것이 있다. Apple이 macOS에 **Hypervisor.framework**라는 것을 내장해두었다.

이것은 Type 1과 Type 2의 장점을 합친 구조다:
- macOS 위에서 실행되므로 **편리하다** (Type 2의 장점)
- 하드웨어의 가상화 기능을 **직접** 사용하므로 **빠르다** (Type 1에 가까운 성능)
- ARM64 칩의 가상화 확장(VHE)을 네이티브로 활용

쉽게 말해, macOS가 "나를 통해서 하드웨어 가상화 기능을 직접 쓸 수 있어"라고 앱에게 문을 열어주는 것이다.

### Tart: Apple Silicon을 위한 VM 관리 도구

**Tart**는 이 Hypervisor.framework 위에서 동작하는 VM 관리 도구다.

기존 도구들과 비교하면:

| | VirtualBox | Docker Desktop | **Tart** |
|---|-----------|---------------|----------|
| Apple Silicon 지원 | 불안정 | O (리눅스 커널 에뮬레이션) | **네이티브** |
| 가상화 방식 | Type 2 (느림) | 경량 VM + 컨테이너 | Hypervisor.framework (빠름) |
| ARM64 게스트 | X (x86 에뮬레이션) | 컨테이너만 | **네이티브 ARM64 VM** |
| 쿠버네티스 클러스터 구축 | 가능하나 느림 | 제한적 (Docker Desktop K8s) | **최적** |
| CLI 관리 | GUI 위주 | `docker` 명령어 | `tart` 명령어 |

Tart가 이 프로젝트에 적합한 이유:
1. Apple Silicon에서 **네이티브 속도**로 Linux VM을 돌릴 수 있다
2. CLI 기반이라 **스크립트로 자동화**하기 좋다
3. 가볍고 빠르다 -- VM 하나 만드는 데 몇 초면 된다

---

## 골든 이미지: 왜 미리 구워놓는가?

### 비유: 반조리 식품

레스토랑에서 매 주문마다 양파를 까고, 감자를 씻고, 고기를 손질하면 시간이 너무 오래 걸린다. 그래서 **미리 손질해둔 재료(미장플라스, mise en place)**를 준비해놓는다.

골든 이미지(Golden Image)도 같은 개념이다.

- **골든 이미지 없이**: VM 10대 각각에 containerd 설치, kubeadm 설치, 커널 설정... 반복 작업
- **골든 이미지 사용**: 이 모든 것이 미리 설치된 VM "틀"에서 10대를 복제

```
일반 방식:
  기본 Ubuntu -> VM 1 생성 -> containerd 설치 -> kubeadm 설치 -> 커널 설정
  기본 Ubuntu -> VM 2 생성 -> containerd 설치 -> kubeadm 설치 -> 커널 설정
  기본 Ubuntu -> VM 3 생성 -> containerd 설치 -> kubeadm 설치 -> 커널 설정
  ... (10번 반복)

골든 이미지 방식:
  기본 Ubuntu -> containerd + kubeadm + 커널 설정 = [골든 이미지]
  [골든 이미지] -> VM 1 복제 (이미 다 설치됨!)
  [골든 이미지] -> VM 2 복제 (이미 다 설치됨!)
  [골든 이미지] -> VM 3 복제 (이미 다 설치됨!)
  ... (복제만 하면 됨, 설치 과정 스킵)
```

### 왜 이게 필요한가?

| | 골든 이미지 없이 | 골든 이미지 사용 |
|---|----------------|----------------|
| 전체 설치 시간 | 45~60분 | **15~20분** |
| Phase 2~4 실행 | 10대 모두 실행 | **스킵** |
| 네트워크 의존성 | APT 패키지 10번 다운로드 | 최초 1회만 다운로드 |
| 실패 가능성 | APT 서버 장애 시 10번 실패 가능 | 골든 이미지 빌드 시 1번만 위험 |

### 실제 프로젝트에서는

골든 이미지를 만드는 명령:

```bash
./scripts/build-golden-image.sh    # 약 10분 소요
```

빌드가 끝나면 `clusters.json`의 `base_image`를 바꿔준다:

```diff
- "base_image": "ghcr.io/cirruslabs/ubuntu:latest",
+ "base_image": "k8s-golden",
```

이후부터는 VM을 만들 때 `k8s-golden`에서 복제하므로, containerd와 kubeadm이 이미 설치된 상태로 시작한다.

---

## clusters.json: 10대의 VM이 어떻게 정의되는가

이 프로젝트의 모든 VM 정보는 `config/clusters.json` 하나에 담겨 있다. 전체 내용을 보자:

```json
{
  "base_image": "ghcr.io/cirruslabs/ubuntu:latest",
  "ssh_user": "admin",
  "ssh_password": "admin",
  "clusters": [
    {
      "name": "platform",
      "pod_cidr": "10.10.0.0/16",
      "service_cidr": "10.96.0.0/16",
      "nodes": [
        { "name": "platform-master", "role": "master", "cpu": 2, "memory": 4096, "disk": 20 },
        { "name": "platform-worker1", "role": "worker", "cpu": 3, "memory": 12288, "disk": 20 },
        { "name": "platform-worker2", "role": "worker", "cpu": 2, "memory": 8192, "disk": 20 }
      ]
    },
    {
      "name": "dev",
      "pod_cidr": "10.20.0.0/16",
      "service_cidr": "10.97.0.0/16",
      "nodes": [
        { "name": "dev-master", "role": "master", "cpu": 2, "memory": 4096, "disk": 20 },
        { "name": "dev-worker1", "role": "worker", "cpu": 2, "memory": 8192, "disk": 20 }
      ]
    },
    {
      "name": "staging",
      "pod_cidr": "10.30.0.0/16",
      "service_cidr": "10.98.0.0/16",
      "nodes": [
        { "name": "staging-master", "role": "master", "cpu": 2, "memory": 4096, "disk": 20 },
        { "name": "staging-worker1", "role": "worker", "cpu": 2, "memory": 8192, "disk": 20 }
      ]
    },
    {
      "name": "prod",
      "pod_cidr": "10.40.0.0/16",
      "service_cidr": "10.99.0.0/16",
      "nodes": [
        { "name": "prod-master", "role": "master", "cpu": 2, "memory": 3072, "disk": 20 },
        { "name": "prod-worker1", "role": "worker", "cpu": 2, "memory": 8192, "disk": 20 },
        { "name": "prod-worker2", "role": "worker", "cpu": 2, "memory": 8192, "disk": 20 }
      ]
    }
  ]
}
```

### 각 필드 설명

| 필드 | 의미 | 비유 |
|------|------|------|
| `base_image` | VM을 복제할 원본 이미지 | 아파트 "기본 설계도" |
| `ssh_user` / `ssh_password` | VM에 접속할 계정 정보 | 아파트 마스터 키 |
| `name` (cluster) | 클러스터 이름 | 아파트 "동" 이름 (A동, B동) |
| `pod_cidr` | Pod가 사용할 IP 대역 | 각 동의 호수 범위 (101~199호) |
| `service_cidr` | Service가 사용할 IP 대역 | 각 동의 공용 시설 번호 |
| `name` (node) | 개별 VM 이름 | 아파트 호수 (A동 101호) |
| `role` | master 또는 worker | 관리실 vs 일반 세대 |
| `cpu` | 할당할 CPU 코어 수 | 방 개수 |
| `memory` | 할당할 메모리 (MB) | 방 크기 (평수) |
| `disk` | 디스크 크기 (GB) | 창고 크기 |

### VM 스펙 총정리

| VM 이름 | 클러스터 | 역할 | CPU | 메모리 | 하는 일 |
|---------|---------|------|-----|--------|---------|
| platform-master | platform | master | 2 | 4 GB | 컨트롤 플레인 (API 서버, 스케줄러) |
| platform-worker1 | platform | worker | 3 | 12 GB | Prometheus + Grafana + Loki + AlertManager |
| platform-worker2 | platform | worker | 2 | 8 GB | Jenkins + ArgoCD |
| dev-master | dev | master | 2 | 4 GB | 컨트롤 플레인 |
| dev-worker1 | dev | worker | 2 | 8 GB | 데모 앱 + Istio + HPA 대상 워크로드 |
| staging-master | staging | master | 2 | 4 GB | 컨트롤 플레인 |
| staging-worker1 | staging | worker | 2 | 8 GB | 사전 검증 워크로드 |
| prod-master | prod | master | 2 | 3 GB | 컨트롤 플레인 |
| prod-worker1 | prod | worker | 2 | 8 GB | 프로덕션 워크로드 |
| prod-worker2 | prod | worker | 2 | 8 GB | 프로덕션 워크로드 (이중화) |

**합계: 10대 VM / 21 vCPU / 약 71.5 GB RAM**

platform-worker1이 3 CPU, 12 GB로 가장 큰 이유는? Prometheus와 Grafana 같은 모니터링 도구가 메트릭 데이터를 대량으로 처리해야 하기 때문이다. 반면 prod-master가 3 GB로 가장 작은 이유는, master는 "명령만 내리는 역할"이라 실제 워크로드를 돌리지 않기 때문이다.

---

## Tart 명령어: VM의 생명주기

### 핵심 명령어 3가지

VM을 다루는 기본 명령어는 세 가지다:

```bash
# 1. 복제 (Clone) -- 원본 이미지에서 새 VM 만들기
tart clone ghcr.io/cirruslabs/ubuntu:latest platform-master

# 2. 시작 (Start) -- VM 부팅
tart run platform-master --no-graphics

# 3. IP 확인 -- VM의 네트워크 주소 얻기
tart ip platform-master
# 출력: 192.168.64.5
```

이것을 아파트로 비유하면:
1. **clone** = 설계도대로 새 아파트 한 세대를 시공
2. **run** = 전기와 수도를 연결 (입주 가능 상태로 만들기)
3. **ip** = 새 세대의 주소 확인

### 기타 유용한 명령어

```bash
# VM 목록 확인
tart list

# VM 사양 변경 (CPU, 메모리)
tart set platform-master --cpu 2 --memory 4096

# VM 정지
tart stop platform-master

# VM 삭제
tart delete platform-master
```

---

## scripts/lib/vm.sh -- 자동화의 핵심

이 프로젝트는 위의 Tart 명령어를 직접 치지 않는다. 대신 `scripts/lib/vm.sh`에 함수로 감싸두었다.

### VM 존재 여부 확인

```bash
vm_exists() {
  local vm_name="$1"
  tart list | grep -q "local.*${vm_name}" 2>/dev/null
}
```

이미 만들어진 VM을 또 만들려고 하면 에러가 난다. 이 함수로 먼저 "이미 있는지" 확인한다.

### VM 복제 (안전하게)

```bash
vm_clone() {
  local vm_name="$1"
  local base_image
  base_image="$(get_base_image)"

  if vm_exists "$vm_name"; then
    log_warn "VM '$vm_name' already exists, skipping clone."
    return 0
  fi

  log_info "Cloning '$base_image' -> '$vm_name'..."
  tart clone "$base_image" "$vm_name"
}
```

핵심은 `if vm_exists` 체크다. 이미 존재하면 건너뛴다. 이것을 **멱등성(idempotency)**이라고 한다 -- "여러 번 실행해도 결과가 같다"는 뜻이다. 스크립트가 중간에 실패해서 다시 실행해도, 이미 완료된 부분은 건너뛰고 실패한 부분부터 이어간다.

### 리소스 설정

```bash
vm_set_resources() {
  local vm_name="$1" cpu="$2" memory="$3"
  log_info "Setting resources for '$vm_name': ${cpu} CPU, ${memory}MB RAM"
  tart set "$vm_name" --cpu "$cpu" --memory "$memory"
}
```

`clusters.json`에서 읽은 CPU와 메모리 값을 VM에 적용한다.

### IP 대기 -- 가장 까다로운 부분

```bash
vm_wait_for_ip() {
  local vm_name="$1"
  local max_attempts="${2:-60}"
  local ip=""

  log_info "Waiting for IP on '$vm_name'..."
  for ((i=1; i<=max_attempts; i++)); do
    ip=$(vm_get_ip "$vm_name" 2>/dev/null || true)
    if [[ -n "$ip" ]]; then
      log_info "'$vm_name' got IP: $ip"
      echo "$ip"
      return 0
    fi
    sleep 3
  done
  die "Timeout waiting for IP on '$vm_name'"
}
```

### 왜 이게 필요한가?

VM을 시작(`tart run`)하면 바로 IP가 나오지 않는다. VM이 부팅되고, 운영체제가 올라오고, 네트워크 인터페이스가 활성화되고, DHCP 서버에서 IP를 받아야 한다. 이 과정에 몇 초에서 수십 초가 걸린다.

수동이라면 "IP 나왔나?" 하고 계속 `tart ip`를 치겠지만, 자동화에서는 이 함수가 **3초마다, 최대 60번(3분)** 자동으로 확인해준다.

### VM 일괄 생성

```bash
vm_create_all() {
  local base_image
  base_image="$(get_base_image)"

  log_section "Pulling base image"
  if ! tart list | grep -q "$base_image"; then
    log_info "Pulling $base_image..."
    tart pull "$base_image"
  else
    log_info "Base image already cached."
  fi

  for cluster_name in $(get_cluster_names); do
    for node_name in $(get_nodes_for_cluster "$cluster_name"); do
      local cpu memory
      cpu=$(get_node_cpu "$cluster_name" "$node_name")
      memory=$(get_node_memory "$cluster_name" "$node_name")

      vm_clone "$node_name"
      vm_set_resources "$node_name" "$cpu" "$memory"
    done
  done
}
```

이 함수 하나가 호출되면:

1. 베이스 이미지를 다운로드하고 (이미 있으면 스킵)
2. `clusters.json`에서 모든 클러스터 이름을 읽고
3. 각 클러스터의 모든 노드에 대해 루프를 돌면서
4. VM 복제 + 리소스 설정을 수행한다

**10대의 VM이 자동으로 만들어진다.** 수동으로 `tart clone`을 10번 치는 것과 비교해보자.

---

## Phase 1 실행: 01-create-vms.sh

이 모든 것이 실제로 실행되는 곳은 `scripts/install/01-create-vms.sh`이다:

```bash
#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/vm.sh"

log_section "Phase 1: Creating VMs"
vm_create_all
log_info "All VMs created successfully."
```

놀라울 정도로 짧다. 단 3줄이다.

1. `vm.sh` 라이브러리를 불러오고
2. `vm_create_all` 함수를 호출하고
3. 완료 메시지를 출력한다

복잡한 로직은 모두 `vm.sh`에 캡슐화되어 있다. 이것이 좋은 코드 구조의 핵심이다 -- **각 파일이 한 가지 일만 한다.**

---

## 실제 실행 흐름 따라가기

전체 흐름을 시간 순으로 정리하면:

```
[demo.sh 실행]
  |
  +-> install.sh 호출
        |
        +-> 01-create-vms.sh (Phase 1)
              |
              +-> vm_create_all()
                    |
                    +-> tart pull ghcr.io/cirruslabs/ubuntu:latest
                    |     (베이스 이미지 다운로드, 약 1분)
                    |
                    +-> for each cluster (platform, dev, staging, prod):
                    |     for each node:
                    |       tart clone ubuntu -> platform-master
                    |       tart set platform-master --cpu 2 --memory 4096
                    |       tart clone ubuntu -> platform-worker1
                    |       tart set platform-worker1 --cpu 3 --memory 12288
                    |       ... (10대 반복)
                    |
                    +-> vm_start_all()
                          |
                          +-> for each VM:
                                tart run <vm> --no-graphics &
                                vm_wait_for_ip <vm>   (3초 간격 폴링)
```

---

## 네트워크: VM끼리 어떻게 통신하나?

모든 VM이 같은 Mac 안에서 돌아가고 있다. 그러면 VM끼리 어떻게 서로 "대화"할 수 있을까?

Tart는 `--net-softnet-allow=0.0.0.0/0` 옵션으로 VM을 시작한다:

```bash
tart run "$vm_name" --no-graphics --net-softnet-allow=0.0.0.0/0 &
```

이 옵션은 VM이 Mac의 네트워크에 접근할 수 있게 해준다. 각 VM은 DHCP를 통해 `192.168.64.x` 대역의 IP를 받게 되고, 같은 대역에 있으므로 VM끼리 서로 통신할 수 있다.

아파트 비유로 하면, 같은 건물 안의 아파트끼리는 **내부 복도(내부 네트워크)**를 통해 오갈 수 있는 것과 같다.

---

## 정리: 이 글에서 배운 것

| 개념 | 한 줄 설명 |
|------|-----------|
| **가상화** | 물리 컴퓨터 한 대에서 여러 개의 독립된 가상 컴퓨터를 만드는 기술 |
| **하이퍼바이저** | 가상화를 가능하게 하는 소프트웨어 (Type 1: 베어메탈, Type 2: 호스트형) |
| **Hypervisor.framework** | Apple이 macOS에 내장한 가상화 프레임워크 (하드웨어 직접 접근) |
| **Tart** | Hypervisor.framework 기반의 VM 관리 CLI 도구 |
| **골든 이미지** | 공통 설정을 미리 구워놓은 VM 템플릿 (설치 시간 단축) |
| **clusters.json** | 10대 VM의 모든 설정이 담긴 단일 설정 파일 |
| **멱등성** | 여러 번 실행해도 결과가 같은 성질 (vm_exists 체크) |
| **vm.sh** | VM 생명주기 관리 함수 라이브러리 (clone, start, stop, wait_for_ip) |

---

## 다음 글 미리보기

VM이 만들어졌다. 이제 이 VM 안에 **무엇을** 넣을 것인가?

다음 글에서는:
- 컨테이너란 무엇이고, VM과 뭐가 다른가?
- 쿠버네티스는 왜 필요한가?
- master와 worker는 무슨 역할인가?
- 이 프로젝트에서 4개의 클러스터를 어떻게 초기화하는가?

[<- 이전 글: 01. 왜 이 프로젝트를 만들었는가](./01-introduction.md) | [다음 글: 03. 컨테이너와 쿠버네티스 첫걸음 ->](./03-containers-and-kubernetes.md)
