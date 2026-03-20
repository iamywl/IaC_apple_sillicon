# Day 3: Hubble Metrics 심화와 hubble observe CLI 심화

Prometheus 메트릭 내보내기 구조, 주요 메트릭 전체 목록, Grafana 대시보드 구성, 커스텀 메트릭 정의, hubble observe의 모든 필터 옵션, 출력 형식, Follow 모드, jq를 이용한 JSON 후처리를 학습한다.

---

## Hubble Metrics 심화

### Prometheus 메트릭 내보내기 구조

Hubble 메트릭 시스템은 Flow 데이터를 실시간으로 분석하여 Prometheus Counter, Histogram 등의 메트릭으로 변환한다.

```
┌──────────────────────────────────────────────────────────┐
│                  cilium-agent                              │
│                                                          │
│  ┌─────────────────────┐                                 │
│  │  Hubble Observer     │                                 │
│  │  (Flow 생성)         │                                 │
│  └──────────┬──────────┘                                 │
│             │ Flow                                        │
│             ▼                                             │
│  ┌─────────────────────┐    ┌─────────────────────┐      │
│  │  Ring Buffer         │    │  Metrics Handler    │      │
│  │  (hubble observe용)  │    │                     │      │
│  └─────────────────────┘    │  Flow → Metric 변환: │      │
│                              │  - dns handler       │      │
│             │ Flow (병렬)    │  - drop handler      │      │
│             └───────────►    │  - flow handler      │      │
│                              │  - http handler      │      │
│                              │  - tcp handler       │      │
│                              │  - icmp handler      │      │
│                              │  - port-distribution │      │
│                              └──────────┬──────────┘      │
│                                         │                  │
│  ┌──────────────────────────────────────▼──────────────┐  │
│  │        Prometheus Registry                           │  │
│  │        HTTP endpoint :9965/metrics                   │  │
│  └──────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
                     │ HTTP scrape
                     ▼
            Prometheus Server
```

**메트릭 핸들러 활성화**: Helm chart의 `hubble.metrics.enabled` 배열에 핸들러 이름을 나열하여 활성화한다. 이 프로젝트에서는 다음 핸들러를 사용한다:

```yaml
# manifests/hubble-values.yaml
hubble:
  metrics:
    enabled:
      - dns
      - drop
      - tcp
      - flow
      - icmp
      - http
```

각 핸들러는 해당 유형의 Flow만 처리하여 메트릭을 생성한다. 핸들러를 많이 활성화할수록 CPU 부하가 증가하므로, 필요한 핸들러만 활성화하는 것이 좋다.

### 주요 메트릭 전체 목록

**Flow 메트릭 (flow handler)**:

| 메트릭 | 타입 | Label | 설명 |
|--------|------|-------|------|
| `hubble_flows_processed_total` | Counter | type, subtype, verdict | 처리된 총 Flow 수이다 |

Label 값 예시:
- `type`: `L3_L4`, `L7`, `Trace`, `Drop`, `PolicyVerdict`
- `subtype`: `to-endpoint`, `to-stack`, `from-endpoint`, `dns-request` 등
- `verdict`: `FORWARDED`, `DROPPED`, `ERROR`, `AUDIT`

**Drop 메트릭 (drop handler)**:

| 메트릭 | 타입 | Label | 설명 |
|--------|------|-------|------|
| `hubble_drop_total` | Counter | reason, protocol | 드롭된 패킷 총 수이다 |
| `hubble_drop_bytes_total` | Counter | reason, protocol | 드롭된 바이트 총 수이다 |

reason label 값: `POLICY_DENIED`, `CT_NO_MAP_FOUND`, `INVALID_SOURCE_IP`, `STALE_OR_UNROUTABLE` 등

**TCP 메트릭 (tcp handler)**:

| 메트릭 | 타입 | Label | 설명 |
|--------|------|-------|------|
| `hubble_tcp_flags_total` | Counter | flag, family | TCP flag별 패킷 수이다 |

flag label 값: `SYN`, `SYN-ACK`, `ACK`, `FIN`, `RST`, `PSH`

**DNS 메트릭 (dns handler)**:

| 메트릭 | 타입 | Label | 설명 |
|--------|------|-------|------|
| `hubble_dns_queries_total` | Counter | rcode, qtypes, ips_returned | DNS 쿼리 총 수이다 |
| `hubble_dns_responses_total` | Counter | rcode, qtypes, ips_returned | DNS 응답 총 수이다 |
| `hubble_dns_response_types_total` | Counter | type, qtypes | DNS 응답 타입별 카운트이다 |

rcode label 값: `No Error`, `Format Error`, `Server Failure`, `Non-Existent Domain`, `Refused`

**HTTP 메트릭 (http handler)**:

| 메트릭 | 타입 | Label | 설명 |
|--------|------|-------|------|
| `hubble_http_requests_total` | Counter | method, protocol, reporter | HTTP 요청 총 수이다 |
| `hubble_http_responses_total` | Counter | method, status, reporter | HTTP 응답 총 수이다 |
| `hubble_http_request_duration_seconds` | Histogram | method, reporter | HTTP 요청 처리 시간 분포이다 |

httpV2 handler를 사용하면 추가 label context를 지정할 수 있다:
```yaml
httpV2:exemplars=true;labelsContext=source_ip,source_namespace,source_workload,destination_ip,destination_namespace,destination_workload
```

**ICMP 메트릭 (icmp handler)**:

| 메트릭 | 타입 | Label | 설명 |
|--------|------|-------|------|
| `hubble_icmp_total` | Counter | family, type | ICMP 메시지 총 수이다 |

**Port Distribution 메트릭 (port-distribution handler)**:

| 메트릭 | 타입 | Label | 설명 |
|--------|------|-------|------|
| `hubble_port_distribution_total` | Counter | port, protocol | 포트별 트래픽 분포이다 |

### Grafana 대시보드: 네트워크 가시성 대시보드 구성

Grafana 대시보드는 Hubble 메트릭을 시각적으로 표현하여 네트워크 상태를 한눈에 파악할 수 있게 해준다.

**권장 대시보드 패널 구성**:

```
┌───────────────────────────────────────────────────────────────┐
│  Hubble Network Observability Dashboard                       │
│                                                               │
│  ┌─────────────────────────────┬─────────────────────────────┐│
│  │  Flow Rate (flows/sec)      │  Drop Rate (drops/sec)      ││
│  │  [시계열 그래프]              │  [시계열 그래프, reason별]    ││
│  │  verdict별 색상 구분          │  빨간색 강조                 ││
│  └─────────────────────────────┴─────────────────────────────┘│
│  ┌─────────────────────────────┬─────────────────────────────┐│
│  │  DNS Query Rate             │  DNS Error Rate             ││
│  │  [시계열 그래프]              │  [시계열 그래프]              ││
│  │  rcode별 구분                │  Non-NOERROR 비율            ││
│  └─────────────────────────────┴─────────────────────────────┘│
│  ┌─────────────────────────────┬─────────────────────────────┐│
│  │  HTTP Request Rate          │  HTTP Error Rate (4xx/5xx)  ││
│  │  [시계열 그래프]              │  [시계열 그래프]              ││
│  │  method별 구분               │  status 코드별 구분          ││
│  └─────────────────────────────┴─────────────────────────────┘│
│  ┌─────────────────────────────┬─────────────────────────────┐│
│  │  HTTP Latency P50/P95/P99   │  TCP Flags Distribution     ││
│  │  [시계열 그래프]              │  [stacked bar chart]        ││
│  │  백분위수별 라인              │  SYN/FIN/RST 비율           ││
│  └─────────────────────────────┴─────────────────────────────┘│
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  Top Drop Reasons (table)                                │ │
│  │  [테이블] reason | count | protocol                      │ │
│  └──────────────────────────────────────────────────────────┘ │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  Port Distribution (top 20)                              │ │
│  │  [bar chart] port별 트래픽 양                              │ │
│  └──────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────┘
```

**주요 PromQL 쿼리 (대시보드 패널별)**:

```promql
# 1. 초당 Flow 처리율 (verdict별)
sum by (verdict) (rate(hubble_flows_processed_total[5m]))

# 2. 초당 Drop율 (reason별, top 10)
topk(10, sum by (reason) (rate(hubble_drop_total[5m])))

# 3. DNS 쿼리율 (rcode별)
sum by (rcode) (rate(hubble_dns_queries_total[5m]))

# 4. DNS 에러 비율 (%)
(
  sum(rate(hubble_dns_queries_total{rcode!="No Error"}[5m]))
  /
  sum(rate(hubble_dns_queries_total[5m]))
) * 100

# 5. HTTP 요청율 (method별)
sum by (method) (rate(hubble_http_requests_total[5m]))

# 6. HTTP 5xx 에러율 (%)
(
  sum(rate(hubble_http_responses_total{status=~"5.."}[5m]))
  /
  sum(rate(hubble_http_responses_total[5m]))
) * 100

# 7. HTTP 레이턴시 P50
histogram_quantile(0.50, sum by (le) (rate(hubble_http_request_duration_seconds_bucket[5m])))

# 8. HTTP 레이턴시 P95
histogram_quantile(0.95, sum by (le) (rate(hubble_http_request_duration_seconds_bucket[5m])))

# 9. HTTP 레이턴시 P99
histogram_quantile(0.99, sum by (le) (rate(hubble_http_request_duration_seconds_bucket[5m])))

# 10. TCP RST 비율
rate(hubble_tcp_flags_total{flag="RST"}[5m])

# 11. TCP SYN 대비 RST 비율 (연결 실패율 추정)
(
  rate(hubble_tcp_flags_total{flag="RST"}[5m])
  /
  rate(hubble_tcp_flags_total{flag="SYN"}[5m])
) * 100

# 12. ICMP 메시지율 (type별)
sum by (type) (rate(hubble_icmp_total[5m]))

# 13. 포트별 트래픽 분포 (top 10)
topk(10, sum by (port) (rate(hubble_port_distribution_total[5m])))
```

### 커스텀 메트릭 정의

httpV2 핸들러를 사용하면 다양한 label context를 추가하여 더 세밀한 메트릭을 생성할 수 있다.

**labelsContext 옵션**:

| Label Context | 설명 | 사용 예 |
|--------------|------|--------|
| `source_ip` | 출발지 IP | IP 기반 트래픽 분석 |
| `source_namespace` | 출발지 namespace | namespace별 HTTP 트래픽 |
| `source_workload` | 출발지 workload 이름 | Deployment별 요청 수 |
| `source_workload_kind` | 출발지 workload 종류 | Deployment/DaemonSet 구분 |
| `source_pod` | 출발지 Pod 이름 | Pod 단위 분석 (카디널리티 주의) |
| `destination_ip` | 도착지 IP | - |
| `destination_namespace` | 도착지 namespace | - |
| `destination_workload` | 도착지 workload 이름 | - |
| `destination_workload_kind` | 도착지 workload 종류 | - |
| `destination_pod` | 도착지 Pod 이름 | - |

**카디널리티 주의사항**: `source_pod`이나 `destination_pod`을 label context로 추가하면, Pod 수에 비례하여 시계열 수가 폭증한다. 예를 들어, 100개의 source Pod와 50개의 destination Pod가 있으면 최대 5,000개의 시계열이 생성될 수 있다. `source_workload` / `destination_workload` 수준에서 관리하는 것이 안전하다.

**고급 설정 예시**:
```yaml
hubble:
  metrics:
    enabled:
      - dns:query;ignoreAAAA
      - drop:sourceContext=pod;destinationContext=pod
      - tcp
      - flow:sourceContext=workload;destinationContext=workload
      - icmp
      - httpV2:exemplars=true;labelsContext=source_namespace,source_workload,destination_namespace,destination_workload
    enableOpenMetrics: true  # OpenMetrics 형식 활성화
```

---

## hubble observe CLI 심화

### 모든 필터 옵션 레퍼런스

`hubble observe` 명령은 다양한 필터 옵션을 제공한다. 전체 옵션을 카테고리별로 정리한다.

**Namespace / Pod / Label / Service 필터**:

| 옵션 | 설명 | 예시 |
|------|------|------|
| `--namespace` | namespace 필터 (양방향) | `--namespace demo` |
| `--from-namespace` | 출발지 namespace | `--from-namespace frontend` |
| `--to-namespace` | 도착지 namespace | `--to-namespace backend` |
| `--pod` | Pod 이름 필터 (양방향) | `--pod demo/nginx-web` |
| `--from-pod` | 출발지 Pod | `--from-pod demo/frontend-abc123` |
| `--to-pod` | 도착지 Pod | `--to-pod demo/backend-def456` |
| `--label` | label 필터 (양방향) | `--label "app=nginx"` |
| `--from-label` | 출발지 label | `--from-label "app=frontend"` |
| `--to-label` | 도착지 label | `--to-label "app=backend,version=v2"` |
| `--service` | Service 이름 필터 (양방향) | `--service demo/nginx-svc` |
| `--from-service` | 출발지 Service | `--from-service demo/frontend-svc` |
| `--to-service` | 도착지 Service | `--to-service demo/backend-svc` |
| `--workload` | Workload 이름 필터 (양방향) | `--workload demo/nginx` |
| `--from-workload` | 출발지 Workload | `--from-workload demo/frontend` |
| `--to-workload` | 도착지 Workload | `--to-workload demo/backend` |

**IP / CIDR 필터**:

| 옵션 | 설명 | 예시 |
|------|------|------|
| `--ip` | IP 주소 필터 (양방향) | `--ip 10.0.1.5` |
| `--from-ip` | 출발지 IP | `--from-ip 10.0.0.0/16` |
| `--to-ip` | 도착지 IP | `--to-ip 172.16.0.100` |
| `--ip-version` | IP 버전 필터 | `--ip-version 4` 또는 `--ip-version 6` |

**프로토콜 / 포트 필터**:

| 옵션 | 설명 | 예시 |
|------|------|------|
| `--protocol` | L4/L7 프로토콜 | `--protocol tcp`, `--protocol http`, `--protocol dns` |
| `--port` | 포트 번호 (양방향) | `--port 443` |
| `--from-port` | 출발지 포트 | `--from-port 5432` |
| `--to-port` | 도착지 포트 | `--to-port 80` |

**이벤트 타입 / Verdict 필터**:

| 옵션 | 설명 | 예시 |
|------|------|------|
| `--type` | 이벤트 타입 | `--type l7`, `--type drop`, `--type trace`, `--type policy-verdict` |
| `--verdict` | verdict 필터 | `--verdict FORWARDED`, `--verdict DROPPED`, `--verdict AUDIT` |
| `--traffic-direction` | 트래픽 방향 | `--traffic-direction ingress`, `--traffic-direction egress` |

**L7 세부 필터**:

| 옵션 | 설명 | 예시 |
|------|------|------|
| `--http-method` | HTTP 메서드 | `--http-method GET`, `--http-method POST` |
| `--http-path` | HTTP URL 경로 (정규식) | `--http-path "/api/v1/.*"` |
| `--http-status` | HTTP 상태 코드 | `--http-status 200`, `--http-status "5+"` (5xx 전체) |
| `--http-url` | HTTP URL (전체) | `--http-url "/health"` |
| `--dns-query` | DNS 쿼리 도메인 | `--dns-query "kubernetes.default"` |

**Identity / Node 필터**:

| 옵션 | 설명 | 예시 |
|------|------|------|
| `--identity` | Cilium identity 번호 | `--identity 12345` |
| `--from-identity` | 출발지 identity | `--from-identity 1` (host) |
| `--to-identity` | 도착지 identity | `--to-identity 2` (world) |
| `--node-name` | 노드 이름 필터 | `--node-name worker-1` |
| `--from-all` | 모든 출발지 허용 | `--from-all` |
| `--to-all` | 모든 도착지 허용 | `--to-all` |

**시간 / 수량 제어**:

| 옵션 | 설명 | 예시 |
|------|------|------|
| `--last` | 최근 N개 Flow만 조회 | `--last 100` |
| `--first` | 가장 오래된 N개 Flow 조회 | `--first 50` |
| `--follow` (`-f`) | 실시간 스트리밍 모드 | `--follow` |
| `--since` | 특정 시간 이후 | `--since "2025-01-01T00:00:00Z"`, `--since 5m` |
| `--until` | 특정 시간 이전 | `--until "2025-01-01T01:00:00Z"`, `--until 1m` |

### 출력 형식: compact, dict, json, jsonpb, table

| 형식 | 옵션 | 설명 | 용도 |
|------|------|------|------|
| compact | `-o compact` | 한 줄 요약 형식 | 실시간 모니터링, 빠른 확인 |
| dict | `-o dict` | key-value 상세 형식 | 개별 Flow 상세 분석 |
| json | `-o json` | JSON 형식 | jq 파이프라인, 스크립트 연동 |
| jsonpb | `-o jsonpb` | Protocol Buffers JSON | API 호환 처리 |
| table | `-o table` | 테이블 형식 (기본) | 터미널 가독성 |

**각 형식의 출력 예시**:

compact 형식:
```
Jan  1 12:00:00.000: demo/frontend:54321 (ID:12345) -> demo/backend:80 (ID:67890) to-endpoint FORWARDED (TCP Flags: SYN)
```

dict 형식:
```
  time: "Jan  1 12:00:00.000"
  source: demo/frontend (ID: 12345, labels: [k8s:app=frontend])
  destination: demo/backend (ID: 67890, labels: [k8s:app=backend])
  ...
```

json 형식:
```json
{"flow":{"time":"2025-01-01T12:00:00.000Z","verdict":"FORWARDED","source":{"namespace":"demo","pod_name":"frontend","identity":12345},"destination":{"namespace":"demo","pod_name":"backend","identity":67890},"l4":{"TCP":{"source_port":54321,"destination_port":80}}}}
```

### Follow 모드와 시간 범위 지정

**Follow 모드** (`--follow` 또는 `-f`):

```bash
# 실시간 스트리밍 — 새 Flow가 발생할 때마다 즉시 출력
hubble observe --follow

# follow + 필터 조합 — 특정 조건의 Flow만 실시간 감시
hubble observe --follow --namespace demo --verdict DROPPED

# follow + 출력 형식 — 실시간 JSON 스트림
hubble observe --follow --output json
```

Follow 모드에서는 ring buffer의 현재 위치부터 시작하여 새로운 Flow만 출력한다. `Ctrl+C`로 종료한다.

**시간 범위 지정**:

```bash
# 상대 시간 — 최근 5분간의 Flow
hubble observe --since 5m

# 상대 시간 — 최근 1시간간의 Flow
hubble observe --since 1h

# 절대 시간 — 특정 시간 범위
hubble observe --since "2025-01-01T09:00:00Z" --until "2025-01-01T10:00:00Z"

# since + follow — 과거부터 시작하여 실시간 스트리밍
hubble observe --since 10m --follow

# since + last 조합 — 최근 5분 중 마지막 50개
hubble observe --since 5m --last 50
```

주의: ring buffer는 고정 크기이므로, `--since`로 오래된 시간을 지정하더라도 ring buffer에 남아있는 Flow만 조회할 수 있다. 기본 4096 entries 버퍼에서 초당 100 Flow가 발생하면, 약 40초 이전의 데이터만 보존된다.

### jq를 이용한 JSON 후처리

`hubble observe --output json`의 결과를 jq로 가공하면 강력한 분석이 가능하다.

**기본 필드 추출**:
```bash
# source → destination 매핑 요약
hubble observe -o json --last 100 \
  | jq -r '.flow | "\(.source.namespace)/\(.source.pod_name) → \(.destination.namespace)/\(.destination.pod_name)"'

# verdict별 카운트
hubble observe -o json --last 1000 \
  | jq -r '.flow.verdict' | sort | uniq -c | sort -rn

# drop reason 분포
hubble observe -o json --last 500 --verdict DROPPED \
  | jq -r '.flow.drop_reason_desc' | sort | uniq -c | sort -rn
```

**L7 정보 추출**:
```bash
# HTTP 요청 상세 (method, url, status)
hubble observe -o json --protocol http --last 100 \
  | jq -r 'select(.flow.l7 != null) | .flow | "\(.l7.type): \(.l7.http.method // "-") \(.l7.http.url // "-") → \(.l7.http.code // "-")"'

# DNS 쿼리와 응답 코드
hubble observe -o json --protocol dns --last 100 \
  | jq -r 'select(.flow.l7.dns != null) | .flow | "\(.source.pod_name): \(.l7.dns.query) → \(.l7.dns.rcode)"'

# HTTP 응답 시간 통계 (ms)
hubble observe -o json --protocol http --last 500 \
  | jq -r 'select(.flow.l7.latency_ns != null) | .flow.l7.latency_ns / 1000000' \
  | sort -n | awk '{a[NR]=$1} END {print "min:", a[1], "median:", a[int(NR/2)], "max:", a[NR], "count:", NR}'
```

**고급 분석**:
```bash
# namespace 간 통신 매트릭스
hubble observe -o json --last 5000 \
  | jq -r 'select(.flow.source.namespace != null and .flow.destination.namespace != null) |
    "\(.flow.source.namespace) → \(.flow.destination.namespace)"' \
  | sort | uniq -c | sort -rn | head -20

# 시간대별 Flow 수 (분 단위)
hubble observe -o json --last 5000 \
  | jq -r '.flow.time[:16]' | sort | uniq -c

# 특정 Pod의 통신 대상 목록
hubble observe -o json --from-pod demo/frontend --last 500 \
  | jq -r '.flow | "\(.destination.namespace)/\(.destination.pod_name):\(.l4.TCP.destination_port // .l4.UDP.destination_port)"' \
  | sort -u

# JSON 결과를 CSV로 변환
hubble observe -o json --last 100 \
  | jq -r '.flow | [.time, .source.namespace, .source.pod_name, .destination.namespace, .destination.pod_name, .verdict, (.l4.TCP.destination_port // .l4.UDP.destination_port // "")] | @csv'
```

---

