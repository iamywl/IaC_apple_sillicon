# Day 3: WAL 및 쿼리 실행 과정

> WAL(Write-Ahead Logging)의 동작 원리, Checkpoint, LSN, full_page_writes, synchronous_commit, PITR 복원 절차와 쿼리 실행 파이프라인(Parser, Analyzer, Rewriter, Planner, Executor), Join 전략, Parallel Query를 학습한다.

---

## WAL (Write-Ahead Logging) 심화

### Crash Recovery 원리

WAL의 핵심 원칙은 **데이터 페이지를 디스크에 쓰기 전에 반드시 해당 변경 사항을 WAL에 먼저 기록하는 것**이다. 이를 통해 crash 발생 시 WAL을 재생(replay)하여 데이터를 복구한다.

```
┌─────────────────────────────────────────────────────────────┐
│                    WAL 동작 흐름                              │
│                                                              │
│  ① INSERT/UPDATE 실행                                        │
│       │                                                      │
│       ▼                                                      │
│  ② WAL Buffer에 변경 내용 기록                                │
│       │                                                      │
│       ▼                                                      │
│  ③ COMMIT 시 WAL Buffer → WAL 세그먼트 파일 (fsync)           │
│       │                                                      │
│       ▼                                                      │
│  ④ 나중에 Shared Buffers → 데이터 파일 (BgWriter/Checkpoint)  │
│                                                              │
│  ※ Crash 발생 시: WAL 세그먼트를 재생하여 ④를 복구한다          │
└─────────────────────────────────────────────────────────────┘
```

### WAL 세그먼트와 Checkpoint

- WAL 세그먼트는 기본 16MB 파일이다 (`pg_wal/` 디렉터리에 저장)
- **Checkpoint**는 shared buffers의 모든 dirty page를 디스크에 기록하는 작업이다
- Checkpoint 이후의 WAL만 crash recovery에 필요하므로, 이전 WAL 세그먼트는 재활용/삭제된다
- `checkpoint_timeout`(기본 5분)과 `max_wal_size`(기본 1GB)에 의해 자동 발생한다

### WAL 세그먼트 구조 상세

```
WAL 세그먼트 파일명 형식: TTTTTTTTSSSSSSSSNNNNNNNN
  T: Timeline ID (8자리 hex)
  S: Segment의 상위 32비트 (8자리 hex)
  N: Segment의 하위 32비트 (8자리 hex)

예: 000000010000000000000003
  Timeline: 1
  Segment: 3 (3번째 16MB 세그먼트)

WAL 레코드 구조:
┌─────────────────────────────────────────────────────┐
│ XLogRecord Header                                    │
│  - xl_tot_len: 전체 레코드 길이                       │
│  - xl_xid: 트랜잭션 ID                               │
│  - xl_prev: 이전 WAL 레코드의 위치                    │
│  - xl_info: 레코드 타입 플래그                        │
│  - xl_rmid: Resource Manager ID (heap, btree, etc.)  │
│  - xl_crc: CRC 체크섬                                │
├─────────────────────────────────────────────────────┤
│ Block References                                     │
│  - 변경된 데이터 블록에 대한 참조                      │
│  - full_page_writes가 켜져 있으면 전체 페이지 이미지   │
├─────────────────────────────────────────────────────┤
│ Record Data                                          │
│  - 실제 변경 내용 (resource manager 별로 다름)        │
└─────────────────────────────────────────────────────┘
```

#### LSN (Log Sequence Number)

LSN은 WAL 내 특정 위치를 가리키는 64비트 값으로, WAL 파일 내의 바이트 오프셋이다.

```sql
-- 현재 WAL 위치 확인
SELECT pg_current_wal_lsn();          -- 예: 0/16B3780
SELECT pg_current_wal_insert_lsn();   -- WAL 버퍼 내 삽입 위치
SELECT pg_current_wal_flush_lsn();    -- 디스크에 flush된 위치

-- 두 LSN 사이의 바이트 차이
SELECT pg_wal_lsn_diff(pg_current_wal_insert_lsn(), '0/0') AS total_wal_bytes;

-- WAL 세그먼트 파일명 확인
SELECT pg_walfile_name(pg_current_wal_lsn());
SELECT pg_walfile_name_offset(pg_current_wal_lsn());
```

#### full_page_writes

checkpoint 직후 페이지가 처음 수정될 때, 해당 페이지의 전체 이미지(8KB)를 WAL에 기록한다. 이는 "torn page" 문제(OS가 페이지를 부분적으로만 기록하는 경우)를 방지하기 위함이다.

```sql
-- full_page_writes 설정 확인
SHOW full_page_writes;  -- 기본값: on (절대로 끄지 말 것)

-- full_page_writes가 WAL 크기에 미치는 영향:
-- checkpoint 직후 WAL 생성량이 급증하는 현상("WAL spike")이 발생한다
-- checkpoint_completion_target = 0.9 (기본)로 checkpoint를 분산하여 완화한다
```

### Checkpoint 상세

```
Checkpoint 동작:
┌────────────────────────────────────────────────────────┐
│                                                        │
│  1. checkpoint_timeout(5min) 또는 max_wal_size(1GB)    │
│     조건 충족 시 checkpoint 시작                        │
│                                                        │
│  2. Shared Buffers 스캔                                 │
│     → 모든 dirty page를 디스크에 기록 (fsync)           │
│     → checkpoint_completion_target 비율에 맞춰 분산     │
│                                                        │
│  3. CLOG, 다중트랜잭션 등 메타데이터 flush              │
│                                                        │
│  4. pg_control 파일에 checkpoint 정보 기록:             │
│     - checkpoint LSN                                   │
│     - redo LSN (recovery 시작 지점)                     │
│     - 타임라인 ID                                       │
│                                                        │
│  5. 불필요한 WAL 세그먼트 삭제/재활용                    │
│                                                        │
└────────────────────────────────────────────────────────┘
```

```sql
-- 마지막 checkpoint 정보 확인
SELECT checkpoint_lsn, redo_lsn, checkpoint_time
FROM pg_control_checkpoint();

-- checkpoint 관련 설정
SHOW checkpoint_timeout;              -- 기본 5min
SHOW checkpoint_completion_target;    -- 기본 0.9
SHOW max_wal_size;                    -- 기본 1GB
SHOW min_wal_size;                    -- 기본 80MB

-- checkpoint 통계
SELECT checkpoints_timed, checkpoints_req,
       checkpoint_write_time, checkpoint_sync_time,
       buffers_checkpoint, buffers_clean, buffers_backend
FROM pg_stat_bgwriter;
```

### wal_level 설정

| wal_level | WAL 내용 | 용도 |
|-----------|---------|------|
| `minimal` | crash recovery에 필요한 최소 정보만 기록 | 독립 실행 서버 (복제 불필요 시) |
| `replica` (기본) | streaming replication에 필요한 정보 포함 | 물리 복제, pg_basebackup |
| `logical` | logical decoding에 필요한 정보 추가 포함 | logical replication, CDC |

```sql
SHOW wal_level;
-- wal_level 변경 시 PostgreSQL 재시작이 필요하다
```

### synchronous_commit 설정

| 설정 값 | WAL fsync | 성능 | 데이터 안전성 |
|---------|-----------|------|--------------|
| `on` (기본) | COMMIT 시 WAL을 디스크에 fsync한다 | 느림 | 가장 안전하다 |
| `off` | WAL을 비동기로 쓴다 (최대 `wal_writer_delay` 지연) | 빠름 | crash 시 최근 트랜잭션 유실 가능하다 |
| `remote_apply` | standby에서 replay까지 대기한다 | 가장 느림 | standby에서도 즉시 읽기 가능하다 |

#### synchronous_commit 전체 옵션

```
                        Local                     Remote
                   ┌─────────────┐          ┌────────────────┐
                   │  WAL Buffer │          │  Standby       │
                   │      │      │          │                │
  on ──────────────│── fsync ────│──────────│                │
  off ─────────────│── (지연)  ──│──────────│                │
  local ───────────│── fsync ────│──────────│                │
  remote_write ────│── fsync ────│──────────│── OS buffer ───│
  remote_apply ────│── fsync ────│──────────│── replay 완료 ─│
                   └─────────────┘          └────────────────┘
```

```sql
-- 트랜잭션 단위로 synchronous_commit 제어 가능
-- 로그 데이터처럼 유실 허용 가능한 경우:
BEGIN;
SET LOCAL synchronous_commit = 'off';
INSERT INTO access_log (...) VALUES (...);
COMMIT;  -- WAL fsync를 기다리지 않으므로 빠르다
```

### WAL 아카이빙과 PITR (Point-In-Time Recovery)

WAL 세그먼트를 아카이브 저장소에 보관하면, 특정 시점으로 데이터베이스를 복원할 수 있다.

```
# postgresql.conf
archive_mode = on
archive_command = 'cp %p /archive/%f'

# PITR 복원 절차:
# 1. pg_basebackup으로 기본 백업 복원
# 2. recovery.conf에 복원 목표 시점 지정
# 3. PostgreSQL 시작 → WAL 재생 → 목표 시점에서 정지
```

#### PITR 복원 상세 절차

```bash
# 1. 기본 백업 수행
pg_basebackup -h primary-host -D /backup/base -U replicator -Fp -Xs -P

# 2. 백업을 데이터 디렉터리로 복원
cp -r /backup/base /var/lib/postgresql/data

# 3. recovery 설정 (PostgreSQL 12+에서는 postgresql.conf에 직접 설정)
cat >> /var/lib/postgresql/data/postgresql.conf << EOF
restore_command = 'cp /archive/%f %p'
recovery_target_time = '2024-06-15 14:30:00'
recovery_target_action = 'promote'
EOF

# 4. recovery.signal 파일 생성 (PostgreSQL 12+)
touch /var/lib/postgresql/data/recovery.signal

# 5. PostgreSQL 시작 → WAL 재생 → 목표 시점에서 정지 후 promote
pg_ctl start -D /var/lib/postgresql/data

# recovery_target 옵션들:
# recovery_target_time = '2024-06-15 14:30:00'  -- 특정 시각
# recovery_target_xid = '12345'                 -- 특정 트랜잭션까지
# recovery_target_lsn = '0/16B3780'             -- 특정 WAL 위치까지
# recovery_target_name = 'my_restore_point'      -- pg_create_restore_point()로 생성한 이름
# recovery_target_inclusive = true               -- 대상 포함 여부
```

---

## 쿼리 실행 과정

### 쿼리 처리 파이프라인

SQL 쿼리는 5단계를 거쳐 실행된다.

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────────┐    ┌──────────┐
│  Parser  │───►│ Analyzer │───►│ Rewriter │───►│   Planner/   │───►│ Executor │
│          │    │          │    │          │    │  Optimizer   │    │          │
│ SQL 구문 │    │ 의미     │    │ Rule     │    │ Cost-based   │    │ 실제     │
│ 분석     │    │ 분석     │    │ 적용     │    │ 최적화       │    │ 실행     │
└──────────┘    └──────────┘    └──────────┘    └──────────────┘    └──────────┘
```

| 단계 | 역할 |
|------|------|
| **Parser** | SQL 문자열을 parse tree로 변환한다. 문법 오류를 검출한다 |
| **Analyzer** | 테이블/컬럼 존재 여부, 타입 검사 등 의미 분석을 수행한다 |
| **Rewriter** | VIEW, RULE 등을 적용하여 쿼리를 재작성한다 |
| **Planner/Optimizer** | 통계 정보를 기반으로 cost-based optimization을 수행하여 최적 실행 계획을 선택한다 |
| **Executor** | 실행 계획에 따라 실제 데이터를 읽고/쓰고 결과를 반환한다 |

### Parser 상세

Parser는 두 단계로 나뉜다.

1. **Lexer (flex)**: SQL 문자열을 토큰(keyword, identifier, literal 등)으로 분리한다
2. **Grammar (bison)**: 토큰 스트림을 parse tree로 변환한다. SQL 문법 규칙을 적용한다

```sql
-- 문법 오류는 Parser 단계에서 발생한다
SELECT * FORM users;
-- ERROR: syntax error at or near "users"

-- 의미 오류(존재하지 않는 테이블)는 Analyzer 단계에서 발생한다
SELECT * FROM nonexistent_table;
-- ERROR: relation "nonexistent_table" does not exist
```

### Planner/Optimizer 상세

#### Cost Model

PostgreSQL의 cost model은 디스크 I/O와 CPU 비용을 조합하여 계산한다.

```sql
-- cost 관련 파라미터
SHOW seq_page_cost;              -- 순차 페이지 읽기 비용 (기본 1.0, 기준값)
SHOW random_page_cost;           -- 랜덤 페이지 읽기 비용 (기본 4.0, SSD는 1.1~1.5 권장)
SHOW cpu_tuple_cost;             -- tuple 처리 CPU 비용 (기본 0.01)
SHOW cpu_index_tuple_cost;       -- 인덱스 tuple 처리 비용 (기본 0.005)
SHOW cpu_operator_cost;          -- 연산자 평가 비용 (기본 0.0025)
SHOW effective_cache_size;       -- OS 캐시 포함 예상 가용 메모리 (기본 4GB)

-- SSD 사용 시 random_page_cost를 낮추면 인덱스 사용이 더 적극적이 된다
-- ALTER SYSTEM SET random_page_cost = 1.1;  -- SSD 최적화
-- SELECT pg_reload_conf();
```

#### 통계 정보

Planner는 `pg_statistic` 카탈로그(또는 `pg_stats` 뷰)의 통계를 참조한다.

```sql
-- 테이블 통계 확인
SELECT attname, n_distinct, most_common_vals, most_common_freqs,
       histogram_bounds, correlation
FROM pg_stats
WHERE tablename = 'orders' AND schemaname = 'public';

-- n_distinct: 고유 값 수 (음수면 비율, 예: -0.5 = 행 수의 50%)
-- most_common_vals: 가장 빈번한 값 목록
-- most_common_freqs: 각 빈번값의 빈도
-- histogram_bounds: 균등 분포 히스토그램 경계값
-- correlation: 물리적 순서와 논리적 순서의 상관관계 (-1~1)

-- 통계 갱신 (ANALYZE)
ANALYZE orders;

-- 통계 샘플링 수 조정 (기본 100, 범위 1~10000)
ALTER TABLE orders ALTER COLUMN status SET STATISTICS 500;
ANALYZE orders;
```

#### Join 전략

| Join 방식 | 동작 | 최적 상황 |
|-----------|------|----------|
| **Nested Loop** | 외부 테이블의 각 행에 대해 내부 테이블을 스캔한다 | 내부 테이블이 작거나 인덱스가 있을 때 |
| **Hash Join** | 내부 테이블로 해시 테이블을 구성하고 외부 테이블을 스캔한다 | 등호 조건, 대용량 테이블 |
| **Merge Join** | 양쪽 테이블을 정렬 후 병합한다 | 이미 정렬된 데이터, 범위 조건 |

```
Nested Loop Join:
┌─────────┐     ┌─────────┐
│ Outer   │────►│ Inner   │  외부 행마다 내부 스캔
│ (users) │  N  │ (orders)│  복잡도: O(N × M) 또는 O(N × logM) (인덱스)
└─────────┘     └─────────┘

Hash Join:
┌─────────┐  Build   ┌───────────┐   Probe   ┌─────────┐
│ Inner   │─────────►│ Hash Table│◄──────────│ Outer   │
│ (small) │          └───────────┘           │ (large) │
└─────────┘                                  └─────────┘
  복잡도: O(N + M)  메모리: work_mem에 해시 테이블 유지

Merge Join:
┌─────────┐  Sort  ┌─────────┐  Sort  ┌─────────┐
│ Table A │──────►│ Sorted A│        │ Sorted B│◄──────│ Table B │
└─────────┘       └────┬────┘        └────┬────┘       └─────────┘
                       │     Merge        │
                       └───────┬──────────┘
                               ▼
                        ┌─────────┐
                        │ Result  │  복잡도: O(NlogN + MlogM + N + M)
                        └─────────┘
```

```sql
-- Join 전략 비교 실험
-- tart-infra 프로젝트에서:
-- kubectl exec -it -n demo deploy/postgres -- psql -U demo -d demo

-- Nested Loop 유도
SET enable_hashjoin = off;
SET enable_mergejoin = off;
EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM users u JOIN orders o ON u.id = o.user_id;

-- Hash Join 유도
RESET enable_hashjoin;
SET enable_nestloop = off;
SET enable_mergejoin = off;
EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM users u JOIN orders o ON u.id = o.user_id;

-- Merge Join 유도
RESET enable_mergejoin;
SET enable_hashjoin = off;
SET enable_nestloop = off;
EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM users u JOIN orders o ON u.id = o.user_id;

-- 모든 설정 복원
RESET ALL;
```

#### Parallel Query

PostgreSQL 9.6부터 단일 쿼리를 여러 worker 프로세스가 병렬로 처리할 수 있다.

```sql
-- Parallel Query 관련 설정
SHOW max_parallel_workers_per_gather;  -- 기본 2
SHOW max_parallel_workers;             -- 기본 8
SHOW min_parallel_table_scan_size;     -- 기본 8MB (이 크기 이상 테이블만 병렬 처리)
SHOW min_parallel_index_scan_size;     -- 기본 512kB
SHOW parallel_setup_cost;             -- worker 시작 비용 (기본 1000)
SHOW parallel_tuple_cost;             -- 튜플 전달 비용 (기본 0.1)

-- Parallel Query 실행 계획 예시
EXPLAIN (ANALYZE) SELECT count(*) FROM large_table WHERE status = 'active';
-- Finalize Aggregate
--   -> Gather
--        Workers Planned: 2
--        Workers Launched: 2
--        -> Partial Aggregate
--             -> Parallel Seq Scan on large_table
--                  Filter: (status = 'active')

-- 병렬 처리 가능한 작업:
-- Parallel Seq Scan, Parallel Index Scan, Parallel Hash Join,
-- Parallel Merge Join, Parallel Aggregate, Parallel Append
```

---

