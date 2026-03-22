# 05. 모니터링과 옵저버빌리티 — Prometheus, Grafana, Loki

---

## 목차

1. [왜 모니터링이 필수인가 — MTTD와 MTTR](#왜-모니터링이-필수인가--mttd와-mttr)
2. [모니터링 vs 옵저버빌리티](#모니터링-vs-옵저버빌리티)
3. [옵저버빌리티의 3대 축 (Three Pillars)](#옵저버빌리티의-3대-축-three-pillars)
4. [왜 Prometheus + Grafana + Loki 조합인가](#왜-prometheus--grafana--loki-조합인가)
5. [Prometheus — 메트릭 수집기](#prometheus--메트릭-수집기)
6. [Grafana — 대시보드 시각화](#grafana--대시보드-시각화)
7. [Loki — 로그 수집기](#loki--로그-수집기)
8. [AlertManager — 알림 라우팅](#alertmanager--알림-라우팅)
9. [8가지 알림 규칙](#8가지-알림-규칙)
10. [인프라 리소스 배치 전략](#인프라-리소스-배치-전략)
11. [전체 모니터링 데이터 흐름](#전체-모니터링-데이터-흐름)
12. [접근 URL 및 수정 가이드](#접근-url-및-수정-가이드)
13. [실제 프로덕션에서는](#실제-프로덕션에서는)
14. [정리](#정리)

---

## 왜 모니터링이 필수인가 — MTTD와 MTTR

인프라를 구축하면 끝이 아니다. **운영이 시작**이다.

모니터링이 없는 인프라는 계기판 없는 비행기와 다르지 않다. 모니터링이 필수인 공학적 이유는 두 가지다.

첫째, **장애 감지 시간(MTTD, Mean Time To Detect)을 단축**한다. 서버가 10대 있는 환경에서 새벽 3시에 한 대가 다운되었다고 가정하자. 모니터링이 없으면 아침 출근 후에야 장애를 인지하게 되고, 그 사이 6시간의 서비스 중단이 발생한다. 모니터링이 있으면 다운 후 수십 초 이내에 알림이 발생한다.

둘째, **복구 시간(MTTR, Mean Time To Recover)을 줄인다**. 장애가 발생했을 때 "어떤 노드에서, 어떤 Pod가, 언제부터, 어떤 이유로" 문제인지를 메트릭과 로그로 즉시 파악할 수 있다. 모니터링 없이는 SSH로 노드에 하나씩 접속하여 `top`, `journalctl`을 확인하는 수동 디버깅이 필요하며, 이 시간이 서비스 중단 시간에 직접 더해진다.

SRE(Site Reliability Engineering)에서 서비스 가용성의 핵심 지표는 `가용성 = 1 - (MTTD + MTTR) / 전체 시간`이다. 모니터링은 MTTD와 MTTR 양쪽을 동시에 줄이는 유일한 수단이다.

---

## 모니터링 vs 옵저버빌리티

- **모니터링(Monitoring)**: 사전에 정의된 메트릭(CPU, 메모리, 디스크 등)을 실시간으로 수집하고 임계값 기반 알림을 발생시키는 것이다. "현재 상태가 어떤지" 파악하는 데 초점을 둔다.
- **옵저버빌리티(Observability)**: 메트릭, 로그, 트레이스 세 가지 신호를 통합적으로 수집하고 상관 분석하여, 사전에 예측하지 못한 장애의 근본 원인까지 추적할 수 있는 능력이다.

모니터링이 "CPU가 80%이다"라고 알려준다면, 옵저버빌리티는 "어떤 Pod의 어떤 요청이 CPU를 많이 쓰고 있고, 그 요청은 이 경로로 들어왔다"까지 추적한다.

### 쿠버네티스에서 옵저버빌리티가 필수인 이유

쿠버네티스 환경은 전통적인 서버 환경보다 훨씬 복잡하다:

- Pod는 언제든 죽고 다시 태어남 (IP가 바뀜)
- 한 노드에 수십 개의 Pod가 실행됨
- 여러 클러스터가 동시에 운영됨
- 컨테이너 안에서 무슨 일이 일어나는지 밖에서 보이지 않음

"서버에 SSH로 접속해서 로그를 본다"는 전략은 쿠버네티스에서 통하지 않는다. Pod가 죽으면 로그도 사라지기 때문이다.

---

## 옵저버빌리티의 3대 축 (Three Pillars)

### 1. 메트릭 (Metrics) — 숫자

```
"CPU 사용률이 85%이다"
"메모리가 12GB 중 10GB 사용 중이다"
"초당 요청 수가 1500이다"
```

**숫자로 표현되는 시계열 데이터**이다. 시간에 따라 값이 변하는 것을 기록한다. 대시보드 그래프의 원재료이다.

### 2. 로그 (Logs) — 텍스트

```
2024-03-11 09:15:23 [ERROR] Connection to database timed out after 30s
2024-03-11 09:15:24 [WARN]  Retrying database connection (attempt 2/5)
2024-03-11 09:15:25 [INFO]  Database connection restored
```

**이벤트의 기록**이다. 무슨 일이 일어났는지 상세하게 알려준다. 디버깅의 핵심 도구이다.

### 3. 트레이스 (Traces) — 경로

```
사용자 요청 → API Gateway (3ms) → Auth Service (12ms) → User Service (45ms) → Database (120ms)
총 소요 시간: 180ms  ← 병목: Database
```

**하나의 요청이 여러 서비스를 거치는 전체 경로**이다. 마이크로서비스 환경에서 병목 구간을 식별할 때 필수이다.

### 프로젝트에서 사용하는 도구 매핑

| 축 | 도구 | 역할 |
|----|------|------|
| 메트릭 | **Prometheus** | 수집 및 저장 |
| 메트릭 시각화 | **Grafana** | 대시보드 |
| 로그 | **Loki** | 수집 및 저장 |
| 로그 수집 | **Promtail** | 각 노드에서 로그를 Loki로 전송 |
| 트레이스 | **Hubble** | 네트워크 플로우 (Pod 간 통신 기록) |
| 알림 | **AlertManager** | 이상 감지 시 알림 발송 |

모두 platform 클러스터에 설치된다.

---

## 왜 Prometheus + Grafana + Loki 조합인가

이 세 도구를 선택한 이유는 **메트릭과 로그의 관심사를 분리하면서도 CNCF 생태계 내에서 통합 운영**이 가능하기 때문이다.

메트릭(시계열 숫자 데이터)과 로그(이벤트 텍스트 데이터)는 저장 구조와 쿼리 패턴이 근본적으로 다르다. Prometheus는 시계열 데이터베이스(TSDB)에 최적화되어 있고, Loki는 로그 청크 저장에 최적화되어 있다. 하나의 도구로 양쪽을 처리하면(예: Elasticsearch로 메트릭+로그 모두 처리) 양쪽 모두에서 비효율이 발생한다.

Prometheus, Grafana, Loki는 모두 CNCF(Cloud Native Computing Foundation) 프로젝트이거나 CNCF 생태계와 긴밀히 통합되어 있다. Grafana 하나에서 Prometheus 메트릭과 Loki 로그를 동시에 조회할 수 있고, 같은 라벨 체계(namespace, pod, container)를 공유하므로 메트릭 이상 → 로그 추적으로의 전환이 자연스럽다.

대안으로 ELK(Elasticsearch + Logstash + Kibana) 스택이 있지만, Elasticsearch는 전문 검색을 위해 역인덱스를 구성하므로 리소스 소비가 훨씬 크다. VM 10대 규모의 이 프로젝트에서는 Loki의 경량 아키텍처가 합리적이다.

---

## Prometheus — 메트릭 수집기

### Pull 모델 기반 수집

메트릭 수집에는 두 가지 모델이 있다:

1. **Push 모델**: 각 대상이 메트릭을 중앙 서버로 전송 (대부분의 로그 시스템)
2. **Pull 모델**: 중앙 서버가 일정 간격으로 각 대상에게 HTTP 요청을 보내 메트릭을 가져옴 (Prometheus)

Prometheus는 **Pull 모델**을 사용한다. 설정된 scrape interval(기본 15초)마다 모든 타겟의 `/metrics` 엔드포인트에 HTTP GET 요청을 보내 메트릭을 수집한다.

### 왜 Pull 모델인가

Push 모델에서는 각 타겟이 메트릭을 중앙 서버로 전송한다. 이 방식은 두 가지 문제가 있다. 첫째, 타겟이 죽으면 메트릭 전송이 멈추는데, "메트릭이 안 온다"는 것이 "타겟이 죽었다"인지 "네트워크 지연인지" 구분하기 어렵다. 둘째, 타겟이 방화벽 뒤에 있을 때 외부로 나가는 연결(outbound)은 허용되더라도, 중앙 서버의 인바운드 포트를 열어야 하므로 보안 구성이 복잡해진다.

Pull 모델의 이점:

- **타겟 상태를 능동적으로 파악**: Prometheus가 scrape을 시도하고 실패하면, 해당 타겟이 응답 불가 상태라는 것을 즉시 알 수 있다. `up` 메트릭이 0이 되므로 별도 헬스체크 없이 타겟 생사를 판단한다.
- **방화벽 친화적**: Prometheus만 타겟에 접근하면 된다. 타겟은 아웃바운드 연결을 열 필요가 없고, `/metrics` 엔드포인트만 노출하면 된다.
- **중앙 집중 제어**: scrape 대상, 주기, 타임아웃을 Prometheus 설정 하나에서 관리한다. 타겟 측 코드를 수정하지 않고도 수집 정책을 변경할 수 있다.

### 프로젝트의 Prometheus 설정

설치 스크립트: `scripts/install/07-install-monitoring.sh`
Helm values: `manifests/monitoring-values.yaml`
Helm 차트: `kube-prometheus-stack` (Prometheus + Grafana + AlertManager 번들)

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

    # scrapeInterval 미설정 → kube-prometheus-stack 기본값(30s) 사용
```

핵심 설정 해석:

- **`retention: 7d`**: 메트릭을 7일간 보관한다. 로컬 환경이니 7일이면 충분하다. 프로덕션에서는 30일~1년으로 설정하기도 한다.
- **`storage: 10Gi`**: 7일치 메트릭을 저장할 10GB 디스크를 할당한다.
- **메모리 2Gi**: Prometheus는 메모리를 많이 사용한다. 수천 개의 시계열 데이터를 메모리에 올려두고 쿼리하기 때문이다.

### Node Exporter와 kube-state-metrics

```yaml
nodeExporter:
  enabled: true

kubeStateMetrics:
  enabled: true
```

이 두 줄이 매우 중요하다:

- **Node Exporter**: 각 노드(VM)에 에이전트를 설치한다. CPU, 메모리, 디스크, 네트워크 등 **하드웨어 수준** 메트릭을 수집한다.
- **kube-state-metrics**: 쿠버네티스 API 서버에서 **오브젝트 상태** 메트릭을 수집한다. Pod 개수, Deployment 상태, Node 상태 등이다.

```
Node Exporter:      "이 서버의 CPU가 80%다" (하드웨어 관점)
kube-state-metrics: "이 Deployment의 Pod가 3개 중 2개만 Ready다" (쿠버네티스 관점)
```

### 데이터 수집 흐름

```
node-exporter (각 노드)    → CPU, 메모리, 디스크, 네트워크
kube-state-metrics         → Pod 수, HPA 상태, PVC 사용량
kubelet /metrics           → 컨테이너 리소스 사용량
          │
          ▼
    Prometheus (30초 스크래핑)
          │
          ├──→ Grafana (시각화)   → http://<platform-worker>:30300
          └──→ AlertManager (알림) → http://<platform-worker>:30903
```

---

## Grafana — 대시보드 시각화

Grafana는 Prometheus에 저장된 시계열 데이터를 PromQL로 쿼리하여 **시각적 대시보드(그래프, 히트맵, 게이지 등)로 렌더링**하는 도구다.

### 프로젝트의 Grafana 설정

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

### 커뮤니티 대시보드 활용

Grafana에 직접 대시보드를 만들 수도 있지만, 커뮤니티에서 만들어 놓은 것을 가져다 쓸 수 있다. `gnetId`가 Grafana 커뮤니티 대시보드 번호이다.

- **#7249**: 쿠버네티스 클러스터 전체 상태 (노드 수, Pod 수, 리소스 사용률)
- **#1860**: Node Exporter Full 대시보드 (CPU, 메모리, 디스크, 네트워크 상세)
- **#6417**: 쿠버네티스 Pod별 리소스 사용 현황

설치와 동시에 3개의 대시보드가 자동으로 구성된다. 수동 설정 없이 바로 모니터링을 시작할 수 있다.

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

Loki를 만든 Grafana Labs는 이렇게 설명한다: **"Like Prometheus, but for logs"**

전통적인 로그 수집 시스템(Elasticsearch 등)은 로그의 전체 텍스트를 인덱싱한다. 강력하지만, 매우 많은 리소스를 소비한다.

Loki는 다른 접근을 한다:

```
Elasticsearch: 모든 로그 내용을 색인 → 디스크와 메모리를 많이 사용
Loki:          라벨만 색인, 내용은 압축 저장 → 훨씬 가벼움
```

Elasticsearch는 로그 본문 전체를 역인덱스(inverted index)로 색인하여 전문 검색이 가능하지만 리소스 소비가 크다. Loki는 라벨(namespace, pod, container 등) 메타데이터만 인덱싱하고, 로그 본문은 압축하여 청크 단위로 저장한다. 검색 시에는 라벨로 대상을 좁힌 뒤 해당 청크를 스캔하는 방식이다.

### 프로젝트의 Loki 설정

설치 설정: `manifests/loki-values.yaml`

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

Promtail은 각 노드에 DaemonSet으로 배포된다. 즉, 모든 노드에 하나씩 실행된다. 노드의 `/var/log/pods/` 디렉토리를 감시하면서, 새로운 로그가 생기면 Loki로 보낸다.

### Grafana를 false로 설정한 이유

```yaml
grafana:
  enabled: false
```

Loki-stack Helm 차트에도 Grafana를 설치하는 옵션이 있지만, 이미 `kube-prometheus-stack`에서 Grafana를 설치했다. 같은 것을 두 번 설치할 필요가 없다. 대신 Loki를 데이터소스로 자동 등록(`sidecar.datasources.enabled: true`)하여, 하나의 Grafana에서 메트릭(Prometheus)과 로그(Loki)를 모두 조회할 수 있다.

### Grafana에서 LogQL로 로그 검색

Grafana의 Explore 탭에서 LogQL 쿼리를 사용한다:

```
# demo 네임스페이스의 nginx 로그
{namespace="demo", app="nginx-web"}

# 에러가 포함된 로그만
{namespace="demo"} |= "error"

# 최근 1시간, 특정 Pod
{namespace="demo", pod="nginx-web-xxx"} | json | status >= 400
```

---

## AlertManager — 알림 라우팅

AlertManager는 Prometheus가 발생시킨 알림을 수신하여 다음 처리를 수행하는 컴포넌트다:

1. **분류(Classification)**: 알림의 severity, namespace 등 라벨 기반으로 분류
2. **그룹핑(Grouping)**: 동일 유형의 알림을 묶어서 알림 폭탄을 방지
3. **라우팅(Routing)**: 알림 등급에 따라 적절한 receiver(Slack, PagerDuty, webhook 등)로 전달
4. **억제(Inhibition)**: 상위 등급 알림이 존재할 때 하위 등급 중복 알림을 억제

### 설치

```
scripts/install/09-install-alerting.sh       ← 설치 스크립트
manifests/alerting/prometheus-rules.yaml     ← 알림 규칙 정의
manifests/alerting/webhook-logger.yaml       ← 웹훅 수신기
```

### 프로젝트의 AlertManager 설정

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
          group_wait: 10s                     # critical은 10초만 대기!
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
3. critical 등급은 10초만 대기하고 바로 발송 (긴급!)
4. 해결이 안 되면 12시간마다 재발송

**억제 규칙(inhibit_rules)**:
- 같은 문제에 대해 critical과 warning이 동시에 발생하면, warning을 억제한다
- "서버가 완전히 다운되었다(critical)" + "서버 CPU가 높다(warning)"가 동시에 오면, critical만 발송
- 불필요한 알림 중복을 방지한다

### 알림 흐름

```
Prometheus (규칙 평가)
    │ 조건 충족
    ▼
AlertManager (그룹화 + 라우팅)
    │ alertname + namespace로 그룹화
    ▼
Webhook Receiver (http://alertmanager-webhook:8080/alert)
    │
    └──→ 로그 기록 (확장: Slack, PagerDuty 등)
```

---

## 8가지 알림 규칙

`manifests/alerting/prometheus-rules.yaml`에 정의된 8가지 알림 규칙을 하나씩 살펴본다.

### 노드(Node) 관련 규칙 (4개)

**node.rules 그룹 요약**:

| 규칙 이름 | 조건 | 대기 시간 | 심각도 |
|----------|------|----------|--------|
| HighCpuUsage | CPU > 80% (5분 irate 평균) | 5분 | warning |
| HighMemoryUsage | 메모리 > 85% | 5분 | warning |
| NodeNotReady | 노드 Ready 상태 = false | 5분 | critical |
| NodeDiskPressure | 노드 DiskPressure 상태 = true | 5분 | warning |

#### 1. HighCpuUsage

```yaml
- alert: HighCpuUsage
  expr: |
    100 - (avg by (instance) (irate(node_cpu_seconds_total{mode="idle"}[5m])) * 100) > 80
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: "CPU 사용률 80% 초과"
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

**의미**: 노드가 NotReady 상태로 5분간 지속되면 **긴급** 알림. 노드 자체가 응답하지 않는 심각한 상황이다.

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

**pod.rules 그룹 요약**:

| 규칙 이름 | 조건 | 대기 시간 | 심각도 |
|----------|------|----------|--------|
| PodCrashLooping | 15분간 재시작 > 5회 | 5분 | warning |
| PodOOMKilled | OOMKilled 사유로 종료됨 | 즉시 | warning |
| HighPodRestartRate | 1시간 내 재시작 > 10회 | 즉시 | warning |
| PodNotReady | Pod Ready 상태 = false | 10분 | warning |

#### 5. PodCrashLooping

```yaml
- alert: PodCrashLooping
  expr: |
    rate(kube_pod_container_status_restarts_total[15m]) * 60 * 15 > 5
  for: 5m
  labels:
    severity: warning
```

**의미**: Pod가 15분 동안 5번 이상 재시작했으면 경고. "CrashLoop"은 Pod가 시작 → 크래시 → 재시작을 반복하는 상태이다.

#### 6. PodOOMKilled

```yaml
- alert: PodOOMKilled
  expr: |
    kube_pod_container_status_last_terminated_reason{reason="OOMKilled"} == 1
  for: 0m                       # ← 즉시 발동! 0분 대기
  labels:
    severity: warning
```

**의미**: Pod가 메모리 부족(Out Of Memory)으로 강제 종료되면 즉시 경고. `for: 0m`이므로 발생 즉시 알림이 간다.

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

**의미**: Pod가 10분간 Ready 상태가 아니면 경고. 배포 후 정상 기동에 실패한 경우를 감지한다.

---

## 인프라 리소스 배치 전략

### 왜 모니터링을 특정 노드에 집중하는가 — 리소스 경합 방지

모니터링 워크로드를 애플리케이션 워크로드와 같은 노드에서 실행하면 **리소스 경합** 문제가 발생한다. 애플리케이션 트래픽이 급증하여 CPU와 메모리를 대량 소비하면, 같은 노드의 Prometheus가 리소스 부족으로 OOM Kill 당하거나 scrape 지연이 발생한다. 정작 장애가 발생한 시점에 모니터링이 죽어버리는 최악의 상황이 된다.

이 프로젝트에서는 모니터링 전용 클러스터(platform)를 별도로 두고, 그 안에서도 모니터링 전용 노드(platform-worker1)에 모니터링 스택을 집중 배치한다. platform-worker1은 **3 CPU, 12GB 메모리**로 가장 강력한 워커 노드이다.

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

CI/CD 도구(Jenkins, ArgoCD)는 platform-worker2에 배치하여, Jenkins 빌드의 CPU 스파이크가 Prometheus의 scrape 주기를 방해하지 않도록 한다. 모니터링 시스템은 다른 모든 시스템보다 먼저 살아 있어야 하므로, 리소스를 넉넉히 할당하고 다른 워크로드와 격리하는 것이 원칙이다.

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
  ├── [Prometheus] ←── 메트릭 수집 (Pull, 30초 간격)
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

## 접근 URL 및 수정 가이드

### 접근 URL

| 서비스 | URL | 인증 |
|--------|-----|------|
| Grafana | `http://<platform-worker1-ip>:30300` | admin / admin |
| AlertManager | `http://<platform-worker1-ip>:30903` | 없음 |

> **참고**: Prometheus는 NodePort가 설정되어 있지 않으므로 외부에서 직접 접속할 수 없다.
> Grafana 내 Data Sources에서 Prometheus를 사용하거나, `kubectl port-forward`로 접근하면 된다.

### NodePort란?

쿠버네티스 Service에는 3가지 타입이 있다:

| 타입 | 접근 방법 | 용도 |
|------|----------|------|
| ClusterIP | 클러스터 내부에서만 접근 가능 | 기본값, 내부 서비스 간 통신 |
| **NodePort** | 노드IP:포트로 외부에서 접근 가능 | 개발/테스트 환경 |
| LoadBalancer | 클라우드 로드밸런서를 자동 생성 | 프로덕션 환경 |

이 프로젝트는 로컬 환경이므로 NodePort를 사용한다. 30300, 30903처럼 **30000-32767 범위의 포트**를 노드에 열어서 외부(Mac 호스트)에서 접근할 수 있게 한다.

### 수정 가이드

| 하고 싶은 것 | 수정할 파일 |
|-------------|-----------|
| 스크래핑 간격 변경 | `manifests/monitoring-values.yaml`의 scrapeInterval |
| 데이터 보존 기간 변경 | `manifests/monitoring-values.yaml`의 retention |
| 새 알림 규칙 추가 | `manifests/alerting/prometheus-rules.yaml`에 규칙 추가 |
| Grafana 대시보드 추가 | `manifests/monitoring-values.yaml`의 dashboardProviders |
| 알림을 Slack으로 보내기 | AlertManager 설정에 slack receiver 추가 |
| NodePort 변경 | 각 values.yaml의 service.nodePort |

---

## 실제 프로덕션에서는

### 스케일의 차이

이 프로젝트에서는 10개 VM에 단일 Prometheus로 충분하다. 하지만 프로덕션에서는:

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

- **Slack**: `slack_configs`로 채널에 알림
- **PagerDuty**: `pagerduty_configs`로 당직자에게 전화/문자
- **Email**: `email_configs`로 이메일 발송
- **MS Teams, OpsGenie** 등 다양한 연동 가능

### 대시보드 확장

커뮤니티 대시보드 3개 외에도, 각 팀의 서비스에 맞는 커스텀 대시보드를 만들게 된다. Grafana의 PromQL 쿼리 빌더를 사용하면 코드를 모르는 사람도 대시보드를 구성할 수 있다.

### Loki의 한계와 대안

Loki는 가볍지만, 전문 검색(Full-text search)이 필요하면 ELK(Elasticsearch + Logstash + Kibana) 스택이 더 적합하다. 다만 리소스 소비가 훨씬 크기 때문에, 이 프로젝트처럼 리소스가 제한된 환경에서는 Loki가 합리적인 선택이다.

---

## 정리

| 개념 | 한 줄 설명 |
|------|-----------|
| 모니터링 | 시스템 상태를 실시간으로 관찰하는 것 |
| 옵저버빌리티 | 모니터링 + 원인 추적까지 가능한 능력 |
| MTTD | 장애 감지 시간 — 모니터링으로 단축 |
| MTTR | 장애 복구 시간 — 메트릭+로그로 단축 |
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
| `scripts/install/07-install-monitoring.sh` | Prometheus + Grafana 설치 스크립트 |
| `scripts/install/09-install-alerting.sh` | AlertManager 알림 규칙 설치 스크립트 |
| `manifests/monitoring-values.yaml` | Prometheus + Grafana + AlertManager 설정 |
| `manifests/loki-values.yaml` | Loki + Promtail 설정 |
| `manifests/alerting/prometheus-rules.yaml` | 8가지 알림 규칙 정의 |
| `manifests/alerting/webhook-logger.yaml` | 알림 수신용 webhook 서버 |
| `config/clusters.json` | platform-worker1 리소스 정의 (3CPU, 12GB) |
