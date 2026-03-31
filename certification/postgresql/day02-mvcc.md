# Day 2: MVCC (Multi-Version Concurrency Control) 심화

> MVCC의 핵심 원리인 xmin/xmax 튜플 가시성, Snapshot Isolation, 트랜잭션 격리 수준, HOT Update, VACUUM 프로세스, Autovacuum 설정, Transaction ID Wraparound 방지를 학습한다.

---

## MVCC (Multi-Version Concurrency Control) 심화

### 트랜잭션 ID와 Tuple Visibility

PostgreSQL의 MVCC는 각 row(tuple)에 생성/삭제 시점의 트랜잭션 ID를 기록하여 동작한다. 이를 통해 **읽기가 쓰기를 절대 차단하지 않고, 쓰기도 읽기를 차단하지 않는다**.

```
┌───────────────────────────────────────────────────────────┐
│  Tuple (Row)의 내부 시스템 컬럼                            │
│                                                           │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌──────────────────┐   │
│  │ xmin   │ │ xmax   │ │ ctid   │ │ User Data        │   │
│  │ (생성  │ │ (삭제  │ │ (물리  │ │ (name, email...) │   │
│  │  TxID) │ │  TxID) │ │  위치) │ │                  │   │
│  └────────┘ └────────┘ └────────┘ └──────────────────┘   │
└───────────────────────────────────────────────────────────┘
```

| 시스템 컬럼 | 설명 |
|-------------|------|
| `xmin` | 이 tuple을 INSERT한 트랜잭션의 ID이다 |
| `xmax` | 이 tuple을 DELETE 또는 UPDATE한 트랜잭션의 ID이다. 0이면 아직 삭제되지 않았다는 뜻이다 |
| `ctid` | 튜플의 물리적 위치(page번호, offset)이다. UPDATE 시 새 tuple의 ctid를 가리킨다 |

#### HeapTupleHeader 상세 구조

실제 tuple header에는 xmin, xmax 외에도 여러 필드가 포함된다.

```
┌────────────────────────────────────────────────────────────┐
│                  HeapTupleHeader (23 bytes)                 │
│                                                            │
│  t_xmin (4 bytes)    : INSERT한 트랜잭션 ID                 │
│  t_xmax (4 bytes)    : DELETE/UPDATE한 트랜잭션 ID          │
│  t_cid  (4 bytes)    : INSERT/DELETE command ID (같은 tx 내)│
│  t_ctid (6 bytes)    : 현재 또는 업데이트된 tuple 위치       │
│  t_infomask (2 bytes): visibility 플래그 비트마스크          │
│  t_infomask2(2 bytes): 컬럼 수, HOT 플래그                 │
│  t_hoff (1 byte)     : 사용자 데이터 시작 오프셋             │
│                                                            │
│  t_infomask 주요 비트:                                      │
│    HEAP_XMIN_COMMITTED (0x0100): xmin이 커밋됨               │
│    HEAP_XMIN_INVALID   (0x0200): xmin이 롤백됨               │
│    HEAP_XMAX_COMMITTED (0x0400): xmax가 커밋됨               │
│    HEAP_XMAX_INVALID   (0x0800): xmax가 롤백됨               │
│    HEAP_UPDATED        (0x2000): UPDATE로 생성된 tuple       │
│    HEAP_HOT_UPDATED    (0x4000): HOT update된 tuple         │
└────────────────────────────────────────────────────────────┘
```

**Hint Bits**: t_infomask의 COMMITTED/INVALID 비트는 "hint bits"로, 처음 접근 시 CLOG를 조회하여 설정된다. 이후에는 CLOG 조회 없이 빠르게 visibility를 판단할 수 있다. hint bits 설정 시 페이지가 dirty로 표시되어 디스크에 기록되어야 한다.

#### Snapshot Isolation 동작 원리

각 트랜잭션은 시작 시점에 **snapshot**을 생성한다. 이 snapshot에는 현재 진행 중인 모든 트랜잭션 목록이 포함된다.

```sql
-- tuple이 현재 트랜잭션에 보이려면:
-- 1. xmin이 커밋된 트랜잭션이어야 한다
-- 2. xmin이 현재 snapshot보다 이전이어야 한다
-- 3. xmax가 없거나(0), 아직 커밋되지 않았거나, snapshot 이후에 커밋되어야 한다

-- 실제로 확인하는 방법:
SELECT xmin, xmax, ctid, * FROM users;
```

#### Snapshot 구조체 상세

```
Snapshot {
    xmin: 100    -- 이 값보다 작은 모든 트랜잭션은 "완료됨"으로 간주한다
    xmax: 105    -- 이 값 이상인 모든 트랜잭션은 "아직 시작 안 됨"으로 간주한다
    xip: [101, 103]  -- xmin과 xmax 사이에서 아직 진행 중인 트랜잭션 목록
}

Visibility 판단 알고리즘:
  tuple.xmin < snapshot.xmin AND tuple.xmin NOT IN snapshot.xip
    → xmin은 "과거에 커밋됨" → 보인다 (xmax 추가 확인 필요)

  tuple.xmin >= snapshot.xmax
    → xmin은 "미래 트랜잭션" → 보이지 않는다

  tuple.xmin IN snapshot.xip
    → xmin은 "진행 중" → 보이지 않는다
```

```sql
-- 현재 트랜잭션의 snapshot 확인
SELECT txid_current_snapshot();
-- 결과 예시: 100:105:101,103
-- 형식: xmin:xmax:xip_list
```

#### 트랜잭션 격리 수준과 MVCC

PostgreSQL은 4가지 격리 수준 중 3가지를 실제로 구현한다 (READ UNCOMMITTED는 READ COMMITTED와 동일하게 동작한다).

| 격리 수준 | Snapshot 생성 시점 | Dirty Read | Non-repeatable Read | Phantom Read | Serialization Anomaly |
|-----------|-------------------|-----------|--------------------|--------------|-----------------------|
| READ COMMITTED | 각 SQL 문장 시작 시 | 불가 | 가능 | 가능 | 가능 |
| REPEATABLE READ | 트랜잭션 시작 시 (첫 SQL) | 불가 | 불가 | 불가* | 가능 |
| SERIALIZABLE | 트랜잭션 시작 시 (첫 SQL) | 불가 | 불가 | 불가 | 불가 |

> *PostgreSQL의 REPEATABLE READ는 SQL 표준보다 강하여 phantom read도 방지한다 (MVCC 덕분).

```sql
-- REPEATABLE READ 격리 수준 테스트
-- 세션 1:
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ;
SELECT * FROM users;  -- snapshot 생성

-- 세션 2:
INSERT INTO users (name, email) VALUES ('새사용자', 'new@example.com');
-- 커밋 완료

-- 세션 1:
SELECT * FROM users;  -- 세션 2의 INSERT가 보이지 않는다 (동일 snapshot)
COMMIT;

-- SERIALIZABLE 격리 수준과 직렬화 실패
BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE;
-- 직렬화 불가 상황 발생 시:
-- ERROR: could not serialize access due to read/write dependencies
-- 애플리케이션에서 반드시 재시도 로직을 구현해야 한다
```

#### SSI (Serializable Snapshot Isolation)

PostgreSQL의 SERIALIZABLE 격리 수준은 SSI 알고리즘으로 구현된다. 이 알고리즘은 predicate locks를 사용하여 읽기-쓰기 의존성 cycle을 감지하고, cycle이 발생하면 하나의 트랜잭션을 롤백한다.

```sql
-- SSI 관련 설정
SHOW max_pred_locks_per_transaction;  -- 기본 64
SHOW max_pred_locks_per_relation;     -- 기본 -2 (자동)
SHOW max_pred_locks_per_page;         -- 기본 2
```

#### UPDATE는 DELETE + INSERT이다

PostgreSQL에서 UPDATE는 기존 tuple을 삭제 표시(xmax 설정)하고, 새 tuple을 INSERT하는 방식으로 동작한다. 이것이 MVCC의 핵심이자 VACUUM이 필요한 이유이다.

```
UPDATE 전:                          UPDATE 후:
┌──────────────────┐               ┌──────────────────┐
│ xmin=100, xmax=0 │               │ xmin=100, xmax=200│ ← dead tuple
│ name='홍길동'     │               │ name='홍길동'      │
└──────────────────┘               └──────────────────┘
                                   ┌──────────────────┐
                                   │ xmin=200, xmax=0  │ ← live tuple
                                   │ name='홍길동수정'   │
                                   └──────────────────┘
```

#### HOT (Heap-Only Tuple) Update

인덱싱된 컬럼이 변경되지 않고, 새 tuple이 같은 페이지에 들어갈 수 있으면, PostgreSQL은 HOT update를 수행한다. HOT update는 인덱스를 갱신하지 않으므로 성능이 크게 향상된다.

```
HOT Update 조건:
1. UPDATE가 인덱스 컬럼을 변경하지 않는다
2. 새 tuple이 같은 heap 페이지에 들어갈 수 있다

HOT chain:
┌──────────────────┐     ctid로 연결
│ xmin=100, xmax=200│ ──────────┐
│ ctid=(0,2)       │           │
│ HOT_UPDATED 플래그│           ▼
└──────────────────┘  ┌──────────────────┐
                      │ xmin=200, xmax=0  │
                      │ ctid=(0,2)        │
                      │ HEAP_ONLY_TUPLE   │
                      └──────────────────┘

인덱스는 여전히 원래 tuple (0,1)을 가리킨다.
인덱스 → (0,1) → HOT chain → (0,2) 경로로 최신 tuple에 도달한다.
```

```sql
-- HOT update 비율 확인
SELECT relname,
       n_tup_upd,
       n_tup_hot_upd,
       CASE WHEN n_tup_upd > 0
            THEN round(n_tup_hot_upd::numeric / n_tup_upd * 100, 2)
            ELSE 0 END AS hot_ratio
FROM pg_stat_user_tables
ORDER BY n_tup_upd DESC;
-- HOT 비율이 높을수록 UPDATE 성능이 좋다
```

### VACUUM 프로세스

VACUUM은 PostgreSQL에서 가장 중요한 유지보수 작업이다. 두 가지 핵심 목적이 있다.

#### 1. Dead Tuple 정리

UPDATE/DELETE로 발생한 dead tuple이 디스크 공간을 계속 차지한다. VACUUM은 이 공간을 재사용 가능하도록 표시한다.

```sql
-- 테이블별 dead tuple 수 확인
SELECT relname, n_live_tup, n_dead_tup,
       round(n_dead_tup::numeric / NULLIF(n_live_tup + n_dead_tup, 0) * 100, 2) AS dead_ratio
FROM pg_stat_user_tables
ORDER BY n_dead_tup DESC;

-- 수동 VACUUM 실행
VACUUM VERBOSE users;

-- VACUUM FULL: 테이블을 완전히 재작성한다 (배타적 잠금 발생, 주의 필요)
VACUUM FULL users;
```

#### VACUUM vs VACUUM FULL 비교

| 항목 | VACUUM | VACUUM FULL |
|------|--------|-------------|
| 잠금 | ShareUpdateExclusiveLock (읽기/쓰기 가능) | AccessExclusiveLock (모든 접근 차단) |
| 공간 회수 | 재사용 가능하도록 표시 (OS에 반환하지 않음) | 테이블을 완전 재작성하여 OS에 반환 |
| 수행 시간 | 빠름 | 느림 (테이블 크기에 비례) |
| 디스크 사용 | 추가 디스크 불필요 | 테이블 사본을 위한 추가 공간 필요 |
| 인덱스 처리 | dead tuple 제거 | 인덱스 완전 재생성 |
| 운영 중 사용 | 안전 | 서비스 중단 필요 |

```sql
-- VACUUM FULL 대안: pg_repack (온라인 테이블 재작성)
-- pg_repack은 잠금을 최소화하면서 테이블을 재작성하는 확장이다
-- CREATE EXTENSION pg_repack;
-- pg_repack --table=users --dbname=demo
```

#### 2. Transaction ID Wraparound 방지

PostgreSQL의 트랜잭션 ID는 32비트 정수(약 42억)이다. ID가 순환(wraparound)하면 과거 데이터가 "미래"로 보여 사라지는 치명적 문제가 발생한다. VACUUM은 오래된 트랜잭션 ID를 **frozen XID**로 변환하여 이를 방지한다.

```sql
-- 테이블별 가장 오래된 unfrozen 트랜잭션 확인
SELECT relname, age(relfrozenxid) AS xid_age
FROM pg_class
WHERE relkind = 'r'
ORDER BY age(relfrozenxid) DESC
LIMIT 10;

-- autovacuum_freeze_max_age(기본 2억) 도달 시 강제 VACUUM 발동
```

#### Transaction ID Wraparound 상세

```
트랜잭션 ID 공간 (32-bit circular):

        과거                    현재                    미래
  ◄──────────────────────── XID ──────────────────────────►
  |    약 21억 개 이전     |  현재  |    약 21억 개 이후     |
  |    (과거로 간주)        |  TxID |    (미래로 간주)       |

Wraparound 문제:
  현재 XID가 40억에 가까워지면, 과거의 XID=100이
  "미래"로 해석될 수 있다 → 해당 데이터가 보이지 않게 된다

해결: Freeze
  VACUUM은 오래된 tuple의 xmin을 FrozenTransactionId(=2)로 변환한다
  Frozen tuple은 "모든 트랜잭션에 대해 항상 과거"로 간주된다

  vacuum_freeze_min_age (기본 5000만)
    → 이 나이 이상인 tuple을 freeze한다
  vacuum_freeze_table_age (기본 1.5억)
    → 테이블의 relfrozenxid 나이가 이 값을 초과하면 aggressive vacuum 수행
  autovacuum_freeze_max_age (기본 2억)
    → 이 나이에 도달하면 autovacuum이 강제 발동한다
```

```sql
-- wraparound까지 남은 트랜잭션 수 확인
SELECT datname,
       age(datfrozenxid) AS frozen_xid_age,
       2147483647 - age(datfrozenxid) AS remaining_until_wraparound
FROM pg_database
ORDER BY age(datfrozenxid) DESC;

-- 테이블별 freeze 상태 확인
SELECT c.relname,
       c.relfrozenxid,
       age(c.relfrozenxid) AS xid_age,
       pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size
FROM pg_class c
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE c.relkind = 'r' AND n.nspname = 'public'
ORDER BY age(c.relfrozenxid) DESC;
```

#### Autovacuum 설정

```sql
-- autovacuum 관련 주요 파라미터
-- autovacuum_vacuum_threshold = 50          (최소 dead tuple 수)
-- autovacuum_vacuum_scale_factor = 0.2      (테이블의 20% dead tuple 시 발동)
-- 발동 조건: dead_tuples > threshold + scale_factor * n_live_tup
```

#### Autovacuum 상세 설정과 튜닝

```sql
-- autovacuum 전역 설정 확인
SHOW autovacuum;                          -- on/off
SHOW autovacuum_max_workers;              -- 동시 worker 수 (기본 3)
SHOW autovacuum_naptime;                  -- launcher 체크 간격 (기본 1min)
SHOW autovacuum_vacuum_threshold;         -- 최소 dead tuple 수 (기본 50)
SHOW autovacuum_vacuum_scale_factor;      -- dead tuple 비율 (기본 0.2)
SHOW autovacuum_analyze_threshold;        -- ANALYZE 발동 최소 변경 수 (기본 50)
SHOW autovacuum_analyze_scale_factor;     -- ANALYZE 발동 비율 (기본 0.1)
SHOW autovacuum_vacuum_cost_delay;        -- I/O throttle 지연 (기본 2ms, v16)
SHOW autovacuum_vacuum_cost_limit;        -- I/O throttle 한도 (기본 -1 = vacuum_cost_limit)

-- 대규모 테이블에 대한 개별 autovacuum 설정
ALTER TABLE large_events SET (
    autovacuum_vacuum_scale_factor = 0.01,    -- 1%만 변경되어도 vacuum
    autovacuum_vacuum_threshold = 1000,
    autovacuum_analyze_scale_factor = 0.005,
    autovacuum_vacuum_cost_delay = 0          -- throttle 비활성화 (빠른 vacuum)
);

-- autovacuum 동작 로그 확인
-- postgresql.conf에서:
-- log_autovacuum_min_duration = 0  (모든 autovacuum 기록)
```

#### Visibility Map과 Free Space Map

```
Visibility Map (VM):
  각 heap 페이지당 2비트:
    - all-visible: 모든 tuple이 모든 활성 트랜잭션에 보인다
    - all-frozen: 모든 tuple이 frozen 상태이다

  용도:
    1. Index-Only Scan: all-visible 페이지는 heap 접근 없이 인덱스만으로 응답 가능
    2. Vacuum: all-frozen 페이지는 재방문 불필요

Free Space Map (FSM):
  각 heap 페이지의 가용 공간을 기록한다
  INSERT 시 적절한 공간이 있는 페이지를 빠르게 찾기 위해 사용한다
  VACUUM이 dead tuple을 정리한 후 FSM을 갱신한다
```

```sql
-- VM/FSM 크기 확인
SELECT pg_size_pretty(pg_relation_size('users', 'vm')) AS visibility_map,
       pg_size_pretty(pg_relation_size('users', 'fsm')) AS free_space_map,
       pg_size_pretty(pg_relation_size('users', 'main')) AS main;

-- pg_visibility 확장으로 VM 상태 확인
CREATE EXTENSION IF NOT EXISTS pg_visibility;
SELECT * FROM pg_visibility('users');
SELECT all_visible, all_frozen, count(*)
FROM pg_visibility_map('users')
GROUP BY all_visible, all_frozen;
```

---

