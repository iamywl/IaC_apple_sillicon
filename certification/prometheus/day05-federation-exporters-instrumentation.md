# Day 5: Federation, Push Gateway, Exporters, Instrumentation

> Prometheus Federation 구성, Push Gateway 활용, 주요 Exporter(Node, kube-state-metrics, cAdvisor 등) 심화, 애플리케이션 계측(Instrumentation) 방법을 학습한다.

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

```yaml
# 팀 A의 Prometheus가 팀 B의 SLI 메트릭을 가져오는 설정
scrape_configs:
  - job_name: 'team-b-federate'
    scrape_interval: 60s
    honor_labels: true
    metrics_path: '/federate'
    params:
      'match[]':
        - 'job:http_requests:rate5m{team="b"}'
        - 'job:http_errors:rate5m{team="b"}'
    static_configs:
      - targets:
          - 'prometheus-team-b:9090'
```

### Federation 주의사항

1. **성능**: Federation 쿼리는 원본 Prometheus에 부하를 줄 수 있다. Recording Rule 결과만 가져오는 것이 중요하다
2. **지연**: Federation은 scrape_interval 간격으로 데이터를 가져오므로, 실시간 데이터보다 최대 scrape_interval만큼 지연된다
3. **honor_labels**: 반드시 `true`로 설정해야 원본 라벨이 유지된다. `false`이면 `job`, `instance` 라벨이 Federation Prometheus의 값으로 덮어써진다
4. **대안**: Thanos/Mimir를 사용하면 Federation 없이 글로벌 뷰를 구현할 수 있다

---

## Push Gateway

### 개요

Pushgateway는 단기 실행 작업(batch job, cron job 등)의 메트릭을 Prometheus가 수집할 수 있도록 중간에서 메트릭을 캐싱하는 서비스이다.

```
┌──────────────┐    push     ┌──────────────┐    scrape    ┌──────────────┐
│  Batch Job   │ ──────────▶ │ Pushgateway  │ ◀─────────── │  Prometheus  │
│  (단기 실행)  │             │              │              │              │
└──────────────┘             └──────────────┘              └──────────────┘
```

### 사용 시나리오

```bash
# 메트릭을 Pushgateway에 전송하는 예시
# 형식: echo '<metric_name> <value>' | curl --data-binary @- <pushgateway>/metrics/job/<job_name>

# Batch Job 실행 시간 전송
echo "batch_job_duration_seconds 45.2" | curl --data-binary @- \
  http://pushgateway:9091/metrics/job/data_migration

# 여러 메트릭 한 번에 전송
cat <<EOF | curl --data-binary @- http://pushgateway:9091/metrics/job/backup/instance/db1
backup_duration_seconds 120.5
backup_size_bytes 1073741824
backup_success 1
EOF

# 메트릭 삭제 (Job 완료 후)
curl -X DELETE http://pushgateway:9091/metrics/job/data_migration
```

### 주의사항

Pushgateway는 다음의 이유로 **가능하면 사용을 피해야 한다**.

1. **단일 장애점**: Pushgateway가 다운되면 모든 Push 메트릭이 유실된다
2. **Staleness 미적용**: Pushgateway에 한번 Push된 메트릭은 명시적으로 삭제할 때까지 남아있다. Batch Job이 실패해도 마지막 성공 메트릭이 계속 노출된다
3. **자동 헬스체크 불가**: Pull 모델의 장점인 "스크래핑 실패 = 타겟 다운" 감지가 불가능하다
4. **honor_labels 필수**: Pushgateway에서 오는 메트릭의 원본 라벨을 유지하려면 `honor_labels: true`가 필요하다

#### 대안

```
# Pushgateway 대신 고려할 방법:
# 1. Textfile Collector (node_exporter)
#    - Batch Job이 파일에 메트릭을 쓰고, node_exporter가 읽는다
#    - 파일 경로: /var/lib/node_exporter/textfile_collector/*.prom

# 2. Prometheus Remote Write
#    - 단기 실행 프로세스에서 직접 Remote Write로 전송한다

# 3. 충분히 긴 scrape_interval
#    - 작업 시간이 scrape_interval보다 길면 일반 Pull 모델로 수집 가능하다
```

---

## Exporters 심화

### node_exporter 상세

#### 개요
node-exporter는 Linux/Unix 호스트의 하드웨어 및 OS 수준 메트릭을 노출하는 공식 Prometheus exporter이다. Kubernetes에서는 DaemonSet으로 배포하여 모든 노드에서 실행한다.

#### Collector 목록

node_exporter는 다양한 collector로 구성되며, 각 collector는 특정 커널 인터페이스에서 메트릭을 수집한다.

| Collector | 소스 | 메트릭 예시 | 기본 활성화 |
|-----------|------|-----------|------------|
| `cpu` | `/proc/stat` | `node_cpu_seconds_total` | Yes |
| `meminfo` | `/proc/meminfo` | `node_memory_MemTotal_bytes` | Yes |
| `filesystem` | `/proc/mounts` | `node_filesystem_avail_bytes` | Yes |
| `diskstats` | `/proc/diskstats` | `node_disk_read_bytes_total` | Yes |
| `netdev` | `/proc/net/dev` | `node_network_receive_bytes_total` | Yes |
| `loadavg` | `/proc/loadavg` | `node_load1` | Yes |
| `uname` | `uname()` | `node_uname_info` | Yes |
| `vmstat` | `/proc/vmstat` | `node_vmstat_pgfault` | Yes |
| `conntrack` | `/proc/sys/net/netfilter` | `node_nf_conntrack_entries` | Yes |
| `entropy` | `/proc/sys/kernel/random` | `node_entropy_avail_bits` | Yes |
| `textfile` | 사용자 정의 파일 | 사용자 정의 | Yes |
| `systemd` | systemd D-Bus | `node_systemd_unit_state` | No |
| `processes` | `/proc` | `node_processes_*` | No |

#### 주요 메트릭
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

#### 핵심 모니터링 쿼리
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

### kube-state-metrics 상세

#### 개요
kube-state-metrics(KSM)는 Kubernetes API 서버를 감시하여 Kubernetes 객체(Pod, Deployment, Node 등)의 상태를 Prometheus 메트릭으로 노출하는 서비스이다. node-exporter가 "머신"의 상태를 보여준다면, KSM은 "Kubernetes 오케스트레이션"의 상태를 보여준다.

#### node-exporter와의 차이
| 항목 | node-exporter | kube-state-metrics |
|------|--------------|-------------------|
| 대상 | 호스트(OS/하드웨어) | Kubernetes 객체 |
| 배포 방식 | DaemonSet (노드당 1개) | Deployment (클러스터당 1개) |
| 데이터 소스 | `/proc`, `/sys` 등 커널 인터페이스 | Kubernetes API Server |
| 메트릭 예시 | CPU, 메모리, 디스크, 네트워크 | Pod 상태, Deployment replica 수, Job 성공/실패 |

#### 주요 메트릭
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

#### 핵심 모니터링 쿼리
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

### blackbox_exporter

blackbox_exporter는 HTTP, HTTPS, DNS, TCP, ICMP 프로토콜을 사용하여 외부에서 대상의 가용성을 확인하는 exporter이다.

#### 설정 예시

```yaml
# blackbox.yml
modules:
  http_2xx:
    prober: http
    timeout: 5s
    http:
      valid_http_versions: ["HTTP/1.1", "HTTP/2.0"]
      valid_status_codes: [200]
      method: GET
      follow_redirects: true
      fail_if_ssl: false
      fail_if_not_ssl: false
      preferred_ip_protocol: "ip4"

  http_post_2xx:
    prober: http
    http:
      method: POST
      headers:
        Content-Type: application/json
      body: '{"test": true}'

  tcp_connect:
    prober: tcp
    timeout: 5s

  dns_lookup:
    prober: dns
    dns:
      query_name: "example.com"
      query_type: "A"
      valid_rcodes:
        - NOERROR

  icmp_check:
    prober: icmp
    timeout: 5s
    icmp:
      preferred_ip_protocol: "ip4"
```

#### Prometheus 스크래핑 설정

```yaml
scrape_configs:
  - job_name: 'blackbox-http'
    metrics_path: /probe
    params:
      module: [http_2xx]
    static_configs:
      - targets:
          - https://example.com
          - https://api.example.com/health
    relabel_configs:
      # __param_target에 대상 URL을 설정한다
      - source_labels: [__address__]
        target_label: __param_target
      # instance 라벨을 대상 URL로 설정한다
      - source_labels: [__param_target]
        target_label: instance
      # 실제 스크래핑 대상은 blackbox_exporter이다
      - target_label: __address__
        replacement: blackbox-exporter:9115
```

#### 주요 메트릭

```promql
# Probe 성공 여부 (1=성공, 0=실패)
probe_success

# Probe 소요 시간 (초)
probe_duration_seconds

# HTTP 상태 코드
probe_http_status_code

# SSL 인증서 만료까지 남은 시간 (초)
probe_ssl_earliest_cert_expiry - time()

# DNS 조회 시간 (초)
probe_dns_lookup_time_seconds

# HTTP 응답 크기 (바이트)
probe_http_content_length
```

### Custom Exporter 작성 (Go)

```go
package main

import (
    "net/http"

    "github.com/prometheus/client_golang/prometheus"
    "github.com/prometheus/client_golang/prometheus/promhttp"
)

// 메트릭 정의
var (
    requestsTotal = prometheus.NewCounterVec(
        prometheus.CounterOpts{
            Name: "myapp_requests_total",
            Help: "Total number of requests",
        },
        []string{"method", "status"},
    )

    requestDuration = prometheus.NewHistogramVec(
        prometheus.HistogramOpts{
            Name:    "myapp_request_duration_seconds",
            Help:    "Request duration in seconds",
            Buckets: prometheus.DefBuckets,
        },
        []string{"method"},
    )

    activeConnections = prometheus.NewGauge(
        prometheus.GaugeOpts{
            Name: "myapp_active_connections",
            Help: "Number of active connections",
        },
    )
)

func init() {
    prometheus.MustRegister(requestsTotal)
    prometheus.MustRegister(requestDuration)
    prometheus.MustRegister(activeConnections)
}

func main() {
    http.Handle("/metrics", promhttp.Handler())
    http.ListenAndServe(":8080", nil)
}
```

---

## Instrumentation (계측)

### Client Library 사용법

#### Go Client

```go
import (
    "github.com/prometheus/client_golang/prometheus"
    "github.com/prometheus/client_golang/prometheus/promauto"
    "github.com/prometheus/client_golang/prometheus/promhttp"
)

// promauto를 사용하면 자동으로 등록된다
var (
    httpRequestsTotal = promauto.NewCounterVec(
        prometheus.CounterOpts{
            Namespace: "myapp",
            Subsystem: "http",
            Name:      "requests_total",
            Help:      "Total HTTP requests",
        },
        []string{"method", "status_code", "path"},
    )
)

// 미들웨어에서 메트릭 기록
func metricsMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        timer := prometheus.NewTimer(httpRequestDuration.WithLabelValues(r.Method))
        defer timer.ObserveDuration()

        rw := &responseWriter{w, http.StatusOK}
        next.ServeHTTP(rw, r)

        httpRequestsTotal.WithLabelValues(
            r.Method,
            fmt.Sprintf("%d", rw.statusCode),
            r.URL.Path,
        ).Inc()
    })
}
```

#### Python Client

```python
from prometheus_client import Counter, Histogram, Gauge, start_http_server
import time

# 메트릭 정의
REQUEST_COUNT = Counter(
    'myapp_requests_total',
    'Total requests',
    ['method', 'endpoint', 'status']
)

REQUEST_LATENCY = Histogram(
    'myapp_request_duration_seconds',
    'Request latency',
    ['method', 'endpoint'],
    buckets=[0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0]
)

ACTIVE_REQUESTS = Gauge(
    'myapp_active_requests',
    'Currently active requests'
)

# 데코레이터로 사용
@REQUEST_LATENCY.labels(method='GET', endpoint='/api/users').time()
def get_users():
    pass

# 컨텍스트 매니저로 사용
with REQUEST_LATENCY.labels(method='POST', endpoint='/api/users').time():
    create_user()

# /metrics 엔드포인트 시작
start_http_server(8000)
```

#### Java Client (Micrometer)

```java
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;

@Component
public class OrderService {
    private final Counter ordersCreated;
    private final Timer orderProcessingTime;

    public OrderService(MeterRegistry registry) {
        this.ordersCreated = Counter.builder("orders_created_total")
            .description("Total orders created")
            .tag("type", "online")
            .register(registry);

        this.orderProcessingTime = Timer.builder("order_processing_duration_seconds")
            .description("Order processing duration")
            .publishPercentiles(0.5, 0.95, 0.99)
            .register(registry);
    }

    public void createOrder(Order order) {
        orderProcessingTime.record(() -> {
            // 주문 처리 로직
            ordersCreated.increment();
        });
    }
}
```

### Label Cardinality 관리

#### 카디널리티란?

카디널리티(cardinality)는 특정 메트릭의 고유한 시계열 수를 의미한다. 라벨 값의 조합이 많을수록 카디널리티가 높아진다.

```
# 낮은 카디널리티 (좋음):
# method: GET, POST, PUT, DELETE (4가지)
# status: 200, 201, 400, 404, 500 (5가지)
# 총 시계열: 4 * 5 = 20개

# 높은 카디널리티 (위험):
# user_id: 100만 고유 사용자 (1,000,000가지)
# method: 4가지
# 총 시계열: 4,000,000개 -> OOM 위험!
```

#### 카디널리티 폭발 방지 규칙

```
# 1. 바운드된 라벨 값만 사용한다
#    (O) method="GET"     -> 값이 제한됨
#    (X) user_id="12345"  -> 값이 무제한

# 2. 라벨 값으로 사용하면 안 되는 것들:
#    - 사용자 ID, 세션 ID, 요청 ID
#    - IP 주소 (instance 라벨 제외)
#    - 이메일 주소
#    - 타임스탬프
#    - 에러 메시지 (정규화하지 않은)
#    - URL 경로 (정규화하지 않은, 예: /users/12345)

# 3. URL 경로 정규화:
#    (X) path="/users/12345"
#    (O) path="/users/:id"

# 4. 에러 메시지 정규화:
#    (X) error="connection refused: 10.0.0.5:3306"
#    (O) error="connection_refused"
```

#### 카디널리티 모니터링

```promql
# TSDB의 총 시계열 수
prometheus_tsdb_head_series

# 메트릭 이름별 시계열 수 (상위 10개)
# Prometheus UI > Status > TSDB Status 에서 확인 가능

# 또는 API로 확인
# curl http://localhost:9090/api/v1/status/tsdb | jq '.data.seriesCountByMetricName[:10]'

# 스크래핑당 샘플 수 (타겟별)
scrape_samples_scraped

# 높은 카디널리티 감지 알림
- alert: HighCardinality
  expr: prometheus_tsdb_head_series > 1000000
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: "활성 시계열이 {{ $value }}개로 높은 카디널리티 상태이다"
```

---

