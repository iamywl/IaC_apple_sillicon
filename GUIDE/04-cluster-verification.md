# 재연 가이드 04. 클러스터 검증

이 장에서는 4개 클러스터(platform, dev, staging, prod)가 정상적으로 구성되었는지 검증한다. 모든 VM이 실행 중이고, Kubernetes 노드가 Ready 상태이며, 핵심 서비스에 접속 가능한지 확인한다.


## 1. VM 상태 확인

### 1.1 전체 VM 목록 확인

```bash
tart list
```

예상 출력 (10개 VM 모두 running 상태):

```
Source  Name               Disk  Size  State    IP
local   platform-master    20    GB    running  192.168.64.2
local   platform-worker1   20    GB    running  192.168.64.3
local   platform-worker2   20    GB    running  192.168.64.4
local   dev-master         20    GB    running  192.168.64.5
local   dev-worker1        20    GB    running  192.168.64.6
local   staging-master     20    GB    running  192.168.64.7
local   staging-worker1    20    GB    running  192.168.64.8
local   prod-master        20    GB    running  192.168.64.9
local   prod-worker1       20    GB    running  192.168.64.10
local   prod-worker2       20    GB    running  192.168.64.11
```

IP 주소는 환경마다 다르다. 실제 IP는 아래 명령으로 확인한다.

### 1.2 개별 VM IP 확인

```bash
# 각 VM의 IP를 개별 확인한다
tart ip platform-master
tart ip platform-worker1
tart ip platform-worker2
tart ip dev-master
tart ip dev-worker1
tart ip staging-master
tart ip staging-worker1
tart ip prod-master
tart ip prod-worker1
tart ip prod-worker2
```

각 명령은 해당 VM의 IP 주소 한 줄을 출력한다. 이후 설명에서 사용하는 변수는 다음과 같다:

```bash
# 편의를 위해 환경변수로 저장한다
PLATFORM_MASTER_IP=$(tart ip platform-master)
PLATFORM_WORKER1_IP=$(tart ip platform-worker1)
PLATFORM_WORKER2_IP=$(tart ip platform-worker2)
DEV_MASTER_IP=$(tart ip dev-master)
DEV_WORKER1_IP=$(tart ip dev-worker1)
STAGING_MASTER_IP=$(tart ip staging-master)
STAGING_WORKER1_IP=$(tart ip staging-worker1)
PROD_MASTER_IP=$(tart ip prod-master)
PROD_WORKER1_IP=$(tart ip prod-worker1)
PROD_WORKER2_IP=$(tart ip prod-worker2)
```

### 1.3 SSH 접속 확인

모든 VM은 동일한 SSH 자격 증명을 사용한다:
- 사용자: `admin`
- 비밀번호: `admin`

```bash
ssh admin@$PLATFORM_MASTER_IP "hostname && uptime"
```

예상 출력:

```
platform-master
 12:00:00 up 2 days,  3:00,  0 users,  load average: 0.50, 0.45, 0.40
```


## 2. 클러스터별 검증

각 클러스터의 kubeconfig 파일은 `kubeconfig/` 디렉토리에 위치한다.

### 2.1 Platform 클러스터

```bash
export KUBECONFIG=kubeconfig/platform.yaml
```

#### 노드 확인

```bash
kubectl get nodes -o wide
```

예상 출력:

```
NAME                STATUS   ROLES           AGE   VERSION   INTERNAL-IP     OS-IMAGE
platform-master     Ready    control-plane   2d    v1.31.x   192.168.64.2    Ubuntu 24.04 LTS
platform-worker1    Ready    <none>          2d    v1.31.x   192.168.64.3    Ubuntu 24.04 LTS
platform-worker2    Ready    <none>          2d    v1.31.x   192.168.64.4    Ubuntu 24.04 LTS
```

3개 노드 모두 `Ready` 상태여야 한다. master 1개, worker 2개 구성이다.

#### 주요 Pod 확인

```bash
kubectl get pods -A --field-selector=status.phase!=Succeeded
```

아래 네임스페이스의 Pod가 `Running` 상태여야 한다:

| 네임스페이스 | Pod 이름 패턴 | 역할 |
|---|---|---|
| `kube-system` | `cilium-*` | CNI (Cilium) |
| `kube-system` | `coredns-*` | DNS |
| `monitoring` | `prometheus-kube-prometheus-stack-prometheus-*` | Prometheus |
| `monitoring` | `kube-prometheus-stack-grafana-*` | Grafana |
| `monitoring` | `alertmanager-kube-prometheus-stack-alertmanager-*` | AlertManager |
| `monitoring` | `loki-*` | Loki 로그 수집 |
| `jenkins` | `jenkins-*` | Jenkins CI |
| `argocd` | `argocd-server-*` | ArgoCD |
| `argocd` | `argocd-repo-server-*` | ArgoCD Repo Server |
| `argocd` | `argocd-application-controller-*` | ArgoCD Controller |

```bash
# 네임스페이스별 확인
kubectl get pods -n monitoring
kubectl get pods -n jenkins
kubectl get pods -n argocd
kubectl get pods -n kube-system
```

#### Cilium 상태 확인

```bash
kubectl exec -n kube-system ds/cilium -- cilium status --brief
```

예상 출력:

```
KVStore:                 Ok   Disabled
Kubernetes:              Ok   1.31
Kubernetes APIs:         ["EndpointSliceOrEndpoint", "cilium/v2::CiliumClusterwideNetworkPolicy", ...]
KubeProxyReplacement:    True
Cilium:                  Ok   1.16.x   ...
NodeMonitor:             Listening for events on 3 CPUs with 64x4096 of shared memory
...
```

`Cilium: Ok`가 출력되어야 한다.

### 2.2 Dev 클러스터

```bash
export KUBECONFIG=kubeconfig/dev.yaml
```

#### 노드 확인

```bash
kubectl get nodes -o wide
```

예상 출력:

```
NAME          STATUS   ROLES           AGE   VERSION   INTERNAL-IP     OS-IMAGE
dev-master    Ready    control-plane   2d    v1.31.x   192.168.64.5    Ubuntu 24.04 LTS
dev-worker1   Ready    <none>          2d    v1.31.x   192.168.64.6    Ubuntu 24.04 LTS
```

2개 노드(master 1, worker 1) 구성이다.

#### 주요 Pod 확인

```bash
kubectl get pods -A --field-selector=status.phase!=Succeeded
```

| 네임스페이스 | Pod 이름 패턴 | 역할 |
|---|---|---|
| `kube-system` | `cilium-*` | CNI (Cilium) |
| `demo` | `nginx-web-*` | nginx 웹 서버 (NodePort 30080) |
| `demo` | `httpbin-*` | httpbin API |
| `demo` | `redis-*` | Redis |
| `demo` | `postgres-*` | PostgreSQL |
| `demo` | `rabbitmq-*` | RabbitMQ |
| `demo` | `keycloak-*` | Keycloak (NodePort 30880) |
| `istio-system` | `istiod-*` | Istio Control Plane |
| `istio-system` | `istio-ingressgateway-*` | Istio Ingress |

```bash
kubectl get pods -n demo
kubectl get pods -n istio-system
kubectl get hpa -n demo
kubectl get cnp -n demo
```

HPA 확인 예상 출력:

```
NAME             REFERENCE              TARGETS         MINPODS   MAXPODS   REPLICAS   AGE
nginx-web-hpa    Deployment/nginx-web   cpu: 20%/50%    3         10        3          2d
httpbin-hpa      Deployment/httpbin     cpu: 15%/50%    2         8         2          2d
redis-hpa        Deployment/redis       cpu: 10%/50%    1         5         1          2d
postgres-hpa     Deployment/postgres    cpu: 12%/50%    1         5         1          2d
rabbitmq-hpa     Deployment/rabbitmq    cpu: 8%/50%     1         5         1          2d
```

#### Cilium 상태 확인

```bash
kubectl exec -n kube-system ds/cilium -- cilium status --brief
```

### 2.3 Staging 클러스터

```bash
export KUBECONFIG=kubeconfig/staging.yaml
```

#### 노드 확인

```bash
kubectl get nodes -o wide
```

예상 출력:

```
NAME              STATUS   ROLES           AGE   VERSION   INTERNAL-IP     OS-IMAGE
staging-master    Ready    control-plane   2d    v1.31.x   192.168.64.7    Ubuntu 24.04 LTS
staging-worker1   Ready    <none>          2d    v1.31.x   192.168.64.8    Ubuntu 24.04 LTS
```

2개 노드(master 1, worker 1) 구성이다.

#### 주요 Pod 확인

```bash
kubectl get pods -A --field-selector=status.phase!=Succeeded
```

kube-system의 cilium, coredns 등 기본 컴포넌트가 Running 상태인지 확인한다.

```bash
kubectl exec -n kube-system ds/cilium -- cilium status --brief
```

### 2.4 Prod 클러스터

```bash
export KUBECONFIG=kubeconfig/prod.yaml
```

#### 노드 확인

```bash
kubectl get nodes -o wide
```

예상 출력:

```
NAME           STATUS   ROLES           AGE   VERSION   INTERNAL-IP      OS-IMAGE
prod-master    Ready    control-plane   2d    v1.31.x   192.168.64.9     Ubuntu 24.04 LTS
prod-worker1   Ready    <none>          2d    v1.31.x   192.168.64.10    Ubuntu 24.04 LTS
prod-worker2   Ready    <none>          2d    v1.31.x   192.168.64.11    Ubuntu 24.04 LTS
```

3개 노드(master 1, worker 2) 구성이다.

#### 주요 Pod 확인

```bash
kubectl get pods -A --field-selector=status.phase!=Succeeded
kubectl exec -n kube-system ds/cilium -- cilium status --brief
```


## 3. 서비스 접속 확인

서비스는 NodePort로 노출되어 있다. Worker 노드 IP를 사용하여 접속한다.

### 3.1 Grafana (Platform 클러스터)

- URL: `http://<platform-worker1-ip>:30300`
- 인증: `admin` / `admin` (최초 로그인 시 비밀번호 변경 요청이 나올 수 있다)

```bash
curl -sf -o /dev/null -w "%{http_code}" http://$PLATFORM_WORKER1_IP:30300/login
```

예상 출력:

```
200
```

브라우저에서 접속하면 Grafana 로그인 화면이 나타난다.

### 3.2 AlertManager (Platform 클러스터)

- URL: `http://<platform-worker1-ip>:30903`

```bash
curl -sf -o /dev/null -w "%{http_code}" http://$PLATFORM_WORKER1_IP:30903
```

예상 출력:

```
200
```

### 3.3 Jenkins (Platform 클러스터)

- URL: `http://<platform-worker1-ip>:30900`
- 인증: `admin` / `admin`

```bash
curl -sf -o /dev/null -w "%{http_code}" http://$PLATFORM_WORKER1_IP:30900/login
```

예상 출력:

```
200
```

### 3.4 ArgoCD (Platform 클러스터)

- URL: `http://<platform-worker1-ip>:30800`
- 인증: `admin` / 자동 생성된 비밀번호

ArgoCD 초기 비밀번호를 확인한다:

```bash
export KUBECONFIG=kubeconfig/platform.yaml
kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath='{.data.password}' | base64 -d
echo
```

예상 출력 (예시):

```
aB3cD4eF5gH6iJ7k
```

접속 확인:

```bash
curl -sf -o /dev/null -w "%{http_code}" -k https://$PLATFORM_WORKER1_IP:30800
```

ArgoCD는 HTTPS를 사용할 수 있다. HTTP로 리다이렉트되는 경우 `http://`로 시도한다.

### 3.5 nginx Demo (Dev 클러스터)

- URL: `http://<dev-worker1-ip>:30080`

```bash
curl -sf http://$DEV_WORKER1_IP:30080
```

예상 출력:

```html
<!DOCTYPE html>
<html>
<head>
<title>Welcome to nginx!</title>
...
```

### 3.6 Keycloak (Dev 클러스터)

- URL: `http://<dev-worker1-ip>:30880`
- 관리자: `admin` / `admin`

```bash
curl -sf -o /dev/null -w "%{http_code}" http://$DEV_WORKER1_IP:30880
```

예상 출력:

```
200
```

### 3.7 Hubble UI (Dev 클러스터)

Hubble은 Cilium의 네트워크 관찰 도구이다. Dev 클러스터에서 포트 포워딩으로 접속한다.

```bash
export KUBECONFIG=kubeconfig/dev.yaml
kubectl port-forward -n kube-system svc/hubble-ui 12000:80 &
```

브라우저에서 `http://localhost:12000` 으로 접속한다. demo 네임스페이스를 선택하면 Pod 간 트래픽 흐름을 시각적으로 확인할 수 있다.

포트 포워딩을 종료하려면:

```bash
kill %1
```


## 4. 네트워크 정책 검증

Dev 클러스터에는 CiliumNetworkPolicy가 적용되어 있다. 기본 정책은 `default-deny-all`로 DNS 외 모든 트래픽을 차단하며, 명시적으로 허용된 트래픽만 통과한다.

### 4.1 적용된 네트워크 정책 확인

```bash
export KUBECONFIG=kubeconfig/dev.yaml
kubectl get cnp -n demo
```

예상 출력:

```
NAME                          AGE
allow-external-to-keycloak    2d
allow-external-to-nginx       2d
allow-httpbin-to-keycloak     2d
allow-httpbin-to-postgres     2d
allow-httpbin-to-rabbitmq     2d
allow-istio-sidecars          2d
allow-keycloak-to-postgres    2d
allow-nginx-egress            2d
allow-nginx-to-httpbin        2d
allow-nginx-to-redis          2d
default-deny-all              2d
```

### 4.2 허용된 트래픽 테스트

nginx에서 httpbin으로 GET 요청 (L7 정책에 의해 GET만 허용):

```bash
kubectl exec -n demo deploy/nginx-web -c nginx -- \
  curl -sf -o /dev/null -w "%{http_code}" \
  http://httpbin.demo.svc.cluster.local/get
```

예상 출력:

```
200
```

nginx에서 redis로 접속:

```bash
kubectl exec -n demo deploy/nginx-web -c nginx -- \
  curl -sf --max-time 3 telnet://redis.demo.svc.cluster.local:6379 <<< "PING"
```

또는 redis Pod에서 직접:

```bash
kubectl exec -n demo deploy/redis -- redis-cli ping
```

예상 출력:

```
PONG
```

### 4.3 차단된 트래픽 테스트

nginx에서 httpbin으로 POST 요청 (L7 정책에 의해 차단):

```bash
kubectl exec -n demo deploy/nginx-web -c nginx -- \
  curl -sf -o /dev/null -w "%{http_code}" --max-time 5 \
  -X POST http://httpbin.demo.svc.cluster.local/post
```

예상 출력:

```
403
```

HTTP 403(Forbidden) 또는 연결 타임아웃이 발생한다. Cilium L7 정책이 GET만 허용하기 때문이다.

redis에서 httpbin으로 직접 접속 시도 (정책 미허용):

```bash
kubectl exec -n demo deploy/redis -- \
  curl -sf --max-time 3 http://httpbin.demo.svc.cluster.local/get
```

예상 결과: 타임아웃 또는 연결 거부. `default-deny-all` 정책에 의해 redis에서 httpbin으로의 트래픽은 차단된다.

```
command terminated with exit code 28
```

exit code 28은 curl의 타임아웃 코드이다.


## 5. 모니터링 검증

### 5.1 Prometheus 타겟 확인

브라우저에서 Grafana에 접속 후:

1. `http://<platform-worker1-ip>:30300` 으로 로그인한다 (admin/admin)
2. 좌측 메뉴 > Connections > Data sources 에서 Prometheus가 설정되어 있는지 확인한다
3. Explore 메뉴에서 Prometheus 데이터소스를 선택한다
4. `up` 쿼리를 실행한다

```promql
up
```

각 타겟의 값이 `1`이면 정상 수집 중이다.

또는 Prometheus UI에 직접 접속하여 확인한다:

```bash
export KUBECONFIG=kubeconfig/platform.yaml
kubectl port-forward -n monitoring svc/kube-prometheus-stack-prometheus 9090:9090 &
```

`http://localhost:9090/targets` 에서 모든 타겟의 State가 `UP`인지 확인한다.

### 5.2 Grafana 대시보드 접속

1. Grafana(`http://<platform-worker1-ip>:30300`)에 로그인한다
2. 좌측 메뉴 > Dashboards 에서 사전 구성된 대시보드 목록을 확인한다
3. "Kubernetes / Compute Resources / Cluster" 대시보드를 선택하면 클러스터 전체의 CPU/메모리 사용량을 볼 수 있다

### 5.3 Loki 로그 조회

1. Grafana에서 Explore 메뉴를 연다
2. 데이터소스를 Loki로 변경한다
3. 아래 LogQL 쿼리를 실행한다:

```logql
{namespace="demo"}
```

demo 네임스페이스의 모든 Pod 로그가 출력된다. 특정 앱만 보려면:

```logql
{namespace="demo", app="nginx-web"}
```

### 5.4 AlertManager 확인

`http://<platform-worker1-ip>:30903` 에 접속하면 현재 활성화된 Alert 목록을 볼 수 있다.

```bash
curl -sf http://$PLATFORM_WORKER1_IP:30903/api/v2/alerts | head -c 200
```

Alert가 없으면 빈 배열 `[]`이 반환된다.


## 6. 전체 클러스터 검증 스크립트

아래 스크립트로 모든 클러스터를 한 번에 검증할 수 있다:

```bash
#!/bin/bash
CLUSTERS="platform dev staging prod"

for cluster in $CLUSTERS; do
  echo "========== $cluster 클러스터 =========="
  export KUBECONFIG=kubeconfig/${cluster}.yaml

  echo "[노드 상태]"
  kubectl get nodes -o wide 2>/dev/null || echo "  연결 실패"

  echo "[Pod 상태 요약]"
  TOTAL=$(kubectl get pods -A --no-headers 2>/dev/null | wc -l)
  RUNNING=$(kubectl get pods -A --field-selector=status.phase=Running --no-headers 2>/dev/null | wc -l)
  echo "  전체: $TOTAL, Running: $RUNNING"

  echo "[Cilium 상태]"
  kubectl exec -n kube-system ds/cilium -- cilium status --brief 2>/dev/null | head -3 || echo "  확인 불가"

  echo ""
done
```

모든 클러스터의 노드가 `Ready`이고 Pod가 정상 실행 중이면 인프라 구성이 완료된 것이다.
