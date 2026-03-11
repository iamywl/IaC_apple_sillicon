# 07. 데모 앱, HPA, 부하 테스트

## 데모 앱 구성 (dev 클러스터)

### nginx-web (manifests/demo/nginx-app.yaml)

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nginx-web
  namespace: demo
spec:
  replicas: 3
  selector:
    matchLabels:
      app: nginx-web
  template:
    spec:
      containers:
        - name: nginx
          image: nginx:alpine
          resources:
            requests:
              cpu: 50m        # 최소 보장 CPU
              memory: 64Mi    # 최소 보장 메모리
            limits:
              cpu: 200m       # 최대 CPU
              memory: 128Mi   # 최대 메모리
          ports:
            - containerPort: 80
---
apiVersion: v1
kind: Service
metadata:
  name: nginx-web
spec:
  type: NodePort
  ports:
    - port: 80
      nodePort: 30080    # 외부 접속: http://<dev-worker>:30080
  selector:
    app: nginx-web
```

**역할**: HTTP 부하 테스트 대상. HPA로 3~10개 Pod 사이에서 오토스케일링.

### httpbin v1 (manifests/demo/httpbin-app.yaml)

```yaml
spec:
  replicas: 2
  template:
    spec:
      containers:
        - name: httpbin
          image: kong/httpbin:latest
          resources:
            requests: { cpu: 50m, memory: 64Mi }
  # Service: ClusterIP (클러스터 내부에서만 접근)
  # Istio VirtualService로 트래픽 라우팅
```

**역할**: REST API 테스트 서버. `/get`, `/post`, `/status/200` 등 다양한 엔드포인트 제공.

### httpbin v2 (manifests/istio/httpbin-v2.yaml)

```yaml
spec:
  replicas: 1
  template:
    metadata:
      labels:
        app: httpbin
        version: v2        # ← v1과 구분
```

**역할**: 카나리 배포 데모. Istio VirtualService가 20% 트래픽을 v2로 보냄.

### redis (manifests/demo/redis-app.yaml)

```yaml
spec:
  replicas: 1
  template:
    spec:
      containers:
        - name: redis
          image: redis:7-alpine
  # Service: ClusterIP, port 6379
```

**역할**: 캐시/세션 저장소. 네트워크 정책 데모용. HPA(1→4)로 오토스케일링.

### postgres (manifests/demo/postgres-app.yaml)

```yaml
spec:
  replicas: 1
  template:
    spec:
      containers:
        - name: postgres
          image: postgres:16-alpine
          env:
            - name: POSTGRES_DB
              value: demo
            - name: POSTGRES_USER
              value: demo
            - name: POSTGRES_PASSWORD
              value: demo123
          resources:
            requests: { cpu: 50m, memory: 64Mi }
            limits: { cpu: 200m, memory: 256Mi }
  # Service: ClusterIP, port 5432
```

**역할**: 3-Tier 아키텍처의 DB 계층. httpbin → postgres 통신으로 네트워크 정책 검증. Keycloak의 백엔드 DB로도 사용. HPA(1→4)로 오토스케일링.

### rabbitmq (manifests/demo/rabbitmq-app.yaml)

```yaml
spec:
  replicas: 1
  template:
    spec:
      containers:
        - name: rabbitmq
          image: rabbitmq:3-management-alpine
          ports:
            - containerPort: 5672    # AMQP
            - containerPort: 15672   # Management UI
          env:
            - name: RABBITMQ_DEFAULT_USER
              value: demo
          resources:
            requests: { cpu: 50m, memory: 128Mi }
            limits: { cpu: 300m, memory: 512Mi }
  # Service: ClusterIP, ports 5672 + 15672
```

**역할**: 비동기 메시지 브로커. httpbin(앱 계층)이 RabbitMQ에 메시지를 발행하는 구조. HPA(1→3)로 오토스케일링.

### keycloak (manifests/demo/keycloak-app.yaml)

```yaml
spec:
  replicas: 1
  template:
    spec:
      containers:
        - name: keycloak
          image: quay.io/keycloak/keycloak:latest
          args: ["start-dev"]
          env:
            - name: KC_DB
              value: postgres
            - name: KC_DB_URL
              value: jdbc:postgresql://postgres:5432/demo
          resources:
            requests: { cpu: 100m, memory: 256Mi }
            limits: { cpu: 500m, memory: 768Mi }
  # Service: NodePort 30880
```

**역할**: ID/인증 관리(Identity & Access Management) 서버. OAuth 2.0, SSO 제공. PostgreSQL을 백엔드 DB로 사용하여 실제 엔터프라이즈 인증 아키텍처를 재현.

### 전체 서비스 아키텍처

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

## HPA (Horizontal Pod Autoscaler)

### 설치 위치

```
scripts/install/11-install-hpa.sh        ← 설치 스크립트
manifests/metrics-server-values.yaml     ← metrics-server 설정
manifests/hpa/nginx-hpa.yaml             ← nginx HPA
manifests/hpa/httpbin-hpa.yaml           ← httpbin HPA
manifests/hpa/redis-hpa.yaml             ← redis HPA
manifests/hpa/postgres-hpa.yaml          ← postgres HPA
manifests/hpa/pdb-nginx.yaml             ← Pod Disruption Budget
manifests/hpa/pdb-httpbin.yaml           ← Pod Disruption Budget
manifests/hpa/pdb-redis.yaml             ← Pod Disruption Budget (minAvailable: 1)
manifests/hpa/pdb-postgres.yaml          ← Pod Disruption Budget (minAvailable: 1)
manifests/hpa/rabbitmq-hpa.yaml          ← rabbitmq HPA
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

노드 drain이나 스케일다운 시에도 최소 Pod 수를 보장합니다.

## 부하 테스트 (k6)

### k6란?

Go로 작성된 HTTP 부하 테스트 도구. JavaScript로 시나리오를 작성합니다.

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

CPU에 부하를 주어 HPA가 스케일업하는 것을 관찰합니다.

### 메모리 스트레스

```bash
stress-ng --vm 1 --vm-bytes 128M --timeout 30s
```

메모리를 할당하여 OOM 상황을 시뮬레이션합니다.

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
