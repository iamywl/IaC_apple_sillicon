output "cluster_names" {
  description = "List of initialized cluster names"
  value       = [for c in var.clusters : c.name]
}
