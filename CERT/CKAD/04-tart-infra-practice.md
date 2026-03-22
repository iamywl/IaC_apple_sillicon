# CKAD 실습 가이드 — tart-infra 활용

> tart-infra 프로젝트의 실제 인프라 구성을 활용하여 CKAD(Certified Kubernetes Application Developer) 시험 영역별 실습을 진행하는 가이드이다.
> CKAD는 개발자 관점의 실기 시험으로, 애플리케이션 설계/빌드/배포/관찰/보안/네트워킹을 실제 클러스터에서 수행하는 능력을 검증한다.
> 4개 클러스터(platform, dev, staging, prod) 중 **dev 클러스터**의 **demo 네임스페이스**를 주로 활용한다.

---

## 사전 준비

### 클러스터 접근 설정

tart-infra는 4개의 클러스터로 구성되어 있다. 본 실습에서는 주로 dev 클러스터를 사용한다.

```bash
# dev 클러스터 kubeconfig 설정
export KUBECONFIG=kubeconfig/dev-kubeconfig

# 클러스터 연결 확인
kubectl cluster-info
kubectl get nodes -o wide

# 현재 컨텍스트 확인
kubectl config current-context
```

### 네임스페이스 확인

```bash
# dev 클러스터의 네임스페이스 목록 확인
kubectl get namespaces

# demo 네임스페이스 레이블 확인 (Istio sidecar injection 여부)
kubectl get namespace demo --show-labels

# demo 네임스페이스에서 작업하도록 기본 네임스페이스 설정
kubectl config set-context --current --namespace=demo
```

**예상 출력:**

```
NAME              STATUS   AGE
default           Active   30d
demo              Active   30d
istio-system      Active   30d
kube-system       Active   30d
...
```

demo 네임스페이스에는 `istio-injection=enabled` 레이블이 설정되어 있어, 해당 네임스페이스에 배포되는 모든 Pod에 Istio sidecar(istio-proxy)가 자동 주입된다.

### 인프라 개요

| 클러스터 | 용도 | 주요 구성 |
|---------|------|----------|
| platform | 공통 인프라 | Prometheus + Grafana (monitoring ns) |
| dev | 개발/실습 | Istio + demo 앱 (demo ns) |
| staging | 스테이징 | 프로덕션 사전 검증 |
| prod | 프로덕션 | 운영 환경 |

### dev 클러스터 demo 네임스페이스 앱 구성

| 앱 | 이미지 | 레플리카 | 서비스 유형 | 포트 | 레이블 | 리소스 |
|---|--------|---------|-----------|------|--------|--------|
| nginx-web | nginx:alpine | 3 | NodePort 30080 | 80 | app=nginx-web | req: 50m/64Mi, lim: 200m/128Mi |
| httpbin v1 | kong/httpbin:latest | 2 | ClusterIP:80 | 80 | app=httpbin, version=v1 | - |
| httpbin v2 | kong/httpbin:latest | 1 | - | 80 | app=httpbin, version=v2 | - |
| redis | redis:7-alpine | 1 | ClusterIP | 6379 | app=redis | - |
| postgres | postgres:16-alpine | 1 | ClusterIP | 5432 | app=postgres | - |
| rabbitmq | rabbitmq:3-management-alpine | 1 | ClusterIP | 5672/15672 | app=rabbitmq | - |
| keycloak | quay.io/keycloak/keycloak:latest | 1 | NodePort 30880 | 8080 | app=keycloak | - |

### Helm 릴리스 (dev 클러스터)

| 릴리스 | 차트 | 네임스페이스 |
|--------|------|-------------|
| cilium | cilium/cilium | kube-system |
| prometheus-stack | prometheus-community/kube-prometheus-stack | monitoring |
| argocd | argo/argo-cd | argocd |
| jenkins | jenkins/jenkins | jenkins |
| loki | grafana/loki | monitoring |
| metrics-server | metrics-server/metrics-server | kube-system |

### 현재 인프라 상태 확인

```bash
# demo 네임스페이스 전체 리소스 확인
kubectl get all -n demo

# Pod 상태 확인 (READY 2/2 = 메인 컨테이너 + istio-proxy)
kubectl get pods -n demo -o wide

# Service 목록 확인
kubectl get svc -n demo

# HPA 확인
kubectl get hpa -n demo

# CiliumNetworkPolicy 확인
kubectl get ciliumnetworkpolicy -n demo

# Istio 리소스 확인
kubectl get virtualservice,destinationrule,gateway,peerauthentication -n demo
```

**예상 출력 (kubectl get pods -n demo):**

```
NAME                          READY   STATUS    RESTARTS   AGE
nginx-web-xxxxx-aaaa          2/2     Running   0          5d
nginx-web-xxxxx-bbbb          2/2     Running   0          5d
nginx-web-xxxxx-cccc          2/2     Running   0          5d
httpbin-v1-xxxxx-aaaa         2/2     Running   0          5d
httpbin-v1-xxxxx-bbbb         2/2     Running   0          5d
httpbin-v2-xxxxx-aaaa         2/2     Running   0          5d
redis-xxxxx-aaaa              2/2     Running   0          5d
postgres-xxxxx-aaaa           2/2     Running   0          5d
rabbitmq-xxxxx-aaaa           2/2     Running   0          5d
keycloak-xxxxx-aaaa           2/2     Running   0          5d
```

모든 Pod의 READY가 `2/2`인 이유는 Istio sidecar injection이 활성화되어 메인 컨테이너와 istio-proxy 컨테이너가 함께 실행되기 때문이다.

### CKAD 시험 도메인 매핑

| 도메인 | 비중 | 본 가이드 실습 |
|--------|------|---------------|
| Application Design and Build | 20% | 실습 1 (Lab 1.1~1.6) |
| Application Deployment | 20% | 실습 2 (Lab 2.1~2.8) |
| Application Observability and Maintenance | 15% | 실습 3 (Lab 3.1~3.8) |
| Application Environment, Configuration and Security | 25% | 실습 4 (Lab 4.1~4.12) |
| Services and Networking | 20% | 실습 5 (Lab 5.1~5.10) |

### 필수 도구 확인

```bash
# kubectl 버전 확인
kubectl version --client

# helm 버전 확인
helm version

# istioctl 설치 여부 확인 (선택)
istioctl version 2>/dev/null || echo "istioctl이 설치되어 있지 않다. Istio 실습의 일부 기능에 필요하다."

# jq 설치 여부 확인
jq --version 2>/dev/null || echo "jq가 설치되어 있지 않다. JSON 파싱에 유용하다."
```

---

## 실습 1: Application Design and Build (20%)

> **CKAD 시험 도메인:** Application Design and Build
> 이 영역은 컨테이너 이미지 정의, Multi-container Pod 패턴(sidecar, init, ambassador), Volume 마운트, 그리고 효율적인 Dockerfile 작성 능력을 평가한다.

---

### Lab 1.1: Multi-container Pod 관찰 — Istio sidecar 분석

**학습 목표:**
- Multi-container Pod의 구조를 이해한다.
- Sidecar 패턴의 실제 구현 사례(Istio istio-proxy)를 관찰한다.
- Pod 내 컨테이너 간 네트워크 공유 원리를 이해한다.

**관련 CKAD 도메인:** Application Design and Build — Multi-container Pod Patterns

**배경 지식:**
Multi-container Pod에서는 같은 Pod 내의 컨테이너들이 동일한 네트워크 네임스페이스를 공유한다. 즉, `localhost`로 서로 통신할 수 있다. 또한 동일한 Volume을 마운트하여 파일 시스템을 공유할 수도 있다. Sidecar 패턴은 메인 컨테이너의 기능을 보조하는 컨테이너를 함께 배치하는 것이다. Istio의 istio-proxy(Envoy)는 대표적인 sidecar 구현체로, 트래픽 라우팅, mTLS 암호화, 메트릭 수집 등을 메인 애플리케이션 코드 변경 없이 수행한다.

**Step 1: demo 네임스페이스의 Pod READY 상태 확인**

```bash
# 모든 Pod의 READY 열에서 컨테이너 수를 확인한다
kubectl get pods -n demo
```

**예상 출력:**

```
NAME                          READY   STATUS    RESTARTS   AGE
nginx-web-xxxxx-aaaa          2/2     Running   0          5d
httpbin-v1-xxxxx-aaaa         2/2     Running   0          5d
...
```

READY `2/2`는 Pod 내에 2개의 컨테이너가 있고, 모두 Ready 상태임을 의미한다.

**Step 2: Pod 내 컨테이너 이름 확인**

```bash
# 각 Pod의 컨테이너 이름 목록을 확인한다
kubectl get pods -n demo -o jsonpath='{range .items[*]}{.metadata.name}{": "}{range .spec.containers[*]}{.name}{" "}{end}{"\n"}{end}'
```

**예상 출력:**

```
nginx-web-xxxxx-aaaa: nginx istio-proxy
httpbin-v1-xxxxx-aaaa: httpbin istio-proxy
redis-xxxxx-aaaa: redis istio-proxy
postgres-xxxxx-aaaa: postgres istio-proxy
rabbitmq-xxxxx-aaaa: rabbitmq istio-proxy
keycloak-xxxxx-aaaa: keycloak istio-proxy
```

모든 Pod에 `istio-proxy` 컨테이너가 자동으로 주입되어 있는 것을 확인할 수 있다.

**Step 3: 특정 Pod의 컨테이너 상세 정보 확인**

```bash
# nginx-web Pod의 전체 컨테이너 spec 확인
NGINX_POD=$(kubectl get pods -n demo -l app=nginx-web -o jsonpath='{.items[0].metadata.name}')
kubectl get pod $NGINX_POD -n demo -o jsonpath='{range .spec.containers[*]}{"Name: "}{.name}{"\nImage: "}{.image}{"\nPorts: "}{.ports[*].containerPort}{"\n---\n"}{end}'
```

**Step 4: istio-proxy 컨테이너 상세 분석**

```bash
# istio-proxy 컨테이너의 리소스 요청/제한 확인
kubectl get pod $NGINX_POD -n demo -o jsonpath='{.spec.containers[?(@.name=="istio-proxy")].resources}' | jq .

# istio-proxy의 환경변수 확인 (Istio 설정 정보가 포함됨)
kubectl get pod $NGINX_POD -n demo -o jsonpath='{range .spec.containers[?(@.name=="istio-proxy")].env[*]}{.name}={.value}{"\n"}{end}' | head -20

# istio-proxy의 포트 확인
kubectl get pod $NGINX_POD -n demo -o jsonpath='{range .spec.containers[?(@.name=="istio-proxy")].ports[*]}{"port: "}{.containerPort}{" name: "}{.name}{"\n"}{end}'
```

**Step 5: Sidecar injection 레이블 확인**

```bash
# demo 네임스페이스의 istio-injection 레이블 확인
kubectl get namespace demo -o jsonpath='{.metadata.labels.istio-injection}'
```

**예상 출력:** `enabled`

**Step 6: Pod 내 컨테이너 간 네트워크 공유 확인**

```bash
# nginx 컨테이너에서 localhost의 istio-proxy 관리 포트에 접근
kubectl exec $NGINX_POD -n demo -c nginx -- wget -qO- http://localhost:15000/server_info 2>/dev/null | head -5

# istio-proxy 컨테이너에서 nginx 메인 포트에 접근
kubectl exec $NGINX_POD -n demo -c istio-proxy -- curl -s http://localhost:80 | head -5
```

같은 Pod 내의 컨테이너끼리는 `localhost`로 서로 접근할 수 있다는 것을 직접 확인할 수 있다.

**확인 문제:**

1. demo 네임스페이스에서 모든 Pod의 READY 열이 `2/2`로 표시되는 이유는 무엇인가?
2. Istio sidecar가 메인 애플리케이션에 주입되는 시점은 언제인가? (힌트: MutatingWebhook)
3. 같은 Pod 내의 두 컨테이너가 `localhost`로 통신할 수 있는 이유는 무엇인가?
4. Sidecar 패턴의 장점 3가지를 설명하시오.
5. istio-proxy 컨테이너가 수행하는 주요 기능 3가지는 무엇인가?

---

### Lab 1.2: Init Container 추가 실습 (nginx에 설정 파일 준비 init container)

**학습 목표:**
- Init Container의 실행 순서와 역할을 이해한다.
- Init Container를 활용하여 메인 컨테이너 시작 전 사전 작업을 수행하는 방법을 익힌다.
- emptyDir Volume을 통한 Init Container와 메인 컨테이너 간 데이터 공유를 실습한다.

**관련 CKAD 도메인:** Application Design and Build — Init Containers

**배경 지식:**
Init Container는 메인 컨테이너가 시작되기 전에 순차적으로 실행되는 특수 컨테이너이다. 모든 Init Container가 성공적으로 완료되어야 메인 컨테이너가 시작된다. 일반적으로 DB 마이그레이션, 설정 파일 다운로드, 의존 서비스 대기 등에 사용된다.

**Step 1: postgres 서비스 대기 Init Container가 있는 Pod 생성**

```bash
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: v1
kind: Pod
metadata:
  name: init-demo-postgres
  labels:
    app: init-demo
spec:
  initContainers:
    - name: wait-for-postgres
      image: busybox:1.36
      command:
        - sh
        - -c
        - |
          echo "Postgres 서비스를 기다리는 중..."
          until nslookup postgres.demo.svc.cluster.local; do
            echo "Waiting for postgres DNS..."
            sleep 2
          done
          echo "Postgres DNS 해석 성공!"
  containers:
    - name: app
      image: busybox:1.36
      command: ["sh", "-c", "echo 'App started after postgres is ready' && sleep 3600"]
      resources:
        requests:
          cpu: 10m
          memory: 16Mi
        limits:
          cpu: 50m
          memory: 32Mi
EOF
```

**Step 2: Init Container 실행 상태 관찰**

```bash
# Pod 상태 확인 — Init 단계에서는 STATUS가 Init:0/1로 표시된다
kubectl get pod init-demo-postgres -n demo -w
```

**예상 출력 (Init 실행 중):**

```
NAME                  READY   STATUS     RESTARTS   AGE
init-demo-postgres    0/1     Init:0/1   0          5s
```

**예상 출력 (Init 완료 후):**

```
NAME                  READY   STATUS    RESTARTS   AGE
init-demo-postgres    1/1     Running   0          10s
```

(Istio sidecar injection이 활성화된 경우 `2/2`로 표시될 수 있다.)

**Step 3: Init Container 상세 정보 확인**

```bash
# describe로 Init Container 정보 확인
kubectl describe pod init-demo-postgres -n demo | grep -A 25 "Init Containers:"

# Init Container 로그 확인
kubectl logs init-demo-postgres -n demo -c wait-for-postgres
```

**예상 출력 (로그):**

```
Postgres 서비스를 기다리는 중...
Server:    10.96.0.10
Address 1: 10.96.0.10 kube-dns.kube-system.svc.cluster.local

Name:      postgres.demo.svc.cluster.local
Address 1: 10.96.x.x postgres.demo.svc.cluster.local
Postgres DNS 해석 성공!
```

**Step 4: nginx 설정 파일을 준비하는 Init Container 생성**

이번에는 Init Container가 nginx 설정 파일을 생성하고, emptyDir Volume을 통해 메인 nginx 컨테이너에 전달하는 패턴을 실습한다.

```bash
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: v1
kind: Pod
metadata:
  name: init-demo-nginx-config
  labels:
    app: init-demo-nginx
spec:
  initContainers:
    - name: config-generator
      image: busybox:1.36
      command:
        - sh
        - -c
        - |
          echo "nginx 설정 파일 생성 중..."
          cat > /config/default.conf << 'NGINX_CONF'
          server {
              listen 80;
              server_name localhost;
              location / {
                  root /usr/share/nginx/html;
                  index index.html;
              }
              location /health {
                  access_log off;
                  return 200 'healthy\n';
                  add_header Content-Type text/plain;
              }
              location /info {
                  return 200 '{"app":"init-demo","version":"1.0"}\n';
                  add_header Content-Type application/json;
              }
          }
          NGINX_CONF
          echo "nginx 설정 파일 생성 완료!"
      volumeMounts:
        - name: config-volume
          mountPath: /config
    - name: html-generator
      image: busybox:1.36
      command:
        - sh
        - -c
        - |
          echo "HTML 파일 생성 중..."
          cat > /html/index.html << 'HTML'
          <!DOCTYPE html>
          <html>
          <head><title>Init Demo</title></head>
          <body>
            <h1>Init Container Demo</h1>
            <p>이 페이지는 Init Container에 의해 생성되었다.</p>
          </body>
          </html>
          HTML
          echo "HTML 파일 생성 완료!"
      volumeMounts:
        - name: html-volume
          mountPath: /html
  containers:
    - name: nginx
      image: nginx:alpine
      ports:
        - containerPort: 80
      volumeMounts:
        - name: config-volume
          mountPath: /etc/nginx/conf.d
        - name: html-volume
          mountPath: /usr/share/nginx/html
      resources:
        requests:
          cpu: 10m
          memory: 16Mi
        limits:
          cpu: 50m
          memory: 32Mi
  volumes:
    - name: config-volume
      emptyDir: {}
    - name: html-volume
      emptyDir: {}
EOF
```

**Step 5: 다중 Init Container의 순차 실행 확인**

```bash
# Pod 상태를 지속적으로 모니터링
kubectl get pod init-demo-nginx-config -n demo -w

# Init Container별 로그 확인
kubectl logs init-demo-nginx-config -n demo -c config-generator
kubectl logs init-demo-nginx-config -n demo -c html-generator

# 메인 nginx 컨테이너의 설정 파일 확인
kubectl exec init-demo-nginx-config -n demo -c nginx -- cat /etc/nginx/conf.d/default.conf

# HTML 파일 확인
kubectl exec init-demo-nginx-config -n demo -c nginx -- cat /usr/share/nginx/html/index.html

# 헬스체크 엔드포인트 테스트
kubectl exec init-demo-nginx-config -n demo -c nginx -- wget -qO- http://localhost/health
kubectl exec init-demo-nginx-config -n demo -c nginx -- wget -qO- http://localhost/info
```

**Step 6: Init Container 실패 시 동작 관찰**

```bash
# 의도적으로 실패하는 Init Container를 가진 Pod 생성
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: v1
kind: Pod
metadata:
  name: init-demo-fail
  labels:
    app: init-demo-fail
spec:
  initContainers:
    - name: will-fail
      image: busybox:1.36
      command: ["sh", "-c", "echo 'Init starting...' && exit 1"]
  containers:
    - name: app
      image: nginx:alpine
      resources:
        requests:
          cpu: 10m
          memory: 16Mi
EOF
```

```bash
# 실패한 Init Container 상태 관찰
kubectl get pod init-demo-fail -n demo
kubectl describe pod init-demo-fail -n demo | grep -A 10 "Init Containers:"

# Init Container가 실패하면 Pod은 Init:CrashLoopBackOff 상태가 된다
# 메인 컨테이너는 절대 시작되지 않는다
```

**예상 출력:**

```
NAME              READY   STATUS                  RESTARTS   AGE
init-demo-fail    0/1     Init:CrashLoopBackOff   3          1m
```

**Step 7: 정리**

```bash
kubectl delete pod init-demo-postgres init-demo-nginx-config init-demo-fail -n demo --grace-period=0 --force 2>/dev/null
```

**확인 문제:**

1. Init Container와 일반 컨테이너의 차이점 3가지를 설명하시오.
2. Pod에 Init Container가 3개 있을 때, 두 번째 Init Container가 실패하면 세 번째 Init Container는 어떻게 되는가?
3. Init Container에서 emptyDir Volume을 사용하는 이유는 무엇인가?
4. Init Container의 restartPolicy는 메인 컨테이너와 동일한가?
5. `kubectl logs <pod> -c <init-container>` 명령으로 Init Container의 로그를 확인할 수 있는 시점은 언제인가?

---

### Lab 1.3: Sidecar 패턴 — 로그 수집 sidecar 추가

**학습 목표:**
- Sidecar 패턴의 실제 활용 사례(로그 수집)를 구현한다.
- emptyDir Volume을 통한 컨테이너 간 로그 파일 공유를 실습한다.
- Pod 내 여러 컨테이너의 로그를 개별적으로 확인하는 방법을 익힌다.

**관련 CKAD 도메인:** Application Design and Build — Sidecar Pattern

**배경 지식:**
Sidecar 패턴에서 로그 수집 sidecar는 메인 컨테이너가 파일로 출력하는 로그를 읽어 stdout으로 전달하거나, 외부 로그 시스템으로 전송한다. 이 패턴을 통해 메인 애플리케이션 코드를 변경하지 않고도 로그 수집 전략을 변경할 수 있다.

**Step 1: 로그 수집 sidecar가 있는 Pod 생성**

```bash
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: v1
kind: Pod
metadata:
  name: sidecar-log-demo
  labels:
    app: sidecar-log-demo
spec:
  containers:
    - name: app
      image: busybox:1.36
      command:
        - sh
        - -c
        - |
          i=0
          while true; do
            echo "$(date '+%Y-%m-%d %H:%M:%S') [INFO] 애플리케이션 로그 메시지 $i" >> /var/log/app/app.log
            echo "$(date '+%Y-%m-%d %H:%M:%S') [METRIC] requests=$i latency=$((RANDOM % 100))ms" >> /var/log/app/metrics.log
            i=$((i + 1))
            sleep 5
          done
      volumeMounts:
        - name: log-volume
          mountPath: /var/log/app
      resources:
        requests:
          cpu: 10m
          memory: 16Mi
        limits:
          cpu: 50m
          memory: 32Mi
    - name: log-sidecar
      image: busybox:1.36
      command:
        - sh
        - -c
        - |
          echo "Log sidecar 시작됨"
          while [ ! -f /var/log/app/app.log ]; do
            sleep 1
          done
          tail -f /var/log/app/app.log
      volumeMounts:
        - name: log-volume
          mountPath: /var/log/app
          readOnly: true
      resources:
        requests:
          cpu: 10m
          memory: 16Mi
        limits:
          cpu: 50m
          memory: 32Mi
    - name: metrics-sidecar
      image: busybox:1.36
      command:
        - sh
        - -c
        - |
          echo "Metrics sidecar 시작됨"
          while [ ! -f /var/log/app/metrics.log ]; do
            sleep 1
          done
          tail -f /var/log/app/metrics.log
      volumeMounts:
        - name: log-volume
          mountPath: /var/log/app
          readOnly: true
      resources:
        requests:
          cpu: 10m
          memory: 16Mi
        limits:
          cpu: 50m
          memory: 32Mi
  volumes:
    - name: log-volume
      emptyDir: {}
EOF
```

**Step 2: 각 컨테이너 로그 확인**

```bash
# 약 15초 대기 후 로그 확인
sleep 15

# 메인 app 컨테이너 로그 (stdout에 출력하지 않으므로 비어 있다)
kubectl logs sidecar-log-demo -n demo -c app

# log-sidecar 컨테이너 로그 (app.log를 stdout으로 스트리밍)
kubectl logs sidecar-log-demo -n demo -c log-sidecar --tail=5

# metrics-sidecar 컨테이너 로그
kubectl logs sidecar-log-demo -n demo -c metrics-sidecar --tail=5
```

**예상 출력 (log-sidecar):**

```
2024-01-15 10:30:00 [INFO] 애플리케이션 로그 메시지 0
2024-01-15 10:30:05 [INFO] 애플리케이션 로그 메시지 1
2024-01-15 10:30:10 [INFO] 애플리케이션 로그 메시지 2
```

**예상 출력 (metrics-sidecar):**

```
2024-01-15 10:30:00 [METRIC] requests=0 latency=42ms
2024-01-15 10:30:05 [METRIC] requests=1 latency=87ms
```

**Step 3: 실시간 로그 스트리밍**

```bash
# log-sidecar의 실시간 로그 확인 (Ctrl+C로 종료)
kubectl logs sidecar-log-demo -n demo -c log-sidecar -f
```

**Step 4: 공유 Volume 내용 직접 확인**

```bash
# app 컨테이너에서 로그 파일 내용 확인
kubectl exec sidecar-log-demo -n demo -c app -- cat /var/log/app/app.log

# log-sidecar에서도 같은 파일에 접근 가능한지 확인
kubectl exec sidecar-log-demo -n demo -c log-sidecar -- ls -la /var/log/app/

# readOnly 마운트 확인: sidecar에서 쓰기 시도 (실패해야 함)
kubectl exec sidecar-log-demo -n demo -c log-sidecar -- sh -c 'echo test > /var/log/app/test.txt' 2>&1 || echo "readOnly로 마운트되어 쓰기 불가"
```

**Step 5: tart-infra의 Istio sidecar와 비교**

```bash
# 실습에서 만든 로그 수집 sidecar Pod
kubectl get pod sidecar-log-demo -n demo -o jsonpath='{range .spec.containers[*]}{"name: "}{.name}{"\n"}{end}'

# tart-infra의 nginx-web Pod (Istio sidecar 자동 주입)
NGINX_POD=$(kubectl get pods -n demo -l app=nginx-web -o jsonpath='{.items[0].metadata.name}')
kubectl get pod $NGINX_POD -n demo -o jsonpath='{range .spec.containers[*]}{"name: "}{.name}{"\n"}{end}'
```

**Step 6: 정리**

```bash
kubectl delete pod sidecar-log-demo -n demo --grace-period=0 --force 2>/dev/null
```

**확인 문제:**

1. Sidecar 패턴에서 emptyDir Volume의 역할은 무엇인가?
2. log-sidecar가 readOnly로 Volume을 마운트한 이유는 무엇인가?
3. `kubectl logs`에서 `-c` 플래그를 지정하지 않으면 어떤 컨테이너의 로그가 출력되는가?
4. Sidecar 패턴과 Init Container 패턴의 차이점은 무엇인가?
5. 실제 프로덕션에서 로그 수집 sidecar 대신 DaemonSet 기반 로그 수집기(Fluentd/Fluent Bit)를 사용하는 경우의 장단점은 무엇인가?

---

### Lab 1.4: Ambassador 패턴 — 프록시 sidecar

**학습 목표:**
- Ambassador(대사) 패턴의 개념과 사용 사례를 이해한다.
- 메인 컨테이너가 localhost로만 통신하고, Ambassador 컨테이너가 외부 서비스로 프록시하는 구조를 구현한다.

**관련 CKAD 도메인:** Application Design and Build — Ambassador Pattern

**배경 지식:**
Ambassador 패턴은 메인 컨테이너가 복잡한 외부 서비스 연결 로직을 알 필요 없이, Ambassador 컨테이너가 프록시 역할을 하는 것이다. 메인 컨테이너는 항상 `localhost`로 접근하고, Ambassador가 실제 외부 서비스로 요청을 전달한다. 이는 tart-infra의 Istio sidecar(istio-proxy)가 수행하는 역할과 정확히 일치한다.

**Step 1: Ambassador용 nginx 설정 ConfigMap 먼저 생성**

```bash
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: v1
kind: ConfigMap
metadata:
  name: ambassador-nginx-config
data:
  default.conf: |
    server {
        listen 8080;
        location / {
            proxy_pass http://httpbin.demo.svc.cluster.local:80;
            proxy_set_header Host httpbin.demo.svc.cluster.local;
        }
    }
EOF
```

**Step 2: Ambassador 프록시 Pod 생성**

```bash
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: v1
kind: Pod
metadata:
  name: ambassador-demo
  labels:
    app: ambassador-demo
spec:
  containers:
    - name: app
      image: busybox:1.36
      command:
        - sh
        - -c
        - |
          echo "앱 시작. localhost:8080을 통해 httpbin에 접근한다."
          sleep 5
          while true; do
            result=$(wget -qO- http://localhost:8080/get 2>/dev/null)
            if [ -n "$result" ]; then
              echo "SUCCESS: Ambassador를 통한 httpbin 응답 수신"
            else
              echo "WAITING: Ambassador 프록시 준비 중..."
            fi
            sleep 10
          done
      resources:
        requests:
          cpu: 10m
          memory: 16Mi
        limits:
          cpu: 50m
          memory: 32Mi
    - name: ambassador
      image: nginx:alpine
      ports:
        - containerPort: 8080
      volumeMounts:
        - name: nginx-config
          mountPath: /etc/nginx/conf.d
      resources:
        requests:
          cpu: 10m
          memory: 16Mi
        limits:
          cpu: 50m
          memory: 32Mi
  volumes:
    - name: nginx-config
      configMap:
        name: ambassador-nginx-config
EOF
```

**Step 3: Ambassador 동작 확인**

```bash
# 약 15초 대기
sleep 15

# 앱 컨테이너 로그 확인 — localhost를 통해 httpbin에 성공적으로 접근하는지 확인
kubectl logs ambassador-demo -n demo -c app --tail=5

# Ambassador(nginx) 로그 확인 — 프록시 요청 로그
kubectl logs ambassador-demo -n demo -c ambassador --tail=5

# 앱 컨테이너에서 직접 localhost:8080 호출 테스트
kubectl exec ambassador-demo -n demo -c app -- wget -qO- http://localhost:8080/get
```

**Step 4: Istio sidecar와 Ambassador 패턴 비교**

```bash
# Istio의 istio-proxy도 Ambassador 패턴의 일종이다
# 메인 컨테이너의 모든 outbound 트래픽을 istio-proxy가 가로채서 처리한다

# nginx-web Pod에서 istio-proxy의 리스너 확인
NGINX_POD=$(kubectl get pods -n demo -l app=nginx-web -o jsonpath='{.items[0].metadata.name}')
kubectl exec $NGINX_POD -n demo -c istio-proxy -- pilot-agent request GET /listeners 2>/dev/null | head -20
```

**Step 5: 정리**

```bash
kubectl delete pod ambassador-demo -n demo --grace-period=0 --force 2>/dev/null
kubectl delete configmap ambassador-nginx-config -n demo 2>/dev/null
```

**확인 문제:**

1. Ambassador 패턴과 Sidecar 패턴의 차이점은 무엇인가?
2. Ambassador 패턴에서 메인 컨테이너가 `localhost`로만 통신하는 것의 장점은 무엇인가?
3. Istio의 istio-proxy는 Ambassador 패턴과 Sidecar 패턴 중 어느 것에 더 가까운가? 그 이유는?
4. Ambassador 컨테이너의 설정을 ConfigMap으로 분리한 이유는 무엇인가?

---

### Lab 1.5: Volume 유형 실습 (emptyDir, configMap, secret, PVC)

**학습 목표:**
- Kubernetes의 주요 Volume 유형(emptyDir, configMap, secret, hostPath, PVC)을 이해한다.
- 각 Volume 유형의 사용 사례와 생명주기를 파악한다.
- tart-infra demo 앱에서 사용 중인 Volume을 분석한다.

**관련 CKAD 도메인:** Application Design and Build — Volumes

**Step 1: demo 앱의 Volume 구성 확인**

```bash
# 모든 Pod의 Volume 목록 확인
kubectl get pods -n demo -o jsonpath='{range .items[*]}{"=== "}{.metadata.name}{" ===\n"}{range .spec.volumes[*]}{"  Volume: "}{.name}{"\n"}{end}{"\n"}{end}'

# nginx-web Pod의 Volume 상세 확인
NGINX_POD=$(kubectl get pods -n demo -l app=nginx-web -o jsonpath='{.items[0].metadata.name}')
kubectl get pod $NGINX_POD -n demo -o yaml | grep -A 5 "volumes:" | head -30

# Volume Mount 위치 확인
kubectl get pod $NGINX_POD -n demo -o jsonpath='{range .spec.containers[*]}{"Container: "}{.name}{"\n"}{range .volumeMounts[*]}{"  Mount: "}{.name}{" -> "}{.mountPath}{"\n"}{end}{end}'
```

**Step 2: emptyDir Volume 실습**

```bash
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: v1
kind: Pod
metadata:
  name: vol-emptydir-demo
  labels:
    app: vol-demo
spec:
  containers:
    - name: writer
      image: busybox:1.36
      command: ["sh", "-c", "while true; do date >> /data/log.txt; sleep 5; done"]
      volumeMounts:
        - name: shared-data
          mountPath: /data
      resources:
        requests:
          cpu: 10m
          memory: 16Mi
    - name: reader
      image: busybox:1.36
      command: ["sh", "-c", "tail -f /data/log.txt"]
      volumeMounts:
        - name: shared-data
          mountPath: /data
          readOnly: true
      resources:
        requests:
          cpu: 10m
          memory: 16Mi
  volumes:
    - name: shared-data
      emptyDir: {}
EOF
```

```bash
# 약 15초 대기
sleep 15

# writer가 쓴 데이터를 reader가 읽는지 확인
kubectl logs vol-emptydir-demo -n demo -c reader --tail=5

# emptyDir에 저장된 파일 확인
kubectl exec vol-emptydir-demo -n demo -c writer -- cat /data/log.txt
```

**Step 3: configMap Volume 실습**

```bash
# ConfigMap 생성
kubectl create configmap app-config \
  --from-literal=APP_NAME=demo-app \
  --from-literal=APP_ENV=development \
  --from-literal=LOG_LEVEL=debug \
  -n demo

# ConfigMap을 Volume으로 마운트하는 Pod 생성
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: v1
kind: Pod
metadata:
  name: vol-configmap-demo
  labels:
    app: vol-demo
spec:
  containers:
    - name: app
      image: busybox:1.36
      command: ["sh", "-c", "ls -la /config/ && cat /config/APP_NAME && echo '' && sleep 3600"]
      volumeMounts:
        - name: config-vol
          mountPath: /config
          readOnly: true
      resources:
        requests:
          cpu: 10m
          memory: 16Mi
  volumes:
    - name: config-vol
      configMap:
        name: app-config
EOF
```

```bash
# ConfigMap이 파일로 마운트되었는지 확인
sleep 5
kubectl exec vol-configmap-demo -n demo -- ls -la /config/
kubectl exec vol-configmap-demo -n demo -- cat /config/APP_NAME
kubectl exec vol-configmap-demo -n demo -- cat /config/APP_ENV
kubectl exec vol-configmap-demo -n demo -- cat /config/LOG_LEVEL
```

**예상 출력:**

```
total 0
lrwxrwxrwx  1 root root  15 Jan 15 10:00 APP_ENV -> ..data/APP_ENV
lrwxrwxrwx  1 root root  16 Jan 15 10:00 APP_NAME -> ..data/APP_NAME
lrwxrwxrwx  1 root root  16 Jan 15 10:00 LOG_LEVEL -> ..data/LOG_LEVEL
```

ConfigMap의 각 키가 파일명으로, 값이 파일 내용으로 마운트된 것을 확인할 수 있다.

**Step 4: Secret Volume 실습**

```bash
# Secret 생성
kubectl create secret generic db-credentials \
  --from-literal=username=demo \
  --from-literal=password=demo123 \
  -n demo 2>/dev/null || echo "Secret already exists"

# Secret을 Volume으로 마운트하는 Pod 생성
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: v1
kind: Pod
metadata:
  name: vol-secret-demo
  labels:
    app: vol-demo
spec:
  containers:
    - name: app
      image: busybox:1.36
      command: ["sh", "-c", "cat /secrets/username && echo '' && cat /secrets/password && echo '' && sleep 3600"]
      volumeMounts:
        - name: secret-vol
          mountPath: /secrets
          readOnly: true
      resources:
        requests:
          cpu: 10m
          memory: 16Mi
  volumes:
    - name: secret-vol
      secret:
        secretName: db-credentials
EOF
```

```bash
# Secret이 파일로 마운트되었는지 확인
sleep 5
kubectl exec vol-secret-demo -n demo -- ls -la /secrets/
kubectl exec vol-secret-demo -n demo -- cat /secrets/username
kubectl exec vol-secret-demo -n demo -- cat /secrets/password

# Secret은 tmpfs(메모리)에 마운트됨을 확인
kubectl exec vol-secret-demo -n demo -- df -h /secrets/
```

**Step 5: emptyDir with sizeLimit (medium: Memory)**

```bash
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: v1
kind: Pod
metadata:
  name: vol-memory-demo
  labels:
    app: vol-demo
spec:
  containers:
    - name: app
      image: busybox:1.36
      command: ["sh", "-c", "df -h /cache && mount | grep cache && sleep 3600"]
      volumeMounts:
        - name: cache
          mountPath: /cache
      resources:
        requests:
          cpu: 10m
          memory: 64Mi
        limits:
          cpu: 50m
          memory: 128Mi
  volumes:
    - name: cache
      emptyDir:
        medium: Memory
        sizeLimit: 64Mi
EOF
```

```bash
sleep 5
# 메모리 기반 emptyDir 확인 (tmpfs)
kubectl exec vol-memory-demo -n demo -- df -h /cache
kubectl exec vol-memory-demo -n demo -- mount | grep cache
```

**예상 출력:**

```
Filesystem      Size  Used Avail Use% Mounted on
tmpfs            64M     0   64M   0% /cache
```

**Step 6: 정리**

```bash
kubectl delete pod vol-emptydir-demo vol-configmap-demo vol-secret-demo vol-memory-demo -n demo --grace-period=0 --force 2>/dev/null
kubectl delete configmap app-config -n demo 2>/dev/null
kubectl delete secret db-credentials -n demo 2>/dev/null
```

**확인 문제:**

1. emptyDir Volume의 생명주기는 무엇인가? (Pod 삭제 시 데이터는 어떻게 되는가?)
2. ConfigMap Volume과 Secret Volume의 마운트 방식의 공통점과 차이점은 무엇인가?
3. Secret이 tmpfs에 마운트되는 이유는 무엇인가?
4. `emptyDir.medium: Memory`를 사용하는 경우와 기본 emptyDir의 차이점은 무엇인가?
5. PVC(PersistentVolumeClaim)는 emptyDir와 비교하여 어떤 장점이 있는가?

---

### Lab 1.6: Dockerfile 최적화 분석 (demo 앱 이미지 레이어 비교)

**학습 목표:**
- 컨테이너 이미지의 레이어 구조를 이해한다.
- Alpine 기반 이미지와 일반 이미지의 크기 차이를 비교한다.
- 이미지 최적화 전략(multi-stage build, alpine, distroless)을 학습한다.

**관련 CKAD 도메인:** Application Design and Build — Container Images, Dockerfiles

**Step 1: demo 앱에서 사용 중인 이미지 목록 확인**

```bash
# 모든 컨테이너의 이미지 확인
kubectl get pods -n demo -o jsonpath='{range .items[*]}{range .spec.containers[*]}{"image: "}{.image}{"\n"}{end}{end}' | sort -u
```

**예상 출력:**

```
image: kong/httpbin:latest
image: nginx:alpine
image: postgres:16-alpine
image: quay.io/keycloak/keycloak:latest
image: rabbitmq:3-management-alpine
image: redis:7-alpine
```

**Step 2: Alpine 이미지 vs 일반 이미지 크기 비교**

```bash
# 노드에서 이미지 정보 확인
kubectl get pods -n demo -o jsonpath='{range .items[*]}{"pod: "}{.metadata.name}{"\n"}{range .status.containerStatuses[*]}{"  image: "}{.image}{"\n  imageID: "}{.imageID}{"\n"}{end}{end}'
```

**Step 3: 이미지 최적화 원칙 분석**

tart-infra에서 사용하는 이미지들의 최적화 패턴을 분석한다.

```bash
# Alpine 기반 이미지를 사용하는 앱 확인
kubectl get pods -n demo -o jsonpath='{range .items[*]}{range .spec.containers[*]}{.image}{"\n"}{end}{end}' | grep alpine
```

**tart-infra의 이미지 최적화 분석:**

| 이미지 | 기반 | 크기 (대략) | 최적화 전략 |
|--------|------|------------|------------|
| nginx:alpine | Alpine Linux | ~40MB | Alpine 기반으로 최소화 |
| redis:7-alpine | Alpine Linux | ~30MB | Alpine 기반으로 최소화 |
| postgres:16-alpine | Alpine Linux | ~80MB | Alpine 기반으로 최소화 |
| rabbitmq:3-management-alpine | Alpine Linux | ~150MB | Alpine 기반 + management plugin |
| kong/httpbin:latest | 다양 | ~100MB | 공식 이미지 사용 |
| quay.io/keycloak/keycloak:latest | UBI | ~400MB | 풀스택 IAM 서버 |

**Step 4: Dockerfile 최적화 모범 사례 확인**

```bash
# 멀티 스테이지 빌드 예제 Dockerfile (참고용)
cat <<'DOCKERFILE'
# --- Bad Practice: 단일 스테이지 ---
# FROM golang:1.21
# WORKDIR /app
# COPY . .
# RUN go build -o server .
# 최종 이미지에 Go 컴파일러, 소스코드 등이 포함됨 (~800MB)
# CMD ["./server"]

# --- Good Practice: 멀티 스테이지 빌드 ---
FROM golang:1.21 AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o server .

FROM alpine:3.19
RUN apk --no-cache add ca-certificates
WORKDIR /root/
COPY --from=builder /app/server .
# 최종 이미지에는 바이너리만 포함됨 (~15MB)
CMD ["./server"]
DOCKERFILE
```

**확인 문제:**

1. Alpine 기반 이미지를 사용하는 것의 장점과 단점을 각각 2가지 설명하시오.
2. Multi-stage build에서 `FROM ... AS builder`의 역할은 무엇인가?
3. `COPY --from=builder`의 의미를 설명하시오.
4. Dockerfile에서 `RUN` 명령을 여러 줄로 분리하는 것과 `&&`로 연결하는 것의 차이는 무엇인가?
5. `.dockerignore` 파일의 역할은 무엇인가?

---

## 실습 2: Application Deployment (20%)

> **CKAD 시험 도메인:** Application Deployment
> 이 영역은 Deployment 전략(Rolling Update, Recreate), Canary/Blue-Green 배포, Helm, Kustomize, 그리고 GitOps 워크플로우를 평가한다.

---

### Lab 2.1: Deployment 생성 (kubectl create deployment + YAML)

**학습 목표:**
- `kubectl create deployment` 명령형 방식과 YAML 선언형 방식의 차이를 이해한다.
- Deployment의 핵심 필드(replicas, selector, template)를 학습한다.
- tart-infra의 실제 Deployment 구조를 분석한다.

**관련 CKAD 도메인:** Application Deployment — Deployments

**Step 1: 명령형 방식으로 Deployment 생성**

```bash
# 명령형으로 Deployment 생성
kubectl create deployment test-nginx --image=nginx:alpine --replicas=2 -n demo

# 생성된 Deployment 확인
kubectl get deployment test-nginx -n demo
kubectl get pods -n demo -l app=test-nginx

# 생성된 Deployment의 YAML 출력 (선언형 방식 학습용)
kubectl get deployment test-nginx -n demo -o yaml
```

**Step 2: --dry-run=client로 YAML 생성 (CKAD 시험 핵심 기법)**

```bash
# YAML을 파일로 생성 (실제로 적용하지 않음)
kubectl create deployment test-app --image=nginx:alpine --replicas=3 --dry-run=client -o yaml > /tmp/test-app-deploy.yaml

# 생성된 YAML 확인
cat /tmp/test-app-deploy.yaml
```

**예상 출력:**

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  creationTimestamp: null
  labels:
    app: test-app
  name: test-app
spec:
  replicas: 3
  selector:
    matchLabels:
      app: test-app
  template:
    metadata:
      labels:
        app: test-app
    spec:
      containers:
      - image: nginx:alpine
        name: nginx
        resources: {}
```

**Step 3: tart-infra의 nginx-web Deployment 분석**

```bash
# nginx-web Deployment 상세 확인
kubectl get deployment nginx-web -n demo -o yaml

# 핵심 필드 확인
echo "=== Replicas ==="
kubectl get deployment nginx-web -n demo -o jsonpath='{.spec.replicas}'
echo ""

echo "=== Selector ==="
kubectl get deployment nginx-web -n demo -o jsonpath='{.spec.selector}'
echo ""

echo "=== Image ==="
kubectl get deployment nginx-web -n demo -o jsonpath='{.spec.template.spec.containers[0].image}'
echo ""

echo "=== Labels ==="
kubectl get deployment nginx-web -n demo -o jsonpath='{.spec.template.metadata.labels}'
echo ""

echo "=== Resources ==="
kubectl get deployment nginx-web -n demo -o jsonpath='{.spec.template.spec.containers[0].resources}'
echo ""
```

**예상 출력:**

```
=== Replicas ===
3
=== Selector ===
{"matchLabels":{"app":"nginx-web"}}
=== Image ===
nginx:alpine
=== Labels ===
{"app":"nginx-web"}
=== Resources ===
{"limits":{"cpu":"200m","memory":"128Mi"},"requests":{"cpu":"50m","memory":"64Mi"}}
```

**Step 4: Deployment 스케일링**

```bash
# 수동 스케일링
kubectl scale deployment test-nginx --replicas=5 -n demo
kubectl get pods -n demo -l app=test-nginx -w

# 스케일링 결과 확인
kubectl get deployment test-nginx -n demo

# 다시 2로 축소
kubectl scale deployment test-nginx --replicas=2 -n demo
kubectl get pods -n demo -l app=test-nginx
```

**Step 5: 정리**

```bash
kubectl delete deployment test-nginx -n demo
rm -f /tmp/test-app-deploy.yaml
```

**확인 문제:**

1. `kubectl create deployment`와 `kubectl apply -f`의 차이점은 무엇인가?
2. `--dry-run=client -o yaml`이 CKAD 시험에서 유용한 이유는 무엇인가?
3. Deployment의 `spec.selector.matchLabels`와 `spec.template.metadata.labels`가 일치해야 하는 이유는 무엇인가?
4. nginx-web Deployment의 requests(50m/64Mi)와 limits(200m/128Mi)가 다른 이유는 무엇인가?
5. `kubectl scale`과 `kubectl edit`으로 replicas를 변경하는 방법의 차이점은 무엇인가?

---

### Lab 2.2: Rolling Update 상세 (maxSurge, maxUnavailable 변경)

**학습 목표:**
- Rolling Update 전략의 `maxSurge`와 `maxUnavailable` 파라미터를 이해한다.
- 다양한 설정 조합에 따른 업데이트 동작 차이를 관찰한다.
- tart-infra nginx-web의 실제 Rolling Update를 수행한다.

**관련 CKAD 도메인:** Application Deployment — Rolling Updates

**Step 1: 현재 Rolling Update 전략 확인**

```bash
# nginx-web의 Rolling Update 전략 확인
kubectl get deployment nginx-web -n demo -o jsonpath='{.spec.strategy}' | jq .
```

**예상 출력:**

```json
{
  "type": "RollingUpdate",
  "rollingUpdate": {
    "maxSurge": "25%",
    "maxUnavailable": "25%"
  }
}
```

**Step 2: maxSurge/maxUnavailable 설정별 동작 이해**

| 설정 | maxSurge | maxUnavailable | 동작 |
|------|----------|----------------|------|
| 기본값 | 25% | 25% | 일부 추가 생성 + 일부 제거 동시 진행 |
| 무중단 | 1 | 0 | 새 Pod가 Ready 되어야 구 Pod 제거 |
| 빠른 배포 | 100% | 0 | 모든 새 Pod를 먼저 생성 후 교체 |
| 최소 리소스 | 0 | 1 | 하나씩 교체 (추가 리소스 불필요) |

**Step 3: 테스트용 Deployment로 Rolling Update 실습**

```bash
# 테스트 Deployment 생성 (3 replicas)
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: rolling-demo
spec:
  replicas: 3
  selector:
    matchLabels:
      app: rolling-demo
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  template:
    metadata:
      labels:
        app: rolling-demo
    spec:
      containers:
        - name: nginx
          image: nginx:1.24-alpine
          ports:
            - containerPort: 80
          resources:
            requests:
              cpu: 10m
              memory: 16Mi
            limits:
              cpu: 50m
              memory: 32Mi
EOF

# Pod가 Ready될 때까지 대기
kubectl rollout status deployment rolling-demo -n demo
```

**Step 4: Rolling Update 실행 및 관찰**

```bash
# 터미널 1: Pod 상태를 지속 모니터링
kubectl get pods -n demo -l app=rolling-demo -w &

# 이미지 업데이트
kubectl set image deployment/rolling-demo nginx=nginx:1.25-alpine -n demo --record

# 롤아웃 상태 확인
kubectl rollout status deployment rolling-demo -n demo
```

**예상 출력 (watch):**

```
NAME                            READY   STATUS              RESTARTS   AGE
rolling-demo-aaa-111            2/2     Running             0          2m
rolling-demo-aaa-222            2/2     Running             0          2m
rolling-demo-aaa-333            2/2     Running             0          2m
rolling-demo-bbb-111            0/2     ContainerCreating   0          1s
rolling-demo-bbb-111            2/2     Running             0          5s
rolling-demo-aaa-111            2/2     Terminating         0          2m
```

**Step 5: maxSurge/maxUnavailable 변경 후 재배포**

```bash
# 전략을 변경: 빠른 배포 (maxSurge=100%, maxUnavailable=0)
kubectl patch deployment rolling-demo -n demo -p '{"spec":{"strategy":{"rollingUpdate":{"maxSurge":"100%","maxUnavailable":0}}}}'

# 다시 이미지 변경
kubectl set image deployment/rolling-demo nginx=nginx:alpine -n demo --record

# 롤아웃 상태 관찰
kubectl rollout status deployment rolling-demo -n demo
```

**Step 6: 롤아웃 히스토리 확인**

```bash
# 롤아웃 히스토리 확인
kubectl rollout history deployment rolling-demo -n demo

# 특정 리비전 상세 확인
kubectl rollout history deployment rolling-demo -n demo --revision=1
kubectl rollout history deployment rolling-demo -n demo --revision=2
```

**예상 출력:**

```
deployment.apps/rolling-demo
REVISION  CHANGE-CAUSE
1         <none>
2         kubectl set image deployment/rolling-demo nginx=nginx:1.25-alpine --record=true
3         kubectl set image deployment/rolling-demo nginx=nginx:alpine --record=true
```

**Step 7: 정리**

```bash
kubectl delete deployment rolling-demo -n demo
```

**확인 문제:**

1. `maxSurge: 1, maxUnavailable: 0` 설정의 장단점은 무엇인가?
2. `maxSurge: 0, maxUnavailable: 1` 설정은 어떤 시나리오에 적합한가?
3. Rolling Update와 Recreate 전략의 차이점은 무엇인가?
4. `kubectl rollout status`가 반환하는 시점은 언제인가?
5. `--record` 플래그의 역할은 무엇인가? (참고: 이 플래그는 deprecated 되었다.)

---

### Lab 2.3: Rollback 실습 (rollout undo --to-revision)

**학습 목표:**
- Deployment의 롤백(rollout undo) 메커니즘을 이해한다.
- 특정 리비전으로의 롤백(`--to-revision`)을 실습한다.
- 롤백 후 ReplicaSet 상태를 확인한다.

**관련 CKAD 도메인:** Application Deployment — Rollbacks

**Step 1: 여러 리비전이 있는 Deployment 생성**

```bash
# 초기 배포 (revision 1)
kubectl create deployment rollback-demo --image=nginx:1.23-alpine --replicas=3 -n demo
kubectl rollout status deployment rollback-demo -n demo

# 이미지 업데이트 (revision 2)
kubectl set image deployment/rollback-demo nginx=nginx:1.24-alpine -n demo
kubectl rollout status deployment rollback-demo -n demo

# 이미지 업데이트 (revision 3)
kubectl set image deployment/rollback-demo nginx=nginx:1.25-alpine -n demo
kubectl rollout status deployment rollback-demo -n demo

# 잘못된 이미지로 업데이트 (revision 4 — 의도적 실패)
kubectl set image deployment/rollback-demo nginx=nginx:nonexistent-tag -n demo
```

**Step 2: 실패한 배포 상태 확인**

```bash
# Pod 상태 확인 — ImagePullBackOff 또는 ErrImagePull
kubectl get pods -n demo -l app=rollback-demo

# 롤아웃 상태 확인 (타임아웃 대기 중)
kubectl rollout status deployment rollback-demo -n demo --timeout=10s 2>&1 || echo "롤아웃 실패!"

# ReplicaSet 상태 확인
kubectl get replicaset -n demo -l app=rollback-demo
```

**예상 출력:**

```
NAME                          READY   STATUS             RESTARTS   AGE
rollback-demo-aaa-111         2/2     Running            0          2m
rollback-demo-aaa-222         2/2     Running            0          2m
rollback-demo-aaa-333         2/2     Running            0          2m
rollback-demo-bbb-111         0/2     ImagePullBackOff   0          30s
```

**Step 3: 롤백 실행**

```bash
# 바로 이전 리비전으로 롤백
kubectl rollout undo deployment rollback-demo -n demo

# 롤백 후 상태 확인
kubectl rollout status deployment rollback-demo -n demo
kubectl get pods -n demo -l app=rollback-demo

# 현재 이미지 확인 (revision 3의 이미지로 복원되어야 함)
kubectl get deployment rollback-demo -n demo -o jsonpath='{.spec.template.spec.containers[0].image}'
echo ""
```

**예상 출력:**

```
nginx:1.25-alpine
```

**Step 4: 특정 리비전으로 롤백**

```bash
# 롤아웃 히스토리 확인
kubectl rollout history deployment rollback-demo -n demo

# revision 1(nginx:1.23-alpine)로 롤백
kubectl rollout undo deployment rollback-demo -n demo --to-revision=1

# 결과 확인
kubectl rollout status deployment rollback-demo -n demo
kubectl get deployment rollback-demo -n demo -o jsonpath='{.spec.template.spec.containers[0].image}'
echo ""
```

**예상 출력:**

```
nginx:1.23-alpine
```

**Step 5: ReplicaSet과 리비전의 관계 확인**

```bash
# 모든 ReplicaSet과 해당 이미지 확인
kubectl get replicaset -n demo -l app=rollback-demo -o jsonpath='{range .items[*]}{"RS: "}{.metadata.name}{" Replicas: "}{.spec.replicas}{" Image: "}{.spec.template.spec.containers[0].image}{"\n"}{end}'
```

각 리비전은 별도의 ReplicaSet으로 유지되며, 롤백 시 해당 ReplicaSet의 replicas가 다시 설정되는 것을 확인할 수 있다.

**Step 6: revisionHistoryLimit 확인**

```bash
# Deployment의 revisionHistoryLimit 확인 (기본값: 10)
kubectl get deployment rollback-demo -n demo -o jsonpath='{.spec.revisionHistoryLimit}'
echo ""
```

**Step 7: 정리**

```bash
kubectl delete deployment rollback-demo -n demo
```

**확인 문제:**

1. `kubectl rollout undo`와 `kubectl rollout undo --to-revision=N`의 차이점은 무엇인가?
2. 롤백 시 새로운 리비전 번호가 부여되는가, 아니면 이전 번호로 돌아가는가?
3. `revisionHistoryLimit`을 0으로 설정하면 어떤 문제가 발생하는가?
4. 롤백은 기본적으로 어떤 Kubernetes 오브젝트를 조작하는 것인가?
5. 롤백 중에도 maxSurge/maxUnavailable 전략이 적용되는가?

---

### Lab 2.4: Canary 배포 관찰 (httpbin v1:80% v2:20% 실제 트래픽 테스트)

**학습 목표:**
- Istio VirtualService를 활용한 가중치 기반 Canary 배포를 관찰한다.
- v1(80%)과 v2(20%)로 트래픽이 분배되는 것을 실제로 확인한다.
- 헤더 기반 라우팅(x-canary:true -> v2)을 테스트한다.

**관련 CKAD 도메인:** Application Deployment — Canary Deployments

**Step 1: httpbin v1, v2 Deployment 확인**

```bash
# httpbin 관련 Deployment 확인
kubectl get deployments -n demo -l app=httpbin

# Pod 목록 (레이블로 v1, v2 구분)
kubectl get pods -n demo -l app=httpbin --show-labels

# v1 Deployment: 2 replicas
kubectl get deployment -n demo -l app=httpbin,version=v1

# v2 Deployment: 1 replica
kubectl get deployment -n demo -l app=httpbin,version=v2
```

**Step 2: Istio VirtualService 확인**

```bash
# VirtualService 확인 — weight 필드에서 트래픽 비율 확인
kubectl get virtualservice -n demo -o yaml
```

**예상 출력 (핵심 부분):**

```yaml
spec:
  hosts:
    - httpbin
  http:
    - match:
        - headers:
            x-canary:
              exact: "true"
      route:
        - destination:
            host: httpbin
            subset: v2
    - route:
        - destination:
            host: httpbin
            subset: v1
          weight: 80
        - destination:
            host: httpbin
            subset: v2
          weight: 20
```

**Step 3: DestinationRule 확인 (subset 정의)**

```bash
# DestinationRule에서 v1, v2 subset 정의 확인
kubectl get destinationrule -n demo -o yaml
```

**예상 출력 (핵심 부분):**

```yaml
spec:
  host: httpbin
  subsets:
    - name: v1
      labels:
        version: v1
    - name: v2
      labels:
        version: v2
  trafficPolicy:
    outlierDetection:
      consecutive5xxErrors: 3
      interval: 30s
      baseEjectionTime: 30s
```

**Step 4: 가중치 기반 트래픽 분배 테스트**

```bash
# 임시 Pod에서 httpbin으로 100번 요청하여 v1/v2 분배 확인
kubectl run canary-test --image=busybox:1.36 --rm -it --restart=Never -n demo -- sh -c '
echo "=== 100회 요청으로 트래픽 분배 테스트 ==="
v1_count=0
v2_count=0
for i in $(seq 1 100); do
  response=$(wget -qO- http://httpbin:80/headers 2>/dev/null)
  if echo "$response" | grep -q "v1"; then
    v1_count=$((v1_count + 1))
  elif echo "$response" | grep -q "v2"; then
    v2_count=$((v2_count + 1))
  fi
done
echo "v1 응답: $v1_count 회"
echo "v2 응답: $v2_count 회"
echo "예상: v1 ~80회, v2 ~20회"
'
```

**예상 출력:**

```
=== 100회 요청으로 트래픽 분배 테스트 ===
v1 응답: 78 회
v2 응답: 22 회
예상: v1 ~80회, v2 ~20회
```

**Step 5: 헤더 기반 라우팅 테스트 (x-canary:true -> v2)**

```bash
# x-canary:true 헤더를 포함한 요청은 항상 v2로 라우팅
kubectl run canary-header-test --image=busybox:1.36 --rm -it --restart=Never -n demo -- sh -c '
echo "=== 헤더 기반 라우팅 테스트 (x-canary:true) ==="
for i in $(seq 1 10); do
  response=$(wget -qO- --header="x-canary: true" http://httpbin:80/headers 2>/dev/null)
  echo "Request $i: $(echo $response | head -1)"
done
echo "모든 요청이 v2로 라우팅되어야 한다"
'
```

**Step 6: Kubernetes 네이티브 Canary와 Istio Canary 비교**

```bash
echo "=== 현재 replica 수 vs 트래픽 비율 ==="
echo "httpbin-v1: $(kubectl get deployment -n demo -l app=httpbin,version=v1 -o jsonpath='{.items[0].spec.replicas}') replicas -> 80% traffic"
echo "httpbin-v2: $(kubectl get deployment -n demo -l app=httpbin,version=v2 -o jsonpath='{.items[0].spec.replicas}') replicas -> 20% traffic"
```

**확인 문제:**

1. Istio VirtualService의 `weight` 필드는 무엇을 의미하는가?
2. 헤더 기반 라우팅과 가중치 기반 라우팅의 우선순위는 어떻게 되는가?
3. Kubernetes 네이티브 Canary와 Istio Canary의 차이점 3가지를 설명하시오.
4. DestinationRule의 `subset`은 어떤 레이블을 기준으로 Pod를 분류하는가?
5. Canary 배포에서 v2의 에러율이 높아지면 어떻게 대응해야 하는가?

---

### Lab 2.5: Canary 비율 변경 (VirtualService 수정 -> 50:50 -> 0:100)

**학습 목표:**
- VirtualService의 weight를 실시간으로 변경하여 트래픽 비율을 조정한다.
- Canary 배포의 점진적 롤아웃 과정을 체험한다.
- 트래픽 비율 변경 시 즉시 적용되는 것을 확인한다.

**관련 CKAD 도메인:** Application Deployment — Traffic Management

**Step 1: 현재 VirtualService weight 확인**

```bash
kubectl get virtualservice httpbin -n demo -o jsonpath='{range .spec.http[1].route[*]}{"subset: "}{.destination.subset}{" weight: "}{.weight}{"\n"}{end}'
```

**예상 출력:**

```
subset: v1 weight: 80
subset: v2 weight: 20
```

**Step 2: 50:50으로 변경**

```bash
kubectl patch virtualservice httpbin -n demo --type='json' -p='[
  {"op": "replace", "path": "/spec/http/1/route/0/weight", "value": 50},
  {"op": "replace", "path": "/spec/http/1/route/1/weight", "value": 50}
]'

kubectl get virtualservice httpbin -n demo -o jsonpath='{range .spec.http[1].route[*]}{"subset: "}{.destination.subset}{" weight: "}{.weight}{"\n"}{end}'

kubectl run canary-50-test --image=busybox:1.36 --rm -it --restart=Never -n demo -- sh -c '
v1=0; v2=0
for i in $(seq 1 50); do
  resp=$(wget -qO- http://httpbin:80/headers 2>/dev/null)
  echo "$resp" | grep -q "v1" && v1=$((v1+1))
  echo "$resp" | grep -q "v2" && v2=$((v2+1))
done
echo "v1: $v1, v2: $v2 (예상: 각각 ~25)"
'
```

**Step 3: 0:100으로 변경 (v2로 완전 전환)**

```bash
kubectl patch virtualservice httpbin -n demo --type='json' -p='[
  {"op": "replace", "path": "/spec/http/1/route/0/weight", "value": 0},
  {"op": "replace", "path": "/spec/http/1/route/1/weight", "value": 100}
]'

kubectl run canary-100-test --image=busybox:1.36 --rm -it --restart=Never -n demo -- sh -c '
v1=0; v2=0
for i in $(seq 1 20); do
  resp=$(wget -qO- http://httpbin:80/headers 2>/dev/null)
  echo "$resp" | grep -q "v1" && v1=$((v1+1))
  echo "$resp" | grep -q "v2" && v2=$((v2+1))
done
echo "v1: $v1, v2: $v2 (예상: v1=0, v2=20)"
'
```

**Step 4: 원래 비율(80:20)로 복원**

```bash
kubectl patch virtualservice httpbin -n demo --type='json' -p='[
  {"op": "replace", "path": "/spec/http/1/route/0/weight", "value": 80},
  {"op": "replace", "path": "/spec/http/1/route/1/weight", "value": 20}
]'

kubectl get virtualservice httpbin -n demo -o jsonpath='{range .spec.http[1].route[*]}{"subset: "}{.destination.subset}{" weight: "}{.weight}{"\n"}{end}'
```

**확인 문제:**

1. VirtualService의 weight를 변경하면 기존 연결(in-flight request)은 어떻게 되는가?
2. weight의 합이 100이 아니면 어떻게 되는가?
3. Canary 배포에서 점진적으로 20% -> 50% -> 100%로 전환하는 이유는 무엇인가?
4. `kubectl patch`와 `kubectl edit`의 차이점은 무엇인가?

---

### Lab 2.6: Helm 실습 (helm list, helm get values, helm upgrade)

**학습 목표:**
- Helm의 기본 명령어(list, status, get values, history)를 실습한다.
- tart-infra에 설치된 Helm 릴리스를 분석한다.
- Helm Chart의 values 오버라이드 개념을 이해한다.

**관련 CKAD 도메인:** Application Deployment — Helm

**Step 1: Helm 릴리스 목록 확인**

```bash
helm list -A --kubeconfig kubeconfig/dev-kubeconfig
```

**예상 출력:**

```
NAME                NAMESPACE    REVISION  UPDATED                                 STATUS    CHART                          APP VERSION
cilium              kube-system  1         2024-01-10 10:00:00.000000000 +0900 KST deployed  cilium-1.15.0                  1.15.0
prometheus-stack    monitoring   1         2024-01-10 10:00:00.000000000 +0900 KST deployed  kube-prometheus-stack-55.0.0    0.71.0
argocd              argocd       1         2024-01-10 10:00:00.000000000 +0900 KST deployed  argo-cd-5.51.0                 2.10.0
jenkins             jenkins      1         2024-01-10 10:00:00.000000000 +0900 KST deployed  jenkins-4.8.0                  2.426.1
loki                monitoring   1         2024-01-10 10:00:00.000000000 +0900 KST deployed  loki-5.42.0                    2.9.3
metrics-server      kube-system  1         2024-01-10 10:00:00.000000000 +0900 KST deployed  metrics-server-3.11.0          0.6.4
```

**Step 2: 특정 릴리스 상세 확인**

```bash
helm status metrics-server -n kube-system --kubeconfig kubeconfig/dev-kubeconfig
helm get values metrics-server -n kube-system --kubeconfig kubeconfig/dev-kubeconfig
helm get values metrics-server -n kube-system --kubeconfig kubeconfig/dev-kubeconfig -a | head -50
```

**Step 3: 릴리스 히스토리 확인**

```bash
helm history metrics-server -n kube-system --kubeconfig kubeconfig/dev-kubeconfig
helm history prometheus-stack -n monitoring --kubeconfig kubeconfig/dev-kubeconfig
```

**Step 4: Helm Chart 정보 확인**

```bash
helm get manifest metrics-server -n kube-system --kubeconfig kubeconfig/dev-kubeconfig | head -50
helm get manifest metrics-server -n kube-system --kubeconfig kubeconfig/dev-kubeconfig | grep "^kind:" | sort -u
```

**Step 5: Helm으로 테스트 앱 설치/업그레이드/롤백**

```bash
helm repo add bitnami https://charts.bitnami.com/bitnami 2>/dev/null
helm repo update

# dry-run으로 먼저 확인
helm install test-nginx bitnami/nginx \
  --namespace demo \
  --set replicaCount=2 \
  --set service.type=ClusterIP \
  --dry-run \
  --kubeconfig kubeconfig/dev-kubeconfig

# 실제 설치
helm install test-nginx bitnami/nginx \
  --namespace demo \
  --set replicaCount=2 \
  --set service.type=ClusterIP \
  --kubeconfig kubeconfig/dev-kubeconfig

# 설치 확인
helm list -n demo --kubeconfig kubeconfig/dev-kubeconfig

# 업그레이드 (replicas 변경)
helm upgrade test-nginx bitnami/nginx \
  --namespace demo \
  --set replicaCount=3 \
  --set service.type=ClusterIP \
  --kubeconfig kubeconfig/dev-kubeconfig

# 히스토리 확인
helm history test-nginx -n demo --kubeconfig kubeconfig/dev-kubeconfig

# 롤백
helm rollback test-nginx 1 -n demo --kubeconfig kubeconfig/dev-kubeconfig

# 정리
helm uninstall test-nginx -n demo --kubeconfig kubeconfig/dev-kubeconfig
```

**확인 문제:**

1. `helm list`와 `helm list -A`의 차이점은 무엇인가?
2. `helm get values`와 `helm get values -a`의 차이점은 무엇인가?
3. `helm upgrade --install`의 의미는 무엇인가?
4. `helm rollback`은 Deployment의 `kubectl rollout undo`와 어떻게 다른가?
5. `--dry-run` 플래그는 어떤 상황에서 유용한가?

---

### Lab 2.7: Kustomize 실습 (base+overlay 구조로 dev/staging 분리)

**학습 목표:**
- Kustomize의 base/overlay 구조를 이해한다.
- 환경별(dev/staging) 설정 분리를 Kustomize로 구현한다.
- `kubectl apply -k` 명령으로 Kustomize 리소스를 배포한다.

**관련 CKAD 도메인:** Application Deployment — Kustomize

**Step 1: Kustomize base 구조 생성**

```bash
mkdir -p /tmp/kustomize-demo/base
mkdir -p /tmp/kustomize-demo/overlays/dev
mkdir -p /tmp/kustomize-demo/overlays/staging

cat <<'EOF' > /tmp/kustomize-demo/base/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: kustomize-app
spec:
  replicas: 1
  selector:
    matchLabels:
      app: kustomize-app
  template:
    metadata:
      labels:
        app: kustomize-app
    spec:
      containers:
        - name: app
          image: nginx:alpine
          ports:
            - containerPort: 80
          resources:
            requests:
              cpu: 50m
              memory: 64Mi
            limits:
              cpu: 100m
              memory: 128Mi
EOF

cat <<'EOF' > /tmp/kustomize-demo/base/service.yaml
apiVersion: v1
kind: Service
metadata:
  name: kustomize-app
spec:
  selector:
    app: kustomize-app
  ports:
    - port: 80
      targetPort: 80
EOF

cat <<'EOF' > /tmp/kustomize-demo/base/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - deployment.yaml
  - service.yaml
commonLabels:
  managed-by: kustomize
EOF
```

**Step 2: dev overlay 생성**

```bash
cat <<'EOF' > /tmp/kustomize-demo/overlays/dev/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: demo
namePrefix: dev-
resources:
  - ../../base
patches:
  - target:
      kind: Deployment
      name: kustomize-app
    patch: |
      - op: replace
        path: /spec/replicas
        value: 2
      - op: add
        path: /spec/template/spec/containers/0/env
        value:
          - name: APP_ENV
            value: development
          - name: LOG_LEVEL
            value: debug
commonLabels:
  env: dev
EOF
```

**Step 3: staging overlay 생성**

```bash
cat <<'EOF' > /tmp/kustomize-demo/overlays/staging/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: demo
namePrefix: staging-
resources:
  - ../../base
patches:
  - target:
      kind: Deployment
      name: kustomize-app
    patch: |
      - op: replace
        path: /spec/replicas
        value: 3
      - op: add
        path: /spec/template/spec/containers/0/env
        value:
          - name: APP_ENV
            value: staging
          - name: LOG_LEVEL
            value: info
      - op: replace
        path: /spec/template/spec/containers/0/resources/requests/cpu
        value: 100m
      - op: replace
        path: /spec/template/spec/containers/0/resources/limits/cpu
        value: 200m
commonLabels:
  env: staging
EOF
```

**Step 4: Kustomize build 결과 비교**

```bash
echo "=== BASE ==="
kubectl kustomize /tmp/kustomize-demo/base

echo "=== DEV ==="
kubectl kustomize /tmp/kustomize-demo/overlays/dev

echo "=== STAGING ==="
kubectl kustomize /tmp/kustomize-demo/overlays/staging
```

**Step 5: dev overlay 배포**

```bash
kubectl apply -k /tmp/kustomize-demo/overlays/dev

kubectl get deployment dev-kustomize-app -n demo
kubectl get svc dev-kustomize-app -n demo
kubectl get pods -n demo -l app=kustomize-app,env=dev

DEV_POD=$(kubectl get pods -n demo -l app=kustomize-app,env=dev -o jsonpath='{.items[0].metadata.name}')
kubectl exec $DEV_POD -n demo -- env | grep APP_ENV
kubectl exec $DEV_POD -n demo -- env | grep LOG_LEVEL
```

**Step 6: 정리**

```bash
kubectl delete -k /tmp/kustomize-demo/overlays/dev 2>/dev/null
rm -rf /tmp/kustomize-demo
```

**확인 문제:**

1. Kustomize의 base와 overlay의 관계를 설명하시오.
2. `namePrefix`와 `nameSuffix`의 용도는 무엇인가?
3. `kubectl apply -k`와 `kubectl kustomize | kubectl apply -f -`의 차이점은 무엇인가?
4. Kustomize와 Helm의 주요 차이점 3가지는 무엇인가?
5. `commonLabels`를 사용할 때 주의할 점은 무엇인가?

---

### Lab 2.8: ArgoCD GitOps 흐름 체험 (매니페스트 수정 -> push -> auto-sync)

**학습 목표:**
- GitOps의 핵심 원칙(Git을 Single Source of Truth로 사용)을 이해한다.
- ArgoCD의 auto-sync 메커니즘을 관찰한다.
- tart-infra의 ArgoCD 설정(manifests/demo/ 디렉토리 감시)을 분석한다.

**관련 CKAD 도메인:** Application Deployment — GitOps (참고 학습)

**배경 지식:**
tart-infra에서 ArgoCD는 Git 레포지토리의 `manifests/demo/` 디렉토리를 감시한다. 이 디렉토리의 매니페스트가 변경되면 ArgoCD가 자동으로 변경 사항을 클러스터에 동기화(auto-sync)한다.

**Step 1: ArgoCD 서버 접근**

```bash
kubectl get svc -n argocd
kubectl get svc argocd-server -n argocd -o jsonpath='{.spec.type}:{.spec.ports[0].nodePort}'
echo ""

# ArgoCD 초기 관리자 비밀번호 확인
kubectl get secret argocd-initial-admin-secret -n argocd -o jsonpath='{.data.password}' | base64 -d
echo ""
```

**Step 2: ArgoCD Application 목록 확인**

```bash
kubectl get application -n argocd
kubectl get application -n argocd -o yaml | head -80
```

**Step 3: ArgoCD 동기화 상태 확인**

```bash
kubectl get application -n argocd -o jsonpath='{range .items[*]}{"App: "}{.metadata.name}{"\n  Sync: "}{.status.sync.status}{"\n  Health: "}{.status.health.status}{"\n  Source: "}{.spec.source.path}{"\n"}{end}'
```

**예상 출력:**

```
App: demo-apps
  Sync: Synced
  Health: Healthy
  Source: manifests/demo/
```

**Step 4: GitOps 워크플로우 이해**

```
1. 개발자가 manifests/demo/ 디렉토리의 YAML 파일을 수정한다.
2. Git에 commit + push한다.
3. ArgoCD가 Git 변경을 감지한다 (주기적 poll 또는 webhook).
4. auto-sync가 활성화되어 있으므로 자동으로 클러스터에 적용한다.
5. ArgoCD UI에서 동기화 상태를 확인할 수 있다.
```

**Step 5: 동기화 히스토리 확인**

```bash
kubectl get application -n argocd -o jsonpath='{range .items[*]}{"App: "}{.metadata.name}{"\nHistory:\n"}{range .status.history[*]}{"  Rev: "}{.revision}{" Deployed: "}{.deployedAt}{"\n"}{end}{end}'
```

**확인 문제:**

1. GitOps에서 "Single Source of Truth"의 의미는 무엇인가?
2. ArgoCD의 auto-sync와 manual sync의 차이점은 무엇인가?
3. ArgoCD에서 "OutOfSync" 상태는 무엇을 의미하는가?
4. `kubectl apply`로 직접 변경한 것과 Git을 통해 변경한 것의 차이는 ArgoCD 관점에서 무엇인가?
5. GitOps의 장점 3가지를 설명하시오.

---

## 실습 3: Application Observability and Maintenance (15%)

> **CKAD 시험 도메인:** Application Observability and Maintenance
> 이 영역은 Health Check(Probe), 로그 분석, 디버깅, 리소스 모니터링 능력을 평가한다.

---

### Lab 3.1: Probe 분석 — keycloak의 readiness/liveness probe 상세 확인

**학습 목표:**
- Kubernetes의 세 가지 Probe(liveness, readiness, startup)를 이해한다.
- keycloak에 설정된 실제 Probe를 분석한다.
- 각 Probe 파라미터(initialDelaySeconds, periodSeconds 등)의 의미를 파악한다.

**관련 CKAD 도메인:** Application Observability and Maintenance — Health Checks

**배경 지식:**
keycloak은 Java 기반 IAM 서버로 시작 시간이 길다. 따라서 적절한 Probe 설정이 중요하다.

- **readinessProbe:** httpGet /health/ready:8080, initialDelaySeconds=30, periodSeconds=10
- **livenessProbe:** httpGet /health/live:8080, initialDelaySeconds=60, periodSeconds=30

**Step 1: keycloak Pod의 Probe 설정 확인**

```bash
KEYCLOAK_POD=$(kubectl get pods -n demo -l app=keycloak -o jsonpath='{.items[0].metadata.name}')
kubectl describe pod $KEYCLOAK_POD -n demo | grep -A 15 "Liveness:\|Readiness:\|Startup:"
```

**예상 출력:**

```
    Liveness:       http-get http://:8080/health/live delay=60s timeout=1s period=30s #success=1 #failure=3
    Readiness:      http-get http://:8080/health/ready delay=30s timeout=1s period=10s #success=1 #failure=3
```

**Step 2: Probe 설정 YAML 상세 분석**

```bash
kubectl get deployment keycloak -n demo -o yaml | grep -A 10 "livenessProbe:\|readinessProbe:"
```

**예상 YAML:**

```yaml
readinessProbe:
  httpGet:
    path: /health/ready
    port: 8080
  initialDelaySeconds: 30
  periodSeconds: 10
livenessProbe:
  httpGet:
    path: /health/live
    port: 8080
  initialDelaySeconds: 60
  periodSeconds: 30
```

**Step 3: Probe 파라미터 의미**

| 파라미터 | 값 | 의미 |
|---------|---|------|
| initialDelaySeconds | 30 (readiness), 60 (liveness) | 컨테이너 시작 후 첫 Probe까지 대기 시간 |
| periodSeconds | 10 (readiness), 30 (liveness) | Probe 실행 주기 |
| timeoutSeconds | 1 (기본값) | Probe 응답 대기 시간 |
| successThreshold | 1 (기본값) | 연속 성공 횟수 (Ready 판정) |
| failureThreshold | 3 (기본값) | 연속 실패 횟수 (Failed 판정) |

**Step 4: Probe 엔드포인트 직접 호출**

```bash
kubectl exec $KEYCLOAK_POD -n demo -c keycloak -- curl -s http://localhost:8080/health/ready
echo ""
kubectl exec $KEYCLOAK_POD -n demo -c keycloak -- curl -s http://localhost:8080/health/live
echo ""
```

**예상 출력:**

```json
{"status":"UP","checks":[]}
```

**Step 5: readiness/liveness Probe의 차이점 이해**

```bash
kubectl get pod $KEYCLOAK_POD -n demo -o jsonpath='{range .status.conditions[*]}{"type: "}{.type}{" status: "}{.status}{"\n"}{end}'
kubectl get events -n demo --field-selector involvedObject.name=$KEYCLOAK_POD --sort-by=.metadata.creationTimestamp | tail -10
```

| | Readiness Probe 실패 | Liveness Probe 실패 |
|---|---|---|
| 동작 | Service Endpoint에서 제거 (트래픽 수신 중단) | 컨테이너 재시작 |
| 영향 | 트래픽이 다른 Ready Pod로 분산 | 컨테이너 restart count 증가 |
| 복구 | Probe 성공 시 자동으로 Endpoint 복원 | 재시작 후 Probe 성공 시 정상화 |

**확인 문제:**

1. keycloak의 readiness Probe initialDelaySeconds가 30초인 이유는 무엇인가?
2. liveness Probe의 initialDelaySeconds가 readiness보다 긴(60초) 이유는 무엇인가?
3. Readiness Probe가 실패하면 Pod은 어떤 상태가 되는가?
4. Liveness Probe가 실패하면 Pod은 어떤 상태가 되는가?
5. readiness Probe의 periodSeconds를 1초로 설정하면 어떤 문제가 발생할 수 있는가?

---

### Lab 3.2: Liveness Probe 추가 — nginx에 httpGet probe 추가

**학습 목표:**
- nginx Deployment에 liveness Probe를 추가하는 실습을 수행한다.
- Probe 추가 후 Pod 재생성 과정을 관찰한다.
- Liveness Probe 실패 시 컨테이너 재시작을 확인한다.

**관련 CKAD 도메인:** Application Observability and Maintenance — Liveness Probes

**Step 1: 테스트용 nginx Deployment 생성 (Probe 없이)**

```bash
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nginx-probe-test
spec:
  replicas: 2
  selector:
    matchLabels:
      app: nginx-probe-test
  template:
    metadata:
      labels:
        app: nginx-probe-test
    spec:
      containers:
        - name: nginx
          image: nginx:alpine
          ports:
            - containerPort: 80
          resources:
            requests:
              cpu: 10m
              memory: 16Mi
            limits:
              cpu: 50m
              memory: 32Mi
EOF

kubectl rollout status deployment nginx-probe-test -n demo
```

**Step 2: Liveness Probe 추가**

```bash
kubectl patch deployment nginx-probe-test -n demo --type='json' -p='[
  {
    "op": "add",
    "path": "/spec/template/spec/containers/0/livenessProbe",
    "value": {
      "httpGet": {
        "path": "/",
        "port": 80
      },
      "initialDelaySeconds": 5,
      "periodSeconds": 10,
      "timeoutSeconds": 3,
      "failureThreshold": 3
    }
  }
]'

kubectl rollout status deployment nginx-probe-test -n demo

PROBE_POD=$(kubectl get pods -n demo -l app=nginx-probe-test -o jsonpath='{.items[0].metadata.name}')
kubectl describe pod $PROBE_POD -n demo | grep -A 5 "Liveness:"
```

**Step 3: Liveness Probe 실패 유도**

```bash
PROBE_POD=$(kubectl get pods -n demo -l app=nginx-probe-test -o jsonpath='{.items[0].metadata.name}')
kubectl exec $PROBE_POD -n demo -c nginx -- rm /usr/share/nginx/html/index.html

# Pod 상태 모니터링 (liveness Probe 실패 -> 재시작 관찰)
kubectl get pod $PROBE_POD -n demo -w
```

**예상 출력:**

```
NAME                                READY   STATUS    RESTARTS   AGE
nginx-probe-test-xxxxx-aaaa         2/2     Running   0          2m
nginx-probe-test-xxxxx-aaaa         1/2     Running   1          3m
nginx-probe-test-xxxxx-aaaa         2/2     Running   1          3m
```

**Step 4: 재시작 이벤트 확인**

```bash
kubectl describe pod $PROBE_POD -n demo | grep -A 5 "Events:"
kubectl get events -n demo --field-selector involvedObject.name=$PROBE_POD --sort-by=.metadata.creationTimestamp
```

**예상 출력 (Events):**

```
Warning  Unhealthy  Liveness probe failed: HTTP probe failed with statuscode: 404
Normal   Killing    Container nginx failed liveness probe, will be restarted
```

**Step 5: 정리**

```bash
kubectl delete deployment nginx-probe-test -n demo
```

**확인 문제:**

1. httpGet Probe에서 HTTP 상태 코드 200~399가 성공으로 간주되는가?
2. failureThreshold=3, periodSeconds=10일 때, Probe 실패 후 컨테이너가 재시작되기까지 최대 몇 초가 걸리는가?
3. Liveness Probe로 인한 재시작은 Pod의 RESTARTS 카운터에 반영되는가?
4. httpGet Probe 외에 사용할 수 있는 Probe 유형 2가지는 무엇인가?

---

### Lab 3.3: Readiness Probe 추가 — httpbin에 tcpSocket probe 추가

**학습 목표:**
- tcpSocket 방식의 Readiness Probe를 설정한다.
- Readiness Probe 실패 시 Service Endpoint에서 제거되는 것을 확인한다.

**관련 CKAD 도메인:** Application Observability and Maintenance — Readiness Probes

**Step 1: 테스트 Deployment 생성 (tcpSocket Readiness Probe 포함)**

```bash
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: readiness-tcp-test
spec:
  replicas: 2
  selector:
    matchLabels:
      app: readiness-tcp-test
  template:
    metadata:
      labels:
        app: readiness-tcp-test
    spec:
      containers:
        - name: nginx
          image: nginx:alpine
          ports:
            - containerPort: 80
          readinessProbe:
            tcpSocket:
              port: 80
            initialDelaySeconds: 5
            periodSeconds: 5
          resources:
            requests:
              cpu: 10m
              memory: 16Mi
            limits:
              cpu: 50m
              memory: 32Mi
---
apiVersion: v1
kind: Service
metadata:
  name: readiness-tcp-test
spec:
  selector:
    app: readiness-tcp-test
  ports:
    - port: 80
      targetPort: 80
EOF

kubectl rollout status deployment readiness-tcp-test -n demo
```

**Step 2: Endpoint 확인**

```bash
kubectl get endpoints readiness-tcp-test -n demo
kubectl get pods -n demo -l app=readiness-tcp-test -o wide
```

**Step 3: Readiness 실패 유도**

```bash
TCP_POD=$(kubectl get pods -n demo -l app=readiness-tcp-test -o jsonpath='{.items[0].metadata.name}')
kubectl exec $TCP_POD -n demo -c nginx -- nginx -s stop

sleep 10
kubectl get endpoints readiness-tcp-test -n demo
kubectl get pod $TCP_POD -n demo
```

**예상 결과:** Pod의 READY가 `1/2`(또는 `0/2`)로 변경되고, Endpoint에서 해당 Pod IP가 제거된다.

**Step 4: 정리**

```bash
kubectl delete deployment readiness-tcp-test -n demo
kubectl delete svc readiness-tcp-test -n demo
```

**확인 문제:**

1. tcpSocket Probe와 httpGet Probe의 차이점은 무엇인가?
2. Readiness Probe 실패 시 Pod이 재시작되는가?
3. exec Probe는 어떤 경우에 사용하는가?

---

### Lab 3.4: Startup Probe 추가 — keycloak에 startup probe 추가

**학습 목표:**
- Startup Probe의 역할과 필요성을 이해한다.
- 시작이 느린 애플리케이션(keycloak)에 적합한 Startup Probe를 설계한다.
- Startup Probe와 Liveness/Readiness Probe의 관계를 파악한다.

**관련 CKAD 도메인:** Application Observability and Maintenance — Startup Probes

**배경 지식:**
keycloak처럼 시작 시간이 긴 애플리케이션은 Liveness Probe의 `initialDelaySeconds`를 매우 크게 설정해야 한다. 하지만 이렇게 하면 정상 운영 중 장애 감지도 느려진다. Startup Probe는 이 문제를 해결한다. Startup Probe가 성공할 때까지 Liveness/Readiness Probe가 실행되지 않으므로, 시작 시간에 대한 유연한 대기와 운영 중 빠른 장애 감지를 모두 달성할 수 있다.

**Step 1: Startup Probe가 있는 테스트 Pod 생성**

```bash
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: v1
kind: Pod
metadata:
  name: startup-probe-demo
  labels:
    app: startup-probe-demo
spec:
  containers:
    - name: slow-app
      image: busybox:1.36
      command:
        - sh
        - -c
        - |
          echo "앱 시작 중... (30초 소요)"
          sleep 30
          touch /tmp/ready
          echo "앱 시작 완료!"
          touch /tmp/healthy
          sleep 3600
      startupProbe:
        exec:
          command:
            - cat
            - /tmp/ready
        failureThreshold: 30
        periodSeconds: 2
      livenessProbe:
        exec:
          command:
            - cat
            - /tmp/healthy
        initialDelaySeconds: 0
        periodSeconds: 5
      readinessProbe:
        exec:
          command:
            - cat
            - /tmp/ready
        periodSeconds: 5
      resources:
        requests:
          cpu: 10m
          memory: 16Mi
EOF
```

**Step 2: Startup Probe 동작 관찰**

```bash
kubectl get pod startup-probe-demo -n demo -w
```

**예상 출력 (시간 순서):**

```
NAME                  READY   STATUS    RESTARTS   AGE
startup-probe-demo    0/1     Running   0          5s
startup-probe-demo    0/1     Running   0          30s
startup-probe-demo    1/1     Running   0          35s
```

**Step 3: Startup Probe 실패 시 동작 관찰**

```bash
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: v1
kind: Pod
metadata:
  name: startup-probe-fail
  labels:
    app: startup-probe-fail
spec:
  containers:
    - name: slow-app
      image: busybox:1.36
      command: ["sh", "-c", "sleep 3600"]
      startupProbe:
        exec:
          command: ["cat", "/tmp/ready"]
        failureThreshold: 5
        periodSeconds: 2
      resources:
        requests:
          cpu: 10m
          memory: 16Mi
EOF

sleep 15
kubectl get pod startup-probe-fail -n demo
kubectl describe pod startup-probe-fail -n demo | grep -A 5 "Events:" | tail -5
```

**Step 4: Startup Probe 타임아웃 계산**

```bash
echo "=== Startup Probe 최대 대기 시간 계산 ==="
echo "failureThreshold(30) x periodSeconds(2) = 60초"
echo "즉, 앱이 60초 이내에 /tmp/ready 파일을 생성해야 한다"
echo ""
echo "=== keycloak 권장 Startup Probe ==="
echo "failureThreshold: 30, periodSeconds: 10 -> 최대 300초(5분) 대기"
echo "keycloak은 시작에 1~3분 소요되므로 충분한 여유가 있다"
```

**Step 5: 정리**

```bash
kubectl delete pod startup-probe-demo startup-probe-fail -n demo --grace-period=0 --force 2>/dev/null
```

**확인 문제:**

1. Startup Probe가 성공하기 전에 Liveness Probe가 실행되는가?
2. Startup Probe의 최대 대기 시간은 어떻게 계산하는가?
3. Startup Probe 없이 keycloak의 Liveness Probe initialDelaySeconds를 300초로 설정하면 어떤 문제가 있는가?
4. Startup Probe가 한번 성공하면, 이후에도 계속 실행되는가?

---

### Lab 3.5: 로그 분석 — kubectl logs (단일, multi-container, --previous)

**학습 목표:**
- `kubectl logs`의 다양한 옵션을 실습한다.
- Multi-container Pod에서 특정 컨테이너 로그를 조회한다.
- 크래시된 컨테이너의 이전 로그를 확인한다.

**관련 CKAD 도메인:** Application Observability and Maintenance — Logging

**Step 1: 단일 컨테이너 Pod 로그**

```bash
REDIS_POD=$(kubectl get pods -n demo -l app=redis -o jsonpath='{.items[0].metadata.name}')
kubectl logs $REDIS_POD -n demo -c redis --tail=20

POSTGRES_POD=$(kubectl get pods -n demo -l app=postgres -o jsonpath='{.items[0].metadata.name}')
kubectl logs $POSTGRES_POD -n demo -c postgres --tail=20
```

**Step 2: Multi-container Pod 로그 (Istio sidecar)**

```bash
NGINX_POD=$(kubectl get pods -n demo -l app=nginx-web -o jsonpath='{.items[0].metadata.name}')

# 메인 컨테이너(nginx) 로그
kubectl logs $NGINX_POD -n demo -c nginx --tail=10

# Sidecar 컨테이너(istio-proxy) 로그
kubectl logs $NGINX_POD -n demo -c istio-proxy --tail=10

# 모든 컨테이너 로그를 동시에 출력
kubectl logs $NGINX_POD -n demo --all-containers --tail=5
```

**Step 3: 레이블 셀렉터로 여러 Pod 로그 조회**

```bash
kubectl logs -l app=httpbin -n demo --tail=5 --all-containers
kubectl logs -l app=nginx-web -n demo --tail=3 -c nginx
```

**Step 4: 실시간 로그 스트리밍**

```bash
# -f(follow) 옵션으로 실시간 로그 (Ctrl+C로 종료)
kubectl logs $NGINX_POD -n demo -c nginx -f &
LOG_PID=$!

kubectl run log-traffic --image=busybox:1.36 --rm -it --restart=Never -n demo -- sh -c '
for i in $(seq 1 5); do
  wget -qO- http://nginx-web:80 2>/dev/null
  sleep 1
done
'

kill $LOG_PID 2>/dev/null
```

**Step 5: 시간 기반 로그 조회**

```bash
kubectl logs $NGINX_POD -n demo -c nginx --since=1h
kubectl logs $NGINX_POD -n demo -c nginx --since=30m
```

**Step 6: 이전(previous) 컨테이너 로그**

```bash
kubectl logs $NGINX_POD -n demo -c nginx --previous 2>&1 || echo "이전 컨테이너 인스턴스가 없다"

cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: v1
kind: Pod
metadata:
  name: crash-log-demo
  labels:
    app: crash-log-demo
spec:
  containers:
    - name: app
      image: busybox:1.36
      command: ["sh", "-c", "echo 'App started at $(date)' && echo 'Processing...' && sleep 10 && echo 'FATAL ERROR' && exit 1"]
      resources:
        requests:
          cpu: 10m
          memory: 16Mi
EOF

sleep 20

kubectl logs crash-log-demo -n demo
kubectl logs crash-log-demo -n demo --previous

kubectl delete pod crash-log-demo -n demo --grace-period=0 --force 2>/dev/null
```

**확인 문제:**

1. `kubectl logs -l app=httpbin -n demo`는 어떤 Pod의 로그를 출력하는가?
2. `--previous` 플래그는 어떤 상황에서 사용하는가?
3. `--since`와 `--since-time`의 차이점은 무엇인가?
4. Multi-container Pod에서 `-c`를 생략하면 어떤 일이 발생하는가?
5. `--tail=N`과 `--since=1h`를 동시에 사용하면 어떤 결과가 나오는가?

---

### Lab 3.6: 디버깅 — kubectl exec로 Pod 내부 조사

**학습 목표:**
- `kubectl exec`를 사용하여 실행 중인 컨테이너 내부를 조사한다.
- 네트워크 연결, 파일 시스템, 프로세스, 환경변수 등을 확인한다.

**관련 CKAD 도메인:** Application Observability and Maintenance — Debugging

**Step 1: nginx Pod 내부 조사**

```bash
NGINX_POD=$(kubectl get pods -n demo -l app=nginx-web -o jsonpath='{.items[0].metadata.name}')

kubectl exec $NGINX_POD -n demo -c nginx -- cat /etc/nginx/nginx.conf
kubectl exec $NGINX_POD -n demo -c nginx -- ps aux
kubectl exec $NGINX_POD -n demo -c nginx -- cat /proc/meminfo | head -5
kubectl exec $NGINX_POD -n demo -c nginx -- env | sort
```

**Step 2: 네트워크 연결 테스트**

```bash
kubectl exec $NGINX_POD -n demo -c nginx -- cat /etc/resolv.conf
kubectl exec $NGINX_POD -n demo -c nginx -- wget -qO- http://httpbin:80/get --timeout=5 2>/dev/null | head -5
```

**Step 3: postgres 컨테이너 내부 조사**

```bash
POSTGRES_POD=$(kubectl get pods -n demo -l app=postgres -o jsonpath='{.items[0].metadata.name}')
kubectl exec $POSTGRES_POD -n demo -c postgres -- env | grep POSTGRES
kubectl exec $POSTGRES_POD -n demo -c postgres -- df -h
```

**예상 출력 (환경변수):**

```
POSTGRES_DB=demo
POSTGRES_USER=demo
POSTGRES_PASSWORD=demo123
```

**Step 4: 다중 컨테이너 Pod에서 특정 컨테이너 exec**

```bash
kubectl exec $NGINX_POD -n demo -c nginx -- hostname
kubectl exec $NGINX_POD -n demo -c istio-proxy -- pilot-agent request GET /stats | head -10

kubectl exec $NGINX_POD -n demo -c nginx -- ls /etc/nginx/
kubectl exec $NGINX_POD -n demo -c istio-proxy -- ls /etc/istio/
```

**확인 문제:**

1. `kubectl exec -it`과 `kubectl exec` (without -it)의 차이점은 무엇인가?
2. 같은 Pod 내의 두 컨테이너가 파일 시스템을 공유하는가?
3. `kubectl exec`로 Pod 내부에서 실행한 명령은 어디에 기록되는가?
4. distroless 이미지에서 `kubectl exec`로 셸에 접속할 수 없는 이유는 무엇인가?

---

### Lab 3.7: 디버깅 — kubectl debug ephemeral container

**학습 목표:**
- `kubectl debug`로 ephemeral container를 추가하여 디버깅한다.
- 셸이 없는(distroless) 컨테이너를 디버깅하는 방법을 익힌다.
- 노드 디버깅을 실습한다.

**관련 CKAD 도메인:** Application Observability and Maintenance — Debugging with Ephemeral Containers

**Step 1: 기본 ephemeral container 디버깅**

```bash
NGINX_POD=$(kubectl get pods -n demo -l app=nginx-web -o jsonpath='{.items[0].metadata.name}')

# ephemeral container 추가 (busybox로 디버깅)
kubectl debug -it $NGINX_POD -n demo --image=busybox:1.36 --target=nginx -- sh

# ephemeral container에서 실행할 수 있는 디버깅 명령:
# - wget -qO- http://localhost:80
# - nslookup httpbin.demo.svc.cluster.local
# - exit
```

**Step 2: Pod 복사본으로 디버깅**

```bash
kubectl debug $NGINX_POD -n demo --copy-to=debug-nginx --container=debug-shell --image=busybox:1.36 -- sh -c "sleep 3600"
kubectl exec -it debug-nginx -n demo -c debug-shell -- sh

kubectl delete pod debug-nginx -n demo --grace-period=0 --force 2>/dev/null
```

**Step 3: 네트워크 도구가 포함된 이미지로 디버깅**

```bash
kubectl run netdebug --image=nicolaka/netshoot --rm -it --restart=Never -n demo -- sh -c '
echo "=== DNS 테스트 ==="
nslookup httpbin.demo.svc.cluster.local

echo "=== HTTP 테스트 ==="
curl -s http://httpbin:80/get | head -5

echo "=== TCP 연결 테스트 ==="
nc -zv redis 6379
'
```

**확인 문제:**

1. Ephemeral container와 일반 컨테이너의 차이점은 무엇인가?
2. `--target` 플래그의 역할은 무엇인가?
3. Ephemeral container는 Pod 재시작 후에도 유지되는가?
4. `kubectl debug --copy-to`는 어떤 상황에서 유용한가?

---

### Lab 3.8: 리소스 모니터링 — kubectl top + Grafana 대시보드

**학습 목표:**
- `kubectl top`으로 Pod/Node 리소스 사용량을 확인한다.
- metrics-server의 역할을 이해한다.
- tart-infra의 Grafana 대시보드를 활용한 모니터링을 체험한다.

**관련 CKAD 도메인:** Application Observability and Maintenance — Resource Monitoring

**Step 1: Pod 리소스 사용량 확인**

```bash
kubectl top pods -n demo
kubectl top pods -n demo --sort-by=cpu
kubectl top pods -n demo --sort-by=memory
kubectl top pods -n demo --containers
```

**예상 출력:**

```
NAME                          CPU(cores)   MEMORY(bytes)
keycloak-xxxxx-aaaa           150m         512Mi
postgres-xxxxx-aaaa           20m          64Mi
rabbitmq-xxxxx-aaaa           30m          128Mi
nginx-web-xxxxx-aaaa          5m           16Mi
nginx-web-xxxxx-bbbb          5m           16Mi
nginx-web-xxxxx-cccc          5m           16Mi
httpbin-v1-xxxxx-aaaa         10m          32Mi
httpbin-v1-xxxxx-bbbb         10m          32Mi
httpbin-v2-xxxxx-aaaa         10m          32Mi
redis-xxxxx-aaaa              5m           8Mi
```

**Step 2: Node 리소스 사용량 확인**

```bash
kubectl top nodes
kubectl describe nodes | grep -A 10 "Allocated resources:"
```

**Step 3: nginx-web의 리소스 사용량 vs 설정 비교**

```bash
echo "=== nginx-web 리소스 설정 ==="
kubectl get deployment nginx-web -n demo -o jsonpath='Requests: CPU={.spec.template.spec.containers[0].resources.requests.cpu}, Memory={.spec.template.spec.containers[0].resources.requests.memory}'
echo ""
kubectl get deployment nginx-web -n demo -o jsonpath='Limits: CPU={.spec.template.spec.containers[0].resources.limits.cpu}, Memory={.spec.template.spec.containers[0].resources.limits.memory}'
echo ""

echo "=== nginx-web 실제 사용량 ==="
kubectl top pods -n demo -l app=nginx-web
```

**Step 4: Grafana 접근**

```bash
# platform 클러스터의 Grafana에 접근
# export KUBECONFIG=kubeconfig/platform-kubeconfig
# 브라우저에서 http://<platform-node-ip>:30300 접속
# 대시보드 -> Kubernetes / Compute Resources / Pod
# Namespace: demo 선택
```

**확인 문제:**

1. `kubectl top pods`가 동작하려면 어떤 컴포넌트가 설치되어 있어야 하는가?
2. Pod의 실제 CPU 사용량이 limits를 초과하면 어떻게 되는가?
3. Pod의 실제 메모리 사용량이 limits를 초과하면 어떻게 되는가?
4. `--sort-by=cpu`와 `--sort-by=memory`는 어떤 값을 기준으로 정렬하는가?

---

## 실습 4: Application Environment, Configuration and Security (25%)

> **CKAD 시험 도메인:** Application Environment, Configuration and Security
> 이 영역은 ConfigMap, Secret, SecurityContext, ServiceAccount, ResourceQuota, LimitRange 등을 평가한다. CKAD 시험에서 가장 큰 비중(25%)을 차지하는 핵심 영역이다.

---

### Lab 4.1: ConfigMap 생성 (from-literal, from-file)

**학습 목표:**
- ConfigMap을 다양한 방식(from-literal, from-file, YAML)으로 생성한다.
- ConfigMap의 데이터 구조를 이해한다.

**관련 CKAD 도메인:** Application Environment, Configuration and Security — ConfigMaps

**Step 1: from-literal로 ConfigMap 생성**

```bash
kubectl create configmap app-settings \
  --from-literal=APP_NAME=demo-app \
  --from-literal=APP_ENV=development \
  --from-literal=LOG_LEVEL=debug \
  --from-literal=MAX_CONNECTIONS=100 \
  -n demo

kubectl get configmap app-settings -n demo -o yaml
```

**Step 2: from-file로 ConfigMap 생성**

```bash
cat <<'EOF' > /tmp/nginx-custom.conf
server {
    listen 80;
    server_name localhost;
    location / {
        root /usr/share/nginx/html;
        index index.html;
    }
    location /health {
        access_log off;
        return 200 'OK';
    }
}
EOF

cat <<'EOF' > /tmp/app.properties
db.host=postgres.demo.svc.cluster.local
db.port=5432
db.name=demo
cache.host=redis.demo.svc.cluster.local
cache.port=6379
mq.host=rabbitmq.demo.svc.cluster.local
mq.port=5672
EOF

kubectl create configmap app-files-config \
  --from-file=/tmp/nginx-custom.conf \
  --from-file=/tmp/app.properties \
  -n demo

kubectl get configmap app-files-config -n demo -o yaml
```

**Step 3: YAML로 ConfigMap 생성**

```bash
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-yaml-config
data:
  APP_NAME: demo-app
  APP_VERSION: "1.0.0"
  config.json: |
    {
      "database": {
        "host": "postgres.demo.svc.cluster.local",
        "port": 5432,
        "name": "demo"
      },
      "cache": {
        "host": "redis.demo.svc.cluster.local",
        "port": 6379
      }
    }
EOF

kubectl get configmap app-yaml-config -n demo -o yaml
```

**Step 4: dry-run으로 ConfigMap YAML 생성 (CKAD 시험 팁)**

```bash
kubectl create configmap exam-config \
  --from-literal=KEY1=value1 \
  --from-literal=KEY2=value2 \
  --dry-run=client -o yaml
```

**Step 5: 정리**

```bash
kubectl delete configmap app-settings app-files-config app-yaml-config -n demo 2>/dev/null
rm -f /tmp/nginx-custom.conf /tmp/app.properties
```

**확인 문제:**

1. `--from-literal`과 `--from-file`로 생성된 ConfigMap의 data 구조 차이는 무엇인가?
2. ConfigMap의 data 값에 멀티라인 문자열을 포함하려면 YAML에서 어떤 구문을 사용하는가?
3. ConfigMap은 namespace-scoped인가, cluster-scoped인가?

---

### Lab 4.2: ConfigMap을 env로 주입

**학습 목표:**
- ConfigMap 데이터를 Pod의 환경변수로 주입하는 방법을 실습한다.
- `envFrom`과 `env.valueFrom.configMapKeyRef`의 차이를 이해한다.

**관련 CKAD 도메인:** Application Environment, Configuration and Security — ConfigMap as Environment Variables

**Step 1: ConfigMap 생성**

```bash
kubectl create configmap db-config \
  --from-literal=DB_HOST=postgres.demo.svc.cluster.local \
  --from-literal=DB_PORT=5432 \
  --from-literal=DB_NAME=demo \
  -n demo
```

**Step 2: envFrom으로 모든 키를 환경변수로 주입**

```bash
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: v1
kind: Pod
metadata:
  name: cm-env-all
  labels:
    app: cm-env-test
spec:
  containers:
    - name: app
      image: busybox:1.36
      command: ["sh", "-c", "env | sort && sleep 3600"]
      envFrom:
        - configMapRef:
            name: db-config
      resources:
        requests:
          cpu: 10m
          memory: 16Mi
EOF

sleep 5
kubectl exec cm-env-all -n demo -- env | grep DB_
```

**예상 출력:**

```
DB_HOST=postgres.demo.svc.cluster.local
DB_NAME=demo
DB_PORT=5432
```

**Step 3: configMapKeyRef로 특정 키만 환경변수로 주입**

```bash
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: v1
kind: Pod
metadata:
  name: cm-env-select
  labels:
    app: cm-env-test
spec:
  containers:
    - name: app
      image: busybox:1.36
      command: ["sh", "-c", "echo DATABASE=$DATABASE_HOST:$DATABASE_PORT && sleep 3600"]
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
      resources:
        requests:
          cpu: 10m
          memory: 16Mi
EOF

sleep 5
kubectl exec cm-env-select -n demo -- env | grep DATABASE
```

**예상 출력:**

```
DATABASE_HOST=postgres.demo.svc.cluster.local
DATABASE_PORT=5432
```

**Step 4: 정리**

```bash
kubectl delete pod cm-env-all cm-env-select -n demo --grace-period=0 --force 2>/dev/null
kubectl delete configmap db-config -n demo 2>/dev/null
```

**확인 문제:**

1. `envFrom`과 `env.valueFrom.configMapKeyRef`의 차이점은 무엇인가?
2. ConfigMap이 업데이트되면 이미 실행 중인 Pod의 환경변수도 업데이트되는가?
3. `envFrom`에서 키 이름이 유효한 환경변수 이름이 아닌 경우(예: 하이픈 포함) 어떻게 되는가?

---

### Lab 4.3: ConfigMap을 volume으로 마운트

**학습 목표:**
- ConfigMap을 Volume으로 마운트하여 설정 파일로 사용한다.
- subPath 마운트와 전체 디렉토리 마운트의 차이를 이해한다.
- ConfigMap 업데이트 시 Volume의 자동 갱신을 확인한다.

**관련 CKAD 도메인:** Application Environment, Configuration and Security — ConfigMap as Volume

**Step 1: ConfigMap 생성**

```bash
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: v1
kind: ConfigMap
metadata:
  name: nginx-vol-config
data:
  default.conf: |
    server {
        listen 80;
        server_name localhost;
        location / {
            return 200 'ConfigMap Version 1\n';
            add_header Content-Type text/plain;
        }
    }
  extra.conf: |
    # 추가 설정 파일
EOF
```

**Step 2: ConfigMap을 Volume으로 마운트하는 Pod 생성**

```bash
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: v1
kind: Pod
metadata:
  name: cm-vol-demo
  labels:
    app: cm-vol-demo
spec:
  containers:
    - name: nginx
      image: nginx:alpine
      ports:
        - containerPort: 80
      volumeMounts:
        - name: config
          mountPath: /etc/nginx/conf.d
      resources:
        requests:
          cpu: 10m
          memory: 16Mi
  volumes:
    - name: config
      configMap:
        name: nginx-vol-config
EOF

sleep 5
```

**Step 3: 마운트된 설정 파일 확인**

```bash
kubectl exec cm-vol-demo -n demo -- ls -la /etc/nginx/conf.d/
kubectl exec cm-vol-demo -n demo -- cat /etc/nginx/conf.d/default.conf
kubectl exec cm-vol-demo -n demo -- wget -qO- http://localhost:80
```

**Step 4: 정리**

```bash
kubectl delete pod cm-vol-demo -n demo --grace-period=0 --force 2>/dev/null
kubectl delete configmap nginx-vol-config -n demo 2>/dev/null
```

**확인 문제:**

1. ConfigMap Volume 마운트와 env 주입의 차이점은 무엇인가?
2. ConfigMap 업데이트 시 Volume에 마운트된 파일이 자동 갱신되는 메커니즘은 무엇인가?
3. subPath로 마운트한 경우 자동 갱신이 되는가?
4. ConfigMap Volume에서 `items` 필드를 사용하면 어떤 효과가 있는가?

---

### Lab 4.4: Secret 생성 (generic, from-literal)

**학습 목표:**
- Secret을 다양한 방식으로 생성한다.
- Secret의 base64 인코딩을 이해한다.
- Secret과 ConfigMap의 차이점을 파악한다.

**관련 CKAD 도메인:** Application Environment, Configuration and Security — Secrets

**Step 1: from-literal로 Secret 생성**

```bash
kubectl create secret generic app-secret \
  --from-literal=DB_PASSWORD=demo123 \
  --from-literal=API_KEY=abc-xyz-123 \
  --from-literal=JWT_SECRET=my-super-secret-jwt-key \
  -n demo

kubectl get secret app-secret -n demo -o yaml
```

**Step 2: base64 디코딩**

```bash
kubectl get secret app-secret -n demo -o jsonpath='{.data.DB_PASSWORD}' | base64 -d
echo ""

kubectl get secret app-secret -n demo -o json | jq -r '.data | to_entries[] | "\(.key): \(.value | @base64d)"'
```

**Step 3: YAML로 Secret 생성**

```bash
echo -n 'demo' | base64       # ZGVtbw==
echo -n 'demo123' | base64    # ZGVtbzEyMw==

cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: v1
kind: Secret
metadata:
  name: db-secret-yaml
type: Opaque
data:
  username: ZGVtbw==
  password: ZGVtbzEyMw==
---
apiVersion: v1
kind: Secret
metadata:
  name: db-secret-stringdata
type: Opaque
stringData:
  username: demo
  password: demo123
EOF

kubectl get secret db-secret-stringdata -n demo -o yaml | grep -A 3 "data:"
```

**Step 4: tart-infra의 postgres, rabbitmq Secret 확인**

```bash
POSTGRES_POD=$(kubectl get pods -n demo -l app=postgres -o jsonpath='{.items[0].metadata.name}')
kubectl get pod $POSTGRES_POD -n demo -o yaml | grep -A 15 "env:"

RABBITMQ_POD=$(kubectl get pods -n demo -l app=rabbitmq -o jsonpath='{.items[0].metadata.name}')
kubectl get pod $RABBITMQ_POD -n demo -o yaml | grep -A 15 "env:"
```

**Step 5: 정리**

```bash
kubectl delete secret app-secret db-secret-yaml db-secret-stringdata -n demo 2>/dev/null
```

**확인 문제:**

1. Secret의 `data`와 `stringData`의 차이점은 무엇인가?
2. Secret의 base64 인코딩은 암호화인가?
3. `kubectl create secret generic`과 `kubectl create secret tls`의 차이점은 무엇인가?
4. Secret의 type: Opaque는 무엇을 의미하는가?

---

### Lab 4.5: Secret을 Pod에 마운트 (postgres 패스워드)

**학습 목표:**
- Secret을 환경변수로 주입하는 방법과 Volume으로 마운트하는 방법을 모두 실습한다.
- tart-infra의 postgres가 Secret으로 패스워드를 관리하는 방식을 분석한다.

**관련 CKAD 도메인:** Application Environment, Configuration and Security — Secret Consumption

**Step 1: Secret 생성**

```bash
kubectl create secret generic pg-credentials \
  --from-literal=POSTGRES_USER=demo \
  --from-literal=POSTGRES_PASSWORD=demo123 \
  --from-literal=POSTGRES_DB=demo \
  -n demo
```

**Step 2: 환경변수로 Secret 주입**

```bash
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: v1
kind: Pod
metadata:
  name: secret-env-demo
  labels:
    app: secret-demo
spec:
  containers:
    - name: app
      image: busybox:1.36
      command: ["sh", "-c", "echo DB=$POSTGRES_USER:$POSTGRES_PASSWORD@postgres:5432/$POSTGRES_DB && sleep 3600"]
      envFrom:
        - secretRef:
            name: pg-credentials
      resources:
        requests:
          cpu: 10m
          memory: 16Mi
EOF

sleep 5
kubectl logs secret-env-demo -n demo
```

**Step 3: Volume으로 Secret 마운트**

```bash
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: v1
kind: Pod
metadata:
  name: secret-vol-demo
  labels:
    app: secret-demo
spec:
  containers:
    - name: app
      image: busybox:1.36
      command: ["sh", "-c", "ls -la /secrets/ && cat /secrets/POSTGRES_PASSWORD && echo '' && sleep 3600"]
      volumeMounts:
        - name: secret-volume
          mountPath: /secrets
          readOnly: true
      resources:
        requests:
          cpu: 10m
          memory: 16Mi
  volumes:
    - name: secret-volume
      secret:
        secretName: pg-credentials
        defaultMode: 0400
EOF

sleep 5
kubectl exec secret-vol-demo -n demo -- ls -la /secrets/
kubectl exec secret-vol-demo -n demo -- cat /secrets/POSTGRES_PASSWORD
```

**Step 4: 정리**

```bash
kubectl delete pod secret-env-demo secret-vol-demo -n demo --grace-period=0 --force 2>/dev/null
kubectl delete secret pg-credentials -n demo 2>/dev/null
```

**확인 문제:**

1. Secret을 환경변수로 주입하는 것과 Volume으로 마운트하는 것의 보안 차이는 무엇인가?
2. `defaultMode: 0400`의 의미는 무엇인가?
3. Secret Volume이 tmpfs에 마운트되는 이유는 무엇인가?

---

### Lab 4.6: SecurityContext 분석 — demo Pod의 현재 보안 설정

**학습 목표:**
- Pod/Container 수준의 SecurityContext를 이해한다.
- tart-infra demo Pod에 적용된 보안 설정을 분석한다.

**관련 CKAD 도메인:** Application Environment, Configuration and Security — SecurityContext

**Step 1: 모든 Pod의 SecurityContext 확인**

```bash
kubectl get pods -n demo -o jsonpath='{range .items[*]}{"=== "}{.metadata.name}{" ===\n"}{"  podSecurity: "}{.spec.securityContext}{"\n"}{range .spec.containers[*]}{"  container("}{.name}{"): "}{.securityContext}{"\n"}{end}{"\n"}{end}'
```

**Step 2: 컨테이너 내부에서 보안 설정 확인**

```bash
NGINX_POD=$(kubectl get pods -n demo -l app=nginx-web -o jsonpath='{.items[0].metadata.name}')
kubectl exec $NGINX_POD -n demo -c nginx -- id
kubectl exec $NGINX_POD -n demo -c nginx -- cat /proc/1/status | grep -i cap
kubectl exec $NGINX_POD -n demo -c nginx -- touch /tmp/test 2>&1 && echo "쓰기 가능" || echo "쓰기 불가"
```

**확인 문제:**

1. Pod-level SecurityContext와 Container-level SecurityContext의 차이점은 무엇인가?
2. Container-level SecurityContext가 Pod-level보다 우선순위가 높은가?

---

### Lab 4.7: SecurityContext 실습 — runAsUser, readOnlyRootFilesystem

**학습 목표:**
- `runAsUser`, `runAsNonRoot`, `readOnlyRootFilesystem` 설정을 실습한다.
- 각 설정이 컨테이너 동작에 미치는 영향을 확인한다.

**관련 CKAD 도메인:** Application Environment, Configuration and Security — SecurityContext

**Step 1: runAsUser 실습**

```bash
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: v1
kind: Pod
metadata:
  name: sc-user-demo
  labels:
    app: sc-demo
spec:
  securityContext:
    runAsUser: 1000
    runAsGroup: 3000
    fsGroup: 2000
  containers:
    - name: app
      image: busybox:1.36
      command: ["sh", "-c", "id && ls -la /data && sleep 3600"]
      volumeMounts:
        - name: data
          mountPath: /data
      resources:
        requests:
          cpu: 10m
          memory: 16Mi
  volumes:
    - name: data
      emptyDir: {}
EOF

sleep 5
kubectl exec sc-user-demo -n demo -- id
kubectl exec sc-user-demo -n demo -- ls -la /data
```

**예상 출력:**

```
uid=1000 gid=3000 groups=2000
```

**Step 2: readOnlyRootFilesystem 실습**

```bash
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: v1
kind: Pod
metadata:
  name: sc-readonly-demo
  labels:
    app: sc-demo
spec:
  containers:
    - name: app
      image: busybox:1.36
      command: ["sh", "-c", "echo 'Running with readOnly root filesystem' && sleep 3600"]
      securityContext:
        readOnlyRootFilesystem: true
      volumeMounts:
        - name: tmp
          mountPath: /tmp
      resources:
        requests:
          cpu: 10m
          memory: 16Mi
  volumes:
    - name: tmp
      emptyDir: {}
EOF

sleep 5

kubectl exec sc-readonly-demo -n demo -- touch /test-file 2>&1 || echo "readOnly: 쓰기 불가!"
kubectl exec sc-readonly-demo -n demo -- touch /tmp/test-file && echo "/tmp 쓰기 성공"
```

**Step 3: runAsNonRoot 실습**

```bash
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: v1
kind: Pod
metadata:
  name: sc-nonroot-fail
  labels:
    app: sc-demo
spec:
  containers:
    - name: app
      image: busybox:1.36
      command: ["sh", "-c", "sleep 3600"]
      securityContext:
        runAsNonRoot: true
      resources:
        requests:
          cpu: 10m
          memory: 16Mi
EOF

sleep 5
kubectl get pod sc-nonroot-fail -n demo
kubectl describe pod sc-nonroot-fail -n demo | tail -5
```

**예상 출력:**

```
Error: container has runAsNonRoot and image will run as root
```

**Step 4: 정리**

```bash
kubectl delete pod sc-user-demo sc-readonly-demo sc-nonroot-fail -n demo --grace-period=0 --force 2>/dev/null
```

**확인 문제:**

1. `runAsUser: 1000`과 `runAsNonRoot: true`의 차이점은 무엇인가?
2. `fsGroup`은 어떤 경우에 사용하는가?
3. `readOnlyRootFilesystem: true` 설정 시 /tmp에 쓸 수 있게 하려면 어떻게 해야 하는가?
4. `allowPrivilegeEscalation: false`의 의미와 용도는 무엇인가?

---

### Lab 4.8: capabilities 실습 — NET_ADMIN 추가/제거

**학습 목표:**
- Linux capabilities의 개념을 이해한다.
- 컨테이너에 capabilities를 추가/제거하는 방법을 실습한다.

**관련 CKAD 도메인:** Application Environment, Configuration and Security — Capabilities

**Step 1: 기본 capabilities 확인**

```bash
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: v1
kind: Pod
metadata:
  name: cap-default
  labels:
    app: cap-demo
spec:
  containers:
    - name: app
      image: busybox:1.36
      command: ["sh", "-c", "cat /proc/1/status | grep -i cap && sleep 3600"]
      resources:
        requests:
          cpu: 10m
          memory: 16Mi
EOF

sleep 5
kubectl logs cap-default -n demo
```

**Step 2: capabilities 추가 (NET_ADMIN)**

```bash
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: v1
kind: Pod
metadata:
  name: cap-add
  labels:
    app: cap-demo
spec:
  containers:
    - name: app
      image: busybox:1.36
      command: ["sh", "-c", "cat /proc/1/status | grep -i cap && sleep 3600"]
      securityContext:
        capabilities:
          add: ["NET_ADMIN", "SYS_TIME"]
      resources:
        requests:
          cpu: 10m
          memory: 16Mi
EOF

sleep 5
kubectl logs cap-add -n demo
```

**Step 3: 모든 capabilities 제거**

```bash
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: v1
kind: Pod
metadata:
  name: cap-drop-all
  labels:
    app: cap-demo
spec:
  containers:
    - name: app
      image: busybox:1.36
      command: ["sh", "-c", "cat /proc/1/status | grep -i cap && sleep 3600"]
      securityContext:
        capabilities:
          drop: ["ALL"]
      resources:
        requests:
          cpu: 10m
          memory: 16Mi
EOF

sleep 5
kubectl logs cap-drop-all -n demo
```

**Step 4: 정리**

```bash
kubectl delete pod cap-default cap-add cap-drop-all -n demo --grace-period=0 --force 2>/dev/null
```

**확인 문제:**

1. Linux capabilities는 root 권한을 어떻게 세분화하는가?
2. `drop: ["ALL"]` 후 `add: ["NET_BIND_SERVICE"]`는 어떤 의미인가?
3. NET_ADMIN capability가 필요한 실제 사례는 무엇인가?

---

### Lab 4.9: ServiceAccount 생성 및 Pod 연결

**학습 목표:**
- ServiceAccount를 생성하고 Pod에 연결하는 방법을 실습한다.
- `automountServiceAccountToken`의 역할을 이해한다.

**관련 CKAD 도메인:** Application Environment, Configuration and Security — ServiceAccounts

**Step 1: ServiceAccount 생성**

```bash
kubectl create serviceaccount app-sa -n demo
kubectl get serviceaccount app-sa -n demo -o yaml
```

**Step 2: Pod에 ServiceAccount 연결**

```bash
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: v1
kind: Pod
metadata:
  name: sa-demo
  labels:
    app: sa-demo
spec:
  serviceAccountName: app-sa
  containers:
    - name: app
      image: busybox:1.36
      command: ["sh", "-c", "ls /var/run/secrets/kubernetes.io/serviceaccount/ && sleep 3600"]
      resources:
        requests:
          cpu: 10m
          memory: 16Mi
EOF

sleep 5
kubectl exec sa-demo -n demo -- cat /var/run/secrets/kubernetes.io/serviceaccount/namespace
echo ""
kubectl exec sa-demo -n demo -- ls /var/run/secrets/kubernetes.io/serviceaccount/
```

**Step 3: automountServiceAccountToken 비활성화**

```bash
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: v1
kind: Pod
metadata:
  name: sa-no-mount
  labels:
    app: sa-demo
spec:
  serviceAccountName: app-sa
  automountServiceAccountToken: false
  containers:
    - name: app
      image: busybox:1.36
      command: ["sh", "-c", "ls /var/run/secrets/kubernetes.io/serviceaccount/ 2>&1 || echo 'Token not mounted' && sleep 3600"]
      resources:
        requests:
          cpu: 10m
          memory: 16Mi
EOF

sleep 5
kubectl exec sa-no-mount -n demo -- ls /var/run/secrets/kubernetes.io/serviceaccount/ 2>&1 || echo "토큰이 마운트되지 않았다"
```

**Step 4: 현재 demo Pod의 ServiceAccount 확인**

```bash
kubectl get pods -n demo -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.serviceAccountName}{"\n"}{end}'
```

**Step 5: 정리**

```bash
kubectl delete pod sa-demo sa-no-mount -n demo --grace-period=0 --force 2>/dev/null
kubectl delete serviceaccount app-sa -n demo 2>/dev/null
```

**확인 문제:**

1. ServiceAccount를 지정하지 않으면 어떤 ServiceAccount가 사용되는가?
2. `automountServiceAccountToken: false`를 설정하면 어떤 효과가 있는가?
3. ServiceAccount 토큰은 어떤 경로에 마운트되는가?
4. ServiceAccount에 RBAC Role을 바인딩하는 목적은 무엇인가?

---

### Lab 4.10: Resource Requests/Limits — QoS 클래스 확인 (Guaranteed, Burstable, BestEffort)

**학습 목표:**
- Resource Requests와 Limits의 차이를 이해한다.
- QoS 클래스(Guaranteed, Burstable, BestEffort)의 판정 기준을 학습한다.
- tart-infra demo 앱의 QoS 클래스를 확인한다.

**관련 CKAD 도메인:** Application Environment, Configuration and Security — Resource Management

**Step 1: tart-infra demo 앱의 QoS 클래스 확인**

```bash
kubectl get pods -n demo -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.status.qosClass}{"\n"}{end}'
```

**Step 2: 각 QoS 클래스별 Pod 생성**

```bash
# Guaranteed: requests == limits
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: v1
kind: Pod
metadata:
  name: qos-guaranteed
  labels:
    app: qos-demo
spec:
  containers:
    - name: app
      image: busybox:1.36
      command: ["sh", "-c", "sleep 3600"]
      resources:
        requests:
          cpu: 100m
          memory: 128Mi
        limits:
          cpu: 100m
          memory: 128Mi
EOF

# Burstable: requests != limits
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: v1
kind: Pod
metadata:
  name: qos-burstable
  labels:
    app: qos-demo
spec:
  containers:
    - name: app
      image: busybox:1.36
      command: ["sh", "-c", "sleep 3600"]
      resources:
        requests:
          cpu: 50m
          memory: 64Mi
        limits:
          cpu: 200m
          memory: 256Mi
EOF

# BestEffort: requests/limits 없음
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: v1
kind: Pod
metadata:
  name: qos-besteffort
  labels:
    app: qos-demo
spec:
  containers:
    - name: app
      image: busybox:1.36
      command: ["sh", "-c", "sleep 3600"]
EOF

sleep 5
```

**Step 3: QoS 클래스 확인**

```bash
kubectl get pods -n demo -l app=qos-demo -o jsonpath='{range .items[*]}{"Pod: "}{.metadata.name}{"\n  QoS: "}{.status.qosClass}{"\n  Requests: "}{.spec.containers[0].resources.requests}{"\n  Limits: "}{.spec.containers[0].resources.limits}{"\n\n"}{end}'
```

**예상 출력:**

```
Pod: qos-guaranteed
  QoS: Guaranteed
  Requests: {"cpu":"100m","memory":"128Mi"}
  Limits: {"cpu":"100m","memory":"128Mi"}

Pod: qos-burstable
  QoS: Burstable
  Requests: {"cpu":"50m","memory":"64Mi"}
  Limits: {"cpu":"200m","memory":"256Mi"}

Pod: qos-besteffort
  QoS: BestEffort
  Requests:
  Limits:
```

**Step 4: nginx-web의 QoS 클래스 분석**

```bash
echo "=== nginx-web ==="
echo "requests: cpu=50m, memory=64Mi"
echo "limits: cpu=200m, memory=128Mi"
echo "QoS 클래스: Burstable (requests != limits)"
echo ""
echo "노드 메모리 부족 시 BestEffort -> Burstable -> Guaranteed 순서로 eviction된다."
```

**Step 5: 정리**

```bash
kubectl delete pod qos-guaranteed qos-burstable qos-besteffort -n demo --grace-period=0 --force 2>/dev/null
```

**확인 문제:**

1. Guaranteed QoS 클래스가 되려면 어떤 조건을 만족해야 하는가?
2. 노드 리소스 부족 시 어떤 QoS 클래스의 Pod가 먼저 eviction 되는가?
3. CPU limits를 초과하면 Pod은 어떻게 되는가? (throttle vs OOMKill)
4. Memory limits를 초과하면 Pod은 어떻게 되는가?
5. nginx-web의 requests(50m/64Mi)와 limits(200m/128Mi)는 어떤 QoS 클래스인가?

---

### Lab 4.11: LimitRange 생성 및 적용

**학습 목표:**
- LimitRange를 생성하여 네임스페이스 내 Pod/Container의 리소스 기본값과 제한을 설정한다.
- LimitRange가 적용된 상태에서 Pod 생성 시 동작을 확인한다.

**관련 CKAD 도메인:** Application Environment, Configuration and Security — LimitRange

**Step 1: LimitRange 생성**

```bash
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: v1
kind: LimitRange
metadata:
  name: demo-limit-range
spec:
  limits:
    - type: Container
      default:
        cpu: 200m
        memory: 256Mi
      defaultRequest:
        cpu: 100m
        memory: 128Mi
      max:
        cpu: "1"
        memory: 1Gi
      min:
        cpu: 50m
        memory: 64Mi
EOF

kubectl get limitrange demo-limit-range -n demo -o yaml
```

**Step 2: LimitRange 효과 확인**

```bash
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: v1
kind: Pod
metadata:
  name: lr-test-default
  labels:
    app: lr-test
spec:
  containers:
    - name: app
      image: busybox:1.36
      command: ["sh", "-c", "sleep 3600"]
EOF

sleep 5
kubectl get pod lr-test-default -n demo -o jsonpath='{.spec.containers[0].resources}' | jq .
```

**예상 출력:**

```json
{
  "limits": {
    "cpu": "200m",
    "memory": "256Mi"
  },
  "requests": {
    "cpu": "100m",
    "memory": "128Mi"
  }
}
```

**Step 3: LimitRange 범위 초과 테스트**

```bash
cat <<'EOF' | kubectl apply -n demo -f - 2>&1
apiVersion: v1
kind: Pod
metadata:
  name: lr-test-exceed
  labels:
    app: lr-test
spec:
  containers:
    - name: app
      image: busybox:1.36
      command: ["sh", "-c", "sleep 3600"]
      resources:
        requests:
          cpu: 2000m
          memory: 2Gi
EOF
```

**예상 출력:**

```
Error from server (Forbidden): ... maximum cpu usage per Container is 1, but limit is 2
```

**Step 4: 정리**

```bash
kubectl delete pod lr-test-default -n demo --grace-period=0 --force 2>/dev/null
kubectl delete limitrange demo-limit-range -n demo 2>/dev/null
```

**확인 문제:**

1. LimitRange의 `default`와 `defaultRequest`의 차이점은 무엇인가?
2. LimitRange는 이미 실행 중인 Pod에도 적용되는가?
3. LimitRange의 `min`보다 작은 리소스를 요청하면 어떻게 되는가?

---

### Lab 4.12: ResourceQuota 생성 및 적용

**학습 목표:**
- ResourceQuota를 생성하여 네임스페이스 전체의 리소스 총량을 제한한다.
- ResourceQuota와 LimitRange의 차이를 이해한다.

**관련 CKAD 도메인:** Application Environment, Configuration and Security — ResourceQuota

**Step 1: ResourceQuota 생성**

```bash
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: v1
kind: ResourceQuota
metadata:
  name: demo-quota
spec:
  hard:
    pods: "20"
    requests.cpu: "4"
    requests.memory: 8Gi
    limits.cpu: "8"
    limits.memory: 16Gi
    configmaps: "10"
    secrets: "10"
    services: "10"
    persistentvolumeclaims: "5"
EOF

kubectl get resourcequota demo-quota -n demo
kubectl describe resourcequota demo-quota -n demo
```

**예상 출력:**

```
Name:                   demo-quota
Namespace:              demo
Resource                Used    Hard
--------                ----    ----
configmaps              2       10
limits.cpu              1200m   8
limits.memory           1Gi     16Gi
persistentvolumeclaims  0       5
pods                    10      20
requests.cpu            600m    4
requests.memory         512Mi   8Gi
secrets                 3       10
services                6       10
```

**Step 2: 정리**

```bash
kubectl delete resourcequota demo-quota -n demo 2>/dev/null
```

**확인 문제:**

1. ResourceQuota와 LimitRange의 차이점은 무엇인가?
2. ResourceQuota가 설정된 네임스페이스에서 리소스 미지정 Pod을 생성하면 어떻게 되는가?
3. ResourceQuota의 `hard`는 무엇을 의미하는가?
4. ResourceQuota로 제한할 수 있는 리소스 유형 5가지를 나열하시오.

---

## 실습 5: Services and Networking (20%)

> **CKAD 시험 도메인:** Services and Networking
> 이 영역은 Service 유형(ClusterIP, NodePort, LoadBalancer), Ingress, NetworkPolicy, DNS 등을 평가한다.

---

### Lab 5.1: ClusterIP Service 생성 및 테스트

**학습 목표:**
- ClusterIP Service의 동작 원리를 이해한다.
- Service 생성 및 클러스터 내부 접근을 테스트한다.

**관련 CKAD 도메인:** Services and Networking — ClusterIP Service

**Step 1: tart-infra의 ClusterIP Service 확인**

```bash
kubectl get svc -n demo -o custom-columns='NAME:.metadata.name,TYPE:.spec.type,CLUSTER-IP:.spec.clusterIP,PORT:.spec.ports[0].port'
```

**예상 출력:**

```
NAME         TYPE        CLUSTER-IP      PORT
httpbin      ClusterIP   10.96.x.x       80
redis        ClusterIP   10.96.x.x       6379
postgres     ClusterIP   10.96.x.x       5432
rabbitmq     ClusterIP   10.96.x.x       5672
nginx-web    NodePort    10.96.x.x       80
keycloak     NodePort    10.96.x.x       8080
```

**Step 2: ClusterIP Service 생성**

```bash
kubectl create deployment clusterip-test --image=nginx:alpine --replicas=2 -n demo
kubectl rollout status deployment clusterip-test -n demo

kubectl expose deployment clusterip-test --port=80 --target-port=80 --type=ClusterIP -n demo

kubectl get svc clusterip-test -n demo -o yaml
kubectl get endpoints clusterip-test -n demo
```

**Step 3: ClusterIP Service 접근 테스트**

```bash
kubectl run svc-test --image=busybox:1.36 --rm -it --restart=Never -n demo -- sh -c '
echo "=== ClusterIP 접근 테스트 ==="
wget -qO- http://clusterip-test:80 --timeout=5 | head -5
echo ""
echo "=== Service FQDN 접근 ==="
wget -qO- http://clusterip-test.demo.svc.cluster.local:80 --timeout=5 | head -5
'
```

**Step 4: 정리**

```bash
kubectl delete deployment clusterip-test -n demo
kubectl delete svc clusterip-test -n demo
```

**확인 문제:**

1. ClusterIP Service의 IP는 어떤 네트워크 대역에서 할당되는가?
2. ClusterIP Service는 외부에서 접근 가능한가?
3. Service의 selector와 Pod의 labels가 일치해야 하는 이유는 무엇인가?
4. `kubectl expose`와 YAML로 Service를 생성하는 방법의 차이점은 무엇인가?

---

### Lab 5.2: NodePort Service 생성 및 외부 접근

**학습 목표:**
- NodePort Service의 동작 원리를 이해한다.
- tart-infra의 NodePort Service(nginx-web:30080, keycloak:30880)를 분석한다.

**관련 CKAD 도메인:** Services and Networking — NodePort Service

**Step 1: tart-infra의 NodePort Service 확인**

```bash
kubectl get svc -n demo -o custom-columns='NAME:.metadata.name,TYPE:.spec.type,CLUSTER-IP:.spec.clusterIP,PORT:.spec.ports[0].port,NODE-PORT:.spec.ports[0].nodePort' | grep NodePort
```

**예상 출력:**

```
NAME         TYPE       CLUSTER-IP    PORT   NODE-PORT
nginx-web    NodePort   10.96.x.x     80     30080
keycloak     NodePort   10.96.x.x     8080   30880
```

**Step 2: NodePort 상세 분석**

```bash
kubectl get svc nginx-web -n demo -o yaml

echo "=== nginx-web 접근 방법 ==="
echo "1. ClusterIP 내부: http://10.96.x.x:80"
echo "2. Service DNS: http://nginx-web.demo.svc.cluster.local:80"
echo "3. NodePort 외부: http://<node-ip>:30080"

kubectl get nodes -o jsonpath='{range .items[*]}{"Node: "}{.metadata.name}{" IP: "}{.status.addresses[?(@.type=="InternalIP")].address}{"\n"}{end}'
```

**Step 3: NodePort Service 생성 실습**

```bash
kubectl create deployment np-test --image=nginx:alpine --replicas=2 -n demo
kubectl rollout status deployment np-test -n demo
kubectl expose deployment np-test --type=NodePort --port=80 --target-port=80 -n demo

kubectl get svc np-test -n demo
```

**Step 4: 정리**

```bash
kubectl delete deployment np-test -n demo
kubectl delete svc np-test -n demo
```

**확인 문제:**

1. NodePort의 기본 범위(30000-32767)를 변경할 수 있는가?
2. NodePort Service는 ClusterIP도 포함하는가?
3. NodePort, ClusterIP, Port, TargetPort의 차이점을 각각 설명하시오.

---

### Lab 5.3: Headless Service 생성

**학습 목표:**
- Headless Service(ClusterIP: None)의 동작을 이해한다.
- DNS를 통한 Pod IP 직접 반환을 확인한다.

**관련 CKAD 도메인:** Services and Networking — Headless Services

**Step 1: Headless Service 생성**

```bash
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: headless-demo
spec:
  replicas: 3
  selector:
    matchLabels:
      app: headless-demo
  template:
    metadata:
      labels:
        app: headless-demo
    spec:
      containers:
        - name: nginx
          image: nginx:alpine
          ports:
            - containerPort: 80
          resources:
            requests:
              cpu: 10m
              memory: 16Mi
---
apiVersion: v1
kind: Service
metadata:
  name: headless-demo
spec:
  clusterIP: None
  selector:
    app: headless-demo
  ports:
    - port: 80
      targetPort: 80
EOF

kubectl rollout status deployment headless-demo -n demo
```

**Step 2: Headless Service DNS 확인**

```bash
kubectl get svc headless-demo -n demo

kubectl run dns-headless --image=busybox:1.36 --rm -it --restart=Never -n demo -- sh -c '
echo "=== Headless Service DNS ==="
nslookup headless-demo.demo.svc.cluster.local

echo ""
echo "=== 일반 ClusterIP Service DNS (비교) ==="
nslookup httpbin.demo.svc.cluster.local
'
```

**예상 출력:**

```
=== Headless Service DNS ===
Name:      headless-demo.demo.svc.cluster.local
Address 1: 10.244.0.10 headless-demo-xxxxx-aaaa
Address 2: 10.244.0.11 headless-demo-xxxxx-bbbb
Address 3: 10.244.0.12 headless-demo-xxxxx-cccc

=== 일반 ClusterIP Service DNS (비교) ===
Name:      httpbin.demo.svc.cluster.local
Address 1: 10.96.x.x httpbin.demo.svc.cluster.local
```

**Step 3: 정리**

```bash
kubectl delete deployment headless-demo -n demo
kubectl delete svc headless-demo -n demo
```

**확인 문제:**

1. Headless Service의 ClusterIP가 None인 이유는 무엇인가?
2. Headless Service DNS 조회 결과가 일반 Service와 다른 점은 무엇인가?
3. StatefulSet에서 Headless Service를 사용하는 이유는 무엇인가?

---

### Lab 5.4: Service Endpoint 확인 (httpbin v1+v2 Pod IP)

**학습 목표:**
- Service Endpoint의 개념을 이해한다.
- Endpoint에 포함되는 Pod과 제외되는 Pod의 조건을 파악한다.

**관련 CKAD 도메인:** Services and Networking — Endpoints

**Step 1: httpbin Service의 Endpoint 확인**

```bash
kubectl get endpoints httpbin -n demo
kubectl get pods -n demo -l app=httpbin -o wide
kubectl describe endpoints httpbin -n demo
```

**Step 2: 모든 Service의 Endpoint 확인**

```bash
kubectl get endpoints -n demo -o custom-columns='SERVICE:.metadata.name,ENDPOINTS:.subsets[*].addresses[*].ip'
```

**Step 3: Readiness Probe와 Endpoint의 관계**

```bash
echo "=== Endpoint 포함 조건 ==="
echo "1. Pod의 레이블이 Service selector와 일치해야 한다"
echo "2. Pod이 Running 상태여야 한다"
echo "3. Readiness Probe가 성공해야 한다"
echo ""
echo "Readiness Probe가 실패하면 Pod은 실행 중이지만 Endpoint에서 제거된다."
```

**확인 문제:**

1. Endpoint에서 Pod IP가 제거되는 경우 2가지를 설명하시오.
2. EndpointSlice와 Endpoint의 차이점은 무엇인가?
3. Service에 selector를 지정하지 않으면 Endpoint는 어떻게 되는가?

---

### Lab 5.5: Ingress 분석 (Istio Gateway -> /api, / 라우팅)

**학습 목표:**
- Kubernetes Ingress의 개념을 이해한다.
- tart-infra의 Istio Gateway를 Ingress 개념으로 분석한다.
- 경로 기반 라우팅(/api -> httpbin, / -> nginx)을 확인한다.

**관련 CKAD 도메인:** Services and Networking — Ingress

**Step 1: Istio Gateway 확인**

```bash
kubectl get gateway -n demo -o yaml
```

**예상 출력 (핵심 부분):**

```yaml
spec:
  selector:
    istio: ingressgateway
  servers:
    - port:
        number: 80
        name: http
        protocol: HTTP
      hosts:
        - "*"
```

**Step 2: VirtualService 라우팅 규칙 확인**

```bash
kubectl get virtualservice -n demo -o yaml
```

**라우팅 규칙 요약:**

| 경로 | 대상 서비스 | 비고 |
|------|------------|------|
| /api | httpbin | API 트래픽 |
| / | nginx-web | 웹 트래픽 |

**Step 3: Kubernetes 표준 Ingress 리소스로 같은 라우팅 구현 (학습용)**

```bash
cat <<'YAML'
# CKAD 시험에서 출제되는 표준 Kubernetes Ingress 형식
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: demo-ingress
  annotations:
    nginx.ingress.kubernetes.io/rewrite-target: /
spec:
  ingressClassName: nginx
  rules:
    - host: demo.example.com
      http:
        paths:
          - path: /api
            pathType: Prefix
            backend:
              service:
                name: httpbin
                port:
                  number: 80
          - path: /
            pathType: Prefix
            backend:
              service:
                name: nginx-web
                port:
                  number: 80
YAML
```

**확인 문제:**

1. Kubernetes Ingress와 Istio Gateway의 차이점은 무엇인가?
2. Ingress의 `pathType: Prefix`와 `pathType: Exact`의 차이점은 무엇인가?
3. `ingressClassName`의 역할은 무엇인가?
4. Ingress Controller가 필요한 이유는 무엇인가?

---

### Lab 5.6: NetworkPolicy — Default Deny 테스트

**학습 목표:**
- Default Deny NetworkPolicy의 개념과 구현을 이해한다.
- tart-infra에 적용된 CiliumNetworkPolicy의 default-deny를 분석한다.

**관련 CKAD 도메인:** Services and Networking — NetworkPolicy

**Step 1: 기존 CiliumNetworkPolicy 확인**

```bash
kubectl get ciliumnetworkpolicy -n demo
kubectl get ciliumnetworkpolicy default-deny-ingress -n demo -o yaml 2>/dev/null
kubectl get ciliumnetworkpolicy default-deny-egress -n demo -o yaml 2>/dev/null
```

**Step 2: 표준 Kubernetes NetworkPolicy로 Default Deny 구현 (학습용)**

```bash
cat <<'EOF'
# Default Deny All Ingress
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-ingress
  namespace: demo
spec:
  podSelector: {}
  policyTypes:
    - Ingress

---
# Default Deny All Egress
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-egress
  namespace: demo
spec:
  podSelector: {}
  policyTypes:
    - Egress
EOF
```

**Step 3: Default Deny 효과 테스트**

```bash
kubectl run deny-test --image=busybox:1.36 --rm -it --restart=Never -n demo -- sh -c '
echo "=== httpbin 접근 테스트 ==="
wget -qO- http://httpbin:80/get --timeout=3 2>&1 || echo "BLOCKED: 접근 차단됨"

echo ""
echo "=== 외부 접근 테스트 ==="
wget -qO- http://example.com --timeout=3 2>&1 || echo "BLOCKED: 외부 접근 차단됨"
'
```

**확인 문제:**

1. Default Deny NetworkPolicy에서 `podSelector: {}`의 의미는 무엇인가?
2. Default Deny Ingress와 Default Deny Egress를 모두 적용하면 DNS 해석도 차단되는가?
3. NetworkPolicy가 없는 네임스페이스의 기본 동작은 무엇인가?

---

### Lab 5.7: NetworkPolicy — 특정 Pod 허용

**학습 목표:**
- Default Deny 상태에서 특정 Pod 간 통신만 허용하는 NetworkPolicy를 작성한다.
- podSelector와 namespaceSelector를 사용한 정밀한 트래픽 제어를 실습한다.

**관련 CKAD 도메인:** Services and Networking — NetworkPolicy Allow Rules

**Step 1: 특정 Pod 간 통신 허용 NetworkPolicy 작성**

```bash
cat <<'EOF'
# nginx-web에서 httpbin으로의 Ingress 트래픽 허용
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-nginx-to-httpbin
  namespace: demo
spec:
  podSelector:
    matchLabels:
      app: httpbin
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: nginx-web
      ports:
        - protocol: TCP
          port: 80
EOF
```

**Step 2: 허용/차단 테스트**

```bash
NGINX_POD=$(kubectl get pods -n demo -l app=nginx-web -o jsonpath='{.items[0].metadata.name}')

# nginx-web -> httpbin (허용되어야 함)
kubectl exec $NGINX_POD -n demo -c nginx -- wget -qO- http://httpbin:80/get --timeout=5 2>&1 | head -5

# redis -> httpbin (차단되어야 함, default deny에 의해)
REDIS_POD=$(kubectl get pods -n demo -l app=redis -o jsonpath='{.items[0].metadata.name}')
kubectl exec $REDIS_POD -n demo -c redis -- wget -qO- http://httpbin:80/get --timeout=3 2>&1 || echo "BLOCKED"
```

**확인 문제:**

1. NetworkPolicy의 `from` 배열에 여러 항목이 있으면 AND인가 OR인가?
2. 같은 `from` 항목 내에 `podSelector`와 `namespaceSelector`가 있으면 AND인가 OR인가?
3. `podSelector`와 `namespaceSelector`를 같은 `-` 항목에 넣는 것과 별도 `-` 항목에 넣는 것의 차이는 무엇인가?

---

### Lab 5.8: L7 NetworkPolicy — HTTP 메서드 제한 (GET vs POST 테스트)

**학습 목표:**
- CiliumNetworkPolicy의 L7(HTTP) 정책을 분석한다.
- HTTP GET만 허용하고 POST는 차단하는 규칙을 테스트한다.
- 표준 NetworkPolicy(L3/L4)와 Cilium L7 정책의 차이를 이해한다.

**관련 CKAD 도메인:** Services and Networking — NetworkPolicy (확장)

**Step 1: L7 CiliumNetworkPolicy 확인**

```bash
kubectl get ciliumnetworkpolicy -n demo -o yaml | grep -A 30 "allow-nginx-to-httpbin"
```

**예상 YAML (핵심 부분):**

```yaml
spec:
  endpointSelector:
    matchLabels:
      app: httpbin
  ingress:
    - fromEndpoints:
        - matchLabels:
            app: nginx-web
      toPorts:
        - ports:
            - port: "80"
              protocol: TCP
          rules:
            http:
              - method: GET
```

**Step 2: L7 정책 테스트**

```bash
NGINX_POD=$(kubectl get pods -n demo -l app=nginx-web -o jsonpath='{.items[0].metadata.name}')

echo "=== GET 요청 테스트 ==="
kubectl exec $NGINX_POD -n demo -c nginx -- wget -qO- http://httpbin:80/get --timeout=5 2>&1 | head -3
echo "결과: 성공 (GET 허용됨)"

echo ""

echo "=== POST 요청 테스트 ==="
kubectl exec $NGINX_POD -n demo -c nginx -- wget -qO- --post-data='test=data' http://httpbin:80/post --timeout=5 2>&1 || echo "결과: 차단됨 (POST 차단)"
```

**Step 3: L3/L4 vs L7 비교**

```
표준 Kubernetes NetworkPolicy (L3/L4):
  - IP 주소 기반 필터링
  - TCP/UDP 포트 기반 필터링
  - HTTP 메서드/경로 구분 불가

CiliumNetworkPolicy (L3/L4 + L7):
  - IP/포트 기반 필터링 + HTTP 메서드/경로 필터링
  - GET만 허용, POST 차단 등 세밀한 제어 가능
  - gRPC, Kafka 등 다양한 L7 프로토콜 지원
```

**확인 문제:**

1. 표준 Kubernetes NetworkPolicy에서 HTTP GET과 POST를 구분할 수 있는가?
2. L7 NetworkPolicy가 필요한 실제 시나리오를 2가지 설명하시오.
3. CiliumNetworkPolicy와 표준 NetworkPolicy를 동시에 사용할 수 있는가?

---

### Lab 5.9: DNS 테스트 (Service FQDN, headless DNS)

**학습 목표:**
- Kubernetes 클러스터 내부 DNS 구조를 이해한다.
- Service FQDN의 형식과 해석 규칙을 학습한다.
- resolv.conf의 search 도메인을 분석한다.

**관련 CKAD 도메인:** Services and Networking — DNS

**Step 1: DNS 해석 테스트**

```bash
kubectl run dns-full-test --image=busybox:1.36 --rm -it --restart=Never -n demo -- sh -c '
echo "=== 1. 짧은 이름 (같은 네임스페이스) ==="
nslookup httpbin
echo ""

echo "=== 2. <service>.<namespace> ==="
nslookup httpbin.demo
echo ""

echo "=== 3. <service>.<namespace>.svc ==="
nslookup httpbin.demo.svc
echo ""

echo "=== 4. FQDN (완전한 도메인) ==="
nslookup httpbin.demo.svc.cluster.local
echo ""

echo "=== 5. 다른 네임스페이스 서비스 ==="
nslookup kube-dns.kube-system.svc.cluster.local
echo ""

echo "=== 6. resolv.conf 확인 ==="
cat /etc/resolv.conf
echo ""

echo "=== 7. 외부 DNS ==="
nslookup google.com
'
```

**예상 출력 (resolv.conf):**

```
nameserver 10.96.0.10
search demo.svc.cluster.local svc.cluster.local cluster.local
options ndots:5
```

**Step 2: DNS 형식 정리**

| 형식 | 예시 | 사용 조건 |
|------|------|----------|
| `<service>` | httpbin | 같은 네임스페이스 |
| `<service>.<namespace>` | httpbin.demo | 다른 네임스페이스 |
| `<service>.<namespace>.svc` | httpbin.demo.svc | 다른 네임스페이스 |
| `<service>.<namespace>.svc.cluster.local` | httpbin.demo.svc.cluster.local | FQDN (완전한 도메인) |

**확인 문제:**

1. `ndots:5`의 의미는 무엇인가?
2. 같은 네임스페이스에서 `httpbin`만으로 접근 가능한 이유는 무엇인가?
3. 외부 도메인(예: google.com) 해석은 어떤 DNS 서버가 처리하는가?
4. CoreDNS는 어떤 네임스페이스에서 실행되는가?

---

### Lab 5.10: Istio mTLS 확인 (PeerAuthentication)

**학습 목표:**
- mTLS(mutual TLS)의 개념을 이해한다.
- tart-infra의 PeerAuthentication STRICT 모드를 확인한다.
- Istio sidecar 간 mTLS 통신을 관찰한다.

**관련 CKAD 도메인:** Services and Networking — Traffic Security (참고 학습)

**Step 1: PeerAuthentication 확인**

```bash
kubectl get peerauthentication -n demo -o yaml
```

**예상 출력 (핵심 부분):**

```yaml
spec:
  mtls:
    mode: STRICT
```

STRICT 모드는 demo 네임스페이스 내의 모든 Pod 간 통신이 반드시 mTLS로 암호화되어야 함을 의미한다.

**Step 2: mTLS 동작 확인**

```bash
NGINX_POD=$(kubectl get pods -n demo -l app=nginx-web -o jsonpath='{.items[0].metadata.name}')
kubectl exec $NGINX_POD -n demo -c istio-proxy -- pilot-agent request GET /certs 2>/dev/null | head -20
kubectl logs $NGINX_POD -n demo -c istio-proxy --tail=10 | grep -i tls
```

**Step 3: Circuit Breaker(DestinationRule) 확인**

```bash
kubectl get destinationrule -n demo -o yaml | grep -A 10 "outlierDetection"
```

**예상 출력:**

```yaml
outlierDetection:
  consecutive5xxErrors: 3
  interval: 30s
  baseEjectionTime: 30s
```

이 설정은 30초 간격으로 5xx 에러를 모니터링하고, 3번 연속 5xx가 발생하면 해당 엔드포인트를 30초간 서킷 브레이커에서 제외(eject)한다.

**Step 4: mTLS 모드 비교**

| 모드 | 설명 |
|------|------|
| STRICT | mTLS만 허용 (plaintext 거부) |
| PERMISSIVE | mTLS와 plaintext 모두 허용 |
| DISABLE | mTLS 비활성화 |

**확인 문제:**

1. STRICT mTLS 모드에서 Istio sidecar가 없는 Pod이 통신을 시도하면 어떻게 되는가?
2. PERMISSIVE 모드는 어떤 시나리오에서 사용하는가?
3. Circuit Breaker의 `consecutive5xxErrors: 3`은 어떤 동작을 유발하는가?
4. mTLS에서 인증서는 누가 발급하고 관리하는가?

---

## 종합 시나리오

> 아래 시나리오는 여러 CKAD 도메인을 복합적으로 다루는 종합 실습이다. 실제 CKAD 시험과 유사한 형태로 구성되어 있다.

---

### 시나리오 1: CKAD 모의 실기 — 앱 배포

**시나리오 설명:**
새로운 마이크로서비스 `order-service`를 demo 네임스페이스에 배포한다. 다음 요구 사항을 모두 충족해야 한다.

**요구 사항:**

1. ConfigMap `order-config` 생성: DB_HOST=postgres.demo.svc.cluster.local, DB_PORT=5432, DB_NAME=demo
2. Secret `order-secret` 생성: DB_PASSWORD=demo123, API_KEY=order-api-key-xyz
3. Deployment `order-service` 생성:
   - 이미지: nginx:alpine
   - 레플리카: 2
   - ConfigMap을 envFrom으로 주입
   - Secret의 DB_PASSWORD를 env로 주입
   - Liveness Probe: httpGet / port 80, initialDelay=10, period=10
   - Readiness Probe: httpGet / port 80, initialDelay=5, period=5
   - SecurityContext: readOnlyRootFilesystem=false
   - Resources: requests(cpu=50m, memory=64Mi), limits(cpu=200m, memory=128Mi)
4. Service `order-service` 생성: ClusterIP, port 80
5. NetworkPolicy `order-policy`: nginx-web에서만 order-service로의 Ingress 허용, TCP 80

**제한 시간:** 20분

**풀이:**

```bash
# 1. ConfigMap 생성
kubectl create configmap order-config \
  --from-literal=DB_HOST=postgres.demo.svc.cluster.local \
  --from-literal=DB_PORT=5432 \
  --from-literal=DB_NAME=demo \
  -n demo

# 2. Secret 생성
kubectl create secret generic order-secret \
  --from-literal=DB_PASSWORD=demo123 \
  --from-literal=API_KEY=order-api-key-xyz \
  -n demo

# 3. Deployment 생성
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-service
spec:
  replicas: 2
  selector:
    matchLabels:
      app: order-service
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  template:
    metadata:
      labels:
        app: order-service
    spec:
      containers:
        - name: order
          image: nginx:alpine
          ports:
            - containerPort: 80
          envFrom:
            - configMapRef:
                name: order-config
          env:
            - name: DB_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: order-secret
                  key: DB_PASSWORD
          livenessProbe:
            httpGet:
              path: /
              port: 80
            initialDelaySeconds: 10
            periodSeconds: 10
          readinessProbe:
            httpGet:
              path: /
              port: 80
            initialDelaySeconds: 5
            periodSeconds: 5
          securityContext:
            readOnlyRootFilesystem: false
          resources:
            requests:
              cpu: 50m
              memory: 64Mi
            limits:
              cpu: 200m
              memory: 128Mi
EOF

# 4. Service 생성
kubectl expose deployment order-service --port=80 --target-port=80 --type=ClusterIP -n demo

# 5. NetworkPolicy 생성
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: order-policy
  namespace: demo
spec:
  podSelector:
    matchLabels:
      app: order-service
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: nginx-web
      ports:
        - protocol: TCP
          port: 80
EOF
```

**검증:**

```bash
echo "=== 1. ConfigMap 확인 ==="
kubectl get configmap order-config -n demo -o jsonpath='{.data}'
echo ""

echo "=== 2. Secret 확인 ==="
kubectl get secret order-secret -n demo -o jsonpath='{.data.DB_PASSWORD}' | base64 -d
echo ""

echo "=== 3. Deployment 확인 ==="
kubectl get deployment order-service -n demo
kubectl rollout status deployment order-service -n demo

echo "=== 4. Pod 상태 ==="
kubectl get pods -n demo -l app=order-service

echo "=== 5. Service 확인 ==="
kubectl get svc order-service -n demo

echo "=== 6. Endpoint 확인 ==="
kubectl get endpoints order-service -n demo

echo "=== 7. 환경변수 확인 ==="
ORDER_POD=$(kubectl get pods -n demo -l app=order-service -o jsonpath='{.items[0].metadata.name}')
kubectl exec $ORDER_POD -n demo -- env | grep -E "DB_|API_"

echo "=== 8. Probe 확인 ==="
kubectl describe pod $ORDER_POD -n demo | grep -A 3 "Liveness:\|Readiness:"

echo "=== 9. QoS 확인 ==="
kubectl get pod $ORDER_POD -n demo -o jsonpath='{.status.qosClass}'
echo ""

echo "=== 10. NetworkPolicy 확인 ==="
kubectl get networkpolicy order-policy -n demo

echo "=== 11. NetworkPolicy 테스트 ==="
NGINX_POD=$(kubectl get pods -n demo -l app=nginx-web -o jsonpath='{.items[0].metadata.name}')
kubectl exec $NGINX_POD -n demo -c nginx -- wget -qO- http://order-service:80 --timeout=5 2>&1 | head -3
```

**정리:**

```bash
kubectl delete deployment order-service -n demo
kubectl delete svc order-service -n demo
kubectl delete configmap order-config -n demo
kubectl delete secret order-secret -n demo
kubectl delete networkpolicy order-policy -n demo
```

---

### 시나리오 2: CKAD 모의 실기 — 트러블슈팅

**시나리오 설명:**
demo 네임스페이스에 배포된 `broken-app`이 정상 동작하지 않는다. 문제를 진단하고 수정하시오.

**제한 시간:** 15분

**Step 1: 문제가 있는 앱 배포**

```bash
# 의도적으로 3가지 문제가 있는 앱 배포
# 문제 1: 잘못된 이미지 태그
# 문제 2: 존재하지 않는 ConfigMap 참조
# 문제 3: 잘못된 Liveness Probe 경로

cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: v1
kind: ConfigMap
metadata:
  name: broken-config
data:
  APP_NAME: broken-app
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: broken-app
spec:
  replicas: 2
  selector:
    matchLabels:
      app: broken-app
  template:
    metadata:
      labels:
        app: broken-app
    spec:
      containers:
        - name: app
          image: nginx:nonexistent-tag-v999
          ports:
            - containerPort: 80
          envFrom:
            - configMapRef:
                name: missing-config
          livenessProbe:
            httpGet:
              path: /nonexistent-health
              port: 8080
            initialDelaySeconds: 5
            periodSeconds: 5
          resources:
            requests:
              cpu: 10m
              memory: 16Mi
EOF
```

**Step 2: 진단**

```bash
kubectl get pods -n demo -l app=broken-app
kubectl describe pod -n demo -l app=broken-app | tail -20
kubectl get events -n demo --sort-by=.metadata.creationTimestamp | tail -10
```

**Step 3: 문제 수정**

```bash
# 문제 1 수정: 이미지 태그 변경
kubectl set image deployment/broken-app app=nginx:alpine -n demo

# 문제 2 수정: 존재하지 않는 ConfigMap 참조를 올바른 것으로 변경
kubectl patch deployment broken-app -n demo --type='json' -p='[
  {"op": "replace", "path": "/spec/template/spec/containers/0/envFrom/0/configMapRef/name", "value": "broken-config"}
]'

# 문제 3 수정: Liveness Probe 경로와 포트 수정
kubectl patch deployment broken-app -n demo --type='json' -p='[
  {"op": "replace", "path": "/spec/template/spec/containers/0/livenessProbe/httpGet/path", "value": "/"},
  {"op": "replace", "path": "/spec/template/spec/containers/0/livenessProbe/httpGet/port", "value": 80}
]'

kubectl rollout status deployment broken-app -n demo --timeout=60s
kubectl get pods -n demo -l app=broken-app
```

**Step 4: 검증**

```bash
BROKEN_POD=$(kubectl get pods -n demo -l app=broken-app -o jsonpath='{.items[0].metadata.name}')
kubectl get pod $BROKEN_POD -n demo -o jsonpath='{.spec.containers[0].image}'
echo ""
kubectl exec $BROKEN_POD -n demo -- env | grep APP_NAME
kubectl describe pod $BROKEN_POD -n demo | grep -A 3 "Liveness:"
```

**정리:**

```bash
kubectl delete deployment broken-app -n demo
kubectl delete configmap broken-config -n demo
```

**학습 포인트:**

| 문제 | 증상 | 진단 방법 | 해결 방법 |
|------|------|----------|----------|
| 잘못된 이미지 | ImagePullBackOff | `kubectl describe pod` | `kubectl set image` |
| 없는 ConfigMap | CreateContainerConfigError | `kubectl describe pod` | ConfigMap 생성 또는 참조 수정 |
| 잘못된 Probe | CrashLoopBackOff | `kubectl describe pod` Events | Probe 경로/포트 수정 |

---

### 시나리오 3: CKAD 모의 실기 — Canary 배포 전체 흐름

**시나리오 설명:**
기존 `web-app v1`이 운영 중인 상태에서 `web-app v2`를 Canary 배포한다. 트래픽을 점진적으로 전환하고, 문제가 없으면 v2로 완전 전환한다.

**제한 시간:** 25분

**요구 사항:**

1. `web-app-v1` Deployment (3 replicas, nginx:1.24-alpine, label: version=v1)
2. `web-app-v2` Deployment (1 replica, nginx:1.25-alpine, label: version=v2)
3. `web-app` Service (모든 web-app Pod로 트래픽 분산)
4. Canary 테스트: v1=75%, v2=25% 비율 확인
5. 점진적 전환: v2 replicas 증가, v1 replicas 감소
6. 완전 전환: v1 replicas=0, v2 replicas=3

**풀이:**

```bash
# Step 1: v1 Deployment 생성
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web-app-v1
spec:
  replicas: 3
  selector:
    matchLabels:
      app: web-app
      version: v1
  template:
    metadata:
      labels:
        app: web-app
        version: v1
    spec:
      containers:
        - name: nginx
          image: nginx:1.24-alpine
          ports:
            - containerPort: 80
          command:
            - sh
            - -c
            - |
              echo "v1" > /usr/share/nginx/html/version.txt
              nginx -g 'daemon off;'
          resources:
            requests:
              cpu: 10m
              memory: 16Mi
EOF

# Step 2: Service 생성 (app=web-app 레이블만으로 선택)
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: v1
kind: Service
metadata:
  name: web-app
spec:
  selector:
    app: web-app
  ports:
    - port: 80
      targetPort: 80
EOF

kubectl rollout status deployment web-app-v1 -n demo

# Step 3: v2 Deployment 생성 (Canary: 1 replica)
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web-app-v2
spec:
  replicas: 1
  selector:
    matchLabels:
      app: web-app
      version: v2
  template:
    metadata:
      labels:
        app: web-app
        version: v2
    spec:
      containers:
        - name: nginx
          image: nginx:1.25-alpine
          ports:
            - containerPort: 80
          command:
            - sh
            - -c
            - |
              echo "v2" > /usr/share/nginx/html/version.txt
              nginx -g 'daemon off;'
          resources:
            requests:
              cpu: 10m
              memory: 16Mi
EOF

kubectl rollout status deployment web-app-v2 -n demo
```

**Step 4: Canary 트래픽 분배 테스트**

```bash
kubectl run canary-web-test --image=busybox:1.36 --rm -it --restart=Never -n demo -- sh -c '
v1=0; v2=0; other=0
for i in $(seq 1 40); do
  resp=$(wget -qO- http://web-app:80/version.txt --timeout=3 2>/dev/null)
  case "$resp" in
    v1*) v1=$((v1+1)) ;;
    v2*) v2=$((v2+1)) ;;
    *) other=$((other+1)) ;;
  esac
done
echo "v1: $v1, v2: $v2, other: $other"
echo "예상: v1~30(75%), v2~10(25%)"
'
```

**Step 5: 점진적 전환**

```bash
echo "=== Phase 1: v1=2, v2=2 (50:50) ==="
kubectl scale deployment web-app-v1 --replicas=2 -n demo
kubectl scale deployment web-app-v2 --replicas=2 -n demo
sleep 5
kubectl get pods -n demo -l app=web-app --show-labels

echo "=== Phase 2: v1=1, v2=3 (25:75) ==="
kubectl scale deployment web-app-v1 --replicas=1 -n demo
kubectl scale deployment web-app-v2 --replicas=3 -n demo
sleep 5
kubectl get pods -n demo -l app=web-app --show-labels

echo "=== Phase 3: v1=0, v2=3 (0:100 - 완전 전환) ==="
kubectl scale deployment web-app-v1 --replicas=0 -n demo
sleep 5
kubectl get pods -n demo -l app=web-app --show-labels
```

**Step 6: 최종 검증**

```bash
kubectl run canary-final-test --image=busybox:1.36 --rm -it --restart=Never -n demo -- sh -c '
for i in $(seq 1 10); do
  resp=$(wget -qO- http://web-app:80/version.txt --timeout=3 2>/dev/null)
  echo "Request $i: $resp"
done
echo "모든 요청이 v2여야 한다"
'
```

**Step 7: 정리**

```bash
kubectl delete deployment web-app-v1 web-app-v2 -n demo
kubectl delete svc web-app -n demo
```

**학습 포인트:**

| 단계 | v1 replicas | v2 replicas | 트래픽 비율 |
|------|------------|------------|------------|
| 초기 | 3 | 0 | 100:0 |
| Canary 시작 | 3 | 1 | 75:25 |
| 50:50 전환 | 2 | 2 | 50:50 |
| 거의 완료 | 1 | 3 | 25:75 |
| 완전 전환 | 0 | 3 | 0:100 |

**Kubernetes 네이티브 Canary vs Istio Canary 비교:**

| 항목 | Kubernetes 네이티브 | Istio VirtualService |
|------|-------------------|---------------------|
| 트래픽 제어 | replica 비율에 의존 | weight 필드로 정밀 제어 |
| 정밀도 | 낮음 (replica 수에 제한) | 높음 (1% 단위 가능) |
| 헤더 기반 라우팅 | 불가 | 가능 (x-canary:true) |
| 추가 컴포넌트 | 불필요 | Istio 필요 |

---

## 실습 체크리스트

각 실습을 완료하면 체크한다.

### 실습 1: Application Design and Build (20%)

| # | 실습 | 관련 CKAD 주제 | 완료 |
|---|------|---------------|------|
| 1.1 | Multi-container Pod 관찰 — Istio sidecar 분석 | Multi-container Pod | [ ] |
| 1.2 | Init Container 추가 실습 | Init Containers | [ ] |
| 1.3 | Sidecar 패턴 — 로그 수집 sidecar | Sidecar Pattern | [ ] |
| 1.4 | Ambassador 패턴 — 프록시 sidecar | Ambassador Pattern | [ ] |
| 1.5 | Volume 유형 실습 | Volumes | [ ] |
| 1.6 | Dockerfile 최적화 분석 | Container Images | [ ] |

### 실습 2: Application Deployment (20%)

| # | 실습 | 관련 CKAD 주제 | 완료 |
|---|------|---------------|------|
| 2.1 | Deployment 생성 | Deployments | [ ] |
| 2.2 | Rolling Update 상세 | Rolling Updates | [ ] |
| 2.3 | Rollback 실습 | Rollbacks | [ ] |
| 2.4 | Canary 배포 관찰 | Canary Deployments | [ ] |
| 2.5 | Canary 비율 변경 | Traffic Management | [ ] |
| 2.6 | Helm 실습 | Helm | [ ] |
| 2.7 | Kustomize 실습 | Kustomize | [ ] |
| 2.8 | ArgoCD GitOps 흐름 | GitOps | [ ] |

### 실습 3: Application Observability and Maintenance (15%)

| # | 실습 | 관련 CKAD 주제 | 완료 |
|---|------|---------------|------|
| 3.1 | Probe 분석 — keycloak | Health Checks | [ ] |
| 3.2 | Liveness Probe 추가 | Liveness Probes | [ ] |
| 3.3 | Readiness Probe 추가 | Readiness Probes | [ ] |
| 3.4 | Startup Probe 추가 | Startup Probes | [ ] |
| 3.5 | 로그 분석 | Logging | [ ] |
| 3.6 | 디버깅 — kubectl exec | Debugging | [ ] |
| 3.7 | 디버깅 — ephemeral container | Ephemeral Containers | [ ] |
| 3.8 | 리소스 모니터링 | Monitoring | [ ] |

### 실습 4: Application Environment, Configuration and Security (25%)

| # | 실습 | 관련 CKAD 주제 | 완료 |
|---|------|---------------|------|
| 4.1 | ConfigMap 생성 | ConfigMaps | [ ] |
| 4.2 | ConfigMap을 env로 주입 | ConfigMap as Env | [ ] |
| 4.3 | ConfigMap을 volume으로 마운트 | ConfigMap as Volume | [ ] |
| 4.4 | Secret 생성 | Secrets | [ ] |
| 4.5 | Secret을 Pod에 마운트 | Secret Consumption | [ ] |
| 4.6 | SecurityContext 분석 | SecurityContext | [ ] |
| 4.7 | SecurityContext 실습 | runAsUser, readOnly | [ ] |
| 4.8 | capabilities 실습 | Capabilities | [ ] |
| 4.9 | ServiceAccount 생성 | ServiceAccounts | [ ] |
| 4.10 | Resource/QoS 확인 | Resource Management | [ ] |
| 4.11 | LimitRange 생성 | LimitRange | [ ] |
| 4.12 | ResourceQuota 생성 | ResourceQuota | [ ] |

### 실습 5: Services and Networking (20%)

| # | 실습 | 관련 CKAD 주제 | 완료 |
|---|------|---------------|------|
| 5.1 | ClusterIP Service | ClusterIP | [ ] |
| 5.2 | NodePort Service | NodePort | [ ] |
| 5.3 | Headless Service | Headless Service | [ ] |
| 5.4 | Service Endpoint | Endpoints | [ ] |
| 5.5 | Ingress 분석 | Ingress | [ ] |
| 5.6 | NetworkPolicy — Default Deny | NetworkPolicy | [ ] |
| 5.7 | NetworkPolicy — 특정 Pod 허용 | NetworkPolicy Allow | [ ] |
| 5.8 | L7 NetworkPolicy | L7 Policy | [ ] |
| 5.9 | DNS 테스트 | DNS | [ ] |
| 5.10 | Istio mTLS | mTLS | [ ] |

### 종합 시나리오

| # | 시나리오 | 난이도 | 완료 |
|---|---------|--------|------|
| S1 | 앱 배포 (Deployment+Service+ConfigMap+Secret+Probe+SecurityContext+NetworkPolicy) | 중 | [ ] |
| S2 | 트러블슈팅 (failing Probe, missing ConfigMap, wrong image) | 중 | [ ] |
| S3 | Canary 배포 전체 흐름 | 상 | [ ] |

---

## CKAD 시험 팁 정리

### 필수 kubectl 단축 명령어

```bash
# 리소스 약어
# po = pods, deploy = deployments, svc = services, cm = configmaps
# secret = secrets, ns = namespaces, sa = serviceaccounts
# netpol = networkpolicies, ing = ingress, hpa = horizontalpodautoscalers
# rs = replicasets, ep = endpoints, pv = persistentvolumes, pvc = persistentvolumeclaims

# 자주 사용하는 별칭
alias k=kubectl
export do="--dry-run=client -o yaml"

# YAML 빠르게 생성
kubectl run test-pod --image=nginx --dry-run=client -o yaml > pod.yaml
kubectl create deployment test-dep --image=nginx --replicas=3 --dry-run=client -o yaml > deploy.yaml
kubectl create service clusterip test-svc --tcp=80:80 --dry-run=client -o yaml > svc.yaml
kubectl create configmap test-cm --from-literal=key=value --dry-run=client -o yaml > cm.yaml
kubectl create secret generic test-sec --from-literal=pass=secret --dry-run=client -o yaml > secret.yaml
```

### 시험 중 시간 절약 팁

1. **`--dry-run=client -o yaml`을 적극 활용한다:** YAML을 처음부터 작성하지 않고, 명령형으로 생성한 YAML을 수정한다.
2. **`kubectl explain` 활용:** 필드명이 기억나지 않을 때 `kubectl explain pod.spec.containers.livenessProbe`처럼 사용한다.
3. **Vim 설정:** `set tabstop=2 shiftwidth=2 expandtab`으로 YAML 편집을 편하게 한다.
4. **네임스페이스 기본 설정:** `kubectl config set-context --current --namespace=<ns>`
5. **명령형 + 선언형 혼합:** 기본 구조는 명령형으로 생성하고, 세부 사항은 `kubectl edit`으로 수정한다.

### 시험 영역별 핵심 명령어

| 영역 | 핵심 명령어 |
|------|-----------|
| Design & Build | `kubectl run`, `kubectl create deployment`, Volume 관련 YAML |
| Deployment | `kubectl rollout`, `kubectl set image`, `helm`, `kubectl apply -k` |
| Observability | `kubectl logs`, `kubectl exec`, `kubectl top`, `kubectl debug` |
| Config & Security | `kubectl create configmap/secret`, SecurityContext YAML |
| Networking | `kubectl expose`, `kubectl get svc/endpoints`, NetworkPolicy YAML |

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
