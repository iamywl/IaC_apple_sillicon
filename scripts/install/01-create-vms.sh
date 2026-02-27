#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/vm.sh"

log_section "Phase 1: Creating VMs"
vm_create_all
log_info "All VMs created successfully."
