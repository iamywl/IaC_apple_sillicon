# AlertManager - 알림 관리

## 개념

### AlertManager란?

AlertManager는 Prometheus 생태계에서 알림(alert)을 수신, 라우팅, 그룹핑, 억제, 전송하는 전용 컴포넌트이다. Prometheus 서버가 alerting rule을 평가하여 firing 상태가 된 알림을 AlertManager API로 전송하면, AlertManager가 이를 수신하여 설정된 정책에 따라 적절한 채널로 알림을 전달한다.

AlertManager의 핵심 설계 철학은 **알림 피로(Alert Fatigue) 방지**이다. 동일한 문제로 인해 수백 개의 알림이 동시에 발생하더라도, Grouping, Inhibition, Silence, Deduplication을 통해 운영자가 실제로 받는 알림 수를 최소화한다.

### 핵심 개념

| 개념 | 설명 |
|------|------|
| Route | 알림을 어떤 수신자에게 보낼지 결정하는 라우팅 트리이다 |
| Receiver | 알림을 실제로 전송하는 대상 (Slack, Email, PagerDuty 등)이다 |
| Grouping | 관련 알림을 하나로 묶어 전송하여 알림 폭풍을 방지한다 |
| Inhibition | 상위 알림이 발생하면 하위 알림을 억제하는 규칙이다 |
| Silence | 특정 기간 동안 알림을 무시하는 설정이다 (유지보수 시) |
| Firing | 알림 조건이 충족되어 발생 중인 상태이다 |
| Resolved | 알림 조건이 해소된 상태이다 |
| Deduplication | 동일한 알림이 중복 전송되지 않도록 제거하는 메커니즘이다 |

---

### 이 프로젝트에서의 실습 환경

이 프로젝트에서 AlertManager는 platform 클러스터의 `monitoring` 네임스페이스에 배포된다.

- 설치 스크립트: `scripts/install/09-install-alerting.sh`
- Helm Chart: `kube-prometheus-stack`에 포함
- NodePort: 30903
- Alert Rules: `manifests/alerting/prometheus-rules.yaml`
- Webhook Receiver: `manifests/alerting/webhook-logger.yaml`
- 실습 대상 클러스터: platform (`kubeconfig/platform.yaml`)

```bash
# platform 클러스터에서 AlertManager 접근
export KUBECONFIG=kubeconfig/platform.yaml
kubectl port-forward -n monitoring svc/kube-prometheus-stack-alertmanager 9093:9093
# 브라우저에서 http://localhost:9093 접속
```

정의된 Alert Rules:
| 이름 | 조건 | 심각도 |
|------|------|--------|
| HighCpuUsage | CPU > 80% (5분) | warning |
| HighMemoryUsage | 메모리 > 85% (5분) | warning |
| NodeNotReady | 노드 비정상 | critical |
| PodCrashLooping | Pod 재시작 반복 | critical |
| PodOOMKilled | OOM Kill 발생 | warning |

---

## AlertManager 내부 아키텍처

AlertManager 내부는 여러 단계의 파이프라인으로 구성되어 있다. 각 단계가 알림을 처리하고 다음 단계로 전달하는 구조이다.

### 알림 처리 파이프라인

```
Prometheus ──► AlertManager API ──► Dispatcher ──► Notification Pipeline ──► Receiver
                    │                   │                   │
                    ▼                   ▼                   ▼
              Deduplication        Route 매칭           Inhibitor
              (fingerprint         Group 분류           Silencer
               기반 중복 제거)      group_wait 적용       Template 렌더링
                                   group_interval 적용   Retry / 전송
                                   repeat_interval 적용
```

### 내부 컴포넌트 상세

**1. Dispatcher (디스패처)**

Dispatcher는 AlertManager의 핵심 컴포넌트로, 수신된 알림을 Route 트리에 매칭하여 적절한 Notification Pipeline으로 전달하는 역할을 한다. Dispatcher는 알림의 label set을 기준으로 Route 트리를 순회하면서 매칭되는 route를 찾고, 해당 route의 `group_by` 설정에 따라 알림을 그룹으로 분류한다. 각 그룹은 독립적인 Aggregation Group으로 관리되며, `group_wait`, `group_interval`, `repeat_interval` 타이머를 개별적으로 유지한다.

**2. Inhibitor (억제기)**

Inhibitor는 `inhibit_rules`에 정의된 규칙에 따라 특정 알림이 활성 상태일 때 다른 알림의 전송을 억제한다. 예를 들어, 노드 자체가 다운된 상황에서 해당 노드의 CPU, 메모리, 디스크 알림이 모두 발생하는 것은 불필요하다. Inhibitor는 source alert(원인 알림)가 firing 상태인 동안 target alert(결과 알림)를 자동으로 억제한다.

**3. Silencer (침묵기)**

Silencer는 사용자가 수동으로 설정한 Silence 규칙에 따라 알림을 필터링한다. Silence는 label matcher로 정의되며, 매칭되는 알림은 설정된 기간 동안 전송되지 않는다. 주로 계획된 유지보수(maintenance window)나 이미 인지된 문제에 대해 사용한다.

**4. Notification Pipeline (알림 파이프라인)**

Notification Pipeline은 최종적으로 알림을 Receiver로 전송하는 단계이다. 이 파이프라인은 Go template을 사용하여 알림 메시지를 렌더링하고, 재시도(retry) 로직과 rate limiting을 적용한 후 실제 전송을 수행한다.

**5. Deduplication (중복 제거)**

AlertManager는 각 알림에 대해 label set의 fingerprint를 계산하여 고유 식별자로 사용한다. 동일한 fingerprint를 가진 알림이 반복적으로 수신되면 내부 상태만 갱신하고, `repeat_interval`이 지나기 전까지 재전송하지 않는다. 이 메커니즘은 Prometheus가 매 evaluation interval마다 동일한 알림을 반복 전송하더라도 수신자에게는 한 번만 도달하도록 보장한다.

---

## Routing Tree 심화

### Route 매칭 메커니즘

AlertManager의 라우팅은 트리 구조로 동작한다. 최상위 route가 root route이며, 모든 알림은 root route에 먼저 매칭된다. 이후 하위 `routes`를 순서대로 순회하면서 첫 번째로 매칭되는 route를 찾는다.

```yaml
route:
  # Root Route - 모든 알림의 기본 설정
  receiver: 'default'
  group_by: ['alertname', 'namespace']
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h

  routes:
    # 1번 route: severity=critical 매칭
    - match:
        severity: critical
      receiver: 'pagerduty'
      group_wait: 10s
      continue: false          # 매칭되면 여기서 중단 (기본값)

    # 2번 route: team label 정규식 매칭
    - match_re:
        team: '^(platform|infra)$'
      receiver: 'platform-slack'
      routes:
        # 2-1번 중첩 route: platform 팀의 critical
        - match:
            severity: critical
          receiver: 'platform-pagerduty'

    # 3번 route: continue 플래그 사용
    - match:
        severity: warning
      receiver: 'slack-warning'
      continue: true           # 매칭되어도 다음 route 계속 탐색

    # 4번 route: warning이면서 logging 관련
    - match:
        severity: warning
        component: logging
      receiver: 'logging-team'
```

**`match` vs `match_re`**

- `match`: label의 정확한 값(exact match)으로 매칭한다. `severity: critical`이면 severity label이 정확히 "critical"인 알림만 매칭된다.
- `match_re`: 정규식(regular expression)으로 매칭한다. `team: '^(platform|infra)$'`이면 team label이 "platform" 또는 "infra"인 알림이 매칭된다.

**`continue` 플래그**

기본적으로 `continue: false`이다. 알림이 특정 route에 매칭되면 해당 route의 receiver로 전송되고 탐색이 중단된다. `continue: true`로 설정하면 매칭 후에도 다음 sibling route를 계속 탐색한다. 이를 통해 하나의 알림을 여러 receiver에 동시에 전송할 수 있다.

**Default Route (기본 라우트)**

Root route의 `receiver`가 default route 역할을 한다. 어떤 하위 route에도 매칭되지 않는 알림은 root route의 receiver로 전송된다. Root route에는 `match` 조건을 설정하지 않으며, 반드시 정의해야 한다.

**Nested Routes (중첩 라우트)**

route 안에 다시 `routes`를 정의하여 트리를 깊게 구성할 수 있다. 부모 route에 매칭된 알림만 자식 route로 내려간다. 자식 route는 부모의 `group_by`, `group_wait` 등을 상속받되, 명시적으로 재정의할 수 있다.

### group_by 메커니즘

`group_by`는 알림을 그룹으로 묶는 기준 label 목록이다. 동일한 `group_by` label 조합을 가진 알림은 하나의 그룹으로 묶여서 단일 알림으로 전송된다.

```yaml
# 예: group_by: ['alertname', 'namespace']
# 아래 3개의 알림이 발생한 경우:
#   {alertname="HighCPU", namespace="prod", pod="api-1"}
#   {alertname="HighCPU", namespace="prod", pod="api-2"}
#   {alertname="HighCPU", namespace="dev",  pod="api-3"}
#
# 결과: 2개의 그룹으로 묶인다
#   그룹 1: alertname=HighCPU, namespace=prod (pod api-1, api-2 포함)
#   그룹 2: alertname=HighCPU, namespace=dev  (pod api-3 포함)
```

특수한 값으로 `group_by: ['...']`를 사용하면 모든 label을 기준으로 그룹핑한다. 즉, label set이 완전히 동일한 알림만 같은 그룹이 된다. 반대로 `group_by: []`를 사용하면 해당 route에 매칭되는 모든 알림이 하나의 그룹으로 합쳐진다.

---

## Grouping 타이머 심화

### group_wait, group_interval, repeat_interval

이 세 가지 타이머는 AlertManager의 알림 전송 빈도를 제어하는 핵심 설정이다.

```
알림 최초 발생                                                    시간 →
    │
    ├─── group_wait (30s) ───┤  ← 최초 그룹 알림 전송
    │                         │
    │    (이 기간에 같은 그룹의   │
    │     다른 알림을 배치 수집)   │
    │                         │
    │                         ├─── group_interval (5m) ───┤  ← 그룹에 새 알림 추가 시 재전송
    │                         │                            │
    │                         │                            ├─── group_interval (5m) ───┤
    │                         │                            │
    │                         ├──────── repeat_interval (4h) ────────┤  ← 변경 없어도 재전송
```

**group_wait (초기 대기 시간)**

새로운 알림 그룹이 생성되면, AlertManager는 즉시 알림을 전송하지 않고 `group_wait` 시간만큼 대기한다. 이 대기 시간 동안 동일한 그룹에 속하는 다른 알림이 도착하면 함께 묶어서 전송한다. 예를 들어 전체 클러스터 장애로 100개의 알림이 동시에 발생해도 `group_wait` 동안 배치 수집되어 하나의 알림으로 전송된다. 일반적으로 30초~1분으로 설정한다.

**group_interval (그룹 재전송 간격)**

이미 전송된 그룹에 새로운 알림이 추가되었을 때, 최소 `group_interval` 시간이 지나야 해당 그룹의 알림을 다시 전송한다. 그룹 내용이 변경되지 않으면 재전송하지 않는다. 일반적으로 5분으로 설정한다.

**repeat_interval (반복 전송 간격)**

그룹 내용에 변경이 없더라도 `repeat_interval` 간격으로 알림을 반복 전송한다. 이는 운영자가 알림을 놓치지 않도록 리마인더 역할을 한다. 너무 짧게 설정하면 알림 피로를 유발하므로 일반적으로 4시간~12시간으로 설정한다.

---

## Inhibition Rules 심화

### 알림 폭풍 방지를 위한 억제 규칙

Inhibition은 특정 알림(source)이 firing 상태일 때 다른 알림(target)의 전송을 자동으로 억제하는 메커니즘이다. 이를 통해 근본 원인(root cause) 알림만 전달하고, 파생된 증상(symptom) 알림은 차단할 수 있다.

```yaml
inhibit_rules:
  # 규칙 1: 노드 다운 시 해당 노드의 모든 알림 억제
  - source_matchers:
      - alertname = NodeDown
    target_matchers:
      - alertname != NodeDown
    equal: ['instance']

  # 규칙 2: critical 알림이 있으면 동일 alertname의 warning 억제
  - source_matchers:
      - severity = critical
    target_matchers:
      - severity = warning
    equal: ['alertname', 'namespace']

  # 규칙 3: 클러스터 다운 시 모든 개별 노드 알림 억제
  - source_matchers:
      - alertname = ClusterDown
    target_matchers:
      - alertname =~ "Node.*"
    equal: ['cluster']
```

**source_matchers와 target_matchers**

- `source_matchers`: 억제를 트리거하는 알림의 조건이다. 이 조건에 매칭되는 알림이 firing 상태여야 억제가 발동한다.
- `target_matchers`: 억제되는 알림의 조건이다. source가 firing 상태일 때, 이 조건에 매칭되는 알림이 억제된다.
- `=~` 연산자를 사용하면 정규식 매칭이 가능하다.

> 참고: `source_match`/`target_match`와 `source_match_re`/`target_match_re`는 이전 형식(deprecated)이다. AlertManager 0.22.0 이상에서는 `source_matchers`/`target_matchers`를 사용하는 것이 권장된다.

**equal labels**

`equal` 필드는 source와 target 알림이 동일한 값을 가져야 하는 label 목록이다. 예를 들어 `equal: ['instance']`이면, source 알림과 target 알림의 `instance` label 값이 동일한 경우에만 억제가 적용된다. 이를 통해 노드 A가 다운되었을 때 노드 B의 알림까지 억제되는 것을 방지한다.

**Inhibition 동작 예시**

```
상황: node-1이 다운됨

발생 알림:
  1. {alertname="NodeDown", instance="node-1", severity="critical"}     ← source
  2. {alertname="HighCPU", instance="node-1", severity="warning"}      ← 억제됨 (equal: instance 일치)
  3. {alertname="DiskFull", instance="node-1", severity="warning"}     ← 억제됨 (equal: instance 일치)
  4. {alertname="HighCPU", instance="node-2", severity="warning"}      ← 전송됨 (instance 불일치)

결과: NodeDown 알림 1건만 전송
```

---

## High Availability (고가용성)

### AlertManager Clustering

AlertManager는 고가용성을 위해 여러 인스턴스를 클러스터로 구성할 수 있다. 클러스터 내의 인스턴스들은 **Gossip 프로토콜 (memberlist 기반)**을 사용하여 상태를 동기화한다.

```
Prometheus ──► AlertManager-0 ◄──Gossip──► AlertManager-1 ◄──Gossip──► AlertManager-2
    │              │                            │                            │
    ├──────────────┤                            │                            │
    ├──────────────┼────────────────────────────┤                            │
    └──────────────┼────────────────────────────┼────────────────────────────┘
                   │                            │
              Notification               Notification
              (중복 방지)                  (중복 방지)
```

**Gossip 프로토콜**

AlertManager는 HashiCorp의 `memberlist` 라이브러리를 사용하여 Gossip 프로토콜을 구현한다. 각 인스턴스는 `--cluster.peer` 플래그로 다른 인스턴스의 주소를 지정하여 클러스터에 참여한다. Gossip을 통해 동기화되는 상태 정보는 다음과 같다:

- **Silence 상태**: 한 인스턴스에서 생성된 Silence가 모든 인스턴스에 전파된다
- **Notification Log**: 어떤 알림이 이미 전송되었는지의 기록이 공유된다

**클러스터 간 Deduplication**

Prometheus는 고가용성을 위해 동일한 알림을 모든 AlertManager 인스턴스에 전송한다. 각 인스턴스가 독립적으로 알림을 처리하면 수신자에게 중복 알림이 도달할 수 있다. AlertManager는 Notification Log를 Gossip으로 공유하여, 특정 알림 그룹에 대한 알림이 이미 다른 인스턴스에서 전송되었다면 재전송하지 않는다.

```yaml
# Kubernetes에서 AlertManager 클러스터 구성 예시 (StatefulSet)
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: alertmanager
spec:
  replicas: 3
  template:
    spec:
      containers:
        - name: alertmanager
          args:
            - '--cluster.listen-address=0.0.0.0:9094'
            - '--cluster.peer=alertmanager-0.alertmanager:9094'
            - '--cluster.peer=alertmanager-1.alertmanager:9094'
            - '--cluster.peer=alertmanager-2.alertmanager:9094'
```

---

## Notification Template 심화

### Go Template 문법

AlertManager는 Go의 `text/template` 패키지를 사용하여 알림 메시지를 렌더링한다. 템플릿에서 사용할 수 있는 주요 데이터 구조와 함수는 다음과 같다.

### 사용 가능한 데이터 필드

| 필드 | 타입 | 설명 |
|------|------|------|
| `.Status` | string | 그룹의 상태 ("firing" 또는 "resolved")이다 |
| `.Alerts` | []Alert | 그룹에 포함된 모든 알림 목록이다 |
| `.Alerts.Firing` | []Alert | firing 상태인 알림만 필터링한 목록이다 |
| `.Alerts.Resolved` | []Alert | resolved 상태인 알림만 필터링한 목록이다 |
| `.GroupLabels` | KV | group_by에 지정된 label의 key-value 쌍이다 |
| `.CommonLabels` | KV | 그룹 내 모든 알림이 공유하는 label이다 |
| `.CommonAnnotations` | KV | 그룹 내 모든 알림이 공유하는 annotation이다 |
| `.ExternalURL` | string | AlertManager의 외부 접근 URL이다 |
| `.Receiver` | string | 알림을 수신하는 receiver의 이름이다 |

### 템플릿 작성 예시

```yaml
# 커스텀 템플릿 파일 정의 (alertmanager.yml의 templates 섹션)
templates:
  - '/etc/alertmanager/templates/*.tmpl'

# 템플릿 파일 (notification.tmpl)
# ──────────────────────────────────────────

# Slack 메시지 제목 템플릿
{{ define "slack.custom.title" -}}
[{{ .Status | toUpper }}{{ if eq .Status "firing" }}:{{ .Alerts.Firing | len }}{{ end }}] {{ .CommonLabels.alertname }}
{{- end }}

# Slack 메시지 본문 템플릿
{{ define "slack.custom.text" -}}
{{ range .Alerts }}
*Alert:* {{ .Labels.alertname }}
*Severity:* {{ .Labels.severity }}
*Namespace:* {{ .Labels.namespace }}
*Summary:* {{ .Annotations.summary }}
*Description:* {{ .Annotations.description }}
{{ if .Annotations.runbook_url }}*Runbook:* {{ .Annotations.runbook_url }}{{ end }}
*Started:* {{ .StartsAt.Format "2006-01-02 15:04:05 KST" }}
{{ if eq .Status "resolved" }}*Resolved:* {{ .EndsAt.Format "2006-01-02 15:04:05 KST" }}{{ end }}
---
{{ end }}
{{- end }}

# 공통 함수 활용 예시
{{ define "alert.severity.icon" -}}
{{ if eq .Labels.severity "critical" }}🔴{{ else if eq .Labels.severity "warning" }}🟡{{ else }}🔵{{ end }}
{{- end }}
```

### 템플릿에서 사용 가능한 주요 함수

| 함수 | 설명 | 예시 |
|------|------|------|
| `toUpper` | 문자열을 대문자로 변환한다 | `{{ .Status \| toUpper }}` |
| `toLower` | 문자열을 소문자로 변환한다 | `{{ .Status \| toLower }}` |
| `title` | 첫 글자를 대문자로 변환한다 | `{{ .Status \| title }}` |
| `join` | 리스트를 구분자로 결합한다 | `{{ .Values \| join ", " }}` |
| `safeHtml` | HTML 이스케이프를 방지한다 | `{{ .Annotations.description \| safeHtml }}` |
| `reReplaceAll` | 정규식 치환을 수행한다 | `{{ reReplaceAll "(.+)" "$1" .Labels.instance }}` |

---

## Receiver 통합 심화

### Slack

```yaml
receivers:
  - name: 'slack-critical'
    slack_configs:
      - api_url: '<YOUR_SLACK_WEBHOOK_URL>'    # Incoming Webhook URL
        channel: '#alerts-critical'
        username: 'AlertManager'
        icon_emoji: ':rotating_light:'
        send_resolved: true
        title: '{{ template "slack.custom.title" . }}'
        text: '{{ template "slack.custom.text" . }}'
        # Block Kit 형식 사용 시 (title/text 대신)
        # blocks: |
        #   [
        #     {
        #       "type": "section",
        #       "text": {
        #         "type": "mrkdwn",
        #         "text": "*{{ .CommonLabels.alertname }}*\n{{ .CommonAnnotations.summary }}"
        #       }
        #     }
        #   ]
        actions:
          - type: button
            text: 'Runbook'
            url: '{{ (index .Alerts 0).Annotations.runbook_url }}'
          - type: button
            text: 'Dashboard'
            url: 'https://grafana.example.com/d/alerts'
```

Slack 연동 시 Incoming Webhook URL을 사용하는 방법이 가장 간단하다. `send_resolved: true`를 설정하면 알림이 해소되었을 때도 메시지를 전송하여 운영자가 문제 해결을 인지할 수 있다.

### PagerDuty

```yaml
receivers:
  - name: 'pagerduty-critical'
    pagerduty_configs:
      - routing_key: '<PagerDuty Integration Key>'   # Events API v2 사용
        severity: '{{ .CommonLabels.severity }}'
        description: '{{ .CommonAnnotations.summary }}'
        details:
          firing: '{{ template "pagerduty.custom.instances" .Alerts.Firing }}'
          resolved: '{{ template "pagerduty.custom.instances" .Alerts.Resolved }}'
          num_firing: '{{ .Alerts.Firing | len }}'
          num_resolved: '{{ .Alerts.Resolved | len }}'
        # PagerDuty Events API v2는 자동으로 resolve 이벤트를 전송한다
        # dedup_key는 group label 기반으로 자동 생성된다
```

PagerDuty Events API v2는 `routing_key`(Integration Key)를 사용한다. AlertManager는 firing 시 trigger 이벤트를, resolved 시 resolve 이벤트를 자동으로 전송한다.

### Email

```yaml
receivers:
  - name: 'email-alerts'
    email_configs:
      - to: 'oncall@example.com'
        from: 'alertmanager@example.com'
        smarthost: 'smtp.example.com:587'
        auth_username: 'alertmanager@example.com'
        auth_password: '<password>'
        auth_identity: 'alertmanager@example.com'
        send_resolved: true
        headers:
          Subject: '[{{ .Status | toUpper }}] {{ .CommonLabels.alertname }}'
        html: '{{ template "email.custom.html" . }}'
```

### Webhook (범용)

```yaml
receivers:
  - name: 'custom-webhook'
    webhook_configs:
      - url: 'https://api.example.com/alerts'
        send_resolved: true
        http_config:
          authorization:
            type: Bearer
            credentials: '<API_TOKEN>'
        max_alerts: 10     # 한 번에 전송할 최대 알림 수
```

Webhook receiver는 AlertManager의 알림 데이터를 JSON 형식으로 HTTP POST 요청한다. 자체 알림 시스템이나 ChatOps 봇과 연동할 때 유용하다.

### OpsGenie

```yaml
receivers:
  - name: 'opsgenie-critical'
    opsgenie_configs:
      - api_key: '<OpsGenie API Key>'
        message: '{{ .CommonLabels.alertname }}: {{ .CommonAnnotations.summary }}'
        priority: '{{ if eq .CommonLabels.severity "critical" }}P1{{ else }}P3{{ end }}'
        tags: 'alertmanager,{{ .CommonLabels.namespace }}'
        responders:
          - type: team
            name: 'platform-team'
```

---

## amtool CLI

`amtool`은 AlertManager와 상호작용하는 공식 CLI 도구이다. AlertManager 컨테이너 내부에 포함되어 있으며, 알림 조회, Silence 관리, 설정 검증, 라우팅 테스트 등에 사용한다.

### 알림 조회

```bash
# 현재 발생 중인 모든 알림 조회
amtool alert query

# 특정 label로 필터링
amtool alert query alertname=HighCPU

# 정규식으로 필터링
amtool alert query -r alertname="High.*"

# 특정 receiver의 알림만 조회
amtool alert query --receiver='slack-critical'

# 출력 형식 지정
amtool alert query --output=json
amtool alert query --output=simple
```

### Silence 관리

```bash
# Silence 생성 (특정 알림을 2시간 동안 무시)
amtool silence add alertname="HighCPU" \
  --author="oncall-engineer" \
  --comment="배포 중 일시적 CPU 스파이크 예상" \
  --duration="2h"

# 정규식으로 Silence 생성
amtool silence add alertname=~"High.*" namespace="staging" \
  --author="admin" \
  --comment="스테이징 환경 유지보수" \
  --duration="4h"

# 현재 활성 Silence 목록 조회
amtool silence query

# 만료된 Silence 포함 조회
amtool silence query --expired

# 특정 Silence 해제 (expire)
amtool silence expire <silence-id>

# 모든 Silence 해제
amtool silence expire $(amtool silence query -q)
```

### 설정 검증

```bash
# alertmanager.yml 문법 검증
amtool check-config alertmanager.yml

# 출력 예시:
# Checking 'alertmanager.yml'  SUCCESS
# Found:
#  - global config
#  - route
#  - 2 inhibit rules
#  - 3 receivers
#  - 1 templates
```

### 라우팅 테스트

```bash
# 특정 label 조합이 어떤 receiver로 라우팅되는지 테스트
amtool config routes test-routing --config.file=alertmanager.yml \
  alertname=HighCPU severity=critical namespace=prod

# 전체 라우팅 트리 시각화
amtool config routes show --config.file=alertmanager.yml

# Kubernetes 환경에서 사용 (kubectl exec)
kubectl exec -n monitoring deploy/alertmanager -- amtool config routes show
```

---

## 실습

### 실습 1: AlertManager UI 접속
```bash
# AlertManager 포트포워딩
kubectl port-forward -n monitoring svc/alertmanager 9093:9093

# 브라우저에서 http://localhost:9093 접속
# Alerts 탭: 현재 활성 알림 확인
# Silences 탭: 침묵 규칙 관리
```

### 실습 2: 알림 상태 확인
```bash
# 현재 발생 중인 알림
kubectl exec -n monitoring deploy/alertmanager -- amtool alert query

# 알림 그룹 확인
kubectl exec -n monitoring deploy/alertmanager -- amtool alert query --receiver default

# AlertManager 설정 확인
kubectl get secret -n monitoring alertmanager-config -o jsonpath='{.data.alertmanager\.yml}' | base64 -d
```

### 실습 3: Silence 생성 (유지보수 시)
```bash
# Silence 생성 (2시간 동안 특정 알림 무시)
# AlertManager UI > Silences > New Silence

# amtool로 Silence 생성
kubectl exec -n monitoring deploy/alertmanager -- amtool silence add \
  alertname="HighCPUUsage" \
  --author="admin" \
  --comment="계획된 유지보수" \
  --duration="2h"

# Silence 목록 확인
kubectl exec -n monitoring deploy/alertmanager -- amtool silence query
```

### 실습 4: 알림 테스트
```bash
# CPU 부하를 걸어 알림을 발생시킨다
kubectl run stress --image=polinux/stress --restart=Never -- stress --cpu 4 --timeout 300

# Prometheus에서 알림 상태 확인
# http://localhost:9090/alerts

# AlertManager에서 알림 수신 확인
# http://localhost:9093/#/alerts

# 부하 테스트 Pod 삭제
kubectl delete pod stress
```

### 실습 5: 라우팅 테스트
```bash
# 현재 라우팅 트리 확인
kubectl exec -n monitoring deploy/alertmanager -- amtool config routes show

# 특정 알림이 어떤 receiver로 라우팅되는지 테스트
kubectl exec -n monitoring deploy/alertmanager -- amtool config routes test-routing \
  alertname=HighCPU severity=critical

# 설정 파일 검증
kubectl exec -n monitoring deploy/alertmanager -- amtool check-config /etc/alertmanager/alertmanager.yml
```

---

## 예제

### 예제 1: AlertManager 설정
```yaml
# alertmanager.yml
global:
  resolve_timeout: 5m

route:
  group_by: ['alertname', 'namespace']
  group_wait: 30s        # 알림 그룹 대기 시간
  group_interval: 5m     # 같은 그룹 재전송 간격
  repeat_interval: 4h    # 동일 알림 반복 간격
  receiver: 'default'
  routes:
    # critical 알림은 즉시 전송
    - match:
        severity: critical
      receiver: 'critical-alerts'
      group_wait: 10s
    # warning 알림은 기본 라우트
    - match:
        severity: warning
      receiver: 'default'

receivers:
  - name: 'default'
    slack_configs:
      - channel: '#alerts-warning'
        send_resolved: true
        title: '[{{ .Status | toUpper }}] {{ .CommonLabels.alertname }}'
        text: '{{ range .Alerts }}{{ .Annotations.summary }}{{ end }}'

  - name: 'critical-alerts'
    slack_configs:
      - channel: '#alerts-critical'
        send_resolved: true

inhibit_rules:
  # 노드 다운이면 해당 노드의 다른 알림 억제
  - source_matchers:
      - alertname = NodeDown
    target_matchers:
      - alertname != NodeDown
    equal: ['instance']
```

### 예제 2: Prometheus Alert Rule
```yaml
# alert-rules.yaml
groups:
  - name: infrastructure
    rules:
      - alert: NodeDown
        expr: up{job="node-exporter"} == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "노드 {{ $labels.instance }}가 다운되었다"
          runbook_url: "https://wiki.example.com/runbooks/node-down"

      - alert: HighMemoryUsage
        expr: (1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes) > 0.9
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "노드 {{ $labels.instance }}의 메모리 사용률이 90%를 초과했다"
          runbook_url: "https://wiki.example.com/runbooks/high-memory"

      - alert: PodCrashLooping
        expr: increase(kube_pod_container_status_restarts_total[1h]) > 5
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Pod {{ $labels.pod }}가 1시간 내 5회 이상 재시작했다"
          runbook_url: "https://wiki.example.com/runbooks/pod-crashloop"
```

---

## Alerting Best Practices

### 알림 네이밍 컨벤션

알림 이름은 일관된 규칙을 따라야 한다. 이름만으로 어떤 문제인지 즉시 파악할 수 있어야 한다.

| 패턴 | 예시 | 설명 |
|------|------|------|
| `<Component><Condition>` | `NodeDown`, `PodCrashLooping` | 대상 + 상태를 CamelCase로 조합한다 |
| `<Component>High<Metric>` | `NodeHighCPU`, `DiskHighUtilization` | 리소스 임계치 초과 알림이다 |
| `<Component><Metric>Absent` | `NodeExporterMetricsAbsent` | 메트릭 수집 실패 알림이다 |

지양해야 할 이름: `Alert1`, `CPUAlert`, `Problem` 등 의미가 불명확한 이름이다.

### Severity Level 정의

조직 내에서 severity level의 의미와 대응 수준을 명확히 합의해야 한다.

| Severity | 의미 | 대응 시간 | Receiver 예시 |
|----------|------|-----------|---------------|
| `critical` | 서비스 중단 또는 데이터 손실 위험이다 | 즉시 (5분 이내) | PagerDuty + Slack |
| `warning` | 성능 저하 또는 곧 문제가 될 수 있는 상태이다 | 업무 시간 내 (4시간 이내) | Slack |
| `info` | 참고용 알림으로, 대응이 필요 없을 수 있다 | 필요 시 확인 | Slack (별도 채널) |

### Runbook Link 필수화

모든 알림에는 `runbook_url` annotation을 포함하는 것이 권장된다. Runbook에는 다음 내용이 포함되어야 한다:

- 알림의 의미와 영향도
- 진단 절차 (확인해야 할 대시보드, 실행할 명령어)
- 대응 절차 (복구 방법, 에스컬레이션 경로)
- 과거 사례 및 해결 이력

```yaml
annotations:
  summary: "{{ $labels.instance }}의 디스크 사용률이 90%를 초과했다"
  description: "현재 디스크 사용률: {{ $value | humanizePercentage }}"
  runbook_url: "https://wiki.example.com/runbooks/disk-full"
```

### 알림 피로(Alert Fatigue) 방지

알림 피로는 과도한 알림으로 인해 운영자가 중요한 알림마저 무시하게 되는 현상이다. 다음 원칙을 지켜야 한다:

1. **Actionable한 알림만 생성한다**: 알림을 받았을 때 운영자가 취할 수 있는 구체적인 행동이 있어야 한다. 단순 정보 전달 목적이면 대시보드에 표시하는 것으로 충분하다.

2. **적절한 `for` 기간 설정**: 일시적인 스파이크에 알림이 발생하지 않도록 `for` 기간을 충분히 설정한다. CPU 사용률 알림의 경우 최소 5분 이상이 권장된다.

3. **Inhibition 규칙 적극 활용**: 근본 원인 알림이 있으면 파생 알림을 억제하여 알림 수를 줄인다.

4. **적절한 임계값 설정**: 임계값이 너무 낮으면 불필요한 알림이 발생한다. 과거 데이터를 분석하여 실제 문제가 발생하는 수준으로 설정한다.

5. **정기적인 알림 리뷰**: 분기별로 알림 규칙을 리뷰하여, 자주 무시되는 알림은 임계값을 조정하거나 삭제한다.

6. **`repeat_interval`을 넉넉하게 설정**: 동일 알림이 너무 자주 반복되면 피로를 유발한다. critical은 1시간, warning은 4시간 이상이 적절하다.

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

### source_matchers / target_matchers 동작 원리

Inhibition은 "원인 알림(source)이 활성 상태이면 결과 알림(target)을 억제한다"는 인과 관계를 표현하는 메커니즘이다.

```
inhibit_rules:
  - source_matchers:
      - alertname = NodeDown        # 이 조건에 매칭되는 알림이 firing이면
    target_matchers:
      - alertname != NodeDown       # 이 조건에 매칭되는 알림을 억제한다
    equal: ['instance']             # 단, instance label 값이 동일한 경우에만
```

**동작 순서**:

1. AlertManager가 현재 firing 상태인 모든 알림을 확인한다.
2. 각 inhibit_rule의 `source_matchers`에 매칭되는 firing 알림(source alert)을 찾는다.
3. source alert가 존재하면, `target_matchers`에 매칭되는 알림(target alert) 중에서 `equal`에 지정된 label 값이 source alert와 동일한 알림을 억제한다.
4. 억제된 알림은 Suppressed 상태가 되어 전송되지 않는다.

```
현재 firing 알림:
  [1] {alertname="NodeDown",  instance="node-1", severity="critical"}
  [2] {alertname="HighCPU",   instance="node-1", severity="warning"}
  [3] {alertname="HighCPU",   instance="node-2", severity="warning"}
  [4] {alertname="DiskFull",  instance="node-1", severity="warning"}

Inhibition 평가:
  source_matchers: alertname = NodeDown
  → [1]이 매칭됨 (source alert 존재)

  target_matchers: alertname != NodeDown
  → [2], [3], [4]가 매칭됨 (target alert 후보)

  equal: ['instance']
  → source [1]의 instance="node-1"과 동일한 target만 억제
  → [2] instance="node-1" → 억제됨
  → [3] instance="node-2" → 억제 안 됨 (instance 불일치)
  → [4] instance="node-1" → 억제됨

최종 전송 알림: [1], [3]
```

### equal labels의 역할

`equal` 필드는 source alert와 target alert의 범위를 제한하는 역할을 한다. `equal`이 없으면 source_matchers에 매칭되는 알림이 하나라도 있을 때 target_matchers에 매칭되는 모든 알림이 억제된다. 이는 의도치 않은 대규모 억제를 초래할 수 있다.

```yaml
# 위험한 설정: equal 없음
- source_matchers: [severity = critical]
  target_matchers: [severity = warning]
  # equal 없으면 → critical 알림이 하나라도 있으면 모든 warning 알림 억제!

# 안전한 설정: equal로 범위 제한
- source_matchers: [severity = critical]
  target_matchers: [severity = warning]
  equal: ['alertname', 'namespace']
  # → 같은 alertname, 같은 namespace의 warning만 억제
```

`equal`에 지정된 label이 source 또는 target 알림에 존재하지 않으면, 해당 label은 빈 문자열("")로 간주된다. 양쪽 모두 해당 label이 없으면 빈 문자열끼리 동일하므로 억제가 적용될 수 있다는 점에 주의해야 한다.

### 다중 inhibition rule 적용 순서

여러 inhibit_rules가 정의된 경우, 모든 규칙이 **독립적으로** 평가된다. 체이닝(A가 B를 억제하고, B가 C를 억제)은 지원되지 않는다.

```yaml
inhibit_rules:
  # 규칙 1: critical → warning 억제
  - source_matchers: [severity = critical]
    target_matchers: [severity = warning]
    equal: ['alertname']

  # 규칙 2: ClusterDown → 개별 노드 알림 억제
  - source_matchers: [alertname = ClusterDown]
    target_matchers: [alertname =~ "Node.*"]
    equal: ['cluster']

  # 규칙 3: 인프라 장애 → 애플리케이션 알림 억제
  - source_matchers: [layer = infrastructure, severity = critical]
    target_matchers: [layer = application]
    equal: ['cluster']
```

각 규칙은 서로 독립적이다. 규칙 1에 의해 억제된 알림이 다른 규칙의 source로 동작하지 않는다. 즉, 억제된 알림은 source_matchers 평가에서 제외된다. 이는 "억제의 연쇄(cascade)"를 방지하기 위한 설계이다.

### Inhibition 활용 패턴

**패턴 1: critical이 warning을 억제**

가장 기본적인 패턴이다. 동일한 문제에 대해 critical과 warning이 동시에 발생할 때, critical만 전송한다.

```yaml
- source_matchers: [severity = critical]
  target_matchers: [severity = warning]
  equal: ['alertname', 'namespace', 'instance']
```

**패턴 2: 상위 서비스 장애가 하위 알림을 억제**

마이크로서비스 환경에서 API Gateway가 다운되면 모든 하위 서비스의 알림이 동시에 발생한다. Gateway 장애 알림만 전달하고 나머지를 억제한다.

```yaml
- source_matchers: [alertname = APIGatewayDown]
  target_matchers: [depends_on = api-gateway]
  equal: ['cluster']
```

**패턴 3: 노드 장애 시 Pod 관련 알림 억제**

```yaml
- source_matchers: [alertname = NodeNotReady]
  target_matchers: [alertname =~ "Pod.*"]
  equal: ['node']
```

**패턴 4: 네트워크 파티션 시 연결 관련 알림 억제**

```yaml
- source_matchers: [alertname = NetworkPartition]
  target_matchers: [alertname =~ ".*(Connection|Timeout|Unreachable).*"]
  equal: ['cluster']
```

---

## Silence 심화

### Silence 생성 방법

Silence는 세 가지 방법으로 생성할 수 있다.

**1. amtool CLI**

```bash
# 기본 Silence 생성
amtool silence add alertname="HighCPU" \
  --author="oncall@example.com" \
  --comment="배포 중 일시적 스파이크 예상" \
  --duration="2h"

# 정규식 매칭 Silence
amtool silence add alertname=~"High.*" namespace="staging" \
  --author="admin" \
  --comment="스테이징 전체 점검" \
  --duration="4h"

# 특정 시간대 Silence (시작/종료 시각 지정)
amtool silence add alertname="HighCPU" \
  --author="admin" \
  --comment="야간 배치 작업" \
  --start="2024-01-15T22:00:00+09:00" \
  --end="2024-01-16T06:00:00+09:00"

# 여러 label 조합 Silence
amtool silence add alertname="PodCrashLooping" namespace="dev" cluster="dev-cluster" \
  --author="dev-team" \
  --comment="개발 환경 테스트 중" \
  --duration="1h"
```

**2. AlertManager API**

```bash
# POST /api/v2/silences
curl -X POST http://localhost:9093/api/v2/silences \
  -H "Content-Type: application/json" \
  -d '{
    "matchers": [
      {
        "name": "alertname",
        "value": "HighCPU",
        "isRegex": false,
        "isEqual": true
      },
      {
        "name": "namespace",
        "value": "staging",
        "isRegex": false,
        "isEqual": true
      }
    ],
    "startsAt": "2024-01-15T10:00:00Z",
    "endsAt": "2024-01-15T14:00:00Z",
    "createdBy": "admin",
    "comment": "계획된 유지보수"
  }'

# 응답: {"silenceID": "abc123-def456-..."}
```

**3. AlertManager Web UI**

Web UI (http://localhost:9093/#/silences)에서 직접 Silence를 생성할 수 있다.
- "New Silence" 버튼 클릭
- Label Matchers 입력 (name=value 형식)
- 시작/종료 시각 또는 duration 설정
- Author, Comment 입력
- "Create" 버튼으로 생성

### Silence 매칭 로직

Silence의 matchers는 알림의 label set과 비교된다. 모든 matcher가 동시에 충족되어야 해당 알림이 silence된다.

```
Silence matchers:
  alertname = "HighCPU"         # 정확 매칭
  namespace = "prod"            # 정확 매칭

알림 A: {alertname="HighCPU", namespace="prod", pod="api-1"}
  → alertname="HighCPU" ✓, namespace="prod" ✓ → Silence 적용

알림 B: {alertname="HighCPU", namespace="dev", pod="api-2"}
  → alertname="HighCPU" ✓, namespace="dev" ✗ → Silence 미적용

알림 C: {alertname="HighMem", namespace="prod", pod="db-1"}
  → alertname="HighMem" ✗ → Silence 미적용
```

Silence matcher에서 지원하는 연산자:

| 연산자 | 설명 | 예시 |
|--------|------|------|
| `=` | 정확히 일치 | `alertname = HighCPU` |
| `!=` | 불일치 | `severity != info` |
| `=~` | 정규식 일치 | `alertname =~ "High.*"` |
| `!~` | 정규식 불일치 | `namespace !~ "test\|dev"` |

### Silence 만료 관리

Silence는 생성 시 지정된 `endsAt` 시각이 되면 자동으로 만료된다. 만료된 Silence는 삭제되지 않고 "expired" 상태로 보존되며, 이력 조회가 가능하다.

```bash
# 활성 Silence 조회
amtool silence query

# 만료된 Silence 포함 조회
amtool silence query --expired

# 특정 Silence 수동 만료 (즉시 종료)
amtool silence expire <silence-id>

# 모든 활성 Silence 만료
amtool silence expire $(amtool silence query -q)

# Silence 갱신 (duration 연장)
amtool silence update <silence-id> --duration="4h"
```

Silence 관리의 모범 사례:
- 항상 의미 있는 `comment`를 작성한다. 왜 이 Silence를 생성했는지 나중에 추적할 수 있어야 한다.
- `duration`은 필요한 최소 시간으로 설정한다. 너무 길면 Silence 만료를 잊어버릴 수 있다.
- `author`에 실제 담당자 이메일을 입력하여 책임 소재를 명확히 한다.

### 자동 Silence 생성 (유지보수 창)

정기적인 유지보수 시간에 자동으로 Silence를 생성하려면 CronJob이나 CI/CD 파이프라인에서 API를 호출하는 방법을 사용할 수 있다.

```yaml
# Kubernetes CronJob으로 자동 Silence 생성
apiVersion: batch/v1
kind: CronJob
metadata:
  name: maintenance-silence
  namespace: monitoring
spec:
  schedule: "0 2 * * 3"        # 매주 수요일 02:00
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: silence-creator
              image: curlimages/curl:latest
              command:
                - /bin/sh
                - -c
                - |
                  END_TIME=$(date -u -d "+2 hours" +%Y-%m-%dT%H:%M:%SZ)
                  curl -X POST http://alertmanager:9093/api/v2/silences \
                    -H "Content-Type: application/json" \
                    -d "{
                      \"matchers\": [{
                        \"name\": \"severity\",
                        \"value\": \"warning\",
                        \"isRegex\": false,
                        \"isEqual\": true
                      }],
                      \"startsAt\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",
                      \"endsAt\": \"$END_TIME\",
                      \"createdBy\": \"maintenance-cronjob\",
                      \"comment\": \"정기 유지보수 창 - 자동 생성\"
                    }"
          restartPolicy: OnFailure
```

또는 `mute_time_intervals`를 사용하면 AlertManager 설정 레벨에서 유지보수 시간을 관리할 수 있어 별도의 자동화가 필요 없다. 유지보수 시간이 고정적이면 `mute_time_intervals`가 더 적합하고, 유동적이면 API를 통한 Silence 생성이 더 적합하다.

---

## 알림 수신자(Receiver) 심화

### Slack 심화

Slack은 AlertManager에서 가장 널리 사용되는 receiver이다.

**Incoming Webhook 설정**

Slack Workspace에서 Incoming Webhook을 생성하는 절차:
1. https://api.slack.com/apps 에서 새 App 생성
2. "Incoming Webhooks" 기능 활성화
3. 특정 채널에 대한 Webhook URL 생성
4. 생성된 URL을 AlertManager 설정에 사용

```yaml
receivers:
  - name: slack-alerts
    slack_configs:
      - api_url: '<YOUR_SLACK_WEBHOOK_URL>'
        channel: '#alerts'
        username: 'AlertManager'
        icon_emoji: ':bell:'
        send_resolved: true

        # 메시지 색상 (severity 기반)
        color: '{{ if eq .Status "firing" }}{{ if eq .CommonLabels.severity "critical" }}danger{{ else }}warning{{ end }}{{ else }}good{{ end }}'

        # 제목
        title: '{{ template "slack.custom.title" . }}'

        # 본문
        text: '{{ template "slack.custom.text" . }}'

        # Fallback (알림 미리보기용)
        fallback: '{{ template "slack.custom.fallback" . }}'

        # 액션 버튼
        actions:
          - type: button
            text: 'Runbook :book:'
            url: '{{ (index .Alerts 0).Annotations.runbook_url }}'
            style: 'primary'
          - type: button
            text: 'Dashboard :chart_with_upwards_trend:'
            url: 'https://grafana.example.com'
          - type: button
            text: 'Silence :mute:'
            url: '{{ .ExternalURL }}/#/silences/new?filter=%7Balertname%3D%22{{ .CommonLabels.alertname }}%22%7D'
```

**Slack Block Kit 활용**

Block Kit을 사용하면 보다 구조화된 메시지를 전송할 수 있다. `title`과 `text` 대신 `blocks`를 사용한다.

```yaml
slack_configs:
  - api_url: '<YOUR_SLACK_WEBHOOK_URL>'
    channel: '#alerts'
    send_resolved: true
    blocks: |
      [
        {
          "type": "header",
          "text": {
            "type": "plain_text",
            "text": "{{ if eq .Status "firing" }}🔥 Alert Firing{{ else }}✅ Alert Resolved{{ end }}"
          }
        },
        {
          "type": "section",
          "fields": [
            {
              "type": "mrkdwn",
              "text": "*Alert:*\n{{ .CommonLabels.alertname }}"
            },
            {
              "type": "mrkdwn",
              "text": "*Severity:*\n{{ .CommonLabels.severity }}"
            },
            {
              "type": "mrkdwn",
              "text": "*Namespace:*\n{{ .CommonLabels.namespace }}"
            },
            {
              "type": "mrkdwn",
              "text": "*Count:*\n{{ .Alerts | len }}"
            }
          ]
        },
        {
          "type": "section",
          "text": {
            "type": "mrkdwn",
            "text": "{{ range .Alerts }}• {{ .Annotations.summary }}\n{{ end }}"
          }
        },
        {
          "type": "actions",
          "elements": [
            {
              "type": "button",
              "text": { "type": "plain_text", "text": "View Runbook" },
              "url": "{{ (index .Alerts 0).Annotations.runbook_url }}"
            },
            {
              "type": "button",
              "text": { "type": "plain_text", "text": "Silence" },
              "url": "{{ .ExternalURL }}/#/silences/new"
            }
          ]
        }
      ]
```

### PagerDuty 심화

PagerDuty는 Events API v2를 통해 AlertManager와 연동한다.

```yaml
receivers:
  - name: pagerduty-critical
    pagerduty_configs:
      - routing_key: '<Integration Key>'   # PagerDuty Service의 Integration Key
        # severity 매핑 (PagerDuty는 critical, error, warning, info를 지원)
        severity: '{{ if eq .CommonLabels.severity "critical" }}critical{{ else if eq .CommonLabels.severity "warning" }}warning{{ else }}info{{ end }}'

        # 알림 요약
        description: '{{ .CommonAnnotations.summary }}'

        # 클라이언트 정보 (PagerDuty UI에서 링크로 표시)
        client: 'AlertManager'
        client_url: '{{ .ExternalURL }}'

        # 상세 정보 (PagerDuty Incident Detail에 표시)
        details:
          alertname: '{{ .CommonLabels.alertname }}'
          namespace: '{{ .CommonLabels.namespace }}'
          firing: '{{ .Alerts.Firing | len }}'
          resolved: '{{ .Alerts.Resolved | len }}'
          cluster: '{{ .CommonLabels.cluster }}'

        # 커스텀 링크
        links:
          - href: '{{ (index .Alerts 0).Annotations.runbook_url }}'
            text: 'Runbook'
          - href: '{{ (index .Alerts 0).Annotations.dashboard_url }}'
            text: 'Dashboard'

        # 이미지 (선택)
        images:
          - src: '{{ (index .Alerts 0).Annotations.graph_url }}'
            alt: 'Metric Graph'
```

**PagerDuty dedup_key**: AlertManager는 기본적으로 `group_key`를 기반으로 `dedup_key`를 자동 생성한다. 동일한 `dedup_key`를 가진 이벤트는 PagerDuty에서 같은 Incident로 그룹핑된다. AlertManager가 resolved 알림을 전송하면 PagerDuty가 해당 Incident를 자동으로 resolve한다.

**severity 매핑 가이드**:

| AlertManager severity | PagerDuty severity | PagerDuty 동작 |
|---|---|---|
| critical | critical | 즉시 on-call 호출 (전화, SMS) |
| warning | warning | 알림만 전송 (이메일, 앱 푸시) |
| info | info | 정보성 이벤트 |

### Email 심화

Email receiver는 SMTP 서버를 통해 알림을 전송한다.

```yaml
# global 섹션에서 SMTP 기본 설정
global:
  smtp_smarthost: 'smtp.gmail.com:587'
  smtp_from: 'alertmanager@example.com'
  smtp_auth_username: 'alertmanager@example.com'
  smtp_auth_password: '<app-password>'
  smtp_auth_identity: 'alertmanager@example.com'
  smtp_require_tls: true

receivers:
  - name: email-team
    email_configs:
      - to: 'oncall@example.com, team-lead@example.com'    # 다중 수신자
        send_resolved: true
        headers:
          Subject: '[{{ .Status | toUpper }}{{ if eq .Status "firing" }}:{{ .Alerts.Firing | len }}{{ end }}] {{ .CommonLabels.alertname }}'
          Reply-To: 'no-reply@example.com'
        html: '{{ template "email.custom.html" . }}'
        text: '{{ template "email.custom.text" . }}'
        require_tls: true
```

**HTML 이메일 템플릿 예시**:

```
{{ define "email.custom.html" }}
<html>
<head>
<style>
  body { font-family: Arial, sans-serif; }
  .alert { border: 1px solid #ddd; padding: 10px; margin: 5px 0; }
  .critical { border-left: 4px solid #e74c3c; }
  .warning { border-left: 4px solid #f39c12; }
  .resolved { border-left: 4px solid #2ecc71; }
</style>
</head>
<body>
  <h2>{{ .Status | toUpper }}: {{ .CommonLabels.alertname }}</h2>
  <p>Receiver: {{ .Receiver }}</p>

  {{ if gt (len .Alerts.Firing) 0 }}
  <h3>Firing Alerts ({{ .Alerts.Firing | len }})</h3>
  {{ range .Alerts.Firing }}
  <div class="alert {{ .Labels.severity }}">
    <strong>{{ .Labels.alertname }}</strong><br/>
    Severity: {{ .Labels.severity }}<br/>
    Namespace: {{ .Labels.namespace }}<br/>
    Summary: {{ .Annotations.summary }}<br/>
    Started: {{ .StartsAt.Format "2006-01-02 15:04:05" }}<br/>
    {{ if .Annotations.runbook_url }}
    <a href="{{ .Annotations.runbook_url }}">Runbook</a>
    {{ end }}
  </div>
  {{ end }}
  {{ end }}

  {{ if gt (len .Alerts.Resolved) 0 }}
  <h3>Resolved Alerts ({{ .Alerts.Resolved | len }})</h3>
  {{ range .Alerts.Resolved }}
  <div class="alert resolved">
    <strong>{{ .Labels.alertname }}</strong> - Resolved at {{ .EndsAt.Format "2006-01-02 15:04:05" }}
  </div>
  {{ end }}
  {{ end }}
</body>
</html>
{{ end }}
```

### Webhook 심화

Webhook receiver는 가장 범용적인 receiver로, 자체 알림 시스템이나 ChatOps 봇과 연동할 때 사용한다.

**Webhook 페이로드 구조**

AlertManager가 Webhook으로 전송하는 JSON 페이로드의 전체 구조이다:

```json
{
  "version": "4",
  "groupKey": "{}/{alertname=\"HighCPU\"}:{alertname=\"HighCPU\", namespace=\"prod\"}",
  "truncatedAlerts": 0,
  "status": "firing",
  "receiver": "custom-webhook",
  "groupLabels": {
    "alertname": "HighCPU",
    "namespace": "prod"
  },
  "commonLabels": {
    "alertname": "HighCPU",
    "namespace": "prod",
    "severity": "warning"
  },
  "commonAnnotations": {
    "summary": "CPU usage is high"
  },
  "externalURL": "http://alertmanager:9093",
  "alerts": [
    {
      "status": "firing",
      "labels": {
        "alertname": "HighCPU",
        "namespace": "prod",
        "pod": "api-server-abc123",
        "severity": "warning"
      },
      "annotations": {
        "summary": "CPU usage is high",
        "description": "Pod api-server-abc123 CPU usage is 92%",
        "runbook_url": "https://wiki.example.com/runbooks/high-cpu"
      },
      "startsAt": "2024-01-15T10:30:00.000Z",
      "endsAt": "0001-01-01T00:00:00Z",
      "generatorURL": "http://prometheus:9090/graph?g0.expr=...",
      "fingerprint": "7a3b2c1d4e5f"
    }
  ]
}
```

**Webhook 설정 옵션**

```yaml
receivers:
  - name: custom-webhook
    webhook_configs:
      - url: 'https://api.example.com/alerts'
        send_resolved: true
        max_alerts: 0              # 0 = 무제한, 양수 = 최대 알림 수
        http_config:
          authorization:
            type: Bearer
            credentials: '<API_TOKEN>'
          tls_config:
            ca_file: '/etc/ssl/ca.pem'
            cert_file: '/etc/ssl/cert.pem'
            key_file: '/etc/ssl/key.pem'
            insecure_skip_verify: false
          follow_redirects: true
          proxy_url: 'http://proxy:8080'     # 프록시 사용 시
```

**Retry 정책**: Webhook 전송이 실패하면(HTTP 5xx 응답 또는 타임아웃) AlertManager는 지수 백오프(exponential backoff)로 재시도한다. 최초 재시도는 약 10ms 후, 이후 2배씩 증가하며 최대 10분까지 재시도한다. HTTP 4xx 응답은 클라이언트 오류로 판단하여 재시도하지 않는다.

### OpsGenie 심화

```yaml
receivers:
  - name: opsgenie-critical
    opsgenie_configs:
      - api_key: '<OpsGenie API Key>'
        api_url: 'https://api.opsgenie.com/'   # EU 리전: https://api.eu.opsgenie.com/
        message: '{{ .CommonLabels.alertname }}: {{ .CommonAnnotations.summary }}'
        description: |
          {{ range .Alerts }}
          Alert: {{ .Labels.alertname }}
          Instance: {{ .Labels.instance }}
          Summary: {{ .Annotations.summary }}
          {{ end }}
        # Priority 매핑
        priority: '{{ if eq .CommonLabels.severity "critical" }}P1{{ else if eq .CommonLabels.severity "warning" }}P3{{ else }}P5{{ end }}'
        tags: 'alertmanager,{{ .CommonLabels.namespace }},{{ .CommonLabels.severity }}'
        # 담당 팀/사용자 지정
        responders:
          - type: team
            name: 'platform-team'
          - type: user
            username: 'oncall@example.com'
        # OpsGenie가 Alert을 시각적으로 표시하는 정보
        entity: '{{ .CommonLabels.alertname }}/{{ .CommonLabels.namespace }}'
        source: '{{ .ExternalURL }}'
        note: 'Runbook: {{ (index .Alerts 0).Annotations.runbook_url }}'
        # 추가 필드
        details:
          cluster: '{{ .CommonLabels.cluster }}'
          namespace: '{{ .CommonLabels.namespace }}'
```

### Microsoft Teams

Microsoft Teams는 Incoming Webhook을 통해 연동한다. AlertManager에 내장된 Teams receiver가 없으므로 webhook_configs를 사용한다.

```yaml
receivers:
  - name: teams-alerts
    webhook_configs:
      - url: 'https://outlook.office.com/webhook/xxxxxxxx/IncomingWebhook/yyyyyyy/zzzzzzz'
        send_resolved: true
```

Teams Incoming Webhook은 Adaptive Card 형식의 메시지를 지원한다. 별도의 프록시 서비스를 배포하여 AlertManager의 표준 Webhook 페이로드를 Adaptive Card 형식으로 변환하는 패턴이 일반적이다. 오픈소스 프로젝트 `prometheus-msteams`가 이 목적으로 자주 사용된다.

```yaml
# prometheus-msteams 프록시를 사용하는 경우
receivers:
  - name: teams-alerts
    webhook_configs:
      - url: 'http://prometheus-msteams:2000/critical'    # 프록시 서비스
        send_resolved: true
```

### Telegram

```yaml
receivers:
  - name: telegram-alerts
    telegram_configs:
      - bot_token: '<Telegram Bot Token>'     # @BotFather에서 생성
        chat_id: -1001234567890               # 그룹 채팅 ID (음수)
        api_url: 'https://api.telegram.org'   # 기본값
        send_resolved: true
        parse_mode: 'HTML'                    # HTML 또는 MarkdownV2
        message: |
          {{ if eq .Status "firing" }}🔥 <b>FIRING</b>{{ else }}✅ <b>RESOLVED</b>{{ end }}

          <b>Alert:</b> {{ .CommonLabels.alertname }}
          <b>Severity:</b> {{ .CommonLabels.severity }}

          {{ range .Alerts }}
          • {{ .Annotations.summary }}
          {{ end }}
```

Telegram Bot의 `chat_id`를 확인하는 방법:
1. @BotFather에서 봇 생성 후 토큰 획득
2. 봇을 대상 그룹에 추가
3. `https://api.telegram.org/bot<TOKEN>/getUpdates` 호출
4. 응답에서 `chat.id` 확인

### VictorOps (Splunk On-Call)

```yaml
receivers:
  - name: victorops-critical
    victorops_configs:
      - api_key: '<VictorOps API Key>'
        api_url: 'https://alert.victorops.com/integrations/generic/20131114/alert/'
        routing_key: 'platform-team'
        entity_id: '{{ .CommonLabels.alertname }}/{{ .CommonLabels.namespace }}'
        state_message: '{{ .CommonAnnotations.summary }}'
        message_type: '{{ if eq .CommonLabels.severity "critical" }}CRITICAL{{ else if eq .CommonLabels.severity "warning" }}WARNING{{ else }}INFO{{ end }}'
        # 추가 필드
        custom_fields:
          cluster: '{{ .CommonLabels.cluster }}'
          runbook: '{{ (index .Alerts 0).Annotations.runbook_url }}'
```

### 커스텀 Receiver 구현 (Webhook → 자체 서비스)

AlertManager가 기본 지원하지 않는 채널(예: 카카오톡, 잔디, 사내 메신저)로 알림을 전송하려면 Webhook receiver를 사용하여 중간 프록시 서비스를 구현한다.

```
AlertManager ──Webhook──► 커스텀 프록시 서비스 ──► 대상 채널
                            (JSON 수신 → 변환 → 전송)
```

커스텀 프록시 서비스의 구현 골격 (Python Flask 예시):

```python
from flask import Flask, request, jsonify
import requests

app = Flask(__name__)

@app.route('/webhook', methods=['POST'])
def handle_alert():
    data = request.json

    # AlertManager 페이로드 파싱
    status = data['status']
    alerts = data['alerts']

    for alert in alerts:
        alertname = alert['labels'].get('alertname', 'Unknown')
        severity = alert['labels'].get('severity', 'unknown')
        summary = alert['annotations'].get('summary', '')

        # 대상 채널로 전송 (예: 사내 메신저 API)
        message = f"[{status.upper()}] {alertname}\nSeverity: {severity}\n{summary}"

        requests.post(
            'https://internal-messenger.example.com/api/send',
            json={
                'channel': '#monitoring',
                'message': message
            }
        )

    return jsonify({'status': 'ok'}), 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5001)
```

```yaml
# AlertManager 설정
receivers:
  - name: custom-messenger
    webhook_configs:
      - url: 'http://custom-proxy:5001/webhook'
        send_resolved: true
```

---

## 알림 템플릿 심화

### Go template 문법 상세

AlertManager의 템플릿은 Go의 `text/template` 패키지를 기반으로 한다. 핵심 문법을 상세히 정리한다.

**변수 접근**

```
{{ .Status }}                         # 현재 컨텍스트의 Status 필드
{{ .CommonLabels.alertname }}         # CommonLabels 맵의 alertname 값
{{ (index .Alerts 0).Labels.pod }}    # Alerts 배열의 첫 번째 항목의 Labels.pod
```

**조건문**

```
{{ if eq .Status "firing" }}
  알림 발생 중
{{ else if eq .Status "resolved" }}
  알림 해소됨
{{ end }}

{{ if gt (len .Alerts.Firing) 0 }}
  Firing 알림 {{ .Alerts.Firing | len }}건
{{ end }}
```

**반복문**

```
{{ range .Alerts }}
  Alert: {{ .Labels.alertname }}
  Severity: {{ .Labels.severity }}
{{ end }}

{{ range $key, $value := .CommonLabels }}
  {{ $key }}: {{ $value }}
{{ end }}
```

**변수 할당**

```
{{ $firing := .Alerts.Firing | len }}
{{ $resolved := .Alerts.Resolved | len }}
Firing: {{ $firing }}, Resolved: {{ $resolved }}
```

**파이프라인**

```
{{ .Status | toUpper }}                    # "FIRING" 또는 "RESOLVED"
{{ .Alerts.Firing | len }}                 # firing 알림 수
{{ .CommonLabels.alertname | title }}      # 첫 글자 대문자
```

**공백 제어**

`{{-`와 `-}}`를 사용하여 출력의 앞뒤 공백을 제거한다.

```
{{- if eq .Status "firing" -}}
FIRING
{{- end -}}
```

### 사용 가능한 데이터 필드 전체 목록

**최상위 데이터 구조 (Notification Data)**

| 필드 | 타입 | 설명 |
|------|------|------|
| `.Receiver` | string | receiver 이름이다 |
| `.Status` | string | "firing" 또는 "resolved"이다. 그룹 내 하나라도 firing이면 "firing"이다 |
| `.Alerts` | Alert 목록 | 그룹 내 모든 알림 목록이다 |
| `.Alerts.Firing` | Alert 목록 | firing 상태인 알림만 필터링한 목록이다 |
| `.Alerts.Resolved` | Alert 목록 | resolved 상태인 알림만 필터링한 목록이다 |
| `.GroupLabels` | KV | group_by에 지정된 label의 key-value 쌍이다 |
| `.CommonLabels` | KV | 그룹 내 모든 알림에 공통인 label이다 |
| `.CommonAnnotations` | KV | 그룹 내 모든 알림에 공통인 annotation이다 |
| `.ExternalURL` | string | AlertManager의 외부 URL이다 |

### .Alerts 배열의 각 항목

| 필드 | 타입 | 설명 |
|------|------|------|
| `.Status` | string | 개별 알림의 상태 ("firing" 또는 "resolved")이다 |
| `.Labels` | KV | 알림의 전체 label set이다 |
| `.Annotations` | KV | 알림의 전체 annotation set이다 |
| `.StartsAt` | time.Time | 알림이 최초 firing된 시각이다 |
| `.EndsAt` | time.Time | 알림이 resolved된 시각이다 (firing 중이면 미래 시각)이다 |
| `.GeneratorURL` | string | 알림을 생성한 Prometheus expression browser URL이다 |
| `.Fingerprint` | string | 알림의 고유 식별자 (label set 해시)이다 |

**KV 타입의 메서드**

| 메서드 | 설명 | 예시 |
|--------|------|------|
| `.SortedPairs` | key로 정렬된 key-value 쌍 목록을 반환한다 | `{{ range .CommonLabels.SortedPairs }}{{ .Name }}={{ .Value }}{{ end }}` |
| `.Names` | key 목록을 반환한다 | `{{ .CommonLabels.Names }}` |
| `.Values` | value 목록을 반환한다 | `{{ .CommonLabels.Values }}` |
| `.Remove` | 특정 key를 제거한 새 KV를 반환한다 | `{{ .CommonLabels.Remove "severity" }}` |

### 내장 함수 전체 목록

| 함수 | 설명 | 예시 |
|------|------|------|
| `title` | 첫 글자를 대문자로 변환한다 | `{{ "firing" \| title }}` → `Firing` |
| `toUpper` | 전체를 대문자로 변환한다 | `{{ "firing" \| toUpper }}` → `FIRING` |
| `toLower` | 전체를 소문자로 변환한다 | `{{ "CRITICAL" \| toLower }}` → `critical` |
| `match` | 정규식 매칭 여부를 반환한다 | `{{ match "^High.*" .Labels.alertname }}` |
| `reReplaceAll` | 정규식으로 치환한다 | `{{ reReplaceAll ":[0-9]+" "" .Labels.instance }}` |
| `join` | 리스트를 구분자로 결합한다 | `{{ .CommonLabels.Values \| join ", " }}` |
| `safeHtml` | HTML 이스케이프를 방지한다 | `{{ .Annotations.description \| safeHtml }}` |
| `stringSlice` | 문자열을 슬라이스로 변환한다 | `{{ stringSlice "a" "b" "c" }}` |
| `date` | 시간을 포맷팅한다 | `{{ .StartsAt \| date "2006-01-02 15:04" }}` |
| `tz` | 시간대를 변환한다 | `{{ .StartsAt \| tz "Asia/Seoul" }}` |
| `since` | 경과 시간을 반환한다 | `{{ .StartsAt \| since }}` → `2h30m` |
| `humanizeDuration` | 초를 사람이 읽기 쉬운 형식으로 변환한다 | `{{ 3661 \| humanizeDuration }}` → `1h1m1s` |
| `humanizePercentage` | 소수를 퍼센트로 변환한다 | `{{ 0.925 \| humanizePercentage }}` → `92.5%` |

### 외부 템플릿 파일 관리

복잡한 템플릿은 별도의 `.tmpl` 파일로 분리하여 관리하는 것이 권장된다.

```yaml
# alertmanager.yml
templates:
  - '/etc/alertmanager/templates/*.tmpl'
```

```
# 파일 구조
/etc/alertmanager/templates/
├── slack.tmpl          # Slack 전용 템플릿
├── pagerduty.tmpl      # PagerDuty 전용 템플릿
├── email.tmpl          # Email 전용 템플릿
└── common.tmpl         # 공통 헬퍼 함수
```

**common.tmpl**

```
{{ define "common.severity_icon" -}}
{{ if eq .Labels.severity "critical" }}🔴{{ else if eq .Labels.severity "warning" }}🟡{{ else }}🔵{{ end }}
{{- end }}

{{ define "common.alert_list" -}}
{{ range . }}
• {{ template "common.severity_icon" . }} {{ .Labels.alertname }} ({{ .Labels.namespace }}/{{ .Labels.pod }})
  Summary: {{ .Annotations.summary }}
  Started: {{ .StartsAt | date "2006-01-02 15:04:05" }}
{{ end }}
{{- end }}
```

### Slack 전용 템플릿 예제

```
# slack.tmpl
{{ define "slack.title" -}}
[{{ .Status | toUpper }}{{ if eq .Status "firing" }}:{{ .Alerts.Firing | len }}{{ end }}] {{ .CommonLabels.alertname }}
{{- end }}

{{ define "slack.text" -}}
{{ if eq .Status "firing" -}}
*Firing Alerts:*
{{ template "common.alert_list" .Alerts.Firing }}
{{- end }}
{{ if eq .Status "resolved" -}}
*Resolved Alerts:*
{{ range .Alerts.Resolved }}
• ✅ {{ .Labels.alertname }} (resolved at {{ .EndsAt | date "15:04:05" }})
{{ end }}
{{- end }}

*Labels:*
{{ range .CommonLabels.SortedPairs }}• {{ .Name }}: `{{ .Value }}`
{{ end }}

{{ if (index .Alerts 0).Annotations.runbook_url -}}
📖 <{{ (index .Alerts 0).Annotations.runbook_url }}|Runbook>
{{- end }}
{{- end }}

{{ define "slack.color" -}}
{{ if eq .Status "firing" }}{{ if eq .CommonLabels.severity "critical" }}#e74c3c{{ else if eq .CommonLabels.severity "warning" }}#f39c12{{ else }}#3498db{{ end }}{{ else }}#2ecc71{{ end }}
{{- end }}
```

### PagerDuty 전용 템플릿 예제

```
# pagerduty.tmpl
{{ define "pagerduty.description" -}}
{{ .CommonAnnotations.summary }}
{{- end }}

{{ define "pagerduty.instances" -}}
{{ range . }}
  - {{ .Labels.instance }}: {{ .Annotations.summary }}
{{ end }}
{{- end }}

{{ define "pagerduty.custom_details" -}}
Alertname: {{ .CommonLabels.alertname }}
Namespace: {{ .CommonLabels.namespace }}
Cluster: {{ .CommonLabels.cluster }}
Firing: {{ .Alerts.Firing | len }}
Resolved: {{ .Alerts.Resolved | len }}

Firing Instances:
{{ template "pagerduty.instances" .Alerts.Firing }}

{{ if gt (len .Alerts.Resolved) 0 -}}
Resolved Instances:
{{ template "pagerduty.instances" .Alerts.Resolved }}
{{ end -}}
{{- end }}
```

---

## High Availability 심화

### Gossip 프로토콜 (memberlist): 피어 디스커버리, 상태 전파

AlertManager의 클러스터링은 HashiCorp의 `memberlist` 라이브러리를 사용하여 구현된 Gossip 프로토콜 기반이다. 중앙화된 코디네이터(예: ZooKeeper, etcd) 없이 분산 합의를 달성한다.

```
┌─────────────────────────────────────────────────────────┐
│                  Gossip Protocol 동작                     │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  AlertManager-0 ◄──── TCP/UDP :9094 ────► AlertManager-1 │
│       │                                        │         │
│       └──────── TCP/UDP :9094 ───► AlertManager-2        │
│                                        │                 │
│                    AlertManager-1 ◄────┘                  │
│                                                          │
│  전파 방식: Push/Pull Gossip                              │
│  - 주기적으로 랜덤 피어에게 상태 전송 (Push)               │
│  - 피어에게 상태 요청 (Pull)                               │
│  - 새 정보 수신 시 다른 피어에게 전파 (Epidemic spread)     │
│                                                          │
│  전파 데이터:                                             │
│  1. Silence 상태 (생성, 만료)                             │
│  2. Notification Log (전송 이력)                          │
│  3. 멤버십 정보 (노드 추가/제거)                          │
│                                                          │
│  수렴 시간: 보통 수 초 이내                                │
│  (클러스터 크기에 따라 O(log N))                           │
└─────────────────────────────────────────────────────────┘
```

**피어 디스커버리 방법**

AlertManager 인스턴스가 클러스터에 참여하는 방법은 두 가지이다.

```bash
# 방법 1: --cluster.peer 플래그로 직접 지정
alertmanager \
  --cluster.listen-address=0.0.0.0:9094 \
  --cluster.peer=alertmanager-0:9094 \
  --cluster.peer=alertmanager-1:9094 \
  --cluster.peer=alertmanager-2:9094

# 방법 2: DNS SRV 레코드 활용 (Kubernetes Headless Service)
# Kubernetes에서는 Headless Service를 통해 자동으로 피어를 디스커버리한다
alertmanager \
  --cluster.listen-address=0.0.0.0:9094 \
  --cluster.peer=alertmanager-headless:9094
```

Kubernetes 환경에서 Headless Service를 사용하면 StatefulSet의 Pod가 추가/제거될 때 자동으로 피어가 업데이트된다.

### Deduplication 메커니즘: Notification Log 공유

HA 환경에서 Prometheus는 동일한 알림을 모든 AlertManager 인스턴스에 전송한다. 중복 전송을 방지하는 핵심 메커니즘이 Notification Log이다.

```
Prometheus ──► AlertManager-0: 알림 A 수신
          ──► AlertManager-1: 알림 A 수신 (동일한 알림)
          ──► AlertManager-2: 알림 A 수신 (동일한 알림)

AlertManager-0:
  1. 알림 A 처리 시작
  2. Notification Log 확인 → 미전송 상태
  3. 알림 A를 Slack으로 전송
  4. Notification Log에 기록: {group_key: "...", receiver: "slack", timestamp: ...}
  5. Gossip으로 Notification Log를 AlertManager-1, -2에 전파

AlertManager-1:
  1. 알림 A 처리 시작
  2. Notification Log 확인 → AlertManager-0에서 이미 전송됨 (Gossip으로 수신)
  3. 전송 스킵

AlertManager-2:
  1. 알림 A 처리 시작
  2. Notification Log 확인 → AlertManager-0에서 이미 전송됨
  3. 전송 스킵

결과: 알림 A는 정확히 1회만 전송됨
```

Notification Log의 키는 `(group_key, receiver)` 쌍이다. 동일한 group_key의 알림이 동일한 receiver에게 이미 전송되었으면 중복으로 판단한다.

**타이밍 이슈**: Gossip 전파에는 약간의 지연이 있다(보통 수 초). 극단적으로 짧은 시간 내에 여러 인스턴스가 동시에 전송을 시도하면 중복이 발생할 수 있다. `group_wait` 타이머가 이 문제를 완화하는 역할을 한다. `group_wait` 동안 Gossip이 전파될 시간이 확보되기 때문이다.

### StatefulSet 기반 HA 배포

```yaml
apiVersion: v1
kind: Service
metadata:
  name: alertmanager-headless
  namespace: monitoring
spec:
  type: ClusterIP
  clusterIP: None                # Headless Service
  selector:
    app: alertmanager
  ports:
    - name: http
      port: 9093
      targetPort: 9093
    - name: cluster
      port: 9094
      targetPort: 9094
---
apiVersion: v1
kind: Service
metadata:
  name: alertmanager
  namespace: monitoring
spec:
  type: ClusterIP
  selector:
    app: alertmanager
  ports:
    - name: http
      port: 9093
      targetPort: 9093
---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: alertmanager
  namespace: monitoring
spec:
  serviceName: alertmanager-headless
  replicas: 3
  selector:
    matchLabels:
      app: alertmanager
  template:
    metadata:
      labels:
        app: alertmanager
    spec:
      containers:
        - name: alertmanager
          image: prom/alertmanager:v0.27.0
          args:
            - '--config.file=/etc/alertmanager/alertmanager.yml'
            - '--storage.path=/alertmanager'
            - '--cluster.listen-address=0.0.0.0:9094'
            - '--cluster.peer=alertmanager-0.alertmanager-headless:9094'
            - '--cluster.peer=alertmanager-1.alertmanager-headless:9094'
            - '--cluster.peer=alertmanager-2.alertmanager-headless:9094'
            - '--cluster.reconnect-timeout=5m'
          ports:
            - containerPort: 9093
              name: http
            - containerPort: 9094
              name: cluster
          volumeMounts:
            - name: config
              mountPath: /etc/alertmanager
            - name: storage
              mountPath: /alertmanager
          readinessProbe:
            httpGet:
              path: /-/ready
              port: 9093
            initialDelaySeconds: 5
          livenessProbe:
            httpGet:
              path: /-/healthy
              port: 9093
            initialDelaySeconds: 10
      volumes:
        - name: config
          configMap:
            name: alertmanager-config
  volumeClaimTemplates:
    - metadata:
        name: storage
      spec:
        accessModes: ['ReadWriteOnce']
        resources:
          requests:
            storage: 1Gi
```

### 3-node 클러스터 구성 권장

AlertManager 클러스터는 홀수 개의 인스턴스로 구성하는 것이 권장된다.

| 인스턴스 수 | 장애 허용 | 권장 여부 | 비고 |
|---|---|---|---|
| 1 | 0 | 개발/테스트 | SPOF 존재 |
| 2 | 0 | 비권장 | Split-brain 위험 |
| 3 | 1 | 프로덕션 권장 | 1대 장애 허용 |
| 5 | 2 | 대규모 | 2대 장애 허용 |

3-node가 가장 일반적으로 권장되는 이유:
- 1대가 장애 나더라도 나머지 2대가 정상 동작한다.
- Gossip 프로토콜의 수렴 시간이 짧다 (노드 수가 적을수록).
- 리소스 사용량과 안정성 사이의 적절한 균형이다.

### Split-brain 방지

AlertManager의 Gossip 기반 클러스터에서 Split-brain은 네트워크 파티션으로 인해 클러스터가 두 개 이상의 독립적인 그룹으로 분리되는 현상이다. 이 경우 각 그룹이 독립적으로 알림을 전송하므로 중복 전송이 발생한다.

**방지 및 완화 전략**:

1. **같은 가용 영역(AZ) 배포**: AlertManager 인스턴스를 같은 네트워크 세그먼트에 배포하여 네트워크 파티션 가능성을 최소화한다.

2. **cluster.reconnect-timeout 설정**: 피어 연결이 끊어진 후 재연결을 시도하는 시간이다. 적절한 값을 설정하여 일시적 네트워크 문제를 허용한다.

3. **cluster.settle-timeout 설정**: 클러스터가 안정화되기까지 기다리는 시간이다. 이 시간 동안 알림 전송을 지연하여 Gossip 전파가 완료되기를 기다린다.

```bash
alertmanager \
  --cluster.listen-address=0.0.0.0:9094 \
  --cluster.peer=alertmanager-0:9094 \
  --cluster.peer=alertmanager-1:9094 \
  --cluster.reconnect-timeout=5m \
  --cluster.settle-timeout=15s \
  --cluster.pushpull-interval=1m
```

Split-brain이 발생하더라도 중복 알림이 발생하는 것이지 알림이 누락되지는 않는다. 따라서 AlertManager의 HA 설계는 "알림 누락보다 중복이 낫다(better duplicate than miss)"는 원칙을 따른다.

---

## 알림 설계 모범 사례

### 알림 피로 방지 전략 (5가지 원칙)

알림 피로(Alert Fatigue)는 과도한 알림으로 인해 운영자가 모든 알림을 무시하게 되는 현상이다. "양치기 소년 효과"와 동일한 문제이다. 다음 5가지 원칙을 지켜야 한다.

**원칙 1: Every alert must be actionable (모든 알림은 행동 가능해야 한다)**

알림을 받았을 때 운영자가 취할 수 있는 구체적인 행동이 있어야 한다. "CPU가 60%이다"는 정보일 뿐 알림이 아니다. "CPU가 95%이고 서비스 응답 시간이 2초를 초과했으므로 스케일 아웃이 필요하다"가 행동 가능한 알림이다.

**원칙 2: Every alert must require human intelligence (모든 알림은 사람의 판단이 필요해야 한다)**

자동으로 복구할 수 있는 문제는 알림 대신 자동 복구 메커니즘을 구현한다. Kubernetes의 자동 재시작, HPA(Horizontal Pod Autoscaler)로 해결 가능한 문제는 알림으로 만들지 않는다.

**원칙 3: Every alert must be unique (모든 알림은 고유해야 한다)**

동일한 문제에 대해 여러 각도의 알림이 동시에 발생하지 않도록 한다. Inhibition Rule을 적극 활용하여 근본 원인 알림만 전달한다.

**원칙 4: Every alert must have appropriate severity (모든 알림은 적절한 심각도를 가져야 한다)**

critical 알림이 실제로 critical하지 않으면 운영자는 critical 알림도 무시하게 된다. severity 레벨의 의미를 조직 내에서 명확히 합의하고 엄격하게 적용한다.

**원칙 5: Every alert must be reviewed periodically (모든 알림은 주기적으로 검토되어야 한다)**

최소 분기별로 알림 규칙을 리뷰한다. 자주 무시되거나 자주 silence되는 알림은 임계값을 조정하거나 삭제한다.

### Severity 레벨 정의 가이드

조직 내에서 severity의 의미를 명확히 정의하고, 이를 기반으로 에스컬레이션 정책을 수립한다.

**critical**

| 항목 | 기준 |
|------|------|
| 정의 | 서비스 중단, 데이터 손실 위험, 또는 고객 영향이 발생한 상태이다 |
| 대응 시간 | 즉시 (5분 이내 인지, 30분 이내 조치 착수) |
| 대응 방법 | on-call 엔지니어 즉시 호출 (PagerDuty 전화/SMS) |
| 예시 | 서비스 다운, 데이터베이스 연결 불가, 디스크 만도(99% 이상), 클러스터 노드 다운 |
| Receiver | PagerDuty + Slack #critical |
| repeat_interval | 1시간 |

**warning**

| 항목 | 기준 |
|------|------|
| 정의 | 성능 저하 또는 곧 문제가 될 수 있는 상태이다. 현재 서비스에 직접적인 영향은 없다 |
| 대응 시간 | 업무 시간 내 (4시간 이내) |
| 대응 방법 | Slack 채널 확인 후 티켓 생성 |
| 예시 | CPU 80% 이상, 디스크 85% 이상, Pod 재시작 빈도 증가 |
| Receiver | Slack #warning |
| repeat_interval | 4시간 |

**info**

| 항목 | 기준 |
|------|------|
| 정의 | 참고용 알림이다. 즉각적인 대응이 필요하지 않다 |
| 대응 시간 | 다음 업무일 확인 |
| 대응 방법 | 대시보드 또는 Slack 확인 |
| 예시 | 인증서 만료 30일 전, 새 버전 출시, 비정상적이지만 위험하지 않은 패턴 |
| Receiver | Slack #info (별도 채널) |
| repeat_interval | 24시간 |

### 네이밍 컨벤션

일관된 알림 이름은 가독성과 자동화 모두에 중요하다.

```
# 권장 패턴
<Component><Condition>
<Component>High<Metric>
<Component><Metric>Near<Threshold>
<Component><Metric>Absent

# 좋은 예시
NodeDown
NodeHighCPU
PodCrashLooping
PodOOMKilled
DiskSpaceNearFull
CertificateExpiringSoon
EndpointDown
APILatencyHigh
ErrorRateHigh
MetricsAbsent

# 나쁜 예시
Alert1
CPUAlert
Problem
Warning
ServerIssue
Check_This
```

추가 네이밍 규칙:
- CamelCase를 사용한다 (snake_case가 아닌).
- 알림 이름만으로 어떤 문제인지 파악 가능해야 한다.
- 대상(Component) + 상태(Condition) 구조를 유지한다.
- 약어는 가능한 피하되, 널리 알려진 약어(CPU, OOM, API 등)는 사용 가능하다.

### Runbook URL 필수화

모든 알림에 `runbook_url` annotation을 포함하는 것을 조직 정책으로 수립해야 한다. Runbook에는 다음 항목이 포함되어야 한다.

```
## Runbook: NodeHighCPU

### 알림 설명
- 의미: 노드의 CPU 사용률이 80%를 5분 이상 초과한 상태이다
- 영향: 해당 노드의 Pod 성능 저하 가능성이 있다
- 심각도: warning

### 진단 절차
1. 해당 노드의 CPU 사용 현황 확인
   - Grafana Dashboard: https://grafana.example.com/d/node-cpu
   - 명령어: kubectl top node <node-name>

2. CPU를 많이 사용하는 Pod 확인
   - kubectl top pod --all-namespaces --sort-by=cpu | head -20

3. 원인 분석
   - 새로운 배포가 있었는지 확인
   - 트래픽 증가 여부 확인
   - 비정상적인 Pod 동작 확인

### 대응 절차
1. 일시적 스파이크 (배포 관련):
   - 배포 완료 후 정상화 여부 모니터링

2. 트래픽 증가:
   - HPA가 설정되어 있다면 자동 스케일 아웃 대기
   - 수동 스케일 아웃: kubectl scale deployment <name> --replicas=<N>

3. 특정 Pod 이상:
   - 해당 Pod 로그 확인
   - 필요 시 Pod 재시작

### 에스컬레이션
- 30분 이내 해결 불가 시: 팀 리더에게 에스컬레이션
- 서비스 영향 발생 시: Incident 선언

### 과거 사례
- 2024-01-10: 배포 후 init container의 CPU limit 미설정으로 발생. limit 추가로 해결
- 2024-02-15: 크론잡의 CPU 사용 급증. 크론잡 스케줄 조정으로 해결
```

### SLO 기반 알림 설계

SLO(Service Level Objective) 기반 알림은 사용자 경험에 직접 영향을 미치는 지표를 기준으로 알림을 설계하는 접근법이다. 단순한 리소스 임계값 대신 SLI(Service Level Indicator)의 에러 버짓(Error Budget) 소진율을 기반으로 알림을 생성한다.

```yaml
# SLO: 99.9% 가용성 (월간 허용 다운타임: 43.2분)
# SLI: HTTP 요청 성공률

# 빠른 소진율 알림 (1시간 윈도우)
- alert: SLOErrorBudgetBurn_Fast
  expr: |
    (
      sum(rate(http_requests_total{code=~"5.."}[1h]))
      /
      sum(rate(http_requests_total[1h]))
    ) > 14.4 * 0.001
  for: 2m
  labels:
    severity: critical
    slo: availability
  annotations:
    summary: "에러 버짓이 빠르게 소진 중이다 (1시간 기준 14.4배 속도)"
    description: "현재 속도로 에러가 지속되면 약 1시간 후 월간 에러 버짓이 소진된다"
    runbook_url: "https://wiki.example.com/runbooks/slo-burn"

# 느린 소진율 알림 (6시간 윈도우)
- alert: SLOErrorBudgetBurn_Slow
  expr: |
    (
      sum(rate(http_requests_total{code=~"5.."}[6h]))
      /
      sum(rate(http_requests_total[6h]))
    ) > 6 * 0.001
  for: 15m
  labels:
    severity: warning
    slo: availability
  annotations:
    summary: "에러 버짓이 꾸준히 소진 중이다 (6시간 기준 6배 속도)"
    runbook_url: "https://wiki.example.com/runbooks/slo-burn"
```

### Golden Signals 기반 알림 (Latency, Traffic, Errors, Saturation)

Google SRE의 4가지 Golden Signals를 기반으로 서비스 건강 상태를 종합적으로 모니터링한다.

```yaml
groups:
  - name: golden-signals
    rules:
      # 1. Latency (지연 시간)
      - alert: HighLatency
        expr: |
          histogram_quantile(0.99,
            sum(rate(http_request_duration_seconds_bucket[5m])) by (le, service)
          ) > 1.0
        for: 5m
        labels:
          severity: warning
          signal: latency
        annotations:
          summary: "{{ $labels.service }} 서비스의 p99 지연 시간이 1초를 초과했다"

      # 2. Traffic (트래픽)
      - alert: TrafficAnomaly
        expr: |
          sum(rate(http_requests_total[5m])) by (service)
          > 2 * sum(rate(http_requests_total[5m] offset 1w)) by (service)
        for: 15m
        labels:
          severity: warning
          signal: traffic
        annotations:
          summary: "{{ $labels.service }} 서비스 트래픽이 지난주 동시간 대비 2배를 초과했다"

      # 3. Errors (오류율)
      - alert: HighErrorRate
        expr: |
          sum(rate(http_requests_total{code=~"5.."}[5m])) by (service)
          /
          sum(rate(http_requests_total[5m])) by (service)
          > 0.01
        for: 5m
        labels:
          severity: critical
          signal: errors
        annotations:
          summary: "{{ $labels.service }} 서비스의 오류율이 1%를 초과했다"

      # 4. Saturation (포화도)
      - alert: HighSaturation
        expr: |
          (
            sum(container_memory_working_set_bytes{container!=""}) by (namespace, pod)
            /
            sum(kube_pod_container_resource_limits{resource="memory"}) by (namespace, pod)
          ) > 0.9
        for: 5m
        labels:
          severity: warning
          signal: saturation
        annotations:
          summary: "{{ $labels.namespace }}/{{ $labels.pod }}의 메모리 사용률이 90%를 초과했다"
```

### 알림 검토 프로세스 (주간 리뷰)

효과적인 알림 시스템을 유지하려면 정기적인 리뷰가 필수이다.

**주간 리뷰 체크리스트**:

1. **지난 1주일간 발생한 알림 통계 분석**
   - 총 알림 수, severity별 분포
   - 가장 빈번하게 발생한 알림 Top 10
   - 가장 자주 silence된 알림

2. **각 알림에 대한 평가**
   - 이 알림이 실제 행동으로 이어졌는가?
   - 이 알림이 무시되지 않았는가?
   - 임계값이 적절한가?
   - 알림이 너무 자주/드물게 발생하는가?

3. **개선 액션**
   - 자주 무시되는 알림: 임계값 조정 또는 삭제
   - 자주 silence되는 알림: 자동화 검토
   - 누락된 알림: 새 규칙 추가
   - Runbook 업데이트 필요 여부

```bash
# 주간 리뷰를 위한 알림 통계 쿼리 (Prometheus)

# 지난 7일간 발생한 알림 수 (alertname별)
count_over_time(ALERTS{alertstate="firing"}[7d])

# 가장 빈번하게 발생한 알림 Top 10
topk(10, count_over_time(ALERTS{alertstate="firing"}[7d]))
```

---

## Prometheus Alert Rules 심화

### Recording Rules vs Alerting Rules

Prometheus에서 Rule은 두 가지 유형이 있다.

| 구분 | Recording Rule | Alerting Rule |
|------|---|---|
| 목적 | 복잡한 쿼리를 미리 계산하여 새 시계열로 저장한다 | 조건이 충족되면 AlertManager로 알림을 전송한다 |
| 결과 | 새로운 metric이 생성된다 | Alert이 firing 상태가 된다 |
| 문법 | `record:` 키워드 | `alert:` 키워드 |
| 사용 목적 | 대시보드 성능 최적화, alerting rule의 기반 쿼리 | 문제 탐지 및 알림 |

```yaml
groups:
  - name: recording-rules
    rules:
      # Recording Rule: HTTP 요청 에러율을 미리 계산
      - record: service:http_error_rate:ratio_rate5m
        expr: |
          sum(rate(http_requests_total{code=~"5.."}[5m])) by (service)
          /
          sum(rate(http_requests_total[5m])) by (service)

  - name: alerting-rules
    rules:
      # Alerting Rule: 미리 계산된 에러율을 기반으로 알림
      - alert: HighErrorRate
        expr: service:http_error_rate:ratio_rate5m > 0.01
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "{{ $labels.service }} 에러율 {{ $value | humanizePercentage }}"
```

Recording Rule의 네이밍 컨벤션:
```
level:metric:operations
예: service:http_error_rate:ratio_rate5m
    │       │               │
    │       │               └─ 연산 방법 (ratio, rate, 윈도우)
    │       └─ 원본 메트릭 이름
    └─ 집계 레벨 (service, namespace, cluster 등)
```

### `for` 절의 의미와 Pending 상태

`for` 절은 알림 조건이 지속적으로 충족되어야 하는 최소 시간이다. 이 시간 동안 알림은 **Pending** 상태에 머무른다.

```
알림 조건 (CPU > 80%) 평가:
                                                                    시간 →
평가 간격:  ┃     ┃     ┃     ┃     ┃     ┃     ┃     ┃     ┃     ┃
CPU 값:    75%   85%   90%   88%   92%   70%   85%   90%   95%   93%
조건 충족:   X     O     O     O     O     X     O     O     O     O
                  │     │     │     │           │     │     │     │
                  └─────┴─────┴─────┘           └─────┴─────┴─────┘
                   Pending 상태                   Pending 상태
                   (for: 5m)                      (for: 5m)
                        │                                   │
                  5분 경과 전에                          5분 경과 후
                  조건 해소 → 알림 안 됨                → Firing! 알림 전송
```

`for` 절이 없으면(또는 `for: 0s`) 조건이 한 번이라도 충족되면 즉시 firing 상태가 된다. 일시적 스파이크에 알림이 발생하지 않도록 적절한 `for` 기간을 설정하는 것이 중요하다.

| 알림 유형 | 권장 `for` 값 | 이유 |
|-----------|---|---|
| 서비스 다운 (up == 0) | 1m~2m | 빠른 인지 필요, 하지만 일시적 재시작 제외 |
| 리소스 사용률 (CPU, Memory) | 5m~15m | 일시적 스파이크 제외 |
| 에러율 증가 | 2m~5m | 배포 직후 일시적 증가 제외 |
| 디스크 부족 | 5m~10m | 디스크는 급변하지 않음 |
| 인증서 만료 | 0s (즉시) | 예측 알림이므로 즉시 발생 |

### Labels vs Annotations 구분 기준

**Labels**: 알림의 정체성을 정의한다. routing, grouping, inhibition, silencing에 사용된다.

**Annotations**: 알림의 부가 정보를 제공한다. 사람이 읽기 위한 용도이다.

```yaml
- alert: HighCPU
  expr: node_cpu_usage > 80
  for: 5m
  labels:
    # Labels에 넣어야 할 것:
    severity: warning              # 라우팅에 사용
    team: platform                 # 라우팅에 사용
    layer: infrastructure          # 억제 규칙에 사용
    # Labels에 넣지 말아야 할 것:
    # current_value: "{{ $value }}"  # 동적 값 → fingerprint 변경 → 중복 제거 불가

  annotations:
    # Annotations에 넣어야 할 것:
    summary: "노드 {{ $labels.instance }}의 CPU 사용률이 높다"
    description: "현재 CPU 사용률: {{ $value | humanizePercentage }}"
    runbook_url: "https://wiki.example.com/runbooks/high-cpu"
    dashboard_url: "https://grafana.example.com/d/node-cpu?var-instance={{ $labels.instance }}"
```

규칙 정리:

| 기준 | Labels | Annotations |
|------|--------|-------------|
| 고정적인 값 | O | O |
| 동적인 값 (현재 메트릭 값 등) | X | O |
| 라우팅에 사용 | O | X |
| 그룹핑에 사용 | O | X |
| 억제 규칙에 사용 | O | X |
| 사람이 읽을 설명 | X | O |
| URL 링크 | X | O |

### 다중 조건 알림 (and / or / unless)

PromQL의 논리 연산자를 사용하여 여러 조건을 조합한 복잡한 알림을 작성할 수 있다.

```yaml
# AND: 두 조건 모두 충족 시 알림
- alert: HighCPUAndHighMemory
  expr: |
    (node_cpu_usage > 80)
    and
    (node_memory_usage > 80)
  for: 5m
  labels:
    severity: critical
  annotations:
    summary: "노드 {{ $labels.instance }}의 CPU와 메모리 모두 80%를 초과했다"

# OR: 둘 중 하나만 충족해도 알림
- alert: ResourceExhaustion
  expr: |
    (node_cpu_usage > 95)
    or
    (node_memory_usage > 95)
  for: 5m
  labels:
    severity: critical

# UNLESS: 첫 번째 조건이 충족되지만 두 번째 조건도 충족되면 제외
- alert: HighCPUExceptBatchNodes
  expr: |
    node_cpu_usage > 80
    unless
    kube_node_labels{label_node_type="batch"}
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: "배치 노드를 제외한 노드에서 CPU가 80%를 초과했다"
```

### absent() 함수 활용 (메트릭 누락 탐지)

`absent()` 함수는 지정된 메트릭이 존재하지 않을 때 값 1을 반환한다. 메트릭 수집이 중단된 상황을 탐지하는 데 사용한다.

```yaml
# 메트릭 수집 중단 탐지
- alert: NodeExporterDown
  expr: absent(up{job="node-exporter"})
  for: 5m
  labels:
    severity: critical
  annotations:
    summary: "Node Exporter 메트릭이 수집되지 않고 있다"
    description: "node-exporter job의 up 메트릭이 5분 이상 존재하지 않는다"

# 특정 인스턴스의 메트릭 누락 탐지
- alert: InstanceMetricsAbsent
  expr: absent(node_cpu_seconds_total{instance="critical-server:9100"})
  for: 5m
  labels:
    severity: critical
  annotations:
    summary: "critical-server의 CPU 메트릭이 수집되지 않고 있다"

# absent_over_time: 일정 기간 동안 메트릭이 한 번도 수집되지 않음
- alert: MetricsGap
  expr: absent_over_time(http_requests_total{job="api-server"}[15m])
  for: 0s
  labels:
    severity: warning
  annotations:
    summary: "api-server의 HTTP 요청 메트릭이 15분간 수집되지 않았다"
```

**absent() 사용 시 주의사항**: `absent()`는 지정된 metric name과 label 조합이 전혀 존재하지 않을 때만 동작한다. 일부 인스턴스만 누락된 경우를 탐지하려면 `absent()`가 아닌 다른 방법을 사용해야 한다.

```yaml
# 잘못된 사용: 3대 중 1대만 누락되어도 absent()는 동작하지 않음
# (나머지 2대의 메트릭이 존재하므로)
- alert: WrongAbsentUsage
  expr: absent(up{job="node-exporter"})    # 1대라도 있으면 트리거 안 됨

# 올바른 대안: count로 예상 인스턴스 수와 비교
- alert: NodeExporterInstanceMissing
  expr: count(up{job="node-exporter"}) < 3
  for: 5m
  labels:
    severity: warning
```

### predict_linear() 활용 (디스크 부족 예측)

`predict_linear()` 함수는 현재 추세를 기반으로 미래 값을 선형 회귀로 예측한다. 디스크 부족, 인증서 만료 등 점진적으로 변화하는 메트릭의 예측 알림에 유용하다.

```yaml
# 4시간 후 디스크가 가득 찰 것으로 예측되면 알림
- alert: DiskWillFillIn4Hours
  expr: |
    predict_linear(
      node_filesystem_avail_bytes{mountpoint="/"}[6h],
      4 * 3600
    ) < 0
  for: 30m
  labels:
    severity: warning
  annotations:
    summary: "{{ $labels.instance }}의 디스크가 4시간 내 가득 찰 것으로 예측된다"
    description: "6시간 추세 기반 선형 예측 결과이다"
    runbook_url: "https://wiki.example.com/runbooks/disk-full"

# 24시간 후 디스크가 가득 찰 것으로 예측 (여유 있는 경고)
- alert: DiskWillFillIn24Hours
  expr: |
    predict_linear(
      node_filesystem_avail_bytes{mountpoint="/"}[24h],
      24 * 3600
    ) < 0
    and
    node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"} < 0.3
  for: 1h
  labels:
    severity: info
  annotations:
    summary: "{{ $labels.instance }}의 디스크가 24시간 내 가득 찰 것으로 예측된다"

# 인증서 만료 예측
- alert: CertificateExpiringSoon
  expr: |
    (probe_ssl_earliest_cert_expiry - time()) / 86400 < 30
  for: 0s
  labels:
    severity: warning
  annotations:
    summary: "{{ $labels.instance }}의 SSL 인증서가 {{ $value | humanizeDuration }} 후 만료된다"
```

### 알림 규칙 테스트

Prometheus의 `promtool`을 사용하여 알림 규칙의 문법 검증과 단위 테스트를 수행할 수 있다.

**문법 검증**

```bash
# 알림 규칙 파일 문법 검증
promtool check rules alert-rules.yaml

# 출력 예시:
# Checking alert-rules.yaml
#   SUCCESS: 5 rules found
```

**단위 테스트**

```yaml
# alert-rules-test.yaml
rule_files:
  - alert-rules.yaml

evaluation_interval: 1m

tests:
  # 테스트 1: HighCPU 알림이 5분 후 firing되는지 확인
  - interval: 1m
    input_series:
      - series: 'node_cpu_usage{instance="node-1"}'
        values: '50 60 85 85 85 85 85 85'    # 3분부터 85% 지속

    alert_rule_test:
      # 5분(for: 5m) 이전에는 pending 상태여야 한다
      - eval_time: 5m
        alertname: HighCPU
        exp_alerts: []      # 아직 firing 안 됨

      # 8분 후에는 firing 상태여야 한다 (3분부터 85% 시작 + for: 5m)
      - eval_time: 8m
        alertname: HighCPU
        exp_alerts:
          - exp_labels:
              severity: warning
              instance: node-1
            exp_annotations:
              summary: "노드 node-1의 CPU 사용률이 높다"

  # 테스트 2: absent() 알림 테스트
  - interval: 1m
    input_series: []    # 메트릭 없음

    alert_rule_test:
      - eval_time: 5m
        alertname: NodeExporterDown
        exp_alerts:
          - exp_labels:
              severity: critical
```

```bash
# 단위 테스트 실행
promtool test rules alert-rules-test.yaml

# 출력 예시:
# Unit Testing:  alert-rules-test.yaml
#   SUCCESS
```

---

## amtool CLI 심화

### alert query: 필터링, 출력 형식

```bash
# 기본: 모든 활성 알림 조회
amtool alert query

# label 기반 필터링 (정확 매칭)
amtool alert query alertname=HighCPU
amtool alert query alertname=HighCPU severity=critical

# 정규식 필터링
amtool alert query -r alertname="High.*"
amtool alert query -r namespace="prod|staging"

# 특정 receiver의 알림만 조회
amtool alert query --receiver='slack-critical'

# 억제(inhibited)된 알림 포함 조회
amtool alert query --inhibited

# silence된 알림 포함 조회
amtool alert query --silenced

# 모든 알림 (억제 + silence 포함)
amtool alert query --inhibited --silenced

# 출력 형식 지정
amtool alert query --output=json        # JSON 형식
amtool alert query --output=simple      # 간단한 형식
amtool alert query --output=extended    # 확장 형식 (annotations 포함)

# AlertManager 주소 지정 (원격 접속)
amtool --alertmanager.url=http://alertmanager:9093 alert query

# 설정 파일로 기본 AlertManager URL 지정
# ~/.config/amtool/config.yml
# alertmanager.url: http://alertmanager:9093
```

### silence add/expire/query/update

```bash
# ── Silence 생성 ──

# 기본 생성 (duration 지정)
amtool silence add alertname="HighCPU" \
  --author="admin@example.com" \
  --comment="계획된 유지보수" \
  --duration="2h"
# 출력: silence-id-xxxx (이 ID로 관리)

# 정규식 매칭 Silence
amtool silence add alertname=~"Pod.*" namespace="dev" \
  --author="dev-team" \
  --comment="개발 환경 테스트" \
  --duration="30m"

# 절대 시각 지정
amtool silence add alertname="HighCPU" \
  --author="admin" \
  --comment="야간 배치" \
  --start="2024-01-15T22:00:00+09:00" \
  --end="2024-01-16T06:00:00+09:00"

# ── Silence 조회 ──

# 활성 Silence 목록
amtool silence query

# 만료 포함 전체 조회
amtool silence query --expired

# 특정 label로 필터링
amtool silence query alertname="HighCPU"

# ID만 출력 (스크립팅용)
amtool silence query -q

# ── Silence 만료 ──

# 특정 Silence 만료
amtool silence expire <silence-id>

# 모든 활성 Silence 만료
amtool silence expire $(amtool silence query -q)

# ── Silence 업데이트 ──

# duration 연장
amtool silence update <silence-id> --duration="4h"

# comment 변경
amtool silence update <silence-id> --comment="연장: 배포 지연으로 인해"
```

### check-config: 설정 파일 검증

```bash
# alertmanager.yml 검증
amtool check-config alertmanager.yml

# 성공 출력 예시:
# Checking 'alertmanager.yml'  SUCCESS
# Found:
#  - global config
#  - route
#  - 0 inhibit rules
#  - 3 receivers
#  - 1 templates

# 실패 출력 예시:
# Checking 'alertmanager.yml'  FAILED
# yaml: line 15: did not find expected key
# 또는
# no route provided in config

# 여러 파일 동시 검증
amtool check-config alertmanager.yml alertmanager-backup.yml
```

### config routes test: 라우팅 테스트

```bash
# 특정 label set이 어떤 receiver로 라우팅되는지 테스트
amtool config routes test-routing --config.file=alertmanager.yml \
  alertname=HighCPU severity=critical namespace=prod

# 라우팅 트리 시각화
amtool config routes show --config.file=alertmanager.yml

# Kubernetes 환경에서 사용
kubectl exec -n monitoring deploy/alertmanager -- \
  amtool config routes show

kubectl exec -n monitoring deploy/alertmanager -- \
  amtool config routes test-routing \
  alertname=NodeDown severity=critical
```

### template render: 템플릿 미리보기

AlertManager 0.24.0 이상에서는 `amtool template render` 명령으로 템플릿을 미리 렌더링할 수 있다. 설정이 제한적이므로, 실무에서는 AlertManager의 `/-/healthy` 엔드포인트와 별도의 테스트 도구를 조합하여 템플릿을 검증하는 방법이 일반적이다.

```bash
# 간단한 템플릿 렌더링 테스트
amtool template render --template.glob='/etc/alertmanager/templates/*.tmpl' \
  --template.text='{{ define "test" }}Hello {{ .CommonLabels.alertname }}{{ end }}'

# 실무에서 권장하는 템플릿 테스트 방법:
# 1. AlertManager 설정에 테스트 webhook receiver 추가
# 2. API로 테스트 알림 전송
# 3. webhook 수신 내용으로 템플릿 결과 확인

# 테스트 알림 전송 (API 직접 호출)
curl -X POST http://localhost:9093/api/v2/alerts \
  -H "Content-Type: application/json" \
  -d '[
    {
      "labels": {
        "alertname": "TestAlert",
        "severity": "warning",
        "namespace": "test"
      },
      "annotations": {
        "summary": "테스트 알림이다",
        "description": "템플릿 렌더링을 테스트한다"
      },
      "generatorURL": "http://prometheus:9090/graph"
    }
  ]'
```

---

## 트러블슈팅

### 알림이 발송되지 않는 경우 진단

알림이 발송되지 않는 문제는 가장 빈번하게 발생하는 이슈이다. 단계별로 진단한다.

**1단계: Prometheus에서 알림이 생성되는지 확인**

```bash
# Prometheus의 알림 상태 확인
curl http://localhost:9090/api/v1/alerts | jq '.data.alerts[] | {alertname: .labels.alertname, state: .state}'

# Prometheus UI에서 확인: http://localhost:9090/alerts
# 알림이 "Inactive" 상태이면 expr 조건이 충족되지 않은 것이다
# 알림이 "Pending" 상태이면 for 기간이 아직 경과하지 않은 것이다
# 알림이 "Firing" 상태이면 AlertManager로 전송되고 있는 것이다
```

**2단계: AlertManager가 알림을 수신했는지 확인**

```bash
# AlertManager의 현재 알림 목록
curl http://localhost:9093/api/v2/alerts | jq '.[].labels.alertname'

# amtool로 확인
amtool alert query

# AlertManager 로그 확인 (알림 수신 로그)
kubectl logs -n monitoring deploy/alertmanager | grep "Received alert"
```

**3단계: 라우팅 경로 확인**

```bash
# 해당 알림이 어떤 receiver로 라우팅되는지 테스트
amtool config routes test-routing \
  alertname=<알림이름> severity=<심각도> namespace=<네임스페이스>

# 의도하지 않은 receiver로 라우팅되고 있을 수 있다
```

**4단계: Inhibition/Silence 확인**

```bash
# 억제된 알림 확인
amtool alert query --inhibited

# silence된 알림 확인
amtool alert query --silenced

# 활성 Silence 목록
amtool silence query
```

**5단계: Receiver 설정 확인**

```bash
# AlertManager 로그에서 전송 오류 확인
kubectl logs -n monitoring deploy/alertmanager | grep -i "error\|fail\|notify"

# 일반적인 오류 원인:
# - Slack webhook URL 만료 또는 잘못됨
# - PagerDuty integration key 오류
# - SMTP 인증 실패
# - Webhook 대상 서버 응답 없음
# - TLS 인증서 문제
```

### 알림이 중복 발송되는 경우

```
진단 체크리스트:

1. HA 클러스터 동기화 문제
   - Gossip 프로토콜이 정상 동작하는지 확인
   - kubectl logs에서 "memberlist" 관련 오류 확인
   - 모든 인스턴스가 서로를 피어로 인식하는지 확인:
     curl http://alertmanager:9093/api/v2/status | jq '.cluster'

2. continue: true 설정 확인
   - 라우팅 트리에서 의도치 않은 continue: true가 있는지 확인
   - 동일 알림이 여러 receiver에 매칭되지 않는지 확인

3. group_by 설정 확인
   - group_by가 너무 세분화되어 있으면 동일 문제가 여러 그룹으로
     분리되어 각각 전송될 수 있다

4. Prometheus 설정 확인
   - 동일한 알림 규칙이 여러 rule group에 중복 정의되어 있는지 확인
   - 여러 Prometheus 인스턴스가 동일한 규칙을 평가하고 있는지 확인
     (HA Prometheus에서는 정상 동작이며, AlertManager 클러스터가
      중복을 제거해야 한다)
```

### Silence가 적용되지 않는 경우

```
진단 체크리스트:

1. Label Matcher 확인
   - Silence의 matcher가 알림의 label과 정확히 일치하는지 확인
   - 대소문자 구분에 주의 (label 값은 대소문자를 구분한다)
   - 정규식 matcher의 경우 전체 문자열 매칭인지 확인
     (=~ "prod"는 "production"에도 매칭됨, =~ "^prod$"는 정확히 "prod"만)

2. Silence 시간 범위 확인
   - Silence의 startsAt/endsAt이 현재 시각을 포함하는지 확인
   - 시간대(timezone) 설정 확인

3. Silence 상태 확인
   amtool silence query
   # "expired" 상태가 아닌지 확인

4. HA 환경에서 Gossip 전파 지연
   - Silence가 모든 인스턴스에 전파되었는지 확인
   - 각 인스턴스에서 개별적으로 Silence 조회:
     curl http://alertmanager-0:9093/api/v2/silences
     curl http://alertmanager-1:9093/api/v2/silences
```

### 그룹핑이 기대와 다른 경우

```
진단 체크리스트:

1. group_by 설정 확인
   - 해당 route의 group_by에 어떤 label이 지정되어 있는지 확인
   - 자식 route가 부모의 group_by를 상속받을 수 있음에 주의

2. 알림의 실제 label 확인
   - group_by에 지정된 label이 알림에 실제로 존재하는지 확인
   - label이 없으면 빈 문자열로 취급되어 의도치 않은 그룹핑이 발생할 수 있다

3. group_by: ['...'] vs group_by: [] 차이 이해
   - ['...'] = 모든 label로 그룹핑 (사실상 개별 전송)
   - [] = 그룹핑 없음 (모든 알림이 하나의 그룹)
   - 의도에 맞는 설정인지 확인

4. 테스트 방법
   amtool config routes test-routing \
     alertname=HighCPU severity=critical namespace=prod
   # 출력된 receiver가 예상과 일치하는지 확인
```

### Webhook 전송 실패 디버깅

```bash
# 1. AlertManager 로그에서 webhook 오류 확인
kubectl logs -n monitoring deploy/alertmanager | grep -i "webhook\|notify.*error"

# 일반적인 오류 메시지와 원인:
# "context deadline exceeded" → 대상 서버 응답 시간 초과
# "connection refused" → 대상 서버가 실행 중이 아님
# "certificate verify failed" → TLS 인증서 문제
# "401 Unauthorized" → 인증 토큰 만료 또는 오류
# "403 Forbidden" → 권한 부족
# "404 Not Found" → URL 경로 오류
# "500 Internal Server Error" → 대상 서버 내부 오류

# 2. 대상 서버 연결 테스트
kubectl exec -n monitoring deploy/alertmanager -- \
  wget -qO- --timeout=5 http://webhook-target:5001/health

# 3. 수동 Webhook 전송 테스트
curl -X POST http://webhook-target:5001/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "status": "firing",
    "alerts": [{
      "labels": {"alertname": "test"},
      "annotations": {"summary": "test alert"}
    }]
  }'

# 4. DNS 해석 확인
kubectl exec -n monitoring deploy/alertmanager -- nslookup webhook-target

# 5. Network Policy 확인 (Kubernetes)
kubectl get networkpolicy -n monitoring
```

### HA 클러스터 동기화 문제

```bash
# 1. 클러스터 상태 확인
curl http://alertmanager:9093/api/v2/status | jq '.cluster'
# peers 목록에 모든 인스턴스가 포함되어 있는지 확인

# 2. 각 인스턴스의 클러스터 멤버 확인
for i in 0 1 2; do
  echo "=== alertmanager-$i ==="
  curl -s http://alertmanager-$i.alertmanager-headless:9093/api/v2/status | \
    jq '.cluster.peers | length'
done
# 모든 인스턴스에서 동일한 피어 수가 출력되어야 한다

# 3. Gossip 포트 연결 확인
kubectl exec alertmanager-0 -n monitoring -- \
  nc -zv alertmanager-1.alertmanager-headless 9094

# 4. 로그에서 Gossip 관련 오류 확인
kubectl logs alertmanager-0 -n monitoring | grep -i "memberlist\|gossip\|cluster"

# 5. 일반적인 문제와 해결법:
# - "Failed to join cluster": --cluster.peer 주소가 올바른지 확인
# - "Failed to send gossip": 9094 포트가 열려 있는지 확인
# - "Notification already sent": 정상 동작 (중복 방지 로그)
# - Silence가 일부 인스턴스에 없음: Gossip 네트워크 파티션 의심,
#   모든 인스턴스 간 9094 포트 통신 확인
```

---

## 실습 6: Inhibition 규칙 설정 및 검증

```yaml
# inhibition-test.yaml
# 다음 설정을 alertmanager.yml에 추가한다

inhibit_rules:
  - source_matchers:
      - alertname = NodeNotReady
    target_matchers:
      - alertname != NodeNotReady
    equal: ['instance']
  - source_matchers:
      - severity = critical
    target_matchers:
      - severity = warning
    equal: ['alertname', 'namespace']
```

```bash
# 1. 테스트 알림 전송 (NodeNotReady + HighCPU, 같은 instance)
curl -X POST http://localhost:9093/api/v2/alerts \
  -H "Content-Type: application/json" \
  -d '[
    {
      "labels": {
        "alertname": "NodeNotReady",
        "instance": "node-1",
        "severity": "critical"
      },
      "annotations": {"summary": "노드 node-1이 준비되지 않았다"}
    },
    {
      "labels": {
        "alertname": "HighCPU",
        "instance": "node-1",
        "severity": "warning"
      },
      "annotations": {"summary": "node-1의 CPU가 높다"}
    }
  ]'

# 2. 알림 상태 확인 - HighCPU가 억제되었는지 확인
amtool alert query
amtool alert query --inhibited

# 3. 다른 instance의 알림은 억제되지 않음을 확인
curl -X POST http://localhost:9093/api/v2/alerts \
  -H "Content-Type: application/json" \
  -d '[
    {
      "labels": {
        "alertname": "HighCPU",
        "instance": "node-2",
        "severity": "warning"
      },
      "annotations": {"summary": "node-2의 CPU가 높다"}
    }
  ]'

amtool alert query
# node-2의 HighCPU는 전송되어야 한다
```

### 실습 7: 복잡한 라우팅 트리 설계 및 테스트

```yaml
# 다중 팀, 다중 severity 라우팅 설정
route:
  receiver: default
  group_by: ['alertname', 'namespace']
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
  routes:
    - matchers: [team = platform, severity = critical]
      receiver: platform-pagerduty
    - matchers: [team = platform]
      receiver: platform-slack
    - matchers: [team = backend, severity = critical]
      receiver: backend-pagerduty
    - matchers: [team = backend]
      receiver: backend-slack
    - matchers: [severity = critical]
      receiver: default-pagerduty
      continue: true
    - matchers: [severity = critical]
      receiver: default-slack-critical

receivers:
  - name: default
    webhook_configs:
      - url: 'http://webhook-logger:5001/webhook'
  - name: platform-pagerduty
    webhook_configs:
      - url: 'http://webhook-logger:5001/platform-pd'
  - name: platform-slack
    webhook_configs:
      - url: 'http://webhook-logger:5001/platform-slack'
  - name: backend-pagerduty
    webhook_configs:
      - url: 'http://webhook-logger:5001/backend-pd'
  - name: backend-slack
    webhook_configs:
      - url: 'http://webhook-logger:5001/backend-slack'
  - name: default-pagerduty
    webhook_configs:
      - url: 'http://webhook-logger:5001/default-pd'
  - name: default-slack-critical
    webhook_configs:
      - url: 'http://webhook-logger:5001/default-critical'
```

```bash
# 라우팅 테스트
amtool config routes test-routing --config.file=alertmanager.yml \
  alertname=HighCPU severity=critical team=platform
# 예상 결과: platform-pagerduty

amtool config routes test-routing --config.file=alertmanager.yml \
  alertname=HighCPU severity=warning team=platform
# 예상 결과: platform-slack

amtool config routes test-routing --config.file=alertmanager.yml \
  alertname=HighCPU severity=critical team=data
# 예상 결과: default-pagerduty (continue=true이므로 default-slack-critical도)

amtool config routes test-routing --config.file=alertmanager.yml \
  alertname=HighCPU severity=info
# 예상 결과: default
```

### 실습 8: 알림 템플릿 작성 및 테스트

```bash
# 1. 커스텀 템플릿 파일 생성
cat > /tmp/custom.tmpl << 'TMPL'
{{ define "custom.title" -}}
[{{ .Status | toUpper }}{{ if eq .Status "firing" }}:{{ .Alerts.Firing | len }}{{ end }}] {{ .CommonLabels.alertname }}
{{- end }}

{{ define "custom.text" -}}
{{ if eq .Status "firing" }}
*Firing Alerts:*
{{ range .Alerts.Firing }}
• *{{ .Labels.alertname }}* ({{ .Labels.severity }})
  Namespace: {{ .Labels.namespace }}
  Summary: {{ .Annotations.summary }}
  Started: {{ .StartsAt | date "2006-01-02 15:04:05" }}
{{ end }}
{{ else }}
*All Resolved* ✅
{{ range .Alerts.Resolved }}
• {{ .Labels.alertname }} resolved at {{ .EndsAt | date "15:04:05" }}
{{ end }}
{{ end }}
{{- end }}
TMPL

# 2. 테스트 알림 전송하여 템플릿 결과 확인
curl -X POST http://localhost:9093/api/v2/alerts \
  -H "Content-Type: application/json" \
  -d '[
    {
      "labels": {
        "alertname": "HighCPU",
        "severity": "warning",
        "namespace": "prod"
      },
      "annotations": {
        "summary": "CPU 사용률이 90%를 초과했다"
      }
    }
  ]'

# 3. Webhook logger에서 수신된 메시지 확인
kubectl logs -n monitoring deploy/webhook-logger
```

---

## 예제 3: 완전한 프로덕션 AlertManager 설정

```yaml
# alertmanager.yml (프로덕션 설정 예시)
global:
  resolve_timeout: 5m
  smtp_smarthost: 'smtp.example.com:587'
  smtp_from: 'alertmanager@example.com'
  smtp_auth_username: 'alertmanager@example.com'
  smtp_auth_password: '<password>'
  smtp_require_tls: true
  slack_api_url: '<YOUR_SLACK_WEBHOOK_URL>'
  pagerduty_url: 'https://events.pagerduty.com/v2/enqueue'
  opsgenie_api_url: 'https://api.opsgenie.com/'

templates:
  - '/etc/alertmanager/templates/*.tmpl'

# 시간 간격 정의
time_intervals:
  - name: business-hours-kst
    time_intervals:
      - times:
          - start_time: '09:00'
            end_time: '18:00'
        weekdays: ['monday:friday']
        location: 'Asia/Seoul'

  - name: outside-business-hours
    time_intervals:
      - times:
          - start_time: '18:00'
            end_time: '09:00'
        weekdays: ['monday:friday']
        location: 'Asia/Seoul'
      - weekdays: ['saturday', 'sunday']
        location: 'Asia/Seoul'

route:
  receiver: default-slack
  group_by: ['alertname', 'namespace', 'cluster']
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h

  routes:
    # Critical: PagerDuty + Slack (24/7)
    - matchers: [severity = critical]
      receiver: pagerduty-critical
      group_wait: 10s
      repeat_interval: 1h
      continue: true
    - matchers: [severity = critical]
      receiver: slack-critical

    # Warning: 업무 시간에만 Slack
    - matchers: [severity = warning]
      receiver: slack-warning
      active_time_intervals: [business-hours-kst]

    # Warning: 업무 외 시간에는 Email (다음 날 확인)
    - matchers: [severity = warning]
      receiver: email-warning
      active_time_intervals: [outside-business-hours]
      repeat_interval: 12h

    # Info: Slack info 채널
    - matchers: [severity = info]
      receiver: slack-info
      repeat_interval: 24h

inhibit_rules:
  - source_matchers: [alertname = NodeNotReady]
    target_matchers: [alertname != NodeNotReady]
    equal: ['instance']
  - source_matchers: [severity = critical]
    target_matchers: [severity = warning]
    equal: ['alertname', 'namespace']
  - source_matchers: [alertname = ClusterDown]
    target_matchers: [alertname =~ "Node.*"]
    equal: ['cluster']

receivers:
  - name: default-slack
    slack_configs:
      - channel: '#alerts-default'
        send_resolved: true
        title: '{{ template "slack.custom.title" . }}'
        text: '{{ template "slack.custom.text" . }}'

  - name: pagerduty-critical
    pagerduty_configs:
      - routing_key: '<PD-INTEGRATION-KEY>'
        severity: 'critical'
        description: '{{ .CommonAnnotations.summary }}'

  - name: slack-critical
    slack_configs:
      - channel: '#alerts-critical'
        send_resolved: true
        color: '{{ if eq .Status "firing" }}danger{{ else }}good{{ end }}'
        title: '{{ template "slack.custom.title" . }}'
        text: '{{ template "slack.custom.text" . }}'

  - name: slack-warning
    slack_configs:
      - channel: '#alerts-warning'
        send_resolved: true
        title: '{{ template "slack.custom.title" . }}'
        text: '{{ template "slack.custom.text" . }}'

  - name: email-warning
    email_configs:
      - to: 'team@example.com'
        send_resolved: true
        headers:
          Subject: '[{{ .Status | toUpper }}] {{ .CommonLabels.alertname }}'

  - name: slack-info
    slack_configs:
      - channel: '#alerts-info'
        send_resolved: false
        title: 'ℹ️ {{ .CommonLabels.alertname }}'
        text: '{{ range .Alerts }}{{ .Annotations.summary }}{{ end }}'
```

### 예제 4: 종합 Alert Rules (Golden Signals + Infrastructure)

```yaml
# comprehensive-alert-rules.yaml
groups:
  - name: infrastructure
    interval: 30s
    rules:
      - alert: NodeDown
        expr: up{job="node-exporter"} == 0
        for: 1m
        labels:
          severity: critical
          team: platform
        annotations:
          summary: "노드 {{ $labels.instance }}가 다운되었다"
          runbook_url: "https://wiki.example.com/runbooks/node-down"

      - alert: NodeHighCPU
        expr: |
          100 - (avg by(instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100) > 80
        for: 10m
        labels:
          severity: warning
          team: platform
        annotations:
          summary: "노드 {{ $labels.instance }}의 CPU 사용률이 {{ $value | printf \"%.1f\" }}%이다"
          runbook_url: "https://wiki.example.com/runbooks/high-cpu"

      - alert: DiskWillFillIn4Hours
        expr: predict_linear(node_filesystem_avail_bytes{mountpoint="/"}[6h], 4*3600) < 0
        for: 30m
        labels:
          severity: warning
          team: platform
        annotations:
          summary: "{{ $labels.instance }}의 디스크가 4시간 내 가득 찰 것으로 예측된다"
          runbook_url: "https://wiki.example.com/runbooks/disk-full"

      - alert: NodeExporterAbsent
        expr: absent(up{job="node-exporter"})
        for: 5m
        labels:
          severity: critical
          team: platform
        annotations:
          summary: "Node Exporter 메트릭이 수집되지 않고 있다"

  - name: kubernetes
    interval: 30s
    rules:
      - alert: PodCrashLooping
        expr: increase(kube_pod_container_status_restarts_total[1h]) > 5
        for: 5m
        labels:
          severity: warning
          team: platform
        annotations:
          summary: "{{ $labels.namespace }}/{{ $labels.pod }}가 1시간 내 {{ $value }}회 재시작했다"
          runbook_url: "https://wiki.example.com/runbooks/pod-crashloop"

      - alert: PodNotReady
        expr: |
          kube_pod_status_ready{condition="true"} == 0
          and on(pod, namespace)
          kube_pod_status_phase{phase="Running"} == 1
        for: 10m
        labels:
          severity: warning
          team: platform
        annotations:
          summary: "{{ $labels.namespace }}/{{ $labels.pod }}가 10분 이상 Ready 상태가 아니다"

      - alert: DeploymentReplicasMismatch
        expr: |
          kube_deployment_spec_replicas != kube_deployment_status_ready_replicas
        for: 15m
        labels:
          severity: warning
          team: platform
        annotations:
          summary: "{{ $labels.namespace }}/{{ $labels.deployment }}의 Ready 레플리카 수가 Spec과 일치하지 않는다"

  - name: application-golden-signals
    interval: 30s
    rules:
      - alert: HighErrorRate
        expr: |
          sum(rate(http_requests_total{code=~"5.."}[5m])) by (service, namespace)
          /
          sum(rate(http_requests_total[5m])) by (service, namespace)
          > 0.01
        for: 5m
        labels:
          severity: critical
          signal: errors
        annotations:
          summary: "{{ $labels.namespace }}/{{ $labels.service }} 오류율이 {{ $value | humanizePercentage }}이다"

      - alert: HighLatencyP99
        expr: |
          histogram_quantile(0.99,
            sum(rate(http_request_duration_seconds_bucket[5m])) by (le, service, namespace)
          ) > 2.0
        for: 5m
        labels:
          severity: warning
          signal: latency
        annotations:
          summary: "{{ $labels.namespace }}/{{ $labels.service }} p99 지연 시간이 {{ $value | humanizeDuration }}이다"
```

---

## 자가 점검

### 기초 개념

- [ ] AlertManager의 내부 컴포넌트 (Dispatcher, Inhibitor, Silencer, Notification Pipeline)의 역할을 설명할 수 있는가?
- [ ] AlertManager의 Grouping이 왜 필요한지 설명할 수 있는가?
- [ ] group_wait, group_interval, repeat_interval의 차이를 구체적으로 설명할 수 있는가?
- [ ] Route 트리에서 알림이 어떻게 라우팅되는지 설명할 수 있는가?
- [ ] match와 match_re의 차이, continue 플래그의 동작을 설명할 수 있는가?
- [ ] Inhibition과 Silence의 차이를 설명할 수 있는가?
- [ ] inhibit_rules에서 source_matchers, target_matchers, equal의 역할을 설명할 수 있는가?
- [ ] AlertManager 클러스터링에서 Gossip 프로토콜의 역할을 설명할 수 있는가?
- [ ] Notification Template에서 .Alerts.Firing과 .Alerts.Resolved의 차이를 설명할 수 있는가?
- [ ] Prometheus Alert Rule을 작성할 수 있는가?
- [ ] amtool로 알림 조회, Silence 생성/해제, 라우팅 테스트를 수행할 수 있는가?
- [ ] 알림 피로(Alert Fatigue)를 방지하기 위한 전략을 3가지 이상 설명할 수 있는가?

### 아키텍처 심화

- [ ] Alert의 Fingerprint가 어떻게 계산되는지, 그리고 왜 동적 값을 Labels에 넣으면 안 되는지 설명할 수 있는가?
- [ ] Alert의 세 가지 상태(Active, Suppressed, Resolved)와 각 전환 조건을 설명할 수 있는가?
- [ ] Labels와 Annotations의 차이, 그리고 각각에 어떤 정보를 넣어야 하는지 구분할 수 있는가?
- [ ] Notification Log의 역할과 HA 환경에서의 중복 제거 메커니즘을 설명할 수 있는가?

### Routing 심화

- [ ] Route Tree의 DFS 매칭 알고리즘을 단계별로 설명할 수 있는가?
- [ ] group_by의 세 가지 설정 방식 (`['alertname']`, `['...']`, `[]`)의 차이를 설명할 수 있는가?
- [ ] active_time_intervals와 mute_time_intervals의 차이를 설명할 수 있는가?
- [ ] 실무에서 팀별, severity별 다중 라우팅 트리를 설계할 수 있는가?

### Inhibition / Silence 심화

- [ ] Inhibition에서 equal labels가 없으면 어떤 문제가 발생하는지 설명할 수 있는가?
- [ ] 다중 inhibit_rules가 독립적으로 평가되며, 억제의 연쇄(cascade)가 발생하지 않는 이유를 설명할 수 있는가?
- [ ] Silence를 amtool, API, Web UI 세 가지 방법으로 생성할 수 있는가?
- [ ] 자동 Silence 생성(유지보수 창)을 구현하는 두 가지 방법(CronJob API 호출 vs mute_time_intervals)의 장단점을 비교할 수 있는가?

### Receiver / Template 심화

- [ ] Slack Block Kit, PagerDuty Events API v2, Webhook 페이로드 구조를 각각 설명할 수 있는가?
- [ ] Go template에서 조건문, 반복문, 변수 할당, 파이프라인을 사용하여 커스텀 템플릿을 작성할 수 있는가?
- [ ] AlertManager가 기본 지원하지 않는 알림 채널을 Webhook 프록시로 연동하는 패턴을 설명할 수 있는가?

### HA 심화

- [ ] AlertManager HA 클러스터에서 Split-brain이 발생하면 어떤 현상이 나타나고, 어떻게 완화하는지 설명할 수 있는가?
- [ ] 3-node 클러스터가 권장되는 이유를 설명할 수 있는가?

### Alert Rules 심화

- [ ] Prometheus Alert Rule에서 `for` 절의 의미와 Pending 상태의 관계를 설명할 수 있는가?
- [ ] `absent()` 함수의 동작 원리와 한계를 설명할 수 있는가?
- [ ] `predict_linear()` 함수를 활용하여 디스크 부족 예측 알림을 작성할 수 있는가?
- [ ] SLO 기반 에러 버짓 소진율 알림의 원리를 설명할 수 있는가?
- [ ] Golden Signals 4가지(Latency, Traffic, Errors, Saturation)에 대한 알림 규칙을 작성할 수 있는가?
- [ ] `promtool test rules`로 알림 규칙의 단위 테스트를 작성할 수 있는가?

### 트러블슈팅

- [ ] 알림이 발송되지 않을 때 5단계 진단 절차를 순서대로 수행할 수 있는가?
- [ ] Webhook 전송 실패 시 로그에서 오류 원인을 파악하고 해결할 수 있는가?

---

## 참고문헌

- [AlertManager 공식 문서](https://prometheus.io/docs/alerting/latest/alertmanager/) - AlertManager의 개념, 설정, 운영에 대한 공식 레퍼런스이다
- [AlertManager GitHub 저장소](https://github.com/prometheus/alertmanager) - 소스 코드, 릴리스 노트, 이슈 트래커이다
- [AlertManager Configuration](https://prometheus.io/docs/alerting/latest/configuration/) - alertmanager.yml 설정 파일의 전체 스펙이다
- [Alerting Rules](https://prometheus.io/docs/prometheus/latest/configuration/alerting_rules/) - Prometheus에서 alerting rule을 작성하는 방법이다
- [Notification Template Reference](https://prometheus.io/docs/alerting/latest/notifications/) - Go template에서 사용 가능한 데이터 구조와 함수 레퍼런스이다
- [amtool](https://github.com/prometheus/alertmanager#amtool) - amtool CLI 사용법이다
- [Awesome Prometheus Alerts](https://awesome-prometheus-alerts.grep.to/) - 커뮤니티에서 관리하는 실전 알림 규칙 모음이다
- [Prometheus: Up & Running (O'Reilly)](https://www.oreilly.com/library/view/prometheus-up/9781098131135/) - Prometheus와 AlertManager를 다루는 서적이다
