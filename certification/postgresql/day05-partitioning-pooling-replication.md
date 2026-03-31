# Day 5: 파티셔닝, Connection Pooling, Replication

> Range/List/Hash Partitioning과 Partition Pruning, PgBouncer Connection Pooling, Streaming/Logical Replication, Replication Slot, pg_basebackup을 학습한다.

---

## Partitioning

### 파티셔닝 개요

테이블을 논리적으로 하나이지만 물리적으로 여러 파티션으로 분할하는 기법이다. 대용량 테이블에서 쿼리 성능, 유지보수 효율, 데이터 관리를 개선한다.

### Range Partitioning

```sql
-- 날짜 기반 Range Partitioning
CREATE TABLE events (
    id BIGSERIAL,
    event_type TEXT NOT NULL,
    payload JSONB,
    created_at TIMESTAMP NOT NULL
) PARTITION BY RANGE (created_at);

-- 월별 파티션 생성
CREATE TABLE events_2024_01 PARTITION OF events
    FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');
CREATE TABLE events_2024_02 PARTITION OF events
    FOR VALUES FROM ('2024-02-01') TO ('2024-03-01');
CREATE TABLE events_2024_03 PARTITION OF events
    FOR VALUES FROM ('2024-03-01') TO ('2024-04-01');

-- Default 파티션 (범위에 속하지 않는 데이터)
CREATE TABLE events_default PARTITION OF events DEFAULT;

-- 파티션별 인덱스 자동 생성
CREATE INDEX idx_events_created_at ON events(created_at);
-- → 각 파티션에 자동으로 인덱스가 생성된다
```

### List Partitioning

```sql
-- 지역 기반 List Partitioning
CREATE TABLE customers (
    id SERIAL,
    name TEXT NOT NULL,
    region TEXT NOT NULL,
    email TEXT
) PARTITION BY LIST (region);

CREATE TABLE customers_asia PARTITION OF customers
    FOR VALUES IN ('KR', 'JP', 'CN', 'TW');
CREATE TABLE customers_europe PARTITION OF customers
    FOR VALUES IN ('DE', 'FR', 'GB', 'IT');
CREATE TABLE customers_america PARTITION OF customers
    FOR VALUES IN ('US', 'CA', 'BR', 'MX');
CREATE TABLE customers_default PARTITION OF customers DEFAULT;
```

### Hash Partitioning

```sql
-- Hash Partitioning (균등 분배)
CREATE TABLE logs (
    id BIGSERIAL,
    user_id INTEGER NOT NULL,
    action TEXT,
    created_at TIMESTAMP DEFAULT NOW()
) PARTITION BY HASH (user_id);

-- 4개 파티션으로 균등 분배
CREATE TABLE logs_0 PARTITION OF logs FOR VALUES WITH (MODULUS 4, REMAINDER 0);
CREATE TABLE logs_1 PARTITION OF logs FOR VALUES WITH (MODULUS 4, REMAINDER 1);
CREATE TABLE logs_2 PARTITION OF logs FOR VALUES WITH (MODULUS 4, REMAINDER 2);
CREATE TABLE logs_3 PARTITION OF logs FOR VALUES WITH (MODULUS 4, REMAINDER 3);
```

### Sub-partitioning

```sql
-- 연도별 Range → 지역별 List 서브 파티셔닝
CREATE TABLE sales (
    id BIGSERIAL,
    region TEXT NOT NULL,
    amount NUMERIC,
    sale_date DATE NOT NULL
) PARTITION BY RANGE (sale_date);

CREATE TABLE sales_2024 PARTITION OF sales
    FOR VALUES FROM ('2024-01-01') TO ('2025-01-01')
    PARTITION BY LIST (region);

CREATE TABLE sales_2024_asia PARTITION OF sales_2024
    FOR VALUES IN ('KR', 'JP', 'CN');
CREATE TABLE sales_2024_europe PARTITION OF sales_2024
    FOR VALUES IN ('DE', 'FR', 'GB');
CREATE TABLE sales_2024_default PARTITION OF sales_2024 DEFAULT;
```

### Partition Pruning

```sql
-- Partition Pruning: 쿼리 조건에 맞지 않는 파티션을 아예 스캔하지 않는다
EXPLAIN (ANALYZE)
SELECT * FROM events WHERE created_at >= '2024-02-01' AND created_at < '2024-03-01';
-- → events_2024_02 파티션만 스캔, 나머지 파티션은 pruned

-- 실행 시점 pruning 확인
SET enable_partition_pruning = on;  -- 기본값

-- 파티션 관리: 오래된 데이터 삭제 (DROP TABLE이 DELETE보다 훨씬 빠르다)
DROP TABLE events_2024_01;  -- 해당 월 데이터 즉시 삭제

-- 파티션 분리/연결
ALTER TABLE events DETACH PARTITION events_2024_01;      -- 독립 테이블로 분리
ALTER TABLE events ATTACH PARTITION events_2024_01       -- 다시 연결
    FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');

-- DETACH CONCURRENTLY (v14+, 잠금 최소화)
ALTER TABLE events DETACH PARTITION events_2024_01 CONCURRENTLY;
```

### 파티셔닝 주의사항

```
파티셔닝의 장점:
  ✓ 쿼리 성능: partition pruning으로 스캔 범위 축소
  ✓ 유지보수: 파티션 단위 VACUUM, 인덱스 재구성
  ✓ 데이터 관리: DROP PARTITION으로 대량 삭제
  ✓ 병렬 처리: 파티션별 병렬 스캔

파티셔닝의 단점:
  ✗ 파티션 키가 포함되지 않은 쿼리는 모든 파티션 스캔
  ✗ Cross-partition UPDATE (파티션 키 변경)는 DELETE + INSERT
  ✗ Unique constraint는 파티션 키를 포함해야 한다
  ✗ Foreign key 참조에 제약이 있다 (v12+ 일부 지원)
  ✗ 너무 많은 파티션(수백 개 이상)은 planning 비용 증가
```

---

## Connection Pooling

### 왜 필요한가?

PostgreSQL은 연결당 하나의 프로세스를 fork한다. 각 프로세스는 약 5~10MB의 메모리를 소비하므로, 수백 개의 동시 연결이 생기면 메모리와 컨텍스트 스위칭 비용이 급격히 증가한다. Connection Pooler는 소수의 실제 연결을 유지하고, 애플리케이션 연결을 이 풀에 다중화(multiplexing)한다.

### PgBouncer 모드

```
┌──────────────────────────────────────────────────────────────┐
│  Application (수백 개 연결)                                   │
│       │                                                      │
│       ▼                                                      │
│  ┌──────────┐                                                │
│  │PgBouncer │  ← 연결 다중화                                  │
│  └────┬─────┘                                                │
│       │ (소수의 실제 연결)                                     │
│       ▼                                                      │
│  ┌──────────┐                                                │
│  │PostgreSQL│                                                │
│  └──────────┘                                                │
└──────────────────────────────────────────────────────────────┘
```

| 모드 | 동작 | 적합한 경우 |
|------|------|------------|
| **Session** | 클라이언트가 연결을 끊을 때까지 서버 연결을 점유한다 | 세션 변수, PREPARE를 사용하는 경우 |
| **Transaction** | 트랜잭션이 끝나면 서버 연결을 풀에 반환한다 | 대부분의 웹 애플리케이션에 적합하다 |
| **Statement** | 각 SQL 문장 실행 후 서버 연결을 반환한다 | 단순 쿼리만 실행하는 경우 (다중 문장 트랜잭션 불가) |

### PgBouncer 설정 상세

```ini
# pgbouncer.ini 주요 설정

[databases]
demo = host=localhost port=5432 dbname=demo

[pgbouncer]
listen_addr = 0.0.0.0
listen_port = 6432
auth_type = scram-sha-256
auth_file = /etc/pgbouncer/userlist.txt

pool_mode = transaction

# 연결 제한
max_client_conn = 400         # 최대 클라이언트 연결 수
default_pool_size = 20        # 데이터베이스당 서버 연결 수
min_pool_size = 5             # 최소 유지 서버 연결 수
reserve_pool_size = 5         # 초과 시 사용할 예비 연결
reserve_pool_timeout = 3      # 예비 풀 사용 대기 시간(초)

# 타임아웃
server_idle_timeout = 600     # 유휴 서버 연결 해제 시간(초)
client_idle_timeout = 0       # 유휴 클라이언트 연결 해제 (0=비활성화)
query_timeout = 0             # 쿼리 타임아웃 (0=비활성화)
query_wait_timeout = 120      # 서버 연결 대기 타임아웃(초)

# 로깅
log_connections = 1
log_disconnections = 1
log_pooler_errors = 1
stats_period = 60
```

```sql
-- PgBouncer 관리 콘솔 접속
-- psql -h localhost -p 6432 -U pgbouncer pgbouncer

-- 연결 풀 현황
SHOW POOLS;

-- 활성 연결 목록
SHOW CLIENTS;
SHOW SERVERS;

-- 통계
SHOW STATS;

-- 설정 리로드
RELOAD;
```

---

## Replication

### Streaming Replication

Primary 서버의 WAL 변경 사항을 Standby 서버로 실시간 전송하는 방식이다. 물리적 복제(physical replication)로 바이트 단위의 정확한 복사본을 유지한다.

```
┌───────────┐  WAL stream  ┌───────────┐
│  Primary  │─────────────►│  Standby  │  (Hot Standby: 읽기 전용 쿼리 가능)
│           │              │           │
│  (R/W)    │  replication │  (R/O)    │
│           │  slot 관리    │           │
└───────────┘              └───────────┘
```

| 옵션 | 설명 |
|------|------|
| **Asynchronous** (기본) | Primary는 WAL 전송 확인을 기다리지 않는다. 성능이 좋지만 failover 시 데이터 유실 가능하다 |
| **Synchronous** | 최소 하나의 Standby에서 WAL 기록을 확인한 후 COMMIT을 완료한다. 데이터 유실이 없지만 지연이 발생한다 |

#### Streaming Replication 설정 상세

```
# Primary 서버 설정 (postgresql.conf)
wal_level = replica
max_wal_senders = 10              # WAL sender 프로세스 최대 수
wal_keep_size = 1GB               # 보관할 WAL 최소 크기 (v13+)
hot_standby = on                   # Standby에서 읽기 쿼리 허용

# Primary 서버 인증 (pg_hba.conf)
host  replication  replicator  10.0.0.0/8  scram-sha-256

# Standby 서버 설정 (postgresql.conf)
primary_conninfo = 'host=primary-host port=5432 user=replicator password=xxx'
primary_slot_name = 'standby1_slot'
hot_standby = on
hot_standby_feedback = on         # Standby의 쿼리가 Primary의 VACUUM을 지연

# Standby 서버 시그널 파일
# touch $PGDATA/standby.signal    (v12+)
```

#### Synchronous Replication 설정

```sql
-- Primary에서 synchronous standby 설정
-- postgresql.conf:
-- synchronous_standby_names = 'FIRST 1 (standby1, standby2)'
-- 또는 ANY 모드:
-- synchronous_standby_names = 'ANY 1 (standby1, standby2, standby3)'

-- FIRST N: 목록 순서대로 N개의 standby에서 확인
-- ANY N: 목록 중 아무 N개의 standby에서 확인

-- synchronous_commit 레벨:
-- remote_write: standby의 OS buffer에 기록 확인
-- on (with sync standby): standby의 WAL에 fsync 확인
-- remote_apply: standby에서 replay까지 확인
```

### Logical Replication

테이블 단위로 변경 사항을 복제하는 방식이다. 다른 PostgreSQL 버전 간, 선택적 테이블 복제가 가능하다.

```sql
-- Publisher (Primary)에서:
CREATE PUBLICATION my_pub FOR TABLE users, orders;

-- Subscriber (Standby)에서:
CREATE SUBSCRIPTION my_sub
  CONNECTION 'host=primary dbname=mydb'
  PUBLICATION my_pub;
```

#### Logical Replication 상세

```sql
-- Publication 관리
CREATE PUBLICATION my_pub FOR ALL TABLES;             -- 모든 테이블
CREATE PUBLICATION my_pub FOR TABLE users, orders;     -- 특정 테이블만
CREATE PUBLICATION my_pub FOR TABLE users              -- 특정 컬럼만 (v15+)
    (id, name, email);
CREATE PUBLICATION my_pub FOR TABLES IN SCHEMA public; -- 스키마 전체 (v15+)

-- 조건부 필터링 (v15+)
CREATE PUBLICATION my_pub FOR TABLE orders
    WHERE (status = 'completed');  -- 완료된 주문만 복제

-- Subscription 관리
CREATE SUBSCRIPTION my_sub
    CONNECTION 'host=primary dbname=demo user=demo password=demo123'
    PUBLICATION my_pub
    WITH (
        copy_data = true,           -- 초기 데이터 복사
        create_slot = true,         -- 복제 슬롯 자동 생성
        enabled = true,             -- 구독 활성화
        synchronous_commit = 'off', -- 비동기 커밋
        binary = true               -- 바이너리 전송 (v14+, 성능 향상)
    );

-- Subscription 상태 확인
SELECT * FROM pg_stat_subscription;

-- 복제 지연 확인
SELECT slot_name, confirmed_flush_lsn,
       pg_current_wal_lsn() - confirmed_flush_lsn AS lag_bytes
FROM pg_replication_slots
WHERE slot_type = 'logical';
```

#### Streaming vs Logical Replication 비교

| 항목 | Streaming (Physical) | Logical |
|------|---------------------|---------|
| 복제 단위 | 전체 클러스터 | 테이블/스키마 선택적 |
| 데이터 형태 | 바이트 단위 동일 | 논리적 변경 사항 |
| 버전 호환 | 동일 메이저 버전 필수 | 다른 버전 간 가능 |
| DDL 복제 | 자동 | 수동 적용 필요 |
| Standby 쓰기 | 불가 (읽기 전용) | 가능 (독립적 쓰기) |
| 용도 | HA, 읽기 확장 | 데이터 통합, CDC, 부분 복제 |

### Replication Slot

Standby가 아직 수신하지 않은 WAL 세그먼트가 삭제되지 않도록 보장하는 메커니즘이다. Standby가 장기간 다운되면 WAL이 축적되어 디스크가 가득 찰 수 있으므로 모니터링이 필수이다.

```sql
-- 복제 슬롯 현황 확인
SELECT slot_name, active, restart_lsn, confirmed_flush_lsn
FROM pg_replication_slots;

-- 비활성 슬롯이 WAL을 얼마나 보유하고 있는지 확인
SELECT slot_name, active,
       pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn) AS retained_bytes,
       pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) AS retained_size
FROM pg_replication_slots
WHERE NOT active;

-- 비활성 슬롯 삭제 (WAL 축적 방지)
SELECT pg_drop_replication_slot('unused_slot');

-- max_slot_wal_keep_size (v13+): 슬롯당 보관할 최대 WAL 크기
-- 이 크기 초과 시 슬롯이 무효화됨 (데이터 유실 가능)
```

### pg_basebackup

Streaming Replication Standby를 구성하거나 물리 백업을 생성할 때 사용하는 도구이다.

```bash
pg_basebackup -h primary-host -D /var/lib/postgresql/data -U replicator -Fp -Xs -P
```

```bash
# pg_basebackup 주요 옵션
pg_basebackup \
  -h primary-host \
  -p 5432 \
  -U replicator \
  -D /backup/base \        # 대상 디렉터리
  -Fp \                     # plain 포맷 (디렉터리)
  -Ft \                     # tar 포맷
  -Xs \                     # WAL을 streaming으로 포함
  -P \                      # 진행률 표시
  -c fast \                 # 빠른 checkpoint
  -z \                      # gzip 압축 (tar 포맷 시)
  --wal-method=stream \     # WAL 수집 방법
  -R                        # standby.signal 자동 생성 + primary_conninfo 설정
```

---

