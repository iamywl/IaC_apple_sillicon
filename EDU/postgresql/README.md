# PostgreSQL - 관계형 데이터베이스

## 개념

### PostgreSQL이란?
- 1986년 UC Berkeley에서 시작된 오픈소스 객체-관계형 데이터베이스 관리 시스템(ORDBMS)이다
- ACID 트랜잭션을 완벽하게 지원하며, SQL 표준 준수도가 가장 높은 데이터베이스 중 하나이다
- JSONB, 배열, 사용자 정의 타입, Range 타입 등 고급 데이터 타입을 제공한다
- 확장성(extensibility)이 핵심 설계 철학으로, 사용자 정의 함수, 타입, 연산자, 인덱스 방법을 추가할 수 있다
- 이 프로젝트에서는 v16-alpine 이미지를 사용한다

### 핵심 개념
| 개념 | 설명 |
|------|------|
| ACID | Atomicity, Consistency, Isolation, Durability의 약자로 트랜잭션 안정성을 보장한다 |
| MVCC | 다중 버전 동시성 제어로 읽기/쓰기가 서로 차단하지 않는다 |
| WAL | Write-Ahead Logging으로 데이터 무결성과 crash recovery를 보장한다 |
| Replication | 스트리밍/논리 복제를 통해 고가용성과 읽기 확장을 구현한다 |
| Connection Pool | 프로세스 기반 연결을 재사용하여 리소스 소비를 줄인다 |
| TOAST | 큰 필드 값을 자동 압축/분리 저장하는 기법이다 |

---

### 이 프로젝트에서의 실습 환경

이 프로젝트에서 PostgreSQL은 dev 클러스터의 `demo` 네임스페이스에 배포된다.

- 매니페스트: `manifests/demo/postgres-app.yaml`
- 이미지: `postgres:16-alpine`
- 자격증명: 사용자 `demo`, 비밀번호 `demo123`, 데이터베이스 `demo`
- Keycloak의 백엔드 DB로도 사용된다
- 실습 대상 클러스터: dev (`kubeconfig/dev.yaml`)

```bash
# dev 클러스터에서 PostgreSQL 접속
export KUBECONFIG=kubeconfig/dev.yaml
kubectl exec -it -n demo deploy/postgres -- psql -U demo -d demo
```

---

## 아키텍처 심화

### 프로세스 아키텍처

PostgreSQL은 **프로세스 기반(process-per-connection)** 아키텍처를 사용한다. 스레드가 아닌 독립된 프로세스로 각 클라이언트를 처리하므로, 한 연결의 장애가 다른 연결에 영향을 주지 않는다.

```
┌─────────────────────────────────────────────────────────────────┐
│                     PostgreSQL Instance                        │
│                                                                 │
│  ┌──────────────┐                                               │
│  │  Postmaster   │◄─── 메인 프로세스: 연결 수락, 자식 프로세스 생성   │
│  │  (pid 1)      │                                               │
│  └──────┬───────┘                                               │
│         │ fork()                                                │
│         ├──────────────────────────────────────────────┐        │
│         │          Backend Processes                    │        │
│  ┌──────┴───────┐ ┌──────────────┐ ┌──────────────┐   │        │
│  │ Backend #1   │ │ Backend #2   │ │ Backend #N   │   │        │
│  │ (client 연결) │ │ (client 연결) │ │ (client 연결) │   │        │
│  └──────────────┘ └──────────────┘ └──────────────┘   │        │
│                                                        │        │
│         ├──────────────────────────────────────────────┘        │
│         │          Background Workers                           │
│  ┌──────┴───────┐ ┌──────────────┐ ┌──────────────┐            │
│  │ Autovacuum   │ │ BgWriter     │ │ Checkpointer │            │
│  │ Launcher     │ │              │ │              │            │
│  └──────────────┘ └──────────────┘ └──────────────┘            │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐            │
│  │ WAL Writer   │ │ Stats        │ │ Archiver     │            │
│  │              │ │ Collector    │ │ (선택)       │            │
│  └──────────────┘ └──────────────┘ └──────────────┘            │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                  Shared Memory                           │   │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐     │   │
│  │  │ Shared       │ │ WAL Buffers  │ │ CLOG         │     │   │
│  │  │ Buffers      │ │              │ │ (Commit Log) │     │   │
│  │  └──────────────┘ └──────────────┘ └──────────────┘     │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

#### 주요 프로세스 역할

| 프로세스 | 역할 |
|----------|------|
| **Postmaster** | 메인 데몬 프로세스이다. 클라이언트 연결 요청을 수신하고, 인증 후 backend 프로세스를 fork한다 |
| **Backend** | 클라이언트당 하나씩 생성되며, SQL 파싱/실행/결과 반환을 담당한다 |
| **BgWriter** | shared buffers에서 dirty page를 주기적으로 디스크에 기록하여, checkpoint 부하를 분산한다 |
| **Checkpointer** | checkpoint 시점에 모든 dirty page를 디스크에 기록하고, WAL 재활용 지점을 갱신한다 |
| **WAL Writer** | WAL 버퍼의 내용을 WAL 세그먼트 파일로 주기적으로 flush한다 |
| **Autovacuum Launcher** | 테이블별 dead tuple 비율을 모니터링하고, 필요 시 autovacuum worker를 생성한다 |
| **Stats Collector** | 테이블/인덱스 접근 통계를 수집하여 `pg_stat_*` 뷰에 반영한다 |
| **Archiver** | WAL 아카이빙이 활성화된 경우, 완료된 WAL 세그먼트를 아카이브 저장소로 복사한다 |

#### Shared Memory 구성 요소

- **shared_buffers**: 디스크에서 읽은 테이블/인덱스 페이지를 캐시하는 공유 버퍼 풀이다. 일반적으로 전체 메모리의 25%로 설정한다
- **WAL Buffers**: WAL 레코드를 디스크에 쓰기 전 임시 저장하는 버퍼이다. `wal_buffers` 파라미터로 크기를 조정한다
- **CLOG (Commit Log)**: 각 트랜잭션의 커밋/롤백 상태를 기록하는 구조체이다. MVCC의 tuple visibility 판단에 사용된다

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

#### Autovacuum 설정

```sql
-- autovacuum 관련 주요 파라미터
-- autovacuum_vacuum_threshold = 50          (최소 dead tuple 수)
-- autovacuum_vacuum_scale_factor = 0.2      (테이블의 20% dead tuple 시 발동)
-- 발동 조건: dead_tuples > threshold + scale_factor * n_live_tup
```

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

### synchronous_commit 설정

| 설정 값 | WAL fsync | 성능 | 데이터 안전성 |
|---------|-----------|------|--------------|
| `on` (기본) | COMMIT 시 WAL을 디스크에 fsync한다 | 느림 | 가장 안전하다 |
| `off` | WAL을 비동기로 쓴다 (최대 `wal_writer_delay` 지연) | 빠름 | crash 시 최근 트랜잭션 유실 가능하다 |
| `remote_apply` | standby에서 replay까지 대기한다 | 가장 느림 | standby에서도 즉시 읽기 가능하다 |

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

### EXPLAIN ANALYZE 읽기

```sql
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) SELECT * FROM orders WHERE user_id = 1;

-- 출력 예시:
-- Seq Scan on orders  (cost=0.00..1.04 rows=1 width=52) (actual time=0.015..0.016 rows=2 loops=1)
--   Filter: (user_id = 1)
--   Rows Removed by Filter: 1
--   Buffers: shared hit=1
-- Planning Time: 0.085 ms
-- Execution Time: 0.035 ms
```

| 항목 | 의미 |
|------|------|
| `cost=0.00..1.04` | 예상 비용이다. 시작 비용..총 비용 (arbitrary unit) |
| `rows=1` | planner가 예상한 결과 행 수이다 |
| `actual time=0.015..0.016` | 실제 소요 시간(ms)이다. 첫 행..마지막 행 |
| `rows=2` | 실제 반환된 행 수이다 (예상과 차이가 크면 통계가 오래된 것이다) |
| `loops=1` | 이 노드가 실행된 횟수이다 (Nested Loop 등에서 증가) |
| `Buffers: shared hit=1` | shared buffer에서 읽은 페이지 수이다. `read`는 디스크 I/O를 의미한다 |

```sql
-- 통계가 오래되었다면 갱신
ANALYZE orders;
```

---

## 인덱스 타입

PostgreSQL은 다양한 인덱스 타입을 제공하여 워크로드에 맞는 최적화를 가능하게 한다.

| 인덱스 타입 | 용도 | 예시 |
|------------|------|------|
| **B-tree** (기본) | 등호, 범위, 정렬, LIKE 'prefix%' 비교이다 | `CREATE INDEX idx ON t(col)` |
| **Hash** | 등호(=) 비교에만 사용한다. B-tree보다 빠를 수 있다 | `CREATE INDEX idx ON t USING hash(col)` |
| **GiST** | 기하학적 데이터, 범위 타입, 전문 검색 등에 사용한다 | `CREATE INDEX idx ON t USING gist(geom)` |
| **GIN** | JSONB, 배열, 전문 검색(tsvector) 등 다중 값 컬럼에 사용한다 | `CREATE INDEX idx ON t USING gin(data jsonb_path_ops)` |
| **BRIN** | Block Range INdex이다. 물리적으로 정렬된 대용량 테이블에 매우 작은 인덱스로 효과적이다 | `CREATE INDEX idx ON t USING brin(created_at)` |

### 고급 인덱스 기법

```sql
-- Partial Index: 특정 조건의 행만 인덱싱한다 (인덱스 크기 감소)
CREATE INDEX idx_active_orders ON orders(created_at)
WHERE status = 'pending';

-- Expression Index: 표현식 결과를 인덱싱한다
CREATE INDEX idx_lower_email ON users(lower(email));

-- Covering Index (INCLUDE): 인덱스만으로 쿼리를 처리한다 (Index-Only Scan)
CREATE INDEX idx_orders_cover ON orders(user_id) INCLUDE (product, status);

-- Multicolumn Index: 여러 컬럼을 하나의 인덱스로 구성한다
-- 왼쪽 컬럼부터 사용할 수 있다 (leftmost prefix rule)
CREATE INDEX idx_orders_multi ON orders(user_id, status, created_at);
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

### Replication Slot

Standby가 아직 수신하지 않은 WAL 세그먼트가 삭제되지 않도록 보장하는 메커니즘이다. Standby가 장기간 다운되면 WAL이 축적되어 디스크가 가득 찰 수 있으므로 모니터링이 필수이다.

```sql
-- 복제 슬롯 현황 확인
SELECT slot_name, active, restart_lsn, confirmed_flush_lsn
FROM pg_replication_slots;
```

### pg_basebackup

Streaming Replication Standby를 구성하거나 물리 백업을 생성할 때 사용하는 도구이다.

```bash
pg_basebackup -h primary-host -D /var/lib/postgresql/data -U replicator -Fp -Xs -P
```

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

---

## Kubernetes에서의 PostgreSQL

### StatefulSet vs Deployment

데이터베이스는 반드시 **StatefulSet**으로 배포해야 한다.

| 항목 | Deployment | StatefulSet |
|------|-----------|-------------|
| Pod 이름 | 랜덤 (`postgres-7b8f9-xyz`) | 순차적 (`postgres-0`, `postgres-1`) |
| 스토리지 | Pod 재시작 시 PVC 재할당 가능 | 각 Pod에 고정 PVC를 유지한다 |
| 시작/종료 순서 | 무작위 | 순차적 (0 → 1 → 2 순서로 시작) |
| 네트워크 ID | 변경 가능 | Headless Service로 안정적 DNS 제공 (`postgres-0.postgres.ns.svc`) |
| 적합한 용도 | 상태 없는(stateless) 앱 | 데이터베이스, 분산 시스템 |

### Kubernetes 배포 아키텍처

```
┌──────────────────────────────────────┐
│         StatefulSet: postgres        │
│  ┌────────────────────────────────┐  │
│  │ Pod: postgres-0                │  │
│  │  ┌──────────┐  ┌───────────┐  │  │
│  │  │PostgreSQL│  │  Volume   │  │  │
│  │  │ :5432    │──│  (PVC)    │  │  │
│  │  └──────────┘  └───────────┘  │  │
│  └────────────────────────────────┘  │
│                                      │
│  ┌────────────────────────────────┐  │
│  │ Service: postgres-svc          │  │
│  │ (Headless, Port: 5432)        │  │
│  └────────────────────────────────┘  │
└──────────────────────────────────────┘
```

### Operator 패턴

수동으로 StatefulSet을 관리하면 failover, 백업, 복제 설정 등이 복잡해진다. Kubernetes Operator는 이러한 운영 지식을 코드로 자동화한다.

#### CloudNativePG

CNCF Sandbox 프로젝트로, Kubernetes 네이티브 PostgreSQL Operator이다.

```yaml
# CloudNativePG Cluster 예시
apiVersion: postgresql.cnpg.io/v1
kind: Cluster
metadata:
  name: my-postgres
spec:
  instances: 3                    # Primary 1 + Standby 2
  storage:
    size: 10Gi
  postgresql:
    parameters:
      shared_buffers: "256MB"
      max_connections: "100"
  backup:
    barmanObjectStore:
      destinationPath: "s3://my-bucket/backups"
      s3Credentials:
        accessKeyId:
          name: s3-creds
          key: ACCESS_KEY_ID
        secretAccessKey:
          name: s3-creds
          key: ACCESS_SECRET_KEY
```

주요 기능:
- 자동 failover (Primary 장애 시 Standby를 자동 승격한다)
- 선언적 백업/복원 (Barman 기반 S3/GCS 백업)
- Rolling update (무중단 PostgreSQL 버전 업그레이드)
- 자동 TLS 인증서 관리

#### Zalando Postgres Operator

Zalando에서 개발한 operator로, Patroni를 기반으로 HA를 구성한다.

```yaml
# Zalando Postgres Operator 예시
apiVersion: acid.zalan.do/v1
kind: postgresql
metadata:
  name: my-postgres-cluster
spec:
  teamId: "myteam"
  numberOfInstances: 3
  volume:
    size: 10Gi
  postgresql:
    version: "16"
    parameters:
      shared_buffers: "256MB"
  users:
    myapp_user:
      - superuser
      - createdb
  databases:
    mydb: myapp_user
  resources:
    requests:
      cpu: 100m
      memory: 256Mi
    limits:
      cpu: 500m
      memory: 512Mi
```

주요 기능:
- Patroni 기반 자동 failover
- 사용자/데이터베이스 선언적 관리
- Connection Pooler 내장 (PgBouncer sidecar)
- 논리 백업 (pg_dump 기반 CronJob)

---

## 실습

### 실습 1: PostgreSQL Pod에 접속
```bash
# PostgreSQL Pod 확인
kubectl get pods -n demo -l app=postgres

# PostgreSQL에 직접 접속 (이 프로젝트 기준: 사용자 demo, DB demo)
kubectl exec -it -n demo deploy/postgres -- psql -U demo -d demo

# 또는 포트포워딩 후 로컬에서 접속
kubectl port-forward -n demo svc/postgres 5432:5432
psql -h localhost -U demo -d demo
# 비밀번호: demo123
```

### 실습 2: 기본 SQL 명령어
```sql
-- 데이터베이스 목록
\l

-- 현재 데이터베이스 확인
SELECT current_database();

-- 테이블 목록
\dt

-- 테이블 생성
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 데이터 삽입
INSERT INTO users (name, email) VALUES ('홍길동', 'hong@example.com');
INSERT INTO users (name, email) VALUES ('김철수', 'kim@example.com');

-- 데이터 조회
SELECT * FROM users;

-- 테이블 구조 확인
\d users
```

### 실습 3: MVCC 동작 확인
```sql
-- 시스템 컬럼으로 MVCC 확인
SELECT xmin, xmax, ctid, * FROM users;

-- 트랜잭션 격리 수준 확인
SHOW transaction_isolation;

-- 두 세션에서 동시성 테스트
-- 세션 1:
BEGIN;
UPDATE users SET name = '홍길동_수정' WHERE id = 1;
-- COMMIT하지 않은 상태에서...

-- 세션 2:
SELECT * FROM users WHERE id = 1;  -- 수정 전 데이터가 보인다 (MVCC)
```

### 실습 4: EXPLAIN ANALYZE로 쿼리 분석
```sql
-- 실행 계획 확인
EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM users WHERE email = 'hong@example.com';

-- 인덱스 생성 후 비교
CREATE INDEX idx_users_email ON users(email);
EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM users WHERE email = 'hong@example.com';

-- Seq Scan → Index Scan으로 변경되었는지 확인한다
```

### 실습 5: 성능 모니터링
```sql
-- 활성 연결 수 확인
SELECT count(*) FROM pg_stat_activity;

-- 현재 실행 중인 쿼리
SELECT pid, query, state, wait_event FROM pg_stat_activity WHERE state = 'active';

-- 테이블 통계 (live/dead tuple 확인)
SELECT relname, n_live_tup, n_dead_tup, last_vacuum, last_autovacuum
FROM pg_stat_user_tables;

-- 캐시 히트율 확인 (99% 이상이 이상적이다)
SELECT
  sum(heap_blks_hit) / NULLIF(sum(heap_blks_hit) + sum(heap_blks_read), 0) AS cache_hit_ratio
FROM pg_statio_user_tables;

-- 인덱스 사용률 확인
SELECT relname, idx_scan, seq_scan,
       round(idx_scan::numeric / NULLIF(idx_scan + seq_scan, 0) * 100, 2) AS idx_ratio
FROM pg_stat_user_tables
ORDER BY seq_scan DESC;
```

### 실습 6: Kubernetes에서 PostgreSQL 관리
```bash
# PVC 확인 (데이터 영속성)
kubectl get pvc -n demo -l app=postgres

# 백업 (pg_dump) — 이 프로젝트 DB: demo, 사용자: demo
kubectl exec -n demo deploy/postgres -- pg_dump -U demo demo > backup.sql

# 복원
cat backup.sql | kubectl exec -i -n demo deploy/postgres -- psql -U demo demo

# 리소스 사용량 확인
kubectl top pod -n demo -l app=postgres
```

---

## 예제

### 예제 1: Kubernetes 배포 매니페스트
```yaml
# postgres-deployment.yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: postgres
  namespace: demo
spec:
  serviceName: postgres
  replicas: 1
  selector:
    matchLabels:
      app: postgres
  template:
    metadata:
      labels:
        app: postgres
    spec:
      containers:
        - name: postgres
          image: postgres:16-alpine
          ports:
            - containerPort: 5432
          env:
            - name: POSTGRES_DB
              value: mydb
            - name: POSTGRES_USER
              valueFrom:
                secretKeyRef:
                  name: postgres-secret
                  key: username
            - name: POSTGRES_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: postgres-secret
                  key: password
          volumeMounts:
            - name: postgres-data
              mountPath: /var/lib/postgresql/data
          resources:
            limits:
              cpu: 500m
              memory: 512Mi
            requests:
              cpu: 100m
              memory: 256Mi
  volumeClaimTemplates:
    - metadata:
        name: postgres-data
      spec:
        accessModes: ["ReadWriteOnce"]
        resources:
          requests:
            storage: 5Gi
---
apiVersion: v1
kind: Service
metadata:
  name: postgres
  namespace: demo
spec:
  selector:
    app: postgres
  ports:
    - port: 5432
      targetPort: 5432
  clusterIP: None  # Headless Service for StatefulSet
```

### 예제 2: 초기화 스크립트
```sql
-- init.sql
-- 데이터베이스 초기화 스크립트이다

CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    product VARCHAR(255) NOT NULL,
    quantity INTEGER DEFAULT 1,
    status VARCHAR(50) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_orders_user_id ON orders(user_id);
CREATE INDEX idx_orders_status ON orders(status);

-- Partial Index: pending 상태만 인덱싱
CREATE INDEX idx_orders_pending ON orders(created_at) WHERE status = 'pending';

-- 샘플 데이터
INSERT INTO orders (user_id, product, quantity, status) VALUES
(1, 'Widget A', 2, 'completed'),
(2, 'Widget B', 1, 'pending'),
(1, 'Widget C', 5, 'shipped');
```

### 예제 3: PgBouncer 설정 (Kubernetes Sidecar)
```yaml
# PgBouncer를 sidecar로 배포하는 예시
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: postgres-with-bouncer
spec:
  serviceName: postgres
  replicas: 1
  selector:
    matchLabels:
      app: postgres
  template:
    metadata:
      labels:
        app: postgres
    spec:
      containers:
        - name: postgres
          image: postgres:16-alpine
          ports:
            - containerPort: 5432
          volumeMounts:
            - name: postgres-data
              mountPath: /var/lib/postgresql/data
        - name: pgbouncer
          image: edoburu/pgbouncer:latest
          ports:
            - containerPort: 6432
          env:
            - name: DATABASE_URL
              value: "postgres://user:pass@localhost:5432/mydb"
            - name: POOL_MODE
              value: "transaction"
            - name: MAX_CLIENT_CONN
              value: "200"
            - name: DEFAULT_POOL_SIZE
              value: "20"
  volumeClaimTemplates:
    - metadata:
        name: postgres-data
      spec:
        accessModes: ["ReadWriteOnce"]
        resources:
          requests:
            storage: 5Gi
```

---

## 자가 점검
- [ ] ACID 트랜잭션의 4가지 속성을 설명할 수 있는가?
- [ ] PostgreSQL의 프로세스 아키텍처(postmaster, backend, background workers)를 설명할 수 있는가?
- [ ] MVCC에서 xmin, xmax의 역할과 tuple visibility를 설명할 수 있는가?
- [ ] VACUUM이 필요한 두 가지 이유(dead tuple 정리, XID wraparound 방지)를 설명할 수 있는가?
- [ ] WAL이 crash recovery를 보장하는 원리를 설명할 수 있는가?
- [ ] 쿼리 실행 파이프라인(parser → analyzer → rewriter → planner → executor)을 설명할 수 있는가?
- [ ] EXPLAIN ANALYZE 출력에서 cost, actual time, rows, buffers를 읽을 수 있는가?
- [ ] B-tree, GIN, BRIN 인덱스의 차이와 적합한 사용 사례를 설명할 수 있는가?
- [ ] Partial Index, Expression Index, Covering Index의 용도를 설명할 수 있는가?
- [ ] PgBouncer의 세 가지 모드(session, transaction, statement)를 비교할 수 있는가?
- [ ] Streaming Replication과 Logical Replication의 차이를 설명할 수 있는가?
- [ ] JSONB 타입의 인덱싱 방법과 연산자를 사용할 수 있는가?
- [ ] RLS(Row-Level Security)를 설정하고 적용할 수 있는가?
- [ ] StatefulSet으로 PostgreSQL을 배포하는 이유를 설명할 수 있는가?
- [ ] CloudNativePG 또는 Zalando Operator의 주요 기능을 설명할 수 있는가?
- [ ] PVC가 왜 데이터베이스에 필수인지 설명할 수 있는가?
- [ ] pg_dump로 백업/복원을 수행할 수 있는가?

---

## 참고문헌

- [PostgreSQL 공식 문서](https://www.postgresql.org/docs/current/) - SQL 레퍼런스, 설정 파라미터, 내부 구조 등 모든 내용을 포함한다
- [PostgreSQL 소스 코드 (GitHub)](https://github.com/postgres/postgres) - 소스 코드와 커밋 히스토리를 확인할 수 있다
- [PostgreSQL Wiki](https://wiki.postgresql.org/) - 튜닝 가이드, FAQ, 모범 사례를 제공한다
- [MVCC 내부 동작](https://www.postgresql.org/docs/current/mvcc.html) - 트랜잭션 격리, snapshot, 가시성 규칙을 상세히 설명한다
- [WAL 설정](https://www.postgresql.org/docs/current/wal-configuration.html) - WAL 관련 파라미터와 튜닝 방법을 제공한다
- [인덱스 타입 문서](https://www.postgresql.org/docs/current/indexes-types.html) - B-tree, Hash, GiST, GIN, BRIN 각 인덱스의 특성을 설명한다
- [PgBouncer 공식 문서](https://www.pgbouncer.org/) - Connection Pooler 설정과 운영 가이드이다
- [CloudNativePG 공식 문서](https://cloudnative-pg.io/documentation/) - Kubernetes PostgreSQL Operator 설치와 운영 가이드이다
- [Zalando Postgres Operator](https://github.com/zalando/postgres-operator) - Patroni 기반 HA Operator이다
- [The Internals of PostgreSQL](https://www.interdb.jp/pg/) - PostgreSQL 내부 구조(MVCC, WAL, 쿼리 처리)를 깊이 있게 설명하는 무료 온라인 서적이다
