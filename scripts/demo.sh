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
    log_warn "기존 VM ${EXISTING_VMS}개가 감지되었습니다."
    echo ""
    echo "  다음 중 하나를 선택하세요:"
    echo ""
    echo "  1) 기존 VM 부팅 (boot)"
    echo "     - 이미 설치된 VM을 그대로 부팅합니다."
    echo "     - 데이터가 보존되며, 빠르게 시작됩니다. (약 2~3분)"
    echo "     - 이전에 설치를 완료한 적이 있다면 이 옵션을 선택하세요."
    echo ""
    echo "  2) 전체 재설치 (reinstall)"
    echo "     - 기존 VM 위에 처음부터 다시 설치합니다."
    echo "     - VM 자체는 유지되지만 kubeadm init/join이 재실행됩니다."
    echo "     - 이미 클러스터가 구성된 경우 에러가 발생할 수 있습니다."
    echo "     - 완전히 새로 시작하려면 먼저 './scripts/destroy.sh'를 실행하세요."
    echo "     - 소요 시간: 약 45~60분"
    echo ""
    while true; do
      read -rp "선택 [1/2] (기본값: 1): " answer
      case "${answer:-1}" in
        1)
          log_info "기존 VM을 부팅합니다..."
          bash "$SCRIPT_DIR/boot.sh"
          break
          ;;
        2)
          echo ""
          read -rp "정말 재설치하시겠습니까? 기존 클러스터 설정이 꼬일 수 있습니다. (yes/no): " confirm
          if [[ "$confirm" == "yes" ]]; then
            log_info "전체 재설치를 시작합니다..."
            bash "$SCRIPT_DIR/install.sh"
          else
            log_info "취소되었습니다. 기존 VM을 부팅합니다..."
            bash "$SCRIPT_DIR/boot.sh"
          fi
          break
          ;;
        *)
          log_warn "1 또는 2를 입력하세요."
          ;;
      esac
    done
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
