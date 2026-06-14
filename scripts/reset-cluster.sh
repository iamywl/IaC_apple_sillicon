#!/usr/bin/env bash
# reset-cluster.sh — 클러스터를 VM 째로 완전히 제거하고 처음부터 새로 만든다.
#
# 왜 필요한가: tart 는 재부팅마다 IP 를 바꾸고 kubeadm 클러스터는 init 시점 IP 에 묶여 깨진다.
#   기존 클러스터를 고치는 것(fix-cluster-ip-drift.sh)보다, 그냥 **새로 만드는 게 가장 단순하고 확실하다**.
#   새 클러스터는 kubeadm init/cilium 이 모두 '현재 IP'로 설정되므로 IP 드리프트 자체가 발생하지 않는다.
#   → Claude/디버깅 없이 명령 하나로 깨끗한 실습용 클러스터를 얻는다.
#
# 하는 일(지정 클러스터에 대해서만):
#   1. 해당 클러스터 VM 삭제(tart delete) + kubeconfig 삭제
#   2. VM 재생성(clone + 리소스 설정) + 기동 + IP/SSH 대기
#   3. 노드 준비(swap/모듈/sysctl/hostname) + containerd + kubeadm 설치  ← 골든이미지면 생략
#   4. kubeadm init + worker join (현재 IP, 올바른 pod/service CIDR)
#   5. Cilium(CNI) 설치 + 노드 Ready 대기
#   결과: kubeconfig/<클러스터>.yaml 갱신, 바로 실습 가능. (모니터링/CI 등 무거운 스택은 설치 안 함 → 빠름)
#
# 사용법:
#   ./scripts/reset-cluster.sh dev              # dev 만 완전 재생성(권장: 실습은 한 클러스터면 충분)
#   ./scripts/reset-cluster.sh dev staging      # 여러 개
#   ./scripts/reset-cluster.sh --yes dev        # 확인 프롬프트 생략(자동화)
#   ./scripts/reset-cluster.sh all              # 전체(platform/dev/staging/prod) — 오래 걸림
#
# 소요: 노드당 약 5~8분(plain Ubuntu 이미지 기준). 골든이미지면 대폭 단축.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"
source "$SCRIPT_DIR/lib/vm.sh"
source "$SCRIPT_DIR/lib/ssh.sh"
source "$SCRIPT_DIR/lib/k8s.sh"

ASSUME_YES=0
TARGETS=()
for a in "$@"; do
  case "$a" in
    --yes|-y) ASSUME_YES=1 ;;
    all) while IFS= read -r c; do TARGETS+=("$c"); done < <(get_cluster_names) ;;
    -*) die "알 수 없는 옵션: $a" ;;
    *) TARGETS+=("$a") ;;
  esac
done
[[ ${#TARGETS[@]} -eq 0 ]] && die "재생성할 클러스터를 지정하라. 예: ./scripts/reset-cluster.sh dev  (또는 all)"

# 유효성 검사
valid=" $(get_cluster_names | tr '\n' ' ') "
for c in "${TARGETS[@]}"; do
  [[ "$valid" == *" $c "* ]] || die "clusters.json 에 없는 클러스터: $c (가능: $valid)"
done

nodes_of() { get_nodes_for_cluster "$1"; }

reset_one() {
  local cluster="$1"
  local nodes=()
  while IFS= read -r n; do nodes+=("$n"); done < <(nodes_of "$cluster")

  log_section "[$cluster] 완전 재생성 — 노드: ${nodes[*]}"

  # 1) 삭제 ----------------------------------------------------------------
  log_step "[$cluster] 1/5 기존 VM 삭제"
  for n in "${nodes[@]}"; do vm_delete "$n"; done
  rm -f "$(kubeconfig_for_cluster "$cluster")"

  # 2) 재생성 + 기동 -------------------------------------------------------
  log_step "[$cluster] 2/5 VM 재생성 + 기동"
  local base_image; base_image="$(get_base_image)"
  if ! tart list | grep -q "$base_image"; then
    log_info "베이스 이미지 pull: $base_image"; tart pull "$base_image"
  fi
  for n in "${nodes[@]}"; do
    local cpu mem
    cpu="$(get_node_cpu "$cluster" "$n")"; mem="$(get_node_memory "$cluster" "$n")"
    vm_clone "$n"; vm_set_resources "$n" "$cpu" "$mem"
  done
  for n in "${nodes[@]}"; do vm_start "$n"; done
  log_info "[$cluster] IP/SSH 대기..."
  for n in "${nodes[@]}"; do
    vm_wait_for_ip "$n" >/dev/null   # 대기용(로그가 stdout 으로 나오므로 캡처하지 않는다)
    local ip; ip="$(vm_get_ip "$n")" # 캡처는 깨끗한 vm_get_ip 로
    ssh_wait_ready "$ip"
    log_info "  $n ($ip) SSH ready"
  done

  # 3) 노드 준비 (골든이미지면 hostname만) ---------------------------------
  if [[ "$base_image" == "k8s-golden" ]]; then
    log_step "[$cluster] 3/5 골든이미지 — hostname 설정만"
    for n in "${nodes[@]}"; do ssh_exec_sudo "$(vm_get_ip "$n")" "hostnamectl set-hostname '$n'"; done
  else
    log_step "[$cluster] 3/5 노드 준비 + containerd + kubeadm 설치(노드당 수 분)"
    for n in "${nodes[@]}"; do prepare_node "$n"; install_containerd "$n"; install_kubeadm "$n"; done
  fi

  # 4) kubeadm init + join -------------------------------------------------
  log_step "[$cluster] 4/5 kubeadm init + worker join"
  init_cluster "$cluster"
  wait_apiserver_ready "$cluster"

  # 5) CNI + Ready 대기 ----------------------------------------------------
  log_step "[$cluster] 5/5 Cilium 설치 + 노드 Ready 대기"
  install_cilium "$cluster"
  wait_nodes_ready "$cluster"

  log_info "[$cluster] 완료 → kubectl --kubeconfig $(kubeconfig_for_cluster "$cluster") get nodes"
}

check_dependencies
log_section "클러스터 완전 재생성 대상: ${TARGETS[*]}"
log_warn "대상 클러스터의 VM 과 모든 데이터가 삭제되고 처음부터 새로 만들어진다."
if [[ $ASSUME_YES -ne 1 ]]; then
  read -rp "계속하려면 'yes' 입력: " ans
  [[ "$ans" == "yes" ]] || { log_info "취소됨."; exit 0; }
fi

for c in "${TARGETS[@]}"; do reset_one "$c"; done

log_section "전체 완료"
echo "실습 시작 예:"
for c in "${TARGETS[@]}"; do echo "  export KUBECONFIG=\$(pwd)/kubeconfig/${c}.yaml && kubectl get nodes"; done
echo "노드 SSH 키가 필요하면: ./scripts/setup-ssh-keys.sh --no-boot ${TARGETS[*]}"
