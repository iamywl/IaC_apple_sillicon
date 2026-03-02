#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/k8s.sh"

DASHBOARD_PORT=3000

log_section "Full Project Shutdown"

# 1. Stop SRE Dashboard
log_section "Stopping SRE Dashboard (port $DASHBOARD_PORT)"
dashboard_pid=$(lsof -t -i:"$DASHBOARD_PORT" 2>/dev/null || true)
if [[ -n "$dashboard_pid" ]]; then
  log_info "Dashboard process found (PID: $dashboard_pid). Stopping..."
  kill "$dashboard_pid" 2>/dev/null || true
  sleep 1
  # Force kill if still alive
  if kill -0 "$dashboard_pid" 2>/dev/null; then
    log_warn "Process did not exit gracefully. Force killing..."
    kill -9 "$dashboard_pid" 2>/dev/null || true
  fi
  log_info "Dashboard stopped."
else
  log_info "Dashboard is not running. Skipping."
fi

# 2. Drain worker nodes
log_section "Draining Kubernetes Workers"
for cluster_name in $(get_cluster_names); do
  log_info "Draining workers in cluster '$cluster_name'..."
  for worker_name in $(get_workers_for_cluster "$cluster_name"); do
    kubectl_cmd "$cluster_name" drain "$worker_name" \
      --ignore-daemonsets --delete-emptydir-data --force --timeout=60s 2>/dev/null || \
      log_warn "Failed to drain $worker_name (may already be drained)"
  done
done

# 3. Stop all VMs
log_section "Stopping All Tart VMs"
vm_stop_all

# Summary
log_section "Shutdown Complete"
log_info "Dashboard .... stopped"
log_info "K8s workers .. drained"
log_info "Tart VMs ..... stopped"
log_info ""
log_info "Safe to shut down your Mac."
