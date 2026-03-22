# Day 4: 고급 트래픽 패턴, Multi-cluster, Gateway API

> 이 문서에서는 고급 트래픽 패턴(카나리 배포, A/B 테스트, 트래픽 미러링, Fault Injection, Rate Limiting, Locality Load Balancing), Multi-cluster/Multi-network Mesh, 그리고 Istio Gateway API와 기존 Ingress Gateway 비교를 다룬다.

---

## 6. 고급 트래픽 패턴

### 6.1 카나리 배포 (Canary Deployment)

새 버전을 일부 트래픽에만 노출하여 안전하게 검증하는 배포 전략이다.

**tart-infra 프로젝트의 실제 카나리 설정:**

프로젝트에서는 httpbin 서비스에 대해 v1(80%)과 v2(20%)로 트래픽을 분할하고, `x-canary: "true"` 헤더가 있으면 v2로 직접 라우팅한다.

```yaml
# manifests/istio/virtual-service.yaml (실제 프로젝트 파일)
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

**점진적 카나리 롤아웃 전략:**

```
Phase 1: 1% → v2 (smoke test)
  weight: v1=99, v2=1
  기간: 10분, 에러율 < 0.1% 확인
      │
      ▼
Phase 2: 10% → v2
  weight: v1=90, v2=10
  기간: 30분, P99 지연 < 200ms 확인
      │
      ▼
Phase 3: 25% → v2
  weight: v1=75, v2=25
  기간: 1시간, 주요 SLI 확인
      │
      ▼
Phase 4: 50% → v2
  weight: v1=50, v2=50
  기간: 2시간, 전체 메트릭 모니터링
      │
      ▼
Phase 5: 100% → v2
  weight: v1=0, v2=100
  v1 Deployment 정리
```

### 6.2 Blue-Green 배포

두 개의 동일한 환경(Blue/Green)을 유지하면서 트래픽을 한 번에 전환하는 전략이다.

```yaml
# blue-green-virtualservice.yaml
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: httpbin-blue-green
  namespace: demo
spec:
  hosts:
    - httpbin
  http:
    # 현재 Green(v2)이 Active
    - route:
        - destination:
            host: httpbin
            subset: v2    # Green (active)
          weight: 100
        # Blue(v1)는 대기 중 (weight: 0으로 설정하거나 제거)
---
# 롤백 시: v1을 100%로 변경
# kubectl apply로 즉시 전환 가능
```

**Blue-Green vs Canary 비교:**

| 특성 | Blue-Green | Canary |
|------|-----------|--------|
| 트래픽 전환 | 한 번에 100% 전환 | 점진적 비율 증가 |
| 롤백 속도 | 즉시 (이전 버전이 대기 중) | 즉시 (weight 변경) |
| 리소스 사용 | 2배 (양쪽 환경 유지) | 최소 추가 리소스 |
| 위험도 | 높음 (100% 전환) | 낮음 (점진적) |
| 적합한 경우 | DB 스키마 변경 등 호환 불가 시 | 대부분의 배포 |

### 6.3 A/B 테스팅

사용자 속성에 따라 다른 버전을 제공하여 비즈니스 메트릭을 비교한다.

```yaml
# a-b-testing.yaml
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: httpbin-ab-test
  namespace: demo
spec:
  hosts:
    - httpbin
  http:
    # 조건 1: 특정 사용자 그룹 → v2
    - match:
        - headers:
            x-user-group:
              exact: "experiment"
      route:
        - destination:
            host: httpbin
            subset: v2

    # 조건 2: 특정 지역 사용자 → v2
    - match:
        - headers:
            x-region:
              regex: "kr-.*"
      route:
        - destination:
            host: httpbin
            subset: v2

    # 조건 3: 쿠키 기반 분기
    - match:
        - headers:
            cookie:
              regex: ".*ab_test=variant_b.*"
      route:
        - destination:
            host: httpbin
            subset: v2

    # 기본: v1
    - route:
        - destination:
            host: httpbin
            subset: v1
```

### 6.4 서킷 브레이커 (Circuit Breaker) 상세

서킷 브레이커는 비정상 엔드포인트를 일시적으로 제외하여 장애 전파를 방지한다.

**tart-infra 프로젝트의 실제 서킷 브레이커 설정:**

```yaml
# manifests/istio/destination-rule.yaml (실제 프로젝트 파일)
apiVersion: networking.istio.io/v1beta1
kind: DestinationRule
metadata:
  name: httpbin-destination
  namespace: demo
spec:
  host: httpbin
  trafficPolicy:
    outlierDetection:
      consecutive5xxErrors: 3         # 연속 5xx 에러 3회 발생 시
      interval: 30s                   # 30초마다 분석
      baseEjectionTime: 30s           # 30초간 제외
      maxEjectionPercent: 50          # 최대 50%까지 제외
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

**서킷 브레이커 동작 메커니즘:**

```
┌──────────────────────────────────────────────────────────────┐
│                    서킷 브레이커 상태 전이                      │
│                                                               │
│  ┌──────────┐     연속 에러 3회     ┌──────────┐              │
│  │  CLOSED  │ ──────────────────► │   OPEN   │              │
│  │ (정상)    │                     │ (차단)    │              │
│  │          │                     │          │              │
│  │ 모든 요청 │                     │ 요청을    │              │
│  │ 전달     │                     │ 즉시 거부  │              │
│  └──────────┘                     └────┬─────┘              │
│       ▲                                │                     │
│       │                                │ baseEjectionTime    │
│       │                                │ (30초) 경과          │
│       │                                ▼                     │
│       │      테스트 성공        ┌──────────┐                  │
│       │◄────────────────────── │HALF-OPEN │                  │
│       │                       │ (테스트)   │                  │
│       │                       │          │                  │
│  테스트 실패 →                  │ 일부 요청 │                  │
│  다시 OPEN으로                  │ 전달하여  │                  │
│                                │ 상태 확인 │                  │
│                                └──────────┘                  │
└──────────────────────────────────────────────────────────────┘
```

**Connection Pool과 Outlier Detection의 차이:**

| 메커니즘 | 트리거 | 동작 | 목적 |
|---------|--------|------|------|
| Connection Pool | 연결/요청 수 초과 | 초과 요청에 503 반환 | 과부하 방지 |
| Outlier Detection | 연속 에러 발생 | 해당 엔드포인트 제외 | 비정상 인스턴스 격리 |

### 6.5 재시도와 타임아웃

```yaml
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: httpbin-retry
  namespace: demo
spec:
  hosts:
    - httpbin
  http:
    - timeout: 10s                        # 전체 요청 타임아웃
      retries:
        attempts: 3                        # 최대 재시도 횟수
        perTryTimeout: 3s                  # 각 시도당 타임아웃
        retryOn: "5xx,reset,connect-failure,retriable-4xx,refused-stream"
        retryRemoteLocalities: true        # 다른 locality로 재시도
      route:
        - destination:
            host: httpbin
```

**retryOn 조건:**

| 조건 | 설명 |
|------|------|
| `5xx` | 업스트림이 5xx 응답을 반환하거나 응답하지 않을 때 |
| `gateway-error` | 502, 503, 504 응답 시 |
| `reset` | 업스트림이 연결을 리셋했을 때 |
| `connect-failure` | 업스트림에 연결할 수 없을 때 |
| `retriable-4xx` | 재시도 가능한 4xx 에러 (예: 409 Conflict) |
| `refused-stream` | 업스트림이 REFUSED_STREAM 에러를 반환했을 때 |
| `retriable-status-codes` | `retriableStatusCodes`에 지정된 코드 |
| `retriable-headers` | `retriableHeaders`에 지정된 헤더가 응답에 있을 때 |

**타임아웃 관계:**

```
전체 타임아웃 (timeout: 10s)
├── 시도 1 (perTryTimeout: 3s) → 실패
├── 시도 2 (perTryTimeout: 3s) → 실패
├── 시도 3 (perTryTimeout: 3s) → 성공/실패
└── 시도 4 불가능 (10s 초과)

주의: timeout >= attempts × perTryTimeout이어야 모든 재시도가 가능하다
```

### 6.6 Fault Injection (장애 주입)

테스트 환경에서 서비스의 복원력(resilience)을 검증하기 위해 인위적으로 장애를 주입할 수 있다.

```yaml
# 지연 주입 - 전체 트래픽의 10%에 5초 지연
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: httpbin-fault-delay
  namespace: demo
spec:
  hosts:
    - httpbin
  http:
    - fault:
        delay:
          percentage:
            value: 10.0
          fixedDelay: 5s
      route:
        - destination:
            host: httpbin
---
# 에러 주입 - 전체 트래픽의 20%에 HTTP 503 반환
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: httpbin-fault-abort
  namespace: demo
spec:
  hosts:
    - httpbin
  http:
    - fault:
        abort:
          percentage:
            value: 20.0
          httpStatus: 503
      route:
        - destination:
            host: httpbin
---
# 지연 + 에러 동시 주입
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: httpbin-fault-combined
  namespace: demo
spec:
  hosts:
    - httpbin
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
            host: httpbin
```

**Fault Injection 테스트 시나리오:**

| 시나리오 | 설정 | 검증 포인트 |
|---------|------|-----------|
| 타임아웃 테스트 | delay 주입 (앱 타임아웃보다 긴 지연) | 클라이언트가 적절히 타임아웃 처리하는지 |
| 서킷 브레이커 테스트 | abort 주입 (5xx 연속 발생) | 서킷 브레이커가 동작하는지 |
| 재시도 테스트 | abort 주입 (간헐적 5xx) | 재시도 설정이 제대로 동작하는지 |
| 카스케이드 장애 테스트 | 하위 서비스에 delay 주입 | 상위 서비스가 장애 전파 없이 처리하는지 |

### 6.7 트래픽 미러링 (Traffic Mirroring / Shadowing)

실 트래픽의 복사본을 다른 서비스로 전송하여 새 버전을 안전하게 테스트할 수 있다. 미러링된 요청의 응답은 클라이언트에게 반환되지 않는다.

```yaml
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: httpbin-mirror
  namespace: demo
spec:
  hosts:
    - httpbin
  http:
    - route:
        - destination:
            host: httpbin
            subset: v1
      mirror:
        host: httpbin
        subset: v2
      mirrorPercentage:
        value: 100.0              # 100% 미러링 (비율 조절 가능)
```

**미러링 동작 원리:**

```
클라이언트 요청
     │
     ▼
Envoy Sidecar
     │
     ├──── 원본 요청 ────► httpbin v1 ──► 응답 ──► 클라이언트
     │
     └──── 복사 요청 ────► httpbin v2 ──► 응답 ──► (폐기)
                                                  응답은 클라이언트에
                                                  반환되지 않는다
```

**미러링 시 주의사항:**
- 미러링된 요청의 Host 헤더에 `-shadow` 접미사가 추가된다 (예: `httpbin-shadow`)
- 미러링 대상 서비스의 부하가 증가한다
- 상태를 변경하는 요청(POST, PUT, DELETE)을 미러링하면 데이터 중복이 발생할 수 있다
- fire-and-forget 방식이므로 미러링 대상의 응답 지연이 원본 요청에 영향을 주지 않는다

### 6.8 Rate Limiting

Istio에서 Rate Limiting은 Local Rate Limiting과 Global Rate Limiting 두 가지 방식이 있다.

**Local Rate Limiting (EnvoyFilter 사용):**

```yaml
apiVersion: networking.istio.io/v1alpha3
kind: EnvoyFilter
metadata:
  name: local-rate-limit
  namespace: demo
spec:
  workloadSelector:
    labels:
      app: httpbin
  configPatches:
    - applyTo: HTTP_FILTER
      match:
        context: SIDECAR_INBOUND
        listener:
          filterChain:
            filter:
              name: envoy.filters.network.http_connection_manager
      patch:
        operation: INSERT_BEFORE
        value:
          name: envoy.filters.http.local_ratelimit
          typed_config:
            "@type": type.googleapis.com/udpa.type.v1.TypedStruct
            type_url: type.googleapis.com/envoy.extensions.filters.http.local_ratelimit.v3.LocalRateLimit
            value:
              stat_prefix: http_local_rate_limiter
              token_bucket:
                max_tokens: 100            # 최대 토큰 수
                tokens_per_fill: 100       # 채우기 당 토큰 수
                fill_interval: 60s         # 채우기 간격
              filter_enabled:
                runtime_key: local_rate_limit_enabled
                default_value:
                  numerator: 100
                  denominator: HUNDRED
              filter_enforced:
                runtime_key: local_rate_limit_enforced
                default_value:
                  numerator: 100
                  denominator: HUNDRED
              response_headers_to_add:
                - append_action: OVERWRITE_IF_EXISTS_OR_ADD
                  header:
                    key: x-local-rate-limit
                    value: "true"
```

---

## 7. Multi-cluster / Multi-network Mesh

### 7.1 Multi-cluster 토폴로지

Istio는 여러 Kubernetes 클러스터를 하나의 메시로 통합할 수 있다.

**배포 모델:**

| 모델 | 설명 | 사용 시나리오 |
|------|------|-------------|
| Primary-Remote | 하나의 클러스터에 istiod가 있고, 다른 클러스터의 프록시가 이를 참조한다 | 소규모 멀티 클러스터 |
| Primary-Primary | 각 클러스터에 독립적인 istiod가 있고, 서로 서비스 정보를 공유한다 | 대규모, 고가용성 |
| External Control Plane | 외부에 istiod를 배포하고 여러 클러스터가 이를 공유한다 | 관리형 서비스 메시 |

**네트워크 모델:**

| 모델 | 설명 |
|------|------|
| Single Network | 모든 클러스터가 같은 네트워크에 있어 Pod IP로 직접 통신한다 |
| Multi Network | 클러스터 간 네트워크가 분리되어 있어 East-West Gateway를 통해 통신한다 |

```
┌───────────────────────────────────────────────────────────────┐
│               Multi-cluster Multi-network Mesh                 │
│                                                                │
│  ┌──────────────────────┐      ┌──────────────────────┐       │
│  │  Cluster A (Primary)  │      │  Cluster B (Primary)  │       │
│  │                       │      │                       │       │
│  │  ┌─────────────────┐ │      │ ┌─────────────────┐  │       │
│  │  │     istiod       │ │◄────►│ │     istiod       │  │       │
│  │  │                  │ │ 서비스│ │                  │  │       │
│  │  └─────────────────┘ │ 정보  │ └─────────────────┘  │       │
│  │                       │ 교환  │                       │       │
│  │  ┌─────────────────┐ │      │ ┌─────────────────┐  │       │
│  │  │ East-West GW     │◄├──────┤►│ East-West GW     │  │       │
│  │  │ (cross-cluster   │ │ mTLS │ │ (cross-cluster   │  │       │
│  │  │  트래픽 터널)     │ │      │ │  트래픽 터널)     │  │       │
│  │  └─────────────────┘ │      │ └─────────────────┘  │       │
│  │                       │      │                       │       │
│  │  ┌─────┐ ┌─────┐    │      │ ┌─────┐ ┌─────┐     │       │
│  │  │SvcA │ │SvcB │    │      │ │SvcC │ │SvcD │     │       │
│  │  └─────┘ └─────┘    │      │ └─────┘ └─────┘     │       │
│  └──────────────────────┘      └──────────────────────┘       │
│                                                                │
│  SvcA → SvcC 호출:                                              │
│  SvcA Envoy → East-West GW A → East-West GW B → SvcC Envoy    │
│  전구간 mTLS 암호화                                              │
└───────────────────────────────────────────────────────────────┘
```

### 7.2 Multi-cluster 설정 개요

```bash
# 1. 두 클러스터에 Istio 설치 (같은 trust domain, 같은 root CA 사용)
# Cluster A
istioctl install --set profile=default \
  --set values.global.meshID=mesh1 \
  --set values.global.multiCluster.clusterName=cluster-a \
  --set values.global.network=network1

# Cluster B
istioctl install --set profile=default \
  --set values.global.meshID=mesh1 \
  --set values.global.multiCluster.clusterName=cluster-b \
  --set values.global.network=network2

# 2. East-West Gateway 설치 (multi-network일 때)
# 각 클러스터에 East-West Gateway를 설치한다

# 3. Remote Secret 교환
# Cluster A가 Cluster B의 API Server에 접근할 수 있도록 secret을 교환한다
istioctl create-remote-secret --context=cluster-b --name=cluster-b | \
  kubectl apply -f - --context=cluster-a

istioctl create-remote-secret --context=cluster-a --name=cluster-a | \
  kubectl apply -f - --context=cluster-b

# 4. 검증
# Cluster A에서 Cluster B의 서비스 엔드포인트가 보이는지 확인
istioctl proxy-config endpoints <pod> --context=cluster-a | grep cluster-b
```

### 7.3 Locality-Aware Load Balancing

Multi-cluster 환경에서 지역(locality)을 고려한 로드밸런싱을 설정할 수 있다.

```yaml
apiVersion: networking.istio.io/v1beta1
kind: DestinationRule
metadata:
  name: httpbin-locality
  namespace: demo
spec:
  host: httpbin
  trafficPolicy:
    # 같은 지역의 엔드포인트를 우선 사용한다
    loadBalancer:
      localityLbSetting:
        enabled: true
        # 장애 시 다른 지역으로 failover
        failover:
          - from: us-west/zone1
            to: us-west/zone2
          - from: us-west
            to: us-east
        # 또는 트래픽 분배 비율 지정
        # distribute:
        #   - from: us-west/zone1/*
        #     to:
        #       "us-west/zone1/*": 80
        #       "us-west/zone2/*": 20
    outlierDetection:
      consecutive5xxErrors: 3
      interval: 10s
      baseEjectionTime: 30s
```

---

## 8. Istio Gateway API vs Ingress Gateway

### 8.1 전통적 Istio Ingress Gateway

Istio 초기부터 사용하던 방식이다. `Gateway` + `VirtualService` 리소스를 조합한다.

```yaml
# 전통적 방식 (Istio API)
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

### 8.2 Kubernetes Gateway API

Kubernetes Gateway API는 Kubernetes SIG-Network에서 표준화한 새로운 인그레스 API이다. Istio 1.16+에서 지원하며, 기존 Ingress 리소스와 Istio Gateway 리소스의 한계를 해결한다.

```yaml
# Gateway API 방식 (Kubernetes 표준)
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: demo-gateway
  namespace: demo
  annotations:
    # Istio가 이 Gateway를 처리하도록 지정
    networking.istio.io/service-type: NodePort
spec:
  gatewayClassName: istio                  # Istio의 GatewayClass
  listeners:
    - name: http
      protocol: HTTP
      port: 80
      allowedRoutes:
        namespaces:
          from: Same                       # 같은 네임스페이스의 HTTPRoute만 허용
    - name: https
      protocol: HTTPS
      port: 443
      tls:
        mode: Terminate
        certificateRefs:
          - name: my-tls-secret
      allowedRoutes:
        namespaces:
          from: All                        # 모든 네임스페이스의 HTTPRoute 허용
---
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: httpbin-route
  namespace: demo
spec:
  parentRefs:
    - name: demo-gateway
      namespace: demo
  hostnames:
    - "httpbin.example.com"
  rules:
    - matches:
        - path:
            type: PathPrefix
            value: /api
      backendRefs:
        - name: httpbin
          port: 80
          weight: 80
        - name: httpbin-v2
          port: 80
          weight: 20
    - matches:
        - headers:
            - name: x-canary
              value: "true"
      backendRefs:
        - name: httpbin-v2
          port: 80
```

### 8.3 비교

| 특성 | Istio Gateway API | Kubernetes Gateway API |
|------|-------------------|----------------------|
| 표준 | Istio 전용 CRD | Kubernetes SIG-Network 표준 |
| 이식성 | Istio에 종속 | 여러 구현체(Istio, Envoy GW, Cilium 등) 지원 |
| RBAC 분리 | Gateway + VirtualService가 같은 네임스페이스 | Gateway(인프라팀)와 HTTPRoute(개발팀) 분리 가능 |
| 기능 | Istio 전체 기능 지원 | 핵심 기능 지원, Istio 확장을 통해 추가 기능 |
| 성숙도 | 매우 높음 | GA (안정화됨) |
| 권장 | 기존 설정 유지 | 새로운 프로젝트에서 권장 |

**Gateway API의 역할 분리 모델:**

```
인프라 관리자                     개발자
     │                              │
     ▼                              ▼
GatewayClass (클러스터 레벨)    HTTPRoute (네임스페이스 레벨)
  - 어떤 구현체를 사용할 것인가     - 어떤 경로를 어떤 서비스로 보낼 것인가
     │                              │
     ▼                              │
Gateway (네임스페이스 레벨)          │
  - 어떤 포트, 프로토콜, TLS를       │
    사용할 것인가                     │
  - 어떤 네임스페이스의 Route를       │
    허용할 것인가                     │
     │                              │
     └──────────────┬───────────────┘
                    ▼
              트래픽 라우팅
```

---

