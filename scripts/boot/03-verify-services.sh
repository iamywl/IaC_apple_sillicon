#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/k8s.sh"

log_section "Verifying Services"

# Check Cilium on all clusters
for cluster_name in $(get_cluster_names); do
  log_info "[$cluster_name] Checking Cilium..."
  kubectl_cmd "$cluster_name" -n kube-system get pods -l app.kubernetes.io/name=cilium-agent --no-headers 2>/dev/null || log_warn "Cilium not found on $cluster_name"
done

# Check platform services
CLUSTER="platform"
log_info "[platform] Checking monitoring..."
kubectl_cmd "$CLUSTER" -n monitoring get pods --no-headers 2>/dev/null | head -10 || log_warn "Monitoring pods not found"

log_info "[platform] Checking ArgoCD..."
kubectl_cmd "$CLUSTER" -n argocd get pods --no-headers 2>/dev/null || log_warn "ArgoCD pods not found"

log_info "[platform] Checking Jenkins..."
kubectl_cmd "$CLUSTER" -n jenkins get pods --no-headers 2>/dev/null || log_warn "Jenkins pods not found"

# Print access URLs
PLATFORM_IP=$(vm_get_ip "platform-worker1" 2>/dev/null || echo "<unknown>")

log_section "Access Information"
log_info "Grafana:  http://${PLATFORM_IP}:30300  (admin/admin)"
log_info "ArgoCD:   http://${PLATFORM_IP}:30800"
log_info "Jenkins:  http://${PLATFORM_IP}:30900"
log_info "Hubble:   cilium hubble ui (via port-forward)"
echo ""
log_info "Kubeconfig usage:"
for cluster_name in $(get_cluster_names); do
  log_info "  export KUBECONFIG=$(kubeconfig_for_cluster "$cluster_name")"
done
