# Istio - 서비스 메시

## 개념

### Istio란?
- Kubernetes 위에서 동작하는 서비스 메시 플랫폼이다 (CNCF Graduated)
- 마이크로서비스 간 통신을 투명하게 관리한다
- mTLS(상호 TLS) 자동 암호화를 제공한다
- 트래픽 관리, 보안, 옵저버빌리티를 통합한다
- 애플리케이션 코드 변경 없이 네트워크 기능을 인프라 레이어에서 처리한다

### 핵심 개념
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

### 아키텍처

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

### istiod 내부 구조

istiod는 다음 핵심 기능을 단일 프로세스에서 수행한다.

**1. xDS API 서빙 (구 Pilot 기능)**

istiod는 Envoy의 xDS(discovery service) API를 통해 사이드카 프록시에 설정을 동적으로 전달한다.

| xDS API | 역할 |
|---------|------|
| LDS (Listener Discovery Service) | Envoy가 수신할 리스너(포트, 프로토콜) 설정을 전달한다 |
| RDS (Route Discovery Service) | HTTP 라우팅 규칙(VirtualService에서 변환)을 전달한다 |
| CDS (Cluster Discovery Service) | 업스트림 클러스터(DestinationRule에서 변환) 설정을 전달한다 |
| EDS (Endpoint Discovery Service) | 각 클러스터의 실제 엔드포인트(Pod IP:Port) 목록을 전달한다 |
| SDS (Secret Discovery Service) | mTLS 인증서와 키를 안전하게 전달한다 (파일 마운트 대신 gRPC 사용) |

Istio 리소스(VirtualService, DestinationRule 등)를 작성하면 istiod가 이를 Envoy 설정으로 변환하여 xDS API를 통해 각 사이드카에 push한다.

**2. 인증서 관리 (구 Citadel 기능)**

- 내장 CA(Certificate Authority) 서버를 운영한다
- 각 워크로드에 **SPIFFE(Secure Production Identity Framework For Everyone)** ID를 부여한다
  - 형식: `spiffe://<trust-domain>/ns/<namespace>/sa/<service-account>`
  - 예: `spiffe://cluster.local/ns/demo/sa/my-app`
- X.509 인증서를 자동 발급하고, 기본 24시간 주기로 갱신(rotation)한다
- SDS API를 통해 인증서를 Envoy에 전달하므로, 파일 시스템에 인증서를 저장하지 않는다

**3. 설정 검증 및 배포 (구 Galley 기능)**

- Kubernetes API Server를 watching하여 Istio 리소스 변경을 감지한다
- 설정의 유효성을 검증한다 (ValidatingWebhookConfiguration)
- 검증된 설정을 Envoy가 이해할 수 있는 형태로 변환한다

**4. 서비스 디스커버리**

- Kubernetes의 Service, Endpoint 리소스를 watching한다
- ServiceEntry를 통해 등록된 외부 서비스도 서비스 레지스트리에 포함한다
- EDS를 통해 각 사이드카에 최신 엔드포인트 정보를 전달한다

### Sidecar 주입 메커니즘

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

> 참고: Istio 1.7+에서는 istio-init 대신 `istio-cni` CNI 플러그인을 사용하여 iptables 설정을 수행할 수도 있다. 이 방식은 init container에 `NET_ADMIN` 권한을 부여할 필요가 없어 보안상 유리하다.

### mTLS 심층 분석

**인증서 라이프사이클:**
1. Envoy가 시작되면 SDS API를 통해 istiod에 인증서를 요청한다
2. istiod는 워크로드의 Kubernetes Service Account를 확인한다
3. SPIFFE ID가 포함된 X.509 인증서를 발급한다
4. 인증서는 기본 24시간 유효하며, 만료 전에 자동으로 갱신(rotation)된다
5. 갱신 시 Envoy의 연결이 끊기지 않는다 (hot reload)

**PeerAuthentication vs RequestAuthentication:**

| 구분 | PeerAuthentication | RequestAuthentication |
|------|-------------------|----------------------|
| 대상 | 서비스 간 통신 (transport layer) | 최종 사용자 인증 (application layer) |
| 인증 방식 | mTLS 인증서 | JWT 토큰 |
| 적용 범위 | 메시 전체, 네임스페이스, 워크로드 | 워크로드 |
| 모드 | STRICT, PERMISSIVE, DISABLE | - |
| 사용 예 | 서비스 간 통신을 반드시 mTLS로 강제 | 외부 사용자의 JWT 유효성 검증 |

**mTLS 모드:**

| 모드 | 동작 |
|------|------|
| PERMISSIVE (기본값) | mTLS와 평문(plaintext) 트래픽을 모두 허용한다. 메시 마이그레이션 시 유용하다 |
| STRICT | mTLS 트래픽만 허용한다. 평문 트래픽은 거부된다 |
| DISABLE | mTLS를 비활성화한다. 평문 트래픽만 허용한다 |

> 주의: PERMISSIVE에서 STRICT로 전환하기 전에 모든 클라이언트가 mTLS를 사용하고 있는지 확인해야 한다. 그렇지 않으면 트래픽이 차단된다.

### 트래픽 관리 리소스 심층 분석

**VirtualService**

VirtualService는 Envoy의 라우팅 규칙을 추상화한 것이다. 다음 기능을 제공한다:

| 필드 | 역할 |
|------|------|
| `hosts` | 이 규칙이 적용될 호스트 목록이다 |
| `http[].match` | URI, header, query parameter 등으로 요청을 매칭한다 |
| `http[].route` | 매칭된 요청을 어디로 보낼지 정의한다 (subset, weight 포함) |
| `http[].mirror` | 실제 트래픽의 복사본을 다른 서비스로 전송한다 (테스트용) |
| `http[].fault` | 인위적 지연(delay)이나 오류(abort)를 주입한다 |
| `http[].timeout` | 요청 타임아웃을 설정한다 |
| `http[].retries` | 재시도 정책을 정의한다 |
| `http[].corsPolicy` | CORS 정책을 설정한다 |

**DestinationRule**

DestinationRule은 VirtualService에서 라우팅된 트래픽이 도착할 때 적용되는 정책을 정의한다.

| 필드 | 역할 |
|------|------|
| `host` | 정책이 적용될 서비스 호스트이다 |
| `subsets` | 레이블 기반으로 서비스를 버전별 하위 집합으로 분류한다 |
| `trafficPolicy.loadBalancer` | 로드밸런싱 알고리즘(ROUND_ROBIN, LEAST_REQUEST, RANDOM 등)을 지정한다 |
| `trafficPolicy.connectionPool` | TCP/HTTP 연결 풀 설정(최대 연결 수, 요청 수 등)을 정의한다 |
| `trafficPolicy.outlierDetection` | 서킷 브레이커 설정(연속 에러 수, 제외 시간 등)을 정의한다 |
| `trafficPolicy.tls` | 업스트림 연결의 TLS 설정을 정의한다 |

**Gateway**

Gateway는 메시의 진입점(Ingress) 또는 출구(Egress)를 정의한다. Kubernetes Ingress보다 더 세밀한 제어가 가능하다.

```yaml
# Ingress Gateway 예제
apiVersion: networking.istio.io/v1beta1
kind: Gateway
metadata:
  name: my-gateway
  namespace: demo
spec:
  selector:
    istio: ingressgateway  # istio-ingressgateway Pod를 선택한다
  servers:
    - port:
        number: 443
        name: https
        protocol: HTTPS
      tls:
        mode: SIMPLE
        credentialName: my-tls-secret  # Kubernetes Secret 참조
      hosts:
        - "app.example.com"
    - port:
        number: 80
        name: http
        protocol: HTTP
      hosts:
        - "app.example.com"
      tls:
        httpsRedirect: true  # HTTP를 HTTPS로 리다이렉트
```

```yaml
# Egress Gateway 예제 - 외부 트래픽을 제어한다
apiVersion: networking.istio.io/v1beta1
kind: ServiceEntry
metadata:
  name: external-api
  namespace: demo
spec:
  hosts:
    - api.external.com
  ports:
    - number: 443
      name: https
      protocol: TLS
  resolution: DNS
  location: MESH_EXTERNAL
```

### Ambient Mesh (Sidecar-less 모드)

Istio 1.18+에서 도입된 Ambient Mesh는 사이드카 없이 서비스 메시 기능을 제공하는 새로운 데이터 플레인 모드이다.

**기존 Sidecar 모드의 한계:**
- 각 Pod마다 Envoy 사이드카가 추가되어 메모리/CPU 오버헤드가 발생한다
- 사이드카 주입을 위해 Pod 재시작이 필요하다
- Envoy 업그레이드 시 모든 Pod를 재시작해야 한다

**Ambient Mesh 아키텍처:**

```
┌─────────────────────────────────────────────────────┐
│                  Ambient Mesh                        │
│                                                      │
│  L4 처리 (보안)              L7 처리 (트래픽 관리)     │
│  ┌──────────────┐          ┌───────────────────┐     │
│  │   ztunnel    │          │ Waypoint Proxy    │     │
│  │ (per-node)   │────────►│ (per-namespace/    │     │
│  │ - mTLS 터널링 │          │  service account) │     │
│  │ - L4 인가     │          │ - L7 라우팅        │     │
│  │ - 텔레메트리  │          │ - L7 인가          │     │
│  └──────────────┘          │ - Fault injection  │     │
│                            └───────────────────┘     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐           │
│  │ Pod A    │  │ Pod B    │  │ Pod C    │           │
│  │ (앱만)    │  │ (앱만)    │  │ (앱만)    │           │
│  │ 사이드카  │  │ 사이드카  │  │ 사이드카  │           │
│  │ 없음     │  │ 없음     │  │ 없음     │           │
│  └──────────┘  └──────────┘  └──────────┘           │
└─────────────────────────────────────────────────────┘
```

| 컴포넌트 | 역할 |
|---------|------|
| **ztunnel** | 각 노드에 DaemonSet으로 배포된다. L4 수준의 mTLS 터널링, 텔레메트리, L4 인가 정책을 처리한다. Rust로 구현되어 경량이다 |
| **Waypoint Proxy** | L7 기능(HTTP 라우팅, fault injection, L7 인가 등)이 필요한 경우에만 네임스페이스 또는 서비스 어카운트 단위로 배포된다. Envoy 기반이다 |

**Ambient Mesh 활성화:**
```bash
# 네임스페이스를 ambient 모드로 전환
kubectl label namespace demo istio.io/dataplane-mode=ambient

# Waypoint Proxy 배포 (L7 기능이 필요한 경우)
istioctl waypoint apply -n demo --enroll-namespace
```

### 옵저버빌리티

Istio는 애플리케이션 코드 변경 없이 세 가지 옵저버빌리티 신호를 자동 생성한다.

**1. 메트릭 (Metrics)**

Envoy 사이드카가 자동으로 생성하는 주요 메트릭:
- `istio_requests_total` - 요청 수 (response_code, source, destination 등 레이블 포함)
- `istio_request_duration_milliseconds` - 요청 지연 시간
- `istio_request_bytes` / `istio_response_bytes` - 요청/응답 크기

Prometheus가 이 메트릭을 수집하고, Grafana 대시보드에서 시각화할 수 있다.

**2. 분산 트레이싱 (Distributed Tracing)**

Envoy는 각 요청에 대해 trace span을 자동 생성한다. 단, **trace context propagation**(추적 컨텍스트 전파)은 애플리케이션이 수행해야 한다.

애플리케이션이 전파해야 하는 헤더:
- `x-request-id`
- `x-b3-traceid`, `x-b3-spanid`, `x-b3-parentspanid`, `x-b3-sampled`, `x-b3-flags` (Zipkin B3)
- `traceparent`, `tracestate` (W3C Trace Context)

> 핵심: Envoy가 span을 자동 생성하지만, 서비스 A -> B -> C 호출 시 B 애플리케이션이 수신한 trace 헤더를 C로의 요청에 포함시켜야 전체 트레이스가 연결된다. 헤더를 전파하지 않으면 각 구간이 별도 트레이스로 기록된다.

Jaeger, Zipkin 등 백엔드와 통합하여 트레이스를 시각화할 수 있다.

**3. 접근 로그 (Access Logging)**

Envoy 접근 로그를 활성화하여 모든 요청의 상세 정보를 기록할 수 있다:
```yaml
apiVersion: telemetry.istio.io/v1alpha1
kind: Telemetry
metadata:
  name: mesh-default
  namespace: istio-system
spec:
  accessLogging:
    - providers:
        - name: envoy
```

---

### 이 프로젝트에서의 실습 환경

이 프로젝트에서 Istio는 dev 클러스터에만 설치된다 (platform, staging, prod에는 미설치). 카나리 배포, 서킷 브레이커, mTLS를 실습하는 용도이다.

- 설치 스크립트: `scripts/install/12-install-istio.sh`
- Helm values: `manifests/istio/istio-values.yaml`
- 네임스페이스: `istio-system` (컨트롤 플레인), `istio-ingress` (게이트웨이), `demo` (사이드카 주입)
- 정책 매니페스트: `manifests/istio/` 디렉토리
- 실습 대상 클러스터: dev (`kubeconfig/dev.yaml`)

```bash
# dev 클러스터에서 Istio 상태 확인
export KUBECONFIG=kubeconfig/dev.yaml
istioctl version
kubectl get pods -n istio-system
kubectl get vs,dr,gw -n demo
```

주요 Istio 리소스:
| 파일 | 내용 |
|------|------|
| `istio-gateway.yaml` | Ingress Gateway 및 라우팅 규칙 |
| `virtual-service.yaml` | Canary 배포 (80/20 분할, 헤더 기반 라우팅) |
| `destination-rule.yaml` | Circuit Breaker, Outlier Detection |
| `peer-authentication.yaml` | STRICT mTLS |
| `httpbin-v2.yaml` | Canary 테스트용 v2 배포 |

## 실습

### 실습 1: Istio 설치 및 확인
```bash
# Istio CLI 설치
brew install istioctl

# 설치 가능한 프로파일 확인
istioctl profile list
# default, demo, minimal, remote, empty, preview, ambient

# Istio 설치 (demo 프로파일 - 학습 환경용, 모든 기능 포함)
istioctl install --set profile=demo -y

# 설치 확인
kubectl get pods -n istio-system
istioctl version

# Sidecar 자동 주입 활성화
kubectl label namespace demo istio-injection=enabled

# 설치 검증 (설정 오류 탐지)
istioctl analyze -A
```

### 실습 2: Sidecar 주입 확인
```bash
# Sidecar 주입 전 Pod 확인 (READY 1/1)
kubectl get pods -n demo

# 네임스페이스에 istio-injection 레이블 확인
kubectl get ns demo --show-labels

# Pod를 재시작하면 Sidecar가 주입된다 (READY 2/2)
kubectl rollout restart deployment -n demo
kubectl get pods -n demo  # 2/2 확인

# Sidecar 구성 확인 - 모든 프록시의 동기화 상태를 확인한다
istioctl proxy-status

# 특정 Pod의 Envoy 설정 상세 확인
istioctl proxy-config listeners <pod-name> -n demo
istioctl proxy-config routes <pod-name> -n demo
istioctl proxy-config clusters <pod-name> -n demo
istioctl proxy-config endpoints <pod-name> -n demo
```

### 실습 3: mTLS 확인
```bash
# mTLS 모드 확인
kubectl get peerauthentication -A

# 특정 서비스의 mTLS 상태 확인
istioctl authn tls-check <pod-name> -n demo

# PERMISSIVE 모드 적용 (마이그레이션 단계 - mTLS와 평문 모두 허용)
kubectl apply -f - <<EOF
apiVersion: security.istio.io/v1beta1
kind: PeerAuthentication
metadata:
  name: default
  namespace: demo
spec:
  mtls:
    mode: PERMISSIVE
EOF

# STRICT mTLS 적용 (모든 트래픽이 mTLS를 사용해야 한다)
kubectl apply -f - <<EOF
apiVersion: security.istio.io/v1beta1
kind: PeerAuthentication
metadata:
  name: default
  namespace: demo
spec:
  mtls:
    mode: STRICT
EOF

# 특정 포트만 mTLS 제외 (예: 헬스체크 포트)
kubectl apply -f - <<EOF
apiVersion: security.istio.io/v1beta1
kind: PeerAuthentication
metadata:
  name: my-app-mtls
  namespace: demo
spec:
  selector:
    matchLabels:
      app: my-app
  mtls:
    mode: STRICT
  portLevelMtls:
    8080:
      mode: DISABLE
EOF
```

### 실습 4: Istio 대시보드 도구
```bash
# Kiali (서비스 메시 관리 대시보드)
istioctl dashboard kiali

# Jaeger (분산 트레이싱)
istioctl dashboard jaeger

# Grafana (메트릭 대시보드)
istioctl dashboard grafana

# Envoy 프록시 관리 대시보드
istioctl dashboard envoy <pod-name> -n demo

# Prometheus (메트릭 수집)
istioctl dashboard prometheus
```

---

## 예제

### 예제 1: 카나리 배포 (트래픽 분할)
```yaml
# canary-deployment.yaml
# v1에 90%, v2에 10% 트래픽을 보낸다
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: my-app
  namespace: demo
spec:
  hosts:
    - my-app
  http:
    - route:
        - destination:
            host: my-app
            subset: v1
          weight: 90
        - destination:
            host: my-app
            subset: v2
          weight: 10
---
apiVersion: networking.istio.io/v1beta1
kind: DestinationRule
metadata:
  name: my-app
  namespace: demo
spec:
  host: my-app
  subsets:
    - name: v1
      labels:
        version: v1
    - name: v2
      labels:
        version: v2
```

### 예제 2: 서킷 브레이커
```yaml
# circuit-breaker.yaml
# 연속 5xx 에러가 3번 발생하면 30초간 해당 인스턴스를 제외한다
apiVersion: networking.istio.io/v1beta1
kind: DestinationRule
metadata:
  name: my-app-circuit-breaker
  namespace: demo
spec:
  host: my-app
  trafficPolicy:
    connectionPool:
      tcp:
        maxConnections: 100
      http:
        h2UpgradePolicy: DEFAULT
        http1MaxPendingRequests: 100
        http2MaxRequests: 1000
        maxRequestsPerConnection: 10
    outlierDetection:
      consecutive5xxErrors: 3
      interval: 10s
      baseEjectionTime: 30s
      maxEjectionPercent: 50
```

### 예제 3: 타임아웃 및 재시도
```yaml
# timeout-retry.yaml
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: my-app
  namespace: demo
spec:
  hosts:
    - my-app
  http:
    - timeout: 3s
      retries:
        attempts: 3
        perTryTimeout: 1s
        retryOn: 5xx,reset,connect-failure
      route:
        - destination:
            host: my-app
```

### 예제 4: Fault Injection (장애 주입)

테스트 환경에서 서비스의 복원력(resilience)을 검증하기 위해 인위적으로 장애를 주입할 수 있다.

```yaml
# fault-injection-delay.yaml
# 전체 트래픽의 10%에 5초 지연을 주입한다
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: my-app
  namespace: demo
spec:
  hosts:
    - my-app
  http:
    - fault:
        delay:
          percentage:
            value: 10.0
          fixedDelay: 5s
      route:
        - destination:
            host: my-app
```

```yaml
# fault-injection-abort.yaml
# 전체 트래픽의 20%에 HTTP 503 에러를 반환한다
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: my-app
  namespace: demo
spec:
  hosts:
    - my-app
  http:
    - fault:
        abort:
          percentage:
            value: 20.0
          httpStatus: 503
      route:
        - destination:
            host: my-app
```

```yaml
# fault-injection-combined.yaml
# 지연과 에러를 동시에 주입한다
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: my-app
  namespace: demo
spec:
  hosts:
    - my-app
  http:
    - fault:
        delay:
          percentage:
            value: 50.0
          fixedDelay: 3s
        abort:
          percentage:
            value: 10.0
          httpStatus: 500
      route:
        - destination:
            host: my-app
```

### 예제 5: 트래픽 미러링 (Traffic Mirroring / Shadowing)

실 트래픽의 복사본을 다른 서비스로 전송하여 새 버전을 안전하게 테스트할 수 있다. 미러링된 요청의 응답은 클라이언트에게 반환되지 않는다.

```yaml
# traffic-mirroring.yaml
# v1으로 라우팅하면서, 트래픽을 v2로 미러링한다
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: my-app
  namespace: demo
spec:
  hosts:
    - my-app
  http:
    - route:
        - destination:
            host: my-app
            subset: v1
      mirror:
        host: my-app
        subset: v2
      mirrorPercentage:
        value: 100.0  # 100% 미러링 (비율 조절 가능)
---
apiVersion: networking.istio.io/v1beta1
kind: DestinationRule
metadata:
  name: my-app
  namespace: demo
spec:
  host: my-app
  subsets:
    - name: v1
      labels:
        version: v1
    - name: v2
      labels:
        version: v2
```

### 예제 6: 헤더 기반 라우팅
```yaml
# header-based-routing.yaml
# 특정 헤더 값에 따라 다른 버전으로 라우팅한다
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: my-app
  namespace: demo
spec:
  hosts:
    - my-app
  http:
    - match:
        - headers:
            x-user-type:
              exact: beta-tester
      route:
        - destination:
            host: my-app
            subset: v2
    - route:
        - destination:
            host: my-app
            subset: v1
```

### 예제 7: RequestAuthentication (JWT 검증)
```yaml
# jwt-auth.yaml
# JWT 토큰을 검증하고, 유효하지 않으면 요청을 거부한다
apiVersion: security.istio.io/v1beta1
kind: RequestAuthentication
metadata:
  name: jwt-auth
  namespace: demo
spec:
  selector:
    matchLabels:
      app: my-app
  jwtRules:
    - issuer: "https://accounts.google.com"
      jwksUri: "https://www.googleapis.com/oauth2/v3/certs"
---
# JWT가 없거나 유효하지 않은 요청을 거부한다
apiVersion: security.istio.io/v1beta1
kind: AuthorizationPolicy
metadata:
  name: require-jwt
  namespace: demo
spec:
  selector:
    matchLabels:
      app: my-app
  action: DENY
  rules:
    - from:
        - source:
            notRequestPrincipals: ["*"]
```

---

## 디버깅

### istioctl analyze

설정 오류를 자동으로 탐지하고 개선 방법을 제안한다.

```bash
# 전체 클러스터 분석
istioctl analyze -A

# 특정 네임스페이스 분석
istioctl analyze -n demo

# 파일 적용 전 사전 분석
istioctl analyze -n demo my-virtualservice.yaml
```

### istioctl proxy-config

각 Envoy 사이드카의 실제 설정을 확인한다.

```bash
# 리스너 설정 확인 (LDS)
istioctl proxy-config listeners <pod-name> -n demo

# 라우트 설정 확인 (RDS)
istioctl proxy-config routes <pod-name> -n demo

# 클러스터 설정 확인 (CDS)
istioctl proxy-config clusters <pod-name> -n demo

# 엔드포인트 설정 확인 (EDS)
istioctl proxy-config endpoints <pod-name> -n demo

# 시크릿(인증서) 확인 (SDS)
istioctl proxy-config secret <pod-name> -n demo

# JSON 형식으로 상세 출력
istioctl proxy-config routes <pod-name> -n demo -o json

# 특정 포트의 리스너만 필터링
istioctl proxy-config listeners <pod-name> -n demo --port 8080
```

### 자주 발생하는 문제와 해결법

| 증상 | 원인 | 해결 방법 |
|------|------|----------|
| Pod가 1/1로 실행된다 (사이드카 미주입) | 네임스페이스에 `istio-injection` 레이블이 없다 | `kubectl label ns <ns> istio-injection=enabled` 후 Pod 재시작 |
| `proxy-status`에서 STALE 표시 | Envoy가 istiod와의 xDS 연결이 끊겼다 | istiod Pod 상태 확인, 네트워크 정책 확인 |
| 503 에러 발생 | upstream 서비스를 찾을 수 없거나, 서킷 브레이커가 동작 중이다 | `istioctl proxy-config clusters` 확인, outlierDetection 설정 검토 |
| mTLS 연결 실패 | STRICT 모드에서 비메시 서비스가 접근을 시도한다 | PeerAuthentication을 PERMISSIVE로 변경하거나, 클라이언트에 사이드카 주입 |
| VirtualService가 동작하지 않는다 | hosts 필드가 실제 서비스 이름과 불일치한다 | `istioctl analyze`로 확인, hosts와 Kubernetes Service 이름 대조 |
| 트래픽이 의도한 subset으로 가지 않는다 | DestinationRule의 subset 레이블과 Pod 레이블이 불일치한다 | `kubectl get pods --show-labels`로 Pod 레이블 확인 |
| 높은 지연 시간 | 사이드카 리소스 부족 또는 연결 풀 설정 문제이다 | Envoy 리소스 limit 확인, connectionPool 튜닝 |

```bash
# Envoy 로그 레벨 조정 (디버깅 시 유용)
istioctl proxy-config log <pod-name> -n demo --level debug

# 기본 로그 레벨로 복원
istioctl proxy-config log <pod-name> -n demo --level info

# istiod 로그 확인
kubectl logs -n istio-system -l app=istiod -f

# Envoy 사이드카 로그 확인
kubectl logs <pod-name> -n demo -c istio-proxy -f
```

---

## 자가 점검
- [ ] 서비스 메시가 왜 필요한지 설명할 수 있는가?
- [ ] Sidecar 패턴의 동작 원리(Mutating Webhook, istio-init, iptables)를 설명할 수 있는가?
- [ ] istiod가 통합하는 세 가지 기능(Pilot, Citadel, Galley)과 xDS API를 설명할 수 있는가?
- [ ] mTLS가 무엇이고, SPIFFE ID 기반 인증서가 어떻게 발급/갱신되는지 설명할 수 있는가?
- [ ] PERMISSIVE와 STRICT mTLS 모드의 차이를 설명할 수 있는가?
- [ ] PeerAuthentication과 RequestAuthentication의 차이를 설명할 수 있는가?
- [ ] VirtualService와 DestinationRule의 역할을 각각 설명할 수 있는가?
- [ ] 카나리 배포를 Istio로 어떻게 구현하는지 설명할 수 있는가?
- [ ] 서킷 브레이커의 동작 원리를 설명할 수 있는가?
- [ ] Fault Injection과 Traffic Mirroring의 용도와 설정 방법을 설명할 수 있는가?
- [ ] Ambient Mesh(ztunnel, Waypoint Proxy)의 개념과 기존 사이드카 모드와의 차이를 설명할 수 있는가?
- [ ] 분산 트레이싱에서 trace context propagation이 왜 애플리케이션의 책임인지 설명할 수 있는가?
- [ ] `istioctl analyze`와 `istioctl proxy-config`를 사용하여 문제를 진단할 수 있는가?

---

## 참고문헌

- [Istio 공식 문서](https://istio.io/latest/docs/) - 아키텍처, 설치, 설정 가이드 전반
- [Istio GitHub 리포지토리](https://github.com/istio/istio) - 소스 코드, 이슈 트래커, 릴리스 노트
- [Istio Architecture](https://istio.io/latest/docs/ops/deployment/architecture/) - Control Plane과 Data Plane 구조 상세
- [Traffic Management](https://istio.io/latest/docs/concepts/traffic-management/) - VirtualService, DestinationRule, Gateway 개념
- [Security](https://istio.io/latest/docs/concepts/security/) - mTLS, 인증, 인가 아키텍처
- [Observability](https://istio.io/latest/docs/concepts/observability/) - 메트릭, 트레이싱, 접근 로그
- [Ambient Mesh](https://istio.io/latest/docs/ambient/) - Sidecar-less 모드 문서
- [istioctl Reference](https://istio.io/latest/docs/reference/commands/istioctl/) - CLI 명령어 레퍼런스
- [Envoy Proxy Documentation](https://www.envoyproxy.io/docs/envoy/latest/) - Istio가 사용하는 데이터 플레인 프록시 문서
- [SPIFFE Specification](https://spiffe.io/) - Istio가 채택한 워크로드 ID 프레임워크
