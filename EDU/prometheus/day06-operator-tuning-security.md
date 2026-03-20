# Day 6: Operator 패턴, 성능 튜닝, 보안

> Prometheus Operator와 CRD 기반 관리, 성능 튜닝(카디널리티 관리, 메모리 최적화), 보안 설정(TLS, 인증, RBAC)을 학습한다.

## Operator 패턴 (Prometheus Operator)

### 개요

Prometheus Operator는 Kubernetes CRD를 사용하여 Prometheus, Alertmanager, 관련 컴포넌트를 선언적으로 관리하는 Kubernetes Operator이다. 이 프로젝트에서 사용하는 `kube-prometheus-stack` Helm Chart에 포함되어 있다.

### CRD 목록

| CRD | 설명 | 용도 |
|-----|------|------|
| `Prometheus` | Prometheus StatefulSet을 관리한다 | Prometheus 인스턴스 배포/설정 |
| `Alertmanager` | Alertmanager StatefulSet을 관리한다 | Alertmanager 인스턴스 배포/설정 |
| `ServiceMonitor` | Service를 통한 타겟 스크래핑을 정의한다 | 가장 일반적인 메트릭 수집 설정 |
| `PodMonitor` | Pod를 직접 스크래핑하는 설정을 정의한다 | Service 없이 Pod에서 직접 수집 |
| `PrometheusRule` | Recording Rule과 Alerting Rule을 정의한다 | 규칙 관리 |
| `AlertmanagerConfig` | Alertmanager 라우팅 설정을 네임스페이스 수준에서 정의한다 | 분산 알림 관리 |
| `Probe` | blackbox_exporter를 통한 Probe 설정을 정의한다 | 외부 URL 모니터링 |
| `ScrapeConfig` | 일반 scrape_config를 CRD로 정의한다 (Prometheus Operator 0.65+) | 유연한 스크래핑 설정 |
| `ThanosRuler` | Thanos Ruler를 관리한다 | Thanos 환경의 Rule 평가 |

### ServiceMonitor 심화

```yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: my-app-monitor
  namespace: monitoring
  labels:
    release: kube-prometheus-stack  # Prometheus Operator가 이 라벨로 발견한다
spec:
  # 대상 Service의 라벨 선택자
  selector:
    matchLabels:
      app: my-app
    # 또는 표현식
    # matchExpressions:
    #   - key: app
    #     operator: In
    #     values: [my-app, my-app-v2]

  # 대상 네임스페이스 (생략하면 ServiceMonitor와 같은 네임스페이스)
  namespaceSelector:
    matchNames:
      - demo
      - production
    # 모든 네임스페이스: any: true

  # 엔드포인트 설정 (여러 포트를 가진 서비스의 경우 여러 엔드포인트 정의 가능)
  endpoints:
    - port: metrics               # Service의 포트 이름
      interval: 15s               # 스크래핑 주기
      scrapeTimeout: 10s          # 타임아웃
      path: /metrics              # 메트릭 경로
      scheme: https               # HTTP/HTTPS
      # TLS 설정
      tlsConfig:
        insecureSkipVerify: true
      # Basic Auth
      basicAuth:
        username:
          name: my-app-auth       # Secret 이름
          key: username            # Secret 키
        password:
          name: my-app-auth
          key: password
      # Bearer Token
      # bearerTokenSecret:
      #   name: my-app-token
      #   key: token

      # 스크래핑 후 메트릭 relabeling
      metricRelabelings:
        - sourceLabels: [__name__]
          regex: 'go_.*'
          action: drop
      # 스크래핑 전 타겟 relabeling
      relabelings:
        - sourceLabels: [__meta_kubernetes_pod_node_name]
          targetLabel: node
```

### PodMonitor

Service가 없는 Pod에서 직접 메트릭을 수집할 때 사용한다.

```yaml
apiVersion: monitoring.coreos.com/v1
kind: PodMonitor
metadata:
  name: my-daemon-monitor
  namespace: monitoring
  labels:
    release: kube-prometheus-stack
spec:
  selector:
    matchLabels:
      app: my-daemon
  namespaceSelector:
    matchNames:
      - kube-system
  podMetricsEndpoints:
    - port: metrics
      interval: 30s
      path: /metrics
```

### PrometheusRule

```yaml
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: my-app-rules
  namespace: monitoring
  labels:
    release: kube-prometheus-stack  # Operator가 이 라벨로 발견한다
spec:
  groups:
    - name: my-app.recording.rules
      interval: 30s
      rules:
        - record: job:http_requests:rate5m
          expr: sum by(job) (rate(http_requests_total[5m]))

    - name: my-app.alerting.rules
      rules:
        - alert: HighErrorRate
          expr: job:http_errors:rate5m / job:http_requests:rate5m > 0.05
          for: 5m
          labels:
            severity: critical
          annotations:
            summary: "High error rate detected"
```

### AlertmanagerConfig (네임스페이스 수준)

```yaml
apiVersion: monitoring.coreos.com/v1alpha1
kind: AlertmanagerConfig
metadata:
  name: team-alerts
  namespace: demo  # 이 네임스페이스의 알림에만 적용
  labels:
    alertmanagerConfig: enabled
spec:
  route:
    groupBy: ['alertname']
    groupWait: 30s
    groupInterval: 5m
    repeatInterval: 12h
    receiver: team-slack
    matchers:
      - name: namespace
        value: demo
  receivers:
    - name: team-slack
      slackConfigs:
        - channel: '#demo-alerts'
          sendResolved: true
          apiURL:
            name: slack-webhook
            key: url
```

### Operator 동작 방식

```
1. Prometheus CRD를 감시한다
   └── Prometheus 리소스 변경 시 StatefulSet을 업데이트한다

2. ServiceMonitor/PodMonitor CRD를 감시한다
   └── 변경 시 Prometheus의 scrape_configs를 자동으로 업데이트한다
   └── prometheus.yml ConfigMap/Secret을 재생성한다
   └── Prometheus에 config reload 신호를 보낸다

3. PrometheusRule CRD를 감시한다
   └── 변경 시 Rule 파일을 업데이트한다
   └── Prometheus에 config reload 신호를 보낸다

4. 매칭 규칙:
   Prometheus CRD의 serviceMonitorSelector, podMonitorSelector,
   ruleSelector 라벨과 일치하는 CRD만 적용된다
```

```bash
# 이 프로젝트에서 Operator CRD 확인
export KUBECONFIG=kubeconfig/platform.yaml

# ServiceMonitor 목록
kubectl get servicemonitor -n monitoring

# PodMonitor 목록
kubectl get podmonitor -A

# PrometheusRule 목록
kubectl get prometheusrule -n monitoring

# Prometheus CRD 상세 정보
kubectl get prometheus -n monitoring -o yaml

# Operator 로그 확인
kubectl logs -n monitoring -l app.kubernetes.io/name=prometheus-operator
```

---

## 성능 튜닝

### Cardinality 관리

카디널리티는 Prometheus 성능에 가장 큰 영향을 미치는 요소이다.

```promql
# 현재 활성 시계열 수
prometheus_tsdb_head_series

# 메트릭별 시계열 수 확인 (TSDB Status API)
# curl http://localhost:9090/api/v1/status/tsdb | jq '.data.seriesCountByMetricName[:20]'

# 라벨별 카디널리티 확인
# curl http://localhost:9090/api/v1/status/tsdb | jq '.data.labelValueCountByLabelName[:20]'
```

#### 카디널리티 줄이기

```yaml
# 1. metric_relabel_configs로 불필요한 메트릭 드롭
metric_relabel_configs:
  - source_labels: [__name__]
    regex: 'go_.*|process_.*'
    action: drop

# 2. 불필요한 라벨 제거
metric_relabel_configs:
  - regex: 'pod_template_hash|controller_revision_hash'
    action: labeldrop

# 3. 높은 카디널리티 라벨 값 정규화
metric_relabel_configs:
  - source_labels: [path]
    regex: '/api/users/[0-9]+'
    replacement: '/api/users/:id'
    target_label: path

# 4. sample_limit으로 타겟당 최대 시계열 수 제한
scrape_configs:
  - job_name: 'untrusted-app'
    sample_limit: 5000  # 이 수를 초과하면 스크래핑을 실패 처리한다
```

### Scrape Interval 최적화

```yaml
# scrape_interval 선택 가이드:
# - 인프라 메트릭 (node_exporter, KSM): 30s ~ 1m
# - 애플리케이션 메트릭: 15s ~ 30s
# - 비즈니스 메트릭: 30s ~ 5m
# - 고빈도 필요 (트레이딩 등): 5s ~ 15s (카디널리티 주의)

# 계산 예시:
# 시계열 수: 500,000
# scrape_interval: 15s
# 초당 샘플 수: 500,000 / 15 = 33,333 samples/s
#
# scrape_interval: 30s로 변경하면:
# 초당 샘플 수: 500,000 / 30 = 16,667 samples/s (50% 감소)
# 저장 공간도 비례하여 감소한다
```

### Memory / CPU 사이징

```
# 메모리 추정 공식:
# 필요 메모리 ≈ 활성 시계열 수 * 1.5KB + WAL 버퍼 + Go 런타임 오버헤드
#
# 예시:
# 500,000 시계열 * 1.5KB = 750MB
# WAL 버퍼: ~256MB
# Go 런타임: ~256MB
# 합계: ~1.25GB
# 여유 포함 권장: 2GB
#
# 1,000,000 시계열 -> 약 3~4GB 권장
# 5,000,000 시계열 -> 약 10~15GB 권장

# CPU 추정:
# 기본적으로 2~4 core면 대부분의 워크로드에 충분하다
# Compaction, Rule 평가, 복잡한 PromQL 쿼리가 CPU를 많이 사용한다
# Recording Rule이 많으면 추가 CPU가 필요하다

# 디스크 I/O:
# SSD를 강력히 권장한다
# WAL 쓰기는 순차적이므로 HDD도 가능하지만, 쿼리 성능이 저하된다
# NFS는 사용하지 않는다 (파일 잠금 이슈로 TSDB 손상 가능)
```

#### 이 프로젝트의 리소스 설정 분석

```yaml
# manifests/monitoring-values.yaml의 설정:
prometheus:
  prometheusSpec:
    resources:
      requests:
        cpu: 200m       # 최소 0.2 core
        memory: 512Mi   # 최소 512MB
      limits:
        memory: 2Gi     # 최대 2GB

# 이 설정은 소규모 학습 환경에 적합하다
# 활성 시계열 약 50만~100만 개까지 처리 가능하다
# 시계열이 100만 개를 초과하면 memory limit을 4Gi로 늘려야 한다
```

### Chunk Encoding 최적화

```bash
# WAL 압축 활성화 (Prometheus 2.20+, 기본 활성화)
--storage.tsdb.wal-compression

# WAL 압축은 디스크 I/O를 약 50% 줄이지만 CPU를 약간 더 사용한다
# SSD 환경에서는 활성화를 권장한다

# Out-of-order 샘플 허용 (Prometheus 2.39+)
# Remote Write 재전송이나 네트워크 지연으로 인한 순서 역전 처리
--storage.tsdb.out-of-order-time-window=5m
```

---

## 보안

### TLS 설정

```yaml
# Prometheus 자체의 TLS 활성화 (web.yml)
tls_server_config:
  cert_file: /etc/prometheus/tls/server.crt
  key_file: /etc/prometheus/tls/server.key
  client_auth_type: RequireAndVerifyClientCert  # mTLS
  client_ca_file: /etc/prometheus/tls/ca.crt
  min_version: TLS12

# Prometheus가 TLS 타겟을 스크래핑하는 설정
scrape_configs:
  - job_name: 'secure-app'
    scheme: https
    tls_config:
      ca_file: /etc/prometheus/tls/ca.crt
      cert_file: /etc/prometheus/tls/client.crt
      key_file: /etc/prometheus/tls/client.key
      insecure_skip_verify: false  # 프로덕션에서는 반드시 false
```

### Basic Auth

```yaml
# web.yml (Prometheus HTTP 서버 인증)
basic_auth_users:
  admin: $2y$12$...  # bcrypt 해시된 비밀번호

# 스크래핑 시 Basic Auth 사용
scrape_configs:
  - job_name: 'secured-exporter'
    basic_auth:
      username: prometheus
      password_file: /etc/prometheus/secrets/password
```

### Bearer Token

```yaml
# Kubernetes API Server 스크래핑 시 Bearer Token 사용
scrape_configs:
  - job_name: 'kubernetes-apiservers'
    bearer_token_file: /var/run/secrets/kubernetes.io/serviceaccount/token
    tls_config:
      ca_file: /var/run/secrets/kubernetes.io/serviceaccount/ca.crt
```

### Network Policy

```yaml
# Prometheus가 스크래핑하는 네트워크만 허용하는 NetworkPolicy
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: prometheus-network-policy
  namespace: monitoring
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/name: prometheus
  policyTypes:
    - Ingress
    - Egress
  ingress:
    # Grafana에서의 쿼리 허용
    - from:
        - podSelector:
            matchLabels:
              app.kubernetes.io/name: grafana
      ports:
        - port: 9090
    # Alertmanager에서의 알림 확인 허용
    - from:
        - podSelector:
            matchLabels:
              app.kubernetes.io/name: alertmanager
      ports:
        - port: 9090
  egress:
    # 모든 Pod의 메트릭 포트로 스크래핑 허용
    - to:
        - namespaceSelector: {}
      ports:
        - port: 9090
        - port: 9100  # node-exporter
        - port: 8080  # kube-state-metrics
        - port: 10250 # kubelet
    # Kubernetes API Server 접근 허용
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: default
      ports:
        - port: 443
    # Alertmanager로 알림 전송 허용
    - to:
        - podSelector:
            matchLabels:
              app.kubernetes.io/name: alertmanager
      ports:
        - port: 9093
    # DNS 허용
    - to: []
      ports:
        - port: 53
          protocol: UDP
        - port: 53
          protocol: TCP
```

### RBAC 설정

```yaml
# Prometheus ServiceAccount에 필요한 최소 RBAC
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: prometheus
rules:
  # Service Discovery를 위한 읽기 권한
  - apiGroups: [""]
    resources:
      - nodes
      - nodes/metrics
      - services
      - endpoints
      - pods
    verbs: ["get", "list", "watch"]
  - apiGroups: ["networking.k8s.io"]
    resources:
      - ingresses
    verbs: ["get", "list", "watch"]
  # kubelet 메트릭 접근
  - nonResourceURLs: ["/metrics", "/metrics/cadvisor"]
    verbs: ["get"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: prometheus
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: prometheus
subjects:
  - kind: ServiceAccount
    name: kube-prometheus-stack-prometheus
    namespace: monitoring
```

---

