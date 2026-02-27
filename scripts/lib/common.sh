#!/usr/bin/env bash
set -euo pipefail

_COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$_COMMON_DIR/../.." && pwd)"
CONFIG_FILE="$PROJECT_ROOT/config/clusters.json"
KUBECONFIG_DIR="$PROJECT_ROOT/kubeconfig"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

log_info()    { echo -e "${GREEN}[INFO]${NC} $*"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $*"; }
log_step()    { echo -e "${BLUE}[STEP]${NC} $*"; }
log_section() { echo -e "\n${CYAN}========== $* ==========${NC}\n"; }

die() { log_error "$@"; exit 1; }

check_dependencies() {
  local deps=("tart" "kubectl" "helm" "jq" "sshpass")
  for dep in "${deps[@]}"; do
    command -v "$dep" >/dev/null 2>&1 || die "$dep is not installed. Run: brew install $dep"
  done
  log_info "All dependencies are installed."
}

get_config() {
  jq -r "$1" "$CONFIG_FILE"
}

get_ssh_user() {
  get_config '.ssh_user'
}

get_ssh_password() {
  get_config '.ssh_password'
}

get_base_image() {
  get_config '.base_image'
}

get_cluster_names() {
  get_config '.clusters[].name'
}

get_cluster_count() {
  get_config '.clusters | length'
}

get_nodes_for_cluster() {
  local cluster_name="$1"
  get_config ".clusters[] | select(.name==\"$cluster_name\") | .nodes[].name"
}

get_node_role() {
  local cluster_name="$1" node_name="$2"
  get_config ".clusters[] | select(.name==\"$cluster_name\") | .nodes[] | select(.name==\"$node_name\") | .role"
}

get_node_cpu() {
  local cluster_name="$1" node_name="$2"
  get_config ".clusters[] | select(.name==\"$cluster_name\") | .nodes[] | select(.name==\"$node_name\") | .cpu"
}

get_node_memory() {
  local cluster_name="$1" node_name="$2"
  get_config ".clusters[] | select(.name==\"$cluster_name\") | .nodes[] | select(.name==\"$node_name\") | .memory"
}

get_pod_cidr() {
  local cluster_name="$1"
  get_config ".clusters[] | select(.name==\"$cluster_name\") | .pod_cidr"
}

get_service_cidr() {
  local cluster_name="$1"
  get_config ".clusters[] | select(.name==\"$cluster_name\") | .service_cidr"
}

get_master_for_cluster() {
  local cluster_name="$1"
  get_config ".clusters[] | select(.name==\"$cluster_name\") | .nodes[] | select(.role==\"master\") | .name"
}

get_workers_for_cluster() {
  local cluster_name="$1"
  get_config ".clusters[] | select(.name==\"$cluster_name\") | .nodes[] | select(.role==\"worker\") | .name"
}

kubeconfig_for_cluster() {
  echo "$KUBECONFIG_DIR/$1.yaml"
}

kubectl_cmd() {
  local cluster_name="$1"
  shift
  kubectl --kubeconfig "$(kubeconfig_for_cluster "$cluster_name")" "$@"
}
