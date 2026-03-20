# Day 4: LogQL 고급 레퍼런스, 멀티테넌시, Grafana 활용

LogQL의 모든 연산자와 함수, Line Format Expression, Binary Operations, 멀티테넌시 설정, Grafana에서의 로그 탐색과 대시보드 구성을 학습한다.

---

## LogQL 고급 레퍼런스

### 쿼리 문법 전체 레퍼런스

LogQL은 PromQL의 문법을 기반으로 설계된 Loki 전용 쿼리 언어이다. 크게 Log Query(로그 조회)와 Metric Query(메트릭 집계) 두 가지 유형으로 나뉜다.

```
┌─────────────────────────────────────────────────────────────────────┐
│                        LogQL 쿼리 구조                               │
│                                                                     │
│  Log Query:                                                         │
│  ┌──────────────┐ ┌──────────┐ ┌────────┐ ┌─────────────┐          │
│  │Stream Selector│→│Line Filter│→│ Parser │→│Label Filter │          │
│  │{app="nginx"} │ │|= "error"│ │| json  │ │| status>=500│          │
│  └──────────────┘ └──────────┘ └────────┘ └─────────────┘          │
│                                                     │               │
│                                            ┌────────▼────────┐     │
│                                            │  Line Format     │     │
│                                            │| line_format ... │     │
│                                            └─────────────────┘     │
│                                                                     │
│  Metric Query:                                                      │
│  ┌────────────────────┐ ┌─────────────────┐ ┌──────────────┐       │
│  │Aggregation Operator│→│Range Aggregation│→│  Log Query   │       │
│  │sum by (namespace)  │ │rate(... [5m])   │ │{app="nginx"} │       │
│  └────────────────────┘ └─────────────────┘ └──────────────┘       │
└─────────────────────────────────────────────────────────────────────┘
```

### Stream Selector 상세

Stream Selector는 중괄호 `{}` 안에 레이블 매처를 사용하여 대상 로그 스트림을 선택한다. 최소 하나의 매처가 필수이다.

| 연산자 | 이름 | 설명 | 예시 |
|--------|------|------|------|
| `=` | Equality | 레이블 값이 정확히 일치한다 | `{namespace="demo"}` |
| `!=` | Inequality | 레이블 값이 일치하지 않는다 | `{namespace!="kube-system"}` |
| `=~` | Regex match | 레이블 값이 정규식에 매칭된다 | `{pod=~"nginx-.*"}` |
| `!~` | Regex not match | 레이블 값이 정규식에 매칭되지 않는다 | `{container!~"istio-.*"}` |

**성능 팁:**
- `=` 또는 `!=`는 정규식보다 빠르므로 가능하면 정확한 매칭을 사용한다
- `=~` 정규식에서 `.*`만 사용하는 것은 피한다 (`{app=~".*"}`는 모든 스트림을 선택하므로 매우 느리다)
- 여러 레이블을 조합하여 범위를 좁힐수록 쿼리가 빠르다

```logql
# 좋은 예: 여러 레이블로 범위를 좁힌다
{namespace="demo", app="api", container="api"}

# 나쁜 예: 너무 넓은 범위
{namespace=~".+"}
```

### Line Filter 상세

Line Filter는 로그 본문을 텍스트나 정규식으로 필터링한다. 파이프 `|` 뒤에 위치한다.

| 연산자 | 이름 | 설명 |
|--------|------|------|
| `\|=` | Contains | 문자열을 포함하는 라인만 선택한다 |
| `!=` | Not contains | 문자열을 포함하지 않는 라인만 선택한다 |
| `\|~` | Regex match | 정규식에 매칭되는 라인만 선택한다 |
| `!~` | Regex not match | 정규식에 매칭되지 않는 라인만 선택한다 |

**성능 팁:**
- Line Filter는 Parser보다 먼저 적용하는 것이 성능상 유리하다 (Parser 전에 불필요한 라인을 걸러낸다)
- 문자열 포함(`|=`)은 정규식(`|~`)보다 빠르다
- 여러 Line Filter를 체이닝할 때 가장 선택적인(많이 걸러내는) 필터를 먼저 배치한다

```logql
# 성능이 좋은 순서: 많이 걸러내는 필터 → 적게 걸러내는 필터
{app="api"} |= "error" != "healthcheck" |~ "timeout|refused"

# 대소문자 무시 매칭 (Loki 2.9+)
{app="api"} |= "error" # 대소문자 구분
{app="api"} |~ "(?i)error" # 대소문자 무시
```

### Parser Expressions 상세

Parser Expression은 로그 본문에서 구조화된 데이터를 추출하여 임시 레이블을 생성한다.

**json 파서:**
```logql
# 전체 키 자동 추출
{app="api"} | json

# 특정 키만 추출 (성능 최적화)
{app="api"} | json level, method, status

# 키 이름 변경
{app="api"} | json response_code="status"

# 중첩 JSON 경로
{app="api"} | json user_name="user.profile.name"

# 배열 접근
{app="api"} | json first_tag="tags[0]"
```

**logfmt 파서:**
```logql
# 전체 키 자동 추출
# 입력: level=info method=GET uri=/api/users status=200 duration=45ms
{app="api"} | logfmt

# 특정 키만 추출
{app="api"} | logfmt level, status

# 키 이름 변경
{app="api"} | logfmt response_code="status"
```

**pattern 파서:**
```logql
# 패턴 문법: <name>이 캡처 그룹, <_>이 무시 그룹
# 입력: 192.168.1.1 - admin [15/Jan/2025:10:30:00] "GET /api/users HTTP/1.1" 200 1234

{app="nginx"} | pattern "<ip> - <user> [<_>] \"<method> <uri> <_>\" <status> <size>"

# 캡처된 레이블: ip, user, method, uri, status, size
```

**regexp 파서:**
```logql
# 정규식 Named Group으로 추출
{app="nginx"} | regexp "(?P<ip>\\S+) - (?P<user>\\S+) \\[(?P<ts>[^\\]]+)\\]"

# 특정 패턴만 추출
{app="api"} | regexp "duration=(?P<duration>\\d+)ms"
```

**unpack 파서:**
```logql
# Promtail의 pack stage로 패킹된 로그를 언패킹한다
{app="api"} | unpack
# pack stage가 포함시킨 JSON 필드들이 레이블로 추출된다
```

### Label Filter Expressions 상세

Label Filter는 Parser로 추출된 레이블에 조건을 적용하여 필터링한다.

| 연산자 | 적용 대상 | 설명 |
|--------|---------|------|
| `==`, `=` | 문자열, 숫자 | 같다 |
| `!=` | 문자열, 숫자 | 같지 않다 |
| `>` | 숫자 | 크다 |
| `>=` | 숫자 | 크거나 같다 |
| `<` | 숫자 | 작다 |
| `<=` | 숫자 | 작거나 같다 |
| `=~` | 문자열 | 정규식 매칭 |
| `!~` | 문자열 | 정규식 불매칭 |

```logql
# 문자열 비교
{app="api"} | json | level = "error"
{app="api"} | json | method != "GET"
{app="api"} | json | uri =~ "/api/v[12]/.*"

# 숫자 비교 (자동 타입 변환)
{app="api"} | json | status >= 400
{app="api"} | json | duration > 1000
{app="api"} | json | size < 1024

# 바이트 단위 비교
{app="api"} | json | body_size > 1MB

# 시간 단위 비교
{app="api"} | json | response_time > 2s

# 논리 조합
{app="api"} | json | level = "error" and status >= 500
{app="api"} | json | level = "error" or level = "warn"
{app="api"} | json | (status >= 400 and status < 500) or level = "error"
```

### Line Format Expressions 상세

Line Format은 Go 템플릿 문법으로 로그 라인의 출력 형태를 재구성한다.

```logql
# 기본 포맷 변경
{app="api"} | json | line_format "{{.level}} | {{.method}} {{.uri}} -> {{.status}}"

# 조건부 출력
{app="api"} | json | line_format "{{ if eq .level \"error\" }}[ERROR]{{ else }}[INFO]{{ end }} {{.message}}"

# 숫자 포맷
{app="api"} | json | line_format "Duration: {{ div .duration 1000 }}s"

# 기본값 설정 (값이 없을 때)
{app="api"} | json | line_format "User: {{ or .user_id \"anonymous\" }}"

# 여러 줄 포맷
{app="api"} | json | line_format "Method: {{.method}}\nURI: {{.uri}}\nStatus: {{.status}}"

# 정규식 치환 (Loki 2.9+)
{app="api"} | json | line_format "{{ regexReplaceAll \"password=\\\\S+\" .message \"password=***\" }}"
```

**사용 가능한 템플릿 함수:**
| 함수 | 설명 | 예시 |
|------|------|------|
| `ToUpper` | 대문자 변환 | `{{ ToUpper .level }}` |
| `ToLower` | 소문자 변환 | `{{ ToLower .method }}` |
| `Replace` | 문자열 치환 | `{{ Replace .message "old" "new" -1 }}` |
| `Trim` | 공백 제거 | `{{ Trim .value }}` |
| `TrimSpace` | 앞뒤 공백 제거 | `{{ TrimSpace .value }}` |
| `regexReplaceAll` | 정규식 치환 | `{{ regexReplaceAll "\\d+" .msg "N" }}` |
| `div` | 나눗셈 | `{{ div .duration 1000 }}` |
| `mod` | 나머지 | `{{ mod .count 10 }}` |
| `add` | 덧셈 | `{{ add .a .b }}` |
| `sub` | 뺄셈 | `{{ sub .a .b }}` |
| `mul` | 곱셈 | `{{ mul .a .b }}` |

### Unwrap Expressions 상세

Unwrap은 로그 본문에서 숫자 값을 추출하여 Metric Query에 사용할 수 있게 한다.

```logql
# 기본 unwrap: 필드를 숫자로 추출한다
{app="api"} | json | unwrap response_time

# duration() 변환: "2s", "500ms", "1m30s" 같은 문자열을 초 단위 숫자로 변환한다
{app="api"} | json | unwrap duration(response_time)

# bytes() 변환: "10KB", "1.5MB", "2GiB" 같은 문자열을 바이트 수로 변환한다
{app="api"} | json | unwrap bytes(body_size)

# unwrap 후 label filter (유효하지 않은 값 제거)
{app="api"} | json | unwrap response_time | response_time > 0

# unwrap과 Range Aggregation 조합
avg_over_time({app="api"} | json | unwrap response_time [5m])
quantile_over_time(0.99, {app="api"} | json | unwrap duration(latency) [5m])
```

**주의사항:**
- unwrap 대상 필드에 숫자가 아닌 값이 있으면 해당 로그 라인은 무시된다
- `__error__` 레이블로 파싱/변환 오류를 필터링할 수 있다: `| __error__ = ""`

### Range Aggregations 전체 레퍼런스

Range Aggregation은 지정된 시간 범위 내의 로그에 대해 집계를 수행한다.

**로그 라인 기반 (unwrap 불필요):**

| 함수 | 설명 | 예시 |
|------|------|------|
| `rate()` | 초당 로그 라인 수이다 | `rate({app="api"} [5m])` |
| `count_over_time()` | 시간 범위 내 총 로그 라인 수이다 | `count_over_time({app="api"} [1h])` |
| `bytes_over_time()` | 시간 범위 내 총 바이트 수이다 | `bytes_over_time({app="api"} [1h])` |
| `bytes_rate()` | 초당 바이트 수이다 | `bytes_rate({app="api"} [5m])` |
| `absent_over_time()` | 로그가 없으면 빈 벡터를 반환한다 | `absent_over_time({app="api"} [15m])` |

**숫자 값 기반 (unwrap 필요):**

| 함수 | 설명 | 예시 |
|------|------|------|
| `sum_over_time()` | 합계이다 | `sum_over_time({app="api"} \| json \| unwrap bytes [5m])` |
| `avg_over_time()` | 평균이다 | `avg_over_time({app="api"} \| json \| unwrap duration [5m])` |
| `min_over_time()` | 최솟값이다 | `min_over_time({app="api"} \| json \| unwrap duration [5m])` |
| `max_over_time()` | 최댓값이다 | `max_over_time({app="api"} \| json \| unwrap duration [5m])` |
| `stdvar_over_time()` | 분산이다 | `stdvar_over_time({app="api"} \| json \| unwrap duration [5m])` |
| `stddev_over_time()` | 표준편차이다 | `stddev_over_time({app="api"} \| json \| unwrap duration [5m])` |
| `quantile_over_time()` | 분위수이다 | `quantile_over_time(0.99, {app="api"} \| json \| unwrap duration [5m])` |
| `first_over_time()` | 첫 번째 값이다 | `first_over_time({app="api"} \| json \| unwrap value [1h])` |
| `last_over_time()` | 마지막 값이다 | `last_over_time({app="api"} \| json \| unwrap value [1h])` |

### Aggregation Operators 전체 레퍼런스

Aggregation Operator는 Range Aggregation의 결과를 레이블별로 그룹화하여 집계한다.

| 연산자 | 설명 | 예시 |
|--------|------|------|
| `sum` | 합계이다 | `sum by (namespace) (rate({app=~".+"} [5m]))` |
| `avg` | 평균이다 | `avg by (app) (rate({namespace="demo"} [5m]))` |
| `min` | 최솟값이다 | `min by (pod) (count_over_time({app="api"} [1h]))` |
| `max` | 최댓값이다 | `max by (pod) (count_over_time({app="api"} [1h]))` |
| `count` | 시계열 수이다 | `count by (level) (rate({app="api"} \|= "error" [5m]))` |
| `topk` | 상위 K개이다 | `topk(5, sum by (pod) (rate({namespace="demo"} [5m])))` |
| `bottomk` | 하위 K개이다 | `bottomk(3, sum by (pod) (rate({namespace="demo"} [5m])))` |
| `sort` | 오름차순 정렬이다 | `sort(sum by (pod) (rate({namespace="demo"} [5m])))` |
| `sort_desc` | 내림차순 정렬이다 | `sort_desc(sum by (pod) (rate({namespace="demo"} [5m])))` |

**by vs without:**
```logql
# by: 지정한 레이블로 그룹화한다
sum by (namespace, app) (rate({namespace=~".+"} [5m]))

# without: 지정한 레이블을 제외하고 그룹화한다
sum without (pod, container) (rate({namespace="demo"} [5m]))
```

### Binary Operations 상세

Binary Operation은 두 개의 쿼리 결과를 결합하는 연산이다.

**산술 연산자:**
```logql
# 에러율 계산 (%)
sum(rate({namespace="demo"} |= "error" [5m]))
/
sum(rate({namespace="demo"} [5m]))
* 100

# 두 시계열의 차이
sum(rate({app="api", level="error"} [5m]))
-
sum(rate({app="api", level="warn"} [5m]))
```

**논리 연산자:**
| 연산자 | 설명 |
|--------|------|
| `and` | 양쪽 모두에 존재하는 시계열만 반환한다 (교집합) |
| `or` | 양쪽 중 하나라도 존재하는 시계열을 반환한다 (합집합) |
| `unless` | 왼쪽에만 존재하고 오른쪽에 없는 시계열을 반환한다 (차집합) |

```logql
# 에러도 발생하고 경고도 발생하는 앱
sum by (app) (rate({namespace="demo"} |= "error" [5m]))
and
sum by (app) (rate({namespace="demo"} |= "warn" [5m]))

# 에러는 발생하지만 경고는 없는 앱
sum by (app) (rate({namespace="demo"} |= "error" [5m]))
unless
sum by (app) (rate({namespace="demo"} |= "warn" [5m]))
```

**비교 연산자 (필터링):**
```logql
# 에러율이 5% 이상인 네임스페이스만 반환
sum by (namespace) (rate({namespace=~".+"} |= "error" [5m]))
/
sum by (namespace) (rate({namespace=~".+"} [5m]))
* 100
> 5

# bool 수식어: 비교 결과를 0/1로 반환 (알림 규칙에 유용)
sum by (namespace) (rate({namespace=~".+"} |= "error" [5m])) > bool 10
```

### Subqueries

Subquery는 Range Aggregation 내에서 다른 Metric Query를 중첩하여 사용하는 기능이다 (Loki 2.9+).

```logql
# 5분 간격으로 계산된 에러율의 1시간 최댓값
max_over_time(
  sum by (namespace) (rate({namespace=~".+"} |= "error" [5m]))
[1h:5m])

# [1h:5m]의 의미:
# 1h = 전체 범위 (최근 1시간)
# 5m = 평가 간격 (5분마다 rate 계산)
```

### LogQL vs PromQL 비교

| 항목 | LogQL | PromQL |
|------|-------|--------|
| 대상 데이터 | 로그 (텍스트 + 메타데이터) | 메트릭 (숫자 시계열) |
| Selector 문법 | `{label="value"}` (동일) | `{label="value"}` (동일) |
| 필터링 | Line Filter (`\|=`, `!=`) | 없다 (메트릭은 필터링 불필요) |
| 파싱 | Parser (`\| json`, `\| logfmt`) | 없다 (메트릭은 이미 구조화됨) |
| Range Vector | `[5m]` (동일) | `[5m]` (동일) |
| 집계 함수 | `rate()`, `count_over_time()` | `rate()`, `increase()` |
| Aggregation | `sum`, `avg`, `topk` 등 (동일) | `sum`, `avg`, `topk` 등 (동일) |
| Unwrap | `unwrap` (로그에서 숫자 추출) | 불필요 (이미 숫자) |
| 결과 타입 | 로그 스트림 또는 숫자 시계열 | 항상 숫자 시계열 |
| Recording Rules | 지원 (Ruler) | 지원 (Prometheus) |
| Alerting Rules | 지원 (Ruler → Alertmanager) | 지원 (Prometheus → Alertmanager) |

**핵심 차이점:**
- LogQL의 Log Query는 텍스트 로그를 반환하고, Metric Query는 PromQL과 유사한 숫자 시계열을 반환한다
- LogQL은 Parser와 Line Filter가 추가되어 비구조화된 로그를 쿼리 시점에 구조화할 수 있다
- PromQL의 `increase()`에 해당하는 함수가 LogQL에는 없다. 대신 `count_over_time()`을 사용한다

---

## 멀티테넌시

### X-Scope-OrgID 헤더 기반 테넌트 분리

Loki는 `X-Scope-OrgID` HTTP 헤더를 통해 테넌트를 식별하고 데이터를 격리한다.

```
┌──────────────┐     X-Scope-OrgID: tenant-a     ┌──────────┐
│ Promtail     │──────────────────────────────────│          │
│ (tenant-a)   │                                  │          │
└──────────────┘                                  │          │
                                                  │   Loki   │
┌──────────────┐     X-Scope-OrgID: tenant-b     │          │
│ Promtail     │──────────────────────────────────│          │
│ (tenant-b)   │                                  │          │
└──────────────┘                                  │          │
                                                  │          │
┌──────────────┐     X-Scope-OrgID: tenant-c     │          │
│ Promtail     │──────────────────────────────────│          │
│ (tenant-c)   │                                  └──────────┘
└──────────────┘

각 테넌트의 데이터는 스토리지, 인덱스, 캐시에서 완전히 분리된다.
```

**설정:**
```yaml
# 멀티테넌시 활성화
auth_enabled: true                # true: 멀티테넌시 활성화, false: 단일 테넌트

# Promtail에서 테넌트 ID 설정
clients:
  - url: http://loki:3100/loki/api/v1/push
    tenant_id: tenant-a           # 고정 테넌트 ID

# 또는 Pipeline Stage에서 동적으로 설정
pipeline_stages:
  - tenant:
      source: namespace           # namespace 레이블 값을 테넌트 ID로 사용
```

**Grafana에서의 테넌트 선택:**
- Loki 데이터소스 설정에서 `X-Scope-OrgID` 헤더를 추가한다
- 여러 테넌트의 데이터를 동시에 조회하려면 파이프(`|`)로 구분한다: `tenant-a|tenant-b`
- `auth_enabled: false`일 때 테넌트 ID는 `fake`로 자동 설정된다

### 테넌트별 설정

각 테넌트에 대해 독립적인 제한과 정책을 설정할 수 있다. `runtime_config` 파일 또는 `limits_config`의 `per_tenant_override_config`로 관리한다.

```yaml
# runtime-config.yaml
overrides:
  tenant-a:
    ingestion_rate_mb: 20           # 초당 20MB까지 수집 허용
    ingestion_burst_size_mb: 40     # 순간 40MB 허용
    max_streams_per_user: 100000    # 최대 10만 스트림
    max_query_length: 721h          # 최대 쿼리 범위 30일
    max_query_parallelism: 64       # 쿼리 병렬도 64
    retention_period: 2160h         # Retention 90일

  tenant-b:
    ingestion_rate_mb: 5            # 초당 5MB
    ingestion_burst_size_mb: 10
    max_streams_per_user: 10000
    max_query_length: 168h          # 최대 쿼리 범위 7일
    max_query_parallelism: 16
    retention_period: 720h          # Retention 30일

  tenant-c:
    ingestion_rate_mb: 50           # 대용량 테넌트
    ingestion_burst_size_mb: 100
    max_streams_per_user: 500000
    max_query_length: 2160h
    retention_period: 8760h         # Retention 1년
```

### 테넌트 격리 보장

**쿼리 격리:**
- Querier는 쿼리 요청의 `X-Scope-OrgID` 헤더를 확인하고, 해당 테넌트의 데이터만 조회한다
- 테넌트 ID가 없거나 잘못된 요청은 거부된다
- Query Frontend의 공정 스케줄링이 테넌트 간 쿼리 리소스를 공평하게 분배한다

**스토리지 격리:**
- 인덱스와 Chunk는 테넌트 ID를 키의 일부로 포함하여 저장된다
- Object Storage에서 경로 구조: `<tenant-id>/chunks/<chunk-id>`, `<tenant-id>/index/<table-name>`
- 한 테넌트의 데이터가 다른 테넌트에게 노출되지 않는다

**캐시 격리:**
- 캐시 키에 테넌트 ID가 포함되어 있으므로, 서로 다른 테넌트의 캐시가 충돌하지 않는다
- 동일한 Memcached/Redis 인스턴스를 공유하더라도 데이터 격리가 보장된다

---

## Grafana에서의 Loki 활용

### Explore 뷰에서 로그 조회

Grafana의 Explore 뷰는 LogQL 쿼리를 대화형으로 작성하고 실행하는 인터페이스이다.

**기본 사용 흐름:**
1. Grafana 좌측 메뉴에서 Explore를 선택한다
2. 상단의 Data Source 드롭다운에서 Loki를 선택한다
3. Label Browser에서 레이블을 선택하거나, 직접 LogQL을 입력한다
4. 시간 범위를 설정하고 Run query를 클릭한다

**주요 기능:**
- **Label Browser**: 사용 가능한 레이블과 값을 트리 구조로 탐색할 수 있다
- **Query History**: 이전에 실행한 쿼리를 저장하고 재실행할 수 있다
- **Split View**: 화면을 분할하여 Prometheus 메트릭과 Loki 로그를 나란히 비교할 수 있다
- **Detected Fields**: 로그 라인을 클릭하면 자동으로 파싱된 필드를 확인할 수 있다
- **Show Context**: 로그 라인을 클릭하면 해당 라인의 전후 로그를 확인할 수 있다

### Dashboard에서 로그 패널

Grafana Dashboard에서 Loki 데이터를 시각화하는 패널 타입이다.

**Logs Panel:**
- LogQL Log Query의 결과를 로그 라인 목록으로 표시한다
- 레이블별 색상 구분, 검색, 필터링 기능을 제공한다
- `Deduplication` 옵션으로 중복 로그를 제거할 수 있다

**Table Panel:**
- LogQL Metric Query 결과를 테이블로 표시한다
- 예: `topk(10, sum by (pod) (count_over_time({namespace="demo"} |= "error" [1h])))`

**Time Series Panel:**
- LogQL Metric Query 결과를 시계열 그래프로 표시한다
- 예: `sum by (level) (rate({namespace="demo"} [5m]))`

**Bar Gauge / Stat Panel:**
- 단일 값을 시각화한다
- 예: `count_over_time({namespace="demo"} |= "error" [24h])`

### Derived Fields: 로그에서 TraceID 추출 및 Tempo 연동

Derived Fields는 로그 본문에서 정규식으로 값을 추출하여, 다른 데이터소스(예: Tempo)로 연결하는 링크를 생성하는 기능이다.

**설정 방법 (Grafana Data Source 설정):**
1. Grafana > Configuration > Data Sources > Loki
2. Derived Fields 섹션에서 Add를 클릭한다
3. 다음 정보를 입력한다:
   - **Name**: TraceID (표시 이름)
   - **Regex**: `"trace_id":"([a-f0-9]+)"` (로그에서 trace_id를 추출하는 정규식)
   - **URL / Query**: `${__value.raw}` (추출된 값을 링크 URL에 삽입)
   - **Internal link**: Tempo 데이터소스를 선택한다

```
로그 라인:
{"level":"error","message":"timeout","trace_id":"abc123def456","span_id":"789ghi"}
                                       ^^^^^^^^^^^^^^^^
                                       Derived Field로 추출

Grafana에서 이 로그 라인을 클릭하면:
  → Tempo 데이터소스에서 trace_id="abc123def456"인 트레이스를 자동 조회
  → 로그 → 트레이스 간 원클릭 전환 가능
```

이 기능은 Grafana의 관측 가능성 삼각형(Metrics → Logs → Traces)을 실현하는 핵심 요소이다.

### 로그 기반 알림 (Grafana Alerting)

Grafana Alerting에서 LogQL Metric Query를 사용하여 로그 기반 알림을 설정할 수 있다.

**알림 설정 흐름:**
1. Grafana > Alerting > Alert Rules > New alert rule
2. Query 섹션에서 Loki 데이터소스를 선택하고 LogQL Metric Query를 입력한다
3. Expressions 섹션에서 Threshold 조건을 설정한다
4. Evaluation 섹션에서 평가 주기와 지속 시간을 설정한다
5. Notification 섹션에서 알림 채널(Slack, Email, PagerDuty 등)을 연결한다

**실용적인 알림 규칙 예시:**
```logql
# 1. 5분 동안 에러 로그가 분당 10건 이상
sum(rate({namespace="production"} |= "error" [5m])) > 10

# 2. 에러율이 5% 초과
sum(rate({namespace="production"} |= "error" [5m]))
/
sum(rate({namespace="production"} [5m]))
* 100 > 5

# 3. 특정 서비스의 로그가 15분간 부재
absent_over_time({app="critical-service"}[15m])

# 4. 5xx 에러가 1분에 5건 이상
sum(rate({app="nginx"} | json | status >= 500 [1m])) > 5

# 5. 평균 응답 시간이 2초 초과
avg_over_time({app="api"} | json | unwrap duration(response_time) [5m]) > 2
```

### 로그 볼륨 히트맵

Grafana의 Explore 뷰에서 로그 볼륨 히트맵을 활성화하면, 시간대별 로그 발생 빈도를 시각적으로 파악할 수 있다.

- Explore 뷰 상단의 "Log volume" 토글을 활성화한다
- 히트맵은 시간(X축) × 레이블 값(Y축) × 로그 수(색상 강도)로 표현된다
- 특정 시간대에 로그가 급증한 패턴을 직관적으로 발견할 수 있다
- 히트맵의 특정 영역을 클릭하면 해당 시간 범위로 줌인된다

### Live Tail

Live Tail은 실시간으로 로그를 스트리밍하여 보여주는 기능이다.

- Grafana Explore에서 "Live" 버튼을 클릭하면 활성화된다
- WebSocket을 사용하여 Loki의 `/loki/api/v1/tail` 엔드포인트에 연결한다
- Stream Selector와 Line Filter를 적용할 수 있다
- 디버깅, 배포 모니터링 등 실시간 로그 확인이 필요한 상황에 유용하다

```bash
# CLI에서 Live Tail (logcli 도구 사용)
logcli query --tail '{namespace="demo"}' --addr=http://loki:3100

# curl로 Live Tail
curl -H "X-Scope-OrgID: fake" \
  "http://loki:3100/loki/api/v1/tail?query={namespace=\"demo\"}"
```

---

