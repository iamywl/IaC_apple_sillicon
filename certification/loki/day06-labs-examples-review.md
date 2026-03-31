# Day 6: 실습, 예제, 자가 점검, 참고문헌

Loki 상태 확인, LogQL 기본/고급 쿼리, Grafana 로그 탐색, Loki API 직접 호출, Promtail Pipeline Stage 테스트, 멀티테넌트 환경, 로그 기반 대시보드, Promtail 설정, 구조화된 로깅, 로그 기반 알림, 프로덕션 설정 예제와 자가 점검 문항을 학습한다.

---

## 실습

### 실습 1: Loki 상태 확인
```bash
# Loki Pod 확인
kubectl get pods -n monitoring -l app=loki

# Promtail Pod 확인 (DaemonSet)
kubectl get pods -n monitoring -l app=promtail

# Loki 상태 확인
kubectl exec -n monitoring deploy/loki -- wget -qO- http://localhost:3100/ready

# Loki 레이블 목록
kubectl exec -n monitoring deploy/loki -- wget -qO- http://localhost:3100/loki/api/v1/labels

# Loki 설정 확인
kubectl exec -n monitoring deploy/loki -- wget -qO- http://localhost:3100/config

# Loki 링 상태 확인 (Ingester Hash Ring)
kubectl exec -n monitoring deploy/loki -- wget -qO- http://localhost:3100/ring

# Loki 메트릭 확인
kubectl exec -n monitoring deploy/loki -- wget -qO- http://localhost:3100/metrics | head -50
```

### 실습 2: LogQL 기본 쿼리 (Grafana에서)
```logql
# 1. 특정 네임스페이스의 모든 로그
{namespace="demo"}

# 2. 특정 Pod의 로그 (정규식 매칭)
{namespace="demo", pod=~"nginx.*"}

# 3. 에러 로그만 필터링 (문자열 포함)
{namespace="demo"} |= "error"

# 4. 에러 로그 제외 (문자열 불포함)
{namespace="demo"} != "error"

# 5. 정규식으로 필터링 (4xx, 5xx 상태 코드)
{namespace="demo"} |~ "status=(4|5)\\d{2}"

# 6. JSON 로그 파싱 후 레이블 필터
{namespace="demo"} | json | level="error"

# 7. logfmt 로그 파싱 후 숫자 비교
{namespace="demo"} | logfmt | duration > 1000

# 8. 여러 필터 체이닝
{namespace="demo"} | json | level="error" | line_format "{{.timestamp}} [{{.level}}] {{.message}}"
```

### 실습 3: LogQL 고급 쿼리
```logql
# 1. 에러 로그 발생 빈도 (count over time)
count_over_time({namespace="demo"} |= "error" [5m])

# 2. 네임스페이스별 로그량 비교
sum by (namespace) (count_over_time({namespace=~".+"}[1h]))

# 3. 로그에서 숫자 추출하여 평균 계산 (unwrap)
avg_over_time({namespace="demo"} | json | unwrap response_time [5m])

# 4. Top 5 에러 발생 Pod
topk(5, sum by (pod) (count_over_time({namespace="demo"} |= "error" [1h])))

# 5. 로그 비율 (에러율 %)
sum(rate({namespace="demo"} |= "error" [5m])) / sum(rate({namespace="demo"} [5m])) * 100

# 6. 응답 시간 P99
quantile_over_time(0.99, {app="api"} | json | unwrap response_time [5m])

# 7. 로그가 발생하지 않는 앱 탐지 (알림용)
absent_over_time({app="critical-service"}[15m])

# 8. 초당 로그 바이트 수 (트래픽 모니터링)
sum by (namespace) (bytes_rate({namespace=~".+"}[5m]))
```

### 실습 4: Grafana에서 로그 탐색
```
1. Grafana 접속 > Explore > Data Source: Loki 선택
2. Label browser에서 namespace, pod 등 선택
3. Log browser에서 실시간 로그 확인
4. Live Tail 모드: 실시간 로그 스트리밍
5. Split view: Prometheus 메트릭과 Loki 로그를 나란히 비교
6. 로그 라인 클릭 → Detected fields에서 자동 파싱된 필드 확인
7. 로그 라인 클릭 → Show context로 전후 로그 확인
```

### 실습 5: Loki API 직접 호출
```bash
# Loki API를 직접 호출하여 로그를 조회한다

# 1. 사용 가능한 레이블 목록 조회
kubectl exec -n monitoring deploy/loki -- \
  wget -qO- 'http://localhost:3100/loki/api/v1/labels'

# 2. 특정 레이블의 값 목록 조회
kubectl exec -n monitoring deploy/loki -- \
  wget -qO- 'http://localhost:3100/loki/api/v1/label/namespace/values'

# 3. 로그 스트림 조회 (Log Query)
kubectl exec -n monitoring deploy/loki -- \
  wget -qO- 'http://localhost:3100/loki/api/v1/query_range?query={namespace="demo"}&limit=10&start=1700000000000000000&end=1700003600000000000'

# 4. 즉시 쿼리 (Instant Query - Metric Query)
kubectl exec -n monitoring deploy/loki -- \
  wget -qO- 'http://localhost:3100/loki/api/v1/query?query=count_over_time({namespace="demo"}[1h])'

# 5. 시리즈 조회 (매칭되는 스트림 목록)
kubectl exec -n monitoring deploy/loki -- \
  wget -qO- 'http://localhost:3100/loki/api/v1/series' --post-data='match[]={namespace="demo"}'

# 6. Ingester 상태 확인
kubectl exec -n monitoring deploy/loki -- \
  wget -qO- 'http://localhost:3100/ingester/ring'
```

### 실습 6: Promtail Pipeline Stage 테스트
```yaml
# 다양한 Pipeline Stage를 조합하여 로그 처리 파이프라인을 구성한다

# 1단계: 기본 설정 파일 작성
# promtail-test-config.yaml
server:
  http_listen_port: 9080

positions:
  filename: /tmp/positions.yaml

clients:
  - url: http://loki:3100/loki/api/v1/push

scrape_configs:
  - job_name: test-pipeline
    static_configs:
      - targets: [localhost]
        labels:
          job: test
          __path__: /var/log/test/*.log
    pipeline_stages:
      # CRI 포맷 파싱
      - cri: {}
      # JSON 파싱
      - json:
          expressions:
            level: level
            msg: message
            method: method
            uri: uri
            status: status_code
            duration: duration_ms
      # 민감 데이터 마스킹
      - replace:
          expression: '(?i)(password|token)\s*[=:]\s*\S+'
          replace: '${1}=***'
      # level을 레이블로 설정
      - labels:
          level:
      # debug 로그 드롭
      - drop:
          source: level
          value: "debug"
      # 타임스탬프 설정
      - timestamp:
          source: timestamp
          format: RFC3339Nano
      # 출력 포맷 변경
      - output:
          source: msg
      # 메트릭 생성
      - metrics:
          http_requests_total:
            type: Counter
            description: "HTTP requests by method and status"
            source: status
            config:
              action: inc
          request_duration_ms:
            type: Histogram
            description: "Request duration in ms"
            source: duration
            config:
              buckets: [10, 50, 100, 250, 500, 1000, 5000]
```

### 실습 7: 멀티테넌트 환경 구성
```yaml
# Loki 멀티테넌트 설정 확인 및 테스트

# 1. Loki 설정에서 auth_enabled 확인
# kubectl exec -n monitoring deploy/loki -- wget -qO- http://localhost:3100/config | grep auth_enabled

# 2. 테넌트 ID를 지정하여 로그 푸시 (curl 사용)
# curl -X POST -H "Content-Type: application/json" \
#   -H "X-Scope-OrgID: tenant-test" \
#   http://loki:3100/loki/api/v1/push \
#   -d '{"streams":[{"stream":{"app":"test","env":"dev"},"values":[["1700000000000000000","test log message"]]}]}'

# 3. 특정 테넌트의 로그 조회
# curl -H "X-Scope-OrgID: tenant-test" \
#   'http://loki:3100/loki/api/v1/query?query={app="test"}'

# 4. Grafana에서 테넌트별 데이터소스 설정
# Data Sources > Loki > HTTP Headers > X-Scope-OrgID: tenant-test
```

### 실습 8: 로그 기반 대시보드 구성
```logql
# Grafana Dashboard에 추가할 LogQL 패널 쿼리 예시

# Panel 1: 네임스페이스별 로그 볼륨 (Time Series)
sum by (namespace) (rate({namespace=~".+"}[5m]))

# Panel 2: 에러 로그 비율 (Gauge)
sum(rate({namespace="demo"} |= "error" [5m]))
/
sum(rate({namespace="demo"} [5m]))
* 100

# Panel 3: 상위 에러 발생 Pod (Table)
topk(10, sum by (pod) (count_over_time({namespace="demo"} |= "error" [1h])))

# Panel 4: 응답 시간 분포 (Time Series - P50, P90, P99)
# P50
quantile_over_time(0.5, {app="api"} | json | unwrap duration_ms [5m])
# P90
quantile_over_time(0.9, {app="api"} | json | unwrap duration_ms [5m])
# P99
quantile_over_time(0.99, {app="api"} | json | unwrap duration_ms [5m])

# Panel 5: 최근 에러 로그 (Logs Panel)
{namespace="demo"} |= "error" | json | line_format "{{.timestamp}} [{{.level}}] {{.pod}}: {{.message}}"

# Panel 6: HTTP 상태 코드 분포 (Bar Gauge)
sum by (status) (count_over_time({app="nginx"} | pattern "<_> \"<_> <_> <_>\" <status> <_>" [1h]))
```

---

## 예제

### 예제 1: Promtail 설정
```yaml
# promtail-config.yaml
server:
  http_listen_port: 9080
  grpc_listen_port: 0

positions:
  filename: /tmp/positions.yaml  # 읽기 위치를 기록하는 파일이다

clients:
  - url: http://loki:3100/loki/api/v1/push
    tenant_id: ""                # 멀티테넌시 사용 시 테넌트 ID를 지정한다
    batchwait: 1s                # 배치 전송 대기 시간이다
    batchsize: 1048576           # 배치 크기 (1MB)이다

scrape_configs:
  - job_name: kubernetes-pods
    kubernetes_sd_configs:
      - role: pod
    relabel_configs:
      # Pod 레이블을 Loki 레이블로 매핑한다
      - source_labels: [__meta_kubernetes_pod_label_app]
        target_label: app
      - source_labels: [__meta_kubernetes_namespace]
        target_label: namespace
      - source_labels: [__meta_kubernetes_pod_name]
        target_label: pod
      - source_labels: [__meta_kubernetes_pod_node_name]
        target_label: node
      # annotation으로 수집 여부를 제어한다
      - source_labels: [__meta_kubernetes_pod_annotation_promtail_io_scrape]
        action: drop
        regex: "false"
    pipeline_stages:
      # CRI 로그 포맷을 파싱한다
      - cri: {}
      # JSON 로그를 파싱한다
      - json:
          expressions:
            level: level
            msg: message
      # level을 레이블로 설정한다
      - labels:
          level:
      # debug 로그를 버린다
      - drop:
          source: level
          value: "debug"
```

### 예제 2: 구조화된 로깅 패턴 (Structured Logging)

Loki에서 최대 효율을 얻으려면 애플리케이션이 구조화된 JSON 로그를 출력해야 한다.

**애플리케이션 로그 출력 형식 (권장):**
```json
{"timestamp":"2025-01-15T10:30:00Z","level":"info","message":"Request processed","method":"GET","uri":"/api/users","status":200,"duration_ms":45,"user_id":"u-12345","trace_id":"abc123"}
```

**LogQL에서 활용:**
```logql
# JSON 자동 파싱 후 조건 필터링
{app="api"} | json | status >= 500 | line_format "{{.method}} {{.uri}} → {{.status}} ({{.duration_ms}}ms)"

# 엔드포인트별 평균 응답 시간
avg_over_time({app="api"} | json | unwrap duration_ms [5m]) by (uri)

# 느린 요청 탐지 (1초 이상)
{app="api"} | json | duration_ms > 1000
```

핵심은 `user_id`, `trace_id` 같은 고카디널리티 값은 레이블로 추출하지 않고, 로그 본문에만 포함시키는 것이다. 쿼리 시점에 `| json | user_id="u-12345"`로 필터링할 수 있다.

### 예제 3: 로그 기반 알림 (Grafana Alerting)
```yaml
# Grafana에서 로그 기반 알림을 설정하는 방법이다
# Alerting > Alert Rules > New alert rule

# 방법 1: LogQL Metric Query를 Alert 조건으로 사용한다
# Query A:
#   count_over_time({namespace="production"} |= "error" [5m])
# Condition:
#   WHEN last() OF query(A) IS ABOVE 10
# Evaluation:
#   Evaluate every 1m for 5m (5분간 지속 시 알림)

# 방법 2: 에러율 기반 알림
# Query A:
#   sum(rate({namespace="production"} |= "error" [5m]))
# Query B:
#   sum(rate({namespace="production"} [5m]))
# Expression C:
#   $A / $B * 100
# Condition:
#   WHEN last() OF query(C) IS ABOVE 5  (에러율 5% 초과 시)

# 방법 3: 로그 부재 알림 (서비스가 로그를 전혀 남기지 않으면 알림)
# Query A:
#   absent_over_time({app="critical-service"}[15m])
# Condition:
#   WHEN last() OF query(A) IS ABOVE 0
```

### 예제 4: 로그 분석 스크립트
```bash
#!/bin/bash
# log-analysis.sh - 네임스페이스별 로그 통계를 출력한다

LOKI_URL="http://localhost:3100"
NAMESPACE=${1:-"demo"}

echo "=== $NAMESPACE 로그 분석 ==="

# 최근 1시간 에러 로그 수
echo "에러 로그 수 (1h):"
curl -sG "$LOKI_URL/loki/api/v1/query" \
  --data-urlencode "query=count_over_time({namespace=\"$NAMESPACE\"} |= \"error\" [1h])" \
  | jq '.data.result[].value[1]'

# 최근 1시간 전체 로그 수
echo "전체 로그 수 (1h):"
curl -sG "$LOKI_URL/loki/api/v1/query" \
  --data-urlencode "query=count_over_time({namespace=\"$NAMESPACE\"} [1h])" \
  | jq '.data.result[].value[1]'

# 에러율 계산
echo "에러율 (1h):"
curl -sG "$LOKI_URL/loki/api/v1/query" \
  --data-urlencode "query=sum(rate({namespace=\"$NAMESPACE\"} |= \"error\" [1h])) / sum(rate({namespace=\"$NAMESPACE\"} [1h])) * 100" \
  | jq '.data.result[].value[1]'

# 레이블 값 목록
echo "사용 중인 레이블 값 (app):"
curl -sG "$LOKI_URL/loki/api/v1/label/app/values" \
  | jq -r '.data[]'
```

### 예제 5: Loki 프로덕션 설정 (Simple Scalable Mode)
```yaml
# loki-config.yaml - Simple Scalable Mode 프로덕션 설정 예시
auth_enabled: true

server:
  http_listen_port: 3100
  grpc_listen_port: 9095
  grpc_server_max_recv_msg_size: 104857600   # 100MB
  grpc_server_max_send_msg_size: 104857600

common:
  path_prefix: /loki
  replication_factor: 3
  ring:
    kvstore:
      store: memberlist

memberlist:
  join_members:
    - loki-memberlist:7946

schema_config:
  configs:
    - from: "2024-01-01"
      store: tsdb
      object_store: s3
      schema: v13
      index:
        prefix: index_
        period: 24h

storage_config:
  aws:
    s3: s3://ap-northeast-2/loki-chunks-bucket
    bucketnames: loki-chunks-bucket
    region: ap-northeast-2
  tsdb_shipper:
    active_index_directory: /loki/tsdb-index
    cache_location: /loki/tsdb-cache
    shared_store: s3

ingester:
  wal:
    enabled: true
    dir: /loki/wal
    flush_on_shutdown: true
    replay_memory_ceiling: 4GB
  chunk_encoding: snappy
  chunk_target_size: 1572864
  max_chunk_age: 2h
  chunk_idle_period: 30m

limits_config:
  ingestion_rate_mb: 10
  ingestion_burst_size_mb: 20
  max_streams_per_user: 50000
  max_line_size: 256KB
  max_query_length: 721h
  max_query_parallelism: 32
  retention_period: 720h
  unordered_writes: true

query_range:
  results_cache:
    cache:
      memcached_client:
        addresses: memcached:11211
        timeout: 500ms
  parallelise_shardable_queries: true

compactor:
  working_directory: /loki/compactor
  shared_store: s3
  compaction_interval: 10m
  retention_enabled: true
  retention_delete_delay: 2h

ruler:
  storage:
    type: local
    local:
      directory: /loki/rules
  alertmanager_url: http://alertmanager:9093
  enable_api: true
```

### 예제 6: Retention 정책 설정 (테넌트별, 스트림별)
```yaml
# runtime-config.yaml - 테넌트별/스트림별 Retention 설정 예시
overrides:
  # 일반 테넌트: 30일 보관
  default:
    retention_period: 720h

  # 프리미엄 테넌트: 90일 보관, 높은 Rate Limit
  premium-tenant:
    retention_period: 2160h
    ingestion_rate_mb: 50
    ingestion_burst_size_mb: 100
    max_streams_per_user: 200000

  # 개발 테넌트: 7일 보관, 낮은 Rate Limit
  dev-tenant:
    retention_period: 168h
    ingestion_rate_mb: 5
    ingestion_burst_size_mb: 10
    max_streams_per_user: 5000
    # 스트림별 Retention 설정
    retention_stream:
      - selector: '{level="debug"}'
        priority: 1
        period: 24h              # debug 로그는 1일만 보관한다
      - selector: '{namespace="stress-test"}'
        priority: 2
        period: 48h              # 스트레스 테스트 로그는 2일만 보관한다
      - selector: '{app="audit-log"}'
        priority: 3
        period: 8760h            # 감사 로그는 1년 보관한다
```

### 예제 7: 복합 LogQL 쿼리 모음
```logql
# 1. 서비스별 에러율 Top 5 (최근 1시간)
topk(5,
  sum by (app) (rate({namespace="production"} |= "error" [1h]))
  /
  sum by (app) (rate({namespace="production"} [1h]))
  * 100
)

# 2. 특정 사용자의 전체 요청 흐름 추적 (trace_id로 연결)
{namespace="production"} | json | trace_id = "abc123def456"

# 3. 느린 쿼리 탐지 (데이터베이스 로그에서 1초 이상 소요된 쿼리)
{app="postgres"} |~ "duration: [0-9]+ ms"
| regexp "duration: (?P<duration>[0-9]+) ms"
| duration > 1000
| line_format "{{.duration}}ms: {{.message}}"

# 4. 시간대별 HTTP 상태 코드 분포
sum by (status) (
  count_over_time(
    {app="nginx"} | pattern "<_> \"<_> <_> <_>\" <status> <_>" [5m]
  )
)

# 5. 에러 로그의 메시지별 빈도 분석
topk(10,
  sum by (message) (
    count_over_time({app="api"} | json | level = "error" [1h])
  )
)

# 6. 두 서비스 간 지연 시간 비교
# API 서비스
avg_over_time({app="api-v1"} | json | unwrap duration_ms [5m])
# vs 새 버전
avg_over_time({app="api-v2"} | json | unwrap duration_ms [5m])

# 7. 5xx 에러가 발생한 시점의 전후 로그 (문맥 파악)
{app="nginx"} | pattern "<_> \"<method> <uri> <_>\" <status> <_>" | status >= 500

# 8. 로그 볼륨의 급증 탐지 (5분 평균 대비 현재 비율)
sum(rate({namespace="production"}[1m]))
/
sum(rate({namespace="production"}[5m]))
> 3
# 1분 비율이 5분 평균의 3배 이상이면 급증으로 판단한다

# 9. Pod 재시작 로그 탐지
{namespace="production"} |= "Started container" or |= "Back-off restarting"

# 10. JSON 로그에서 특정 필드로 그룹화하여 통계
sum by (method, uri) (
  count_over_time(
    {app="api"} | json | status >= 400 [1h]
  )
)
```

### 예제 8: Grafana Derived Fields 및 Tempo 연동 설정
```json
// Grafana Loki Data Source JSON 설정 (provisioning)
{
  "name": "Loki",
  "type": "loki",
  "url": "http://loki:3100",
  "jsonData": {
    "derivedFields": [
      {
        "name": "TraceID",
        "matcherRegex": "\"trace_id\":\"([a-f0-9]+)\"",
        "url": "",
        "datasourceUid": "tempo-datasource-uid",
        "matcherType": "regex"
      },
      {
        "name": "SpanID",
        "matcherRegex": "\"span_id\":\"([a-f0-9]+)\"",
        "url": "",
        "datasourceUid": "tempo-datasource-uid",
        "matcherType": "regex"
      },
      {
        "name": "Documentation",
        "matcherRegex": "error_code=(ERR-\\d+)",
        "url": "https://docs.example.com/errors/${__value.raw}",
        "matcherType": "regex"
      }
    ],
    "maxLines": 1000
  }
}
```

---

## 자가 점검

### 기본 개념
- [ ] Loki가 "Prometheus for Logs"라고 불리는 이유를 설명할 수 있는가?
- [ ] Loki의 레이블 인덱싱 방식이 Elasticsearch의 Full-text 인덱싱과 어떻게 다르며, 비용 측면에서 어떤 이점이 있는지 설명할 수 있는가?
- [ ] Monolithic, Simple Scalable, Microservices 세 가지 배포 모드의 차이와 적합한 규모를 설명할 수 있는가?
- [ ] 고카디널리티 레이블이 왜 문제가 되며, 어떻게 회피해야 하는지 설명할 수 있는가?

### 아키텍처 심화
- [ ] Distributor → Ingester → Chunk Store로 이어지는 Write Path를 상세히 설명할 수 있는가?
- [ ] Query Frontend → Querier → Storage로 이어지는 Read Path를 상세히 설명할 수 있는가?
- [ ] Ingester의 WAL, Chunk Flushing, Handoff 개념을 각각 설명할 수 있는가?
- [ ] Hash Ring의 동작 원리와 Consistent Hashing이 왜 필요한지 설명할 수 있는가?
- [ ] Replication Factor가 3일 때 Quorum 기반의 쓰기 성공 조건을 설명할 수 있는가?
- [ ] Query Frontend의 Query Splitting, Results Cache, 공정 스케줄링의 역할을 각각 설명할 수 있는가?
- [ ] Compactor의 Index Compaction과 Retention 적용 과정을 설명할 수 있는가?
- [ ] Ruler 컴포넌트의 역할과 Alerting Rules 설정 방법을 설명할 수 있는가?
- [ ] 컴포넌트 간 통신에서 gRPC와 memberlist가 각각 어떤 역할을 하는지 설명할 수 있는가?

### 스토리지
- [ ] Index Storage(TSDB)와 Chunk Storage(S3 등)의 역할 차이를 설명할 수 있는가?
- [ ] BoltDB Shipper와 TSDB의 차이점을 설명하고, 왜 TSDB가 권장되는지 설명할 수 있는가?
- [ ] Schema Config의 `from`, `store`, `object_store`, `schema` 필드의 의미를 설명할 수 있는가?
- [ ] Schema 마이그레이션(v12 → v13)을 무중단으로 수행하는 방법을 설명할 수 있는가?
- [ ] Chunk 인코딩(gzip, snappy, lz4, zstd)의 특성 차이를 설명하고 환경에 맞는 인코딩을 선택할 수 있는가?
- [ ] Results Cache, Chunks Cache, Index Cache의 역할과 적합한 백엔드를 설명할 수 있는가?

### Promtail
- [ ] Promtail의 Pipeline Stage에서 json, regex, labels, drop, multiline, output Stage의 역할을 설명할 수 있는가?
- [ ] Promtail의 Positions File이 무엇이며 왜 중요한지 설명할 수 있는가?
- [ ] Pipeline 실행 순서와 내부 데이터 흐름(Extracted Data Map, Labels, Log Line)을 설명할 수 있는가?
- [ ] 멀티라인 로그(Java Stack Trace 등)를 하나의 엔트리로 합치는 multiline Stage를 설정할 수 있는가?
- [ ] Promtail, Grafana Agent, FluentBit, Fluentd의 차이점을 비교 설명할 수 있는가?
- [ ] Promtail의 replace Stage를 사용하여 민감 데이터를 마스킹하는 설정을 작성할 수 있는가?

### LogQL
- [ ] LogQL에서 Line Filter(`|=`, `!=`, `|~`, `!~`)와 Parser Expression(`json`, `logfmt`, `pattern`, `regexp`)을 사용할 수 있는가?
- [ ] LogQL에서 `unwrap`을 사용하여 로그 본문의 숫자 값을 메트릭으로 변환하는 쿼리를 작성할 수 있는가?
- [ ] `count_over_time`, `rate`, `bytes_over_time`, `bytes_rate`의 차이를 설명할 수 있는가?
- [ ] `sum_over_time`, `avg_over_time`, `quantile_over_time` 등 Unwrap 기반 Range Aggregation을 사용할 수 있는가?
- [ ] `sum by`, `topk`, `sort_desc` 등 Aggregation Operator를 적절히 조합하여 복합 쿼리를 작성할 수 있는가?
- [ ] Binary Operation(`and`, `or`, `unless`)을 사용하여 두 쿼리 결과를 결합하는 쿼리를 작성할 수 있는가?
- [ ] Line Format Expression에서 Go 템플릿 함수(ToUpper, Replace, div 등)를 사용할 수 있는가?
- [ ] LogQL과 PromQL의 공통점과 차이점을 설명할 수 있는가?

### 운영 및 관측
- [ ] Grafana에서 LogQL Metric Query를 사용한 로그 기반 알림을 설정할 수 있는가?
- [ ] Derived Fields를 설정하여 로그의 TraceID에서 Tempo 트레이스로 연결할 수 있는가?
- [ ] 멀티테넌트 환경에서 `X-Scope-OrgID`를 사용한 테넌트 분리와 테넌트별 설정을 구성할 수 있는가?
- [ ] 레이블 설계 시 카디널리티를 관리하고, 활성 스트림 수를 추정하는 방법을 설명할 수 있는가?
- [ ] 쿼리 최적화의 세 가지 원칙(시간 범위 제한, 레이블 필터 우선, Line Filter 순서)을 설명하고 적용할 수 있는가?
- [ ] Ingester OOM 에러가 발생했을 때 원인을 진단하고 해결하는 방법을 설명할 수 있는가?
- [ ] 로그 수집이 안 되는 경우 Promtail의 /targets, /metrics 엔드포인트를 활용하여 진단할 수 있는가?
- [ ] TLS 설정과 Reverse Proxy를 이용한 인증 아키텍처를 설명할 수 있는가?

---

## 참고문헌
- [Grafana Loki 공식 문서](https://grafana.com/docs/loki/latest/) — 아키텍처, 설정, 운영 가이드를 포함하는 공식 레퍼런스이다
- [Grafana Loki GitHub 저장소](https://github.com/grafana/loki) — 소스 코드, 릴리스 노트, 이슈 트래커이다
- [LogQL 공식 문서](https://grafana.com/docs/loki/latest/query/) — LogQL 문법 전체 레퍼런스이다
- [Promtail 공식 문서](https://grafana.com/docs/loki/latest/send-data/promtail/) — Promtail 설정 및 Pipeline Stage 레퍼런스이다
- [Loki Storage 공식 문서](https://grafana.com/docs/loki/latest/storage/) — 스토리지 아키텍처와 Schema Config 가이드이다
- [Loki Best Practices](https://grafana.com/docs/loki/latest/best-practices/) — 레이블 설계, 쿼리 최적화 등 모범 사례이다
- [Grafana Alerting with Loki](https://grafana.com/docs/grafana/latest/alerting/) — Grafana에서 로그 기반 알림 설정 가이드이다
- [Loki Deployment Modes](https://grafana.com/docs/loki/latest/get-started/deployment-modes/) — Monolithic, SSD, Microservices 모드 비교이다
