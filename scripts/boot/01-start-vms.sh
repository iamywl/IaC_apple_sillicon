#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/vm.sh"
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/ssh.sh"

log_section "Starting all VMs"

vm_start_all

log_section "Waiting for SSH access"
for cluster_name in $(get_cluster_names); do
  for node_name in $(get_nodes_for_cluster "$cluster_name"); do
    ip=$(vm_get_ip "$node_name")
    ssh_wait_ready "$ip"
    log_info "$node_name ($ip) - SSH ready"
  done
done

log_info "All VMs started and SSH accessible."
