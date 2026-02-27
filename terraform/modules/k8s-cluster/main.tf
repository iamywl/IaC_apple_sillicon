locals {
  all_nodes = flatten([
    for cluster in var.clusters : [
      for node in cluster.nodes : {
        cluster_name = cluster.name
        node_name    = node.name
        role         = node.role
      }
    ]
  ])

  node_map = { for n in local.all_nodes : n.node_name => n }

  cluster_map = { for c in var.clusters : c.name => c }

  masters = {
    for n in local.all_nodes : n.cluster_name => n.node_name
    if n.role == "master"
  }
}

# Wait for SSH readiness on all nodes
resource "null_resource" "ssh_wait" {
  for_each = local.node_map

  triggers = {
    vm_ip = var.vm_ips[each.key]
  }

  provisioner "local-exec" {
    command = <<-EOT
      source "${var.project_root}/scripts/lib/ssh.sh"
      ssh_wait_ready "${var.vm_ips[each.key]}"
    EOT
    interpreter = ["bash", "-c"]
  }
}

# Prepare nodes (swap off, kernel modules, sysctl)
resource "null_resource" "prepare_node" {
  for_each = local.node_map

  depends_on = [null_resource.ssh_wait]

  triggers = {
    vm_ip = var.vm_ips[each.key]
  }

  provisioner "local-exec" {
    command = <<-EOT
      source "${var.project_root}/scripts/lib/k8s.sh"
      prepare_node "${each.key}"
    EOT
    interpreter = ["bash", "-c"]
  }
}

# Install containerd
resource "null_resource" "install_runtime" {
  for_each = local.node_map

  depends_on = [null_resource.prepare_node]

  triggers = {
    vm_ip = var.vm_ips[each.key]
  }

  provisioner "local-exec" {
    command = <<-EOT
      source "${var.project_root}/scripts/lib/k8s.sh"
      install_containerd "${each.key}"
    EOT
    interpreter = ["bash", "-c"]
  }
}

# Install kubeadm/kubelet/kubectl
resource "null_resource" "install_kubeadm" {
  for_each = local.node_map

  depends_on = [null_resource.install_runtime]

  triggers = {
    vm_ip = var.vm_ips[each.key]
  }

  provisioner "local-exec" {
    command = <<-EOT
      source "${var.project_root}/scripts/lib/k8s.sh"
      install_kubeadm "${each.key}"
    EOT
    interpreter = ["bash", "-c"]
  }
}

# Initialize clusters (kubeadm init + join)
resource "null_resource" "init_cluster" {
  for_each = local.cluster_map

  depends_on = [null_resource.install_kubeadm]

  triggers = {
    cluster_name = each.key
    master_ip    = var.vm_ips[local.masters[each.key]]
  }

  provisioner "local-exec" {
    command = <<-EOT
      source "${var.project_root}/scripts/lib/k8s.sh"
      init_cluster "${each.key}"
    EOT
    interpreter = ["bash", "-c"]
  }
}

# Install Cilium + Hubble on each cluster
resource "null_resource" "install_cilium" {
  for_each = local.cluster_map

  depends_on = [null_resource.init_cluster]

  triggers = {
    cluster_name = each.key
  }

  provisioner "local-exec" {
    command = <<-EOT
      source "${var.project_root}/scripts/lib/k8s.sh"
      install_cilium "${each.key}"
      install_hubble "${each.key}"
      wait_nodes_ready "${each.key}"
    EOT
    interpreter = ["bash", "-c"]
  }
}
