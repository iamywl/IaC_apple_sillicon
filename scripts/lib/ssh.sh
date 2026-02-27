#!/usr/bin/env bash
# SSH helper functions

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

SSH_OPTS="-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o ConnectTimeout=10"

ssh_exec() {
  local ip="$1"
  shift
  local user password
  user="$(get_ssh_user)"
  password="$(get_ssh_password)"
  sshpass -p "$password" ssh $SSH_OPTS "${user}@${ip}" "$@"
}

ssh_exec_sudo() {
  local ip="$1"
  shift
  local user password
  user="$(get_ssh_user)"
  password="$(get_ssh_password)"
  sshpass -p "$password" ssh $SSH_OPTS "${user}@${ip}" sudo bash -s <<EOF
$*
EOF
}

scp_to() {
  local src="$1" ip="$2" dest="$3"
  local user password
  user="$(get_ssh_user)"
  password="$(get_ssh_password)"
  sshpass -p "$password" scp $SSH_OPTS "$src" "${user}@${ip}:${dest}"
}

scp_from() {
  local ip="$1" src="$2" dest="$3"
  local user password
  user="$(get_ssh_user)"
  password="$(get_ssh_password)"
  sshpass -p "$password" scp $SSH_OPTS "${user}@${ip}:${src}" "$dest"
}

ssh_wait_ready() {
  local ip="$1"
  local max_attempts="${2:-40}"

  for ((i=1; i<=max_attempts; i++)); do
    if ssh_exec "$ip" "echo ok" &>/dev/null; then
      return 0
    fi
    sleep 3
  done
  die "Timeout waiting for SSH on $ip"
}

ssh_node_exec() {
  local node_name="$1"
  shift
  local ip
  ip=$(vm_get_ip "$node_name")
  ssh_exec "$ip" "$@"
}

ssh_node_exec_sudo() {
  local node_name="$1"
  shift
  local ip
  ip=$(vm_get_ip "$node_name")
  ssh_exec_sudo "$ip" "$@"
}
