# Day 6: 성능 튜닝, 보안, Backup/Recovery, HA, 모니터링

> 메모리/I/O 성능 튜닝, Roles/RLS/pg_hba.conf/SSL 보안 설정, pg_dump/pgBackRest/Barman 백업, Patroni HA, pg_stat_activity/pg_stat_statements 모니터링을 학습한다.

---

## 성능 튜닝

### 메모리 설정

| 파라미터 | 기본값 | 권장값 | 설명 |
|---------|--------|--------|------|
| `shared_buffers` | 128MB | RAM의 25% | 공유 버퍼 풀 크기. 가장 중요한 메모리 설정이다 |
| `effective_cache_size` | 4GB | RAM의 50~75% | OS 파일 캐시를 포함한 예상 가용 메모리. planner의 인덱스 사용 결정에 영향 |
| `work_mem` | 4MB | 16~256MB | 정렬/해시 작업당 메모리. 복잡한 쿼리에서 증가 필요 |
| `maintenance_work_mem` | 64MB | 512MB~1GB | VACUUM, CREATE INDEX 시 사용 메모리 |
| `temp_buffers` | 8MB | 필요시 증가 | 세션별 임시 테이블 버퍼 |
| `huge_pages` | try | on (Linux) | Linux Transparent Huge Pages 사용 |

```sql
-- tart-infra 프로젝트에서 메모리 설정 확인
-- kubectl exec -it -n demo deploy/postgres -- psql -U demo -d demo
SHOW shared_buffers;
SHOW effective_cache_size;
SHOW work_mem;
SHOW maintenance_work_mem;

-- work_mem 주의사항:
-- 쿼리당이 아니라 "작업당" 할당된다
-- 하나의 쿼리에서 여러 정렬/해시 작업이 있으면 각각 work_mem을 사용한다
-- max_connections × 동시 작업 수 × work_mem ≤ 가용 메모리
-- 예: 100 connections × 4 sorts × 64MB = 25.6GB

-- 세션 레벨에서 work_mem 조정 (복잡한 리포트 쿼리용)
SET work_mem = '256MB';
-- 복잡한 쿼리 실행...
RESET work_mem;
```

### 연결 관련 설정

```sql
SHOW max_connections;              -- 기본 100
-- max_connections을 과도하게 높이면:
-- 1. 프로세스당 메모리 소비 (5~10MB × N)
-- 2. 컨텍스트 스위칭 오버헤드
-- 3. 잠금 경합 증가
-- → PgBouncer 등 connection pooler 사용이 권장된다

-- 효율적인 연결 관리 공식:
-- max_connections = (CPU 코어 수 × 2) + effective_io_concurrency
-- 예: 4코어 서버 → max_connections = 10~20 (PgBouncer 뒤에서)
```

### I/O 관련 설정

```sql
SHOW effective_io_concurrency;    -- 기본 1 (SSD: 200 권장)
SHOW random_page_cost;            -- 기본 4.0 (SSD: 1.1 권장)
SHOW seq_page_cost;               -- 기본 1.0

-- checkpoint 관련
SHOW checkpoint_timeout;           -- 기본 5min
SHOW checkpoint_completion_target; -- 기본 0.9
SHOW max_wal_size;                 -- 기본 1GB

-- WAL 관련
SHOW wal_compression;              -- 기본 off (v15+ on 권장)
SHOW wal_buffers;                  -- 기본 -1 (자동)
```

### 성능 튜닝 체크리스트

```
[ 기본 설정 ]
□ shared_buffers = RAM의 25%
□ effective_cache_size = RAM의 50~75%
□ work_mem = 세션 워크로드에 맞게 조정
□ maintenance_work_mem = 512MB~1GB
□ random_page_cost = 1.1 (SSD 사용 시)
□ effective_io_concurrency = 200 (SSD 사용 시)

[ WAL/Checkpoint ]
□ wal_compression = on
□ checkpoint_timeout = 15min (쓰기 빈번한 경우)
□ max_wal_size = 4GB~8GB (쓰기 빈번한 경우)
□ checkpoint_completion_target = 0.9

[ Autovacuum ]
□ autovacuum = on (절대 끄지 말 것)
□ autovacuum_max_workers = CPU 코어 수에 맞게
□ 대규모 테이블에 개별 autovacuum 설정
□ log_autovacuum_min_duration = 0 (모니터링용)

[ 연결 ]
□ PgBouncer 등 connection pooler 사용
□ max_connections = 필요 최소값
□ idle_in_transaction_session_timeout = '30s'

[ 쿼리 ]
□ pg_stat_statements 활성화
□ slow query 로깅: log_min_duration_statement = '1s'
□ 주기적 ANALYZE 확인
```

---

## 보안

### Roles과 Privileges

PostgreSQL은 사용자와 그룹을 모두 **role**로 통합 관리한다.

```sql
-- 역할 생성
CREATE ROLE app_readonly LOGIN PASSWORD 'secure_password';
CREATE ROLE app_readwrite LOGIN PASSWORD 'secure_password';

-- 권한 부여
GRANT CONNECT ON DATABASE mydb TO app_readonly;
GRANT USAGE ON SCHEMA public TO app_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_readonly;

GRANT CONNECT ON DATABASE mydb TO app_readwrite;
GRANT USAGE ON SCHEMA public TO app_readwrite;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_readwrite;

-- 향후 생성되는 테이블에도 권한 적용
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO app_readonly;
```

### Row-Level Security (RLS)

행 단위로 접근을 제어하는 기능이다. 멀티테넌트 애플리케이션에서 테넌트 간 데이터 격리에 유용하다.

```sql
-- RLS 활성화
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- 정책 생성: 각 사용자는 자신의 주문만 볼 수 있다
CREATE POLICY user_orders ON orders
    USING (user_id = current_setting('app.current_user_id')::INTEGER);

-- 애플리케이션에서 사용자 ID 설정 후 쿼리
SET app.current_user_id = '1';
SELECT * FROM orders;  -- user_id = 1인 행만 반환된다
```

#### RLS 정책 상세

```sql
-- RLS 정책은 SELECT(USING), INSERT/UPDATE/DELETE(WITH CHECK)를 구분한다

-- SELECT/UPDATE/DELETE 제한
CREATE POLICY user_select ON orders
    FOR SELECT
    USING (user_id = current_setting('app.current_user_id')::INTEGER);

-- INSERT 제한 (자신의 user_id만 삽입 가능)
CREATE POLICY user_insert ON orders
    FOR INSERT
    WITH CHECK (user_id = current_setting('app.current_user_id')::INTEGER);

-- UPDATE: USING(기존 행 필터) + WITH CHECK(새 값 검증)
CREATE POLICY user_update ON orders
    FOR UPDATE
    USING (user_id = current_setting('app.current_user_id')::INTEGER)
    WITH CHECK (user_id = current_setting('app.current_user_id')::INTEGER);

-- 관리자는 모든 행에 접근 가능
CREATE POLICY admin_all ON orders
    FOR ALL
    TO admin_role
    USING (true)
    WITH CHECK (true);

-- 테이블 소유자도 RLS에 적용되도록 설정
ALTER TABLE orders FORCE ROW LEVEL SECURITY;
```

### pg_hba.conf

클라이언트 인증을 제어하는 파일이다. 접속 소스, 데이터베이스, 사용자별로 인증 방식을 지정한다.

```
# TYPE  DATABASE  USER       ADDRESS         METHOD
local   all       postgres                   peer
host    all       all        127.0.0.1/32    scram-sha-256
host    all       all        10.0.0.0/8      scram-sha-256
host    all       all        0.0.0.0/0       reject
```

| 인증 방식 | 설명 |
|-----------|------|
| `peer` | OS 사용자명과 DB 사용자명이 일치하면 허용한다 (local 연결만) |
| `scram-sha-256` | 비밀번호 기반 인증이다. `md5`보다 안전하다 |
| `cert` | SSL 클라이언트 인증서를 검증한다 |
| `reject` | 연결을 거부한다 |

### SCRAM-SHA-256 vs MD5

```sql
-- 기본 인증 방식 확인
SHOW password_encryption;  -- scram-sha-256 (v14+ 기본)

-- md5에서 scram-sha-256으로 마이그레이션
ALTER SYSTEM SET password_encryption = 'scram-sha-256';
SELECT pg_reload_conf();

-- 기존 사용자의 비밀번호 재설정 (scram-sha-256으로 재해싱)
ALTER USER demo PASSWORD 'demo123';

-- pg_hba.conf에서도 md5 → scram-sha-256으로 변경
-- 주의: scram-sha-256으로 변경하면 md5 비밀번호로 저장된 사용자는 로그인 불가
```

### SSL/TLS 설정

```sql
-- SSL 상태 확인
SHOW ssl;                   -- on/off
SHOW ssl_cert_file;         -- 서버 인증서 경로
SHOW ssl_key_file;          -- 서버 개인키 경로
SHOW ssl_ca_file;           -- CA 인증서 경로

-- 현재 연결의 SSL 정보 확인
SELECT ssl, version, cipher, bits
FROM pg_stat_ssl
JOIN pg_stat_activity ON pg_stat_ssl.pid = pg_stat_activity.pid
WHERE pg_stat_activity.usename = current_user;
```

```
# SSL 강제 적용 (pg_hba.conf)
# TYPE  DATABASE  USER  ADDRESS       METHOD
hostssl all       all   0.0.0.0/0     scram-sha-256
hostnossl all     all   0.0.0.0/0     reject
```

### Column-Level Permissions

```sql
-- 특정 컬럼에만 권한 부여 (민감 정보 보호)
GRANT SELECT (id, name, email) ON users TO app_readonly;
-- 비밀번호 해시, 주민번호 등 민감 컬럼은 제외

-- 컬럼별 UPDATE 제한
GRANT UPDATE (name, email) ON users TO app_readwrite;
-- id, created_at 등은 수정 불가
```

### Audit Logging

```sql
-- 기본 로깅 설정
ALTER SYSTEM SET log_statement = 'all';        -- none, ddl, mod, all
ALTER SYSTEM SET log_connections = on;
ALTER SYSTEM SET log_disconnections = on;
ALTER SYSTEM SET log_duration = on;
ALTER SYSTEM SET log_line_prefix = '%t [%p]: user=%u,db=%d,app=%a ';

-- pgAudit 확장 (상세 감사 로깅)
-- CREATE EXTENSION pgaudit;
-- ALTER SYSTEM SET pgaudit.log = 'write, ddl';
-- ALTER SYSTEM SET pgaudit.log_catalog = off;
-- ALTER SYSTEM SET pgaudit.log_relation = on;
```

---

## Backup & Recovery

### pg_dump / pg_restore

```bash
# tart-infra 프로젝트에서 백업/복원
export KUBECONFIG=kubeconfig/dev.yaml

# 논리 백업 (SQL 형식)
kubectl exec -n demo deploy/postgres -- pg_dump -U demo demo > backup.sql

# 논리 백업 (custom 형식 - 병렬 복원 가능, 압축)
kubectl exec -n demo deploy/postgres -- pg_dump -U demo -Fc demo > backup.dump

# 논리 백업 (directory 형식 - 병렬 백업/복원)
kubectl exec -n demo deploy/postgres -- pg_dump -U demo -Fd -j4 -f /tmp/backup_dir demo

# 특정 테이블만 백업
kubectl exec -n demo deploy/postgres -- pg_dump -U demo -t users demo > users_backup.sql

# 스키마만 백업 (데이터 제외)
kubectl exec -n demo deploy/postgres -- pg_dump -U demo --schema-only demo > schema.sql

# 데이터만 백업 (스키마 제외)
kubectl exec -n demo deploy/postgres -- pg_dump -U demo --data-only demo > data.sql

# SQL 형식 복원
cat backup.sql | kubectl exec -i -n demo deploy/postgres -- psql -U demo demo

# Custom 형식 복원 (병렬)
kubectl exec -i -n demo deploy/postgres -- pg_restore -U demo -d demo -j4 < backup.dump

# 전체 클러스터 백업 (모든 데이터베이스, 역할, 테이블스페이스)
kubectl exec -n demo deploy/postgres -- pg_dumpall -U demo > full_backup.sql
```

### pg_basebackup과 PITR

```bash
# 물리 백업 (Streaming Replication 기반)
pg_basebackup -h primary-host -D /backup/base -U replicator \
  -Fp -Xs -P -c fast

# 압축된 tar 백업
pg_basebackup -h primary-host -D /backup/base -U replicator \
  -Ft -Xs -P -z

# PITR 복원 (상세 절차는 WAL 섹션 참조)
```

### pgBackRest

프로덕션 환경에서 가장 널리 사용되는 백업 도구이다.

```ini
# /etc/pgbackrest/pgbackrest.conf

[global]
repo1-path=/backup/pgbackrest
repo1-retention-full=2
repo1-retention-diff=7
repo1-cipher-type=aes-256-cbc
repo1-cipher-pass=encryption_key

# S3 저장소 사용
# repo1-type=s3
# repo1-s3-endpoint=s3.amazonaws.com
# repo1-s3-bucket=my-pg-backups
# repo1-s3-region=ap-northeast-2

process-max=4
compress-type=zst
compress-level=3

[demo]
pg1-path=/var/lib/postgresql/data
pg1-port=5432
pg1-user=demo
```

```bash
# pgBackRest 백업 명령
pgbackrest --stanza=demo stanza-create     # 초기 설정
pgbackrest --stanza=demo backup --type=full # 전체 백업
pgbackrest --stanza=demo backup --type=diff # 차등 백업
pgbackrest --stanza=demo backup --type=incr # 증분 백업

# 백업 목록 확인
pgbackrest --stanza=demo info

# PITR 복원
pgbackrest --stanza=demo restore \
  --type=time \
  --target="2024-06-15 14:30:00" \
  --target-action=promote

# 특정 데이터베이스만 복원
pgbackrest --stanza=demo restore \
  --db-include=demo

# 검증
pgbackrest --stanza=demo check
```

### Barman

PostgreSQL 백업 관리 도구로, 원격 서버의 백업과 복원을 관리한다.

```ini
# /etc/barman.conf
[barman]
barman_home = /var/lib/barman
configuration_files_directory = /etc/barman.d

[demo-server]
description = "Demo PostgreSQL Server"
conninfo = host=postgres-host user=barman dbname=demo
backup_method = postgres
streaming_conninfo = host=postgres-host user=streaming_barman
streaming_archiver = on
slot_name = barman
retention_policy = RECOVERY WINDOW OF 7 DAYS
```

```bash
# Barman 백업 실행
barman backup demo-server
barman list-backup demo-server

# PITR 복원
barman recover demo-server 20240615T120000 /var/lib/postgresql/data \
  --target-time "2024-06-15 14:30:00"
```

---

## 고가용성 (High Availability)

### Patroni

Patroni는 분산 합의(DCS: etcd, Consul, ZooKeeper)를 사용하여 PostgreSQL 클러스터의 자동 failover를 관리하는 HA 솔루션이다.

```
┌────────────────────────────────────────────────────────────┐
│                     Patroni HA 클러스터                      │
│                                                             │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐  │
│  │ Node 1        │  │ Node 2        │  │ Node 3        │  │
│  │ ┌──────────┐  │  │ ┌──────────┐  │  │ ┌──────────┐  │  │
│  │ │PostgreSQL│  │  │ │PostgreSQL│  │  │ │PostgreSQL│  │  │
│  │ │ (Primary)│  │  │ │ (Replica)│  │  │ │ (Replica)│  │  │
│  │ └──────────┘  │  │ └──────────┘  │  │ └──────────┘  │  │
│  │ ┌──────────┐  │  │ ┌──────────┐  │  │ ┌──────────┐  │  │
│  │ │ Patroni  │  │  │ │ Patroni  │  │  │ │ Patroni  │  │  │
│  │ └──────────┘  │  │ └──────────┘  │  │ └──────────┘  │  │
│  └───────┬───────┘  └───────┬───────┘  └───────┬───────┘  │
│          │                  │                  │           │
│          └──────────┬───────┴──────────────────┘           │
│                     │                                      │
│              ┌──────┴──────┐                               │
│              │   DCS       │                               │
│              │ (etcd/      │                               │
│              │  Consul)    │                               │
│              └─────────────┘                               │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ HAProxy / PgBouncer                                   │  │
│  │  - Primary (R/W): 포트 5432                           │  │
│  │  - Replica (R/O): 포트 5433                           │  │
│  │  - Patroni REST API로 health check                    │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
```

```yaml
# Patroni 설정 예시 (patroni.yml)
scope: demo-cluster
name: node1

restapi:
  listen: 0.0.0.0:8008
  connect_address: node1:8008

etcd3:
  hosts: etcd1:2379,etcd2:2379,etcd3:2379

bootstrap:
  dcs:
    ttl: 30
    loop_wait: 10
    retry_timeout: 10
    maximum_lag_on_failover: 1048576   # 1MB
    postgresql:
      use_pg_rewind: true
      parameters:
        max_connections: 100
        shared_buffers: 256MB
        wal_level: replica
        max_wal_senders: 5
        max_replication_slots: 5
        hot_standby: on

postgresql:
  listen: 0.0.0.0:5432
  connect_address: node1:5432
  data_dir: /var/lib/postgresql/data
  authentication:
    replication:
      username: replicator
      password: rep-pass
    superuser:
      username: postgres
      password: postgres-pass
```

```bash
# Patroni 클러스터 상태 확인
patronictl -c /etc/patroni/patroni.yml list

# 수동 switchover (계획된 유지보수)
patronictl -c /etc/patroni/patroni.yml switchover --master node1 --candidate node2

# 수동 failover (강제)
patronictl -c /etc/patroni/patroni.yml failover

# Patroni REST API
curl -s http://node1:8008/health | jq .
curl -s http://node1:8008/cluster | jq .
```

### pg_auto_failover

Citus에서 개발한 PostgreSQL 자동 failover 확장이다. DCS 없이 monitor 노드로 failover를 관리한다.

```bash
# Monitor 노드 설정
pg_autoctl create monitor \
  --pgdata /var/lib/postgresql/monitor \
  --pgport 5432 \
  --hostname monitor-host

# Primary 노드 설정
pg_autoctl create postgres \
  --pgdata /var/lib/postgresql/data \
  --pgport 5432 \
  --hostname node1 \
  --monitor postgresql://autoctl@monitor-host:5432/pg_auto_failover

# Secondary 노드 설정
pg_autoctl create postgres \
  --pgdata /var/lib/postgresql/data \
  --pgport 5432 \
  --hostname node2 \
  --monitor postgresql://autoctl@monitor-host:5432/pg_auto_failover

# 클러스터 상태 확인
pg_autoctl show state
```

### Health Check 패턴

```sql
-- 기본 health check 쿼리
SELECT 1;

-- 상세 health check
SELECT
    pg_is_in_recovery() AS is_standby,         -- false = primary
    pg_postmaster_start_time() AS started_at,
    now() - pg_postmaster_start_time() AS uptime,
    (SELECT count(*) FROM pg_stat_activity WHERE state = 'active') AS active_connections,
    CASE WHEN pg_is_in_recovery()
         THEN pg_last_wal_receive_lsn()
         ELSE pg_current_wal_lsn()
    END AS current_lsn;

-- Patroni health check endpoint
-- GET /primary → 200 (primary) / 503 (not primary)
-- GET /replica → 200 (replica) / 503 (not replica)
-- GET /health  → 200 (healthy) / 503 (unhealthy)
```

---

## 모니터링

### pg_stat_activity

```sql
-- 현재 활성 연결과 쿼리
SELECT pid, usename, datname, client_addr, state,
       wait_event_type, wait_event,
       query_start, now() - query_start AS duration,
       left(query, 100) AS query
FROM pg_stat_activity
WHERE state != 'idle'
ORDER BY query_start;

-- 오래 실행 중인 쿼리 (1분 이상)
SELECT pid, usename, query_start, now() - query_start AS duration, query
FROM pg_stat_activity
WHERE state = 'active'
  AND now() - query_start > interval '1 minute'
ORDER BY query_start;

-- 오래된 idle-in-transaction 세션 (잠금 유지 가능)
SELECT pid, usename, state, query_start, now() - state_change AS idle_duration
FROM pg_stat_activity
WHERE state = 'idle in transaction'
  AND now() - state_change > interval '5 minutes';

-- 문제 쿼리 강제 종료
SELECT pg_cancel_backend(pid);     -- 쿼리만 취소 (graceful)
SELECT pg_terminate_backend(pid);  -- 연결 종료 (forceful)
```

### pg_stat_user_tables

```sql
-- 테이블별 I/O 및 VACUUM 통계
SELECT relname,
       seq_scan, seq_tup_read,
       idx_scan, idx_tup_fetch,
       n_tup_ins, n_tup_upd, n_tup_del,
       n_live_tup, n_dead_tup,
       last_vacuum, last_autovacuum,
       last_analyze, last_autoanalyze
FROM pg_stat_user_tables
ORDER BY n_dead_tup DESC;

-- Seq Scan 비율이 높은 테이블 (인덱스 필요 가능)
SELECT relname,
       seq_scan, idx_scan,
       CASE WHEN seq_scan + idx_scan > 0
            THEN round(seq_scan::numeric / (seq_scan + idx_scan) * 100, 2)
            ELSE 0
       END AS seq_ratio,
       pg_size_pretty(pg_total_relation_size(relid)) AS total_size
FROM pg_stat_user_tables
WHERE seq_scan + idx_scan > 100
ORDER BY seq_ratio DESC;
```

### pg_stat_bgwriter

```sql
-- Background Writer와 Checkpoint 통계
SELECT
    checkpoints_timed,           -- 시간 기반 checkpoint 수
    checkpoints_req,             -- 요청 기반 checkpoint 수 (이 값이 크면 max_wal_size 증가 고려)
    checkpoint_write_time / 1000 AS write_time_sec,
    checkpoint_sync_time / 1000 AS sync_time_sec,
    buffers_checkpoint,          -- checkpoint에서 기록한 버퍼 수
    buffers_clean,               -- bgwriter에서 기록한 버퍼 수
    buffers_backend,             -- backend에서 직접 기록한 버퍼 수 (이 값이 크면 문제)
    maxwritten_clean,            -- bgwriter가 한 번에 기록 한도 도달 횟수
    buffers_alloc                -- 할당된 버퍼 수
FROM pg_stat_bgwriter;

-- buffers_backend가 높으면:
-- → shared_buffers가 부족하거나 bgwriter 설정을 튜닝해야 한다
-- → bgwriter_lru_maxpages, bgwriter_lru_multiplier 증가 고려
```

### pg_stat_replication

```sql
-- 복제 상태 모니터링 (Primary에서 실행)
SELECT client_addr,
       state,
       sent_lsn,
       write_lsn,
       flush_lsn,
       replay_lsn,
       pg_wal_lsn_diff(sent_lsn, replay_lsn) AS replay_lag_bytes,
       pg_size_pretty(pg_wal_lsn_diff(sent_lsn, replay_lsn)) AS replay_lag_size,
       write_lag,
       flush_lag,
       replay_lag,
       sync_state
FROM pg_stat_replication;

-- Standby에서 복제 지연 확인
SELECT now() - pg_last_xact_replay_timestamp() AS replay_lag;
```

### Bloat 감지

```sql
-- 테이블 bloat 추정 (간단한 방법)
SELECT relname,
       n_live_tup,
       n_dead_tup,
       CASE WHEN n_live_tup > 0
            THEN round(n_dead_tup::numeric / n_live_tup * 100, 2)
            ELSE 0
       END AS bloat_ratio,
       pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
       last_autovacuum
FROM pg_stat_user_tables
WHERE n_dead_tup > 1000
ORDER BY n_dead_tup DESC;

-- 인덱스 bloat 확인 (pgstattuple 확장 필요)
CREATE EXTENSION IF NOT EXISTS pgstattuple;

SELECT indexrelname,
       pg_size_pretty(pg_relation_size(indexrelid)) AS index_size,
       idx_scan
FROM pg_stat_user_indexes
WHERE pg_relation_size(indexrelid) > 1024 * 1024  -- 1MB 이상
ORDER BY pg_relation_size(indexrelid) DESC;

-- pgstattuple로 상세 bloat 확인
SELECT * FROM pgstattuple('users');
-- dead_tuple_percent: dead tuple 비율
-- free_percent: 빈 공간 비율
```

### 캐시 히트율

```sql
-- 테이블 캐시 히트율
SELECT relname,
       heap_blks_read,    -- 디스크에서 읽은 블록 수
       heap_blks_hit,     -- shared buffer에서 읽은 블록 수
       CASE WHEN heap_blks_read + heap_blks_hit > 0
            THEN round(heap_blks_hit::numeric / (heap_blks_read + heap_blks_hit) * 100, 2)
            ELSE 100
       END AS cache_hit_ratio
FROM pg_statio_user_tables
WHERE heap_blks_read + heap_blks_hit > 100
ORDER BY cache_hit_ratio ASC;
-- 99% 이상이 이상적이다

-- 인덱스 캐시 히트율
SELECT indexrelname,
       idx_blks_read,
       idx_blks_hit,
       CASE WHEN idx_blks_read + idx_blks_hit > 0
            THEN round(idx_blks_hit::numeric / (idx_blks_read + idx_blks_hit) * 100, 2)
            ELSE 100
       END AS cache_hit_ratio
FROM pg_statio_user_indexes
WHERE idx_blks_read + idx_blks_hit > 100
ORDER BY cache_hit_ratio ASC;

-- 전체 데이터베이스 캐시 히트율
SELECT datname,
       blks_read,
       blks_hit,
       round(blks_hit::numeric / NULLIF(blks_read + blks_hit, 0) * 100, 2) AS hit_ratio
FROM pg_stat_database
WHERE datname = current_database();
```

---

