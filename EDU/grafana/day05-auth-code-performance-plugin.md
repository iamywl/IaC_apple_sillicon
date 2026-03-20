# Day 5: 인증/권한, Grafana as Code, 성능 최적화, 플러그인 개발

> Grafana의 인증/권한 체계(RBAC, OAuth, LDAP), Grafana as Code(Terraform, Grizzly), 성능 최적화 전략, 플러그인 개발 방법을 학습한다.

## 9장: 인증과 권한

### 9.1 인증 (Authentication) 방식

| 방식 | 설명 | 설정 |
|------|------|------|
| Built-in | Grafana 내장 사용자/비밀번호 | 기본 활성화 |
| OAuth 2.0 | Google, GitHub, Azure AD, Generic OAuth | `[auth.generic_oauth]` |
| LDAP | Active Directory / OpenLDAP | `[auth.ldap]` |
| SAML | SAML 2.0 IdP 연동 (Enterprise) | `[auth.saml]` |
| JWT | JWT 토큰 기반 인증 | `[auth.jwt]` |
| Proxy | Reverse proxy가 사용자 정보를 헤더로 전달 | `[auth.proxy]` |
| API Key | Programmatic 접근용 | API UI에서 생성 |
| Service Account | 서비스 간 통신용 (API Key 대체) | Service Accounts UI |

#### OAuth 2.0 설정 예시 (GitHub)

```ini
[auth.github]
enabled = true
allow_sign_up = true
auto_login = false
client_id = YOUR_GITHUB_CLIENT_ID
client_secret = YOUR_GITHUB_CLIENT_SECRET
scopes = user:email,read:org
auth_url = https://github.com/login/oauth/authorize
token_url = https://github.com/login/oauth/access_token
api_url = https://api.github.com/user
allowed_organizations = my-org
team_ids = 1234,5678
role_attribute_path = contains(groups[*], '@my-org/admins') && 'Admin' || contains(groups[*], '@my-org/editors') && 'Editor' || 'Viewer'
```

#### LDAP 설정 예시

```ini
# grafana.ini
[auth.ldap]
enabled = true
config_file = /etc/grafana/ldap.toml
allow_sign_up = true
```

```toml
# /etc/grafana/ldap.toml
[[servers]]
host = "ldap.example.com"
port = 636
use_ssl = true
start_tls = false
ssl_skip_verify = false
bind_dn = "cn=admin,dc=example,dc=com"
bind_password = "${LDAP_BIND_PASSWORD}"
search_filter = "(sAMAccountName=%s)"
search_base_dns = ["dc=example,dc=com"]

[servers.attributes]
name = "givenName"
surname = "sn"
username = "sAMAccountName"
member_of = "memberOf"
email = "mail"

[[servers.group_mappings]]
group_dn = "cn=grafana-admins,ou=groups,dc=example,dc=com"
org_role = "Admin"
grafana_admin = true
org_id = 1

[[servers.group_mappings]]
group_dn = "cn=grafana-editors,ou=groups,dc=example,dc=com"
org_role = "Editor"

[[servers.group_mappings]]
group_dn = "*"
org_role = "Viewer"
```

### 9.2 권한 (Authorization) 체계

#### Organization Role

| 역할 | 대시보드 | 데이터소스 | 알림 | 사용자 관리 |
|------|---------|----------|------|-----------|
| Viewer | 조회 | 사용 | 조회 | 불가 |
| Editor | 생성/수정/삭제 | 사용 | 생성/수정 | 불가 |
| Admin | 모든 권한 | 생성/수정/삭제 | 모든 권한 | 가능 |
| Grafana Admin | 모든 조직의 모든 권한 | 모든 권한 | 모든 권한 | 서버 관리 |

#### Folder/Dashboard Permissions

폴더와 대시보드 단위로 세밀한 접근 제어가 가능하다:

```
Organization
├── Folder: Infrastructure (Team SRE: Admin, Team Dev: Viewer)
│   ├── Dashboard: Node Exporter (상속: SRE=Admin, Dev=Viewer)
│   ├── Dashboard: Cluster Overview (상속)
│   └── Dashboard: Network (User alice: Editor 개별 추가)
├── Folder: Applications (Team Dev: Editor, Team SRE: Viewer)
│   ├── Dashboard: API Server (상속)
│   └── Dashboard: Frontend (상속)
└── Folder: Business (Team Analytics: Admin)
    └── Dashboard: Revenue (상속)
```

| Permission Level | 설명 |
|-----------------|------|
| View | 대시보드를 볼 수 있다 |
| Edit | 대시보드를 편집할 수 있다 (저장은 폴더 Edit 권한 필요) |
| Admin | 대시보드/폴더 권한을 변경할 수 있다 |

#### RBAC (Role-Based Access Control)

Grafana Enterprise와 Grafana Cloud에서는 RBAC로 더 세밀한 권한 관리가 가능하다:

```
# 커스텀 역할 정의 예시
Custom Role: "Dashboard Creator"
  Permissions:
    - dashboards:create (폴더 내 대시보드 생성)
    - dashboards:write (자신이 만든 대시보드 수정)
    - dashboards:read (모든 대시보드 조회)
    - folders:read (폴더 조회)

Custom Role: "Alert Manager"
  Permissions:
    - alert.rules:read
    - alert.rules:write
    - alert.silences:create
    - alert.notifications:read
    - alert.notifications:write
```

### 9.3 Teams

Teams는 사용자를 그룹으로 묶어 권한을 일괄 관리하는 기능이다:

```bash
# Grafana API로 팀 관리
# 팀 생성
curl -X POST http://grafana:3000/api/teams \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"name": "SRE Team", "email": "sre@example.com"}'

# 팀에 사용자 추가
curl -X POST http://grafana:3000/api/teams/1/members \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"userId": 5}'

# 폴더에 팀 권한 부여
curl -X POST http://grafana:3000/api/folders/infrastructure/permissions \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"items": [{"teamId": 1, "permission": 2}]}'
  # permission: 1=View, 2=Edit, 4=Admin
```

---

## 10장: Grafana as Code

### 10.1 Grafonnet (Jsonnet)

Grafonnet은 Grafana 대시보드를 Jsonnet으로 프로그래밍 방식으로 생성하는 라이브러리이다. 반복적인 패널 생성, 조건부 레이아웃 등을 코드로 관리할 수 있다.

```jsonnet
// dashboard.jsonnet
local grafana = import 'grafonnet-7.0/grafana.libsonnet';
local dashboard = grafana.dashboard;
local prometheus = grafana.panel.timeSeries;
local stat = grafana.panel.stat;
local variable = grafana.dashboard.variable;

local namespaceVar = variable.query.new(
  name='namespace',
  datasource='Prometheus',
  query='label_values(kube_pod_info, namespace)',
  refresh=2,  // On time range change
  multi=true,
  includeAll=true,
  sort=1,
);

local cpuPanel = prometheus.new(
  title='CPU Usage by Pod',
  datasource='Prometheus',
)
+ prometheus.queryOptions.withTargets([
  prometheus.target.new(
    expr='sum(rate(container_cpu_usage_seconds_total{namespace="$namespace"}[$__rate_interval])) by (pod)',
    legendFormat='{{pod}}',
  ),
])
+ prometheus.standardOptions.withUnit('percentunit')
+ prometheus.gridPos.withW(12)
+ prometheus.gridPos.withH(8);

local memoryPanel = prometheus.new(
  title='Memory Usage by Pod',
  datasource='Prometheus',
)
+ prometheus.queryOptions.withTargets([
  prometheus.target.new(
    expr='sum(container_memory_working_set_bytes{namespace="$namespace"}) by (pod)',
    legendFormat='{{pod}}',
  ),
])
+ prometheus.standardOptions.withUnit('bytes')
+ prometheus.gridPos.withW(12)
+ prometheus.gridPos.withH(8)
+ prometheus.gridPos.withX(12);

local podCountStat = stat.new(
  title='Running Pods',
  datasource='Prometheus',
)
+ stat.queryOptions.withTargets([
  stat.target.new(
    expr='count(kube_pod_status_phase{namespace="$namespace",phase="Running"})',
    instant=true,
  ),
])
+ stat.gridPos.withW(6)
+ stat.gridPos.withH(4);

dashboard.new(
  title='Namespace Overview',
  uid='namespace-overview',
  tags=['kubernetes', 'generated'],
  refresh='30s',
  timezone='browser',
)
+ dashboard.withVariables([namespaceVar])
+ dashboard.withPanels([
  podCountStat,
  cpuPanel + prometheus.gridPos.withY(4),
  memoryPanel + prometheus.gridPos.withY(4),
])
```

```bash
# Jsonnet을 JSON으로 컴파일
jsonnet -J vendor/ dashboard.jsonnet > dashboards/namespace-overview.json

# 또는 Grafana API로 직접 배포
jsonnet -J vendor/ dashboard.jsonnet | \
  curl -X POST http://grafana:3000/api/dashboards/db \
    -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: application/json" \
    -d @-
```

### 10.2 Grafonnet 유틸리티 패턴

```jsonnet
// lib/panels.libsonnet - 재사용 가능한 패널 라이브러리
{
  cpuPanel(namespace='$namespace', title='CPU Usage')::
    local grafana = import 'grafonnet-7.0/grafana.libsonnet';
    grafana.panel.timeSeries.new(title=title)
    + grafana.panel.timeSeries.queryOptions.withTargets([
      grafana.panel.timeSeries.target.new(
        expr='sum(rate(container_cpu_usage_seconds_total{namespace="%s"}[$__rate_interval])) by (pod)' % namespace,
        legendFormat='{{pod}}',
      ),
    ])
    + grafana.panel.timeSeries.standardOptions.withUnit('percentunit')
    + grafana.panel.timeSeries.standardOptions.thresholds.withSteps([
      { color: 'green', value: null },
      { color: 'yellow', value: 0.6 },
      { color: 'red', value: 0.8 },
    ]),

  memoryPanel(namespace='$namespace', title='Memory Usage')::
    local grafana = import 'grafonnet-7.0/grafana.libsonnet';
    grafana.panel.timeSeries.new(title=title)
    + grafana.panel.timeSeries.queryOptions.withTargets([
      grafana.panel.timeSeries.target.new(
        expr='sum(container_memory_working_set_bytes{namespace="%s"}) by (pod)' % namespace,
        legendFormat='{{pod}}',
      ),
    ])
    + grafana.panel.timeSeries.standardOptions.withUnit('bytes'),

  // 여러 네임스페이스에 대해 동일 패널을 반복 생성
  namespacePanels(namespaces)::
    std.flatMap(
      function(ns) [
        self.cpuPanel(ns, 'CPU - %s' % ns),
        self.memoryPanel(ns, 'Memory - %s' % ns),
      ],
      namespaces,
    ),
}
```

### 10.3 grafana-dashboard-provider 패턴

Kubernetes에서 대시보드를 GitOps로 관리하는 패턴:

```yaml
# ConfigMap으로 대시보드 JSON 관리
apiVersion: v1
kind: ConfigMap
metadata:
  name: grafana-custom-dashboards
  namespace: monitoring
  labels:
    grafana_dashboard: "1"       # Sidecar가 이 라벨을 감지하여 자동 로드
data:
  node-overview.json: |
    {
      "dashboard": {
        "uid": "node-overview",
        "title": "Node Overview",
        "panels": [...]
      }
    }
```

```yaml
# Grafana Helm values - Sidecar 설정
grafana:
  sidecar:
    dashboards:
      enabled: true
      label: grafana_dashboard
      labelValue: "1"
      folder: /tmp/dashboards
      provider:
        allowUiUpdates: false
        disableDelete: true
        foldersFromFilesStructure: true
    datasources:
      enabled: true
      label: grafana_datasource
```

Sidecar는 `grafana_dashboard: "1"` 라벨이 있는 모든 ConfigMap을 감시하고, 변경 시 자동으로 Grafana에 대시보드를 프로비저닝한다.

---

## 11장: 성능 최적화

### 11.1 Query Caching

Grafana 9.1+에서 도입된 Query Caching은 데이터소스 쿼리 결과를 캐싱하여 반복 요청을 줄인다:

```ini
# grafana.ini
[caching]
enabled = true
backend = memory              # memory, redis, memcached

# Memory backend 설정
[caching.memory]
gc_interval = 5m
max_size_mb = 256

# Redis backend 설정 (프로덕션 권장)
[caching.redis]
url = redis://redis.monitoring.svc.cluster.local:6379/0
prefix = grafana_cache
```

데이터소스별 캐시 설정:

| 캐시 레벨 | 동작 | 캐시 TTL |
|----------|------|---------|
| None | 캐싱하지 않는다 | - |
| Low | 대시보드 새로고침 시 캐시 사용 | 짧음 |
| Medium | 같은 쿼리에 대해 중간 수준 캐시 | 중간 |
| High | 적극적으로 캐시 사용 | 김 |

### 11.2 Dashboard 로딩 성능 최적화

| 최적화 기법 | 설명 | 효과 |
|-----------|------|------|
| Panel 수 줄이기 | 한 대시보드에 25개 이내 패널을 권장한다 | 초기 로딩 시간 단축 |
| Row 접기 | 비활성 Row를 접으면 해당 패널의 쿼리가 실행되지 않는다 | 쿼리 수 감소 |
| Resolution 낮추기 | 1/2, 1/3으로 설정하면 데이터 포인트가 줄어든다 | 전송 데이터 감소 |
| Instant Query 활용 | Stat, Gauge 패널은 Instant Query로 설정한다 | Range Query 대비 가벼움 |
| 시간 범위 제한 | `now-1h` 등 짧은 기본 시간 범위를 설정한다 | 쿼리 데이터 범위 축소 |
| Recording Rules | 자주 사용하는 복잡한 PromQL을 사전 계산한다 | 쿼리 시간 단축 |
| Min interval 설정 | Panel의 Min step을 `30s` 등으로 설정한다 | step 수 제한 |
| Max data points | 최대 데이터 포인트를 제한한다 | 전송 데이터 감소 |

### 11.3 Recording Rules로 쿼리 최적화

복잡한 PromQL을 Prometheus Recording Rule로 사전 계산하면 Grafana 대시보드 로딩이 빨라진다:

```yaml
# Prometheus Recording Rule
groups:
  - name: grafana-optimization
    interval: 30s
    rules:
      # 네임스페이스별 CPU 사용률 사전 계산
      - record: namespace:container_cpu_usage:sum_rate
        expr: sum(rate(container_cpu_usage_seconds_total[5m])) by (namespace)

      # 네임스페이스별 메모리 사용량 사전 계산
      - record: namespace:container_memory_working_set:sum
        expr: sum(container_memory_working_set_bytes) by (namespace)

      # 서비스별 에러율 사전 계산
      - record: service:http_error_rate:ratio
        expr: |
          sum(rate(http_requests_total{code=~"5.."}[5m])) by (service)
          /
          sum(rate(http_requests_total[5m])) by (service)

      # 노드별 CPU 사용률
      - record: node:cpu_usage:avg
        expr: 100 - (avg by(instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)
```

Grafana에서 Recording Rule 메트릭 사용:
```promql
# 원래 쿼리 (느림)
sum(rate(container_cpu_usage_seconds_total{namespace="$namespace"}[5m])) by (pod)

# Recording Rule 사용 (빠름)
namespace:container_cpu_usage:sum_rate{namespace="$namespace"}
```

### 11.4 Panel Rendering 최적화

```ini
# grafana.ini - 렌더링 관련 설정
[panels]
disable_sanitize_html = false

[dataproxy]
timeout = 30
dialTimeout = 10
keep_alive_seconds = 30
max_conns_per_host = 25          # 데이터소스당 최대 동시 연결 수
max_idle_connections = 100       # 유휴 연결 풀 크기
idle_conn_timeout_seconds = 90

[server]
concurrent_render_request_limit = 30  # 동시 렌더링 요청 제한
```

### 11.5 Database 튜닝

```ini
# grafana.ini - Database 성능 튜닝
[database]
max_open_conn = 100              # 최대 열린 연결 수
max_idle_conn = 50               # 최대 유휴 연결 수
conn_max_lifetime = 14400        # 연결 최대 수명 (초)
log_queries = false              # 쿼리 로깅 비활성화 (프로덕션)

# 대시보드 버전 정리 (오래된 버전 삭제)
[dashboards]
versions_to_keep = 20            # 기본값: 20

# 대시보드 검색 인덱스
[search]
enabled = true
```

---

## 12장: 플러그인 개발

### 12.1 플러그인 유형별 개발 개요

| 유형 | Frontend | Backend | SDK |
|------|----------|---------|-----|
| Panel Plugin | React 컴포넌트 | 불필요 | `@grafana/toolkit`, `create-plugin` |
| Data Source Plugin | Query Editor React | Go (gRPC) | `@grafana/toolkit` + `grafana-plugin-sdk-go` |
| App Plugin | 여러 페이지 React | 선택적 | `@grafana/toolkit` |

### 12.2 플러그인 프로젝트 구조

```bash
# 플러그인 scaffolding
npx @grafana/create-plugin@latest

# 생성되는 디렉토리 구조
my-plugin/
├── src/
│   ├── module.ts              # 플러그인 엔트리포인트
│   ├── plugin.json            # 플러그인 메타데이터
│   ├── components/
│   │   ├── App.tsx            # (App Plugin) 메인 컴포넌트
│   │   ├── ConfigEditor.tsx   # (Data Source) 설정 에디터
│   │   └── QueryEditor.tsx    # (Data Source) 쿼리 에디터
│   ├── datasource.ts          # (Data Source) 데이터소스 클래스
│   └── types.ts               # TypeScript 타입 정의
├── pkg/                        # (Backend) Go 코드
│   ├── main.go
│   └── plugin/
│       ├── datasource.go      # QueryData 구현
│       └── resource_handler.go
├── tests/
├── package.json
├── go.mod                      # (Backend)
├── Magefile.go                 # (Backend) 빌드 스크립트
└── docker-compose.yaml         # 로컬 개발 환경
```

### 12.3 Panel Plugin 예시

```typescript
// src/module.ts
import { PanelPlugin } from '@grafana/data';
import { SimplePanel } from './components/SimplePanel';
import { SimpleOptions } from './types';

export const plugin = new PanelPlugin<SimpleOptions>(SimplePanel)
  .setPanelOptions((builder) => {
    builder
      .addTextInput({
        path: 'text',
        name: 'Simple text option',
        description: 'Description of panel option',
        defaultValue: 'Default value',
      })
      .addBooleanSwitch({
        path: 'showSeriesCount',
        name: 'Show series counter',
        defaultValue: false,
      })
      .addRadio({
        path: 'seriesCountSize',
        defaultValue: 'sm',
        name: 'Series counter size',
        settings: {
          options: [
            { value: 'sm', label: 'Small' },
            { value: 'md', label: 'Medium' },
            { value: 'lg', label: 'Large' },
          ],
        },
        showIf: (config) => config.showSeriesCount,
      });
  });

// src/components/SimplePanel.tsx
import React from 'react';
import { PanelProps } from '@grafana/data';
import { useTheme2 } from '@grafana/ui';
import { SimpleOptions } from '../types';

interface Props extends PanelProps<SimpleOptions> {}

export const SimplePanel: React.FC<Props> = ({ data, width, height, options }) => {
  const theme = useTheme2();

  return (
    <div style={{ width, height, padding: theme.spacing(2) }}>
      <h3>{options.text}</h3>
      {options.showSeriesCount && (
        <p>Series count: {data.series.length}</p>
      )}
      {data.series.map((series, i) => (
        <div key={i}>
          <strong>{series.name}</strong>: {series.fields.length} fields, {series.length} rows
        </div>
      ))}
    </div>
  );
};
```

### 12.4 Data Source Plugin (Backend) 예시

```go
// pkg/plugin/datasource.go
package plugin

import (
    "context"
    "encoding/json"
    "fmt"
    "net/http"
    "time"

    "github.com/grafana/grafana-plugin-sdk-go/backend"
    "github.com/grafana/grafana-plugin-sdk-go/backend/instancemgmt"
    "github.com/grafana/grafana-plugin-sdk-go/data"
)

type MyDatasource struct {
    httpClient *http.Client
    baseURL    string
}

func NewDatasource(settings backend.DataSourceInstanceSettings) (instancemgmt.Instance, error) {
    var jsonData map[string]interface{}
    if err := json.Unmarshal(settings.JSONData, &jsonData); err != nil {
        return nil, err
    }

    return &MyDatasource{
        httpClient: &http.Client{Timeout: 10 * time.Second},
        baseURL:    settings.URL,
    }, nil
}

func (d *MyDatasource) QueryData(ctx context.Context, req *backend.QueryDataRequest) (*backend.QueryDataResponse, error) {
    response := backend.NewQueryDataResponse()

    for _, q := range req.Queries {
        res := d.query(ctx, req.PluginContext, q)
        response.Responses[q.RefID] = res
    }

    return response, nil
}

func (d *MyDatasource) query(ctx context.Context, pCtx backend.PluginContext, query backend.DataQuery) backend.DataResponse {
    var qm queryModel
    if err := json.Unmarshal(query.JSON, &qm); err != nil {
        return backend.ErrDataResponse(backend.StatusBadRequest, fmt.Sprintf("json unmarshal: %v", err))
    }

    // DataFrame 생성
    frame := data.NewFrame("response")
    frame.Fields = append(frame.Fields,
        data.NewField("time", nil, []time.Time{time.Now()}),
        data.NewField("value", nil, []float64{42.0}),
    )

    return backend.DataResponse{Frames: data.Frames{frame}}
}

func (d *MyDatasource) CheckHealth(ctx context.Context, req *backend.CheckHealthRequest) (*backend.CheckHealthResult, error) {
    resp, err := d.httpClient.Get(d.baseURL + "/health")
    if err != nil {
        return &backend.CheckHealthResult{
            Status:  backend.HealthStatusError,
            Message: "Connection failed: " + err.Error(),
        }, nil
    }
    defer resp.Body.Close()

    if resp.StatusCode != http.StatusOK {
        return &backend.CheckHealthResult{
            Status:  backend.HealthStatusError,
            Message: fmt.Sprintf("Health check returned %d", resp.StatusCode),
        }, nil
    }

    return &backend.CheckHealthResult{
        Status:  backend.HealthStatusOk,
        Message: "Data source is working",
    }, nil
}
```

### 12.5 plugin.json 구조

```json
{
  "type": "datasource",
  "name": "My Custom Datasource",
  "id": "myorg-custom-datasource",
  "metrics": true,
  "annotations": true,
  "alerting": true,
  "backend": true,
  "executable": "gpx_custom_datasource",
  "info": {
    "description": "Custom datasource plugin for Grafana",
    "author": { "name": "My Org", "url": "https://example.com" },
    "logos": {
      "small": "img/logo.svg",
      "large": "img/logo.svg"
    },
    "version": "1.0.0",
    "updated": "2024-01-15"
  },
  "dependencies": {
    "grafanaVersion": ">=9.0.0",
    "grafanaDependency": ">=9.0.0",
    "plugins": []
  },
  "includes": [
    { "type": "dashboard", "name": "Overview", "path": "dashboards/overview.json" }
  ]
}
```

---

