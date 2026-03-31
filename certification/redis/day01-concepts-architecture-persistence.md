# Day 1: Redis 개념, 아키텍처, 자료구조, 영속성

> Redis 핵심 개념, 단일 쓰레드 이벤트 루프 아키텍처, I/O 쓰레딩, 내부 인코딩 구조(SDS, Listpack, Quicklist, Skiplist, Intset, Stream, Dict), RDB/AOF/하이브리드 영속성 방식을 다룬다.

## 개념

### Redis란?

Redis(Remote Dictionary Server)는 오픈소스 인메모리 키-값 데이터 저장소이다. Salvatore Sanfilippo가 2009년에 개발했으며, 현재 Redis Ltd.에서 관리하고 있다. 캐시, 세션 저장소, 메시지 브로커, 실시간 분석, 리더보드, Rate Limiter 등 다양한 용도로 사용된다. 단일 쓰레드 이벤트 루프 기반으로 동작하여 모든 명령의 원자적 실행을 보장한다. 이 프로젝트에서는 `redis:7-alpine` 이미지를 사용한다.

### 핵심 개념

| 개념 | 설명 |
|------|------|
| Key-Value | 모든 데이터를 키-값 쌍으로 저장한다. 키는 binary-safe 문자열이며 최대 512MB까지 가능하다 |
| TTL | Time To Live로, 키의 만료 시간을 설정한다. `EXPIRE`, `PEXPIRE`(밀리초) 명령으로 제어한다 |
| Data Types | String, List, Set, Hash, Sorted Set, Stream, Bitmap, HyperLogLog, Geospatial 등을 지원한다 |
| Persistence | RDB(스냅샷), AOF(Append-Only File), RDB+AOF 하이브리드 모드로 디스크에 데이터를 저장한다 |
| Pub/Sub | 발행-구독 메시징 패턴을 지원한다. Redis Streams는 영속적 메시징도 제공한다 |
| Eviction | 메모리 한계에 도달하면 키를 자동 삭제하는 정책이다. 8가지 정책을 제공한다 |
| Pipelining | 여러 명령을 한 번에 전송하여 RTT(Round-Trip Time)를 줄이는 기법이다 |
| Transactions | `MULTI`/`EXEC`로 명령 그룹을 원자적으로 실행한다 |
| Lua Scripting | 서버 사이드에서 Lua 스크립트를 원자적으로 실행할 수 있다 |

---

### 이 프로젝트에서의 실습 환경

이 프로젝트에서 Redis는 dev 클러스터의 `demo` 네임스페이스에 배포된다.

- 매니페스트: `manifests/demo/redis-app.yaml`
- 이미지: `redis:7-alpine`
- 인증: 비활성화 (학습용)
- HPA: min 1 → max 3 (CPU 50%)
- 실습 대상 클러스터: dev (`kubeconfig/dev.yaml`)

```bash
# dev 클러스터에서 Redis 접속
export KUBECONFIG=kubeconfig/dev.yaml
kubectl exec -it -n demo deploy/redis -- redis-cli
```

---

## 아키텍처

### 단일 쓰레드 이벤트 루프 (Single-Threaded Architecture)

Redis는 메인 쓰레드 하나가 모든 클라이언트 요청을 처리하는 단일 쓰레드 아키텍처를 채택하고 있다. 이벤트 루프는 OS별 I/O 멀티플렉싱 API를 사용한다. Linux에서는 `epoll`, macOS/BSD에서는 `kqueue`, Solaris에서는 `evport`를 사용한다. Redis는 컴파일 시점에 최적의 I/O 멀티플렉싱 API를 자동 선택한다.

I/O 멀티플렉싱의 핵심은 하나의 쓰레드가 수천~수만 개의 소켓을 동시에 감시하다가, 데이터가 도착한 소켓만 선택적으로 처리하는 것이다. `epoll`의 경우 O(1) 시간에 이벤트가 발생한 파일 디스크립터만 반환하므로, 연결 수가 늘어나도 성능 저하가 거의 없다.

```
단일 쓰레드 이벤트 루프 아키텍처:

┌─────────────────────────────────────────────────────────┐
│                    Redis Server                         │
│                                                         │
│  ┌───────────────────────────────────────────────────┐  │
│  │              Event Loop (ae.c)                     │  │
│  │                                                   │  │
│  │   ┌──────────┐   ┌──────────┐   ┌──────────────┐ │  │
│  │   │ 파일이벤트│   │시간이벤트│   │  I/O 멀티    │ │  │
│  │   │(소켓 I/O)│   │(TTL 만료)│   │  플렉싱      │ │  │
│  │   │          │   │(주기작업)│   │ epoll/kqueue │ │  │
│  │   └──────────┘   └──────────┘   └──────────────┘ │  │
│  └───────────────────────────────────────────────────┘  │
│                         │                               │
│              ┌──────────┴──────────┐                    │
│              │  Command Execution  │ ◄─ 항상 단일 쓰레드│
│              │  (직렬 처리)        │                    │
│              └─────────────────────┘                    │
│                                                         │
│  Redis 6+ I/O 쓰레딩 (선택적):                          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                │
│  │I/O 쓰레드│ │I/O 쓰레드│ │I/O 쓰레드│                │
│  │ (읽기)   │ │ (읽기)   │ │ (쓰기)   │                │
│  └──────────┘ └──────────┘ └──────────┘                │
│  ※ 네트워크 읽기/쓰기만 병렬, 명령 실행은 여전히 직렬   │
└─────────────────────────────────────────────────────────┘
```

**단일 쓰레드가 빠른 이유:**

1. **Lock Contention 없음**: 멀티쓰레드 시스템에서 발생하는 mutex, spin lock 대기가 전혀 없다. 공유 자료구조에 대한 동기화 오버헤드가 0이다. Memcached와 비교하면, Memcached는 멀티쓰레드이므로 CAS(Compare-And-Swap), 글로벌 락 등의 비용이 발생한다.
2. **CPU 캐시 친화적**: 하나의 코어에서 모든 데이터를 처리하므로 L1/L2/L3 캐시 히트율이 높다. Context switching으로 인한 캐시 무효화(cache line invalidation)가 발생하지 않는다.
3. **커널 컨텍스트 스위칭 없음**: 쓰레드 간 전환 비용이 없으므로 순수하게 명령 처리에 CPU 시간을 사용한다. 일반적으로 쓰레드 컨텍스트 스위칭에는 1~10 마이크로초가 소요되는데, Redis는 이 비용이 0이다.
4. **I/O 멀티플렉싱의 효율**: `epoll`/`kqueue`를 통해 수만 개의 동시 연결을 단일 쓰레드에서 효율적으로 처리한다. `select()`나 `poll()`과 달리 이벤트 기반으로 동작하므로 연결 수에 비례하는 성능 저하가 없다.
5. **인메모리 특성**: 모든 데이터가 메모리에 있으므로 디스크 I/O 대기가 없다. 대부분의 명령이 마이크로초 단위로 완료되기 때문에 단일 쓰레드로도 초당 수십만 건의 요청을 처리할 수 있다.

**Redis 6+ I/O 쓰레딩:**

Redis 6부터 `io-threads` 설정으로 네트워크 I/O를 여러 쓰레드에서 병렬 처리할 수 있다. 그러나 명령 실행(command execution) 자체는 여전히 메인 쓰레드에서 직렬 처리된다. 이를 통해 원자성을 보장하면서도 네트워크 I/O 병목을 해소할 수 있다.

I/O 쓰레딩의 동작 과정은 다음과 같다:
1. 메인 쓰레드가 소켓에서 읽을 데이터가 있는 클라이언트를 파악한다.
2. I/O 쓰레드들이 각 클라이언트의 소켓에서 데이터를 병렬로 읽는다 (read + parse).
3. 메인 쓰레드가 파싱된 명령을 순차적으로 실행한다 (여전히 단일 쓰레드).
4. I/O 쓰레드들이 응답을 각 클라이언트 소켓에 병렬로 쓴다.

```
# redis.conf I/O 쓰레딩 설정
io-threads 4                 # I/O 쓰레드 수 (코어 수에 맞춤)
io-threads-do-reads yes      # 읽기도 쓰레딩 적용 (기본값: no, 쓰기만)
```

대부분의 워크로드에서는 I/O 쓰레딩 없이도 충분한 성능을 발휘한다. I/O 쓰레딩이 유효한 경우는 대량의 클라이언트가 동시에 큰 응답(예: `LRANGE`로 수천 개 요소 반환)을 받는 상황이다.

---

## 자료구조 내부 구현 (Data Structures Internals)

Redis의 높은 성능은 용도에 최적화된 내부 자료구조(encoding) 덕분이다. Redis는 데이터 크기와 요소 수에 따라 메모리 효율적인 인코딩을 자동 선택한다.

### 내부 인코딩 구조

| 외부 타입 | 내부 인코딩 (작은 데이터) | 내부 인코딩 (큰 데이터) | 전환 조건 |
|-----------|--------------------------|------------------------|-----------|
| String | int / embstr (44바이트 이하) | raw (SDS) | 44바이트 초과 시 raw |
| List | listpack (Redis 7+) | quicklist | 128개 또는 64바이트 초과 |
| Set | intset (정수만) / listpack | hashtable | 128개 초과 또는 비정수 포함 |
| Hash | listpack | hashtable | 128 필드 또는 64바이트 초과 |
| Sorted Set | listpack | skiplist + hashtable | 128개 또는 64바이트 초과 |

### String: SDS (Simple Dynamic String)

Redis는 C 표준 문자열(`char*`) 대신 SDS를 사용한다. C 표준 문자열은 `\0`(null terminator)으로 끝을 판단하므로 바이너리 데이터를 저장할 수 없고, `strlen`이 O(n)이며, 버퍼 오버플로에 취약하다. SDS는 이러한 문제를 모두 해결한다.

```
SDS 구조:
┌──────┬──────┬───────┬──────────────────────┬────┐
│ len  │ alloc│ flags │ buf (실제 데이터)     │ \0 │
│ (4B) │ (4B) │ (1B)  │                      │    │
└──────┴──────┴───────┴──────────────────────┴────┘
- len: 현재 문자열 길이 (O(1) strlen)
- alloc: 할당된 버퍼 크기 (사전 할당으로 재할당 빈도 감소)
- flags: SDS 타입 (sdshdr5/8/16/32/64)
```

**SDS의 주요 특성:**

- **O(1) 길이 조회**: `len` 필드에 길이를 저장하므로 `strlen` 연산이 O(1)이다.
- **Binary Safety**: `\0`이 포함된 바이너리 데이터도 안전하게 저장할 수 있다. 이미지, 직렬화된 객체 등을 그대로 저장 가능하다.
- **사전 할당(Pre-allocation)**: 문자열이 증가할 때 필요한 크기보다 더 많은 메모리를 할당한다. 1MB 미만이면 현재 길이만큼 추가 할당(doubling), 1MB 이상이면 1MB 추가 할당한다. 이로써 반복적인 `APPEND` 연산의 재할당 횟수를 줄인다.
- **Lazy Free**: 문자열이 줄어들어도 즉시 메모리를 해제하지 않고 `alloc` 크기를 유지한다. 이후 같은 키에 다시 긴 값을 쓸 때 재할당 없이 사용할 수 있다.
- **타입별 최적화**: `sdshdr5`(최대 32바이트), `sdshdr8`(최대 255바이트), `sdshdr16`, `sdshdr32`, `sdshdr64`로 헤더 크기를 최소화한다.

**String 인코딩 세부:**

- `int`: 값이 64비트 정수로 표현 가능하면 `redisObject` 내에 포인터 대신 값 자체를 저장한다. 추가 메모리 할당이 없다.
- `embstr`: 44바이트 이하의 문자열은 `redisObject`와 SDS를 하나의 연속된 메모리 블록에 할당한다. 메모리 할당 1회, 해제 1회로 효율적이다.
- `raw`: 44바이트를 초과하면 `redisObject`와 SDS를 별도로 할당한다. 메모리 할당 2회, 해제 2회가 필요하다.

### List: Quicklist (Listpack + Linked List 하이브리드)

List 타입은 Redis 3.2 이전에는 ziplist + linked list, 3.2부터는 quicklist(ziplist 기반), Redis 7.0부터는 quicklist(listpack 기반)를 사용한다.

**Listpack (Redis 7+, ziplist 후속):**

Listpack은 Redis 7에서 ziplist를 대체한 메모리 효율적 연속 배열 구조이다. ziplist는 cascading update 문제가 있었는데(하나의 요소 크기가 변경되면 연쇄적으로 뒤의 모든 요소 헤더를 업데이트해야 하는 문제), listpack은 이를 해결했다. 각 엔트리가 자신의 길이 정보만 가지고 있어 독립적이다.

```
Listpack 구조:
┌─────────┬─────────┬─────────┬─────────┬─────┐
│ total   │ entry 1 │ entry 2 │ entry 3 │ end │
│ bytes   │         │         │         │ 0xFF│
└─────────┴─────────┴─────────┴─────────┴─────┘
              │
              ▼
         ┌──────────┬──────┬───────────┐
         │ encoding │ data │ backlen   │
         │ (가변)   │      │ (역방향   │
         │          │      │  탐색용)  │
         └──────────┴──────┴───────────┘
```

작은 List, Hash, Set, Sorted Set에 사용된다. 모든 요소가 연속된 메모리 블록에 저장되어 캐시 효율이 높지만, 요소 수가 많아지면 삽입/삭제 시 O(n) 복사가 발생하므로 임계값 초과 시 다른 인코딩으로 전환된다.

**Quicklist:**

List 타입의 큰 데이터에 사용되는 구조이다. 여러 개의 listpack 노드를 이중 연결 리스트(doubly linked list)로 연결한 형태이다. 각 노드는 LZF 압축이 가능하여 메모리를 절약한다.

```
Quicklist 구조:
┌──────────┐   ┌──────────┐   ┌──────────┐
│ listpack │◄─►│ listpack │◄─►│ listpack │
│ (압축可) │   │ (압축可) │   │ (압축可) │
└──────────┘   └──────────┘   └──────────┘
     ↑                              ↑
   head                           tail
```

```
# Quicklist 관련 설정
list-max-listpack-size -2   # 각 listpack 노드의 최대 크기 (음수: 바이트 제한, 양수: 엔트리 수)
                             # -1: 4KB, -2: 8KB (기본), -3: 16KB, -4: 32KB, -5: 64KB
list-compress-depth 0        # 양쪽 끝에서 압축하지 않을 노드 수 (0: 압축 안 함)
                             # 1: head/tail 제외 모두 압축, 2: head/tail 각 2개 제외
```

### Hash: Listpack / Hashtable

Hash 타입은 필드 수가 적고 값이 작을 때 listpack을 사용하고, 임계값을 초과하면 hashtable로 전환된다.

```
# Hash 인코딩 전환 임계값 설정
hash-max-listpack-entries 128   # 필드 수가 128개를 초과하면 hashtable로 전환
hash-max-listpack-value 64      # 필드 또는 값의 바이트 크기가 64를 초과하면 hashtable로 전환
```

listpack 인코딩에서는 필드와 값이 연속된 메모리에 교대로 저장된다: `[field1][value1][field2][value2]...`. 조회 시 O(n) 선형 탐색이 필요하지만, 요소가 적을 때는 캐시 효율이 좋아 hashtable보다 빠르다.

### Set: Intset / Listpack / Hashtable

Set 타입의 인코딩은 데이터 특성에 따라 세 가지로 나뉜다.

**Intset:**

Set에 정수 값만 포함될 때 사용되는 정렬된 정수 배열이다. 이진 탐색으로 O(log n) 조회를 수행한다. 16비트, 32비트, 64비트 인코딩을 자동 선택하여 메모리를 절약한다. 예를 들어, 모든 원소가 -32768~32767 범위이면 16비트(2바이트/원소)만 사용한다. 큰 정수가 하나라도 추가되면 전체 배열이 자동으로 업그레이드(upgrade)된다.

```
Intset 구조:
┌──────────┬────────┬──────┬──────┬──────┬──────┐
│ encoding │ length │ val0 │ val1 │ val2 │ val3 │
│ (16/32/  │        │      │      │      │      │
│  64bit)  │        │      │      │      │      │
└──────────┴────────┴──────┴──────┴──────┴──────┘
- 정렬된 상태를 유지하여 이진 탐색 가능
- 삽입 시 memmove로 요소 이동 필요 (O(n))
```

```
# Set 인코딩 전환 임계값 설정
set-max-intset-entries 512      # 정수만으로 구성된 Set의 최대 원소 수 (초과 시 hashtable)
set-max-listpack-entries 128    # listpack 인코딩의 최대 원소 수
set-max-listpack-value 64       # listpack 인코딩의 최대 값 바이트 크기
```

### Sorted Set: Skiplist + Hashtable 이중 구조

Sorted Set의 큰 데이터에 사용되는 확률적 자료구조이다. Sorted Set은 두 가지 자료구조를 동시에 유지한다:

1. **Skiplist**: 점수(score) 기반 범위 쿼리와 정렬을 위한 구조이다. 평균 O(log n)의 삽입, 삭제, 검색 성능을 제공한다.
2. **Hashtable (dict)**: 멤버(member)로 직접 조회할 때 O(1) 성능을 제공한다. `ZSCORE` 명령이 O(1)인 이유이다.

**왜 균형 이진 트리(AVL, Red-Black Tree) 대신 Skiplist인가:**

Redis 저자 Salvatore Sanfilippo가 밝힌 이유는 다음과 같다:
- Skiplist는 구현이 단순하다. 디버깅, 수정, 유지보수가 용이하다.
- 범위 연산(ZRANGEBYSCORE)이 자연스럽다. 순차 탐색으로 범위를 빠르게 반환할 수 있다.
- 균형 트리와 동등한 평균 성능을 가진다 (O(log n)).
- 메모리 사용량을 `ZSET_MAX_LEVEL`(기본 32)로 제어 가능하다.
- 동시성 구현이 더 용이하다 (Redis 내부 목적).

```
Skiplist 구조 (레벨 예시):
Level 3: head ──────────────────────────────────► 50 ───────► NIL
Level 2: head ──────────► 20 ──────────────────► 50 ───────► NIL
Level 1: head ───► 10 ──► 20 ──► 30 ──► 40 ──► 50 ──► 60 ► NIL

각 노드는 확률적으로 레벨이 결정된다 (p = 0.25).
- 레벨 1: 100%의 노드
- 레벨 2: 25%의 노드
- 레벨 3: 6.25%의 노드
- 레벨 k: (0.25)^(k-1)의 노드
```

```
# Sorted Set 인코딩 전환 임계값 설정
zset-max-listpack-entries 128   # 원소 수가 128개를 초과하면 skiplist로 전환
zset-max-listpack-value 64      # 값의 바이트 크기가 64를 초과하면 skiplist로 전환
```

### Stream: Radix Tree + Listpack

Stream은 Redis 5.0에서 도입된 로그형 자료구조이다. 내부적으로 radix tree(기수 트리)와 listpack의 조합으로 구현되어 있다.

```
Stream 내부 구조:
                  ┌──────────────┐
                  │  Radix Tree  │ ◄─ Stream ID를 키로 사용
                  │  (rax)       │
                  └──────┬───────┘
                         │
            ┌────────────┼────────────┐
            ▼            ▼            ▼
      ┌──────────┐ ┌──────────┐ ┌──────────┐
      │ listpack │ │ listpack │ │ listpack │
      │ (엔트리  │ │ (엔트리  │ │ (엔트리  │
      │  그룹)   │ │  그룹)   │ │  그룹)   │
      └──────────┘ └──────────┘ └──────────┘
```

- **Radix Tree**: Stream ID(타임스탬프-시퀀스)를 키로 하여 listpack 노드를 관리한다. 공통 접두사를 공유하여 메모리를 절약한다.
- **Listpack**: 실제 필드-값 쌍을 저장한다. 하나의 listpack 노드에 여러 Stream 엔트리를 묶어서 저장한다. `stream-node-max-bytes`(기본 4096)와 `stream-node-max-entries`(기본 100)로 제어한다.

**Consumer Group:**

Consumer Group은 여러 소비자가 스트림의 메시지를 분산 처리할 수 있게 하는 기능이다. Kafka의 Consumer Group과 유사한 개념이다.

- 각 Consumer Group은 독립적인 `last-delivered-id`를 유지한다.
- 그룹 내 각 소비자(consumer)는 PEL(Pending Entries List)을 가진다. PEL은 전달되었지만 아직 ACK되지 않은 메시지 목록이다.
- `XACK`로 처리 완료를 확인하면 PEL에서 제거된다.
- `XCLAIM`으로 오래된 미확인 메시지를 다른 소비자에게 재할당할 수 있다 (장애 복구).
- `XAUTOCLAIM` (Redis 6.2+)은 자동으로 오래된 pending 메시지를 클레임한다.

### Dict (해시 테이블)

Redis의 핵심 자료구조로, 키 공간 전체와 Hash/Set 타입에 사용된다. 점진적 리해싱(incremental rehashing)을 지원하여 리해싱 중에도 서비스 중단이 발생하지 않는다. 두 개의 해시 테이블(`ht[0]`, `ht[1]`)을 유지하며, 요청 처리 시 한 버킷씩 점진적으로 마이그레이션한다.

```
Dict 점진적 리해싱:

시작 상태:
ht[0]: [A][B][C][D][-][-][-][-]  (load factor > 1 → 리해싱 시작)
ht[1]: [-][-][-][-][-][-][-][-][-][-][-][-][-][-][-][-]  (2배 크기)

진행 중:
ht[0]: [-][-][C][D][-][-][-][-]  (A, B가 ht[1]로 이동)
ht[1]: [-][A][-][-][-][B][-][-][-][-][-][-][-][-][-][-]

완료:
ht[0]: (비어있음 → 해제)
ht[1] → ht[0] (교체)
```

리해싱 중에는 조회(GET)가 `ht[0]`과 `ht[1]` 양쪽을 모두 탐색하고, 삽입은 `ht[1]`에만 수행한다. 각 명령 처리 시 1개의 버킷을 마이그레이션하며, 주기적 타이머(`serverCron`)에서도 1ms 동안 마이그레이션을 수행한다.

---

## 영속성 (Persistence)

Redis는 인메모리 저장소이지만 데이터를 디스크에 영속화하는 세 가지 방식을 제공한다. 순수 캐시 용도로 사용할 때는 영속성을 완전히 끌 수도 있다.

### RDB (Redis Database Backup)

RDB는 특정 시점의 메모리 스냅샷을 바이너리 파일(`dump.rdb`)로 저장하는 방식이다.

```
RDB 동작 원리 (BGSAVE):

1. Redis가 fork()로 자식 프로세스를 생성한다
2. 부모 프로세스는 계속 클라이언트 요청을 처리한다
3. 자식 프로세스가 메모리 데이터를 dump.rdb로 기록한다
4. Copy-on-Write(COW)로 fork 시점의 데이터 일관성을 보장한다

┌─────────────┐  fork()  ┌──────────────┐
│ 부모 프로세스 │────────►│ 자식 프로세스  │
│ (요청 처리)  │         │ (RDB 기록)    │
│              │         │               │
│ 쓰기 발생 시 │         │  메모리 읽기   │
│ COW 복사     │         │   ↓           │
│              │         │  dump.rdb     │
└─────────────┘         └──────────────┘
```

**Copy-on-Write(COW) 심화:**

`fork()` 시 자식 프로세스는 부모의 메모리 페이지 테이블을 복사하지만, 실제 물리 메모리 페이지는 공유한다. 부모 프로세스가 특정 페이지에 쓰기를 수행하면 그때 해당 페이지만 복사된다. 따라서 fork 직후에는 추가 메모리가 거의 필요 없지만, 쓰기가 빈번하면 최대 2배의 메모리가 필요할 수 있다.

- `INFO memory`의 `used_memory_rdb` 필드로 COW로 인한 추가 메모리 사용량을 확인할 수 있다.
- 리눅스에서 Transparent Huge Pages(THP)가 활성화되어 있으면 COW 시 2MB 단위로 복사가 발생하여 메모리 사용량이 급증할 수 있다. Redis 운영 시 THP를 비활성화하는 것이 권장된다.

```
# redis.conf RDB 설정
save 3600 1        # 3600초(1시간) 동안 1개 이상 변경 시 저장
save 300 100       # 300초(5분) 동안 100개 이상 변경 시 저장
save 60 10000      # 60초(1분) 동안 10000개 이상 변경 시 저장

# RDB 파일 설정
dbfilename dump.rdb
dir /data

# RDB 저장 실패 시 쓰기 명령 거부 (데이터 보호)
stop-writes-on-bgsave-error yes

# RDB 파일 LZF 압축 (약간의 CPU 사용으로 파일 크기 감소)
rdbcompression yes

# RDB 파일 CRC64 체크섬 검증
rdbchecksum yes

# 수동 트리거
# BGSAVE  (비동기, 권장)
# SAVE    (동기, 서버 블로킹 — 운영 환경에서 사용 금지)
```

**RDB 파일 형식:**

RDB 파일은 Redis 전용 바이너리 형식이다. 헤더(`REDIS0011`), 보조 필드(redis-ver, redis-bits, ctime 등), 데이터베이스 선택자, 키-값 쌍(타입+만료시간+키+값), EOF 마커, CRC64 체크섬으로 구성된다.

**RDB 장점:** 컴팩트한 바이너리 파일로 백업과 복원이 빠르다. 자식 프로세스가 디스크 I/O를 담당하므로 부모 프로세스 성능에 미치는 영향이 적다. 특정 시점 복원(point-in-time recovery)이 가능하여 S3 등에 정기적으로 백업하기 좋다.

**RDB 단점:** 저장 간격 사이의 데이터는 유실될 수 있다(최대 save 간격만큼). 데이터셋이 크면 fork() 시 순간적인 지연(latency spike)이 발생한다. fork()는 메모리 페이지 테이블 복사 비용이 있어 데이터셋이 수십 GB일 때 수백 밀리초의 지연이 발생할 수 있다.

### AOF (Append-Only File)

AOF는 모든 쓰기 명령을 로그 파일(`appendonly.aof`)에 순차적으로 기록하는 방식이다. RESP(Redis Serialization Protocol) 형식으로 기록되므로 사람이 읽을 수 있다.

```
# redis.conf AOF 설정
appendonly yes
appendfilename "appendonly.aof"
appenddirname "appendonlydir"    # Redis 7+: 멀티파트 AOF 디렉토리
```

**Redis 7+ 멀티파트 AOF:**

Redis 7부터 AOF는 단일 파일이 아닌 멀티파트 형식을 사용한다:
- **Base AOF**: AOF rewrite의 결과물 (RDB 또는 AOF 형식)
- **Incremental AOF**: 마지막 rewrite 이후의 변경분
- **Manifest 파일**: 현재 활성 AOF 파일 목록을 관리

```
appendonlydir/
├── appendonly.aof.1.base.rdb      # 기본 스냅샷 (RDB 형식)
├── appendonly.aof.1.incr.aof      # 증분 변경분
├── appendonly.aof.2.incr.aof      # 추가 증분 변경분
└── appendonly.aof.manifest        # 매니페스트 파일
```

**fsync 정책:**

| 정책 | 설명 | 데이터 안전성 | 성능 |
|------|------|-------------|------|
| `appendfsync always` | 매 쓰기 명령마다 fsync 호출 | 최고 (유실 거의 없음) | 가장 느림 |
| `appendfsync everysec` | 1초마다 fsync 호출 (기본값, 권장) | 높음 (최대 1초 유실) | 좋음 |
| `appendfsync no` | OS에 위임 (보통 30초 간격) | 낮음 | 가장 빠름 |

`appendfsync always`는 매 명령마다 커널 버퍼를 디스크에 강제 동기화하므로 디스크 IOPS에 직접적인 영향을 받는다. SSD에서도 `always`는 처리량을 크게 떨어뜨린다. `everysec`는 별도의 백그라운드 쓰레드에서 1초마다 fsync를 수행하므로 메인 쓰레드를 블로킹하지 않는다. 단, 이전 fsync가 아직 완료되지 않았는데 2초가 경과하면 메인 쓰레드가 블로킹될 수 있다.

**AOF Rewrite (`BGREWRITEAOF`):**

AOF 파일이 커지면 `BGREWRITEAOF` 명령으로 현재 메모리 상태를 반영하는 최소한의 명령 세트로 재작성한다. 예를 들어, 같은 키에 대한 100번의 `INCR` 명령은 `SET key 100` 하나로 압축된다. RDB와 마찬가지로 fork()로 자식 프로세스에서 수행한다.

AOF rewrite 중에 들어오는 새 쓰기 명령은 AOF rewrite 버퍼에 별도로 저장된다. 자식 프로세스의 rewrite가 완료되면, 부모 프로세스가 버퍼의 내용을 새 AOF 파일에 추가한 뒤 원자적으로 파일을 교체(rename)한다.

```
# AOF 자동 rewrite 설정
auto-aof-rewrite-percentage 100   # AOF 파일이 마지막 rewrite 대비 100% 커지면
auto-aof-rewrite-min-size 64mb    # 최소 64MB 이상일 때 rewrite 실행
```

### RDB + AOF 하이브리드 모드

Redis 4.0+에서는 AOF rewrite 시 RDB 스냅샷을 AOF 파일의 앞부분에 기록하고, 이후 변경분만 AOF 형식으로 추가하는 하이브리드 방식을 지원한다. 빠른 복원(RDB)과 높은 데이터 안전성(AOF)의 장점을 결합한 방식이다.

```
# redis.conf 하이브리드 설정
aof-use-rdb-preamble yes   # 기본값 yes (Redis 5+)
```

```
하이브리드 AOF 파일 구조:
┌──────────────────────────────────┐
│ RDB 스냅샷 (바이너리)            │ ◄─ 빠른 로딩
├──────────────────────────────────┤
│ AOF 증분 명령 (RESP 텍스트)      │ ◄─ 스냅샷 이후 변경분
│ *3\r\n$3\r\nSET\r\n$3\r\n...   │
└──────────────────────────────────┘
```

### 영속성 없음 (No Persistence)

순수 캐시 용도로 사용할 때는 RDB와 AOF를 모두 비활성화할 수 있다. 데이터 유실이 허용되는 경우에만 사용한다.

```
# redis.conf — 영속성 비활성화
save ""           # RDB 비활성화
appendonly no     # AOF 비활성화
```

### 영속성 방식 비교

| 항목 | RDB | AOF (everysec) | 하이브리드 | No Persistence |
|------|-----|----------------|------------|----------------|
| 데이터 안전성 | 낮음 (분~시간 유실) | 높음 (최대 1초 유실) | 높음 | 없음 |
| 복원 속도 | 매우 빠름 | 느림 (명령 재실행) | 빠름 | N/A |
| 파일 크기 | 작음 (바이너리 압축) | 큼 (텍스트 명령) | 중간 | N/A |
| fork 빈도 | save 조건 충족 시 | rewrite 시 | rewrite 시 | 없음 |
| 적합한 용도 | 백업, 재해 복구 | 데이터 중요도 높음 | 범용 (권장) | 순수 캐시 |

---
