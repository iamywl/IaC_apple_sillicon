# Day 8: Kubernetes 운영, 실습, 예제, 자가 점검

> Kubernetes에서의 PostgreSQL 운영(StatefulSet, CloudNativePG, Zalando Operator), 종합 실습(MVCC 확인, EXPLAIN, 모니터링, JSONB, 파티셔닝, RLS), 배포 예제, 자가 점검 문항, 참고문헌을 다룬다.

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

### 실습 7: JSONB 데이터 다루기
```sql
-- tart-infra 프로젝트에서 실습
-- kubectl exec -it -n demo deploy/postgres -- psql -U demo -d demo

-- JSONB 테이블 생성
CREATE TABLE events (
    id SERIAL PRIMARY KEY,
    data JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 데이터 삽입
INSERT INTO events (data) VALUES
('{"type": "pageview", "page": "/home", "user": {"id": 1, "name": "홍길동"}}'),
('{"type": "click", "page": "/products", "user": {"id": 2, "name": "김철수"}, "button": "buy"}'),
('{"type": "pageview", "page": "/about", "user": {"id": 1, "name": "홍길동"}}');

-- 다양한 JSONB 쿼리 실습
SELECT data->>'type' AS event_type, data->'user'->>'name' AS user_name FROM events;
SELECT * FROM events WHERE data @> '{"type": "click"}';
SELECT * FROM events WHERE data ? 'button';
SELECT data->'user'->>'name', count(*) FROM events GROUP BY data->'user'->>'name';

-- GIN 인덱스 생성
CREATE INDEX idx_events_data ON events USING gin(data jsonb_path_ops);
EXPLAIN (ANALYZE) SELECT * FROM events WHERE data @> '{"type": "click"}';
```

### 실습 8: 파티셔닝 실습
```sql
-- 파티션 테이블 생성
CREATE TABLE access_logs (
    id BIGSERIAL,
    path TEXT NOT NULL,
    method TEXT NOT NULL,
    status_code INTEGER,
    response_time_ms INTEGER,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
) PARTITION BY RANGE (created_at);

-- 파티션 생성
CREATE TABLE access_logs_2024_q1 PARTITION OF access_logs
    FOR VALUES FROM ('2024-01-01') TO ('2024-04-01');
CREATE TABLE access_logs_2024_q2 PARTITION OF access_logs
    FOR VALUES FROM ('2024-04-01') TO ('2024-07-01');
CREATE TABLE access_logs_2024_q3 PARTITION OF access_logs
    FOR VALUES FROM ('2024-07-01') TO ('2024-10-01');
CREATE TABLE access_logs_2024_q4 PARTITION OF access_logs
    FOR VALUES FROM ('2024-10-01') TO ('2025-01-01');
CREATE TABLE access_logs_default PARTITION OF access_logs DEFAULT;

-- 데이터 삽입 (자동으로 올바른 파티션에 저장)
INSERT INTO access_logs (path, method, status_code, response_time_ms, created_at)
VALUES ('/api/users', 'GET', 200, 45, '2024-03-15 10:30:00'),
       ('/api/orders', 'POST', 201, 120, '2024-06-20 14:00:00');

-- Partition Pruning 확인
EXPLAIN (ANALYZE)
SELECT * FROM access_logs WHERE created_at >= '2024-04-01' AND created_at < '2024-07-01';
-- → access_logs_2024_q2만 스캔한다
```

### 실습 9: RLS (Row-Level Security) 실습
```sql
-- 주문 테이블 생성
CREATE TABLE orders (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    product TEXT NOT NULL,
    amount NUMERIC NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT NOW()
);

-- 샘플 데이터
INSERT INTO orders (user_id, product, amount) VALUES
(1, '노트북', 1500000),
(2, '키보드', 120000),
(1, '마우스', 50000),
(3, '모니터', 450000);

-- RLS 활성화
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- 정책: 자신의 주문만 조회 가능
CREATE POLICY orders_user_policy ON orders
    FOR ALL
    USING (user_id = current_setting('app.user_id', true)::INTEGER);

-- 테스트 (테이블 소유자가 아닌 다른 role로 테스트해야 한다)
CREATE ROLE app_user LOGIN PASSWORD 'test123';
GRANT SELECT, INSERT, UPDATE, DELETE ON orders TO app_user;
GRANT USAGE ON SEQUENCE orders_id_seq TO app_user;

-- app_user로 접속 후:
SET app.user_id = '1';
SELECT * FROM orders;  -- user_id=1인 주문만 보인다

SET app.user_id = '2';
SELECT * FROM orders;  -- user_id=2인 주문만 보인다
```

### 실습 10: 종합 모니터링 대시보드 쿼리
```sql
-- 이 쿼리들을 tart-infra의 PostgreSQL에서 실행하여 시스템 상태를 종합적으로 확인한다
-- kubectl exec -it -n demo deploy/postgres -- psql -U demo -d demo

-- [1] 데이터베이스 크기와 연결 정보
SELECT datname,
       pg_size_pretty(pg_database_size(datname)) AS size,
       numbackends AS connections
FROM pg_stat_database
WHERE datname NOT LIKE 'template%';

-- [2] 테이블별 크기 Top 10
SELECT relname,
       pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
       pg_size_pretty(pg_relation_size(relid)) AS table_size,
       pg_size_pretty(pg_indexes_size(relid)) AS index_size
FROM pg_stat_user_tables
ORDER BY pg_total_relation_size(relid) DESC
LIMIT 10;

-- [3] 오래된 트랜잭션 확인 (VACUUM 차단 가능)
SELECT pid, usename, state,
       now() - xact_start AS tx_duration,
       now() - query_start AS query_duration,
       left(query, 80) AS query
FROM pg_stat_activity
WHERE xact_start IS NOT NULL
ORDER BY xact_start;

-- [4] PostgreSQL 버전과 주요 설정
SELECT version();
SELECT name, setting, unit, short_desc
FROM pg_settings
WHERE name IN ('shared_buffers', 'effective_cache_size', 'work_mem',
               'maintenance_work_mem', 'max_connections', 'wal_level',
               'max_wal_size', 'checkpoint_timeout', 'random_page_cost');
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

### 예제 4: 전문 검색(Full-Text Search) 구현
```sql
-- 전문 검색 테이블 생성
CREATE TABLE articles (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    search_vector TSVECTOR GENERATED ALWAYS AS (
        setweight(to_tsvector('english', title), 'A') ||
        setweight(to_tsvector('english', content), 'B')
    ) STORED
);

-- GIN 인덱스 생성
CREATE INDEX idx_articles_search ON articles USING gin(search_vector);

-- 데이터 삽입
INSERT INTO articles (title, content) VALUES
('PostgreSQL Performance Tuning', 'Learn how to optimize PostgreSQL queries and configuration'),
('Database Replication Guide', 'Setting up streaming and logical replication in PostgreSQL');

-- 전문 검색 실행
SELECT id, title,
       ts_rank(search_vector, query) AS rank,
       ts_headline('english', content, query) AS highlight
FROM articles,
     to_tsquery('english', 'postgresql & performance') AS query
WHERE search_vector @@ query
ORDER BY rank DESC;
```

### 예제 5: CTE와 Window Function 활용
```sql
-- Recursive CTE: 조직도 계층 구조 조회
CREATE TABLE employees (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    manager_id INTEGER REFERENCES employees(id)
);

INSERT INTO employees (id, name, manager_id) VALUES
(1, 'CEO', NULL),
(2, 'CTO', 1),
(3, 'VP Engineering', 2),
(4, 'Senior Dev', 3),
(5, 'Junior Dev', 4);

WITH RECURSIVE org_tree AS (
    -- Base case: 최상위 (CEO)
    SELECT id, name, manager_id, 0 AS level, name::text AS path
    FROM employees
    WHERE manager_id IS NULL

    UNION ALL

    -- Recursive case: 하위 직원
    SELECT e.id, e.name, e.manager_id, ot.level + 1,
           ot.path || ' > ' || e.name
    FROM employees e
    JOIN org_tree ot ON e.manager_id = ot.id
)
SELECT repeat('  ', level) || name AS org_chart, path
FROM org_tree
ORDER BY path;

-- Window Function: 사용자별 주문 순위와 누적 합계
SELECT user_id, product, amount, created_at,
       ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at) AS order_num,
       SUM(amount) OVER (PARTITION BY user_id ORDER BY created_at) AS running_total,
       LAG(amount) OVER (PARTITION BY user_id ORDER BY created_at) AS prev_amount,
       RANK() OVER (ORDER BY amount DESC) AS amount_rank
FROM orders;
```

---

## 자가 점검
- [ ] ACID 트랜잭션의 4가지 속성을 설명할 수 있는가?
- [ ] PostgreSQL의 프로세스 아키텍처(postmaster, backend, background workers)를 설명할 수 있는가?
- [ ] MVCC에서 xmin, xmax의 역할과 tuple visibility를 설명할 수 있는가?
- [ ] Snapshot Isolation에서 snapshot 구조체(xmin, xmax, xip)의 의미를 설명할 수 있는가?
- [ ] HOT update의 조건과 장점을 설명할 수 있는가?
- [ ] VACUUM이 필요한 두 가지 이유(dead tuple 정리, XID wraparound 방지)를 설명할 수 있는가?
- [ ] VACUUM과 VACUUM FULL의 차이(잠금, 공간 회수 방식)를 설명할 수 있는가?
- [ ] Autovacuum의 발동 조건(threshold + scale_factor * n_live_tup)을 계산할 수 있는가?
- [ ] WAL이 crash recovery를 보장하는 원리를 설명할 수 있는가?
- [ ] LSN, checkpoint, full_page_writes의 관계를 설명할 수 있는가?
- [ ] wal_level의 3가지 값(minimal, replica, logical)의 차이를 설명할 수 있는가?
- [ ] 쿼리 실행 파이프라인(parser → analyzer → rewriter → planner → executor)을 설명할 수 있는가?
- [ ] Cost model의 주요 파라미터(seq_page_cost, random_page_cost 등)를 이해하는가?
- [ ] Nested Loop, Hash Join, Merge Join의 동작 방식과 적합한 상황을 비교할 수 있는가?
- [ ] EXPLAIN ANALYZE 출력에서 cost, actual time, rows, buffers를 읽을 수 있는가?
- [ ] Bitmap Scan의 동작 원리(Bitmap Index Scan → Bitmap Heap Scan)를 설명할 수 있는가?
- [ ] B-tree, GIN, GiST, BRIN 인덱스의 차이와 적합한 사용 사례를 설명할 수 있는가?
- [ ] Partial Index, Expression Index, Covering Index의 용도를 설명할 수 있는가?
- [ ] Index-Only Scan의 조건(Covering Index, Visibility Map)을 이해하는가?
- [ ] Range, List, Hash Partitioning의 차이를 설명할 수 있는가?
- [ ] Partition Pruning의 동작을 EXPLAIN으로 확인할 수 있는가?
- [ ] PgBouncer의 세 가지 모드(session, transaction, statement)를 비교할 수 있는가?
- [ ] Streaming Replication과 Logical Replication의 차이를 설명할 수 있는가?
- [ ] Replication Slot의 역할과 모니터링 중요성을 이해하는가?
- [ ] JSONB 타입의 인덱싱 방법(jsonb_ops vs jsonb_path_ops)과 연산자를 사용할 수 있는가?
- [ ] RLS(Row-Level Security)를 설정하고 적용할 수 있는가?
- [ ] pg_hba.conf에서 SCRAM-SHA-256, SSL 인증을 설정할 수 있는가?
- [ ] pg_stat_statements로 느린 쿼리를 분석할 수 있는가?
- [ ] pg_stat_activity에서 잠금 대기 체인을 분석할 수 있는가?
- [ ] pgBackRest 또는 Barman을 사용한 백업/PITR 복원 절차를 설명할 수 있는가?
- [ ] Patroni의 HA 아키텍처와 자동 failover를 설명할 수 있는가?
- [ ] StatefulSet으로 PostgreSQL을 배포하는 이유를 설명할 수 있는가?
- [ ] CloudNativePG 또는 Zalando Operator의 주요 기능을 설명할 수 있는가?
- [ ] PVC가 왜 데이터베이스에 필수인지 설명할 수 있는가?
- [ ] pg_dump로 백업/복원을 수행할 수 있는가?
- [ ] Connection Exhaustion, Bloat, Replication Lag 문제를 진단하고 해결할 수 있는가?

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
- [pgBackRest 공식 문서](https://pgbackrest.org/) - 엔터프라이즈급 백업/복원 솔루션 가이드이다
- [Patroni 공식 문서](https://patroni.readthedocs.io/) - PostgreSQL HA 솔루션의 설치와 운영 가이드이다
- [pgvector 문서](https://github.com/pgvector/pgvector) - 벡터 유사도 검색 확장의 사용법이다
- [PostGIS 문서](https://postgis.net/documentation/) - 공간 데이터 처리 확장의 레퍼런스이다
- [TimescaleDB 문서](https://docs.timescale.com/) - 시계열 데이터 확장의 가이드이다
- [Use The Index, Luke](https://use-the-index-luke.com/) - SQL 인덱싱과 쿼리 최적화에 대한 무료 온라인 서적이다
- [pganalyze Blog](https://pganalyze.com/blog) - PostgreSQL 성능 분석과 모니터링 관련 심층 글들이다
