#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/k8s.sh"

CLUSTER="platform"
log_section "Phase 13: Installing Sealed Secrets on '$CLUSTER'"

helm repo add sealed-secrets https://bitnami-labs.github.io/sealed-secrets 2>/dev/null || true
helm repo update

# Install Sealed Secrets controller
log_info "Installing Sealed Secrets controller..."
kubectl_cmd "$CLUSTER" create namespace sealed-secrets 2>/dev/null || true
helm upgrade --install sealed-secrets sealed-secrets/sealed-secrets \
  --kubeconfig "$(kubeconfig_for_cluster "$CLUSTER")" \
  --namespace sealed-secrets \
  --set fullnameOverride=sealed-secrets-controller \
  --wait --timeout 5m

# Wait for controller to be ready
log_info "Waiting for Sealed Secrets controller..."
kubectl_cmd "$CLUSTER" -n sealed-secrets rollout status deployment/sealed-secrets-controller --timeout=120s

# Create example SealedSecret for demo namespace on dev cluster
DEV_CLUSTER="dev"
log_info "Creating demo secrets on '$DEV_CLUSTER' cluster..."
kubectl_cmd "$DEV_CLUSTER" create namespace demo 2>/dev/null || true

# Apply example secret manifests (pre-encrypted for demo purposes)
log_info "Applying example secret manifests..."
kubectl_cmd "$DEV_CLUSTER" apply -f "$PROJECT_ROOT/manifests/sealed-secrets/demo-db-secret.yaml"
kubectl_cmd "$DEV_CLUSTER" apply -f "$PROJECT_ROOT/manifests/sealed-secrets/demo-api-secret.yaml"

# Apply RBAC for secret access
log_info "Applying secret access RBAC..."
kubectl_cmd "$DEV_CLUSTER" apply -f "$PROJECT_ROOT/manifests/sealed-secrets/secret-reader-rbac.yaml"

log_info "Sealed Secrets controller status:"
kubectl_cmd "$CLUSTER" -n sealed-secrets get pods

log_info ""
log_info "Fetch public key for encrypting secrets:"
log_info "  kubeseal --fetch-cert --kubeconfig kubeconfig/platform.yaml --controller-name=sealed-secrets-controller --controller-namespace=sealed-secrets > pub-cert.pem"
log_info ""
log_info "Create a SealedSecret:"
log_info "  echo -n 'my-secret-value' | kubectl create secret generic my-secret --dry-run=client --from-file=password=/dev/stdin -o yaml | kubeseal --cert pub-cert.pem -o yaml > sealed-secret.yaml"
log_info "Phase 13 complete."
