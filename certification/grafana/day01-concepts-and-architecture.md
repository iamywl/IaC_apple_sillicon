# Day 1: 개념 및 아키텍처 심화

> Grafana의 기본 개념, 핵심 용어, 실습 환경 설정, 그리고 Frontend/Backend/Database/Plugin/Provisioning 등 내부 아키텍처를 심화 학습한다.

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
- Helm Values: `manifests/monitoring-values.yaml`
- Loki Values: `manifests/loki-values.yaml`
- NodePort: 30300
- 기본 계정: admin / admin
- 실습 대상 클러스터: platform (`kubeconfig/platform.yaml`)
- Prometheus 데이터 보존 기간: 7d (PVC 10Gi)
- Alertmanager NodePort: 30903
- 사전 설치 대시보드: Kubernetes Cluster(gnetId: 7249), Node Exporter Full(gnetId: 1860), Kubernetes Pods(gnetId: 6417)
- Loki: loki-stack Helm Chart로 별도 설치, Promtail이 로그 수집 에이전트로 동작한다

```bash
# platform 클러스터에서 Grafana 접근
export KUBECONFIG=kubeconfig/platform.yaml
# NodePort로 직접 접근 (platform 워커 노드 IP:30300)
# 또는 포트포워딩:
kubectl port-forward -n monitoring svc/kube-prometheus-stack-grafana 3000:80
# 브라우저에서 http://localhost:3000 접속 (admin/admin)
```

이 프로젝트의 모니터링 스택 설치 흐름은 다음과 같다:

```
scripts/install/07-install-monitoring.sh
├── helm install kube-prometheus-stack    ← Prometheus + Grafana + Alertmanager
│   └── --values manifests/monitoring-values.yaml
│       ├── grafana.service.nodePort: 30300
│       ├── grafana.dashboards (gnetId 기반 자동 프로비저닝)
│       ├── prometheus.retention: 7d, storage: 10Gi
│       └── alertmanager.nodePort: 30903, webhook receiver
└── helm install loki (loki-stack)        ← Loki + Promtail
    └── --values manifests/loki-values.yaml
        ├── loki (persistence disabled, 512Mi limit)
        └── promtail (256Mi limit)
```

---

## 1장: Grafana 아키텍처 심화

### 1.1 전체 아키텍처 개요

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

### 1.2 Frontend 아키텍처

**Frontend** 계층은 React와 TypeScript로 구현되어 있다. 대시보드 편집, Explore 뷰, 알림 관리 UI 등을 담당한다. Grafana UI Kit(`@grafana/ui`)을 사용하여 일관된 디자인 시스템을 유지한다.

#### Frontend 구성 모듈

| 모듈 | 역할 | 주요 기술 |
|------|------|----------|
| `@grafana/ui` | 공통 UI 컴포넌트 라이브러리이다 | React, Emotion CSS-in-JS |
| `@grafana/data` | 데이터 프레임, 필드 타입 등 데이터 모델을 정의한다 | TypeScript |
| `@grafana/runtime` | 런타임 서비스(config, backendSrv, locationSrv)를 제공한다 | TypeScript |
| `@grafana/e2e` | E2E 테스트 유틸리티이다 | Cypress |
| `@grafana/schema` | Cue 기반 스키마 정의로 Dashboard JSON의 타입 안전성을 보장한다 | CUE, TypeScript |

#### Frontend 렌더링 파이프라인

Grafana Frontend가 패널을 렌더링하는 과정은 다음과 같다:

```
1. 사용자가 Dashboard 페이지 진입
2. Dashboard JSON Model 로드 (API: GET /api/dashboards/uid/:uid)
3. 각 Panel에 대해:
   a. Variable Interpolation: $namespace → "production" 치환
   b. Query Runner 실행: DataSourceSrv를 통해 백엔드에 쿼리 전송
   c. DataFrame 수신: 백엔드에서 표준화된 DataFrame 형식으로 응답
   d. Transformation 적용: 정의된 Transformation Pipeline 순차 실행
   e. Field Config 적용: 단위(unit), 임계값(thresholds), overrides 적용
   f. Panel Renderer: Panel 타입(Time series, Stat 등)에 맞는 React 컴포넌트 렌더링
   g. Canvas/SVG/HTML 출력
```

#### State Management

Grafana Frontend는 Redux 기반의 상태 관리를 사용한다. 주요 상태 슬라이스는 다음과 같다:

| 상태 슬라이스 | 설명 |
|-------------|------|
| `dashboard` | 현재 대시보드의 JSON Model, 편집 상태, 저장 상태를 관리한다 |
| `explore` | Explore 뷰의 쿼리, 시간 범위, 분할 뷰 상태를 관리한다 |
| `templating` | 템플릿 변수의 현재 값과 옵션 목록을 관리한다 |
| `panelEditor` | 패널 편집기의 상태(선택된 패널, 쿼리 결과 등)를 관리한다 |
| `alerting` | 알림 규칙, 알림 상태, Notification Policy를 관리한다 |

### 1.3 Backend 아키텍처

**Backend** 계층은 Go로 작성되어 있다. HTTP API 서버, 대시보드 CRUD, 알림 평가, 프로비저닝 등 핵심 비즈니스 로직을 처리한다. 내부적으로 Wire(의존성 주입 프레임워크)를 사용하여 서비스를 조립한다.

#### Backend 서비스 구조

```
grafana-server (main)
├── API Server (net/http)
│   ├── /api/dashboards/*        Dashboard CRUD
│   ├── /api/datasources/*       Data Source 관리
│   ├── /api/alerts/*            Alert Rule 관리
│   ├── /api/annotations/*       Annotation CRUD
│   ├── /api/org/*               Organization 관리
│   ├── /api/user/*              User 관리
│   ├── /api/search              Dashboard/Folder 검색
│   └── /api/ds/query            Unified Data Source Query
├── Dashboard Service
│   ├── Dashboard Store (DB CRUD)
│   ├── Dashboard Provisioner (YAML → DB 동기화)
│   └── Dashboard Import Service (gnetId → 대시보드 임포트)
├── Alerting Service (Unified Alerting)
│   ├── Alert Rule Store
│   ├── Alert Evaluation Engine (Scheduler + Evaluator)
│   ├── Alert State Manager
│   ├── Notification Service (Contact Point → 전송)
│   └── Alertmanager (내장, Prometheus Alertmanager 호환)
├── Data Source Service
│   ├── Data Source Store (DB CRUD)
│   ├── Data Source Proxy (프록시 요청 처리)
│   └── Plugin Client (gRPC로 백엔드 플러그인 호출)
├── Auth Service
│   ├── User Authentication (Basic, Token, OAuth, LDAP, SAML)
│   ├── Authorization (RBAC, Folder/Dashboard Permissions)
│   └── Service Account Management
├── Provisioning Service
│   ├── Data Source Provisioner
│   ├── Dashboard Provisioner
│   ├── Alert Rule Provisioner
│   └── Contact Point Provisioner
└── Plugin Manager
    ├── Plugin Loader (플러그인 발견, 로드)
    ├── Plugin Registry (등록된 플러그인 관리)
    └── Backend Plugin Host (gRPC 서버로 실행)
```

#### Wire 의존성 주입

Grafana 백엔드는 Google의 Wire 라이브러리를 사용하여 서비스 간 의존성을 관리한다. Wire는 컴파일 타임에 의존성 그래프를 생성하여 런타임 리플렉션 없이 주입한다.

```go
// 간략화된 Wire 설정 예시
func Initialize(cfg *setting.Cfg) (*Server, error) {
    wire.Build(
        // Core Services
        sqlstore.ProvideService,
        dashboardservice.ProvideService,
        alerting.ProvideService,
        datasources.ProvideService,
        provisioning.ProvideService,
        pluginmanager.ProvideService,
        // Auth Services
        auth.ProvideService,
        oauthtoken.ProvideService,
        // API
        api.ProvideHTTPServer,
    )
    return &Server{}, nil
}
```

#### HTTP API 주요 엔드포인트

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `GET` | `/api/dashboards/uid/:uid` | UID로 대시보드 JSON을 조회한다 |
| `POST` | `/api/dashboards/db` | 대시보드를 생성/업데이트한다 |
| `DELETE` | `/api/dashboards/uid/:uid` | 대시보드를 삭제한다 |
| `GET` | `/api/datasources` | 데이터소스 목록을 조회한다 |
| `POST` | `/api/datasources` | 새 데이터소스를 생성한다 |
| `GET` | `/api/datasources/proxy/:id/*` | 데이터소스에 프록시 요청을 전달한다 |
| `POST` | `/api/ds/query` | 통합 쿼리 엔드포인트이다. 모든 데이터소스 유형에 대해 단일 API로 쿼리한다 |
| `POST` | `/api/annotations` | Annotation을 생성한다 |
| `GET` | `/api/alerts` | 알림 규칙 목록을 조회한다 |
| `GET` | `/api/ruler/grafana/api/v1/rules` | Ruler API(Prometheus 호환)로 규칙을 조회한다 |
| `POST` | `/api/user/using/:orgId` | 현재 사용자의 조직을 전환한다 |
| `GET` | `/api/search?query=xxx` | 대시보드/폴더를 검색한다 |
| `GET` | `/api/health` | 헬스체크 엔드포인트이다 |

### 1.4 Database 계층

**Database** 계층은 기본적으로 SQLite를 내장하며, 프로덕션 환경에서는 PostgreSQL 또는 MySQL을 권장한다. 대시보드 JSON, 사용자/조직 정보, 알림 규칙, API 키 등 모든 상태를 저장한다.

#### 주요 테이블 구조

| 테이블 | 설명 | 주요 컬럼 |
|--------|------|----------|
| `dashboard` | 대시보드 JSON을 저장한다 | `id`, `uid`, `title`, `data`(JSON), `folder_id`, `org_id` |
| `data_source` | 데이터소스 설정을 저장한다 | `id`, `name`, `type`, `url`, `json_data`, `secure_json_data` |
| `alert_rule` | 알림 규칙을 저장한다 | `uid`, `title`, `condition`, `data`(JSON), `for`, `labels` |
| `alert_rule_version` | 알림 규칙의 버전 이력이다 | `rule_uid`, `version`, `data` |
| `user` | 사용자 정보이다 | `id`, `login`, `email`, `is_admin`, `org_id` |
| `org` | 조직(Organization) 정보이다 | `id`, `name`, `address1` |
| `org_user` | 조직-사용자 매핑이다 | `org_id`, `user_id`, `role`(Admin/Editor/Viewer) |
| `team` | 팀 정보이다 | `id`, `name`, `org_id` |
| `team_member` | 팀-사용자 매핑이다 | `team_id`, `user_id` |
| `dashboard_acl` | 대시보드/폴더 접근 제어이다 | `dashboard_id`, `user_id`, `team_id`, `permission` |
| `api_key` | API 키이다 | `id`, `name`, `key`, `role`, `org_id`, `expires` |
| `kv_store` | 키-값 저장소이다. 플러그인 상태 등에 사용된다 | `org_id`, `namespace`, `key`, `value` |
| `annotation` | Annotation 데이터이다 | `id`, `dashboard_id`, `panel_id`, `time`, `text`, `tags` |
| `star` | 사용자가 즐겨찾기한 대시보드이다 | `user_id`, `dashboard_id` |

#### Database 선택 가이드

| 요구사항 | SQLite | PostgreSQL | MySQL |
|---------|--------|-----------|-------|
| 개발/테스트 | 적합 | 과도함 | 과도함 |
| 소규모 프로덕션 (5명 이하) | 가능 | 권장 | 권장 |
| 대규모 프로덕션 | 부적합 | 최적 | 적합 |
| HA 구성 | 불가 | 필수 | 필수 |
| 동시 쓰기 | 제한적 | 우수 | 우수 |
| 백업/복구 | 파일 복사 | pg_dump | mysqldump |

#### grafana.ini Database 설정

```ini
# PostgreSQL 설정 예시
[database]
type = postgres
host = postgres.monitoring.svc.cluster.local:5432
name = grafana
user = grafana
password = ${GF_DATABASE_PASSWORD}
ssl_mode = require
max_open_conn = 100
max_idle_conn = 50
conn_max_lifetime = 14400    # 4시간 (초 단위)
log_queries = false          # 쿼리 로깅 (디버깅용)

# MySQL 설정 예시
[database]
type = mysql
host = mysql.monitoring.svc.cluster.local:3306
name = grafana
user = grafana
password = ${GF_DATABASE_PASSWORD}
max_open_conn = 100
max_idle_conn = 50

# SQLite 설정 (기본값)
[database]
type = sqlite3
path = /var/lib/grafana/grafana.db
```

### 1.5 Provisioning 시스템 아키텍처

Provisioning은 Grafana 시작 시 파일 시스템의 YAML/JSON 파일을 읽어 데이터소스, 대시보드, 알림 규칙 등을 자동으로 설정하는 메커니즘이다.

```
Grafana 시작
    │
    ├── Provisioning Service 초기화
    │   │
    │   ├── /etc/grafana/provisioning/datasources/*.yaml 스캔
    │   │   └── 각 파일의 datasources[] → DB에 Upsert
    │   │
    │   ├── /etc/grafana/provisioning/dashboards/*.yaml 스캔
    │   │   └── provider.options.path 디렉토리의 JSON 파일 로드
    │   │       └── Dashboard JSON → DB에 Upsert (uid 기준)
    │   │
    │   ├── /etc/grafana/provisioning/alerting/*.yaml 스캔
    │   │   ├── alert-rules.yaml → Alert Rule DB Upsert
    │   │   ├── contact-points.yaml → Contact Point DB Upsert
    │   │   └── notification-policies.yaml → Policy Tree DB Upsert
    │   │
    │   └── /etc/grafana/provisioning/plugins/*.yaml 스캔
    │       └── 플러그인 사전 설치/활성화
    │
    ├── File Watcher 시작 (dashboards만 해당)
    │   └── updateIntervalSeconds마다 JSON 파일 변경 감지 → DB 재동기화
    │
    └── HTTP Server 시작
```

#### Provisioning 동작 규칙

| 규칙 | 설명 |
|------|------|
| Upsert 기준 | 데이터소스는 `name + orgId`, 대시보드는 `uid`, 알림은 `uid`를 기준으로 업데이트/삽입한다 |
| 삭제 | `deleteDatasources` 블록에 명시해야 기존 데이터소스를 삭제한다. 파일에서 항목을 제거해도 DB에서 삭제되지 않는다 |
| 편집 제한 | `editable: false` 설정 시 UI에서 수정 버튼이 비활성화된다. 코드 전용 관리를 강제한다 |
| 삭제 방지 | `disableDeletion: true` 설정 시 UI에서 대시보드 삭제를 방지한다 |
| Hot Reload | 대시보드만 `updateIntervalSeconds`(기본 10초)마다 파일 변경을 감지한다. 데이터소스와 알림은 재시작이 필요하다 |

### 1.6 Plugin 아키텍처

**Plugin System**은 Grafana의 확장 메커니즘이다. 세 가지 유형이 존재한다:

| 플러그인 유형 | 설명 | 예시 |
|-------------|------|------|
| Data Source Plugin | 외부 데이터 저장소와 통신하는 플러그인이다 | Prometheus, Loki, Elasticsearch |
| Panel Plugin | 새로운 시각화 유형을 추가하는 플러그인이다 | Flamegraph, Flow Chart |
| App Plugin | Data Source와 Panel을 묶어 완전한 앱 경험을 제공한다 | Kubernetes App, Oncall |

#### Plugin 로딩 메커니즘

```
Grafana 시작
    │
    ├── 내장(Bundled) 플러그인 로드
    │   └── /usr/share/grafana/public/app/plugins/
    │       ├── datasource/ (prometheus, loki, elasticsearch...)
    │       └── panel/ (timeseries, stat, gauge, table...)
    │
    ├── 외부 플러그인 디렉토리 스캔
    │   └── /var/lib/grafana/plugins/ (GF_PATHS_PLUGINS)
    │       ├── plugin.json 파싱 → 메타데이터 등록
    │       ├── Frontend 모듈 로드 (module.js)
    │       └── Backend 바이너리 실행 (gpx_* 바이너리, gRPC 서버)
    │
    └── 서명 검증
        ├── Grafana Labs 서명 → 자동 허용
        ├── Community 서명 → allow_loading_unsigned_plugins 필요
        └── 미서명 → 기본 차단 (보안)
```

#### Backend Plugin 통신 (gRPC)

백엔드 플러그인은 별도 프로세스로 실행되며 gRPC를 통해 Grafana 메인 프로세스와 통신한다:

```
┌──────────────────┐     gRPC      ┌──────────────────────┐
│   Grafana Server │◀────────────▶│  Backend Plugin       │
│   (Go main proc) │               │  (Go binary, 별도    │
│                  │  QueryData()  │   프로세스로 실행)     │
│  Plugin Client ──┤──────────────▶│  Data Source Handler  │
│                  │               │                       │
│                  │  CallResource()│                      │
│  Resource Call ──┤──────────────▶│  Resource Handler     │
│                  │               │                       │
│                  │  CheckHealth()│                      │
│  Health Check ───┤──────────────▶│  Health Checker       │
└──────────────────┘               └──────────────────────┘
```

| gRPC 메서드 | 설명 |
|------------|------|
| `QueryData` | 데이터 쿼리를 실행하고 DataFrame을 반환한다 |
| `CallResource` | 임의의 HTTP 리소스 요청을 처리한다 (커스텀 API) |
| `CheckHealth` | 데이터소스 연결 상태를 확인한다 |
| `SubscribeStream` | 실시간 스트리밍 데이터를 구독한다 |
| `PublishStream` | 실시간 스트리밍 데이터를 발행한다 |
| `RunStream` | 스트리밍 세션을 시작한다 |

### 1.7 Data Source Proxy 모드

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

