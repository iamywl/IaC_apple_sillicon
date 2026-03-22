# Day 4: 실습, 예제, 자가 점검, 참고문헌

> Redis 접속, 기본 명령어, Sorted Set 리더보드, Stream 조작, Pipeline과 Transaction, 메모리 분석, Pub/Sub 체험, Sentinel/ACL/Kubernetes 관리 실습, Kubernetes 배포 매니페스트, Cache-Aside 패턴, Rate Limiter, 분산 락, 세션 저장소, Sentinel/Cluster 구성 예제, 자가 점검, 참고문헌을 다룬다.

## 실습

### 실습 1: Redis 접속

```bash
# Redis Pod 확인
kubectl get pods -n demo -l app=redis

# redis-cli로 접속
kubectl exec -it -n demo deploy/redis -- redis-cli

# 또는 포트포워딩
kubectl port-forward -n demo svc/redis 6379:6379
redis-cli -h localhost
```

### 실습 2: 기본 명령어

```redis
# PING (연결 확인)
PING
# → PONG

# String 타입
SET greeting "Hello Redis"
GET greeting
# → "Hello Redis"

# TTL 설정 (30초 후 만료)
SET session:123 "user_data" EX 30
TTL session:123
# → 28 (남은 초)

# 숫자 증가/감소
SET counter 0
INCR counter
INCR counter
GET counter
# → "2"

# Hash 타입 (객체 저장)
HSET user:1 name "홍길동" email "hong@example.com"
HGET user:1 name
HGETALL user:1

# List 타입 (큐)
LPUSH queue "job1"
LPUSH queue "job2"
RPOP queue
# → "job1"

# Set 타입
SADD tags "redis" "cache" "nosql"
SMEMBERS tags
```

### 실습 3: Sorted Set (리더보드 패턴)

```redis
# 리더보드 생성
ZADD leaderboard 100 "player:alice"
ZADD leaderboard 200 "player:bob"
ZADD leaderboard 150 "player:charlie"
ZADD leaderboard 180 "player:diana"
ZADD leaderboard 95 "player:eve"

# 점수 높은 순으로 전체 조회 (내림차순)
ZREVRANGE leaderboard 0 -1 WITHSCORES
# → player:bob (200), player:diana (180), player:charlie (150), ...

# 상위 3명 조회
ZREVRANGE leaderboard 0 2 WITHSCORES
# → player:bob (200), player:diana (180), player:charlie (150)

# 특정 플레이어 순위 조회 (0-based, 내림차순)
ZREVRANK leaderboard "player:charlie"
# → 2 (3위)

# 특정 점수 범위 조회
ZRANGEBYSCORE leaderboard 100 200 WITHSCORES
# → 100~200 사이의 플레이어

# 점수 증가 (인크리먼트)
ZINCRBY leaderboard 50 "player:alice"
# → 150 (alice의 점수가 100 → 150)

# 리더보드 크기
ZCARD leaderboard
# → 5

# 특정 플레이어 점수 조회
ZSCORE leaderboard "player:bob"
# → "200"

# 내부 인코딩 확인
OBJECT ENCODING leaderboard
# → "listpack" (요소가 적을 때) 또는 "skiplist" (요소가 많을 때)
```

### 실습 4: Stream 조작

```redis
# 스트림에 메시지 추가
XADD events * action "login" user "hong" ip "192.168.1.1"
XADD events * action "purchase" user "hong" item "laptop" price "1200"
XADD events * action "login" user "kim" ip "10.0.0.1"
XADD events * action "logout" user "hong"

# 전체 메시지 조회
XRANGE events - +

# 스트림 길이
XLEN events
# → 4

# Consumer Group 생성
XGROUP CREATE events analytics-group 0

# consumer-1이 메시지 읽기
XREADGROUP GROUP analytics-group consumer-1 COUNT 2 STREAMS events >

# consumer-2가 나머지 메시지 읽기
XREADGROUP GROUP analytics-group consumer-2 COUNT 2 STREAMS events >

# Pending 메시지 확인
XPENDING events analytics-group
# → 4개의 pending 메시지

# 메시지 ACK (처리 완료)
XACK events analytics-group <message-id-1> <message-id-2>

# Pending 메시지 재확인
XPENDING events analytics-group
# → 2개의 pending 메시지 (ACK 안 한 것)

# 블로킹 읽기 (새 메시지 대기, 5초 타임아웃)
XREADGROUP GROUP analytics-group consumer-1 BLOCK 5000 COUNT 1 STREAMS events >
```

### 실습 5: Pipeline과 Transaction

```redis
# 트랜잭션
MULTI
SET user:1:name "홍길동"
SET user:1:email "hong@example.com"
INCR user:1:visit_count
EXEC
# → [OK, OK, 1] (세 명령이 원자적으로 실행됨)

# WATCH를 이용한 낙관적 잠금
WATCH inventory:item1
# 재고 확인 후 차감
MULTI
DECRBY inventory:item1 1
EXEC
# → 다른 클라이언트가 inventory:item1을 변경했다면 nil 반환
```

```bash
# redis-cli에서 파이프라이닝 (대량 데이터 입력)
echo -e "SET key1 val1\nSET key2 val2\nSET key3 val3\nGET key1\nGET key2\nGET key3" | redis-cli --pipe

# 파이프라이닝 성능 벤치마크
redis-benchmark -t set,get -P 16 -q
# -P 16: 한 번에 16개 명령을 파이프라인으로 전송
# → SET: ~500,000 req/s, GET: ~500,000 req/s (P=1 대비 5~10배 향상)
```

### 실습 6: 메모리 분석

```redis
# 서버 메모리 정보 확인
INFO memory
# → used_memory, used_memory_rss, mem_fragmentation_ratio, ...

# 특정 키의 메모리 사용량 (바이트)
SET mykey "Hello World"
MEMORY USAGE mykey
# → 56 (바이트, 키 메타데이터 + 값 포함)

# 메모리 상태 진단
MEMORY DOCTOR
# → "Sam, I have no memory problems" 또는 구체적인 문제 보고

# 메모리 통계 상세
MEMORY STATS

# 메모리 정리 (jemalloc arena purge)
MEMORY PURGE
```

```bash
# 큰 키 찾기 (--bigkeys)
redis-cli --bigkeys
# → 각 타입별로 가장 큰 키를 보고한다
# 예시 출력:
# Biggest string found 'session:large' has 10240 bytes
# Biggest list found 'queue:jobs' has 50000 items
# Biggest hash found 'user:profiles' has 10000 fields

# 메모리 사용량 기준으로 큰 키 찾기 (--memkeys, Redis 7+)
redis-cli --memkeys

# 키 패턴별 분석 (scan 기반, 운영 중에도 안전)
redis-cli --scan --pattern "session:*" | head -20
```

### 실습 7: Pub/Sub 체험

```bash
# 터미널 1: 구독자
kubectl exec -it -n demo deploy/redis -- redis-cli SUBSCRIBE mychannel

# 터미널 2: 발행자
kubectl exec -it -n demo deploy/redis -- redis-cli PUBLISH mychannel "Hello Pub/Sub!"
```

### 실습 8: Sentinel 상태 확인

```redis
# Sentinel에 연결하여 마스터 상태 확인
redis-cli -p 26379

# 모니터링 중인 마스터 목록
SENTINEL masters

# 특정 마스터의 상세 정보
SENTINEL master mymaster

# 레플리카 목록
SENTINEL replicas mymaster

# Sentinel 인스턴스 목록
SENTINEL sentinels mymaster

# 현재 마스터 주소 확인
SENTINEL get-master-addr-by-name mymaster
# → "10.0.0.1" "6379"

# 수동 페일오버 트리거
SENTINEL failover mymaster

# 페일오버 가능 여부 시뮬레이션
SENTINEL ckquorum mymaster
# → "OK 3 usable Sentinels. Quorum and failover authorization is possible."
```

### 실습 9: ACL 관리 (Redis 6.0+)

```redis
# 현재 ACL 규칙 확인
ACL LIST

# 현재 사용자 확인
ACL WHOAMI

# 읽기 전용 사용자 생성
ACL SETUSER readonly on >readpass ~cache:* +get +mget +hget +hgetall +exists +ttl +type

# 애플리케이션 전용 사용자 생성
ACL SETUSER appuser on >apppass ~app:* ~session:* +@read +@write +@string +@hash +@set -@dangerous

# 사용자 정보 확인
ACL GETUSER readonly

# 사용자로 인증
AUTH readonly readpass

# ACL 로그 확인 (거부된 명령 기록)
ACL LOG 10
ACL LOG RESET   # 로그 초기화

# 사용자 삭제
ACL DELUSER readonly
```

### 실습 10: Kubernetes에서 Redis 관리

```bash
# Redis 리소스 사용량
kubectl top pod -n demo -l app=redis

# Redis 설정 확인
kubectl exec -n demo deploy/redis -- redis-cli CONFIG GET maxmemory
kubectl exec -n demo deploy/redis -- redis-cli CONFIG GET maxmemory-policy

# Redis 데이터 백업
kubectl exec -n demo deploy/redis -- redis-cli BGSAVE

# 마지막 RDB 저장 시각 확인
kubectl exec -n demo deploy/redis -- redis-cli LASTSAVE

# 연결된 클라이언트 목록
kubectl exec -n demo deploy/redis -- redis-cli CLIENT LIST

# Slow Log 확인
kubectl exec -n demo deploy/redis -- redis-cli SLOWLOG GET 5

# 키 스캔 (패턴 기반, 운영에 안전)
kubectl exec -n demo deploy/redis -- redis-cli --scan --pattern "user:*"
```

---

## 예제

### 예제 1: Kubernetes 배포 매니페스트

```yaml
# redis-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: redis
  namespace: demo
spec:
  replicas: 1
  selector:
    matchLabels:
      app: redis
  template:
    metadata:
      labels:
        app: redis
    spec:
      containers:
        - name: redis
          image: redis:7-alpine
          ports:
            - containerPort: 6379
          command: ["redis-server"]
          args:
            - "--maxmemory"
            - "128mb"
            - "--maxmemory-policy"
            - "allkeys-lru"
            - "--appendonly"
            - "yes"
            - "--appendfsync"
            - "everysec"
          resources:
            limits:
              cpu: 200m
              memory: 256Mi
            requests:
              cpu: 50m
              memory: 128Mi
          livenessProbe:
            exec:
              command: ["redis-cli", "ping"]
            initialDelaySeconds: 5
            periodSeconds: 10
          readinessProbe:
            exec:
              command: ["redis-cli", "ping"]
            initialDelaySeconds: 5
            periodSeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: redis
  namespace: demo
spec:
  selector:
    app: redis
  ports:
    - port: 6379
      targetPort: 6379
```

### 예제 2: Cache-Aside 패턴 (의사코드)

```javascript
// Cache-Aside 패턴
async function getUser(userId) {
  // 1. 캐시에서 먼저 조회
  const cached = await redis.get(`user:${userId}`);
  if (cached) {
    return JSON.parse(cached);  // Cache Hit
  }

  // 2. 캐시 미스 → DB에서 조회
  const user = await db.query('SELECT * FROM users WHERE id = $1', [userId]);

  // 3. 캐시에 저장 (TTL: 5분)
  await redis.set(`user:${userId}`, JSON.stringify(user), 'EX', 300);

  return user;
}
```

### 예제 3: Rate Limiter (INCR + EXPIRE 기본 패턴)

```javascript
// Fixed Window Rate Limiter (간단한 방식)
async function isAllowed(clientId, maxRequests, windowSec) {
  const key = `ratelimit:${clientId}:${Math.floor(Date.now() / 1000 / windowSec)}`;

  const count = await redis.incr(key);

  if (count === 1) {
    // 첫 요청 시 TTL 설정
    await redis.expire(key, windowSec);
  }

  return count <= maxRequests;
}

// 사용 예: 1분에 최대 60회
const allowed = await isAllowed("user:123", 60, 60);
```

```redis
-- Lua 스크립트: Sliding Window Rate Limiter (더 정확한 방식)
-- KEYS[1] = rate limit 키
-- ARGV[1] = 윈도우 크기 (초)
-- ARGV[2] = 최대 요청 수
-- ARGV[3] = 현재 타임스탬프 (마이크로초)

local key = KEYS[1]
local window = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

-- 윈도우 밖의 오래된 요청 제거
redis.call('ZREMRANGEBYSCORE', key, 0, now - window * 1000000)

-- 현재 윈도우 내 요청 수 확인
local count = redis.call('ZCARD', key)

if count < limit then
  redis.call('ZADD', key, now, now)
  redis.call('EXPIRE', key, window)
  return 1    -- 허용
else
  return 0    -- 거부
end
```

### 예제 4: 분산 락 (Distributed Lock)

```javascript
// 분산 락 획득
// SET key value NX PX ttl: 키가 없을 때만(NX) 설정하고, 밀리초 TTL(PX) 설정
async function acquireLock(lockKey, ownerId, ttlMs) {
  const result = await redis.set(lockKey, ownerId, 'PX', ttlMs, 'NX');
  return result === 'OK';
}

// 분산 락 해제 (Lua 스크립트로 원자적 수행)
// 반드시 자신이 획득한 락만 해제해야 한다
async function releaseLock(lockKey, ownerId) {
  const script = `
    if redis.call('get', KEYS[1]) == ARGV[1] then
      return redis.call('del', KEYS[1])
    else
      return 0
    end
  `;
  return await redis.eval(script, 1, lockKey, ownerId);
}
```

**Redlock 알고리즘 (다중 인스턴스 분산 락):**

단일 Redis 인스턴스의 분산 락은 Redis 장애 시 안전하지 않다. Redlock은 N개(보통 5개)의 독립적인 Redis 인스턴스를 사용하여 이 문제를 해결한다.

```
Redlock 알고리즘 과정:
1. 현재 시각(T1)을 기록한다.
2. N개의 모든 Redis 인스턴스에 순차적으로 SET NX PX로 락 획득을 시도한다.
   각 인스턴스에 대한 타임아웃은 TTL보다 훨씬 짧게 설정한다.
3. 현재 시각(T2)을 기록하고, 경과 시간(T2-T1)을 계산한다.
4. 과반수(N/2+1) 이상의 인스턴스에서 락을 획득했고,
   경과 시간이 TTL보다 짧으면 → 락 획득 성공.
   유효 TTL = 원래 TTL - 경과 시간(T2-T1).
5. 그렇지 않으면 → 모든 인스턴스에서 락 해제 후 재시도.

주의: Redlock은 학술적으로 논란이 있다 (Martin Kleppmann의 비판).
      안전성이 중요한 경우 ZooKeeper나 etcd 기반 락을 고려해야 한다.
```

### 예제 5: 세션 저장소 (Session Store)

```javascript
// 세션 생성
async function createSession(userId, sessionData, ttlSec = 3600) {
  const sessionId = crypto.randomUUID();
  const key = `session:${sessionId}`;

  // Hash로 세션 데이터 저장
  await redis.hset(key, {
    userId: userId,
    createdAt: Date.now().toString(),
    ...sessionData
  });
  await redis.expire(key, ttlSec);

  return sessionId;
}

// 세션 조회
async function getSession(sessionId) {
  const key = `session:${sessionId}`;
  const data = await redis.hgetall(key);

  if (Object.keys(data).length === 0) {
    return null;  // 세션 없음 또는 만료
  }

  // 세션 접근 시 TTL 갱신 (sliding expiration)
  await redis.expire(key, 3600);

  return data;
}

// 세션 삭제 (로그아웃)
async function destroySession(sessionId) {
  await redis.del(`session:${sessionId}`);
}

// 특정 사용자의 모든 세션 무효화
async function invalidateUserSessions(userId) {
  // 사용자별 세션 ID를 Set으로 관리하는 경우
  const sessionIds = await redis.smembers(`user:${userId}:sessions`);
  if (sessionIds.length > 0) {
    const keys = sessionIds.map(id => `session:${id}`);
    await redis.unlink(...keys);  // 비동기 삭제
    await redis.del(`user:${userId}:sessions`);
  }
}
```

### 예제 6: Redis Sentinel 구성 파일

```
# sentinel.conf
port 26379
daemonize no

# 모니터링할 마스터 설정
sentinel monitor mymaster 10.0.0.1 6379 2

# 마스터 응답 타임아웃 (ms) — 이 시간 동안 응답 없으면 SDOWN 판정
sentinel down-after-milliseconds mymaster 5000

# 페일오버 타임아웃 (ms)
sentinel failover-timeout mymaster 60000

# 동시에 새 마스터와 동기화할 레플리카 수
# 값이 작을수록 페일오버 시 읽기 부하 분산이 유지됨
sentinel parallel-syncs mymaster 1

# 마스터/레플리카 인증
sentinel auth-pass mymaster mypassword

# Sentinel 자체 비밀번호 (Sentinel 간 통신)
requirepass sentinel-password

# 페일오버 알림 스크립트
# sentinel notification-script mymaster /var/redis/notify.sh
# sentinel client-reconfig-script mymaster /var/redis/reconfig.sh

# 마스터가 변경되면 /var/redis/reconfig.sh가 호출됨
# 인자: <master-name> <role> <state> <from-ip> <from-port> <to-ip> <to-port>
```

### 예제 7: Redis Cluster 구성

```bash
# 6개 노드로 Redis Cluster 생성 (3 마스터 + 3 레플리카)
# 각 노드의 redis.conf:
# port 6379
# cluster-enabled yes
# cluster-config-file nodes.conf
# cluster-node-timeout 15000
# appendonly yes

# 클러스터 생성 (redis-cli 사용)
redis-cli --cluster create \
  10.0.0.1:6379 10.0.0.2:6379 10.0.0.3:6379 \
  10.0.0.4:6379 10.0.0.5:6379 10.0.0.6:6379 \
  --cluster-replicas 1

# 클러스터 상태 확인
redis-cli --cluster check 10.0.0.1:6379

# 클러스터 정보 조회
redis-cli -c -h 10.0.0.1 CLUSTER INFO

# 노드 목록 확인
redis-cli -c -h 10.0.0.1 CLUSTER NODES

# 슬롯 분배 확인
redis-cli -c -h 10.0.0.1 CLUSTER SLOTS
```

```
# redis.conf — Cluster 모드 설정
port 6379
cluster-enabled yes
cluster-config-file nodes.conf
cluster-node-timeout 15000

# 클러스터 버스 포트 (기본: port + 10000)
# cluster-announce-bus-port 16379

# NAT/Docker 환경에서 공개 주소 설정
# cluster-announce-ip 203.0.113.1
# cluster-announce-port 6379

# 모든 슬롯이 할당되지 않아도 요청 허용 (개발용)
# cluster-require-full-coverage no

# 영속성
appendonly yes
appendfsync everysec
```

---

## 자가 점검

- [ ] Redis가 인메모리 저장소인 이유와 장단점을 설명할 수 있는가?
- [ ] **단일 쓰레드 아키텍처가 빠른 이유**(lock 없음, 캐시 친화적, 컨텍스트 스위칭 없음, I/O 멀티플렉싱)를 설명할 수 있는가?
- [ ] Redis 6+의 I/O 쓰레딩이 명령 실행은 여전히 단일 쓰레드인 이유를 설명할 수 있는가?
- [ ] SDS, listpack, quicklist, skiplist, intset 등 내부 인코딩의 역할과 전환 조건을 설명할 수 있는가?
- [ ] **Skiplist가 무엇이며 Sorted Set에 왜 사용되는지**(범위 쿼리 효율성, 구현 단순성, O(log N) 성능) 설명할 수 있는가?
- [ ] Cache-Aside 패턴의 동작 흐름을 설명할 수 있는가?
- [ ] TTL의 역할과 설정 방법을 알고 있는가?
- [ ] Redis의 주요 데이터 타입(String, Hash, List, Set, Sorted Set, Stream)을 사용할 수 있는가?
- [ ] **RDB와 AOF의 트레이드오프**를 설명할 수 있는가? (RDB: 빠른 복원/데이터 유실 가능, AOF: 내구성 높음/복원 느림, 하이브리드: 양쪽 장점)
- [ ] AOF fsync 정책(always, everysec, no)의 트레이드오프를 이해하고 있는가?
- [ ] fork()와 Copy-on-Write(COW)가 RDB/AOF rewrite에서 어떻게 동작하는지 설명할 수 있는가?
- [ ] Eviction 정책 8가지의 종류와 LRU vs LFU의 차이를 설명할 수 있는가?
- [ ] **LRU 근사 알고리즘**(maxmemory-samples 기반 샘플링, eviction pool)이 어떻게 동작하는지 설명할 수 있는가?
- [ ] 메모리 단편화(fragmentation ratio)를 확인하고 Active Defragmentation으로 해소하는 방법을 알고 있는가?
- [ ] 키 만료의 두 가지 메커니즘(Passive + Active deletion)과 lazy-free(UNLINK)를 설명할 수 있는가?
- [ ] **Pub/Sub와 Streams의 차이**를 설명할 수 있는가? (Pub/Sub: fire-and-forget, 영속성 없음 / Streams: 영속적, Consumer Group, ACK)
- [ ] Consumer Group의 개념과 XREADGROUP, XACK 흐름을 이해하고 있는가?
- [ ] MULTI/EXEC 트랜잭션과 WATCH 낙관적 잠금을 설명할 수 있는가?
- [ ] Lua 스크립팅의 원자성 보장 원리와 KEYS/ARGV 파라미터 사용법을 알고 있는가?
- [ ] Pipeline과 MULTI/EXEC의 차이(네트워크 최적화 vs 원자성)를 설명할 수 있는가?
- [ ] **Redis Cluster가 데이터를 어떻게 분산하는지**(16384 해시 슬롯, CRC16 해싱, MOVED/ASK 리다이렉션, gossip protocol)를 설명할 수 있는가?
- [ ] **Redis Sentinel의 자동 장애 조치 과정**(SDOWN → ODOWN → Leader Election → 레플리카 승격)을 설명할 수 있는가?
- [ ] 비동기 복제의 동작 원리와 PSYNC(partial resync), replication backlog를 이해하고 있는가?
- [ ] 분산 락 패턴(SET NX EX)과 Redlock 알고리즘의 개념을 알고 있는가?
- [ ] ACL을 사용하여 사용자별 명령/키 접근을 제한하는 방법을 알고 있는가?
- [ ] Kubernetes에서 Redis Sidecar, Sentinel, Cluster Operator 패턴을 이해하고 있는가?

---

## 참고문헌

- [Redis 공식 문서](https://redis.io/docs/) - 명령어 레퍼런스, 아키텍처 가이드, 튜토리얼
- [Redis Commands Reference](https://redis.io/commands/) - 전체 명령어 레퍼런스
- [Redis GitHub 저장소](https://github.com/redis/redis) - 소스 코드, 이슈 트래커, 릴리스 노트
- [Redis 데이터 타입](https://redis.io/docs/latest/develop/data-types/) - 각 자료구조의 상세 설명과 내부 구현
- [Redis 영속성 문서](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/) - RDB, AOF, 하이브리드 모드 설정 가이드
- [Redis Cluster 사양](https://redis.io/docs/latest/operate/oss_and_stack/reference/cluster-spec/) - 해시 슬롯, 리다이렉션, 장애 조치 상세
- [Redis Sentinel 문서](https://redis.io/docs/latest/operate/oss_and_stack/management/sentinel/) - 고가용성 구성 가이드
- [Redis Streams 소개](https://redis.io/docs/latest/develop/data-types/streams/) - Consumer Group, 메시지 처리 패턴
- [Redis Lua 스크립팅](https://redis.io/docs/latest/develop/interact/programmability/eval-intro/) - EVAL, SCRIPT LOAD, 원자성 보장
- [Redis Pipelining](https://redis.io/docs/latest/develop/use/pipelining/) - RTT 최적화, 배치 처리
- [Redis 메모리 최적화](https://redis.io/docs/latest/operate/oss_and_stack/management/optimization/memory-optimization/) - 메모리 관리, 인코딩 최적화
- [Redis Latency Monitoring](https://redis.io/docs/latest/operate/oss_and_stack/management/optimization/latency-monitor/) - 지연 시간 모니터링 및 진단
- [Bitnami Redis Helm Chart](https://github.com/bitnami/charts/tree/main/bitnami/redis) - Kubernetes 배포 Helm Chart
- [OpsTree Redis Operator](https://github.com/OpsTree/redis-operator) - Kubernetes Operator for Redis
