# CKAD 실전 실습 예제 모음

> 시험에서 자주 출제되는 유형별 YAML 매니페스트와 kubectl 명령어를 정리한 문서이다.
> `--dry-run=client -o yaml`로 빠르게 기본 구조를 생성한 뒤 수정하는 것이 효율적이다.

---

## 1. Dockerfile 멀티스테이지 빌드

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

---

## 2. Multi-container Pod

### Init Container 예제

DB가 준비될 때까지 대기하는 init container이다.

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

### Sidecar Logging 예제

메인 앱이 파일에 로그를 쓰고, sidecar가 해당 로그를 stdout으로 출력하는 패턴이다.

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

### Adapter 패턴 예제

로그 형식을 변환하는 adapter 컨테이너이다.

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

---

## 3. Probe (Health Check)

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

---

## 4. ConfigMap

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

---

## 5. Secret

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

---

## 6. SecurityContext

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

### Capabilities 확인 명령

```bash
# 컨테이너 내부에서 capabilities 확인
kubectl exec secure-pod -- cat /proc/1/status | grep Cap

# Pod의 securityContext 확인
kubectl get pod secure-pod -o jsonpath='{.spec.containers[0].securityContext}'
```

---

## 7. Deployment -- 생성, 업데이트, 롤백

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

### Deployment 스케일링

```bash
kubectl scale deployment/nginx-app --replicas=5
```

---

## 8. Service

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

---

## 9. Ingress

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

---

## 10. NetworkPolicy

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

> 주의: `from` 배열의 각 항목은 OR 관계이다. 하나의 항목 안에 여러 selector를 넣으면 AND 관계가 된다. 이 차이를 정확히 이해해야 한다.

---

## 11. Helm

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

---

## 12. Kustomize

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
