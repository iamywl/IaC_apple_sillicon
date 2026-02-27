#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/k8s.sh"

log_section "Phase 4: Installing kubeadm, kubelet, kubectl"

for cluster_name in $(get_cluster_names); do
  for node_name in $(get_nodes_for_cluster "$cluster_name"); do
    install_kubeadm "$node_name"
  done
done

log_info "kubeadm installed on all nodes."
