# Redis - 인메모리 데이터 스토어

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
