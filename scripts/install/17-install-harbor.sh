#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/k8s.sh"
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/vm.sh"
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/ssh.sh"

CLUSTER="platform"
log_section "Phase 17: Installing Harbor Private Registry on '$CLUSTER'"

helm repo add harbor https://helm.goharbor.io 2>/dev/null || true
helm repo update

# Create namespace
kubectl_cmd "$CLUSTER" create namespace harbor 2>/dev/null || true

# Install Harbor via Helm
log_info "Installing Harbor registry..."
helm upgrade --install harbor harbor/harbor \
  --kubeconfig "$(kubeconfig_for_cluster "$CLUSTER")" \
  --namespace harbor \
  --values "$PROJECT_ROOT/manifests/harbor-values.yaml" \
  --wait --timeout 10m

# Wait for Harbor core components
log_info "Waiting for Harbor components..."
for deploy in harbor-core harbor-registry harbor-portal; do
  kubectl_cmd "$CLUSTER" -n harbor rollout status deployment/$deploy --timeout=180s 2>/dev/null || true
done

WORKER_IP=$(vm_get_ip "platform-worker1")

# Configure containerd on all nodes to trust Harbor registry
log_info "Configuring containerd to trust Harbor registry on all nodes..."
for cluster_name in $(get_cluster_names); do
  for node_name in $(get_nodes_for_cluster "$cluster_name"); do
    node_ip=$(vm_get_ip "$node_name")
    log_info "  Configuring $node_name ($node_ip)..."

    # Add Harbor as insecure registry in containerd
    ssh_exec_sudo "$node_ip" "mkdir -p /etc/containerd/certs.d/${WORKER_IP}:30500"
    ssh_exec_sudo "$node_ip" "cat > /etc/containerd/certs.d/${WORKER_IP}:30500/hosts.toml << EOF
server = \"http://${WORKER_IP}:30500\"

[host.\"http://${WORKER_IP}:30500\"]
  capabilities = [\"pull\", \"resolve\", \"push\"]
  skip_verify = true
EOF"

    # Restart containerd to pick up config
    ssh_exec_sudo "$node_ip" "systemctl restart containerd" 2>/dev/null || true
  done
done

log_info "Harbor status:"
kubectl_cmd "$CLUSTER" -n harbor get pods

log_info ""
log_info "Harbor Registry:"
log_info "  URL:       http://${WORKER_IP}:30500"
log_info "  Portal:    http://${WORKER_IP}:30400"
log_info "  인증:      admin / Harbor12345"
log_info ""
log_info "Push an image:"
log_info "  docker tag nginx:latest ${WORKER_IP}:30500/library/nginx:latest"
log_info "  docker push ${WORKER_IP}:30500/library/nginx:latest"
log_info ""
log_info "Use in K8s:"
log_info "  image: ${WORKER_IP}:30500/library/nginx:latest"
log_info "Phase 17 complete."
