# Day 2: Loki 아키텍처 심화

Distributor, Ingester, Querier, Query Frontend, Compactor, Ruler 등 각 컴포넌트의 내부 동작, Hash Ring, Replication, WAL, Chunk Flushing 등 심화 아키텍처를 학습한다.

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

