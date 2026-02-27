#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/k8s.sh"

log_section "Phase 6: Installing Cilium + Hubble"

for cluster_name in $(get_cluster_names); do
  install_cilium "$cluster_name"
  install_hubble "$cluster_name"
done

for cluster_name in $(get_cluster_names); do
  wait_nodes_ready "$cluster_name"
done

log_info "Cilium + Hubble installed on all clusters."
