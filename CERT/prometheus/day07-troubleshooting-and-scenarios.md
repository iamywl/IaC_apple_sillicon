# Day 7: 트러블슈팅 및 실전 시나리오

> Prometheus 운영 시 자주 발생하는 문제의 진단 및 해결, 실전 시나리오(SLO 모니터링, 카나리 배포 메트릭, 멀티클러스터 등)를 학습한다.

## 트러블슈팅

### TSDB 이슈

#### WAL 손상 복구

```bash
# WAL 손상 감지
# 증상: Prometheus 시작 실패, 로그에 "wal: corruption" 메시지

# 1. WAL 파일 검사
promtool tsdb analyze /prometheus

# 2. WAL 복구 시도 (손상된 세그먼트 건너뛰기)
# Prometheus 2.10+ 에서는 자동으로 손상된 WAL 세그먼트를 건너뛴다
# 시작 플래그: --storage.tsdb.wal-compression (WAL 무결성 향상)

# 3. 최악의 경우: WAL 삭제 후 재시작 (데이터 유실 발생)
# kubectl exec -n monitoring prometheus-pod -- rm -rf /prometheus/wal/*
# 주의: Head block의 최근 데이터가 유실된다
```

#### 블록 손상

```bash
# 블록 손상 감지
# 증상: 특정 시간 범위의 쿼리가 실패하거나 빈 결과 반환

# 1. 블록 검사
promtool tsdb analyze /prometheus

# 2. 손상된 블록 확인
ls -la /prometheus/  # ULID 디렉터리 확인
cat /prometheus/01BKGV7JBM69T2G1BGBGM6KB12/meta.json  # 블록 메타데이터

# 3. 손상된 블록 삭제 (해당 시간 범위의 데이터 유실)
rm -rf /prometheus/01BKGV7JBM69T2G1BGBGM6KB12/
```

### High Cardinality 대응

```promql
# 1. 카디널리티가 높은 메트릭 확인
# Prometheus UI > Status > TSDB Status

# 2. 메트릭별 시계열 수 API 조회
# curl -s http://localhost:9090/api/v1/status/tsdb | jq '.data.seriesCountByMetricName[:10]'

# 3. 라벨별 고유 값 수 조회
# curl -s http://localhost:9090/api/v1/status/tsdb | jq '.data.labelValueCountByLabelName[:10]'

# 4. 특정 메트릭의 라벨 조합 확인
count by (__name__) ({__name__=~"http_.*"})
```

#### 대응 방법

```yaml
# 1. metric_relabel_configs로 불필요한 메트릭 드롭
metric_relabel_configs:
  - source_labels: [__name__]
    regex: 'etcd_debugging_.*|apiserver_admission_.*'
    action: drop

# 2. 높은 카디널리티 라벨 드롭
metric_relabel_configs:
  - regex: 'le'  # histogram 버킷을 드롭하면 카디널리티가 크게 줄어든다
    action: labeldrop  # 주의: histogram_quantile()을 사용할 수 없게 된다

# 3. sample_limit 설정
scrape_configs:
  - job_name: 'risky-exporter'
    sample_limit: 10000  # 10000개 초과 시 스크래핑 실패

# 4. target_limit 설정 (Service Discovery로 너무 많은 타겟이 발견되는 경우)
scrape_configs:
  - job_name: 'dynamic-targets'
    target_limit: 100
```

### OOM (Out Of Memory) 대응

```bash
# 증상: Prometheus Pod가 OOMKilled로 재시작

# 1. 현재 메모리 사용량 확인
kubectl top pod -n monitoring -l app.kubernetes.io/name=prometheus

# 2. 활성 시계열 수 확인
curl -s http://localhost:9090/api/v1/query?query=prometheus_tsdb_head_series | jq '.data.result[0].value[1]'

# 3. 메모리 limit 증가
# manifests/monitoring-values.yaml에서:
# prometheus.prometheusSpec.resources.limits.memory를 늘린다

# 4. 카디널리티 줄이기 (근본적 해결)
# - 불필요한 메트릭 드롭
# - scrape_interval 늘리기
# - 불필요한 타겟 제거

# 5. 메모리 사용량 모니터링 알림 설정
- alert: PrometheusMemoryHigh
  expr: |
    process_resident_memory_bytes{job="prometheus"}
    / on() kube_pod_container_resource_limits{namespace="monitoring", container="prometheus", resource="memory"}
    > 0.8
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: "Prometheus 메모리 사용률이 80%를 초과했다"
```

### Slow Query 대응

```promql
# 1. 느린 쿼리 확인 (Prometheus 자체 메트릭)
# 쿼리 실행 시간 분포
prometheus_engine_query_duration_seconds

# 쿼리 수
prometheus_engine_queries

# 동시 실행 쿼리 수
prometheus_engine_queries_concurrent_max

# 2. 일반적인 느린 쿼리 원인과 해결:

# 원인: 높은 카디널리티 집계
# (느림) sum by (pod) (rate(http_requests_total[5m]))  -- pod가 수천 개
# (빠름) sum by (namespace) (rate(http_requests_total[5m]))  -- namespace는 수십 개

# 원인: 넓은 시간 범위
# (느림) rate(http_requests_total[7d])
# (빠름) Recording Rule을 사용하고, 그 결과를 쿼리

# 원인: 정규식 매칭
# (느림) {__name__=~".+"}  -- 모든 메트릭
# (빠름) {__name__="http_requests_total"}  -- 특정 메트릭

# 원인: Subquery
# (느림) max_over_time(rate(x[5m])[7d:1m])
# (빠름) Recording Rule로 rate(x[5m])을 사전 계산 후 max_over_time 적용
```

#### 쿼리 성능 설정

```yaml
# Prometheus 시작 플래그
--query.max-concurrency=20       # 최대 동시 쿼리 수 (기본: 20)
--query.timeout=2m               # 쿼리 타임아웃 (기본: 2m)
--query.max-samples=50000000     # 쿼리당 최대 샘플 수 (기본: 50M)
--query.lookback-delta=5m        # staleness lookback 기간 (기본: 5m)
```

### Target Scraping 실패

```bash
# 1. 타겟 상태 확인
# Prometheus UI > Status > Targets

# 2. 특정 타겟의 /metrics 직접 확인
kubectl exec -n monitoring prometheus-pod -- \
  curl -s http://target-ip:port/metrics | head -20

# 3. 일반적인 실패 원인:

# 원인: NetworkPolicy 차단
# 해결: Prometheus에서 타겟으로의 Egress를 허용하는 NetworkPolicy 추가

# 원인: Service/Endpoint가 없음
# 해결: kubectl get endpoints <service> -n <namespace>로 확인

# 원인: 타겟의 /metrics 엔드포인트가 없음
# 해결: 애플리케이션에 메트릭 엔드포인트 추가

# 원인: TLS/인증 설정 불일치
# 해결: ServiceMonitor의 tlsConfig, basicAuth 설정 확인

# 원인: scrape_timeout 초과
# 해결: scrapeTimeout을 늘리거나, 타겟의 메트릭 수를 줄인다

# 4. Prometheus 로그에서 에러 확인
kubectl logs -n monitoring -l app.kubernetes.io/name=prometheus | grep -i error
```

### Config Reload 실패

```bash
# 1. 설정 검증
promtool check config prometheus.yml

# 2. 수동 reload
curl -X POST http://localhost:9090/-/reload

# 3. Operator가 관리하는 설정 확인
kubectl get secret -n monitoring prometheus-kube-prometheus-stack-prometheus -o yaml

# 4. Operator 로그 확인
kubectl logs -n monitoring -l app.kubernetes.io/name=prometheus-operator | tail -50

# 5. 설정 reload 성공/실패 메트릭
prometheus_config_last_reload_successful  # 1=성공, 0=실패
prometheus_config_last_reload_success_timestamp_seconds  # 마지막 성공 시각
```

---

## 실전 시나리오

### USE Method (Utilization, Saturation, Errors)

Brendan Gregg가 제안한 시스템 리소스 모니터링 방법론이다. 모든 리소스에 대해 Utilization, Saturation, Errors를 측정한다.

| 리소스 | Utilization (사용률) | Saturation (포화도) | Errors |
|--------|---------------------|-------------------|--------|
| CPU | `1 - avg(rate(node_cpu_seconds_total{mode="idle"}[5m]))` | `node_load1 / count(node_cpu_seconds_total{mode="idle"})` | `rate(node_cpu_seconds_total{mode="steal"}[5m])` |
| Memory | `1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes` | `rate(node_vmstat_pgmajfault[5m])` | (특정 에러 없음) |
| Disk I/O | `rate(node_disk_io_time_seconds_total[5m])` | `rate(node_disk_io_time_weighted_seconds_total[5m])` | `rate(node_disk_read_errors_total[5m])` |
| Network | `rate(node_network_receive_bytes_total[5m]) / <bandwidth>` | `rate(node_network_receive_drop_total[5m])` | `rate(node_network_receive_errs_total[5m])` |

```promql
# USE Method 대시보드 쿼리 모음

# CPU Utilization
1 - avg by(instance) (rate(node_cpu_seconds_total{mode="idle"}[5m]))

# CPU Saturation (로드 평균 / CPU 코어 수)
node_load1 / count without(cpu, mode) (node_cpu_seconds_total{mode="idle"})

# Memory Utilization
1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)

# Memory Saturation (major page faults)
rate(node_vmstat_pgmajfault[5m])

# Disk I/O Utilization
rate(node_disk_io_time_seconds_total[5m])

# Disk I/O Saturation (가중 I/O 시간)
rate(node_disk_io_time_weighted_seconds_total[5m])

# Network Utilization (수신, Mbps)
rate(node_network_receive_bytes_total{device!~"lo|veth.*"}[5m]) * 8 / 1e6

# Network Errors
rate(node_network_receive_errs_total[5m]) + rate(node_network_transmit_errs_total[5m])
```

### RED Method (Rate, Errors, Duration)

Tom Wilkie가 제안한 서비스 모니터링 방법론이다. 모든 서비스에 대해 Rate, Errors, Duration을 측정한다.

| 항목 | 의미 | PromQL |
|------|------|--------|
| Rate | 초당 요청 수 | `sum(rate(http_requests_total[5m])) by (service)` |
| Errors | 에러율 | `sum(rate(http_requests_total{status=~"5.."}[5m])) by (service) / sum(rate(http_requests_total[5m])) by (service)` |
| Duration | 응답 시간 분포 | `histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, service))` |

```promql
# RED Method 대시보드 쿼리 모음

# Rate: 서비스별 초당 요청 수
sum(rate(http_requests_total[5m])) by (service)

# Errors: 서비스별 에러율 (%)
sum(rate(http_requests_total{status=~"5.."}[5m])) by (service)
/ sum(rate(http_requests_total[5m])) by (service) * 100

# Duration: 서비스별 p50 응답 시간
histogram_quantile(0.50,
  sum(rate(http_request_duration_seconds_bucket[5m])) by (le, service)
)

# Duration: 서비스별 p95 응답 시간
histogram_quantile(0.95,
  sum(rate(http_request_duration_seconds_bucket[5m])) by (le, service)
)

# Duration: 서비스별 p99 응답 시간
histogram_quantile(0.99,
  sum(rate(http_request_duration_seconds_bucket[5m])) by (le, service)
)

# Duration: 평균 응답 시간
sum(rate(http_request_duration_seconds_sum[5m])) by (service)
/ sum(rate(http_request_duration_seconds_count[5m])) by (service)
```

### SLI/SLO 모니터링

#### 개념

```
SLI (Service Level Indicator): 서비스 품질을 측정하는 지표
  예: 요청의 99%가 200ms 이내에 응답한다

SLO (Service Level Objective): SLI의 목표 값
  예: 30일 동안 SLI가 99.9% 이상이어야 한다

Error Budget: SLO에서 허용하는 에러 비율
  예: 99.9% SLO → 0.1% Error Budget → 30일 중 약 43분의 다운타임 허용
```

#### SLI 정의 패턴

```promql
# 1. 가용성 SLI (성공률)
# 성공한 요청 비율
sum(rate(http_requests_total{status!~"5.."}[30d]))
/ sum(rate(http_requests_total[30d]))

# 2. 지연 시간 SLI
# 200ms 이내에 응답한 요청 비율
sum(rate(http_request_duration_seconds_bucket{le="0.2"}[30d]))
/ sum(rate(http_request_duration_seconds_count[30d]))

# 3. 처리량 SLI
# 초당 처리 가능한 최소 요청 수
sum(rate(http_requests_total[5m])) > bool 100
```

#### Error Budget 계산

```promql
# SLO: 99.9% 가용성 (30일 기준)

# 현재 가용성 (30일 rolling)
1 - (
  sum(rate(http_requests_total{status=~"5.."}[30d]))
  / sum(rate(http_requests_total[30d]))
)

# Error Budget 잔여량 (%)
# 0%이면 Error Budget 소진, 100%이면 에러 없음
(
  1 - (
    sum(rate(http_requests_total{status=~"5.."}[30d]))
    / sum(rate(http_requests_total[30d]))
  )
  - 0.999
) / 0.001 * 100

# Error Budget 소진 속도 기반 알림
# burn rate = 실제 에러율 / 허용 에러율
# burn rate > 1이면 Error Budget이 줄어들고 있다

# 빠른 소진 알림 (1시간 기준, burn rate 14.4x)
- alert: ErrorBudgetFastBurn
  expr: |
    (
      sum(rate(http_requests_total{status=~"5.."}[1h]))
      / sum(rate(http_requests_total[1h]))
    ) > (14.4 * 0.001)
  for: 2m
  labels:
    severity: critical
  annotations:
    summary: "Error Budget이 빠르게 소진되고 있다 (1시간 burn rate)"

# 느린 소진 알림 (6시간 기준, burn rate 6x)
- alert: ErrorBudgetSlowBurn
  expr: |
    (
      sum(rate(http_requests_total{status=~"5.."}[6h]))
      / sum(rate(http_requests_total[6h]))
    ) > (6 * 0.001)
  for: 15m
  labels:
    severity: warning
  annotations:
    summary: "Error Budget이 소진되고 있다 (6시간 burn rate)"
```

#### Multi-Window, Multi-Burn-Rate SLO Alerting

Google SRE 책에서 권장하는 알림 전략이다.

```yaml
# 빠른 소진 (1시간 window, 14.4x burn rate)
# → 2분 내에 감지, critical
# → 전체 Error Budget의 2%를 1시간에 소진하는 속도

# 중간 소진 (6시간 window, 6x burn rate)
# → 15분 내에 감지, critical
# → 전체 Error Budget의 5%를 6시간에 소진하는 속도

# 느린 소진 (3일 window, 1x burn rate)
# → 1시간 내에 감지, warning
# → Error Budget이 정상 속도로 소진 중
```

### Kubernetes 모니터링 종합 시나리오

이 프로젝트의 platform 클러스터에서 사용할 수 있는 종합 모니터링 쿼리 모음이다.

```promql
# === 클러스터 수준 ===

# 전체 CPU 사용률
sum(rate(container_cpu_usage_seconds_total{image!=""}[5m]))
/ sum(kube_node_status_allocatable{resource="cpu"}) * 100

# 전체 메모리 사용률
sum(container_memory_working_set_bytes{image!=""})
/ sum(kube_node_status_allocatable{resource="memory"}) * 100

# 노드 수
count(kube_node_info)

# Running Pod 수
count(kube_pod_status_phase{phase="Running"})

# === 네임스페이스 수준 ===

# 네임스페이스별 CPU 사용량
sum by(namespace) (rate(container_cpu_usage_seconds_total{image!=""}[5m]))

# 네임스페이스별 메모리 사용량
sum by(namespace) (container_memory_working_set_bytes{image!=""})

# 네임스페이스별 Pod 수
count by(namespace) (kube_pod_info)

# === Workload 수준 ===

# Deployment 건강 상태
kube_deployment_status_replicas_available / kube_deployment_spec_replicas

# StatefulSet 건강 상태
kube_statefulset_status_replicas_ready / kube_statefulset_replicas

# DaemonSet 건강 상태
kube_daemonset_status_number_available / kube_daemonset_status_desired_number_scheduled

# === Pod 수준 ===

# Pod CPU 사용량 vs Request
sum by(pod, namespace) (rate(container_cpu_usage_seconds_total{image!=""}[5m]))
/ sum by(pod, namespace) (kube_pod_container_resource_requests{resource="cpu"})

# Pod 메모리 사용량 vs Limit
sum by(pod, namespace) (container_memory_working_set_bytes{image!=""})
/ sum by(pod, namespace) (kube_pod_container_resource_limits{resource="memory"})

# OOMKill 이벤트
increase(kube_pod_container_status_restarts_total[1h]) > 0
and on(pod, namespace) kube_pod_container_status_last_terminated_reason{reason="OOMKilled"}
```

---

