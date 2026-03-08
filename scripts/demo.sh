#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
source "$SCRIPT_DIR/lib/vm.sh"

DASHBOARD_DIR="$PROJECT_ROOT/dashboard"
DASHBOARD_PID_FILE="$PROJECT_ROOT/.dashboard.pid"

cleanup() {
  if [[ -f "$DASHBOARD_PID_FILE" ]]; then
    local pid
    pid=$(cat "$DASHBOARD_PID_FILE")
    if kill -0 "$pid" 2>/dev/null; then
      log_info "Stopping dashboard (PID: $pid)..."
      kill "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
    fi
    rm -f "$DASHBOARD_PID_FILE"
  fi
}
trap cleanup EXIT INT TERM

usage() {
  echo "Usage: $0 [--skip-install] [--skip-dashboard] [--dashboard-only]"
  echo ""
  echo "Options:"
  echo "  --skip-install     Skip infrastructure install (use when already installed)"
  echo "  --skip-dashboard   Skip dashboard startup"
  echo "  --dashboard-only   Only start the dashboard (infra must be running)"
  echo ""
  echo "Examples:"
  echo "  $0                     # Full demo: install everything + start dashboard"
  echo "  $0 --skip-install      # Boot existing VMs + start dashboard"
  echo "  $0 --dashboard-only    # Just start the dashboard"
  exit 0
}

SKIP_INSTALL=false
SKIP_DASHBOARD=false
DASHBOARD_ONLY=false

for arg in "$@"; do
  case "$arg" in
    --skip-install)    SKIP_INSTALL=true ;;
    --skip-dashboard)  SKIP_DASHBOARD=true ;;
    --dashboard-only)  DASHBOARD_ONLY=true ;;
    --help|-h)         usage ;;
    *) die "Unknown option: $arg" ;;
  esac
done

log_section "Tart-Infra Demo"
log_info "One command to rule them all."
echo ""

# ─── Dashboard Only Mode ───
if [[ "$DASHBOARD_ONLY" == true ]]; then
  log_section "Phase: Dashboard Only"
  log_info "Starting SRE dashboard..."

  cd "$DASHBOARD_DIR"
  if [[ ! -d "node_modules" ]]; then
    log_info "Installing dashboard dependencies..."
    npm install
  fi

  npm run dev &
  DASHBOARD_PID=$!
  echo "$DASHBOARD_PID" > "$DASHBOARD_PID_FILE"

  log_info "Dashboard started (PID: $DASHBOARD_PID)"
  log_info "  Frontend: http://localhost:5173"
  log_info "  Backend:  http://localhost:3000"
  echo ""
  log_info "Press Ctrl+C to stop."
  wait "$DASHBOARD_PID"
  exit 0
fi

# ─── Phase 1: Infrastructure Setup ───
if [[ "$SKIP_INSTALL" == true ]]; then
  log_section "Phase 1: Boot Existing Infrastructure"
  log_info "Skipping install, booting existing VMs..."
  bash "$SCRIPT_DIR/boot.sh"
else
  # Check if VMs already exist
  EXISTING_VMS=$(tart list 2>/dev/null | grep -c "local" || true)
  if [[ "$EXISTING_VMS" -gt 0 ]]; then
    log_warn "Found $EXISTING_VMS existing VMs."
    log_warn "If you want a fresh install, run './scripts/destroy.sh' first."
    echo ""
    read -rp "Boot existing VMs instead of reinstalling? [Y/n] " answer
    if [[ "${answer:-Y}" =~ ^[Yy]$ ]]; then
      log_info "Booting existing infrastructure..."
      bash "$SCRIPT_DIR/boot.sh"
    else
      log_info "Starting full installation..."
      bash "$SCRIPT_DIR/install.sh"
    fi
  else
    log_section "Phase 1: Full Infrastructure Install"
    bash "$SCRIPT_DIR/install.sh"
  fi
fi

# ─── Phase 2: Status Check ───
log_section "Phase 2: Infrastructure Status"
bash "$SCRIPT_DIR/status.sh"

# ─── Phase 3: Dashboard ───
if [[ "$SKIP_DASHBOARD" == true ]]; then
  log_section "Demo Ready! (Dashboard skipped)"
  print_access_info
  exit 0
fi

log_section "Phase 3: Starting SRE Dashboard"

cd "$DASHBOARD_DIR"
if [[ ! -d "node_modules" ]]; then
  log_info "Installing dashboard dependencies..."
  npm install
fi

npm run dev &
DASHBOARD_PID=$!
echo "$DASHBOARD_PID" > "$DASHBOARD_PID_FILE"

# Wait for dashboard to be ready
log_info "Waiting for dashboard to start..."
for i in $(seq 1 30); do
  if curl -s http://localhost:3000/api/health >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

# ─── Summary ───
log_section "Demo Ready!"
echo ""

PLATFORM_IP=$(vm_get_ip "platform-worker1" 2>/dev/null || echo "<platform-worker1-ip>")

log_info "=== SRE Dashboard ==="
log_info "  Frontend:    http://localhost:5173"
log_info "  Backend API: http://localhost:3000"
echo ""
log_info "=== Platform Services ==="
log_info "  Grafana:     http://${PLATFORM_IP}:30300  (admin/admin)"
log_info "  ArgoCD:      http://${PLATFORM_IP}:30800"
log_info "  Jenkins:     http://${PLATFORM_IP}:30900"
log_info "  AlertMgr:    http://${PLATFORM_IP}:30903"
echo ""
log_info "=== kubectl 사용법 ==="
for cluster_name in $(get_cluster_names); do
  log_info "  $cluster_name: kubectl --kubeconfig kubeconfig/${cluster_name}.yaml get nodes"
done
echo ""
log_info "=== 종료 ==="
log_info "  Ctrl+C → 대시보드 종료"
log_info "  ./scripts/shutdown.sh → VM 전체 종료"
echo ""

# Open dashboard in browser
if command -v open >/dev/null 2>&1; then
  open "http://localhost:5173"
fi

wait "$DASHBOARD_PID"
