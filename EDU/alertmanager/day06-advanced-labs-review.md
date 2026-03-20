# Day 6: 고급 실습, 프로덕션 예제, 자가 점검

> 이 문서에서는 Inhibition 규칙 설정 및 검증 실습, 완전한 프로덕션 AlertManager 설정 예제, 그리고 전체 학습 내용에 대한 자가 점검 체크리스트와 참고문헌을 다룬다.

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
