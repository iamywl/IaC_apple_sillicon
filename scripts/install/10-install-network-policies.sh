#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/k8s.sh"

CLUSTER="dev"
log_section "Phase 10: Installing CiliumNetworkPolicies on '$CLUSTER'"

kubectl_cmd "$CLUSTER" create namespace demo 2>/dev/null || true

log_info "Applying default deny..."
kubectl_cmd "$CLUSTER" apply -f "$PROJECT_ROOT/manifests/network-policies/default-deny.yaml"

log_info "Applying allow rules..."
kubectl_cmd "$CLUSTER" apply -f "$PROJECT_ROOT/manifests/network-policies/allow-external-to-nginx.yaml"
kubectl_cmd "$CLUSTER" apply -f "$PROJECT_ROOT/manifests/network-policies/allow-nginx-to-httpbin.yaml"
kubectl_cmd "$CLUSTER" apply -f "$PROJECT_ROOT/manifests/network-policies/allow-nginx-to-redis.yaml"
kubectl_cmd "$CLUSTER" apply -f "$PROJECT_ROOT/manifests/network-policies/allow-nginx-egress.yaml"

log_info "Current CiliumNetworkPolicies:"
kubectl_cmd "$CLUSTER" -n demo get ciliumnetworkpolicies

log_info "Verify with Hubble:"
log_info "  hubble observe --namespace demo --verdict DROPPED"
log_info "  hubble observe --namespace demo --verdict FORWARDED"
log_info "Phase 10 complete."
