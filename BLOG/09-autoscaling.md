# 09. 오토스케일링 -- HPA와 PDB

> **시리즈**: Apple Silicon Mac 한 대로 만드는 프로덕션급 멀티 클러스터 Kubernetes 인프라
>
> **난이도**: 입문 -- 인프라 경험이 전혀 없어도 괜찮습니다

---

## 이번 글에서 다루는 것

서비스를 배포했습니다. 보안도 설정했습니다.
그런데 어느 날 갑자기 사용자가 10배로 늘어나면 어떻게 될까요?

서버 3대로 버티던 nginx가 갑자기 밀려드는 트래픽을 감당하지 못하고 쓰러집니다.
이번 글에서는 **트래픽에 따라 자동으로 서버를 늘렸다 줄이는 오토스케일링**을 다룹니다.

---

## 오토스케일링이 뭔가요?

### 비유: 마트 계산대

금요일 저녁, 마트에 사람이 몰립니다.

**수동 관리 방식**:
- 매니저가 CCTV를 보면서 "사람 많다!" → 직원에게 전화 → 계산대 추가 오픈
- 느리고, 매니저가 자리를 비우면 대응 불가

**자동 관리 방식**:
- 대기 줄이 5명 이상이면 자동으로 계산대 추가 오픈
- 대기 줄이 2명 이하로 줄면 자동으로 계산대 닫기
- 24시간 쉬지 않고 동작

쿠버네티스의 오토스케일링도 정확히 이렇게 동작합니다.
CPU 사용률이 높아지면 파드를 자동으로 늘리고,
낮아지면 자동으로 줄입니다.

### 왜 이게 필요한가?

"그냥 처음부터 서버를 많이 띄워놓으면 되지 않나요?"

가능합니다. 하지만 비용 문제가 있습니다.

```
상황: 평소 트래픽 100, 최대 트래픽 1000

방법 1: 항상 서버 10대 유지 (오버 프로비저닝)
  → 평소에 9대는 놀고 있음
  → 매달 클라우드 비용이 10배

방법 2: 항상 서버 1대 유지 (언더 프로비저닝)
  → 트래픽 폭증 시 서비스 다운
  → 매출 손실, 사용자 이탈

방법 3: 오토스케일링 (적응형)
  → 평소에는 서버 1~3대
  → 트래픽 몰리면 자동으로 10대까지 확장
  → 트래픽 줄면 자동으로 축소
  → 비용도 아끼고 서비스도 안정적
```

실제 기업에서 오토스케일링은 **비용 절감**과 **서비스 안정성**을
동시에 달성하는 핵심 기술입니다.

---

## HPA (Horizontal Pod Autoscaler)란?

HPA는 **수평적 파드 오토스케일러**입니다.

### 수평 확장 vs 수직 확장

```
수직 확장 (Scale Up):           수평 확장 (Scale Out):
더 강한 컴퓨터 1대              보통 컴퓨터 여러 대

┌────────────┐                  ┌────┐ ┌────┐ ┌────┐
│            │                  │    │ │    │ │    │
│   대형     │        vs       │소형│ │소형│ │소형│
│   서버     │                  │    │ │    │ │    │
│            │                  └────┘ └────┘ └────┘
└────────────┘
```

**수직 확장**은 한계가 있습니다. 아무리 좋은 컴퓨터도 무한히 업그레이드할 수는 없으니까요.
**수평 확장**은 컴퓨터를 추가하기만 하면 되므로 이론적으로 무한히 확장 가능합니다.

HPA는 이름 그대로 **수평적(Horizontal)** 확장을 합니다.
파드의 "수"를 늘리고 줄이는 것입니다.

---

## metrics-server: HPA의 눈

HPA가 "지금 CPU를 얼마나 쓰고 있는지" 어떻게 알 수 있을까요?
바로 **metrics-server** 덕분입니다.

```
┌──────────────┐
│ metrics-     │  "nginx 파드들의 평균 CPU는 지금 75%야"
│ server       │ ──────────────────────────────────────→  HPA
└──────┬───────┘
       │ (15초마다 수집)
       │
  ┌────▼────┐  ┌─────────┐  ┌─────────┐
  │ nginx-1 │  │ nginx-2 │  │ nginx-3 │
  │ CPU:80% │  │ CPU:70% │  │ CPU:75% │
  └─────────┘  └─────────┘  └─────────┘
```

metrics-server는 각 파드의 CPU와 메모리 사용량을 **15초마다** 수집합니다.
HPA는 이 데이터를 보고 파드를 늘릴지 줄일지 결정합니다.

metrics-server가 없으면 HPA는 아무것도 할 수 없습니다.
눈이 없는 것과 같습니다. 그래서 HPA를 쓰려면 반드시 metrics-server가
먼저 설치되어 있어야 합니다.

---

## HPA의 스케일링 공식

HPA가 파드 수를 결정하는 공식은 의외로 간단합니다.

```
원하는 레플리카 수 = ceil(현재 레플리카 수 x (현재 CPU / 목표 CPU))
```

`ceil`은 올림 함수입니다. 2.1이면 3으로 올립니다.
파드는 0.1개를 띄울 수 없으니까요.

### 예시: nginx HPA 시뮬레이션

nginx의 설정: 최소 3개, 최대 10개, 목표 CPU 50%

**상황 1: 트래픽 폭증 -- CPU 90%**
```
원하는 수 = ceil(3 x (90 / 50))
         = ceil(3 x 1.8)
         = ceil(5.4)
         = 6개
```
현재 3개 → 6개로 스케일 업!

**상황 2: 트래픽 더 폭증 -- CPU 200%**
```
원하는 수 = ceil(6 x (200 / 50))
         = ceil(6 x 4)
         = ceil(24)
         = 24개... 하지만 최대가 10개이므로 → 10개
```
maxReplicas에 의해 10개로 제한됩니다.

**상황 3: 트래픽 감소 -- CPU 20%**
```
원하는 수 = ceil(10 x (20 / 50))
         = ceil(10 x 0.4)
         = ceil(4)
         = 4개
```
10개 → 4개로 스케일 다운!

**상황 4: 트래픽 거의 없음 -- CPU 5%**
```
원하는 수 = ceil(4 x (5 / 50))
         = ceil(4 x 0.1)
         = ceil(0.4)
         = 1개... 하지만 최소가 3개이므로 → 3개
```
minReplicas에 의해 3개 이하로는 줄지 않습니다.

---

## 우리 프로젝트의 5개 HPA 분석

### HPA 1: nginx -- 프론트 엔드의 문지기

> 파일: `manifests/hpa/nginx-hpa.yaml`

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: nginx-web-hpa
  namespace: demo
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: nginx-web                  # nginx-web 디플로이먼트를 제어
  minReplicas: 3                     # 최소 3개 (항상 3개는 유지)
  maxReplicas: 10                    # 최대 10개 (아무리 바빠도 10개까지만)
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 50     # 평균 CPU 50% 목표
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 30   # 30초간 안정 후 스케일 업
      policies:
        - type: Pods
          value: 2
          periodSeconds: 15            # 15초마다 최대 2개씩 추가
    scaleDown:
      stabilizationWindowSeconds: 120  # 2분간 안정 후 스케일 다운
```

각 필드를 뜯어보겠습니다.

| 필드 | 값 | 의미 |
|------|-----|------|
| `minReplicas` | 3 | 최소한 3개의 파드는 항상 유지 |
| `maxReplicas` | 10 | 아무리 트래픽이 많아도 10개까지만 |
| `averageUtilization` | 50 | 모든 파드의 평균 CPU가 50%가 되도록 조절 |
| `scaleUp.stabilizationWindowSeconds` | 30 | 스케일 업 전 30초간 상태를 지켜봄 |
| `scaleUp.policies` | 15초당 2개 | 한 번에 너무 많이 늘어나지 않도록 제한 |
| `scaleDown.stabilizationWindowSeconds` | 120 | 스케일 다운 전 2분간 상태를 지켜봄 |

### 왜 이게 필요한가?

nginx는 **사용자의 모든 요청이 가장 먼저 도착하는 곳**입니다.
가장 트래픽이 많은 서비스이므로, 스케일 범위가 3~10으로 가장 넓습니다.

**stabilizationWindow(안정화 기간)는 왜 있을까요?**

트래픽이 순간적으로 치솟았다가 바로 내려가는 경우가 있습니다
(예: 새해 자정, 이벤트 시작 순간).
안정화 기간 없이 즉시 반응하면, 파드를 늘렸다가 바로 줄이고,
다시 늘렸다가 줄이는 **플래핑(flapping)** 현상이 발생합니다.

```
안정화 기간 없음:       안정화 기간 있음:
파드 수                파드 수
10│ ╱╲ ╱╲ ╱╲          10│
  │╱  ╲╱  ╲╱            │      ╱──────╲
 3│                     3│─────╱        ╲─────
  └──────────            └──────────
     시간                      시간
```

안정화 기간이 있으면 "정말로 트래픽이 늘어난 건지" 확인한 후에 반응합니다.

스케일 업은 30초(빨리 대응해야 하니까), 스케일 다운은 120초(성급하게 줄이면 안 되니까)로
설정되어 있습니다. **올릴 때는 빠르게, 내릴 때는 신중하게.**

---

### HPA 2: httpbin -- API 서버

> 파일: `manifests/hpa/httpbin-hpa.yaml`

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: httpbin-hpa
  namespace: demo
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: httpbin
  minReplicas: 2
  maxReplicas: 6
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 50
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 30
    scaleDown:
      stabilizationWindowSeconds: 120
```

httpbin은 API 서버 역할을 합니다.
nginx보다는 트래픽이 적지만(nginx가 일부를 캐시하므로),
여전히 중요한 서비스이므로 최소 2개를 유지합니다.

| 서비스 | 최소 | 최대 | 이유 |
|--------|------|------|------|
| nginx | 3 | 10 | 모든 외부 요청을 받으므로 트래픽 최다 |
| httpbin | 2 | 6 | 내부 API 처리, nginx보다는 적은 트래픽 |

---

### HPA 3: redis -- 캐시 서버

> 파일: `manifests/hpa/redis-hpa.yaml`

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: redis-hpa
  namespace: demo
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: redis
  minReplicas: 1
  maxReplicas: 4
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 50
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 30
    scaleDown:
      stabilizationWindowSeconds: 120
```

Redis는 인메모리 캐시 서버로, 매우 빠르게 동작합니다.
CPU를 많이 쓰는 편이 아니라서 최소 1개, 최대 4개로 설정했습니다.

---

### HPA 4: postgres -- 데이터베이스

> 파일: `manifests/hpa/postgres-hpa.yaml`

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: postgres-hpa
  namespace: demo
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: postgres
  minReplicas: 1
  maxReplicas: 4
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 50
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 30
    scaleDown:
      stabilizationWindowSeconds: 120
```

### 실제 프로젝트에서는

데이터베이스의 HPA는 실제 프로덕션에서는 **신중하게 적용**해야 합니다.
웹 서버와 달리 데이터베이스는 "데이터"를 가지고 있기 때문입니다.

파드를 늘리면 데이터 복제(Replication)가 필요하고,
파드를 줄이면 데이터 손실 위험이 있습니다.
실제 환경에서는 StatefulSet + 전용 오퍼레이터(예: PostgreSQL Operator)를
사용하여 더 세밀하게 관리합니다.

우리 프로젝트에서는 데모 목적으로 HPA를 적용했지만,
이러한 제약 사항을 이해하는 것이 중요합니다.

---

### HPA 5: rabbitmq -- 메시지 큐

> 파일: `manifests/hpa/rabbitmq-hpa.yaml`

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: rabbitmq-hpa
  namespace: demo
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: rabbitmq
  minReplicas: 1
  maxReplicas: 3
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 50
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 30
    scaleDown:
      stabilizationWindowSeconds: 120
```

RabbitMQ는 메시지를 임시 저장하고 전달하는 역할입니다.
메시지 큐의 특성상 많은 인스턴스가 필요하지 않아서 최대 3개로 제한했습니다.

### 5개 HPA 전체 비교

```
서비스별 스케일 범위:

nginx     ███████████████████████████████  3 ──────────── 10
httpbin   ████████████████████             2 ──────── 6
redis     ███████████████                  1 ────── 4
postgres  ███████████████                  1 ────── 4
rabbitmq  ██████████                       1 ──── 3
```

| 서비스 | 최소 | 최대 | 목표 CPU | 스케일 업 대기 | 스케일 다운 대기 |
|--------|------|------|----------|----------------|------------------|
| nginx | 3 | 10 | 50% | 30초 | 120초 |
| httpbin | 2 | 6 | 50% | 30초 | 120초 |
| redis | 1 | 4 | 50% | 30초 | 120초 |
| postgres | 1 | 4 | 50% | 30초 | 120초 |
| rabbitmq | 1 | 3 | 50% | 30초 | 120초 |

모든 HPA가 **동일한 목표 CPU(50%)와 안정화 기간**을 사용합니다.
차이점은 **최소/최대 레플리카 수**뿐입니다.
트래픽을 가장 많이 받는 nginx가 범위가 가장 넓고,
내부에서만 사용되는 rabbitmq가 가장 좁습니다.

---

## PDB (Pod Disruption Budget)란?

### 비유: 병원의 최소 의사 수

병원에 의사가 5명 있습니다.
건물 리모델링을 위해 일부 진료실을 폐쇄해야 합니다.
하지만 **최소 2명의 의사는 항상 근무해야** 합니다.
환자가 왔는데 의사가 한 명도 없으면 큰 문제니까요.

PDB(Pod Disruption Budget)가 정확히 이 역할을 합니다.

> "유지보수(노드 업그레이드, 패치 등)를 하더라도,
> **최소 N개의 파드는 항상 살아있어야 한다**"

### 왜 이게 필요한가?

쿠버네티스에서는 다양한 이유로 파드가 종료될 수 있습니다.

- **노드 업그레이드**: 노드의 OS를 업데이트하기 위해 파드를 이동시킨다
- **클러스터 축소**: 비용 절감을 위해 노드를 줄인다
- **노드 유지보수**: 하드웨어 점검을 위해 노드를 잠시 내린다

이때 쿠버네티스는 `kubectl drain` 명령으로 노드의 파드를 다른 곳으로 옮깁니다.
PDB가 없으면 한 서비스의 **모든 파드가 동시에** 종료될 수 있습니다.

```
PDB 없음:                        PDB 있음 (minAvailable: 2):

drain 시작                        drain 시작
  nginx-1 ❌ 종료                   nginx-1 ❌ 종료
  nginx-2 ❌ 종료                   nginx-2 ✅ 유지 (대기)
  nginx-3 ❌ 종료                   nginx-3 ✅ 유지 (대기)
  → 서비스 완전 중단!                 → 서비스 계속 동작!
                                    nginx-4 ✅ 다른 노드에 새로 생성
                                    nginx-2 ❌ 종료 (nginx-4가 Ready 된 후)
                                    → 항상 최소 2개는 유지
```

---

## 우리 프로젝트의 6개 PDB 분석

### PDB 1: nginx -- 최소 2개 유지

> 파일: `manifests/hpa/pdb-nginx.yaml`

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: nginx-web-pdb
  namespace: demo
spec:
  minAvailable: 2              # 최소 2개는 항상 살아있어야 함
  selector:
    matchLabels:
      app: nginx-web           # nginx-web 파드에 적용
```

nginx는 사용자 요청을 가장 먼저 받는 서비스입니다.
유지보수 중에도 **최소 2개의 nginx 파드**가 항상 동작해야 합니다.

HPA의 minReplicas(3)와 PDB의 minAvailable(2)의 관계:
- 평소: HPA가 최소 3개를 유지
- 유지보수 시: 1개까지 줄어들 수 있지만, 2개 미만으로는 절대 줄지 않음

---

### PDB 2~6: 나머지 서비스들

> 파일: `manifests/hpa/pdb-httpbin.yaml`, `pdb-redis.yaml`, `pdb-postgres.yaml`, `pdb-rabbitmq.yaml`, `pdb-keycloak.yaml`

```yaml
# httpbin-pdb
spec:
  minAvailable: 1
  selector:
    matchLabels:
      app: httpbin

# redis-pdb
spec:
  minAvailable: 1
  selector:
    matchLabels:
      app: redis

# postgres-pdb
spec:
  minAvailable: 1
  selector:
    matchLabels:
      app: postgres

# rabbitmq-pdb
spec:
  minAvailable: 1
  selector:
    matchLabels:
      app: rabbitmq

# keycloak-pdb
spec:
  minAvailable: 1
  selector:
    matchLabels:
      app: keycloak
```

nginx를 제외한 나머지 5개 서비스는 모두 `minAvailable: 1`입니다.
유지보수 중에도 **최소 1개의 파드는 반드시 살아있어야** 합니다.

### 6개 PDB 요약

| 서비스 | PDB 이름 | minAvailable | HPA minReplicas | 이유 |
|--------|----------|-------------|-----------------|------|
| nginx | nginx-web-pdb | **2** | 3 | 외부 트래픽의 진입점, 절대 중단 불가 |
| httpbin | httpbin-pdb | 1 | 2 | API 처리 서비스 |
| redis | redis-pdb | 1 | 1 | 캐시 서버 |
| postgres | postgres-pdb | 1 | 1 | 데이터베이스 |
| rabbitmq | rabbitmq-pdb | 1 | 1 | 메시지 큐 |
| keycloak | keycloak-pdb | 1 | - | 인증 서버 |

nginx만 minAvailable이 2인 이유는 **고가용성(High Availability)** 때문입니다.
nginx가 1개로 줄었을 때 그 1개마저 문제가 생기면 서비스가 완전히 중단됩니다.
2개를 유지하면, 1개에 문제가 생겨도 나머지 1개가 트래픽을 처리할 수 있습니다.

---

## HPA와 PDB의 관계

HPA와 PDB는 각각 다른 상황에서 파드 수를 관리합니다.

```
┌──────────────────────────────────────────┐
│              HPA의 영역                   │
│   "트래픽에 따라 파드 수를 조절한다"        │
│                                          │
│   최소(min) ◀━━━━━━━━━━━▶ 최대(max)       │
│      3          현재 5          10        │
│                                          │
│   ┌──────────────────┐                   │
│   │    PDB의 영역     │                   │
│   │ "유지보수 중에도   │                   │
│   │  최소 N개 보장"   │                   │
│   │     min: 2       │                   │
│   └──────────────────┘                   │
└──────────────────────────────────────────┘
```

- **HPA**: "지금 CPU가 높으니 파드를 5개에서 8개로 늘려야겠다" (평시 운영)
- **PDB**: "노드 업그레이드 중인데, 파드를 2개 미만으로 줄이면 안 된다" (유지보수 시)

둘은 서로 다른 역할이지만, **함께 사용해야 완전한 보호**가 됩니다.

---

## 실시간으로 스케일링 관찰하기

### HPA 상태 확인

```bash
# 현재 HPA 상태 보기
kubectl -n demo get hpa

# 출력 예시:
# NAME            REFERENCE              TARGETS   MINPODS   MAXPODS   REPLICAS   AGE
# nginx-web-hpa   Deployment/nginx-web   23%/50%   3         10        3          2d
# httpbin-hpa     Deployment/httpbin     15%/50%   2         6         2          2d
# redis-hpa       Deployment/redis       8%/50%    1         4         1          2d
# postgres-hpa    Deployment/postgres    12%/50%   1         4         1          2d
# rabbitmq-hpa    Deployment/rabbitmq    5%/50%    1         3         1          2d
```

각 컬럼의 의미:
| 컬럼 | 예시 | 의미 |
|------|------|------|
| TARGETS | 23%/50% | 현재 CPU 23%, 목표 50% |
| MINPODS | 3 | 최소 파드 수 |
| MAXPODS | 10 | 최대 파드 수 |
| REPLICAS | 3 | 현재 실제 파드 수 |

### 실시간 모니터링

```bash
# -w 옵션: 변경이 생길 때마다 실시간으로 업데이트
kubectl -n demo get hpa -w

# 트래픽 부하를 주면 이런 변화를 관찰할 수 있습니다:
# NAME            TARGETS   REPLICAS
# nginx-web-hpa   23%/50%   3          ← 평소
# nginx-web-hpa   65%/50%   3          ← CPU 상승 감지
# nginx-web-hpa   65%/50%   5          ← 스케일 업! (30초 후)
# nginx-web-hpa   42%/50%   5          ← 파드 추가로 CPU 분산
# nginx-web-hpa   35%/50%   5          ← 안정화
# nginx-web-hpa   35%/50%   4          ← 스케일 다운 (120초 후)
```

### PDB 상태 확인

```bash
# PDB 상태 보기
kubectl -n demo get pdb

# 출력 예시:
# NAME            MIN AVAILABLE   MAX UNAVAILABLE   ALLOWED DISRUPTIONS   AGE
# nginx-web-pdb   2               N/A               1                     2d
# httpbin-pdb     1               N/A               1                     2d
# redis-pdb       1               N/A               0                     2d
# postgres-pdb    1               N/A               0                     2d
# rabbitmq-pdb    1               N/A               0                     2d
# keycloak-pdb    1               N/A               0                     2d
```

| 컬럼 | 의미 |
|------|------|
| MIN AVAILABLE | 최소한 이만큼은 항상 살아있어야 함 |
| ALLOWED DISRUPTIONS | 지금 안전하게 종료할 수 있는 파드 수 |

nginx의 ALLOWED DISRUPTIONS가 1이라는 것은:
현재 3개 중 1개를 안전하게 종료해도 minAvailable(2)을 유지할 수 있다는 뜻입니다.

redis의 ALLOWED DISRUPTIONS가 0이라는 것은:
현재 1개인데 minAvailable이 1이므로, 단 하나도 종료할 수 없다는 뜻입니다.
노드 drain을 시도하면 redis 파드의 종료가 **보류**됩니다.

---

## 실제 프로젝트에서는

### HPA와 함께 자주 쓰이는 설정들

실제 프로덕션에서는 HPA와 함께 다음 설정들을 같이 사용합니다.

**1. Resource Requests/Limits (리소스 요청/제한)**
```yaml
resources:
  requests:
    cpu: 100m      # "최소 이만큼의 CPU를 보장해주세요"
    memory: 128Mi  # "최소 이만큼의 메모리를 보장해주세요"
  limits:
    cpu: 500m      # "최대 이만큼의 CPU만 쓸 수 있습니다"
    memory: 256Mi  # "최대 이만큼의 메모리만 쓸 수 있습니다"
```

HPA의 CPU 퍼센트는 `requests` 기준입니다.
requests가 100m이고 현재 50m을 쓰고 있으면 CPU 50%입니다.
requests가 없으면 HPA가 퍼센트를 계산할 수 없습니다.

**2. 다중 메트릭 HPA**
```yaml
metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 50
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
```

CPU와 메모리 두 가지 메트릭을 동시에 사용할 수 있습니다.
둘 중 하나라도 목표를 초과하면 스케일 업합니다.

**3. 커스텀 메트릭 HPA**

CPU/메모리 외에 "초당 요청 수", "큐의 메시지 수" 등
사용자 정의 메트릭을 기준으로 스케일링할 수도 있습니다.
Prometheus + KEDA 같은 도구를 조합하면 가능합니다.

---

## 핵심 요약

| 개념 | 한 줄 정리 |
|------|-----------|
| 오토스케일링 | 트래픽에 따라 서버(파드) 수를 자동으로 조절 |
| HPA | 수평적으로 파드 수를 늘리고 줄이는 오토스케일러 |
| metrics-server | 파드의 CPU/메모리 사용량을 수집하는 도구 (HPA의 눈) |
| HPA 공식 | ceil(현재 수 x 현재 CPU / 목표 CPU) |
| minReplicas | 아무리 한가해도 이 수 이하로 줄지 않음 |
| maxReplicas | 아무리 바빠도 이 수 이상으로 늘지 않음 |
| stabilizationWindow | 스케일링 전 "정말 필요한지" 확인하는 대기 시간 |
| PDB | 유지보수 중에도 최소한 보장해야 하는 파드 수 |
| minAvailable | PDB에서 "최소 이만큼은 살아있어야 한다"는 값 |
| 스케일 업 | 빠르게 (30초) -- 서비스 장애를 막기 위해 |
| 스케일 다운 | 신중하게 (120초) -- 성급한 축소를 막기 위해 |

---

## 관련 파일

```
manifests/hpa/
  ├── nginx-hpa.yaml       ← nginx HPA (3~10개, CPU 50%)
  ├── httpbin-hpa.yaml     ← httpbin HPA (2~6개, CPU 50%)
  ├── redis-hpa.yaml       ← redis HPA (1~4개, CPU 50%)
  ├── postgres-hpa.yaml    ← postgres HPA (1~4개, CPU 50%)
  ├── rabbitmq-hpa.yaml    ← rabbitmq HPA (1~3개, CPU 50%)
  ├── pdb-nginx.yaml       ← nginx PDB (최소 2개 유지)
  ├── pdb-httpbin.yaml     ← httpbin PDB (최소 1개 유지)
  ├── pdb-redis.yaml       ← redis PDB (최소 1개 유지)
  ├── pdb-postgres.yaml    ← postgres PDB (최소 1개 유지)
  ├── pdb-rabbitmq.yaml    ← rabbitmq PDB (최소 1개 유지)
  └── pdb-keycloak.yaml    ← keycloak PDB (최소 1개 유지)
```

---

> **이전 글**: [08. 네트워크 보안 -- 제로 트러스트와 CiliumNetworkPolicy](08-network-security.md)
>
> 이번 글에서 오토스케일링과 파드 보호를 다뤘습니다.
> 이제 우리 인프라는 자동으로 배포되고(CI/CD), 안전하게 보호되고(네트워크 보안),
> 트래픽에 따라 자동으로 확장됩니다(오토스케일링).
