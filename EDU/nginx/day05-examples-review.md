# Day 5: 예제와 자가 점검

Kubernetes 배포, 리버스 프록시, Rate Limiting, SSL, Caching, Ingress Controller, WebSocket, gzip, API Gateway 등 종합 예제와 자가 점검 문항을 학습한다.

---

## 예제

### 예제 1: Kubernetes 배포 매니페스트

```yaml
# nginx-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nginx
  namespace: demo
spec:
  replicas: 2
  selector:
    matchLabels:
      app: nginx
  template:
    metadata:
      labels:
        app: nginx
    spec:
      containers:
        - name: nginx
          image: nginx:alpine
          ports:
            - containerPort: 80
          resources:
            limits:
              cpu: 200m
              memory: 128Mi
            requests:
              cpu: 50m
              memory: 64Mi
          volumeMounts:
            - name: config
              mountPath: /etc/nginx/conf.d
      volumes:
        - name: config
          configMap:
            name: nginx-config
---
apiVersion: v1
kind: Service
metadata:
  name: nginx
  namespace: demo
spec:
  selector:
    app: nginx
  ports:
    - port: 80
      targetPort: 80
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: nginx-hpa
  namespace: demo
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: nginx
  minReplicas: 2
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 50
```

### 예제 2: 리버스 프록시 설정

```nginx
# nginx-reverse-proxy.conf
upstream backend {
    server backend-1:8080;
    server backend-2:8080;
    server backend-3:8080;
}

server {
    listen 80;
    server_name example.com;

    location / {
        proxy_pass http://backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /api/ {
        proxy_pass http://backend;
        proxy_connect_timeout 5s;
        proxy_read_timeout 30s;
    }

    location /static/ {
        root /usr/share/nginx/html;
        expires 7d;
        add_header Cache-Control "public, immutable";
    }
}
```

### 예제 3: nginx ConfigMap

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: nginx-config
  namespace: demo
data:
  default.conf: |
    server {
        listen 80;
        server_name _;

        location / {
            root /usr/share/nginx/html;
            index index.html;
        }

        location /health {
            return 200 'OK';
            add_header Content-Type text/plain;
        }

        location /nginx_status {
            stub_status on;
            allow 127.0.0.1;
            deny all;
        }
    }
```

### 예제 4: Rate Limiting 설정

```nginx
http {
    # 클라이언트 IP별 요청 속도 제한
    limit_req_zone $binary_remote_addr zone=general:10m rate=10r/s;
    limit_req_zone $binary_remote_addr zone=login:10m rate=1r/s;

    # 동시 연결 수 제한
    limit_conn_zone $binary_remote_addr zone=addr:10m;

    server {
        listen 80;
        server_name api.example.com;

        # 일반 API: 초당 10개, burst 20, 초과분 즉시 처리
        location /api/ {
            limit_req zone=general burst=20 nodelay;
            limit_conn addr 20;
            limit_req_status 429;
            proxy_pass http://backend;
        }

        # 로그인: 초당 1개, burst 5, 초과분은 큐에서 순차 처리
        location /api/login {
            limit_req zone=login burst=5;
            limit_req_status 429;
            proxy_pass http://backend;
        }

        # 정적 파일: 제한 없음
        location /static/ {
            root /var/www;
        }
    }
}
```

### 예제 5: SSL Termination with HTTP→HTTPS Redirect

```nginx
server {
    listen 80;
    server_name example.com www.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name example.com www.example.com;

    ssl_certificate     /etc/nginx/ssl/fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384';
    ssl_prefer_server_ciphers on;

    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;

    ssl_stapling on;
    ssl_stapling_verify on;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options nosniff;
    add_header X-Frame-Options DENY;

    location / {
        proxy_pass http://backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### 예제 6: Caching Reverse Proxy

```nginx
http {
    proxy_cache_path /var/cache/nginx/api_cache
        levels=1:2
        keys_zone=api_cache:10m
        max_size=1g
        inactive=1h
        use_temp_path=off;

    proxy_cache_path /var/cache/nginx/static_cache
        levels=1:2
        keys_zone=static_cache:10m
        max_size=5g
        inactive=7d
        use_temp_path=off;

    server {
        listen 80;

        # API 캐싱 (짧은 TTL)
        location /api/ {
            proxy_pass http://api_backend;
            proxy_cache api_cache;
            proxy_cache_valid 200 5m;
            proxy_cache_valid 404 1m;
            proxy_cache_key "$request_method$host$request_uri";
            proxy_cache_use_stale error timeout updating http_500 http_502 http_503;
            proxy_cache_background_update on;
            proxy_cache_lock on;           # 동일 키에 대해 하나의 요청만 upstream으로 전달
            add_header X-Cache-Status $upstream_cache_status;
        }

        # 정적 파일 캐싱 (긴 TTL)
        location /assets/ {
            proxy_pass http://static_backend;
            proxy_cache static_cache;
            proxy_cache_valid 200 7d;
            proxy_cache_key "$host$request_uri";
            add_header X-Cache-Status $upstream_cache_status;
        }
    }
}
```

### 예제 7: Nginx Ingress Controller Kubernetes Manifest

```yaml
# Ingress 리소스 예시
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: app-ingress
  namespace: demo
  annotations:
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
    nginx.ingress.kubernetes.io/proxy-body-size: "10m"
    nginx.ingress.kubernetes.io/proxy-read-timeout: "60"
    nginx.ingress.kubernetes.io/limit-rps: "10"
    nginx.ingress.kubernetes.io/limit-burst-multiplier: "5"
spec:
  ingressClassName: nginx
  tls:
    - hosts:
        - app.example.com
        - api.example.com
      secretName: app-tls-secret
  rules:
    - host: app.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: frontend
                port:
                  number: 80
    - host: api.example.com
      http:
        paths:
          - path: /v1
            pathType: Prefix
            backend:
              service:
                name: api-v1
                port:
                  number: 8080
          - path: /v2
            pathType: Prefix
            backend:
              service:
                name: api-v2
                port:
                  number: 8080
---
# Canary Ingress (10% 트래픽을 새 버전으로)
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: app-ingress-canary
  namespace: demo
  annotations:
    nginx.ingress.kubernetes.io/canary: "true"
    nginx.ingress.kubernetes.io/canary-weight: "10"
spec:
  ingressClassName: nginx
  rules:
    - host: app.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: frontend-canary
                port:
                  number: 80
```

### 예제 8: WebSocket Proxy 설정

```nginx
# WebSocket은 HTTP Upgrade 메커니즘을 사용한다
# nginx에서 WebSocket 프록시를 위해 Upgrade, Connection 헤더를 설정해야 한다

map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

upstream websocket_backend {
    server ws-server-1:8080;
    server ws-server-2:8080;
    ip_hash;    # WebSocket은 세션 유지가 필요하므로 ip_hash 사용
}

server {
    listen 80;
    server_name ws.example.com;

    location /ws/ {
        proxy_pass http://websocket_backend;
        proxy_http_version 1.1;                        # WebSocket은 HTTP/1.1 필요
        proxy_set_header Upgrade $http_upgrade;         # Upgrade 헤더 전달
        proxy_set_header Connection $connection_upgrade; # Connection: upgrade 전달
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;

        # WebSocket 연결은 장시간 유지되므로 타임아웃을 길게 설정
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
```

### 예제 9: gzip 압축 설정

```nginx
http {
    # gzip 활성화
    gzip on;

    # 최소 크기 (이보다 작은 응답은 압축하지 않음)
    gzip_min_length 1024;

    # 압축 레벨 (1~9, 높을수록 압축률 높고 CPU 사용 높음, 5~6이 적절)
    gzip_comp_level 5;

    # 프록시된 요청에도 압축 적용
    gzip_proxied any;

    # 압축 대상 MIME 타입
    gzip_types
        text/plain
        text/css
        text/xml
        text/javascript
        application/json
        application/javascript
        application/xml
        application/xml+rss
        application/atom+xml
        image/svg+xml;

    # Vary: Accept-Encoding 헤더 추가 (캐시 프록시가 압축/비압축 버전을 구분)
    gzip_vary on;

    # IE6 이하에서는 gzip 비활성화
    gzip_disable "msie6";
}
```

### 예제 10: Production-Grade API Gateway

```nginx
# 실전 수준의 API 게이트웨이 설정
http {
    # --- 로깅 ---
    log_format api_gw escape=json
        '{'
            '"time":"$time_iso8601",'
            '"client":"$remote_addr",'
            '"method":"$request_method",'
            '"uri":"$uri",'
            '"status":$status,'
            '"size":$body_bytes_sent,'
            '"request_time":$request_time,'
            '"upstream_time":"$upstream_response_time",'
            '"upstream_status":"$upstream_status",'
            '"user_agent":"$http_user_agent",'
            '"request_id":"$request_id",'
            '"api_key":"$http_x_api_key"'
        '}';

    # --- Rate Limiting ---
    limit_req_zone $http_x_api_key zone=api_key:20m rate=100r/s;
    limit_req_zone $binary_remote_addr zone=per_ip:10m rate=20r/s;

    # --- Caching ---
    proxy_cache_path /var/cache/nginx/api
        levels=1:2
        keys_zone=api_responses:20m
        max_size=2g
        inactive=1h
        use_temp_path=off;

    # --- Upstream ---
    upstream user_service {
        least_conn;
        server user-svc-1:8080 max_fails=3 fail_timeout=10s;
        server user-svc-2:8080 max_fails=3 fail_timeout=10s;
        keepalive 32;
    }

    upstream order_service {
        least_conn;
        server order-svc-1:8080 max_fails=3 fail_timeout=10s;
        server order-svc-2:8080 max_fails=3 fail_timeout=10s;
        keepalive 32;
    }

    server {
        listen 443 ssl http2;
        server_name api.example.com;

        ssl_certificate /etc/nginx/ssl/fullchain.pem;
        ssl_certificate_key /etc/nginx/ssl/privkey.pem;
        ssl_protocols TLSv1.2 TLSv1.3;

        access_log /var/log/nginx/api_access.log api_gw;

        # --- 공통 보안 헤더 ---
        add_header X-Request-ID $request_id always;
        add_header X-Content-Type-Options nosniff always;
        add_header Strict-Transport-Security "max-age=31536000" always;

        # --- 공통 프록시 설정 ---
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Request-ID $request_id;

        # --- API 인증 ---
        location = /auth {
            internal;
            proxy_pass http://auth-service:8080/verify;
            proxy_pass_request_body off;
            proxy_set_header Content-Length "";
            proxy_set_header X-Original-URI $request_uri;
            proxy_set_header X-API-Key $http_x_api_key;
        }

        # --- User Service ---
        location /api/v1/users {
            auth_request /auth;
            limit_req zone=api_key burst=50 nodelay;
            limit_req zone=per_ip burst=10 nodelay;
            limit_req_status 429;

            proxy_pass http://user_service;
            proxy_connect_timeout 3s;
            proxy_read_timeout 10s;
        }

        # --- Order Service ---
        location /api/v1/orders {
            auth_request /auth;
            limit_req zone=api_key burst=50 nodelay;
            limit_req zone=per_ip burst=10 nodelay;
            limit_req_status 429;

            proxy_pass http://order_service;
            proxy_connect_timeout 3s;
            proxy_read_timeout 30s;

            # 읽기 전용 GET 요청만 캐시
            proxy_cache api_responses;
            proxy_cache_methods GET HEAD;
            proxy_cache_valid 200 30s;
            proxy_cache_key "$request_method$uri$is_args$args$http_x_api_key";
            proxy_cache_use_stale error timeout updating;
            add_header X-Cache-Status $upstream_cache_status;
        }

        # --- Health Check ---
        location /health {
            access_log off;
            return 200 '{"status":"ok"}';
            add_header Content-Type application/json;
        }

        # --- 404 catch-all ---
        location / {
            return 404 '{"error":"not_found","message":"The requested endpoint does not exist"}';
            add_header Content-Type application/json;
        }
    }
}
```

### 예제 11: 정적 파일 서빙 최적화

```nginx
server {
    listen 80;
    server_name static.example.com;

    root /var/www/static;

    # 정적 파일 서빙 최적화
    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;

    # 파일 메타데이터 캐시
    open_file_cache max=5000 inactive=120s;
    open_file_cache_valid 60s;
    open_file_cache_min_uses 2;
    open_file_cache_errors on;

    # 이미지, 폰트 등 변경되지 않는 파일
    location ~* \.(jpg|jpeg|png|gif|ico|svg|webp|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        access_log off;
    }

    # CSS, JS (버전 해시가 파일명에 포함된 경우)
    location ~* \.(css|js)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        access_log off;
    }

    # HTML (자주 변경되므로 짧은 캐시)
    location ~* \.html$ {
        expires 1h;
        add_header Cache-Control "public, must-revalidate";
    }

    # SPA (Single Page Application) fallback
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

---

## 자가 점검

- [ ] 웹 서버와 리버스 프록시의 차이를 설명할 수 있는가?
- [ ] nginx의 event-driven 모델이 Apache의 process/thread 모델과 어떻게 다른지 설명할 수 있는가? (C10K 문제와 연관하여)
- [ ] Master Process와 Worker Process의 역할을 구분할 수 있는가?
- [ ] `worker_processes auto`와 `worker_connections`로 최대 동시 연결 수를 계산할 수 있는가?
- [ ] epoll(Linux)과 kqueue(macOS/BSD)가 무엇이며, nginx에서 어떻게 사용되는지 설명할 수 있는가?
- [ ] epoll의 edge-triggered 모드와 level-triggered 모드의 차이를 설명할 수 있는가?
- [ ] accept_mutex와 SO_REUSEPORT의 역할과 thundering herd 문제를 설명할 수 있는가?
- [ ] nginx 설정 파일의 계층 구조(main → events → http → server → location)를 설명할 수 있는가?
- [ ] simple directive와 block directive의 차이를 설명할 수 있는가?
- [ ] 상위 컨텍스트의 directive가 하위로 상속되는 규칙과, 배열형 directive(`proxy_set_header`, `add_header`)의 주의점을 알고 있는가?
- [ ] nginx 변수의 scope와 lazy evaluation 특성을 설명할 수 있는가?
- [ ] map directive의 동작 원리와 활용 사례를 설명할 수 있는가?
- [ ] Location matching 우선순위를 정확히 말할 수 있는가? (`=` → `^~` → `~` / `~*` → prefix longest match)
- [ ] `try_files` directive의 동작 방식을 설명할 수 있는가?
- [ ] HTTP 요청 처리의 11개 phase를 순서대로 나열하고, 각 phase에서 실행되는 모듈을 설명할 수 있는가?
- [ ] satisfy any와 satisfy all의 차이를 설명할 수 있는가?
- [ ] rewrite의 flag(last, break, redirect, permanent)의 차이를 설명할 수 있는가?
- [ ] `proxy_pass`에 trailing slash가 있을 때와 없을 때의 차이를 설명할 수 있는가?
- [ ] proxy buffering이 켜져 있을 때와 꺼져 있을 때의 차이, 각각 적합한 사용 사례를 설명할 수 있는가?
- [ ] proxy_connect_timeout, proxy_read_timeout, proxy_send_timeout의 차이와 각각의 에러 코드를 설명할 수 있는가?
- [ ] proxy_cache의 캐시 존, 캐시 키, cache levels의 역할을 설명할 수 있는가?
- [ ] `proxy_cache_use_stale`이 어떤 상황에서 유용한지 설명할 수 있는가?
- [ ] microcaching의 원리와 왜 효과적인지 설명할 수 있는가?
- [ ] 로드 밸런싱 알고리즘(Round Robin, Weighted, Least Connections, IP Hash, Generic Hash, Random Two Choices)의 차이와 각각의 적합한 사용 사례를 설명할 수 있는가?
- [ ] consistent hashing이 일반 hash와 어떻게 다른지, 서버 추가/제거 시 어떤 장점이 있는지 설명할 수 있는가?
- [ ] passive health check와 active health check의 차이를 설명할 수 있는가?
- [ ] Leaky bucket 알고리즘으로 rate limiting이 어떻게 동작하는지 설명할 수 있는가? `burst`와 `nodelay`의 역할은?
- [ ] `limit_req_zone`과 `limit_conn_zone`의 차이를 설명할 수 있는가?
- [ ] 여러 rate limit zone을 동시에 적용하는 방법과 whitelist 패턴을 구성할 수 있는가?
- [ ] SSL/TLS termination의 개념과, `ssl_protocols`, `ssl_ciphers`, OCSP stapling을 설명할 수 있는가?
- [ ] certificate chain의 구성과 fullchain.pem의 내용을 설명할 수 있는가?
- [ ] TLS 1.3이 TLS 1.2와 비교하여 어떤 점이 개선되었는지 설명할 수 있는가?
- [ ] SSL session resumption(session cache vs session tickets)의 차이와 보안 트레이드오프를 설명할 수 있는가?
- [ ] HTTP/2를 nginx에서 어떻게 활성화하며, ALPN의 역할은 무엇인가?
- [ ] Security headers(HSTS, CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy)의 역할을 각각 설명할 수 있는가?
- [ ] CORS 설정에서 preflight 요청의 처리 방법을 설명할 수 있는가?
- [ ] `$request_time`과 `$upstream_response_time`의 차이를 설명할 수 있는가?
- [ ] 조건부 로깅(`if=$loggable`)의 사용 사례를 설명할 수 있는가?
- [ ] syslog 출력과 JSON 로그 포맷의 활용 사례를 설명할 수 있는가?
- [ ] debug logging을 특정 IP에 대해서만 활성화하는 방법을 알고 있는가?
- [ ] `auth_request`를 사용한 서브요청 기반 인증의 동작 방식을 설명할 수 있는가?
- [ ] Stream module(TCP/UDP 프록시)은 언제 사용하며, SSL passthrough과의 관계를 설명할 수 있는가?
- [ ] 정적 모듈과 동적 모듈(`load_module`)의 차이를 설명할 수 있는가?
- [ ] sendfile, tcp_nopush, tcp_nodelay 세 가지의 역할과 상호작용을 설명할 수 있는가?
- [ ] open_file_cache의 역할과 설정 방법을 설명할 수 있는가?
- [ ] sub_filter, mirror, split_clients의 활용 사례를 설명할 수 있는가?
- [ ] Nginx Ingress Controller가 Kubernetes에서 어떻게 동작하는지 설명할 수 있는가? (watch → nginx.conf 생성 → reload)
- [ ] Ingress 리소스의 pathType (Exact, Prefix, ImplementationSpecific)의 차이를 설명할 수 있는가?
- [ ] Nginx Ingress Controller의 canary annotation으로 트래픽 분할 배포를 구성할 수 있는가?
- [ ] Ingress Controller ConfigMap으로 글로벌 설정을 관리하는 방법을 알고 있는가?
- [ ] WebSocket 프록시 시 필요한 헤더 설정(`Upgrade`, `Connection`)과 `map` directive의 역할을 알고 있는가?
- [ ] gzip 압축 설정에서 `gzip_vary`의 역할을 설명할 수 있는가?
- [ ] 502, 503, 504 에러의 원인을 구분하고 각각의 해결 방법을 설명할 수 있는가?
- [ ] nginx 설정에서 흔한 실수 5가지를 알고 있는가? (trailing slash, 배열형 directive, if is evil, root vs alias, resolver)
- [ ] Kubernetes에서 ConfigMap으로 nginx 설정을 관리할 수 있는가?
- [ ] HPA와 함께 nginx를 스케일링하는 방법을 설명할 수 있는가?

---

## 참고문헌

- [nginx Official Documentation](https://nginx.org/en/docs/) - nginx 공식 문서 전체 색인
- [nginx Beginner's Guide](https://nginx.org/en/docs/beginners_guide.html) - 공식 초보자 가이드
- [nginx Admin Guide](https://docs.nginx.com/nginx/admin-guide/) - 관리자용 종합 가이드 (로드 밸런싱, 캐싱, SSL 등)
- [ngx_http_core_module Reference](https://nginx.org/en/docs/http/ngx_http_core_module.html) - HTTP 코어 모듈 레퍼런스 (location, server, listen 등)
- [nginx Variables Index](https://nginx.org/en/docs/varindex.html) - 사용 가능한 모든 내장 변수 색인
- [nginx Pitfalls and Common Mistakes](https://www.nginx.com/resources/wiki/start/topics/tutorials/config_pitfalls/) - 흔한 설정 실수와 올바른 방법
- [Agentzh's nginx Tutorials](https://openresty.org/download/agentzh-nginx-tutorials-en.html) - nginx 내부 동작 원리 심화 학습
- [Nginx Ingress Controller Documentation](https://kubernetes.github.io/ingress-nginx/) - Kubernetes Ingress Controller 공식 문서 (annotations, 설정 등)
- [nginx HTTP Request Processing Phases](https://nginx.org/en/docs/dev/development_guide.html#http_phases) - 공식 개발자 가이드의 HTTP phase 설명
- [Mozilla SSL Configuration Generator](https://ssl-config.mozilla.org/) - Mozilla 추천 SSL/TLS 설정 생성기
- [OWASP Secure Headers Project](https://owasp.org/www-project-secure-headers/) - 보안 헤더 모범 사례
