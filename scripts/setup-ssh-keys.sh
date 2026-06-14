#!/usr/bin/env bash
# setup-ssh-keys.sh — tart 클러스터 노드에 전용 SSH 키를 배포하고 ~/.ssh/config 를 관리한다.
#
# 동작:
#   1. 전용 키페어(~/.ssh/tart_k8scert)가 없으면 생성한다.
#   2. 대상 클러스터의 모든 노드를 (필요하면) 부팅하고 IP/SSH 가 준비될 때까지 대기한다.
#   3. admin 계정의 authorized_keys 에 공개키를 멱등하게 추가한다(이미 있으면 건너뜀).
#   4. ~/.ssh/config 의 관리 블록을 갱신한다. 각 노드는 VM 이름을 Host 별칭으로 쓰고
#      ProxyCommand 가 접속 시점에 `tart ip <vm>` 로 현재 IP 를 조회하므로 IP 가 바뀌어도 동작한다.
#
# 사용법:
#   ./scripts/setup-ssh-keys.sh                 # clusters.json 의 모든 클러스터
#   ./scripts/setup-ssh-keys.sh dev staging     # 지정한 클러스터만
#   ./scripts/setup-ssh-keys.sh --no-boot dev   # 이미 켜져 있는 노드만 설정(부팅 안 함)
#
# 배포 후에는 `ssh dev-master`, `ssh staging-worker1` 처럼 비밀번호 없이 접속된다.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"
source "$SCRIPT_DIR/lib/vm.sh"
source "$SCRIPT_DIR/lib/ssh.sh"

KEY_PATH="${TART_SSH_KEY:-$HOME/.ssh/tart_k8scert}"
PUB_PATH="${KEY_PATH}.pub"
SSH_CONFIG="$HOME/.ssh/config"
MARK_BEGIN="# >>> tart-k8scert managed (do not edit by hand) >>>"
MARK_END="# <<< tart-k8scert managed <<<"

NO_BOOT=0
TARGET_CLUSTERS=()
for arg in "$@"; do
  case "$arg" in
    --no-boot) NO_BOOT=1 ;;
    -*) die "Unknown option: $arg" ;;
    *) TARGET_CLUSTERS+=("$arg") ;;
  esac
done
if [[ ${#TARGET_CLUSTERS[@]} -eq 0 ]]; then
  while IFS= read -r c; do TARGET_CLUSTERS+=("$c"); done < <(get_cluster_names)
fi

# 1. 전용 키 생성 -----------------------------------------------------------
ensure_key() {
  if [[ -f "$KEY_PATH" && -f "$PUB_PATH" ]]; then
    log_info "기존 키 사용: $KEY_PATH"
  else
    log_step "전용 키 생성: $KEY_PATH"
    ssh-keygen -t ed25519 -f "$KEY_PATH" -N "" -C "tart-k8scert" >/dev/null
  fi
  chmod 600 "$KEY_PATH"; chmod 644 "$PUB_PATH"
}

# 2~3. 노드 부팅 + 키 배포 --------------------------------------------------
distribute_to_node() {
  local cluster="$1" node="$2"
  if ! vm_exists "$node"; then
    log_warn "VM 없음(건너뜀): $node"
    return 0
  fi
  if ! vm_is_running "$node"; then
    if [[ $NO_BOOT -eq 1 ]]; then
      log_warn "꺼져 있음(--no-boot, 건너뜀): $node"
      return 0
    fi
    vm_start "$node"
  fi
  # vm_get_ip 는 깨끗한 IP만 출력한다(로그 오염 없음). 최대 60회(3초 간격) 폴링.
  local ip="" i
  for ((i=1; i<=60; i++)); do
    ip="$(vm_get_ip "$node" 2>/dev/null || true)"
    [[ -n "$ip" ]] && break
    sleep 3
  done
  [[ -z "$ip" ]] && { log_warn "IP 대기 실패: $node"; return 0; }
  # SSH 준비 대기(ssh_exec 직접 폴링, die 회피).
  local ready=0
  for ((i=1; i<=40; i++)); do
    if ssh_exec "$ip" "echo ok" >/dev/null 2>&1; then ready=1; break; fi
    sleep 3
  done
  [[ $ready -eq 0 ]] && { log_warn "SSH 대기 실패: $node ($ip)"; return 0; }

  local pub; pub="$(cat "$PUB_PATH")"
  # 멱등 추가: 이미 있으면 그대로 둔다.
  if ssh_exec "$ip" "mkdir -p ~/.ssh && chmod 700 ~/.ssh && \
      grep -qxF '$pub' ~/.ssh/authorized_keys 2>/dev/null || echo '$pub' >> ~/.ssh/authorized_keys; \
      chmod 600 ~/.ssh/authorized_keys"; then
    log_info "키 배포 완료: $node ($ip)  [$cluster]"
  else
    log_warn "키 배포 실패: $node ($ip)"
  fi
}

# 4. ~/.ssh/config 관리 블록 갱신 ------------------------------------------
render_config_block() {
  echo "$MARK_BEGIN"
  echo "# 생성: scripts/setup-ssh-keys.sh — Host 별칭 = tart VM 이름."
  echo "# IP 는 ProxyCommand 가 접속 시점에 'tart ip' 로 조회하므로 재부팅해도 갱신 불필요."
  local user; user="$(get_ssh_user)"
  # config 블록은 항상 clusters.json 의 전체 클러스터를 기준으로 생성한다.
  # (일부 클러스터만 대상으로 실행해도 다른 클러스터의 Host 별칭이 사라지지 않게 한다.)
  local all_clusters=()
  while IFS= read -r c; do all_clusters+=("$c"); done < <(get_cluster_names)
  for cluster in "${all_clusters[@]}"; do
    echo ""
    echo "# --- cluster: $cluster ---"
    while IFS= read -r node; do
      local role; role="$(get_node_role "$cluster" "$node")"
      echo "Host $node            # $cluster / $role"
      echo "    User $user"
      echo "    IdentityFile $KEY_PATH"
      echo "    StrictHostKeyChecking no"
      echo "    UserKnownHostsFile /dev/null"
      echo "    LogLevel ERROR"
      echo "    ProxyCommand sh -c \"nc \$(tart ip %h 2>/dev/null) 22\""
    done < <(get_nodes_for_cluster "$cluster")
  done
  echo "$MARK_END"
}

update_ssh_config() {
  mkdir -p "$HOME/.ssh"; chmod 700 "$HOME/.ssh"
  touch "$SSH_CONFIG"; chmod 600 "$SSH_CONFIG"
  cp "$SSH_CONFIG" "${SSH_CONFIG}.bak.tart" 2>/dev/null || true
  # 기존 관리 블록 제거 후 재작성
  local tmp; tmp="$(mktemp)"
  awk -v b="$MARK_BEGIN" -v e="$MARK_END" '
    $0==b {skip=1} skip && $0==e {skip=0; next} !skip {print}
  ' "$SSH_CONFIG" > "$tmp"
  {
    cat "$tmp"
    [[ -s "$tmp" ]] && echo ""
    render_config_block
  } > "$SSH_CONFIG"
  rm -f "$tmp"
  log_info "~/.ssh/config 관리 블록 갱신 완료 (백업: ${SSH_CONFIG}.bak.tart)"
}

main() {
  command -v nc >/dev/null 2>&1 || die "nc(netcat) 필요 — macOS 기본 포함"
  command -v sshpass >/dev/null 2>&1 || die "sshpass 필요 — brew install sshpass"
  ensure_key
  log_section "대상 클러스터: ${TARGET_CLUSTERS[*]}"
  for cluster in "${TARGET_CLUSTERS[@]}"; do
    # 노드를 배열로 먼저 수집한다. while-read 로 순회하면 내부 ssh 가 그 stdin(노드 목록)을
    # 삼켜 일부 노드가 누락되므로 배열 + for 로 처리한다.
    local nodes=()
    while IFS= read -r node; do nodes+=("$node"); done < <(get_nodes_for_cluster "$cluster")
    for node in "${nodes[@]}"; do
      distribute_to_node "$cluster" "$node"
    done
  done
  update_ssh_config
  log_section "완료"
  echo "이제 비밀번호 없이 접속: ssh <노드이름>  (예: ssh dev-master)"
  echo "공개키: $PUB_PATH"
  echo "개인키: $KEY_PATH"
}

main
