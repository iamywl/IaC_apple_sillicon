# 모니터링(Monitoring)과 옵저버빌리티(Observability) 설계

## 1. 옵저버빌리티의 세 기둥(Three Pillars of Observability)

```
┌──────────────────────────────────────────────────────────────┐
│                     옵저버빌리티(Observability)                 │
│                                                              │
│  ┌─── Metrics ──────┐  ┌─── Logs ────────┐  ┌── Traces ──┐ │
│  │  Prometheus       │  │  Loki            │  │  (Hubble)  │ │
│  │  → 수치 데이터     │  │  → 텍스트 이벤트  │  │  → 요청 흐름│ │
│  │  (Numeric Data)   │  │  (Text Events)   │  │  (Request  │ │
│  │  "CPU 80%"        │  │  "Error: OOM"    │  │   Flow)    │ │
│  │  "Pod 재시작 5회"  │  │  "Connection..."  │  │  A→B→C     │ │
│  │  (5 Restarts)     │  │                   │  │            │ │
│  └────────┬─────────┘  └────────┬─────────┘  └─────┬──────┘ │
│           │                      │                    │       │
│           └──────────────────────┼────────────────────┘       │
│                                  │                            │
│                          ┌───────▼───────┐                    │
│                          │   Grafana     │ ← 통합 시각화       │
│                          │               │  (Unified           │
│                          │               │   Visualization)    │
│                          └───────────────┘                    │
│                                                              │
│  ┌─── 알림(Alerting) ─────────────────────────────────────┐  │
│  │  AlertManager → PrometheusRule → Webhook/Slack/Email    │  │
│  └─────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

| 기둥(Pillar) | 도구(Tool) | 질문에 답할 수 있는 것(What It Answers) |
|------|------|----------------------|
| 메트릭(Metrics) | Prometheus | "지금 CPU가 몇 %인가?", "5분간 평균 메모리 사용률(Avg Memory Utilization)은?" |
| 로그(Logs) | Loki | "에러가 왜 발생했는가?", "어떤 요청(Request)이 실패했는가?" |
| 트레이스(Traces) | Hubble | "요청이 어떤 경로(Path)로 흘러갔는가?", "어디서 차단(Drop)됐는가?" |
| 알림(Alerting) | AlertManager | "장애(Incident) 시 누구에게 알릴 것인가?" |

---

## 2. Prometheus — 메트릭 수집 엔진(Metrics Collection Engine)

### 2.1 Pull 모델(Pull Model)

Prometheus는 **Pull 기반(Pull-based)** 수집을 사용한다:

```
┌──────────┐         ┌──────────┐
│ Prometheus│ ─scrape─→│ 대상 Pod │
│          │ (HTTP)   │ /metrics │
│          │          │(Target)  │
└──────────┘         └──────────┘
```

**Push vs Pull**:
- Push (예: StatsD): 대상이 메트릭 서버에 데이터를 보냄 → 대상이 서버 주소를 알아야 함
- Pull (Prometheus): 서버가 대상에서 데이터를 가져감 → **대상이 서버를 몰라도 됨**

### 2.2 kube-prometheus-stack 구성(Composition)

이 프로젝트에서 사용하는 `kube-prometheus-stack` Helm 차트(Chart)가 한 번에 설치하는 것들:

```
kube-prometheus-stack
├── Prometheus Server        ← 메트릭 수집/저장 — TSDB(Time Series Database)
├── Grafana                  ← 시각화 대시보드(Visualization Dashboard)
├── AlertManager             ← 알림 라우팅(Alert Routing)/그룹핑(Grouping)
├── node-exporter (DaemonSet) ← 노드별 하드웨어 메트릭(Hardware Metrics)
├── kube-state-metrics       ← K8s 오브젝트(Object) 상태 메트릭
└── Prometheus Operator      ← CRD(Custom Resource Definition)로 메트릭 대상 관리
```

### 2.3 설정 분석(Configuration Analysis)

```yaml
# manifests/monitoring-values.yaml

prometheus:
  prometheusSpec:
    retention: 7d           # 7일간 메트릭 보관(Retention)
    resources:
      requests:
        cpu: 200m           # 최소 0.2 CPU
        memory: 512Mi       # 최소 512MB
      limits:
        memory: 2Gi         # 최대 2GB — OOM(Out of Memory) 방지
    storageSpec:
      volumeClaimTemplate:
        spec:
          resources:
            requests:
              storage: 10Gi  # 10GB 디스크(Disk) — 7일분
```

**리소스 설계 근거(Resource Design Rationale)**:
- `retention: 7d` — 학습 환경(Learning Environment)에서 7일이면 충분
- `memory: 2Gi` — 10개 VM의 메트릭을 7일 보관하기에 적정
- `storage: 10Gi` — Prometheus TSDB는 압축율(Compression Ratio)이 높아 10GB로 충분

---

## 3. Grafana — 통합 시각화(Unified Visualization)

### 3.1 대시보드 프로비저닝(Dashboard Provisioning)

Grafana는 **코드로 대시보드를 관리(Dashboard as Code)**할 수 있다:

```yaml
# monitoring-values.yaml
grafana:
  dashboardProviders:
    dashboardproviders.yaml:
      apiVersion: 1
      providers:
        - name: default
          type: file
          options:
            path: /var/lib/grafana/dashboards/default
  dashboards:
    default:
      kubernetes-cluster:
        gnetId: 7249          # Grafana.com 공개 대시보드(Public Dashboard) ID
        revision: 1
        datasource: Prometheus
```

**grafana.com에서 대시보드를 ID로 가져오는 패턴(Import by ID Pattern)**:
- `gnetId: 7249` = "Kubernetes Cluster" 대시보드
- `gnetId: 1860` = "Node Exporter Full" 대시보드
- Helm values에 정의 → 배포(Deploy) 시 자동 프로비저닝(Auto Provisioning)

### 3.2 데이터소스 계층(Data Source Layers)

```
Grafana
├── Prometheus (기본 데이터소스, Default Data Source)
│   └── 메트릭 쿼리(Metric Query): PromQL
│       예: rate(container_cpu_usage_seconds_total[5m])
│
└── Loki (추가 데이터소스, Additional Data Source)
    └── 로그 쿼리(Log Query): LogQL
        예: {namespace="demo"} |= "error"
```

**주의(Important)**: Loki를 기본 데이터소스로 설정하면 Prometheus와 충돌(Conflict) — BUG-006에서 발견
```yaml
# loki-values.yaml — 이 설정이 중요(Critical Setting)
grafana:
  sidecar:
    datasources:
      isDefaultDatasource: false  # false여야 Prometheus가 기본(Default)
```

---

## 4. Loki — 로그 수집(Log Collection)

### 4.1 아키텍처(Architecture)

```
┌── 각 노드(Each Node) ─────┐
│  ┌─ Promtail ──────────┐   │     ┌── Loki ──────────────────┐
│  │ /var/log/pods/*      │   │ ──→ │ 로그 인덱싱(Indexing)     │
│  │ 라벨 추가(Add Labels)│   │     │ + 저장(Storage)           │
│  └──────────────────────┘   │     │ (S3/파일시스템)            │
└─────────────────────────────┘     └──────────┬───────────────┘
                                               │
                                               ▼
                                       ┌── Grafana ──────┐
                                       │ LogQL 쿼리       │
                                       │ 로그 시각화       │
                                       │ (Log Visualization)│
                                       └─────────────────┘
```

- **Promtail**: 각 노드의 DaemonSet, Pod 로그 수집(Collection) + 라벨 부착(Label Attachment)
- **Loki**: 인덱싱(Indexing)은 라벨(Label)만 — 전문 검색(Full-text Search) 안 함 → 저장 비용 절감(Cost Reduction)

### 4.2 LogQL 쿼리 예시(Query Examples)

```logql
# demo 네임스페이스(Namespace)의 에러 로그(Error Logs)
{namespace="demo"} |= "error"

# nginx Pod의 4xx/5xx 응답(Response)
{app="nginx-web"} | json | status >= 400

# 특정 시간대 로그(Time-specific Logs)
{namespace="kube-system", app="cilium"} | line_format "{{.msg}}"
```

---

## 5. AlertManager — 알림 시스템(Alerting System)

### 5.1 알림 흐름(Alert Flow)

```
Prometheus
│ PrometheusRule CRD 평가(Evaluation) — 매 15초
│ 조건 충족(Condition Met) → firing alert 생성(Create)
│
▼
AlertManager
│ 그룹핑(Grouping): alertname + namespace로 묶음
│ 억제(Inhibition): critical 발생 시 warning 무시(Suppress)
│ 대기(group_wait): 30초 대기 후 묶어서 발송(Batch Send)
│
▼
수신기(Receiver) — Webhook
│ http://alertmanager-webhook:8080/alert
│
▼
webhook-logger Pod (mendhak/http-https-echo)
│ 수신된 알림을 로그로 출력(Log Received Alerts)
```

### 5.2 알림 규칙 설계(Alert Rule Design)

```yaml
# manifests/alerting/prometheus-rules.yaml

# 예시(Example): CPU 80% 초과 5분 지속(Sustained for 5min)
- alert: HighCpuUsage
  expr: |
    100 - (avg by(instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100) > 80
  for: 5m                    # 5분간 지속되어야 발동(Fire after 5min)
  labels:
    severity: warning
  annotations:
    summary: "CPU 사용률 80% 초과(CPU Utilization > 80%)"
    description: "{{ $labels.instance }}의 CPU 사용률이 {{ $value }}%입니다."
```

**알림 규칙 설계 원칙(Alert Rule Design Principles)**:

| 원칙(Principle) | 설명(Description) | 이 프로젝트 적용(Application) |
|------|------|-----------------|
| `for` 절 사용(Use `for` Clause) | 일시적 스파이크(Transient Spike)로 알림이 발생하지 않도록 | 5분~10분 |
| 심각도 분류(Severity Classification) | critical (즉시 대응, Immediate) vs warning (모니터링) | 2단계(2 Levels) |
| 억제 규칙(Inhibit Rules) | critical 발생 시 같은 대상의 warning 억제(Suppress) | 적용(Applied) |
| 그룹핑(Group By) | 동일 유형 알림을 묶어 발송(Batch Similar Alerts) | alertname + namespace |

### 5.3 알림 규칙 목록(Alert Rule List)

| 규칙(Rule) | PromQL 조건(Condition) | 지속시간(Duration) | 심각도(Severity) |
|------|------------|----------|--------|
| HighCpuUsage | CPU > 80% | 5m | warning |
| HighMemoryUsage | Memory > 85% | 5m | warning |
| NodeNotReady | kube_node_status_condition Ready!=True | 5m | critical |
| NodeDiskPressure | kube_node_status_condition DiskPressure=True | 5m | warning |
| PodCrashLooping | 15분간 재시작(Restarts in 15min) >= 5 | 0 | warning |
| PodOOMKilled | reason=OOMKilled | 0 | warning |
| HighPodRestartRate | 1시간 재시작(Restarts/hour) > 10 | 0 | warning |
| PodNotReady | kube_pod_status_ready != True | 10m | warning |

---

## 6. HPA(Horizontal Pod Autoscaler) — 자동 수평 확장(Auto Horizontal Scaling)

### 6.1 동작 원리(Operation Principle)

```
metrics-server
│ kubelet /metrics/resource → Pod CPU/메모리(Memory) 수집(Collection)
│ Metrics API (/apis/metrics.k8s.io/v1beta1) 제공(Provide)
│
▼
HPA Controller (kube-controller-manager 내장, Built-in)
│ 30초마다 현재 메트릭 확인(Check Current Metrics Every 30s)
│ 목표(Target) CPU 50% vs 현재(Current) CPU 비교
│ desiredReplicas = ceil(currentReplicas × (currentMetric / targetMetric))
│
▼
Deployment
│ 레플리카(Replicas) 수 조정 → Pod 생성/삭제(Create/Delete)
```

### 6.2 HPA 공식(Formula)

```
desiredReplicas = ⌈ currentReplicas × (currentMetric / targetMetric) ⌉
```

예시(Example): nginx가 3개 Pod에서 CPU 80%
```
desired = ⌈ 3 × (80 / 50) ⌉ = ⌈ 4.8 ⌉ = 5
→ 5개로 스케일 업(Scale Up)
```

### 6.3 설정 분석(Configuration Analysis)

```yaml
# manifests/hpa/nginx-hpa.yaml
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: nginx-web
  minReplicas: 3                    # 최소(Min) 3개 — 트래픽 없어도
  maxReplicas: 10                   # 최대(Max) 10개 — 리소스 보호(Resource Protection)
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 50    # CPU 50% 초과 시 스케일업(Scale Up)
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 30   # 30초 안정화(Stabilization) — 빠른 반응(Fast Response)
      policies:
        - type: Percent
          value: 100                    # 한 번에 100%까지 증가 가능
          periodSeconds: 30
    scaleDown:
      stabilizationWindowSeconds: 300  # 5분 안정화 — 느린 축소(Slow Scale Down)
      policies:
        - type: Percent
          value: 25                    # 한 번에 25%만 감소(Decrease)
          periodSeconds: 60
```

**설계 의도(Design Intent)**:
- 스케일업(Scale Up)은 빠르게 (30초) — 트래픽 급증(Traffic Surge) 대응
- 스케일다운(Scale Down)은 느리게 (5분, 25%씩) — 요동(Flapping) 방지

### 6.4 PDB(Pod Disruption Budget)

HPA가 스케일다운할 때 **최소 가용성(Minimum Availability)을 보장**:

```yaml
# manifests/hpa/pdb-nginx.yaml
spec:
  minAvailable: 2    # 항상 최소 2개 Pod 유지(Maintain at Least 2 Pods)
  selector:
    matchLabels:
      app: nginx-web
```

스케일다운 시나리오(Scale Down Scenario):
```
현재(Current) Pod: 5개
스케일다운 목표(Target): 3개
PDB minAvailable: 2

→ 5 → 4 → 3 (2개 삭제, 항상 2개 이상 유지)
→ 3 → 2 (차단, Blocked! minAvailable 위반, Violation)
```

---

## 7. 커스텀 대시보드(Custom Dashboard) — 실시간 인프라 모니터링(Real-time Infrastructure Monitoring)

### 7.1 왜 커스텀 대시보드인가?(Why a Custom Dashboard?)

Grafana가 있는데 왜 별도 대시보드를 만들었는가:

| 관점(Aspect) | Grafana | 커스텀 대시보드(Custom Dashboard) |
|------|---------|----------------|
| 범위(Scope) | K8s 내부 메트릭만(Internal Metrics Only) | VM + K8s + 네트워크 통합(Integrated) |
| VM 관리(VM Management) | 불가 | tart list/ip 통합 |
| 포트 정보(Port Info) | 불가 | ss -tlnp로 열린 포트(Open Ports) 표시 |
| 네트워크(Network) | 제한적(Limited) | /proc/net/dev 실시간 트래픽(Real-time Traffic) |
| 접근성(Accessibility) | NodePort 접속 필요 | localhost:3000 즉시 접근(Instant Access) |

### 7.2 데이터 수집 아키텍처(Data Collection Architecture)

```
Collector (5초 루프, 5s Loop)
│
├── tart list → VM 목록/상태/스펙(VM List/Status/Specs)
├── tart ip <vm> → IP 주소(Address)
│
├── SSH Pool (ssh2 라이브러리, Library)
│   ├── top -bn1 → CPU 사용률(Utilization)
│   ├── free -m → 메모리 사용률(Memory Utilization)
│   ├── df / → 디스크 사용률(Disk Utilization)
│   ├── ss -tlnp → 열린 포트(Open Ports)
│   └── /proc/net/dev → 네트워크 트래픽(Network Traffic)
│
└── kubectl (4개 클러스터)
    ├── get nodes -o json → 노드 상태(Node Status)
    └── get pods -A -o json → Pod 목록(Pod List)
```

**SSH 커넥션 풀(Connection Pool)**: VM당 1개 TCP 연결을 유지하고 재사용(Reuse)
```typescript
// 5초마다 새 연결을 맺지 않음 → 성능 최적화(Performance Optimization)
const pool = new Map<string, Client>();  // VM별 ssh2 Client 캐시(Cache)
```

### 7.3 에러 내성(Error Tolerance)

```typescript
// 일부 VM 장애 시에도 나머지 데이터 수집(Collect Remaining Data on Partial Failure)
const results = await Promise.allSettled(
  vms.map(vm => collectVmData(vm))
);

// fulfilled → 정상 데이터(Normal Data)
// rejected → errors 배열에 추가 — UI에 경고 표시(Warning Display)
```

**우아한 성능 저하(Graceful Degradation)**: 10개 VM 중 1개가 응답 없어도 나머지 9개 데이터는 정상 표시

---

## 8. 부하 테스트(Load Testing) — k6

### 8.1 부하 테스트 설정(Load Test Configuration)

```yaml
# manifests/demo/k6-loadtest.yaml
command: ["k6", "run", "--vus", "100", "--duration", "60s", "-"]
```

- **100 VUs(Virtual Users)**: 동시 100명의 가상 사용자
- **60초(60 Seconds)**: 1분간 지속적으로 요청(Continuous Requests)
- nginx:30080에 HTTP GET 요청

### 8.2 HPA 트리거 검증(HPA Trigger Verification)

```
시간(Time) VU   nginx CPU  HPA 레플리카(Replicas)
0s         0    5%         3 (min)
10s        100  60%        3 → 스케일업 대기(Scale Up Wait, 30초)
40s        100  75%        3 → 5 (스케일업, Scale Up)
60s        100  55%        5 → 6
70s        0    10%        6 (5분 안정화 대기, 5min Stabilization Wait)
370s       0    5%         6 → 5 → 4 → 3 (점진적 축소, Gradual Scale Down)
```

---

## 9. 검증 명령 모음(Verification Commands)

```bash
# Prometheus 타겟 확인(Target Check)
kubectl --kubeconfig kubeconfig/platform.yaml -n monitoring \
  port-forward svc/kube-prometheus-stack-prometheus 9090:9090 &
open http://localhost:9090/targets

# Grafana 접속(Access)
open http://$(tart ip platform-worker1):30300  # admin/admin

# AlertManager 접속
open http://$(tart ip platform-worker1):30903

# 알림 규칙 확인(Alert Rule Check)
kubectl --kubeconfig kubeconfig/platform.yaml -n monitoring \
  get prometheusrule

# HPA 상태 실시간 확인(Real-time HPA Status)
kubectl --kubeconfig kubeconfig/dev.yaml -n demo get hpa -w

# 부하 테스트 실행(Run Load Test)
kubectl --kubeconfig kubeconfig/dev.yaml apply -f manifests/demo/k6-loadtest.yaml
kubectl --kubeconfig kubeconfig/dev.yaml -n demo logs -f job/k6-loadtest

# Webhook 알림 로그 확인(Alert Log Check)
kubectl --kubeconfig kubeconfig/platform.yaml -n monitoring \
  logs -l app=alertmanager-webhook -f

# 커스텀 대시보드 실행(Run Custom Dashboard)
cd dashboard && npm install && npm run dev
open http://localhost:3000
```
