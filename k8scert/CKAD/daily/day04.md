# CKAD Day 4: Volume/Job/CronJob 실전 문제

> CKAD 도메인: Application Design and Build (20%) - Part 2b | 예상 소요 시간: 1시간

---

## 오늘의 학습 목표

- [ ] Day 1~3 내용을 실전 문제로 종합 연습한다
- [ ] Pod, Init Container, Multi-container, Volume, Job, CronJob 문제를 풀 수 있다
- [ ] 쿠버네티스 내부 동작 원리를 복습한다

---

## 1. 쿠버네티스 내부 동작 원리

### 1.1 Pod 생성 흐름 상세

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

### 1.2 Multi-container Pod 내부 네트워크

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

## 2. 실전 시험 문제 (12문제)

### 문제 1. Pod 생성 + Label + 환경변수

다음 조건의 Pod를 생성하라.

- Pod 이름: `exam-pod`, 네임스페이스: `exam`
- 이미지: `nginx:1.25`, 포트: 80
- Label: `app=web`, `tier=frontend`
- 환경 변수: `APP_ENV=production`

<details><summary>풀이</summary>

```bash
kubectl create namespace exam
kubectl run exam-pod -n exam \
  --image=nginx:1.25 --port=80 \
  --labels="app=web,tier=frontend" \
  --env="APP_ENV=production"
```

검증:
```bash
kubectl get pod exam-pod -n exam --show-labels
```

```text
NAME       READY   STATUS    RESTARTS   AGE   LABELS
exam-pod   1/1     Running   0          10s   app=web,tier=frontend
```

```bash
kubectl exec exam-pod -n exam -- env | grep APP_ENV
```

```text
APP_ENV=production
```

**핵심**: `kubectl run`으로 빠르게 생성. `--labels`, `--env` 옵션을 사용한다.

</details>

---

### 문제 2. Init Container + emptyDir

다음 조건의 Pod를 생성하라.

- Pod 이름: `init-pod`, 네임스페이스: `exam`
- Init container `setup` (busybox:1.36): `/work/config.txt`에 `ready=true` 기록
- Main container `app` (nginx:1.25): `/etc/app/` 에 같은 볼륨 마운트 (readOnly)
- emptyDir 볼륨 `work-vol` 사용

<details><summary>풀이</summary>

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: init-pod
  namespace: exam
spec:
  initContainers:
    - name: setup
      image: busybox:1.36
      command: ["sh", "-c", "echo 'ready=true' > /work/config.txt"]
      volumeMounts:
        - name: work-vol
          mountPath: /work
  containers:
    - name: app
      image: nginx:1.25
      volumeMounts:
        - name: work-vol
          mountPath: /etc/app
          readOnly: true
  volumes:
    - name: work-vol
      emptyDir: {}
```

검증:
```bash
kubectl get pod init-pod -n exam
kubectl exec init-pod -n exam -- cat /etc/app/config.txt
```

```text
NAME       READY   STATUS    RESTARTS   AGE
init-pod   1/1     Running   0          15s

ready=true
```

**핵심**: Init Container와 Main Container가 같은 볼륨을 공유한다. `readOnly: true`로 보안 강화.

</details>

---

### 문제 3. Sidecar 로깅 패턴

다음 조건의 Pod를 생성하라.

- Pod 이름: `sidecar-pod`
- 컨테이너 `app`: busybox:1.36, `/var/log/app.log`에 5초마다 로그 기록
- 컨테이너 `logger`: busybox:1.36, `tail -f /var/log/app.log` 실행
- emptyDir 볼륨으로 로그 공유

<details><summary>풀이</summary>

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: sidecar-pod
spec:
  containers:
    - name: app
      image: busybox:1.36
      command:
        - sh
        - -c
        - |
          while true; do
            echo "$(date) - App log entry" >> /var/log/app.log
            sleep 5
          done
      volumeMounts:
        - name: log-vol
          mountPath: /var/log
    - name: logger
      image: busybox:1.36
      command: ["sh", "-c", "tail -f /var/log/app.log"]
      volumeMounts:
        - name: log-vol
          mountPath: /var/log
          readOnly: true
  volumes:
    - name: log-vol
      emptyDir: {}
```

검증:
```bash
kubectl logs sidecar-pod -c logger --tail=3
```

```text
Mon Mar 30 00:00:00 UTC 2026 - App log entry
Mon Mar 30 00:00:05 UTC 2026 - App log entry
Mon Mar 30 00:00:10 UTC 2026 - App log entry
```

</details>

---

### 문제 4. Job 생성

다음 조건의 Job을 생성하라.

- Job 이름: `math-job`, 네임스페이스: `exam`
- 이미지: `busybox:1.36`
- 명령: `echo "2 + 3 = $((2+3))"`
- backoffLimit: 2, completions: 1

<details><summary>풀이</summary>

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: math-job
  namespace: exam
spec:
  completions: 1
  backoffLimit: 2
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: calc
          image: busybox:1.36
          command: ["sh", "-c", "echo \"2 + 3 = $((2+3))\""]
```

검증:
```bash
kubectl get job math-job -n exam
kubectl logs job/math-job -n exam
```

```text
NAME       STATUS     COMPLETIONS   DURATION   AGE
math-job   Complete   1/1           2s         10s

2 + 3 = 5
```

</details>

---

### 문제 5. CronJob 생성

다음 조건의 CronJob을 생성하라.

- 이름: `log-cleanup`, 네임스페이스: `exam`
- 매 10분마다 실행
- 이미지: `busybox:1.36`, 명령: `echo "Cleanup at $(date)"`
- successfulJobsHistoryLimit: 3
- concurrencyPolicy: Forbid

<details><summary>풀이</summary>

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: log-cleanup
  namespace: exam
spec:
  schedule: "*/10 * * * *"
  concurrencyPolicy: Forbid
  successfulJobsHistoryLimit: 3
  jobTemplate:
    spec:
      template:
        spec:
          restartPolicy: OnFailure
          containers:
            - name: cleanup
              image: busybox:1.36
              command: ["sh", "-c", "echo \"Cleanup at $(date)\""]
```

</details>

---

### 문제 6. 병렬 Job

다음 조건의 Job을 생성하라.

- 이름: `parallel-job`
- 5개의 작업을 동시에 2개씩 병렬 실행
- 이미지: `busybox:1.36`, 명령: `echo "Task complete" && sleep 5`

<details><summary>풀이</summary>

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: parallel-job
spec:
  completions: 5
  parallelism: 2
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: worker
          image: busybox:1.36
          command: ["sh", "-c", "echo 'Task complete' && sleep 5"]
```

검증:
```bash
kubectl get job parallel-job -w
```

```text
NAME           STATUS    COMPLETIONS   DURATION   AGE
parallel-job   Running   0/5           2s         2s
parallel-job   Running   1/5           7s         7s
parallel-job   Running   2/5           8s         8s
parallel-job   Complete  5/5           22s        22s
```

**핵심**: `completions=5`, `parallelism=2`이면 2개씩 동시 실행하여 총 5개를 완료한다.

</details>

---

### 문제 7. PVC + Pod

다음 조건으로 PVC와 Pod를 생성하라.

- PVC: `data-pvc`, storageClassName=standard, RWO, 500Mi
- Pod: `data-pod` (busybox:1.36), PVC를 `/data`에 마운트
- `/data/hello.txt`에 "Hello CKAD" 기록 후 sleep

<details><summary>풀이</summary>

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: data-pvc
spec:
  accessModes:
    - ReadWriteOnce
  storageClassName: standard
  resources:
    requests:
      storage: 500Mi
---
apiVersion: v1
kind: Pod
metadata:
  name: data-pod
spec:
  containers:
    - name: app
      image: busybox:1.36
      command: ["sh", "-c", "echo 'Hello CKAD' > /data/hello.txt && sleep 3600"]
      volumeMounts:
        - name: data-vol
          mountPath: /data
  volumes:
    - name: data-vol
      persistentVolumeClaim:
        claimName: data-pvc
```

</details>

---

### 문제 8. Multi-container + Volume

다음 조건의 Pod를 생성하라.

- Pod 이름: `multi-vol`
- 컨테이너 `writer` (busybox:1.36): `/shared/data.txt`에 3초마다 타임스탬프 기록
- 컨테이너 `reader` (busybox:1.36): `/shared/data.txt`를 tail -f로 stdout 출력
- emptyDir 볼륨 `shared` 사용

<details><summary>풀이</summary>

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: multi-vol
spec:
  containers:
    - name: writer
      image: busybox:1.36
      command:
        - sh
        - -c
        - |
          while true; do
            date >> /shared/data.txt
            sleep 3
          done
      volumeMounts:
        - name: shared
          mountPath: /shared
    - name: reader
      image: busybox:1.36
      command: ["sh", "-c", "tail -f /shared/data.txt"]
      volumeMounts:
        - name: shared
          mountPath: /shared
          readOnly: true
  volumes:
    - name: shared
      emptyDir: {}
```

</details>

---

### 문제 9. Job with activeDeadlineSeconds

120초 내에 완료되지 않으면 종료되는 Job을 생성하라.

- 이름: `timeout-job`
- 이미지: `busybox:1.36`, 명령: `echo "start" && sleep 30 && echo "done"`
- activeDeadlineSeconds: 120

<details><summary>풀이</summary>

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: timeout-job
spec:
  activeDeadlineSeconds: 120
  backoffLimit: 2
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: worker
          image: busybox:1.36
          command: ["sh", "-c", "echo 'start' && sleep 30 && echo 'done'"]
```

**핵심**: `activeDeadlineSeconds`는 Job spec 수준에 위치한다.

</details>

---

### 문제 10. Ambassador 패턴

다음 Ambassador 패턴 Pod를 생성하라.

- Pod 이름: `ambassador-pod`
- 메인 컨테이너 `app` (busybox:1.36): localhost:6379로 요청하는 앱
- Ambassador 컨테이너 `proxy` (haproxy:2.9): 외부 Redis로 프록시

<details><summary>풀이</summary>

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: ambassador-pod
spec:
  containers:
    - name: app
      image: busybox:1.36
      command: ["sh", "-c", "while true; do echo 'Request to localhost:6379'; sleep 10; done"]
      env:
        - name: REDIS_HOST
          value: "localhost"
        - name: REDIS_PORT
          value: "6379"
    - name: proxy
      image: haproxy:2.9
      ports:
        - containerPort: 6379
```

**핵심**: Ambassador 패턴에서 메인 컨테이너는 localhost로만 통신하고, Ambassador 컨테이너가 외부 서비스로 프록시한다.

</details>

---

### 문제 11. Adapter 패턴

다음 Adapter 패턴 Pod를 생성하라.

- Pod 이름: `adapter-pod`
- 컨테이너 `app`: busybox, 자체 형식으로 `/var/log/app.log`에 로그 생성
- 컨테이너 `adapter`: busybox, 로그를 JSON 형식으로 변환하여 stdout 출력
- emptyDir 공유

<details><summary>풀이</summary>

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: adapter-pod
spec:
  containers:
    - name: app
      image: busybox:1.36
      command:
        - sh
        - -c
        - |
          while true; do
            echo "$(date +%s) INFO request processed" >> /var/log/app.log
            sleep 5
          done
      volumeMounts:
        - name: log-vol
          mountPath: /var/log
    - name: adapter
      image: busybox:1.36
      command:
        - sh
        - -c
        - |
          tail -f /var/log/app.log | while read line; do
            ts=$(echo "$line" | awk '{print $1}')
            level=$(echo "$line" | awk '{print $2}')
            msg=$(echo "$line" | cut -d' ' -f3-)
            echo "{\"timestamp\":$ts,\"level\":\"$level\",\"message\":\"$msg\"}"
          done
      volumeMounts:
        - name: log-vol
          mountPath: /var/log
          readOnly: true
  volumes:
    - name: log-vol
      emptyDir: {}
```

</details>

---

### 문제 12. CronJob 일시 중지/재개

기존 CronJob `log-cleanup`을 일시 중지하고, 다시 재개하라.

<details><summary>풀이</summary>

```bash
# 일시 중지
kubectl patch cronjob log-cleanup -n exam -p '{"spec":{"suspend":true}}'

# 확인
kubectl get cronjob log-cleanup -n exam
# SUSPEND 컬럼이 True

# 재개
kubectl patch cronjob log-cleanup -n exam -p '{"spec":{"suspend":false}}'
```

검증:
```bash
kubectl get cronjob log-cleanup -n exam -o jsonpath='{.spec.suspend}'
```

```text
false
```

**핵심**: `spec.suspend`를 true/false로 토글하여 CronJob을 일시 중지/재개한다.

</details>

---

## 3. 트러블슈팅 시나리오

### 3.1 Volume 마운트 관련 장애

**시나리오:** emptyDir을 사용하는 멀티 컨테이너 Pod에서 reader 컨테이너가 파일을 읽지 못한다.

```bash
# 볼륨 마운트 상태 확인
kubectl describe pod <pod-name> | grep -A3 "Mounts:"

# 컨테이너 내부에서 파일 확인
kubectl exec <pod-name> -c reader -- ls -la /shared/
kubectl exec <pod-name> -c writer -- ls -la /shared/
```

검증 (정상):
```text
Mounts:
  /shared from shared-vol (rw)

total 4
-rw-r--r--    1 root     root          100 Mar 30 00:00 data.txt
```

디버깅 체크리스트:
- 두 컨테이너의 `volumeMounts.name`이 동일한지 확인한다.
- `volumeMounts.mountPath`가 의도한 경로인지 확인한다.
- writer가 실제로 파일을 생성하고 있는지 확인한다.

### 3.2 Job Pod가 반복 실패하는 경우

```bash
# 실패 원인 확인
kubectl get pods -l job-name=<job-name> -o wide
kubectl describe pod <failed-pod-name> | tail -20
kubectl logs <failed-pod-name>
```

검증 (실패 Pod 목록):
```text
NAME               READY   STATUS   RESTARTS   AGE
math-job-xxxxx     0/1     Error    0          30s
math-job-yyyyy     0/1     Error    0          20s
math-job-zzzzz     0/1     Error    0          10s
```

원인: command 오류, 이미지 내 바이너리 부재, 환경 변수 미설정 등이다. `backoffLimit` 초과 시 Job은 Failed 상태가 되고 더 이상 Pod를 생성하지 않는다.

---

## 4. 복습 체크리스트

- [ ] emptyDir과 PVC의 차이를 설명할 수 있다
- [ ] Job의 completions, parallelism, backoffLimit 필드를 설명할 수 있다
- [ ] CronJob의 schedule 형식을 작성할 수 있다
- [ ] Sidecar, Ambassador, Adapter 패턴을 emptyDir로 구현할 수 있다
- [ ] `kubectl create job`, `kubectl create cronjob` 명령을 사용할 수 있다

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

### 실습 1: Job으로 PostgreSQL 연결 테스트

demo 네임스페이스의 PostgreSQL에 연결을 확인하는 Job을 생성한다.

```bash
kubectl create job pg-check -n demo \
  --image=busybox:1.36 \
  -- sh -c 'nc -z postgresql.demo.svc.cluster.local 5432 && echo "PostgreSQL is reachable" || echo "FAILED"'

# Job 상태 확인
kubectl get job pg-check -n demo
kubectl logs job/pg-check -n demo
```

**예상 출력:**
```
NAME       STATUS     COMPLETIONS   DURATION   AGE
pg-check   Complete   1/1           3s         5s

PostgreSQL is reachable
```

**동작 원리:** Job 컨트롤러는 Pod를 생성하고 `completions`(기본 1) 수만큼 성공적으로 완료될 때까지 관리한다. Pod가 exit 0으로 종료되면 Job이 Complete 상태가 된다. `backoffLimit`(기본 6) 초과 시 Job은 Failed 상태가 된다.

### 실습 2: CronJob으로 주기적 상태 점검

demo 네임스페이스의 주요 서비스를 매분 점검하는 CronJob을 생성한다.

```bash
kubectl create cronjob svc-check -n demo \
  --image=busybox:1.36 \
  --schedule="*/1 * * * *" \
  -- sh -c 'echo "=== Service Check ===" && nc -z redis-master.demo 6379 && echo "Redis: OK" && nc -z rabbitmq.demo 5672 && echo "RabbitMQ: OK"'

# CronJob 확인
kubectl get cronjob svc-check -n demo

# 1분 후 생성된 Job 확인
kubectl get jobs -n demo -l job-name -w
```

**예상 출력:**
```
NAME        SCHEDULE      SUSPEND   ACTIVE   LAST SCHEDULE   AGE
svc-check   */1 * * * *   False     0        <none>          10s
```

**동작 원리:** CronJob 컨트롤러는 schedule에 따라 Job 객체를 생성한다. `successfulJobsHistoryLimit`(기본 3)과 `failedJobsHistoryLimit`(기본 1)에 의해 오래된 Job은 자동 정리된다. `concurrencyPolicy`(기본 Allow)로 동시 실행 정책을 제어할 수 있다.

### 실습 3: emptyDir 볼륨 공유 패턴

nginx와 컨텐츠 생성기가 볼륨을 공유하는 Multi-container Pod를 구성한다.

```bash
cat <<'EOF' | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: vol-share
  namespace: demo
spec:
  containers:
    - name: writer
      image: busybox:1.36
      command: ['sh', '-c', 'echo "<h1>tart-infra dev cluster</h1>" > /data/index.html && sleep 3600']
      volumeMounts:
        - name: shared
          mountPath: /data
    - name: nginx
      image: nginx:1.25
      volumeMounts:
        - name: shared
          mountPath: /usr/share/nginx/html
  volumes:
    - name: shared
      emptyDir: {}
EOF

# 확인
kubectl exec vol-share -n demo -c nginx -- curl -s localhost
```

**예상 출력:**
```html
<h1>tart-infra dev cluster</h1>
```

**동작 원리:** emptyDir은 Pod가 노드에 스케줄될 때 빈 디렉토리로 생성되며, Pod 내 모든 컨테이너가 공유할 수 있다. Pod가 삭제되면 emptyDir 데이터도 함께 삭제된다. PVC와 달리 영속성이 없으므로 임시 데이터 교환에만 사용한다.

### 정리

```bash
kubectl delete job pg-check -n demo
kubectl delete cronjob svc-check -n demo
kubectl delete pod vol-share -n demo
```

검증:
```text
job.batch "pg-check" deleted
cronjob.batch "svc-check" deleted
pod "vol-share" deleted
```
