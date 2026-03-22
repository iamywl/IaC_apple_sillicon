# Day 5: 성능 최적화, 트러블슈팅, 보안

쿼리 최적화, Ingester 튜닝, Chunk/Index 최적화, Compactor 관리, 일반적 오류 진단, TLS 설정, 인증/인가, 감사 로그를 학습한다.

---

## 성능 최적화

### 레이블 설계 모범 사례 (Cardinality 관리)

레이블 카디널리티는 Loki 성능에 가장 큰 영향을 미치는 요소이다. 카디널리티가 높을수록 활성 스트림 수가 증가하고, Ingester의 메모리 사용량이 증가하며, 인덱스 크기가 비대해진다.

**카디널리티 수준별 가이드:**

| 수준 | 고유 값 수 | 예시 | 레이블 적합성 |
|------|----------|------|-------------|
| 매우 낮다 | ~5 | level (debug, info, warn, error, fatal) | 매우 적합하다 |
| 낮다 | ~10-50 | namespace, env, region | 적합하다 |
| 보통 | ~100-1000 | app, service | 주의가 필요하다 |
| 높다 | ~10000+ | pod (ReplicaSet 스케일에 따라) | 신중하게 판단한다 |
| 매우 높다 | ~무한 | request_id, user_id, ip | 절대 레이블로 사용하지 않는다 |

**활성 스트림 수 계산:**
```
활성 스트림 수 = 레이블1의 고유값 × 레이블2의 고유값 × ... × 레이블N의 고유값

예: namespace(5) × app(20) × pod(100) × level(4) = 40,000 스트림
    → 각 스트림이 Ingester에서 ~1KB의 메모리를 소비한다고 가정하면
    → 40,000 × 1KB = ~40MB (관리 가능)

예: namespace(5) × app(20) × pod(100) × level(4) × user_id(100,000) = 4,000,000,000 스트림
    → 메모리 소진, Loki 장애 발생
```

**모범 사례 요약:**
1. Kubernetes가 자동으로 부여하는 레이블(namespace, pod, container)을 기본으로 사용한다
2. `level`처럼 카디널리티가 매우 낮은 값만 동적 레이블로 추가한다
3. 고카디널리티 값은 로그 본문에 포함하고, LogQL의 Parser로 쿼리 시점에 추출한다
4. `max_streams_per_user` 설정으로 스트림 폭증을 방지한다
5. Loki의 `/metrics` 엔드포인트에서 `loki_ingester_streams_created_total`을 모니터링한다

### 쿼리 최적화

**시간 범위 제한:**
- 쿼리 시간 범위가 넓을수록 더 많은 Chunk를 읽어야 하므로 느려진다
- 가능하면 시간 범위를 최소화한다 (24시간 이내 권장)
- `max_query_length`로 최대 쿼리 범위를 제한할 수 있다

**레이블 필터 우선:**
- Stream Selector에서 레이블 필터로 대상을 좁히는 것이 가장 효과적이다
- 레이블 필터는 인덱스를 사용하므로 O(1)에 가깝고, Line Filter는 로그 본문을 스캔하므로 O(n)이다

**Line Filter 순서:**
- 가장 선택적인(많이 걸러내는) 필터를 먼저 배치한다
- 문자열 포함(`|=`)이 정규식(`|~`)보다 빠르다
- Parser 전에 Line Filter를 적용하면 파싱할 로그 수가 줄어든다

```logql
# 좋은 쿼리: 레이블로 범위를 좁히고, line filter로 추가 필터링
{namespace="demo", app="api"} |= "error" | json | status >= 500

# 나쁜 쿼리: 넓은 범위에서 파싱 후 필터링
{namespace=~".+"} | json | app = "api" | level = "error"
```

**특정 키만 파싱:**
```logql
# 나쁜 예: 모든 JSON 키를 파싱 (느림)
{app="api"} | json | status >= 500

# 좋은 예: 필요한 키만 파싱 (빠름)
{app="api"} | json status | status >= 500
```

### Chunk 크기와 Flush 간격 조정

| 설정 | 작은 값 | 큰 값 |
|------|--------|-------|
| `chunk_target_size` | Chunk가 자주 Flush되어 Object Storage에 작은 파일이 많아진다 | Chunk가 Ingester 메모리에 오래 머물러 메모리 사용량이 증가한다 |
| `max_chunk_age` | 오래된 Chunk가 빨리 Flush된다 | Ingester 메모리에 오래 머문다 |
| `chunk_idle_period` | 비활성 스트림의 Chunk가 빨리 Flush된다 | 비활성 스트림이 메모리를 오래 점유한다 |

**권장 설정:**
```yaml
ingester:
  chunk_target_size: 1572864     # 1.5MB (기본값, 대부분의 환경에 적합)
  max_chunk_age: 2h              # 2시간 (기본값)
  chunk_idle_period: 30m         # 30분 (기본값)
  # 로그 볼륨이 매우 큰 환경에서는:
  # chunk_target_size: 2621440   # 2.5MB로 증가
  # max_chunk_age: 1h            # 1시간으로 단축
```

### 캐시 활용

**Query Results Cache:**
- Query Frontend에서 쿼리 결과를 캐싱한다
- 동일한 쿼리의 반복 실행을 즉시 반환한다
- 분할된 하위 쿼리 단위로 캐싱되므로, 시간 범위가 일부 겹치는 쿼리도 캐시 히트가 가능하다
- Grafana Dashboard에서 같은 쿼리가 반복 실행될 때 가장 효과적이다

**Chunks Cache:**
- Object Storage에서 로드한 Chunk를 캐싱한다
- 같은 시간대의 로그를 여러 번 조회할 때 Object Storage 호출을 줄인다
- 캐시 크기는 가장 자주 조회하는 시간 범위의 Chunk 크기에 맞춰 설정한다

**Index Cache:**
- 인덱스 조회 결과를 캐싱한다
- 같은 레이블 조합의 쿼리가 반복될 때 효과적이다

### Ingester 리소스 설정

Ingester는 Loki에서 가장 많은 메모리를 소비하는 컴포넌트이다.

```yaml
# Kubernetes 리소스 설정 예시
resources:
  requests:
    cpu: "1"
    memory: "4Gi"
  limits:
    cpu: "2"
    memory: "8Gi"
```

**메모리 사용량 추정:**
```
Ingester 메모리 ≈ (활성 스트림 수 × 스트림당 메모리) + (WAL 리플레이 메모리)

스트림당 메모리 ≈ chunk_target_size + 오버헤드 (~2KB)
예: 50,000 스트림 × 1.5MB = ~75GB → 실제로는 청크가 점진적으로 채워지므로 이보다 적다
    50,000 스트림 × ~500KB (평균) = ~25GB
```

**OOM 방지 전략:**
- `max_streams_per_user`로 스트림 수를 제한한다
- `chunk_target_size`를 줄여 청크당 메모리 사용량을 낮춘다
- `chunk_idle_period`를 줄여 비활성 스트림을 빨리 Flush한다
- WAL의 `replay_memory_ceiling`을 설정하여 복구 시 메모리 급증을 방지한다

### 대용량 환경에서의 수평 확장

**Write Path 확장:**
```
트래픽 증가 → Distributor 인스턴스 추가 (Stateless, 쉽게 확장 가능)
           → Ingester 인스턴스 추가 (Stateful, Hash Ring 자동 조정)
```

**Read Path 확장:**
```
쿼리 부하 증가 → Querier 인스턴스 추가 (Stateless)
              → Query Frontend 인스턴스 추가 (Stateless)
              → 캐시 클러스터 확장 (Memcached 노드 추가)
```

**확장 순서:**
1. 먼저 캐시를 도입한다 (가장 효과적인 성능 향상)
2. Querier를 수평 확장한다 (Read Path 병목 해소)
3. Ingester를 수평 확장한다 (Write Path 병목 해소)
4. Object Storage의 처리량을 확인한다 (S3 Rate Limit 등)

**Ingester 확장 시 주의사항:**
- Ingester를 추가하면 Hash Ring이 자동으로 재조정된다
- 재조정 중에는 일부 스트림이 새 Ingester로 마이그레이션된다
- 한 번에 많은 Ingester를 추가/제거하면 성능이 일시적으로 저하될 수 있다
- 점진적으로 확장하는 것이 안전하다 (한 번에 1~2개씩)

---

## 트러블슈팅

### 로그 수집이 안 되는 경우 (Promtail 진단)

**확인 순서:**

1. **Promtail Pod 상태 확인:**
```bash
kubectl get pods -n monitoring -l app=promtail
kubectl describe pod -n monitoring <promtail-pod-name>
kubectl logs -n monitoring <promtail-pod-name> --tail=100
```

2. **Promtail 타겟 확인:**
```bash
# Promtail의 /targets 엔드포인트로 수집 대상 확인
kubectl port-forward -n monitoring <promtail-pod> 9080:9080
curl http://localhost:9080/targets
# state: "Ready"인 타겟이 있어야 한다
```

3. **Promtail 메트릭 확인:**
```bash
curl http://localhost:9080/metrics | grep -E "promtail_targets_active|promtail_read_bytes_total|promtail_sent_bytes_total"
# promtail_targets_active_total: 활성 수집 대상 수
# promtail_read_bytes_total: 읽은 바이트 수 (증가해야 함)
# promtail_sent_bytes_total: Loki로 전송한 바이트 수 (증가해야 함)
```

4. **일반적인 원인과 해결:**

| 증상 | 원인 | 해결 |
|------|------|------|
| 타겟이 0개이다 | Service Discovery 설정 오류이다 | `kubernetes_sd_configs`의 `role`과 `namespaces` 확인 |
| 타겟이 Ready이지만 로그가 없다 | 로그 파일 경로가 잘못되었다 | `__path__` 레이블과 실제 파일 경로 일치 확인 |
| 전송 실패 (429 에러) | Rate Limit 초과이다 | `ingestion_rate_mb`와 `ingestion_burst_size_mb` 증가 |
| 전송 실패 (400 에러) | 레이블 검증 실패이다 | 레이블 이름/값 길이, 레이블 수 제한 확인 |
| 전송 실패 (500 에러) | Loki 서버 오류이다 | Loki 로그 및 상태 확인 |
| positions.yaml 오류 | 파일 권한 문제이다 | Promtail의 파일시스템 마운트와 권한 확인 |

### 쿼리가 느린 경우 (Query Frontend 분석)

**확인 순서:**

1. **쿼리 시간 범위 확인:**
   - 시간 범위가 7일 이상이면 `split_queries_by_interval`에 의해 많은 하위 쿼리가 생성된다
   - 시간 범위를 줄여서 테스트한다

2. **Stream Selector 확인:**
   - `{namespace=~".+"}` 같은 넓은 범위의 Selector는 모든 스트림을 스캔하므로 느리다
   - 가능한 한 구체적인 레이블 매처를 사용한다

3. **Query Frontend 메트릭 확인:**
```bash
# 쿼리 지연 시간 (히스토그램)
curl http://localhost:3100/metrics | grep loki_request_duration_seconds
# 쿼리 대기열 길이
curl http://localhost:3100/metrics | grep cortex_query_frontend_queue_length
```

4. **캐시 히트율 확인:**
```bash
curl http://localhost:3100/metrics | grep -E "cache_hit|cache_miss"
# 캐시 히트율이 낮으면 캐시 크기를 늘리거나 TTL을 조정한다
```

5. **일반적인 최적화:**

| 증상 | 원인 | 해결 |
|------|------|------|
| 모든 쿼리가 느리다 | Querier 리소스 부족이다 | Querier 인스턴스 추가 또는 CPU/메모리 증가 |
| 특정 쿼리만 느리다 | 쿼리 범위가 넓다 | 레이블 필터 추가, 시간 범위 축소 |
| 첫 번째 쿼리만 느리다 | 캐시가 비어있다 | 정상 동작 (캐시 워밍업 필요) |
| 쿼리 타임아웃 | `query_timeout` 초과이다 | 쿼리 최적화 또는 `query_timeout` 증가 |

### 스토리지 용량 증가 관리

**용량 모니터링:**
```logql
# Loki의 저장 용량 메트릭 (Prometheus에서 조회)
loki_ingester_chunks_stored_total          # 저장된 Chunk 수
loki_ingester_chunk_stored_bytes_total     # 저장된 바이트 수
```

**용량 절감 방법:**
1. **Retention 설정**: Compactor의 Retention을 활성화하여 오래된 데이터를 자동 삭제한다
2. **불필요한 로그 드롭**: Promtail의 `drop` Stage로 debug 로그, healthcheck 로그 등을 버린다
3. **압축률 높은 인코딩 사용**: `gzip` 또는 `zstd`로 압축률을 높인다
4. **스트림 레이블 최적화**: 불필요한 레이블을 제거하여 인덱스 크기를 줄인다

### Rate Limiting 에러 대응

**증상:** Promtail 로그에 `429 Too Many Requests` 또는 `server returned HTTP status 429` 에러가 나타난다.

**원인과 해결:**
```yaml
# 1. 전역 Rate Limit 증가
limits_config:
  ingestion_rate_mb: 20            # 기본값 4 → 20으로 증가
  ingestion_burst_size_mb: 40      # 기본값 6 → 40으로 증가

# 2. 테넌트별 Rate Limit 조정
overrides:
  heavy-tenant:
    ingestion_rate_mb: 50
    ingestion_burst_size_mb: 100

# 3. Promtail에서 불필요한 로그 드롭 (근본적 해결)
pipeline_stages:
  - drop:
      expression: ".*healthcheck.*"
  - drop:
      source: level
      value: "debug"
```

### OOM 에러 대응

**증상:** Ingester 또는 Querier Pod가 OOMKilled 상태로 재시작된다.

**Ingester OOM 원인과 해결:**
| 원인 | 진단 | 해결 |
|------|------|------|
| 활성 스트림이 너무 많다 | `loki_ingester_memory_streams` 메트릭 확인 | `max_streams_per_user` 제한, 고카디널리티 레이블 제거 |
| Chunk가 Flush되지 않는다 | `loki_ingester_chunks_flushed_total` 확인 | Object Storage 연결 확인, `flush_op_timeout` 조정 |
| WAL 리플레이 메모리 급증 | 재시작 직후 OOM 발생 | `replay_memory_ceiling` 설정 |

**Querier OOM 원인과 해결:**
| 원인 | 진단 | 해결 |
|------|------|------|
| 쿼리 범위가 너무 넓다 | 쿼리 로그에서 시간 범위 확인 | `max_query_length` 제한 |
| 결과가 너무 크다 | 쿼리 결과 행 수 확인 | `max_query_series` 제한, `max_entries_limit_per_query` 제한 |
| Chunk 로드 과다 | Chunk 캐시 미스율 확인 | 캐시 도입 또는 크기 증가 |

### 로그 누락 진단

**로그가 일부만 수집되는 경우:**

1. **타임스탬프 순서 확인:**
   - Loki는 기본적으로 동일 스트림 내에서 타임스탬프가 단조 증가해야 한다
   - 타임스탬프가 뒤섞이면 `entry out of order` 에러로 로그가 거부된다
   - `unordered_writes: true` 설정으로 비순차 로그를 허용할 수 있다

2. **Rate Limit 확인:**
   - `loki_distributor_lines_received_total`과 `loki_discarded_samples_total` 메트릭을 비교한다
   - 차이가 있으면 Rate Limit에 의해 로그가 버려진 것이다

3. **Promtail의 Positions 파일 확인:**
   - Promtail이 재시작되면서 Positions 파일을 잃었을 수 있다
   - 이 경우 재시작 이전의 로그가 수집되지 않는다

4. **Pipeline Stage의 drop 설정 확인:**
   - 의도치 않은 `drop` Stage가 로그를 버리고 있을 수 있다
   - `promtail_custom_<metric>_total` 메트릭으로 드롭된 로그 수를 확인한다

```yaml
# 비순차 로그 허용 설정
limits_config:
  unordered_writes: true            # 타임스탬프 순서를 강제하지 않는다
```

---

## 보안

### TLS 설정

Loki 컴포넌트 간의 통신(gRPC)과 클라이언트와의 통신(HTTP)에 TLS를 적용할 수 있다.

**HTTP 서버 TLS (클라이언트 → Loki):**
```yaml
server:
  http_tls_config:
    cert_file: /certs/server.crt
    key_file: /certs/server.key
    client_auth_type: RequireAndVerifyClientCert  # mTLS
    client_ca_file: /certs/ca.crt
```

**gRPC 서버 TLS (Distributor → Ingester 등):**
```yaml
server:
  grpc_tls_config:
    cert_file: /certs/server.crt
    key_file: /certs/server.key
    client_auth_type: RequireAndVerifyClientCert
    client_ca_file: /certs/ca.crt
```

**gRPC 클라이언트 TLS (Ingester에 연결하는 Distributor 등):**
```yaml
ingester_client:
  grpc_client_config:
    tls_cert_path: /certs/client.crt
    tls_key_path: /certs/client.key
    tls_ca_path: /certs/ca.crt
    tls_server_name: ingester.loki.svc
    tls_insecure_skip_verify: false
```

**Kubernetes 환경에서의 TLS 관리:**
- cert-manager를 사용하여 TLS 인증서를 자동으로 생성하고 갱신할 수 있다
- Kubernetes Secret으로 인증서를 관리하고, Pod에 마운트한다
- Service Mesh(Istio, Linkerd)를 사용하면 애플리케이션 레벨 TLS 없이도 mTLS가 가능하다

### 인증/인가: 멀티테넌트 환경에서의 접근 제어

Loki 자체는 인증(Authentication) 기능을 내장하고 있지 않다. 멀티테넌트 환경에서 접근 제어를 구현하려면 Reverse Proxy를 사용해야 한다.

**Reverse Proxy를 이용한 인증 아키텍처:**
```
┌──────────┐     ┌──────────────┐     ┌──────────┐
│ Promtail │────→│ Auth Proxy   │────→│   Loki   │
│          │     │ (nginx,      │     │          │
│          │     │  Envoy,      │     │          │
│          │     │  OAuth2 Proxy│     │          │
│          │     │  등)         │     │          │
│          │     │              │     │          │
│          │     │ • 토큰 검증   │     │          │
│          │     │ • 테넌트 ID   │     │          │
│          │     │   주입        │     │          │
│          │     └──────────────┘     └──────────┘
└──────────┘
```

**OAuth2 Proxy를 사용한 인증 예시:**
```yaml
# OAuth2 Proxy 설정
apiVersion: apps/v1
kind: Deployment
metadata:
  name: oauth2-proxy
spec:
  template:
    spec:
      containers:
        - name: oauth2-proxy
          image: quay.io/oauth2-proxy/oauth2-proxy
          args:
            - --upstream=http://loki:3100
            - --provider=oidc
            - --oidc-issuer-url=https://auth.example.com
            - --email-domain=example.com
            - --pass-access-token=true
            - --set-xauthrequest=true
```

**Grafana에서의 접근 제어:**
- Grafana의 데이터소스 설정에서 `X-Scope-OrgID` 헤더를 고정하여 특정 테넌트만 조회하도록 제한할 수 있다
- Grafana의 Organization과 Loki의 Tenant를 1:1로 매핑하여 조직별 접근 제어를 구현할 수 있다
- Grafana의 RBAC(Role-Based Access Control)로 사용자별 데이터소스 접근 권한을 제어할 수 있다

### 민감 데이터 마스킹

로그에 포함된 민감 데이터(비밀번호, API 키, 개인정보 등)를 Promtail의 Pipeline Stage에서 마스킹할 수 있다.

**replace Stage를 사용한 마스킹:**
```yaml
pipeline_stages:
  # 비밀번호 마스킹
  - replace:
      expression: '(?i)(password|passwd|pwd)\s*[=:]\s*\S+'
      replace: '${1}=***REDACTED***'

  # API 키 마스킹
  - replace:
      expression: '(?i)(api[_-]?key|api[_-]?secret|token)\s*[=:]\s*[A-Za-z0-9_\-]+'
      replace: '${1}=***REDACTED***'

  # 이메일 마스킹
  - replace:
      expression: '[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}'
      replace: '***@***.***'

  # 신용카드 번호 마스킹 (16자리 숫자)
  - replace:
      expression: '\b\d{4}[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{4}\b'
      replace: '****-****-****-****'

  # 주민등록번호 마스킹 (한국)
  - replace:
      expression: '\b\d{6}[\s\-]?\d{7}\b'
      replace: '******-*******'

  # Bearer 토큰 마스킹
  - replace:
      expression: '(?i)bearer\s+[A-Za-z0-9\._\-]+'
      replace: 'Bearer ***REDACTED***'
```

**주의사항:**
- 마스킹은 Promtail(수집 시점)에서 수행해야 한다. Loki에 저장된 후에는 마스킹할 수 없다
- 정규식이 너무 넓으면 정상적인 로그 데이터까지 마스킹될 수 있다
- 마스킹 정규식의 성능을 테스트하여 Promtail의 CPU 사용량에 미치는 영향을 확인한다
- GDPR, PIPA 등 규정 준수를 위해 민감 데이터가 로그에 기록되지 않도록 애플리케이션 레벨에서 방지하는 것이 가장 좋다

---

