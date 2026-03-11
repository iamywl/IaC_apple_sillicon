# 05. 모니터링과 옵저버빌리티 — Prometheus, Grafana, Loki

> 시리즈: Apple Silicon Mac 위에 프로덕션급 멀티 클러스터 쿠버네티스 구축하기 (5/6)

---

## 들어가며

인프라를 구축하면 끝일까요? 아닙니다. **운영이 시작**입니다.

서버가 10대 있다고 상상해보세요. 새벽 3시에 한 대가 죽었습니다. 아침에 출근해서야 알게 됩니다. 이미 고객은 6시간 동안 서비스를 이용하지 못했습니다.

모니터링은 **문제를 사람보다 먼저 발견하는 시스템**입니다. 이번 글에서는 우리 프로젝트가 어떻게 4개 클러스터의 건강 상태를 실시간으로 파악하고, 이상이 생기면 즉시 알림을 보내는지 알아보겠습니다.

---

## 모니터링 vs 옵저버빌리티

### 비유: 자동차 계기판 vs 블랙박스

- **모니터링(Monitoring)**: 자동차 계기판입니다. 속도, 연료, 엔진 온도를 실시간으로 보여줍니다. "지금 상태가 어떤지" 알 수 있습니다.
- **옵저버빌리티(Observability)**: 블랙박스 + 계기판 + 차량 진단기입니다. "왜 이런 상태인지" 원인까지 추적할 수 있습니다.

모니터링이 "CPU가 80%입니다"라고 알려준다면, 옵저버빌리티는 "어떤 Pod의 어떤 요청이 CPU를 많이 쓰고 있고, 그 요청은 이 경로로 들어왔다"까지 추적합니다.

### 왜 이게 필요한가?

쿠버네티스 환경은 전통적인 서버 환경보다 훨씬 복잡합니다:

- Pod는 언제든 죽고 다시 태어남 (IP가 바뀜)
- 한 노드에 수십 개의 Pod가 실행됨
- 여러 클러스터가 동시에 운영됨
- 컨테이너 안에서 무슨 일이 일어나는지 밖에서 보이지 않음

"서버에 SSH로 접속해서 로그를 본다"는 전략은 쿠버네티스에서 통하지 않습니다. Pod가 죽으면 로그도 사라지니까요.

---

## 옵저버빌리티의 3대 축 (Three Pillars)

### 1. 메트릭 (Metrics) — 숫자

```
"CPU 사용률이 85%입니다"
"메모리가 12GB 중 10GB 사용 중입니다"
"초당 요청 수가 1500입니다"
```

**숫자로 표현되는 시계열 데이터**입니다. 시간에 따라 값이 변하는 것을 기록합니다. 대시보드 그래프의 원재료입니다.

### 2. 로그 (Logs) — 텍스트

```
2024-03-11 09:15:23 [ERROR] Connection to database timed out after 30s
2024-03-11 09:15:24 [WARN]  Retrying database connection (attempt 2/5)
2024-03-11 09:15:25 [INFO]  Database connection restored
```

**이벤트의 기록**입니다. 무슨 일이 일어났는지 상세하게 알려줍니다. 디버깅의 핵심 도구입니다.

### 3. 트레이스 (Traces) — 경로

```
사용자 요청 → API Gateway (3ms) → Auth Service (12ms) → User Service (45ms) → Database (120ms)
총 소요 시간: 180ms  ← 병목: Database
```

**하나의 요청이 여러 서비스를 거치는 전체 경로**입니다. 마이크로서비스 환경에서 "어디가 느린지" 찾을 때 필수입니다.

### 우리 프로젝트에서는

| 축 | 도구 | 역할 |
|----|------|------|
| 메트릭 | **Prometheus** | 수집 및 저장 |
| 메트릭 시각화 | **Grafana** | 대시보드 |
| 로그 | **Loki** | 수집 및 저장 |
| 로그 수집 | **Promtail** | 각 노드에서 로그를 Loki로 전송 |
| 알림 | **AlertManager** | 이상 감지 시 알림 발송 |

---

## Prometheus — 메트릭 수집기

### 비유: 기자가 직접 취재하는 방식

뉴스를 만드는 방법에는 두 가지가 있습니다:

1. **Push 모델**: 각 현장에서 기사를 보내옴 (대부분의 로그 시스템)
2. **Pull 모델**: 기자가 직접 현장을 돌아다니며 취재 (Prometheus)

Prometheus는 **Pull 모델**을 사용합니다. 일정 간격(기본 15초)마다 모든 대상(타겟)에게 "지금 상태 어때?"라고 물어봅니다.

```
Prometheus: "야, 너 CPU 얼마나 쓰고 있어?"
Node Exporter: "현재 45%입니다"

(15초 후)

Prometheus: "야, 지금은?"
Node Exporter: "현재 47%입니다"
```

### 왜 Pull 모델인가?

- **타겟이 죽으면 바로 알 수 있음**: 물어봤는데 대답이 없으면 = 죽은 것
- **중앙 집중 관리**: Prometheus가 누구에게 물어볼지 결정
- **스크래핑 간격 제어**: Prometheus가 주도적으로 빈도 조절

### 우리 프로젝트의 Prometheus 설정

`manifests/monitoring-values.yaml`에서 Prometheus 관련 부분:

```yaml
prometheus:
  prometheusSpec:
    retention: 7d               # 7일간 데이터 보관
    resources:
      requests:
        cpu: 200m
        memory: 512Mi
      limits:
        memory: 2Gi
    storageSpec:
      volumeClaimTemplate:
        spec:
          accessModes: ["ReadWriteOnce"]
          resources:
            requests:
              storage: 10Gi     # 10GB 디스크 할당
```

핵심 설정 해석:

- **`retention: 7d`**: 메트릭을 7일간 보관합니다. 로컬 환경이니 7일이면 충분합니다. 프로덕션에서는 30일~1년으로 설정하기도 합니다.
- **`storage: 10Gi`**: 7일치 메트릭을 저장할 10GB 디스크를 할당합니다.
- **메모리 2Gi**: Prometheus는 메모리를 많이 사용합니다. 수천 개의 시계열 데이터를 메모리에 올려두고 쿼리하기 때문입니다.

### Node Exporter와 kube-state-metrics

```yaml
nodeExporter:
  enabled: true

kubeStateMetrics:
  enabled: true
```

이 두 줄이 매우 중요합니다:

- **Node Exporter**: 각 노드(VM)에 에이전트를 설치합니다. CPU, 메모리, 디스크, 네트워크 등 **하드웨어 수준** 메트릭을 수집합니다.
- **kube-state-metrics**: 쿠버네티스 API 서버에서 **오브젝트 상태** 메트릭을 수집합니다. Pod 개수, Deployment 상태, Node 상태 등입니다.

```
Node Exporter:      "이 서버의 CPU가 80%야" (하드웨어 관점)
kube-state-metrics: "이 Deployment의 Pod가 3개 중 2개만 Ready야" (쿠버네티스 관점)
```

---

## Grafana — 대시보드 시각화

### 비유: 관제탑의 모니터 화면

공항 관제탑을 상상해보세요. 레이더(Prometheus)가 비행기 위치를 파악하지만, 관제사가 보는 건 **모니터 화면(Grafana)**입니다. 숫자 나열이 아니라, 지도 위에 비행기 아이콘이 움직이는 직관적인 화면이죠.

Grafana는 Prometheus의 데이터를 **사람이 이해하기 쉬운 그래프와 대시보드**로 변환합니다.

### 우리 프로젝트의 Grafana 설정

```yaml
grafana:
  enabled: true
  adminPassword: admin
  service:
    type: NodePort
    nodePort: 30300             # ← 브라우저에서 접근하는 포트
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
        gnetId: 7249            # 커뮤니티 대시보드 #7249
        revision: 1
        datasource: Prometheus
      node-exporter:
        gnetId: 1860            # 커뮤니티 대시보드 #1860 (가장 유명한 노드 대시보드)
        revision: 37
        datasource: Prometheus
      kubernetes-pods:
        gnetId: 6417            # 커뮤니티 대시보드 #6417
        revision: 1
        datasource: Prometheus
```

### 왜 이게 필요한가?

Grafana에 직접 대시보드를 만들 수도 있지만, 커뮤니티에서 만들어 놓은 것을 가져다 쓸 수 있습니다. `gnetId`가 바로 Grafana 커뮤니티 대시보드 번호입니다.

- **#7249**: 쿠버네티스 클러스터 전체 상태 (노드 수, Pod 수, 리소스 사용률)
- **#1860**: Node Exporter Full 대시보드 (CPU, 메모리, 디스크, 네트워크 상세)
- **#6417**: 쿠버네티스 Pod별 리소스 사용 현황

설치와 동시에 3개의 대시보드가 자동으로 구성됩니다. 수동 설정 없이 바로 모니터링을 시작할 수 있죠.

### 접근 방법

```bash
# platform-worker1의 IP를 확인
tart ip platform-worker1

# 브라우저에서 접속
# http://<platform-worker1-ip>:30300
# 아이디: admin / 비밀번호: admin
```

---

## Loki — 로그 수집기

### 비유: "로그 세계의 grep"

Loki를 만든 Grafana Labs는 이렇게 설명합니다: **"Like Prometheus, but for logs"**

전통적인 로그 수집 시스템(Elasticsearch 등)은 로그의 전체 텍스트를 인덱싱합니다. 강력하지만, 매우 많은 리소스를 소비합니다.

Loki는 다른 접근을 합니다:

```
Elasticsearch: 모든 로그 내용을 색인 → 디스크와 메모리를 많이 사용
Loki:          라벨만 색인, 내용은 압축 저장 → 훨씬 가벼움
```

비유하면:
- **Elasticsearch**: 도서관의 모든 책을 낱글자까지 색인한 초대형 카탈로그
- **Loki**: 책의 제목과 저자만 색인하고, 내용은 필요할 때 직접 읽는 간결한 카탈로그

### 우리 프로젝트의 Loki 설정

`manifests/loki-values.yaml`:

```yaml
loki:
  enabled: true
  persistence:
    enabled: false              # 로컬 환경이라 영구 저장 안 함
  resources:
    requests:
      cpu: 100m
      memory: 128Mi
    limits:
      memory: 512Mi

promtail:
  enabled: true                 # 각 노드에서 로그를 수집하는 에이전트
  resources:
    requests:
      cpu: 50m
      memory: 64Mi
    limits:
      memory: 256Mi

grafana:
  enabled: false                # 이미 kube-prometheus-stack에서 설치했으므로
  sidecar:
    datasources:
      enabled: true
      isDefaultDatasource: false
```

### Promtail의 역할

```
각 노드:
  [컨테이너 A] → 로그 → /var/log/pods/...
  [컨테이너 B] → 로그 → /var/log/pods/...
        ↓
  [Promtail] ← 로그 파일을 실시간으로 읽어서
        ↓
  [Loki] ← 로그를 전송. Grafana에서 조회 가능
```

Promtail은 각 노드에 DaemonSet으로 배포됩니다. 즉, 모든 노드에 하나씩 실행됩니다. 노드의 `/var/log/pods/` 디렉토리를 감시하면서, 새로운 로그가 생기면 Loki로 보냅니다.

### 왜 Grafana를 false로 설정했나?

```yaml
grafana:
  enabled: false
```

Loki-stack Helm 차트에도 Grafana를 설치하는 옵션이 있지만, 우리는 이미 `kube-prometheus-stack`에서 Grafana를 설치했습니다. 같은 것을 두 번 설치할 필요가 없죠. 대신 Loki를 데이터소스로 자동 등록(`sidecar.datasources.enabled: true`)하여, 하나의 Grafana에서 메트릭(Prometheus)과 로그(Loki)를 모두 볼 수 있습니다.

---

## AlertManager — 알림 라우팅

### 비유: 119 신고 접수 시스템

화재가 발생하면 119에 신고합니다. 접수 센터에서는:
1. 화재 종류를 파악하고 (분류)
2. 가장 가까운 소방서에 출동을 요청하고 (라우팅)
3. 같은 지역 화재를 묶어서 처리합니다 (그룹핑)

AlertManager가 바로 이 역할입니다.

### 우리 프로젝트의 AlertManager 설정

`manifests/monitoring-values.yaml`에서 AlertManager 부분:

```yaml
alertmanager:
  enabled: true
  service:
    type: NodePort
    nodePort: 30903             # ← 브라우저에서 접근하는 포트
  config:
    global:
      resolve_timeout: 5m
    route:
      group_by: ['alertname', 'namespace']   # 같은 알림끼리 묶음
      group_wait: 30s                         # 30초 모아서 한번에 발송
      group_interval: 5m                      # 같은 그룹 재발송 간격
      repeat_interval: 12h                    # 해결 안 되면 12시간마다 반복
      receiver: 'webhook-logger'
      routes:
        - matchers:
            - severity = critical
          receiver: 'webhook-logger'
          group_wait: 10s                     # critical은 10초만 기다림!
        - matchers:
            - severity = warning
          receiver: 'webhook-logger'
    receivers:
      - name: 'webhook-logger'
        webhook_configs:
          - url: 'http://alertmanager-webhook.monitoring.svc.cluster.local:8080/alert'
            send_resolved: true               # 문제 해결 시에도 알림
    inhibit_rules:
      - source_matchers:
          - severity = critical
        target_matchers:
          - severity = warning
        equal: ['alertname', 'namespace']     # critical이 있으면 warning 억제
```

### 설정 해석

**라우팅 규칙**:
1. 알림이 들어오면 `alertname`과 `namespace`로 그룹핑
2. 30초 동안 모아서 한 번에 발송 (알림 폭탄 방지)
3. critical 등급은 10초만 기다리고 바로 발송 (긴급!)
4. 해결이 안 되면 12시간마다 재발송

**억제 규칙(inhibit_rules)**:
- 같은 문제에 대해 critical과 warning이 동시에 발생하면, warning을 억제합니다
- "서버가 완전히 죽었다(critical)" + "서버 CPU가 높다(warning)"가 동시에 오면, critical만 보냄
- 불필요한 알림 중복을 방지합니다

### 실제 프로젝트에서는

우리 프로젝트에서는 학습 목적으로 `webhook-logger`(HTTP echo 서버)를 receiver로 사용합니다. 실제 프로덕션에서는:

- **Slack**: `slack_configs`로 채널에 알림
- **PagerDuty**: `pagerduty_configs`로 당직자에게 전화/문자
- **Email**: `email_configs`로 이메일 발송
- **MS Teams, OpsGenie** 등 다양한 연동 가능

---

## 8가지 알림 규칙

`manifests/alerting/prometheus-rules.yaml`에 정의된 8가지 알림 규칙을 하나씩 살펴보겠습니다.

### 노드(Node) 관련 규칙 (4개)

#### 1. HighCpuUsage

```yaml
- alert: HighCpuUsage
  expr: |
    100 - (avg by (instance) (irate(node_cpu_seconds_total{mode="idle"}[5m])) * 100) > 80
  for: 5m
  labels:
    severity: warning
```

**의미**: CPU 사용률이 80%를 넘은 상태가 5분간 지속되면 경고

**PromQL 해석**:
- `node_cpu_seconds_total{mode="idle"}`: CPU가 놀고 있는 시간
- `irate(...[5m])`: 최근 5분간의 순간 변화율
- `100 - (... * 100)`: 놀고 있는 비율을 빼면 = 사용 중인 비율
- `> 80`: 80% 넘으면 발동

#### 2. HighMemoryUsage

```yaml
- alert: HighMemoryUsage
  expr: |
    (1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) * 100 > 85
  for: 5m
  labels:
    severity: warning
```

**의미**: 메모리 사용률이 85%를 넘은 상태가 5분간 지속되면 경고

#### 3. NodeNotReady

```yaml
- alert: NodeNotReady
  expr: kube_node_status_condition{condition="Ready",status="true"} == 0
  for: 5m
  labels:
    severity: critical          # ← critical! 노드가 죽은 것이므로
```

**의미**: 노드가 NotReady 상태로 5분간 지속되면 **긴급** 알림. 이것은 노드 자체가 응답하지 않는 심각한 상황입니다.

#### 4. NodeDiskPressure

```yaml
- alert: NodeDiskPressure
  expr: kube_node_status_condition{condition="DiskPressure",status="true"} == 1
  for: 5m
  labels:
    severity: warning
```

**의미**: 노드의 디스크가 부족한 상태가 5분간 지속되면 경고

### Pod 관련 규칙 (4개)

#### 5. PodCrashLooping

```yaml
- alert: PodCrashLooping
  expr: |
    rate(kube_pod_container_status_restarts_total[15m]) * 60 * 15 > 5
  for: 5m
  labels:
    severity: warning
```

**의미**: Pod가 15분 동안 5번 이상 재시작했으면 경고. "CrashLoop"은 Pod가 시작 → 크래시 → 재시작을 반복하는 상태입니다.

#### 6. PodOOMKilled

```yaml
- alert: PodOOMKilled
  expr: |
    kube_pod_container_status_last_terminated_reason{reason="OOMKilled"} == 1
  for: 0m                       # ← 즉시 발동! 0분 대기
  labels:
    severity: warning
```

**의미**: Pod가 메모리 부족(Out Of Memory)으로 강제 종료되면 즉시 경고. `for: 0m`이므로 발생 즉시 알림이 갑니다.

#### 7. HighPodRestartRate

```yaml
- alert: HighPodRestartRate
  expr: |
    increase(kube_pod_container_status_restarts_total[1h]) > 10
  for: 0m
  labels:
    severity: warning
```

**의미**: 1시간 내에 10번 이상 재시작한 Pod가 있으면 즉시 경고

#### 8. PodNotReady

```yaml
- alert: PodNotReady
  expr: |
    kube_pod_status_ready{condition="true"} == 0
  for: 10m
  labels:
    severity: warning
```

**의미**: Pod가 10분간 Ready 상태가 아니면 경고. 배포 후 정상 기동에 실패한 경우를 감지합니다.

---

## 인프라 리소스 배치 전략

### 왜 platform-worker1에 모니터링을 집중했나?

우리 프로젝트에서 platform-worker1은 **3 CPU, 12GB 메모리**로 가장 강력한 워커 노드입니다.

```json
{
  "name": "platform-worker1",
  "role": "worker",
  "cpu": 3,
  "memory": 12288
}
```

이 노드에 배치되는 것들:
- Prometheus (메트릭 수집/저장 — 메모리 2GB)
- Grafana (대시보드 — 비교적 가벼움)
- AlertManager (알림 라우팅)
- Loki (로그 저장)
- Promtail (로그 수집)
- Node Exporter (노드 메트릭)

### 왜 이게 필요한가?

모니터링 도구가 리소스 부족으로 죽으면, 정작 다른 것이 죽었을 때 알 수가 없습니다. 그래서 모니터링 시스템에는 **넉넉한 리소스를 할당**해야 합니다.

---

## 접근 URL 정리

```
Grafana:      http://<platform-worker1-ip>:30300  (admin/admin)
AlertManager: http://<platform-worker1-ip>:30903
```

### NodePort란?

쿠버네티스 Service에는 3가지 타입이 있습니다:

| 타입 | 접근 방법 | 용도 |
|------|----------|------|
| ClusterIP | 클러스터 내부에서만 접근 가능 | 기본값, 내부 서비스 간 통신 |
| **NodePort** | 노드IP:포트로 외부에서 접근 가능 | 개발/테스트 환경 |
| LoadBalancer | 클라우드 로드밸런서를 자동 생성 | 프로덕션 환경 |

우리는 로컬 환경이므로 NodePort를 사용합니다. 30300, 30903처럼 **30000-32767 범위의 포트**를 노드에 열어서 외부(Mac 호스트)에서 접근할 수 있게 합니다.

---

## 전체 모니터링 데이터 흐름

```
각 노드
  ├── [Node Exporter] ─── CPU, 메모리, 디스크 메트릭 ──┐
  ├── [kube-state-metrics] ─── Pod/Node 상태 메트릭 ────┤
  └── [Promtail] ─── 컨테이너 로그 ─────────────────────┤
                                                         │
                                                         ▼
platform-worker1
  ├── [Prometheus] ←── 메트릭 수집 (Pull, 15초 간격)
  │     ├── 7일간 보관
  │     └── 알림 규칙 평가 (30초 간격)
  │           │
  │           ▼ (규칙 위반 시)
  │     [AlertManager]
  │           │
  │           ▼
  │     [Webhook Logger] ← 알림 수신 (학습용)
  │
  ├── [Loki] ←── 로그 저장
  │
  └── [Grafana] ←── Prometheus + Loki 데이터를 시각화
        ↑
        │
    브라우저 (http://<ip>:30300)
```

---

## 실제 프로젝트에서는

### 스케일의 차이

우리 프로젝트에서는 10개 VM에 단일 Prometheus로 충분합니다. 하지만 프로덕션에서는:

- **Thanos** 또는 **Cortex**: 여러 Prometheus를 묶어서 장기 보관 및 고가용성 확보
- **Grafana Mimir**: Grafana Labs의 메트릭 장기 보관 솔루션
- **로그**: Loki를 S3 같은 오브젝트 스토리지와 연동하여 비용 효율적으로 보관

### 알림 채널

실제 운영 환경에서는 webhook-logger 대신:

```yaml
# Slack 예시
receivers:
  - name: 'slack-channel'
    slack_configs:
      - api_url: 'https://hooks.slack.com/services/...'
        channel: '#alerts'
        title: '{{ .CommonLabels.alertname }}'
        text: '{{ .CommonAnnotations.description }}'
```

### 대시보드 확장

커뮤니티 대시보드 3개 외에도, 각 팀의 서비스에 맞는 커스텀 대시보드를 만들게 됩니다. Grafana의 PromQL 쿼리 빌더를 사용하면 코드를 모르는 사람도 대시보드를 구성할 수 있습니다.

### Loki의 한계와 대안

Loki는 가볍지만, 전문 검색(Full-text search)이 필요하면 ELK(Elasticsearch + Logstash + Kibana) 스택이 더 적합합니다. 다만 리소스 소비가 훨씬 크기 때문에, 우리 프로젝트처럼 리소스가 제한된 환경에서는 Loki가 합리적인 선택입니다.

---

## 정리

| 개념 | 한 줄 설명 |
|------|-----------|
| 모니터링 | 시스템 상태를 실시간으로 관찰하는 것 |
| 옵저버빌리티 | 모니터링 + 원인 추적까지 가능한 능력 |
| Prometheus | Pull 모델 기반 메트릭 수집/저장 도구 |
| Grafana | 메트릭과 로그를 시각화하는 대시보드 도구 |
| Loki | 라벨 기반의 경량 로그 수집 도구 |
| Promtail | 각 노드에서 로그를 Loki로 전송하는 에이전트 |
| AlertManager | 알림을 분류, 그룹핑, 라우팅하는 도구 |
| Node Exporter | 노드의 하드웨어 메트릭을 수집하는 에이전트 |
| kube-state-metrics | 쿠버네티스 오브젝트 상태를 메트릭으로 변환 |

### 관련 파일

| 파일 | 역할 |
|------|------|
| `manifests/monitoring-values.yaml` | Prometheus + Grafana + AlertManager 설정 |
| `manifests/loki-values.yaml` | Loki + Promtail 설정 |
| `manifests/alerting/prometheus-rules.yaml` | 8가지 알림 규칙 정의 |
| `manifests/alerting/webhook-logger.yaml` | 알림 수신용 webhook 서버 |
| `config/clusters.json` | platform-worker1 리소스 정의 (3CPU, 12GB) |

---

**다음 글에서는** 이 모든 것을 자동으로 구축하는 Infrastructure as Code(IaC) 방법론을 다룹니다. Bash 스크립트와 Terraform으로 "코드 한 줄로 인프라 전체를 만들고 없애는" 방법을 알아보겠습니다.
