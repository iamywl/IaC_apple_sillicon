# Day 6: 고가용성, 성능 튜닝, 모니터링

> Quorum Queue 기반 HA 패턴, Federation/Shovel, 성능 튜닝(메모리, 디스크, Prefetch), Prometheus/Grafana 모니터링을 학습한다.

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

