# Day 8: 실습, 예제, 자가 점검

> 실습 과제, 예제 시나리오, 자가 점검 문제를 통해 Prometheus 학습 내용을 종합적으로 정리한다.

## 실습

### 실습 1: Prometheus UI 접속
```bash
# Prometheus 포트포워딩
kubectl port-forward -n monitoring svc/kube-prometheus-stack-prometheus 9090:9090

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
export KUBECONFIG=kubeconfig/platform.yaml
kubectl get servicemonitor -A

# ServiceMonitor 상세 정보
kubectl describe servicemonitor <name> -n monitoring

# PrometheusRule 확인
kubectl get prometheusrule -A

# 프로젝트의 Prometheus 설정 확인
cat manifests/monitoring-values.yaml
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

### 실습 6: 카디널리티 분석
```bash
# TSDB 상태 API로 카디널리티 분석
export KUBECONFIG=kubeconfig/platform.yaml
kubectl port-forward -n monitoring svc/kube-prometheus-stack-prometheus 9090:9090

# 메트릭별 시계열 수 (상위 20개)
curl -s http://localhost:9090/api/v1/status/tsdb | jq '.data.seriesCountByMetricName[:20]'

# 라벨별 고유 값 수 (상위 20개)
curl -s http://localhost:9090/api/v1/status/tsdb | jq '.data.labelValueCountByLabelName[:20]'

# 라벨 쌍별 시계열 수 (상위 20개)
curl -s http://localhost:9090/api/v1/status/tsdb | jq '.data.seriesCountByLabelValuePair[:20]'

# 메모리 사용량 확인
curl -s http://localhost:9090/api/v1/query?query=process_resident_memory_bytes | jq '.data.result[0].value[1]'
```

### 실습 7: Alert Rule 테스트
```bash
# 프로젝트의 Alert Rule 확인
export KUBECONFIG=kubeconfig/platform.yaml
kubectl get prometheusrule -n monitoring

# 현재 firing 중인 알림 확인
curl -s http://localhost:9090/api/v1/alerts | jq '.data.alerts[] | select(.state=="firing")'

# Alertmanager에서 알림 확인
kubectl port-forward -n monitoring svc/kube-prometheus-stack-alertmanager 9093:9093
curl -s http://localhost:9093/api/v2/alerts | jq .

# 의도적으로 알림 트리거 (테스트용)
# 존재하지 않는 타겟의 up 메트릭으로 absent() 테스트
curl -s "http://localhost:9090/api/v1/query?query=absent(up{job=\"nonexistent\"})" | jq .
```

### 실습 8: Prometheus 자체 메트릭 모니터링

```promql
# Prometheus 자체 상태 모니터링 쿼리 모음

# 1. 수집 성능
rate(prometheus_tsdb_head_samples_appended_total[5m])  # 초당 샘플 수집 수

# 2. TSDB 상태
prometheus_tsdb_head_series                             # 활성 시계열 수
prometheus_tsdb_head_chunks                             # 활성 청크 수
prometheus_tsdb_blocks_loaded                           # 로드된 블록 수

# 3. 메모리 사용
process_resident_memory_bytes / 1024 / 1024             # RSS 메모리 (MB)
go_memstats_heap_inuse_bytes / 1024 / 1024              # Go 힙 메모리 (MB)

# 4. 스크래핑 상태
scrape_duration_seconds                                 # 스크래핑 소요 시간
scrape_samples_scraped                                  # 스크래핑당 샘플 수
sum(up) / count(up)                                     # 타겟 가용률

# 5. 쿼리 성능
rate(prometheus_engine_query_duration_seconds_sum[5m])   # 쿼리 실행 시간
prometheus_engine_queries                                # 동시 쿼리 수

# 6. Rule 평가
prometheus_rule_evaluation_duration_seconds              # Rule 평가 시간
prometheus_rule_group_iterations_missed_total            # 건너뛴 평가 횟수

# 7. Remote Write (설정된 경우)
prometheus_remote_storage_pending_samples               # 전송 대기 샘플 수
rate(prometheus_remote_storage_succeeded_samples_total[5m])  # 전송 성공률
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
    release: kube-prometheus-stack  # Prometheus Operator가 이 라벨로 ServiceMonitor를 발견한다
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

### 예제 4: Custom Exporter와 ServiceMonitor 전체 구성

```yaml
# 1. 애플리케이션 Deployment
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
  namespace: demo
spec:
  replicas: 3
  selector:
    matchLabels:
      app: my-app
  template:
    metadata:
      labels:
        app: my-app
    spec:
      containers:
        - name: my-app
          image: my-app:latest
          ports:
            - name: http
              containerPort: 8080
            - name: metrics
              containerPort: 9090
---
# 2. Service (metrics 포트 포함)
apiVersion: v1
kind: Service
metadata:
  name: my-app
  namespace: demo
  labels:
    app: my-app
spec:
  selector:
    app: my-app
  ports:
    - name: http
      port: 8080
    - name: metrics
      port: 9090
---
# 3. ServiceMonitor
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: my-app
  namespace: monitoring
  labels:
    release: kube-prometheus-stack
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
---
# 4. PrometheusRule (Recording + Alerting)
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: my-app-rules
  namespace: monitoring
  labels:
    release: kube-prometheus-stack
spec:
  groups:
    - name: my-app.recording
      rules:
        - record: job:myapp_requests:rate5m
          expr: sum by(job) (rate(myapp_http_requests_total[5m]))
    - name: my-app.alerting
      rules:
        - alert: MyAppHighErrorRate
          expr: |
            sum(rate(myapp_http_requests_total{status=~"5.."}[5m]))
            / sum(rate(myapp_http_requests_total[5m])) > 0.05
          for: 5m
          labels:
            severity: critical
          annotations:
            summary: "my-app의 에러율이 {{ $value | humanizePercentage }}이다"
```

---

## 자가 점검
- [ ] Pull 모델과 Push 모델의 차이를 설명할 수 있는가?
- [ ] Counter, Gauge, Histogram, Summary의 차이를 설명할 수 있는가?
- [ ] Histogram과 Summary 중 언제 어떤 것을 선택해야 하는지 설명할 수 있는가?
- [ ] Native Histogram이 기존 Histogram의 어떤 문제를 해결하는지 설명할 수 있는가?
- [ ] PromQL로 CPU/메모리 사용률을 쿼리할 수 있는가?
- [ ] `rate()` 함수가 왜 Counter에 필수인지 설명할 수 있는가?
- [ ] `rate()`와 `irate()`의 차이를 설명할 수 있는가?
- [ ] `rate()`의 범위가 scrape_interval의 최소 4배여야 하는 이유를 설명할 수 있는가?
- [ ] Instant Vector와 Range Vector의 차이를 설명할 수 있는가?
- [ ] `histogram_quantile()`이 내부적으로 어떻게 선형 보간을 수행하는지 설명할 수 있는가?
- [ ] `absent()`와 `absent_over_time()`의 차이와 사용 시나리오를 설명할 수 있는가?
- [ ] Vector Matching에서 `on()`, `ignoring()`, `group_left`, `group_right`의 차이를 설명할 수 있는가?
- [ ] Subquery 문법과 사용 시 성능 주의사항을 설명할 수 있는가?
- [ ] `relabel_configs`와 `metric_relabel_configs`의 차이를 설명할 수 있는가?
- [ ] Relabeling Action의 종류(keep, drop, replace, hashmod, labelmap 등)를 설명할 수 있는가?
- [ ] kubernetes_sd_config의 5가지 role(node, pod, service, endpoints, ingress)의 차이를 설명할 수 있는가?
- [ ] ServiceMonitor의 역할과 Prometheus Operator의 동작 방식을 설명할 수 있는가?
- [ ] PodMonitor와 ServiceMonitor의 차이를 설명할 수 있는가?
- [ ] Recording Rule과 Alert Rule의 차이를 설명할 수 있는가?
- [ ] Recording Rule의 네이밍 컨벤션(`level:metric:operations`)을 설명할 수 있는가?
- [ ] Alert Rule에서 `for` 절의 동작 원리를 설명할 수 있는가?
- [ ] TSDB의 WAL, Head Block, Persistent Block의 역할을 설명할 수 있는가?
- [ ] WAL Checkpoint의 동작 원리를 설명할 수 있는가?
- [ ] Memory-Mapped Chunks의 목적과 동작 원리를 설명할 수 있는가?
- [ ] Gorilla 압축의 Delta-of-Delta와 XOR 인코딩을 설명할 수 있는가?
- [ ] Block Compaction의 단계와 트리거 조건을 설명할 수 있는가?
- [ ] Inverted Index의 동작 원리를 설명할 수 있는가?
- [ ] Staleness marker가 무엇이고 왜 5분인지 설명할 수 있는가?
- [ ] node-exporter와 kube-state-metrics의 차이를 설명할 수 있는가?
- [ ] blackbox_exporter의 용도와 설정 방법을 설명할 수 있는가?
- [ ] Pushgateway의 사용 시나리오와 주의사항을 설명할 수 있는가?
- [ ] Label Cardinality가 중요한 이유와 관리 방법을 설명할 수 있는가?
- [ ] Federation이 필요한 시나리오를 설명할 수 있는가?
- [ ] Remote Write/Read가 필요한 이유와 Thanos/Mimir의 차이를 설명할 수 있는가?
- [ ] USE Method와 RED Method의 차이와 적용 대상을 설명할 수 있는가?
- [ ] SLI/SLO의 개념과 Error Budget 기반 알림 설정을 설명할 수 있는가?
- [ ] Prometheus의 TLS, Basic Auth 설정 방법을 설명할 수 있는가?
- [ ] Prometheus OOM 발생 시 원인 분석과 대응 방법을 설명할 수 있는가?
- [ ] 느린 PromQL 쿼리의 원인과 최적화 방법을 설명할 수 있는가?
- [ ] 이 프로젝트의 monitoring-values.yaml 설정을 이해하고 각 항목의 의미를 설명할 수 있는가?

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
- [Prometheus Operator 공식 문서](https://prometheus-operator.dev/) - Operator 설정 및 CRD 레퍼런스

### Exporter
- [node-exporter GitHub](https://github.com/prometheus/node_exporter) - 호스트 메트릭 수집기
- [kube-state-metrics GitHub](https://github.com/kubernetes/kube-state-metrics) - Kubernetes 객체 상태 메트릭
- [blackbox_exporter GitHub](https://github.com/prometheus/blackbox_exporter) - HTTP/DNS/TCP/ICMP Probe
- [Prometheus Operator GitHub](https://github.com/prometheus-operator/prometheus-operator) - Kubernetes 환경의 Prometheus 관리

### Client Libraries
- [Go Client](https://github.com/prometheus/client_golang) - Go 언어 계측 라이브러리
- [Python Client](https://github.com/prometheus/client_python) - Python 계측 라이브러리
- [Java Client (Micrometer)](https://micrometer.io/) - JVM 계측 라이브러리

### 장기 저장 솔루션
- [Thanos 공식 문서](https://thanos.io/tip/thanos/getting-started.md/) - 글로벌 뷰 및 장기 저장
- [Grafana Mimir 공식 문서](https://grafana.com/docs/mimir/latest/) - 확장 가능한 장기 저장
- [VictoriaMetrics 공식 문서](https://docs.victoriametrics.com/) - 고성능 시계열 데이터베이스
- [Cortex 공식 문서](https://cortexmetrics.io/) - 수평 확장 가능한 Prometheus

### 참고 논문 및 블로그
- [Gorilla: A Fast, Scalable, In-Memory Time Series Database (Facebook, 2015)](http://www.vldb.org/pvldb/vol8/p1816-teller.pdf) - Prometheus TSDB 압축 알고리즘의 원본 논문
- [Writing a Time Series Database from Scratch (Fabian Reinartz, 2017)](https://fabxc.org/tsdb/) - Prometheus TSDB 개발자가 쓴 TSDB 설계 문서
- [Google SRE Book - Monitoring Distributed Systems](https://sre.google/sre-book/monitoring-distributed-systems/) - USE/RED Method, SLI/SLO 개념
- [The Art of SLOs (Google)](https://sre.google/resources/practices-and-processes/art-of-slos/) - SLO 기반 모니터링 실무
- [Prometheus: Up & Running (O'Reilly)](https://www.oreilly.com/library/view/prometheus-up/9781492034131/) - Prometheus 종합 가이드 서적
- [PromQL for Humans](https://timber.io/blog/promql-for-humans/) - PromQL 입문 가이드
