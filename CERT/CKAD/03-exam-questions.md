# CKAD 모의 실기 문제

> 총 40문제이다. 실제 시험과 유사한 형식으로 구성되어 있다.
> 각 문제는 시나리오와 태스크로 구성되어 있으며, 풀이는 접힌 상태로 제공된다.
> 시험 환경을 가정하여 kubectl 명령어와 YAML 매니페스트를 함께 작성해야 한다.

**도메인별 배분:**
- Application Design and Build: 8문제 (1~8)
- Application Deployment: 8문제 (9~16)
- Application Observability and Maintenance: 6문제 (17~22)
- Application Environment, Configuration and Security: 10문제 (23~32)
- Services and Networking: 8문제 (33~40)

---

## Application Design and Build

### 문제 1. [Design & Build] Dockerfile 멀티스테이지 빌드

다음 요구사항을 만족하는 Dockerfile을 작성하라.

- Go 애플리케이션(`main.go`)을 빌드하는 멀티스테이지 Dockerfile이다.
- 빌드 스테이지는 `golang:1.21-alpine` 이미지를 사용한다.
- 런타임 스테이지는 `alpine:3.18` 이미지를 사용한다.
- 최종 이미지에서 비루트 사용자(UID 1000)로 실행한다.
- 포트 8080을 노출한다.

<details><summary>풀이 확인</summary>

**풀이:**

```dockerfile
FROM golang:1.21-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o server .

FROM alpine:3.18
RUN adduser -D -u 1000 appuser
COPY --from=builder /app/server /usr/local/bin/server
USER 1000
EXPOSE 8080
ENTRYPOINT ["server"]
```

핵심: `AS builder`로 빌드 스테이지에 이름을 부여하고, `COPY --from=builder`로 빌드 결과물만 복사한다. `CGO_ENABLED=0`은 정적 바이너리를 생성하여 alpine에서 실행 가능하게 한다.

</details>

---

### 문제 2. [Design & Build] Init Container

다음 조건을 만족하는 Pod를 생성하라.

- Pod 이름: `app-pod`
- 네임스페이스: `exam`
- Init container: `init-svc-check` (이미지: `busybox:1.36`)
  - `myservice`라는 Service가 DNS에서 조회될 때까지 2초 간격으로 대기한다.
- 메인 컨테이너: `app` (이미지: `nginx:1.25`, 포트: 80)

<details><summary>풀이 확인</summary>

**풀이:**

```bash
kubectl create namespace exam --dry-run=client -o yaml | kubectl apply -f -
```

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: app-pod
  namespace: exam
spec:
  initContainers:
    - name: init-svc-check
      image: busybox:1.36
      command:
        - sh
        - -c
        - |
          until nslookup myservice.exam.svc.cluster.local; do
            echo "Waiting for myservice..."
            sleep 2
          done
  containers:
    - name: app
      image: nginx:1.25
      ports:
        - containerPort: 80
```

핵심: init container는 `initContainers` 필드에 정의하며, 메인 컨테이너보다 먼저 실행된다. `nslookup`이 성공할 때까지 반복 대기한다.

</details>

---

### 문제 3. [Design & Build] Sidecar Container -- 로그 수집

다음 조건을 만족하는 Pod를 생성하라.

- Pod 이름: `logging-pod`
- 컨테이너 1 (`app`): 이미지 `busybox:1.36`, `/var/log/app.log` 파일에 5초마다 로그를 기록한다.
- 컨테이너 2 (`log-collector`): 이미지 `busybox:1.36`, `/var/log/app.log` 파일을 tail하여 stdout으로 출력한다.
- 두 컨테이너는 emptyDir 볼륨을 공유한다.

<details><summary>풀이 확인</summary>

**풀이:**

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: logging-pod
spec:
  containers:
    - name: app
      image: busybox:1.36
      command:
        - sh
        - -c
        - |
          while true; do
            echo "$(date) - Log entry" >> /var/log/app.log
            sleep 5
          done
      volumeMounts:
        - name: shared-logs
          mountPath: /var/log
    - name: log-collector
      image: busybox:1.36
      command: ["sh", "-c", "tail -f /var/log/app.log"]
      volumeMounts:
        - name: shared-logs
          mountPath: /var/log
          readOnly: true
  volumes:
    - name: shared-logs
      emptyDir: {}
```

핵심: emptyDir 볼륨으로 컨테이너 간 데이터를 공유한다. sidecar는 `readOnly: true`로 마운트하는 것이 좋다. `kubectl logs logging-pod -c log-collector`로 sidecar 로그를 확인한다.

</details>

---

### 문제 4. [Design & Build] PersistentVolumeClaim

다음 PersistentVolumeClaim과 이를 사용하는 Pod를 생성하라.

- PVC 이름: `data-pvc`, StorageClass: `standard`, AccessMode: `ReadWriteOnce`, 용량: `1Gi`
- Pod 이름: `data-pod`, 이미지: `nginx:1.25`
- PVC를 `/usr/share/nginx/html`에 마운트한다.

<details><summary>풀이 확인</summary>

**풀이:**

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
      storage: 1Gi
---
apiVersion: v1
kind: Pod
metadata:
  name: data-pod
spec:
  containers:
    - name: nginx
      image: nginx:1.25
      volumeMounts:
        - name: data-vol
          mountPath: /usr/share/nginx/html
  volumes:
    - name: data-vol
      persistentVolumeClaim:
        claimName: data-pvc
```

핵심: PVC의 `accessModes`, `storageClassName`, `resources.requests.storage`를 정확히 지정해야 한다.

</details>

---

### 문제 5. [Design & Build] Multi-container Pod -- Ambassador 패턴

다음 조건을 만족하는 Pod를 생성하라.

- Pod 이름: `ambassador-pod`
- 컨테이너 1 (`app`): 이미지 `nginx:1.25`, 포트 80
- 컨테이너 2 (`ambassador`): 이미지 `haproxy:2.8`, 포트 8080
- 두 컨테이너 모두 `/etc/shared-config`에 configMap `proxy-config`를 마운트한다.

<details><summary>풀이 확인</summary>

**풀이:**

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: ambassador-pod
spec:
  containers:
    - name: app
      image: nginx:1.25
      ports:
        - containerPort: 80
      volumeMounts:
        - name: config
          mountPath: /etc/shared-config
          readOnly: true
    - name: ambassador
      image: haproxy:2.8
      ports:
        - containerPort: 8080
      volumeMounts:
        - name: config
          mountPath: /etc/shared-config
          readOnly: true
  volumes:
    - name: config
      configMap:
        name: proxy-config
```

핵심: ambassador 패턴은 메인 앱이 localhost를 통해 ambassador 컨테이너에 요청을 보내고, ambassador가 외부 서비스로 프록시한다. 동일 Pod 내 컨테이너는 localhost로 통신한다.

</details>

---

### 문제 6. [Design & Build] emptyDir 볼륨과 medium: Memory

다음 Pod를 생성하라.

- Pod 이름: `cache-pod`
- 이미지: `redis:7`
- emptyDir 볼륨을 RAM 기반(`medium: Memory`)으로 생성하고, 최대 크기를 `256Mi`로 제한한다.
- `/data`에 마운트한다.

<details><summary>풀이 확인</summary>

**풀이:**

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: cache-pod
spec:
  containers:
    - name: redis
      image: redis:7
      volumeMounts:
        - name: cache-vol
          mountPath: /data
  volumes:
    - name: cache-vol
      emptyDir:
        medium: Memory
        sizeLimit: 256Mi
```

핵심: `medium: Memory`를 설정하면 tmpfs(RAM 디스크)에 마운트되어 I/O 성능이 향상된다. `sizeLimit`을 설정하여 메모리 사용량을 제한할 수 있다.

</details>

---

### 문제 7. [Design & Build] ConfigMap을 Volume으로 마운트 (subPath)

ConfigMap `app-properties`의 `application.yaml` key만 컨테이너의 `/etc/app/application.yaml` 경로에 단일 파일로 마운트하는 Pod를 생성하라. 기존 `/etc/app` 디렉토리의 다른 파일은 보존되어야 한다.

- Pod 이름: `subpath-pod`
- 이미지: `nginx:1.25`

<details><summary>풀이 확인</summary>

**풀이:**

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: subpath-pod
spec:
  containers:
    - name: nginx
      image: nginx:1.25
      volumeMounts:
        - name: config-vol
          mountPath: /etc/app/application.yaml
          subPath: application.yaml
          readOnly: true
  volumes:
    - name: config-vol
      configMap:
        name: app-properties
```

핵심: `subPath`를 사용하면 configMap의 특정 key만 단일 파일로 마운트할 수 있다. 일반 volume mount와 달리 디렉토리를 덮어쓰지 않는다. 단, subPath로 마운트한 파일은 ConfigMap 업데이트 시 자동 갱신되지 않는다.

</details>

---

### 문제 8. [Design & Build] Job과 CronJob

1. 이미지 `perl:5.38`을 사용하여 원주율을 2000자리까지 계산하는 Job을 생성하라.
   - Job 이름: `pi-job`, 명령: `perl -Mbignum=bpi -wle 'print bpi(2000)'`
   - 완료 후 30초 뒤 자동 삭제 (`ttlSecondsAfterFinished: 30`)
2. 위 Job을 매 5분마다 실행하는 CronJob을 생성하라.
   - CronJob 이름: `pi-cron`

<details><summary>풀이 확인</summary>

**풀이:**

Job:
```bash
kubectl create job pi-job --image=perl:5.38 -- perl -Mbignum=bpi -wle 'print bpi(2000)'
```

또는 YAML:
```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: pi-job
spec:
  ttlSecondsAfterFinished: 30
  template:
    spec:
      containers:
        - name: pi
          image: perl:5.38
          command: ["perl", "-Mbignum=bpi", "-wle", "print bpi(2000)"]
      restartPolicy: Never
  backoffLimit: 4
```

CronJob:
```bash
kubectl create cronjob pi-cron --image=perl:5.38 --schedule="*/5 * * * *" \
  -- perl -Mbignum=bpi -wle 'print bpi(2000)'
```

또는 YAML:
```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: pi-cron
spec:
  schedule: "*/5 * * * *"
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: pi
              image: perl:5.38
              command: ["perl", "-Mbignum=bpi", "-wle", "print bpi(2000)"]
          restartPolicy: Never
```

핵심: Job의 `restartPolicy`는 `Never` 또는 `OnFailure`만 가능하다. CronJob은 `schedule` 필드에 cron 표현식을 사용한다.

</details>

---

## Application Deployment

### 문제 9. [Deployment] Rolling Update 전략 설정

다음 조건의 Deployment를 생성하라.

- 이름: `web-deploy`, 이미지: `nginx:1.24`, replicas: 4
- Rolling Update 전략: maxSurge=2, maxUnavailable=1
- 이후 이미지를 `nginx:1.25`로 업데이트하고, 롤아웃 상태를 확인하라.

<details><summary>풀이 확인</summary>

**풀이:**

```bash
# Deployment 생성
kubectl create deployment web-deploy --image=nginx:1.24 --replicas=4 \
  --dry-run=client -o yaml > web-deploy.yaml
```

YAML을 수정하여 strategy를 추가한다:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web-deploy
spec:
  replicas: 4
  selector:
    matchLabels:
      app: web-deploy
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 2
      maxUnavailable: 1
  template:
    metadata:
      labels:
        app: web-deploy
    spec:
      containers:
        - name: nginx
          image: nginx:1.24
```

```bash
kubectl apply -f web-deploy.yaml

# 이미지 업데이트
kubectl set image deployment/web-deploy nginx=nginx:1.25

# 롤아웃 상태 확인
kubectl rollout status deployment/web-deploy

# 히스토리 확인
kubectl rollout history deployment/web-deploy
```

핵심: maxSurge=2이면 업데이트 중 최대 6개(4+2) Pod가 존재할 수 있고, maxUnavailable=1이면 최소 3개(4-1) Pod가 항상 가용하다.

</details>

---

### 문제 10. [Deployment] Rollback

Deployment `web-deploy`를 리비전 1로 롤백하라. 롤백 전후의 이미지를 확인하라.

<details><summary>풀이 확인</summary>

**풀이:**

```bash
# 현재 이미지 확인
kubectl describe deployment web-deploy | grep Image

# 리비전 히스토리 확인
kubectl rollout history deployment/web-deploy

# 특정 리비전 상세 확인
kubectl rollout history deployment/web-deploy --revision=1

# 리비전 1로 롤백
kubectl rollout undo deployment/web-deploy --to-revision=1

# 롤백 완료 확인
kubectl rollout status deployment/web-deploy

# 이미지 확인
kubectl describe deployment web-deploy | grep Image
```

핵심: `--to-revision=N`으로 특정 리비전을 지정한다. 생략하면 직전 리비전으로 롤백한다.

</details>

---

### 문제 11. [Deployment] Canary 배포 (Kubernetes 네이티브)

`app: myapp` label을 공유하는 두 Deployment를 생성하여 canary 배포를 구현하라.

- Stable: `myapp-stable`, 이미지: `nginx:1.24`, replicas: 9
- Canary: `myapp-canary`, 이미지: `nginx:1.25`, replicas: 1
- Service `myapp-svc`를 생성하여 `app: myapp`으로 트래픽을 분배한다.

<details><summary>풀이 확인</summary>

**풀이:**

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp-stable
spec:
  replicas: 9
  selector:
    matchLabels:
      app: myapp
      version: stable
  template:
    metadata:
      labels:
        app: myapp
        version: stable
    spec:
      containers:
        - name: nginx
          image: nginx:1.24
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp-canary
spec:
  replicas: 1
  selector:
    matchLabels:
      app: myapp
      version: canary
  template:
    metadata:
      labels:
        app: myapp
        version: canary
    spec:
      containers:
        - name: nginx
          image: nginx:1.25
---
apiVersion: v1
kind: Service
metadata:
  name: myapp-svc
spec:
  selector:
    app: myapp
  ports:
    - port: 80
      targetPort: 80
```

핵심: Service의 selector는 `app: myapp`만 사용하여 두 Deployment의 Pod 모두에 트래픽이 분배된다. replica 비율(9:1)로 약 10%의 트래픽이 canary로 향한다.

</details>

---

### 문제 12. [Deployment] Blue-Green 배포

Blue-Green 배포를 구현하라.

1. Blue Deployment (`myapp-blue`, 이미지: `nginx:1.24`, replicas: 3)를 생성하고 Service `myapp-svc`에 연결한다.
2. Green Deployment (`myapp-green`, 이미지: `nginx:1.25`, replicas: 3)를 생성한다.
3. Service의 selector를 변경하여 트래픽을 Green으로 전환한다.

<details><summary>풀이 확인</summary>

**풀이:**

```yaml
# Blue Deployment
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp-blue
spec:
  replicas: 3
  selector:
    matchLabels:
      app: myapp
      version: blue
  template:
    metadata:
      labels:
        app: myapp
        version: blue
    spec:
      containers:
        - name: nginx
          image: nginx:1.24
---
# Green Deployment
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp-green
spec:
  replicas: 3
  selector:
    matchLabels:
      app: myapp
      version: green
  template:
    metadata:
      labels:
        app: myapp
        version: green
    spec:
      containers:
        - name: nginx
          image: nginx:1.25
---
# Service (처음에는 Blue를 가리킴)
apiVersion: v1
kind: Service
metadata:
  name: myapp-svc
spec:
  selector:
    app: myapp
    version: blue
  ports:
    - port: 80
      targetPort: 80
```

```bash
# Green으로 전환
kubectl patch service myapp-svc -p '{"spec":{"selector":{"version":"green"}}}'

# 롤백 (다시 Blue로)
kubectl patch service myapp-svc -p '{"spec":{"selector":{"version":"blue"}}}'
```

핵심: Service의 `selector.version`을 변경하여 즉각적으로 트래픽을 전환한다. `kubectl patch`를 사용하면 빠르게 변경할 수 있다.

</details>

---

### 문제 13. [Deployment] Helm 설치 및 커스터마이징

Helm을 사용하여 nginx를 설치하라.

1. bitnami 저장소를 추가하라.
2. `web` 네임스페이스에 릴리스 이름 `my-web`으로 설치하라 (replicas=2, service.type=NodePort).
3. replicas를 3으로 업그레이드하라.
4. 리비전 1로 롤백하라.

<details><summary>풀이 확인</summary>

**풀이:**

```bash
# 저장소 추가
helm repo add bitnami https://charts.bitnami.com/bitnami
helm repo update

# 설치
helm install my-web bitnami/nginx \
  --namespace web --create-namespace \
  --set replicaCount=2 \
  --set service.type=NodePort

# 확인
helm list -n web
kubectl get pods -n web

# 업그레이드
helm upgrade my-web bitnami/nginx \
  --namespace web \
  --set replicaCount=3 \
  --set service.type=NodePort

# 히스토리 확인
helm history my-web -n web

# 롤백
helm rollback my-web 1 -n web

# 확인
helm status my-web -n web
```

핵심: `--create-namespace`로 네임스페이스가 없으면 자동 생성한다. `helm upgrade` 시 이전에 설정한 값도 다시 지정해야 한다 (`--reuse-values` 옵션으로 유지 가능).

</details>

---

### 문제 14. [Deployment] Kustomize 오버레이 적용

base 디렉토리에 Deployment와 Service가 있다. dev 오버레이를 만들어 다음을 변경하라.

- namespace를 `development`로 설정
- replicas를 3으로 변경
- namePrefix를 `dev-`로 설정
- 이미지 태그를 `dev-latest`로 변경

<details><summary>풀이 확인</summary>

**풀이:**

overlays/dev/kustomization.yaml:
```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - ../../base
namespace: development
namePrefix: dev-
patches:
  - target:
      kind: Deployment
      name: my-app
    patch: |
      - op: replace
        path: /spec/replicas
        value: 3
images:
  - name: my-app
    newTag: dev-latest
```

```bash
# 렌더링 확인
kubectl kustomize overlays/dev/

# 적용
kubectl apply -k overlays/dev/
```

핵심: `images` 필드로 이미지 태그를 변경할 수 있다. JSON patch나 strategic merge patch 모두 사용 가능하다.

</details>

---

### 문제 15. [Deployment] Deployment 스케일링 및 HPA

1. Deployment `cpu-app`을 생성하라 (이미지: `nginx:1.25`, replicas: 2, resources.requests.cpu: 100m).
2. HPA를 생성하여 CPU 사용률 50% 기준으로 2~10개로 자동 스케일링하라.

<details><summary>풀이 확인</summary>

**풀이:**

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: cpu-app
spec:
  replicas: 2
  selector:
    matchLabels:
      app: cpu-app
  template:
    metadata:
      labels:
        app: cpu-app
    spec:
      containers:
        - name: nginx
          image: nginx:1.25
          resources:
            requests:
              cpu: 100m
            limits:
              cpu: 200m
```

```bash
# HPA 생성
kubectl autoscale deployment cpu-app \
  --min=2 --max=10 --cpu-percent=50

# HPA 확인
kubectl get hpa cpu-app
```

핵심: HPA가 동작하려면 반드시 `resources.requests.cpu`가 설정되어 있어야 한다. metrics-server도 설치되어 있어야 한다.

</details>

---

### 문제 16. [Deployment] Deployment의 annotation으로 변경 사유 기록

Deployment `web-deploy`의 이미지를 `nginx:1.25`로 업데이트하면서 변경 사유를 annotation에 기록하라.

<details><summary>풀이 확인</summary>

**풀이:**

```bash
# 이미지 업데이트
kubectl set image deployment/web-deploy nginx=nginx:1.25

# annotation으로 기록
kubectl annotate deployment/web-deploy kubernetes.io/change-cause="Update nginx to 1.25 for security patch"

# 히스토리에서 확인
kubectl rollout history deployment/web-deploy
```

핵심: `--record` 플래그는 deprecated 되었다. 대신 `kubernetes.io/change-cause` annotation을 사용하여 변경 사유를 기록한다. 이 값은 `rollout history`에 표시된다.

</details>

---

## Application Observability and Maintenance

### 문제 17. [Observability] Liveness/Readiness Probe 설정

다음 Probe가 설정된 Pod를 생성하라.

- Pod 이름: `probe-pod`, 이미지: `nginx:1.25`
- Liveness Probe: HTTP GET `/healthz`, 포트 80, 10초 후 시작, 5초 간격, 실패 3회
- Readiness Probe: HTTP GET `/ready`, 포트 80, 5초 후 시작, 3초 간격, 실패 2회

<details><summary>풀이 확인</summary>

**풀이:**

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: probe-pod
spec:
  containers:
    - name: nginx
      image: nginx:1.25
      ports:
        - containerPort: 80
      livenessProbe:
        httpGet:
          path: /healthz
          port: 80
        initialDelaySeconds: 10
        periodSeconds: 5
        failureThreshold: 3
      readinessProbe:
        httpGet:
          path: /ready
          port: 80
        initialDelaySeconds: 5
        periodSeconds: 3
        failureThreshold: 2
```

핵심: Liveness 실패 시 컨테이너가 재시작된다. Readiness 실패 시 Service endpoints에서 제외된다. initialDelaySeconds로 앱 시작 시간을 고려해야 한다.

</details>

---

### 문제 18. [Observability] Startup Probe 설정

시작에 최대 5분이 걸릴 수 있는 레거시 앱의 Pod를 생성하라.

- Pod 이름: `slow-start-pod`, 이미지: `my-legacy-app:1.0`
- Startup Probe: HTTP GET `/started`, 포트 8080, 10초 간격, 실패 30회
- Liveness Probe: HTTP GET `/healthz`, 포트 8080, 5초 간격, 실패 3회

<details><summary>풀이 확인</summary>

**풀이:**

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: slow-start-pod
spec:
  containers:
    - name: app
      image: my-legacy-app:1.0
      ports:
        - containerPort: 8080
      startupProbe:
        httpGet:
          path: /started
          port: 8080
        periodSeconds: 10
        failureThreshold: 30
      livenessProbe:
        httpGet:
          path: /healthz
          port: 8080
        periodSeconds: 5
        failureThreshold: 3
```

핵심: Startup Probe가 성공하기 전까지 Liveness Probe는 비활성화된다. `periodSeconds(10) * failureThreshold(30) = 300초(5분)`까지 시작을 기다린다.

</details>

---

### 문제 19. [Observability] 로그 분석

다음 작업을 수행하라.

1. `web` 네임스페이스에서 label `app=nginx`를 가진 Pod의 마지막 50줄 로그를 확인하라.
2. 해당 Pod에 여러 컨테이너가 있다면, `nginx` 컨테이너의 로그만 확인하라.
3. 이전에 비정상 종료된 컨테이너의 로그를 확인하라.

<details><summary>풀이 확인</summary>

**풀이:**

```bash
# 1. 마지막 50줄 로그
kubectl logs -l app=nginx -n web --tail=50

# 2. 특정 컨테이너 로그
POD=$(kubectl get pods -l app=nginx -n web -o jsonpath='{.items[0].metadata.name}')
kubectl logs $POD -c nginx -n web

# 3. 이전 컨테이너 로그
kubectl logs $POD -c nginx -n web --previous
```

핵심: `-l` 옵션으로 label selector를 사용할 수 있다. `--previous`는 이전에 종료된 컨테이너의 로그를 확인할 때 사용한다.

</details>

---

### 문제 20. [Observability] kubectl debug로 디버깅

`distroless-pod` Pod는 distroless 이미지를 사용하여 셸이 없다. 이 Pod를 디버깅하기 위해 ephemeral container를 추가하라.

- 디버그 이미지: `busybox:1.36`
- 대상 컨테이너: `app`

<details><summary>풀이 확인</summary>

**풀이:**

```bash
# ephemeral container 추가
kubectl debug -it distroless-pod --image=busybox:1.36 --target=app

# 디버그 컨테이너 내부에서 진단
# 프로세스 확인
ps aux
# 네트워크 확인
wget -qO- http://localhost:8080/healthz
# DNS 확인
nslookup kubernetes.default.svc.cluster.local
# 파일시스템 확인 (대상 컨테이너의 파일시스템이 보임)
ls /proc/1/root/
```

핵심: `--target` 옵션을 사용하면 대상 컨테이너의 프로세스 네임스페이스를 공유한다. distroless 이미지처럼 셸이 없는 컨테이너를 디버깅할 때 유용하다.

</details>

---

### 문제 21. [Observability] 리소스 사용량 확인

다음 작업을 수행하라.

1. `demo` 네임스페이스에서 CPU 사용량이 가장 높은 Pod를 확인하라.
2. 노드별 리소스 사용량을 확인하라.

<details><summary>풀이 확인</summary>

**풀이:**

```bash
# 1. CPU 기준 정렬
kubectl top pods -n demo --sort-by=cpu

# Memory 기준 정렬
kubectl top pods -n demo --sort-by=memory

# 2. 노드 리소스 확인
kubectl top nodes
```

핵심: `kubectl top` 명령은 metrics-server가 설치되어 있어야 동작한다. `--sort-by`로 cpu 또는 memory 기준 정렬이 가능하다.

</details>

---

### 문제 22. [Observability] 실패하는 Pod 디버깅

Pod `failing-pod`가 `CrashLoopBackOff` 상태이다. 원인을 분석하라.

<details><summary>풀이 확인</summary>

**풀이:**

```bash
# 1. Pod 상태 확인
kubectl get pod failing-pod

# 2. Pod 이벤트 및 상세 정보 확인
kubectl describe pod failing-pod

# 3. 컨테이너 로그 확인
kubectl logs failing-pod

# 4. 이전 크래시 로그 확인
kubectl logs failing-pod --previous

# 5. Pod YAML에서 설정 확인
kubectl get pod failing-pod -o yaml

# 일반적인 원인:
# - 이미지가 존재하지 않음 (ImagePullBackOff)
# - 명령어 오류 (잘못된 command/args)
# - 리소스 부족 (OOMKilled)
# - Probe 실패
# - 설정 오류 (ConfigMap/Secret 누락)
# - 권한 문제 (SecurityContext)
```

핵심: `describe`로 이벤트를 확인하고, `logs --previous`로 크래시 전 로그를 확인하는 것이 디버깅의 기본 순서이다.

</details>

---

## Application Environment, Configuration and Security

### 문제 23. [Config & Security] ConfigMap 생성 및 사용

1. 다음 ConfigMap을 생성하라.
   - 이름: `webapp-config`
   - 데이터: `APP_ENV=production`, `APP_PORT=8080`, `APP_LOG_LEVEL=warn`
2. 이 ConfigMap을 환경 변수로 사용하는 Pod `webapp`을 생성하라 (이미지: `nginx:1.25`).
   - `envFrom`으로 모든 값을 주입하라.

<details><summary>풀이 확인</summary>

**풀이:**

```bash
# ConfigMap 생성
kubectl create configmap webapp-config \
  --from-literal=APP_ENV=production \
  --from-literal=APP_PORT=8080 \
  --from-literal=APP_LOG_LEVEL=warn
```

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: webapp
spec:
  containers:
    - name: nginx
      image: nginx:1.25
      envFrom:
        - configMapRef:
            name: webapp-config
```

```bash
# 환경 변수 확인
kubectl exec webapp -- env | grep APP_
```

핵심: `envFrom`은 ConfigMap의 모든 key-value를 환경 변수로 주입한다. `prefix`를 지정하면 접두사를 추가할 수 있다.

</details>

---

### 문제 24. [Config & Security] Secret 생성 및 Volume 마운트

1. TLS Secret을 생성하라 (이름: `app-tls`, cert: `tls.crt`, key: `tls.key`).
2. 이 Secret을 `/etc/tls`에 읽기 전용으로 마운트하는 Pod를 생성하라.
   - Pod 이름: `tls-pod`, 이미지: `nginx:1.25`
   - 파일 권한: `0400`

<details><summary>풀이 확인</summary>

**풀이:**

```bash
# TLS Secret 생성 (인증서 파일이 있다고 가정)
kubectl create secret tls app-tls --cert=tls.crt --key=tls.key
```

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: tls-pod
spec:
  containers:
    - name: nginx
      image: nginx:1.25
      volumeMounts:
        - name: tls-vol
          mountPath: /etc/tls
          readOnly: true
  volumes:
    - name: tls-vol
      secret:
        secretName: app-tls
        defaultMode: 0400
```

핵심: `defaultMode`로 파일 권한을 설정한다. 0400은 소유자만 읽기 가능하다. Secret volume은 기본적으로 tmpfs에 마운트된다.

</details>

---

### 문제 25. [Config & Security] SecurityContext -- runAsNonRoot

다음 보안 설정이 적용된 Pod를 생성하라.

- Pod 이름: `secure-app`
- 이미지: `nginx:1.25`
- UID 1000, GID 3000으로 실행
- root 실행 금지
- 읽기 전용 루트 파일시스템
- 모든 capabilities 제거 후 `NET_BIND_SERVICE`만 추가
- `/tmp`에 emptyDir 마운트 (쓰기 가능하도록)

<details><summary>풀이 확인</summary>

**풀이:**

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: secure-app
spec:
  securityContext:
    runAsUser: 1000
    runAsGroup: 3000
    fsGroup: 3000
  containers:
    - name: nginx
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

핵심: nginx는 `/var/cache/nginx`와 `/var/run`에도 쓰기가 필요하므로 emptyDir을 마운트해야 한다. `capabilities.drop: ["ALL"]`로 모든 능력을 제거한 후 필요한 것만 추가하는 것이 보안 모범 사례이다.

</details>

---

### 문제 26. [Config & Security] ServiceAccount 생성 및 연결

1. 네임스페이스 `app`에 ServiceAccount `app-sa`를 생성하라.
2. 이 ServiceAccount를 사용하는 Pod를 생성하되, API 서버 토큰 자동 마운트를 비활성화하라.
   - Pod 이름: `sa-pod`, 이미지: `nginx:1.25`

<details><summary>풀이 확인</summary>

**풀이:**

```bash
kubectl create namespace app
kubectl create serviceaccount app-sa -n app
```

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: sa-pod
  namespace: app
spec:
  serviceAccountName: app-sa
  automountServiceAccountToken: false
  containers:
    - name: nginx
      image: nginx:1.25
```

```bash
# 확인
kubectl get pod sa-pod -n app -o jsonpath='{.spec.serviceAccountName}'
# API 토큰이 마운트되지 않았는지 확인
kubectl exec sa-pod -n app -- ls /var/run/secrets/kubernetes.io/serviceaccount/ 2>&1
```

핵심: `automountServiceAccountToken: false`를 설정하면 `/var/run/secrets/kubernetes.io/serviceaccount/`에 토큰이 마운트되지 않는다. API 서버에 접근할 필요가 없는 Pod에 적용하면 보안이 강화된다.

</details>

---

### 문제 27. [Config & Security] Resource Requests/Limits 및 QoS

다음 세 가지 QoS 클래스를 가진 Pod를 각각 생성하라.

1. Guaranteed: `qos-guaranteed` (cpu requests=limits=200m, memory requests=limits=256Mi)
2. Burstable: `qos-burstable` (cpu requests=100m, memory requests=128Mi, limits 없음)
3. BestEffort: `qos-besteffort` (requests/limits 없음)

<details><summary>풀이 확인</summary>

**풀이:**

```yaml
# Guaranteed
apiVersion: v1
kind: Pod
metadata:
  name: qos-guaranteed
spec:
  containers:
    - name: app
      image: nginx:1.25
      resources:
        requests:
          cpu: 200m
          memory: 256Mi
        limits:
          cpu: 200m
          memory: 256Mi
---
# Burstable
apiVersion: v1
kind: Pod
metadata:
  name: qos-burstable
spec:
  containers:
    - name: app
      image: nginx:1.25
      resources:
        requests:
          cpu: 100m
          memory: 128Mi
---
# BestEffort
apiVersion: v1
kind: Pod
metadata:
  name: qos-besteffort
spec:
  containers:
    - name: app
      image: nginx:1.25
```

```bash
# QoS 클래스 확인
kubectl get pod qos-guaranteed -o jsonpath='{.status.qosClass}'
kubectl get pod qos-burstable -o jsonpath='{.status.qosClass}'
kubectl get pod qos-besteffort -o jsonpath='{.status.qosClass}'
```

핵심: Guaranteed는 requests == limits이어야 한다. BestEffort는 리소스 설정이 전혀 없어야 한다. 나머지는 Burstable이다. 노드 리소스 부족 시 BestEffort -> Burstable -> Guaranteed 순서로 축출된다.

</details>

---

### 문제 28. [Config & Security] LimitRange 생성

네임스페이스 `restricted`에 다음 LimitRange를 생성하라.

- 컨테이너 기본 limits: cpu=500m, memory=512Mi
- 컨테이너 기본 requests: cpu=100m, memory=128Mi
- 컨테이너 최대 limits: cpu=1, memory=1Gi
- 컨테이너 최소 requests: cpu=50m, memory=64Mi

<details><summary>풀이 확인</summary>

**풀이:**

```bash
kubectl create namespace restricted
```

```yaml
apiVersion: v1
kind: LimitRange
metadata:
  name: default-limits
  namespace: restricted
spec:
  limits:
    - type: Container
      default:
        cpu: 500m
        memory: 512Mi
      defaultRequest:
        cpu: 100m
        memory: 128Mi
      max:
        cpu: "1"
        memory: 1Gi
      min:
        cpu: 50m
        memory: 64Mi
```

```bash
# 확인
kubectl describe limitrange default-limits -n restricted

# LimitRange가 적용된 Pod 생성 테스트
kubectl run test-lr --image=nginx:1.25 -n restricted
kubectl get pod test-lr -n restricted -o yaml | grep -A 10 resources
```

핵심: LimitRange는 리소스를 지정하지 않은 컨테이너에 기본값을 자동으로 적용한다. min/max를 벗어나는 리소스를 요청하면 Pod 생성이 거부된다.

</details>

---

### 문제 29. [Config & Security] ResourceQuota 생성

네임스페이스 `team-a`에 다음 ResourceQuota를 생성하라.

- CPU requests 총합: 4, CPU limits 총합: 8
- Memory requests 총합: 4Gi, Memory limits 총합: 8Gi
- 최대 Pod 수: 20
- 최대 ConfigMap 수: 10, 최대 Secret 수: 10

<details><summary>풀이 확인</summary>

**풀이:**

```bash
kubectl create namespace team-a
```

```yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: team-a-quota
  namespace: team-a
spec:
  hard:
    requests.cpu: "4"
    limits.cpu: "8"
    requests.memory: 4Gi
    limits.memory: 8Gi
    pods: "20"
    configmaps: "10"
    secrets: "10"
```

```bash
# 사용량 확인
kubectl describe resourcequota team-a-quota -n team-a
```

핵심: ResourceQuota가 설정되면 해당 네임스페이스의 모든 Pod에 resource requests/limits가 필수이다. LimitRange와 함께 사용하면 기본값이 자동 적용되므로 편리하다.

</details>

---

### 문제 30. [Config & Security] ConfigMap을 환경 변수의 개별 key로 사용

ConfigMap `db-config`에서 `DB_HOST`와 `DB_PORT` key만 선택하여 환경 변수로 주입하되, 환경 변수 이름을 `DATABASE_HOST`와 `DATABASE_PORT`로 변경하라.

- Pod 이름: `selective-env-pod`, 이미지: `nginx:1.25`

<details><summary>풀이 확인</summary>

**풀이:**

```bash
# ConfigMap 생성
kubectl create configmap db-config \
  --from-literal=DB_HOST=postgres.default.svc.cluster.local \
  --from-literal=DB_PORT=5432 \
  --from-literal=DB_NAME=myapp \
  --from-literal=DB_MAX_CONN=100
```

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: selective-env-pod
spec:
  containers:
    - name: app
      image: nginx:1.25
      env:
        - name: DATABASE_HOST
          valueFrom:
            configMapKeyRef:
              name: db-config
              key: DB_HOST
        - name: DATABASE_PORT
          valueFrom:
            configMapKeyRef:
              name: db-config
              key: DB_PORT
```

핵심: `configMapKeyRef`를 사용하면 특정 key만 선택적으로 환경 변수에 매핑할 수 있다. `name` 필드에 원하는 환경 변수 이름을 지정하면 된다.

</details>

---

### 문제 31. [Config & Security] 환경 변수에서 Pod 정보 참조 (Downward API)

Pod의 이름, 네임스페이스, 노드 이름, Pod IP를 환경 변수로 주입하라.

- Pod 이름: `downward-pod`, 이미지: `busybox:1.36`
- 명령: `env` 실행 후 1시간 대기

<details><summary>풀이 확인</summary>

**풀이:**

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: downward-pod
spec:
  containers:
    - name: app
      image: busybox:1.36
      command: ["sh", "-c", "env && sleep 3600"]
      env:
        - name: POD_NAME
          valueFrom:
            fieldRef:
              fieldPath: metadata.name
        - name: POD_NAMESPACE
          valueFrom:
            fieldRef:
              fieldPath: metadata.namespace
        - name: NODE_NAME
          valueFrom:
            fieldRef:
              fieldPath: spec.nodeName
        - name: POD_IP
          valueFrom:
            fieldRef:
              fieldPath: status.podIP
        - name: CPU_REQUEST
          valueFrom:
            resourceFieldRef:
              containerName: app
              resource: requests.cpu
```

핵심: `fieldRef`는 Pod의 메타데이터를, `resourceFieldRef`는 컨테이너의 리소스 정보를 환경 변수로 주입한다. 이것을 Downward API라 한다.

</details>

---

### 문제 32. [Config & Security] Immutable ConfigMap/Secret

변경 불가능한 ConfigMap과 Secret을 생성하라. 생성 후 값 변경이 가능한지 확인하라.

<details><summary>풀이 확인</summary>

**풀이:**

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: immutable-config
data:
  APP_MODE: production
immutable: true
---
apiVersion: v1
kind: Secret
metadata:
  name: immutable-secret
type: Opaque
stringData:
  api-key: "super-secret-key"
immutable: true
```

```bash
# 적용
kubectl apply -f immutable.yaml

# 변경 시도 (실패해야 함)
kubectl edit configmap immutable-config
# Error: "immutable" field is immutable

# 삭제 후 재생성만 가능
kubectl delete configmap immutable-config
```

핵심: `immutable: true`를 설정하면 생성 후 data를 변경할 수 없다. 변경하려면 삭제 후 재생성해야 한다. 대규모 클러스터에서 API 서버 부하를 줄이는 효과가 있다.

</details>

---

## Services and Networking

### 문제 33. [Networking] Service 생성 -- ClusterIP, NodePort

Deployment `backend`에 대해 다음 Service를 생성하라.

1. ClusterIP Service: `backend-internal` (포트 80 -> 대상 포트 8080)
2. NodePort Service: `backend-external` (포트 80 -> 대상 포트 8080, nodePort: 30088)

<details><summary>풀이 확인</summary>

**풀이:**

```bash
# ClusterIP
kubectl expose deployment backend --name=backend-internal \
  --port=80 --target-port=8080 --type=ClusterIP

# NodePort
kubectl expose deployment backend --name=backend-external \
  --port=80 --target-port=8080 --type=NodePort \
  --dry-run=client -o yaml > np-svc.yaml
```

NodePort를 지정하려면 YAML을 수정해야 한다:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: backend-external
spec:
  type: NodePort
  selector:
    app: backend
  ports:
    - port: 80
      targetPort: 8080
      nodePort: 30088
      protocol: TCP
```

```bash
kubectl apply -f np-svc.yaml

# 확인
kubectl get svc backend-internal backend-external
```

핵심: `kubectl expose`로 빠르게 Service를 생성할 수 있다. nodePort를 지정하려면 YAML을 직접 수정해야 한다.

</details>

---

### 문제 34. [Networking] Ingress -- Path-based Routing

다음 Ingress를 생성하라.

- 이름: `app-ingress`
- 호스트: `myapp.example.com`
- `/api` -> `api-svc:8080` (Prefix)
- `/web` -> `web-svc:80` (Prefix)
- IngressClass: `nginx`

<details><summary>풀이 확인</summary>

**풀이:**

```bash
kubectl create ingress app-ingress \
  --rule="myapp.example.com/api=api-svc:8080" \
  --rule="myapp.example.com/web=web-svc:80" \
  --class=nginx \
  --dry-run=client -o yaml > ingress.yaml
```

또는 YAML:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: app-ingress
spec:
  ingressClassName: nginx
  rules:
    - host: myapp.example.com
      http:
        paths:
          - path: /api
            pathType: Prefix
            backend:
              service:
                name: api-svc
                port:
                  number: 8080
          - path: /web
            pathType: Prefix
            backend:
              service:
                name: web-svc
                port:
                  number: 80
```

핵심: `pathType: Prefix`는 `/api`로 시작하는 모든 경로를 매칭한다. `Exact`는 정확히 `/api`만 매칭한다.

</details>

---

### 문제 35. [Networking] Ingress -- TLS 설정

문제 34의 Ingress에 TLS를 추가하라.

- Secret `myapp-tls`를 사용한다.
- `myapp.example.com` 호스트에 TLS를 적용한다.

<details><summary>풀이 확인</summary>

**풀이:**

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: app-ingress
spec:
  ingressClassName: nginx
  tls:
    - hosts:
        - myapp.example.com
      secretName: myapp-tls
  rules:
    - host: myapp.example.com
      http:
        paths:
          - path: /api
            pathType: Prefix
            backend:
              service:
                name: api-svc
                port:
                  number: 8080
          - path: /web
            pathType: Prefix
            backend:
              service:
                name: web-svc
                port:
                  number: 80
```

```bash
# TLS Secret 생성 (인증서 파일 필요)
kubectl create secret tls myapp-tls --cert=tls.crt --key=tls.key
```

핵심: `tls` 섹션에 `hosts`와 `secretName`을 지정한다. Secret은 `kubernetes.io/tls` 유형이어야 하며 `tls.crt`와 `tls.key`를 포함해야 한다.

</details>

---

### 문제 36. [Networking] NetworkPolicy -- Default Deny + 특정 허용

네임스페이스 `production`에 다음 NetworkPolicy를 생성하라.

1. 모든 ingress/egress 트래픽을 차단하는 default deny 정책
2. `app=frontend` Pod에서 `app=backend` Pod의 포트 8080으로의 ingress만 허용
3. `app=backend` Pod에서 DNS(UDP 53)와 `app=database` Pod의 포트 5432로의 egress만 허용

<details><summary>풀이 확인</summary>

**풀이:**

```yaml
# 1. Default Deny (Ingress + Egress)
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
  namespace: production
spec:
  podSelector: {}
  policyTypes:
    - Ingress
    - Egress
---
# 2. Frontend -> Backend 허용
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-frontend-to-backend
  namespace: production
spec:
  podSelector:
    matchLabels:
      app: backend
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: frontend
      ports:
        - protocol: TCP
          port: 8080
---
# 3. Backend -> DNS + Database 허용
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: backend-egress
  namespace: production
spec:
  podSelector:
    matchLabels:
      app: backend
  policyTypes:
    - Egress
  egress:
    - to: []
      ports:
        - protocol: UDP
          port: 53
        - protocol: TCP
          port: 53
    - to:
        - podSelector:
            matchLabels:
              app: database
      ports:
        - protocol: TCP
          port: 5432
```

핵심: Default deny를 먼저 적용한 후 필요한 트래픽만 허용하는 것이 보안 모범 사례이다. DNS egress를 허용하지 않으면 서비스 이름 해석이 불가능하므로 반드시 포함해야 한다.

</details>

---

### 문제 37. [Networking] NetworkPolicy -- 네임스페이스 간 통신

`monitoring` 네임스페이스의 Pod에서 `production` 네임스페이스의 모든 Pod의 메트릭 포트(9090)에 접근할 수 있도록 NetworkPolicy를 생성하라.

<details><summary>풀이 확인</summary>

**풀이:**

```bash
# monitoring 네임스페이스에 label 추가 (필요 시)
kubectl label namespace monitoring name=monitoring
```

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-monitoring-metrics
  namespace: production
spec:
  podSelector: {}
  policyTypes:
    - Ingress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              name: monitoring
      ports:
        - protocol: TCP
          port: 9090
```

핵심: `namespaceSelector`로 특정 네임스페이스의 Pod를 선택한다. 네임스페이스에 label이 없으면 먼저 label을 추가해야 한다. `podSelector`와 `namespaceSelector`를 같은 항목에 넣으면 AND 조건이 된다.

</details>

---

### 문제 38. [Networking] DNS 테스트

busybox Pod를 생성하여 다음 DNS 조회를 수행하라.

1. `default` 네임스페이스의 `kubernetes` Service DNS 조회
2. `kube-system` 네임스페이스의 `kube-dns` Service DNS 조회
3. 현재 Pod의 `/etc/resolv.conf` 확인

<details><summary>풀이 확인</summary>

**풀이:**

```bash
# 임시 busybox Pod 생성 및 DNS 테스트
kubectl run dns-test --image=busybox:1.36 --rm -it --restart=Never -- sh -c '
echo "=== 1. kubernetes Service ==="
nslookup kubernetes.default.svc.cluster.local

echo "=== 2. kube-dns Service ==="
nslookup kube-dns.kube-system.svc.cluster.local

echo "=== 3. resolv.conf ==="
cat /etc/resolv.conf
'
```

핵심: Service DNS 형식은 `<service>.<namespace>.svc.cluster.local`이다. 같은 네임스페이스에서는 `<service>`만으로 접근 가능하다. `--rm`을 사용하면 Pod가 종료 후 자동 삭제된다.

</details>

---

### 문제 39. [Networking] Headless Service와 StatefulSet

Headless Service와 StatefulSet을 생성하고, 각 Pod의 고유 DNS 이름을 확인하라.

- Headless Service 이름: `web-headless`
- StatefulSet 이름: `web`, replicas: 3, 이미지: `nginx:1.25`

<details><summary>풀이 확인</summary>

**풀이:**

```yaml
apiVersion: v1
kind: Service
metadata:
  name: web-headless
spec:
  clusterIP: None
  selector:
    app: web
  ports:
    - port: 80
      targetPort: 80
---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: web
spec:
  serviceName: web-headless
  replicas: 3
  selector:
    matchLabels:
      app: web
  template:
    metadata:
      labels:
        app: web
    spec:
      containers:
        - name: nginx
          image: nginx:1.25
          ports:
            - containerPort: 80
```

```bash
# 적용
kubectl apply -f statefulset.yaml

# 각 Pod의 DNS 확인
kubectl run dns-test --image=busybox:1.36 --rm -it --restart=Never -- sh -c '
nslookup web-0.web-headless.default.svc.cluster.local
nslookup web-1.web-headless.default.svc.cluster.local
nslookup web-2.web-headless.default.svc.cluster.local
'
```

핵심: StatefulSet의 `serviceName`은 Headless Service의 이름과 일치해야 한다. 각 Pod는 `<pod-name>.<service-name>.<namespace>.svc.cluster.local` 형식의 고유 DNS 이름을 가진다.

</details>

---

### 문제 40. [Networking] Service 엔드포인트 확인 및 트래픽 테스트

다음 작업을 수행하라.

1. Deployment `web-app` (이미지: `nginx:1.25`, replicas: 3)을 생성하라.
2. ClusterIP Service `web-svc`를 생성하라 (포트 80).
3. Service의 Endpoints를 확인하라.
4. 임시 Pod에서 Service로 요청을 보내 응답을 확인하라.

<details><summary>풀이 확인</summary>

**풀이:**

```bash
# 1. Deployment 생성
kubectl create deployment web-app --image=nginx:1.25 --replicas=3

# 2. Service 생성
kubectl expose deployment web-app --name=web-svc --port=80 --target-port=80

# 3. Endpoints 확인
kubectl get endpoints web-svc
kubectl describe endpoints web-svc

# 또는
kubectl get ep web-svc -o yaml

# 4. 트래픽 테스트
kubectl run curl-test --image=busybox:1.36 --rm -it --restart=Never -- \
  wget -qO- http://web-svc

# 여러 번 요청하여 로드밸런싱 확인
kubectl run curl-test --image=busybox:1.36 --rm -it --restart=Never -- sh -c '
for i in $(seq 1 10); do
  wget -qO- http://web-svc 2>/dev/null | head -1
done
'
```

핵심: `kubectl get endpoints`로 Service에 등록된 Pod IP 목록을 확인할 수 있다. Pod가 Ready 상태가 아니면 Endpoints에서 제외된다.

</details>
