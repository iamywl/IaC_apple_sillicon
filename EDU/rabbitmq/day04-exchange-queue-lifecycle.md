# Day 4: Exchange/Queue 타입 및 메시지 라이프사이클

> Direct, Fanout, Topic, Headers Exchange의 동작 원리와 Classic, Quorum, Stream Queue의 차이점, 메시지 라우팅부터 소비까지의 전체 라이프사이클을 학습한다.

---

## Exchange 타입 심화

### Direct Exchange 심화

#### 라우팅 키 매칭 알고리즘

Direct Exchange는 메시지의 routing key와 바인딩의 routing key를 **정확 문자열 비교(exact string match)**로 매칭한다. 내부적으로 Erlang의 패턴 매칭과 해시 테이블을 활용하여 O(1)에 가까운 라우팅 성능을 달성한다.

```
Direct Exchange 라우팅 테이블 (내부 구조):

Binding Table (Hash Map):
┌─────────────────┬──────────────────────┐
│ Routing Key     │ Destination Queues   │
├─────────────────┼──────────────────────┤
│ "order.new"     │ [queue-A, queue-B]   │
│ "order.cancel"  │ [queue-C]            │
│ "payment.done"  │ [queue-D]            │
└─────────────────┴──────────────────────┘

메시지(routing_key="order.new") 도착
  → 해시 테이블에서 "order.new" 검색
  → queue-A, queue-B에 메시지 복사
```

#### 성능 특성

- 바인딩 수에 관계없이 라우팅 시간이 거의 일정하다 (해시 테이블 기반)
- 메모리 사용량은 바인딩 수에 비례한다
- 동일한 routing key에 N개의 큐가 바인딩되면 메시지가 N번 복사된다
- Topic Exchange 대비 약 15-20% 높은 처리량을 보인다 (패턴 매칭이 없으므로)

### Fanout Exchange 심화

#### 바인딩 테이블 구조

Fanout Exchange는 routing key를 완전히 무시한다. 내부적으로 바인딩된 큐의 목록만 유지하며, 메시지가 도착하면 모든 바인딩된 큐에 무조건 복사한다.

```
Fanout Exchange 내부 구조:

Binding Set (Ordered List):
┌──────────────────────┐
│ Bound Queues         │
├──────────────────────┤
│ queue-notifications  │
│ queue-audit-log      │
│ queue-analytics      │
│ queue-cache-update   │
└──────────────────────┘

메시지 도착 (routing_key 무관)
  → 모든 큐에 메시지 복사 (4개 큐 → 4번 복사)
```

#### Pub/Sub 패턴 구현

Fanout Exchange는 전형적인 Publish/Subscribe 패턴을 구현한다. 각 구독자(Subscriber)가 자신만의 큐를 생성하고 Fanout Exchange에 바인딩하면, Publisher가 하나의 메시지를 발행할 때 모든 구독자가 독립적으로 메시지를 수신한다.

```javascript
// Pub/Sub 패턴: 각 서비스가 자체 큐를 바인딩
async function setupFanoutSubscriber(serviceName) {
  const channel = await connection.createChannel();
  await channel.assertExchange('events.broadcast', 'fanout', { durable: true });

  // 서비스별 전용 큐 (exclusive=false, durable=true로 영속적 구독)
  const queueName = `events.${serviceName}`;
  await channel.assertQueue(queueName, { durable: true });
  await channel.bindQueue(queueName, 'events.broadcast', '');  // routing key 무의미

  channel.consume(queueName, (msg) => {
    console.log(`[${serviceName}] 수신: ${msg.content.toString()}`);
    channel.ack(msg);
  });
}

// 여러 서비스가 동일 이벤트를 독립적으로 수신
await setupFanoutSubscriber('email-service');
await setupFanoutSubscriber('sms-service');
await setupFanoutSubscriber('analytics-service');
```

### Topic Exchange 심화

#### 와일드카드 매칭 알고리즘

Topic Exchange의 routing key는 `.`(dot)으로 구분된 단어(word)의 시퀀스이다. 바인딩 패턴에서 두 가지 와일드카드를 사용한다:

- `*` (star): 정확히 하나의 단어를 매칭한다
- `#` (hash): 0개 이상의 단어를 매칭한다

```
매칭 예시:

routing_key: "order.new.priority"

패턴 "order.new.priority"  → 매칭 (정확 일치)
패턴 "order.new.*"         → 매칭 (* = "priority")
패턴 "order.*.priority"    → 매칭 (* = "new")
패턴 "*.new.*"             → 매칭 (* = "order", * = "priority")
패턴 "order.#"             → 매칭 (# = "new.priority")
패턴 "#.priority"          → 매칭 (# = "order.new")
패턴 "#"                   → 매칭 (# = "order.new.priority")
패턴 "order.new"           → 불일치 (단어 수 다름)
패턴 "order.*.*.priority"  → 불일치 (단어 수 다름)
패턴 "*.new"               → 불일치 (* 는 하나만 매칭, 3단어 vs 2단어)
```

#### Trie 기반 구현

RabbitMQ는 Topic Exchange의 패턴 매칭을 효율적으로 수행하기 위해 Trie(접두사 트리) 자료구조를 사용한다:

```
바인딩 패턴들:
  "order.*"          → Queue-A
  "order.new"        → Queue-B
  "order.#"          → Queue-C
  "*.critical"       → Queue-D

Trie 구조:
          (root)
         /      \
      order      *
      /   \       \
     *    new    critical
    [A]   [B]     [D]
     #
    [C]

매칭 과정 (routing_key="order.new"):
  1. "order" → Trie에서 "order" 노드 탐색
  2. "new" → "order" 아래에서 "new" 탐색 → Queue-B (정확 일치)
             "order" 아래에서 "*" 탐색 → Queue-A (와일드카드 매칭)
             "order" 아래에서 "#" 탐색 → Queue-C (0개 이상 매칭)
  3. root에서 "*" 탐색 → "new"는 "critical"이 아니므로 불일치
  결과: Queue-A, Queue-B, Queue-C
```

바인딩 수가 N일 때, Topic Exchange의 최악 시간 복잡도는 O(N)이지만, Trie 구조 덕분에 실제로는 routing key의 단어 수 L에 비례하는 O(L * B) 성능을 보인다 (B는 분기 수). 바인딩 패턴이 많더라도 공통 접두사가 있으면 효율적으로 매칭할 수 있다.

#### 성능 주의사항

- `#`를 포함하는 패턴은 0개 이상의 단어를 매칭해야 하므로 탐색 범위가 넓어진다
- `#`만으로 구성된 바인딩 패턴은 모든 메시지를 수신한다 (Fanout처럼 동작)
- 바인딩 패턴이 수천 개를 넘으면 Direct Exchange 대비 라우팅 지연이 눈에 띈다
- routing key의 최대 길이는 255바이트이다

### Headers Exchange 심화

#### 헤더 매칭 메커니즘

Headers Exchange는 메시지의 `headers` 속성(AMQP table)을 바인딩 시 지정한 헤더와 비교하여 라우팅한다.

```javascript
// Headers Exchange 바인딩 예시
await channel.assertExchange('reports', 'headers', { durable: true });

// x-match: all → 모든 헤더가 일치해야 라우팅 (AND)
await channel.assertQueue('pdf-monthly', { durable: true });
await channel.bindQueue('pdf-monthly', 'reports', '', {
  'x-match': 'all',
  'format': 'pdf',
  'period': 'monthly'
});

// x-match: any → 하나라도 일치하면 라우팅 (OR)
await channel.assertQueue('all-urgent', { durable: true });
await channel.bindQueue('all-urgent', 'reports', '', {
  'x-match': 'any',
  'priority': 'urgent',
  'escalated': 'true'
});

// 메시지 발행 (headers 속성 포함)
channel.publish('reports', '', Buffer.from('report data'), {
  headers: {
    'format': 'pdf',
    'period': 'monthly',
    'priority': 'normal'
  }
});
// → pdf-monthly 큐에 라우팅됨 (format=pdf AND period=monthly 매칭)
// → all-urgent 큐에는 라우팅되지 않음 (priority≠urgent, escalated 없음)
```

#### 사용 사례

Headers Exchange는 다음과 같은 경우에 유용하다:

1. **다차원 라우팅**: routing key로는 하나의 차원만 표현할 수 있지만, headers는 여러 차원의 속성을 동시에 매칭할 수 있다
2. **동적 라우팅 규칙**: 헤더 기반 라우팅은 런타임에 바인딩 조건을 유연하게 변경할 수 있다
3. **복합 필터링**: 메시지 유형, 우선순위, 출처 등 여러 기준을 조합하여 필터링할 때 적합하다

단, Headers Exchange는 모든 바인딩의 헤더를 순차적으로 비교하므로 바인딩 수가 많으면 성능이 저하된다. 대부분의 경우 Topic Exchange로 충분하며, Headers Exchange는 routing key로 표현하기 어려운 복합 조건이 필요할 때만 사용하는 것이 좋다.

### Default Exchange 심화

Default Exchange는 이름이 빈 문자열(`""`)인 특수한 Direct Exchange이다. 다음과 같은 특성을 가진다:

- 모든 큐는 생성 시 자동으로 큐 이름과 동일한 routing key로 Default Exchange에 바인딩된다
- 이 바인딩은 삭제할 수 없다
- Default Exchange 자체를 삭제하거나 재선언할 수 없다
- 새 바인딩을 추가할 수 없다

```
큐 "order-queue" 생성 시 자동으로:
  Default Exchange("") ─── [routing_key="order-queue"] ──► Queue: order-queue

따라서 다음 두 코드는 동일하게 동작한다:
  channel.publish("", "order-queue", message);          // Default Exchange 사용
  channel.sendToQueue("order-queue", message);           // sendToQueue 편의 메서드
```

Default Exchange는 간단한 점대점(point-to-point) 메시징에 유용하지만, 프로덕션 환경에서는 명시적인 Exchange를 선언하고 바인딩을 관리하는 것이 유지보수에 유리하다.

### Dead Letter Exchange (DLX) 심화

#### DLX 체인

DLX도 일반 Exchange이므로, DLX에 의해 라우팅된 큐가 다시 DLX를 설정할 수 있다. 이를 DLX 체인이라 한다.

```
DLX 체인 예시:

main-queue ──(처리 실패)──► dlx-retry ──► retry-queue
                                          (TTL=5s)
                                          │
                                          │ TTL 만료
                                          ▼
                                    main-exchange ──► main-queue (재시도)
                                          │
                                          │ 재시도 횟수 초과
                                          ▼
                                    dlx-parking ──► parking-lot-queue
                                                    (수동 처리 대기)
```

#### Retry 패턴 구현

지수 백오프(exponential backoff)를 적용한 재시도 패턴을 DLX 체인으로 구현할 수 있다:

```javascript
// 지수 백오프 재시도 패턴
async function setupRetryTopology(channel) {
  // 1. 메인 Exchange와 Queue
  await channel.assertExchange('main', 'direct', { durable: true });
  await channel.assertQueue('main-queue', {
    durable: true,
    arguments: {
      'x-dead-letter-exchange': 'retry',
      'x-dead-letter-routing-key': 'retry'
    }
  });
  await channel.bindQueue('main-queue', 'main', 'work');

  // 2. Retry Exchange와 단계별 Retry Queue
  await channel.assertExchange('retry', 'direct', { durable: true });

  // Retry Level 1: 5초 후 재시도
  await channel.assertQueue('retry-queue-5s', {
    durable: true,
    arguments: {
      'x-dead-letter-exchange': 'main',
      'x-dead-letter-routing-key': 'work',
      'x-message-ttl': 5000
    }
  });
  await channel.bindQueue('retry-queue-5s', 'retry', 'retry');

  // Retry Level 2: 30초 후 재시도
  await channel.assertQueue('retry-queue-30s', {
    durable: true,
    arguments: {
      'x-dead-letter-exchange': 'main',
      'x-dead-letter-routing-key': 'work',
      'x-message-ttl': 30000
    }
  });

  // Retry Level 3: 5분 후 재시도
  await channel.assertQueue('retry-queue-5m', {
    durable: true,
    arguments: {
      'x-dead-letter-exchange': 'main',
      'x-dead-letter-routing-key': 'work',
      'x-message-ttl': 300000
    }
  });

  // 3. Parking Lot (최종 실패)
  await channel.assertExchange('parking-lot', 'direct', { durable: true });
  await channel.assertQueue('parking-lot-queue', { durable: true });
  await channel.bindQueue('parking-lot-queue', 'parking-lot', 'failed');
}

// Consumer에서 재시도 횟수에 따라 분기
channel.consume('main-queue', (msg) => {
  try {
    processMessage(msg);
    channel.ack(msg);
  } catch (err) {
    const retryCount = (msg.properties.headers['x-retry-count'] || 0);
    if (retryCount >= 3) {
      // Parking Lot으로 이동
      channel.publish('parking-lot', 'failed', msg.content, {
        headers: { ...msg.properties.headers, 'x-final-error': err.message }
      });
      channel.ack(msg);
    } else {
      // 재시도 큐로 이동 (재시도 횟수에 따라 대기 시간 증가)
      const retryQueues = ['retry-queue-5s', 'retry-queue-30s', 'retry-queue-5m'];
      channel.publish('', retryQueues[retryCount], msg.content, {
        headers: { ...msg.properties.headers, 'x-retry-count': retryCount + 1 }
      });
      channel.ack(msg);
    }
  }
});
```

#### Parking Lot 패턴

Parking Lot 패턴은 재시도를 모두 소진한 메시지를 별도의 큐에 보관하여 수동으로 검토하고 처리하는 패턴이다. Parking Lot 큐의 메시지는 다음과 같이 처리한다:

1. Management UI에서 메시지 내용과 헤더를 확인한다
2. 원인을 분석하고 수정한 후 수동으로 재발행한다
3. 또는 자동화된 배치 프로세스로 주기적으로 재시도한다

### Alternate Exchange

Alternate Exchange는 메시지가 어떤 큐에도 라우팅되지 않을 때 대체 경로를 제공한다. Exchange 선언 시 `alternate-exchange` 인자로 지정한다.

```javascript
// Alternate Exchange 설정
await channel.assertExchange('unrouted-handler', 'fanout', { durable: true });
await channel.assertQueue('unrouted-messages', { durable: true });
await channel.bindQueue('unrouted-messages', 'unrouted-handler', '');

// 메인 Exchange에 Alternate Exchange 설정
await channel.assertExchange('orders', 'direct', {
  durable: true,
  alternateExchange: 'unrouted-handler'  // 라우팅 실패 시 대체 경로
});

// "order.new"로 바인딩된 큐만 존재
await channel.assertQueue('new-orders', { durable: true });
await channel.bindQueue('new-orders', 'orders', 'order.new');

// routing_key="order.unknown" → 매칭되는 큐 없음
// → Alternate Exchange(unrouted-handler)로 전달
// → unrouted-messages 큐에 저장
channel.publish('orders', 'order.unknown', Buffer.from('...'));
```

Alternate Exchange와 `mandatory` 플래그의 차이점은 다음과 같다:
- `mandatory=true`: 라우팅 실패 시 Publisher에게 `Basic.Return`으로 반송한다. Publisher가 반송을 처리해야 한다
- Alternate Exchange: 라우팅 실패 시 브로커 내부에서 대체 Exchange로 자동 전달한다. Publisher는 라우팅 실패를 인지하지 못한다

### Consistent Hash Exchange (플러그인)

Consistent Hash Exchange는 `rabbitmq_consistent_hash_exchange` 플러그인으로 제공되며, routing key의 해시값을 기반으로 메시지를 여러 큐에 균등하게 분배한다.

```bash
# 플러그인 활성화
rabbitmq-plugins enable rabbitmq_consistent_hash_exchange
```

```javascript
// Consistent Hash Exchange 설정
await channel.assertExchange('load-balance', 'x-consistent-hash', { durable: true });

// 각 큐에 가중치(weight)를 부여하여 바인딩
// routing key가 가중치 역할을 한다 (숫자 문자열)
await channel.assertQueue('worker-1', { durable: true });
await channel.bindQueue('worker-1', 'load-balance', '10');  // 가중치 10

await channel.assertQueue('worker-2', { durable: true });
await channel.bindQueue('worker-2', 'load-balance', '10');  // 가중치 10

await channel.assertQueue('worker-3', { durable: true });
await channel.bindQueue('worker-3', 'load-balance', '20');  // 가중치 20 (2배 할당)

// 메시지 발행: routing key의 해시에 따라 큐에 분배
// 동일한 routing key는 항상 동일한 큐로 라우팅된다 (affinity 보장)
channel.publish('load-balance', 'user-123', Buffer.from('...'));  // → worker-3
channel.publish('load-balance', 'user-456', Buffer.from('...'));  // → worker-1
```

Consistent Hash Exchange의 특성은 다음과 같다:
- 동일한 routing key는 항상 동일한 큐로 라우팅된다 (키 어피니티)
- 큐를 추가/제거해도 기존 매핑의 대부분이 유지된다 (consistent hashing 특성)
- 헤더 기반 해싱도 지원한다 (`hash-header` 인자로 해싱에 사용할 헤더를 지정)

### Exchange-to-Exchange 바인딩

RabbitMQ 확장 기능으로, Exchange를 다른 Exchange의 목적지(destination)로 바인딩할 수 있다. 이를 통해 계층적이고 유연한 라우팅 토폴로지를 구성한다.

```javascript
// Exchange-to-Exchange 바인딩 예시: 계층적 라우팅
await channel.assertExchange('events.all', 'topic', { durable: true });
await channel.assertExchange('events.orders', 'direct', { durable: true });
await channel.assertExchange('events.payments', 'direct', { durable: true });

// Exchange → Exchange 바인딩
await channel.bindExchange('events.orders', 'events.all', 'order.*');
await channel.bindExchange('events.payments', 'events.all', 'payment.*');

// Queue → Exchange 바인딩 (일반 바인딩)
await channel.assertQueue('order-created', { durable: true });
await channel.bindQueue('order-created', 'events.orders', 'order.created');

await channel.assertQueue('payment-completed', { durable: true });
await channel.bindQueue('payment-completed', 'events.payments', 'payment.completed');

// 메시지 발행 (최상위 Exchange로)
channel.publish('events.all', 'order.created', Buffer.from('...'));
// → events.all(topic) → events.orders(direct) → order-created(queue)

// 라우팅 흐름:
// events.all ──(order.*)──► events.orders ──(order.created)──► order-created
//             ──(payment.*)──► events.payments ──(payment.completed)──► payment-completed
```

이 패턴은 마이크로서비스 환경에서 도메인별 Exchange를 분리하면서도 공통 진입점을 제공할 때 유용하다.

---

## Queue 타입 심화

### Classic Queue 심화

#### 메모리/디스크 전환 메커니즘

Classic Queue는 메시지를 메모리와 디스크 사이에서 동적으로 이동시킨다. 내부 상태는 다음 네 가지이다:

```
Classic Queue 메시지 상태 전이:

  alpha ──────────► beta ──────────► delta ──────────► gamma
  (메모리+디스크)   (디스크, 인덱스   (디스크에만      (메모리+디스크,
                    는 메모리)       존재)            소비 직전)

상태 설명:
┌────────┬───────────────────────────────────────────────────────┐
│ alpha  │ 메시지 내용과 인덱스가 모두 메모리에 있다.              │
│        │ persistent 메시지는 디스크에도 기록된다.               │
├────────┼───────────────────────────────────────────────────────┤
│ beta   │ 메시지 내용은 디스크에 있고, 인덱스만 메모리에 있다.    │
│        │ 메모리 압력이 증가하면 alpha에서 전환된다.             │
├────────┼───────────────────────────────────────────────────────┤
│ delta  │ 메시지 내용과 인덱스 모두 디스크에만 있다.             │
│        │ 메모리 압력이 극심할 때 beta에서 전환된다.             │
├────────┼───────────────────────────────────────────────────────┤
│ gamma  │ 메시지 내용은 디스크에 있고, 인덱스가 메모리로          │
│        │ 복원된 상태이다. 소비를 준비하는 단계이다.              │
└────────┴───────────────────────────────────────────────────────┘
```

#### Lazy Queue 모드

Lazy Queue는 메시지를 가능한 한 빨리 디스크로 내려보내는 모드이다. Classic Queue의 기본 모드(default)와 비교하면 다음과 같다:

| 특성 | Default 모드 | Lazy 모드 |
|------|-------------|-----------|
| 메시지 저장 위치 | 메모리 우선, 압력 시 디스크 | 디스크 우선 |
| 메모리 사용량 | 높음 (큐 깊이에 비례) | 낮음 (일정) |
| 소비 지연(latency) | 낮음 | 약간 높음 (디스크 읽기 필요) |
| 처리량(throughput) | 높음 | 약간 낮음 |
| 적합한 시나리오 | 짧은 큐, 실시간 처리 | 긴 큐, 대량 적체 가능성 |

```ini
# rabbitmq.conf에서 기본 큐 모드를 lazy로 설정
queue_default_type = classic

# Policy로 특정 큐에 lazy 모드 적용
rabbitmqctl set_policy lazy-queues "^lazy\." '{"queue-mode":"lazy"}' --apply-to queues
```

> **참고**: RabbitMQ 3.12부터 Classic Queue v2가 도입되어 메모리 관리가 크게 개선되었다. v2에서는 기본적으로 lazy와 유사한 동작을 하므로, 별도의 lazy 설정이 불필요한 경우가 많다.

### Quorum Queue 심화

#### Raft 합의 프로토콜 상세

Quorum Queue는 Raft 합의 프로토콜을 사용하여 여러 노드에 메시지를 복제한다. Raft의 핵심 개념은 다음과 같다:

```
Raft 노드 상태:

  ┌───────────┐     타임아웃      ┌───────────┐     과반수 투표     ┌───────────┐
  │ Follower  │ ───────────────► │ Candidate │ ──────────────────► │  Leader   │
  │           │ ◄─────────────── │           │                     │           │
  │           │   새 Leader 발견  │           │                     │           │
  └───────────┘                  └───────────┘                     └───────────┘
       ▲                              │                                  │
       │                              │ 투표 실패                         │
       │                              │ (split vote)                     │
       │                              ▼                                  │
       │                         랜덤 타임아웃 후                         │
       │                         재선거 시도                              │
       │                                                                 │
       └─────────────────── Leader 장애 감지 ────────────────────────────┘
```

**Leader**: 모든 쓰기(publish) 요청을 처리한다. 클라이언트의 메시지를 받아 로그에 기록하고, Follower들에게 복제를 요청한다. 과반수 확인(ack)을 받으면 커밋(commit)한다.

**Follower**: Leader의 로그 복제 요청을 수신하고 자신의 로그에 기록한다. Leader로부터 heartbeat를 주기적으로 수신하며, heartbeat가 일정 시간 도착하지 않으면 Leader 장애로 판단하고 선거를 시작한다.

**Candidate**: Leader 선거에 참여하는 상태이다. 자신에게 투표하고 다른 노드들에게 투표를 요청한다. 과반수의 투표를 받으면 Leader가 된다.

#### 로그 복제 과정

```
메시지 발행 시 Raft 로그 복제:

  Client    Leader(Node1)    Follower(Node2)    Follower(Node3)
    │            │                 │                  │
    │──publish──►│                 │                  │
    │            │                 │                  │
    │            │──AppendEntries─►│                  │
    │            │──AppendEntries────────────────────►│
    │            │                 │                  │
    │            │◄──Success──────│                  │
    │            │◄──Success────────────────────────│
    │            │                 │                  │
    │            │  (과반수 확인: 2/3 성공)            │
    │            │  → 커밋 (메시지 확정)              │
    │            │                 │                  │
    │◄──confirm──│                 │                  │
    │            │──Commit────────►│                  │
    │            │──Commit──────────────────────────►│
```

#### Leader Election 과정

Leader가 장애를 일으키면 다음과 같은 선거 과정이 진행된다:

1. Follower가 heartbeat 타임아웃을 감지한다 (기본 5-10초)
2. 해당 Follower가 Candidate 상태로 전환하고, 현재 term 번호를 1 증가시킨다
3. 자신에게 투표하고, 다른 모든 노드에 RequestVote RPC를 전송한다
4. 각 노드는 해당 term에서 아직 투표하지 않았고, Candidate의 로그가 자신의 로그보다 최신이면 투표한다
5. 과반수 투표를 받은 Candidate가 새 Leader가 된다
6. 새 Leader가 AppendEntries heartbeat을 전송하여 자신의 리더십을 선언한다

#### Quorum Queue 성능 특성

| 항목 | Classic Queue | Quorum Queue |
|------|--------------|--------------|
| 쓰기 지연 | 낮음 (단일 노드) | 보통 (과반수 복제 대기) |
| 읽기 지연 | 낮음 | 낮음 (Leader에서 직접 읽기) |
| 처리량 | 높음 | Classic 대비 70-80% |
| 데이터 안전성 | 단일 노드 장애 시 유실 가능 | 과반수 생존 시 무손실 |
| 메모리 사용 | 가변 | 높음 (Raft 로그 유지) |
| 최대 복제 팩터 | N/A | 클러스터 노드 수 |
| 권장 복제 팩터 | N/A | 3 또는 5 |

#### Quorum Queue 제한사항

Quorum Queue는 Classic Queue의 일부 기능을 지원하지 않는다:

- Non-durable 큐 선언 불가 (`durable: true` 필수)
- Exclusive 큐 불가
- `x-max-priority` (Priority Queue) 미지원
- `x-queue-mode: lazy` 불필요 (기본적으로 디스크 기반)
- Global QoS (`basic.qos` with `global=true`) 미지원
- Queue TTL(`x-expires`)은 지원하지만, 일부 고급 정책과의 조합이 제한적이다

### Stream Queue 심화

#### 세그먼트 기반 저장 구조

Stream은 메시지를 append-only 로그 파일(세그먼트)에 저장한다. 각 세그먼트는 고정 크기이며, 가득 차면 새 세그먼트가 생성된다.

```
Stream 세그먼트 구조:

  Segment 1          Segment 2          Segment 3 (active)
  ┌──────────┐       ┌──────────┐       ┌──────────┐
  │ offset 0 │       │offset 100│       │offset 200│
  │ offset 1 │       │offset 101│       │offset 201│
  │  ...      │       │  ...      │       │offset 202│
  │ offset 99│       │offset 199│       │  (쓰기중) │
  └──────────┘       └──────────┘       └──────────┘
  (read-only)        (read-only)        (read-write)

  │◄── retention 정책에 의해 ──►│
  │    오래된 세그먼트 삭제      │
```

세그먼트 관련 설정은 다음과 같다:

| 설정 | 기본값 | 설명 |
|------|--------|------|
| `x-max-segment-size-bytes` | 500MB | 세그먼트 파일의 최대 크기이다 |
| `x-max-age` | 없음 | 메시지 보관 기간이다 (예: `7D`, `24h`) |
| `x-stream-max-segment-size-bytes` | 500MB | Policy로 설정하는 세그먼트 크기이다 |
| `x-max-length-bytes` | 없음 | 전체 스트림의 최대 크기이다 |

#### Offset 기반 소비

Stream Consumer는 offset을 지정하여 원하는 위치부터 메시지를 읽을 수 있다. 이것이 일반 큐와의 가장 큰 차이이다.

```javascript
// Stream 소비: offset 지정
channel.consume('event-log', (msg) => {
  const offset = msg.properties.headers['x-stream-offset'];
  console.log(`offset=${offset}: ${msg.content.toString()}`);
  channel.ack(msg);
}, {
  arguments: {
    'x-stream-offset': 'first'   // 처음부터 읽기
    // 'x-stream-offset': 'last'    // 마지막(최신)부터 읽기
    // 'x-stream-offset': 'next'    // 다음 새 메시지부터 (기본값)
    // 'x-stream-offset': 500       // offset 500부터 읽기
    // 'x-stream-offset': new Date('2024-01-01')  // 타임스탬프 기반
  }
});
```

#### Kafka와의 비교

| 항목 | RabbitMQ Stream | Apache Kafka |
|------|----------------|--------------|
| 프로토콜 | AMQP 0-9-1 + Stream Protocol | Kafka 자체 프로토콜 |
| Consumer Group | Single Active Consumer로 구현 | 네이티브 지원 |
| Offset 관리 | 클라이언트 또는 서버 측 추적 | Consumer Group 기반 자동 관리 |
| 파티셔닝 | Super Stream (논리적 파티셔닝) | 네이티브 파티션 |
| 복제 | Raft 기반 | ISR(In-Sync Replicas) 기반 |
| 처리량 | 수만~수십만 msg/s | 수십만~수백만 msg/s |
| 메시지 라우팅 | Exchange 기반 유연한 라우팅 | 토픽 기반 단순 라우팅 |
| 적합한 시나리오 | 기존 RabbitMQ에 스트림 기능 추가 | 대규모 이벤트 스트리밍 전용 |

#### Consumer 재시작 시 Offset 관리

Stream Consumer가 재시작할 때 마지막 처리 위치부터 이어서 소비하려면 offset을 추적해야 한다. 방법은 다음과 같다:

1. **서버 측 추적(Server-side offset tracking)**: RabbitMQ Stream Protocol을 사용하면 `store_offset`/`query_offset` API로 서버에 offset을 저장할 수 있다. AMQP 프로토콜에서는 지원하지 않는다
2. **클라이언트 측 추적**: 외부 저장소(Redis, DB 등)에 마지막 처리 offset을 기록하고, 재시작 시 해당 offset부터 소비한다
3. **타임스탬프 기반**: 정확한 offset 대신 마지막 처리 시각을 기록하고, 해당 시각 이후의 메시지부터 소비한다

### Priority Queue 심화

Priority Queue는 메시지의 `priority` 속성에 따라 높은 우선순위의 메시지를 먼저 소비자에게 전달한다.

```javascript
// Priority Queue 선언
await channel.assertQueue('priority-tasks', {
  durable: true,
  arguments: {
    'x-max-priority': 10  // 우선순위 레벨 수 (1-255, 권장: 1-10)
  }
});

// 우선순위별 메시지 발행
channel.publish('', 'priority-tasks', Buffer.from('긴급 주문'), { priority: 9 });
channel.publish('', 'priority-tasks', Buffer.from('일반 주문'), { priority: 1 });
channel.publish('', 'priority-tasks', Buffer.from('VIP 주문'), { priority: 5 });

// 소비 순서: 긴급 주문(9) → VIP 주문(5) → 일반 주문(1)
```

Priority Queue의 내부 구현과 주의사항은 다음과 같다:

- 내부적으로 우선순위 레벨 수만큼의 서브 큐를 생성한다. `x-max-priority=10`이면 10개의 서브 큐가 존재한다
- 우선순위 레벨이 높을수록 메모리와 CPU 오버헤드가 증가한다. 최대 255이지만, 실무에서는 1-10 범위를 권장한다
- 메시지에 `priority`가 없으면 0으로 간주한다
- `x-max-priority`보다 높은 priority 값을 가진 메시지는 최대값으로 취급된다
- Quorum Queue에서는 Priority Queue를 지원하지 않는다. Classic Queue에서만 사용 가능하다
- Consumer의 prefetch가 높으면 우선순위 효과가 감소한다. 낮은 prefetch(예: 1)로 설정해야 우선순위가 정확히 반영된다

### 큐별 메모리/디스크 사용 패턴

| 큐 타입 | 메모리 사용 | 디스크 사용 | 특성 |
|---------|------------|------------|------|
| Classic (default) | 높음 (메시지 캐싱) | persistent 메시지만 | 빠른 소비, 메모리 압력에 취약 |
| Classic (lazy) | 낮음 (인덱스만) | 모든 메시지 | 안정적 메모리, 소비 지연 |
| Quorum | 보통 (Raft 로그) | 모든 메시지 (복제) | 안전성 높음, 디스크 사용량 N배 |
| Stream | 낮음 (인덱스만) | 모든 메시지 (세그먼트) | 대용량 보관, retention 기반 정리 |

---

