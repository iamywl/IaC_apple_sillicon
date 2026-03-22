# Day 6: 고가용성, 트러블슈팅, 실전 대시보드

> Grafana HA 구성 방법, 자주 발생하는 문제 해결 가이드, 실전 대시보드 설계 패턴을 학습한다.

## 13장: 고가용성 (HA)

### 13.1 HA 아키텍처

```
                    ┌───────────────┐
                    │  Load Balancer │
                    │  (Ingress)    │
                    └───────┬───────┘
                            │
              ┌─────────────┼─────────────┐
              │             │             │
        ┌─────▼─────┐ ┌─────▼─────┐ ┌─────▼─────┐
        │ Grafana 1 │ │ Grafana 2 │ │ Grafana 3 │
        │ (Active)  │ │ (Active)  │ │ (Active)  │
        └─────┬─────┘ └─────┬─────┘ └─────┬─────┘
              │             │             │
              └─────────────┼─────────────┘
                            │
                    ┌───────▼───────┐
                    │  PostgreSQL   │
                    │  (Shared DB)  │
                    └───────────────┘
```

### 13.2 HA 필수 조건

| 구성 요소 | 요구 사항 | 설명 |
|----------|----------|------|
| Database | PostgreSQL 또는 MySQL (공유) | 모든 인스턴스가 같은 DB에 연결해야 한다 |
| Session Storage | Redis 또는 DB | 사용자 세션을 공유 저장소에 저장한다 |
| Cache | Redis 또는 Memcached | 쿼리 캐시를 공유한다 |
| Alerting | HA 모드 활성화 | 알림 평가를 분산하고 중복을 방지한다 |
| Provisioning | 동일 설정 | 모든 인스턴스에 같은 provisioning 파일을 배포한다 |
| Plugin | 동일 플러그인 | 모든 인스턴스에 같은 플러그인을 설치한다 |

### 13.3 grafana.ini HA 설정

```ini
# Database (공유 필수)
[database]
type = postgres
host = postgres-ha.monitoring.svc.cluster.local:5432
name = grafana
user = grafana
password = ${GF_DATABASE_PASSWORD}

# Session (Redis 공유)
[session]
provider = redis
provider_config = addr=redis.monitoring.svc.cluster.local:6379,pool_size=100,prefix=grafana

# Unified Alerting HA
[unified_alerting]
enabled = true
ha_listen_address = "${POD_IP}:9094"
ha_peers = "grafana-0.grafana-headless:9094,grafana-1.grafana-headless:9094,grafana-2.grafana-headless:9094"
ha_peer_timeout = 15s
ha_gossip_interval = 200ms
ha_push_pull_interval = 60s

# Live (실시간 이벤트 공유)
[live]
ha_engine = redis
ha_engine_address = redis.monitoring.svc.cluster.local:6379

# Caching (Redis 공유)
[caching]
backend = redis

[caching.redis]
url = redis://redis.monitoring.svc.cluster.local:6379/1
```

### 13.4 Kubernetes HA 배포

```yaml
# Grafana HA Helm values
grafana:
  replicas: 3

  persistence:
    enabled: false             # 공유 DB 사용 시 로컬 persistence 불필요

  env:
    GF_DATABASE_TYPE: postgres
    GF_DATABASE_HOST: postgres.monitoring.svc.cluster.local:5432
    GF_DATABASE_NAME: grafana
    GF_DATABASE_USER: grafana
    GF_DATABASE_PASSWORD:
      valueFrom:
        secretKeyRef:
          name: grafana-db-secret
          key: password

  envFromSecret: grafana-env-secret

  # Headless service for HA alerting peer discovery
  headlessService: true

  # Anti-affinity for HA
  affinity:
    podAntiAffinity:
      preferredDuringSchedulingIgnoredDuringExecution:
        - weight: 100
          podAffinityTerm:
            labelSelector:
              matchExpressions:
                - key: app.kubernetes.io/name
                  operator: In
                  values: ["grafana"]
            topologyKey: kubernetes.io/hostname

  # Liveness/Readiness probes
  livenessProbe:
    httpGet:
      path: /api/health
      port: 3000
    initialDelaySeconds: 60
    timeoutSeconds: 30
  readinessProbe:
    httpGet:
      path: /api/health
      port: 3000
```

### 13.5 Unified Alerting HA

Unified Alerting HA에서는 Gossip 프로토콜(Memberlist)을 사용하여 인스턴스 간 알림 상태를 동기화한다:

```
┌────────────┐     Gossip      ┌────────────┐     Gossip      ┌────────────┐
│ Grafana 1  │◀──────────────▶│ Grafana 2  │◀──────────────▶│ Grafana 3  │
│            │    (port 9094)  │            │    (port 9094)  │            │
│ Scheduler  │                │ Scheduler  │                │ Scheduler  │
│ ┌────────┐ │                │ ┌────────┐ │                │ ┌────────┐ │
│ │Rule A  │ │                │ │Rule B  │ │                │ │Rule C  │ │
│ │Rule D  │ │                │ │Rule E  │ │                │ │Rule F  │ │
│ └────────┘ │                │ └────────┘ │                │ └────────┘ │
└────────────┘                └────────────┘                └────────────┘
```

- 각 인스턴스는 전체 Alert Rule의 서브셋만 평가한다
- Gossip으로 알림 상태를 공유하여 중복 알림을 방지한다
- 한 인스턴스가 다운되면 다른 인스턴스가 해당 Rule을 인수한다

---

## 14장: 트러블슈팅

### 14.1 느린 대시보드 디버깅

```
문제: 대시보드 로딩이 10초 이상 걸린다

진단 단계:
1. 브라우저 DevTools > Network 탭
   - /api/ds/query 요청의 응답 시간 확인
   - 가장 느린 쿼리 식별

2. Grafana UI > Panel > Query Inspector
   - "Query" 탭에서 실제 전송된 쿼리 확인
   - "Stats" 탭에서 쿼리 실행 시간 확인

3. Prometheus 직접 쿼리
   export KUBECONFIG=kubeconfig/platform.yaml
   kubectl port-forward -n monitoring svc/kube-prometheus-stack-prometheus 9090:9090
   # Prometheus UI에서 동일 쿼리 실행하여 순수 쿼리 시간 측정

4. 원인별 해결:
   a. 복잡한 PromQL → Recording Rule로 사전 계산
   b. 너무 넓은 시간 범위 → 기본 시간 범위 축소
   c. 너무 많은 시리즈 → label filter 추가, topk() 사용
   d. 너무 많은 패널 → Row로 그룹핑 후 접기
   e. Resolution이 1/1 → 1/2 또는 1/3으로 변경
```

### 14.2 Data Source 연결 문제

```
문제: "Error reading Prometheus: Post http://prometheus:9090/api/v1/query: dial tcp: lookup prometheus on 10.96.0.10:53: no such host"

진단 단계:
1. DNS 확인
   export KUBECONFIG=kubeconfig/platform.yaml
   kubectl exec -n monitoring deploy/kube-prometheus-stack-grafana -- nslookup kube-prometheus-stack-prometheus.monitoring.svc.cluster.local

2. 서비스 확인
   kubectl get svc -n monitoring | grep prometheus

3. 네트워크 연결 확인
   kubectl exec -n monitoring deploy/kube-prometheus-stack-grafana -- wget -qO- http://kube-prometheus-stack-prometheus.monitoring.svc.cluster.local:9090/api/v1/status/config

4. 원인별 해결:
   a. DNS 해석 실패 → 서비스 이름/네임스페이스 확인
   b. 연결 거부 → 서비스 포트 확인, Pod 상태 확인
   c. 타임아웃 → Network Policy 확인, Pod 리소스 부족 확인
   d. 인증 실패 → 인증 정보(Basic Auth, Bearer Token) 확인
```

### 14.3 Rendering 문제

```
문제: 대시보드에서 이미지 렌더링(Share > Link)이 작동하지 않는다

원인과 해결:
1. Image Renderer 플러그인 미설치
   → grafana-image-renderer 플러그인 설치 또는 Remote Rendering 서비스 배포

2. 메모리 부족으로 렌더링 실패
   → Grafana Pod의 메모리 limit 증가
   → grafana-image-renderer의 리소스 증가

3. 렌더링 타임아웃
   # grafana.ini
   [rendering]
   server_url = http://grafana-image-renderer:8081/render
   callback_url = http://grafana:3000/
   concurrent_render_request_limit = 10
```

### 14.4 로그 분석

```bash
# Grafana 로그 확인
export KUBECONFIG=kubeconfig/platform.yaml

# Pod 로그 조회
kubectl logs -n monitoring deploy/kube-prometheus-stack-grafana -c grafana --tail=100

# 에러 로그만 필터링
kubectl logs -n monitoring deploy/kube-prometheus-stack-grafana -c grafana | grep -i error

# 실시간 로그 모니터링
kubectl logs -n monitoring deploy/kube-prometheus-stack-grafana -c grafana -f

# 로그 레벨 변경 (grafana.ini)
# [log]
# level = debug           # debug, info, warn, error, critical
# mode = console          # console, file, syslog
# filters = rendering:debug  # 특정 모듈만 debug
```

#### 주요 로그 패턴과 의미

| 로그 패턴 | 의미 | 조치 |
|----------|------|------|
| `Database locked` | SQLite 동시 쓰기 충돌 | PostgreSQL/MySQL로 전환 |
| `Request Completed` + `status=500` | 내부 서버 에러 | 상세 에러 메시지 확인 |
| `Datasource request error` | 데이터소스 연결 실패 | 데이터소스 URL, 인증 확인 |
| `Alert Rule evaluation error` | 알림 규칙 평가 실패 | 쿼리 구문 오류, 데이터소스 확인 |
| `Plugin failed to load` | 플러그인 로드 실패 | 플러그인 버전 호환성, 서명 확인 |
| `Max retries reached` | 데이터소스 재시도 초과 | 데이터소스 건강 상태 확인 |
| `OOM killed` | 메모리 부족으로 프로세스 종료 | 메모리 limit 증가 |

### 14.5 일반적인 문제와 해결

| 문제 | 원인 | 해결 |
|------|------|------|
| 로그인 후 빈 페이지 | 쿠키 문제, Reverse Proxy 설정 | `[server] root_url` 설정 확인, 쿠키 삭제 |
| 변수 드롭다운이 비어있음 | 변수 쿼리 실패 | Query Inspector로 변수 쿼리 확인 |
| "Panel plugin not found" | 플러그인 미설치 | `grafana-cli plugins install <id>` |
| 대시보드 저장 실패 | 권한 부족, Provisioned 대시보드 | 사용자 권한 확인, `allowUiUpdates` 확인 |
| 시간대가 맞지 않음 | 서버/브라우저 시간대 불일치 | Dashboard Settings > Time zone 확인 |
| Annotation이 표시 안됨 | Annotation 쿼리 실패 | Annotation 데이터소스/쿼리 확인 |

---

## 15장: 실전 대시보드

### 15.1 Kubernetes Cluster Monitoring Dashboard

이 프로젝트의 platform 클러스터를 모니터링하는 대시보드이다:

```
┌────────────────────────────────────────────────────────────────┐
│ Kubernetes Cluster Monitoring    [$cluster: platform]          │
├───────┬──────────┬──────────┬──────────┬──────────┬───────────┤
│ Nodes │ Pods     │ CPU      │ Memory   │ Disk     │ Alerts    │
│  3    │ Running  │ Usage    │ Usage    │ Usage    │ Firing    │
│       │  47      │  62%     │  71%     │  45%     │  2        │
├───────┴──────────┴──────────┴──────────┴──────────┴───────────┤
│ Node CPU Usage (%)                                             │
│ ┌────────────────────────────────────────────────────────────┐ │
│ │ platform-cp:    ████████████░░░░░░░░ 62%                  │ │
│ │ platform-w1:    ██████████████░░░░░░ 71%                  │ │
│ │ platform-w2:    █████████░░░░░░░░░░░ 45%                  │ │
│ └────────────────────────────────────────────────────────────┘ │
├──────────────────────────────┬─────────────────────────────────┤
│ CPU Usage Over Time          │ Memory Usage Over Time          │
│ ┌──────────────────────────┐ │ ┌───────────────────────────┐  │
│ │   ╱╲    ╱──╲             │ │ │ ────────────────────────  │  │
│ │  ╱  ╲──╱    ╲──          │ │ │                           │  │
│ │ ╱              ╲         │ │ │ ──────────────────────    │  │
│ └──────────────────────────┘ │ └───────────────────────────┘  │
├──────────────────────────────┼─────────────────────────────────┤
│ Pod Status by Namespace      │ Container Restarts (1h)         │
│ ┌──────────────────────────┐ │ ┌───────────────────────────┐  │
│ │ monitoring:  15 Running  │ │ │ alertmanager-0:        2  │  │
│ │ kube-system: 12 Running  │ │ │ prometheus-0:          0  │  │
│ │ default:      8 Running  │ │ │ grafana-abc:           0  │  │
│ │ argocd:       5 Running  │ │ │                           │  │
│ └──────────────────────────┘ │ └───────────────────────────┘  │
└──────────────────────────────┴─────────────────────────────────┘
```

#### 주요 PromQL 쿼리

```promql
# --- Row 1: Stat Panels ---

# 노드 수
count(kube_node_info)

# Running Pod 수
count(kube_pod_status_phase{phase="Running"})

# 클러스터 전체 CPU 사용률
100 - (avg(rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)

# 클러스터 전체 메모리 사용률
(1 - sum(node_memory_MemAvailable_bytes) / sum(node_memory_MemTotal_bytes)) * 100

# 클러스터 전체 디스크 사용률
(1 - sum(node_filesystem_avail_bytes{mountpoint="/"}) / sum(node_filesystem_size_bytes{mountpoint="/"})) * 100

# Firing 알림 수
count(ALERTS{alertstate="firing"}) OR vector(0)

# --- Row 2: Node Bar Gauges ---

# 노드별 CPU 사용률
100 - (avg by(instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)

# --- Row 3: Time Series ---

# CPU 사용률 추이 (노드별)
100 - (avg by(instance) (rate(node_cpu_seconds_total{mode="idle"}[$__rate_interval])) * 100)
# Legend: {{instance}}

# 메모리 사용량 추이 (노드별)
(node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes)
# Legend: {{instance}}, Unit: bytes

# --- Row 4: Tables ---

# 네임스페이스별 Pod 상태
count by (namespace, phase) (kube_pod_status_phase)
# Table + Transformation: Organize fields

# 컨테이너 재시작 횟수 (최근 1시간)
sum by (namespace, pod) (increase(kube_pod_container_status_restarts_total[1h])) > 0
# Table, Sort by value descending
```

### 15.2 Application Monitoring Dashboard

마이크로서비스 애플리케이션의 RED(Rate, Errors, Duration) 메트릭을 모니터링한다:

```promql
# --- Request Rate (RPS) ---
sum(rate(http_requests_total{namespace="$namespace", service="$service"}[$__rate_interval])) by (method, status_code)

# --- Error Rate (%) ---
sum(rate(http_requests_total{namespace="$namespace", service="$service", status_code=~"5.."}[$__rate_interval]))
/
sum(rate(http_requests_total{namespace="$namespace", service="$service"}[$__rate_interval])) * 100

# --- Duration (Latency) p50/p90/p99 ---
histogram_quantile(0.50, sum(rate(http_request_duration_seconds_bucket{namespace="$namespace", service="$service"}[$__rate_interval])) by (le))
histogram_quantile(0.90, sum(rate(http_request_duration_seconds_bucket{namespace="$namespace", service="$service"}[$__rate_interval])) by (le))
histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket{namespace="$namespace", service="$service"}[$__rate_interval])) by (le))

# --- Apdex Score ---
# Apdex = (Satisfied + Tolerating/2) / Total
# Satisfied: < 0.5s, Tolerating: 0.5s - 2s, Frustrated: > 2s
(
  sum(rate(http_request_duration_seconds_bucket{le="0.5", namespace="$namespace"}[$__rate_interval]))
  +
  sum(rate(http_request_duration_seconds_bucket{le="2.0", namespace="$namespace"}[$__rate_interval]))
  -
  sum(rate(http_request_duration_seconds_bucket{le="0.5", namespace="$namespace"}[$__rate_interval]))
) / 2
/
sum(rate(http_request_duration_seconds_count{namespace="$namespace"}[$__rate_interval]))
```

### 15.3 SLO Dashboard

Service Level Objective를 추적하는 대시보드이다:

```
┌────────────────────────────────────────────────────────────┐
│ SLO Dashboard              [$service]    Period: [30 days] │
├────────────┬────────────┬────────────┬─────────────────────┤
│ Avail SLO  │ Latency SLO│ Error      │ Remaining Error     │
│ Target:    │ Target:    │ Budget     │ Budget              │
│ 99.9%      │ p99<500ms  │ Used: 43%  │ 24m 32s             │
│ Current:   │ Current:   │ ████░░░░░░ │                     │
│ 99.95%     │ 312ms      │            │                     │
├────────────┴────────────┴────────────┴─────────────────────┤
│ Error Budget Burn Rate (over time)                         │
│ ┌────────────────────────────────────────────────────────┐ │
│ │         /\                                             │ │
│ │ ───────/  \──────────────────────────  1.0 (budget=0)  │ │
│ │       /    \____                                       │ │
│ │ ────/           \________________________________      │ │
│ │                                                        │ │
│ └────────────────────────────────────────────────────────┘ │
├──────────────────────────────┬─────────────────────────────┤
│ Availability Over Time       │ Latency p99 Over Time       │
│ ┌──────────────────────────┐ │ ┌───────────────────────┐   │
│ │ ──────────────99.95%──── │ │ │ ──╱╲──────────────── │   │
│ │ ─ ─ ─ ─ ─ ─ 99.9% ─ ─  │ │ │ ─ ─ ─ 500ms ─ ─ ─ ─│   │
│ │          (SLO Target)    │ │ │     (SLO Target)     │   │
│ └──────────────────────────┘ │ └───────────────────────┘   │
└──────────────────────────────┴─────────────────────────────┘
```

```promql
# --- Availability (성공률) ---
# 30일 성공률
sum(rate(http_requests_total{service="$service",status_code!~"5.."}[$__range]))
/
sum(rate(http_requests_total{service="$service"}[$__range])) * 100

# --- Error Budget 계산 ---
# SLO = 99.9%, 30일 = 2,592,000초
# 허용 에러 시간 = 2,592,000 * 0.001 = 2,592초 = 43.2분

# Error Budget 소비율 (%)
(1 - (
  sum(rate(http_requests_total{service="$service",status_code!~"5.."}[$__range]))
  /
  sum(rate(http_requests_total{service="$service"}[$__range]))
)) / (1 - 0.999) * 100

# 남은 Error Budget (초)
(0.001 - (1 - (
  sum(rate(http_requests_total{service="$service",status_code!~"5.."}[$__range]))
  /
  sum(rate(http_requests_total{service="$service"}[$__range]))
))) * ($__range_s)

# --- Error Budget Burn Rate ---
# 1시간 윈도우의 burn rate
(
  sum(rate(http_requests_total{service="$service",status_code=~"5.."}[1h]))
  /
  sum(rate(http_requests_total{service="$service"}[1h]))
) / (1 - 0.999)
# burn rate > 1이면 SLO 초과 속도로 에러 발생 중

# --- Multi-window Burn Rate (Google SRE 권장) ---
# 짧은 윈도우 (5분) - 급격한 에러 감지
(
  sum(rate(http_requests_total{service="$service",status_code=~"5.."}[5m]))
  /
  sum(rate(http_requests_total{service="$service"}[5m]))
) / (1 - 0.999)

# 긴 윈도우 (1시간) - 지속적 에러 감지
(
  sum(rate(http_requests_total{service="$service",status_code=~"5.."}[1h]))
  /
  sum(rate(http_requests_total{service="$service"}[1h]))
) / (1 - 0.999)
```

### 15.4 Business Metrics Dashboard

기술 메트릭이 아닌 비즈니스 메트릭을 시각화하는 대시보드이다:

```promql
# --- 사용자 활동 ---
# 활성 사용자 수 (커스텀 메트릭)
sum(active_users_total{service="$service"})

# 초당 주문 수
sum(rate(orders_total{service="$service"}[$__rate_interval]))

# 매출액 (시간별)
sum(increase(revenue_total{service="$service",currency="KRW"}[1h]))

# --- 사용자 경험 ---
# Core Web Vitals (LCP)
histogram_quantile(0.75, sum(rate(web_vitals_lcp_bucket{service="$service"}[$__rate_interval])) by (le))

# 페이지 로드 시간 p95
histogram_quantile(0.95, sum(rate(page_load_duration_seconds_bucket{service="$service"}[$__rate_interval])) by (le))

# --- 리소스 비용 효율성 ---
# CPU 비용 효율 (요청 수 / CPU 사용량)
sum(rate(http_requests_total{service="$service"}[$__rate_interval]))
/
sum(rate(container_cpu_usage_seconds_total{namespace="$namespace"}[$__rate_interval]))

# 메모리 비용 효율 (요청 수 / 메모리 사용량 GB)
sum(rate(http_requests_total{service="$service"}[$__rate_interval]))
/
(sum(container_memory_working_set_bytes{namespace="$namespace"}) / 1073741824)
```

### 15.5 SRE Golden Signals 대시보드

Google SRE 방법론에서 정의한 4가지 Golden Signal을 하나의 대시보드로 구성하는 예제이다. 이 대시보드는 서비스의 전체 건강 상태를 한눈에 파악할 수 있게 한다.

```
┌──────────────────────────────────────────────────────────┐
│  Golden Signals Dashboard          [$namespace] [$service]│
├──────────────────────────┬───────────────────────────────┤
│  Latency (p50/p90/p99)   │  Traffic (RPS)               │
│  ┌────────────────────┐  │  ┌─────────────────────────┐ │
│  │    ╱╲    p99       │  │  │         ___             │ │
│  │   ╱  ╲   ────      │  │  │  ──────╱   ╲────       │ │
│  │  ╱    ╲  p90       │  │  │                         │ │
│  │ ╱──────╲──── p50   │  │  │                         │ │
│  └────────────────────┘  │  └─────────────────────────┘ │
├──────────────────────────┼───────────────────────────────┤
│  Errors (Rate %)         │  Saturation (CPU/Mem %)      │
│  ┌────────────────────┐  │  ┌─────────────────────────┐ │
│  │  ╱╲                │  │  │  CPU ████████░░ 78%     │ │
│  │ ╱  ╲___            │  │  │  Mem ██████░░░░ 62%     │ │
│  │╱       ╲           │  │  │  Disk █████████░ 91%    │ │
│  └────────────────────┘  │  └─────────────────────────┘ │
└──────────────────────────┴───────────────────────────────┘
```

#### 1. Latency (지연 시간) - Time Series Panel
```promql
# p50 레이턴시
histogram_quantile(0.50,
  sum(rate(http_request_duration_seconds_bucket{
    namespace="$namespace",
    service="$service"
  }[$__rate_interval])) by (le)
)

# p90 레이턴시
histogram_quantile(0.90,
  sum(rate(http_request_duration_seconds_bucket{
    namespace="$namespace",
    service="$service"
  }[$__rate_interval])) by (le)
)

# p99 레이턴시
histogram_quantile(0.99,
  sum(rate(http_request_duration_seconds_bucket{
    namespace="$namespace",
    service="$service"
  }[$__rate_interval])) by (le)
)
```
- Panel type: **Time series**
- Unit: `seconds (s)`
- Legend: `{{quantile}}`
- $__rate_interval을 사용하여 scrape interval보다 짧은 range vector를 방지한다

#### 2. Traffic (트래픽) - Time Series Panel
```promql
# 초당 요청 수 (RPS)
sum(rate(http_requests_total{
  namespace="$namespace",
  service="$service"
}[$__rate_interval])) by (method, code)
```
- Panel type: **Time series** (Stacked 모드)
- Unit: `requests/sec (reqps)`
- Legend: `{{method}} {{code}}`
- HTTP 상태 코드별로 색상을 구분하면 에러 비율을 시각적으로 파악할 수 있다

#### 3. Errors (에러율) - Stat + Time Series Panel
```promql
# 에러율 (%) - Stat Panel 용
sum(rate(http_requests_total{
  namespace="$namespace",
  service="$service",
  code=~"5.."
}[$__rate_interval]))
/
sum(rate(http_requests_total{
  namespace="$namespace",
  service="$service"
}[$__rate_interval])) * 100
```
- Panel type: **Stat** (현재 에러율 수치) + **Time series** (에러율 추이)
- Unit: `percent (0-100)`
- Thresholds: green(0) → yellow(1) → red(5)
- No data → 0%로 표시 (에러가 없는 정상 상태)

#### 4. Saturation (포화도) - Bar Gauge Panel
```promql
# CPU 사용률
sum(rate(container_cpu_usage_seconds_total{
  namespace="$namespace",
  pod=~"$service.*"
}[$__rate_interval]))
/
sum(kube_pod_container_resource_limits{
  namespace="$namespace",
  pod=~"$service.*",
  resource="cpu"
}) * 100

# 메모리 사용률
sum(container_memory_working_set_bytes{
  namespace="$namespace",
  pod=~"$service.*"
})
/
sum(kube_pod_container_resource_limits{
  namespace="$namespace",
  pod=~"$service.*",
  resource="memory"
}) * 100
```
- Panel type: **Bar gauge** (수평, LCD 모드)
- Unit: `percent (0-100)`
- Max: 100
- Thresholds: green(0) → yellow(70) → red(90)

---

