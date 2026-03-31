# Day 3: AMQP 0-9-1 프로토콜 심화

> AMQP 프로토콜의 연결/채널 관리, 프레임 구조, QoS(Prefetch), Publisher Confirms, Consumer Ack 등 핵심 메커니즘을 심층 학습한다.

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

