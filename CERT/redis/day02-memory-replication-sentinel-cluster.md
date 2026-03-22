# Day 2: 메모리 관리, 복제, Sentinel, Cluster

> jemalloc 메모리 할당, maxmemory 설정, Eviction 정책(LRU/LFU), 메모리 단편화 및 Active Defragmentation, 키 만료 메커니즘, 마스터-레플리카 복제, PSYNC, Redis Sentinel 자동 장애 조치, Redis Cluster 해시 슬롯 분산을 다룬다.

## 메모리 관리

### jemalloc 메모리 할당자

Redis는 기본적으로 jemalloc을 메모리 할당자로 사용한다. jemalloc은 멀티쓰레드 환경에서의 메모리 단편화를 최소화하도록 설계된 할당자이다. glibc의 ptmalloc2 대비 메모리 단편화가 적고, 할당/해제 성능이 우수하다.

jemalloc은 크기 클래스(size class) 기반으로 메모리를 관리한다. 요청된 크기를 가장 가까운 크기 클래스로 올림하여 할당한다. 예를 들어 13바이트를 요청하면 16바이트 클래스에서 할당한다. 이로 인해 약간의 내부 단편화가 발생하지만, 외부 단편화는 크게 줄어든다.

```redis
# 사용 중인 메모리 할당자 확인
INFO memory
# mem_allocator: jemalloc-5.3.0
```

### maxmemory 설정

```
# redis.conf
maxmemory 256mb             # 최대 메모리 사용량 제한
maxmemory-policy allkeys-lru # 메모리 초과 시 적용할 eviction 정책
```

`maxmemory`를 설정하지 않으면 Redis는 사용 가능한 모든 시스템 메모리를 사용한다. 프로덕션 환경에서는 반드시 설정해야 한다. 일반적으로 시스템 메모리의 60~70%를 `maxmemory`로 설정하고, 나머지는 fork() 시 COW, OS 버퍼, 기타 프로세스를 위해 남겨둔다.

### Eviction 정책 상세

| 정책 | 대상 키 | 알고리즘 | 설명 |
|------|---------|----------|------|
| `noeviction` | - | - | 메모리 초과 시 쓰기 명령에 에러를 반환한다. 읽기는 정상 동작한다 |
| `allkeys-lru` | 모든 키 | LRU | 가장 오래 접근하지 않은 키를 삭제한다. **범용 캐시에 권장** |
| `allkeys-lfu` | 모든 키 | LFU | 가장 적게 접근한 키를 삭제한다. 접근 빈도 기반 |
| `allkeys-random` | 모든 키 | Random | 무작위로 키를 삭제한다 |
| `volatile-lru` | TTL 설정된 키 | LRU | TTL이 있는 키 중 가장 오래 접근하지 않은 키를 삭제한다 |
| `volatile-lfu` | TTL 설정된 키 | LFU | TTL이 있는 키 중 가장 적게 접근한 키를 삭제한다 |
| `volatile-ttl` | TTL 설정된 키 | TTL | 만료 시간이 가장 임박한 키를 삭제한다 |
| `volatile-random` | TTL 설정된 키 | Random | TTL이 있는 키 중 무작위로 삭제한다 |

### LRU 근사 알고리즘 (Approximated LRU)

Redis는 정확한 LRU가 아닌 근사 LRU(approximated LRU)를 사용한다. 정확한 LRU를 구현하면 모든 키에 대해 접근 순서를 추적하는 링크드 리스트가 필요하여 메모리 오버헤드가 크다. Redis는 각 키의 `redisObject`에 24비트 타임스탬프(LRU clock, 초 단위)만 저장하여 메모리를 절약한다.

**근사 LRU 동작 과정:**

1. eviction이 필요하면 `maxmemory-samples`(기본값 5)개의 키를 무작위로 샘플링한다.
2. 샘플링된 키 중 LRU clock 값이 가장 작은(가장 오래 전에 접근한) 키를 제거한다.
3. Redis 3.0부터 eviction pool을 도입했다. 샘플링된 키 중 제거 후보를 풀(pool, 최대 16개)에 저장하고, 다음 eviction 시 기존 풀의 키와 새로 샘플링한 키를 비교하여 가장 적합한 키를 제거한다.

`maxmemory-samples` 값을 높이면 정확도가 올라가지만 CPU 사용량이 증가한다. 기본값 5에서도 실제 LRU와 매우 유사한 결과를 보인다. 10으로 설정하면 정확한 LRU에 거의 근접한다.

```
# LRU/LFU 샘플링 설정
maxmemory-samples 5   # 기본값 5, 높일수록 정확하지만 CPU 비용 증가
```

### LFU (Least Frequently Used, Redis 4.0+)

LFU는 접근 빈도(frequency)를 기준으로 가장 적게 접근한 키를 제거한다. 24비트 중 16비트를 마지막 감쇠 시각, 8비트를 로그 카운터(Morris counter)로 사용한다.

**Morris Counter (확률적 카운터):**

8비트로 최대 255까지만 표현할 수 있지만, 확률적 증가를 사용하여 훨씬 큰 접근 횟수를 추적할 수 있다. 카운터 값이 높을수록 증가 확률이 낮아진다. `lfu-log-factor` 설정에 따라 증가 확률이 결정된다.

```
# factor=10일 때 카운터 값별 대략적인 접근 횟수:
#   카운터 1  → ~1 접근
#   카운터 10 → ~1000 접근
#   카운터 100 → ~1,000,000 접근
#   카운터 255 → ~10,000,000+ 접근
```

시간이 지나면 카운터가 감쇠(decay)하여 과거의 인기 키가 영원히 남지 않는다.

```
# LFU 튜닝 설정
lfu-log-factor 10      # 값이 클수록 카운터 증가가 느림 (기본값 10)
lfu-decay-time 1       # 1분마다 카운터 감쇠 (기본값 1, 0이면 감쇠 안 함)
```

### 메모리 단편화 (Memory Fragmentation)

메모리 단편화는 Redis가 할당자에 요청한 메모리와 OS가 실제로 할당한 메모리의 차이로 발생한다. `INFO memory`의 `mem_fragmentation_ratio`로 확인할 수 있다.

```redis
INFO memory
# used_memory: 1000000           # Redis가 할당한 메모리
# used_memory_rss: 1200000       # OS가 실제 할당한 메모리 (RSS)
# mem_fragmentation_ratio: 1.20  # RSS / used_memory
# mem_fragmentation_bytes: 200000
```

- `mem_fragmentation_ratio` > 1.5: 심각한 단편화, 조치 필요
- `mem_fragmentation_ratio` 1.0~1.5: 정상 범위
- `mem_fragmentation_ratio` < 1.0: 스왑 사용 중일 수 있음 (매우 위험)

**Active Defragmentation (Redis 4.0+):**

Redis는 jemalloc의 기능을 활용하여 온라인 상태에서 메모리 단편화를 해소할 수 있다. 사용 중인 메모리 블록을 새로운 연속된 영역으로 이동시킨다.

```
# redis.conf — 활성 조각 모음 설정
activedefrag yes                          # 활성화
active-defrag-ignore-bytes 100mb          # 단편화가 100MB 이상일 때만 동작
active-defrag-threshold-lower 10          # 단편화 비율이 10% 이상일 때 시작
active-defrag-threshold-upper 100         # 단편화 비율이 100% 이상이면 최대 노력
active-defrag-cycle-min 1                 # 최소 CPU 사용률 (%)
active-defrag-cycle-max 25                # 최대 CPU 사용률 (%)
active-defrag-max-scan-fields 1000        # 각 반복에서 스캔할 최대 필드 수
```

### 키 만료 (Key Expiration)

Redis는 두 가지 메커니즘을 조합하여 만료된 키를 삭제한다.

**1. Passive Deletion (수동 삭제):**

클라이언트가 만료된 키에 접근할 때 확인하고 삭제한다. 접근되지 않는 키는 메모리에 계속 남아있을 수 있으므로 이 방식만으로는 충분하지 않다.

**2. Active Deletion (능동 삭제):**

Redis는 주기적(기본 100ms, `hz` 설정으로 제어)으로 만료된 키를 능동적으로 삭제하는 알고리즘을 실행한다.

```
Active Expiry 알고리즘:
1. TTL이 설정된 키 중에서 20개를 무작위로 샘플링한다.
2. 샘플 중 만료된 키를 모두 삭제한다.
3. 만료된 키가 25% (5개) 이상이면 → 1단계로 돌아가 반복한다.
4. 25% 미만이면 → 다음 주기까지 중지한다.

이 과정은 최대 25ms(SLOW 모드) 동안 실행되며,
각 이벤트 루프 사이클마다 FAST 모드(최대 1ms)로도 실행된다.
```

```
# redis.conf — 만료 관련 설정
hz 10                    # 초당 serverCron 호출 횟수 (기본 10, 1~500)
                         # 높이면 만료 키 정리가 빨라지지만 CPU 사용량 증가
dynamic-hz yes           # 클라이언트 수에 따라 hz를 동적으로 조절 (Redis 5+)
```

**3. Lazy-Free (비동기 삭제, Redis 4.0+):**

큰 키를 삭제할 때 메인 쓰레드가 블로킹되는 문제를 해결하기 위해 도입되었다. `UNLINK` 명령은 `DEL`과 동일한 효과를 가지지만, 실제 메모리 해제를 백그라운드 쓰레드에서 수행한다.

```redis
# DEL vs UNLINK
DEL bigkey           # 동기 삭제 — 키가 크면 (예: 수백만 원소의 Set) 메인 쓰레드가 블로킹
UNLINK bigkey        # 비동기 삭제 — 키 공간에서 즉시 제거, 메모리 해제는 백그라운드

# 자동으로 lazy-free를 사용하는 설정
lazyfree-lazy-eviction yes        # maxmemory eviction 시 비동기 삭제
lazyfree-lazy-expire yes          # TTL 만료 시 비동기 삭제
lazyfree-lazy-server-del yes      # RENAME 등으로 덮어쓸 때 기존 값 비동기 삭제
lazyfree-lazy-user-del yes        # DEL 명령을 UNLINK처럼 동작 (Redis 6.0+)
lazyfree-lazy-user-flush yes      # FLUSHDB/FLUSHALL을 비동기로 수행 (Redis 6.2+)
```

---

## 복제 (Replication)

Redis 복제는 마스터-레플리카 구조의 비동기(asynchronous) 복제이다. 마스터에서 쓰기가 발생하면 레플리카로 비동기적으로 전파된다. 따라서 마스터 장애 시 아직 전파되지 않은 쓰기는 유실될 수 있다.

### 복제 과정

```
전체 동기화 (Full Resync):

1. 레플리카가 PSYNC ? -1 전송 (첫 연결 또는 부분 동기화 불가)
2. 마스터가 BGSAVE 시작 → RDB 파일 생성
3. RDB 파일을 레플리카로 전송
4. 전송 중 발생한 쓰기 명령은 replication buffer에 저장
5. 레플리카가 RDB 로드 완료 후 buffer의 명령 적용
6. 이후 실시간으로 쓰기 명령 전파 (streaming replication)

┌──────────┐                    ┌──────────┐
│  Master  │ ──BGSAVE──►RDB──► │ Replica  │
│          │                    │          │
│          │ ──buffer 전송──►   │          │
│          │                    │          │
│          │ ──실시간 명령──►   │          │
└──────────┘                    └──────────┘
```

### PSYNC (Partial Resync, Redis 2.8+)

레플리카가 잠시 연결이 끊겼다가 재연결되었을 때, 전체 동기화를 피하고 끊긴 동안의 변경분만 전송하는 부분 동기화(partial resync)를 시도한다.

**구성 요소:**

- **Replication ID**: 마스터의 고유 식별자이다. 마스터가 바뀌면(failover) 새 Replication ID가 생성된다.
- **Offset**: 마스터와 레플리카 각각이 추적하는 복제 스트림의 위치이다. 레플리카의 offset이 마스터와 일치하면 동기화가 완료된 상태이다.
- **Replication Backlog**: 마스터가 최근 쓰기 명령을 저장하는 고정 크기 환형 버퍼(ring buffer)이다. 레플리카가 재연결 시, 마스터의 backlog에서 끊긴 지점 이후의 데이터만 전송한다.

```
# redis.conf — 복제 관련 설정
repl-backlog-size 1mb            # 복제 백로그 크기 (기본 1MB, 레플리카 수와 재연결 빈도에 따라 조절)
repl-backlog-ttl 3600            # 모든 레플리카가 끊긴 후 백로그 유지 시간 (초)

# 레플리카 읽기 전용 (기본값: yes, 운영에서 변경 금지)
replica-read-only yes

# 복제 지연 확인 최소 레플리카 수 (쓰기 데이터 안전성 강화)
min-replicas-to-write 1          # 최소 1개 이상의 레플리카가 연결되어야 쓰기 허용
min-replicas-max-lag 10          # 레플리카의 최대 지연 시간 (초)
```

### 디스크리스 복제 (Diskless Replication)

기본적으로 마스터는 RDB 파일을 디스크에 쓴 후 레플리카로 전송한다. 디스크리스 복제는 RDB를 디스크에 쓰지 않고 자식 프로세스가 직접 레플리카 소켓에 스트리밍한다. 디스크 I/O가 느린 환경(예: 네트워크 스토리지)에서 유리하다.

```
# redis.conf — 디스크리스 복제
repl-diskless-sync yes           # 디스크리스 복제 활성화
repl-diskless-sync-delay 5       # 5초 대기 후 전송 시작 (여러 레플리카가 동시에 연결할 수 있도록)
repl-diskless-sync-period 0      # 디스크리스 전체 동기화 최소 간격 (0: 제한 없음)
repl-diskless-load on-empty-db   # 레플리카에서 디스크리스 로딩 (disabled/on-empty-db/swapdb)
```

---

## Redis Sentinel

Sentinel은 Redis의 고가용성 솔루션으로, 마스터-레플리카 구성에서 자동 장애 조치(automatic failover)를 수행한다.

```
Redis Sentinel 아키텍처:

┌───────────┐   ┌───────────┐   ┌───────────┐
│ Sentinel  │   │ Sentinel  │   │ Sentinel  │
│     1     │   │     2     │   │     3     │
└─────┬─────┘   └─────┬─────┘   └─────┬─────┘
      │               │               │
      │         모니터링/투표          │
      │               │               │
      ▼               ▼               ▼
┌───────────┐   ┌───────────┐   ┌───────────┐
│  Master   │──►│ Replica 1 │   │ Replica 2 │
│ (R/W)     │──►│ (R/O)     │   │ (R/O)     │
└───────────┘   └───────────┘   └───────────┘
                       ▲
              마스터 장애 시 승격
```

### Sentinel의 세 가지 역할

1. **모니터링(Monitoring)**: 마스터와 레플리카가 정상 동작하는지 지속적으로 확인한다. `PING` 명령을 주기적으로 전송하여 응답 여부를 확인한다.
2. **자동 장애 조치(Automatic Failover)**: 마스터 장애 시 레플리카를 새 마스터로 승격하고, 다른 레플리카를 새 마스터에 연결한다.
3. **구성 제공자(Configuration Provider)**: 클라이언트에게 현재 마스터의 주소를 알려준다.

### Failover 과정 상세

```
장애 감지 및 페일오버 과정:

1. SDOWN (Subjective Down):
   개별 Sentinel이 down-after-milliseconds 동안 마스터로부터 응답을 받지 못하면
   해당 Sentinel은 주관적으로 마스터가 다운되었다고 판단한다.

2. ODOWN (Objective Down):
   SDOWN 상태인 Sentinel이 다른 Sentinel에게 "SENTINEL is-master-down-by-addr" 쿼리를 보낸다.
   quorum 이상의 Sentinel이 동의하면 객관적 다운(ODOWN)으로 판정한다.

3. Leader Election (Raft 알고리즘 기반):
   ODOWN이 확인되면 Sentinel 중 하나가 페일오버를 주도할 리더를 선출한다.
   각 Sentinel은 자신에게 투표하고, 과반수의 투표를 받은 Sentinel이 리더가 된다.
   리더 선출에는 quorum이 아닌 과반수(majority)가 필요하다.

4. 레플리카 선택:
   리더 Sentinel이 다음 기준으로 새 마스터가 될 레플리카를 선택한다:
   - replica-priority가 가장 낮은 레플리카 (0은 제외)
   - 복제 offset이 가장 큰 레플리카 (가장 최신 데이터)
   - run ID가 가장 작은 레플리카 (동률 시)

5. 페일오버 실행:
   - 선택된 레플리카에 REPLICAOF NO ONE 명령 전송
   - 다른 레플리카에 REPLICAOF <new-master> 명령 전송
   - 클라이언트에게 새 마스터 주소 전파 (Pub/Sub +switch-master 채널)
```

### Split-Brain 방지

Split-brain은 네트워크 파티션으로 인해 두 개의 마스터가 동시에 존재하는 상황이다. Sentinel은 다음과 같이 이를 방지한다:

- **quorum 설정**: 과반수 이상의 Sentinel이 동의해야 페일오버가 진행된다. 3대의 Sentinel에서 quorum 2이면, 네트워크 분리 시 Sentinel이 2대 이상 있는 파티션에서만 페일오버가 가능하다.
- **min-replicas-to-write**: 마스터에 연결된 레플리카가 최소 N개 미만이면 쓰기를 거부한다. 고립된 구 마스터가 계속 쓰기를 받는 것을 방지한다.

```
# sentinel.conf
sentinel monitor mymaster 10.0.0.1 6379 2   # quorum: 2
sentinel down-after-milliseconds mymaster 5000   # 5초간 응답 없으면 SDOWN
sentinel failover-timeout mymaster 60000         # 페일오버 타임아웃 60초
sentinel parallel-syncs mymaster 1               # 동시에 새 마스터와 동기화할 레플리카 수
sentinel auth-pass mymaster mypassword           # 마스터 인증 비밀번호

# 마스터 redis.conf에서 split-brain 방지
min-replicas-to-write 1
min-replicas-max-lag 10
```

### Sentinel 최소 구성 권장

- Sentinel 인스턴스는 최소 3대 이상 권장한다 (과반수 투표를 위해 홀수).
- 각 Sentinel은 서로 다른 장애 도메인(failure domain)에 배치한다 (다른 서버, 랙, AZ).
- quorum은 (Sentinel 수 / 2) + 1 이상으로 설정한다.

---

## Redis Cluster

Redis Cluster는 데이터를 여러 노드에 자동으로 분산(sharding)하는 수평 확장 솔루션이다.

### 해시 슬롯 (Hash Slots)

```
Redis Cluster 해시 슬롯:

총 16384개의 해시 슬롯을 노드에 분배한다.
키의 슬롯 = CRC16(key) mod 16384

┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│    Node A        │  │    Node B        │  │    Node C        │
│ 슬롯 0-5460      │  │ 슬롯 5461-10922  │  │ 슬롯 10923-16383 │
│  ┌────────────┐  │  │  ┌────────────┐  │  │  ┌────────────┐  │
│  │ Replica A' │  │  │  │ Replica B' │  │  │  │ Replica C' │  │
│  └────────────┘  │  │  └────────────┘  │  │  └────────────┘  │
└──────────────────┘  └──────────────────┘  └──────────────────┘
```

**왜 16384개인가:** Redis Cluster에서 각 노드는 비트맵으로 자신이 담당하는 슬롯 정보를 저장한다. 16384비트 = 2KB이다. 65536개로 하면 8KB가 되어 gossip 메시지가 불필요하게 커진다. Redis Cluster는 최대 약 1000개 노드를 권장하므로 16384개면 충분하다.

### MOVED / ASK 리다이렉션

- `MOVED <slot> <host>:<port>`: 클라이언트가 잘못된 노드에 요청하면 영구적으로 올바른 노드를 알려준다. 클라이언트는 슬롯 매핑을 업데이트해야 한다.
- `ASK <slot> <host>:<port>`: 리샤딩(resharding) 진행 중에 해당 슬롯이 다른 노드로 이동 중임을 알려준다. 클라이언트는 `ASKING` 명령 후 해당 노드에 일회성으로 요청한다.

```
MOVED 리다이렉션 예시:
Client → Node A: GET user:123
Node A → Client: -MOVED 4567 192.168.1.2:6379
Client → Node B (192.168.1.2:6379): GET user:123
Node B → Client: "홍길동"

ASK 리다이렉션 예시 (리샤딩 중):
Client → Node A: GET user:456
Node A → Client: -ASK 7890 192.168.1.3:6379
Client → Node C (192.168.1.3:6379): ASKING
Client → Node C: GET user:456
Node C → Client: "김철수"
```

### Cluster Bus (Gossip Protocol)

Redis Cluster 노드들은 클러스터 버스를 통해 서로 통신한다. 클러스터 버스 포트는 데이터 포트 + 10000이다 (예: 데이터 포트 6379이면 클러스터 버스 포트 16379).

Gossip 프로토콜을 통해 다음 정보를 교환한다:
- 노드의 상태 (정상/장애)
- 슬롯 할당 정보
- 설정 에포크(config epoch)
- 장애 감지 및 페일오버 투표

```
# redis.conf — Cluster 설정
cluster-enabled yes
cluster-config-file nodes.conf
cluster-node-timeout 15000         # 노드 타임아웃 (ms)
cluster-announce-ip 10.0.0.1       # 공개 IP (NAT 환경)
cluster-announce-port 6379         # 공개 포트
cluster-announce-bus-port 16379    # 클러스터 버스 포트
```

### 리샤딩 (Resharding)

노드 추가/제거 시 해시 슬롯을 재분배하는 과정이다. 온라인 상태에서 수행 가능하며, 한 번에 하나의 슬롯씩 이동한다.

```bash
# redis-cli로 리샤딩 수행
redis-cli --cluster reshard 10.0.0.1:6379 \
  --cluster-from <source-node-id> \
  --cluster-to <target-node-id> \
  --cluster-slots 1000 \
  --cluster-yes
```

### Hash Tag를 이용한 멀티 키 연산

```redis
# {user:1}을 해시 태그로 사용하면 같은 슬롯에 배치된다
SET {user:1}:name "홍길동"
SET {user:1}:email "hong@example.com"
# → 두 키가 같은 노드에 있으므로 MULTI/EXEC 가능

# 해시 태그가 없으면 다른 슬롯에 분산될 수 있어 멀티 키 연산 불가
```

### Cluster 모드의 제한 사항

- 멀티 키 연산(MGET, MSET 등)은 모든 키가 같은 슬롯에 있어야 한다.
- 데이터베이스는 0번만 사용 가능하다 (`SELECT` 불가).
- Lua 스크립트에서 접근하는 모든 키가 같은 슬롯에 있어야 한다.
- 트랜잭션(`MULTI`/`EXEC`)은 같은 슬롯의 키에 대해서만 가능하다.

---
