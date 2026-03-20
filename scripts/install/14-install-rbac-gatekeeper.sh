#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/k8s.sh"

log_section "Phase 14: Installing RBAC & OPA Gatekeeper"

# ──────────────────────────────────────────────
# Part 1: RBAC on all clusters
# ──────────────────────────────────────────────
for cluster_name in $(get_cluster_names); do
  log_info "Applying RBAC manifests on '$cluster_name'..."
  kubectl_cmd "$cluster_name" apply -f "$PROJECT_ROOT/manifests/rbac/namespace-admin-role.yaml"
  kubectl_cmd "$cluster_name" apply -f "$PROJECT_ROOT/manifests/rbac/readonly-clusterrole.yaml"
  kubectl_cmd "$cluster_name" apply -f "$PROJECT_ROOT/manifests/rbac/developer-rolebinding.yaml"
done

# ──────────────────────────────────────────────
# Part 2: OPA Gatekeeper on dev cluster
# ──────────────────────────────────────────────
CLUSTER="dev"
log_info "Installing OPA Gatekeeper on '$CLUSTER'..."

helm repo add gatekeeper https://open-policy-agent.github.io/gatekeeper/charts 2>/dev/null || true
helm repo update

helm upgrade --install gatekeeper gatekeeper/gatekeeper \
  --kubeconfig "$(kubeconfig_for_cluster "$CLUSTER")" \
  --namespace gatekeeper-system \
  --create-namespace \
  --set replicas=1 \
  --set audit.replicas=1 \
  --set postInstall.labelNamespace.enabled=false \
  --wait --timeout 5m

# Wait for Gatekeeper to be ready
log_info "Waiting for Gatekeeper webhook..."
kubectl_cmd "$CLUSTER" -n gatekeeper-system rollout status deployment/gatekeeper-controller-manager --timeout=120s
kubectl_cmd "$CLUSTER" -n gatekeeper-system rollout status deployment/gatekeeper-audit --timeout=120s

# Apply constraint templates
log_info "Applying ConstraintTemplates..."
kubectl_cmd "$CLUSTER" apply -f "$PROJECT_ROOT/manifests/gatekeeper/constraint-templates/"

# Wait for templates to be established
sleep 5

# Apply constraints
log_info "Applying Constraints..."
kubectl_cmd "$CLUSTER" apply -f "$PROJECT_ROOT/manifests/gatekeeper/constraints/"

log_info "Gatekeeper status on '$CLUSTER':"
kubectl_cmd "$CLUSTER" -n gatekeeper-system get pods

log_info ""
log_info "Check constraint violations:"
log_info "  kubectl --kubeconfig kubeconfig/dev.yaml get constraints"
log_info "  kubectl --kubeconfig kubeconfig/dev.yaml describe k8srequiredlabels require-app-label"
log_info "Phase 14 complete."
