# Day 1: 개념, 아키텍처 심화, 데이터 모델

> Prometheus의 기본 개념, 메트릭 유형(Counter/Gauge/Histogram/Summary), 실습 환경 설정, 내부 아키텍처 컴포넌트, 그리고 시계열 데이터 모델의 심화 구조를 학습한다.

## 개념

### Prometheus란?
- 시계열(Time Series) 메트릭 수집 및 저장 시스템이다 (CNCF Graduated, 2016년 두 번째 졸업 프로젝트)
- SoundCloud에서 2012년에 시작되었고, Google의 Borgmon에서 영감을 받아 설계되었다
- Pull 모델을 사용하여 타겟의 `/metrics` HTTP 엔드포인트에서 메트릭을 수집한다
- PromQL이라는 함수형 쿼리 언어를 제공하여 다차원 데이터 분석이 가능하다
- 자체 TSDB(Time Series Database)에 메트릭을 로컬 디스크에 저장한다
- 단일 서버로도 초당 수백만 개의 시계열 샘플을 수집할 수 있을 만큼 고성능이다
- 외부 분산 스토리지에 의존하지 않으므로 운영이 단순하다

### 핵심 개념
| 개념 | 설명 |
|------|------|
| Pull 모델 | Prometheus가 타겟의 `/metrics` 엔드포인트를 주기적으로 스크래핑한다 |
| Scrape | 타겟에서 메트릭을 수집하는 행위이다. scrape_interval(기본 1분)마다 수행된다 |
| TSDB | 시계열 데이터 저장소로, WAL과 블록 기반 구조로 구성된다 |
| Exporter | 메트릭을 Prometheus 형식(OpenMetrics)으로 노출하는 컴포넌트이다 |
| PromQL | Prometheus 전용 함수형 쿼리 언어이다. instant vector와 range vector를 다룬다 |
| ServiceMonitor | Kubernetes CRD로, Prometheus Operator가 스크래핑 타겟을 선언적으로 관리하게 한다 |
| Recording Rule | 자주 사용하는 복잡한 쿼리를 미리 계산하여 새로운 시계열로 저장하는 규칙이다 |
| Alert Rule | PromQL 표현식이 조건을 충족하면 Alertmanager로 알림을 전송하는 규칙이다 |
| Target | Prometheus가 스크래핑하는 모니터링 대상 엔드포인트이다 |
| Job | 동일한 목적의 타겟 그룹이다. 예: `job="node-exporter"` |
| Instance | 스크래핑할 수 있는 개별 엔드포인트이다. `host:port` 형태이다 |
| Label | 시계열을 식별하는 키-값 쌍이다. 다차원 데이터 모델의 핵심이다 |

### 메트릭 유형
| 타입 | 설명 | 예시 | 특징 |
|------|------|------|------|
| Counter | 단조 증가하는 누적 값이다 | `http_requests_total` | 리셋 시 0으로 돌아간다. `rate()`와 함께 사용한다 |
| Gauge | 증가/감소 가능한 순간 값이다 | `node_memory_MemAvailable_bytes` | 현재 상태를 나타낸다. 그대로 사용 가능하다 |
| Histogram | 값의 분포를 버킷으로 나누어 기록한다 | `http_request_duration_seconds` | `_bucket`, `_count`, `_sum` 세 가지 시계열을 생성한다. 서버 사이드에서 quantile을 계산한다 |
| Summary | 클라이언트 사이드에서 분위수(quantile)를 계산한다 | `go_gc_duration_seconds` | `{quantile="0.5"}` 형태로 노출한다. 집계(aggregation)가 불가능하다는 단점이 있다 |

#### Histogram vs Summary
- Histogram은 서버 사이드에서 `histogram_quantile()` 함수로 분위수를 계산하므로, 여러 인스턴스의 데이터를 합산하여 전체 분위수를 구할 수 있다
- Summary는 클라이언트에서 이미 계산된 분위수를 노출하므로, 여러 인스턴스의 분위수를 합산하면 통계적으로 의미 없는 값이 나온다
- 일반적으로 Histogram을 권장한다. 다만 버킷 설정이 적절하지 않으면 정확도가 떨어질 수 있다

### 아키텍처
```
┌────────────────────────────────────────────────────────┐
│                   Prometheus Server                    │
│  ┌────────────┐  ┌──────────────────┐  ┌───────────┐  │
│  │  Retrieval  │  │      TSDB        │  │  PromQL   │  │
│  │  (Scraper)  │  │ ┌─────┐ ┌─────┐ │  │  Engine   │  │
│  │             │  │ │ WAL │ │Block│ │  │           │  │
│  │  Service    │  │ │     │ │Store│ │  │  HTTP     │  │
│  │  Discovery  │  │ └─────┘ └─────┘ │  │  Server   │  │
│  └──────┬──────┘  └────────────────┬─┘  └─────┬─────┘  │
│         │                         │           │        │
│  ┌──────▼──────┐           ┌──────▼──────┐    │        │
│  │ Rule Engine │           │Remote Write │    │        │
│  │ (Recording  │           │Remote Read  │    │        │
│  │  & Alerts)  │           └──────┬──────┘    │        │
│  └──────┬──────┘                  │           │        │
└─────────┼─────────────────────────┼───────────┼────────┘
          │ alerts                  │ remote    │ query
   ┌──────▼──────┐          ┌──────▼──────┐ ┌──▼──────┐
   │Alertmanager │          │Thanos/Mimir │ │ Grafana │
   └─────────────┘          │(장기 저장)   │ └─────────┘
                            └─────────────┘
scrape ──▶
┌─────────────────────────────────────┐
│            Targets                  │
│ ├── node-exporter     (노드 메트릭) │
│ ├── kube-state-metrics (K8s 상태)   │
│ ├── kubelet/cAdvisor  (컨테이너)    │
│ ├── cilium-agent      (네트워크)    │
│ └── 앱 /metrics 엔드포인트          │
└─────────────────────────────────────┘
```

---

### 이 프로젝트에서의 실습 환경

이 프로젝트에서 Prometheus는 platform 클러스터의 `monitoring` 네임스페이스에 배포된다.

- 설치 스크립트: `scripts/install/07-install-monitoring.sh`
- Helm Chart: `kube-prometheus-stack` (Prometheus + Grafana + AlertManager 통합)
- Helm values: `manifests/monitoring-values.yaml`
- 데이터 보존: 7일, 최대 10GB
- 실습 대상 클러스터: platform (`kubeconfig/platform.yaml`)

```bash
# platform 클러스터에서 Prometheus 접근
export KUBECONFIG=kubeconfig/platform.yaml
kubectl get pods -n monitoring -l app.kubernetes.io/name=prometheus
kubectl port-forward -n monitoring svc/kube-prometheus-stack-prometheus 9090:9090
# 브라우저에서 http://localhost:9090 접속
```

#### 프로젝트 Helm Values 상세 분석

이 프로젝트의 `manifests/monitoring-values.yaml`에서 Prometheus 관련 설정은 다음과 같다.

```yaml
prometheus:
  prometheusSpec:
    retention: 7d               # 7일간 데이터 보존
    resources:
      requests:
        cpu: 200m               # CPU 최소 요청량
        memory: 512Mi           # 메모리 최소 요청량
      limits:
        memory: 2Gi             # 메모리 상한 (OOM killer 방지)
    storageSpec:
      volumeClaimTemplate:
        spec:
          accessModes: ["ReadWriteOnce"]
          resources:
            requests:
              storage: 10Gi     # PVC 10GB 할당
```

- `retention: 7d`는 `--storage.tsdb.retention.time=7d` 플래그로 변환된다. 7일이 지난 블록은 자동 삭제된다
- `memory: 2Gi` limit은 활성 시계열 수가 약 50만~100만 개일 때 적합한 값이다. 시계열이 늘어나면 이 값을 증가시켜야 한다
- `storage: 10Gi`는 7일 retention과 함께 사용 시, 약 100만 활성 시계열에서 충분한 용량이다. Gorilla 압축 덕분에 샘플당 약 1.37바이트만 사용한다

#### NodePort 접근 정보

```bash
# Alertmanager는 NodePort 30903으로 접근 가능하다
# Grafana는 NodePort 30300으로 접근 가능하다
# Prometheus 자체는 NodePort가 설정되어 있지 않으므로 port-forward를 사용한다

# Worker 노드 IP 확인
kubectl get nodes -o wide

# 또는 NodePort 30090을 수동으로 설정할 수 있다
kubectl patch svc kube-prometheus-stack-prometheus -n monitoring \
  -p '{"spec": {"type": "NodePort", "ports": [{"port": 9090, "nodePort": 30090}]}}'
```

#### Alertmanager 설정 분석

이 프로젝트의 Alertmanager는 webhook 기반으로 설정되어 있다.

```yaml
alertmanager:
  config:
    route:
      group_by: ['alertname', 'namespace']  # 같은 알림+네임스페이스는 그룹핑
      group_wait: 30s                        # 첫 알림 대기 시간
      group_interval: 5m                     # 같은 그룹 재알림 간격
      repeat_interval: 12h                   # 동일 알림 반복 간격
      receiver: 'webhook-logger'
    receivers:
      - name: 'webhook-logger'
        webhook_configs:
          - url: 'http://alertmanager-webhook.monitoring.svc.cluster.local:8080/alert'
            send_resolved: true              # 해소 알림도 전송한다
    inhibit_rules:
      - source_matchers:
          - severity = critical              # critical 알림이 firing 중이면
        target_matchers:
          - severity = warning               # 같은 alertname/namespace의 warning을 억제한다
        equal: ['alertname', 'namespace']
```

---

## Prometheus 아키텍처 심화

### 내부 컴포넌트 상세

Prometheus Server는 내부적으로 여러 독립적인 컴포넌트가 협력하여 동작한다. 각 컴포넌트의 역할과 상호작용을 이해하면 트러블슈팅과 성능 튜닝에 큰 도움이 된다.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Prometheus Server 내부                           │
│                                                                         │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────────────┐   │
│  │ Config       │    │ Scrape       │    │        TSDB              │   │
│  │ Reloader     │───▶│ Manager      │───▶│  ┌───────┐  ┌────────┐  │   │
│  │              │    │              │    │  │  WAL  │  │ Head   │  │   │
│  │ SIGHUP /     │    │ - goroutine  │    │  │       │  │ Block  │  │   │
│  │ /-/reload    │    │   per target │    │  └───┬───┘  └───┬────┘  │   │
│  └──────┬───────┘    │ - SD 연동    │    │      │ replay   │ flush │   │
│         │            └──────────────┘    │      ▼          ▼       │   │
│         │                                │  ┌────────────────────┐ │   │
│  ┌──────▼───────┐    ┌──────────────┐    │  │ Persistent Blocks  │ │   │
│  │ Notifier     │    │ Rule         │    │  │ ┌──────┐ ┌──────┐ │ │   │
│  │              │◀───│ Manager      │◀───│  │ │Block1│ │Block2│ │ │   │
│  │ - Alertmgr   │    │              │    │  │ └──────┘ └──────┘ │ │   │
│  │   전송       │    │ - Recording  │    │  │    ▲  compaction   │ │   │
│  │ - retry 로직 │    │ - Alerting   │    │  │    │               │ │   │
│  └──────────────┘    │ - eval loop  │    │  └────────────────────┘ │   │
│                      └──────────────┘    └──────────────────────────┘   │
│                                                                         │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐              │
│  │ Web/API      │    │ PromQL       │    │ Remote       │              │
│  │ Handler      │◀──▶│ Engine       │    │ Storage      │              │
│  │              │    │              │    │              │              │
│  │ - /api/v1/*  │    │ - parse      │    │ - Write      │              │
│  │ - /graph     │    │ - plan       │    │ - Read       │              │
│  │ - /targets   │    │ - execute    │    │ - WAL based  │              │
│  │ - /rules     │    │ - lookback   │    │   queue      │              │
│  └──────────────┘    └──────────────┘    └──────────────┘              │
└─────────────────────────────────────────────────────────────────────────┘
```

### Scrape Manager 심화

Scrape Manager는 모든 스크래핑 작업을 관리하는 핵심 컴포넌트이다.

#### 동작 원리

1. **Configuration Loading**: Config Reloader가 설정 파일을 읽고 Scrape Manager에 전달한다
2. **Target Discovery**: Service Discovery 모듈이 타겟을 발견하면 Target Group 형태로 Scrape Manager에 전달한다
3. **Scrape Loop 생성**: 각 타겟에 대해 독립적인 goroutine이 생성되어 주기적으로 스크래핑을 수행한다
4. **HTTP GET 요청**: `/metrics` 엔드포인트에 HTTP GET 요청을 보내고 응답을 파싱한다
5. **TSDB Appender**: 파싱된 샘플을 TSDB의 Appender 인터페이스를 통해 저장한다

#### Scrape Loop 생명주기

```
┌──────────────┐
│ target 발견   │
└──────┬───────┘
       ▼
┌──────────────┐     ┌──────────────┐
│ scrape loop  │────▶│ HTTP GET     │
│ 시작         │     │ /metrics     │
└──────┬───────┘     └──────┬───────┘
       │                     │
       │              ┌──────▼───────┐
       │              │ 응답 파싱     │
       │              │ (text/plain  │
       │              │  exposition  │
       │              │  format)     │
       │              └──────┬───────┘
       │                     │
       │              ┌──────▼───────┐
       │              │ relabel      │
       │              │ (metric_     │
       │              │  relabel_    │
       │              │  configs)    │
       │              └──────┬───────┘
       │                     │
       │              ┌──────▼───────┐
       │              │ TSDB append  │
       │              │ (WAL write)  │
       │              └──────┬───────┘
       │                     │
       │  scrape_interval    │
       │  만큼 대기           │
       │◀────────────────────┘
       │
       │ target 사라짐
       ▼
┌──────────────┐
│ staleness    │
│ marker 삽입  │
└──────┬───────┘
       ▼
┌──────────────┐
│ scrape loop  │
│ 종료         │
└──────────────┘
```

#### 스크래핑 성능 지표

Prometheus 자체 메트릭으로 스크래핑 성능을 모니터링할 수 있다.

```promql
# 스크래핑 소요 시간 (초 단위, 타겟별)
scrape_duration_seconds

# 스크래핑당 수집된 샘플 수
scrape_samples_scraped

# 스크래핑 후 실제 저장된 샘플 수 (relabeling drop 후)
scrape_samples_post_metric_relabeling

# 스크래핑 시리즈 추가/제거 횟수
scrape_series_added

# 타겟 상태 (1=UP, 0=DOWN)
up

# 스크래핑이 sample limit을 초과한 횟수
scrape_samples_scraped > prometheus_target_scrapes_sample_limit_total
```

### Rule Manager 심화

Rule Manager는 Recording Rule과 Alerting Rule을 주기적으로 평가하는 컴포넌트이다.

#### 평가 주기 (Evaluation Interval)

```yaml
global:
  evaluation_interval: 30s  # Rule Group의 기본 평가 주기
```

- 각 Rule Group은 독립적인 goroutine에서 평가된다
- Rule Group 내의 Rule들은 순서대로 평가된다 (한 Rule의 결과를 다음 Rule이 참조 가능)
- 하나의 Rule Group 평가가 evaluation_interval보다 오래 걸리면 다음 평가를 건너뛴다
- 이 상황은 `prometheus_rule_group_iterations_missed_total` 메트릭으로 감지할 수 있다

#### Rule 평가 지표

```promql
# Rule 평가에 소요된 시간
prometheus_rule_evaluation_duration_seconds

# 평가를 건너뛴 횟수 (성능 문제 징후)
prometheus_rule_group_iterations_missed_total

# Rule 평가 실패 횟수
prometheus_rule_evaluation_failures_total

# 현재 로드된 Rule 수
prometheus_rule_group_rules
```

### Notifier 심화

Notifier는 Alerting Rule에서 firing된 알림을 Alertmanager로 전송하는 컴포넌트이다.

#### 알림 전송 흐름

1. Rule Manager가 Alerting Rule을 평가하여 firing 상태의 알림을 감지한다
2. `for` 기간이 만족되면 알림이 Notifier에 전달된다
3. Notifier는 설정된 모든 Alertmanager 엔드포인트에 알림을 전송한다
4. 전송 실패 시 자동으로 재시도한다. 기본 재시도 간격은 100ms이고 최대 10초까지 backoff한다
5. Alertmanager는 알림을 수신하면 grouping, inhibition, silencing을 수행한 후 receiver로 전달한다

#### 알림 상태 전이

```
         Alerting Rule 평가
                │
                ▼
        ┌───────────────┐
   ┌───▶│   Inactive    │
   │    │ (조건 미충족)   │
   │    └───────┬───────┘
   │            │ 조건 충족
   │            ▼
   │    ┌───────────────┐
   │    │   Pending     │
   │    │ (for 대기 중)  │
   │    └───────┬───────┘
   │            │ for 기간 경과
   │            ▼
   │    ┌───────────────┐
   │    │   Firing      │
   │    │ (알림 전송 중) │
   │    └───────┬───────┘
   │            │ 조건 미충족
   └────────────┘
        (Resolved 전송 후 Inactive)
```

---

## 데이터 모델 심화

### 시계열의 정체

Prometheus의 모든 데이터는 시계열(Time Series)이다. 하나의 시계열은 다음으로 식별된다.

```
metric_name{label1="value1", label2="value2", ...}
```

내부적으로 시계열은 다음과 같은 구조를 갖는다.

```
시계열 ID (내부 TSDB 참조용, uint64)
├── 메트릭 이름 (__name__ 라벨)
├── 라벨 셋 (정렬된 key-value 쌍)
└── 샘플 목록
    ├── (timestamp_1, value_1)
    ├── (timestamp_2, value_2)
    └── ...
```

- **타임스탬프**: 밀리초 정밀도의 int64 값이다 (Unix epoch 기준)
- **값**: float64 부동소수점 숫자이다
- **라벨 셋**: 모든 라벨의 조합이 하나의 고유한 시계열을 정의한다. 같은 메트릭 이름이라도 라벨이 다르면 별개의 시계열이다

### 메트릭 이름 규칙

```
# 형식: <namespace>_<name>_<unit>_<suffix>
# 예시:
prometheus_tsdb_head_samples_appended_total    # prometheus 네임스페이스, counter
http_request_duration_seconds_bucket           # histogram의 bucket
node_memory_MemAvailable_bytes                 # gauge, 단위는 bytes

# 규칙 요약:
# 1. snake_case를 사용한다
# 2. 단위를 접미사에 포함한다 (bytes, seconds, total 등)
# 3. Counter는 _total 접미사를 붙인다
# 4. 단위는 기본 단위를 사용한다 (milliseconds 대신 seconds, megabytes 대신 bytes)
# 5. rate/ratio를 나타내는 경우 단위 없이 _ratio를 사용한다
```

### Counter 심화

Counter는 단조 증가(monotonically increasing)하는 값이다. 프로세스 재시작 시에만 0으로 리셋된다.

#### 내부 구조

```
http_requests_total{method="GET", status="200"}
    t=1000: 150
    t=1015: 155    # +5 (15초간 5개 요청)
    t=1030: 162    # +7
    t=1045: 162    # +0 (요청 없음)
    t=1060: 170    # +8
    t=1075: 0      # 리셋! (프로세스 재시작)
    t=1090: 12     # 리셋 후 12개 요청
```

#### Counter 리셋 감지

`rate()` 함수는 Counter 리셋을 자동으로 감지하고 보정한다.

```
# rate() 내부 동작:
# 1. 범위 내 첫 번째와 마지막 샘플을 확인한다
# 2. 값이 감소한 구간이 있으면 리셋으로 간주한다
# 3. 리셋 이후 값을 이전 값에 더하여 보정한다
# 4. (보정된 마지막 값 - 첫 번째 값) / 시간 범위 = 초당 비율

# 위 예시에서 [1000:1090] 범위의 rate:
# 리셋 보정: 170 + 12 = 182 (리셋 이전까지의 값 + 리셋 이후 값)
# rate = (182 - 150) / 90 = 0.356 req/s
```

#### Counter 사용 시 주의사항

```promql
# (X) 잘못된 사용: Counter를 직접 그래프로 표시하면 의미 없는 단조증가 그래프가 나온다
http_requests_total

# (O) 올바른 사용: rate()로 변환하여 초당 비율을 확인한다
rate(http_requests_total[5m])

# (O) increase()로 일정 기간 내 증가량을 확인한다
increase(http_requests_total[1h])

# (X) 잘못된 사용: Counter에 sum()만 적용하면 의미 없다
sum(http_requests_total)

# (O) 올바른 사용: rate() 후 sum()을 적용한다
sum(rate(http_requests_total[5m]))
```

### Gauge 심화

Gauge는 임의로 증가하거나 감소할 수 있는 현재 값이다.

#### 내부 구조

```
node_memory_MemAvailable_bytes{instance="node1:9100"}
    t=1000: 4294967296    # 4GB
    t=1015: 4194304000    # 약 3.9GB (메모리 사용 증가)
    t=1030: 4294967296    # 4GB (캐시 해제)
    t=1045: 3221225472    # 3GB (대량 할당)
```

#### Gauge 활용 함수

```promql
# 현재 값 그대로 사용
node_memory_MemAvailable_bytes

# 변화량 (증가/감소 모두 포함)
delta(node_memory_MemAvailable_bytes[1h])

# 시간당 변화 추세 (선형 회귀의 기울기)
deriv(node_memory_MemAvailable_bytes[1h])

# 범위 내 최대/최소값
max_over_time(node_memory_MemAvailable_bytes[1h])
min_over_time(node_memory_MemAvailable_bytes[1h])

# 선형 예측: 4시간 후 값 예측
predict_linear(node_filesystem_avail_bytes[6h], 4*3600)
```

### Histogram 심화

Histogram은 관측값(observation)의 분포를 기록한다. 하나의 Histogram 메트릭은 세 종류의 시계열을 생성한다.

#### 내부 구조

```
# 버킷 시계열 (_bucket): 각 버킷 경계 이하의 관측값 누적 수
http_request_duration_seconds_bucket{le="0.005"} 24054   # 5ms 이하
http_request_duration_seconds_bucket{le="0.01"}  33444   # 10ms 이하
http_request_duration_seconds_bucket{le="0.025"} 100392  # 25ms 이하
http_request_duration_seconds_bucket{le="0.05"}  129389  # 50ms 이하
http_request_duration_seconds_bucket{le="0.1"}   133988  # 100ms 이하
http_request_duration_seconds_bucket{le="0.25"}  144320  # 250ms 이하
http_request_duration_seconds_bucket{le="0.5"}   144320  # 500ms 이하
http_request_duration_seconds_bucket{le="1"}     144320  # 1s 이하
http_request_duration_seconds_bucket{le="2.5"}   144320  # 2.5s 이하
http_request_duration_seconds_bucket{le="5"}     144320  # 5s 이하
http_request_duration_seconds_bucket{le="10"}    144320  # 10s 이하
http_request_duration_seconds_bucket{le="+Inf"}  144320  # 전체 (항상 _count와 같다)

# 총 관측 횟수 (_count)
http_request_duration_seconds_count 144320

# 관측값의 합계 (_sum)
http_request_duration_seconds_sum 53423.507
```

핵심 특징:
- 버킷은 **누적(cumulative)** 이다. `le="0.1"` 버킷에는 0.1초 이하의 모든 관측값이 포함된다
- `le="+Inf"` 버킷의 값은 항상 `_count`와 같다
- `_sum / _count`로 평균 관측값을 계산할 수 있다
- 버킷 경계는 클라이언트 코드에서 설정하며, 한번 설정하면 변경하기 어렵다

#### 버킷 설계 전략

```go
// Go 클라이언트에서 Histogram 버킷 설정 예시
histogram := prometheus.NewHistogram(prometheus.HistogramOpts{
    Name: "http_request_duration_seconds",
    Help: "HTTP request duration in seconds",
    // 기본 버킷: DefBuckets = {.005, .01, .025, .05, .1, .25, .5, 1, 2.5, 5, 10}
    // 커스텀 버킷: 서비스 특성에 맞게 설정해야 한다
    Buckets: []float64{0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 5.0},
})

// 지수 버킷 생성 (start, factor, count)
// 0.001, 0.002, 0.004, 0.008, 0.016, 0.032, 0.064, 0.128, 0.256, 0.512
prometheus.ExponentialBuckets(0.001, 2, 10)
```

버킷 설계 원칙:
1. SLO 경계값을 반드시 버킷에 포함시킨다 (예: SLO가 200ms이면 `le="0.2"` 버킷 필요)
2. 관측값의 실제 분포를 고려하여 밀집 구간에 버킷을 많이 배치한다
3. 버킷이 너무 많으면 카디널리티가 폭발한다 (10~20개가 적당하다)
4. 지수 버킷(`ExponentialBuckets`)은 넓은 범위를 커버할 때 유용하다

### Native Histogram (실험적 기능)

Prometheus 2.40+에서 도입된 Native Histogram은 기존 Histogram의 한계를 극복하기 위한 새로운 방식이다.

#### 기존 Histogram의 문제점

```
# 기존 방식: 10개 버킷이면 10+2=12개의 시계열이 생성된다
# 라벨이 추가될수록 카디널리티가 폭발한다
# 예: method(5) * status(5) * 12 = 300 시계열 (하나의 Histogram당)
```

#### Native Histogram의 특징

```
# Native Histogram은 단일 시계열에 전체 분포 정보를 저장한다
# 버킷 경계가 자동으로 결정된다 (지수 버킷 스키마 사용)
# 카디널리티 폭발 없이 높은 정확도의 분위수 계산이 가능하다
# TSDB에 네이티브 인코딩으로 저장되어 공간 효율적이다

# 활성화 방법 (Prometheus 시작 플래그)
--enable-feature=native-histograms

# 스크래핑 시 Content Negotiation을 통해 Native Histogram을 수집한다
# application/openmetrics-text 형식에서 지원된다
```

### Exemplar

Exemplar는 메트릭 샘플에 트레이스 ID를 연결하는 기능이다. 메트릭에서 이상을 발견했을 때 해당 시점의 트레이스로 바로 이동할 수 있다.

```
# Exposition format에서 Exemplar 표현
http_request_duration_seconds_bucket{le="0.1"} 24054 # {trace_id="abc123"} 0.083
```

```promql
# Grafana에서 Exemplar를 활성화하면 그래프 위에 점으로 표시된다
# 해당 점을 클릭하면 연결된 트레이스(Jaeger/Tempo)로 이동할 수 있다
```

---

