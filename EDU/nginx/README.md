# nginx - 웹 서버 / 리버스 프록시

## 개념

### nginx란?

nginx(발음: "engine-x")는 Igor Sysoev가 2004년에 공개한 고성능 웹 서버이자 리버스 프록시이다. 이벤트 기반(event-driven) 아키텍처로 설계되어, 수만 개의 동시 연결을 적은 메모리로 처리할 수 있다. 웹 서버, 리버스 프록시, 로드 밸런서, HTTP 캐시, API 게이트웨이, SSL/TLS 터미네이터 등 다양한 역할을 수행한다. 이 프로젝트에서는 `nginx:alpine` 이미지를 데모 앱으로 사용한다.

### 핵심 개념

| 개념 | 설명 |
|------|------|
| Web Server | 정적 파일(HTML, CSS, JS, 이미지)을 제공하는 서버이다 |
| Reverse Proxy | 클라이언트 요청을 백엔드 서버로 전달하고 응답을 반환하는 중개자이다 |
| Load Balancer | 여러 백엔드 서버에 트래픽을 분산하여 가용성과 성능을 높인다 |
| Upstream | 리버스 프록시가 요청을 전달할 백엔드 서버 그룹이다 |
| Master Process | 설정 읽기, 포트 바인딩, Worker Process 관리를 담당한다 |
| Worker Process | 실제 클라이언트 요청을 처리하는 프로세스이다. 각각 독립적인 event loop를 실행한다 |
| Location | URL 경로별 처리 규칙을 정의하는 설정 블록이다 |
| Directive | nginx 설정의 최소 단위이다. simple directive와 block directive로 나뉜다 |

---

### 이 프로젝트에서의 실습 환경

이 프로젝트에서 nginx는 dev 클러스터의 `demo` 네임스페이스에 데모 웹 앱으로 배포된다.

- 매니페스트: `manifests/demo/nginx-app.yaml`
- Deployment 이름: `nginx-web` (주의: `nginx`가 아님)
- Service 이름: `nginx-web` (NodePort 30080)
- 이미지: `nginx:alpine`
- Replicas: 3
- HPA: min 3 → max 10 (CPU 50%)
- k6 부하 테스트의 주요 타겟이다
- 실습 대상 클러스터: dev (`kubeconfig/dev.yaml`)

```bash
# dev 클러스터에서 nginx 확인
export KUBECONFIG=kubeconfig/dev.yaml
kubectl get pods -n demo -l app=nginx-web
# 브라우저에서 http://<dev-worker-ip>:30080 접속
```

---

### 1. Event-Driven Architecture Deep Dive

nginx의 핵심 강점은 **이벤트 기반 비동기 아키텍처**이다.

#### Master Process vs Worker Process

```
                     ┌──────────────────────────────────────────────────┐
                     │                 nginx                           │
                     │                                                 │
                     │  ┌──────────────────────┐                       │
                     │  │   Master Process     │                       │
                     │  │  - 설정 파일 읽기       │                       │
                     │  │  - 포트 바인딩(bind)    │                       │
                     │  │  - Worker 생성/관리     │                       │
                     │  │  - 시그널 처리          │                       │
                     │  │  - 로그 파일 관리       │                       │
                     │  └────┬────┬────┬───────┘                       │
                     │       │    │    │                                │
                     │  ┌────▼──┐ │ ┌──▼─────┐  ┌──────────┐          │
                     │  │Worker │ │ │Worker  │  │Worker    │          │
                     │  │  #1   │ │ │  #2    │  │  #N      │          │
                     │  │       │ │ │        │  │          │          │
                     │  │ event │ │ │ event  │  │ event    │          │
                     │  │ loop  │ │ │ loop   │  │ loop     │          │
                     │  │(epoll/│ │ │(epoll/ │  │(epoll/   │          │
                     │  │kqueue)│ │ │kqueue) │  │kqueue)   │          │
                     │  └───────┘ │ └────────┘  └──────────┘          │
                     │            │                                    │
                     │       ┌────▼──────┐                             │
                     │       │ Cache     │                             │
                     │       │ Manager/  │                             │
                     │       │ Loader    │                             │
                     │       └───────────┘                             │
                     └──────────────────────────────────────────────────┘
```

**Master Process**는 root 권한으로 실행되며, 설정 파일 파싱, 포트 바인딩(privileged port 포함), Worker Process 생성 및 관리를 담당한다. 실제 클라이언트 요청은 처리하지 않는다. `nginx -s reload` 시 새 설정으로 새 Worker를 생성하고, 기존 Worker는 현재 처리 중인 요청을 완료한 뒤 graceful shutdown한다.

**Worker Process**는 non-privileged 사용자로 실행되며, 각각 독립적인 **event loop**를 돌면서 수천 개의 연결을 동시에 처리한다. Worker 간에는 메모리를 공유하지 않으므로 lock 경쟁이 없다.

#### Event Loop와 커넥션 처리 사이클

각 Worker Process는 OS 커널의 I/O 멀티플렉싱 API를 사용한다:

| OS | API | 특징 |
|----|-----|------|
| Linux | `epoll` | O(1) 이벤트 통지, edge-triggered/level-triggered 지원 |
| macOS / BSD | `kqueue` | 파일, 소켓, 시그널, 타이머 등 다양한 이벤트 감시 |
| Solaris | `eventport` | Solaris 10+ 지원 |

커넥션 처리 사이클은 다음과 같다:

```
1. accept()   → 새 클라이언트 연결 수락 (listen socket에서 이벤트 발생)
2. read()     → 클라이언트로부터 요청 데이터 읽기 (non-blocking)
3. process    → 요청 파싱, location 매칭, 핸들러 실행
4. write()    → 응답 데이터 전송 (non-blocking)
5. keepalive  → 연결 유지 또는 close
```

모든 I/O는 **non-blocking**이다. 데이터가 아직 준비되지 않으면 즉시 반환(EAGAIN)하고 다른 연결을 처리한다. 이것이 단일 Worker가 수천 개의 연결을 동시에 처리할 수 있는 비결이다.

#### 핵심 설정

```nginx
worker_processes auto;          # auto = CPU 코어 수만큼 Worker 생성
worker_cpu_affinity auto;       # 각 Worker를 특정 CPU 코어에 바인딩

events {
    worker_connections 1024;    # Worker 하나당 최대 동시 연결 수
    use epoll;                  # Linux에서 epoll 사용 (보통 자동 감지)
    multi_accept on;            # 한 번에 여러 연결을 accept
}
```

**최대 동시 연결 수** = `worker_processes` x `worker_connections`이다. 리버스 프록시로 사용할 경우 클라이언트 연결과 upstream 연결이 각각 1개씩 사용되므로, 실제 처리 가능한 동시 클라이언트 수는 절반이다.

---

### 2. nginx vs Apache

#### C10K 문제와 아키텍처 비교

C10K 문제란 단일 서버에서 10,000개의 동시 연결을 처리하는 것이다. Apache의 전통적인 모델로는 이를 해결하기 어려웠고, nginx는 이 문제를 해결하기 위해 설계되었다.

| 항목 | Apache (prefork MPM) | Apache (worker/event MPM) | nginx |
|------|---------------------|--------------------------|-------|
| 모델 | 요청당 프로세스 1개 | 요청당 스레드 1개 | 이벤트 기반, Worker당 수천 연결 |
| 동시 연결 10K | 프로세스 10,000개 필요 | 스레드 10,000개 필요 | Worker 2~4개로 충분 |
| 메모리 사용 | 매우 높음 (프로세스당 ~10MB) | 높음 (스레드당 ~2MB) | 매우 낮음 (Worker당 ~2~10MB) |
| Context Switch | 매우 빈번 | 빈번 | 거의 없음 |
| 정적 파일 성능 | 보통 | 보통 | 매우 빠름 (sendfile, direct I/O) |
| 동적 콘텐츠 | mod_php 등 내장 가능 | mod_php 등 내장 가능 | FastCGI/proxy로 외부 위임 |
| .htaccess | 지원 (디렉토리별 설정) | 지원 | 미지원 (성능상 이유) |
| 설정 변경 | .htaccess는 무중단 | .htaccess는 무중단 | reload 필요 (graceful) |

Apache의 prefork MPM에서는 각 요청이 별도의 프로세스를 점유하므로, keep-alive 연결이 많아지면 idle 프로세스가 메모리를 낭비한다. nginx는 이벤트 루프로 idle 연결을 거의 비용 없이 유지한다.

---

### 3. Configuration Structure

nginx 설정 파일은 **계층적 컨텍스트** 구조를 따른다.

```
┌─────────────────────────────────────────────────────────┐
│ Main Context (최상위)                                    │
│  - worker_processes, error_log, pid                     │
│                                                         │
│  ┌───────────────────────────────────────────────────┐  │
│  │ events { }                                        │  │
│  │  - worker_connections, use, multi_accept           │  │
│  └───────────────────────────────────────────────────┘  │
│                                                         │
│  ┌───────────────────────────────────────────────────┐  │
│  │ http { }                                          │  │
│  │  - 글로벌 HTTP 설정 (log_format, gzip, etc.)        │  │
│  │                                                   │  │
│  │  ┌─────────────────────────────────────────────┐  │  │
│  │  │ server { }  (= virtual host)                │  │  │
│  │  │  - listen, server_name                      │  │  │
│  │  │                                             │  │  │
│  │  │  ┌───────────────────────────────────────┐  │  │  │
│  │  │  │ location /path { }                    │  │  │  │
│  │  │  │  - proxy_pass, root, return, etc.     │  │  │  │
│  │  │  └───────────────────────────────────────┘  │  │  │
│  │  └─────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────┘  │
│                                                         │
│  ┌───────────────────────────────────────────────────┐  │
│  │ stream { }  (TCP/UDP 프록시)                       │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

#### Directive 종류

| 종류 | 설명 | 예시 |
|------|------|------|
| Simple directive | 세미콜론으로 끝나는 단일 값 설정이다 | `worker_processes 4;` |
| Block directive | 중괄호 `{ }`로 감싸는 설정 블록이다. 내부에 다른 directive를 포함한다 | `events { worker_connections 1024; }` |

#### 상속과 오버라이드 규칙

상위 컨텍스트의 설정은 하위 컨텍스트로 **상속**된다. 하위 컨텍스트에서 같은 directive를 선언하면 **오버라이드**된다.

```nginx
http {
    gzip on;                    # 모든 server에 상속

    server {
        listen 80;
        server_name a.com;
        # gzip on; 이 상속됨

        location /api {
            gzip off;           # 이 location에서만 gzip 비활성화 (오버라이드)
        }
    }

    server {
        listen 80;
        server_name b.com;
        gzip off;               # 이 server에서는 gzip 비활성화 (오버라이드)
    }
}
```

**주의**: `proxy_set_header`, `add_header` 같은 **배열형 directive**는 하위 컨텍스트에서 하나라도 재선언하면, 상위에서 상속된 값이 **전부 사라진다**. 이것은 매우 흔한 실수이다.

```nginx
http {
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;

    server {
        location /api {
            proxy_set_header X-Custom "value";
            # 주의: 여기서는 Host, X-Real-IP 헤더가 사라진다!
            # 필요하면 모두 다시 선언해야 한다
        }
    }
}
```

---

### 4. Location Matching Priority

nginx는 요청 URI를 `location` 블록과 매칭할 때, 정해진 **우선순위**를 따른다.

#### 매칭 순서 (높은 우선순위 → 낮은 우선순위)

| 순서 | 문법 | 이름 | 설명 |
|------|------|------|------|
| 1 | `= /path` | Exact match | URI가 정확히 일치할 때만 매칭한다. 즉시 결정된다 |
| 2 | `^~ /path` | Preferential prefix | Prefix 매칭 후, regex 검사를 건너뛴다 |
| 3 | `~ regex` | Case-sensitive regex | 대소문자를 구분하는 정규표현식 매칭이다 |
| 3 | `~* regex` | Case-insensitive regex | 대소문자를 구분하지 않는 정규표현식 매칭이다 |
| 4 | `/path` | Prefix match | 가장 긴 prefix가 일치하는 location을 선택한다 |

#### 매칭 알고리즘 상세

```
요청 URI 수신
    │
    ▼
1. exact match (=) 검사 ──── 일치 → 즉시 해당 location 사용 (종료)
    │
    ▼ (불일치)
2. 모든 prefix location 검사, 가장 긴 매칭을 기억(remember)
    │
    ├── 가장 긴 매칭이 ^~ → 즉시 해당 location 사용 (종료)
    │
    ▼ (^~ 아님)
3. 설정 파일 순서대로 regex location 검사
    │
    ├── 첫 번째 매칭 발견 → 해당 regex location 사용 (종료)
    │
    ▼ (regex 매칭 없음)
4. 2단계에서 기억한 가장 긴 prefix location 사용
```

#### 예시

```nginx
server {
    location = / {
        # 오직 "/" 요청만 매칭. "/index.html"은 매칭되지 않는다
        return 200 "exact root";
    }

    location ^~ /static/ {
        # /static/으로 시작하는 모든 요청. regex보다 우선한다
        root /var/www;
    }

    location ~ \.(gif|jpg|png)$ {
        # .gif, .jpg, .png로 끝나는 요청 (대소문자 구분)
        root /var/www/images;
    }

    location ~* \.(css|js)$ {
        # .css, .js로 끝나는 요청 (대소문자 무시)
        root /var/www/assets;
    }

    location / {
        # 위의 어떤 것도 매칭되지 않을 때 fallback
        proxy_pass http://backend;
    }
}
```

`/static/logo.png` 요청의 경우: prefix `^~` 매칭이 regex보다 우선하므로, `.png` regex가 아닌 `^~ /static/` location이 사용된다.

#### try_files Directive

`try_files`는 지정된 순서대로 파일/디렉토리 존재 여부를 확인하고, 마지막 인자는 fallback으로 사용한다.

```nginx
location / {
    try_files $uri $uri/ /index.html;
    # 1. $uri 파일이 존재하면 반환
    # 2. $uri/ 디렉토리의 index 파일 반환
    # 3. 둘 다 없으면 /index.html로 내부 리다이렉트 (SPA에 유용)
}

location /api/ {
    try_files $uri @backend;
    # 파일이 없으면 @backend named location으로 전달
}

location @backend {
    proxy_pass http://app_server;
}
```

---

### 5. Reverse Proxy Deep Dive

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

### 6. Load Balancing Algorithms

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

---

### 7. SSL/TLS Termination

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

---

### 8. Rate Limiting

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

---

### 9. HTTP Caching

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

---

### 10. Access Control

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

### 11. Logging

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

---

### 12. nginx Modules

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

#### Dynamic Module 로드

```nginx
# nginx.conf 최상위에서 동적 모듈 로드
load_module modules/ngx_http_geoip_module.so;
load_module modules/ngx_stream_module.so;

# 컴파일된 모듈 확인
# nginx -V 2>&1 | tr -- - '\n' | grep module
```

---

### 13. Nginx Ingress Controller in Kubernetes

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

---

## 자가 점검

- [ ] 웹 서버와 리버스 프록시의 차이를 설명할 수 있는가?
- [ ] nginx의 event-driven 모델이 Apache의 process/thread 모델과 어떻게 다른지 설명할 수 있는가? (C10K 문제와 연관하여)
- [ ] Master Process와 Worker Process의 역할을 구분할 수 있는가?
- [ ] `worker_processes auto`와 `worker_connections`로 최대 동시 연결 수를 계산할 수 있는가?
- [ ] epoll(Linux)과 kqueue(macOS/BSD)가 무엇이며, nginx에서 어떻게 사용되는지 설명할 수 있는가?
- [ ] nginx 설정 파일의 계층 구조(main → events → http → server → location)를 설명할 수 있는가?
- [ ] simple directive와 block directive의 차이를 설명할 수 있는가?
- [ ] 상위 컨텍스트의 directive가 하위로 상속되는 규칙과, 배열형 directive(`proxy_set_header`, `add_header`)의 주의점을 알고 있는가?
- [ ] Location matching 우선순위를 정확히 말할 수 있는가? (`=` → `^~` → `~` / `~*` → prefix longest match)
- [ ] `try_files` directive의 동작 방식을 설명할 수 있는가?
- [ ] `proxy_pass`에 trailing slash가 있을 때와 없을 때의 차이를 설명할 수 있는가?
- [ ] proxy buffering이 켜져 있을 때와 꺼져 있을 때의 차이, 각각 적합한 사용 사례를 설명할 수 있는가?
- [ ] proxy_cache의 캐시 존, 캐시 키, cache levels의 역할을 설명할 수 있는가?
- [ ] `proxy_cache_use_stale`이 어떤 상황에서 유용한지 설명할 수 있는가?
- [ ] 로드 밸런싱 알고리즘(Round Robin, Weighted, Least Connections, IP Hash, Generic Hash, Random Two Choices)의 차이와 각각의 적합한 사용 사례를 설명할 수 있는가?
- [ ] Leaky bucket 알고리즘으로 rate limiting이 어떻게 동작하는지 설명할 수 있는가? `burst`와 `nodelay`의 역할은?
- [ ] `limit_req_zone`과 `limit_conn_zone`의 차이를 설명할 수 있는가?
- [ ] SSL/TLS termination의 개념과, `ssl_protocols`, `ssl_ciphers`, OCSP stapling을 설명할 수 있는가?
- [ ] HTTP/2를 nginx에서 어떻게 활성화하며, HTTP/2의 장점은 무엇인가?
- [ ] `$request_time`과 `$upstream_response_time`의 차이를 설명할 수 있는가?
- [ ] 조건부 로깅(`if=$loggable`)의 사용 사례를 설명할 수 있는가?
- [ ] `auth_request`를 사용한 서브요청 기반 인증의 동작 방식을 설명할 수 있는가?
- [ ] Stream module(TCP/UDP 프록시)은 언제 사용하는가?
- [ ] 정적 모듈과 동적 모듈(`load_module`)의 차이를 설명할 수 있는가?
- [ ] Nginx Ingress Controller가 Kubernetes에서 어떻게 동작하는지 설명할 수 있는가? (watch → nginx.conf 생성 → reload)
- [ ] Ingress 리소스의 pathType (Exact, Prefix, ImplementationSpecific)의 차이를 설명할 수 있는가?
- [ ] Nginx Ingress Controller의 canary annotation으로 트래픽 분할 배포를 구성할 수 있는가?
- [ ] WebSocket 프록시 시 필요한 헤더 설정(`Upgrade`, `Connection`)과 `map` directive의 역할을 알고 있는가?
- [ ] gzip 압축 설정에서 `gzip_vary`의 역할을 설명할 수 있는가?
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
