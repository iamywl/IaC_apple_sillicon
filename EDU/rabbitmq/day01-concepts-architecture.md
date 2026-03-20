# Day 1: RabbitMQ 개념 및 아키텍처

> RabbitMQ의 기본 개념, Erlang/OTP 런타임, 노드 구조, AMQP 메시지 흐름, Exchange/Queue/Binding의 관계를 학습한다.

---

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

