output "installed_releases" {
  description = "List of installed Helm releases"
  value = [
    "kube-prometheus-stack",
    "loki",
    "argocd",
    "jenkins",
    "metrics-server (dev)",
    "metrics-server (staging)",
    "istio-base",
    "istiod",
    "istio-ingressgateway"
  ]
}
