#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/k8s.sh"

log_section "Waiting for Kubernetes clusters to be ready"

for cluster_name in $(get_cluster_names); do
  log_info "Checking cluster: $cluster_name"

  master_name=$(get_master_for_cluster "$cluster_name")
  master_ip=$(vm_get_ip "$master_name")

  # Ensure kubelet is running on all nodes
  for node_name in $(get_nodes_for_cluster "$cluster_name"); do
    node_ip=$(vm_get_ip "$node_name")
    log_info "Restarting kubelet on $node_name..."
    ssh_exec_sudo "$node_ip" "systemctl restart kubelet" || true
  done

  # Update kubeconfig with new master IP (IP may change after reboot)
  log_info "Updating kubeconfig for $cluster_name (master IP: $master_ip)..."
  local_kubeconfig="$(kubeconfig_for_cluster "$cluster_name")"
  if [[ -f "$local_kubeconfig" ]]; then
    # Replace the server IP in kubeconfig
    sed -i '' "s|server: https://[0-9.]*:6443|server: https://${master_ip}:6443|" "$local_kubeconfig" 2>/dev/null || \
    sed -i "s|server: https://[0-9.]*:6443|server: https://${master_ip}:6443|" "$local_kubeconfig"
  else
    log_warn "Kubeconfig not found for $cluster_name, fetching from master..."
    scp_from "$master_ip" ".kube/config" "$local_kubeconfig"
  fi

  wait_nodes_ready "$cluster_name" 60
done

log_info "All clusters are ready."
