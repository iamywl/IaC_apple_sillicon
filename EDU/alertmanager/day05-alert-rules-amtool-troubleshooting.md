# Day 5: Prometheus Alert Rules 심화, amtool CLI 심화, 트러블슈팅

> 이 문서에서는 Prometheus Alert Rule 작성법(for/pending, absent, predict_linear, SLO 기반 에러 버짓, Golden Signals), promtool 단위 테스트, amtool CLI 고급 사용법, 그리고 알림 미발송/중복/지연 등의 트러블슈팅 절차를 다룬다.

---

## Prometheus Alert Rules 심화

### Recording Rules vs Alerting Rules

Prometheus에서 Rule은 두 가지 유형이 있다.

| 구분 | Recording Rule | Alerting Rule |
|------|---|---|
| 목적 | 복잡한 쿼리를 미리 계산하여 새 시계열로 저장한다 | 조건이 충족되면 AlertManager로 알림을 전송한다 |
| 결과 | 새로운 metric이 생성된다 | Alert이 firing 상태가 된다 |
| 문법 | `record:` 키워드 | `alert:` 키워드 |
| 사용 목적 | 대시보드 성능 최적화, alerting rule의 기반 쿼리 | 문제 탐지 및 알림 |

```yaml
groups:
  - name: recording-rules
    rules:
      # Recording Rule: HTTP 요청 에러율을 미리 계산
      - record: service:http_error_rate:ratio_rate5m
        expr: |
          sum(rate(http_requests_total{code=~"5.."}[5m])) by (service)
          /
          sum(rate(http_requests_total[5m])) by (service)

  - name: alerting-rules
    rules:
      # Alerting Rule: 미리 계산된 에러율을 기반으로 알림
      - alert: HighErrorRate
        expr: service:http_error_rate:ratio_rate5m > 0.01
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "{{ $labels.service }} 에러율 {{ $value | humanizePercentage }}"
```

Recording Rule의 네이밍 컨벤션:
```
level:metric:operations
예: service:http_error_rate:ratio_rate5m
    │       │               │
    │       │               └─ 연산 방법 (ratio, rate, 윈도우)
    │       └─ 원본 메트릭 이름
    └─ 집계 레벨 (service, namespace, cluster 등)
```

### `for` 절의 의미와 Pending 상태

`for` 절은 알림 조건이 지속적으로 충족되어야 하는 최소 시간이다. 이 시간 동안 알림은 **Pending** 상태에 머무른다.

```
알림 조건 (CPU > 80%) 평가:
                                                                    시간 →
평가 간격:  ┃     ┃     ┃     ┃     ┃     ┃     ┃     ┃     ┃     ┃
CPU 값:    75%   85%   90%   88%   92%   70%   85%   90%   95%   93%
조건 충족:   X     O     O     O     O     X     O     O     O     O
                  │     │     │     │           │     │     │     │
                  └─────┴─────┴─────┘           └─────┴─────┴─────┘
                   Pending 상태                   Pending 상태
                   (for: 5m)                      (for: 5m)
                        │                                   │
                  5분 경과 전에                          5분 경과 후
                  조건 해소 → 알림 안 됨                → Firing! 알림 전송
```

`for` 절이 없으면(또는 `for: 0s`) 조건이 한 번이라도 충족되면 즉시 firing 상태가 된다. 일시적 스파이크에 알림이 발생하지 않도록 적절한 `for` 기간을 설정하는 것이 중요하다.

| 알림 유형 | 권장 `for` 값 | 이유 |
|-----------|---|---|
| 서비스 다운 (up == 0) | 1m~2m | 빠른 인지 필요, 하지만 일시적 재시작 제외 |
| 리소스 사용률 (CPU, Memory) | 5m~15m | 일시적 스파이크 제외 |
| 에러율 증가 | 2m~5m | 배포 직후 일시적 증가 제외 |
| 디스크 부족 | 5m~10m | 디스크는 급변하지 않음 |
| 인증서 만료 | 0s (즉시) | 예측 알림이므로 즉시 발생 |

### Labels vs Annotations 구분 기준

**Labels**: 알림의 정체성을 정의한다. routing, grouping, inhibition, silencing에 사용된다.

**Annotations**: 알림의 부가 정보를 제공한다. 사람이 읽기 위한 용도이다.

```yaml
- alert: HighCPU
  expr: node_cpu_usage > 80
  for: 5m
  labels:
    # Labels에 넣어야 할 것:
    severity: warning              # 라우팅에 사용
    team: platform                 # 라우팅에 사용
    layer: infrastructure          # 억제 규칙에 사용
    # Labels에 넣지 말아야 할 것:
    # current_value: "{{ $value }}"  # 동적 값 → fingerprint 변경 → 중복 제거 불가

  annotations:
    # Annotations에 넣어야 할 것:
    summary: "노드 {{ $labels.instance }}의 CPU 사용률이 높다"
    description: "현재 CPU 사용률: {{ $value | humanizePercentage }}"
    runbook_url: "https://wiki.example.com/runbooks/high-cpu"
    dashboard_url: "https://grafana.example.com/d/node-cpu?var-instance={{ $labels.instance }}"
```

규칙 정리:

| 기준 | Labels | Annotations |
|------|--------|-------------|
| 고정적인 값 | O | O |
| 동적인 값 (현재 메트릭 값 등) | X | O |
| 라우팅에 사용 | O | X |
| 그룹핑에 사용 | O | X |
| 억제 규칙에 사용 | O | X |
| 사람이 읽을 설명 | X | O |
| URL 링크 | X | O |

### 다중 조건 알림 (and / or / unless)

PromQL의 논리 연산자를 사용하여 여러 조건을 조합한 복잡한 알림을 작성할 수 있다.

```yaml
# AND: 두 조건 모두 충족 시 알림
- alert: HighCPUAndHighMemory
  expr: |
    (node_cpu_usage > 80)
    and
    (node_memory_usage > 80)
  for: 5m
  labels:
    severity: critical
  annotations:
    summary: "노드 {{ $labels.instance }}의 CPU와 메모리 모두 80%를 초과했다"

# OR: 둘 중 하나만 충족해도 알림
- alert: ResourceExhaustion
  expr: |
    (node_cpu_usage > 95)
    or
    (node_memory_usage > 95)
  for: 5m
  labels:
    severity: critical

# UNLESS: 첫 번째 조건이 충족되지만 두 번째 조건도 충족되면 제외
- alert: HighCPUExceptBatchNodes
  expr: |
    node_cpu_usage > 80
    unless
    kube_node_labels{label_node_type="batch"}
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: "배치 노드를 제외한 노드에서 CPU가 80%를 초과했다"
```

### absent() 함수 활용 (메트릭 누락 탐지)

`absent()` 함수는 지정된 메트릭이 존재하지 않을 때 값 1을 반환한다. 메트릭 수집이 중단된 상황을 탐지하는 데 사용한다.

```yaml
# 메트릭 수집 중단 탐지
- alert: NodeExporterDown
  expr: absent(up{job="node-exporter"})
  for: 5m
  labels:
    severity: critical
  annotations:
    summary: "Node Exporter 메트릭이 수집되지 않고 있다"
    description: "node-exporter job의 up 메트릭이 5분 이상 존재하지 않는다"

# 특정 인스턴스의 메트릭 누락 탐지
- alert: InstanceMetricsAbsent
  expr: absent(node_cpu_seconds_total{instance="critical-server:9100"})
  for: 5m
  labels:
    severity: critical
  annotations:
    summary: "critical-server의 CPU 메트릭이 수집되지 않고 있다"

# absent_over_time: 일정 기간 동안 메트릭이 한 번도 수집되지 않음
- alert: MetricsGap
  expr: absent_over_time(http_requests_total{job="api-server"}[15m])
  for: 0s
  labels:
    severity: warning
  annotations:
    summary: "api-server의 HTTP 요청 메트릭이 15분간 수집되지 않았다"
```

**absent() 사용 시 주의사항**: `absent()`는 지정된 metric name과 label 조합이 전혀 존재하지 않을 때만 동작한다. 일부 인스턴스만 누락된 경우를 탐지하려면 `absent()`가 아닌 다른 방법을 사용해야 한다.

```yaml
# 잘못된 사용: 3대 중 1대만 누락되어도 absent()는 동작하지 않음
# (나머지 2대의 메트릭이 존재하므로)
- alert: WrongAbsentUsage
  expr: absent(up{job="node-exporter"})    # 1대라도 있으면 트리거 안 됨

# 올바른 대안: count로 예상 인스턴스 수와 비교
- alert: NodeExporterInstanceMissing
  expr: count(up{job="node-exporter"}) < 3
  for: 5m
  labels:
    severity: warning
```

### predict_linear() 활용 (디스크 부족 예측)

`predict_linear()` 함수는 현재 추세를 기반으로 미래 값을 선형 회귀로 예측한다. 디스크 부족, 인증서 만료 등 점진적으로 변화하는 메트릭의 예측 알림에 유용하다.

```yaml
# 4시간 후 디스크가 가득 찰 것으로 예측되면 알림
- alert: DiskWillFillIn4Hours
  expr: |
    predict_linear(
      node_filesystem_avail_bytes{mountpoint="/"}[6h],
      4 * 3600
    ) < 0
  for: 30m
  labels:
    severity: warning
  annotations:
    summary: "{{ $labels.instance }}의 디스크가 4시간 내 가득 찰 것으로 예측된다"
    description: "6시간 추세 기반 선형 예측 결과이다"
    runbook_url: "https://wiki.example.com/runbooks/disk-full"

# 24시간 후 디스크가 가득 찰 것으로 예측 (여유 있는 경고)
- alert: DiskWillFillIn24Hours
  expr: |
    predict_linear(
      node_filesystem_avail_bytes{mountpoint="/"}[24h],
      24 * 3600
    ) < 0
    and
    node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"} < 0.3
  for: 1h
  labels:
    severity: info
  annotations:
    summary: "{{ $labels.instance }}의 디스크가 24시간 내 가득 찰 것으로 예측된다"

# 인증서 만료 예측
- alert: CertificateExpiringSoon
  expr: |
    (probe_ssl_earliest_cert_expiry - time()) / 86400 < 30
  for: 0s
  labels:
    severity: warning
  annotations:
    summary: "{{ $labels.instance }}의 SSL 인증서가 {{ $value | humanizeDuration }} 후 만료된다"
```

### 알림 규칙 테스트

Prometheus의 `promtool`을 사용하여 알림 규칙의 문법 검증과 단위 테스트를 수행할 수 있다.

**문법 검증**

```bash
# 알림 규칙 파일 문법 검증
promtool check rules alert-rules.yaml

# 출력 예시:
# Checking alert-rules.yaml
#   SUCCESS: 5 rules found
```

**단위 테스트**

```yaml
# alert-rules-test.yaml
rule_files:
  - alert-rules.yaml

evaluation_interval: 1m

tests:
  # 테스트 1: HighCPU 알림이 5분 후 firing되는지 확인
  - interval: 1m
    input_series:
      - series: 'node_cpu_usage{instance="node-1"}'
        values: '50 60 85 85 85 85 85 85'    # 3분부터 85% 지속

    alert_rule_test:
      # 5분(for: 5m) 이전에는 pending 상태여야 한다
      - eval_time: 5m
        alertname: HighCPU
        exp_alerts: []      # 아직 firing 안 됨

      # 8분 후에는 firing 상태여야 한다 (3분부터 85% 시작 + for: 5m)
      - eval_time: 8m
        alertname: HighCPU
        exp_alerts:
          - exp_labels:
              severity: warning
              instance: node-1
            exp_annotations:
              summary: "노드 node-1의 CPU 사용률이 높다"

  # 테스트 2: absent() 알림 테스트
  - interval: 1m
    input_series: []    # 메트릭 없음

    alert_rule_test:
      - eval_time: 5m
        alertname: NodeExporterDown
        exp_alerts:
          - exp_labels:
              severity: critical
```

```bash
# 단위 테스트 실행
promtool test rules alert-rules-test.yaml

# 출력 예시:
# Unit Testing:  alert-rules-test.yaml
#   SUCCESS
```

---

## amtool CLI 심화

### alert query: 필터링, 출력 형식

```bash
# 기본: 모든 활성 알림 조회
amtool alert query

# label 기반 필터링 (정확 매칭)
amtool alert query alertname=HighCPU
amtool alert query alertname=HighCPU severity=critical

# 정규식 필터링
amtool alert query -r alertname="High.*"
amtool alert query -r namespace="prod|staging"

# 특정 receiver의 알림만 조회
amtool alert query --receiver='slack-critical'

# 억제(inhibited)된 알림 포함 조회
amtool alert query --inhibited

# silence된 알림 포함 조회
amtool alert query --silenced

# 모든 알림 (억제 + silence 포함)
amtool alert query --inhibited --silenced

# 출력 형식 지정
amtool alert query --output=json        # JSON 형식
amtool alert query --output=simple      # 간단한 형식
amtool alert query --output=extended    # 확장 형식 (annotations 포함)

# AlertManager 주소 지정 (원격 접속)
amtool --alertmanager.url=http://alertmanager:9093 alert query

# 설정 파일로 기본 AlertManager URL 지정
# ~/.config/amtool/config.yml
# alertmanager.url: http://alertmanager:9093
```

### silence add/expire/query/update

```bash
# ── Silence 생성 ──

# 기본 생성 (duration 지정)
amtool silence add alertname="HighCPU" \
  --author="admin@example.com" \
  --comment="계획된 유지보수" \
  --duration="2h"
# 출력: silence-id-xxxx (이 ID로 관리)

# 정규식 매칭 Silence
amtool silence add alertname=~"Pod.*" namespace="dev" \
  --author="dev-team" \
  --comment="개발 환경 테스트" \
  --duration="30m"

# 절대 시각 지정
amtool silence add alertname="HighCPU" \
  --author="admin" \
  --comment="야간 배치" \
  --start="2024-01-15T22:00:00+09:00" \
  --end="2024-01-16T06:00:00+09:00"

# ── Silence 조회 ──

# 활성 Silence 목록
amtool silence query

# 만료 포함 전체 조회
amtool silence query --expired

# 특정 label로 필터링
amtool silence query alertname="HighCPU"

# ID만 출력 (스크립팅용)
amtool silence query -q

# ── Silence 만료 ──

# 특정 Silence 만료
amtool silence expire <silence-id>

# 모든 활성 Silence 만료
amtool silence expire $(amtool silence query -q)

# ── Silence 업데이트 ──

# duration 연장
amtool silence update <silence-id> --duration="4h"

# comment 변경
amtool silence update <silence-id> --comment="연장: 배포 지연으로 인해"
```

### check-config: 설정 파일 검증

```bash
# alertmanager.yml 검증
amtool check-config alertmanager.yml

# 성공 출력 예시:
# Checking 'alertmanager.yml'  SUCCESS
# Found:
#  - global config
#  - route
#  - 0 inhibit rules
#  - 3 receivers
#  - 1 templates

# 실패 출력 예시:
# Checking 'alertmanager.yml'  FAILED
# yaml: line 15: did not find expected key
# 또는
# no route provided in config

# 여러 파일 동시 검증
amtool check-config alertmanager.yml alertmanager-backup.yml
```

### config routes test: 라우팅 테스트

```bash
# 특정 label set이 어떤 receiver로 라우팅되는지 테스트
amtool config routes test-routing --config.file=alertmanager.yml \
  alertname=HighCPU severity=critical namespace=prod

# 라우팅 트리 시각화
amtool config routes show --config.file=alertmanager.yml

# Kubernetes 환경에서 사용
kubectl exec -n monitoring deploy/alertmanager -- \
  amtool config routes show

kubectl exec -n monitoring deploy/alertmanager -- \
  amtool config routes test-routing \
  alertname=NodeDown severity=critical
```

### template render: 템플릿 미리보기

AlertManager 0.24.0 이상에서는 `amtool template render` 명령으로 템플릿을 미리 렌더링할 수 있다. 설정이 제한적이므로, 실무에서는 AlertManager의 `/-/healthy` 엔드포인트와 별도의 테스트 도구를 조합하여 템플릿을 검증하는 방법이 일반적이다.

```bash
# 간단한 템플릿 렌더링 테스트
amtool template render --template.glob='/etc/alertmanager/templates/*.tmpl' \
  --template.text='{{ define "test" }}Hello {{ .CommonLabels.alertname }}{{ end }}'

# 실무에서 권장하는 템플릿 테스트 방법:
# 1. AlertManager 설정에 테스트 webhook receiver 추가
# 2. API로 테스트 알림 전송
# 3. webhook 수신 내용으로 템플릿 결과 확인

# 테스트 알림 전송 (API 직접 호출)
curl -X POST http://localhost:9093/api/v2/alerts \
  -H "Content-Type: application/json" \
  -d '[
    {
      "labels": {
        "alertname": "TestAlert",
        "severity": "warning",
        "namespace": "test"
      },
      "annotations": {
        "summary": "테스트 알림이다",
        "description": "템플릿 렌더링을 테스트한다"
      },
      "generatorURL": "http://prometheus:9090/graph"
    }
  ]'
```

---

## 트러블슈팅

### 알림이 발송되지 않는 경우 진단

알림이 발송되지 않는 문제는 가장 빈번하게 발생하는 이슈이다. 단계별로 진단한다.

**1단계: Prometheus에서 알림이 생성되는지 확인**

```bash
# Prometheus의 알림 상태 확인
curl http://localhost:9090/api/v1/alerts | jq '.data.alerts[] | {alertname: .labels.alertname, state: .state}'

# Prometheus UI에서 확인: http://localhost:9090/alerts
# 알림이 "Inactive" 상태이면 expr 조건이 충족되지 않은 것이다
# 알림이 "Pending" 상태이면 for 기간이 아직 경과하지 않은 것이다
# 알림이 "Firing" 상태이면 AlertManager로 전송되고 있는 것이다
```

**2단계: AlertManager가 알림을 수신했는지 확인**

```bash
# AlertManager의 현재 알림 목록
curl http://localhost:9093/api/v2/alerts | jq '.[].labels.alertname'

# amtool로 확인
amtool alert query

# AlertManager 로그 확인 (알림 수신 로그)
kubectl logs -n monitoring deploy/alertmanager | grep "Received alert"
```

**3단계: 라우팅 경로 확인**

```bash
# 해당 알림이 어떤 receiver로 라우팅되는지 테스트
amtool config routes test-routing \
  alertname=<알림이름> severity=<심각도> namespace=<네임스페이스>

# 의도하지 않은 receiver로 라우팅되고 있을 수 있다
```

**4단계: Inhibition/Silence 확인**

```bash
# 억제된 알림 확인
amtool alert query --inhibited

# silence된 알림 확인
amtool alert query --silenced

# 활성 Silence 목록
amtool silence query
```

**5단계: Receiver 설정 확인**

```bash
# AlertManager 로그에서 전송 오류 확인
kubectl logs -n monitoring deploy/alertmanager | grep -i "error\|fail\|notify"

# 일반적인 오류 원인:
# - Slack webhook URL 만료 또는 잘못됨
# - PagerDuty integration key 오류
# - SMTP 인증 실패
# - Webhook 대상 서버 응답 없음
# - TLS 인증서 문제
```

### 알림이 중복 발송되는 경우

```
진단 체크리스트:

1. HA 클러스터 동기화 문제
   - Gossip 프로토콜이 정상 동작하는지 확인
   - kubectl logs에서 "memberlist" 관련 오류 확인
   - 모든 인스턴스가 서로를 피어로 인식하는지 확인:
     curl http://alertmanager:9093/api/v2/status | jq '.cluster'

2. continue: true 설정 확인
   - 라우팅 트리에서 의도치 않은 continue: true가 있는지 확인
   - 동일 알림이 여러 receiver에 매칭되지 않는지 확인

3. group_by 설정 확인
   - group_by가 너무 세분화되어 있으면 동일 문제가 여러 그룹으로
     분리되어 각각 전송될 수 있다

4. Prometheus 설정 확인
   - 동일한 알림 규칙이 여러 rule group에 중복 정의되어 있는지 확인
   - 여러 Prometheus 인스턴스가 동일한 규칙을 평가하고 있는지 확인
     (HA Prometheus에서는 정상 동작이며, AlertManager 클러스터가
      중복을 제거해야 한다)
```

### Silence가 적용되지 않는 경우

```
진단 체크리스트:

1. Label Matcher 확인
   - Silence의 matcher가 알림의 label과 정확히 일치하는지 확인
   - 대소문자 구분에 주의 (label 값은 대소문자를 구분한다)
   - 정규식 matcher의 경우 전체 문자열 매칭인지 확인
     (=~ "prod"는 "production"에도 매칭됨, =~ "^prod$"는 정확히 "prod"만)

2. Silence 시간 범위 확인
   - Silence의 startsAt/endsAt이 현재 시각을 포함하는지 확인
   - 시간대(timezone) 설정 확인

3. Silence 상태 확인
   amtool silence query
   # "expired" 상태가 아닌지 확인

4. HA 환경에서 Gossip 전파 지연
   - Silence가 모든 인스턴스에 전파되었는지 확인
   - 각 인스턴스에서 개별적으로 Silence 조회:
     curl http://alertmanager-0:9093/api/v2/silences
     curl http://alertmanager-1:9093/api/v2/silences
```

### 그룹핑이 기대와 다른 경우

```
진단 체크리스트:

1. group_by 설정 확인
   - 해당 route의 group_by에 어떤 label이 지정되어 있는지 확인
   - 자식 route가 부모의 group_by를 상속받을 수 있음에 주의

2. 알림의 실제 label 확인
   - group_by에 지정된 label이 알림에 실제로 존재하는지 확인
   - label이 없으면 빈 문자열로 취급되어 의도치 않은 그룹핑이 발생할 수 있다

3. group_by: ['...'] vs group_by: [] 차이 이해
   - ['...'] = 모든 label로 그룹핑 (사실상 개별 전송)
   - [] = 그룹핑 없음 (모든 알림이 하나의 그룹)
   - 의도에 맞는 설정인지 확인

4. 테스트 방법
   amtool config routes test-routing \
     alertname=HighCPU severity=critical namespace=prod
   # 출력된 receiver가 예상과 일치하는지 확인
```

### Webhook 전송 실패 디버깅

```bash
# 1. AlertManager 로그에서 webhook 오류 확인
kubectl logs -n monitoring deploy/alertmanager | grep -i "webhook\|notify.*error"

# 일반적인 오류 메시지와 원인:
# "context deadline exceeded" → 대상 서버 응답 시간 초과
# "connection refused" → 대상 서버가 실행 중이 아님
# "certificate verify failed" → TLS 인증서 문제
# "401 Unauthorized" → 인증 토큰 만료 또는 오류
# "403 Forbidden" → 권한 부족
# "404 Not Found" → URL 경로 오류
# "500 Internal Server Error" → 대상 서버 내부 오류

# 2. 대상 서버 연결 테스트
kubectl exec -n monitoring deploy/alertmanager -- \
  wget -qO- --timeout=5 http://webhook-target:5001/health

# 3. 수동 Webhook 전송 테스트
curl -X POST http://webhook-target:5001/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "status": "firing",
    "alerts": [{
      "labels": {"alertname": "test"},
      "annotations": {"summary": "test alert"}
    }]
  }'

# 4. DNS 해석 확인
kubectl exec -n monitoring deploy/alertmanager -- nslookup webhook-target

# 5. Network Policy 확인 (Kubernetes)
kubectl get networkpolicy -n monitoring
```

### HA 클러스터 동기화 문제

```bash
# 1. 클러스터 상태 확인
curl http://alertmanager:9093/api/v2/status | jq '.cluster'
# peers 목록에 모든 인스턴스가 포함되어 있는지 확인

# 2. 각 인스턴스의 클러스터 멤버 확인
for i in 0 1 2; do
  echo "=== alertmanager-$i ==="
  curl -s http://alertmanager-$i.alertmanager-headless:9093/api/v2/status | \
    jq '.cluster.peers | length'
done
# 모든 인스턴스에서 동일한 피어 수가 출력되어야 한다

# 3. Gossip 포트 연결 확인
kubectl exec alertmanager-0 -n monitoring -- \
  nc -zv alertmanager-1.alertmanager-headless 9094

# 4. 로그에서 Gossip 관련 오류 확인
kubectl logs alertmanager-0 -n monitoring | grep -i "memberlist\|gossip\|cluster"

# 5. 일반적인 문제와 해결법:
# - "Failed to join cluster": --cluster.peer 주소가 올바른지 확인
# - "Failed to send gossip": 9094 포트가 열려 있는지 확인
# - "Notification already sent": 정상 동작 (중복 방지 로그)
# - Silence가 일부 인스턴스에 없음: Gossip 네트워크 파티션 의심,
#   모든 인스턴스 간 9094 포트 통신 확인
```

---

