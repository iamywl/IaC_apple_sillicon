# 04. 쿠버네티스 네트워킹 — Cilium과 eBPF

> 시리즈: Apple Silicon Mac 위에 프로덕션급 멀티 클러스터 쿠버네티스 구축하기 (4/6)

---

## 들어가며

지금까지 우리는 VM을 만들고, 쿠버네티스 클러스터를 초기화했습니다. 하지만 한 가지 큰 문제가 남아 있습니다. **Pod끼리 서로 통신을 못 합니다.**

쿠버네티스 클러스터를 막 만들면 노드가 `NotReady` 상태로 나옵니다. 왜일까요? **네트워크 플러그인(CNI)이 없기 때문입니다.**

이번 글에서는 컨테이너 네트워킹의 기본 개념부터 시작해서, 우리 프로젝트가 왜 Cilium이라는 도구를 선택했는지, 그리고 eBPF라는 기술이 왜 혁신적인지까지 차근차근 알아보겠습니다.

---

## CNI란 무엇인가? (Container Network Interface)

### 비유: 아파트 단지의 내선 전화 시스템

아파트 단지를 상상해보세요.

- 각 세대(Pod)에는 내선 번호(IP 주소)가 있습니다
- 단지 내에서는 내선 번호만으로 통화할 수 있어야 합니다
- 다른 단지(다른 노드)의 세대와도 통화가 가능해야 합니다
- 외부(인터넷)와도 연결되어야 합니다

**CNI는 이 내선 전화 시스템을 설치해주는 업체**라고 생각하면 됩니다.

### 기술적으로는

CNI(Container Network Interface)는 쿠버네티스가 정한 "네트워크 플러그인 표준 규격"입니다.

```
쿠버네티스: "나는 Pod에 IP를 부여하고, Pod 간 통신이 되게 해줄 누군가가 필요해"
CNI 플러그인: "내가 할게! 규격에 맞춰서 네트워크를 구성해줄게"
```

CNI 플러그인의 종류는 여러 가지입니다:

| 플러그인 | 특징 | 우리 프로젝트 |
|---------|------|-------------|
| Flannel | 간단, 학습용 | - |
| Calico | 네트워크 정책 강점 | - |
| **Cilium** | eBPF 기반, 고성능, 옵저버빌리티 | **채택** |
| Weave | 설치 간편 | - |

---

## 왜 이게 필요한가? — 컨테이너에게 네트워크가 필요한 이유

### Docker와는 다른 세계

Docker를 써본 적이 있다면, `docker run -p 8080:80`처럼 포트를 매핑해본 적이 있을 겁니다. Docker는 하나의 호스트 안에서 동작하기 때문에 비교적 단순합니다.

하지만 쿠버네티스는 다릅니다:

```
노드 A (192.168.64.10)              노드 B (192.168.64.11)
  +--------+  +--------+              +--------+  +--------+
  | Pod-1  |  | Pod-2  |              | Pod-3  |  | Pod-4  |
  |10.10.0.|  |10.10.0.|              |10.10.1.|  |10.10.1.|
  |   5    |  |   6    |              |   3    |  |   4    |
  +--------+  +--------+              +--------+  +--------+
```

Pod-1에서 Pod-3으로 요청을 보내려면? **물리적으로 다른 머신**에 있는데 마치 같은 네트워크에 있는 것처럼 동작해야 합니다. CNI가 이 마법을 부립니다.

### 쿠버네티스의 3가지 네트워크 요구사항

1. **모든 Pod는 NAT 없이 다른 모든 Pod와 통신할 수 있어야 한다**
2. **모든 노드는 모든 Pod와 통신할 수 있어야 한다**
3. **Pod가 보는 자신의 IP와 다른 Pod가 보는 그 Pod의 IP가 같아야 한다**

이걸 만족시키는 게 CNI 플러그인의 역할입니다.

---

## Cilium이란?

### 한 줄 요약

**Cilium은 eBPF 기반의 쿠버네티스 네트워크 플러그인(CNI)입니다.**

### 비유: 고속도로의 스마트 톨게이트

기존 네트워크 방식(iptables)이 "수동 톨게이트"라면, Cilium(eBPF)은 "스마트 하이패스"입니다.

- **수동 톨게이트 (iptables)**: 차가 올 때마다 규칙 목록을 처음부터 끝까지 순서대로 확인
- **스마트 하이패스 (eBPF)**: 커널 수준에서 바로 처리. 규칙이 1000개든 10000개든 속도가 거의 같음

### eBPF란?

eBPF(extended Berkeley Packet Filter)는 **리눅스 커널 안에서 사용자 프로그램을 실행**할 수 있는 기술입니다.

```
기존 방식:
  패킷 → [커널] → [유저 스페이스 프로그램] → [커널] → 목적지
                   ↑ 여기서 느려짐

eBPF 방식:
  패킷 → [커널 + eBPF 프로그램] → 목적지
          ↑ 커널 안에서 바로 처리. 빠름!
```

쉽게 말하면, 택배 분류 작업을 물류 센터 밖으로 보내서 처리하다가, 물류 센터 안에 분류 로봇을 설치한 것과 같습니다.

---

## kube-proxy를 대체하는 Cilium

### kube-proxy가 뭔데?

쿠버네티스에는 기본적으로 `kube-proxy`라는 컴포넌트가 있습니다. 이 녀석이 하는 일은 **Service IP로 들어온 요청을 실제 Pod로 전달**하는 것입니다.

```
외부 요청 → Service (10.96.0.100:80) → kube-proxy가 전달 → Pod (10.10.0.5:8080)
```

문제는 kube-proxy가 **iptables 규칙**을 사용한다는 점입니다. Service가 많아지면 규칙도 수천, 수만 개로 늘어나고, 성능이 떨어집니다.

### 우리 프로젝트의 설정

`manifests/cilium-values.yaml`을 보겠습니다:

```yaml
kubeProxyReplacement: true

ipam:
  mode: cluster-pool
  operator:
    clusterPoolIPv4PodCIDRList: []  # 클러스터별로 오버라이드

operator:
  replicas: 1

resources:
  requests:
    cpu: 100m
    memory: 128Mi
  limits:
    memory: 512Mi
```

핵심은 첫 번째 줄입니다:

```yaml
kubeProxyReplacement: true
```

이 한 줄이 의미하는 것: **"kube-proxy를 아예 설치하지 않고, Cilium이 그 역할까지 다 할게"**

그래서 클러스터 초기화 시에도 kube-proxy를 건너뜁니다. `scripts/lib/k8s.sh`에서:

```bash
kubeadm init \
  --pod-network-cidr='$pod_cidr' \
  --service-cidr='$service_cidr' \
  --skip-phases=addon/kube-proxy \    # ← kube-proxy 설치 건너뛰기!
  --apiserver-advertise-address='$master_ip' \
  --node-name='$master_name'
```

`--skip-phases=addon/kube-proxy` 옵션이 바로 그것입니다. "Cilium이 다 해줄 거니까 kube-proxy는 필요 없어"라는 뜻이죠.

---

## Pod CIDR과 Service CIDR — IP 주소 설계

### 비유: 우편번호 체계

전국에 같은 주소가 있으면 안 되겠죠? 서울의 "1번지"와 부산의 "1번지"가 구분되어야 합니다. IP 주소도 마찬가지입니다.

우리 프로젝트에는 4개의 클러스터가 있고, 각각 다른 IP 대역을 사용합니다.

### 왜 이게 필요한가?

만약 모든 클러스터가 같은 IP 대역을 사용하면:
- platform 클러스터의 Pod IP: 10.10.0.5
- dev 클러스터의 Pod IP: 10.10.0.5 (충돌!)

나중에 클러스터 간 통신이 필요하면 IP가 겹쳐서 라우팅이 불가능해집니다.

### 우리 프로젝트의 IP 설계

`config/clusters.json`에서 각 클러스터의 CIDR을 확인할 수 있습니다:

```json
{
  "clusters": [
    {
      "name": "platform",
      "pod_cidr": "10.10.0.0/16",
      "service_cidr": "10.96.0.0/16"
    },
    {
      "name": "dev",
      "pod_cidr": "10.20.0.0/16",
      "service_cidr": "10.97.0.0/16"
    },
    {
      "name": "staging",
      "pod_cidr": "10.30.0.0/16",
      "service_cidr": "10.98.0.0/16"
    },
    {
      "name": "prod",
      "pod_cidr": "10.40.0.0/16",
      "service_cidr": "10.99.0.0/16"
    }
  ]
}
```

### CIDR 표기법 이해하기

`10.10.0.0/16`이 무슨 뜻일까요?

```
10.10.0.0/16
  ↑    ↑   ↑
  |    |   └── 16비트가 네트워크 주소 (앞의 10.10 부분이 고정)
  |    └────── 나머지 16비트가 호스트 주소 (0.0 ~ 255.255)
  └─────────── 사용 가능한 IP: 10.10.0.1 ~ 10.10.255.254 (약 65,534개)
```

Pod CIDR과 Service CIDR의 차이:

| 구분 | 용도 | 예시 |
|------|------|------|
| **Pod CIDR** | 각 Pod에 부여되는 IP 범위 | `10.10.0.0/16` |
| **Service CIDR** | 쿠버네티스 Service에 부여되는 가상 IP 범위 | `10.96.0.0/16` |

Service IP는 실제로 어떤 인터페이스에도 바인딩되지 않는 "가상 IP"입니다. Cilium(또는 kube-proxy)이 이 가상 IP로 오는 트래픽을 실제 Pod로 전달해줍니다.

---

## Cilium 설치 과정

`scripts/install/06-install-cilium.sh`의 전체 코드를 살펴봅시다:

```bash
#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/k8s.sh"

log_section "Phase 6: Installing Cilium + Hubble"

for cluster_name in $(get_cluster_names); do
  install_cilium "$cluster_name"
  install_hubble "$cluster_name"
done

for cluster_name in $(get_cluster_names); do
  wait_nodes_ready "$cluster_name"
done

log_info "Cilium + Hubble installed on all clusters."
```

짧지 않나요? 비밀은 `scripts/lib/k8s.sh`에 있습니다. `install_cilium` 함수의 핵심 부분:

```bash
install_cilium() {
  local cluster_name="$1"
  local pod_cidr
  pod_cidr=$(get_pod_cidr "$cluster_name")
  local master_ip
  master_ip=$(vm_get_ip "$master_name")

  helm upgrade --install cilium cilium/cilium \
    --kubeconfig "$(kubeconfig_for_cluster "$cluster_name")" \
    --namespace kube-system \
    --values "$PROJECT_ROOT/manifests/cilium-values.yaml" \
    --set ipam.operator.clusterPoolIPv4PodCIDRList="{$pod_cidr}" \
    --set cluster.name="$cluster_name" \
    --set k8sServiceHost="$master_ip" \
    --set k8sServicePort=6443 \
    --wait --timeout 10m
}
```

여기서 주목할 점:

1. **`--values manifests/cilium-values.yaml`**: 공통 설정 파일을 사용합니다
2. **`--set ipam.operator.clusterPoolIPv4PodCIDRList`**: 클러스터별로 다른 Pod CIDR을 동적으로 주입합니다
3. **`--set cluster.name`**: 각 클러스터에 고유 이름을 부여합니다
4. **`--set k8sServiceHost`**: Cilium이 API 서버와 통신할 주소를 알려줍니다

같은 설정 파일을 4개 클러스터에 사용하되, 클러스터마다 달라야 하는 값만 `--set`으로 오버라이드하는 깔끔한 패턴입니다.

---

## IPAM — IP 주소 관리

### 비유: 호텔 프런트의 방 배정

호텔에 손님이 오면 프런트에서 빈 방을 배정해주죠? IPAM(IP Address Management)이 바로 그 역할입니다.

Pod가 생성되면 IPAM이 Pod CIDR 범위에서 빈 IP를 찾아 배정합니다.

```yaml
ipam:
  mode: cluster-pool
  operator:
    clusterPoolIPv4PodCIDRList: []  # 클러스터별로 오버라이드
```

`cluster-pool` 모드는 Cilium의 Operator가 각 노드에 IP 대역을 할당하고, 노드가 그 안에서 Pod에 IP를 배정하는 방식입니다.

```
클러스터 Pod CIDR: 10.10.0.0/16
  ├── 노드 A: 10.10.0.0/24 (256개 IP 할당받음)
  │     ├── Pod-1: 10.10.0.5
  │     └── Pod-2: 10.10.0.6
  └── 노드 B: 10.10.1.0/24 (256개 IP 할당받음)
        ├── Pod-3: 10.10.1.3
        └── Pod-4: 10.10.1.4
```

---

## Hubble — 네트워크 옵저버빌리티

### 비유: 도로의 CCTV 시스템

도시에 도로를 깔아놓으면 자동차가 다닙니다. 하지만 어디서 사고가 났는지, 어디가 막히는지 알 수 없으면 관리가 불가능합니다. **CCTV가 필요합니다.**

Hubble은 Cilium 네트워크의 CCTV입니다. 모든 네트워크 트래픽을 관찰하고, 시각화하고, 문제를 진단할 수 있게 해줍니다.

### 우리 프로젝트의 Hubble 설정

`manifests/hubble-values.yaml`:

```yaml
hubble:
  enabled: true
  relay:
    enabled: true
  ui:
    enabled: true
    service:
      type: NodePort
      nodePort: 31235
  metrics:
    enabled:
      - dns
      - drop
      - tcp
      - flow
      - icmp
      - http
```

각 메트릭이 의미하는 것:

| 메트릭 | 관찰 대상 |
|--------|----------|
| `dns` | DNS 질의 (어떤 도메인을 찾는지) |
| `drop` | 드롭된 패킷 (차단된 트래픽) |
| `tcp` | TCP 연결 상태 |
| `flow` | 전체 트래픽 흐름 |
| `icmp` | ping 같은 ICMP 패킷 |
| `http` | HTTP 요청/응답 |

---

## hubble observe 출력 읽기

Hubble CLI를 사용하면 실시간 네트워크 트래픽을 볼 수 있습니다:

```bash
# Hubble CLI로 트래픽 관찰하기
hubble observe --namespace default
```

출력 예시:

```
TIMESTAMP             SOURCE                   DESTINATION              TYPE     VERDICT   SUMMARY
Mar 11 09:15:23.456   default/frontend-abc     default/backend-xyz      L4/TCP   FORWARDED TCP SYN
Mar 11 09:15:23.457   default/backend-xyz      default/frontend-abc     L4/TCP   FORWARDED TCP SYN-ACK
Mar 11 09:15:23.458   default/frontend-abc     default/backend-xyz      L7/HTTP  FORWARDED HTTP GET /api/users
Mar 11 09:15:23.512   default/backend-xyz      kube-system/coredns-def  L4/UDP   FORWARDED DNS Query db.default
Mar 11 09:15:24.001   default/backend-xyz      default/frontend-abc     L7/HTTP  FORWARDED HTTP 200 OK
```

각 열의 의미:

- **TIMESTAMP**: 트래픽이 발생한 시각
- **SOURCE**: 트래픽을 보낸 Pod (네임스페이스/Pod이름)
- **DESTINATION**: 트래픽을 받는 Pod
- **TYPE**: L4/TCP, L7/HTTP 등 어떤 계층의 트래픽인지
- **VERDICT**: `FORWARDED`(통과), `DROPPED`(차단), `ERROR`(오류)
- **SUMMARY**: 상세 정보 (HTTP 메서드, DNS 쿼리 등)

### 실제로 유용한 명령어들

```bash
# 드롭된 패킷만 보기 (네트워크 정책에 의해 차단된 것들)
hubble observe --verdict DROPPED

# 특정 Pod의 트래픽만 보기
hubble observe --to-pod default/my-app

# DNS 트래픽만 보기
hubble observe --protocol DNS

# HTTP 500 에러만 필터링
hubble observe --http-status 500
```

### 실제 프로젝트에서는

Hubble UI를 NodePort 31235로 노출했기 때문에, 브라우저에서 시각적으로 네트워크 흐름을 볼 수도 있습니다. Service Map이라는 기능이 있어서 Pod 간의 통신 관계를 그래프로 보여줍니다. 마이크로서비스 아키텍처에서 "이 서비스가 어떤 서비스와 통신하는지" 한눈에 파악할 수 있죠.

---

## 전체 네트워크 아키텍처

우리 프로젝트의 네트워크를 그림으로 그리면:

```
Mac 호스트 (192.168.64.0/24 대역)
│
├── platform 클러스터
│   ├── platform-master  (192.168.64.x)
│   ├── platform-worker1 (192.168.64.x)
│   └── platform-worker2 (192.168.64.x)
│   Pod CIDR:     10.10.0.0/16
│   Service CIDR: 10.96.0.0/16
│
├── dev 클러스터
│   ├── dev-master  (192.168.64.x)
│   └── dev-worker1 (192.168.64.x)
│   Pod CIDR:     10.20.0.0/16
│   Service CIDR: 10.97.0.0/16
│
├── staging 클러스터
│   ├── staging-master  (192.168.64.x)
│   └── staging-worker1 (192.168.64.x)
│   Pod CIDR:     10.30.0.0/16
│   Service CIDR: 10.98.0.0/16
│
└── prod 클러스터
    ├── prod-master  (192.168.64.x)
    ├── prod-worker1 (192.168.64.x)
    └── prod-worker2 (192.168.64.x)
    Pod CIDR:     10.40.0.0/16
    Service CIDR: 10.99.0.0/16
```

3가지 IP 계층이 있습니다:

1. **호스트 네트워크** (192.168.64.x): VM(노드)이 사용하는 실제 IP. Mac에서 VM에 접근할 때 사용
2. **Pod 네트워크** (10.10~40.x.x): Pod에 부여되는 IP. Cilium이 관리
3. **Service 네트워크** (10.96~99.x.x): Service에 부여되는 가상 IP. Cilium이 실제 Pod로 라우팅

---

## 실제 프로젝트에서는

### Cilium이 업계 표준이 된 이유

2023년 Cilium은 CNCF(Cloud Native Computing Foundation)의 Graduated 프로젝트가 되었습니다. Google GKE, AWS EKS, Azure AKS 모두 Cilium을 옵션으로 제공하거나 기본 CNI로 채택하고 있습니다.

### eBPF가 왜 혁명적인가

전통적으로 네트워크 기능을 바꾸려면 커널 모듈을 컴파일하고 커널을 재시작해야 했습니다. eBPF는 **커널을 재시작하지 않고도 커널 수준의 프로그램을 로드**할 수 있습니다.

이것은 마치:
- **예전**: 도로를 바꾸려면 도시 전체를 정전시키고 공사해야 했다
- **eBPF**: 차가 다니는 중에도 도로를 수정할 수 있다

### 네트워크 정책과 보안

Cilium은 단순한 네트워크 연결을 넘어서, L7(HTTP/gRPC) 수준의 네트워크 정책을 적용할 수 있습니다. 예를 들어:

```
"frontend Pod는 backend Pod의 /api/* 경로에만 GET 요청을 보낼 수 있다"
```

기존 iptables 기반에서는 불가능했던 세밀한 제어입니다.

### 멀티 클러스터 환경에서의 Cilium

우리 프로젝트처럼 4개 클러스터를 운영할 때, Cilium Cluster Mesh 기능을 활성화하면 클러스터 간 Pod 직접 통신이 가능합니다. 각 클러스터의 Pod CIDR을 다르게 설정한 이유 중 하나이기도 합니다.

---

## 정리

| 개념 | 한 줄 설명 |
|------|-----------|
| CNI | 쿠버네티스의 네트워크 플러그인 표준 규격 |
| Cilium | eBPF 기반의 고성능 CNI 플러그인 |
| eBPF | 리눅스 커널 안에서 프로그램을 실행하는 기술 |
| kubeProxyReplacement | Cilium이 kube-proxy 역할까지 대신하는 설정 |
| Pod CIDR | Pod에 부여되는 IP 주소 범위 |
| Service CIDR | Service에 부여되는 가상 IP 주소 범위 |
| IPAM | IP 주소를 자동으로 할당/관리하는 시스템 |
| Hubble | Cilium 기반 네트워크 옵저버빌리티 도구 |

### 관련 파일

| 파일 | 역할 |
|------|------|
| `manifests/cilium-values.yaml` | Cilium Helm 차트 설정값 |
| `manifests/hubble-values.yaml` | Hubble 활성화 설정값 |
| `scripts/install/06-install-cilium.sh` | Cilium + Hubble 설치 스크립트 |
| `scripts/lib/k8s.sh` | install_cilium(), install_hubble() 함수 정의 |
| `config/clusters.json` | 클러스터별 Pod CIDR, Service CIDR 정의 |

---

**다음 글에서는** 네트워크 위에서 무슨 일이 일어나는지 관찰하는 모니터링과 옵저버빌리티 스택을 다룹니다. Prometheus, Grafana, Loki를 사용해서 클러스터의 건강 상태를 한눈에 파악하는 방법을 알아보겠습니다.
