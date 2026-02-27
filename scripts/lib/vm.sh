#!/usr/bin/env bash
# VM management functions using tart

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

vm_exists() {
  local vm_name="$1"
  tart list | grep -q "local.*${vm_name}" 2>/dev/null
}

vm_is_running() {
  local vm_name="$1"
  tart list | grep "local.*${vm_name}" | grep -q "running" 2>/dev/null
}

vm_clone() {
  local vm_name="$1"
  local base_image
  base_image="$(get_base_image)"

  if vm_exists "$vm_name"; then
    log_warn "VM '$vm_name' already exists, skipping clone."
    return 0
  fi

  log_info "Cloning '$base_image' -> '$vm_name'..."
  tart clone "$base_image" "$vm_name"
}

vm_set_resources() {
  local vm_name="$1" cpu="$2" memory="$3"
  log_info "Setting resources for '$vm_name': ${cpu} CPU, ${memory}MB RAM"
  tart set "$vm_name" --cpu "$cpu" --memory "$memory"
}

vm_start() {
  local vm_name="$1"
  if vm_is_running "$vm_name"; then
    log_warn "VM '$vm_name' is already running."
    return 0
  fi
  log_info "Starting VM '$vm_name'..."
  tart run "$vm_name" --no-graphics --net-softnet-allow=0.0.0.0/0 &
  sleep 2
}

vm_stop() {
  local vm_name="$1"
  if ! vm_is_running "$vm_name"; then
    log_warn "VM '$vm_name' is not running."
    return 0
  fi
  log_info "Stopping VM '$vm_name'..."
  tart stop "$vm_name" 2>/dev/null || true
}

vm_delete() {
  local vm_name="$1"
  vm_stop "$vm_name" 2>/dev/null || true
  if vm_exists "$vm_name"; then
    log_info "Deleting VM '$vm_name'..."
    tart delete "$vm_name"
  fi
}

vm_get_ip() {
  local vm_name="$1"
  tart ip "$vm_name" 2>/dev/null
}

vm_wait_for_ip() {
  local vm_name="$1"
  local max_attempts="${2:-60}"
  local ip=""

  log_info "Waiting for IP on '$vm_name'..."
  for ((i=1; i<=max_attempts; i++)); do
    ip=$(vm_get_ip "$vm_name" 2>/dev/null || true)
    if [[ -n "$ip" ]]; then
      log_info "'$vm_name' got IP: $ip"
      echo "$ip"
      return 0
    fi
    sleep 3
  done
  die "Timeout waiting for IP on '$vm_name'"
}

vm_create_all() {
  local base_image
  base_image="$(get_base_image)"

  log_section "Pulling base image"
  if ! tart list | grep -q "$base_image"; then
    log_info "Pulling $base_image..."
    tart pull "$base_image"
  else
    log_info "Base image already cached."
  fi

  for cluster_name in $(get_cluster_names); do
    for node_name in $(get_nodes_for_cluster "$cluster_name"); do
      local cpu memory
      cpu=$(get_node_cpu "$cluster_name" "$node_name")
      memory=$(get_node_memory "$cluster_name" "$node_name")

      vm_clone "$node_name"
      vm_set_resources "$node_name" "$cpu" "$memory"
    done
  done
}

vm_start_all() {
  for cluster_name in $(get_cluster_names); do
    log_section "Starting cluster: $cluster_name"
    for node_name in $(get_nodes_for_cluster "$cluster_name"); do
      vm_start "$node_name"
    done
  done

  log_info "Waiting for all VMs to get IPs..."
  for cluster_name in $(get_cluster_names); do
    for node_name in $(get_nodes_for_cluster "$cluster_name"); do
      vm_wait_for_ip "$node_name"
    done
  done
}

vm_stop_all() {
  for cluster_name in $(get_cluster_names); do
    for node_name in $(get_nodes_for_cluster "$cluster_name"); do
      vm_stop "$node_name"
    done
  done
}

vm_delete_all() {
  for cluster_name in $(get_cluster_names); do
    for node_name in $(get_nodes_for_cluster "$cluster_name"); do
      vm_delete "$node_name"
    done
  done
}
