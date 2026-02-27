variable "clusters" {
  type = list(object({
    name         = string
    pod_cidr     = string
    service_cidr = string
    nodes = list(object({
      name   = string
      role   = string
      cpu    = number
      memory = number
      disk   = number
    }))
  }))
}

variable "vm_ips" {
  type        = map(string)
  description = "Map of VM name to IP address"
}

variable "project_root" {
  type = string
}

variable "kubeconfig_dir" {
  type = string
}
