# Day 3: 스토리지 심화와 Promtail 고급 설정

Index Storage, Chunk Storage, Schema Config, 캐싱, Promtail의 Pipeline Stages 상세, Service Discovery, 멀티라인 로그 처리, 로그 수집 에이전트 비교를 학습한다.

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

