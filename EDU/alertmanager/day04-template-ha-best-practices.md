# Day 4: 알림 템플릿 심화, HA 심화, 알림 설계 모범 사례

> 이 문서에서는 Go template 문법 상세(조건문, 반복문, 변수, 파이프라인, 커스텀 함수), 템플릿 디버깅, HA 클러스터의 Gossip 프로토콜 동작, split-brain 대응, Kubernetes에서의 HA 설정, 그리고 프로덕션 환경 알림 설계 원칙을 다룬다.

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

