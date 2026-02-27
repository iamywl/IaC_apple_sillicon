#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/k8s.sh"

log_section "Graceful Shutdown"

# Drain worker nodes
for cluster_name in $(get_cluster_names); do
  log_info "Draining workers in cluster '$cluster_name'..."
  for worker_name in $(get_workers_for_cluster "$cluster_name"); do
    kubectl_cmd "$cluster_name" drain "$worker_name" \
      --ignore-daemonsets --delete-emptydir-data --force --timeout=60s 2>/dev/null || \
      log_warn "Failed to drain $worker_name (may already be drained)"
  done
done

# Stop all VMs
log_section "Stopping all VMs"
vm_stop_all

log_info "All VMs stopped. Safe to shut down your Mac."
