# Day 4: Recording Rules, Alerting Rules, Storage 심화

> Recording Rule을 통한 쿼리 사전 계산, Alerting Rule과 Alertmanager 연동, Remote Write/Read를 포함한 Storage 심화를 학습한다.

## Recording Rules 심화

### 목적과 필요성

Recording Rule은 복잡한 PromQL 쿼리를 주기적으로 미리 계산하여 새로운 시계열로 저장하는 규칙이다.

#### Recording Rule이 필요한 경우

1. **대시보드 성능**: Grafana 대시보드에서 복잡한 쿼리를 실시간으로 실행하면 Prometheus에 부하가 걸린다
2. **알림 성능**: 알림 평가 시 복잡한 쿼리는 평가 지연을 유발한다
3. **Federation**: 하위 Prometheus에서 상위로 전달할 때 Recording Rule 결과만 전달하면 데이터 양이 줄어든다
4. **재사용**: 여러 알림/대시보드에서 같은 계산을 반복할 때 한 번만 계산한다

### 네이밍 컨벤션

```yaml
# 공식 네이밍 패턴: level:metric:operations
#
# level: 집계 수준을 나타낸다
#   - instance, node, namespace, cluster, job 등
#
# metric: 원본 메트릭 이름이다
#   - 원본 메트릭 이름을 가능한 유지한다
#
# operations: 적용된 연산을 나타낸다
#   - rate, sum, avg, ratio, count 등
#   - 여러 연산은 _로 구분한다

# 좋은 예시:
node:cpu_utilization:ratio                            # 노드별 CPU 사용률
namespace:container_cpu_usage_seconds_total:sum_rate   # 네임스페이스별 CPU 사용 rate 합계
cluster:memory_allocation:ratio                       # 클러스터 메모리 할당률
job:http_requests:rate5m                              # Job별 HTTP 요청률

# 나쁜 예시:
cpu_usage                  # level 없음, operation 없음
node_cpu_percentage        # 네이밍 패턴 미준수
my_custom_metric           # 의미 불명확
```

### Recording Rule 패턴

#### 기본 패턴

```yaml
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

#### 계층적 Recording Rule 패턴

```yaml
# 상위 Rule이 하위 Rule의 결과를 참조하여 계산 비용을 줄인다
groups:
  - name: http.recording.rules
    rules:
      # Level 1: instance별 HTTP 요청률
      - record: instance:http_requests:rate5m
        expr: sum by(instance, method, status) (rate(http_requests_total[5m]))

      # Level 2: job별 집계 (Level 1 결과 사용)
      - record: job:http_requests:rate5m
        expr: sum by(job, method) (instance:http_requests:rate5m)

      # Level 3: 전체 클러스터 집계 (Level 2 결과 사용)
      - record: cluster:http_requests:rate5m
        expr: sum(job:http_requests:rate5m)
```

### Recording Rule 성능 영향

```
# Recording Rule의 비용:
# 1. 평가 비용: 각 Rule은 evaluation_interval마다 PromQL을 실행한다
# 2. 저장 비용: 결과가 새로운 시계열로 저장되어 TSDB 용량을 소모한다
# 3. 인덱싱 비용: 새로운 시계열이 inverted index에 추가된다

# 최적화 팁:
# 1. 실제로 사용되는 Rule만 정의한다 (사용하지 않는 Rule은 삭제)
# 2. evaluation interval을 적절히 설정한다 (너무 짧으면 부하 증가)
# 3. Recording Rule에서 불필요한 라벨을 제거하여 카디널리티를 줄인다
# 4. 계층적 Rule 패턴을 사용하여 중복 계산을 제거한다

# Recording Rule 성능 모니터링
prometheus_rule_evaluation_duration_seconds{rule_group="node.recording.rules"}
prometheus_rule_group_iterations_missed_total
```

---

## Alerting Rules 심화

### Alert Rule 구조

```yaml
groups:
  - name: example.alerts
    rules:
      - alert: AlertName           # 알림 이름 (PascalCase 권장)
        expr: <PromQL 표현식>       # true이면 알림이 트리거된다
        for: 5m                    # 이 기간 동안 지속되어야 firing 상태가 된다
        labels:                    # 알림에 추가할 라벨 (라우팅에 사용)
          severity: critical       # critical, warning, info 등
          team: platform
        annotations:               # 알림 설명 (알림 메시지에 표시)
          summary: "요약 메시지"
          description: "상세 설명"
          runbook_url: "https://..."  # 대응 매뉴얼 링크
```

### for 절의 의미

```
# for: 5m의 동작:
# 1. 조건이 처음 true가 되면 -> Pending 상태
# 2. 5분 동안 매 evaluation마다 계속 true이면 -> Firing 상태
# 3. 중간에 한 번이라도 false가 되면 -> Inactive로 복귀
# 4. Firing 상태에서 false가 되면 -> Resolved 알림 전송 후 Inactive

# for 없이 (for: 0m):
# 조건이 true가 되는 즉시 Firing 상태가 된다
# 일시적 스파이크에도 반응하므로 오탐(false positive) 위험이 높다

# for 값 가이드라인:
# - 인프라 장애 (노드 다운): 2~5분
# - 성능 저하 (CPU, 메모리): 5~15분
# - 비즈니스 메트릭: 10~30분
# - 긴급 알림 (디스크 풀): 1~5분
```

### Template 함수

annotations에서 Go template 문법을 사용할 수 있다.

```yaml
annotations:
  # $labels: 알림의 라벨에 접근
  summary: "Pod {{ $labels.pod }}가 Ready 상태가 아니다"

  # $value: 현재 표현식의 값
  description: "CPU 사용률이 {{ $value | printf \"%.1f\" }}%이다"

  # humanize: 큰 숫자를 읽기 쉽게 변환
  description: "메모리 사용량: {{ $value | humanize }}B"

  # humanize1024: 1024 기반 단위 변환 (bytes에 적합)
  description: "디스크 사용량: {{ $value | humanize1024 }}B"

  # humanizeDuration: 초를 사람이 읽기 쉬운 기간으로 변환
  description: "업타임: {{ $value | humanizeDuration }}"

  # humanizePercentage: 소수를 퍼센트로 변환
  description: "사용률: {{ $value | humanizePercentage }}"

  # 조건부 텍스트
  description: >-
    {{ if gt $value 90.0 }}위험{{ else }}경고{{ end }} 수준의 CPU 사용률이다
```

### 실전 Alert Rule 패턴

```yaml
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: infrastructure-alerts
  namespace: monitoring
spec:
  groups:
    - name: node.alerts
      rules:
        # 노드 다운
        - alert: NodeDown
          expr: up{job="node-exporter"} == 0
          for: 2m
          labels:
            severity: critical
          annotations:
            summary: "노드 {{ $labels.instance }}가 다운되었다"
            runbook_url: "https://wiki/runbook/node-down"

        # CPU 사용률 경고
        - alert: NodeHighCPU
          expr: node:cpu_utilization:ratio > 0.8
          for: 10m
          labels:
            severity: warning
          annotations:
            summary: "노드 {{ $labels.instance }}의 CPU 사용률이 {{ $value | humanizePercentage }}이다"

        # CPU 사용률 위험
        - alert: NodeCriticalCPU
          expr: node:cpu_utilization:ratio > 0.95
          for: 5m
          labels:
            severity: critical
          annotations:
            summary: "노드 {{ $labels.instance }}의 CPU 사용률이 {{ $value | humanizePercentage }}이다"

        # 메모리 사용률 경고
        - alert: NodeHighMemory
          expr: node:memory_utilization:ratio > 0.85
          for: 5m
          labels:
            severity: warning
          annotations:
            summary: "노드 {{ $labels.instance }}의 메모리 사용률이 {{ $value | humanizePercentage }}이다"

        # 디스크 사용률 경고
        - alert: NodeDiskSpaceRunningOut
          expr: node:disk_utilization:ratio > 0.85
          for: 10m
          labels:
            severity: warning
          annotations:
            summary: "{{ $labels.instance }}의 {{ $labels.mountpoint }} 디스크 사용률이 {{ $value | humanizePercentage }}이다"

        # 디스크 예측 경고: 24시간 내 디스크 풀 예상
        - alert: NodeDiskWillFillIn24Hours
          expr: |
            predict_linear(node_filesystem_avail_bytes{fstype!~"tmpfs|overlay"}[6h], 24*3600) < 0
          for: 30m
          labels:
            severity: warning
          annotations:
            summary: "{{ $labels.instance }}의 {{ $labels.mountpoint }} 디스크가 24시간 내 가득 찰 것으로 예측된다"

        # 네트워크 에러
        - alert: NodeNetworkErrors
          expr: |
            rate(node_network_receive_errs_total[5m]) + rate(node_network_transmit_errs_total[5m]) > 0
          for: 5m
          labels:
            severity: warning
          annotations:
            summary: "노드 {{ $labels.instance }}의 {{ $labels.device }}에서 네트워크 에러가 발생하고 있다"

    - name: kubernetes.alerts
      rules:
        # Pod NotReady
        - alert: PodNotReady
          expr: kube_pod_status_ready{condition="true"} == 0
          for: 5m
          labels:
            severity: warning
          annotations:
            summary: "Pod {{ $labels.namespace }}/{{ $labels.pod }}가 Ready 상태가 아니다"

        # Deployment replica 불일치
        - alert: DeploymentReplicaMismatch
          expr: |
            kube_deployment_spec_replicas != kube_deployment_status_replicas_available
          for: 10m
          labels:
            severity: warning
          annotations:
            summary: >-
              Deployment {{ $labels.namespace }}/{{ $labels.deployment }}의
              desired({{ printf "%.0f" (query "kube_deployment_spec_replicas") }})와
              available이 불일치한다

        # CrashLoopBackOff
        - alert: PodCrashLooping
          expr: |
            increase(kube_pod_container_status_restarts_total[1h]) > 3
          for: 0m
          labels:
            severity: critical
          annotations:
            summary: "Pod {{ $labels.namespace }}/{{ $labels.pod }}가 1시간에 {{ $value }}번 재시작했다"

        # Persistent Volume 사용률
        - alert: PersistentVolumeFillingUp
          expr: |
            kubelet_volume_stats_used_bytes / kubelet_volume_stats_capacity_bytes > 0.85
          for: 5m
          labels:
            severity: warning
          annotations:
            summary: >-
              PVC {{ $labels.namespace }}/{{ $labels.persistentvolumeclaim }}의
              사용률이 {{ $value | humanizePercentage }}이다

    - name: application.alerts
      rules:
        # HTTP 에러율 경고
        - alert: HighHTTPErrorRate
          expr: |
            sum(rate(http_requests_total{status=~"5.."}[5m])) by (service)
            / sum(rate(http_requests_total[5m])) by (service)
            > 0.05
          for: 5m
          labels:
            severity: critical
          annotations:
            summary: "{{ $labels.service }}의 HTTP 5xx 에러율이 {{ $value | humanizePercentage }}이다"

        # 높은 응답 시간
        - alert: HighLatencyP99
          expr: |
            histogram_quantile(0.99,
              sum(rate(http_request_duration_seconds_bucket[5m])) by (le, service)
            ) > 1
          for: 5m
          labels:
            severity: warning
          annotations:
            summary: "{{ $labels.service }}의 p99 응답시간이 {{ $value | printf \"%.2f\" }}초이다"

        # 메트릭 수집 실패
        - alert: TargetDown
          expr: up == 0
          for: 5m
          labels:
            severity: critical
          annotations:
            summary: "타겟 {{ $labels.job }}/{{ $labels.instance }}가 다운되었다"
```

### Alert Rule 모범 사례

1. **for 절을 항상 사용한다**: 일시적 스파이크에 의한 오탐을 방지한다
2. **severity 라벨을 표준화한다**: `critical`, `warning`, `info` 3단계를 권장한다
3. **runbook_url을 포함한다**: 알림을 받았을 때 즉시 대응할 수 있도록 한다
4. **Recording Rule 결과를 사용한다**: 알림 표현식에서 복잡한 쿼리 대신 Recording Rule을 참조한다
5. **알림 피로(alert fatigue)를 방지한다**: 조치 가능한 알림만 설정한다
6. **테스트를 작성한다**: `promtool test rules`로 알림 규칙을 테스트한다

```bash
# 알림 규칙 문법 검사
promtool check rules alert-rules.yaml

# 알림 규칙 테스트
promtool test rules test-alerts.yaml
```

---

## Storage 심화

### Local Storage 아키텍처

```
┌─────────────────────────────────────────────────────┐
│                   Local Storage                      │
│                                                      │
│  Write Path:                                         │
│  Scrape → Appender → WAL Write → Head Block Update  │
│                                                      │
│  Read Path:                                          │
│  PromQL → Querier → Merge(Head + Blocks) → Result   │
│                                                      │
│  Background:                                         │
│  Head Flush → Block Write → Compaction → Deletion   │
│                                                      │
│  ┌─────────────────────────────────────────────────┐ │
│  │ Head Block (in-memory + mmap)                   │ │
│  │  최근 ~2시간 데이터                               │ │
│  ├─────────────────────────────────────────────────┤ │
│  │ Block 1 (2h)  │ Block 2 (4h)  │ Block 3 (8h)  │ │
│  │ immutable     │ compacted     │ compacted      │ │
│  ├─────────────────────────────────────────────────┤ │
│  │ Tombstones (삭제 표시, 실제 삭제는 compaction 시) │ │
│  └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

### Storage 관련 CLI 플래그

```bash
# TSDB 저장 경로 (기본: data/)
--storage.tsdb.path=/prometheus

# 최소 블록 기간 (Head block flush 주기, 기본: 2h)
--storage.tsdb.min-block-duration=2h

# 최대 블록 기간 (compaction 최대 크기, 기본: retention의 10%)
--storage.tsdb.max-block-duration=36h

# WAL 압축 활성화 (Prometheus 2.20+, 기본: true)
--storage.tsdb.wal-compression

# 시간 기반 보관
--storage.tsdb.retention.time=7d

# 크기 기반 보관
--storage.tsdb.retention.size=10GB

# Out-of-order 샘플 허용 (Prometheus 2.39+)
--storage.tsdb.out-of-order-time-window=30m

# 삭제 API 활성화
--web.enable-admin-api
```

### Remote Write 심화

Remote Write는 수집된 샘플을 실시간으로 원격 스토리지에 전송하는 프로토콜이다.

#### 동작 원리

```
Scrape → TSDB → WAL → Remote Write Queue → HTTP POST → Remote Storage

Remote Write Queue 구조:
┌──────────────────────────────────────────────┐
│           Remote Write Queue                  │
│                                               │
│  ┌─────────┐ ┌─────────┐     ┌─────────┐    │
│  │ Shard 1 │ │ Shard 2 │ ... │ Shard N │    │
│  │ (goroutine)│        │     │         │    │
│  └────┬────┘ └────┬────┘     └────┬────┘    │
│       │           │               │          │
│       ▼           ▼               ▼          │
│    HTTP POST   HTTP POST       HTTP POST     │
│       │           │               │          │
│       ▼           ▼               ▼          │
│  ┌────────────────────────────────────────┐  │
│  │         Remote Storage Endpoint        │  │
│  └────────────────────────────────────────┘  │
└──────────────────────────────────────────────┘
```

#### Remote Write 설정 상세

```yaml
remote_write:
  - url: "http://mimir-distributor:9009/api/v1/push"

    # 인증 설정
    basic_auth:
      username: prometheus
      password_file: /etc/prometheus/remote-write-password

    # 또는 Bearer Token
    # authorization:
    #   credentials_file: /etc/prometheus/token

    # TLS 설정
    tls_config:
      cert_file: /etc/prometheus/tls/client.crt
      key_file: /etc/prometheus/tls/client.key
      ca_file: /etc/prometheus/tls/ca.crt

    # 큐 설정 (성능 튜닝)
    queue_config:
      capacity: 2500           # 각 shard의 큐 버퍼 크기
      max_shards: 200          # 최대 병렬 전송 shard 수
      min_shards: 1            # 최소 shard 수
      max_samples_per_send: 500  # 한 번에 전송하는 최대 샘플 수
      batch_send_deadline: 5s  # 배치 전송 최대 대기 시간
      min_backoff: 30ms        # 재시도 최소 대기 시간
      max_backoff: 5s          # 재시도 최대 대기 시간
      retry_on_http_429: true  # 429 Too Many Requests 시 재시도

    # 전송할 메트릭 필터링
    write_relabel_configs:
      # 불필요한 메트릭 제외
      - source_labels: [__name__]
        regex: 'go_.*|process_.*'
        action: drop
      # 특정 네임스페이스만 전송
      - source_labels: [namespace]
        regex: 'production|staging'
        action: keep

    # 메타데이터 전송 설정
    metadata_config:
      send: true
      send_interval: 1m
      max_samples_per_send: 500
```

#### Remote Write 성능 모니터링

```promql
# 전송 대기 중인 샘플 수
prometheus_remote_storage_pending_samples

# 전송 실패 횟수
prometheus_remote_storage_failed_samples_total

# 전송 성공 횟수
prometheus_remote_storage_succeeded_samples_total

# 전송 재시도 횟수
prometheus_remote_storage_retried_samples_total

# shard 수 (자동 조정됨)
prometheus_remote_storage_shards

# 전송 지연 시간 (초)
prometheus_remote_storage_queue_highest_sent_timestamp_seconds
  - prometheus_remote_storage_queue_lowest_sent_timestamp_seconds

# Remote Write가 WAL을 따라잡지 못하면 이 값이 증가한다
prometheus_remote_storage_samples_dropped_total
```

### Remote Read 설정

```yaml
remote_read:
  - url: "http://mimir-query-frontend:9009/prometheus/api/v1/read"
    read_recent: false  # false: 로컬 TSDB에 없는 데이터만 원격에서 읽는다
                        # true: 항상 원격에서도 읽는다 (성능 저하 가능)
    # 캐시 설정
    # headers:
    #   X-Scope-OrgID: "tenant-1"  # 멀티테넌트 환경의 테넌트 ID
```

### 장기 저장 솔루션 비교

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

### Thanos 아키텍처 상세

```
┌──────────────────────────────────────────────────────────────────────┐
│                       Thanos Architecture                            │
│                                                                      │
│  ┌──────────────┐     ┌──────────────┐                               │
│  │ Prometheus   │     │ Prometheus   │                               │
│  │  + Sidecar   │     │  + Sidecar   │                               │
│  └──────┬───────┘     └──────┬───────┘                               │
│         │ upload              │ upload                                │
│         ▼                     ▼                                      │
│  ┌──────────────────────────────────┐                                │
│  │       Object Storage (S3/GCS)    │                                │
│  └──────────────┬───────────────────┘                                │
│                 │ read                                                │
│  ┌──────────────▼──────────────┐                                     │
│  │       Thanos Store Gateway   │  오브젝트 스토리지의 블록을 쿼리    │
│  └──────────────┬──────────────┘                                     │
│                 │                                                     │
│  ┌──────────────▼──────────────┐                                     │
│  │       Thanos Querier         │  글로벌 PromQL 쿼리                │
│  │  (StoreAPI 게이트웨이)       │  여러 소스의 데이터를 병합          │
│  └──────────────┬──────────────┘                                     │
│                 │                                                     │
│  ┌──────────────▼──────────────┐                                     │
│  │       Thanos Compactor       │  오브젝트 스토리지의 블록 compaction │
│  │  (Downsampling 수행)         │  5m, 1h 해상도로 다운샘플링         │
│  └─────────────────────────────┘                                     │
│                                                                      │
│  ┌──────────────────────────────┐                                     │
│  │       Thanos Ruler           │  글로벌 Recording/Alert Rule 평가  │
│  └──────────────────────────────┘                                     │
└──────────────────────────────────────────────────────────────────────┘
```

#### Thanos vs Mimir 비교

| 항목 | Thanos | Mimir |
|------|--------|-------|
| 데이터 전달 방식 | Sidecar가 블록을 업로드 | Remote Write로 Push |
| 쿼리 방식 | StoreAPI를 통한 Fan-out | 내장 쿼리 엔진 |
| 멀티테넌트 | 제한적 | 네이티브 지원 |
| 운영 복잡도 | 컴포넌트가 많다 | 단일 바이너리 모드 지원 |
| 다운샘플링 | Compactor가 수행 | 미지원 (원본 해상도 유지) |
| HA 중복 제거 | Compactor가 수행 | Ingester가 수행 |
| Prometheus 변경 | Sidecar 추가 필요 | remote_write 설정만 추가 |

---

