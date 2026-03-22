# Redis - 인메모리 데이터 스토어 학습 가이드

총 4일 과정으로 구성된 Redis 학습 가이드이다. 인메모리 키-값 데이터 저장소인 Redis의 내부 구현부터 Kubernetes 환경에서의 운영까지 체계적으로 학습한다.

---

## 학습 일정

### [Day 1: Redis 개념, 아키텍처, 자료구조, 영속성](day01-concepts-architecture-persistence.md)
- Redis 개요 및 핵심 개념 (Key-Value, TTL, Data Types, Persistence, Pub/Sub, Eviction, Pipelining, Transactions, Lua)
- 프로젝트 실습 환경
- 단일 쓰레드 이벤트 루프 아키텍처 (epoll/kqueue, I/O 멀티플렉싱)
- Redis 6+ I/O 쓰레딩
- 내부 인코딩 구조 (SDS, Listpack, Quicklist, Skiplist, Intset, Stream/Radix Tree, Dict 점진적 리해싱)
- RDB 스냅샷 (fork + COW)
- AOF (Append-Only File, fsync 정책, Rewrite)
- RDB + AOF 하이브리드 모드
- 영속성 방식 비교

### [Day 2: 메모리 관리, 복제, Sentinel, Cluster](day02-memory-replication-sentinel-cluster.md)
- jemalloc 메모리 할당자
- maxmemory 설정 및 Eviction 정책 8가지
- LRU 근사 알고리즘 (sampling, eviction pool)
- LFU (Morris Counter, 감쇠)
- 메모리 단편화 및 Active Defragmentation
- 키 만료 메커니즘 (Passive + Active Deletion, Lazy-Free)
- 마스터-레플리카 비동기 복제
- PSYNC 부분 동기화 및 Replication Backlog
- 디스크리스 복제
- Redis Sentinel (모니터링, 자동 장애 조치, SDOWN/ODOWN, Leader Election, Split-Brain 방지)
- Redis Cluster (해시 슬롯, MOVED/ASK 리다이렉션, Gossip Protocol, 리샤딩, Hash Tag)

### [Day 3: Pub/Sub, Streams, 트랜잭션, Lua, ACL, 캐시/Kubernetes 패턴](day03-pubsub-transactions-lua-kubernetes.md)
- 기본 Pub/Sub 및 한계
- Redis Streams (영속적 메시지 큐, Consumer Group, XACK, XCLAIM, XAUTOCLAIM)
- Kafka/RabbitMQ와의 비교
- MULTI/EXEC 트랜잭션 및 WATCH 낙관적 잠금
- Pipelining (RTT 최적화)
- Lua 스크립팅 (EVAL/EVALSHA, KEYS/ARGV, 원자성)
- Redis 7+ Function
- ACL (Access Control Lists, 사용자별 명령/키 접근 제어)
- 캐시 패턴 (Cache-Aside, Write-Through, Write-Behind)
- Kubernetes 패턴 (Sidecar 캐시, Sentinel on K8s, Redis Cluster Operator)

### [Day 4: 실습, 예제, 자가 점검, 참고문헌](day04-labs-examples-and-review.md)
- 실습 1~10: Redis 접속, 기본 명령어, Sorted Set 리더보드, Stream 조작, Pipeline과 Transaction, 메모리 분석, Pub/Sub 체험, Sentinel 상태 확인, ACL 관리, Kubernetes에서 Redis 관리
- 예제 1: Kubernetes 배포 매니페스트 (Deployment + Service)
- 예제 2: Cache-Aside 패턴 (의사코드)
- 예제 3: Rate Limiter (Fixed Window + Sliding Window Lua)
- 예제 4: 분산 락 (SET NX PX + Redlock 알고리즘)
- 예제 5: 세션 저장소 (Session Store)
- 예제 6: Redis Sentinel 구성 파일
- 예제 7: Redis Cluster 구성
- 자가 점검
- 참고문헌
