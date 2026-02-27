#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/k8s.sh"

CLUSTER="platform"

log_section "Phase 7: Installing Monitoring Stack on '$CLUSTER'"

helm repo add prometheus-community https://prometheus-community.github.io/helm-charts 2>/dev/null || true
helm repo add grafana https://grafana.github.io/helm-charts 2>/dev/null || true
helm repo update

# kube-prometheus-stack (Prometheus + Grafana)
log_info "Installing kube-prometheus-stack..."
kubectl_cmd "$CLUSTER" create namespace monitoring 2>/dev/null || true

helm upgrade --install kube-prometheus-stack prometheus-community/kube-prometheus-stack \
  --kubeconfig "$(kubeconfig_for_cluster "$CLUSTER")" \
  --namespace monitoring \
  --values "$PROJECT_ROOT/manifests/monitoring-values.yaml" \
  --wait --timeout 10m

# Loki
log_info "Installing Loki..."
helm upgrade --install loki grafana/loki-stack \
  --kubeconfig "$(kubeconfig_for_cluster "$CLUSTER")" \
  --namespace monitoring \
  --values "$PROJECT_ROOT/manifests/loki-values.yaml" \
  --wait --timeout 5m

log_info "Monitoring stack installed."

# Print access info
WORKER_IP=$(vm_get_ip "platform-worker1")
log_info "Grafana URL: http://${WORKER_IP}:30300"
log_info "Grafana credentials: admin / admin"
