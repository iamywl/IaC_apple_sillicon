# 10편: 서비스 메시 — Istio, mTLS, 카나리 배포

> **시리즈**: Apple Silicon Mac 한 대로 프로덕션급 멀티 클러스터 Kubernetes 구축하기
>
> **난이도**: 입문 — 인프라를 한 번도 다뤄보지 않은 분도 읽을 수 있습니다

---

## 서비스 메시가 뭔가요?

쿠버네티스 클러스터 안에는 수십, 수백 개의 파드(Pod)가 있고 이들은 서로 끊임없이 통신합니다.
문제는 **"누가 누구에게 어떤 요청을 보냈는지"** 기본 쿠버네티스만으로는 알기 어렵다는 것입니다.

### 비유: 우체국 시스템

일반 쿠버네티스 네트워크를 **동네 편지 배달**이라고 생각해 보세요.
편지를 보내면 상대방에게 도착은 하지만, 추적 번호도 없고, 중간에 누가 열어봤는지도 모르고, 배달이 실패하면 그냥 사라집니다.

**서비스 메시**는 이 동네 배달을 **등기우편 시스템**으로 업그레이드하는 것입니다.

- 모든 편지에 **추적 번호** (트레이싱)
- **봉투를 밀봉** (암호화, mTLS)
- 배달 실패 시 **자동 재시도** (재시도 정책)
- 특정 수신자에게 **배달 비율 조절** (트래픽 분할)
- 배달 사고가 반복되면 **해당 우체국 일시 폐쇄** (서킷 브레이커)

이 모든 기능을 애플리케이션 코드 한 줄 안 고치고 인프라 레벨에서 제공하는 것이 서비스 메시입니다.

---

## 왜 이게 필요한가?

| 상황 | 서비스 메시 없을 때 | 서비스 메시 있을 때 |
|------|-------------------|-------------------|
| 파드 간 통신이 평문(plain text) | 네트워크를 도청하면 데이터가 그대로 보임 | 자동으로 mTLS 암호화 |
| 새 버전 배포 | 한 번에 전체 교체 (위험) | 1%씩 천천히 카나리 배포 가능 |
| 특정 서비스 장애 | 장애가 다른 서비스로 전파 (cascading failure) | 서킷 브레이커가 장애 격리 |
| 트래픽 분석 | 별도 로깅 코드를 각 서비스에 삽입해야 함 | 메시가 자동으로 모든 트래픽 기록 |

프로덕션 환경에서는 보안 감사, 장애 대응, 무중단 배포 모두 필수입니다.
서비스 메시가 이 세 가지를 동시에 해결합니다.

---

## Istio란?

**Istio**는 가장 널리 쓰이는 서비스 메시 구현체입니다.
Google, IBM, Lyft가 만든 오픈소스 프로젝트이며 CNCF(Cloud Native Computing Foundation) 졸업 프로젝트이기도 합니다.

### 사이드카(Sidecar) 패턴

Istio의 핵심 아이디어는 **사이드카 패턴**입니다.

오토바이의 사이드카를 떠올려 보세요. 본체(오토바이)는 그대로인데 옆에 작은 좌석이 하나 붙어 있죠.
Istio도 마찬가지입니다. 여러분의 애플리케이션 컨테이너 **옆에** Envoy 프록시 컨테이너를 하나 자동으로 붙입니다.

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

모든 트래픽은 Envoy를 통해 들어오고 나갑니다.
앱은 자신이 프록시를 거치는지조차 모릅니다 — 코드를 한 줄도 바꿀 필요가 없습니다.

### 우리 프로젝트의 Istio 설정

우리 프로젝트에서는 리소스가 제한된 Apple Silicon Mac 위에서 돌리기 때문에
Istio의 리소스를 신중하게 제한합니다.

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

하나씩 살펴봅시다.

- **pilot**: Istio의 "두뇌" 역할을 하는 컴포넌트입니다. 어떤 파드에 어떤 규칙을 적용할지 결정합니다
- **autoscaleEnabled: false**: 맥 한 대에서 돌리니까 오토스케일링은 끕니다
- **accessLogFile: /dev/stdout**: 모든 트래픽 로그를 표준 출력에 기록합니다. `kubectl logs`로 볼 수 있습니다
- **proxy.resources**: 각 사이드카 Envoy 프록시가 사용할 CPU/메모리 한도입니다. 50m CPU는 0.05코어 — 매우 작은 양입니다

---

## mTLS란 무엇인가?

### 비유: 신분증 확인

일반 TLS(HTTPS)는 **서버**만 신분증을 보여줍니다.
웹 브라우저에서 자물쇠 아이콘이 보이면 "이 서버는 진짜 google.com이다"라고 확인하는 것이죠.
하지만 서버 입장에서 요청을 보낸 클라이언트가 누구인지는 모릅니다.

**mTLS**(mutual TLS, 상호 TLS)는 **양쪽 다** 신분증을 확인합니다.

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

### 왜 이게 필요한가?

"쿠버네티스 클러스터 안에 있으면 안전한 거 아닌가요?"라고 생각할 수 있습니다.
하지만 현실에서는:

1. **같은 클러스터에 다른 팀의 서비스**도 돌아갑니다 — 누가 제 서비스에 몰래 접근할 수 있습니다
2. **보안 감사에서 "파드 간 통신도 암호화해야 합니다"**라는 요구사항이 거의 항상 나옵니다
3. **공격자가 클러스터 내부에 침입**했을 때 평문 통신을 도청하는 것을 막습니다

### PeerAuthentication STRICT 모드

우리 프로젝트에서는 demo 네임스페이스의 모든 파드 간 통신에 mTLS를 **강제**합니다.

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

이 8줄이 전부입니다. 이 YAML을 적용하면:

- demo 네임스페이스의 **모든 파드가 mTLS 없이는 통신을 거부**합니다
- Istio 사이드카가 없는 파드가 접근하면 **연결이 차단**됩니다
- 인증서 발급, 갱신, 교체 모두 **Istio가 자동으로** 처리합니다

`mode` 옵션은 세 가지가 있습니다:

| 모드 | 동작 |
|------|------|
| `PERMISSIVE` | mTLS와 평문 모두 허용 (마이그레이션 기간에 사용) |
| `STRICT` | mTLS만 허용 (프로덕션 권장) |
| `DISABLE` | mTLS 비활성화 |

---

## 카나리 배포란?

### 비유: 신메뉴 시식 코너

치킨집에서 새로운 양념 소스를 개발했다고 합시다.
기존 소스를 한 번에 전부 바꾸면 손님들이 싫어할 수 있습니다.
그래서 **시식 코너**를 만들어 10명 중 2명에게만 새 소스를 줘보고, 반응이 좋으면 비율을 늘립니다.

이것이 **카나리 배포(Canary Deployment)**입니다.

이름의 유래: 과거 탄광에서 유독 가스를 감지하기 위해 카나리아 새를 먼저 보냈던 것에서 유래했습니다.
새 버전을 소수의 사용자에게 먼저 보내서 문제가 없는지 확인하는 것입니다.

### 우리 프로젝트의 카나리 배포

우리 프로젝트에서는 httpbin 서비스의 v1과 v2를 동시에 운영합니다.

먼저, v2 버전의 Deployment를 만듭니다:

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

핵심은 **labels**입니다:
- 기존 v1에는 `version: v1`
- 새 v2에는 `version: v2`

둘 다 `app: httpbin` 라벨을 가지고 있어서 같은 Service로 묶이지만,
Istio의 VirtualService가 **버전별로 트래픽을 나눠 보냅니다**.

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

이 설정이 하는 일을 한 줄씩 살펴봅시다.

**첫 번째 규칙** (match 블록):
- HTTP 헤더에 `x-canary: true`가 있으면 → 무조건 v2로 보냅니다
- 개발자가 테스트할 때 이 헤더를 넣어서 v2를 직접 확인할 수 있습니다

**두 번째 규칙** (기본 라우팅):
- 일반 트래픽의 **80%는 v1**으로, **20%는 v2**로 보냅니다
- v2에 문제가 있으면 80%의 사용자는 영향을 받지 않습니다

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

이 과정을 자동화한 것이 **Argo Rollouts**나 **Flagger** 같은 도구입니다.

---

## 서킷 브레이커(Circuit Breaker)란?

### 비유: 전기 차단기

집에서 전기를 너무 많이 쓰면 차단기(두꺼비집)가 내려가죠?
차단기가 없으면 과부하로 화재가 발생할 수 있습니다.
차단기는 **문제가 더 커지기 전에 회로를 끊어서** 전체 시스템을 보호합니다.

서비스 메시의 서킷 브레이커도 똑같습니다.
특정 서비스가 계속 에러를 내면, **그 서비스로 가는 요청을 일시적으로 차단**합니다.

```
정상 상태:         요청 → 서비스 A → 서비스 B (정상 응답)

에러 반복:         요청 → 서비스 A → 서비스 B (5xx 에러 3번 연속!)
                                         ↓
서킷 오픈:         요청 → 서비스 A ──X── 서비스 B (30초간 차단)
                              │
                              └── 즉시 에러 반환 (빠른 실패)

30초 후 재시도:    요청 → 서비스 A → 서비스 B (정상이면 서킷 닫힘)
```

### 왜 이게 필요한가?

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

`maxEjectionPercent: 50`이 중요합니다.
이것이 없으면 모든 인스턴스가 제외되어 서비스 자체가 완전히 죽을 수 있습니다.
50%로 제한하면 최소한 절반은 항상 살아 있습니다.

**connectionPool** (연결 풀):

| 항목 | 값 | 의미 |
|------|-----|------|
| `maxConnections` | 100 | TCP 연결을 최대 100개로 제한 |
| `h2UpgradePolicy` | DO_NOT_UPGRADE | HTTP/2 업그레이드 비활성화 |

연결 수를 제한하는 이유: 한 서비스가 다른 서비스의 연결을 독점하는 것을 방지합니다.

**subsets** (서브셋):
- v1, v2를 라벨로 구분합니다
- VirtualService에서 `subset: v1`, `subset: v2`로 참조합니다

---

## Istio Gateway — 외부 트래픽 진입점

클러스터 외부에서 들어오는 트래픽의 진입점도 Istio로 관리합니다.

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

Gateway는 **공항의 입국 심사대**와 같습니다.
모든 외부 트래픽은 이 심사대를 거치며, 목적지에 따라 알맞은 서비스로 안내됩니다.

---

## 서비스 메시와 네트워크 정책은 어떻게 함께 동작하나?

이전 편에서 배운 Cilium 네트워크 정책과 Istio 서비스 메시는 **서로 다른 계층**에서 동작합니다.

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

비유하면:
- **Cilium NetworkPolicy** = 건물 출입 카드 (이 사람이 이 건물에 들어갈 수 있나?)
- **Istio** = 건물 내부 안내 데스크 (어느 층, 어느 방으로 가야 하나? 신분증은 확인했나?)

둘은 보완 관계입니다:
1. Cilium이 먼저 "이 트래픽이 이 파드에 접근할 수 있는가?"를 판단합니다 (L3/L4)
2. 통과하면 Istio가 "이 트래픽을 어느 버전으로 보낼까? mTLS 인증서는 유효한가?"를 판단합니다 (L7)

### 실제 프로젝트에서는

둘 다 사용하는 것이 **Defense in Depth**(심층 방어) 전략입니다.

- NetworkPolicy만 있으면: 누가 접근하는지 세밀하게 제어하지만, 트래픽 관리(카나리, 서킷 브레이커)가 없습니다
- Istio만 있으면: 트래픽 관리는 되지만, 네트워크 레벨 차단이 없어서 Istio 사이드카를 우회하면 보안이 뚫립니다

**둘 다 쓰면**: 네트워크 레벨에서 먼저 차단하고, 통과한 트래픽을 애플리케이션 레벨에서 다시 제어합니다.

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

11편에서는 Istio 위에서 실제로 돌아가는 **데모 앱 아키텍처**를 살펴봅니다.
nginx, httpbin, Redis, PostgreSQL, RabbitMQ, Keycloak — 6개 서비스가 어떻게 연결되고,
왜 이런 구성을 선택했는지 알아봅니다.
