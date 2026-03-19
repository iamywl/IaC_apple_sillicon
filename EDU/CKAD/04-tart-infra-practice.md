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

| 영역 | 실습 | 관련 CKAD 도메인 | 완료 |
|------|------|-----------------|------|
| Design & Build | Istio sidecar 관찰 | Multi-container Pod | [ ] |
| Design & Build | Init Container 생성 | Init Container | [ ] |
| Design & Build | Volume 확인 | Volume | [ ] |
| Deployment | Canary 배포 관찰 | Canary Deployment | [ ] |
| Deployment | Rolling Update/Rollback | Deployment Strategy | [ ] |
| Deployment | Helm Release 확인 | Helm | [ ] |
| Deployment | HPA 관찰 | Autoscaling | [ ] |
| Observability | Probe 확인 | Health Check | [ ] |
| Observability | 로그 확인 | Logging | [ ] |
| Observability | 리소스 모니터링 | Monitoring | [ ] |
| Observability | 디버깅 실습 | Debugging | [ ] |
| Config & Security | ConfigMap/Secret 확인 | Configuration | [ ] |
| Config & Security | SecurityContext 확인 | Security | [ ] |
| Config & Security | Resource/QoS 확인 | Resource Management | [ ] |
| Config & Security | ServiceAccount 확인 | ServiceAccount | [ ] |
| Networking | Service 비교 | Service Types | [ ] |
| Networking | NetworkPolicy 분석 | NetworkPolicy | [ ] |
| Networking | DNS 테스트 | DNS | [ ] |
| Networking | Istio/mTLS 확인 | Traffic Management | [ ] |
| 종합 | 시나리오 A 완료 | 전체 | [ ] |
| 종합 | 시나리오 B 완료 | 전체 | [ ] |
