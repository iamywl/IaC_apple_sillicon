# Day 2: 기본 실습 및 예제

> RabbitMQ 기본 실습(관리 콘솔, CLI, 메시지 발행/소비)과 Kubernetes 배포 매니페스트, 애플리케이션 연동 예제를 학습한다.

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

