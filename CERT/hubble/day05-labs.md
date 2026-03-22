# Day 5: 실습

Hubble CLI 설치 및 기본 사용, 다양한 필터 조합, Hubble UI 접속, 네트워크 정책 효과 검증, DNS 트러블슈팅, Lateral Movement 탐지, Inter-Namespace 트래픽 모니터링, Metrics-Prometheus-Grafana 대시보드 구성, HTTP 경로별 트래픽 필터링, 시간 범위 지정 조회, JSON+jq 가공, network-policies 검증을 실습한다.

---

## 실습

### 실습 1: Hubble CLI 설치 및 기본 사용

```bash
# Hubble CLI 설치 (macOS)
brew install hubble

# 또는 직접 다운로드
HUBBLE_VERSION=$(curl -s https://raw.githubusercontent.com/cilium/hubble/master/stable.txt)
curl -L --remote-name-all \
  https://github.com/cilium/hubble/releases/download/$HUBBLE_VERSION/hubble-darwin-amd64.tar.gz
tar xzvf hubble-darwin-amd64.tar.gz
sudo mv hubble /usr/local/bin/

# hubble-relay에 포트포워딩 (클러스터 외부에서 접근 시 필요)
kubectl port-forward -n kube-system svc/hubble-relay 4245:80 &

# Hubble 상태 확인
hubble status

# 실시간 트래픽 플로우 관찰
hubble observe

# 실시간 스트리밍 모드 (새로운 Flow가 발생할 때마다 출력)
hubble observe --follow

# 특정 네임스페이스 트래픽만 관찰
hubble observe --namespace demo

# 최근 N개 Flow만 조회
hubble observe --last 20

# 차단된 트래픽만 필터링
hubble observe --verdict DROPPED

# HTTP 트래픽만 관찰
hubble observe --protocol http
```

### 실습 2: 다양한 필터 조합

```bash
# === Pod 기반 필터 ===
# 특정 Pod로 들어오는 트래픽
hubble observe --to-pod demo/nginx-web

# 특정 Pod에서 나가는 트래픽
hubble observe --from-pod demo/frontend

# === IP 기반 필터 ===
# 특정 IP에서 오는 트래픽
hubble observe --ip 10.0.1.5

# 특정 IP 대역 필터링 (CIDR)
hubble observe --from-ip 10.0.0.0/16

# 도착지 IP 필터링
hubble observe --to-ip 172.16.0.100

# === 포트 기반 필터 ===
# 특정 포트로 향하는 트래픽
hubble observe --port 443

# 도착지 포트 필터링
hubble observe --to-port 80

# 출발지 포트 필터링
hubble observe --from-port 5432

# === Label 기반 필터 ===
# 특정 label을 가진 Pod의 트래픽
hubble observe --from-label "app=frontend"
hubble observe --to-label "app=backend,version=v2"

# === 프로토콜 및 L7 필터 ===
# DNS 쿼리 관찰
hubble observe --protocol dns

# HTTP 상태 코드 필터링
hubble observe --http-status 500
hubble observe --http-status "5+"    # 5xx 전체
hubble observe --http-status "4+"    # 4xx 전체

# HTTP 메서드 필터링
hubble observe --http-method GET
hubble observe --http-method POST

# HTTP 경로 필터링
hubble observe --http-path "/api/v1/users"

# DNS 쿼리 도메인 필터링
hubble observe --dns-query "kubernetes.default"

# === 이벤트 타입 필터 ===
# 특정 이벤트 타입만 필터링
hubble observe --type l7           # L7 이벤트만
hubble observe --type drop         # 드롭 이벤트만
hubble observe --type trace        # 트레이스 이벤트만
hubble observe --type policy-verdict  # 정책 판정 이벤트만

# === 복합 필터 ===
# 특정 namespace에서 차단된 DNS 트래픽
hubble observe --namespace demo --verdict DROPPED --protocol dns

# frontend에서 backend로의 HTTP 5xx 응답
hubble observe --from-label "app=frontend" --to-label "app=backend" --http-status "5+"

# === 출력 형식 ===
# JSON 형식 출력 (파이프라인 분석용)
hubble observe --output json | head -5

# compact 형식 (간결한 한 줄 출력)
hubble observe --output compact

# dict 형식 (key-value 상세 출력)
hubble observe --output dict

# jsonpb 형식 (Protocol Buffers JSON)
hubble observe --output jsonpb
```

### 실습 3: Hubble UI 접속

```bash
# Hubble UI 포트포워딩
kubectl port-forward -n kube-system svc/hubble-ui 12000:80

# 브라우저에서 http://localhost:12000 접속
# 1. 좌측 상단에서 namespace를 선택한다
# 2. Service Map에서 서비스 간 통신 관계를 확인한다
# 3. 특정 서비스 노드를 클릭하면 해당 서비스의 상세 Flow를 볼 수 있다
# 4. 빨간색 엣지가 있다면 차단된 트래픽이 존재하는 것이다
```

### 실습 4: 네트워크 정책 효과 검증

```bash
# 1. 정책 적용 전 트래픽 관찰
hubble observe --namespace demo --verdict FORWARDED

# 2. 네트워크 정책 적용 (deny-all)
kubectl apply -f deny-all-policy.yaml

# 3. 정책 적용 후 차단된 트래픽 확인
hubble observe --namespace demo --verdict DROPPED

# 4. 어떤 트래픽이 차단되었는지 상세 분석
hubble observe --namespace demo --verdict DROPPED --output json \
  | jq '.flow | {
    src: .source.labels,
    dst: .destination.labels,
    port: .l4,
    drop_reason: .drop_reason_desc
  }'

# 5. 특정 drop reason별로 분류
hubble observe --namespace demo --verdict DROPPED --output json \
  | jq -r '.flow.drop_reason_desc' | sort | uniq -c | sort -rn
```

### 실습 5: DNS 해석 문제 트러블슈팅

DNS 해석 실패는 Kubernetes 환경에서 흔한 문제이다. Hubble을 사용하면 DNS 쿼리/응답을 실시간으로 추적할 수 있다.

```bash
# 1. 특정 Pod의 DNS 쿼리를 실시간으로 관찰
hubble observe --from-pod demo/frontend --protocol dns --follow

# 2. DNS 응답 코드별 분류 (NXDOMAIN은 도메인이 존재하지 않음을 의미)
hubble observe --protocol dns --output json --last 100 \
  | jq -r 'select(.flow.l7.dns.rcode != null) | .flow.l7.dns | "\(.query) -> \(.rcode)"' \
  | sort | uniq -c | sort -rn

# 3. NXDOMAIN 응답만 필터링 (존재하지 않는 도메인 쿼리 식별)
hubble observe --protocol dns --output json --follow \
  | jq -r 'select(.flow.l7.dns.rcode == "Non-Existent Domain") | .flow | "\(.source.pod_name) -> \(.l7.dns.query)"'

# 4. 특정 도메인에 대한 DNS 쿼리 추적
hubble observe --dns-query "api.external-service.com" --follow

# 5. DNS 응답 시간이 긴 쿼리 식별
hubble observe --protocol dns --output json --last 500 \
  | jq 'select(.flow.l7.type == "RESPONSE") | {query: .flow.l7.dns.query, latency_ms: (.flow.l7.latency_ns / 1000000)}'

# 6. kube-dns/coredns로 향하는 트래픽 확인
hubble observe --to-label "k8s-app=kube-dns" --namespace kube-system --follow
```

### 실습 6: Lateral Movement(횡이동) 탐지

공격자가 클러스터 내부에서 횡이동하는 패턴을 Hubble로 탐지할 수 있다.

```bash
# 1. 비정상적인 namespace 간 통신 탐지
# 일반적으로 통신하지 않는 namespace 간 트래픽을 확인한다
hubble observe --verdict FORWARDED --output json --last 1000 \
  | jq -r 'select(.flow.source.namespace != .flow.destination.namespace) | "\(.flow.source.namespace)/\(.flow.source.pod_name) -> \(.flow.destination.namespace)/\(.flow.destination.pod_name)"' \
  | sort | uniq -c | sort -rn

# 2. 차단된 cross-namespace 트래픽 (정책이 적용된 경우)
hubble observe --verdict DROPPED --output json --follow \
  | jq -r 'select(.flow.source.namespace != .flow.destination.namespace) | "\(.flow.source.namespace) -> \(.flow.destination.namespace): \(.flow.drop_reason_desc)"'

# 3. Kubernetes API 서버 접근 시도 모니터링
hubble observe --to-port 6443 --follow

# 4. 비정상 포트 스캔 탐지 (짧은 시간 내 다수 포트 접근)
hubble observe --from-pod suspicious-namespace/suspicious-pod --verdict DROPPED --follow

# 5. 클러스터 외부로의 비정상 아웃바운드 트래픽 탐지
hubble observe --type trace --traffic-direction egress --to-identity world --follow

# 6. metadata 서비스 접근 시도 탐지 (클라우드 환경 SSRF 공격)
hubble observe --to-ip 169.254.169.254 --follow
```

### 실습 7: Inter-Namespace 트래픽 모니터링

마이크로서비스 아키텍처에서 namespace 간 트래픽 패턴을 분석할 수 있다.

```bash
# 1. 특정 namespace 간 트래픽 관찰
hubble observe --from-namespace frontend-ns --to-namespace backend-ns --follow

# 2. namespace 간 트래픽 매트릭스 생성
hubble observe --output json --last 5000 \
  | jq -r 'select(.flow.source.namespace != null and .flow.destination.namespace != null) | "\(.flow.source.namespace) -> \(.flow.destination.namespace)"' \
  | sort | uniq -c | sort -rn

# 3. 특정 namespace로 들어오는 모든 인바운드 트래픽 분석
hubble observe --to-namespace production --output json --last 1000 \
  | jq -r '"\(.flow.source.namespace // "external")/\(.flow.source.pod_name // .flow.IP.source) -> \(.flow.destination.pod_name):\(.flow.l4.TCP.destination_port // .flow.l4.UDP.destination_port)"' \
  | sort | uniq -c | sort -rn

# 4. namespace 간 HTTP 에러 응답 모니터링
hubble observe --from-namespace frontend-ns --to-namespace backend-ns --http-status "5+" --follow

# 5. 특정 서비스 간 통신 레이턴시 관찰 (L7 활성화 필요)
hubble observe --from-label "app=gateway" --to-label "app=user-service" --protocol http --output json \
  | jq 'select(.flow.l7.type == "RESPONSE") | {path: .flow.l7.http.url, status: .flow.l7.http.code, latency_ms: (.flow.l7.latency_ns / 1000000)}'
```

### 실습 8: Hubble Metrics → Prometheus → Grafana 대시보드 구성

이 실습에서는 Hubble 메트릭을 Prometheus로 수집하고 Grafana에서 시각화하는 전체 파이프라인을 구성한다.

```bash
# Step 1: Hubble 메트릭이 활성화되어 있는지 확인
# 이 프로젝트에서는 manifests/hubble-values.yaml에 메트릭이 이미 설정되어 있다
kubectl get pods -n kube-system -l k8s-app=cilium -o name | head -1 | \
  xargs -I{} kubectl -n kube-system exec {} -- curl -s http://localhost:9965/metrics | head -30

# Step 2: Prometheus ServiceMonitor 확인 (Prometheus Operator 사용 시)
kubectl get servicemonitor -n kube-system | grep hubble

# Step 3: Prometheus에서 hubble 메트릭이 수집되는지 확인
# Prometheus UI에서 확인하거나 API로 조회:
kubectl port-forward -n monitoring svc/prometheus-operated 9090:9090 &
curl -s 'http://localhost:9090/api/v1/query?query=hubble_flows_processed_total' | jq '.data.result | length'

# Step 4: Grafana에 Hubble 대시보드 Import
# 방법 1: Grafana Labs에서 공식 대시보드 import (Dashboard ID: 16611)
# 방법 2: 아래 JSON 모델을 직접 import (예제 섹션 참조)

# Step 5: 주요 패널 PromQL 테스트
# Flow rate
curl -s 'http://localhost:9090/api/v1/query?query=sum(rate(hubble_flows_processed_total[5m]))' | jq '.data.result'

# Drop rate
curl -s 'http://localhost:9090/api/v1/query?query=sum(rate(hubble_drop_total[5m]))' | jq '.data.result'

# HTTP error rate
curl -s 'http://localhost:9090/api/v1/query?query=sum(rate(hubble_http_responses_total{status=~"5.."}[5m]))' | jq '.data.result'
```

### 실습 9: 특정 HTTP 경로별 트래픽 필터링

L7 가시성이 활성화된 환경에서 특정 API 엔드포인트의 트래픽을 분석한다.

```bash
# Step 1: L7 가시성 활성화 확인
hubble observe --namespace demo --type l7 --last 5

# Step 2: 특정 HTTP 경로 필터링
# /api/v1/* 경로만 관찰
hubble observe --namespace demo --http-path "/api/v1/.*" --follow

# /health 엔드포인트 트래픽
hubble observe --namespace demo --http-path "/health" --last 20

# /api/v1/users 관련 모든 요청
hubble observe --http-path "/api/v1/users" --follow

# Step 3: 경로별 요청 수 통계
hubble observe --namespace demo --protocol http -o json --last 1000 \
  | jq -r 'select(.flow.l7.http.url != null) | .flow.l7.http | "\(.method) \(.url)"' \
  | sort | uniq -c | sort -rn | head -20

# Step 4: 경로별 에러율 분석
hubble observe --namespace demo --protocol http -o json --last 2000 \
  | jq -r 'select(.flow.l7.type == "RESPONSE" and .flow.l7.http.url != null) |
    .flow.l7.http | "\(.url)\t\(.code)"' \
  | awk -F'\t' '{
    total[$1]++;
    if ($2 >= 400) error[$1]++
  } END {
    for (url in total)
      printf "%s: %d requests, %d errors (%.1f%%)\n", url, total[url], error[url]+0, (error[url]+0)/total[url]*100
  }' | sort -t: -k2 -rn

# Step 5: 특정 경로의 레이턴시 분포
hubble observe --namespace demo --http-path "/api/v1/users" -o json --last 500 \
  | jq -r 'select(.flow.l7.type == "RESPONSE" and .flow.l7.latency_ns != null) |
    .flow.l7.latency_ns / 1000000' \
  | sort -n \
  | awk '{
    a[NR]=$1; sum+=$1
  } END {
    printf "Count: %d\nMin: %.2f ms\nMedian: %.2f ms\nP95: %.2f ms\nP99: %.2f ms\nMax: %.2f ms\nAvg: %.2f ms\n",
      NR, a[1], a[int(NR/2)], a[int(NR*0.95)], a[int(NR*0.99)], a[NR], sum/NR
  }'
```

### 실습 10: 시간 범위 지정 조회

```bash
# 상대 시간: 최근 5분간의 Flow
hubble observe --since 5m --last 100

# 상대 시간: 최근 1시간 중 차단된 트래픽
hubble observe --since 1h --verdict DROPPED --last 50

# 상대 시간: 최근 10분간, 계속 follow
hubble observe --since 10m --follow

# 절대 시간 범위 지정
hubble observe --since "2025-06-01T09:00:00Z" --until "2025-06-01T10:00:00Z"

# since와 last 조합: 최근 30분 중 마지막 20개 DROP 이벤트
hubble observe --since 30m --verdict DROPPED --last 20

# 시간 범위 내 verdict 분포 확인
hubble observe --since 1h -o json --last 5000 \
  | jq -r '.flow.verdict' | sort | uniq -c | sort -rn

# 시간대별 Flow 수 분석 (분 단위)
hubble observe --since 1h -o json --last 10000 \
  | jq -r '.flow.time[:16]' | sort | uniq -c | tail -20
```

### 실습 11: JSON 출력 + jq 가공

```bash
# 기본: JSON 출력으로 전체 Flow 확인
hubble observe -o json --last 1 | jq .

# 특정 필드만 추출
hubble observe -o json --last 10 \
  | jq '.flow | {time, verdict, src: .source.pod_name, dst: .destination.pod_name}'

# CSV 변환 (스프레드시트 분석용)
hubble observe -o json --last 100 \
  | jq -r '.flow | [.time, .source.namespace, .source.pod_name,
    .destination.namespace, .destination.pod_name, .verdict,
    (.l4.TCP.destination_port // .l4.UDP.destination_port // "")] | @csv' \
  > /tmp/hubble-flows.csv

# TSV 변환 (탭 구분)
hubble observe -o json --last 100 \
  | jq -r '.flow | [.time, .source.namespace, .source.pod_name,
    .destination.namespace, .destination.pod_name, .verdict] | @tsv'

# verdict별 그룹핑 + 카운트
hubble observe -o json --last 1000 \
  | jq -s 'group_by(.flow.verdict) | map({verdict: .[0].flow.verdict, count: length})'

# 유니크한 source-destination 쌍 추출 (통신 관계 맵)
hubble observe -o json --last 5000 \
  | jq -r '.flow | "\(.source.labels // [] | map(select(startswith("k8s:app="))) | .[0] // "unknown") → \(.destination.labels // [] | map(select(startswith("k8s:app="))) | .[0] // "unknown")"' \
  | sort -u

# Flow를 시간 기반으로 분석 (5초 단위 카운트)
hubble observe -o json --last 5000 \
  | jq -r '.flow.time[:19]' \
  | uniq -c | awk '{print $2, $1}' | tail -20

# 중첩 JSON 필터: DNS 쿼리 중 특정 도메인 패턴 추출
hubble observe -o json --protocol dns --last 500 \
  | jq 'select(.flow.l7.dns.query != null and (.flow.l7.dns.query | test("github|google|aws"))) |
    {pod: .flow.source.pod_name, query: .flow.l7.dns.query, rcode: .flow.l7.dns.rcode}'
```

### 실습 12: 이 프로젝트의 network-policies 검증

이 프로젝트의 `manifests/network-policies/` 디렉토리에 있는 실제 CiliumNetworkPolicy를 Hubble로 검증하는 실습이다.

```bash
# 이 프로젝트에서 사용하는 네트워크 정책 확인
ls manifests/network-policies/
# 출력:
# allow-external-to-keycloak.yaml
# allow-external-to-nginx.yaml
# allow-httpbin-to-keycloak.yaml
# allow-httpbin-to-postgres.yaml
# allow-httpbin-to-rabbitmq.yaml
# allow-istio-sidecars.yaml
# allow-keycloak-to-postgres.yaml
# allow-nginx-egress.yaml
# allow-nginx-to-httpbin.yaml
# allow-nginx-to-redis.yaml
# default-deny.yaml

# === default-deny 정책 검증 ===
# default-deny는 demo namespace에서 DNS(53)만 허용하고 나머지를 차단한다

# Step 1: 정책 적용
kubectl apply -f manifests/network-policies/default-deny.yaml

# Step 2: DNS 트래픽은 허용되는지 확인
hubble observe --namespace demo --to-port 53 --verdict FORWARDED --last 10

# Step 3: DNS 이외 트래픽은 차단되는지 확인
hubble observe --namespace demo --verdict DROPPED --last 20

# === allow-nginx-to-httpbin 정책 검증 ===
# nginx-web → httpbin:80 TCP GET만 허용

# Step 1: 정책 적용
kubectl apply -f manifests/network-policies/allow-nginx-to-httpbin.yaml

# Step 2: nginx → httpbin GET 요청 허용 확인
hubble observe --from-label "app=nginx-web" --to-label "app=httpbin" \
  --to-port 80 --verdict FORWARDED --follow

# Step 3: nginx → httpbin POST는 L7 정책에 의해 차단되는지 확인
# (L7 정책이므로 HTTP method 수준에서 차단)
hubble observe --from-label "app=nginx-web" --to-label "app=httpbin" \
  --http-method POST --verdict DROPPED --follow

# === allow-nginx-to-redis 정책 검증 ===
kubectl apply -f manifests/network-policies/allow-nginx-to-redis.yaml
hubble observe --from-label "app=nginx-web" --to-label "app=redis" --follow

# === allow-httpbin-to-postgres 정책 검증 ===
kubectl apply -f manifests/network-policies/allow-httpbin-to-postgres.yaml
hubble observe --from-label "app=httpbin" --to-label "app=postgres" --to-port 5432 --follow

# === 전체 정책 적용 후 종합 검증 ===
# 모든 정책 적용
kubectl apply -f manifests/network-policies/

# 허용된 통신 관계 매트릭스
hubble observe --namespace demo --verdict FORWARDED -o json --last 2000 \
  | jq -r '.flow | "\(.source.labels // [] | map(select(startswith("k8s:app="))) | .[0] // "unknown") → \(.destination.labels // [] | map(select(startswith("k8s:app="))) | .[0] // "unknown")"' \
  | sort | uniq -c | sort -rn

# 차단된 통신 관계 (정책 미비 항목 발견용)
hubble observe --namespace demo --verdict DROPPED -o json --last 2000 \
  | jq -r '.flow | "\(.source.labels // [] | map(select(startswith("k8s:app="))) | .[0] // "unknown") → \(.destination.labels // [] | map(select(startswith("k8s:app="))) | .[0] // "unknown"):(\(.l4.TCP.destination_port // .l4.UDP.destination_port // "N/A"))"' \
  | sort | uniq -c | sort -rn

# 정책 검증 보고서 생성
echo "=== Network Policy Verification Report ===" > /tmp/np-report.txt
echo "Date: $(date)" >> /tmp/np-report.txt
echo "" >> /tmp/np-report.txt
echo "--- Applied Policies ---" >> /tmp/np-report.txt
kubectl get cnp -n demo >> /tmp/np-report.txt
echo "" >> /tmp/np-report.txt
echo "--- Allowed Traffic Pairs ---" >> /tmp/np-report.txt
hubble observe --namespace demo --verdict FORWARDED -o json --last 2000 \
  | jq -r '.flow | "\(.source.labels // [] | map(select(startswith("k8s:app="))) | .[0] // .source.pod_name) → \(.destination.labels // [] | map(select(startswith("k8s:app="))) | .[0] // .destination.pod_name)"' \
  | sort | uniq -c | sort -rn >> /tmp/np-report.txt
echo "" >> /tmp/np-report.txt
echo "--- Denied Traffic Pairs ---" >> /tmp/np-report.txt
hubble observe --namespace demo --verdict DROPPED -o json --last 2000 \
  | jq -r '.flow | "\(.source.labels // [] | map(select(startswith("k8s:app="))) | .[0] // .source.pod_name) → \(.destination.labels // [] | map(select(startswith("k8s:app="))) | .[0] // .destination.pod_name)"' \
  | sort | uniq -c | sort -rn >> /tmp/np-report.txt
cat /tmp/np-report.txt
```

---

