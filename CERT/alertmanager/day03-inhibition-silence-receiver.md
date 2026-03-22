# Day 3: Inhibition 심화, Silence 심화, Receiver 심화

> 이 문서에서는 Inhibition의 source/target matchers 동작 원리, equal labels, 다중 규칙 적용, Inhibition 활용 패턴, Silence 생성/매칭/만료 관리, 자동 Silence, 그리고 Slack/PagerDuty/Email/Webhook/OpsGenie/Teams/Telegram 등 다양한 Receiver 통합을 다룬다.

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

