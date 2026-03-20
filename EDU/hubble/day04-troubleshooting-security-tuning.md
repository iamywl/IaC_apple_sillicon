# Day 4: 네트워크 트러블슈팅, 보안 감사, 성능 튜닝

Pod 간 통신 실패, DNS 해석 실패, NetworkPolicy 검증, 레이턴시 분석, egress 차단, TCP RST 분석, 보안 감사, lateral movement 탐지, 데이터 유출 탐지, Ring buffer 최적화, 메트릭 부하 관리, L7 visibility 성능 영향을 학습한다.

---

## 네트워크 트러블슈팅 시나리오

### 시나리오 1: Pod 간 통신 실패 디버깅 (DROPPED verdict 추적)

**증상**: frontend Pod에서 backend Pod로 HTTP 요청을 보내면 connection timeout이 발생한다.

**디버깅 절차**:

```bash
# Step 1: 차단된 트래픽 확인
hubble observe --from-label "app=frontend" --to-label "app=backend" --verdict DROPPED --last 20

# Step 2: drop reason 확인
hubble observe --from-label "app=frontend" --to-label "app=backend" --verdict DROPPED -o json --last 10 \
  | jq '.flow | {
    src: "\(.source.namespace)/\(.source.pod_name)",
    dst: "\(.destination.namespace)/\(.destination.pod_name)",
    port: .l4.TCP.destination_port,
    drop_reason: .drop_reason_desc,
    direction: .traffic_direction
  }'

# Step 3: 관련 CiliumNetworkPolicy 확인
kubectl get cnp -n demo -o yaml

# Step 4: identity 확인 (정책 매칭 문제 진단)
kubectl -n kube-system exec -it ds/cilium -- cilium identity list | grep frontend
kubectl -n kube-system exec -it ds/cilium -- cilium identity list | grep backend

# Step 5: endpoint 상태 확인
kubectl -n kube-system exec -it ds/cilium -- cilium endpoint list | grep -E "frontend|backend"

# Step 6: 정책 수정 후 트래픽 허용 확인
hubble observe --from-label "app=frontend" --to-label "app=backend" --follow
```

**일반적 원인**: `POLICY_DENIED` drop reason이 나타나면, CiliumNetworkPolicy에 해당 트래픽을 허용하는 규칙이 없는 것이다. 특히 default-deny 정책이 적용된 namespace에서 흔히 발생한다.

### 시나리오 2: DNS 해석 실패 디버깅 (DNS query/response 관찰)

**증상**: Pod 내부에서 `nslookup`이나 `curl` 실행 시 DNS 해석이 실패한다.

**디버깅 절차**:

```bash
# Step 1: 해당 Pod의 DNS 쿼리 관찰
hubble observe --from-pod demo/frontend --protocol dns --follow

# Step 2: DNS 응답 코드 확인
hubble observe --from-pod demo/frontend --protocol dns -o json --last 50 \
  | jq 'select(.flow.l7.dns != null) | .flow | {
    query: .l7.dns.query,
    rcode: .l7.dns.rcode,
    ips: .l7.dns.ips,
    source: .source.pod_name,
    dst: .destination.pod_name
  }'

# Step 3: kube-dns로의 트래픽이 차단되고 있는지 확인
hubble observe --from-pod demo/frontend --to-label "k8s-app=kube-dns" --verdict DROPPED

# Step 4: DNS 트래픽이 egress 정책에 의해 차단되는지 확인
hubble observe --from-pod demo/frontend --to-port 53 --verdict DROPPED

# Step 5: NXDOMAIN 응답 탐색 (도메인이 존재하지 않는 경우)
hubble observe --protocol dns -o json --last 200 \
  | jq -r 'select(.flow.l7.dns.rcode == "Non-Existent Domain") |
    .flow | "\(.source.pod_name): \(.l7.dns.query)"'

# Step 6: CoreDNS 자체의 외부 DNS 해석 확인
hubble observe --from-label "k8s-app=kube-dns" --protocol dns --follow
```

**일반적 원인**:
- default-deny 정책에서 DNS(53/UDP, 53/TCP) egress를 허용하지 않음
- CoreDNS Pod 자체의 egress가 차단됨 (외부 forwarder 접근 불가)
- search domain 설정 오류로 잘못된 FQDN 쿼리

### 시나리오 3: NetworkPolicy 검증 (허용/차단 트래픽 확인)

**증상**: 새로운 CiliumNetworkPolicy를 적용했는데, 의도한 대로 동작하는지 확인이 필요하다.

**디버깅 절차**:

```bash
# Step 1: 정책 적용 전 baseline 관찰 (audit 모드 권장)
hubble observe --namespace demo --last 100

# Step 2: 정책 적용
kubectl apply -f manifests/network-policies/default-deny.yaml
kubectl apply -f manifests/network-policies/allow-nginx-to-httpbin.yaml

# Step 3: 허용된 트래픽 확인
hubble observe --namespace demo --verdict FORWARDED --follow

# Step 4: 차단된 트래픽 확인
hubble observe --namespace demo --verdict DROPPED --follow

# Step 5: 특정 정책의 효과 검증 — nginx→httpbin GET만 허용되는지
# 허용 확인
hubble observe --from-label "app=nginx-web" --to-label "app=httpbin" \
  --to-port 80 --verdict FORWARDED --follow

# 차단 확인 (POST는 차단되어야 함)
hubble observe --from-label "app=nginx-web" --to-label "app=httpbin" \
  --verdict DROPPED --follow

# Step 6: 정책 verdict 이벤트만 관찰
hubble observe --namespace demo --type policy-verdict --follow

# Step 7: 종합 보고서 생성
hubble observe --namespace demo -o json --last 500 \
  | jq -r '.flow | "\(.verdict): \(.source.labels // [] | join(",")) → \(.destination.labels // [] | join(","))"' \
  | sort | uniq -c | sort -rn
```

### 시나리오 4: 서비스 간 레이턴시 분석 (HTTP 응답 시간)

**증상**: 사용자 응답 시간이 느리다. 어떤 마이크로서비스 구간에서 지연이 발생하는지 파악해야 한다.

**디버깅 절차**:

```bash
# Step 1: L7 가시성 활성화 확인
hubble observe --namespace demo --type l7 --last 10

# Step 2: HTTP 응답 시간 조회
hubble observe --namespace demo --protocol http -o json --last 200 \
  | jq 'select(.flow.l7.type == "RESPONSE" and .flow.l7.latency_ns != null) | .flow | {
    service: "\(.source.namespace)/\(.source.pod_name) → \(.destination.namespace)/\(.destination.pod_name)",
    method: .l7.http.method,
    url: .l7.http.url,
    status: .l7.http.code,
    latency_ms: (.l7.latency_ns / 1000000)
  }'

# Step 3: 느린 요청 식별 (100ms 이상)
hubble observe --namespace demo --protocol http -o json --last 500 \
  | jq 'select(.flow.l7.type == "RESPONSE" and (.flow.l7.latency_ns // 0) > 100000000) | .flow | {
    from: .source.pod_name,
    to: .destination.pod_name,
    url: .l7.http.url,
    latency_ms: (.l7.latency_ns / 1000000)
  }'

# Step 4: 서비스별 평균 레이턴시 비교
hubble observe --namespace demo --protocol http -o json --last 1000 \
  | jq -r 'select(.flow.l7.type == "RESPONSE" and .flow.l7.latency_ns != null) |
    "\(.flow.destination.pod_name | split("-")[0:2] | join("-"))\t\(.flow.l7.latency_ns / 1000000)"' \
  | awk -F'\t' '{sum[$1]+=$2; count[$1]++} END {for (svc in sum) printf "%s\tavg: %.2f ms\tcount: %d\n", svc, sum[svc]/count[svc], count[svc]}' \
  | sort -t$'\t' -k2 -rn

# Step 5: 특정 엔드포인트의 레이턴시 추이 (실시간)
hubble observe --to-label "app=backend" --protocol http -o json --follow \
  | jq 'select(.flow.l7.type == "RESPONSE") | "\(.flow.time): \(.flow.l7.http.url) → \(.flow.l7.http.code) (\(.flow.l7.latency_ns / 1000000)ms)"'
```

### 시나리오 5: 외부 트래픽 차단 원인 분석 (egress policy)

**증상**: Pod에서 외부 API(예: api.github.com)에 접근하려 하지만 연결이 거부된다.

**디버깅 절차**:

```bash
# Step 1: 외부 트래픽 차단 확인
hubble observe --from-pod demo/frontend --to-identity world --verdict DROPPED --follow

# Step 2: 어떤 외부 IP/포트로의 접근이 차단되는지 확인
hubble observe --from-pod demo/frontend --to-identity world --verdict DROPPED -o json --last 20 \
  | jq '.flow | {
    dst_ip: .IP.destination,
    dst_port: (.l4.TCP.destination_port // .l4.UDP.destination_port),
    protocol: (if .l4.TCP then "TCP" elif .l4.UDP then "UDP" else "other" end),
    drop_reason: .drop_reason_desc,
    dst_names: .destination_names
  }'

# Step 3: DNS로 해석된 FQDN 확인 (destination_names 필드)
hubble observe --from-pod demo/frontend -o json --last 50 \
  | jq -r 'select(.flow.destination_names != null and (.flow.destination_names | length) > 0) |
    "\(.flow.IP.destination) → \(.flow.destination_names | join(", "))"' | sort -u

# Step 4: egress 정책에 toFQDNs 규칙 추가
cat <<EOF | kubectl apply -f -
apiVersion: "cilium.io/v2"
kind: CiliumNetworkPolicy
metadata:
  name: allow-github-egress
  namespace: demo
spec:
  endpointSelector:
    matchLabels:
      app: frontend
  egress:
    - toFQDNs:
        - matchPattern: "*.github.com"
      toPorts:
        - ports:
            - port: "443"
              protocol: TCP
EOF

# Step 5: 정책 적용 후 확인
hubble observe --from-pod demo/frontend --to-identity world --follow
```

### 시나리오 6: TCP RST/FIN 비정상 연결 종료 분석

**증상**: 서비스 간 통신에서 간헐적으로 "connection reset by peer" 에러가 발생한다.

**디버깅 절차**:

```bash
# Step 1: TCP RST 패킷 관찰
hubble observe --namespace demo --protocol tcp -o json --follow \
  | jq 'select(.flow.l4.TCP.flags.RST == true) | .flow | {
    time: .time,
    src: "\(.source.namespace)/\(.source.pod_name):\(.l4.TCP.source_port)",
    dst: "\(.destination.namespace)/\(.destination.pod_name):\(.l4.TCP.destination_port)",
    direction: .traffic_direction,
    verdict: .verdict
  }'

# Step 2: TCP flag 분포 확인 (RST 비율이 높은지)
hubble observe --namespace demo -o json --last 2000 \
  | jq -r 'select(.flow.l4.TCP != null) |
    if .flow.l4.TCP.flags.RST then "RST"
    elif .flow.l4.TCP.flags.SYN and .flow.l4.TCP.flags.ACK then "SYN-ACK"
    elif .flow.l4.TCP.flags.SYN then "SYN"
    elif .flow.l4.TCP.flags.FIN then "FIN"
    else "OTHER"
    end' | sort | uniq -c | sort -rn

# Step 3: RST가 빈번한 source-destination 쌍 식별
hubble observe --namespace demo -o json --last 5000 \
  | jq -r 'select(.flow.l4.TCP.flags.RST == true) |
    "\(.flow.source.pod_name) → \(.flow.destination.pod_name):\(.flow.l4.TCP.destination_port)"' \
  | sort | uniq -c | sort -rn | head -10

# Step 4: 비정상 FIN 패턴 (FIN 없이 RST로 종료되는 연결) 분석
hubble observe --from-label "app=backend" --to-label "app=frontend" -o json --follow \
  | jq 'select(.flow.l4.TCP.flags.RST == true or .flow.l4.TCP.flags.FIN == true) |
    "\(.flow.time): \(if .flow.l4.TCP.flags.RST then "RST" else "FIN" end) | \(.flow.source.pod_name) → \(.flow.destination.pod_name)"'

# Step 5: Prometheus에서 RST 비율 모니터링 (PromQL)
# rate(hubble_tcp_flags_total{flag="RST"}[5m]) / rate(hubble_tcp_flags_total{flag="SYN"}[5m])
```

**일반적 원인**:
- 서비스의 readiness probe 실패로 트래픽이 종료 중인 Pod로 전달됨
- 커넥션 풀 설정 불일치 (idle timeout 차이)
- 서버 측 리소스 부족 (accept backlog 초과)

### 시나리오 7: 보안 감사 — 의심스러운 lateral movement 탐지

**증상**: 보안팀에서 클러스터 내 횡이동(lateral movement) 시도가 의심된다는 경보를 수신했다.

**디버깅 절차**:

```bash
# Step 1: 비정상적인 cross-namespace 통신 탐색
hubble observe -o json --last 5000 \
  | jq -r 'select(.flow.source.namespace != null and .flow.destination.namespace != null and
    .flow.source.namespace != .flow.destination.namespace and
    .flow.source.namespace != "kube-system" and .flow.destination.namespace != "kube-system") |
    "\(.flow.source.namespace)/\(.flow.source.pod_name) → \(.flow.destination.namespace)/\(.flow.destination.pod_name):\(.flow.l4.TCP.destination_port // .flow.l4.UDP.destination_port)"' \
  | sort | uniq -c | sort -rn | head -20

# Step 2: API 서버 접근 시도 모니터링
hubble observe --to-identity kube-apiserver --follow \
  | grep -v "kube-system"  # kube-system 이외에서의 접근

# Step 3: 민감 포트 접근 탐지
# etcd(2379,2380), kubelet(10250), kube-scheduler(10251), kube-controller-manager(10252)
hubble observe --to-port 2379 --follow
hubble observe --to-port 10250 --follow

# Step 4: metadata 서비스 접근 시도 (클라우드 SSRF)
hubble observe --to-ip 169.254.169.254 --follow

# Step 5: 단시간 내 다수 목적지 접근 (포트 스캔 의심)
hubble observe -o json --verdict DROPPED --last 5000 \
  | jq -r '.flow | "\(.source.namespace)/\(.source.pod_name)"' \
  | sort | uniq -c | sort -rn | head -10
# → 특정 Pod에서 비정상적으로 많은 DROPPED 이벤트가 발생하면 포트 스캔 의심

# Step 6: 의심 Pod의 모든 통신 기록 수집
SUSPECT_POD="suspicious-namespace/suspicious-pod"
hubble observe --from-pod "$SUSPECT_POD" -o json --last 1000 \
  | jq '{
    time: .flow.time,
    dst: "\(.flow.destination.namespace // "external")/\(.flow.destination.pod_name // .flow.IP.destination)",
    port: (.flow.l4.TCP.destination_port // .flow.l4.UDP.destination_port),
    verdict: .flow.verdict,
    protocol: (if .flow.l7 then .flow.l7.type else "L3_L4" end)
  }' > /tmp/suspect-flows.json

# Step 7: 외부 C2(Command and Control) 서버 통신 탐지
hubble observe --to-identity world --traffic-direction egress -o json --last 5000 \
  | jq -r 'select(.flow.l4.TCP.destination_port != 443 and .flow.l4.TCP.destination_port != 80) |
    "\(.flow.source.namespace)/\(.flow.source.pod_name) → \(.flow.IP.destination):\(.flow.l4.TCP.destination_port)"' \
  | sort -u
```

### 시나리오 8: Kafka/gRPC L7 트래픽 분석

**증상**: Kafka consumer의 lag가 증가하거나 gRPC 서비스의 에러율이 상승한다.

**Kafka 트래픽 분석**:

```bash
# Step 1: Kafka L7 이벤트 관찰
hubble observe --protocol kafka --follow

# Step 2: Kafka API별 트래픽 분석
hubble observe --protocol kafka -o json --last 500 \
  | jq 'select(.flow.l7.kafka != null) | .flow | {
    from: .source.pod_name,
    to: .destination.pod_name,
    api: .l7.kafka.api_key,
    topic: .l7.kafka.topic,
    error: .l7.kafka.error_code
  }'

# Step 3: Kafka 에러 발생 확인
hubble observe --protocol kafka -o json --last 1000 \
  | jq 'select(.flow.l7.kafka.error_code != null and .flow.l7.kafka.error_code != 0) | .flow | {
    from: .source.pod_name,
    topic: .l7.kafka.topic,
    error_code: .l7.kafka.error_code,
    api: .l7.kafka.api_key
  }'

# Step 4: topic별 트래픽 분포
hubble observe --protocol kafka -o json --last 2000 \
  | jq -r 'select(.flow.l7.kafka.topic != null) | .flow.l7.kafka.topic' \
  | sort | uniq -c | sort -rn
```

**gRPC 트래픽 분석**:

```bash
# Step 1: gRPC 요청/응답 관찰
hubble observe --protocol http --http-path "/.*" -o json --follow \
  | jq 'select(.flow.l7.http.protocol == "HTTP/2" and (.flow.l7.http.url | test("^/"))) | .flow | {
    from: .source.pod_name,
    to: .destination.pod_name,
    method: .l7.http.url,
    type: .l7.type,
    status: .l7.http.code,
    latency_ms: ((.l7.latency_ns // 0) / 1000000)
  }'

# Step 2: gRPC 에러 응답 (grpc-status != 0) 확인
hubble observe --protocol http -o json --last 500 \
  | jq 'select(.flow.l7.http.protocol == "HTTP/2" and .flow.l7.type == "RESPONSE") | .flow | {
    service: .l7.http.url,
    http_status: .l7.http.code,
    grpc_status: (.l7.http.headers["grpc-status"] // "unknown"),
    latency_ms: ((.l7.latency_ns // 0) / 1000000)
  }'

# Step 3: gRPC 서비스별 에러율
hubble observe --protocol http -o json --last 2000 \
  | jq -r 'select(.flow.l7.http.protocol == "HTTP/2" and .flow.l7.type == "RESPONSE") |
    .flow.l7.http | "\(.url)\t\(.code)"' \
  | awk -F'\t' '{total[$1]++; if ($2 != "200") error[$1]++} END {
    for (svc in total) printf "%s: %d/%d (%.1f%% error)\n", svc, (error[svc]+0), total[svc], (error[svc]+0)/total[svc]*100
  }'
```

---

## 보안 감사 및 컴플라이언스

### Flow 로그를 이용한 보안 감사

Hubble Flow 로그는 클러스터 내 모든 네트워크 통신의 감사 추적(audit trail)을 제공한다. 보안 감사의 핵심 관점은 다음과 같다.

**감사 대상 이벤트 분류**:

| 감사 카테고리 | 관찰 대상 | Hubble 필터 |
|-------------|----------|-------------|
| 비인가 접근 시도 | DROPPED verdict 트래픽 | `--verdict DROPPED` |
| 외부 통신 | world identity 대상 트래픽 | `--to-identity world` |
| 권한 상승 시도 | API 서버 접근 | `--to-port 6443` |
| 데이터 유출 의심 | 대량 egress 트래픽 | `--traffic-direction egress --to-identity world` |
| 정책 우회 시도 | AUDIT verdict (감사 모드) | `--verdict AUDIT` |
| 내부 횡이동 | cross-namespace 통신 | source.namespace != destination.namespace |

**정기 감사 스크립트 예시**:

```bash
#!/bin/bash
# hubble-audit.sh - 일일 네트워크 보안 감사 보고서 생성

REPORT_FILE="/tmp/hubble-audit-$(date +%Y%m%d).txt"
echo "=== Hubble 네트워크 보안 감사 보고서 ===" > "$REPORT_FILE"
echo "생성 시각: $(date)" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"

echo "--- 1. 차단된 트래픽 Top 20 ---" >> "$REPORT_FILE"
hubble observe --verdict DROPPED -o json --last 10000 \
  | jq -r '.flow | "\(.source.namespace)/\(.source.pod_name) → \(.destination.namespace // "external")/\(.destination.pod_name // .IP.destination):\(.l4.TCP.destination_port // .l4.UDP.destination_port) | \(.drop_reason_desc)"' \
  | sort | uniq -c | sort -rn | head -20 >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"

echo "--- 2. 외부 통신 대상 (world identity) ---" >> "$REPORT_FILE"
hubble observe --to-identity world -o json --last 10000 \
  | jq -r '.flow | "\(.source.namespace)/\(.source.pod_name) → \(.IP.destination):\(.l4.TCP.destination_port // .l4.UDP.destination_port) [\(.verdict)]"' \
  | sort | uniq -c | sort -rn | head -20 >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"

echo "--- 3. API 서버 접근 시도 ---" >> "$REPORT_FILE"
hubble observe --to-port 6443 -o json --last 5000 \
  | jq -r '.flow | "\(.source.namespace)/\(.source.pod_name) [\(.verdict)]"' \
  | sort | uniq -c | sort -rn >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"

echo "--- 4. Drop Reason 분포 ---" >> "$REPORT_FILE"
hubble observe --verdict DROPPED -o json --last 10000 \
  | jq -r '.flow.drop_reason_desc' | sort | uniq -c | sort -rn >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"

echo "--- 5. Cross-Namespace 통신 ---" >> "$REPORT_FILE"
hubble observe -o json --last 10000 \
  | jq -r 'select(.flow.source.namespace != null and .flow.destination.namespace != null and
    .flow.source.namespace != .flow.destination.namespace) |
    "\(.flow.source.namespace) → \(.flow.destination.namespace)"' \
  | sort | uniq -c | sort -rn >> "$REPORT_FILE"

echo "보고서 생성 완료: $REPORT_FILE"
cat "$REPORT_FILE"
```

### 네트워크 세그먼테이션 검증

네트워크 세그먼테이션(segmentation)은 마이크로서비스 환경에서 blast radius를 줄이기 위한 핵심 보안 전략이다. Hubble을 사용하면 세그먼테이션이 의도대로 적용되었는지 검증할 수 있다.

**검증 방법론**:

1. **Positive Test**: 허용된 통신이 실제로 동작하는지 확인한다
2. **Negative Test**: 차단되어야 할 통신이 실제로 차단되는지 확인한다
3. **Gap Analysis**: 정책에 명시되지 않은 암묵적 허용 트래픽이 있는지 확인한다

```bash
# Positive Test: 허용된 통신 확인
# 이 프로젝트의 allow-nginx-to-httpbin 정책 검증
hubble observe --from-label "app=nginx-web" --to-label "app=httpbin" \
  --to-port 80 --verdict FORWARDED --last 10

# Negative Test: 차단 확인 (httpbin → nginx는 차단되어야 함)
hubble observe --from-label "app=httpbin" --to-label "app=nginx-web" \
  --verdict DROPPED --last 10

# Gap Analysis: 정책에 명시되지 않은 통신 탐색
hubble observe --namespace demo --verdict FORWARDED -o json --last 5000 \
  | jq -r '.flow | "\(.source.labels // [] | map(select(startswith("k8s:app="))) | join(",")) → \(.destination.labels // [] | map(select(startswith("k8s:app="))) | join(","))"' \
  | sort -u
```

### 데이터 유출 탐지 패턴

데이터 유출(data exfiltration)은 클러스터 내 민감 데이터가 외부로 전송되는 것을 의미한다. Hubble로 다음 패턴을 탐지할 수 있다.

**탐지 패턴**:

| 패턴 | 설명 | 탐지 방법 |
|------|------|----------|
| 대량 외부 전송 | 외부 IP로 비정상적으로 많은 트래픽 전송 | egress world traffic 볼륨 모니터링 |
| 비표준 포트 외부 통신 | 80/443 이외 포트로 외부 통신 | `--to-identity world --to-port`에서 비표준 포트 필터 |
| DNS 터널링 | DNS 쿼리를 이용한 데이터 전송 | 비정상적으로 긴 DNS 쿼리 도메인 |
| 비인가 외부 서비스 접근 | 허용 목록에 없는 외부 서비스 접근 | toFQDNs 정책 위반 |

```bash
# 비표준 포트 외부 통신 탐지
hubble observe --to-identity world --traffic-direction egress -o json --last 5000 \
  | jq -r 'select((.flow.l4.TCP.destination_port // 0) != 443 and
    (.flow.l4.TCP.destination_port // 0) != 80 and
    (.flow.l4.UDP.destination_port // 0) != 53) |
    .flow | "\(.source.namespace)/\(.source.pod_name) → \(.IP.destination):\(.l4.TCP.destination_port // .l4.UDP.destination_port)"' \
  | sort | uniq -c | sort -rn

# DNS 터널링 의심 탐지 (긴 도메인 쿼리)
hubble observe --protocol dns -o json --last 5000 \
  | jq -r 'select(.flow.l7.dns.query != null and (.flow.l7.dns.query | length) > 50) |
    "\(.flow.source.pod_name): \(.flow.l7.dns.query) (length: \(.flow.l7.dns.query | length))"'
```

### Hubble Timescape (장기 저장)

Hubble의 기본 ring buffer는 제한된 용량만 보유하므로 장기적인 보안 감사에는 적합하지 않다. Hubble Timescape(또는 외부 저장소 연동)를 사용하면 Flow 데이터를 장기 보관할 수 있다.

**장기 저장 옵션**:

| 방법 | 설명 | 적합한 상황 |
|------|------|-----------|
| Hubble Timescape | Isovalent Enterprise 기능으로, TimescaleDB에 Flow 저장 | 엔터프라이즈 환경 |
| Fluentd/Fluent Bit 연동 | hubble observe JSON 출력을 로그 수집기로 전달 | 기존 로그 파이프라인 활용 |
| Prometheus + Thanos | 메트릭 수준의 장기 저장 | 집계된 통계 장기 보존 |
| Custom exporter | gRPC API로 Flow를 수신하여 S3/Elasticsearch 등에 저장 | 커스텀 요구사항 |

**Fluentd 연동 예시**:

```bash
# hubble observe의 JSON 출력을 파일로 저장하는 DaemonSet
# 이후 Fluentd가 파일을 수집하여 Elasticsearch/S3에 전달

# 간단한 파이프라인 (PoC용):
hubble observe --follow --output json > /var/log/hubble/flows.json &

# Fluent Bit 설정 예:
# [INPUT]
#     Name tail
#     Path /var/log/hubble/flows.json
#     Parser json
#     Tag hubble.flows
#
# [OUTPUT]
#     Name es
#     Match hubble.flows
#     Host elasticsearch.logging.svc
#     Port 9200
#     Index hubble-flows
```

---

## 성능 튜닝

### Ring buffer 크기 최적화

Ring buffer 크기는 Hubble의 데이터 보존 능력과 메모리 사용량의 트레이드오프이다.

**최적 크기 산출 공식**:

```
필요 buffer 크기 = 초당 Flow 수 x 보존하고자 하는 시간(초)

예시:
- 초당 500 flows, 5분(300초) 보존 → 150,000 entries
- 초당 100 flows, 10분(600초) 보존 → 60,000 entries
- 초당 50 flows, 30분(1800초) 보존 → 90,000 entries
```

**현재 Flow rate 측정 방법**:
```bash
# hubble status로 현재 상태 확인
hubble status

# 출력 예시:
# Healthcheck (via localhost:4245): Ok
# Current/Max Flows: 4096/4096 (100.00%)
# Flows/s: 142.37

# Prometheus 메트릭으로 정확한 rate 확인
# rate(hubble_flows_processed_total[5m])
```

**Helm chart에서 buffer 크기 조정**:
```yaml
# cilium-values.yaml 또는 hubble-values.yaml
hubble:
  eventBufferCapacity: 65536   # 기본 4096에서 증가
  # 또는 cilium-agent의 args로 직접 지정:
  # --hubble-event-buffer-capacity=65536
```

**주의**: buffer 크기를 늘리면 각 노드의 cilium-agent 메모리 사용량이 증가한다. 노드 수가 많은 클러스터에서는 전체 메모리 영향을 고려해야 한다.

### 메트릭 수집 부하 관리

Hubble 메트릭 핸들러의 수와 label 카디널리티에 따라 CPU/메모리 부하가 달라진다.

**핸들러별 부하 수준**:

| 핸들러 | CPU 부하 | 시계열 수 | 권장 여부 |
|--------|---------|----------|----------|
| flow | 낮음 | ~10 | 항상 권장 |
| drop | 낮음 | ~20 (reason별) | 항상 권장 |
| tcp | 낮음 | ~10 (flag별) | 항상 권장 |
| dns | 중간 | ~50 (rcode별) | 권장 |
| http | 중간-높음 | ~100+ (method x status) | 필요 시 |
| httpV2 + labelsContext | 높음 | ~1000+ (workload 쌍) | 주의 필요 |
| port-distribution | 높음 | ~1000+ (포트별) | 주의 필요 |
| icmp | 낮음 | ~10 | 선택적 |

**부하 최적화 전략**:
1. 필수 핸들러(flow, drop, tcp)만 활성화하고, 필요에 따라 추가한다
2. httpV2의 labelsContext는 workload 수준까지만 사용한다 (pod 수준은 피한다)
3. port-distribution은 디버깅 시에만 일시적으로 활성화한다
4. Prometheus scrape interval을 15초에서 30초로 늘려 부하를 줄일 수 있다

### L7 visibility 활성화 시 성능 영향

L7 가시성을 활성화하면 해당 트래픽이 Envoy proxy를 통과하게 되어 추가적인 지연과 리소스 소비가 발생한다.

**성능 영향**:

| 항목 | L7 비활성화 | L7 활성화 | 영향 |
|------|-----------|----------|------|
| 추가 레이턴시 | 0 | 0.1-1ms | Envoy proxy 경유에 의한 지연 |
| CPU (per 1000 req/s) | 0 | ~50-100m CPU | proxy 프로세스의 CPU 사용 |
| 메모리 | 0 | ~30-50 MB | Envoy 프로세스 메모리 |
| 연결 수 | 직접 연결 | 2x 연결 | proxy 양쪽으로 연결 설정 |

**최적화 권장사항**:
1. 전체 트래픽에 L7 가시성을 활성화하지 말고, 필요한 서비스에만 선택적으로 적용한다
2. Pod annotation 방식(`policy.cilium.io/proxy-visibility`)으로 개별 Pod에 적용하면 범위를 제한할 수 있다
3. 프로덕션 환경에서는 모니터링할 프로토콜을 한정한다 (예: HTTP만 활성화, DNS는 toFQDNs로 자동)
4. proxy의 리소스 제한을 설정하여 과도한 리소스 사용을 방지한다

### hubble-relay 리소스 설정

hubble-relay의 리소스 요구사항은 클러스터 규모와 Flow throughput에 따라 결정된다.

**규모별 권장 리소스**:

| 클러스터 규모 | CPU requests | CPU limits | Memory requests | Memory limits | Replicas |
|-------------|-------------|-----------|----------------|--------------|----------|
| ~10 노드 | 50m | 500m | 64Mi | 256Mi | 1 |
| ~50 노드 | 100m | 1000m | 128Mi | 512Mi | 2 |
| ~100 노드 | 200m | 2000m | 256Mi | 1Gi | 2-3 |
| ~500 노드 | 500m | 4000m | 512Mi | 2Gi | 3 |

**Helm chart 설정**:

```yaml
hubble:
  relay:
    replicas: 2
    resources:
      requests:
        cpu: 100m
        memory: 128Mi
      limits:
        cpu: 1000m
        memory: 512Mi
    # gRPC 연결 관련 튜닝
    dialTimeout: 5s           # 연결 타임아웃
    retryTimeout: 10s         # 재시도 타임아웃
    sortBufferLenMax: 100     # 정렬 버퍼 최대 길이
    sortBufferDrainTimeout: 1s # 정렬 버퍼 drain 타임아웃
```

---

