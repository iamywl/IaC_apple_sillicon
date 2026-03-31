# Day 2: Reverse Proxy, Load Balancing, SSL/TLS, Rate Limiting

nginx의 리버스 프록시 심화, 로드 밸런싱 알고리즘, SSL/TLS Termination, Rate Limiting을 학습한다.

---

### 6. Reverse Proxy Deep Dive

#### proxy_pass 동작: trailing slash 유무의 차이

이것은 nginx에서 가장 흔한 혼동 포인트 중 하나이다.

```nginx
# Case 1: proxy_pass에 URI 없음 (trailing slash 없음)
location /api/ {
    proxy_pass http://backend;
}
# 요청: /api/users → upstream 요청: /api/users (경로 그대로 전달)

# Case 2: proxy_pass에 URI 있음 (trailing slash 있음)
location /api/ {
    proxy_pass http://backend/;
}
# 요청: /api/users → upstream 요청: /users (/api/ 부분이 / 로 치환)

# Case 3: proxy_pass에 다른 경로 지정
location /api/ {
    proxy_pass http://backend/v2/;
}
# 요청: /api/users → upstream 요청: /v2/users (/api/가 /v2/로 치환)
```

**규칙 요약**: `proxy_pass`에 URI 부분(`/`, `/v2/` 등)이 포함되면, location에서 매칭된 부분이 해당 URI로 **치환**된다. URI가 없으면 원본 경로가 **그대로** 전달된다.

#### proxy_set_header

upstream 서버로 전달할 HTTP 헤더를 설정한다. 기본값은 `Host`가 `$proxy_host`(upstream 이름)로, `Connection`이 `close`로 설정된다.

```nginx
location /api/ {
    proxy_pass http://backend;

    # 필수 헤더 설정
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host  $host;
    proxy_set_header X-Forwarded-Port  $server_port;
}
```

#### Proxy Buffering

nginx는 기본적으로 upstream 응답을 **버퍼에 저장**한 뒤 클라이언트에 전송한다. 이렇게 하면 upstream 연결을 빨리 해제할 수 있다.

```nginx
location /api/ {
    proxy_pass http://backend;

    # Buffering 활성화 (기본값)
    proxy_buffering on;

    # 응답 헤더를 읽을 버퍼 크기
    proxy_buffer_size 4k;

    # 응답 본문을 저장할 버퍼 (개수 x 크기)
    proxy_buffers 8 4k;

    # 버퍼가 이 크기만큼 차면 클라이언트로 전송 시작
    proxy_busy_buffers_size 8k;

    # 버퍼가 부족하면 임시 파일에 기록
    proxy_temp_file_write_size 16k;
}

# SSE(Server-Sent Events)나 스트리밍에는 buffering 비활성화
location /events/ {
    proxy_pass http://backend;
    proxy_buffering off;      # 응답을 즉시 클라이언트로 전달
}
```

**buffering on**: upstream이 빠르게 응답을 보내고 연결을 해제할 수 있다. upstream 리소스를 절약한다.

**buffering off**: 응답이 즉시 클라이언트로 전달된다. SSE, long-polling, 스트리밍에 필요하다. upstream 연결이 클라이언트 속도에 묶인다.

#### Proxy Timeout 심화

nginx는 upstream 통신의 각 단계에 대해 세밀한 타임아웃을 제공한다.

```nginx
location /api/ {
    proxy_pass http://backend;

    # upstream 서버에 TCP 연결을 수립하는 데 걸리는 최대 시간이다
    # 이 시간 내에 연결이 수립되지 않으면 502 Bad Gateway를 반환한다
    proxy_connect_timeout 5s;     # 기본값: 60s

    # upstream에 요청 본문을 전송하는 중, 두 번의 write 사이의 최대 대기 시간이다
    # 전체 전송 시간이 아니라, idle 시간을 측정한다
    proxy_send_timeout 10s;       # 기본값: 60s

    # upstream으로부터 응답을 읽는 중, 두 번의 read 사이의 최대 대기 시간이다
    # 응답이 느린 API에는 이 값을 높여야 한다
    proxy_read_timeout 30s;       # 기본값: 60s

    # upstream에서 응답 헤더를 읽기 위한 버퍼이다
    # 이 크기를 초과하는 헤더는 proxy_buffers를 사용한다
    proxy_buffer_size 8k;
}
```

#### 타임아웃과 HTTP 에러 코드의 관계

```
proxy_connect_timeout 초과  → 502 Bad Gateway
proxy_read_timeout 초과     → 504 Gateway Timeout
proxy_send_timeout 초과     → 504 Gateway Timeout
upstream 서버가 5xx 응답     → 해당 상태 코드 그대로 전달 (proxy_intercept_errors로 변경 가능)
모든 upstream 서버 실패      → 502 Bad Gateway
```

#### Proxy Cache

nginx는 upstream 응답을 디스크에 캐시하여, 동일 요청 시 upstream에 재요청하지 않을 수 있다.

```nginx
http {
    # 캐시 존(zone) 정의
    proxy_cache_path /var/cache/nginx
        levels=1:2               # 디렉토리 계층 (예: /var/cache/nginx/a/1b/)
        keys_zone=my_cache:10m   # 캐시 키 저장용 공유 메모리 (10MB ≈ 80,000 키)
        max_size=1g              # 디스크 캐시 최대 크기
        inactive=60m             # 60분간 미사용 시 삭제
        use_temp_path=off;       # 임시 파일 없이 직접 캐시 디렉토리에 기록

    server {
        location /api/ {
            proxy_pass http://backend;
            proxy_cache my_cache;
            proxy_cache_valid 200 302 10m;   # 200, 302 응답을 10분간 캐시
            proxy_cache_valid 404 1m;        # 404 응답을 1분간 캐시
            proxy_cache_key "$scheme$request_method$host$request_uri";

            # upstream 장애 시 stale 캐시 제공
            proxy_cache_use_stale error timeout updating
                                  http_500 http_502 http_503 http_504;

            # 캐시 상태를 응답 헤더에 추가 (디버깅용)
            add_header X-Cache-Status $upstream_cache_status;
            # HIT, MISS, EXPIRED, STALE, UPDATING, BYPASS 중 하나
        }
    }
}
```

#### Cache Purging

캐시를 수동으로 무효화해야 할 때는 `proxy_cache_purge` directive를 사용한다 (NGINX Plus 또는 ngx_cache_purge 모듈 필요). OSS 버전에서는 캐시 디렉토리의 파일을 직접 삭제하거나, `proxy_cache_bypass`와 `proxy_no_cache`를 활용한다.

```nginx
location /api/ {
    proxy_pass http://backend;
    proxy_cache my_cache;

    # 특정 헤더가 있으면 캐시를 우회하고 새로 가져옴
    proxy_cache_bypass $http_x_purge;
    proxy_no_cache $http_x_purge;
}
# curl -H "X-Purge: 1" http://example.com/api/resource 로 캐시 무효화
```

---

### 7. Load Balancing Algorithms

nginx는 `upstream` 블록에서 다양한 로드 밸런싱 알고리즘을 지원한다.

#### 알고리즘 비교

| 알고리즘 | 설정 | 특징 | 적합한 경우 |
|---------|------|------|-----------|
| Round Robin | (기본값) | 순차적으로 요청을 분배한다 | 서버 성능이 균일할 때 |
| Weighted Round Robin | `weight=N` | 가중치에 따라 분배 비율을 조정한다 | 서버 성능이 다를 때 |
| Least Connections | `least_conn` | 현재 활성 연결이 가장 적은 서버에 전달한다 | 요청 처리 시간이 불균일할 때 |
| IP Hash | `ip_hash` | 클라이언트 IP 기반으로 항상 같은 서버에 전달한다 | 세션 유지가 필요할 때 |
| Generic Hash | `hash $key` | 임의의 키를 해시하여 서버를 결정한다 | 캐시 효율을 높일 때 |
| Random Two Choices | `random two least_conn` | 무작위 2개 선택 후 연결이 적은 쪽을 사용한다 | 분산 환경에서 효율적 |

```nginx
# Weighted Round Robin
upstream backend {
    server 10.0.0.1:8080 weight=5;    # 5/8 비율로 요청 수신
    server 10.0.0.2:8080 weight=2;    # 2/8 비율
    server 10.0.0.3:8080 weight=1;    # 1/8 비율
}

# Least Connections
upstream backend_lc {
    least_conn;
    server 10.0.0.1:8080;
    server 10.0.0.2:8080;
    server 10.0.0.3:8080 backup;      # 다른 서버가 모두 down일 때만 사용
}

# IP Hash (세션 고정)
upstream backend_ip {
    ip_hash;
    server 10.0.0.1:8080;
    server 10.0.0.2:8080;
    server 10.0.0.3:8080 down;        # 이 서버는 사용하지 않음
}

# Generic Hash (URL 기반 캐시 분산)
upstream backend_hash {
    hash $request_uri consistent;     # consistent hashing (서버 추가/제거 시 영향 최소화)
    server 10.0.0.1:8080;
    server 10.0.0.2:8080;
}

# Random Two Choices (Power of Two Choices)
upstream backend_random {
    random two least_conn;
    server 10.0.0.1:8080;
    server 10.0.0.2:8080;
    server 10.0.0.3:8080;
}
```

#### 서버 상태 파라미터

```nginx
upstream backend {
    server 10.0.0.1:8080 weight=3 max_fails=3 fail_timeout=30s;
    server 10.0.0.2:8080 max_conns=100;   # 최대 동시 연결 수 제한
    server 10.0.0.3:8080 backup;           # 다른 서버가 모두 down일 때만 사용
    server 10.0.0.4:8080 down;             # 영구적으로 비활성화

    keepalive 32;    # upstream 연결을 재사용 (성능 향상)
}
```

- `max_fails`: 이 횟수만큼 연속 실패하면 서버를 unavailable로 표시한다 (기본값: 1)
- `fail_timeout`: unavailable 상태의 지속 시간이다. 이 시간이 지나면 다시 시도한다 (기본값: 10s)

#### Upstream Keepalive 연결

백엔드와의 TCP 연결을 재사용하여 핸드셰이크 오버헤드를 줄인다.

```nginx
upstream backend {
    server backend-1:8080;
    server backend-2:8080;
    keepalive 32;               # 각 Worker당 유지할 idle 연결 수
    keepalive_timeout 60s;      # idle 연결 유지 시간
}

location /api/ {
    proxy_pass http://backend;
    proxy_http_version 1.1;                # keepalive는 HTTP/1.1 필수
    proxy_set_header Connection "";         # Connection: close 헤더 제거
}
```

#### Passive Health Check vs Active Health Check

nginx OSS는 **passive health check**만 지원한다. upstream 서버에 요청을 전달했을 때 실패하면 해당 서버를 비활성화한다.

```nginx
upstream backend {
    server backend-1:8080 max_fails=3 fail_timeout=30s;
    # 30초 내 3번 실패하면 → 30초간 unavailable로 표시
    # 30초 후 다시 요청을 시도하여 성공하면 → 다시 available로 복원
    server backend-2:8080 max_fails=3 fail_timeout=30s;
}
```

**Active health check**는 NGINX Plus에서만 지원한다. 주기적으로 헬스체크 요청을 보내 서버 상태를 확인한다. OSS에서 유사한 기능이 필요하면 `nginx_upstream_check_module`(서드파티)을 사용하거나, Kubernetes의 readiness probe에 의존하는 방식을 사용한다.

---

### 8. SSL/TLS Termination

nginx에서 SSL/TLS를 종료(termination)하면, 백엔드 서버는 암호화 부담 없이 평문 HTTP를 처리할 수 있다.

```nginx
server {
    listen 443 ssl http2;
    server_name example.com;

    # 인증서와 개인 키
    ssl_certificate     /etc/nginx/ssl/fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl/privkey.pem;

    # 프로토콜: TLSv1.2, TLSv1.3만 허용 (TLSv1, TLSv1.1은 취약)
    ssl_protocols TLSv1.2 TLSv1.3;

    # 서버가 cipher 순서를 결정
    ssl_prefer_server_ciphers on;
    ssl_ciphers 'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384';

    # SSL 세션 캐싱 (핸드셰이크 비용 절감)
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;
    ssl_session_tickets off;

    # OCSP Stapling (클라이언트의 OCSP 조회를 대신 수행)
    ssl_stapling on;
    ssl_stapling_verify on;
    ssl_trusted_certificate /etc/nginx/ssl/chain.pem;
    resolver 8.8.8.8 8.8.4.4 valid=300s;

    # HSTS (HTTP Strict Transport Security)
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    location / {
        proxy_pass http://backend;
    }
}

# HTTP → HTTPS 리다이렉트
server {
    listen 80;
    server_name example.com;
    return 301 https://$host$request_uri;
}
```

**HTTP/2 활성화**: `listen 443 ssl http2;`로 간단히 활성화할 수 있다. HTTP/2는 헤더 압축(HPACK), 멀티플렉싱(하나의 TCP 연결에서 여러 요청/응답 병렬 처리), 서버 푸시 등을 지원한다.

#### SSL/TLS 심화: Certificate Chain

SSL 인증서는 체인 구조로 동작한다. nginx에 설정하는 `ssl_certificate`는 전체 체인을 포함해야 한다.

```
Root CA (브라우저에 내장)
    │
    ▼ 서명
Intermediate CA
    │
    ▼ 서명
Server Certificate (example.com)
```

`fullchain.pem` 파일에는 Server Certificate + Intermediate CA 인증서가 순서대로 포함되어야 한다. Root CA는 브라우저에 이미 내장되어 있으므로 포함하지 않는다.

```bash
# fullchain.pem 구성 확인
openssl x509 -in fullchain.pem -text -noout | grep "Subject:"
# 첫 번째: CN=example.com (Server Certificate)
# 그 다음: CN=Let's Encrypt Authority X3 (Intermediate CA)
```

#### TLS 1.3 특징

TLS 1.3은 TLS 1.2 대비 다음과 같은 개선이 있다:

| 항목 | TLS 1.2 | TLS 1.3 |
|------|---------|---------|
| Handshake | 2-RTT (Full), 1-RTT (Abbreviated) | 1-RTT (Full), 0-RTT (Resumption) |
| Cipher Suites | 많은 조합 (일부 취약) | 5개만 허용 (모두 AEAD) |
| Key Exchange | RSA, DHE, ECDHE | ECDHE, DHE만 (Forward Secrecy 강제) |
| 취약한 알고리즘 | RC4, SHA-1, CBC 모드 등 사용 가능 | 모두 제거됨 |

```nginx
# TLS 1.3 전용 설정 (TLS 1.3은 cipher 설정이 다름)
ssl_protocols TLSv1.3;
ssl_conf_command Options KTLS;  # Kernel TLS (커널 레벨 암호화로 성능 향상)

# TLS 1.3 0-RTT (early data)
# 주의: replay attack에 취약하므로 GET과 같은 멱등 요청에만 사용해야 한다
ssl_early_data on;
proxy_set_header Early-Data $ssl_early_data;
```

#### OCSP Stapling 상세

OCSP(Online Certificate Status Protocol)는 인증서가 폐기(revoke)되었는지 확인하는 프로토콜이다. OCSP Stapling은 nginx가 CA의 OCSP 서버에 미리 인증서 상태를 조회하여 TLS handshake 시 클라이언트에 전달하는 방식이다.

```
Without OCSP Stapling:
  Client → nginx (TLS handshake)
  Client → CA OCSP Server (인증서 폐기 여부 확인) ← 추가 지연 발생
  Client ← CA OCSP Server

With OCSP Stapling:
  nginx → CA OCSP Server (주기적으로 미리 조회)
  Client → nginx (TLS handshake + OCSP 응답 포함) ← 지연 없음
```

#### SSL Session Resumption

TLS handshake는 CPU 집약적이다. Session resumption을 통해 이전 handshake 결과를 재사용할 수 있다.

```nginx
# Session Cache: 서버 측에 세션 정보를 저장한다
ssl_session_cache shared:SSL:50m;   # 50MB ≈ 약 200,000 세션
ssl_session_timeout 1d;              # 세션 유효 시간: 24시간

# Session Tickets: 세션 정보를 암호화하여 클라이언트에 전달한다
# 주의: Forward Secrecy를 약화시킬 수 있다. 키 로테이션이 필요하다
ssl_session_tickets on;
ssl_session_ticket_key /etc/nginx/ssl/ticket.key;

# 권장: Session Tickets를 끄고 Session Cache만 사용한다
ssl_session_tickets off;
ssl_session_cache shared:SSL:50m;
```

#### HTTP/2 ALPN (Application-Layer Protocol Negotiation)

HTTP/2는 TLS handshake 과정에서 ALPN extension을 통해 프로토콜을 협상한다. nginx는 `listen 443 ssl http2;`로 설정하면 자동으로 ALPN을 지원한다.

```bash
# ALPN 협상 확인
openssl s_client -connect example.com:443 -alpn h2,http/1.1 </dev/null 2>&1 | grep "ALPN"
# ALPN protocol: h2  → HTTP/2 사용 중

# tart-infra 프로젝트에서 nginx Pod의 OpenSSL 버전 확인
export KUBECONFIG=kubeconfig/dev.yaml
kubectl exec -n demo deploy/nginx-web -- openssl version
```

#### certbot을 이용한 인증서 자동화

Let's Encrypt 인증서를 certbot으로 자동 발급/갱신하는 설정이다.

```bash
# certbot 설치 (Ubuntu/Debian)
apt-get install certbot python3-certbot-nginx

# nginx 플러그인으로 인증서 발급 + 자동 설정
certbot --nginx -d example.com -d www.example.com

# standalone 모드 (nginx 없이 발급)
certbot certonly --standalone -d example.com

# 인증서 갱신 (cron으로 자동화)
# 0 0,12 * * * certbot renew --post-hook "nginx -s reload"

# 인증서 갱신 테스트
certbot renew --dry-run
```

Kubernetes 환경에서는 `cert-manager`를 사용하여 인증서를 자동으로 관리하는 것이 일반적이다.

---

### 9. Rate Limiting

nginx의 rate limiting은 **leaky bucket 알고리즘**에 기반한다.

#### Leaky Bucket 알고리즘

```
들어오는 요청 (물)          처리되는 요청 (물이 새는 구멍)
    │ │ │ │ │                        │
    ▼ ▼ ▼ ▼ ▼                        ▼
┌─────────────────┐          일정한 속도로 처리
│    Bucket       │──────────────►  (rate에 의해 결정)
│  (burst 크기)    │
│                 │
└─────────────────┘
    │
    ▼ (bucket이 꽉 차면)
  503 반환
```

요청은 bucket에 들어오고, 일정한 속도(`rate`)로 처리된다. bucket이 가득 차면(`burst` 초과) 새 요청은 거부(503)된다.

```nginx
http {
    # Zone 정의: 클라이언트 IP별로 초당 10개 요청 허용
    # $binary_remote_addr는 IPv4 4바이트, IPv6 16바이트로 메모리 효율적
    limit_req_zone $binary_remote_addr zone=api_limit:10m rate=10r/s;

    # 동시 연결 수 제한 zone
    limit_conn_zone $binary_remote_addr zone=conn_limit:10m;

    server {
        location /api/ {
            # rate=10r/s, burst=20 허용
            # burst: 순간적으로 20개까지 대기열에 넣음
            # nodelay: 대기열에 넣은 요청을 즉시 처리 (지연 없이)
            limit_req zone=api_limit burst=20 nodelay;

            # 동시 연결 10개로 제한
            limit_conn conn_limit 10;

            # 제한 초과 시 반환할 상태 코드 (기본 503)
            limit_req_status 429;
            limit_conn_status 429;

            proxy_pass http://backend;
        }

        location /login {
            # 로그인 API는 더 엄격한 제한
            limit_req zone=api_limit burst=5;
            # burst 내 요청은 큐에 저장되어 rate에 맞춰 순차 처리 (delay)
            proxy_pass http://backend;
        }
    }
}
```

#### burst와 nodelay/delay 차이

| 설정 | 동작 |
|------|------|
| `burst=20` (nodelay 없음) | 초과 요청을 큐에 넣고 `rate`에 맞춰 순차적으로 처리한다. 클라이언트는 지연을 경험한다 |
| `burst=20 nodelay` | 초과 요청을 즉시 처리한다. 단, burst 슬롯 회복은 여전히 rate에 따른다 |
| `burst=20 delay=8` | 처음 8개는 즉시 처리, 나머지 12개는 큐에서 순차 처리한다 |

#### Multiple Rate Limiting Zones

하나의 location에 여러 rate limit zone을 적용할 수 있다. 각 zone의 제한은 독립적으로 평가되며, 하나라도 제한에 걸리면 요청이 거부된다.

```nginx
http {
    # IP 기반 제한: 초당 10개
    limit_req_zone $binary_remote_addr zone=per_ip:10m rate=10r/s;

    # 서버 전체 제한: 초당 1000개
    limit_req_zone $server_name zone=per_server:10m rate=1000r/s;

    # API 키 기반 제한: 초당 100개
    limit_req_zone $http_x_api_key zone=per_api_key:10m rate=100r/s;

    server {
        location /api/ {
            # 세 가지 제한을 동시에 적용
            limit_req zone=per_ip burst=20 nodelay;
            limit_req zone=per_server burst=200 nodelay;
            limit_req zone=per_api_key burst=50 nodelay;

            limit_req_status 429;
            proxy_pass http://backend;
        }
    }
}
```

#### Whitelist 패턴 (특정 IP를 제한에서 제외)

```nginx
http {
    # geo 모듈로 IP별 변수 설정
    geo $limit {
        default         1;
        10.0.0.0/8      0;    # 내부 네트워크는 제한 제외
        192.168.0.0/16  0;    # 내부 네트워크는 제한 제외
    }

    # $limit가 0이면 빈 문자열 → zone에 저장되지 않으므로 제한이 적용되지 않는다
    map $limit $limit_key {
        0 "";
        1 $binary_remote_addr;
    }

    limit_req_zone $limit_key zone=api:10m rate=10r/s;

    server {
        location /api/ {
            limit_req zone=api burst=20 nodelay;
            proxy_pass http://backend;
        }
    }
}
```

#### limit_conn 심화

`limit_conn`은 동시 연결 수를 제한한다. `limit_req`와는 다르게 **요청 속도**가 아닌 **동시에 열려 있는 연결 수**를 제한한다.

```nginx
http {
    limit_conn_zone $binary_remote_addr zone=addr:10m;
    limit_conn_zone $server_name zone=server:10m;

    server {
        # IP당 동시 연결 수 제한
        limit_conn addr 10;

        # 서버 전체 동시 연결 수 제한
        limit_conn server 1000;

        # 연결당 대역폭 제한 (다운로드 속도 제한에 유용)
        limit_rate 100k;            # 100KB/s로 제한
        limit_rate_after 10m;       # 처음 10MB는 제한 없이, 이후 100KB/s

        location /downloads/ {
            limit_conn addr 3;       # 다운로드는 IP당 3개 연결로 제한
            limit_rate 500k;
            root /var/www;
        }
    }
}
```

---
