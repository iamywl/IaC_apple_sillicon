# Day 1: 개념 및 아키텍처 심화

> PostgreSQL의 기본 개념, 프로세스 아키텍처(Postmaster, Backend, Background Workers), 공유 메모리 구조(Shared Buffers, WAL Buffers, CLOG), 물리 저장 구조(TOAST, Tablespace)를 학습한다.

---

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

#### Postmaster 상세 동작

Postmaster는 PostgreSQL 인스턴스의 최상위 프로세스로서, UNIX 도메인 소켓과 TCP 소켓 모두에서 클라이언트 연결을 대기한다. 새 연결이 도착하면 다음 과정을 거친다.

1. **연결 수락(accept)**: 클라이언트의 TCP 연결을 수락한다
2. **인증(authentication)**: pg_hba.conf 규칙에 따라 클라이언트를 인증한다
3. **fork()**: 인증에 성공하면 새 backend 프로세스를 fork한다
4. **연결 핸드오프**: fork된 backend 프로세스가 클라이언트 소켓을 인계받아 통신한다

```bash
# tart-infra 프로젝트에서 postmaster 프로세스 확인
export KUBECONFIG=kubeconfig/dev.yaml
kubectl exec -it -n demo deploy/postgres -- ps aux
# PID 1이 postmaster이며, 나머지는 background worker와 backend 프로세스이다
```

Postmaster는 자식 프로세스의 상태를 감시하며, backend 프로세스가 비정상 종료하면 데이터 무결성 보호를 위해 **모든 자식 프로세스를 종료하고 recovery를 수행**한다. 이것이 하나의 backend 크래시가 일시적으로 모든 연결에 영향을 주는 이유이다.

#### Backend Process 상세

각 backend 프로세스는 다음 구성 요소를 포함한다.

```
┌────────────────────────────────────────────────┐
│              Backend Process                    │
│                                                 │
│  ┌─────────────┐  ┌──────────────────────────┐ │
│  │ Parser      │  │ Local Memory             │ │
│  │ Analyzer    │  │  ├── work_mem            │ │
│  │ Rewriter    │  │  ├── maintenance_work_mem│ │
│  │ Planner     │  │  ├── temp_buffers        │ │
│  │ Executor    │  │  └── catalog cache       │ │
│  └─────────────┘  └──────────────────────────┘ │
│                                                 │
│  ┌──────────────────────────────────────────┐  │
│  │ Shared Memory 접근 (포인터)               │  │
│  │  ├── shared_buffers                       │  │
│  │  ├── WAL buffers                          │  │
│  │  ├── CLOG buffers                         │  │
│  │  └── lock tables                          │  │
│  └──────────────────────────────────────────┘  │
└────────────────────────────────────────────────┘
```

- **work_mem**: 정렬(ORDER BY), 해시 조인, DISTINCT 등에 사용되는 쿼리당 메모리이다. 기본값은 4MB이다
- **maintenance_work_mem**: VACUUM, CREATE INDEX, ALTER TABLE ADD FOREIGN KEY 등 유지보수 작업에 사용된다. 기본값은 64MB이다
- **temp_buffers**: 임시 테이블 접근에 사용되는 로컬 버퍼이다

#### Background Workers 상세

PostgreSQL 9.3부터 사용자 정의 background worker를 등록할 수 있게 되었다. 이를 활용하는 대표적인 확장이 pg_cron, TimescaleDB 등이다.

```sql
-- 실행 중인 background worker 확인
SELECT pid, backend_type, wait_event
FROM pg_stat_activity
WHERE backend_type != 'client backend';
```

| Background Worker | 기본 동작 | 설정 파라미터 |
|-------------------|-----------|---------------|
| **autovacuum launcher** | dead tuple 비율 기반으로 autovacuum worker를 생성한다 | `autovacuum = on` |
| **autovacuum worker** | 개별 테이블에 대해 VACUUM/ANALYZE를 수행한다 | `autovacuum_max_workers = 3` |
| **bgwriter** | dirty buffer를 점진적으로 디스크에 기록한다 | `bgwriter_delay = 200ms` |
| **checkpointer** | 주기적/조건부 checkpoint를 수행한다 | `checkpoint_timeout = 5min` |
| **walwriter** | WAL 버퍼를 디스크에 기록한다 | `wal_writer_delay = 200ms` |
| **logical replication launcher** | logical replication worker를 관리한다 | `max_logical_replication_workers` |

#### Shared Memory 구성 요소

- **shared_buffers**: 디스크에서 읽은 테이블/인덱스 페이지를 캐시하는 공유 버퍼 풀이다. 일반적으로 전체 메모리의 25%로 설정한다
- **WAL Buffers**: WAL 레코드를 디스크에 쓰기 전 임시 저장하는 버퍼이다. `wal_buffers` 파라미터로 크기를 조정한다
- **CLOG (Commit Log)**: 각 트랜잭션의 커밋/롤백 상태를 기록하는 구조체이다. MVCC의 tuple visibility 판단에 사용된다

#### Shared Memory 상세 구조

Shared Memory는 PostgreSQL 인스턴스 시작 시 한 번 할당되며, 모든 backend 프로세스가 공유한다. System V shared memory 또는 POSIX shared memory(mmap)를 사용한다.

```
┌────────────────────────────────────────────────────────────┐
│                    Shared Memory 상세                       │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Shared Buffers (Buffer Pool)                         │  │
│  │  ┌────┐┌────┐┌────┐┌────┐┌────┐┌────┐              │  │
│  │  │ 8KB││ 8KB││ 8KB││ 8KB││ 8KB││ ...│  (8KB pages) │  │
│  │  └────┘└────┘└────┘└────┘└────┘└────┘              │  │
│  │  Buffer Descriptor: tag, flags(dirty/valid/pinned)   │  │
│  │  Clock-sweep 알고리즘으로 교체 대상 선정               │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌──────────────────┐ ┌──────────────────────────────────┐│
│  │ WAL Buffers      │ │ Lock Manager                      ││
│  │ (기본 -1 = auto) │ │  ├── Regular Locks (테이블/행)     ││
│  │                  │ │  ├── Lightweight Locks (내부)      ││
│  │ wal_buffers 설정 │ │  └── Predicate Locks (SSI)        ││
│  └──────────────────┘ └──────────────────────────────────┘│
│                                                             │
│  ┌──────────────────┐ ┌──────────────────────────────────┐│
│  │ CLOG Buffers     │ │ Proc Array                        ││
│  │ (pg_xact/)       │ │ (활성 트랜잭션 목록)                ││
│  │ 2bit per tx:     │ │                                    ││
│  │ 00=진행중        │ │ PGPROC 구조체 배열                  ││
│  │ 01=커밋          │ │ max_connections + aux workers      ││
│  │ 10=롤백          │ │                                    ││
│  │ 11=서브트랜잭션  │ │                                    ││
│  └──────────────────┘ └──────────────────────────────────┘│
└────────────────────────────────────────────────────────────┘
```

**Buffer Pool의 Clock-sweep 알고리즘**:
- 각 버퍼 디스크립터에 usage_count(0~5)가 있다
- 페이지가 접근될 때마다 usage_count가 증가한다 (최대 5)
- 새 페이지를 로드할 공간이 필요하면, clock hand가 순환하며 usage_count를 1씩 감소시킨다
- usage_count가 0인 버퍼를 교체 대상으로 선정한다
- 자주 접근되는 "hot" 페이지는 높은 usage_count를 유지하여 교체되지 않는다

```sql
-- tart-infra 프로젝트에서 shared memory 설정 확인
-- kubectl exec -it -n demo deploy/postgres -- psql -U demo -d demo
SHOW shared_buffers;      -- 기본값: 128MB
SHOW wal_buffers;         -- 기본값: -1 (자동 계산, shared_buffers의 1/32)
SHOW huge_pages;          -- Linux에서 huge pages 사용 여부
```

### 파일 시스템 레이아웃

PostgreSQL의 데이터 디렉터리(PGDATA)는 엄격한 구조를 따른다.

```
$PGDATA/
├── base/                    # 데이터베이스별 디렉터리
│   ├── 1/                   # template1 (OID=1)
│   ├── 12345/               # 사용자 데이터베이스 (OID=12345)
│   │   ├── 16384            # 테이블/인덱스 파일 (relfilenode)
│   │   ├── 16384.1          # 1GB 초과 시 분할 파일
│   │   ├── 16384_fsm        # Free Space Map
│   │   └── 16384_vm         # Visibility Map
│   └── 13000/               # 다른 데이터베이스
│
├── global/                  # 클러스터 전역 테이블 (pg_database, pg_authid 등)
│
├── pg_wal/                  # WAL 세그먼트 파일 (16MB 단위)
│   ├── 000000010000000000000001
│   ├── 000000010000000000000002
│   └── archive_status/      # WAL 아카이빙 상태
│
├── pg_xact/                 # Commit Log (CLOG) — 트랜잭션 상태 기록
│   └── 0000                 # 각 파일은 256KB, 트랜잭션당 2비트
│
├── pg_multixact/            # Multi-transaction 상태 (FOR SHARE 잠금 등)
│
├── pg_subtrans/             # 서브트랜잭션 → 부모 트랜잭션 매핑
│
├── pg_twophase/             # 2PC(PREPARE TRANSACTION) 상태 파일
│
├── pg_stat_tmp/             # 임시 통계 파일
│
├── pg_logical/              # Logical replication 상태
│
├── pg_tblspc/               # 테이블스페이스 심볼릭 링크
│
├── postgresql.conf          # 메인 설정 파일
├── pg_hba.conf              # 클라이언트 인증 설정
├── pg_ident.conf            # 사용자 매핑 설정
├── PG_VERSION               # PostgreSQL 메이저 버전
├── postmaster.pid           # PID 파일, 포트, 소켓 경로 등
└── postmaster.opts          # 시작 시 사용된 옵션
```

```bash
# tart-infra 프로젝트에서 데이터 디렉터리 구조 확인
export KUBECONFIG=kubeconfig/dev.yaml
kubectl exec -it -n demo deploy/postgres -- ls -la /var/lib/postgresql/data/

# 데이터베이스 OID 확인
kubectl exec -it -n demo deploy/postgres -- psql -U demo -d demo \
  -c "SELECT oid, datname FROM pg_database;"

# 테이블의 물리 파일 위치 확인
kubectl exec -it -n demo deploy/postgres -- psql -U demo -d demo \
  -c "SELECT pg_relation_filepath('users');"
```

#### 페이지 구조 (8KB Block)

PostgreSQL의 모든 데이터 파일은 8KB(기본값) 페이지로 구성된다.

```
┌───────────────────────────────────────────────────────────┐
│                     Page (8KB = 8192 bytes)                │
│                                                           │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ Page Header (24 bytes)                               │ │
│  │  - pd_lsn: 이 페이지를 마지막으로 수정한 WAL LSN     │ │
│  │  - pd_checksum: 페이지 체크섬 (data checksums 활성)  │ │
│  │  - pd_lower: free space 시작 위치                    │ │
│  │  - pd_upper: free space 끝 위치                      │ │
│  │  - pd_special: 특수 공간 시작 (인덱스용)              │ │
│  └─────────────────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ Item Pointers (Line Pointers)                        │ │
│  │  [lp1] → offset, length  (tuple 1 위치)              │ │
│  │  [lp2] → offset, length  (tuple 2 위치)              │ │
│  │  [lp3] → offset, length  (tuple 3 위치)              │ │
│  │   ...     ↓ (아래로 증가)                             │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                           │
│  ┌─────────────────────────────────────────────────────┐ │
│  │                Free Space                            │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                           │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ Tuples (Heap Tuples)        ↑ (위로 증가)            │ │
│  │  [Tuple 3] HeapTupleHeader + Data                    │ │
│  │  [Tuple 2] HeapTupleHeader + Data                    │ │
│  │  [Tuple 1] HeapTupleHeader + Data                    │ │
│  └─────────────────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ Special Space (B-tree 등 인덱스 전용)                 │ │
│  └─────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────┘
```

Item Pointer와 Tuple이 반대 방향에서 자라면서, 중간의 free space가 줄어드는 구조이다. 이 구조 덕분에 tuple의 물리적 위치를 변경해도 item pointer만 갱신하면 된다.

```sql
-- pageinspect 확장으로 페이지 내부를 직접 확인할 수 있다
-- (관리자 권한 필요)
CREATE EXTENSION IF NOT EXISTS pageinspect;

-- 페이지 헤더 확인
SELECT * FROM page_header(get_raw_page('users', 0));

-- 개별 tuple 확인
SELECT lp, lp_off, lp_len, t_xmin, t_xmax, t_ctid
FROM heap_page_items(get_raw_page('users', 0));
```

#### TOAST (The Oversized-Attribute Storage Technique)

PostgreSQL은 하나의 tuple이 한 페이지(8KB)에 들어가야 한다는 제약이 있다. 이보다 큰 컬럼 값은 TOAST 메커니즘으로 처리한다.

TOAST 전략은 4가지이다.

| 전략 | 이름 | 동작 |
|------|------|------|
| `p` | **plain** | TOAST를 사용하지 않는다. 고정 길이 타입(integer 등)에 해당한다 |
| `e` | **extended** | 외부 TOAST 테이블에 저장하고, 먼저 압축을 시도한다 (기본값) |
| `m` | **main** | 메인 테이블에 압축 저장을 시도하고, 안 되면 외부로 이동한다 |
| `x` | **external** | 압축 없이 외부 TOAST 테이블에 저장한다 |

```sql
-- 테이블의 TOAST 전략 확인
SELECT attname, atttypid::regtype, attstorage
FROM pg_attribute
WHERE attrelid = 'users'::regclass AND attnum > 0;

-- TOAST 테이블 크기 확인
SELECT pg_size_pretty(pg_total_relation_size('users')) AS total,
       pg_size_pretty(pg_relation_size('users')) AS main,
       pg_size_pretty(pg_total_relation_size('users') - pg_relation_size('users')) AS toast_and_index;
```

---

