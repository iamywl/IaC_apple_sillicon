# CKAD Day 10: Probe, 로깅, 디버깅 실전 문제

> CKAD 도메인: Application Observability and Maintenance (15%) - Part 1b | 예상 소요 시간: 1시간

---

## 오늘의 학습 목표

- [ ] Probe 관련 실전 문제를 풀 수 있다
- [ ] 로깅/디버깅 관련 실전 문제를 풀 수 있다
- [ ] 실전 시나리오(Spring Boot, Distroless 디버깅)를 이해한다
- [ ] 자주 하는 실수와 주의사항을 숙지한다

---

## 1. 실전 시험 문제 (12문제)

### 문제 1. Liveness Probe (httpGet)

다음 조건의 Pod를 생성하라.

- Pod 이름: `liveness-pod`, 이미지: `nginx:1.25`, 포트: 80
- Liveness Probe: httpGet, path=/, port=80
- initialDelaySeconds=5, periodSeconds=10, failureThreshold=3

<details><summary>풀이</summary>

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: liveness-pod
spec:
  containers:
    - name: nginx
      image: nginx:1.25
      ports:
        - containerPort: 80
      livenessProbe:
        httpGet:
          path: /
          port: 80
        initialDelaySeconds: 5
        periodSeconds: 10
        failureThreshold: 3
```

검증:
```bash
kubectl apply -f liveness-pod.yaml
kubectl describe pod liveness-pod | grep -A 3 "Liveness"
```

기대 출력:
```text
    Liveness:       http-get http://:80/ delay=5s timeout=1s period=10s #success=1 #failure=3
```

```bash
kubectl get pod liveness-pod
```

기대 출력:
```text
NAME            READY   STATUS    RESTARTS   AGE
liveness-pod    1/1     Running   0          30s
```

</details>

---

### 문제 2. Readiness Probe (tcpSocket)

다음 조건의 Pod를 생성하라.

- Pod 이름: `readiness-tcp`, 이미지: `redis:7`, 포트: 6379
- Readiness Probe: tcpSocket, port=6379
- periodSeconds=5, failureThreshold=3

<details><summary>풀이</summary>

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
        periodSeconds: 5
        failureThreshold: 3
```

검증:
```bash
kubectl apply -f readiness-tcp.yaml
kubectl get pod readiness-tcp
```

기대 출력:
```text
NAME             READY   STATUS    RESTARTS   AGE
readiness-tcp    1/1     Running   0          15s
```

```bash
kubectl describe pod readiness-tcp | grep -A 2 "Readiness"
```

기대 출력:
```text
    Readiness:      tcp-socket :6379 delay=0s timeout=1s period=5s #success=1 #failure=3
```

</details>

---

### 문제 3. Startup Probe

시작이 느린 앱을 위한 Pod를 생성하라.

- Pod 이름: `slow-app`, 이미지: `nginx:1.25`
- Startup Probe: httpGet, path=/, port=80
- 최대 120초 대기 (failureThreshold * periodSeconds)
- Startup 성공 후 Liveness Probe: httpGet, periodSeconds=10

<details><summary>풀이</summary>

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: slow-app
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
        failureThreshold: 24
        periodSeconds: 5
        # 24 * 5 = 120초 대기
      livenessProbe:
        httpGet:
          path: /
          port: 80
        periodSeconds: 10
        failureThreshold: 3
```

검증:
```bash
kubectl apply -f slow-app.yaml
kubectl describe pod slow-app | grep -A 3 "Startup\|Liveness"
```

기대 출력:
```text
    Startup:        http-get http://:80/ delay=0s timeout=1s period=5s #success=1 #failure=24
    Liveness:       http-get http://:80/ delay=0s timeout=1s period=10s #success=1 #failure=3
```

**핵심**: Startup Probe가 성공할 때까지 Liveness Probe는 실행되지 않는다. 최대 대기 시간 = 24 * 5 = 120초이다.

</details>

---

### 문제 4. exec Probe

다음 조건의 Pod를 생성하라.

- Pod 이름: `exec-probe`, 이미지: `busybox:1.36`
- command: `["sh", "-c", "touch /tmp/healthy && sleep 3600"]`
- Liveness Probe: exec, `cat /tmp/healthy`
- periodSeconds=5, failureThreshold=3

<details><summary>풀이</summary>

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: exec-probe
spec:
  containers:
    - name: app
      image: busybox:1.36
      command: ["sh", "-c", "touch /tmp/healthy && sleep 3600"]
      livenessProbe:
        exec:
          command:
            - cat
            - /tmp/healthy
        periodSeconds: 5
        failureThreshold: 3
```

검증:
```bash
kubectl apply -f exec-probe.yaml
kubectl get pod exec-probe
```

기대 출력:
```text
NAME          READY   STATUS    RESTARTS   AGE
exec-probe    1/1     Running   0          10s
```

```bash
# /tmp/healthy 삭제하면 Liveness 실패 -> 컨테이너 재시작
kubectl exec exec-probe -- rm /tmp/healthy

# 15~20초 후 확인 (failureThreshold=3, periodSeconds=5이므로 최대 15초 후 재시작)
kubectl get pod exec-probe
```

기대 출력:
```text
NAME          READY   STATUS    RESTARTS      AGE
exec-probe    1/1     Running   1 (5s ago)    30s
```

</details>

---

### 문제 5. 3가지 Probe 종합

다음 조건의 Pod를 생성하라.

- Pod 이름: `full-probe`, 이미지: `nginx:1.25`, 포트: 80
- Startup: httpGet /, port 80, failureThreshold=12, periodSeconds=5
- Liveness: httpGet /healthz, port 80, periodSeconds=10
- Readiness: httpGet /ready, port 80, periodSeconds=5

<details><summary>풀이</summary>

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: full-probe
spec:
  containers:
    - name: nginx
      image: nginx:1.25
      ports:
        - containerPort: 80
      startupProbe:
        httpGet:
          path: /
          port: 80
        failureThreshold: 12
        periodSeconds: 5
      livenessProbe:
        httpGet:
          path: /healthz
          port: 80
        periodSeconds: 10
        failureThreshold: 3
      readinessProbe:
        httpGet:
          path: /ready
          port: 80
        periodSeconds: 5
        failureThreshold: 3
```

검증:
```bash
kubectl apply -f full-probe.yaml
kubectl describe pod full-probe | grep -A 2 "Startup\|Liveness\|Readiness"
```

기대 출력:
```text
    Startup:        http-get http://:80/ delay=0s timeout=1s period=5s #success=1 #failure=12
    Liveness:       http-get http://:80/healthz delay=0s timeout=1s period=10s #success=1 #failure=3
    Readiness:      http-get http://:80/ready delay=0s timeout=1s period=5s #success=1 #failure=3
```

**주의**: nginx는 기본적으로 `/healthz`와 `/ready` 경로를 제공하지 않는다. 이 Pod에서 Startup Probe는 `/`로 성공하지만, Liveness(`/healthz`)와 Readiness(`/ready`)는 404를 반환하여 결국 재시작과 Not Ready 상태가 된다. 실제 운영에서는 앱이 해당 경로를 구현해야 한다.

</details>

---

### 문제 6. Sidecar 로깅 패턴

메인 앱이 `/var/log/app.log`에 로그를 쓰고, Sidecar가 이를 stdout으로 출력하는 Pod를 생성하라.

<details><summary>풀이</summary>

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: sidecar-log
spec:
  containers:
    - name: app
      image: busybox:1.36
      command: ["sh", "-c", "while true; do echo \"$(date) log message\" >> /var/log/app.log; sleep 5; done"]
      volumeMounts:
        - name: logs
          mountPath: /var/log
    - name: log-streamer
      image: busybox:1.36
      command: ["sh", "-c", "tail -f /var/log/app.log"]
      volumeMounts:
        - name: logs
          mountPath: /var/log
          readOnly: true
  volumes:
    - name: logs
      emptyDir: {}
```

```bash
kubectl apply -f sidecar-log.yaml
kubectl logs sidecar-log -c log-streamer --tail=3
```

기대 출력:
```text
Mon Jan 15 10:30:10 UTC 2024 log message
Mon Jan 15 10:30:15 UTC 2024 log message
Mon Jan 15 10:30:20 UTC 2024 log message
```

</details>

---

### 문제 7. 특정 컨테이너 로그

Multi-container Pod `multi-log`가 있다. `app` 컨테이너의 마지막 20줄 로그를 `/tmp/app-logs.txt`에 저장하라.

<details><summary>풀이</summary>

```bash
kubectl logs multi-log -c app --tail=20 > /tmp/app-logs.txt
```

</details>

---

### 문제 8. 이전 컨테이너 로그

Pod `crash-pod`가 CrashLoopBackOff 상태이다. 이전 컨테이너의 로그를 확인하고 `/tmp/crash-log.txt`에 저장하라.

<details><summary>풀이</summary>

```bash
kubectl logs crash-pod --previous > /tmp/crash-log.txt
cat /tmp/crash-log.txt
```

**핵심**: `--previous` 옵션은 재시작 이전의 컨테이너 로그를 보여준다. CrashLoopBackOff 디버깅에 필수!

</details>

---

### 문제 9. kubectl exec 디버깅

Pod `debug-pod` (nginx:1.25)에서 다음을 확인하라.

1. 실행 중인 프로세스 목록
2. /etc/resolv.conf 내용
3. localhost:80에 HTTP 요청

<details><summary>풀이</summary>

```bash
# 1. 프로세스 목록
kubectl exec debug-pod -- ps aux
```

기대 출력:
```text
PID   USER     TIME  COMMAND
    1 root      0:00 nginx: master process nginx -g daemon off;
   29 nginx     0:00 nginx: worker process
```

```bash
# 2. DNS 설정
kubectl exec debug-pod -- cat /etc/resolv.conf
```

기대 출력:
```text
nameserver 10.96.0.10
search default.svc.cluster.local svc.cluster.local cluster.local
options ndots:5
```

```bash
# 3. HTTP 요청
kubectl exec debug-pod -- curl -s localhost:80 | head -5
```

기대 출력:
```text
<!DOCTYPE html>
<html>
<head>
<title>Welcome to nginx!</title>
</head>
```

</details>

---

### 문제 10. Pod 상태 분석

Pod `analysis-pod`가 Pending 상태이다. 원인을 파악하고 `/tmp/pending-reason.txt`에 기록하라.

<details><summary>풀이</summary>

```bash
# 상세 정보에서 Events 확인
kubectl describe pod analysis-pod | tail -20

# Events에서 원인 파악
# 예: "0/3 nodes are available: 3 Insufficient cpu"

# 원인 기록
kubectl describe pod analysis-pod | grep -A5 "Events:" > /tmp/pending-reason.txt
```

**핵심**: Pending 상태의 주요 원인:
- Insufficient cpu/memory: 노드에 리소스 부족
- Unbound PVC: PVC가 바인드되지 않음
- Taints/Tolerations: 노드에 taint가 있고 Pod에 toleration이 없음

</details>

---

### 문제 11. 이벤트 기반 디버깅

네임스페이스 `exam`에서 최근 이벤트를 시간순으로 정렬하여 마지막 10개를 `/tmp/events.txt`에 저장하라.

<details><summary>풀이</summary>

```bash
kubectl get events -n exam --sort-by='.lastTimestamp' | tail -10 > /tmp/events.txt
```

</details>

---

### 문제 12. Deployment Probe 추가

기존 Deployment `web-deploy`에 다음 Probe를 추가하라.

- Liveness: httpGet, path=/, port=80, periodSeconds=10
- Readiness: httpGet, path=/, port=80, periodSeconds=5

<details><summary>풀이</summary>

```bash
kubectl edit deployment web-deploy
# containers 섹션에 livenessProbe, readinessProbe 추가
```

YAML에 추가할 내용:
```yaml
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

```bash
kubectl rollout status deployment/web-deploy
```

기대 출력:
```text
deployment "web-deploy" successfully rolled out
```

```bash
kubectl describe deployment web-deploy | grep -A 3 "Liveness\|Readiness"
```

기대 출력:
```text
    Liveness:       http-get http://:80/ delay=0s timeout=1s period=10s #success=1 #failure=3
    Readiness:      http-get http://:80/ delay=0s timeout=1s period=5s #success=1 #failure=3
```

</details>

---

## 2. 실전 시나리오

### 시나리오 A: Distroless 이미지 디버깅

```bash
# Distroless 이미지에는 셸이 없어 kubectl exec 불가
# kubectl debug로 Ephemeral Container 사용

# 1. 기존 Pod에 디버그 컨테이너 추가
kubectl debug -it distroless-pod \
  --image=busybox:1.36 \
  --target=app \
  -- /bin/sh

# 2. 프로세스 네임스페이스 공유로 앱 프로세스 확인
ps aux

# 3. 네트워크 디버깅
wget -qO- localhost:8080
nslookup api-svc
```

### 시나리오 B: Pod 상태별 대응 플로우차트

```
[Pod 상태 확인: kubectl get pods]
    |
    ├── [Pending]
    |   ├── kubectl describe pod -> Events 확인
    |   ├── "Insufficient cpu/memory" -> 노드 리소스 확인
    |   ├── "Unbound PVC" -> PV/PVC 확인
    |   └── "No nodes match" -> nodeSelector/affinity 확인
    |
    ├── [ImagePullBackOff]
    |   ├── 이미지 이름/태그 확인
    |   └── 프라이빗 레지스트리 -> imagePullSecrets 확인
    |
    ├── [CrashLoopBackOff]
    |   ├── kubectl logs --previous -> 이전 로그 확인
    |   ├── command/args 확인
    |   └── OOMKilled? -> memory limits 확인
    |
    ├── [Running but Not Ready]
    |   ├── Readiness Probe 확인
    |   └── 포트/경로 확인
    |
    └── [Evicted]
        └── 노드 리소스 부족 (DiskPressure, MemoryPressure)
```

---

## 3. 트러블슈팅

### 장애 시나리오 1: Probe 타임아웃으로 인한 false negative

```bash
# 증상: Pod가 정상인데 간헐적으로 재시작
kubectl get pod myapp
```

```text
NAME    READY   STATUS    RESTARTS      AGE
myapp   1/1     Running   8 (2m ago)    30m
```

```bash
# 디버깅
kubectl describe pod myapp | grep -A 5 "Events:" | grep "Unhealthy"
# Warning  Unhealthy  Liveness probe failed: Get "http://10.244.1.5:8080/healthz": context deadline exceeded

# 원인: timeoutSeconds=1(기본값)인데 앱이 1초 내에 응답하지 못함
# 해결: timeoutSeconds를 3~5초로 증가
```

### 장애 시나리오 2: kubectl debug 시 process namespace sharing 미설정

```bash
# 증상: debug 컨테이너에서 대상 컨테이너의 프로세스가 보이지 않음
kubectl debug -it myapp --image=busybox --target=app -- ps aux
# PID 1만 보이고 대상 앱 프로세스가 안 보임

# 원인: --share-processes 없이 copy-to를 사용한 경우
# 해결: --share-processes 옵션 추가
kubectl debug myapp -it --copy-to=debug-pod --image=busybox --share-processes
```

---

## 4. 자주 하는 실수와 주의사항

### 실수 1: Liveness Probe에서 앱 의존성 체크

```yaml
# 잘못된 예: 외부 DB 연결을 Liveness Probe로 체크
livenessProbe:
  exec:
    command: ["pg_isready", "-h", "postgres-svc"]
# DB가 다운되면 앱이 계속 재시작됨 -> 복구 불가!

# 올바른 예: 앱 자체의 생존 여부만 체크
livenessProbe:
  httpGet:
    path: /healthz     # 앱이 살아있는지만 확인
    port: 8080
readinessProbe:
  httpGet:
    path: /ready       # DB 연결 포함 종합 상태
    port: 8080
```

### 실수 2: Startup Probe 없이 긴 initialDelaySeconds

```yaml
# 잘못된 예
livenessProbe:
  initialDelaySeconds: 120   # 2분 대기 -> 진짜 문제도 2분 후에야 감지

# 올바른 예: Startup Probe 사용
startupProbe:
  httpGet:
    path: /
    port: 80
  failureThreshold: 24
  periodSeconds: 5       # 최대 120초 대기, 빨리 되면 빨리 통과
livenessProbe:
  httpGet:
    path: /
    port: 80
  periodSeconds: 10      # Startup 후 바로 시작
```

### 실수 3: Multi-container Pod 로그 조회 시 -c 누락

```bash
# 에러: Multi-container Pod에서 -c 없이 로그 조회
kubectl logs multi-pod
# Error: a container name must be specified

# 올바른 예:
kubectl logs multi-pod -c app
kubectl logs multi-pod --all-containers    # 모든 컨테이너
```

---

## 5. 복습 체크리스트

- [ ] Probe 실전 문제를 시간 내에 풀 수 있다
- [ ] `kubectl logs --previous`로 CrashLoopBackOff를 디버깅할 수 있다
- [ ] `kubectl debug`로 Ephemeral Container를 사용할 수 있다
- [ ] `kubectl describe pod`의 Events로 문제를 진단할 수 있다
- [ ] Liveness Probe에서 외부 의존성을 체크하면 안 되는 이유를 안다

---

## tart-infra 실습

### 실습 환경 설정

```bash
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/dev.yaml
kubectl get nodes
```

### 실습 1: Probe 확인

```bash
# demo 네임스페이스 Pod의 Probe 확인
kubectl get pod -n demo -l app=nginx-web -o jsonpath='{.items[0].spec.containers[0].livenessProbe}' | python3 -m json.tool 2>/dev/null || echo "No Liveness Probe"
```

### 실습 2: 로그 및 리소스 확인

```bash
# nginx-web 로그 확인
kubectl logs -n demo deploy/nginx-web --tail=5

# Pod 리소스 사용량 확인
kubectl top pods -n demo --sort-by=memory

# kubectl exec 실습
kubectl exec -n demo deploy/nginx-web -- cat /etc/resolv.conf
```
