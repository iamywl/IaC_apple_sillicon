#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/k8s.sh"

log_section "Infrastructure Status"

# VM status
log_info "=== VM Status ==="
tart list | grep -E "^(Source|local)" || true
echo ""

# Cluster status
for cluster_name in $(get_cluster_names); do
  kubeconfig="$(kubeconfig_for_cluster "$cluster_name")"
  if [[ -f "$kubeconfig" ]]; then
    log_info "=== Cluster: $cluster_name ==="
    kubectl_cmd "$cluster_name" get nodes 2>/dev/null || log_warn "Cannot reach cluster $cluster_name"
    echo ""
  else
    log_warn "No kubeconfig for $cluster_name"
  fi
done

# Platform services
log_info "=== Platform Services ==="
CLUSTER="platform"
kubeconfig="$(kubeconfig_for_cluster "$CLUSTER")"
if [[ -f "$kubeconfig" ]]; then
  for ns in kube-system monitoring argocd jenkins; do
    log_info "--- Namespace: $ns ---"
    kubectl_cmd "$CLUSTER" -n "$ns" get pods --no-headers 2>/dev/null | awk '{printf "  %-50s %s\n", $1, $3}' || true
  done
fi
