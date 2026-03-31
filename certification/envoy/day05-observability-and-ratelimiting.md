# Day 5: 관찰성 및 Rate Limiting

> Envoy의 관찰성(통계, 분산 추적, 액세스 로깅) 기능과 Rate Limiting(Local/Global) 심화를 학습한다.

## 관찰성 (Observability)

### Stats (통계)

Envoy는 세 가지 타입의 통계를 제공한다:

| 타입 | 설명 | 예시 |
|------|------|------|
| Counter | 단조 증가하는 누적 카운터 | `downstream_rq_total`, `upstream_cx_connect_fail` |
| Gauge | 현재 값을 나타내는 게이지 | `downstream_cx_active`, `upstream_cx_pool_active` |
| Histogram | 값의 분포를 나타내는 히스토그램 | `upstream_rq_time`, `downstream_rq_time` |

### 주요 통계 카테고리

**Downstream (클라이언트 방향):**
```
# 연결 통계
downstream_cx_total         # 총 수신 연결 수
downstream_cx_active        # 현재 활성 연결 수
downstream_cx_destroy       # 종료된 연결 수
downstream_cx_ssl_total     # TLS 연결 수

# 요청 통계
downstream_rq_total         # 총 요청 수
downstream_rq_active        # 현재 활성 요청 수
downstream_rq_1xx           # 1xx 응답 수
downstream_rq_2xx           # 2xx 응답 수
downstream_rq_3xx           # 3xx 응답 수
downstream_rq_4xx           # 4xx 응답 수
downstream_rq_5xx           # 5xx 응답 수
downstream_rq_time          # 요청 처리 시간 히스토그램

# HTTP/2 통계
downstream_cx_http2_total   # HTTP/2 연결 수
downstream_cx_http2_active  # 현재 활성 HTTP/2 연결 수
```

**Upstream (백엔드 방향):**
```
# 연결 통계
upstream_cx_total            # 총 업스트림 연결 수
upstream_cx_active           # 현재 활성 업스트림 연결 수
upstream_cx_connect_fail     # 연결 실패 수
upstream_cx_connect_timeout  # 연결 타임아웃 수
upstream_cx_pool_overflow    # 연결 풀 오버플로 수

# 요청 통계
upstream_rq_total            # 총 업스트림 요청 수
upstream_rq_active           # 현재 활성 업스트림 요청 수
upstream_rq_timeout          # 업스트림 타임아웃 수
upstream_rq_retry            # 재시도 수
upstream_rq_retry_success    # 재시도 성공 수
upstream_rq_retry_overflow   # 재시도 오버플로 (서킷 브레이커)
upstream_rq_time             # 업스트림 응답 시간 히스토그램
upstream_rq_pending_total    # 대기 중인 요청 수
upstream_rq_pending_overflow # 대기 큐 오버플로 (서킷 브레이커)
```

### Access Logging

Envoy는 요청/응답에 대한 상세한 액세스 로그를 제공한다.

#### 주요 Format String 변수

| 변수 | 설명 |
|------|------|
| `%START_TIME%` | 요청 시작 시간이다 |
| `%REQ(:METHOD)%` | HTTP 메서드이다 |
| `%REQ(X-ENVOY-ORIGINAL-PATH?:PATH)%` | 요청 경로이다 |
| `%PROTOCOL%` | HTTP 프로토콜 버전이다 |
| `%RESPONSE_CODE%` | HTTP 응답 코드이다 |
| `%RESPONSE_FLAGS%` | 응답 플래그이다 (UF=upstream failure, UO=upstream overflow 등) |
| `%BYTES_RECEIVED%` | 수신 바이트 수이다 |
| `%BYTES_SENT%` | 송신 바이트 수이다 |
| `%DURATION%` | 총 요청 처리 시간(ms)이다 |
| `%UPSTREAM_HOST%` | 선택된 업스트림 호스트 주소이다 |
| `%UPSTREAM_CLUSTER%` | 선택된 업스트림 클러스터 이름이다 |
| `%UPSTREAM_SERVICE_TIME%` | 업스트림 서비스 처리 시간(ms)이다 |

### RESPONSE_FLAGS 주요 값

| 플래그 | 의미 |
|--------|------|
| `UF` | Upstream connection Failure이다 |
| `UO` | Upstream Overflow (서킷 브레이커 발동)이다 |
| `NR` | No Route configured이다 |
| `URX` | Upstream Retry limit exceeded이다 |
| `NC` | No Cluster found이다 |
| `DT` | Downstream request Timeout이다 |
| `DC` | Downstream Connection termination이다 |
| `RL` | Rate Limited이다 |
| `UAEX` | Unauthorized External service이다 |
| `UT` | Upstream request Timeout이다 |
| `LH` | Local service failed Health check이다 |
| `UH` | No Healthy upstream이다 |
| `RLSE` | Rate Limit Service Error이다 |
| `IH` | Idle timeout, Hcm에서 발생이다 |
| `SI` | Stream Idle timeout이다 |
| `DPE` | Downstream Protocol Error이다 |
| `UPE` | Upstream Protocol Error이다 |
| `UMSDR` | Upstream Maximum Stream Duration Reached이다 |

### Access Log 형식 상세

**Text Format (커스텀):**
```yaml
access_log:
  - name: envoy.access_loggers.file
    typed_config:
      "@type": type.googleapis.com/envoy.extensions.access_loggers.file.v3.FileAccessLog
      path: "/dev/stdout"
      log_format:
        text_format_source:
          inline_string: |
            [%START_TIME%] "%REQ(:METHOD)% %REQ(X-ENVOY-ORIGINAL-PATH?:PATH)% %PROTOCOL%"
            %RESPONSE_CODE% %RESPONSE_FLAGS% %BYTES_RECEIVED% %BYTES_SENT%
            %DURATION%ms %UPSTREAM_SERVICE_TIME%ms
            "%UPSTREAM_HOST%" "%UPSTREAM_CLUSTER%"
            "%REQ(X-REQUEST-ID)%" "%REQ(USER-AGENT)%"
            "%DOWNSTREAM_REMOTE_ADDRESS%" "%DOWNSTREAM_LOCAL_ADDRESS%"
```

**JSON Format (구조화된 로그):**
```yaml
access_log:
  - name: envoy.access_loggers.file
    typed_config:
      "@type": type.googleapis.com/envoy.extensions.access_loggers.file.v3.FileAccessLog
      path: "/dev/stdout"
      log_format:
        json_format:
          timestamp: "%START_TIME%"
          method: "%REQ(:METHOD)%"
          path: "%REQ(X-ENVOY-ORIGINAL-PATH?:PATH)%"
          protocol: "%PROTOCOL%"
          status_code: "%RESPONSE_CODE%"
          response_flags: "%RESPONSE_FLAGS%"
          bytes_received: "%BYTES_RECEIVED%"
          bytes_sent: "%BYTES_SENT%"
          duration_ms: "%DURATION%"
          upstream_service_time_ms: "%UPSTREAM_SERVICE_TIME%"
          upstream_host: "%UPSTREAM_HOST%"
          upstream_cluster: "%UPSTREAM_CLUSTER%"
          request_id: "%REQ(X-REQUEST-ID)%"
          downstream_remote_address: "%DOWNSTREAM_REMOTE_ADDRESS%"
          trace_id: "%REQ(X-B3-TRACEID)%"
```

**조건부 로깅 (특정 조건에서만 로그 기록):**
```yaml
access_log:
  - name: envoy.access_loggers.file
    typed_config:
      "@type": type.googleapis.com/envoy.extensions.access_loggers.file.v3.FileAccessLog
      path: "/dev/stdout"
    # 5xx 응답 또는 에러 플래그가 있을 때만 기록
    filter:
      or_filter:
        filters:
          - status_code_filter:
              comparison:
                op: GE
                value:
                  default_value: 500
                  runtime_key: access_log_min_status
          - response_flag_filter:
              flags: ["UF", "UO", "NR", "URX", "UT"]
```

### Access Log Sink

Envoy는 로그를 다양한 대상으로 전송할 수 있다:
- **파일 출력**: 로컬 파일에 기록한다. 가장 일반적이다.
- **gRPC Access Log Service (ALS)**: gRPC 스트리밍으로 외부 로그 수집 서비스에 전송한다. 중앙 집중형 로그 관리에 적합하다.
- **stdout/stderr**: 컨테이너 환경에서 표준 출력으로 내보내고, 로그 수집기(Fluentd, Vector 등)가 수집한다.
- **Open Telemetry**: OpenTelemetry Collector로 직접 전송한다.

### Tracing Headers

분산 추적을 위해 Envoy는 다음 헤더를 전파한다:

**B3 헤더 (Zipkin/Jaeger):**
```
x-b3-traceid:      128비트 트레이스 ID
x-b3-spanid:       64비트 스팬 ID
x-b3-parentspanid: 부모 스팬 ID
x-b3-sampled:      샘플링 여부 (1=yes, 0=no)
x-b3-flags:        디버그 플래그
```

**W3C Trace Context:**
```
traceparent: 00-<trace-id>-<span-id>-<trace-flags>
tracestate:  vendor-specific data
```

**Envoy 내부 헤더:**
```
x-request-id:          Envoy가 생성하는 고유 요청 ID (UUID v4)
x-envoy-attempt-count: 재시도 횟수
x-envoy-upstream-service-time: 업스트림 처리 시간 (ms)
x-envoy-expected-rq-timeout-ms: 라우터가 설정한 요청 타임아웃
```

**중요**: 애플리케이션이 분산 추적 헤더를 전파(propagation)해야 한다. Envoy는 인바운드 요청의 추적 헤더를 자동으로 아웃바운드 요청에 복사하지 않는다. 애플리케이션 코드에서 수신한 추적 헤더를 송신 요청에 포함시켜야 한다.

### Admin 인터페이스 엔드포인트

| 엔드포인트 | 메서드 | 설명 |
|------------|--------|------|
| `/` | GET | 전체 Admin 엔드포인트 목록 |
| `/help` | GET | 사용 가능한 명령어 도움말 |
| `/ready` | GET | Envoy가 트래픽을 처리할 준비가 되었는지 |
| `/server_info` | GET | 서버 정보 (버전, 가동 시간, Hot Restart 세대) |
| `/stats` | GET | 전체 통계 (텍스트 형식) |
| `/stats?format=json` | GET | 전체 통계 (JSON 형식) |
| `/stats?filter=<regex>` | GET | 특정 패턴의 통계만 출력 |
| `/stats/prometheus` | GET | Prometheus 형식 메트릭 |
| `/stats/recentlookups` | GET | 최근 조회된 통계 이름 |
| `/clusters` | GET | 클러스터별 엔드포인트 상태 |
| `/config_dump` | GET | 현재 적용된 전체 설정 |
| `/config_dump?resource=<type>` | GET | 특정 리소스 타입의 설정만 |
| `/config_dump?include_eds` | GET | EDS 정보 포함 |
| `/logging` | GET | 현재 로그 레벨 |
| `/logging?level=<level>` | POST | 전체 로그 레벨 변경 |
| `/logging?<component>=<level>` | POST | 특정 컴포넌트 로그 레벨 변경 |
| `/reset_counters` | POST | 모든 카운터 리셋 |
| `/drain_listeners` | POST | Listener drain 시작 |
| `/healthcheck/ok` | POST | 헬스체크를 OK로 설정 |
| `/healthcheck/fail` | POST | 헬스체크를 FAIL로 설정 |
| `/quitquitquit` | POST | Envoy 프로세스 종료 |

---

## Rate Limiting 심화

### Local Rate Limiting

각 Envoy 인스턴스 내에서 독립적으로 동작하는 Rate Limiter이다. 외부 서비스 의존성이 없어 빠르고 단순하다:

```yaml
http_filters:
  - name: envoy.filters.http.local_ratelimit
    typed_config:
      "@type": type.googleapis.com/envoy.extensions.filters.http.local_ratelimit.v3.LocalRateLimit
      stat_prefix: http_local_rate_limiter
      token_bucket:
        max_tokens: 1000                # 최대 토큰 수
        tokens_per_fill: 1000           # 채우기당 토큰 수
        fill_interval: 60s              # 채우기 간격
      filter_enabled:
        default_value:
          numerator: 100
          denominator: HUNDRED
      filter_enforced:
        default_value:
          numerator: 100
          denominator: HUNDRED
      response_headers_to_add:
        - append_action: OVERWRITE_IF_EXISTS_OR_ADD
          header:
            key: x-ratelimit-limit
            value: "1000"
        - append_action: OVERWRITE_IF_EXISTS_OR_ADD
          header:
            key: x-ratelimit-remaining
            value: "999"
      # 경로별 Rate Limit
      descriptors:
        - entries:
            - key: path
              value: "/api/expensive"
          token_bucket:
            max_tokens: 10              # /api/expensive는 분당 10회만 허용
            tokens_per_fill: 10
            fill_interval: 60s
```

**Local Rate Limit의 한계:**

```
Pod A (Envoy): 1000 req/min 제한
Pod B (Envoy): 1000 req/min 제한
Pod C (Envoy): 1000 req/min 제한

총 허용량: 3000 req/min (Pod 수에 비례)
→ 스케일 아웃하면 총 rate limit도 증가한다!
→ 글로벌 정밀 제어가 필요하면 Global Rate Limit을 사용해야 한다
```

### Global Rate Limiting

외부 Rate Limit 서비스와 연동하여 클러스터 전체에서 일관된 Rate Limiting을 적용한다:

```yaml
http_filters:
  - name: envoy.filters.http.ratelimit
    typed_config:
      "@type": type.googleapis.com/envoy.extensions.filters.http.ratelimit.v3.RateLimit
      domain: "backend_api"
      stage: 0
      request_type: both
      timeout: 0.05s                     # Rate Limit 서비스 타임아웃 (50ms)
      failure_mode_deny: false           # Rate Limit 서비스 장애 시 요청 허용
      rate_limit_service:
        grpc_service:
          envoy_grpc:
            cluster_name: rate_limit_cluster
        transport_api_version: V3
```

**Rate Limit Descriptor Actions:**

Route에서 어떤 기준으로 Rate Limit을 적용할지 정의한다:

```yaml
routes:
  - match:
      prefix: "/api/"
    route:
      cluster: backend
      rate_limits:
        # Action 1: 경로별 Rate Limit
        - actions:
            - request_headers:
                header_name: ":path"
                descriptor_key: "path"

        # Action 2: 클라이언트 IP별 Rate Limit
        - actions:
            - remote_address: {}

        # Action 3: 인증된 사용자별 Rate Limit
        - actions:
            - request_headers:
                header_name: "x-user-id"
                descriptor_key: "user_id"

        # Action 4: 복합 Rate Limit (경로 + 사용자)
        - actions:
            - request_headers:
                header_name: ":path"
                descriptor_key: "path"
            - request_headers:
                header_name: "x-user-id"
                descriptor_key: "user_id"

        # Action 5: Generic Key (고정 식별자)
        - actions:
            - generic_key:
                descriptor_value: "backend_api_global"
```

**Rate Limit 서비스 설정 (서버측):**

```yaml
# rate_limit_config.yaml (envoy-ratelimit 서비스)
domain: backend_api
descriptors:
  # 경로별 제한
  - key: path
    value: "/api/search"
    rate_limit:
      unit: minute
      requests_per_unit: 100

  # IP별 제한
  - key: remote_address
    rate_limit:
      unit: second
      requests_per_unit: 10

  # 사용자별 제한 (기본)
  - key: user_id
    rate_limit:
      unit: minute
      requests_per_unit: 60

  # 사용자별 + 경로별 복합 제한
  - key: path
    descriptors:
      - key: user_id
        rate_limit:
          unit: minute
          requests_per_unit: 10
```

### Local vs Global Rate Limiting 비교

| 특성 | Local Rate Limit | Global Rate Limit |
|------|-----------------|-------------------|
| 정확도 | Pod 단위 (Pod 수에 따라 총량 변동) | 클러스터 전체에서 정확 |
| 지연 | 없음 (인메모리) | 외부 서비스 호출 지연 (수 ms) |
| 의존성 | 없음 | Rate Limit 서비스 필요 |
| 장애 영향 | 독립적 | 서비스 장애 시 전체 영향 |
| 적합한 시나리오 | DDoS 방어, 대략적 제한 | API 과금, SLA 보장, 정밀 제어 |

실무에서는 **두 가지를 조합**하여 사용하는 것이 일반적이다: Local Rate Limit으로 극단적인 트래픽 급증을 막고, Global Rate Limit으로 정밀한 정책을 적용한다.

---

