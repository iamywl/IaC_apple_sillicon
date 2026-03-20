#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/k8s.sh"

log_section "Phase 16: Installing Resource Quotas & LimitRange"

# ──────────────────────────────────────────────
# Apply ResourceQuota and LimitRange on dev, staging, prod
# ──────────────────────────────────────────────
for cluster_name in dev staging prod; do
  log_info "Applying ResourceQuota and LimitRange on '$cluster_name' cluster..."

  # Create demo namespace if not exists
  kubectl_cmd "$cluster_name" create namespace demo 2>/dev/null || true

  # Apply LimitRange (default resource limits for containers)
  kubectl_cmd "$cluster_name" apply -f "$PROJECT_ROOT/manifests/resource-quotas/limitrange-${cluster_name}.yaml"

  # Apply ResourceQuota (namespace-level resource caps)
  kubectl_cmd "$cluster_name" apply -f "$PROJECT_ROOT/manifests/resource-quotas/quota-${cluster_name}.yaml"

  log_info "Verifying on '$cluster_name':"
  kubectl_cmd "$cluster_name" get resourcequota -n demo 2>/dev/null || true
  kubectl_cmd "$cluster_name" get limitrange -n demo 2>/dev/null || true
done

log_info ""
log_info "Resource management applied."
log_info "Check quota usage:"
log_info "  kubectl --kubeconfig kubeconfig/dev.yaml describe resourcequota demo-quota -n demo"
log_info "  kubectl --kubeconfig kubeconfig/dev.yaml describe limitrange demo-limitrange -n demo"
log_info "Phase 16 complete."
