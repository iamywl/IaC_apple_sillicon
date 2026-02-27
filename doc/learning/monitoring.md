# 모니터링과 옵저버빌리티 설계

## 1. 옵저버빌리티의 세 기둥 (Three Pillars)

```
┌──────────────────────────────────────────────────────────────┐
│                     옵저버빌리티                               │
│                                                              │
│  ┌─── Metrics ──────┐  ┌─── Logs ────────┐  ┌── Traces ──┐ │
│  │  Prometheus       │  │  Loki            │  │  (Hubble)  │ │
│  │  → 수치 데이터     │  │  → 텍스트 이벤트  │  │  → 요청 흐름│ │
│  │  "CPU 80%"        │  │  "Error: OOM"    │  │  A→B→C     │ │
│  │  "Pod 재시작 5회"  │  │  "Connection..."  │  │            │ │
│  └────────┬─────────┘  └────────┬─────────┘  └─────┬──────┘ │
│           │                      │                    │       │
│           └──────────────────────┼────────────────────┘       │
│                                  │                            │
│                          ┌───────▼───────┐                    │
│                          │   Grafana     │ ← 통합 시각화      │
│                          └───────────────┘                    │
│                                                              │
│  ┌─── Alerting ─────────────────────────────────────────────┐│
│  │  AlertManager → PrometheusRule → Webhook/Slack/Email     ││
│  └──────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────┘
```

| 기둥 | 도구 | 질문에 답할 수 있는 것 |
|------|------|----------------------|
| Metrics | Prometheus | "지금 CPU가 몇 %인가?", "5분간 평균 메모리 사용률은?" |
| Logs | Loki | "에러가 왜 발생했는가?", "어떤 요청이 실패했는가?" |
| Traces | Hubble | "요청이 어떤 경로로 흘러갔는가?", "어디서 차단됐는가?" |
| Alerting | AlertManager | "장애 시 누구에게 알릴 것인가?" |

---

## 2. Prometheus — 메트릭 수집 엔진

### 2.1 Pull 모델

Prometheus는 **Pull 기반** 수집을 사용한다:

```
┌──────────┐         ┌──────────┐
│ Prometheus│ ─scrape─→│ 대상 Pod │
│          │ (HTTP)   │ /metrics │
└──────────┘         └──────────┘
```

**Push vs Pull**:
- Push (예: StatsD): 대상이 메트릭 서버에 데이터를 보냄 → 대상이 서버 주소를 알아야 함
- Pull (Prometheus): 서버가 대상에서 데이터를 가져감 → **대상이 서버를 몰라도 됨**

### 2.2 kube-prometheus-stack 구성

이 프로젝트에서 사용하는 `kube-prometheus-stack` Helm 차트가 한 번에 설치하는 것들:

```
kube-prometheus-stack
├── Prometheus Server        ← 메트릭 수집/저장 (TSDB)
├── Grafana                  ← 시각화 대시보드
├── AlertManager             ← 알림 라우팅/그룹핑
├── node-exporter (DaemonSet) ← 노드별 하드웨어 메트릭
├── kube-state-metrics       ← K8s 오브젝트 상태 메트릭
└── Prometheus Operator      ← CRD로 메트릭 대상 관리
```

### 2.3 설정 분석

```yaml
# manifests/monitoring-values.yaml

prometheus:
  prometheusSpec:
    retention: 7d           # 7일간 메트릭 보관
    resources:
      requests:
        cpu: 200m           # 최소 0.2 CPU
        memory: 512Mi       # 최소 512MB
      limits:
        memory: 2Gi         # 최대 2GB (OOM 방지)
    storageSpec:
      volumeClaimTemplate:
        spec:
          resources:
            requests:
              storage: 10Gi  # 10GB 디스크 (7일분)
```

**리소스 설계 근거**:
- `retention: 7d` — 학습 환경에서 7일이면 충분
- `memory: 2Gi` — 10개 VM의 메트릭을 7일 보관하기에 적정
- `storage: 10Gi` — Prometheus TSDB는 압축율이 높아 10GB로 충분

---

## 3. Grafana — 통합 시각화

### 3.1 대시보드 프로비저닝

Grafana는 **코드로 대시보드를 관리**할 수 있다:

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
        gnetId: 7249          # Grafana.com 공개 대시보드 ID
        revision: 1
        datasource: Prometheus
```

**grafana.com에서 대시보드를 ID로 가져오는 패턴**:
- `gnetId: 7249` = "Kubernetes Cluster" 대시보드
- `gnetId: 1860` = "Node Exporter Full" 대시보드
- Helm values에 정의 → 배포 시 자동 프로비저닝

### 3.2 데이터소스 계층

```
Grafana
├── Prometheus (기본 데이터소스)
│   └── 메트릭 쿼리: PromQL
│       예: rate(container_cpu_usage_seconds_total[5m])
│
└── Loki (추가 데이터소스)
    └── 로그 쿼리: LogQL
        예: {namespace="demo"} |= "error"
```

**주의**: Loki를 기본 데이터소스로 설정하면 Prometheus와 충돌 (BUG-006에서 발견)
```yaml
# loki-values.yaml — 이 설정이 중요
grafana:
  sidecar:
    datasources:
      isDefaultDatasource: false  # false여야 Prometheus가 기본
```

---

## 4. Loki — 로그 수집

### 4.1 아키텍처

```
┌── 각 노드 ──────────┐
│  ┌─ Promtail ──────┐ │     ┌── Loki ──────────────┐
│  │ /var/log/pods/* │ │ ──→ │ 로그 인덱싱 + 저장    │
│  │ 라벨 추가        │ │     │ (S3/파일시스템)       │
│  └─────────────────┘ │     └──────────┬────────────┘
└──────────────────────┘                │
                                        ▼
                                ┌── Grafana ──────┐
                                │ LogQL 쿼리       │
                                │ 로그 시각화       │
                                └─────────────────┘
```

- **Promtail**: 각 노드의 DaemonSet, Pod 로그 수집 + 라벨 부착
- **Loki**: 인덱싱은 라벨만 (전문 검색 안 함) → 저장 비용 절감

### 4.2 LogQL 쿼리 예시

```logql
# demo 네임스페이스의 에러 로그
{namespace="demo"} |= "error"

# nginx Pod의 4xx/5xx 응답
{app="nginx-web"} | json | status >= 400

# 특정 시간대 로그
{namespace="kube-system", app="cilium"} | line_format "{{.msg}}"
```

---

## 5. AlertManager — 알림 시스템

### 5.1 알림 흐름

```
Prometheus
│ PrometheusRule CRD 평가 (매 15초)
│ 조건 충족 → firing alert 생성
│
▼
AlertManager
│ 그룹핑: alertname + namespace로 묶음
│ 억제(inhibit): critical 발생 시 warning 무시
│ 대기(group_wait): 30초 대기 후 묶어서 발송
│
▼
Receiver (Webhook)
│ http://alertmanager-webhook:8080/alert
│
▼
webhook-logger Pod (mendhak/http-https-echo)
│ 수신된 알림을 로그로 출력
```

### 5.2 알림 규칙 설계

```yaml
# manifests/alerting/prometheus-rules.yaml

# 예시: CPU 80% 초과 5분 지속
- alert: HighCpuUsage
  expr: |
    100 - (avg by(instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100) > 80
  for: 5m                    # 5분간 지속되어야 발동
  labels:
    severity: warning
  annotations:
    summary: "CPU 사용률 80% 초과"
    description: "{{ $labels.instance }}의 CPU 사용률이 {{ $value }}%입니다."
```

**알림 규칙 설계 원칙**:

| 원칙 | 설명 | 이 프로젝트 적용 |
|------|------|-----------------|
| `for` 절 사용 | 일시적 스파이크로 알림이 발생하지 않도록 | 5분~10분 |
| severity 분류 | critical (즉시 대응) vs warning (모니터링) | 2단계 |
| inhibit_rules | critical 발생 시 같은 대상의 warning 억제 | 적용 |
| group_by | 동일 유형 알림을 묶어 발송 | alertname + namespace |

### 5.3 알림 규칙 목록

| 규칙 | PromQL 조건 | 지속시간 | 심각도 |
|------|------------|----------|--------|
| HighCpuUsage | CPU > 80% | 5m | warning |
| HighMemoryUsage | Memory > 85% | 5m | warning |
| NodeNotReady | kube_node_status_condition Ready!=True | 5m | critical |
| NodeDiskPressure | kube_node_status_condition DiskPressure=True | 5m | warning |
| PodCrashLooping | 15분간 재시작 >= 5 | 0 | warning |
| PodOOMKilled | reason=OOMKilled | 0 | warning |
| HighPodRestartRate | 1시간 재시작 > 10 | 0 | warning |
| PodNotReady | kube_pod_status_ready != True | 10m | warning |

---

## 6. HPA — 자동 수평 확장

### 6.1 동작 원리

```
metrics-server
│ kubelet /metrics/resource → Pod CPU/메모리 수집
│ Metrics API (/apis/metrics.k8s.io/v1beta1) 제공
│
▼
HPA Controller (kube-controller-manager 내장)
│ 30초마다 현재 메트릭 확인
│ 목표 CPU 50% vs 현재 CPU 비교
│ desiredReplicas = ceil(currentReplicas × (currentMetric / targetMetric))
│
▼
Deployment
│ replicas 수 조정 → Pod 생성/삭제
```

### 6.2 HPA 공식

```
desiredReplicas = ⌈ currentReplicas × (currentMetric / targetMetric) ⌉
```

예시: nginx가 3개 Pod에서 CPU 80%
```
desired = ⌈ 3 × (80 / 50) ⌉ = ⌈ 4.8 ⌉ = 5
→ 5개로 스케일 업
```

### 6.3 설정 분석

```yaml
# manifests/hpa/nginx-hpa.yaml
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: nginx-web
  minReplicas: 3                    # 최소 3개 (트래픽 없어도)
  maxReplicas: 10                   # 최대 10개 (리소스 보호)
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 50    # CPU 50% 초과 시 스케일업
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 30   # 30초 안정화 (빠른 반응)
      policies:
        - type: Percent
          value: 100                    # 한 번에 100%까지 증가 가능
          periodSeconds: 30
    scaleDown:
      stabilizationWindowSeconds: 300  # 5분 안정화 (느린 축소)
      policies:
        - type: Percent
          value: 25                    # 한 번에 25%만 감소
          periodSeconds: 60
```

**설계 의도**:
- 스케일업은 빠르게 (30초) — 트래픽 급증 대응
- 스케일다운은 느리게 (5분, 25%씩) — 요동(flapping) 방지

### 6.4 PDB (PodDisruptionBudget)

HPA가 스케일다운할 때 **최소 가용성을 보장**:

```yaml
# manifests/hpa/pdb-nginx.yaml
spec:
  minAvailable: 2    # 항상 최소 2개 Pod 유지
  selector:
    matchLabels:
      app: nginx-web
```

스케일다운 시나리오:
```
현재 Pod: 5개
스케일다운 목표: 3개
PDB minAvailable: 2

→ 5 → 4 → 3 (2개 삭제, 항상 2개 이상 유지)
→ 3 → 2 (차단! minAvailable 위반)
```

---

## 7. 커스텀 대시보드 — 실시간 인프라 모니터링

### 7.1 왜 커스텀 대시보드인가?

Grafana가 있는데 왜 별도 대시보드를 만들었는가:

| 관점 | Grafana | 커스텀 대시보드 |
|------|---------|----------------|
| 범위 | K8s 내부 메트릭만 | VM + K8s + 네트워크 통합 |
| VM 관리 | 불가 | tart list/ip 통합 |
| 포트 정보 | 불가 | ss -tlnp로 열린 포트 표시 |
| 네트워크 | 제한적 | /proc/net/dev 실시간 트래픽 |
| 접근성 | NodePort 접속 필요 | localhost:3000 즉시 접근 |

### 7.2 데이터 수집 아키텍처

```
Collector (5초 루프)
│
├── tart list → VM 목록/상태/스펙
├── tart ip <vm> → IP 주소
│
├── SSH Pool (ssh2 라이브러리)
│   ├── top -bn1 → CPU 사용률
│   ├── free -m → 메모리 사용률
│   ├── df / → 디스크 사용률
│   ├── ss -tlnp → 열린 포트
│   └── /proc/net/dev → 네트워크 트래픽
│
└── kubectl (4개 클러스터)
    ├── get nodes -o json → 노드 상태
    └── get pods -A -o json → Pod 목록
```

**SSH 커넥션 풀**: VM당 1개 TCP 연결을 유지하고 재사용
```typescript
// 5초마다 새 연결을 맺지 않음 → 성능 최적화
const pool = new Map<string, Client>();  // VM별 ssh2 Client 캐시
```

### 7.3 에러 내성 (Error Tolerance)

```typescript
// 일부 VM 장애 시에도 나머지 데이터 수집
const results = await Promise.allSettled(
  vms.map(vm => collectVmData(vm))
);

// fulfilled → 정상 데이터
// rejected → errors 배열에 추가 (UI에 경고 표시)
```

**Graceful Degradation**: 10개 VM 중 1개가 응답 없어도 나머지 9개 데이터는 정상 표시

---

## 8. 부하 테스트 — k6

### 8.1 부하 테스트 설정

```yaml
# manifests/demo/k6-loadtest.yaml
command: ["k6", "run", "--vus", "100", "--duration", "60s", "-"]
```

- **100 VUs (Virtual Users)**: 동시 100명의 가상 사용자
- **60초**: 1분간 지속적으로 요청
- nginx:30080에 HTTP GET 요청

### 8.2 HPA 트리거 검증

```
시간  VU   nginx CPU  HPA replicas
0s    0    5%         3 (min)
10s   100  60%        3 → 스케일업 대기 (30초)
40s   100  75%        3 → 5 (스케일업)
60s   100  55%        5 → 6
70s   0    10%        6 (5분 안정화 대기)
370s  0    5%         6 → 5 → 4 → 3 (점진적 축소)
```

---

## 9. 검증 명령 모음

```bash
# Prometheus 타겟 확인
kubectl --kubeconfig kubeconfig/platform.yaml -n monitoring \
  port-forward svc/kube-prometheus-stack-prometheus 9090:9090 &
open http://localhost:9090/targets

# Grafana 접속
open http://$(tart ip platform-worker1):30300  # admin/admin

# AlertManager 접속
open http://$(tart ip platform-worker1):30903

# 알림 규칙 확인
kubectl --kubeconfig kubeconfig/platform.yaml -n monitoring \
  get prometheusrule

# HPA 상태 실시간 확인
kubectl --kubeconfig kubeconfig/dev.yaml -n demo get hpa -w

# 부하 테스트 실행
kubectl --kubeconfig kubeconfig/dev.yaml apply -f manifests/demo/k6-loadtest.yaml
kubectl --kubeconfig kubeconfig/dev.yaml -n demo logs -f job/k6-loadtest

# Webhook 알림 로그 확인
kubectl --kubeconfig kubeconfig/platform.yaml -n monitoring \
  logs -l app=alertmanager-webhook -f

# 커스텀 대시보드 실행
cd dashboard && npm install && npm run dev
open http://localhost:3000
```
