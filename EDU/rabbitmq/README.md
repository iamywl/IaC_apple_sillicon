# RabbitMQ - 메시지 큐 브로커

## 개념

### RabbitMQ란?
- Pivotal Software가 개발한 오픈소스 메시지 브로커이다
- AMQP(Advanced Message Queuing Protocol) 0-9-1 프로토콜을 기본으로 구현하며, STOMP, MQTT, AMQP 1.0도 플러그인으로 지원한다
- Erlang/OTP 런타임 위에서 동작하며, Erlang의 경량 프로세스 모델과 분산 처리 능력을 활용한다
- 생산자(Producer)와 소비자(Consumer) 사이에서 메시지를 중계하여 비동기 통신과 시스템 디커플링을 가능하게 한다
- 이 프로젝트에서는 `rabbitmq:3-management-alpine` 이미지를 사용한다

### 아키텍처

#### Erlang/OTP 런타임
- RabbitMQ는 Erlang VM(BEAM) 위에서 실행된다. Erlang은 통신 장비용으로 설계된 언어로, 고가용성과 분산 처리에 특화되어 있다
- Erlang의 경량 프로세스(lightweight process)는 OS 쓰레드가 아니라 VM 내부에서 스케줄링되며, 수십만 개의 프로세스를 동시에 운용할 수 있다
- OTP(Open Telecom Platform)는 supervisor tree를 통해 프로세스 장애를 자동 복구하는 프레임워크이다. RabbitMQ의 각 큐, 연결, 채널이 독립된 Erlang 프로세스로 동작하므로, 하나의 큐가 장애를 일으켜도 다른 큐에 영향을 주지 않는다
- 노드 간 통신은 Erlang Distribution Protocol을 사용하며, 기본 포트는 25672이다

#### 노드 구조
```
┌─────────────────── RabbitMQ Node ───────────────────┐
│  Erlang VM (BEAM)                                    │
│  ┌─────────────────────────────────────────────────┐ │
│  │  Mnesia DB (메타데이터: Exchange, Queue, Binding) │ │
│  └─────────────────────────────────────────────────┘ │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐           │
│  │Connection│  │Connection│  │Connection│  ...       │
│  │  ┌─────┐ │  │  ┌─────┐ │  │  ┌─────┐ │           │
│  │  │Chan1│ │  │  │Chan1│ │  │  │Chan1│ │           │
│  │  │Chan2│ │  │  │Chan2│ │  │  │Chan2│ │           │
│  │  └─────┘ │  │  └─────┘ │  │  └─────┘ │           │
│  └──────────┘  └──────────┘  └──────────┘           │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐       │
│  │Queue A │ │Queue B │ │Queue C │ │Queue D │  ...   │
│  └────────┘ └────────┘ └────────┘ └────────┘       │
│  Port 5672 (AMQP) | 15672 (Management) | 25672 (Clustering) │
└──────────────────────────────────────────────────────┘
```

#### Connection과 Channel
- 클라이언트는 RabbitMQ 노드에 TCP 연결(Connection)을 맺는다. TCP 연결은 비용이 크므로, 하나의 Connection 위에 여러 개의 Channel을 멀티플렉싱(multiplexing)하여 사용한다
- Channel은 AMQP 명령을 주고받는 가상의 논리적 연결이다. 각 Channel은 독립적으로 동작하며, 하나의 애플리케이션에서 여러 쓰레드가 각자의 Channel을 가질 수 있다
- 연결 하나당 수백 개의 Channel을 생성할 수 있지만, Channel 수가 과도하면 메모리 사용량이 증가한다. 일반적으로 쓰레드당 1개의 Channel을 권장한다

```
┌─────────────────────────────────────────┐
│          TCP Connection                  │
│  ┌────────┐ ┌────────┐ ┌────────┐       │
│  │Channel1│ │Channel2│ │Channel3│  ...  │
│  │(publish│ │(consume│ │(consume│       │
│  │ 전용)  │ │ 큐 A)  │ │ 큐 B)  │       │
│  └────────┘ └────────┘ └────────┘       │
└─────────────────────────────────────────┘
```

#### Virtual Host (vhost)
- vhost는 RabbitMQ 내부에서 논리적으로 격리된 환경이다. 하나의 RabbitMQ 인스턴스에서 여러 애플리케이션 또는 팀이 독립적으로 사용할 수 있도록 멀티테넌시를 제공한다
- 각 vhost는 자체적인 Exchange, Queue, Binding, 사용자 권한을 가진다. 서로 다른 vhost의 리소스는 완전히 격리된다
- 기본 vhost는 `/`이며, `rabbitmqctl add_vhost <name>` 명령으로 추가할 수 있다

### 핵심 개념

| 개념 | 설명 |
|------|------|
| Producer | 메시지를 보내는 주체이다 |
| Consumer | 메시지를 받아 처리하는 주체이다 |
| Queue | 메시지가 저장되는 FIFO 버퍼이다 |
| Exchange | 메시지를 라우팅하는 규칙을 정의한다 |
| Binding | Exchange와 Queue를 연결하는 규칙이다 |
| Routing Key | 메시지를 어떤 Queue로 보낼지 결정하는 키이다 |
| Acknowledgment | 소비자가 메시지 처리 완료를 알리는 확인 응답이다 |
| Dead Letter Exchange | 처리 실패한 메시지가 라우팅되는 Exchange이다 |
| Virtual Host | 논리적으로 격리된 브로커 환경이다 |
| Channel | 하나의 TCP 연결 위에 멀티플렉싱되는 가상 연결이다 |

### AMQP 0-9-1 프로토콜

AMQP(Advanced Message Queuing Protocol) 0-9-1은 RabbitMQ의 핵심 프로토콜이다.

#### 프로토콜 모델
```
Connection (TCP 연결)
 └── Channel (논리적 연결, 다수 생성 가능)
      ├── Exchange (메시지 라우팅 엔진)
      │    └── Binding (라우팅 규칙)
      │         └── Queue (메시지 저장소)
      └── Basic (publish, consume, ack, nack, reject)
```

#### AMQP 프레임 유형
| 프레임 | 설명 |
|--------|------|
| Method Frame | AMQP 명령을 전달한다 (queue.declare, basic.publish 등) |
| Content Header Frame | 메시지의 속성(properties)을 전달한다 (content-type, delivery-mode, headers 등) |
| Body Frame | 메시지의 실제 페이로드를 전달한다. 큰 메시지는 여러 Body Frame으로 분할된다 |
| Heartbeat Frame | 연결이 살아 있는지 주기적으로 확인한다. 기본 간격은 60초이다 |

#### 연결 수립 과정
```
Client                          RabbitMQ
  │                                │
  │──── Protocol Header ──────────►│  AMQP 0-9-1 선언
  │◄─── Connection.Start ─────────│  서버 기능 안내
  │──── Connection.Start-Ok ──────►│  인증 정보 전송 (SASL)
  │◄─── Connection.Tune ──────────│  프레임 크기, 채널 수 협상
  │──── Connection.Tune-Ok ───────►│  협상 결과 확인
  │──── Connection.Open ──────────►│  vhost 지정
  │◄─── Connection.Open-Ok ───────│  연결 수립 완료
  │                                │
  │──── Channel.Open ─────────────►│  채널 생성
  │◄─── Channel.Open-Ok ──────────│  채널 사용 가능
  │                                │
```

### Exchange 유형

#### 1. Default Exchange (기본 Exchange)
- 이름이 빈 문자열(`""`)인 Direct Exchange이다
- 모든 큐가 자동으로 큐 이름과 동일한 routing key로 바인딩된다
- 명시적인 Exchange 선언이나 Binding 없이 큐 이름을 routing key로 사용하여 직접 메시지를 보낼 수 있다
```
Producer → Exchange("") → [routing_key="my-queue"] → Queue: my-queue (자동 바인딩)
```

#### 2. Direct Exchange
- routing key가 정확히 일치(exact match)하는 큐에만 메시지를 전달한다
- 하나의 Exchange에 여러 큐가 동일한 routing key로 바인딩되면, 모든 해당 큐에 메시지가 복사된다
```
Producer → Exchange ──► [routing_key="order"]  → Queue: orders
                   ──► [routing_key="email"]  → Queue: emails
                   ──► [routing_key="order"]  → Queue: order-audit (동일 키, 복수 큐)
```

#### 3. Fanout Exchange
- routing key를 완전히 무시하고, 바인딩된 모든 큐에 메시지를 브로드캐스트한다
- 로그 수집, 이벤트 알림 등 모든 소비자가 동일한 메시지를 받아야 할 때 사용한다
```
Producer → Exchange ──► Queue: A  (모든 큐에 복사)
                   ──► Queue: B
                   ──► Queue: C
```

#### 4. Topic Exchange
- routing key에 대해 패턴 매칭을 수행한다
- `*`(star)는 정확히 하나의 단어를 매칭한다
- `#`(hash)는 0개 이상의 단어를 매칭한다
- 단어는 `.`(dot)으로 구분한다
```
Producer → Exchange ──► [order.*]       → Queue: order-all
                        (order.new, order.cancel 매칭)
                   ──► [order.new]     → Queue: order-new
                        (정확히 order.new만 매칭)
                   ──► [*.critical]    → Queue: critical
                        (order.critical, payment.critical 매칭)
                   ──► [order.#]       → Queue: order-deep
                        (order, order.new, order.new.priority 등 모두 매칭)
```

#### 5. Headers Exchange
- routing key 대신 메시지의 headers 속성을 기반으로 라우팅한다
- `x-match` 헤더로 매칭 방식을 지정한다:
  - `all`: 모든 헤더가 일치해야 한다 (AND 조건)
  - `any`: 하나 이상 일치하면 된다 (OR 조건)
- routing key 기반보다 유연하지만, 성능은 약간 낮다
```
Producer → Exchange ──► [headers: format=pdf, type=report, x-match=all] → Queue: pdf-reports
                   ──► [headers: format=pdf, x-match=any]              → Queue: all-pdf
```

### 메시지 라이프사이클

```
┌──────────┐  publish   ┌──────────┐  route   ┌───────┐  deliver  ┌──────────┐
│ Producer │───────────►│ Exchange │─────────►│ Queue │──────────►│ Consumer │
│          │            │          │          │       │           │          │
│          │  confirm   │          │          │       │   ack     │          │
│          │◄───────────│          │          │       │◄──────────│          │
└──────────┘            └──────────┘          └───────┘           └──────────┘
     │                       │                    │
     │                       │ 라우팅 실패         │ reject/nack
     │                       │ (mandatory=true     │ (requeue=false)
     │                       │  → basic.return)    │ TTL 만료
     │                       ▼                    │ 큐 길이 초과
     │                  ┌─────────┐               ▼
     │                  │ 반송    │          ┌──────────┐
     │                  │(Return) │          │   DLX    │
     │                  └─────────┘          │(Dead     │
     │                                       │ Letter   │
     │                                       │Exchange) │
     │                                       └──────────┘
```

#### 메시지 발행(Publish) 상세
1. Producer가 Exchange에 메시지를 발행한다. 이때 routing key와 메시지 속성(properties)을 함께 전달한다
2. Exchange는 유형(direct, fanout, topic, headers)과 binding 규칙에 따라 메시지를 하나 이상의 큐로 라우팅한다
3. 라우팅할 큐가 없는 경우:
   - `mandatory` 플래그가 `true`이면 `basic.return`으로 Producer에게 메시지를 반송한다
   - `mandatory` 플래그가 `false`(기본값)이면 메시지를 조용히 폐기한다
4. 큐에 도달한 메시지는 FIFO 순서로 저장되어 Consumer에게 배달을 대기한다

### Acknowledgment (확인 응답)

#### Consumer Acknowledgment
| 모드 | 설명 | 특성 |
|------|------|------|
| Auto Ack (`autoAck=true`) | 메시지 전달 즉시 큐에서 제거한다 | Fire-and-forget 방식이다. Consumer 장애 시 메시지가 유실될 수 있다 |
| Manual Ack (`autoAck=false`) | Consumer가 명시적으로 `basic.ack`를 보내야 제거한다 | At-least-once 보장이다. `ack` 전에 Consumer가 죽으면 메시지가 다른 Consumer에게 재전달된다 |
| Reject (`basic.reject`) | 단일 메시지를 거부한다. `requeue=true`면 재큐잉, `requeue=false`면 DLX로 이동한다 | 처리 불가능한 메시지를 명시적으로 거부할 때 사용한다 |
| Nack (`basic.nack`) | 하나 이상의 메시지를 일괄 거부한다. `multiple=true`로 다건 처리가 가능하다 | RabbitMQ 확장 기능이다. AMQP 0-9-1 표준에는 없다 |

#### Publisher Confirms
- 기본적으로 `basic.publish`는 fire-and-forget이다. 메시지가 브로커에 도달했는지 확인할 수 없다
- Publisher Confirms를 활성화하면(`channel.confirmSelect()`), 브로커가 메시지를 수신하고 큐에 저장한 후 `basic.ack`를 Publisher에게 보낸다
- 메시지가 라우팅되지 못하면 `basic.nack`를 반환한다
- 트랜잭션(`tx.commit`)보다 성능이 우수하며, 프로덕션 환경에서 권장되는 방식이다

#### Consumer Prefetch (QoS)
- `basic.qos`로 Consumer가 동시에 처리할 미확인(unacknowledged) 메시지 수를 제한한다
- `prefetchCount=1`이면 이전 메시지를 `ack`할 때까지 새 메시지를 받지 않는다
- 적절한 prefetch 값은 처리 시간과 네트워크 지연을 고려하여 설정한다. 너무 낮으면 처리량이 떨어지고, 너무 높으면 특정 Consumer에 메시지가 편중된다
- `global=true`로 설정하면 채널 전체가 아닌 해당 Connection의 모든 Consumer에 적용된다

### 메시지 영속성 (Durability)

메시지 유실을 방지하려면 세 가지 요소를 모두 영속적으로 설정해야 한다:

| 요소 | 설정 | 설명 |
|------|------|------|
| Exchange | `durable: true` | 브로커 재시작 후에도 Exchange 정의가 유지된다 |
| Queue | `durable: true` | 브로커 재시작 후에도 큐 정의가 유지된다. 단, 큐 안의 메시지는 별도로 persistent 설정이 필요하다 |
| Message | `deliveryMode: 2` (persistent) | 메시지를 디스크에 기록한다. `deliveryMode: 1`(transient)이면 메모리에만 존재한다 |

> **주의**: persistent 메시지는 디스크 I/O가 발생하므로 처리량(throughput)이 감소한다. 성능이 중요하고 메시지 유실을 허용할 수 있는 경우에는 transient 메시지를 사용할 수 있다. Lazy Queue 모드를 활성화하면 메시지를 가능한 빨리 디스크로 내보내어 메모리 사용량을 줄이되, 소비 지연이 약간 증가한다.

### Dead Letter Exchange (DLX)

메시지가 dead-letter 처리되는 조건은 다음과 같다:

1. **Consumer가 거부(reject/nack)하고 `requeue=false`인 경우**: 재큐잉하지 않겠다고 명시적으로 선언한 경우이다
2. **메시지 TTL이 만료된 경우**: `x-message-ttl` 속성으로 설정한 시간이 지난 경우이다
3. **큐 길이 제한을 초과한 경우**: `x-max-length` 또는 `x-max-length-bytes`로 설정한 한도를 넘긴 경우이다

#### DLX 설정
```javascript
// 원본 큐에 DLX 설정
await channel.assertQueue('order-processing', {
  durable: true,
  arguments: {
    'x-dead-letter-exchange': 'dlx.orders',          // DLX Exchange 이름
    'x-dead-letter-routing-key': 'dead.order',        // DLX routing key (선택)
    'x-message-ttl': 60000,                           // 메시지 TTL 60초
    'x-max-length': 10000                             // 큐 최대 길이
  }
});

// DLX Exchange와 Dead Letter Queue 선언
await channel.assertExchange('dlx.orders', 'direct', { durable: true });
await channel.assertQueue('dead-letter-orders', { durable: true });
await channel.bindQueue('dead-letter-orders', 'dlx.orders', 'dead.order');
```

#### 재시도 패턴 (DLX 활용)
```
원본 큐 → 처리 실패 (nack, requeue=false)
   → DLX → Retry 큐 (x-message-ttl=5000, x-dead-letter-exchange=원본 Exchange)
      → TTL 만료 후 원본 큐로 복귀
      → 재시도 횟수 초과 시 최종 Dead Letter 큐로 이동
```

### 큐 유형

#### Classic Queue
- RabbitMQ의 전통적인 큐 유형이다
- 단일 노드에서 동작하며, 클러스터 환경에서는 특정 노드에 위치한다
- 미러링(HA mirrored queue)으로 복제가 가능했으나, RabbitMQ 3.13부터 deprecated 되었다

#### Quorum Queue
- Raft 합의 알고리즘 기반의 복제 큐이다. RabbitMQ 3.8에서 도입되었다
- 홀수 개의 노드(보통 3 또는 5)로 구성되며, 과반수(quorum)가 살아 있으면 데이터 안전성을 보장한다
- Classic Mirrored Queue보다 데이터 안전성이 높고, 설계가 단순하다
- 메시지가 자동으로 복제되므로 별도의 미러링 정책이 필요 없다
- `x-queue-type: quorum`으로 선언한다
```javascript
await channel.assertQueue('critical-orders', {
  durable: true,  // Quorum Queue는 반드시 durable이어야 한다
  arguments: {
    'x-queue-type': 'quorum',
    'x-quorum-initial-group-size': 3   // 복제 팩터
  }
});
```

#### Stream
- RabbitMQ 3.9에서 도입된 append-only 로그 구조의 큐이다
- Apache Kafka와 유사하게 메시지를 소비해도 삭제되지 않으며, offset 기반으로 재소비가 가능하다
- 대용량 fan-out 시나리오에서 효율적이다. 여러 Consumer가 동일한 스트림을 독립적으로 읽을 수 있다
- `x-queue-type: stream`으로 선언하며, retention 정책으로 보관 기간이나 크기를 제어한다
```javascript
await channel.assertQueue('event-log', {
  durable: true,
  arguments: {
    'x-queue-type': 'stream',
    'x-max-age': '7D',                // 7일간 보관
    'x-max-segment-size-bytes': 52428800  // 세그먼트 크기 50MB
  }
});
```

### 클러스터링

#### 클러스터 기본 구조
- RabbitMQ 클러스터의 모든 노드는 Exchange, Queue 메타데이터, Binding, vhost, 사용자 정보를 Mnesia 데이터베이스를 통해 공유한다
- 큐의 메시지 데이터는 기본적으로 큐가 선언된 노드에만 존재한다. 다른 노드에서 해당 큐에 접근하면 메시지를 프록시한다
- Quorum Queue를 사용하면 메시지가 Raft 프로토콜로 여러 노드에 복제되어 고가용성을 확보한다

```
┌──────────────────── RabbitMQ Cluster ────────────────────┐
│                                                          │
│  ┌─────────┐      ┌─────────┐      ┌─────────┐          │
│  │ Node 1  │◄────►│ Node 2  │◄────►│ Node 3  │          │
│  │(disc)   │      │(disc)   │      │(ram)    │          │
│  │         │      │         │      │         │          │
│  │Queue A  │      │Queue B  │      │Queue C  │          │
│  │(leader) │      │(leader) │      │(leader) │          │
│  │Queue B  │      │Queue A  │      │Queue A  │          │
│  │(follower│      │(follower│      │(follower│          │
│  └─────────┘      └─────────┘      └─────────┘          │
│                                                          │
│  공유: Exchange, Binding, vhost, 사용자 (Mnesia DB)       │
│  Quorum Queue: Raft 합의로 메시지 복제                    │
└──────────────────────────────────────────────────────────┘
```

#### 네트워크 파티션 처리
네트워크 장애로 클러스터가 분리(split-brain)될 때의 처리 전략이다:

| 전략 | 설명 |
|------|------|
| `pause_minority` | 소수파 노드를 자동 정지한다. 데이터 무결성을 우선시하며, 가장 안전한 방식이다 |
| `autoheal` | 파티션 복구 시 승자(클라이언트 연결이 많은 쪽)를 선정하고 패자를 재시작한다. 가용성을 우선시한다 |
| `ignore` | 파티션을 무시한다. 수동 복구가 필요하며, 프로덕션에서는 권장하지 않는다 |

설정은 `rabbitmq.conf`에서 지정한다:
```ini
cluster_partition_handling = pause_minority
```

### Flow Control과 Backpressure

#### Credit-based Flow Control
- RabbitMQ는 내부적으로 credit-based flow control을 사용한다. 메시지를 처리하는 각 프로세스(Connection, Channel, Queue)가 서로에게 "크레딧"을 발행한다
- 크레딧이 소진되면 상위 프로세스(Publisher 쪽)가 일시 중지되어 자연스럽게 backpressure가 발생한다
- Management UI에서 Connection 상태가 `flow`로 표시되면 해당 Publisher가 flow control에 의해 속도가 제한되고 있는 것이다

#### Memory/Disk Alarm
| 알람 | 기본 임계값 | 동작 |
|------|------------|------|
| Memory Alarm | 사용 가능 RAM의 40% | 모든 Publisher의 연결을 차단(block)한다. Consumer는 정상 동작한다 |
| Disk Alarm | 디스크 여유 공간 50MB 미만 | 모든 Publisher의 연결을 차단한다 |

설정은 `rabbitmq.conf`에서 조정 가능하다:
```ini
vm_memory_high_watermark.relative = 0.4
disk_free_limit.absolute = 1GB
```

### Management Plugin

- `rabbitmq_management` 플러그인은 HTTP API 기반의 웹 관리 콘솔을 제공한다 (포트 15672)
- 큐, Exchange, 연결, 채널의 상태와 메시지 처리량을 실시간으로 모니터링할 수 있다
- REST API를 통해 프로그래밍 방식으로 리소스를 관리할 수 있다 (`GET /api/queues`, `PUT /api/exchanges/%2f/my-exchange` 등)
- Prometheus 메트릭 엔드포인트(`/metrics`)를 내장하며, `rabbitmq_prometheus` 플러그인을 활성화하면 Prometheus/Grafana와 통합할 수 있다

#### 주요 모니터링 지표
| 지표 | 설명 |
|------|------|
| `messages_ready` | 소비자에게 배달 대기 중인 메시지 수이다 |
| `messages_unacknowledged` | 배달되었으나 아직 ack되지 않은 메시지 수이다 |
| `message_stats.publish_details.rate` | 초당 발행 메시지 수이다 |
| `message_stats.deliver_get_details.rate` | 초당 소비 메시지 수이다 |
| `consumers` | 큐에 연결된 소비자 수이다 |

### 플러그인: Shovel과 Federation

#### Shovel
- 한 클러스터의 큐에서 메시지를 꺼내 다른 클러스터의 Exchange나 큐로 전달하는 플러그인이다
- 데이터센터 간 메시지 복제, 클러스터 마이그레이션에 사용된다
- Static Shovel은 설정 파일로 정의하고, Dynamic Shovel은 런타임에 API/UI로 생성한다
- 연결이 끊어지면 자동 재연결하며, 메시지 순서를 보장한다

#### Federation
- 지리적으로 분산된 RabbitMQ 노드/클러스터 간에 Exchange 또는 Queue를 연결하는 플러그인이다
- Federation Exchange는 upstream Exchange의 메시지를 downstream으로 전달한다. 로컬 Consumer가 있을 때만 메시지를 가져오므로 네트워크 효율이 높다
- Federation Queue는 upstream 큐의 메시지를 downstream 큐가 소비한다. 부하 분산에 적합하다
- Shovel과 달리 단방향 링크이며, 느슨한 결합(loosely coupled)을 지향한다

---

### 이 프로젝트에서의 실습 환경

이 프로젝트에서 RabbitMQ는 dev 클러스터의 `demo` 네임스페이스에 배포된다.

- 매니페스트: `manifests/demo/rabbitmq-app.yaml`
- 이미지: `rabbitmq:3-management-alpine` (Management UI 포함)
- 자격증명: 사용자 `demo`, 비밀번호 `demo123`
- AMQP 포트: 5672, Management UI 포트: 15672
- 실습 대상 클러스터: dev (`kubeconfig/dev.yaml`)

```bash
# dev 클러스터에서 RabbitMQ Management UI 접근
export KUBECONFIG=kubeconfig/dev.yaml
kubectl port-forward -n demo svc/rabbitmq 15672:15672
# 브라우저에서 http://localhost:15672 접속 (demo/demo123)
```

---

## 실습

### 실습 1: RabbitMQ 관리 UI 접속
```bash
# RabbitMQ Pod 확인
kubectl get pods -n demo -l app=rabbitmq

# Management UI 포트포워딩
kubectl port-forward -n demo svc/rabbitmq 15672:15672

# 브라우저에서 http://localhost:15672 접속
# 이 프로젝트 계정: demo / demo123

# AMQP 포트포워딩 (애플리케이션용)
kubectl port-forward -n demo svc/rabbitmq 5672:5672
```

### 실습 2: rabbitmqadmin CLI 사용
```bash
# rabbitmqadmin CLI 접속
kubectl exec -it -n demo deploy/rabbitmq -- rabbitmqadmin list queues

# 큐 생성
kubectl exec -it -n demo deploy/rabbitmq -- rabbitmqadmin declare queue name=test-queue durable=true

# 메시지 발행
kubectl exec -it -n demo deploy/rabbitmq -- rabbitmqadmin publish routing_key=test-queue payload="Hello RabbitMQ!"

# 메시지 수신
kubectl exec -it -n demo deploy/rabbitmq -- rabbitmqadmin get queue=test-queue

# Exchange 목록
kubectl exec -it -n demo deploy/rabbitmq -- rabbitmqadmin list exchanges

# Binding 목록
kubectl exec -it -n demo deploy/rabbitmq -- rabbitmqadmin list bindings
```

### 실습 3: rabbitmqctl 관리 명령어
```bash
# 클러스터 상태
kubectl exec -n demo deploy/rabbitmq -- rabbitmqctl cluster_status

# 큐 상태 (메시지 수 등)
kubectl exec -n demo deploy/rabbitmq -- rabbitmqctl list_queues name messages consumers

# 연결 목록
kubectl exec -n demo deploy/rabbitmq -- rabbitmqctl list_connections

# 채널 목록
kubectl exec -n demo deploy/rabbitmq -- rabbitmqctl list_channels

# vhost 목록
kubectl exec -n demo deploy/rabbitmq -- rabbitmqctl list_vhosts

# 사용자 목록 및 권한
kubectl exec -n demo deploy/rabbitmq -- rabbitmqctl list_users
kubectl exec -n demo deploy/rabbitmq -- rabbitmqctl list_permissions
```

### 실습 4: 메시지 흐름 관찰
```
1. Management UI > Queues 탭에서 큐별 메시지 수 확인
2. Connections 탭에서 연결된 Producer/Consumer 확인
3. Exchanges 탭에서 메시지 라우팅 현황 확인
4. Overview 탭에서 전체 메시지 처리량(Rate) 확인
5. Admin 탭에서 사용자, vhost, 정책(Policy) 관리
```

### 실습 5: Quorum Queue 생성
```bash
# Quorum Queue 선언 (Management API 사용)
kubectl exec -it -n demo deploy/rabbitmq -- rabbitmqadmin declare queue \
  name=quorum-test durable=true \
  arguments='{"x-queue-type": "quorum"}'

# 큐 유형 확인
kubectl exec -n demo deploy/rabbitmq -- rabbitmqctl list_queues name type
```

---

## 예제

### 예제 1: Kubernetes 배포 매니페스트
```yaml
# rabbitmq-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: rabbitmq
  namespace: demo
spec:
  replicas: 1
  selector:
    matchLabels:
      app: rabbitmq
  template:
    metadata:
      labels:
        app: rabbitmq
    spec:
      containers:
        - name: rabbitmq
          image: rabbitmq:3-management-alpine
          ports:
            - name: amqp
              containerPort: 5672
            - name: management
              containerPort: 15672
          env:
            - name: RABBITMQ_DEFAULT_USER
              value: "guest"
            - name: RABBITMQ_DEFAULT_PASS
              valueFrom:
                secretKeyRef:
                  name: rabbitmq-secret
                  key: password
          resources:
            limits:
              cpu: 300m
              memory: 512Mi
            requests:
              cpu: 100m
              memory: 256Mi
---
apiVersion: v1
kind: Service
metadata:
  name: rabbitmq
  namespace: demo
spec:
  selector:
    app: rabbitmq
  ports:
    - name: amqp
      port: 5672
      targetPort: 5672
    - name: management
      port: 15672
      targetPort: 15672
```

### 예제 2: Producer/Consumer with Publisher Confirms
```javascript
// Producer: Publisher Confirms를 활용한 안전한 메시지 발행
async function publishOrder(order) {
  const channel = await connection.createConfirmChannel();  // Confirm 모드

  await channel.assertExchange('orders', 'direct', { durable: true });
  await channel.assertQueue('order-processing', {
    durable: true,
    arguments: {
      'x-dead-letter-exchange': 'dlx.orders',
      'x-dead-letter-routing-key': 'dead.order'
    }
  });
  await channel.bindQueue('order-processing', 'orders', 'new-order');

  channel.publish('orders', 'new-order', Buffer.from(JSON.stringify(order)), {
    persistent: true,        // deliveryMode: 2 (디스크 저장)
    contentType: 'application/json',
    messageId: order.id,
    timestamp: Date.now()
  }, (err) => {
    if (err) {
      console.error(`메시지 발행 실패: ${order.id}`, err);
      // 재시도 로직
    } else {
      console.log(`메시지 발행 확인: ${order.id}`);
    }
  });
}

// Consumer: Manual Ack와 Prefetch를 활용한 안전한 메시지 소비
async function consumeOrders() {
  const channel = await connection.createChannel();

  await channel.assertQueue('order-processing', { durable: true });
  channel.prefetch(10);  // 동시에 10개까지 미확인 메시지 허용

  channel.consume('order-processing', async (msg) => {
    const order = JSON.parse(msg.content.toString());
    try {
      await processOrder(order);
      channel.ack(msg);              // 처리 완료 → 큐에서 제거
    } catch (error) {
      if (isRetryable(error)) {
        channel.nack(msg, false, true);  // requeue=true → 큐에 재삽입
      } else {
        channel.nack(msg, false, false); // requeue=false → DLX로 이동
      }
    }
  });
}
```

### 예제 3: 비동기 처리 패턴 비교
```
동기 방식 (직접 호출):
  API → DB 저장 → 이메일 전송 → 알림 전송 → 응답
  총 소요: 500ms (모든 작업 완료 후 응답)

비동기 방식 (RabbitMQ):
  API → DB 저장 → Queue에 이벤트 발행 → 응답 (100ms)
         ↓
  Worker A: 이메일 전송 (별도 처리)
  Worker B: 알림 전송 (별도 처리)
  → 사용자는 100ms만에 응답을 받는다
```

### 예제 4: Topic Exchange 라우팅 예시
```javascript
// Topic Exchange를 활용한 이벤트 기반 시스템
async function setupTopicRouting() {
  const channel = await connection.createChannel();

  await channel.assertExchange('events', 'topic', { durable: true });

  // 모든 주문 이벤트를 수신하는 큐
  await channel.assertQueue('order-all', { durable: true });
  await channel.bindQueue('order-all', 'events', 'order.*');

  // 모든 critical 이벤트를 수신하는 큐
  await channel.assertQueue('critical-alerts', { durable: true });
  await channel.bindQueue('critical-alerts', 'events', '*.critical');

  // 모든 이벤트를 수신하는 감사 로그 큐
  await channel.assertQueue('audit-log', { durable: true });
  await channel.bindQueue('audit-log', 'events', '#');

  // 발행 예시
  channel.publish('events', 'order.created', Buffer.from('...'));     // → order-all, audit-log
  channel.publish('events', 'order.critical', Buffer.from('...'));    // → order-all, critical-alerts, audit-log
  channel.publish('events', 'payment.completed', Buffer.from('...')); // → audit-log만
}
```

---

## AMQP 0-9-1 프로토콜 심화

### Frame 구조 상세

AMQP 0-9-1 프로토콜의 모든 데이터는 Frame 단위로 전송된다. 하나의 Frame은 다음과 같은 바이너리 구조를 가진다:

```
┌──────────┬──────────┬──────────┬─────────────────────┬───────────┐
│ Type (1B)│Channel(2B)│ Size(4B) │    Payload (NB)     │ End (1B)  │
│ 0x01-0x08│  0-65535  │          │                     │  0xCE     │
└──────────┴──────────┴──────────┴─────────────────────┴───────────┘
```

- **Type**: 프레임 유형을 나타내는 1바이트 정수이다. `0x01`=Method, `0x02`=Content Header, `0x03`=Content Body, `0x08`=Heartbeat이다
- **Channel**: 해당 프레임이 속하는 채널 번호이다. 0번 채널은 Connection 레벨 명령 전용이다
- **Size**: Payload의 크기(바이트)이다
- **Payload**: 실제 데이터이다. 프레임 유형에 따라 구조가 다르다
- **End**: 프레임 종료 마커로 항상 `0xCE`(206)이다. 이 값이 아니면 프로토콜 오류로 연결을 종료한다

#### Method Frame 상세

Method Frame은 AMQP 명령을 전달한다. Payload 구조는 다음과 같다:

```
┌───────────┬───────────┬────────────────────────┐
│ Class(2B) │ Method(2B)│ Arguments (가변 길이)   │
└───────────┴───────────┴────────────────────────┘
```

- **Class ID**: AMQP 클래스를 식별한다. 예를 들어 Connection=10, Channel=20, Exchange=40, Queue=50, Basic=60, Tx=90이다
- **Method ID**: 클래스 내 메서드를 식별한다. 예를 들어 Queue.Declare=10, Queue.Declare-Ok=11, Basic.Publish=40, Basic.Deliver=60이다
- **Arguments**: 메서드에 따라 다른 인자를 포함한다. 데이터 타입은 short-string, long-string, octet, short, long, longlong, table, timestamp 등이 있다

주요 Class/Method 조합은 다음과 같다:

| Class | Method | 설명 |
|-------|--------|------|
| Connection (10) | Start (10) | 서버가 클라이언트에게 프로토콜 버전과 인증 메커니즘을 안내한다 |
| Connection (10) | Tune (30) | 서버가 최대 프레임 크기, 최대 채널 수, heartbeat 간격을 제안한다 |
| Connection (10) | Open (40) | 클라이언트가 사용할 vhost를 지정한다 |
| Connection (10) | Close (50) | 연결을 정상적으로 종료한다. reply-code와 reply-text를 포함한다 |
| Channel (20) | Open (10) | 새 채널을 생성한다 |
| Channel (20) | Flow (20) | 채널의 메시지 흐름을 제어(일시 중지/재개)한다 |
| Exchange (40) | Declare (10) | Exchange를 선언(생성)한다 |
| Exchange (40) | Delete (20) | Exchange를 삭제한다 |
| Queue (50) | Declare (10) | Queue를 선언(생성)한다 |
| Queue (50) | Bind (20) | Queue를 Exchange에 바인딩한다 |
| Queue (50) | Purge (30) | Queue의 모든 메시지를 삭제한다 |
| Basic (60) | Publish (40) | 메시지를 발행한다 |
| Basic (60) | Consume (20) | Queue에서 메시지를 구독한다 |
| Basic (60) | Deliver (60) | 서버가 Consumer에게 메시지를 전달한다 |
| Basic (60) | Ack (80) | 메시지 수신을 확인한다 |
| Basic (60) | Reject (90) | 메시지를 거부한다 |
| Confirm (85) | Select (10) | Publisher Confirms 모드를 활성화한다 |

#### Content Header Frame 상세

메시지를 전송할 때 Method Frame(Basic.Publish 또는 Basic.Deliver) 다음에 Content Header Frame이 뒤따른다. Payload 구조는 다음과 같다:

```
┌───────────┬────────┬──────────────┬───────────────┬──────────────────┐
│ Class(2B) │Weight(2B)│ Body Size(8B)│Property Flags │ Property Values  │
│           │ (항상 0) │  (전체 크기)  │  (2B 비트맵)   │   (가변 길이)    │
└───────────┴────────┴──────────────┴───────────────┴──────────────────┘
```

- **Body Size**: 뒤따르는 Content Body Frame들의 총 페이로드 크기이다
- **Property Flags**: 어떤 속성이 존재하는지를 비트맵으로 표시한다. 비트가 1이면 해당 속성의 값이 Property Values에 포함된다
- **Property Values**: 설정된 속성들의 값을 순서대로 나열한다

Property Flags 비트 매핑은 다음과 같다:

| 비트 | 속성 | 설명 |
|------|------|------|
| 15 | content-type | MIME 타입 (예: `application/json`) |
| 14 | content-encoding | 인코딩 (예: `utf-8`, `gzip`) |
| 13 | headers | 사용자 정의 헤더 테이블 |
| 12 | delivery-mode | 1=transient, 2=persistent |
| 11 | priority | 메시지 우선순위 (0-9) |
| 10 | correlation-id | RPC 응답 매칭용 |
| 9 | reply-to | RPC 응답 큐 이름 |
| 8 | expiration | 메시지 TTL (문자열, 밀리초 단위) |
| 7 | message-id | 메시지 고유 식별자 |
| 6 | timestamp | 메시지 생성 시각 (Unix 타임스탬프) |
| 5 | type | 메시지 유형 (애플리케이션 정의) |
| 4 | user-id | 발행자 사용자 ID (브로커가 검증) |
| 3 | app-id | 발행 애플리케이션 식별자 |

#### Content Body Frame 상세

실제 메시지 페이로드를 전달하는 프레임이다. 메시지 크기가 협상된 최대 프레임 크기(frame_max)를 초과하면 여러 Content Body Frame으로 분할된다. 기본 frame_max는 131072바이트(128KB)이다.

```
메시지 발행 시 프레임 시퀀스:

  Frame 1: Method Frame     (Basic.Publish: exchange="orders", routing_key="new")
  Frame 2: Content Header   (content-type="application/json", delivery-mode=2, body-size=250000)
  Frame 3: Content Body     (페이로드 첫 131072 바이트)
  Frame 4: Content Body     (페이로드 다음 118928 바이트)
```

모든 프레임은 동일한 채널 번호를 가져야 한다. 다른 채널의 프레임은 Content Header/Body 시퀀스 사이에 인터리빙(interleaving)될 수 있으며, 이것이 채널 멀티플렉싱의 핵심이다.

#### Heartbeat Frame 상세

Heartbeat Frame은 TCP 연결이 살아 있는지 확인하는 메커니즘이다. Payload가 없으며, 채널 번호는 항상 0이다.

```
Heartbeat 협상 및 동작:

Client                              RabbitMQ
  │                                    │
  │◄── Connection.Tune ───────────────│  heartbeat=60 (서버 제안)
  │                                    │
  │─── Connection.Tune-Ok ───────────►│  heartbeat=60 (클라이언트 수락)
  │                                    │
  │     (60초마다 Heartbeat 교환)       │
  │                                    │
  │◄── Heartbeat ─────────────────────│
  │─── Heartbeat ─────────────────────►│
  │                                    │
  │     (2 * heartbeat 기간 동안         │
  │      Heartbeat 미수신 시)            │
  │                                    │
  │        ╳  연결 끊김 감지             │
```

Heartbeat 타임아웃 처리 규칙은 다음과 같다:
- 클라이언트와 서버 모두 heartbeat 간격의 2배 시간 동안 상대방으로부터 아무 프레임도 수신하지 못하면 연결이 끊어진 것으로 판단한다
- heartbeat 값이 0이면 heartbeat를 비활성화한다. 프로덕션 환경에서는 권장하지 않는다
- 일반 데이터 프레임도 heartbeat 역할을 한다. 즉, 데이터가 활발히 교환되는 동안에는 별도의 Heartbeat Frame이 불필요하다
- 권장 heartbeat 간격은 60초이다. 너무 짧으면 불필요한 네트워크 트래픽이 발생하고, 너무 길면 연결 단절 감지가 지연된다

### Connection 핸드셰이크 전체 시퀀스

AMQP 0-9-1 연결 수립은 TCP 3-way handshake 이후 프로토콜 레벨에서 다단계 핸드셰이크를 수행한다. 전체 과정은 다음과 같다:

```
Client                                          RabbitMQ Server
  │                                                  │
  │ ─── TCP SYN ──────────────────────────────────► │  TCP 연결 수립
  │ ◄── TCP SYN-ACK ──────────────────────────────  │
  │ ─── TCP ACK ──────────────────────────────────► │
  │                                                  │
  │ ─── Protocol Header ─────────────────────────► │  "AMQP\x00\x00\x09\x01"
  │     (8 bytes: AMQP 0-9-1 선언)                   │  (프로토콜 식별 + 버전)
  │                                                  │
  │ ◄── Connection.Start ─────────────────────────  │
  │     version-major=0, version-minor=9             │  서버 지원 기능 안내
  │     mechanisms="PLAIN AMQPLAIN"                  │  지원 인증 메커니즘
  │     locales="en_US"                              │  지원 로케일
  │     server-properties={...}                      │  서버 정보 (product, version)
  │                                                  │
  │ ─── Connection.Start-Ok ──────────────────────► │
  │     mechanism="PLAIN"                            │  선택한 인증 방식
  │     response="\x00guest\x00guest"                │  인증 정보 (SASL PLAIN)
  │     locale="en_US"                               │  선택한 로케일
  │     client-properties={...}                      │  클라이언트 정보
  │                                                  │
  │ ◄── Connection.Tune ──────────────────────────  │
  │     channel-max=2047                             │  최대 채널 수 제안
  │     frame-max=131072                             │  최대 프레임 크기 제안 (128KB)
  │     heartbeat=60                                 │  Heartbeat 간격 제안 (초)
  │                                                  │
  │ ─── Connection.Tune-Ok ───────────────────────► │
  │     channel-max=2047                             │  수락 (더 낮은 값으로 조정 가능)
  │     frame-max=131072                             │  수락
  │     heartbeat=60                                 │  수락
  │                                                  │
  │ ─── Connection.Open ──────────────────────────► │
  │     virtual-host="/"                             │  사용할 vhost 지정
  │                                                  │
  │ ◄── Connection.Open-Ok ───────────────────────  │
  │                                                  │  연결 수립 완료
  │ ─── Channel.Open (channel=1) ─────────────────► │
  │ ◄── Channel.Open-Ok ─────────────────────────  │  채널 사용 가능
  │                                                  │
```

각 단계의 세부 동작은 다음과 같다:

1. **Protocol Header**: 클라이언트가 8바이트 프로토콜 헤더(`AMQP\x00\x00\x09\x01`)를 전송한다. 서버가 해당 프로토콜 버전을 지원하지 않으면 자신이 지원하는 버전의 Protocol Header를 반환하고 연결을 종료한다
2. **Connection.Start / Start-Ok**: SASL(Simple Authentication and Security Layer) 기반 인증을 수행한다. PLAIN 메커니즘은 `\x00username\x00password` 형식이다. EXTERNAL 메커니즘은 TLS 클라이언트 인증서를 사용한다
3. **Connection.Tune / Tune-Ok**: 양측이 협상하여 최적의 파라미터를 결정한다. 클라이언트는 서버가 제안한 값보다 낮은 값을 선택할 수 있으나 높은 값은 불가능하다. frame-max=0은 제한 없음을 의미한다
4. **Connection.Open / Open-Ok**: vhost를 지정하여 접속한다. 해당 vhost가 존재하지 않거나 사용자에게 접근 권한이 없으면 Connection.Close가 반환된다

### Channel 멀티플렉싱 메커니즘

하나의 TCP 연결 위에 여러 채널이 동시에 동작하는 원리는 다음과 같다:

```
TCP Connection (단일 소켓)
│
├─ Channel 1: Queue.Declare → Queue.Declare-Ok
│               ↕ (interleaving 가능)
├─ Channel 2: Basic.Publish → Content Header → Content Body
│               ↕ (interleaving 가능)
├─ Channel 3: Basic.Deliver ← Content Header ← Content Body
│
└─ Channel 0: Connection-level 명령 전용 (Heartbeat, Connection.Close 등)
```

멀티플렉싱의 핵심 규칙은 다음과 같다:

- 각 프레임의 Channel 필드가 해당 프레임이 속하는 채널을 식별한다
- Method Frame과 그에 연결된 Content Header/Body Frame들은 반드시 연속해야 한다 (동일 채널 내에서). 그러나 서로 다른 채널의 프레임은 중간에 삽입(interleave)될 수 있다
- Channel 0은 Connection 레벨 명령 전용이다. Channel.Open, Basic.Publish 등은 0번 채널에서 전송할 수 없다
- 채널은 경량 자원이지만, 각 채널마다 RabbitMQ 서버 내에 Erlang 프로세스가 할당된다. 따라서 수천 개의 채널을 생성하면 서버의 메모리와 CPU를 소비한다
- 채널은 쓰레드 세이프하지 않다. 하나의 채널을 여러 쓰레드에서 동시에 사용해서는 안 되며, 쓰레드당 1개의 채널을 사용하는 것이 권장 패턴이다

### Protocol Extensions

RabbitMQ는 AMQP 0-9-1 표준을 확장한 여러 기능을 제공한다:

| 확장 기능 | 설명 |
|-----------|------|
| Publisher Confirms | Basic.Ack/Basic.Nack를 Publisher에게 전송하여 메시지 도착을 확인한다. `Confirm.Select`로 활성화한다 |
| Consumer Cancellation Notification | 큐가 삭제되거나 HA failover 시 Consumer에게 `Basic.Cancel`을 전송한다 |
| Exchange-to-Exchange Binding | Exchange를 다른 Exchange에 바인딩하여 계층적 라우팅을 구성할 수 있다 |
| Sender-Selected Distribution | `CC`와 `BCC` 헤더를 사용하여 메시지를 추가 routing key로 라우팅한다 |
| Per-Consumer QoS | `basic.qos`에서 `global` 플래그로 채널 전체 또는 개별 Consumer에 prefetch를 적용한다 |
| Negative Acknowledgment | `basic.nack`로 하나 이상의 메시지를 일괄 거부한다. `multiple` 플래그 지원이다 |
| Alternate Exchange | Exchange 선언 시 `alternate-exchange` 인자로 라우팅 실패 시 대체 Exchange를 지정한다 |
| TTL Extensions | Per-Queue TTL(`x-message-ttl`), Per-Message TTL(`expiration` 속성), Queue TTL(`x-expires`)을 지원한다 |

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

## 고가용성 (HA) 패턴

### Quorum Queue 기반 HA (권장)

Quorum Queue는 RabbitMQ에서 가장 권장되는 HA 방식이다. Raft 합의 프로토콜로 메시지를 자동 복제하며, 별도의 HA 정책 설정이 불필요하다.

```javascript
// Quorum Queue 기반 HA 설정
await channel.assertQueue('ha-orders', {
  durable: true,
  arguments: {
    'x-queue-type': 'quorum',
    'x-quorum-initial-group-size': 3,    // 3개 노드에 복제
    'x-delivery-limit': 5                 // 최대 재배달 횟수
  }
});
```

Quorum Queue HA의 특성:
- 과반수(N/2 + 1) 노드가 살아 있으면 서비스가 계속된다
- Leader 노드가 장애를 일으키면 자동으로 새 Leader가 선출된다 (보통 5-15초)
- 데이터 무손실이 보장된다 (커밋된 메시지 기준)
- Consumer는 Leader 변경 시 자동으로 새 Leader에 재연결된다

### Classic Mirrored Queue (Deprecated)

Classic Mirrored Queue는 RabbitMQ 3.8 이전의 HA 방식이다. RabbitMQ 3.13부터 deprecated되었으며, Quorum Queue로의 마이그레이션이 강력히 권장된다.

```ini
# (Deprecated) HA Policy 설정
rabbitmqctl set_policy ha-all "^ha\." '{"ha-mode":"all","ha-sync-mode":"automatic"}'
```

#### Quorum Queue로의 마이그레이션 가이드

1. **신규 Quorum Queue 생성**: 동일한 이름 규칙으로 Quorum Queue를 생성한다
2. **Shovel로 메시지 이전**: Dynamic Shovel을 사용하여 기존 Mirrored Queue의 메시지를 Quorum Queue로 복사한다
3. **Consumer 전환**: Consumer를 새 Quorum Queue로 전환한다
4. **Producer 전환**: Producer를 새 Quorum Queue로 전환한다
5. **기존 큐 삭제**: 메시지가 모두 이전된 후 기존 Mirrored Queue를 삭제한다

```bash
# Mirrored Queue에서 Quorum Queue로 마이그레이션
# 1. 새 Quorum Queue 생성
rabbitmqadmin declare queue name=orders-v2 durable=true \
  arguments='{"x-queue-type":"quorum","x-quorum-initial-group-size":3}'

# 2. Dynamic Shovel로 메시지 이전
rabbitmqctl set_parameter shovel migrate-orders \
  '{"src-protocol":"amqp091","src-uri":"amqp://","src-queue":"orders",
    "dest-protocol":"amqp091","dest-uri":"amqp://","dest-queue":"orders-v2"}'

# 3. 마이그레이션 완료 후 Shovel 삭제
rabbitmqctl clear_parameter shovel migrate-orders
```

### Multi-DC 배포: Federation vs Shovel

지리적으로 분산된 데이터센터 간 RabbitMQ를 연결하는 두 가지 방식의 비교이다:

| 항목 | Federation | Shovel |
|------|-----------|--------|
| 방향 | 단방향 (upstream → downstream) | 양방향 설정 가능 |
| 결합도 | 느슨한 결합 | 긴밀한 결합 |
| 메시지 풀링 | downstream에 Consumer가 있을 때만 | 항상 (큐에 메시지가 있으면) |
| 설정 복잡도 | Policy 기반 (선언적) | 파라미터 기반 (명시적) |
| 적합한 시나리오 | 지리적 분산 (느슨한 연결) | DC 마이그레이션, 정확한 라우팅 |
| 프로토콜 | AMQP | AMQP (다른 프로토콜도 가능) |
| 클러스터 독립성 | 각 클러스터가 독립적 | 각 클러스터가 독립적 |

```
Federation 토폴로지:

  DC-Seoul (upstream)              DC-Tokyo (downstream)
  ┌──────────────────┐            ┌──────────────────┐
  │  Exchange: orders│            │  Exchange: orders│
  │  (federation-    │◄───────────│  (federated)     │
  │   upstream)      │  AMQP Link │                  │
  └──────────────────┘            └──────────────────┘

  - DC-Tokyo에 Consumer가 있을 때만 DC-Seoul에서 메시지를 가져온다
  - 네트워크 효율이 높다 (불필요한 메시지 전송 없음)


Shovel 토폴로지:

  DC-Seoul                        DC-Tokyo
  ┌──────────────────┐            ┌──────────────────┐
  │  Queue: orders   │───────────►│  Exchange: orders│
  │                  │  Shovel    │                  │
  └──────────────────┘            └──────────────────┘

  - DC-Seoul 큐의 메시지를 DC-Tokyo Exchange로 즉시 전달한다
  - Consumer 유무와 관계없이 동작한다
```

### 장애 복구 시나리오

#### Leader 노드 실패

```
Leader 노드 장애 복구 과정:

  시간축 ───────────────────────────────────────────►

  t=0: Leader(Node1) 장애 발생
       Follower들이 heartbeat 타임아웃 감지

  t=5~15초: Leader Election 시작
       Node2 또는 Node3가 새 Leader로 선출

  t=15~30초: 새 Leader가 서비스 시작
       미확인(unacked) 메시지가 Consumer에게 재배달
       Publisher Confirms 미완료 메시지는 nack → 재발행 필요

  t=?: Node1 복구
       Node1이 Follower로 클러스터에 재합류
       미싱 로그를 Leader로부터 동기화
```

#### Split-Brain 시나리오

```
Split-Brain 발생 및 복구 (pause_minority):

  정상 상태:
  [Node1] ── [Node2] ── [Node3]

  파티션 발생 (Node3 격리):
  [Node1] ── [Node2]    ╳    [Node3(paused)]

  복구:
  [Node1] ── [Node2] ── [Node3(resuming)]
                              ↓
                         Mnesia 동기화
                         Quorum Queue 로그 동기화
```

#### 전체 클러스터 장애

전체 클러스터가 다운된 경우 복구 절차는 다음과 같다:

1. **마지막에 종료된 노드를 먼저 시작한다**. 이 노드가 가장 최신 데이터를 가지고 있다
2. 나머지 노드를 순차적으로 시작한다
3. `rabbitmqctl force_boot` 명령으로 특정 노드를 강제로 첫 번째 노드로 시작할 수 있다 (마지막 종료 노드를 알 수 없을 때)
4. Quorum Queue는 과반수 노드가 복구되면 자동으로 서비스를 재개한다

```bash
# 마지막 종료 노드 확인이 어려울 때 강제 부팅
rabbitmqctl force_boot
rabbitmq-server -detached
```

### 백업/복원

#### Definitions Export/Import

RabbitMQ의 메타데이터(Exchange, Queue, Binding, User, Permission, Policy 등)를 JSON으로 내보내고 복원할 수 있다.

```bash
# Definitions 내보내기
rabbitmqctl export_definitions /tmp/definitions.json

# 또는 Management API로 내보내기
curl -u guest:guest http://localhost:15672/api/definitions > definitions.json

# Definitions 가져오기
rabbitmqctl import_definitions /tmp/definitions.json

# 또는 Management API로 가져오기
curl -u guest:guest -X POST -H "Content-Type: application/json" \
  -d @definitions.json http://localhost:15672/api/definitions
```

#### 메시지 백업

메시지 자체는 definitions에 포함되지 않는다. 메시지를 백업하려면:

1. **Shovel 사용**: 큐의 메시지를 다른 클러스터/큐로 복사한다
2. **Consumer를 이용한 백업**: 메시지를 소비하여 파일이나 다른 저장소에 기록한다
3. **디스크 레벨 백업**: Mnesia 디렉토리(`/var/lib/rabbitmq/mnesia/`)를 파일시스템 스냅샷으로 백업한다 (노드 정지 상태에서만 안전)

---

## 성능 튜닝

### Erlang VM 튜닝

RabbitMQ는 Erlang VM(BEAM) 위에서 동작하므로, VM 파라미터가 성능에 직접적인 영향을 미친다.

```ini
# rabbitmq-env.conf 또는 환경 변수로 설정
RABBITMQ_SERVER_ADDITIONAL_ERL_ARGS="+P 1048576 +A 128 +K true +hms 8192"
```

| 파라미터 | 기본값 | 권장값 | 설명 |
|----------|--------|--------|------|
| `+P` | 1048576 | 1048576~2097152 | 최대 Erlang 프로세스 수. Connection, Channel, Queue 각각이 프로세스이다 |
| `+A` | 128 | 128~256 | 비동기 I/O 스레드 수. 디스크 I/O가 많으면 증가시킨다 |
| `+K` | true | true | 커널 폴링(epoll/kqueue) 활성화. 대규모 연결에 필수이다 |
| `+hms` | 233 | 8192~32768 | 초기 힙 크기(워드). 큐가 많으면 증가시켜 GC를 줄인다 |
| `+hmbs` | 233 | 8192~32768 | 초기 바이너리 가상 힙 크기. 메시지가 클 때 유용하다 |
| `+S` | CPU코어수 | CPU코어수 | 스케줄러 수. 보통 기본값이 적절하다 |
| `+stbt` | db | ts | 스케줄러 바인딩. `ts`(thread spread)로 설정하면 NUMA 환경에서 유리하다 |

### Prefetch Count 최적화

Consumer별 적정 prefetch 값을 산정하는 공식은 다음과 같다:

```
적정 prefetch ≈ (네트워크 RTT × 목표 처리량) / 1000

예시:
- 네트워크 RTT: 1ms (같은 DC)
- 목표 처리량: 10,000 msg/s
- Consumer 수: 4

Consumer당 목표: 10,000 / 4 = 2,500 msg/s
적정 prefetch ≈ (1 × 2,500) / 1000 = 2.5 → 최소 3

실무에서는 처리 시간 변동성을 고려하여 2-3배를 적용:
→ prefetch = 10 정도가 적절
```

Consumer별로 적정값이 다르므로, 모니터링을 통해 다음 지표를 관찰하며 조정한다:
- `consumer_utilisation`: 1.0에 가까울수록 Consumer가 쉬지 않고 메시지를 처리하는 것이다. 0.5 이하이면 prefetch를 늘린다
- `unacked` 메시지 수: prefetch보다 작으면 Consumer가 처리 속도를 따라가는 것이다

### Connection/Channel 풀링 전략

```
권장 아키텍처:

  Application
  ┌────────────────────────────────────────────┐
  │  Connection Pool (1-5 connections)          │
  │  ┌──────────┐  ┌──────────┐                │
  │  │Connection1│  │Connection2│  ...           │
  │  │ ┌──────┐ │  │ ┌──────┐ │                │
  │  │ │Chan 1│ │  │ │Chan 5│ │                │
  │  │ │Chan 2│ │  │ │Chan 6│ │                │
  │  │ │Chan 3│ │  │ │Chan 7│ │                │
  │  │ │Chan 4│ │  │ │Chan 8│ │                │
  │  │ └──────┘ │  │ └──────┘ │                │
  │  └──────────┘  └──────────┘                │
  │                                            │
  │  Thread 1 → Chan 1 (전용)                   │
  │  Thread 2 → Chan 2 (전용)                   │
  │  Thread 3 → Chan 3 (전용)                   │
  │  ...                                       │
  └────────────────────────────────────────────┘
```

풀링 전략의 핵심 원칙은 다음과 같다:

1. **Connection 수 최소화**: TCP 연결은 비용이 크다. 일반적으로 애플리케이션당 1-5개면 충분하다
2. **Channel은 쓰레드당 1개**: Channel은 쓰레드 세이프하지 않으므로, 각 쓰레드가 전용 Channel을 사용한다
3. **Publisher와 Consumer 분리**: Publisher용 Connection과 Consumer용 Connection을 분리하면 flow control의 영향을 격리할 수 있다
4. **Channel 재사용**: 메시지 발행마다 Channel을 생성/닫으면 성능이 크게 저하된다. Channel을 풀링하여 재사용한다

### Lazy Queue로 메모리 압력 관리

대량의 메시지가 적체될 가능성이 있는 큐는 Lazy 모드로 설정하여 메모리 사용을 안정화한다:

```ini
# Policy로 특정 패턴의 큐에 lazy 모드 적용
rabbitmqctl set_policy lazy-policy "^(batch|import)\." \
  '{"queue-mode":"lazy"}' \
  --priority 10 \
  --apply-to queues
```

메모리 절약 효과 비교:

| 시나리오 | Default 모드 | Lazy 모드 |
|----------|-------------|-----------|
| 100만 메시지 (1KB) | ~1.2GB 메모리 | ~200MB 메모리 |
| 100만 메시지 (10KB) | ~10GB 메모리 | ~200MB 메모리 |
| 소비 지연 (p99) | <1ms | 5-20ms |

### 배치 Publishing/Consuming

```javascript
// 배치 Publishing: 여러 메시지를 한 번의 confirm으로 처리
async function batchPublish(messages, batchSize = 100) {
  const channel = await connection.createConfirmChannel();
  let batch = [];

  for (const msg of messages) {
    channel.publish('orders', 'new', Buffer.from(JSON.stringify(msg)), {
      persistent: true
    });
    batch.push(msg);

    if (batch.length >= batchSize) {
      await channel.waitForConfirms();  // 배치 단위로 확인
      batch = [];
    }
  }

  if (batch.length > 0) {
    await channel.waitForConfirms();  // 잔여 배치 확인
  }
}

// 배치 Consuming: multiple ack로 일괄 확인
let unackedCount = 0;
const ACK_BATCH_SIZE = 50;

channel.consume('orders', (msg) => {
  processMessage(msg);
  unackedCount++;

  if (unackedCount >= ACK_BATCH_SIZE) {
    channel.ack(msg, true);  // multiple=true: 이 delivery tag 이하 모두 ack
    unackedCount = 0;
  }
});
```

### 메모리/디스크 Alarm 임계값 조정

```ini
# rabbitmq.conf

# 메모리 알람: 사용 가능 RAM의 비율 (기본: 0.4 = 40%)
vm_memory_high_watermark.relative = 0.6

# 또는 절대값으로 설정
# vm_memory_high_watermark.absolute = 2GB

# 페이징 임계값: 메모리 알람 임계값의 비율 (기본: 0.5)
# 이 비율에 도달하면 메시지를 디스크로 페이징 시작
vm_memory_high_watermark_paging_ratio = 0.75

# 디스크 알람: 여유 공간 (기본: 50MB)
disk_free_limit.absolute = 2GB

# 또는 RAM 대비 비율
# disk_free_limit.relative = 1.5   # RAM의 1.5배
```

알람 발생 시 동작:
- **Memory Alarm**: 모든 Producer의 연결이 차단(blocked)된다. Consumer는 정상 동작하여 큐를 비울 수 있다. 메모리 사용량이 임계값 아래로 떨어지면 자동으로 차단이 해제된다
- **Disk Alarm**: Memory Alarm과 동일하게 Producer를 차단한다. 디스크 여유 공간이 임계값 이상으로 복구되면 해제된다

### 메시지 크기 최적화

메시지 크기는 처리량과 지연에 직접적인 영향을 미친다:

| 메시지 크기 | 예상 처리량 (단일 큐) | 권장 사용 |
|------------|----------------------|-----------|
| <1KB | 50,000-80,000 msg/s | 이벤트 알림, 명령 |
| 1-10KB | 20,000-50,000 msg/s | 일반 비즈니스 메시지 |
| 10-100KB | 5,000-20,000 msg/s | 중간 크기 데이터 |
| 100KB-1MB | 1,000-5,000 msg/s | 문서, 이미지 메타데이터 |
| >1MB | 비권장 | 별도 저장소에 저장 후 참조 URL 전달 |

최적화 전략:
1. **Claim Check 패턴**: 큰 페이로드는 S3/MinIO에 저장하고, 메시지에는 참조 URL만 포함한다
2. **압축**: `content_encoding: gzip`으로 압축하여 전송한다
3. **직렬화 포맷**: JSON 대신 Protocol Buffers, MessagePack 등 바이너리 포맷을 사용한다
4. **불필요한 필드 제거**: 소비자에게 필요하지 않은 데이터를 제외한다

---

## 모니터링 심화

### Management Plugin HTTP API 주요 엔드포인트

| 엔드포인트 | 메서드 | 설명 |
|-----------|--------|------|
| `/api/overview` | GET | 클러스터 전체 요약 정보 |
| `/api/nodes` | GET | 모든 노드 상태 |
| `/api/nodes/{name}` | GET | 특정 노드 상세 정보 (메모리, 디스크, 프로세스 등) |
| `/api/connections` | GET | 모든 연결 목록 |
| `/api/connections/{name}` | DELETE | 연결 강제 종료 |
| `/api/channels` | GET | 모든 채널 목록 |
| `/api/queues` | GET | 모든 큐 목록 (메시지 수, Consumer 수 등) |
| `/api/queues/{vhost}/{name}` | GET/PUT/DELETE | 큐 상세 조회/생성/삭제 |
| `/api/queues/{vhost}/{name}/get` | POST | 큐에서 메시지 peek (소비하지 않고 조회) |
| `/api/exchanges` | GET | 모든 Exchange 목록 |
| `/api/exchanges/{vhost}/{name}/publish` | POST | API로 메시지 발행 |
| `/api/bindings` | GET | 모든 바인딩 목록 |
| `/api/vhosts` | GET | 모든 vhost 목록 |
| `/api/users` | GET | 모든 사용자 목록 |
| `/api/permissions` | GET | 모든 권한 목록 |
| `/api/policies` | GET | 모든 정책 목록 |
| `/api/definitions` | GET/POST | 전체 정의 내보내기/가져오기 |
| `/api/health/checks/alarms` | GET | 알람 상태 확인 |
| `/api/health/checks/local-alarms` | GET | 로컬 노드 알람 상태 |

```bash
# API 사용 예시
# 큐 목록 조회 (메시지 수 포함)
curl -u guest:guest http://localhost:15672/api/queues | jq '.[] | {name, messages, consumers}'

# 특정 큐의 메시지 peek (1개)
curl -u guest:guest -X POST http://localhost:15672/api/queues/%2f/orders/get \
  -H "Content-Type: application/json" \
  -d '{"count":1,"ackmode":"ack_requeue_true","encoding":"auto"}'
```

### Prometheus 메트릭 상세

`rabbitmq_prometheus` 플러그인을 활성화하면 `/metrics` 엔드포인트에서 Prometheus 형식의 메트릭을 제공한다.

```bash
# 플러그인 활성화
rabbitmq-plugins enable rabbitmq_prometheus
```

#### Node 레벨 메트릭

| 메트릭 | 설명 |
|--------|------|
| `rabbitmq_process_resident_memory_bytes` | RabbitMQ 프로세스의 RSS 메모리 |
| `rabbitmq_process_open_fds` | 열린 파일 디스크립터 수 |
| `rabbitmq_process_max_fds` | 최대 파일 디스크립터 제한 |
| `rabbitmq_disk_space_available_bytes` | 사용 가능한 디스크 공간 |
| `rabbitmq_erlang_processes_used` | 사용 중인 Erlang 프로세스 수 |
| `rabbitmq_erlang_gc_runs_total` | GC 실행 횟수 (누적) |
| `rabbitmq_erlang_gc_reclaimed_bytes_total` | GC로 회수된 메모리 (누적) |
| `rabbitmq_io_read_bytes_total` | 디스크 읽기 바이트 (누적) |
| `rabbitmq_io_write_bytes_total` | 디스크 쓰기 바이트 (누적) |

#### Connection/Channel 레벨 메트릭

| 메트릭 | 설명 |
|--------|------|
| `rabbitmq_connections` | 현재 연결 수 |
| `rabbitmq_connections_opened_total` | 열린 연결 수 (누적) |
| `rabbitmq_connections_closed_total` | 닫힌 연결 수 (누적) |
| `rabbitmq_channels` | 현재 채널 수 |
| `rabbitmq_consumers` | 현재 Consumer 수 |

#### Queue 레벨 메트릭

| 메트릭 | 설명 |
|--------|------|
| `rabbitmq_queue_messages` | 큐의 총 메시지 수 (ready + unacked) |
| `rabbitmq_queue_messages_ready` | 소비 가능한 메시지 수 |
| `rabbitmq_queue_messages_unacked` | 배달되었으나 미확인 메시지 수 |
| `rabbitmq_queue_messages_published_total` | 발행된 메시지 수 (누적) |
| `rabbitmq_queue_messages_delivered_total` | 배달된 메시지 수 (누적) |
| `rabbitmq_queue_messages_acknowledged_total` | 확인된 메시지 수 (누적) |
| `rabbitmq_queue_messages_redelivered_total` | 재배달된 메시지 수 (누적) |
| `rabbitmq_queue_consumers` | 큐에 연결된 Consumer 수 |
| `rabbitmq_queue_consumer_utilisation` | Consumer 활용률 (0.0~1.0) |
| `rabbitmq_queue_process_memory_bytes` | 큐 프로세스의 메모리 사용량 |
| `rabbitmq_queue_messages_ram` | 메모리에 있는 메시지 수 |
| `rabbitmq_queue_messages_persistent` | 영속적 메시지 수 |

### 핵심 모니터링 지표

프로덕션 환경에서 반드시 모니터링해야 하는 핵심 지표와 정상 범위는 다음과 같다:

| 지표 | 정상 범위 | 경고 수준 | 위험 수준 |
|------|----------|----------|----------|
| 큐 깊이 (messages) | < 1,000 | > 10,000 | > 100,000 |
| Consumer Utilisation | > 0.9 | < 0.5 | < 0.1 |
| Memory Usage | < 60% watermark | > 80% watermark | Memory Alarm |
| Disk Free | > 2GB | < 1GB | Disk Alarm |
| File Descriptors | < 70% limit | > 80% limit | > 95% limit |
| Erlang Processes | < 70% limit | > 80% limit | > 95% limit |
| Connection Churn | 낮음 (안정) | 분당 100+ 변동 | 분당 1000+ 변동 |
| Unacked Messages | < prefetch * consumers | 지속 증가 | prefetch 포화 |

### Grafana 대시보드 구성

```yaml
# Prometheus scrape 설정 (prometheus.yml)
scrape_configs:
  - job_name: 'rabbitmq'
    scrape_interval: 15s
    static_configs:
      - targets: ['rabbitmq-node1:15692', 'rabbitmq-node2:15692', 'rabbitmq-node3:15692']
    metrics_path: /metrics
```

권장 Grafana 대시보드 패널 구성:

```
┌──────────────────────────────────────────────────┐
│ Overview Row                                      │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────┐│
│ │ Total    │ │ Total    │ │ Message  │ │Publish ││
│ │ Messages │ │Consumers │ │  Rate    │ │  Rate  ││
│ └──────────┘ └──────────┘ └──────────┘ └───────┘│
├──────────────────────────────────────────────────┤
│ Queue Row                                         │
│ ┌────────────────────┐ ┌────────────────────────┐│
│ │ Messages by Queue  │ │ Consumer Utilisation   ││
│ │ (stacked area)     │ │ by Queue (line)        ││
│ └────────────────────┘ └────────────────────────┘│
├──────────────────────────────────────────────────┤
│ Node Row                                          │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────┐│
│ │ Memory   │ │ Disk     │ │  File    │ │Erlang ││
│ │ Usage    │ │  Free    │ │  Desc    │ │  Proc ││
│ └──────────┘ └──────────┘ └──────────┘ └───────┘│
├──────────────────────────────────────────────────┤
│ Connection Row                                    │
│ ┌────────────────────┐ ┌────────────────────────┐│
│ │ Connections Over   │ │ Channels Over Time     ││
│ │ Time (line)        │ │ (line)                 ││
│ └────────────────────┘ └────────────────────────┘│
└──────────────────────────────────────────────────┘
```

> RabbitMQ 공식 Grafana 대시보드 ID: `10991` (RabbitMQ Overview), `11340` (RabbitMQ Quorum Queues)

### 알림 규칙 설정

```yaml
# Prometheus alerting rules (rabbitmq-alerts.yml)
groups:
  - name: rabbitmq
    rules:
      - alert: RabbitMQQueueBacklog
        expr: rabbitmq_queue_messages > 10000
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "큐 {{ $labels.queue }} 메시지 적체 ({{ $value }}개)"

      - alert: RabbitMQMemoryAlarm
        expr: rabbitmq_alarms_memory_used_watermark == 1
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "노드 {{ $labels.instance }} Memory Alarm 발생"

      - alert: RabbitMQDiskAlarm
        expr: rabbitmq_alarms_free_disk_space_watermark == 1
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "노드 {{ $labels.instance }} Disk Alarm 발생"

      - alert: RabbitMQConnectionSpike
        expr: delta(rabbitmq_connections_opened_total[5m]) > 500
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "연결 수 급증: 5분간 {{ $value }}개 새 연결"

      - alert: RabbitMQNoConsumers
        expr: rabbitmq_queue_consumers == 0 and rabbitmq_queue_messages > 0
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "큐 {{ $labels.queue }}에 Consumer가 없고 메시지가 쌓이고 있다"

      - alert: RabbitMQLowConsumerUtilisation
        expr: rabbitmq_queue_consumer_utilisation < 0.5 and rabbitmq_queue_consumers > 0
        for: 10m
        labels:
          severity: info
        annotations:
          summary: "큐 {{ $labels.queue }} Consumer 활용률 저조 ({{ $value }})"

      - alert: RabbitMQFileDescriptorsHigh
        expr: rabbitmq_process_open_fds / rabbitmq_process_max_fds > 0.8
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "파일 디스크립터 사용률 {{ $value | humanizePercentage }}"
```

---

## 보안

### TLS/SSL 설정

#### 서버 인증서 설정

```ini
# rabbitmq.conf: TLS 서버 설정
listeners.ssl.default = 5671

ssl_options.cacertfile = /path/to/ca_certificate.pem
ssl_options.certfile   = /path/to/server_certificate.pem
ssl_options.keyfile    = /path/to/server_key.pem
ssl_options.verify     = verify_peer
ssl_options.fail_if_no_peer_cert = false

# TLS 버전 제한 (TLS 1.2 이상만 허용)
ssl_options.versions.1 = tlsv1.2
ssl_options.versions.2 = tlsv1.3

# 암호화 스위트 설정 (강력한 것만 허용)
ssl_options.ciphers.1  = TLS_AES_256_GCM_SHA384
ssl_options.ciphers.2  = TLS_AES_128_GCM_SHA256
ssl_options.ciphers.3  = TLS_CHACHA20_POLY1305_SHA256
```

#### 클라이언트 인증서 (Mutual TLS)

```ini
# rabbitmq.conf: 클라이언트 인증서 검증
ssl_options.verify     = verify_peer
ssl_options.fail_if_no_peer_cert = true  # 클라이언트 인증서 필수

# Management UI에도 TLS 적용
management.ssl.port       = 15671
management.ssl.cacertfile = /path/to/ca_certificate.pem
management.ssl.certfile   = /path/to/server_certificate.pem
management.ssl.keyfile    = /path/to/server_key.pem
```

```javascript
// Node.js 클라이언트: TLS 연결
const amqplib = require('amqplib');
const fs = require('fs');

const connection = await amqplib.connect({
  protocol: 'amqps',
  hostname: 'rabbitmq.example.com',
  port: 5671,
  username: 'app-user',
  password: 'app-password',
  vhost: '/production',
  ssl: {
    ca: [fs.readFileSync('/path/to/ca_certificate.pem')],
    cert: fs.readFileSync('/path/to/client_certificate.pem'),
    key: fs.readFileSync('/path/to/client_key.pem'),
    rejectUnauthorized: true
  }
});
```

### SASL 인증 메커니즘

| 메커니즘 | 설명 | 보안 수준 |
|----------|------|----------|
| PLAIN | 사용자 이름과 비밀번호를 평문으로 전송한다. TLS와 함께 사용해야 안전하다 | 낮음 (TLS 없이), 보통 (TLS 함께) |
| AMQPLAIN | AMQP 전용 PLAIN 변형이다. 기능적으로 PLAIN과 동일하다 | 낮음 (TLS 없이) |
| EXTERNAL | TLS 클라이언트 인증서의 CN(Common Name)으로 인증한다. 비밀번호가 불필요하다 | 높음 |
| RABBIT-CR-DEMO | Challenge-Response 데모 구현이다. 프로덕션에서 사용하지 않는다 | 개발용 |

```ini
# rabbitmq.conf: 인증 메커니즘 설정
# EXTERNAL을 우선 사용하고, TLS 없는 연결은 PLAIN 허용
auth_mechanisms.1 = EXTERNAL
auth_mechanisms.2 = PLAIN
```

### Virtual Host 기반 격리

vhost는 RabbitMQ 내의 논리적 격리 단위이다. 각 vhost는 완전히 독립된 네임스페이스를 가진다.

```bash
# vhost 생성
rabbitmqctl add_vhost /production
rabbitmqctl add_vhost /staging
rabbitmqctl add_vhost /development

# vhost별 사용자 권한 설정
rabbitmqctl set_permissions -p /production app-user "^app\." "^app\." "^(app\.|amq\.)"
rabbitmqctl set_permissions -p /staging dev-user ".*" ".*" ".*"

# vhost 리소스 제한 설정
rabbitmqctl set_vhost_limits -p /staging '{"max-connections": 100, "max-queues": 50}'
```

### 사용자 권한 모델

RabbitMQ의 권한은 `configure`, `write`, `read` 세 가지 동작에 대해 정규식 패턴으로 정의된다:

| 권한 | 적용 대상 | 설명 |
|------|----------|------|
| configure | Exchange, Queue | 리소스를 생성/삭제/수정할 수 있다 |
| write | Exchange | Exchange에 메시지를 발행할 수 있다. 큐에 바인딩을 생성할 수 있다 |
| read | Queue | 큐에서 메시지를 소비할 수 있다. Exchange에서 바인딩을 읽을 수 있다 |

```bash
# 권한 설정 예시
# app-user: "app."으로 시작하는 리소스만 configure/write/read
rabbitmqctl set_permissions -p /production app-user "^app\." "^app\." "^app\."

# monitor-user: 읽기만 가능 (모니터링 전용)
rabbitmqctl set_permissions -p /production monitor-user "^$" "^$" ".*"

# admin-user: 모든 권한
rabbitmqctl set_permissions -p /production admin-user ".*" ".*" ".*"

# 사용자 태그 설정
rabbitmqctl set_user_tags admin-user administrator
rabbitmqctl set_user_tags monitor-user monitoring
rabbitmqctl set_user_tags app-user none
```

사용자 태그와 Management UI 접근 권한:

| 태그 | Management UI 접근 범위 |
|------|----------------------|
| `administrator` | 모든 기능 (사용자 관리, 정책, 클러스터 관리 포함) |
| `monitoring` | 모든 리소스 조회 가능. 수정 불가 |
| `policymaker` | 정책(Policy) 관리 가능 |
| `management` | 자신의 vhost에 속한 리소스만 조회/관리 |
| (태그 없음) | Management UI 접근 불가 |

### OAuth 2.0 인증 (RabbitMQ 3.11+)

RabbitMQ 3.11부터 OAuth 2.0 / JWT 기반 인증을 네이티브로 지원한다.

```ini
# rabbitmq.conf: OAuth 2.0 설정
auth_backends.1 = rabbit_auth_backend_oauth2

# OAuth 2.0 Resource Server 설정
auth_oauth2.resource_server_id = rabbitmq
auth_oauth2.issuer = https://auth.example.com/realms/production
auth_oauth2.https.cacertfile = /path/to/ca.pem

# JWKS 엔드포인트 (공개 키 검증)
auth_oauth2.jwks_url = https://auth.example.com/realms/production/protocol/openid-connect/certs
```

JWT 토큰의 scope 클레임으로 RabbitMQ 권한이 매핑된다:

```json
{
  "scope": [
    "rabbitmq.configure:production/app.*",
    "rabbitmq.write:production/app.*",
    "rabbitmq.read:production/app.*"
  ]
}
```

### Shovel/Federation TLS 설정

클러스터 간 연결에도 TLS를 적용해야 한다:

```bash
# Federation upstream에 TLS 적용
rabbitmqctl set_parameter federation-upstream dc-tokyo \
  '{"uri":"amqps://federation-user:password@rabbitmq.tokyo.example.com:5671/%2f",
    "trust-user-id":true}'

# Shovel에 TLS 적용
rabbitmqctl set_parameter shovel cross-dc \
  '{"src-protocol":"amqp091",
    "src-uri":"amqps://user:pass@rabbitmq-src:5671/%2f?cacertfile=/path/to/ca.pem",
    "src-queue":"orders",
    "dest-protocol":"amqp091",
    "dest-uri":"amqps://user:pass@rabbitmq-dest:5671/%2f?cacertfile=/path/to/ca.pem",
    "dest-queue":"orders"}'
```

---

## 메시징 패턴

### 1. Work Queue (경쟁 소비자 패턴)

여러 Consumer가 하나의 큐를 공유하여 작업을 분산 처리하는 패턴이다. 라운드 로빈 방식으로 메시지가 분배된다.

```
Producer ──► Queue ──┬──► Consumer 1 (msg1, msg3, msg5...)
                     ├──► Consumer 2 (msg2, msg4, msg6...)
                     └──► Consumer 3 (msg7, msg9, msg11...)
```

```javascript
// Work Queue 패턴: 공정한 분배를 위한 prefetch 설정
const channel = await connection.createChannel();
await channel.assertQueue('tasks', { durable: true });

// prefetch=1로 설정하면 이전 메시지 처리가 완료될 때까지 새 메시지를 받지 않는다
// 이렇게 하면 빠른 Consumer에게 더 많은 메시지가 분배된다 (공정한 분배)
channel.prefetch(1);

channel.consume('tasks', async (msg) => {
  const task = JSON.parse(msg.content.toString());
  await executeTask(task);  // 처리 시간이 다를 수 있다
  channel.ack(msg);
});
```

### 2. Publish/Subscribe (Fanout 패턴)

하나의 메시지를 모든 구독자에게 브로드캐스트하는 패턴이다.

```
Producer ──► Fanout Exchange ──┬──► Queue A ──► Consumer A (email)
                               ├──► Queue B ──► Consumer B (sms)
                               └──► Queue C ──► Consumer C (push)
```

### 3. Routing (Direct 패턴)

routing key를 기반으로 특정 큐에만 메시지를 전달하는 패턴이다.

```
Producer ──► Direct Exchange ──┬──(error)──► Queue-Error ──► Error Handler
                               ├──(warn)───► Queue-Warn  ──► Warn Handler
                               └──(info)───► Queue-Info  ──► Info Handler
```

### 4. Topics (Topic Exchange 패턴)

패턴 기반 라우팅으로 유연한 메시지 분배를 구현하는 패턴이다.

```
Producer ──► Topic Exchange ──┬──(order.*)─────► Order Service
                              ├──(payment.*)───► Payment Service
                              ├──(*.critical)──► Alert Service
                              └──(#)───────────► Audit Log
```

### 5. RPC (요청-응답 패턴)

메시지 큐를 통한 동기식 요청-응답 패턴이다. `correlation_id`와 `reply_to`를 사용한다.

```
Client                           Server
  │                                │
  │──request──► [rpc_queue] ──────►│
  │  (correlation_id="abc",        │
  │   reply_to="amq.gen-Xa2...")   │
  │                                │
  │  [amq.gen-Xa2...]  ◄──response─│
  │◄──────────────────────────────│
  │  (correlation_id="abc")        │
```

```javascript
// RPC Client
async function rpcCall(request) {
  const channel = await connection.createChannel();
  const { queue: replyQueue } = await channel.assertQueue('', { exclusive: true });
  const correlationId = generateUUID();

  return new Promise((resolve) => {
    channel.consume(replyQueue, (msg) => {
      if (msg.properties.correlationId === correlationId) {
        resolve(JSON.parse(msg.content.toString()));
      }
    }, { noAck: true });

    channel.publish('', 'rpc_queue', Buffer.from(JSON.stringify(request)), {
      correlationId,
      replyTo: replyQueue
    });
  });
}

// RPC Server
channel.consume('rpc_queue', (msg) => {
  const request = JSON.parse(msg.content.toString());
  const response = processRequest(request);

  channel.publish('', msg.properties.replyTo, Buffer.from(JSON.stringify(response)), {
    correlationId: msg.properties.correlationId
  });
  channel.ack(msg);
});
```

### 6. Priority Queue 패턴

우선순위에 따라 메시지 처리 순서를 제어하는 패턴이다. 앞서 "Queue 타입 심화"에서 상세히 다루었다.

### 7. Delayed Message 패턴 (플러그인)

`rabbitmq_delayed_message_exchange` 플러그인을 사용하면 메시지를 지정된 시간만큼 지연시킨 후 라우팅할 수 있다.

```bash
# 플러그인 활성화
rabbitmq-plugins enable rabbitmq_delayed_message_exchange
```

```javascript
// Delayed Message Exchange 설정
await channel.assertExchange('delayed', 'x-delayed-message', {
  durable: true,
  arguments: { 'x-delayed-type': 'direct' }  // 내부 라우팅 유형
});

await channel.assertQueue('scheduled-tasks', { durable: true });
await channel.bindQueue('scheduled-tasks', 'delayed', 'task');

// 5분 후에 전달되는 메시지
channel.publish('delayed', 'task', Buffer.from('Send reminder email'), {
  headers: { 'x-delay': 300000 }  // 밀리초 단위 지연
});
```

플러그인 없이 DLX + TTL 조합으로도 지연 메시지를 구현할 수 있다 (앞서 DLX 심화 섹션 참조).

### 8. Dead Letter + Retry 패턴

처리 실패한 메시지를 자동으로 재시도하는 패턴이다. DLX 심화 섹션에서 상세히 다루었다. 핵심 흐름은 다음과 같다:

```
정상 처리:  Queue → Consumer → Ack → 완료

재시도:    Queue → Consumer → Nack(requeue=false)
           → DLX → Retry Queue(TTL)
           → TTL 만료 → 원래 Queue (재시도)
           → 재시도 한도 초과 시 → Parking Lot Queue
```

### 9. Saga / Choreography 패턴

마이크로서비스 간 분산 트랜잭션을 메시지 큐로 조율하는 패턴이다. 각 서비스가 이벤트를 발행하고 다른 서비스의 이벤트를 구독하여 자율적으로 처리한다.

```
Saga: 주문 처리 흐름 (Choreography)

  Order Service          Payment Service        Inventory Service
       │                       │                       │
       │──order.created──►     │                       │
       │   (Topic Exchange)    │                       │
       │                       │◄─order.created────────│
       │                       │                       │
       │                       │──payment.completed──►│
       │◄──payment.completed──│                       │
       │                       │                       │
       │                       │       │──stock.reserved──►
       │◄──stock.reserved─────────────│               │
       │                       │                       │
       │──order.confirmed──► │                       │
       │                       │                       │

  보상 트랜잭션 (실패 시):
       │                       │──payment.failed──────►│
       │◄──payment.failed─────│                       │
       │                       │                       │
       │──order.cancelled──► │                       │
       │                       │◄─stock.released──────│
```

```javascript
// Choreography Saga 이벤트 리스너 예시
// Order Service
channel.consume('order-events', async (msg) => {
  const event = JSON.parse(msg.content.toString());

  switch (event.type) {
    case 'payment.completed':
      await updateOrderStatus(event.orderId, 'PAYMENT_CONFIRMED');
      break;
    case 'payment.failed':
      await updateOrderStatus(event.orderId, 'CANCELLED');
      channel.publish('events', 'order.cancelled',
        Buffer.from(JSON.stringify({ orderId: event.orderId, reason: 'payment_failed' })));
      break;
    case 'stock.reserved':
      await updateOrderStatus(event.orderId, 'CONFIRMED');
      channel.publish('events', 'order.confirmed',
        Buffer.from(JSON.stringify({ orderId: event.orderId })));
      break;
  }
  channel.ack(msg);
});
```

---

## 트러블슈팅

### 큐 메시지 적체 원인 분석

큐에 메시지가 지속적으로 쌓이는 경우, 다음 순서로 원인을 분석한다:

```
진단 흐름:

  큐 메시지 증가 감지
        │
        ▼
  Consumer 수 확인 ──── 0이면 ──► Consumer 연결 문제 조사
        │                         (코드 오류, 네트워크, 인증)
        │ Consumer 있음
        ▼
  Consumer Utilisation 확인
        │
        ├── < 0.5 ──► Prefetch가 너무 낮거나 Consumer 처리 속도 느림
        │              → prefetch 증가 또는 Consumer 수 증가
        │
        └── > 0.9 ──► Publisher 속도가 Consumer 용량 초과
                       → Consumer 수 증가 (scale-out)
                       → 메시지 처리 로직 최적화
```

```bash
# 큐 상태 상세 확인
rabbitmqctl list_queues name messages messages_ready messages_unacknowledged \
  consumers consumer_utilisation state

# 특정 큐의 상세 정보
rabbitmqctl list_queues name messages message_bytes memory consumers \
  | grep "problem-queue"

# Consumer 연결 상태 확인
rabbitmqctl list_consumers queue_name channel_pid consumer_tag ack_required prefetch_count
```

### Consumer 연결 끊김 진단

Consumer 연결이 자주 끊어지는 경우의 원인과 해결 방법이다:

| 원인 | 진단 방법 | 해결 방법 |
|------|----------|----------|
| Heartbeat 타임아웃 | 로그에서 `missed heartbeats` 확인 | heartbeat 간격 조정, 네트워크 안정성 확인 |
| 메모리 Alarm으로 연결 차단 | Management UI에서 Connection 상태 `blocked` 확인 | 메모리 확보, watermark 조정 |
| Channel 레벨 예외 | 로그에서 `CHANNEL_ERROR` 확인 | 코드에서 예외 처리, Channel 재생성 |
| Connection 레벨 예외 | 로그에서 `CONNECTION_FORCED` 확인 | 관리자 명령으로 연결이 강제 종료된 것이다 |
| TCP 연결 끊김 | 네트워크 모니터링 | 네트워크 인프라 점검, keepalive 설정 |

```bash
# 최근 연결 이벤트 확인
rabbitmqctl list_connections name state timeout send_pend recv_cnt send_cnt

# 연결 끊김 로그 확인
tail -f /var/log/rabbitmq/rabbit@hostname.log | grep -i "connection\|closing\|error"
```

### 메모리 Alarm 발생 시 대응

```
Memory Alarm 대응 절차:

  1. 즉시 조치: Consumer가 정상 동작하는지 확인 (메시지 소비 가능)
        │
  2. 원인 파악
        │
        ├── 큐에 메시지 적체 ──► Consumer 수 증가, prefetch 최적화
        │
        ├── Connection/Channel 과다 ──► 불필요한 연결 정리, 풀링 적용
        │
        ├── 큐 수가 과다 ──► 사용하지 않는 큐 삭제
        │
        └── 메모리 누수 (Erlang 프로세스) ──► 노드 재시작
        │
  3. 장기 조치
        │
        ├── Lazy Queue 적용 (메모리 사용량 안정화)
        ├── vm_memory_high_watermark 조정
        ├── 노드 메모리 증설
        └── 큐를 여러 노드에 분산
```

```bash
# 메모리 사용 현황 (카테고리별)
rabbitmqctl status | grep -A 20 "Memory"

# 큐별 메모리 사용량 확인
rabbitmqctl list_queues name memory messages --sort-by memory --reverse

# 연결별 메모리 사용량 확인
rabbitmqctl list_connections name recv_oct_details.rate send_oct_details.rate memory
```

### 네트워크 파티션 복구 절차

```bash
# 1. 파티션 상태 확인
rabbitmqctl cluster_status
# partitions 항목에 파티션 정보가 표시된다

# 2. pause_minority인 경우: 소수파 노드가 자동 정지 상태
# 네트워크 복구 후 자동으로 재합류한다
# 수동 재시작이 필요한 경우:
rabbitmqctl stop_app
rabbitmqctl start_app

# 3. ignore 전략에서 수동 복구
# 패자 노드를 재설정하여 클러스터에 재합류
rabbitmqctl stop_app
rabbitmqctl reset          # 주의: 이 노드의 데이터가 삭제된다
rabbitmqctl join_cluster rabbit@winner-node
rabbitmqctl start_app

# 4. 파티션 상태 재확인
rabbitmqctl cluster_status
```

### 로그 분석 방법

RabbitMQ 로그 파일 위치와 주요 로그 패턴이다:

```bash
# 로그 파일 위치 (기본)
/var/log/rabbitmq/rabbit@<hostname>.log         # 메인 로그
/var/log/rabbitmq/rabbit@<hostname>_upgrade.log  # 업그레이드 로그

# Docker/Kubernetes에서는 stdout으로 출력
kubectl logs -n demo deploy/rabbitmq -f
```

주요 로그 패턴과 의미:

| 로그 메시지 | 의미 | 대응 |
|------------|------|------|
| `accepting AMQP connection` | 새 클라이언트 연결 수립 | 정상 |
| `closing AMQP connection` | 연결 종료 | 빈번하면 연결 안정성 확인 |
| `missed heartbeats from client` | 클라이언트 heartbeat 미수신 | 네트워크 또는 클라이언트 문제 |
| `Memory high watermark set` | Memory Alarm 발생 | 메모리 확보 필요 |
| `disk free space insufficient` | Disk Alarm 발생 | 디스크 정리 필요 |
| `Mnesia is overloaded` | 메타데이터 DB 과부하 | 큐/바인딩 생성 빈도 줄이기 |
| `file handle limit alarm` | 파일 디스크립터 부족 | ulimit 증가 |

### rabbitmqctl diagnostics 명령어

```bash
# 전체 환경 진단 보고서
rabbitmqctl environment

# 클러스터 상태 (노드, 파티션, 알람)
rabbitmqctl cluster_status

# 노드 상태 상세 (메모리, 디스크, 프로세스, 파일 디스크립터)
rabbitmqctl status

# 메모리 사용 분석 (카테고리별)
rabbitmqctl eval 'rabbit_vm:memory().'

# 큐 목록 (이름, 메시지 수, Consumer 수, 메모리)
rabbitmqctl list_queues name messages consumers memory type

# 연결 목록 (사용자, 상태, 채널 수)
rabbitmqctl list_connections user state channels

# 채널 목록 (Consumer 수, 미확인 메시지 수)
rabbitmqctl list_channels connection consumer_count messages_unacknowledged prefetch_count

# Exchange 목록
rabbitmqctl list_exchanges name type durable auto_delete

# 바인딩 목록
rabbitmqctl list_bindings source_name destination_name routing_key

# 활성화된 플러그인 확인
rabbitmq-plugins list --enabled

# 노드 헬스체크
rabbitmq-diagnostics check_running
rabbitmq-diagnostics check_local_alarms
rabbitmq-diagnostics check_port_connectivity

# Quorum Queue 상태
rabbitmq-queues quorum_status <queue-name>

# 인증서 정보 확인
rabbitmq-diagnostics tls_versions
rabbitmq-diagnostics cipher_suites
```

---

## 실습 (추가)

### 실습 6: DLX 재시도 패턴 구성

```bash
# 1. DLX Exchange 생성
kubectl exec -it -n demo deploy/rabbitmq -- rabbitmqadmin declare exchange \
  name=dlx.retry type=direct durable=true

# 2. 원본 큐 (DLX 설정 포함)
kubectl exec -it -n demo deploy/rabbitmq -- rabbitmqadmin declare queue \
  name=main-work durable=true \
  arguments='{"x-dead-letter-exchange":"dlx.retry","x-dead-letter-routing-key":"retry"}'

# 3. 재시도 큐 (TTL 후 원본으로 복귀)
kubectl exec -it -n demo deploy/rabbitmq -- rabbitmqadmin declare exchange \
  name=main type=direct durable=true
kubectl exec -it -n demo deploy/rabbitmq -- rabbitmqadmin declare queue \
  name=retry-wait durable=true \
  arguments='{"x-dead-letter-exchange":"main","x-dead-letter-routing-key":"work","x-message-ttl":10000}'
kubectl exec -it -n demo deploy/rabbitmq -- rabbitmqadmin declare binding \
  source=dlx.retry destination=retry-wait routing_key=retry
kubectl exec -it -n demo deploy/rabbitmq -- rabbitmqadmin declare binding \
  source=main destination=main-work routing_key=work

# 4. 메시지 발행 후 reject하여 재시도 흐름 관찰
kubectl exec -it -n demo deploy/rabbitmq -- rabbitmqadmin publish \
  exchange=main routing_key=work payload="test retry message"

# 5. Management UI에서 메시지 흐름 관찰 (main-work → retry-wait → main-work)
```

### 실습 7: Topic Exchange 라우팅 테스트

```bash
# 1. Topic Exchange 생성
kubectl exec -it -n demo deploy/rabbitmq -- rabbitmqadmin declare exchange \
  name=events type=topic durable=true

# 2. 패턴별 큐 생성 및 바인딩
kubectl exec -it -n demo deploy/rabbitmq -- rabbitmqadmin declare queue name=order-all durable=true
kubectl exec -it -n demo deploy/rabbitmq -- rabbitmqadmin declare binding \
  source=events destination=order-all routing_key="order.*"

kubectl exec -it -n demo deploy/rabbitmq -- rabbitmqadmin declare queue name=all-critical durable=true
kubectl exec -it -n demo deploy/rabbitmq -- rabbitmqadmin declare binding \
  source=events destination=all-critical routing_key="*.critical"

kubectl exec -it -n demo deploy/rabbitmq -- rabbitmqadmin declare queue name=audit-all durable=true
kubectl exec -it -n demo deploy/rabbitmq -- rabbitmqadmin declare binding \
  source=events destination=audit-all routing_key="#"

# 3. 다양한 routing key로 메시지 발행
kubectl exec -it -n demo deploy/rabbitmq -- rabbitmqadmin publish \
  exchange=events routing_key="order.created" payload="New order"
kubectl exec -it -n demo deploy/rabbitmq -- rabbitmqadmin publish \
  exchange=events routing_key="order.critical" payload="Order critical"
kubectl exec -it -n demo deploy/rabbitmq -- rabbitmqadmin publish \
  exchange=events routing_key="payment.completed" payload="Payment done"

# 4. 각 큐의 메시지 수 확인
kubectl exec -n demo deploy/rabbitmq -- rabbitmqctl list_queues name messages
# 예상: order-all=2, all-critical=1, audit-all=3
```

### 실습 8: Policy 기반 큐 관리

```bash
# 1. 모든 큐에 기본 TTL 정책 적용
kubectl exec -n demo deploy/rabbitmq -- rabbitmqctl set_policy ttl-policy \
  ".*" '{"message-ttl":600000}' --apply-to queues --priority 1

# 2. 특정 큐에 높은 우선순위 정책 적용 (기본 정책 오버라이드)
kubectl exec -n demo deploy/rabbitmq -- rabbitmqctl set_policy critical-policy \
  "^critical\." '{"message-ttl":86400000}' --apply-to queues --priority 10

# 3. 정책 목록 확인
kubectl exec -n demo deploy/rabbitmq -- rabbitmqctl list_policies

# 4. 정책 효과 확인
kubectl exec -n demo deploy/rabbitmq -- rabbitmqctl list_queues name policy effective_policy_definition
```

### 실습 9: 보안 설정 실습

```bash
# 1. 새 vhost 생성
kubectl exec -n demo deploy/rabbitmq -- rabbitmqctl add_vhost /test-app

# 2. 전용 사용자 생성
kubectl exec -n demo deploy/rabbitmq -- rabbitmqctl add_user app-user app-password

# 3. 제한적 권한 부여 (app. 접두사 리소스만)
kubectl exec -n demo deploy/rabbitmq -- rabbitmqctl set_permissions -p /test-app \
  app-user "^app\." "^app\." "^app\."

# 4. 사용자 태그 설정 (Management UI 접근 허용)
kubectl exec -n demo deploy/rabbitmq -- rabbitmqctl set_user_tags app-user management

# 5. 권한 확인
kubectl exec -n demo deploy/rabbitmq -- rabbitmqctl list_user_permissions app-user

# 6. 정리
kubectl exec -n demo deploy/rabbitmq -- rabbitmqctl delete_user app-user
kubectl exec -n demo deploy/rabbitmq -- rabbitmqctl delete_vhost /test-app
```

---

## 예제 (추가)

### 예제 5: RPC 패턴 구현 (Python)

```python
# RPC Server (Python with pika)
import pika
import json

connection = pika.BlockingConnection(pika.ConnectionParameters('localhost'))
channel = connection.channel()

channel.queue_declare(queue='rpc_queue')
channel.basic_qos(prefetch_count=1)

def fibonacci(n):
    if n <= 1:
        return n
    return fibonacci(n - 1) + fibonacci(n - 2)

def on_request(ch, method, props, body):
    n = int(body)
    result = fibonacci(n)

    ch.basic_publish(
        exchange='',
        routing_key=props.reply_to,
        properties=pika.BasicProperties(correlation_id=props.correlation_id),
        body=str(result)
    )
    ch.basic_ack(delivery_tag=method.delivery_tag)

channel.basic_consume(queue='rpc_queue', on_message_callback=on_request)
print("RPC Server 대기 중...")
channel.start_consuming()
```

```python
# RPC Client (Python with pika)
import pika
import uuid

class FibonacciRpcClient:
    def __init__(self):
        self.connection = pika.BlockingConnection(pika.ConnectionParameters('localhost'))
        self.channel = self.connection.channel()

        result = self.channel.queue_declare(queue='', exclusive=True)
        self.callback_queue = result.method.queue

        self.channel.basic_consume(
            queue=self.callback_queue,
            on_message_callback=self.on_response,
            auto_ack=True
        )
        self.response = None
        self.corr_id = None

    def on_response(self, ch, method, props, body):
        if self.corr_id == props.correlation_id:
            self.response = body

    def call(self, n):
        self.response = None
        self.corr_id = str(uuid.uuid4())

        self.channel.basic_publish(
            exchange='',
            routing_key='rpc_queue',
            properties=pika.BasicProperties(
                reply_to=self.callback_queue,
                correlation_id=self.corr_id
            ),
            body=str(n)
        )

        while self.response is None:
            self.connection.process_data_events()

        return int(self.response)

client = FibonacciRpcClient()
result = client.call(30)
print(f"fibonacci(30) = {result}")
```

### 예제 6: Saga Choreography 패턴 (Node.js)

```javascript
// 주문 서비스 - Saga 이벤트 처리
const EXCHANGE = 'saga.events';

async function setupOrderSaga() {
  const channel = await connection.createChannel();
  await channel.assertExchange(EXCHANGE, 'topic', { durable: true });

  // 주문 서비스 이벤트 큐
  await channel.assertQueue('order-saga-events', { durable: true });
  await channel.bindQueue('order-saga-events', EXCHANGE, 'payment.*');
  await channel.bindQueue('order-saga-events', EXCHANGE, 'inventory.*');

  channel.prefetch(1);
  channel.consume('order-saga-events', async (msg) => {
    const event = JSON.parse(msg.content.toString());
    const orderId = event.orderId;

    switch (event.type) {
      case 'payment.succeeded':
        await updateOrder(orderId, 'PAID');
        // 재고 예약 요청 이벤트 발행
        channel.publish(EXCHANGE, 'inventory.reserve',
          Buffer.from(JSON.stringify({ orderId, items: event.items })),
          { persistent: true, correlationId: orderId });
        break;

      case 'payment.failed':
        await updateOrder(orderId, 'PAYMENT_FAILED');
        // 보상 트랜잭션: 주문 취소
        channel.publish(EXCHANGE, 'order.cancelled',
          Buffer.from(JSON.stringify({ orderId, reason: 'payment_failed' })),
          { persistent: true });
        break;

      case 'inventory.reserved':
        await updateOrder(orderId, 'CONFIRMED');
        channel.publish(EXCHANGE, 'order.confirmed',
          Buffer.from(JSON.stringify({ orderId })),
          { persistent: true });
        break;

      case 'inventory.insufficient':
        await updateOrder(orderId, 'OUT_OF_STOCK');
        // 보상 트랜잭션: 결제 환불 요청
        channel.publish(EXCHANGE, 'payment.refund',
          Buffer.from(JSON.stringify({ orderId, reason: 'out_of_stock' })),
          { persistent: true });
        break;
    }
    channel.ack(msg);
  });
}
```

---

## 자가 점검

### 기초 개념
- [ ] 메시지 큐가 왜 필요한지 (동기 vs 비동기)를 설명할 수 있는가?
- [ ] AMQP 0-9-1 프로토콜의 Connection → Channel → Exchange/Queue 계층 구조를 설명할 수 있는가?
- [ ] Exchange, Queue, Binding의 관계를 설명할 수 있는가?
- [ ] Direct, Fanout, Topic, Headers Exchange의 차이와 각각의 사용 사례를 설명할 수 있는가?
- [ ] Default Exchange의 동작 방식을 설명할 수 있는가?
- [ ] Auto Ack와 Manual Ack의 차이와 위험성을 설명할 수 있는가?
- [ ] Publisher Confirms의 필요성과 동작 방식을 설명할 수 있는가?
- [ ] Consumer Prefetch(QoS)가 부하 분산에 미치는 영향을 설명할 수 있는가?
- [ ] 메시지 영속성을 위해 Exchange, Queue, Message 각각에 필요한 설정을 알고 있는가?
- [ ] Dead Letter Exchange의 트리거 조건 세 가지를 설명할 수 있는가?
- [ ] Classic Queue, Quorum Queue, Stream의 차이를 설명할 수 있는가?
- [ ] 클러스터 네트워크 파티션 처리 전략(pause_minority, autoheal)을 설명할 수 있는가?
- [ ] Flow Control과 Memory/Disk Alarm의 역할을 설명할 수 있는가?

### 프로토콜 심화
- [ ] AMQP 0-9-1의 네 가지 Frame 유형(Method, Content Header, Content Body, Heartbeat)의 구조와 역할을 설명할 수 있는가?
- [ ] Connection 핸드셰이크의 전체 시퀀스를 Protocol Header부터 Channel.Open-Ok까지 설명할 수 있는가?
- [ ] Channel 멀티플렉싱이 어떻게 동작하는지, 그리고 왜 Channel이 쓰레드 세이프하지 않은지 설명할 수 있는가?
- [ ] Heartbeat 타임아웃이 어떻게 계산되고, 일반 데이터 프레임도 heartbeat 역할을 하는지 설명할 수 있는가?
- [ ] Content Body Frame 분할이 발생하는 조건과 frame_max 협상 과정을 설명할 수 있는가?

### Exchange/Queue 심화
- [ ] Topic Exchange의 Trie 기반 패턴 매칭 알고리즘에서 `*`와 `#`의 매칭 차이를 구체적 예시로 설명할 수 있는가?
- [ ] Alternate Exchange와 mandatory 플래그의 차이를 설명하고, 각각의 적합한 사용 시나리오를 제시할 수 있는가?
- [ ] Consistent Hash Exchange의 키 어피니티(affinity)와 가중치 기반 분배 메커니즘을 설명할 수 있는가?
- [ ] Exchange-to-Exchange 바인딩을 사용하여 계층적 라우팅 토폴로지를 구성하는 방법을 설명할 수 있는가?
- [ ] Quorum Queue의 Raft Leader Election 과정(Follower → Candidate → Leader)을 단계별로 설명할 수 있는가?
- [ ] Stream Queue의 세그먼트 구조와 offset 기반 소비에서 Consumer 재시작 시 offset을 관리하는 세 가지 방법을 설명할 수 있는가?
- [ ] Priority Queue에서 prefetch 값이 우선순위 효과에 미치는 영향을 설명할 수 있는가?

### 메시지 라이프사이클
- [ ] Per-Message TTL과 Per-Queue TTL의 만료 메시지 처리 타이밍 차이를 설명할 수 있는가?
- [ ] Publisher Confirms의 sync/async/batch 세 가지 방식의 차이와 각각의 처리량 특성을 설명할 수 있는가?
- [ ] `user_id` 속성의 브로커 측 검증 메커니즘을 설명할 수 있는가?
- [ ] DLX 체인을 활용한 지수 백오프(exponential backoff) 재시도 패턴을 설계할 수 있는가?

### 클러스터/HA/보안
- [ ] Erlang Cookie와 epmd의 역할, 그리고 클러스터 노드 간 연결 수립 과정을 설명할 수 있는가?
- [ ] Disc Node와 RAM Node의 차이와 현재의 권장 사항을 설명할 수 있는가?
- [ ] 전체 클러스터 장애 시 복구 절차에서 "마지막에 종료된 노드를 먼저 시작"하는 이유를 설명할 수 있는가?
- [ ] Federation과 Shovel의 차이를 비교하고, Multi-DC 환경에서 어떤 경우에 각각을 선택하는지 설명할 수 있는가?
- [ ] SASL EXTERNAL 인증과 Mutual TLS를 조합하여 비밀번호 없는 인증을 구성하는 방법을 설명할 수 있는가?
- [ ] OAuth 2.0 JWT 토큰의 scope 클레임이 RabbitMQ 권한에 어떻게 매핑되는지 설명할 수 있는가?

### 운영/성능
- [ ] Erlang VM 튜닝 파라미터 +P, +A, +K의 역할과 적정 값을 설명할 수 있는가?
- [ ] Consumer별 적정 prefetch 값을 산정하는 공식과 모니터링 지표를 설명할 수 있는가?
- [ ] Memory Alarm 발생 시 원인 분석 절차와 즉시 대응 방법을 설명할 수 있는가?
- [ ] Prometheus 메트릭 기반 Grafana 대시보드에서 반드시 포함해야 하는 패널 5가지를 나열할 수 있는가?
- [ ] 네트워크 파티션이 발생했을 때 `rabbitmqctl cluster_status`로 파티션을 확인하고 복구하는 절차를 설명할 수 있는가?
- [ ] RPC 패턴에서 correlation_id와 reply_to의 역할을 설명할 수 있는가?
- [ ] Saga Choreography 패턴에서 보상 트랜잭션(compensation transaction)이 필요한 시나리오를 설명할 수 있는가?

---

## 참고문헌
- [RabbitMQ 공식 문서](https://www.rabbitmq.com/docs) - 전체 기능 레퍼런스, 튜토리얼, 운영 가이드를 포함한다
- [RabbitMQ GitHub 저장소](https://github.com/rabbitmq/rabbitmq-server) - 소스 코드, 이슈 트래커, 릴리스 노트를 확인할 수 있다
- [AMQP 0-9-1 Complete Reference](https://www.rabbitmq.com/docs/amqp-0-9-1-reference) - AMQP 0-9-1 프로토콜의 모든 메서드와 속성을 정의한다
- [RabbitMQ Tutorials](https://www.rabbitmq.com/tutorials) - "Hello World", Work Queues, Pub/Sub 등 단계별 튜토리얼이다
- [Quorum Queues](https://www.rabbitmq.com/docs/quorum-queues) - Raft 기반 복제 큐의 설계와 운영 가이드이다
- [Streams](https://www.rabbitmq.com/docs/streams) - append-only 로그 기반 큐의 개념과 사용법이다
- [Clustering Guide](https://www.rabbitmq.com/docs/clustering) - 클러스터 구성, 노드 관리, 네트워크 파티션 처리 전략을 다룬다
- [Publisher Confirms](https://www.rabbitmq.com/docs/confirms) - Publisher Confirms와 Consumer Acknowledgment의 상세 동작이다
- [Dead Lettering](https://www.rabbitmq.com/docs/dlx) - DLX 설정과 재시도 패턴 구현 가이드이다
- [Production Checklist](https://www.rabbitmq.com/docs/production-checklist) - 프로덕션 배포 시 점검해야 할 항목 목록이다
- [Monitoring](https://www.rabbitmq.com/docs/monitoring) - Management Plugin, Prometheus 통합, 핵심 모니터링 지표를 다룬다
- [TLS Support](https://www.rabbitmq.com/docs/ssl) - TLS/SSL 설정, 인증서 관리, 암호화 스위트 구성 가이드이다
- [Access Control](https://www.rabbitmq.com/docs/access-control) - 사용자, vhost, 권한, OAuth 2.0 인증 가이드이다
- [Federation Plugin](https://www.rabbitmq.com/docs/federation) - 지리적 분산 환경의 Federation 구성 가이드이다
- [Shovel Plugin](https://www.rabbitmq.com/docs/shovel) - 클러스터 간 메시지 전달 플러그인 가이드이다
- [Memory and Disk Alarms](https://www.rabbitmq.com/docs/alarms) - 메모리/디스크 알람 메커니즘과 임계값 조정 가이드이다
- [Lazy Queues](https://www.rabbitmq.com/docs/lazy-queues) - Lazy Queue 모드의 동작과 성능 특성이다
