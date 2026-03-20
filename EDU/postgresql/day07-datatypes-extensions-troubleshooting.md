# Day 7: 데이터 타입, 확장, 트러블슈팅

> JSONB/Array/Range 등 고급 데이터 타입, pg_stat_statements/pgvector/PostGIS/TimescaleDB/pg_cron 확장, Lock Contention/Bloat/Slow Query/Connection Exhaustion/Replication Lag 트러블슈팅을 학습한다.

---

## 주요 데이터 타입

### JSONB

바이너리 JSON이다. 파싱된 형태로 저장하므로 입력 시 약간의 오버헤드가 있지만, 처리 속도가 빠르고 인덱싱이 가능하다.

```sql
-- JSONB 컬럼 생성
CREATE TABLE events (
    id SERIAL PRIMARY KEY,
    data JSONB NOT NULL
);

-- 데이터 삽입
INSERT INTO events (data) VALUES ('{"type": "click", "page": "/home", "meta": {"browser": "Chrome"}}');

-- 연산자 사용
SELECT data->>'type' AS event_type FROM events;          -- 텍스트 추출
SELECT data->'meta'->>'browser' FROM events;             -- 중첩 접근
SELECT * FROM events WHERE data @> '{"type": "click"}';  -- 포함 관계 확인

-- GIN 인덱스로 JSONB 쿼리 가속
CREATE INDEX idx_events_data ON events USING gin(data jsonb_path_ops);
```

#### JSONB 연산자 전체 가이드

```sql
-- 추출 연산자
SELECT data -> 'type'     FROM events;  -- JSONB 값 반환: "click"
SELECT data ->> 'type'    FROM events;  -- TEXT 값 반환: click
SELECT data -> 'meta' -> 'browser' FROM events;  -- 중첩 JSONB
SELECT data #> '{meta,browser}' FROM events;     -- 경로로 JSONB 추출
SELECT data #>> '{meta,browser}' FROM events;    -- 경로로 TEXT 추출

-- 포함/존재 연산자
SELECT * FROM events WHERE data @> '{"type":"click"}';      -- 포함 관계
SELECT * FROM events WHERE data ? 'type';                    -- 키 존재
SELECT * FROM events WHERE data ?| array['type','page'];    -- 하나 이상 존재
SELECT * FROM events WHERE data ?& array['type','page'];    -- 모두 존재

-- JSON Path (v12+)
SELECT * FROM events
WHERE data @? '$.meta.browser ? (@ == "Chrome")';

SELECT jsonb_path_query(data, '$.meta.*') FROM events;

-- JSONB 수정
UPDATE events SET data = data || '{"priority": "high"}';         -- 병합
UPDATE events SET data = data - 'priority';                       -- 키 삭제
UPDATE events SET data = data #- '{meta,browser}';               -- 중첩 키 삭제
UPDATE events SET data = jsonb_set(data, '{meta,os}', '"Linux"'); -- 중첩 값 설정

-- JSONB 집계
SELECT jsonb_agg(data) FROM events;
SELECT jsonb_object_agg(data->>'type', data->'meta') FROM events;

-- JSONB → 행 변환
SELECT id, key, value
FROM events, jsonb_each(data);

SELECT id, key, value
FROM events, jsonb_each_text(data);
```

#### JSONB Generated Columns (v12+)

```sql
-- JSONB 필드를 일반 컬럼으로 추출 (인덱싱, 제약조건에 유용)
CREATE TABLE events_v2 (
    id SERIAL PRIMARY KEY,
    data JSONB NOT NULL,
    event_type TEXT GENERATED ALWAYS AS (data->>'type') STORED,
    created_at TIMESTAMP GENERATED ALWAYS AS ((data->>'timestamp')::timestamp) STORED
);

-- generated column에 일반 B-tree 인덱스 사용 가능
CREATE INDEX idx_events_v2_type ON events_v2(event_type);
```

### Array 타입

```sql
CREATE TABLE products (
    id SERIAL PRIMARY KEY,
    name TEXT,
    tags TEXT[]  -- 문자열 배열
);

INSERT INTO products (name, tags) VALUES ('Widget', ARRAY['sale', 'featured']);
SELECT * FROM products WHERE 'sale' = ANY(tags);
```

### Range 타입

```sql
-- 날짜 범위: 예약 시스템에서 겹침 검사
CREATE TABLE reservations (
    id SERIAL PRIMARY KEY,
    room_id INTEGER,
    during TSRANGE,
    EXCLUDE USING gist (room_id WITH =, during WITH &&)  -- 겹침 방지 제약
);
```

### 기타 유용한 타입

| 타입 | 용도 |
|------|------|
| `UUID` | 분산 시스템에서 고유 식별자로 사용한다. `gen_random_uuid()` 함수로 생성한다 |
| `inet` / `cidr` | IP 주소와 네트워크를 저장하며, 서브넷 포함 관계 연산을 지원한다 |
| `tsvector` / `tsquery` | 전문 검색(full-text search)을 위한 타입이다 |
| `interval` | 시간 간격을 표현한다. `'3 days 4 hours'::interval` 처럼 사용한다 |

---

## 확장 (Extensions)

### pg_stat_statements

실행된 모든 SQL 문의 통계를 수집하는 확장이다. 성능 분석의 핵심 도구이다.

```sql
-- 활성화 (postgresql.conf에 추가 후 재시작)
-- shared_preload_libraries = 'pg_stat_statements'

CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- 가장 느린 쿼리 Top 10
SELECT query,
       calls,
       total_exec_time / 1000 AS total_sec,
       mean_exec_time AS avg_ms,
       rows,
       shared_blks_hit,
       shared_blks_read,
       round(shared_blks_hit::numeric / NULLIF(shared_blks_hit + shared_blks_read, 0) * 100, 2) AS hit_ratio
FROM pg_stat_statements
WHERE calls > 10
ORDER BY mean_exec_time DESC
LIMIT 10;

-- 가장 많이 호출되는 쿼리 Top 10
SELECT query, calls, total_exec_time / 1000 AS total_sec, rows
FROM pg_stat_statements
ORDER BY calls DESC
LIMIT 10;

-- 가장 많은 I/O를 유발하는 쿼리
SELECT query, calls, shared_blks_read, shared_blks_written
FROM pg_stat_statements
ORDER BY shared_blks_read DESC
LIMIT 10;

-- 통계 초기화
SELECT pg_stat_statements_reset();
```

### pgvector

벡터 유사도 검색을 위한 확장이다. AI/ML 애플리케이션에서 embedding 벡터 검색에 사용한다.

```sql
CREATE EXTENSION IF NOT EXISTS vector;

-- 벡터 컬럼이 있는 테이블 생성
CREATE TABLE documents (
    id SERIAL PRIMARY KEY,
    content TEXT,
    embedding vector(1536)  -- OpenAI text-embedding-ada-002 차원
);

-- 벡터 삽입
INSERT INTO documents (content, embedding)
VALUES ('PostgreSQL is great', '[0.1, 0.2, ..., 0.3]'::vector);

-- 유사도 검색 (코사인 거리)
SELECT id, content, embedding <=> '[0.1, 0.2, ..., 0.3]'::vector AS distance
FROM documents
ORDER BY embedding <=> '[0.1, 0.2, ..., 0.3]'::vector
LIMIT 5;

-- IVFFlat 인덱스 (근사 최근접 이웃)
CREATE INDEX idx_documents_embedding ON documents
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- HNSW 인덱스 (더 나은 recall, v0.5.0+)
CREATE INDEX idx_documents_embedding_hnsw ON documents
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- 거리 함수:
-- <->  L2 distance (유클리드)
-- <=>  Cosine distance
-- <#>  Inner product (negative)
```

### PostGIS

공간 데이터(지리 정보) 처리를 위한 확장이다.

```sql
CREATE EXTENSION IF NOT EXISTS postgis;

-- 공간 테이블 생성
CREATE TABLE stores (
    id SERIAL PRIMARY KEY,
    name TEXT,
    location GEOMETRY(Point, 4326)  -- WGS 84 좌표계
);

-- 데이터 삽입 (서울시청 좌표)
INSERT INTO stores (name, location)
VALUES ('서울점', ST_SetSRID(ST_MakePoint(126.9780, 37.5665), 4326));

-- 반경 1km 내 매장 검색
SELECT name, ST_Distance(
    location::geography,
    ST_SetSRID(ST_MakePoint(126.9780, 37.5665), 4326)::geography
) AS distance_meters
FROM stores
WHERE ST_DWithin(
    location::geography,
    ST_SetSRID(ST_MakePoint(126.9780, 37.5665), 4326)::geography,
    1000  -- 1000미터 = 1km
)
ORDER BY distance_meters;

-- 공간 인덱스
CREATE INDEX idx_stores_location ON stores USING gist(location);
```

### TimescaleDB

시계열 데이터를 위한 확장이다. PostgreSQL의 자동 파티셔닝, 연속 집계, 데이터 보존 정책을 제공한다.

```sql
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- 일반 테이블을 hypertable로 변환
CREATE TABLE sensor_readings (
    time TIMESTAMPTZ NOT NULL,
    sensor_id INTEGER NOT NULL,
    temperature DOUBLE PRECISION,
    humidity DOUBLE PRECISION
);

SELECT create_hypertable('sensor_readings', 'time');

-- 자동으로 시간 기반 청크(파티션)가 생성된다

-- 연속 집계 (Continuous Aggregate)
CREATE MATERIALIZED VIEW sensor_hourly
WITH (timescaledb.continuous) AS
SELECT sensor_id,
       time_bucket('1 hour', time) AS hour,
       avg(temperature) AS avg_temp,
       max(temperature) AS max_temp
FROM sensor_readings
GROUP BY sensor_id, time_bucket('1 hour', time);

-- 데이터 보존 정책 (90일 이전 데이터 자동 삭제)
SELECT add_retention_policy('sensor_readings', INTERVAL '90 days');

-- 압축 정책 (7일 이전 데이터 자동 압축)
ALTER TABLE sensor_readings SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'sensor_id'
);
SELECT add_compression_policy('sensor_readings', INTERVAL '7 days');
```

### pg_cron

PostgreSQL 내에서 cron 스타일의 작업 스케줄링을 제공하는 확장이다.

```sql
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 매일 자정에 오래된 로그 삭제
SELECT cron.schedule('cleanup-logs', '0 0 * * *',
    $$DELETE FROM access_logs WHERE created_at < now() - interval '30 days'$$);

-- 매시간 통계 갱신
SELECT cron.schedule('hourly-analyze', '0 * * * *',
    $$ANALYZE$$);

-- 매주 일요일 VACUUM
SELECT cron.schedule('weekly-vacuum', '0 3 * * 0',
    $$VACUUM ANALYZE$$);

-- 5분마다 materialized view 갱신
SELECT cron.schedule('refresh-mv', '*/5 * * * *',
    $$REFRESH MATERIALIZED VIEW CONCURRENTLY my_summary$$);

-- 예약된 작업 확인
SELECT * FROM cron.job;

-- 작업 실행 이력 확인
SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 10;

-- 작업 삭제
SELECT cron.unschedule('cleanup-logs');
```

---

## 트러블슈팅

### Lock Contention

```sql
-- 현재 잠금 상태 확인
SELECT l.locktype, l.relation::regclass, l.mode, l.granted, l.pid,
       a.usename, a.query, a.state, a.wait_event
FROM pg_locks l
JOIN pg_stat_activity a ON l.pid = a.pid
WHERE l.relation IS NOT NULL
ORDER BY l.relation, l.mode;

-- 잠금 대기 체인 (누가 누구를 블로킹하는지)
SELECT
    blocked_locks.pid AS blocked_pid,
    blocked_activity.usename AS blocked_user,
    blocking_locks.pid AS blocking_pid,
    blocking_activity.usename AS blocking_user,
    blocked_activity.query AS blocked_query,
    blocking_activity.query AS blocking_query
FROM pg_catalog.pg_locks blocked_locks
JOIN pg_catalog.pg_stat_activity blocked_activity
    ON blocked_activity.pid = blocked_locks.pid
JOIN pg_catalog.pg_locks blocking_locks
    ON blocking_locks.locktype = blocked_locks.locktype
    AND blocking_locks.database IS NOT DISTINCT FROM blocked_locks.database
    AND blocking_locks.relation IS NOT DISTINCT FROM blocked_locks.relation
    AND blocking_locks.page IS NOT DISTINCT FROM blocked_locks.page
    AND blocking_locks.tuple IS NOT DISTINCT FROM blocked_locks.tuple
    AND blocking_locks.transactionid IS NOT DISTINCT FROM blocked_locks.transactionid
    AND blocking_locks.pid != blocked_locks.pid
JOIN pg_catalog.pg_stat_activity blocking_activity
    ON blocking_activity.pid = blocking_locks.pid
WHERE NOT blocked_locks.granted;

-- Advisory Lock 사용 (애플리케이션 레벨 잠금)
SELECT pg_advisory_lock(12345);       -- 세션 레벨 잠금
SELECT pg_advisory_xact_lock(12345);  -- 트랜잭션 레벨 잠금
SELECT pg_advisory_unlock(12345);     -- 세션 레벨 해제

-- 데드락 확인
-- log_lock_waits = on으로 설정하면 deadlock_timeout(기본 1초) 이상 대기 시 로그 기록
-- 데드락 발생 시 PostgreSQL이 자동으로 하나의 트랜잭션을 롤백한다
```

### Lock 타입 가이드

| Lock Mode | SELECT | INSERT | UPDATE | DELETE | ALTER | VACUUM |
|-----------|--------|--------|--------|--------|-------|--------|
| AccessShareLock | O | | | | | |
| RowShareLock | | | O (FOR UPDATE) | | | |
| RowExclusiveLock | | O | O | O | | |
| ShareUpdateExclusiveLock | | | | | | O |
| ShareLock | | | | | | |
| ShareRowExclusiveLock | | | | | | |
| ExclusiveLock | | | | | | |
| AccessExclusiveLock | | | | | O | |

```
잠금 호환성 (conflict 발생하는 조합):
AccessExclusiveLock은 모든 다른 잠금과 충돌한다
→ ALTER TABLE, DROP TABLE, VACUUM FULL, REINDEX

실전 팁:
- 마이그레이션 시 ALTER TABLE ... ADD COLUMN (NOT NULL/DEFAULT 포함)은 짧은 잠금
- CREATE INDEX CONCURRENTLY를 사용하여 잠금 최소화
- 대규모 UPDATE는 배치로 분할하여 잠금 시간 단축
```

### Bloat 해결

```sql
-- 테이블 bloat 해결 방법 3가지:

-- 1. VACUUM (일반적인 경우, 공간 재사용)
VACUUM VERBOSE large_table;

-- 2. VACUUM FULL (심각한 bloat, 서비스 중단 가능 시)
VACUUM FULL large_table;  -- AccessExclusiveLock 발생!

-- 3. pg_repack (온라인, 잠금 최소화)
-- pg_repack --table=large_table --dbname=demo
-- 내부적으로 테이블 복사 → 인덱스 재생성 → swap (짧은 잠금)

-- 인덱스 bloat 해결
REINDEX INDEX CONCURRENTLY idx_name;  -- v12+, 잠금 최소화
-- 또는
CREATE INDEX CONCURRENTLY idx_name_new ON table(col);
DROP INDEX idx_name;
ALTER INDEX idx_name_new RENAME TO idx_name;
```

### Slow Query 진단

```sql
-- 1단계: pg_stat_statements로 느린 쿼리 식별
SELECT query, calls, mean_exec_time, total_exec_time
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 20;

-- 2단계: EXPLAIN ANALYZE로 실행 계획 분석
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT ... ;  -- 느린 쿼리

-- 3단계: 문제 원인별 해결책
-- a) Seq Scan → Index Scan
--    → 적절한 인덱스 생성
-- b) Sort: external merge (Disk)
--    → work_mem 증가
-- c) Hash Join Batches > 1
--    → work_mem 증가 (해시 테이블이 메모리에 안 들어감)
-- d) Estimated rows와 Actual rows 차이 큼
--    → ANALYZE 실행, statistics target 증가
-- e) 많은 Buffers: shared read (디스크 I/O)
--    → shared_buffers 증가, 또는 쿼리 최적화

-- 느린 쿼리 로깅 설정
-- log_min_duration_statement = '1s'  (1초 이상 쿼리 기록)
-- auto_explain.log_min_duration = '1s'  (실행 계획 자동 기록)
```

### Connection Exhaustion

```sql
-- 연결 상태 요약
SELECT state, count(*)
FROM pg_stat_activity
GROUP BY state;

-- 데이터베이스별 연결 수
SELECT datname, count(*)
FROM pg_stat_activity
GROUP BY datname;

-- 사용자별 연결 수
SELECT usename, count(*)
FROM pg_stat_activity
GROUP BY usename;

-- max_connections 대비 현재 사용률
SELECT
    current_setting('max_connections')::int AS max_conn,
    count(*) AS current_conn,
    round(count(*)::numeric / current_setting('max_connections')::int * 100, 2) AS usage_pct
FROM pg_stat_activity;

-- 해결책:
-- 1. PgBouncer 도입 (connection pooling)
-- 2. idle_in_transaction_session_timeout 설정
-- 3. 애플리케이션의 연결 누수 수정
-- 4. 연결 수 제한 (per-user, per-database)
ALTER ROLE app_user CONNECTION LIMIT 20;
ALTER DATABASE demo CONNECTION LIMIT 50;
```

### Replication Lag

```sql
-- Primary에서 복제 지연 확인
SELECT client_addr, application_name,
       pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn) AS lag_bytes,
       pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn)) AS lag_size,
       replay_lag
FROM pg_stat_replication;

-- 복제 지연 원인과 해결:
-- 1. 네트워크 지연 → 네트워크 대역폭/지연시간 확인
-- 2. Standby I/O 부족 → Standby의 디스크 성능 확인
-- 3. 대규모 트랜잭션 → 장시간 실행 쿼리 분할
-- 4. 복구 충돌 → hot_standby_feedback = on, max_standby_streaming_delay 조정
-- 5. Standby의 장기 쿼리 → Standby 쿼리 타임아웃 설정

-- Standby에서 복제 충돌 확인
SELECT datname, confl_tablespace, confl_lock, confl_snapshot,
       confl_bufferpin, confl_deadlock
FROM pg_stat_database_conflicts;
```

### 일반적인 에러 메시지와 해결

```
1. "too many connections for role"
   → ALTER ROLE ... CONNECTION LIMIT 증가 또는 PgBouncer 사용

2. "could not extend file": No space left on device
   → 디스크 공간 확보, 불필요한 WAL/로그 삭제
   → 파티셔닝으로 오래된 데이터 DROP

3. "canceling statement due to conflict with recovery"
   → Standby에서 쿼리 실행 중 Primary의 VACUUM이 충돌
   → hot_standby_feedback = on
   → max_standby_streaming_delay 증가

4. "FATAL: the database system is in recovery mode"
   → crash recovery 진행 중, WAL 재생 완료까지 대기

5. "ERROR: deadlock detected"
   → 애플리케이션에서 트랜잭션 재시도 로직 구현
   → 트랜잭션 내 테이블/행 접근 순서 통일

6. "WARNING: oldest xmin is far in the past"
   → 장시간 실행 트랜잭션 또는 비활성 복제 슬롯 확인
   → 해당 트랜잭션 종료 또는 슬롯 삭제

7. "PANIC: could not write to file": pg_wal
   → WAL 디스크 공간 부족
   → 비활성 복제 슬롯 삭제, max_wal_size 조정
```

---
