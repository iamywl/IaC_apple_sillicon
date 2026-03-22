# 재연 가이드 03. 17단계 설치 파이프라인 상세

이 문서는 `scripts/install.sh`가 실행하는 17개 설치 단계를 각각 분해하여 설명한다. 각 단계마다 수행하는 작업, 순서의 이유, 핵심 명령어, 예상 출력, 문제 해결 방법을 포함한다.

---

## 오케스트레이터: install.sh

`scripts/install.sh`가 17단계를 순서대로 호출한다. Golden image 사용 시 Phase 2~4를 자동으로 건너뛴다.

```
install.sh
├── Phase 1:  01-create-vms.sh              ← VM 생성
├── (VM 시작 + SSH 대기)
├── Phase 2:  02-prepare-nodes.sh            ← OS 설정 (golden image 시 스킵)
├── Phase 3:  03-install-runtime.sh          ← containerd (golden image 시 스킵)
├── Phase 4:  04-install-kubeadm.sh          ← kubeadm (golden image 시 스킵)
├── Phase 5:  05-init-clusters.sh            ← kubeadm init/join
├── Phase 6:  06-install-cilium.sh           ← CNI + Hubble
├── Phase 7:  07-install-monitoring.sh       ← Prometheus + Grafana + Loki
├── Phase 8:  08-install-cicd.sh             ← ArgoCD + Jenkins
├── Phase 9:  09-install-alerting.sh         ← AlertManager + rules
├── Phase 10: 10-install-network-policies.sh ← CiliumNetworkPolicy
├── Phase 11: 11-install-hpa.sh              ← metrics-server + HPA + PDB
├── Phase 12: 12-install-istio.sh            ← Istio service mesh
├── Phase 13: 13-install-sealed-secrets.sh   ← Sealed Secrets 시크릿 관리
├── Phase 14: 14-install-rbac-gatekeeper.sh  ← RBAC + OPA Gatekeeper
├── Phase 15: 15-install-backup.sh           ← etcd 백업 + Velero
├── Phase 16: 16-install-resource-quotas.sh  ← ResourceQuota + LimitRange
└── Phase 17: 17-install-harbor.sh           ← Harbor 프라이빗 레지스트리
```

---

## Phase 1: VM 생성 (01-create-vms.sh)

### 이 단계가 하는 일

`config/clusters.json`에 정의된 10개 VM을 Tart로 생성한다. 베이스 이미지를 clone하고, 각 VM에 CPU와 메모리를 설정한다.

### 왜 이 순서인가

모든 후속 작업의 대상인 VM이 존재해야 하므로 가장 먼저 실행한다.

### 핵심 명령어

install.sh가 이 스크립트 실행 전에 먼저 베이스 이미지를 pull한다:

```bash
# 베이스 이미지 pull (최초 1회, 이후 캐시)
tart pull ghcr.io/cirruslabs/ubuntu:latest
```

각 VM에 대해 다음을 수행한다:

```bash
# VM clone
tart clone ghcr.io/cirruslabs/ubuntu:latest platform-master

# CPU, 메모리 설정
tart set platform-master --cpu 2 --memory 4096
```

install.sh가 Phase 1 완료 후, 모든 VM을 시작하고 SSH 접근이 가능해질 때까지 대기한다:

```bash
# VM 시작 (백그라운드, 그래픽 없음)
tart run platform-master --no-graphics --net-softnet-allow=0.0.0.0/0 &

# IP 할당 대기
tart ip platform-master
# 192.168.64.x

# SSH 접속 가능 대기
sshpass -p admin ssh -o StrictHostKeyChecking=no admin@192.168.64.x "echo ok"
```

`--net-softnet-allow=0.0.0.0/0` 플래그는 VM이 모든 IP 대역으로 네트워크 트래픽을 전송할 수 있도록 허용한다. Pod CIDR 간 라우팅에 필요하다.

### 예상 출력

```
========== Phase 1: Creating VMs ==========

========== Pulling base image ==========
[INFO] Base image already cached.

[INFO] Cloning 'ghcr.io/cirruslabs/ubuntu:latest' -> 'platform-master'...
[INFO] Setting resources for 'platform-master': 2 CPU, 4096MB RAM
[INFO] Cloning 'ghcr.io/cirruslabs/ubuntu:latest' -> 'platform-worker1'...
[INFO] Setting resources for 'platform-worker1': 3 CPU, 12288MB RAM
...
[INFO] All VMs created successfully.
```

### 문제 발생 시 확인 사항

- `tart clone` 실패: 디스크 공간 부족. `df -h /`로 확인한다.
- `tart pull` 실패: 네트워크 문제. `ghcr.io` 접근이 차단되지 않았는지 확인한다.
- 같은 이름의 VM이 이미 존재: 스크립트가 자동으로 건너뛴다. 완전히 새로 시작하려면 `./scripts/destroy.sh`를 먼저 실행한다.
- IP 할당 실패(timeout): macOS 네트워크 설정 확인. `tart list`에서 VM이 `running` 상태인지 확인한다.

---

## Phase 2: 노드 준비 (02-prepare-nodes.sh)

### 이 단계가 하는 일

모든 VM에 SSH로 접속하여 Kubernetes 실행에 필요한 OS 설정을 수행한다.

### 왜 이 순서인가

containerd와 kubeadm을 설치하기 전에 커널 모듈과 sysctl 설정이 완료되어야 한다. 예를 들어, `br_netfilter` 모듈이 없으면 Pod 간 네트워크 트래픽이 iptables 규칙을 통과하지 못한다.

### 핵심 명령어

각 노드(10개 모두)에서 다음을 실행한다:

```bash
# 1. swap 비활성화
swapoff -a
sed -i '/swap/d' /etc/fstab
```

Kubernetes는 swap이 활성화된 노드에서 kubelet이 정상 동작하지 않는다. kubelet은 메모리 관리를 직접 수행하므로 swap이 있으면 리소스 계산이 불정확해진다.

```bash
# 2. 커널 모듈 로드
cat > /etc/modules-load.d/k8s.conf <<EOF
overlay
br_netfilter
EOF
modprobe overlay
modprobe br_netfilter
```

- `overlay`: containerd가 overlay filesystem을 사용하여 컨테이너 레이어를 관리한다.
- `br_netfilter`: 브릿지 네트워크 트래픽이 iptables 규칙을 통과하도록 한다. 이 모듈이 없으면 Pod-to-Service 통신이 불가하다.

```bash
# 3. sysctl 설정
cat > /etc/sysctl.d/k8s.conf <<EOF
net.bridge.bridge-nf-call-iptables  = 1
net.bridge.bridge-nf-call-ip6tables = 1
net.ipv4.ip_forward                 = 1
EOF
sysctl --system
```

- `bridge-nf-call-iptables`: 브릿지 트래픽에 iptables 규칙을 적용한다.
- `ip_forward`: 노드가 패킷을 포워딩할 수 있게 한다. Pod 간 통신에 필수이다.

```bash
# 4. hostname 설정
hostnamectl set-hostname 'platform-master'
```

Kubernetes 노드 이름은 hostname을 기반으로 한다. `kubeadm join`에서 `--node-name`을 지정하지만, hostname도 일치해야 혼란이 없다.

### 예상 출력

```
========== Phase 2: Preparing Nodes (OS config) ==========

[INFO] Preparing node 'platform-master' (192.168.64.3)...
[INFO] Preparing node 'platform-worker1' (192.168.64.4)...
[INFO] Preparing node 'platform-worker2' (192.168.64.5)...
...
[INFO] All nodes prepared.
```

### 문제 발생 시 확인 사항

- SSH 접속 실패: `sshpass -p admin ssh -o StrictHostKeyChecking=no admin@<ip> "echo ok"`으로 직접 테스트한다.
- `modprobe: FATAL: Module not found`: Tart Ubuntu 이미지 버전 문제. 최신 이미지를 다시 pull한다.
- sysctl 적용 확인: `sysctl net.bridge.bridge-nf-call-iptables`의 출력이 `1`이어야 한다.

---

## Phase 3: 컨테이너 런타임 (03-install-runtime.sh)

### 이 단계가 하는 일

모든 노드에 containerd를 설치하고, SystemdCgroup을 활성화한다.

### 왜 이 순서인가

kubeadm이 kubelet을 시작하려면 컨테이너 런타임이 먼저 설치되어 있어야 한다.

### 핵심 명령어

```bash
# containerd 및 의존성 설치
apt-get update -qq
apt-get install -y -qq containerd apt-transport-https ca-certificates curl gnupg conntrack
```

```bash
# containerd 기본 설정 생성 후 SystemdCgroup 활성화
mkdir -p /etc/containerd
containerd config default > /etc/containerd/config.toml
sed -i 's/SystemdCgroup = false/SystemdCgroup = true/' /etc/containerd/config.toml
```

**SystemdCgroup = true로 설정하는 이유**: kubelet은 systemd를 cgroup 드라이버로 사용한다 (Kubernetes 1.22 이후 기본값). containerd도 동일한 cgroup 드라이버를 사용해야 한다. 불일치하면 kubelet이 Pod을 생성하지 못한다.

```bash
# containerd 재시작 및 자동 시작 설정
systemctl restart containerd
systemctl enable containerd
```

### 예상 출력

```
========== Phase 3: Installing Container Runtime (containerd) ==========

[INFO] Installing containerd on 'platform-master'...
[INFO] Installing containerd on 'platform-worker1'...
...
[INFO] containerd installed on all nodes.
```

### 문제 발생 시 확인 사항

- `apt-get update` 실패: VM의 DNS 설정 확인. `ssh admin@<ip> "cat /etc/resolv.conf"`로 DNS 서버가 설정되어 있는지 본다.
- containerd 서비스 상태 확인: `ssh admin@<ip> "sudo systemctl status containerd"`
- SystemdCgroup 설정 확인: `ssh admin@<ip> "sudo grep SystemdCgroup /etc/containerd/config.toml"`

---

## Phase 4: kubeadm 설치 (04-install-kubeadm.sh)

### 이 단계가 하는 일

모든 노드에 kubelet, kubeadm, kubectl v1.31을 설치하고, 버전을 고정(hold)한다.

### 왜 이 순서인가

Phase 5에서 `kubeadm init`을 실행하려면 kubeadm이 설치되어 있어야 한다. 또한 kubelet이 시스템 서비스로 등록되어야 한다.

### v1.31을 사용하는 이유

이 프로젝트는 Kubernetes v1.31을 사용한다. 그 이유는 다음과 같다:

1. 프로젝트 구축 시점의 최신 안정 버전이다.
2. Cilium 1.16.x가 v1.31을 공식 지원한다.
3. Istio가 v1.31을 지원한다.
4. `apt-mark hold`로 버전을 고정하여 `apt upgrade` 시 의도치 않은 업그레이드를 방지한다.

### 핵심 명령어

```bash
# Kubernetes apt 저장소 GPG 키 추가
curl -fsSL https://pkgs.k8s.io/core:/stable:/v1.31/deb/Release.key | \
  gpg --dearmor -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg

# apt 저장소 추가
echo 'deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/v1.31/deb/ /' \
  > /etc/apt/sources.list.d/kubernetes.list

# 설치
apt-get update -qq
apt-get install -y -qq kubelet kubeadm kubectl

# 버전 고정
apt-mark hold kubelet kubeadm kubectl

# kubelet 자동 시작 등록
systemctl enable kubelet
```

### 예상 출력

```
========== Phase 4: Installing kubeadm, kubelet, kubectl ==========

[INFO] Installing kubeadm on 'platform-master'...
[INFO] Installing kubeadm on 'platform-worker1'...
...
[INFO] kubeadm installed on all nodes.
```

### 문제 발생 시 확인 사항

- GPG 키 다운로드 실패: `pkgs.k8s.io` 접근 문제. 프록시 설정을 확인한다.
- 패키지를 찾을 수 없음: apt 저장소 URL이 올바른지 확인한다. v1.31이 아직 해당 미러에 배포되지 않았을 수 있다.
- 설치된 버전 확인: `ssh admin@<ip> "kubeadm version"`

---

## Phase 5: 클러스터 초기화 (05-init-clusters.sh)

### 이 단계가 하는 일

4개 클러스터 각각에서 `kubeadm init`으로 마스터 노드를 초기화하고, `kubeadm join`으로 워커 노드를 합류시킨다. kubeconfig 파일을 로컬(`kubeconfig/`)에 복사한다.

### 왜 이 순서인가

Phase 2~4에서 모든 노드에 containerd, kubeadm이 설치된 상태이다. 이 단계에서 실제 Kubernetes 클러스터가 생성된다. Phase 6(Cilium)이 설치되기 전까지 노드 상태는 `NotReady`이다. CNI가 없으면 kubelet이 노드를 Ready로 마킹하지 않는다.

### 핵심 명령어

각 클러스터(platform, dev, staging, prod)에 대해 다음을 수행한다.

**1) 이전 상태 정리 (멱등성 보장)**

```bash
# 마스터 노드에서
kubeadm reset -f
rm -rf /etc/kubernetes /var/lib/kubelet /var/lib/etcd /etc/cni/net.d
iptables -F && iptables -X && iptables -t nat -F
systemctl restart containerd

# 워커 노드에서도 동일
kubeadm reset -f
rm -rf /etc/kubernetes /var/lib/kubelet /etc/cni/net.d
iptables -F
systemctl restart containerd
```

이 정리 단계 덕분에 스크립트를 여러 번 실행해도 안전하다.

**2) 마스터 초기화**

```bash
kubeadm init \
  --pod-network-cidr='10.10.0.0/16' \
  --service-cidr='10.96.0.0/16' \
  --skip-phases=addon/kube-proxy \
  --apiserver-advertise-address='192.168.64.x' \
  --node-name='platform-master'
```

- `--pod-network-cidr`: clusters.json에서 읽은 Pod CIDR이다. Cilium이 이 대역으로 Pod IP를 할당한다.
- `--service-cidr`: ClusterIP Service에 할당되는 대역이다.
- `--skip-phases=addon/kube-proxy`: kube-proxy를 설치하지 않는다. Cilium이 kube-proxy의 역할(서비스 로드밸런싱)을 대체한다.
- `--apiserver-advertise-address`: 마스터 노드의 VM IP이다. 워커가 이 IP로 API server에 접근한다.
- `--node-name`: Kubernetes에 등록되는 노드 이름이다.

**3) kubeconfig 설정 및 로컬 복사**

```bash
# 마스터 노드 내부
mkdir -p $HOME/.kube
sudo cp /etc/kubernetes/admin.conf $HOME/.kube/config
sudo chown $(id -u):$(id -g) $HOME/.kube/config

# 로컬로 복사
scp admin@<master-ip>:.kube/config kubeconfig/platform.yaml
```

**4) 워커 합류**

```bash
# 마스터에서 join 토큰 생성
kubeadm token create --print-join-command
# 출력: kubeadm join 192.168.64.x:6443 --token xxx --discovery-token-ca-cert-hash sha256:xxx

# 각 워커에서 실행
kubeadm join 192.168.64.x:6443 \
  --token xxx \
  --discovery-token-ca-cert-hash sha256:xxx \
  --node-name='platform-worker1'
```

### 예상 출력

```
========== Initializing cluster: platform ==========

[INFO] Master: platform-master (192.168.64.3)
...
Your Kubernetes control-plane has initialized successfully!
...
[INFO] Joining worker 'platform-worker1' (192.168.64.4) to cluster 'platform'...
This node has joined the cluster
[INFO] Joining worker 'platform-worker2' (192.168.64.5) to cluster 'platform'...
This node has joined the cluster

========== Initializing cluster: dev ==========
...
[INFO] All clusters initialized.
```

### 문제 발생 시 확인 사항

- `kubeadm init` 실패: kubelet 로그 확인 - `ssh admin@<ip> "sudo journalctl -u kubelet -n 50"`
- containerd 소켓 에러: `ssh admin@<ip> "sudo systemctl status containerd"`. containerd가 running이어야 한다.
- "port 6443 already in use": 이전 설치의 잔재. `kubeadm reset -f`가 제대로 실행되었는지 확인한다.
- join 실패: 토큰 만료(24시간). 스크립트는 init 직후에 join을 수행하므로 정상 상황에서는 발생하지 않는다.
- NotReady 상태: 정상이다. CNI(Cilium)가 Phase 6에서 설치된 후 Ready로 전환된다.

---

## Phase 6: Cilium CNI + Hubble (06-install-cilium.sh)

### 이 단계가 하는 일

4개 클러스터 모두에 Cilium CNI와 Hubble(네트워크 관측 도구)를 설치한다. 설치 후 모든 노드가 Ready 상태가 될 때까지 대기한다.

### 왜 이 순서인가

Kubernetes 노드가 Ready 상태가 되려면 CNI 플러그인이 필수이다. Phase 5에서 생성한 클러스터의 노드가 모두 NotReady 상태이므로, CNI 설치가 다음 우선순위이다. 이후 Phase 7~12의 모든 Pod이 정상적으로 스케줄링되려면 노드가 Ready여야 한다.

### Cilium을 선택한 이유

1. **kube-proxy 대체**: Cilium은 eBPF를 사용하여 kube-proxy 없이 서비스 로드밸런싱을 수행한다. iptables 규칙이 필요 없어 성능이 향상된다.
2. **NetworkPolicy 확장**: CiliumNetworkPolicy는 표준 NetworkPolicy보다 세밀한 L7 정책(HTTP 경로, 메서드 등)을 지원한다. Phase 10에서 사용한다.
3. **Hubble**: 네트워크 흐름을 실시간으로 관측할 수 있다. Dropped 패킷, 서비스 간 통신 맵 등을 시각화한다.

### 핵심 명령어

**Cilium 설치 (각 클러스터마다)**:

```bash
helm repo add cilium https://helm.cilium.io/
helm repo update

helm upgrade --install cilium cilium/cilium \
  --kubeconfig kubeconfig/platform.yaml \
  --namespace kube-system \
  --values manifests/cilium-values.yaml \
  --set ipam.operator.clusterPoolIPv4PodCIDRList="{10.10.0.0/16}" \
  --set cluster.name="platform" \
  --set k8sServiceHost="192.168.64.x" \
  --set k8sServicePort=6443 \
  --wait --timeout 10m
```

- `clusterPoolIPv4PodCIDRList`: clusters.json에서 읽은 Pod CIDR을 Cilium에 전달한다.
- `cluster.name`: 멀티 클러스터 구별용 이름이다.
- `k8sServiceHost`/`k8sServicePort`: API server 주소이다. Cilium agent가 Kubernetes API에 접근하는 데 사용한다.

**Hubble 활성화**:

```bash
helm upgrade cilium cilium/cilium \
  --kubeconfig kubeconfig/platform.yaml \
  --namespace kube-system \
  --reuse-values \
  --values manifests/hubble-values.yaml \
  --wait --timeout 10m
```

`--reuse-values`로 기존 Cilium 설정을 유지하면서 Hubble 관련 설정만 추가한다.

**노드 Ready 대기**:

```bash
kubectl --kubeconfig kubeconfig/platform.yaml get nodes
# 모든 노드가 Ready가 될 때까지 반복 확인
```

### 예상 출력

```
========== Phase 6: Installing Cilium + Hubble ==========

[INFO] Installing Cilium on 'platform' (API: 192.168.64.3)...
[INFO] Enabling Hubble on 'platform'...
[INFO] Installing Cilium on 'dev' (API: 192.168.64.6)...
[INFO] Enabling Hubble on 'dev'...
...
[INFO] Waiting for all nodes in 'platform' to be Ready...
[INFO] All nodes in 'platform' are Ready.
NAME                STATUS   ROLES           AGE   VERSION
platform-master     Ready    control-plane   5m    v1.31.x
platform-worker1    Ready    <none>          4m    v1.31.x
platform-worker2    Ready    <none>          4m    v1.31.x
...
[INFO] Cilium + Hubble installed on all clusters.
```

### 문제 발생 시 확인 사항

- Cilium Pod이 CrashLoopBackOff: 메모리 부족 또는 커널 모듈 누락. `kubectl -n kube-system logs <cilium-pod>`를 확인한다.
- 노드가 Ready로 전환되지 않음: Cilium agent DaemonSet이 모든 노드에서 Running인지 확인한다.

```bash
kubectl --kubeconfig kubeconfig/platform.yaml -n kube-system get pods -l k8s-app=cilium
```

- Helm timeout: 컨테이너 이미지 pull이 느린 경우. Golden image를 사용하면 Cilium 이미지가 미리 캐시되어 있다.

---

## Phase 7: 모니터링 (07-install-monitoring.sh)

### 이 단계가 하는 일

platform 클러스터에 Prometheus + Grafana + Loki + AlertManager를 설치한다.

### 왜 이 순서인가

Phase 6에서 노드가 Ready 상태이므로 Pod 스케줄링이 가능하다. 모니터링을 먼저 설치하면 Phase 8~12의 설치 과정도 모니터링할 수 있다.

### 핵심 명령어

```bash
# Helm 저장소 추가
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo add grafana https://grafana.github.io/helm-charts
helm repo update

# kube-prometheus-stack 설치 (Prometheus + Grafana + AlertManager + node-exporter + kube-state-metrics)
kubectl --kubeconfig kubeconfig/platform.yaml create namespace monitoring

helm upgrade --install kube-prometheus-stack prometheus-community/kube-prometheus-stack \
  --kubeconfig kubeconfig/platform.yaml \
  --namespace monitoring \
  --values manifests/monitoring-values.yaml \
  --wait --timeout 10m

# Loki (로그 수집)
helm upgrade --install loki grafana/loki-stack \
  --kubeconfig kubeconfig/platform.yaml \
  --namespace monitoring \
  --values manifests/loki-values.yaml \
  --wait --timeout 5m
```

`kube-prometheus-stack`은 하나의 Helm 차트로 다음을 모두 설치한다:
- **Prometheus**: 메트릭 수집 및 저장 (TSDB)
- **Grafana**: 대시보드 시각화
- **AlertManager**: 알림 라우팅 및 발송
- **node-exporter**: 호스트 메트릭 수집 (CPU, 메모리, 디스크)
- **kube-state-metrics**: Kubernetes 오브젝트 상태 메트릭

`manifests/monitoring-values.yaml`에 NodePort(30300), 기본 대시보드, scrape 설정 등이 정의되어 있다.

### 예상 출력

```
========== Phase 7: Installing Monitoring Stack on 'platform' ==========

[INFO] Installing kube-prometheus-stack...
...
[INFO] Installing Loki...
...
[INFO] Monitoring stack installed.
[INFO] Grafana URL: http://192.168.64.4:30300
[INFO] Grafana credentials: admin / admin
```

### 문제 발생 시 확인 사항

- Pod이 Pending 상태: 워커 노드의 리소스 부족. `kubectl describe pod <pod> -n monitoring`에서 Events 섹션을 확인한다.
- Grafana 접속 불가: NodePort가 올바르게 설정되었는지 확인한다.

```bash
kubectl --kubeconfig kubeconfig/platform.yaml -n monitoring get svc | grep grafana
```

- Prometheus가 타겟을 scrape하지 못함: `http://<IP>:30300`에서 Grafana에 접속 후 Explore > Prometheus에서 `up` 쿼리를 실행하여 확인한다.

---

## Phase 8: CI/CD (08-install-cicd.sh)

### 이 단계가 하는 일

platform 클러스터에 ArgoCD와 Jenkins를 설치한다. Jenkins의 PVC를 위한 local-path-provisioner도 설치한다.

### 왜 이 순서인가

모니터링이 먼저 설치되어 있으므로, CI/CD 설치 과정에서 문제가 발생하면 Grafana에서 리소스 상태를 확인할 수 있다.

### 핵심 명령어

```bash
# local-path-provisioner (Jenkins PVC에 필요)
kubectl --kubeconfig kubeconfig/platform.yaml apply -f \
  https://raw.githubusercontent.com/rancher/local-path-provisioner/v0.0.28/deploy/local-path-storage.yaml

# StorageClass를 default로 설정
kubectl --kubeconfig kubeconfig/platform.yaml patch storageclass local-path \
  -p '{"metadata": {"annotations":{"storageclass.kubernetes.io/is-default-class":"true"}}}'

# ArgoCD
kubectl --kubeconfig kubeconfig/platform.yaml create namespace argocd

helm repo add argo https://argoproj.github.io/argo-helm
helm upgrade --install argocd argo/argo-cd \
  --kubeconfig kubeconfig/platform.yaml \
  --namespace argocd \
  --values manifests/argocd-values.yaml \
  --wait --timeout 10m

# Jenkins
kubectl --kubeconfig kubeconfig/platform.yaml create namespace jenkins

helm repo add jenkins https://charts.jenkins.io
helm upgrade --install jenkins jenkins/jenkins \
  --kubeconfig kubeconfig/platform.yaml \
  --namespace jenkins \
  --values manifests/jenkins-values.yaml \
  --wait --timeout 10m
```

**local-path-provisioner를 설치하는 이유**: 베어메탈(VM) 환경에는 클라우드 스토리지 프로비저너가 없다. Jenkins는 PersistentVolumeClaim이 필요하므로, 노드의 로컬 디스크를 PV로 자동 프로비저닝하는 local-path-provisioner를 사용한다.

### 예상 출력

```
========== Phase 8: Installing CI/CD (ArgoCD + Jenkins) on 'platform' ==========

[INFO] Installing local-path-provisioner...
[INFO] Installing ArgoCD...
[INFO] Installing Jenkins...
[INFO] ArgoCD URL: http://192.168.64.4:30800
[INFO] ArgoCD credentials: admin / <auto-generated>
[INFO] Jenkins URL: http://192.168.64.4:30900
[INFO] Jenkins credentials: admin / <auto-generated>
```

### 문제 발생 시 확인 사항

- Jenkins Pod이 Pending: PVC가 바인딩되지 않음. `kubectl -n jenkins get pvc`로 확인하고, local-path-provisioner Pod이 Running인지 확인한다.
- ArgoCD server가 접속 안 됨: NodePort 확인.

```bash
kubectl --kubeconfig kubeconfig/platform.yaml -n argocd get svc argocd-server
```

---

## Phase 9: 알림 (09-install-alerting.sh)

### 이 단계가 하는 일

platform 클러스터의 AlertManager를 활성화하고, PrometheusRule CRD와 webhook logger를 배포한다.

### 왜 이 순서인가

Phase 7에서 kube-prometheus-stack이 설치되어 있으므로 AlertManager CRD가 이미 존재한다. 이 단계에서는 알림 규칙과 알림 수신 대상(webhook)을 추가한다.

### 핵심 명령어

```bash
# kube-prometheus-stack 업그레이드 (AlertManager 설정 적용)
helm upgrade kube-prometheus-stack prometheus-community/kube-prometheus-stack \
  --kubeconfig kubeconfig/platform.yaml \
  --namespace monitoring \
  --values manifests/monitoring-values.yaml \
  --wait --timeout 10m

# webhook logger 배포 (알림 수신 테스트용)
kubectl --kubeconfig kubeconfig/platform.yaml apply -f manifests/alerting/webhook-logger.yaml

# PrometheusRule 배포 (알림 규칙)
kubectl --kubeconfig kubeconfig/platform.yaml apply -f manifests/alerting/prometheus-rules.yaml
```

webhook logger는 AlertManager로부터 알림을 수신하여 로그에 기록하는 간단한 서비스이다. 실무에서는 Slack, PagerDuty 등으로 교체한다.

### 예상 출력

```
========== Phase 9: Enabling AlertManager + Alert Rules on 'platform' ==========

[INFO] Upgrading kube-prometheus-stack with AlertManager enabled...
[INFO] Deploying AlertManager webhook logger...
[INFO] Applying PrometheusRule CRDs...
[INFO] AlertManager UI: http://192.168.64.4:30903
```

### 문제 발생 시 확인 사항

- AlertManager Pod 상태 확인:

```bash
kubectl --kubeconfig kubeconfig/platform.yaml -n monitoring get pods -l app.kubernetes.io/name=alertmanager
```

- webhook 로그 확인:

```bash
kubectl --kubeconfig kubeconfig/platform.yaml -n monitoring logs -l app=alertmanager-webhook
```

---

## Phase 10: 네트워크 정책 (10-install-network-policies.sh)

### 이 단계가 하는 일

dev 클러스터의 demo 네임스페이스에 CiliumNetworkPolicy를 적용한다. Default Deny 정책을 먼저 적용한 후, 필요한 통신만 허용하는 Allowlist 규칙을 추가한다.

### 왜 이 순서인가

Phase 6에서 Cilium이 설치되어 CiliumNetworkPolicy CRD가 사용 가능하다. Phase 11에서 데모 앱을 배포하기 전에 네트워크 정책을 먼저 정의한다.

### 핵심 명령어

```bash
# demo 네임스페이스 생성
kubectl --kubeconfig kubeconfig/dev.yaml create namespace demo

# 1. Default Deny (모든 트래픽 차단)
kubectl --kubeconfig kubeconfig/dev.yaml apply -f manifests/network-policies/default-deny.yaml

# 2. Allowlist 규칙 (필요한 통신만 허용)
kubectl --kubeconfig kubeconfig/dev.yaml apply -f manifests/network-policies/allow-external-to-nginx.yaml
kubectl --kubeconfig kubeconfig/dev.yaml apply -f manifests/network-policies/allow-nginx-to-httpbin.yaml
kubectl --kubeconfig kubeconfig/dev.yaml apply -f manifests/network-policies/allow-nginx-to-redis.yaml
kubectl --kubeconfig kubeconfig/dev.yaml apply -f manifests/network-policies/allow-nginx-egress.yaml
kubectl --kubeconfig kubeconfig/dev.yaml apply -f manifests/network-policies/allow-httpbin-to-postgres.yaml
kubectl --kubeconfig kubeconfig/dev.yaml apply -f manifests/network-policies/allow-httpbin-to-rabbitmq.yaml
kubectl --kubeconfig kubeconfig/dev.yaml apply -f manifests/network-policies/allow-httpbin-to-keycloak.yaml
kubectl --kubeconfig kubeconfig/dev.yaml apply -f manifests/network-policies/allow-keycloak-to-postgres.yaml
kubectl --kubeconfig kubeconfig/dev.yaml apply -f manifests/network-policies/allow-external-to-keycloak.yaml
```

### 데모 앱의 통신 흐름

```
외부 요청
  │
  ├──→ nginx-web ──→ httpbin ──→ postgres
  │       │              │──→ rabbitmq
  │       │──→ redis     └──→ keycloak ──→ postgres
  │
  └──→ keycloak (외부 직접 접근)
```

Default Deny를 먼저 적용하므로, 위 경로 외의 모든 통신은 차단된다. 예를 들어, redis에서 postgres로의 직접 접근은 허용 규칙이 없으므로 차단된다.

### 예상 출력

```
========== Phase 10: Installing CiliumNetworkPolicies on 'dev' ==========

[INFO] Applying default deny...
[INFO] Applying allow rules...
[INFO] Current CiliumNetworkPolicies:
NAME                           AGE
default-deny                   5s
allow-external-to-nginx        3s
allow-nginx-to-httpbin         3s
...
```

### 문제 발생 시 확인 사항

- 정책 확인:

```bash
kubectl --kubeconfig kubeconfig/dev.yaml -n demo get ciliumnetworkpolicies
```

- Hubble로 트래픽 관찰 (Cilium CLI 필요):

```bash
# DROPPED 패킷 확인 (차단된 트래픽)
hubble observe --namespace demo --verdict DROPPED

# FORWARDED 패킷 확인 (허용된 트래픽)
hubble observe --namespace demo --verdict FORWARDED
```

---

## Phase 11: 오토스케일링 (11-install-hpa.sh)

### 이 단계가 하는 일

dev, staging 클러스터에 metrics-server를 설치한다. dev 클러스터에 데모 앱 6개를 배포하고, HPA(Horizontal Pod Autoscaler)와 PDB(PodDisruptionBudget)를 적용한다.

### 왜 이 순서인가

Phase 10에서 네트워크 정책이 적용되어 있으므로, 이 단계에서 배포하는 데모 앱은 즉시 정책의 보호를 받는다. HPA는 metrics-server가 CPU/메모리 메트릭을 수집해야 동작하므로, metrics-server를 먼저 설치한다.

### 핵심 명령어

**metrics-server 설치 (dev, staging)**:

```bash
helm repo add metrics-server https://kubernetes-sigs.github.io/metrics-server/
helm repo update

helm upgrade --install metrics-server metrics-server/metrics-server \
  --kubeconfig kubeconfig/dev.yaml \
  --namespace kube-system \
  --values manifests/metrics-server-values.yaml \
  --wait --timeout 5m
```

`manifests/metrics-server-values.yaml`에는 `--kubelet-insecure-tls` 옵션이 포함되어 있을 가능성이 높다. 자체 서명 인증서 환경에서 kubelet과의 TLS 검증을 건너뛰기 위해서이다.

**데모 앱 배포 (dev)**:

```bash
kubectl --kubeconfig kubeconfig/dev.yaml create namespace demo
kubectl --kubeconfig kubeconfig/dev.yaml apply -f manifests/demo/nginx-app.yaml
kubectl --kubeconfig kubeconfig/dev.yaml apply -f manifests/demo/httpbin-app.yaml
kubectl --kubeconfig kubeconfig/dev.yaml apply -f manifests/demo/redis-app.yaml
kubectl --kubeconfig kubeconfig/dev.yaml apply -f manifests/demo/postgres-app.yaml
kubectl --kubeconfig kubeconfig/dev.yaml apply -f manifests/demo/rabbitmq-app.yaml
kubectl --kubeconfig kubeconfig/dev.yaml apply -f manifests/demo/keycloak-app.yaml
```

**HPA 적용**:

```bash
kubectl --kubeconfig kubeconfig/dev.yaml apply -f manifests/hpa/nginx-hpa.yaml
kubectl --kubeconfig kubeconfig/dev.yaml apply -f manifests/hpa/httpbin-hpa.yaml
kubectl --kubeconfig kubeconfig/dev.yaml apply -f manifests/hpa/redis-hpa.yaml
kubectl --kubeconfig kubeconfig/dev.yaml apply -f manifests/hpa/postgres-hpa.yaml
kubectl --kubeconfig kubeconfig/dev.yaml apply -f manifests/hpa/rabbitmq-hpa.yaml
```

**PDB 적용**:

```bash
kubectl --kubeconfig kubeconfig/dev.yaml apply -f manifests/hpa/pdb-nginx.yaml
kubectl --kubeconfig kubeconfig/dev.yaml apply -f manifests/hpa/pdb-httpbin.yaml
kubectl --kubeconfig kubeconfig/dev.yaml apply -f manifests/hpa/pdb-redis.yaml
kubectl --kubeconfig kubeconfig/dev.yaml apply -f manifests/hpa/pdb-postgres.yaml
kubectl --kubeconfig kubeconfig/dev.yaml apply -f manifests/hpa/pdb-rabbitmq.yaml
kubectl --kubeconfig kubeconfig/dev.yaml apply -f manifests/hpa/pdb-keycloak.yaml
```

**PDB(PodDisruptionBudget)의 역할**: 노드 드레인이나 롤링 업데이트 시 최소 가용 Pod 수를 보장한다. 예를 들어, `minAvailable: 1`로 설정하면 항상 최소 1개의 Pod이 Running 상태를 유지한다.

### HPA 동작 확인

```bash
kubectl --kubeconfig kubeconfig/dev.yaml -n demo get hpa
```

예상 출력:
```
NAME       REFERENCE             TARGETS         MINPODS   MAXPODS   REPLICAS   AGE
nginx      Deployment/nginx-web  <unknown>/80%   1         5         1          30s
httpbin    Deployment/httpbin    <unknown>/80%   1         5         1          30s
...
```

`TARGETS`가 `<unknown>/80%`인 것은 metrics-server가 아직 메트릭을 수집하지 않았기 때문이다. 1~2분 후 `cpu/80%` 형태로 실제 수치가 표시된다.

### 부하 테스트로 HPA 트리거

```bash
# k6 부하 테스트 실행
kubectl --kubeconfig kubeconfig/dev.yaml apply -f manifests/demo/k6-loadtest.yaml

# HPA 변화 실시간 관찰
kubectl --kubeconfig kubeconfig/dev.yaml -n demo get hpa -w
```

CPU 사용률이 80%를 초과하면 HPA가 자동으로 Pod 수를 늘린다.

### 문제 발생 시 확인 사항

- `TARGETS`가 계속 `<unknown>`: metrics-server가 동작하지 않는 것이다.

```bash
kubectl --kubeconfig kubeconfig/dev.yaml -n kube-system get pods -l app.kubernetes.io/name=metrics-server
kubectl --kubeconfig kubeconfig/dev.yaml -n kube-system logs -l app.kubernetes.io/name=metrics-server
```

- 데모 앱이 Pending: 노드 리소스 부족. `kubectl describe pod`에서 Events를 확인한다.

---

## Phase 12: 서비스 메시 (12-install-istio.sh)

### 이 단계가 하는 일

dev 클러스터에 Istio 서비스 메시를 설치한다. mTLS를 활성화하고, Canary 배포(80/20 트래픽 분할)와 Circuit Breaker를 구성한다.

### 왜 이 순서인가

Phase 11에서 데모 앱이 배포되어 있다. Istio를 설치하고 demo 네임스페이스에 사이드카 주입을 활성화한 후, 기존 Pod을 재시작하여 Envoy 사이드카를 주입한다. Istio가 마지막 단계인 이유는, 서비스 메시가 기존 네트워크 구성(Cilium, NetworkPolicy) 위에 추가되는 레이어이기 때문이다.

### 핵심 명령어

**Istio 설치 (3단계)**:

```bash
helm repo add istio https://istio-release.storage.googleapis.com/charts
helm repo update

# 1. Istio Base CRDs
kubectl --kubeconfig kubeconfig/dev.yaml create namespace istio-system
helm upgrade --install istio-base istio/base \
  --kubeconfig kubeconfig/dev.yaml \
  --namespace istio-system \
  --set defaultRevision=default \
  --wait --timeout 5m

# 2. istiod (control plane)
helm upgrade --install istiod istio/istiod \
  --kubeconfig kubeconfig/dev.yaml \
  --namespace istio-system \
  --values manifests/istio/istio-values.yaml \
  --wait --timeout 10m

# 3. Istio Ingress Gateway
kubectl --kubeconfig kubeconfig/dev.yaml create namespace istio-ingress
helm upgrade --install istio-ingressgateway istio/gateway \
  --kubeconfig kubeconfig/dev.yaml \
  --namespace istio-ingress \
  --set service.type=NodePort \
  --wait --timeout 5m
```

**사이드카 주입 활성화**:

```bash
# demo 네임스페이스에 istio-injection 레이블 추가
kubectl --kubeconfig kubeconfig/dev.yaml label namespace demo istio-injection=enabled --overwrite

# 기존 Pod 재시작 (사이드카 주입을 위해)
kubectl --kubeconfig kubeconfig/dev.yaml rollout restart deployment -n demo
```

재시작 후 각 Pod이 `2/2` (앱 컨테이너 + Envoy 사이드카) 상태가 된다.

**Canary 배포용 httpbin-v2 배포**:

```bash
kubectl --kubeconfig kubeconfig/dev.yaml apply -f manifests/istio/httpbin-v2.yaml
```

**Istio 정책 적용**:

```bash
# STRICT mTLS: 모든 Pod 간 통신을 mTLS로 암호화
kubectl --kubeconfig kubeconfig/dev.yaml apply -f manifests/istio/peer-authentication.yaml

# VirtualService: httpbin 트래픽을 v1(80%) / v2(20%)로 분할
kubectl --kubeconfig kubeconfig/dev.yaml apply -f manifests/istio/virtual-service.yaml

# DestinationRule: Circuit Breaker 설정 (연속 5xx 에러 시 호스트 제외)
kubectl --kubeconfig kubeconfig/dev.yaml apply -f manifests/istio/destination-rule.yaml

# Gateway: Istio Ingress Gateway 구성
kubectl --kubeconfig kubeconfig/dev.yaml apply -f manifests/istio/istio-gateway.yaml

# NetworkPolicy 업데이트: Istio 사이드카 포트 허용
kubectl --kubeconfig kubeconfig/dev.yaml apply -f manifests/network-policies/allow-istio-sidecars.yaml
```

### 예상 출력

```
========== Phase 12: Installing Istio Service Mesh on 'dev' ==========

[INFO] Installing Istio base (CRDs)...
[INFO] Installing istiod...
[INFO] Installing Istio Ingress Gateway...
[INFO] Enabling sidecar injection on demo namespace...
[INFO] Restarting demo pods for sidecar injection...
[INFO] Deploying httpbin-v2 for canary demo...
[INFO] Applying PeerAuthentication (STRICT mTLS)...
[INFO] Applying VirtualService (canary 80/20)...
[INFO] Applying DestinationRule (circuit breaker)...
[INFO] Applying Gateway...
[INFO] Istio installed on 'dev' cluster.
[INFO] Istio mesh status:
NAME                      READY   STATUS    RESTARTS   AGE
istiod-xxx-xxx            1/1     Running   0          2m
```

### mTLS 검증

```bash
kubectl --kubeconfig kubeconfig/dev.yaml -n demo exec deploy/nginx-web -c nginx -- \
  curl -s http://httpbin/get
```

요청이 성공하면 mTLS가 투명하게 동작하고 있는 것이다. Envoy 사이드카가 양쪽에서 TLS를 처리한다.

### Canary 트래픽 분할 검증

```bash
for i in $(seq 1 10); do
  kubectl --kubeconfig kubeconfig/dev.yaml -n demo exec deploy/nginx-web -c nginx -- \
    curl -s http://httpbin/get | head -1
done
```

10번 요청 중 약 8번은 v1, 약 2번은 v2로 라우팅된다. 정확히 8:2는 아니고, 통계적으로 근사한다.

### 문제 발생 시 확인 사항

- istiod가 CrashLoopBackOff: 메모리 부족. dev-worker1에 8GB가 할당되어 있으므로 앱이 많으면 부족할 수 있다.

```bash
kubectl --kubeconfig kubeconfig/dev.yaml -n istio-system logs deploy/istiod
```

- 사이드카가 주입되지 않음 (READY가 1/1인 경우): 네임스페이스 레이블 확인.

```bash
kubectl --kubeconfig kubeconfig/dev.yaml get namespace demo --show-labels
# istio-injection=enabled 이 있어야 한다
```

레이블이 있는데도 주입되지 않으면, Pod을 삭제하여 재생성한다:

```bash
kubectl --kubeconfig kubeconfig/dev.yaml -n demo delete pods --all
```

---

## Phase 13: Sealed Secrets (13-install-sealed-secrets.sh)

### 이 단계가 하는 일

platform 클러스터에 Sealed Secrets 컨트롤러를 설치하고, dev 클러스터에 데모용 Secret과 RBAC을 생성한다.

### 왜 이 순서인가

데모 앱(Phase 11)과 서비스 메시(Phase 12)가 동작한 후, 시크릿을 안전하게 관리할 수 있는 인프라를 구성한다. 이 컨트롤러가 있어야 SealedSecret 오브젝트를 Git에 저장하고 클러스터에서 복호화할 수 있다.

### 핵심 명령어

```bash
helm repo add sealed-secrets https://bitnami-labs.github.io/sealed-secrets

# Sealed Secrets 컨트롤러 설치 (platform 클러스터)
kubectl --kubeconfig kubeconfig/platform.yaml create namespace sealed-secrets
helm upgrade --install sealed-secrets sealed-secrets/sealed-secrets \
  --kubeconfig kubeconfig/platform.yaml \
  --namespace sealed-secrets \
  --set fullnameOverride=sealed-secrets-controller \
  --wait --timeout 5m

# 데모 시크릿 적용 (dev 클러스터)
kubectl --kubeconfig kubeconfig/dev.yaml apply -f manifests/sealed-secrets/demo-db-secret.yaml
kubectl --kubeconfig kubeconfig/dev.yaml apply -f manifests/sealed-secrets/demo-api-secret.yaml
kubectl --kubeconfig kubeconfig/dev.yaml apply -f manifests/sealed-secrets/secret-reader-rbac.yaml
```

### 예상 출력

```
========== Phase 13: Installing Sealed Secrets on 'platform' ==========

[INFO] Installing Sealed Secrets controller...
[INFO] Waiting for Sealed Secrets controller...
[INFO] Creating demo secrets on 'dev' cluster...
[INFO] Applying example secret manifests...
[INFO] Applying secret access RBAC...
[INFO] Sealed Secrets controller status:
NAME                                         READY   STATUS    RESTARTS   AGE
sealed-secrets-controller-xxx-xxx            1/1     Running   0          1m
[INFO] Phase 13 complete.
```

### 문제 발생 시 확인 사항

- 컨트롤러 로그 확인:

```bash
kubectl --kubeconfig kubeconfig/platform.yaml -n sealed-secrets logs deploy/sealed-secrets-controller
```

---

## Phase 14: RBAC + OPA Gatekeeper (14-install-rbac-gatekeeper.sh)

### 이 단계가 하는 일

1. **RBAC**: 모든 클러스터에 커스텀 역할(namespace-admin, cluster-readonly, developer-rolebinding) 적용
2. **OPA Gatekeeper**: dev 클러스터에 정책 엔진 설치 + 4개 ConstraintTemplate + 4개 Constraint 적용

### 왜 이 순서인가

시크릿 관리(Phase 13) 후에 접근 제어를 강화한다. RBAC으로 "누가 무엇을 할 수 있는지"를 정의하고, Gatekeeper로 "무엇이 생성될 수 있는지"를 강제한다.

### 핵심 명령어

```bash
# RBAC 적용 (모든 클러스터)
for cluster in platform dev staging prod; do
  kubectl --kubeconfig kubeconfig/${cluster}.yaml apply -f manifests/rbac/
done

# OPA Gatekeeper 설치 (dev 클러스터)
helm repo add gatekeeper https://open-policy-agent.github.io/gatekeeper/charts
helm upgrade --install gatekeeper gatekeeper/gatekeeper \
  --kubeconfig kubeconfig/dev.yaml \
  --namespace gatekeeper-system --create-namespace \
  --set replicas=1 --set audit.replicas=1 \
  --wait --timeout 5m

# ConstraintTemplate + Constraint 적용
kubectl --kubeconfig kubeconfig/dev.yaml apply -f manifests/gatekeeper/constraint-templates/
kubectl --kubeconfig kubeconfig/dev.yaml apply -f manifests/gatekeeper/constraints/
```

### 예상 출력

```
========== Phase 14: Installing RBAC & OPA Gatekeeper ==========

[INFO] Applying RBAC manifests on 'platform'...
[INFO] Applying RBAC manifests on 'dev'...
[INFO] Applying RBAC manifests on 'staging'...
[INFO] Applying RBAC manifests on 'prod'...
[INFO] Installing OPA Gatekeeper on 'dev'...
[INFO] Waiting for Gatekeeper webhook...
[INFO] Applying ConstraintTemplates...
[INFO] Applying Constraints...
[INFO] Phase 14 complete.
```

### OPA Gatekeeper 정책

| Constraint | 동작 | 설명 |
|---|---|---|
| `require-app-label` | warn | Deployment에 `app` 라벨 필수 |
| `container-must-have-limits` | warn | 컨테이너에 CPU/메모리 limits 필수 |
| `block-nodeport-services` | warn | NodePort 서비스 제한 |
| `disallow-privileged-containers` | deny | 특권 컨테이너 차단 |

### 문제 발생 시 확인 사항

- Gatekeeper webhook이 타임아웃: Pod가 Ready 상태인지 확인

```bash
kubectl --kubeconfig kubeconfig/dev.yaml -n gatekeeper-system get pods
kubectl --kubeconfig kubeconfig/dev.yaml -n gatekeeper-system logs deploy/gatekeeper-controller-manager
```

---

## Phase 15: etcd 백업 + Velero (15-install-backup.sh)

### 이 단계가 하는 일

1. **Velero**: platform 클러스터에 K8s 리소스 백업 도구 설치
2. **etcd 백업**: 모든 마스터 노드에 etcd 스냅샷 스크립트 + cron job 설정
3. **초기 백업**: 각 마스터에서 첫 etcd 스냅샷 실행

### 왜 이 순서인가

모든 컴포넌트(Phase 1~14)가 설치된 후, 이 완성된 상태를 백업한다. 백업 대상이 존재해야 의미 있는 스냅샷이 생성된다.

### 핵심 명령어

```bash
# Velero 설치 (platform 클러스터)
helm repo add vmware-tanzu https://vmware-tanzu.github.io/helm-charts
helm upgrade --install velero vmware-tanzu/velero \
  --kubeconfig kubeconfig/platform.yaml \
  --namespace velero --create-namespace \
  --values manifests/velero-values.yaml \
  --wait --timeout 5m

# etcd 백업 스크립트 배포 (모든 마스터)
# → /opt/etcd-backup/backup.sh 생성
# → cron: 매일 02:00 자동 실행

# Velero Schedule 적용
kubectl --kubeconfig kubeconfig/platform.yaml apply -f manifests/backup/velero-schedule.yaml
```

### 예상 출력

```
========== Phase 15: Setting up etcd Backup & Disaster Recovery ==========

[INFO] Installing Velero on 'platform' (local backup provider)...
[INFO] Velero installed on 'platform'.
[INFO] Setting up etcd backup script on platform-master (192.168.64.x)...
[INFO] Running initial etcd backup on platform-master...
+----------+----------+------------+------------+
|   HASH   | REVISION |    TOTAL KEYS    | TOTAL SIZE |
+----------+----------+------------+------------+
| abcd1234 |   12345  |        850       |   3.2 MB   |
+----------+----------+------------+------------+
Backup completed: /opt/etcd-backup/etcd-snapshot-20260320-xxx.db
[INFO] etcd backup configured on platform-master
...
[INFO] Phase 15 complete.
```

### 문제 발생 시 확인 사항

- etcdctl이 설치되어 있지 않으면 초기 백업이 실패할 수 있다 (경고만 출력되고 cron은 정상 설정됨)
- Velero MinIO가 시작되지 않으면 메모리 확인: platform-worker1에 12GB 할당 필요

---

## Phase 16: ResourceQuota + LimitRange (16-install-resource-quotas.sh)

### 이 단계가 하는 일

dev, staging, prod 클러스터의 demo 네임스페이스에 ResourceQuota와 LimitRange를 적용한다.

### 왜 이 순서인가

모든 앱과 보안 정책이 설치된 후, 리소스 사용량을 제한한다. OPA Gatekeeper(Phase 14)가 "리소스 제한을 설정하라"고 강제하고, 이 Phase에서 실제 기본값과 상한을 적용한다.

### 핵심 명령어

```bash
# 각 클러스터별 LimitRange + ResourceQuota 적용
for cluster in dev staging prod; do
  kubectl --kubeconfig kubeconfig/${cluster}.yaml apply -f manifests/resource-quotas/limitrange-${cluster}.yaml
  kubectl --kubeconfig kubeconfig/${cluster}.yaml apply -f manifests/resource-quotas/quota-${cluster}.yaml
done
```

### 환경별 차이

| 항목 | dev | staging | prod |
|------|-----|---------|------|
| 성격 | 넉넉한 실험 환경 | 보수적 검증 | 대용량 통제 |
| 최대 Pod 수 | 30 | 20 | 50 |
| 최대 CPU (총합) | 8 cores | 4 cores | 12 cores |
| 최대 메모리 (총합) | 16Gi | 8Gi | 24Gi |
| 컨테이너 기본 CPU | 500m | 300m | 500m |
| 컨테이너 최소 CPU | 50m | 50m | 100m |

### 예상 출력

```
========== Phase 16: Installing Resource Quotas & LimitRange ==========

[INFO] Applying ResourceQuota and LimitRange on 'dev' cluster...
[INFO] Verifying on 'dev':
NAME         AGE   REQUEST                                      LIMIT
demo-quota   1s    requests.cpu: 1200m/4, requests.memory: ...  limits.cpu: 4500m/8, ...
[INFO] Applying ResourceQuota and LimitRange on 'staging' cluster...
[INFO] Applying ResourceQuota and LimitRange on 'prod' cluster...
[INFO] Phase 16 complete.
```

---

## Phase 17: Harbor 레지스트리 (17-install-harbor.sh)

### 이 단계가 하는 일

platform 클러스터에 Harbor 프라이빗 컨테이너 이미지 레지스트리를 설치하고, 모든 노드의 containerd를 Harbor를 trust하도록 설정한다.

### 왜 이 순서인가

17단계의 마지막 Phase이다. 프라이빗 레지스트리는 모든 인프라가 완성된 후, 운영 환경에서 이미지를 자체 관리하기 위해 설치한다. containerd 설정 변경 시 재시작이 필요하므로 모든 앱 배포가 완료된 후에 적용한다.

### 핵심 명령어

```bash
# Harbor 설치 (platform 클러스터)
helm repo add harbor https://helm.goharbor.io
kubectl --kubeconfig kubeconfig/platform.yaml create namespace harbor
helm upgrade --install harbor harbor/harbor \
  --kubeconfig kubeconfig/platform.yaml \
  --namespace harbor \
  --values manifests/harbor-values.yaml \
  --wait --timeout 10m

# 모든 노드에 Harbor 인증 설정
# → /etc/containerd/certs.d/<ip>:30500/hosts.toml 생성
# → containerd 재시작
```

### 예상 출력

```
========== Phase 17: Installing Harbor Private Registry on 'platform' ==========

[INFO] Installing Harbor registry...
[INFO] Waiting for Harbor components...
[INFO] Configuring containerd to trust Harbor registry on all nodes...
  Configuring platform-master (192.168.64.x)...
  Configuring platform-worker1 (192.168.64.x)...
  ...
[INFO] Harbor status:
NAME                       READY   STATUS    RESTARTS   AGE
harbor-core-xxx            1/1     Running   0          3m
harbor-registry-xxx        1/1     Running   0          3m
harbor-portal-xxx          1/1     Running   0          3m
[INFO] Harbor Registry:
[INFO]   URL:       http://192.168.64.x:30500
[INFO]   Portal:    http://192.168.64.x:30400
[INFO]   인증:      admin / Harbor12345
[INFO] Phase 17 complete.
```

### 문제 발생 시 확인 사항

- Harbor Pod가 Pending: PV가 없으면 dynamic provisioning이 필요. 로컬 환경에서는 hostPath를 사용한다.
- containerd 재시작 후 기존 Pod 영향: Static Pod(etcd, apiserver 등)는 자동 복구된다. 일반 Pod는 이미 실행 중이므로 영향 없다.

```bash
kubectl --kubeconfig kubeconfig/platform.yaml -n harbor get pods
kubectl --kubeconfig kubeconfig/platform.yaml -n harbor logs deploy/harbor-core
```

- NetworkPolicy가 Istio 트래픽을 차단: Phase 12 마지막에 `allow-istio-sidecars.yaml`을 적용한다. 이 정책이 누락되면 Envoy 프록시 간 통신(포트 15001, 15006 등)이 차단된다.

---

## 전체 파이프라인 요약

| 단계 | 스크립트 | 대상 클러스터 | 소요 시간 | 의존성 |
|------|---------|-------------|----------|--------|
| 1 | 01-create-vms.sh | 전체 | 5~10분 | 없음 |
| 2 | 02-prepare-nodes.sh | 전체 | 5분 | Phase 1 |
| 3 | 03-install-runtime.sh | 전체 | 10분 | Phase 2 |
| 4 | 04-install-kubeadm.sh | 전체 | 10분 | Phase 3 |
| 5 | 05-init-clusters.sh | 전체 | 5분 | Phase 4 |
| 6 | 06-install-cilium.sh | 전체 | 5분 | Phase 5 |
| 7 | 07-install-monitoring.sh | platform | 5분 | Phase 6 |
| 8 | 08-install-cicd.sh | platform | 5~10분 | Phase 6 |
| 9 | 09-install-alerting.sh | platform | 2분 | Phase 7 |
| 10 | 10-install-network-policies.sh | dev | 1분 | Phase 6 |
| 11 | 11-install-hpa.sh | dev, staging | 3분 | Phase 6 |
| 12 | 12-install-istio.sh | dev | 5분 | Phase 11 |

> **참고**: Phase 7~12는 Phase 6(Cilium) 이후에 실행되어야 하지만, 서로 간에는 일부 병렬 실행이 가능하다. 다만 install.sh는 안정성을 위해 순차 실행한다.

---

다음 장: [04. 일상 운영](04-daily-operations.md)
