#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/k8s.sh"

log_section "Phase 3: Installing Container Runtime (containerd)"

for cluster_name in $(get_cluster_names); do
  for node_name in $(get_nodes_for_cluster "$cluster_name"); do
    install_containerd "$node_name"
  done
done

log_info "containerd installed on all nodes."
