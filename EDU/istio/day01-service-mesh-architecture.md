# Day 1: Service Mesh 개념, Istio 아키텍처

> 이 문서에서는 Service Mesh가 필요한 이유, Sidecar vs Ambient 패턴, Istio의 전체 아키텍처(Control Plane, Data Plane), istiod 내부 구조, Envoy Proxy 상세, xDS API, 그리고 Sidecar Injection 메커니즘을 다룬다.

---

## 1. Service Mesh 개념 심화

### 1.1 왜 Service Mesh가 필요한가?

마이크로서비스 아키텍처는 서비스 간 네트워크 통신이 핵심이다. 모놀리식 애플리케이션에서는 함수 호출이었던 것이 마이크로서비스에서는 네트워크 호출로 바뀐다. 이 전환은 다음과 같은 근본적인 문제를 야기한다.

**네트워크는 신뢰할 수 없다 (Fallacies of Distributed Computing):**

Peter Deutsch가 정리한 분산 컴퓨팅의 8가지 오류(fallacy)가 있다.

| 번호 | 오류 (Fallacy) | 현실 |
|------|---------------|------|
| 1 | 네트워크는 신뢰할 수 있다 | 패킷 손실, 연결 끊김, 타임아웃이 항상 발생한다 |
| 2 | 지연 시간(latency)은 0이다 | 네트워크 홉마다 지연이 누적된다 |
| 3 | 대역폭은 무한하다 | 대역폭 제한으로 병목이 발생한다 |
| 4 | 네트워크는 안전하다 | 중간자 공격, 도청이 가능하다 |
| 5 | 토폴로지는 변하지 않는다 | Kubernetes에서 Pod IP는 수시로 변경된다 |
| 6 | 관리자가 한 명이다 | 여러 팀이 독립적으로 서비스를 운영한다 |
| 7 | 전송 비용은 0이다 | 직렬화/역직렬화, 암호화에 CPU 비용이 든다 |
| 8 | 네트워크는 동질적이다 | 다양한 프로토콜, 라이브러리, 언어가 혼재한다 |

**서비스 메시 이전의 접근법과 한계:**

마이크로서비스 간 통신 문제를 해결하기 위해 역사적으로 세 가지 접근법이 존재했다.

| 접근법 | 설명 | 한계 |
|--------|------|------|
| **라이브러리 패턴** | Netflix OSS(Hystrix, Ribbon, Eureka) 같은 라이브러리를 각 서비스에 포함한다 | 언어별로 라이브러리가 필요하다. 라이브러리 업그레이드 시 모든 서비스를 재배포해야 한다. 개발자가 네트워크 로직을 이해해야 한다 |
| **API Gateway 패턴** | 중앙 게이트웨이가 라우팅, 인증, 속도 제한을 처리한다 | north-south 트래픽만 처리한다. east-west(서비스 간) 트래픽은 관리하지 못한다. 단일 장애점이 된다 |
| **Service Mesh 패턴** | 각 서비스 옆에 프록시를 배치하여 네트워크 기능을 인프라 레이어에서 처리한다 | 리소스 오버헤드가 있다. 운영 복잡성이 증가한다. 디버깅이 어려워질 수 있다 |

Service Mesh는 애플리케이션 코드에서 네트워크 관련 로직(재시도, 타임아웃, 서킷 브레이커, mTLS, 관찰성)을 완전히 분리한다. 개발자는 비즈니스 로직에만 집중할 수 있고, 플랫폼 팀이 네트워크 정책을 일관되게 적용할 수 있다.

**Service Mesh가 해결하는 핵심 문제:**

```
┌─────────────────────────────────────────────────────────────────┐
│                    Service Mesh 가 제공하는 기능                   │
│                                                                  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │  트래픽 관리      │  │     보안         │  │   관찰성         │  │
│  │                  │  │                  │  │                  │  │
│  │ - 로드밸런싱      │  │ - mTLS 암호화    │  │ - 메트릭 수집    │  │
│  │ - 서비스 디스커버리│  │ - 인증 (AuthN)   │  │ - 분산 트레이싱  │  │
│  │ - 카나리 배포     │  │ - 인가 (AuthZ)   │  │ - 접근 로그     │  │
│  │ - 서킷 브레이커   │  │ - 인증서 관리    │  │ - 서비스 토폴로지│  │
│  │ - 재시도/타임아웃  │  │ - 네트워크 정책  │  │ - 헬스 체크     │  │
│  │ - 폴트 인젝션     │  │ - Rate Limiting │  │ - 대시보드      │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 Sidecar 패턴 vs Ambient 패턴

Istio는 두 가지 데이터 플레인 모드를 지원한다.

**Sidecar 패턴 (전통적 모드):**

각 Pod에 Envoy 프록시 컨테이너를 주입한다. 모든 inbound/outbound 트래픽이 이 프록시를 경유한다.

```
┌─────────────────────────────────────────┐
│  Sidecar 모드                            │
│                                          │
│  ┌───────────────────────┐               │
│  │ Pod                    │               │
│  │ ┌──────────┐          │               │
│  │ │ App 컨테이너│          │               │
│  │ └─────┬────┘          │               │
│  │       │ localhost      │               │
│  │ ┌─────▼────┐          │               │
│  │ │ Envoy    │          │               │
│  │ │ Sidecar  │◄────────►│ ← 모든 트래픽 │
│  │ └──────────┘          │   경유         │
│  └───────────────────────┘               │
│                                          │
│  장점:                                    │
│  - Pod 단위 세밀한 제어                    │
│  - L7 기능 완전 지원                       │
│  - 성숙하고 검증된 모델                    │
│                                          │
│  단점:                                    │
│  - Pod당 ~50MB+ 메모리 오버헤드            │
│  - 사이드카 주입을 위한 Pod 재시작 필요     │
│  - Envoy 업그레이드 시 전체 Pod 재시작      │
│  - iptables 규칙에 의한 미세한 지연 추가    │
└─────────────────────────────────────────┘
```

**Ambient 패턴 (Sidecar-less 모드):**

Pod에 사이드카를 주입하지 않는다. 대신 노드 단위의 ztunnel(L4)과 선택적인 Waypoint Proxy(L7)를 사용한다.

```
┌─────────────────────────────────────────┐
│  Ambient 모드                            │
│                                          │
│  ┌──────┐ ┌──────┐ ┌──────┐             │
│  │Pod A │ │Pod B │ │Pod C │  ← 사이드카  │
│  │(앱만)│ │(앱만)│ │(앱만)│    없음       │
│  └──┬───┘ └──┬───┘ └──┬───┘             │
│     │        │        │                  │
│  ┌──▼────────▼────────▼──┐               │
│  │      ztunnel           │  ← 노드당 1개│
│  │   (L4: mTLS, 인가)     │    DaemonSet │
│  └────────────┬───────────┘               │
│               │ (L7 필요 시)               │
│  ┌────────────▼───────────┐               │
│  │    Waypoint Proxy       │  ← 선택적   │
│  │  (L7: 라우팅, 인가)     │    배포      │
│  └─────────────────────────┘               │
│                                          │
│  장점:                                    │
│  - 메모리 오버헤드 대폭 감소               │
│  - Pod 재시작 없이 메시 편입 가능           │
│  - Envoy 업그레이드가 Pod에 영향 없음      │
│  - 필요한 곳에만 L7 기능 활성화            │
│                                          │
│  단점:                                    │
│  - 아직 발전 중인 기술 (GA 진행 중)        │
│  - Sidecar 모드 대비 일부 기능 미지원      │
│  - ztunnel 장애 시 노드 전체 영향          │
└─────────────────────────────────────────┘
```

**모드 선택 기준:**

| 기준 | Sidecar 모드 | Ambient 모드 |
|------|-------------|-------------|
| 리소스 효율성 | 낮음 (Pod마다 Envoy) | 높음 (노드당 ztunnel) |
| L7 기능 범위 | 모든 Pod에서 완전 지원 | Waypoint Proxy 배포 시에만 |
| 운영 성숙도 | 매우 높음 (수년간 프로덕션 검증) | 발전 중 |
| Pod 라이프사이클 영향 | 사이드카 주입/업그레이드 시 재시작 | 없음 |
| 장애 격리 | Pod 단위 격리 | 노드 단위 (ztunnel) |
| 프로토콜 감지 | Pod별 세밀한 제어 | 노드 수준 |

### 1.3 Data Plane vs Control Plane

Service Mesh는 Data Plane과 Control Plane으로 구성된다. 이 분리는 네트워킹에서 차용한 개념이다. SDN(Software Defined Networking)에서 forwarding plane과 control plane을 분리한 것과 동일한 철학이다.

```
┌──────────────────────────────────────────────────────────────────┐
│                        Control Plane                              │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │                         istiod                               │  │
│  │                                                              │  │
│  │  역할:                                                        │  │
│  │  - 정책(Policy)을 정의하고 Data Plane에 배포한다               │  │
│  │  - 서비스 레지스트리를 관리한다                                 │  │
│  │  - 인증서를 발급하고 갱신한다                                   │  │
│  │  - Istio CRD를 Envoy 설정으로 변환한다                         │  │
│  │  - Admission Webhook으로 사이드카 주입을 수행한다              │  │
│  │                                                              │  │
│  │  특성:                                                        │  │
│  │  - Stateless하게 설계되어 수평 확장이 가능하다                  │  │
│  │  - Kubernetes API Server를 데이터 저장소로 사용한다            │  │
│  │  - Control Plane 장애 시에도 Data Plane은 마지막 설정으로 동작  │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                              │                                    │
│                              │ xDS (gRPC, streaming)              │
│                              │ push-based 모델                    │
│                              ▼                                    │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │                        Data Plane                            │  │
│  │                                                              │  │
│  │  역할:                                                        │  │
│  │  - 실제 네트워크 트래픽을 처리한다 (forwarding)                │  │
│  │  - Control Plane에서 받은 정책을 실행한다                      │  │
│  │  - 텔레메트리 데이터를 생성한다                                │  │
│  │  - mTLS 핸드셰이크를 수행한다                                  │  │
│  │                                                              │  │
│  │  구성 요소:                                                    │  │
│  │  - Envoy Proxy (사이드카 모드)                                 │  │
│  │  - ztunnel + Waypoint Proxy (Ambient 모드)                    │  │
│  │  - Ingress/Egress Gateway (클러스터 경계)                      │  │
│  └─────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

**Control Plane과 Data Plane 분리의 이점:**

1. **독립적 스케일링**: Control Plane과 Data Plane을 독립적으로 확장할 수 있다
2. **장애 격리**: istiod가 다운되어도 Envoy는 마지막으로 받은 설정으로 계속 동작한다
3. **점진적 업그레이드**: Control Plane을 먼저 업그레이드하고, Data Plane을 점진적으로 업그레이드할 수 있다
4. **설정 일관성**: 중앙에서 정책을 정의하고 모든 프록시에 일관되게 배포한다

### 1.4 Service Mesh 생태계 비교

Istio 외에도 다양한 Service Mesh 구현체가 존재한다.

| 특성 | Istio | Linkerd | Cilium Service Mesh | Consul Connect |
|------|-------|---------|---------------------|----------------|
| 데이터 플레인 | Envoy | linkerd2-proxy (Rust) | eBPF + Envoy (선택) | Built-in / Envoy |
| CNCF 상태 | Graduated | Graduated | Graduated (Cilium) | - (HashiCorp) |
| 프로토콜 지원 | HTTP/1.1, HTTP/2, gRPC, TCP, WebSocket | HTTP/1.1, HTTP/2, gRPC, TCP | HTTP/1.1, HTTP/2, gRPC, TCP | HTTP, gRPC, TCP |
| mTLS | SPIFFE 기반 자동 | 자동 (on by default) | IPSec / WireGuard | 자동 |
| 리소스 오버헤드 | 높음 (Envoy 기반) | 낮음 (Rust 프록시) | 매우 낮음 (eBPF, 커널 레벨) | 중간 |
| Multi-cluster | 지원 | 지원 | Cluster Mesh | 지원 (WAN federation) |
| 학습 곡선 | 가파름 | 완만 | 중간 | 중간 |
| 기능 풍부함 | 매우 높음 | 중간 | 높음 (네트워크 + 보안 통합) | 높음 |

> 참고: tart-infra 프로젝트에서는 네트워크 레이어에 Cilium을 사용하고, 서비스 메시 레이어에 Istio를 사용한다. 두 기술은 보완 관계로 동작한다. Cilium은 L3/L4 네트워크 정책과 eBPF 기반 관찰성을 제공하고, Istio는 L7 트래픽 관리와 mTLS를 제공한다.

---

## 2. Istio 아키텍처 상세

### 2.1 Istio란?

- Kubernetes 위에서 동작하는 서비스 메시 플랫폼이다 (CNCF Graduated)
- 마이크로서비스 간 통신을 투명하게 관리한다
- mTLS(상호 TLS) 자동 암호화를 제공한다
- 트래픽 관리, 보안, 옵저버빌리티를 통합한다
- 애플리케이션 코드 변경 없이 네트워크 기능을 인프라 레이어에서 처리한다

### 2.2 핵심 개념

| 개념 | 설명 |
|------|------|
| Service Mesh | 마이크로서비스 간 통신을 인프라 레이어에서 관리하는 아키텍처이다 |
| Sidecar | 각 Pod에 주입되는 Envoy 프록시 컨테이너이다 |
| Control Plane | istiod - 설정 관리, 인증서 발급, 서비스 디스커버리를 담당하는 단일 바이너리이다 |
| Data Plane | Envoy 사이드카 프록시들의 집합으로, 실제 트래픽을 처리한다 |
| mTLS | 서비스 간 상호 TLS 인증으로, 암호화 + 인증을 동시에 수행한다 |
| VirtualService | 트래픽 라우팅 규칙(match, route, mirror, fault injection 등)을 정의한다 |
| DestinationRule | 서비스에 대한 트래픽 정책(subsets, trafficPolicy, connectionPool, outlierDetection)을 정의한다 |
| Gateway | 외부 트래픽의 진입점(Ingress) 또는 내부 트래픽의 출구(Egress)를 정의한다 |
| PeerAuthentication | 서비스 간 mTLS 모드(STRICT, PERMISSIVE, DISABLE)를 제어한다 |
| RequestAuthentication | JWT 기반 최종 사용자 인증 정책을 정의한다 |
| AuthorizationPolicy | 워크로드에 대한 접근 제어(ALLOW, DENY, CUSTOM) 정책을 정의한다 |
| ServiceEntry | 메시 외부 서비스(외부 API, DB 등)를 Istio 서비스 레지스트리에 등록한다 |

### 2.3 전체 아키텍처

Istio 1.5 이전에는 Pilot, Citadel, Galley가 별도의 프로세스로 실행되었다. 1.5 버전부터 이 모든 기능이 **istiod**라는 단일 바이너리로 통합되었다. 배포 복잡성이 크게 줄었고, 리소스 사용량도 감소했다.

```
┌──────────────────────────────────────────────────────────────┐
│                      Control Plane                           │
│  ┌────────────────────────────────────────────────────────┐  │
│  │                      istiod                            │  │
│  │                                                        │  │
│  │  ┌─────────────────┐  ┌──────────────┐  ┌──────────┐  │  │
│  │  │ Pilot (기능)     │  │ Citadel (기능)│  │Galley(기능)│  │  │
│  │  │ - xDS API 서빙   │  │ - CA 서버     │  │- 설정 검증 │  │  │
│  │  │ - 서비스 디스커버리│  │ - 인증서 발급  │  │- 변환/배포 │  │  │
│  │  │ - 트래픽 규칙 변환│  │ - 인증서 갱신  │  │           │  │  │
│  │  └─────────────────┘  └──────────────┘  └──────────┘  │  │
│  │              ▲ 단일 바이너리 (1.5+ 통합)                 │  │
│  └──────────────┼─────────────────────────────────────────┘  │
│                 │ xDS (gRPC)                                 │
│                 │ EDS, CDS, RDS, LDS, SDS                    │
│  ┌──────────────▼──────────────────────────────────────────┐ │
│  │                     Data Plane                          │ │
│  │                                                         │ │
│  │  ┌─────────────────┐        ┌─────────────────┐        │ │
│  │  │ Pod A            │        │ Pod B            │        │ │
│  │  │ ┌─────────────┐ │        │ ┌─────────────┐ │        │ │
│  │  │ │  App 컨테이너 │ │        │ │  App 컨테이너 │ │        │ │
│  │  │ └──────┬──────┘ │        │ └──────┬──────┘ │        │ │
│  │  │ ┌──────▼──────┐ │        │ ┌──────▼──────┐ │        │ │
│  │  │ │ Envoy Proxy │◄├────────┤►│ Envoy Proxy │ │        │ │
│  │  │ │ (sidecar)   │ │ mTLS   │ │ (sidecar)   │ │        │ │
│  │  │ └─────────────┘ │        │ └─────────────┘ │        │ │
│  │  │ ┌─────────────┐ │        │ ┌─────────────┐ │        │ │
│  │  │ │ istio-init  │ │        │ │ istio-init  │ │        │ │
│  │  │ │(init 컨테이너)│ │        │ │(init 컨테이너)│ │        │ │
│  │  │ └─────────────┘ │        │ └─────────────┘ │        │ │
│  │  └─────────────────┘        └─────────────────┘        │ │
│  └─────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

### 2.4 istiod 내부 구조

istiod는 다음 핵심 기능을 단일 프로세스에서 수행한다.

#### 2.4.1 xDS API 서빙 (구 Pilot 기능)

istiod는 Envoy의 xDS(discovery service) API를 통해 사이드카 프록시에 설정을 동적으로 전달한다. xDS는 Envoy가 설정을 동적으로 업데이트하기 위해 사용하는 gRPC 기반 프로토콜이다.

| xDS API | 역할 |
|---------|------|
| LDS (Listener Discovery Service) | Envoy가 수신할 리스너(포트, 프로토콜) 설정을 전달한다 |
| RDS (Route Discovery Service) | HTTP 라우팅 규칙(VirtualService에서 변환)을 전달한다 |
| CDS (Cluster Discovery Service) | 업스트림 클러스터(DestinationRule에서 변환) 설정을 전달한다 |
| EDS (Endpoint Discovery Service) | 각 클러스터의 실제 엔드포인트(Pod IP:Port) 목록을 전달한다 |
| SDS (Secret Discovery Service) | mTLS 인증서와 키를 안전하게 전달한다 (파일 마운트 대신 gRPC 사용) |

Istio 리소스(VirtualService, DestinationRule 등)를 작성하면 istiod가 이를 Envoy 설정으로 변환하여 xDS API를 통해 각 사이드카에 push한다.

**xDS 동작 흐름 상세:**

```
┌──────────────┐         ┌──────────────┐         ┌──────────────┐
│  사용자       │         │   istiod      │         │  Envoy       │
│              │         │              │         │  Sidecar     │
└──────┬───────┘         └──────┬───────┘         └──────┬───────┘
       │                        │                        │
       │ kubectl apply          │                        │
       │ VirtualService         │                        │
       ├───────────────────────►│                        │
       │                        │                        │
       │                        │ K8s API Watch로         │
       │                        │ 리소스 변경 감지         │
       │                        │                        │
       │                        │ Envoy 설정으로 변환      │
       │                        │ (RDS config 생성)       │
       │                        │                        │
       │                        │ xDS push (gRPC stream) │
       │                        ├───────────────────────►│
       │                        │                        │
       │                        │                        │ Envoy가 설정을
       │                        │                        │ hot reload
       │                        │                        │ (연결 끊김 없음)
       │                        │                        │
       │                        │         ACK/NACK       │
       │                        │◄───────────────────────┤
       │                        │                        │
```

**xDS API 간의 관계:**

```
LDS (어떤 포트에서 수신할 것인가?)
 │
 ├─► RDS (HTTP 요청을 어디로 라우팅할 것인가?)
 │    │
 │    └─► CDS (업스트림 클러스터는 무엇인가?)
 │         │
 │         └─► EDS (클러스터의 실제 엔드포인트는 어디인가?)
 │
 └─► SDS (TLS 인증서는 무엇인가?)
```

**Aggregated Discovery Service (ADS):**

Istio는 개별 xDS API를 각각 호출하는 대신 ADS(Aggregated Discovery Service)를 사용한다. ADS는 모든 xDS 업데이트를 단일 gRPC 스트림으로 전달하여 설정 간의 일관성을 보장한다. 예를 들어 CDS 업데이트가 EDS보다 먼저 도착하여 존재하지 않는 클러스터로 라우팅하는 문제를 방지한다.

#### 2.4.2 인증서 관리 (구 Citadel 기능)

- 내장 CA(Certificate Authority) 서버를 운영한다
- 각 워크로드에 **SPIFFE(Secure Production Identity Framework For Everyone)** ID를 부여한다
  - 형식: `spiffe://<trust-domain>/ns/<namespace>/sa/<service-account>`
  - 예: `spiffe://cluster.local/ns/demo/sa/my-app`
- X.509 인증서를 자동 발급하고, 기본 24시간 주기로 갱신(rotation)한다
- SDS API를 통해 인증서를 Envoy에 전달하므로, 파일 시스템에 인증서를 저장하지 않는다

**인증서 발급 흐름 상세:**

```
┌──────────────┐         ┌──────────────┐         ┌──────────────┐
│  Envoy       │         │   istiod      │         │  K8s API     │
│  Sidecar     │         │   (CA)       │         │  Server      │
└──────┬───────┘         └──────┬───────┘         └──────┬───────┘
       │                        │                        │
       │ 1. CSR 전송             │                        │
       │ (Certificate Signing   │                        │
       │  Request)              │                        │
       ├───────────────────────►│                        │
       │                        │                        │
       │                        │ 2. Pod의 Service Account│
       │                        │    검증 (TokenReview)   │
       │                        ├───────────────────────►│
       │                        │                        │
       │                        │ 3. 검증 결과 반환        │
       │                        │◄───────────────────────┤
       │                        │                        │
       │                        │ 4. SPIFFE ID 결정       │
       │                        │ spiffe://cluster.local  │
       │                        │ /ns/demo/sa/httpbin     │
       │                        │                        │
       │ 5. 서명된 X.509 인증서   │                        │
       │    반환 (SDS)           │                        │
       │◄───────────────────────┤                        │
       │                        │                        │
       │ 6. 인증서로 mTLS 수행    │                        │
       │                        │                        │
       │ 7. 만료 전 자동 갱신     │                        │
       │    (기본 24시간 주기)    │                        │
       ├───────────────────────►│                        │
```

**외부 CA 통합:**

istiod의 내장 CA 대신 외부 CA를 사용할 수 있다.

| CA 통합 방식 | 설명 |
|-------------|------|
| Istio CA (기본) | istiod가 자체 CA를 운영한다. 자체 서명 루트 인증서 또는 제공된 루트 인증서를 사용한다 |
| cert-manager 통합 | cert-manager가 인증서를 발급하고 istiod가 이를 사용한다 |
| Vault 통합 | HashiCorp Vault를 CA로 사용한다 |
| Custom CA | 외부 CA를 Kubernetes CSR API를 통해 통합한다 |

#### 2.4.3 설정 검증 및 배포 (구 Galley 기능)

- Kubernetes API Server를 watching하여 Istio 리소스 변경을 감지한다
- 설정의 유효성을 검증한다 (ValidatingWebhookConfiguration)
- 검증된 설정을 Envoy가 이해할 수 있는 형태로 변환한다

**설정 변환 과정:**

```
kubectl apply VirtualService    →  Kubernetes API Server에 저장
                                          │
                                          ▼
istiod watches (Informer)       →  VirtualService 변경 감지
                                          │
                                          ▼
Validation                      →  스키마 검증, 충돌 탐지
                                          │
                                          ▼
Translation                     →  Envoy RouteConfiguration으로 변환
                                          │
                                          ▼
xDS Push                        →  gRPC 스트림으로 Envoy에 전달
                                          │
                                          ▼
Envoy Hot Reload                →  연결 끊김 없이 설정 적용
```

**istiod가 감시하는 Kubernetes 리소스:**

| 리소스 유형 | 용도 |
|------------|------|
| Service | 서비스 디스커버리, 클러스터 이름 결정 |
| Endpoints / EndpointSlice | Pod IP:Port 목록 (EDS) |
| Pod | 사이드카 주입 여부, 레이블, Service Account |
| Namespace | istio-injection 레이블, Ambient 모드 레이블 |
| VirtualService | HTTP/TCP 라우팅 규칙 → RDS 변환 |
| DestinationRule | 트래픽 정책 → CDS 변환 |
| Gateway | Ingress/Egress 설정 → LDS 변환 |
| ServiceEntry | 외부 서비스 등록 → CDS/EDS 변환 |
| PeerAuthentication | mTLS 정책 → SDS/필터 체인 변환 |
| RequestAuthentication | JWT 검증 → JWT authn 필터 변환 |
| AuthorizationPolicy | 접근 제어 → RBAC 필터 변환 |
| EnvoyFilter | 저수준 Envoy 설정 패치 |
| Sidecar | 사이드카 스코프 제한 |
| Telemetry | 텔레메트리 설정 |
| WasmPlugin | Wasm 확장 설정 |

#### 2.4.4 서비스 디스커버리

- Kubernetes의 Service, Endpoint 리소스를 watching한다
- ServiceEntry를 통해 등록된 외부 서비스도 서비스 레지스트리에 포함한다
- EDS를 통해 각 사이드카에 최신 엔드포인트 정보를 전달한다

**서비스 레지스트리 구성:**

```
┌─────────────────────────────────────────────┐
│           istiod 서비스 레지스트리             │
│                                              │
│  ┌──────────────────────────────────────┐    │
│  │  Kubernetes Services                  │    │
│  │  - nginx-web.demo.svc.cluster.local  │    │
│  │  - httpbin.demo.svc.cluster.local    │    │
│  │  - redis.demo.svc.cluster.local      │    │
│  │  - postgres.demo.svc.cluster.local   │    │
│  │  - rabbitmq.demo.svc.cluster.local   │    │
│  │  - keycloak.demo.svc.cluster.local   │    │
│  └──────────────────────────────────────┘    │
│                                              │
│  ┌──────────────────────────────────────┐    │
│  │  ServiceEntry (외부 서비스)            │    │
│  │  - api.external.com                  │    │
│  │  - external-db.example.com           │    │
│  └──────────────────────────────────────┘    │
│                                              │
│  ┌──────────────────────────────────────┐    │
│  │  Multi-cluster Services (선택)        │    │
│  │  - remote-cluster 서비스 목록         │    │
│  └──────────────────────────────────────┘    │
└─────────────────────────────────────────────┘
```

### 2.5 Sidecar 주입 메커니즘

Istio는 **Mutating Admission Webhook**을 사용하여 사이드카를 자동 주입한다.

**동작 흐름:**
1. 네임스페이스에 `istio-injection=enabled` 레이블이 있거나, Pod에 `sidecar.istio.io/inject: "true"` 어노테이션이 있다
2. Pod 생성 요청이 Kubernetes API Server에 도달한다
3. API Server가 Mutating Webhook을 호출하여 istiod의 injection endpoint로 요청을 전달한다
4. istiod가 Pod spec을 수정하여 두 가지 컨테이너를 추가한다:
   - **istio-init** (init container): `iptables` 규칙을 설정하여 모든 inbound/outbound 트래픽을 Envoy로 리다이렉트한다
   - **istio-proxy** (sidecar container): Envoy 프록시가 실행된다
5. 수정된 Pod spec이 API Server에 반환되고, 스케줄러가 Pod를 배치한다

**istio-init가 설정하는 iptables 규칙:**
```
# 모든 outbound 트래픽을 Envoy의 15001 포트로 리다이렉트
# 모든 inbound 트래픽을 Envoy의 15006 포트로 리다이렉트
# 15090(Prometheus metrics), 15021(health check) 등은 제외
```

**iptables 규칙 상세:**

```
# PREROUTING 체인 (inbound 트래픽)
-A PREROUTING -p tcp -j ISTIO_INBOUND

# ISTIO_INBOUND 체인
-A ISTIO_INBOUND -p tcp --dport 15008 -j RETURN    # HBONE 터널
-A ISTIO_INBOUND -p tcp --dport 15090 -j RETURN    # Prometheus
-A ISTIO_INBOUND -p tcp --dport 15021 -j RETURN    # Health check
-A ISTIO_INBOUND -p tcp --dport 15020 -j RETURN    # Stats
-A ISTIO_INBOUND -p tcp -j ISTIO_IN_REDIRECT

# ISTIO_IN_REDIRECT 체인
-A ISTIO_IN_REDIRECT -p tcp -j REDIRECT --to-ports 15006

# OUTPUT 체인 (outbound 트래픽)
-A OUTPUT -p tcp -j ISTIO_OUTPUT

# ISTIO_OUTPUT 체인
-A ISTIO_OUTPUT -s 127.0.0.6/32 -o lo -j RETURN
-A ISTIO_OUTPUT ! -d 127.0.0.1/32 -o lo -m owner --uid-owner 1337 -j ISTIO_IN_REDIRECT
-A ISTIO_OUTPUT -o lo -m owner ! --uid-owner 1337 -j RETURN
-A ISTIO_OUTPUT -m owner --uid-owner 1337 -j RETURN
-A ISTIO_OUTPUT -d 127.0.0.1/32 -j RETURN
-A ISTIO_OUTPUT -j ISTIO_REDIRECT

# ISTIO_REDIRECT 체인
-A ISTIO_REDIRECT -p tcp -j REDIRECT --to-ports 15001
```

> 참고: Istio 1.7+에서는 istio-init 대신 `istio-cni` CNI 플러그인을 사용하여 iptables 설정을 수행할 수도 있다. 이 방식은 init container에 `NET_ADMIN` 권한을 부여할 필요가 없어 보안상 유리하다.

**주입 제어 어노테이션:**

| 어노테이션 | 값 | 설명 |
|-----------|-----|------|
| `sidecar.istio.io/inject` | `"true"` / `"false"` | Pod 단위로 주입 여부를 제어한다 |
| `sidecar.istio.io/proxyImage` | 이미지 경로 | 사용할 Envoy 이미지를 지정한다 |
| `sidecar.istio.io/proxyCPU` | CPU 값 | 사이드카 CPU 요청량을 지정한다 |
| `sidecar.istio.io/proxyMemory` | 메모리 값 | 사이드카 메모리 요청량을 지정한다 |
| `sidecar.istio.io/proxyCPULimit` | CPU 값 | 사이드카 CPU 제한량을 지정한다 |
| `sidecar.istio.io/proxyMemoryLimit` | 메모리 값 | 사이드카 메모리 제한량을 지정한다 |
| `traffic.sidecar.istio.io/excludeInboundPorts` | 포트 목록 | 사이드카를 거치지 않을 inbound 포트를 지정한다 |
| `traffic.sidecar.istio.io/excludeOutboundPorts` | 포트 목록 | 사이드카를 거치지 않을 outbound 포트를 지정한다 |
| `traffic.sidecar.istio.io/excludeOutboundIPRanges` | CIDR 목록 | 사이드카를 거치지 않을 outbound IP 범위를 지정한다 |

### 2.6 Envoy Proxy 상세

Envoy는 Istio의 Data Plane을 구성하는 고성능 L4/L7 프록시이다. C++로 작성되었으며 CNCF Graduated 프로젝트이다.

**Envoy가 Istio에서 수행하는 역할:**

| 기능 | 설명 |
|------|------|
| 트래픽 라우팅 | VirtualService에 정의된 규칙에 따라 요청을 라우팅한다 |
| 로드밸런싱 | Round Robin, Least Request, Random, Ring Hash 등을 지원한다 |
| mTLS 핸드셰이크 | SDS에서 받은 인증서로 TLS 핸드셰이크를 수행한다 |
| 헬스 체크 | active/passive 헬스 체크를 수행한다 |
| 서킷 브레이커 | outlier detection 기반으로 비정상 엔드포인트를 제외한다 |
| 재시도 / 타임아웃 | 설정에 따라 실패한 요청을 재시도하고 타임아웃을 적용한다 |
| 메트릭 생성 | Prometheus 형식의 메트릭을 15090 포트에서 노출한다 |
| 분산 트레이싱 | 각 요청에 trace span을 자동 생성한다 |
| 접근 로그 | 설정에 따라 접근 로그를 stdout 또는 파일로 기록한다 |
| Fault Injection | 설정에 따라 지연이나 오류를 인위적으로 주입한다 |
| Rate Limiting | local/global rate limiting을 지원한다 |

**Envoy의 주요 포트:**

| 포트 | 용도 |
|------|------|
| 15000 | Envoy admin interface (debug용) |
| 15001 | Outbound 트래픽 수신 (모든 outbound가 여기로 리다이렉트) |
| 15006 | Inbound 트래픽 수신 (모든 inbound가 여기로 리다이렉트) |
| 15008 | HBONE mTLS 터널 포트 (Ambient 모드) |
| 15020 | 통합된 Prometheus 텔레메트리 (merged stats) |
| 15021 | Health check 엔드포인트 |
| 15090 | Envoy Prometheus 메트릭 |

**Envoy 필터 체인:**

Envoy는 요청을 처리할 때 필터 체인(filter chain)을 통과시킨다. Istio는 다음과 같은 필터를 자동으로 구성한다.

```
Inbound 요청 →
  ┌─────────────────────┐
  │ TLS Inspector        │  ← 프로토콜 감지
  ├─────────────────────┤
  │ HTTP Connection Mgr  │  ← HTTP/1.1, HTTP/2 처리
  │  ├ CORS Filter       │  ← CORS 정책
  │  ├ JWT Authn Filter  │  ← JWT 검증
  │  ├ RBAC Filter       │  ← AuthorizationPolicy
  │  ├ Stats Filter      │  ← 메트릭 생성
  │  ├ Router Filter     │  ← 라우팅 결정
  │  └ Access Log        │  ← 접근 로그
  └─────────────────────┘
→ 업스트림 (앱 컨테이너)
```

---

