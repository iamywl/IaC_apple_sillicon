# 03. Kubernetes 클러스터 구성 - 12단계 설치

## 설치 흐름 개요

`scripts/install.sh`가 12단계를 순서대로 실행합니다.

```
Phase 1  → VM 생성 (clone + 리소스 할당)
Phase 2  → 노드 준비 (swap off, 커널 모듈, sysctl)
Phase 3  → containerd 런타임 설치
Phase 4  → kubeadm/kubelet/kubectl 설치
Phase 5  → K8s 클러스터 초기화 (kubeadm init + worker join)
Phase 6  → Cilium CNI + Hubble (모든 클러스터)
Phase 7  → Prometheus + Grafana + Loki (platform만)
Phase 8  → Jenkins + ArgoCD (platform만)
Phase 9  → AlertManager + 알림 규칙 (platform만)
Phase 10 → CiliumNetworkPolicy L7 (dev만)
Phase 11 → metrics-server + HPA (dev + staging)
Phase 12 → Istio 서비스 메시 (dev만)
```

골든 이미지 사용 시: 15~20분 / 없을 시: 45~60분

## Phase 1: VM 생성 (scripts/install/01-create-vms.sh)

```bash
# clusters.json에서 모든 노드를 읽어서 처리
for node in $(get_all_nodes); do
    cpu=$(get_node_cpu "$node")
    memory=$(get_node_memory "$node")

    tart clone "$BASE_IMAGE" "$node"       # 베이스 이미지 복제
    tart set "$node" --cpu "$cpu" --memory "$memory"  # 리소스 설정
    tart run "$node" --net-softnet-allow=0.0.0.0/0 --no-display &  # 백그라운드 실행
done

# 모든 VM의 IP가 할당될 때까지 대기
for node in $(get_all_nodes); do
    vm_wait_for_ip "$node"   # 최대 180초 (3초 × 60회 폴링)
done
```

## Phase 2: 노드 준비 (scripts/install/02-prepare-nodes.sh)

K8s가 동작하려면 리눅스 커널 설정이 필요합니다.

```bash
prepare_node() {
    local ip=$1 hostname=$2

    ssh_exec_sudo "$ip" "
        # 1. swap 비활성화 (kubelet 요구사항)
        swapoff -a
        sed -i '/swap/d' /etc/fstab

        # 2. 커널 모듈 로드
        modprobe overlay         # 컨테이너 파일시스템
        modprobe br_netfilter    # 브릿지 네트워크 필터링

        # 3. sysctl 파라미터 설정
        cat > /etc/sysctl.d/k8s.conf <<EOF
net.bridge.bridge-nf-call-iptables = 1   # 브릿지 트래픽에 iptables 적용
net.bridge.bridge-nf-call-ip6tables = 1  # IPv6도 동일
net.ipv4.ip_forward = 1                  # IP 포워딩 활성화
EOF
        sysctl --system

        # 4. 호스트명 설정
        hostnamectl set-hostname $hostname
    "
}
```

**왜 이 설정이 필요한가?**
- `swap off`: kubelet이 메모리 관리를 위해 swap을 사용하지 않아야 합니다
- `overlay`: 컨테이너 이미지의 레이어드 파일시스템을 지원합니다
- `br_netfilter`: Pod 간 통신에서 iptables 규칙이 적용되게 합니다
- `ip_forward`: Pod 네트워크에서 다른 노드로 패킷을 전달합니다

## Phase 3: containerd 설치 (scripts/install/03-install-runtime.sh)

```bash
install_containerd() {
    local ip=$1
    ssh_exec_sudo "$ip" "
        apt-get update
        apt-get install -y containerd

        # SystemdCgroup 드라이버 설정 (K8s 표준)
        mkdir -p /etc/containerd
        containerd config default > /etc/containerd/config.toml
        sed -i 's/SystemdCgroup = false/SystemdCgroup = true/' /etc/containerd/config.toml

        systemctl restart containerd
        systemctl enable containerd
    "
}
```

**왜 SystemdCgroup인가?**
kubelet은 기본적으로 systemd cgroup 드라이버를 사용합니다.
containerd도 동일하게 맞춰야 리소스 관리가 일관됩니다.

## Phase 4: kubeadm 설치 (scripts/install/04-install-kubeadm.sh)

```bash
install_kubeadm() {
    local ip=$1
    ssh_exec_sudo "$ip" "
        # Kubernetes apt 저장소 추가 (v1.31)
        curl -fsSL https://pkgs.k8s.io/core:/stable:/v1.31/deb/Release.key | gpg --dearmor -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg
        echo 'deb [signed-by=...] https://pkgs.k8s.io/core:/stable:/v1.31/deb/ /' > /etc/apt/sources.list.d/kubernetes.list

        apt-get update
        apt-get install -y kubelet kubeadm kubectl

        # 버전 고정 (자동 업그레이드 방지)
        apt-mark hold kubelet kubeadm kubectl
    "
}
```

## Phase 5: 클러스터 초기화 (scripts/install/05-init-clusters.sh)

가장 핵심적인 단계입니다.

```bash
init_cluster() {
    local cluster=$1
    local master_ip=$(get_master_ip "$cluster")
    local pod_cidr=$(get_pod_cidr "$cluster")
    local service_cidr=$(get_service_cidr "$cluster")

    # 1. master 노드에서 kubeadm init
    ssh_exec_sudo "$master_ip" "
        kubeadm init \
            --pod-network-cidr=$pod_cidr \
            --service-cidr=$service_cidr \
            --skip-phases=addon/kube-proxy   # ← Cilium이 kube-proxy를 대체
    "

    # 2. kubeconfig 복사 (master → 호스트)
    scp_from "$master_ip" "/etc/kubernetes/admin.conf" "kubeconfig/${cluster}.yaml"

    # 3. worker 노드를 클러스터에 join
    local join_cmd=$(ssh_exec "$master_ip" "kubeadm token create --print-join-command")
    for worker_ip in $(get_worker_ips "$cluster"); do
        ssh_exec_sudo "$worker_ip" "$join_cmd"
    done
}
```

**핵심 포인트**:
- `--skip-phases=addon/kube-proxy`: Cilium eBPF가 kube-proxy를 완전 대체하므로 설치하지 않습니다
- 각 클러스터마다 고유한 Pod CIDR과 Service CIDR을 사용합니다 (충돌 방지)
- kubeconfig를 호스트로 복사하여 `kubectl`과 대시보드에서 사용합니다

### 클러스터별 CIDR 설정

| 클러스터 | Pod CIDR | Service CIDR |
|----------|----------|-------------|
| platform | 10.10.0.0/16 | 10.110.0.0/16 |
| dev | 10.20.0.0/16 | 10.120.0.0/16 |
| staging | 10.30.0.0/16 | 10.130.0.0/16 |
| prod | 10.40.0.0/16 | 10.140.0.0/16 |

## Phase 6: Cilium CNI 설치 (scripts/install/06-install-cilium.sh)

```bash
install_cilium() {
    local cluster=$1 kubeconfig="kubeconfig/${cluster}.yaml"

    helm repo add cilium https://helm.cilium.io/

    helm install cilium cilium/cilium \
        --kubeconfig "$kubeconfig" \
        --namespace kube-system \
        --values manifests/cilium-values.yaml \
        --set ipam.operator.clusterPoolIPv4PodCIDRList=$(get_pod_cidr "$cluster")
}

install_hubble() {
    helm upgrade cilium cilium/cilium \
        --kubeconfig "$kubeconfig" \
        --namespace kube-system \
        --values manifests/hubble-values.yaml
}
```

## Phase 7-9: 모니터링 + CI/CD (platform 클러스터만)

```bash
# Phase 7: Prometheus + Grafana + Loki
helm install prometheus prometheus-community/kube-prometheus-stack \
    --values manifests/monitoring-values.yaml

helm install loki grafana/loki-stack \
    --values manifests/loki-values.yaml

# Phase 8: Jenkins + ArgoCD
helm install argocd argo/argo-cd --values manifests/argocd-values.yaml
helm install jenkins jenkins/jenkins --values manifests/jenkins-values.yaml

# Phase 9: 알림 규칙
kubectl apply -f manifests/alerting/prometheus-rules.yaml
kubectl apply -f manifests/alerting/webhook-logger.yaml
```

## Phase 10-12: dev 클러스터 전용 설정

```bash
# Phase 10: 네트워크 정책 (Zero-Trust)
kubectl apply -f manifests/network-policies/  # 모든 정책 파일 적용

# Phase 11: HPA (오토스케일링)
helm install metrics-server metrics-server/metrics-server
kubectl apply -f manifests/hpa/

# Phase 12: Istio 서비스 메시
helm install istio-base istio/base
helm install istiod istio/istiod
helm install istio-ingressgateway istio/gateway
kubectl label namespace demo istio-injection=enabled  # 사이드카 자동 주입
kubectl apply -f manifests/istio/
```

## 일상 운영 스크립트

### boot.sh - 매일 아침 실행

```bash
# 1단계: 모든 VM 시작
./scripts/boot/01-start-vms.sh
# 2단계: SSH 접속 가능할 때까지 대기
./scripts/boot/02-wait-clusters.sh
# 3단계: 서비스 상태 확인
./scripts/boot/03-verify-services.sh
```

### shutdown.sh - 매일 저녁 실행

```bash
# 1. worker 노드 drain (Pod를 다른 노드로 이동)
kubectl drain <worker> --ignore-daemonsets --delete-emptydir-data
# 2. VM 종료
tart stop <vm-name>
```

### status.sh - 상태 확인

```bash
# VM 상태 → 노드 상태 → Pod 상태 순서로 출력
tart list                    # VM 목록 + 상태
kubectl get nodes            # 각 클러스터 노드 상태
kubectl get pods -A          # 각 클러스터 Pod 상태
```

## 골든 이미지 (scripts/build-golden-image.sh)

설치 시간을 단축하기 위해, containerd + kubeadm + K8s 이미지가 미리 설치된 VM 이미지를 만듭니다.

```bash
# 1. 임시 VM 생성
tart clone "$BASE_IMAGE" golden-builder

# 2. Phase 2-4 실행 (노드 준비, containerd, kubeadm)
prepare_node "$ip"
install_containerd "$ip"
install_kubeadm "$ip"

# 3. K8s + Cilium 이미지 미리 다운로드
kubeadm config images pull
ctr images pull quay.io/cilium/...

# 4. 골든 이미지로 저장
tart stop golden-builder
# 이후 이 이미지를 BASE_IMAGE로 사용
```

효과: Phase 2-4를 건너뛸 수 있어 설치 시간이 45분 → 15분으로 단축됩니다.
