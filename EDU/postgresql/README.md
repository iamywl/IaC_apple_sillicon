# PostgreSQL - 관계형 데이터베이스

## 학습 가이드

PostgreSQL의 내부 구조부터 Kubernetes 운영까지 8일 과정으로 구성된 학습 가이드이다. MVCC, WAL, 쿼리 최적화, 인덱싱, 파티셔닝, 복제, 성능 튜닝, 보안, 트러블슈팅 등을 체계적으로 학습할 수 있다.

### 학습 일정

| Day | 주제 | 파일 | 핵심 내용 |
|-----|------|------|----------|
| 1 | 개념 및 아키텍처 심화 | [day01-architecture.md](day01-architecture.md) | 프로세스 아키텍처, Shared Memory, Backend/Background Workers, 물리 저장 구조, TOAST |
| 2 | MVCC 심화 | [day02-mvcc.md](day02-mvcc.md) | xmin/xmax, Snapshot Isolation, 격리 수준, HOT Update, VACUUM, Autovacuum, XID Wraparound |
| 3 | WAL 및 쿼리 실행 과정 | [day03-wal-query-execution.md](day03-wal-query-execution.md) | WAL 구조, Checkpoint, LSN, synchronous_commit, PITR, 쿼리 파이프라인, Join 전략 |
| 4 | EXPLAIN 분석 및 인덱스 타입 | [day04-explain-indexes.md](day04-explain-indexes.md) | EXPLAIN ANALYZE 해석, Bitmap Scan, B-tree/GIN/GiST/BRIN, Partial/Covering Index |
| 5 | 파티셔닝, Connection Pooling, Replication | [day05-partitioning-pooling-replication.md](day05-partitioning-pooling-replication.md) | Range/List/Hash Partitioning, PgBouncer, Streaming/Logical Replication |
| 6 | 성능 튜닝, 보안, Backup, HA, 모니터링 | [day06-tuning-security-backup-ha-monitoring.md](day06-tuning-security-backup-ha-monitoring.md) | 메모리/I/O 튜닝, RLS, pg_hba.conf, pgBackRest, Patroni, pg_stat_activity |
| 7 | 데이터 타입, 확장, 트러블슈팅 | [day07-datatypes-extensions-troubleshooting.md](day07-datatypes-extensions-troubleshooting.md) | JSONB, pgvector, PostGIS, TimescaleDB, Lock/Bloat/Slow Query 진단 |
| 8 | Kubernetes 운영, 실습, 예제, 자가 점검 | [day08-kubernetes-labs-review.md](day08-kubernetes-labs-review.md) | StatefulSet, CloudNativePG, Zalando Operator, 종합 실습, 배포 예제, 자가 점검 |

### 학습 방법

1. Day 1부터 순서대로 학습하는 것을 권장한다. 각 Day는 이전 Day의 내용을 기반으로 한다.
2. 각 Day의 SQL 코드 블록을 직접 실행하며 학습한다. tart-infra 프로젝트의 PostgreSQL Pod에 접속하여 실습할 수 있다.
3. Day 8의 자가 점검 문항으로 전체 학습 내용을 복습한다.

### 전체 구성

- **Day 1~2**: 내부 구조 (아키텍처, MVCC)
- **Day 3~4**: 쿼리 처리 (WAL, 실행 계획, 인덱스)
- **Day 5~6**: 운영 (파티셔닝, 복제, 성능, 보안, HA)
- **Day 7~8**: 확장 및 실전 (데이터 타입, 확장, 트러블슈팅, K8s, 실습)
