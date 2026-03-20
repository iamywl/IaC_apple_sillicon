# Day 4: EXPLAIN 분석 및 인덱스 타입

> EXPLAIN ANALYZE 출력 해석, Bitmap Scan, 주요 Node Types, 그리고 B-tree, GIN, GiST, BRIN, Hash 인덱스의 내부 구조와 활용법, Partial/Expression/Covering Index를 학습한다.

---

## EXPLAIN 분석 심화

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

### EXPLAIN 주요 옵션 조합

```sql
-- 기본 실행 계획만 (실제 실행하지 않음)
EXPLAIN SELECT * FROM orders WHERE user_id = 1;

-- 실제 실행 + 시간 측정
EXPLAIN ANALYZE SELECT * FROM orders WHERE user_id = 1;

-- 버퍼 사용량 포함 (반드시 ANALYZE와 함께)
EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM orders WHERE user_id = 1;

-- JSON 포맷 (프로그래밍적 분석에 유용)
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT * FROM orders WHERE user_id = 1;

-- YAML 포맷
EXPLAIN (ANALYZE, BUFFERS, FORMAT YAML) SELECT * FROM orders WHERE user_id = 1;

-- VERBOSE: 출력 컬럼, 스키마 정보 포함
EXPLAIN (ANALYZE, VERBOSE, BUFFERS) SELECT * FROM orders WHERE user_id = 1;

-- SETTINGS: 기본값과 다른 설정 표시 (v12+)
EXPLAIN (ANALYZE, SETTINGS) SELECT * FROM orders WHERE user_id = 1;

-- WAL: WAL 생성량 표시 (v13+, INSERT/UPDATE/DELETE에 유용)
EXPLAIN (ANALYZE, WAL) INSERT INTO orders (user_id, product) VALUES (1, 'test');
```

### 주요 EXPLAIN Node Types

```sql
-- Scan Nodes (데이터 접근)
-- Seq Scan: 테이블 전체 순차 스캔
-- Index Scan: 인덱스로 조건 검색 후 heap 접근
-- Index Only Scan: 인덱스만으로 응답 (heap 미접근, VM 활용)
-- Bitmap Index Scan + Bitmap Heap Scan: 인덱스로 비트맵 생성 후 heap 일괄 접근
-- TID Scan: ctid로 직접 접근

-- Join Nodes
-- Nested Loop: 중첩 루프
-- Hash Join: 해시 테이블 기반 조인
-- Merge Join: 정렬 후 병합 조인

-- Aggregation Nodes
-- Aggregate: 일반 집계 (count, sum 등)
-- HashAggregate: 해시 기반 GROUP BY
-- GroupAggregate: 정렬 기반 GROUP BY

-- Sort/Unique Nodes
-- Sort: 정렬 (work_mem 초과 시 디스크 사용)
-- Incremental Sort: 부분 정렬 활용 (v13+)
-- Unique: 중복 제거

-- Set Operations
-- Append: UNION ALL
-- MergeAppend: 정렬된 UNION ALL
-- HashSetOp: EXCEPT, INTERSECT

-- Subquery Nodes
-- SubPlan: 상관 서브쿼리
-- InitPlan: 비상관 서브쿼리 (한 번 실행)
-- Materialize: 서브쿼리 결과를 메모리에 저장
```

### Bitmap Scan 이해

```sql
-- Bitmap Scan은 인덱스와 순차 스캔의 중간 전략이다
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM orders WHERE user_id IN (1, 2, 3, 4, 5);

-- 출력 예시:
-- Bitmap Heap Scan on orders
--   Recheck Cond: (user_id = ANY('{1,2,3,4,5}'))
--   Heap Blocks: exact=3
--   -> Bitmap Index Scan on idx_orders_user_id
--        Index Cond: (user_id = ANY('{1,2,3,4,5}'))

-- 동작 과정:
-- 1. Bitmap Index Scan: 인덱스에서 조건에 맞는 페이지 번호를 비트맵으로 수집
-- 2. 비트맵 정렬 (물리적 페이지 순서)
-- 3. Bitmap Heap Scan: 정렬된 순서로 heap 페이지를 읽음
-- → 랜덤 I/O를 순차 I/O에 가깝게 변환하여 성능 향상

-- 여러 인덱스를 BitmapAnd/BitmapOr로 결합 가능
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM orders WHERE user_id = 1 AND status = 'pending';
-- BitmapAnd
--   -> Bitmap Index Scan on idx_orders_user_id
--   -> Bitmap Index Scan on idx_orders_status
```

### EXPLAIN 분석 실전 패턴

```sql
-- 패턴 1: 예상 vs 실제 행 수 차이가 큰 경우 → 통계 부정확
-- estimated rows=1 vs actual rows=10000
-- 해결: ANALYZE 실행 또는 statistics target 증가

-- 패턴 2: Sort에서 "Sort Method: external merge Disk" 표시
-- → work_mem 부족으로 디스크 정렬 발생
-- 해결: SET work_mem = '256MB'; (세션 레벨)

-- 패턴 3: Buffers: shared read 가 매우 크고 hit 가 적음
-- → shared_buffers 부족 또는 테이블이 너무 큼
-- 해결: shared_buffers 증가 또는 파티셔닝 적용

-- 패턴 4: Nested Loop의 inner 쪽 loops 수가 매우 큼
-- → 외부 테이블이 크고 인덱스 없이 반복 스캔
-- 해결: 조인 키에 인덱스 생성 또는 Hash Join 유도

-- 패턴 5: Index Scan 대신 Seq Scan이 선택됨
-- 원인 1: 테이블이 작아서 Seq Scan이 더 효율적
-- 원인 2: 조건에 맞는 행이 전체의 큰 비율
-- 원인 3: random_page_cost가 너무 높음 (HDD 기준)
-- 원인 4: 통계가 부정확함
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

### B-tree Internals

B-tree는 PostgreSQL의 기본 인덱스 타입으로, 가장 범용적이다. Lehman-Yao 알고리즘을 기반으로 하여 동시성을 보장한다.

```
B-tree 구조 (branching factor 예시):

         ┌──────────────────────┐
         │   Root Page          │
         │  [30] [60]           │
         └──┬──────┬──────┬────┘
            │      │      │
     ┌──────┘      │      └──────┐
     ▼             ▼             ▼
┌─────────┐ ┌─────────┐ ┌─────────┐
│Internal │ │Internal │ │Internal │
│ [10][20]│ │ [40][50]│ │ [70][80]│
└─┬──┬──┬┘ └─┬──┬──┬┘ └─┬──┬──┬┘
  │  │  │    │  │  │    │  │  │
  ▼  ▼  ▼    ▼  ▼  ▼    ▼  ▼  ▼
┌───┐┌───┐  ┌───┐       ┌───┐
│Leaf││Leaf│  │Leaf│  ...  │Leaf│
│1-9 ││10- │  │30- │       │80+│
│    ││ 19 │  │ 39 │       │   │
└──→┘└──→┘  └──→┘       └───┘
   right-link (형제 leaf 간 연결)

Leaf Page 내부:
  - 정렬된 인덱스 엔트리 (key + ctid)
  - 인접 leaf 페이지로의 포인터 (양방향)
  - 범위 스캔 시 leaf 페이지를 순차적으로 따라갈 수 있다
```

```sql
-- B-tree 메타 정보 확인
CREATE EXTENSION IF NOT EXISTS pageinspect;

-- B-tree 루트 페이지 확인
SELECT * FROM bt_metap('idx_users_email');
-- root: 루트 페이지 번호
-- level: 트리 깊이 (0=leaf만, 1=root+leaf, ...)

-- B-tree 페이지 내용 확인
SELECT * FROM bt_page_items('idx_users_email', 1) LIMIT 5;
-- itemoffset, ctid, itemlen, data
```

#### B-tree 연산 복잡도

| 연산 | 복잡도 | 설명 |
|------|--------|------|
| 검색 (=) | O(log N) | 루트에서 리프까지 트리 탐색 |
| 범위 검색 | O(log N + M) | 시작점까지 트리 탐색 + M개 리프 순회 |
| INSERT | O(log N) | 리프 페이지 찾기 + 삽입 (페이지 분할 가능) |
| DELETE | O(log N) | 항목 찾기 + 삭제 표시 (실제 제거는 VACUUM) |

#### Deduplication (v13+)

PostgreSQL 13부터 B-tree 인덱스는 중복 키를 효율적으로 저장한다.

```sql
-- v13 이전: 같은 키 값이 여러 인덱스 엔트리로 저장
-- key=1, ctid=(0,1)
-- key=1, ctid=(0,5)
-- key=1, ctid=(1,3)

-- v13 이후: 같은 키 값은 하나의 "posting list"로 통합
-- key=1, ctids=[(0,1), (0,5), (1,3)]
-- → 인덱스 크기 감소, 특히 저카디널리티 컬럼에 효과적
```

### GiST (Generalized Search Tree) 상세

GiST는 균형 트리 구조의 확장 가능한 인덱스 프레임워크이다.

```sql
-- 기하학적 데이터 인덱싱
CREATE TABLE places (
    id SERIAL PRIMARY KEY,
    name TEXT,
    location POINT
);

CREATE INDEX idx_places_location ON places USING gist(location);

-- 근접 검색 (KNN: K-Nearest Neighbors)
SELECT name, location <-> point(37.5665, 126.9780) AS distance
FROM places
ORDER BY location <-> point(37.5665, 126.9780)
LIMIT 5;
-- GiST 인덱스로 KNN 검색이 효율적으로 수행된다

-- 범위 타입 인덱싱
CREATE INDEX idx_reservations_during ON reservations USING gist(during);
SELECT * FROM reservations WHERE during && tsrange('2024-06-01', '2024-06-30');

-- 전문 검색 인덱싱
CREATE INDEX idx_docs_content ON documents USING gist(to_tsvector('korean', content));
```

### GIN (Generalized Inverted Index) 상세

GIN은 "역인덱스"로, 하나의 행이 여러 키를 가질 수 있는 데이터에 최적이다.

```
GIN 구조 (역인덱스):

  Key       │  Posting List (ctids)
  ──────────┼──────────────────────
  "sale"    │  (0,1), (2,3), (5,1)
  "featured"│  (0,1), (3,2)
  "new"     │  (1,4), (4,2)
  "premium" │  (2,3), (3,2), (5,1)

  검색: "sale" AND "featured"
  → posting list 교집합: (0,1)
```

```sql
-- JSONB에 대한 GIN 인덱스 전략
-- 1. jsonb_ops (기본): 모든 JSONB 연산자 지원
CREATE INDEX idx_events_data ON events USING gin(data);
-- 지원 연산자: @>, ?, ?|, ?&, @?, @@

-- 2. jsonb_path_ops: @> 연산자만 지원하지만 크기가 2~3배 작다
CREATE INDEX idx_events_data_path ON events USING gin(data jsonb_path_ops);
-- 지원 연산자: @> 만

-- 배열에 대한 GIN 인덱스
CREATE INDEX idx_products_tags ON products USING gin(tags);
SELECT * FROM products WHERE tags @> ARRAY['sale', 'featured'];

-- 전문 검색(Full-Text Search) GIN 인덱스
CREATE INDEX idx_docs_search ON documents USING gin(to_tsvector('english', content));
SELECT * FROM documents
WHERE to_tsvector('english', content) @@ to_tsquery('english', 'postgresql & performance');

-- GIN의 pending list와 fastupdate
-- GIN INSERT는 느릴 수 있어서, pending list에 모았다가 일괄 처리
-- fastupdate=off로 즉시 반영도 가능 (INSERT 시 느려짐)
ALTER INDEX idx_events_data SET (fastupdate = off);
-- pending list를 수동으로 정리
SELECT gin_clean_pending_list('idx_events_data');
```

### BRIN (Block Range Index) 상세

BRIN은 연속된 heap 블록 범위의 요약 정보를 저장한다. 물리적으로 정렬된 데이터에 대해 극소량의 저장 공간으로 효과적인 필터링을 제공한다.

```
BRIN 구조 (pages_per_range = 128):

  Block Range │ Min        │ Max
  ────────────┼────────────┼────────────
  0-127       │ 2024-01-01 │ 2024-01-15
  128-255     │ 2024-01-15 │ 2024-01-31
  256-383     │ 2024-02-01 │ 2024-02-14
  384-511     │ 2024-02-14 │ 2024-02-28

  검색: WHERE created_at = '2024-02-10'
  → block range 256-383만 스캔 (나머지 skip)
```

```sql
-- 시계열 데이터에 BRIN 인덱스 적용
CREATE TABLE sensor_data (
    id BIGSERIAL PRIMARY KEY,
    sensor_id INTEGER,
    reading DOUBLE PRECISION,
    recorded_at TIMESTAMP NOT NULL
);

-- BRIN 인덱스 (B-tree 대비 1/100 이하 크기)
CREATE INDEX idx_sensor_brin ON sensor_data USING brin(recorded_at)
  WITH (pages_per_range = 128);

-- 인덱스 크기 비교
-- B-tree: 수백 MB ~ GB
-- BRIN: 수십 KB ~ MB

-- BRIN이 효과적인 조건:
-- 1. 데이터가 물리적으로 정렬되어 있다 (correlation ≈ 1.0)
-- 2. 대용량 테이블이다 (수천만 행 이상)
-- 3. 범위 검색이 주요 패턴이다

-- correlation 확인
SELECT attname, correlation
FROM pg_stats
WHERE tablename = 'sensor_data' AND attname = 'recorded_at';
-- correlation이 1.0에 가까울수록 BRIN이 효과적이다
```

### Hash Index

```sql
-- Hash 인덱스는 등호(=) 비교에만 사용된다
-- PostgreSQL 10 이전에는 WAL을 기록하지 않아 crash-unsafe했다
-- PostgreSQL 10+에서는 WAL 기록이 추가되어 안전하다

CREATE INDEX idx_users_email_hash ON users USING hash(email);

-- Hash vs B-tree:
-- Hash: 등호만 가능, 정렬/범위 불가, 크기가 약간 작을 수 있음
-- B-tree: 등호/범위/정렬/LIKE 가능, 범용적
-- 대부분의 경우 B-tree로 충분하다
```

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

#### Index-Only Scan 상세

```sql
-- Index-Only Scan은 heap 테이블에 접근하지 않고 인덱스만으로 결과를 반환한다
-- 조건: 쿼리에 필요한 모든 컬럼이 인덱스에 포함되어 있어야 한다
-- 추가 조건: 해당 페이지가 all-visible (VM에서 확인)이어야 한다

-- Covering Index를 활용한 Index-Only Scan
CREATE INDEX idx_orders_cover ON orders(user_id) INCLUDE (product, status);

EXPLAIN (ANALYZE, BUFFERS)
SELECT user_id, product, status FROM orders WHERE user_id = 1;
-- Index Only Scan using idx_orders_cover on orders
--   Index Cond: (user_id = 1)
--   Heap Fetches: 0  ← 0이면 완벽한 Index-Only Scan
--   Buffers: shared hit=2

-- Heap Fetches > 0이면 VM에서 all-visible이 아닌 페이지가 있다는 의미
-- VACUUM을 실행하면 VM이 갱신되어 Heap Fetches가 줄어든다
VACUUM orders;
```

#### 인덱스 유지보수

```sql
-- 인덱스 크기 확인
SELECT indexname, pg_size_pretty(pg_relation_size(indexname::regclass)) AS size
FROM pg_indexes
WHERE tablename = 'orders'
ORDER BY pg_relation_size(indexname::regclass) DESC;

-- 사용되지 않는 인덱스 찾기
SELECT indexrelname, idx_scan, idx_tup_read, idx_tup_fetch,
       pg_size_pretty(pg_relation_size(indexrelid)) AS size
FROM pg_stat_user_indexes
WHERE idx_scan = 0  -- 한 번도 사용되지 않은 인덱스
ORDER BY pg_relation_size(indexrelid) DESC;
-- 주의: pg_stat_user_indexes 통계는 pg_stat_reset() 이후부터 집계된다

-- 인덱스 bloat 확인 (비효율적 인덱스 감지)
-- 인덱스 재생성 (CONCURRENTLY로 잠금 최소화)
CREATE INDEX CONCURRENTLY idx_orders_user_id_new ON orders(user_id);
DROP INDEX idx_orders_user_id;
ALTER INDEX idx_orders_user_id_new RENAME TO idx_orders_user_id;

-- REINDEX (잠금 발생, 짧은 시간)
REINDEX INDEX idx_orders_user_id;
-- REINDEX CONCURRENTLY (v12+, 잠금 최소화)
REINDEX INDEX CONCURRENTLY idx_orders_user_id;
```

---
