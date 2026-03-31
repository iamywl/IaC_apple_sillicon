# RabbitMQ - 메시지 큐 브로커

## 학습 가이드

RabbitMQ의 기본 개념부터 운영 실무까지 7일 과정으로 구성된 학습 가이드이다. AMQP 프로토콜, Exchange/Queue 타입, 클러스터링, 고가용성, 성능 튜닝, 보안 등을 체계적으로 학습할 수 있다.

### 학습 일정

| Day | 주제 | 파일 | 핵심 내용 |
|-----|------|------|----------|
| 1 | RabbitMQ 개념 및 아키텍처 | [day01-concepts-architecture.md](day01-concepts-architecture.md) | Erlang/OTP 런타임, 노드 구조, Connection/Channel, Exchange/Queue/Binding, 메시지 흐름 |
| 2 | 기본 실습 및 예제 | [day02-basic-labs-examples.md](day02-basic-labs-examples.md) | 관리 콘솔, CLI 명령어, Kubernetes 배포, 애플리케이션 연동 예제 |
| 3 | AMQP 0-9-1 프로토콜 심화 | [day03-amqp-protocol.md](day03-amqp-protocol.md) | 프레임 구조, 연결/채널 관리, QoS Prefetch, Publisher Confirms, Consumer Ack |
| 4 | Exchange/Queue 타입 및 메시지 라이프사이클 | [day04-exchange-queue-lifecycle.md](day04-exchange-queue-lifecycle.md) | Direct/Fanout/Topic/Headers Exchange, Classic/Quorum/Stream Queue, DLX, TTL |
| 5 | 메시지 라이프사이클 및 클러스터링 | [day05-message-lifecycle-clustering.md](day05-message-lifecycle-clustering.md) | 메시지 발행~소비 상세, Priority Queue, Lazy Queue, Raft 합의, 노드 관리 |
| 6 | 고가용성, 성능 튜닝, 모니터링 | [day06-ha-tuning-monitoring.md](day06-ha-tuning-monitoring.md) | Quorum Queue HA, Federation/Shovel, 메모리/디스크 튜닝, Prometheus/Grafana |
| 7 | 보안, 메시징 패턴, 트러블슈팅, 자가 점검 | [day07-security-patterns-troubleshooting.md](day07-security-patterns-troubleshooting.md) | TLS/SASL, Work Queue/Pub-Sub/RPC 패턴, 트러블슈팅, 추가 실습, 자가 점검 |

### 학습 방법

1. Day 1부터 순서대로 학습하는 것을 권장한다. 각 Day는 이전 Day의 내용을 기반으로 한다.
2. Day 2의 실습을 먼저 완료하면 이후 심화 내용의 이해가 수월해진다.
3. Day 7의 자가 점검 문항으로 전체 학습 내용을 복습한다.

### 전체 구성

- **Day 1~2**: 기초 (개념, 아키텍처, 기본 실습)
- **Day 3~4**: 프로토콜 및 핵심 컴포넌트 (AMQP, Exchange, Queue)
- **Day 5~6**: 운영 (클러스터링, HA, 성능 튜닝, 모니터링)
- **Day 7**: 종합 (보안, 패턴, 트러블슈팅, 자가 점검)
