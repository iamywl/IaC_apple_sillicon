#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/vm.sh"

log_section "Destroying All Infrastructure"
log_warn "This will delete ALL VMs and kubeconfigs!"
echo ""
read -p "Are you sure? (yes/no): " confirm
if [[ "$confirm" != "yes" ]]; then
  log_info "Aborted."
  exit 0
fi

vm_delete_all

rm -rf "$KUBECONFIG_DIR"/*.yaml 2>/dev/null || true

log_info "All infrastructure destroyed."
