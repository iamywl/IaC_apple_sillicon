# CKAD 실전 실습 예제 모음

> 시험에서 자주 출제되는 유형별 YAML 매니페스트와 kubectl 명령어를 정리한 문서이다.
> `--dry-run=client -o yaml`로 빠르게 기본 구조를 생성한 뒤 수정하는 것이 효율적이다.

---

## 1. Dockerfile 멀티스테이지 빌드

### 등장 배경

초기 Docker 사용 시에는 단일 Dockerfile에서 빌드 도구와 런타임을 모두 포함했다. 이로 인해 이미지 크기가 수백 MB에서 수 GB까지 증가했고, 빌드 도구(gcc, make 등)가 프로덕션 이미지에 남아 공격 표면이 넓어지는 보안 문제가 발생했다. 멀티스테이지 빌드는 Docker 17.05에서 도입되어 하나의 Dockerfile 내에서 여러 FROM을 사용해 빌드 단계와 런타임 단계를 분리할 수 있게 했다. 빌드 산출물만 최종 이미지로 복사하므로 이미지 크기가 수십 MB 수준으로 줄어든다.

### Go 애플리케이션 예제

```dockerfile
# Stage 1: 빌드 환경
FROM golang:1.21-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /app/server .

# Stage 2: 런타임 환경
FROM alpine:3.18
RUN apk --no-cache add ca-certificates
COPY --from=builder /app/server /usr/local/bin/server
RUN adduser -D -u 1000 appuser
USER appuser
EXPOSE 8080
ENTRYPOINT ["server"]
```

**필드별 설명:**

| 지시어 | 역할 | 생략 시 기본 동작 |
|---|---|---|
| `AS builder` | 빌드 스테이지에 이름 부여. `COPY --from=builder`로 참조 가능 | 인덱스(0, 1, ...)로만 참조 가능 |
| `CGO_ENABLED=0` | C 라이브러리 의존성 제거. 정적 바이너리 생성 | cgo 활성화 상태로 빌드되어 alpine에서 실행 실패 가능 |
| `GOOS=linux` | 타겟 OS 지정 | 빌드 호스트의 OS를 따름 (macOS에서 빌드하면 linux에서 실행 불가) |
| `USER appuser` | 비루트 사용자로 프로세스 실행 | root(UID 0)로 실행되어 보안 취약 |
| `ENTRYPOINT` vs `CMD` | ENTRYPOINT는 항상 실행되는 명령, CMD는 기본 인자 | CMD만 있으면 `docker run <image> <cmd>`로 완전 대체 가능 |

**실무에서 흔한 실수:**

- `COPY . .`를 `go mod download` 이전에 배치하면, 소스 코드 변경 시마다 의존성을 재다운로드한다. Docker 레이어 캐시를 활용하려면 의존성 파일(go.mod, go.sum)을 먼저 복사해야 한다.
- `ca-certificates`를 설치하지 않으면 HTTPS 요청 시 `x509: certificate signed by unknown authority` 오류가 발생한다.
- scratch 이미지를 사용할 경우 셸이 없어 디버깅이 불가능하다. 프로덕션에서는 alpine을 권장한다.

**검증 명령:**

```bash
docker build -t go-app:v1 .
docker images go-app:v1
```

```text
REPOSITORY   TAG       IMAGE ID       CREATED          SIZE
go-app       v1        a1b2c3d4e5f6   10 seconds ago   12.3MB
```

```bash
docker run -d --name test-app -p 8080:8080 go-app:v1
docker ps --filter name=test-app
curl http://localhost:8080/healthz
```

### Node.js 애플리케이션 예제

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app .
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser
EXPOSE 3000
CMD ["node", "index.js"]
```

**`npm ci` vs `npm install`:** `npm ci`는 `package-lock.json`을 기준으로 정확한 버전을 설치한다. `npm install`은 `package.json`의 semver 범위에 따라 다른 버전이 설치될 수 있어 재현성이 보장되지 않는다. CI/CD 환경에서는 반드시 `npm ci`를 사용한다.

### .dockerignore 예제

```
.git
.gitignore
node_modules
*.md
.env
.env.*
Dockerfile
docker-compose.yml
.dockerignore
```

`.dockerignore`가 없으면 `COPY . .` 시 `.git` 디렉토리(수백 MB), `node_modules`(수백 MB)가 빌드 컨텍스트에 포함되어 빌드 시간이 수십 초에서 수 분으로 증가한다. `.env` 파일이 이미지에 포함되면 민감 정보가 레이어에 영구 저장된다.

---

## 2. Multi-container Pod

### 등장 배경

쿠버네티스 이전에는 하나의 프로세스에서 로깅, 프록시, 설정 로딩 등을 모두 처리하는 모놀리식 구조가 일반적이었다. 이 방식은 단일 책임 원칙을 위반하고, 각 기능의 독립적인 업데이트와 스케일링이 불가능했다. Multi-container Pod 패턴은 관련 프로세스를 동일 네트워크 네임스페이스와 스토리지를 공유하는 Pod 내에 배치하되, 각 컨테이너가 단일 책임을 가지도록 분리한다.

Pod 내 컨테이너는 다음을 공유한다:
- **네트워크 네임스페이스**: localhost로 상호 통신 가능. 동일 IP 주소를 가짐.
- **IPC 네임스페이스**: 프로세스 간 통신(shared memory, semaphore) 가능.
- **Volume**: `emptyDir` 등을 통해 파일 시스템 공유.

컨테이너 간 CPU/메모리는 공유하지 않으며, 각각 독립된 파일 시스템을 가진다.

### Init Container 예제

Init Container는 메인 컨테이너가 실행되기 전에 순서대로 실행되는 컨테이너이다. 모든 Init Container가 성공적으로 완료(exit code 0)되어야 메인 컨테이너가 시작된다. Init Container가 실패하면 kubelet은 Pod의 `restartPolicy`에 따라 재시도한다.

Init Container가 필요한 이유: 메인 애플리케이션 이미지에 curl, nslookup 같은 유틸리티를 포함시키면 이미지 크기가 증가하고 공격 표면이 넓어진다. Init Container를 사용하면 유틸리티가 포함된 이미지를 초기화 시에만 사용하고, 메인 이미지는 최소한으로 유지할 수 있다.

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: app-with-init
spec:
  initContainers:
    - name: wait-for-db
      image: busybox:1.36
      command:
        - sh
        - -c
        - |
          until nslookup postgres-svc.default.svc.cluster.local; do
            echo "Waiting for postgres..."
            sleep 2
          done
    - name: init-config
      image: busybox:1.36
      command:
        - sh
        - -c
        - |
          echo '{"db_host": "postgres-svc", "db_port": 5432}' > /config/app.json
      volumeMounts:
        - name: config-vol
          mountPath: /config
  containers:
    - name: app
      image: nginx:1.25
      ports:
        - containerPort: 80
      volumeMounts:
        - name: config-vol
          mountPath: /etc/app
          readOnly: true
  volumes:
    - name: config-vol
      emptyDir: {}
```

**필드별 설명:**

| 필드 | 역할 | 생략 시 기본 동작 |
|---|---|---|
| `initContainers` | 메인 컨테이너 이전에 순차 실행 | Init 단계 없이 바로 메인 컨테이너 시작 |
| `emptyDir: {}` | Pod 수명과 동일한 임시 볼륨 생성 | 볼륨 없이는 컨테이너 간 파일 공유 불가 |
| `readOnly: true` | 볼륨을 읽기 전용으로 마운트 | 읽기/쓰기 모두 가능 (기본값: false) |

**내부 동작 원리:**
1. kubelet이 `initContainers` 배열의 첫 번째 컨테이너(`wait-for-db`)를 시작한다.
2. `wait-for-db`가 exit code 0으로 종료되면, 두 번째 Init Container(`init-config`)를 시작한다.
3. 모든 Init Container가 성공하면, `containers` 배열의 컨테이너를 동시에 시작한다.
4. Init Container 중 하나라도 실패하면 kubelet은 Pod의 `restartPolicy`에 따라 처리한다. `restartPolicy: Always`(기본값)이면 실패한 Init Container를 재실행한다.

**실무 실수 및 트러블슈팅:**

- Init Container에서 DNS 조회 실패: CoreDNS Pod가 아직 Ready 상태가 아닌 경우 발생. `kubectl get pods -n kube-system -l k8s-app=kube-dns`로 CoreDNS 상태를 확인한다.
- Init Container가 무한 루프에 빠진 경우: `kubectl describe pod app-with-init`에서 Init Container의 상태가 `Running`으로 계속 표시된다. `kubectl logs app-with-init -c wait-for-db`로 로그를 확인한다.

**검증 명령:**

```bash
kubectl apply -f app-with-init.yaml
kubectl get pod app-with-init -w
```

```text
NAME            READY   STATUS     RESTARTS   AGE
app-with-init   0/1     Init:0/2   0          2s
app-with-init   0/1     Init:1/2   0          5s
app-with-init   0/1     PodInitializing   0   8s
app-with-init   1/1     Running    0          10s
```

```bash
# Init Container 로그 확인
kubectl logs app-with-init -c wait-for-db

# 설정 파일이 정상적으로 마운트되었는지 확인
kubectl exec app-with-init -- cat /etc/app/app.json
```

```text
{"db_host": "postgres-svc", "db_port": 5432}
```

### Sidecar Logging 예제

메인 앱이 파일에 로그를 쓰고, sidecar가 해당 로그를 stdout으로 출력하는 패턴이다. 쿠버네티스의 로그 수집 시스템(fluentd, fluent-bit 등)은 컨테이너의 stdout/stderr만 수집한다. 따라서 파일에 로그를 쓰는 레거시 애플리케이션의 로그를 수집하려면 sidecar 컨테이너가 파일 로그를 stdout으로 전달해야 한다.

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: app-with-sidecar
spec:
  containers:
    - name: app
      image: busybox:1.36
      command:
        - sh
        - -c
        - |
          while true; do
            echo "$(date) - Application log entry" >> /var/log/app.log
            sleep 5
          done
      volumeMounts:
        - name: log-vol
          mountPath: /var/log
    - name: log-agent
      image: busybox:1.36
      command:
        - sh
        - -c
        - tail -f /var/log/app.log
      volumeMounts:
        - name: log-vol
          mountPath: /var/log
          readOnly: true
  volumes:
    - name: log-vol
      emptyDir: {}
```

**`emptyDir`의 동작 원리:** Pod가 노드에 스케줄링되면 kubelet이 해당 노드의 디스크에 빈 디렉토리를 생성한다. Pod 내 모든 컨테이너가 이 디렉토리를 마운트할 수 있다. Pod가 삭제되면 `emptyDir`의 데이터도 영구 삭제된다. `emptyDir.medium: Memory`를 설정하면 tmpfs(RAM)를 사용하여 I/O 성능이 향상되지만, 메모리 제한에 포함되므로 OOMKill 가능성이 있다.

**검증 명령:**

```bash
kubectl apply -f app-with-sidecar.yaml
kubectl get pod app-with-sidecar
```

```text
NAME                READY   STATUS    RESTARTS   AGE
app-with-sidecar   2/2     Running   0          15s
```

```bash
# sidecar 컨테이너의 stdout에서 로그 확인
kubectl logs app-with-sidecar -c log-agent -f
```

```text
Mon Jan  1 00:00:00 UTC 2024 - Application log entry
Mon Jan  1 00:00:05 UTC 2024 - Application log entry
Mon Jan  1 00:00:10 UTC 2024 - Application log entry
```

```bash
# READY 칼럼이 2/2인지 확인 (두 컨테이너 모두 Running)
kubectl get pod app-with-sidecar -o jsonpath='{.status.containerStatuses[*].name}'
```

```text
app log-agent
```

### Adapter 패턴 예제

로그 형식을 변환하는 adapter 컨테이너이다. 레거시 애플리케이션이 비구조화된 텍스트 로그를 출력할 때, 중앙 로그 시스템(Elasticsearch, Loki 등)이 요구하는 JSON 형식으로 변환하는 역할을 한다. 애플리케이션 코드를 수정하지 않고 로그 형식을 표준화할 수 있다는 것이 핵심이다.

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: app-with-adapter
spec:
  containers:
    - name: app
      image: busybox:1.36
      command:
        - sh
        - -c
        - |
          while true; do
            echo "$(date +%s) ERROR something failed" >> /var/log/app.log
            sleep 10
          done
      volumeMounts:
        - name: log-vol
          mountPath: /var/log
    - name: log-adapter
      image: busybox:1.36
      command:
        - sh
        - -c
        - |
          tail -f /var/log/app.log | while read line; do
            timestamp=$(echo "$line" | awk '{print $1}')
            level=$(echo "$line" | awk '{print $2}')
            message=$(echo "$line" | cut -d' ' -f3-)
            echo "{\"timestamp\": $timestamp, \"level\": \"$level\", \"message\": \"$message\"}"
          done
      volumeMounts:
        - name: log-vol
          mountPath: /var/log
          readOnly: true
  volumes:
    - name: log-vol
      emptyDir: {}
```

**검증 명령:**

```bash
kubectl apply -f app-with-adapter.yaml
kubectl logs app-with-adapter -c log-adapter -f
```

```text
{"timestamp": 1704067200, "level": "ERROR", "message": "something failed"}
{"timestamp": 1704067210, "level": "ERROR", "message": "something failed"}
```

---

## 3. Probe (Health Check)

### 등장 배경

컨테이너 프로세스가 실행 중이라고 해서 애플리케이션이 정상 동작하는 것은 아니다. 데드락, 메모리 누수, 외부 의존성 장애 등으로 프로세스는 살아있으나 요청을 처리할 수 없는 상태가 발생한다. Probe가 없으면 kubelet은 프로세스의 존재 여부만 확인하므로, 이런 장애를 감지하지 못하고 트래픽이 비정상 Pod로 계속 라우팅된다.

쿠버네티스는 세 가지 Probe를 제공한다:

| Probe | 목적 | 실패 시 동작 |
|---|---|---|
| `startupProbe` | 애플리케이션 초기화 완료 감지 | 컨테이너 재시작. 성공 전까지 liveness/readiness 비활성화 |
| `livenessProbe` | 컨테이너 정상 동작 여부 | 컨테이너 재시작 (restartPolicy에 따라) |
| `readinessProbe` | 트래픽 수신 가능 여부 | Service 엔드포인트에서 제거 (재시작하지 않음) |

**Probe 실행 주체:** kubelet이 각 노드에서 직접 Probe를 실행한다. API 서버나 controller-manager가 아닌 kubelet이 담당한다는 점이 중요하다. kubelet은 `periodSeconds` 간격으로 Probe를 수행하고, `failureThreshold`만큼 연속 실패하면 해당 동작을 트리거한다.

### Liveness Probe -- httpGet

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: liveness-http
spec:
  containers:
    - name: web
      image: nginx:1.25
      ports:
        - containerPort: 80
      livenessProbe:
        httpGet:
          path: /healthz
          port: 80
          httpHeaders:
            - name: X-Custom-Header
              value: "health-check"
        initialDelaySeconds: 10
        periodSeconds: 5
        timeoutSeconds: 3
        failureThreshold: 3
        successThreshold: 1
```

**필드별 설명:**

| 필드 | 역할 | 기본값 |
|---|---|---|
| `initialDelaySeconds` | 컨테이너 시작 후 첫 Probe까지 대기 시간 | 0 |
| `periodSeconds` | Probe 실행 간격 | 10 |
| `timeoutSeconds` | Probe 응답 대기 시간. 초과하면 실패 처리 | 1 |
| `failureThreshold` | 연속 실패 허용 횟수. 초과하면 동작 트리거 | 3 |
| `successThreshold` | 실패 후 성공으로 전환되기 위한 연속 성공 횟수 | 1 (liveness는 반드시 1) |

**httpGet Probe의 성공 판정:** HTTP 상태 코드 200~399를 성공으로 판정한다. 400 이상은 실패이다.

**실무 실수:**

- `initialDelaySeconds`를 너무 짧게 설정하면 애플리케이션이 아직 시작되지 않은 상태에서 Probe가 실패하여 무한 재시작 루프에 빠진다. 이 문제를 해결하기 위해 `startupProbe`가 도입되었다.
- `/healthz` 엔드포인트가 실제로 존재하지 않으면 nginx는 404를 반환하여 liveness 실패가 되고, Pod가 반복 재시작된다.
- `timeoutSeconds`를 기본값(1초)으로 두면 부하가 높은 상황에서 정상 Pod가 재시작될 수 있다.

**검증 명령:**

```bash
kubectl apply -f liveness-http.yaml
kubectl describe pod liveness-http | grep -A 10 "Liveness"
```

```text
    Liveness:       http-get http://:80/healthz delay=10s timeout=3s period=5s #success=1 #failure=3
```

```bash
# Probe 실패 시 이벤트 확인
kubectl get events --field-selector involvedObject.name=liveness-http
```

```text
LAST SEEN   TYPE      REASON      OBJECT                MESSAGE
30s         Warning   Unhealthy   pod/liveness-http     Liveness probe failed: HTTP probe failed with statuscode: 404
15s         Normal    Killing     pod/liveness-http     Container web failed liveness probe, will be restarted
```

### Readiness Probe -- tcpSocket

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: readiness-tcp
spec:
  containers:
    - name: redis
      image: redis:7
      ports:
        - containerPort: 6379
      readinessProbe:
        tcpSocket:
          port: 6379
        initialDelaySeconds: 5
        periodSeconds: 10
        failureThreshold: 3
```

**tcpSocket Probe의 동작:** kubelet이 지정된 포트로 TCP 연결을 시도한다. 3-way handshake가 성공하면 Probe 성공이다. 데이터를 주고받지는 않는다. HTTP 엔드포인트를 제공하지 않는 데이터베이스, 메시지 큐 등에 적합하다.

**Readiness 실패 시 동작:** Pod가 재시작되지 않는다. 대신 해당 Pod의 IP가 Service의 Endpoints 오브젝트에서 제거되어 트래픽이 라우팅되지 않는다. Readiness가 다시 성공하면 Endpoints에 재추가된다.

**검증 명령:**

```bash
kubectl apply -f readiness-tcp.yaml
kubectl get pod readiness-tcp -o wide
```

```text
NAME             READY   STATUS    RESTARTS   AGE   IP           NODE
readiness-tcp    1/1     Running   0          20s   10.244.0.5   node1
```

```bash
# Endpoints에 Pod IP가 포함되어 있는지 확인 (Service가 있는 경우)
kubectl get endpoints <service-name>

# Readiness 상태 직접 확인
kubectl get pod readiness-tcp -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}'
```

```text
True
```

### Startup Probe -- exec

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: startup-exec
spec:
  containers:
    - name: app
      image: busybox:1.36
      command:
        - sh
        - -c
        - |
          sleep 30 && touch /tmp/ready && sleep 3600
      startupProbe:
        exec:
          command:
            - cat
            - /tmp/ready
        initialDelaySeconds: 0
        periodSeconds: 5
        failureThreshold: 12
      livenessProbe:
        exec:
          command:
            - cat
            - /tmp/ready
        periodSeconds: 10
        failureThreshold: 3
```

**startupProbe의 등장 배경:** Java 기반 애플리케이션처럼 초기화에 수 분이 걸리는 컨테이너에서, `livenessProbe`의 `initialDelaySeconds`를 충분히 크게 설정해야 했다. 그러나 이는 실제 장애 감지도 그만큼 지연시키는 문제가 있었다. `startupProbe`는 초기화 완료 여부만 판단하고, 성공 후에는 비활성화되어 `livenessProbe`가 즉시 동작하도록 한다.

**exec Probe의 동작:** 컨테이너 내부에서 지정된 명령을 실행하고 exit code를 확인한다. exit code 0이면 성공, 그 외는 실패이다. `cat /tmp/ready`는 파일이 존재하면 0, 존재하지 않으면 1을 반환한다.

**이 예제의 시간 계산:** `failureThreshold(12) * periodSeconds(5) = 60초` 동안 startupProbe가 실패를 허용한다. 애플리케이션이 30초 후에 `/tmp/ready` 파일을 생성하므로, 7번째 체크(35초 시점)에서 성공한다. 이후 livenessProbe가 활성화된다.

**검증 명령:**

```bash
kubectl apply -f startup-exec.yaml
kubectl get pod startup-exec -w
```

```text
NAME           READY   STATUS    RESTARTS   AGE
startup-exec   0/1     Running   0          5s
startup-exec   0/1     Running   0          10s
...
startup-exec   1/1     Running   0          35s
```

```bash
kubectl describe pod startup-exec | grep -A 5 "Startup"
```

```text
    Startup:        exec [cat /tmp/ready] delay=0s timeout=1s period=5s #success=1 #failure=12
```

### 세 가지 Probe를 모두 사용하는 예제

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: full-probes
spec:
  containers:
    - name: app
      image: nginx:1.25
      ports:
        - containerPort: 80
      startupProbe:
        httpGet:
          path: /
          port: 80
        failureThreshold: 30
        periodSeconds: 10
      livenessProbe:
        httpGet:
          path: /
          port: 80
        periodSeconds: 10
        failureThreshold: 3
      readinessProbe:
        httpGet:
          path: /
          port: 80
        periodSeconds: 5
        failureThreshold: 3
```

**Probe 실행 순서:**
1. Pod 시작 시 startupProbe만 활성화된다.
2. startupProbe 성공 시(최대 `30 * 10 = 300초` 허용) liveness와 readiness가 활성화된다.
3. livenessProbe는 10초 간격으로 헬스 체크를 수행한다. 3번 연속 실패하면 컨테이너를 재시작한다.
4. readinessProbe는 5초 간격으로 트래픽 수신 가능 여부를 확인한다. 실패하면 Service Endpoints에서 제거한다.

**검증 명령:**

```bash
kubectl apply -f full-probes.yaml
kubectl describe pod full-probes | grep -E "(Startup|Liveness|Readiness)"
```

```text
    Startup:        http-get http://:80/ delay=0s timeout=1s period=10s #success=1 #failure=30
    Liveness:       http-get http://:80/ delay=0s timeout=1s period=10s #success=1 #failure=3
    Readiness:      http-get http://:80/ delay=0s timeout=1s period=5s #success=1 #failure=3
```

```bash
# Pod 조건 확인
kubectl get pod full-probes -o jsonpath='{range .status.conditions[*]}{.type}={.status}{"\n"}{end}'
```

```text
Initialized=True
Ready=True
ContainersReady=True
PodScheduled=True
```

---

## 4. ConfigMap

### 등장 배경

컨테이너 이미지에 설정값을 하드코딩하면, 환경(dev/staging/prod)마다 별도 이미지를 빌드해야 하고, 설정 변경 시 이미지를 재빌드해야 한다. 환경 변수를 Pod spec에 직접 기입하는 방식은 동일 설정을 여러 Pod에서 중복 관리해야 하는 문제가 있다. ConfigMap은 설정을 별도 오브젝트로 분리하여, 이미지와 설정을 독립적으로 관리할 수 있게 한다.

### 생성 -- kubectl 명령어

```bash
# from-literal
kubectl create configmap app-config \
  --from-literal=DB_HOST=postgres \
  --from-literal=DB_PORT=5432 \
  --from-literal=LOG_LEVEL=info

# from-file (파일 내용 전체가 하나의 key-value가 됨)
kubectl create configmap nginx-conf --from-file=nginx.conf

# from-env-file (.env 형식 파일)
kubectl create configmap env-config --from-env-file=app.env
```

**`--from-file` vs `--from-env-file`의 차이:**
- `--from-file=nginx.conf`: key는 파일명(`nginx.conf`), value는 파일 전체 내용. 바이너리 데이터도 가능.
- `--from-env-file=app.env`: 파일 내 각 `KEY=VALUE` 라인이 개별 key-value 쌍으로 저장. `#` 주석과 빈 줄은 무시.

**검증 명령:**

```bash
kubectl create configmap app-config \
  --from-literal=DB_HOST=postgres \
  --from-literal=DB_PORT=5432 \
  --from-literal=LOG_LEVEL=info

kubectl get configmap app-config -o yaml
```

```text
apiVersion: v1
data:
  DB_HOST: postgres
  DB_PORT: "5432"
  LOG_LEVEL: info
kind: ConfigMap
metadata:
  name: app-config
  namespace: default
```

### 생성 -- YAML

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
data:
  DB_HOST: postgres
  DB_PORT: "5432"
  LOG_LEVEL: info
  app.properties: |
    server.port=8080
    server.context-path=/api
    logging.level.root=INFO
```

**주의:** `DB_PORT`의 값 `"5432"`는 반드시 문자열로 지정해야 한다. ConfigMap의 `data` 필드는 모든 value를 문자열로 저장한다. 따옴표 없이 `5432`로 작성하면 YAML 파서가 정수로 해석하여 오류가 발생한다.

**`data` vs `binaryData`:** `data`는 UTF-8 문자열만 저장할 수 있다. 바이너리 파일(인증서, 키스토어 등)은 `binaryData` 필드에 base64 인코딩하여 저장한다.

### 사용 -- 환경 변수 (env)

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: pod-env
spec:
  containers:
    - name: app
      image: nginx:1.25
      env:
        - name: DATABASE_HOST
          valueFrom:
            configMapKeyRef:
              name: app-config
              key: DB_HOST
        - name: DATABASE_PORT
          valueFrom:
            configMapKeyRef:
              name: app-config
              key: DB_PORT
```

**`configMapKeyRef`에서 존재하지 않는 key를 참조하면:** Pod가 `CreateContainerConfigError` 상태로 실패한다. `optional: true`를 설정하면 key가 없어도 Pod가 시작되고, 해당 환경 변수는 설정되지 않는다.

**검증 명령:**

```bash
kubectl apply -f pod-env.yaml
kubectl exec pod-env -- env | grep DATABASE
```

```text
DATABASE_HOST=postgres
DATABASE_PORT=5432
```

**환경 변수 방식의 한계:** ConfigMap을 업데이트해도 이미 실행 중인 Pod의 환경 변수는 변경되지 않는다. Pod를 재시작해야 새 값이 반영된다.

### 사용 -- 환경 변수 일괄 주입 (envFrom)

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: pod-envfrom
spec:
  containers:
    - name: app
      image: nginx:1.25
      envFrom:
        - configMapRef:
            name: app-config
          prefix: APP_
```

**`prefix` 필드:** ConfigMap의 모든 key 앞에 지정된 접두사를 추가한다. 예를 들어 `DB_HOST`는 `APP_DB_HOST`가 된다. 서로 다른 ConfigMap의 key가 충돌하는 것을 방지하는 데 유용하다. prefix를 생략하면 ConfigMap의 key가 그대로 환경 변수명이 된다.

**검증 명령:**

```bash
kubectl apply -f pod-envfrom.yaml
kubectl exec pod-envfrom -- env | grep APP_
```

```text
APP_DB_HOST=postgres
APP_DB_PORT=5432
APP_LOG_LEVEL=info
APP_app.properties=server.port=8080
server.context-path=/api
logging.level.root=INFO
```

**주의:** `app.properties`처럼 환경 변수명으로 유효하지 않은 key(`.` 포함)는 건너뛰거나 예기치 않은 동작을 유발할 수 있다. 환경 변수명은 `[a-zA-Z_][a-zA-Z0-9_]*` 규칙을 따라야 한다.

### 사용 -- Volume Mount

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: pod-vol
spec:
  containers:
    - name: app
      image: nginx:1.25
      volumeMounts:
        - name: config-vol
          mountPath: /etc/config
          readOnly: true
  volumes:
    - name: config-vol
      configMap:
        name: app-config
        items:
          - key: app.properties
            path: application.properties
```

**Volume Mount 방식의 장점:** ConfigMap이 업데이트되면, kubelet이 주기적으로(기본 약 60초) 마운트된 파일을 갱신한다. 애플리케이션이 파일 변경을 감지(inotify 등)할 수 있다면 Pod 재시작 없이 설정을 반영할 수 있다.

**`items`를 생략하면:** ConfigMap의 모든 key가 각각 파일로 마운트된다. `items`를 지정하면 선택한 key만 지정한 파일명으로 마운트된다.

**`subPath` 사용 시 주의:** `subPath`를 사용하면 ConfigMap 업데이트가 자동으로 반영되지 않는다. 기존 디렉토리의 다른 파일을 보존하면서 특정 파일만 마운트할 때 `subPath`를 사용하지만, 자동 갱신이 필요하면 사용하지 않아야 한다.

**검증 명령:**

```bash
kubectl apply -f pod-vol.yaml
kubectl exec pod-vol -- ls /etc/config/
```

```text
application.properties
```

```bash
kubectl exec pod-vol -- cat /etc/config/application.properties
```

```text
server.port=8080
server.context-path=/api
logging.level.root=INFO
```

---

## 5. Secret

### 등장 배경

ConfigMap은 데이터를 평문으로 저장하므로 패스워드, API 키, TLS 인증서 같은 민감 정보를 저장하기에 부적합하다. Secret은 민감 데이터를 base64 인코딩하여 저장하고, etcd에서 암호화(EncryptionConfiguration 설정 시)할 수 있으며, RBAC으로 접근을 제한할 수 있다.

**중요:** base64 인코딩은 암호화가 아니다. Secret의 보안은 etcd 암호화, RBAC, Pod의 ServiceAccount 권한 제한 등을 조합하여 확보한다.

### 생성 -- kubectl 명령어

```bash
# generic (Opaque)
kubectl create secret generic db-secret \
  --from-literal=username=admin \
  --from-literal=password='S3cur3P@ss!'

# docker-registry
kubectl create secret docker-registry regcred \
  --docker-server=registry.example.com \
  --docker-username=user \
  --docker-password=pass \
  --docker-email=user@example.com

# tls
kubectl create secret tls tls-secret \
  --cert=tls.crt \
  --key=tls.key
```

**Secret 타입별 용도:**

| 타입 | 용도 | data 필드의 필수 key |
|---|---|---|
| `Opaque` | 범용. 임의의 key-value 저장 | 없음 |
| `kubernetes.io/dockerconfigjson` | 컨테이너 레지스트리 인증 | `.dockerconfigjson` |
| `kubernetes.io/tls` | TLS 인증서/키 저장 | `tls.crt`, `tls.key` |
| `kubernetes.io/service-account-token` | ServiceAccount 토큰 (자동 생성) | `token`, `ca.crt`, `namespace` |

**검증 명령:**

```bash
kubectl create secret generic db-secret \
  --from-literal=username=admin \
  --from-literal=password='S3cur3P@ss!'

kubectl get secret db-secret -o yaml
```

```text
apiVersion: v1
data:
  password: UzNjdXIzUEBzcyE=
  username: YWRtaW4=
kind: Secret
metadata:
  name: db-secret
  namespace: default
type: Opaque
```

```bash
# 디코딩하여 원본 값 확인
kubectl get secret db-secret -o jsonpath='{.data.password}' | base64 -d
```

```text
S3cur3P@ss!
```

### 생성 -- YAML

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: db-secret
type: Opaque
data:
  username: YWRtaW4=          # echo -n 'admin' | base64
  password: UzNjdXIzUEBzcyE=  # echo -n 'S3cur3P@ss!' | base64
---
# stringData를 사용하면 base64 인코딩 없이 평문으로 작성 가능하다
apiVersion: v1
kind: Secret
metadata:
  name: db-secret-plain
type: Opaque
stringData:
  username: admin
  password: "S3cur3P@ss!"
```

**`data` vs `stringData`:** `data`는 base64 인코딩된 값을 요구하고, `stringData`는 평문을 받아 쿠버네티스가 자동으로 base64 인코딩한다. 동일 key가 `data`와 `stringData`에 모두 존재하면 `stringData`의 값이 우선한다. `stringData`는 YAML 작성 시 편의를 위한 것이며, 저장된 Secret을 `kubectl get -o yaml`로 조회하면 항상 `data` 필드에 base64 인코딩된 값으로 표시된다.

**실무 실수:**
- `echo 'admin' | base64`는 줄바꿈 문자(`\n`)가 포함되어 `YWRtaW4K`가 된다. 반드시 `echo -n 'admin' | base64`로 줄바꿈을 제거해야 한다. 줄바꿈이 포함된 패스워드로 DB 인증을 시도하면 인증 실패가 발생한다.

### 사용 -- Pod에서 참조

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: pod-with-secret
spec:
  containers:
    - name: app
      image: nginx:1.25
      env:
        - name: DB_USERNAME
          valueFrom:
            secretKeyRef:
              name: db-secret
              key: username
        - name: DB_PASSWORD
          valueFrom:
            secretKeyRef:
              name: db-secret
              key: password
      volumeMounts:
        - name: secret-vol
          mountPath: /etc/secrets
          readOnly: true
  volumes:
    - name: secret-vol
      secret:
        secretName: db-secret
        defaultMode: 0400
```

**`defaultMode: 0400`:** 마운트된 Secret 파일의 퍼미션을 설정한다. `0400`은 소유자만 읽기 가능(r--------)이다. 생략하면 기본값 `0644`가 적용되어 같은 Pod 내 다른 사용자도 읽을 수 있다. 보안을 위해 항상 최소 권한을 설정해야 한다.

**검증 명령:**

```bash
kubectl apply -f pod-with-secret.yaml
kubectl exec pod-with-secret -- env | grep DB_
```

```text
DB_USERNAME=admin
DB_PASSWORD=S3cur3P@ss!
```

```bash
kubectl exec pod-with-secret -- ls -la /etc/secrets/
```

```text
total 0
drwxrwxrwt    3 root     root          120 Jan  1 00:00 .
drwxr-xr-x    1 root     root           20 Jan  1 00:00 ..
lrwxrwxrwx    1 root     root           15 Jan  1 00:00 password -> ..data/password
lrwxrwxrwx    1 root     root           15 Jan  1 00:00 username -> ..data/username
```

```bash
kubectl exec pod-with-secret -- cat /etc/secrets/username
```

```text
admin
```

---

## 6. SecurityContext

### 등장 배경

컨테이너는 기본적으로 root(UID 0)로 실행된다. 컨테이너 런타임의 격리가 완벽하지 않으므로, 컨테이너 탈출(container escape) 공격 시 호스트에서 root 권한을 획득할 수 있다. SecurityContext는 Pod 및 컨테이너 수준에서 Linux 보안 기능(UID/GID, capabilities, seccomp, AppArmor 등)을 제어하여 공격 표면을 최소화한다.

### 컨테이너 수준 SecurityContext

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: secure-pod
spec:
  securityContext:
    runAsUser: 1000
    runAsGroup: 3000
    fsGroup: 2000
  containers:
    - name: app
      image: nginx:1.25
      securityContext:
        runAsNonRoot: true
        readOnlyRootFilesystem: true
        allowPrivilegeEscalation: false
        capabilities:
          drop:
            - ALL
          add:
            - NET_BIND_SERVICE
      volumeMounts:
        - name: tmp
          mountPath: /tmp
        - name: cache
          mountPath: /var/cache/nginx
        - name: run
          mountPath: /var/run
  volumes:
    - name: tmp
      emptyDir: {}
    - name: cache
      emptyDir: {}
    - name: run
      emptyDir: {}
```

**Pod 수준 vs 컨테이너 수준 SecurityContext:**

| 필드 | Pod 수준 (`spec.securityContext`) | 컨테이너 수준 (`spec.containers[].securityContext`) |
|---|---|---|
| `runAsUser` | Pod 내 모든 컨테이너에 적용 | 해당 컨테이너에만 적용 (Pod 수준 재정의) |
| `runAsGroup` | 모든 컨테이너의 기본 그룹 | 해당 컨테이너에만 적용 |
| `fsGroup` | 볼륨 마운트 시 파일 소유 그룹 설정 | Pod 수준에서만 설정 가능 |
| `capabilities` | Pod 수준에서 설정 불가 | 컨테이너 수준에서만 설정 가능 |

**필드별 상세 설명:**

| 필드 | 역할 | 생략 시 기본 동작 |
|---|---|---|
| `runAsNonRoot: true` | UID 0으로 실행되면 컨테이너 시작 차단 | 검증 없이 실행 허용 |
| `readOnlyRootFilesystem: true` | 루트 파일 시스템 쓰기 차단 | 쓰기 가능 |
| `allowPrivilegeEscalation: false` | setuid 비트를 통한 권한 상승 차단 | true (권한 상승 가능) |
| `capabilities.drop: [ALL]` | 모든 Linux capability 제거 | 기본 capability 세트 유지 |
| `capabilities.add: [NET_BIND_SERVICE]` | 1024 미만 포트 바인딩 허용 | drop ALL 시 바인딩 불가 |

**`readOnlyRootFilesystem` 사용 시:** nginx는 `/var/cache/nginx`, `/var/run`, `/tmp`에 쓰기가 필요하다. 루트 파일 시스템을 읽기 전용으로 설정하면 이 경로에 쓰기가 불가능하므로, `emptyDir` 볼륨을 마운트하여 쓰기 가능 영역을 제공해야 한다. 이를 누락하면 nginx가 `[emerg] mkdir() "/var/cache/nginx" failed (30: Read-only file system)` 오류로 시작에 실패한다.

**`fsGroup: 2000`의 동작:** Pod에 마운트된 볼륨의 파일 소유 그룹이 GID 2000으로 설정된다. 컨테이너 내 프로세스는 supplementary group으로 GID 2000을 가지게 되어, 해당 볼륨의 파일을 읽고 쓸 수 있다.

### Capabilities 확인 명령

```bash
# 컨테이너 내부에서 capabilities 확인
kubectl exec secure-pod -- cat /proc/1/status | grep Cap

# Pod의 securityContext 확인
kubectl get pod secure-pod -o jsonpath='{.spec.containers[0].securityContext}'
```

**검증 명령:**

```bash
kubectl apply -f secure-pod.yaml
kubectl get pod secure-pod
```

```text
NAME         READY   STATUS    RESTARTS   AGE
secure-pod   1/1     Running   0          10s
```

```bash
# 프로세스 UID 확인
kubectl exec secure-pod -- id
```

```text
uid=1000 gid=3000 groups=2000,3000
```

```bash
# 루트 파일 시스템 쓰기 불가 확인
kubectl exec secure-pod -- touch /test-file
```

```text
touch: /test-file: Read-only file system
command terminated with exit code 1
```

```bash
# emptyDir 볼륨에는 쓰기 가능
kubectl exec secure-pod -- touch /tmp/test-file
kubectl exec secure-pod -- ls -la /tmp/test-file
```

```text
-rw-r--r--    1 1000     2000             0 Jan  1 00:00 /tmp/test-file
```

---

## 7. Deployment -- 생성, 업데이트, 롤백

### 등장 배경

Pod를 직접 생성하면 노드 장애 시 자동 복구가 되지 않는다. ReplicaSet은 Pod의 복제본 수를 유지하지만, 이미지 업데이트 시 롤링 업데이트를 수동으로 관리해야 했다. Deployment는 ReplicaSet을 관리하여 선언적 업데이트, 자동 롤링 업데이트, 롤백 기능을 제공한다.

**Deployment의 내부 동작 흐름:**
1. 사용자가 Deployment를 생성하면 API 서버가 etcd에 저장한다.
2. kube-controller-manager의 Deployment controller가 이를 감지하고 ReplicaSet을 생성한다.
3. ReplicaSet controller가 지정된 replicas 수만큼 Pod를 생성한다.
4. kube-scheduler가 각 Pod를 적절한 노드에 할당한다.
5. 해당 노드의 kubelet이 컨테이너 런타임을 통해 컨테이너를 시작한다.

이미지를 업데이트하면:
1. Deployment controller가 새로운 ReplicaSet을 생성한다.
2. 새 ReplicaSet의 replicas를 점진적으로 증가시키고, 이전 ReplicaSet의 replicas를 감소시킨다.
3. `maxSurge`와 `maxUnavailable` 설정에 따라 동시에 몇 개의 Pod를 교체할지 결정한다.
4. 이전 ReplicaSet은 replicas=0으로 유지되어 롤백 시 재사용된다.

### 빠른 생성 (dry-run)

```bash
# Deployment YAML 생성
kubectl create deployment nginx-app \
  --image=nginx:1.24 \
  --replicas=3 \
  --port=80 \
  --dry-run=client -o yaml > deployment.yaml
```

### Deployment YAML

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nginx-app
spec:
  replicas: 3
  selector:
    matchLabels:
      app: nginx-app
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 1
  template:
    metadata:
      labels:
        app: nginx-app
    spec:
      containers:
        - name: nginx
          image: nginx:1.24
          ports:
            - containerPort: 80
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              cpu: 200m
              memory: 256Mi
          readinessProbe:
            httpGet:
              path: /
              port: 80
            initialDelaySeconds: 5
            periodSeconds: 10
          livenessProbe:
            httpGet:
              path: /
              port: 80
            initialDelaySeconds: 10
            periodSeconds: 15
```

**필드별 설명:**

| 필드 | 역할 | 생략 시 기본값 |
|---|---|---|
| `replicas` | Pod 복제본 수 | 1 |
| `selector.matchLabels` | 이 Deployment가 관리하는 Pod를 식별하는 레이블 셀렉터 | 필수 필드 (생략 불가) |
| `strategy.type` | 업데이트 전략. `RollingUpdate` 또는 `Recreate` | `RollingUpdate` |
| `maxSurge` | 롤링 업데이트 시 desired 대비 추가 생성 가능한 Pod 수 | 25% |
| `maxUnavailable` | 롤링 업데이트 시 동시에 사용 불가능한 Pod 최대 수 | 25% |
| `resources.requests` | 스케줄링 시 노드에 요청하는 최소 리소스 | 없음 (BestEffort QoS) |
| `resources.limits` | 컨테이너가 사용할 수 있는 최대 리소스 | 없음 (무제한) |

**`selector.matchLabels`과 `template.metadata.labels`의 관계:** selector의 레이블이 template의 레이블과 일치해야 한다. 불일치하면 Deployment 생성이 거부된다. 이 셀렉터는 Deployment 생성 후 변경(immutable)할 수 없다.

**`resources.requests` vs `resources.limits`:**
- `requests`: kube-scheduler가 Pod를 노드에 배치할 때 사용. 노드의 allocatable 리소스가 requests 이상이어야 스케줄링된다.
- `limits`: kubelet이 런타임에 enforcement. CPU limit 초과 시 throttling, memory limit 초과 시 OOMKill이 발생한다.
- `requests`만 설정하고 `limits`를 생략하면 Burstable QoS가 되어, 노드 리소스 부족 시 BestEffort Pod 다음으로 eviction 대상이 된다.

**strategy.type 비교:**

| 전략 | 동작 | 적합한 경우 |
|---|---|---|
| `RollingUpdate` | 새 Pod를 점진적으로 생성하면서 이전 Pod를 제거 | 무중단 배포 필요 시 (대부분의 경우) |
| `Recreate` | 모든 기존 Pod를 먼저 제거한 후 새 Pod를 생성 | 두 버전이 동시 실행 불가능한 경우 (DB 마이그레이션, 볼륨 독점 접근 등) |

**검증 명령:**

```bash
kubectl apply -f deployment.yaml
kubectl rollout status deployment/nginx-app
```

```text
Waiting for deployment "nginx-app" rollout to finish: 0 of 3 updated replicas are available...
Waiting for deployment "nginx-app" rollout to finish: 1 of 3 updated replicas are available...
Waiting for deployment "nginx-app" rollout to finish: 2 of 3 updated replicas are available...
deployment "nginx-app" successfully rolled out
```

```bash
kubectl get deployment nginx-app
```

```text
NAME        READY   UP-TO-DATE   AVAILABLE   AGE
nginx-app   3/3     3            3           30s
```

```bash
# Deployment가 생성한 ReplicaSet 확인
kubectl get rs -l app=nginx-app
```

```text
NAME                   DESIRED   CURRENT   READY   AGE
nginx-app-5d4f6b7c8d   3         3         3       30s
```

```bash
# Pod 목록 확인
kubectl get pods -l app=nginx-app
```

```text
NAME                         READY   STATUS    RESTARTS   AGE
nginx-app-5d4f6b7c8d-abc12   1/1     Running   0          30s
nginx-app-5d4f6b7c8d-def34   1/1     Running   0          30s
nginx-app-5d4f6b7c8d-ghi56   1/1     Running   0          30s
```

### Rolling Update 실행

```bash
# 이미지 업데이트 (Rolling Update 트리거)
kubectl set image deployment/nginx-app nginx=nginx:1.25

# 롤아웃 상태 확인
kubectl rollout status deployment/nginx-app

# 롤아웃 히스토리 확인
kubectl rollout history deployment/nginx-app

# 특정 리비전 상세 확인
kubectl rollout history deployment/nginx-app --revision=2
```

**Rolling Update 중 검증:**

```bash
kubectl set image deployment/nginx-app nginx=nginx:1.25
kubectl get rs -l app=nginx-app -w
```

```text
NAME                   DESIRED   CURRENT   READY   AGE
nginx-app-5d4f6b7c8d   3         3         3       5m
nginx-app-7e8f9a0b1c   1         1         0       2s
nginx-app-7e8f9a0b1c   1         1         1       5s
nginx-app-5d4f6b7c8d   2         3         3       5m
nginx-app-5d4f6b7c8d   2         2         2       5m
nginx-app-7e8f9a0b1c   2         1         1       8s
nginx-app-7e8f9a0b1c   2         2         1       8s
nginx-app-7e8f9a0b1c   2         2         2       12s
nginx-app-5d4f6b7c8d   1         2         2       5m
nginx-app-5d4f6b7c8d   1         1         1       5m
nginx-app-7e8f9a0b1c   3         2         2       15s
nginx-app-7e8f9a0b1c   3         3         2       15s
nginx-app-7e8f9a0b1c   3         3         3       18s
nginx-app-5d4f6b7c8d   0         1         1       5m
nginx-app-5d4f6b7c8d   0         0         0       5m
```

이 출력에서 새 ReplicaSet(`7e8f9a0b1c`)의 replicas가 점진적으로 증가하고, 이전 ReplicaSet(`5d4f6b7c8d`)의 replicas가 감소하는 것을 확인할 수 있다.

### Rollback

```bash
# 직전 버전으로 롤백
kubectl rollout undo deployment/nginx-app

# 특정 리비전으로 롤백
kubectl rollout undo deployment/nginx-app --to-revision=1

# 롤아웃 일시 중지/재개
kubectl rollout pause deployment/nginx-app
kubectl rollout resume deployment/nginx-app
```

**롤백의 내부 동작:** `rollout undo`는 이전 ReplicaSet의 Pod template을 현재 Deployment의 template으로 복원한다. 이전 ReplicaSet(replicas=0 상태로 보존되어 있던)을 scale up하는 것이 아니라, 새로운 revision으로 기록된다. `revisionHistoryLimit`(기본값 10)이 보존하는 이전 ReplicaSet 수를 결정한다.

**`rollout pause` 사용 시나리오:** 여러 변경(이미지, 리소스, 환경 변수)을 한 번에 적용하고 싶을 때 pause → 변경 → resume으로 단일 롤아웃으로 처리할 수 있다. pause 상태에서는 변경을 적용해도 새 Pod가 생성되지 않는다.

**검증 명령:**

```bash
kubectl rollout undo deployment/nginx-app
kubectl rollout status deployment/nginx-app
```

```text
deployment "nginx-app" successfully rolled out
```

```bash
kubectl rollout history deployment/nginx-app
```

```text
REVISION  CHANGE-CAUSE
2         <none>
3         <none>
```

### Deployment 스케일링

```bash
kubectl scale deployment/nginx-app --replicas=5
```

**검증 명령:**

```bash
kubectl scale deployment/nginx-app --replicas=5
kubectl get deployment nginx-app
```

```text
NAME        READY   UP-TO-DATE   AVAILABLE   AGE
nginx-app   5/5     5            5           10m
```

---

## 8. Service

### 등장 배경

Pod는 생성/삭제될 때마다 새로운 IP를 할당받는다. Deployment가 Pod를 재생성하면 IP가 변경되므로, 다른 Pod가 특정 Pod의 IP를 직접 참조하면 통신이 끊어진다. Service는 레이블 셀렉터로 선택된 Pod 집합에 대해 안정적인 IP(ClusterIP)와 DNS 이름을 제공한다. kube-proxy가 iptables 또는 IPVS 규칙을 관리하여 Service IP로 향하는 트래픽을 실제 Pod IP로 분산한다.

### ClusterIP Service

```bash
# 빠른 생성
kubectl expose deployment nginx-app --port=80 --target-port=80 --type=ClusterIP
```

```yaml
apiVersion: v1
kind: Service
metadata:
  name: nginx-svc
spec:
  type: ClusterIP
  selector:
    app: nginx-app
  ports:
    - port: 80
      targetPort: 80
      protocol: TCP
```

**필드별 설명:**

| 필드 | 역할 | 기본값 |
|---|---|---|
| `type` | Service 유형 | `ClusterIP` |
| `selector` | 트래픽을 라우팅할 Pod를 레이블로 선택 | 없으면 수동으로 Endpoints 생성 필요 |
| `port` | Service가 노출하는 포트 | 필수 |
| `targetPort` | Pod 내 컨테이너의 실제 포트 | `port`와 동일 |
| `protocol` | TCP, UDP, SCTP | TCP |

**ClusterIP의 DNS:** `nginx-svc.default.svc.cluster.local` 형식으로 클러스터 내부에서 접근 가능하다. 같은 네임스페이스에서는 `nginx-svc`만으로 접근할 수 있다.

**검증 명령:**

```bash
kubectl apply -f nginx-svc.yaml
kubectl get svc nginx-svc
```

```text
NAME        TYPE        CLUSTER-IP      EXTERNAL-IP   PORT(S)   AGE
nginx-svc   ClusterIP   10.96.123.45    <none>        80/TCP    5s
```

```bash
# Endpoints 확인 (연결된 Pod IP 목록)
kubectl get endpoints nginx-svc
```

```text
NAME        ENDPOINTS                                   AGE
nginx-svc   10.244.0.5:80,10.244.0.6:80,10.244.0.7:80   5s
```

```bash
# 클러스터 내부에서 Service 접근 테스트
kubectl run test --image=busybox -it --rm --restart=Never -- wget -qO- http://nginx-svc
```

```text
<!DOCTYPE html>
<html>
<head>
<title>Welcome to nginx!</title>
...
```

**Endpoints가 비어있는 경우 트러블슈팅:**
1. `kubectl get pods -l app=nginx-app`으로 selector와 일치하는 Pod가 있는지 확인한다.
2. Pod가 있으나 Endpoints에 없으면, Pod의 readinessProbe가 실패하고 있는 것이다.
3. Service의 `selector`와 Pod의 `labels`가 정확히 일치하는지 확인한다.

### NodePort Service

```bash
# 빠른 생성
kubectl expose deployment nginx-app --port=80 --target-port=80 --type=NodePort
```

```yaml
apiVersion: v1
kind: Service
metadata:
  name: nginx-nodeport
spec:
  type: NodePort
  selector:
    app: nginx-app
  ports:
    - port: 80
      targetPort: 80
      nodePort: 30080
      protocol: TCP
```

**NodePort의 동작:** 클러스터의 모든 노드에서 `nodePort`(30080)로 들어오는 트래픽을 Service의 Pod로 라우팅한다. `nodePort`를 생략하면 30000-32767 범위에서 자동 할당된다. 외부에서 `<노드IP>:30080`으로 접근 가능하다.

**ClusterIP와의 관계:** NodePort Service는 ClusterIP를 포함한다. 즉, 클러스터 내부에서는 ClusterIP로도, 외부에서는 NodePort로도 접근할 수 있다.

**검증 명령:**

```bash
kubectl apply -f nginx-nodeport.yaml
kubectl get svc nginx-nodeport
```

```text
NAME              TYPE       CLUSTER-IP      EXTERNAL-IP   PORT(S)        AGE
nginx-nodeport    NodePort   10.96.200.50    <none>        80:30080/TCP   5s
```

```bash
# 노드 IP 확인
kubectl get nodes -o wide

# 외부에서 접근 테스트
curl http://<NODE_IP>:30080
```

### Headless Service

```yaml
apiVersion: v1
kind: Service
metadata:
  name: nginx-headless
spec:
  clusterIP: None
  selector:
    app: nginx-app
  ports:
    - port: 80
      targetPort: 80
```

**Headless Service의 동작:** `clusterIP: None`을 설정하면 Service에 ClusterIP가 할당되지 않는다. DNS 조회 시 Service의 IP가 아닌 Pod의 IP가 직접 반환된다. StatefulSet에서 각 Pod에 고유한 DNS 이름(`<pod-name>.<service-name>`)을 부여하는 데 사용된다.

**검증 명령:**

```bash
kubectl apply -f nginx-headless.yaml
kubectl get svc nginx-headless
```

```text
NAME              TYPE        CLUSTER-IP   EXTERNAL-IP   PORT(S)   AGE
nginx-headless    ClusterIP   None         <none>        80/TCP    5s
```

```bash
# DNS 조회 시 개별 Pod IP가 반환되는지 확인
kubectl run test --image=busybox -it --rm --restart=Never -- nslookup nginx-headless
```

```text
Server:    10.96.0.10
Address 1: 10.96.0.10 kube-dns.kube-system.svc.cluster.local

Name:      nginx-headless
Address 1: 10.244.0.5
Address 2: 10.244.0.6
Address 3: 10.244.0.7
```

---

## 9. Ingress

### 등장 배경

NodePort는 각 Service마다 별도 포트를 노출해야 하므로, 수십 개의 Service가 있으면 포트 관리가 복잡해진다. LoadBalancer 타입은 클라우드 환경에서 Service마다 별도 로드밸런서를 생성하므로 비용이 증가한다. Ingress는 단일 진입점(80/443)에서 호스트명과 경로 기반으로 여러 Service에 라우팅하는 L7 로드밸런싱을 제공한다.

Ingress 자체는 라우팅 규칙을 정의하는 오브젝트이고, 실제 트래픽 처리는 Ingress Controller(nginx, traefik, haproxy 등)가 담당한다. Ingress Controller가 클러스터에 설치되어 있지 않으면 Ingress 오브젝트를 생성해도 동작하지 않는다.

### Path-based Routing

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: app-ingress
  annotations:
    nginx.ingress.kubernetes.io/rewrite-target: /
spec:
  ingressClassName: nginx
  rules:
    - host: app.example.com
      http:
        paths:
          - path: /api
            pathType: Prefix
            backend:
              service:
                name: api-svc
                port:
                  number: 80
          - path: /web
            pathType: Prefix
            backend:
              service:
                name: web-svc
                port:
                  number: 80
```

**필드별 설명:**

| 필드 | 역할 | 생략 시 동작 |
|---|---|---|
| `ingressClassName` | 사용할 Ingress Controller 지정 | 클러스터의 기본 IngressClass 사용 |
| `host` | 호스트명 기반 라우팅 | 모든 호스트명에 매칭 |
| `pathType: Prefix` | 경로 접두사 매칭 (`/api`는 `/api`, `/api/v1` 등에 매칭) | 필수 필드 |
| `pathType: Exact` | 정확한 경로만 매칭 (`/api`는 `/api`에만 매칭) | - |
| `rewrite-target: /` | 백엔드로 전달 시 경로를 재작성 | 원래 경로 그대로 전달 |

**`rewrite-target` 주의사항:** `/api/users` 요청이 들어오면, `rewrite-target: /` 설정에 의해 백엔드에는 `/users`가 아닌 `/`로 전달된다. 경로의 캡처 그룹을 사용하려면 `nginx.ingress.kubernetes.io/rewrite-target: /$1`과 `path: /api(/|$)(.*)`을 조합해야 한다.

**검증 명령:**

```bash
kubectl apply -f app-ingress.yaml
kubectl get ingress app-ingress
```

```text
NAME          CLASS   HOSTS             ADDRESS        PORTS   AGE
app-ingress   nginx   app.example.com   192.168.1.10   80      10s
```

```bash
kubectl describe ingress app-ingress
```

```text
Name:             app-ingress
Namespace:        default
Address:          192.168.1.10
Ingress Class:    nginx
Rules:
  Host              Path  Backends
  ----              ----  --------
  app.example.com
                    /api   api-svc:80 (10.244.0.5:80,10.244.0.6:80)
                    /web   web-svc:80 (10.244.0.7:80,10.244.0.8:80)
```

```bash
# ADDRESS가 비어있으면 Ingress Controller가 없거나 아직 처리 중인 것이다.
# Ingress Controller Pod 상태 확인
kubectl get pods -n ingress-nginx
```

### Host-based Routing with TLS

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: multi-host-ingress
spec:
  ingressClassName: nginx
  tls:
    - hosts:
        - app.example.com
        - api.example.com
      secretName: tls-secret
  rules:
    - host: app.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: web-svc
                port:
                  number: 80
    - host: api.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: api-svc
                port:
                  number: 8080
```

**TLS 설정의 동작:** `tls.secretName`에 지정된 Secret은 `kubernetes.io/tls` 타입이어야 하며, `tls.crt`(인증서)와 `tls.key`(개인 키) 필드를 포함해야 한다. Ingress Controller가 이 Secret을 읽어 HTTPS를 종단한다. 클라이언트와 Ingress Controller 간은 HTTPS, Ingress Controller와 백엔드 Service 간은 HTTP가 기본이다.

**검증 명령:**

```bash
kubectl apply -f multi-host-ingress.yaml
kubectl describe ingress multi-host-ingress
```

```text
Name:             multi-host-ingress
TLS:
  tls-secret terminates app.example.com,api.example.com
Rules:
  Host              Path  Backends
  ----              ----  --------
  app.example.com
                    /     web-svc:80
  api.example.com
                    /     api-svc:8080
```

---

## 10. NetworkPolicy

### 등장 배경

쿠버네티스의 기본 네트워크 모델은 "모든 Pod가 모든 Pod와 통신 가능"이다. 이는 개발 편의성은 높지만, 프로덕션 환경에서는 보안 위험이다. 예를 들어 웹 서버가 해킹당하면 데이터베이스에 직접 접근할 수 있다. NetworkPolicy는 Pod 수준의 방화벽 규칙을 정의하여, 허용된 트래픽만 통과시키는 zero-trust 네트워크를 구현한다.

**전제 조건:** NetworkPolicy는 CNI 플러그인(Calico, Cilium, Weave Net 등)이 지원해야 한다. 기본 CNI(kubenet)나 Flannel은 NetworkPolicy를 지원하지 않는다. NetworkPolicy를 생성해도 CNI가 이를 이행(enforce)하지 않으면 아무 효과가 없으므로 주의해야 한다.

### Default Deny -- 모든 Ingress 차단

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-ingress
  namespace: production
spec:
  podSelector: {}
  policyTypes:
    - Ingress
```

**동작 원리:** `podSelector: {}`는 해당 네임스페이스의 모든 Pod를 선택한다. `policyTypes: [Ingress]`를 지정하고 `ingress` 규칙을 정의하지 않으면, 선택된 모든 Pod로의 인입 트래픽이 차단된다. 이 정책은 "기본 차단, 명시적 허용" 패턴의 기반이 된다.

**검증 명령:**

```bash
kubectl create namespace production
kubectl apply -f default-deny-ingress.yaml

# 테스트용 Pod 배포
kubectl run web --image=nginx -n production --port=80
kubectl expose pod web --port=80 -n production

# 같은 네임스페이스에서 접근 시도 (차단됨)
kubectl run test --image=busybox -n production -it --rm --restart=Never -- wget --timeout=3 -qO- http://web
```

```text
wget: download timed out
command terminated with exit code 1
```

### Default Deny -- 모든 Egress 차단

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-egress
  namespace: production
spec:
  podSelector: {}
  policyTypes:
    - Egress
```

**주의:** Egress를 전부 차단하면 DNS 조회도 불가능해진다. Pod가 Service 이름으로 다른 Pod에 접근하려면 CoreDNS(UDP 53)로의 Egress가 허용되어야 한다.

**검증 명령:**

```bash
kubectl apply -f default-deny-egress.yaml

# DNS 조회 시도 (차단됨)
kubectl run test --image=busybox -n production -it --rm --restart=Never -- nslookup kubernetes
```

```text
;; connection timed out; no servers could be reached
command terminated with exit code 1
```

### 특정 트래픽만 허용

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-web-to-api
  namespace: production
spec:
  podSelector:
    matchLabels:
      app: api
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: web
        - namespaceSelector:
            matchLabels:
              name: monitoring
      ports:
        - protocol: TCP
          port: 8080
```

**이 정책의 의미:** `app: api` 레이블이 있는 Pod에 대해, `app: web` 레이블이 있는 Pod 또는(OR) `name: monitoring` 네임스페이스의 모든 Pod로부터 TCP 8080 포트 접근을 허용한다.

**검증 명령:**

```bash
kubectl apply -f allow-web-to-api.yaml

# web Pod에서 api로의 접근 확인 (허용됨)
kubectl run web --image=busybox -n production -l app=web -it --rm --restart=Never \
  -- wget --timeout=3 -qO- http://api-svc:8080

# 레이블이 없는 Pod에서 접근 시도 (차단됨)
kubectl run rogue --image=busybox -n production -it --rm --restart=Never \
  -- wget --timeout=3 -qO- http://api-svc:8080
```

```text
wget: download timed out
command terminated with exit code 1
```

### Egress 제한 (DNS + 특정 서비스만 허용)

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: api-egress
  namespace: production
spec:
  podSelector:
    matchLabels:
      app: api
  policyTypes:
    - Egress
  egress:
    # DNS 허용
    - to: []
      ports:
        - protocol: UDP
          port: 53
        - protocol: TCP
          port: 53
    # DB 접근 허용
    - to:
        - podSelector:
            matchLabels:
              app: postgres
      ports:
        - protocol: TCP
          port: 5432
```

**`to: []`의 의미:** 빈 배열은 "모든 대상"을 의미한다. 즉, 포트 53(DNS)에 대해서는 대상 제한 없이 모든 곳으로의 Egress를 허용한다. CoreDNS가 어떤 네임스페이스에 있든 접근 가능하다.

**검증 명령:**

```bash
kubectl apply -f api-egress.yaml

# api Pod에서 DNS 확인 (허용됨)
kubectl exec -n production deploy/api -- nslookup postgres-svc

# api Pod에서 postgres 접근 (허용됨)
kubectl exec -n production deploy/api -- nc -zv postgres-svc 5432
```

```text
postgres-svc (10.244.0.10) open
```

```bash
# api Pod에서 외부 인터넷 접근 (차단됨)
kubectl exec -n production deploy/api -- wget --timeout=3 -qO- http://example.com
```

```text
wget: download timed out
command terminated with exit code 1
```

### NetworkPolicy에서 from 배열의 AND/OR 로직

```yaml
# OR 로직: 두 조건 중 하나라도 만족하면 허용
ingress:
  - from:
      - podSelector:
          matchLabels:
            app: web
      - namespaceSelector:
          matchLabels:
            name: monitoring

# AND 로직: 두 조건 모두 만족해야 허용
ingress:
  - from:
      - podSelector:
          matchLabels:
            app: web
        namespaceSelector:
          matchLabels:
            name: production
```

> 주의: `from` 배열의 각 항목(하이픈으로 시작하는 항목)은 OR 관계이다. 하나의 항목 안에 여러 selector를 넣으면(하이픈 없이 같은 들여쓰기) AND 관계가 된다. 이 차이를 정확히 이해해야 한다. CKAD 시험에서 자주 출제되는 함정 문제이다.

**OR 로직 해석:** `app: web` Pod이거나, `name: monitoring` 네임스페이스의 어떤 Pod이면 허용.
**AND 로직 해석:** `name: production` 네임스페이스에 있으면서 동시에 `app: web` 레이블을 가진 Pod만 허용.

---

## 11. Helm

### 등장 배경

쿠버네티스 매니페스트를 직접 관리할 때의 문제점:
- 환경별(dev/staging/prod)로 거의 동일한 YAML 파일을 중복 관리해야 한다.
- 여러 리소스(Deployment, Service, ConfigMap, Secret 등)를 하나의 논리적 단위로 배포/롤백할 수 없다.
- 커뮤니티에서 개발한 애플리케이션(nginx, prometheus 등)을 설치하려면 수십 개의 YAML을 직접 작성해야 한다.

Helm은 쿠버네티스의 패키지 매니저로서, Chart(패키지 형식), Release(설치 인스턴스), Repository(Chart 저장소) 개념을 도입하여 이 문제들을 해결한다. Go template으로 YAML을 동적으로 생성하고, values.yaml로 환경별 설정을 분리한다.

### Chart 설치

```bash
# 저장소 추가
helm repo add bitnami https://charts.bitnami.com/bitnami
helm repo update

# 기본 설치
helm install my-nginx bitnami/nginx

# values 파일 지정
helm install my-nginx bitnami/nginx -f custom-values.yaml

# --set으로 값 지정
helm install my-nginx bitnami/nginx \
  --set replicaCount=3 \
  --set service.type=NodePort \
  --namespace web --create-namespace

# 설치 전 렌더링 결과 확인
helm template my-nginx bitnami/nginx -f custom-values.yaml
```

**`helm install` vs `helm template`:** `helm install`은 클러스터에 실제 배포하고 릴리스를 생성한다. `helm template`은 렌더링된 YAML을 stdout으로 출력할 뿐 클러스터에 반영하지 않는다. CI/CD에서 렌더링 결과를 검증하거나 `kubectl apply`와 조합할 때 사용한다.

**`-f` vs `--set`의 우선순위:** `--set`이 `-f`보다 우선한다. 두 가지를 동시에 사용하면 `-f`의 값을 `--set`이 덮어쓴다. 복잡한 설정은 `-f`, 단일 값 오버라이드는 `--set`을 사용한다.

**검증 명령:**

```bash
helm install my-nginx bitnami/nginx --set replicaCount=2
helm list
```

```text
NAME      NAMESPACE   REVISION   UPDATED                                  STATUS    CHART          APP VERSION
my-nginx  default     1          2024-01-01 00:00:00.000000000 +0000 UTC  deployed  nginx-15.4.0   1.25.3
```

```bash
kubectl get all -l app.kubernetes.io/instance=my-nginx
```

```text
NAME                            READY   STATUS    RESTARTS   AGE
pod/my-nginx-7d4f8b5c6-abc12   1/1     Running   0          30s
pod/my-nginx-7d4f8b5c6-def34   1/1     Running   0          30s

NAME               TYPE           CLUSTER-IP     EXTERNAL-IP   PORT(S)        AGE
service/my-nginx   LoadBalancer   10.96.50.100   <pending>     80:31234/TCP   30s

NAME                       READY   UP-TO-DATE   AVAILABLE   AGE
deployment.apps/my-nginx   2/2     2            2           30s
```

### 업그레이드 및 롤백

```bash
# 업그레이드
helm upgrade my-nginx bitnami/nginx --set replicaCount=5

# 릴리스 히스토리 확인
helm history my-nginx

# 롤백
helm rollback my-nginx 1

# 삭제
helm uninstall my-nginx
```

**검증 명령:**

```bash
helm upgrade my-nginx bitnami/nginx --set replicaCount=5
helm history my-nginx
```

```text
REVISION   UPDATED                    STATUS      CHART          APP VERSION   DESCRIPTION
1          Mon Jan  1 00:00:00 2024   superseded  nginx-15.4.0   1.25.3        Install complete
2          Mon Jan  1 00:05:00 2024   deployed    nginx-15.4.0   1.25.3        Upgrade complete
```

```bash
helm rollback my-nginx 1
helm history my-nginx
```

```text
REVISION   UPDATED                    STATUS      CHART          APP VERSION   DESCRIPTION
1          Mon Jan  1 00:00:00 2024   superseded  nginx-15.4.0   1.25.3        Install complete
2          Mon Jan  1 00:05:00 2024   superseded  nginx-15.4.0   1.25.3        Upgrade complete
3          Mon Jan  1 00:10:00 2024   deployed    nginx-15.4.0   1.25.3        Rollback to 1
```

### 릴리스 조회

```bash
# 설치된 릴리스 목록
helm list
helm list -A              # 모든 네임스페이스
helm list -n web          # 특정 네임스페이스

# 릴리스 상태 확인
helm status my-nginx

# 릴리스에 적용된 values 확인
helm get values my-nginx
helm get values my-nginx --all  # 기본값 포함

# 릴리스의 매니페스트 확인
helm get manifest my-nginx
```

**`helm get values` vs `helm get values --all`:** `--all` 없이 실행하면 사용자가 오버라이드한 값만 표시한다. `--all`을 추가하면 Chart의 기본값을 포함한 모든 값을 표시한다. 트러블슈팅 시 실제 적용된 전체 설정을 확인하려면 `--all`을 사용한다.

---

## 12. Kustomize

### 등장 배경

Helm은 Go template 문법을 사용하여 러닝 커브가 있고, Chart를 유지보수해야 하는 부담이 있다. 단순히 환경별로 replicas 수, 이미지 태그, 네임스페이스만 다른 경우에는 Helm이 과도한 추상화이다. Kustomize는 기존 YAML을 수정 없이 두고, 패치(patch)를 오버레이하여 환경별 변형을 생성한다. kubectl에 내장(`kubectl apply -k`)되어 있어 별도 도구 설치가 필요 없다.

**Helm vs Kustomize:**

| 항목 | Helm | Kustomize |
|---|---|---|
| 접근 방식 | 템플릿 기반 (Go template) | 패치 기반 (overlay) |
| 복잡도 | 높음 (template 함수, 헬퍼 등) | 낮음 (원본 YAML + 패치) |
| 재사용 | Chart 패키징/배포 | base/overlay 디렉토리 구조 |
| 도구 설치 | helm CLI 필요 | kubectl 내장 |
| 적합한 경우 | 커뮤니티 패키지, 복잡한 매개변수화 | 자체 애플리케이션의 환경별 변형 |

### 디렉토리 구조

```
kustomize-demo/
  base/
    kustomization.yaml
    deployment.yaml
    service.yaml
  overlays/
    dev/
      kustomization.yaml
      replica-patch.yaml
    prod/
      kustomization.yaml
      replica-patch.yaml
```

**base:** 모든 환경에서 공통으로 사용되는 기본 매니페스트를 포함한다.
**overlays:** 환경별 변형을 정의한다. base를 참조하고 패치를 적용한다.

### base/kustomization.yaml

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - deployment.yaml
  - service.yaml
commonLabels:
  app: my-app
```

**`commonLabels`의 동작:** 모든 리소스의 `metadata.labels`에 레이블을 추가한다. Deployment의 경우 `spec.selector.matchLabels`와 `spec.template.metadata.labels`에도 자동 추가된다. 주의: `commonLabels`를 나중에 변경하면 Deployment의 immutable selector가 변경되어 업데이트가 실패한다.

### base/deployment.yaml

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
spec:
  replicas: 1
  selector:
    matchLabels:
      app: my-app
  template:
    metadata:
      labels:
        app: my-app
    spec:
      containers:
        - name: app
          image: my-app:latest
          ports:
            - containerPort: 8080
```

### overlays/dev/kustomization.yaml

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - ../../base
namePrefix: dev-
namespace: development
patches:
  - path: replica-patch.yaml
configMapGenerator:
  - name: app-config
    literals:
      - LOG_LEVEL=debug
      - ENV=development
images:
  - name: my-app
    newTag: dev-latest
```

**필드별 설명:**

| 필드 | 역할 |
|---|---|
| `namePrefix: dev-` | 모든 리소스 이름 앞에 `dev-` 접두사 추가. Service의 selector도 자동 업데이트 |
| `namespace: development` | 모든 리소스의 네임스페이스를 `development`로 설정 |
| `configMapGenerator` | ConfigMap을 자동 생성하고, 내용의 해시를 이름에 추가(`app-config-abc123`) |
| `images` | 이미지 이름과 태그를 오버라이드. YAML을 직접 수정하지 않아도 됨 |

**`configMapGenerator`의 해시 접미사:** ConfigMap 내용이 변경되면 해시가 달라져 이름이 바뀌고, 이를 참조하는 Deployment의 Pod template도 변경되어 자동으로 Rolling Update가 트리거된다. `kubectl apply`로는 ConfigMap이 변경되어도 기존 Pod가 재시작되지 않는 문제를 해결한다.

### overlays/dev/replica-patch.yaml (Strategic Merge Patch)

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
spec:
  replicas: 2
  template:
    spec:
      containers:
        - name: app
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              cpu: 200m
              memory: 256Mi
```

**Strategic Merge Patch의 동작:** base의 Deployment와 패치를 병합한다. 패치에 명시된 필드만 덮어쓰고, 나머지는 base의 값을 유지한다. `containers` 배열은 `name` 필드를 key로 사용하여 기존 컨테이너를 찾아 병합한다(배열 전체를 교체하지 않음). 이것이 JSON Merge Patch와의 핵심 차이점이다.

### overlays/prod/kustomization.yaml

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - ../../base
namePrefix: prod-
namespace: production
patches:
  - path: replica-patch.yaml
configMapGenerator:
  - name: app-config
    literals:
      - LOG_LEVEL=warn
      - ENV=production
images:
  - name: my-app
    newTag: v1.2.3
```

### Kustomize 적용 명령

```bash
# 렌더링 결과 확인 (적용하지 않음)
kubectl kustomize overlays/dev/

# 적용
kubectl apply -k overlays/dev/

# 삭제
kubectl delete -k overlays/dev/
```

**검증 명령:**

```bash
kubectl kustomize overlays/dev/
```

```text
apiVersion: v1
data:
  ENV: development
  LOG_LEVEL: debug
kind: ConfigMap
metadata:
  labels:
    app: my-app
  name: dev-app-config-2dk8m5h7c4
  namespace: development
---
apiVersion: v1
kind: Service
metadata:
  labels:
    app: my-app
  name: dev-my-app
  namespace: development
...
---
apiVersion: apps/v1
kind: Deployment
metadata:
  labels:
    app: my-app
  name: dev-my-app
  namespace: development
spec:
  replicas: 2
  selector:
    matchLabels:
      app: my-app
  template:
    metadata:
      labels:
        app: my-app
    spec:
      containers:
      - image: my-app:dev-latest
        name: app
        ports:
        - containerPort: 8080
        resources:
          limits:
            cpu: 200m
            memory: 256Mi
          requests:
            cpu: 100m
            memory: 128Mi
```

렌더링 결과에서 `namePrefix`, `namespace`, `images`, `configMapGenerator`가 모두 적용된 것을 확인할 수 있다.

```bash
kubectl apply -k overlays/dev/
kubectl get all -n development
```

```text
NAME                              READY   STATUS    RESTARTS   AGE
pod/dev-my-app-5d4f6b7c8d-abc12  1/1     Running   0          10s
pod/dev-my-app-5d4f6b7c8d-def34  1/1     Running   0          10s

NAME                 TYPE        CLUSTER-IP     EXTERNAL-IP   PORT(S)    AGE
service/dev-my-app   ClusterIP   10.96.50.100   <none>        8080/TCP   10s

NAME                         READY   UP-TO-DATE   AVAILABLE   AGE
deployment.apps/dev-my-app   2/2     2            2           10s
```

---

## 13. 시험 꿀팁 -- 필수 단축 명령 및 테크닉

### alias 및 자동완성 설정

```bash
# 시험 환경에서 기본 제공되지만 확인할 것
alias k=kubectl
complete -o default -F __start_kubectl k

# 추가 유용한 alias
export do="--dry-run=client -o yaml"
export now="--force --grace-period 0"
```

**alias 설정의 이유:** CKAD 시험은 2시간에 15~20문제를 풀어야 하므로, 타이핑 시간을 절약하는 것이 중요하다. `kubectl`을 `k`로 줄이면 한 문제당 수십 번의 타이핑을 절약할 수 있다. `$do`는 YAML 생성 시, `$now`는 Pod 즉시 삭제 시 사용한다.

### 빠른 리소스 생성 (dry-run)

```bash
# Pod 생성
k run nginx --image=nginx:1.25 --port=80 $do > pod.yaml

# Deployment 생성
k create deployment nginx --image=nginx:1.25 --replicas=3 $do > deploy.yaml

# Service 생성 (ClusterIP)
k expose deployment nginx --port=80 --target-port=80 $do > svc.yaml

# Job 생성
k create job my-job --image=busybox -- echo "hello" $do > job.yaml

# CronJob 생성
k create cronjob my-cron --image=busybox --schedule="*/5 * * * *" -- echo "hi" $do > cron.yaml

# ConfigMap 생성
k create configmap myconfig --from-literal=key1=val1 $do > cm.yaml

# Secret 생성
k create secret generic mysecret --from-literal=pass=1234 $do > secret.yaml

# ServiceAccount 생성
k create sa my-sa $do > sa.yaml

# Ingress 생성
k create ingress my-ingress --rule="host.com/path=svc:80" $do > ingress.yaml

# NetworkPolicy (YAML 직접 작성 필요 -- dry-run 지원 없음)
```

**dry-run 활용 전략:** 시험에서 YAML을 처음부터 작성하지 않는다. `--dry-run=client -o yaml`로 기본 구조를 생성한 후, 필요한 필드만 추가/수정한다. 특히 NetworkPolicy는 dry-run이 지원되지 않으므로, `kubectl explain networkpolicy.spec --recursive`를 활용하여 필드 구조를 확인한다.

**`--dry-run=client` vs `--dry-run=server`:** `client`는 API 서버에 요청하지 않고 로컬에서만 YAML을 생성한다. `server`는 API 서버에 요청을 보내 서버 측 검증(admission webhook 등)까지 수행하되 실제 생성하지 않는다. 시험에서는 속도를 위해 `client`를 사용한다.

### kubectl explain 활용

```bash
# 리소스 최상위 필드 확인
k explain pod.spec

# 재귀적으로 모든 필드 확인
k explain pod.spec --recursive

# 특정 필드 상세 확인
k explain pod.spec.containers.livenessProbe
k explain deployment.spec.strategy
k explain networkpolicy.spec.ingress
```

**`kubectl explain`이 중요한 이유:** CKAD 시험에서 공식 문서(kubernetes.io/docs)를 참고할 수 있지만, 페이지를 찾아 이동하는 시간이 소요된다. `kubectl explain`은 터미널에서 즉시 필드 이름, 타입, 설명을 확인할 수 있어 훨씬 빠르다. `--recursive` 옵션으로 전체 필드 트리를 한눈에 파악할 수 있다.

### 빠른 조회 및 디버깅

```bash
# Pod 상세 정보 (이벤트 포함)
k describe pod <pod-name>

# 특정 필드만 추출
k get pod <pod-name> -o jsonpath='{.spec.containers[*].name}'
k get pods -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.status.phase}{"\n"}{end}'

# 모든 네임스페이스에서 조회
k get pods -A

# label로 필터링
k get pods -l app=nginx
k get pods -l 'app in (nginx, httpbin)'

# Pod 즉시 삭제 (시험에서 시간 절약)
k delete pod <pod-name> $now

# 임시 Pod로 테스트
k run test --image=busybox -it --rm --restart=Never -- wget -qO- http://nginx-svc

# 리소스 사용량 확인
k top pods --sort-by=memory
k top pods --sort-by=cpu
```

**`-o jsonpath` 활용 시나리오:** 시험에서 "Pod의 이미지를 출력하라", "특정 조건의 Pod 이름을 나열하라" 같은 문제가 나온다. jsonpath 문법을 숙지하면 빠르게 답을 구할 수 있다.

**임시 Pod 패턴 분석:**
- `--rm`: Pod 종료 후 자동 삭제. 테스트 후 정리할 필요 없음.
- `--restart=Never`: restartPolicy를 Never로 설정하여 Pod(Job이 아닌)가 생성됨.
- `-it`: stdin 연결 + TTY 할당. 대화형 명령 실행 가능.

**트러블슈팅 순서:**
1. `kubectl get pod <pod>` - STATUS 확인 (CrashLoopBackOff, ImagePullBackOff, Pending 등)
2. `kubectl describe pod <pod>` - Events 섹션에서 원인 확인
3. `kubectl logs <pod>` - 컨테이너 로그 확인 (이전 컨테이너: `--previous`)
4. `kubectl exec <pod> -- <cmd>` - 컨테이너 내부 상태 확인

### YAML 편집 팁

```bash
# 실행 중인 리소스 편집
k edit deployment nginx

# 기존 리소스에서 YAML 추출
k get deployment nginx -o yaml > nginx-deploy.yaml

# YAML 적용
k apply -f manifest.yaml

# 변경 사항을 적용하기 전에 diff 확인
k diff -f manifest.yaml
```

**`kubectl edit`의 동작:** 기본 에디터(환경 변수 `KUBE_EDITOR` 또는 `EDITOR`)로 리소스의 현재 상태를 열고, 저장 시 변경 사항을 API 서버에 전송한다. 시험 환경에서는 `export KUBE_EDITOR=vim`이 기본 설정인 경우가 대부분이다.

**`kubectl apply` vs `kubectl create`:** `create`는 리소스가 이미 존재하면 오류를 반환한다. `apply`는 리소스가 없으면 생성하고, 있으면 업데이트한다. 시험에서는 `apply`를 권장하되, YAML 없이 명령형으로 생성할 때는 `create`를 사용한다.

**`kubectl diff`의 활용:** 매니페스트를 적용하기 전에 현재 클러스터 상태와의 차이를 확인한다. 의도하지 않은 변경을 사전에 발견할 수 있다. 시험에서 시간 여유가 있을 때 사용하면 실수를 줄일 수 있다.
