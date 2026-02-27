locals {
  cluster_map = { for c in var.clusters : c.name => c }
}

# ===== Platform Cluster: Monitoring =====

resource "helm_release" "kube_prometheus_stack" {
  name       = "kube-prometheus-stack"
  repository = "https://prometheus-community.github.io/helm-charts"
  chart      = "kube-prometheus-stack"
  namespace  = "monitoring"

  create_namespace = true
  wait             = true
  timeout          = 600

  values = [file("${var.project_root}/manifests/monitoring-values.yaml")]
}

resource "helm_release" "loki" {
  depends_on = [helm_release.kube_prometheus_stack]

  name       = "loki"
  repository = "https://grafana.github.io/helm-charts"
  chart      = "loki-stack"
  namespace  = "monitoring"
  wait       = true
  timeout    = 300

  values = [file("${var.project_root}/manifests/loki-values.yaml")]
}

# ===== Platform Cluster: CI/CD =====

resource "helm_release" "argocd" {
  name       = "argocd"
  repository = "https://argoproj.github.io/argo-helm"
  chart      = "argo-cd"
  namespace  = "argocd"

  create_namespace = true
  wait             = true
  timeout          = 600

  values = [file("${var.project_root}/manifests/argocd-values.yaml")]
}

resource "helm_release" "jenkins" {
  name       = "jenkins"
  repository = "https://charts.jenkins.io"
  chart      = "jenkins"
  namespace  = "jenkins"

  create_namespace = true
  wait             = true
  timeout          = 600

  values = [file("${var.project_root}/manifests/jenkins-values.yaml")]
}
