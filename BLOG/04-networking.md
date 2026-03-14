# 04. 쿠버네티스 네트워킹 — Cilium과 eBPF

> 시리즈: Apple Silicon 맥에서 구축하는 멀티 클러스터 Kubernetes 인프라 (4/15)

---

## 들어가며

지금까지 VM을 만들고, 쿠버네티스 클러스터를 초기화했다. 하지만 한 가지 큰 문제가 남아 있다. **Pod끼리 서로 통신을 못 한다.**

쿠버네티스 클러스터를 막 만들면 노드가 `NotReady` 상태로 나온다. 이유는 간단하다. **네트워크 플러그인(CNI)이 없기 때문이다.**

이번 글에서는 컨테이너 네트워킹의 기본 개념부터 시작해서, 이 프로젝트가 왜 Cilium을 선택했는지, 그리고 eBPF라는 기술이 왜 혁신적인지까지 다룬다.

---

## 왜 CNI가 필요한가 — K8s는 네트워크 구현을 제공하지 않는다

### CNI란 무엇인가? (Container Network Interface)

CNI(Container Network Interface)는 쿠버네티스가 정한 "네트워크 플러그인 표준 규격"이다.

쿠버네티스는 의도적으로 네트워크 구현을 자체에 포함하지 않는다. 그 이유는 네트워크 요구사항이 환경마다 크게 다르기 때문이다. 베어메탈, 퍼블릭 클라우드, 엣지 환경에서 최적의 네트워크 구현은 각각 다르다. 쿠버네티스는 "Pod에 IP를 부여하고, Pod 간 NAT 없는 통신을 보장하라"는 요구사항만 정의하고, 실제 구현은 CNI 플러그인에 위임한다.

CNI가 없으면 `kubeadm init` 후 모든 노드가 `NotReady` 상태로 남는다. kubelet이 Pod에 네트워크를 부여할 방법이 없기 때문이다.

CNI 플러그인은 Pod 생성 시 네트워크 인터페이스를 구성하고 IP를 할당하며, Pod 삭제 시 해당 리소스를 정리하는 역할을 한다.

CNI 플러그인의 종류는 여러 가지다:

| 플러그인 | 특징 | 우리 프로젝트 |
|---------|------|-------------|
| Flannel | 간단, 학습용 | - |
| Calico | 네트워크 정책 강점 | - |
| **Cilium** | eBPF 기반, 고성능, 옵저버빌리티 | **채택** |
| Weave | 설치 간편 | - |

---

## 컨테이너에게 네트워크가 필요한 이유

### Docker와는 다른 세계

Docker를 써본 적이 있다면, `docker run -p 8080:80`처럼 포트를 매핑해본 적이 있을 것이다. Docker는 하나의 호스트 안에서 동작하기 때문에 비교적 단순하다.

하지만 쿠버네티스는 다르다:

```
노드 A (192.168.64.10)              노드 B (192.168.64.11)
  +--------+  +--------+              +--------+  +--------+
  | Pod-1  |  | Pod-2  |              | Pod-3  |  | Pod-4  |
  |10.10.0.|  |10.10.0.|              |10.10.1.|  |10.10.1.|
  |   5    |  |   6    |              |   3    |  |   4    |
  +--------+  +--------+              +--------+  +--------+
```

Pod-1에서 Pod-3으로 요청을 보내려면? **물리적으로 다른 머신**에 있는데 마치 같은 네트워크에 있는 것처럼 동작해야 한다. CNI가 오버레이 네트워크 또는 라우팅 기반 네트워킹을 통해 이 통신을 가능하게 한다.

### 쿠버네티스의 3가지 네트워크 요구사항

1. **모든 Pod는 NAT 없이 다른 모든 Pod와 통신할 수 있어야 한다**
2. **모든 노드는 모든 Pod와 통신할 수 있어야 한다**
3. **Pod가 보는 자신의 IP와 다른 Pod가 보는 그 Pod의 IP가 같아야 한다**

이 요구사항을 만족시키는 것이 CNI 플러그인의 역할이다.

---

## 왜 Cilium인가

### 한 줄 요약

**Cilium은 eBPF 기반의 쿠버네티스 네트워크 플러그인(CNI)이다.**

CNI 플러그인으로 Flannel, Calico, Weave 등 여러 선택지가 있는데, 이 프로젝트가 Cilium을 채택한 이유는 세 가지다.

첫째, **eBPF 기반으로 kube-proxy를 완전히 대체**한다. Flannel이나 Calico(iptables 모드)는 별도의 kube-proxy가 필요하여 컴포넌트가 늘어나고 관리 복잡도가 증가한다. Cilium은 `kubeProxyReplacement: true` 설정 하나로 Service 라우팅, 로드밸런싱, 네트워크 정책을 모두 eBPF에서 처리한다.

둘째, **L7(HTTP/gRPC) 수준의 네트워크 정책**을 지원한다. Calico도 네트워크 정책을 지원하지만 L3/L4 수준이 기본이다. Cilium은 "이 Pod는 /api/users 경로에 GET만 허용"처럼 HTTP 경로와 메서드 단위의 제어가 가능하다. 이 프로젝트의 08편에서 다루는 Zero-Trust 네트워크 정책에 필수적이다.

셋째, **Hubble을 통한 L7 가시성**을 제공한다. 네트워크 문제가 발생했을 때 패킷 수준에서 어떤 Pod가 어떤 Pod에 어떤 HTTP 요청을 보냈는지 실시간으로 관찰할 수 있다. 별도의 서비스 메시 없이도 네트워크 옵저버빌리티를 확보할 수 있다.

### 왜 eBPF가 iptables보다 나은가

기존 네트워크 방식(iptables)은 패킷이 도착할 때마다 규칙 목록을 처음부터 끝까지 순차 탐색(O(n))하여 매칭한다. Service 수가 늘어날수록 규칙 수도 선형 증가하고, 그에 따라 패킷 처리 지연도 커진다. 규칙이 5,000개일 때와 500개일 때 패킷 처리 시간이 10배 차이 날 수 있다.

Cilium은 eBPF를 사용하여 커널 내부에서 해시 맵 기반의 O(1) 룩업으로 패킷을 처리한다. 규칙이 1,000개든 10,000개든 처리 속도가 거의 동일하다. 또한 iptables는 규칙 변경 시 전체 테이블을 재구성해야 하지만, eBPF 맵은 개별 엔트리만 업데이트하므로 규칙 변경 비용도 O(1)이다.

### eBPF란?

eBPF(extended Berkeley Packet Filter)는 **리눅스 커널 안에서 사용자 프로그램을 실행**할 수 있는 기술이다.

```
기존 방식:
  패킷 → [커널] → [유저 스페이스 프로그램] → [커널] → 목적지
                   ↑ 여기서 컨텍스트 스위칭 오버헤드 발생

eBPF 방식:
  패킷 → [커널 + eBPF 프로그램] → 목적지
          ↑ 커널 안에서 바로 처리. 컨텍스트 스위칭 없음
```

즉, 유저 스페이스로 패킷을 올려보내지 않고 커널 내부에서 직접 패킷 필터링, 라우팅, 로드밸런싱을 수행한다. 커널-유저 스페이스 간 컨텍스트 스위칭 비용이 제거되므로 처리 성능이 크게 향상된다.

---

## kube-proxy를 대체하는 Cilium

### kube-proxy란?

쿠버네티스에는 기본적으로 `kube-proxy`라는 컴포넌트가 있다. 이 컴포넌트의 역할은 **Service IP로 들어온 요청을 실제 Pod로 전달**하는 것이다.

```
외부 요청 → Service (10.96.0.100:80) → kube-proxy가 전달 → Pod (10.10.0.5:8080)
```

문제는 kube-proxy가 **iptables 규칙**을 사용한다는 점이다. Service가 많아지면 규칙도 수천, 수만 개로 늘어나고, 성능이 떨어진다.

### 우리 프로젝트의 설정

`manifests/cilium-values.yaml`을 보자:

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

핵심은 첫 번째 줄이다:

```yaml
kubeProxyReplacement: true
```

이 한 줄이 의미하는 것: **"kube-proxy를 아예 설치하지 않고, Cilium이 그 역할까지 다 한다"**

그래서 클러스터 초기화 시에도 kube-proxy를 건너뛴다. `scripts/lib/k8s.sh`에서:

```bash
kubeadm init \
  --pod-network-cidr='$pod_cidr' \
  --service-cidr='$service_cidr' \
  --skip-phases=addon/kube-proxy \    # ← kube-proxy 설치 건너뛰기!
  --apiserver-advertise-address='$master_ip' \
  --node-name='$master_name'
```

`--skip-phases=addon/kube-proxy` 옵션이 바로 그것이다. Cilium이 kube-proxy의 기능(Service IP 라우팅, 로드밸런싱)을 eBPF로 대체하기 때문에 kube-proxy가 불필요하다.

---

## 왜 Pod CIDR을 클러스터별로 다르게 설정하는가

우리 프로젝트에는 4개의 클러스터가 있고, 각각 다른 IP 대역을 사용한다. 이는 **향후 멀티클러스터 라우팅**을 위한 설계이다.

단일 클러스터만 운영한다면 CIDR이 겹쳐도 문제없다. 하지만 멀티클러스터 환경에서 Cilium Cluster Mesh나 Submariner 같은 도구로 클러스터 간 Pod 직접 통신을 구성하려면, 각 클러스터의 Pod CIDR이 반드시 겹치지 않아야 한다. 라우팅 테이블은 목적지 IP 대역을 기준으로 패킷을 전달하는데, 두 클러스터가 동일한 10.10.0.0/16 대역을 사용하면 라우터가 패킷을 어느 클러스터로 보내야 할지 결정할 수 없다.

Service CIDR도 같은 이유로 분리한다(10.96~10.99). 지금 당장은 클러스터 간 통신을 구성하지 않더라도, 나중에 필요할 때 IP 체계를 재설계하는 것은 모든 Pod를 재배포해야 하는 대규모 작업이 된다. 초기 설계 단계에서 CIDR을 분리해두는 것이 올바른 선택이다.

### 우리 프로젝트의 IP 설계

`config/clusters.json`에서 각 클러스터의 CIDR을 확인할 수 있다:

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

`10.10.0.0/16`이 무슨 뜻인가?

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

Service IP는 실제로 어떤 인터페이스에도 바인딩되지 않는 "가상 IP"이다. Cilium(또는 kube-proxy)이 이 가상 IP로 오는 트래픽을 실제 Pod로 전달해준다.

---

## Cilium 설치 과정

`scripts/install/06-install-cilium.sh`의 전체 코드를 보자:

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

짧다. 실제 로직은 `scripts/lib/k8s.sh`에 있다. `install_cilium` 함수의 핵심 부분:

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

1. **`--values manifests/cilium-values.yaml`**: 공통 설정 파일을 사용한다
2. **`--set ipam.operator.clusterPoolIPv4PodCIDRList`**: 클러스터별로 다른 Pod CIDR을 동적으로 주입한다
3. **`--set cluster.name`**: 각 클러스터에 고유 이름을 부여한다
4. **`--set k8sServiceHost`**: Cilium이 API 서버와 통신할 주소를 지정한다

같은 설정 파일을 4개 클러스터에 사용하되, 클러스터마다 달라야 하는 값만 `--set`으로 오버라이드하는 패턴이다.

---

## IPAM — IP 주소 관리

IPAM(IP Address Management)은 Pod가 생성될 때 Pod CIDR 범위에서 사용 가능한 IP를 찾아 할당하고, Pod가 삭제될 때 해당 IP를 회수하는 기능이다.

```yaml
ipam:
  mode: cluster-pool
  operator:
    clusterPoolIPv4PodCIDRList: []  # 클러스터별로 오버라이드
```

`cluster-pool` 모드는 Cilium의 Operator가 각 노드에 IP 대역을 할당하고, 노드가 그 안에서 Pod에 IP를 배정하는 방식이다.

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

Hubble은 Cilium의 네트워크 옵저버빌리티 컴포넌트다. Cilium 데이터플레인을 통과하는 모든 네트워크 트래픽의 메타데이터를 수집하고, 이를 기반으로 트래픽 흐름 시각화, 네트워크 정책 디버깅, 서비스 의존성 분석 등을 수행한다.

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

Hubble CLI를 사용하면 실시간 네트워크 트래픽을 볼 수 있다:

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

Hubble UI를 NodePort 31235로 노출했기 때문에, 브라우저에서 시각적으로 네트워크 흐름을 볼 수도 있다. Service Map 기능이 있어서 Pod 간의 통신 관계를 그래프로 보여준다. 마이크로서비스 아키텍처에서 서비스 간 의존성을 한눈에 파악할 때 유용하다.

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

3가지 IP 계층이 있다:

1. **호스트 네트워크** (192.168.64.x): VM(노드)이 사용하는 실제 IP. Mac에서 VM에 접근할 때 사용
2. **Pod 네트워크** (10.10~40.x.x): Pod에 부여되는 IP. Cilium이 관리
3. **Service 네트워크** (10.96~99.x.x): Service에 부여되는 가상 IP. Cilium이 실제 Pod로 라우팅

---

## 실제 프로젝트에서는

### Cilium이 업계 표준이 된 이유

2023년 Cilium은 CNCF(Cloud Native Computing Foundation)의 Graduated 프로젝트가 되었다. Google GKE, AWS EKS, Azure AKS 모두 Cilium을 옵션으로 제공하거나 기본 CNI로 채택하고 있다.

### eBPF가 왜 혁명적인가

전통적으로 네트워크 기능을 바꾸려면 커널 모듈을 컴파일하고 커널을 재시작해야 했다. eBPF는 **커널을 재시작하지 않고도 커널 수준의 프로그램을 로드**할 수 있다. 커널 재컴파일이나 재부팅 없이 런타임에 데이터플레인 로직을 변경할 수 있다는 점에서 네트워킹, 보안, 관측 분야에 근본적인 변화를 가져왔다.

### 네트워크 정책과 보안

Cilium은 단순한 네트워크 연결을 넘어서, L7(HTTP/gRPC) 수준의 네트워크 정책을 적용할 수 있다. 예를 들어:

```
"frontend Pod는 backend Pod의 /api/* 경로에만 GET 요청을 보낼 수 있다"
```

기존 iptables 기반에서는 불가능했던 세밀한 제어이다.

### 멀티 클러스터 환경에서의 Cilium

이 프로젝트처럼 4개 클러스터를 운영할 때, Cilium Cluster Mesh 기능을 활성화하면 클러스터 간 Pod 직접 통신이 가능하다. 각 클러스터의 Pod CIDR을 다르게 설정한 이유 중 하나이기도 하다.

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

**다음 글에서는** 네트워크 위에서 무슨 일이 일어나는지 관찰하는 모니터링과 옵저버빌리티 스택을 다룬다. Prometheus, Grafana, Loki를 사용해서 클러스터의 건강 상태를 한눈에 파악하는 방법을 알아본다.
