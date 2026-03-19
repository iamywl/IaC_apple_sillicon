# CKAD 실습 가이드 -- tart-infra 활용

> tart-infra 프로젝트의 실제 인프라 구성을 활용하여 CKAD 시험 영역별 실습을 진행하는 가이드이다.
> 4개 클러스터(platform, dev, staging, prod) 중 **dev 클러스터**의 demo 네임스페이스를 주로 활용한다.

---

## 인프라 개요

| 클러스터 | 용도 | 주요 구성 |
|---------|------|----------|
| platform | 공통 인프라 | Prometheus + Grafana (monitoring ns) |
| dev | 개발/실습 | Istio + demo 앱 (demo ns) |
| staging | 스테이징 | 프로덕션 사전 검증 |
| prod | 프로덕션 | 운영 환경 |

### dev 클러스터 demo 네임스페이스 앱 구성

| 앱 | 서비스 유형 | 비고 |
|---|-----------|------|
| nginx-web | NodePort 30080 | HPA 3->10 (CPU 50%) |
| httpbin v1/v2 | ClusterIP | Canary 80/20, HPA 2->6 (CPU 50%) |
| redis | ClusterIP | 인메모리 캐시 |
| postgres | ClusterIP | 관계형 DB |
| rabbitmq | ClusterIP | 메시지 브로커 |
| keycloak | NodePort 30880 | IAM/SSO |

---

## 1. Application Design and Build 실습

> 관련 CKAD 시험 도메인: **Application Design and Build (20%)**

### 실습 1-1. Multi-container Pod 관찰 -- Istio Sidecar

demo 네임스페이스에는 Istio sidecar injection이 활성화되어 있다. 모든 Pod에 `istio-proxy` 사이드카 컨테이너가 자동 주입된다.

```bash
# dev 클러스터 kubeconfig 설정
export KUBECONFIG=kubeconfig/dev-kubeconfig

# demo 네임스페이스 Pod 목록 확인 -- READY 열에서 컨테이너 수 확인
kubectl get pods -n demo

# 특정 Pod의 컨테이너 이름 목록 확인
kubectl get pods -n demo -o jsonpath='{range .items[*]}{.metadata.name}{": "}{.spec.containers[*].name}{"\n"}{end}'

# 첫 번째 Pod의 컨테이너 상세 확인
kubectl get pods -n demo -o jsonpath='{.items[0].spec.containers[*].name}'
```

**관찰 포인트:**

- 각 Pod의 READY 열이 `2/2`로 표시되는 것은 메인 컨테이너 + istio-proxy 사이드카가 있기 때문이다.
- Istio sidecar는 대표적인 Sidecar Container 패턴의 실제 구현 사례이다.
- sidecar가 앱 트래픽을 가로채서 mTLS 암호화, 트래픽 라우팅, 메트릭 수집 등을 수행한다.

**CKAD 연결:** Multi-container Pod 패턴 중 Sidecar 패턴을 실제로 관찰할 수 있다.

### 실습 1-2. Init Container 추가 실습

demo 네임스페이스에 init container를 가진 Pod를 직접 생성해 본다.

```bash
# postgres가 준비될 때까지 대기하는 init container가 있는 Pod 생성
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: v1
kind: Pod
metadata:
  name: init-test
spec:
  initContainers:
    - name: wait-for-postgres
      image: busybox:1.36
      command:
        - sh
        - -c
        - |
          until nslookup postgres.demo.svc.cluster.local; do
            echo "Waiting for postgres..."
            sleep 2
          done
          echo "postgres is ready!"
  containers:
    - name: app
      image: busybox:1.36
      command: ["sh", "-c", "echo 'App started after postgres is ready' && sleep 3600"]
EOF

# init container 상태 확인
kubectl get pod init-test -n demo
kubectl describe pod init-test -n demo | grep -A 20 "Init Containers"

# init container 로그 확인
kubectl logs init-test -n demo -c wait-for-postgres

# 정리
kubectl delete pod init-test -n demo
```

**CKAD 연결:** Init Container의 실행 순서와 용도를 실제로 체험할 수 있다.

### 실습 1-3. Volume 확인

demo 앱에서 사용하는 Volume 유형을 확인한다.

```bash
# Pod의 volume 구성 확인
kubectl get pods -n demo -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{range .spec.volumes[*]}  - {.name}: {end}{"\n"}{end}'

# 특정 Pod의 전체 YAML에서 volumes 섹션 확인
NGINX_POD=$(kubectl get pods -n demo -l app=nginx-web -o jsonpath='{.items[0].metadata.name}')
kubectl get pod $NGINX_POD -n demo -o yaml | grep -A 30 "volumes:"

# Secret volume 확인 (Istio 인증서 등)
kubectl get pod $NGINX_POD -n demo -o yaml | grep -B 2 -A 5 "secret"
```

**CKAD 연결:** emptyDir, secret, configMap volume의 실제 사용 사례를 확인할 수 있다.

### 실습 1-4. Job 생성 및 관찰

일회성 배치 작업을 Job으로 생성하고 완료 동작을 관찰한다.

```bash
# postgres DB에 초기 데이터를 삽입하는 Job 생성
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: batch/v1
kind: Job
metadata:
  name: db-init-job
spec:
  completions: 1
  parallelism: 1
  backoffLimit: 3
  ttlSecondsAfterFinished: 120
  template:
    spec:
      restartPolicy: OnFailure
      initContainers:
        - name: wait-for-db
          image: busybox:1.36
          command: ["sh", "-c", "until nslookup postgres.demo.svc.cluster.local; do sleep 2; done"]
      containers:
        - name: db-init
          image: busybox:1.36
          command:
            - sh
            - -c
            - |
              echo "DB 초기화 작업 시작"
              echo "테이블 생성 시뮬레이션..."
              sleep 5
              echo "초기 데이터 삽입 완료"
          env:
            - name: DB_HOST
              value: postgres.demo.svc.cluster.local
            - name: DB_PORT
              value: "5432"
EOF

# Job 상태 관찰
kubectl get job db-init-job -n demo -w

# Job Pod 로그 확인
kubectl logs -l job-name=db-init-job -n demo

# Job 완료 후 Pod 상태 확인 (Completed)
kubectl get pods -n demo -l job-name=db-init-job

# 정리
kubectl delete job db-init-job -n demo
```

**병렬 Job 실습:**

```bash
# 병렬로 실행되는 Job -- 5개 작업을 2개씩 병렬 처리
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: batch/v1
kind: Job
metadata:
  name: parallel-job
spec:
  completions: 5
  parallelism: 2
  backoffLimit: 2
  template:
    spec:
      restartPolicy: OnFailure
      containers:
        - name: worker
          image: busybox:1.36
          command: ["sh", "-c", "echo Worker $JOB_COMPLETION_INDEX started; sleep 3; echo done"]
EOF

# 병렬 실행 관찰
kubectl get pods -n demo -l job-name=parallel-job -w

# 정리
kubectl delete job parallel-job -n demo
```

**CKAD 연결:** Job의 completions, parallelism, backoffLimit, restartPolicy 설정이 시험에 자주 출제된다.

### 실습 1-5. CronJob 생성 및 관리

주기적인 작업을 CronJob으로 생성하고 스케줄 관리를 실습한다.

```bash
# 5분마다 redis 상태를 확인하는 CronJob 생성
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: batch/v1
kind: CronJob
metadata:
  name: redis-health-check
spec:
  schedule: "*/5 * * * *"
  concurrencyPolicy: Forbid
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 1
  startingDeadlineSeconds: 60
  jobTemplate:
    spec:
      backoffLimit: 1
      template:
        spec:
          restartPolicy: OnFailure
          containers:
            - name: checker
              image: busybox:1.36
              command:
                - sh
                - -c
                - |
                  echo "Redis 상태 확인: $(date)"
                  if nslookup redis.demo.svc.cluster.local > /dev/null 2>&1; then
                    echo "Redis DNS 확인 성공"
                  else
                    echo "Redis DNS 확인 실패"
                    exit 1
                  fi
EOF

# CronJob 확인
kubectl get cronjob -n demo
kubectl describe cronjob redis-health-check -n demo

# 수동으로 즉시 Job 트리거
kubectl create job --from=cronjob/redis-health-check manual-health-check -n demo

# Job 실행 확인
kubectl get jobs -n demo
kubectl logs -l job-name=manual-health-check -n demo

# CronJob 일시 중지
kubectl patch cronjob redis-health-check -n demo -p '{"spec":{"suspend":true}}'
kubectl get cronjob redis-health-check -n demo

# CronJob 재개
kubectl patch cronjob redis-health-check -n demo -p '{"spec":{"suspend":false}}'

# 정리
kubectl delete cronjob redis-health-check -n demo
kubectl delete job manual-health-check -n demo
```

**CKAD 연결:** CronJob의 schedule(cron 표현식), concurrencyPolicy(Allow/Forbid/Replace), 히스토리 보관 수 설정이 시험에 출제된다.

### 실습 1-6. Ambassador 패턴 구현

nginx-web 앞에 Ambassador 컨테이너를 배치하여 요청을 프록시하는 패턴을 실습한다.

```bash
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: v1
kind: Pod
metadata:
  name: ambassador-pattern
  labels:
    app: ambassador-demo
spec:
  containers:
    - name: main-app
      image: busybox:1.36
      command: ["sh", "-c", "while true; do wget -qO- http://localhost:9090/get 2>/dev/null | head -5; sleep 10; done"]
    - name: ambassador
      image: nginx:1.25-alpine
      ports:
        - containerPort: 9090
      volumeMounts:
        - name: nginx-conf
          mountPath: /etc/nginx/conf.d
  volumes:
    - name: nginx-conf
      configMap:
        name: ambassador-nginx-conf
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: ambassador-nginx-conf
data:
  default.conf: |
    server {
      listen 9090;
      location / {
        proxy_pass http://httpbin.demo.svc.cluster.local:8080;
      }
    }
EOF

# 패턴 동작 확인
kubectl get pod ambassador-pattern -n demo
kubectl logs ambassador-pattern -n demo -c main-app
kubectl logs ambassador-pattern -n demo -c ambassador

# 정리
kubectl delete pod ambassador-pattern -n demo
kubectl delete configmap ambassador-nginx-conf -n demo
```

**CKAD 연결:** Ambassador 패턴은 Multi-container Pod 패턴 중 하나로 시험에 출제될 수 있다.

### 실습 1-7. Adapter 패턴 구현

로그 형식을 변환하는 Adapter 컨테이너 패턴을 실습한다.

```bash
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: v1
kind: Pod
metadata:
  name: adapter-pattern
  labels:
    app: adapter-demo
spec:
  containers:
    - name: log-producer
      image: busybox:1.36
      command:
        - sh
        - -c
        - |
          while true; do
            echo "$(date +%s) ERROR app_error count=1 service=nginx"
            echo "$(date +%s) INFO request_processed latency=12ms service=nginx"
            sleep 5
          done
      volumeMounts:
        - name: log-vol
          mountPath: /var/log/app
    - name: log-adapter
      image: busybox:1.36
      command:
        - sh
        - -c
        - |
          tail -f /var/log/app/app.log 2>/dev/null | while read line; do
            echo "{\"timestamp\":\"$(date -Iseconds)\", \"raw\":\"$line\"}"
          done
      volumeMounts:
        - name: log-vol
          mountPath: /var/log/app
  volumes:
    - name: log-vol
      emptyDir: {}
EOF

kubectl logs adapter-pattern -n demo -c log-adapter --tail=10
kubectl delete pod adapter-pattern -n demo
```

**CKAD 연결:** Adapter 패턴은 공유 볼륨을 통해 컨테이너 간 데이터를 주고받는 구현 방식을 이해하게 한다.

---

## 2. Application Deployment 실습

> 관련 CKAD 시험 도메인: **Application Deployment (20%)**

### 실습 2-1. Canary 배포 관찰 -- httpbin v1/v2

httpbin은 v1(80%)과 v2(20%)로 canary 배포가 구성되어 있다. Istio VirtualService로 트래픽 가중치를 제어한다.

```bash
# VirtualService 확인 -- weight 필드에서 트래픽 비율 확인
kubectl get virtualservice -n demo -o yaml

# httpbin v1, v2 Deployment 확인
kubectl get deployments -n demo -l app=httpbin
kubectl get pods -n demo -l app=httpbin --show-labels

# DestinationRule 확인 -- subset 정의 (v1, v2)
kubectl get destinationrule -n demo -o yaml

# 트래픽 분배 테스트 (demo ns 내 임시 Pod에서)
kubectl run curl-test --image=busybox:1.36 --rm -it --restart=Never -n demo -- sh -c '
for i in $(seq 1 20); do
  wget -qO- http://httpbin:8080/headers 2>/dev/null | head -1
done
'
```

**관찰 포인트:**

- VirtualService의 `weight: 80` (v1)과 `weight: 20` (v2)으로 정밀한 트래픽 분배가 이루어진다.
- Kubernetes 네이티브 canary(replica 비율 방식)와 달리 replica 수와 무관하게 트래픽 비율을 제어할 수 있다.

**CKAD 연결:** Canary 배포의 개념과 구현 방식을 실제로 관찰할 수 있다.

### 실습 2-2. Rolling Update 실습

nginx-web Deployment의 이미지를 업데이트하고 롤아웃 과정을 관찰한다.

```bash
# 현재 이미지 확인
kubectl get deployment nginx-web -n demo -o jsonpath='{.spec.template.spec.containers[0].image}'

# Rolling Update 전략 확인
kubectl get deployment nginx-web -n demo -o jsonpath='{.spec.strategy}'

# 이미지 업데이트 (실습 후 원복 필요)
kubectl set image deployment/nginx-web nginx=nginx:1.25-alpine -n demo

# 롤아웃 상태 관찰
kubectl rollout status deployment/nginx-web -n demo

# 롤아웃 히스토리 확인
kubectl rollout history deployment/nginx-web -n demo

# 원복 (롤백)
kubectl rollout undo deployment/nginx-web -n demo
kubectl rollout status deployment/nginx-web -n demo
```

**CKAD 연결:** Rolling Update의 maxSurge/maxUnavailable 동작과 rollback 명령을 실습할 수 있다.

### 실습 2-3. Helm Release 확인

dev 클러스터에 Helm으로 설치된 릴리스를 확인한다.

```bash
# 모든 네임스페이스의 Helm 릴리스 목록
helm list -A --kubeconfig kubeconfig/dev-kubeconfig

# 특정 릴리스 상태 확인
helm status <release-name> -n <namespace> --kubeconfig kubeconfig/dev-kubeconfig

# 릴리스에 적용된 values 확인
helm get values <release-name> -n <namespace> --kubeconfig kubeconfig/dev-kubeconfig

# 릴리스 히스토리 확인
helm history <release-name> -n <namespace> --kubeconfig kubeconfig/dev-kubeconfig
```

**CKAD 연결:** Helm의 install, list, status, values, history 명령어를 실제 릴리스로 실습할 수 있다.

### 실습 2-4. HPA 관찰

nginx-web과 httpbin에 설정된 HPA를 확인한다.

```bash
# HPA 목록 확인
kubectl get hpa -n demo

# HPA 상세 확인
kubectl describe hpa -n demo

# 현재 스케일링 상태 관찰
kubectl get hpa -n demo -w
```

**관찰 포인트:**

- nginx-web: minReplicas=3, maxReplicas=10, 목표 CPU=50%
- httpbin: minReplicas=2, maxReplicas=6, 목표 CPU=50%
- TARGETS 열에서 현재 CPU 사용률과 목표값을 비교할 수 있다.

**CKAD 연결:** HPA의 스케일링 메트릭과 동작 원리를 실제로 관찰할 수 있다.

### 실습 2-5. Blue-Green 배포 실습

Kubernetes Service의 selector를 전환하여 Blue-Green 배포를 직접 구현한다.

```bash
# Blue 버전 Deployment 생성
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: webapp-blue
spec:
  replicas: 2
  selector:
    matchLabels:
      app: webapp
      version: blue
  template:
    metadata:
      labels:
        app: webapp
        version: blue
    spec:
      containers:
        - name: webapp
          image: nginx:1.24-alpine
          ports:
            - containerPort: 80
          env:
            - name: VERSION
              value: "blue"
          resources:
            requests:
              cpu: 50m
              memory: 64Mi
            limits:
              cpu: 100m
              memory: 128Mi
---
apiVersion: v1
kind: Service
metadata:
  name: webapp-svc
spec:
  selector:
    app: webapp
    version: blue
  ports:
    - port: 80
      targetPort: 80
EOF

# Green 버전 Deployment 생성 (새 버전)
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: webapp-green
spec:
  replicas: 2
  selector:
    matchLabels:
      app: webapp
      version: green
  template:
    metadata:
      labels:
        app: webapp
        version: green
    spec:
      containers:
        - name: webapp
          image: nginx:1.25-alpine
          ports:
            - containerPort: 80
          env:
            - name: VERSION
              value: "green"
          resources:
            requests:
              cpu: 50m
              memory: 64Mi
            limits:
              cpu: 100m
              memory: 128Mi
EOF

# Green 배포 준비 확인
kubectl get pods -n demo -l app=webapp
kubectl get deployment webapp-green -n demo

# Service selector를 Green으로 전환 (트래픽 스위칭)
kubectl patch service webapp-svc -n demo -p '{"spec":{"selector":{"version":"green"}}}'

# 전환 확인
kubectl get endpoints webapp-svc -n demo
kubectl get service webapp-svc -n demo -o jsonpath='{.spec.selector}'

# 문제 발생 시 Blue로 즉시 롤백
# kubectl patch service webapp-svc -n demo -p '{"spec":{"selector":{"version":"blue"}}}'

# 정리
kubectl delete deployment webapp-blue webapp-green -n demo
kubectl delete service webapp-svc -n demo
```

**CKAD 연결:** Blue-Green 배포 시 Service selector 전환 방식과 downtime-zero 전환 전략을 이해할 수 있다.

### 실습 2-6. Canary 가중치 직접 조정

Istio VirtualService의 canary 가중치를 단계적으로 조정하며 점진적 배포를 실습한다.

```bash
# 현재 VirtualService 가중치 확인 (v1:80, v2:20)
kubectl get virtualservice httpbin -n demo -o yaml

# 가중치를 v1:60, v2:40으로 조정
kubectl patch virtualservice httpbin -n demo --type='json' -p='[
  {"op": "replace", "path": "/spec/http/0/route/0/weight", "value": 60},
  {"op": "replace", "path": "/spec/http/0/route/1/weight", "value": 40}
]'

# 조정 확인
kubectl get virtualservice httpbin -n demo -o jsonpath='{.spec.http[0].route[*].weight}'

# 트래픽 분배 테스트
kubectl run traffic-test --image=busybox:1.36 --rm -it --restart=Never -n demo -- sh -c '
V1=0; V2=0
for i in $(seq 1 20); do
  RESULT=$(wget -qO- http://httpbin:8080/headers 2>/dev/null | grep -c "v2" || echo 0)
  if [ "$RESULT" -gt 0 ]; then V2=$((V2+1)); else V1=$((V1+1)); fi
done
echo "v1 응답: $V1 / v2 응답: $V2"
'

# v2로 완전 전환 (v1:0, v2:100)
kubectl patch virtualservice httpbin -n demo --type='json' -p='[
  {"op": "replace", "path": "/spec/http/0/route/0/weight", "value": 0},
  {"op": "replace", "path": "/spec/http/0/route/1/weight", "value": 100}
]'

# 원복 (v1:80, v2:20)
kubectl patch virtualservice httpbin -n demo --type='json' -p='[
  {"op": "replace", "path": "/spec/http/0/route/0/weight", "value": 80},
  {"op": "replace", "path": "/spec/http/0/route/1/weight", "value": 20}
]'
```

**CKAD 연결:** Canary 배포의 단계적 트래픽 전환 절차와 검증 방법을 실습할 수 있다.

### 실습 2-7. Kustomize Overlay 실습

Kustomize를 사용하여 환경별 Deployment 구성을 관리한다.

```bash
# Kustomize 디렉토리 구조 생성
mkdir -p /tmp/kustomize-demo/{base,overlays/dev,overlays/staging}

# Base 구성 생성
cat <<'EOF' > /tmp/kustomize-demo/base/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: sample-app
spec:
  replicas: 1
  selector:
    matchLabels:
      app: sample-app
  template:
    metadata:
      labels:
        app: sample-app
    spec:
      containers:
        - name: app
          image: nginx:1.25-alpine
          resources:
            requests:
              cpu: 50m
              memory: 64Mi
            limits:
              cpu: 100m
              memory: 128Mi
EOF

cat <<'EOF' > /tmp/kustomize-demo/base/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - deployment.yaml
EOF

# Dev overlay -- replica 2, 이미지 태그 변경
cat <<'EOF' > /tmp/kustomize-demo/overlays/dev/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
bases:
  - ../../base
namePrefix: dev-
namespace: demo
replicas:
  - name: sample-app
    count: 2
images:
  - name: nginx
    newTag: "1.25-alpine"
commonLabels:
  env: dev
EOF

# Staging overlay -- replica 3, 리소스 증가
cat <<'EOF' > /tmp/kustomize-demo/overlays/staging/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
bases:
  - ../../base
namePrefix: staging-
namespace: demo
replicas:
  - name: sample-app
    count: 3
commonLabels:
  env: staging
patches:
  - patch: |-
      - op: replace
        path: /spec/template/spec/containers/0/resources/requests/cpu
        value: 100m
      - op: replace
        path: /spec/template/spec/containers/0/resources/limits/cpu
        value: 200m
    target:
      kind: Deployment
      name: sample-app
EOF

# Kustomize 렌더링 미리보기
kubectl kustomize /tmp/kustomize-demo/overlays/dev
echo "---"
kubectl kustomize /tmp/kustomize-demo/overlays/staging

# Dev overlay 적용
kubectl apply -k /tmp/kustomize-demo/overlays/dev

# 확인
kubectl get deployment dev-sample-app -n demo

# 정리
kubectl delete -k /tmp/kustomize-demo/overlays/dev
rm -rf /tmp/kustomize-demo
```

**CKAD 연결:** Kustomize의 base/overlay 구조, namePrefix, replicas, images, patches 사용법이 시험에 출제된다.

### 실습 2-8. PodDisruptionBudget 확인 및 테스트

demo 네임스페이스에 설정된 PDB를 확인하고 Pod 중단 동작을 테스트한다.

```bash
# 기존 PDB 확인
kubectl get pdb -n demo
kubectl describe pdb -n demo

# 새 PDB 생성 (nginx-web은 항상 최소 2개 이상 유지)
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: nginx-web-pdb
spec:
  minAvailable: 2
  selector:
    matchLabels:
      app: nginx-web
EOF

# PDB 상태 확인
kubectl get pdb nginx-web-pdb -n demo
# ALLOWED DISRUPTIONS 값 확인 (minAvailable과 현재 replica 수의 차이)

# drain 시도 시 PDB가 Pod 중단을 보호하는지 테스트
# kubectl drain <node-name> --ignore-daemonsets --delete-emptydir-data (실제 노드 이름 필요)

# 정리
kubectl delete pdb nginx-web-pdb -n demo
```

**CKAD 연결:** PDB의 minAvailable/maxUnavailable 설정과 클러스터 유지보수 시 Pod 보호 메커니즘을 이해할 수 있다.

---

## 3. Application Observability and Maintenance 실습

> 관련 CKAD 시험 도메인: **Application Observability and Maintenance (15%)**

### 실습 3-1. Probe 확인

demo 앱에 설정된 readinessProbe와 livenessProbe를 확인한다.

```bash
# keycloak Pod의 Probe 확인
KEYCLOAK_POD=$(kubectl get pods -n demo -l app=keycloak -o jsonpath='{.items[0].metadata.name}')
kubectl describe pod $KEYCLOAK_POD -n demo | grep -A 10 "Liveness\|Readiness\|Startup"

# 모든 demo Pod의 Probe 설정 한 번에 확인
kubectl get pods -n demo -o jsonpath='{range .items[*]}Pod: {.metadata.name}{"\n"}  Liveness: {.spec.containers[0].livenessProbe.httpGet.path}{"\n"}  Readiness: {.spec.containers[0].readinessProbe.httpGet.path}{"\n"}{end}'

# nginx-web Pod의 Probe 상세 확인
NGINX_POD=$(kubectl get pods -n demo -l app=nginx-web -o jsonpath='{.items[0].metadata.name}')
kubectl get pod $NGINX_POD -n demo -o yaml | grep -A 15 "livenessProbe\|readinessProbe"
```

**관찰 포인트:**

- httpGet 방식의 Probe: path, port, initialDelaySeconds, periodSeconds 확인
- Liveness Probe 실패 시 컨테이너가 재시작되는 것을 Events에서 확인할 수 있다.
- Readiness Probe 실패 시 READY 상태가 변경되는 것을 관찰할 수 있다.

**CKAD 연결:** Probe의 설정 방법과 각 파라미터의 의미를 실제 앱으로 확인할 수 있다.

### 실습 3-2. 로그 확인

다양한 로그 조회 방법을 실습한다.

```bash
# nginx Pod 로그 확인
NGINX_POD=$(kubectl get pods -n demo -l app=nginx-web -o jsonpath='{.items[0].metadata.name}')
kubectl logs $NGINX_POD -n demo --tail=20

# Istio sidecar(istio-proxy) 로그 확인 -- multi-container Pod
kubectl logs $NGINX_POD -c istio-proxy -n demo --tail=20

# label로 여러 Pod 로그 확인
kubectl logs -l app=httpbin -n demo --tail=10

# 실시간 로그 스트리밍
kubectl logs $NGINX_POD -n demo -f

# 이전 크래시 로그 확인 (있는 경우)
kubectl logs $NGINX_POD -n demo --previous
```

**관찰 포인트:**

- `-c` 옵션으로 멀티 컨테이너 Pod에서 특정 컨테이너의 로그만 조회한다.
- istio-proxy 로그에서 HTTP 요청 메트릭과 mTLS 연결 정보를 확인할 수 있다.

**CKAD 연결:** 시험에서 로그 분석과 멀티 컨테이너 Pod 로그 조회가 자주 출제된다.

### 실습 3-3. 리소스 모니터링

kubectl top과 Grafana를 활용한 리소스 모니터링을 실습한다.

```bash
# Pod 리소스 사용량 확인
kubectl top pods -n demo

# CPU 기준 정렬
kubectl top pods -n demo --sort-by=cpu

# Memory 기준 정렬
kubectl top pods -n demo --sort-by=memory

# Node 리소스 확인
kubectl top nodes
```

**Grafana 대시보드 확인:**

platform 클러스터의 Grafana(`NodePort 30300`)에서 Kubernetes Pods 대시보드를 확인한다.

```bash
# platform 클러스터의 Grafana 접근
# 브라우저에서 http://<platform-node-ip>:30300 접속
# 대시보드 -> Kubernetes / Compute Resources / Pod 선택
```

**CKAD 연결:** `kubectl top` 명령어와 메트릭 기반 문제 해결이 시험에 출제된다.

### 실습 3-4. 디버깅 실습

Pod 내부 진입과 디버깅 명령을 실습한다.

```bash
# nginx Pod에 셸 접속
NGINX_POD=$(kubectl get pods -n demo -l app=nginx-web -o jsonpath='{.items[0].metadata.name}')
kubectl exec -it $NGINX_POD -n demo -- /bin/sh

# 단일 명령 실행
kubectl exec $NGINX_POD -n demo -- cat /etc/nginx/nginx.conf
kubectl exec $NGINX_POD -n demo -- curl -s localhost:80

# Istio sidecar 컨테이너에서 명령 실행
kubectl exec $NGINX_POD -c istio-proxy -n demo -- pilot-agent request GET /stats

# Pod 이벤트 확인 (문제 진단)
kubectl describe pod $NGINX_POD -n demo | tail -20
kubectl get events -n demo --sort-by=.metadata.creationTimestamp
```

**CKAD 연결:** `kubectl exec`와 `kubectl describe`를 사용한 문제 진단이 시험의 핵심 스킬이다.

### 실습 3-5. Startup Probe 실습

기동 시간이 긴 애플리케이션(keycloak 등)에 Startup Probe를 적용하는 방법을 실습한다.

```bash
# Startup Probe가 있는 느린 앱 시뮬레이션
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: v1
kind: Pod
metadata:
  name: slow-start-app
spec:
  containers:
    - name: app
      image: busybox:1.36
      command:
        - sh
        - -c
        - |
          echo "초기화 시작 -- 30초 소요"
          sleep 30
          echo "초기화 완료, 서버 시작"
          # 간단한 HTTP 서버 시뮬레이션
          while true; do
            echo -e "HTTP/1.1 200 OK\n\nOK" | nc -l -p 8080 2>/dev/null
          done
      ports:
        - containerPort: 8080
      startupProbe:
        tcpSocket:
          port: 8080
        initialDelaySeconds: 10
        periodSeconds: 5
        failureThreshold: 10   # 10 * 5s = 50초 대기 허용
      livenessProbe:
        tcpSocket:
          port: 8080
        periodSeconds: 10
        failureThreshold: 3
      readinessProbe:
        tcpSocket:
          port: 8080
        periodSeconds: 5
      resources:
        requests:
          cpu: 50m
          memory: 32Mi
        limits:
          cpu: 100m
          memory: 64Mi
EOF

# Startup Probe 동작 관찰
kubectl get pod slow-start-app -n demo -w

# Probe 상태 이벤트 확인
kubectl describe pod slow-start-app -n demo | grep -A 5 "Startup\|Liveness\|Readiness\|Events"

# 정리
kubectl delete pod slow-start-app -n demo
```

**CKAD 연결:** Startup Probe는 initialDelaySeconds의 한계를 극복하는 방법으로 시험에 출제된다. failureThreshold * periodSeconds가 최대 기동 허용 시간이 된다.

### 실습 3-6. Ephemeral Debug Container 실습

`kubectl debug`로 실행 중인 Pod에 임시 디버그 컨테이너를 주입하는 방법을 실습한다.

```bash
# 디버깅 대상 Pod 확인
NGINX_POD=$(kubectl get pods -n demo -l app=nginx-web -o jsonpath='{.items[0].metadata.name}')

# Ephemeral Container 주입 (busybox로 디버깅)
kubectl debug -it $NGINX_POD -n demo \
  --image=busybox:1.36 \
  --target=nginx \
  -- sh

# 주입 후 컨테이너 목록 확인 (ephemeralContainers 필드)
kubectl get pod $NGINX_POD -n demo -o jsonpath='{.spec.ephemeralContainers[*].name}'

# 디버그용 네트워크 도구가 있는 이미지로 주입
kubectl debug -it $NGINX_POD -n demo \
  --image=nicolaka/netshoot:latest \
  --target=nginx \
  -- sh -c "netstat -tlnp; curl -s http://localhost:80"
```

**distroless 이미지 디버깅 시나리오:**

```bash
# distroless 이미지는 sh 셸이 없어 직접 exec 불가
# Ephemeral Container로 같은 네트워크 네임스페이스 공유하여 디버깅
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: v1
kind: Pod
metadata:
  name: distroless-app
spec:
  containers:
    - name: app
      image: gcr.io/distroless/base-debian11
      command: ["/bin/sleep", "3600"]
      resources:
        requests:
          cpu: 50m
          memory: 32Mi
EOF

kubectl wait pod distroless-app -n demo --for=condition=Ready --timeout=60s

# Ephemeral Container로 디버깅 (셸 없는 이미지에 busybox 주입)
kubectl debug -it distroless-app -n demo \
  --image=busybox:1.36 \
  --target=app \
  -- sh -c "ps aux; ls /proc/1/fd"

kubectl delete pod distroless-app -n demo
```

**CKAD 연결:** Ephemeral Container는 프로덕션 Pod를 재시작 없이 디버깅하는 현대적 방법이다. 시험에서 `kubectl debug` 명령어 사용법이 출제된다.

### 실습 3-7. Probe 유형 비교 실습

HTTP, TCP, Exec, gRPC 등 다양한 Probe 유형을 비교한다.

```bash
# 다양한 Probe 유형을 가진 Pod 생성
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: v1
kind: Pod
metadata:
  name: probe-comparison
spec:
  containers:
    # HTTP Probe 예시 (nginx)
    - name: http-app
      image: nginx:1.25-alpine
      ports:
        - containerPort: 80
      livenessProbe:
        httpGet:
          path: /
          port: 80
          httpHeaders:
            - name: Custom-Header
              value: liveness-check
        initialDelaySeconds: 5
        periodSeconds: 10
        timeoutSeconds: 3
        successThreshold: 1
        failureThreshold: 3
      readinessProbe:
        httpGet:
          path: /
          port: 80
        initialDelaySeconds: 3
        periodSeconds: 5
      resources:
        requests:
          cpu: 50m
          memory: 32Mi
        limits:
          cpu: 100m
          memory: 64Mi
EOF

kubectl get pod probe-comparison -n demo
kubectl describe pod probe-comparison -n demo | grep -A 8 "Liveness\|Readiness"

# Exec Probe 예시
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: v1
kind: Pod
metadata:
  name: exec-probe-demo
spec:
  containers:
    - name: app
      image: busybox:1.36
      command: ["sh", "-c", "touch /tmp/healthy; sleep 30; rm /tmp/healthy; sleep 600"]
      livenessProbe:
        exec:
          command:
            - test
            - -f
            - /tmp/healthy
        initialDelaySeconds: 5
        periodSeconds: 5
      resources:
        requests:
          cpu: 50m
          memory: 32Mi
EOF

# 30초 후 파일이 삭제되면 Liveness Probe 실패하여 재시작됨을 관찰
kubectl get pod exec-probe-demo -n demo -w

# 정리
kubectl delete pod probe-comparison exec-probe-demo -n demo
```

**CKAD 연결:** Probe 유형(httpGet, tcpSocket, exec)별 사용 시나리오와 파라미터(timeoutSeconds, successThreshold, failureThreshold)를 이해해야 한다.

---

## 4. Application Environment, Configuration and Security 실습

> 관련 CKAD 시험 도메인: **Application Environment, Configuration and Security (25%)**

### 실습 4-1. ConfigMap/Secret 확인

dev 클러스터 demo 네임스페이스의 ConfigMap과 Secret을 확인한다.

```bash
# ConfigMap 목록
kubectl get configmap -n demo

# ConfigMap 상세 내용 확인
kubectl get configmap -n demo -o yaml

# Secret 목록
kubectl get secret -n demo

# Secret 상세 확인 (base64 디코딩)
kubectl get secret -n demo <secret-name> -o jsonpath='{.data}' | python3 -c "
import json, base64, sys
data = json.load(sys.stdin)
for k, v in data.items():
    print(f'{k}: {base64.b64decode(v).decode()}')"

# Secret 유형 확인
kubectl get secret -n demo -o custom-columns='NAME:.metadata.name,TYPE:.type'
```

**CKAD 연결:** ConfigMap과 Secret의 생성, 조회, 사용 방법은 시험의 핵심 영역이다.

### 실습 4-2. SecurityContext 확인

demo Pod에 설정된 SecurityContext를 확인한다.

```bash
# Pod의 securityContext 확인
kubectl get pods -n demo -o jsonpath='{range .items[*]}Pod: {.metadata.name}{"\n"}  PodSecurity: {.spec.securityContext}{"\n"}  ContainerSecurity: {.spec.containers[0].securityContext}{"\n"}{end}'

# 특정 Pod의 상세 SecurityContext
NGINX_POD=$(kubectl get pods -n demo -l app=nginx-web -o jsonpath='{.items[0].metadata.name}')
kubectl get pod $NGINX_POD -n demo -o yaml | grep -A 10 securityContext

# 컨테이너 내부에서 사용자 확인
kubectl exec $NGINX_POD -n demo -- id
kubectl exec $NGINX_POD -n demo -- cat /proc/1/status | grep -i cap
```

**CKAD 연결:** runAsUser, runAsNonRoot, readOnlyRootFilesystem, capabilities 설정이 시험에 자주 출제된다.

### 실습 4-3. Resource Requests/Limits 및 QoS 클래스 확인

demo 앱에 설정된 리소스 요청/제한을 확인한다.

```bash
# 모든 Pod의 리소스 설정 확인
kubectl get pods -n demo -o jsonpath='{range .items[*]}Pod: {.metadata.name}{"\n"}  Requests: CPU={.spec.containers[0].resources.requests.cpu}, Mem={.spec.containers[0].resources.requests.memory}{"\n"}  Limits: CPU={.spec.containers[0].resources.limits.cpu}, Mem={.spec.containers[0].resources.limits.memory}{"\n"}{end}'

# QoS 클래스 확인
kubectl get pods -n demo -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.status.qosClass}{"\n"}{end}'

# 특정 Pod의 상세 리소스 확인
kubectl describe pod -n demo $(kubectl get pods -n demo -o jsonpath='{.items[0].metadata.name}') | grep -A 5 "Limits\|Requests\|QoS"
```

**관찰 포인트:**

- requests == limits인 Pod는 Guaranteed QoS 클래스이다.
- requests만 설정된 Pod는 Burstable QoS 클래스이다.
- 리소스 설정이 없는 Pod는 BestEffort QoS 클래스이다.

**CKAD 연결:** Resource requests/limits 설정과 QoS 클래스 판별은 시험의 핵심 주제이다.

### 실습 4-4. ServiceAccount 확인

demo 네임스페이스의 ServiceAccount를 확인한다.

```bash
# ServiceAccount 목록
kubectl get sa -n demo

# Pod에 연결된 ServiceAccount 확인
kubectl get pods -n demo -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.serviceAccountName}{"\n"}{end}'

# ServiceAccount 상세 정보
kubectl describe sa -n demo
```

**CKAD 연결:** ServiceAccount 생성 및 Pod 연결, automountServiceAccountToken 설정이 시험에 출제된다.

### 실습 4-5. ResourceQuota 생성 및 테스트

네임스페이스 수준의 리소스 쿼터를 설정하고 동작을 확인한다.

```bash
# 새 테스트 네임스페이스 생성
kubectl create namespace quota-test

# ResourceQuota 생성
cat <<'EOF' | kubectl apply -f -
apiVersion: v1
kind: ResourceQuota
metadata:
  name: compute-quota
  namespace: quota-test
spec:
  hard:
    requests.cpu: "1"
    requests.memory: 512Mi
    limits.cpu: "2"
    limits.memory: 1Gi
    pods: "5"
    services: "3"
    persistentvolumeclaims: "2"
    secrets: "5"
    configmaps: "5"
EOF

# ResourceQuota 상태 확인
kubectl get resourcequota -n quota-test
kubectl describe resourcequota compute-quota -n quota-test

# 쿼터 내에서 Pod 생성
cat <<'EOF' | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: quota-pod-1
  namespace: quota-test
spec:
  containers:
    - name: app
      image: nginx:1.25-alpine
      resources:
        requests:
          cpu: 200m
          memory: 128Mi
        limits:
          cpu: 400m
          memory: 256Mi
EOF

# 쿼터 소비 현황 확인
kubectl describe resourcequota compute-quota -n quota-test

# 쿼터 초과 시도 (실패해야 함)
cat <<'EOF' | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: quota-exceed
  namespace: quota-test
spec:
  containers:
    - name: app
      image: nginx:1.25-alpine
      resources:
        requests:
          cpu: 900m    # 남은 쿼터 초과
          memory: 400Mi
        limits:
          cpu: "2"
          memory: 800Mi
EOF

# 정리
kubectl delete namespace quota-test
```

**CKAD 연결:** ResourceQuota는 멀티테넌트 환경에서 네임스페이스별 리소스 제한에 사용된다. 시험에서 쿼터 초과 원인 진단과 설정 변경이 출제된다.

### 실습 4-6. LimitRange 설정 실습

네임스페이스의 기본 리소스 제한과 최소/최대값을 LimitRange로 설정한다.

```bash
# LimitRange 테스트 네임스페이스
kubectl create namespace limitrange-test

# LimitRange 생성
cat <<'EOF' | kubectl apply -f -
apiVersion: v1
kind: LimitRange
metadata:
  name: resource-limits
  namespace: limitrange-test
spec:
  limits:
    - type: Container
      default:          # 지정 없을 때 기본 limits
        cpu: 200m
        memory: 256Mi
      defaultRequest:   # 지정 없을 때 기본 requests
        cpu: 100m
        memory: 128Mi
      min:              # 최솟값
        cpu: 50m
        memory: 64Mi
      max:              # 최댓값
        cpu: 500m
        memory: 512Mi
    - type: Pod
      max:
        cpu: "1"
        memory: 1Gi
    - type: PersistentVolumeClaim
      min:
        storage: 1Gi
      max:
        storage: 10Gi
EOF

# LimitRange 확인
kubectl describe limitrange resource-limits -n limitrange-test

# 리소스 지정 없이 Pod 생성 -- 기본값 자동 적용
cat <<'EOF' | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: no-resource-pod
  namespace: limitrange-test
spec:
  containers:
    - name: app
      image: nginx:1.25-alpine
EOF

# 자동 적용된 기본값 확인
kubectl get pod no-resource-pod -n limitrange-test -o jsonpath='{.spec.containers[0].resources}'

# 정리
kubectl delete namespace limitrange-test
```

**CKAD 연결:** LimitRange는 ResourceQuota와 함께 사용하며 개별 컨테이너의 리소스 범위를 제어한다. 기본값(default/defaultRequest) 자동 적용이 핵심이다.

### 실습 4-7. ConfigMap 다양한 활용 방식

ConfigMap을 환경 변수, 볼륨, 단일 키 등 다양한 방식으로 마운트한다.

```bash
# 다목적 ConfigMap 생성
kubectl create configmap app-config \
  --from-literal=LOG_LEVEL=debug \
  --from-literal=MAX_CONNECTIONS=100 \
  --from-literal=DB_HOST=postgres.demo.svc.cluster.local \
  --from-file=nginx.conf=/dev/stdin <<'NGINX_CONF'
server {
  listen 80;
  location /health { return 200 "OK"; }
}
NGINX_CONF
-n demo

# ConfigMap 확인
kubectl get configmap app-config -n demo -o yaml

# 다양한 방식으로 ConfigMap 사용하는 Pod
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: v1
kind: Pod
metadata:
  name: configmap-demo
spec:
  containers:
    - name: app
      image: busybox:1.36
      command: ["sh", "-c", "env | grep -E 'LOG|MAX|DB'; echo '---'; cat /config/nginx.conf; sleep 3600"]
      env:
        # 단일 키 참조
        - name: LOG_LEVEL
          valueFrom:
            configMapKeyRef:
              name: app-config
              key: LOG_LEVEL
        - name: MAX_CONNECTIONS
          valueFrom:
            configMapKeyRef:
              name: app-config
              key: MAX_CONNECTIONS
      envFrom:
        # 전체 ConfigMap을 환경 변수로
        - configMapRef:
            name: app-config
            optional: true
      volumeMounts:
        - name: config-vol
          mountPath: /config
  volumes:
    - name: config-vol
      configMap:
        name: app-config
        items:
          - key: nginx.conf
            path: nginx.conf
EOF

kubectl logs configmap-demo -n demo

# 정리
kubectl delete pod configmap-demo -n demo
kubectl delete configmap app-config -n demo
```

**CKAD 연결:** ConfigMap의 세 가지 사용 방식(envFrom, env.valueFrom, volume mount)과 optional 옵션을 모두 이해해야 한다.

### 실습 4-8. Secret 생성 및 다양한 활용

TLS Secret, docker-registry Secret 등 다양한 Secret 유형을 실습한다.

```bash
# Generic Secret 생성 방법들
# 1. 리터럴로 생성
kubectl create secret generic db-creds \
  --from-literal=username=admin \
  --from-literal=password=demo123 \
  -n demo

# 2. 파일로 생성
echo -n "demo123" > /tmp/db-password.txt
kubectl create secret generic db-password-file \
  --from-file=password=/tmp/db-password.txt \
  -n demo

# 3. YAML로 생성 (base64 인코딩 필요)
DB_USER=$(echo -n "admin" | base64)
DB_PASS=$(echo -n "demo123" | base64)
cat <<EOF | kubectl apply -n demo -f -
apiVersion: v1
kind: Secret
metadata:
  name: db-creds-yaml
type: Opaque
data:
  username: $DB_USER
  password: $DB_PASS
EOF

# Secret을 환경 변수와 볼륨으로 사용
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: v1
kind: Pod
metadata:
  name: secret-demo
spec:
  containers:
    - name: app
      image: busybox:1.36
      command: ["sh", "-c", "echo user=$DB_USER; cat /secrets/password; sleep 3600"]
      env:
        - name: DB_USER
          valueFrom:
            secretKeyRef:
              name: db-creds
              key: username
      volumeMounts:
        - name: secret-vol
          mountPath: /secrets
          readOnly: true
  volumes:
    - name: secret-vol
      secret:
        secretName: db-creds
        items:
          - key: password
            path: password
            mode: 0400
EOF

kubectl logs secret-demo -n demo

# 정리
kubectl delete pod secret-demo -n demo
kubectl delete secret db-creds db-password-file db-creds-yaml -n demo
rm -f /tmp/db-password.txt
```

**CKAD 연결:** Secret 생성 방법(명령형/선언형), 사용 방식(환경변수/볼륨), defaultMode/mode 권한 설정이 시험에 출제된다.

### 실습 4-9. Custom Resource Definition 관찰

Istio CRD를 통해 CRD의 구조와 활용 방식을 이해한다.

```bash
# 클러스터에 설치된 CRD 목록 확인
kubectl get crd | grep -E "istio|cilium"

# Istio 관련 CRD 확인
kubectl get crd | grep istio.io

# VirtualService CRD 스키마 확인
kubectl get crd virtualservices.networking.istio.io -o yaml | grep -A 30 "openAPIV3Schema"

# 실제 CRD 인스턴스 확인
kubectl get virtualservice -n demo
kubectl get destinationrule -n demo
kubectl get gateway -n demo
kubectl get peerauthentication -n demo

# CRD 목록과 API 그룹 확인
kubectl api-resources | grep -E "istio|cilium"

# 간단한 커스텀 CRD 생성 (학습용)
cat <<'EOF' | kubectl apply -f -
apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
metadata:
  name: appconfigs.demo.tart-infra.io
spec:
  group: demo.tart-infra.io
  versions:
    - name: v1
      served: true
      storage: true
      schema:
        openAPIV3Schema:
          type: object
          properties:
            spec:
              type: object
              properties:
                replicas:
                  type: integer
                  minimum: 1
                  maximum: 10
                image:
                  type: string
                environment:
                  type: string
                  enum: ["dev", "staging", "prod"]
  scope: Namespaced
  names:
    plural: appconfigs
    singular: appconfig
    kind: AppConfig
    shortNames:
      - ac
EOF

# CRD 등록 확인
kubectl get crd appconfigs.demo.tart-infra.io

# CR 인스턴스 생성
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: demo.tart-infra.io/v1
kind: AppConfig
metadata:
  name: nginx-app-config
spec:
  replicas: 3
  image: nginx:1.25-alpine
  environment: dev
EOF

kubectl get appconfig -n demo
kubectl describe appconfig nginx-app-config -n demo

# 정리
kubectl delete appconfig nginx-app-config -n demo
kubectl delete crd appconfigs.demo.tart-infra.io
```

**CKAD 연결:** CRD는 Kubernetes 확장 메커니즘의 핵심이다. 시험에서 CRD 인스턴스(CR) 생성 및 조회가 출제될 수 있다.

---

## 5. Services and Networking 실습

> 관련 CKAD 시험 도메인: **Services and Networking (20%)**

### 실습 5-1. Service 비교 -- ClusterIP vs NodePort

demo 네임스페이스의 Service 유형을 비교 분석한다.

```bash
# Service 목록 -- TYPE 열 확인
kubectl get svc -n demo

# 상세 비교
kubectl get svc -n demo -o custom-columns='NAME:.metadata.name,TYPE:.spec.type,CLUSTER-IP:.spec.clusterIP,PORT:.spec.ports[*].port,NODE-PORT:.spec.ports[*].nodePort,SELECTOR:.spec.selector'

# NodePort Service 확인
# nginx-web: NodePort 30080
# keycloak: NodePort 30880
kubectl get svc nginx-web -n demo -o yaml
kubectl get svc keycloak -n demo -o yaml

# Endpoints 확인
kubectl get endpoints -n demo
```

**관찰 포인트:**

- nginx-web(NodePort 30080): 외부에서 `<node-ip>:30080`으로 접근 가능하다.
- httpbin, redis, postgres 등은 ClusterIP로 클러스터 내부에서만 접근 가능하다.
- keycloak(NodePort 30880): 외부에서 `<node-ip>:30880`으로 접근 가능하다.

**CKAD 연결:** Service 유형별 차이와 사용 시나리오를 실제로 확인할 수 있다.

### 실습 5-2. NetworkPolicy 분석 -- CiliumNetworkPolicy

dev 클러스터에는 CiliumNetworkPolicy 11개가 적용되어 있다. L7 규칙(HTTP GET only)도 포함되어 있다.

```bash
# CiliumNetworkPolicy 목록 확인
kubectl get ciliumnetworkpolicy -n demo

# 각 정책 상세 확인
kubectl get ciliumnetworkpolicy -n demo -o yaml

# default-deny 정책 확인
kubectl get ciliumnetworkpolicy default-deny-ingress -n demo -o yaml
kubectl get ciliumnetworkpolicy default-deny-egress -n demo -o yaml

# L7 규칙 확인 (nginx -> httpbin GET only)
kubectl get ciliumnetworkpolicy -n demo -o yaml | grep -A 20 "http"
```

**L7 규칙 테스트:**

```bash
# nginx Pod에서 httpbin으로 GET 요청 (성공해야 함)
NGINX_POD=$(kubectl get pods -n demo -l app=nginx-web -o jsonpath='{.items[0].metadata.name}')
kubectl exec $NGINX_POD -n demo -- curl -s http://httpbin:8080/get

# nginx Pod에서 httpbin으로 POST 요청 (L7 정책에 의해 차단되어야 함)
kubectl exec $NGINX_POD -n demo -- curl -s -X POST http://httpbin:8080/post
```

**관찰 포인트:**

- Default deny ingress/egress 정책이 기본으로 적용되어 있다.
- 필요한 트래픽만 allow 규칙으로 허용하는 화이트리스트 방식이다.
- L7 규칙으로 HTTP 메서드 수준의 세밀한 제어가 가능하다 (CiliumNetworkPolicy 전용 기능).
- 표준 Kubernetes NetworkPolicy는 L3/L4까지만 지원한다.

**CKAD 연결:** NetworkPolicy의 default deny + allow 패턴, podSelector/namespaceSelector 사용법을 실제로 확인할 수 있다.

### 실습 5-3. DNS 테스트

클러스터 내부 DNS를 테스트한다.

```bash
# 임시 Pod로 DNS 조회 테스트
kubectl run dns-test --image=busybox:1.36 --rm -it --restart=Never -n demo -- sh -c '
echo "=== httpbin Service DNS ==="
nslookup httpbin.demo.svc.cluster.local

echo "=== postgres Service DNS ==="
nslookup postgres.demo.svc.cluster.local

echo "=== redis Service DNS ==="
nslookup redis.demo.svc.cluster.local

echo "=== 짧은 이름 (같은 네임스페이스) ==="
nslookup httpbin

echo "=== resolv.conf 확인 ==="
cat /etc/resolv.conf
'
```

**관찰 포인트:**

- 같은 네임스페이스에서는 `httpbin`만으로 접근 가능하다.
- 다른 네임스페이스의 서비스는 `<service>.<namespace>` 형식을 사용해야 한다.
- resolv.conf의 search 도메인에 `demo.svc.cluster.local`, `svc.cluster.local`, `cluster.local`이 포함되어 있어 짧은 이름으로도 해석이 가능하다.

**CKAD 연결:** Service DNS 형식과 네임스페이스 간 DNS 해석 규칙이 시험에 출제된다.

### 실습 5-4. Istio Gateway 및 mTLS 확인

Istio를 통한 외부 트래픽 라우팅과 mTLS 설정을 확인한다.

```bash
# Istio Gateway 확인
kubectl get gateway -n demo -o yaml

# PeerAuthentication 확인 (STRICT mTLS)
kubectl get peerauthentication -n demo -o yaml

# mTLS 동작 확인 -- istio-proxy 로그에서 TLS 정보 확인
NGINX_POD=$(kubectl get pods -n demo -l app=nginx-web -o jsonpath='{.items[0].metadata.name}')
kubectl logs $NGINX_POD -c istio-proxy -n demo --tail=10

# Circuit Breaker 설정 확인 (DestinationRule)
kubectl get destinationrule -n demo -o yaml
```

**관찰 포인트:**

- PeerAuthentication이 STRICT 모드이면 모든 Pod 간 통신이 mTLS로 암호화된다.
- DestinationRule의 `trafficPolicy.connectionPool`과 `outlierDetection`으로 circuit breaker가 구현되어 있다.
- Istio Gateway가 외부 트래픽의 진입점 역할을 한다.

**CKAD 연결:** Ingress 개념의 확장 이해에 도움이 된다. 표준 CKAD 시험에서는 Kubernetes Ingress가 출제되지만, Gateway 개념을 이해하면 더 깊은 이해가 가능하다.

### 실습 5-5. Ingress 생성 실습

Kubernetes 표준 Ingress를 직접 생성하고 라우팅 규칙을 설정한다.

```bash
# Ingress Controller 확인 (Istio Ingress Gateway 또는 nginx ingress)
kubectl get pods -n istio-system | grep ingress
kubectl get ingressclass

# 경로 기반 라우팅 Ingress 생성
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: demo-ingress
  annotations:
    nginx.ingress.kubernetes.io/rewrite-target: /
spec:
  ingressClassName: nginx
  rules:
    - host: demo.tart-infra.local
      http:
        paths:
          - path: /web
            pathType: Prefix
            backend:
              service:
                name: nginx-web
                port:
                  number: 80
          - path: /api
            pathType: Prefix
            backend:
              service:
                name: httpbin
                port:
                  number: 8080
          - path: /auth
            pathType: Prefix
            backend:
              service:
                name: keycloak
                port:
                  number: 8080
EOF

# Ingress 확인
kubectl get ingress -n demo
kubectl describe ingress demo-ingress -n demo

# TLS 설정이 있는 Ingress
# 먼저 TLS Secret 생성 (자가 서명 인증서)
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout /tmp/tls.key \
  -out /tmp/tls.crt \
  -subj "/CN=demo.tart-infra.local/O=tart-infra" 2>/dev/null

kubectl create secret tls demo-tls \
  --cert=/tmp/tls.crt \
  --key=/tmp/tls.key \
  -n demo

# TLS Ingress 생성
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: demo-ingress-tls
spec:
  ingressClassName: nginx
  tls:
    - hosts:
        - demo.tart-infra.local
      secretName: demo-tls
  rules:
    - host: demo.tart-infra.local
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: nginx-web
                port:
                  number: 80
EOF

kubectl describe ingress demo-ingress-tls -n demo

# 정리
kubectl delete ingress demo-ingress demo-ingress-tls -n demo
kubectl delete secret demo-tls -n demo
rm -f /tmp/tls.key /tmp/tls.crt
```

**CKAD 연결:** Ingress의 경로 기반 라우팅, 호스트 기반 라우팅, TLS 설정이 시험의 핵심 주제이다. pathType(Prefix/Exact/ImplementationSpecific)의 차이도 이해해야 한다.

### 실습 5-6. PersistentVolume 및 PVC 실습

StatefulSet 앱(postgres)의 PV/PVC를 확인하고 직접 PVC를 생성한다.

```bash
# 기존 PV/PVC 확인
kubectl get pv
kubectl get pvc -n demo

# postgres의 PVC 상세 확인
kubectl describe pvc -n demo | grep -A 10 "postgres\|Name\|Status\|Volume"

# StorageClass 확인
kubectl get storageclass

# 새 PVC 생성
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: app-data-pvc
spec:
  accessModes:
    - ReadWriteOnce
  storageClassName: local-path
  resources:
    requests:
      storage: 1Gi
EOF

# PVC 상태 확인 (Pending -> Bound)
kubectl get pvc app-data-pvc -n demo -w

# PVC를 사용하는 Pod 생성
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: v1
kind: Pod
metadata:
  name: pvc-demo
spec:
  containers:
    - name: app
      image: busybox:1.36
      command: ["sh", "-c", "echo 'persistent data' > /data/test.txt; cat /data/test.txt; sleep 3600"]
      volumeMounts:
        - name: app-data
          mountPath: /data
      resources:
        requests:
          cpu: 50m
          memory: 32Mi
  volumes:
    - name: app-data
      persistentVolumeClaim:
        claimName: app-data-pvc
EOF

kubectl exec pvc-demo -n demo -- cat /data/test.txt

# Pod 재시작 후에도 데이터 유지 확인
kubectl delete pod pvc-demo -n demo
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: v1
kind: Pod
metadata:
  name: pvc-demo-2
spec:
  containers:
    - name: app
      image: busybox:1.36
      command: ["sh", "-c", "cat /data/test.txt; sleep 3600"]
      volumeMounts:
        - name: app-data
          mountPath: /data
      resources:
        requests:
          cpu: 50m
          memory: 32Mi
  volumes:
    - name: app-data
      persistentVolumeClaim:
        claimName: app-data-pvc
EOF

kubectl exec pvc-demo-2 -n demo -- cat /data/test.txt

# 정리
kubectl delete pod pvc-demo-2 -n demo
kubectl delete pvc app-data-pvc -n demo
```

**CKAD 연결:** PVC의 accessModes(RWO/ROX/RWX), storageClassName, 볼륨 마운트, Pod 재생성 시 데이터 영속성 확인이 시험에 출제된다.

### 실습 5-7. NetworkPolicy 직접 생성

표준 Kubernetes NetworkPolicy를 생성하여 Pod 간 트래픽을 제어한다.

```bash
# 테스트 네임스페이스와 Pod 생성
kubectl create namespace netpol-test

cat <<'EOF' | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: frontend
  namespace: netpol-test
  labels:
    role: frontend
spec:
  containers:
    - name: app
      image: busybox:1.36
      command: ["sleep", "3600"]
      resources:
        requests:
          cpu: 50m
          memory: 32Mi
---
apiVersion: v1
kind: Pod
metadata:
  name: backend
  namespace: netpol-test
  labels:
    role: backend
spec:
  containers:
    - name: app
      image: nginx:1.25-alpine
      ports:
        - containerPort: 80
      resources:
        requests:
          cpu: 50m
          memory: 32Mi
---
apiVersion: v1
kind: Service
metadata:
  name: backend-svc
  namespace: netpol-test
spec:
  selector:
    role: backend
  ports:
    - port: 80
      targetPort: 80
EOF

# 정책 없이 frontend -> backend 통신 확인
kubectl exec frontend -n netpol-test -- wget -qO- http://backend-svc:80 --timeout=3

# Default-deny ingress 정책 적용
cat <<'EOF' | kubectl apply -f -
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-ingress
  namespace: netpol-test
spec:
  podSelector: {}
  policyTypes:
    - Ingress
EOF

# 정책 적용 후 통신 차단 확인 (실패해야 함)
kubectl exec frontend -n netpol-test -- wget -qO- http://backend-svc:80 --timeout=3

# frontend -> backend 허용 정책 추가
cat <<'EOF' | kubectl apply -f -
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-frontend-to-backend
  namespace: netpol-test
spec:
  podSelector:
    matchLabels:
      role: backend
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              role: frontend
      ports:
        - protocol: TCP
          port: 80
EOF

# 허용 정책 후 통신 재확인 (성공해야 함)
kubectl exec frontend -n netpol-test -- wget -qO- http://backend-svc:80 --timeout=3

# 정리
kubectl delete namespace netpol-test
```

**CKAD 연결:** NetworkPolicy의 default-deny + selective-allow 패턴, podSelector/namespaceSelector/ipBlock 조합, ingress/egress policyTypes 설정이 시험 핵심이다.

---

## 종합 실습 시나리오

아래 시나리오는 여러 도메인을 복합적으로 다루는 실습이다.

### 시나리오 A: 새로운 마이크로서비스 배포

1. **Design & Build**: init container로 DB 준비 대기 -> 메인 앱 시작
2. **Configuration**: ConfigMap으로 환경 설정 주입, Secret으로 DB 패스워드 관리
3. **Security**: SecurityContext 설정 (non-root, readOnly filesystem)
4. **Deployment**: Rolling Update 전략으로 배포, HPA 설정
5. **Observability**: Liveness/Readiness Probe 설정
6. **Networking**: Service 생성, NetworkPolicy로 접근 제어

```bash
# 1. ConfigMap & Secret 생성
kubectl create configmap new-app-config \
  --from-literal=DB_HOST=postgres.demo.svc.cluster.local \
  --from-literal=DB_PORT=5432 \
  --from-literal=APP_PORT=8080 \
  -n demo

kubectl create secret generic new-app-secret \
  --from-literal=DB_PASSWORD=mysecretpassword \
  -n demo

# 2. Deployment 생성 (init container + probes + securityContext + resources)
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: new-app
spec:
  replicas: 2
  selector:
    matchLabels:
      app: new-app
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  template:
    metadata:
      labels:
        app: new-app
    spec:
      initContainers:
        - name: wait-for-db
          image: busybox:1.36
          command: ["sh", "-c", "until nslookup postgres.demo.svc.cluster.local; do sleep 2; done"]
      containers:
        - name: app
          image: nginx:1.25
          ports:
            - containerPort: 8080
          envFrom:
            - configMapRef:
                name: new-app-config
          env:
            - name: DB_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: new-app-secret
                  key: DB_PASSWORD
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              cpu: 200m
              memory: 256Mi
          securityContext:
            runAsNonRoot: true
            runAsUser: 1000
            readOnlyRootFilesystem: true
            allowPrivilegeEscalation: false
          livenessProbe:
            httpGet:
              path: /
              port: 8080
            initialDelaySeconds: 10
            periodSeconds: 10
          readinessProbe:
            httpGet:
              path: /
              port: 8080
            initialDelaySeconds: 5
            periodSeconds: 5
          volumeMounts:
            - name: tmp
              mountPath: /tmp
      volumes:
        - name: tmp
          emptyDir: {}
EOF

# 3. Service 생성
kubectl expose deployment new-app --port=80 --target-port=8080 -n demo

# 4. NetworkPolicy 생성
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: new-app-policy
spec:
  podSelector:
    matchLabels:
      app: new-app
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: nginx-web
      ports:
        - protocol: TCP
          port: 8080
EOF

# 5. 확인
kubectl get all -n demo -l app=new-app
kubectl describe pod -n demo -l app=new-app | grep -A 5 "QoS\|Liveness\|Readiness"

# 정리
kubectl delete deployment new-app -n demo
kubectl delete svc new-app -n demo
kubectl delete networkpolicy new-app-policy -n demo
kubectl delete configmap new-app-config -n demo
kubectl delete secret new-app-secret -n demo
```

### 시나리오 B: 장애 대응 및 디버깅

```bash
# 1. Pod 상태 확인
kubectl get pods -n demo -o wide

# 2. 비정상 Pod 진단
kubectl describe pod <problem-pod> -n demo
kubectl logs <problem-pod> -n demo --previous

# 3. 리소스 사용량 확인
kubectl top pods -n demo --sort-by=cpu

# 4. Service Endpoints 확인 (Readiness Probe 실패 Pod가 제외되었는지)
kubectl get endpoints -n demo

# 5. NetworkPolicy 영향 확인
kubectl get ciliumnetworkpolicy -n demo

# 6. DNS 확인
kubectl run debug --image=busybox:1.36 --rm -it --restart=Never -n demo -- nslookup httpbin.demo.svc.cluster.local
```

### 시나리오 C: StatefulSet 앱 데이터 영속성 검증

postgres StatefulSet의 PVC와 데이터 영속성을 검증하고 장애 복구를 시뮬레이션한다.

```bash
# postgres StatefulSet 확인
kubectl get statefulset -n demo
kubectl describe statefulset postgres -n demo

# postgres PVC 확인
kubectl get pvc -n demo -l app=postgres

# postgres Pod에서 데이터 삽입
POSTGRES_POD=$(kubectl get pods -n demo -l app=postgres -o jsonpath='{.items[0].metadata.name}')
kubectl exec $POSTGRES_POD -n demo -- psql -U postgres -c "
  CREATE TABLE IF NOT EXISTS test_table (id SERIAL, value TEXT, created_at TIMESTAMP DEFAULT NOW());
  INSERT INTO test_table (value) VALUES ('persistence-test-$(date +%s)');
  SELECT * FROM test_table;
"

# Pod 강제 삭제 후 재생성 (StatefulSet이 자동 재생성)
kubectl delete pod $POSTGRES_POD -n demo
kubectl wait pod -n demo -l app=postgres --for=condition=Ready --timeout=120s

# 새 Pod에서 데이터 확인 (PVC로 데이터가 유지되어야 함)
NEW_POSTGRES_POD=$(kubectl get pods -n demo -l app=postgres -o jsonpath='{.items[0].metadata.name}')
kubectl exec $NEW_POSTGRES_POD -n demo -- psql -U postgres -c "SELECT * FROM test_table;"
```

### 시나리오 D: 전체 파이프라인 배포 시뮬레이션

Jenkins CI/CD 파이프라인과 ArgoCD를 활용한 GitOps 배포 흐름을 시뮬레이션한다.

```bash
# ArgoCD 접근 (platform 클러스터)
export KUBECONFIG=kubeconfig/platform-kubeconfig
kubectl get applications -n argocd
kubectl get applications -n argocd -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.status.sync.status}{"\t"}{.status.health.status}{"\n"}{end}'

# dev 클러스터에 수동 배포 후 sync 상태 확인
export KUBECONFIG=kubeconfig/dev-kubeconfig
kubectl get deployment -n demo

# 배포 후 ArgoCD sync 상태 비교
export KUBECONFIG=kubeconfig/platform-kubeconfig
kubectl get application -n argocd -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.status.operationState.phase}{"\n"}{end}'
```

---

## 모의 시험 시나리오

### 모의 시험 1: 기본 배포 (제한 시간: 30분)

> 아래 문제들은 실제 CKAD 시험 형식에 맞춰 작성되었다. 시간을 측정하며 풀어본다.

**문제 1-1** (5분): `practice` 네임스페이스에 다음 조건의 Pod를 생성하라.
- 이름: `web-server`
- 이미지: `nginx:1.25-alpine`
- 라벨: `tier=frontend`, `env=dev`
- 포트: 80 노출
- 리소스: requests cpu=100m,memory=128Mi / limits cpu=200m,memory=256Mi

```bash
# 풀이
kubectl create namespace practice 2>/dev/null || true
cat <<'EOF' | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: web-server
  namespace: practice
  labels:
    tier: frontend
    env: dev
spec:
  containers:
    - name: nginx
      image: nginx:1.25-alpine
      ports:
        - containerPort: 80
      resources:
        requests:
          cpu: 100m
          memory: 128Mi
        limits:
          cpu: 200m
          memory: 256Mi
EOF
kubectl get pod web-server -n practice
```

**문제 1-2** (5분): `practice` 네임스페이스에 `web-server` Pod를 노출하는 ClusterIP Service를 생성하라.
- 서비스 이름: `web-svc`
- 포트: 80 -> 컨테이너 80

```bash
# 풀이
kubectl expose pod web-server -n practice --name=web-svc --port=80 --target-port=80
kubectl get svc web-svc -n practice
kubectl get endpoints web-svc -n practice
```

**문제 1-3** (8분): 다음 조건의 Deployment를 `practice` 네임스페이스에 생성하라.
- 이름: `api-server`
- 이미지: `httpbin/httpbin:latest`
- replica: 3
- 전략: RollingUpdate, maxSurge=1, maxUnavailable=0
- Liveness Probe: httpGet /get 포트 8080, initialDelay=10s, period=15s
- Readiness Probe: httpGet /get 포트 8080, initialDelay=5s, period=10s

```bash
# 풀이
cat <<'EOF' | kubectl apply -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-server
  namespace: practice
spec:
  replicas: 3
  selector:
    matchLabels:
      app: api-server
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  template:
    metadata:
      labels:
        app: api-server
    spec:
      containers:
        - name: httpbin
          image: httpbin/httpbin:latest
          ports:
            - containerPort: 8080
          livenessProbe:
            httpGet:
              path: /get
              port: 8080
            initialDelaySeconds: 10
            periodSeconds: 15
          readinessProbe:
            httpGet:
              path: /get
              port: 8080
            initialDelaySeconds: 5
            periodSeconds: 10
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              cpu: 300m
              memory: 256Mi
EOF
kubectl rollout status deployment/api-server -n practice
```

**문제 1-4** (7분): `practice` 네임스페이스에 다음 조건의 ConfigMap과 Secret을 생성하고 Pod에 주입하라.
- ConfigMap `app-env`: APP_ENV=production, LOG_LEVEL=info
- Secret `db-secret`: DB_PASSWORD=supersecret
- Pod `configured-app` (busybox:1.36): 환경 변수로 ConfigMap 전체 주입 + Secret DB_PASSWORD 주입, `env` 명령 실행 후 종료

```bash
# 풀이
kubectl create configmap app-env \
  --from-literal=APP_ENV=production \
  --from-literal=LOG_LEVEL=info \
  -n practice

kubectl create secret generic db-secret \
  --from-literal=DB_PASSWORD=supersecret \
  -n practice

cat <<'EOF' | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: configured-app
  namespace: practice
spec:
  restartPolicy: Never
  containers:
    - name: app
      image: busybox:1.36
      command: ["env"]
      envFrom:
        - configMapRef:
            name: app-env
      env:
        - name: DB_PASSWORD
          valueFrom:
            secretKeyRef:
              name: db-secret
              key: DB_PASSWORD
EOF
kubectl logs configured-app -n practice | grep -E "APP_ENV|LOG_LEVEL|DB_PASSWORD"
```

**문제 1-5** (5분): `practice` 네임스페이스를 삭제하라.

```bash
kubectl delete namespace practice
```

---

### 모의 시험 2: 고급 설정 및 보안 (제한 시간: 35분)

**문제 2-1** (8분): `secure-ns` 네임스페이스에 다음 보안 조건의 Pod를 생성하라.
- 이름: `secure-pod`
- 이미지: `nginx:1.25-alpine`
- runAsNonRoot: true, runAsUser: 1000, runAsGroup: 3000
- readOnlyRootFilesystem: true
- allowPrivilegeEscalation: false
- capabilities: drop ALL
- /tmp 에 emptyDir 마운트 (readOnly filesystem 우회)

```bash
# 풀이
kubectl create namespace secure-ns

cat <<'EOF' | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: secure-pod
  namespace: secure-ns
spec:
  securityContext:
    runAsNonRoot: true
    runAsUser: 1000
    runAsGroup: 3000
  containers:
    - name: nginx
      image: nginx:1.25-alpine
      securityContext:
        readOnlyRootFilesystem: true
        allowPrivilegeEscalation: false
        capabilities:
          drop:
            - ALL
      volumeMounts:
        - name: tmp-dir
          mountPath: /tmp
        - name: var-run
          mountPath: /var/run
        - name: var-cache
          mountPath: /var/cache/nginx
      resources:
        requests:
          cpu: 50m
          memory: 64Mi
        limits:
          cpu: 100m
          memory: 128Mi
  volumes:
    - name: tmp-dir
      emptyDir: {}
    - name: var-run
      emptyDir: {}
    - name: var-cache
      emptyDir: {}
EOF

kubectl get pod secure-pod -n secure-ns
kubectl exec secure-pod -n secure-ns -- id
```

**문제 2-2** (8분): `secure-ns` 네임스페이스에 다음 조건의 NetworkPolicy를 생성하라.
- 이름: `allow-web-only`
- 대상: `app=backend` 라벨의 Pod
- Ingress 허용: `role=frontend` 라벨 Pod에서 TCP 8080만
- Egress 허용: kube-dns (UDP/TCP 53)만

```bash
# 풀이
cat <<'EOF' | kubectl apply -f -
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-web-only
  namespace: secure-ns
spec:
  podSelector:
    matchLabels:
      app: backend
  policyTypes:
    - Ingress
    - Egress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              role: frontend
      ports:
        - protocol: TCP
          port: 8080
  egress:
    - ports:
        - protocol: UDP
          port: 53
        - protocol: TCP
          port: 53
EOF

kubectl describe networkpolicy allow-web-only -n secure-ns
```

**문제 2-3** (7분): `secure-ns` 네임스페이스에 ResourceQuota를 생성하라.
- 이름: `ns-quota`
- CPU requests: 500m, CPU limits: 1
- Memory requests: 256Mi, Memory limits: 512Mi
- Pods 최대: 5

```bash
# 풀이
cat <<'EOF' | kubectl apply -f -
apiVersion: v1
kind: ResourceQuota
metadata:
  name: ns-quota
  namespace: secure-ns
spec:
  hard:
    requests.cpu: "500m"
    requests.memory: 256Mi
    limits.cpu: "1"
    limits.memory: 512Mi
    pods: "5"
EOF

kubectl describe resourcequota ns-quota -n secure-ns
```

**문제 2-4** (6분): `secure-ns` 네임스페이스에 ServiceAccount를 생성하고 Pod에 연결하라.
- ServiceAccount 이름: `app-sa`
- automountServiceAccountToken: false
- Pod 이름: `sa-pod`, 이미지: `busybox:1.36`, `sleep 3600` 실행

```bash
# 풀이
kubectl create serviceaccount app-sa -n secure-ns
kubectl patch serviceaccount app-sa -n secure-ns -p '{"automountServiceAccountToken": false}'

cat <<'EOF' | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: sa-pod
  namespace: secure-ns
spec:
  serviceAccountName: app-sa
  automountServiceAccountToken: false
  containers:
    - name: app
      image: busybox:1.36
      command: ["sleep", "3600"]
      resources:
        requests:
          cpu: 50m
          memory: 32Mi
        limits:
          cpu: 100m
          memory: 64Mi
EOF

kubectl get pod sa-pod -n secure-ns -o jsonpath='{.spec.serviceAccountName}'

# 정리
kubectl delete namespace secure-ns
```

---

### 모의 시험 3: 종합 실전 시나리오 (제한 시간: 45분)

> 실제 CKAD 시험과 유사한 복합 시나리오이다. tart-infra 환경의 dev 클러스터를 활용한다.

**시나리오 설명:** `production-sim` 네임스페이스에 3-tier 애플리케이션(frontend, backend, cache)을 배포한다.

**문제 3-1** (10분): Frontend Deployment 생성

```bash
export KUBECONFIG=kubeconfig/dev-kubeconfig
kubectl create namespace production-sim

# Frontend Deployment
cat <<'EOF' | kubectl apply -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: frontend
  namespace: production-sim
  annotations:
    deployment.kubernetes.io/revision: "1"
spec:
  replicas: 2
  selector:
    matchLabels:
      app: frontend
      tier: web
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  template:
    metadata:
      labels:
        app: frontend
        tier: web
    spec:
      containers:
        - name: nginx
          image: nginx:1.25-alpine
          ports:
            - containerPort: 80
          livenessProbe:
            httpGet:
              path: /
              port: 80
            initialDelaySeconds: 5
            periodSeconds: 10
            failureThreshold: 3
          readinessProbe:
            httpGet:
              path: /
              port: 80
            initialDelaySeconds: 3
            periodSeconds: 5
          startupProbe:
            httpGet:
              path: /
              port: 80
            failureThreshold: 6
            periodSeconds: 5
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              cpu: 200m
              memory: 256Mi
          volumeMounts:
            - name: nginx-config
              mountPath: /etc/nginx/conf.d
      volumes:
        - name: nginx-config
          configMap:
            name: frontend-config
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: frontend-config
  namespace: production-sim
data:
  default.conf: |
    server {
      listen 80;
      location / { root /usr/share/nginx/html; index index.html; }
      location /api { proxy_pass http://backend-svc:8080; }
      location /health { return 200 "healthy\n"; }
    }
---
apiVersion: v1
kind: Service
metadata:
  name: frontend-svc
  namespace: production-sim
spec:
  type: NodePort
  selector:
    app: frontend
  ports:
    - port: 80
      targetPort: 80
      nodePort: 30180
EOF

kubectl rollout status deployment/frontend -n production-sim
```

**문제 3-2** (10분): Backend Deployment 생성 (Secret 활용)

```bash
# Redis 연결 정보를 Secret으로 관리
kubectl create secret generic backend-secret \
  --from-literal=REDIS_PASSWORD=demo123 \
  --from-literal=DB_URL=postgres://demo:demo123@postgres.demo.svc.cluster.local:5432/demo \
  -n production-sim

# Backend Deployment
cat <<'EOF' | kubectl apply -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: backend
  namespace: production-sim
spec:
  replicas: 3
  selector:
    matchLabels:
      app: backend
      tier: api
  template:
    metadata:
      labels:
        app: backend
        tier: api
    spec:
      initContainers:
        - name: wait-for-cache
          image: busybox:1.36
          command:
            - sh
            - -c
            - |
              until nc -z redis-svc 6379 2>/dev/null; do
                echo "Waiting for Redis..."
                sleep 2
              done
              echo "Redis is ready!"
      containers:
        - name: api
          image: httpbin/httpbin:latest
          ports:
            - containerPort: 8080
          env:
            - name: REDIS_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: backend-secret
                  key: REDIS_PASSWORD
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: backend-secret
                  key: DB_URL
          livenessProbe:
            httpGet:
              path: /get
              port: 8080
            initialDelaySeconds: 15
            periodSeconds: 20
          readinessProbe:
            httpGet:
              path: /get
              port: 8080
            initialDelaySeconds: 10
            periodSeconds: 10
          resources:
            requests:
              cpu: 150m
              memory: 256Mi
            limits:
              cpu: 300m
              memory: 512Mi
          securityContext:
            allowPrivilegeEscalation: false
            runAsNonRoot: true
            runAsUser: 1000
---
apiVersion: v1
kind: Service
metadata:
  name: backend-svc
  namespace: production-sim
spec:
  selector:
    app: backend
  ports:
    - port: 8080
      targetPort: 8080
EOF
```

**문제 3-3** (8분): Redis Cache 배포

```bash
cat <<'EOF' | kubectl apply -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: cache
  namespace: production-sim
spec:
  replicas: 1
  selector:
    matchLabels:
      app: cache
      tier: data
  template:
    metadata:
      labels:
        app: cache
        tier: data
    spec:
      containers:
        - name: redis
          image: redis:7-alpine
          ports:
            - containerPort: 6379
          command: ["redis-server", "--requirepass", "$(REDIS_PASSWORD)"]
          env:
            - name: REDIS_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: backend-secret
                  key: REDIS_PASSWORD
          livenessProbe:
            exec:
              command: ["redis-cli", "ping"]
            initialDelaySeconds: 10
            periodSeconds: 5
          readinessProbe:
            exec:
              command: ["redis-cli", "ping"]
            initialDelaySeconds: 5
            periodSeconds: 5
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              cpu: 200m
              memory: 256Mi
          volumeMounts:
            - name: redis-data
              mountPath: /data
      volumes:
        - name: redis-data
          emptyDir: {}
---
apiVersion: v1
kind: Service
metadata:
  name: redis-svc
  namespace: production-sim
spec:
  selector:
    app: cache
  ports:
    - port: 6379
      targetPort: 6379
EOF
```

**문제 3-4** (7분): NetworkPolicy 설정

```bash
# Default deny all
cat <<'EOF' | kubectl apply -f -
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
  namespace: production-sim
spec:
  podSelector: {}
  policyTypes:
    - Ingress
    - Egress
---
# frontend -> backend 허용
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-frontend-to-backend
  namespace: production-sim
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
# backend -> redis 허용
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-backend-to-cache
  namespace: production-sim
spec:
  podSelector:
    matchLabels:
      app: cache
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: backend
      ports:
        - protocol: TCP
          port: 6379
---
# DNS egress 허용
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-dns-egress
  namespace: production-sim
spec:
  podSelector: {}
  policyTypes:
    - Egress
  egress:
    - ports:
        - protocol: UDP
          port: 53
        - protocol: TCP
          port: 53
EOF
```

**문제 3-5** (5분): HPA 및 PDB 설정

```bash
# Frontend HPA
cat <<'EOF' | kubectl apply -f -
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: frontend-hpa
  namespace: production-sim
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: frontend
  minReplicas: 2
  maxReplicas: 8
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 60
---
# Backend HPA
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: backend-hpa
  namespace: production-sim
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: backend
  minReplicas: 3
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
---
# PodDisruptionBudget
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: frontend-pdb
  namespace: production-sim
spec:
  minAvailable: 1
  selector:
    matchLabels:
      app: frontend
---
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: backend-pdb
  namespace: production-sim
spec:
  maxUnavailable: 1
  selector:
    matchLabels:
      app: backend
EOF

# 전체 상태 확인
kubectl get all -n production-sim
kubectl get hpa,pdb,networkpolicy -n production-sim

# 정리
kubectl delete namespace production-sim
```

---

## kubectl 고급 활용 실습

### kubectl 플러그인 및 유틸리티

```bash
# krew 플러그인 매니저 설치 확인
kubectl krew version

# 유용한 플러그인 목록
kubectl krew search

# ctx 플러그인 -- 컨텍스트 전환
kubectl krew install ctx
kubectl ctx  # 컨텍스트 목록
kubectl ctx dev-cluster  # 컨텍스트 전환

# ns 플러그인 -- 네임스페이스 전환
kubectl krew install ns
kubectl ns demo  # 기본 네임스페이스 전환

# stern -- 멀티 Pod 로그 스트리밍
# kubectl krew install stern
# kubectl stern -n demo nginx-web  # nginx-web Pod 실시간 로그

# resource-capacity 플러그인
kubectl krew install resource-capacity
kubectl resource-capacity --sort cpu.limit

# who-can 플러그인 -- RBAC 권한 확인
kubectl krew install who-can
kubectl who-can create pods -n demo
```

**유용한 kubectl 단축 명령:**

```bash
# 모든 리소스 한 번에 확인
kubectl get all -n demo

# 특정 노드의 Pod 목록
kubectl get pods -n demo -o wide --field-selector spec.nodeName=<node-name>

# 이벤트를 타임스탬프 순으로 확인
kubectl get events -n demo --sort-by='.lastTimestamp'

# jsonpath로 특정 필드 추출
kubectl get pods -n demo -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.status.phase}{"\n"}{end}'

# custom-columns로 원하는 열만 출력
kubectl get pods -n demo -o custom-columns='NAME:.metadata.name,STATUS:.status.phase,NODE:.spec.nodeName,IP:.status.podIP'

# dry-run으로 YAML 생성 (시험에서 매우 유용)
kubectl create deployment test-deploy --image=nginx:alpine --replicas=3 --dry-run=client -o yaml > /tmp/test-deploy.yaml
kubectl apply -f /tmp/test-deploy.yaml

# 명령형으로 빠르게 리소스 생성
kubectl run quickpod --image=busybox:1.36 --command -- sleep 3600 -n demo
kubectl expose pod quickpod --port=80 --target-port=80 -n demo
kubectl scale deployment nginx-web --replicas=5 -n demo
kubectl set image deployment/nginx-web nginx=nginx:1.26-alpine -n demo
```

### kubectl diff 활용

```bash
# 변경사항 미리 확인
cat <<'EOF' > /tmp/nginx-patch.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nginx-web
  namespace: demo
spec:
  replicas: 5
EOF

kubectl diff -f /tmp/nginx-patch.yaml
# 실제 적용 전에 변경될 내용 확인

rm -f /tmp/nginx-patch.yaml
```

---

## 참고: 클러스터 접근 방법

```bash
# dev 클러스터 접근
export KUBECONFIG=kubeconfig/dev-kubeconfig

# platform 클러스터 접근 (Prometheus/Grafana)
export KUBECONFIG=kubeconfig/platform-kubeconfig

# staging 클러스터 접근
export KUBECONFIG=kubeconfig/staging-kubeconfig

# prod 클러스터 접근
export KUBECONFIG=kubeconfig/prod-kubeconfig
```

---

## 실습 체크리스트

각 실습을 완료하면 체크한다.

### Domain 1: Application Design and Build (20%)

| 실습 | 관련 CKAD 주제 | 완료 |
|------|--------------|------|
| 1-1. Istio sidecar 관찰 | Multi-container Pod (Sidecar) | [ ] |
| 1-2. Init Container 생성 | Init Container | [ ] |
| 1-3. Volume 확인 | Volumes (emptyDir, secret, configMap) | [ ] |
| 1-4. Job 생성 및 병렬 Job | Job (completions, parallelism, backoffLimit) | [ ] |
| 1-5. CronJob 생성 및 관리 | CronJob (schedule, concurrencyPolicy) | [ ] |
| 1-6. Ambassador 패턴 | Multi-container Pod (Ambassador) | [ ] |
| 1-7. Adapter 패턴 | Multi-container Pod (Adapter) | [ ] |

### Domain 2: Application Deployment (20%)

| 실습 | 관련 CKAD 주제 | 완료 |
|------|--------------|------|
| 2-1. Canary 배포 관찰 | Canary Deployment (Istio) | [ ] |
| 2-2. Rolling Update/Rollback | Deployment Strategy | [ ] |
| 2-3. Helm Release 확인 | Helm (list, status, values) | [ ] |
| 2-4. HPA 관찰 | HorizontalPodAutoscaler | [ ] |
| 2-5. Blue-Green 배포 | Blue-Green Deployment | [ ] |
| 2-6. Canary 가중치 조정 | VirtualService weight patching | [ ] |
| 2-7. Kustomize Overlay | Kustomize (base/overlay, patches) | [ ] |
| 2-8. PodDisruptionBudget | PDB (minAvailable, maxUnavailable) | [ ] |

### Domain 3: Application Observability and Maintenance (15%)

| 실습 | 관련 CKAD 주제 | 완료 |
|------|--------------|------|
| 3-1. Probe 확인 | Liveness/Readiness Probe | [ ] |
| 3-2. 로그 확인 | kubectl logs (multi-container) | [ ] |
| 3-3. 리소스 모니터링 | kubectl top, Grafana | [ ] |
| 3-4. 디버깅 실습 | kubectl exec, describe, events | [ ] |
| 3-5. Startup Probe 실습 | Startup Probe (failureThreshold) | [ ] |
| 3-6. Ephemeral Debug Container | kubectl debug (ephemeral) | [ ] |
| 3-7. Probe 유형 비교 | httpGet, tcpSocket, exec Probe | [ ] |

### Domain 4: Application Environment, Configuration and Security (25%)

| 실습 | 관련 CKAD 주제 | 완료 |
|------|--------------|------|
| 4-1. ConfigMap/Secret 확인 | ConfigMap, Secret | [ ] |
| 4-2. SecurityContext 확인 | SecurityContext | [ ] |
| 4-3. Resource/QoS 확인 | Requests/Limits, QoS | [ ] |
| 4-4. ServiceAccount 확인 | ServiceAccount | [ ] |
| 4-5. ResourceQuota 생성 | ResourceQuota | [ ] |
| 4-6. LimitRange 설정 | LimitRange (default, min, max) | [ ] |
| 4-7. ConfigMap 다양한 활용 | envFrom, env.valueFrom, volume | [ ] |
| 4-8. Secret 다양한 활용 | Secret types, mode 설정 | [ ] |
| 4-9. CRD 관찰 및 생성 | CustomResourceDefinition | [ ] |

### Domain 5: Services and Networking (20%)

| 실습 | 관련 CKAD 주제 | 완료 |
|------|--------------|------|
| 5-1. Service 비교 | ClusterIP, NodePort, LoadBalancer | [ ] |
| 5-2. CiliumNetworkPolicy 분석 | NetworkPolicy (L3/L4/L7) | [ ] |
| 5-3. DNS 테스트 | CoreDNS, Service DNS | [ ] |
| 5-4. Istio Gateway/mTLS | Gateway, PeerAuthentication | [ ] |
| 5-5. Ingress 생성 | Ingress (path/host routing, TLS) | [ ] |
| 5-6. PV/PVC 실습 | PersistentVolume, PVC | [ ] |
| 5-7. NetworkPolicy 직접 생성 | default-deny, allow 패턴 | [ ] |

### 종합 시나리오

| 시나리오 | 내용 | 완료 |
|---------|------|------|
| 시나리오 A | 마이크로서비스 전체 배포 | [ ] |
| 시나리오 B | 장애 대응 및 디버깅 | [ ] |
| 시나리오 C | StatefulSet 데이터 영속성 검증 | [ ] |
| 시나리오 D | ArgoCD 파이프라인 시뮬레이션 | [ ] |

### 모의 시험

| 시험 | 내용 | 제한 시간 | 완료 |
|-----|------|---------|------|
| 모의 시험 1 | 기본 배포 (Pod, Service, Deployment) | 30분 | [ ] |
| 모의 시험 2 | 고급 설정 및 보안 | 35분 | [ ] |
| 모의 시험 3 | 종합 실전 3-tier 배포 | 45분 | [ ] |

---

## CKAD 시험 핵심 명령어 빠른 참조

### 자주 쓰는 명령형(Imperative) 명령어

```bash
# Pod
kubectl run <name> --image=<image> --restart=Never -n <ns>
kubectl run <name> --image=<image> --restart=Never --command -- sleep 3600
kubectl run <name> --image=<image> --env="KEY=VAL" --labels="k=v"
kubectl run <name> --image=<image> --dry-run=client -o yaml

# Deployment
kubectl create deployment <name> --image=<image> --replicas=<n>
kubectl set image deployment/<name> <container>=<image>
kubectl scale deployment <name> --replicas=<n>
kubectl rollout undo deployment/<name>
kubectl rollout history deployment/<name>

# Service
kubectl expose pod <name> --port=<port> --target-port=<port> --name=<svc>
kubectl expose deployment <name> --port=<port> --type=NodePort

# ConfigMap / Secret
kubectl create configmap <name> --from-literal=KEY=VAL --from-file=<file>
kubectl create secret generic <name> --from-literal=KEY=VAL

# 기타
kubectl label pod <name> key=val
kubectl annotate pod <name> key=val
kubectl taint node <node> key=val:NoSchedule
kubectl cordon / uncordon <node>
kubectl drain <node> --ignore-daemonsets
```

### dry-run 활용 패턴 (시험 필수)

```bash
# YAML 템플릿 생성
kubectl run mypod --image=nginx --dry-run=client -o yaml > pod.yaml
kubectl create deployment myapp --image=nginx --dry-run=client -o yaml > deploy.yaml
kubectl create configmap myconfig --from-literal=key=val --dry-run=client -o yaml > cm.yaml
kubectl expose deployment myapp --port=80 --dry-run=client -o yaml > svc.yaml

# 수정 후 적용
vi pod.yaml  # 또는 nano pod.yaml
kubectl apply -f pod.yaml
```
