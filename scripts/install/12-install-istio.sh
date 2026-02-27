#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/k8s.sh"

CLUSTER="dev"
log_section "Phase 12: Installing Istio Service Mesh on '$CLUSTER'"

helm repo add istio https://istio-release.storage.googleapis.com/charts 2>/dev/null || true
helm repo update

# Install Istio base CRDs
log_info "Installing Istio base (CRDs)..."
kubectl_cmd "$CLUSTER" create namespace istio-system 2>/dev/null || true
helm upgrade --install istio-base istio/base \
  --kubeconfig "$(kubeconfig_for_cluster "$CLUSTER")" \
  --namespace istio-system \
  --set defaultRevision=default \
  --wait --timeout 5m

# Install istiod (control plane)
log_info "Installing istiod..."
helm upgrade --install istiod istio/istiod \
  --kubeconfig "$(kubeconfig_for_cluster "$CLUSTER")" \
  --namespace istio-system \
  --values "$PROJECT_ROOT/manifests/istio/istio-values.yaml" \
  --wait --timeout 10m

# Install Istio Ingress Gateway
log_info "Installing Istio Ingress Gateway..."
kubectl_cmd "$CLUSTER" create namespace istio-ingress 2>/dev/null || true
helm upgrade --install istio-ingressgateway istio/gateway \
  --kubeconfig "$(kubeconfig_for_cluster "$CLUSTER")" \
  --namespace istio-ingress \
  --set service.type=NodePort \
  --wait --timeout 5m

# Enable sidecar injection on demo namespace
log_info "Enabling sidecar injection on demo namespace..."
kubectl_cmd "$CLUSTER" create namespace demo 2>/dev/null || true
kubectl_cmd "$CLUSTER" label namespace demo istio-injection=enabled --overwrite

# Restart existing pods to inject sidecars
log_info "Restarting demo pods for sidecar injection..."
kubectl_cmd "$CLUSTER" rollout restart deployment -n demo

# Wait for rollout
for deploy in nginx-web httpbin redis; do
  kubectl_cmd "$CLUSTER" -n demo rollout status deployment/$deploy --timeout=120s 2>/dev/null || true
done

# Apply httpbin-v2 for canary demo
log_info "Deploying httpbin-v2 for canary demo..."
kubectl_cmd "$CLUSTER" apply -f "$PROJECT_ROOT/manifests/istio/httpbin-v2.yaml"

# Apply Istio policies
log_info "Applying PeerAuthentication (STRICT mTLS)..."
kubectl_cmd "$CLUSTER" apply -f "$PROJECT_ROOT/manifests/istio/peer-authentication.yaml"

log_info "Applying VirtualService (canary 80/20)..."
kubectl_cmd "$CLUSTER" apply -f "$PROJECT_ROOT/manifests/istio/virtual-service.yaml"

log_info "Applying DestinationRule (circuit breaker)..."
kubectl_cmd "$CLUSTER" apply -f "$PROJECT_ROOT/manifests/istio/destination-rule.yaml"

log_info "Applying Gateway..."
kubectl_cmd "$CLUSTER" apply -f "$PROJECT_ROOT/manifests/istio/istio-gateway.yaml"

# Apply NetworkPolicy update for Istio sidecars
log_info "Applying NetworkPolicy for Istio sidecar ports..."
kubectl_cmd "$CLUSTER" apply -f "$PROJECT_ROOT/manifests/network-policies/allow-istio-sidecars.yaml"

WORKER_IP=$(vm_get_ip "dev-worker1")
log_info "Istio installed on '$CLUSTER' cluster."
log_info "Istio mesh status:"
kubectl_cmd "$CLUSTER" -n istio-system get pods
log_info ""
log_info "Verify mTLS:"
log_info "  kubectl --kubeconfig kubeconfig/dev.yaml -n demo exec deploy/nginx-web -c nginx -- curl -s http://httpbin/get"
log_info "Verify canary (20% to v2):"
log_info "  for i in \$(seq 1 10); do kubectl --kubeconfig kubeconfig/dev.yaml -n demo exec deploy/nginx-web -c nginx -- curl -s http://httpbin/get | head -1; done"
log_info "Phase 12 complete."
