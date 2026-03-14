# 10. 서비스 메시 — Istio, mTLS, 카나리 배포

> **시리즈**: Apple Silicon 맥에서 구축하는 멀티 클러스터 Kubernetes 인프라
>
> **난이도**: 입문 — 인프라를 한 번도 다뤄보지 않은 사람도 읽을 수 있다

---

## 서비스 메시가 뭔가?

### 왜 서비스 메시가 필요한가

마이크로서비스 아키텍처에서는 서비스 수가 늘어날수록 서비스 간 통신의 복잡도가 급격히 증가한다. 서비스가 N개이면 가능한 통신 경로는 최대 N(N-1)개다. 6개 서비스만 해도 30개의 경로가 존재한다. 이 상황에서 두 가지 문제가 발생한다.

**통신 관측이 불가능하다.** 기본 쿠버네티스에서는 파드 간 네트워크 트래픽에 대한 메트릭, 트레이싱, 로그가 없다. 요청이 어디서 지연되는지, 어떤 경로에서 에러가 발생하는지 파악하려면 각 서비스에 개별적으로 로깅/메트릭 코드를 삽입해야 한다.

**통신 제어가 불가능하다.** 트래픽 비율 분할(카나리 배포), 장애 격리(서킷 브레이커), 자동 재시도, 타임아웃 같은 네트워크 수준의 제어를 하려면 각 서비스의 코드에 해당 로직을 직접 구현해야 한다. 서비스마다 다른 언어, 다른 프레임워크를 사용하면 이 로직을 일관되게 적용하는 것이 매우 어렵다.

서비스 메시는 이 두 문제를 **인프라 계층에서** 해결한다. 애플리케이션 코드를 수정하지 않고, 네트워크 프록시를 통해 모든 통신을 관측하고 제어한다.

**서비스 메시**는 파드 간 네트워크 통신을 인프라 레벨에서 제어·관측하는 전용 계층이다. 구체적으로 다음 기능을 애플리케이션 코드 변경 없이 제공한다.

- 모든 요청에 대한 **분산 트레이싱** 부여
- 파드 간 통신의 자동 **암호화 (mTLS)**
- 요청 실패 시 **자동 재시도** 정책 적용
- 특정 버전으로의 **트래픽 비율 분할** (카나리 배포)
- 반복 장애 발생 시 해당 인스턴스 **자동 격리** (서킷 브레이커)

---

## 서비스 메시가 필요한 이유

| 상황 | 서비스 메시 없을 때 | 서비스 메시 있을 때 |
|------|-------------------|-------------------|
| 파드 간 통신이 평문(plain text) | 네트워크를 도청하면 데이터가 그대로 보임 | 자동으로 mTLS 암호화 |
| 새 버전 배포 | 한 번에 전체 교체 (위험) | 1%씩 천천히 카나리 배포 가능 |
| 특정 서비스 장애 | 장애가 다른 서비스로 전파 (cascading failure) | 서킷 브레이커가 장애 격리 |
| 트래픽 분석 | 별도 로깅 코드를 각 서비스에 삽입해야 함 | 메시가 자동으로 모든 트래픽 기록 |

프로덕션 환경에서는 보안 감사, 장애 대응, 무중단 배포 모두 필수다.
서비스 메시가 이 세 가지를 동시에 해결한다.

---

## Istio란?

**Istio**는 가장 널리 쓰이는 서비스 메시 구현체다.
Google, IBM, Lyft가 만든 오픈소스 프로젝트이며 CNCF(Cloud Native Computing Foundation) 졸업 프로젝트이기도 하다.

### 왜 Istio인가

서비스 메시 구현체에는 Istio 외에도 Linkerd, Consul Connect 등이 있다. Istio를 선택한 이유는 세 가지다.

**mTLS가 자동화되어 있다.** Istio는 인증서 발급, 갱신, 교체를 자동으로 처리한다. 각 서비스에 TLS 설정 코드를 추가할 필요 없이 PeerAuthentication 한 줄로 전체 네임스페이스에 mTLS를 강제할 수 있다.

**L7 트래픽 관리가 가능하다.** VirtualService와 DestinationRule로 트래픽 비율 분할(카나리), 서킷 브레이커, 재시도, 타임아웃을 선언형으로 설정할 수 있다. 이 기능들은 Kubernetes 기본 Service에는 없다.

**L7 관측(Observability)을 제공한다.** 모든 요청의 응답 시간, 에러율, 처리량을 Envoy 프록시가 자동으로 수집한다. Prometheus, Grafana, Jaeger와 연동하면 서비스 간 트래픽 흐름을 시각화할 수 있다.

### 사이드카(Sidecar) 패턴

### 왜 사이드카 패턴인가

사이드카 패턴은 **애플리케이션 코드를 수정하지 않고** 네트워크 기능을 주입하는 방식이다. Envoy 프록시를 각 파드에 사이드카 컨테이너로 자동 주입하면, 파드의 모든 인바운드/아웃바운드 트래픽이 Envoy를 거치게 된다. 애플리케이션은 자신이 프록시를 거치는지 인식하지 못하므로, 기존 서비스 코드를 전혀 변경하지 않고 mTLS, 트래픽 분할, 서킷 브레이커를 적용할 수 있다. 이것은 Go, Python, Java 등 서로 다른 언어로 작성된 서비스에도 동일한 네트워크 정책을 일관되게 적용할 수 있다는 뜻이다.

Istio의 핵심 아이디어는 **사이드카 패턴**이다.
애플리케이션 컨테이너 **옆에** Envoy 프록시 컨테이너를 하나 자동으로 주입하는 방식이다. 하나의 파드 안에 앱 컨테이너와 프록시 컨테이너가 함께 존재하며, 모든 인바운드·아웃바운드 트래픽이 Envoy를 경유한다.

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

모든 트래픽은 Envoy를 통해 들어오고 나간다.
앱은 자신이 프록시를 거치는지조차 모른다 — 코드를 한 줄도 바꿀 필요가 없다.

### 우리 프로젝트의 Istio 설정

우리 프로젝트에서는 리소스가 제한된 Apple Silicon Mac 위에서 돌리기 때문에
Istio의 리소스를 신중하게 제한한다.

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

하나씩 살펴보자.

- **pilot**: Istio의 컨트롤 플레인 컴포넌트다. 어떤 파드에 어떤 라우팅 규칙, 정책을 적용할지 결정한다
- **autoscaleEnabled: false**: 맥 한 대에서 돌리니까 오토스케일링은 끈다
- **accessLogFile: /dev/stdout**: 모든 트래픽 로그를 표준 출력에 기록한다. `kubectl logs`로 확인할 수 있다
- **proxy.resources**: 각 사이드카 Envoy 프록시가 사용할 CPU/메모리 한도다. 50m CPU는 0.05코어 — 매우 작은 양이다

---

## mTLS란 무엇인가?

일반 TLS(HTTPS)는 **서버**만 인증서를 제시한다.
클라이언트는 서버의 신원을 확인하지만, 서버 입장에서 요청을 보낸 클라이언트가 누구인지는 검증하지 않는다.

**mTLS**(mutual TLS, 상호 TLS)는 **양쪽 모두** 인증서를 교환하여 상호 인증을 수행한다.

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

클러스터 내부라고 해서 안전한 것이 아니다. 현실에서는:

1. **같은 클러스터에 다른 팀의 서비스**도 돌아간다 — 의도치 않은 접근이 발생할 수 있다
2. **보안 감사에서 "파드 간 통신도 암호화해야 한다"**는 요구사항이 거의 항상 나온다
3. **공격자가 클러스터 내부에 침입**했을 때 평문 통신 도청을 방지한다

### PeerAuthentication STRICT 모드

우리 프로젝트에서는 demo 네임스페이스의 모든 파드 간 통신에 mTLS를 **강제**한다.

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

이 8줄이 전부다. 이 YAML을 적용하면:

- demo 네임스페이스의 **모든 파드가 mTLS 없이는 통신을 거부**한다
- Istio 사이드카가 없는 파드가 접근하면 **연결이 차단**된다
- 인증서 발급, 갱신, 교체 모두 **Istio가 자동으로** 처리한다

`mode` 옵션은 세 가지가 있다:

| 모드 | 동작 |
|------|------|
| `PERMISSIVE` | mTLS와 평문 모두 허용 (마이그레이션 기간에 사용) |
| `STRICT` | mTLS만 허용 (프로덕션 권장) |
| `DISABLE` | mTLS 비활성화 |

---

## 카나리 배포란?

### 왜 카나리 배포인가

새 버전을 전체 사용자에게 한 번에 배포(Big Bang Deployment)하면, 그 버전에 결함이 있을 경우 **전체 사용자가 동시에 영향을 받는다**. 롤백에도 시간이 걸리므로, 그 동안 서비스 장애가 지속된다. 카나리 배포는 전체 트래픽의 일부(예: 20%)에만 새 버전을 먼저 노출하여, 문제가 발생해도 영향 범위를 해당 비율로 제한한다. 에러율이나 응답 시간에 이상이 없으면 비율을 점진적으로 높이고, 문제가 발견되면 즉시 비율을 0%로 되돌린다. 전체 배포 전에 실제 트래픽으로 검증하므로 위험을 최소화할 수 있다.

**카나리 배포(Canary Deployment)**는 새 버전을 전체 트래픽의 일부에만 먼저 노출하여 안전성을 검증한 뒤, 점진적으로 비율을 높여가는 배포 전략이다.

### 우리 프로젝트의 카나리 배포

우리 프로젝트에서는 httpbin 서비스의 v1과 v2를 동시에 운영한다.

먼저, v2 버전의 Deployment를 만든다:

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

핵심은 **labels**다:
- 기존 v1에는 `version: v1`
- 새 v2에는 `version: v2`

둘 다 `app: httpbin` 라벨을 가지고 있어서 같은 Service로 묶이지만,
Istio의 VirtualService가 **버전별로 트래픽을 나눠 보낸다**.

---

## VirtualService — 트래픽 분할

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

이 설정이 하는 일을 한 줄씩 살펴보자.

**첫 번째 규칙** (match 블록):
- HTTP 헤더에 `x-canary: true`가 있으면 → 무조건 v2로 보낸다
- 개발자가 테스트할 때 이 헤더를 넣어서 v2를 직접 확인할 수 있다

**두 번째 규칙** (기본 라우팅):
- 일반 트래픽의 **80%는 v1**으로, **20%는 v2**로 보낸다
- v2에 문제가 있으면 80%의 사용자는 영향을 받지 않는다

```
사용자 요청 100개
    │
    ├── 80개 → httpbin v1 (안정 버전)
    │
    └── 20개 → httpbin v2 (새 버전, 카나리)
```

### 실제 프로젝트에서는

실제 프로덕션에서의 카나리 배포 흐름:

1. v2 배포 → weight를 v1:99, v2:1로 시작
2. 에러율, 응답 시간 모니터링
3. 문제 없으면 v1:90, v2:10으로 올림
4. 계속 괜찮으면 v1:50, v2:50
5. 최종적으로 v1:0, v2:100으로 전환
6. v1 Deployment 삭제

이 과정을 자동화한 것이 **Argo Rollouts**나 **Flagger** 같은 도구다.

---

## 서킷 브레이커(Circuit Breaker)란?

### 왜 서킷 브레이커(Circuit Breaker)인가

마이크로서비스 환경에서 가장 위험한 장애 패턴은 **Cascading Failure(연쇄 장애)**이다. 하나의 서비스가 응답하지 않으면, 그 서비스를 호출하는 모든 서비스가 타임아웃 대기에 빠지고, 그 서비스들을 호출하는 또 다른 서비스들도 연쇄적으로 응답 불능 상태에 빠진다. 서킷 브레이커는 에러가 반복되는 서비스로의 요청을 일시적으로 차단하여, 장애가 다른 서비스로 전파되는 것을 방지한다. 장애가 발생한 서비스를 격리하고, 나머지 서비스는 정상적으로 동작하도록 보호하는 것이 핵심이다.

서킷 브레이커는 특정 서비스가 반복적으로 에러를 반환할 때, **해당 서비스로 가는 요청을 일시적으로 차단**하여 장애 전파를 방지하는 패턴이다.

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
4. A를 호출하는 서비스 C, D도 연쇄적으로 죽음 → **장애 전파(Cascading Failure)**

서킷 브레이커가 있으면:
1. B가 에러 3번 → 서킷 브레이커 작동
2. A는 B를 호출하지 않고 **즉시 에러를 반환** (0.001초)
3. A의 스레드가 묶이지 않아 **다른 기능은 정상 동작**
4. 30초 후 B가 복구되면 자동으로 다시 연결

---

## DestinationRule — 서킷 브레이커 설정

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

### 각 설정 항목 설명

**outlierDetection** (이상치 탐지 = 서킷 브레이커):

| 항목 | 값 | 의미 |
|------|-----|------|
| `consecutive5xxErrors` | 3 | 5xx 에러가 **연속 3번** 발생하면 |
| `interval` | 30s | **30초 간격**으로 상태를 체크하고 |
| `baseEjectionTime` | 30s | 문제 있는 인스턴스를 **30초간 제외** |
| `maxEjectionPercent` | 50 | 전체 인스턴스의 **최대 50%**만 제외 가능 |

`maxEjectionPercent: 50`이 중요하다.
이것이 없으면 모든 인스턴스가 제외되어 서비스 자체가 완전히 죽을 수 있다.
50%로 제한하면 최소한 절반은 항상 살아 있다.

**connectionPool** (연결 풀):

| 항목 | 값 | 의미 |
|------|-----|------|
| `maxConnections` | 100 | TCP 연결을 최대 100개로 제한 |
| `h2UpgradePolicy` | DO_NOT_UPGRADE | HTTP/2 업그레이드 비활성화 |

연결 수를 제한하는 이유: 한 서비스가 다른 서비스의 연결을 독점하는 것을 방지한다.

**subsets** (서브셋):
- v1, v2를 라벨로 구분한다
- VirtualService에서 `subset: v1`, `subset: v2`로 참조한다

---

## Istio Gateway — 외부 트래픽 진입점

클러스터 외부에서 들어오는 트래픽의 진입점도 Istio로 관리한다.

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

이 설정의 동작:

```
외부 요청
    │
    ├── /api/*  → httpbin (REST API 서비스)
    │
    └── 그 외   → nginx-web (웹 프론트엔드)
```

Gateway는 클러스터로 들어오는 모든 외부 트래픽의 단일 진입점이다.
URI 경로 기반으로 요청을 적절한 내부 서비스로 라우팅한다.

---

## 서비스 메시와 네트워크 정책은 어떻게 함께 동작하나?

이전 편에서 배운 Cilium 네트워크 정책과 Istio 서비스 메시는 **서로 다른 계층**에서 동작한다.

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

- **Cilium NetworkPolicy**는 L3/L4 수준에서 파드 간 통신 자체를 허용하거나 차단한다
- **Istio**는 L7 수준에서 허용된 트래픽의 라우팅, 인증, 관측을 담당한다

둘은 보완 관계다:
1. Cilium이 먼저 "이 트래픽이 이 파드에 접근할 수 있는가?"를 판단한다 (L3/L4)
2. 통과하면 Istio가 "이 트래픽을 어느 버전으로 보낼까? mTLS 인증서는 유효한가?"를 판단한다 (L7)

### 실제 프로젝트에서는

둘 다 사용하는 것이 **Defense in Depth**(심층 방어) 전략이다.

- NetworkPolicy만 있으면: 누가 접근하는지 세밀하게 제어하지만, 트래픽 관리(카나리, 서킷 브레이커)가 없다
- Istio만 있으면: 트래픽 관리는 되지만, 네트워크 레벨 차단이 없어서 Istio 사이드카를 우회하면 보안이 뚫린다

**둘 다 쓰면**: 네트워크 레벨에서 먼저 차단하고, 통과한 트래픽을 애플리케이션 레벨에서 다시 제어한다.

---

## 전체 그림: Istio가 우리 프로젝트에서 하는 일

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

---

## 핵심 정리

| 개념 | 한 줄 설명 | 우리 프로젝트 파일 |
|------|-----------|------------------|
| 서비스 메시 | 앱 코드 변경 없이 네트워크를 제어하는 인프라 계층 | `manifests/istio/` |
| Istio | 가장 널리 쓰이는 서비스 메시 구현체 | `istio-values.yaml` |
| 사이드카 패턴 | 각 파드에 Envoy 프록시를 자동 주입 | 자동 적용 |
| mTLS | 파드 간 상호 인증 + 암호화 | `peer-authentication.yaml` |
| 카나리 배포 | 새 버전에 트래픽 일부만 보내 안전하게 배포 | `virtual-service.yaml` |
| 서킷 브레이커 | 에러 반복 시 해당 인스턴스를 일시 격리 | `destination-rule.yaml` |
| Gateway | 외부 트래픽의 진입점 | `istio-gateway.yaml` |

---

## 다음 편 예고

11편에서는 Istio 위에서 실제로 돌아가는 **데모 앱 아키텍처**를 살펴본다.
nginx, httpbin, Redis, PostgreSQL, RabbitMQ, Keycloak — 6개 서비스가 어떻게 연결되고,
왜 이런 구성을 선택했는지 알아본다.
