# Day 6: 예제, 자가 점검, 참고문헌

종합 트래픽 모니터링 스크립트, 네트워크 정책 디버깅, PromQL 쿼리, Grafana 대시보드 JSON 모델, 네트워크 감사 자동화, 이상 트래픽 탐지 스크립트 예제와 자가 점검 문항을 학습한다.

---

## 예제

### 예제 1: 종합 트래픽 모니터링 스크립트

```bash
#!/bin/bash
# traffic-monitor.sh - 네임스페이스별 트래픽 현황을 출력한다

NAMESPACE=${1:-"demo"}
COUNT=${2:-10}

echo "=== $NAMESPACE 트래픽 현황 ==="
echo ""

echo "--- 허용된 트래픽 (최근 ${COUNT}건) ---"
hubble observe --namespace "$NAMESPACE" --verdict FORWARDED --last "$COUNT"

echo ""
echo "--- 차단된 트래픽 (최근 ${COUNT}건) ---"
hubble observe --namespace "$NAMESPACE" --verdict DROPPED --last "$COUNT"

echo ""
echo "--- HTTP 요청 (최근 ${COUNT}건) ---"
hubble observe --namespace "$NAMESPACE" --protocol http --last "$COUNT"

echo ""
echo "--- DNS 쿼리 (최근 ${COUNT}건) ---"
hubble observe --namespace "$NAMESPACE" --protocol dns --last "$COUNT"

echo ""
echo "--- 통신 대상 요약 ---"
hubble observe --namespace "$NAMESPACE" --output json --last 500 \
  | jq -r '.flow | "\(.source.pod_name // .IP.source) -> \(.destination.pod_name // .IP.destination)"' \
  | sort | uniq -c | sort -rn | head -20
```

### 예제 2: 네트워크 정책 디버깅

```bash
#!/bin/bash
# debug-network-policy.sh - 네트워크 정책 문제를 진단한다

NAMESPACE=${1:-"default"}

echo "=== 차단된 트래픽 분석 ($NAMESPACE) ==="
hubble observe --namespace "$NAMESPACE" --verdict DROPPED --last 20 -o compact

echo ""
echo "=== Drop Reason 분류 ==="
hubble observe --namespace "$NAMESPACE" --verdict DROPPED --output json --last 100 \
  | jq -r '.flow.drop_reason_desc // "UNKNOWN"' | sort | uniq -c | sort -rn

echo ""
echo "=== 차단된 트래픽 상세 (source -> destination) ==="
hubble observe --namespace "$NAMESPACE" --verdict DROPPED --output json --last 50 \
  | jq -r '.flow | "\(.source.labels // [] | join(",")) -> \(.destination.labels // [] | join(",")) | port: \(.l4.TCP.destination_port // .l4.UDP.destination_port // "N/A") | reason: \(.drop_reason_desc // "N/A")"'

echo ""
echo "=== 현재 적용된 네트워크 정책 ==="
kubectl get cnp -n "$NAMESPACE"
kubectl get ccnp

echo ""
echo "=== Cilium Endpoint 상태 ==="
kubectl -n kube-system exec -it ds/cilium -- cilium endpoint list
```

### 예제 3: Hubble 메트릭 기반 Grafana 대시보드용 PromQL 쿼리

```promql
# 초당 Flow 처리량 (verdict별)
rate(hubble_flows_processed_total[5m])

# 초당 Drop된 패킷 수 (reason별)
sum by (reason) (rate(hubble_drop_total[5m]))

# DNS 쿼리 에러율
sum(rate(hubble_dns_queries_total{rcode!="No Error"}[5m])) /
sum(rate(hubble_dns_queries_total[5m])) * 100

# HTTP 5xx 에러율 (서비스별)
sum by (destination) (rate(hubble_http_responses_total{status=~"5.."}[5m])) /
sum by (destination) (rate(hubble_http_responses_total[5m])) * 100

# HTTP 요청 P99 레이턴시
histogram_quantile(0.99, rate(hubble_http_request_duration_seconds_bucket[5m]))

# TCP RST 비율 (연결 문제 탐지)
rate(hubble_tcp_flags_total{flag="RST"}[5m])
```

### 예제 4: Grafana Hubble 대시보드 JSON 모델

다음은 Grafana에 import할 수 있는 Hubble 네트워크 가시성 대시보드의 JSON 모델이다. Grafana UI에서 Import > "Import via panel json"으로 입력한다.

```json
{
  "dashboard": {
    "title": "Hubble Network Observability",
    "uid": "hubble-network-observability",
    "timezone": "browser",
    "refresh": "30s",
    "time": { "from": "now-1h", "to": "now" },
    "panels": [
      {
        "title": "Flow Rate by Verdict",
        "type": "timeseries",
        "gridPos": { "x": 0, "y": 0, "w": 12, "h": 8 },
        "targets": [
          {
            "expr": "sum by (verdict) (rate(hubble_flows_processed_total[5m]))",
            "legendFormat": "{{ verdict }}"
          }
        ],
        "fieldConfig": {
          "overrides": [
            { "matcher": { "id": "byName", "options": "FORWARDED" }, "properties": [{ "id": "color", "value": { "fixedColor": "green", "mode": "fixed" } }] },
            { "matcher": { "id": "byName", "options": "DROPPED" }, "properties": [{ "id": "color", "value": { "fixedColor": "red", "mode": "fixed" } }] }
          ]
        }
      },
      {
        "title": "Drop Rate by Reason",
        "type": "timeseries",
        "gridPos": { "x": 12, "y": 0, "w": 12, "h": 8 },
        "targets": [
          {
            "expr": "topk(10, sum by (reason) (rate(hubble_drop_total[5m])))",
            "legendFormat": "{{ reason }}"
          }
        ]
      },
      {
        "title": "DNS Query Rate by Response Code",
        "type": "timeseries",
        "gridPos": { "x": 0, "y": 8, "w": 12, "h": 8 },
        "targets": [
          {
            "expr": "sum by (rcode) (rate(hubble_dns_queries_total[5m]))",
            "legendFormat": "{{ rcode }}"
          }
        ]
      },
      {
        "title": "DNS Error Rate (%)",
        "type": "stat",
        "gridPos": { "x": 12, "y": 8, "w": 6, "h": 4 },
        "targets": [
          {
            "expr": "(sum(rate(hubble_dns_queries_total{rcode!=\"No Error\"}[5m])) / sum(rate(hubble_dns_queries_total[5m]))) * 100"
          }
        ],
        "fieldConfig": {
          "defaults": { "unit": "percent", "thresholds": { "steps": [
            { "value": 0, "color": "green" },
            { "value": 5, "color": "yellow" },
            { "value": 10, "color": "red" }
          ]}}
        }
      },
      {
        "title": "HTTP Request Rate by Method",
        "type": "timeseries",
        "gridPos": { "x": 0, "y": 16, "w": 12, "h": 8 },
        "targets": [
          {
            "expr": "sum by (method) (rate(hubble_http_requests_total[5m]))",
            "legendFormat": "{{ method }}"
          }
        ]
      },
      {
        "title": "HTTP Response Rate by Status",
        "type": "timeseries",
        "gridPos": { "x": 12, "y": 16, "w": 12, "h": 8 },
        "targets": [
          {
            "expr": "sum by (status) (rate(hubble_http_responses_total[5m]))",
            "legendFormat": "{{ status }}"
          }
        ]
      },
      {
        "title": "HTTP Latency Percentiles",
        "type": "timeseries",
        "gridPos": { "x": 0, "y": 24, "w": 12, "h": 8 },
        "targets": [
          {
            "expr": "histogram_quantile(0.50, sum by (le) (rate(hubble_http_request_duration_seconds_bucket[5m])))",
            "legendFormat": "P50"
          },
          {
            "expr": "histogram_quantile(0.95, sum by (le) (rate(hubble_http_request_duration_seconds_bucket[5m])))",
            "legendFormat": "P95"
          },
          {
            "expr": "histogram_quantile(0.99, sum by (le) (rate(hubble_http_request_duration_seconds_bucket[5m])))",
            "legendFormat": "P99"
          }
        ],
        "fieldConfig": { "defaults": { "unit": "s" } }
      },
      {
        "title": "TCP Flags Distribution",
        "type": "timeseries",
        "gridPos": { "x": 12, "y": 24, "w": 12, "h": 8 },
        "targets": [
          {
            "expr": "sum by (flag) (rate(hubble_tcp_flags_total[5m]))",
            "legendFormat": "{{ flag }}"
          }
        ]
      },
      {
        "title": "Top 10 Drop Reasons (Table)",
        "type": "table",
        "gridPos": { "x": 0, "y": 32, "w": 12, "h": 8 },
        "targets": [
          {
            "expr": "topk(10, sum by (reason, protocol) (increase(hubble_drop_total[1h])))",
            "format": "table",
            "instant": true
          }
        ]
      },
      {
        "title": "Port Distribution (Top 20)",
        "type": "barchart",
        "gridPos": { "x": 12, "y": 32, "w": 12, "h": 8 },
        "targets": [
          {
            "expr": "topk(20, sum by (port) (rate(hubble_port_distribution_total[5m])))",
            "legendFormat": "port {{ port }}"
          }
        ]
      }
    ]
  }
}
```

### 예제 5: 네트워크 감사 자동화 스크립트

```bash
#!/bin/bash
# hubble-security-audit.sh - 자동화된 네트워크 보안 감사 스크립트
# 사용법: ./hubble-security-audit.sh [namespace] [flow_count]

set -euo pipefail

NAMESPACE=${1:-"demo"}
FLOW_COUNT=${2:-5000}
REPORT_DIR="/tmp/hubble-audit"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
REPORT_FILE="${REPORT_DIR}/audit_${NAMESPACE}_${TIMESTAMP}.txt"

mkdir -p "$REPORT_DIR"

log() {
    echo "[$(date '+%H:%M:%S')] $1" | tee -a "$REPORT_FILE"
}

separator() {
    echo "" | tee -a "$REPORT_FILE"
    echo "================================================================" | tee -a "$REPORT_FILE"
}

# 헤더
log "=== Hubble 네트워크 보안 감사 보고서 ==="
log "Namespace: $NAMESPACE"
log "Flow Count: $FLOW_COUNT"
log "생성 시각: $(date)"
separator

# 1. Hubble 상태 확인
log "--- 1. Hubble 상태 ---"
hubble status 2>&1 | tee -a "$REPORT_FILE" || log "WARNING: hubble status 실패"
separator

# 2. Verdict 분포
log "--- 2. Verdict 분포 ---"
hubble observe --namespace "$NAMESPACE" -o json --last "$FLOW_COUNT" \
  | jq -r '.flow.verdict' | sort | uniq -c | sort -rn | tee -a "$REPORT_FILE"
separator

# 3. Drop Reason 분석
log "--- 3. Drop Reason 상세 ---"
hubble observe --namespace "$NAMESPACE" --verdict DROPPED -o json --last "$FLOW_COUNT" \
  | jq -r '.flow.drop_reason_desc // "UNKNOWN"' | sort | uniq -c | sort -rn | tee -a "$REPORT_FILE"
separator

# 4. 외부(world) 통신 현황
log "--- 4. 외부 통신 (world identity) ---"
hubble observe --namespace "$NAMESPACE" --to-identity world -o json --last "$FLOW_COUNT" \
  | jq -r '.flow | "\(.source.pod_name // "unknown") → \(.IP.destination):\(.l4.TCP.destination_port // .l4.UDP.destination_port // "N/A") [\(.verdict)]"' \
  | sort | uniq -c | sort -rn | head -20 | tee -a "$REPORT_FILE"
separator

# 5. Cross-Namespace 통신
log "--- 5. Cross-Namespace 통신 ---"
hubble observe --namespace "$NAMESPACE" -o json --last "$FLOW_COUNT" \
  | jq -r 'select(.flow.source.namespace != .flow.destination.namespace and .flow.destination.namespace != null) |
    "\(.flow.source.namespace)/\(.flow.source.pod_name // "?") → \(.flow.destination.namespace)/\(.flow.destination.pod_name // "?")"' \
  | sort | uniq -c | sort -rn | head -20 | tee -a "$REPORT_FILE"
separator

# 6. API 서버 접근 시도
log "--- 6. API 서버(6443) 접근 ---"
hubble observe --namespace "$NAMESPACE" --to-port 6443 -o json --last "$FLOW_COUNT" \
  | jq -r '.flow | "\(.source.pod_name // "unknown") [\(.verdict)]"' \
  | sort | uniq -c | sort -rn | tee -a "$REPORT_FILE"
separator

# 7. 비표준 포트 외부 통신 (80/443/53 이외)
log "--- 7. 비표준 포트 외부 통신 ---"
hubble observe --namespace "$NAMESPACE" --to-identity world -o json --last "$FLOW_COUNT" \
  | jq -r 'select(
    (.flow.l4.TCP.destination_port // 0) != 443 and
    (.flow.l4.TCP.destination_port // 0) != 80 and
    (.flow.l4.UDP.destination_port // 0) != 53 and
    ((.flow.l4.TCP.destination_port // .flow.l4.UDP.destination_port // 0) != 0)
  ) | .flow | "\(.source.pod_name // "unknown") → \(.IP.destination):\(.l4.TCP.destination_port // .l4.UDP.destination_port)"' \
  | sort | uniq -c | sort -rn | head -20 | tee -a "$REPORT_FILE"
separator

# 8. 현재 적용된 네트워크 정책
log "--- 8. 적용된 CiliumNetworkPolicy ---"
kubectl get cnp -n "$NAMESPACE" -o wide 2>&1 | tee -a "$REPORT_FILE"
separator

# 9. DNS 에러 (NXDOMAIN, SERVFAIL 등)
log "--- 9. DNS 에러 응답 ---"
hubble observe --namespace "$NAMESPACE" --protocol dns -o json --last "$FLOW_COUNT" \
  | jq -r 'select(.flow.l7.dns.rcode != null and .flow.l7.dns.rcode != "No Error") |
    .flow | "\(.source.pod_name // "?"): \(.l7.dns.query) → \(.l7.dns.rcode)"' \
  | sort | uniq -c | sort -rn | head -20 | tee -a "$REPORT_FILE"
separator

# 10. 감사 요약
TOTAL_FLOWS=$(hubble observe --namespace "$NAMESPACE" -o json --last "$FLOW_COUNT" | wc -l)
DROPPED_FLOWS=$(hubble observe --namespace "$NAMESPACE" --verdict DROPPED -o json --last "$FLOW_COUNT" | wc -l)
EXTERNAL_FLOWS=$(hubble observe --namespace "$NAMESPACE" --to-identity world -o json --last "$FLOW_COUNT" | wc -l)

log "--- 10. 감사 요약 ---"
log "분석된 총 Flow 수: $TOTAL_FLOWS"
log "차단된 Flow 수: $DROPPED_FLOWS"
log "외부 통신 Flow 수: $EXTERNAL_FLOWS"
if [ "$TOTAL_FLOWS" -gt 0 ]; then
    DROP_RATE=$(echo "scale=2; $DROPPED_FLOWS * 100 / $TOTAL_FLOWS" | bc)
    log "차단 비율: ${DROP_RATE}%"
fi
separator

log "보고서 저장 위치: $REPORT_FILE"
```

### 예제 6: 이상 트래픽 탐지 스크립트

```bash
#!/bin/bash
# hubble-anomaly-detector.sh - 이상 트래픽 패턴을 실시간으로 탐지한다
# 사용법: ./hubble-anomaly-detector.sh [namespace]

set -euo pipefail

NAMESPACE=${1:-""}
NS_FILTER=""
if [ -n "$NAMESPACE" ]; then
    NS_FILTER="--namespace $NAMESPACE"
fi

ALERT_LOG="/tmp/hubble-alerts-$(date +%Y%m%d).log"

alert() {
    local severity=$1
    local message=$2
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo "[$timestamp] [$severity] $message" | tee -a "$ALERT_LOG"
}

echo "=== Hubble 이상 트래픽 탐지 시작 ==="
echo "Alert 로그: $ALERT_LOG"
echo ""

# 탐지 1: metadata 서비스 접근 (SSRF 공격 의심)
echo "[탐지 1] metadata 서비스 접근 감시 시작..."
hubble observe $NS_FILTER --to-ip 169.254.169.254 -o json --follow 2>/dev/null | while read -r line; do
    pod=$(echo "$line" | jq -r '.flow.source.pod_name // "unknown"')
    ns=$(echo "$line" | jq -r '.flow.source.namespace // "unknown"')
    alert "CRITICAL" "metadata 서비스 접근 시도: $ns/$pod → 169.254.169.254"
done &
PID_META=$!

# 탐지 2: 대량 DROP 이벤트 (포트 스캔 의심)
echo "[탐지 2] 대량 DROP 이벤트 감시 시작..."
hubble observe $NS_FILTER --verdict DROPPED -o json --follow 2>/dev/null | \
  jq --unbuffered -r '.flow | "\(.source.namespace)/\(.source.pod_name // "unknown")"' | \
  while read -r src; do
    # 10초 내 같은 source에서 50건 이상 DROP이면 알림
    count=$(grep -c "$src" /tmp/hubble-drop-buffer.tmp 2>/dev/null || echo 0)
    echo "$src" >> /tmp/hubble-drop-buffer.tmp
    if [ "$count" -gt 50 ]; then
        alert "HIGH" "포트 스캔 의심 - $src 에서 대량 DROPPED 이벤트 ($count건)"
        > /tmp/hubble-drop-buffer.tmp  # 버퍼 초기화
    fi
done &
PID_SCAN=$!

# 탐지 3: 비표준 포트 외부 통신
echo "[탐지 3] 비표준 포트 외부 통신 감시 시작..."
hubble observe $NS_FILTER --to-identity world -o json --follow 2>/dev/null | \
  jq --unbuffered -r 'select(
    (.flow.l4.TCP.destination_port // 0) != 443 and
    (.flow.l4.TCP.destination_port // 0) != 80 and
    (.flow.l4.UDP.destination_port // 0) != 53 and
    ((.flow.l4.TCP.destination_port // .flow.l4.UDP.destination_port // 0) > 0)
  ) | "\(.flow.source.namespace // "?")/\(.flow.source.pod_name // "?") → \(.flow.IP.destination):\(.flow.l4.TCP.destination_port // .flow.l4.UDP.destination_port)"' | \
  while read -r line; do
    alert "MEDIUM" "비표준 포트 외부 통신: $line"
done &
PID_PORT=$!

# 탐지 4: 민감 포트 접근 (etcd, kubelet)
echo "[탐지 4] 민감 포트 접근 감시 시작..."
for port in 2379 2380 10250 10251 10252; do
    hubble observe $NS_FILTER --to-port $port -o json --follow 2>/dev/null | \
      jq --unbuffered -r '.flow | "\(.source.namespace // "?")/\(.source.pod_name // "?") → \(.destination.pod_name // .IP.destination):'"$port"'"' | \
      while read -r line; do
        alert "CRITICAL" "민감 포트($port) 접근: $line"
    done &
done

echo ""
echo "모든 탐지 프로세스가 백그라운드에서 실행 중이다."
echo "Ctrl+C로 종료한다."

# cleanup on exit
trap "kill $PID_META $PID_SCAN $PID_PORT 2>/dev/null; exit" INT TERM

wait
```

---

## 자가 점검

### 기본 개념 (기존)

- [ ] Hubble이 eBPF datapath에서 Flow 데이터를 수집하는 과정(ring buffer 메커니즘)을 설명할 수 있는가?
- [ ] hubble-relay가 gRPC streaming으로 모든 노드의 데이터를 집계하는 방식을 설명할 수 있는가?
- [ ] Flow 데이터 구조에 어떤 필드들이 포함되는지 알고 있는가? (identity, labels, IP, port, L7 info)
- [ ] `hubble observe` 명령으로 다양한 필터(--ip, --port, --label, --http-status, --dns-query, --type)를 조합할 수 있는가?
- [ ] DNS 해석 실패 문제를 Hubble로 트러블슈팅할 수 있는가?
- [ ] 네트워크 정책의 효과를 Hubble로 검증하고, drop reason을 분석할 수 있는가?
- [ ] Hubble 메트릭을 Prometheus로 수집하고, 주요 메트릭(hubble_flows_processed_total, hubble_drop_total 등)을 이해하는가?
- [ ] L7 가시성(HTTP, DNS, Kafka)을 활성화하는 방법을 알고 있는가?
- [ ] Hubble UI의 Service Map이 Flow 데이터로부터 어떻게 생성되는지 설명할 수 있는가?
- [ ] Lateral movement 탐지, inter-namespace 트래픽 분석 등 보안 시나리오에 Hubble을 활용할 수 있는가?

### 내부 아키텍처 심화

- [ ] Monitor 컴포넌트의 perf event 수집 파이프라인을 커널/유저 공간 구분하여 설명할 수 있는가?
- [ ] per-CPU perf event ring buffer가 lock-free 구조를 사용하는 이유를 설명할 수 있는가?
- [ ] send_trace_notify(), send_drop_notify(), send_policy_verdict_notify() 등 eBPF notify 함수의 차이를 알고 있는가?
- [ ] Flow 파싱 엔진의 Identity 해석 과정(numeric ID → label set → namespace/pod)을 설명할 수 있는가?
- [ ] IPv4/IPv6 헤더에서 Hubble이 추출하는 필드들을 나열할 수 있는가?
- [ ] TCP 헤더의 flags 필드가 hubble_tcp_flags_total 메트릭과 어떻게 연결되는지 설명할 수 있는가?

### L7 프로토콜 파싱

- [ ] HTTP 파서가 요청/응답을 별도 Flow로 기록하는 이유를 설명할 수 있는가?
- [ ] DNS 파서가 L7 정책 없이도 toFQDNs 규칙만으로 동작하는 이유를 설명할 수 있는가?
- [ ] Kafka 파서가 추출하는 API Key 타입(Produce, Fetch, Metadata 등)의 의미를 알고 있는가?
- [ ] gRPC 요청이 HTTP/2 위에서 파싱되는 구조를 이해하고, grpc-status 헤더의 의미를 알고 있는가?

### Ring Buffer 및 메모리

- [ ] 커널 perf event ring buffer와 유저 공간 in-memory ring buffer의 역할 차이를 설명할 수 있는가?
- [ ] ring buffer 크기(기본 4096)가 Flow 보존 시간에 미치는 영향을 계산할 수 있는가?
- [ ] buffer capacity를 65,536으로 설정했을 때 예상 메모리 사용량을 산출할 수 있는가?
- [ ] hubble_lost_events_total 메트릭이 증가할 때의 대처 방법을 알고 있는가?

### gRPC API

- [ ] GetFlows, GetAgentEvents, GetDebugEvents, ServerStatus RPC의 용도를 각각 설명할 수 있는가?
- [ ] GetFlowsRequest의 whitelist/blacklist 필터가 서버사이드에서 적용되는 방식을 설명할 수 있는가?
- [ ] ServerStatusResponse에서 num_flows, max_flows, seen_flows 필드의 의미를 구분할 수 있는가?

### Flow 데이터 구조

- [ ] Flow 타입(L3_L4, L7, SOCK, TRACE, DROP, POLICY_VERDICT, CAPTURE, DEBUG)의 차이를 설명할 수 있는가?
- [ ] Verdict 중 AUDIT의 용도(점진적 정책 적용)를 설명할 수 있는가?
- [ ] Drop Reason 코드 중 가장 흔한 POLICY_DENIED(5)의 대처 방법을 알고 있는가?
- [ ] Reserved Identity(host=1, world=2, kube-apiserver=7 등)의 의미와 용도를 설명할 수 있는가?
- [ ] TrafficDirection(INGRESS/EGRESS)이 정책 평가와 어떻게 연결되는지 설명할 수 있는가?

### hubble-relay 심화

- [ ] Peer Discovery가 노드 추가/제거를 자동 반영하는 메커니즘을 설명할 수 있는가?
- [ ] Flow Merging의 min-heap 기반 정렬 알고리즘을 이해하고 있는가?
- [ ] hubble-relay와 cilium-agent 간 mTLS를 설정할 수 있는가?
- [ ] 서버사이드 필터링과 클라이언트사이드 필터링의 성능 차이를 설명할 수 있는가?

### Hubble UI 심화

- [ ] Hubble UI의 gRPC-Web → gRPC 변환 아키텍처를 설명할 수 있는가?
- [ ] Service Map의 force-directed layout 알고리즘의 기본 원리를 이해하고 있는가?
- [ ] Flow Table의 실시간 스트리밍이 GetFlows follow 모드를 사용함을 알고 있는가?

### Hubble Metrics 심화

- [ ] 메트릭 핸들러(dns, drop, tcp, flow, http, icmp, port-distribution)를 필요에 따라 선택 설정할 수 있는가?
- [ ] httpV2 핸들러의 labelsContext 옵션과 카디널리티 주의사항을 이해하고 있는가?
- [ ] Grafana 대시보드에서 hubble_drop_total을 reason별로 시각화하는 PromQL을 작성할 수 있는가?
- [ ] HTTP P99 레이턴시를 계산하는 histogram_quantile PromQL 쿼리를 작성할 수 있는가?
- [ ] TCP SYN 대비 RST 비율로 연결 실패율을 추정하는 쿼리를 작성할 수 있는가?

### 트러블슈팅 및 보안

- [ ] Pod 간 통신 실패 시 DROPPED verdict 추적 → drop reason 분석 → 정책 수정의 워크플로우를 수행할 수 있는가?
- [ ] DNS NXDOMAIN 응답을 Hubble로 탐지하고 원인을 진단할 수 있는가?
- [ ] 새로 적용한 CiliumNetworkPolicy를 Hubble로 positive/negative test할 수 있는가?
- [ ] TCP RST 패킷 분석을 통해 비정상 연결 종료의 원인을 추정할 수 있는가?
- [ ] metadata 서비스(169.254.169.254) 접근 시도를 탐지하여 SSRF 공격을 식별할 수 있는가?
- [ ] 비표준 포트 외부 통신을 탐지하여 데이터 유출 가능성을 판단할 수 있는가?
- [ ] DNS 터널링 의심 패턴(비정상적으로 긴 도메인 쿼리)을 탐지할 수 있는가?

### 성능 튜닝

- [ ] Ring buffer 크기를 Flow rate에 기반하여 최적값을 산출할 수 있는가?
- [ ] 메트릭 핸들러 수와 label 카디널리티가 CPU/메모리에 미치는 영향을 이해하고 있는가?
- [ ] L7 visibility 활성화 시 추가 레이턴시와 리소스 소비를 예상할 수 있는가?
- [ ] hubble-relay의 리소스 설정을 클러스터 규모에 맞게 조정할 수 있는가?

### 실습 종합

- [ ] 이 프로젝트의 manifests/network-policies/ 정책들을 Hubble로 검증할 수 있는가?
- [ ] hubble observe의 JSON 출력을 jq로 가공하여 CSV 보고서를 생성할 수 있는가?
- [ ] Hubble 메트릭을 Prometheus에서 조회하고 Grafana 대시보드를 구성할 수 있는가?
- [ ] 네트워크 보안 감사 스크립트를 작성하여 주기적으로 실행할 수 있는가?
- [ ] 이상 트래픽 탐지를 위한 실시간 모니터링 파이프라인을 구축할 수 있는가?

---

## 참고문헌

- [Hubble 공식 문서 - Cilium Docs](https://docs.cilium.io/en/stable/observability/hubble/) - Hubble 설정, 활성화, 트러블슈팅 가이드
- [Hubble GitHub 리포지토리](https://github.com/cilium/hubble) - Hubble CLI 소스 코드 및 릴리스
- [Cilium 공식 문서 - Observability](https://docs.cilium.io/en/stable/observability/) - Cilium 옵저버빌리티 전반
- [Hubble Relay 소스 코드](https://github.com/cilium/cilium/tree/main/pkg/hubble) - cilium-agent 내장 Hubble 구현
- [Hubble UI GitHub 리포지토리](https://github.com/cilium/hubble-ui) - Hubble UI 소스 코드
- [Cilium eBPF Datapath 문서](https://docs.cilium.io/en/stable/network/ebpf/) - eBPF 데이터플레인 아키텍처
- [Hubble Metrics 설정 가이드](https://docs.cilium.io/en/stable/observability/metrics/) - Prometheus 메트릭 export 설정
- [Hubble Flow API (Protocol Buffers)](https://github.com/cilium/cilium/blob/main/api/v1/flow/flow.proto) - Flow 메시지 스키마 정의
- [Cilium L7 Protocol Visibility](https://docs.cilium.io/en/stable/observability/visibility/) - L7 프로토콜 파싱 설정
