# Day 1: 개념, 아키텍처, Promtail 심화, LogQL 심화

Loki의 핵심 개념, ELK/EFK 비교, 배포 모드, 핵심 컴포넌트, Write/Read Path, Promtail의 동작 원리와 Pipeline Stages, LogQL의 문법과 쿼리 패턴을 학습한다.

---

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

