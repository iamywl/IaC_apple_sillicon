#!/usr/bin/env bash
# Kubernetes cluster management functions

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/vm.sh"
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/ssh.sh"

K8S_VERSION="1.31"

prepare_node() {
  local node_name="$1"
  local ip
  ip=$(vm_get_ip "$node_name")

  log_info "Preparing node '$node_name' ($ip)..."

  ssh_exec_sudo "$ip" "
    swapoff -a && sed -i '/swap/d' /etc/fstab

    cat > /etc/modules-load.d/k8s.conf <<MODEOF
overlay
br_netfilter
MODEOF
    modprobe overlay
    modprobe br_netfilter

    cat > /etc/sysctl.d/k8s.conf <<SYSEOF
net.bridge.bridge-nf-call-iptables  = 1
net.bridge.bridge-nf-call-ip6tables = 1
net.ipv4.ip_forward                 = 1
SYSEOF
    sysctl --system

    hostnamectl set-hostname '$node_name'
  "
}

install_containerd() {
  local node_name="$1"
  local ip
  ip=$(vm_get_ip "$node_name")

  log_info "Installing containerd on '$node_name'..."

  ssh_exec_sudo "$ip" "
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq containerd apt-transport-https ca-certificates curl gnupg conntrack

    mkdir -p /etc/containerd
    containerd config default > /etc/containerd/config.toml
    sed -i 's/SystemdCgroup = false/SystemdCgroup = true/' /etc/containerd/config.toml

    systemctl restart containerd
    systemctl enable containerd
  "
}

install_kubeadm() {
  local node_name="$1"
  local ip
  ip=$(vm_get_ip "$node_name")

  log_info "Installing kubeadm on '$node_name'..."

  ssh_exec_sudo "$ip" "
    curl -fsSL https://pkgs.k8s.io/core:/stable:/v${K8S_VERSION}/deb/Release.key | gpg --dearmor -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg 2>/dev/null
    echo 'deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/v${K8S_VERSION}/deb/ /' > /etc/apt/sources.list.d/kubernetes.list

    apt-get update -qq
    apt-get install -y -qq kubelet kubeadm kubectl
    apt-mark hold kubelet kubeadm kubectl

    systemctl enable kubelet
  "
}

init_cluster() {
  local cluster_name="$1"
  local master_name
  master_name=$(get_master_for_cluster "$cluster_name")
  local master_ip
  master_ip=$(vm_get_ip "$master_name")
  local pod_cidr
  pod_cidr=$(get_pod_cidr "$cluster_name")
  local service_cidr
  service_cidr=$(get_service_cidr "$cluster_name")

  log_section "Initializing cluster: $cluster_name"
  log_info "Master: $master_name ($master_ip)"

  # Clean any previous state
  ssh_exec_sudo "$master_ip" "
    kubeadm reset -f 2>/dev/null || true
    rm -rf /etc/kubernetes /var/lib/kubelet /var/lib/etcd /etc/cni/net.d
    iptables -F 2>/dev/null || true
    iptables -X 2>/dev/null || true
    iptables -t nat -F 2>/dev/null || true
    systemctl restart containerd
  "

  for worker_name in $(get_workers_for_cluster "$cluster_name"); do
    local wip
    wip=$(vm_get_ip "$worker_name")
    ssh_exec_sudo "$wip" "
      kubeadm reset -f 2>/dev/null || true
      rm -rf /etc/kubernetes /var/lib/kubelet /etc/cni/net.d
      iptables -F 2>/dev/null || true
      systemctl restart containerd
    "
  done

  ssh_exec_sudo "$master_ip" "
    kubeadm init \
      --pod-network-cidr='$pod_cidr' \
      --service-cidr='$service_cidr' \
      --skip-phases=addon/kube-proxy \
      --apiserver-advertise-address='$master_ip' \
      --node-name='$master_name'
  "

  ssh_exec "$master_ip" "mkdir -p \$HOME/.kube && sudo cp /etc/kubernetes/admin.conf \$HOME/.kube/config && sudo chown \$(id -u):\$(id -g) \$HOME/.kube/config"

  mkdir -p "$KUBECONFIG_DIR"
  scp_from "$master_ip" ".kube/config" "$(kubeconfig_for_cluster "$cluster_name")"

  local join_cmd
  join_cmd=$(ssh_exec_sudo "$master_ip" "kubeadm token create --print-join-command")

  for worker_name in $(get_workers_for_cluster "$cluster_name"); do
    local worker_ip
    worker_ip=$(vm_get_ip "$worker_name")
    log_info "Joining worker '$worker_name' ($worker_ip) to cluster '$cluster_name'..."
    ssh_exec_sudo "$worker_ip" "$join_cmd --node-name='$worker_name'"
  done
}

wait_nodes_ready() {
  local cluster_name="$1"
  local max_attempts="${2:-60}"

  log_info "Waiting for all nodes in '$cluster_name' to be Ready..."
  for ((i=1; i<=max_attempts; i++)); do
    local not_ready
    not_ready=$(kubectl_cmd "$cluster_name" get nodes --no-headers 2>/dev/null | grep -cv " Ready " || true)
    if [[ "$not_ready" -eq 0 ]]; then
      log_info "All nodes in '$cluster_name' are Ready."
      kubectl_cmd "$cluster_name" get nodes
      return 0
    fi
    sleep 5
  done
  log_warn "Some nodes in '$cluster_name' are not ready yet."
  kubectl_cmd "$cluster_name" get nodes
}

install_cilium() {
  local cluster_name="$1"
  local pod_cidr
  pod_cidr=$(get_pod_cidr "$cluster_name")
  local master_name
  master_name=$(get_master_for_cluster "$cluster_name")
  local master_ip
  master_ip=$(vm_get_ip "$master_name")

  log_info "Installing Cilium on '$cluster_name' (API: $master_ip)..."

  helm repo add cilium https://helm.cilium.io/ 2>/dev/null || true
  helm repo update

  helm upgrade --install cilium cilium/cilium \
    --kubeconfig "$(kubeconfig_for_cluster "$cluster_name")" \
    --namespace kube-system \
    --values "$PROJECT_ROOT/manifests/cilium-values.yaml" \
    --set ipam.operator.clusterPoolIPv4PodCIDRList="{$pod_cidr}" \
    --set cluster.name="$cluster_name" \
    --set k8sServiceHost="$master_ip" \
    --set k8sServicePort=6443 \
    --wait --timeout 10m
}

install_hubble() {
  local cluster_name="$1"

  log_info "Enabling Hubble on '$cluster_name'..."

  helm upgrade cilium cilium/cilium \
    --kubeconfig "$(kubeconfig_for_cluster "$cluster_name")" \
    --namespace kube-system \
    --reuse-values \
    --values "$PROJECT_ROOT/manifests/hubble-values.yaml" \
    --wait --timeout 10m
}
