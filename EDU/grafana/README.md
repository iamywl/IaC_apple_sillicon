# Grafana - 메트릭 시각화 대시보드

## 개념

### Grafana란?
- 오픈소스 메트릭 시각화 및 대시보드 플랫폼이다
- Prometheus, Loki, Tempo, Mimir 등 다양한 데이터소스를 연결할 수 있다
- JSON 기반의 대시보드를 정의하고 코드(IaC)로 관리할 수 있다
- Unified Alerting(Grafana 9+)을 통해 통합 알림 시스템을 제공한다
- 플러그인 생태계를 통해 패널, 데이터소스, 앱을 확장할 수 있다

### 핵심 개념
| 개념 | 설명 |
|------|------|
| Data Source | Grafana가 데이터를 가져오는 백엔드 시스템이다 (Prometheus, Loki 등) |
| Dashboard | 여러 Panel로 구성된 시각화 페이지이다. 내부적으로 JSON Model로 직렬화된다 |
| Panel | 하나의 시각화 위젯 (Time series, Gauge, Table 등)이다 |
| Variable | 대시보드에서 동적으로 필터링할 수 있는 템플릿 변수이다 |
| Annotation | 대시보드에 이벤트(배포, 장애 등)를 표시하는 마커이다 |
| Provisioning | 코드로 대시보드, 데이터소스, 알림 규칙을 자동 설정하는 방식이다 |
| Transformation | 쿼리 결과를 패널에 표시하기 전에 가공(join, filter 등)하는 기능이다 |
| Alert Rule | 조건을 정의하여 임계값 초과 시 알림을 발생시키는 규칙이다 |

---

### 이 프로젝트에서의 실습 환경

이 프로젝트에서 Grafana는 platform 클러스터의 `monitoring` 네임스페이스에 배포된다.

- 설치 스크립트: `scripts/install/07-install-monitoring.sh`
- Helm Chart: `kube-prometheus-stack`에 포함
- NodePort: 30300
- 기본 계정: admin / admin
- 실습 대상 클러스터: platform (`kubeconfig/platform.yaml`)

```bash
# platform 클러스터에서 Grafana 접근
export KUBECONFIG=kubeconfig/platform.yaml
# NodePort로 직접 접근 (platform 워커 노드 IP:30300)
# 또는 포트포워딩:
kubectl port-forward -n monitoring svc/kube-prometheus-stack-grafana 3000:80
# 브라우저에서 http://localhost:3000 접속 (admin/admin)
```

---

## 아키텍처 상세

### Grafana 내부 구조

Grafana는 크게 Frontend, Backend, Database, Plugin System 네 가지 계층으로 구성된다.

```
┌─────────────────────────────────────────────────────────────┐
│                     Grafana Server                          │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              Frontend (React + TypeScript)            │  │
│  │  ┌──────────┐ ┌──────────┐ ┌───────────┐ ┌────────┐  │  │
│  │  │Dashboard │ │ Explore  │ │  Alerting │ │ Admin  │  │  │
│  │  │  Editor  │ │   View   │ │    UI     │ │   UI   │  │  │
│  │  └──────────┘ └──────────┘ └───────────┘ └────────┘  │  │
│  └──────────────────────┬────────────────────────────────┘  │
│                         │ HTTP API                          │
│  ┌──────────────────────▼────────────────────────────────┐  │
│  │              Backend (Go)                             │  │
│  │  ┌────────────┐ ┌──────────────┐ ┌─────────────────┐ │  │
│  │  │ Dashboard  │ │   Alerting   │ │  Provisioning   │ │  │
│  │  │  Service   │ │   Service    │ │    Service      │ │  │
│  │  └─────┬──────┘ └──────┬───────┘ └────────┬────────┘ │  │
│  │        │               │                   │          │  │
│  │  ┌─────▼───────────────▼───────────────────▼────────┐ │  │
│  │  │            Data Source Proxy Layer               │ │  │
│  │  └─────┬──────────────────┬──────────────────┬──────┘ │  │
│  └────────┼──────────────────┼──────────────────┼────────┘  │
│           │                  │                  │           │
│  ┌────────▼────────┐        │                  │           │
│  │  Plugin System  │        │                  │           │
│  │ (backend/front) │        │                  │           │
│  └─────────────────┘        │                  │           │
│                             │                  │           │
│  ┌──────────────────────────▼──────────────────▼────────┐  │
│  │          Database (SQLite / PostgreSQL / MySQL)       │  │
│  │  - Dashboard JSON 저장   - User/Org 관리             │  │
│  │  - Alert Rule 저장       - API Key/Token 관리        │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
         │                  │                  │
    ┌────▼────┐        ┌────▼────┐        ┌────▼────┐
    │Prometheus│        │  Loki   │        │  Tempo  │
    │(Metrics) │        │ (Logs)  │        │(Traces) │
    └─────────┘        └─────────┘        └─────────┘
```

**Frontend** 계층은 React와 TypeScript로 구현되어 있다. 대시보드 편집, Explore 뷰, 알림 관리 UI 등을 담당한다. Grafana UI Kit(`@grafana/ui`)을 사용하여 일관된 디자인 시스템을 유지한다.

**Backend** 계층은 Go로 작성되어 있다. HTTP API 서버, 대시보드 CRUD, 알림 평가, 프로비저닝 등 핵심 비즈니스 로직을 처리한다. 내부적으로 Wire(의존성 주입 프레임워크)를 사용하여 서비스를 조립한다.

**Database** 계층은 기본적으로 SQLite를 내장하며, 프로덕션 환경에서는 PostgreSQL 또는 MySQL을 권장한다. 대시보드 JSON, 사용자/조직 정보, 알림 규칙, API 키 등 모든 상태를 저장한다.

**Plugin System**은 Grafana의 확장 메커니즘이다. 세 가지 유형이 존재한다:
| 플러그인 유형 | 설명 | 예시 |
|-------------|------|------|
| Data Source Plugin | 외부 데이터 저장소와 통신하는 플러그인이다 | Prometheus, Loki, Elasticsearch |
| Panel Plugin | 새로운 시각화 유형을 추가하는 플러그인이다 | Flamegraph, Flow Chart |
| App Plugin | Data Source와 Panel을 묶어 완전한 앱 경험을 제공한다 | Kubernetes App, Oncall |

### Data Source Proxy 모드

Grafana가 데이터소스에 접근하는 방식은 두 가지이다.

**Proxy 모드 (권장)**:
```
Browser ──HTTP──▶ Grafana Backend ──HTTP──▶ Data Source (Prometheus 등)
                  (인증 정보 보관)
```
- 브라우저는 Grafana 서버에만 요청을 보낸다
- Grafana 백엔드가 데이터소스의 인증 정보(API Key, Basic Auth 등)를 보관한다
- 데이터소스의 네트워크 주소가 브라우저에 노출되지 않아 보안상 안전하다
- `access: proxy` 설정으로 활성화한다

**Direct(Browser) 모드**:
```
Browser ──HTTP──▶ Data Source (Prometheus 등)
(인증 정보 브라우저에 노출)
```
- 브라우저가 데이터소스에 직접 요청한다
- 데이터소스가 브라우저에서 접근 가능한 네트워크에 있어야 한다
- 인증 정보가 브라우저에 노출될 수 있어 프로덕션에서는 권장하지 않는다
- `access: direct` 설정으로 활성화한다

---

## Dashboard 내부 구조

### JSON Model

Grafana 대시보드는 내부적으로 하나의 JSON 문서로 표현된다. 이 JSON Model의 주요 구조는 다음과 같다:

```json
{
  "id": null,
  "uid": "abc123",
  "title": "My Dashboard",
  "tags": ["kubernetes", "production"],
  "timezone": "browser",
  "schemaVersion": 39,
  "version": 1,
  "refresh": "30s",
  "time": {
    "from": "now-6h",
    "to": "now"
  },
  "templating": {
    "list": [
      {
        "name": "namespace",
        "type": "query",
        "datasource": "Prometheus",
        "query": "label_values(kube_pod_info, namespace)",
        "refresh": 2,
        "multi": true,
        "includeAll": true
      }
    ]
  },
  "panels": [
    {
      "id": 1,
      "title": "CPU Usage",
      "type": "timeseries",
      "gridPos": { "h": 8, "w": 12, "x": 0, "y": 0 },
      "datasource": { "type": "prometheus", "uid": "prometheus-uid" },
      "targets": [
        {
          "expr": "rate(container_cpu_usage_seconds_total{namespace=\"$namespace\"}[5m])",
          "legendFormat": "{{pod}}"
        }
      ],
      "fieldConfig": {
        "defaults": {
          "unit": "percentunit",
          "thresholds": {
            "mode": "absolute",
            "steps": [
              { "color": "green", "value": null },
              { "color": "yellow", "value": 0.6 },
              { "color": "red", "value": 0.8 }
            ]
          }
        },
        "overrides": []
      },
      "options": {},
      "transformations": []
    }
  ],
  "annotations": {
    "list": [
      {
        "name": "Deployments",
        "datasource": "-- Grafana --",
        "enable": true,
        "iconColor": "blue"
      }
    ]
  }
}
```

주요 필드의 의미는 다음과 같다:
| 필드 | 설명 |
|------|------|
| `uid` | 대시보드의 고유 식별자이다. Provisioning 시 동일 UID로 업데이트를 보장한다 |
| `schemaVersion` | JSON 스키마 버전이다. Grafana가 마이그레이션 시 참조한다 |
| `templating.list` | 템플릿 변수 목록이다. 대시보드 상단 드롭다운으로 렌더링된다 |
| `panels[].gridPos` | 패널의 위치와 크기이다. `h`(높이), `w`(너비), `x`, `y` 좌표를 사용한다 |
| `panels[].targets` | 데이터소스 쿼리 목록이다. PromQL, LogQL 등을 포함한다 |
| `panels[].fieldConfig` | 단위, 임계값, 색상 등 필드별 설정이다 |
| `panels[].transformations` | 쿼리 결과를 후처리하는 변환 파이프라인이다 |

### 템플릿 변수 (Template Variables)

Grafana는 여러 종류의 내장 변수와 사용자 정의 변수를 지원한다.

**내장 전역 변수**:
| 변수 | 설명 |
|------|------|
| `$__interval` | 현재 시간 범위와 패널 너비(px)를 기반으로 자동 계산된 interval이다. `rate(metric[$__interval])` 형태로 사용한다 |
| `$__rate_interval` | `$__interval`의 최소 4배를 보장하는 interval이다. `rate()` 함수에서 scrape interval보다 짧은 range를 방지한다. Prometheus 데이터소스 전용이다 |
| `$__range` | 대시보드에서 선택한 시간 범위 전체이다 (예: `6h`) |
| `$__from`, `$__to` | 대시보드 시간 범위의 시작/끝 epoch 밀리초이다 |
| `$__name` | 시리즈 이름이다. Legend format에서 사용한다 |
| `$__org` | 현재 조직의 ID이다 |

**사용자 정의 변수 유형**:
| 유형 | 설명 |
|------|------|
| Query | 데이터소스에 쿼리하여 값 목록을 동적으로 생성한다 |
| Custom | 쉼표로 구분된 고정 값 목록을 정의한다 (예: `production,staging,dev`) |
| Constant | 대시보드 내에서 사용하는 상수 값이다. Provisioning에서 환경별 값 주입에 유용하다 |
| Interval | 사용자가 선택할 수 있는 시간 간격 목록이다 (예: `1m,5m,15m,1h`) |
| Text box | 사용자가 자유 텍스트를 입력할 수 있는 변수이다 |
| Data source | 지정한 유형의 데이터소스 목록을 자동으로 보여준다 |
| Ad hoc filters | 패널 쿼리에 자동으로 label filter를 추가하는 동적 변수이다 |

**Repeat Panels / Rows**: 변수의 각 값에 대해 패널 또는 Row를 자동 복제하는 기능이다. 예를 들어 `$namespace` 변수에 Multi-value를 활성화하고 패널의 Repeat 옵션에 `namespace`를 지정하면, 선택된 네임스페이스마다 동일한 패널이 자동 생성된다.

---

## Panel 유형 상세

Grafana는 다양한 내장 Panel 유형을 제공한다. 각 유형은 특정 데이터 형태와 사용 사례에 최적화되어 있다.

| Panel 유형 | 용도 | 적합한 데이터 |
|-----------|------|-------------|
| **Time series** | 시간에 따른 메트릭 추이를 선/면/막대 차트로 표시한다 | range vector, 다중 시리즈 |
| **Stat** | 단일 숫자 값을 크게 표시한다. 배경색으로 상태를 나타낸다 | instant vector, 단일 값 |
| **Gauge** | 최솟값~최댓값 범위 내 현재 값을 게이지로 표시한다 | 백분율, 사용률 등 범위가 정해진 값 |
| **Bar gauge** | 수평/수직 막대로 값을 비교한다 | 여러 인스턴스의 동일 메트릭 비교 |
| **Table** | 데이터를 테이블 형식으로 표시한다. 정렬, 필터링, 셀 색상 지정이 가능하다 | 다중 필드, 목록형 데이터 |
| **Heatmap** | 시간 × 버킷 매트릭스를 색상 강도로 표현한다 | histogram 데이터, 레이턴시 분포 |
| **Logs** | 로그 라인을 시간순으로 표시한다. Loki/Elasticsearch와 연동한다 | 로그 스트림 |
| **Node Graph** | 노드와 엣지로 구성된 그래프를 표시한다 | 서비스 토폴로지, 의존성 맵 |
| **Geomap** | 지도 위에 데이터 포인트를 표시한다 | 위도/경도가 포함된 메트릭 |
| **Candlestick** | 시가/종가/고가/저가를 캔들스틱 차트로 표시한다 | 금융 데이터, 변동성 분석 |
| **Histogram** | 값의 분포를 히스토그램으로 표시한다 | 레이턴시 분포, 크기 분포 |

---

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

---

## Alerting (Grafana 9+ Unified Alerting)

Grafana 9부터 도입된 Unified Alerting은 이전의 Legacy Alerting을 대체하는 통합 알림 시스템이다. Prometheus Alertmanager와 호환되는 아키텍처를 가진다.

### 알림 시스템 구성 요소

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

### Alert Rule 예시

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
```

---

## Provisioning 심화

Provisioning은 Grafana의 데이터소스, 대시보드, 알림 규칙, Contact Point 등을 코드(YAML/JSON 파일)로 선언적으로 관리하는 기능이다. Kubernetes 환경에서는 ConfigMap이나 Helm values로 관리하는 것이 일반적이다.

### Provisioning 디렉토리 구조

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

### Data Source Provisioning

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

### Dashboard Provisioning

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
grafana:
  dashboardProviders:
    dashboardproviders.yaml:
      apiVersion: 1
      providers:
        - name: custom
          folder: Custom
          type: file
          disableDeletion: true
          options:
            path: /var/lib/grafana/dashboards/custom

  dashboardsConfigMaps:
    custom: "grafana-custom-dashboards"   # ConfigMap 이름 참조
```

### Contact Point & Notification Policy Provisioning

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

---

## Annotations (주석)

Annotation은 대시보드의 시간축 위에 수직선이나 영역으로 이벤트를 표시하는 기능이다. 배포, 장애, 설정 변경 등을 시각화하여 메트릭 변화의 원인을 파악하는 데 도움을 준다.

### Manual Annotation
Grafana UI에서 직접 시간 범위를 선택하고 설명을 입력하여 생성한다. 또는 Grafana HTTP API를 통해 프로그래밍 방식으로 생성할 수 있다:

```bash
# 배포 시 CI/CD 파이프라인에서 Annotation 생성
curl -X POST http://grafana:3000/api/annotations \
  -H "Authorization: Bearer $GRAFANA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "dashboardUID": "abc123",
    "time": 1672531200000,
    "tags": ["deploy", "production"],
    "text": "v2.3.1 배포 완료 - commit: a1b2c3d"
  }'
```

### Query-based Annotation
데이터소스 쿼리를 실행하여 자동으로 Annotation을 생성한다. 예를 들어 Prometheus의 `ALERTS` 메트릭이나 Loki의 특정 로그 패턴을 Annotation으로 표시할 수 있다:

```
# Prometheus Annotation 쿼리 예시
ALERTS{alertname="DeploymentReplicasMismatch", severity="warning"}

# Loki Annotation 쿼리 예시
{job="argocd-server"} |= "sync completed"
```

이를 통해 ArgoCD 배포 이벤트를 자동으로 대시보드에 표시할 수 있다.

---

## Grafana Loki 연동 (로그 상관분석)

Grafana는 Loki와의 통합을 통해 메트릭과 로그의 상관분석(Correlation)을 지원한다. 이 연동은 SRE의 장애 분석 워크플로우에서 핵심적인 역할을 한다.

### 메트릭 → 로그 연동

Time series 패널에서 특정 시점의 메트릭 스파이크를 발견했을 때, 해당 시간대의 로그를 즉시 확인할 수 있다:

1. **Split View**: Explore에서 메트릭 쿼리와 로그 쿼리를 나란히 표시한다. 시간 범위가 자동 동기화된다
2. **Panel 링크**: Time series 패널에서 Data link를 설정하여 클릭 시 Loki Explore로 이동한다

```
# Data link URL 예시 (Panel 설정 > Data links)
/explore?orgId=1&left={"datasource":"Loki","queries":[{"expr":"{namespace=\"${__field.labels.namespace}\",pod=\"${__field.labels.pod}\"}"}],"range":{"from":"${__value.time}","to":"${__value.time}"}}
```

### LogQL 기본 쿼리

```logql
# 특정 네임스페이스의 에러 로그 조회
{namespace="production"} |= "error" | logfmt | level="error"

# 로그에서 메트릭 추출 (Log-based Metrics)
count_over_time({namespace="production"} |= "error" [5m])

# JSON 로그 파싱 후 필터
{app="api-server"} | json | status >= 500

# 로그 볼륨 히스토그램 (Logs 패널 상단에 자동 표시)
sum by (level) (count_over_time({namespace="production"}[$__interval]))
```

### Derived Fields (로그 → 트레이스 연동)

Loki 데이터소스 설정에서 Derived Fields를 구성하면, 로그 메시지에서 traceID를 자동 추출하여 Tempo로의 링크를 생성한다:

```yaml
# Loki 데이터소스 jsonData 설정
jsonData:
  derivedFields:
    - datasourceUid: tempo-uid
      matcherRegex: '"traceId":"(\\w+)"'
      name: TraceID
      url: "$${__value.raw}"
```

이를 통해 **Metrics → Logs → Traces**의 3축 관측성(Observability)을 하나의 Grafana 인스턴스에서 달성할 수 있다.

---

## 실습

### 실습 1: Grafana 접속 및 기본 설정
```bash
# Grafana 포트포워딩
kubectl port-forward -n monitoring svc/grafana 3000:80

# 브라우저에서 http://localhost:3000 접속
# 기본 계정: admin / admin (초기 비밀번호)

# Data Source 확인
# Configuration > Data Sources에서 Prometheus, Loki 연결 확인
```

### 실습 2: 대시보드 탐색
```bash
# 사전 설치된 대시보드 확인
# Dashboards > Browse

# 주요 대시보드:
# 1. Node Exporter Full - 노드 리소스 현황
# 2. Kubernetes Cluster - 클러스터 전체 현황
# 3. Pod Resources - Pod별 리소스 사용량
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
   {namespace="default"} |= "error"
4. 로그 라인 클릭 → 상세 라벨 확인
5. Show context 클릭 → 전후 로그 라인 확인
6. Split 버튼으로 Prometheus 메트릭과 나란히 비교
```

---

## 예제

### 예제 1: SRE Golden Signals 대시보드

Google SRE 방법론에서 정의한 4가지 Golden Signal을 하나의 대시보드로 구성하는 예제이다. 이 대시보드는 서비스의 전체 건강 상태를 한눈에 파악할 수 있게 한다.

```
┌──────────────────────────────────────────────────────────┐
│  Golden Signals Dashboard          [$namespace] [$service]│
├──────────────────────────┬───────────────────────────────┤
│  Latency (p50/p90/p99)   │  Traffic (RPS)               │
│  ┌────────────────────┐  │  ┌─────────────────────────┐ │
│  │    ╱╲    p99       │  │  │         ___             │ │
│  │   ╱  ╲   ────      │  │  │  ──────╱   ╲────       │ │
│  │  ╱    ╲  p90       │  │  │                         │ │
│  │ ╱──────╲──── p50   │  │  │                         │ │
│  └────────────────────┘  │  └─────────────────────────┘ │
├──────────────────────────┼───────────────────────────────┤
│  Errors (Rate %)         │  Saturation (CPU/Mem %)      │
│  ┌────────────────────┐  │  ┌─────────────────────────┐ │
│  │  ╱╲                │  │  │  CPU ████████░░ 78%     │ │
│  │ ╱  ╲___            │  │  │  Mem ██████░░░░ 62%     │ │
│  │╱       ╲           │  │  │  Disk █████████░ 91%    │ │
│  └────────────────────┘  │  └─────────────────────────┘ │
└──────────────────────────┴───────────────────────────────┘
```

#### 1. Latency (지연 시간) - Time Series Panel
```promql
# p50 레이턴시
histogram_quantile(0.50,
  sum(rate(http_request_duration_seconds_bucket{
    namespace="$namespace",
    service="$service"
  }[$__rate_interval])) by (le)
)

# p90 레이턴시
histogram_quantile(0.90,
  sum(rate(http_request_duration_seconds_bucket{
    namespace="$namespace",
    service="$service"
  }[$__rate_interval])) by (le)
)

# p99 레이턴시
histogram_quantile(0.99,
  sum(rate(http_request_duration_seconds_bucket{
    namespace="$namespace",
    service="$service"
  }[$__rate_interval])) by (le)
)
```
- Panel type: **Time series**
- Unit: `seconds (s)`
- Legend: `{{quantile}}`
- $__rate_interval을 사용하여 scrape interval보다 짧은 range vector를 방지한다

#### 2. Traffic (트래픽) - Time Series Panel
```promql
# 초당 요청 수 (RPS)
sum(rate(http_requests_total{
  namespace="$namespace",
  service="$service"
}[$__rate_interval])) by (method, code)
```
- Panel type: **Time series** (Stacked 모드)
- Unit: `requests/sec (reqps)`
- Legend: `{{method}} {{code}}`
- HTTP 상태 코드별로 색상을 구분하면 에러 비율을 시각적으로 파악할 수 있다

#### 3. Errors (에러율) - Stat + Time Series Panel
```promql
# 에러율 (%) - Stat Panel 용
sum(rate(http_requests_total{
  namespace="$namespace",
  service="$service",
  code=~"5.."
}[$__rate_interval]))
/
sum(rate(http_requests_total{
  namespace="$namespace",
  service="$service"
}[$__rate_interval])) * 100
```
- Panel type: **Stat** (현재 에러율 수치) + **Time series** (에러율 추이)
- Unit: `percent (0-100)`
- Thresholds: green(0) → yellow(1) → red(5)
- No data → 0%로 표시 (에러가 없는 정상 상태)

#### 4. Saturation (포화도) - Bar Gauge Panel
```promql
# CPU 사용률
sum(rate(container_cpu_usage_seconds_total{
  namespace="$namespace",
  pod=~"$service.*"
}[$__rate_interval]))
/
sum(kube_pod_container_resource_limits{
  namespace="$namespace",
  pod=~"$service.*",
  resource="cpu"
}) * 100

# 메모리 사용률
sum(container_memory_working_set_bytes{
  namespace="$namespace",
  pod=~"$service.*"
})
/
sum(kube_pod_container_resource_limits{
  namespace="$namespace",
  pod=~"$service.*",
  resource="memory"
}) * 100
```
- Panel type: **Bar gauge** (수평, LCD 모드)
- Unit: `percent (0-100)`
- Max: 100
- Thresholds: green(0) → yellow(70) → red(90)

### 예제 2: Grafana Provisioning (Data Source)
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

### 예제 3: Grafana Dashboard JSON (간단한 예)
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

### 예제 4: 유용한 PromQL 패널 모음
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
```

---

## 자가 점검
- [ ] Grafana의 아키텍처(Frontend, Backend, Database, Plugin System)를 설명할 수 있는가?
- [ ] Data Source Proxy 모드와 Direct 모드의 차이를 설명할 수 있는가?
- [ ] Dashboard JSON Model의 주요 필드(uid, panels, templating, fieldConfig)를 이해하는가?
- [ ] $__interval과 $__rate_interval의 차이를 설명할 수 있는가?
- [ ] Unified Alerting의 구성 요소(Alert Rule, Contact Point, Notification Policy, Silence, Mute Timing)를 설명할 수 있는가?
- [ ] Provisioning으로 데이터소스, 대시보드, 알림 규칙을 코드로 관리할 수 있는가?
- [ ] Transformation을 사용하여 쿼리 결과를 가공(Join, Filter, Reduce 등)할 수 있는가?
- [ ] PromQL을 사용하여 새로운 Panel을 만들 수 있는가?
- [ ] Variable을 활용한 동적 대시보드를 구성할 수 있는가?
- [ ] Repeat Panel/Row를 사용하여 변수값별 패널을 자동 생성할 수 있는가?
- [ ] SRE Golden Signals(Latency, Traffic, Errors, Saturation) 대시보드를 구성할 수 있는가?
- [ ] Loki와 연동하여 메트릭 → 로그 상관분석을 수행할 수 있는가?
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

### 데이터소스 연동
- [Grafana Loki Documentation](https://grafana.com/docs/loki/latest/) - Loki 공식 문서
- [LogQL Documentation](https://grafana.com/docs/loki/latest/query/) - LogQL 쿼리 언어 레퍼런스
- [Grafana Tempo Documentation](https://grafana.com/docs/tempo/latest/) - 분산 트레이싱 연동
- [Prometheus Data Source](https://grafana.com/docs/grafana/latest/datasources/prometheus/) - Prometheus 데이터소스 설정

### SRE / 모니터링 방법론
- [Google SRE Book - Monitoring Distributed Systems](https://sre.google/sre-book/monitoring-distributed-systems/) - Golden Signals 원론
- [Grafana SRE Dashboard Examples](https://grafana.com/grafana/dashboards/) - 커뮤니티 대시보드 갤러리
- [USE Method](https://www.brendangregg.com/usemethod.html) - Brendan Gregg의 Utilization, Saturation, Errors 방법론
- [RED Method](https://grafana.com/blog/2018/08/02/the-red-method-how-to-instrument-your-services/) - Rate, Errors, Duration 방법론

### Kubernetes 연동
- [kube-prometheus-stack Helm Chart](https://github.com/prometheus-community/helm-charts/tree/main/charts/kube-prometheus-stack) - Grafana + Prometheus 통합 배포
- [Grafana Kubernetes Monitoring](https://grafana.com/docs/grafana-cloud/monitor-infrastructure/kubernetes-monitoring/) - Kubernetes 모니터링 가이드
