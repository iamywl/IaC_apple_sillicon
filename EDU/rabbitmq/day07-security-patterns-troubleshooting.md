# Day 7: 보안, 메시징 패턴, 트러블슈팅, 실습 및 자가 점검

> TLS/SASL 보안 설정, 주요 메시징 패턴(Work Queue, Pub/Sub, RPC 등), 트러블슈팅 기법, 추가 실습/예제, 자가 점검 문항, 참고문헌을 다룬다.

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
