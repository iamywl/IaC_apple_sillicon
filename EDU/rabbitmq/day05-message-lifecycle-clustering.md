# Day 5: 메시지 라이프사이클 및 클러스터링

> 메시지의 발행부터 소비까지의 상세 과정(DLX, TTL, Priority, Lazy Queue), 클러스터 구성(Raft 합의, 노드 타입), 노드 관리를 학습한다.

---

## 메시지 라이프사이클 심화

### Publisher 측 심화

#### mandatory 플래그

`mandatory=true`로 메시지를 발행하면, 해당 메시지가 어떤 큐에도 라우팅되지 않을 때 브로커가 `Basic.Return`으로 메시지를 Publisher에게 반송한다.

```javascript
// mandatory 플래그 사용
const channel = await connection.createChannel();

// 반송 이벤트 핸들러
channel.on('return', (msg) => {
  console.error(`메시지 반송됨: exchange=${msg.fields.exchange}, ` +
    `routing_key=${msg.fields.routingKey}, ` +
    `reply_code=${msg.fields.replyCode}, ` +
    `reply_text=${msg.fields.replyText}`);
  // 반송된 메시지 재처리 로직
});

// mandatory=true로 발행
channel.publish('orders', 'unknown.key', Buffer.from('...'), {
  mandatory: true   // 라우팅 실패 시 반송 요청
});
```

#### immediate 플래그 (Deprecated)

`immediate` 플래그는 AMQP 0-9-1 사양에 정의되어 있으나, RabbitMQ 3.0부터 deprecated되어 사용 시 채널이 닫힌다. 이 플래그는 매칭되는 큐에 소비자가 없으면 메시지를 반송하도록 하는 것이었다. 대안으로는 TTL과 DLX 조합을 사용한다.

#### Publisher Confirms 심화: sync vs async

Publisher Confirms는 동기(synchronous)와 비동기(asynchronous) 두 가지 방식으로 사용할 수 있다:

```javascript
// 방법 1: 동기 확인 (waitForConfirms)
// 장점: 구현 단순. 단점: 처리량 제한 (매 메시지마다 대기)
const channel = await connection.createConfirmChannel();
channel.publish('orders', 'new', Buffer.from(JSON.stringify(order)), { persistent: true });
await channel.waitForConfirms();  // 브로커 확인까지 대기
console.log('메시지 확인 완료');

// 방법 2: 비동기 확인 (콜백)
// 장점: 높은 처리량. 단점: 에러 처리 복잡
channel.publish('orders', 'new', Buffer.from(JSON.stringify(order)), { persistent: true },
  (err) => {
    if (err) console.error('메시지 nack:', err);
    else console.log('메시지 ack');
  });

// 방법 3: 배치 확인 (실무 권장)
// N개씩 묶어서 한 번에 확인
const BATCH_SIZE = 100;
let publishedCount = 0;
for (const order of orders) {
  channel.publish('orders', 'new', Buffer.from(JSON.stringify(order)), { persistent: true });
  publishedCount++;
  if (publishedCount % BATCH_SIZE === 0) {
    await channel.waitForConfirms();  // 100개마다 확인
  }
}
await channel.waitForConfirms();  // 잔여 메시지 확인
```

#### Publisher Returns

Publisher Returns는 `mandatory=true`로 발행된 메시지가 라우팅되지 못했을 때 발생한다. Publisher Confirms와 함께 사용하면 메시지 유실을 완전히 방지할 수 있다.

```
Publisher Confirms + Returns 조합:

  Publisher ──(mandatory=true)──► Exchange ──► 라우팅 성공 ──► Queue
     │                              │              │
     │◄──────── Basic.Ack ──────────┤              │  (confirms)
     │                              │              │
     │                              └──► 라우팅 실패
     │◄──────── Basic.Return ───────────────────────   (returns)
     │◄──────── Basic.Ack ─────────────────────────   (이후 confirms도 전송)
```

### Broker 내부 처리

#### 라우팅 테이블 검색

메시지가 Exchange에 도달하면 다음 과정을 거친다:

1. Exchange 유형에 따라 바인딩 테이블을 검색한다
2. 매칭되는 모든 큐 목록을 산출한다
3. 메시지를 각 큐에 복사한다 (동일 메시지의 참조 카운팅이 아닌 실제 복사)
4. 매칭 큐가 없으면 Alternate Exchange로 전달하거나, mandatory 처리를 수행한다

#### 큐 인큐 과정

큐에 메시지가 도달하면:

1. 메시지 인덱스에 엔트리를 추가한다 (메시지 위치, 크기, 속성 요약)
2. `delivery-mode=2`(persistent)이면 디스크에 기록한다
3. Ready 상태의 Consumer가 있으면 즉시 `Basic.Deliver`로 전달한다
4. Consumer가 없거나 모든 Consumer의 prefetch가 가득 차면 큐에 대기한다

#### 영속성 fsync

persistent 메시지의 디스크 기록은 성능에 큰 영향을 미친다:

- RabbitMQ는 매 메시지마다 fsync하지 않고, 일정 간격(기본 200ms)으로 배치 fsync를 수행한다
- Publisher Confirms가 활성화된 경우, fsync 완료 후에 `Basic.Ack`를 전송한다
- 따라서 persistent 메시지 + Publisher Confirms 조합에서 확인 지연은 최소 fsync 간격만큼 발생한다
- SSD를 사용하면 fsync 지연을 크게 줄일 수 있다

### Consumer 측 심화

#### Basic.Consume vs Basic.Get

| 항목 | Basic.Consume (push) | Basic.Get (pull) |
|------|---------------------|------------------|
| 방식 | 서버가 메시지를 push | 클라이언트가 메시지를 pull |
| 처리량 | 높음 (prefetch 활용) | 낮음 (매번 요청) |
| 지연 | 낮음 (즉시 배달) | 높음 (요청-응답 왕복) |
| 사용 사례 | 일반적인 소비 패턴 | 폴링, 단발성 조회 |
| 프로덕션 권장 | 권장 | 비권장 (처리량 저하) |

```javascript
// Basic.Consume (권장): 서버가 메시지를 push
channel.consume('orders', (msg) => {
  processOrder(msg);
  channel.ack(msg);
}, { noAck: false });

// Basic.Get (비권장): 클라이언트가 메시지를 pull
const msg = await channel.get('orders', { noAck: false });
if (msg) {
  processOrder(msg);
  channel.ack(msg);
} else {
  console.log('큐가 비어 있다');
}
```

#### Prefetch (QoS) 심화

Prefetch Count는 Consumer가 동시에 처리할 수 있는 미확인 메시지 수를 제한한다. 적절한 값 설정이 성능에 큰 영향을 미친다.

```
Prefetch 동작 원리:

prefetch_count = 3인 경우:

Server                           Consumer
  │                                 │
  │──deliver(msg1)────────────────►│  unacked: 1
  │──deliver(msg2)────────────────►│  unacked: 2
  │──deliver(msg3)────────────────►│  unacked: 3 (prefetch 도달)
  │                                 │
  │  (더 이상 deliver하지 않음)       │
  │                                 │
  │◄──ack(msg1)─────────────────── │  unacked: 2
  │──deliver(msg4)────────────────►│  unacked: 3
  │                                 │
  │◄──ack(msg2)─────────────────── │  unacked: 2
  │──deliver(msg5)────────────────►│  unacked: 3
  │                                 │
```

Prefetch 최적값 산정 가이드:

| prefetch | 효과 | 적합한 상황 |
|----------|------|------------|
| 1 | 엄격한 라운드 로빈 분배 | 처리 시간이 긴 작업, 공정한 분배 필요 |
| 10-30 | 균형 잡힌 처리량과 분배 | 일반적인 웹 애플리케이션 |
| 50-100 | 높은 처리량 | 빠른 처리, 네트워크 지연이 큰 환경 |
| 250+ | 최대 처리량 | 로그 수집 등 순서 무관 대량 처리 |

#### Ack/Nack/Reject 상세

```javascript
// Basic.Ack: 메시지 처리 완료
channel.ack(msg);                     // 단일 메시지 확인
channel.ack(msg, true);               // msg.deliveryTag 이하 모든 메시지 일괄 확인 (multiple=true)

// Basic.Nack: 메시지 거부 (RabbitMQ 확장)
channel.nack(msg, false, true);       // requeue=true → 큐의 원래 위치(또는 맨 앞)에 재삽입
channel.nack(msg, false, false);      // requeue=false → DLX로 이동 (DLX 미설정 시 폐기)
channel.nack(msg, true, false);       // multiple=true → deliveryTag 이하 모든 메시지 거부

// Basic.Reject: 단일 메시지 거부 (AMQP 0-9-1 표준)
channel.reject(msg, true);            // requeue=true
channel.reject(msg, false);           // requeue=false → DLX로 이동
```

#### Redelivery와 무한 루프 방지

`requeue=true`로 nack/reject하면 메시지가 큐에 재삽입된다. 처리 코드에 버그가 있으면 동일 메시지가 무한 반복될 수 있다. 이를 방지하려면:

1. `msg.fields.redelivered` 플래그를 확인한다. `true`이면 재배달된 메시지이다
2. 커스텀 헤더(`x-retry-count`)로 재시도 횟수를 추적한다
3. 재시도 한도를 초과하면 DLX로 보낸다

### 메시지 속성 상세

AMQP 0-9-1 메시지의 모든 속성(properties)을 정리하면 다음과 같다:

| 속성 | 타입 | 설명 | 예시 |
|------|------|------|------|
| `content_type` | shortstr | MIME 타입 | `application/json` |
| `content_encoding` | shortstr | 콘텐츠 인코딩 | `utf-8`, `gzip` |
| `headers` | table | 사용자 정의 헤더 | `{ "x-retry-count": 3 }` |
| `delivery_mode` | octet | 1=transient, 2=persistent | `2` |
| `priority` | octet | 우선순위 (0-9) | `5` |
| `correlation_id` | shortstr | RPC 요청-응답 매칭용 | `"req-abc-123"` |
| `reply_to` | shortstr | RPC 응답 큐 이름 | `"amq.gen-Xa2..."` |
| `expiration` | shortstr | Per-Message TTL (밀리초, 문자열) | `"60000"` |
| `message_id` | shortstr | 메시지 고유 ID | `"msg-2024-001"` |
| `timestamp` | timestamp | 생성 시각 (Unix epoch) | `1704067200` |
| `type` | shortstr | 메시지 유형 (애플리케이션 정의) | `"order.created"` |
| `user_id` | shortstr | 발행 사용자 (브로커가 검증) | `"guest"` |
| `app_id` | shortstr | 발행 애플리케이션 ID | `"order-service"` |

`user_id` 속성은 특별한 의미가 있다. 이 속성이 설정되면, RabbitMQ는 해당 값이 연결에 사용된 사용자 이름과 일치하는지 검증한다. 불일치하면 채널이 닫힌다 (단, `impersonator` 태그가 있는 사용자는 예외).

### 메시지 TTL 심화

#### Per-Message TTL vs Per-Queue TTL

| 항목 | Per-Message TTL | Per-Queue TTL |
|------|----------------|---------------|
| 설정 위치 | 메시지 속성 `expiration` | 큐 인자 `x-message-ttl` |
| 만료 시점 | 메시지가 큐 선두에 도달했을 때 확인 | 큐 진입 시점부터 계산, 선두 도달 시 확인 |
| 혼합 사용 | 가능 (더 짧은 값이 적용) | 가능 |
| 성능 영향 | 만료 메시지가 큐 중간에 있으면 즉시 제거 불가 | 큐 선두부터 순차 확인하므로 효율적 |

```javascript
// Per-Queue TTL: 큐의 모든 메시지에 동일한 TTL 적용
await channel.assertQueue('temp-events', {
  durable: true,
  arguments: {
    'x-message-ttl': 300000  // 모든 메시지 5분 후 만료
  }
});

// Per-Message TTL: 개별 메시지에 TTL 설정
channel.publish('', 'temp-events', Buffer.from('urgent'), {
  expiration: '60000'  // 이 메시지만 1분 후 만료 (문자열이어야 한다)
});
```

#### 만료 메시지 처리 타이밍

중요한 점은 TTL이 만료되어도 메시지가 즉시 제거되지 않을 수 있다는 것이다:

- **Per-Queue TTL**: 큐의 선두(head)에서만 만료를 확인한다. 모든 메시지가 동일한 TTL이므로 FIFO 순서에 따라 선두 메시지가 항상 먼저 만료된다. 따라서 효율적으로 동작한다
- **Per-Message TTL**: 각 메시지의 TTL이 다를 수 있다. 큐 중간의 메시지가 먼저 만료되어도, 선두 메시지가 만료되기 전까지는 제거되지 않는다. 만료된 메시지가 큐의 깊이 통계에는 포함될 수 있다 (실제로 소비자에게 전달될 때 제거)

```
Per-Message TTL 문제 예시:

큐 상태: [msg1(TTL=∞)] [msg2(TTL=1s, 만료됨)] [msg3(TTL=1s, 만료됨)]

msg1이 제거되기 전까지 msg2, msg3는 큐에 남아 있다.
msg1이 ack/제거되면 msg2, msg3가 즉시 DLX로 이동하거나 폐기된다.
```

---

## 클러스터링 심화

### Erlang 분산 시스템

#### epmd (Erlang Port Mapper Daemon)

epmd는 각 호스트에서 실행되는 데몬으로, Erlang 노드의 이름과 포트를 매핑한다. 기본 포트는 4369이다.

```
epmd 동작:

  Host A (epmd: 4369)              Host B (epmd: 4369)
  ┌──────────────────┐            ┌──────────────────┐
  │ rabbit@hostA     │            │ rabbit@hostB     │
  │   port: 25672    │            │   port: 25672    │
  └──────────────────┘            └──────────────────┘

  1. rabbit@hostA가 시작 → Host A의 epmd에 등록 (이름=rabbit, 포트=25672)
  2. rabbit@hostB가 rabbit@hostA에 연결하려면:
     a. Host A의 epmd(4369)에 "rabbit" 노드의 포트 조회
     b. 응답으로 25672를 받음
     c. Host A:25672로 Erlang Distribution 연결 수립
```

방화벽 설정 시 다음 포트를 열어야 한다:
- 4369 (epmd)
- 25672 (Erlang Distribution, 기본값)
- 35672-35682 (CLI 도구용 Erlang Distribution 포트 범위)

#### Erlang Cookie

Erlang Cookie는 클러스터 노드 간 인증에 사용되는 공유 비밀(shared secret)이다.

- 모든 클러스터 노드가 동일한 Cookie 값을 가져야 한다
- Cookie 파일은 `$HOME/.erlang.cookie`에 위치한다 (권한 400)
- Docker/Kubernetes 환경에서는 환경 변수 `RABBITMQ_ERLANG_COOKIE`로 설정할 수 있다
- Cookie가 불일치하면 노드 간 연결이 거부된다

```bash
# Cookie 확인
cat /var/lib/rabbitmq/.erlang.cookie

# Kubernetes에서 Cookie를 Secret으로 관리
kubectl create secret generic rabbitmq-erlang-cookie \
  --from-literal=cookie='UNIQUE_RANDOM_STRING_HERE'
```

#### 노드 발견 (Peer Discovery)

RabbitMQ는 여러 가지 노드 발견 메커니즘을 지원한다:

| 방식 | 설명 | 적합한 환경 |
|------|------|------------|
| `rabbit_peer_discovery_classic_config` | 설정 파일에 노드 목록을 명시한다 | 정적 인프라 |
| `rabbit_peer_discovery_dns` | DNS A/AAAA 레코드로 노드를 발견한다 | Kubernetes (Headless Service) |
| `rabbit_peer_discovery_k8s` | Kubernetes API를 통해 Pod를 발견한다 | Kubernetes |
| `rabbit_peer_discovery_consul` | Consul 서비스 레지스트리를 사용한다 | Consul 기반 인프라 |
| `rabbit_peer_discovery_etcd` | etcd 키-값 저장소를 사용한다 | etcd 기반 인프라 |

```ini
# rabbitmq.conf: Kubernetes 기반 노드 발견
cluster_formation.peer_discovery_backend = rabbit_peer_discovery_k8s
cluster_formation.k8s.host = kubernetes.default.svc.cluster.local
cluster_formation.k8s.address_type = hostname
cluster_formation.k8s.service_name = rabbitmq-headless
cluster_formation.k8s.hostname_suffix = .rabbitmq-headless.default.svc.cluster.local
```

### 메타데이터 복제: Mnesia

RabbitMQ 클러스터의 메타데이터는 Mnesia(Erlang 내장 분산 데이터베이스)에 저장되며, 모든 노드에 자동 복제된다.

Mnesia에 저장되는 데이터는 다음과 같다:

| 데이터 | 설명 | 복제 방식 |
|--------|------|-----------|
| Exchange 정의 | 이름, 유형, durable, auto-delete, arguments | 모든 노드에 복제 |
| Queue 메타데이터 | 이름, durable, auto-delete, arguments, 위치(owner 노드) | 모든 노드에 복제 |
| Binding | Exchange-Queue 바인딩 규칙 | 모든 노드에 복제 |
| Virtual Host | vhost 이름, 기본 정책 | 모든 노드에 복제 |
| User | 사용자 이름, 비밀번호 해시, 태그 | 모든 노드에 복제 |
| Permission | vhost별 사용자 권한 (configure/write/read) | 모든 노드에 복제 |
| Policy | 큐/Exchange에 적용되는 정책 | 모든 노드에 복제 |
| Runtime Parameter | 동적 설정 (Shovel, Federation 등) | 모든 노드에 복제 |

> **참고**: RabbitMQ 3.13부터 Mnesia를 대체하는 Khepri(Raft 기반 메타데이터 저장소)가 도입되었다. Khepri는 Raft 합의 프로토콜을 사용하여 네트워크 파티션에 더 강건하게 대응한다. 아직 실험적 기능이지만, 장기적으로 Mnesia를 대체할 예정이다.

### Network Partition 처리 전략 심화

네트워크 파티션(split-brain)이 발생하면 클러스터가 둘 이상의 그룹으로 분리된다. 각 그룹은 독립적으로 동작하며, 데이터 불일치가 발생할 수 있다.

#### ignore 전략

```
파티션 발생 시 (ignore):

  Partition A                    Partition B
  ┌─────────┬─────────┐        ┌─────────┐
  │ Node 1  │ Node 2  │   ╳    │ Node 3  │
  │         │         │        │         │
  │ 독립 동작│ 독립 동작│        │ 독립 동작│
  └─────────┴─────────┘        └─────────┘

  - 양쪽 모두 읽기/쓰기가 가능하다
  - 동일 큐에 양쪽에서 메시지가 적재되면 복구 시 데이터 충돌이 발생한다
  - 수동으로 파티션을 복구해야 한다
  - 프로덕션에서 사용하지 말 것
```

동작과 trade-off:
- 모든 노드가 계속 동작하므로 가용성은 최대이다
- 데이터 일관성이 보장되지 않는다
- 파티션 복구 후 수동 개입이 필요하며, 데이터 손실이 발생할 수 있다
- 개발/테스트 환경에서만 사용을 고려한다

#### pause_minority 전략

```
파티션 발생 시 (pause_minority):

  Partition A (과반수)           Partition B (소수)
  ┌─────────┬─────────┐        ┌─────────┐
  │ Node 1  │ Node 2  │   ╳    │ Node 3  │
  │(active) │(active) │        │(paused) │
  │         │         │        │         │
  └─────────┴─────────┘        └─────────┘

  - 소수파(Node 3)는 자동으로 일시 정지된다
  - 과반수(Node 1, 2)만 서비스를 계속한다
  - 파티션 복구 시 소수파가 자동으로 재시작되고 동기화된다
```

동작과 trade-off:
- 데이터 일관성을 보장한다 (split-brain 불가)
- 소수파 노드에 연결된 클라이언트는 서비스 중단을 겪는다
- 2노드 클러스터에서는 양쪽 모두 소수파로 판단되어 전체 서비스가 중단될 수 있다. 따라서 최소 3노드 클러스터를 권장한다
- 프로덕션 환경에서 가장 안전한 전략이다

#### autoheal 전략

```
파티션 발생 시 (autoheal):

  Partition A                    Partition B
  ┌─────────┬─────────┐        ┌─────────┐
  │ Node 1  │ Node 2  │   ╳    │ Node 3  │
  │(active) │(active) │        │(active) │
  └─────────┴─────────┘        └─────────┘

  파티션 복구 시:
  1. 클라이언트 연결이 더 많은 파티션을 승자로 선정
  2. 패자 파티션의 노드를 재시작
  3. 재시작된 노드가 승자의 데이터로 동기화

  주의: 패자 파티션에서 파티션 동안 적재된 메시지는 유실된다
```

동작과 trade-off:
- 파티션 동안 모든 노드가 계속 동작한다 (가용성 최대)
- 복구 시 자동으로 처리되므로 수동 개입이 불필요하다
- 패자 파티션의 데이터가 유실될 수 있다
- 데이터 유실보다 가용성이 중요한 경우에 사용한다

### 클러스터 노드 타입

| 노드 타입 | 설명 | 용도 |
|-----------|------|------|
| Disc Node | Mnesia 데이터를 디스크와 메모리에 모두 저장한다 | 기본 타입. 메타데이터 영속성 보장 |
| RAM Node | Mnesia 데이터를 메모리에만 저장한다 (일부 예외) | 메타데이터 변경이 빈번한 환경에서 성능 향상 |

RAM Node의 주의사항:
- 클러스터에 최소 1개의 Disc Node가 반드시 필요하다
- RAM Node가 재시작되면 Disc Node에서 메타데이터를 동기화한다
- 큐 메시지는 노드 타입과 무관하게 큐 설정(durable, persistent)에 따라 저장된다
- 현대 RabbitMQ에서는 RAM Node의 성능 이점이 미미하여 거의 사용하지 않는다. 모든 노드를 Disc Node로 설정하는 것이 권장된다

### 클러스터 확장/축소 절차

#### 노드 추가 (Scale-Out)

```bash
# 1. 새 노드(rabbit@node4)에서 RabbitMQ 시작
rabbitmq-server -detached

# 2. 기존 클러스터에 합류
rabbitmqctl stop_app
rabbitmqctl join_cluster rabbit@node1
rabbitmqctl start_app

# 3. 클러스터 상태 확인
rabbitmqctl cluster_status
```

#### 노드 제거 (Scale-In)

```bash
# 방법 1: 제거할 노드에서 직접 실행
rabbitmqctl stop_app
rabbitmqctl reset       # 클러스터에서 탈퇴하고 데이터 초기화
rabbitmqctl start_app   # 독립 노드로 시작

# 방법 2: 다른 노드에서 원격으로 제거 (제거할 노드가 다운된 경우)
rabbitmqctl forget_cluster_node rabbit@node4
```

#### Quorum Queue 재조정

노드를 추가/제거한 후 Quorum Queue의 멤버를 재조정할 수 있다:

```bash
# Quorum Queue 멤버 확인
rabbitmq-queues quorum_status <queue-name>

# 새 노드를 Quorum Queue 멤버로 추가
rabbitmq-queues add_member <queue-name> rabbit@node4

# 기존 멤버 제거
rabbitmq-queues delete_member <queue-name> rabbit@node2

# 모든 Quorum Queue를 재조정 (자동)
rabbitmq-queues rebalance quorum
```

### Rolling Upgrade 전략

RabbitMQ 클러스터의 무중단 업그레이드 절차는 다음과 같다:

```
Rolling Upgrade 순서 (3노드 클러스터):

  단계 1: Node 3 정지 → 업그레이드 → 시작
  ┌─────────┬─────────┬─────────┐
  │ Node 1  │ Node 2  │ Node 3  │
  │ (old)   │ (old)   │ (stop)  │
  │ active  │ active  │ upgrade │
  └─────────┴─────────┴─────────┘

  단계 2: Node 2 정지 → 업그레이드 → 시작
  ┌─────────┬─────────┬─────────┐
  │ Node 1  │ Node 2  │ Node 3  │
  │ (old)   │ (stop)  │ (new)   │
  │ active  │ upgrade │ active  │
  └─────────┴─────────┴─────────┘

  단계 3: Node 1 정지 → 업그레이드 → 시작
  ┌─────────┬─────────┬─────────┐
  │ Node 1  │ Node 2  │ Node 3  │
  │ (stop)  │ (new)   │ (new)   │
  │ upgrade │ active  │ active  │
  └─────────┴─────────┴─────────┘

  완료: 모든 노드가 새 버전
```

Rolling Upgrade 시 주의사항:
- 항상 릴리스 노트에서 버전 호환성을 확인한다 (동일 클러스터 내 혼합 버전 지원 범위)
- Erlang/OTP 버전 호환성도 함께 확인한다
- 업그레이드 전 `rabbitmqctl export_definitions`로 정의를 백업한다
- Quorum Queue의 Leader가 있는 노드를 마지막에 업그레이드하면 Leader 전환 횟수를 줄일 수 있다

---

