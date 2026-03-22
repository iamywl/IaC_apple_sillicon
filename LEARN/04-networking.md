# 04. 네트워킹 — Cilium, 보안 정책, 서비스 메시

## 목차

- [1. 쿠버네티스 네트워킹 기초](#1-쿠버네티스-네트워킹-기초)
- [2. Cilium과 Hubble](#2-cilium과-hubble)
- [3. 네트워크 보안 — 제로 트러스트](#3-네트워크-보안--제로-트러스트)
- [4. 서비스 메시 — Istio](#4-서비스-메시--istio)
- [5. tart-infra 프로젝트의 네트워크 구성](#5-tart-infra-프로젝트의-네트워크-구성)

---

## 1. 쿠버네티스 네트워킹 기초

### CNI란 무엇인가? (Container Network Interface)

CNI(Container Network Interface)는 쿠버네티스가 정한 "네트워크 플러그인 표준 규격"이다.

쿠버네티스는 의도적으로 네트워크 구현을 자체에 포함하지 않는다. 그 이유는 네트워크 요구사항이 환경마다 크게 다르기 때문이다. 베어메탈, 퍼블릭 클라우드, 엣지 환경에서 최적의 네트워크 구현은 각각 다르다. 쿠버네티스는 "Pod에 IP를 부여하고, Pod 간 NAT 없는 통신을 보장하라"는 요구사항만 정의하고, 실제 구현은 CNI 플러그인에 위임한다.

CNI가 없으면 `kubeadm init` 후 모든 노드가 `NotReady` 상태로 남는다. kubelet이 Pod에 네트워크를 부여할 방법이 없기 때문이다.

CNI 플러그인의 종류는 여러 가지다:

| 플러그인 | 특징 | 우리 프로젝트 |
|---------|------|-------------|
| Flannel | 간단, 학습용 | - |
| Calico | 네트워크 정책 강점 | - |
| **Cilium** | eBPF 기반, 고성능, 옵저버빌리티 | **채택** |
| Weave | 설치 간편 | - |

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

유저 스페이스로 패킷을 올려보내지 않고 커널 내부에서 직접 패킷 필터링, 라우팅, 로드밸런싱을 수행한다. 커널-유저 스페이스 간 컨텍스트 스위칭 비용이 제거되므로 처리 성능이 크게 향상된다.

전통적으로 네트워크 기능을 바꾸려면 커널 모듈을 컴파일하고 커널을 재시작해야 했다. eBPF는 **커널을 재시작하지 않고도 커널 수준의 프로그램을 로드**할 수 있다. 커널 재컴파일이나 재부팅 없이 런타임에 데이터플레인 로직을 변경할 수 있다는 점에서 네트워킹, 보안, 관측 분야에 근본적인 변화를 가져왔다.

### 왜 eBPF가 iptables보다 나은가

기존 네트워크 방식(iptables)은 패킷이 도착할 때마다 규칙 목록을 처음부터 끝까지 순차 탐색(O(n))하여 매칭한다. Service 수가 늘어날수록 규칙 수도 선형 증가하고, 그에 따라 패킷 처리 지연도 커진다. 규칙이 5,000개일 때와 500개일 때 패킷 처리 시간이 10배 차이 날 수 있다.

Cilium은 eBPF를 사용하여 커널 내부에서 해시 맵 기반의 O(1) 룩업으로 패킷을 처리한다. 규칙이 1,000개든 10,000개든 처리 속도가 거의 동일하다. 또한 iptables는 규칙 변경 시 전체 테이블을 재구성해야 하지만, eBPF 맵은 개별 엔트리만 업데이트하므로 규칙 변경 비용도 O(1)이다.

### Pod CIDR과 Service CIDR

#### CIDR 표기법 이해하기

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

## 2. Cilium과 Hubble

### Cilium이란?

**Cilium은 eBPF 기반의 쿠버네티스 네트워크 플러그인(CNI)이다.**

이 프로젝트가 Cilium을 채택한 이유는 세 가지다.

첫째, **eBPF 기반으로 kube-proxy를 완전히 대체**한다. Flannel이나 Calico(iptables 모드)는 별도의 kube-proxy가 필요하여 컴포넌트가 늘어나고 관리 복잡도가 증가한다. Cilium은 `kubeProxyReplacement: true` 설정 하나로 Service 라우팅, 로드밸런싱, 네트워크 정책을 모두 eBPF에서 처리한다.

둘째, **L7(HTTP/gRPC) 수준의 네트워크 정책**을 지원한다. Calico도 네트워크 정책을 지원하지만 L3/L4 수준이 기본이다. Cilium은 "이 Pod는 /api/users 경로에 GET만 허용"처럼 HTTP 경로와 메서드 단위의 제어가 가능하다.

셋째, **Hubble을 통한 L7 가시성**을 제공한다. 네트워크 문제가 발생했을 때 패킷 수준에서 어떤 Pod가 어떤 Pod에 어떤 HTTP 요청을 보냈는지 실시간으로 관찰할 수 있다. 별도의 서비스 메시 없이도 네트워크 옵저버빌리티를 확보할 수 있다.

2023년 Cilium은 CNCF(Cloud Native Computing Foundation)의 Graduated 프로젝트가 되었다. Google GKE, AWS EKS, Azure AKS 모두 Cilium을 옵션으로 제공하거나 기본 CNI로 채택하고 있다.

### kube-proxy를 대체하는 Cilium

쿠버네티스에는 기본적으로 `kube-proxy`라는 컴포넌트가 있다. 이 컴포넌트의 역할은 **Service IP로 들어온 요청을 실제 Pod로 전달**하는 것이다.

```
외부 요청 → Service (10.96.0.100:80) → kube-proxy가 전달 → Pod (10.10.0.5:8080)
```

문제는 kube-proxy가 **iptables 규칙**을 사용한다는 점이다. Service가 많아지면 규칙도 수천, 수만 개로 늘어나고, 성능이 떨어진다.

프로젝트 설정 (`manifests/cilium-values.yaml`):

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

### IPAM — IP 주소 관리

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

### Cilium 설치 과정

`scripts/install/06-install-cilium.sh`의 전체 코드:

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

실제 로직은 `scripts/lib/k8s.sh`에 있다. `install_cilium` 함수의 핵심 부분:

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

### Hubble — 네트워크 옵저버빌리티

Hubble은 Cilium의 네트워크 옵저버빌리티 컴포넌트다. Cilium 데이터플레인을 통과하는 모든 네트워크 트래픽의 메타데이터를 수집하고, 이를 기반으로 트래픽 흐름 시각화, 네트워크 정책 디버깅, 서비스 의존성 분석 등을 수행한다.

#### Hubble 설정

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

#### Hubble이 캡처하는 정보

| 필드 | 설명 | 예시 |
|------|------|------|
| source | 출발지 Pod/Service | `demo/nginx-web-xxx` |
| destination | 목적지 Pod/Service | `demo/httpbin-xxx` |
| protocol | L4/L7 프로토콜 | `TCP`, `HTTP`, `DNS` |
| verdict | 허용/차단 | `FORWARDED`, `DROPPED` |
| port | 대상 포트 | `80`, `53` |

#### hubble observe 출력 읽기

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

#### 실제로 유용한 명령어들

```bash
# 드롭된 패킷만 보기 (네트워크 정책에 의해 차단된 것들)
hubble observe --verdict DROPPED

# 특정 Pod의 트래픽만 보기
hubble observe --to-pod default/my-app

# DNS 트래픽만 보기
hubble observe --protocol DNS

# HTTP 500 에러만 필터링
hubble observe --http-status 500

# 특정 네임스페이스에서 차단된 트래픽만 필터링
hubble observe --namespace demo --verdict DROPPED

# 특정 Pod로 가는 트래픽만 보기
hubble observe --namespace demo --to-pod demo/postgres
```

#### 대시보드 연동

대시보드의 Traffic 페이지가 Hubble 데이터를 시각화한다.

```
dashboard/server/collectors/hubble.ts
  │
  ├── hubble observe --output json --last 200  (kubectl exec으로 cilium 에이전트 안에서 실행)
  │
  └── 파싱 → 엣지 집계 (source→dest 쌍별 카운트)
       │
       └── /api/traffic 엔드포인트로 프론트엔드에 제공
            │
            └── TrafficPage.tsx에서 SVG 토폴로지로 렌더링
                (초록선 = FORWARDED, 빨간선 = DROPPED)
```

Hubble UI를 NodePort 31235로 노출했기 때문에, 브라우저에서 시각적으로 네트워크 흐름을 볼 수도 있다. Service Map 기능이 있어서 Pod 간의 통신 관계를 그래프로 보여준다. 마이크로서비스 아키텍처에서 서비스 간 의존성을 한눈에 파악할 때 유용하다.

---

## 3. 네트워크 보안 — 제로 트러스트

### 제로 트러스트(Zero Trust)란?

**전통적인 보안** (경계 기반 보안):
```
[인터넷] ──── 방화벽 ──── [회사 내부 네트워크]
                              모든 내부 노드가 모든 곳에 접근 가능
```
네트워크 경계(방화벽)만 통과하면 내부의 모든 서비스에 자유롭게 접근할 수 있는 구조다. 문제는 한 지점이 뚫리면 **내부 전체가 lateral movement(횡이동 공격)에 노출된다**는 것이다. 공격자가 nginx 파드 하나를 장악하면, 그 파드를 발판 삼아 postgres, redis, rabbitmq 등 내부의 모든 서비스에 순차적으로 접근할 수 있다.

**제로 트러스트 보안**:
```
[인터넷] ──── 방화벽 ──── [회사 내부 네트워크]
                              서비스 간 통신마다 개별 인가 적용
                              서비스마다 허용된 통신 경로가 다름
                              모든 요청을 검증
```

> **"Never trust, always verify"**
> (절대 신뢰하지 마라, 항상 검증하라)

Kubernetes 클러스터에서 파드들은 기본적으로 **서로 모두 통신할 수 있다**. 이것은 매우 위험하다. 제로 트러스트를 적용하면:
- nginx는 httpbin과 redis에**만** 접근 가능
- postgres에는 httpbin과 keycloak**만** 접근 가능
- nginx가 해킹당해도 postgres에 직접 접근이 **불가능**

### Default Deny (기본 거부)

네트워크 정책에는 두 가지 접근 방식이 있다.

**Denylist(거부 목록) 방식**: 차단할 대상을 명시한다 -- 나머지는 다 허용된다.
- 문제: 새로운 위협을 매번 추가해야 하고, 하나라도 빠뜨리면 뚫린다.

**Allowlist(허용 목록) 방식**: 허용할 대상만 명시한다 -- 나머지는 다 차단된다.
- 장점: 허용한 것만 통과하고, 정의되지 않은 통신은 자동으로 차단된다.

Allowlist(Default Deny)가 Denylist보다 안전한 이유는 **실패 모드(failure mode)**의 차이에 있다. Denylist에서 정책 누락이 발생하면 차단해야 할 트래픽이 허용된다(보안 위반). Allowlist에서 정책 누락이 발생하면 허용해야 할 트래픽이 차단된다(기능 장애). 기능 장애는 즉시 감지되고 정책을 추가하면 해결된다. 이것을 **Fail-Closed** 설계라 한다.

우리 프로젝트는 **Allowlist 방식**을 쓴다.
1. **모든 통신을 차단한다** (Default Deny)
2. **필요한 통신만 하나씩 허용한다** (Allow Rules)

### L3/L4/L7 필터링

각 계층에서 잡을 수 있는 위협이 다르기 때문에 계층별 필터링이 필요하다.

| 레이어 | 검사 대상 | 설명 | 예시 |
|--------|-----------|------|------|
| **L3** (네트워크 계층) | IP 주소 | 출발지/목적지 IP를 기준으로 필터링 | 192.168.1.100에서 온 것만 허용 |
| **L4** (전송 계층) | 포트 번호 + 프로토콜 | TCP/UDP 포트를 기준으로 필터링 | TCP 80번 포트만 허용 |
| **L7** (애플리케이션 계층) | HTTP 메서드, URL 경로 | 애플리케이션 프로토콜 내용까지 검사 | GET만 허용, POST는 차단 |

일반적인 Kubernetes NetworkPolicy는 L3/L4까지만 가능하다. **CiliumNetworkPolicy**는 eBPF 기반으로 커널 레벨에서 L7 프로토콜(HTTP, gRPC, Kafka 등)까지 검사한다.

### CiliumNetworkPolicy 읽는 법

CiliumNetworkPolicy를 처음 보면 어렵게 느껴지지만, 패턴이 있다.

```yaml
spec:
  endpointSelector:    # "이 파드에 적용한다"
    matchLabels:
      app: X
  ingress:             # "이 파드로 들어오는 트래픽 중에서"
    - fromEndpoints:   # "여기서 오는 것만"
        - matchLabels:
            app: Y
      toPorts:         # "이 포트로 오는 것만"
        - ports:
            - port: "80"
```

자연어로 읽으면: **"app=X인 파드로 들어오는 트래픽 중, app=Y에서 포트 80으로 오는 것만 허용"**

L7 정책이 추가되면:
```yaml
      toPorts:
        - ports:
            - port: "80"
          rules:
            http:
              - method: "GET"  # "그 중에서도 GET 요청만"
```

자연어로 읽으면: **"...포트 80으로 오는 GET 요청만 허용"**

### 프로젝트의 10개 네트워크 정책

전체 서비스 간 통신 구조:

```
                    [외부 사용자]
                     │        │
                     ▼        ▼
               ┌──────────┐  ┌──────────┐
               │  nginx   │  │ keycloak │
               │ (포트 80) │  │(포트 8080)│
               └────┬─┬───┘  └────┬─────┘
                    │ │            │
          GET만!    │ │            │
                    │ │            │
               ┌────▼─┘    ┌──────▼──────┐
               │           │             │
          ┌────▼───┐  ┌────▼───┐         │
          │httpbin │  │ redis  │         │
          │(포트 80)│  │(포트   │         │
          └──┬─┬─┬─┘  │ 6379) │         │
             │ │ │     └───────┘         │
             │ │ │                       │
      ┌──────┘ │ └──────┐               │
      ▼        ▼        ▼               │
┌──────────┐ ┌────────┐ ┌──────────┐    │
│ postgres │ │rabbitmq│ │ keycloak │    │
│(포트 5432)│ │(포트   │ │(포트 8080)│    │
└──────────┘ │ 5672)  │ └──────────┘    │
      ▲      └────────┘                 │
      │                                  │
      └──────────────────────────────────┘
              keycloak → postgres
```

#### 정책 1: Default Deny -- 모든 것을 차단

> 파일: `manifests/network-policies/default-deny.yaml`

```yaml
apiVersion: "cilium.io/v2"
kind: CiliumNetworkPolicy
metadata:
  name: default-deny-all
  namespace: demo
spec:
  endpointSelector: {}        # 모든 파드에 적용
  ingress: []                  # 들어오는 트래픽: 전부 차단
  egress:
    - toEndpoints:
        - matchLabels:
            io.kubernetes.pod.namespace: kube-system
            k8s-app: kube-dns
      toPorts:
        - ports:
            - port: "53"
              protocol: ANY    # DNS만 예외로 허용
```

- `endpointSelector: {}` -- 빈 셀렉터는 **모든 파드**를 의미한다
- `ingress: []` -- 빈 배열은 "아무것도 허용하지 않음"을 의미한다
- DNS(포트 53)만 예외다 -- DNS가 차단되면 서비스 이름을 IP로 변환할 수 없어서 아무것도 동작하지 않기 때문이다

#### 정책 2: 외부에서 nginx로 (L4)

> 파일: `manifests/network-policies/allow-external-to-nginx.yaml`

```yaml
apiVersion: "cilium.io/v2"
kind: CiliumNetworkPolicy
metadata:
  name: allow-external-to-nginx
  namespace: demo
spec:
  endpointSelector:
    matchLabels:
      app: nginx-web           # nginx 파드에 적용
  ingress:
    - fromEntities:
        - world                # 인터넷에서 오는 트래픽
        - cluster              # 클러스터 내부에서 오는 트래픽
      toPorts:
        - ports:
            - port: "80"
              protocol: TCP    # TCP 80번 포트만 허용
```

#### 정책 3: nginx에서 httpbin으로 (L7 -- 핵심!)

> 파일: `manifests/network-policies/allow-nginx-to-httpbin.yaml`

```yaml
apiVersion: "cilium.io/v2"
kind: CiliumNetworkPolicy
metadata:
  name: allow-nginx-to-httpbin
  namespace: demo
spec:
  endpointSelector:
    matchLabels:
      app: httpbin             # httpbin 파드에 적용
  ingress:
    - fromEndpoints:
        - matchLabels:
            app: nginx-web     # nginx에서 오는 트래픽만
      toPorts:
        - ports:
            - port: "80"
              protocol: TCP
          rules:
            http:
              - method: "GET"  # HTTP GET 메서드만 허용!
```

**이것이 이 프로젝트에서 가장 중요한 네트워크 정책이다.** 일반적인 L4 정책은 "포트 80 허용"까지만 할 수 있다. 하지만 이 정책은 한 단계 더 깊이 들어간다.

```
nginx → httpbin GET /get     → 허용 (200 OK)
nginx → httpbin POST /post   → 차단 (Cilium이 거부)
nginx → httpbin DELETE /     → 차단 (Cilium이 거부)
```

웹 서버(nginx)가 API 서버(httpbin)에서 데이터를 **읽기만** 하면 되는 상황이라면, 쓰기(POST)나 삭제(DELETE) 권한은 필요 없다. 이것이 **최소 권한 원칙(Principle of Least Privilege)**이다.

#### 정책 4: nginx에서 redis로 (L4)

> 파일: `manifests/network-policies/allow-nginx-to-redis.yaml`

```yaml
apiVersion: "cilium.io/v2"
kind: CiliumNetworkPolicy
metadata:
  name: allow-nginx-to-redis
  namespace: demo
spec:
  endpointSelector:
    matchLabels:
      app: redis               # redis 파드에 적용
  ingress:
    - fromEndpoints:
        - matchLabels:
            app: nginx-web     # nginx에서만 접근 가능
      toPorts:
        - ports:
            - port: "6379"
              protocol: TCP    # Redis 기본 포트
```

#### 정책 5: nginx의 외부 나가기(Egress) 정책

> 파일: `manifests/network-policies/allow-nginx-egress.yaml`

```yaml
apiVersion: "cilium.io/v2"
kind: CiliumNetworkPolicy
metadata:
  name: allow-nginx-egress
  namespace: demo
spec:
  endpointSelector:
    matchLabels:
      app: nginx-web           # nginx 파드에 적용
  egress:
    - toEndpoints:
        - matchLabels:
            app: httpbin
      toPorts:
        - ports:
            - port: "80"
              protocol: TCP
          rules:
            http:
              - method: "GET"  # httpbin에는 GET만 가능
    - toEndpoints:
        - matchLabels:
            app: redis
      toPorts:
        - ports:
            - port: "6379"
              protocol: TCP    # redis에는 6379 포트
    - toEndpoints:
        - matchLabels:
            io.kubernetes.pod.namespace: kube-system
            k8s-app: kube-dns
      toPorts:
        - ports:
            - port: "53"
              protocol: ANY    # DNS 허용
```

nginx가 갈 수 있는 곳은 httpbin(포트 80, GET만), redis(포트 6379), DNS(포트 53) 이 3곳 **외에는 어디에도 갈 수 없다**. nginx가 해킹당해도 postgres나 rabbitmq에 접근할 수 없다.

#### 정책 6: httpbin에서 postgres로 (L4)

> 파일: `manifests/network-policies/allow-httpbin-to-postgres.yaml`

```yaml
apiVersion: "cilium.io/v2"
kind: CiliumNetworkPolicy
metadata:
  name: allow-httpbin-to-postgres
  namespace: demo
spec:
  endpointSelector:
    matchLabels:
      app: postgres            # postgres 파드에 적용
  ingress:
    - fromEndpoints:
        - matchLabels:
            app: httpbin       # httpbin에서만 접근 가능
      toPorts:
        - ports:
            - port: "5432"
              protocol: TCP
```

프론트엔드(nginx)는 반드시 API 계층(httpbin)을 거쳐야만 데이터 계층(postgres)에 접근할 수 있고, 직접 접근은 네트워크 수준에서 차단된다 (다계층 아키텍처의 기본 원칙).

#### 정책 7: httpbin에서 rabbitmq로 (L4)

> 파일: `manifests/network-policies/allow-httpbin-to-rabbitmq.yaml`

```yaml
apiVersion: "cilium.io/v2"
kind: CiliumNetworkPolicy
metadata:
  name: allow-httpbin-to-rabbitmq
  namespace: demo
spec:
  endpointSelector:
    matchLabels:
      app: rabbitmq            # rabbitmq 파드에 적용
  ingress:
    - fromEndpoints:
        - matchLabels:
            app: httpbin       # httpbin에서만 접근 가능
      toPorts:
        - ports:
            - port: "5672"
              protocol: TCP    # AMQP 프로토콜 기본 포트
```

관리용 포트(15672)는 허용하지 않아서, 외부에서 RabbitMQ 관리 콘솔에 접근할 수 없다.

#### 정책 8: httpbin에서 keycloak으로 (L4)

> 파일: `manifests/network-policies/allow-httpbin-to-keycloak.yaml`

```yaml
apiVersion: "cilium.io/v2"
kind: CiliumNetworkPolicy
metadata:
  name: allow-httpbin-to-keycloak
  namespace: demo
spec:
  endpointSelector:
    matchLabels:
      app: keycloak            # keycloak 파드에 적용
  ingress:
    - fromEndpoints:
        - matchLabels:
            app: httpbin       # httpbin에서만 접근 가능
      toPorts:
        - ports:
            - port: "8080"
              protocol: TCP
```

#### 정책 9: keycloak에서 postgres로 (L4)

> 파일: `manifests/network-policies/allow-keycloak-to-postgres.yaml`

```yaml
apiVersion: "cilium.io/v2"
kind: CiliumNetworkPolicy
metadata:
  name: allow-keycloak-to-postgres
  namespace: demo
spec:
  endpointSelector:
    matchLabels:
      app: postgres            # postgres 파드에 적용
  ingress:
    - fromEndpoints:
        - matchLabels:
            app: keycloak      # keycloak에서만 접근 가능
      toPorts:
        - ports:
            - port: "5432"
              protocol: TCP
```

PostgreSQL에 접근할 수 있는 서비스는 **딱 2개**뿐이다: httpbin(정책 6)과 keycloak(정책 9).

#### 정책 10: 외부에서 keycloak으로 (L4)

> 파일: `manifests/network-policies/allow-external-to-keycloak.yaml`

```yaml
apiVersion: "cilium.io/v2"
kind: CiliumNetworkPolicy
metadata:
  name: allow-external-to-keycloak
  namespace: demo
spec:
  endpointSelector:
    matchLabels:
      app: keycloak            # keycloak 파드에 적용
  ingress:
    - fromEntities:
        - cluster
        - world                # 외부에서 접근 허용
      toPorts:
        - ports:
            - port: "8080"
              protocol: TCP
```

외부에서 직접 접근할 수 있는 서비스는 **딱 2개**뿐이다: nginx(정책 2)와 keycloak(정책 10). 나머지 서비스(httpbin, redis, postgres, rabbitmq)는 외부에서 **절대 직접 접근할 수 없다**.

### 전체 정책 요약 표

| 번호 | 정책 이름 | 방향 | 출발지 | 도착지 | 포트 | 레이어 | 특이사항 |
|------|-----------|------|--------|--------|------|--------|----------|
| 1 | default-deny-all | 양방향 | 전체 | 전체 | 전체 차단 | - | DNS(53)만 예외 |
| 2 | allow-external-to-nginx | Ingress | 외부 | nginx | 80 | L4 | world + cluster |
| 3 | allow-nginx-to-httpbin | Ingress | nginx | httpbin | 80 | **L7** | **GET만 허용** |
| 4 | allow-nginx-to-redis | Ingress | nginx | redis | 6379 | L4 | |
| 5 | allow-nginx-egress | Egress | nginx | httpbin, redis, DNS | 80, 6379, 53 | L7/L4 | 나가는 방향 |
| 6 | allow-httpbin-to-postgres | Ingress | httpbin | postgres | 5432 | L4 | |
| 7 | allow-httpbin-to-rabbitmq | Ingress | httpbin | rabbitmq | 5672 | L4 | |
| 8 | allow-httpbin-to-keycloak | Ingress | httpbin | keycloak | 8080 | L4 | 토큰 검증용 |
| 9 | allow-keycloak-to-postgres | Ingress | keycloak | postgres | 5432 | L4 | |
| 10 | allow-external-to-keycloak | Ingress | 외부 | keycloak | 8080 | L4 | 로그인 페이지 |

### Ingress vs Egress

```
       Egress (나가는 것)              Ingress (들어오는 것)
            ──────→                      ──────→
  [nginx 파드]              →           [httpbin 파드]
  "내가 어디로 갈 수 있는가?"            "누가 나에게 올 수 있는가?"
```

완벽한 보안을 위해서는 **양쪽 모두** 설정해야 한다. 우리 프로젝트에서 nginx는 Ingress(정책 2)와 Egress(정책 5) 모두 설정되어 있다.

### Hubble로 네트워크 정책 디버깅하기

```bash
# Hubble CLI로 demo 네임스페이스의 트래픽 관찰
hubble observe --namespace demo

# 출력 예시:
# TIMESTAMP    SOURCE          DESTINATION     TYPE      VERDICT
# 12:00:01     nginx-web       httpbin         l7/HTTP   FORWARDED   GET /get
# 12:00:02     nginx-web       httpbin         l7/HTTP   DROPPED     POST /post
# 12:00:03     nginx-web       redis           l4/TCP    FORWARDED   6379
# 12:00:04     nginx-web       postgres        l4/TCP    DROPPED     5432
```

| VERDICT | 의미 | 원인 |
|---------|------|------|
| `FORWARDED` | 허용됨 | 네트워크 정책에 의해 허용된 트래픽 |
| `DROPPED` | 차단됨 | 네트워크 정책에 의해 거부된 트래픽 |

DROPPED가 보이면 어떤 정책이 차단하고 있는지 찾아서 수정하면 된다.

---

## 4. 서비스 메시 — Istio

### 서비스 메시가 필요한 이유

마이크로서비스 아키텍처에서는 서비스 수가 늘어날수록 서비스 간 통신의 복잡도가 급격히 증가한다. 서비스가 N개이면 가능한 통신 경로는 최대 N(N-1)개다. 6개 서비스만 해도 30개의 경로가 존재한다.

**통신 관측이 불가능하다.** 기본 쿠버네티스에서는 파드 간 네트워크 트래픽에 대한 메트릭, 트레이싱, 로그가 없다.

**통신 제어가 불가능하다.** 트래픽 비율 분할(카나리 배포), 장애 격리(서킷 브레이커), 자동 재시도, 타임아웃 같은 네트워크 수준의 제어를 하려면 각 서비스 코드에 직접 구현해야 한다.

서비스 메시는 이 두 문제를 **인프라 계층에서** 해결한다.

| 상황 | 서비스 메시 없을 때 | 서비스 메시 있을 때 |
|------|-------------------|-------------------|
| 파드 간 통신이 평문(plain text) | 네트워크를 도청하면 데이터가 그대로 보임 | 자동으로 mTLS 암호화 |
| 새 버전 배포 | 한 번에 전체 교체 (위험) | 1%씩 천천히 카나리 배포 가능 |
| 특정 서비스 장애 | 장애가 다른 서비스로 전파 (cascading failure) | 서킷 브레이커가 장애 격리 |
| 트래픽 분석 | 별도 로깅 코드를 각 서비스에 삽입해야 함 | 메시가 자동으로 모든 트래픽 기록 |

### Istio란?

**Istio**는 가장 널리 쓰이는 서비스 메시 구현체다. Google, IBM, Lyft가 만든 오픈소스 프로젝트이며 CNCF 졸업 프로젝트이기도 하다.

서비스 메시 구현체에는 Istio 외에도 Linkerd, Consul Connect 등이 있다. Istio를 선택한 이유:

- **mTLS가 자동화되어 있다.** 인증서 발급, 갱신, 교체를 자동으로 처리한다.
- **L7 트래픽 관리가 가능하다.** VirtualService와 DestinationRule로 트래픽 비율 분할, 서킷 브레이커, 재시도, 타임아웃을 선언형으로 설정할 수 있다.
- **L7 관측(Observability)을 제공한다.** 모든 요청의 응답 시간, 에러율, 처리량을 Envoy 프록시가 자동으로 수집한다.

### 사이드카(Sidecar) 패턴

Istio의 핵심 아이디어는 **사이드카 패턴**이다. 애플리케이션 컨테이너 **옆에** Envoy 프록시 컨테이너를 하나 자동으로 주입하는 방식이다.

```
┌─────────────── Pod ───────────────┐
│                                    │
│  ┌──────────────┐  ┌────────────┐ │
│  │ 여러분의 앱   │  │  Envoy     │ │
│  │ (httpbin)    │  │  Proxy     │ │
│  │              │  │  (사이드카) │ │
│  └──────────────┘  └────────────┘ │
│                                    │
└────────────────────────────────────┘
```

모든 트래픽은 Envoy를 통해 들어오고 나간다. 앱은 자신이 프록시를 거치는지조차 모른다 -- 코드를 한 줄도 바꿀 필요가 없다. Go, Python, Java 등 서로 다른 언어로 작성된 서비스에도 동일한 네트워크 정책을 일관되게 적용할 수 있다.

### 프로젝트의 Istio 설정

리소스가 제한된 Apple Silicon Mac 위에서 돌리기 때문에 Istio의 리소스를 신중하게 제한한다.

```yaml
# manifests/istio/istio-values.yaml

pilot:
  resources:
    requests:
      cpu: 200m
      memory: 256Mi
    limits:
      cpu: 500m
      memory: 512Mi
  autoscaleEnabled: false

meshConfig:
  accessLogFile: /dev/stdout
  enableTracing: false

global:
  proxy:
    resources:
      requests:
        cpu: 50m
        memory: 64Mi
      limits:
        cpu: 200m
        memory: 128Mi
```

- **pilot**: Istio의 컨트롤 플레인 컴포넌트. 어떤 파드에 어떤 라우팅 규칙, 정책을 적용할지 결정한다
- **autoscaleEnabled: false**: 맥 한 대에서 돌리니까 오토스케일링은 끈다
- **accessLogFile: /dev/stdout**: 모든 트래픽 로그를 표준 출력에 기록한다. `kubectl logs`로 확인 가능
- **proxy.resources**: 각 사이드카 Envoy 프록시가 사용할 CPU/메모리 한도. 50m CPU는 0.05코어

### mTLS (상호 TLS)

일반 TLS(HTTPS)는 **서버**만 인증서를 제시한다. **mTLS**(mutual TLS)는 **양쪽 모두** 인증서를 교환하여 상호 인증을 수행한다.

```
파드 A (httpbin)                    파드 B (nginx)
   │                                   │
   │  1. "나는 httpbin이야" (인증서)     │
   │ ──────────────────────────────►   │
   │                                   │
   │  2. "나는 nginx야" (인증서)        │
   │ ◄──────────────────────────────   │
   │                                   │
   │  3. 양쪽 다 확인 완료 → 암호화 통신  │
   │ ◄════════════════════════════►   │
```

클러스터 내부라고 해서 안전한 것이 아니다:
1. 같은 클러스터에 다른 팀의 서비스도 돌아간다 -- 의도치 않은 접근이 발생할 수 있다
2. 보안 감사에서 "파드 간 통신도 암호화해야 한다"는 요구사항이 거의 항상 나온다
3. 공격자가 클러스터 내부에 침입했을 때 평문 통신 도청을 방지한다

#### PeerAuthentication STRICT 모드

```yaml
# manifests/istio/peer-authentication.yaml

apiVersion: security.istio.io/v1beta1
kind: PeerAuthentication
metadata:
  name: demo-strict-mtls
  namespace: demo
spec:
  mtls:
    mode: STRICT
```

이 YAML을 적용하면:
- demo 네임스페이스의 **모든 파드가 mTLS 없이는 통신을 거부**한다
- Istio 사이드카가 없는 파드가 접근하면 **연결이 차단**된다
- 인증서 발급, 갱신, 교체 모두 **Istio가 자동으로** 처리한다

`mode` 옵션:

| 모드 | 동작 |
|------|------|
| `PERMISSIVE` | mTLS와 평문 모두 허용 (마이그레이션 기간에 사용) |
| `STRICT` | mTLS만 허용 (프로덕션 권장) |
| `DISABLE` | mTLS 비활성화 |

### 카나리 배포 (Canary Deployment)

새 버전을 전체 사용자에게 한 번에 배포(Big Bang Deployment)하면, 그 버전에 결함이 있을 경우 **전체 사용자가 동시에 영향을 받는다**. 카나리 배포는 전체 트래픽의 일부(예: 20%)에만 새 버전을 먼저 노출하여, 문제가 발생해도 영향 범위를 해당 비율로 제한한다.

#### httpbin v2 Deployment

```yaml
# manifests/istio/httpbin-v2.yaml

apiVersion: apps/v1
kind: Deployment
metadata:
  name: httpbin-v2
  namespace: demo
spec:
  replicas: 1
  selector:
    matchLabels:
      app: httpbin
      version: v2
  template:
    metadata:
      labels:
        app: httpbin
        version: v2
    spec:
      containers:
        - name: httpbin
          image: kong/httpbin:latest
          ports:
            - containerPort: 80
          resources:
            requests:
              cpu: 50m
              memory: 64Mi
            limits:
              cpu: 200m
              memory: 256Mi
```

핵심은 **labels**다: 기존 v1에는 `version: v1`, 새 v2에는 `version: v2`. 둘 다 `app: httpbin` 라벨을 가지고 있어서 같은 Service로 묶이지만, Istio의 VirtualService가 **버전별로 트래픽을 나눠 보낸다**.

#### VirtualService -- 트래픽 분할

```yaml
# manifests/istio/virtual-service.yaml

apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: httpbin-routing
  namespace: demo
spec:
  hosts:
    - httpbin
  http:
    - match:
        - headers:
            x-canary:
              exact: "true"
      route:
        - destination:
            host: httpbin
            subset: v2
    - route:
        - destination:
            host: httpbin
            subset: v1
          weight: 80
        - destination:
            host: httpbin
            subset: v2
          weight: 20
```

**첫 번째 규칙** (match 블록): HTTP 헤더에 `x-canary: true`가 있으면 무조건 v2로 보낸다. 개발자가 테스트할 때 이 헤더를 넣어서 v2를 직접 확인할 수 있다.

**두 번째 규칙** (기본 라우팅): 일반 트래픽의 **80%는 v1**으로, **20%는 v2**로 보낸다.

```
사용자 요청 100개
    │
    ├── 80개 → httpbin v1 (안정 버전)
    │
    └── 20개 → httpbin v2 (새 버전, 카나리)
```

실제 프로덕션에서의 카나리 배포 흐름:
1. v2 배포 → weight를 v1:99, v2:1로 시작
2. 에러율, 응답 시간 모니터링
3. 문제 없으면 v1:90, v2:10으로 올림
4. 계속 괜찮으면 v1:50, v2:50
5. 최종적으로 v1:0, v2:100으로 전환
6. v1 Deployment 삭제

이 과정을 자동화한 것이 **Argo Rollouts**나 **Flagger** 같은 도구다.

### 서킷 브레이커(Circuit Breaker)

마이크로서비스 환경에서 가장 위험한 장애 패턴은 **Cascading Failure(연쇄 장애)**이다. 하나의 서비스가 응답하지 않으면, 그 서비스를 호출하는 모든 서비스가 타임아웃 대기에 빠지고, 연쇄적으로 응답 불능 상태에 빠진다.

```
정상 상태:         요청 → 서비스 A → 서비스 B (정상 응답)

에러 반복:         요청 → 서비스 A → 서비스 B (5xx 에러 3번 연속!)
                                         ↓
서킷 오픈:         요청 → 서비스 A ──X── 서비스 B (30초간 차단)
                              │
                              └── 즉시 에러 반환 (빠른 실패)

30초 후 재시도:    요청 → 서비스 A → 서비스 B (정상이면 서킷 닫힘)
```

서킷 브레이커 없이 서비스 B가 죽으면:
1. 서비스 A가 B를 호출할 때마다 타임아웃(30초) 대기
2. A의 스레드가 전부 B 대기에 묶임
3. A도 응답을 못 하게 되고
4. A를 호출하는 서비스 C, D도 연쇄적으로 죽음 -> **장애 전파(Cascading Failure)**

서킷 브레이커가 있으면:
1. B가 에러 3번 -> 서킷 브레이커 작동
2. A는 B를 호출하지 않고 **즉시 에러를 반환** (0.001초)
3. A의 스레드가 묶이지 않아 **다른 기능은 정상 동작**
4. 30초 후 B가 복구되면 자동으로 다시 연결

#### DestinationRule -- 서킷 브레이커 설정

```yaml
# manifests/istio/destination-rule.yaml

apiVersion: networking.istio.io/v1beta1
kind: DestinationRule
metadata:
  name: httpbin-destination
  namespace: demo
spec:
  host: httpbin
  trafficPolicy:
    outlierDetection:
      consecutive5xxErrors: 3
      interval: 30s
      baseEjectionTime: 30s
      maxEjectionPercent: 50
    connectionPool:
      tcp:
        maxConnections: 100
      http:
        h2UpgradePolicy: DO_NOT_UPGRADE
  subsets:
    - name: v1
      labels:
        version: v1
    - name: v2
      labels:
        version: v2
```

**outlierDetection** (이상치 탐지 = 서킷 브레이커):

| 항목 | 값 | 의미 |
|------|-----|------|
| `consecutive5xxErrors` | 3 | 5xx 에러가 **연속 3번** 발생하면 |
| `interval` | 30s | **30초 간격**으로 상태를 체크하고 |
| `baseEjectionTime` | 30s | 문제 있는 인스턴스를 **30초간 제외** |
| `maxEjectionPercent` | 50 | 전체 인스턴스의 **최대 50%**만 제외 가능 |

`maxEjectionPercent: 50`이 중요하다. 이것이 없으면 모든 인스턴스가 제외되어 서비스 자체가 완전히 죽을 수 있다. 50%로 제한하면 최소한 절반은 항상 살아 있다.

**connectionPool** (연결 풀):

| 항목 | 값 | 의미 |
|------|-----|------|
| `maxConnections` | 100 | TCP 연결을 최대 100개로 제한 |
| `h2UpgradePolicy` | DO_NOT_UPGRADE | HTTP/2 업그레이드 비활성화 |

### Istio Gateway -- 외부 트래픽 진입점

```yaml
# manifests/istio/istio-gateway.yaml

apiVersion: networking.istio.io/v1beta1
kind: Gateway
metadata:
  name: demo-gateway
  namespace: demo
spec:
  selector:
    istio: ingressgateway
  servers:
    - port:
        number: 80
        name: http
        protocol: HTTP
      hosts:
        - "*"
---
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: nginx-gateway-routing
  namespace: demo
spec:
  hosts:
    - "*"
  gateways:
    - demo-gateway
  http:
    - match:
        - uri:
            prefix: /api
      route:
        - destination:
            host: httpbin
            port:
              number: 80
    - route:
        - destination:
            host: nginx-web
            port:
              number: 80
```

```
외부 요청
    │
    ├── /api/*  → httpbin (REST API 서비스)
    │
    └── 그 외   → nginx-web (웹 프론트엔드)
```

Gateway는 클러스터로 들어오는 모든 외부 트래픽의 단일 진입점이다. URI 경로 기반으로 요청을 적절한 내부 서비스로 라우팅한다.

### 서비스 메시와 네트워크 정책의 관계

Cilium 네트워크 정책과 Istio 서비스 메시는 **서로 다른 계층**에서 동작한다.

```
┌─────────────────────────────────────────┐
│           Layer 7 (Application)          │
│  Istio VirtualService, DestinationRule  │
│  → 트래픽 분할, 서킷 브레이커, mTLS      │
├─────────────────────────────────────────┤
│           Layer 3/4 (Network)            │
│  Cilium NetworkPolicy                   │
│  → 파드 간 통신 허용/차단 (IP, 포트)      │
└─────────────────────────────────────────┘
```

1. Cilium이 먼저 "이 트래픽이 이 파드에 접근할 수 있는가?"를 판단한다 (L3/L4)
2. 통과하면 Istio가 "이 트래픽을 어느 버전으로 보낼까? mTLS 인증서는 유효한가?"를 판단한다 (L7)

둘 다 사용하는 것이 **Defense in Depth**(심층 방어) 전략이다.
- NetworkPolicy만 있으면: 트래픽 관리(카나리, 서킷 브레이커)가 없다
- Istio만 있으면: Istio 사이드카를 우회하면 보안이 뚫린다
- **둘 다 쓰면**: 네트워크 레벨에서 먼저 차단하고, 통과한 트래픽을 애플리케이션 레벨에서 다시 제어한다

---

## 5. tart-infra 프로젝트의 네트워크 구성

### 전체 네트워크 아키텍처

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

### 클러스터별 CIDR 설계

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

4개의 클러스터가 각각 다른 IP 대역을 사용하는 이유는 **향후 멀티클러스터 라우팅**을 위한 설계이다. Cilium Cluster Mesh나 Submariner 같은 도구로 클러스터 간 Pod 직접 통신을 구성하려면, 각 클러스터의 Pod CIDR이 반드시 겹치지 않아야 한다. 라우팅 테이블은 목적지 IP 대역을 기준으로 패킷을 전달하는데, 두 클러스터가 동일한 대역을 사용하면 라우터가 패킷을 어느 클러스터로 보내야 할지 결정할 수 없다. 초기 설계 단계에서 CIDR을 분리해두는 것이 올바른 선택이다.

### Istio 서비스 메시 (dev 클러스터만)

Istio는 dev 클러스터에만 설치한다. 설치 관련 파일 구조:

```
scripts/install/12-install-istio.sh   <- 설치 스크립트
manifests/istio/                      <- Istio 리소스 정의
  ├── istio-values.yaml               <- Helm values
  ├── peer-authentication.yaml        <- mTLS 설정
  ├── virtual-service.yaml            <- 트래픽 라우팅
  ├── destination-rule.yaml           <- 서킷 브레이커
  ├── httpbin-v2.yaml                 <- v2 배포
  └── istio-gateway.yaml              <- 인그레스 게이트웨이
```

### Istio가 프로젝트에서 하는 일 -- 전체 그림

```
외부 요청
    │
    ▼
[Istio Gateway]
    │
    ├─ /api/* ──────────┐
    │                   ▼
    │           [VirtualService]
    │               │
    │               ├── 80% → httpbin v1
    │               └── 20% → httpbin v2
    │                        (카나리)
    │
    └─ /* ──► nginx-web

모든 파드 간 통신:
    [PeerAuthentication STRICT]
    → 자동 mTLS 암호화

장애 감지:
    [DestinationRule outlierDetection]
    → 5xx 3회 연속 → 30초 격리
```

### 네트워크 정책으로 보호된 트래픽 흐름

```
외부 → nginx (30080 NodePort)           <- allow-external-to-nginx
         │
         ├─ GET /api → httpbin (허용)    <- allow-nginx-to-httpbin (L7)
         ├─ POST /api → httpbin (차단!)  <- L7 정책: GET만 허용
         ├─ → redis:6379 (허용)          <- allow-nginx-to-redis
         ├─ → DNS:53 (허용)              <- allow-nginx-egress
         └─ → 기타 (차단!)              <- default-deny + egress 제한
```

### Istio 사이드카 네트워크 정책

Istio 사이드카가 사용하는 포트도 네트워크 정책에서 허용해야 한다:

```yaml
# manifests/network-policies/allow-istio-sidecars.yaml
# Envoy 프록시가 사용하는 포트들을 허용
toPorts:
  - ports:
      - port: "15000"   # Envoy admin
      - port: "15006"   # Envoy inbound
```

### 네트워킹 수정 가이드

| 하고 싶은 것 | 수정할 파일 |
|-------------|-----------|
| Pod CIDR 변경 | `config/clusters.json`의 pod_cidr |
| 새 네트워크 정책 추가 | `manifests/network-policies/`에 YAML 추가 |
| L7 필터링 규칙 변경 | 해당 네트워크 정책의 `rules.http` 섹션 |
| 카나리 배포 비율 변경 | `manifests/istio/virtual-service.yaml`의 weight |
| 서킷 브레이커 설정 변경 | `manifests/istio/destination-rule.yaml`의 outlierDetection |
| Hubble 수집량 변경 | `dashboard/server/collectors/hubble.ts`의 `--last 200` |

### 관련 파일 전체 목록

| 파일 | 역할 |
|------|------|
| `manifests/cilium-values.yaml` | Cilium Helm 차트 설정값 |
| `manifests/hubble-values.yaml` | Hubble 활성화 설정값 |
| `scripts/install/06-install-cilium.sh` | Cilium + Hubble 설치 스크립트 |
| `scripts/install/12-install-istio.sh` | Istio 설치 스크립트 |
| `scripts/lib/k8s.sh` | install_cilium(), install_hubble() 함수 정의 |
| `config/clusters.json` | 클러스터별 Pod CIDR, Service CIDR 정의 |
| `manifests/network-policies/` | 10개의 CiliumNetworkPolicy 정의 |
| `manifests/istio/` | Istio 리소스 (VirtualService, DestinationRule 등) |
| `dashboard/server/collectors/hubble.ts` | Hubble 데이터 수집 및 대시보드 연동 |

---

## 핵심 정리

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
| 제로 트러스트 | 아무도 믿지 마라, 항상 검증하라 |
| Default Deny | 모든 것을 먼저 차단하고, 필요한 것만 허용 |
| L3/L4/L7 필터링 | IP, 포트, HTTP 메서드 수준의 계층별 네트워크 필터링 |
| CiliumNetworkPolicy | Cilium이 제공하는 L7까지 가능한 네트워크 정책 |
| 서비스 메시 | 앱 코드 변경 없이 네트워크를 제어하는 인프라 계층 |
| Istio | 가장 널리 쓰이는 서비스 메시 구현체 |
| 사이드카 패턴 | 각 파드에 Envoy 프록시를 자동 주입 |
| mTLS | 파드 간 상호 인증 + 암호화 |
| 카나리 배포 | 새 버전에 트래픽 일부만 보내 안전하게 배포 |
| 서킷 브레이커 | 에러 반복 시 해당 인스턴스를 일시 격리 |
| VirtualService | Istio의 L7 트래픽 라우팅 규칙 |
| DestinationRule | Istio의 서킷 브레이커 및 서브셋 정의 |
| Gateway | 외부 트래픽의 클러스터 진입점 |
| Defense in Depth | Cilium(L3/L4) + Istio(L7)를 함께 사용하는 심층 방어 전략 |
