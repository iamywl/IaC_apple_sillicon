# Day 7: Transformations, 실습, 예제, 자가 점검

> 데이터 변환(Transformations) 기능과 실습 과제, 예제 시나리오, 자가 점검 문제를 통해 학습 내용을 정리한다.

## Transformations (데이터 변환)

Transformation은 데이터소스에서 가져온 쿼리 결과를 패널에 표시하기 전에 가공하는 파이프라인이다. 여러 Transformation을 체이닝하여 순차적으로 적용할 수 있다.

| Transformation | 설명 | 사용 예시 |
|---------------|------|----------|
| **Merge** | 여러 쿼리 결과를 하나의 테이블로 합친다 | 서로 다른 메트릭을 하나의 Table 패널에 표시 |
| **Join by field** | 공통 필드(시간, 라벨 등)를 기준으로 두 데이터 프레임을 조인한다 | CPU와 Memory 쿼리를 시간 기준으로 병합 |
| **Filter by name** | 특정 필드(컬럼)를 포함/제외한다 | 불필요한 라벨 컬럼 제거 |
| **Filter data by values** | 값 조건으로 행을 필터링한다 | CPU 사용률 80% 이상인 Pod만 표시 |
| **Organize fields** | 필드 이름 변경, 순서 변경, 숨김 처리를 한다 | 컬럼 헤더를 한국어로 변경 |
| **Reduce** | 시리즈를 단일 값(Last, Mean, Max 등)으로 집계한다 | 현재 값만 Table에 표시 |
| **Add field from calculation** | 기존 필드를 기반으로 새 필드를 계산한다 | Total = Requests + Errors 계산 |
| **Sort by** | 지정한 필드 기준으로 정렬한다 | CPU 사용률 내림차순 정렬 |
| **Group by** | 필드를 기준으로 그룹핑하고 집계한다 | 네임스페이스별 Pod 수 합산 |
| **Rename by regex** | 정규표현식으로 필드 이름을 변환한다 | `container_cpu_usage{pod="web-1"}` → `web-1` |
| **Convert field type** | 필드 데이터 타입을 변환한다 | 문자열 → 숫자 변환 |
| **Config from query results** | 쿼리 결과를 다른 쿼리의 설정으로 사용한다 | 쿼리 A의 결과를 쿼리 B의 threshold로 사용 |
| **Rows to fields** | 행 데이터를 컬럼으로 피벗한다 | Wide format으로 변환 |
| **Prepare time series** | 시계열 데이터를 multi-frame/wide 포맷으로 변환한다 | Long format → Wide format |
| **Concatenate fields** | 여러 프레임의 필드를 하나로 합친다 | 두 쿼리의 결과를 컬럼으로 나란히 배치 |
| **Series to rows** | 시리즈 데이터를 행 데이터로 변환한다 | 시계열 → 테이블 변환 |

### Transformation 체이닝 예시

여러 Transformation을 순서대로 적용하는 실전 예시:

```
Query A: sum by (pod) (rate(container_cpu_usage_seconds_total{namespace="$namespace"}[$__rate_interval]))
Query B: sum by (pod) (container_memory_working_set_bytes{namespace="$namespace"})
Query C: kube_pod_container_status_restarts_total{namespace="$namespace"}

Transformation Pipeline:
  1. Reduce (Query A → 각 pod의 Last 값)
  2. Reduce (Query B → 각 pod의 Last 값)
  3. Reduce (Query C → 각 pod의 Last 값)
  4. Merge (3개 결과를 하나의 테이블로)
  5. Organize fields
     - "Value #A" → "CPU Usage"
     - "Value #B" → "Memory Usage"
     - "Value #C" → "Restarts"
  6. Sort by "CPU Usage" (Descending)

Result:
| Pod           | CPU Usage | Memory Usage | Restarts |
|---------------|-----------|-------------|----------|
| api-server-1  | 0.85      | 512Mi       | 0        |
| worker-3      | 0.72      | 1.2Gi       | 2        |
| web-frontend  | 0.45      | 256Mi       | 0        |
```

---

## 실습

### 실습 1: Grafana 접속 및 기본 설정
```bash
# Grafana 포트포워딩
export KUBECONFIG=kubeconfig/platform.yaml
kubectl port-forward -n monitoring svc/kube-prometheus-stack-grafana 3000:80

# 브라우저에서 http://localhost:3000 접속
# 기본 계정: admin / admin (초기 비밀번호)

# Data Source 확인
# Configuration > Data Sources에서 Prometheus, Loki 연결 확인
```

### 실습 2: 대시보드 탐색
```bash
# 사전 설치된 대시보드 확인
# Dashboards > Browse

# 주요 대시보드 (manifests/monitoring-values.yaml에서 프로비저닝됨):
# 1. Node Exporter Full (gnetId: 1860) - 노드 리소스 현황
# 2. Kubernetes Cluster (gnetId: 7249) - 클러스터 전체 현황
# 3. Kubernetes Pods (gnetId: 6417) - Pod별 리소스 사용량
```

### 실습 3: 패널 직접 만들기
```
1. Dashboard > New Dashboard > Add visualization 클릭
2. Data source: Prometheus 선택
3. PromQL 입력:
   - CPU: 100 - (avg by(instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)
   - Memory: (1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes) * 100
4. Panel type: Time series, Gauge, Stat 등 선택
5. 제목, 단위, 임계값(Thresholds) 설정
6. Apply 클릭
```

### 실습 4: Variable을 활용한 동적 대시보드
```
1. Dashboard Settings > Variables > Add variable
2. 설정 예시:
   Name: namespace
   Type: Query
   Data source: Prometheus
   Query: label_values(kube_pod_info, namespace)
3. Panel 쿼리에서 $namespace 변수 사용:
   sum(container_memory_working_set_bytes{namespace="$namespace"}) by (pod)
```

### 실습 5: Loki 로그 탐색
```
1. Explore 메뉴 (좌측 나침반 아이콘) 클릭
2. Data source: Loki 선택
3. LogQL 입력:
   {namespace="monitoring"} |= "error"
4. 로그 라인 클릭 → 상세 라벨 확인
5. Show context 클릭 → 전후 로그 라인 확인
6. Split 버튼으로 Prometheus 메트릭과 나란히 비교
```

### 실습 6: Grafana API 활용
```bash
export KUBECONFIG=kubeconfig/platform.yaml
export GRAFANA_URL="http://$(kubectl get nodes -o jsonpath='{.items[0].status.addresses[0].address}'):30300"

# 헬스체크
curl -s $GRAFANA_URL/api/health | jq .

# 데이터소스 목록
curl -s -u admin:admin $GRAFANA_URL/api/datasources | jq '.[].name'

# 대시보드 검색
curl -s -u admin:admin $GRAFANA_URL/api/search | jq '.[].title'

# 대시보드 JSON 내보내기
DASHBOARD_UID=$(curl -s -u admin:admin $GRAFANA_URL/api/search | jq -r '.[0].uid')
curl -s -u admin:admin $GRAFANA_URL/api/dashboards/uid/$DASHBOARD_UID | jq .dashboard > dashboard-export.json

# Annotation 생성 (배포 마커)
curl -X POST -u admin:admin $GRAFANA_URL/api/annotations \
  -H "Content-Type: application/json" \
  -d '{
    "tags": ["deploy"],
    "text": "v1.0.0 배포 완료"
  }'
```

### 실습 7: Alert Rule 생성
```
1. Alerting > Alert rules > New alert rule
2. 설정:
   - Rule name: "High Node CPU"
   - Query A: 100 - (avg by(instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)
   - Expression B: Reduce (Last)
   - Expression C: Threshold (Is above 80)
   - Folder: alerts
   - Evaluation group: SRE-Alerts (interval: 1m)
   - Pending period: 5m
3. Labels: severity=warning, team=sre
4. Annotations: summary="CPU 사용률이 80%를 초과하였다"
5. Save rule
```

### 실습 8: Provisioning으로 대시보드 배포
```bash
# ConfigMap으로 커스텀 대시보드 배포
export KUBECONFIG=kubeconfig/platform.yaml

# 대시보드 JSON 파일을 ConfigMap으로 생성
kubectl create configmap grafana-custom-dashboards \
  -n monitoring \
  --from-file=dashboard.json \
  -o yaml --dry-run=client | kubectl apply -f -

# ConfigMap에 sidecar 라벨 추가
kubectl label configmap grafana-custom-dashboards \
  -n monitoring \
  grafana_dashboard=1

# Grafana Pod 재시작 (sidecar가 자동 감지하지 못할 경우)
kubectl rollout restart deployment/kube-prometheus-stack-grafana -n monitoring
```

---

## 예제

### 예제 1: Grafana Provisioning (Data Source)
```yaml
# datasource.yaml
# Helm values에서 Data Source를 자동 설정한다
apiVersion: 1
datasources:
  - name: Prometheus
    type: prometheus
    access: proxy
    url: http://prometheus-server:9090
    isDefault: true
    editable: false

  - name: Loki
    type: loki
    access: proxy
    url: http://loki:3100
    editable: false
```

### 예제 2: Grafana Dashboard JSON (간단한 예)
```json
{
  "dashboard": {
    "title": "Node Overview",
    "panels": [
      {
        "title": "CPU Usage",
        "type": "gauge",
        "targets": [
          {
            "expr": "100 - (avg(rate(node_cpu_seconds_total{mode=\"idle\"}[5m])) * 100)",
            "legendFormat": "CPU %"
          }
        ],
        "fieldConfig": {
          "defaults": {
            "thresholds": {
              "steps": [
                { "color": "green", "value": null },
                { "color": "yellow", "value": 60 },
                { "color": "red", "value": 80 }
              ]
            },
            "max": 100,
            "unit": "percent"
          }
        }
      }
    ]
  }
}
```

### 예제 3: 유용한 PromQL 패널 모음
```promql
# CPU 사용률 (Gauge)
100 - (avg by(instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)

# 메모리 사용량 (Time Series, bytes)
node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes

# 디스크 사용률 (Gauge, %)
(1 - node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"}) * 100

# Pod 개수 (Stat)
count(kube_pod_info{namespace=~"$namespace"})

# 네트워크 I/O (Time Series, bytes/sec)
rate(node_network_receive_bytes_total{device!="lo"}[5m])
rate(node_network_transmit_bytes_total{device!="lo"}[5m])

# Container Restart Count (Stat, 최근 1시간)
sum(increase(kube_pod_container_status_restarts_total{namespace="$namespace"}[1h])) by (pod)

# API Server Request Latency p99 (Time Series)
histogram_quantile(0.99, sum(rate(apiserver_request_duration_seconds_bucket{verb!="WATCH"}[$__rate_interval])) by (le, verb))

# kubelet 볼륨 에러
kube_persistentvolumeclaim_status_phase{phase="Lost"}

# Pending Pod 감지
kube_pod_status_phase{phase="Pending"} > 0

# OOMKilled 컨테이너 감지
kube_pod_container_status_last_terminated_reason{reason="OOMKilled"}

# HPA 상태 모니터링
kube_horizontalpodautoscaler_status_current_replicas / kube_horizontalpodautoscaler_spec_max_replicas

# PV 디스크 사용률
kubelet_volume_stats_used_bytes / kubelet_volume_stats_capacity_bytes * 100
```

### 예제 4: Grafana HTTP API 자동화 스크립트

```bash
#!/usr/bin/env bash
# scripts/grafana-backup.sh - 모든 대시보드를 JSON으로 백업

set -euo pipefail

GRAFANA_URL="${GRAFANA_URL:-http://localhost:30300}"
GRAFANA_USER="${GRAFANA_USER:-admin}"
GRAFANA_PASS="${GRAFANA_PASS:-admin}"
BACKUP_DIR="backups/grafana/$(date +%Y%m%d_%H%M%S)"

mkdir -p "$BACKUP_DIR"

# 모든 대시보드 UID 목록 가져오기
UIDS=$(curl -s -u "$GRAFANA_USER:$GRAFANA_PASS" \
  "$GRAFANA_URL/api/search?type=dash-db" | jq -r '.[].uid')

for uid in $UIDS; do
  title=$(curl -s -u "$GRAFANA_USER:$GRAFANA_PASS" \
    "$GRAFANA_URL/api/dashboards/uid/$uid" | jq -r '.dashboard.title')
  filename=$(echo "$title" | tr ' /' '_-')

  echo "Backing up: $title ($uid) → $BACKUP_DIR/${filename}.json"

  curl -s -u "$GRAFANA_USER:$GRAFANA_PASS" \
    "$GRAFANA_URL/api/dashboards/uid/$uid" | jq '.dashboard' \
    > "$BACKUP_DIR/${filename}.json"
done

echo "Backup complete: $(echo "$UIDS" | wc -w | tr -d ' ') dashboards saved to $BACKUP_DIR"
```

---

## 자가 점검

### 기본 개념
- [ ] Grafana의 아키텍처(Frontend, Backend, Database, Plugin System)를 설명할 수 있는가?
- [ ] Data Source Proxy 모드와 Direct 모드의 차이를 설명할 수 있는가?
- [ ] Dashboard JSON Model의 주요 필드(uid, panels, templating, fieldConfig)를 이해하는가?
- [ ] $__interval과 $__rate_interval의 차이를 설명할 수 있는가?

### Data Source
- [ ] Prometheus, Loki, Tempo 각 데이터소스의 Query Editor 특성을 이해하는가?
- [ ] Exemplar를 통한 Metrics → Traces 연동을 설명할 수 있는가?
- [ ] Derived Fields를 통한 Logs → Traces 연동을 설명할 수 있는가?
- [ ] Instant Query와 Range Query의 차이를 설명할 수 있는가?

### Dashboard 설계
- [ ] Variable 체이닝을 활용한 계층적 필터링을 구현할 수 있는가?
- [ ] Repeat Panel/Row를 사용하여 변수값별 패널을 자동 생성할 수 있는가?
- [ ] Transformation을 사용하여 쿼리 결과를 가공(Join, Filter, Reduce 등)할 수 있는가?
- [ ] Multi-value 변수의 포맷팅 문법(csv, pipe, regex 등)을 이해하는가?

### Panel
- [ ] 데이터 특성에 적합한 패널 유형을 선택할 수 있는가?
- [ ] fieldConfig의 defaults, overrides, custom 설정을 이해하는가?
- [ ] Table 패널의 Cell Display 모드(gauge, color text, sparkline 등)를 활용할 수 있는가?

### PromQL / LogQL
- [ ] PromQL을 사용하여 새로운 Panel을 만들 수 있는가?
- [ ] Recording Rule로 쿼리 성능을 최적화할 수 있는가?
- [ ] LogQL의 파이프라인 스테이지(line filter, parser, label filter)를 활용할 수 있는가?
- [ ] LogQL 메트릭 쿼리(count_over_time, rate, unwrap)를 사용할 수 있는가?

### Alerting
- [ ] Unified Alerting의 구성 요소(Alert Rule, Contact Point, Notification Policy, Silence, Mute Timing)를 설명할 수 있는가?
- [ ] Alert Rule의 3단계 구조(Data Query → Reduce → Threshold)를 이해하는가?
- [ ] Notification Policy의 라우팅 트리 구조를 설계할 수 있는가?
- [ ] Grafana Alerting과 Prometheus Alerting의 차이를 설명할 수 있는가?

### Provisioning / IaC
- [ ] Provisioning으로 데이터소스, 대시보드, 알림 규칙을 코드로 관리할 수 있는가?
- [ ] Kubernetes Sidecar를 통한 ConfigMap 기반 대시보드 프로비저닝을 이해하는가?
- [ ] Terraform Provider for Grafana를 사용할 수 있는가?
- [ ] Grafonnet(Jsonnet)으로 대시보드를 코드로 생성할 수 있는가?

### 인증/권한
- [ ] OAuth, LDAP, SAML 인증 방식의 차이를 이해하는가?
- [ ] Organization Role(Viewer, Editor, Admin)과 Folder/Dashboard Permission의 관계를 설명할 수 있는가?
- [ ] Teams를 활용한 권한 관리를 구성할 수 있는가?

### 운영
- [ ] SRE Golden Signals(Latency, Traffic, Errors, Saturation) 대시보드를 구성할 수 있는가?
- [ ] SLO/Error Budget 대시보드를 설계할 수 있는가?
- [ ] 느린 대시보드를 진단하고 최적화할 수 있는가?
- [ ] Grafana HA 구성의 필수 요소(공유 DB, 세션 저장소, Alerting HA)를 이해하는가?
- [ ] Grafana 로그를 분석하여 문제를 진단할 수 있는가?
- [ ] Annotation을 활용하여 배포 이벤트를 대시보드에 표시할 수 있는가?

---

## 참고문헌

### 공식 문서
- [Grafana Documentation](https://grafana.com/docs/grafana/latest/) - Grafana 공식 문서 전체
- [Grafana GitHub Repository](https://github.com/grafana/grafana) - 소스 코드 및 이슈 트래커
- [Grafana Dashboard JSON Model](https://grafana.com/docs/grafana/latest/dashboards/build-dashboards/view-dashboard-json-model/) - 대시보드 JSON 스키마 레퍼런스
- [Grafana Alerting](https://grafana.com/docs/grafana/latest/alerting/) - Unified Alerting 공식 가이드
- [Grafana Provisioning](https://grafana.com/docs/grafana/latest/administration/provisioning/) - Provisioning 설정 레퍼런스
- [Grafana Data Source Proxy](https://grafana.com/docs/grafana/latest/datasources/#data-source-proxy) - Proxy/Direct 모드 설명
- [Grafana Transformations](https://grafana.com/docs/grafana/latest/panels-visualizations/query-transform-data/transform-data/) - Transformation 레퍼런스
- [Grafana Variables](https://grafana.com/docs/grafana/latest/dashboards/variables/) - 템플릿 변수 가이드
- [Grafana HTTP API](https://grafana.com/docs/grafana/latest/developers/http_api/) - REST API 레퍼런스
- [Grafana Plugin Development](https://grafana.com/developers/plugin-tools/) - 플러그인 개발 가이드

### 데이터소스 연동
- [Grafana Loki Documentation](https://grafana.com/docs/loki/latest/) - Loki 공식 문서
- [LogQL Documentation](https://grafana.com/docs/loki/latest/query/) - LogQL 쿼리 언어 레퍼런스
- [Grafana Tempo Documentation](https://grafana.com/docs/tempo/latest/) - 분산 트레이싱 연동
- [TraceQL Documentation](https://grafana.com/docs/tempo/latest/traceql/) - TraceQL 쿼리 언어
- [Prometheus Data Source](https://grafana.com/docs/grafana/latest/datasources/prometheus/) - Prometheus 데이터소스 설정
- [Elasticsearch Data Source](https://grafana.com/docs/grafana/latest/datasources/elasticsearch/) - Elasticsearch 데이터소스

### Grafana as Code
- [Grafonnet](https://github.com/grafana/grafonnet) - Jsonnet 기반 대시보드 생성 라이브러리
- [Terraform Grafana Provider](https://registry.terraform.io/providers/grafana/grafana/latest/docs) - Terraform Provider 공식 문서
- [grafana-operator](https://github.com/grafana-operator/grafana-operator) - Kubernetes Operator for Grafana

### SRE / 모니터링 방법론
- [Google SRE Book - Monitoring Distributed Systems](https://sre.google/sre-book/monitoring-distributed-systems/) - Golden Signals 원론
- [Google SRE Workbook - Alerting on SLOs](https://sre.google/workbook/alerting-on-slos/) - SLO 기반 알림 설계
- [Grafana SRE Dashboard Examples](https://grafana.com/grafana/dashboards/) - 커뮤니티 대시보드 갤러리
- [USE Method](https://www.brendangregg.com/usemethod.html) - Brendan Gregg의 Utilization, Saturation, Errors 방법론
- [RED Method](https://grafana.com/blog/2018/08/02/the-red-method-how-to-instrument-your-services/) - Rate, Errors, Duration 방법론

### Kubernetes 연동
- [kube-prometheus-stack Helm Chart](https://github.com/prometheus-community/helm-charts/tree/main/charts/kube-prometheus-stack) - Grafana + Prometheus 통합 배포
- [Grafana Kubernetes Monitoring](https://grafana.com/docs/grafana-cloud/monitor-infrastructure/kubernetes-monitoring/) - Kubernetes 모니터링 가이드
- [Grafana Loki Stack Helm Chart](https://github.com/grafana/helm-charts/tree/main/charts/loki-stack) - Loki + Promtail 통합 배포

### 성능 및 운영
- [Grafana Performance Best Practices](https://grafana.com/docs/grafana/latest/best-practices/) - 대시보드 설계 모범 사례
- [Grafana High Availability](https://grafana.com/docs/grafana/latest/setup-grafana/set-up-for-high-availability/) - HA 구성 가이드
- [Grafana Image Rendering](https://grafana.com/docs/grafana/latest/setup-grafana/image-rendering/) - 이미지 렌더링 설정
