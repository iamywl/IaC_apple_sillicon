# Day 1: 개념, 아키텍처, 실습 기초

> 이 문서에서는 AlertManager의 핵심 개념, 내부 아키텍처, Routing Tree, Grouping 타이머, Inhibition Rules, High Availability, Notification Template, Receiver 통합, amtool CLI, 기초 실습과 예제, Alerting Best Practices를 다룬다.

---

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

