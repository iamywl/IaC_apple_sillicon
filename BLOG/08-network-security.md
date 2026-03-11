# 08. 네트워크 보안 -- 제로 트러스트와 CiliumNetworkPolicy

> **시리즈**: Apple Silicon Mac 한 대로 만드는 프로덕션급 멀티 클러스터 Kubernetes 인프라
>
> **난이도**: 입문 -- 인프라 경험이 전혀 없어도 괜찮습니다

---

## 이번 글에서 다루는 것

이전 글에서 Jenkins 파이프라인의 마지막 단계에서 흥미로운 테스트를 봤습니다.

```
nginx → httpbin GET  → 200 OK   (허용)
nginx → httpbin POST → 차단됨   (거부)
```

같은 서비스인데 GET은 되고 POST는 안 된다고요?
이번 글에서는 **이런 세밀한 네트워크 보안이 어떻게 가능한지** 하나씩 살펴봅니다.

---

## 제로 트러스트(Zero Trust)가 뭔가요?

### 비유: 회사 건물의 보안

**전통적인 보안** (경계 기반 보안):
```
[인터넷] ──── 방화벽 ──── [회사 내부 네트워크]
                              모든 직원이 모든 곳에 접근 가능
```
회사 건물에 들어오기만 하면 아무 방이나 들어갈 수 있는 것과 같습니다.
문제는 한 명이 뚫리면 **전체가 뚫린다**는 것입니다.

**제로 트러스트 보안**:
```
[인터넷] ──── 방화벽 ──── [회사 내부 네트워크]
                              각 방마다 별도의 잠금장치
                              직원마다 출입 가능한 방이 다름
                              매 출입마다 신분증 확인
```
회사 건물에 들어왔어도, 각 방마다 카드키가 필요합니다.
개발팀 직원은 개발실에만, 회계팀 직원은 회계실에만 들어갈 수 있습니다.

이것이 제로 트러스트의 핵심입니다.

> **"Never trust, always verify"**
> (절대 신뢰하지 마라, 항상 검증하라)

### 왜 이게 필요한가?

Kubernetes 클러스터에서 파드들은 기본적으로 **서로 모두 통신할 수 있습니다**.
nginx가 postgres에 직접 접근할 수 있고, redis가 keycloak에 연결할 수 있습니다.

이것은 매우 위험합니다. 만약 nginx 파드가 해킹당하면?
해커는 nginx를 통해 postgres 데이터베이스에 직접 접근하여
모든 사용자 정보를 빼낼 수 있습니다.

제로 트러스트를 적용하면:
- nginx는 httpbin과 redis에**만** 접근 가능
- postgres에는 httpbin과 keycloak**만** 접근 가능
- nginx가 해킹당해도 postgres에 직접 접근이 **불가능**

---

## 기본 전략: Default Deny (기본 거부)

### 비유: 화이트리스트 vs 블랙리스트

**블랙리스트 방식**: "이 사람은 출입 금지" -- 나머지는 다 들어올 수 있음
- 문제: 새로운 위협을 매번 추가해야 함. 하나라도 빠뜨리면 뚫림.

**화이트리스트 방식**: "이 사람만 출입 허용" -- 나머지는 다 차단
- 장점: 허용한 것만 통과. 모르는 것은 자동으로 차단.

우리 프로젝트는 **화이트리스트 방식**을 씁니다.

1단계: **모든 통신을 차단한다** (Default Deny)
2단계: **필요한 통신만 하나씩 허용한다** (Allow Rules)

---

## L3/L4/L7 필터링이 뭔가요?

네트워크 통신을 검사하는 수준(깊이)이 다릅니다.

| 레이어 | 검사 대상 | 비유 | 예시 |
|--------|-----------|------|------|
| **L3** (네트워크 계층) | IP 주소 | "어디에서 왔는가?" | 192.168.1.100에서 온 것만 허용 |
| **L4** (전송 계층) | 포트 번호 + 프로토콜 | "어느 문을 두드리는가?" | TCP 80번 포트만 허용 |
| **L7** (애플리케이션 계층) | HTTP 메서드, URL 경로 | "무엇을 하려고 하는가?" | GET만 허용, POST는 차단 |

**비유로 이해하기**:

- **L3**: 택배 기사의 출발지 주소만 확인 ("서울에서 온 택배만 받겠습니다")
- **L4**: 택배가 어떤 부서로 왔는지 확인 ("80번 창구로 온 택배만 받겠습니다")
- **L7**: 택배 상자를 열어서 내용물까지 확인 ("물건 받는 것은 되지만 반품은 안 됩니다")

일반적인 Kubernetes NetworkPolicy는 L3/L4까지만 가능합니다.
**CiliumNetworkPolicy**는 L7까지 가능합니다.
즉, HTTP GET은 허용하고 POST는 차단하는 것처럼 **내용까지 검사**할 수 있습니다.

---

## 우리 프로젝트의 네트워크 정책 전체 구조

먼저 전체 서비스 간 통신 구조를 그림으로 보겠습니다.

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

허용된 통신 경로:
- 외부 → nginx (포트 80)
- 외부 → keycloak (포트 8080)
- nginx → httpbin (포트 80, **GET만**)
- nginx → redis (포트 6379)
- httpbin → postgres (포트 5432)
- httpbin → rabbitmq (포트 5672)
- httpbin → keycloak (포트 8080)
- keycloak → postgres (포트 5432)

**이 외의 모든 통신은 차단됩니다.**

---

## 10개의 네트워크 정책 하나씩 분석

### 정책 1: Default Deny -- 모든 것을 차단

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

**비유**: 건물의 모든 문을 잠그는 것입니다. 그리고 나서 필요한 문만 하나씩 엽니다.

핵심 포인트:
- `endpointSelector: {}` -- 빈 셀렉터는 **모든 파드**를 의미합니다
- `ingress: []` -- 빈 배열은 "아무것도 허용하지 않음"을 의미합니다
- DNS(포트 53)만 예외입니다 -- DNS가 차단되면 `httpbin.demo.svc.cluster.local` 같은
  서비스 이름을 IP로 변환할 수 없어서 아무것도 동작하지 않기 때문입니다

### 왜 이게 필요한가?

이 정책이 없으면, 우리가 아무리 허용 정책을 잘 만들어도 의미가 없습니다.
"허용하지 않은 것은 차단"이 되어야 화이트리스트 방식이 동작하니까요.
이 정책이 **모든 네트워크 보안의 출발점**입니다.

---

### 정책 2: 외부에서 nginx로 (L4)

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

**비유**: 건물 정문을 열어서 방문객이 1층 안내데스크(nginx)에 올 수 있게 하는 것입니다.
하지만 다른 층(다른 서비스)에는 직접 갈 수 없습니다.

- `fromEntities: world` -- 외부 인터넷에서 오는 트래픽을 허용합니다
- `fromEntities: cluster` -- 클러스터 내 다른 네임스페이스에서 오는 트래픽도 허용합니다
- `port: "80"` -- 오직 80번 포트(HTTP)만 허용합니다

---

### 정책 3: nginx에서 httpbin으로 (L7 -- 핵심!)

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

**이것이 이 프로젝트에서 가장 중요한 네트워크 정책입니다.**

일반적인 L4 정책은 "포트 80 허용"까지만 할 수 있습니다.
하지만 이 정책은 한 단계 더 깊이 들어갑니다.

```
nginx → httpbin GET /get     → 허용 (200 OK)
nginx → httpbin POST /post   → 차단 (Cilium이 거부)
nginx → httpbin DELETE /     → 차단 (Cilium이 거부)
```

**비유**: 도서관에서 "책을 읽는 것(GET)"은 허용하지만,
"책을 가져가는 것(POST)"이나 "책을 버리는 것(DELETE)"은 금지하는 것과 같습니다.

### 왜 이게 필요한가?

웹 서버(nginx)가 API 서버(httpbin)에서 데이터를 **읽기만** 하면 되는 상황이라면,
쓰기(POST)나 삭제(DELETE) 권한은 필요 없습니다.
만약 nginx가 해킹당해서 공격자가 httpbin에 POST 요청을 보내려 해도,
네트워크 레벨에서 차단됩니다.
이것이 **최소 권한 원칙(Principle of Least Privilege)**입니다.

---

### 정책 4: nginx에서 redis로 (L4)

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

nginx가 세션 데이터나 캐시를 Redis에 저장하거나 읽기 위한 정책입니다.
**오직 nginx만** Redis에 접근할 수 있습니다.
httpbin이나 keycloak 등 다른 서비스에서 Redis에 직접 접근하는 것은 차단됩니다.

---

### 정책 5: nginx의 외부 나가기(Egress) 정책

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

**지금까지의 정책(2, 3, 4)은 "들어오는 것(ingress)"을 제어했습니다.**
이 정책은 **"나가는 것(egress)"을 제어**합니다.

**비유**: 지금까지는 "누가 우리 집에 들어올 수 있는지"를 정했습니다.
이번에는 "우리 집에서 누가 어디로 나갈 수 있는지"를 정하는 것입니다.

nginx가 갈 수 있는 곳:
- httpbin (포트 80, GET만)
- redis (포트 6379)
- DNS (포트 53)

이 3곳 **외에는 어디에도 갈 수 없습니다**.
nginx가 해킹당해도 postgres나 rabbitmq에 접근할 수 없습니다.

---

### 정책 6: httpbin에서 postgres로 (L4)

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
              protocol: TCP    # PostgreSQL 기본 포트
```

API 서버(httpbin)만 데이터베이스(postgres)에 접근할 수 있습니다.
웹 서버(nginx)에서 데이터베이스에 직접 접근하는 것은 차단됩니다.

**비유**: 은행에서 고객(nginx)이 직접 금고(postgres)에 들어가는 것은 안 되고,
반드시 은행원(httpbin)을 통해서만 금고에 접근할 수 있는 것과 같습니다.

---

### 정책 7: httpbin에서 rabbitmq로 (L4)

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

API 서버(httpbin)가 메시지 큐(rabbitmq)에 메시지를 보내기 위한 정책입니다.
RabbitMQ의 AMQP 포트(5672)만 허용합니다.
관리용 포트(15672)는 허용하지 않아서, 외부에서 RabbitMQ 관리 콘솔에 접근할 수 없습니다.

---

### 정책 8: httpbin에서 keycloak으로 (L4)

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
              protocol: TCP    # Keycloak HTTP 포트
```

API 서버(httpbin)가 사용자 인증을 위해 Keycloak에 토큰 검증을 요청하는 경로입니다.
사용자가 API를 호출할 때 "이 사용자가 진짜 로그인한 사용자인지" 확인하기 위해
httpbin이 keycloak에 물어보는 것입니다.

---

### 정책 9: keycloak에서 postgres로 (L4)

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

Keycloak은 사용자 계정 정보(아이디, 비밀번호 해시, 권한 등)를 PostgreSQL에 저장합니다.
따라서 Keycloak도 PostgreSQL에 접근할 수 있어야 합니다.

정리하면 PostgreSQL에 접근할 수 있는 서비스는 **딱 2개**뿐입니다.
- httpbin (정책 6)
- keycloak (정책 9)

nginx, redis, rabbitmq 등 다른 서비스는 PostgreSQL에 접근할 수 없습니다.

---

### 정책 10: 외부에서 keycloak으로 (L4)

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
              protocol: TCP    # Keycloak HTTP 포트만
```

사용자가 로그인 화면에 접근하려면 Keycloak에 직접 접속해야 합니다.
이 정책이 없으면 로그인 페이지 자체가 뜨지 않습니다.

외부에서 직접 접근할 수 있는 서비스는 **딱 2개**뿐입니다.
- nginx (정책 2) -- 웹 서비스 접근
- keycloak (정책 10) -- 로그인/인증 접근

나머지 서비스(httpbin, redis, postgres, rabbitmq)는 외부에서 **절대 직접 접근할 수 없습니다**.

---

## 실제 프로젝트에서는

### 정책의 방향: Ingress vs Egress

네트워크 정책에는 두 가지 방향이 있습니다.

```
       Egress (나가는 것)              Ingress (들어오는 것)
            ──────→                      ──────→
  [nginx 파드]              →           [httpbin 파드]
  "내가 어디로 갈 수 있는가?"            "누가 나에게 올 수 있는가?"
```

완벽한 보안을 위해서는 **양쪽 모두** 설정해야 합니다.
우리 프로젝트에서 nginx는 Ingress(정책 2)와 Egress(정책 5) 모두 설정되어 있습니다.

### Hubble로 트래픽 확인하기

Cilium에는 **Hubble**이라는 네트워크 관측 도구가 포함되어 있습니다.
실제로 어떤 트래픽이 허용되고 차단되었는지 실시간으로 볼 수 있습니다.

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

위 예시에서:
- nginx가 httpbin에 GET을 보냄 → `FORWARDED` (정책 3에 의해 허용)
- nginx가 httpbin에 POST를 보냄 → `DROPPED` (정책 3에서 GET만 허용했으므로 차단)
- nginx가 redis에 접속 → `FORWARDED` (정책 4에 의해 허용)
- nginx가 postgres에 접속 → `DROPPED` (nginx → postgres 허용 정책이 없으므로 차단)

```bash
# 차단된 트래픽만 필터링해서 보기
hubble observe --namespace demo --verdict DROPPED

# 특정 파드의 트래픽만 보기
hubble observe --namespace demo --to-pod demo/postgres
```

이 도구가 있으면 "왜 통신이 안 되지?"라는 문제를 빠르게 디버깅할 수 있습니다.
DROPPED가 보이면 어떤 정책이 차단하고 있는지 찾아서 수정하면 됩니다.

---

## 전체 정책 요약 표

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

---

## 네트워크 정책을 읽는 법 (빠른 정리)

CiliumNetworkPolicy를 처음 보면 어렵게 느껴지지만, 패턴이 있습니다.

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

---

## 핵심 요약

| 개념 | 한 줄 정리 |
|------|-----------|
| 제로 트러스트 | 아무도 믿지 마라, 항상 검증하라 |
| Default Deny | 모든 것을 먼저 차단하고, 필요한 것만 허용 |
| 화이트리스트 | 허용 목록에 있는 것만 통과시키는 방식 |
| L3 필터링 | IP 주소 기반 필터링 |
| L4 필터링 | 포트 번호 + 프로토콜 기반 필터링 |
| L7 필터링 | HTTP 메서드, 경로 등 애플리케이션 레벨 필터링 |
| CiliumNetworkPolicy | Cilium이 제공하는 L7까지 가능한 네트워크 정책 |
| Hubble | 네트워크 트래픽을 실시간 관찰하는 도구 |
| FORWARDED | Hubble에서 허용된 트래픽 |
| DROPPED | Hubble에서 차단된 트래픽 |

---

## 관련 파일

```
manifests/network-policies/
  ├── default-deny.yaml                 ← 기본 거부 정책 (모든 보안의 출발점)
  ├── allow-external-to-nginx.yaml      ← 외부 → nginx
  ├── allow-nginx-to-httpbin.yaml       ← nginx → httpbin (L7: GET만!)
  ├── allow-nginx-to-redis.yaml         ← nginx → redis
  ├── allow-nginx-egress.yaml           ← nginx 나가는 트래픽 제어
  ├── allow-httpbin-to-postgres.yaml    ← httpbin → postgres
  ├── allow-httpbin-to-rabbitmq.yaml    ← httpbin → rabbitmq
  ├── allow-httpbin-to-keycloak.yaml    ← httpbin → keycloak
  ├── allow-keycloak-to-postgres.yaml   ← keycloak → postgres
  └── allow-external-to-keycloak.yaml   ← 외부 → keycloak
```

---

> **다음 글**: [09. 오토스케일링 -- HPA와 PDB](09-autoscaling.md)
>
> 서비스가 안전하게 보호되고 있으니, 이제 트래픽이 몰렸을 때
> 자동으로 서비스를 확장하는 방법을 알아봅니다.
