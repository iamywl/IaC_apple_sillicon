#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"

log_section "Tart Multi-Cluster K8s Installation"
log_info "This will create 10 VMs and set up 4 Kubernetes clusters."

# Detect golden image usage
USE_GOLDEN=false
BASE_IMG="$(get_base_image)"
if [[ "$BASE_IMG" == "k8s-golden" ]]; then
  USE_GOLDEN=true
  log_info "Golden image detected → Phase 2~4 will be skipped"
  log_info "Estimated time: 15-20 minutes"
else
  log_info "Estimated time: 45-60 minutes"
fi
echo ""

check_dependencies

# Phase 1: Create VMs
bash "$SCRIPT_DIR/install/01-create-vms.sh"

# Start all VMs
source "$SCRIPT_DIR/lib/vm.sh"
vm_start_all

# Wait for SSH on all nodes
source "$SCRIPT_DIR/lib/ssh.sh"
log_section "Waiting for SSH access on all nodes"
for cluster_name in $(get_cluster_names); do
  for node_name in $(get_nodes_for_cluster "$cluster_name"); do
    ip=$(vm_get_ip "$node_name")
    ssh_wait_ready "$ip"
    log_info "$node_name ($ip) - SSH ready"
  done
done

# Phase 2-4: Prepare nodes, install runtime, install kubeadm
if [[ "$USE_GOLDEN" == true ]]; then
  log_section "Phase 2~4: Skipped (golden image)"
  # Golden image에서도 hostname만 설정해줘야 함
  log_info "Setting hostnames on golden image nodes..."
  for cluster_name in $(get_cluster_names); do
    for node_name in $(get_nodes_for_cluster "$cluster_name"); do
      ip=$(vm_get_ip "$node_name")
      ssh_exec_sudo "$ip" "hostnamectl set-hostname '$node_name'"
      log_info "  $node_name → hostname set"
    done
  done
else
  bash "$SCRIPT_DIR/install/02-prepare-nodes.sh"
  bash "$SCRIPT_DIR/install/03-install-runtime.sh"
  bash "$SCRIPT_DIR/install/04-install-kubeadm.sh"
fi

# Phase 5: Initialize clusters
bash "$SCRIPT_DIR/install/05-init-clusters.sh"

# Phase 6: Install Cilium + Hubble
bash "$SCRIPT_DIR/install/06-install-cilium.sh"

# Phase 7: Install monitoring
bash "$SCRIPT_DIR/install/07-install-monitoring.sh"

# Phase 8: Install CI/CD
bash "$SCRIPT_DIR/install/08-install-cicd.sh"

# Phase 9: AlertManager + Alert Rules
bash "$SCRIPT_DIR/install/09-install-alerting.sh"

# Phase 10: NetworkPolicy (Cilium)
bash "$SCRIPT_DIR/install/10-install-network-policies.sh"

# Phase 11: metrics-server + HPA
bash "$SCRIPT_DIR/install/11-install-hpa.sh"

# Phase 12: Istio Service Mesh (dev cluster)
bash "$SCRIPT_DIR/install/12-install-istio.sh"

# Summary
log_section "Installation Complete!"
log_info "Clusters:"
for cluster_name in $(get_cluster_names); do
  log_info "  $cluster_name: kubectl --kubeconfig kubeconfig/${cluster_name}.yaml get nodes"
done

PLATFORM_IP=$(vm_get_ip "platform-worker1" 2>/dev/null || echo "<platform-worker1-ip>")
echo ""
log_info "Access URLs:"
log_info "  Grafana:  http://${PLATFORM_IP}:30300  (admin/admin)"
log_info "  ArgoCD:   http://${PLATFORM_IP}:30800"
log_info "  Jenkins:  http://${PLATFORM_IP}:30900"
log_info "  Hubble:   cilium hubble ui (via port-forward)"
log_info "  AlertMgr: http://${PLATFORM_IP}:30903"
echo ""
log_info "To shut down: ./scripts/shutdown.sh"
log_info "To restart:   ./scripts/boot.sh"
