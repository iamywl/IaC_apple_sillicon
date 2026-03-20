# Day 3: Panel 타입 및 쿼리 언어 (PromQL, LogQL)

> Grafana의 다양한 Panel 타입별 활용법과, Grafana 환경에서의 PromQL 및 LogQL 쿼리 작성법을 학습한다.

## 4장: Panel 타입별 상세

Grafana는 다양한 내장 Panel 유형을 제공한다. 각 유형은 특정 데이터 형태와 사용 사례에 최적화되어 있다.

### 4.1 Time Series

시간에 따른 메트릭 추이를 선/면/막대 차트로 표시한다. Grafana에서 가장 많이 사용되는 패널 유형이다.

```json
{
  "type": "timeseries",
  "fieldConfig": {
    "defaults": {
      "custom": {
        "drawStyle": "line",          // line, bars, points
        "lineInterpolation": "smooth", // linear, smooth, stepBefore, stepAfter
        "fillOpacity": 10,             // 0-100
        "gradientMode": "scheme",      // none, opacity, hue, scheme
        "lineWidth": 2,
        "pointSize": 5,
        "showPoints": "auto",          // auto, always, never
        "spanNulls": false,            // null 값 연결 여부
        "stacking": {
          "mode": "none",              // none, normal, percent
          "group": "A"
        },
        "axisPlacement": "auto",       // auto, left, right, hidden
        "axisLabel": "CPU %",
        "scaleDistribution": {
          "type": "linear"             // linear, log (base 2/10)
        },
        "thresholdsStyle": {
          "mode": "line+area"          // off, line, area, line+area, dashed, dashed+area
        }
      }
    }
  },
  "options": {
    "tooltip": {
      "mode": "multi",       // single, multi, none
      "sort": "desc"         // none, asc, desc
    },
    "legend": {
      "displayMode": "table",  // list, table, hidden
      "placement": "bottom",   // bottom, right
      "calcs": ["mean", "max", "last"],
      "sortBy": "Last",
      "sortDesc": true
    }
  }
}
```

#### 주요 Draw Style 비교

| Draw Style | 적합한 데이터 | 예시 |
|-----------|-------------|------|
| Line | 연속적인 메트릭 | CPU 사용률, 메모리 사용량 |
| Bars | 이산적인 이벤트 카운트 | 요청 수, 에러 수 (시간 간격별) |
| Points | 산발적인 데이터 포인트 | Exemplar, 비정기 이벤트 |
| Line + Points | 데이터가 드문 시리즈 | 낮은 빈도의 메트릭 |

#### Stacking 모드

| 모드 | 설명 | 사용 사례 |
|------|------|----------|
| None | 각 시리즈를 독립적으로 표시한다 | 개별 Pod CPU 비교 |
| Normal | 시리즈를 쌓아 올려 전체 합계를 시각화한다 | 전체 네트워크 트래픽 구성 |
| Percent | 각 시리즈가 전체에서 차지하는 비율을 표시한다 | HTTP 상태 코드 비율 |

### 4.2 Stat

단일 숫자 값을 크게 표시한다. 배경색으로 상태를 나타낸다.

```json
{
  "type": "stat",
  "options": {
    "reduceOptions": {
      "values": false,
      "calcs": ["lastNotNull"],  // last, lastNotNull, mean, max, min, sum, count, range, delta, diff
      "fields": ""
    },
    "orientation": "auto",       // auto, horizontal, vertical
    "textMode": "auto",          // auto, value, value_and_name, name, none
    "colorMode": "background",   // none, value, background, background_solid
    "graphMode": "area",         // none, line, area
    "justifyMode": "auto",       // auto, center
    "wideLayout": true,
    "text": {
      "titleSize": 14,
      "valueSize": 40
    }
  }
}
```

| 옵션 | 설명 |
|------|------|
| `calcs` | 여러 데이터 포인트를 단일 값으로 축소하는 함수이다 |
| `colorMode` | `background`는 전체 배경색 변경, `value`는 숫자 색상만 변경한다 |
| `graphMode` | `area`는 미니 스파크라인 그래프를 배경에 표시한다 |
| `textMode` | `value_and_name`은 값과 시리즈 이름을 함께 표시한다 |

### 4.3 Gauge

최솟값~최댓값 범위 내 현재 값을 게이지로 표시한다.

```json
{
  "type": "gauge",
  "fieldConfig": {
    "defaults": {
      "min": 0,
      "max": 100,
      "unit": "percent",
      "thresholds": {
        "steps": [
          { "color": "green", "value": null },
          { "color": "yellow", "value": 70 },
          { "color": "red", "value": 90 }
        ]
      }
    }
  },
  "options": {
    "reduceOptions": { "calcs": ["lastNotNull"] },
    "showThresholdLabels": false,
    "showThresholdMarkers": true,
    "orientation": "auto",
    "text": {}
  }
}
```

### 4.4 Bar Chart

범주형 데이터를 막대 차트로 비교한다. Time series의 Bar 모드와 달리 X축이 시간이 아닌 범주이다.

```json
{
  "type": "barchart",
  "fieldConfig": {
    "defaults": {
      "custom": {
        "fillOpacity": 80,
        "gradientMode": "hue",
        "lineWidth": 1,
        "axisCenteredZero": false,
        "stacking": { "mode": "none" }
      }
    }
  },
  "options": {
    "orientation": "horizontal",  // auto, horizontal, vertical
    "barWidth": 0.8,
    "groupWidth": 0.7,
    "showValue": "auto",          // auto, always, never
    "xTickLabelRotation": -45,
    "legend": { "displayMode": "list", "placement": "bottom" },
    "tooltip": { "mode": "multi" }
  }
}
```

적합한 사용 사례:
- 네임스페이스별 Pod 수 비교
- 서비스별 에러율 순위
- 노드별 리소스 사용량 비교

### 4.5 Table

데이터를 테이블 형식으로 표시한다. 정렬, 필터링, 셀 색상 지정이 가능하다.

```json
{
  "type": "table",
  "fieldConfig": {
    "defaults": {
      "custom": {
        "align": "auto",
        "cellOptions": { "type": "auto" },
        "filterable": true,
        "inspect": true
      }
    },
    "overrides": [
      {
        "matcher": { "id": "byName", "options": "CPU %" },
        "properties": [
          {
            "id": "custom.cellOptions",
            "value": {
              "type": "gauge",
              "mode": "gradient",
              "valueDisplayMode": "text"
            }
          },
          { "id": "thresholds", "value": {
            "steps": [
              { "color": "green", "value": null },
              { "color": "yellow", "value": 60 },
              { "color": "red", "value": 80 }
            ]
          }}
        ]
      },
      {
        "matcher": { "id": "byName", "options": "Status" },
        "properties": [
          {
            "id": "custom.cellOptions",
            "value": { "type": "color-text" }
          },
          { "id": "mappings", "value": [
            { "type": "value", "options": { "Running": { "color": "green", "text": "Running" } } },
            { "type": "value", "options": { "CrashLoopBackOff": { "color": "red", "text": "CrashLoopBackOff" } } }
          ]}
        ]
      }
    ]
  },
  "options": {
    "showHeader": true,
    "sortBy": [{ "displayName": "CPU %", "desc": true }],
    "cellHeight": "sm",
    "footer": {
      "show": true,
      "reducer": ["sum", "mean"],
      "fields": ["CPU %", "Memory"]
    }
  }
}
```

#### Table Cell Display 모드

| 모드 | 설명 |
|------|------|
| Auto | 자동으로 적절한 표시 방식을 선택한다 |
| Color text | 임계값에 따라 텍스트 색상을 변경한다 |
| Color background | 임계값에 따라 셀 배경색을 변경한다 |
| Gauge | 셀 내에 미니 게이지를 표시한다 |
| JSON view | JSON 데이터를 확장/축소 가능한 트리로 표시한다 |
| Image | URL을 이미지로 렌더링한다 |
| Data links | 클릭 가능한 링크로 표시한다 |
| Sparkline | 셀 내에 미니 시계열 차트를 표시한다 |

### 4.6 Heatmap

시간 x 버킷 매트릭스를 색상 강도로 표현한다.

```json
{
  "type": "heatmap",
  "fieldConfig": {
    "defaults": {
      "custom": {
        "scaleDistribution": { "type": "log", "log": 2 }
      }
    }
  },
  "options": {
    "calculate": false,
    "yAxis": {
      "axisPlacement": "left",
      "unit": "s",
      "reverse": false
    },
    "cellGap": 1,
    "color": {
      "mode": "scheme",
      "scheme": "Oranges",
      "fill": "dark-orange",
      "scale": "exponential",
      "exponent": 0.5,
      "steps": 64
    },
    "exemplars": { "color": "rgba(255,0,255,0.7)" },
    "tooltip": { "show": true, "yHistogram": true },
    "legend": { "show": true },
    "showValue": "never",
    "cellValues": { "unit": "short" }
  }
}
```

적합한 PromQL:
```promql
# Prometheus histogram_bucket 메트릭을 Heatmap으로 표시
sum(rate(http_request_duration_seconds_bucket{namespace="$namespace"}[$__rate_interval])) by (le)
# Format: Heatmap, Type: Range
```

### 4.7 Histogram

값의 분포를 히스토그램으로 표시한다. Heatmap과 달리 시간축이 없고 단일 시점(또는 전체 범위)의 분포를 보여준다.

```json
{
  "type": "histogram",
  "options": {
    "bucketCount": 30,
    "bucketSize": 10,
    "combine": false,
    "fillOpacity": 80,
    "gradientMode": "scheme",
    "legend": { "displayMode": "list", "placement": "bottom" },
    "tooltip": { "mode": "multi" }
  }
}
```

### 4.8 Geomap

지도 위에 데이터 포인트를 표시한다.

```json
{
  "type": "geomap",
  "options": {
    "view": {
      "id": "coords",
      "lat": 37.5665,
      "lon": 126.9780,
      "zoom": 6
    },
    "basemap": {
      "type": "default",
      "name": "OpenStreetMap"
    },
    "layers": [
      {
        "type": "markers",
        "config": {
          "showLegend": true,
          "style": {
            "size": { "field": "latency", "min": 5, "max": 30 },
            "color": { "field": "status" },
            "symbol": "circle"
          }
        },
        "location": {
          "mode": "coords",
          "latitude": "lat",
          "longitude": "lon"
        }
      }
    ]
  }
}
```

적합한 사용 사례:
- CDN 엣지 서버 위치별 트래픽 표시
- 글로벌 서비스의 지역별 레이턴시 시각화
- 데이터센터 위치 표시

### 4.9 Node Graph

노드와 엣지로 구성된 그래프를 표시한다. 서비스 간 의존관계, 네트워크 토폴로지 등을 시각화한다.

```
┌────────┐         ┌────────┐         ┌────────┐
│  web   │────────▶│  api   │────────▶│  db    │
│ 120rps │  80ms   │ 120rps │  5ms    │ 120qps │
└────────┘         └────────┘         └────────┘
                      │
                      │ 30ms
                      ▼
                   ┌────────┐
                   │ cache  │
                   │ 95hit% │
                   └────────┘
```

Node Graph는 주로 Tempo의 Service Graph 기능과 함께 사용된다. 데이터 프레임은 `nodes` DataFrame과 `edges` DataFrame 두 개가 필요하다.

### 4.10 Logs Panel

로그 라인을 시간순으로 표시한다. Loki/Elasticsearch와 연동한다.

```json
{
  "type": "logs",
  "options": {
    "showTime": true,
    "showLabels": true,
    "showCommonLabels": false,
    "wrapLogMessage": true,
    "prettifyLogMessage": false,
    "enableLogDetails": true,
    "sortOrder": "Descending",
    "dedupStrategy": "none",       // none, exact, numbers, signature
    "showLogContextToggle": true
  }
}
```

| 기능 | 설명 |
|------|------|
| Log Details | 로그 라인 클릭 시 라벨, 파싱된 필드를 확장 표시한다 |
| Log Context | 전후 로그 라인을 컨텍스트로 표시한다 |
| Deduplication | 중복 로그를 제거한다 (exact: 완전 일치, numbers: 숫자 무시, signature: 패턴 일치) |
| Live Tail | 실시간으로 새 로그를 스트리밍한다 |
| Log Volume | 패널 상단에 로그 볼륨 히스토그램을 표시한다 |

### 4.11 Traces Panel

분산 트레이싱 데이터를 Trace View(워터폴 다이어그램)로 표시한다. Tempo, Jaeger, Zipkin 데이터소스와 함께 사용한다.

```
Trace: abc123def456 (Duration: 245ms)
├── service-a: POST /api/orders (245ms)
│   ├── service-b: GET /api/products/123 (80ms)
│   │   └── postgres: SELECT * FROM products (15ms)
│   ├── service-c: POST /api/payments (120ms)
│   │   ├── stripe-api: POST /charges (95ms)
│   │   └── postgres: INSERT INTO payments (10ms)
│   └── kafka: produce order.created (5ms)
```

---

## 5장: PromQL in Grafana

### 5.1 Query Builder vs Code Mode

| 기능 | Builder 모드 | Code 모드 |
|------|-------------|----------|
| 메트릭 선택 | 드롭다운 자동완성 | 타이핑 + 자동완성 |
| 라벨 필터 | GUI 드롭다운 | 직접 작성 `{key="value"}` |
| 연산 추가 | 버튼 클릭으로 추가 | 함수 직접 작성 |
| 복잡한 쿼리 | 제한적 | 자유로움 |
| 학습 곡선 | 낮음 | PromQL 지식 필요 |
| Subquery | 미지원 | 지원 |
| Binary Operations | 제한적 | 완전 지원 |
| 변환 | 자동 (Builder → Code 가능) | Code → Builder 변환 제한적 |

### 5.2 Query Options

| 옵션 | 설명 | 기본값 |
|------|------|--------|
| Legend | 시리즈 이름 포맷이다 | Auto |
| Type | Instant / Range / Both | Range |
| Min step | 최소 step interval이다 | (auto) |
| Format | Time series / Table / Heatmap | Time series |
| Resolution | 1/1, 1/2, 1/3, 1/4, 1/5, 1/10 | 1/1 |
| Max data points | 반환할 최대 데이터 포인트 수이다 | (패널 너비 기반 자동) |

#### Resolution 설정

Resolution은 쿼리의 step 크기를 결정한다. 1/2로 설정하면 step이 2배로 커져 데이터 포인트가 절반으로 줄어든다. 대시보드 로딩 성능이 느릴 때 Resolution을 낮추면 개선할 수 있다.

```
패널 너비: 1200px, 시간 범위: 24h
Resolution 1/1 → step = 24h/1200 ≈ 72s → 1200개 포인트
Resolution 1/2 → step = 24h/600  ≈ 144s → 600개 포인트
Resolution 1/5 → step = 24h/240  ≈ 360s → 240개 포인트
```

### 5.3 Instant Query vs Range Query

| 특성 | Instant Query | Range Query |
|------|-------------|-------------|
| Prometheus API | `/api/v1/query?time=T` | `/api/v1/query_range?start=S&end=E&step=X` |
| 반환 형태 | 벡터 (단일 시점) | 매트릭스 (시간 x 값) |
| Grafana 패널 | Stat, Gauge, Table | Time series, Heatmap |
| 성능 | 가벼움 | step 수에 비례 |
| 쿼리 예시 | `up{job="node-exporter"}` (현재 상태) | `rate(http_requests_total[5m])` (추이) |

### 5.4 PromQL 패턴별 패널 매핑

| PromQL 패턴 | 권장 패널 | 설명 |
|------------|----------|------|
| `rate(counter[interval])` | Time series | 초당 변화율 추이 |
| `histogram_quantile(q, rate(bucket[i])) by (le)` | Time series / Heatmap | 분위수 레이턴시 |
| `sum(gauge) by (label)` | Time series (stacked) | 레이블별 합계 추이 |
| `instant_vector` (단일 값) | Stat, Gauge | 현재 상태 표시 |
| `topk(10, metric)` | Table, Bar chart | 상위 N개 정렬 |
| `count(up == 1) by (job)` | Stat | 서비스별 활성 인스턴스 수 |
| `changes(metric[1h])` | Stat | 값 변경 횟수 |
| `predict_linear(metric[1h], 3600*4)` | Time series | 4시간 후 예측 값 |
| `absent(metric)` | Alert Rule | 메트릭 부재 감지 |

### 5.5 Transformations과 PromQL 조합

여러 PromQL 쿼리의 결과를 Transformation으로 조합하는 패턴:

```
Query A: sum(rate(http_requests_total{status=~"2.."}[$__rate_interval]))
Query B: sum(rate(http_requests_total{status=~"5.."}[$__rate_interval]))
Query C: sum(rate(http_requests_total[$__rate_interval]))

Transformation 1: Join by time (A + B + C를 시간 기준 조인)
Transformation 2: Add field from calculation
  - Success Rate = A / C * 100
  - Error Rate = B / C * 100
Transformation 3: Organize fields (이름 변경, 불필요 필드 숨김)
```

### 5.6 $__rate_interval 심화

`$__rate_interval`은 다음 공식으로 계산된다:

```
$__rate_interval = max($__interval + scrape_interval, 4 * scrape_interval)
```

이 공식이 중요한 이유:
- `rate()`는 최소 2개의 데이터 포인트가 필요하다
- scrape_interval이 15s일 때 range가 15s이면 1개의 포인트만 포함될 수 있다
- `$__rate_interval`은 최소 4 * 15s = 60s를 보장하여 최소 4개의 데이터 포인트를 포함한다
- 이를 통해 rate() 계산의 정확도와 안정성을 확보한다

```promql
# 잘못된 사용 (scrape interval보다 짧은 range)
rate(http_requests_total[15s])  ← 데이터 포인트 부족 가능

# 올바른 사용
rate(http_requests_total[$__rate_interval])  ← 자동으로 안전한 range 보장
```

---

## 6장: LogQL in Grafana

### 6.1 Explore 모드

Explore는 대시보드와 별도의 쿼리 탐색 인터페이스이다. 로그 분석에 특히 유용하다.

```
┌─────────────────────────────────────────────────────────────┐
│ Explore                                    [Split] [Live]  │
├─────────────────────────────────────────────────────────────┤
│ Data source: [Loki ▼]     Time: [Last 1 hour ▼]           │
│ ┌─────────────────────────────────────────────────────────┐│
│ │ {namespace="monitoring"} |= "error" | logfmt            ││
│ └─────────────────────────────────────────────────────────┘│
│ [Run query]                                                │
├─────────────────────────────────────────────────────────────┤
│ Log volume (자동 히스토그램)                                 │
│ ┌─────────────────────────────────────────────────────────┐│
│ │ ▁▂▁▁▅▇█▅▂▁▁▁▂▃▂▁▁▂▁▁▃▁▁▁▁▂▁▁▁                        ││
│ └─────────────────────────────────────────────────────────┘│
├─────────────────────────────────────────────────────────────┤
│ Logs (1,247 lines)                              [Table ▼] │
│                                                            │
│ 2024-01-15 14:23:45  {pod="grafana-abc"}                   │
│ level=error msg="database connection timeout" db=postgres  │
│                                                            │
│ 2024-01-15 14:23:42  {pod="prometheus-xyz"}                │
│ level=error msg="query timeout exceeded" query="..."       │
│                                                            │
│ ...                                                        │
└─────────────────────────────────────────────────────────────┘
```

#### Explore 고유 기능

| 기능 | 설명 |
|------|------|
| Split View | 좌/우 두 개의 쿼리 패널을 나란히 표시한다. 메트릭과 로그를 동시에 비교할 수 있다 |
| Query History | 이전에 실행한 쿼리 이력을 저장하고 재사용한다 |
| Query Inspector | 실제 HTTP 요청/응답을 확인한다. 디버깅에 유용하다 |
| Live Tail | 실시간으로 새 로그를 스트리밍한다 (WebSocket 기반) |
| Content Outline | 쿼리, 패널, 결과 간 빠른 네비게이션을 제공한다 |

### 6.2 Log Context

로그 라인을 클릭하고 "Show context"를 선택하면 해당 로그의 전후 라인을 표시한다. 에러 로그의 원인을 파악할 때 유용하다.

```
── Context (Before) ──────────────────────────────────────────
2024-01-15 14:23:43  level=info  msg="processing request" id=12345
2024-01-15 14:23:44  level=info  msg="connecting to database" host=postgres
2024-01-15 14:23:44  level=warn  msg="connection pool exhausted, waiting..."
── Target Log ────────────────────────────────────────────────
2024-01-15 14:23:45  level=error msg="database connection timeout" db=postgres
── Context (After) ───────────────────────────────────────────
2024-01-15 14:23:45  level=info  msg="retrying connection" attempt=1
2024-01-15 14:23:46  level=info  msg="connection established" latency=1.2s
```

### 6.3 Live Tail

Live Tail은 WebSocket을 통해 실시간으로 로그를 스트리밍하는 기능이다:

```
Explore > [Live] 버튼 클릭

실시간 스트리밍 시작:
→ 14:23:45.001  {pod="web-1"} GET /api/users 200 12ms
→ 14:23:45.023  {pod="web-2"} POST /api/orders 201 45ms
→ 14:23:45.089  {pod="web-1"} GET /api/products 200 8ms
→ 14:23:45.102  {pod="web-3"} GET /api/users/123 500 230ms  ← ERROR
→ 14:23:45.115  {pod="web-1"} GET /api/health 200 1ms
...
[Pause] [Stop]
```

- 필터를 적용한 상태로 Live Tail을 시작하면 해당 조건의 로그만 스트리밍된다
- Pause로 스트리밍을 일시 정지하고 현재까지의 로그를 분석할 수 있다

### 6.4 Log Volume

Explore에서 로그 쿼리를 실행하면 자동으로 Log Volume 히스토그램이 상단에 표시된다. 내부적으로 다음 메트릭 쿼리를 자동 생성한다:

```logql
# 자동 생성되는 Log Volume 쿼리
sum by (level) (count_over_time({namespace="monitoring"} |= "error" | logfmt [$__auto]))
```

Log Volume은 시간대별 로그 발생량을 시각적으로 보여주어 이상 시점을 빠르게 파악할 수 있게 한다. 히스토그램의 특정 영역을 드래그하면 해당 시간 범위로 자동 줌인된다.

### 6.5 LogQL 메트릭 쿼리 유형

로그에서 메트릭을 추출하는 다양한 함수:

| 함수 | 설명 | 예시 |
|------|------|------|
| `count_over_time` | 시간 범위 내 로그 라인 수를 센다 | `count_over_time({app="web"} [5m])` |
| `rate` | 초당 로그 라인 수를 계산한다 | `rate({app="web"} [5m])` |
| `bytes_over_time` | 시간 범위 내 로그 바이트 수를 계산한다 | `bytes_over_time({app="web"} [5m])` |
| `bytes_rate` | 초당 로그 바이트 수를 계산한다 | `bytes_rate({app="web"} [5m])` |
| `sum_over_time` | unwrap된 라벨 값의 합계이다 | `sum_over_time({app="web"} \| unwrap bytes [5m])` |
| `avg_over_time` | unwrap된 라벨 값의 평균이다 | `avg_over_time({app="web"} \| logfmt \| unwrap duration [5m])` |
| `max_over_time` | unwrap된 라벨 값의 최댓값이다 | `max_over_time({app="web"} \| logfmt \| unwrap duration [5m])` |
| `min_over_time` | unwrap된 라벨 값의 최솟값이다 | `min_over_time({app="web"} \| logfmt \| unwrap duration [5m])` |
| `quantile_over_time` | unwrap된 라벨 값의 분위수이다 | `quantile_over_time(0.99, {app="web"} \| logfmt \| unwrap duration [5m])` |
| `first_over_time` | 시간 범위 내 첫 번째 값이다 | `first_over_time({app="web"} \| logfmt \| unwrap status [5m])` |
| `last_over_time` | 시간 범위 내 마지막 값이다 | `last_over_time({app="web"} \| logfmt \| unwrap status [5m])` |

### 6.6 Grafana Loki 연동 (로그 상관분석)

Grafana는 Loki와의 통합을 통해 메트릭과 로그의 상관분석(Correlation)을 지원한다. 이 연동은 SRE의 장애 분석 워크플로우에서 핵심적인 역할을 한다.

#### 메트릭 → 로그 연동

Time series 패널에서 특정 시점의 메트릭 스파이크를 발견했을 때, 해당 시간대의 로그를 즉시 확인할 수 있다:

1. **Split View**: Explore에서 메트릭 쿼리와 로그 쿼리를 나란히 표시한다. 시간 범위가 자동 동기화된다
2. **Panel 링크**: Time series 패널에서 Data link를 설정하여 클릭 시 Loki Explore로 이동한다

```
# Data link URL 예시 (Panel 설정 > Data links)
/explore?orgId=1&left={"datasource":"Loki","queries":[{"expr":"{namespace=\"${__field.labels.namespace}\",pod=\"${__field.labels.pod}\"}"}],"range":{"from":"${__value.time}","to":"${__value.time}"}}
```

#### LogQL 기본 쿼리

```logql
# 특정 네임스페이스의 에러 로그 조회
{namespace="production"} |= "error" | logfmt | level="error"

# 로그에서 메트릭 추출 (Log-based Metrics)
count_over_time({namespace="production"} |= "error" [5m])

# JSON 로그 파싱 후 필터
{app="api-server"} | json | status >= 500

# 로그 볼륨 히스토그램 (Logs 패널 상단에 자동 표시)
sum by (level) (count_over_time({namespace="production"}[$__interval]))
```

#### Derived Fields (로그 → 트레이스 연동)

Loki 데이터소스 설정에서 Derived Fields를 구성하면, 로그 메시지에서 traceID를 자동 추출하여 Tempo로의 링크를 생성한다:

```yaml
# Loki 데이터소스 jsonData 설정
jsonData:
  derivedFields:
    - datasourceUid: tempo-uid
      matcherRegex: '"traceId":"(\\w+)"'
      name: TraceID
      url: "$${__value.raw}"
```

이를 통해 **Metrics → Logs → Traces**의 3축 관측성(Observability)을 하나의 Grafana 인스턴스에서 달성할 수 있다.

---

