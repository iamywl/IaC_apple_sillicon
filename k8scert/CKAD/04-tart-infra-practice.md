# CKAD 실습 가이드 — tart-infra 활용

> tart-infra 프로젝트의 실제 인프라 구성을 활용하여 CKAD(Certified Kubernetes Application Developer) 시험 영역별 실습을 진행하는 가이드이다.
> CKAD는 개발자 관점의 실기 시험으로, 애플리케이션 설계/빌드/배포/관찰/보안/네트워킹을 실제 클러스터에서 수행하는 능력을 검증한다.
> 4개 클러스터(platform, dev, staging, prod) 중 **dev 클러스터**의 **demo 네임스페이스**를 주로 활용한다.
> 모든 실습 단계에 검증 명령어와 기대 출력을 포함하며, 내부 동작 원리와 트러블슈팅, 장애 시나리오를 함께 다룬다.

---

## 사전 준비

### 클러스터 접근 설정

tart-infra는 4개의 클러스터로 구성되어 있다. 본 실습에서는 주로 dev 클러스터를 사용한다.

#### 등장 배경

쿠버네티스는 단일 클러스터로 시작하는 경우가 많지만, 프로덕션 운영에서는 환경 분리(dev/staging/prod)가 필수이다. 단일 클러스터에서 네임스페이스만으로 환경을 분리하면 다음과 같은 한계가 존재한다:

- **장애 전파**: dev 환경의 실험적 워크로드가 클러스터 전체의 리소스를 고갈시킬 수 있다.
- **보안 경계 부재**: 네임스페이스 간 NetworkPolicy를 설정하지 않으면 dev Pod가 prod 데이터베이스에 접근할 수 있다.
- **업그레이드 영향**: 클러스터 업그레이드 시 모든 환경이 동시에 영향을 받는다.

tart-infra는 이 문제를 해결하기 위해 4개의 독립 클러스터를 사용한다.

```bash
# dev 클러스터 kubeconfig 설정
export KUBECONFIG=kubeconfig/dev-kubeconfig

# 클러스터 연결 확인
kubectl cluster-info
kubectl get nodes -o wide

# 현재 컨텍스트 확인
kubectl config current-context
```

**검증:**

```bash
kubectl cluster-info
```

```text
Kubernetes control plane is running at https://192.168.64.x:6443
CoreDNS is running at https://192.168.64.x:6443/api/v1/namespaces/kube-system/services/kube-dns:dns/proxy
```

```bash
kubectl get nodes -o wide
```

```text
NAME       STATUS   ROLES           AGE   VERSION   INTERNAL-IP     OS-IMAGE
dev-cp     Ready    control-plane   30d   v1.29.x   192.168.64.10   Ubuntu 22.04
dev-w1     Ready    <none>          30d   v1.29.x   192.168.64.11   Ubuntu 22.04
dev-w2     Ready    <none>          30d   v1.29.x   192.168.64.12   Ubuntu 22.04
```

**트러블슈팅 — 클러스터 연결 실패:**

```bash
# 연결 거부 시 kubeconfig 경로 확인
ls -la kubeconfig/dev-kubeconfig

# 인증서 만료 확인
kubectl cluster-info --kubeconfig=kubeconfig/dev-kubeconfig 2>&1
# "Unable to connect to the server: x509: certificate has expired" → 인증서 갱신 필요

# VM 상태 확인 (tart 기반 인프라)
tart list
```

```text
# 정상 상태:
Source  Name    State    CPU  Memory  Disk
local   dev-cp  running  4    4096    50
local   dev-w1  running  2    2048    30
local   dev-w2  running  2    2048    30
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

**검증:**

```bash
kubectl get namespaces
```

```text
NAME              STATUS   AGE
default           Active   30d
demo              Active   30d
istio-system      Active   30d
kube-system       Active   30d
monitoring        Active   30d
argocd            Active   30d
jenkins           Active   30d
```

```bash
kubectl get namespace demo --show-labels
```

```text
NAME   STATUS   AGE   LABELS
demo   Active   30d   istio-injection=enabled,kubernetes.io/metadata.name=demo
```

demo 네임스페이스에는 `istio-injection=enabled` 레이블이 설정되어 있어, 해당 네임스페이스에 배포되는 모든 Pod에 Istio sidecar(istio-proxy)가 자동 주입된다.

**내부 동작 원리 — Istio sidecar injection:**

Istio는 MutatingAdmissionWebhook을 사용하여 Pod 생성 요청을 가로챈다. API 서버가 Pod 생성 요청을 받으면, `istio-injection=enabled` 레이블이 있는 네임스페이스의 Pod에 대해 Istiod의 webhook 서버로 요청을 전달한다. webhook 서버는 Pod spec에 istio-proxy 컨테이너를 추가한 수정된 spec을 반환한다. 이 과정은 다음 단계로 진행된다:

1. 사용자가 `kubectl apply`로 Pod/Deployment를 생성한다.
2. API 서버가 MutatingAdmissionWebhook 목록을 확인한다.
3. `istio-sidecar-injector` webhook이 매칭되면 Istiod로 요청을 전달한다.
4. Istiod가 istio-proxy 컨테이너, init container(istio-init), 환경변수, Volume을 Pod spec에 주입한다.
5. 수정된 Pod spec이 etcd에 저장되고 kubelet이 Pod를 생성한다.

```bash
# MutatingWebhookConfiguration 확인
kubectl get mutatingwebhookconfiguration istio-sidecar-injector -o yaml | head -30
```

```text
apiVersion: admissionregistration.k8s.io/v1
kind: MutatingWebhookConfiguration
metadata:
  name: istio-sidecar-injector
webhooks:
- name: rev.namespace.sidecar-injector.istio.io
  namespaceSelector:
    matchLabels:
      istio-injection: enabled
```

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

**검증:**

```bash
kubectl get pods -n demo
```

```text
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

**장애 시나리오 — Pod가 1/2 상태인 경우:**

READY가 `1/2`이면 두 컨테이너 중 하나가 Ready 상태가 아닌 것이다. 원인별 진단 방법은 다음과 같다:

| 증상 | 원인 | 진단 명령어 |
|------|------|-----------|
| 메인 컨테이너 미준비 | Readiness Probe 실패 | `kubectl describe pod <pod> -n demo \| grep -A5 Readiness` |
| istio-proxy 미준비 | Istiod 연결 실패 | `kubectl logs <pod> -n demo -c istio-proxy \| grep -i error` |
| 메인 컨테이너 CrashLoop | 애플리케이션 에러 | `kubectl logs <pod> -n demo -c <main> --previous` |
| istio-proxy CrashLoop | mTLS 인증서 만료 | `kubectl logs <pod> -n demo -c istio-proxy --previous` |

```bash
# istio-proxy 상태 확인
kubectl get pods -n demo -o jsonpath='{range .items[*]}{.metadata.name}{": "}{range .status.containerStatuses[*]}{.name}{"="}{.ready}{" "}{end}{"\n"}{end}'
```

```text
nginx-web-xxxxx-aaaa: nginx=true istio-proxy=true
httpbin-v1-xxxxx-aaaa: httpbin=true istio-proxy=true
redis-xxxxx-aaaa: redis=true istio-proxy=true
```

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

**검증:**

```bash
kubectl version --client
```

```text
Client Version: v1.29.x
Kustomize Version: v5.0.x
```

```bash
helm version
```

```text
version.BuildInfo{Version:"v3.14.x", GitCommit:"xxx", GitTreeState:"clean", GoVersion:"go1.21.x"}
```

**트러블슈팅 — kubectl 버전 불일치:**

kubectl 클라이언트와 서버 버전의 차이가 2 마이너 버전을 초과하면 호환성 문제가 발생할 수 있다. CKAD 시험에서는 이 문제가 발생하지 않지만, 실무에서는 주의해야 한다.

```bash
# 클라이언트-서버 버전 차이 확인
kubectl version --short 2>/dev/null || kubectl version
```

---

## 실습 1: Application Design and Build (20%)

> **CKAD 시험 도메인:** Application Design and Build
> 이 영역은 컨테이너 이미지 정의, Multi-container Pod 패턴(sidecar, init, ambassador), Volume 마운트, 그리고 효율적인 Dockerfile 작성 능력을 평가한다.

#### 등장 배경

쿠버네티스 초기에는 단일 컨테이너 Pod만 사용하는 것이 일반적이었다. 그러나 마이크로서비스 아키텍처가 발전하면서, 메인 애플리케이션의 코드 변경 없이 부가 기능(로깅, 프록시, 메트릭 수집 등)을 추가해야 하는 요구가 증가하였다. 이를 해결하기 위해 Multi-container Pod 패턴이 도입되었다. Pod는 같은 네트워크 네임스페이스와 Volume을 공유하는 컨테이너 그룹이므로, 밀접하게 결합된 보조 기능을 별도 컨테이너로 분리할 수 있다. 이 설계는 관심사 분리(Separation of Concerns) 원칙을 컨테이너 수준에서 구현한 것이다.

기존 한계:
- 단일 컨테이너에 모든 기능을 포함하면 이미지 크기가 커지고, 빌드 시간이 증가하며, 개별 기능의 독립적 업데이트가 불가능하다.
- 별도 Pod로 분리하면 네트워크 통신 오버헤드가 발생하고, 동일 노드 배치를 보장할 수 없다.
- Multi-container Pod 패턴은 이 두 극단의 중간 지점을 제공한다.

---

### Lab 1.1: Multi-container Pod 관찰 — Istio sidecar 분석

**학습 목표:**
- Multi-container Pod의 구조를 이해한다.
- Sidecar 패턴의 실제 구현 사례(Istio istio-proxy)를 관찰한다.
- Pod 내 컨테이너 간 네트워크 공유 원리를 이해한다.

**관련 CKAD 도메인:** Application Design and Build — Multi-container Pod Patterns

**배경 지식:**

Multi-container Pod에서는 같은 Pod 내의 컨테이너들이 동일한 네트워크 네임스페이스를 공유한다. 즉, `localhost`로 서로 통신할 수 있다. 또한 동일한 Volume을 마운트하여 파일 시스템을 공유할 수도 있다. Sidecar 패턴은 메인 컨테이너의 기능을 보조하는 컨테이너를 함께 배치하는 것이다. Istio의 istio-proxy(Envoy)는 대표적인 sidecar 구현체로, 트래픽 라우팅, mTLS 암호화, 메트릭 수집 등을 메인 애플리케이션 코드 변경 없이 수행한다.

**내부 동작 원리 — Pod 네트워크 네임스페이스 공유:**

Pod 내 컨테이너가 네트워크를 공유하는 메커니즘은 다음과 같다:

1. kubelet이 Pod를 생성할 때, 먼저 `pause` 컨테이너(infrastructure container)를 생성한다. 이 컨테이너는 Linux network namespace를 생성하고 유지하는 역할만 수행한다.
2. Pod 내의 모든 애플리케이션 컨테이너는 이 `pause` 컨테이너의 network namespace에 참여한다.
3. 따라서 모든 컨테이너가 동일한 IP 주소, 동일한 포트 공간, 동일한 loopback 인터페이스를 공유한다.
4. 컨테이너 A가 80번 포트에서 리스닝하면, 컨테이너 B는 `localhost:80`으로 접근할 수 있다.
5. 단, 두 컨테이너가 동일한 포트를 사용하면 포트 충돌이 발생한다.

**Step 1: demo 네임스페이스의 Pod READY 상태 확인**

```bash
# 모든 Pod의 READY 열에서 컨테이너 수를 확인한다
kubectl get pods -n demo
```

**검증:**

```text
NAME                          READY   STATUS    RESTARTS   AGE
nginx-web-xxxxx-aaaa          2/2     Running   0          5d
httpbin-v1-xxxxx-aaaa         2/2     Running   0          5d
httpbin-v1-xxxxx-bbbb         2/2     Running   0          5d
httpbin-v2-xxxxx-aaaa         2/2     Running   0          5d
redis-xxxxx-aaaa              2/2     Running   0          5d
postgres-xxxxx-aaaa           2/2     Running   0          5d
rabbitmq-xxxxx-aaaa           2/2     Running   0          5d
keycloak-xxxxx-aaaa           2/2     Running   0          5d
```

READY `2/2`는 Pod 내에 2개의 컨테이너가 있고, 모두 Ready 상태임을 의미한다.

**Step 2: Pod 내 컨테이너 이름 확인**

```bash
# 각 Pod의 컨테이너 이름 목록을 확인한다
kubectl get pods -n demo -o jsonpath='{range .items[*]}{.metadata.name}{": "}{range .spec.containers[*]}{.name}{" "}{end}{"\n"}{end}'
```

**검증:**

```text
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

**검증:**

```text
Name: nginx
Image: nginx:alpine
Ports: 80
---
Name: istio-proxy
Image: docker.io/istio/proxyv2:1.20.x
Ports: 15090 15021 15020
---
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

**검증:**

```text
{
  "limits": {
    "cpu": "2000m",
    "memory": "1024Mi"
  },
  "requests": {
    "cpu": "100m",
    "memory": "128Mi"
  }
}
```

```text
port: 15090 name: http-envoy-prom
port: 15021 name: health
port: 15020 name: stats
```

istio-proxy의 포트별 역할:
- 15090: Envoy 프로메테우스 메트릭 엔드포인트이다. Prometheus가 이 포트를 스크래핑하여 istio-proxy의 네트워크 메트릭을 수집한다.
- 15021: 헬스체크 포트이다. kubelet이 이 포트로 istio-proxy의 상태를 확인한다.
- 15020: 통계 엔드포인트이다. `pilot-agent`가 Envoy의 상세 통계를 제공한다.

**Step 5: Sidecar injection 레이블 확인**

```bash
# demo 네임스페이스의 istio-injection 레이블 확인
kubectl get namespace demo -o jsonpath='{.metadata.labels.istio-injection}'
```

**검증:**

```text
enabled
```

**Step 6: Pod 내 컨테이너 간 네트워크 공유 확인**

```bash
# nginx 컨테이너에서 localhost의 istio-proxy 관리 포트에 접근
kubectl exec $NGINX_POD -n demo -c nginx -- wget -qO- http://localhost:15000/server_info 2>/dev/null | head -5

# istio-proxy 컨테이너에서 nginx 메인 포트에 접근
kubectl exec $NGINX_POD -n demo -c istio-proxy -- curl -s http://localhost:80 | head -5
```

**검증:**

```text
# server_info 응답 (JSON 형태)
{
  "version": "xxx/1.29.x/Clean/RELEASE",
  "state": "LIVE",
  ...
}
```

```text
<!DOCTYPE html>
<html>
<head>
<title>Welcome to nginx!</title>
```

같은 Pod 내의 컨테이너끼리는 `localhost`로 서로 접근할 수 있다는 것을 직접 확인할 수 있다.

**Step 7: pause 컨테이너 확인 (노드 수준)**

```bash
# 노드에서 pause 컨테이너 확인 (SSH 접근 가능 시)
# pause 컨테이너는 kubectl로 직접 보이지 않지만, 노드의 컨테이너 런타임에서 확인 가능하다
# crictl을 사용한 확인 (참고용)
echo "노드에 SSH 접근 후: crictl ps | grep pause"
echo "각 Pod마다 하나의 pause 컨테이너가 실행되며, 네트워크 네임스페이스를 유지한다"
```

**트러블슈팅 — istio-proxy 주입 실패:**

| 증상 | 원인 | 해결 |
|------|------|------|
| Pod에 istio-proxy 없음 (READY 1/1) | 네임스페이스에 istio-injection 레이블 없음 | `kubectl label namespace demo istio-injection=enabled` |
| Pod에 istio-proxy 없음 | Pod에 `sidecar.istio.io/inject: "false"` 어노테이션 설정 | 어노테이션 제거 후 Pod 재생성 |
| istio-proxy CrashLoopBackOff | Istiod Pod가 정상 실행되지 않음 | `kubectl get pods -n istio-system` 확인 |
| istio-proxy 시작 지연 | istio-init init container 실패 | `kubectl logs <pod> -n demo -c istio-init` 확인 |

```bash
# istio-init init container 확인
kubectl get pod $NGINX_POD -n demo -o jsonpath='{range .spec.initContainers[*]}{"init: "}{.name}{" image: "}{.image}{"\n"}{end}'
```

```text
init: istio-init image: docker.io/istio/proxyv2:1.20.x
```

istio-init은 iptables 규칙을 설정하여 Pod의 모든 inbound/outbound 트래픽을 istio-proxy로 리다이렉트한다. 이 init container가 실패하면 istio-proxy를 통한 트래픽 제어가 동작하지 않는다.

**확인 문제:**

1. demo 네임스페이스에서 모든 Pod의 READY 열이 `2/2`로 표시되는 이유는 무엇인가?
2. Istio sidecar가 메인 애플리케이션에 주입되는 시점은 언제인가? (힌트: MutatingWebhook)
3. 같은 Pod 내의 두 컨테이너가 `localhost`로 통신할 수 있는 이유는 무엇인가?
4. Sidecar 패턴의 장점 3가지를 설명하시오.
5. istio-proxy 컨테이너가 수행하는 주요 기능 3가지는 무엇인가?
6. pause 컨테이너의 역할은 무엇이며, Pod 삭제 시 어떻게 처리되는가?
7. 두 컨테이너가 같은 포트(예: 80번)를 사용하려 하면 어떤 일이 발생하는가?

---

### Lab 1.2: Init Container 추가 실습 (nginx에 설정 파일 준비 init container)

**학습 목표:**
- Init Container의 실행 순서와 역할을 이해한다.
- Init Container를 활용하여 메인 컨테이너 시작 전 사전 작업을 수행하는 방법을 익힌다.
- emptyDir Volume을 통한 Init Container와 메인 컨테이너 간 데이터 공유를 실습한다.

**관련 CKAD 도메인:** Application Design and Build — Init Containers

**등장 배경:**

마이크로서비스 아키텍처에서 애플리케이션 컨테이너가 시작되기 전에 선행 조건을 충족해야 하는 상황이 빈번하다. 예를 들어 데이터베이스 서비스가 준비될 때까지 대기하거나, 설정 파일을 외부 소스에서 다운로드하거나, DB 스키마 마이그레이션을 수행해야 한다. 이 로직을 메인 컨테이너에 포함하면 다음과 같은 문제가 발생한다:

- **이미지 크기 증가**: 대기 스크립트, 마이그레이션 도구 등이 프로덕션 이미지에 포함된다.
- **관심사 혼재**: 애플리케이션 코드와 인프라 설정 코드가 섞인다.
- **재사용 불가**: 다른 애플리케이션에서 동일한 초기화 로직을 재사용할 수 없다.

Init Container는 이 문제를 해결하기 위해 도입되었다. Init Container는 메인 컨테이너와 다른 이미지를 사용할 수 있으며, 순차적으로 실행되고, 모든 Init Container가 성공해야 메인 컨테이너가 시작된다.

**내부 동작 원리:**

kubelet은 Pod를 생성할 때 다음 순서로 컨테이너를 시작한다:

1. `pause` 컨테이너를 생성하여 네트워크 네임스페이스를 초기화한다.
2. `initContainers` 배열의 첫 번째 Init Container를 실행한다.
3. 해당 Init Container가 exit code 0으로 종료되면 다음 Init Container를 실행한다.
4. Init Container가 0이 아닌 exit code로 종료되면, `restartPolicy`에 따라 재시도한다 (Pod의 restartPolicy가 Always 또는 OnFailure인 경우).
5. 모든 Init Container가 성공하면 메인 컨테이너를 시작한다.
6. Init Container 중 하나라도 실패하면 메인 컨테이너는 절대 시작되지 않는다.

Init Container와 일반 컨테이너의 핵심 차이:

| 특성 | Init Container | 일반 컨테이너 |
|------|---------------|-------------|
| 실행 시점 | 메인 컨테이너 시작 전 | Pod 시작 시 동시에 |
| 실행 방식 | 순차적 (하나씩) | 동시에 (병렬) |
| 완료 조건 | 반드시 종료(exit)되어야 한다 | 계속 실행되어야 한다 |
| Probe 지원 | 미지원 | liveness/readiness/startup 지원 |
| 리소스 계산 | Pod의 effective request에 포함됨 (최대값 기준) | 합산하여 계산 |

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

**검증 (Init 실행 중):**

```text
NAME                  READY   STATUS     RESTARTS   AGE
init-demo-postgres    0/1     Init:0/1   0          5s
```

**검증 (Init 완료 후):**

```text
NAME                  READY   STATUS    RESTARTS   AGE
init-demo-postgres    1/1     Running   0          10s
```

(Istio sidecar injection이 활성화된 경우 `2/2`로 표시될 수 있다.)

**Init STATUS 형식 해석:**

| STATUS | 의미 |
|--------|------|
| `Init:0/1` | 1개의 Init Container 중 0개가 완료되었다 |
| `Init:1/2` | 2개의 Init Container 중 1개가 완료되었다 |
| `Init:Error` | Init Container가 에러로 종료되었다 |
| `Init:CrashLoopBackOff` | Init Container가 반복적으로 실패하고 있다 |
| `PodInitializing` | 모든 Init Container가 완료되고 메인 컨테이너가 시작 중이다 |

**Step 3: Init Container 상세 정보 확인**

```bash
# describe로 Init Container 정보 확인
kubectl describe pod init-demo-postgres -n demo | grep -A 25 "Init Containers:"

# Init Container 로그 확인
kubectl logs init-demo-postgres -n demo -c wait-for-postgres
```

**검증 (로그):**

```text
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
```

**검증:**

```text
NAME                     READY   STATUS     RESTARTS   AGE
init-demo-nginx-config   0/1     Init:0/2   0          1s
init-demo-nginx-config   0/1     Init:1/2   0          3s
init-demo-nginx-config   0/1     PodInitializing   0   5s
init-demo-nginx-config   1/1     Running    0          7s
```

Init Container가 `config-generator` -> `html-generator` 순서로 실행된 것을 확인할 수 있다.

```bash
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

**검증:**

```bash
kubectl exec init-demo-nginx-config -n demo -c nginx -- wget -qO- http://localhost/health
```

```text
healthy
```

```bash
kubectl exec init-demo-nginx-config -n demo -c nginx -- wget -qO- http://localhost/info
```

```text
{"app":"init-demo","version":"1.0"}
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

**검증:**

```text
NAME              READY   STATUS                  RESTARTS   AGE
init-demo-fail    0/1     Init:CrashLoopBackOff   3          1m
```

**장애 시나리오 — Init Container 실패 디버깅:**

```bash
# Init Container 종료 코드 확인
kubectl get pod init-demo-fail -n demo -o jsonpath='{.status.initContainerStatuses[0].lastState.terminated.exitCode}'
```

```text
1
```

```bash
# Init Container 로그 확인
kubectl logs init-demo-fail -n demo -c will-fail
```

```text
Init starting...
```

| Exit Code | 의미 |
|-----------|------|
| 0 | 성공 |
| 1 | 일반 에러 (애플리케이션 레벨) |
| 126 | 명령을 실행할 수 없음 (권한 문제) |
| 127 | 명령을 찾을 수 없음 |
| 137 | SIGKILL (OOM 또는 강제 종료) |
| 139 | SIGSEGV (세그멘테이션 폴트) |

**Init Container 재시도 백오프 동작:**

Init Container가 실패하면 kubelet은 지수적 백오프(exponential backoff)로 재시도한다. 재시도 간격은 10초에서 시작하여 20초, 40초, 80초, 160초로 증가하며 최대 5분(300초)까지 커진다. 이 동안 Pod STATUS는 `Init:CrashLoopBackOff`로 표시된다.

**Step 7: 정리**

```bash
kubectl delete pod init-demo-postgres init-demo-nginx-config init-demo-fail -n demo --grace-period=0 --force 2>/dev/null
```

**검증:**

```bash
kubectl get pods -n demo -l app=init-demo 2>/dev/null
kubectl get pods -n demo -l app=init-demo-fail 2>/dev/null
kubectl get pods -n demo -l app=init-demo-nginx 2>/dev/null
```

```text
No resources found in demo namespace.
```

**확인 문제:**

1. Init Container와 일반 컨테이너의 차이점 3가지를 설명하시오.
2. Pod에 Init Container가 3개 있을 때, 두 번째 Init Container가 실패하면 세 번째 Init Container는 어떻게 되는가?
3. Init Container에서 emptyDir Volume을 사용하는 이유는 무엇인가?
4. Init Container의 restartPolicy는 메인 컨테이너와 동일한가?
5. `kubectl logs <pod> -c <init-container>` 명령으로 Init Container의 로그를 확인할 수 있는 시점은 언제인가?
6. Init Container의 리소스 요청은 Pod의 effective 리소스 요청에 어떻게 반영되는가?
7. Init Container 실패 시 백오프 간격은 어떻게 증가하는가?

---

### Lab 1.3: Sidecar 패턴 — 로그 수집 sidecar 추가

**학습 목표:**
- Sidecar 패턴의 실제 활용 사례(로그 수집)를 구현한다.
- emptyDir Volume을 통한 컨테이너 간 로그 파일 공유를 실습한다.
- Pod 내 여러 컨테이너의 로그를 개별적으로 확인하는 방법을 익힌다.

**관련 CKAD 도메인:** Application Design and Build — Sidecar Pattern

**등장 배경:**

컨테이너 환경에서 로그 수집은 크게 두 가지 방식으로 분류된다:

1. **DaemonSet 기반 로그 수집**: 각 노드에 fluentd/fluent-bit를 DaemonSet으로 배포하여 노드의 `/var/log/containers/` 디렉터리에 있는 모든 컨테이너 로그를 수집한다. 이 방식은 클러스터 전체에 적용되며, 개별 애플리케이션 수정이 불필요하다.

2. **Sidecar 기반 로그 수집**: 각 Pod에 로그 수집 사이드카를 배포한다. 메인 컨테이너가 stdout이 아닌 파일에 로그를 기록하는 경우, 사이드카가 해당 파일을 읽어 stdout으로 전달하거나 외부 시스템으로 전송한다.

DaemonSet 방식은 표준 stdout/stderr 로그만 수집할 수 있다는 한계가 있다. 애플리케이션이 파일 시스템에 로그를 기록하는 경우(Apache, nginx access.log 등), Sidecar 패턴이 필요하다.

**기존 한계와 Sidecar의 해결:**

| 문제 | 기존 방식 | Sidecar 방식 |
|------|---------|-------------|
| 파일 기반 로그 | DaemonSet으로 수집 불가 | 사이드카가 파일을 읽어 stdout으로 전달 |
| 애플리케이션별 로그 포맷 | 통일 어려움 | 사이드카에서 포맷 변환 가능 |
| 로그 라우팅 | 모든 로그가 동일 경로 | 사이드카별로 다른 대상에 전송 가능 |

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

**검증 (log-sidecar):**

```text
2024-01-15 10:30:00 [INFO] 애플리케이션 로그 메시지 0
2024-01-15 10:30:05 [INFO] 애플리케이션 로그 메시지 1
2024-01-15 10:30:10 [INFO] 애플리케이션 로그 메시지 2
2024-01-15 10:30:15 [INFO] 애플리케이션 로그 메시지 3
2024-01-15 10:30:20 [INFO] 애플리케이션 로그 메시지 4
```

**검증 (metrics-sidecar):**

```text
2024-01-15 10:30:00 [METRIC] requests=0 latency=42ms
2024-01-15 10:30:05 [METRIC] requests=1 latency=87ms
2024-01-15 10:30:10 [METRIC] requests=2 latency=15ms
2024-01-15 10:30:15 [METRIC] requests=3 latency=63ms
2024-01-15 10:30:20 [METRIC] requests=4 latency=29ms
```

**검증 (app 컨테이너 — stdout 비어있음):**

```text
(빈 출력 — app 컨테이너는 파일에만 기록하고 stdout에는 아무것도 출력하지 않는다)
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
```

**검증:**

```text
total 8
drwxrwxrwx    2 root     root          4096 Jan 15 10:30 .
drwxr-xr-x    3 root     root          4096 Jan 15 10:30 ..
-rw-r--r--    1 root     root           500 Jan 15 10:31 app.log
-rw-r--r--    1 root     root           350 Jan 15 10:31 metrics.log
```

```bash
# readOnly 마운트 확인: sidecar에서 쓰기 시도 (실패해야 함)
kubectl exec sidecar-log-demo -n demo -c log-sidecar -- sh -c 'echo test > /var/log/app/test.txt' 2>&1 || echo "readOnly로 마운트되어 쓰기 불가"
```

**검증:**

```text
sh: can't create /var/log/app/test.txt: Read-only file system
readOnly로 마운트되어 쓰기 불가
```

**트러블슈팅 — 사이드카가 로그를 읽지 못하는 경우:**

| 증상 | 원인 | 해결 |
|------|------|------|
| 사이드카 로그 비어 있음 | 로그 파일이 아직 생성되지 않음 | 사이드카에 파일 존재 대기 로직 추가 |
| 사이드카 로그 중단 | 메인 컨테이너가 로그 파일을 rotate(이름 변경)함 | `tail -F`(대문자 F) 사용으로 파일 이름 변경 추적 |
| 볼륨 마운트 경로 불일치 | 사이드카와 메인의 mountPath가 다름 | 동일한 mountPath 사용 확인 |

**Step 5: tart-infra의 Istio sidecar와 비교**

```bash
# 실습에서 만든 로그 수집 sidecar Pod
kubectl get pod sidecar-log-demo -n demo -o jsonpath='{range .spec.containers[*]}{"name: "}{.name}{"\n"}{end}'

# tart-infra의 nginx-web Pod (Istio sidecar 자동 주입)
NGINX_POD=$(kubectl get pods -n demo -l app=nginx-web -o jsonpath='{.items[0].metadata.name}')
kubectl get pod $NGINX_POD -n demo -o jsonpath='{range .spec.containers[*]}{"name: "}{.name}{"\n"}{end}'
```

**검증:**

```text
# 수동 생성한 sidecar Pod:
name: app
name: log-sidecar
name: metrics-sidecar

# tart-infra nginx-web Pod (Istio 자동 주입):
name: nginx
name: istio-proxy
```

**내부 동작 비교:**

| 항목 | 수동 로그 수집 사이드카 | Istio istio-proxy |
|------|---------------------|------------------|
| 주입 방식 | 수동 (YAML 작성) | 자동 (MutatingWebhook) |
| 목적 | 로그 파일 stdout 전달 | 트래픽 프록시, mTLS, 메트릭 |
| Volume 공유 | emptyDir | emptyDir (Envoy 설정) |
| 네트워크 활용 | 미사용 | iptables 리다이렉트 |

**Step 6: 정리**

```bash
kubectl delete pod sidecar-log-demo -n demo --grace-period=0 --force 2>/dev/null
```

**검증:**

```bash
kubectl get pod sidecar-log-demo -n demo 2>&1
```

```text
Error from server (NotFound): pods "sidecar-log-demo" not found
```

**확인 문제:**

1. Sidecar 패턴에서 emptyDir Volume의 역할은 무엇인가?
2. log-sidecar가 readOnly로 Volume을 마운트한 이유는 무엇인가?
3. `kubectl logs`에서 `-c` 플래그를 지정하지 않으면 어떤 컨테이너의 로그가 출력되는가?
4. Sidecar 패턴과 Init Container 패턴의 차이점은 무엇인가?
5. 실제 프로덕션에서 로그 수집 sidecar 대신 DaemonSet 기반 로그 수집기(Fluentd/Fluent Bit)를 사용하는 경우의 장단점은 무엇인가?
6. `tail -f`와 `tail -F`의 차이는 무엇이며, 로그 rotation 환경에서 어떤 것을 사용해야 하는가?
7. 사이드카 컨테이너가 크래시하면 메인 컨테이너도 영향을 받는가?

---

### Lab 1.4: Ambassador 패턴 — 프록시 sidecar

**학습 목표:**
- Ambassador(대사) 패턴의 개념과 사용 사례를 이해한다.
- 메인 컨테이너가 localhost로만 통신하고, Ambassador 컨테이너가 외부 서비스로 프록시하는 구조를 구현한다.

**관련 CKAD 도메인:** Application Design and Build — Ambassador Pattern

**등장 배경:**

마이크로서비스 환경에서 애플리케이션은 다양한 외부 서비스(데이터베이스, 캐시, 메시지 큐)에 접근해야 한다. 환경(dev/staging/prod)마다 이 서비스의 주소와 인증 방식이 다르다. 기존에는 이 연결 로직을 애플리케이션 코드에 직접 구현하였으나, 다음과 같은 한계가 존재하였다:

- **환경별 코드 분기**: 환경 변수로 엔드포인트를 주입하더라도, 연결 풀링, 재시도, TLS 설정 등의 로직은 애플리케이션에 내장되어야 한다.
- **언어별 중복 구현**: Java, Python, Go 등 서로 다른 언어로 작성된 서비스마다 동일한 연결 로직을 중복 구현해야 한다.
- **독립적 업데이트 불가**: 프록시 로직을 변경하려면 애플리케이션을 재빌드하고 재배포해야 한다.

Ambassador 패턴은 이 문제를 해결한다. 메인 컨테이너는 항상 `localhost`의 고정 포트로만 접근하고, Ambassador 컨테이너가 실제 외부 서비스로의 프록시, 로드밸런싱, 인증, TLS 종료를 담당한다. 이는 tart-infra의 Istio sidecar(istio-proxy)가 수행하는 역할과 정확히 일치한다.

**내부 동작 원리:**

Ambassador 패턴의 네트워크 흐름:

```
메인 컨테이너 --[localhost:8080]--> Ambassador 컨테이너 --[실제 서비스 주소]--> 외부 서비스
```

1. 메인 컨테이너가 `localhost:8080`으로 HTTP 요청을 전송한다.
2. Ambassador 컨테이너(nginx 프록시)가 해당 포트에서 요청을 수신한다.
3. Ambassador가 요청을 실제 서비스(httpbin.demo.svc.cluster.local:80)로 프록시한다.
4. 응답이 역순으로 전달된다.

메인 컨테이너는 외부 서비스의 실제 주소를 알 필요가 없다.

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

**검증:**

```bash
kubectl get configmap ambassador-nginx-config -n demo -o jsonpath='{.data.default\.conf}'
```

```text
server {
    listen 8080;
    location / {
        proxy_pass http://httpbin.demo.svc.cluster.local:80;
        proxy_set_header Host httpbin.demo.svc.cluster.local;
    }
}
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

**검증 (app 로그):**

```text
SUCCESS: Ambassador를 통한 httpbin 응답 수신
SUCCESS: Ambassador를 통한 httpbin 응답 수신
```

**검증 (ambassador 로그):**

```text
10.244.x.x - - [15/Jan/2024:10:30:00 +0000] "GET /get HTTP/1.1" 200 xxx "-" "Wget"
```

**검증 (직접 호출):**

```text
{
  "args": {},
  "headers": {
    "Host": "httpbin.demo.svc.cluster.local",
    ...
  },
  "origin": "10.244.x.x",
  "url": "http://httpbin.demo.svc.cluster.local/get"
}
```

메인 컨테이너는 `localhost:8080`으로 요청했지만, 실제로는 `httpbin.demo.svc.cluster.local:80`에 도달한 것을 확인할 수 있다.

**Step 4: Istio sidecar와 Ambassador 패턴 비교**

```bash
# Istio의 istio-proxy도 Ambassador 패턴의 일종이다
# 메인 컨테이너의 모든 outbound 트래픽을 istio-proxy가 가로채서 처리한다

# nginx-web Pod에서 istio-proxy의 리스너 확인
NGINX_POD=$(kubectl get pods -n demo -l app=nginx-web -o jsonpath='{.items[0].metadata.name}')
kubectl exec $NGINX_POD -n demo -c istio-proxy -- pilot-agent request GET /listeners 2>/dev/null | head -20
```

**Istio istio-proxy vs 수동 Ambassador 비교:**

| 항목 | 수동 Ambassador | Istio istio-proxy |
|------|----------------|------------------|
| 트래픽 가로채기 | 메인 컨테이너가 명시적으로 localhost 호출 | iptables로 투명하게 리다이렉트 |
| 설정 관리 | ConfigMap으로 수동 관리 | Istiod가 자동으로 xDS 프로토콜로 배포 |
| 기능 범위 | 단순 프록시 | mTLS, 서킷 브레이커, 레이트 리밋, 메트릭 |
| 적용 범위 | 단일 Pod | 메시 전체 |

**Step 5: 정리**

```bash
kubectl delete pod ambassador-demo -n demo --grace-period=0 --force 2>/dev/null
kubectl delete configmap ambassador-nginx-config -n demo 2>/dev/null
```

**검증:**

```bash
kubectl get pod ambassador-demo -n demo 2>&1
kubectl get configmap ambassador-nginx-config -n demo 2>&1
```

```text
Error from server (NotFound): pods "ambassador-demo" not found
Error from server (NotFound): configmaps "ambassador-nginx-config" not found
```

**확인 문제:**

1. Ambassador 패턴과 Sidecar 패턴의 차이점은 무엇인가?
2. Ambassador 패턴에서 메인 컨테이너가 `localhost`로만 통신하는 것의 장점은 무엇인가?
3. Istio의 istio-proxy는 Ambassador 패턴과 Sidecar 패턴 중 어느 것에 더 가까운가? 그 이유는?
4. Ambassador 컨테이너의 설정을 ConfigMap으로 분리한 이유는 무엇인가?
5. Ambassador 컨테이너가 외부 서비스에 연결하지 못하면 메인 컨테이너에 어떤 영향이 있는가?

---

### Lab 1.5: Volume 유형 실습 (emptyDir, configMap, secret, PVC)

**학습 목표:**
- Kubernetes의 주요 Volume 유형(emptyDir, configMap, secret, hostPath, PVC)을 이해한다.
- 각 Volume 유형의 사용 사례와 생명주기를 파악한다.
- tart-infra demo 앱에서 사용 중인 Volume을 분석한다.

**관련 CKAD 도메인:** Application Design and Build — Volumes

**등장 배경:**

컨테이너는 본질적으로 ephemeral(임시)이다. 컨테이너가 재시작되면 파일 시스템의 모든 변경 사항이 사라진다. 이는 다음과 같은 문제를 야기한다:

- **데이터 유실**: 데이터베이스, 캐시 등 상태를 유지하는 애플리케이션에서 컨테이너 재시작 시 데이터가 사라진다.
- **설정 공유 불가**: 설정 파일을 컨테이너 이미지에 포함하면 이미지를 재빌드해야 설정을 변경할 수 있다.
- **컨테이너 간 데이터 교환 불가**: 같은 Pod 내의 여러 컨테이너가 데이터를 공유할 방법이 없다.

쿠버네티스의 Volume 추상화는 이 문제를 해결한다. Volume의 생명주기는 컨테이너가 아닌 Pod에 연결되므로, 컨테이너가 재시작되어도 데이터가 유지된다. PersistentVolume/PersistentVolumeClaim을 사용하면 Pod가 삭제되어도 데이터가 유지된다.

**Volume 유형별 특성:**

| Volume 유형 | 생명주기 | 사용 사례 | 데이터 지속성 |
|------------|---------|----------|-------------|
| emptyDir | Pod와 동일 | 컨테이너 간 임시 데이터 공유 | Pod 삭제 시 소멸 |
| configMap | ConfigMap 리소스와 동일 | 설정 파일 주입 | ConfigMap 업데이트 시 자동 갱신 (subPath 제외) |
| secret | Secret 리소스와 동일 | 민감 정보 주입 | tmpfs에 마운트 (디스크에 기록되지 않음) |
| hostPath | 노드와 동일 | 노드 로그 접근, 특수 장치 접근 | 노드에 영구 저장 (보안 위험) |
| PVC | PV와 동일 | 데이터베이스, 영구 스토리지 | Pod 삭제 후에도 유지 |

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

**검증:**

```text
Container: nginx
  Mount: istio-envoy -> /etc/istio/proxy
  Mount: istiod-ca-cert -> /var/run/secrets/istio
Container: istio-proxy
  Mount: istio-envoy -> /etc/istio/proxy
  Mount: istiod-ca-cert -> /var/run/secrets/istio
  Mount: istio-token -> /var/run/secrets/tokens
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

**검증:**

```text
Mon Jan 15 10:30:00 UTC 2024
Mon Jan 15 10:30:05 UTC 2024
Mon Jan 15 10:30:10 UTC 2024
Mon Jan 15 10:30:15 UTC 2024
Mon Jan 15 10:30:20 UTC 2024
```

**내부 동작 — emptyDir 저장 위치:**

emptyDir은 기본적으로 노드의 디스크에 생성된다. 정확한 경로는 kubelet의 `--root-dir` 설정에 따라 다르며, 일반적으로 `/var/lib/kubelet/pods/<pod-uid>/volumes/kubernetes.io~empty-dir/<volume-name>/`이다.

`medium: Memory`를 지정하면 tmpfs(메모리 기반 파일시스템)에 생성된다. 이 경우 I/O 성능이 향상되지만, 노드 메모리를 소비하며 노드 재시작 시 데이터가 사라진다.

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

**검증:**

```text
total 0
lrwxrwxrwx  1 root root  15 Jan 15 10:00 APP_ENV -> ..data/APP_ENV
lrwxrwxrwx  1 root root  16 Jan 15 10:00 APP_NAME -> ..data/APP_NAME
lrwxrwxrwx  1 root root  16 Jan 15 10:00 LOG_LEVEL -> ..data/LOG_LEVEL
```

ConfigMap의 각 키가 파일명으로, 값이 파일 내용으로 마운트된 것을 확인할 수 있다. 각 파일은 심볼릭 링크이며, `..data` 디렉터리를 경유한다. 이 구조는 ConfigMap 업데이트 시 원자적(atomic) 교체를 가능하게 한다.

**내부 동작 — ConfigMap Volume 자동 갱신:**

ConfigMap Volume은 kubelet의 sync 주기(기본 60초)에 따라 자동으로 갱신된다. 갱신 과정은 다음과 같다:

1. kubelet이 ConfigMap 변경을 감지한다.
2. 새로운 `..data_tmp` 디렉터리를 생성하고 새 데이터를 기록한다.
3. `..data` 심볼릭 링크를 원자적으로 `..data_tmp`로 교체한다.
4. 기존 데이터 디렉터리를 삭제한다.

단, `subPath`를 사용하여 마운트한 경우에는 자동 갱신이 동작하지 않는다. subPath는 심볼릭 링크가 아닌 실제 파일 복사이기 때문이다.

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

**검증:**

```text
demo
demo123
```

```bash
kubectl exec vol-secret-demo -n demo -- df -h /secrets/
```

```text
Filesystem      Size  Used Avail Use% Mounted on
tmpfs           64M    4.0K   64M   1% /secrets
```

Secret이 tmpfs에 마운트되는 이유: tmpfs는 메모리 기반 파일시스템이므로 디스크에 기록되지 않는다. 이는 Secret 데이터가 노드의 물리 디스크에 남지 않도록 하여 보안을 강화하기 위한 설계이다.

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

**검증:**

```text
Filesystem      Size  Used Avail Use% Mounted on
tmpfs            64M     0   64M   0% /cache
```

**장애 시나리오 — sizeLimit 초과:**

`sizeLimit`을 설정한 emptyDir에 제한을 초과하는 데이터를 기록하면 어떻게 되는가? kubelet은 주기적으로(기본 2분) 디스크 사용량을 확인한다. sizeLimit을 초과하면 해당 Pod를 evict한다.

```bash
# sizeLimit 초과 테스트 (실행하지 말 것 — 참고용)
# kubectl exec vol-memory-demo -n demo -- dd if=/dev/zero of=/cache/large-file bs=1M count=100
# 약 2분 후 Pod가 Evicted 상태로 전환된다
```

**Step 6: 정리**

```bash
kubectl delete pod vol-emptydir-demo vol-configmap-demo vol-secret-demo vol-memory-demo -n demo --grace-period=0 --force 2>/dev/null
kubectl delete configmap app-config -n demo 2>/dev/null
kubectl delete secret db-credentials -n demo 2>/dev/null
```

**검증:**

```bash
kubectl get pods -n demo -l app=vol-demo 2>/dev/null
```

```text
No resources found in demo namespace.
```

**확인 문제:**

1. emptyDir Volume의 생명주기는 무엇인가? (Pod 삭제 시 데이터는 어떻게 되는가?)
2. ConfigMap Volume과 Secret Volume의 마운트 방식의 공통점과 차이점은 무엇인가?
3. Secret이 tmpfs에 마운트되는 이유는 무엇인가?
4. `emptyDir.medium: Memory`를 사용하는 경우와 기본 emptyDir의 차이점은 무엇인가?
5. PVC(PersistentVolumeClaim)는 emptyDir와 비교하여 어떤 장점이 있는가?
6. ConfigMap Volume의 자동 갱신 메커니즘은 어떻게 동작하며, subPath 사용 시 왜 갱신되지 않는가?
7. emptyDir의 sizeLimit을 초과하면 어떤 일이 발생하는가?

---

### Lab 1.6: Dockerfile 최적화 분석 (demo 앱 이미지 레이어 비교)

**학습 목표:**
- 컨테이너 이미지의 레이어 구조를 이해한다.
- Alpine 기반 이미지와 일반 이미지의 크기 차이를 비교한다.
- 이미지 최적화 전략(multi-stage build, alpine, distroless)을 학습한다.

**관련 CKAD 도메인:** Application Design and Build — Container Images, Dockerfiles

**등장 배경:**

컨테이너 이미지 크기는 다음과 같은 운영 지표에 직접적인 영향을 미친다:

- **배포 속도**: 이미지가 클수록 노드에 pull하는 시간이 길어진다. 이는 Pod 시작 지연으로 이어진다.
- **네트워크 비용**: 레지스트리와 노드 간 전송되는 데이터 양이 증가한다.
- **보안 공격 표면**: 불필요한 패키지가 포함될수록 취약점이 증가한다.
- **스토리지 비용**: 노드의 디스크 공간을 소비한다.

기존에는 하나의 Dockerfile에서 빌드 도구와 런타임을 모두 포함하는 "fat image"를 생성하였다. Go 컴파일러를 포함한 이미지는 800MB 이상이 되기도 하였다. Multi-stage build는 빌드 환경과 실행 환경을 분리하여 이 문제를 해결한다.

**이미지 최적화 기법 비교:**

| 기법 | 원리 | 일반적 크기 감소 |
|------|------|----------------|
| Alpine 기반 | glibc 대신 musl libc를 사용하는 경량 Linux 배포판 | 50-90% |
| Multi-stage build | 빌드 단계와 실행 단계를 분리하여 빌드 도구를 최종 이미지에서 제거 | 70-95% |
| Distroless | Google이 제공하는 애플리케이션 런타임만 포함한 이미지. 셸이 없음 | 80-95% |
| Scratch | 완전히 빈 베이스 이미지. 정적 바이너리만 포함 | 95%+ |

**Step 1: demo 앱에서 사용 중인 이미지 목록 확인**

```bash
# 모든 컨테이너의 이미지 확인
kubectl get pods -n demo -o jsonpath='{range .items[*]}{range .spec.containers[*]}{"image: "}{.image}{"\n"}{end}{end}' | sort -u
```

**검증:**

```text
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

**검증:**

```text
nginx:alpine
redis:7-alpine
postgres:16-alpine
rabbitmq:3-management-alpine
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

**Alpine의 한계:**

Alpine은 musl libc를 사용하므로 glibc 기반 바이너리와 호환되지 않는다. 다음 상황에서 문제가 발생할 수 있다:

- **glibc 전용 라이브러리**: 일부 Python/Node.js 네이티브 모듈이 musl에서 컴파일되지 않는다.
- **DNS 해석 차이**: musl의 DNS resolver는 glibc와 동작이 다르며, 특정 환경에서 DNS 해석 지연이 발생할 수 있다.
- **성능 차이**: 특정 워크로드에서 musl이 glibc보다 느릴 수 있다 (메모리 할당 패턴 차이).

이 경우 `*-slim` 태그(Debian slim) 또는 distroless 이미지가 대안이다.

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

**Dockerfile 최적화 체크리스트:**

| 항목 | 설명 | 영향 |
|------|------|------|
| Multi-stage build 사용 | 빌드 도구를 최종 이미지에서 제거 | 이미지 크기 대폭 감소 |
| `RUN` 명령 합치기 | 여러 RUN을 `&&`로 연결하여 레이어 수 감소 | 레이어 수 감소, 중간 파일 잔류 방지 |
| `.dockerignore` 사용 | 빌드 컨텍스트에서 불필요한 파일 제외 | 빌드 속도 향상 |
| `COPY` 순서 최적화 | 변경 빈도가 낮은 파일(go.mod)을 먼저 복사 | 캐시 활용 극대화 |
| 비root 사용자 설정 | `USER nonroot` 추가 | 보안 강화 |

**확인 문제:**

1. Alpine 기반 이미지를 사용하는 것의 장점과 단점을 각각 2가지 설명하시오.
2. Multi-stage build에서 `FROM ... AS builder`의 역할은 무엇인가?
3. `COPY --from=builder`의 의미를 설명하시오.
4. Dockerfile에서 `RUN` 명령을 여러 줄로 분리하는 것과 `&&`로 연결하는 것의 차이는 무엇인가?
5. `.dockerignore` 파일의 역할은 무엇인가?
6. Alpine의 musl libc와 glibc의 차이가 실무에서 어떤 문제를 유발할 수 있는가?
7. distroless 이미지에서 `kubectl exec`로 셸에 접속할 수 없는 이유는 무엇인가?

---

## 실습 2: Application Deployment (20%)

> **CKAD 시험 도메인:** Application Deployment
> 이 영역은 Deployment 전략(Rolling Update, Recreate), Canary/Blue-Green 배포, Helm, Kustomize, 그리고 GitOps 워크플로우를 평가한다.

#### 등장 배경

쿠버네티스 이전의 배포 환경에서는 애플리케이션 업데이트가 수동 프로세스였다. 운영자가 서버에 SSH로 접속하여 바이너리를 교체하거나, 로드밸런서에서 서버를 제거한 후 업데이트하는 방식이었다. 이 방식에는 다음과 같은 한계가 있었다:

- **다운타임 불가피**: 업데이트 중 서비스가 중단된다.
- **롤백 어려움**: 이전 버전으로 복구하려면 수동으로 바이너리를 교체해야 한다.
- **일관성 부재**: 서버마다 업데이트 시점이 다르면 구/신 버전이 혼재한다.
- **추적 불가**: 언제, 누가, 무엇을 변경했는지 기록이 남지 않는다.

쿠버네티스의 Deployment 리소스는 이 문제를 선언적으로 해결한다. desired state를 정의하면 Deployment 컨트롤러가 현재 상태를 desired state로 수렴시킨다. Rolling Update, Recreate 전략을 제공하며, 롤아웃 히스토리를 유지하여 특정 리비전으로의 롤백이 가능하다.

---

### Lab 2.1: Deployment 생성 (kubectl create deployment + YAML)

**학습 목표:**
- `kubectl create deployment` 명령형 방식과 YAML 선언형 방식의 차이를 이해한다.
- Deployment의 핵심 필드(replicas, selector, template)를 학습한다.
- tart-infra의 실제 Deployment 구조를 분석한다.

**관련 CKAD 도메인:** Application Deployment — Deployments

**내부 동작 원리 — Deployment 컨트롤러:**

Deployment는 직접 Pod를 관리하지 않는다. Deployment -> ReplicaSet -> Pod의 계층 구조로 동작한다:

1. 사용자가 Deployment를 생성한다.
2. Deployment 컨트롤러가 Deployment spec을 기반으로 ReplicaSet을 생성한다.
3. ReplicaSet 컨트롤러가 spec.replicas 수만큼 Pod를 생성한다.
4. 이미지를 변경하면 Deployment 컨트롤러가 새 ReplicaSet을 생성한다.
5. 새 ReplicaSet의 Pod를 점진적으로 늘리고, 기존 ReplicaSet의 Pod를 줄인다 (Rolling Update).
6. 기존 ReplicaSet은 삭제되지 않고 replicas=0으로 유지된다 (롤백을 위해).

```
Deployment
  └── ReplicaSet (revision 1, replicas=0)
  └── ReplicaSet (revision 2, replicas=0)
  └── ReplicaSet (revision 3, replicas=3)  ← 현재 활성
        ├── Pod 1
        ├── Pod 2
        └── Pod 3
```

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

**검증:**

```bash
kubectl get deployment test-nginx -n demo
```

```text
NAME         READY   UP-TO-DATE   AVAILABLE   AGE
test-nginx   2/2     2            2           30s
```

```bash
kubectl get pods -n demo -l app=test-nginx
```

```text
NAME                          READY   STATUS    RESTARTS   AGE
test-nginx-xxxxx-aaaa         2/2     Running   0          30s
test-nginx-xxxxx-bbbb         2/2     Running   0          30s
```

(READY가 2/2인 이유는 Istio sidecar injection 때문이다.)

**Step 2: --dry-run=client로 YAML 생성 (CKAD 시험 핵심 기법)**

CKAD 시험에서는 시간이 제한되므로, YAML을 처음부터 작성하는 것은 비효율적이다. `--dry-run=client -o yaml`을 사용하면 리소스를 생성하지 않고 YAML만 출력할 수 있다. 이 YAML을 파일로 저장한 후 필요한 필드를 추가/수정하는 것이 가장 빠르다.

```bash
# YAML을 파일로 생성 (실제로 적용하지 않음)
kubectl create deployment test-app --image=nginx:alpine --replicas=3 --dry-run=client -o yaml > /tmp/test-app-deploy.yaml

# 생성된 YAML 확인
cat /tmp/test-app-deploy.yaml
```

**검증:**

```text
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

이 YAML에서 `resources: {}`를 적절한 requests/limits로 교체하고, probe를 추가하는 식으로 활용한다.

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

**검증:**

```text
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

**핵심 필드 관계:**

`spec.selector.matchLabels`와 `spec.template.metadata.labels`는 반드시 일치해야 한다. 불일치하면 Deployment 생성이 거부된다. 이유는 Deployment가 자신이 관리하는 Pod를 selector로 식별하기 때문이다. selector가 template의 레이블과 다르면, Deployment가 생성한 Pod를 자신의 소유로 인식하지 못한다.

```bash
# ReplicaSet 확인 — Deployment가 관리하는 ReplicaSet
kubectl get replicaset -n demo -l app=nginx-web
```

**검증:**

```text
NAME                     DESIRED   CURRENT   READY   AGE
nginx-web-xxxxx          3         3         3       5d
```

**Step 4: Deployment 스케일링**

```bash
# 수동 스케일링
kubectl scale deployment test-nginx --replicas=5 -n demo
kubectl get pods -n demo -l app=test-nginx -w

# 스케일링 결과 확인
kubectl get deployment test-nginx -n demo
```

**검증:**

```text
NAME         READY   UP-TO-DATE   AVAILABLE   AGE
test-nginx   5/5     5            5           2m
```

```bash
# 다시 2로 축소
kubectl scale deployment test-nginx --replicas=2 -n demo
kubectl get pods -n demo -l app=test-nginx
```

**검증:**

```text
NAME                          READY   STATUS        RESTARTS   AGE
test-nginx-xxxxx-aaaa         2/2     Running       0          3m
test-nginx-xxxxx-bbbb         2/2     Running       0          3m
test-nginx-xxxxx-cccc         2/2     Terminating   0          1m
test-nginx-xxxxx-dddd         2/2     Terminating   0          1m
test-nginx-xxxxx-eeee         2/2     Terminating   0          1m
```

스케일 다운 시 Pod가 Terminating 상태를 거쳐 삭제된다. 삭제되는 Pod의 선택 기준은 다음과 같다:
1. 아직 바인딩되지 않은(pending) Pod를 먼저 삭제한다.
2. Ready가 아닌 Pod를 먼저 삭제한다.
3. 같은 노드에 더 많은 Pod가 있는 경우 해당 노드의 Pod를 먼저 삭제한다.
4. 나이가 적은(최근에 생성된) Pod를 먼저 삭제한다.

**Step 5: 정리**

```bash
kubectl delete deployment test-nginx -n demo
rm -f /tmp/test-app-deploy.yaml
```

**검증:**

```bash
kubectl get deployment test-nginx -n demo 2>&1
```

```text
Error from server (NotFound): deployments.apps "test-nginx" not found
```

**확인 문제:**

1. `kubectl create deployment`와 `kubectl apply -f`의 차이점은 무엇인가?
2. `--dry-run=client -o yaml`이 CKAD 시험에서 유용한 이유는 무엇인가?
3. Deployment의 `spec.selector.matchLabels`와 `spec.template.metadata.labels`가 일치해야 하는 이유는 무엇인가?
4. nginx-web Deployment의 requests(50m/64Mi)와 limits(200m/128Mi)가 다른 이유는 무엇인가?
5. `kubectl scale`과 `kubectl edit`으로 replicas를 변경하는 방법의 차이점은 무엇인가?
6. Deployment가 ReplicaSet을 통해 Pod를 관리하는 3단계 구조의 장점은 무엇인가?
7. 스케일 다운 시 삭제 대상 Pod는 어떤 기준으로 선택되는가?

---

### Lab 2.2: Rolling Update 상세 (maxSurge, maxUnavailable 변경)

**학습 목표:**
- Rolling Update 전략의 `maxSurge`와 `maxUnavailable` 파라미터를 이해한다.
- 다양한 설정 조합에 따른 업데이트 동작 차이를 관찰한다.
- tart-infra nginx-web의 실제 Rolling Update를 수행한다.

**관련 CKAD 도메인:** Application Deployment — Rolling Updates

**등장 배경:**

쿠버네티스 이전의 배포 방식인 Recreate(모든 인스턴스를 중지 후 새 버전 시작)는 다운타임이 불가피하다. Rolling Update는 점진적으로 Pod를 교체하여 다운타임 없이 업데이트를 수행한다. 그러나 Rolling Update에도 트레이드오프가 존재한다:

- **속도 vs 안정성**: 빠르게 교체하면 배포는 빨리 끝나지만, 문제 발생 시 영향 범위가 크다.
- **리소스 사용량**: 새 Pod와 기존 Pod가 동시에 실행되므로 추가 리소스가 필요하다.
- **API 호환성**: 구/신 버전이 동시에 트래픽을 처리하므로, 하위 호환성이 필요하다.

`maxSurge`와 `maxUnavailable`은 이 트레이드오프를 조정하는 파라미터이다.

**내부 동작 원리:**

Deployment 컨트롤러의 Rolling Update 알고리즘:

1. 새 ReplicaSet을 생성한다 (replicas=0).
2. 새 ReplicaSet의 replicas를 maxSurge만큼 증가시킨다.
3. 새 Pod가 Ready 상태가 되면, 기존 ReplicaSet의 replicas를 maxUnavailable만큼 감소시킨다.
4. 기존 Pod가 종료되면, 새 ReplicaSet의 replicas를 다시 증가시킨다.
5. 모든 기존 Pod가 새 Pod로 교체될 때까지 2-4를 반복한다.

**maxSurge/maxUnavailable 동작 매트릭스:**

| 설정 | maxSurge | maxUnavailable | 동작 | 리소스 영향 |
|------|----------|----------------|------|-----------|
| 기본값 | 25% | 25% | 일부 추가 생성 + 일부 제거 동시 진행 | 중간 |
| 무중단 | 1 | 0 | 새 Pod가 Ready 되어야 구 Pod 제거 | 추가 리소스 필요 |
| 빠른 배포 | 100% | 0 | 모든 새 Pod를 먼저 생성 후 교체 | 2배 리소스 필요 |
| 최소 리소스 | 0 | 1 | 하나씩 교체 (추가 리소스 불필요) | 추가 리소스 없음, 느림 |
| Recreate | - | - | 모든 Pod 중지 후 새로 생성 | 다운타임 발생 |

**Step 1: 현재 Rolling Update 전략 확인**

```bash
# nginx-web의 Rolling Update 전략 확인
kubectl get deployment nginx-web -n demo -o jsonpath='{.spec.strategy}' | jq .
```

**검증:**

```text
{
  "type": "RollingUpdate",
  "rollingUpdate": {
    "maxSurge": "25%",
    "maxUnavailable": "25%"
  }
}
```

**Step 2: 테스트용 Deployment로 Rolling Update 실습**

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

**검증:**

```text
deployment "rolling-demo" successfully rolled out
```

**Step 3: Rolling Update 실행 및 관찰**

```bash
# 터미널 1: Pod 상태를 지속 모니터링
kubectl get pods -n demo -l app=rolling-demo -w &

# 이미지 업데이트
kubectl set image deployment/rolling-demo nginx=nginx:1.25-alpine -n demo --record

# 롤아웃 상태 확인
kubectl rollout status deployment rolling-demo -n demo
```

**검증 (watch 출력):**

```text
NAME                            READY   STATUS              RESTARTS   AGE
rolling-demo-aaa-111            2/2     Running             0          2m
rolling-demo-aaa-222            2/2     Running             0          2m
rolling-demo-aaa-333            2/2     Running             0          2m
rolling-demo-bbb-111            0/2     ContainerCreating   0          1s
rolling-demo-bbb-111            2/2     Running             0          5s
rolling-demo-aaa-111            2/2     Terminating         0          2m
rolling-demo-bbb-222            0/2     ContainerCreating   0          1s
rolling-demo-bbb-222            2/2     Running             0          5s
rolling-demo-aaa-222            2/2     Terminating         0          2m
rolling-demo-bbb-333            0/2     ContainerCreating   0          1s
rolling-demo-bbb-333            2/2     Running             0          5s
rolling-demo-aaa-333            2/2     Terminating         0          2m
```

`maxSurge=1, maxUnavailable=0`이므로:
- 항상 최소 3개 Pod가 Running 상태를 유지한다 (maxUnavailable=0).
- 최대 4개 Pod(3+1)가 동시에 존재할 수 있다 (maxSurge=1).
- 새 Pod가 Ready가 된 후에야 기존 Pod가 종료된다.

**Step 4: 롤아웃 히스토리 확인**

```bash
# 롤아웃 히스토리 확인
kubectl rollout history deployment rolling-demo -n demo

# 특정 리비전 상세 확인
kubectl rollout history deployment rolling-demo -n demo --revision=1
kubectl rollout history deployment rolling-demo -n demo --revision=2
```

**검증:**

```text
deployment.apps/rolling-demo
REVISION  CHANGE-CAUSE
1         <none>
2         kubectl set image deployment/rolling-demo nginx=nginx:1.25-alpine --record=true
```

**Step 5: ReplicaSet 관계 확인**

```bash
# 모든 ReplicaSet 확인
kubectl get replicaset -n demo -l app=rolling-demo
```

**검증:**

```text
NAME                      DESIRED   CURRENT   READY   AGE
rolling-demo-aaa          0         0         0       5m
rolling-demo-bbb          3         3         3       3m
```

기존 ReplicaSet(revision 1)은 replicas=0으로 유지되지만 삭제되지 않는다. 이는 롤백 시 해당 ReplicaSet을 다시 활성화하기 위함이다.

**Step 6: 정리**

```bash
kubectl delete deployment rolling-demo -n demo
```

**확인 문제:**

1. `maxSurge: 1, maxUnavailable: 0` 설정의 장단점은 무엇인가?
2. `maxSurge: 0, maxUnavailable: 1` 설정은 어떤 시나리오에 적합한가?
3. Rolling Update와 Recreate 전략의 차이점은 무엇인가?
4. `kubectl rollout status`가 반환하는 시점은 언제인가?
5. `--record` 플래그의 역할은 무엇인가? (참고: 이 플래그는 deprecated 되었다.)
6. 퍼센트 기반 maxSurge/maxUnavailable 계산 시 소수점은 어떻게 처리되는가?
7. Rolling Update 중 새 Pod의 Readiness Probe가 실패하면 어떤 일이 발생하는가?

---

### Lab 2.3: Rollback 실습 (rollout undo --to-revision)

**학습 목표:**
- Deployment의 롤백(rollout undo) 메커니즘을 이해한다.
- 특정 리비전으로의 롤백(`--to-revision`)을 실습한다.
- 롤백 후 ReplicaSet 상태를 확인한다.

**관련 CKAD 도메인:** Application Deployment — Rollbacks

**등장 배경:**

프로덕션 환경에서 새 버전 배포 후 문제가 발견되는 것은 흔한 상황이다. 기존에는 이전 버전의 바이너리를 수동으로 복원하거나, 이전 Docker 이미지 태그를 기억하여 다시 배포해야 하였다. 이 과정은 시간이 소요되며 실수의 여지가 크다. 쿠버네티스의 롤백 기능은 Deployment의 리비전 히스토리를 자동으로 관리하여, 한 줄의 명령으로 이전 상태로 복원할 수 있다.

**내부 동작 원리:**

롤백은 실제로 "새 배포"이다. 리비전 N으로 롤백하면:

1. Deployment 컨트롤러가 리비전 N의 ReplicaSet을 찾는다.
2. 해당 ReplicaSet의 Pod template을 Deployment의 현재 spec에 복사한다.
3. 새 리비전 번호가 부여된다 (이전 리비전 번호로 돌아가지 않는다).
4. Rolling Update 절차에 따라 Pod가 교체된다.
5. 롤백된 리비전의 ReplicaSet은 기존 목록에서 제거되고 새 리비전으로 재등록된다.

예를 들어 revision 1, 2, 3이 있는 상태에서 revision 2로 롤백하면:
- revision 2가 사라지고 revision 4로 재등록된다.
- 결과: revision 1, 3, 4 (4의 내용은 2와 동일)

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

**검증:**

```text
NAME                          READY   STATUS             RESTARTS   AGE
rollback-demo-aaa-111         2/2     Running            0          2m
rollback-demo-aaa-222         2/2     Running            0          2m
rollback-demo-aaa-333         2/2     Running            0          2m
rollback-demo-bbb-111         0/2     ImagePullBackOff   0          30s
```

`maxUnavailable=0`(기본값 25%이지만 replicas=3이면 최소 1개 unavailable 허용)이므로 기존 Pod는 유지되면서 새 Pod만 ImagePullBackOff 상태이다.

**장애 시나리오 — ImagePullBackOff 진단:**

```bash
# 이벤트에서 상세 원인 확인
kubectl describe pod -n demo -l app=rollback-demo | grep -A5 "Events:" | tail -10
```

```text
Warning  Failed     5s    kubelet  Failed to pull image "nginx:nonexistent-tag":
  rpc error: code = NotFound desc = failed to pull and unpack image
  "docker.io/library/nginx:nonexistent-tag": not found
Warning  Failed     5s    kubelet  Error: ErrImagePull
Normal   BackOff    3s    kubelet  Back-off pulling image "nginx:nonexistent-tag"
Warning  Failed     3s    kubelet  Error: ImagePullBackOff
```

ImagePullBackOff의 백오프 간격: 10초 -> 20초 -> 40초 -> 80초 -> ... -> 최대 5분

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

**검증:**

```text
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

**검증:**

```text
nginx:1.23-alpine
```

**Step 5: ReplicaSet과 리비전의 관계 확인**

```bash
# 모든 ReplicaSet과 해당 이미지 확인
kubectl get replicaset -n demo -l app=rollback-demo -o jsonpath='{range .items[*]}{"RS: "}{.metadata.name}{" Replicas: "}{.spec.replicas}{" Image: "}{.spec.template.spec.containers[0].image}{"\n"}{end}'
```

**검증:**

```text
RS: rollback-demo-aaa Replicas: 3 Image: nginx:1.23-alpine
RS: rollback-demo-bbb Replicas: 0 Image: nginx:1.24-alpine
RS: rollback-demo-ccc Replicas: 0 Image: nginx:1.25-alpine
RS: rollback-demo-ddd Replicas: 0 Image: nginx:nonexistent-tag
```

각 리비전은 별도의 ReplicaSet으로 유지되며, 롤백 시 해당 ReplicaSet의 replicas가 다시 설정되는 것을 확인할 수 있다.

**Step 6: revisionHistoryLimit 확인**

```bash
# Deployment의 revisionHistoryLimit 확인 (기본값: 10)
kubectl get deployment rollback-demo -n demo -o jsonpath='{.spec.revisionHistoryLimit}'
echo ""
```

**검증:**

```text
10
```

`revisionHistoryLimit`은 유지할 기존 ReplicaSet의 최대 수이다. 기본값 10이면 최근 10개의 리비전까지 롤백이 가능하다. 0으로 설정하면 어떤 리비전으로도 롤백할 수 없으므로, 프로덕션에서는 권장되지 않는다.

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
6. 진행 중인 롤아웃을 취소하려면 어떻게 해야 하는가?
7. `kubectl rollout pause`와 `kubectl rollout resume`의 용도는 무엇인가?

---

### Lab 2.4: Canary 배포 관찰 (httpbin v1:80% v2:20% 실제 트래픽 테스트)

**학습 목표:**
- 쿠버네티스 네이티브 Canary 배포와 Istio 기반 Canary 배포의 차이를 이해한다.
- replica 비율 기반 트래픽 분배를 실습한다.
- VirtualService weight 기반 정밀 트래픽 제어를 실습한다.

**관련 CKAD 도메인:** Application Deployment — Canary Deployments

**등장 배경:**

Blue-Green 배포는 전체 트래픽을 한 번에 전환하므로 새 버전에 문제가 있으면 모든 사용자가 영향을 받는다. Canary 배포는 소수의 트래픽만 새 버전으로 전송하여 위험을 최소화하는 배포 전략이다. "canary"라는 이름은 광산에서 유독 가스를 감지하기 위해 카나리아 새를 사용한 관행에서 유래하였다.

쿠버네티스 네이티브 Canary는 replica 수 비율로 트래픽을 분배하므로 정밀도가 낮다 (예: 10% 트래픽을 보내려면 stable 9 + canary 1 = 총 10개 Pod 필요). Istio VirtualService는 weight 필드로 1% 단위의 정밀한 트래픽 제어가 가능하며, 헤더 기반 라우팅도 지원한다.

**내부 동작 원리:**

쿠버네티스 네이티브 Canary는 두 개의 Deployment(stable, canary)가 동일한 label을 공유하고, 하나의 Service가 해당 label로 Pod를 선택하는 구조이다. Service의 Endpoints에 양쪽 Deployment의 Pod가 모두 포함되며, kube-proxy는 iptables 규칙에서 각 Pod에 동일한 확률로 트래픽을 분배한다. 따라서 트래픽 비율은 Pod 수 비율과 동일하다.

Istio 기반 Canary는 다르게 동작한다. VirtualService가 Envoy sidecar의 라우팅 테이블을 제어하여, weight 필드에 지정된 비율로 DestinationRule의 subset(version label)에 트래픽을 분배한다. Pod 수와 무관하게 정밀한 비율 제어가 가능하다.

**Step 1: 네이티브 Canary — Stable 배포**

```bash
# stable 버전 배포 (v1)
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: httpbin-stable
spec:
  replicas: 4
  selector:
    matchLabels:
      app: httpbin
      track: stable
  template:
    metadata:
      labels:
        app: httpbin
        track: stable
        version: v1
    spec:
      containers:
        - name: httpbin
          image: kennethreitz/httpbin:latest
          ports:
            - containerPort: 80
          env:
            - name: VERSION
              value: "v1"
---
apiVersion: v1
kind: Service
metadata:
  name: httpbin-svc
spec:
  selector:
    app: httpbin        # stable과 canary 모두 선택
  ports:
    - port: 80
      targetPort: 80
  type: ClusterIP
EOF
```

**검증:**

```bash
kubectl get deployment httpbin-stable -n demo
kubectl get endpoints httpbin-svc -n demo
```

```text
NAME             READY   UP-TO-DATE   AVAILABLE   AGE
httpbin-stable   4/4     4            4           30s

NAME          ENDPOINTS                                            AGE
httpbin-svc   10.244.1.10:80,10.244.1.11:80,10.244.2.8:80 + 1..   30s
```

**Step 2: Canary 배포 추가 (v2)**

```bash
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: httpbin-canary
spec:
  replicas: 1
  selector:
    matchLabels:
      app: httpbin
      track: canary
  template:
    metadata:
      labels:
        app: httpbin
        track: canary
        version: v2
    spec:
      containers:
        - name: httpbin
          image: kennethreitz/httpbin:latest
          ports:
            - containerPort: 80
          env:
            - name: VERSION
              value: "v2"
EOF
```

**검증:**

```bash
# Endpoints에 canary Pod도 포함되는지 확인
kubectl get endpoints httpbin-svc -n demo
```

```text
NAME          ENDPOINTS                                                        AGE
httpbin-svc   10.244.1.10:80,10.244.1.11:80,10.244.2.8:80,10.244.2.9:80 + 1   60s
```

총 5개 Pod (stable 4 + canary 1)이므로 canary 트래픽 비율은 약 20%이다.

**Step 3: 트래픽 비율 검증**

```bash
# 100회 요청을 보내어 v1/v2 응답 비율 확인
kubectl run traffic-test --image=busybox:1.36 --rm -it --restart=Never -n demo -- sh -c '
  V1=0; V2=0
  for i in $(seq 1 100); do
    RESP=$(wget -qO- http://httpbin-svc/headers 2>/dev/null)
    echo "$RESP" | grep -q "v2" && V2=$((V2+1)) || V1=$((V1+1))
  done
  echo "v1: $V1, v2: $V2"
'
```

```text
v1: 81, v2: 19
```

Pod 수 비율(4:1 = 80:20)에 근접한 결과가 출력된다. 실제 결과는 kube-proxy의 라운드로빈 특성상 약간의 편차가 있을 수 있다.

**Step 4: Canary 비율 조정**

```bash
# canary를 50%로 높이려면 stable과 동일한 replica 수로 설정
kubectl scale deployment httpbin-canary --replicas=4 -n demo

# 확인
kubectl get deployment -n demo -l app=httpbin
```

```text
NAME             READY   UP-TO-DATE   AVAILABLE   AGE
httpbin-stable   4/4     4            4           3m
httpbin-canary   4/4     4            4           2m
```

**Step 5: Canary 롤백 (문제 발견 시)**

```bash
# canary 배포 제거
kubectl delete deployment httpbin-canary -n demo

# stable만 남아 있는지 확인
kubectl get endpoints httpbin-svc -n demo
```

```text
NAME          ENDPOINTS                                            AGE
httpbin-svc   10.244.1.10:80,10.244.1.11:80,10.244.2.8:80 + 1..   5m
```

**Step 6: 정리**

```bash
kubectl delete deployment httpbin-stable -n demo
kubectl delete svc httpbin-svc -n demo
```

**트러블슈팅:**

| 증상 | 원인 | 진단 명령어 | 해결 |
|------|------|-----------|------|
| canary Pod가 Endpoints에 포함되지 않음 | label selector 불일치 | `kubectl get pods --show-labels -n demo` | `app: httpbin` label이 Service selector와 일치하는지 확인 |
| 트래픽이 canary로 전혀 가지 않음 | canary Pod가 Ready가 아님 | `kubectl get pods -n demo -l track=canary` | Readiness Probe 확인 |
| 트래픽 비율이 예상과 다름 | iptables 확률 기반 분배의 통계적 편차 | 요청 수를 1000회 이상으로 증가 | 충분한 샘플 수로 테스트 |
| Service에 canary만 연결됨 | stable Deployment가 삭제됨 | `kubectl get deployment -n demo` | stable Deployment 복원 |

**확인 문제:**

1. 네이티브 Canary에서 정확히 10% 트래픽을 canary로 보내려면 stable과 canary의 replica 수를 각각 몇으로 설정해야 하는가?
2. Canary 배포에서 version label 대신 track label을 사용하는 이유는 무엇인가?
3. Service selector에 `version` label을 포함하면 어떤 문제가 발생하는가?

---

### Lab 2.5: Canary 비율 변경 (Istio VirtualService weight 제어)

**학습 목표:**
- Istio VirtualService의 weight 기반 트래픽 분배를 실습한다.
- DestinationRule의 subset 정의를 이해한다.
- 1% 단위의 정밀한 트래픽 제어를 경험한다.

**관련 CKAD 도메인:** Application Deployment — Traffic Management

**등장 배경:**

네이티브 Canary의 한계는 트래픽 비율이 Pod 수에 종속된다는 점이다. 5% 트래픽을 canary로 보내려면 stable 19 + canary 1 = 총 20개 Pod가 필요하여 리소스 낭비가 크다. Istio VirtualService는 Envoy sidecar 프록시 수준에서 트래픽을 분배하므로, Pod 수와 무관하게 weight 필드 하나로 정밀한 비율 제어가 가능하다.

**내부 동작 원리:**

1. DestinationRule이 `version: v1`과 `version: v2` label을 기준으로 subset을 정의한다.
2. VirtualService가 각 subset에 대한 weight를 지정한다.
3. Istiod(control plane)가 VirtualService/DestinationRule을 Envoy xDS API를 통해 sidecar에 전파한다.
4. 각 Pod의 Envoy sidecar가 weight에 따라 업스트림 클러스터를 선택한다.
5. weight 변경 시 Envoy의 RDS(Route Discovery Service)를 통해 실시간으로 반영되며, 기존 연결은 유지된다.

**Step 1: DestinationRule + VirtualService 생성**

```bash
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: networking.istio.io/v1beta1
kind: DestinationRule
metadata:
  name: httpbin-dr
spec:
  host: httpbin-svc
  subsets:
    - name: v1
      labels:
        version: v1
    - name: v2
      labels:
        version: v2
---
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: httpbin-vs
spec:
  hosts:
    - httpbin-svc
  http:
    - route:
        - destination:
            host: httpbin-svc
            subset: v1
          weight: 80
        - destination:
            host: httpbin-svc
            subset: v2
          weight: 20
EOF
```

**검증:**

```bash
kubectl get virtualservice httpbin-vs -n demo -o jsonpath='{.spec.http[0].route[*].weight}'
echo ""
```

```text
80 20
```

```bash
kubectl get destinationrule httpbin-dr -n demo -o jsonpath='{.spec.subsets[*].name}'
echo ""
```

```text
v1 v2
```

**Step 2: weight를 95:5로 변경**

```bash
kubectl patch virtualservice httpbin-vs -n demo --type=merge -p '{
  "spec": {
    "http": [{
      "route": [
        {"destination": {"host": "httpbin-svc", "subset": "v1"}, "weight": 95},
        {"destination": {"host": "httpbin-svc", "subset": "v2"}, "weight": 5}
      ]
    }]
  }
}'
```

**검증:**

```bash
kubectl get virtualservice httpbin-vs -n demo -o jsonpath='{.spec.http[0].route[*].weight}'
echo ""
```

```text
95 5
```

**Step 3: 전체 전환 (0:100)**

```bash
kubectl patch virtualservice httpbin-vs -n demo --type=merge -p '{
  "spec": {
    "http": [{
      "route": [
        {"destination": {"host": "httpbin-svc", "subset": "v1"}, "weight": 0},
        {"destination": {"host": "httpbin-svc", "subset": "v2"}, "weight": 100}
      ]
    }]
  }
}'
```

**검증:**

```bash
kubectl get virtualservice httpbin-vs -n demo -o jsonpath='{.spec.http[0].route[*].weight}'
echo ""
```

```text
0 100
```

**Step 4: 정리**

```bash
kubectl delete virtualservice httpbin-vs -n demo
kubectl delete destinationrule httpbin-dr -n demo
```

**트러블슈팅:**

| 증상 | 원인 | 진단 명령어 | 해결 |
|------|------|-----------|------|
| weight 합이 100이 아님 | VirtualService 유효성 검증 실패 | `kubectl describe vs httpbin-vs -n demo` | weight 합을 100으로 조정 |
| 트래픽이 subset으로 분배되지 않음 | Pod에 version label이 없음 | `kubectl get pods --show-labels -n demo` | Pod template에 `version` label 추가 |
| 503 에러 발생 | subset에 해당하는 Pod가 없음 | `istioctl proxy-config cluster -n demo <pod>` | subset label과 Pod label 일치 확인 |

**확인 문제:**

1. VirtualService의 weight 합이 100이 아니면 어떤 일이 발생하는가?
2. DestinationRule 없이 VirtualService만 생성하면 어떤 오류가 발생하는가?
3. Canary 배포 완료 후 v1 Deployment를 삭제하기 전에 반드시 확인해야 할 사항은 무엇인가?

---

### Lab 2.6: Helm 실습 (chart 생성, install, upgrade, rollback)

**학습 목표:**
- Helm chart의 구조를 이해한다.
- `helm install`, `helm upgrade`, `helm rollback` 명령을 실습한다.
- values.yaml 오버라이드를 통한 환경별 배포를 경험한다.

**관련 CKAD 도메인:** Application Deployment — Helm

**등장 배경:**

쿠버네티스 YAML 매니페스트를 직접 관리하면 환경별(dev/staging/prod) 설정 차이를 반영하기 어렵다. 동일한 Deployment를 각 환경마다 별도 YAML로 유지하면 중복이 발생하고, 한 곳을 수정할 때 나머지를 빠뜨리는 실수가 빈번하다. Helm은 Go template 기반의 패키지 매니저로, values.yaml을 통해 환경별 변수만 교체하면 동일한 chart에서 다른 배포를 생성할 수 있다.

**내부 동작 원리:**

1. `helm install` 시 Helm 클라이언트가 chart의 templates 디렉터리에 있는 Go template 파일들을 values.yaml과 결합하여 최종 YAML을 렌더링한다.
2. 렌더링된 YAML을 쿠버네티스 API 서버에 전송하여 리소스를 생성한다.
3. 릴리스 정보(릴리스 이름, 리비전, 생성된 리소스 목록, values)를 Secret(기본값) 또는 ConfigMap에 저장한다.
4. `helm upgrade` 시 이전 릴리스의 values와 새 values를 3-way merge하여 변경된 리소스만 업데이트한다.
5. `helm rollback` 시 지정된 리비전의 values로 다시 렌더링하여 적용한다.

**Step 1: chart 생성**

```bash
cd /tmp && helm create myapp-chart
```

**검증:**

```bash
ls /tmp/myapp-chart/
```

```text
Chart.yaml  charts  templates  values.yaml
```

```bash
ls /tmp/myapp-chart/templates/
```

```text
NOTES.txt  _helpers.tpl  deployment.yaml  hpa.yaml  ingress.yaml  service.yaml  serviceaccount.yaml  tests
```

**Step 2: chart 설치**

```bash
helm install myapp /tmp/myapp-chart -n demo --set replicaCount=2 --set image.tag=1.25
```

**검증:**

```bash
helm list -n demo
```

```text
NAME    NAMESPACE  REVISION  UPDATED                   STATUS    CHART            APP VERSION
myapp   demo       1         2024-01-01 00:00:00 ...   deployed  myapp-chart-0.1.0  1.16.0
```

```bash
kubectl get deployment -n demo -l app.kubernetes.io/instance=myapp
```

```text
NAME            READY   UP-TO-DATE   AVAILABLE   AGE
myapp-myapp-chart   2/2     2            2           30s
```

**Step 3: upgrade**

```bash
helm upgrade myapp /tmp/myapp-chart -n demo --set replicaCount=3 --set image.tag=1.26
```

**검증:**

```bash
helm history myapp -n demo
```

```text
REVISION  UPDATED                   STATUS      CHART             APP VERSION  DESCRIPTION
1         2024-01-01 00:00:00 ...   superseded  myapp-chart-0.1.0  1.16.0      Install complete
2         2024-01-01 00:01:00 ...   deployed    myapp-chart-0.1.0  1.16.0      Upgrade complete
```

**Step 4: rollback**

```bash
helm rollback myapp 1 -n demo
```

**검증:**

```bash
helm history myapp -n demo
```

```text
REVISION  UPDATED                   STATUS      CHART             APP VERSION  DESCRIPTION
1         2024-01-01 00:00:00 ...   superseded  myapp-chart-0.1.0  1.16.0      Install complete
2         2024-01-01 00:01:00 ...   superseded  myapp-chart-0.1.0  1.16.0      Upgrade complete
3         2024-01-01 00:02:00 ...   deployed    myapp-chart-0.1.0  1.16.0      Rollback to 1
```

**Step 5: 정리**

```bash
helm uninstall myapp -n demo
rm -rf /tmp/myapp-chart
```

**트러블슈팅:**

| 증상 | 원인 | 진단 명령어 | 해결 |
|------|------|-----------|------|
| `helm install` 실패, "cannot re-use a name" | 동일 이름의 릴리스 존재 | `helm list -n demo -a` | `helm uninstall` 후 재시도 또는 다른 이름 사용 |
| upgrade 후 Pod가 이전 설정 유지 | values가 병합되지 않음 | `helm get values myapp -n demo` | `--reset-values` 플래그 사용 |
| rollback 실패 | 해당 리비전이 존재하지 않음 | `helm history myapp -n demo` | 유효한 리비전 번호 지정 |

**확인 문제:**

1. `helm upgrade --install`과 `helm install`의 차이점은 무엇인가?
2. Helm 릴리스 정보는 기본적으로 어떤 쿠버네티스 리소스에 저장되는가?
3. `helm template` 명령의 용도는 무엇인가?

---

### Lab 2.7: Kustomize 실습 (base/overlay 패턴)

**학습 목표:**
- Kustomize의 base/overlay 패턴을 이해한다.
- `kubectl apply -k`로 Kustomize 배포를 실습한다.
- 패치를 통한 환경별 설정 오버라이드를 경험한다.

**관련 CKAD 도메인:** Application Deployment — Kustomize

**등장 배경:**

Helm은 Go template 문법 학습이 필요하고, chart 구조가 복잡하다. 단순히 환경별로 일부 필드만 변경하면 되는 경우에는 과도한 도구이다. Kustomize는 template을 사용하지 않고, 원본(base) YAML 위에 패치(overlay)를 적용하는 방식이다. kubectl에 내장되어 있어 별도 도구 설치가 불필요하다.

**내부 동작 원리:**

1. base 디렉터리에 원본 YAML과 `kustomization.yaml`(resources 목록)을 배치한다.
2. overlay 디렉터리에 `kustomization.yaml`(bases 참조 + patches)을 배치한다.
3. `kubectl apply -k overlay/` 실행 시 kubectl이 base YAML을 읽고, overlay의 패치를 적용(Strategic Merge Patch 또는 JSON Patch)하여 최종 YAML을 생성한다.
4. 최종 YAML을 API 서버에 전송한다. 서버 측에서는 일반 `kubectl apply`와 동일하게 처리된다.

**Step 1: base 구조 생성**

```bash
mkdir -p /tmp/kustomize-demo/base /tmp/kustomize-demo/overlays/dev /tmp/kustomize-demo/overlays/prod

# base deployment
cat <<'EOF' > /tmp/kustomize-demo/base/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web-app
spec:
  replicas: 1
  selector:
    matchLabels:
      app: web-app
  template:
    metadata:
      labels:
        app: web-app
    spec:
      containers:
        - name: web
          image: nginx:1.25
          ports:
            - containerPort: 80
EOF

# base kustomization
cat <<'EOF' > /tmp/kustomize-demo/base/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - deployment.yaml
EOF
```

**Step 2: dev overlay 생성**

```bash
cat <<'EOF' > /tmp/kustomize-demo/overlays/dev/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - ../../base
namePrefix: dev-
namespace: demo
patches:
  - target:
      kind: Deployment
      name: web-app
    patch: |
      - op: replace
        path: /spec/replicas
        value: 2
EOF
```

**Step 3: prod overlay 생성**

```bash
cat <<'EOF' > /tmp/kustomize-demo/overlays/prod/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - ../../base
namePrefix: prod-
namespace: production
patches:
  - target:
      kind: Deployment
      name: web-app
    patch: |
      - op: replace
        path: /spec/replicas
        value: 5
EOF
```

**검증 (dry-run으로 렌더링 결과 확인):**

```bash
kubectl kustomize /tmp/kustomize-demo/overlays/dev/ | head -20
```

```text
apiVersion: apps/v1
kind: Deployment
metadata:
  name: dev-web-app
  namespace: demo
spec:
  replicas: 2
  selector:
    matchLabels:
      app: web-app
  template:
    metadata:
      labels:
        app: web-app
    spec:
      containers:
      - image: nginx:1.25
        name: web
        ports:
        - containerPort: 80
```

```bash
kubectl apply -k /tmp/kustomize-demo/overlays/dev/ --dry-run=client
```

```text
deployment.apps/dev-web-app created (dry run)
```

**Step 4: 정리**

```bash
rm -rf /tmp/kustomize-demo
```

**트러블슈팅:**

| 증상 | 원인 | 진단 명령어 | 해결 |
|------|------|-----------|------|
| "resource not found" 오류 | kustomization.yaml의 resources 경로가 잘못됨 | 상대 경로 확인 | `../../base` 형태의 올바른 상대 경로 지정 |
| patch 적용 안 됨 | target name이 base의 metadata.name과 불일치 | `kubectl kustomize` 출력 확인 | namePrefix가 적용되기 전의 이름을 target에 사용 |
| namespace가 적용 안 됨 | kustomization.yaml에 namespace 필드 누락 | 렌더링 결과 확인 | namespace 필드 추가 |

**확인 문제:**

1. `kubectl kustomize`와 `kubectl apply -k`의 차이점은 무엇인가?
2. Kustomize에서 Strategic Merge Patch와 JSON Patch의 차이점은 무엇인가?
3. Helm과 Kustomize를 함께 사용하는 패턴은 어떤 경우에 적합한가?

---

### Lab 2.8: ArgoCD GitOps 흐름 (Application CR 분석)

**학습 목표:**
- ArgoCD Application CR의 구조를 이해한다.
- GitOps 워크플로우(Git 변경 -> 자동 동기화)를 이해한다.
- Sync 정책과 Self-Healing을 실습한다.

**관련 CKAD 도메인:** Application Deployment — GitOps

**등장 배경:**

수동 `kubectl apply`는 "누가, 언제, 어떤 변경을 적용했는지" 추적이 어렵다. 여러 환경(dev/staging/prod)에 걸친 배포 파이프라인에서 일관성을 유지하기 힘들다. GitOps는 Git 저장소를 single source of truth로 사용하여, Git에 커밋된 상태가 곧 클러스터의 desired state가 되는 패러다임이다. ArgoCD는 Git 저장소를 주기적으로 polling(기본 3분)하거나 webhook을 통해 변경을 감지하고, 클러스터 상태를 Git과 자동으로 동기화한다.

**내부 동작 원리:**

1. ArgoCD의 repo-server가 Git 저장소를 clone하고 매니페스트를 렌더링한다 (Helm/Kustomize/plain YAML).
2. application-controller가 렌더링된 desired state와 클러스터의 live state를 비교한다 (diff).
3. `syncPolicy.automated`가 설정되어 있으면 diff 발견 시 자동으로 sync를 수행한다.
4. sync는 kubectl apply와 동일하게 API 서버에 리소스를 적용한다.
5. `selfHeal: true`이면 수동으로 클러스터 리소스를 변경해도 Git 상태로 자동 복원한다.
6. `prune: true`이면 Git에서 삭제된 리소스를 클러스터에서도 자동 삭제한다.

**ArgoCD Application CR 분석:**

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: demo-app
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/example/k8s-manifests.git
    targetRevision: HEAD
    path: overlays/dev            # Kustomize overlay 경로
  destination:
    server: https://kubernetes.default.svc
    namespace: demo
  syncPolicy:
    automated:
      prune: true                 # Git에서 삭제된 리소스 자동 정리
      selfHeal: true              # 수동 변경 시 자동 복원
    syncOptions:
      - CreateNamespace=true      # 네임스페이스 자동 생성
    retry:
      limit: 5
      backoff:
        duration: 5s
        factor: 2
        maxDuration: 3m
```

**검증:**

```bash
# ArgoCD CLI로 Application 상태 확인
argocd app get demo-app
```

```text
Name:               argocd/demo-app
Project:            default
Server:             https://kubernetes.default.svc
Namespace:          demo
URL:                https://argocd.example.com/applications/demo-app
Repo:               https://github.com/example/k8s-manifests.git
Target:             HEAD
Path:               overlays/dev
SyncWindow:         Sync Allowed
Sync Policy:        Automated (Prune, Self Heal)
Sync Status:        Synced
Health Status:      Healthy
```

```bash
# Sync 히스토리 확인
argocd app history demo-app
```

```text
ID  DATE                           REVISION
0   2024-01-01 00:00:00 +0000 UTC  abc1234
1   2024-01-01 01:00:00 +0000 UTC  def5678
```

**트러블슈팅:**

| 증상 | 원인 | 진단 명령어 | 해결 |
|------|------|-----------|------|
| Sync Status: OutOfSync | Git과 클러스터 상태 불일치 | `argocd app diff demo-app` | 수동 sync 또는 automated sync 설정 |
| Health: Degraded | Pod가 CrashLoopBackOff | `argocd app resources demo-app` | 애플리케이션 문제 해결 후 Git에 수정 커밋 |
| ComparisonError | Git 접근 실패 또는 렌더링 오류 | `argocd app get demo-app --show-operation` | repo-server 로그 확인, Git 인증 설정 |
| Sync 무한 반복 | 리소스에 서버 측 기본값이 추가되어 매번 diff 발생 | `argocd app diff demo-app` | ignoreDifferences 설정 추가 |

**확인 문제:**

1. `selfHeal: true`와 `prune: true`를 동시에 사용하지 않으면 어떤 상황이 발생하는가?
2. ArgoCD의 Git polling 주기를 줄이려면 어떤 방법을 사용하는가?
3. Application CR의 `syncOptions`에서 `Replace=true`와 `ServerSideApply=true`의 차이점은 무엇인가?

---

### Lab 3.1: Probe 분석 — keycloak Deployment의 Probe 동작 확인

**학습 목표:**
- Liveness, Readiness, Startup Probe의 차이를 이해한다.
- 실제 애플리케이션(keycloak)의 Probe 설정을 분석한다.
- Probe 실패 시 kubelet의 동작을 이해한다.

**관련 CKAD 도메인:** Application Observability and Maintenance — Health Checks

**등장 배경:**

프로세스가 실행 중이지만 실제로 요청을 처리하지 못하는 상태(deadlock, 무한루프, 초기화 미완료)를 쿠버네티스가 감지할 수 없으면, 장애 Pod로 트래픽이 계속 전달된다. Liveness Probe는 컨테이너가 살아있는지, Readiness Probe는 트래픽을 받을 준비가 되었는지, Startup Probe는 초기화가 완료되었는지를 각각 판단한다.

**내부 동작 원리:**

kubelet의 Probe 실행 메커니즘:

1. kubelet은 각 컨테이너의 Probe마다 별도의 goroutine을 생성한다.
2. `periodSeconds` 간격으로 Probe를 실행한다.
3. HTTP Probe: kubelet이 직접 HTTP GET 요청을 컨테이너 IP:port로 전송한다. 200~399 응답 코드이면 성공이다.
4. TCP Probe: kubelet이 TCP 연결을 시도하고, 연결이 성공하면 즉시 닫는다.
5. Exec Probe: kubelet이 컨테이너 내에서 명령을 실행하고, exit code 0이면 성공이다.
6. `timeoutSeconds` 내에 응답이 없으면 실패로 처리한다.
7. `failureThreshold` 연속 실패 시 Liveness는 컨테이너를 재시작하고, Readiness는 Endpoint에서 제거한다.

Probe 실패 연쇄 영향:

```
Readiness Probe 실패
  -> kubelet이 Pod의 Ready condition을 False로 설정
  -> Endpoints Controller가 Service의 Endpoints에서 해당 Pod IP 제거
  -> kube-proxy가 iptables/IPVS 규칙에서 해당 Pod 삭제
  -> Service로의 트래픽이 Ready Pod로만 분배
```

**Step 1: keycloak Deployment의 Probe 확인**

```bash
kubectl get deployment keycloak -n platform -o jsonpath='{.spec.template.spec.containers[0].livenessProbe}' | jq .
```

```text
{
  "httpGet": {
    "path": "/health/live",
    "port": 8080,
    "scheme": "HTTP"
  },
  "initialDelaySeconds": 30,
  "periodSeconds": 10,
  "timeoutSeconds": 5,
  "failureThreshold": 3,
  "successThreshold": 1
}
```

```bash
kubectl get deployment keycloak -n platform -o jsonpath='{.spec.template.spec.containers[0].readinessProbe}' | jq .
```

```text
{
  "httpGet": {
    "path": "/health/ready",
    "port": 8080,
    "scheme": "HTTP"
  },
  "initialDelaySeconds": 15,
  "periodSeconds": 5,
  "timeoutSeconds": 3,
  "failureThreshold": 3,
  "successThreshold": 1
}
```

**Step 2: Probe 상태 확인**

```bash
# Pod의 현재 Probe 결과 확인
kubectl describe pod -n platform -l app=keycloak | grep -A3 "Liveness:"
```

```text
    Liveness:   http-get http://:8080/health/live delay=30s timeout=5s period=10s #success=1 #failure=3
    Readiness:  http-get http://:8080/health/ready delay=15s timeout=3s period=5s #success=1 #failure=3
```

```bash
# Probe 성공/실패 이벤트 확인
kubectl get events -n platform --field-selector reason=Unhealthy --sort-by=.metadata.creationTimestamp | tail -5
```

```text
LAST SEEN   TYPE      REASON      OBJECT              MESSAGE
2m          Warning   Unhealthy   pod/keycloak-xxx    Readiness probe failed: Get "http://10.244.1.5:8080/health/ready": dial tcp connect: connection refused
```

**Step 3: 정리 (분석만 수행했으므로 별도 정리 불필요)**

**트러블슈팅:**

| 증상 | 원인 | 진단 명령어 | 해결 |
|------|------|-----------|------|
| Pod READY 0/1이지만 Running | Readiness Probe 실패 중 | `kubectl describe pod <pod>` | Probe 경로/포트 확인, initialDelaySeconds 증가 |
| Pod 무한 재시작 (CrashLoopBackOff) | Liveness Probe 실패 | `kubectl logs <pod> --previous` | failureThreshold 증가 또는 Probe 조건 완화 |
| 느린 앱에서 시작 시 재시작 반복 | Liveness Probe가 초기화 중에 실패 | `kubectl describe pod <pod>` | Startup Probe 추가 |

**확인 문제:**

1. Startup Probe가 없을 때, 느린 앱의 초기화 중 Liveness Probe 실패를 방지하려면 어떤 필드를 조정해야 하는가?
2. Readiness Probe 실패 시 Pod의 STATUS는 무엇으로 표시되는가?
3. `successThreshold`이 1보다 큰 경우는 어떤 상황에서 유용한가?

---

### Lab 3.2: Liveness Probe 추가 실습

**학습 목표:**
- Liveness Probe를 직접 설정하고, 실패 시 자동 재시작을 관찰한다.

**관련 CKAD 도메인:** Application Observability and Maintenance — Liveness Probes

**등장 배경:**

애플리케이션이 deadlock에 빠지거나 무한루프에 진입하면 프로세스는 살아있지만 요청을 처리하지 못한다. 컨테이너 레벨 재시작만으로는 이 상태를 복구할 수 없다. Liveness Probe는 kubelet이 컨테이너의 건강 상태를 주기적으로 확인하여, 비정상 시 컨테이너를 자동 재시작하는 메커니즘이다.

**Step 1: 의도적으로 실패하는 Liveness Probe Pod 생성**

```bash
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: v1
kind: Pod
metadata:
  name: liveness-test
spec:
  containers:
    - name: app
      image: busybox:1.36
      command: ["sh", "-c", "touch /tmp/healthy; sleep 30; rm /tmp/healthy; sleep 600"]
      livenessProbe:
        exec:
          command: ["cat", "/tmp/healthy"]
        initialDelaySeconds: 5
        periodSeconds: 5
        failureThreshold: 3
EOF
```

**Step 2: 재시작 관찰**

```bash
# 30초 후 Liveness Probe 실패 → 약 45초 후 재시작 발생
kubectl get pod liveness-test -n demo -w
```

```text
NAME            READY   STATUS    RESTARTS   AGE
liveness-test   1/1     Running   0          10s
liveness-test   1/1     Running   1 (0s ago)   50s
liveness-test   1/1     Running   2 (0s ago)   1m40s
```

```bash
kubectl describe pod liveness-test -n demo | grep -A5 "Liveness:"
```

```text
    Liveness:       exec [cat /tmp/healthy] delay=5s timeout=1s period=5s #success=1 #failure=3
    ...
  Warning  Unhealthy  10s (x3 over 20s)  kubelet  Liveness probe failed: cat: can't open '/tmp/healthy': No such file or directory
  Normal   Killing    10s                 kubelet  Container app failed liveness probe, will be restarted
```

**Step 3: 정리**

```bash
kubectl delete pod liveness-test -n demo
```

**확인 문제:**

1. Liveness Probe의 failureThreshold=3, periodSeconds=5일 때, Probe 실패 후 컨테이너가 재시작되기까지 최소 몇 초가 걸리는가?
2. Liveness Probe가 컨테이너 재시작을 유발할 때, Pod의 restartPolicy는 어떤 역할을 하는가?

---

### Lab 3.3: Readiness Probe 추가 실습

**학습 목표:**
- Readiness Probe를 설정하고, 실패 시 Service Endpoint에서 제거되는 것을 관찰한다.

**관련 CKAD 도메인:** Application Observability and Maintenance — Readiness Probes

**등장 배경:**

컨테이너가 시작되었지만 아직 데이터를 로딩하거나, 외부 의존성(DB, 캐시)에 연결하는 중이면 요청을 정상 처리할 수 없다. Readiness Probe가 없으면 컨테이너가 Running 상태가 되자마자 Service Endpoint에 추가되어, 준비되지 않은 Pod로 트래픽이 전달된다.

**Step 1: Readiness Probe가 있는 Pod + Service 생성**

```bash
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: readiness-demo
spec:
  replicas: 2
  selector:
    matchLabels:
      app: readiness-demo
  template:
    metadata:
      labels:
        app: readiness-demo
    spec:
      containers:
        - name: nginx
          image: nginx:1.25-alpine
          ports:
            - containerPort: 80
          readinessProbe:
            httpGet:
              path: /
              port: 80
            initialDelaySeconds: 5
            periodSeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: readiness-svc
spec:
  selector:
    app: readiness-demo
  ports:
    - port: 80
      targetPort: 80
EOF
```

**검증:**

```bash
# Endpoints에 2개 Pod IP가 포함되는지 확인
kubectl get endpoints readiness-svc -n demo
```

```text
NAME            ENDPOINTS                       AGE
readiness-svc   10.244.1.10:80,10.244.2.8:80   30s
```

**Step 2: 한 Pod의 Readiness를 의도적으로 실패시킴**

```bash
# nginx의 기본 페이지를 삭제하여 Readiness Probe 실패 유도
READY_POD=$(kubectl get pods -n demo -l app=readiness-demo -o jsonpath='{.items[0].metadata.name}')
kubectl exec $READY_POD -n demo -- rm /usr/share/nginx/html/index.html
```

**검증:**

```bash
# 잠시 후 Endpoint에서 제거됨
kubectl get endpoints readiness-svc -n demo
```

```text
NAME            ENDPOINTS        AGE
readiness-svc   10.244.2.8:80   60s
```

하나의 Pod IP가 제거되어 트래픽이 정상 Pod로만 분배된다.

**Step 3: 정리**

```bash
kubectl delete deployment readiness-demo -n demo
kubectl delete svc readiness-svc -n demo
```

**확인 문제:**

1. Readiness Probe 실패 시 Pod는 재시작되는가?
2. Readiness Probe 실패 시 Pod의 STATUS 컬럼에는 무엇이 표시되는가?

---

### Lab 3.4: Startup Probe 추가 실습

**학습 목표:**
- Startup Probe가 초기화 시간이 긴 애플리케이션을 보호하는 방식을 이해한다.

**관련 CKAD 도메인:** Application Observability and Maintenance — Startup Probes

**등장 배경:**

Java 기반 애플리케이션(Spring Boot, Keycloak 등)은 초기화에 30초~수 분이 걸릴 수 있다. Liveness Probe의 initialDelaySeconds를 크게 설정하면 초기화 보호는 되지만, 정상 운영 중 장애 감지가 늦어진다. Startup Probe는 이 딜레마를 해결한다: Startup Probe가 성공할 때까지 Liveness/Readiness Probe를 비활성화하고, 성공 후에는 짧은 주기의 Liveness Probe가 동작한다.

**Step 1: Startup Probe가 있는 Pod 생성**

```bash
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: v1
kind: Pod
metadata:
  name: startup-demo
spec:
  containers:
    - name: slow-app
      image: busybox:1.36
      command: ["sh", "-c", "sleep 20 && touch /tmp/started && sleep 600"]
      startupProbe:
        exec:
          command: ["cat", "/tmp/started"]
        initialDelaySeconds: 0
        periodSeconds: 5
        failureThreshold: 12      # 최대 60초까지 대기 (5 * 12)
      livenessProbe:
        exec:
          command: ["cat", "/tmp/started"]
        periodSeconds: 5
        failureThreshold: 1
EOF
```

**검증:**

```bash
# 초기 20초간: startup probe 실패 중이므로 liveness probe는 동작하지 않음
kubectl describe pod startup-demo -n demo | grep -A2 "Conditions:"
```

```text
Conditions:
  Type              Status
  Initialized       True
  Ready             False
  ContainersReady   False
```

```bash
# 20초 후: startup probe 성공, liveness probe 활성화
kubectl get pod startup-demo -n demo
```

```text
NAME           READY   STATUS    RESTARTS   AGE
startup-demo   1/1     Running   0          25s
```

**Step 2: 정리**

```bash
kubectl delete pod startup-demo -n demo
```

**확인 문제:**

1. Startup Probe의 `failureThreshold * periodSeconds`가 의미하는 값은 무엇인가?
2. Startup Probe가 한 번 성공하면 이후에도 계속 실행되는가?

---

### Lab 3.5: 로그 분석 (kubectl logs 활용)

**학습 목표:**
- `kubectl logs`의 다양한 옵션을 실습한다.
- 멀티 컨테이너 Pod에서 특정 컨테이너의 로그를 확인한다.

**관련 CKAD 도메인:** Application Observability and Maintenance — Logging

**등장 배경:**

컨테이너화된 애플리케이션은 stdout/stderr로 로그를 출력하는 것이 12-Factor App의 권장 사항이다. 컨테이너 런타임(containerd)이 이 출력을 파일로 저장하고(`/var/log/containers/`), kubelet API를 통해 `kubectl logs`가 이를 읽는다. 로그 파일은 기본적으로 10MB에서 로테이션되며, 최대 5개 파일이 유지된다.

**Step 1: 다양한 로그 조회 명령**

```bash
# 최근 20줄
kubectl logs <pod-name> -n demo --tail=20

# 최근 5분 이내 로그
kubectl logs <pod-name> -n demo --since=5m

# 이전 컨테이너(재시작 전) 로그
kubectl logs <pod-name> -n demo --previous

# 멀티 컨테이너 Pod에서 특정 컨테이너
kubectl logs <pod-name> -c <container-name> -n demo

# label selector로 여러 Pod 로그 스트리밍
kubectl logs -l app=myapp -n demo --all-containers --follow --max-log-requests=10
```

**검증:**

```bash
# nginx Pod의 접근 로그 확인
kubectl run log-test --image=nginx:1.25-alpine -n demo --restart=Never
kubectl exec log-test -n demo -- curl -s localhost > /dev/null
kubectl logs log-test -n demo --tail=1
```

```text
127.0.0.1 - - [01/Jan/2024:00:00:00 +0000] "GET / HTTP/1.1" 200 615 "-" "curl/8.5.0"
```

**Step 2: 정리**

```bash
kubectl delete pod log-test -n demo
```

---

### Lab 3.6: 디버깅 — kubectl exec 활용

**학습 목표:**
- `kubectl exec`로 실행 중인 컨테이너 내부를 조사한다.
- 네트워크, 파일시스템, 프로세스 상태를 확인하는 방법을 익힌다.

**관련 CKAD 도메인:** Application Observability and Maintenance — Debugging

**등장 배경:**

컨테이너 외부에서 `kubectl describe`와 `kubectl logs`로 해결되지 않는 문제가 있다. DNS 해석 실패, 파일 권한 문제, 환경변수 누락 등은 컨테이너 내부에서 직접 확인해야 한다.

**Step 1: 컨테이너 내부 진단 명령어**

```bash
# 셸 접속
kubectl exec -it <pod> -n demo -- /bin/sh

# 환경변수 확인
kubectl exec <pod> -n demo -- env | sort

# DNS 해석 확인
kubectl exec <pod> -n demo -- nslookup kubernetes.default.svc.cluster.local

# 네트워크 연결 확인
kubectl exec <pod> -n demo -- wget -qO- --timeout=3 http://myservice:80

# 파일시스템 확인
kubectl exec <pod> -n demo -- ls -la /config/

# 프로세스 목록
kubectl exec <pod> -n demo -- ps aux
```

**검증:**

```bash
kubectl run exec-test --image=busybox:1.36 -n demo --restart=Never -- sleep 3600
kubectl exec exec-test -n demo -- nslookup kubernetes.default
```

```text
Server:    10.96.0.10
Address:   10.96.0.10:53

Name:      kubernetes.default.svc.cluster.local
Address:   10.96.0.1
```

**Step 2: 정리**

```bash
kubectl delete pod exec-test -n demo
```

---

### Lab 3.7: 디버깅 — Ephemeral Container 활용

**학습 목표:**
- `kubectl debug`로 ephemeral container를 추가하여 디버깅한다.
- distroless 이미지 등 셸이 없는 컨테이너를 디버깅하는 방법을 이해한다.

**관련 CKAD 도메인:** Application Observability and Maintenance — Ephemeral Containers

**등장 배경:**

프로덕션 컨테이너는 보안과 이미지 크기 최소화를 위해 distroless 또는 scratch 기반으로 빌드되어 셸(sh/bash)이 없는 경우가 많다. `kubectl exec`가 불가능하므로 디버깅이 어렵다. Ephemeral Container는 실행 중인 Pod에 디버깅용 컨테이너를 임시로 주입하는 기능이다. Pod를 재시작하지 않고 진단 도구가 포함된 이미지를 추가할 수 있다.

**제약 사항:**

- Ephemeral Container에는 Probe를 설정할 수 없다.
- 포트를 추가할 수 없다.
- Ephemeral Container는 한 번 추가하면 제거할 수 없다 (Pod 삭제 시에만 제거).
- Resource limits을 설정할 수 없다.
- `kubectl debug`로만 추가 가능하다 (YAML로 직접 추가 불가).

**Step 1: Ephemeral Container로 디버깅**

```bash
# 디버깅 대상 Pod 생성 (distroless 이미지 시뮬레이션)
kubectl run debug-target --image=nginx:1.25-alpine -n demo --restart=Never

# Ephemeral Container 추가
kubectl debug -it debug-target -n demo --image=busybox:1.36 --target=debug-target -- sh
```

ephemeral container는 `--target` 컨테이너와 프로세스 네임스페이스를 공유하므로, 대상 컨테이너의 프로세스를 `ps` 명령으로 확인할 수 있다.

**검증:**

```bash
# Ephemeral Container가 추가되었는지 확인
kubectl get pod debug-target -n demo -o jsonpath='{.spec.ephemeralContainers[0].name}'
echo ""
```

```text
debugger-xxxxx
```

**Step 2: 정리**

```bash
kubectl delete pod debug-target -n demo
```

---

### Lab 3.8: 리소스 모니터링 (kubectl top, metrics-server)

**학습 목표:**
- `kubectl top`으로 Pod/Node의 리소스 사용량을 확인한다.
- metrics-server의 동작 원리를 이해한다.

**관련 CKAD 도메인:** Application Observability and Maintenance — Monitoring

**등장 배경:**

컨테이너의 리소스 사용량을 확인하지 않으면 OOMKill이나 CPU 스로틀링의 원인을 파악하기 어렵다. metrics-server는 각 노드의 kubelet이 제공하는 `/metrics/resource` API에서 CPU/메모리 사용량을 수집하여 Metrics API(`metrics.k8s.io`)로 노출한다. `kubectl top`과 HPA는 이 API를 사용한다.

**내부 동작 원리:**

```
kubelet (각 노드)
  └─ cAdvisor (컨테이너 메트릭 수집)
       └─ /metrics/resource API 노출
            └─ metrics-server (클러스터 수준 집계)
                 └─ Metrics API (metrics.k8s.io)
                      ├─ kubectl top pod
                      └─ HPA controller
```

metrics-server는 기본적으로 60초 간격으로 kubelet에서 메트릭을 수집한다. `kubectl top`이 보여주는 값은 최근 수집 시점의 순간 사용량이다.

**Step 1: 리소스 사용량 확인**

```bash
# Pod별 CPU/메모리 사용량
kubectl top pod -n demo
```

```text
NAME                     CPU(cores)   MEMORY(bytes)
order-service-xxx-aaa    3m           25Mi
order-service-xxx-bbb    2m           24Mi
```

```bash
# Node별 리소스 사용량
kubectl top node
```

```text
NAME      CPU(cores)   CPU%   MEMORY(bytes)   MEMORY%
worker1   120m         6%     1200Mi          31%
worker2   95m          4%     980Mi           25%
```

```bash
# 특정 Pod의 컨테이너별 사용량
kubectl top pod <pod-name> -n demo --containers
```

```text
POD             NAME       CPU(cores)   MEMORY(bytes)
my-pod          app        5m           30Mi
my-pod          sidecar    1m           10Mi
```

**트러블슈팅:**

| 증상 | 원인 | 진단 명령어 | 해결 |
|------|------|-----------|------|
| "Metrics API not available" | metrics-server 미설치 | `kubectl get apiservice v1beta1.metrics.k8s.io` | metrics-server 설치 |
| 값이 0으로 표시 | Pod가 방금 생성되어 메트릭 미수집 | 60초 대기 후 재시도 | metrics-server 수집 주기(60초) 대기 |

**확인 문제:**

1. `kubectl top pod`의 CPU 단위 `m`은 무엇을 의미하는가?
2. metrics-server가 없으면 HPA는 동작하는가?

---

### Lab 4.1: ConfigMap 생성

**학습 목표:**
- ConfigMap의 다양한 생성 방법을 실습한다.
- ConfigMap이 etcd에 저장되는 구조를 이해한다.

**관련 CKAD 도메인:** Application Environment, Configuration and Security — ConfigMaps

**등장 배경:**

초기 쿠버네티스에서는 설정값을 Pod spec에 직접 하드코딩하거나, 환경변수로 전달하였다. 설정을 변경하려면 Pod spec을 수정하고 재배포해야 하였다. ConfigMap은 설정 데이터를 별도의 쿠버네티스 리소스로 분리하여, 동일한 컨테이너 이미지를 다른 설정으로 실행할 수 있게 한다.

**내부 동작 원리:**

ConfigMap은 etcd에 평문(plain text)으로 저장된다. Pod가 ConfigMap을 참조하면:
- `envFrom`/`env.valueFrom`: kubelet이 Pod 생성 시 ConfigMap 데이터를 읽어 컨테이너 환경변수로 주입한다. Pod 생성 후 ConfigMap이 변경되어도 환경변수는 갱신되지 않는다 (Pod 재시작 필요).
- `volumeMount`: kubelet이 ConfigMap 데이터를 tmpfs 볼륨에 파일로 마운트한다. ConfigMap이 변경되면 kubelet이 주기적으로(기본 60초) 파일을 갱신한다. 단, 하위 경로(subPath) 마운트는 자동 갱신되지 않는다.

**Step 1: 다양한 방법으로 ConfigMap 생성**

```bash
# literal 방식
kubectl create configmap app-config \
  --from-literal=APP_ENV=production \
  --from-literal=LOG_LEVEL=info \
  -n demo

# 파일 방식
echo "server.port=8080" > /tmp/app.properties
kubectl create configmap file-config --from-file=/tmp/app.properties -n demo

# 디렉터리 방식
mkdir -p /tmp/configs
echo "key1=value1" > /tmp/configs/config1.txt
echo "key2=value2" > /tmp/configs/config2.txt
kubectl create configmap dir-config --from-file=/tmp/configs/ -n demo
```

**검증:**

```bash
kubectl get configmap app-config -n demo -o yaml | grep -A5 "data:"
```

```text
data:
  APP_ENV: production
  LOG_LEVEL: info
```

```bash
kubectl get configmap file-config -n demo -o jsonpath='{.data.app\.properties}'
```

```text
server.port=8080
```

**Step 2: 정리**

```bash
kubectl delete configmap app-config file-config dir-config -n demo
rm -rf /tmp/app.properties /tmp/configs
```

---

### Lab 4.2: ConfigMap을 env로 주입

**학습 목표:**
- `envFrom`과 `env.valueFrom.configMapKeyRef`의 차이를 이해한다.

**관련 CKAD 도메인:** Application Environment, Configuration and Security — ConfigMap as Env

**Step 1: ConfigMap을 환경변수로 주입하는 Pod 생성**

```bash
kubectl create configmap demo-config --from-literal=DB_HOST=mysql --from-literal=DB_PORT=3306 -n demo

cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: v1
kind: Pod
metadata:
  name: env-demo
spec:
  containers:
    - name: app
      image: busybox:1.36
      command: ["sh", "-c", "env | sort && sleep 3600"]
      envFrom:                    # 모든 키를 환경변수로 주입
        - configMapRef:
            name: demo-config
      env:                        # 특정 키만 다른 이름으로 주입
        - name: DATABASE_HOST
          valueFrom:
            configMapKeyRef:
              name: demo-config
              key: DB_HOST
EOF
```

**검증:**

```bash
kubectl exec env-demo -n demo -- env | grep -E "DB_|DATABASE_"
```

```text
DATABASE_HOST=mysql
DB_HOST=mysql
DB_PORT=3306
```

**Step 2: 정리**

```bash
kubectl delete pod env-demo -n demo
kubectl delete configmap demo-config -n demo
```

---

### Lab 4.3: ConfigMap을 volume으로 마운트

**학습 목표:**
- ConfigMap을 파일로 마운트하는 방법을 실습한다.
- 자동 갱신 동작을 확인한다.

**관련 CKAD 도메인:** Application Environment, Configuration and Security — ConfigMap as Volume

**Step 1: ConfigMap을 볼륨으로 마운트하는 Pod 생성**

```bash
kubectl create configmap nginx-config --from-literal=nginx.conf="server { listen 80; }" -n demo

cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: v1
kind: Pod
metadata:
  name: vol-demo
spec:
  containers:
    - name: nginx
      image: nginx:1.25-alpine
      volumeMounts:
        - name: config-vol
          mountPath: /etc/nginx/conf.d
  volumes:
    - name: config-vol
      configMap:
        name: nginx-config
EOF
```

**검증:**

```bash
kubectl exec vol-demo -n demo -- cat /etc/nginx/conf.d/nginx.conf
```

```text
server { listen 80; }
```

**Step 2: ConfigMap 변경 후 자동 갱신 확인**

```bash
kubectl patch configmap nginx-config -n demo -p '{"data":{"nginx.conf":"server { listen 8080; }"}}'

# 약 60초 후 파일이 갱신됨
kubectl exec vol-demo -n demo -- cat /etc/nginx/conf.d/nginx.conf
```

```text
server { listen 8080; }
```

**Step 3: 정리**

```bash
kubectl delete pod vol-demo -n demo
kubectl delete configmap nginx-config -n demo
```

---

### Lab 4.4: Secret 생성

**학습 목표:**
- Secret의 생성 방법과 base64 인코딩을 이해한다.

**관련 CKAD 도메인:** Application Environment, Configuration and Security — Secrets

**등장 배경:**

ConfigMap에 패스워드나 API 키를 저장하면 `kubectl get configmap -o yaml`로 누구나 평문을 확인할 수 있다. Secret은 base64 인코딩으로 저장하여 실수로 노출되는 것을 방지한다. 단, base64는 암호화가 아니므로 RBAC로 접근을 제한하고, EncryptionConfiguration으로 etcd at-rest 암호화를 설정해야 진정한 보안이 확보된다.

**Step 1: Secret 생성**

```bash
# generic Secret (Opaque)
kubectl create secret generic db-secret \
  --from-literal=username=admin \
  --from-literal=password=S3cret! \
  -n demo

# TLS Secret
kubectl create secret tls tls-secret \
  --cert=/path/to/tls.crt \
  --key=/path/to/tls.key \
  -n demo 2>/dev/null || echo "TLS 파일이 없으면 건너뜀"

# Docker registry Secret
kubectl create secret docker-registry reg-secret \
  --docker-server=registry.example.com \
  --docker-username=user \
  --docker-password=pass \
  -n demo
```

**검증:**

```bash
# base64 인코딩 확인
kubectl get secret db-secret -n demo -o jsonpath='{.data.password}' | base64 -d
```

```text
S3cret!
```

```bash
kubectl get secret db-secret -n demo -o jsonpath='{.type}'
```

```text
Opaque
```

**Step 2: 정리**

```bash
kubectl delete secret db-secret reg-secret -n demo
```

---

### Lab 4.5: Secret을 Pod에 마운트

**학습 목표:**
- Secret을 환경변수와 볼륨으로 Pod에 주입하는 방법을 실습한다.

**관련 CKAD 도메인:** Application Environment, Configuration and Security — Secret Consumption

**Step 1: Secret을 환경변수와 볼륨으로 마운트**

```bash
kubectl create secret generic app-secret --from-literal=API_KEY=my-secret-key -n demo

cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: v1
kind: Pod
metadata:
  name: secret-demo
spec:
  containers:
    - name: app
      image: busybox:1.36
      command: ["sh", "-c", "echo $API_KEY && cat /secrets/API_KEY && sleep 3600"]
      env:
        - name: API_KEY
          valueFrom:
            secretKeyRef:
              name: app-secret
              key: API_KEY
      volumeMounts:
        - name: secret-vol
          mountPath: /secrets
          readOnly: true
  volumes:
    - name: secret-vol
      secret:
        secretName: app-secret
EOF
```

**검증:**

```bash
kubectl logs secret-demo -n demo | head -2
```

```text
my-secret-key
my-secret-key
```

```bash
# 볼륨 마운트 시 파일 권한 확인 (기본 0644)
kubectl exec secret-demo -n demo -- ls -la /secrets/
```

```text
total 0
drwxrwxrwt    3 root     root           100 Jan  1 00:00 .
drwxr-xr-x    1 root     root          4096 Jan  1 00:00 ..
lrwxrwxrwx    1 root     root            14 Jan  1 00:00 API_KEY -> ..data/API_KEY
```

**Step 2: 정리**

```bash
kubectl delete pod secret-demo -n demo
kubectl delete secret app-secret -n demo
```

---

### Lab 4.6: SecurityContext 분석

**학습 목표:**
- SecurityContext의 Pod 레벨과 컨테이너 레벨 설정을 이해한다.
- runAsUser, runAsNonRoot, readOnlyRootFilesystem의 효과를 확인한다.

**관련 CKAD 도메인:** Application Environment, Configuration and Security — SecurityContext

**등장 배경:**

컨테이너는 기본적으로 root(UID 0)로 실행된다. 컨테이너 탈출(container escape) 취약점이 발견되면, root 권한으로 호스트에 접근할 수 있어 심각한 보안 위험이 된다. SecurityContext는 컨테이너의 Linux 보안 설정을 제어하여, 최소 권한 원칙(principle of least privilege)을 적용한다.

**내부 동작 원리:**

SecurityContext는 kubelet이 컨테이너 런타임(containerd)에 전달하는 OCI runtime spec에 반영된다:
- `runAsUser`: OCI spec의 `process.user.uid`에 매핑된다.
- `readOnlyRootFilesystem`: OCI spec의 `root.readonly`에 매핑된다.
- `capabilities`: Linux kernel의 capability 시스템을 제어한다.
- `seccompProfile`: seccomp 필터를 적용하여 허용되는 시스템 콜을 제한한다.

**Step 1: SecurityContext가 적용된 Pod 생성**

```bash
cat <<'EOF' | kubectl apply -n demo -f -
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
      image: busybox:1.36
      command: ["sh", "-c", "id && ls -la /data && sleep 3600"]
      securityContext:
        readOnlyRootFilesystem: true
        allowPrivilegeEscalation: false
        capabilities:
          drop:
            - ALL
      volumeMounts:
        - name: data
          mountPath: /data
  volumes:
    - name: data
      emptyDir: {}
EOF
```

**검증:**

```bash
kubectl logs secure-pod -n demo | head -3
```

```text
uid=1000 gid=3000 groups=2000
total 0
drwxrwsrwx    2 root     2000             6 Jan  1 00:00 .
```

```bash
# root filesystem에 쓰기 시도 (실패해야 함)
kubectl exec secure-pod -n demo -- touch /tmp/test 2>&1
```

```text
touch: /tmp/test: Read-only file system
```

**Step 2: 정리**

```bash
kubectl delete pod secure-pod -n demo
```

---

### Lab 4.7: SecurityContext 실습 — runAsUser, readOnly

**학습 목표:**
- runAsNonRoot 강제와 readOnlyRootFilesystem 설정을 실습한다.

**관련 CKAD 도메인:** Application Environment, Configuration and Security — runAsUser, readOnly

**Step 1: runAsNonRoot 위반 시 동작 확인**

```bash
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: v1
kind: Pod
metadata:
  name: nonroot-fail
spec:
  securityContext:
    runAsNonRoot: true
  containers:
    - name: app
      image: nginx:1.25       # nginx 기본 이미지는 root로 실행
      ports:
        - containerPort: 80
EOF
```

**검증:**

```bash
kubectl get pod nonroot-fail -n demo
```

```text
NAME           READY   STATUS                       RESTARTS   AGE
nonroot-fail   0/1     CreateContainerConfigError    0          5s
```

```bash
kubectl describe pod nonroot-fail -n demo | grep "Error"
```

```text
Error: container has runAsNonRoot and image will run as root
```

**Step 2: 정리**

```bash
kubectl delete pod nonroot-fail -n demo
```

---

### Lab 4.8: capabilities 실습

**학습 목표:**
- Linux capabilities의 추가/제거를 실습한다.

**관련 CKAD 도메인:** Application Environment, Configuration and Security — Capabilities

**등장 배경:**

전통적인 Unix 보안 모델에서 root는 모든 권한을 가진다. Linux capabilities는 root 권한을 세분화하여, 컨테이너에 필요한 최소한의 권한만 부여할 수 있게 한다. 예를 들어 `NET_BIND_SERVICE`만 있으면 1024 미만 포트에 바인딩할 수 있고, `SYS_TIME`이 있으면 시스템 시간을 변경할 수 있다.

**Step 1: capabilities 테스트**

```bash
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: v1
kind: Pod
metadata:
  name: cap-demo
spec:
  containers:
    - name: app
      image: busybox:1.36
      command: ["sh", "-c", "sleep 3600"]
      securityContext:
        capabilities:
          drop:
            - ALL
          add:
            - NET_BIND_SERVICE
EOF
```

**검증:**

```bash
# /proc/1/status에서 실제 capabilities 확인
kubectl exec cap-demo -n demo -- cat /proc/1/status | grep -i cap
```

```text
CapInh: 0000000000000400
CapPrm: 0000000000000400
CapEff: 0000000000000400
CapBnd: 0000000000000400
CapAmb: 0000000000000400
```

0x400 = bit 10 = NET_BIND_SERVICE만 활성화되어 있다.

**Step 2: 정리**

```bash
kubectl delete pod cap-demo -n demo
```

---

### Lab 4.9: ServiceAccount 생성

**학습 목표:**
- ServiceAccount를 생성하고 Pod에 할당한다.
- 자동 마운트되는 토큰의 구조를 이해한다.

**관련 CKAD 도메인:** Application Environment, Configuration and Security — ServiceAccounts

**등장 배경:**

Pod가 쿠버네티스 API에 접근하려면 인증이 필요하다. ServiceAccount는 Pod에 API 접근 자격 증명(토큰)을 제공하는 메커니즘이다. 쿠버네티스 1.24부터 Secret 기반 영구 토큰 대신, TokenRequest API를 통한 시간 제한(1시간) 토큰이 기본값이 되었다. 이 변경은 유출된 토큰의 무기한 사용을 방지하기 위함이다.

**Step 1: ServiceAccount 생성 및 Pod에 할당**

```bash
kubectl create serviceaccount app-sa -n demo

cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: v1
kind: Pod
metadata:
  name: sa-demo
spec:
  serviceAccountName: app-sa
  containers:
    - name: app
      image: busybox:1.36
      command: ["sh", "-c", "sleep 3600"]
EOF
```

**검증:**

```bash
kubectl get pod sa-demo -n demo -o jsonpath='{.spec.serviceAccountName}'
echo ""
```

```text
app-sa
```

```bash
# 마운트된 토큰 확인
kubectl exec sa-demo -n demo -- cat /var/run/secrets/kubernetes.io/serviceaccount/token | head -c 50
echo "..."
```

```text
eyJhbGciOiJSUzI1NiIsImtpZCI6Ij...
```

```bash
# 토큰으로 API 접근 테스트 (RBAC 설정 없으면 403)
kubectl exec sa-demo -n demo -- wget -qO- --header="Authorization: Bearer $(cat /var/run/secrets/kubernetes.io/serviceaccount/token)" https://kubernetes.default.svc/api/v1/namespaces --no-check-certificate 2>&1 | head -3
```

```text
{
  "kind": "Status",
  "apiVersion": "v1",
```

**Step 2: 자동 마운트 비활성화**

```bash
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: v1
kind: Pod
metadata:
  name: sa-no-mount
spec:
  serviceAccountName: app-sa
  automountServiceAccountToken: false
  containers:
    - name: app
      image: busybox:1.36
      command: ["sh", "-c", "sleep 3600"]
EOF
```

**검증:**

```bash
kubectl exec sa-no-mount -n demo -- ls /var/run/secrets/kubernetes.io/serviceaccount/ 2>&1
```

```text
ls: /var/run/secrets/kubernetes.io/serviceaccount/: No such file or directory
```

**Step 3: 정리**

```bash
kubectl delete pod sa-demo sa-no-mount -n demo
kubectl delete serviceaccount app-sa -n demo
```

---

### Lab 4.10: Resource/QoS 확인

**학습 목표:**
- Resource requests/limits 설정에 따른 QoS 클래스를 확인한다.

**관련 CKAD 도메인:** Application Environment, Configuration and Security — Resource Management

**등장 배경:**

쿠버네티스는 노드의 리소스가 부족하면 Pod를 퇴출(eviction)한다. QoS 클래스는 eviction 우선 순위를 결정한다. OOM 발생 시 BestEffort -> Burstable -> Guaranteed 순서로 종료된다.

**내부 동작 원리:**

| QoS 클래스 | 조건 | OOM Score Adjust |
|-----------|------|-----------------|
| Guaranteed | 모든 컨테이너에 requests = limits (CPU, Memory 모두) | -997 (가장 낮음, 마지막에 종료) |
| Burstable | requests와 limits가 설정되었지만 같지 않음 | 2~999 (사용량에 비례) |
| BestEffort | requests/limits가 모두 미설정 | 1000 (가장 먼저 종료) |

**Step 1: 세 가지 QoS 클래스 Pod 생성**

```bash
# Guaranteed
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: v1
kind: Pod
metadata:
  name: qos-guaranteed
spec:
  containers:
    - name: app
      image: busybox:1.36
      command: ["sleep", "3600"]
      resources:
        requests:
          cpu: 100m
          memory: 128Mi
        limits:
          cpu: 100m
          memory: 128Mi
---
apiVersion: v1
kind: Pod
metadata:
  name: qos-burstable
spec:
  containers:
    - name: app
      image: busybox:1.36
      command: ["sleep", "3600"]
      resources:
        requests:
          cpu: 50m
          memory: 64Mi
        limits:
          cpu: 200m
          memory: 256Mi
---
apiVersion: v1
kind: Pod
metadata:
  name: qos-besteffort
spec:
  containers:
    - name: app
      image: busybox:1.36
      command: ["sleep", "3600"]
EOF
```

**검증:**

```bash
kubectl get pod qos-guaranteed -n demo -o jsonpath='{.status.qosClass}'
echo ""
kubectl get pod qos-burstable -n demo -o jsonpath='{.status.qosClass}'
echo ""
kubectl get pod qos-besteffort -n demo -o jsonpath='{.status.qosClass}'
echo ""
```

```text
Guaranteed
Burstable
BestEffort
```

**Step 2: 정리**

```bash
kubectl delete pod qos-guaranteed qos-burstable qos-besteffort -n demo
```

---

### Lab 4.11: LimitRange 생성

**학습 목표:**
- LimitRange를 설정하여 네임스페이스 내 Pod/컨테이너의 기본 리소스 값을 자동 주입한다.

**관련 CKAD 도메인:** Application Environment, Configuration and Security — LimitRange

**등장 배경:**

개발자가 리소스 requests/limits를 명시하지 않으면 BestEffort QoS가 되어 노드 리소스 부족 시 가장 먼저 퇴출된다. LimitRange는 네임스페이스 수준에서 기본값(default), 최소값(min), 최대값(max)을 강제하는 어드미션 컨트롤러이다.

**내부 동작 원리:**

LimitRanger 어드미션 컨트롤러가 Pod 생성 요청을 가로채어:
1. 컨테이너에 requests/limits가 없으면 `default`와 `defaultRequest` 값을 주입한다.
2. 지정된 값이 `min` 미만이거나 `max` 초과이면 요청을 거부한다.

**Step 1: LimitRange 생성**

```bash
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: v1
kind: LimitRange
metadata:
  name: demo-limits
spec:
  limits:
    - type: Container
      default:
        cpu: 200m
        memory: 256Mi
      defaultRequest:
        cpu: 100m
        memory: 128Mi
      min:
        cpu: 50m
        memory: 64Mi
      max:
        cpu: 1
        memory: 1Gi
EOF
```

**검증:**

```bash
kubectl describe limitrange demo-limits -n demo
```

```text
Name:       demo-limits
Namespace:  demo
Type        Resource  Min   Max  Default Request  Default Limit  ...
----        --------  ---   ---  ---------------  -------------
Container   cpu       50m   1    100m             200m
Container   memory    64Mi  1Gi  128Mi            256Mi
```

```bash
# 리소스 미지정 Pod 생성 후 기본값 주입 확인
kubectl run limitrange-test --image=busybox:1.36 -n demo --restart=Never -- sleep 3600
kubectl get pod limitrange-test -n demo -o jsonpath='{.spec.containers[0].resources}'
echo ""
```

```text
{"limits":{"cpu":"200m","memory":"256Mi"},"requests":{"cpu":"100m","memory":"128Mi"}}
```

**Step 2: 정리**

```bash
kubectl delete pod limitrange-test -n demo
kubectl delete limitrange demo-limits -n demo
```

---

### Lab 4.12: ResourceQuota 생성

**학습 목표:**
- ResourceQuota로 네임스페이스 전체 리소스 사용량을 제한한다.

**관련 CKAD 도메인:** Application Environment, Configuration and Security — ResourceQuota

**등장 배경:**

멀티 테넌트 클러스터에서 하나의 팀이 클러스터 리소스를 독점하면 다른 팀의 워크로드가 스케줄되지 못한다. ResourceQuota는 네임스페이스 단위로 CPU, 메모리, Pod 수, Service 수 등의 총량을 제한한다.

**내부 동작 원리:**

ResourceQuota 어드미션 컨트롤러가 리소스 생성 요청마다 현재 사용량을 계산하고, 할당량 초과 시 요청을 거부한다(HTTP 403 Forbidden).

**Step 1: ResourceQuota 생성**

```bash
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: v1
kind: ResourceQuota
metadata:
  name: demo-quota
spec:
  hard:
    requests.cpu: "2"
    requests.memory: 4Gi
    limits.cpu: "4"
    limits.memory: 8Gi
    pods: "10"
    services: "5"
EOF
```

**검증:**

```bash
kubectl describe resourcequota demo-quota -n demo
```

```text
Name:            demo-quota
Namespace:       demo
Resource         Used  Hard
--------         ----  ----
limits.cpu       0     4
limits.memory    0     8Gi
pods             0     10
requests.cpu     0     2
requests.memory  0     4Gi
services         0     5
```

```bash
# 할당량 초과 시 거부 확인 (Pod 11개 생성 시도)
for i in $(seq 1 11); do
  kubectl run quota-test-$i --image=busybox:1.36 -n demo --restart=Never \
    --requests='cpu=100m,memory=128Mi' --limits='cpu=200m,memory=256Mi' -- sleep 3600 2>&1 | tail -1
done
```

```text
pod/quota-test-1 created
...
pod/quota-test-10 created
Error from server (Forbidden): pods "quota-test-11" is forbidden: exceeded quota: demo-quota, requested: pods=1, used: pods=10, limited: pods=10
```

**Step 2: 정리**

```bash
kubectl delete pod -n demo -l run --all
kubectl delete resourcequota demo-quota -n demo
```

---

### Lab 5.1: ClusterIP Service

**학습 목표:**
- ClusterIP Service의 생성과 동작을 이해한다.
- kube-proxy의 iptables 규칙을 통한 트래픽 전달을 이해한다.

**관련 CKAD 도메인:** Services and Networking — ClusterIP

**등장 배경:**

Pod IP는 일시적이다. Pod가 재시작되면 새 IP가 할당된다. 다른 Pod가 특정 Pod에 접근하려면 매번 새 IP를 알아야 하는데, 이는 불가능하다. Service는 안정적인 가상 IP(ClusterIP)를 제공하여, Pod IP가 변경되어도 동일한 주소로 접근할 수 있게 한다.

**내부 동작 원리:**

1. Service가 생성되면 API 서버가 Service CIDR에서 ClusterIP를 할당한다.
2. Endpoints Controller가 Service selector에 매칭되는 Ready Pod의 IP 목록을 Endpoints 리소스에 기록한다.
3. kube-proxy가 각 노드에서 iptables 규칙(또는 IPVS 규칙)을 생성하여, ClusterIP:port로 들어오는 패킷을 Endpoints의 Pod IP 중 하나로 DNAT한다.
4. iptables 모드에서는 랜덤 확률 기반, IPVS 모드에서는 라운드로빈/최소연결 등 다양한 알고리즘을 사용한다.

**Step 1: ClusterIP Service 생성**

```bash
kubectl create deployment clusterip-demo --image=nginx:1.25-alpine --replicas=3 -n demo
kubectl expose deployment clusterip-demo --port=80 --target-port=80 --type=ClusterIP -n demo
```

**검증:**

```bash
kubectl get svc clusterip-demo -n demo
```

```text
NAME             TYPE        CLUSTER-IP     EXTERNAL-IP   PORT(S)   AGE
clusterip-demo   ClusterIP   10.96.45.123   <none>        80/TCP    10s
```

```bash
kubectl get endpoints clusterip-demo -n demo
```

```text
NAME             ENDPOINTS                                      AGE
clusterip-demo   10.244.1.10:80,10.244.1.11:80,10.244.2.8:80   10s
```

```bash
# 클러스터 내부에서 접근 확인
kubectl run curl-test --image=busybox:1.36 --rm -it --restart=Never -n demo -- wget -qO- http://clusterip-demo:80 | head -5
```

```text
<!DOCTYPE html>
<html>
<head>
<title>Welcome to nginx!</title>
</head>
```

**Step 2: 정리**

```bash
kubectl delete deployment clusterip-demo -n demo
kubectl delete svc clusterip-demo -n demo
```

---

### Lab 5.2: NodePort Service

**학습 목표:**
- NodePort Service를 통해 클러스터 외부에서 접근하는 방법을 이해한다.

**관련 CKAD 도메인:** Services and Networking — NodePort

**등장 배경:**

ClusterIP는 클러스터 내부에서만 접근 가능하다. 외부에서 애플리케이션에 접근하려면 노드의 물리적 IP와 포트를 사용해야 한다. NodePort는 모든 노드의 특정 포트(30000-32767)에서 트래픽을 받아 Service로 전달한다.

**Step 1: NodePort Service 생성**

```bash
kubectl create deployment nodeport-demo --image=nginx:1.25-alpine --replicas=2 -n demo
kubectl expose deployment nodeport-demo --port=80 --target-port=80 --type=NodePort -n demo
```

**검증:**

```bash
kubectl get svc nodeport-demo -n demo
```

```text
NAME            TYPE       CLUSTER-IP     EXTERNAL-IP   PORT(S)        AGE
nodeport-demo   NodePort   10.96.78.45    <none>        80:31234/TCP   10s
```

NodePort 31234가 할당되었다. 모든 노드의 `<NodeIP>:31234`로 접근이 가능하다.

```bash
# 노드 IP 확인
kubectl get nodes -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}'
echo ""
```

```text
192.168.64.2
```

**Step 2: 정리**

```bash
kubectl delete deployment nodeport-demo -n demo
kubectl delete svc nodeport-demo -n demo
```

---

### Lab 5.3: Headless Service

**학습 목표:**
- Headless Service(`clusterIP: None`)의 DNS 동작을 이해한다.

**관련 CKAD 도메인:** Services and Networking — Headless Service

**등장 배경:**

일반 ClusterIP Service는 가상 IP를 통해 로드밸런싱하므로 클라이언트가 어떤 Pod에 연결되었는지 알 수 없다. StatefulSet의 개별 Pod에 직접 접근하려면, Service의 DNS가 가상 IP가 아닌 각 Pod의 실제 IP를 반환해야 한다.

**Step 1: Headless Service 생성 및 DNS 확인**

```bash
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: headless-demo
spec:
  serviceName: headless-svc
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
          image: nginx:1.25-alpine
          ports:
            - containerPort: 80
---
apiVersion: v1
kind: Service
metadata:
  name: headless-svc
spec:
  clusterIP: None
  selector:
    app: headless-demo
  ports:
    - port: 80
      targetPort: 80
EOF
```

**검증:**

```bash
# Headless Service에 ClusterIP가 없는지 확인
kubectl get svc headless-svc -n demo
```

```text
NAME           TYPE        CLUSTER-IP   EXTERNAL-IP   PORT(S)   AGE
headless-svc   ClusterIP   None         <none>        80/TCP    30s
```

```bash
# DNS가 모든 Pod IP를 반환하는지 확인
kubectl run dns-test --image=busybox:1.36 --rm -it --restart=Never -n demo -- nslookup headless-svc.demo.svc.cluster.local
```

```text
Name:      headless-svc.demo.svc.cluster.local
Address:   10.244.1.10
Address:   10.244.1.11
Address:   10.244.2.8
```

```bash
# 개별 Pod DNS 확인
kubectl run dns-test2 --image=busybox:1.36 --rm -it --restart=Never -n demo -- nslookup headless-demo-0.headless-svc.demo.svc.cluster.local
```

```text
Name:      headless-demo-0.headless-svc.demo.svc.cluster.local
Address:   10.244.1.10
```

**Step 2: 정리**

```bash
kubectl delete statefulset headless-demo -n demo
kubectl delete svc headless-svc -n demo
```

---

### Lab 5.4: Service Endpoint 확인

**학습 목표:**
- Endpoints 리소스의 구조를 이해한다.
- selector가 없는 Service에 수동으로 Endpoints를 연결하는 방법을 실습한다.

**관련 CKAD 도메인:** Services and Networking — Endpoints

**등장 배경:**

때로는 쿠버네티스 외부에 있는 서비스(외부 DB, 레거시 시스템)에 쿠버네티스 Service DNS를 통해 접근하고 싶을 수 있다. selector 없는 Service를 생성하고 수동으로 Endpoints를 추가하면, 클러스터 내부 Pod는 마치 쿠버네티스 내부 서비스인 것처럼 DNS로 접근할 수 있다.

**Step 1: 수동 Endpoints 생성**

```bash
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: v1
kind: Service
metadata:
  name: external-db
spec:
  ports:
    - port: 5432
      targetPort: 5432
---
apiVersion: v1
kind: Endpoints
metadata:
  name: external-db       # Service와 동일한 이름이어야 한다
subsets:
  - addresses:
      - ip: 192.168.1.100   # 외부 DB IP
    ports:
      - port: 5432
EOF
```

**검증:**

```bash
kubectl get endpoints external-db -n demo
```

```text
NAME          ENDPOINTS            AGE
external-db   192.168.1.100:5432   10s
```

```bash
# DNS 해석 확인
kubectl run dns-test --image=busybox:1.36 --rm -it --restart=Never -n demo -- nslookup external-db.demo.svc.cluster.local
```

```text
Name:      external-db.demo.svc.cluster.local
Address:   10.96.123.45
```

**Step 2: 정리**

```bash
kubectl delete svc external-db -n demo
kubectl delete endpoints external-db -n demo
```

---

### Lab 5.5: Ingress 분석

**학습 목표:**
- Ingress 리소스의 구조와 Ingress Controller의 동작을 이해한다.

**관련 CKAD 도메인:** Services and Networking — Ingress

**등장 배경:**

NodePort는 포트 번호를 기억해야 하고, 하나의 Service에 하나의 포트만 사용할 수 있어 다수의 서비스를 노출하기 어렵다. LoadBalancer는 클라우드 환경에서 서비스당 하나의 로드밸런서를 생성하므로 비용이 높다. Ingress는 하나의 엔트리 포인트(80/443)에서 호스트명이나 경로 기반으로 여러 서비스에 트래픽을 분배한다.

**내부 동작 원리:**

Ingress 리소스 자체는 단순한 라우팅 규칙 정의이다. 실제 트래픽 처리는 Ingress Controller(nginx, Traefik, HAProxy 등)가 담당한다:
1. Ingress Controller가 API 서버를 watch하여 Ingress 리소스 변경을 감지한다.
2. Ingress 규칙을 nginx.conf(nginx의 경우)로 변환한다.
3. 변경 감지 시 nginx를 reload하여 새 설정을 적용한다.

**Step 1: Ingress 리소스 분석**

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: demo-ingress
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
  tls:
    - hosts:
        - app.example.com
      secretName: tls-secret
```

**검증:**

```bash
kubectl get ingress demo-ingress -n demo
```

```text
NAME           CLASS   HOSTS             ADDRESS        PORTS     AGE
demo-ingress   nginx   app.example.com   192.168.64.2   80, 443   30s
```

```bash
kubectl describe ingress demo-ingress -n demo | grep -A10 "Rules:"
```

```text
Rules:
  Host             Path  Backends
  ----             ----  --------
  app.example.com
                   /api   api-svc:80 (10.244.1.10:80,10.244.2.8:80)
                   /web   web-svc:80 (10.244.1.11:80,10.244.2.9:80)
```

**트러블슈팅:**

| 증상 | 원인 | 진단 명령어 | 해결 |
|------|------|-----------|------|
| ADDRESS가 비어 있음 | Ingress Controller 미설치 | `kubectl get pods -n ingress-nginx` | Ingress Controller 설치 |
| 404 에러 | path 불일치 또는 backend Service 미존재 | `kubectl describe ingress` | path, Service 이름, 포트 확인 |
| 503 에러 | backend Pod가 Ready가 아님 | `kubectl get endpoints <svc>` | Pod 상태 확인 |

---

### Lab 5.6: NetworkPolicy — Default Deny

**학습 목표:**
- Default Deny NetworkPolicy를 생성하여 네임스페이스 내 모든 트래픽을 차단한다.

**관련 CKAD 도메인:** Services and Networking — NetworkPolicy

**등장 배경:**

기본적으로 쿠버네티스의 모든 Pod는 서로 통신할 수 있다 (flat network). 이는 마이크로서비스 환경에서 보안 위험이다. 한 Pod가 침해되면 동일 클러스터의 모든 Pod에 접근할 수 있다. Default Deny 정책을 적용하면 명시적으로 허용한 트래픽만 전달되어 blast radius를 최소화할 수 있다.

**내부 동작 원리:**

NetworkPolicy는 CNI 플러그인(Cilium, Calico 등)이 구현한다. kubelet이 아닌 CNI 에이전트가 NetworkPolicy 리소스를 watch하여:
- Cilium: eBPF 프로그램으로 커널 수준에서 패킷 필터링
- Calico: iptables 규칙으로 패킷 필터링

`policyTypes: [Ingress]`만 지정하고 `ingress` 규칙을 비워두면 해당 Pod로의 모든 인바운드 트래픽이 차단된다.

**Step 1: Default Deny 생성**

```bash
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
spec:
  podSelector: {}          # 모든 Pod에 적용
  policyTypes:
    - Ingress
    - Egress
EOF
```

**검증:**

```bash
kubectl get networkpolicy default-deny-all -n demo
```

```text
NAME               POD-SELECTOR   AGE
default-deny-all   <none>         10s
```

```bash
# 통신 테스트 (차단되어야 함)
kubectl run server --image=nginx:1.25-alpine -n demo --restart=Never
kubectl run client --image=busybox:1.36 -n demo --restart=Never -- sleep 3600

# 3초 타임아웃으로 연결 시도
kubectl exec client -n demo -- wget -qO- --timeout=3 http://server:80 2>&1
```

```text
wget: download timed out
```

**Step 2: 정리**

```bash
kubectl delete networkpolicy default-deny-all -n demo
kubectl delete pod server client -n demo
```

---

### Lab 5.7: NetworkPolicy — 특정 Pod 허용

**학습 목표:**
- 특정 label을 가진 Pod에서만 트래픽을 허용하는 NetworkPolicy를 생성한다.

**관련 CKAD 도메인:** Services and Networking — NetworkPolicy Allow

**Step 1: 특정 Pod만 허용하는 정책 생성**

```bash
# 테스트 Pod 생성
kubectl run backend --image=nginx:1.25-alpine -n demo --restart=Never --labels="app=backend"
kubectl run frontend --image=busybox:1.36 -n demo --restart=Never --labels="app=frontend" -- sleep 3600
kubectl run attacker --image=busybox:1.36 -n demo --restart=Never --labels="app=attacker" -- sleep 3600

# NetworkPolicy: frontend만 backend에 접근 허용
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-frontend
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
          port: 80
EOF
```

**검증:**

```bash
# frontend -> backend: 허용
kubectl exec frontend -n demo -- wget -qO- --timeout=3 http://backend:80 | head -1
```

```text
<!DOCTYPE html>
```

```bash
# attacker -> backend: 차단
kubectl exec attacker -n demo -- wget -qO- --timeout=3 http://backend:80 2>&1
```

```text
wget: download timed out
```

**Step 2: 정리**

```bash
kubectl delete networkpolicy allow-frontend -n demo
kubectl delete pod backend frontend attacker -n demo
```

---

### Lab 5.8: L7 NetworkPolicy (Cilium CiliumNetworkPolicy)

**학습 목표:**
- Cilium의 L7(HTTP) NetworkPolicy를 이해한다.

**관련 CKAD 도메인:** Services and Networking — L7 Policy

**등장 배경:**

표준 NetworkPolicy는 L3/L4(IP, port, protocol)만 제어할 수 있다. HTTP 메서드(GET만 허용, POST 차단)나 경로(/api만 허용)를 기반으로 필터링하려면 L7 정책이 필요하다. Cilium은 eBPF를 사용하여 커널 수준에서 HTTP 파싱을 수행하므로 성능 저하 없이 L7 정책을 적용할 수 있다.

**CiliumNetworkPolicy 예제:**

```yaml
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: l7-policy
  namespace: demo
spec:
  endpointSelector:
    matchLabels:
      app: api-server
  ingress:
    - fromEndpoints:
        - matchLabels:
            app: frontend
      toPorts:
        - ports:
            - port: "80"
              protocol: TCP
          rules:
            http:
              - method: "GET"
                path: "/api/v1/.*"
```

이 정책은 frontend에서 api-server로의 GET /api/v1/* 요청만 허용하고, POST나 다른 경로는 차단한다.

**검증:**

```bash
# Cilium이 설치된 환경에서
kubectl get ciliumnetworkpolicy -n demo
```

```text
NAME        AGE
l7-policy   10s
```

---

### Lab 5.9: DNS 테스트

**학습 목표:**
- 쿠버네티스 DNS(CoreDNS)의 Service/Pod 해석을 테스트한다.

**관련 CKAD 도메인:** Services and Networking — DNS

**등장 배경:**

쿠버네티스에서 Service 이름으로 통신하려면 DNS가 정상 동작해야 한다. CoreDNS가 장애를 일으키면 모든 Service 간 통신이 실패한다.

**DNS 해석 규칙:**

| 형태 | 해석 결과 |
|------|---------|
| `<svc>` | 같은 네임스페이스의 Service ClusterIP |
| `<svc>.<ns>` | 특정 네임스페이스의 Service ClusterIP |
| `<svc>.<ns>.svc.cluster.local` | FQDN |
| `<pod-ip-dashed>.<ns>.pod.cluster.local` | Pod IP (10-244-1-5.demo.pod.cluster.local) |

**Step 1: DNS 테스트**

```bash
# Service DNS 해석
kubectl run dns-test --image=busybox:1.36 --rm -it --restart=Never -n demo -- nslookup kubernetes.default
```

```text
Server:    10.96.0.10
Address:   10.96.0.10:53

Name:      kubernetes.default.svc.cluster.local
Address:   10.96.0.1
```

```bash
# CoreDNS Pod 상태 확인
kubectl get pods -n kube-system -l k8s-app=kube-dns
```

```text
NAME                       READY   STATUS    RESTARTS   AGE
coredns-5d78c9869d-abc12   1/1     Running   0          24h
coredns-5d78c9869d-def34   1/1     Running   0          24h
```

**트러블슈팅:**

| 증상 | 원인 | 진단 명령어 | 해결 |
|------|------|-----------|------|
| nslookup 타임아웃 | CoreDNS Pod 미실행 | `kubectl get pods -n kube-system -l k8s-app=kube-dns` | CoreDNS 복구 |
| NXDOMAIN | Service 이름 또는 네임스페이스 오타 | `kubectl get svc -A` | 정확한 Service 이름 확인 |
| resolv.conf 오류 | Pod의 dnsPolicy 설정 오류 | `kubectl exec <pod> -- cat /etc/resolv.conf` | dnsPolicy를 ClusterFirst로 설정 |

---

### Lab 5.10: Istio mTLS 관찰

**학습 목표:**
- Istio의 자동 mTLS(mutual TLS) 동작을 이해한다.
- PeerAuthentication 정책을 분석한다.

**관련 CKAD 도메인:** Services and Networking — mTLS

**등장 배경:**

마이크로서비스 간 통신은 기본적으로 평문(HTTP)이다. 네트워크를 도청하면 서비스 간 데이터가 노출된다. Istio의 mTLS는 Envoy sidecar 프록시 간 자동 TLS 암호화를 제공하여, 애플리케이션 코드 변경 없이 서비스 간 통신을 암호화한다. "mutual"은 클라이언트와 서버 양쪽이 인증서를 교환하여 상호 인증하는 것을 의미한다.

**내부 동작 원리:**

1. Istiod가 SPIFFE 기반 X.509 인증서를 각 sidecar에 발급한다.
2. 서비스 A의 Envoy가 서비스 B로 요청을 보낼 때, 자동으로 TLS 핸드셰이크를 수행한다.
3. 서비스 B의 Envoy가 서비스 A의 인증서를 검증하고, 자신의 인증서도 제시한다.
4. TLS 터널 내에서 원본 HTTP 요청이 전달된다.
5. PeerAuthentication `STRICT` 모드에서는 mTLS가 아닌 요청을 거부한다. `PERMISSIVE` 모드(기본)에서는 mTLS와 평문 모두 허용한다.

**Step 1: PeerAuthentication 분석**

```bash
kubectl get peerauthentication -n istio-system
```

```text
NAME          MODE     AGE
default       STRICT   24h
```

```bash
kubectl get peerauthentication default -n istio-system -o yaml | grep -A3 "spec:"
```

```text
spec:
  mtls:
    mode: STRICT
```

**Step 2: mTLS 동작 확인**

```bash
# sidecar 간 TLS 연결 확인 (istioctl)
istioctl proxy-config listeners <pod-name> -n demo --port 80
```

```text
ADDRESS  PORT  MATCH         DESTINATION
0.0.0.0  80    ALL           Cluster: inbound|80||
```

```bash
# 인증서 확인
istioctl proxy-config secret <pod-name> -n demo | head -5
```

```text
RESOURCE NAME     TYPE           STATUS   VALID CERT   SERIAL NUMBER   ...
default           Cert Chain     ACTIVE   true         abc123...
ROOTCA            CA             ACTIVE   true         def456...
```

**트러블슈팅:**

| 증상 | 원인 | 진단 명령어 | 해결 |
|------|------|-----------|------|
| 503 "upstream connect error" | STRICT 모드에서 sidecar 없는 Pod가 접근 | `istioctl analyze -n demo` | sidecar 주입 또는 PERMISSIVE 모드 |
| TLS 핸드셰이크 실패 | 인증서 만료 | `istioctl proxy-config secret <pod>` | Istiod 재시작 (인증서 재발급) |

**확인 문제:**

1. PeerAuthentication의 STRICT와 PERMISSIVE 모드의 차이점은 무엇인가?
2. mTLS에서 SPIFFE ID의 형식은 어떻게 되는가?
3. sidecar가 주입되지 않은 Pod에서 STRICT 모드의 서비스에 접근하면 어떤 일이 발생하는가?

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
```

```text
{"DB_HOST":"postgres.demo.svc.cluster.local","DB_NAME":"demo","DB_PORT":"5432"}
```

```bash
echo "=== 2. Secret 확인 ==="
kubectl get secret order-secret -n demo -o jsonpath='{.data.DB_PASSWORD}' | base64 -d
echo ""
```

```text
demo123
```

```bash
echo "=== 3. Deployment 확인 ==="
kubectl get deployment order-service -n demo
kubectl rollout status deployment order-service -n demo
```

```text
NAME            READY   UP-TO-DATE   AVAILABLE   AGE
order-service   2/2     2            2           30s
deployment "order-service" successfully rolled out
```

```bash
echo "=== 4. 환경변수 확인 ==="
ORDER_POD=$(kubectl get pods -n demo -l app=order-service -o jsonpath='{.items[0].metadata.name}')
kubectl exec $ORDER_POD -n demo -- env | grep -E "DB_|API_"
```

```text
DB_HOST=postgres.demo.svc.cluster.local
DB_NAME=demo
DB_PORT=5432
DB_PASSWORD=demo123
```

```bash
echo "=== 5. QoS 확인 ==="
kubectl get pod $ORDER_POD -n demo -o jsonpath='{.status.qosClass}'
echo ""
```

```text
Burstable
```

```bash
echo "=== 6. NetworkPolicy 확인 ==="
kubectl get networkpolicy order-policy -n demo
```

```text
NAME           POD-SELECTOR        AGE
order-policy   app=order-service   30s
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
`troubleshoot` 네임스페이스에 배포된 `webapp` 애플리케이션이 정상 동작하지 않는다. 원인을 진단하고 수정하라.

**사전 환경 설정 (장애를 의도적으로 주입):**

```bash
kubectl create namespace troubleshoot

# 1. 존재하지 않는 이미지로 Deployment 생성
cat <<'EOF' | kubectl apply -n troubleshoot -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: webapp
spec:
  replicas: 2
  selector:
    matchLabels:
      app: webapp
  template:
    metadata:
      labels:
        app: webapp
    spec:
      containers:
        - name: web
          image: nginx:nonexistent
          ports:
            - containerPort: 80
          env:
            - name: DB_HOST
              valueFrom:
                configMapKeyRef:
                  name: webapp-config
                  key: DB_HOST
          livenessProbe:
            httpGet:
              path: /healthz
              port: 8080       # 잘못된 포트
            initialDelaySeconds: 5
            periodSeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: webapp-svc
spec:
  selector:
    app: webapp-wrong         # 잘못된 selector
  ports:
    - port: 80
      targetPort: 80
EOF
```

**제한 시간:** 15분

**풀이:**

**Step 1: 전체 상태 파악**

```bash
kubectl get all -n troubleshoot
```

```text
NAME                          READY   STATUS             RESTARTS   AGE
pod/webapp-xxx-aaa            0/1     ImagePullBackOff   0          30s
pod/webapp-xxx-bbb            0/1     ImagePullBackOff   0          30s

NAME                 TYPE        CLUSTER-IP     EXTERNAL-IP   PORT(S)   AGE
service/webapp-svc   ClusterIP   10.96.45.123   <none>        80/TCP    30s

NAME                     READY   UP-TO-DATE   AVAILABLE   AGE
deployment.apps/webapp   0/2     2            0           30s
```

**Step 2: 장애 원인 분석**

```bash
# Pod 이벤트 확인
kubectl describe pod -n troubleshoot -l app=webapp | grep -A5 "Events:"
```

```text
Events:
  Type     Reason     Age   From               Message
  ----     ------     ----  ----               -------
  Normal   Scheduled  30s   default-scheduler  Successfully assigned troubleshoot/webapp-xxx-aaa to worker1
  Normal   Pulling    28s   kubelet            Pulling image "nginx:nonexistent"
  Warning  Failed     25s   kubelet            Failed to pull image "nginx:nonexistent": not found
  Warning  Failed     25s   kubelet            Error: ErrImagePull
  Normal   BackOff    10s   kubelet            Back-off pulling image "nginx:nonexistent"
  Warning  Failed     10s   kubelet            Error: ImagePullBackOff
```

```bash
# Service Endpoint 확인
kubectl get endpoints webapp-svc -n troubleshoot
```

```text
NAME         ENDPOINTS   AGE
webapp-svc   <none>      30s
```

```bash
# ConfigMap 존재 여부 확인
kubectl get configmap webapp-config -n troubleshoot 2>&1
```

```text
Error from server (NotFound): configmaps "webapp-config" not found
```

**장애 원인 분석 테이블:**

| # | 증상 | 원인 | 진단 명령어 | 수정 방법 |
|---|------|------|-----------|---------|
| 1 | ImagePullBackOff | 존재하지 않는 이미지 태그 `nginx:nonexistent` | `kubectl describe pod` | 이미지를 `nginx:1.25-alpine`으로 변경 |
| 2 | CreateContainerConfigError (이미지 수정 후 발생) | ConfigMap `webapp-config`가 존재하지 않음 | `kubectl get cm -n troubleshoot` | ConfigMap 생성 |
| 3 | Liveness Probe 실패 (ConfigMap 수정 후 발생) | Probe 포트가 8080이지만 컨테이너는 80 | `kubectl describe pod` | Probe 포트를 80으로, 경로를 `/`로 변경 |
| 4 | Service Endpoint 비어 있음 | Service selector가 `app: webapp-wrong` | `kubectl get endpoints` | selector를 `app: webapp`으로 변경 |

**Step 3: 수정 적용**

```bash
# 1. ConfigMap 생성
kubectl create configmap webapp-config --from-literal=DB_HOST=db.troubleshoot.svc.cluster.local -n troubleshoot

# 2. Deployment 수정 (이미지, Probe 포트, Probe 경로)
kubectl patch deployment webapp -n troubleshoot --type='json' -p='[
  {"op": "replace", "path": "/spec/template/spec/containers/0/image", "value": "nginx:1.25-alpine"},
  {"op": "replace", "path": "/spec/template/spec/containers/0/livenessProbe/httpGet/port", "value": 80},
  {"op": "replace", "path": "/spec/template/spec/containers/0/livenessProbe/httpGet/path", "value": "/"}
]'

# 3. Service selector 수정
kubectl patch svc webapp-svc -n troubleshoot -p '{"spec":{"selector":{"app":"webapp"}}}'
```

**Step 4: 복구 검증**

```bash
# Deployment 롤아웃 확인
kubectl rollout status deployment webapp -n troubleshoot
```

```text
deployment "webapp" successfully rolled out
```

```bash
# Pod 상태 확인
kubectl get pods -n troubleshoot -l app=webapp
```

```text
NAME                      READY   STATUS    RESTARTS   AGE
webapp-yyy-ccc            1/1     Running   0          30s
webapp-yyy-ddd            1/1     Running   0          25s
```

```bash
# Endpoint 확인
kubectl get endpoints webapp-svc -n troubleshoot
```

```text
NAME         ENDPOINTS                       AGE
webapp-svc   10.244.1.10:80,10.244.2.8:80   30s
```

```bash
# 서비스 접근 확인
kubectl run test-client --image=busybox:1.36 --rm -it --restart=Never -n troubleshoot -- wget -qO- http://webapp-svc:80 | head -3
```

```text
<!DOCTYPE html>
<html>
<head>
```

```bash
# 환경변수 확인
kubectl exec -n troubleshoot $(kubectl get pods -n troubleshoot -l app=webapp -o jsonpath='{.items[0].metadata.name}') -- env | grep DB_HOST
```

```text
DB_HOST=db.troubleshoot.svc.cluster.local
```

**정리:**

```bash
kubectl delete namespace troubleshoot
```

---

### 시나리오 3: CKAD 모의 실기 — Canary 배포 전체 흐름

**시나리오 설명:**
`canary-ns` 네임스페이스에서 `product-api` 서비스의 Canary 배포를 수행하라. stable(v1) → canary(v2) 20% → canary 50% → 전체 전환 → 문제 발견 시 롤백까지 전체 흐름을 실행한다.

**제한 시간:** 25분

**풀이:**

**Step 1: 네임스페이스 및 Stable(v1) 배포**

```bash
kubectl create namespace canary-ns

# Stable Deployment (v1) — 4 replicas
cat <<'EOF' | kubectl apply -n canary-ns -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: product-api-stable
spec:
  replicas: 4
  selector:
    matchLabels:
      app: product-api
      track: stable
  template:
    metadata:
      labels:
        app: product-api
        track: stable
        version: v1
    spec:
      containers:
        - name: api
          image: nginx:1.24-alpine
          ports:
            - containerPort: 80
          readinessProbe:
            httpGet:
              path: /
              port: 80
            initialDelaySeconds: 3
            periodSeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: product-api
spec:
  selector:
    app: product-api
  ports:
    - port: 80
      targetPort: 80
EOF
```

**검증:**

```bash
kubectl get deployment -n canary-ns
kubectl get endpoints product-api -n canary-ns
```

```text
NAME                   READY   UP-TO-DATE   AVAILABLE   AGE
product-api-stable     4/4     4            4           30s

NAME          ENDPOINTS                                                  AGE
product-api   10.244.1.10:80,10.244.1.11:80,10.244.2.8:80,10.244.2.9:80   30s
```

Pod 수: stable=4, canary=0. 트래픽 비율: v1=100%, v2=0%.

**Step 2: Canary(v2) 배포 — 20% 트래픽**

```bash
# Canary Deployment (v2) — 1 replica (4:1 = 80:20)
cat <<'EOF' | kubectl apply -n canary-ns -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: product-api-canary
spec:
  replicas: 1
  selector:
    matchLabels:
      app: product-api
      track: canary
  template:
    metadata:
      labels:
        app: product-api
        track: canary
        version: v2
    spec:
      containers:
        - name: api
          image: nginx:1.25-alpine
          ports:
            - containerPort: 80
          readinessProbe:
            httpGet:
              path: /
              port: 80
            initialDelaySeconds: 3
            periodSeconds: 5
EOF
```

**검증:**

```bash
kubectl get deployment -n canary-ns
kubectl get endpoints product-api -n canary-ns
```

```text
NAME                   READY   UP-TO-DATE   AVAILABLE   AGE
product-api-stable     4/4     4            4           1m
product-api-canary     1/1     1            1           15s

NAME          ENDPOINTS                                                              AGE
product-api   10.244.1.10:80,10.244.1.11:80,10.244.2.8:80,10.244.2.9:80,10.244.3.5:80   1m
```

Pod 수: stable=4, canary=1 (총 5). 트래픽 비율: v1≈80%, v2≈20%.

**Step 3: Canary 비율 50%로 확대**

```bash
kubectl scale deployment product-api-canary --replicas=4 -n canary-ns
```

**검증:**

```bash
kubectl get deployment -n canary-ns -l app=product-api
```

```text
NAME                   READY   UP-TO-DATE   AVAILABLE   AGE
product-api-stable     4/4     4            4           2m
product-api-canary     4/4     4            4           1m
```

Pod 수: stable=4, canary=4 (총 8). 트래픽 비율: v1=50%, v2=50%.

**Step 4: 전체 전환 (v2로 100%)**

```bash
# stable을 0으로 축소
kubectl scale deployment product-api-stable --replicas=0 -n canary-ns
```

**검증:**

```bash
kubectl get deployment -n canary-ns -l app=product-api
kubectl get endpoints product-api -n canary-ns
```

```text
NAME                   READY   UP-TO-DATE   AVAILABLE   AGE
product-api-stable     0/0     0            0           3m
product-api-canary     4/4     4            4           2m

NAME          ENDPOINTS                                                  AGE
product-api   10.244.3.5:80,10.244.3.6:80,10.244.3.7:80,10.244.3.8:80   3m
```

Pod 수: stable=0, canary=4. 트래픽 비율: v1=0%, v2=100%.

**Step 5: 문제 발견 — 롤백**

v2에서 오류율이 급증했다고 가정한다. 즉시 v1으로 롤백한다.

```bash
# stable을 다시 활성화
kubectl scale deployment product-api-stable --replicas=4 -n canary-ns

# canary를 제거
kubectl scale deployment product-api-canary --replicas=0 -n canary-ns
```

**롤백 검증:**

```bash
kubectl get deployment -n canary-ns -l app=product-api
```

```text
NAME                   READY   UP-TO-DATE   AVAILABLE   AGE
product-api-stable     4/4     4            4           4m
product-api-canary     0/0     0            0           3m
```

```bash
# 모든 트래픽이 v1으로 복원되었는지 확인
kubectl get endpoints product-api -n canary-ns
```

```text
NAME          ENDPOINTS                                                  AGE
product-api   10.244.1.10:80,10.244.1.11:80,10.244.2.8:80,10.244.2.9:80   4m
```

Pod 수: stable=4, canary=0. 트래픽 비율: v1=100%, v2=0%. 롤백 완료.

**정리:**

```bash
kubectl delete namespace canary-ns
```

**각 단계별 요약:**

| 단계 | stable replicas | canary replicas | 총 Pod | v1 트래픽 | v2 트래픽 |
|------|----------------|----------------|--------|----------|----------|
| 초기 배포 | 4 | 0 | 4 | 100% | 0% |
| Canary 20% | 4 | 1 | 5 | 80% | 20% |
| Canary 50% | 4 | 4 | 8 | 50% | 50% |
| 전체 전환 | 0 | 4 | 4 | 0% | 100% |
| 롤백 | 4 | 0 | 4 | 100% | 0% |

**트러블슈팅:**

| 증상 | 원인 | 진단 명령어 | 해결 |
|------|------|-----------|------|
| canary Pod가 Endpoints에 포함 안 됨 | `app: product-api` label 누락 | `kubectl get pods --show-labels` | label 확인 및 수정 |
| 롤백 후에도 canary 트래픽 존재 | canary replicas가 0이 아님 | `kubectl get deployment -n canary-ns` | canary replicas를 0으로 설정 |
| 트래픽 비율이 정확하지 않음 | kube-proxy iptables 확률 기반 분배 | 샘플 수 증가 | 정밀 제어 필요 시 Istio VirtualService 사용 |

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
# sts = statefulsets, ds = daemonsets, cj = cronjobs

# 자주 사용하는 별칭
alias k=kubectl
export do="--dry-run=client -o yaml"

# YAML 빠르게 생성
kubectl run test-pod --image=nginx --dry-run=client -o yaml > pod.yaml
kubectl create deployment test-dep --image=nginx --replicas=3 --dry-run=client -o yaml > deploy.yaml
kubectl create service clusterip test-svc --tcp=80:80 --dry-run=client -o yaml > svc.yaml
kubectl create configmap test-cm --from-literal=key=value --dry-run=client -o yaml > cm.yaml
kubectl create secret generic test-sec --from-literal=pass=secret --dry-run=client -o yaml > secret.yaml
kubectl create job test-job --image=busybox --dry-run=client -o yaml -- sh -c "echo done" > job.yaml
kubectl create cronjob test-cron --image=busybox --schedule="*/5 * * * *" --dry-run=client -o yaml -- sh -c "date" > cron.yaml
```

### 시험 중 시간 절약 팁

1. **`--dry-run=client -o yaml`을 적극 활용한다:** YAML을 처음부터 작성하지 않고, 명령형으로 생성한 YAML을 수정한다.
2. **`kubectl explain` 활용:** 필드명이 기억나지 않을 때 `kubectl explain pod.spec.containers.livenessProbe`처럼 사용한다. `--recursive` 플래그로 전체 필드 트리를 볼 수 있다.
3. **Vim 설정:** `set tabstop=2 shiftwidth=2 expandtab`으로 YAML 편집을 편하게 한다. `~/.vimrc`에 미리 저장해 두는 것이 좋다.
4. **네임스페이스 기본 설정:** `kubectl config set-context --current --namespace=<ns>` — 매번 `-n` 플래그를 입력하는 시간을 절약한다.
5. **명령형 + 선언형 혼합:** 기본 구조는 명령형으로 생성하고, 세부 사항은 `kubectl edit`으로 수정한다.
6. **검증 습관화:** 리소스 생성 후 반드시 `kubectl get`, `kubectl describe`, `kubectl logs`로 확인한다. 시험에서 "생성만 하고 검증하지 않아 실수를 발견하지 못한" 경우가 가장 많은 감점 원인이다.
7. **문제 난이도 판단:** 시험 시작 시 전체 문제를 훑어보고, 쉬운 문제부터 풀어 점수를 확보한다.
8. **kubectl 자동완성 활성화:** `source <(kubectl completion bash)` 및 `complete -o default -F __start_kubectl k`

### 시험 영역별 핵심 명령어

| 영역 | 핵심 명령어 |
|------|-----------|
| Design & Build | `kubectl run`, `kubectl create deployment`, Volume 관련 YAML |
| Deployment | `kubectl rollout`, `kubectl set image`, `helm`, `kubectl apply -k` |
| Observability | `kubectl logs`, `kubectl exec`, `kubectl top`, `kubectl debug` |
| Config & Security | `kubectl create configmap/secret`, SecurityContext YAML |
| Networking | `kubectl expose`, `kubectl get svc/endpoints`, NetworkPolicy YAML |

### 트러블슈팅 순서도

```
Pod가 정상이 아닌가?
├── STATUS: Pending
│   ├── 노드 리소스 부족 → kubectl describe pod → "Insufficient cpu/memory"
│   ├── PVC 바인딩 실패 → kubectl get pvc → STATUS: Pending
│   └── nodeSelector/affinity 불일치 → kubectl describe pod → "didn't match"
├── STATUS: ImagePullBackOff / ErrImagePull
│   ├── 이미지 이름/태그 오류 → kubectl describe pod → "not found"
│   └── 프라이빗 레지스트리 인증 실패 → imagePullSecrets 확인
├── STATUS: CrashLoopBackOff
│   ├── 애플리케이션 에러 → kubectl logs --previous
│   ├── OOMKilled → kubectl describe pod → "OOMKilled" → memory limits 증가
│   └── 잘못된 command/args → kubectl get pod -o yaml → command 확인
├── STATUS: CreateContainerConfigError
│   └── ConfigMap/Secret 미존재 → kubectl get cm/secret
├── READY: 0/1 (Running이지만 Not Ready)
│   └── Readiness Probe 실패 → kubectl describe pod → Readiness probe failed
└── 서비스 접근 불가
    ├── Endpoint 비어 있음 → kubectl get endpoints → selector 확인
    ├── NetworkPolicy 차단 → kubectl get netpol → 정책 확인
    └── DNS 해석 실패 → kubectl run --rm -it --image=busybox -- nslookup <svc>
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
