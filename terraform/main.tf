locals {
  kubeconfig_dir = "${var.project_root}/kubeconfig"
}

# Helm provider - platform cluster kubeconfig
provider "helm" {
  kubernetes {
    config_path = "${local.kubeconfig_dir}/platform.yaml"
  }
}

# Phase 1: VM Lifecycle
module "vms" {
  source = "./modules/tart-vm"

  base_image   = var.base_image
  clusters     = var.clusters
  project_root = var.project_root
}

# Phase 2: K8s Cluster Setup
module "k8s" {
  source = "./modules/k8s-cluster"

  depends_on = [module.vms]

  clusters       = var.clusters
  vm_ips         = module.vms.vm_ips
  project_root   = var.project_root
  ssh_user       = var.ssh_user
  ssh_password   = var.ssh_password
  kubeconfig_dir = local.kubeconfig_dir
}

# Phase 3: Helm Releases (platform cluster)
module "helm" {
  source = "./modules/helm-releases"

  depends_on = [module.k8s]

  clusters       = var.clusters
  vm_ips         = module.vms.vm_ips
  project_root   = var.project_root
  kubeconfig_dir = local.kubeconfig_dir
}

# Phase 4: Dev/Staging Helm (metrics-server, Istio) via null_resource
resource "null_resource" "install_dev_staging" {
  depends_on = [module.k8s]

  triggers = {
    clusters = join(",", [for c in var.clusters : c.name])
  }

  provisioner "local-exec" {
    command = <<-EOT
      # metrics-server on dev and staging
      bash "${var.project_root}/scripts/install/11-install-hpa.sh"
      # Istio on dev
      bash "${var.project_root}/scripts/install/12-install-istio.sh"
    EOT
  }
}
