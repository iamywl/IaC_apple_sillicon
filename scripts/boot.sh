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

# Phase 2.5: IP 드리프트 완전 복구(멱등) — 02 가 놓치는 4겹 결함을 자동 교정한다.
#   ① apiserver 인증서 service-CIDR SAN  ② control-plane 정적 파드 재로드
#   ③ worker kubelet.conf  ④ cilium KUBERNETES_SERVICE_HOST
# 정상이면 각 단계는 검사 후 건너뛰므로 매 부팅 실행해도 안전하다.
bash "$SCRIPT_DIR/fix-cluster-ip-drift.sh"

# Phase 3: Verify services
bash "$SCRIPT_DIR/boot/03-verify-services.sh"

log_section "Boot Complete!"
