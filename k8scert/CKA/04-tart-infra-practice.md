# CKA 실습 가이드 — tart-infra 활용

> 이 문서는 tart-infra 환경의 4개 Kubernetes 클러스터(platform/dev/staging/prod)를 활용하여 CKA 시험의 모든 도메인을 실전 수준으로 훈련하는 종합 실습 가이드이다.
> 모든 실습은 실제 인프라 구성 요소(Cilium CNI, Istio 서비스 메시, Prometheus/Grafana 모니터링, ArgoCD/Jenkins CI/CD, 데모 애플리케이션)를 대상으로 진행한다.
> CKA 시험은 100% 실기(hands-on) 시험이므로, 각 실습은 직접 명령어를 입력하고 결과를 확인하는 방식으로 구성한다.
> 모든 실습 단계에는 검증 명령어와 기대 출력(`text` 블록)을 포함하여 실습 결과를 즉시 확인할 수 있도록 한다.

### 이 문서의 등장 배경

Kubernetes 자격 시험 준비에서 가장 큰 어려움은 실제 멀티 클러스터 환경을 구축하는 것이다. 클라우드 기반 환경은 비용이 발생하고, 단일 minikube/kind 클러스터로는 시험의 멀티 컨텍스트 전환, 노드 drain, etcd 백업/복구 등 핵심 시나리오를 훈련할 수 없다. tart-infra는 Apple Silicon Mac에서 Tart 가상화 프레임워크를 사용하여 4개 kubeadm 클러스터를 로컬에 구성함으로써 이 한계를 해결한다. 각 클러스터는 독립된 Pod CIDR과 Service CIDR을 가지며, 실제 프로덕션 환경과 동일한 컴포넌트(Cilium, Istio, Prometheus 등)가 설치되어 있다.

---

## CKA 시험 도메인 및 비중

| 도메인 | 비중 | 실습 수 | 핵심 키워드 |
|--------|------|---------|------------|
| Cluster Architecture, Installation & Configuration | 25% | 10 | etcd 백업/복구, kubeadm, RBAC, kubeconfig, 인증서 |
| Workloads & Scheduling | 15% | 10 | Deployment, Rolling Update, Taint/Toleration, Resource, DaemonSet, Job |
| Services & Networking | 20% | 10 | Service, NetworkPolicy, DNS, CNI, Ingress |
| Storage | 10% | 5 | PV, PVC, StorageClass, Volume |
| Troubleshooting | 30% | 12 | Pod 진단, kubelet, 인증서, DNS, 로그, 네트워크 |
| **종합 시나리오** | - | 3 | CKA 모의 실기 |
| **합계** | **100%** | **50** | |

---

## tart-infra 클러스터 구성 요약

### 멀티 클러스터 구성의 등장 배경

프로덕션 Kubernetes 환경에서는 단일 클러스터가 아닌 멀티 클러스터 구성이 일반적이다. 환경 분리(dev/staging/prod), 장애 격리, 규제 준수 등의 이유로 클러스터를 분리하며, 각 클러스터의 리소스 크기와 네트워크 설정이 상이하다. CKA 시험에서도 여러 클러스터를 오가며 문제를 풀어야 하므로, 클러스터 간 차이를 빠르게 파악하는 능력이 필수이다.

### 내부 네트워크 설계 원리

4개 클러스터의 Pod CIDR(10.10/20/30/40.0.0/16)과 Service CIDR(10.96/97/98/99.0.0/16)이 모두 겹치지 않도록 설계되어 있다. 이는 다음과 같은 이유 때문이다:

1. **Pod CIDR 분리**: 각 클러스터의 Pod 네트워크가 독립적으로 동작해야 한다. 만약 두 클러스터의 Pod CIDR이 겹치면, 멀티 클러스터 환경에서 라우팅 충돌이 발생한다.
2. **Service CIDR 분리**: kube-apiserver의 `--service-cluster-ip-range` 플래그로 설정되며, 각 클러스터의 가상 Service IP 범위가 독립적이어야 한다.
3. **kubeadm 초기화 시 설정**: `kubeadm init --pod-network-cidr=10.10.0.0/16 --service-cidr=10.96.0.0/16`과 같이 클러스터 생성 시점에 지정된다. 이 값은 이후 변경이 매우 어렵다.

### Pod CIDR 할당 내부 메커니즘

kube-controller-manager의 `--cluster-cidr` 플래그(예: 10.10.0.0/16)는 클러스터 전체의 Pod 네트워크 대역을 지정한다. Node CIDR Allocator는 이 대역을 `--node-cidr-mask-size`(기본값: /24)로 분할하여 각 노드에 서브넷을 할당한다. platform 클러스터의 경우:

- 클러스터 CIDR: 10.10.0.0/16 (65,536개 IP)
- 노드당 CIDR: /24 (256개 IP, 이 중 약 250개를 Pod에 사용 가능)
- 최대 노드 수: 256개 (16비트 - 8비트 = 8비트, 2^8 = 256)

이 할당은 노드가 클러스터에 조인할 때 자동으로 이루어지며, `kubectl get node <name> -o jsonpath='{.spec.podCIDR}'`로 확인할 수 있다.

### 4개 클러스터 (kubeadm v1.31)

| 클러스터 | 노드 수 | Master 사양 | Worker 사양 | Pod CIDR | Service CIDR |
|----------|---------|------------|------------|----------|-------------|
| platform | 3 | 2 CPU / 4 GB | worker1: 3 CPU / 12 GB, worker2: 2 CPU / 8 GB | 10.10.0.0/16 | 10.96.0.0/16 |
| dev | 2 | 2 CPU / 4 GB | worker1: 2 CPU / 8 GB | 10.20.0.0/16 | 10.97.0.0/16 |
| staging | 2 | - | - | 10.30.0.0/16 | 10.98.0.0/16 |
| prod | 3 | 2 CPU / 3 GB | worker1: 2 CPU / 8 GB, worker2: 2 CPU / 8 GB | 10.40.0.0/16 | 10.99.0.0/16 |

- **SSH 접속**: `admin` / `admin`
- **kubeconfig 위치**: `kubeconfig/` 디렉토리

### 데모 애플리케이션 (dev 클러스터, demo 네임스페이스)

| 애플리케이션 | Replicas | 접근 방식 | 리소스 (Req → Lim) | 비고 |
|-------------|----------|----------|-------------------|------|
| nginx-web | 3 | NodePort 30080 | 50m/64Mi → 200m/128Mi | 메인 웹 서버 |
| httpbin v1 | 2 | ClusterIP | - | 카나리 배포 대상 |
| httpbin v2 | 1 | ClusterIP | - | 카나리 v2 (20% 트래픽) |
| redis | 1+ | ClusterIP | - | 캐시 |
| postgres | 1+ | ClusterIP | - | DB (pw=demo123) |
| rabbitmq | 1+ | ClusterIP | - | 메시지 큐 (user=demo/demo123) |
| keycloak | 1 | NodePort 30880 | - | 인증 서버 (probes 설정) |

### HPA 설정

| 대상 | Min | Max | CPU 임계값 | Scale Up | Scale Down |
|------|-----|-----|-----------|----------|------------|
| nginx-web | 3 | 10 | 50% | 2 pods / 15초 | stabilization 120초 |
| httpbin | 2 | 6 | 50% | - | stabilization 120초 |
| redis | 1 | 4 | 50% | - | stabilization 120초 |
| postgres | 1 | 4 | 50% | - | stabilization 120초 |
| rabbitmq | 1 | 3 | 50% | - | stabilization 120초 |

- nginx-web의 scaleUp 정책: 15초마다 최대 2개 Pod 추가, stabilization 30초

#### HPA 내부 동작 원리

HPA 컨트롤러는 기본 15초 간격으로 metrics-server에서 CPU/메모리 사용량을 조회한다. 목표 레플리카 수는 다음 공식으로 산출된다:

```
desiredReplicas = ceil(currentReplicas * (currentMetricValue / desiredMetricValue))
```

nginx-web의 경우 CPU 임계값이 50%이고 현재 3개 Pod의 평균 CPU가 75%라면: `ceil(3 * (75/50)) = ceil(4.5) = 5`가 되어 5개로 스케일 업한다. scaleUp 정책에 의해 15초당 최대 2개만 추가되므로, 3 -> 5로의 증가는 한 번의 조정 주기에 완료된다. stabilization window(30초)는 스케일 업 후 메트릭이 안정화되기를 기다리는 기간이다.

#### HPA 트러블슈팅: 흔한 장애 시나리오

| 증상 | 원인 | 해결 방법 |
|---|---|---|
| TARGETS에 `<unknown>/50%` 표시 | metrics-server가 메트릭을 수집하지 못한다 | `kubectl get apiservice v1beta1.metrics.k8s.io` 확인, metrics-server Pod 상태 확인 |
| TARGETS에 `0%/50%` 표시되나 스케일 다운 안 됨 | REPLICAS가 이미 MINPODS와 동일하다 | 정상 동작이다. minReplicas 이하로 줄어들지 않는다 |
| Pod CPU 100%인데 스케일 업 안 됨 | Pod에 `resources.requests.cpu`가 미설정이다 | HPA는 `averageUtilization` 계산 시 requests 기준을 사용하므로 반드시 설정해야 한다 |

### PDB 설정

| 대상 | minAvailable |
|------|-------------|
| nginx-web | 2 |
| httpbin, redis, postgres, rabbitmq | 1 |

#### PDB 등장 배경

PodDisruptionBudget(PDB)은 자발적 중단(voluntary disruption) 시 서비스 가용성을 보장하기 위해 도입되었다. 자발적 중단이란 `kubectl drain`, 클러스터 업그레이드, HPA 스케일 다운 등 관리자가 의도한 중단을 의미한다. PDB가 없으면 `kubectl drain` 실행 시 노드의 모든 Pod가 동시에 축출되어 서비스 중단이 발생할 수 있다. PDB는 최소 가용 Pod 수(minAvailable) 또는 최대 비가용 Pod 수(maxUnavailable)를 지정하여 이 문제를 해결한다.

nginx-web의 minAvailable=2는 어떤 상황에서도 최소 2개의 nginx-web Pod가 Running 상태를 유지해야 함을 의미한다. 3개 중 1개까지만 동시에 축출 가능하다.

#### PDB 장애 시나리오

PDB가 drain 작업을 차단하는 상황이 발생할 수 있다. 예를 들어 nginx-web의 replicas=2이고 minAvailable=2인 상태에서 `kubectl drain`을 실행하면, 어떤 Pod도 축출할 수 없어 drain이 무한 대기한다. 이 경우 `--timeout` 플래그로 대기 시간을 제한하거나, PDB를 임시로 삭제한 후 drain을 수행해야 한다. 비자발적 중단(involuntary disruption, 예: 노드 장애)에서는 PDB가 적용되지 않는다.

### 인프라 스택

| 구성 요소 | 세부 사항 |
|-----------|---------|
| **CNI** | Cilium (kubeProxyReplacement=true), CiliumNetworkPolicy 11개 (L7 포함) |
| **서비스 메시** | Istio (mTLS STRICT, 카나리 80/20, Circuit Breaker 3x5xx/30s, Gateway /api→httpbin /→nginx) |
| **스토리지** | local-path-provisioner, PVC: prometheus 10Gi, jenkins 5Gi |
| **모니터링** | Prometheus (보존 7일/10Gi), Grafana:30300, AlertManager:30903, Alert Rule 8개 |
| **CI/CD** | ArgoCD:30800 (auto-sync, prune, selfHeal, repo: github.com/iamywl/IaC_apple_sillicon.git), Jenkins:30900 (7-stage pipeline) |

#### Cilium kubeProxyReplacement 내부 동작 원리

전통적으로 Kubernetes Service 라우팅은 kube-proxy가 iptables 또는 IPVS 규칙을 생성하여 처리한다. 이 방식의 한계는 다음과 같다:

1. **iptables 확장성 문제**: Service와 Endpoint가 증가하면 iptables 규칙 수가 O(n)으로 증가하여 룰 매칭 시간이 선형적으로 늘어난다. 대규모 클러스터(Service 5000개 이상)에서 성능 저하가 발생한다.
2. **conntrack 테이블 포화**: iptables 기반 NAT는 conntrack 항목을 소비하며, 고트래픽 환경에서 conntrack 테이블이 가득 차면 새 연결이 드롭된다.
3. **업데이트 비효율**: iptables 규칙 변경 시 전체 테이블을 재작성하므로 지연이 발생한다.

Cilium의 kubeProxyReplacement=true는 eBPF(extended Berkeley Packet Filter)를 사용하여 커널 수준에서 직접 패킷을 처리한다. eBPF 프로그램은 XDP(eXpress Data Path) 또는 TC(Traffic Control) 훅에 부착되어 패킷이 네트워크 스택을 통과하기 전에 Service 라우팅을 수행한다. 이를 통해 iptables의 한계를 완전히 우회하고, O(1) 시간 복잡도로 Service 룩업을 수행한다. tart-infra의 모든 클러스터에서 kube-proxy가 설치되어 있지 않은 이유가 바로 이 설정 때문이다.

---

## 사전 준비

### kubeconfig 설정 및 클러스터 접근

#### kubeconfig 등장 배경

kubeconfig는 kubectl이 API Server에 접속하기 위한 인증 정보, 클러스터 주소, 컨텍스트를 하나의 파일에 통합하는 메커니즘이다. Kubernetes 초기에는 각 클러스터에 접속할 때마다 `--server`, `--certificate-authority`, `--client-certificate`, `--client-key` 등의 플래그를 매번 지정해야 했다. kubeconfig는 이 정보를 clusters, users, contexts 세 섹션으로 구조화하여 저장하고, `kubectl config use-context` 명령으로 클러스터 간 전환을 단순화한다.

#### 내부 동작 원리

`KUBECONFIG` 환경변수에 콜론(`:`)으로 구분된 여러 파일을 지정하면, kubectl은 이 파일들을 메모리 상에서 병합(merge)한다. 병합 규칙은 다음과 같다:

1. 동일한 이름의 cluster/user/context가 여러 파일에 존재하면, 먼저 나열된 파일의 값이 우선한다.
2. `current-context`는 마지막으로 설정된 값을 따른다.
3. 병합된 결과를 실제 파일로 저장하려면 `kubectl config view --merge --flatten > merged.yaml`을 사용한다.

tart-infra의 4개 클러스터에 접근하기 위해 kubeconfig를 설정하는 것이 모든 실습의 출발점이다.

```bash
# kubeconfig 디렉토리 확인
ls -la kubeconfig/

# KUBECONFIG 환경변수 설정 (여러 kubeconfig 병합)
export KUBECONFIG=kubeconfig/platform.yaml:kubeconfig/dev.yaml:kubeconfig/staging.yaml:kubeconfig/prod.yaml

# 사용 가능한 컨텍스트 확인
kubectl config get-contexts

# 출력 예시:
# CURRENT   NAME       CLUSTER    AUTHINFO       NAMESPACE
# *         platform   platform   platform-admin
#           dev        dev        dev-admin
#           staging    staging    staging-admin
#           prod       prod       prod-admin
```

### 클러스터별 노드 상태 확인

```bash
# 모든 클러스터의 노드 상태 일괄 확인
for ctx in platform dev staging prod; do
  echo "============================================"
  echo "  클러스터: $ctx"
  echo "============================================"
  kubectl --context=$ctx get nodes -o wide
  echo ""
done

# 출력 예시 (platform):
# NAME              STATUS   ROLES           AGE   VERSION   INTERNAL-IP    OS-IMAGE             KERNEL-VERSION   CONTAINER-RUNTIME
# platform-master   Ready    control-plane   30d   v1.31.x   192.168.x.10   Ubuntu 22.04 LTS     6.x.x            containerd://1.7.x
# platform-worker1  Ready    <none>          30d   v1.31.x   192.168.x.11   Ubuntu 22.04 LTS     6.x.x            containerd://1.7.x
# platform-worker2  Ready    <none>          30d   v1.31.x   192.168.x.12   Ubuntu 22.04 LTS     6.x.x            containerd://1.7.x
```

### SSH 접속 테스트

```bash
# master 노드에 SSH 접속 (admin/admin)
ssh admin@<platform-master-ip>

# 접속 후 kubelet 상태 확인
sudo systemctl status kubelet

# 컨테이너 런타임 상태 확인
sudo systemctl status containerd

# Static Pod 매니페스트 디렉토리 확인
ls -la /etc/kubernetes/manifests/

# 나가기
exit
```

### CKA 시험 팁 — 시작 전 필수 설정

CKA 시험 환경에서 반드시 설정해야 할 alias 및 자동완성 설정이다. 시험 시작 후 가장 먼저 수행하라.

```bash
# kubectl 자동완성 활성화
source <(kubectl completion bash)

# alias 설정
alias k=kubectl
complete -o default -F __start_kubectl k

# dry-run 출력을 위한 alias
alias kdr='kubectl --dry-run=client -o yaml'

# 빠른 컨텍스트 전환을 위한 alias
alias kctx='kubectl config use-context'
alias kns='kubectl config set-context --current --namespace'

# 자주 사용하는 출력 형식
export do="--dry-run=client -o yaml"
export now="--force --grace-period 0"

# vim 설정 (YAML 편집용)
cat >> ~/.vimrc << 'VIMEOF'
set tabstop=2
set shiftwidth=2
set expandtab
set autoindent
set number
VIMEOF
```

### 데모 앱 상태 확인

```bash
# dev 클러스터의 demo 네임스페이스 확인
kubectl --context=dev get all -n demo

# 출력 예시:
# NAME                             READY   STATUS    RESTARTS   AGE
# pod/nginx-web-xxxx-aaaa          1/1     Running   0          2d
# pod/nginx-web-xxxx-bbbb          1/1     Running   0          2d
# pod/nginx-web-xxxx-cccc          1/1     Running   0          2d
# pod/httpbin-v1-xxxx-aaaa         1/1     Running   0          2d
# pod/httpbin-v1-xxxx-bbbb         1/1     Running   0          2d
# pod/httpbin-v2-xxxx-aaaa         1/1     Running   0          2d
# pod/redis-xxxx-aaaa              1/1     Running   0          2d
# pod/postgres-xxxx-aaaa           1/1     Running   0          2d
# pod/rabbitmq-xxxx-aaaa           1/1     Running   0          2d
# pod/keycloak-xxxx-aaaa           1/1     Running   0          2d

# HPA 상태 확인
kubectl --context=dev get hpa -n demo

# PDB 상태 확인
kubectl --context=dev get pdb -n demo
```

---

## 실습 1: Cluster Architecture, Installation & Configuration (25%)

> CKA 시험의 25%를 차지하는 핵심 도메인이다. etcd 백업/복구, kubeadm 업그레이드, RBAC, kubeconfig 관리, 인증서 등이 출제 범위이다.

---

### Lab 1.1: 4개 클러스터 아키텍처 비교 분석

**학습 목표**: tart-infra의 4개 클러스터 구성을 비교하고, 각 클러스터의 역할과 리소스 배분을 이해한다.

**CKA 관련 도메인**: Cluster Architecture, Installation & Configuration (25%)

#### Step 1: 클러스터별 노드 리소스 비교

```bash
# 각 클러스터의 노드 수, CPU, 메모리 확인
for ctx in platform dev staging prod; do
  echo "============================================"
  echo "  클러스터: $ctx"
  echo "============================================"
  kubectl --context=$ctx get nodes -o custom-columns=\
'NAME:.metadata.name,STATUS:.status.conditions[-1].type,CPU:.status.capacity.cpu,MEMORY:.status.capacity.memory,PODS:.status.capacity.pods'
  echo ""
done
```

**기대 출력**:
```
============================================
  클러스터: platform
============================================
NAME              STATUS   CPU   MEMORY      PODS
platform-master   Ready    2     4Gi         110
platform-worker1  Ready    3     12Gi        110
platform-worker2  Ready    2     8Gi         110

============================================
  클러스터: dev
============================================
NAME          STATUS   CPU   MEMORY   PODS
dev-master    Ready    2     4Gi      110
dev-worker1   Ready    2     8Gi      110

============================================
  클러스터: prod
============================================
NAME           STATUS   CPU   MEMORY   PODS
prod-master    Ready    2     3Gi      110
prod-worker1   Ready    2     8Gi      110
prod-worker2   Ready    2     8Gi      110
```

#### Step 2: Pod CIDR 및 Service CIDR 확인

```bash
# Pod CIDR 확인 — 노드별 podCIDR
for ctx in platform dev staging prod; do
  echo "=== $ctx: Pod CIDR ==="
  kubectl --context=$ctx get nodes -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.podCIDR}{"\n"}{end}'
  echo ""
done

# Service CIDR 확인 — API Server 설정에서 확인
for ctx in platform dev staging prod; do
  echo "=== $ctx: Service CIDR ==="
  kubectl --context=$ctx cluster-info dump | grep -m 1 service-cluster-ip-range || \
  kubectl --context=$ctx get pod -n kube-system -l component=kube-apiserver -o yaml | grep service-cluster-ip-range
  echo ""
done
```

**기대 출력 (Pod CIDR)**:
```
=== platform: Pod CIDR ===
platform-master     10.10.0.0/24
platform-worker1    10.10.1.0/24
platform-worker2    10.10.2.0/24

=== dev: Pod CIDR ===
dev-master     10.20.0.0/24
dev-worker1    10.20.1.0/24

=== prod: Pod CIDR ===
prod-master     10.40.0.0/24
prod-worker1    10.40.1.0/24
prod-worker2    10.40.2.0/24
```

#### Step 3: 클러스터 버전 및 런타임 확인

```bash
# Kubernetes 버전 확인
for ctx in platform dev staging prod; do
  echo "=== $ctx ==="
  kubectl --context=$ctx version --short 2>/dev/null || kubectl --context=$ctx version -o yaml | grep -E "(gitVersion|platform)"
done

# 컨테이너 런타임 확인
for ctx in platform dev staging prod; do
  echo "=== $ctx: Container Runtime ==="
  kubectl --context=$ctx get nodes -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.status.nodeInfo.containerRuntimeVersion}{"\n"}{end}'
done
```

#### Step 4: 클러스터 아키텍처 요약 비교

```bash
# 전체 클러스터 비교 테이블 출력
echo "| 클러스터 | 노드수 | Kubernetes | Pod CIDR | Svc CIDR |"
echo "|----------|--------|------------|----------|----------|"
for ctx in platform dev staging prod; do
  NODE_COUNT=$(kubectl --context=$ctx get nodes --no-headers | wc -l)
  K8S_VER=$(kubectl --context=$ctx version -o json 2>/dev/null | grep -m1 gitVersion | awk -F'"' '{print $4}')
  echo "| $ctx | $NODE_COUNT | $K8S_VER | - | - |"
done
```

**확인 문제**:
1. platform 클러스터와 prod 클러스터의 총 CPU/메모리 차이는 얼마인가?
2. 각 클러스터의 Pod CIDR이 서로 겹치지 않는 이유는 무엇인가?
3. dev 클러스터는 워커 노드가 1개뿐인데, HA(고가용성) 관점에서 어떤 제약이 있는가?

---

### Lab 1.2: Control Plane 컴포넌트 상세 확인 (Static Pod)

**학습 목표**: 컨트롤 플레인의 4대 구성 요소(kube-apiserver, kube-controller-manager, kube-scheduler, etcd)가 Static Pod로 실행되는 방식을 이해한다.

**CKA 관련 도메인**: Cluster Architecture, Installation & Configuration (25%)

#### Step 1: 컨트롤 플레인 Pod 확인

```bash
# platform 클러스터의 kube-system 네임스페이스에서 컨트롤 플레인 Pod 확인
kubectl --context=platform get pods -n kube-system -o wide | grep -E "(apiserver|controller-manager|scheduler|etcd)"

# 출력 예시:
# etcd-platform-master                      1/1     Running   0   30d   192.168.x.10   platform-master
# kube-apiserver-platform-master             1/1     Running   0   30d   192.168.x.10   platform-master
# kube-controller-manager-platform-master    1/1     Running   0   30d   192.168.x.10   platform-master
# kube-scheduler-platform-master             1/1     Running   0   30d   192.168.x.10   platform-master
```

#### Step 2: SSH로 Static Pod 매니페스트 확인

```bash
# master 노드에 SSH 접속
ssh admin@<platform-master-ip>

# Static Pod 매니페스트 디렉토리 확인
ls -la /etc/kubernetes/manifests/

# 출력 예시:
# -rw------- 1 root root 3.8K  etcd.yaml
# -rw------- 1 root root 3.2K  kube-apiserver.yaml
# -rw------- 1 root root 2.9K  kube-controller-manager.yaml
# -rw------- 1 root root 1.4K  kube-scheduler.yaml

# kubelet 설정에서 staticPodPath 확인
sudo cat /var/lib/kubelet/config.yaml | grep staticPodPath
# 출력: staticPodPath: /etc/kubernetes/manifests
```

#### Step 3: kube-apiserver 설정 분석

```bash
# kube-apiserver의 주요 설정 플래그 확인
kubectl --context=platform -n kube-system get pod kube-apiserver-platform-master -o yaml | grep -A 80 "spec:" | grep -- "--"

# 주요 확인 항목:
# --advertise-address=192.168.x.10
# --service-cluster-ip-range=10.96.0.0/16       ← platform의 Service CIDR
# --etcd-servers=https://127.0.0.1:2379
# --tls-cert-file=/etc/kubernetes/pki/apiserver.crt
# --tls-private-key-file=/etc/kubernetes/pki/apiserver.key
# --client-ca-file=/etc/kubernetes/pki/ca.crt
# --kubelet-client-certificate=/etc/kubernetes/pki/apiserver-kubelet-client.crt
# --kubelet-client-key=/etc/kubernetes/pki/apiserver-kubelet-client.key
# --enable-admission-plugins=NodeRestriction
# --authorization-mode=Node,RBAC

# SSH 접속 상태에서 매니페스트 직접 확인
sudo cat /etc/kubernetes/manifests/kube-apiserver.yaml
```

#### Step 4: kube-controller-manager 설정 분석

```bash
# kube-controller-manager의 주요 설정 확인
kubectl --context=platform -n kube-system get pod kube-controller-manager-platform-master -o yaml | grep -- "--"

# 주요 확인 항목:
# --cluster-cidr=10.10.0.0/16                   ← platform의 Pod CIDR
# --service-cluster-ip-range=10.96.0.0/16       ← platform의 Service CIDR
# --cluster-signing-cert-file=/etc/kubernetes/pki/ca.crt
# --cluster-signing-key-file=/etc/kubernetes/pki/ca.key
# --controllers=*,bootstrapsigner,tokencleaner
# --leader-elect=true
# --use-service-account-credentials=true
```

#### Step 5: kube-scheduler 설정 분석

```bash
# kube-scheduler 설정 확인
kubectl --context=platform -n kube-system get pod kube-scheduler-platform-master -o yaml | grep -- "--"

# 주요 확인 항목:
# --authentication-kubeconfig=/etc/kubernetes/scheduler.conf
# --authorization-kubeconfig=/etc/kubernetes/scheduler.conf
# --bind-address=127.0.0.1
# --kubeconfig=/etc/kubernetes/scheduler.conf
# --leader-elect=true
```

#### Step 6: etcd 설정 분석

```bash
# etcd 설정 확인
kubectl --context=platform -n kube-system get pod etcd-platform-master -o yaml | grep -- "--"

# 주요 확인 항목:
# --data-dir=/var/lib/etcd
# --listen-client-urls=https://127.0.0.1:2379,https://192.168.x.10:2379
# --advertise-client-urls=https://192.168.x.10:2379
# --cert-file=/etc/kubernetes/pki/etcd/server.crt
# --key-file=/etc/kubernetes/pki/etcd/server.key
# --trusted-ca-file=/etc/kubernetes/pki/etcd/ca.crt
# --peer-cert-file=/etc/kubernetes/pki/etcd/peer.crt
# --peer-key-file=/etc/kubernetes/pki/etcd/peer.key
# --peer-trusted-ca-file=/etc/kubernetes/pki/etcd/ca.crt
```

**확인 문제**:
1. kube-apiserver의 `--service-cluster-ip-range` 값이 platform에서 `10.96.0.0/16`인데, dev 클러스터에서는 무엇인가?
2. Static Pod 매니페스트 파일을 수정하면 kubelet이 자동으로 변경을 감지하는가?
3. etcd의 `--data-dir`은 어디인가? 이 경로가 etcd 백업/복구 시 왜 중요한가?

---

### Lab 1.3: etcd 백업 실습 (ETCDCTL_API=3, 인증서 경로)

**학습 목표**: etcd 스냅샷을 생성하여 클러스터 데이터를 백업한다. CKA 시험에서 거의 매번 출제되는 필수 항목이다.

**CKA 관련 도메인**: Cluster Architecture, Installation & Configuration (25%)

#### 등장 배경

etcd는 Kubernetes 클러스터의 모든 상태(오브젝트 정의, 설정, Secret 등)를 저장하는 분산 키-값 저장소이다. etcd 데이터가 손실되면 클러스터 전체가 복구 불가능해진다. 따라서 주기적인 백업과 검증된 복원 절차가 필수이다.

etcd 백업에서 주의할 점은 다음과 같다:
- `ETCDCTL_API=3`을 반드시 지정해야 한다. etcd v2 API는 Kubernetes에서 사용하지 않으며, v2 API로 생성된 스냅샷은 v3 데이터를 포함하지 않는다.
- mTLS 인증서(CA, server cert, server key)가 필요하다. etcd는 TLS 클라이언트 인증을 강제하므로, 잘못된 인증서를 사용하면 `Error: context deadline exceeded` 오류가 발생한다.
- 스냅샷은 etcd의 특정 시점(point-in-time)의 전체 데이터를 포함한다. 스냅샷 생성 중에도 etcd는 읽기/쓰기를 계속 처리하며, 스냅샷은 consistent한 상태를 보장한다.

#### 내부 동작 원리

etcd 스냅샷의 내부 메커니즘은 다음과 같다:

1. `etcdctl snapshot save` 명령이 실행되면, etcd는 현재 boltdb 데이터베이스의 consistent snapshot을 생성한다.
2. boltdb는 B+ 트리 구조로 데이터를 저장하며, copy-on-write 메커니즘을 사용하므로 스냅샷 생성 중에도 쓰기 작업이 가능하다.
3. 스냅샷 파일에는 모든 키-값 쌍, 리비전 정보, 클러스터 멤버 정보가 포함된다.
4. 스냅샷의 HASH는 데이터 무결성 검증에 사용되며, `snapshot status` 명령으로 확인할 수 있다.

#### Step 1: etcd Pod에서 인증서 경로 확인

```bash
# etcd Pod의 YAML에서 인증서 관련 설정 추출
kubectl --context=platform -n kube-system get pod etcd-platform-master -o yaml | \
  grep -E "(--cert-file|--key-file|--trusted-ca-file|--listen-client-urls|--data-dir)"

# 출력 예시:
# - --cert-file=/etc/kubernetes/pki/etcd/server.crt
# - --key-file=/etc/kubernetes/pki/etcd/server.key
# - --trusted-ca-file=/etc/kubernetes/pki/etcd/ca.crt
# - --listen-client-urls=https://127.0.0.1:2379,https://192.168.x.10:2379
# - --data-dir=/var/lib/etcd
```

#### Step 2: SSH로 master 노드 접속 후 etcd 백업

```bash
# platform master 노드에 SSH 접속
ssh admin@<platform-master-ip>

# etcdctl 설치 확인
ETCDCTL_API=3 etcdctl version

# etcd 멤버 상태 확인
ETCDCTL_API=3 etcdctl \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key \
  member list -w table

# 출력 예시:
# +------------------+---------+------------------+-------------------------+-------------------------+------------+
# |        ID        | STATUS  |      NAME        |       PEER ADDRS        |      CLIENT ADDRS       | IS LEARNER |
# +------------------+---------+------------------+-------------------------+-------------------------+------------+
# | xxxxxxxxxxxxxxxx | started | platform-master  | https://192.168.x.10:... | https://192.168.x.10:... |      false |
# +------------------+---------+------------------+-------------------------+-------------------------+------------+
```

#### Step 3: etcd 스냅샷 생성

```bash
# 백업 디렉토리 생성
sudo mkdir -p /opt/etcd-backup

# etcd 스냅샷 저장
ETCDCTL_API=3 etcdctl snapshot save /opt/etcd-backup/etcd-snapshot-$(date +%Y%m%d-%H%M%S).db \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key

# 출력 예시:
# Snapshot saved at /opt/etcd-backup/etcd-snapshot-20260319-143022.db
```

#### Step 4: 백업 무결성 검증

```bash
# 스냅샷 상태 확인 (테이블 형식)
ETCDCTL_API=3 etcdctl snapshot status /opt/etcd-backup/etcd-snapshot-*.db --write-table

# 출력 예시:
# +----------+----------+------------+------------+
# |   HASH   | REVISION | TOTAL KEYS | TOTAL SIZE |
# +----------+----------+------------+------------+
# | 5d26cae3 |   125432 |       1287 |   4.2 MB   |
# +----------+----------+------------+------------+

# 스냅샷 파일 크기 확인
ls -lh /opt/etcd-backup/

# JSON 형식으로 상태 확인
ETCDCTL_API=3 etcdctl snapshot status /opt/etcd-backup/etcd-snapshot-*.db -w json | python3 -m json.tool
```

#### Step 5: CKA 시험용 간결한 백업 명령어

CKA 시험에서는 시간이 제한되어 있으므로 아래 한 줄 명령어를 기억하라.

```bash
# CKA 시험용 — 한 줄 백업 명령어
ETCDCTL_API=3 etcdctl snapshot save /tmp/etcd-backup.db \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key

# 검증
ETCDCTL_API=3 etcdctl snapshot status /tmp/etcd-backup.db --write-table
```

#### 트러블슈팅: etcd 백업 실패 시나리오

| 오류 메시지 | 원인 | 해결 방법 |
|---|---|---|
| `Error: context deadline exceeded` | 인증서 경로가 잘못되었거나, etcd 엔드포인트에 도달할 수 없다 | `--endpoints`, `--cacert`, `--cert`, `--key` 경로를 etcd Pod YAML에서 정확히 확인한다 |
| `Error: etcdserver: request timed out` | etcd 서버가 과부하 상태이다 | etcd 리더 상태를 확인하고, 부하가 낮은 시간에 재시도한다 |
| `Error: permission denied` | 스냅샷 저장 경로에 쓰기 권한이 없다 | `sudo`를 사용하거나 `/tmp` 등 쓰기 가능한 경로를 지정한다 |
| `bash: etcdctl: command not found` | etcdctl이 설치되어 있지 않다 | `apt install etcd-client` 또는 etcd 바이너리를 직접 다운로드한다 |

#### 장애 시나리오: 백업 없이 etcd 데이터 손실

etcd 데이터 디렉토리(`/var/lib/etcd`)가 삭제되면 다음과 같은 상황이 발생한다:

1. etcd Pod가 재시작되면 빈 데이터베이스로 시작한다.
2. kube-apiserver가 etcd에서 리소스를 조회하면 모든 리소스가 존재하지 않는다.
3. 모든 Deployment, Service, ConfigMap, Secret 등이 사라진다.
4. 실행 중인 Pod는 kubelet이 관리하므로 즉시 종료되지 않지만, ReplicaSet 컨트롤러가 해당 Pod를 인식하지 못하므로 새 Pod를 생성하지 않는다.
5. 백업 스냅샷이 없으면 클러스터 재구축이 필요하다.

이 시나리오가 etcd 백업의 중요성을 보여주는 핵심 사례이다.

**확인 문제**:
1. `ETCDCTL_API=3`을 설정하지 않으면 어떤 문제가 발생하는가?
2. etcd 인증서 경로를 모르는 경우, 어떤 명령어로 확인할 수 있는가?
3. 스냅샷의 `TOTAL KEYS`와 `REVISION`은 각각 무엇을 의미하는가?

**확인 문제 풀이**:
1. `ETCDCTL_API=3`을 설정하지 않으면 기본값인 API v2가 사용된다. Kubernetes의 모든 데이터는 etcd v3 API로 저장되므로, v2 API로 생성한 스냅샷에는 Kubernetes 데이터가 포함되지 않는다. 결과적으로 빈 스냅샷이 생성되어 복원 시 모든 데이터가 손실된다.
2. `kubectl -n kube-system get pod etcd-<master-node> -o yaml | grep -E '(--cert-file|--key-file|--trusted-ca-file|--listen-client)'` 또는 SSH로 접속하여 `cat /etc/kubernetes/manifests/etcd.yaml | grep -E '(cert|key|ca)'`로 확인한다.
3. `TOTAL KEYS`는 etcd에 저장된 전체 키-값 쌍의 수이다. Kubernetes의 모든 리소스(Pod, Service, ConfigMap 등)가 각각 하나의 키로 저장된다. `REVISION`은 etcd의 글로벌 리비전 카운터이다. 모든 트랜잭션(생성, 수정, 삭제)마다 1씩 증가하며, 이 값이 클수록 클러스터에서 더 많은 변경이 발생한 것이다.

---

### Lab 1.4: etcd 복구 실습

**학습 목표**: etcd 스냅샷에서 클러스터 데이터를 복구한다. 백업과 함께 CKA 시험의 단골 출제 항목이다.

**CKA 관련 도메인**: Cluster Architecture, Installation & Configuration (25%)

#### Step 1: 복구 전 현재 상태 기록

```bash
# 복구 전 현재 클러스터 상태를 기록해 둔다
ssh admin@<platform-master-ip>

# 현재 네임스페이스 목록
kubectl get namespaces > /tmp/before-restore-ns.txt
cat /tmp/before-restore-ns.txt

# 현재 Pod 목록
kubectl get pods --all-namespaces > /tmp/before-restore-pods.txt
```

#### Step 2: etcd 서비스 중지 및 복구

```bash
# 주의: 이 실습은 클러스터에 영향을 미치므로, platform 클러스터의 비사용 시간에 수행하라.

# 1. etcd Static Pod 매니페스트를 임시로 이동하여 etcd 중지
sudo mv /etc/kubernetes/manifests/etcd.yaml /tmp/etcd.yaml.bak

# 2. etcd가 중지되었는지 확인 (약 10초 대기)
sudo crictl ps | grep etcd
# 출력이 없으면 etcd가 중지된 것이다

# 3. 기존 etcd 데이터 디렉토리 백업
sudo mv /var/lib/etcd /var/lib/etcd.bak

# 4. 스냅샷에서 복구 (새로운 data-dir로)
ETCDCTL_API=3 etcdctl snapshot restore /opt/etcd-backup/etcd-snapshot-*.db \
  --data-dir=/var/lib/etcd

# 출력 예시:
# 2026-03-19T14:35:22Z	info	snapshot/v3_snapshot.go:XXX	restoring snapshot
# 2026-03-19T14:35:22Z	info	membership/cluster.go:XXX	added member
# 2026-03-19T14:35:22Z	info	snapshot/v3_snapshot.go:XXX	restored snapshot

# 5. etcd Static Pod 매니페스트 복원
sudo mv /tmp/etcd.yaml.bak /etc/kubernetes/manifests/etcd.yaml

# 6. etcd Pod가 재시작될 때까지 대기 (약 30초)
sudo crictl ps | grep etcd

# 7. API Server가 정상적으로 응답하는지 확인
kubectl get nodes
kubectl get pods -n kube-system
```

#### Step 3: 복구 후 검증

```bash
# 네임스페이스가 복원되었는지 확인
kubectl get namespaces

# Pod 상태 확인
kubectl get pods --all-namespaces

# 이전 기록과 비교
diff /tmp/before-restore-ns.txt <(kubectl get namespaces)
```

#### Step 4: etcd 복구 — CKA 시험에서의 포인트

```bash
# CKA 시험에서 etcd 복구 문제의 핵심 단계:
# 1. etcd Pod의 YAML에서 --data-dir 확인
kubectl -n kube-system get pod etcd-<node> -o yaml | grep data-dir

# 2. 스냅샷 복구
ETCDCTL_API=3 etcdctl snapshot restore /given/backup.db \
  --data-dir=/var/lib/etcd-restored

# 3. etcd.yaml 매니페스트에서 volumes.hostPath.path를 새 data-dir로 변경
sudo vi /etc/kubernetes/manifests/etcd.yaml
# volumes:
#   - hostPath:
#       path: /var/lib/etcd-restored    ← 이 경로를 변경
#       type: DirectoryOrCreate
#     name: etcd-data

# 4. kubelet이 변경을 감지하여 etcd Pod를 재생성할 때까지 대기
```

#### 내부 동작 원리: etcd 복구 메커니즘

etcd 스냅샷 복구의 내부 동작은 다음과 같다:

1. `etcdctl snapshot restore`는 스냅샷 파일에서 boltdb 데이터를 읽어 새 데이터 디렉토리에 복원한다.
2. 복원 과정에서 새로운 클러스터 ID와 멤버 ID가 생성된다. 이는 기존 클러스터와의 충돌을 방지하기 위함이다.
3. WAL(Write-Ahead Log) 파일도 새로 생성된다. WAL은 etcd의 트랜잭션 로그이며, 복구 시점 이후의 모든 변경 사항이 여기에 기록된다.
4. 기존 데이터 디렉토리(`/var/lib/etcd`)를 직접 덮어쓰면 클러스터 ID가 불일치하여 멤버 간 통신이 실패한다. 따라서 반드시 새 디렉토리에 복원한 후, etcd 매니페스트의 `--data-dir`과 `hostPath`를 변경해야 한다.

#### 트러블슈팅: 복구 후 흔한 문제

| 증상 | 원인 | 해결 방법 |
|---|---|---|
| etcd Pod가 CrashLoopBackOff | `--data-dir` 플래그와 `hostPath` 볼륨 경로가 불일치한다 | etcd.yaml에서 두 곳 모두 새 경로로 변경한다 |
| API Server 접근 불가 (connection refused) | etcd가 아직 시작되지 않았다 | `sudo crictl ps \| grep etcd`로 컨테이너 상태를 확인하고 30초~1분 대기한다 |
| 복구 후 최근 생성한 리소스가 없음 | 스냅샷이 생성된 시점 이후의 변경 사항은 복원되지 않는다 | 이는 정상 동작이다. 스냅샷은 특정 시점의 데이터만 포함한다 |
| etcd 로그에 "member not found" 오류 | 멀티 멤버 etcd 클러스터에서 단일 멤버만 복원하면 발생한다 | `--force-new-cluster` 플래그를 사용하여 단일 노드 클러스터로 재시작한다 |

**확인 문제**:
1. `etcdctl snapshot restore`의 `--data-dir` 플래그는 왜 필요한가?
2. 복구 후 etcd.yaml 매니페스트를 수정해야 하는 경우는 언제인가?
3. 복구 중 API Server가 응답하지 않는 것은 정상인가?

**확인 문제 풀이**:
1. `--data-dir`은 복원된 데이터를 저장할 새 디렉토리를 지정한다. 기존 데이터 디렉토리를 사용하면 클러스터 ID 충돌이 발생하여 etcd가 시작에 실패한다. 새 디렉토리를 사용하면 새로운 클러스터 ID로 깨끗하게 시작된다.
2. `--data-dir`을 기존 경로(`/var/lib/etcd`)와 다른 경로(예: `/var/lib/etcd-restored`)로 지정한 경우, etcd.yaml 매니페스트에서 `--data-dir` 인자값과 `volumes.hostPath.path` 값을 새 경로로 변경해야 한다.
3. 정상이다. etcd가 중지된 동안 kube-apiserver는 백엔드 스토리지에 접근할 수 없으므로 모든 API 요청이 실패한다. etcd가 재시작되면 API Server가 자동으로 재연결된다. 일반적으로 30초~1분 내에 복구된다.

---

### Lab 1.5: kubeconfig 관리 (4개 클러스터 컨텍스트 전환)

**학습 목표**: 4개 클러스터의 kubeconfig를 관리하고, 컨텍스트를 빠르게 전환하는 방법을 익힌다.

**CKA 관련 도메인**: Cluster Architecture, Installation & Configuration (25%)

#### Step 1: 현재 kubeconfig 구조 분석

```bash
# 현재 kubeconfig의 모든 컨텍스트 확인
kubectl config get-contexts

# 출력 예시:
# CURRENT   NAME       CLUSTER    AUTHINFO       NAMESPACE
# *         platform   platform   platform-admin
#           dev        dev        dev-admin
#           staging    staging    staging-admin
#           prod       prod       prod-admin

# 현재 활성 컨텍스트 확인
kubectl config current-context

# kubeconfig 전체 구조 확인 (민감 정보 마스킹)
kubectl config view
```

#### Step 2: 컨텍스트 전환 실습

```bash
# platform 클러스터로 전환
kubectl config use-context platform
kubectl get nodes
# platform-master, platform-worker1, platform-worker2

# dev 클러스터로 전환
kubectl config use-context dev
kubectl get nodes
# dev-master, dev-worker1

# staging 클러스터로 전환
kubectl config use-context staging
kubectl get nodes

# prod 클러스터로 전환
kubectl config use-context prod
kubectl get nodes
# prod-master, prod-worker1, prod-worker2

# 컨텍스트 전환 없이 특정 클러스터에 명령 실행
kubectl --context=dev get pods -n demo
kubectl --context=prod get pods --all-namespaces
```

#### Step 3: 기본 네임스페이스 설정

```bash
# dev 컨텍스트의 기본 네임스페이스를 demo로 변경
kubectl config set-context dev --namespace=demo

# 확인 — 이제 -n demo 없이도 demo 네임스페이스의 리소스를 볼 수 있다
kubectl config use-context dev
kubectl get pods
# demo 네임스페이스의 Pod 목록이 출력된다

# 기본 네임스페이스를 default로 복원
kubectl config set-context dev --namespace=default
```

#### Step 4: 새로운 kubeconfig 수동 생성

```bash
# dev 클러스터의 CA 인증서 추출
kubectl --context=dev config view --raw -o jsonpath='{.clusters[?(@.name=="dev")].cluster.certificate-authority-data}' | base64 -d > /tmp/dev-ca.crt

# API Server 주소 확인
DEV_SERVER=$(kubectl --context=dev config view -o jsonpath='{.clusters[?(@.name=="dev")].cluster.server}')
echo "Dev API Server: $DEV_SERVER"

# 새 kubeconfig 파일 생성
kubectl config set-cluster dev-new \
  --server=$DEV_SERVER \
  --certificate-authority=/tmp/dev-ca.crt \
  --embed-certs=true \
  --kubeconfig=/tmp/dev-new.kubeconfig

kubectl config set-credentials dev-reader \
  --token=$(kubectl --context=dev create token default -n demo --duration=24h) \
  --kubeconfig=/tmp/dev-new.kubeconfig

kubectl config set-context dev-reader-context \
  --cluster=dev-new \
  --user=dev-reader \
  --namespace=demo \
  --kubeconfig=/tmp/dev-new.kubeconfig

kubectl config use-context dev-reader-context \
  --kubeconfig=/tmp/dev-new.kubeconfig

# 테스트
kubectl --kubeconfig=/tmp/dev-new.kubeconfig get pods
```

#### Step 5: kubeconfig 병합

```bash
# 여러 kubeconfig 파일 병합
KUBECONFIG=kubeconfig/platform.yaml:kubeconfig/dev.yaml \
  kubectl config view --merge --flatten > /tmp/merged.kubeconfig

# 병합된 kubeconfig 확인
kubectl --kubeconfig=/tmp/merged.kubeconfig config get-contexts
```

#### kubeconfig 트러블슈팅

kubeconfig 관련 흔한 오류와 해결 방법:

| 오류 메시지 | 원인 | 해결 방법 |
|---|---|---|
| `error: no configuration has been provided` | KUBECONFIG 경로가 잘못되었거나 파일이 존재하지 않는다 | `echo $KUBECONFIG`로 경로 확인, `ls`로 파일 존재 확인 |
| `Unable to connect to the server: dial tcp <ip>: connect: connection refused` | API Server가 다운되었거나 IP/포트가 잘못되었다 | kubeconfig의 `server` 필드 확인, API Server Pod 상태 확인 |
| `error: context "xxx" does not exist` | 컨텍스트 이름 오타이다 | `kubectl config get-contexts`로 정확한 이름 확인 |
| `Unable to connect to the server: x509: certificate signed by unknown authority` | CA 인증서가 일치하지 않는다 | kubeconfig의 `certificate-authority-data` 확인, 올바른 CA 인증서로 교체 |
| `error: You must be logged in to the server (Unauthorized)` | 사용자 인증 정보(토큰, 인증서)가 만료되었거나 잘못되었다 | 토큰 재생성 또는 사용자 인증서 갱신 |

**확인 문제**:
1. CKA 시험에서 `kubectl config use-context` 명령을 자주 사용하는 이유는 무엇인가?
2. `--embed-certs=true`와 `--certificate-authority` 파일 참조 방식의 차이는 무엇인가?
3. kubeconfig 파일에서 `clusters`, `users`, `contexts` 세 섹션의 역할은 각각 무엇인가?

**확인 문제 풀이**:
1. CKA 시험은 여러 클러스터를 대상으로 한다. 각 문제마다 다른 클러스터에서 작업해야 하며, 문제 상단에 `kubectl config use-context <context-name>` 명령이 제시된다. 이 명령을 실행하지 않고 다른 클러스터에서 작업하면 채점 시 0점 처리된다. 시험에서 가장 흔한 실수 중 하나가 컨텍스트 전환을 잊는 것이다.
2. `--embed-certs=true`는 인증서 파일의 내용을 base64로 인코딩하여 kubeconfig 파일 내에 인라인으로 포함시킨다. 이 경우 kubeconfig 파일 하나만 복사하면 모든 인증 정보가 함께 이동한다. `--certificate-authority`는 인증서 파일의 경로만 참조한다. 이 경우 kubeconfig 파일과 인증서 파일을 함께 관리해야 한다. 이동성(portability)을 위해 `--embed-certs=true`가 권장된다.
3. **clusters**: API Server의 주소(`server`)와 CA 인증서(`certificate-authority-data`)를 저장한다. "어디에 연결할 것인가"를 정의한다. **users**: 인증 정보(클라이언트 인증서, 토큰, exec 플러그인 등)를 저장한다. "누구로 연결할 것인가"를 정의한다. **contexts**: cluster + user의 조합에 기본 네임스페이스를 추가한 것이다. "어느 클러스터에 누구로 연결하여 어떤 네임스페이스를 기본으로 사용할 것인가"를 정의한다. `kubectl config use-context`로 활성 context를 전환한다.

---

### Lab 1.6: RBAC — read-only Role 생성

**학습 목표**: dev 클러스터에서 읽기 전용 Role과 RoleBinding을 생성하여 특정 사용자에게 제한된 권한을 부여한다.

**CKA 관련 도메인**: Cluster Architecture, Installation & Configuration (25%)

#### 등장 배경

Kubernetes의 인증(Authentication)과 인가(Authorization)는 분리되어 있다. 인증은 "누구인지" 확인하고, 인가는 "무엇을 할 수 있는지" 결정한다. RBAC(Role-Based Access Control)은 Kubernetes의 기본 인가 방식이다.

RBAC 이전에는 ABAC(Attribute-Based Access Control)이 사용되었으나, 정책 파일을 수정하려면 kube-apiserver를 재시작해야 했다. RBAC은 Kubernetes API를 통해 동적으로 권한을 관리할 수 있어 ABAC을 대체했다.

#### 내부 동작 원리

RBAC의 인가 과정은 다음과 같다:

1. 사용자(또는 ServiceAccount)가 API 요청을 보낸다.
2. kube-apiserver의 인증 단계에서 요청자의 신원(identity)이 확인된다.
3. 인가 단계에서 RBAC authorizer가 요청의 {verb, resource, namespace}를 추출한다.
4. RBAC authorizer는 요청자에게 바인딩된 모든 Role/ClusterRole의 rules를 검사한다.
5. 하나라도 일치하는 규칙이 있으면 요청을 허용한다. 일치하는 규칙이 없으면 거부한다.
6. RBAC은 **누적적(additive)** 이다. "거부" 규칙은 존재하지 않으며, 권한은 추가만 가능하다.

RBAC의 네 가지 리소스는 다음과 같다:
- **Role**: 네임스페이스 범위의 권한 정의이다.
- **ClusterRole**: 클러스터 범위의 권한 정의이다. 네임스페이스에 속하지 않는 리소스(Node, PV 등)에도 사용한다.
- **RoleBinding**: Role을 사용자/그룹/ServiceAccount에 연결한다. 특정 네임스페이스에서만 유효하다.
- **ClusterRoleBinding**: ClusterRole을 사용자/그룹/ServiceAccount에 연결한다. 모든 네임스페이스에서 유효하다.

#### Step 1: 기존 RBAC 확인

```bash
# 현재 ClusterRole 확인
kubectl --context=dev get clusterroles | head -20

# 현재 ClusterRoleBinding 확인
kubectl --context=dev get clusterrolebindings | head -20

# 특정 ClusterRole의 권한 확인 (예: view)
kubectl --context=dev describe clusterrole view

# demo 네임스페이스의 Role 확인
kubectl --context=dev get roles -n demo
kubectl --context=dev get rolebindings -n demo
```

#### Step 2: read-only Role 생성 (명령형)

```bash
# demo 네임스페이스에 read-only Role 생성
kubectl --context=dev create role demo-reader \
  --verb=get,list,watch \
  --resource=pods,services,deployments,configmaps \
  -n demo

# Role 확인
kubectl --context=dev get role demo-reader -n demo -o yaml

# 출력 예시:
# apiVersion: rbac.authorization.k8s.io/v1
# kind: Role
# metadata:
#   name: demo-reader
#   namespace: demo
# rules:
# - apiGroups: [""]
#   resources: ["pods", "services", "configmaps"]
#   verbs: ["get", "list", "watch"]
# - apiGroups: ["apps"]
#   resources: ["deployments"]
#   verbs: ["get", "list", "watch"]
```

#### Step 3: RoleBinding 생성

```bash
# dev-user라는 사용자에게 demo-reader Role 바인딩
kubectl --context=dev create rolebinding demo-reader-binding \
  --role=demo-reader \
  --user=dev-user \
  -n demo

# RoleBinding 확인
kubectl --context=dev describe rolebinding demo-reader-binding -n demo
```

#### Step 4: 권한 테스트 (can-i)

```bash
# dev-user가 demo 네임스페이스에서 Pod를 조회할 수 있는지 확인
kubectl --context=dev auth can-i get pods --as=dev-user -n demo
# 출력: yes

# dev-user가 demo 네임스페이스에서 Pod를 삭제할 수 있는지 확인
kubectl --context=dev auth can-i delete pods --as=dev-user -n demo
# 출력: no

# dev-user가 demo 네임스페이스에서 Deployment를 생성할 수 있는지 확인
kubectl --context=dev auth can-i create deployments --as=dev-user -n demo
# 출력: no

# dev-user가 kube-system 네임스페이스에서 Pod를 조회할 수 있는지 확인
kubectl --context=dev auth can-i get pods --as=dev-user -n kube-system
# 출력: no (Role은 demo 네임스페이스에만 적용)

# dev-user의 전체 권한 확인
kubectl --context=dev auth can-i --list --as=dev-user -n demo
```

#### Step 5: YAML로 Role 생성 (선언형)

```bash
# 좀 더 세밀한 Role 정의
kubectl --context=dev apply -f - <<EOF
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: demo-viewer-extended
  namespace: demo
rules:
- apiGroups: [""]
  resources: ["pods", "pods/log", "services", "endpoints", "configmaps", "events"]
  verbs: ["get", "list", "watch"]
- apiGroups: ["apps"]
  resources: ["deployments", "replicasets", "daemonsets", "statefulsets"]
  verbs: ["get", "list", "watch"]
- apiGroups: ["autoscaling"]
  resources: ["horizontalpodautoscalers"]
  verbs: ["get", "list", "watch"]
- apiGroups: ["policy"]
  resources: ["poddisruptionbudgets"]
  verbs: ["get", "list", "watch"]
EOF

# 확인
kubectl --context=dev describe role demo-viewer-extended -n demo
```

**확인 문제**:
1. Role과 ClusterRole의 차이점은 무엇인가?
2. `kubectl auth can-i --as=` 플래그는 어떤 Kubernetes 기능을 사용하는가?
3. `pods/log` 리소스를 별도로 지정해야 하는 이유는 무엇인가?

**확인 문제 풀이**:
1. Role은 네임스페이스 범위(namespace-scoped) 리소스이다. 특정 네임스페이스 내의 리소스(Pod, Service, Deployment 등)에 대한 권한만 정의할 수 있다. ClusterRole은 클러스터 범위(cluster-scoped) 리소스이다. 네임스페이스에 속하지 않는 리소스(Node, PersistentVolume, Namespace 등)에 대한 권한을 정의할 수 있으며, 모든 네임스페이스에 걸쳐 적용할 수도 있다. ClusterRole을 RoleBinding으로 바인딩하면 특정 네임스페이스에서만 유효하고, ClusterRoleBinding으로 바인딩하면 모든 네임스페이스에서 유효하다.
2. `--as=` 플래그는 Kubernetes의 **User Impersonation** 기능을 사용한다. kube-apiserver의 `--proxy-client-cert-file` 및 관련 설정에 의해 지원되는 이 기능은, 현재 사용자가 다른 사용자의 관점에서 권한을 확인할 수 있게 한다. RBAC 정책을 테스트할 때 실제로 해당 사용자로 로그인하지 않고도 권한을 검증할 수 있다. `--as=system:serviceaccount:<ns>:<sa>` 형식으로 ServiceAccount의 권한도 확인할 수 있다.
3. Kubernetes API에서 `pods`와 `pods/log`는 서로 다른 서브리소스(subresource)이다. `pods`에 대한 `get` 권한은 Pod의 메타데이터와 스펙을 조회할 수 있게 하지만, 컨테이너 로그에 접근하는 것은 `pods/log` 서브리소스에 대한 별도 권한이 필요하다. 이는 최소 권한 원칙에 따른 것이다. 마찬가지로 `pods/exec`(kubectl exec), `pods/portforward`(포트 포워딩), `pods/attach`(컨테이너 attach)도 별도 서브리소스이다.

---

### Lab 1.7: RBAC — 특정 리소스에 대한 권한 부여

**학습 목표**: 특정 리소스에 대한 세밀한 RBAC 권한을 설정하고, ClusterRole과 ClusterRoleBinding을 활용한다.

**CKA 관련 도메인**: Cluster Architecture, Installation & Configuration (25%)

#### Step 1: 네임스페이스 한정 관리자 Role 생성

```bash
# demo 네임스페이스의 Deployment와 Service를 관리할 수 있는 Role
kubectl --context=dev create role demo-deployer \
  --verb=get,list,watch,create,update,patch,delete \
  --resource=deployments,services \
  -n demo

# 확인
kubectl --context=dev describe role demo-deployer -n demo
```

#### Step 2: 클러스터 범위 읽기 전용 ClusterRole 생성

```bash
# 모든 네임스페이스에서 노드와 PV를 조회할 수 있는 ClusterRole
kubectl --context=dev create clusterrole node-viewer \
  --verb=get,list,watch \
  --resource=nodes,persistentvolumes

# ClusterRoleBinding 생성
kubectl --context=dev create clusterrolebinding node-viewer-binding \
  --clusterrole=node-viewer \
  --user=infra-user

# 권한 테스트
kubectl --context=dev auth can-i get nodes --as=infra-user
# 출력: yes

kubectl --context=dev auth can-i delete nodes --as=infra-user
# 출력: no
```

#### Step 3: 특정 리소스 이름에 대한 권한 제한

```bash
# nginx-web Deployment에만 접근할 수 있는 Role
kubectl --context=dev apply -f - <<EOF
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: nginx-manager
  namespace: demo
rules:
- apiGroups: ["apps"]
  resources: ["deployments"]
  resourceNames: ["nginx-web"]
  verbs: ["get", "list", "watch", "update", "patch"]
- apiGroups: [""]
  resources: ["pods"]
  verbs: ["get", "list", "watch"]
EOF

# RoleBinding
kubectl --context=dev create rolebinding nginx-manager-binding \
  --role=nginx-manager \
  --user=nginx-admin \
  -n demo

# 테스트
kubectl --context=dev auth can-i update deployments/nginx-web --as=nginx-admin -n demo
# 출력: yes

kubectl --context=dev auth can-i update deployments/httpbin-v1 --as=nginx-admin -n demo
# 출력: no
```

#### Step 4: ServiceAccount에 권한 부여

```bash
# 모니터링용 ServiceAccount 생성
kubectl --context=dev create serviceaccount monitoring-sa -n demo

# ClusterRole 바인딩 (기존 view ClusterRole 활용)
kubectl --context=dev create clusterrolebinding monitoring-sa-view \
  --clusterrole=view \
  --serviceaccount=demo:monitoring-sa

# 권한 테스트
kubectl --context=dev auth can-i get pods --as=system:serviceaccount:demo:monitoring-sa --all-namespaces
# 출력: yes

kubectl --context=dev auth can-i delete pods --as=system:serviceaccount:demo:monitoring-sa -n demo
# 출력: no
```

#### Step 5: 정리

```bash
# 생성한 RBAC 리소스 정리
kubectl --context=dev delete role demo-reader demo-deployer demo-viewer-extended nginx-manager -n demo
kubectl --context=dev delete rolebinding demo-reader-binding nginx-manager-binding -n demo
kubectl --context=dev delete clusterrole node-viewer
kubectl --context=dev delete clusterrolebinding node-viewer-binding monitoring-sa-view
kubectl --context=dev delete serviceaccount monitoring-sa -n demo
```

**확인 문제**:
1. `resourceNames` 필드를 사용하면 어떤 수준의 접근 제어가 가능한가?
2. ServiceAccount에 ClusterRole을 바인딩할 때 `--serviceaccount` 형식은 `namespace:name`이다. 왜 네임스페이스가 필요한가?
3. RBAC 정책이 누적(additive)되는 방식이란 무엇을 의미하는가?

**확인 문제 풀이**:
1. `resourceNames` 필드는 특정 이름의 리소스에만 접근을 허용하는 인스턴스 수준(instance-level)의 접근 제어를 제공한다. 예를 들어 `resources: ["deployments"], resourceNames: ["nginx-web"]`은 모든 Deployment가 아닌 `nginx-web`이라는 이름의 Deployment에만 접근을 허용한다. 단, `resourceNames`를 사용할 때 `list` verb는 의미가 없다. list는 이름을 모르는 상태에서 조회하는 것이므로, 이름을 지정하는 것과 모순된다.
2. ServiceAccount는 네임스페이스에 종속된 리소스이다. 같은 이름의 ServiceAccount가 서로 다른 네임스페이스에 존재할 수 있으므로, 어떤 네임스페이스의 ServiceAccount인지 명시해야 한다. 형식은 `namespace:name`이며, API에서는 `system:serviceaccount:<namespace>:<name>` 형태의 전체 이름(fully qualified name)으로 식별된다.
3. RBAC은 "거부(deny)" 규칙이 존재하지 않는다. 모든 규칙은 "허용(allow)"만 가능하며, 여러 Role/ClusterRole이 바인딩되면 허용 규칙이 합산(additive)된다. 예를 들어 Role A가 `pods: get,list`를 허용하고 Role B가 `pods: delete`를 허용하면, 사용자는 `pods: get,list,delete` 권한을 가진다. 특정 권한을 제거하려면 해당 Role/RoleBinding을 삭제해야 한다.

---

### Lab 1.8: ServiceAccount 생성 및 Pod 연결

**학습 목표**: ServiceAccount를 생성하고 Pod에 연결하여, Pod 내부에서 Kubernetes API에 접근하는 방법을 이해한다.

**CKA 관련 도메인**: Cluster Architecture, Installation & Configuration (25%)

#### 등장 배경

ServiceAccount는 Pod 내부에서 실행되는 프로세스의 신원(identity)을 나타낸다. 사람 사용자와 달리, ServiceAccount는 네임스페이스에 종속되며 Kubernetes API에 의해 관리된다.

Kubernetes 1.24 이전에는 ServiceAccount를 생성하면 자동으로 Secret이 생성되어 영구 토큰이 발급되었다. 이 방식의 문제점은 다음과 같았다:
- 토큰이 만료되지 않아 유출 시 영구적인 보안 위험이 된다.
- Secret이 불필요하게 많이 생성되어 etcd 저장 공간을 소비한다.
- 토큰 폐기(revocation) 메커니즘이 없다.

Kubernetes 1.24 이후에는 `TokenRequest API`를 통해 시간 제한이 있는 바운드 토큰(bound token)을 발급한다. kubelet은 Pod 생성 시 projected volume을 통해 1시간 유효의 토큰을 자동으로 마운트하고, 만료 전에 자동 갱신한다. `kubectl create token` 명령으로 수동 발급도 가능하다.

#### 내부 동작 원리

Pod에 ServiceAccount가 연결되면 다음 과정이 발생한다:

1. kubelet이 TokenRequest API를 호출하여 바운드 토큰을 발급받는다.
2. 토큰, CA 인증서, 네임스페이스 정보를 projected volume으로 마운트한다.
3. 마운트 경로: `/var/run/secrets/kubernetes.io/serviceaccount/`
4. 마운트 파일: `token`(JWT 토큰), `ca.crt`(CA 인증서), `namespace`(현재 네임스페이스)
5. Pod 내부 프로세스는 이 토큰을 사용하여 `https://kubernetes.default.svc`로 API를 호출한다.
6. 토큰은 기본 1시간 유효이며, kubelet이 만료 80% 시점에 자동 갱신한다.

#### Step 1: ServiceAccount 생성

```bash
# demo 네임스페이스에 ServiceAccount 생성
kubectl --context=dev create serviceaccount app-sa -n demo

# 생성 확인
kubectl --context=dev get serviceaccounts -n demo

# ServiceAccount 상세 정보
kubectl --context=dev describe serviceaccount app-sa -n demo
```

#### Step 2: ServiceAccount 토큰 생성 (Kubernetes 1.24+)

```bash
# 시간 제한 토큰 생성 (1시간)
kubectl --context=dev create token app-sa -n demo --duration=1h

# 24시간 유효 토큰
TOKEN=$(kubectl --context=dev create token app-sa -n demo --duration=24h)
echo $TOKEN

# Secret 기반 영구 토큰 생성 (레거시 방식)
kubectl --context=dev apply -f - <<EOF
apiVersion: v1
kind: Secret
metadata:
  name: app-sa-token
  namespace: demo
  annotations:
    kubernetes.io/service-account.name: app-sa
type: kubernetes.io/service-account-token
EOF

# 토큰 확인
kubectl --context=dev get secret app-sa-token -n demo -o jsonpath='{.data.token}' | base64 -d
echo ""
```

#### Step 3: Pod에 ServiceAccount 연결

```bash
# ServiceAccount를 사용하는 Pod 생성
kubectl --context=dev apply -f - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: sa-test-pod
  namespace: demo
spec:
  serviceAccountName: app-sa
  containers:
  - name: kubectl
    image: bitnami/kubectl:1.31
    command: ["sleep", "3600"]
EOF

# Pod가 Running 상태인지 확인
kubectl --context=dev get pod sa-test-pod -n demo

# Pod 내부에서 ServiceAccount 토큰 확인
kubectl --context=dev exec -it sa-test-pod -n demo -- cat /var/run/secrets/kubernetes.io/serviceaccount/token
echo ""

# Pod 내부에서 CA 인증서 확인
kubectl --context=dev exec -it sa-test-pod -n demo -- cat /var/run/secrets/kubernetes.io/serviceaccount/ca.crt

# Pod 내부에서 네임스페이스 확인
kubectl --context=dev exec -it sa-test-pod -n demo -- cat /var/run/secrets/kubernetes.io/serviceaccount/namespace
```

#### Step 4: Pod 내부에서 API 호출 테스트

```bash
# Pod 내부에서 Kubernetes API에 접근 (권한이 없으므로 403 에러 예상)
kubectl --context=dev exec -it sa-test-pod -n demo -- \
  kubectl get pods -n demo 2>&1 || true

# app-sa에 권한 부여
kubectl --context=dev create role app-pod-reader \
  --verb=get,list \
  --resource=pods \
  -n demo

kubectl --context=dev create rolebinding app-pod-reader-binding \
  --role=app-pod-reader \
  --serviceaccount=demo:app-sa \
  -n demo

# 다시 시도 — 이제 Pod 목록이 출력된다
kubectl --context=dev exec -it sa-test-pod -n demo -- \
  kubectl get pods -n demo
```

#### Step 5: automountServiceAccountToken 비활성화

```bash
# 보안을 위해 ServiceAccount 토큰 자동 마운트 비활성화
kubectl --context=dev apply -f - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: no-sa-pod
  namespace: demo
spec:
  automountServiceAccountToken: false
  containers:
  - name: app
    image: nginx:1.25
EOF

# 토큰이 마운트되지 않았는지 확인
kubectl --context=dev exec no-sa-pod -n demo -- ls /var/run/secrets/kubernetes.io/serviceaccount/ 2>&1
# 출력: ls: /var/run/secrets/kubernetes.io/serviceaccount/: No such file or directory
```

#### Step 6: 정리

```bash
kubectl --context=dev delete pod sa-test-pod no-sa-pod -n demo
kubectl --context=dev delete role app-pod-reader -n demo
kubectl --context=dev delete rolebinding app-pod-reader-binding -n demo
kubectl --context=dev delete secret app-sa-token -n demo
kubectl --context=dev delete serviceaccount app-sa -n demo
```

**확인 문제**:
1. Kubernetes 1.24 이후 ServiceAccount 토큰 관리 방식이 어떻게 변경되었는가?
2. `automountServiceAccountToken: false`를 설정하는 보안상 이유는 무엇인가?
3. Pod 내부에서 `/var/run/secrets/kubernetes.io/serviceaccount/` 경로에 마운트되는 3가지 파일은 무엇인가?

**확인 문제 풀이**:
1. Kubernetes 1.24 이전에는 ServiceAccount를 생성하면 자동으로 Secret이 생성되어 **영구 토큰**이 발급되었다. 1.24 이후에는 자동 Secret 생성이 제거되었다. 대신 **TokenRequest API**를 통해 시간 제한이 있는 바운드 토큰(bound token)을 발급한다. kubelet은 Pod 생성 시 projected volume을 통해 기본 1시간 유효의 토큰을 자동 마운트하고, 만료 전에 자동 갱신한다. 수동으로 토큰을 생성하려면 `kubectl create token <sa-name> --duration=<time>`을 사용한다. 영구 토큰이 필요한 경우(비권장), `kubernetes.io/service-account-token` 타입의 Secret을 수동으로 생성할 수 있다.
2. 기본적으로 모든 Pod에는 `default` ServiceAccount의 토큰이 자동 마운트된다. 이 토큰은 Kubernetes API에 인증할 수 있으므로, Pod가 침해되면 공격자가 이 토큰을 사용하여 API Server에 접근할 수 있다. `automountServiceAccountToken: false`를 설정하면 토큰이 마운트되지 않아, 침해된 Pod에서 API Server에 접근하는 것을 방지한다. 특히 API Server에 접근할 필요가 없는 일반 애플리케이션 Pod에는 이 설정을 적용하는 것이 보안 모범 사례이다.
3. (1) `token`: ServiceAccount의 JWT(JSON Web Token)이다. API Server에 인증할 때 Bearer 토큰으로 사용된다. projected volume을 통해 마운트되며 주기적으로 갱신된다. (2) `ca.crt`: 클러스터의 CA 인증서이다. Pod에서 API Server에 HTTPS 연결 시 서버 인증서를 검증하는 데 사용된다. (3) `namespace`: 현재 Pod가 속한 네임스페이스 이름이 평문으로 저장되어 있다. 클라이언트 라이브러리가 API 호출 시 기본 네임스페이스로 사용한다.

---

### Lab 1.9: 인증서 만료 확인 (kubeadm certs check-expiration)

**학습 목표**: 클러스터 인증서의 만료 상태를 확인하고, 갱신 절차를 이해한다.

**CKA 관련 도메인**: Cluster Architecture, Installation & Configuration (25%)

#### 등장 배경

Kubernetes는 모든 컴포넌트 간 통신에 mTLS(mutual TLS)를 사용한다. 총 10여 개의 인증서가 클러스터에 존재하며, 각각의 역할은 다음과 같다:

| 인증서 | 용도 | 기본 유효 기간 |
|---|---|---|
| `ca.crt`/`ca.key` | 클러스터 루트 CA. 모든 다른 인증서의 서명에 사용된다 | 10년 |
| `apiserver.crt` | kube-apiserver의 서버 인증서. 클라이언트가 API Server를 신뢰하는 데 사용된다 | 1년 |
| `apiserver-kubelet-client.crt` | kube-apiserver가 kubelet에 접속할 때 사용하는 클라이언트 인증서 | 1년 |
| `apiserver-etcd-client.crt` | kube-apiserver가 etcd에 접속할 때 사용하는 클라이언트 인증서 | 1년 |
| `etcd/server.crt` | etcd의 서버 인증서 | 1년 |
| `etcd/peer.crt` | etcd 멤버 간 통신에 사용되는 피어 인증서 | 1년 |
| `front-proxy-ca.crt` | API aggregation layer의 CA 인증서 | 10년 |
| `front-proxy-client.crt` | aggregated API server에 접속하는 클라이언트 인증서 | 1년 |

kubeadm으로 설치한 클러스터에서 인증서 유효 기간은 기본 1년이며, CA 인증서는 10년이다. 인증서가 만료되면 해당 통신 경로가 완전히 차단된다.

#### 인증서 만료 시 장애 시나리오

| 만료된 인증서 | 발생하는 장애 |
|---|---|
| `apiserver.crt` | kubectl 명령 실패: `x509: certificate has expired` |
| `apiserver-kubelet-client.crt` | `kubectl logs`, `kubectl exec` 실패 (API Server → kubelet 통신 불가) |
| `apiserver-etcd-client.crt` | 모든 API 요청 실패 (API Server → etcd 통신 불가) |
| `etcd/server.crt` | etcd 클라이언트 연결 실패, 클러스터 전체 마비 |
| kubelet 클라이언트 인증서 | 해당 노드가 NotReady 상태로 전환 |

kubeadm 1.8 이후 `kubeadm upgrade`를 실행하면 인증서가 자동 갱신된다. 그러나 업그레이드 없이 1년 이상 운영하면 인증서가 만료될 수 있다. `kubeadm certs check-expiration`으로 주기적 확인이 필수이다.

#### Step 1: kubeadm으로 인증서 만료일 일괄 확인

```bash
# platform master 노드에 SSH 접속
ssh admin@<platform-master-ip>

# 모든 인증서 만료일 확인
sudo kubeadm certs check-expiration

# 출력 예시:
# CERTIFICATE                EXPIRES                  RESIDUAL TIME   CERTIFICATE AUTHORITY   EXTERNALLY MANAGED
# admin.conf                 Mar 19, 2027 05:30 UTC   364d            ca                      no
# apiserver                  Mar 19, 2027 05:30 UTC   364d            ca                      no
# apiserver-etcd-client      Mar 19, 2027 05:30 UTC   364d            ca                      no
# apiserver-kubelet-client   Mar 19, 2027 05:30 UTC   364d            ca                      no
# controller-manager.conf    Mar 19, 2027 05:30 UTC   364d            ca                      no
# etcd-healthcheck-client    Mar 19, 2027 05:30 UTC   364d            etcd-ca                 no
# etcd-peer                  Mar 19, 2027 05:30 UTC   364d            etcd-ca                 no
# etcd-server                Mar 19, 2027 05:30 UTC   364d            etcd-ca                 no
# front-proxy-client         Mar 19, 2027 05:30 UTC   364d            front-proxy-ca          no
# scheduler.conf             Mar 19, 2027 05:30 UTC   364d            ca                      no
#
# CERTIFICATE AUTHORITY   EXPIRES                  RESIDUAL TIME   EXTERNALLY MANAGED
# ca                      Mar 17, 2035 05:30 UTC   8y              no
# etcd-ca                 Mar 17, 2035 05:30 UTC   8y              no
# front-proxy-ca          Mar 17, 2035 05:30 UTC   8y              no
```

#### Step 2: openssl로 개별 인증서 상세 확인

```bash
# API Server 인증서 상세 확인
sudo openssl x509 -in /etc/kubernetes/pki/apiserver.crt -noout -text | grep -A2 "Validity"

# 출력 예시:
#         Validity
#             Not Before: Mar 19, 2025 05:30:00 GMT
#             Not After : Mar 19, 2027 05:30:00 GMT

# API Server 인증서의 SAN(Subject Alternative Name) 확인
sudo openssl x509 -in /etc/kubernetes/pki/apiserver.crt -noout -text | grep -A5 "Subject Alternative Name"

# etcd 인증서 만료일 확인
sudo openssl x509 -in /etc/kubernetes/pki/etcd/server.crt -noout -dates
# 출력:
# notBefore=Mar 19, 2025 05:30:00 GMT
# notAfter=Mar 19, 2027 05:30:00 GMT

# CA 인증서 만료일 확인 (10년 유효)
sudo openssl x509 -in /etc/kubernetes/pki/ca.crt -noout -dates

# kubelet 인증서 확인
sudo openssl x509 -in /var/lib/kubelet/pki/kubelet-client-current.pem -noout -dates
```

#### Step 3: 인증서 갱신 (실습용)

```bash
# 특정 인증서 갱신
sudo kubeadm certs renew apiserver
sudo kubeadm certs renew apiserver-kubelet-client
sudo kubeadm certs renew apiserver-etcd-client

# 모든 인증서 일괄 갱신
sudo kubeadm certs renew all

# 갱신 후 컨트롤 플레인 Pod 재시작 필요
# Static Pod는 자동으로 감지되어 재시작될 수 있지만, 수동으로 확인하라
sudo crictl ps | grep -E "(apiserver|controller|scheduler|etcd)"

# 갱신 결과 확인
sudo kubeadm certs check-expiration
```

**확인 문제**:
1. Kubernetes 인증서의 기본 유효 기간은 얼마인가? CA 인증서는?
2. 인증서가 만료되면 클러스터에 어떤 영향이 있는가?
3. `kubeadm certs renew all` 실행 후 반드시 해야 할 작업은 무엇인가?

**확인 문제 풀이**:
1. kubeadm으로 생성된 서버/클라이언트 인증서의 기본 유효 기간은 **1년**이다. CA 인증서(ca.crt, etcd-ca.crt, front-proxy-ca.crt)의 기본 유효 기간은 **10년**이다. kubelet 클라이언트 인증서는 `--rotate-certificates`(기본 활성화)에 의해 자동 갱신된다. 나머지 인증서는 수동 갱신(`kubeadm certs renew`) 또는 클러스터 업그레이드(`kubeadm upgrade`) 시 자동 갱신된다.
2. 만료된 인증서 유형에 따라 영향이 다르다: apiserver.crt 만료 → `kubectl` 명령 실패, apiserver-etcd-client.crt 만료 → API Server가 etcd에 접근 불가(전체 클러스터 마비), apiserver-kubelet-client.crt 만료 → `kubectl logs`/`kubectl exec` 실패, kubelet 클라이언트 인증서 만료 → 해당 노드 NotReady. 가장 심각한 것은 apiserver-etcd-client.crt 만료로, 이 경우 모든 API 요청이 실패한다.
3. `kubeadm certs renew all` 실행 후 반드시 (1) 컨트롤 플레인 Pod를 재시작해야 한다 — Static Pod는 자동으로 재시작되지만, 확실하게 하려면 `sudo crictl ps -q | xargs sudo crictl stop`을 실행한다. kubelet이 Static Pod를 자동 재시작한다. (2) kubeconfig 파일(admin.conf, controller-manager.conf, scheduler.conf)도 인증서를 포함하므로 갱신이 필요하다. `kubeadm certs renew all`은 kubeconfig도 함께 갱신한다. (3) `$HOME/.kube/config`에 복사된 admin.conf도 업데이트해야 한다: `sudo cp /etc/kubernetes/admin.conf $HOME/.kube/config`.

---

### Lab 1.10: kubeadm 클러스터 업그레이드 절차 확인

**학습 목표**: kubeadm을 사용한 클러스터 업그레이드 절차를 이해하고, 업그레이드 계획을 수립한다.

**CKA 관련 도메인**: Cluster Architecture, Installation & Configuration (25%)

#### 등장 배경

Kubernetes는 4개월 주기로 새 마이너 버전을 릴리스한다. 각 마이너 버전은 릴리스 후 약 14개월 동안 패치 지원을 받는다. 보안 취약점 패치, 버그 수정, 기능 업데이트를 위해 주기적인 클러스터 업그레이드가 필요하다.

kubeadm 업그레이드의 핵심 규칙은 다음과 같다:

1. **한 번에 하나의 마이너 버전만** 업그레이드할 수 있다 (예: 1.30 -> 1.31). 1.30에서 1.32로 직접 업그레이드는 지원되지 않는다. 이유: 각 마이너 버전은 이전 버전과의 호환성만 보장하며, 2 버전 이상의 차이에서는 API 변경, 기능 제거 등으로 호환성이 보장되지 않는다.
2. **Control Plane을 먼저** 업그레이드하고, 그 다음 Worker 노드를 업그레이드해야 한다. 이유: kubelet은 kube-apiserver보다 최대 2 마이너 버전 낮을 수 있지만(version skew policy), 높을 수는 없다.
3. **etcd 백업** 후 업그레이드를 진행한다. 업그레이드 실패 시 복원을 위한 안전장치이다.

#### 내부 동작 원리

`kubeadm upgrade apply` 실행 시 다음 과정이 발생한다:

1. **preflight check**: 현재 클러스터 상태, 인증서 만료일, 컴포넌트 버전 호환성을 검사한다.
2. **Static Pod 매니페스트 업데이트**: `/etc/kubernetes/manifests/`의 kube-apiserver, kube-controller-manager, kube-scheduler, etcd 매니페스트를 새 버전의 이미지 태그로 업데이트한다.
3. **kubelet이 변경 감지**: Static Pod 매니페스트가 변경되면 kubelet이 기존 Pod를 종료하고 새 이미지로 Pod를 재시작한다.
4. **kube-proxy 및 CoreDNS 업데이트**: DaemonSet/Deployment를 새 버전으로 업데이트한다.
5. **인증서 갱신**: 업그레이드 시 만료 예정인 인증서를 자동 갱신한다.

Worker 노드의 `kubeadm upgrade node`는 kubelet 설정만 업데이트하며, Control Plane 컴포넌트는 변경하지 않는다.

#### 업그레이드 순서 요약

```
1. etcd 백업
2. kubeadm 업그레이드 (Control Plane 노드)
3. kubeadm upgrade apply (Control Plane 컴포넌트)
4. kubectl drain (Control Plane 노드)
5. kubelet/kubectl 업그레이드 (Control Plane 노드)
6. kubectl uncordon (Control Plane 노드)
7. 각 Worker 노드에 대해 반복:
   a. kubectl drain (Worker 노드)
   b. kubeadm upgrade node (Worker 노드)
   c. kubelet/kubectl 업그레이드 (Worker 노드)
   d. kubectl uncordon (Worker 노드)
```

#### 장애 시나리오: 업그레이드 실패 복구

`kubeadm upgrade apply` 실행 중 실패하는 경우:
1. kubeadm 자체가 이전 매니페스트의 백업을 `/etc/kubernetes/tmp/`에 저장한다.
2. 실패 시 `kubeadm upgrade apply --force`로 재시도하거나, 백업된 매니페스트를 복원한다.
3. etcd 데이터 문제가 발생하면 사전에 생성한 etcd 스냅샷으로 복원한다.

#### Step 1: 현재 버전 확인

```bash
# 클러스터 버전 확인
kubectl --context=platform version

# 노드별 kubelet 버전 확인
kubectl --context=platform get nodes -o custom-columns='NAME:.metadata.name,VERSION:.status.nodeInfo.kubeletVersion'

# 출력 예시:
# NAME              VERSION
# platform-master   v1.31.x
# platform-worker1  v1.31.x
# platform-worker2  v1.31.x
```

#### Step 2: 업그레이드 계획 확인

```bash
# master 노드에 SSH 접속
ssh admin@<platform-master-ip>

# kubeadm 업그레이드 계획 확인
sudo kubeadm upgrade plan

# 출력 예시:
# [upgrade/config] Making sure the configuration is correct:
# [preflight] Running pre-flight checks.
# [upgrade] Running cluster health checks
# [upgrade] Fetching available versions to upgrade to
# Components that must be upgraded manually after you have upgraded the control plane with 'kubeadm upgrade apply':
# COMPONENT   CURRENT       TARGET
# kubelet     v1.31.x       v1.32.x
#
# Upgrade to the latest stable version:
# COMPONENT                 CURRENT   TARGET
# kube-apiserver            v1.31.x   v1.32.x
# kube-controller-manager   v1.31.x   v1.32.x
# kube-scheduler            v1.31.x   v1.32.x
# kube-proxy                v1.31.x   v1.32.x
# CoreDNS                   v1.11.x   v1.11.x
# etcd                      3.5.x     3.5.x
```

#### Step 3: 업그레이드 절차 정리 (CKA 시험용)

실제 업그레이드는 위험할 수 있으므로, 여기서는 절차만 정리한다.

```bash
# === Control Plane 업그레이드 절차 ===

# 1. kubeadm 업그레이드
sudo apt-mark unhold kubeadm
sudo apt-get update
sudo apt-get install -y kubeadm=1.32.x-*
sudo apt-mark hold kubeadm

# 2. 업그레이드 적용
sudo kubeadm upgrade apply v1.32.x

# 3. 노드 drain (워크로드 이동)
kubectl drain platform-master --ignore-daemonsets --delete-emptydir-data

# 4. kubelet, kubectl 업그레이드
sudo apt-mark unhold kubelet kubectl
sudo apt-get install -y kubelet=1.32.x-* kubectl=1.32.x-*
sudo apt-mark hold kubelet kubectl

# 5. kubelet 재시작
sudo systemctl daemon-reload
sudo systemctl restart kubelet

# 6. 노드 uncordon (스케줄링 재개)
kubectl uncordon platform-master

# === Worker Node 업그레이드 절차 ===

# 1. 워커 노드 drain
kubectl drain platform-worker1 --ignore-daemonsets --delete-emptydir-data

# 2. 워커 노드에서 kubeadm 업그레이드
ssh admin@<platform-worker1-ip>
sudo apt-mark unhold kubeadm
sudo apt-get update
sudo apt-get install -y kubeadm=1.32.x-*
sudo apt-mark hold kubeadm
sudo kubeadm upgrade node

# 3. kubelet 업그레이드
sudo apt-mark unhold kubelet kubectl
sudo apt-get install -y kubelet=1.32.x-* kubectl=1.32.x-*
sudo apt-mark hold kubelet kubectl
sudo systemctl daemon-reload
sudo systemctl restart kubelet
exit

# 4. 워커 노드 uncordon
kubectl uncordon platform-worker1
```

#### Step 4: 업그레이드 후 검증

```bash
# 모든 노드 버전 확인
kubectl --context=platform get nodes

# 컨트롤 플레인 Pod 상태 확인
kubectl --context=platform get pods -n kube-system

# 클러스터 건강 상태 확인
kubectl --context=platform get cs 2>/dev/null
kubectl --context=platform cluster-info
```

**확인 문제**:
1. 업그레이드는 반드시 한 마이너 버전씩 수행해야 하는 이유는 무엇인가?
2. `kubectl drain` 명령에서 `--ignore-daemonsets` 플래그가 필요한 이유는 무엇인가?
3. Control Plane과 Worker Node의 업그레이드 순서가 중요한 이유는 무엇인가?

**확인 문제 풀이**:
1. Kubernetes는 각 마이너 버전에서 API 변경(deprecation, removal), etcd 스키마 변경, 기능 변경 등이 발생한다. 각 버전의 업그레이드 로직은 바로 이전 버전에서만 마이그레이션을 보장한다. 예를 들어 v1.31의 업그레이드 로직은 v1.30의 데이터/설정을 v1.31로 변환하지만, v1.29의 데이터를 직접 v1.31로 변환하는 로직은 존재하지 않는다. 이를 건너뛰면 데이터 손실이나 호환성 오류가 발생할 수 있다.
2. DaemonSet Pod는 모든 노드에 하나씩 실행되어야 하는 시스템 수준 워크로드(CNI, 로그 수집기 등)이다. drain으로 이 Pod를 삭제하면 다른 노드에 재생성되지만 의미가 없다 (DaemonSet은 모든 노드에 하나씩 실행되는 것이 목적이므로). `--ignore-daemonsets`를 지정하면 DaemonSet Pod를 건너뛰고 나머지 Pod만 축출한다. 이 플래그 없이 drain하면 DaemonSet Pod가 존재한다는 오류가 발생하여 drain이 중단된다.
3. version skew policy에 의해 kubelet은 kube-apiserver보다 높은 버전일 수 없다. Worker 노드를 먼저 업그레이드하면 kubelet(v1.32)이 kube-apiserver(v1.31)보다 높은 버전이 되어 호환성 문제가 발생한다. Control Plane을 먼저 업그레이드하면 kube-apiserver(v1.32)가 kubelet(v1.31)보다 높거나 같으므로 version skew policy를 준수한다.

---

## 실습 2: Workloads & Scheduling (15%)

> CKA 시험의 15%를 차지하는 도메인이다. Deployment 관리, Rolling Update, 스케줄링 제어(Taint/Toleration, nodeSelector, Affinity), 리소스 관리 등이 출제 범위이다.

### 등장 배경

Kubernetes의 워크로드 관리는 선언적(declarative) 모델에 기반한다. 관리자가 "원하는 상태(desired state)"를 정의하면 컨트롤러가 "현재 상태(current state)"를 원하는 상태로 수렴시킨다. 이 모델이 등장하기 전에는 서버에 직접 접속하여 프로세스를 시작/중지하는 명령적(imperative) 방식이 사용되었다. 명령적 방식은 상태 추적이 어렵고, 장애 시 자동 복구가 불가능하며, 다수의 인스턴스를 관리하기 힘들었다.

Deployment는 ReplicaSet 위에 추가된 추상화 계층으로, Rolling Update와 롤백 기능을 제공한다. 내부적으로 Deployment 컨트롤러는 이미지 변경 시 새 ReplicaSet을 생성하고, 기존 ReplicaSet의 replicas를 점진적으로 0으로 줄이면서 새 ReplicaSet의 replicas를 늘린다. 이 과정에서 `maxSurge`(추가 허용 Pod 수)와 `maxUnavailable`(비가용 허용 Pod 수)이 조절 변수로 작용한다.

스케줄링 제어(nodeSelector, Taint/Toleration, Affinity)는 Pod를 특정 노드에 배치하거나 배제하는 메커니즘이다. 이 메커니즘이 필요한 이유는 다음과 같다:
- GPU 워크로드는 GPU가 있는 노드에만 배치해야 한다 (nodeSelector/nodeAffinity).
- 마스터 노드에는 일반 워크로드를 배치하지 않아야 한다 (Taint/Toleration).
- 같은 서비스의 Pod를 서로 다른 노드에 분산하여 가용성을 높여야 한다 (podAntiAffinity).

### 스케줄링 내부 동작 원리

kube-scheduler는 Pending 상태의 Pod를 감지하면 다음 과정을 거쳐 최적의 노드를 선택한다:

1. **필터링(Filtering)**: 후보 노드 중 Pod의 요구사항을 충족하지 못하는 노드를 제거한다. 검사 항목: 리소스 가용량, nodeSelector 일치, Taint 허용, PVC 바인딩 가능 여부 등.
2. **스코어링(Scoring)**: 필터를 통과한 노드에 점수를 부여한다. 리소스 균형, Pod 분산도, 선호 조건(preferredDuringScheduling) 등을 기준으로 점수를 매긴다.
3. **바인딩(Binding)**: 가장 높은 점수의 노드에 Pod를 바인딩한다. 동점이면 랜덤 선택한다.

필터링 단계에서 모든 노드가 제거되면 Pod는 Pending 상태로 남는다. `kubectl describe pod`의 Events에서 `FailedScheduling` 이벤트와 함께 구체적인 원인(Insufficient cpu, node(s) didn't match selector 등)이 표시된다.

---

### Lab 2.1: nginx-web Deployment 분석 (strategy, replicas, selector)

**학습 목표**: tart-infra의 nginx-web Deployment를 분석하여 Deployment의 핵심 구성 요소를 이해한다.

**CKA 관련 도메인**: Workloads & Scheduling (15%)

#### Step 1: nginx-web Deployment 확인

```bash
# dev 클러스터의 demo 네임스페이스에서 Deployment 확인
kubectl --context=dev get deployments -n demo

# nginx-web Deployment 상세 확인
kubectl --context=dev describe deployment nginx-web -n demo

# YAML 출력으로 전체 구조 분석
kubectl --context=dev get deployment nginx-web -n demo -o yaml
```

#### Step 2: 핵심 필드 분석

```bash
# replicas 확인
kubectl --context=dev get deployment nginx-web -n demo -o jsonpath='{.spec.replicas}'
# 출력: 3

# strategy 확인
kubectl --context=dev get deployment nginx-web -n demo -o jsonpath='{.spec.strategy}'
# 출력: {"rollingUpdate":{"maxSurge":"25%","maxUnavailable":"25%"},"type":"RollingUpdate"}

# selector 확인
kubectl --context=dev get deployment nginx-web -n demo -o jsonpath='{.spec.selector.matchLabels}'

# Pod template의 labels 확인
kubectl --context=dev get deployment nginx-web -n demo -o jsonpath='{.spec.template.metadata.labels}'

# 리소스 설정 확인
kubectl --context=dev get deployment nginx-web -n demo -o jsonpath='{.spec.template.spec.containers[0].resources}'
# 출력: {"limits":{"cpu":"200m","memory":"128Mi"},"requests":{"cpu":"50m","memory":"64Mi"}}
```

#### Step 3: ReplicaSet 및 Pod 연관 관계 확인

```bash
# Deployment → ReplicaSet 확인
kubectl --context=dev get replicasets -n demo -l app=nginx-web
# DESIRED=3, CURRENT=3, READY=3

# ReplicaSet → Pod 확인
kubectl --context=dev get pods -n demo -l app=nginx-web -o wide

# Pod의 ownerReferences 확인 (Pod → ReplicaSet → Deployment 관계)
kubectl --context=dev get pod -n demo -l app=nginx-web -o jsonpath='{.items[0].metadata.ownerReferences[0].kind} {.items[0].metadata.ownerReferences[0].name}'
# 출력: ReplicaSet nginx-web-xxxxxxxxx
```

#### Step 4: NodePort 서비스 확인

```bash
# nginx-web의 NodePort 서비스 확인
kubectl --context=dev get svc -n demo | grep nginx

# NodePort 30080 확인
kubectl --context=dev get svc nginx-web -n demo -o jsonpath='{.spec.ports[0].nodePort}'
# 출력: 30080

# 접근 테스트
kubectl --context=dev run curl-test --rm -it --image=curlimages/curl -n demo \
  -- curl -s http://nginx-web.demo.svc.cluster.local
```

#### Deployment 내부 동작 상세

Deployment 컨트롤러의 핵심 동작은 "현재 상태"를 "원하는 상태"로 수렴시키는 것이다. 이 과정은 reconciliation loop으로 구현된다:

1. Deployment 컨트롤러가 Deployment 오브젝트의 변경을 감지한다.
2. Pod 템플릿이 변경되었으면 새 ReplicaSet을 생성한다.
3. 새 ReplicaSet의 replicas를 점진적으로 증가시키고, 기존 ReplicaSet의 replicas를 감소시킨다 (Rolling Update).
4. `spec.revisionHistoryLimit`(기본 10)만큼의 이전 ReplicaSet을 유지하여 롤백을 가능하게 한다.

Deployment → ReplicaSet → Pod의 소유 관계는 `ownerReferences`로 추적된다. Pod가 속한 ReplicaSet은 `kubectl get pod <name> -o jsonpath='{.metadata.ownerReferences[0].name}'`로 확인할 수 있다. 이 소유 체인 덕분에 Deployment를 삭제하면 하위 ReplicaSet과 Pod가 cascade 삭제된다.

**확인 문제**:
1. nginx-web의 replicas가 3이고, maxUnavailable이 25%이면, Rolling Update 중 최소 몇 개의 Pod가 유지되는가?
2. Deployment → ReplicaSet → Pod의 관계에서 ReplicaSet의 역할은 무엇인가?
3. `requests: 50m/64Mi`, `limits: 200m/128Mi` 설정에서 이 Pod의 QoS 클래스는 무엇인가?

**확인 문제 풀이**:
1. `maxUnavailable: 25%`이고 replicas=3이면, `floor(3 * 0.25) = 0`이므로 최소 3개(3-0=3)의 Pod가 유지된다. 단, 25%의 계산에서 소수점 이하는 내림(floor)하므로, replicas=3에서 maxUnavailable=25%는 실질적으로 0이다. 이 경우 모든 Pod가 항상 Ready 상태를 유지해야 하므로, 새 Pod가 Ready가 되기 전까지 기존 Pod를 종료할 수 없다. 실제로 replicas=4 이상에서 25%가 의미있는 값이 된다: `floor(4 * 0.25) = 1`, 최소 3개 유지.
2. ReplicaSet은 "지정된 수의 Pod 복제본이 항상 실행 중이도록 보장"하는 컨트롤러이다. Pod가 삭제되거나 실패하면 새 Pod를 생성하고, 초과 Pod가 있으면 삭제한다. Deployment는 ReplicaSet을 직접 생성/관리하며, Rolling Update 시 새 ReplicaSet을 생성하고 기존 ReplicaSet의 replicas를 조정한다. 즉, Deployment는 "어떤 버전의 Pod를 몇 개 실행할 것인가"를 관리하고, ReplicaSet은 "Pod 수를 유지"하는 역할을 담당한다.
3. **Burstable** 클래스이다. Guaranteed QoS를 받으려면 모든 컨테이너의 CPU requests = CPU limits, Memory requests = Memory limits여야 한다. 이 Pod는 CPU requests(50m) != CPU limits(200m), Memory requests(64Mi) != Memory limits(128Mi)이므로 Guaranteed 조건을 충족하지 않는다. requests가 설정되어 있으므로 BestEffort도 아니다. 따라서 중간 단계인 Burstable이 된다.

---

### Lab 2.2: Rolling Update 실습 (이미지 변경 → rollout status → history → undo)

**학습 목표**: Deployment의 Rolling Update 전체 라이프사이클을 실습한다.

**CKA 관련 도메인**: Workloads & Scheduling (15%)

#### Step 1: 테스트용 Deployment 생성

```bash
# 기존 nginx-web에 영향을 주지 않도록 별도의 테스트 Deployment 생성
kubectl --context=dev create deployment rollout-test \
  --image=nginx:1.24 \
  --replicas=3 \
  -n demo

# 생성 확인
kubectl --context=dev get deployment rollout-test -n demo
kubectl --context=dev get pods -n demo -l app=rollout-test
```

#### Step 2: Rolling Update 실행

```bash
# 이미지를 nginx:1.25로 업데이트
kubectl --context=dev set image deployment/rollout-test nginx=nginx:1.25 -n demo

# 롤아웃 상태 실시간 모니터링
kubectl --context=dev rollout status deployment/rollout-test -n demo

# 출력 예시:
# Waiting for deployment "rollout-test" rollout to finish: 1 out of 3 new replicas have been updated...
# Waiting for deployment "rollout-test" rollout to finish: 2 out of 3 new replicas have been updated...
# Waiting for deployment "rollout-test" rollout to finish: 1 old replicas are pending termination...
# deployment "rollout-test" successfully rolled out

# ReplicaSet 변화 확인 (기존 RS와 새 RS)
kubectl --context=dev get replicasets -n demo -l app=rollout-test

# 출력 예시:
# NAME                        DESIRED   CURRENT   READY   AGE
# rollout-test-aaaa           0         0         0       2m     ← 기존 (nginx:1.24)
# rollout-test-bbbb           3         3         3       30s    ← 신규 (nginx:1.25)
```

#### Step 3: 롤아웃 히스토리 확인

```bash
# 롤아웃 히스토리 확인
kubectl --context=dev rollout history deployment/rollout-test -n demo

# 출력 예시:
# REVISION  CHANGE-CAUSE
# 1         <none>
# 2         <none>

# 특정 리비전의 상세 정보 확인
kubectl --context=dev rollout history deployment/rollout-test --revision=1 -n demo
kubectl --context=dev rollout history deployment/rollout-test --revision=2 -n demo

# 변경 사유 기록을 위한 annotation 추가
kubectl --context=dev annotate deployment/rollout-test kubernetes.io/change-cause="이미지를 nginx:1.25로 업그레이드" -n demo
```

#### Step 4: 문제가 있는 이미지로 업데이트 (장애 시뮬레이션)

```bash
# 존재하지 않는 이미지로 업데이트
kubectl --context=dev set image deployment/rollout-test nginx=nginx:99.99 -n demo

# 롤아웃 상태 확인 (멈춰 있는 것을 확인)
kubectl --context=dev rollout status deployment/rollout-test -n demo --timeout=30s
# 타임아웃 발생

# Pod 상태 확인 — ImagePullBackOff 발생
kubectl --context=dev get pods -n demo -l app=rollout-test
# NAME                           READY   STATUS             RESTARTS   AGE
# rollout-test-cccc-xxxx         0/1     ImagePullBackOff   0          30s
# rollout-test-bbbb-aaaa         1/1     Running            0          2m
# rollout-test-bbbb-bbbb         1/1     Running            0          2m
# rollout-test-bbbb-cccc         1/1     Running            0          2m
```

#### Step 5: 롤백

```bash
# 이전 버전으로 롤백
kubectl --context=dev rollout undo deployment/rollout-test -n demo

# 롤백 상태 확인
kubectl --context=dev rollout status deployment/rollout-test -n demo
# deployment "rollout-test" successfully rolled out

# Pod 상태 확인 — 정상 복구
kubectl --context=dev get pods -n demo -l app=rollout-test

# 특정 리비전으로 롤백
kubectl --context=dev rollout undo deployment/rollout-test --to-revision=1 -n demo
kubectl --context=dev rollout status deployment/rollout-test -n demo
```

#### Step 6: 정리

```bash
kubectl --context=dev delete deployment rollout-test -n demo
```

#### 내부 동작 원리: Rolling Update 메커니즘

Rolling Update의 내부 동작을 단계별로 분석하면 다음과 같다:

1. `kubectl set image` 실행 시, Deployment 컨트롤러가 Pod 템플릿의 이미지 변경을 감지한다.
2. 변경된 템플릿의 해시값으로 새 ReplicaSet을 생성한다 (예: rollout-test-bbbb).
3. Deployment 컨트롤러는 `maxSurge`만큼 새 ReplicaSet의 replicas를 증가시킨다.
4. 새 Pod가 Ready 상태가 되면, `maxUnavailable`만큼 기존 ReplicaSet의 replicas를 감소시킨다.
5. 이 과정을 반복하여 모든 Pod가 새 ReplicaSet으로 전환될 때까지 진행한다.
6. 기존 ReplicaSet은 삭제되지 않고 replicas=0으로 유지된다. 이는 롤백을 위한 히스토리이다.

`maxSurge`와 `maxUnavailable`의 조합에 따른 동작 차이:

| maxSurge | maxUnavailable | 동작 특성 |
|---|---|---|
| 25% | 25% | 기본값. Pod 수의 25%만큼 추가 생성하면서 25%만큼 종료. 균형 잡힌 업데이트 |
| 100% | 0 | Blue-Green 스타일. 새 Pod를 전부 생성한 후 기존 Pod를 종료. 다운타임 없음, 리소스 2배 소비 |
| 0 | 100% | 기존 Pod를 전부 종료한 후 새 Pod를 생성. Recreate와 유사, 다운타임 발생 |
| 1 | 0 | 가장 보수적. 한 번에 1개씩만 교체. 느리지만 안전함 |

#### 장애 시나리오: 잘못된 이미지로 업데이트 시 보호 메커니즘

존재하지 않는 이미지(nginx:99.99)로 업데이트하면, 새 ReplicaSet의 Pod가 ImagePullBackOff 상태에 빠진다. 이때 기존 Pod가 모두 종료되지 않는 이유는 `maxUnavailable`이 동작하기 때문이다. 새 Pod가 Ready 상태가 되지 않으면, 기존 Pod의 종료가 진행되지 않는다. 이 메커니즘이 Rolling Update의 핵심 안전장치이다.

만약 `maxUnavailable: 100%`로 설정되어 있다면, 기존 Pod가 전부 종료된 후 새 Pod(ImagePullBackOff 상태)만 남게 되어 완전한 서비스 중단이 발생한다. 이것이 `maxUnavailable`을 지나치게 크게 설정하면 안 되는 이유이다.

**확인 문제**:
1. Rolling Update 중 `maxSurge`와 `maxUnavailable`의 기본값은 각각 무엇인가?
2. 롤백 후 리비전 번호는 어떻게 변하는가?
3. 존재하지 않는 이미지로 업데이트했을 때, 기존 Pod가 모두 종료되지 않는 이유는 무엇인가?

**확인 문제 풀이**:
1. `maxSurge`와 `maxUnavailable`의 기본값은 각각 25%이다. replicas=4인 Deployment에서 `maxSurge=25%`는 `ceil(4 * 0.25) = 1`이므로 최대 5개(4+1)의 Pod가 동시에 존재할 수 있다. `maxUnavailable=25%`는 `floor(4 * 0.25) = 1`이므로 최소 3개(4-1)의 Pod가 항상 Ready 상태를 유지해야 한다.
2. 롤백 시 이전 리비전의 ReplicaSet이 활성화되면서 새 리비전 번호가 부여된다. 예를 들어 리비전 1 -> 2 -> 3에서 `rollout undo`로 리비전 2로 롤백하면, 리비전 번호가 4로 부여된다 (2 -> 4). 기존 리비전 2는 사라지고 4가 된다.
3. `maxUnavailable` 정책 때문이다. Rolling Update는 새 Pod가 Ready 상태가 되어야만 기존 Pod를 종료한다. 새 Pod가 ImagePullBackOff로 Ready가 되지 못하면, 기존 Pod의 종료가 진행되지 않아 서비스가 유지된다.

---

### Lab 2.3: Recreate 전략으로 변경 후 업데이트

**학습 목표**: Recreate 전략의 동작 방식을 이해하고, RollingUpdate 전략과의 차이점을 비교한다.

**CKA 관련 도메인**: Workloads & Scheduling (15%)

#### Step 1: Recreate 전략 Deployment 생성

```bash
kubectl --context=dev apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: recreate-test
  namespace: demo
spec:
  replicas: 3
  strategy:
    type: Recreate
  selector:
    matchLabels:
      app: recreate-test
  template:
    metadata:
      labels:
        app: recreate-test
    spec:
      containers:
      - name: app
        image: nginx:1.24
        resources:
          requests:
            cpu: 50m
            memory: 64Mi
          limits:
            cpu: 200m
            memory: 128Mi
EOF

# 생성 확인
kubectl --context=dev get pods -n demo -l app=recreate-test -w &
```

#### Step 2: Recreate 전략 업데이트 관찰

```bash
# 이미지 변경
kubectl --context=dev set image deployment/recreate-test app=nginx:1.25 -n demo

# 관찰 결과: 모든 기존 Pod가 먼저 종료된 후 새 Pod가 생성된다
# rollout-test-aaaa-xxxx   1/1     Terminating   0          1m
# rollout-test-aaaa-yyyy   1/1     Terminating   0          1m
# rollout-test-aaaa-zzzz   1/1     Terminating   0          1m
# (모두 종료된 후)
# rollout-test-bbbb-xxxx   0/1     ContainerCreating   0   0s
# rollout-test-bbbb-yyyy   0/1     ContainerCreating   0   0s
# rollout-test-bbbb-zzzz   0/1     ContainerCreating   0   0s

# 롤아웃 완료 확인
kubectl --context=dev rollout status deployment/recreate-test -n demo
```

#### Step 3: 전략 비교

```bash
# 전략 확인
kubectl --context=dev get deployment recreate-test -n demo -o jsonpath='{.spec.strategy.type}'
# 출력: Recreate

kubectl --context=dev get deployment nginx-web -n demo -o jsonpath='{.spec.strategy.type}'
# 출력: RollingUpdate
```

#### Step 4: 정리

```bash
kubectl --context=dev delete deployment recreate-test -n demo
```

#### Recreate vs RollingUpdate 전략 비교

| 항목 | Recreate | RollingUpdate |
|---|---|---|
| 다운타임 | 발생한다 (모든 기존 Pod 종료 → 새 Pod 생성) | 발생하지 않는다 (점진적 교체) |
| 리소스 사용 | 최소 (동시에 하나의 버전만 실행) | 추가 리소스 필요 (maxSurge만큼 추가 Pod) |
| 배포 속도 | 빠름 (한 번에 전체 교체) | 느림 (점진적 교체) |
| 안전성 | 낮음 (즉시 전체 전환) | 높음 (점진적 전환, 롤백 가능) |
| 적합한 워크로드 | DB 마이그레이션, 스키마 변경이 동반되는 배포, 두 버전이 공존 불가능한 경우 | 일반 stateless 웹 서비스 |

Recreate 전략은 구 버전과 신 버전이 동시에 실행되면 데이터 불일치가 발생하는 경우에 사용한다. 예를 들어 데이터베이스 스키마를 변경하는 마이그레이션에서, 구 버전 애플리케이션이 새 스키마를 인식하지 못하면 오류가 발생한다. 이 경우 Recreate 전략으로 모든 인스턴스를 동시에 교체해야 한다.

**확인 문제**:
1. Recreate 전략은 어떤 상황에서 RollingUpdate보다 적합한가?
2. Recreate 전략에서 다운타임이 발생하는 이유는 무엇인가?
3. 데이터베이스 마이그레이션이 필요한 경우 어떤 전략이 적합한가?

**확인 문제 풀이**:
1. 구 버전과 신 버전이 동시에 실행될 수 없는 경우에 적합하다. 예: 데이터베이스 스키마 변경, 공유 리소스에 대한 독점 접근이 필요한 경우, 라이선스가 단일 인스턴스만 허용하는 경우.
2. Recreate 전략은 기존 ReplicaSet의 replicas를 0으로 설정한 후 새 ReplicaSet의 replicas를 증가시킨다. 기존 Pod가 모두 종료된 후 새 Pod가 생성되므로, 그 사이에 서비스가 불가능한 기간(다운타임)이 발생한다.
3. 데이터베이스 마이그레이션이 동반되는 경우 Recreate 전략이 적합하다. RollingUpdate를 사용하면 구 버전 Pod가 새 스키마의 DB에 접근하여 오류가 발생하거나, 신 버전 Pod가 구 스키마의 DB에 접근하여 오류가 발생할 수 있다.

---

### Lab 2.4: nodeSelector 실습 (특정 노드에 Pod 배치)

**학습 목표**: nodeSelector를 사용하여 Pod를 특정 노드에 스케줄링한다.

**CKA 관련 도메인**: Workloads & Scheduling (15%)

#### 등장 배경

Kubernetes 스케줄러의 기본 동작은 리소스 가용량을 기반으로 최적의 노드를 자동 선택하는 것이다. 그러나 특정 워크로드는 특정 노드에 배치되어야 하는 경우가 있다:

- **하드웨어 요구**: GPU 워크로드는 GPU가 장착된 노드에만 배치해야 한다.
- **데이터 지역성(data locality)**: 데이터가 로컬 디스크에 저장된 경우, 해당 노드에 Pod를 배치해야 I/O 성능이 보장된다.
- **라이선스 제약**: 특정 소프트웨어 라이선스가 특정 노드에만 할당된 경우.
- **네트워크 위치**: 특정 네트워크 존(zone)에 Pod를 배치해야 하는 경우.

nodeSelector는 가장 간단한 노드 선택 메커니즘이다. 노드에 레이블을 부여하고, Pod의 `nodeSelector` 필드에 해당 레이블을 지정하면, 스케줄러는 일치하는 레이블을 가진 노드에만 Pod를 배치한다.

nodeSelector의 한계:
- OR 조건을 표현할 수 없다 (예: disk=ssd OR disk=nvme).
- "선호(preferred)" 표현이 불가능하다. 일치하는 노드가 없으면 Pod는 Pending 상태에 머문다.
- 이 한계를 극복하기 위해 nodeAffinity가 도입되었다. nodeAffinity는 `In`, `NotIn`, `Exists`, `DoesNotExist`, `Gt`, `Lt` 연산자를 지원하며, `requiredDuringSchedulingIgnoredDuringExecution`(필수)과 `preferredDuringSchedulingIgnoredDuringExecution`(선호) 두 가지 모드를 제공한다.

#### nodeAffinity 비교

```yaml
# nodeSelector (간단하지만 OR 조건 불가)
nodeSelector:
  disk: ssd

# nodeAffinity (유연한 조건 표현 가능)
affinity:
  nodeAffinity:
    requiredDuringSchedulingIgnoredDuringExecution:
      nodeSelectorTerms:
      - matchExpressions:
        - key: disk
          operator: In
          values:
          - ssd
          - nvme    # OR 조건: ssd 또는 nvme
    preferredDuringSchedulingIgnoredDuringExecution:
    - weight: 80
      preference:
        matchExpressions:
        - key: zone
          operator: In
          values:
          - us-east-1a
```

CKA 시험에서는 nodeSelector와 nodeAffinity 모두 출제된다. nodeSelector는 간단한 문제에, nodeAffinity는 복잡한 조건을 요구하는 문제에 사용된다.

#### Step 1: 노드 레이블 확인

```bash
# platform 클러스터 노드의 기존 레이블 확인
kubectl --context=platform get nodes --show-labels

# 특정 노드의 레이블만 확인
kubectl --context=platform get node platform-worker1 -o jsonpath='{.metadata.labels}' | python3 -m json.tool
```

#### Step 2: 커스텀 레이블 추가

```bash
# worker1에 disk=ssd 레이블 추가
kubectl --context=platform label node platform-worker1 disk=ssd

# worker2에 disk=hdd 레이블 추가
kubectl --context=platform label node platform-worker2 disk=hdd

# 레이블 확인
kubectl --context=platform get nodes -L disk

# 출력 예시:
# NAME              STATUS   ROLES           AGE   VERSION   DISK
# platform-master   Ready    control-plane   30d   v1.31.x
# platform-worker1  Ready    <none>          30d   v1.31.x   ssd
# platform-worker2  Ready    <none>          30d   v1.31.x   hdd
```

#### Step 3: nodeSelector를 사용한 Pod 배치

```bash
# SSD 노드에만 배치되는 Pod 생성
kubectl --context=platform apply -f - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: ssd-pod
  namespace: default
spec:
  nodeSelector:
    disk: ssd
  containers:
  - name: app
    image: nginx:1.25
    resources:
      requests:
        cpu: 50m
        memory: 64Mi
EOF

# Pod가 worker1에 배치되었는지 확인
kubectl --context=platform get pod ssd-pod -o wide
# NODE 열에 platform-worker1이 표시되어야 한다

# HDD 노드에만 배치되는 Pod 생성
kubectl --context=platform apply -f - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: hdd-pod
  namespace: default
spec:
  nodeSelector:
    disk: hdd
  containers:
  - name: app
    image: nginx:1.25
    resources:
      requests:
        cpu: 50m
        memory: 64Mi
EOF

# Pod가 worker2에 배치되었는지 확인
kubectl --context=platform get pod hdd-pod -o wide
```

#### Step 4: 존재하지 않는 레이블로 nodeSelector 테스트

```bash
# 존재하지 않는 레이블 — Pod가 Pending 상태에 머문다
kubectl --context=platform apply -f - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: pending-pod
  namespace: default
spec:
  nodeSelector:
    disk: nvme
  containers:
  - name: app
    image: nginx:1.25
EOF

# Pending 상태 확인
kubectl --context=platform get pod pending-pod
# STATUS: Pending

# 이벤트에서 원인 확인
kubectl --context=platform describe pod pending-pod | grep -A5 Events
# Warning  FailedScheduling  ...  0/3 nodes are available: 3 node(s) didn't match Pod's node affinity/selector
```

#### Step 5: 정리

```bash
kubectl --context=platform delete pod ssd-pod hdd-pod pending-pod
kubectl --context=platform label node platform-worker1 disk-
kubectl --context=platform label node platform-worker2 disk-
```

**확인 문제**:
1. nodeSelector와 nodeAffinity의 차이는 무엇인가?
2. 매칭되는 레이블이 없는 경우 Pod 상태는 어떻게 되는가?
3. master 노드에 일반 워크로드가 스케줄링되지 않는 이유는 무엇인가?

**확인 문제 풀이**:
1. nodeSelector는 key=value 형태의 정확한 일치(equality)만 지원한다. OR 조건, NOT 조건 등 복잡한 표현이 불가능하다. 매칭 노드가 없으면 Pod는 무조건 Pending 상태이다. nodeAffinity는 `In`, `NotIn`, `Exists`, `DoesNotExist`, `Gt`, `Lt` 연산자를 지원하여 복잡한 조건을 표현할 수 있다. `requiredDuringScheduling`(필수)과 `preferredDuringScheduling`(선호) 두 가지 모드를 제공하여 "가능하면 이 노드에 배치, 불가능하면 다른 노드도 허용"하는 유연한 스케줄링이 가능하다.
2. nodeSelector 또는 nodeAffinity의 `requiredDuringScheduling`에 매칭되는 노드가 없으면, Pod는 **Pending** 상태에 머문다. `kubectl describe pod` Events에서 `0/N nodes are available: N node(s) didn't match Pod's node affinity/selector` 메시지가 표시된다. 매칭되는 레이블을 가진 노드가 추가되거나, 기존 노드에 해당 레이블이 부여되면 Pod가 자동으로 스케줄링된다.
3. master 노드에는 `node-role.kubernetes.io/control-plane:NoSchedule` Taint가 설정되어 있다. 이 Taint를 허용하는 Toleration이 없는 일반 워크로드 Pod는 master 노드에 스케줄링되지 않는다. 이는 Control Plane 컴포넌트(kube-apiserver, etcd 등)의 안정성을 보장하기 위함이다. master 노드에도 워크로드를 배치하려면 해당 Taint를 제거(`kubectl taint nodes <master> node-role.kubernetes.io/control-plane:NoSchedule-`)하거나, Pod에 Toleration을 추가해야 한다. 그러나 프로덕션 환경에서는 Control Plane 안정성을 위해 이를 권장하지 않는다.

---

### Lab 2.5: Taint & Toleration (master 노드 taint 확인, toleration 추가)

**학습 목표**: master 노드의 Taint를 확인하고, Toleration을 사용하여 Taint가 있는 노드에도 Pod를 배치하는 방법을 이해한다.

**CKA 관련 도메인**: Workloads & Scheduling (15%)

#### 등장 배경

nodeSelector는 "이 Pod는 특정 노드에 배치되어야 한다"를 표현하지만, "이 노드에 특정 Pod만 배치되어야 한다"를 표현하지 못한다. Taint/Toleration은 이 반대 방향의 제어를 제공한다.

Taint는 노드에 "오점"을 추가하여 해당 노드를 기피하게 만든다. Toleration은 Pod에 "이 오점을 허용한다"는 선언을 추가하여 Taint가 있는 노드에도 배치될 수 있게 한다. 가장 일반적인 사용 사례는 마스터 노드의 `node-role.kubernetes.io/control-plane:NoSchedule` Taint이다. 이 Taint 때문에 일반 워크로드는 마스터 노드에 배치되지 않는다.

#### 내부 동작 원리

Taint와 Effect의 3가지 유형:

| Effect | 동작 | 기존 Pod에 대한 영향 |
|---|---|---|
| `NoSchedule` | Toleration이 없는 새 Pod는 이 노드에 스케줄링되지 않는다 | 기존에 실행 중인 Pod는 영향받지 않는다 |
| `PreferNoSchedule` | 가능하면 이 노드를 회피하지만, 다른 노드가 없으면 스케줄링될 수 있다 | 기존 Pod에 영향 없다 |
| `NoExecute` | Toleration이 없는 새 Pod는 스케줄링되지 않고, **기존 Pod도 축출**된다 | 기존에 실행 중인 Pod도 Toleration이 없으면 즉시 축출된다 |

`NoExecute`에 `tolerationSeconds`를 설정하면 해당 시간이 지난 후에 축출된다. 노드 장애 시 kubelet이 자동으로 `node.kubernetes.io/not-ready:NoExecute`와 `node.kubernetes.io/unreachable:NoExecute` Taint를 추가하며, 기본 tolerationSeconds는 300초(5분)이다.

Toleration의 `operator` 필드:
- `Equal`: key, value, effect가 모두 일치해야 한다 (기본값)
- `Exists`: key만 일치하면 된다 (value 무시). key도 빈 문자열이면 모든 Taint를 허용한다

#### Step 1: 현재 노드의 Taint 확인

```bash
# 모든 클러스터의 Taint 확인
for ctx in platform dev staging prod; do
  echo "=== $ctx ==="
  kubectl --context=$ctx get nodes -o custom-columns='NAME:.metadata.name,TAINTS:.spec.taints'
  echo ""
done

# platform 클러스터의 master 노드 Taint 확인
kubectl --context=platform describe node platform-master | grep -A3 Taints

# 출력 예시:
# Taints:             node-role.kubernetes.io/control-plane:NoSchedule
```

#### Step 2: 워커 노드에 Taint 추가

```bash
# platform-worker1에 Taint 추가
kubectl --context=platform taint nodes platform-worker1 env=production:NoSchedule

# Taint 확인
kubectl --context=platform describe node platform-worker1 | grep -A3 Taints
# Taints:             env=production:NoSchedule
```

#### Step 3: Toleration 없는 Pod 배치 시도

```bash
# Toleration 없는 Pod — worker1에는 배치되지 않는다
kubectl --context=platform apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: no-toleration
  namespace: default
spec:
  replicas: 3
  selector:
    matchLabels:
      app: no-toleration
  template:
    metadata:
      labels:
        app: no-toleration
    spec:
      containers:
      - name: app
        image: nginx:1.25
        resources:
          requests:
            cpu: 50m
            memory: 64Mi
EOF

# Pod 배치 노드 확인 — worker2에만 배치된다
kubectl --context=platform get pods -l app=no-toleration -o wide
```

#### Step 4: Toleration 있는 Pod 배치

```bash
# Toleration이 있는 Pod — worker1에도 배치될 수 있다
kubectl --context=platform apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: with-toleration
  namespace: default
spec:
  replicas: 4
  selector:
    matchLabels:
      app: with-toleration
  template:
    metadata:
      labels:
        app: with-toleration
    spec:
      tolerations:
      - key: "env"
        operator: "Equal"
        value: "production"
        effect: "NoSchedule"
      containers:
      - name: app
        image: nginx:1.25
        resources:
          requests:
            cpu: 50m
            memory: 64Mi
EOF

# Pod 배치 확인 — worker1, worker2 모두에 분산 배치된다
kubectl --context=platform get pods -l app=with-toleration -o wide
```

#### Step 5: NoExecute 효과 테스트

```bash
# NoExecute Taint — 기존 Pod도 퇴거(evict)시킨다
kubectl --context=platform taint nodes platform-worker2 maintenance=true:NoExecute

# worker2에 있던 Pod가 퇴거되는 것을 확인
kubectl --context=platform get pods -l app=no-toleration -o wide
# 모든 Pod가 Pending 상태가 될 수 있다 (worker1도 Taint가 있으므로)

# NoExecute Taint 제거
kubectl --context=platform taint nodes platform-worker2 maintenance=true:NoExecute-
```

#### Step 6: 정리

```bash
kubectl --context=platform delete deployment no-toleration with-toleration
kubectl --context=platform taint nodes platform-worker1 env=production:NoSchedule-
```

**확인 문제**:
1. `NoSchedule`, `PreferNoSchedule`, `NoExecute`의 차이는 무엇인가?
2. Toleration의 `operator: Exists`는 `operator: Equal`과 어떻게 다른가?
3. master 노드의 `control-plane:NoSchedule` Taint를 제거하면 어떤 일이 발생하는가?

**확인 문제 풀이**:
1. **NoSchedule**: Toleration이 없는 새 Pod를 이 노드에 스케줄링하지 않는다. 기존 실행 중인 Pod는 영향받지 않는다. **PreferNoSchedule**: 가능하면 이 노드를 회피하지만, 다른 적합한 노드가 없으면 스케줄링될 수 있다. 소프트한 제약이다. **NoExecute**: Toleration이 없는 새 Pod를 스케줄링하지 않으며, 기존 실행 중인 Pod도 즉시 축출한다. `tolerationSeconds`를 설정하면 해당 시간 후에 축출한다. 노드 장애 시 kubelet이 자동으로 NoExecute Taint를 추가하여 Pod를 다른 노드로 이동시키는 메커니즘이 이를 활용한다.
2. `operator: Equal`(기본값)은 key, value, effect가 모두 정확히 일치해야 한다. 예: `key: "env", operator: "Equal", value: "production", effect: "NoSchedule"`. `operator: Exists`는 key(와 선택적으로 effect)만 일치하면 value와 관계없이 허용한다. 예: `key: "env", operator: "Exists", effect: "NoSchedule"`은 env=production, env=staging 등 env 키의 모든 NoSchedule Taint를 허용한다. key도 빈 문자열로 지정하면(`key: "", operator: "Exists"`) 모든 Taint를 허용한다.
3. master 노드의 `control-plane:NoSchedule` Taint를 제거하면, 일반 워크로드 Pod가 master 노드에도 스케줄링될 수 있다. master 노드와 워커 노드를 구분 없이 사용하게 된다. 소규모 클러스터(노드 1~2개)에서 리소스를 최대한 활용하기 위해 이 방법을 사용하기도 한다. 그러나 프로덕션 환경에서는 워크로드가 kube-apiserver, etcd 등의 리소스를 경합하여 Control Plane 안정성이 저하될 수 있으므로 권장하지 않는다.

---

### Lab 2.6: Resource Requests/Limits 분석 (demo 앱 QoS 클래스 확인)

**학습 목표**: demo 앱의 리소스 설정을 분석하고, QoS 클래스를 확인한다.

**CKA 관련 도메인**: Workloads & Scheduling (15%)

#### 등장 배경

컨테이너 리소스 관리는 Kubernetes의 핵심 기능 중 하나이다. `requests`와 `limits`를 설정하지 않으면 다음 문제가 발생한다:

- 하나의 Pod가 노드의 모든 CPU/메모리를 독점하여 다른 Pod가 리소스 부족으로 실패한다 (noisy neighbor problem).
- 스케줄러가 노드의 가용 리소스를 정확히 계산할 수 없어 과다 배치(overcommit)가 발생한다.
- 메모리 부족 시 어떤 Pod를 먼저 퇴거(evict)할지 기준이 없다.

`requests`는 스케줄링 시 사용되는 "보장(guaranteed)" 리소스이다. 스케줄러는 노드의 allocatable 리소스에서 기존 Pod의 requests 합계를 빼고, 남은 공간에 새 Pod를 배치한다. `limits`는 런타임 시 강제되는 상한선이다. CPU limits는 throttling으로 구현되고(프로세스가 느려짐), 메모리 limits는 OOMKill로 구현된다(프로세스가 종료됨).

#### QoS 클래스 내부 동작 원리

Kubernetes는 리소스 설정에 따라 Pod에 자동으로 QoS(Quality of Service) 클래스를 할당한다. 이 클래스는 노드의 메모리 부족 시 퇴거 순서를 결정한다:

| QoS 클래스 | 조건 | 퇴거 우선순위 |
|---|---|---|
| **Guaranteed** | 모든 컨테이너의 CPU와 메모리에 requests = limits가 설정되어 있다 | 가장 마지막에 퇴거 (최고 보호) |
| **Burstable** | requests와 limits가 설정되어 있으나, 값이 다르다 (또는 일부만 설정) | 중간 |
| **BestEffort** | requests와 limits가 모두 미설정이다 | 가장 먼저 퇴거 (최저 보호) |

노드 메모리 부족(MemoryPressure) 시 kubelet의 eviction manager는 다음 순서로 Pod를 퇴거한다:
1. BestEffort Pod 중 메모리 사용량이 가장 높은 Pod
2. Burstable Pod 중 requests 대비 메모리 초과 비율이 가장 높은 Pod
3. Guaranteed Pod (매우 드문 경우)

#### CPU Throttling vs Memory OOMKill 차이

CPU limits 초과 시에는 cgroup의 CPU bandwidth controller가 프로세스의 CPU 시간을 제한한다. 프로세스는 종료되지 않고 느려진다. 100ms 주기에서 limits에 해당하는 시간만큼만 CPU를 사용할 수 있으며, 나머지 시간은 대기한다. 이를 "CPU throttling"이라 한다.

메모리 limits 초과 시에는 리눅스 커널의 OOM Killer가 해당 cgroup의 프로세스를 SIGKILL(신호 9)로 강제 종료한다. 이것이 OOMKilled이며, Exit Code 137(128+9)로 표시된다. 메모리는 CPU와 달리 "빌려줬다가 돌려받기"가 불가능하므로, 초과 시 즉시 프로세스가 종료된다.

#### Step 1: 데모 앱 리소스 설정 확인

```bash
# nginx-web의 리소스 설정
kubectl --context=dev get deployment nginx-web -n demo -o jsonpath='{.spec.template.spec.containers[0].resources}' | python3 -m json.tool

# 출력:
# {
#     "requests": {
#         "cpu": "50m",
#         "memory": "64Mi"
#     },
#     "limits": {
#         "cpu": "200m",
#         "memory": "128Mi"
#     }
# }

# 모든 데모 앱의 리소스 설정 비교
for deploy in nginx-web httpbin-v1 httpbin-v2 redis postgres rabbitmq keycloak; do
  echo "=== $deploy ==="
  kubectl --context=dev get deployment $deploy -n demo -o jsonpath='{.spec.template.spec.containers[0].resources}' 2>/dev/null | python3 -m json.tool 2>/dev/null || echo "(리소스 설정 없음)"
  echo ""
done
```

#### Step 2: QoS 클래스 확인

```bash
# 각 Pod의 QoS 클래스 확인
kubectl --context=dev get pods -n demo -o custom-columns='NAME:.metadata.name,QOS:.status.qosClass'

# 출력 예시:
# NAME                          QOS
# nginx-web-xxxx-aaaa           Burstable    ← requests ≠ limits
# httpbin-v1-xxxx-aaaa          BestEffort   ← requests/limits 없음
# redis-xxxx-aaaa               BestEffort
# postgres-xxxx-aaaa            BestEffort

# QoS 클래스 설명:
# Guaranteed: requests = limits (CPU와 메모리 모두)
# Burstable:  requests < limits (또는 하나만 설정)
# BestEffort: requests/limits 모두 미설정
```

#### Step 3: Guaranteed QoS Pod 생성

```bash
# Guaranteed QoS — requests와 limits가 동일
kubectl --context=dev apply -f - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: guaranteed-pod
  namespace: demo
spec:
  containers:
  - name: app
    image: nginx:1.25
    resources:
      requests:
        cpu: 100m
        memory: 128Mi
      limits:
        cpu: 100m
        memory: 128Mi
EOF

# QoS 확인
kubectl --context=dev get pod guaranteed-pod -n demo -o jsonpath='{.status.qosClass}'
# 출력: Guaranteed
```

#### Step 4: 노드의 Allocatable 리소스 확인

```bash
# 노드별 할당 가능 리소스와 현재 할당량 비교
kubectl --context=dev describe nodes | grep -A20 "Allocated resources"

# 출력 예시:
# Allocated resources:
#   (Total limits may be over 100 percent, i.e., overcommitted.)
#   Resource           Requests      Limits
#   --------           --------      ------
#   cpu                850m (42%)    1600m (80%)
#   memory             512Mi (6%)    1024Mi (12%)

# 리소스 사용량 확인
kubectl --context=dev top nodes
kubectl --context=dev top pods -n demo
```

#### Step 5: 정리

```bash
kubectl --context=dev delete pod guaranteed-pod -n demo
```

**확인 문제**:
1. nginx-web의 QoS 클래스가 Burstable인 이유는 무엇인가?
2. OOMKilled가 발생했을 때, QoS 클래스별 퇴거 우선순위는 어떻게 되는가?
3. `requests`가 스케줄링에 사용되고 `limits`가 런타임 제한에 사용되는 방식을 설명하라.

**확인 문제 풀이**:
1. nginx-web의 리소스 설정은 `requests: 50m/64Mi`, `limits: 200m/128Mi`이다. Guaranteed QoS를 받으려면 모든 컨테이너의 requests와 limits가 **동일**해야 한다 (CPU requests = CPU limits, Memory requests = Memory limits). nginx-web은 requests != limits이므로 Burstable 클래스가 된다. Burstable은 "requests는 있지만 limits와 다른" 상태를 의미한다.
2. 퇴거 우선순위(가장 먼저 퇴거 → 가장 나중에 퇴거): **BestEffort** (requests/limits 미설정) → **Burstable** (requests < limits) → **Guaranteed** (requests = limits). BestEffort Pod가 가장 먼저 퇴거되고, Guaranteed Pod가 가장 마지막에 퇴거된다. 같은 QoS 클래스 내에서는 requests 대비 실제 사용량의 비율이 높은 Pod가 먼저 퇴거된다.
3. **requests**: kube-scheduler가 Pod를 배치할 때 사용한다. 스케줄러는 각 노드의 allocatable 리소스에서 기존 Pod의 requests 합계를 빼고, 남은 공간이 새 Pod의 requests를 수용할 수 있는 노드를 선택한다. requests는 "이 Pod가 최소한 이만큼의 리소스를 보장받아야 한다"는 의미이다. **limits**: kubelet이 런타임에 강제한다. CPU limits는 cgroup의 CPU bandwidth controller로 구현되어 프로세스의 CPU 시간을 제한한다 (throttling). Memory limits는 cgroup의 `memory.limit_in_bytes`로 설정되어, 초과 시 OOM Killer가 프로세스를 종료한다. limits는 "이 Pod가 이 이상의 리소스를 사용할 수 없다"는 상한선이다.

---

### Lab 2.7: Static Pod 확인 (/etc/kubernetes/manifests)

**학습 목표**: Static Pod의 동작 원리를 이해하고, 직접 Static Pod를 생성/삭제한다.

**CKA 관련 도메인**: Workloads & Scheduling (15%)

#### 등장 배경

Static Pod는 kubelet이 직접 관리하는 Pod로, kube-apiserver와 독립적으로 동작한다. 이 메커니즘이 존재하는 이유는 "닭과 달걀" 문제 때문이다: kube-apiserver 자체가 Pod로 실행되려면, kube-apiserver가 없는 상태에서 Pod를 시작할 수 있는 메커니즘이 필요하다. Static Pod가 바로 이 역할을 수행한다.

kubeadm으로 설치한 클러스터에서 kube-apiserver, kube-controller-manager, kube-scheduler, etcd는 모두 Static Pod로 실행된다. 이들의 매니페스트는 `/etc/kubernetes/manifests/`에 위치하며, kubelet이 이 디렉토리를 감시하여 Pod를 관리한다.

#### 내부 동작 원리

1. kubelet은 `--staticPodPath`(기본값: `/etc/kubernetes/manifests/`)에 지정된 디렉토리를 주기적(기본 20초, `--file-check-frequency`)으로 스캔한다.
2. YAML 파일이 추가되면 kubelet이 해당 Pod를 직접 생성한다. 컨테이너 런타임(containerd)에 직접 명령을 보낸다.
3. kubelet은 API Server에 "미러 Pod(mirror pod)"를 생성한다. `kubectl get pods`로 보이는 것은 이 미러 Pod이다.
4. 미러 Pod는 읽기 전용이다. API를 통해 삭제하면 kubelet이 즉시 재생성한다.
5. Static Pod를 실제로 삭제하려면 매니페스트 파일을 해당 디렉토리에서 제거해야 한다.
6. 매니페스트 파일이 수정되면 kubelet이 변경을 감지하여 Pod를 재시작한다. 이것이 kube-apiserver 매니페스트를 수정하여 설정을 변경할 수 있는 이유이다.

#### Static Pod vs 일반 Pod 비교

| 특성 | Static Pod | 일반 Pod |
|---|---|---|
| 관리 주체 | kubelet (직접) | kube-apiserver → kubelet |
| 매니페스트 위치 | 노드의 로컬 파일시스템 | etcd (API를 통해 저장) |
| API로 삭제 가능 여부 | 불가 (미러 Pod만 삭제됨, 즉시 재생성) | 가능 |
| ReplicaSet/Deployment 관리 | 불가 | 가능 |
| 스케줄러 사용 여부 | 불가 (항상 해당 노드에서 실행) | 스케줄러가 노드 선택 |
| kube-apiserver 의존성 | 없음 (API Server 없이도 동작) | 있음 |

#### CKA 시험 출제 패턴

CKA 시험에서 Static Pod 관련 출제 패턴은 다음과 같다:
1. "특정 노드에 Static Pod를 생성하라" → SSH로 접속하여 매니페스트 파일을 생성한다.
2. "워커 노드의 Static Pod 경로를 확인하라" → `/var/lib/kubelet/config.yaml`에서 `staticPodPath`를 확인한다.
3. "Static Pod를 찾아서 삭제하라" → 노드에서 매니페스트 파일을 삭제한다.

#### Step 1: 기존 Static Pod 확인

```bash
# kube-system의 Static Pod 확인 (이름에 노드명이 접미사로 붙는다)
kubectl --context=platform get pods -n kube-system | grep platform-master

# SSH로 매니페스트 디렉토리 확인
ssh admin@<platform-master-ip>
ls -la /etc/kubernetes/manifests/
# etcd.yaml
# kube-apiserver.yaml
# kube-controller-manager.yaml
# kube-scheduler.yaml

# kubelet 설정에서 staticPodPath 확인
sudo grep staticPodPath /var/lib/kubelet/config.yaml
# staticPodPath: /etc/kubernetes/manifests
```

#### Step 2: 커스텀 Static Pod 생성

```bash
# master 노드에서 Static Pod 매니페스트 생성
sudo tee /etc/kubernetes/manifests/static-nginx.yaml << 'EOF'
apiVersion: v1
kind: Pod
metadata:
  name: static-nginx
  labels:
    role: static-web
spec:
  containers:
  - name: nginx
    image: nginx:1.25
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

# kubelet이 자동으로 Static Pod를 생성한다 (수초 대기)
# API Server에서 확인 (이름에 -platform-master 접미사)
kubectl --context=platform get pods --all-namespaces | grep static-nginx
# static-nginx-platform-master   1/1     Running   0   10s
```

#### Step 3: Static Pod 삭제 시도

```bash
# API Server를 통한 삭제 시도 — 삭제되지 않는다 (mirror pod)
kubectl --context=platform delete pod static-nginx-platform-master
# Pod가 즉시 다시 생성된다

kubectl --context=platform get pods | grep static-nginx
# 여전히 Running 상태

# 매니페스트 파일을 삭제해야 Static Pod가 제거된다
sudo rm /etc/kubernetes/manifests/static-nginx.yaml

# 확인 (수초 대기)
kubectl --context=platform get pods | grep static-nginx
# Pod가 사라진다
```

#### Step 4: SSH 접속 종료

```bash
exit
```

**확인 문제**:
1. Static Pod는 어떤 Kubernetes 컴포넌트가 관리하는가?
2. Static Pod를 API Server를 통해 삭제할 수 없는 이유는 무엇인가?
3. Static Pod와 일반 Pod의 차이점 3가지를 설명하라.

**확인 문제 풀이**:
1. **kubelet**이 직접 관리한다. kube-apiserver, kube-controller-manager, kube-scheduler, etcd 등 Control Plane 컴포넌트도 kubelet이 Static Pod로 관리한다. kubelet은 `staticPodPath`에 지정된 디렉토리의 매니페스트 파일을 주기적으로 스캔하고, 파일이 추가/수정/삭제되면 해당 Pod를 생성/재시작/삭제한다. kube-apiserver와 독립적으로 동작하므로, API Server가 다운되어도 Static Pod는 계속 실행된다.
2. `kubectl delete pod`로 삭제하는 것은 미러 Pod(mirror pod)만 삭제하는 것이다. 미러 Pod는 kubelet이 API Server에 생성한 읽기 전용 복사본이다. 미러 Pod가 삭제되어도 실제 Static Pod는 kubelet에 의해 계속 실행 중이며, kubelet이 즉시 새 미러 Pod를 생성한다. Static Pod를 실제로 제거하려면 해당 노드의 `staticPodPath` 디렉토리에서 매니페스트 파일을 삭제해야 한다.
3. (1) **관리 주체**: Static Pod는 kubelet이, 일반 Pod는 kube-apiserver → kube-controller-manager → kubelet 체인으로 관리된다. (2) **API Server 의존성**: Static Pod는 API Server 없이도 동작하지만, 일반 Pod는 API Server가 정상이어야 생성/관리된다. (3) **ReplicaSet/Deployment 관리**: Static Pod는 Deployment, ReplicaSet 등 상위 컨트롤러에 의해 관리될 수 없다. 일반 Pod는 Deployment, StatefulSet, Job 등에 의해 관리된다. (추가) Static Pod의 이름에는 노드명이 접미사로 자동 추가된다 (예: `static-nginx-platform-master`).

---

### Lab 2.8: DaemonSet 관리 (Cilium DaemonSet 분석)

**학습 목표**: tart-infra에서 사용 중인 Cilium DaemonSet을 분석하고, DaemonSet의 동작 원리를 이해한다.

**CKA 관련 도메인**: Workloads & Scheduling (15%)

#### 등장 배경

DaemonSet은 클러스터의 모든 노드(또는 특정 노드)에 정확히 하나의 Pod를 실행하는 워크로드 리소스이다. Deployment가 "N개의 Pod를 어딘가에 실행"하는 것이라면, DaemonSet은 "각 노드에 정확히 1개의 Pod를 실행"한다.

DaemonSet의 일반적인 사용 사례:
- **CNI 플러그인**: Cilium, Calico 등 네트워크 에이전트가 모든 노드에서 실행되어야 한다.
- **로그 수집**: Fluentd, Filebeat 등 로그 에이전트가 각 노드의 로그를 수집한다.
- **노드 모니터링**: Prometheus Node Exporter가 각 노드의 메트릭을 수집한다.
- **스토리지**: local-path-provisioner 등 노드 로컬 스토리지 관리자.

#### 내부 동작 원리

DaemonSet 컨트롤러의 동작은 다음과 같다:

1. 클러스터의 모든 노드 목록을 조회한다.
2. 각 노드에 DaemonSet Pod가 실행 중인지 확인한다.
3. Pod가 없는 노드에 새 Pod를 생성한다. Pod의 `nodeName` 필드를 직접 설정하여 스케줄러를 우회한다 (Kubernetes 1.12 이전). 1.12 이후에는 `nodeAffinity`를 사용하여 스케줄러를 통해 배치한다.
4. 노드가 클러스터에서 제거되면 해당 노드의 DaemonSet Pod도 자동 삭제된다.
5. 새 노드가 추가되면 DaemonSet 컨트롤러가 자동으로 해당 노드에 Pod를 생성한다.

#### DaemonSet과 Taint의 상호작용

DaemonSet Pod는 기본적으로 마스터 노드의 `control-plane:NoSchedule` Taint를 허용하지 않는다. 마스터 노드에도 DaemonSet Pod를 배치하려면 `tolerations`를 명시적으로 추가해야 한다. tart-infra의 Cilium DaemonSet에는 `control-plane:NoSchedule` Taint에 대한 Toleration이 설정되어 있어 마스터 노드에서도 실행된다.

DaemonSet의 updateStrategy는 `RollingUpdate`(기본값) 또는 `OnDelete`이다:
- `RollingUpdate`: 이미지 변경 시 자동으로 각 노드의 Pod를 순차적으로 교체한다. `maxUnavailable`로 동시 업데이트 수를 제어한다.
- `OnDelete`: 관리자가 수동으로 Pod를 삭제해야 새 버전이 배포된다.

#### Step 1: 기존 DaemonSet 확인

```bash
# 모든 클러스터의 DaemonSet 확인
for ctx in platform dev staging prod; do
  echo "=== $ctx ==="
  kubectl --context=$ctx get daemonsets --all-namespaces
  echo ""
done
```

#### Step 2: Cilium DaemonSet 상세 분석

```bash
# Cilium DaemonSet 상세 확인
kubectl --context=dev describe daemonset cilium -n kube-system

# 주요 확인 항목:
# - Node-Selector: <none> (모든 노드에 배포)
# - Desired Number of Nodes Scheduled: 2 (dev 클러스터 노드 수)
# - Current Number of Nodes Scheduled: 2
# - Number Ready: 2

# Cilium Pod가 각 노드에 하나씩 실행 중인지 확인
kubectl --context=dev get pods -n kube-system -l k8s-app=cilium -o wide
# dev-master에 1개, dev-worker1에 1개

# updateStrategy 확인
kubectl --context=dev get daemonset cilium -n kube-system -o jsonpath='{.spec.updateStrategy}'
```

#### Step 3: 커스텀 DaemonSet 생성

```bash
# 로그 수집용 DaemonSet 생성
kubectl --context=dev apply -f - <<EOF
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: log-agent
  namespace: demo
spec:
  selector:
    matchLabels:
      app: log-agent
  template:
    metadata:
      labels:
        app: log-agent
    spec:
      tolerations:
      - key: node-role.kubernetes.io/control-plane
        operator: Exists
        effect: NoSchedule
      containers:
      - name: agent
        image: busybox:1.36
        command: ["sh", "-c", "while true; do echo \$(hostname) \$(date) collecting logs; sleep 60; done"]
        resources:
          requests:
            cpu: 10m
            memory: 32Mi
          limits:
            cpu: 50m
            memory: 64Mi
        volumeMounts:
        - name: varlog
          mountPath: /var/log
          readOnly: true
      volumes:
      - name: varlog
        hostPath:
          path: /var/log
EOF

# DaemonSet Pod가 모든 노드에 배포되었는지 확인
kubectl --context=dev get pods -n demo -l app=log-agent -o wide

# 로그 확인
kubectl --context=dev logs -n demo -l app=log-agent --tail=3
```

#### Step 4: 정리

```bash
kubectl --context=dev delete daemonset log-agent -n demo
```

**확인 문제**:
1. DaemonSet에 Toleration을 추가하지 않으면 master 노드에 Pod가 배치되는가?
2. DaemonSet과 Deployment의 핵심 차이점은 무엇인가?
3. Cilium DaemonSet의 updateStrategy가 `RollingUpdate`인 경우, 업데이트 시 어떻게 동작하는가?

**확인 문제 풀이**:
1. 배치되지 않는다. master 노드에는 `node-role.kubernetes.io/control-plane:NoSchedule` Taint가 설정되어 있으므로, 이 Taint를 허용하는 Toleration이 없으면 DaemonSet Pod도 master 노드에 배치되지 않는다. 로그 수집기, 모니터링 에이전트 등 모든 노드에서 실행되어야 하는 DaemonSet에는 다음 Toleration을 추가해야 한다: `{key: "node-role.kubernetes.io/control-plane", operator: "Exists", effect: "NoSchedule"}`.
2. **DaemonSet**: 각 노드에 정확히 1개의 Pod를 실행한다. 노드가 추가되면 자동으로 해당 노드에 Pod를 생성하고, 노드가 제거되면 Pod를 삭제한다. replicas 필드가 없다 (노드 수에 의해 결정). **Deployment**: N개의 Pod를 클러스터의 어딘가에 분산 실행한다. replicas 필드로 Pod 수를 지정한다. 스케줄러가 최적의 노드를 선택하여 배치한다. Rolling Update, 롤백, 스케일링 기능을 제공한다.
3. `RollingUpdate` updateStrategy에서는 DaemonSet 이미지가 변경되면, 각 노드의 Pod를 순차적으로 교체한다. 기본적으로 한 번에 하나의 노드만 업데이트한다 (`maxUnavailable: 1`). 해당 노드의 기존 Pod를 삭제하고 새 Pod를 생성한다. 새 Pod가 Ready 상태가 되면 다음 노드의 Pod를 교체한다. CNI 플러그인(Cilium)의 경우, Pod 교체 중 해당 노드의 네트워킹이 일시적으로 불안정할 수 있으므로 `maxUnavailable: 1`을 유지하는 것이 안전하다.

---

### Lab 2.9: Job 생성 (busybox 일회성 작업)

**학습 목표**: Job 리소스를 생성하여 일회성 작업을 수행하고, completions와 parallelism을 이해한다.

#### 등장 배경

Deployment/ReplicaSet은 "항상 실행 중"이어야 하는 서비스에 적합하지만, 데이터 마이그레이션, 배치 처리, 보고서 생성 등 "실행 후 완료되는" 작업에는 적합하지 않다. 이러한 작업에 Deployment를 사용하면, 작업 완료 후 컨테이너가 종료되었을 때 `restartPolicy: Always`에 의해 계속 재시작되는 문제가 발생한다.

Job은 이 문제를 해결한다. Job의 `restartPolicy`는 `Never` 또는 `OnFailure`만 허용되며, `Always`는 사용할 수 없다. 컨테이너가 성공적으로 완료되면(exit code 0) Job이 완료 상태로 전환된다.

#### 내부 동작 원리

Job 컨트롤러의 동작은 다음과 같다:

1. `completions`만큼의 Pod가 성공적으로 완료되면 Job이 완료된다.
2. `parallelism`은 동시에 실행할 수 있는 Pod의 최대 수이다.
3. Pod가 실패하면(exit code != 0) `restartPolicy`에 따라 처리된다:
   - `Never`: 실패한 Pod를 남겨두고 새 Pod를 생성한다. `backoffLimit`까지 재시도한다.
   - `OnFailure`: 동일 Pod의 컨테이너를 재시작한다. `backoffLimit`까지 재시도한다.
4. `backoffLimit`(기본 6)을 초과하면 Job이 Failed 상태로 전환된다.
5. 재시도 간격은 지수적 백오프(10s, 20s, 40s, ..., 최대 6분)로 증가한다.

CronJob은 Job 위에 cron 스케줄러를 추가한 것이다. 지정된 스케줄에 따라 Job을 자동 생성한다. `concurrencyPolicy`로 이전 Job이 실행 중일 때의 동작을 제어할 수 있다:
- `Allow`: 동시 실행 허용 (기본값)
- `Forbid`: 이전 Job이 완료될 때까지 새 Job 생성을 건너뛴다
- `Replace`: 이전 Job을 삭제하고 새 Job을 생성한다

**CKA 관련 도메인**: Workloads & Scheduling (15%)

#### Step 1: 기본 Job 생성

```bash
# 간단한 일회성 Job 생성 (명령형)
kubectl --context=dev create job hello-job \
  --image=busybox:1.36 \
  -n demo \
  -- sh -c "echo 'Hello from tart-infra Job!' && date && sleep 5 && echo 'Job completed'"

# Job 상태 확인
kubectl --context=dev get jobs -n demo
# NAME        COMPLETIONS   DURATION   AGE
# hello-job   1/1           8s         15s

# Job이 생성한 Pod 확인
kubectl --context=dev get pods -n demo -l job-name=hello-job

# Job 로그 확인
kubectl --context=dev logs job/hello-job -n demo
# Hello from tart-infra Job!
# Thu Mar 19 14:30:22 UTC 2026
# Job completed
```

#### Step 2: completions와 parallelism 설정

```bash
# 3번 완료해야 하는 Job (병렬 2개)
kubectl --context=dev apply -f - <<EOF
apiVersion: batch/v1
kind: Job
metadata:
  name: parallel-job
  namespace: demo
spec:
  completions: 3
  parallelism: 2
  backoffLimit: 4
  template:
    spec:
      restartPolicy: Never
      containers:
      - name: worker
        image: busybox:1.36
        command: ["sh", "-c", "echo Processing item on \$(hostname) && sleep 10 && echo Done"]
        resources:
          requests:
            cpu: 50m
            memory: 32Mi
EOF

# 진행 상태 확인 (2개가 동시에 실행되고, 총 3번 완료)
kubectl --context=dev get pods -n demo -l job-name=parallel-job -w

# Job 완료 확인
kubectl --context=dev get job parallel-job -n demo
# COMPLETIONS: 3/3
```

#### Step 3: 실패하는 Job 테스트

```bash
# 실패하는 Job (backoffLimit 테스트)
kubectl --context=dev apply -f - <<EOF
apiVersion: batch/v1
kind: Job
metadata:
  name: failing-job
  namespace: demo
spec:
  backoffLimit: 3
  template:
    spec:
      restartPolicy: Never
      containers:
      - name: fail
        image: busybox:1.36
        command: ["sh", "-c", "echo 'About to fail...' && exit 1"]
EOF

# 재시도 관찰
kubectl --context=dev get pods -n demo -l job-name=failing-job
# 3번 재시도 후 실패

# Job 상태 확인
kubectl --context=dev describe job failing-job -n demo | grep -A5 "Conditions"
```

#### Step 4: 정리

```bash
kubectl --context=dev delete job hello-job parallel-job failing-job -n demo
```

**확인 문제**:
1. `completions`와 `parallelism`의 차이는 무엇인가?
2. `backoffLimit`을 초과하면 Job의 상태는 어떻게 되는가?
3. Job의 `restartPolicy`에 `Always`를 사용할 수 없는 이유는 무엇인가?

**확인 문제 풀이**:
1. `completions`는 Job이 완료되기 위해 필요한 성공적인 Pod 완료 횟수이다. 기본값은 1이다. `parallelism`은 동시에 실행할 수 있는 Pod의 최대 수이다. 기본값은 1이다. 예: `completions=6, parallelism=3`이면 3개의 Pod가 동시에 실행되고, 총 6번의 성공적인 완료가 필요하다. 첫 3개가 완료되면 나머지 3개가 시작된다.
2. `backoffLimit`(기본 6)을 초과하면 Job의 상태가 **Failed**로 전환된다. Job 컨트롤러는 더 이상 재시도하지 않는다. `kubectl get job <name>` 출력에서 COMPLETIONS 컬럼에 `0/1`과 같이 표시되고, `kubectl describe job <name>`의 Conditions에 `type: Failed, reason: BackoffLimitExceeded`가 표시된다. 실패한 Pod들은 삭제되지 않고 남아 있어 로그를 확인할 수 있다.
3. Job의 목적은 "실행 후 완료"이다. `restartPolicy: Always`를 사용하면 컨테이너가 성공적으로 완료(exit code 0)되어도 kubelet이 컨테이너를 재시작한다. 이는 Job의 "완료" 개념과 모순된다. 따라서 Job에서는 `Never`(실패 시 새 Pod 생성) 또는 `OnFailure`(실패 시 같은 Pod에서 컨테이너 재시작)만 허용된다.

---

### Lab 2.10: CronJob 생성 (1분마다 날짜 출력)

**학습 목표**: CronJob을 생성하여 주기적 작업을 스케줄링한다.

**CKA 관련 도메인**: Workloads & Scheduling (15%)

#### Step 1: CronJob 생성 (명령형)

```bash
# 1분마다 실행되는 CronJob 생성
kubectl --context=dev create cronjob date-printer \
  --image=busybox:1.36 \
  --schedule="*/1 * * * *" \
  -n demo \
  -- sh -c "echo 'Current time: $(date)' && echo 'Running on tart-infra dev cluster'"

# CronJob 확인
kubectl --context=dev get cronjobs -n demo
# NAME           SCHEDULE      SUSPEND   ACTIVE   LAST SCHEDULE   AGE
# date-printer   */1 * * * *   False     0        <none>          5s
```

#### Step 2: CronJob 실행 관찰

```bash
# 1분 후 Job이 생성되는지 확인
kubectl --context=dev get jobs -n demo -w

# 생성된 Job의 Pod 로그 확인
kubectl --context=dev get pods -n demo -l job-name --sort-by=.metadata.creationTimestamp
kubectl --context=dev logs -n demo -l job-name --tail=5
```

#### Step 3: CronJob YAML로 생성 (고급 설정)

```bash
# 히스토리 유지, 동시 실행 제어 등 고급 설정
kubectl --context=dev apply -f - <<EOF
apiVersion: batch/v1
kind: CronJob
metadata:
  name: health-reporter
  namespace: demo
spec:
  schedule: "*/2 * * * *"
  concurrencyPolicy: Forbid
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 1
  startingDeadlineSeconds: 60
  jobTemplate:
    spec:
      template:
        spec:
          restartPolicy: OnFailure
          containers:
          - name: reporter
            image: busybox:1.36
            command:
            - sh
            - -c
            - |
              echo "=== Health Report ==="
              echo "Time: $(date)"
              echo "Hostname: $(hostname)"
              echo "===================="
            resources:
              requests:
                cpu: 10m
                memory: 16Mi
EOF

# CronJob 확인
kubectl --context=dev get cronjob health-reporter -n demo -o yaml | grep -A5 spec
```

#### Step 4: CronJob 일시 중지/재개

```bash
# CronJob 일시 중지
kubectl --context=dev patch cronjob date-printer -n demo -p '{"spec":{"suspend":true}}'

# 확인
kubectl --context=dev get cronjob date-printer -n demo
# SUSPEND: True

# 재개
kubectl --context=dev patch cronjob date-printer -n demo -p '{"spec":{"suspend":false}}'
```

#### Step 5: 정리

```bash
kubectl --context=dev delete cronjob date-printer health-reporter -n demo
```

**확인 문제**:
1. `concurrencyPolicy: Forbid`는 어떤 동작을 하는가?
2. CronJob 스케줄 표현식 `*/5 * * * *`의 의미는 무엇인가?
3. `successfulJobsHistoryLimit`을 0으로 설정하면 어떻게 되는가?

**확인 문제 풀이**:
1. `concurrencyPolicy: Forbid`는 이전 Job이 아직 실행 중일 때 새 Job 생성을 건너뛴다. 예를 들어 CronJob이 매 1분마다 실행되도록 설정되어 있고, 이전 Job이 2분 동안 실행 중이라면, 1분 후의 스케줄에서 새 Job이 생성되지 않는다. 이는 장시간 실행되는 작업이 중복 실행되는 것을 방지한다. `Allow`(기본값)는 동시 실행을 허용하고, `Replace`는 이전 Job을 삭제하고 새 Job을 생성한다.
2. `*/5 * * * *`는 "5분마다" 실행한다는 의미이다. cron 표현식 형식: `분 시 일 월 요일`. `*/5`는 "0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55분"에 실행된다. 추가 예시: `0 */2 * * *`(2시간마다 정시에), `0 9 * * 1-5`(평일 09:00에), `*/1 * * * *`(1분마다).
3. `successfulJobsHistoryLimit: 0`으로 설정하면 성공적으로 완료된 Job과 Pod가 즉시 삭제된다. 로그를 확인할 수 없으므로 디버깅이 어려워진다. 기본값은 3이며, 최근 3개의 성공 Job만 보존한다. `failedJobsHistoryLimit`(기본값 1)은 실패한 Job의 보존 수를 결정한다.

---

## 실습 3: Services & Networking (20%)

> CKA 시험의 20%를 차지하는 도메인이다. Service 유형, NetworkPolicy, DNS, CNI, Ingress 등이 출제 범위이다.

### 등장 배경

Kubernetes의 네트워킹 모델은 "모든 Pod는 다른 모든 Pod와 NAT 없이 직접 통신할 수 있다"는 기본 원칙 위에 구축되었다. 이 "flat network" 모델은 개발 편의성을 제공하지만, 보안 경계가 없다는 한계가 있다. NetworkPolicy는 이 한계를 해결하기 위해 도입되었으며, Pod 간 트래픽을 레이블 기반으로 제어한다.

Service는 Pod의 동적 IP 문제를 해결한다. Pod는 생성/삭제 시마다 새 IP를 할당받으므로, 클라이언트가 Pod IP를 직접 사용하면 통신이 불안정해진다. Service는 안정적인 가상 IP(ClusterIP)와 DNS 이름을 제공하여 이 문제를 해결한다. 내부적으로 Service는 kube-proxy(또는 Cilium eBPF)가 생성하는 NAT 규칙을 통해 트래픽을 백엔드 Pod로 분배한다.

#### Service 내부 동작 원리

ClusterIP Service가 생성되면 다음 과정이 발생한다:

1. kube-apiserver가 Service 오브젝트를 etcd에 저장한다.
2. kube-controller-manager의 Endpoint 컨트롤러가 Service의 selector와 일치하는 Pod를 찾아 Endpoint(또는 EndpointSlice) 오브젝트를 생성한다.
3. kube-proxy(또는 Cilium)가 Endpoint 변경을 감지하고, 각 노드에서 NAT 규칙을 생성한다.
4. 클라이언트가 Service ClusterIP로 요청을 보내면, NAT 규칙이 요청을 백엔드 Pod 중 하나로 리다이렉트한다.
5. Pod가 종료되면 Endpoint 컨트롤러가 해당 Pod를 Endpoint에서 제거하고, kube-proxy가 NAT 규칙을 업데이트한다.

NodePort Service는 ClusterIP에 추가로, 모든 노드의 특정 포트(30000-32767)에서 트래픽을 수신하여 Service로 전달한다. 이를 통해 클러스터 외부에서 Service에 접근할 수 있다.

#### NetworkPolicy 내부 동작 원리

NetworkPolicy는 CNI 플러그인에 의해 구현된다. tart-infra에서 사용하는 Cilium의 경우, eBPF 프로그램이 각 Pod의 네트워크 인터페이스에 부착되어 패킷을 필터링한다. NetworkPolicy 동작의 핵심 규칙은 다음과 같다:

1. NetworkPolicy가 하나도 없는 네임스페이스에서는 모든 트래픽이 허용된다 (기본 allow-all).
2. 특정 Pod에 적용되는 NetworkPolicy가 하나라도 존재하면, 해당 Pod는 **명시적으로 허용된 트래픽만** 수신/발신할 수 있다.
3. NetworkPolicy는 추가적(additive)이다. 여러 정책이 있으면 허용 규칙이 합산된다. 거부 규칙은 존재하지 않는다.
4. Ingress와 Egress는 독립적으로 제어된다. Ingress 정책만 설정하면 Egress는 영향받지 않는다.

**Flannel은 NetworkPolicy를 지원하지 않는다.** Calico, Cilium, Weave Net 등이 NetworkPolicy를 지원하며, tart-infra는 Cilium을 사용한다.

---

### Lab 3.1: Service 유형 비교 (ClusterIP vs NodePort 실제 비교)

**학습 목표**: ClusterIP와 NodePort Service의 차이를 실제 tart-infra 환경에서 확인한다.

**CKA 관련 도메인**: Services & Networking (20%)

#### Step 1: 기존 Service 확인

```bash
# demo 네임스페이스의 모든 Service 확인
kubectl --context=dev get svc -n demo

# 출력 예시:
# NAME          TYPE        CLUSTER-IP       EXTERNAL-IP   PORT(S)          AGE
# nginx-web     NodePort    10.97.x.x        <none>        80:30080/TCP     30d
# httpbin       ClusterIP   10.97.x.x        <none>        80/TCP           30d
# redis         ClusterIP   10.97.x.x        <none>        6379/TCP         30d
# postgres      ClusterIP   10.97.x.x        <none>        5432/TCP         30d
# rabbitmq      ClusterIP   10.97.x.x        <none>        5672/TCP         30d
# keycloak      NodePort    10.97.x.x        <none>        8080:30880/TCP   30d

# Service CIDR 범위 확인 — 모든 ClusterIP가 10.97.0.0/16 범위 안에 있는지 확인
kubectl --context=dev get svc -n demo -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.clusterIP}{"\n"}{end}'
```

#### Step 2: ClusterIP Service 생성 및 테스트

```bash
# 테스트용 Deployment 생성
kubectl --context=dev create deployment svc-test --image=nginx:1.25 --replicas=2 -n demo

# ClusterIP Service 생성
kubectl --context=dev expose deployment svc-test --port=80 --target-port=80 --type=ClusterIP --name=svc-test-clusterip -n demo

# 클러스터 내부에서 접근 테스트
kubectl --context=dev run curl-test --rm -it --image=curlimages/curl -n demo \
  -- curl -s http://svc-test-clusterip.demo.svc.cluster.local

# 외부에서는 접근 불가 (ClusterIP는 클러스터 내부 전용)
```

#### Step 3: NodePort Service 생성 및 테스트

```bash
# NodePort Service 생성
kubectl --context=dev expose deployment svc-test --port=80 --target-port=80 --type=NodePort --name=svc-test-nodeport -n demo

# 할당된 NodePort 확인
kubectl --context=dev get svc svc-test-nodeport -n demo
# PORT(S): 80:3xxxx/TCP

# 외부에서 접근 테스트 (노드 IP + NodePort)
NODE_IP=$(kubectl --context=dev get nodes -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}')
NODE_PORT=$(kubectl --context=dev get svc svc-test-nodeport -n demo -o jsonpath='{.spec.ports[0].nodePort}')
echo "접근 URL: http://$NODE_IP:$NODE_PORT"

# nginx-web의 NodePort 30080 테스트
echo "nginx-web: http://$NODE_IP:30080"

# keycloak의 NodePort 30880 테스트
echo "keycloak: http://$NODE_IP:30880"
```

#### Step 4: 정리

```bash
kubectl --context=dev delete deployment svc-test -n demo
kubectl --context=dev delete svc svc-test-clusterip svc-test-nodeport -n demo
```

#### Service 유형별 내부 동작 상세

**ClusterIP 내부 동작**: kube-apiserver가 `--service-cluster-ip-range`에서 사용되지 않은 IP를 할당한다. 이 IP는 가상 IP(VIP)로, 어떤 네트워크 인터페이스에도 바인딩되지 않는다. kube-proxy(또는 Cilium eBPF)가 이 VIP로 향하는 패킷을 인터셉트하여 DNAT(Destination NAT)를 수행한다.

**NodePort 내부 동작**: ClusterIP에 추가로, kube-proxy가 모든 노드의 지정된 포트에서 리스닝한다. 외부 트래픽이 `<NodeIP>:<NodePort>`로 도착하면, kube-proxy가 해당 트래픽을 ClusterIP → 백엔드 Pod로 전달한다. 이때 Source NAT(SNAT)가 적용되어 백엔드 Pod에서는 클라이언트의 실제 IP가 아닌 노드의 IP가 보인다. `externalTrafficPolicy: Local`을 설정하면 SNAT을 방지하고 클라이언트 IP를 보존할 수 있지만, 해당 노드에 Pod가 없으면 트래픽이 드롭된다.

**확인 문제**:
1. ClusterIP Service의 IP는 어느 CIDR 범위에서 할당되는가?
2. NodePort의 기본 범위는 무엇인가?
3. tart-infra에서 NodePort를 사용하는 서비스 목록을 말하라.

**확인 문제 풀이**:
1. kube-apiserver의 `--service-cluster-ip-range` 플래그에 지정된 CIDR 범위에서 할당된다. dev 클러스터의 경우 `10.97.0.0/16`이므로, 모든 ClusterIP는 `10.97.x.x` 범위에 속한다. 첫 번째 IP(10.97.0.1)는 `kubernetes` Service에 예약된다.
2. NodePort의 기본 범위는 30000-32767이다. 이 범위는 kube-apiserver의 `--service-node-port-range` 플래그로 변경할 수 있다. 30000 미만의 포트는 시스템 서비스와 충돌할 수 있으므로 사용하지 않는다.
3. tart-infra에서 NodePort를 사용하는 서비스: nginx-web(30080), keycloak(30880), Grafana(30300), AlertManager(30903), ArgoCD(30800), Jenkins(30900).

---

### Lab 3.2: Service Endpoint 확인 및 Pod 매핑

**학습 목표**: Service와 Endpoint의 관계를 이해하고, Pod 매핑이 어떻게 이루어지는지 확인한다.

**CKA 관련 도메인**: Services & Networking (20%)

#### Step 1: Endpoint 확인

```bash
# nginx-web Service의 Endpoint 확인
kubectl --context=dev get endpoints nginx-web -n demo

# 출력 예시:
# NAME        ENDPOINTS                                    AGE
# nginx-web   10.20.x.x:80,10.20.x.y:80,10.20.x.z:80     30d

# Endpoint의 IP가 Pod IP와 일치하는지 확인
kubectl --context=dev get pods -n demo -l app=nginx-web -o wide

# EndpointSlice도 확인 (Kubernetes 1.21+에서 선호)
kubectl --context=dev get endpointslices -n demo | grep nginx-web
kubectl --context=dev describe endpointslice -n demo -l kubernetes.io/service-name=nginx-web
```

#### Step 2: selector 불일치 테스트

```bash
# selector가 없는 Service 생성 (Endpoint가 비어 있다)
kubectl --context=dev apply -f - <<EOF
apiVersion: v1
kind: Service
metadata:
  name: no-endpoint-svc
  namespace: demo
spec:
  ports:
  - port: 80
    targetPort: 80
  selector:
    app: nonexistent-app
EOF

# Endpoint 확인 — 비어 있다
kubectl --context=dev get endpoints no-endpoint-svc -n demo
# ENDPOINTS: <none>

# selector를 올바르게 수정
kubectl --context=dev patch svc no-endpoint-svc -n demo -p '{"spec":{"selector":{"app":"nginx-web"}}}'

# Endpoint가 채워졌는지 확인
kubectl --context=dev get endpoints no-endpoint-svc -n demo
# ENDPOINTS: 10.20.x.x:80,10.20.x.y:80,10.20.x.z:80
```

#### Step 3: 정리

```bash
kubectl --context=dev delete svc no-endpoint-svc -n demo
```

#### Endpoint 내부 동작 원리

Endpoint는 Service와 Pod 사이의 매핑 정보를 담는 리소스이다. kube-controller-manager의 EndpointSlice 컨트롤러(Kubernetes 1.21+)가 Service의 selector와 일치하는 Pod를 찾아 EndpointSlice를 생성/업데이트한다.

EndpointSlice가 업데이트되는 시점:
1. 새 Pod가 생성되고 Ready 상태가 된다 → Endpoint에 추가
2. Pod가 삭제된다 → Endpoint에서 제거
3. Pod의 readinessProbe가 실패한다 → Endpoint에서 제거 (Not Ready)
4. Pod의 IP가 변경된다 → 이전 IP 제거, 새 IP 추가

**확인 문제**:
1. Service의 Endpoint가 비어 있으면 어떤 증상이 나타나는가?
2. Endpoint가 비어 있는 가장 흔한 원인 3가지는 무엇인가?
3. EndpointSlice와 Endpoints 리소스의 차이는 무엇인가?

**확인 문제 풀이**:
1. Service ClusterIP나 DNS 이름으로 접근하면 연결이 타임아웃된다. kube-proxy의 NAT 규칙에 백엔드 IP가 없으므로 패킷이 전달되지 않는다. `curl -s --max-time 3 http://<service>` 실행 시 타임아웃이 발생한다.
2. (1) Service의 `selector` 레이블이 Pod의 레이블과 일치하지 않는다 — 가장 흔한 원인이며, CKA 시험의 트러블슈팅 문제에서 자주 출제된다. (2) Pod가 `Ready` 상태가 아니다 — readinessProbe가 실패하면 Endpoint에서 제거된다. (3) Pod가 아직 생성되지 않았거나 모두 종료되었다.
3. Endpoints(구 버전)는 하나의 리소스에 모든 백엔드 IP를 저장한다. 대규모 서비스(수천 개 Pod)에서 Endpoints 리소스 크기가 etcd의 단일 오브젝트 크기 제한(1.5MB)을 초과할 수 있다. EndpointSlice(Kubernetes 1.21+)는 기본 100개 endpoint씩 분할하여 저장한다. 대규모 환경에서 효율적이며, 업데이트 시 변경된 슬라이스만 전파하므로 네트워크 부하가 감소한다.

---

### Lab 3.3: Headless Service 생성 및 DNS 확인

**학습 목표**: Headless Service의 동작 방식과 DNS 레코드를 이해한다.

**CKA 관련 도메인**: Services & Networking (20%)

#### Step 1: Headless Service 생성

```bash
# Headless Service 생성 (clusterIP: None)
kubectl --context=dev apply -f - <<EOF
apiVersion: v1
kind: Service
metadata:
  name: nginx-headless
  namespace: demo
spec:
  clusterIP: None
  selector:
    app: nginx-web
  ports:
  - port: 80
    targetPort: 80
EOF

# Service 확인 — CLUSTER-IP가 None
kubectl --context=dev get svc nginx-headless -n demo
# NAME             TYPE        CLUSTER-IP   EXTERNAL-IP   PORT(S)   AGE
# nginx-headless   ClusterIP   None         <none>        80/TCP    5s
```

#### Step 2: DNS 차이 비교

```bash
# 일반 Service의 DNS — ClusterIP 1개 반환
kubectl --context=dev run dns-test --rm -it --image=busybox:1.36 -n demo \
  -- nslookup nginx-web.demo.svc.cluster.local

# 출력:
# Name:      nginx-web.demo.svc.cluster.local
# Address:   10.97.x.x                               ← ClusterIP 1개

# Headless Service의 DNS — Pod IP 여러 개 반환
kubectl --context=dev run dns-test2 --rm -it --image=busybox:1.36 -n demo \
  -- nslookup nginx-headless.demo.svc.cluster.local

# 출력:
# Name:      nginx-headless.demo.svc.cluster.local
# Address:   10.20.x.x                               ← Pod IP #1
# Address:   10.20.x.y                               ← Pod IP #2
# Address:   10.20.x.z                               ← Pod IP #3
```

#### Step 3: 정리

```bash
kubectl --context=dev delete svc nginx-headless -n demo
```

#### Headless Service 내부 동작 원리

일반 ClusterIP Service와 Headless Service의 DNS 동작 차이:

- **일반 Service**: `nslookup nginx-web.demo.svc.cluster.local` → ClusterIP 1개 반환. 클라이언트는 이 VIP로 요청하고, kube-proxy가 백엔드 Pod로 분배한다.
- **Headless Service** (`clusterIP: None`): `nslookup nginx-headless.demo.svc.cluster.local` → 모든 백엔드 Pod의 IP가 반환된다. 클라이언트가 직접 Pod IP를 선택하여 요청한다. kube-proxy의 중간 매개가 없다.

이 차이가 중요한 이유: 데이터베이스 클러스터(PostgreSQL, MySQL)에서 클라이언트는 마스터/슬레이브를 구분하여 접속해야 한다. Headless Service를 사용하면 각 Pod의 개별 IP가 반환되므로, 클라이언트가 특정 Pod에 직접 접속할 수 있다.

**확인 문제**:
1. Headless Service는 어떤 유형의 애플리케이션에 적합한가?
2. StatefulSet에서 Headless Service를 사용하는 이유는 무엇인가?
3. Headless Service의 DNS 응답이 일반 Service와 다른 점은 무엇인가?

**확인 문제 풀이**:
1. 각 Pod에 직접 접근해야 하는 stateful 애플리케이션에 적합하다. 예: 데이터베이스 클러스터(PostgreSQL, MySQL, MongoDB), 분산 캐시(Redis Cluster), 메시지 큐(Kafka, RabbitMQ 클러스터). 이들은 각 인스턴스의 역할(마스터/슬레이브, 리더/팔로워)이 다르므로 개별 접근이 필요하다.
2. StatefulSet은 각 Pod에 안정적인 네트워크 ID(`web-0`, `web-1`, `web-2`)를 부여한다. Headless Service와 결합하면 `web-0.nginx-headless.default.svc.cluster.local`과 같은 고유 DNS 이름이 각 Pod에 할당된다. Pod가 재시작되어도 동일한 DNS 이름이 유지되므로, 다른 컴포넌트가 특정 Pod를 안정적으로 참조할 수 있다.
3. 일반 Service의 DNS는 A 레코드 1개(ClusterIP)를 반환한다. Headless Service의 DNS는 A 레코드 N개(모든 Ready Pod의 IP)를 반환한다. 클라이언트측 DNS 라이브러리가 라운드로빈으로 IP를 선택하거나, 애플리케이션이 모든 IP를 받아 자체 로직으로 연결 대상을 선택한다.

---

### Lab 3.4: NodePort로 외부 접근 테스트 (nginx:30080, keycloak:30880)

**학습 목표**: tart-infra에서 NodePort로 노출된 서비스에 실제로 접근한다.

**CKA 관련 도메인**: Services & Networking (20%)

#### Step 1: NodePort 서비스 목록 확인

```bash
# demo 네임스페이스의 NodePort 서비스
kubectl --context=dev get svc -n demo --field-selector spec.type=NodePort

# 전체 클러스터의 NodePort 서비스
kubectl --context=dev get svc --all-namespaces --field-selector spec.type=NodePort

# 노드 IP 확인
kubectl --context=dev get nodes -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.status.addresses[?(@.type=="InternalIP")].address}{"\n"}{end}'
```

#### Step 2: nginx-web (30080) 접근 테스트

```bash
# 클러스터 내부에서 NodePort로 접근
kubectl --context=dev run curl-nginx --rm -it --image=curlimages/curl -n demo \
  -- curl -s -o /dev/null -w "HTTP Status: %{http_code}\n" http://nginx-web.demo.svc.cluster.local:80

# 노드 IP로 접근 (외부 접근 시뮬레이션)
NODE_IP=$(kubectl --context=dev get nodes -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}')
kubectl --context=dev run curl-nodeport --rm -it --image=curlimages/curl -n demo \
  -- curl -s -o /dev/null -w "HTTP Status: %{http_code}\n" http://$NODE_IP:30080
```

#### Step 3: keycloak (30880) 접근 테스트

```bash
# keycloak 접근 테스트
kubectl --context=dev run curl-keycloak --rm -it --image=curlimages/curl -n demo \
  -- curl -s -o /dev/null -w "HTTP Status: %{http_code}\n" http://$NODE_IP:30880

# keycloak의 health probe 확인
kubectl --context=dev get deployment keycloak -n demo -o jsonpath='{.spec.template.spec.containers[0].livenessProbe}' | python3 -m json.tool
kubectl --context=dev get deployment keycloak -n demo -o jsonpath='{.spec.template.spec.containers[0].readinessProbe}' | python3 -m json.tool
```

#### Step 4: 기타 NodePort 서비스 테스트

```bash
# 모니터링 스택
echo "Grafana: http://$NODE_IP:30300"
echo "AlertManager: http://$NODE_IP:30903"

# CI/CD
echo "ArgoCD: http://$NODE_IP:30800"
echo "Jenkins: http://$NODE_IP:30900"
```

**확인 문제**:
1. NodePort는 클러스터의 모든 노드에서 접근 가능한가? 아닌가?
2. NodePort의 포트 범위(30000-32767) 제한의 이유는 무엇인가?
3. keycloak에 설정된 probes(liveness, readiness)의 역할은 무엇인가?

---

### Lab 3.5: NetworkPolicy — Default Deny 테스트

**학습 목표**: Default Deny NetworkPolicy를 적용하여 모든 트래픽을 차단하는 방법을 이해한다.

**CKA 관련 도메인**: Services & Networking (20%)

#### 등장 배경

"Default Deny"는 네트워크 보안의 기본 원칙인 "최소 권한 원칙(principle of least privilege)"을 구현한 것이다. Kubernetes의 기본 네트워킹 모델은 "Default Allow"이므로, 보안을 강화하려면 먼저 모든 트래픽을 차단(Default Deny)한 후 필요한 트래픽만 명시적으로 허용하는 패턴을 적용해야 한다.

이 패턴이 중요한 이유는 다음과 같다:
1. **공격 표면 최소화**: 침해된 Pod가 다른 Pod에 접근하는 것을 방지한다 (lateral movement 차단).
2. **규제 준수**: PCI-DSS, SOC2 등 보안 규제는 네트워크 세그멘테이션을 요구한다.
3. **CKA 시험 빈출**: NetworkPolicy는 CKA 시험에서 거의 매번 출제된다. Default Deny + 허용 정책 추가 패턴을 반드시 숙지해야 한다.

#### NetworkPolicy 작성 시 주의사항

1. `podSelector: {}`는 네임스페이스의 **모든 Pod**에 적용됨을 의미한다.
2. `policyTypes`에 `Ingress`만 명시하고 `ingress` 필드를 비우면 모든 인바운드 트래픽이 차단된다.
3. `policyTypes`에 `Egress`를 포함하면 DNS(UDP 53) 트래픽도 차단된다. DNS Egress를 별도로 허용하지 않으면 Service 이름으로 접근이 불가능해진다.
4. NetworkPolicy는 네임스페이스 범위이다. 다른 네임스페이스의 Pod에는 영향을 주지 않는다.

#### Step 1: 통신 가능 상태 확인 (정책 적용 전)

```bash
# 테스트 네임스페이스 생성
kubectl --context=dev create namespace netpol-test

# 서버 Pod 생성
kubectl --context=dev run server --image=nginx:1.25 -n netpol-test --labels="role=server" --port=80

# 통신 테스트 — 정상 접근 가능
kubectl --context=dev run client --rm -it --image=curlimages/curl -n netpol-test \
  -- curl -s --max-time 3 http://server.netpol-test.svc.cluster.local
# nginx 기본 페이지가 출력된다
```

#### Step 2: Default Deny Ingress 적용

```bash
# 모든 Ingress 트래픽 차단
kubectl --context=dev apply -f - <<EOF
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

# 통신 테스트 — 차단됨
kubectl --context=dev run client2 --rm -it --image=curlimages/curl -n netpol-test \
  -- curl -s --max-time 3 http://server.netpol-test.svc.cluster.local
# 타임아웃 발생
```

#### Step 3: Default Deny All (Ingress + Egress) 적용

```bash
# 모든 Ingress + Egress 트래픽 차단
kubectl --context=dev apply -f - <<EOF
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
  namespace: netpol-test
spec:
  podSelector: {}
  policyTypes:
  - Ingress
  - Egress
EOF

# DNS도 차단되므로 이름 해석조차 불가
kubectl --context=dev run client3 --rm -it --image=busybox:1.36 -n netpol-test \
  -- nslookup kubernetes.default
# 타임아웃 발생
```

#### Step 4: 정리

```bash
kubectl --context=dev delete namespace netpol-test
```

**확인 문제**:
1. NetworkPolicy가 하나도 없는 네임스페이스에서 기본 트래픽 정책은 무엇인가?
2. Default Deny 정책에서 Egress까지 차단하면 DNS가 안 되는 이유는 무엇인가?
3. Cilium CNI가 NetworkPolicy를 지원하는 이유는 무엇인가?

**확인 문제 풀이**:
1. NetworkPolicy가 하나도 없는 네임스페이스에서는 모든 Ingress/Egress 트래픽이 허용된다 (Default Allow). Kubernetes의 기본 네트워킹 모델은 "flat network"이므로, 보안 정책을 적용하려면 NetworkPolicy를 명시적으로 생성해야 한다.
2. Kubernetes의 DNS 서비스(CoreDNS)는 `kube-system` 네임스페이스에 위치한다. Default Deny Egress 정책이 적용되면, Pod에서 나가는 모든 트래픽이 차단되므로 CoreDNS(UDP 53)에 대한 DNS 쿼리도 차단된다. DNS 없이는 Service 이름으로 접근할 수 없다. 해결: DNS Egress를 명시적으로 허용하는 NetworkPolicy를 추가한다 (`port: 53, protocol: UDP/TCP, namespaceSelector: {}`).
3. NetworkPolicy는 CNI 플러그인에 의해 구현되는 API이다. Kubernetes 자체는 NetworkPolicy 리소스의 정의만 제공하고, 실제 패킷 필터링은 CNI가 수행한다. Cilium은 eBPF를 사용하여 커널 수준에서 패킷을 필터링한다. Flannel은 NetworkPolicy를 지원하지 않으므로, Flannel을 사용하는 클러스터에서는 NetworkPolicy 리소스를 생성해도 실제 효과가 없다.

---

### Lab 3.6: NetworkPolicy — 특정 Pod 간 통신 허용

**학습 목표**: Default Deny 상태에서 특정 Pod 간 통신만 허용하는 NetworkPolicy를 작성한다.

**CKA 관련 도메인**: Services & Networking (20%)

#### Step 1: 환경 설정

```bash
# 테스트 네임스페이스 생성
kubectl --context=dev create namespace netpol-lab

# 서버 Pod 생성
kubectl --context=dev run web --image=nginx:1.25 -n netpol-lab --labels="app=web,role=server" --port=80
kubectl --context=dev expose pod web --port=80 -n netpol-lab

# 허용된 클라이언트
kubectl --context=dev run allowed-client --image=busybox:1.36 -n netpol-lab --labels="role=client" -- sleep 3600

# 차단될 클라이언트
kubectl --context=dev run blocked-client --image=busybox:1.36 -n netpol-lab --labels="role=intruder" -- sleep 3600

# Pod 준비 대기
kubectl --context=dev wait --for=condition=Ready pod/web pod/allowed-client pod/blocked-client -n netpol-lab --timeout=60s
```

#### Step 2: Default Deny + DNS 허용 + 특정 클라이언트 허용

```bash
# Default Deny
kubectl --context=dev apply -f - <<EOF
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny
  namespace: netpol-lab
spec:
  podSelector: {}
  policyTypes:
  - Ingress
  - Egress
EOF

# DNS Egress 허용 (모든 Pod에서 DNS 사용 가능)
kubectl --context=dev apply -f - <<EOF
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-dns
  namespace: netpol-lab
spec:
  podSelector: {}
  policyTypes:
  - Egress
  egress:
  - to:
    - namespaceSelector: {}
      podSelector:
        matchLabels:
          k8s-app: kube-dns
    ports:
    - protocol: UDP
      port: 53
    - protocol: TCP
      port: 53
EOF

# role=client인 Pod에서 web으로의 Ingress 허용
kubectl --context=dev apply -f - <<EOF
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-client-to-web
  namespace: netpol-lab
spec:
  podSelector:
    matchLabels:
      app: web
  policyTypes:
  - Ingress
  ingress:
  - from:
    - podSelector:
        matchLabels:
          role: client
    ports:
    - protocol: TCP
      port: 80
EOF

# role=client Pod에서 web으로 Egress 허용
kubectl --context=dev apply -f - <<EOF
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-client-egress
  namespace: netpol-lab
spec:
  podSelector:
    matchLabels:
      role: client
  policyTypes:
  - Egress
  egress:
  - to:
    - podSelector:
        matchLabels:
          app: web
    ports:
    - protocol: TCP
      port: 80
EOF
```

#### Step 3: 통신 테스트

```bash
# allowed-client → web: 허용됨
kubectl --context=dev exec allowed-client -n netpol-lab -- wget -qO- --timeout=3 http://web.netpol-lab.svc.cluster.local
# nginx 페이지 출력

# blocked-client → web: 차단됨
kubectl --context=dev exec blocked-client -n netpol-lab -- wget -qO- --timeout=3 http://web.netpol-lab.svc.cluster.local 2>&1 || true
# 타임아웃
```

#### Step 4: 정리

```bash
kubectl --context=dev delete namespace netpol-lab
```

#### NetworkPolicy 설계 패턴

실무에서 가장 많이 사용되는 NetworkPolicy 패턴은 "Default Deny + Allow List"이다:

1. **Default Deny**: 네임스페이스의 모든 Pod에 대해 Ingress/Egress를 차단한다.
2. **DNS Allow**: 모든 Pod에서 CoreDNS(kube-system 네임스페이스)로의 UDP/TCP 53 Egress를 허용한다.
3. **Service-to-Service Allow**: 필요한 Pod 간 통신만 명시적으로 허용한다.

이 패턴을 CKA 시험에서 빠르게 작성할 수 있도록 숙지해야 한다. 특히 DNS Egress 허용을 빠뜨리는 실수가 많으므로 주의한다.

#### NetworkPolicy 디버깅

NetworkPolicy가 적용된 후 통신이 차단되는지 확인하는 방법:

```bash
# 1. 적용된 NetworkPolicy 목록 확인
kubectl get networkpolicies -n <namespace>

# 2. 특정 Pod에 적용되는 NetworkPolicy 확인
kubectl describe pod <pod-name> -n <namespace> | grep "Network Policies"

# 3. 통신 테스트 (클라이언트에서 서버로)
kubectl exec <client-pod> -n <namespace> -- wget -qO- --timeout=3 http://<service>:<port>

# 4. Cilium 환경에서 정책 적용 상태 확인
kubectl exec -n kube-system ds/cilium -- cilium policy get -n <namespace>
```

**확인 문제**:
1. NetworkPolicy에서 `podSelector: {}`는 어떤 의미인가?
2. DNS Egress를 별도로 허용해야 하는 이유는 무엇인가?
3. Ingress 정책과 Egress 정책을 모두 설정해야 하는 이유는 무엇인가?

**확인 문제 풀이**:
1. `podSelector: {}`는 **해당 네임스페이스의 모든 Pod**에 적용됨을 의미한다. 빈 selector는 모든 Pod를 선택한다. 이것이 Default Deny 정책에서 사용되는 이유이다. `podSelector: {}`와 `policyTypes: [Ingress]`를 결합하고 `ingress` 필드를 비우면, 네임스페이스의 모든 Pod에 대해 모든 인바운드 트래픽이 차단된다.
2. Kubernetes의 DNS 서비스(CoreDNS)는 `kube-system` 네임스페이스의 `kube-dns` Service이다. Default Deny Egress 정책이 적용되면 Pod에서 나가는 모든 트래픽이 차단되므로, CoreDNS에 대한 DNS 쿼리(UDP/TCP 53)도 차단된다. DNS 없이는 Service 이름(예: `nginx-web.demo.svc.cluster.local`)을 IP 주소로 해석할 수 없어 모든 이름 기반 통신이 실패한다. 따라서 Default Deny Egress를 적용할 때는 반드시 DNS Egress를 별도로 허용해야 한다.
3. NetworkPolicy의 Ingress와 Egress는 독립적으로 동작한다. 클라이언트 Pod에서 서버 Pod로 통신하려면: (1) 클라이언트 Pod의 Egress에서 서버 Pod로의 트래픽이 허용되어야 하고, (2) 서버 Pod의 Ingress에서 클라이언트 Pod로부터의 트래픽이 허용되어야 한다. Ingress만 설정하면 서버는 트래픽을 수신할 수 있지만, 클라이언트의 Egress가 차단되면 트래픽이 서버에 도달하지 못한다. 따라서 양방향 모두 설정해야 통신이 가능하다.

---

### Lab 3.7: L7 NetworkPolicy 테스트 (HTTP GET 허용, POST 차단)

**학습 목표**: Cilium의 L7(HTTP) NetworkPolicy를 사용하여 HTTP 메서드 수준의 트래픽 제어를 수행한다.

**CKA 관련 도메인**: Services & Networking (20%)

#### Step 1: CiliumNetworkPolicy 확인

```bash
# tart-infra에 배포된 CiliumNetworkPolicy 확인
kubectl --context=dev get ciliumnetworkpolicies --all-namespaces
# 11개의 CiliumNetworkPolicy가 존재한다

# 특정 정책 상세 확인
kubectl --context=dev get ciliumnetworkpolicies -n demo -o yaml | head -50
```

#### Step 2: L7 정책 생성 (GET 허용, POST 차단)

```bash
# CiliumNetworkPolicy — HTTP GET만 허용
kubectl --context=dev apply -f - <<EOF
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: l7-http-filter
  namespace: demo
spec:
  endpointSelector:
    matchLabels:
      app: httpbin-v1
  ingress:
  - fromEndpoints:
    - matchLabels:
        role: api-client
    toPorts:
    - ports:
      - port: "80"
        protocol: TCP
      rules:
        http:
        - method: GET
          path: "/.*"
EOF

# 확인
kubectl --context=dev describe ciliumnetworkpolicy l7-http-filter -n demo
```

#### Step 3: 테스트

```bash
# GET 요청 — 허용됨
kubectl --context=dev run api-client --rm -it --image=curlimages/curl -n demo --labels="role=api-client" \
  -- curl -s -X GET http://httpbin.demo.svc.cluster.local/get

# POST 요청 — 차단됨 (403 Forbidden)
kubectl --context=dev run api-client2 --rm -it --image=curlimages/curl -n demo --labels="role=api-client" \
  -- curl -s -X POST http://httpbin.demo.svc.cluster.local/post -d '{"test":"data"}'
```

#### Step 4: 정리

```bash
kubectl --context=dev delete ciliumnetworkpolicy l7-http-filter -n demo
```

**확인 문제**:
1. L7 NetworkPolicy가 표준 Kubernetes NetworkPolicy와 다른 점은 무엇인가?
2. CiliumNetworkPolicy는 CKA 시험 범위에 포함되는가?
3. L7 정책이 HTTP 메서드뿐 아니라 어떤 프로토콜까지 제어할 수 있는가?

---

### Lab 3.8: DNS 테스트 (Service FQDN, Pod DNS)

**학습 목표**: Kubernetes 클러스터 내부 DNS 동작을 이해하고, 다양한 DNS 레코드를 조회한다.

**CKA 관련 도메인**: Services & Networking (20%)

#### 등장 배경

Kubernetes 초기에는 환경 변수를 통해 Service 디스커버리를 수행했다. Pod가 생성되면 kubelet이 동일 네임스페이스의 모든 Service에 대해 `{SERVICE_NAME}_SERVICE_HOST`와 `{SERVICE_NAME}_SERVICE_PORT` 환경 변수를 주입했다. 이 방식의 한계는 다음과 같았다:

- Pod 생성 이후에 만들어진 Service는 환경 변수에 반영되지 않는다.
- Service가 많으면 환경 변수 수가 급증하여 프로세스 환경이 오염된다.
- 다른 네임스페이스의 Service를 참조할 방법이 없다.

DNS 기반 Service 디스커버리가 이 문제를 해결했다. CoreDNS(또는 이전의 kube-dns)는 Service 생성/삭제 시 자동으로 DNS 레코드를 업데이트하므로, 시점에 관계없이 모든 Service를 이름으로 접근할 수 있다.

#### DNS 이름 체계

Kubernetes 클러스터 내부 DNS는 다음 명명 규칙을 따른다:

| 리소스 유형 | DNS 형식 | 예시 |
|---|---|---|
| Service | `<service>.<namespace>.svc.cluster.local` | `nginx-web.demo.svc.cluster.local` |
| Pod (IP 기반) | `<a-b-c-d>.<namespace>.pod.cluster.local` | `10-20-1-5.demo.pod.cluster.local` |
| StatefulSet Pod | `<pod-name>.<headless-svc>.<namespace>.svc.cluster.local` | `web-0.nginx-headless.default.svc.cluster.local` |

#### ndots:5 설정의 영향

Pod의 `/etc/resolv.conf`에는 `options ndots:5`가 설정되어 있다. 이는 DNS 이름에 5개 미만의 점(dot)이 포함되어 있으면, search 도메인을 순서대로 추가하여 조회한다는 의미이다. 예를 들어 `nginx-web`(점 0개)을 조회하면:

1. `nginx-web.demo.svc.cluster.local` 시도
2. `nginx-web.svc.cluster.local` 시도
3. `nginx-web.cluster.local` 시도
4. `nginx-web` (절대 이름) 시도

이 과정에서 최대 4번의 불필요한 DNS 조회가 발생한다. 외부 도메인(예: `google.com`, 점 1개)도 마찬가지로 search 도메인이 먼저 추가되어 불필요한 조회가 발생한다. 성능이 중요한 환경에서는 FQDN에 마지막 점(trailing dot)을 추가하여 절대 이름으로 조회하면 이 문제를 회피할 수 있다: `google.com.`

#### Step 1: CoreDNS 상태 확인

```bash
# CoreDNS Pod 확인
kubectl --context=dev get pods -n kube-system -l k8s-app=kube-dns -o wide

# CoreDNS Service 확인
kubectl --context=dev get svc -n kube-system -l k8s-app=kube-dns
# NAME       TYPE        CLUSTER-IP   EXTERNAL-IP   PORT(S)                  AGE
# kube-dns   ClusterIP   10.97.0.10   <none>        53/UDP,53/TCP,9153/TCP   30d

# CoreDNS ConfigMap (Corefile) 확인
kubectl --context=dev get configmap coredns -n kube-system -o yaml
```

#### Step 2: Service DNS 조회

```bash
# Service FQDN 형식: <service>.<namespace>.svc.cluster.local
kubectl --context=dev run dns-test --rm -it --image=busybox:1.36 -n demo -- sh -c "
  echo '=== Service DNS 테스트 ==='
  echo '--- nginx-web ---'
  nslookup nginx-web.demo.svc.cluster.local
  echo '--- redis ---'
  nslookup redis.demo.svc.cluster.local
  echo '--- postgres ---'
  nslookup postgres.demo.svc.cluster.local
  echo '--- kube-dns ---'
  nslookup kube-dns.kube-system.svc.cluster.local
"
```

#### Step 3: Pod DNS 조회

```bash
# Pod DNS 형식: <pod-ip-dashes>.<namespace>.pod.cluster.local
# 예: 10-20-1-5.demo.pod.cluster.local

# Pod IP 확인
POD_IP=$(kubectl --context=dev get pod -n demo -l app=nginx-web -o jsonpath='{.items[0].status.podIP}')
echo "Pod IP: $POD_IP"
POD_DNS=$(echo $POD_IP | tr '.' '-')
echo "Pod DNS: $POD_DNS.demo.pod.cluster.local"

# Pod DNS 조회 테스트
kubectl --context=dev run dns-pod-test --rm -it --image=busybox:1.36 -n demo \
  -- nslookup $POD_DNS.demo.pod.cluster.local
```

#### Step 4: 약식 DNS 이름 테스트

```bash
# 같은 네임스페이스에서는 Service 이름만으로 접근 가능
kubectl --context=dev run dns-short --rm -it --image=busybox:1.36 -n demo -- sh -c "
  echo '=== 약식 DNS 이름 테스트 ==='
  echo '--- 이름만 (같은 ns) ---'
  nslookup nginx-web
  echo '--- 이름.네임스페이스 ---'
  nslookup nginx-web.demo
  echo '--- 이름.네임스페이스.svc ---'
  nslookup nginx-web.demo.svc
  echo '--- FQDN ---'
  nslookup nginx-web.demo.svc.cluster.local
"
```

**확인 문제**:
1. Pod의 `/etc/resolv.conf`에 설정된 nameserver IP는 무엇인가?
2. Service DNS와 Pod DNS의 형식 차이를 설명하라.
3. `ndots:5` 설정이 DNS 조회 성능에 미치는 영향은 무엇인가?

**확인 문제 풀이**:
1. `kube-dns` Service의 ClusterIP이다. dev 클러스터에서는 `10.97.0.10`이다. kubelet이 Pod 생성 시 `/etc/resolv.conf`에 이 IP를 nameserver로 설정한다. 이 IP는 CoreDNS Deployment의 ClusterIP Service에 의해 관리되며, CoreDNS Pod의 실제 IP로 NAT된다.
2. Service DNS: `<service-name>.<namespace>.svc.cluster.local` (예: `nginx-web.demo.svc.cluster.local`). Pod DNS: `<pod-ip-dashes>.<namespace>.pod.cluster.local` (예: `10-20-1-5.demo.pod.cluster.local`). Service DNS는 ClusterIP를 반환하고, Pod DNS는 해당 Pod의 IP를 반환한다. StatefulSet Pod는 `<pod-name>.<headless-svc>.<namespace>.svc.cluster.local` 형식의 고유 DNS 이름을 가진다.
3. `ndots:5`는 DNS 이름에 5개 미만의 점(dot)이 포함되면 search 도메인을 순서대로 추가하여 조회한다는 의미이다. 외부 도메인(예: `api.example.com`, 점 2개)을 조회하면 `api.example.com.demo.svc.cluster.local` → `api.example.com.svc.cluster.local` → `api.example.com.cluster.local` → `api.example.com` 순서로 4번의 조회가 발생한다. 이는 불필요한 DNS 트래픽을 증가시키고 응답 지연을 유발한다. FQDN에 trailing dot을 추가하면(`api.example.com.`) 절대 이름으로 즉시 조회되어 이 문제를 회피할 수 있다.

---

### Lab 3.9: Cilium CNI 분석 (kube-proxy 대체 확인)

**학습 목표**: tart-infra의 Cilium CNI가 kube-proxy를 완전히 대체하는 방식을 이해한다.

**CKA 관련 도메인**: Services & Networking (20%)

#### Step 1: Cilium 상태 확인

```bash
# Cilium Pod 확인
kubectl --context=dev get pods -n kube-system -l k8s-app=cilium -o wide

# Cilium 상태 확인
kubectl --context=dev exec -n kube-system ds/cilium -- cilium status --brief

# kubeProxyReplacement 확인
kubectl --context=dev exec -n kube-system ds/cilium -- cilium status | grep KubeProxyReplacement
# KubeProxyReplacement:   True   ← kube-proxy를 완전히 대체

# kube-proxy가 없는 것을 확인
kubectl --context=dev get pods -n kube-system | grep kube-proxy
# 출력 없음 (kube-proxy가 설치되어 있지 않다)
```

#### Step 2: Cilium 서비스 라우팅 확인

```bash
# Cilium이 관리하는 서비스 목록
kubectl --context=dev exec -n kube-system ds/cilium -- cilium service list

# Cilium 엔드포인트 확인
kubectl --context=dev exec -n kube-system ds/cilium -- cilium endpoint list

# Cilium BPF 맵 확인
kubectl --context=dev exec -n kube-system ds/cilium -- cilium bpf ct list global | head -20
```

#### Step 3: 노드 간 연결 상태 확인

```bash
# Cilium 노드 간 건강 상태
kubectl --context=dev exec -n kube-system ds/cilium -- cilium-health status

# Pod CIDR 확인
kubectl --context=dev get nodes -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.podCIDR}{"\n"}{end}'
# dev-master     10.20.0.0/24
# dev-worker1    10.20.1.0/24
```

**확인 문제**:
1. `kubeProxyReplacement=true`의 의미는 무엇인가?
2. Cilium이 kube-proxy를 대체할 수 있는 기술적 기반(eBPF)은 무엇인가?
3. CNI 플러그인이 없으면 Pod 네트워킹이 어떻게 되는가?

**확인 문제 풀이**:
1. `kubeProxyReplacement=true`는 Cilium이 kube-proxy의 모든 기능(ClusterIP Service 라우팅, NodePort, ExternalTrafficPolicy 등)을 eBPF로 대체한다는 의미이다. kube-proxy를 설치할 필요가 없으며, iptables/IPVS 규칙도 생성되지 않는다. 모든 Service 라우팅이 eBPF 맵(hash table)을 통해 커널 수준에서 O(1) 시간 복잡도로 처리된다. tart-infra에서 `kubectl get pods -n kube-system | grep kube-proxy`의 결과가 비어 있는 이유가 이 설정 때문이다.
2. eBPF(extended Berkeley Packet Filter)는 리눅스 커널 내에서 샌드박스화된 프로그램을 실행할 수 있는 기술이다. 원래 네트워크 패킷 필터링 용도로 개발되었으나, 현재는 네트워킹, 보안, 관측 등 다양한 용도로 확장되었다. Cilium은 eBPF 프로그램을 XDP(eXpress Data Path, 네트워크 드라이버 수준) 또는 TC(Traffic Control, 커널 네트워크 스택) 훅 포인트에 부착한다. 패킷이 네트워크 스택을 통과하기 전에 eBPF 프로그램이 실행되어 Service 룩업, NAT, 패킷 필터링을 수행한다. iptables 체인을 순회하지 않으므로 대규모 환경에서 iptables 대비 수십 배 빠른 성능을 보인다.
3. CNI 플러그인이 없으면 Pod 간 네트워크 연결이 수립되지 않는다. Pod는 생성되지만 `NetworkNotReady` 조건이 설정되어 **NotReady** 상태에 머무른다. kubelet 로그에 `network plugin is not ready: cni config uninitialized` 에러가 나타난다. kubeadm으로 클러스터를 초기화한 직후, CNI를 설치하기 전의 상태가 이와 동일하다. CoreDNS Pod도 NotReady 상태이므로 DNS도 동작하지 않는다.

---

### Lab 3.10: Ingress 설정 (Istio Gateway 분석)

**학습 목표**: tart-infra의 Istio Gateway 설정을 분석하고, Ingress 리소스와의 관계를 이해한다.

**CKA 관련 도메인**: Services & Networking (20%)

#### Step 1: Istio Gateway 확인

```bash
# Istio 관련 리소스 확인
kubectl --context=dev get gateways --all-namespaces 2>/dev/null || \
kubectl --context=dev get gateway --all-namespaces 2>/dev/null

# Gateway 라우팅 규칙: /api → httpbin, / → nginx-web
kubectl --context=dev get virtualservices --all-namespaces 2>/dev/null

# mTLS 설정 확인
kubectl --context=dev get peerauthentication --all-namespaces 2>/dev/null
# mode: STRICT
```

#### Step 2: Istio 카나리 배포 확인

```bash
# VirtualService에서 트래픽 가중치 확인
# httpbin-v1: 80%, httpbin-v2: 20%
kubectl --context=dev get virtualservice httpbin -n demo -o yaml 2>/dev/null

# DestinationRule 확인 (Circuit Breaker 설정)
kubectl --context=dev get destinationrule --all-namespaces 2>/dev/null
# Circuit Breaker: 30초 내 5xx 에러 3회 → 차단
```

#### Step 3: Kubernetes Ingress 리소스 생성 (CKA 범위)

```bash
# CKA 시험에서는 표준 Kubernetes Ingress를 사용한다
kubectl --context=dev apply -f - <<EOF
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: demo-ingress
  namespace: demo
  annotations:
    nginx.ingress.kubernetes.io/rewrite-target: /
spec:
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
      - path: /api
        pathType: Prefix
        backend:
          service:
            name: httpbin
            port:
              number: 80
EOF

# Ingress 확인
kubectl --context=dev get ingress demo-ingress -n demo
kubectl --context=dev describe ingress demo-ingress -n demo
```

#### Step 4: 정리

```bash
kubectl --context=dev delete ingress demo-ingress -n demo
```

**확인 문제**:
1. Ingress와 Istio Gateway의 차이는 무엇인가?
2. CKA 시험에서 Ingress 문제가 출제될 때 주로 물어보는 것은 무엇인가?
3. `pathType: Prefix`와 `pathType: Exact`의 차이를 설명하라.

**확인 문제 풀이**:
1. **Ingress**는 Kubernetes 표준 API 리소스이다. HTTP/HTTPS 라우팅을 정의하며, Ingress Controller(nginx, traefik 등)가 실제 트래픽 처리를 담당한다. L7(HTTP 수준) 라우팅만 지원한다. **Istio Gateway**는 Istio 서비스 메시의 커스텀 리소스이다. VirtualService와 함께 사용하여 더 세밀한 트래픽 관리(가중치 기반 라우팅, 미러링, 장애 주입 등)를 제공한다. TCP/TLS 수준의 라우팅도 지원한다. CKA 시험에서는 **표준 Kubernetes Ingress만** 출제 범위이다. Istio Gateway는 CKA 범위가 아니다.
2. CKA 시험에서 Ingress 관련 주요 출제 패턴: (1) 특정 host와 path 규칙으로 Ingress 리소스를 생성하라. (2) 기존 Ingress에 새 경로 규칙을 추가하라. (3) Ingress에 TLS 설정을 추가하라 (Secret 생성 후 tls 섹션 설정). (4) `ingressClassName`을 지정하라. (5) `pathType`(Prefix/Exact)의 차이를 이해하고 올바르게 적용하라.
3. **`pathType: Prefix`**: 경로 접두사 일치이다. `/api`는 `/api`, `/api/v1`, `/api/users/123` 등 `/api`로 시작하는 모든 경로와 일치한다. **`pathType: Exact`**: 정확한 경로 일치이다. `/api`는 오직 `/api`와만 일치하며, `/api/v1`과는 일치하지 않는다. **`pathType: ImplementationSpecific`**: Ingress Controller의 구현에 따라 동작이 달라진다. Kubernetes 1.18+ 에서 `pathType`은 필수 필드이다. CKA 시험에서는 대부분 `Prefix`를 사용한다.

---

## 실습 4: Storage (10%)

> CKA 시험의 10%를 차지하는 도메인이다. PV, PVC, StorageClass, Volume 마운트 등이 출제 범위이다.

### 등장 배경

컨테이너는 기본적으로 ephemeral(일시적)이다. 컨테이너가 재시작되면 파일시스템의 모든 변경 사항이 사라진다. 이 특성은 stateless 워크로드에는 적합하지만, 데이터베이스, 캐시, 로그 수집기 등 stateful 워크로드에는 치명적이다.

Kubernetes의 스토리지 모델은 "관심사 분리(separation of concerns)" 원칙에 기반한다. 클러스터 관리자가 PV(PersistentVolume)를 프로비저닝하고, 개발자가 PVC(PersistentVolumeClaim)를 통해 스토리지를 요청한다. 이를 통해 개발자는 실제 스토리지 인프라(NFS, AWS EBS, GCE PD, local-path 등)의 상세를 알 필요가 없다.

#### PV-PVC 바인딩 내부 메커니즘

PV-PVC 바인딩은 kube-controller-manager의 PersistentVolume 컨트롤러가 수행한다. 바인딩 조건은 다음과 같다:

1. `storageClassName`이 일치해야 한다. PVC에 storageClassName이 지정되지 않으면 default StorageClass가 사용된다.
2. PV의 `capacity.storage`가 PVC의 `requests.storage` 이상이어야 한다.
3. `accessModes`가 호환되어야 한다. PV의 accessModes는 PVC가 요청하는 accessModes를 포함해야 한다.
4. `volumeBindingMode: WaitForFirstConsumer`인 StorageClass의 경우, PVC를 사용하는 Pod가 스케줄링될 때까지 바인딩이 지연된다.

PV 라이프사이클의 4가지 상태:
- **Available**: PVC에 바인딩되지 않은 상태이다. 새 PVC가 생성되면 바인딩 후보이다.
- **Bound**: PVC에 바인딩된 상태이다. 다른 PVC에 바인딩될 수 없다.
- **Released**: 바인딩된 PVC가 삭제된 상태이다. claimRef가 남아 있어 자동 재바인딩되지 않는다.
- **Failed**: 자동 정리(reclaim)가 실패한 상태이다.

#### Reclaim Policy

PVC가 삭제될 때 PV의 동작은 `reclaimPolicy`에 의해 결정된다:

| 정책 | 동작 | 사용 시나리오 |
|---|---|---|
| `Retain` | PV가 Released 상태로 전환되며 데이터가 보존된다. 수동으로 데이터를 확인한 후 PV를 삭제하거나 재사용할 수 있다. | 프로덕션 데이터베이스 등 중요 데이터 |
| `Delete` | PV와 백엔드 스토리지(예: AWS EBS 볼륨)가 자동 삭제된다. | 개발/테스트 환경의 임시 데이터 |
| `Recycle` | deprecated. 기존에는 `rm -rf /volume/*`를 수행하여 PV를 재사용 가능하게 했으나, 보안상 이유로 제거되었다. | 사용하지 않는다 |

---

### Lab 4.1: PVC 확인 (Prometheus, Jenkins)

**학습 목표**: tart-infra에서 Prometheus와 Jenkins가 사용하는 PVC를 확인하고 분석한다.

**CKA 관련 도메인**: Storage (10%)

#### Step 1: PVC 목록 확인

```bash
# 전체 PVC 확인
kubectl --context=dev get pvc --all-namespaces

# 출력 예시:
# NAMESPACE    NAME                 STATUS   VOLUME           CAPACITY   ACCESS MODES   STORAGECLASS   AGE
# monitoring   prometheus-data      Bound    pvc-xxxx         10Gi       RWO            local-path     30d
# cicd         jenkins-data         Bound    pvc-yyyy         5Gi        RWO            local-path     30d

# PV 확인
kubectl --context=dev get pv

# PVC 상세 정보
kubectl --context=dev describe pvc prometheus-data -n monitoring
kubectl --context=dev describe pvc jenkins-data -n cicd
```

#### Step 2: PVC와 PV의 바인딩 관계 확인

```bash
# PVC가 바인딩된 PV 확인
kubectl --context=dev get pvc prometheus-data -n monitoring -o jsonpath='{.spec.volumeName}'
kubectl --context=dev get pvc jenkins-data -n cicd -o jsonpath='{.spec.volumeName}'

# PV의 상세 정보 (실제 스토리지 경로)
PV_NAME=$(kubectl --context=dev get pvc prometheus-data -n monitoring -o jsonpath='{.spec.volumeName}')
kubectl --context=dev get pv $PV_NAME -o yaml | grep -A5 "hostPath\|local\|spec"

# 사용량 확인
kubectl --context=dev exec -n monitoring $(kubectl --context=dev get pod -n monitoring -l app=prometheus -o jsonpath='{.items[0].metadata.name}') -- df -h /data 2>/dev/null || echo "prometheus 볼륨 마운트 경로 확인 필요"
```

#### Step 3: PVC 커스텀 출력

```bash
# 커스텀 컬럼으로 PVC 정보 정리
kubectl --context=dev get pvc --all-namespaces -o custom-columns=\
'NAMESPACE:.metadata.namespace,NAME:.metadata.name,STATUS:.status.phase,CAPACITY:.status.capacity.storage,CLASS:.spec.storageClassName,VOLUME:.spec.volumeName'
```

**확인 문제**:
1. Prometheus PVC의 크기(10Gi)와 Jenkins PVC의 크기(5Gi)의 차이가 나는 이유는 무엇인가?
2. PVC 상태가 `Bound`가 아닌 `Pending`이면 어떤 원인이 가능한가?
3. `accessModes: ReadWriteOnce`(RWO)의 의미와 제약 사항은 무엇인가?

**확인 문제 풀이**:
1. Prometheus는 메트릭 데이터를 시계열 데이터베이스(TSDB)에 저장하며, 보존 기간(7일)에 걸친 모든 메트릭을 디스크에 기록한다. 수천 개의 시계열(time series)이 매 스크레이프 주기(15초)마다 수집되므로 데이터 양이 크다. Jenkins는 빌드 로그와 아티팩트만 저장하므로 상대적으로 적은 공간이 필요하다.
2. PVC가 Pending 상태인 원인: (1) 일치하는 PV가 없다 (storageClassName, capacity, accessModes 불일치), (2) StorageClass의 provisioner가 동작하지 않는다, (3) `volumeBindingMode: WaitForFirstConsumer`인 StorageClass에서 아직 해당 PVC를 사용하는 Pod가 생성되지 않았다, (4) 클러스터에 PV 생성 quota가 초과되었다.
3. RWO(ReadWriteOnce)는 하나의 노드에서만 읽기/쓰기가 가능하다는 의미이다. 같은 노드의 여러 Pod는 동일 RWO 볼륨을 동시에 마운트할 수 있지만, 다른 노드의 Pod는 마운트할 수 없다. 이 제약으로 인해 RWO PVC를 사용하는 Pod는 해당 PV가 위치한 노드에만 스케줄링된다.

#### PVC Pending 상태 트러블슈팅 워크플로우

```bash
# 1. PVC 상태 확인
kubectl get pvc <name> -n <namespace>

# 2. PVC 이벤트 확인 (원인 파악)
kubectl describe pvc <name> -n <namespace>

# 3. StorageClass 확인
kubectl get sc

# 4. PV 목록 확인 (정적 프로비저닝의 경우)
kubectl get pv

# 5. Provisioner Pod 상태 확인 (동적 프로비저닝의 경우)
kubectl get pods --all-namespaces | grep provisioner
```

검증 (PVC Pending 시 describe 출력):

```text
Events:
  Type     Reason              Age   From                         Message
  ----     ------              ----  ----                         -------
  Warning  ProvisioningFailed  10s   persistentvolume-controller  storageclass.storage.k8s.io "nonexistent-sc" not found
```

---

### Lab 4.2: StorageClass 확인 (local-path)

**학습 목표**: tart-infra의 local-path StorageClass를 분석하고, StorageClass의 동작 원리를 이해한다.

**CKA 관련 도메인**: Storage (10%)

#### Step 1: StorageClass 확인

```bash
# StorageClass 목록
kubectl --context=dev get storageclass

# 출력 예시:
# NAME                   PROVISIONER                    RECLAIMPOLICY   VOLUMEBINDINGMODE      ALLOWVOLUMEEXPANSION   AGE
# local-path (default)   rancher.io/local-path          Delete          WaitForFirstConsumer   false                  30d

# StorageClass 상세 정보
kubectl --context=dev describe storageclass local-path

# YAML로 전체 구조 확인
kubectl --context=dev get storageclass local-path -o yaml
```

#### Step 2: StorageClass 핵심 필드 분석

```bash
# Provisioner 확인
kubectl --context=dev get storageclass local-path -o jsonpath='{.provisioner}'
# rancher.io/local-path

# Reclaim Policy 확인
kubectl --context=dev get storageclass local-path -o jsonpath='{.reclaimPolicy}'
# Delete

# Volume Binding Mode 확인
kubectl --context=dev get storageclass local-path -o jsonpath='{.volumeBindingMode}'
# WaitForFirstConsumer

# 기본 StorageClass 확인
kubectl --context=dev get storageclass local-path -o jsonpath='{.metadata.annotations.storageclass\.kubernetes\.io/is-default-class}'
# true
```

#### Step 3: local-path-provisioner Pod 확인

```bash
# local-path-provisioner 동작 확인
kubectl --context=dev get pods --all-namespaces | grep local-path
kubectl --context=dev logs -n local-path-storage $(kubectl --context=dev get pod -n local-path-storage -o jsonpath='{.items[0].metadata.name}') --tail=10
```

#### local-path-provisioner 내부 동작 원리

local-path-provisioner는 Rancher가 개발한 경량 동적 볼륨 프로비저너이다. PVC가 생성되면 다음 과정으로 PV를 프로비저닝한다:

1. PVC 생성 이벤트를 감지한다.
2. Pod가 스케줄링될 노드에 호스트 경로(기본: `/opt/local-path-provisioner/`)를 생성한다.
3. hostPath 유형의 PV를 동적으로 생성하고 PVC에 바인딩한다.
4. PVC 삭제 시 `reclaimPolicy: Delete`에 따라 호스트 경로의 데이터를 삭제하고 PV를 제거한다.

이 provisioner의 한계:
- 노드 로컬 디스크를 사용하므로 노드 장애 시 데이터가 손실된다.
- Pod가 다른 노드로 이동하면 기존 데이터에 접근할 수 없다.
- 프로덕션 환경에서는 NFS, Ceph, AWS EBS 등 분산 스토리지를 사용해야 한다.

**확인 문제**:
1. `WaitForFirstConsumer`가 `Immediate`와 다른 점은 무엇인가?
2. `reclaimPolicy: Delete`는 PVC 삭제 시 어떤 동작을 하는가?
3. StorageClass가 없는 PVC는 어떤 StorageClass를 사용하는가?

**확인 문제 풀이**:
1. `Immediate`는 PVC 생성 즉시 PV에 바인딩한다. 이 경우 Pod가 아직 생성되지 않았으므로 스케줄러의 노드 선택을 고려하지 않는다. `WaitForFirstConsumer`는 PVC를 사용하는 Pod가 스케줄링될 때까지 바인딩을 지연한다. 이를 통해 Pod의 nodeSelector, affinity 등을 고려하여 최적의 노드에서 PV를 프로비저닝할 수 있다. 로컬 스토리지에서는 `WaitForFirstConsumer`가 필수이다.
2. `reclaimPolicy: Delete`는 PVC 삭제 시 PV와 백엔드 스토리지(hostPath 디렉토리, AWS EBS 볼륨 등)를 자동으로 삭제한다. 데이터가 영구 삭제되므로 중요 데이터가 있는 경우 `Retain`을 사용해야 한다.
3. StorageClass가 지정되지 않은 PVC는 `storageclass.kubernetes.io/is-default-class: "true"` 어노테이션이 설정된 default StorageClass를 사용한다. default StorageClass가 없으면 PVC는 Pending 상태로 남는다. `storageClassName: ""`으로 빈 문자열을 명시하면 StorageClass를 사용하지 않고 정적 PV만 바인딩 대상으로 삼는다.

---

### Lab 4.3: PV/PVC 생성 실습 (hostPath)

**학습 목표**: hostPath PV와 PVC를 수동으로 생성하고 바인딩한다.

**CKA 관련 도메인**: Storage (10%)

#### Step 1: PV 생성

```bash
# hostPath PV 생성
kubectl --context=dev apply -f - <<EOF
apiVersion: v1
kind: PersistentVolume
metadata:
  name: practice-pv
spec:
  capacity:
    storage: 1Gi
  accessModes:
  - ReadWriteOnce
  persistentVolumeReclaimPolicy: Retain
  storageClassName: manual
  hostPath:
    path: /tmp/practice-pv-data
    type: DirectoryOrCreate
EOF

# PV 상태 확인 — Available
kubectl --context=dev get pv practice-pv
# STATUS: Available
```

#### Step 2: PVC 생성

```bash
# PVC 생성 (StorageClass 지정)
kubectl --context=dev apply -f - <<EOF
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: practice-pvc
  namespace: demo
spec:
  accessModes:
  - ReadWriteOnce
  resources:
    requests:
      storage: 1Gi
  storageClassName: manual
EOF

# PVC 상태 확인 — Bound
kubectl --context=dev get pvc practice-pvc -n demo
# STATUS: Bound

# PV 상태도 Bound로 변경됨
kubectl --context=dev get pv practice-pv
# STATUS: Bound, CLAIM: demo/practice-pvc
```

#### Step 3: 바인딩 관계 확인

```bash
# PV에서 PVC 참조 확인
kubectl --context=dev get pv practice-pv -o jsonpath='{.spec.claimRef.name}'
# practice-pvc

# PVC에서 PV 참조 확인
kubectl --context=dev get pvc practice-pvc -n demo -o jsonpath='{.spec.volumeName}'
# practice-pv
```

#### PV-PVC 바인딩 트러블슈팅

PV-PVC 바인딩 실패의 일반적인 원인과 진단 방법:

```bash
# PVC가 Pending인 경우 describe로 원인 확인
kubectl describe pvc <name>
```

검증 (storageClassName 불일치):

```text
Events:
  Type     Reason              Age   From                         Message
  ----     ------              ----  ----                         -------
  Normal   FailedBinding       10s   persistentvolume-controller  no persistent volumes available for this claim and no storage class is set
```

검증 (용량 부족):

```text
Events:
  Type     Reason              Age   From                         Message
  ----     ------              ----  ----                         -------
  Normal   FailedBinding       10s   persistentvolume-controller  no persistent volumes available for this claim and no storage class is set
```

바인딩 조건 체크리스트:
1. `storageClassName` 일치 여부
2. PV `capacity.storage` >= PVC `requests.storage`
3. `accessModes` 호환 여부 (PV의 accessModes가 PVC의 accessModes를 포함해야 한다)
4. PV가 `Available` 상태인지 (이미 다른 PVC에 Bound이면 사용 불가)

**확인 문제**:
1. PV와 PVC의 `storageClassName`이 일치해야 바인딩되는가?
2. PV의 `capacity.storage`가 PVC의 `requests.storage`보다 작으면 어떻게 되는가?
3. `storageClassName: ""`으로 설정하면 어떤 의미인가?

**확인 문제 풀이**:
1. 일치해야 한다. PV의 `storageClassName`과 PVC의 `storageClassName`이 동일해야 바인딩 후보가 된다. storageClassName이 지정되지 않은 PVC는 default StorageClass를 사용한다. PV에 storageClassName이 지정되지 않으면 해당 PV는 storageClassName이 지정되지 않은 PVC에만 바인딩될 수 있다.
2. 바인딩되지 않는다. PV의 용량이 PVC가 요청하는 용량보다 작으면 해당 PV는 바인딩 후보에서 제외된다. PVC는 Pending 상태로 남는다. PV의 용량이 PVC 요청보다 **크면** 바인딩된다 (남는 공간은 낭비된다). 따라서 PV 용량은 PVC 요청과 정확히 같거나 크게 설정해야 한다.
3. `storageClassName: ""`(빈 문자열)은 **StorageClass를 사용하지 않겠다**는 명시적 선언이다. 이 PVC는 동적 프로비저닝을 사용하지 않으며, storageClassName이 없는 PV에만 바인딩된다. default StorageClass가 설정되어 있어도 무시된다. 이는 정적으로 프로비저닝된 PV를 명시적으로 사용하고 싶을 때 유용하다. storageClassName 필드 자체를 생략하면 default StorageClass가 적용되므로, 빈 문자열과 필드 생략은 다른 동작을 한다.

---

### Lab 4.4: Pod에 PVC 마운트

**학습 목표**: 생성한 PVC를 Pod에 마운트하고, 데이터 영속성을 확인한다.

**CKA 관련 도메인**: Storage (10%)

#### Step 1: PVC를 사용하는 Pod 생성

```bash
# PVC를 마운트하는 Pod 생성
kubectl --context=dev apply -f - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: pvc-pod
  namespace: demo
spec:
  containers:
  - name: app
    image: busybox:1.36
    command: ["sh", "-c", "echo 'Data written at $(date)' > /data/test.txt && cat /data/test.txt && sleep 3600"]
    volumeMounts:
    - name: data-vol
      mountPath: /data
  volumes:
  - name: data-vol
    persistentVolumeClaim:
      claimName: practice-pvc
EOF

# Pod 상태 확인
kubectl --context=dev get pod pvc-pod -n demo

# 데이터 확인
kubectl --context=dev exec pvc-pod -n demo -- cat /data/test.txt
# Data written at Thu Mar 19 14:30:22 UTC 2026
```

#### Step 2: Pod 삭제 후 데이터 영속성 확인

```bash
# Pod 삭제
kubectl --context=dev delete pod pvc-pod -n demo

# 같은 PVC를 마운트하는 새 Pod 생성
kubectl --context=dev apply -f - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: pvc-pod-2
  namespace: demo
spec:
  containers:
  - name: app
    image: busybox:1.36
    command: ["sh", "-c", "cat /data/test.txt && sleep 3600"]
    volumeMounts:
    - name: data-vol
      mountPath: /data
  volumes:
  - name: data-vol
    persistentVolumeClaim:
      claimName: practice-pvc
EOF

# 이전 Pod에서 작성한 데이터가 남아 있는지 확인
kubectl --context=dev exec pvc-pod-2 -n demo -- cat /data/test.txt
# Data written at Thu Mar 19 14:30:22 UTC 2026   ← 데이터가 영속됨
```

#### Step 3: 정리

```bash
kubectl --context=dev delete pod pvc-pod-2 -n demo
```

**확인 문제**:
1. PVC를 마운트한 Pod가 삭제되어도 데이터가 유지되는 이유는 무엇인가?
2. 두 개의 Pod가 동시에 같은 `ReadWriteOnce` PVC를 사용할 수 있는가?
3. `volumeMounts.mountPath`와 `volumes` 섹션의 연결 방식을 설명하라.

**확인 문제 풀이**:
1. PersistentVolume의 데이터는 Pod의 라이프사이클과 독립적이다. Pod가 삭제되어도 PV/PVC는 삭제되지 않으며, 데이터는 PV의 백엔드 스토리지(hostPath 디렉토리, NFS, EBS 등)에 그대로 남아 있다. 동일한 PVC를 참조하는 새 Pod를 생성하면 이전 데이터에 접근할 수 있다. 데이터가 삭제되는 시점은 PVC를 삭제하고, PV의 `reclaimPolicy: Delete`에 의해 PV가 삭제될 때이다.
2. **같은 노드**에 있는 두 Pod는 동일한 RWO PVC를 동시에 마운트할 수 있다. RWO(ReadWriteOnce)는 "하나의 **노드**에서만 읽기/쓰기 가능"을 의미한다 (하나의 Pod가 아님). **다른 노드**에 있는 Pod는 동일 RWO PVC를 마운트할 수 없다. 다른 노드의 Pod가 동일 RWO PVC를 사용하려고 하면 `Multi-Attach error` 또는 `FailedAttachVolume` 이벤트가 발생한다.
3. `volumes` 섹션은 Pod에서 사용할 볼륨을 정의한다 (이름, 유형, 소스). `volumeMounts` 섹션은 컨테이너 내부의 마운트 포인트를 정의한다 (이름, 마운트 경로). 두 섹션은 **이름(name)**으로 연결된다. `volumes[].name`과 `volumeMounts[].name`이 동일한 값이면 해당 볼륨이 해당 경로에 마운트된다. 하나의 볼륨을 여러 컨테이너에 다른 경로로 마운트할 수도 있다.

---

### Lab 4.5: PV 라이프사이클 관찰 (Available → Bound → Released)

**학습 목표**: PV의 전체 라이프사이클을 관찰한다.

**CKA 관련 도메인**: Storage (10%)

#### Step 1: 현재 PV 상태 확인

```bash
# 모든 PV 상태 확인
kubectl --context=dev get pv

# practice-pv의 상태
kubectl --context=dev get pv practice-pv
# STATUS: Bound, CLAIM: demo/practice-pvc
```

#### Step 2: PVC 삭제 → Released 상태

```bash
# PVC 삭제
kubectl --context=dev delete pvc practice-pvc -n demo

# PV 상태 확인 — Released
kubectl --context=dev get pv practice-pv
# STATUS: Released

# Released 상태에서는 새로운 PVC가 바인딩되지 않는다
# claimRef가 남아 있기 때문이다
kubectl --context=dev get pv practice-pv -o jsonpath='{.spec.claimRef}'
```

#### Step 3: PV 재사용 (claimRef 제거)

```bash
# claimRef 제거하여 PV를 Available 상태로 변경
kubectl --context=dev patch pv practice-pv --type json -p '[{"op": "remove", "path": "/spec/claimRef"}]'

# PV 상태 확인 — Available
kubectl --context=dev get pv practice-pv
# STATUS: Available

# 새로운 PVC를 생성하면 다시 바인딩된다
kubectl --context=dev apply -f - <<EOF
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: practice-pvc-new
  namespace: demo
spec:
  accessModes:
  - ReadWriteOnce
  resources:
    requests:
      storage: 1Gi
  storageClassName: manual
EOF

# 바인딩 확인
kubectl --context=dev get pv practice-pv
# STATUS: Bound, CLAIM: demo/practice-pvc-new
```

#### Step 4: 정리

```bash
kubectl --context=dev delete pvc practice-pvc-new -n demo
kubectl --context=dev delete pv practice-pv
```

**확인 문제**:
1. PV 라이프사이클의 4가지 상태(Available, Bound, Released, Failed)를 설명하라.
2. `reclaimPolicy: Retain`과 `Delete`의 차이를 PV 라이프사이클 관점에서 설명하라.
3. Released 상태의 PV를 Available로 만들려면 어떤 조치가 필요한가?

**확인 문제 풀이**:
1. **Available**: PV가 생성되었지만 아직 어떤 PVC에도 바인딩되지 않은 상태이다. 새 PVC가 생성되면 바인딩 후보가 된다. **Bound**: PVC에 바인딩된 상태이다. 다른 PVC에 바인딩될 수 없다. **Released**: 바인딩된 PVC가 삭제된 상태이다. `spec.claimRef`에 이전 PVC의 참조가 남아 있어 새 PVC에 자동 바인딩되지 않는다. 데이터는 보존되어 있다. **Failed**: 자동 정리(reclaim) 과정이 실패한 상태이다. 예를 들어 Delete 정책에서 백엔드 스토리지 삭제에 실패한 경우.
2. **Retain**: PVC 삭제 시 PV가 Released 상태로 전환되고, 데이터와 PV 리소스가 모두 보존된다. 관리자가 수동으로 데이터를 확인/백업한 후 PV를 삭제하거나 재사용할 수 있다. 프로덕션의 중요 데이터에 적합하다. **Delete**: PVC 삭제 시 PV와 백엔드 스토리지(예: AWS EBS 볼륨, hostPath 디렉토리)가 자동으로 삭제된다. 데이터가 영구 삭제되므로 개발/테스트 환경에 적합하다. 동적 프로비저닝된 PV의 기본 정책은 Delete이다.
3. Released 상태의 PV에서 `spec.claimRef`를 제거하면 Available 상태로 전환된다. 명령어: `kubectl patch pv <name> --type json -p '[{"op": "remove", "path": "/spec/claimRef"}]'`. 이후 새 PVC가 생성되면 바인딩 후보가 된다. 주의: claimRef를 제거하면 이전 PVC의 데이터가 새 PVC에 노출되므로, 보안이 중요한 환경에서는 데이터를 정리한 후 재사용해야 한다.

---

## 실습 5: Troubleshooting (30%) — CKA 최고 출제 비율!

> CKA 시험의 30%를 차지하는 가장 중요한 도메인이다. Pod 상태 진단, kubelet 트러블슈팅, 인증서, DNS, 로그 분석, 네트워크 문제 해결 등이 출제 범위이다.

### 등장 배경

분산 시스템인 Kubernetes에서 장애는 다양한 계층에서 발생한다: 컨테이너 수준(이미지 문제, OOMKilled), Pod 수준(스케줄링 실패, Probe 실패), 노드 수준(kubelet 중단, 디스크 부족), 클러스터 수준(etcd 장애, 인증서 만료, DNS 불능). 트러블슈팅이 CKA 시험에서 가장 큰 비중(30%)을 차지하는 이유는, 실제 운영 환경에서 장애 진단 및 복구 능력이 가장 중요한 역량이기 때문이다.

#### 체계적 트러블슈팅 접근법

Kubernetes 장애 진단은 다음 순서로 접근해야 한다:

1. **증상 파악**: `kubectl get pods -o wide`로 Pod 상태(Pending, CrashLoopBackOff, ImagePullBackOff, Error, Terminating)를 확인한다.
2. **이벤트 확인**: `kubectl describe pod <name>`의 Events 섹션에서 가장 최근 이벤트를 확인한다. 이벤트는 문제의 직접적인 원인을 가장 빠르게 보여준다.
3. **로그 확인**: `kubectl logs <pod> --previous`로 이전 크래시의 로그를 확인한다. CrashLoopBackOff의 원인은 대부분 로그에 나타난다.
4. **노드 수준 확인**: Pod가 아닌 노드에 문제가 있으면 SSH로 접속하여 `systemctl status kubelet`, `journalctl -u kubelet`로 진단한다.
5. **네트워크 확인**: Service Endpoint가 비어 있지 않은지, NetworkPolicy가 차단하고 있지 않은지, CoreDNS가 정상인지 확인한다.

#### Pod 상태별 진단 지침

| Pod 상태 | 일반적 원인 | 첫 번째 확인 명령 |
|---|---|---|
| **Pending** | 리소스 부족, nodeSelector 불일치, PVC 미바인딩, Taint 미허용 | `kubectl describe pod <name>` → Events의 FailedScheduling 메시지 |
| **ImagePullBackOff** | 이미지 이름 오타, private registry 인증 미설정, 네트워크 문제 | `kubectl describe pod <name>` → Events의 Failed to pull image 메시지 |
| **CrashLoopBackOff** | command 오류, 환경 변수 누락, OOMKilled, Probe 실패 | `kubectl logs <pod> --previous` → 마지막 크래시 로그 |
| **CreateContainerConfigError** | ConfigMap/Secret 미존재, Volume 마운트 오류 | `kubectl describe pod <name>` → Events의 configmap/secret not found 메시지 |
| **OOMKilled** | 컨테이너 메모리 사용량이 limits를 초과했다 | `kubectl describe pod <name>` → Last State: Terminated, Reason: OOMKilled, Exit Code: 137 |
| **Running이지만 서비스 불가** | readinessProbe 실패, Service selector 불일치, NetworkPolicy 차단 | `kubectl get endpoints <svc>` → Endpoint 비어 있는지 확인 |
| **Terminating (삭제 안 됨)** | finalizer가 남아 있거나, 노드가 NotReady 상태이다 | `kubectl get pod <name> -o jsonpath='{.metadata.finalizers}'` 확인 |

#### 종료 코드(Exit Code) 분석

컨테이너의 종료 코드는 장애 원인을 식별하는 핵심 지표이다:

| 종료 코드 | 의미 | 일반적 원인 |
|---|---|---|
| 0 | 정상 종료 | 일회성 작업(Job) 완료, 또는 restartPolicy 문제 |
| 1 | 일반 오류 | 애플리케이션 내부 오류 (설정 파일 누락, 잘못된 인자 등) |
| 126 | 실행 권한 없음 | command에 지정된 바이너리에 실행 권한이 없다 |
| 127 | 명령 찾을 수 없음 | command에 지정된 바이너리가 이미지에 존재하지 않는다 |
| 137 | SIGKILL (128+9) | OOMKilled 또는 `kubectl delete pod --force` |
| 139 | SIGSEGV (128+11) | 세그멘테이션 폴트 (메모리 접근 위반) |
| 143 | SIGTERM (128+15) | graceful shutdown (정상적인 Pod 종료 과정) |

---

### Lab 5.1: Pod 상태 진단 — ImagePullBackOff

**학습 목표**: ImagePullBackOff 상태의 원인을 파악하고 해결한다.

**CKA 관련 도메인**: Troubleshooting (30%)

#### Step 1: 장애 시뮬레이션

```bash
# 존재하지 않는 이미지로 Pod 생성
kubectl --context=dev apply -f - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: bad-image-pod
  namespace: demo
spec:
  containers:
  - name: app
    image: nginx:99.99.99
EOF

# Pod 상태 확인
kubectl --context=dev get pod bad-image-pod -n demo
# STATUS: ErrImagePull → ImagePullBackOff
```

#### Step 2: 원인 분석

```bash
# describe로 이벤트 확인
kubectl --context=dev describe pod bad-image-pod -n demo

# Events 섹션에서 확인:
# Warning  Failed     ...  Failed to pull image "nginx:99.99.99": ...
# Warning  Failed     ...  Error: ErrImagePull
# Normal   BackOff    ...  Back-off pulling image "nginx:99.99.99"
# Warning  Failed     ...  Error: ImagePullBackOff

# 이미지 이름 확인
kubectl --context=dev get pod bad-image-pod -n demo -o jsonpath='{.spec.containers[0].image}'
# nginx:99.99.99
```

#### Step 3: 해결

```bash
# 올바른 이미지로 수정
kubectl --context=dev set image pod/bad-image-pod app=nginx:1.25 -n demo 2>/dev/null || \
kubectl --context=dev delete pod bad-image-pod -n demo && \
kubectl --context=dev run bad-image-pod --image=nginx:1.25 -n demo

# 정상 상태 확인
kubectl --context=dev get pod bad-image-pod -n demo
# STATUS: Running
```

#### Step 4: 정리

```bash
kubectl --context=dev delete pod bad-image-pod -n demo
```

#### 내부 동작 원리: ImagePullBackOff 메커니즘

kubelet이 컨테이너 이미지를 pull할 때의 내부 과정은 다음과 같다:

1. kubelet이 컨테이너 런타임(containerd)에 이미지 pull 요청을 전달한다.
2. containerd는 이미지 레지스트리(Docker Hub, private registry 등)에 HTTP 요청을 보낸다.
3. 이미지가 존재하지 않거나 인증 실패 시 pull이 실패한다.
4. kubelet은 pull 실패를 `ErrImagePull` 이벤트로 기록한다.
5. 실패 후 지수적 백오프(exponential backoff)로 재시도한다: 10s → 20s → 40s → 80s → 160s → 300s (최대 5분).
6. 백오프 중인 상태가 `ImagePullBackOff`로 표시된다.

**확인 문제**:
1. ImagePullBackOff의 일반적인 원인 3가지를 말하라.
2. BackOff의 재시도 간격은 어떻게 증가하는가?
3. private registry 이미지를 pull하려면 어떤 리소스가 필요한가?

**확인 문제 풀이**:
1. (1) 이미지 이름 또는 태그 오타 (예: `ngnix:1.25` → `nginx:1.25`), (2) private registry에 대한 인증 정보(imagePullSecrets)가 미설정되었다, (3) 네트워크 문제로 레지스트리에 접근할 수 없다 (DNS 해석 실패, 프록시 미설정 등).
2. 지수적 백오프: 10s → 20s → 40s → 80s → 160s → 300s. 최대 5분(300초) 간격으로 무한 재시도한다. 이미지를 수정하면 즉시 다시 시도한다.
3. `imagePullSecrets`를 Pod에 설정해야 한다. 먼저 `kubectl create secret docker-registry <name> --docker-server=<registry> --docker-username=<user> --docker-password=<pass>`로 Secret을 생성한 후, Pod spec의 `imagePullSecrets` 필드에 해당 Secret을 참조한다. ServiceAccount에 `imagePullSecrets`를 설정하면 해당 SA를 사용하는 모든 Pod에 자동 적용된다.

---

### Lab 5.2: Pod 상태 진단 — CrashLoopBackOff

**학습 목표**: CrashLoopBackOff 상태의 원인을 파악하고 해결한다.

**CKA 관련 도메인**: Troubleshooting (30%)

#### Step 1: 장애 시뮬레이션

```bash
# 즉시 종료되는 컨테이너 (exit 1)
kubectl --context=dev apply -f - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: crash-pod
  namespace: demo
spec:
  containers:
  - name: app
    image: busybox:1.36
    command: ["sh", "-c", "echo 'Starting...' && exit 1"]
EOF

# Pod 상태 확인 — CrashLoopBackOff
kubectl --context=dev get pod crash-pod -n demo -w
# RESTARTS가 계속 증가한다
```

#### Step 2: 원인 분석

```bash
# 이전 컨테이너의 로그 확인 (핵심!)
kubectl --context=dev logs crash-pod -n demo --previous
# Starting...

# describe로 상세 확인
kubectl --context=dev describe pod crash-pod -n demo | grep -A10 "State\|Last State"

# 출력 예시:
#     State:          Waiting
#       Reason:       CrashLoopBackOff
#     Last State:     Terminated
#       Reason:       Error
#       Exit Code:    1

# 종료 코드 확인
kubectl --context=dev get pod crash-pod -n demo -o jsonpath='{.status.containerStatuses[0].lastState.terminated.exitCode}'
# 1 (비정상 종료)
```

#### Step 3: 다양한 CrashLoopBackOff 원인 테스트

```bash
# 원인 1: 잘못된 명령어
kubectl --context=dev apply -f - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: bad-cmd-pod
  namespace: demo
spec:
  containers:
  - name: app
    image: nginx:1.25
    command: ["nonexistent-command"]
EOF

# 원인 2: 설정 파일 누락
kubectl --context=dev apply -f - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: missing-config-pod
  namespace: demo
spec:
  containers:
  - name: app
    image: nginx:1.25
    volumeMounts:
    - name: config
      mountPath: /etc/app/config.yaml
      subPath: config.yaml
  volumes:
  - name: config
    configMap:
      name: nonexistent-config
EOF
```

#### Step 4: 정리

```bash
kubectl --context=dev delete pod crash-pod bad-cmd-pod missing-config-pod -n demo --force --grace-period=0
```

#### CrashLoopBackOff 디버깅 심화

CrashLoopBackOff는 "컨테이너가 시작되었다가 비정상 종료되는 것을 kubelet이 반복적으로 재시작하는 상태"이다. 디버깅의 핵심은 컨테이너가 왜 종료되는지 파악하는 것이다. 다음 순서로 진단한다:

```bash
# 1. 종료 코드와 종료 사유 확인
kubectl get pod <name> -o jsonpath='{.status.containerStatuses[0].lastState.terminated}' | python3 -m json.tool
```

검증:

```text
{
    "containerID": "containerd://abc123...",
    "exitCode": 1,
    "finishedAt": "2026-03-30T10:00:15Z",
    "reason": "Error",
    "startedAt": "2026-03-30T10:00:10Z"
}
```

```bash
# 2. 이전 컨테이너의 로그 확인 (핵심!)
kubectl logs <pod> --previous
```

검증 (설정 파일 누락으로 인한 크래시):

```text
Error: config file /etc/app/config.yaml not found
Fatal: unable to start application
```

```bash
# 3. describe에서 이벤트와 Restart Count 확인
kubectl describe pod <name> | grep -E "(Restart Count|Exit Code|Reason|State)"
```

검증:

```text
    State:          Waiting
      Reason:       CrashLoopBackOff
    Last State:     Terminated
      Reason:       Error
      Exit Code:    1
    Restart Count:  5
```

**확인 문제**:
1. `kubectl logs --previous` 플래그의 용도는 무엇인가?
2. Exit Code 137과 Exit Code 1의 차이는 무엇인가?
3. CrashLoopBackOff에서 BackOff 시간은 최대 얼마까지 증가하는가?

**확인 문제 풀이**:
1. `--previous`는 현재가 아닌 이전 컨테이너 인스턴스의 로그를 보여준다. CrashLoopBackOff 상태에서 현재 컨테이너는 아직 시작 중이거나 Waiting 상태이므로 로그가 없을 수 있다. `--previous`를 사용해야 마지막으로 크래시한 컨테이너의 로그를 확인할 수 있다.
2. Exit Code 1은 일반적인 애플리케이션 오류이다 (설정 파일 누락, 잘못된 인자, 포트 충돌 등). Exit Code 137은 128 + 9 = SIGKILL 신호에 의한 강제 종료이며, 가장 흔한 원인은 OOMKilled(메모리 초과)이다. `kubectl describe pod`에서 `Reason: OOMKilled`로 확인할 수 있다.
3. CrashLoopBackOff의 백오프 시간은 10초에서 시작하여 2배씩 증가하며 최대 5분(300초)까지 증가한다: 10s → 20s → 40s → 80s → 160s → 300s → 300s → ... Pod가 성공적으로 실행되어 일정 시간(10분 이상) 유지되면 백오프 타이머가 리셋된다.

---

### Lab 5.3: Pod 상태 진단 — Pending (리소스 부족)

**학습 목표**: Pending 상태의 Pod를 진단하고 리소스 부족 문제를 해결한다.

**CKA 관련 도메인**: Troubleshooting (30%)

#### Step 1: 장애 시뮬레이션

```bash
# 과도한 리소스를 요청하는 Pod
kubectl --context=dev apply -f - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: pending-pod
  namespace: demo
spec:
  containers:
  - name: app
    image: nginx:1.25
    resources:
      requests:
        cpu: "100"
        memory: "256Gi"
EOF

# Pod 상태 확인 — Pending
kubectl --context=dev get pod pending-pod -n demo
# STATUS: Pending
```

#### Step 2: 원인 분석

```bash
# describe에서 이벤트 확인
kubectl --context=dev describe pod pending-pod -n demo | grep -A5 Events

# 출력 예시:
# Events:
#   Warning  FailedScheduling  ...  0/2 nodes are available: 2 Insufficient cpu, 2 Insufficient memory

# 노드별 가용 리소스 확인
kubectl --context=dev describe nodes | grep -A8 "Allocated resources"

# 노드 리소스 사용량 확인
kubectl --context=dev top nodes

# dev 클러스터: master 2CPU/4GB, worker1 2CPU/8GB
# 100 CPU와 256Gi는 절대 할당 불가
```

#### Step 3: 해결

```bash
# Pod 삭제 후 적절한 리소스로 재생성
kubectl --context=dev delete pod pending-pod -n demo

kubectl --context=dev apply -f - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: pending-pod-fixed
  namespace: demo
spec:
  containers:
  - name: app
    image: nginx:1.25
    resources:
      requests:
        cpu: 100m
        memory: 128Mi
      limits:
        cpu: 200m
        memory: 256Mi
EOF

# 정상 스케줄링 확인
kubectl --context=dev get pod pending-pod-fixed -n demo
# STATUS: Running
```

#### Step 4: 정리

```bash
kubectl --context=dev delete pod pending-pod-fixed -n demo
```

#### 스케줄링 실패 상세 분석

Pending Pod의 `kubectl describe` Events에서 나타나는 메시지별 원인과 해결 방법:

| Events 메시지 | 원인 | 해결 방법 |
|---|---|---|
| `0/3 nodes are available: 3 Insufficient cpu` | 모든 노드의 가용 CPU가 Pod의 requests보다 적다 | requests를 줄이거나, 불필요한 Pod를 삭제하거나, 노드를 추가한다 |
| `0/3 nodes are available: 3 Insufficient memory` | 모든 노드의 가용 메모리가 Pod의 requests보다 적다 | 위와 동일 |
| `0/3 nodes are available: 3 node(s) didn't match Pod's node affinity/selector` | nodeSelector/nodeAffinity 조건을 충족하는 노드가 없다 | 노드에 레이블을 추가하거나, Pod의 selector를 수정한다 |
| `0/3 nodes are available: 3 node(s) had taint ..., that the pod didn't tolerate` | Taint를 허용하는 Toleration이 Pod에 없다 | Pod에 Toleration을 추가하거나, 노드의 Taint를 제거한다 |
| `persistentvolumeclaim "xxx" not found` | PVC가 존재하지 않는다 | PVC를 생성한다 |
| `0/3 nodes are available: 3 node(s) didn't have free ports for the requested pod ports` | hostPort가 이미 사용 중이다 | hostPort를 변경하거나 제거한다 |

**확인 문제**:
1. Pending 상태의 Pod가 발생하는 원인 5가지를 나열하라.
2. `kubectl describe nodes`의 `Allocated resources` 섹션에서 어떤 정보를 얻을 수 있는가?
3. ResourceQuota가 설정된 네임스페이스에서 requests를 설정하지 않으면 어떻게 되는가?

**확인 문제 풀이**:
1. (1) 리소스 부족(CPU/메모리 requests 초과), (2) nodeSelector/nodeAffinity 불일치, (3) Taint를 허용하는 Toleration 없음, (4) PVC가 Pending(미바인딩) 상태, (5) Pod의 hostPort가 이미 사용 중. 추가로: ResourceQuota 초과, PodAntiAffinity 충돌, 스케줄러 자체 장애(kube-scheduler Pod가 CrashLoopBackOff).
2. `Allocated resources`에서 현재 노드에 할당된 CPU/메모리 requests와 limits의 합계를 확인할 수 있다. `Resource Requests %`가 100%에 가까우면 해당 노드에 새 Pod를 배치할 여유가 없다. 이 정보로 어떤 노드에 여유가 있는지 파악하고, requests 값을 적절히 조정할 수 있다.
3. ResourceQuota가 설정된 네임스페이스에서 requests를 지정하지 않은 Pod를 생성하면 `Error from server (Forbidden): ... must specify requests` 오류가 발생하며 Pod 생성이 거부된다. ResourceQuota는 네임스페이스 전체의 리소스 총량을 제한하므로, 각 Pod의 requests를 명시해야 총량을 계산할 수 있다. LimitRange를 설정하면 기본 requests/limits를 자동 주입할 수 있다.

---

### Lab 5.4: Pod 상태 진단 — OOMKilled

**학습 목표**: OOMKilled(메모리 부족) 상태의 원인을 파악하고 해결한다.

**CKA 관련 도메인**: Troubleshooting (30%)

#### Step 1: 장애 시뮬레이션

```bash
# 메모리 제한보다 많은 메모리를 사용하는 Pod
kubectl --context=dev apply -f - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: oom-pod
  namespace: demo
spec:
  containers:
  - name: app
    image: busybox:1.36
    command: ["sh", "-c", "echo 'Allocating memory...' && head -c 200m /dev/urandom > /dev/null && sleep 3600"]
    resources:
      limits:
        memory: 64Mi
EOF

# Pod 상태 확인
kubectl --context=dev get pod oom-pod -n demo -w
# STATUS: OOMKilled
```

#### Step 2: 원인 분석

```bash
# describe로 OOMKilled 확인
kubectl --context=dev describe pod oom-pod -n demo | grep -A10 "State\|Last State"

# 출력 예시:
#     Last State:     Terminated
#       Reason:       OOMKilled
#       Exit Code:    137

# Exit Code 137 = 128 + 9 (SIGKILL)

# 이벤트 확인
kubectl --context=dev get events -n demo --field-selector involvedObject.name=oom-pod --sort-by='.lastTimestamp'
```

#### Step 3: 해결

```bash
# 메모리 limits 증가
kubectl --context=dev delete pod oom-pod -n demo

kubectl --context=dev apply -f - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: oom-pod-fixed
  namespace: demo
spec:
  containers:
  - name: app
    image: busybox:1.36
    command: ["sh", "-c", "echo 'Running normally' && sleep 3600"]
    resources:
      requests:
        memory: 64Mi
      limits:
        memory: 256Mi
EOF

kubectl --context=dev get pod oom-pod-fixed -n demo
# STATUS: Running
```

#### Step 4: 정리

```bash
kubectl --context=dev delete pod oom-pod-fixed -n demo
```

#### OOMKilled 내부 동작 원리

OOMKilled는 Linux 커널의 OOM Killer가 cgroup의 메모리 제한을 초과한 프로세스를 종료하는 메커니즘이다. 동작 과정은 다음과 같다:

1. Kubernetes가 컨테이너 생성 시 cgroup에 `memory.limit_in_bytes`를 설정한다 (Pod의 `limits.memory` 값).
2. 컨테이너 프로세스가 메모리를 할당하면 cgroup의 메모리 사용량이 증가한다.
3. 사용량이 `memory.limit_in_bytes`에 도달하면, 커널은 먼저 캐시 메모리를 회수한다.
4. 캐시 회수 후에도 공간이 부족하면, OOM Killer가 해당 cgroup의 프로세스에 SIGKILL(신호 9)을 전송한다.
5. 프로세스가 SIGKILL로 종료되면 Exit Code = 128 + 9 = 137이 된다.
6. kubelet은 컨테이너의 종료 사유를 "OOMKilled"로 기록한다.

CPU throttling과의 차이: CPU 제한 초과 시에는 cgroup의 CPU bandwidth controller가 프로세스의 실행 시간을 제한한다. 프로세스는 느려지지만 종료되지 않는다. 메모리는 "빌려줬다가 돌려받기"가 불가능하므로 초과 시 즉시 종료된다.

**확인 문제**:
1. Exit Code 137이 OOMKilled를 의미하는 이유를 설명하라.
2. OOMKilled와 Eviction의 차이는 무엇인가?
3. memory requests와 limits를 어떻게 설정하면 OOMKilled를 방지할 수 있는가?

**확인 문제 풀이**:
1. Exit Code 137 = 128 + 9이다. 리눅스에서 프로세스가 시그널에 의해 종료되면 Exit Code는 128 + 시그널 번호이다. SIGKILL의 시그널 번호는 9이다. OOM Killer는 SIGKILL을 전송하여 프로세스를 강제 종료하므로, OOMKilled의 Exit Code는 항상 137이다.
2. OOMKilled는 컨테이너 수준의 메모리 초과이다. 특정 컨테이너의 메모리 사용량이 해당 컨테이너의 `limits.memory`를 초과하면 발생한다. 컨테이너만 종료되고 Pod는 재시작된다. Eviction은 노드 수준의 리소스 부족이다. 노드 전체의 메모리/디스크가 임계값(eviction threshold)에 도달하면 kubelet이 QoS 클래스 우선순위에 따라 Pod를 축출한다. Pod가 다른 노드로 재스케줄링된다.
3. (1) 애플리케이션의 최대 메모리 사용량을 부하 테스트로 측정한다. (2) limits를 최대 사용량의 1.2~1.5배로 설정한다 (여유분 포함). (3) requests를 일반적인 사용량으로 설정한다. (4) Java 애플리케이션의 경우 JVM 힙 크기(`-Xmx`)를 limits보다 약간 작게 설정한다. JVM 자체도 비힙 메모리를 사용하므로, 힙 크기가 limits와 동일하면 비힙 메모리로 인해 OOMKilled가 발생할 수 있다.

---

### Lab 5.5: kubelet 트러블슈팅 (SSH → systemctl, journalctl)

**학습 목표**: SSH로 노드에 접속하여 kubelet 상태를 진단하고 복구한다.

**CKA 관련 도메인**: Troubleshooting (30%)

#### 등장 배경

kubelet은 각 노드에서 실행되는 에이전트로, Pod의 생성/삭제/모니터링을 담당한다. kubelet이 중지되면 해당 노드의 모든 Pod 관리가 중단되고, 노드가 NotReady 상태로 전환된다. kubelet은 systemd 서비스로 관리되므로, `systemctl`과 `journalctl`이 진단의 핵심 도구이다.

kubelet이 시작되지 않는 일반적인 원인은 다음과 같다:

1. **kubelet 바이너리 경로 오류**: systemd 서비스 파일의 `ExecStart`에 지정된 경로에 kubelet 바이너리가 존재하지 않는다. CKA 시험에서는 고의로 바이너리를 이동시키거나 이름을 변경하는 시나리오가 출제된다.
2. **설정 파일 문법 오류**: `/var/lib/kubelet/config.yaml`에 YAML 문법 오류가 있으면 kubelet이 파싱에 실패한다.
3. **인증서 만료**: kubelet의 클라이언트 인증서(`/var/lib/kubelet/pki/kubelet-client-current.pem`)가 만료되면 API Server와 통신할 수 없다.
4. **컨테이너 런타임 비가동**: containerd가 중지되면 kubelet이 컨테이너를 생성할 수 없다.
5. **swap 활성화**: Kubernetes는 기본적으로 swap이 비활성화된 환경을 요구한다. swap이 활성화되면 kubelet이 시작을 거부한다.

#### 내부 동작 원리: kubelet과 API Server 통신

kubelet은 다음 과정으로 API Server와 통신한다:

1. kubelet은 시작 시 `/etc/kubernetes/kubelet.conf`(kubeconfig)를 읽어 API Server 주소와 인증 정보를 확인한다.
2. Node Lease 메커니즘으로 10초마다 하트비트를 API Server에 전송한다 (Kubernetes 1.14+, 기존 NodeStatus 업데이트는 5분 간격으로 축소).
3. API Server가 하트비트를 `node-monitor-grace-period`(기본 40초) 동안 받지 못하면 노드를 Unknown 상태로 전환한다.
4. `pod-eviction-timeout`(기본 5분) 이후에도 노드가 복구되지 않으면, 해당 노드의 Pod를 다른 노드로 재스케줄링한다.

#### Step 1: SSH 접속 및 kubelet 상태 확인

```bash
# platform 워커 노드에 SSH 접속
ssh admin@<platform-worker1-ip>

# kubelet 서비스 상태 확인
sudo systemctl status kubelet

# 출력 예시 (정상):
# ● kubelet.service - kubelet: The Kubernetes Node Agent
#      Loaded: loaded (/lib/systemd/system/kubelet.service; enabled)
#      Active: active (running) since ...
#   Main PID: xxxx (kubelet)

# kubelet 로그 확인 (최근 50줄)
sudo journalctl -u kubelet --no-pager --since "10 minutes ago" | tail -50

# kubelet 설정 파일 확인
sudo cat /var/lib/kubelet/config.yaml

# kubelet systemd 설정 확인
sudo cat /lib/systemd/system/kubelet.service
sudo cat /etc/systemd/system/kubelet.service.d/10-kubeadm.conf
```

#### Step 2: kubelet 장애 시뮬레이션 및 복구

```bash
# 주의: 이 실습은 실제 노드에 영향을 미친다. 비사용 시간에 수행하라.

# kubelet 중지 시뮬레이션
# sudo systemctl stop kubelet

# API Server에서 노드 상태 확인 (다른 터미널에서)
# kubectl --context=platform get nodes
# platform-worker1   NotReady   <none>   30d   v1.31.x

# kubelet 재시작
# sudo systemctl restart kubelet

# 복구 확인
# kubectl --context=platform get nodes
# platform-worker1   Ready   <none>   30d   v1.31.x
```

#### Step 3: kubelet 로그 분석

```bash
# 에러 레벨 로그만 필터링
sudo journalctl -u kubelet --no-pager -p err | tail -20

# 특정 시간대의 로그
sudo journalctl -u kubelet --no-pager --since "2026-03-19 14:00:00" --until "2026-03-19 15:00:00"

# kubelet 설정 검증
sudo kubelet --config /var/lib/kubelet/config.yaml --v=5 2>&1 | head -20

exit
```

#### kubelet 장애 시나리오별 로그 패턴 분석

kubelet 로그에서 흔히 발견되는 오류 패턴과 해결 방법:

```bash
# 패턴 1: kubelet 바이너리 경로 오류
sudo journalctl -u kubelet | tail -5
```

검증:

```text
Mar 30 10:00:00 node systemd[1]: kubelet.service: Failed to execute /usr/bin/kublet: No such file or directory
Mar 30 10:00:00 node systemd[1]: kubelet.service: Failed at step EXEC spawning /usr/bin/kublet: No such file or directory
```

해결: `which kubelet`로 실제 경로를 확인하고, `/etc/systemd/system/kubelet.service.d/10-kubeadm.conf`의 ExecStart를 수정한다.

```bash
# 패턴 2: containerd 소켓 연결 실패
sudo journalctl -u kubelet | grep "runtime" | tail -5
```

검증:

```text
E0330 10:00:00.000000    1234 remote_runtime.go:116] "RunPodSandbox from runtime service failed" err="rpc error: code = Unavailable desc = connection error: desc = \"transport: Error while dialing: dial unix /run/containerd/containerd.sock: connect: no such file or directory\""
```

해결: `sudo systemctl start containerd && sudo systemctl restart kubelet`

```bash
# 패턴 3: 인증서 만료
sudo journalctl -u kubelet | grep "x509" | tail -5
```

검증:

```text
E0330 10:00:00.000000    1234 reflector.go:140] k8s.io/client-go/informers/factory.go:150: Failed to watch *v1.Node: failed to list *v1.Node: x509: certificate has expired or is not yet valid
```

해결: `sudo kubeadm certs renew all && sudo systemctl restart kubelet`

```bash
# 패턴 4: swap 활성화
sudo journalctl -u kubelet | grep "swap" | tail -5
```

검증:

```text
E0330 10:00:00.000000    1234 server.go:302] "Failed to run kubelet" err="running with swap on is not supported, please disable swap! or set --fail-swap-on flag to false"
```

해결: `sudo swapoff -a && sudo systemctl restart kubelet`

```bash
# 패턴 5: config.yaml 문법 오류
sudo journalctl -u kubelet | grep "config" | tail -5
```

검증:

```text
E0330 10:00:00.000000    1234 server.go:302] "Failed to run kubelet" err="failed to construct kubelet dependencies: failed to load kubelet config file, error: failed to decode, error: yaml: line 15: did not find expected key"
```

해결: `/var/lib/kubelet/config.yaml`의 YAML 문법을 수정한다.

**확인 문제**:
1. kubelet이 중지되면 노드 상태가 NotReady로 변하기까지 얼마나 걸리는가?
2. `journalctl -u kubelet`에서 `-p err` 플래그의 의미는 무엇인가?
3. kubelet이 시작되지 않는 일반적인 원인 5가지를 나열하라.

**확인 문제 풀이**:
1. kubelet은 Node Lease를 10초마다 갱신한다. kube-controller-manager의 `--node-monitor-grace-period`(기본 40초)가 지나도 Lease가 갱신되지 않으면 노드를 Unknown 상태로 전환한다. 따라서 kubelet 중지 후 약 40초 후에 노드 상태가 변한다. Unknown/NotReady 상태가 `--pod-eviction-timeout`(기본 5분) 이상 지속되면 해당 노드의 Pod가 다른 노드로 재스케줄링된다.
2. `-p err`은 journald의 우선순위(priority) 필터이다. syslog의 우선순위 체계에서 `err`(error, 레벨 3) 이상의 로그만 표시한다. 디버깅 시 대량의 info/debug 로그를 건너뛰고 오류만 빠르게 확인할 수 있다. 우선순위: emerg(0) > alert(1) > crit(2) > err(3) > warning(4) > notice(5) > info(6) > debug(7).
3. (1) kubelet 바이너리 경로 오류 (`/usr/bin/kubelet` 파일 없음 또는 이름 오타), (2) containerd/CRI 소켓 연결 실패, (3) kubelet 클라이언트 인증서 만료, (4) `/var/lib/kubelet/config.yaml` 문법 오류 또는 잘못된 설정, (5) swap 활성화 상태. 추가: (6) 디스크 공간 부족(kubelet 로그 파일이나 이미지가 디스크를 가득 채운 경우), (7) SELinux/AppArmor 정책 충돌.

---

### Lab 5.6: 인증서 트러블슈팅

**학습 목표**: 인증서 관련 문제를 진단하고 해결한다.

**CKA 관련 도메인**: Troubleshooting (30%)

#### Step 1: 인증서 만료 시뮬레이션 확인

```bash
# master 노드에 SSH 접속
ssh admin@<platform-master-ip>

# 모든 인증서 만료일 확인
sudo kubeadm certs check-expiration

# 각 인증서의 잔여 시간 확인
for cert in /etc/kubernetes/pki/*.crt; do
  echo "=== $(basename $cert) ==="
  sudo openssl x509 -in $cert -noout -dates
  echo ""
done
```

#### Step 2: 인증서 체인 검증

```bash
# API Server 인증서 검증
sudo openssl verify -CAfile /etc/kubernetes/pki/ca.crt /etc/kubernetes/pki/apiserver.crt
# /etc/kubernetes/pki/apiserver.crt: OK

# etcd 인증서 검증
sudo openssl verify -CAfile /etc/kubernetes/pki/etcd/ca.crt /etc/kubernetes/pki/etcd/server.crt

# kubelet 클라이언트 인증서 검증
sudo openssl verify -CAfile /etc/kubernetes/pki/ca.crt /etc/kubernetes/pki/apiserver-kubelet-client.crt
```

#### Step 3: 인증서 문제 해결 절차

```bash
# 1. 만료된 인증서 확인
sudo kubeadm certs check-expiration | grep -i "invalid\|expired"

# 2. 인증서 갱신
sudo kubeadm certs renew all

# 3. 컨트롤 플레인 Pod 재시작
sudo crictl ps -q | xargs sudo crictl stop
# kubelet이 Static Pod를 자동 재시작한다

# 4. API Server 접근 확인
kubectl get nodes

exit
```

**확인 문제**:
1. 인증서가 만료되면 `kubectl` 명령이 어떤 에러를 반환하는가?
2. CA 인증서와 서버 인증서의 만료 기간 차이는 얼마인가?
3. `kubeadm certs renew all` 실행 후 kubeconfig 파일도 갱신되는가?

**확인 문제 풀이**:
1. `Unable to connect to the server: x509: certificate has expired or is not yet valid: current time YYYY-MM-DDTHH:MM:SSZ is after YYYY-MM-DDTHH:MM:SSZ` 에러가 반환된다. x509는 TLS 인증서 표준이며, 인증서의 `notAfter` 필드에 지정된 시간이 지나면 인증서가 유효하지 않은 것으로 판단된다. 이 오류는 클라이언트측(kubectl)이 서버 인증서 검증에 실패하거나, 서버측(kube-apiserver)이 클라이언트 인증서 검증에 실패할 때 발생한다.
2. CA 인증서는 **10년**, 서버/클라이언트 인증서는 **1년**이다. 차이는 **9년**이다. CA 인증서가 10년인 이유는, CA 인증서를 갱신하면 모든 하위 인증서도 함께 갱신해야 하므로 운영 부담이 크기 때문이다. 서버/클라이언트 인증서가 1년인 이유는, 인증서 유출 시 피해를 최소화하기 위함이다. kubeadm 1.8 이후 `kubeadm upgrade`를 실행하면 1년짜리 인증서가 자동 갱신되므로, 연 1회 이상 클러스터를 업그레이드하면 인증서 만료를 방지할 수 있다.
3. `kubeadm certs renew all`은 인증서 파일뿐 아니라 **kubeconfig 파일도 함께 갱신**한다. 갱신되는 kubeconfig: `admin.conf`, `controller-manager.conf`, `scheduler.conf`. 이 kubeconfig 파일들은 내부에 인증서 데이터를 포함하고 있기 때문이다. 단, `$HOME/.kube/config`에 복사된 admin.conf는 자동으로 업데이트되지 않으므로, `sudo cp /etc/kubernetes/admin.conf $HOME/.kube/config`를 수동으로 실행해야 한다.

---

### Lab 5.7: 이벤트 분석 (kubectl get events)

**학습 목표**: Kubernetes 이벤트를 활용하여 클러스터 문제를 빠르게 파악한다.

**CKA 관련 도메인**: Troubleshooting (30%)

#### Step 1: 이벤트 조회

```bash
# 전체 클러스터 이벤트 (최근 것부터)
kubectl --context=dev get events --all-namespaces --sort-by='.lastTimestamp' | tail -20

# Warning 이벤트만 필터링
kubectl --context=dev get events --all-namespaces --field-selector type=Warning

# 특정 네임스페이스의 이벤트
kubectl --context=dev get events -n demo --sort-by='.lastTimestamp'

# 특정 리소스의 이벤트
kubectl --context=dev get events -n demo --field-selector involvedObject.kind=Pod

# 특정 Pod의 이벤트
kubectl --context=dev get events -n demo --field-selector involvedObject.name=nginx-web
```

#### Step 2: 이벤트 상세 분석

```bash
# 이벤트 타입별 카운트
kubectl --context=dev get events --all-namespaces -o json | \
  python3 -c "import sys,json; events=json.load(sys.stdin)['items']; types={e['type'] for e in events}; [print(f'{t}: {sum(1 for e in events if e[\"type\"]==t)}') for t in types]"

# wide 출력으로 상세 확인
kubectl --context=dev get events -n demo -o wide --sort-by='.lastTimestamp' | tail -10
```

#### Step 3: 이벤트 기반 문제 해결 워크플로우

```bash
# 1. Warning 이벤트 확인
kubectl --context=dev get events --all-namespaces --field-selector type=Warning --sort-by='.lastTimestamp' | tail -5

# 2. 관련 리소스 확인
# 이벤트의 involvedObject 정보를 바탕으로 리소스를 조회한다
# 예: FailedScheduling → Pod describe
# 예: Unhealthy → 컨테이너 로그 확인
# 예: FailedMount → PVC/PV 확인

# 3. 해결 후 이벤트 재확인
# 새로운 Warning 이벤트가 발생하지 않으면 해결된 것이다
```

**확인 문제**:
1. Kubernetes 이벤트의 기본 보존 기간은 얼마인가?
2. `--field-selector`로 필터링할 수 있는 이벤트 필드를 3가지 나열하라.
3. CKA 시험에서 이벤트 분석이 왜 중요한가?

**확인 문제 풀이**:
1. Kubernetes 이벤트의 기본 보존 기간은 **1시간**이다. kube-apiserver의 `--event-ttl` 플래그(기본 1h)로 제어된다. 1시간이 지나면 이벤트가 자동 삭제된다. 따라서 장애 발생 후 1시간 이상 경과하면 이벤트가 소실될 수 있다. 장기 보관이 필요하면 이벤트를 외부 시스템(Elasticsearch, Loki 등)으로 전송해야 한다.
2. `--field-selector`로 필터링 가능한 이벤트 필드: (1) `type` — `Normal` 또는 `Warning`. 예: `--field-selector type=Warning`. (2) `involvedObject.kind` — 관련 리소스 유형. 예: `--field-selector involvedObject.kind=Pod`. (3) `involvedObject.name` — 관련 리소스 이름. 예: `--field-selector involvedObject.name=nginx-web`. (4) `reason` — 이벤트 사유. 예: `--field-selector reason=FailedScheduling`.
3. CKA 시험의 트러블슈팅 문제(30%)에서 이벤트 분석은 가장 빠른 원인 파악 방법이다. `kubectl describe pod`의 Events 섹션 또는 `kubectl get events --sort-by='.lastTimestamp'`로 최근 이벤트를 확인하면, FailedScheduling(스케줄링 실패), FailedMount(볼륨 마운트 실패), Unhealthy(프로브 실패), BackOff(이미지 pull 실패) 등의 원인이 즉시 나타난다. 로그보다 이벤트를 먼저 확인하는 것이 시간을 절약하는 핵심 전략이다.

---

### Lab 5.8: 네트워크 트러블슈팅 (Pod 간 통신 불가 원인 분석)

**학습 목표**: Pod 간 통신이 불가능한 상황을 체계적으로 진단한다.

**CKA 관련 도메인**: Troubleshooting (30%)

#### Step 1: 네트워크 디버깅 Pod 생성

```bash
# netshoot 이미지로 디버깅 Pod 생성
kubectl --context=dev run netdebug --rm -it --image=nicolaka/netshoot -n demo -- bash
```

#### Step 2: 체계적 진단 절차

```bash
# Pod 내부에서 실행:

# 1. DNS 확인
nslookup nginx-web.demo.svc.cluster.local
nslookup kubernetes.default.svc.cluster.local

# 2. 서비스 연결 테스트
curl -v --max-time 3 http://nginx-web.demo.svc.cluster.local

# 3. Pod IP 직접 연결 테스트
# (외부에서 Pod IP 확인 후)
ping -c 3 <pod-ip>

# 4. 포트 연결 테스트
nc -zv nginx-web.demo.svc.cluster.local 80

# 5. 라우팅 테이블 확인
ip route

# 6. 네트워크 인터페이스 확인
ip addr

# 7. /etc/resolv.conf 확인
cat /etc/resolv.conf
# nameserver 10.97.0.10    ← kube-dns ClusterIP
# search demo.svc.cluster.local svc.cluster.local cluster.local
# options ndots:5

exit
```

#### Step 3: 외부에서 진단

```bash
# Service Endpoint 확인
kubectl --context=dev get endpoints nginx-web -n demo
# Endpoint가 비어 있으면 Pod와 Service의 selector 불일치

# NetworkPolicy 확인
kubectl --context=dev get networkpolicies -n demo

# CNI 상태 확인
kubectl --context=dev get pods -n kube-system -l k8s-app=cilium
kubectl --context=dev exec -n kube-system ds/cilium -- cilium status --brief
```

**확인 문제**:
1. Pod 간 통신 불가 시 진단 순서를 5단계로 정리하라.
2. `ndots:5` 설정이 DNS 해석 과정에 미치는 영향을 설명하라.
3. Service Endpoint가 비어 있는 경우의 해결 방법은 무엇인가?

**확인 문제 풀이**:
1. (1단계) **DNS 확인**: `nslookup <service>` — DNS 해석이 되는지 확인. 실패하면 CoreDNS 상태를 점검. (2단계) **Service Endpoint 확인**: `kubectl get endpoints <service>` — Endpoint에 Pod IP가 있는지 확인. 비어 있으면 selector 불일치 또는 Pod Not Ready. (3단계) **Pod 상태 확인**: `kubectl get pods -l <selector>` — Pod가 Running/Ready인지 확인. Not Ready이면 readinessProbe 점검. (4단계) **NetworkPolicy 확인**: `kubectl get networkpolicies` — 트래픽을 차단하는 정책이 있는지 확인. (5단계) **CNI 상태 확인**: `kubectl get pods -n kube-system -l k8s-app=cilium` — CNI Pod가 Running인지 확인. CNI가 비정상이면 Pod 간 네트워킹 전체가 실패한다.
2. `ndots:5` 설정은 DNS 이름에 5개 미만의 점(dot)이 포함되면 search 도메인을 순서대로 추가하여 조회한다는 의미이다. 예를 들어 `redis.demo.svc.cluster.local`(4개 점)을 조회하면: (1) `redis.demo.svc.cluster.local.demo.svc.cluster.local` → 실패, (2) `redis.demo.svc.cluster.local.svc.cluster.local` → 실패, (3) `redis.demo.svc.cluster.local.cluster.local` → 실패, (4) `redis.demo.svc.cluster.local` → 성공. 4번의 불필요한 조회가 발생한다. FQDN에 trailing dot을 추가하면(`redis.demo.svc.cluster.local.`) 절대 이름으로 즉시 조회되어 이 문제를 회피할 수 있다.
3. (1) Service의 `selector`와 Pod의 `labels`가 일치하는지 확인한다: `kubectl get svc <svc> -o jsonpath='{.spec.selector}'`와 `kubectl get pods --show-labels`를 비교한다. 불일치하면 Service의 selector를 수정한다(`kubectl patch svc <svc> -p '{"spec":{"selector":{"app":"correct-label"}}}'`). (2) Pod가 `Ready` 상태인지 확인한다. readinessProbe가 실패하면 Endpoint에서 제거된다. readinessProbe 설정을 점검한다. (3) Pod가 존재하는지 확인한다. Pod가 없으면 Deployment를 생성하거나 replicas를 1 이상으로 설정한다.

---

### Lab 5.9: DNS 트러블슈팅 (CoreDNS Pod 확인)

**학습 목표**: CoreDNS 관련 문제를 진단하고 해결한다.

**CKA 관련 도메인**: Troubleshooting (30%)

#### Step 1: CoreDNS 상태 확인

```bash
# CoreDNS Pod 상태
kubectl --context=dev get pods -n kube-system -l k8s-app=kube-dns -o wide

# CoreDNS Deployment 확인
kubectl --context=dev get deployment coredns -n kube-system

# CoreDNS Service 확인
kubectl --context=dev get svc kube-dns -n kube-system

# CoreDNS Endpoints 확인 — 비어 있으면 DNS가 동작하지 않는다
kubectl --context=dev get endpoints kube-dns -n kube-system
```

#### Step 2: CoreDNS 로그 분석

```bash
# CoreDNS 로그 확인
kubectl --context=dev logs -n kube-system -l k8s-app=kube-dns --tail=30

# 에러 로그 필터링
kubectl --context=dev logs -n kube-system -l k8s-app=kube-dns --tail=100 | grep -i "error\|fail\|timeout"
```

#### Step 3: CoreDNS ConfigMap 확인

```bash
# Corefile 확인
kubectl --context=dev get configmap coredns -n kube-system -o yaml

# 출력 예시:
# data:
#   Corefile: |
#     .:53 {
#         errors
#         health {
#            lameduck 5s
#         }
#         ready
#         kubernetes cluster.local in-addr.arpa ip6.arpa {
#            pods insecure
#            fallthrough in-addr.arpa ip6.arpa
#            ttl 30
#         }
#         prometheus :9153
#         forward . /etc/resolv.conf {
#            max_concurrent 1000
#         }
#         cache 30
#         loop
#         reload
#         loadbalance
#     }
```

#### Step 4: DNS 기능 테스트

```bash
# DNS 해석 테스트
kubectl --context=dev run dns-diag --rm -it --image=busybox:1.36 -n demo -- sh -c "
  echo '=== Service DNS ==='
  nslookup nginx-web.demo.svc.cluster.local
  echo ''
  echo '=== Kubernetes API ==='
  nslookup kubernetes.default.svc.cluster.local
  echo ''
  echo '=== External DNS ==='
  nslookup google.com
  echo ''
  echo '=== resolv.conf ==='
  cat /etc/resolv.conf
"
```

#### Step 5: CoreDNS 재시작 (문제 해결 시)

```bash
# CoreDNS Deployment 재시작
kubectl --context=dev rollout restart deployment coredns -n kube-system

# 재시작 확인
kubectl --context=dev rollout status deployment coredns -n kube-system

# DNS 재테스트
kubectl --context=dev run dns-verify --rm -it --image=busybox:1.36 -n demo \
  -- nslookup kubernetes.default
```

#### CoreDNS 장애 시나리오 상세

CoreDNS 장애는 클러스터 내 모든 Service 이름 해석이 실패하므로 영향 범위가 매우 크다. 장애 유형별 진단과 해결 방법:

| 장애 유형 | 증상 | 진단 방법 | 해결 방법 |
|---|---|---|---|
| CoreDNS Pod CrashLoopBackOff | 모든 DNS 해석 실패 | `kubectl logs -n kube-system -l k8s-app=kube-dns` | Corefile 문법 확인, CoreDNS ConfigMap 수정 후 Pod 재시작 |
| CoreDNS Pod Running이지만 Endpoint 없음 | DNS 해석 실패 | `kubectl get endpoints kube-dns -n kube-system` | CoreDNS Pod의 readinessProbe 확인, Pod 재시작 |
| Corefile 루프(loop) 감지 | CoreDNS CrashLoopBackOff | `kubectl logs`에서 "Loop ... detected for zone" 메시지 | Corefile에서 `loop` 플러그인 제거 또는 forward 대상 수정 |
| 외부 DNS만 실패 | 클러스터 내부 DNS는 동작, 외부 도메인(google.com) 해석 실패 | CoreDNS 로그에서 upstream DNS 관련 오류 확인 | Corefile의 `forward` 설정에 올바른 upstream DNS 서버 지정 |
| Pod의 resolv.conf에 잘못된 nameserver | 해당 Pod에서만 DNS 실패 | `kubectl exec <pod> -- cat /etc/resolv.conf` | Pod의 `dnsPolicy` 확인 (기본 `ClusterFirst`여야 함) |

CoreDNS의 loop 감지는 흔한 장애 원인이다. CoreDNS가 forward 대상으로 자기 자신을 가리키면 무한 루프가 발생한다. 예를 들어 노드의 `/etc/resolv.conf`에 CoreDNS의 ClusterIP가 nameserver로 설정되어 있으면, CoreDNS가 자기 자신에게 쿼리를 보내는 루프가 발생한다. 해결: Corefile의 `forward`를 `8.8.8.8`이나 `1.1.1.1` 등 외부 DNS로 직접 지정한다.

**확인 문제**:
1. CoreDNS가 CrashLoopBackOff 상태일 때 확인해야 할 3가지는 무엇인가?
2. Corefile의 `forward . /etc/resolv.conf` 설정의 역할은 무엇인가?
3. DNS 해석이 안 될 때 Pod의 `/etc/resolv.conf`를 확인하는 이유는 무엇인가?

**확인 문제 풀이**:
1. (1) **CoreDNS 로그 확인**: `kubectl logs -n kube-system -l k8s-app=kube-dns`로 크래시 원인을 파악한다. Corefile 문법 오류, 플러그인 설정 문제 등이 로그에 나타난다. (2) **CoreDNS ConfigMap 확인**: `kubectl get configmap coredns -n kube-system -o yaml`로 Corefile의 내용을 확인한다. 잘못된 설정이 있으면 수정한다. (3) **loop 감지 확인**: 로그에서 "Loop ... detected" 메시지가 있으면 forward 대상이 자기 자신을 가리키는 것이다. forward 대상을 올바른 upstream DNS 서버로 변경한다.
2. `forward . /etc/resolv.conf`는 CoreDNS가 Kubernetes 내부 도메인(cluster.local)이 아닌 외부 도메인의 DNS 쿼리를 노드의 `/etc/resolv.conf`에 지정된 upstream DNS 서버로 전달한다는 설정이다. 이를 통해 Pod에서 `google.com` 등 외부 도메인을 해석할 수 있다. 만약 이 설정이 없으면 외부 도메인 해석이 실패한다.
3. Pod의 `/etc/resolv.conf`에는 nameserver IP와 search 도메인이 설정되어 있다. nameserver IP가 `kube-dns` Service의 ClusterIP(예: 10.97.0.10)와 일치해야 DNS가 정상 동작한다. Pod의 `dnsPolicy`가 `Default`로 설정되어 있으면 노드의 resolv.conf를 사용하므로, Kubernetes 내부 DNS가 동작하지 않는다. `ClusterFirst`(기본값)로 설정되어야 kube-dns를 nameserver로 사용한다. `dnsPolicy`가 잘못 설정된 경우가 DNS 장애의 흔한 원인 중 하나이다.

---

### Lab 5.10: 로그 분석 (kubectl logs, crictl logs)

**학습 목표**: 다양한 방법으로 컨테이너 로그를 수집하고 분석한다.

**CKA 관련 도메인**: Troubleshooting (30%)

#### Step 1: kubectl logs 활용

```bash
# 기본 로그 조회
kubectl --context=dev logs -n demo -l app=nginx-web --tail=10

# 이전 컨테이너 로그 (CrashLoopBackOff 디버깅)
kubectl --context=dev logs -n demo <pod-name> --previous

# 실시간 로그 스트리밍
kubectl --context=dev logs -n demo -l app=nginx-web -f --tail=5 &
# Ctrl+C로 종료

# 특정 컨테이너의 로그 (멀티 컨테이너 Pod)
kubectl --context=dev logs -n demo <pod-name> -c <container-name>

# 시간 기반 필터링
kubectl --context=dev logs -n demo -l app=nginx-web --since=1h
kubectl --context=dev logs -n demo -l app=nginx-web --since-time="2026-03-19T14:00:00Z"
```

#### Step 2: 컨트롤 플레인 로그 분석

```bash
# kube-apiserver 로그
kubectl --context=dev logs -n kube-system -l component=kube-apiserver --tail=20

# kube-controller-manager 로그
kubectl --context=dev logs -n kube-system -l component=kube-controller-manager --tail=20

# kube-scheduler 로그
kubectl --context=dev logs -n kube-system -l component=kube-scheduler --tail=20

# etcd 로그
kubectl --context=dev logs -n kube-system -l component=etcd --tail=20
```

#### Step 3: crictl을 사용한 로그 분석

```bash
# SSH로 노드 접속
ssh admin@<dev-worker1-ip>

# crictl로 컨테이너 목록 확인
sudo crictl ps

# 특정 컨테이너 로그 확인
sudo crictl logs <container-id> --tail=20

# 중지된 컨테이너 로그 확인
sudo crictl ps -a | grep Exited
sudo crictl logs <exited-container-id>

# crictl로 컨테이너 상세 정보
sudo crictl inspect <container-id> | head -50

exit
```

**확인 문제**:
1. `kubectl logs`와 `crictl logs`의 차이와 사용 시나리오를 설명하라.
2. `--previous` 플래그는 어떤 상황에서 필수적인가?
3. 컨트롤 플레인 로그는 어떤 문제를 진단할 때 유용한가?

**확인 문제 풀이**:
1. **kubectl logs**: kube-apiserver → kubelet → containerd 경로로 로그를 가져온다. 원격에서 실행 가능하며 Pod 이름으로 접근한다. API Server가 정상이어야 동작한다. **crictl logs**: 노드에 직접 SSH 접속한 후 containerd에서 직접 로그를 가져온다. 컨테이너 ID로 접근한다. API Server가 다운되어도 동작한다. 사용 시나리오: kubectl logs가 동작하지 않을 때(API Server 장애, kubelet 장애), Static Pod(kube-apiserver, etcd)의 로그를 확인할 때 crictl logs를 사용한다.
2. `--previous`는 **CrashLoopBackOff** 상태의 Pod에서 필수적이다. 현재 컨테이너는 Waiting/ContainerCreating 상태이므로 로그가 없거나 매우 짧다. `--previous`를 사용하면 이전에 크래시한 컨테이너의 로그를 확인할 수 있다. 크래시 원인(잘못된 command, 설정 파일 누락, OOMKilled 등)은 대부분 이전 컨테이너의 로그에 나타난다. Pod가 한 번도 성공적으로 실행되지 않았다면 `--previous`에도 로그가 없을 수 있으며, 이 경우 `kubectl describe pod`의 Events를 확인해야 한다.
3. 컨트롤 플레인 로그는 다음 문제를 진단할 때 유용하다: **kube-apiserver 로그** — API 요청 인증/인가 실패, admission webhook 오류, etcd 연결 문제. **kube-controller-manager 로그** — Deployment 롤아웃 실패, ReplicaSet 스케일링 문제, Node 컨트롤러의 노드 상태 변경, PV 바인딩 실패. **kube-scheduler 로그** — Pod 스케줄링 실패, 노드 필터링/스코어링 과정의 상세. **etcd 로그** — 클러스터 리더 선출, 디스크 I/O 성능 문제, 스냅샷 관련 오류. CKA 시험에서는 kube-controller-manager 로그(Deployment 생성 실패)와 kube-scheduler 로그(Pod Pending 원인)가 가장 자주 출제된다.

---

### Lab 5.11: 노드 NotReady 상태 시뮬레이션 및 복구

**학습 목표**: 노드가 NotReady 상태가 되는 원인을 이해하고, 복구 절차를 수행한다.

**CKA 관련 도메인**: Troubleshooting (30%)

#### Step 1: 노드 상태 확인

```bash
# 현재 노드 상태 확인
kubectl --context=platform get nodes

# 노드 조건(Conditions) 상세 확인
kubectl --context=platform get nodes -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{range .status.conditions[*]}  {.type}: {.status} - {.message}{"\n"}{end}{"\n"}{end}'
```

#### Step 2: NotReady 원인 진단 절차

```bash
# 1. 노드 describe로 Conditions 확인
kubectl --context=platform describe node platform-worker1 | grep -A20 Conditions

# 주요 Conditions:
# Ready:                True (정상) / False (비정상) / Unknown (통신 불가)
# MemoryPressure:       False (정상) / True (메모리 부족)
# DiskPressure:         False (정상) / True (디스크 부족)
# PIDPressure:          False (정상) / True (프로세스 수 초과)
# NetworkUnavailable:   False (정상) / True (네트워크 설정 미완료)

# 2. SSH로 노드 접속하여 확인
ssh admin@<platform-worker1-ip>

# kubelet 상태
sudo systemctl status kubelet

# containerd 상태
sudo systemctl status containerd

# 디스크 공간
df -h

# 메모리 사용량
free -h

# swap 상태 (비활성화 필요)
sudo swapon --show

# 시스템 로그
sudo journalctl -u kubelet --since "10 minutes ago" --no-pager | tail -30

exit
```

#### Step 3: 일반적인 복구 절차

```bash
# kubelet 재시작
ssh admin@<platform-worker1-ip>
sudo systemctl restart kubelet
exit

# 노드 상태 확인
kubectl --context=platform get nodes
# Ready 상태로 복구되었는지 확인

# 노드 drain 및 uncordon (유지보수 시)
kubectl --context=platform drain platform-worker1 --ignore-daemonsets --delete-emptydir-data
# 유지보수 작업 수행
kubectl --context=platform uncordon platform-worker1
```

#### 노드 NotReady 상태 복구 체크리스트

노드가 NotReady 상태일 때 다음 체크리스트를 순서대로 확인한다:

```bash
# 1. 노드 Conditions 확인 (어떤 조건이 비정상인지 파악)
kubectl describe node <name> | grep -A20 Conditions
```

검증:

```text
Conditions:
  Type                 Status  LastHeartbeatTime                 Reason                       Message
  ----                 ------  -----------------                 ------                       -------
  MemoryPressure       False   2026-03-30T10:00:00Z              KubeletHasSufficientMemory   kubelet has sufficient memory available
  DiskPressure         False   2026-03-30T10:00:00Z              KubeletHasNoDiskPressure     kubelet has no disk pressure
  PIDPressure          False   2026-03-30T10:00:00Z              KubeletHasSufficientPID      kubelet has sufficient PID available
  Ready                False   2026-03-30T09:58:00Z              KubeletNotReady              PLEG is not healthy: pleg was last seen active ...
```

```bash
# 2. SSH 접속 후 kubelet/containerd 상태 확인
ssh admin@<node-ip>
sudo systemctl status kubelet
sudo systemctl status containerd

# 3. 시스템 리소스 확인
df -h         # 디스크
free -h       # 메모리
sudo swapon --show  # swap

# 4. 복구
sudo systemctl restart containerd
sudo systemctl restart kubelet
```

**확인 문제**:
1. 노드가 NotReady로 변하는 일반적인 원인 5가지를 나열하라.
2. `kubectl drain`과 `kubectl cordon`의 차이는 무엇인가?
3. kubelet이 API Server와 통신하지 못하면 노드 상태는 어떻게 표시되는가?

**확인 문제 풀이**:
1. (1) kubelet 서비스가 중지되었다, (2) 컨테이너 런타임(containerd)이 중지되었다, (3) 노드의 디스크 공간이 부족하다(DiskPressure), (4) 노드의 메모리가 부족하다(MemoryPressure), (5) kubelet 인증서가 만료되어 API Server와 통신할 수 없다. 추가: 네트워크 장애로 API Server에 도달 불가, PLEG(Pod Lifecycle Event Generator) 비정상.
2. `kubectl cordon`은 노드에 `SchedulingDisabled` 상태를 설정하여 새 Pod의 스케줄링을 금지한다. 기존에 실행 중인 Pod는 영향받지 않는다. `kubectl drain`은 cordon + 기존 Pod 축출을 수행한다. 노드의 모든 Pod(DaemonSet 제외)를 graceful하게 삭제하고, ReplicaSet/Deployment가 다른 노드에 대체 Pod를 생성한다. drain은 유지보수 작업 전에, cordon은 점진적으로 워크로드를 이동시킬 때 사용한다.
3. kubelet이 API Server와 통신하지 못하면 Node Lease가 갱신되지 않는다. `--node-monitor-grace-period`(기본 40초) 후 kube-controller-manager가 노드 상태를 `Unknown`으로 전환한다. `Ready` 조건의 Status가 `Unknown`이 되고, Reason은 `NodeStatusUnknown`, Message는 `Kubelet stopped posting node status`로 표시된다.

---

### Lab 5.12: 컨테이너 런타임 트러블슈팅 (crictl)

**학습 목표**: crictl을 사용하여 컨테이너 런타임 수준의 문제를 진단한다.

**CKA 관련 도메인**: Troubleshooting (30%)

#### Step 1: crictl 기본 사용법

```bash
# SSH로 노드 접속
ssh admin@<dev-worker1-ip>

# containerd 상태 확인
sudo systemctl status containerd

# 실행 중인 컨테이너 목록
sudo crictl ps

# 모든 컨테이너 (중지된 것 포함)
sudo crictl ps -a

# Pod 목록
sudo crictl pods

# 이미지 목록
sudo crictl images
```

#### Step 2: 컨테이너 상세 정보

```bash
# 컨테이너 상세 정보
sudo crictl inspect <container-id>

# Pod 상세 정보
sudo crictl inspectp <pod-id>

# 컨테이너 로그
sudo crictl logs <container-id> --tail=20

# 컨테이너 리소스 사용량
sudo crictl stats
```

#### Step 3: 컨테이너 런타임 문제 진단

```bash
# containerd 로그 확인
sudo journalctl -u containerd --since "10 minutes ago" --no-pager | tail -30

# containerd 소켓 확인
ls -la /run/containerd/containerd.sock

# crictl 설정 확인
cat /etc/crictl.yaml
# runtime-endpoint: unix:///run/containerd/containerd.sock

# 이미지 풀 테스트
sudo crictl pull nginx:1.25

exit
```

#### crictl 내부 동작 원리

`crictl`은 CRI(Container Runtime Interface) 호환 컨테이너 런타임과 통신하는 CLI 도구이다. Docker CLI와 달리 Kubernetes에 특화되어 있으며, CRI 프로토콜(gRPC)을 통해 containerd 또는 CRI-O와 직접 통신한다.

crictl의 주요 명령어와 Docker CLI 대응:

| crictl | docker | 설명 |
|---|---|---|
| `crictl ps` | `docker ps` | 실행 중인 컨테이너 목록 |
| `crictl ps -a` | `docker ps -a` | 모든 컨테이너 (종료된 것 포함) |
| `crictl pods` | (없음) | Pod 목록 (Kubernetes 전용) |
| `crictl logs <id>` | `docker logs <id>` | 컨테이너 로그 |
| `crictl inspect <id>` | `docker inspect <id>` | 컨테이너 상세 정보 |
| `crictl images` | `docker images` | 이미지 목록 |
| `crictl pull <image>` | `docker pull <image>` | 이미지 다운로드 |
| `crictl stats` | `docker stats` | 리소스 사용량 |

crictl은 Kubernetes 1.24 이후 docker 대신 사용해야 하는 도구이다. dockershim이 제거되었으므로, `docker ps`로는 Kubernetes 컨테이너를 확인할 수 없다.

#### CKA 시험에서 crictl 사용 시나리오

CKA 시험에서 crictl이 필요한 상황:
1. **kubelet이 다운된 상태에서 컨테이너 확인**: `kubectl`은 API Server를 통해 동작하므로, kubelet이 다운되어도 사용 가능하다. 그러나 API Server 자체가 다운된 경우 `crictl`만 사용할 수 있다.
2. **Static Pod 문제 진단**: etcd나 kube-apiserver Static Pod가 CrashLoopBackOff 상태일 때, `kubectl logs`가 동작하지 않을 수 있다. `sudo crictl logs <container-id>`로 직접 로그를 확인한다.
3. **이미지 관련 문제**: 노드에 캐시된 이미지 확인, 이미지 수동 pull, 불필요한 이미지 정리 등.

**확인 문제**:
1. `crictl`과 `docker` CLI의 차이는 무엇인가?
2. crictl 설정 파일의 위치와 주요 설정 항목을 말하라.
3. containerd가 중지되면 기존 실행 중인 컨테이너는 어떻게 되는가?

**확인 문제 풀이**:
1. `crictl`은 CRI(Container Runtime Interface) 프로토콜을 통해 containerd/CRI-O와 통신한다. `docker`는 Docker Engine의 자체 API를 사용한다. Kubernetes 1.24 이후 dockershim이 제거되어 `docker` CLI로는 Kubernetes 컨테이너를 관리할 수 없다. `crictl`에는 `pods` 명령이 있어 Pod 단위로 컨테이너를 확인할 수 있지만, `docker`에는 이 기능이 없다. `crictl`은 이미지 빌드 기능이 없지만, `docker`는 `docker build`를 제공한다.
2. crictl 설정 파일은 `/etc/crictl.yaml`이다. 주요 설정 항목: `runtime-endpoint: unix:///run/containerd/containerd.sock` (컨테이너 런타임의 Unix 소켓 경로), `image-endpoint: unix:///run/containerd/containerd.sock` (이미지 서비스 소켓), `timeout: 10` (gRPC 타임아웃 초), `debug: false` (디버그 로깅 활성화 여부).
3. containerd가 중지되면 기존 실행 중인 컨테이너는 계속 실행된다. containerd는 컨테이너 라이프사이클을 관리하는 데몬이지만, 실제 프로세스는 containerd-shim이 관리하며, shim은 containerd와 독립적으로 동작한다. 그러나 새 컨테이너 생성, 이미지 pull, 컨테이너 삭제 등은 containerd가 동작해야 수행 가능하다. kubelet은 containerd 연결 실패를 감지하고 노드를 NotReady 상태로 전환한다.

---

## 종합 시나리오

> 아래 시나리오는 CKA 시험의 실제 문제 형식을 모방한 것이다. 시간을 재면서 풀어보라. CKA 시험 시간은 2시간이며, 각 시나리오는 약 20-30분 내에 완료해야 한다.

### 종합 시나리오의 등장 배경

CKA 시험은 15~20개의 문제로 구성되며, 각 문제는 독립적인 작업이다. 문제마다 다른 클러스터 컨텍스트를 사용해야 하므로, 첫 번째 작업은 항상 `kubectl config use-context` 명령 실행이다. 시험에서 가장 흔한 실수는 (1) 컨텍스트 전환을 잊는 것, (2) 네임스페이스를 잘못 지정하는 것, (3) 검증 없이 다음 문제로 넘어가는 것이다.

아래 시나리오는 tart-infra 환경에서 실제 CKA 시험과 동일한 형식으로 구성했다. 각 시나리오를 풀고 나서 반드시 검증 명령어로 결과를 확인해야 한다.

---

### 시나리오 1: CKA 모의 실기 — 클러스터 관리 (etcd 백업, RBAC, 노드 관리)

**제한 시간: 25분**

**문제 1** (7점): `platform` 클러스터의 etcd를 `/opt/etcd-backup-scenario1.db` 경로에 백업하라. 인증서 경로는 etcd Pod의 YAML에서 확인하라.

```bash
# 풀이:

# 1. 인증서 경로 확인
kubectl --context=platform -n kube-system get pod etcd-platform-master -o yaml | \
  grep -E "(--cert-file|--key-file|--trusted-ca-file|--listen-client)"

# 2. SSH 접속
ssh admin@<platform-master-ip>

# 3. 백업 실행
ETCDCTL_API=3 etcdctl snapshot save /opt/etcd-backup-scenario1.db \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key

# 4. 검증
ETCDCTL_API=3 etcdctl snapshot status /opt/etcd-backup-scenario1.db --write-table

exit
```

**문제 2** (5점): `dev` 클러스터의 `demo` 네임스페이스에서 다음 조건의 RBAC을 설정하라:
- Role 이름: `pod-manager`
- 권한: pods에 대해 get, list, create, delete
- ServiceAccount 이름: `deploy-bot` (demo 네임스페이스)
- RoleBinding 이름: `pod-manager-binding`

```bash
# 풀이:

# 1. ServiceAccount 생성
kubectl --context=dev create serviceaccount deploy-bot -n demo

# 2. Role 생성
kubectl --context=dev create role pod-manager \
  --verb=get,list,create,delete \
  --resource=pods \
  -n demo

# 3. RoleBinding 생성
kubectl --context=dev create rolebinding pod-manager-binding \
  --role=pod-manager \
  --serviceaccount=demo:deploy-bot \
  -n demo

# 4. 검증
kubectl --context=dev auth can-i create pods --as=system:serviceaccount:demo:deploy-bot -n demo
# yes

kubectl --context=dev auth can-i delete deployments --as=system:serviceaccount:demo:deploy-bot -n demo
# no
```

**문제 3** (5점): `platform` 클러스터에서 `platform-worker1` 노드를 유지보수 모드로 전환하라. 기존 워크로드를 안전하게 이동시키고, DaemonSet은 무시하라. 유지보수 완료 후 노드를 다시 스케줄링 가능 상태로 복원하라.

```bash
# 풀이:

# 1. 현재 상태 확인
kubectl --context=platform get pods -o wide --all-namespaces | grep platform-worker1

# 2. 노드 drain
kubectl --context=platform drain platform-worker1 --ignore-daemonsets --delete-emptydir-data

# 3. 노드 상태 확인 — SchedulingDisabled
kubectl --context=platform get nodes

# 4. 유지보수 작업 수행 (시뮬레이션)
echo "유지보수 작업 완료"

# 5. 노드 uncordon
kubectl --context=platform uncordon platform-worker1

# 6. 확인
kubectl --context=platform get nodes
# STATUS: Ready (SchedulingDisabled 없음)
```

**문제 4** (8점): `dev` 클러스터에서 새로운 kubeconfig 파일을 `/tmp/scenario1.kubeconfig`에 생성하라. 조건:
- 클러스터 이름: `dev-cluster`
- 사용자: `scenario-user` (dev 클러스터의 default ServiceAccount 토큰 사용, 1시간 유효)
- 컨텍스트 이름: `scenario-context`
- 기본 네임스페이스: `demo`

```bash
# 풀이:

# 1. API Server 주소 확인
DEV_SERVER=$(kubectl --context=dev config view -o jsonpath='{.clusters[?(@.name=="dev")].cluster.server}')

# 2. CA 인증서 추출
kubectl --context=dev config view --raw -o jsonpath='{.clusters[?(@.name=="dev")].cluster.certificate-authority-data}' | base64 -d > /tmp/dev-ca.crt

# 3. 토큰 생성
TOKEN=$(kubectl --context=dev create token default -n demo --duration=1h)

# 4. kubeconfig 생성
kubectl config set-cluster dev-cluster \
  --server=$DEV_SERVER \
  --certificate-authority=/tmp/dev-ca.crt \
  --embed-certs=true \
  --kubeconfig=/tmp/scenario1.kubeconfig

kubectl config set-credentials scenario-user \
  --token=$TOKEN \
  --kubeconfig=/tmp/scenario1.kubeconfig

kubectl config set-context scenario-context \
  --cluster=dev-cluster \
  --user=scenario-user \
  --namespace=demo \
  --kubeconfig=/tmp/scenario1.kubeconfig

kubectl config use-context scenario-context \
  --kubeconfig=/tmp/scenario1.kubeconfig

# 5. 테스트
kubectl --kubeconfig=/tmp/scenario1.kubeconfig get pods
```

---

### 시나리오 2: CKA 모의 실기 — 워크로드 배포 (Deployment, Service, NetworkPolicy, PVC)

**제한 시간: 25분**

**문제 1** (6점): `dev` 클러스터의 `demo` 네임스페이스에 다음 조건의 Deployment를 생성하라:
- 이름: `web-scenario`
- 이미지: `nginx:1.25`
- Replicas: 3
- CPU requests: 50m, limits: 200m
- Memory requests: 64Mi, limits: 128Mi
- 레이블: `app=web-scenario`, `tier=frontend`

```bash
# 풀이:

# 1. dry-run으로 YAML 생성 후 수정
kubectl --context=dev create deployment web-scenario \
  --image=nginx:1.25 \
  --replicas=3 \
  -n demo \
  --dry-run=client -o yaml > /tmp/web-scenario.yaml

# 2. YAML 수정 (리소스, 레이블 추가)
cat > /tmp/web-scenario.yaml << 'EOF'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web-scenario
  namespace: demo
spec:
  replicas: 3
  selector:
    matchLabels:
      app: web-scenario
  template:
    metadata:
      labels:
        app: web-scenario
        tier: frontend
    spec:
      containers:
      - name: nginx
        image: nginx:1.25
        resources:
          requests:
            cpu: 50m
            memory: 64Mi
          limits:
            cpu: 200m
            memory: 128Mi
EOF

kubectl --context=dev apply -f /tmp/web-scenario.yaml

# 3. 검증
kubectl --context=dev get deployment web-scenario -n demo
kubectl --context=dev get pods -n demo -l app=web-scenario
```

**문제 2** (4점): 위에서 생성한 Deployment에 대해 NodePort Service를 생성하라:
- 이름: `web-scenario-svc`
- 포트: 80
- NodePort: 30180

```bash
# 풀이:
kubectl --context=dev apply -f - <<EOF
apiVersion: v1
kind: Service
metadata:
  name: web-scenario-svc
  namespace: demo
spec:
  type: NodePort
  selector:
    app: web-scenario
  ports:
  - port: 80
    targetPort: 80
    nodePort: 30180
EOF

# 검증
kubectl --context=dev get svc web-scenario-svc -n demo
kubectl --context=dev get endpoints web-scenario-svc -n demo
```

**문제 3** (6점): `demo` 네임스페이스에 다음 NetworkPolicy를 생성하라:
- 이름: `web-scenario-policy`
- `app=web-scenario` Pod에만 적용
- Ingress: `tier=backend` 레이블을 가진 Pod에서만 80 포트 접근 허용
- Egress: DNS(UDP 53)만 허용

```bash
# 풀이:
kubectl --context=dev apply -f - <<EOF
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: web-scenario-policy
  namespace: demo
spec:
  podSelector:
    matchLabels:
      app: web-scenario
  policyTypes:
  - Ingress
  - Egress
  ingress:
  - from:
    - podSelector:
        matchLabels:
          tier: backend
    ports:
    - protocol: TCP
      port: 80
  egress:
  - ports:
    - protocol: UDP
      port: 53
    - protocol: TCP
      port: 53
EOF

# 검증
kubectl --context=dev describe networkpolicy web-scenario-policy -n demo
```

**문제 4** (5점): `demo` 네임스페이스에 다음 PVC를 생성하고, Pod에 마운트하라:
- PVC 이름: `scenario-data`
- 크기: 500Mi
- AccessMode: ReadWriteOnce
- StorageClass: local-path
- Pod 이름: `data-pod`
- 마운트 경로: `/var/data`

```bash
# 풀이:

# PVC 생성
kubectl --context=dev apply -f - <<EOF
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: scenario-data
  namespace: demo
spec:
  accessModes:
  - ReadWriteOnce
  resources:
    requests:
      storage: 500Mi
  storageClassName: local-path
EOF

# Pod 생성
kubectl --context=dev apply -f - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: data-pod
  namespace: demo
spec:
  containers:
  - name: app
    image: busybox:1.36
    command: ["sh", "-c", "echo 'scenario data' > /var/data/test.txt && sleep 3600"]
    volumeMounts:
    - name: data
      mountPath: /var/data
  volumes:
  - name: data
    persistentVolumeClaim:
      claimName: scenario-data
EOF

# 검증
kubectl --context=dev get pvc scenario-data -n demo
kubectl --context=dev exec data-pod -n demo -- cat /var/data/test.txt
```

**문제 5** (4점): `web-scenario` Deployment의 이미지를 `nginx:1.26`으로 업데이트하고, 롤아웃이 완료되면 롤아웃 히스토리를 확인하라. 그 후 이전 버전으로 롤백하라.

```bash
# 풀이:

# 1. 이미지 업데이트
kubectl --context=dev set image deployment/web-scenario nginx=nginx:1.26 -n demo

# 2. 롤아웃 완료 대기
kubectl --context=dev rollout status deployment/web-scenario -n demo

# 3. 히스토리 확인
kubectl --context=dev rollout history deployment/web-scenario -n demo

# 4. 롤백
kubectl --context=dev rollout undo deployment/web-scenario -n demo

# 5. 롤백 완료 확인
kubectl --context=dev rollout status deployment/web-scenario -n demo

# 6. 이미지 확인
kubectl --context=dev get deployment web-scenario -n demo -o jsonpath='{.spec.template.spec.containers[0].image}'
# nginx:1.25
```

**시나리오 2 정리**:

```bash
kubectl --context=dev delete deployment web-scenario -n demo
kubectl --context=dev delete svc web-scenario-svc -n demo
kubectl --context=dev delete networkpolicy web-scenario-policy -n demo
kubectl --context=dev delete pod data-pod -n demo
kubectl --context=dev delete pvc scenario-data -n demo
```

---

### 시나리오 3: CKA 모의 실기 — 장애 복구 (3개 동시 장애 시나리오)

**제한 시간: 30분**

> 이 시나리오에서는 3개의 장애가 동시에 발생한 상황을 복구한다. 각 장애는 독립적이므로 순서에 관계없이 풀 수 있다.

**장애 1** (10점): `dev` 클러스터에서 `broken-deploy`라는 Deployment가 정상 동작하지 않는다. 원인을 파악하고 수정하라.

장애 시뮬레이션:
```bash
# 장애 생성 (시험관 역할)
kubectl --context=dev apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: broken-deploy
  namespace: demo
spec:
  replicas: 2
  selector:
    matchLabels:
      app: broken-deploy
  template:
    metadata:
      labels:
        app: broken-deploy
    spec:
      containers:
      - name: app
        image: ngnix:1.25
        ports:
        - containerPort: 80
        resources:
          requests:
            cpu: 50m
            memory: 64Mi
EOF
```

풀이:
```bash
# 1. Pod 상태 확인
kubectl --context=dev get pods -n demo -l app=broken-deploy
# STATUS: ImagePullBackOff

# 2. describe로 원인 확인
kubectl --context=dev describe pod -n demo -l app=broken-deploy | grep -A5 Events
# Failed to pull image "ngnix:1.25": image not found
# → 이미지 이름 오타: ngnix → nginx

# 3. 이미지 수정
kubectl --context=dev set image deployment/broken-deploy app=nginx:1.25 -n demo

# 4. 확인
kubectl --context=dev rollout status deployment/broken-deploy -n demo
kubectl --context=dev get pods -n demo -l app=broken-deploy
# STATUS: Running
```

**장애 2** (10점): `dev` 클러스터에서 `crash-deploy`라는 Deployment의 Pod가 CrashLoopBackOff 상태이다. 원인을 파악하고 수정하라.

장애 시뮬레이션:
```bash
# 장애 생성 (시험관 역할)
kubectl --context=dev apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: crash-deploy
  namespace: demo
spec:
  replicas: 1
  selector:
    matchLabels:
      app: crash-deploy
  template:
    metadata:
      labels:
        app: crash-deploy
    spec:
      containers:
      - name: app
        image: busybox:1.36
        command: ["sh", "-c", "cat /etc/app/config.yaml"]
        volumeMounts:
        - name: config
          mountPath: /etc/app
      volumes:
      - name: config
        configMap:
          name: crash-deploy-config
EOF
```

풀이:
```bash
# 1. Pod 상태 확인
kubectl --context=dev get pods -n demo -l app=crash-deploy
# STATUS: CrashLoopBackOff 또는 CreateContainerConfigError

# 2. describe로 원인 확인
kubectl --context=dev describe pod -n demo -l app=crash-deploy | grep -A5 Events
# configmap "crash-deploy-config" not found

# 3. 누락된 ConfigMap 생성
kubectl --context=dev create configmap crash-deploy-config \
  --from-literal=config.yaml="server: { port: 8080, log_level: info }" \
  -n demo

# 4. Pod 재시작 (Deployment이므로 Pod를 삭제하면 자동 재생성)
kubectl --context=dev delete pod -n demo -l app=crash-deploy

# 5. 확인
kubectl --context=dev get pods -n demo -l app=crash-deploy
# STATUS: Running

kubectl --context=dev logs -n demo -l app=crash-deploy
# server: { port: 8080, log_level: info }
```

**장애 3** (10점): `dev` 클러스터에서 `svc-broken`이라는 Service가 있지만, 접근하면 응답이 없다. 원인을 파악하고 수정하라.

장애 시뮬레이션:
```bash
# 장애 생성 (시험관 역할)
kubectl --context=dev apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: svc-target
  namespace: demo
spec:
  replicas: 2
  selector:
    matchLabels:
      app: svc-target
  template:
    metadata:
      labels:
        app: svc-target
    spec:
      containers:
      - name: app
        image: nginx:1.25
        ports:
        - containerPort: 80
---
apiVersion: v1
kind: Service
metadata:
  name: svc-broken
  namespace: demo
spec:
  selector:
    app: svc-target-wrong
  ports:
  - port: 80
    targetPort: 80
EOF
```

풀이:
```bash
# 1. Service 확인
kubectl --context=dev get svc svc-broken -n demo

# 2. Endpoints 확인 — 비어 있다!
kubectl --context=dev get endpoints svc-broken -n demo
# ENDPOINTS: <none>

# 3. Service의 selector 확인
kubectl --context=dev get svc svc-broken -n demo -o jsonpath='{.spec.selector}'
# {"app":"svc-target-wrong"}

# 4. 실제 Pod의 레이블 확인
kubectl --context=dev get pods -n demo --show-labels | grep svc-target
# app=svc-target (svc-target-wrong이 아니라 svc-target)

# 5. Service의 selector 수정
kubectl --context=dev patch svc svc-broken -n demo -p '{"spec":{"selector":{"app":"svc-target"}}}'

# 6. Endpoints 확인 — 이제 채워졌다
kubectl --context=dev get endpoints svc-broken -n demo
# ENDPOINTS: 10.20.x.x:80,10.20.x.y:80

# 7. 접근 테스트
kubectl --context=dev run verify --rm -it --image=curlimages/curl -n demo \
  -- curl -s --max-time 3 http://svc-broken.demo.svc.cluster.local
```

**시나리오 3 정리**:
```bash
kubectl --context=dev delete deployment broken-deploy crash-deploy svc-target -n demo
kubectl --context=dev delete svc svc-broken -n demo
kubectl --context=dev delete configmap crash-deploy-config -n demo
```

---

## 부록: CKA 시험 대비 체크리스트

### 시험 전 필수 설정

```bash
# 1. alias 설정
alias k=kubectl
source <(kubectl completion bash)
complete -o default -F __start_kubectl k
export do="--dry-run=client -o yaml"
export now="--force --grace-period 0"

# 2. vim 설정
echo 'set tabstop=2 shiftwidth=2 expandtab autoindent number' >> ~/.vimrc

# 3. 컨텍스트 확인
kubectl config get-contexts
```

### 도메인별 핵심 명령어

#### Cluster Architecture (25%)

```bash
# etcd 백업
ETCDCTL_API=3 etcdctl snapshot save <path> \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=<ca> --cert=<cert> --key=<key>

# etcd 복구
ETCDCTL_API=3 etcdctl snapshot restore <path> --data-dir=<new-dir>

# RBAC
kubectl create role <name> --verb=<verbs> --resource=<resources> -n <ns>
kubectl create rolebinding <name> --role=<role> --user=<user> -n <ns>
kubectl auth can-i <verb> <resource> --as=<user> -n <ns>

# 인증서 확인
sudo kubeadm certs check-expiration

# 업그레이드
sudo kubeadm upgrade plan
sudo kubeadm upgrade apply v1.xx.x
```

#### Workloads & Scheduling (15%)

```bash
# Deployment 생성
kubectl create deployment <name> --image=<img> --replicas=<n> -n <ns>

# Rolling Update
kubectl set image deployment/<name> <container>=<new-img> -n <ns>
kubectl rollout status deployment/<name> -n <ns>
kubectl rollout undo deployment/<name> -n <ns>

# Taint/Toleration
kubectl taint nodes <node> <key>=<value>:<effect>
kubectl taint nodes <node> <key>=<value>:<effect>-

# 리소스 설정
kubectl set resources deployment/<name> --requests=cpu=50m,memory=64Mi --limits=cpu=200m,memory=128Mi -n <ns>
```

#### Services & Networking (20%)

```bash
# Service 생성
kubectl expose deployment <name> --port=80 --type=NodePort -n <ns>

# NetworkPolicy — CKA 필수!
# default-deny → 허용 정책 추가 패턴 기억

# DNS 테스트
kubectl run dns-test --rm -it --image=busybox:1.36 -- nslookup <svc>.<ns>.svc.cluster.local

# Ingress
kubectl create ingress <name> --rule="host/path=svc:port" -n <ns>
```

#### Storage (10%)

```bash
# PVC 생성
kubectl apply -f pvc.yaml

# PV 생성 (hostPath)
kubectl apply -f pv.yaml

# 상태 확인
kubectl get pv,pvc --all-namespaces
```

#### Troubleshooting (30%)

```bash
# Pod 진단
kubectl describe pod <name> -n <ns>
kubectl logs <pod> -n <ns> --previous
kubectl get events -n <ns> --sort-by='.lastTimestamp'

# 노드 진단
ssh admin@<node>
sudo systemctl status kubelet
sudo journalctl -u kubelet --no-pager | tail -50

# DNS 진단
kubectl get pods -n kube-system -l k8s-app=kube-dns
kubectl logs -n kube-system -l k8s-app=kube-dns --tail=30

# 네트워크 진단
kubectl get endpoints <svc> -n <ns>
kubectl get networkpolicies -n <ns>
```

### tart-infra 주요 접근 정보

| 서비스 | 접근 방법 | 용도 |
|--------|----------|------|
| nginx-web | `http://<node-ip>:30080` | 데모 웹 서버 |
| keycloak | `http://<node-ip>:30880` | 인증 서버 |
| Grafana | `http://<node-ip>:30300` | 모니터링 대시보드 |
| ArgoCD | `http://<node-ip>:30800` | GitOps 배포 관리 |
| Jenkins | `http://<node-ip>:30900` | CI/CD 파이프라인 |
| AlertManager | `http://<node-ip>:30903` | 알림 관리 |
| SSH | `admin` / `admin` | 노드 접속 |

### 시험 시간 배분 권장

| 도메인 | 비중 | 권장 시간 (총 120분) |
|--------|------|---------------------|
| Cluster Architecture | 25% | 30분 |
| Workloads & Scheduling | 15% | 18분 |
| Services & Networking | 20% | 24분 |
| Storage | 10% | 12분 |
| Troubleshooting | 30% | 36분 |

> **팁**: 쉬운 문제부터 풀고, 어려운 문제는 마킹 후 나중에 돌아오라. `kubectl explain`을 활용하여 리소스 필드를 확인한다. `--dry-run=client -o yaml`로 템플릿을 빠르게 생성한다.

---

## 부록 B: 고급 트러블슈팅 패턴

### 패턴 1: 컨트롤 플레인 장애 진단 워크플로우

Control Plane 장애 시 체계적 진단 절차는 다음과 같다:

```bash
# 1. API Server 접근 가능 여부 확인
kubectl get nodes
# 실패 시: API Server 장애 → SSH로 마스터 접속

# 2. SSH 접속 후 Control Plane 컴포넌트 상태 확인
sudo crictl ps | grep -E "(apiserver|controller|scheduler|etcd)"

# 3. Static Pod 매니페스트 확인
ls -la /etc/kubernetes/manifests/

# 4. kubelet 로그 확인 (Static Pod 관리 주체)
sudo journalctl -u kubelet --since "5 minutes ago" --no-pager | tail -50

# 5. 개별 컴포넌트 로그 확인
sudo crictl logs <container-id>
```

검증:

```text
# crictl ps 정상 출력
CONTAINER           IMAGE               CREATED             STATE     NAME                      ATTEMPT   POD ID
a1b2c3d4e5f6        registry.k8s.io...  2 hours ago         Running   kube-apiserver            0         ...
b2c3d4e5f6a1        registry.k8s.io...  2 hours ago         Running   kube-controller-manager   0         ...
c3d4e5f6a1b2        registry.k8s.io...  2 hours ago         Running   kube-scheduler            0         ...
d4e5f6a1b2c3        registry.k8s.io...  2 hours ago         Running   etcd                      0         ...
```

### 패턴 2: Pod 네트워크 연결 불가 체계적 진단

Pod 간 통신이 불가능할 때 OSI 계층별로 진단한다:

```bash
# L3: IP 레벨 연결 테스트
kubectl exec <source-pod> -- ping -c 3 <target-pod-ip>

# L4: 포트 레벨 연결 테스트
kubectl exec <source-pod> -- nc -zv <target-pod-ip> <port>

# L7: 서비스 레벨 연결 테스트
kubectl exec <source-pod> -- curl -v --max-time 3 http://<service-name>:<port>

# DNS 해석 테스트
kubectl exec <source-pod> -- nslookup <service-name>

# Endpoint 확인 (서비스 → Pod 매핑)
kubectl get endpoints <service-name>

# NetworkPolicy 확인 (트래픽 차단 여부)
kubectl get networkpolicies -n <namespace>

# CNI 상태 확인
kubectl get pods -n kube-system -l k8s-app=cilium
```

### 패턴 3: 인증서 만료 장애 복구

인증서가 만료되면 kubectl 명령이 다음과 같은 오류를 반환한다:

```text
Unable to connect to the server: x509: certificate has expired or is not yet valid: current time 2026-03-30T10:00:00Z is after 2026-03-29T23:59:59Z
```

이 경우 SSH로 마스터 노드에 접속하여 다음 절차를 수행한다:

```bash
# 1. 인증서 만료 상태 확인
sudo kubeadm certs check-expiration

# 2. 모든 인증서 갱신
sudo kubeadm certs renew all

# 3. 컨트롤 플레인 Pod 재시작
sudo crictl ps -q | xargs sudo crictl stop
# kubelet이 Static Pod를 자동 재시작한다

# 4. kubeconfig 갱신 (admin.conf도 인증서를 포함한다)
sudo cp /etc/kubernetes/admin.conf $HOME/.kube/config
sudo chown $(id -u):$(id -g) $HOME/.kube/config

# 5. 확인
kubectl get nodes
```

검증:

```text
NAME              STATUS   ROLES           AGE   VERSION
platform-master   Ready    control-plane   30d   v1.31.x
platform-worker1  Ready    <none>          30d   v1.31.x
platform-worker2  Ready    <none>          30d   v1.31.x
```

### 패턴 4: kubelet 장애 유형별 복구

| 장애 유형 | journalctl 로그 패턴 | 해결 방법 |
|---|---|---|
| kubelet 바이너리 경로 오류 | `exec: "/usr/bin/kublet": stat: no such file` | 서비스 파일에서 ExecStart 경로를 `/usr/bin/kubelet`으로 수정 |
| 컨테이너 런타임 연결 실패 | `failed to get sandbox runtime: rpc error` | `sudo systemctl restart containerd` |
| 인증서 만료 | `x509: certificate has expired` | `sudo kubeadm certs renew all && sudo systemctl restart kubelet` |
| 설정 파일 문법 오류 | `failed to load kubelet config file` | `/var/lib/kubelet/config.yaml` YAML 문법 수정 |
| swap 활성화 | `Running with swap on is not supported` | `sudo swapoff -a && sudo sed -i '/ swap / s/^/#/' /etc/fstab` |
| 디스크 부족 | `eviction manager: attempting to reclaim ephemeral-storage` | 불필요한 이미지/컨테이너 정리: `sudo crictl rmi --prune` |

---

## 부록 C: CKA 시험 핵심 리소스 필드 참조

### kubectl explain 활용법

CKA 시험에서 YAML 필드를 정확히 기억하지 못할 때 `kubectl explain`을 사용한다:

```bash
# Pod의 securityContext 필드 확인
kubectl explain pod.spec.securityContext
kubectl explain pod.spec.containers.securityContext

# PV의 모든 필드 재귀적 확인
kubectl explain pv.spec --recursive | head -30

# NetworkPolicy의 ingress 필드 확인
kubectl explain networkpolicy.spec.ingress

# Deployment의 strategy 필드 확인
kubectl explain deployment.spec.strategy
```

검증:

```text
KIND:       Deployment
VERSION:    apps/v1

FIELD: strategy <DeploymentStrategy>

DESCRIPTION:
    The deployment strategy to use to replace existing pods with new ones.

FIELDS:
  rollingUpdate <RollingUpdateDeployment>
    Rolling update config params.

  type  <string>
    Type of deployment. Can be "Recreate" or "RollingUpdate".
```

### 빠른 YAML 생성 패턴

```bash
# Pod YAML 생성
kubectl run nginx --image=nginx:1.25 $do > pod.yaml

# Deployment YAML 생성
kubectl create deployment web --image=nginx:1.25 --replicas=3 $do > deploy.yaml

# Service YAML 생성
kubectl expose deployment web --port=80 --type=NodePort $do > svc.yaml

# Job YAML 생성
kubectl create job test --image=busybox:1.36 $do -- sh -c "echo hello" > job.yaml

# CronJob YAML 생성
kubectl create cronjob test --image=busybox:1.36 --schedule="*/5 * * * *" $do -- sh -c "date" > cronjob.yaml

# ConfigMap YAML 생성
kubectl create configmap myconfig --from-literal=key1=val1 $do > cm.yaml

# Secret YAML 생성
kubectl create secret generic mysecret --from-literal=password=secret123 $do > secret.yaml

# Role/RoleBinding YAML 생성
kubectl create role pod-reader --verb=get,list --resource=pods $do > role.yaml
kubectl create rolebinding pod-reader-binding --role=pod-reader --user=dev-user $do > rb.yaml

# Ingress YAML 생성
kubectl create ingress myingress --rule="host/path=svc:port" $do > ingress.yaml
```
