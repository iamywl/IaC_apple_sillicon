variable "base_image" {
  type        = string
  default     = "ghcr.io/cirruslabs/ubuntu:latest"
  description = "Tart VM base image"
}

variable "ssh_user" {
  type    = string
  default = "admin"
}

variable "ssh_password" {
  type      = string
  default   = "admin"
  sensitive = true
}

variable "project_root" {
  type        = string
  description = "Absolute path to the tart-infra project root"
}

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

  default = [
    {
      name         = "platform"
      pod_cidr     = "10.10.0.0/16"
      service_cidr = "10.96.0.0/16"
      nodes = [
        { name = "platform-master", role = "master", cpu = 2, memory = 4096, disk = 20 },
        { name = "platform-worker1", role = "worker", cpu = 3, memory = 12288, disk = 20 },
        { name = "platform-worker2", role = "worker", cpu = 2, memory = 8192, disk = 20 }
      ]
    },
    {
      name         = "dev"
      pod_cidr     = "10.20.0.0/16"
      service_cidr = "10.97.0.0/16"
      nodes = [
        { name = "dev-master", role = "master", cpu = 2, memory = 4096, disk = 20 },
        { name = "dev-worker1", role = "worker", cpu = 2, memory = 8192, disk = 20 }
      ]
    },
    {
      name         = "staging"
      pod_cidr     = "10.30.0.0/16"
      service_cidr = "10.98.0.0/16"
      nodes = [
        { name = "staging-master", role = "master", cpu = 2, memory = 4096, disk = 20 },
        { name = "staging-worker1", role = "worker", cpu = 2, memory = 8192, disk = 20 }
      ]
    },
    {
      name         = "prod"
      pod_cidr     = "10.40.0.0/16"
      service_cidr = "10.99.0.0/16"
      nodes = [
        { name = "prod-master", role = "master", cpu = 2, memory = 3072, disk = 20 },
        { name = "prod-worker1", role = "worker", cpu = 2, memory = 8192, disk = 20 },
        { name = "prod-worker2", role = "worker", cpu = 2, memory = 8192, disk = 20 }
      ]
    }
  ]
}
