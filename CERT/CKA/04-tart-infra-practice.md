# CKA 실습 가이드 — tart-infra 활용

> 이 문서는 tart-infra 환경의 4개 Kubernetes 클러스터(platform/dev/staging/prod)를 활용하여 CKA 시험의 모든 도메인을 실전 수준으로 훈련하는 종합 실습 가이드이다.
> 모든 실습은 실제 인프라 구성 요소(Cilium CNI, Istio 서비스 메시, Prometheus/Grafana 모니터링, ArgoCD/Jenkins CI/CD, 데모 애플리케이션)를 대상으로 진행한다.
> CKA 시험은 100% 실기(hands-on) 시험이므로, 각 실습은 직접 명령어를 입력하고 결과를 확인하는 방식으로 구성되어 있다.

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

### PDB 설정

| 대상 | minAvailable |
|------|-------------|
| nginx-web | 2 |
| httpbin, redis, postgres, rabbitmq | 1 |

### 인프라 스택

| 구성 요소 | 세부 사항 |
|-----------|---------|
| **CNI** | Cilium (kubeProxyReplacement=true), CiliumNetworkPolicy 11개 (L7 포함) |
| **서비스 메시** | Istio (mTLS STRICT, 카나리 80/20, Circuit Breaker 3x5xx/30s, Gateway /api→httpbin /→nginx) |
| **스토리지** | local-path-provisioner, PVC: prometheus 10Gi, jenkins 5Gi |
| **모니터링** | Prometheus (보존 7일/10Gi), Grafana:30300, AlertManager:30903, Alert Rule 8개 |
| **CI/CD** | ArgoCD:30800 (auto-sync, prune, selfHeal, repo: github.com/iamywl/IaC_apple_sillicon.git), Jenkins:30900 (7-stage pipeline) |

---

## 사전 준비

### kubeconfig 설정 및 클러스터 접근

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

**확인 문제**:
1. `ETCDCTL_API=3`을 설정하지 않으면 어떤 문제가 발생하는가?
2. etcd 인증서 경로를 모르는 경우, 어떤 명령어로 확인할 수 있는가?
3. 스냅샷의 `TOTAL KEYS`와 `REVISION`은 각각 무엇을 의미하는가?

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

**확인 문제**:
1. `etcdctl snapshot restore`의 `--data-dir` 플래그는 왜 필요한가?
2. 복구 후 etcd.yaml 매니페스트를 수정해야 하는 경우는 언제인가?
3. 복구 중 API Server가 응답하지 않는 것은 정상인가?

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

**확인 문제**:
1. CKA 시험에서 `kubectl config use-context` 명령을 자주 사용하는 이유는 무엇인가?
2. `--embed-certs=true`와 `--certificate-authority` 파일 참조 방식의 차이는 무엇인가?
3. kubeconfig 파일에서 `clusters`, `users`, `contexts` 세 섹션의 역할은 각각 무엇인가?

---

### Lab 1.6: RBAC — read-only Role 생성

**학습 목표**: dev 클러스터에서 읽기 전용 Role과 RoleBinding을 생성하여 특정 사용자에게 제한된 권한을 부여한다.

**CKA 관련 도메인**: Cluster Architecture, Installation & Configuration (25%)

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

---

### Lab 1.8: ServiceAccount 생성 및 Pod 연결

**학습 목표**: ServiceAccount를 생성하고 Pod에 연결하여, Pod 내부에서 Kubernetes API에 접근하는 방법을 이해한다.

**CKA 관련 도메인**: Cluster Architecture, Installation & Configuration (25%)

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

---

### Lab 1.9: 인증서 만료 확인 (kubeadm certs check-expiration)

**학습 목표**: 클러스터 인증서의 만료 상태를 확인하고, 갱신 절차를 이해한다.

**CKA 관련 도메인**: Cluster Architecture, Installation & Configuration (25%)

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

---

### Lab 1.10: kubeadm 클러스터 업그레이드 절차 확인

**학습 목표**: kubeadm을 사용한 클러스터 업그레이드 절차를 이해하고, 업그레이드 계획을 수립한다.

**CKA 관련 도메인**: Cluster Architecture, Installation & Configuration (25%)

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

---

## 실습 2: Workloads & Scheduling (15%)

> CKA 시험의 15%를 차지하는 도메인이다. Deployment 관리, Rolling Update, 스케줄링 제어(Taint/Toleration, nodeSelector, Affinity), 리소스 관리 등이 출제 범위이다.

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

**확인 문제**:
1. nginx-web의 replicas가 3이고, maxUnavailable이 25%이면, Rolling Update 중 최소 몇 개의 Pod가 유지되는가?
2. Deployment → ReplicaSet → Pod의 관계에서 ReplicaSet의 역할은 무엇인가?
3. `requests: 50m/64Mi`, `limits: 200m/128Mi` 설정에서 이 Pod의 QoS 클래스는 무엇인가?

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

**확인 문제**:
1. Rolling Update 중 `maxSurge`와 `maxUnavailable`의 기본값은 각각 무엇인가?
2. 롤백 후 리비전 번호는 어떻게 변하는가?
3. 존재하지 않는 이미지로 업데이트했을 때, 기존 Pod가 모두 종료되지 않는 이유는 무엇인가?

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

**확인 문제**:
1. Recreate 전략은 어떤 상황에서 RollingUpdate보다 적합한가?
2. Recreate 전략에서 다운타임이 발생하는 이유는 무엇인가?
3. 데이터베이스 마이그레이션이 필요한 경우 어떤 전략이 적합한가?

---

### Lab 2.4: nodeSelector 실습 (특정 노드에 Pod 배치)

**학습 목표**: nodeSelector를 사용하여 Pod를 특정 노드에 스케줄링한다.

**CKA 관련 도메인**: Workloads & Scheduling (15%)

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

---

### Lab 2.5: Taint & Toleration (master 노드 taint 확인, toleration 추가)

**학습 목표**: master 노드의 Taint를 확인하고, Toleration을 사용하여 Taint가 있는 노드에도 Pod를 배치하는 방법을 이해한다.

**CKA 관련 도메인**: Workloads & Scheduling (15%)

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

---

### Lab 2.6: Resource Requests/Limits 분석 (demo 앱 QoS 클래스 확인)

**학습 목표**: demo 앱의 리소스 설정을 분석하고, QoS 클래스를 확인한다.

**CKA 관련 도메인**: Workloads & Scheduling (15%)

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

---

### Lab 2.7: Static Pod 확인 (/etc/kubernetes/manifests)

**학습 목표**: Static Pod의 동작 원리를 이해하고, 직접 Static Pod를 생성/삭제한다.

**CKA 관련 도메인**: Workloads & Scheduling (15%)

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

---

### Lab 2.8: DaemonSet 관리 (Cilium DaemonSet 분석)

**학습 목표**: tart-infra에서 사용 중인 Cilium DaemonSet을 분석하고, DaemonSet의 동작 원리를 이해한다.

**CKA 관련 도메인**: Workloads & Scheduling (15%)

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

---

### Lab 2.9: Job 생성 (busybox 일회성 작업)

**학습 목표**: Job 리소스를 생성하여 일회성 작업을 수행하고, completions와 parallelism을 이해한다.

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

---

## 실습 3: Services & Networking (20%)

> CKA 시험의 20%를 차지하는 도메인이다. Service 유형, NetworkPolicy, DNS, CNI, Ingress 등이 출제 범위이다.

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

**확인 문제**:
1. ClusterIP Service의 IP는 어느 CIDR 범위에서 할당되는가?
2. NodePort의 기본 범위는 무엇인가?
3. tart-infra에서 NodePort를 사용하는 서비스 목록을 말하라.

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

**확인 문제**:
1. Service의 Endpoint가 비어 있으면 어떤 증상이 나타나는가?
2. Endpoint가 비어 있는 가장 흔한 원인 3가지는 무엇인가?
3. EndpointSlice와 Endpoints 리소스의 차이는 무엇인가?

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

**확인 문제**:
1. Headless Service는 어떤 유형의 애플리케이션에 적합한가?
2. StatefulSet에서 Headless Service를 사용하는 이유는 무엇인가?
3. Headless Service의 DNS 응답이 일반 Service와 다른 점은 무엇인가?

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

**확인 문제**:
1. NetworkPolicy에서 `podSelector: {}`는 어떤 의미인가?
2. DNS Egress를 별도로 허용해야 하는 이유는 무엇인가?
3. Ingress 정책과 Egress 정책을 모두 설정해야 하는 이유는 무엇인가?

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

---

## 실습 4: Storage (10%)

> CKA 시험의 10%를 차지하는 도메인이다. PV, PVC, StorageClass, Volume 마운트 등이 출제 범위이다.

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

**확인 문제**:
1. `WaitForFirstConsumer`가 `Immediate`와 다른 점은 무엇인가?
2. `reclaimPolicy: Delete`는 PVC 삭제 시 어떤 동작을 하는가?
3. StorageClass가 없는 PVC는 어떤 StorageClass를 사용하는가?

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

**확인 문제**:
1. PV와 PVC의 `storageClassName`이 일치해야 바인딩되는가?
2. PV의 `capacity.storage`가 PVC의 `requests.storage`보다 작으면 어떻게 되는가?
3. `storageClassName: ""`으로 설정하면 어떤 의미인가?

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

---

## 실습 5: Troubleshooting (30%) — CKA 최고 출제 비율!

> CKA 시험의 30%를 차지하는 가장 중요한 도메인이다. Pod 상태 진단, kubelet 트러블슈팅, 인증서, DNS, 로그 분석, 네트워크 문제 해결 등이 출제 범위이다.

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

**확인 문제**:
1. ImagePullBackOff의 일반적인 원인 3가지를 말하라.
2. BackOff의 재시도 간격은 어떻게 증가하는가?
3. private registry 이미지를 pull하려면 어떤 리소스가 필요한가?

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

**확인 문제**:
1. `kubectl logs --previous` 플래그의 용도는 무엇인가?
2. Exit Code 137과 Exit Code 1의 차이는 무엇인가?
3. CrashLoopBackOff에서 BackOff 시간은 최대 얼마까지 증가하는가?

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

**확인 문제**:
1. Pending 상태의 Pod가 발생하는 원인 5가지를 나열하라.
2. `kubectl describe nodes`의 `Allocated resources` 섹션에서 어떤 정보를 얻을 수 있는가?
3. ResourceQuota가 설정된 네임스페이스에서 requests를 설정하지 않으면 어떻게 되는가?

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

**확인 문제**:
1. Exit Code 137이 OOMKilled를 의미하는 이유를 설명하라.
2. OOMKilled와 Eviction의 차이는 무엇인가?
3. memory requests와 limits를 어떻게 설정하면 OOMKilled를 방지할 수 있는가?

---

### Lab 5.5: kubelet 트러블슈팅 (SSH → systemctl, journalctl)

**학습 목표**: SSH로 노드에 접속하여 kubelet 상태를 진단하고 복구한다.

**CKA 관련 도메인**: Troubleshooting (30%)

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

**확인 문제**:
1. kubelet이 중지되면 노드 상태가 NotReady로 변하기까지 얼마나 걸리는가?
2. `journalctl -u kubelet`에서 `-p err` 플래그의 의미는 무엇인가?
3. kubelet이 시작되지 않는 일반적인 원인 5가지를 나열하라.

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

**확인 문제**:
1. CoreDNS가 CrashLoopBackOff 상태일 때 확인해야 할 3가지는 무엇인가?
2. Corefile의 `forward . /etc/resolv.conf` 설정의 역할은 무엇인가?
3. DNS 해석이 안 될 때 Pod의 `/etc/resolv.conf`를 확인하는 이유는 무엇인가?

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

**확인 문제**:
1. 노드가 NotReady로 변하는 일반적인 원인 5가지를 나열하라.
2. `kubectl drain`과 `kubectl cordon`의 차이는 무엇인가?
3. kubelet이 API Server와 통신하지 못하면 노드 상태는 어떻게 표시되는가?

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

**확인 문제**:
1. `crictl`과 `docker` CLI의 차이는 무엇인가?
2. crictl 설정 파일의 위치와 주요 설정 항목을 말하라.
3. containerd가 중지되면 기존 실행 중인 컨테이너는 어떻게 되는가?

---

## 종합 시나리오

> 아래 시나리오는 CKA 시험의 실제 문제 형식을 모방한 것이다. 시간을 재면서 풀어보라. CKA 시험 시간은 2시간이며, 각 시나리오는 약 20-30분 내에 완료해야 한다.

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

> **팁**: 쉬운 문제부터 풀고, 어려운 문제는 마킹 후 나중에 돌아오라. `kubectl explain`을 활용하여 리소스 필드를 확인하라. `--dry-run=client -o yaml`로 템플릿을 빠르게 생성하라.
