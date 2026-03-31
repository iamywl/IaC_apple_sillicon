# Day 3: Pub/Sub, Streams, 트랜잭션, Lua 스크립팅, ACL, 캐시 패턴, Kubernetes 패턴

> Pub/Sub와 Streams 비교, Consumer Group, MULTI/EXEC 트랜잭션, WATCH 낙관적 잠금, Pipelining, Lua 스크립팅, Redis 7+ Function, ACL 접근 제어, Cache-Aside/Write-Through/Write-Behind 캐시 패턴, Kubernetes에서의 Redis 운영 패턴(Sidecar, Sentinel, Cluster Operator)을 다룬다.

## Pub/Sub vs Streams

### 기본 Pub/Sub

Redis Pub/Sub는 실시간 메시징 시스템이다. 발행자(publisher)가 채널에 메시지를 보내면 해당 채널을 구독하는 모든 구독자(subscriber)가 즉시 수신한다.

```redis
# 구독자 (터미널 1)
SUBSCRIBE news:sports news:tech

# 패턴 매칭 구독
PSUBSCRIBE news:*        # news:로 시작하는 모든 채널 구독

# 발행자 (터미널 2)
PUBLISH news:sports "Son scores a goal!"
PUBLISH news:tech "Redis 8.0 released"
```

**Pub/Sub의 한계:**

- **영속성 없음**: 메시지는 메모리에 저장되지 않는다. 발행 시점에 구독자가 없으면 메시지는 소실된다.
- **Fire-and-Forget**: 전달 보장(delivery guarantee)이 없다. 구독자가 연결이 끊기면 그 사이의 메시지를 받을 수 없다.
- **버퍼 제한**: 느린 구독자가 있으면 출력 버퍼가 커져 메모리 문제가 발생할 수 있다.
- **클러스터 제한**: 클러스터 모드에서 Pub/Sub 메시지는 모든 노드로 브로드캐스트되어 네트워크 오버헤드가 크다 (Sharded Pub/Sub이 Redis 7+에서 이를 개선).

이러한 한계 때문에 안정적인 메시지 전달이 필요한 경우 Redis Streams를 사용해야 한다.

### Redis Streams

Redis 5.0에서 도입된 Streams는 로그형 자료구조로, Kafka와 유사한 영속적 메시지 큐를 제공한다.

**Pub/Sub vs Streams 비교:**

| 특성 | Pub/Sub | Streams |
|------|---------|---------|
| 영속성 | 없음 (fire-and-forget) | 있음 (AOF/RDB로 영속화) |
| 메시지 히스토리 | 없음 | 있음 (ID로 과거 메시지 조회) |
| Consumer Group | 없음 | 지원 (분산 처리, ACK) |
| 전달 보장 | 없음 | At-least-once (ACK 기반) |
| 메시지 크기 | 단순 문자열 | 필드-값 쌍 (구조화) |
| 백프레셔 | 없음 (느린 구독자 버퍼 증가) | 있음 (XREAD BLOCK으로 소비자 속도 제어) |
| 용도 | 실시간 알림, 이벤트 브로드캐스트 | 작업 큐, 이벤트 소싱, 로그 수집 |

### Stream 기본 명령

```redis
# 메시지 추가 (ID 자동 생성)
XADD mystream * sensor-id 1234 temperature 25.3
# → "1679000000000-0" (타임스탬프-시퀀스)

# 메시지 읽기 (처음부터)
XREAD COUNT 10 STREAMS mystream 0

# 새 메시지 대기 (블로킹)
XREAD BLOCK 5000 COUNT 1 STREAMS mystream $

# 스트림 길이
XLEN mystream

# 범위 조회
XRANGE mystream - +          # 전체
XRANGE mystream - + COUNT 5  # 처음 5개
XREVRANGE mystream + - COUNT 5  # 최신 5개

# 스트림 크기 제한 (MAXLEN으로 오래된 메시지 자동 삭제)
XADD mystream MAXLEN ~ 1000 * key value  # 대략 1000개 유지 (~는 근사 트리밍)
```

### Consumer Group

```redis
# Consumer Group 생성 (스트림 처음부터)
XGROUP CREATE mystream mygroup 0

# 스트림이 존재하지 않으면 자동 생성
XGROUP CREATE mystream mygroup 0 MKSTREAM

# Consumer Group 읽기 (consumer-1이 미처리 메시지 수신)
XREADGROUP GROUP mygroup consumer-1 COUNT 1 STREAMS mystream >

# 처리 완료 확인
XACK mystream mygroup 1679000000000-0

# 미확인(Pending) 메시지 확인
XPENDING mystream mygroup

# 특정 소비자의 pending 메시지 상세 조회
XPENDING mystream mygroup - + 10 consumer-1

# 오래된 미확인 메시지를 다른 소비자에게 할당 (장애 복구)
XCLAIM mystream mygroup consumer-2 3600000 1679000000000-0

# 자동 클레임 (Redis 6.2+)
XAUTOCLAIM mystream mygroup consumer-2 3600000 0-0 COUNT 10
```

### Kafka/RabbitMQ와의 비교

| 특성 | Redis Streams | Apache Kafka | RabbitMQ |
|------|--------------|--------------|----------|
| 영속성 | 메모리 + AOF/RDB | 디스크 기반 | 메모리 + 디스크 |
| Consumer Group | 지원 | 지원 (파티션 기반) | 지원 (큐 기반) |
| 순서 보장 | 단일 스트림 내 보장 | 파티션 내 보장 | 큐 내 보장 |
| 처리량 | 중간 (~수십만/초) | 매우 높음 (~수백만/초) | 중간 |
| 메시지 재처리 | XREAD로 과거 읽기 가능 | offset reset 가능 | 기본적으로 불가 |
| 적합한 용도 | 경량 이벤트 스트리밍 | 대규모 이벤트 파이프라인 | 작업 큐, RPC |

---

## 트랜잭션과 Pipelining

### MULTI/EXEC 트랜잭션

Redis 트랜잭션은 `MULTI`로 시작하여 `EXEC`로 실행한다. 큐에 쌓인 명령이 순차적으로, 다른 클라이언트의 명령 없이 원자적으로 실행된다.

```redis
MULTI
SET account:A 900
SET account:B 1100
EXEC
# → [OK, OK] (두 명령이 원자적으로 실행됨)

# 취소
MULTI
SET key1 "value1"
DISCARD   # 트랜잭션 취소
```

### WATCH (낙관적 잠금)

`WATCH`는 CAS(Check-And-Set) 연산을 구현하는 낙관적 잠금(optimistic locking)이다. `WATCH`로 감시 중인 키가 `EXEC` 전에 다른 클라이언트에 의해 변경되면 트랜잭션이 실패(nil 반환)한다.

```redis
WATCH balance
val = GET balance          # 현재 잔액 조회
# val이 100 이상이면 차감
MULTI
DECRBY balance 100
EXEC
# → 다른 클라이언트가 balance를 변경했으면 nil 반환 → 재시도 필요
```

**왜 Redis에 전통적인 ACID가 불필요한가:**
- **원자성(Atomicity)**: `MULTI`/`EXEC` 블록 내 명령은 모두 실행되거나, 구문 오류 시 모두 거부된다. 단, 런타임 오류(예: 문자열에 INCR)가 발생하면 해당 명령만 실패하고 나머지는 실행된다. 롤백은 지원하지 않는다.
- **격리성(Isolation)**: 단일 쓰레드이므로 트랜잭션 중 다른 명령이 끼어들 수 없다.
- **일관성/지속성**: 영속성 설정(AOF fsync)에 따라 제어 가능하다.

### Pipelining

Pipelining은 여러 명령을 한 번의 네트워크 왕복(RTT)으로 전송하는 기법이다. 각 명령을 개별로 보내면 명령 수 x RTT만큼의 지연이 발생하지만, 파이프라이닝으로 이를 1 RTT로 줄일 수 있다.

```
일반 방식 (명령 3개 × RTT):
Client ──SET──► Server
Client ◄──OK── Server
Client ──SET──► Server
Client ◄──OK── Server
Client ──GET──► Server
Client ◄──val── Server
총 시간: 3 × RTT

Pipeline 방식 (1 RTT):
Client ──SET──►
       ──SET──► Server
       ──GET──►
Client ◄──OK──
       ◄──OK── Server
       ◄──val──
총 시간: 1 × RTT
```

```bash
# redis-cli에서 파이프라이닝 예시
echo -e "SET key1 val1\nSET key2 val2\nGET key1" | redis-cli --pipe
```

**Pipeline vs MULTI/EXEC:**

| 특성 | Pipeline | MULTI/EXEC |
|------|----------|------------|
| 네트워크 최적화 | O (RTT 절감) | X (단독 사용 시) |
| 원자성 | X (명령 사이에 다른 명령 가능) | O (모든 명령이 원자적 실행) |
| 결합 사용 | Pipeline + MULTI/EXEC 가능 | Pipeline 안에 MULTI/EXEC 포함 |
| 용도 | 대량 명령 일괄 전송 | 트랜잭션 보장 필요 시 |

Pipeline과 MULTI/EXEC를 결합하면 네트워크 최적화와 원자성을 모두 얻을 수 있다. Pipeline 내에 MULTI와 EXEC를 포함시키면 된다.

---

## Lua 스크립팅

Redis는 내장 Lua 5.1 인터프리터를 통해 서버 사이드 스크립트를 실행할 수 있다. Lua 스크립트는 원자적으로 실행되므로 복잡한 트랜잭션 로직을 구현할 수 있다.

### EVAL / EVALSHA

```redis
# EVAL: 스크립트 직접 실행
# 형식: EVAL script numkeys [key ...] [arg ...]
# KEYS[1]의 값이 ARGV[1]과 같을 때만 삭제 (분산 락 해제)
EVAL "if redis.call('get', KEYS[1]) == ARGV[1] then \
        return redis.call('del', KEYS[1]) \
      else \
        return 0 \
      end" 1 mylock "lock-owner-id"

# SCRIPT LOAD: 스크립트를 서버에 캐시하고 SHA1 해시를 반환한다
SCRIPT LOAD "return redis.call('get', KEYS[1])"
# → "a42059b356c875f0717db19a51f6aaa9161571a2"

# EVALSHA: 캐시된 스크립트를 SHA1로 실행 (네트워크 절약)
EVALSHA "a42059b356c875f0717db19a51f6aaa9161571a2" 1 mykey
```

### KEYS와 ARGV 파라미터

- `KEYS[]`: 스크립트에서 접근할 Redis 키 목록이다. Redis Cluster에서 올바른 노드로 라우팅하기 위해 반드시 KEYS로 전달해야 한다.
- `ARGV[]`: 키가 아닌 일반 인자 값이다.
- `numkeys`: KEYS의 개수를 지정한다. 이후 인자가 KEYS와 ARGV로 나뉜다.

```redis
# 예: EVAL script 2 key1 key2 arg1 arg2
# → KEYS[1] = "key1", KEYS[2] = "key2"
# → ARGV[1] = "arg1", ARGV[2] = "arg2"
```

### Redis 7+ Function

Redis 7에서는 Lua 스크립팅의 발전형인 Function이 도입되었다. `FUNCTION LOAD`로 라이브러리를 등록하고 `FCALL`로 호출한다. Function은 서버에 영속적으로 저장되므로 재시작 후에도 유지된다.

```redis
# Function 등록
FUNCTION LOAD "#!lua name=mylib\nredis.register_function('myfunc', function(keys, args) return redis.call('get', keys[1]) end)"

# Function 호출
FCALL myfunc 1 mykey
```

**Lua 스크립팅의 원자성 보장:** 스크립트가 실행되는 동안 다른 모든 명령은 대기한다. 따라서 긴 스크립트는 Redis 전체를 블로킹할 수 있으므로, `lua-time-limit`(기본 5초) 설정으로 제한한다. 5초를 초과하면 다른 클라이언트의 명령에 대해 BUSY 에러를 반환하며, `SCRIPT KILL`로 스크립트를 강제 종료할 수 있다 (단, 쓰기 명령을 이미 실행한 스크립트는 `SHUTDOWN NOSAVE`로만 중단 가능).

---

## ACL (Access Control Lists, Redis 6.0+)

Redis 6.0부터 ACL 시스템이 도입되어 사용자별로 접근 가능한 명령과 키를 세밀하게 제어할 수 있다.

```redis
# 현재 ACL 규칙 확인
ACL LIST
# → "user default on nopass ~* &* +@all"

# 사용자 생성 (읽기 전용, 특정 키 패턴만 허용)
ACL SETUSER readonly on >readonlypass ~cache:* +get +mget +hget +hgetall -@dangerous

# 사용자 생성 (특정 명령만 허용)
ACL SETUSER worker on >workerpass ~job:* +xreadgroup +xack +xpending

# 사용자 정보 확인
ACL GETUSER readonly

# 현재 사용자 확인
ACL WHOAMI

# ACL 로그 확인 (거부된 명령 기록)
ACL LOG 10

# ACL 카테고리 목록
ACL CAT
# → @read, @write, @set, @sortedset, @list, @hash, @string, @dangerous, @admin, ...

# 특정 카테고리에 포함된 명령 목록
ACL CAT read
```

**ACL 규칙 구문:**

| 구문 | 의미 |
|------|------|
| `on` / `off` | 사용자 활성화/비활성화 |
| `>password` | 비밀번호 추가 |
| `~pattern` | 접근 가능한 키 패턴 (glob) |
| `+command` | 허용할 명령 |
| `-command` | 거부할 명령 |
| `+@category` | 특정 카테고리의 모든 명령 허용 |
| `-@category` | 특정 카테고리의 모든 명령 거부 |
| `&channel` | Pub/Sub 접근 가능 채널 (Redis 6.2+) |
| `allcommands` / `nocommands` | 모든 명령 허용/거부 |
| `allkeys` / `resetkeys` | 모든 키 허용/키 패턴 초기화 |

```
# ACL 파일로 관리 (redis.conf에 설정)
aclfile /etc/redis/users.acl

# users.acl 예시
user default on nopass ~* +@all
user admin on >adminpass ~* +@all
user readonly on >readpass ~cache:* +@read +@connection
user app on >apppass ~app:* ~session:* +@read +@write +@string +@hash -@dangerous
```

---

## 캐시 패턴

### Cache-Aside (가장 일반적)

```
┌────────┐  1. GET   ┌───────┐
│  App   │──────────►│ Redis │
│        │◄──────────│ Cache │
│        │  2. HIT   └───────┘
│        │
│        │  3. MISS → DB 조회
│        │──────────►┌────────┐
│        │◄──────────│  DB    │
│        │  4. 결과   └────────┘
│        │
│        │  5. SET (캐시 저장)
│        │──────────►┌───────┐
│        │           │ Redis │
└────────┘           └───────┘
```

### Write-Through

애플리케이션이 데이터를 쓸 때 캐시와 DB를 동시에 업데이트한다. 캐시 일관성이 높지만 쓰기 지연이 발생한다.

### Write-Behind (Write-Back)

캐시에 먼저 쓰고, 비동기로 DB에 반영한다. 쓰기 성능이 높지만 캐시 장애 시 데이터 유실 위험이 있다.

---

## Kubernetes 패턴

### Redis를 Sidecar 캐시로 사용

각 Pod에 Redis 컨테이너를 Sidecar로 붙여 로컬 캐시로 활용하는 패턴이다. 네트워크 홉 없이 localhost로 접근하므로 지연이 극히 낮다. 단, Pod마다 캐시가 독립적이므로 일관성은 보장되지 않는다.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: app-with-redis-sidecar
spec:
  template:
    spec:
      containers:
        - name: app
          image: myapp:latest
          env:
            - name: REDIS_HOST
              value: "localhost"    # sidecar이므로 localhost
        - name: redis-sidecar
          image: redis:7-alpine
          ports:
            - containerPort: 6379
          resources:
            limits:
              memory: 64Mi
              cpu: 100m
          command: ["redis-server", "--maxmemory", "48mb", "--maxmemory-policy", "allkeys-lru"]
```

### Redis Sentinel on Kubernetes

Sentinel을 Kubernetes에서 운영할 때는 StatefulSet으로 Redis 인스턴스를 배포하고, Sentinel을 별도 Deployment로 운영한다. Headless Service를 통해 각 Pod에 안정적인 DNS를 부여한다.

```yaml
# Redis 마스터 + 레플리카 StatefulSet
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: redis
  namespace: redis-system
spec:
  serviceName: redis-headless
  replicas: 3
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
          volumeMounts:
            - name: redis-data
              mountPath: /data
  volumeClaimTemplates:
    - metadata:
        name: redis-data
      spec:
        accessModes: ["ReadWriteOnce"]
        resources:
          requests:
            storage: 1Gi
---
# Headless Service (StatefulSet용)
apiVersion: v1
kind: Service
metadata:
  name: redis-headless
  namespace: redis-system
spec:
  clusterIP: None
  selector:
    app: redis
  ports:
    - port: 6379
---
# Sentinel Deployment
apiVersion: apps/v1
kind: Deployment
metadata:
  name: redis-sentinel
  namespace: redis-system
spec:
  replicas: 3
  selector:
    matchLabels:
      app: redis-sentinel
  template:
    metadata:
      labels:
        app: redis-sentinel
    spec:
      containers:
        - name: sentinel
          image: redis:7-alpine
          command: ["redis-sentinel", "/etc/redis/sentinel.conf"]
          ports:
            - containerPort: 26379
          volumeMounts:
            - name: sentinel-config
              mountPath: /etc/redis
      volumes:
        - name: sentinel-config
          configMap:
            name: sentinel-config
```

### Redis Cluster Operator

프로덕션 환경에서는 Redis Cluster를 수동 관리하기보다 Operator를 활용하는 것이 권장된다. 대표적인 Operator로는 다음이 있다:

- **Spotahome Redis Operator** (`redis-operator`): Redis Sentinel 기반 고가용성 구성을 자동화한다.
- **OpsTree Redis Operator**: Redis Standalone, Cluster, Sentinel, Replication 모드를 모두 지원한다.
- **Bitnami Helm Charts**: Helm을 통한 Redis/Redis Cluster 배포를 간소화한다.

```bash
# Bitnami Helm Chart로 Redis Cluster 배포 예시
helm repo add bitnami https://charts.bitnami.com/bitnami
helm install redis-cluster bitnami/redis-cluster \
  --set cluster.nodes=6 \
  --set cluster.replicas=1 \
  --set persistence.size=2Gi \
  --namespace redis-system
```

---

