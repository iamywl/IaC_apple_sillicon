#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/k8s.sh"

CLUSTER="platform"

log_section "Phase 8: Installing CI/CD (ArgoCD + Jenkins) on '$CLUSTER'"

# Local-path-provisioner (for Jenkins PVC)
log_info "Installing local-path-provisioner..."
kubectl_cmd "$CLUSTER" apply -f https://raw.githubusercontent.com/rancher/local-path-provisioner/v0.0.28/deploy/local-path-storage.yaml 2>/dev/null || true
kubectl_cmd "$CLUSTER" patch storageclass local-path -p '{"metadata": {"annotations":{"storageclass.kubernetes.io/is-default-class":"true"}}}' 2>/dev/null || true

# ArgoCD
log_info "Installing ArgoCD..."
kubectl_cmd "$CLUSTER" create namespace argocd 2>/dev/null || true

helm repo add argo https://argoproj.github.io/argo-helm 2>/dev/null || true
helm repo update

helm upgrade --install argocd argo/argo-cd \
  --kubeconfig "$(kubeconfig_for_cluster "$CLUSTER")" \
  --namespace argocd \
  --values "$PROJECT_ROOT/manifests/argocd-values.yaml" \
  --wait --timeout 10m

# Jenkins
log_info "Installing Jenkins..."
kubectl_cmd "$CLUSTER" create namespace jenkins 2>/dev/null || true

helm repo add jenkins https://charts.jenkins.io 2>/dev/null || true
helm repo update

helm upgrade --install jenkins jenkins/jenkins \
  --kubeconfig "$(kubeconfig_for_cluster "$CLUSTER")" \
  --namespace jenkins \
  --values "$PROJECT_ROOT/manifests/jenkins-values.yaml" \
  --wait --timeout 10m

# Print access info
WORKER_IP=$(vm_get_ip "platform-worker1")
log_info "ArgoCD URL: http://${WORKER_IP}:30800"
ARGOCD_PASSWORD=$(kubectl_cmd "$CLUSTER" -n argocd get secret argocd-initial-admin-secret -o jsonpath="{.data.password}" 2>/dev/null | base64 -d || echo "check-argocd-secret")
log_info "ArgoCD credentials: admin / ${ARGOCD_PASSWORD}"

log_info "Jenkins URL: http://${WORKER_IP}:30900"
JENKINS_PASSWORD=$(kubectl_cmd "$CLUSTER" -n jenkins get secret jenkins -o jsonpath="{.data.jenkins-admin-password}" 2>/dev/null | base64 -d || echo "check-jenkins-secret")
log_info "Jenkins credentials: admin / ${JENKINS_PASSWORD}"
