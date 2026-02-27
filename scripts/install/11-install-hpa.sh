#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/k8s.sh"

log_section "Phase 11: Installing metrics-server + HPA"

helm repo add metrics-server https://kubernetes-sigs.github.io/metrics-server/ 2>/dev/null || true
helm repo update

# Install metrics-server on dev and staging
for CLUSTER in dev staging; do
  log_info "Installing metrics-server on '$CLUSTER'..."
  helm upgrade --install metrics-server metrics-server/metrics-server \
    --kubeconfig "$(kubeconfig_for_cluster "$CLUSTER")" \
    --namespace kube-system \
    --values "$PROJECT_ROOT/manifests/metrics-server-values.yaml" \
    --wait --timeout 5m
  log_info "metrics-server installed on '$CLUSTER'."
done

# Apply HPA and PDB to dev cluster
CLUSTER="dev"
log_info "Ensuring demo namespace and apps exist on '$CLUSTER'..."
kubectl_cmd "$CLUSTER" create namespace demo 2>/dev/null || true
kubectl_cmd "$CLUSTER" apply -f "$PROJECT_ROOT/manifests/demo/nginx-app.yaml"
kubectl_cmd "$CLUSTER" apply -f "$PROJECT_ROOT/manifests/demo/httpbin-app.yaml"
kubectl_cmd "$CLUSTER" apply -f "$PROJECT_ROOT/manifests/demo/redis-app.yaml"

log_info "Applying HPAs..."
kubectl_cmd "$CLUSTER" apply -f "$PROJECT_ROOT/manifests/hpa/nginx-hpa.yaml"
kubectl_cmd "$CLUSTER" apply -f "$PROJECT_ROOT/manifests/hpa/httpbin-hpa.yaml"

log_info "Applying PodDisruptionBudgets..."
kubectl_cmd "$CLUSTER" apply -f "$PROJECT_ROOT/manifests/hpa/pdb-nginx.yaml"
kubectl_cmd "$CLUSTER" apply -f "$PROJECT_ROOT/manifests/hpa/pdb-httpbin.yaml"

log_info "HPA status:"
kubectl_cmd "$CLUSTER" -n demo get hpa

log_info "Run load test to trigger HPA:"
log_info "  kubectl --kubeconfig kubeconfig/dev.yaml apply -f manifests/demo/k6-loadtest.yaml"
log_info "  kubectl --kubeconfig kubeconfig/dev.yaml -n demo get hpa -w"
log_info "Phase 11 complete."
