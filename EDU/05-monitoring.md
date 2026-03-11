# 05. 모니터링 & 관측성 - Prometheus, Grafana, Loki, AlertManager

## 관측성 3대 요소

| 요소 | 도구 | 역할 |
|------|------|------|
| 메트릭 | Prometheus | 숫자 시계열 데이터 (CPU %, 요청 수, 지연시간) |
| 로그 | Loki + Promtail | 컨테이너 텍스트 로그 수집/검색 |
| 트레이스 | Hubble | 네트워크 플로우 (Pod 간 통신 기록) |

모두 platform 클러스터에 설치됩니다.

## Prometheus + Grafana

### 설치

```
scripts/install/07-install-monitoring.sh  ← 설치 스크립트
manifests/monitoring-values.yaml          ← Helm values
```

Helm 차트: `kube-prometheus-stack` (Prometheus + Grafana + AlertManager 번들)

### 주요 설정 (manifests/monitoring-values.yaml)

```yaml
prometheus:
  prometheusSpec:
    retention: 7d              # 7일간 메트릭 보존
    storageSpec:
      volumeClaimTemplate:
        spec:
          resources:
            requests:
              storage: 10Gi    # 10GB 스토리지

    # scrapeInterval 미설정 → kube-prometheus-stack 기본값(30s) 사용

grafana:
  service:
    type: NodePort
    nodePort: 30300            # http://<platform-worker>:30300
  adminUser: admin
  adminPassword: admin

  dashboardProviders:          # 사전 설정 대시보드
    - name: default
      dashboards:
        - name: k8s-cluster    # Grafana 대시보드 ID 7249
        - name: node-exporter  # Grafana 대시보드 ID 1860
        - name: k8s-pods       # Grafana 대시보드 ID 6417
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

### 접속 URL

| 서비스 | URL | 인증 |
|--------|-----|------|
| Grafana | `http://<platform-worker1-ip>:30300` | admin / admin |
| AlertManager | `http://<platform-worker1-ip>:30903` | 없음 |

> **참고**: Prometheus는 NodePort가 설정되어 있지 않으므로 외부에서 직접 접속할 수 없습니다.
> Grafana 내 Data Sources에서 Prometheus를 사용하거나, `kubectl port-forward`로 접근하세요.

## 알림 규칙 (AlertManager)

### 설치

```
scripts/install/09-install-alerting.sh       ← 설치 스크립트
manifests/alerting/prometheus-rules.yaml     ← 알림 규칙 정의
manifests/alerting/webhook-logger.yaml       ← 웹훅 수신기
```

### 설정된 알림 규칙 8개 (2개 그룹)

**node.rules 그룹** (노드 레벨):

| 규칙 이름 | 조건 | 대기 시간 | 심각도 |
|----------|------|----------|--------|
| HighCpuUsage | CPU > 80% (5분 irate 평균) | 5분 | warning |
| HighMemoryUsage | 메모리 > 85% | 5분 | warning |
| NodeNotReady | 노드 Ready 상태 = false | 5분 | critical |
| NodeDiskPressure | 노드 DiskPressure 상태 = true | 5분 | warning |

**pod.rules 그룹** (Pod 레벨):

| 규칙 이름 | 조건 | 대기 시간 | 심각도 |
|----------|------|----------|--------|
| PodCrashLooping | 15분간 재시작 > 5회 | 5분 | warning |
| PodOOMKilled | OOMKilled 사유로 종료됨 | 즉시 | warning |
| HighPodRestartRate | 1시간 내 재시작 > 10회 | 즉시 | warning |
| PodNotReady | Pod Ready 상태 = false | 10분 | warning |

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

### 알림 규칙 예시

```yaml
# manifests/alerting/prometheus-rules.yaml
groups:
  - name: cluster-alerts
    rules:
      - alert: HighCpuUsage
        expr: 100 - (avg by(instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100) > 80
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "CPU 사용률 80% 초과"
```

## Loki 로그 수집

### 설치

```
manifests/loki-values.yaml  ← Helm values
```

### 구성 요소

- **Promtail**: 각 노드에 DaemonSet으로 배포, 컨테이너 로그를 수집하여 Loki로 전송
- **Loki**: 로그를 라벨(namespace, pod, container)로 인덱싱하여 저장

### Grafana에서 로그 검색

Grafana의 Explore 탭에서 LogQL 쿼리를 사용합니다:

```
# demo 네임스페이스의 nginx 로그
{namespace="demo", app="nginx-web"}

# 에러가 포함된 로그만
{namespace="demo"} |= "error"

# 최근 1시간, 특정 Pod
{namespace="demo", pod="nginx-web-xxx"} | json | status >= 400
```

## 모니터링 수정 가이드

| 하고 싶은 것 | 수정할 파일 |
|-------------|-----------|
| 스크래핑 간격 변경 | `manifests/monitoring-values.yaml`의 scrapeInterval |
| 데이터 보존 기간 변경 | `manifests/monitoring-values.yaml`의 retention |
| 새 알림 규칙 추가 | `manifests/alerting/prometheus-rules.yaml`에 규칙 추가 |
| Grafana 대시보드 추가 | `manifests/monitoring-values.yaml`의 dashboardProviders |
| 알림을 Slack으로 보내기 | AlertManager 설정에 slack receiver 추가 |
| NodePort 변경 | 각 values.yaml의 service.nodePort |
