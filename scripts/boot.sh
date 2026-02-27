#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"

log_section "Tart Multi-Cluster Boot"
log_info "Starting all VMs and verifying cluster health..."
echo ""

# Phase 1: Start VMs
bash "$SCRIPT_DIR/boot/01-start-vms.sh"

# Phase 2: Wait for clusters
bash "$SCRIPT_DIR/boot/02-wait-clusters.sh"

# Phase 3: Verify services
bash "$SCRIPT_DIR/boot/03-verify-services.sh"

log_section "Boot Complete!"
