# Loki - 로그 수집 및 저장

## 개념

### Loki란?
- Grafana Labs에서 개발한 수평 확장 가능한 고가용성 로그 수집 시스템이다 (CNCF Incubating, Apache 2.0 라이선스)
- "Prometheus for Logs"라고 불린다. 메트릭에서 Prometheus가 하는 역할을 로그 영역에서 수행한다
- 로그 본문을 Full-text 인덱싱하지 않고, 레이블(Label)만 인덱싱하여 저장 비용과 운영 복잡성을 대폭 줄인다
- Grafana와 네이티브로 통합되어 메트릭(Prometheus) → 로그(Loki) → 트레이스(Tempo) 간 원클릭 전환이 가능하다
- 로그 데이터를 S3, GCS 등 오브젝트 스토리지에 저장할 수 있어 장기 보관 비용이 매우 낮다

### ELK/EFK 스택과의 비교
| 항목 | Loki | Elasticsearch (ELK/EFK) |
|------|------|------------------------|
| 인덱싱 방식 | 레이블만 인덱싱한다 (메타데이터 기반) | 로그 본문 전체를 역인덱스(Inverted Index)로 인덱싱한다 |
| 저장 비용 | 로그 본문을 압축만 하므로 비용이 낮다 | Full-text 인덱스가 원본 데이터와 비슷한 크기를 차지하므로 비용이 높다 |
| 쿼리 속도 | 레이블로 스트림을 좁힌 후 grep 방식으로 검색하므로, 범위가 넓으면 느릴 수 있다 | 역인덱스 덕분에 임의의 키워드 검색이 빠르다 |
| 운영 복잡성 | 단일 바이너리로 실행 가능하며, 별도의 JVM 튜닝이 필요 없다 | JVM 힙, 샤드, 레플리카 등 튜닝 포인트가 많다 |
| 리소스 사용량 | Go 기반으로 메모리 사용량이 적다 | JVM 기반으로 메모리 사용량이 크다 (노드당 수 GB 이상) |
| 적합한 사용처 | Kubernetes 환경에서 Grafana 중심 관측 스택을 구축할 때 적합하다 | 로그 본문에 대한 복잡한 Full-text 검색이 핵심 요구사항일 때 적합하다 |

Loki가 저렴한 핵심 이유는 인덱스 크기에 있다. Elasticsearch는 모든 토큰을 인덱싱하므로 인덱스가 원본 로그의 50~100%에 달하지만, Loki는 레이블 조합만 인덱싱하므로 인덱스 크기가 로그 본문 대비 극히 작다.

### 핵심 개념
| 개념 | 설명 |
|------|------|
| Log Stream | 동일한 레이블 조합을 가진 로그의 시계열이다. `{namespace="demo", pod="nginx-abc"}` 하나가 하나의 스트림이다 |
| Label | 로그를 분류하는 키-값 쌍이다. Prometheus 레이블과 동일한 데이터 모델을 사용한다 |
| Chunk | 하나의 스트림에 속하는 로그 엔트리들을 압축하여 묶은 저장 단위이다. 기본적으로 gzip 또는 snappy로 압축된다 |
| LogQL | Loki 전용 쿼리 언어이다. PromQL의 문법을 기반으로 로그 필터링과 집계를 수행한다 |
| Promtail | 로그를 수집하여 Loki로 Push하는 에이전트이다. Kubernetes 환경에서는 DaemonSet으로 배포된다 |
| Tenant | 멀티테넌시 지원을 위한 로그 격리 단위이다. HTTP 헤더 `X-Scope-OrgID`로 테넌트를 구분한다 |

### 레이블 모범 사례

레이블 설계는 Loki 성능에 직접적인 영향을 미치는 가장 중요한 요소이다.

**정적 레이블(Static Labels) — 권장**
- `namespace`, `pod`, `container`, `node`, `app`, `env` 등 변하지 않는 메타데이터이다
- Kubernetes 환경에서 Promtail이 자동으로 붙여주는 레이블이 대부분 정적 레이블이다

**동적 레이블(Dynamic Labels) — 주의 필요**
- 로그 본문에서 파싱하여 추출한 값을 레이블로 사용하는 것이다 (예: `level`, `status_code`)
- `level`처럼 카디널리티가 낮은 값(debug, info, warn, error)은 동적 레이블로 사용해도 문제없다

**피해야 할 고카디널리티(High Cardinality) 레이블**
| 레이블 | 이유 |
|--------|------|
| `request_id`, `trace_id` | 요청마다 고유한 값이므로 스트림이 무한히 생성된다 |
| `user_id`, `ip_address` | 사용자 수만큼 스트림이 생성되어 Ingester 메모리를 소진한다 |
| `timestamp`, `message` | 로그마다 다른 값이므로 레이블로 부적합하다 |

고카디널리티 레이블이 존재하면 Ingester의 메모리 사용량이 급증하고, 인덱스 크기가 비대해져 Loki의 비용 이점이 사라진다. 이러한 값은 레이블 대신 로그 본문에 포함하고 LogQL의 parser expression으로 쿼리 시점에 추출하는 것이 올바른 패턴이다.

---

### 이 프로젝트에서의 실습 환경

이 프로젝트에서 Loki는 platform 클러스터의 `monitoring` 네임스페이스에 배포된다.

- 설치 스크립트: `scripts/install/07-install-monitoring.sh`
- Helm Chart: `loki-stack` (Loki + Promtail)
- Helm values: `manifests/loki-values.yaml`
- 영속성: 비활성화 (학습용 설정)
- Grafana에서 Loki 데이터소스로 연동되어 있다
- 실습 대상 클러스터: platform (`kubeconfig/platform.yaml`)

```bash
# platform 클러스터에서 Loki 확인
export KUBECONFIG=kubeconfig/platform.yaml
kubectl get pods -n monitoring -l app=loki
# Grafana (http://localhost:3000)에서 Explore → Loki 데이터소스 선택하여 조회
```

---

## 아키텍처

### 배포 모드(Deployment Modes)

Loki는 단일 바이너리에 모든 컴포넌트가 포함되어 있으며, 설정에 따라 세 가지 모드로 배포할 수 있다.

| 모드 | 설명 | 적합한 규모 |
|------|------|------------|
| **Monolithic** | 모든 컴포넌트가 하나의 프로세스에서 실행된다. `-target=all` 옵션이다 | 일 수백 GB 이하의 소규모 환경이다 |
| **Simple Scalable (SSD)** | Read, Write, Backend 세 경로로 분리한다. Helm 차트의 기본 모드이다 | 일 수 TB 규모의 중간 환경이다 |
| **Microservices** | 각 컴포넌트를 독립적인 서비스로 배포한다 | 일 수십 TB 이상의 대규모 환경이다 |

**Simple Scalable Mode의 세 경로:**
```
Write Path:  Distributor → Ingester → Storage
Read Path:   Query Frontend → Querier → Storage
Backend:     Compactor, Index Gateway, Ruler
```

### 핵심 컴포넌트
```
┌──────────────────────────────────────────────────────────────────┐
│                         Loki Cluster                            │
│                                                                  │
│  ┌─────────────┐    ┌──────────────┐    ┌──────────────────┐    │
│  │ Promtail    │───►│ Distributor  │───►│    Ingester      │    │
│  │ (DaemonSet) │    │              │    │                  │    │
│  └─────────────┘    │ • Hash Ring  │    │ • WAL (Write     │    │
│                     │ • Tenant     │    │   Ahead Log)     │    │
│                     │   Validation │    │ • Chunk Flushing │    │
│                     │ • Rate       │    │ • Handoff        │    │
│                     │   Limiting   │    │                  │    │
│                     └──────────────┘    └────────┬─────────┘    │
│                                                  │ flush        │
│                                         ┌────────▼─────────┐    │
│                                         │  Object Storage  │    │
│  ┌──────────────┐    ┌──────────────┐   │  (Chunks + Index)│    │
│  │Query Frontend│───►│   Querier    │──►│                  │    │
│  │              │    │              │   │  • S3 / GCS /    │    │
│  │ • Query      │    │ • Query Exec │   │    Filesystem    │    │
│  │   Splitting  │    │ • Chunk      │   └──────────────────┘    │
│  │ • Result     │    │   Dedup      │            │              │
│  │   Caching    │    └──────────────┘   ┌────────▼─────────┐    │
│  │ • Queue      │                       │    Compactor      │    │
│  └──────────────┘                       │ • Index Compaction│    │
│                                         │ • Retention       │    │
│         │                               └──────────────────┘    │
│  ┌──────▼───────┐                                               │
│  │   Grafana    │                                               │
│  │ (LogQL 쿼리)  │                                               │
│  └──────────────┘                                               │
└──────────────────────────────────────────────────────────────────┘
```

### 컴포넌트 상세

#### Distributor
- 클라이언트(Promtail 등)로부터 Push 요청을 수신하는 최초 진입점이다
- **Tenant Validation**: `X-Scope-OrgID` 헤더를 확인하고, 테넌트별 Rate Limit과 레이블 검증을 수행한다
- **Hash Ring**: Consistent Hashing을 사용하여 로그 스트림을 어떤 Ingester에 전달할지 결정한다. 동일한 레이블 조합의 로그는 항상 같은 Ingester로 라우팅된다
- **Replication Factor**: 기본값 3으로, 하나의 스트림을 여러 Ingester에 복제하여 가용성을 보장한다

#### Ingester
- Distributor로부터 수신한 로그를 메모리에 누적하고, 주기적으로 Chunk Store에 Flush하는 컴포넌트이다
- **WAL (Write Ahead Log)**: 메모리에 있는 데이터를 디스크에 미리 기록하여, Ingester가 비정상 종료되어도 데이터 유실을 방지한다
- **Chunk Flushing**: 메모리의 Chunk가 일정 크기(`chunk_target_size`, 기본 1.5MB) 또는 일정 시간(`chunk_idle_period`, 기본 30분)에 도달하면 Object Storage로 Flush한다
- **Handoff**: Ingester가 정상 종료(graceful shutdown)될 때, 자신이 보유한 In-memory Chunk를 다른 Ingester에 이관하여 데이터 유실을 방지한다

#### Querier
- LogQL 쿼리를 실행하는 컴포넌트이다
- Object Storage의 Chunk와 Ingester의 In-memory Chunk를 동시에 조회한다
- **Chunk Deduplication**: Replication Factor로 인해 중복 저장된 Chunk를 쿼리 시 자동으로 제거한다

#### Query Frontend
- Querier 앞에 위치하는 선택적(optional) 컴포넌트이다
- **Query Splitting**: 큰 시간 범위의 쿼리를 작은 구간으로 분할하여 병렬 실행한다 (예: 24시간 쿼리를 1시간 단위 24개로 분할)
- **Result Caching**: 동일한 쿼리 결과를 Memcached나 Redis에 캐싱한다
- **Queue**: 여러 Querier에 쿼리를 공정하게 분배하는 내부 큐를 관리한다. 테넌트별 공정 스케줄링(Fair Scheduling)을 지원한다

#### Compactor
- 백그라운드에서 실행되며, 인덱스를 최적화하고 보존 정책(Retention)을 적용하는 컴포넌트이다
- **Index Compaction**: 여러 작은 인덱스 파일을 하나로 병합하여 쿼리 성능을 향상시킨다
- **Retention**: 설정된 보존 기간이 지난 로그 데이터(Chunk + Index)를 삭제한다. 전역(global) 또는 테넌트/스트림별로 설정할 수 있다

### 스토리지 구조

Loki의 스토리지는 크게 **Index Storage**와 **Chunk Storage**로 나뉜다.

| 구분 | 역할 | 지원 백엔드 |
|------|------|-----------|
| **Index Storage** | 레이블 조합 → Chunk 위치를 매핑하는 인덱스이다 | BoltDB Shipper (deprecated), TSDB (권장) |
| **Chunk Storage** | 압축된 로그 본문을 저장한다 | Filesystem, Amazon S3, Google GCS, Azure Blob, MinIO 등 |

**TSDB vs BoltDB Shipper:**
- TSDB는 Loki 2.8+에서 도입된 새로운 인덱스 포맷이며, BoltDB Shipper보다 쿼리 성능과 Compaction 효율이 크게 향상되었다
- 신규 배포에서는 TSDB를 사용하는 것이 권장된다

**Schema Config 예시:**
```yaml
schema_config:
  configs:
    - from: "2024-01-01"        # 이 날짜부터 적용되는 스키마이다
      store: tsdb               # 인덱스 저장소: tsdb
      object_store: s3          # 청크 저장소: s3
      schema: v13               # 스키마 버전이다
      index:
        prefix: index_          # 인덱스 테이블 접두사이다
        period: 24h             # 인덱스 테이블 주기이다 (TSDB는 24h 고정)
```

`schema_config`의 `configs`는 배열이며, `from` 날짜를 기준으로 스키마를 변경할 수 있다. 이전 기간의 데이터는 이전 스키마로, 새 기간의 데이터는 새 스키마로 읽고 쓴다. 이 덕분에 무중단 마이그레이션이 가능하다.

---

## Promtail 심화

### Promtail 동작 방식
```
노드의 로그 파일
      │
      ▼
┌──────────────────┐
│     Promtail     │
│ ┌──────────────┐ │
│ │  Discovery   │ │  ← Kubernetes API로 Pod 목록을 발견한다
│ └──────┬───────┘ │
│ ┌──────▼───────┐ │
│ │    Tail      │ │  ← 로그 파일을 실시간으로 읽는다
│ └──────┬───────┘ │
│ ┌──────▼───────┐ │
│ │  Pipeline    │ │  ← 레이블 추출, 필터링, 변환 (다단계 처리)
│ │  Stages      │ │
│ └──────┬───────┘ │
│ ┌──────▼───────┐ │
│ │   Push       │ │  ← Loki /loki/api/v1/push 엔드포인트로 전송
│ └──────────────┘ │
│ ┌──────────────┐ │
│ │ Positions    │ │  ← 각 파일의 읽기 위치를 기록하여 재시작 시 중복 방지
│ │ File         │ │
│ └──────────────┘ │
└──────────────────┘

수집 경로:
├── /var/log/pods/*/*.log        (Pod 로그 — Kubernetes 표준 경로)
├── /var/log/containers/*.log    (컨테이너 로그 — 심볼릭 링크)
├── /var/log/journal             (systemd journal — kubelet, containerd 등)
└── /var/log/syslog              (시스템 로그)
```

### Positions File
- Promtail이 각 로그 파일에서 어디까지 읽었는지 오프셋을 기록하는 파일이다 (기본 경로: `/tmp/positions.yaml`)
- Promtail이 재시작되면 이 파일을 참조하여 마지막으로 읽은 위치부터 이어서 수집한다
- 이 파일이 손실되면 Promtail은 파일의 끝(tail)부터 읽기 시작하여 그 이전의 로그는 수집하지 못한다

### Journal Scraping
- systemd journal을 직접 읽어서 kubelet, containerd 등 시스템 서비스의 로그를 수집할 수 있다
- `journal` scrape config를 사용하며, `/var/log/journal` 또는 `/run/log/journal` 경로를 마운트해야 한다

### Pipeline Stages

Pipeline Stage는 Promtail이 로그 라인을 처리하는 단계이다. 여러 Stage를 순서대로 조합하여 사용한다.

| Stage | 설명 |
|-------|------|
| `docker` | Docker JSON 로그 포맷(`{"log":"...","stream":"...","time":"..."}`)을 파싱한다 |
| `cri` | CRI 로그 포맷(containerd, CRI-O)을 파싱한다 |
| `json` | 로그 라인을 JSON으로 파싱하고, 지정한 필드를 추출한다 |
| `regex` | 정규식으로 로그 라인에서 Named Group을 추출한다 |
| `template` | Go 템플릿 문법으로 추출된 값을 변환한다 |
| `labels` | 추출된 값을 Loki 레이블로 설정한다 |
| `metrics` | 로그 라인에서 Prometheus 메트릭을 생성한다 (Counter, Gauge, Histogram) |
| `tenant` | 추출된 값을 기반으로 `X-Scope-OrgID`(테넌트 ID)를 동적으로 설정한다 |
| `output` | 로그 라인의 내용을 변경한다 (기본: 원본 로그 라인 그대로) |
| `timestamp` | 로그 라인에서 타임스탬프를 추출하여 로그의 시간을 설정한다 |
| `multiline` | 여러 줄에 걸친 로그(예: Java Stack Trace)를 하나의 엔트리로 합친다 |
| `drop` | 조건에 맞는 로그 라인을 버린다 (비용 절감에 유용) |

**Pipeline 구성 예시:**
```yaml
pipeline_stages:
  # 1단계: CRI 포맷 파싱
  - cri: {}

  # 2단계: JSON 본문 파싱
  - json:
      expressions:
        level: level
        msg: message
        duration: duration
        status: status_code

  # 3단계: 낮은 카디널리티 값만 레이블로 설정
  - labels:
      level:          # debug, info, warn, error 정도의 카디널리티

  # 4단계: debug 레벨 로그를 버려서 저장 비용 절감
  - drop:
      source: level
      value: "debug"

  # 5단계: 타임스탬프 설정
  - timestamp:
      source: timestamp
      format: RFC3339Nano

  # 6단계: 메트릭 생성 (Promtail 자체의 /metrics에 노출)
  - metrics:
      log_lines_total:
        type: Counter
        description: "Total log lines processed"
        source: level
        config:
          action: inc
```

---

## LogQL 심화

### 쿼리 구조

LogQL 쿼리는 크게 **Log Query**와 **Metric Query** 두 가지로 나뉜다.

```
Log Query:    {stream selector} | line filters | parser | label filter | line format
Metric Query: aggregation( {stream selector} | ... [range] )
```

### Log Stream Selector
- 중괄호 `{}` 안에 레이블 매처를 사용하여 대상 스트림을 선택한다
- 최소 하나의 레이블 매처가 필요하다

| 연산자 | 설명 | 예시 |
|--------|------|------|
| `=` | 정확히 일치한다 | `{namespace="demo"}` |
| `!=` | 일치하지 않는다 | `{namespace!="kube-system"}` |
| `=~` | 정규식 일치한다 | `{pod=~"nginx-.*"}` |
| `!~` | 정규식 불일치한다 | `{container!~"istio-.*"}` |

### Line Filter Expression
- 로그 본문을 텍스트나 정규식으로 필터링한다
- 파이프 `|` 뒤에 위치한다

| 연산자 | 설명 | 예시 |
|--------|------|------|
| `\|=` | 문자열을 포함한다 | `{app="nginx"} \|= "GET"` |
| `!=` | 문자열을 포함하지 않는다 | `{app="nginx"} != "healthcheck"` |
| `\|~` | 정규식에 매칭된다 | `{app="nginx"} \|~ "status=(4\|5)\\d{2}"` |
| `!~` | 정규식에 매칭되지 않는다 | `{app="nginx"} !~ "debug\|trace"` |

여러 Line Filter를 체이닝할 수 있다:
```logql
{namespace="demo"} |= "error" != "healthcheck" |~ "timeout|connection refused"
```

### Parser Expression
- 로그 본문에서 구조화된 데이터를 추출하여 임시 레이블을 생성한다
- 추출된 레이블은 이후 Label Filter나 Line Format에서 사용할 수 있다

| 파서 | 설명 | 예시 |
|------|------|------|
| `json` | JSON 로그를 파싱한다. 키가 자동으로 레이블이 된다 | `\| json` |
| `logfmt` | `key=value` 형식의 로그를 파싱한다 | `\| logfmt` |
| `pattern` | 패턴 문법으로 추출한다. `<name>`이 캡처 그룹이다 | `\| pattern "<ip> - - [<_>] \\"<method> <uri> <_>\\" <status>"` |
| `regexp` | 정규식 Named Group으로 추출한다 | `\| regexp "status=(?P<status>\\d+)"` |
| `unpack` | Promtail의 pack stage로 패킹된 로그를 언패킹한다 | `\| unpack` |

**json 파서 심화:**
```logql
# 전체 JSON 키를 자동 추출한다
{app="api"} | json

# 특정 키만 추출한다 (성능이 더 좋다)
{app="api"} | json level, method, status

# 중첩 JSON의 경우 경로를 지정한다
{app="api"} | json first_name="user.name.first"
```

**pattern 파서 예시:**
```logql
# Apache/Nginx 액세스 로그 파싱
{app="nginx"} | pattern "<ip> - <user> [<_>] \"<method> <uri> <_>\" <status> <size>"
              | status >= 400
```

### Label Filter Expression
- Parser로 추출된 레이블에 조건을 적용하여 필터링한다

```logql
# 문자열 비교
{app="api"} | json | level="error"

# 숫자 비교 (>, >=, <, <=, ==)
{app="api"} | json | status >= 400

# IP 비교
{app="api"} | json | ip="192.168.1.1"

# 논리 조합 (and, or)
{app="api"} | json | level="error" and status >= 500
{app="api"} | json | level="error" or level="warn"
```

### Line Format Expression
- 로그 라인의 출력 형태를 Go 템플릿으로 재구성한다

```logql
# 로그 라인을 재포맷한다
{app="api"} | json | line_format "{{.level}} | {{.method}} {{.uri}} → {{.status}} ({{.duration}}ms)"

# 조건부 포맷
{app="api"} | json | line_format "{{if eq .level \"error\"}}🔴{{else}}🟢{{end}} {{.message}}"
```

### Unwrap Expression
- 로그 본문에서 숫자 값을 추출하여 Metric Query에 사용할 수 있게 한다

```logql
# JSON 로그에서 response_time 필드를 숫자로 추출한다
{app="api"} | json | unwrap response_time

# 바이트 단위 변환 (bytes() 함수로 "10KB" 같은 문자열을 바이트 수로 변환)
{app="api"} | json | unwrap bytes(body_size)

# 시간 단위 변환 (duration() 함수로 "2s", "500ms" 같은 문자열을 초 단위로 변환)
{app="api"} | json | unwrap duration(response_time)
```

### Metric Query

Log Query 결과에 집계 함수를 적용하여 숫자 결과(시계열)를 생성한다. Grafana 대시보드와 Alert Rule에서 주로 사용된다.

**범위 집계 함수 (Range Aggregations):**

| 함수 | 설명 |
|------|------|
| `count_over_time(log query [range])` | 지정 시간 범위 내 로그 라인 수를 센다 |
| `rate(log query [range])` | 초당 로그 라인 수를 계산한다 (count_over_time / range_seconds) |
| `bytes_over_time(log query [range])` | 지정 시간 범위 내 로그의 총 바이트 수이다 |
| `bytes_rate(log query [range])` | 초당 로그 바이트 수를 계산한다 |
| `absent_over_time(log query [range])` | 지정 시간 범위 내 로그가 없으면 빈 벡터를 반환한다 (알림에 유용) |

**Unwrap 범위 집계 함수:**

| 함수 | 설명 |
|------|------|
| `sum_over_time(unwrap query [range])` | 추출된 숫자 값의 합계이다 |
| `avg_over_time(unwrap query [range])` | 추출된 숫자 값의 평균이다 |
| `min_over_time(unwrap query [range])` | 추출된 숫자 값의 최솟값이다 |
| `max_over_time(unwrap query [range])` | 추출된 숫자 값의 최댓값이다 |
| `quantile_over_time(scalar, unwrap query [range])` | 추출된 숫자 값의 분위수이다 |
| `stddev_over_time(unwrap query [range])` | 추출된 숫자 값의 표준편차이다 |
| `first_over_time(unwrap query [range])` | 시간 범위 내 첫 번째 값이다 |
| `last_over_time(unwrap query [range])` | 시간 범위 내 마지막 값이다 |

**집계 연산자 (Aggregation Operators):**

`sum`, `avg`, `min`, `max`, `count`, `stddev`, `stdvar`, `topk`, `bottomk`를 사용할 수 있으며, `by` 또는 `without` 절로 그룹핑한다.

```logql
# 네임스페이스별 초당 에러 로그 수
sum by (namespace) (rate({namespace=~".+"} |= "error" [5m]))

# 상위 5개 에러 발생 Pod
topk(5, sum by (pod) (count_over_time({namespace="demo"} |= "error" [1h])))

# 평균 응답 시간 (p50, p90, p99)
quantile_over_time(0.99, {app="api"} | json | unwrap response_time [5m]) by (endpoint)
```

---

## Loki 아키텍처 심화

### 컴포넌트 전체 상세

Loki의 모든 컴포넌트는 단일 바이너리 안에 포함되어 있으며, `-target` 플래그로 어떤 컴포넌트를 활성화할지 결정한다. Microservices 모드에서는 각 컴포넌트를 개별 프로세스로 실행하여 독립적으로 스케일링할 수 있다.

#### Distributor 심화

Distributor는 클라이언트(Promtail, Grafana Agent, Fluentd 등)로부터 HTTP POST 요청(`/loki/api/v1/push`)을 수신하는 Write Path의 최초 진입점이다.

**Hash Ring:**
- Consistent Hashing 알고리즘을 사용하여 로그 스트림을 특정 Ingester에 매핑한다
- 해시 키는 테넌트 ID + 레이블 조합의 해시값이다. 동일한 레이블 조합의 로그는 항상 동일한 Ingester 집합으로 라우팅된다
- Ring의 상태 관리 백엔드: `memberlist` (gossip 기반, 권장), `consul`, `etcd`
- Ring 상태는 `/ring` 엔드포인트에서 확인할 수 있다

```
Hash Ring 동작 원리:

  Stream {app="nginx", env="prod"}
       │
       ▼
  hash(tenant_id + labels) = 0xA3F2...
       │
       ▼
  ┌─────────────────────────────────────────────┐
  │              Hash Ring                       │
  │                                              │
  │   Ingester-0 ──── Ingester-1 ──── Ingester-2│
  │   [0x0000~0x5555] [0x5556~0xAAAA] [0xAAAB~] │
  │                                              │
  │   0xA3F2 → Ingester-1 (primary)              │
  │          → Ingester-2 (replica 1)            │
  │          → Ingester-0 (replica 2)            │
  └─────────────────────────────────────────────┘

  Replication Factor=3이면, 해시 링에서 시계 방향으로
  연속된 3개의 Ingester에 동일한 스트림을 복제한다.
```

**테넌트 검증:**
- `X-Scope-OrgID` HTTP 헤더에서 테넌트 ID를 추출한다
- `auth_enabled: false`일 경우 테넌트 ID는 `fake`로 고정된다
- 테넌트별로 설정된 Rate Limit, 최대 레이블 수, 최대 레이블 이름/값 길이 등을 검증한다
- 검증 실패 시 HTTP 429 (Too Many Requests) 또는 400 (Bad Request)를 반환한다

**Rate Limiting:**
- `ingestion_rate_mb`: 테넌트별 초당 최대 수집량 (MB/s)이다. 기본값은 4MB/s이다
- `ingestion_burst_size_mb`: 순간 최대 허용량 (MB)이다. 기본값은 6MB이다
- `max_streams_per_user`: 테넌트별 최대 활성 스트림 수이다. 기본값은 10,000이다
- `max_line_size`: 단일 로그 라인의 최대 크기이다. 기본값은 256KB이다
- `max_label_names_per_series`: 스트림당 최대 레이블 수이다. 기본값은 15이다

```yaml
# 테넌트별 Rate Limit 설정 예시
limits_config:
  ingestion_rate_mb: 10          # 초당 10MB까지 수집을 허용한다
  ingestion_burst_size_mb: 20    # 순간 20MB까지 허용한다
  max_streams_per_user: 50000    # 최대 활성 스트림 50,000개이다
  max_line_size: 512KB           # 단일 라인 최대 512KB이다
  max_label_names_per_series: 30 # 스트림당 최대 레이블 30개이다
  max_label_name_length: 1024    # 레이블 이름 최대 1024자이다
  max_label_value_length: 2048   # 레이블 값 최대 2048자이다
```

**Replication Factor:**
- `replication_factor` 설정으로 제어하며, 기본값은 3이다
- 하나의 스트림을 N개의 Ingester에 동시에 기록하여 데이터 유실을 방지한다
- 쿼리 시 Querier가 중복 제거(deduplication)를 수행하므로 중복 결과가 반환되지 않는다
- Quorum 기반으로 동작한다: 쓰기 성공 조건은 `floor(N/2) + 1`개의 Ingester에 성공적으로 기록되는 것이다

#### Ingester 심화

Ingester는 수신된 로그를 메모리에 버퍼링하고 주기적으로 장기 스토리지(Object Storage)에 Flush하는 컴포넌트이다.

**WAL (Write-Ahead Log):**
- Ingester가 수신한 로그를 메모리에 기록하기 전에 디스크의 WAL 파일에 먼저 기록하는 메커니즘이다
- Ingester가 비정상 종료(crash, OOM kill 등)되어도 WAL에서 데이터를 복구할 수 있다
- WAL 없이는 메모리에만 존재하는 미플러시(unflushed) 데이터가 유실된다
- WAL은 Loki 2.0+에서 사용 가능하며, 프로덕션 환경에서는 반드시 활성화해야 한다

```yaml
# WAL 설정 예시
ingester:
  wal:
    enabled: true
    dir: /loki/wal               # WAL 파일 저장 경로이다
    flush_on_shutdown: true       # 정상 종료 시 WAL을 Flush한다
    replay_memory_ceiling: 4GB   # WAL 복구 시 최대 메모리 사용량이다
```

**WAL 복구 과정:**
```
Ingester 비정상 종료
       │
       ▼
Ingester 재시작
       │
       ▼
WAL 디렉토리 스캔 → 미플러시 세그먼트 발견
       │
       ▼
WAL 세그먼트를 순서대로 리플레이
       │
       ▼
메모리에 Chunk 재구성
       │
       ▼
정상 동작 시작 (Hash Ring에 재합류)
```

**Chunk 포맷 및 압축:**

Chunk는 하나의 로그 스트림에 속하는 로그 엔트리들을 묶어 압축한 저장 단위이다. 압축 알고리즘에 따라 CPU 사용량과 압축률이 달라진다.

| 압축 알고리즘 | 압축률 | 압축 속도 | 해제 속도 | 적합한 사용처 |
|-------------|--------|---------|---------|------------|
| `gzip` | 높다 (최고) | 느리다 | 보통이다 | 저장 비용이 중요한 환경이다 |
| `snappy` | 보통이다 | 빠르다 (최고) | 빠르다 (최고) | 쿼리 성능이 중요한 환경이다 |
| `lz4` | 보통이다 | 빠르다 | 빠르다 | snappy와 유사하며, 약간 더 높은 압축률이다 |
| `flate` | 높다 | 느리다 | 보통이다 | gzip과 유사한 특성이다 |
| `zstd` | 높다 | 보통이다 | 빠르다 | 압축률과 속도의 균형이 좋다 (Loki 2.9+) |
| `none` | 없다 | N/A | N/A | 디버깅 용도로만 사용한다 |

```yaml
# Chunk 압축 설정
ingester:
  chunk_encoding: snappy         # 압축 알고리즘 (gzip, snappy, lz4, flate, zstd, none)
```

**Flush 조건:**

Ingester는 다음 세 가지 조건 중 하나라도 충족되면 메모리의 Chunk를 Object Storage로 Flush한다.

| 조건 | 설정 키 | 기본값 | 설명 |
|------|--------|--------|------|
| 크기 | `chunk_target_size` | 1572864 (1.5MB) | Chunk의 압축 후 크기가 이 값에 도달하면 Flush한다 |
| 시간 | `max_chunk_age` | 2h | Chunk가 생성된 후 이 시간이 지나면 강제로 Flush한다 |
| 유휴 | `chunk_idle_period` | 30m | Chunk에 새로운 로그가 이 시간 동안 추가되지 않으면 Flush한다 |

```yaml
# Flush 조건 설정
ingester:
  chunk_target_size: 1572864     # 1.5MB
  max_chunk_age: 2h              # 최대 2시간
  chunk_idle_period: 30m         # 30분간 유휴 시 Flush
  chunk_retain_period: 0s        # Flush 후 메모리에 유지하는 시간 (Querier 캐시용)
  flush_check_period: 30s        # Flush 조건 확인 주기이다
  flush_op_timeout: 10m          # Flush 작업 타임아웃이다
```

**Handoff:**
- Ingester가 정상 종료(graceful shutdown)될 때 자신이 보유한 In-memory Chunk를 다른 Ingester에 이관하는 과정이다
- Hash Ring에서 자신을 LEAVING 상태로 전환하고, 링의 다음 노드에 Chunk를 전송한다
- Handoff가 완료되면 Ingester는 Ring에서 완전히 제거된다
- WAL이 활성화된 환경에서는 Handoff 대신 WAL 리플레이로 복구하는 방식이 더 일반적이다

```
Ingester Graceful Shutdown 과정:

1. SIGTERM 수신
2. Ring 상태를 LEAVING으로 변경
3. 새로운 쓰기 요청 수신 중단
4. In-memory Chunk를 Ring의 다음 노드로 전송 (Handoff)
   또는 Object Storage로 직접 Flush
5. Ring에서 자신을 제거
6. 프로세스 종료
```

#### Querier 심화

Querier는 LogQL 쿼리를 실행하는 컴포넌트이다.

**Query 실행 계획:**
```
LogQL 쿼리 수신
       │
       ▼
Stream Selector 평가 → Index Store에서 매칭되는 Chunk 목록 조회
       │
       ▼
Chunk 로드 (Object Storage + Ingester의 In-memory Chunk)
       │
       ▼
Line Filter 적용 → 로그 라인 필터링
       │
       ▼
Parser Expression 적용 → 구조화된 데이터 추출
       │
       ▼
Label Filter 적용 → 추출된 레이블로 필터링
       │
       ▼
Line Format 적용 → 출력 형태 변환
       │
       ▼
(Metric Query인 경우) Range Aggregation / Aggregation Operator 적용
       │
       ▼
결과 반환
```

**Chunk 캐시:**
- 한 번 Object Storage에서 로드한 Chunk를 메모리(또는 Memcached/Redis)에 캐싱하여 재조회 시 성능을 향상시킨다
- `chunk_store_config.chunk_cache_config`에서 설정한다

**Index 캐시:**
- Index Store(TSDB, BoltDB Shipper)의 인덱스 조회 결과를 캐싱한다
- 동일한 레이블 조합의 쿼리가 반복될 때 인덱스 조회를 건너뛸 수 있다
- `storage_config.index_queries_cache_config`에서 설정한다

**중복 제거 (Deduplication):**
- Replication Factor로 인해 동일한 로그가 여러 Ingester에 복제되어 있으므로, 쿼리 결과에서 중복을 제거해야 한다
- Querier는 타임스탬프 + 로그 라인 내용을 기준으로 중복을 판별한다
- `query_ingesters_within` 설정으로 Ingester를 조회하는 시간 범위를 제한할 수 있다 (기본값: 3h)

#### Query Frontend 심화

Query Frontend는 Querier 앞에 위치하여 쿼리 성능을 최적화하는 컴포넌트이다. 선택적이지만 프로덕션 환경에서는 필수적이다.

**Query Splitting (시간 범위 분할):**
- 넓은 시간 범위의 쿼리를 작은 구간으로 분할하여 병렬 실행한다
- `split_queries_by_interval` 설정으로 분할 단위를 지정한다 (기본값: 30m)
- 예: 24시간 쿼리를 30분 단위로 분할하면 48개의 하위 쿼리가 생성되고, 이를 여러 Querier에서 병렬 실행한다

```
24시간 쿼리 → Query Frontend

Query Frontend가 30분 단위로 분할:
├── 00:00~00:30 → Querier-0
├── 00:30~01:00 → Querier-1
├── 01:00~01:30 → Querier-2
├── 01:30~02:00 → Querier-0
├── ...
└── 23:30~24:00 → Querier-1

각 Querier의 결과를 병합하여 최종 결과를 반환한다.
```

**Caching (Results Cache):**
- 쿼리 결과를 캐싱하여 동일한 쿼리가 반복될 때 즉시 결과를 반환한다
- 캐시 백엔드: Memcached, Redis, In-memory (embedded)
- 캐시 키는 쿼리 문자열 + 시간 범위의 해시이다
- 분할된 하위 쿼리 단위로 캐싱되므로, 시간 범위가 일부 겹치는 쿼리도 캐시 히트율이 높다

```yaml
# Query Frontend 캐시 설정 예시
query_range:
  results_cache:
    cache:
      embedded_cache:
        enabled: true
        max_size_mb: 500         # 내장 캐시 최대 크기이다
        ttl: 24h                 # 캐시 유효 기간이다
      # 또는 Memcached 사용
      # memcached_client:
      #   addresses: memcached:11211
      #   timeout: 500ms
```

**Queue (공정 스케줄링):**
- Query Frontend는 내부에 FIFO 큐를 유지하며, 여러 Querier에 쿼리를 분배한다
- 테넌트별 공정 스케줄링(Fair Scheduling)을 지원하여, 한 테넌트가 대량의 쿼리를 실행해도 다른 테넌트의 쿼리가 밀리지 않는다
- `max_outstanding_per_tenant`: 테넌트별 큐에 대기할 수 있는 최대 쿼리 수이다 (기본값: 2048)

**Parallelism:**
- `parallelise_shardable_queries`: 분할 가능한 쿼리를 여러 Querier에서 병렬 실행하는 기능이다 (기본값: true)
- `max_query_parallelism`: 단일 쿼리의 최대 병렬도이다 (기본값: 32)

#### Query Scheduler 심화

Query Scheduler는 Query Frontend와 Querier 사이에 위치하는 선택적 중재자 컴포넌트이다.

- Query Frontend가 쿼리를 Query Scheduler의 큐에 등록하면, Querier가 이 큐에서 쿼리를 가져가서 실행한다
- Query Frontend와 Querier 사이의 직접적인 결합을 제거하여 독립적인 스케일링을 가능하게 한다
- 대규모 환경에서 Query Frontend를 여러 인스턴스로 확장할 때 필수적이다
- Ring 기반으로 여러 Query Scheduler 인스턴스가 부하를 분산한다

```
Query Scheduler가 없는 경우:
  Query Frontend ──직접 연결──→ Querier

Query Scheduler가 있는 경우:
  Query Frontend ──→ Query Scheduler ←── Querier
                     (큐 관리)          (폴링)
```

#### Compactor 심화

Compactor는 백그라운드에서 실행되며, 인덱스 최적화와 Retention 적용을 담당하는 컴포넌트이다.

**Index Compaction:**
- BoltDB Shipper 또는 TSDB에서 생성된 작은 인덱스 파일들을 하나의 큰 파일로 병합한다
- Compaction은 인덱스 조회 시 열어야 하는 파일 수를 줄여 쿼리 성능을 향상시킨다
- `compaction_interval`: Compaction 실행 주기이다 (기본값: 10m)

**Retention 적용:**
- 설정된 보존 기간이 지난 데이터를 삭제하는 역할이다
- Compactor가 유일한 Retention 적용 주체이다. Compactor 없이는 Retention이 동작하지 않는다
- 전역(global) Retention과 테넌트/스트림별 Retention을 모두 지원한다

```yaml
# Compactor 및 Retention 설정 예시
compactor:
  working_directory: /loki/compactor
  shared_store: s3
  compaction_interval: 10m
  retention_enabled: true         # Retention 활성화
  retention_delete_delay: 2h      # 삭제 대상으로 마크된 후 실제 삭제까지 대기 시간
  retention_delete_worker_count: 150  # 삭제 작업 병렬도

limits_config:
  retention_period: 720h          # 전역 Retention: 30일
  # 테넌트별 Retention은 runtime config에서 설정
```

**마크된 청크 삭제:**
- Retention 대상이 되는 Chunk를 즉시 삭제하지 않고, 먼저 "삭제 예정(marked for deletion)"으로 마크한다
- `retention_delete_delay` 이후에 실제로 삭제한다. 이 지연은 실수로 인한 데이터 손실을 방지하기 위한 안전 장치이다

#### Ruler 심화

Ruler는 LogQL 기반의 알림 규칙(Alerting Rules)과 기록 규칙(Recording Rules)을 주기적으로 평가하는 컴포넌트이다.

- Prometheus의 Alerting Rules와 동일한 YAML 형식을 사용한다
- 평가 결과를 Alertmanager에 전송하여 알림을 트리거할 수 있다
- Recording Rules로 LogQL Metric Query 결과를 Prometheus 호환 Remote Write로 전송할 수 있다

```yaml
# Ruler 설정 예시
ruler:
  storage:
    type: local
    local:
      directory: /loki/rules      # 규칙 파일 저장 경로이다
  rule_path: /loki/rules-temp     # 규칙 임시 경로이다
  alertmanager_url: http://alertmanager:9093
  ring:
    kvstore:
      store: memberlist
  enable_api: true                # API를 통한 규칙 관리를 활성화한다
```

```yaml
# 알림 규칙 예시: /loki/rules/fake/rules.yaml
groups:
  - name: loki-alerting-rules
    rules:
      # 5분 동안 에러 로그가 분당 10건 이상이면 알림
      - alert: HighErrorRate
        expr: |
          sum(rate({namespace="production"} |= "error" [5m])) > 10
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "에러율이 높다"
          description: "production 네임스페이스에서 에러 로그가 분당 {{ $value }}건 발생하고 있다"

      # 15분 동안 로그가 전혀 없으면 알림
      - alert: NoLogsFromService
        expr: |
          absent_over_time({app="critical-service"}[15m])
        for: 0m
        labels:
          severity: warning
        annotations:
          summary: "critical-service에서 로그가 수집되지 않고 있다"
```

#### Index Gateway 심화

Index Gateway는 인덱스 조회 전용 컴포넌트이다.

- Querier가 인덱스를 직접 조회하는 대신, Index Gateway를 통해 조회할 수 있다
- BoltDB Shipper 사용 시, 각 Querier가 인덱스 파일을 로컬에 다운로드하는 대신 Index Gateway가 중앙에서 인덱스를 관리한다
- Querier의 디스크 사용량과 인덱스 다운로드 트래픽을 줄일 수 있다
- TSDB 사용 시에도 Index Gateway를 활용할 수 있지만, TSDB 자체의 효율성이 높아 BoltDB Shipper만큼 극적인 효과는 아니다

```yaml
# Index Gateway 설정
storage_config:
  tsdb_shipper:
    index_gateway_client:
      server_address: index-gateway:9095
```

### Read Path vs Write Path

Loki의 데이터 흐름은 크게 Write Path(쓰기 경로)와 Read Path(읽기 경로)로 나뉜다.

```
┌─────────────────────────────────────────────────────────────────────┐
│                        WRITE PATH                                   │
│                                                                     │
│  Promtail ──HTTP POST──→ Distributor ──gRPC──→ Ingester            │
│  (Agent)                  │                      │                  │
│                           │ • 테넌트 검증          │ • WAL 기록       │
│                           │ • Rate Limit 확인     │ • 메모리 버퍼링    │
│                           │ • Hash Ring 조회      │ • Chunk 생성     │
│                           │ • Replication         │                  │
│                                                   │ Flush            │
│                                                   ▼                  │
│                                            Object Storage           │
│                                            (S3, GCS, FS)            │
│                                            │ Chunks │ Index │       │
│                                                   ▲                  │
│                                                   │ Compaction       │
│                                              Compactor              │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                        READ PATH                                    │
│                                                                     │
│  Grafana ──LogQL──→ Query Frontend ──gRPC──→ Querier               │
│  (Client)            │                        │                     │
│                      │ • Query 분할            │ • Index 조회        │
│                      │ • 결과 캐싱             │ • Chunk 로드        │
│                      │ • 공정 스케줄링          │ • Filter 적용       │
│                      │ • 병렬 실행             │ • 중복 제거          │
│                                               │                     │
│                                               ├──→ Object Storage   │
│                                               └──→ Ingester         │
│                                                    (In-memory)      │
└─────────────────────────────────────────────────────────────────────┘
```

**Write Path 상세 흐름:**
1. 클라이언트(Promtail)가 `/loki/api/v1/push`로 로그를 전송한다
2. Distributor가 요청을 수신하고, 테넌트 ID를 확인하고 Rate Limit을 검증한다
3. Distributor가 Hash Ring을 조회하여 대상 Ingester를 결정한다
4. Distributor가 Replication Factor에 따라 여러 Ingester에 gRPC로 로그를 전송한다
5. Ingester가 WAL에 기록하고, 메모리의 Chunk에 로그를 추가한다
6. Flush 조건이 충족되면 Chunk를 Object Storage에 저장하고, 인덱스를 업데이트한다

**Read Path 상세 흐름:**
1. 클라이언트(Grafana)가 LogQL 쿼리를 Query Frontend에 전송한다
2. Query Frontend가 쿼리를 시간 범위별로 분할하고, 캐시를 확인한다
3. 캐시 미스인 하위 쿼리를 Querier에 분배한다
4. Querier가 Index Store에서 매칭되는 Chunk 목록을 조회한다
5. Querier가 Object Storage와 Ingester의 In-memory Chunk에서 데이터를 로드한다
6. 필터링, 파싱, 집계를 수행하고 결과를 Query Frontend에 반환한다
7. Query Frontend가 하위 쿼리 결과를 병합하고, 캐시에 저장하고, 최종 결과를 반환한다

### 컴포넌트 간 통신

**gRPC:**
- Distributor → Ingester, Query Frontend → Querier, Querier → Ingester 간의 내부 통신은 모두 gRPC를 사용한다
- gRPC는 HTTP/2 기반으로 멀티플렉싱과 스트리밍을 지원하므로, 대량의 데이터를 효율적으로 전송할 수 있다
- `grpc_server_max_recv_msg_size`, `grpc_server_max_send_msg_size`로 최대 메시지 크기를 설정한다

**memberlist:**
- Hash Ring 상태를 관리하기 위한 Gossip 프로토콜 기반 클러스터링 메커니즘이다
- 별도의 외부 KV Store(Consul, etcd) 없이 컴포넌트들이 서로의 상태를 교환한다
- `memberlist.join_members`에 다른 멤버의 주소를 지정하거나, Kubernetes 환경에서는 Headless Service를 사용한다

```yaml
# memberlist 설정 예시
memberlist:
  join_members:
    - loki-memberlist:7946        # Headless Service DNS
  dead_node_reclaim_time: 30s
  gossip_to_dead_nodes_time: 15s
  left_ingesters_timeout: 30s
```

---

## 스토리지 심화

### Index Storage 비교: BoltDB Shipper vs TSDB

Loki의 인덱스 스토리지는 "레이블 조합 → Chunk 위치" 매핑을 저장하는 핵심 구성요소이다.

| 항목 | BoltDB Shipper | TSDB (Loki 2.8+) |
|------|---------------|-------------------|
| 도입 시기 | Loki 1.5 | Loki 2.8 |
| 상태 | deprecated (Loki 3.0에서 제거 예정) | 권장 (현재 기본값) |
| 인덱스 포맷 | BoltDB (key-value store) | Prometheus TSDB 기반 인버티드 인덱스 |
| 쿼리 성능 | 보통이다 | BoltDB 대비 10배 이상 빠르다 |
| Compaction 효율 | 낮다 (파일 수가 많다) | 높다 (파일 병합이 효율적이다) |
| 디스크 사용량 | 많다 | 적다 (2~5배 절감) |
| 지원하는 period | 24h | 24h |
| 멀티테넌시 | 지원한다 | 지원한다 |

```yaml
# TSDB 설정 (권장)
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
  tsdb_shipper:
    active_index_directory: /loki/tsdb-index
    cache_location: /loki/tsdb-cache
    shared_store: s3

# BoltDB Shipper 설정 (레거시)
# schema_config:
#   configs:
#     - from: "2022-01-01"
#       store: boltdb-shipper
#       object_store: s3
#       schema: v12
#       index:
#         prefix: index_
#         period: 24h
```

### Chunk Storage 백엔드 비교

Chunk Storage는 압축된 로그 본문을 저장하는 곳이다.

| 백엔드 | 설명 | 적합한 환경 |
|--------|------|-----------|
| **Filesystem** | 로컬 파일시스템에 저장한다 | 개발/테스트 환경, 단일 노드 Monolithic 모드이다 |
| **Amazon S3** | AWS S3에 저장한다 | AWS 환경의 프로덕션이다 |
| **Google GCS** | Google Cloud Storage에 저장한다 | GCP 환경의 프로덕션이다 |
| **Azure Blob** | Azure Blob Storage에 저장한다 | Azure 환경의 프로덕션이다 |
| **OpenStack Swift** | Swift Object Storage에 저장한다 | OpenStack 기반 프라이빗 클라우드이다 |
| **MinIO** | S3 호환 오브젝트 스토리지이다 | 온프레미스 환경이다 |

```yaml
# S3 스토리지 설정 예시
storage_config:
  aws:
    s3: s3://ap-northeast-2/loki-chunks-bucket
    s3forcepathstyle: false
    bucketnames: loki-chunks-bucket
    region: ap-northeast-2
    access_key_id: ${AWS_ACCESS_KEY_ID}
    secret_access_key: ${AWS_SECRET_ACCESS_KEY}
    sse_encryption: true          # 서버 사이드 암호화를 활성화한다
    insecure: false

# GCS 스토리지 설정 예시
# storage_config:
#   gcs:
#     bucket_name: loki-chunks-bucket
#     service_account: /path/to/service-account.json

# Filesystem 스토리지 설정 예시 (개발용)
# storage_config:
#   filesystem:
#     directory: /loki/chunks
```

### Schema Config 상세

`schema_config`는 Loki가 인덱스와 Chunk를 어떤 형식과 위치에 저장할지를 정의하는 설정이다.

**period_config 필드 설명:**

| 필드 | 설명 |
|------|------|
| `from` | 이 스키마가 적용되는 시작 날짜이다 (YYYY-MM-DD 형식) |
| `store` | 인덱스 저장소 타입이다 (`tsdb`, `boltdb-shipper`) |
| `object_store` | Chunk 저장소 타입이다 (`s3`, `gcs`, `azure`, `filesystem`) |
| `schema` | 스키마 버전이다 (`v9`~`v13`) |
| `index.prefix` | 인덱스 테이블 이름의 접두사이다 |
| `index.period` | 인덱스 테이블 로테이션 주기이다 (TSDB는 24h 고정) |
| `chunks.prefix` | Chunk 테이블 이름의 접두사이다 (선택적) |
| `chunks.period` | Chunk 테이블 로테이션 주기이다 (선택적) |

**index tables와 chunk tables:**
- `index.prefix`와 `index.period`로 인덱스 테이블의 이름 패턴과 로테이션 주기를 설정한다
- 예: `prefix=index_, period=24h`이면 매일 `index_19740`, `index_19741` 등의 테이블이 생성된다
- 테이블 번호는 Unix epoch 기준으로 `period` 단위로 증가하는 정수이다

### Schema 마이그레이션 전략

Loki의 스키마 마이그레이션은 `schema_config.configs` 배열에 새 항목을 추가하는 방식으로 수행한다. 이전 스키마의 데이터는 이전 스키마로 읽고, 새 데이터만 새 스키마로 기록한다.

**스키마 버전 변천사:**

| 버전 | 주요 변경 | 지원 store |
|------|---------|-----------|
| `v9` | 레거시 스키마이다 | `aws`, `gcp`, `bigtable` |
| `v10` | 청크 키 해싱 개선이다 | `aws`, `gcp`, `bigtable` |
| `v11` | 인덱스 포맷 최적화이다 | `boltdb-shipper` |
| `v12` | BoltDB Shipper 최적화이다 | `boltdb-shipper` |
| `v13` | TSDB 지원이다 | `tsdb` (권장) |

**무중단 마이그레이션 예시 (v12 → v13):**
```yaml
schema_config:
  configs:
    # 기존 스키마 (이 날짜 이전의 데이터는 이 스키마로 읽는다)
    - from: "2023-01-01"
      store: boltdb-shipper
      object_store: s3
      schema: v12
      index:
        prefix: index_
        period: 24h
    # 새 스키마 (이 날짜부터의 데이터는 이 스키마로 쓴다)
    - from: "2024-01-01"
      store: tsdb
      object_store: s3
      schema: v13
      index:
        prefix: index_
        period: 24h
```

마이그레이션 시 주의사항:
- `from` 날짜는 반드시 미래 날짜로 설정해야 한다 (과거 날짜로 설정하면 기존 데이터와 충돌할 수 있다)
- 마이그레이션 후 이전 스키마의 `from` 항목을 삭제하면 안 된다 (이전 데이터를 읽을 수 없게 된다)
- Retention이 이전 스키마의 데이터를 모두 삭제한 후에야 이전 스키마 항목을 제거할 수 있다

### Retention 설정

Retention은 Compactor가 담당하며, 보존 기간이 지난 데이터를 자동으로 삭제한다.

**전역 Retention:**
```yaml
limits_config:
  retention_period: 720h          # 30일 (모든 테넌트에 적용)

compactor:
  retention_enabled: true
  retention_delete_delay: 2h
```

**테넌트별 Retention:**
```yaml
# runtime-config.yaml (동적 설정 파일)
overrides:
  tenant-a:
    retention_period: 2160h       # 90일
  tenant-b:
    retention_period: 168h        # 7일
  tenant-c:
    retention_period: 8760h       # 365일
```

**스트림별 Retention:**
```yaml
# runtime-config.yaml
overrides:
  tenant-a:
    retention_period: 720h        # 기본 30일
    retention_stream:
      - selector: '{namespace="debug"}'
        priority: 1
        period: 72h               # debug 네임스페이스는 3일만 보관
      - selector: '{namespace="production", level="error"}'
        priority: 2
        period: 2160h             # production 에러 로그는 90일 보관
```

### Chunk 인코딩 비교 상세

| 알고리즘 | 압축률 (원본 대비) | 압축 CPU | 해제 CPU | 메모리 사용량 | 권장 사용처 |
|---------|-----------------|---------|---------|------------|-----------|
| `gzip` | 70~80% 감소 | 높다 | 보통이다 | 보통이다 | 스토리지 비용 최소화가 목표일 때 |
| `snappy` | 50~60% 감소 | 매우 낮다 | 매우 낮다 | 낮다 | 쿼리 지연 시간 최소화가 목표일 때 |
| `lz4` | 55~65% 감소 | 낮다 | 낮다 | 낮다 | snappy보다 약간 높은 압축률이 필요할 때 |
| `flate` | 65~75% 감소 | 높다 | 보통이다 | 보통이다 | gzip 대안이다 |
| `zstd` | 70~80% 감소 | 보통이다 | 낮다 | 보통이다 | 압축률과 해제 속도의 균형이 필요할 때 |
| `none` | 0% | 없다 | 없다 | 높다 | 디버깅 전용이다 |

**인코딩 선택 가이드:**
- 대부분의 환경에서는 `snappy`가 기본값으로 적합하다 (쓰기/읽기 모두 빠르다)
- 스토리지 비용이 최우선인 환경에서는 `zstd`를 권장한다 (gzip 수준의 압축률에 해제 속도가 빠르다)
- `gzip`은 레거시 호환성을 위해 유지되지만, `zstd`가 상위 호환이므로 신규 배포에서는 `zstd`를 권장한다

### 캐시 레이어

Loki는 세 가지 레벨의 캐시를 지원하여 쿼리 성능을 최적화한다.

| 캐시 레이어 | 캐싱 대상 | 효과 |
|-----------|---------|------|
| **Results Cache** | Query Frontend에서의 쿼리 결과 | 동일한 쿼리의 재실행을 즉시 반환한다 |
| **Chunks Cache** | Object Storage에서 로드한 Chunk | Chunk 재로드를 방지한다 |
| **Index Cache** | 인덱스 조회 결과 | 인덱스 Store 조회를 건너뛴다 |

**캐시 백엔드 비교:**

| 백엔드 | 장점 | 단점 | 적합한 환경 |
|--------|------|------|-----------|
| **Embedded (In-memory)** | 별도 인프라 불필요이다 | 프로세스 재시작 시 캐시 초기화이다 | 소규모, 개발/테스트이다 |
| **Memcached** | 분산 캐시, 대용량 지원이다 | 별도 운영 필요이다 | 대규모 프로덕션이다 |
| **Redis** | 분산 캐시, 영속성 지원이다 | 별도 운영 필요이다 | 캐시 영속성이 중요한 환경이다 |

```yaml
# 전체 캐시 설정 예시
query_range:
  results_cache:
    cache:
      memcached_client:
        addresses: memcached:11211
        timeout: 500ms
        max_idle_conns: 100

chunk_store_config:
  chunk_cache_config:
    memcached_client:
      addresses: memcached:11211
      timeout: 500ms

storage_config:
  index_queries_cache_config:
    memcached_client:
      addresses: memcached:11211
      timeout: 500ms
```

---

## Promtail 고급 설정

### Service Discovery

Promtail은 다양한 Service Discovery 메커니즘을 지원하여 로그 소스를 자동으로 발견한다.

| Discovery 타입 | 설명 | 사용 환경 |
|---------------|------|---------|
| `kubernetes_sd` | Kubernetes API를 통해 Pod를 자동 발견한다 | Kubernetes 클러스터 (가장 일반적) |
| `static_configs` | 고정된 파일 경로를 수동으로 지정한다 | VM, 베어메탈 서버 |
| `journal` | systemd journal을 읽는다 | 시스템 서비스 로그 (kubelet, containerd) |
| `docker_sd` | Docker API를 통해 컨테이너를 자동 발견한다 | Docker 환경 (비-Kubernetes) |
| `file_sd` | 파일 기반 Service Discovery이다 | Prometheus의 file_sd와 동일한 방식 |
| `consul_sd` | Consul에 등록된 서비스를 발견한다 | Consul 기반 인프라 |
| `gce_sd` | Google Compute Engine 인스턴스를 발견한다 | GCE 환경 |
| `ec2_sd` | AWS EC2 인스턴스를 발견한다 | EC2 환경 |

```yaml
# kubernetes_sd 설정 예시 (Pod 역할)
scrape_configs:
  - job_name: kubernetes-pods
    kubernetes_sd_configs:
      - role: pod                  # pod, node, service, endpoints 중 선택
        namespaces:
          names: [demo, production]  # 특정 네임스페이스만 대상 (선택적)

# static_configs 설정 예시 (VM 환경)
  - job_name: system-logs
    static_configs:
      - targets: [localhost]
        labels:
          job: syslog
          host: webserver-01
          __path__: /var/log/syslog

# journal 설정 예시 (systemd)
  - job_name: journal
    journal:
      max_age: 12h                # 최대 12시간 전의 로그까지 읽는다
      labels:
        job: systemd-journal
      path: /var/log/journal       # journal 파일 경로이다
```

### Pipeline Stages 전체 레퍼런스

Pipeline Stages는 Promtail이 로그 라인을 처리하는 단계별 파이프라인이다. 크게 네 가지 카테고리로 분류된다.

#### Parsing Stages (파싱)

로그 라인에서 구조화된 데이터를 추출하는 단계이다. 추출된 데이터는 내부 맵(extracted data)에 저장되며, 이후 단계에서 참조할 수 있다.

**json:**
```yaml
# JSON 로그 파싱
pipeline_stages:
  - json:
      expressions:
        level: level              # JSON의 level 필드를 추출한다
        msg: message              # JSON의 message 필드를 추출한다
        ts: timestamp             # JSON의 timestamp 필드를 추출한다
        duration: response.time   # 중첩 JSON 경로를 지원한다
      source: log                 # 특정 소스에서 파싱 (기본: 로그 라인 전체)
```

**logfmt:**
```yaml
# logfmt 파싱 (key=value 형식)
# 입력: level=info msg="request processed" duration=45ms
pipeline_stages:
  - logfmt:
      mapping:
        level:                    # level 키를 추출한다
        msg:                      # msg 키를 추출한다
        duration:                 # duration 키를 추출한다
```

**regex:**
```yaml
# 정규식으로 Named Group 추출
# 입력: 192.168.1.1 - - [15/Jan/2025:10:30:00 +0000] "GET /api/users HTTP/1.1" 200 1234
pipeline_stages:
  - regex:
      expression: '(?P<ip>\S+) \S+ \S+ \[(?P<timestamp>[^\]]+)\] "(?P<method>\S+) (?P<uri>\S+) \S+" (?P<status>\d+) (?P<size>\d+)'
```

**replace:**
```yaml
# 로그 라인의 문자열을 치환한다
pipeline_stages:
  - replace:
      expression: '(?i)(password|secret|token)=\S+'
      replace: '${1}=***REDACTED***'    # 민감 정보를 마스킹한다
```

**template:**
```yaml
# Go 템플릿으로 추출된 값을 변환한다
pipeline_stages:
  - template:
      source: level
      template: '{{ ToUpper .Value }}'  # 소문자 → 대문자 변환
  - template:
      source: duration_seconds
      template: '{{ div .Value 1000 }}' # 밀리초 → 초 변환
```

#### Filtering Stages (필터링)

조건에 따라 로그 라인을 선택하거나 버리는 단계이다.

**match:**
```yaml
# 조건에 맞는 로그에만 후속 파이프라인을 적용한다
pipeline_stages:
  - match:
      selector: '{app="nginx"}'           # LogQL Stream Selector
      pipeline_name: nginx_pipeline
      stages:
        - regex:
            expression: '"(?P<method>\S+) (?P<uri>\S+) \S+" (?P<status>\d+)'
        - labels:
            method:
            status:

  - match:
      selector: '{app="api"}'
      stages:
        - json:
            expressions:
              level: level
        - labels:
            level:
```

**drop:**
```yaml
# 조건에 맞는 로그 라인을 완전히 버린다 (Loki에 전송하지 않는다)
pipeline_stages:
  # 특정 값을 가진 로그를 버린다
  - drop:
      source: level
      value: "debug"
      drop_counter_reason: debug_logs     # 메트릭에서 드롭 이유를 추적한다

  # 정규식에 매칭되는 로그를 버린다
  - drop:
      expression: ".*healthcheck.*"

  # 오래된 로그를 버린다 (타임스탬프 기준)
  - drop:
      older_than: 24h
      drop_counter_reason: too_old

  # 긴 로그 라인을 버린다
  - drop:
      longer_than: 8KB
      drop_counter_reason: too_long
```

#### Transform Stages (변환)

추출된 데이터를 레이블로 설정하거나 로그 라인을 변환하는 단계이다.

**labels:**
```yaml
# 추출된 데이터를 Loki 레이블로 설정한다
pipeline_stages:
  - json:
      expressions:
        level: level
        method: method
  - labels:
      level:                              # 추출된 level을 레이블로 설정한다
      http_method: method                 # method를 http_method라는 이름의 레이블로 설정한다
```

**labelallow:**
```yaml
# 허용된 레이블만 유지하고 나머지를 제거한다
pipeline_stages:
  - labelallow:
      - namespace
      - pod
      - app
      - level
      # 위 4개 외의 모든 레이블은 제거된다
```

**labeldrop:**
```yaml
# 지정된 레이블을 제거한다
pipeline_stages:
  - labeldrop:
      - filename                          # Promtail이 자동으로 붙이는 filename 레이블을 제거한다
      - stream
```

**multiline:**
```yaml
# 여러 줄에 걸친 로그를 하나의 엔트리로 합친다
# Java Stack Trace 예시:
# Exception in thread "main" java.lang.NullPointerException
#     at com.example.Main.method(Main.java:42)
#     at com.example.Main.main(Main.java:10)
pipeline_stages:
  - multiline:
      firstline: '^\d{4}-\d{2}-\d{2}'    # 새 로그 라인의 시작 패턴
      max_wait_time: 3s                   # 다음 firstline을 기다리는 최대 시간
      max_lines: 128                      # 하나의 엔트리로 합칠 최대 줄 수
```

**pack:**
```yaml
# 여러 레이블을 JSON으로 패킹하여 로그 라인에 포함시킨다
# 레이블 수를 줄이면서 데이터를 보존하는 기법이다
pipeline_stages:
  - pack:
      labels:
        - method
        - status
        - duration
      # 결과: 원본 로그 + {"method":"GET","status":"200","duration":"45ms"}
```

**timestamp:**
```yaml
# 로그 라인에서 타임스탬프를 추출하여 로그의 시간으로 설정한다
pipeline_stages:
  - timestamp:
      source: ts                          # 추출된 데이터 맵에서 참조할 키
      format: RFC3339Nano                 # 타임스탬프 포맷
      # 지원 포맷: RFC3339, RFC3339Nano, Unix, UnixMs, UnixUs, UnixNs
      # 또는 Go reference time 형식: "2006-01-02T15:04:05.000Z"
      fallback_formats:
        - "2006-01-02 15:04:05"           # 대체 포맷 (첫 번째 포맷이 실패하면 시도)
      location: Asia/Seoul                # 타임존 (UTC가 아닌 경우)
      action_on_failure: fudge            # 파싱 실패 시: fudge(현재 시간 사용), skip(건너뛰기)
```

**output:**
```yaml
# 로그 라인의 내용을 변경한다 (Loki에 저장되는 로그 본문)
pipeline_stages:
  - json:
      expressions:
        msg: message
  - output:
      source: msg                         # message 필드의 값을 로그 본문으로 사용한다
```

#### Metrics Stages (메트릭)

로그 라인에서 Prometheus 메트릭을 생성하여 Promtail의 `/metrics` 엔드포인트에 노출한다. Loki가 아닌 Prometheus가 스크랩하는 메트릭이다.

**counter:**
```yaml
pipeline_stages:
  - metrics:
      log_lines_total:
        type: Counter
        description: "Total log lines by level"
        source: level
        config:
          match_all: true                 # 모든 로그 라인을 카운트한다
          action: inc
      error_lines_total:
        type: Counter
        description: "Total error log lines"
        source: level
        config:
          value: error                    # level이 error인 라인만 카운트한다
          action: inc
```

**gauge:**
```yaml
pipeline_stages:
  - metrics:
      active_connections:
        type: Gauge
        description: "Current active connections"
        source: connections
        config:
          action: set                     # 값을 직접 설정한다 (inc, dec, set, add, sub)
```

**histogram:**
```yaml
pipeline_stages:
  - metrics:
      response_time_seconds:
        type: Histogram
        description: "Response time distribution"
        source: duration
        config:
          buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]
```

### Pipeline 실행 순서와 데이터 흐름

Pipeline Stages는 YAML에 정의된 순서대로 순차 실행된다. 각 Stage는 이전 Stage의 출력을 입력으로 받는다.

```
원본 로그 라인
     │
     ▼
┌──────────────┐
│  Stage 1:    │──→ 로그 라인 파싱 (json, regex 등)
│  Parsing     │     → 추출된 데이터를 내부 맵에 저장
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  Stage 2:    │──→ 추출된 데이터를 변환 (template, timestamp 등)
│  Transform   │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  Stage 3:    │──→ 조건에 따라 로그를 버림 (drop, match)
│  Filtering   │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  Stage 4:    │──→ 추출된 데이터를 레이블로 설정 (labels)
│  Labels      │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  Stage 5:    │──→ 로그 본문을 변경 (output)
│  Output      │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  Stage 6:    │──→ Prometheus 메트릭 생성 (metrics)
│  Metrics     │
└──────┬───────┘
       │
       ▼
Loki로 전송: {레이블} + 타임스탬프 + 로그 본문
```

내부 데이터 흐름은 세 가지 구성요소로 나뉜다:
- **Extracted Data Map**: Stage 간에 공유되는 키-값 맵이다. Parsing Stage가 채우고, Transform/Labels Stage가 참조한다
- **Labels**: Loki에 전송될 레이블 집합이다. Labels Stage가 설정한다
- **Log Line**: 최종적으로 Loki에 저장될 로그 본문이다. Output Stage가 변경한다

### Positions 파일 심화

Positions 파일은 Promtail이 각 로그 파일에서 어디까지 읽었는지를 기록하는 YAML 파일이다.

```yaml
# /tmp/positions.yaml (예시)
positions:
  /var/log/pods/demo_nginx-abc_uid/nginx/0.log: "1234567"
  /var/log/pods/demo_api-def_uid/api/0.log: "9876543"
  /var/log/pods/monitoring_loki-xyz_uid/loki/0.log: "5555555"
```

- 각 항목은 "파일 경로: 바이트 오프셋"이다
- Promtail이 재시작되면 이 파일을 읽어서 각 파일의 마지막 읽기 위치부터 이어서 수집한다
- `positions.sync_period` (기본 10s)마다 디스크에 동기화한다
- Positions 파일이 손실되면 Promtail은 `tail` 위치(파일 끝)부터 읽기 시작하여 그 사이의 로그는 유실된다

**복구 시나리오:**
| 상황 | 동작 |
|------|------|
| 정상 재시작 + Positions 파일 존재 | 마지막 오프셋부터 이어서 읽는다. 로그 유실 없음 |
| 정상 재시작 + Positions 파일 손실 | 파일 끝부터 읽는다. 중간 로그 유실 가능 |
| 로그 파일이 로테이션됨 | 새 파일을 감지하고 처음부터 읽는다 |
| 로그 파일이 truncate됨 | 파일 크기가 오프셋보다 작으면 처음부터 읽는다 |

### Rate Limiting

Promtail은 자체적으로 Loki로 전송하는 로그의 양을 제한할 수 있다.

```yaml
# Promtail의 Rate Limiting 설정
clients:
  - url: http://loki:3100/loki/api/v1/push
    # 클라이언트 레벨 제한
    batchwait: 1s                 # 배치 전송 간격이다
    batchsize: 1048576            # 배치 크기 (1MB)이다
    backoff_config:
      min_period: 500ms           # 재시도 최소 간격이다
      max_period: 5m              # 재시도 최대 간격이다
      max_retries: 10             # 최대 재시도 횟수이다

limits_config:
  readline_rate_enabled: true
  readline_rate: 100              # 초당 최대 100줄까지 읽는다
  readline_burst: 1000            # 순간 최대 1000줄까지 허용한다
  readline_rate_drop: true        # Rate Limit 초과 시 로그를 버린다 (false면 큐에 쌓임)
```

### 멀티라인 로그 처리 심화

Java Stack Trace, Python Traceback 등 여러 줄에 걸친 로그를 하나의 엔트리로 합치는 방법이다.

```yaml
# Java Stack Trace 멀티라인 처리
pipeline_stages:
  - multiline:
      # 새 로그 엔트리의 시작을 나타내는 패턴이다
      # 타임스탬프로 시작하는 라인이 새 엔트리의 시작이다
      firstline: '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}'
      max_wait_time: 3s           # 다음 firstline을 기다리는 최대 시간이다
      max_lines: 128              # 하나의 엔트리에 포함할 최대 줄 수이다

# Python Traceback 멀티라인 처리
  - multiline:
      firstline: '^(Traceback|  File|    |\S)'
      max_wait_time: 5s
```

**주의사항:**
- `max_wait_time`이 너무 짧으면 Stack Trace가 잘릴 수 있다
- `max_wait_time`이 너무 길면 로그 전송 지연이 발생한다
- `max_lines`가 너무 크면 메모리 사용량이 증가한다
- 멀티라인 처리는 반드시 다른 파싱 Stage보다 먼저 위치해야 한다

### Promtail vs Grafana Agent vs FluentBit vs Fluentd 비교

| 항목 | Promtail | Grafana Agent | FluentBit | Fluentd |
|------|----------|---------------|-----------|---------|
| 개발사 | Grafana Labs | Grafana Labs | Fluent Project | Fluent Project (CNCF) |
| 언어 | Go | Go | C | Ruby + C |
| Loki 네이티브 | 예 | 예 | 플러그인 | 플러그인 |
| 메모리 사용량 | 낮다 (~30MB) | 낮다 (~40MB) | 매우 낮다 (~10MB) | 높다 (~100MB+) |
| Kubernetes SD | 내장 | 내장 | 외부 필터 | 외부 플러그인 |
| Pipeline | Loki 전용 Stage | Loki 전용 Stage | 일반 필터 체인 | 일반 필터 체인 |
| 멀티 출력 | Loki만 | Loki + Prometheus + Tempo | 다양하다 (40+ 출력) | 다양하다 (100+ 출력) |
| 상태 | 유지보수 모드 | Grafana Alloy로 전환 중 | 활발한 개발 | 활발한 개발 |
| 적합한 환경 | Loki 전용 환경이다 | Grafana 관측 스택 전체이다 | 경량 환경, 다중 출력이다 | 복잡한 라우팅, 변환이다 |

**Grafana Alloy (구 Grafana Agent Flow):**
- Grafana Labs의 차세대 텔레메트리 수집기이다
- Promtail + Grafana Agent의 기능을 통합한 단일 바이너리이다
- 리버(River) 설정 언어를 사용하며, 파이프라인 기반의 유연한 구성이 가능하다
- 신규 프로젝트에서는 Promtail 대신 Grafana Alloy를 권장한다

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

## 성능 최적화

### 레이블 설계 모범 사례 (Cardinality 관리)

레이블 카디널리티는 Loki 성능에 가장 큰 영향을 미치는 요소이다. 카디널리티가 높을수록 활성 스트림 수가 증가하고, Ingester의 메모리 사용량이 증가하며, 인덱스 크기가 비대해진다.

**카디널리티 수준별 가이드:**

| 수준 | 고유 값 수 | 예시 | 레이블 적합성 |
|------|----------|------|-------------|
| 매우 낮다 | ~5 | level (debug, info, warn, error, fatal) | 매우 적합하다 |
| 낮다 | ~10-50 | namespace, env, region | 적합하다 |
| 보통 | ~100-1000 | app, service | 주의가 필요하다 |
| 높다 | ~10000+ | pod (ReplicaSet 스케일에 따라) | 신중하게 판단한다 |
| 매우 높다 | ~무한 | request_id, user_id, ip | 절대 레이블로 사용하지 않는다 |

**활성 스트림 수 계산:**
```
활성 스트림 수 = 레이블1의 고유값 × 레이블2의 고유값 × ... × 레이블N의 고유값

예: namespace(5) × app(20) × pod(100) × level(4) = 40,000 스트림
    → 각 스트림이 Ingester에서 ~1KB의 메모리를 소비한다고 가정하면
    → 40,000 × 1KB = ~40MB (관리 가능)

예: namespace(5) × app(20) × pod(100) × level(4) × user_id(100,000) = 4,000,000,000 스트림
    → 메모리 소진, Loki 장애 발생
```

**모범 사례 요약:**
1. Kubernetes가 자동으로 부여하는 레이블(namespace, pod, container)을 기본으로 사용한다
2. `level`처럼 카디널리티가 매우 낮은 값만 동적 레이블로 추가한다
3. 고카디널리티 값은 로그 본문에 포함하고, LogQL의 Parser로 쿼리 시점에 추출한다
4. `max_streams_per_user` 설정으로 스트림 폭증을 방지한다
5. Loki의 `/metrics` 엔드포인트에서 `loki_ingester_streams_created_total`을 모니터링한다

### 쿼리 최적화

**시간 범위 제한:**
- 쿼리 시간 범위가 넓을수록 더 많은 Chunk를 읽어야 하므로 느려진다
- 가능하면 시간 범위를 최소화한다 (24시간 이내 권장)
- `max_query_length`로 최대 쿼리 범위를 제한할 수 있다

**레이블 필터 우선:**
- Stream Selector에서 레이블 필터로 대상을 좁히는 것이 가장 효과적이다
- 레이블 필터는 인덱스를 사용하므로 O(1)에 가깝고, Line Filter는 로그 본문을 스캔하므로 O(n)이다

**Line Filter 순서:**
- 가장 선택적인(많이 걸러내는) 필터를 먼저 배치한다
- 문자열 포함(`|=`)이 정규식(`|~`)보다 빠르다
- Parser 전에 Line Filter를 적용하면 파싱할 로그 수가 줄어든다

```logql
# 좋은 쿼리: 레이블로 범위를 좁히고, line filter로 추가 필터링
{namespace="demo", app="api"} |= "error" | json | status >= 500

# 나쁜 쿼리: 넓은 범위에서 파싱 후 필터링
{namespace=~".+"} | json | app = "api" | level = "error"
```

**특정 키만 파싱:**
```logql
# 나쁜 예: 모든 JSON 키를 파싱 (느림)
{app="api"} | json | status >= 500

# 좋은 예: 필요한 키만 파싱 (빠름)
{app="api"} | json status | status >= 500
```

### Chunk 크기와 Flush 간격 조정

| 설정 | 작은 값 | 큰 값 |
|------|--------|-------|
| `chunk_target_size` | Chunk가 자주 Flush되어 Object Storage에 작은 파일이 많아진다 | Chunk가 Ingester 메모리에 오래 머물러 메모리 사용량이 증가한다 |
| `max_chunk_age` | 오래된 Chunk가 빨리 Flush된다 | Ingester 메모리에 오래 머문다 |
| `chunk_idle_period` | 비활성 스트림의 Chunk가 빨리 Flush된다 | 비활성 스트림이 메모리를 오래 점유한다 |

**권장 설정:**
```yaml
ingester:
  chunk_target_size: 1572864     # 1.5MB (기본값, 대부분의 환경에 적합)
  max_chunk_age: 2h              # 2시간 (기본값)
  chunk_idle_period: 30m         # 30분 (기본값)
  # 로그 볼륨이 매우 큰 환경에서는:
  # chunk_target_size: 2621440   # 2.5MB로 증가
  # max_chunk_age: 1h            # 1시간으로 단축
```

### 캐시 활용

**Query Results Cache:**
- Query Frontend에서 쿼리 결과를 캐싱한다
- 동일한 쿼리의 반복 실행을 즉시 반환한다
- 분할된 하위 쿼리 단위로 캐싱되므로, 시간 범위가 일부 겹치는 쿼리도 캐시 히트가 가능하다
- Grafana Dashboard에서 같은 쿼리가 반복 실행될 때 가장 효과적이다

**Chunks Cache:**
- Object Storage에서 로드한 Chunk를 캐싱한다
- 같은 시간대의 로그를 여러 번 조회할 때 Object Storage 호출을 줄인다
- 캐시 크기는 가장 자주 조회하는 시간 범위의 Chunk 크기에 맞춰 설정한다

**Index Cache:**
- 인덱스 조회 결과를 캐싱한다
- 같은 레이블 조합의 쿼리가 반복될 때 효과적이다

### Ingester 리소스 설정

Ingester는 Loki에서 가장 많은 메모리를 소비하는 컴포넌트이다.

```yaml
# Kubernetes 리소스 설정 예시
resources:
  requests:
    cpu: "1"
    memory: "4Gi"
  limits:
    cpu: "2"
    memory: "8Gi"
```

**메모리 사용량 추정:**
```
Ingester 메모리 ≈ (활성 스트림 수 × 스트림당 메모리) + (WAL 리플레이 메모리)

스트림당 메모리 ≈ chunk_target_size + 오버헤드 (~2KB)
예: 50,000 스트림 × 1.5MB = ~75GB → 실제로는 청크가 점진적으로 채워지므로 이보다 적다
    50,000 스트림 × ~500KB (평균) = ~25GB
```

**OOM 방지 전략:**
- `max_streams_per_user`로 스트림 수를 제한한다
- `chunk_target_size`를 줄여 청크당 메모리 사용량을 낮춘다
- `chunk_idle_period`를 줄여 비활성 스트림을 빨리 Flush한다
- WAL의 `replay_memory_ceiling`을 설정하여 복구 시 메모리 급증을 방지한다

### 대용량 환경에서의 수평 확장

**Write Path 확장:**
```
트래픽 증가 → Distributor 인스턴스 추가 (Stateless, 쉽게 확장 가능)
           → Ingester 인스턴스 추가 (Stateful, Hash Ring 자동 조정)
```

**Read Path 확장:**
```
쿼리 부하 증가 → Querier 인스턴스 추가 (Stateless)
              → Query Frontend 인스턴스 추가 (Stateless)
              → 캐시 클러스터 확장 (Memcached 노드 추가)
```

**확장 순서:**
1. 먼저 캐시를 도입한다 (가장 효과적인 성능 향상)
2. Querier를 수평 확장한다 (Read Path 병목 해소)
3. Ingester를 수평 확장한다 (Write Path 병목 해소)
4. Object Storage의 처리량을 확인한다 (S3 Rate Limit 등)

**Ingester 확장 시 주의사항:**
- Ingester를 추가하면 Hash Ring이 자동으로 재조정된다
- 재조정 중에는 일부 스트림이 새 Ingester로 마이그레이션된다
- 한 번에 많은 Ingester를 추가/제거하면 성능이 일시적으로 저하될 수 있다
- 점진적으로 확장하는 것이 안전하다 (한 번에 1~2개씩)

---

## 트러블슈팅

### 로그 수집이 안 되는 경우 (Promtail 진단)

**확인 순서:**

1. **Promtail Pod 상태 확인:**
```bash
kubectl get pods -n monitoring -l app=promtail
kubectl describe pod -n monitoring <promtail-pod-name>
kubectl logs -n monitoring <promtail-pod-name> --tail=100
```

2. **Promtail 타겟 확인:**
```bash
# Promtail의 /targets 엔드포인트로 수집 대상 확인
kubectl port-forward -n monitoring <promtail-pod> 9080:9080
curl http://localhost:9080/targets
# state: "Ready"인 타겟이 있어야 한다
```

3. **Promtail 메트릭 확인:**
```bash
curl http://localhost:9080/metrics | grep -E "promtail_targets_active|promtail_read_bytes_total|promtail_sent_bytes_total"
# promtail_targets_active_total: 활성 수집 대상 수
# promtail_read_bytes_total: 읽은 바이트 수 (증가해야 함)
# promtail_sent_bytes_total: Loki로 전송한 바이트 수 (증가해야 함)
```

4. **일반적인 원인과 해결:**

| 증상 | 원인 | 해결 |
|------|------|------|
| 타겟이 0개이다 | Service Discovery 설정 오류이다 | `kubernetes_sd_configs`의 `role`과 `namespaces` 확인 |
| 타겟이 Ready이지만 로그가 없다 | 로그 파일 경로가 잘못되었다 | `__path__` 레이블과 실제 파일 경로 일치 확인 |
| 전송 실패 (429 에러) | Rate Limit 초과이다 | `ingestion_rate_mb`와 `ingestion_burst_size_mb` 증가 |
| 전송 실패 (400 에러) | 레이블 검증 실패이다 | 레이블 이름/값 길이, 레이블 수 제한 확인 |
| 전송 실패 (500 에러) | Loki 서버 오류이다 | Loki 로그 및 상태 확인 |
| positions.yaml 오류 | 파일 권한 문제이다 | Promtail의 파일시스템 마운트와 권한 확인 |

### 쿼리가 느린 경우 (Query Frontend 분석)

**확인 순서:**

1. **쿼리 시간 범위 확인:**
   - 시간 범위가 7일 이상이면 `split_queries_by_interval`에 의해 많은 하위 쿼리가 생성된다
   - 시간 범위를 줄여서 테스트한다

2. **Stream Selector 확인:**
   - `{namespace=~".+"}` 같은 넓은 범위의 Selector는 모든 스트림을 스캔하므로 느리다
   - 가능한 한 구체적인 레이블 매처를 사용한다

3. **Query Frontend 메트릭 확인:**
```bash
# 쿼리 지연 시간 (히스토그램)
curl http://localhost:3100/metrics | grep loki_request_duration_seconds
# 쿼리 대기열 길이
curl http://localhost:3100/metrics | grep cortex_query_frontend_queue_length
```

4. **캐시 히트율 확인:**
```bash
curl http://localhost:3100/metrics | grep -E "cache_hit|cache_miss"
# 캐시 히트율이 낮으면 캐시 크기를 늘리거나 TTL을 조정한다
```

5. **일반적인 최적화:**

| 증상 | 원인 | 해결 |
|------|------|------|
| 모든 쿼리가 느리다 | Querier 리소스 부족이다 | Querier 인스턴스 추가 또는 CPU/메모리 증가 |
| 특정 쿼리만 느리다 | 쿼리 범위가 넓다 | 레이블 필터 추가, 시간 범위 축소 |
| 첫 번째 쿼리만 느리다 | 캐시가 비어있다 | 정상 동작 (캐시 워밍업 필요) |
| 쿼리 타임아웃 | `query_timeout` 초과이다 | 쿼리 최적화 또는 `query_timeout` 증가 |

### 스토리지 용량 증가 관리

**용량 모니터링:**
```logql
# Loki의 저장 용량 메트릭 (Prometheus에서 조회)
loki_ingester_chunks_stored_total          # 저장된 Chunk 수
loki_ingester_chunk_stored_bytes_total     # 저장된 바이트 수
```

**용량 절감 방법:**
1. **Retention 설정**: Compactor의 Retention을 활성화하여 오래된 데이터를 자동 삭제한다
2. **불필요한 로그 드롭**: Promtail의 `drop` Stage로 debug 로그, healthcheck 로그 등을 버린다
3. **압축률 높은 인코딩 사용**: `gzip` 또는 `zstd`로 압축률을 높인다
4. **스트림 레이블 최적화**: 불필요한 레이블을 제거하여 인덱스 크기를 줄인다

### Rate Limiting 에러 대응

**증상:** Promtail 로그에 `429 Too Many Requests` 또는 `server returned HTTP status 429` 에러가 나타난다.

**원인과 해결:**
```yaml
# 1. 전역 Rate Limit 증가
limits_config:
  ingestion_rate_mb: 20            # 기본값 4 → 20으로 증가
  ingestion_burst_size_mb: 40      # 기본값 6 → 40으로 증가

# 2. 테넌트별 Rate Limit 조정
overrides:
  heavy-tenant:
    ingestion_rate_mb: 50
    ingestion_burst_size_mb: 100

# 3. Promtail에서 불필요한 로그 드롭 (근본적 해결)
pipeline_stages:
  - drop:
      expression: ".*healthcheck.*"
  - drop:
      source: level
      value: "debug"
```

### OOM 에러 대응

**증상:** Ingester 또는 Querier Pod가 OOMKilled 상태로 재시작된다.

**Ingester OOM 원인과 해결:**
| 원인 | 진단 | 해결 |
|------|------|------|
| 활성 스트림이 너무 많다 | `loki_ingester_memory_streams` 메트릭 확인 | `max_streams_per_user` 제한, 고카디널리티 레이블 제거 |
| Chunk가 Flush되지 않는다 | `loki_ingester_chunks_flushed_total` 확인 | Object Storage 연결 확인, `flush_op_timeout` 조정 |
| WAL 리플레이 메모리 급증 | 재시작 직후 OOM 발생 | `replay_memory_ceiling` 설정 |

**Querier OOM 원인과 해결:**
| 원인 | 진단 | 해결 |
|------|------|------|
| 쿼리 범위가 너무 넓다 | 쿼리 로그에서 시간 범위 확인 | `max_query_length` 제한 |
| 결과가 너무 크다 | 쿼리 결과 행 수 확인 | `max_query_series` 제한, `max_entries_limit_per_query` 제한 |
| Chunk 로드 과다 | Chunk 캐시 미스율 확인 | 캐시 도입 또는 크기 증가 |

### 로그 누락 진단

**로그가 일부만 수집되는 경우:**

1. **타임스탬프 순서 확인:**
   - Loki는 기본적으로 동일 스트림 내에서 타임스탬프가 단조 증가해야 한다
   - 타임스탬프가 뒤섞이면 `entry out of order` 에러로 로그가 거부된다
   - `unordered_writes: true` 설정으로 비순차 로그를 허용할 수 있다

2. **Rate Limit 확인:**
   - `loki_distributor_lines_received_total`과 `loki_discarded_samples_total` 메트릭을 비교한다
   - 차이가 있으면 Rate Limit에 의해 로그가 버려진 것이다

3. **Promtail의 Positions 파일 확인:**
   - Promtail이 재시작되면서 Positions 파일을 잃었을 수 있다
   - 이 경우 재시작 이전의 로그가 수집되지 않는다

4. **Pipeline Stage의 drop 설정 확인:**
   - 의도치 않은 `drop` Stage가 로그를 버리고 있을 수 있다
   - `promtail_custom_<metric>_total` 메트릭으로 드롭된 로그 수를 확인한다

```yaml
# 비순차 로그 허용 설정
limits_config:
  unordered_writes: true            # 타임스탬프 순서를 강제하지 않는다
```

---

## 보안

### TLS 설정

Loki 컴포넌트 간의 통신(gRPC)과 클라이언트와의 통신(HTTP)에 TLS를 적용할 수 있다.

**HTTP 서버 TLS (클라이언트 → Loki):**
```yaml
server:
  http_tls_config:
    cert_file: /certs/server.crt
    key_file: /certs/server.key
    client_auth_type: RequireAndVerifyClientCert  # mTLS
    client_ca_file: /certs/ca.crt
```

**gRPC 서버 TLS (Distributor → Ingester 등):**
```yaml
server:
  grpc_tls_config:
    cert_file: /certs/server.crt
    key_file: /certs/server.key
    client_auth_type: RequireAndVerifyClientCert
    client_ca_file: /certs/ca.crt
```

**gRPC 클라이언트 TLS (Ingester에 연결하는 Distributor 등):**
```yaml
ingester_client:
  grpc_client_config:
    tls_cert_path: /certs/client.crt
    tls_key_path: /certs/client.key
    tls_ca_path: /certs/ca.crt
    tls_server_name: ingester.loki.svc
    tls_insecure_skip_verify: false
```

**Kubernetes 환경에서의 TLS 관리:**
- cert-manager를 사용하여 TLS 인증서를 자동으로 생성하고 갱신할 수 있다
- Kubernetes Secret으로 인증서를 관리하고, Pod에 마운트한다
- Service Mesh(Istio, Linkerd)를 사용하면 애플리케이션 레벨 TLS 없이도 mTLS가 가능하다

### 인증/인가: 멀티테넌트 환경에서의 접근 제어

Loki 자체는 인증(Authentication) 기능을 내장하고 있지 않다. 멀티테넌트 환경에서 접근 제어를 구현하려면 Reverse Proxy를 사용해야 한다.

**Reverse Proxy를 이용한 인증 아키텍처:**
```
┌──────────┐     ┌──────────────┐     ┌──────────┐
│ Promtail │────→│ Auth Proxy   │────→│   Loki   │
│          │     │ (nginx,      │     │          │
│          │     │  Envoy,      │     │          │
│          │     │  OAuth2 Proxy│     │          │
│          │     │  등)         │     │          │
│          │     │              │     │          │
│          │     │ • 토큰 검증   │     │          │
│          │     │ • 테넌트 ID   │     │          │
│          │     │   주입        │     │          │
│          │     └──────────────┘     └──────────┘
└──────────┘
```

**OAuth2 Proxy를 사용한 인증 예시:**
```yaml
# OAuth2 Proxy 설정
apiVersion: apps/v1
kind: Deployment
metadata:
  name: oauth2-proxy
spec:
  template:
    spec:
      containers:
        - name: oauth2-proxy
          image: quay.io/oauth2-proxy/oauth2-proxy
          args:
            - --upstream=http://loki:3100
            - --provider=oidc
            - --oidc-issuer-url=https://auth.example.com
            - --email-domain=example.com
            - --pass-access-token=true
            - --set-xauthrequest=true
```

**Grafana에서의 접근 제어:**
- Grafana의 데이터소스 설정에서 `X-Scope-OrgID` 헤더를 고정하여 특정 테넌트만 조회하도록 제한할 수 있다
- Grafana의 Organization과 Loki의 Tenant를 1:1로 매핑하여 조직별 접근 제어를 구현할 수 있다
- Grafana의 RBAC(Role-Based Access Control)로 사용자별 데이터소스 접근 권한을 제어할 수 있다

### 민감 데이터 마스킹

로그에 포함된 민감 데이터(비밀번호, API 키, 개인정보 등)를 Promtail의 Pipeline Stage에서 마스킹할 수 있다.

**replace Stage를 사용한 마스킹:**
```yaml
pipeline_stages:
  # 비밀번호 마스킹
  - replace:
      expression: '(?i)(password|passwd|pwd)\s*[=:]\s*\S+'
      replace: '${1}=***REDACTED***'

  # API 키 마스킹
  - replace:
      expression: '(?i)(api[_-]?key|api[_-]?secret|token)\s*[=:]\s*[A-Za-z0-9_\-]+'
      replace: '${1}=***REDACTED***'

  # 이메일 마스킹
  - replace:
      expression: '[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}'
      replace: '***@***.***'

  # 신용카드 번호 마스킹 (16자리 숫자)
  - replace:
      expression: '\b\d{4}[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{4}\b'
      replace: '****-****-****-****'

  # 주민등록번호 마스킹 (한국)
  - replace:
      expression: '\b\d{6}[\s\-]?\d{7}\b'
      replace: '******-*******'

  # Bearer 토큰 마스킹
  - replace:
      expression: '(?i)bearer\s+[A-Za-z0-9\._\-]+'
      replace: 'Bearer ***REDACTED***'
```

**주의사항:**
- 마스킹은 Promtail(수집 시점)에서 수행해야 한다. Loki에 저장된 후에는 마스킹할 수 없다
- 정규식이 너무 넓으면 정상적인 로그 데이터까지 마스킹될 수 있다
- 마스킹 정규식의 성능을 테스트하여 Promtail의 CPU 사용량에 미치는 영향을 확인한다
- GDPR, PIPA 등 규정 준수를 위해 민감 데이터가 로그에 기록되지 않도록 애플리케이션 레벨에서 방지하는 것이 가장 좋다

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
