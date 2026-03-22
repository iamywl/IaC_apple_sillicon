# 03. 컨테이너와 쿠버네티스 — 기초부터 클러스터 구축까지

## 목차

1. [컨테이너란 무엇인가?](#컨테이너란-무엇인가)
2. [containerd: 컨테이너를 실행하는 엔진](#containerd-컨테이너를-실행하는-엔진)
3. [쿠버네티스: 왜 오케스트레이션이 필요한가?](#쿠버네티스-왜-오케스트레이션이-필요한가)
4. [Master와 Worker: 역할 분담](#master와-worker-역할-분담)
5. [핵심 개념: Pod, Deployment, Service, Namespace](#핵심-개념-pod-deployment-service-namespace)
6. [4개 클러스터, 4가지 목적](#4개-클러스터-4가지-목적)
7. [설치 파이프라인: 17단계 자동화](#설치-파이프라인-17단계-자동화)
8. [Phase 1: VM 생성](#phase-1-vm-생성)
9. [Phase 2: 노드 준비](#phase-2-노드-준비)
10. [Phase 3: containerd 설치](#phase-3-containerd-설치)
11. [Phase 4: kubeadm 설치](#phase-4-kubeadm-설치)
12. [Phase 5: 클러스터 초기화](#phase-5-클러스터-초기화)
13. [Phase 6: Cilium CNI 설치](#phase-6-cilium-cni-설치)
14. [Phase 7~12: 모니터링, CI/CD, 네트워크 정책](#phase-7-12-모니터링-cicd-네트워크-정책)
15. [골든 이미지로 설치 시간 단축](#골든-이미지로-설치-시간-단축)
16. [일상 운영 스크립트](#일상-운영-스크립트)
17. [정리](#정리)

---

## 컨테이너란 무엇인가?

**컨테이너(Container)**란, 애플리케이션과 그 실행에 필요한 라이브러리, 설정 파일 등을 하나의 격리된 패키지로 묶은 것이다. 컨테이너 런타임이 설치된 환경이라면 어디서든 동일하게 실행할 수 있고, 컨테이너끼리는 파일 시스템과 프로세스가 격리된다.

### VM과 컨테이너의 차이

```
[VM (가상 머신)]
+------------------+  +------------------+  +------------------+
|     App A        |  |     App B        |  |     App C        |
|   라이브러리      |  |   라이브러리      |  |   라이브러리      |
|   Guest OS       |  |   Guest OS       |  |   Guest OS       |
|  (Ubuntu 전체)   |  |  (Ubuntu 전체)   |  |  (CentOS 전체)   |
+------------------+  +------------------+  +------------------+
+------------------------------------------------------+
|                하이퍼바이저 (Tart)                      |
+------------------------------------------------------+
|                    Host OS (macOS)                     |
+------------------------------------------------------+


[컨테이너]
+----------+  +----------+  +----------+  +----------+
|  App A   |  |  App B   |  |  App C   |  |  App D   |
| 라이브러리|  | 라이브러리|  | 라이브러리|  | 라이브러리|
+----------+  +----------+  +----------+  +----------+
+------------------------------------------------------+
|              컨테이너 런타임 (containerd)               |
+------------------------------------------------------+
|                    Host OS (Ubuntu)                    |
+------------------------------------------------------+
```

핵심 차이:
- **VM**: 각각 **자체 운영체제**를 가진다. 무겁지만 완전히 격리된다.
- **컨테이너**: 호스트 OS의 **커널을 공유**한다. 가볍고 빠르지만, 격리 수준이 VM보다 낮다.

### 왜 컨테이너가 VM 위에 필요한가

VM은 커널 격리와 보안 경계를 제공하지만, **배포 단위**로는 비효율적이다. 그 이유는 다음과 같다.

| | VM만 사용 | VM + 컨테이너 |
|---|---------|-------------|
| nginx 하나 실행 | Ubuntu 전체 부팅 (수 GB, 30초+) | 컨테이너 실행 (수십 MB, 1초) |
| 앱 10개 실행 | VM 10대 = OS 10개 (리소스 낭비) | 컨테이너 10개 = OS 1개 (효율적) |
| 배포 | VM 이미지 전체 교체 | 컨테이너 이미지만 교체 |
| 확장 | 새 VM 부팅 (분 단위) | 새 컨테이너 실행 (초 단위) |

VM은 **인프라 계층**(노드, 커널, 네트워크 스택)을 격리하는 데 사용하고, 컨테이너는 **애플리케이션 계층**(배포, 스케일링, 롤백)을 표준화하는 데 사용한다. 이 계층 분리가 현대 인프라의 기본 구조이다.

컨테이너 이미지는 OCI(Open Container Initiative) 표준을 따르므로, 개발자가 로컬에서 빌드한 이미지가 어떤 노드에서든 동일하게 실행된다. VM 이미지는 하이퍼바이저마다 포맷이 다르지만, 컨테이너 이미지는 표준화되어 있어 배포 파이프라인의 단위로 적합하다.

이 프로젝트에서는 **둘 다** 사용한다:
- **VM**(Tart): 물리 서버 대신 가상 서버를 만드는 데 사용. 커널 격리와 독립적 네트워크 스택을 제공한다.
- **컨테이너**(containerd + K8s): 그 VM 안에서 실제 앱을 돌리는 데 사용. 리소스 효율성과 배포 표준화를 제공한다.

VM이 먼저 존재해야 하고, 그 VM 위에서 컨테이너를 빠르게 생성하거나 제거할 수 있다.

---

## containerd: 컨테이너를 실행하는 엔진

### 컨테이너 런타임이란?

컨테이너는 마법으로 돌아가지 않는다. 컨테이너를 **만들고, 실행하고, 관리하는 프로그램**이 필요하다. 이것을 **컨테이너 런타임**이라고 한다.

"Docker"라는 이름을 들어봤을 수 있다. Docker가 바로 컨테이너 런타임의 하나다. 하지만 쿠버네티스는 2022년부터 Docker 대신 **containerd**를 표준으로 사용한다.

### CRI: Container Runtime Interface

쿠버네티스가 "이 컨테이너를 실행해줘"라고 요청하면, 그 요청을 받아서 실제로 컨테이너를 만드는 건 컨테이너 런타임이다. 이 둘 사이의 약속된 통신 규약을 **CRI(Container Runtime Interface)**라고 한다.

```
쿠버네티스 ----[CRI]----> containerd -----> 실제 컨테이너 실행
  "nginx 컨테이너             "알겠습니다.        nginx가 돌아감!
   시작해줘"                   격리 공간 만들고
                              nginx 이미지 받아서
                              실행합니다"
```

### 실제 프로젝트에서의 containerd 설치

`scripts/lib/k8s.sh`의 `install_containerd` 함수가 모든 VM에 containerd를 설치한다:

```bash
install_containerd() {
  local node_name="$1"
  local ip
  ip=$(vm_get_ip "$node_name")

  log_info "Installing containerd on '$node_name'..."

  ssh_exec_sudo "$ip" "
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq containerd apt-transport-https ca-certificates curl gnupg conntrack

    mkdir -p /etc/containerd
    containerd config default > /etc/containerd/config.toml
    sed -i 's/SystemdCgroup = false/SystemdCgroup = true/' /etc/containerd/config.toml

    systemctl restart containerd
    systemctl enable containerd
  "
}
```

여기서 중요한 설정이 하나 있다:

```bash
sed -i 's/SystemdCgroup = false/SystemdCgroup = true/' /etc/containerd/config.toml
```

이 한 줄이 `SystemdCgroup`을 활성화한다. 쿠버네티스의 리소스 관리(cgroup)와 containerd의 리소스 관리가 **같은 방식(systemd)**으로 동작하게 맞춰주는 것이다. 이걸 안 하면 나중에 쿠버네티스가 "어? 메모리가 얼마 남았는지 계산이 안 맞네?"하면서 에러를 뱉는다.

이 설치 과정은 `scripts/install/03-install-runtime.sh`에서 10대 모든 VM에 자동 적용된다:

```bash
log_section "Phase 3: Installing Container Runtime (containerd)"

for cluster_name in $(get_cluster_names); do
  for node_name in $(get_nodes_for_cluster "$cluster_name"); do
    install_containerd "$node_name"
  done
done
```

---

## 쿠버네티스: 왜 오케스트레이션이 필요한가?

컨테이너 하나를 실행하는 건 쉽다. 하지만 **100개의 컨테이너**를 동시에 관리해야 한다면?

- nginx 컨테이너가 죽으면 누가 자동으로 다시 띄울 것인가?
- 트래픽이 갑자기 몰리면 컨테이너를 몇 개 더 만들 것인가?
- 새 버전의 앱을 배포할 때, 기존 컨테이너를 하나씩 교체할 것인가?
- 어떤 컨테이너를 어떤 서버에 배치할 것인가?

이 모든 것을 **사람이 일일이 하는 건 불가능**하다.

**쿠버네티스(Kubernetes, 줄여서 K8s)**는 컨테이너를 자동으로 배포하고, 확장하고, 복구하고, 관리하는 오케스트레이션 시스템이다.

| 상황 | 쿠버네티스 없이 | 쿠버네티스 있으면 |
|------|--------------|-----------------|
| 컨테이너 크래시 | 새벽 3시에 알림 받고 수동 재시작 | 자동으로 재시작 (self-healing) |
| 트래픽 급증 | 사람이 서버에 접속해서 컨테이너 추가 | HPA가 자동으로 확장 (auto-scaling) |
| 새 버전 배포 | 서비스 중단하고 교체 | 점진적 교체, 무중단 배포 (rolling update) |
| 서버 장애 | 해당 서버의 모든 서비스 다운 | 다른 서버로 자동 이전 (rescheduling) |

---

## Master와 Worker: 역할 분담

### 왜 Control Plane과 Worker를 분리하는가

쿠버네티스 클러스터는 **Master 노드(Control Plane)**와 **Worker 노드**로 나뉜다. 이 분리는 두 가지 공학적 이유에 기반한다.

첫째, **관심사 분리(Separation of Concerns)**이다. Control Plane은 클러스터의 상태 관리(etcd), 스케줄링, API 처리를 담당하고, Worker는 실제 워크로드를 실행한다. 이 둘의 리소스 요구 패턴이 근본적으로 다르다. Control Plane은 안정적인 저지연 응답이 중요하고, Worker는 가변적인 높은 처리량이 중요하다.

둘째, **장애 격리**이다. Worker 노드에서 실행 중인 Pod가 메모리를 과도하게 사용하거나 CPU를 점유해도, Control Plane은 별도의 노드에서 실행되므로 클러스터 관리 기능은 정상 동작한다. 만약 Control Plane과 워크로드가 같은 노드에 있으면, 워크로드의 OOM(Out of Memory)이 API Server나 etcd를 함께 죽일 수 있다.

### Master 노드 (Control Plane)

Master 노드는 클러스터 전체를 제어하는 역할을 한다. 직접 워크로드를 실행하지 않고, 클러스터의 상태를 관리하고 스케줄링을 담당한다.

| 컴포넌트 | 역할 |
|---------|------|
| **API Server** | 모든 요청의 입구. kubectl 명령이 여기로 간다. |
| **etcd** | 클러스터의 모든 상태 정보를 저장하는 분산 키-값 저장소 |
| **Scheduler** | 새 Pod를 어떤 Worker에 배치할지 결정 |
| **Controller Manager** | "원하는 상태"와 "현재 상태"를 계속 비교하고 맞춘다 |

### Worker 노드

Worker 노드는 실제 워크로드(컨테이너)가 실행되는 곳이다.

| 컴포넌트 | 역할 |
|---------|------|
| **kubelet** | Master의 지시를 받아 컨테이너를 실행하는 에이전트 |
| **containerd** | 실제 컨테이너를 만들고 관리하는 런타임 |
| **kube-proxy** (또는 Cilium) | 네트워크 트래픽 라우팅 |

### 실제 프로젝트의 노드 구성

이 프로젝트의 4개 클러스터 각각은 Master + Worker로 구성된다:

```
platform 클러스터:
  platform-master  [Control Plane]  -- API Server, etcd, Scheduler
  platform-worker1 [Worker]         -- Prometheus, Grafana, Loki
  platform-worker2 [Worker]         -- Jenkins, ArgoCD

dev 클러스터:
  dev-master  [Control Plane]  -- API Server, etcd, Scheduler
  dev-worker1 [Worker]         -- nginx, httpbin, redis, postgres...

staging 클러스터:
  staging-master  [Control Plane]
  staging-worker1 [Worker]

prod 클러스터:
  prod-master  [Control Plane]
  prod-worker1 [Worker]   -- 이중화
  prod-worker2 [Worker]   -- 이중화
```

prod 클러스터만 Worker가 2대인 이유? 프로덕션 환경에서는 한 서버가 죽어도 서비스가 유지되어야 하기 때문이다. Worker 2대가 있으면, 하나가 죽어도 다른 하나가 서비스를 계속한다. 이것을 **고가용성(High Availability)**이라고 한다.

---

## 핵심 개념: Pod, Deployment, Service, Namespace

쿠버네티스에는 여러 "오브젝트"가 있다. 하나씩 살펴보자.

### Pod -- 컨테이너의 최소 단위

**Pod**는 쿠버네티스에서 가장 작은 배포 단위다. 하나 이상의 컨테이너를 포함한다.

```
Pod = 하나의 "작업 공간"
  +---------------------+
  |  컨테이너 1 (nginx)  |
  |  컨테이너 2 (sidecar)|   <-- 보통은 컨테이너 1개, 사이드카 패턴 시 2개
  |  공유 네트워크        |
  |  공유 스토리지        |
  +---------------------+
```

### Deployment -- Pod의 관리자

"nginx Pod를 3개 유지해줘"라고 선언하면, Deployment가 항상 3개를 유지한다. 하나가 죽으면 자동으로 새로 만든다.

```yaml
# 이런 식으로 선언한다 (간략화)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nginx-web
spec:
  replicas: 3          # "항상 3개 유지해줘"
  template:
    spec:
      containers:
      - name: nginx
        image: nginx:alpine
```

### Service -- Pod에 접근하는 문

Pod는 죽으면 새로 만들어지는데, 그때마다 IP가 바뀐다. 클라이언트가 매번 새 IP를 찾아야 한다면 곤란하다. Service는 **고정된 접근 지점**을 제공한다.

```
클라이언트 ---> Service (고정 IP) ---> Pod 1 (변동 IP)
                                  |-> Pod 2 (변동 IP)
                                  |-> Pod 3 (변동 IP)
```

Service의 종류 중 **NodePort**는 외부에서 접근할 수 있게 해준다. 이 프로젝트에서:
- nginx: NodePort 30080
- Keycloak: NodePort 30880
- Grafana: NodePort 30300

### Namespace -- 논리적 격벽

하나의 클러스터 안에서 리소스를 논리적으로 나누는 방법이다.

```
dev 클러스터
  +-- kube-system 네임스페이스: 시스템 컴포넌트 (Cilium, CoreDNS 등)
  +-- demo 네임스페이스: 데모 앱 (nginx, httpbin, redis, postgres, rabbitmq, keycloak)
  +-- istio-system 네임스페이스: Istio 서비스 메시
```

---

## 4개 클러스터, 4가지 목적

### 왜 클러스터를 4개나 만들까?

"하나의 클러스터에 다 넣으면 안 되나?"

가능은 하다. 하지만 실제 기업에서는 절대 그렇게 하지 않는다. 이유:

| 위험 시나리오 | 단일 클러스터 | 멀티 클러스터 |
|-------------|------------|-------------|
| 개발자가 실험하다 클러스터를 망가뜨림 | **프로덕션 서비스도 죽음** | dev만 영향, prod는 무사 |
| 모니터링 도구가 자원을 많이 씀 | 앱 성능 저하 | platform에서만 실행, 앱 클러스터 무관 |
| 보안 설정 실험 중 네트워크 차단 | 전체 서비스 장애 | dev에서만 실험, 나머지 무관 |
| 쿠버네티스 업그레이드 테스트 | 한 번에 모든 것이 위험 | staging에서 먼저 테스트 |

### 클러스터 비교 테이블

| | platform | dev | staging | prod |
|---|---------|-----|---------|------|
| **역할** | 관제, 모니터링, CI/CD | 개발, 실험, 테스트 | 사전 검증 | 프로덕션 운영 |
| **노드 구성** | 1 Master + 2 Worker | 1 Master + 1 Worker | 1 Master + 1 Worker | 1 Master + 2 Worker |
| **총 리소스** | 7 CPU / 24 GB | 4 CPU / 12 GB | 4 CPU / 12 GB | 6 CPU / 19 GB |
| **Cilium + Hubble** | O | O | O | O |
| **Istio (Service Mesh)** | -- | O | -- | -- |
| **네트워크 정책 L7** | -- | O | -- | -- |
| **HPA + PDB** | -- | O | O (metrics-server) | -- |
| **Prometheus / Grafana** | O | -- | -- | -- |
| **Jenkins / ArgoCD** | O | -- | -- | -- |
| **데모 앱** | -- | O | -- | -- |

### 각 클러스터 상세 설명

**platform** -- 다른 클러스터들을 감시하고 관리하는 중앙 관제 클러스터다. Prometheus가 모든 클러스터의 메트릭을 수집하고, Grafana가 시각화하고, AlertManager가 이상 징후를 알린다. Jenkins가 CI 파이프라인을, ArgoCD가 GitOps 배포를 담당한다. Worker가 2대인 이유: 모니터링 워크로드(worker1)와 CI/CD 워크로드(worker2)를 분리해서, 모니터링이 과부하 걸려도 CI/CD에 영향을 주지 않게 한다.

**dev** -- 모든 실험이 이루어지는 곳이다. 데모 앱(nginx, httpbin, redis, postgres, rabbitmq, keycloak)이 배포되어 있고, 서비스 메시(Istio), 네트워크 보안 정책(CiliumNetworkPolicy), 오토스케일링(HPA)이 모두 적용되어 있다. 여기서 마음껏 부하 테스트를 하고, 설정을 바꿔보고, 실험할 수 있다.

**staging** -- dev에서 검증된 설정을 한 단계 더 확인하는 곳이다. "dev에서 잘 되니까 바로 prod에 올리자"는 위험하다. staging에서 한 번 더 검증한 후 prod에 적용한다.

**prod** -- 실제 서비스가 운영되는 곳이다. 안정성이 최우선이다. Worker 2대로 이중화되어 있어, 한 대가 죽어도 서비스가 유지된다. 실험적인 기능(Istio, 네트워크 정책)은 적용하지 않고, 검증된 설정만 사용한다.

### Pod CIDR이 왜 다른가?

각 클러스터의 Pod들은 자기만의 IP 대역을 가진다. 나중에 클러스터 간 통신을 연결할 때 IP 대역이 겹치면 라우팅 테이블이 충돌하여 패킷이 올바른 목적지로 전달되지 않기 때문이다.

| 클러스터 | Pod CIDR | Service CIDR |
|----------|----------|-------------|
| platform | 10.10.0.0/16 | 10.96.0.0/16 |
| dev | 10.20.0.0/16 | 10.97.0.0/16 |
| staging | 10.30.0.0/16 | 10.98.0.0/16 |
| prod | 10.40.0.0/16 | 10.99.0.0/16 |

---

## 설치 파이프라인: 17단계 자동화

`scripts/install.sh`가 17단계를 순서대로 실행한다.

```
Phase 1  → VM 생성 (clone + 리소스 할당)
Phase 2  → 노드 준비 (swap off, 커널 모듈, sysctl)
Phase 3  → containerd 런타임 설치
Phase 4  → kubeadm/kubelet/kubectl 설치
Phase 5  → K8s 클러스터 초기화 (kubeadm init + worker join)
Phase 6  → Cilium CNI + Hubble (모든 클러스터)
Phase 7  → Prometheus + Grafana + Loki (platform만)
Phase 8  → Jenkins + ArgoCD (platform만)
Phase 9  → AlertManager + 알림 규칙 (platform만)
Phase 10 → CiliumNetworkPolicy L7 (dev만)
Phase 11 → metrics-server + HPA (dev + staging)
Phase 12 → Istio 서비스 메시 (dev만)
Phase 13 → Sealed Secrets (시크릿 암호화)
Phase 14 → RBAC + OPA Gatekeeper (정책 강제)
Phase 15 → etcd 스냅샷 + Velero (백업/DR)
Phase 16 → ResourceQuota + LimitRange (리소스 관리)
Phase 17 → Harbor (프라이빗 레지스트리)
```

골든 이미지 사용 시: 15~20분 / 없을 시: 45~60분

전체 흐름을 정리하면:

```
Phase 1: VM 10대 생성
    |
Phase 2: 노드 준비 (OS 설정)
    |   - swap off (K8s가 swap을 싫어한다)
    |   - 커널 모듈 로드 (overlay, br_netfilter)
    |   - 네트워크 설정 (IP forwarding)
    |
Phase 3: containerd 설치
    |   - 패키지 설치
    |   - SystemdCgroup 활성화
    |
Phase 4: kubeadm, kubelet, kubectl 설치
    |   - K8s 공식 저장소 추가
    |   - 버전 고정 (apt-mark hold)
    |
Phase 5: 클러스터 초기화
    |   - 4개 클러스터 각각:
    |     - Master에서 kubeadm init
    |     - kubeconfig 복사
    |     - Worker join
    |
    v
4개의 쿠버네티스 클러스터 완성!
```

---

## Phase 1: VM 생성

`scripts/install/01-create-vms.sh`

```bash
# clusters.json에서 모든 노드를 읽어서 처리
for node in $(get_all_nodes); do
    cpu=$(get_node_cpu "$node")
    memory=$(get_node_memory "$node")

    tart clone "$BASE_IMAGE" "$node"       # 베이스 이미지 복제
    tart set "$node" --cpu "$cpu" --memory "$memory"  # 리소스 설정
    tart run "$node" --net-softnet-allow=0.0.0.0/0 --no-display &  # 백그라운드 실행
done

# 모든 VM의 IP가 할당될 때까지 대기
for node in $(get_all_nodes); do
    vm_wait_for_ip "$node"   # 최대 180초 (3초 × 60회 폴링)
done
```

---

## Phase 2: 노드 준비

`scripts/install/02-prepare-nodes.sh`

K8s가 동작하려면 리눅스 커널 설정이 필요하다.

```bash
prepare_node() {
  local node_name="$1"
  local ip
  ip=$(vm_get_ip "$node_name")

  ssh_exec_sudo "$ip" "
    swapoff -a && sed -i '/swap/d' /etc/fstab

    cat > /etc/modules-load.d/k8s.conf <<MODEOF
overlay
br_netfilter
MODEOF
    modprobe overlay
    modprobe br_netfilter

    cat > /etc/sysctl.d/k8s.conf <<SYSEOF
net.bridge.bridge-nf-call-iptables  = 1
net.bridge.bridge-nf-call-ip6tables = 1
net.ipv4.ip_forward                 = 1
SYSEOF
    sysctl --system
  "
}
```

**왜 이 설정이 필요한가?**

- **swap off**: 쿠버네티스는 메모리 관리를 정밀하게 한다. "이 Pod에 512MB 할당"이라고 결정했는데, OS가 그 메모리를 디스크로 보내버리면(swap) 성능이 예측 불가능해진다. 그래서 swap을 끈다.
- **overlay**: 컨테이너 이미지의 레이어드 파일시스템을 지원한다.
- **br_netfilter**: Pod 간 통신에서 iptables 규칙이 적용되게 한다. 네트워크 브릿지 트래픽을 iptables가 처리할 수 있게 해준다.
- **ip_forward**: Pod 네트워크에서 다른 노드로 패킷을 전달한다. 쿠버네티스 네트워크의 기본 조건이다.

---

## Phase 3: containerd 설치

`scripts/install/03-install-runtime.sh`

containerd 설치의 상세 내용은 위의 [containerd 섹션](#containerd-컨테이너를-실행하는-엔진)을 참고한다. 핵심은 `SystemdCgroup = true` 설정이다. kubelet은 기본적으로 systemd cgroup 드라이버를 사용하므로, containerd도 동일하게 맞춰야 리소스 관리가 일관된다.

---

## Phase 4: kubeadm 설치

`scripts/install/04-install-kubeadm.sh`

### 왜 kubeadm인가 -- managed K8s와의 차이

쿠버네티스 클러스터를 만드는 방법은 크게 세 가지가 있다.

1. **Managed K8s** (EKS, GKE, AKS): 클라우드 제공자가 Control Plane을 완전히 관리한다. etcd 백업, API Server 고가용성, 인증서 갱신 등을 사용자가 신경 쓸 필요가 없다. 대신 Control Plane의 내부 구조를 볼 수 없고, 비용이 발생한다.
2. **kubeadm**: 쿠버네티스 공식 클러스터 부트스트래핑 도구다. Control Plane 컴포넌트를 직접 초기화하고, 인증서를 생성하며, Worker join 토큰을 관리한다. 클러스터의 전체 구조를 이해할 수 있다.
3. **k3s, kind, minikube**: 경량화된 배포판 또는 로컬 개발용 도구다. 학습에는 편리하지만, 프로덕션 구조와 차이가 크다.

이 프로젝트가 kubeadm을 사용하는 이유는, **프로덕션과 동일한 방식으로 클러스터를 구성하면서도 각 컴포넌트(etcd, API Server, Scheduler, Controller Manager)의 역할과 의존 관계를 직접 경험**할 수 있기 때문이다.

### 설치 스크립트

```bash
install_kubeadm() {
    local ip=$1
    ssh_exec_sudo "$ip" "
        # Kubernetes apt 저장소 추가 (v1.31)
        curl -fsSL https://pkgs.k8s.io/core:/stable:/v1.31/deb/Release.key | gpg --dearmor -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg
        echo 'deb [signed-by=...] https://pkgs.k8s.io/core:/stable:/v1.31/deb/ /' > /etc/apt/sources.list.d/kubernetes.list

        apt-get update
        apt-get install -y kubelet kubeadm kubectl

        # 버전 고정 (자동 업그레이드 방지)
        apt-mark hold kubelet kubeadm kubectl
    "
}
```

---

## Phase 5: 클러스터 초기화

`scripts/install/05-init-clusters.sh`

가장 핵심적인 단계이다. `scripts/lib/k8s.sh`의 `init_cluster` 함수가 이 과정을 자동화한다:

```bash
init_cluster() {
  local cluster_name="$1"
  local master_name
  master_name=$(get_master_for_cluster "$cluster_name")
  local master_ip
  master_ip=$(vm_get_ip "$master_name")
  local pod_cidr
  pod_cidr=$(get_pod_cidr "$cluster_name")
  local service_cidr
  service_cidr=$(get_service_cidr "$cluster_name")

  log_section "Initializing cluster: $cluster_name"

  # Master에서 kubeadm init 실행
  ssh_exec_sudo "$master_ip" "
    kubeadm init \
      --pod-network-cidr='$pod_cidr' \
      --service-cidr='$service_cidr' \
      --skip-phases=addon/kube-proxy \
      --apiserver-advertise-address='$master_ip' \
      --node-name='$master_name'
  "

  # kubeconfig 파일을 Mac으로 복사
  ssh_exec "$master_ip" "mkdir -p \$HOME/.kube && sudo cp /etc/kubernetes/admin.conf \$HOME/.kube/config && sudo chown \$(id -u):\$(id -g) \$HOME/.kube/config"
  mkdir -p "$KUBECONFIG_DIR"
  scp_from "$master_ip" ".kube/config" "$(kubeconfig_for_cluster "$cluster_name")"

  # Join 토큰 생성
  local join_cmd
  join_cmd=$(ssh_exec_sudo "$master_ip" "kubeadm token create --print-join-command")

  # Worker 노드들을 클러스터에 합류시키기
  for worker_name in $(get_workers_for_cluster "$cluster_name"); do
    local worker_ip
    worker_ip=$(vm_get_ip "$worker_name")
    log_info "Joining worker '$worker_name' ($worker_ip) to cluster '$cluster_name'..."
    ssh_exec_sudo "$worker_ip" "$join_cmd --node-name='$worker_name'"
  done
}
```

이 함수를 단계별로 뜯어보면:

**1단계: 정보 수집**
```bash
master_name=$(get_master_for_cluster "$cluster_name")   # clusters.json에서 master 이름
master_ip=$(vm_get_ip "$master_name")                    # 해당 VM의 IP
pod_cidr=$(get_pod_cidr "$cluster_name")                 # Pod IP 대역
```

**2단계: Master 초기화**
```bash
kubeadm init \
  --pod-network-cidr='$pod_cidr' \        # Pod가 사용할 IP 범위
  --service-cidr='$service_cidr' \        # Service가 사용할 IP 범위
  --skip-phases=addon/kube-proxy \        # kube-proxy 대신 Cilium 사용
  --apiserver-advertise-address='$master_ip' \  # API Server 주소
  --node-name='$master_name'              # 노드 이름
```

`--skip-phases=addon/kube-proxy`가 눈에 띈다. 보통은 kube-proxy가 네트워크를 관리하지만, 이 프로젝트는 더 고급 네트워크 솔루션인 **Cilium**을 사용하기 때문에 kube-proxy를 건너뛴다.

**3단계: kubeconfig 복사**
```bash
scp_from "$master_ip" ".kube/config" "$(kubeconfig_for_cluster "$cluster_name")"
```

`kubeconfig`는 클러스터에 접속하기 위한 "열쇠" 파일이다. Master VM 안에서 생성되는데, 이것을 Mac(호스트)으로 복사해와야 Mac에서 `kubectl` 명령을 실행할 수 있다.

**4단계: Worker 합류**
```bash
join_cmd=$(ssh_exec_sudo "$master_ip" "kubeadm token create --print-join-command")
ssh_exec_sudo "$worker_ip" "$join_cmd --node-name='$worker_name'"
```

`kubeadm init`이 끝나면 "이 토큰을 가진 노드는 합류를 허용한다"는 join 토큰이 생성된다. 이 토큰을 Worker 노드에서 실행하면, Worker가 Master에게 "저 합류해도 될까요?"라고 요청하고, 클러스터의 일원이 된다.

수동으로 이 과정을 하려면 Master에 SSH 접속 -> kubeadm init -> join 토큰 복사 -> Worker에 SSH -> 붙여넣기를 노드마다 반복해야 한다. 자동화된 스크립트는 이 모든 것을 루프로 처리한다:

```bash
# scripts/install/05-init-clusters.sh
for cluster_name in $(get_cluster_names); do
  init_cluster "$cluster_name"
done
```

이 세 줄로 4개 클러스터가 모두 초기화된다.

---

## Phase 6: Cilium CNI 설치

`scripts/install/06-install-cilium.sh`

```bash
install_cilium() {
    local cluster=$1 kubeconfig="kubeconfig/${cluster}.yaml"

    helm repo add cilium https://helm.cilium.io/

    helm install cilium cilium/cilium \
        --kubeconfig "$kubeconfig" \
        --namespace kube-system \
        --values manifests/cilium-values.yaml \
        --set ipam.operator.clusterPoolIPv4PodCIDRList=$(get_pod_cidr "$cluster")
}

install_hubble() {
    helm upgrade cilium cilium/cilium \
        --kubeconfig "$kubeconfig" \
        --namespace kube-system \
        --values manifests/hubble-values.yaml
}
```

---

## Phase 7~12: 모니터링, CI/CD, 네트워크 정책

### Phase 7-9: 모니터링 + CI/CD (platform 클러스터만)

```bash
# Phase 7: Prometheus + Grafana + Loki
helm install prometheus prometheus-community/kube-prometheus-stack \
    --values manifests/monitoring-values.yaml

helm install loki grafana/loki-stack \
    --values manifests/loki-values.yaml

# Phase 8: Jenkins + ArgoCD
helm install argocd argo/argo-cd --values manifests/argocd-values.yaml
helm install jenkins jenkins/jenkins --values manifests/jenkins-values.yaml

# Phase 9: 알림 규칙
kubectl apply -f manifests/alerting/prometheus-rules.yaml
kubectl apply -f manifests/alerting/webhook-logger.yaml
```

### Phase 10-12: dev 클러스터 전용 설정

```bash
# Phase 10: 네트워크 정책 (Zero-Trust)
kubectl apply -f manifests/network-policies/  # 모든 정책 파일 적용

# Phase 11: HPA (오토스케일링)
helm install metrics-server metrics-server/metrics-server
kubectl apply -f manifests/hpa/

# Phase 12: Istio 서비스 메시
helm install istio-base istio/base
helm install istiod istio/istiod
helm install istio-ingressgateway istio/gateway
kubectl label namespace demo istio-injection=enabled  # 사이드카 자동 주입
kubectl apply -f manifests/istio/
```

---

## 골든 이미지로 설치 시간 단축

`scripts/build-golden-image.sh`

설치 시간을 단축하기 위해, containerd + kubeadm + K8s 이미지가 미리 설치된 VM 이미지를 만든다.

```bash
# 1. 임시 VM 생성
tart clone "$BASE_IMAGE" golden-builder

# 2. Phase 2-4 실행 (노드 준비, containerd, kubeadm)
prepare_node "$ip"
install_containerd "$ip"
install_kubeadm "$ip"

# 3. K8s + Cilium 이미지 미리 다운로드
kubeadm config images pull
ctr images pull quay.io/cilium/...

# 4. 골든 이미지로 저장
tart stop golden-builder
# 이후 이 이미지를 BASE_IMAGE로 사용
```

효과: Phase 2-4를 건너뛸 수 있어 설치 시간이 45분 -> 15분으로 단축된다.

---

## 일상 운영 스크립트

### boot.sh - 매일 아침 실행

```bash
# 1단계: 모든 VM 시작
./scripts/boot/01-start-vms.sh
# 2단계: SSH 접속 가능할 때까지 대기
./scripts/boot/02-wait-clusters.sh
# 3단계: 서비스 상태 확인
./scripts/boot/03-verify-services.sh
```

### shutdown.sh - 매일 저녁 실행

```bash
# 1. worker 노드 drain (Pod를 다른 노드로 이동)
kubectl drain <worker> --ignore-daemonsets --delete-emptydir-data
# 2. VM 종료
tart stop <vm-name>
```

### status.sh - 상태 확인

```bash
# VM 상태 → 노드 상태 → Pod 상태 순서로 출력
tart list                    # VM 목록 + 상태
kubectl get nodes            # 각 클러스터 노드 상태
kubectl get pods -A          # 각 클러스터 Pod 상태
```

---

## 정리

| 개념 | 한 줄 설명 |
|------|-----------|
| **컨테이너** | 앱 + 라이브러리를 격리된 환경에 패키징한 것 (VM보다 가볍다) |
| **containerd** | 쿠버네티스의 표준 컨테이너 런타임 |
| **CRI** | 쿠버네티스와 컨테이너 런타임 사이의 통신 규약 |
| **쿠버네티스** | 컨테이너를 자동으로 배포, 확장, 복구하는 오케스트레이션 시스템 |
| **Master** | 클러스터의 두뇌 (API Server, etcd, Scheduler) |
| **Worker** | 실제 워크로드가 돌아가는 곳 (kubelet, containerd) |
| **Pod** | 쿠버네티스의 최소 배포 단위 (1개 이상의 컨테이너) |
| **Deployment** | Pod 개수를 관리하는 컨트롤러 ("항상 3개 유지") |
| **Service** | Pod에 접근하는 고정된 네트워크 엔드포인트 |
| **Namespace** | 클러스터 내 리소스의 논리적 구분 |
| **kubeadm** | 클러스터 초기화 도구 (init + join) |
| **멀티 클러스터** | 환경 격리를 위해 클러스터를 여러 개 운영하는 전략 |
