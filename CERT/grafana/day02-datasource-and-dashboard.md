# Day 2: Data Source 및 Dashboard 설계

> Grafana의 Data Source 연동 방식과 설정 심화, Dashboard의 JSON Model 구조, Variable 시스템, Annotation, Row/Panel 레이아웃 설계를 학습한다.

## 2장: Data Source 심화

Grafana는 80개 이상의 데이터소스 플러그인을 지원한다. 각 데이터소스는 고유한 쿼리 언어와 Query Editor를 가지고 있다.

### 2.1 Prometheus

Prometheus는 Grafana에서 가장 널리 사용되는 데이터소스이다. 이 프로젝트에서는 `kube-prometheus-stack`에 포함되어 platform 클러스터의 `monitoring` 네임스페이스에 배포된다.

#### Prometheus Data Source 설정

```yaml
# 이 프로젝트의 Prometheus 데이터소스 (Helm values에서 자동 프로비저닝)
datasources:
  - name: Prometheus
    type: prometheus
    access: proxy
    url: http://kube-prometheus-stack-prometheus.monitoring.svc.cluster.local:9090
    isDefault: true
    jsonData:
      timeInterval: "15s"         # 기본 scrape interval
      httpMethod: POST            # 긴 PromQL을 위해 POST 사용
      manageAlerts: true          # Grafana에서 Prometheus alerting rule 관리
      prometheusType: Prometheus  # Prometheus 또는 Thanos, Mimir
      prometheusVersion: "2.x"
      cacheLevel: "Medium"        # 쿼리 캐싱 수준
      incrementalQuerying: true   # 점진적 쿼리 (성능 향상)
      exemplarTraceIdDestinations:
        - name: traceID
          datasourceUid: tempo
```

#### Query Editor 모드

Prometheus Query Editor는 두 가지 모드를 제공한다:

**Builder 모드** (비주얼 쿼리 빌더):
```
Metric: container_cpu_usage_seconds_total
Label filters: namespace = $namespace, pod =~ $pod
Operations:
  1. Rate [range: $__rate_interval]
  2. Sum (by: pod)
Legend: {{pod}}
```
- 드롭다운으로 메트릭과 라벨을 선택한다
- 연산(Rate, Sum, Avg 등)을 시각적으로 추가한다
- PromQL 초보자에게 권장한다

**Code 모드** (직접 PromQL 작성):
```promql
sum(rate(container_cpu_usage_seconds_total{namespace="$namespace"}[$__rate_interval])) by (pod)
```
- 자동 완성(autocomplete)을 지원한다
- 구문 강조(syntax highlighting)를 제공한다
- 복잡한 쿼리에 적합하다

#### Instant Query vs Range Query

| 구분 | Instant Query | Range Query |
|------|-------------|-------------|
| 실행 방식 | 단일 시점의 값을 반환한다 | 시간 범위 내 여러 시점의 값을 반환한다 |
| API 엔드포인트 | `/api/v1/query` | `/api/v1/query_range` |
| Grafana 사용처 | Stat, Gauge, Table 패널 | Time series 패널 |
| 파라미터 | `time` (단일 시점) | `start`, `end`, `step` |
| Grafana 설정 | Query Options > Type: Instant | Query Options > Type: Range (기본값) |
| 성능 | 가벼움 | step 수에 비례하여 무거워짐 |

```
# Instant Query 예시 (현재 CPU 사용률)
100 - (avg(rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)
→ 단일 값 반환: 73.2

# Range Query 예시 (지난 1시간 CPU 추이)
100 - (avg(rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)
→ step=15s, 240개 데이터 포인트 반환
```

#### Legend Formatting

Legend format은 쿼리 결과의 시리즈 이름을 정의한다:

| Legend Format | 결과 예시 | 설명 |
|--------------|----------|------|
| `{{pod}}` | `web-abc123` | 단일 라벨 값 |
| `{{namespace}}/{{pod}}` | `production/web-abc123` | 여러 라벨 조합 |
| `CPU - {{instance}}` | `CPU - 10.0.0.1:9100` | 고정 텍스트 + 라벨 |
| `{{__name__}}` | `node_cpu_seconds_total` | 메트릭 이름 |
| (비워두기) | `{pod="web", ns="prod"}` | 전체 라벨셋 표시 |

#### Exemplar 연동

Prometheus Exemplar는 메트릭 데이터 포인트에 traceID를 첨부하는 기능이다. Grafana에서 Time series 패널의 데이터 포인트 위에 마우스를 올리면 Exemplar 아이콘이 표시되고, 클릭하면 Tempo로 이동하여 해당 트레이스를 조회할 수 있다.

```
Prometheus Exemplar 흐름:
App(OpenTelemetry SDK) → Prometheus(exemplar 저장) → Grafana(exemplar 조회) → Tempo(trace 조회)
```

### 2.2 Loki

Loki는 Grafana Labs에서 개발한 수평 확장 가능한 로그 집계 시스템이다. 이 프로젝트에서는 `loki-stack` Helm Chart로 배포되며, Promtail이 로그 수집 에이전트 역할을 한다.

#### Loki Data Source 설정

```yaml
datasources:
  - name: Loki
    type: loki
    access: proxy
    url: http://loki.monitoring.svc.cluster.local:3100
    jsonData:
      maxLines: 1000              # 한 번에 반환할 최대 로그 라인 수
      timeout: 60s                # 쿼리 타임아웃
      derivedFields:
        - datasourceUid: tempo
          matcherRegex: '"traceId":"(\\w+)"'
          name: TraceID
          url: "$${__value.raw}"
```

#### LogQL Query Editor

Loki Query Editor도 Builder와 Code 모드를 지원한다:

**Builder 모드**:
```
Label filters: {namespace="monitoring", container="grafana"}
Pipeline:
  1. Line contains: "error"
  2. Parser: logfmt
  3. Label filter: level = "error"
Operations: Count over time [range: $__interval]
```

**Code 모드**:
```logql
# 로그 쿼리 (Log Query) - 로그 라인을 반환
{namespace="monitoring"} |= "error" | logfmt | level="error"

# 메트릭 쿼리 (Metric Query) - 숫자 값을 반환
count_over_time({namespace="monitoring"} |= "error" [5m])
sum by (level) (count_over_time({namespace="monitoring"} | logfmt [5m]))
rate({namespace="monitoring"} | logfmt | unwrap duration [5m])
```

#### LogQL 파이프라인 스테이지

LogQL은 파이프(`|`) 연산자로 여러 처리 스테이지를 체이닝한다:

| 스테이지 유형 | 예시 | 설명 |
|-------------|------|------|
| Line Filter | `\|= "error"` | 문자열을 포함하는 라인만 선택한다 |
| Negative Filter | `!= "debug"` | 문자열을 포함하지 않는 라인만 선택한다 |
| Regex Filter | `\|~ "error\|warn"` | 정규표현식에 매칭되는 라인만 선택한다 |
| Parser (logfmt) | `\| logfmt` | `key=value` 형식의 로그를 파싱한다 |
| Parser (json) | `\| json` | JSON 형식의 로그를 파싱한다 |
| Parser (pattern) | `\| pattern "<ip> - <_> [<_>] \"<method> <path>\""` | 패턴 매칭으로 파싱한다 |
| Parser (regexp) | `\| regexp "(?P<ip>\\d+\\.\\d+\\.\\d+\\.\\d+)"` | 정규표현식으로 파싱한다 |
| Label Filter | `\| level = "error"` | 파싱된 라벨로 필터링한다 |
| Line Format | `\| line_format "{{.level}}: {{.msg}}"` | 로그 라인을 재포맷한다 |
| Label Format | `\| label_format duration="{{.duration}}ms"` | 라벨 값을 변환한다 |
| Unwrap | `\| unwrap duration` | 라벨 값을 숫자로 변환(메트릭 쿼리용)한다 |

### 2.3 Tempo

Tempo는 Grafana Labs의 분산 트레이싱 백엔드이다. Jaeger, Zipkin, OpenTelemetry 포맷을 모두 지원한다.

#### Tempo Data Source 설정

```yaml
datasources:
  - name: Tempo
    type: tempo
    access: proxy
    url: http://tempo.monitoring.svc.cluster.local:3200
    jsonData:
      tracesToLogsV2:
        datasourceUid: loki
        spanStartTimeShift: "-1h"
        spanEndTimeShift: "1h"
        tags:
          - key: "service.name"
            value: "service_name"
        filterByTraceID: true
        filterBySpanID: true
      tracesToMetrics:
        datasourceUid: prometheus
        tags:
          - key: "service.name"
            value: "service_name"
        queries:
          - name: "Request rate"
            query: "sum(rate(http_requests_total{$__tags}[$__rate_interval]))"
          - name: "Error rate"
            query: "sum(rate(http_requests_total{$__tags,status_code=~\"5..\"}[$__rate_interval]))"
      nodeGraph:
        enabled: true
      serviceMap:
        datasourceUid: prometheus
      search:
        hide: false
      lokiSearch:
        datasourceUid: loki
```

#### Tempo Query 유형

| 쿼리 유형 | 설명 | 사용 시나리오 |
|----------|------|-------------|
| Trace ID 검색 | 특정 traceID로 직접 조회한다 | 로그에서 추출한 traceID로 트레이스 확인 |
| Search | 서비스, 기간, 태그 등으로 트레이스를 검색한다 | 느린 요청 탐색 |
| Service Graph | 서비스 간 호출 관계를 시각화한다 | 마이크로서비스 토폴로지 파악 |
| TraceQL | Tempo의 쿼리 언어로 정밀 검색한다 | 복잡한 조건의 트레이스 필터링 |

```traceql
# TraceQL 예시
{ resource.service.name = "api-server" && span.http.status_code >= 500 && duration > 1s }

# 특정 경로의 느린 요청 찾기
{ span.http.url =~ "/api/v1/.*" && duration > 2s }
```

### 2.4 Elasticsearch

Elasticsearch는 로그와 메트릭 분석에 사용되는 검색/분석 엔진이다.

#### Query Editor 기능

```json
// Elasticsearch Query (Lucene 구문)
{
  "query": "level:error AND service:api-server",
  "metrics": [
    { "type": "count", "id": "1" },
    { "type": "avg", "field": "response_time", "id": "2" }
  ],
  "bucketAggs": [
    { "type": "date_histogram", "field": "@timestamp", "id": "3",
      "settings": { "interval": "auto" } },
    { "type": "terms", "field": "host.keyword", "id": "4",
      "settings": { "size": "10", "order": "desc", "orderBy": "_count" } }
  ]
}
```

| 기능 | 설명 |
|------|------|
| Lucene Query | Lucene 쿼리 구문으로 검색한다 (`field:value AND/OR`) |
| Metric Aggregation | Count, Avg, Sum, Min, Max, Percentiles, Unique Count 등을 지원한다 |
| Bucket Aggregation | Date Histogram, Terms, Filters, Geo Hash Grid 등으로 그룹핑한다 |
| Pipeline Aggregation | Moving Average, Derivative, Cumulative Sum 등 파이프라인 집계를 지원한다 |
| Ad hoc filter | 클릭으로 필터를 즉시 추가/제거한다 |
| Annotations | Elasticsearch 쿼리 결과를 Annotation으로 표시한다 |

### 2.5 PostgreSQL

PostgreSQL 데이터소스는 SQL로 직접 데이터를 조회하여 시각화한다.

```sql
-- Time series 쿼리 (시간 컬럼 필수)
SELECT
  created_at AS "time",
  count(*) AS "orders",
  sum(total_amount) AS "revenue"
FROM orders
WHERE
  created_at >= $__timeFrom()
  AND created_at < $__timeTo()
  AND region IN ($region)
GROUP BY 1
ORDER BY 1

-- Table 쿼리
SELECT
  customer_name,
  email,
  total_orders,
  last_order_date
FROM customer_summary
WHERE region = '$region'
ORDER BY total_orders DESC
LIMIT 100
```

#### PostgreSQL 매크로

| 매크로 | 확장 결과 | 설명 |
|--------|----------|------|
| `$__timeFrom()` | `'2024-01-01T00:00:00Z'` | 대시보드 시간 범위 시작 |
| `$__timeTo()` | `'2024-01-01T06:00:00Z'` | 대시보드 시간 범위 끝 |
| `$__timeFilter(column)` | `column >= ... AND column < ...` | 시간 필터 조건 자동 생성 |
| `$__timeGroup(column, '5m')` | `floor(extract(epoch from column)/300)*300` | 시간 그룹핑 |
| `$__unixEpochFilter(column)` | epoch 기반 시간 필터 | Unix timestamp 컬럼용 |

### 2.6 MySQL

MySQL 데이터소스는 PostgreSQL과 유사하지만 MySQL 고유 구문을 사용한다.

```sql
SELECT
  UNIX_TIMESTAMP(created_at) as time_sec,
  count(*) as value,
  status as metric
FROM requests
WHERE $__timeFilter(created_at)
GROUP BY time_sec, status
ORDER BY time_sec
```

### 2.7 InfluxDB

InfluxDB는 시계열 데이터에 특화된 데이터베이스이다. Flux와 InfluxQL 두 가지 쿼리 언어를 지원한다.

```flux
// Flux 쿼리 예시
from(bucket: "monitoring")
  |> range(start: v.timeRangeStart, stop: v.timeRangeStop)
  |> filter(fn: (r) => r._measurement == "cpu")
  |> filter(fn: (r) => r._field == "usage_idle")
  |> filter(fn: (r) => r.host =~ /^${host:regex}$/)
  |> aggregateWindow(every: v.windowPeriod, fn: mean)
  |> map(fn: (r) => ({ r with _value: 100.0 - r._value }))
  |> yield(name: "cpu_usage")
```

```influxql
-- InfluxQL 쿼리 예시
SELECT mean("usage_idle")
FROM "cpu"
WHERE $timeFilter
  AND "host" =~ /^$host$/
GROUP BY time($__interval), "host"
fill(null)
```

### 2.8 Data Source 간 상관관계 (Correlations)

Grafana 10+에서 도입된 Correlations 기능은 서로 다른 데이터소스 간의 연결을 정의한다:

```
Metrics (Prometheus)  ←──────→  Logs (Loki)  ←──────→  Traces (Tempo)
   │ exemplars                    │ derived fields         │ tracesToLogs
   │                              │                        │ tracesToMetrics
   └──────────── Correlations ────┴────────────────────────┘
```

| 연결 방향 | 설정 위치 | 메커니즘 |
|----------|----------|---------|
| Metrics → Traces | Prometheus DS > Exemplar | traceID가 포함된 exemplar 클릭 |
| Logs → Traces | Loki DS > Derived Fields | 로그 메시지에서 traceID regex 추출 |
| Traces → Logs | Tempo DS > Traces to Logs | trace span의 태그로 Loki 쿼리 생성 |
| Traces → Metrics | Tempo DS > Traces to Metrics | trace 태그를 PromQL 라벨로 매핑 |
| Any → Any | Settings > Correlations | 범용 상관관계 정의 |

---

## 3장: Dashboard 설계 심화

### 3.1 JSON Model 구조

Grafana 대시보드는 내부적으로 하나의 JSON 문서로 표현된다. 이 JSON Model의 주요 구조는 다음과 같다:

```json
{
  "id": null,
  "uid": "abc123",
  "title": "My Dashboard",
  "tags": ["kubernetes", "production"],
  "timezone": "browser",
  "schemaVersion": 39,
  "version": 1,
  "refresh": "30s",
  "time": {
    "from": "now-6h",
    "to": "now"
  },
  "fiscalYearStartMonth": 0,
  "liveNow": false,
  "weekStart": "",
  "graphTooltip": 1,
  "templating": {
    "list": [
      {
        "name": "namespace",
        "type": "query",
        "datasource": "Prometheus",
        "query": "label_values(kube_pod_info, namespace)",
        "refresh": 2,
        "multi": true,
        "includeAll": true,
        "current": {},
        "sort": 1,
        "regex": "",
        "hide": 0
      }
    ]
  },
  "panels": [
    {
      "id": 1,
      "title": "CPU Usage",
      "type": "timeseries",
      "gridPos": { "h": 8, "w": 12, "x": 0, "y": 0 },
      "datasource": { "type": "prometheus", "uid": "prometheus-uid" },
      "targets": [
        {
          "expr": "rate(container_cpu_usage_seconds_total{namespace=\"$namespace\"}[5m])",
          "legendFormat": "{{pod}}",
          "refId": "A",
          "editorMode": "code",
          "range": true,
          "instant": false
        }
      ],
      "fieldConfig": {
        "defaults": {
          "unit": "percentunit",
          "custom": {
            "drawStyle": "line",
            "lineInterpolation": "smooth",
            "fillOpacity": 10,
            "gradientMode": "scheme",
            "lineWidth": 2,
            "pointSize": 5,
            "showPoints": "auto",
            "spanNulls": false,
            "stacking": { "mode": "none" },
            "axisPlacement": "auto",
            "thresholdsStyle": { "mode": "off" }
          },
          "thresholds": {
            "mode": "absolute",
            "steps": [
              { "color": "green", "value": null },
              { "color": "yellow", "value": 0.6 },
              { "color": "red", "value": 0.8 }
            ]
          },
          "color": { "mode": "palette-classic" },
          "mappings": [],
          "min": 0,
          "max": 1
        },
        "overrides": [
          {
            "matcher": { "id": "byName", "options": "critical-pod" },
            "properties": [
              { "id": "color", "value": { "fixedColor": "red", "mode": "fixed" } },
              { "id": "custom.lineWidth", "value": 3 }
            ]
          }
        ]
      },
      "options": {
        "tooltip": { "mode": "multi", "sort": "desc" },
        "legend": { "displayMode": "table", "placement": "bottom", "calcs": ["mean", "max", "last"] }
      },
      "transformations": []
    }
  ],
  "annotations": {
    "list": [
      {
        "name": "Deployments",
        "datasource": "-- Grafana --",
        "enable": true,
        "iconColor": "blue"
      }
    ]
  },
  "links": [
    {
      "title": "Related Dashboard",
      "url": "/d/node-exporter/node-exporter-full",
      "type": "link",
      "icon": "external link",
      "targetBlank": true
    }
  ]
}
```

주요 필드의 의미는 다음과 같다:

| 필드 | 설명 |
|------|------|
| `uid` | 대시보드의 고유 식별자이다. Provisioning 시 동일 UID로 업데이트를 보장한다 |
| `schemaVersion` | JSON 스키마 버전이다. Grafana가 마이그레이션 시 참조한다 |
| `graphTooltip` | 툴팁 공유 모드이다. 0=기본, 1=공유 Crosshair, 2=공유 Tooltip |
| `templating.list` | 템플릿 변수 목록이다. 대시보드 상단 드롭다운으로 렌더링된다 |
| `panels[].gridPos` | 패널의 위치와 크기이다. `h`(높이), `w`(너비), `x`, `y` 좌표를 사용한다 |
| `panels[].targets` | 데이터소스 쿼리 목록이다. PromQL, LogQL 등을 포함한다 |
| `panels[].fieldConfig.defaults` | 기본 필드 설정 (단위, 임계값, 색상, 커스텀 옵션)이다 |
| `panels[].fieldConfig.overrides` | 특정 시리즈/필드에 대한 설정 오버라이드이다 |
| `panels[].options` | 패널 타입별 고유 옵션 (tooltip, legend 등)이다 |
| `panels[].transformations` | 쿼리 결과를 후처리하는 변환 파이프라인이다 |
| `links` | 대시보드 레벨의 외부/내부 링크이다 |

### 3.2 Grid Layout 시스템

Grafana 대시보드는 24컬럼 그리드 시스템을 사용한다:

```
    0    4    8    12   16   20   24
    ├────┼────┼────┼────┼────┼────┤
 0  │    Panel A (w=12)  │ Panel B│
    │    h=8             │ (w=12) │
 8  │                    │ h=8    │
    ├────────────────────┴────────┤
 8  │        Panel C (w=24, h=4) │
    ├─────────────┬───────────────┤
12  │  Panel D    │   Panel E     │
    │  w=8, h=6   │   w=16, h=6  │
    ├─────────────┴───────────────┤
```

| gridPos 속성 | 설명 | 유효 범위 |
|-------------|------|----------|
| `w` (width) | 패널 너비 (그리드 열 단위) | 1~24 |
| `h` (height) | 패널 높이 (그리드 행 단위) | 1 이상 (제한 없음) |
| `x` | 좌측 시작 열 | 0~23 |
| `y` | 상단 시작 행 | 0 이상 |

### 3.3 템플릿 변수 (Template Variables)

Grafana는 여러 종류의 내장 변수와 사용자 정의 변수를 지원한다.

**내장 전역 변수**:
| 변수 | 설명 |
|------|------|
| `$__interval` | 현재 시간 범위와 패널 너비(px)를 기반으로 자동 계산된 interval이다. `rate(metric[$__interval])` 형태로 사용한다 |
| `$__rate_interval` | `$__interval`의 최소 4배를 보장하는 interval이다. `rate()` 함수에서 scrape interval보다 짧은 range를 방지한다. Prometheus 데이터소스 전용이다 |
| `$__range` | 대시보드에서 선택한 시간 범위 전체이다 (예: `6h`) |
| `$__from`, `$__to` | 대시보드 시간 범위의 시작/끝 epoch 밀리초이다 |
| `$__name` | 시리즈 이름이다. Legend format에서 사용한다 |
| `$__org` | 현재 조직의 ID이다 |
| `$__dashboard` | 현재 대시보드의 이름이다 |
| `$__user` | 현재 로그인 사용자 정보이다 |
| `$__interval_ms` | `$__interval`의 밀리초 표현이다 |

**사용자 정의 변수 유형**:
| 유형 | 설명 |
|------|------|
| Query | 데이터소스에 쿼리하여 값 목록을 동적으로 생성한다 |
| Custom | 쉼표로 구분된 고정 값 목록을 정의한다 (예: `production,staging,dev`) |
| Constant | 대시보드 내에서 사용하는 상수 값이다. Provisioning에서 환경별 값 주입에 유용하다 |
| Interval | 사용자가 선택할 수 있는 시간 간격 목록이다 (예: `1m,5m,15m,1h`) |
| Text box | 사용자가 자유 텍스트를 입력할 수 있는 변수이다 |
| Data source | 지정한 유형의 데이터소스 목록을 자동으로 보여준다 |
| Ad hoc filters | 패널 쿼리에 자동으로 label filter를 추가하는 동적 변수이다 |

#### 변수 값 포맷팅 (Multi-value Variable)

Multi-value 변수를 쿼리에 사용할 때 포맷팅이 중요하다:

| 문법 | 결과 | 용도 |
|------|------|------|
| `$namespace` | `production` (단일값), `(production\|staging)` (다중값) | PromQL regex 매칭 기본 |
| `${namespace:csv}` | `production,staging` | SQL IN 절 |
| `${namespace:pipe}` | `production\|staging` | 정규표현식 대안 |
| `${namespace:json}` | `["production","staging"]` | JSON 배열 |
| `${namespace:regex}` | `production\|staging` | 명시적 regex |
| `${namespace:singlequote}` | `'production','staging'` | SQL 문자열 |
| `${namespace:doublequote}` | `"production","staging"` | 큰따옴표 SQL |
| `${namespace:glob}` | `{production,staging}` | Glob 패턴 |
| `${namespace:text}` | `production + staging` | 표시용 텍스트 |
| `${namespace:queryparam}` | `var-namespace=production&var-namespace=staging` | URL 파라미터 |

#### 변수 체이닝 (Chained Variables)

변수 간 의존관계를 설정하여 계층적 필터링을 구현할 수 있다:

```
cluster (Query: label_values(up, cluster))
    └── namespace (Query: label_values(kube_pod_info{cluster="$cluster"}, namespace))
        └── pod (Query: label_values(kube_pod_info{cluster="$cluster",namespace="$namespace"}, pod))
            └── container (Query: label_values(container_cpu_usage_seconds_total{cluster="$cluster",namespace="$namespace",pod="$pod"}, container))
```

cluster 변수가 변경되면 namespace → pod → container 순서로 연쇄적으로 재로딩된다.

### 3.4 Repeating Panels / Rows

**Repeat Panels / Rows**: 변수의 각 값에 대해 패널 또는 Row를 자동 복제하는 기능이다. 예를 들어 `$namespace` 변수에 Multi-value를 활성화하고 패널의 Repeat 옵션에 `namespace`를 지정하면, 선택된 네임스페이스마다 동일한 패널이 자동 생성된다.

#### Repeat Panel 설정

```json
{
  "id": 1,
  "title": "CPU Usage - $namespace",
  "repeat": "namespace",
  "repeatDirection": "h",
  "maxPerRow": 4,
  "gridPos": { "h": 8, "w": 6, "x": 0, "y": 0 },
  "targets": [
    {
      "expr": "sum(rate(container_cpu_usage_seconds_total{namespace=\"$namespace\"}[$__rate_interval])) by (pod)"
    }
  ]
}
```

| 설정 | 설명 |
|------|------|
| `repeat` | 반복할 변수 이름이다 |
| `repeatDirection` | `h`(수평, 같은 행에 나열) 또는 `v`(수직, 아래로 나열) |
| `maxPerRow` | 수평 반복 시 한 행에 최대 패널 수이다. 초과하면 다음 행으로 이동한다 |

#### Repeat Row 설정

Row 레벨에서 반복하면 Row 전체(포함된 모든 패널)가 변수값마다 복제된다:

```json
{
  "type": "row",
  "title": "Namespace: $namespace",
  "repeat": "namespace",
  "collapsed": false,
  "panels": [
    { "title": "CPU", "type": "timeseries", "..." : "..." },
    { "title": "Memory", "type": "timeseries", "..." : "..." }
  ]
}
```

### 3.5 Annotations (주석)

Annotation은 대시보드의 시간축 위에 수직선이나 영역으로 이벤트를 표시하는 기능이다. 배포, 장애, 설정 변경 등을 시각화하여 메트릭 변화의 원인을 파악하는 데 도움을 준다.

#### Manual Annotation
Grafana UI에서 직접 시간 범위를 선택하고 설명을 입력하여 생성한다. 또는 Grafana HTTP API를 통해 프로그래밍 방식으로 생성할 수 있다:

```bash
# 배포 시 CI/CD 파이프라인에서 Annotation 생성
curl -X POST http://grafana:3000/api/annotations \
  -H "Authorization: Bearer $GRAFANA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "dashboardUID": "abc123",
    "time": 1672531200000,
    "timeEnd": 1672531500000,
    "tags": ["deploy", "production", "v2.3.1"],
    "text": "v2.3.1 배포 완료 - commit: a1b2c3d"
  }'
```

#### Query-based Annotation
데이터소스 쿼리를 실행하여 자동으로 Annotation을 생성한다:

```
# Prometheus Annotation 쿼리 예시
ALERTS{alertname="DeploymentReplicasMismatch", severity="warning"}

# Loki Annotation 쿼리 예시
{job="argocd-server"} |= "sync completed"
```

이를 통해 ArgoCD 배포 이벤트를 자동으로 대시보드에 표시할 수 있다.

#### Annotation JSON 구조

```json
{
  "annotations": {
    "list": [
      {
        "name": "Deployments",
        "datasource": { "type": "loki", "uid": "loki-uid" },
        "enable": true,
        "iconColor": "blue",
        "expr": "{job=\"argocd-server\"} |= \"sync completed\" | json",
        "titleFormat": "Deploy: {{app}}",
        "textFormat": "Revision: {{revision}}, Status: {{status}}",
        "tagKeys": "app,environment"
      },
      {
        "name": "Alerts",
        "datasource": { "type": "prometheus", "uid": "prom-uid" },
        "enable": true,
        "iconColor": "red",
        "expr": "ALERTS{severity=\"critical\"}",
        "step": "60s",
        "titleFormat": "{{alertname}}",
        "tagKeys": "severity,namespace"
      }
    ]
  }
}
```

### 3.6 Dashboard Links

대시보드 레벨에서 다른 대시보드, 외부 URL, 또는 동적 링크를 정의할 수 있다:

| 링크 유형 | 설명 | 예시 |
|----------|------|------|
| Dashboard Link | 다른 Grafana 대시보드로 이동한다 | Node Exporter Full 대시보드 |
| URL Link | 외부 URL로 이동한다 | Runbook, Wiki, PagerDuty |
| Dashboards by tag | 특정 태그를 가진 모든 대시보드 목록을 표시한다 | `kubernetes` 태그 대시보드 |

```json
{
  "links": [
    {
      "type": "dashboards",
      "tags": ["kubernetes"],
      "title": "Kubernetes Dashboards",
      "asDropdown": true,
      "includeVars": true,
      "keepTime": true
    },
    {
      "type": "link",
      "title": "Runbook",
      "url": "https://wiki.example.com/runbook/${__dashboard}",
      "targetBlank": true,
      "icon": "doc"
    }
  ]
}
```

`includeVars: true`는 현재 변수 값을 URL 파라미터로 전달한다. `keepTime: true`는 현재 시간 범위를 유지한다.

---

