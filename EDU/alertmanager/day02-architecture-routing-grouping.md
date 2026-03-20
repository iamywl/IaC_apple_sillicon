# Day 2: 아키텍처 심화, Routing 심화, Grouping 심화

> 이 문서에서는 AlertManager의 전체 알림 처리 파이프라인 상세, 내부 데이터 구조(Alert 구조체, Fingerprint), Alert 상태 머신, Route Tree의 DFS 기반 매칭, group_by 동작 상세, active/mute time_intervals, 라우팅 설계 패턴, Grouping 타이머 타임라인 다이어그램을 다룬다.

---

## AlertManager 아키텍처 심화

### 전체 알림 처리 파이프라인 상세

AlertManager 내부의 알림 처리는 여러 컴포넌트가 순차적으로 동작하는 파이프라인 구조이다. 각 단계의 역할과 동작을 상세히 이해하면 알림 시스템의 문제를 정확하게 진단할 수 있다.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                    AlertManager 내부 파이프라인 상세                          │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Prometheus ──HTTP POST──► Alert Provider (API)                              │
│                                  │                                           │
│                                  ▼                                           │
│                           ┌─────────────┐                                    │
│                           │  Dispatcher  │                                   │
│                           └──────┬──────┘                                    │
│                                  │  Route Tree DFS 매칭                      │
│                                  │  group_by 기준으로 Aggregation Group 생성  │
│                                  ▼                                           │
│                       ┌───────────────────┐                                  │
│                       │ Aggregation Group  │ (group_wait / group_interval     │
│                       │     Manager        │  / repeat_interval 타이머 관리)  │
│                       └────────┬──────────┘                                  │
│                                │                                             │
│                                ▼                                             │
│                    ┌──────────────────────┐                                   │
│                    │ Notification Pipeline │                                  │
│                    │                      │                                   │
│                    │  1. Inhibitor ───────┤ source alert가 firing이면          │
│                    │     (억제 판정)       │ target alert 제거                 │
│                    │                      │                                   │
│                    │  2. Silencer ────────┤ 활성 Silence에 매칭되면            │
│                    │     (침묵 판정)       │ 해당 alert 제거                   │
│                    │                      │                                   │
│                    │  3. Deduplication ───┤ Notification Log 조회,             │
│                    │     (중복 제거)       │ 이미 전송된 알림 스킵              │
│                    │                      │                                   │
│                    │  4. Template ────────┤ Go template으로                   │
│                    │     Rendering         │ 메시지 렌더링                     │
│                    │                      │                                   │
│                    │  5. Retry Logic ─────┤ 전송 실패 시 지수 백오프           │
│                    │                      │ 재시도                            │
│                    │                      │                                   │
│                    │  6. Notification ────┤ 전송 결과를                       │
│                    │     Log 기록          │ Notification Log에 기록           │
│                    └──────────┬───────────┘                                   │
│                               │                                              │
│                               ▼                                              │
│                          Receiver                                            │
│                    (Slack, PagerDuty, Email 등)                               │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Alert Provider (API 수신)**

AlertManager는 `/api/v2/alerts` 엔드포인트를 통해 Prometheus(또는 다른 Alert Provider)로부터 알림을 수신한다. 수신된 알림은 내부 Alert Store에 저장되며, `startsAt`과 `endsAt` 타임스탬프를 기반으로 알림의 활성 상태를 관리한다. Prometheus는 매 evaluation interval(기본 15초 또는 1분)마다 firing 상태인 알림을 반복적으로 전송하므로, AlertManager는 fingerprint를 기준으로 기존 알림을 갱신하거나 새 알림을 등록한다.

**Dispatcher (디스패처)**

Dispatcher는 Alert Store에서 알림을 수신하면 Route Tree를 DFS(깊이 우선 탐색)로 순회하여 매칭되는 route를 결정한다. 매칭된 route의 `group_by` 설정에 따라 알림을 Aggregation Group으로 분류한다. 각 Aggregation Group은 고유한 타이머 세트(`group_wait`, `group_interval`, `repeat_interval`)를 독립적으로 관리한다. 타이머가 만료되면 해당 그룹의 알림을 Notification Pipeline으로 전달한다.

**Notification Pipeline (알림 파이프라인)**

Notification Pipeline은 실제 알림 전송 전에 다수의 필터링 단계를 수행한다. Inhibitor가 먼저 억제 대상 알림을 제거하고, Silencer가 침묵 대상 알림을 제거한다. 그 다음 Notification Log를 조회하여 이미 전송된 알림인지 확인(Deduplication)한 뒤, 최종적으로 남은 알림에 대해 Template Rendering을 수행하고 Receiver로 전송한다.

**Notification Log (알림 전송 기록)**

Notification Log는 어떤 알림 그룹이 어떤 receiver에게 언제 전송되었는지를 기록하는 내부 저장소이다. 이 로그는 HA 클러스터 환경에서 Gossip 프로토콜을 통해 모든 인스턴스 간에 공유된다. Deduplication 단계에서 이 로그를 조회하여, 동일한 알림이 다른 인스턴스에서 이미 전송되었다면 중복 전송을 방지한다. Notification Log는 `repeat_interval` 판단에도 사용되며, 마지막 전송 시각이 `repeat_interval` 이내이면 재전송하지 않는다.

### 내부 데이터 구조: Alert 구조체

AlertManager 내부에서 알림은 다음과 같은 구조체로 표현된다.

```go
// 단순화된 Alert 구조체
type Alert struct {
    // Labels: 알림을 고유하게 식별하는 label set이다
    // routing, grouping, inhibition, silencing 모두 labels를 기준으로 동작한다
    Labels LabelSet

    // Annotations: 알림의 부가 정보이다 (summary, description, runbook_url 등)
    // routing이나 grouping에 사용되지 않으며, 순수하게 사람이 읽기 위한 정보이다
    Annotations LabelSet

    // StartsAt: 알림이 최초로 firing된 시각이다
    // Prometheus가 alerting rule의 for 기간을 만족했을 때의 시각이다
    StartsAt time.Time

    // EndsAt: 알림이 resolved된 시각이다
    // firing 상태에서는 "현재 시각 + 일정 시간" 으로 설정되어 있다
    // Prometheus가 지속적으로 알림을 전송하면 EndsAt이 계속 갱신된다
    // EndsAt이 현재 시각보다 이전이면 알림은 resolved 상태가 된다
    EndsAt time.Time

    // GeneratorURL: 알림을 생성한 Prometheus의 expression browser URL이다
    // 예: http://prometheus:9090/graph?g0.expr=up%3D%3D0&g0.tab=1
    GeneratorURL string

    // Fingerprint: labels의 해시값으로 계산되는 고유 식별자이다
    // 중복 제거(deduplication)의 핵심 기준이다
    Fingerprint Fingerprint

    // UpdatedAt: 이 알림이 마지막으로 갱신된 시각이다
    UpdatedAt time.Time

    // Timeout: true이면 EndsAt이 현재 시각을 초과하여 자동으로 resolved 처리된 것이다
    Timeout bool
}
```

각 필드의 역할을 정확히 이해하는 것이 중요하다.

| 필드 | 유형 | Routing에 사용 | Grouping에 사용 | 사용 목적 |
|------|------|:-:|:-:|------|
| Labels | LabelSet | O | O | 알림의 식별, 라우팅, 그룹핑, 억제, 침묵에 사용된다 |
| Annotations | LabelSet | X | X | 사람이 읽을 부가 정보이다 (summary, description, runbook_url) |
| StartsAt | time.Time | X | X | 알림 발생 시각이다 |
| EndsAt | time.Time | X | X | 알림 해소 시각 또는 예상 만료 시각이다 |
| GeneratorURL | string | X | X | 알림을 생성한 Prometheus의 expression browser 링크이다 |
| Fingerprint | Fingerprint | X | X | label set의 해시로, 중복 제거에 사용된다 |

### Fingerprint 계산

Fingerprint는 알림의 label set을 해시하여 생성되는 고유 식별자이다. 동일한 label set을 가진 알림은 항상 동일한 fingerprint를 가진다. 이 메커니즘이 AlertManager의 중복 제거(Deduplication)의 핵심이다.

```
Labels: {alertname="HighCPU", instance="node-1", severity="critical"}
        ↓
    label key 정렬: alertname, instance, severity
        ↓
    각 key=value 쌍의 해시 계산
        ↓
    전체 해시 결합
        ↓
Fingerprint: 0x7a3b2c1d (고유 식별자)
```

Fingerprint 계산에 포함되는 것은 **Labels만**이다. Annotations, StartsAt, EndsAt 등은 포함되지 않는다. 따라서 동일한 label set을 가진 알림은 annotations이 다르더라도 같은 fingerprint를 가지며, AlertManager는 이를 동일한 알림으로 취급한다.

이 설계의 의미는 다음과 같다:
- Labels는 알림의 **정체성(identity)**을 정의한다. 어떤 알림인지, 어디서 발생했는지를 나타낸다.
- Annotations는 알림의 **설명(description)**을 제공한다. 현재 값이나 대응 방법 같은 부가 정보이다.
- 따라서 Labels는 가능한 고정적(static)이어야 하고, 동적으로 변하는 값은 Annotations에 넣어야 한다.

```yaml
# 잘못된 예: 동적 값을 label에 넣으면 매번 다른 fingerprint가 생성된다
- alert: HighCPU
  expr: node_cpu_usage > 80
  labels:
    severity: warning
    current_value: "{{ $value }}"    # 잘못됨! 매번 값이 변하므로 중복 제거 불가

# 올바른 예: 동적 값은 annotation에 넣는다
- alert: HighCPU
  expr: node_cpu_usage > 80
  labels:
    severity: warning
  annotations:
    current_value: "{{ $value }}"    # annotation은 fingerprint에 포함되지 않는다
```

### Alert 상태 머신

AlertManager 내부에서 알림은 세 가지 상태를 가진다.

```
                  ┌─────────────────────────────┐
                  │                             │
                  ▼                             │
            ┌──────────┐                        │
    ──────► │  Active   │──── Inhibit Rule ────► │
   알림 수신  │ (활성)    │     매칭              │
            └────┬─────┘                        │
                 │                         ┌────┴──────┐
                 │                         │ Suppressed │
                 │                         │  (억제됨)   │
                 │                         └────┬──────┘
                 │                              │
                 │    Silence 매칭 ──────────────┘
                 │
                 │   EndsAt < 현재시각
                 │   (Prometheus가 알림 전송 중단)
                 │
                 ▼
            ┌──────────┐
            │ Resolved  │
            │  (해소됨)  │
            └──────────┘
```

**Active (활성)**

알림의 `EndsAt`이 현재 시각보다 미래이고, 어떤 Inhibition Rule이나 Silence에도 매칭되지 않는 상태이다. 이 상태의 알림만 Notification Pipeline을 통해 실제로 전송된다.

**Suppressed (억제됨)**

알림이 firing 상태이지만, Inhibition Rule 또는 Silence에 의해 전송이 억제된 상태이다. 억제 조건이 해소되면(source alert가 resolved되거나 Silence가 만료되면) 다시 Active 상태로 전환된다. AlertManager UI에서 "Suppressed" 상태로 표시된다.

**Resolved (해소됨)**

알림의 `EndsAt`이 현재 시각보다 과거인 상태이다. Prometheus가 alerting rule의 조건이 더 이상 충족되지 않으면 알림 전송을 중단한다. AlertManager는 Prometheus로부터 마지막으로 수신한 알림의 `EndsAt` 시각이 지나면 해당 알림을 resolved로 처리한다. `send_resolved: true`가 설정된 receiver는 이 시점에 resolved 알림을 전송한다.

**상태 전환 조건 정리**

| 전환 | 조건 |
|------|------|
| → Active | 새 알림 수신, 또는 억제 조건 해소 |
| Active → Suppressed | Inhibition Rule 또는 Silence 매칭 |
| Suppressed → Active | source alert resolved 또는 Silence 만료 |
| Active → Resolved | `EndsAt` < 현재 시각 (Prometheus가 전송 중단) |
| Suppressed → Resolved | 억제 상태에서도 `EndsAt` < 현재 시각이면 resolved |

---

## Routing 심화

### Routing Tree 내부 동작: DFS 기반 매칭

AlertManager의 Route Tree는 DFS(깊이 우선 탐색, Depth-First Search)를 기반으로 동작한다. 알림이 도착하면 root route에서 시작하여 자식 route를 순서대로 탐색한다.

```
[Root Route] receiver=default, group_by=[alertname]
    │
    ├── [Route 1] match: severity=critical, receiver=pagerduty
    │       │
    │       ├── [Route 1-1] match: team=platform, receiver=platform-pd
    │       │
    │       └── [Route 1-2] match: team=backend, receiver=backend-pd
    │
    ├── [Route 2] match: severity=warning, receiver=slack-warning, continue=true
    │
    └── [Route 3] match_re: team="(platform|infra)", receiver=platform-slack
```

**DFS 매칭 알고리즘 (의사 코드)**

```
함수 findMatchingRoute(alert, route):
    if route가 alert에 매칭되지 않으면:
        return null

    // route가 매칭됨
    matchedRoute = route

    for child in route.children:
        childMatch = findMatchingRoute(alert, child)
        if childMatch != null:
            matchedRoute = childMatch
            if child.continue == false:
                break    // 첫 번째 매칭에서 탐색 중단
            // continue == true이면 다음 sibling도 계속 탐색

    return matchedRoute
```

핵심 동작 원리는 다음과 같다:
1. Root route는 **항상** 매칭된다 (match 조건 없음).
2. 자식 route는 위에서 아래로 순서대로 탐색된다.
3. 자식 route에 매칭되면, 해당 자식의 하위 route를 다시 DFS로 탐색한다.
4. `continue: false`(기본값)이면 첫 번째 매칭에서 탐색을 중단한다.
5. `continue: true`이면 매칭 후에도 다음 sibling route를 계속 탐색한다.
6. 어떤 자식 route에도 매칭되지 않으면 부모 route의 receiver가 사용된다.

### match vs match_re 성능 차이

`match`와 `match_re`는 기능적으로 다른 매칭 방식이다.

| 비교 항목 | match (정확 매칭) | match_re (정규식 매칭) |
|-----------|---|---|
| 매칭 방식 | 문자열 비교 (equality) | 정규식 패턴 매칭 |
| 성능 | O(1) - 단순 문자열 비교 | O(n) - 정규식 엔진 실행 |
| 사용 예 | `severity: critical` | `team: '^(platform\|infra)$'` |
| 적합한 상황 | 값이 고정적일 때 | 여러 값을 하나의 규칙으로 매칭할 때 |

성능 관점에서 `match`가 `match_re`보다 항상 빠르다. 라우팅 트리의 상단에는 가능한 `match`를 사용하고, 정규식이 필요한 경우에만 `match_re`를 사용하는 것이 권장된다. 단, 일반적인 규모의 알림 환경에서 이 성능 차이가 체감될 정도로 크지는 않다.

> 참고: AlertManager 0.22.0 이상에서는 `match`/`match_re` 대신 `matchers` 문법이 권장된다. `matchers`는 PromQL 스타일의 label matcher를 사용한다.

```yaml
# 이전 방식 (deprecated)
routes:
  - match:
      severity: critical
    receiver: pagerduty

# 새 방식 (0.22.0+)
routes:
  - matchers:
      - severity = critical      # 정확 매칭
    receiver: pagerduty
  - matchers:
      - team =~ "platform|infra" # 정규식 매칭
    receiver: platform-slack
  - matchers:
      - severity != info         # 부정 매칭
    receiver: not-info
```

### continue 플래그의 정확한 의미와 사용 패턴

`continue` 플래그는 알림이 특정 route에 매칭된 후에도 같은 레벨의 다음 sibling route를 계속 탐색할지 결정한다.

**continue: false (기본값)**

```yaml
routes:
  - match: { severity: critical }
    receiver: pagerduty         # 매칭됨 → 여기서 탐색 종료
  - match: { severity: critical }
    receiver: slack-critical    # 도달하지 않음
```

**continue: true**

```yaml
routes:
  - match: { severity: critical }
    receiver: pagerduty
    continue: true              # 매칭되었지만 다음 route 계속 탐색
  - match: { severity: critical }
    receiver: slack-critical    # 이 route도 매칭됨
```

`continue: true`의 주요 사용 패턴:

1. **다중 채널 알림**: 하나의 알림을 여러 receiver에 동시에 전송한다.
2. **로깅 + 알림**: 첫 번째 route에서 webhook으로 로깅하고, 두 번째 route에서 실제 알림을 전송한다.
3. **팀별 + 글로벌 알림**: 특정 팀 채널과 글로벌 모니터링 채널 모두에 전송한다.

```yaml
# 실전 예시: critical 알림을 PagerDuty와 Slack 모두에 전송
routes:
  - match: { severity: critical }
    receiver: pagerduty
    continue: true               # PagerDuty로 전송 후 다음 route도 탐색
  - match: { severity: critical }
    receiver: slack-critical     # Slack에도 전송
  - match: { severity: warning }
    receiver: slack-warning
```

### group_by의 동작 상세

`group_by`는 알림을 그룹으로 묶는 기준 label 목록이다. 세 가지 설정 방식이 있다.

**1. 특정 label로 그룹핑: `group_by: ['alertname', 'namespace']`**

지정된 label의 값이 동일한 알림들이 하나의 그룹이 된다.

```
알림 A: {alertname="HighCPU", namespace="prod", pod="api-1"}
알림 B: {alertname="HighCPU", namespace="prod", pod="api-2"}
알림 C: {alertname="HighCPU", namespace="dev",  pod="api-3"}
알림 D: {alertname="HighMem", namespace="prod", pod="api-1"}

결과:
  그룹 1 (alertname=HighCPU, namespace=prod): 알림 A, B
  그룹 2 (alertname=HighCPU, namespace=dev):  알림 C
  그룹 3 (alertname=HighMem, namespace=prod): 알림 D
```

**2. 모든 label로 그룹핑: `group_by: ['...']`**

`'...'`은 특수한 값으로, 모든 label을 기준으로 그룹핑한다. label set이 완전히 동일한 알림만 같은 그룹이 된다. 사실상 그룹핑을 비활성화하는 효과이며, 각 알림이 개별적으로 전송된다.

```
알림 A: {alertname="HighCPU", namespace="prod", pod="api-1"}
알림 B: {alertname="HighCPU", namespace="prod", pod="api-2"}

결과: label set이 다르므로(pod가 다름) 각각 별도의 그룹
  그룹 1: 알림 A (단독)
  그룹 2: 알림 B (단독)
```

이 설정은 각 알림을 개별적으로 전송해야 하는 경우(예: PagerDuty 인시던트를 알림별로 생성할 때)에 유용하다.

**3. 그룹핑 안 함: `group_by: []`**

빈 배열이면 해당 route에 매칭되는 모든 알림이 하나의 그룹으로 합쳐진다. 클러스터 전체의 알림을 하나의 요약 메시지로 전송하고 싶을 때 사용한다.

```
알림 A: {alertname="HighCPU", namespace="prod", pod="api-1"}
알림 B: {alertname="HighMem", namespace="dev",  pod="db-1"}

결과: 모든 알림이 하나의 그룹
  그룹 1: 알림 A, B (함께 전송)
```

### active_time_intervals / mute_time_intervals 활용

AlertManager 0.24.0부터 시간 기반 알림 제어를 위한 `time_intervals`가 도입되었다.

```yaml
# 시간 간격 정의
time_intervals:
  - name: business-hours
    time_intervals:
      - times:
          - start_time: '09:00'
            end_time: '18:00'
        weekdays: ['monday:friday']
        location: 'Asia/Seoul'

  - name: weekends
    time_intervals:
      - times:
          - start_time: '00:00'
            end_time: '24:00'
        weekdays: ['saturday', 'sunday']
        location: 'Asia/Seoul'

  - name: maintenance-window
    time_intervals:
      - times:
          - start_time: '02:00'
            end_time: '04:00'
        weekdays: ['wednesday']
        location: 'Asia/Seoul'

route:
  receiver: default
  routes:
    # 업무 시간에만 warning 알림 전송
    - matchers:
        - severity = warning
      receiver: slack-warning
      active_time_intervals:
        - business-hours         # 이 시간대에만 알림 활성

    # 유지보수 시간에는 알림 음소거
    - matchers:
        - severity = warning
      receiver: slack-warning
      mute_time_intervals:
        - maintenance-window     # 이 시간대에는 알림 억제
```

**active_time_intervals**: 지정된 시간대에만 알림을 전송한다. 시간대 밖에서는 알림이 억제된다.
**mute_time_intervals**: 지정된 시간대에는 알림을 억제한다. 시간대 밖에서는 정상 전송된다.

둘은 반대 개념이다. `active_time_intervals`은 "이 시간에만 보내라", `mute_time_intervals`은 "이 시간에는 보내지 마라"이다.

### 라우팅 테스트: amtool config routes test

설정한 라우팅 트리가 의도대로 동작하는지 검증하는 것은 매우 중요하다. `amtool`을 사용하면 특정 label set이 어떤 receiver로 라우팅되는지 테스트할 수 있다.

```bash
# 라우팅 트리 전체 구조 시각화
amtool config routes show --config.file=alertmanager.yml

# 출력 예시:
# Routing tree:
# └── default-route  receiver: default  group_by: [alertname, namespace]
#     ├── {severity="critical"}  receiver: pagerduty
#     │   ├── {team="platform"}  receiver: platform-pd
#     │   └── {team="backend"}  receiver: backend-pd
#     ├── {severity="warning"}  continue: true  receiver: slack-warning
#     └── {team=~"^(platform|infra)$"}  receiver: platform-slack

# 특정 label set의 라우팅 결과 테스트
amtool config routes test-routing --config.file=alertmanager.yml \
  severity=critical team=platform alertname=NodeDown

# 출력: platform-pd

amtool config routes test-routing --config.file=alertmanager.yml \
  severity=warning alertname=HighCPU

# 출력: slack-warning
```

### 복잡한 라우팅 트리 설계 패턴

실무에서 자주 사용되는 라우팅 트리 패턴 몇 가지를 소개한다.

**패턴 1: Severity 기반 다중 채널**

```yaml
route:
  receiver: default
  group_by: ['alertname', 'namespace']
  routes:
    - matchers: [severity = critical]
      receiver: pagerduty
      continue: true
    - matchers: [severity = critical]
      receiver: slack-critical
    - matchers: [severity = warning]
      receiver: slack-warning
    - matchers: [severity = info]
      receiver: slack-info
```

**패턴 2: 팀별 라우팅**

```yaml
route:
  receiver: default
  group_by: ['alertname']
  routes:
    - matchers: [team = platform]
      receiver: platform-slack
      routes:
        - matchers: [severity = critical]
          receiver: platform-pagerduty
    - matchers: [team = backend]
      receiver: backend-slack
      routes:
        - matchers: [severity = critical]
          receiver: backend-pagerduty
    - matchers: [team = data]
      receiver: data-slack
```

**패턴 3: 서비스 계층별 라우팅**

```yaml
route:
  receiver: default
  group_by: ['alertname', 'service']
  routes:
    # 인프라 레이어
    - matchers: [layer = infrastructure]
      receiver: infra-team
      group_by: ['alertname', 'instance']
    # 플랫폼 레이어
    - matchers: [layer = platform]
      receiver: platform-team
      group_by: ['alertname', 'namespace']
    # 애플리케이션 레이어
    - matchers: [layer = application]
      receiver: app-team
      group_by: ['alertname', 'namespace', 'service']
```

---

## Grouping 심화

### group_wait, group_interval, repeat_interval 타임라인 다이어그램

세 가지 타이머의 상호 작용을 시간 축 위에서 상세하게 이해하는 것이 중요하다.

```
시간 ───────────────────────────────────────────────────────────────────────►

T0: 알림 A 최초 발생 (새 그룹 생성)
│
├── group_wait (30s) 대기 중...
│   T0+10s: 알림 B 도착 (같은 그룹) → 버퍼에 추가
│   T0+20s: 알림 C 도착 (같은 그룹) → 버퍼에 추가
│
T0+30s: [전송 1] 알림 A, B, C를 하나의 메시지로 전송
│
├── group_interval (5m) 대기 중...
│   T0+2m: 알림 D 도착 (같은 그룹) → 버퍼에 추가 (아직 전송 안 함)
│   T0+4m: 알림 E 도착 (같은 그룹) → 버퍼에 추가 (아직 전송 안 함)
│
T0+5m30s: [전송 2] 그룹에 변경 있음 (D, E 추가) → 알림 A~E 재전송
│
├── group_interval (5m) 대기 중...
│   (이 기간에 새 알림 없음, 변경 없음)
│
T0+10m30s: 변경 없으므로 전송하지 않음 (group_interval은 변경 있을 때만)
│
│   ... 시간 경과 ...
│
├── repeat_interval (4h) 도달
│
T0+4h30s: [전송 3] 변경 없지만 repeat_interval 도달 → 리마인더로 재전송
│
│   T0+4h10m: 알림 A resolved
│
T0+4h30s+group_interval: [전송 4] 그룹 변경 (A resolved) → 재전송
```

### 각 타이머의 목적과 적절한 설정값 가이드

**group_wait**

| 항목 | 설명 |
|------|------|
| 목적 | 관련 알림을 배치로 수집하여 하나의 메시지로 전송한다 |
| 동작 시점 | 새로운 Aggregation Group이 처음 생성될 때 |
| 적절한 값 | 10초~1분 |
| 너무 짧으면 | 관련 알림이 개별 메시지로 전송되어 알림 폭풍이 발생한다 |
| 너무 길면 | 긴급한 알림이 지연되어 대응이 늦어진다 |
| critical 알림 권장 | 10초 |
| warning 알림 권장 | 30초~1분 |

**group_interval**

| 항목 | 설명 |
|------|------|
| 목적 | 기존 그룹에 새 알림이 추가되었을 때 재전송 간격을 제어한다 |
| 동작 시점 | 이미 전송된 그룹에 변경(새 알림 추가, 알림 resolved)이 있을 때 |
| 적절한 값 | 1분~10분 |
| 너무 짧으면 | 그룹 변경이 빈번하면 과도한 재전송이 발생한다 |
| 너무 길면 | 새로 추가된 알림 정보가 늦게 전달된다 |
| 일반 권장 | 5분 |

**repeat_interval**

| 항목 | 설명 |
|------|------|
| 목적 | 그룹에 변경이 없더라도 주기적으로 리마인더를 전송한다 |
| 동작 시점 | 마지막 전송 이후 repeat_interval이 경과했을 때 |
| 적절한 값 | 1시간~12시간 |
| 너무 짧으면 | 동일 알림이 반복 전송되어 알림 피로를 유발한다 |
| 너무 길면 | 운영자가 기존 알림을 잊어버릴 수 있다 |
| critical 알림 권장 | 1시간 |
| warning 알림 권장 | 4시간~12시간 |

### 그룹 내 알림 집계 동작

하나의 Aggregation Group 내에서 알림이 어떻게 관리되는지 상세히 설명한다.

```
Aggregation Group: {alertname="HighCPU", namespace="prod"}

내부 상태:
┌───────────────────────────────────────────────────────┐
│ Alert Store (fingerprint → Alert)                      │
│                                                        │
│  fp:0x1a2b → {alertname=HighCPU, pod=api-1} FIRING     │
│  fp:0x3c4d → {alertname=HighCPU, pod=api-2} FIRING     │
│  fp:0x5e6f → {alertname=HighCPU, pod=api-3} RESOLVED   │
│                                                        │
│ 타이머 상태:                                            │
│  group_wait:       만료됨 (최초 전송 완료)               │
│  group_interval:   3분 남음                             │
│  repeat_interval:  3시간 42분 남음                       │
│  last_sent:        2024-01-15T10:30:00Z                 │
│  last_changed:     2024-01-15T10:35:00Z                 │
│                                                        │
│ flush 조건:                                             │
│  1. group_wait 만료 (최초 전송)                          │
│  2. group_interval 만료 AND 변경 있음                    │
│  3. repeat_interval 만료 (변경 없어도)                   │
└───────────────────────────────────────────────────────┘
```

그룹이 "변경되었다"의 기준은 다음과 같다:
- 새 알림이 그룹에 추가되었을 때
- 기존 알림이 resolved 되었을 때
- 기존 알림의 labels 또는 annotations이 변경되었을 때 (실제로는 labels가 변경되면 다른 fingerprint이므로 새 알림으로 취급됨)

### resolved 알림의 전송 타이밍

resolved 알림은 다음 조건이 모두 충족될 때 전송된다:

1. receiver에 `send_resolved: true`가 설정되어 있다.
2. 알림의 `EndsAt`이 현재 시각보다 과거이다.
3. 해당 알림이 이전에 firing 상태로 전송된 적이 있다 (한 번도 전송되지 않은 알림은 resolved도 전송하지 않는다).
4. `group_interval` 타이머가 만료되었다.

```
T0: 알림 firing → [전송] firing 알림 전송
T1: 알림 resolved (Prometheus가 전송 중단, EndsAt 도달)
T2: group_interval 만료 → [전송] resolved 알림 전송 (send_resolved: true인 경우)
```

`send_resolved: false`(기본값)이면 resolved 알림은 전송하지 않는다. 운영 환경에서는 `send_resolved: true`를 설정하여 문제가 해결되었음을 운영자에게 알리는 것이 일반적으로 권장된다.

---

## Inhibition 심화
