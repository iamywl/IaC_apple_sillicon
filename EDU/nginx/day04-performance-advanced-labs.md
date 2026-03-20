# Day 4: Performance Tuning, 고급 기능, 트러블슈팅, 실습

성능 최적화, 고급 기능(sub_filter, mirror, split_clients), 트러블슈팅, 실습 과제를 학습한다.

---

### 16. Performance Tuning

nginx 성능 최적화를 위한 핵심 설정들이다.

#### Worker 설정

```nginx
# CPU 코어 수에 맞게 Worker 프로세스를 생성한다
worker_processes auto;

# 각 Worker를 특정 CPU 코어에 바인딩하여 cache affinity를 높인다
worker_cpu_affinity auto;

# Worker당 열 수 있는 최대 파일 수 (ulimit -n 값 이상으로 설정)
worker_rlimit_nofile 65535;

events {
    # Worker당 최대 동시 연결 수
    # 리버스 프록시: client + upstream = 2 연결/요청
    # 실제 처리 가능 클라이언트 수 = worker_processes * worker_connections / 2
    worker_connections 16384;

    # 한 번의 이벤트 루프에서 여러 연결을 accept한다
    multi_accept on;

    # Linux에서 epoll 사용 (보통 자동 감지)
    use epoll;
}
```

#### sendfile, tcp_nopush, tcp_nodelay

이 세 가지 설정은 정적 파일 전송 성능에 큰 영향을 미친다.

```nginx
http {
    # sendfile: 파일을 커널 공간에서 직접 소켓으로 전송한다
    # 일반 read()/write()는 커널↔유저 공간 간 데이터 복사가 발생하지만,
    # sendfile()은 커널 내에서 직접 전송하므로 CPU 사용량과 메모리 복사가 줄어든다
    sendfile on;

    # tcp_nopush: sendfile 사용 시 응답 헤더와 파일 데이터를 하나의 패킷으로 전송한다
    # TCP 패킷 수를 줄여 네트워크 효율을 높인다 (TCP_CORK/TCP_NOPUSH)
    tcp_nopush on;

    # tcp_nodelay: keep-alive 연결에서 작은 데이터도 즉시 전송한다
    # Nagle 알고리즘을 비활성화한다 (TCP_NODELAY)
    # API 응답처럼 저지연이 중요한 경우에 유용하다
    tcp_nodelay on;
}
```

세 가지 설정의 상호작용:

```
sendfile on + tcp_nopush on:
  1. 응답 헤더와 파일 데이터를 버퍼에 모은다 (tcp_nopush = TCP_CORK)
  2. 충분한 데이터가 모이면 하나의 큰 패킷으로 전송한다
  3. 마지막 패킷 전송 시 TCP_CORK를 해제하고 tcp_nodelay로 즉시 전송한다

결과: 패킷 수가 줄어들면서도 마지막 데이터는 지연 없이 전송된다
```

#### Keep-Alive 설정

```nginx
http {
    # 클라이언트 keep-alive
    keepalive_timeout 65;         # keep-alive 연결 유지 시간 (초)
    keepalive_requests 1000;      # 하나의 keep-alive 연결에서 처리할 최대 요청 수

    # upstream keep-alive (upstream 블록에서 설정)
    # upstream backend {
    #     keepalive 32;            # Worker당 유지할 idle upstream 연결 수
    #     keepalive_timeout 60s;
    #     keepalive_requests 1000;
    # }
}
```

#### Gzip 최적화

```nginx
http {
    gzip on;
    gzip_comp_level 5;          # 1-9, CPU와 압축률의 균형 (5-6 권장)
    gzip_min_length 256;        # 256바이트 이하는 압축하지 않음
    gzip_proxied any;           # 프록시 응답도 압축
    gzip_vary on;               # Vary: Accept-Encoding 헤더 추가

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
        application/vnd.api+json
        image/svg+xml;

    # gzip_static: 미리 압축된 .gz 파일이 있으면 사용 (CPU 절약)
    gzip_static on;
    # /var/www/style.css 요청 시 /var/www/style.css.gz 가 있으면 직접 제공
}
```

#### open_file_cache

자주 접근하는 파일의 메타데이터(fd, size, mtime)를 캐시하여 시스템 콜을 줄인다.

```nginx
http {
    # 최대 10,000개 항목, 60초간 미사용 시 제거
    open_file_cache max=10000 inactive=60s;

    # 캐시 유효성을 30초마다 확인
    open_file_cache_valid 30s;

    # 최소 2번 접근된 파일만 캐시 (거의 접근되지 않는 파일은 캐시하지 않음)
    open_file_cache_min_uses 2;

    # 파일 탐색 에러(ENOENT 등)도 캐시하여 불필요한 stat() 호출 방지
    open_file_cache_errors on;
}
```

#### 커널 파라미터 튜닝

nginx 자체 설정 외에 OS 커널 파라미터도 조정해야 최적 성능을 얻을 수 있다.

```bash
# /etc/sysctl.conf 또는 /etc/sysctl.d/nginx.conf
# 적용: sysctl -p

# 동시 연결 수 관련
net.core.somaxconn = 65535               # listen backlog 최대값
net.ipv4.tcp_max_syn_backlog = 65535     # SYN 큐 크기
net.core.netdev_max_backlog = 65535      # 네트워크 인터페이스 큐 크기

# TCP 연결 관련
net.ipv4.tcp_fin_timeout = 15            # FIN_WAIT2 타임아웃 (기본 60초)
net.ipv4.tcp_tw_reuse = 1               # TIME_WAIT 소켓 재사용
net.ipv4.ip_local_port_range = 1024 65535  # 사용 가능한 포트 범위 확대

# Keep-Alive 관련
net.ipv4.tcp_keepalive_time = 600        # keep-alive 프로브 시작 시간
net.ipv4.tcp_keepalive_intvl = 30        # 프로브 간격
net.ipv4.tcp_keepalive_probes = 3        # 프로브 횟수

# 파일 디스크립터
fs.file-max = 1000000                    # 시스템 전체 최대 fd 수
```

---

### 17. 고급 기능

#### sub_filter (응답 내용 치환)

upstream에서 받은 응답 본문의 일부를 치환하여 클라이언트에 전달한다.

```nginx
location / {
    proxy_pass http://backend;

    # 응답 본문에서 문자열 치환
    sub_filter 'http://internal-api.local' 'https://api.example.com';
    sub_filter 'backend-server-name' 'example.com';

    # 모든 occurrence를 치환 (기본값: 첫 번째만)
    sub_filter_once off;

    # 치환 대상 MIME 타입 (기본: text/html)
    sub_filter_types text/html text/css application/json;
}
```

#### mirror (트래픽 미러링)

실제 요청을 처리하면서 동시에 다른 서버로 복제 요청을 보낸다. 새 버전 서버의 성능 테스트, 데이터 수집 등에 유용하다.

```nginx
location /api/ {
    # 원본 요청 처리
    proxy_pass http://production_backend;

    # 미러 요청 (응답은 무시됨)
    mirror /mirror;
    mirror_request_body on;
}

location = /mirror {
    internal;
    proxy_pass http://test_backend$request_uri;
    proxy_set_header Host $host;
    proxy_set_header X-Original-URI $request_uri;
}
```

#### split_clients (A/B Testing)

클라이언트를 해시값 기반으로 분할하여 A/B 테스트를 구현한다.

```nginx
http {
    # $remote_addr을 해시하여 비율 기반 분할
    split_clients "$remote_addr$uri" $variant {
        20%     "new_design";      # 20%의 사용자에게 새 디자인
        *       "old_design";      # 나머지 80%는 기존 디자인
    }

    server {
        location / {
            # $variant 값에 따라 다른 backend로 라우팅
            if ($variant = "new_design") {
                proxy_pass http://new_backend;
                break;
            }
            proxy_pass http://old_backend;
        }

        # 또는 변수를 응답 헤더로 전달하여 frontend에서 처리
        location /app/ {
            proxy_pass http://backend;
            proxy_set_header X-Variant $variant;
        }
    }
}
```

#### geo Module 심화

`geo` module은 클라이언트 IP 주소를 기반으로 변수 값을 설정한다.

```nginx
http {
    # 국가/지역별 라우팅
    geo $country {
        default        "unknown";
        1.0.0.0/8      "AU";
        2.0.0.0/8      "EU";
        3.0.0.0/8      "US";
        # GeoIP 데이터베이스를 사용하면 더 정확한 매핑이 가능하다
    }

    # IP 기반 tier 구분
    geo $rate_tier {
        default        "standard";
        10.0.0.0/8     "premium";     # 내부 서비스는 rate limit 완화
        192.168.0.0/16 "premium";
    }

    map $rate_tier $rate_limit {
        "standard" 10;
        "premium"  100;
    }
}
```

---

### 18. 트러블슈팅

#### 502 Bad Gateway

원인: nginx가 upstream 서버에 연결할 수 없거나, upstream이 잘못된 응답을 보냈다.

```bash
# 1. upstream 서버가 실행 중인지 확인
kubectl get pods -n demo -l app=nginx-web
# STATUS가 Running인지 확인

# 2. upstream 서버에 직접 접근 가능한지 확인
kubectl exec -n demo deploy/nginx-web -- curl -s localhost:80

# 3. DNS 해석이 가능한지 확인 (Service 이름)
kubectl exec -n demo deploy/nginx-web -- nslookup nginx-web.demo.svc.cluster.local

# 4. error log 확인
kubectl logs -n demo deploy/nginx-web --tail=50

# 흔한 원인과 해결책:
# - upstream 서버가 다운됨 → Pod 상태 확인, 재시작
# - proxy_pass URL 오타 → 설정 파일 확인
# - DNS 해석 실패 → Service 이름 확인
# - 응답 헤더가 proxy_buffer_size를 초과 → proxy_buffer_size 증가
```

#### 503 Service Unavailable

원인: 모든 upstream 서버가 unavailable 상태이거나, rate limit에 걸렸다.

```bash
# 1. upstream 서버 상태 확인
kubectl get endpoints -n demo nginx-web
# ENDPOINTS가 비어있으면 Pod가 Ready 상태가 아님

# 2. rate limiting에 의한 503인지 확인
# error log에 "limiting requests" 메시지가 있는지 확인
kubectl logs -n demo deploy/nginx-web --tail=50 | grep "limiting"

# 3. max_conns 제한에 걸렸는지 확인
# error log에 "no live upstreams" 메시지가 있는지 확인

# 해결책:
# - rate limiting: burst 값 증가 또는 limit_req_status 429로 변경
# - upstream down: max_fails/fail_timeout 조정
# - 모든 upstream 실패: backup 서버 추가
```

#### 504 Gateway Timeout

원인: upstream 서버가 설정된 타임아웃 내에 응답하지 않았다.

```bash
# 1. upstream 응답 시간 확인
# access log에서 $upstream_response_time 확인
kubectl exec -n demo deploy/nginx-web -- tail -f /var/log/nginx/access.log

# 2. 타임아웃 설정 확인
kubectl exec -n demo deploy/nginx-web -- nginx -T | grep -E "proxy_(connect|read|send)_timeout"

# 해결책:
# - proxy_read_timeout 증가 (느린 API의 경우)
# - upstream 서버 성능 최적화 (근본 원인 해결)
# - 캐싱 활성화하여 upstream 부하 감소
```

#### 설정 테스트 및 디버깅

```bash
# 설정 문법 검사
nginx -t

# 전체 설정 덤프 (include된 파일 포함)
nginx -T

# 현재 실행 중인 nginx의 설정 확인
# tart-infra 프로젝트에서:
export KUBECONFIG=kubeconfig/dev.yaml
kubectl exec -n demo deploy/nginx-web -- nginx -T

# stub_status로 실시간 연결 통계 확인
kubectl exec -n demo deploy/nginx-web -- curl -s localhost/nginx_status

# 특정 요청의 처리 과정 추적 (debug 로그)
# nginx가 --with-debug로 컴파일된 경우에만 가능
error_log /var/log/nginx/debug.log debug;

# 최근 에러 확인
kubectl logs -n demo deploy/nginx-web --tail=100 | grep -i error
```

#### 흔한 설정 실수 Top 5

1. **proxy_pass trailing slash 누락**: URI 치환 규칙을 잘못 이해하여 404 발생
2. **배열형 directive 상속 문제**: `proxy_set_header`를 하위에서 재선언하면 상위 설정이 전부 사라짐
3. **if is evil**: `if` directive 내에서 `proxy_pass` 사용 시 예상치 못한 동작 발생
4. **root vs alias**: `location /images/ { root /var/www; }` → `/var/www/images/`에서 파일을 찾지만, `alias /var/www/;` → `/var/www/`에서 찾는다
5. **resolver 미설정**: `proxy_pass`에 변수를 사용하면 nginx는 시작 시가 아닌 런타임에 DNS를 해석하므로 `resolver` 설정이 필요하다

```nginx
# if is evil 예시: 이렇게 하면 안 된다
location / {
    if ($request_method = POST) {
        proxy_pass http://backend;    # 이 설정은 예상대로 동작하지 않을 수 있다
    }
    proxy_pass http://other_backend;
}

# 올바른 방법: map + error_page 또는 별도 location 사용
map $request_method $backend_target {
    POST    "http://post-backend";
    default "http://default-backend";
}

location / {
    proxy_pass $backend_target;
    resolver 127.0.0.11 valid=30s;  # Docker/K8s DNS resolver
}
```

---

## 실습

### 실습 1: nginx Pod 확인 및 접속

```bash
# nginx Pod 확인
kubectl get pods -n demo -l app=nginx-web

# nginx 포트포워딩
kubectl port-forward -n demo svc/nginx-web 8080:80

# 브라우저에서 http://localhost:8080 접속

# nginx 버전 확인
kubectl exec -n demo deploy/nginx-web -- nginx -v

# 설정 테스트 (문법 오류 검사)
kubectl exec -n demo deploy/nginx-web -- nginx -t
```

### 실습 2: nginx 설정 확인 및 전체 덤프

```bash
# 기본 설정 파일 확인
kubectl exec -n demo deploy/nginx-web -- cat /etc/nginx/nginx.conf

# 사이트 설정 확인
kubectl exec -n demo deploy/nginx-web -- cat /etc/nginx/conf.d/default.conf

# 현재 연결 상태 (stub_status 모듈)
kubectl exec -n demo deploy/nginx-web -- curl -s localhost/nginx_status

# 전체 설정 덤프 (nginx -T): include된 모든 파일을 한 번에 출력
# 디버깅 시 매우 유용하다. 실제로 적용된 전체 설정을 확인할 수 있다
kubectl exec -n demo deploy/nginx-web -- nginx -T
```

### 실습 3: ConfigMap으로 설정 관리

```bash
# nginx 설정을 ConfigMap으로 관리하는 경우
kubectl get configmap -n demo -l app=nginx-web

# ConfigMap 내용 확인
kubectl describe configmap nginx-config -n demo
```

### 실습 4: 부하 테스트 타겟으로 사용

```bash
# nginx에 부하 테스트
kubectl run load-test --rm -it --image=busybox -- sh -c \
  "while true; do wget -q -O- http://nginx-web.demo.svc.cluster.local; done"

# HPA 동작 관찰
kubectl get hpa -n demo -w
```

### 실습 5: Location Matching 테스트

여러 location 블록을 설정하고, 어떤 location이 매칭되는지 테스트한다.

```bash
# 테스트용 ConfigMap 생성
cat <<'EOF' | kubectl apply -f -
apiVersion: v1
kind: ConfigMap
metadata:
  name: nginx-location-test
  namespace: demo
data:
  default.conf: |
    server {
        listen 80;

        location = / {
            return 200 'exact match: /\n';
            add_header Content-Type text/plain;
        }

        location ^~ /static/ {
            return 200 'preferential prefix: /static/\n';
            add_header Content-Type text/plain;
        }

        location ~ \.(jpg|png|gif)$ {
            return 200 'regex case-sensitive: image file\n';
            add_header Content-Type text/plain;
        }

        location ~* \.css$ {
            return 200 'regex case-insensitive: CSS file\n';
            add_header Content-Type text/plain;
        }

        location /api/ {
            return 200 'prefix match: /api/\n';
            add_header Content-Type text/plain;
        }

        location / {
            return 200 'default prefix match: /\n';
            add_header Content-Type text/plain;
        }
    }
EOF

# 테스트 (포트포워딩 후)
curl http://localhost:8080/                     # → exact match: /
curl http://localhost:8080/index.html           # → default prefix match: /
curl http://localhost:8080/static/logo.png      # → preferential prefix: /static/
curl http://localhost:8080/images/photo.jpg     # → regex case-sensitive: image file
curl http://localhost:8080/css/style.css        # → regex case-insensitive: CSS file
curl http://localhost:8080/css/style.CSS        # → regex case-insensitive: CSS file
curl http://localhost:8080/api/users            # → prefix match: /api/
```

### 실습 6: Rate Limiting 설정 및 테스트

```bash
# Rate Limiting 설정을 포함한 ConfigMap
cat <<'EOF' | kubectl apply -f -
apiVersion: v1
kind: ConfigMap
metadata:
  name: nginx-ratelimit-test
  namespace: demo
data:
  nginx.conf: |
    events {
        worker_connections 1024;
    }
    http {
        limit_req_zone $binary_remote_addr zone=test:10m rate=1r/s;

        server {
            listen 80;

            location / {
                limit_req zone=test burst=5 nodelay;
                limit_req_status 429;
                return 200 'OK\n';
                add_header Content-Type text/plain;
            }
        }
    }
EOF

# 빠른 연속 요청으로 rate limit 테스트
for i in $(seq 1 20); do
    echo -n "Request $i: "
    curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/
    echo
done
# 처음 6개(1 + burst 5)는 200, 이후는 429가 반환될 것이다
```

### 실습 7: Self-Signed 인증서로 SSL/TLS 설정

```bash
# Self-signed 인증서 생성
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout /tmp/nginx-selfsigned.key \
  -out /tmp/nginx-selfsigned.crt \
  -subj "/CN=localhost"

# Kubernetes Secret으로 저장
kubectl create secret tls nginx-tls-secret \
  -n demo \
  --cert=/tmp/nginx-selfsigned.crt \
  --key=/tmp/nginx-selfsigned.key

# HTTPS 설정을 포함한 ConfigMap 생성
cat <<'EOF' | kubectl apply -f -
apiVersion: v1
kind: ConfigMap
metadata:
  name: nginx-ssl-test
  namespace: demo
data:
  default.conf: |
    server {
        listen 80;
        return 301 https://$host$request_uri;
    }

    server {
        listen 443 ssl;
        server_name localhost;

        ssl_certificate     /etc/nginx/ssl/tls.crt;
        ssl_certificate_key /etc/nginx/ssl/tls.key;
        ssl_protocols       TLSv1.2 TLSv1.3;

        location / {
            return 200 'Hello over HTTPS!\n';
            add_header Content-Type text/plain;
        }
    }
EOF

# 테스트
curl -k https://localhost:8443/
curl -v http://localhost:8080/    # 301 → HTTPS로 리다이렉트 확인
```

### 실습 8: 커스텀 로그 포맷 설정

```bash
# 커스텀 로그 포맷이 포함된 설정
cat <<'EOF' | kubectl apply -f -
apiVersion: v1
kind: ConfigMap
metadata:
  name: nginx-log-test
  namespace: demo
data:
  nginx.conf: |
    events {
        worker_connections 1024;
    }
    http {
        log_format detailed '$remote_addr [$time_local] '
            '"$request" $status $body_bytes_sent '
            'rt=$request_time';

        server {
            listen 80;
            access_log /var/log/nginx/access.log detailed;

            location / {
                return 200 'OK\n';
                add_header Content-Type text/plain;
            }

            location /health {
                access_log off;
                return 200 'OK';
            }
        }
    }
EOF

# 요청 후 로그 확인
curl http://localhost:8080/
kubectl exec -n demo deploy/nginx-web -- tail -f /var/log/nginx/access.log
```

### 실습 9: Upstream 상태 및 연결 통계 확인

```bash
# stub_status로 연결 통계 확인
kubectl exec -n demo deploy/nginx-web -- curl -s localhost/nginx_status

# 출력 예시:
# Active connections: 3
# server accepts handled requests
#  1024 1024 2048
# Reading: 0 Writing: 1 Waiting: 2

# Active connections : 현재 활성 연결 수 (Reading + Writing + Waiting)
# accepts            : 수락한 총 연결 수
# handled            : 처리한 총 연결 수 (accepts와 같아야 정상)
# requests           : 처리한 총 요청 수 (keep-alive로 인해 handled보다 클 수 있음)
# Reading            : 요청 헤더를 읽고 있는 연결 수
# Writing            : 응답을 보내고 있는 연결 수
# Waiting            : keep-alive 대기 중인 유휴 연결 수

# handled < accepts 이면 worker_connections 한계에 도달한 것이다
# Waiting이 매우 높으면 keepalive_timeout을 줄이는 것을 고려한다
```

---

