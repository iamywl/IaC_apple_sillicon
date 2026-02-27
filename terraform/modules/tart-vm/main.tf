locals {
  all_nodes = flatten([
    for cluster in var.clusters : [
      for node in cluster.nodes : {
        cluster_name = cluster.name
        node_name    = node.name
        role         = node.role
        cpu          = node.cpu
        memory       = node.memory
      }
    ]
  ])

  node_map = { for n in local.all_nodes : n.node_name => n }
}

# Pull base image (idempotent)
resource "null_resource" "pull_base_image" {
  triggers = {
    image = var.base_image
  }

  provisioner "local-exec" {
    command = <<-EOT
      if ! tart list | grep -q "${var.base_image}"; then
        tart pull "${var.base_image}"
      fi
    EOT
  }
}

# Clone and configure VMs
resource "null_resource" "vm_clone" {
  for_each = local.node_map

  depends_on = [null_resource.pull_base_image]

  triggers = {
    vm_name    = each.key
    base_image = var.base_image
    cpu        = each.value.cpu
    memory     = each.value.memory
  }

  provisioner "local-exec" {
    command = <<-EOT
      if ! tart list | grep -q "local.*${each.key}"; then
        tart clone "${var.base_image}" "${each.key}"
      fi
      tart set "${each.key}" --cpu ${each.value.cpu} --memory ${each.value.memory}
    EOT
  }

  provisioner "local-exec" {
    when    = destroy
    command = <<-EOT
      tart stop "${self.triggers.vm_name}" 2>/dev/null || true
      sleep 2
      if tart list | grep -q "local.*${self.triggers.vm_name}"; then
        tart delete "${self.triggers.vm_name}"
      fi
    EOT
  }
}

# Start VMs
resource "null_resource" "vm_start" {
  for_each = local.node_map

  depends_on = [null_resource.vm_clone]

  triggers = {
    vm_name = each.key
  }

  provisioner "local-exec" {
    command = <<-EOT
      if ! tart list | grep "local.*${each.key}" | grep -q "running"; then
        tart run "${each.key}" --no-graphics --net-softnet-allow=0.0.0.0/0 &
        sleep 5
      fi
    EOT
  }
}

# Wait for IP and store in file
resource "null_resource" "vm_wait_ip" {
  for_each = local.node_map

  depends_on = [null_resource.vm_start]

  triggers = {
    vm_name = each.key
  }

  provisioner "local-exec" {
    command = <<-EOT
      mkdir -p "${var.project_root}/.terraform-vm-ips"
      max_attempts=60
      for i in $(seq 1 $max_attempts); do
        ip=$(tart ip "${each.key}" 2>/dev/null || true)
        if [ -n "$ip" ]; then
          echo -n "$ip" > "${var.project_root}/.terraform-vm-ips/${each.key}.ip"
          echo "VM ${each.key} got IP: $ip"
          exit 0
        fi
        sleep 3
      done
      echo "ERROR: Timeout waiting for IP on ${each.key}" >&2
      exit 1
    EOT
  }
}

# Read IP files
data "local_file" "vm_ips" {
  for_each = local.node_map

  depends_on = [null_resource.vm_wait_ip]

  filename = "${var.project_root}/.terraform-vm-ips/${each.key}.ip"
}
