#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/k8s.sh"

CLUSTER="platform"
log_section "Phase 9: Enabling AlertManager + Alert Rules on '$CLUSTER'"

# Upgrade kube-prometheus-stack to enable AlertManager
log_info "Upgrading kube-prometheus-stack with AlertManager enabled..."
helm upgrade kube-prometheus-stack prometheus-community/kube-prometheus-stack \
  --kubeconfig "$(kubeconfig_for_cluster "$CLUSTER")" \
  --namespace monitoring \
  --values "$PROJECT_ROOT/manifests/monitoring-values.yaml" \
  --wait --timeout 10m

# Deploy webhook logger
log_info "Deploying AlertManager webhook logger..."
kubectl_cmd "$CLUSTER" apply -f "$PROJECT_ROOT/manifests/alerting/webhook-logger.yaml"

# Apply PrometheusRule CRDs
log_info "Applying PrometheusRule CRDs..."
kubectl_cmd "$CLUSTER" apply -f "$PROJECT_ROOT/manifests/alerting/prometheus-rules.yaml"

# Wait for AlertManager pod
log_info "Waiting for AlertManager pod..."
kubectl_cmd "$CLUSTER" -n monitoring rollout status statefulset/alertmanager-kube-prometheus-stack-alertmanager --timeout=120s 2>/dev/null || true

# Verify
log_info "AlertManager pods:"
kubectl_cmd "$CLUSTER" -n monitoring get pods -l app.kubernetes.io/name=alertmanager
log_info "Webhook logger pods:"
kubectl_cmd "$CLUSTER" -n monitoring get pods -l app=alertmanager-webhook

WORKER_IP=$(vm_get_ip "platform-worker1")
log_info "AlertManager UI: http://${WORKER_IP}:30903"
log_info "Check webhook logs: kubectl --kubeconfig kubeconfig/platform.yaml -n monitoring logs -l app=alertmanager-webhook"
log_info "Phase 9 complete."
