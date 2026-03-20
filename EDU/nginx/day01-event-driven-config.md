# Day 1: Event-Driven Architecture와 설정 기초

nginx의 핵심 개념과 Event-Driven Architecture, Apache와의 비교, 설정 파일 구조, Location Matching, HTTP 처리 파이프라인을 학습한다.

---

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

#### epoll 심화: Edge-Triggered vs Level-Triggered

nginx는 Linux에서 `epoll`의 **edge-triggered (ET)** 모드를 사용한다. 두 모드의 차이를 이해하는 것이 중요하다.

| 모드 | 동작 방식 | 특징 |
|------|----------|------|
| Level-Triggered (LT) | fd가 ready 상태인 동안 계속 통지한다 | `select()`/`poll()`의 기본 동작과 동일하다. 안전하지만 불필요한 syscall이 발생할 수 있다 |
| Edge-Triggered (ET) | fd 상태가 변경될 때만 한 번 통지한다 | 더 효율적이지만, 한 번에 모든 데이터를 읽어야 한다. 그렇지 않으면 데이터가 유실된다 |

nginx가 ET 모드를 사용하는 이유는 다음과 같다:

1. **syscall 횟수 감소**: ready 상태에 대해 반복적으로 통지받지 않으므로 `epoll_wait()` 호출 빈도가 줄어든다
2. **높은 동시 연결에서 유리**: 수만 개의 fd를 감시할 때 불필요한 이벤트 처리가 없다
3. **non-blocking I/O와 궁합**: nginx는 모든 소켓을 non-blocking으로 설정하므로, ET 모드에서 `EAGAIN`이 반환될 때까지 반복 읽기가 자연스럽다

```c
// nginx 내부의 epoll ET 모드 읽기 패턴 (의사 코드)
while (1) {
    n = read(fd, buf, size);
    if (n == -1 && errno == EAGAIN) {
        break;  // 더 이상 읽을 데이터가 없음 → 다른 이벤트 처리
    }
    if (n == 0) {
        // 연결 종료
        break;
    }
    // 읽은 데이터 처리
}
```

#### kqueue 심화 (macOS/BSD)

`kqueue`는 BSD 계열(macOS 포함)에서 사용하는 이벤트 통지 메커니즘이다. `epoll`과 유사하지만 더 범용적이다.

| 기능 | epoll | kqueue |
|------|-------|--------|
| 소켓 이벤트 | O | O |
| 파일 변경 감시 | X (inotify 별도 사용) | O (EVFILT_VNODE) |
| 시그널 처리 | X (signalfd 별도 사용) | O (EVFILT_SIGNAL) |
| 타이머 | X (timerfd 별도 사용) | O (EVFILT_TIMER) |
| 프로세스 이벤트 | X | O (EVFILT_PROC) |
| Batch 변경 | 불가 | O (changelist로 한 번에 여러 이벤트 등록/삭제) |

이 프로젝트에서 tart VM은 macOS 위에서 실행되므로, VM 내부 Linux 커널은 `epoll`을 사용하고, 호스트 macOS에서 nginx를 직접 실행하면 `kqueue`를 사용한다.

#### accept_mutex와 Connection 분배

여러 Worker Process가 동시에 listen socket을 감시하면, 새 연결이 들어올 때 모든 Worker가 깨어나는 **thundering herd** 문제가 발생할 수 있다.

```nginx
events {
    # accept_mutex: Worker들이 순서대로 accept하도록 뮤텍스를 사용한다
    # nginx 1.11.3+에서는 기본값이 off이다 (EPOLLEXCLUSIVE/SO_REUSEPORT 사용)
    accept_mutex on;
    accept_mutex_delay 500ms;  # mutex를 획득하지 못한 Worker의 재시도 간격
}
```

Linux 4.5+에서는 `EPOLLEXCLUSIVE` 플래그가 지원되어, 커널 레벨에서 하나의 프로세스만 깨우도록 할 수 있다. 또한 `reuseport` 옵션을 사용하면 커널이 연결을 Worker에 직접 분배한다:

```nginx
server {
    listen 80 reuseport;  # 각 Worker가 독립된 listen socket을 가짐
    # SO_REUSEPORT: 커널이 연결을 Worker에 분배 → lock 경쟁 제거
}
```

#### Graceful Reload 과정

`nginx -s reload` 실행 시 내부적으로 발생하는 과정이다:

```
1. Master Process가 새 설정 파일을 읽고 문법을 검증한다
2. 검증 성공 → 새 Worker Process들을 생성한다 (새 설정 적용)
3. 기존 Worker Process에 SIGQUIT 시그널을 전송한다
4. 기존 Worker는 새 연결 accept를 중단한다
5. 기존 Worker는 현재 처리 중인 요청을 모두 완료한다
6. 모든 요청이 완료되면 기존 Worker가 종료된다
7. 결과: 새 Worker만 남아 트래픽을 처리한다 (다운타임 없음)
```

Kubernetes 환경에서는 Pod 내의 nginx 프로세스에 직접 시그널을 보내는 대신, ConfigMap 변경 후 Pod를 rolling restart하는 방식을 사용하는 것이 일반적이다:

```bash
# tart-infra 프로젝트에서 nginx 설정 변경 후 rolling restart
export KUBECONFIG=kubeconfig/dev.yaml
kubectl rollout restart deployment/nginx-web -n demo
kubectl rollout status deployment/nginx-web -n demo
```

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

#### Variable Scope와 동작 원리

nginx 변수는 일반적인 프로그래밍 언어의 변수와 근본적으로 다르다. nginx 변수의 핵심 특징은 다음과 같다:

1. **변수 선언은 설정 전체에서 유효하다**: `set` directive로 선언한 변수는 모든 location에서 접근할 수 있다
2. **변수 값은 요청(request)마다 독립적이다**: 같은 변수라도 요청마다 고유한 값을 가진다
3. **변수는 lazily evaluated 된다**: 실제로 접근할 때 값이 계산된다 (built-in 변수의 경우)

```nginx
server {
    listen 80;

    # $dynamic_backend는 여기서 선언되지만, 값은 요청마다 다르다
    set $dynamic_backend "http://default-backend";

    location /api/v1 {
        set $dynamic_backend "http://v1-backend";
        proxy_pass $dynamic_backend;   # → http://v1-backend
    }

    location /api/v2 {
        set $dynamic_backend "http://v2-backend";
        proxy_pass $dynamic_backend;   # → http://v2-backend
    }

    location /api/latest {
        # $dynamic_backend 는 접근 가능하지만 이 location에서 set 하지 않았으므로
        # 초기값 "http://default-backend" 가 사용된다
        proxy_pass $dynamic_backend;
    }
}
```

#### map Directive 심화

`map` directive는 입력 변수를 기반으로 새로운 변수를 생성한다. `map` 블록은 `http` 컨텍스트에서만 선언할 수 있지만, 생성된 변수는 어디서든 사용할 수 있다. 변수 값은 **사용될 때만** 평가된다(lazy evaluation).

```nginx
http {
    # User-Agent 기반 디바이스 감지
    map $http_user_agent $device_type {
        default     "desktop";
        ~*mobile    "mobile";
        ~*tablet    "tablet";
        ~*bot       "crawler";
    }

    # URI 기반 API 버전 추출
    map $uri $api_version {
        default     "";
        ~^/api/v1/  "v1";
        ~^/api/v2/  "v2";
        ~^/api/v3/  "v3";
    }

    # 여러 조건을 결합 (map chaining)
    map $request_method $is_write_method {
        default 0;
        POST    1;
        PUT     1;
        PATCH   1;
        DELETE  1;
    }

    server {
        location /api/ {
            # map으로 생성된 변수를 헤더로 전달
            proxy_set_header X-Device-Type $device_type;
            proxy_set_header X-API-Version $api_version;
            proxy_pass http://backend;
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

### 5. HTTP 처리 파이프라인 (Request Phases)

nginx는 HTTP 요청을 처리할 때 **11개의 phase**를 순서대로 실행한다. 각 phase에는 하나 이상의 핸들러가 등록될 수 있다. 이 파이프라인 구조를 이해하면 nginx의 동작을 정확히 예측할 수 있다.

```
요청 수신
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│ Phase 1: POST_READ                                          │
│  - 요청 헤더를 읽은 직후 실행된다                                │
│  - realip_module: 프록시 뒤에서 실제 클라이언트 IP를 복원한다      │
│  - 예: set_real_ip_from, real_ip_header                     │
├─────────────────────────────────────────────────────────────┤
│ Phase 2: SERVER_REWRITE                                     │
│  - server 컨텍스트의 rewrite directive를 실행한다               │
│  - location 매칭 이전에 URI를 변환할 수 있다                     │
│  - 예: rewrite ^/old(.*)$ /new$1 permanent;                 │
├─────────────────────────────────────────────────────────────┤
│ Phase 3: FIND_CONFIG                                        │
│  - location 블록을 매칭한다 (사용자가 핸들러를 등록할 수 없다)      │
│  - 위의 location matching priority 규칙에 따라 결정된다          │
├─────────────────────────────────────────────────────────────┤
│ Phase 4: REWRITE                                            │
│  - 매칭된 location 내부의 rewrite directive를 실행한다           │
│  - set, rewrite, return 등이 여기서 실행된다                    │
├─────────────────────────────────────────────────────────────┤
│ Phase 5: POST_REWRITE                                       │
│  - rewrite 결과로 URI가 변경되었으면 FIND_CONFIG로 돌아간다       │
│  - 내부 리다이렉트 루프 방지를 위해 최대 10회로 제한된다           │
│  - (사용자가 핸들러를 등록할 수 없다)                            │
├─────────────────────────────────────────────────────────────┤
│ Phase 6: PREACCESS                                          │
│  - 접근 제어 이전의 전처리 단계이다                               │
│  - limit_req_module: 요청 속도 제한                            │
│  - limit_conn_module: 동시 연결 수 제한                        │
├─────────────────────────────────────────────────────────────┤
│ Phase 7: ACCESS                                             │
│  - 접근 제어를 수행한다                                         │
│  - allow/deny: IP 기반 접근 제어                               │
│  - auth_basic: HTTP Basic 인증                               │
│  - auth_request: 서브요청 기반 인증                             │
│  - satisfy any/all: 여러 접근 제어 모듈의 결합 방식               │
├─────────────────────────────────────────────────────────────┤
│ Phase 8: POST_ACCESS                                        │
│  - satisfy directive의 결과를 처리한다                          │
│  - (사용자가 핸들러를 등록할 수 없다)                            │
├─────────────────────────────────────────────────────────────┤
│ Phase 9: PRECONTENT                                         │
│  - 콘텐츠 생성 이전 단계이다                                    │
│  - try_files: 파일 존재 여부 확인                               │
│  - mirror: 요청 복제 (트래픽 미러링)                             │
├─────────────────────────────────────────────────────────────┤
│ Phase 10: CONTENT                                           │
│  - 실제 응답 콘텐츠를 생성한다                                   │
│  - proxy_pass: 리버스 프록시                                   │
│  - fastcgi_pass: FastCGI 프록시                               │
│  - root/alias + static file serving                         │
│  - return: 직접 응답                                          │
│  - 하나의 location에서 하나의 content handler만 동작한다          │
├─────────────────────────────────────────────────────────────┤
│ Phase 11: LOG                                               │
│  - 요청 처리가 완료된 후 로그를 기록한다                          │
│  - access_log directive가 여기서 실행된다                       │
└─────────────────────────────────────────────────────────────┘
    │
    ▼
응답 전송
```

#### satisfy Directive 상세

`satisfy` directive는 ACCESS phase에서 여러 접근 제어 모듈의 결과를 어떻게 결합할지 결정한다.

```nginx
location /admin/ {
    satisfy any;    # allow/deny 또는 auth_basic 중 하나만 통과하면 접근 허용

    # IP 기반 접근 제어
    allow 192.168.1.0/24;
    deny all;

    # HTTP Basic 인증
    auth_basic "Admin Area";
    auth_basic_user_file /etc/nginx/.htpasswd;

    proxy_pass http://admin_backend;
}
# satisfy any: 내부 IP이면 인증 없이 접근 가능, 외부 IP는 인증 필요
# satisfy all (기본값): IP 접근 제어와 인증 모두 통과해야 접근 가능
```

#### rewrite vs return

`return`은 즉시 응답을 반환하므로 `rewrite`보다 효율적이다. 단순 리다이렉트에는 `return`을 사용하는 것이 좋다.

```nginx
# return 사용 (권장)
server {
    listen 80;
    server_name example.com;
    return 301 https://$host$request_uri;   # 즉시 301 응답
}

# rewrite 사용 (regex가 필요한 경우)
server {
    listen 80;
    server_name example.com;
    rewrite ^/blog/(\d{4})/(\d{2})/(.*)$ /posts/$1-$2-$3 permanent;
    # 복잡한 URL 패턴 변환에 적합하다
}

# rewrite flag 종류
# last    → rewrite 후 새 URI로 location 매칭을 다시 수행한다
# break   → rewrite 후 현재 location 내에서 계속 처리한다
# redirect  → 302 임시 리다이렉트를 반환한다
# permanent → 301 영구 리다이렉트를 반환한다
```

---
