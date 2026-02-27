output "vm_ips" {
  description = "Map of VM name to IP address"
  value       = module.vms.vm_ips
}

output "cluster_kubeconfigs" {
  description = "Kubeconfig paths per cluster"
  value = {
    for cluster in var.clusters : cluster.name => "${local.kubeconfig_dir}/${cluster.name}.yaml"
  }
}

output "access_urls" {
  description = "Service access URLs"
  value = {
    grafana     = "http://${lookup(module.vms.vm_ips, "platform-worker1", "unknown")}:30300"
    argocd      = "http://${lookup(module.vms.vm_ips, "platform-worker1", "unknown")}:30800"
    jenkins     = "http://${lookup(module.vms.vm_ips, "platform-worker1", "unknown")}:30900"
    alertmanager = "http://${lookup(module.vms.vm_ips, "platform-worker1", "unknown")}:30903"
  }
}
