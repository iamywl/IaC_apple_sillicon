# Prometheus - 메트릭 수집 및 저장

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

---

## Pull 모델 심화

### Pull vs Push
| 항목 | Pull (Prometheus) | Push (예: StatsD, InfluxDB) |
|------|-------------------|----------------------------|
| 방향 | Prometheus가 타겟에서 메트릭을 가져온다 | 애플리케이션이 메트릭을 전송한다 |
| 헬스체크 | 스크래핑 실패 = 타겟 다운 (자동 헬스체크) | 메트릭이 안 오는 이유를 알기 어렵다 |
| 디버깅 | 타겟의 `/metrics`를 curl로 직접 확인할 수 있다 | 전송 경로를 추적해야 한다 |
| 스케일링 | Prometheus가 부하를 제어한다 | 타겟이 많아지면 수신 측에 부하가 몰릴 수 있다 |
| 단기 작업 | Pushgateway를 통해 지원한다 | 자연스럽게 지원한다 |

### Scrape 설정 상세
```yaml
scrape_configs:
  - job_name: 'my-app'
    scrape_interval: 15s      # 스크래핑 주기 (기본: global.scrape_interval)
    scrape_timeout: 10s       # 스크래핑 타임아웃 (scrape_interval보다 작아야 한다)
    metrics_path: '/metrics'  # 메트릭 경로 (기본: /metrics)
    scheme: 'https'           # HTTP 또는 HTTPS
    honor_labels: false       # true이면 타겟의 라벨이 Prometheus 라벨보다 우선한다
    honor_timestamps: true    # true이면 타겟이 보낸 타임스탬프를 사용한다
```

#### honor_labels 동작
- `honor_labels: false` (기본값): 타겟의 라벨과 Prometheus가 부여하는 라벨(`job`, `instance`)이 충돌하면, Prometheus 라벨이 우선되고 타겟 라벨은 `exported_` 접두사가 붙는다
- `honor_labels: true`: 타겟의 라벨이 그대로 유지된다. Federation이나 Pushgateway에서 사용한다

### Relabeling
Relabeling은 스크래핑 전후에 라벨을 조작하는 메커니즘이다. 두 가지 단계가 있다.

#### relabel_configs (스크래핑 전)
- Service Discovery에서 발견한 타겟의 메타데이터 라벨(`__meta_*`)을 사용하여 타겟을 필터링하거나 라벨을 변환한다
- 스크래핑 대상 자체를 결정하는 단계이다

```yaml
relabel_configs:
  # 특정 어노테이션이 있는 Pod만 스크래핑한다
  - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_scrape]
    action: keep
    regex: true

  # 어노테이션에서 메트릭 경로를 가져온다
  - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_path]
    action: replace
    target_label: __metrics_path__
    regex: (.+)

  # 포트 정보를 가져온다
  - source_labels: [__address__, __meta_kubernetes_pod_annotation_prometheus_io_port]
    action: replace
    regex: ([^:]+)(?::\d+)?;(\d+)
    replacement: $1:$2
    target_label: __address__
```

#### metric_relabel_configs (스크래핑 후)
- 수집된 메트릭의 라벨을 변환하거나, 불필요한 메트릭을 드롭하는 단계이다
- 저장 전에 적용된다

```yaml
metric_relabel_configs:
  # 특정 메트릭을 드롭하여 저장 공간을 절약한다
  - source_labels: [__name__]
    regex: 'go_.*'
    action: drop

  # 라벨 이름을 변경한다
  - source_labels: [pod_name]
    target_label: pod
    action: replace
```

---

## Service Discovery

Prometheus는 다양한 Service Discovery 메커니즘을 지원하여 모니터링 타겟을 자동으로 발견한다.

### kubernetes_sd_config
Kubernetes 환경에서 가장 핵심적인 Service Discovery이다. Kubernetes API를 통해 타겟을 자동으로 발견한다.

| Role | 대상 | 주요 메타 라벨 | 용도 |
|------|------|---------------|------|
| `node` | 클러스터 노드 | `__meta_kubernetes_node_name`, `__meta_kubernetes_node_label_*` | kubelet 메트릭, node-exporter |
| `pod` | 개별 Pod | `__meta_kubernetes_pod_name`, `__meta_kubernetes_pod_namespace`, `__meta_kubernetes_pod_container_port_number` | 애플리케이션 메트릭 직접 수집 |
| `service` | Service 객체 | `__meta_kubernetes_service_name`, `__meta_kubernetes_service_port_name` | 블랙박스 모니터링 |
| `endpoints` | Endpoints 객체 (Service 뒤의 Pod) | `__meta_kubernetes_endpoint_port_name`, Pod/Service 메타 라벨 포함 | 가장 일반적인 서비스 메트릭 수집 |
| `endpointslice` | EndpointSlice 객체 | endpoints와 유사, 대규모 클러스터에 적합 | endpoints의 확장판 |
| `ingress` | Ingress 객체 | `__meta_kubernetes_ingress_name`, `__meta_kubernetes_ingress_path` | 블랙박스 Probe 모니터링 |

### 기타 Service Discovery
| 방식 | 설명 | 사용 사례 |
|------|------|----------|
| `static_configs` | 정적으로 타겟을 지정한다 | 고정 IP/포트의 외부 서비스 |
| `file_sd_configs` | JSON/YAML 파일에서 타겟 목록을 읽는다. 파일 변경 시 자동 리로드된다 | 외부 시스템에서 타겟 목록을 생성하는 경우 |
| `consul_sd_configs` | HashiCorp Consul에서 서비스를 발견한다 | Consul 기반 인프라 |
| `dns_sd_configs` | DNS SRV 레코드로 타겟을 발견한다 | DNS 기반 서비스 디스커버리 |
| `ec2_sd_configs` | AWS EC2 인스턴스를 자동 발견한다 | AWS 환경 |
| `gce_sd_configs` | GCP Compute Engine 인스턴스를 자동 발견한다 | GCP 환경 |

---

## TSDB 내부 구조

Prometheus TSDB는 시계열 데이터에 최적화된 로컬 스토리지 엔진이다.

### 전체 구조
```
data/
├── wal/                    # Write-Ahead Log (최신 데이터)
│   ├── 00000001
│   ├── 00000002
│   └── checkpoint.00000001
├── chunks_head/            # Head block의 메모리 매핑된 청크
├── 01BKGV7JBM69T2G1BGBGM6KB12/  # Persistent block
│   ├── meta.json           # 블록 메타데이터 (시간 범위, 시계열 수 등)
│   ├── index               # 라벨 인덱스 (inverted index)
│   ├── chunks/             # 압축된 시계열 데이터
│   │   └── 000001
│   └── tombstones          # 삭제 표시
├── 01BKGTZQ1SYQJTR4PB43C8PD98/  # 또 다른 persistent block
│   ├── ...
└── lock                    # 프로세스 잠금 파일
```

### WAL (Write-Ahead Log)
- 모든 수집된 샘플은 먼저 WAL에 기록된다. 장애 복구(crash recovery)를 위한 것이다
- WAL은 128MB 세그먼트 파일로 구성된다
- Prometheus 재시작 시 WAL을 재생(replay)하여 Head block을 복구한다
- WAL checkpoint는 이미 블록으로 전환된 데이터를 WAL에서 제거하여 디스크 사용량을 줄인다
- WAL 쓰기는 순차적(sequential)이므로 HDD에서도 빠르다

### Head Block vs Persistent Block
| 구분 | Head Block | Persistent Block |
|------|-----------|-----------------|
| 위치 | 메모리 + `chunks_head/` | 디스크 (`ULID/` 디렉터리) |
| 데이터 범위 | 최근 2시간 (기본값) | Head block에서 컴팩션된 과거 데이터 |
| 쓰기 | 실시간으로 샘플을 추가한다 | 불변(immutable)이다 |
| 압축 | 미압축 또는 부분 압축 | Gorilla 압축이 적용된다 |
| 인덱스 | 인메모리 inverted index | 디스크 기반 인덱스 파일 |

### Block Compaction
- Head block은 약 2시간마다 디스크의 persistent block으로 플러시된다
- 작은 블록들은 더 큰 블록으로 병합(compaction)된다. 기본적으로 최대 시간 범위의 10%까지 병합한다
- Compaction은 중복 시계열 제거, 인덱스 최적화, tombstone 적용을 수행한다
- Compaction 과정에서 CPU와 디스크 I/O가 증가하므로, 운영 시 이 시점을 모니터링해야 한다

### Chunk Encoding (Gorilla 압축)
- Facebook의 Gorilla 논문(2015)에서 제안된 시계열 압축 알고리즘을 사용한다
- 타임스탬프: Delta-of-Delta 인코딩을 사용한다. 일정 간격으로 수집된 데이터는 거의 0비트로 저장된다
- 값(float64): XOR 인코딩을 사용한다. 연속된 값이 비슷할수록 적은 비트로 저장된다
- 샘플당 평균 1.37바이트로 압축된다 (비압축 float64+int64 = 16바이트 대비 약 12배 효율)

### Retention 정책
```yaml
# 시간 기반 보관 (기본: 15일)
--storage.tsdb.retention.time=15d

# 크기 기반 보관 (시간 기반과 함께 사용 가능)
--storage.tsdb.retention.size=50GB

# 크기 제한에 도달하면 가장 오래된 블록부터 삭제한다
# 두 조건 중 하나라도 충족되면 삭제가 발생한다
```

### Staleness 처리
- Prometheus는 5분 staleness 마커를 사용한다
- 타겟이 사라지거나 시계열이 더 이상 노출되지 않으면, 마지막 샘플로부터 5분이 지난 시점에 해당 시계열을 "stale"로 표시한다
- Stale 시계열은 쿼리 결과에서 자동으로 제외된다
- `up` 메트릭이 0이 되면(스크래핑 실패), 해당 타겟의 모든 시계열에 즉시 staleness marker가 삽입된다
- Staleness marker는 NaN 값으로 저장되며, 이는 시계열이 끝났음을 의미한다

---

## PromQL 심화

### 데이터 타입
| 타입 | 설명 | 예시 |
|------|------|------|
| Instant Vector | 각 시계열의 단일 샘플(가장 최신 값)이다 | `http_requests_total` |
| Range Vector | 각 시계열의 일정 시간 범위 내 샘플 목록이다 | `http_requests_total[5m]` |
| Scalar | 부동소수점 숫자 값이다 | `3.14` |
| String | 문자열 값이다 (현재 거의 사용되지 않는다) | `"hello"` |

- Instant Vector만 그래프로 표시할 수 있다. Range Vector는 `rate()` 등의 함수를 거쳐 Instant Vector로 변환해야 한다

### rate() vs irate()
| 함수 | 계산 방식 | 특징 |
|------|----------|------|
| `rate()` | 전체 범위의 초당 평균 증가율이다 | 매끄러운 그래프를 생성한다. 알림에 적합하다 |
| `irate()` | 가장 마지막 두 데이터 포인트 사이의 순간 증가율이다 | 변동성이 크다. 짧은 스파이크를 감지할 수 있다 |

```promql
# rate: 5분간 평균 초당 요청 수 (알림, 대시보드에 권장)
rate(http_requests_total[5m])

# irate: 순간 요청률 (빠른 변동을 보고 싶을 때)
irate(http_requests_total[5m])

# 주의: rate()의 범위는 scrape_interval의 최소 4배를 권장한다
# scrape_interval=15s이면 [1m] 이상을 사용해야 한다
```

### histogram_quantile() 내부 동작
```promql
# p99 응답 시간 계산
histogram_quantile(0.99, rate(http_request_duration_seconds_bucket[5m]))
```
- `_bucket` 시계열의 `le` (less-than-or-equal) 라벨을 사용하여 버킷 경계를 파악한다
- 요청된 분위수(예: 0.99)가 어느 버킷 구간에 속하는지 판단한다
- 해당 구간 내에서 선형 보간(linear interpolation)을 수행하여 추정값을 계산한다
- 버킷 구간이 넓으면 정확도가 떨어진다. 적절한 버킷 경계 설정이 중요하다

### 집계 연산자 (Aggregation Operators)
```promql
# sum: 합계
sum(rate(http_requests_total[5m])) by (service)

# avg: 평균
avg(node_cpu_seconds_total{mode="idle"}) by (instance)

# count: 시계열 개수
count(up == 1) by (job)

# topk: 상위 N개
topk(5, sum(rate(http_requests_total[5m])) by (endpoint))

# bottomk: 하위 N개
bottomk(3, node_filesystem_avail_bytes)

# quantile: 집계 수준의 분위수 (histogram_quantile과 다르다)
quantile(0.95, rate(http_requests_total[5m]))

# min / max
max(node_cpu_seconds_total{mode="idle"}) by (instance)

# stddev / stdvar: 표준편차 / 분산
stddev(rate(http_requests_total[5m])) by (service)

# count_values: 값별 시계열 개수
count_values("version", kube_pod_container_info)
```

### 이항 연산자와 벡터 매칭
```promql
# 1:1 매칭 (on)
http_requests_total / on(instance, job) http_requests_errors_total

# 다:1 매칭 (group_left)
# 왼쪽이 더 많은 시계열을 가질 때 사용한다
node_filesystem_avail_bytes * 100
  / on(instance, device, mountpoint) group_left
  node_filesystem_size_bytes

# 1:다 매칭 (group_right)
# 오른쪽이 더 많은 시계열을 가질 때 사용한다
```

### Subquery 문법
```promql
# 5분 간격으로 계산된 rate를 1시간 범위에서 max로 집계한다
max_over_time(rate(http_requests_total[5m])[1h:5m])

# 형식: <instant_query>[<range>:<resolution>]
# range: 되돌아볼 시간 범위
# resolution: 평가 간격 (생략하면 global evaluation_interval 사용)

# 최근 1시간에서 CPU 사용률이 최고였던 순간
max_over_time(
  (1 - avg by(instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])))[1h:1m]
)
```

### offset과 @ modifier
```promql
# 1시간 전 값과 비교
http_requests_total offset 1h

# 특정 Unix 타임스탬프의 값
http_requests_total @ 1609459200

# 어제 대비 오늘의 요청 증가율
rate(http_requests_total[5m]) / rate(http_requests_total[5m] offset 1d) * 100 - 100
```

---

## 실습

### 실습 1: Prometheus UI 접속
```bash
# Prometheus 포트포워딩
kubectl port-forward -n monitoring svc/prometheus-server 9090:9090

# 브라우저에서 http://localhost:9090 접속

# 타겟 확인: Status > Targets
# 설정 확인: Status > Configuration
# 규칙 확인: Status > Rules
# 서비스 디스커버리 확인: Status > Service Discovery
# TSDB 상태 확인: Status > TSDB Status
```

### 실습 2: PromQL 기본 쿼리
```promql
# 1. 즉시 벡터 (현재 값)
up  # 모든 타겟의 상태 (1=정상, 0=다운)

# 2. CPU 사용률 (노드별)
100 - (avg by(instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)

# 3. 메모리 사용률 (노드별)
(1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes) * 100

# 4. Pod CPU 사용량
sum(rate(container_cpu_usage_seconds_total{namespace="demo"}[5m])) by (pod)

# 5. Pod 메모리 사용량
sum(container_memory_working_set_bytes{namespace="demo"}) by (pod) / 1024 / 1024

# 6. HTTP 요청 비율 (RPS)
rate(http_requests_total[5m])

# 7. HTTP 에러율
sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m])) * 100
```

### 실습 3: PromQL 고급 쿼리
```promql
# 1. p95 응답 시간
histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))

# 2. Top 5 메모리 소비 Pod
topk(5, sum(container_memory_working_set_bytes{namespace!=""}) by (pod))

# 3. PVC 디스크 사용률
(kubelet_volume_stats_used_bytes / kubelet_volume_stats_capacity_bytes) * 100

# 4. 네임스페이스별 CPU 사용 합계
sum(rate(container_cpu_usage_seconds_total[5m])) by (namespace)

# 5. Pod 재시작 횟수 (최근 1시간)
increase(kube_pod_container_status_restarts_total[1h])

# 6. 네트워크 수신 바이트 (초당, 노드별)
sum(rate(node_network_receive_bytes_total{device!~"lo|veth.*|docker.*|flannel.*|cali.*|cbr.*"}[5m])) by (instance)

# 7. 디스크 I/O 사용률
rate(node_disk_io_time_seconds_total[5m]) * 100

# 8. 클러스터 전체 CPU 요청 대비 사용률
sum(rate(container_cpu_usage_seconds_total[5m])) / sum(kube_pod_container_resource_requests{resource="cpu"}) * 100
```

### 실습 4: ServiceMonitor 확인
```bash
# 현재 설정된 ServiceMonitor 확인
kubectl get servicemonitor -A

# ServiceMonitor 상세 정보
kubectl describe servicemonitor <name> -n monitoring

# PrometheusRule 확인
kubectl get prometheusrule -A

# 프로젝트의 Prometheus 설정 확인
cat ../../manifests/helm-values/prometheus-values.yaml
```

### 실습 5: TSDB 상태 확인
```bash
# Prometheus API로 TSDB 상태 조회
curl -s http://localhost:9090/api/v1/status/tsdb | jq .

# 현재 활성 시계열 수
curl -s http://localhost:9090/api/v1/status/tsdb | jq '.data.headStats.numSeries'

# 블록 정보 조회 (각 블록의 시간 범위, 크기, 시계열 수)
curl -s http://localhost:9090/api/v1/status/tsdb | jq '.data.seriesCountByMetricName[:10]'

# WAL 재생 시간 확인 (재시작 성능 지표)
curl -s http://localhost:9090/api/v1/query?query=prometheus_tsdb_wal_replay_duration_seconds | jq .
```

---

## node-exporter 상세

### 개요
node-exporter는 Linux/Unix 호스트의 하드웨어 및 OS 수준 메트릭을 노출하는 공식 Prometheus exporter이다. Kubernetes에서는 DaemonSet으로 배포하여 모든 노드에서 실행한다.

### 주요 메트릭
| 메트릭 | 타입 | 설명 |
|--------|------|------|
| `node_cpu_seconds_total` | Counter | CPU 모드별(user, system, idle, iowait 등) 사용 시간이다 |
| `node_memory_MemTotal_bytes` | Gauge | 전체 메모리 크기이다 |
| `node_memory_MemAvailable_bytes` | Gauge | 사용 가능한 메모리이다 (MemFree와 다르다. 캐시/버퍼 포함) |
| `node_filesystem_avail_bytes` | Gauge | 파일시스템 사용 가능 바이트이다 |
| `node_filesystem_size_bytes` | Gauge | 파일시스템 전체 크기이다 |
| `node_disk_read_bytes_total` | Counter | 디스크에서 읽은 총 바이트이다 |
| `node_disk_written_bytes_total` | Counter | 디스크에 쓴 총 바이트이다 |
| `node_disk_io_time_seconds_total` | Counter | 디스크 I/O에 소요된 시간이다 |
| `node_network_receive_bytes_total` | Counter | 네트워크 인터페이스로 수신한 총 바이트이다 |
| `node_network_transmit_bytes_total` | Counter | 네트워크 인터페이스로 송신한 총 바이트이다 |
| `node_load1` / `node_load5` / `node_load15` | Gauge | 1분/5분/15분 로드 평균이다 |
| `node_boot_time_seconds` | Gauge | 노드 부팅 시각(Unix timestamp)이다 |
| `node_uname_info` | Gauge | 커널 버전 등 노드 정보이다 (값은 항상 1이다) |

### 핵심 모니터링 쿼리
```promql
# CPU 사용률 (idle 제외한 비율)
1 - avg by(instance) (rate(node_cpu_seconds_total{mode="idle"}[5m]))

# 메모리 사용률
1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)

# 디스크 사용률
1 - (node_filesystem_avail_bytes{fstype!~"tmpfs|overlay"} / node_filesystem_size_bytes)

# 디스크 I/O saturation (iowait 비율)
avg by(instance) (rate(node_cpu_seconds_total{mode="iowait"}[5m]))

# 네트워크 트래픽 (Mbps)
rate(node_network_receive_bytes_total{device!~"lo|veth.*"}[5m]) * 8 / 1024 / 1024

# 노드 업타임
time() - node_boot_time_seconds
```

---

## kube-state-metrics 상세

### 개요
kube-state-metrics(KSM)는 Kubernetes API 서버를 감시하여 Kubernetes 객체(Pod, Deployment, Node 등)의 상태를 Prometheus 메트릭으로 노출하는 서비스이다. node-exporter가 "머신"의 상태를 보여준다면, KSM은 "Kubernetes 오케스트레이션"의 상태를 보여준다.

### node-exporter와의 차이
| 항목 | node-exporter | kube-state-metrics |
|------|--------------|-------------------|
| 대상 | 호스트(OS/하드웨어) | Kubernetes 객체 |
| 배포 방식 | DaemonSet (노드당 1개) | Deployment (클러스터당 1개) |
| 데이터 소스 | `/proc`, `/sys` 등 커널 인터페이스 | Kubernetes API Server |
| 메트릭 예시 | CPU, 메모리, 디스크, 네트워크 | Pod 상태, Deployment replica 수, Job 성공/실패 |

### 주요 메트릭
| 메트릭 | 설명 |
|--------|------|
| `kube_pod_status_phase` | Pod의 현재 Phase이다 (Pending, Running, Succeeded, Failed, Unknown) |
| `kube_pod_container_status_restarts_total` | 컨테이너 재시작 횟수이다 |
| `kube_pod_container_status_waiting_reason` | 컨테이너 대기 이유이다 (CrashLoopBackOff, ImagePullBackOff 등) |
| `kube_pod_container_resource_requests` | 컨테이너의 리소스 Request이다 (CPU, 메모리) |
| `kube_pod_container_resource_limits` | 컨테이너의 리소스 Limit이다 |
| `kube_deployment_spec_replicas` | Deployment의 desired replica 수이다 |
| `kube_deployment_status_replicas_available` | 사용 가능한 replica 수이다 |
| `kube_deployment_status_replicas_unavailable` | 사용 불가능한 replica 수이다 |
| `kube_node_status_condition` | 노드 상태 조건이다 (Ready, MemoryPressure, DiskPressure 등) |
| `kube_node_status_allocatable` | 노드에 할당 가능한 리소스이다 |
| `kube_job_status_succeeded` | Job 성공 횟수이다 |
| `kube_job_status_failed` | Job 실패 횟수이다 |
| `kube_horizontalpodautoscaler_status_current_replicas` | HPA의 현재 replica 수이다 |
| `kube_persistentvolumeclaim_status_phase` | PVC의 Phase이다 (Bound, Pending, Lost) |
| `kube_namespace_status_phase` | 네임스페이스의 Phase이다 |

### 핵심 모니터링 쿼리
```promql
# Running 상태가 아닌 Pod
kube_pod_status_phase{phase!="Running", phase!="Succeeded"} == 1

# Deployment replica 불일치 (desired != available)
kube_deployment_spec_replicas != kube_deployment_status_replicas_available

# CrashLoopBackOff 상태의 컨테이너
kube_pod_container_status_waiting_reason{reason="CrashLoopBackOff"} > 0

# 노드 NotReady
kube_node_status_condition{condition="Ready", status="true"} == 0

# 클러스터 전체 CPU 할당률
sum(kube_pod_container_resource_requests{resource="cpu"}) / sum(kube_node_status_allocatable{resource="cpu"}) * 100

# 클러스터 전체 메모리 할당률
sum(kube_pod_container_resource_requests{resource="memory"}) / sum(kube_node_status_allocatable{resource="memory"}) * 100

# 24시간 내 실패한 Job
kube_job_status_failed{} > 0 and kube_job_status_start_time > (time() - 86400)
```

---

## 예제

### 예제 1: ServiceMonitor 정의
```yaml
# servicemonitor.yaml
# 앱의 메트릭을 Prometheus가 수집하도록 설정한다
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: my-app-monitor
  namespace: monitoring
  labels:
    release: prometheus  # Prometheus Operator가 이 라벨로 ServiceMonitor를 발견한다
spec:
  selector:
    matchLabels:
      app: my-app
  namespaceSelector:
    matchNames:
      - demo
  endpoints:
    - port: metrics
      interval: 15s
      path: /metrics
      # 스크래핑 후 불필요한 메트릭을 드롭한다
      metricRelabelings:
        - sourceLabels: [__name__]
          regex: 'go_.*'
          action: drop
```

### 예제 2: Alert Rule 정의 (일반적인 패턴)
```yaml
# alert-rules.yaml
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: my-app-alerts
  namespace: monitoring
spec:
  groups:
    - name: my-app.rules
      rules:
        # Pod가 5분 이상 NotReady이면 알림
        - alert: PodNotReady
          expr: kube_pod_status_ready{condition="true"} == 0
          for: 5m
          labels:
            severity: warning
          annotations:
            summary: "Pod {{ $labels.pod }}가 Ready 상태가 아니다"

        # CPU 사용률이 80% 초과하면 알림
        - alert: HighCPUUsage
          expr: |
            100 - (avg by(instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100) > 80
          for: 10m
          labels:
            severity: critical
          annotations:
            summary: "노드 {{ $labels.instance }}의 CPU 사용률이 80%를 초과했다"

        # 메모리 사용률이 90% 초과하면 알림
        - alert: HighMemoryUsage
          expr: |
            (1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes) * 100 > 90
          for: 5m
          labels:
            severity: critical
          annotations:
            summary: "노드 {{ $labels.instance }}의 메모리 사용률이 90%를 초과했다"

        # 디스크 사용률이 85% 초과하면 알림
        - alert: DiskSpaceRunningOut
          expr: |
            (1 - node_filesystem_avail_bytes{fstype!~"tmpfs|overlay"} / node_filesystem_size_bytes) * 100 > 85
          for: 10m
          labels:
            severity: warning
          annotations:
            summary: "{{ $labels.instance }}의 {{ $labels.mountpoint }} 디스크 사용률이 85%를 초과했다"

        # Pod 재시작이 1시간에 3회 이상이면 알림
        - alert: PodFrequentRestart
          expr: |
            increase(kube_pod_container_status_restarts_total[1h]) > 3
          for: 0m
          labels:
            severity: warning
          annotations:
            summary: "Pod {{ $labels.pod }}가 1시간에 {{ $value }}번 재시작했다"

        # HTTP 에러율이 5% 초과하면 알림
        - alert: HighErrorRate
          expr: |
            sum(rate(http_requests_total{status=~"5.."}[5m])) by (service)
            / sum(rate(http_requests_total[5m])) by (service)
            * 100 > 5
          for: 5m
          labels:
            severity: critical
          annotations:
            summary: "{{ $labels.service }}의 HTTP 5xx 에러율이 {{ $value | printf \"%.1f\" }}%이다"

        # p99 응답시간이 1초 초과하면 알림
        - alert: HighLatency
          expr: |
            histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, service)) > 1
          for: 5m
          labels:
            severity: warning
          annotations:
            summary: "{{ $labels.service }}의 p99 응답시간이 {{ $value | printf \"%.2f\" }}초이다"
```

### 예제 3: Recording Rule 모범 사례
```yaml
# recording-rules.yaml
# 네이밍 컨벤션: level:metric:operations
# level = 집계 수준 (node, namespace, cluster)
# metric = 원본 메트릭 이름
# operations = 적용된 함수들
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: recording-rules
  namespace: monitoring
spec:
  groups:
    - name: node.recording.rules
      interval: 30s
      rules:
        # 노드별 CPU 사용률
        - record: node:cpu_utilization:ratio
          expr: |
            1 - avg by(instance) (rate(node_cpu_seconds_total{mode="idle"}[5m]))

        # 노드별 메모리 사용률
        - record: node:memory_utilization:ratio
          expr: |
            1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)

        # 노드별 디스크 사용률
        - record: node:disk_utilization:ratio
          expr: |
            1 - (node_filesystem_avail_bytes{fstype!~"tmpfs|overlay"} / node_filesystem_size_bytes)

    - name: namespace.recording.rules
      interval: 30s
      rules:
        # 네임스페이스별 CPU 사용량 합계
        - record: namespace:container_cpu_usage_seconds_total:sum_rate
          expr: |
            sum by(namespace) (rate(container_cpu_usage_seconds_total{image!=""}[5m]))

        # 네임스페이스별 메모리 사용량 합계
        - record: namespace:container_memory_working_set_bytes:sum
          expr: |
            sum by(namespace) (container_memory_working_set_bytes{image!=""})

        # 네임스페이스별 CPU 요청 대비 사용률
        - record: namespace:cpu_usage_vs_request:ratio
          expr: |
            sum by(namespace) (rate(container_cpu_usage_seconds_total{image!=""}[5m]))
            / sum by(namespace) (kube_pod_container_resource_requests{resource="cpu"})

    - name: cluster.recording.rules
      interval: 1m
      rules:
        # 클러스터 전체 CPU 할당률
        - record: cluster:cpu_allocation:ratio
          expr: |
            sum(kube_pod_container_resource_requests{resource="cpu"})
            / sum(kube_node_status_allocatable{resource="cpu"})

        # 클러스터 전체 메모리 할당률
        - record: cluster:memory_allocation:ratio
          expr: |
            sum(kube_pod_container_resource_requests{resource="memory"})
            / sum(kube_node_status_allocatable{resource="memory"})
```

---

## Federation

### Hierarchical Federation
여러 Prometheus 서버를 계층적으로 구성하여 대규모 환경을 모니터링하는 방식이다.

```
          ┌───────────────────────┐
          │  Global Prometheus    │
          │  (집계된 메트릭 저장)  │
          └───────┬───────────────┘
                  │ /federate
        ┌─────────┼─────────┐
        ▼         ▼         ▼
  ┌──────────┐ ┌──────────┐ ┌──────────┐
  │ DC-1     │ │ DC-2     │ │ DC-3     │
  │Prometheus│ │Prometheus│ │Prometheus│
  └──────────┘ └──────────┘ └──────────┘
```

```yaml
# Global Prometheus의 설정
scrape_configs:
  - job_name: 'federate'
    scrape_interval: 30s
    honor_labels: true  # 원본 라벨을 유지해야 한다
    metrics_path: '/federate'
    params:
      'match[]':
        # Recording Rule 결과만 가져온다 (데이터 양 최소화)
        - '{__name__=~"node:.*"}'
        - '{__name__=~"namespace:.*"}'
        - '{__name__=~"cluster:.*"}'
    static_configs:
      - targets:
          - 'prometheus-dc1:9090'
          - 'prometheus-dc2:9090'
          - 'prometheus-dc3:9090'
```

### Cross-Service Federation
서로 다른 팀/서비스의 Prometheus에서 필요한 메트릭만 가져오는 방식이다. 각 팀이 독립적인 Prometheus를 운영하면서도 서로의 메트릭을 참조할 수 있다.

---

## Remote Write/Read (장기 저장)

Prometheus의 로컬 TSDB는 단기 저장(기본 15일)에 적합하다. 장기 저장이 필요하면 Remote Write/Read 프로토콜을 사용하여 외부 스토리지와 연동한다.

### 주요 장기 저장 솔루션
| 솔루션 | 아키텍처 | 특징 |
|--------|---------|------|
| **Thanos** | 사이드카 패턴 + 오브젝트 스토리지 | Prometheus에 Sidecar를 붙여 블록을 S3/GCS에 업로드한다. 글로벌 뷰 쿼리가 가능하다 |
| **Cortex** | Push 기반 (Remote Write) | 멀티테넌트를 지원한다. 수평 확장 가능한 분산 아키텍처이다 |
| **Mimir** | Push 기반 (Remote Write) | Grafana Labs가 Cortex를 포크하여 발전시킨 프로젝트이다. 높은 성능과 간소화된 운영이 특징이다 |
| **VictoriaMetrics** | Remote Write 수신 | 높은 압축률과 빠른 쿼리 성능을 제공한다. PromQL 호환이다 |

### Remote Write 설정 예시
```yaml
# prometheus.yml
remote_write:
  - url: "http://mimir-distributor:9009/api/v1/push"
    queue_config:
      max_samples_per_send: 1000   # 한 번에 전송하는 최대 샘플 수
      max_shards: 200              # 병렬 전송 수
      capacity: 2500               # 큐 버퍼 크기
    write_relabel_configs:
      # 장기 저장이 필요한 메트릭만 전송한다
      - source_labels: [__name__]
        regex: 'go_.*|process_.*'
        action: drop

remote_read:
  - url: "http://mimir-query-frontend:9009/prometheus/api/v1/read"
    read_recent: false  # 최근 데이터는 로컬 TSDB에서 읽는다
```

### Thanos 아키텍처 개요
```
┌──────────────┐     ┌──────────────┐
│ Prometheus   │     │ Prometheus   │
│  + Sidecar   │     │  + Sidecar   │
└──────┬───────┘     └──────┬───────┘
       │ upload              │ upload
       ▼                     ▼
┌──────────────────────────────────┐
│       Object Storage (S3/GCS)    │
└──────────────┬───────────────────┘
               │ read
       ┌───────▼───────┐
       │  Thanos Store  │
       │  Gateway       │
       └───────┬───────┘
               │
       ┌───────▼───────┐
       │ Thanos Querier │  ← 글로벌 PromQL 쿼리
       └───────────────┘
```

---

## 자가 점검
- [ ] Pull 모델과 Push 모델의 차이를 설명할 수 있는가?
- [ ] Counter, Gauge, Histogram, Summary의 차이를 설명할 수 있는가?
- [ ] Histogram과 Summary 중 언제 어떤 것을 선택해야 하는지 설명할 수 있는가?
- [ ] PromQL로 CPU/메모리 사용률을 쿼리할 수 있는가?
- [ ] `rate()` 함수가 왜 Counter에 필수인지 설명할 수 있는가?
- [ ] `rate()`와 `irate()`의 차이를 설명할 수 있는가?
- [ ] Instant Vector와 Range Vector의 차이를 설명할 수 있는가?
- [ ] `histogram_quantile()`이 내부적으로 어떻게 동작하는지 설명할 수 있는가?
- [ ] `relabel_configs`와 `metric_relabel_configs`의 차이를 설명할 수 있는가?
- [ ] ServiceMonitor의 역할을 설명할 수 있는가?
- [ ] Recording Rule과 Alert Rule의 차이를 설명할 수 있는가?
- [ ] Recording Rule의 네이밍 컨벤션(`level:metric:operations`)을 설명할 수 있는가?
- [ ] TSDB의 WAL, Head Block, Persistent Block의 역할을 설명할 수 있는가?
- [ ] Gorilla 압축이 시계열 데이터를 어떻게 효율적으로 저장하는지 설명할 수 있는가?
- [ ] Staleness marker가 무엇이고 왜 5분인지 설명할 수 있는가?
- [ ] node-exporter와 kube-state-metrics의 차이를 설명할 수 있는가?
- [ ] Federation이 필요한 시나리오를 설명할 수 있는가?
- [ ] Remote Write/Read가 필요한 이유와 Thanos/Mimir의 차이를 설명할 수 있는가?

---

## 참고문헌

### 공식 문서
- [Prometheus 공식 문서](https://prometheus.io/docs/introduction/overview/) - 개념, 설정, PromQL 전반
- [Prometheus GitHub 리포지토리](https://github.com/prometheus/prometheus) - 소스 코드 및 릴리스
- [PromQL 공식 문서](https://prometheus.io/docs/prometheus/latest/querying/basics/) - 쿼리 문법 및 함수 레퍼런스
- [Storage 공식 문서](https://prometheus.io/docs/prometheus/latest/storage/) - TSDB 내부 구조 및 설정
- [Configuration 공식 문서](https://prometheus.io/docs/prometheus/latest/configuration/configuration/) - 전체 설정 레퍼런스
- [Recording Rules 공식 문서](https://prometheus.io/docs/prometheus/latest/configuration/recording_rules/) - Recording Rule 작성법
- [Alerting Rules 공식 문서](https://prometheus.io/docs/prometheus/latest/configuration/alerting_rules/) - Alert Rule 작성법
- [Federation 공식 문서](https://prometheus.io/docs/prometheus/latest/federation/) - Federation 설정
- [Remote Write/Read 공식 문서](https://prometheus.io/docs/prometheus/latest/configuration/configuration/#remote_write) - 장기 저장 연동

### Exporter
- [node-exporter GitHub](https://github.com/prometheus/node_exporter) - 호스트 메트릭 수집기
- [kube-state-metrics GitHub](https://github.com/kubernetes/kube-state-metrics) - Kubernetes 객체 상태 메트릭
- [Prometheus Operator GitHub](https://github.com/prometheus-operator/prometheus-operator) - Kubernetes 환경의 Prometheus 관리

### 장기 저장 솔루션
- [Thanos 공식 문서](https://thanos.io/tip/thanos/getting-started.md/) - 글로벌 뷰 및 장기 저장
- [Grafana Mimir 공식 문서](https://grafana.com/docs/mimir/latest/) - 확장 가능한 장기 저장
- [VictoriaMetrics 공식 문서](https://docs.victoriametrics.com/) - 고성능 시계열 데이터베이스

### 참고 논문 및 블로그
- [Gorilla: A Fast, Scalable, In-Memory Time Series Database (Facebook, 2015)](http://www.vldb.org/pvldb/vol8/p1816-teller.pdf) - Prometheus TSDB 압축 알고리즘의 원본 논문
- [Writing a Time Series Database from Scratch (Fabian Reinartz, 2017)](https://fabxc.org/tsdb/) - Prometheus TSDB 개발자가 쓴 TSDB 설계 문서
