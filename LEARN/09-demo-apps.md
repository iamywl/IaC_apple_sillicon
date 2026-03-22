# 09. 데모 애플리케이션 — 마이크로서비스와 부하 테스트

## 목차

1. [왜 데모 앱이 필요한가?](#왜-데모-앱이-필요한가)
2. [3-Tier 아키텍처란?](#3-tier-아키텍처란)
3. [서비스 구성](#서비스-구성)
   - [nginx — Web Tier](#1-nginx--web-tier-리버스-프록시)
   - [httpbin — App Tier](#2-httpbin--app-tier-rest-api)
   - [Redis — 캐시](#3-redis--캐시-인메모리-저장소)
   - [PostgreSQL — 관계형 DB](#4-postgresql--관계형-데이터베이스)
   - [RabbitMQ — 메시지 큐](#5-rabbitmq--메시지-큐-비동기-메시징)
   - [Keycloak — 인증/인가](#6-keycloak--인증인가-sso-oauth-20)
4. [전체 서비스 아키텍처](#전체-서비스-아키텍처)
5. [Health Check: readinessProbe와 livenessProbe](#health-check-readinessprobe와-livenessprobe)
6. [Resource Requests와 Limits](#resource-requests와-limits-이해하기)
7. [HPA (Horizontal Pod Autoscaler)](#hpa-horizontal-pod-autoscaler)
8. [부하 테스트 (k6)](#부하-테스트-k6)
9. [스트레스 테스트 (stress-ng)](#스트레스-테스트-stress-ng)
10. [수정 가이드](#수정-가이드)

---

## 왜 데모 앱이 필요한가?

인프라만 구축해서는 그 인프라가 올바르게 동작하는지 검증할 수 없다. 실제 워크로드가 올라가야 비로소 문제가 드러난다. 네트워크 정책이 정상 트래픽까지 차단하는지, 서비스 메시가 트래픽을 의도대로 분배하는지, HPA가 부하에 반응하는지 — 이런 것은 실제 서비스 간 통신이 발생해야만 확인할 수 있다.

인프라 레벨의 설정 오류는 애플리케이션이 올라간 후에야 표면화된다. DNS 해석 실패, 리소스 경합에 의한 OOMKill, 네트워크 정책의 의도치 않은 차단 등은 워크로드 없이는 발견이 불가능하다. 즉, 데모 앱은 인프라의 **검증 도구**이다.

단순히 nginx 하나만 띄우면 "쿠버네티스가 돌아간다"는 확인할 수 있지만,
현실의 복잡한 서비스 간 통신, 데이터베이스 연동, 인증, 비동기 메시징 같은 것은 테스트할 수 없다.

그래서 우리 프로젝트에서는 **6개의 서비스**로 구성된 현실적인 데모 앱을 만들었다.

---

## 3-Tier 아키텍처란?

웹 애플리케이션을 역할에 따라 세 개의 계층으로 분리하는 구조다:

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

왜 이렇게 계층을 분리하는가? 모놀리식(단일 프로세스)으로 모든 것을 묶으면 하나의 컴포넌트 장애가 전체 시스템을 중단시킨다. 계층 분리는 이 **장애 전파 범위(blast radius)**를 제한하기 위한 구조적 결정이다.

1. **독립 스케일링**: 병목이 되는 계층만 선택적으로 확장할 수 있다. 사용자가 몰리면 Web Tier만 3개, 5개로 늘리면 된다. DB를 5개 복제할 필요는 없다. 각 계층의 리소스 소비 특성이 다르기 때문에(Web은 CPU 바운드, DB는 I/O 바운드), 동일한 비율로 확장하는 것은 비효율적이다
2. **장애 격리**: DB가 느려져도 Web 계층은 캐시된 데이터로 기본 응답을 줄 수 있다. 한 계층의 장애가 다른 계층으로 직접 전파되지 않으므로, 부분 장애 상태에서도 서비스 가용성을 유지할 수 있다
3. **독립적인 배포**: App 계층의 코드를 바꿔도 Web, DB는 재배포할 필요 없다. 배포 단위가 작을수록 롤백이 빠르고 변경 위험이 줄어든다
4. **팀 분리**: 프론트엔드 팀, 백엔드 팀, DBA가 각자 담당 계층을 관리한다

---

## 서비스 구성

6개의 서비스가 어떻게 연결되는지 전체 그림을 먼저 보자:

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

각 서비스는 특정 인프라 기능을 검증하기 위해 선택되었다.

- **nginx**: 리버스 프록시 계층의 동작과 L7 라우팅을 검증한다
- **httpbin**: REST API 엔드포인트 테스트와 서비스 메시 카나리 배포의 대상이 된다
- **Redis**: 캐시 계층의 존재가 응답 시간에 미치는 영향을 측정할 수 있다
- **PostgreSQL**: 영속성 계층(Stateful 워크로드)이 Kubernetes 환경에서 정상 동작하는지 확인한다
- **RabbitMQ**: 비동기 메시징 패턴의 동작과 Producer-Consumer 간 부하 분산을 검증한다
- **Keycloak**: OAuth 2.0/SSO 인증 흐름이 서비스 간 통합에서 정상 동작하는지 확인한다

이제 각 서비스를 하나씩 살펴보자.

---

### 1. nginx — Web Tier (리버스 프록시)

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

**Deployment** (배포 설정):
- `replicas: 3` — nginx 파드를 **3개** 동시에 실행한다. 하나가 죽어도 나머지 2개가 요청을 처리한다
- `image: nginx:alpine` — Docker Hub에서 nginx의 경량 버전(Alpine Linux 기반)을 가져온다
- `containerPort: 80` — 컨테이너 내부에서 80번 포트를 사용한다

**Service** (서비스 = 네트워크 진입점):
- `type: NodePort` — 클러스터 외부에서 접근할 수 있게 노드의 포트를 연다
- `nodePort: 30080` — 노드의 **30080번 포트**로 접근하면 nginx로 연결된다
- `selector: app: nginx-web` — `app: nginx-web` 라벨이 붙은 파드들에게 트래픽을 보낸다

nginx는 사용자 요청을 가장 먼저 받는 리버스 프록시 역할을 한다. 정적 파일을 직접 서빙하고, API 요청은 뒤쪽의 httpbin으로 전달한다. replicas를 3으로 설정했기 때문에 한 파드에 장애가 발생해도 나머지 2개가 요청을 처리한다.

**HPA 설정**: 3→10개 Pod 사이에서 오토스케일링.

---

### 2. httpbin — App Tier (REST API)

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

REST API 테스트 서버로 `/get`, `/post`, `/status/200` 등 다양한 엔드포인트를 제공한다.

#### ClusterIP vs NodePort

| 타입 | 외부 접근 | 용도 |
|------|----------|------|
| `NodePort` | 가능 (노드IP:포트) | 사용자가 직접 접근하는 서비스 |
| `ClusterIP` | 불가능 (클러스터 내부만) | 내부 서비스 간 통신용 |

httpbin은 외부 사용자가 직접 접근할 필요가 없다.
nginx가 대신 접근해 주니까 `ClusterIP`를 사용한다.

#### version 라벨과 카나리 배포

`version: v1` 라벨에 주목하라.
Istio 카나리 배포가 바로 이 라벨을 기준으로 트래픽을 분배한다.

```yaml
# manifests/istio/httpbin-v2.yaml (카나리 배포용)
spec:
  replicas: 1
  template:
    metadata:
      labels:
        app: httpbin
        version: v2        # ← v1과 구분
```

v2 Deployment에는 `version: v2`가 붙어 있고, VirtualService가 80:20 비율로 나눈다.

**HPA 설정**: 2→6개 Pod 사이에서 오토스케일링.

---

### 3. Redis — 캐시 (인메모리 저장소)

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

Redis는 데이터를 디스크가 아닌 **메모리(RAM)에 저장**하는 인메모리 데이터 스토어다. 디스크 I/O가 없으므로 읽기/쓰기 지연이 마이크로초 단위로 매우 빠르다.

- **6379번 포트**: Redis의 기본 포트다
- **replicas: 1**: 캐시는 유실되어도 원본 데이터베이스에서 다시 채울 수 있으므로 1개만 운영한다

데이터베이스 조회는 비용이 크다. 같은 데이터를 반복해서 조회할 때 Redis에 캐시해두면 **응답 시간을 수십~수백 배 줄일 수 있다**.

- 세션 저장: 사용자 로그인 상태를 Redis에 저장하면 어느 서버로 요청이 가든 동일한 세션 유지
- API 응답 캐시: 같은 API 호출 결과를 일정 시간 캐시
- 실시간 카운터: 조회수, 좋아요 수 같은 빠른 증감 연산

**HPA 설정**: 1→4개 Pod 사이에서 오토스케일링.

---

### 4. PostgreSQL — 관계형 데이터베이스

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

#### env (환경 변수)

`env` 섹션은 컨테이너에 **환경 변수**를 주입하는 방법이다.
PostgreSQL 컨테이너는 시작할 때 이 환경 변수를 읽어서 자동으로 데이터베이스와 사용자를 생성한다.

- `POSTGRES_DB: demo` — "demo"라는 이름의 데이터베이스를 만든다
- `POSTGRES_USER: demo` — "demo"라는 사용자를 만든다
- `POSTGRES_PASSWORD: demo123` — 비밀번호를 "demo123"으로 설정한다

#### 프로덕션에서의 비밀번호 관리

데모 환경이라 비밀번호를 YAML에 직접 적었지만,
**프로덕션에서는 절대 이렇게 하면 안 된다!**

실제로는 **Kubernetes Secret** 리소스를 사용한다:

```yaml
# 프로덕션에서는 이렇게 한다 (참고용)
env:
  - name: POSTGRES_PASSWORD
    valueFrom:
      secretKeyRef:
        name: postgres-secret
        key: password
```

Secret은 base64로 인코딩되어 저장되고, RBAC으로 접근 권한을 제한한다.

**HPA 설정**: 1→4개 Pod 사이에서 오토스케일링. Keycloak의 백엔드 DB로도 사용된다.

---

### 5. RabbitMQ — 메시지 큐 (비동기 메시징)

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

메시지 큐는 서비스 간 비동기 통신을 중개하는 미들웨어다. Producer가 메시지를 큐에 넣으면 Consumer가 자기 처리 속도에 맞게 꺼내 처리하는 구조다.

```
서비스 A (Producer)
    │
    ▼
[RabbitMQ 큐: 메시지1, 메시지2, 메시지3, ...]
    │
    ▼
서비스 B (Consumer) — 자기 속도에 맞게 하나씩 꺼내 처리
```

메시지 큐가 필요한 이유:

1. **비동기 처리**: 이메일 발송, 이미지 변환 같은 느린 작업을 즉시 처리하지 않아도 된다
2. **부하 완충**: 갑자기 요청이 1000개 들어와도 큐에 쌓이고, 처리 서버가 자기 속도에 맞게 소비한다
3. **서비스 분리**: A 서비스와 B 서비스가 직접 통신하지 않으므로, B가 잠시 죽어도 메시지가 큐에 보존된다

#### 두 개의 포트

- **5672 (AMQP)**: 실제 메시지를 주고받는 프로토콜 포트
- **15672 (Management)**: 웹 브라우저에서 큐 상태를 볼 수 있는 관리 화면

`rabbitmq:3-management-alpine` 이미지를 쓰면 관리 화면이 기본 내장되어 있어,
브라우저에서 메시지 수, 소비 속도, 큐 상태 등을 시각적으로 확인할 수 있다.

**HPA 설정**: 1→3개 Pod 사이에서 오토스케일링.

---

### 6. Keycloak — 인증/인가 (SSO, OAuth 2.0)

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

Keycloak은 오픈소스 IAM(Identity and Access Management) 솔루션이다.
한 번 로그인하면 연동된 모든 서비스에 별도 인증 없이 접근할 수 있는 **SSO(Single Sign-On, 통합 인증)**를 제공한다.

- **OAuth 2.0**: "제3자 앱이 사용자 대신 리소스에 접근하는" 표준 프로토콜
- **KC_DB_URL**: `jdbc:postgresql://postgres:5432/demo` — Keycloak의 데이터(사용자 정보, 세션 등)를 PostgreSQL에 저장한다

#### Keycloak과 PostgreSQL의 연결

Keycloak은 **자체 데이터베이스가 없다**.
사용자 계정, 역할, 세션 정보를 **PostgreSQL에 저장**한다.

```
Keycloak ──── KC_DB_URL ────► PostgreSQL
         jdbc:postgresql://      (demo DB)
         postgres:5432/demo
```

여기서 `postgres`는 IP 주소가 아니라 **쿠버네티스 Service 이름**이다.
쿠버네티스가 자동으로 `postgres`라는 이름을 해당 Service의 ClusterIP로 해석해 준다.
이것을 **쿠버네티스 DNS**라고 한다.

**HPA 설정**: 1개 고정 (스케일링 대상 아님).

---

## 전체 서비스 아키텍처

```
                    ┌───────────────────────────────────────────────────────┐
                    │                    demo namespace                     │
                    │                                                       │
  Client ──:30080─→ │  nginx ──→ httpbin ──→ redis (cache)                  │
                    │   (web)      (api)  ├→ postgres (DB)                  │
                    │                     └→ rabbitmq (MQ)                  │
                    │                                                       │
  Client ──:30880─→ │  keycloak ──→ postgres (auth DB)                     │
                    │   (SSO)                                               │
                    └───────────────────────────────────────────────────────┘

HPA 스케일링:
  nginx-web: 3→10    httpbin: 2→6    redis: 1→4
  postgres:  1→4     rabbitmq: 1→3   keycloak: 1 (고정)
```

### 쿠버네티스 내부에서 서비스를 찾는 방법

파드 안에서 다른 서비스에 접근할 때 IP 주소 대신 **Service 이름**을 사용한다.

```
# 같은 네임스페이스(demo) 안에서:
postgres:5432         ← Service 이름:포트

# 다른 네임스페이스에서:
postgres.demo.svc.cluster.local:5432  ← 전체 도메인
```

---

## Health Check: readinessProbe와 livenessProbe

Health Check가 필요한 이유는 명확하다. Kubernetes는 컨테이너 프로세스의 존재 여부만으로는 애플리케이션이 정상인지 판단할 수 없다. 프로세스가 살아 있더라도 데드락에 빠져 요청을 처리하지 못하거나, 아직 초기화가 완료되지 않은 상태일 수 있다. Health Check는 kubelet이 Pod의 실제 상태를 판단하는 **유일한 수단**이다.

- **readinessProbe** (준비 상태 확인): 이 파드가 트래픽을 받을 **준비가 됐는지** 확인한다. 준비되지 않았으면 Service가 이 파드에 트래픽을 보내지 않는다. Keycloak은 시작하는 데 30초 정도 걸리므로 `initialDelaySeconds: 30`으로 설정했다.

- **livenessProbe** (생존 상태 확인): 이 파드가 **정상적으로 동작하고 있는지** 확인한다. 응답이 없으면 쿠버네티스가 파드를 **자동으로 재시작**한다. Keycloak은 초기화가 더 오래 걸릴 수 있으므로 `initialDelaySeconds: 60`으로 설정했다.

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

Health check 없이 파드가 멈추면:
1. 쿠버네티스는 파드가 살아 있다고 생각하고 계속 트래픽을 보낸다
2. 사용자는 에러를 받는다
3. 운영자가 수동으로 발견할 때까지 장애가 지속된다

Health check가 있으면:
1. readinessProbe 실패 → 트래픽 차단 (다른 정상 파드가 대신 처리)
2. livenessProbe 실패 → 파드 자동 재시작
3. 운영자가 없는 새벽에도 자동 복구가 이루어진다

---

## Resource Requests와 Limits 이해하기

왜 Resource Requests와 Limits를 설정해야 하는가? 설정하지 않으면 두 가지 문제가 발생한다. 첫째, 스케줄러가 노드의 가용 리소스를 정확히 계산할 수 없어 Pod 배치가 비효율적이 된다(requests 미설정). 둘째, 하나의 Pod가 노드의 리소스를 전부 소진하여 같은 노드의 다른 Pod까지 OOMKill되는 연쇄 장애가 발생할 수 있다(limits 미설정). requests는 스케줄링 정확도를, limits는 장애 격리를 보장하는 메커니즘이다.

```yaml
resources:
  requests:          # "최소한 이만큼은 보장해라" (예약)
    cpu: 50m
    memory: 64Mi
  limits:            # "이것보다 더 쓸 수 없다" (상한)
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
- `768Mi` ≈ 768 MB (Keycloak은 Java 기반이라 메모리를 많이 쓴다)

**requests**는 쿠버네티스 스케줄러가 파드를 노드에 배치할 때 보장하는 최소 리소스 양이다. **limits**는 파드가 사용할 수 있는 절대 상한이며, 이를 초과하면 CPU는 스로틀링되고 메모리는 OOMKill로 파드가 재시작된다.

| 서비스 | CPU request | CPU limit | Memory request | Memory limit |
|--------|------------|-----------|---------------|-------------|
| nginx | 50m | 200m | 64Mi | 128Mi |
| httpbin | 50m | 200m | 64Mi | 256Mi |
| redis | 50m | 200m | 64Mi | 256Mi |
| postgres | 50m | 200m | 64Mi | 256Mi |
| rabbitmq | 50m | 300m | 128Mi | 512Mi |
| keycloak | 100m | 500m | 256Mi | 768Mi |

Keycloak이 가장 많은 리소스를 사용한다.
Java 기반 애플리케이션이라 메모리를 많이 필요로 하고,
인증/인가 로직이 복잡해서 CPU도 많이 쓰기 때문이다.

---

## HPA (Horizontal Pod Autoscaler)

### 관련 파일 위치

```
scripts/install/11-install-hpa.sh        ← 설치 스크립트
manifests/metrics-server-values.yaml     ← metrics-server 설정
manifests/hpa/nginx-hpa.yaml             ← nginx HPA
manifests/hpa/httpbin-hpa.yaml           ← httpbin HPA
manifests/hpa/redis-hpa.yaml             ← redis HPA
manifests/hpa/postgres-hpa.yaml          ← postgres HPA
manifests/hpa/rabbitmq-hpa.yaml          ← rabbitmq HPA
manifests/hpa/pdb-nginx.yaml             ← Pod Disruption Budget
manifests/hpa/pdb-httpbin.yaml           ← Pod Disruption Budget
manifests/hpa/pdb-redis.yaml             ← Pod Disruption Budget (minAvailable: 1)
manifests/hpa/pdb-postgres.yaml          ← Pod Disruption Budget (minAvailable: 1)
manifests/hpa/pdb-rabbitmq.yaml          ← Pod Disruption Budget (minAvailable: 1)
manifests/hpa/pdb-keycloak.yaml          ← Pod Disruption Budget (minAvailable: 1)
```

### HPA 동작 원리

```
metrics-server → kubelet에서 Pod CPU/메모리 사용량 수집
       │
       ▼
HPA Controller (30초마다 평가)
       │
       ├── CPU 사용률 > 50% → Pod 증가 (스케일 업)
       └── CPU 사용률 < 50% → Pod 감소 (스케일 다운)
```

### nginx HPA 상세 (manifests/hpa/nginx-hpa.yaml)

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: nginx-web-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: nginx-web
  minReplicas: 3           # 최소 3개 Pod
  maxReplicas: 10          # 최대 10개 Pod
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 50   # 평균 CPU 50% 유지 목표
  behavior:
    scaleUp:
      policies:
        - type: Pods
          value: 2            # 한 번에 최대 2개 Pod 추가
          periodSeconds: 15   # 15초마다 평가
      stabilizationWindowSeconds: 30   # 30초간 안정화 대기
    scaleDown:
      policies:
        - type: Pods
          value: 1            # 한 번에 1개씩만 제거
          periodSeconds: 60   # 60초마다 평가
      stabilizationWindowSeconds: 120  # 2분간 안정화 대기
```

**스케일업 vs 스케일다운**:
- 스케일업: 빠르게 (15초마다 2개씩)
- 스케일다운: 느리게 (60초마다 1개씩, 2분 안정화)
- 이유: 급격한 축소로 서비스 장애가 발생하는 것을 방지

### Pod Disruption Budget (PDB)

```yaml
# manifests/hpa/pdb-nginx.yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
spec:
  minAvailable: 2          # 최소 2개 Pod는 항상 유지
  selector:
    matchLabels:
      app: nginx-web
```

노드 drain이나 스케일다운 시에도 최소 Pod 수를 보장한다.

---

## 부하 테스트 (k6)

### k6란?

Go로 작성된 HTTP 부하 테스트 도구. JavaScript로 시나리오를 작성한다.

### 테스트 실행 구조

```
대시보드 Testing 페이지
  │ POST /api/tests/run
  ▼
server/jobs.ts
  │ K8s Job YAML 생성
  ▼
kubectl apply (dev 클러스터)
  │ k6 컨테이너 실행
  ▼
k6 run --out json script.js
  │ 결과 수집
  ▼
server/parsers/k6.ts → 파싱
  │
  ▼
TestRun.results에 저장
```

### k6 Job YAML (manifests/demo/k6-loadtest.yaml)

```yaml
apiVersion: batch/v1
kind: Job
spec:
  template:
    spec:
      containers:
        - name: k6
          image: grafana/k6:latest
          command: ["k6", "run", "--out", "json=/results/output.json", "/scripts/test.js"]
      restartPolicy: Never
  backoffLimit: 0
```

### 프리셋 시나리오

| 시나리오 | VUs | 기간 | 대상 |
|---------|-----|------|------|
| Light Load | 10 | 15s | nginx |
| Standard Load | 50 | 30s | nginx |
| Heavy Load | 200 | 60s | nginx |
| Ramp-up | 0→100 | 10s 증가 + 30s 유지 | nginx |
| Httpbin API | 30 | 30s | httpbin /get |
| Strict SLA | 50 | 30s | p95<500ms, error<1% |
| Scale Light | 30 + 60s cooldown | 60s | nginx (HPA 관측용) |
| Scale Heavy | 200 + 60s cooldown | 120s | nginx (HPA 관측용) |
| Scale Ramp | 150, ramp 30s + 60s cooldown | 60s | nginx (HPA 관측용) |
| Cascade Light | 30 + 60s cooldown | 60s | nginx + httpbin 동시 부하, 4개 HPA 관측 |
| Cascade Heavy | 150 + 90s cooldown | 120s | 3-Tier 전체 부하 |
| Cascade Ramp | 100, ramp 20s + 60s cooldown | 60s | 점진적 3-Tier 부하 |

### 캐스케이드(Cascade) 테스트란?

일반 스케일링 테스트는 nginx 한 곳만 부하를 건다. 캐스케이드 테스트는 **nginx(웹)과 httpbin(앱)에 동시에 부하**를 걸어,
4개 디플로이먼트(nginx-web, httpbin, redis, postgres) 전체 HPA가 연쇄 반응하는 것을 관측한다.

```
k6 Pod → nginx-web:80 (동시 요청)
       → httpbin:80/get (동시 요청)

관측:
  nginx-web HPA: 3→10 (CPU 50% 기준)
  httpbin HPA:   2→6  (CPU 50% 기준)
  redis HPA:     1→4  (CPU 50% 기준)
  postgres HPA:  1→4  (CPU 50% 기준)
```

### 결과 메트릭

| 메트릭 | 설명 |
|--------|------|
| p95 | 95% 요청의 응답 시간 (ms) |
| p99 | 99% 요청의 응답 시간 (ms) |
| avg | 평균 응답 시간 (ms) |
| rps | 초당 요청 수 (Requests Per Second) |
| errorRate | 에러 비율 (%) |
| totalRequests | 총 요청 수 |

---

## 스트레스 테스트 (stress-ng)

### CPU 스트레스

```yaml
# manifests/demo/stress-test.yaml
spec:
  containers:
    - name: stress
      image: alexeiled/stress-ng:latest
      command: ["stress-ng", "--cpu", "2", "--timeout", "60s", "--metrics-brief"]
```

CPU에 부하를 주어 HPA가 스케일업하는 것을 관찰한다.

### 메모리 스트레스

```bash
stress-ng --vm 1 --vm-bytes 128M --timeout 30s
```

메모리를 할당하여 OOM 상황을 시뮬레이션한다.

---

## 실제 프로젝트와의 차이

### 현실의 3-Tier 아키텍처는 더 복잡하다

우리 데모 앱은 학습용으로 단순화한 것이다. 실제 프로덕션에서는:

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

이 모든 것을 충분히 실습할 수 있다.

---

## 수정 가이드

| 하고 싶은 것 | 수정할 파일 |
|-------------|-----------|
| 새 데모 앱 추가 | `manifests/demo/`에 Deployment + Service YAML + 네트워크 정책 추가 |
| HPA 설정 변경 | `manifests/hpa/`의 해당 HPA YAML |
| HPA min/max 변경 | minReplicas, maxReplicas 값 |
| 스케일 속도 변경 | behavior.scaleUp/scaleDown 값 |
| 테스트 프리셋 추가 | `dashboard/src/pages/TestingPage.tsx`의 프리셋 배열 |
| k6 스크립트 수정 | `server/jobs.ts`의 Job YAML 생성 로직 |
| 새 파서 추가 | `server/parsers/`에 파일 + `jobs.ts`에서 호출 |

---

## 핵심 정리

| 서비스 | 역할 | 포트 | 접근 방식 | HPA 범위 |
|--------|------|------|----------|----------|
| nginx | 웹 프론트, 리버스 프록시 | 80 (NodePort 30080) | 외부 접근 가능 | 3→10 |
| httpbin | REST API 테스트 | 80 (ClusterIP) | 내부 전용 | 2→6 |
| redis | 인메모리 캐시 | 6379 (ClusterIP) | 내부 전용 | 1→4 |
| postgres | 관계형 DB | 5432 (ClusterIP) | 내부 전용 | 1→4 |
| rabbitmq | 비동기 메시지 큐 | 5672, 15672 (ClusterIP) | 내부 전용 | 1→3 |
| keycloak | SSO/OAuth 인증 | 8080 (NodePort 30880) | 외부 접근 가능 | 1 (고정) |
