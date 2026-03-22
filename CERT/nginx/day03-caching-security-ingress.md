# Day 3: HTTP Caching, Security Headers, Logging, Modules, Ingress Controller

HTTP 캐싱, 보안 헤더, 접근 제어, 로깅, 모듈 시스템, Kubernetes Ingress Controller를 학습한다.

---

### 10. HTTP Caching

upstream 응답을 nginx에서 캐싱하여 백엔드 부하를 줄인다.

```nginx
http {
    proxy_cache_path /var/cache/nginx
        levels=1:2
        keys_zone=content_cache:20m
        max_size=2g
        inactive=24h
        use_temp_path=off;

    server {
        location / {
            proxy_pass http://backend;
            proxy_cache content_cache;

            # 응답 코드별 캐시 유효 시간
            proxy_cache_valid 200 1h;
            proxy_cache_valid 301 1d;
            proxy_cache_valid any 1m;

            # 캐시 키 (동일 키 = 동일 캐시 엔트리)
            proxy_cache_key "$scheme$request_method$host$request_uri";

            # 캐시 우회 조건
            proxy_cache_bypass $http_cache_control;   # Cache-Control 헤더가 있으면 우회

            # upstream 장애 시 stale 캐시 제공
            proxy_cache_use_stale error timeout updating http_500 http_502 http_503;

            # 백그라운드에서 캐시 갱신 (stale 응답을 먼저 반환)
            proxy_cache_background_update on;

            # 최소 N번 요청된 후에만 캐시 (불필요한 캐싱 방지)
            proxy_cache_min_uses 2;

            # 동일 키에 대해 하나의 요청만 upstream으로 전달 (cache stampede 방지)
            proxy_cache_lock on;

            # 캐시 상태 헤더
            add_header X-Cache-Status $upstream_cache_status;
        }
    }
}
```

#### Cache Levels

`levels=1:2`는 캐시 파일의 디렉토리 구조를 결정한다. 해시값 `b7f54b2df7773722d382f4809d65029c`의 경우:

```
/var/cache/nginx/c/29/b7f54b2df7773722d382f4809d65029c
                 └1┘└2─┘
```

이렇게 하면 하나의 디렉토리에 파일이 너무 많아지는 것을 방지한다.

#### Microcaching

동적 콘텐츠도 매우 짧은 시간(1초 등) 캐싱하면, 트래픽 급증 시 백엔드 부하를 크게 줄일 수 있다. `proxy_cache_valid 200 1s;`로 설정한다.

```nginx
# Microcaching 설정 예시
http {
    proxy_cache_path /var/cache/nginx/micro
        levels=1:2
        keys_zone=micro_cache:10m
        max_size=500m
        inactive=10m
        use_temp_path=off;

    server {
        location /api/ {
            proxy_pass http://backend;
            proxy_cache micro_cache;
            proxy_cache_valid 200 1s;       # 1초 캐시
            proxy_cache_lock on;             # cache stampede 방지
            proxy_cache_lock_age 5s;         # lock 최대 대기 시간
            proxy_cache_lock_timeout 5s;

            proxy_cache_use_stale updating;  # 갱신 중에는 stale 응답 제공

            # POST 요청 등은 캐시하지 않음
            proxy_cache_methods GET HEAD;

            add_header X-Cache-Status $upstream_cache_status;
        }
    }
}
```

초당 1,000 요청이 들어오는 상황에서 1초 microcaching을 적용하면, backend에는 초당 1개의 요청만 전달된다. 이것은 **1,000배의 부하 감소** 효과이다.

#### Slice Module

대용량 파일(동영상, ISO 등)의 캐시 효율을 높이기 위해, 파일을 작은 조각(slice)으로 나누어 캐시하는 모듈이다.

```nginx
location /videos/ {
    slice 1m;                    # 1MB 단위로 조각
    proxy_cache video_cache;
    proxy_cache_key "$host$uri$is_args$args$slice_range";
    proxy_set_header Range $slice_range;
    proxy_cache_valid 200 206 24h;
    proxy_pass http://video_backend;
}
```

`slice` module의 장점:
1. 대용량 파일의 일부만 요청해도, 해당 조각만 캐시에서 제공할 수 있다
2. Range 요청을 효율적으로 처리할 수 있다
3. 캐시 미스 시 전체 파일이 아닌 필요한 조각만 upstream에서 가져온다

---

### 11. Security Headers

보안 헤더는 XSS, 클릭재킹, MIME 스니핑 등 다양한 웹 공격을 방어하는 데 사용된다.

```nginx
server {
    listen 443 ssl http2;
    server_name example.com;

    # --- HSTS ---
    # 브라우저에 HTTPS만 사용하도록 강제한다
    # max-age: 초 단위 (31536000 = 1년)
    # includeSubDomains: 모든 서브도메인에도 적용
    # preload: HSTS preload list에 등록 요청 (한 번 등록하면 해제가 어렵다)
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;

    # --- X-Frame-Options ---
    # 페이지가 iframe에 포함되는 것을 방지한다 (clickjacking 방어)
    # DENY: 어디서도 iframe으로 포함 불가
    # SAMEORIGIN: 같은 origin에서만 허용
    add_header X-Frame-Options "SAMEORIGIN" always;

    # --- Content-Security-Policy (CSP) ---
    # 리소스 로딩 정책을 세밀하게 제어한다 (XSS 방어의 핵심)
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'nonce-$request_id'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' https://fonts.gstatic.com; frame-ancestors 'self'" always;

    # --- X-Content-Type-Options ---
    # 브라우저의 MIME 타입 스니핑을 방지한다
    # 서버가 보낸 Content-Type만 사용하도록 강제한다
    add_header X-Content-Type-Options "nosniff" always;

    # --- Referrer-Policy ---
    # 다른 사이트로 이동할 때 Referer 헤더에 포함할 정보를 제어한다
    # strict-origin-when-cross-origin: 동일 origin에는 전체 URL,
    # 다른 origin에는 origin만, HTTPS→HTTP는 전달하지 않음
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # --- Permissions-Policy ---
    # 브라우저 기능(카메라, 마이크, 위치 등)의 사용을 제어한다
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=(self), payment=()" always;

    # --- X-XSS-Protection ---
    # 레거시 XSS 필터 (최신 브라우저에서는 CSP로 대체됨)
    add_header X-XSS-Protection "1; mode=block" always;

    location / {
        proxy_pass http://backend;
    }
}
```

#### CORS (Cross-Origin Resource Sharing) 설정

```nginx
# 특정 origin만 허용하는 CORS 설정
map $http_origin $cors_origin {
    default "";
    "https://app.example.com"     $http_origin;
    "https://staging.example.com" $http_origin;
    "http://localhost:3000"       $http_origin;
}

server {
    location /api/ {
        # CORS 헤더 설정
        add_header Access-Control-Allow-Origin $cors_origin always;
        add_header Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS" always;
        add_header Access-Control-Allow-Headers "Authorization, Content-Type, X-Requested-With" always;
        add_header Access-Control-Allow-Credentials "true" always;
        add_header Access-Control-Max-Age 86400 always;

        # Preflight 요청 (OPTIONS) 처리
        if ($request_method = OPTIONS) {
            return 204;
        }

        proxy_pass http://backend;
    }
}
```

---

### 12. Access Control

```nginx
# IP 기반 접근 제어
location /admin/ {
    allow 192.168.1.0/24;
    allow 10.0.0.0/8;
    deny all;
    # allow/deny는 위에서 아래로 평가하며, 첫 매칭 규칙을 적용한다
    proxy_pass http://admin_backend;
}

# HTTP Basic 인증
location /protected/ {
    auth_basic "Restricted Area";
    auth_basic_user_file /etc/nginx/.htpasswd;
    # htpasswd -c /etc/nginx/.htpasswd username 으로 파일 생성
    proxy_pass http://backend;
}

# auth_request (서브요청 기반 인증)
# 외부 인증 서비스에 요청을 보내 인증 여부를 결정한다
location /api/ {
    auth_request /auth;                        # /auth로 서브요청
    auth_request_set $auth_user $upstream_http_x_auth_user;
    proxy_set_header X-Auth-User $auth_user;
    proxy_pass http://backend;
}

location = /auth {
    internal;                                  # 외부에서 직접 접근 불가
    proxy_pass http://auth-service:8080/verify;
    proxy_pass_request_body off;               # 원본 body는 전달하지 않음
    proxy_set_header Content-Length "";
    proxy_set_header X-Original-URI $request_uri;
}

# geo 모듈 (IP 범위별 변수 매핑)
geo $geo_access {
    default        deny;
    192.168.0.0/16 allow;
    10.0.0.0/8     allow;
    172.16.0.0/12  allow;
}

server {
    location /internal/ {
        if ($geo_access = deny) {
            return 403;
        }
        proxy_pass http://internal_backend;
    }
}
```

---

### 13. Logging

#### Access Log Format

```nginx
http {
    # 기본 combined 포맷에 추가 정보를 포함한 커스텀 포맷
    log_format main_ext
        '$remote_addr - $remote_user [$time_local] '
        '"$request" $status $body_bytes_sent '
        '"$http_referer" "$http_user_agent" '
        'rt=$request_time '             # 요청 처리 총 시간 (초)
        'urt=$upstream_response_time '   # upstream 응답 시간
        'uct=$upstream_connect_time '    # upstream 연결 수립 시간
        'uht=$upstream_header_time '     # upstream 헤더 수신까지 시간
        'cs=$upstream_cache_status '     # 캐시 상태
        'us=$upstream_status';           # upstream 응답 코드

    # JSON 포맷 (로그 수집 시스템과 연동 시 유용)
    log_format json_log escape=json
        '{'
            '"time":"$time_iso8601",'
            '"remote_addr":"$remote_addr",'
            '"request":"$request",'
            '"status":$status,'
            '"body_bytes_sent":$body_bytes_sent,'
            '"request_time":$request_time,'
            '"upstream_response_time":"$upstream_response_time",'
            '"http_user_agent":"$http_user_agent"'
        '}';

    # 로그 적용
    access_log /var/log/nginx/access.log main_ext;
    access_log /var/log/nginx/access.json.log json_log;

    # 조건부 로깅 (health check 등 불필요한 로그 제외)
    map $request_uri $loggable {
        ~*^/health   0;
        ~*^/ready    0;
        default      1;
    }

    server {
        access_log /var/log/nginx/access.log main_ext if=$loggable;
    }
}
```

#### Error Log Levels

```nginx
# 레벨: debug, info, notice, warn, error, crit, alert, emerg
error_log /var/log/nginx/error.log warn;

# 디버깅 시 debug 레벨 사용 (컴파일 시 --with-debug 필요)
# error_log /var/log/nginx/error.log debug;
```

#### 핵심 변수 참조

| 변수 | 설명 |
|------|------|
| `$request_time` | 클라이언트로부터 요청을 받고 응답을 보낸 총 시간 (초, ms 단위 포함) |
| `$upstream_response_time` | upstream 서버의 응답 시간이다. 여러 upstream을 거친 경우 쉼표로 구분된다 |
| `$upstream_connect_time` | upstream과 TCP 연결을 수립하는 데 걸린 시간이다 |
| `$upstream_header_time` | upstream으로부터 응답 헤더를 수신하는 데 걸린 시간이다 |
| `$upstream_cache_status` | 캐시 상태이다: HIT, MISS, EXPIRED, STALE, UPDATING, REVALIDATED, BYPASS |
| `$connection` | 연결 일련번호이다 |
| `$connection_requests` | 현재 연결에서 처리된 요청 수이다 (keep-alive 관련) |
| `$request_length` | 요청의 전체 길이이다 (헤더 + 본문) |
| `$bytes_sent` | 클라이언트에 전송된 총 바이트 수이다 |

#### Syslog 출력

nginx 로그를 syslog 서버로 직접 전송할 수 있다. 중앙 집중식 로그 관리에 유용하다.

```nginx
# syslog 서버로 access log 전송
access_log syslog:server=192.168.1.100:514,facility=local7,tag=nginx,severity=info main_ext;

# syslog 서버로 error log 전송
error_log syslog:server=192.168.1.100:514,facility=local7,tag=nginx_error warn;

# 파일과 syslog 동시 출력 (이중 로깅)
access_log /var/log/nginx/access.log main_ext;
access_log syslog:server=log-collector:514,tag=nginx main_ext;
```

#### Debug Logging 심화

특정 클라이언트 IP에 대해서만 debug 로그를 활성화하여 프로덕션에서 안전하게 디버깅할 수 있다.

```nginx
events {
    debug_connection 192.168.1.100;   # 이 IP에서 오는 연결만 debug 로깅
    debug_connection 10.0.0.0/24;     # CIDR 범위 지정도 가능
}

# 특정 location에서만 debug 로그 (권장하지 않지만 가능)
# error_log는 전역 설정이므로, location 내에서는 별도 파일로 분리한다
location /debug/ {
    error_log /var/log/nginx/debug.log debug;
    proxy_pass http://backend;
}
```

---

### 14. nginx Modules

nginx는 **모듈 기반 아키텍처**이다. 기능별로 모듈이 분리되어 있으며, 컴파일 시 포함하거나 동적으로 로드할 수 있다.

| 모듈 카테고리 | 예시 | 설명 |
|-------------|------|------|
| Core modules | `ngx_core_module` | worker_processes, error_log 등 기본 설정 |
| Event modules | `ngx_event_module` | epoll, kqueue 등 이벤트 처리 |
| HTTP modules | `ngx_http_core_module` | server, location, listen 등 HTTP 처리 |
| HTTP Proxy | `ngx_http_proxy_module` | proxy_pass 등 리버스 프록시 기능 |
| HTTP Upstream | `ngx_http_upstream_module` | upstream 서버 그룹 및 로드 밸런싱 |
| HTTP SSL | `ngx_http_ssl_module` | SSL/TLS 지원 |
| HTTP Rewrite | `ngx_http_rewrite_module` | rewrite, return, if 등 URL 변환 |
| HTTP Gzip | `ngx_http_gzip_module` | 응답 본문 gzip 압축 |
| HTTP Limit Req | `ngx_http_limit_req_module` | 요청 속도 제한 (leaky bucket) |
| HTTP Limit Conn | `ngx_http_limit_conn_module` | 동시 연결 수 제한 |
| HTTP Auth Basic | `ngx_http_auth_basic_module` | HTTP Basic 인증 |
| HTTP Auth Request | `ngx_http_auth_request_module` | 서브요청 기반 인증 |
| HTTP Stub Status | `ngx_http_stub_status_module` | 연결 통계 정보 제공 |
| HTTP RealIP | `ngx_http_realip_module` | 프록시 뒤에서 클라이언트 실제 IP 복원 |
| Stream module | `ngx_stream_core_module` | TCP/UDP 프록시 (L4 로드 밸런싱) |
| Mail module | `ngx_mail_core_module` | IMAP/POP3/SMTP 프록시 |

#### Stream Module (TCP/UDP 프록시)

HTTP가 아닌 TCP/UDP 트래픽을 프록시할 때 사용한다.

```nginx
stream {
    upstream mysql_cluster {
        server 10.0.0.1:3306;
        server 10.0.0.2:3306;
    }

    upstream dns_servers {
        server 10.0.0.1:53;
        server 10.0.0.2:53;
    }

    server {
        listen 3306;
        proxy_pass mysql_cluster;
        proxy_connect_timeout 1s;
    }

    server {
        listen 53 udp;
        proxy_pass dns_servers;
    }
}
```

#### Stream Module 심화: SSL Passthrough

SSL/TLS를 종료하지 않고 그대로 backend에 전달하는 설정이다. nginx는 SNI(Server Name Indication)만 확인하여 라우팅을 결정한다.

```nginx
stream {
    # SNI 기반 라우팅을 위한 map
    map $ssl_preread_server_name $backend_pool {
        app1.example.com    app1_backend;
        app2.example.com    app2_backend;
        default             default_backend;
    }

    upstream app1_backend {
        server 10.0.0.1:443;
        server 10.0.0.2:443;
    }

    upstream app2_backend {
        server 10.0.0.3:443;
        server 10.0.0.4:443;
    }

    upstream default_backend {
        server 10.0.0.5:443;
    }

    server {
        listen 443;
        ssl_preread on;            # SNI 정보를 읽되, TLS를 종료하지 않음
        proxy_pass $backend_pool;  # SNI에 따라 라우팅
    }
}
```

#### Stream Health Check (TCP)

```nginx
stream {
    upstream redis_cluster {
        server redis-1:6379 max_fails=3 fail_timeout=10s;
        server redis-2:6379 max_fails=3 fail_timeout=10s;
        server redis-3:6379 max_fails=3 fail_timeout=10s backup;
    }

    server {
        listen 6379;
        proxy_pass redis_cluster;
        proxy_connect_timeout 1s;
        proxy_timeout 3s;           # 데이터 전송 타임아웃
    }
}
```

#### Dynamic Module 로드

```nginx
# nginx.conf 최상위에서 동적 모듈 로드
load_module modules/ngx_http_geoip_module.so;
load_module modules/ngx_stream_module.so;

# 컴파일된 모듈 확인
# nginx -V 2>&1 | tr -- - '\n' | grep module
```

---

### 15. Nginx Ingress Controller in Kubernetes

Nginx Ingress Controller는 Kubernetes에서 외부 트래픽을 클러스터 내부 Service로 라우팅하는 역할을 한다.

#### 동작 원리

```
┌─────────────────────────────────────────────────────────────────┐
│                    Kubernetes Cluster                           │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Nginx Ingress Controller Pod                             │   │
│  │                                                          │   │
│  │  ┌──────────────┐    ┌──────────────┐   ┌────────────┐  │   │
│  │  │ Controller   │    │ nginx.conf   │   │  nginx     │  │   │
│  │  │ (Go process) │───►│ (generated)  │──►│  process   │  │   │
│  │  │              │    │              │   │            │  │   │
│  │  │ watches:     │    │ 자동 생성/갱신  │   │ 트래픽 처리  │  │   │
│  │  │ - Ingress    │    └──────────────┘   └────────────┘  │   │
│  │  │ - Service    │                                       │   │
│  │  │ - Endpoints  │                                       │   │
│  │  │ - Secret     │                                       │   │
│  │  │ - ConfigMap  │                                       │   │
│  │  └──────────────┘                                       │   │
│  └──────────────────────────────────────────────────────────┘   │
│                           │                                     │
│                    ┌──────▼──────┐                               │
│                    │ Service A   │                               │
│                    │ Service B   │                               │
│                    │ Service C   │                               │
│                    └─────────────┘                               │
└─────────────────────────────────────────────────────────────────┘
```

1. Controller(Go 프로세스)가 Kubernetes API를 watch하여 Ingress, Service, Endpoints, Secret, ConfigMap 리소스의 변경을 감지한다
2. 변경이 감지되면 **nginx.conf를 자동으로 재생성**한다
3. nginx 프로세스를 **reload** 하여 새 설정을 적용한다 (일부 변경은 Lua로 동적 적용하여 reload 없이 처리)

#### Path Types

| pathType | 동작 |
|----------|------|
| `Exact` | URL이 정확히 일치해야 한다. `/foo`는 매칭, `/foo/`는 불일치 |
| `Prefix` | URL prefix가 `/`로 분리된 단위로 일치해야 한다. `/foo`는 `/foo`, `/foo/bar` 매칭 |
| `ImplementationSpecific` | Ingress controller 구현에 따라 다르다. nginx에서는 Prefix와 유사하게 동작한다 |

#### 주요 Annotations

```yaml
metadata:
  annotations:
    # 리다이렉트
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
    nginx.ingress.kubernetes.io/force-ssl-redirect: "true"

    # Rate Limiting
    nginx.ingress.kubernetes.io/limit-rps: "10"
    nginx.ingress.kubernetes.io/limit-burst-multiplier: "5"

    # Proxy 설정
    nginx.ingress.kubernetes.io/proxy-body-size: "50m"
    nginx.ingress.kubernetes.io/proxy-connect-timeout: "5"
    nginx.ingress.kubernetes.io/proxy-read-timeout: "60"

    # CORS
    nginx.ingress.kubernetes.io/enable-cors: "true"
    nginx.ingress.kubernetes.io/cors-allow-origin: "https://example.com"

    # Canary 배포
    nginx.ingress.kubernetes.io/canary: "true"
    nginx.ingress.kubernetes.io/canary-weight: "20"        # 20% 트래픽을 canary로
    nginx.ingress.kubernetes.io/canary-by-header: "X-Canary"

    # WebSocket
    nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "3600"
```

#### Canary 배포

Nginx Ingress Controller는 annotation 기반으로 canary 배포를 지원한다. 동일 호스트/경로에 대해 기본 Ingress와 canary Ingress를 두 개 생성한다. 가중치 기반(`canary-weight`), 헤더 기반(`canary-by-header`), 쿠키 기반(`canary-by-cookie`) 라우팅을 지원한다.

#### ConfigMap으로 글로벌 설정

Ingress Controller의 글로벌 nginx 설정은 ConfigMap으로 관리한다. 개별 Ingress의 annotation보다 우선순위가 낮다.

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: ingress-nginx-controller
  namespace: ingress-nginx
data:
  # Worker 설정
  worker-processes: "auto"
  worker-connections: "65536"

  # Keep-Alive
  keep-alive: "75"
  keep-alive-requests: "1000"
  upstream-keepalive-connections: "320"

  # 타임아웃
  proxy-connect-timeout: "5"
  proxy-read-timeout: "60"
  proxy-send-timeout: "60"

  # 로깅
  log-format-upstream: '$remote_addr - $remote_user [$time_local] "$request" $status $body_bytes_sent "$http_referer" "$http_user_agent" $request_length $request_time [$proxy_upstream_name] [$proxy_alternative_upstream_name] $upstream_addr $upstream_response_length $upstream_response_time $upstream_status $req_id'

  # 보안 헤더
  hide-headers: "X-Powered-By,Server"
  ssl-protocols: "TLSv1.2 TLSv1.3"

  # Gzip
  use-gzip: "true"
  gzip-level: "5"

  # Rate Limiting (글로벌)
  limit-req-status-code: "429"

  # 커스텀 에러 페이지
  custom-http-errors: "404,503"
```

#### Custom Error Pages

Ingress Controller에서 커스텀 에러 페이지를 제공하려면 별도의 default-backend를 설정한다.

```yaml
# default-backend Deployment
apiVersion: apps/v1
kind: Deployment
metadata:
  name: custom-error-pages
  namespace: ingress-nginx
spec:
  replicas: 1
  selector:
    matchLabels:
      app: custom-error-pages
  template:
    metadata:
      labels:
        app: custom-error-pages
    spec:
      containers:
        - name: error-pages
          image: registry.k8s.io/ingress-nginx/custom-error-pages:v1.0.0
          ports:
            - containerPort: 8080
          env:
            - name: ERROR_FILES_PATH
              value: /www
---
apiVersion: v1
kind: Service
metadata:
  name: custom-error-pages
  namespace: ingress-nginx
spec:
  selector:
    app: custom-error-pages
  ports:
    - port: 80
      targetPort: 8080
```

---

