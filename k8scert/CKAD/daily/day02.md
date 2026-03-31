# CKAD Day 2: Init Container와 Multi-container Pod 패턴

> CKAD 도메인: Application Design and Build (20%) - Part 1b | 예상 소요 시간: 1시간

---

## 오늘의 학습 목표

- [ ] Init Container의 동작 원리와 주요 용도를 숙지한다
- [ ] Multi-container Pod 패턴(Sidecar, Ambassador, Adapter)을 구분한다
- [ ] Pod 생성 흐름과 Multi-container 내부 네트워크를 이해한다
- [ ] 시험 출제 패턴을 파악한다

---

## 1. Init Container (초기화 컨테이너)

### 1.1 Init Container란?

**등장 배경:**
컨테이너화된 앱을 배포할 때, 앱 시작 전에 DB가 준비되어 있는지, 설정 파일이 존재하는지 등 사전 조건을 확인해야 하는 경우가 빈번하다. 이를 앱 컨테이너 내부에 넣으면 앱 이미지가 비대해지고, 초기화 로직과 비즈니스 로직이 결합된다. Init Container는 이 문제를 해결하기 위해 초기화 전용 컨테이너를 분리한 것이다. 초기화와 실행을 서로 다른 이미지, 서로 다른 보안 컨텍스트로 수행할 수 있다.

**공학적 정의:**
Init Container는 Pod spec의 initContainers 필드에 정의되며, 메인 컨테이너(containers 필드) 실행 이전에 순차적으로(sequentially) 실행되는 초기화 전용 컨테이너이다. 각 Init Container는 exit code 0으로 종료되어야 다음 Init Container가 실행되며, 하나라도 실패하면 kubelet은 restartPolicy에 따라 Pod를 재시작한다. 주요 용도는 외부 의존성 대기(DNS 조회, TCP 연결 확인), 설정 파일 사전 생성, DB 스키마 마이그레이션 등 선행 조건 충족이다.

**내부 동작 원리 심화:**
kubelet은 initContainers 배열의 인덱스 순서대로 컨테이너를 실행한다. 각 init container는 독립된 cgroup에서 실행되며, exit code 0으로 종료되면 kubelet이 해당 컨테이너를 정리하고 다음 init container를 시작한다. init container의 resources(requests/limits)는 메인 컨테이너와 별도로 계산되며, Pod의 effective request는 init container와 메인 컨테이너의 max 값이 된다. 이는 init container가 일시적으로 더 많은 리소스를 필요로 할 수 있기 때문이다.

**특징:**
- 모든 init container가 성공적으로 완료되어야 메인 컨테이너가 시작된다
- 여러 init container가 있으면 정의된 순서대로 **하나씩** 실행된다 (동시 실행 불가)
- init container가 실패하면 Pod의 `restartPolicy`에 따라 재시도한다
- init container는 `spec.initContainers` 배열에 정의한다

### 1.2 Init Container 실행 순서 흐름도

```
[Pod 생성 요청]
    |
    v
[Node에 스케줄링]
    |
    v
[init-1 시작] --실패--> [restartPolicy에 따라 재시도]
    |성공                      |
    v                         v
[init-2 시작] --실패--> [restartPolicy에 따라 재시도]
    |성공
    v
[모든 init container 완료]
    |
    v
[메인 컨테이너들 동시 시작] <-- Liveness/Readiness Probe 활성화
    |
    v
[Pod Running 상태]
```

### 1.3 Init Container YAML 상세

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: init-demo
  namespace: demo
  labels:
    app: init-demo            # Service가 이 Pod를 찾을 때 사용하는 레이블
spec:
  initContainers:             # 초기화 컨테이너 목록 (순서대로 실행)
    - name: wait-for-db       # 첫 번째 init container: DB 대기
      image: busybox:1.36     # 경량 유틸리티 이미지
      command:                # 실행할 명령어 배열
        - sh                  # 셸 실행
        - -c                  # 다음 문자열을 명령으로 실행
        - |                   # 여러 줄 명령 (YAML 리터럴 블록)
          echo "Waiting for postgres to be ready..."
          until nslookup postgres.demo.svc.cluster.local; do
            # nslookup: DNS 조회 명령
            # postgres.demo.svc.cluster.local: Service의 FQDN
            # until: 명령이 성공할 때까지 반복
            echo "postgres is not available yet - sleeping 2s"
            sleep 2
          done
          echo "postgres is available!"
      # init container에는 Probe를 설정하지 않음
      # 명령이 종료 코드 0으로 끝나면 성공

    - name: init-config       # 두 번째 init container: 설정 파일 생성
      image: busybox:1.36
      command:
        - sh
        - -c
        - |
          # JSON 설정 파일 생성
          cat > /config/app.json << 'CONF'
          {
            "db_host": "postgres.demo.svc.cluster.local",
            "db_port": 5432,
            "log_level": "info"
          }
          CONF
          echo "Config file created at /config/app.json"
      volumeMounts:           # 볼륨 마운트: 이 컨테이너에서 볼륨을 사용
        - name: config-vol    # volumes에 정의된 볼륨 이름 참조
          mountPath: /config  # 컨테이너 내 마운트 경로

  containers:                 # 메인 컨테이너 (init 완료 후 시작)
    - name: app
      image: nginx:1.25
      ports:
        - containerPort: 80
      volumeMounts:
        - name: config-vol
          mountPath: /etc/app # 같은 볼륨을 다른 경로에 마운트 가능
          readOnly: true      # 읽기 전용으로 마운트

  volumes:                    # Pod 수준 볼륨 정의
    - name: config-vol        # 볼륨 이름 (initContainers, containers에서 참조)
      emptyDir: {}            # 빈 디렉토리 볼륨 (Pod 생명주기와 동일)
```

### 1.4 Init Container 주요 용도별 예제

**예제 1: Git 저장소에서 코드 클론**

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: git-sync-init
spec:
  initContainers:
    - name: git-clone
      image: alpine/git:latest
      command:
        - git
        - clone
        - "https://github.com/example/webapp.git"
        - /app/source
      volumeMounts:
        - name: app-source
          mountPath: /app/source
  containers:
    - name: web
      image: nginx:1.25
      volumeMounts:
        - name: app-source
          mountPath: /usr/share/nginx/html
          readOnly: true
  volumes:
    - name: app-source
      emptyDir: {}
```

**예제 2: 데이터베이스 스키마 마이그레이션**

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: migration-pod
spec:
  initContainers:
    - name: db-migrate
      image: myapp:latest
      command: ["python", "manage.py", "migrate"]
      env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: db-secret
              key: url
  containers:
    - name: app
      image: myapp:latest
      command: ["python", "manage.py", "runserver", "0.0.0.0:8000"]
      env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: db-secret
              key: url
```

**예제 3: 파일 권한 설정**

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: permission-init
spec:
  initContainers:
    - name: fix-permissions
      image: busybox:1.36
      command: ["sh", "-c", "chmod -R 777 /data && chown -R 1000:1000 /data"]
      volumeMounts:
        - name: data-vol
          mountPath: /data
      securityContext:
        runAsUser: 0          # root로 실행해서 권한 변경
  containers:
    - name: app
      image: nginx:1.25
      securityContext:
        runAsUser: 1000       # 비루트로 실행
      volumeMounts:
        - name: data-vol
          mountPath: /data
  volumes:
    - name: data-vol
      emptyDir: {}
```

---

## 2. Multi-container Pod 패턴

### 2.1 패턴 개요

**등장 배경:**
모놀리식 컨테이너에 로깅, 프록시, 모니터링 등 부가 기능을 모두 넣으면 이미지가 비대해지고, 부가 기능 업데이트 시 앱 전체를 재빌드해야 한다. 또한 팀 간 책임 분리가 어렵다. 멀티컨테이너 패턴은 마이크로서비스 원칙을 Pod 내부에도 적용하여, 각 컨테이너가 하나의 역할만 담당하도록 분리한다.

**공학적 정의:**
멀티컨테이너 Pod 패턴은 동일 Pod 내에서 역할을 분리하여 단일 책임 원칙(SRP)을 적용하는 분산 시스템 설계 패턴이다.
- **Sidecar(사이드카)**: 메인 컨테이너와 동일한 생명주기를 가지며, 로그 수집(Fluentd/Filebeat), 프록시(Envoy), 설정 동기화 등 보조 기능을 수행한다. emptyDir 볼륨을 통해 메인 컨테이너와 데이터를 공유한다.
- **Ambassador(앰버서더)**: 메인 컨테이너의 외부 통신을 프록시하는 패턴이다. 메인 컨테이너는 localhost로만 통신하고, Ambassador 컨테이너가 서비스 디스커버리, 연결 풀링, 프로토콜 변환 등을 처리한다.
- **Adapter(어댑터)**: 메인 컨테이너의 출력 데이터를 표준화된 형식으로 변환하는 패턴이다. 이기종 시스템의 메트릭/로그를 Prometheus exposition format 등 통일된 인터페이스로 변환한다.

**공유 리소스:**
- 네트워크: 동일 Pod 내 컨테이너는 같은 IP와 포트 공간을 공유. `localhost`로 상호 통신 가능
- 볼륨: `volumes`에 정의한 볼륨을 여러 컨테이너가 마운트하여 데이터 공유
- 프로세스 네임스페이스: `shareProcessNamespace: true` 설정 시 프로세스 목록 공유

### 2.2 Sidecar 패턴 - 로그 수집

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: sidecar-logging
  labels:
    app: sidecar-logging
    pattern: sidecar         # 패턴을 명시하는 레이블 (운영 편의)
spec:
  containers:
    # --- 메인 컨테이너: 애플리케이션 ---
    - name: app
      image: busybox:1.36
      command:
        - sh
        - -c
        - |
          # 메인 앱이 파일에 로그를 기록
          i=0
          while true; do
            echo "$(date '+%Y-%m-%d %H:%M:%S') [INFO] Request $i processed" >> /var/log/app.log
            i=$((i+1))
            sleep 3
          done
      volumeMounts:
        - name: log-vol          # 로그 볼륨 마운트
          mountPath: /var/log    # 로그 파일 저장 경로

    # --- 사이드카 컨테이너: 로그 수집기 ---
    - name: log-collector
      image: busybox:1.36
      command: ["sh", "-c", "tail -f /var/log/app.log"]
      # tail -f: 파일 끝에서 실시간으로 새 내용을 읽어 stdout으로 출력
      # kubectl logs <pod> -c log-collector 로 로그 확인 가능
      volumeMounts:
        - name: log-vol
          mountPath: /var/log
          readOnly: true         # 사이드카는 읽기만 함 (쓰기 불필요)

  volumes:
    - name: log-vol
      emptyDir: {}               # Pod와 생명주기를 같이 하는 임시 볼륨
```

### 2.3 Sidecar 패턴 - Git Sync

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: git-sync-sidecar
spec:
  containers:
    - name: web
      image: nginx:1.25
      volumeMounts:
        - name: web-content
          mountPath: /usr/share/nginx/html
          readOnly: true
    - name: git-sync
      image: registry.k8s.io/git-sync/git-sync:v4.0.0
      env:
        - name: GITSYNC_REPO
          value: "https://github.com/example/static-site.git"
        - name: GITSYNC_ROOT
          value: "/tmp/git"
        - name: GITSYNC_DEST
          value: "html"
        - name: GITSYNC_PERIOD
          value: "30s"            # 30초마다 git pull
      volumeMounts:
        - name: web-content
          mountPath: /tmp/git
  volumes:
    - name: web-content
      emptyDir: {}
```

### 2.4 Ambassador 패턴 - DB 프록시

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: ambassador-demo
spec:
  containers:
    # 메인 앱: localhost:6379로 요청
    - name: app
      image: myapp:latest
      env:
        - name: REDIS_HOST
          value: "localhost"       # ambassador를 통해 접근
        - name: REDIS_PORT
          value: "6379"

    # Ambassador: Redis 프록시
    - name: redis-proxy
      image: haproxy:2.9
      ports:
        - containerPort: 6379
      volumeMounts:
        - name: haproxy-config
          mountPath: /usr/local/etc/haproxy
  volumes:
    - name: haproxy-config
      configMap:
        name: redis-proxy-config
```

### 2.5 Adapter 패턴 - 로그 형식 변환

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: adapter-demo
  labels:
    app: adapter-demo
spec:
  containers:
    # 메인 앱: 자체 형식으로 로그 생성
    - name: app
      image: busybox:1.36
      command:
        - sh
        - -c
        - |
          while true; do
            echo "$(date +%s) ERROR connection timeout to redis" >> /var/log/app.log
            sleep 5
            echo "$(date +%s) INFO request processed successfully" >> /var/log/app.log
            sleep 5
          done
      volumeMounts:
        - name: log-vol
          mountPath: /var/log

    # Adapter: 로그를 JSON 형식으로 변환
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

---

## 3. 쿠버네티스 내부 동작 원리

### 3.1 Pod 생성 흐름 상세

```
1. 사용자가 kubectl apply -f pod.yaml 실행
   |
2. kubectl이 YAML을 JSON으로 변환하여 API Server에 POST 요청
   |
3. API Server가 요청을 처리:
   ├── 인증(Authentication): 사용자 신원 확인
   ├── 인가(Authorization): 권한 확인 (RBAC)
   ├── Admission Control: 정책 검증 (LimitRange, ResourceQuota 등)
   └── etcd에 Pod 객체 저장 (상태: Pending)
   |
4. Scheduler가 etcd에서 미배정 Pod 감지:
   ├── 필터링: 리소스 부족, taints 등으로 부적합 노드 제외
   ├── 점수 매기기: 남은 후보 중 최적 노드 선택
   └── API Server에 "이 Pod는 Node-X에 배치" 업데이트
   |
5. Node-X의 Kubelet이 새 Pod 할당 감지:
   ├── Container Runtime(containerd)에 컨테이너 생성 요청
   ├── CNI 플러그인으로 네트워크 설정
   ├── CSI 드라이버로 볼륨 마운트
   └── 컨테이너 시작
   |
6. Kubelet이 주기적으로 상태 보고:
   ├── 컨테이너 상태 (Running, Waiting, Terminated)
   ├── Probe 결과 (Liveness, Readiness, Startup)
   └── 리소스 사용량
```

### 3.2 Multi-container Pod 내부 네트워크

```
+------ Pod (10.244.1.5) ------+
|                               |
|  +-------+     +-------+     |
|  | app   |     | sidecar|    |
|  | :8080 |     | :9090  |    |
|  +---+---+     +---+----+   |
|      |             |         |
|  +---+-------------+----+   |
|  |    localhost (lo)     |   |
|  |    127.0.0.1          |   |
|  +-----------------------+   |
|                               |
|  공유 네트워크 네임스페이스     |
|  공유 볼륨 (emptyDir 등)      |
+-------------------------------+

- app은 localhost:9090으로 sidecar에 접근 가능
- sidecar는 localhost:8080으로 app에 접근 가능
- 외부에서는 Pod IP(10.244.1.5)로 접근
```

---

## 4. 트러블슈팅

### 4.1 Init Container가 완료되지 않는 경우

**증상:** Pod 상태가 `Init:0/2` 또는 `Init:CrashLoopBackOff`로 머문다.

```bash
# Init Container 로그 확인
kubectl logs <pod-name> -c <init-container-name>

# Pod 이벤트 확인
kubectl describe pod <pod-name> | grep -A20 "Init Containers:"
```

검증 (대기 중인 경우):
```text
Init Containers:
  wait-for-db:
    State:      Running
      Started:  Mon, 30 Mar 2026 00:00:00 +0000
    Ready:      False
```

주요 원인:
- **서비스 DNS 미등록**: nslookup 대상 서비스가 아직 생성되지 않았다. `kubectl get svc`로 확인한다.
- **네트워크 정책 차단**: NetworkPolicy가 init container의 아웃바운드 트래픽을 차단한다.
- **command 오류**: 셸 명령 문법 오류로 즉시 실패하고 반복 재시작한다.

### 4.2 Sidecar 컨테이너가 로그를 읽지 못하는 경우

**증상:** `kubectl logs <pod> -c log-reader`가 빈 출력이다.

```bash
# 볼륨 마운트 확인
kubectl describe pod <pod-name> | grep -A5 "Mounts:"

# 파일 존재 확인
kubectl exec <pod-name> -c log-reader -- ls -la /var/log/
```

검증:
```text
total 4
-rw-r--r--    1 root     root           0 Mar 30 00:00 app.log
```

주요 원인:
- **mountPath 불일치**: writer와 reader의 mountPath가 다르다.
- **볼륨 이름 불일치**: volumeMounts.name이 volumes에 정의된 이름과 다르다.
- **파일 미생성**: writer 컨테이너의 command가 올바르게 로그 파일을 생성하지 않는다.

---

## 5. 시험 출제 패턴

### 5.1 이 주제가 시험에서 어떻게 나오는가

CKAD 시험에서 Application Design and Build 도메인은 전체의 **20%**를 차지한다. 다음과 같은 유형으로 출제된다:

1. **Pod 생성**: 특정 조건의 Pod를 YAML로 작성하여 생성
2. **Multi-container Pod**: Sidecar, Init Container 패턴을 정확히 구현
3. **Dockerfile**: 멀티스테이지 빌드 이해 (개념 문제)

**문제의 의도:**
- YAML 구조를 정확히 알고 있는지 (들여쓰기, 필드 위치)
- kubectl 명령어를 빠르게 사용할 수 있는지
- 리소스 간 참조 관계를 이해하는지

### 5.2 시험 팁

```bash
# Pod YAML 빠른 생성 (dry-run)
kubectl run my-pod --image=nginx:1.25 --port=80 --dry-run=client -o yaml > pod.yaml

# 필드 구조 확인
kubectl explain pod.spec.initContainers
kubectl explain pod.spec.volumes.emptyDir
```

---

## 6. 복습 체크리스트

- [ ] Init Container와 Sidecar Container의 차이를 설명할 수 있다
- [ ] Sidecar, Ambassador, Adapter 패턴을 각각 한 문장으로 설명할 수 있다
- [ ] `initContainers` 필드의 위치와 `containers` 필드와의 관계를 안다
- [ ] Pod 생성 흐름(API Server -> Scheduler -> Kubelet -> Container Runtime)을 설명할 수 있다
- [ ] Multi-container Pod 내부에서 localhost로 통신하는 원리를 안다

---

## tart-infra 실습

### 실습 환경 설정

```bash
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/dev.yaml
kubectl get pods -n demo
```

검증:
```text
NAME                     READY   STATUS    RESTARTS   AGE
nginx-xxxxxxxxx-xxxxx    1/1     Running   0          xxd
```

### 실습 1: Init Container로 서비스 대기 패턴 구현

PostgreSQL 서비스가 준비될 때까지 대기하는 Init Container를 작성한다.

```bash
cat <<'EOF' | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: init-demo
  namespace: demo
spec:
  initContainers:
    - name: wait-for-postgres
      image: busybox:1.36
      command: ['sh', '-c', 'until nc -z postgresql.demo.svc.cluster.local 5432; do echo "waiting for postgres..."; sleep 2; done']
  containers:
    - name: app
      image: nginx:1.25
      ports:
        - containerPort: 80
EOF

# Init Container 상태 확인
kubectl get pod init-demo -n demo -w

# Init Container 로그 확인
kubectl logs init-demo -n demo -c wait-for-postgres
```

**예상 출력:**
```
NAME        READY   STATUS     RESTARTS   AGE
init-demo   0/1     Init:0/1   0          2s
init-demo   0/1     PodInitializing   0   4s
init-demo   1/1     Running    0          5s
```

**동작 원리:** Init Container는 `nc -z`(zero I/O mode)로 PostgreSQL 5432 포트에 TCP 연결을 시도한다. 연결 성공 시 exit 0으로 종료되고, kubelet이 메인 컨테이너를 시작한다. 실제 환경에서 DB 의존성이 있는 앱 시작 순서를 제어하는 표준 패턴이다.

### 실습 2: Sidecar 패턴 - nginx 접근 로그 수집

nginx 로그를 Sidecar 컨테이너가 실시간으로 읽는 Multi-container Pod를 구성한다.

```bash
cat <<'EOF' | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: sidecar-demo
  namespace: demo
spec:
  containers:
    - name: nginx
      image: nginx:1.25
      volumeMounts:
        - name: logs
          mountPath: /var/log/nginx
    - name: log-reader
      image: busybox:1.36
      command: ['sh', '-c', 'tail -f /var/log/nginx/access.log']
      volumeMounts:
        - name: logs
          mountPath: /var/log/nginx
  volumes:
    - name: logs
      emptyDir: {}
EOF

# 트래픽 생성 후 Sidecar 로그 확인
kubectl exec sidecar-demo -n demo -c nginx -- curl -s localhost
kubectl logs sidecar-demo -n demo -c log-reader --tail=3
```

**예상 출력 (log-reader):**
```
127.0.0.1 - - [19/Mar/2026:00:00:00 +0000] "GET / HTTP/1.1" 200 615 "-" "curl/8.x"
```

**동작 원리:** 두 컨테이너는 동일한 Pod 내에서 emptyDir 볼륨을 공유한다. nginx가 `/var/log/nginx/`에 기록한 로그를 log-reader 컨테이너가 `tail -f`로 실시간 스트리밍한다. 이것이 CKAD에서 자주 출제되는 Sidecar 로깅 패턴이다.

### 정리

```bash
kubectl delete pod init-demo sidecar-demo -n demo
```

검증:
```text
pod "init-demo" deleted
pod "sidecar-demo" deleted
```
