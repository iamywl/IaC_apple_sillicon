# Day 4: Alerting 및 Provisioning 심화

> Grafana 9+ Unified Alerting 시스템의 구조와 설정, 그리고 코드 기반 Provisioning을 통한 자동화 방법을 학습한다.

## 7장: Alerting 심화 (Grafana 9+ Unified Alerting)

Grafana 9부터 도입된 Unified Alerting은 이전의 Legacy Alerting을 대체하는 통합 알림 시스템이다. Prometheus Alertmanager와 호환되는 아키텍처를 가진다.

### 7.1 알림 시스템 구성 요소

```
┌─────────────────────────────────────────────────────────┐
│                  Grafana Alerting                        │
│                                                         │
│  ┌─────────────┐    ┌──────────────┐    ┌────────────┐  │
│  │ Alert Rules  │───▶│ Alert State   │───▶│Notification│  │
│  │ (PromQL /   │    │ Evaluation   │    │  Policies  │  │
│  │  conditions) │    │ (firing /    │    │ (routing)  │  │
│  └─────────────┘    │  pending /   │    └──────┬─────┘  │
│                     │  normal)     │           │        │
│                     └──────────────┘    ┌──────▼─────┐  │
│                                         │  Contact   │  │
│  ┌─────────────┐    ┌──────────────┐    │  Points    │  │
│  │  Silences    │    │Mute Timings  │    │(Slack,Email│  │
│  │(임시 억제)   │    │(반복 스케줄)  │    │ PagerDuty) │  │
│  └─────────────┘    └──────────────┘    └────────────┘  │
└─────────────────────────────────────────────────────────┘
```

| 구성 요소 | 설명 |
|----------|------|
| **Alert Rule** | 알림 조건을 정의한다. 데이터소스 쿼리 + 조건식(예: `avg() > 80`) + 평가 주기(`Evaluation interval`)로 구성된다 |
| **Alert State** | Alert Rule의 현재 상태이다. `Normal` → `Pending`(for 대기) → `Firing`(발동) → `Normal` 순서로 전이한다 |
| **Contact Point** | 알림을 보낼 채널을 정의한다. Slack, Email, PagerDuty, Webhook, Microsoft Teams 등을 지원한다 |
| **Notification Policy** | Alert label 기반으로 어떤 Contact Point로 알림을 라우팅할지 결정하는 트리 구조의 정책이다 |
| **Silence** | 특정 시간 동안 특정 라벨 매칭 조건의 알림을 일시적으로 억제한다. 계획된 유지보수 시 사용한다 |
| **Mute Timing** | 반복적인 일정(예: 매주 토/일 00:00~08:00)에 알림을 자동으로 음소거하는 스케줄이다 |

### 7.2 Alert Rule 구조 상세

Alert Rule은 내부적으로 세 가지 "Ref" 단계로 구성된다:

```
┌──────────────────────────────────────────────────────────┐
│ Alert Rule: "High CPU Usage"                              │
│                                                          │
│ Step 1: Data Query (refId: A)                            │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ datasource: prometheus                               │ │
│ │ expr: avg by(instance) (rate(                        │ │
│ │   node_cpu_seconds_total{mode="idle"}[5m])) * 100    │ │
│ │ range: 10m (relativeTimeRange: from:600, to:0)       │ │
│ └──────────────────────────────────────────────────────┘ │
│                          │                               │
│                          ▼                               │
│ Step 2: Reduce (refId: B)                                │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ datasource: __expr__ (Expression)                    │ │
│ │ type: reduce                                         │ │
│ │ expression: A                                        │ │
│ │ reducer: mean                                        │ │
│ └──────────────────────────────────────────────────────┘ │
│                          │                               │
│                          ▼                               │
│ Step 3: Threshold (refId: C) ← condition                 │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ datasource: __expr__ (Expression)                    │ │
│ │ type: threshold                                      │ │
│ │ expression: B                                        │ │
│ │ conditions: gt 80                                    │ │
│ └──────────────────────────────────────────────────────┘ │
│                                                          │
│ for: 5m (5분간 지속 시 Firing)                            │
│ labels: { severity: warning, team: sre }                 │
│ annotations:                                             │
│   summary: "CPU > 80% for 5 minutes"                     │
│   runbook_url: "https://wiki/runbook/high-cpu"           │
└──────────────────────────────────────────────────────────┘
```

### 7.3 Alert State 전이

```
                    조건 충족
         ┌─────────────────────────┐
         │                         ▼
    ┌─────────┐  조건 충족   ┌──────────┐  for 경과   ┌─────────┐
    │ Normal  │─────────────▶│ Pending  │────────────▶│ Firing  │
    └─────────┘              └──────────┘             └─────────┘
         ▲                        │                        │
         │         조건 미충족      │         조건 미충족      │
         └────────────────────────┘                        │
         │                                                 │
         └─────────────────────────────────────────────────┘
                         조건 미충족 (Resolved)
```

| 상태 | 설명 |
|------|------|
| Normal | 조건이 충족되지 않는 정상 상태이다 |
| Pending | 조건이 충족되었으나 `for` 기간이 아직 경과하지 않은 대기 상태이다 |
| Firing | `for` 기간 동안 조건이 계속 충족되어 알림이 발동된 상태이다 |
| NoData | 쿼리가 데이터를 반환하지 않는 상태이다. 설정에 따라 Alerting 또는 OK로 처리한다 |
| Error | 쿼리 실행 중 에러가 발생한 상태이다 |

### 7.4 Alert Rule Provisioning YAML 예시

```yaml
# Grafana Alert Rule (Provisioning YAML)
apiVersion: 1
groups:
  - orgId: 1
    name: SRE-Alerts
    folder: alerts
    interval: 1m
    rules:
      - uid: high-cpu-alert
        title: High CPU Usage
        condition: C
        data:
          - refId: A
            relativeTimeRange:
              from: 600
              to: 0
            datasourceUid: prometheus
            model:
              expr: 100 - (avg by(instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)
          - refId: B
            relativeTimeRange:
              from: 600
              to: 0
            datasourceUid: __expr__
            model:
              type: reduce
              expression: A
              reducer: mean
          - refId: C
            datasourceUid: __expr__
            model:
              type: threshold
              expression: B
              conditions:
                - evaluator:
                    type: gt
                    params: [80]
        for: 5m
        labels:
          severity: warning
          team: sre
        annotations:
          summary: "CPU 사용률이 80%를 초과하였다"
          description: "인스턴스 {{ $labels.instance }}의 CPU 사용률이 {{ $values.B }}%이다"

      - uid: pod-crashloop-alert
        title: Pod CrashLoopBackOff
        condition: C
        data:
          - refId: A
            relativeTimeRange:
              from: 600
              to: 0
            datasourceUid: prometheus
            model:
              expr: increase(kube_pod_container_status_restarts_total[10m]) > 3
          - refId: B
            datasourceUid: __expr__
            model:
              type: reduce
              expression: A
              reducer: last
          - refId: C
            datasourceUid: __expr__
            model:
              type: threshold
              expression: B
              conditions:
                - evaluator:
                    type: gt
                    params: [0]
        for: 0s
        labels:
          severity: critical
          team: sre
        annotations:
          summary: "Pod {{ $labels.pod }}이 CrashLoopBackOff 상태이다"
          runbook_url: "https://wiki/runbook/crashloop"

      - uid: disk-usage-alert
        title: Disk Usage High
        condition: C
        data:
          - refId: A
            relativeTimeRange:
              from: 300
              to: 0
            datasourceUid: prometheus
            model:
              expr: (1 - node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"}) * 100
          - refId: B
            datasourceUid: __expr__
            model:
              type: reduce
              expression: A
              reducer: last
          - refId: C
            datasourceUid: __expr__
            model:
              type: threshold
              expression: B
              conditions:
                - evaluator:
                    type: gt
                    params: [85]
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "디스크 사용률이 85%를 초과하였다 ({{ $labels.instance }})"
```

### 7.5 Notification Policy (라우팅 트리)

Notification Policy는 트리 구조로 알림을 라우팅한다:

```
Root Policy (receiver: default-email)
├── matchers: severity = critical
│   └── receiver: pagerduty-oncall
│       group_wait: 10s
│       repeat_interval: 1h
├── matchers: severity = warning, team = sre
│   └── receiver: slack-sre
│       group_by: [alertname, namespace]
│       group_wait: 30s
│       repeat_interval: 4h
├── matchers: severity = warning, team = dev
│   └── receiver: slack-dev
│       group_wait: 1m
│       repeat_interval: 12h
└── matchers: (기타 모든 알림)
    └── receiver: default-email (Root Policy로 폴백)
```

| 설정 | 설명 | 권장값 |
|------|------|--------|
| `group_by` | 알림을 그룹핑할 라벨 목록이다 | `[alertname, namespace]` |
| `group_wait` | 첫 알림 수신 후 그룹에 추가 알림이 도착할 때까지 대기하는 시간이다 | 30s ~ 1m |
| `group_interval` | 같은 그룹에 새로운 알림이 추가되었을 때 알림을 보내는 간격이다 | 5m |
| `repeat_interval` | 동일 알림이 여전히 firing 중일 때 재전송 간격이다 | 4h ~ 12h |
| `continue` | true이면 매칭 후 하위 라우트도 계속 평가한다 | false (기본) |

### 7.6 Contact Point 유형

| Contact Point | 설정 필수 항목 | 용도 |
|--------------|--------------|------|
| Slack | Webhook URL 또는 Bot Token + Channel | 팀 채널 알림 |
| Email | SMTP 서버 설정, 수신자 주소 | 공식 알림, 에스컬레이션 |
| PagerDuty | Integration Key | 온콜 담당자 호출 |
| Webhook | URL | 커스텀 자동화 (이 프로젝트에서 사용) |
| Microsoft Teams | Webhook URL | 팀즈 채널 알림 |
| OpsGenie | API Key | 인시던트 관리 |
| Telegram | Bot Token + Chat ID | 모바일 즉시 알림 |
| Discord | Webhook URL | 개발팀 채널 |
| Alertmanager | URL | 외부 Alertmanager로 위임 |

이 프로젝트에서는 `webhook-logger`를 Contact Point로 사용한다:
```yaml
# manifests/monitoring-values.yaml 참조
receivers:
  - name: 'webhook-logger'
    webhook_configs:
      - url: 'http://alertmanager-webhook.monitoring.svc.cluster.local:8080/alert'
        send_resolved: true
```

### 7.7 Silence (임시 음소거)

```bash
# Grafana API로 Silence 생성
curl -X POST http://grafana:3000/api/alertmanager/grafana/api/v2/silences \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "matchers": [
      { "name": "namespace", "value": "staging", "isRegex": false, "isEqual": true }
    ],
    "startsAt": "2024-01-15T00:00:00Z",
    "endsAt": "2024-01-15T06:00:00Z",
    "createdBy": "admin",
    "comment": "Staging 환경 계획된 유지보수"
  }'
```

### 7.8 Mute Timing

```yaml
# 반복 스케줄 기반 음소거
apiVersion: 1
muteTimes:
  - orgId: 1
    name: weekends
    time_intervals:
      - times:
          - start_time: "00:00"
            end_time: "24:00"
        weekdays: ["saturday", "sunday"]
      - times:
          - start_time: "22:00"
            end_time: "08:00"
        weekdays: ["monday:friday"]
```

### 7.9 Grafana Alerting vs Prometheus Alerting

| 항목 | Grafana Alerting | Prometheus Alerting |
|------|-----------------|-------------------|
| 규칙 저장 위치 | Grafana DB | Prometheus 설정 파일 / Ruler API |
| 쿼리 언어 | 모든 데이터소스 (PromQL, LogQL, SQL 등) | PromQL만 |
| 알림 라우팅 | Grafana 내장 Alertmanager | 외부 Alertmanager |
| UI 관리 | Grafana UI에서 직접 관리 | YAML 파일 또는 API |
| HA | Grafana HA + DB 공유 | Prometheus HA + Alertmanager HA |
| 멀티 데이터소스 | 단일 규칙에서 여러 데이터소스 조합 가능 | Prometheus 단일 데이터소스만 |
| Recording Rule | 미지원 (쿼리 시점에 계산) | 지원 (사전 계산하여 저장) |
| Expression | Reduce, Math, Threshold, Resample | PromQL 내장 함수 |
| 권장 사용 사례 | Loki 로그 기반 알림, 멀티소스 알림 | 고성능 메트릭 알림 |

---

## 8장: Provisioning 심화

Provisioning은 Grafana의 데이터소스, 대시보드, 알림 규칙, Contact Point 등을 코드(YAML/JSON 파일)로 선언적으로 관리하는 기능이다. Kubernetes 환경에서는 ConfigMap이나 Helm values로 관리하는 것이 일반적이다.

### 8.1 Provisioning 디렉토리 구조

```
/etc/grafana/provisioning/
├── datasources/
│   └── datasource.yaml        # 데이터소스 정의
├── dashboards/
│   └── dashboard-provider.yaml # 대시보드 파일 위치 지정
├── alerting/
│   ├── alert-rules.yaml        # 알림 규칙
│   ├── contact-points.yaml     # Contact Point 정의
│   └── notification-policies.yaml # 라우팅 정책
└── plugins/
    └── plugin.yaml             # 플러그인 사전 설치
```

### 8.2 Data Source Provisioning

```yaml
# /etc/grafana/provisioning/datasources/datasource.yaml
apiVersion: 1
deleteDatasources:
  - name: Old-Prometheus
    orgId: 1

datasources:
  - name: Prometheus
    type: prometheus
    access: proxy
    url: http://prometheus-server.monitoring.svc.cluster.local:9090
    isDefault: true
    editable: false
    jsonData:
      timeInterval: "15s"          # 기본 scrape interval 힌트
      httpMethod: POST             # 긴 쿼리를 위해 POST 사용
      exemplarTraceIdDestinations:
        - name: traceID
          datasourceUid: tempo      # Exemplar 클릭 시 Tempo로 이동

  - name: Loki
    type: loki
    access: proxy
    url: http://loki-gateway.monitoring.svc.cluster.local:3100
    editable: false
    jsonData:
      derivedFields:
        - datasourceUid: tempo
          matcherRegex: "traceID=(\\w+)"
          name: TraceID
          url: "$${__value.raw}"    # 로그에서 traceID 추출 → Tempo 링크 생성

  - name: Tempo
    type: tempo
    access: proxy
    url: http://tempo.monitoring.svc.cluster.local:3100
    editable: false
    jsonData:
      tracesToLogs:
        datasourceUid: loki
        tags: ["service.name"]      # Trace에서 Loki 로그로 이동
```

### 8.3 Dashboard Provisioning

```yaml
# /etc/grafana/provisioning/dashboards/dashboard-provider.yaml
apiVersion: 1
providers:
  - name: default
    orgId: 1
    folder: "Infrastructure"        # Grafana UI에서의 폴더 이름
    type: file
    disableDeletion: true           # UI에서 삭제 방지
    updateIntervalSeconds: 30       # 파일 변경 감지 주기
    allowUiUpdates: false           # UI에서 수정 방지 (코드로만 관리)
    options:
      path: /var/lib/grafana/dashboards
      foldersFromFilesStructure: true  # 하위 디렉토리를 폴더로 매핑
```

Kubernetes에서는 Dashboard JSON을 ConfigMap으로 관리한다:
```yaml
# Helm values.yaml (kube-prometheus-stack 기준)
# 이 프로젝트의 manifests/monitoring-values.yaml에서 사용하는 방식
grafana:
  dashboardProviders:
    dashboardproviders.yaml:
      apiVersion: 1
      providers:
        - name: default
          orgId: 1
          folder: ''
          type: file
          disableDeletion: false
          editable: true
          options:
            path: /var/lib/grafana/dashboards/default

  dashboards:
    default:
      kubernetes-cluster:
        gnetId: 7249            # Grafana.com 대시보드 ID
        revision: 1
        datasource: Prometheus
      node-exporter:
        gnetId: 1860
        revision: 37
        datasource: Prometheus
      kubernetes-pods:
        gnetId: 6417
        revision: 1
        datasource: Prometheus

  # ConfigMap으로 커스텀 대시보드 마운트
  dashboardsConfigMaps:
    custom: "grafana-custom-dashboards"   # ConfigMap 이름 참조
```

### 8.4 Contact Point & Notification Policy Provisioning

```yaml
# /etc/grafana/provisioning/alerting/contact-points.yaml
apiVersion: 1
contactPoints:
  - orgId: 1
    name: slack-sre
    receivers:
      - uid: slack-sre-receiver
        type: slack
        settings:
          recipient: "#sre-alerts"
          token: "$SLACK_TOKEN"          # 환경변수 참조 가능
          title: |
            [{{ .Status | toUpper }}] {{ .CommonLabels.alertname }}
          text: |
            {{ range .Alerts }}
            *Summary:* {{ .Annotations.summary }}
            *Severity:* {{ .Labels.severity }}
            {{ end }}

# /etc/grafana/provisioning/alerting/notification-policies.yaml
apiVersion: 1
policies:
  - orgId: 1
    receiver: slack-sre               # 기본 수신자
    group_by: ["alertname", "namespace"]
    group_wait: 30s
    group_interval: 5m
    repeat_interval: 4h
    routes:
      - receiver: slack-sre
        matchers:
          - severity = critical
        continue: false
      - receiver: email-oncall
        matchers:
          - severity = warning
        group_wait: 1m
```

### 8.5 Terraform Provider for Grafana

Terraform으로 Grafana 리소스를 관리할 수 있다:

```hcl
# providers.tf
terraform {
  required_providers {
    grafana = {
      source  = "grafana/grafana"
      version = "~> 2.0"
    }
  }
}

provider "grafana" {
  url  = "http://grafana.monitoring.svc.cluster.local:3000"
  auth = var.grafana_api_key
}

# data_source.tf
resource "grafana_data_source" "prometheus" {
  type = "prometheus"
  name = "Prometheus"
  url  = "http://prometheus-server.monitoring.svc.cluster.local:9090"

  is_default = true

  json_data_encoded = jsonencode({
    httpMethod       = "POST"
    timeInterval     = "15s"
    exemplarTraceIdDestinations = [{
      name          = "traceID"
      datasourceUid = grafana_data_source.tempo.uid
    }]
  })
}

resource "grafana_data_source" "loki" {
  type = "loki"
  name = "Loki"
  url  = "http://loki.monitoring.svc.cluster.local:3100"
}

# folder.tf
resource "grafana_folder" "infrastructure" {
  title = "Infrastructure"
}

resource "grafana_folder" "applications" {
  title = "Applications"
}

# dashboard.tf
resource "grafana_dashboard" "node_overview" {
  folder      = grafana_folder.infrastructure.id
  config_json = file("dashboards/node-overview.json")

  overwrite = true
}

# alert_rule.tf
resource "grafana_rule_group" "sre_alerts" {
  name             = "SRE-Alerts"
  folder_uid       = grafana_folder.infrastructure.uid
  interval_seconds = 60
  org_id           = 1

  rule {
    name      = "High CPU Usage"
    condition = "C"
    for       = "5m"

    data {
      ref_id = "A"
      relative_time_range {
        from = 600
        to   = 0
      }
      datasource_uid = grafana_data_source.prometheus.uid
      model = jsonencode({
        expr = "100 - (avg by(instance) (rate(node_cpu_seconds_total{mode=\"idle\"}[5m])) * 100)"
      })
    }

    data {
      ref_id         = "B"
      datasource_uid = "__expr__"
      model = jsonencode({
        type       = "reduce"
        expression = "A"
        reducer    = "mean"
      })
    }

    data {
      ref_id         = "C"
      datasource_uid = "__expr__"
      model = jsonencode({
        type       = "threshold"
        expression = "B"
        conditions = [{
          evaluator = { type = "gt", params = [80] }
        }]
      })
    }

    labels = {
      severity = "warning"
      team     = "sre"
    }

    annotations = {
      summary = "CPU 사용률이 80%를 초과하였다"
    }
  }
}

# contact_point.tf
resource "grafana_contact_point" "slack_sre" {
  name = "slack-sre"

  slack {
    recipient   = "#sre-alerts"
    token       = var.slack_token
    title       = "[{{ .Status | toUpper }}] {{ .CommonLabels.alertname }}"
    text        = "{{ range .Alerts }}*{{ .Annotations.summary }}*{{ end }}"
  }
}

# notification_policy.tf
resource "grafana_notification_policy" "main" {
  contact_point = grafana_contact_point.slack_sre.name
  group_by      = ["alertname", "namespace"]

  policy {
    contact_point = grafana_contact_point.slack_sre.name
    matcher {
      label = "severity"
      match = "="
      value = "critical"
    }
    group_wait      = "10s"
    repeat_interval = "1h"
  }
}
```

---

