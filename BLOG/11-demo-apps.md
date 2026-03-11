# 11편: 데모 앱 구성 — 3-Tier + Auth + MQ 아키텍처

> **시리즈**: Apple Silicon Mac 한 대로 프로덕션급 멀티 클러스터 Kubernetes 구축하기
>
> **난이도**: 입문 — 인프라를 한 번도 다뤄보지 않은 분도 읽을 수 있습니다

---

## 왜 데모 앱이 필요한가?

쿠버네티스 클러스터를 구축했으면 그 위에서 **실제로 서비스를 돌려봐야** 의미가 있습니다.
네트워크 정책이 제대로 동작하는지, 서비스 메시가 트래픽을 잘 분배하는지,
HPA(오토스케일링)가 부하에 반응하는지 — 이 모든 것을 확인하려면 **실제와 비슷한 앱 구성**이 필요합니다.

단순히 nginx 하나만 띄우면 "쿠버네티스 돌아간다"는 확인할 수 있지만,
현실의 복잡한 서비스 간 통신, 데이터베이스 연동, 인증, 비동기 메시징 같은 것은 테스트할 수 없습니다.

그래서 우리 프로젝트에서는 **6개의 서비스**로 구성된 현실적인 데모 앱을 만들었습니다.

---

## 3-Tier 아키텍처란?

### 비유: 식당 운영

식당을 생각해 보세요:

1. **홀 (Web Tier)**: 손님과 직접 대면합니다. 메뉴를 받고, 음식을 가져다 줍니다
2. **주방 (App Tier)**: 실제 요리를 합니다. 홀에서 주문을 받으면 음식을 만듭니다
3. **식자재 창고 (Data Tier)**: 재료를 저장합니다. 주방에서 필요한 재료를 꺼내 씁니다

웹 애플리케이션도 이 세 개의 계층으로 나뉩니다:

```
┌─────────────────────────────────────────────┐
│             사용자 (브라우저)                  │
└─────────────────┬───────────────────────────┘
                  │
┌─────────────────▼───────────────────────────┐
│  1층. Web Tier (프레젠테이션 계층)             │
│  → nginx: 정적 파일 서빙, 리버스 프록시       │
└─────────────────┬───────────────────────────┘
                  │
┌─────────────────▼───────────────────────────┐
│  2층. App Tier (애플리케이션 계층)             │
│  → httpbin: 비즈니스 로직, API 처리           │
└────┬────────────┬───────────────┬───────────┘
     │            │               │
┌────▼────┐  ┌───▼────┐   ┌─────▼─────┐
│  Redis  │  │Postgres│   │ RabbitMQ  │
│ (캐시)  │  │ (DB)   │   │ (메시지큐) │
└─────────┘  └────────┘   └───────────┘
     3층. Data Tier (데이터 계층)
```

### 왜 이게 필요한가?

왜 하나의 프로그램에 다 넣지 않고 3개 층으로 나눌까요?

1. **독립적인 확장**: 사용자가 몰리면 Web Tier만 3개, 5개로 늘리면 됩니다. DB를 5개 복제할 필요는 없습니다
2. **독립적인 배포**: App 계층의 코드를 바꿔도 Web, DB는 재배포할 필요 없습니다
3. **장애 격리**: DB가 느려져도 Web 계층은 캐시된 데이터로 기본 응답을 줄 수 있습니다
4. **팀 분리**: 프론트엔드 팀, 백엔드 팀, DBA가 각자 담당 계층을 관리합니다

---

## 우리 프로젝트의 서비스 구성

6개의 서비스가 어떻게 연결되는지 전체 그림을 먼저 보겠습니다:

```
[사용자]
    │
    ├── :30080 (NodePort)
    ▼
┌──────────┐       ┌──────────┐
│  nginx   │──────►│ httpbin  │
│ (Web)    │       │ (App)    │
│ 3 replicas│      │ 2 replicas│
└──────────┘       └────┬─────┘
                        │
              ┌─────────┼─────────┐
              ▼         ▼         ▼
         ┌────────┐ ┌───────┐ ┌──────────┐
         │ redis  │ │postgres│ │ rabbitmq │
         │ (캐시) │ │ (DB)  │ │ (메시지큐)│
         └────────┘ └───┬───┘ └──────────┘
                        │
                        ▼
                   ┌──────────┐
[사용자] ──:30880──►│ keycloak │
                   │ (인증)   │
                   └──────────┘
```

이제 각 서비스를 하나씩 살펴봅시다.

---

## 1. nginx — Web Tier (리버스 프록시)

```yaml
# manifests/demo/nginx-app.yaml

apiVersion: apps/v1
kind: Deployment
metadata:
  name: nginx-web
  namespace: demo
  labels:
    app: nginx-web
spec:
  replicas: 3
  selector:
    matchLabels:
      app: nginx-web
  template:
    metadata:
      labels:
        app: nginx-web
    spec:
      containers:
        - name: nginx
          image: nginx:alpine
          ports:
            - containerPort: 80
          resources:
            requests:
              cpu: 50m
              memory: 64Mi
            limits:
              cpu: 200m
              memory: 128Mi
---
apiVersion: v1
kind: Service
metadata:
  name: nginx-web
  namespace: demo
spec:
  type: NodePort
  selector:
    app: nginx-web
  ports:
    - port: 80
      targetPort: 80
      nodePort: 30080
```

### 처음 보는 분을 위한 설명

이 YAML 파일 하나에 **두 개의 쿠버네티스 리소스**가 들어 있습니다 (`---`로 구분).

**Deployment** (배포 설정):
- `replicas: 3` — nginx 파드를 **3개** 동시에 실행합니다. 하나가 죽어도 나머지 2개가 요청을 처리합니다
- `image: nginx:alpine` — Docker Hub에서 nginx의 경량 버전(Alpine Linux 기반)을 가져옵니다
- `containerPort: 80` — 컨테이너 내부에서 80번 포트를 사용합니다

**Service** (서비스 = 네트워크 진입점):
- `type: NodePort` — 클러스터 외부에서 접근할 수 있게 노드의 포트를 엽니다
- `nodePort: 30080` — 노드의 **30080번 포트**로 접근하면 nginx로 연결됩니다
- `selector: app: nginx-web` — `app: nginx-web` 라벨이 붙은 파드들에게 트래픽을 보냅니다

### 비유: 호텔 프론트 데스크

nginx는 **호텔 프론트 데스크**입니다.
손님(사용자)이 오면 직접 응대하고, 실제 서비스가 필요하면 뒤쪽(httpbin)으로 안내합니다.
프론트 데스크는 3명이 교대 근무하니까 한 명이 쉬어도 다른 2명이 일합니다.

---

## 2. httpbin — App Tier (REST API)

```yaml
# manifests/demo/httpbin-app.yaml

apiVersion: apps/v1
kind: Deployment
metadata:
  name: httpbin
  namespace: demo
  labels:
    app: httpbin
spec:
  replicas: 2
  selector:
    matchLabels:
      app: httpbin
  template:
    metadata:
      labels:
        app: httpbin
        version: v1
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
---
apiVersion: v1
kind: Service
metadata:
  name: httpbin
  namespace: demo
spec:
  type: ClusterIP
  selector:
    app: httpbin
  ports:
    - port: 80
      targetPort: 80
```

### ClusterIP vs NodePort

여기서 Service 타입이 `ClusterIP`입니다. 두 타입의 차이:

| 타입 | 외부 접근 | 용도 |
|------|----------|------|
| `NodePort` | 가능 (노드IP:포트) | 사용자가 직접 접근하는 서비스 |
| `ClusterIP` | 불가능 (클러스터 내부만) | 내부 서비스 간 통신용 |

httpbin은 외부 사용자가 직접 접근할 필요가 없습니다.
nginx가 대신 접근해 주니까요. 그래서 `ClusterIP`를 사용합니다.

### version 라벨의 의미

`version: v1` 라벨에 주목하세요.
10편에서 배운 Istio 카나리 배포가 바로 이 라벨을 기준으로 트래픽을 분배합니다.
v2 Deployment에는 `version: v2`가 붙어 있고, VirtualService가 80:20 비율로 나눕니다.

---

## 3. Redis — 캐시 (인메모리 저장소)

```yaml
# manifests/demo/redis-app.yaml

apiVersion: apps/v1
kind: Deployment
metadata:
  name: redis
  namespace: demo
  labels:
    app: redis
spec:
  replicas: 1
  selector:
    matchLabels:
      app: redis
  template:
    metadata:
      labels:
        app: redis
    spec:
      containers:
        - name: redis
          image: redis:7-alpine
          ports:
            - containerPort: 6379
          resources:
            requests:
              cpu: 50m
              memory: 64Mi
            limits:
              cpu: 200m
              memory: 256Mi
---
apiVersion: v1
kind: Service
metadata:
  name: redis
  namespace: demo
spec:
  type: ClusterIP
  selector:
    app: redis
  ports:
    - port: 6379
      targetPort: 6379
```

### 비유: 메모장

Redis는 **메모장**입니다.
자주 찾는 전화번호를 매번 전화번호부(데이터베이스)에서 찾으면 느립니다.
자주 쓰는 번호를 메모장(Redis)에 적어두면 순식간에 찾을 수 있습니다.

- **인메모리**: 데이터를 디스크가 아닌 **메모리(RAM)에 저장**합니다. 그래서 빠릅니다
- **6379번 포트**: Redis의 기본 포트입니다
- **replicas: 1**: 캐시는 날아가도 다시 채울 수 있으므로 1개만 운영합니다

### 왜 이게 필요한가?

데이터베이스 조회는 비용이 큽니다. 같은 데이터를 반복해서 조회할 때
Redis에 캐시해두면 **응답 시간을 수십~수백 배 줄일 수 있습니다**.

- 세션 저장: 사용자 로그인 상태를 Redis에 저장하면 어느 서버로 요청이 가든 동일한 세션
- API 응답 캐시: 같은 API 호출 결과를 일정 시간 캐시
- 실시간 카운터: 조회수, 좋아요 수 같은 빠른 증감 연산

---

## 4. PostgreSQL — 관계형 데이터베이스

```yaml
# manifests/demo/postgres-app.yaml

apiVersion: apps/v1
kind: Deployment
metadata:
  name: postgres
  namespace: demo
  labels:
    app: postgres
spec:
  replicas: 1
  selector:
    matchLabels:
      app: postgres
  template:
    metadata:
      labels:
        app: postgres
    spec:
      containers:
        - name: postgres
          image: postgres:16-alpine
          ports:
            - containerPort: 5432
          env:
            - name: POSTGRES_DB
              value: demo
            - name: POSTGRES_USER
              value: demo
            - name: POSTGRES_PASSWORD
              value: demo123
          resources:
            requests:
              cpu: 50m
              memory: 64Mi
            limits:
              cpu: 200m
              memory: 256Mi
---
apiVersion: v1
kind: Service
metadata:
  name: postgres
  namespace: demo
spec:
  type: ClusterIP
  selector:
    app: postgres
  ports:
    - port: 5432
      targetPort: 5432
```

### env (환경 변수)란?

`env` 섹션이 처음 등장했습니다. 컨테이너에 **환경 변수**를 주입하는 방법입니다.
PostgreSQL 컨테이너는 시작할 때 이 환경 변수를 읽어서 자동으로 데이터베이스와 사용자를 생성합니다.

- `POSTGRES_DB: demo` — "demo"라는 이름의 데이터베이스를 만들어라
- `POSTGRES_USER: demo` — "demo"라는 사용자를 만들어라
- `POSTGRES_PASSWORD: demo123` — 비밀번호는 "demo123"으로 설정해라

### 실제 프로젝트에서는

데모 환경이라 비밀번호를 YAML에 직접 적었지만,
**프로덕션에서는 절대 이렇게 하면 안 됩니다!**

실제로는 **Kubernetes Secret** 리소스를 사용합니다:

```yaml
# 프로덕션에서는 이렇게 합니다 (참고용)
env:
  - name: POSTGRES_PASSWORD
    valueFrom:
      secretKeyRef:
        name: postgres-secret
        key: password
```

Secret은 base64로 인코딩되어 저장되고, RBAC으로 접근 권한을 제한합니다.

---

## 5. RabbitMQ — 메시지 큐 (비동기 메시징)

```yaml
# manifests/demo/rabbitmq-app.yaml

apiVersion: apps/v1
kind: Deployment
metadata:
  name: rabbitmq
  namespace: demo
  labels:
    app: rabbitmq
spec:
  replicas: 1
  selector:
    matchLabels:
      app: rabbitmq
  template:
    metadata:
      labels:
        app: rabbitmq
    spec:
      containers:
        - name: rabbitmq
          image: rabbitmq:3-management-alpine
          ports:
            - containerPort: 5672
              name: amqp
            - containerPort: 15672
              name: management
          env:
            - name: RABBITMQ_DEFAULT_USER
              value: demo
            - name: RABBITMQ_DEFAULT_PASS
              value: demo123
          resources:
            requests:
              cpu: 50m
              memory: 128Mi
            limits:
              cpu: 300m
              memory: 512Mi
---
apiVersion: v1
kind: Service
metadata:
  name: rabbitmq
  namespace: demo
spec:
  type: ClusterIP
  selector:
    app: rabbitmq
  ports:
    - name: amqp
      port: 5672
      targetPort: 5672
    - name: management
      port: 15672
      targetPort: 15672
```

### 비유: 음식점 주문 전표

바쁜 식당에서 웨이터가 주문을 받으면 주방에 직접 말하지 않습니다.
**주문 전표를 꽂아 놓으면** 주방에서 순서대로 꺼내 요리합니다.

메시지 큐도 같습니다:
- **보내는 쪽**(Producer): 메시지를 큐에 넣고 바로 다음 일을 합니다
- **큐**: 메시지를 순서대로 보관합니다
- **받는 쪽**(Consumer): 처리 가능할 때 메시지를 하나씩 꺼내 처리합니다

```
서비스 A (주문 접수)
    │
    ▼
[RabbitMQ 큐: 주문1, 주문2, 주문3, ...]
    │
    ▼
서비스 B (주문 처리) — 자기 속도에 맞게 하나씩 꺼내 처리
```

### 왜 이게 필요한가?

1. **비동기 처리**: 이메일 발송, 이미지 변환 같은 느린 작업을 즉시 처리하지 않아도 됩니다
2. **부하 분산**: 갑자기 주문이 1000개 들어와도 큐에 쌓이고, 처리 서버가 자기 속도에 맞게 처리합니다
3. **서비스 분리**: A 서비스와 B 서비스가 직접 통신하지 않으므로, B가 잠시 죽어도 메시지가 큐에 보존됩니다

### 두 개의 포트

- **5672 (AMQP)**: 실제 메시지를 주고받는 프로토콜 포트
- **15672 (Management)**: 웹 브라우저에서 큐 상태를 볼 수 있는 관리 화면

`rabbitmq:3-management-alpine` 이미지를 쓰면 관리 화면이 기본 내장되어 있어,
브라우저에서 메시지 수, 소비 속도, 큐 상태 등을 시각적으로 확인할 수 있습니다.

---

## 6. Keycloak — 인증/인가 (SSO, OAuth 2.0)

```yaml
# manifests/demo/keycloak-app.yaml

apiVersion: apps/v1
kind: Deployment
metadata:
  name: keycloak
  namespace: demo
  labels:
    app: keycloak
spec:
  replicas: 1
  selector:
    matchLabels:
      app: keycloak
  template:
    metadata:
      labels:
        app: keycloak
    spec:
      containers:
        - name: keycloak
          image: quay.io/keycloak/keycloak:latest
          args: ["start-dev"]
          ports:
            - containerPort: 8080
          env:
            - name: KEYCLOAK_ADMIN
              value: admin
            - name: KEYCLOAK_ADMIN_PASSWORD
              value: admin
            - name: KC_DB
              value: postgres
            - name: KC_DB_URL
              value: jdbc:postgresql://postgres:5432/demo
            - name: KC_DB_USERNAME
              value: demo
            - name: KC_DB_PASSWORD
              value: demo123
            - name: KC_HEALTH_ENABLED
              value: "true"
          resources:
            requests:
              cpu: 100m
              memory: 256Mi
            limits:
              cpu: 500m
              memory: 768Mi
          readinessProbe:
            httpGet:
              path: /health/ready
              port: 8080
            initialDelaySeconds: 30
            periodSeconds: 10
          livenessProbe:
            httpGet:
              path: /health/live
              port: 8080
            initialDelaySeconds: 60
            periodSeconds: 30
---
apiVersion: v1
kind: Service
metadata:
  name: keycloak
  namespace: demo
spec:
  type: NodePort
  selector:
    app: keycloak
  ports:
    - port: 8080
      targetPort: 8080
      nodePort: 30880
```

### 비유: 건물 출입 관리 시스템

Keycloak은 **건물의 출입 관리 시스템**입니다.
한 번 사원증을 발급받으면(로그인) 건물 내 모든 사무실(서비스)에 그 사원증으로 들어갈 수 있습니다.
이것이 **SSO(Single Sign-On, 통합 인증)** 입니다.

- **OAuth 2.0**: "제3자 앱이 사용자 대신 리소스에 접근하는" 표준 프로토콜
- **KC_DB_URL**: `jdbc:postgresql://postgres:5432/demo` — Keycloak의 데이터(사용자 정보, 세션 등)를 PostgreSQL에 저장합니다

### Keycloak과 PostgreSQL의 연결

Keycloak은 **자체 데이터베이스가 없습니다**.
사용자 계정, 역할, 세션 정보를 **PostgreSQL에 저장**합니다.

```
Keycloak ──── KC_DB_URL ────► PostgreSQL
         jdbc:postgresql://      (demo DB)
         postgres:5432/demo
```

여기서 `postgres`는 IP 주소가 아니라 **쿠버네티스 Service 이름**입니다.
쿠버네티스가 자동으로 `postgres`라는 이름을 해당 Service의 ClusterIP로 해석해 줍니다.
이것을 **쿠버네티스 DNS**라고 합니다.

---

## Health Check: readinessProbe와 livenessProbe

Keycloak 설정에서 처음 등장하는 중요한 개념입니다.

### 비유: 출근 확인과 건강 검진

- **readinessProbe** (준비 상태 확인) = "출근했나요?"
  - 이 파드가 트래픽을 받을 **준비가 됐는지** 확인합니다
  - 준비되지 않았으면 Service가 이 파드에 트래픽을 보내지 않습니다
  - Keycloak은 시작하는 데 30초 정도 걸리므로 `initialDelaySeconds: 30`

- **livenessProbe** (생존 상태 확인) = "살아 있나요?"
  - 이 파드가 **정상적으로 동작하고 있는지** 확인합니다
  - 응답이 없으면 쿠버네티스가 파드를 **자동으로 재시작**합니다
  - Keycloak은 초기화가 더 오래 걸릴 수 있으므로 `initialDelaySeconds: 60`

```yaml
readinessProbe:
  httpGet:
    path: /health/ready     # 이 URL로 GET 요청을 보냄
    port: 8080              # 8080 포트로
  initialDelaySeconds: 30   # 파드 시작 후 30초 후부터 검사 시작
  periodSeconds: 10         # 10초마다 반복 검사

livenessProbe:
  httpGet:
    path: /health/live
    port: 8080
  initialDelaySeconds: 60
  periodSeconds: 30         # 30초마다 반복 검사
```

### 왜 이게 필요한가?

Health check 없이 파드가 멈추면:
1. 쿠버네티스는 파드가 살아 있다고 생각하고 계속 트래픽을 보냅니다
2. 사용자는 에러를 받습니다
3. 운영자가 수동으로 발견할 때까지 장애가 지속됩니다

Health check가 있으면:
1. readinessProbe 실패 → 트래픽 차단 (다른 정상 파드가 대신 처리)
2. livenessProbe 실패 → 파드 자동 재시작
3. 운영자가 잠을 자는 새벽에도 자동 복구

---

## Resource Requests와 Limits 이해하기

모든 서비스에 `resources` 설정이 있습니다. 이것을 자세히 봅시다.

```yaml
resources:
  requests:          # "최소한 이만큼은 주세요" (예약)
    cpu: 50m
    memory: 64Mi
  limits:            # "이것보다는 절대 더 못 씁니다" (상한)
    cpu: 200m
    memory: 256Mi
```

### CPU 단위: m (밀리코어)

- `1000m` = 1 CPU 코어
- `50m` = 0.05 코어 (CPU의 5%)
- `200m` = 0.2 코어 (CPU의 20%)

### 메모리 단위: Mi (메비바이트)

- `64Mi` ≈ 64 MB
- `256Mi` ≈ 256 MB
- `768Mi` ≈ 768 MB (Keycloak은 Java 기반이라 메모리를 많이 쓰기 때문)

### 비유: 사무실 공간 배정

- **requests** = "우리 팀에 최소 10평짜리 공간이 필요합니다" → 쿠버네티스가 10평짜리 자리를 **예약**해 줍니다
- **limits** = "하지만 아무리 바빠도 30평까지만 써주세요" → 30평을 넘으면 **강제로 제한**됩니다

| 서비스 | CPU request | CPU limit | Memory request | Memory limit |
|--------|------------|-----------|---------------|-------------|
| nginx | 50m | 200m | 64Mi | 128Mi |
| httpbin | 50m | 200m | 64Mi | 256Mi |
| redis | 50m | 200m | 64Mi | 256Mi |
| postgres | 50m | 200m | 64Mi | 256Mi |
| rabbitmq | 50m | 300m | 128Mi | 512Mi |
| keycloak | 100m | 500m | 256Mi | 768Mi |

Keycloak이 가장 많은 리소스를 사용합니다.
Java 기반 애플리케이션이라 메모리를 많이 필요로 하고,
인증/인가 로직이 복잡해서 CPU도 많이 쓰기 때문입니다.

---

## 서비스 간 연결 관계 정리

```
[외부 사용자]
    │
    ├── :30080 ──► nginx-web ──► httpbin ──┬── redis (캐시)
    │              (Web)         (API)     ├── postgres (DB)
    │                                      └── rabbitmq (메시지큐)
    │
    └── :30880 ──► keycloak ──────────────── postgres (DB)
                   (인증)
```

### 쿠버네티스 내부에서 서비스를 찾는 방법

파드 안에서 다른 서비스에 접근할 때 IP 주소 대신 **Service 이름**을 사용합니다.

```
# 같은 네임스페이스(demo) 안에서:
postgres:5432         ← Service 이름:포트

# 다른 네임스페이스에서:
postgres.demo.svc.cluster.local:5432  ← 전체 도메인
```

Keycloak의 `KC_DB_URL`이 `jdbc:postgresql://postgres:5432/demo`인 이유가 이것입니다.
`postgres`라는 Service 이름이 자동으로 해당 파드의 IP로 변환됩니다.

---

## 실제 프로젝트에서는

### 현실의 3-Tier 아키텍처는 더 복잡합니다

우리 데모 앱은 학습용으로 단순화한 것입니다. 실제 프로덕션에서는:

1. **Web Tier**: CDN(Content Delivery Network) + Load Balancer + nginx/Apache
2. **App Tier**: 마이크로서비스 수십~수백 개, API Gateway, Service Mesh
3. **Data Tier**: Primary-Replica DB 구성, 캐시 클러스터(Redis Cluster), 메시지 큐 클러스터

### 데모 앱에서 빠진 것들 (프로덕션에서는 필수)

| 항목 | 데모 앱 | 프로덕션 |
|------|---------|---------|
| 비밀번호 관리 | env에 직접 입력 | Kubernetes Secret 또는 Vault |
| 데이터 영속성 | 파드 재시작 시 데이터 소실 | PersistentVolumeClaim (PVC) |
| DB 이중화 | replica: 1 (단일 장애점) | Primary-Replica 또는 StatefulSet |
| 모니터링 | 없음 (SRE 대시보드에서 간접 확인) | Prometheus + Grafana |
| 로깅 | stdout만 | EFK 스택 (Elasticsearch + Fluentd + Kibana) |

하지만 이 데모 앱만으로도:
- 네트워크 정책 테스트 (서비스 간 통신 허용/차단)
- 서비스 메시 테스트 (카나리 배포, mTLS)
- 부하 테스트 (k6로 nginx/httpbin에 트래픽 발생)
- 오토스케일링 테스트 (HPA가 replicas를 자동 조절)

이 모든 것을 충분히 실습할 수 있습니다.

---

## 핵심 정리

| 서비스 | 역할 | 포트 | 접근 방식 | 리소스 특징 |
|--------|------|------|----------|-----------|
| nginx | 웹 프론트, 리버스 프록시 | 80 (NodePort 30080) | 외부 접근 가능 | 경량, 3개 복제본 |
| httpbin | REST API 테스트 | 80 (ClusterIP) | 내부 전용 | 2개 복제본, 카나리 대상 |
| redis | 인메모리 캐시 | 6379 (ClusterIP) | 내부 전용 | 메모리 중심 |
| postgres | 관계형 DB | 5432 (ClusterIP) | 내부 전용 | Keycloak 백엔드 |
| rabbitmq | 비동기 메시지 큐 | 5672, 15672 (ClusterIP) | 내부 전용 | 관리 UI 포함 |
| keycloak | SSO/OAuth 인증 | 8080 (NodePort 30880) | 외부 접근 가능 | Java 기반, 고메모리 |

---

## 다음 편 예고

12편에서는 이 모든 서비스를 **실시간으로 모니터링**하는 SRE 대시보드를 살펴봅니다.
React 프론트엔드와 Express 백엔드가 SSH를 통해 10개 VM의 상태를 수집하고,
6개의 페이지로 클러스터 상태, 트래픽, 스케일링을 시각화합니다.
