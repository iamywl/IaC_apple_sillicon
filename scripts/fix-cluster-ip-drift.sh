#!/usr/bin/env bash
# fix-cluster-ip-drift.sh — tart 재부팅으로 master IP 가 바뀐 뒤 클러스터를 완전 복구한다.
#
# 배경: tart 는 재부팅마다 VM IP 를 재할당한다. kubeadm 클러스터는 init 시점 IP 에 묶여 있어
#       IP 가 바뀌면 깨진다. 기존 scripts/boot.sh(02-wait-clusters.sh)는 apiserver advertise 인증서만
#       복구하고 아래 4가지를 놓친다. 이 스크립트는 dev 에서 실측 검증한 완전 복구 절차다.
#
#   ① apiserver 인증서 SAN 에 실제 service-CIDR 의 kubernetes SVC IP(예 10.97.0.1)가 빠짐
#      → boot.sh 가 --service-cidr 를 안 넘겨 기본값 10.96.0.1 로 생성. coredns 가 API 인증서 검증 실패.
#   ② control-plane 정적 파드(apiserver/controller-manager/scheduler)가 옛 conf 를 메모리에 들고 있음
#      → 재기동해 새 IP conf 를 다시 읽게 해야 함. 안 하면 컨트롤러가 옛 IP 로 리더선출 실패 → DS/Deploy 미반영.
#   ③ worker 의 /etc/kubernetes/kubelet.conf 가 옛 master IP 를 가리킴 → worker NotReady.
#   ④ cilium(kube-proxy 대체)의 KUBERNETES_SERVICE_HOST env 가 옛 master IP 하드코딩 → CNI 다운.
#
# 사용법:
#   ./scripts/fix-cluster-ip-drift.sh            # 모든 클러스터
#   ./scripts/fix-cluster-ip-drift.sh dev        # 지정 클러스터
#
# 전제: 해당 클러스터 VM 이 켜져 있어야 한다(없으면 scripts/boot.sh 로 먼저 기동).

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"
source "$SCRIPT_DIR/lib/vm.sh"
source "$SCRIPT_DIR/lib/ssh.sh"

TARGETS=("$@")
if [[ ${#TARGETS[@]} -eq 0 ]]; then
  TARGETS=()
  while IFS= read -r c; do TARGETS+=("$c"); done < <(get_cluster_names)
fi

# service_cidr "10.97.0.0/16" -> kubernetes SVC IP "10.97.0.1"
svc_first_ip() {
  local cidr="$1" ip="${1%/*}"
  echo "${ip%.*}.1"
}

fix_cluster() {
  local cluster="$1"
  local master worker svc_cidr svc_ip master_ip kc
  master="$(get_master_for_cluster "$cluster")"
  svc_cidr="$(get_service_cidr "$cluster")"
  svc_ip="$(svc_first_ip "$svc_cidr")"
  kc="$(kubeconfig_for_cluster "$cluster")"

  if ! vm_is_running "$master"; then
    log_warn "[$cluster] master VM 꺼짐 — scripts/boot.sh 로 먼저 기동 필요. 건너뜀."
    return 0
  fi
  master_ip="$(vm_get_ip "$master")"
  log_section "[$cluster] master=$master_ip  svc_cidr=$svc_cidr  k8s_svc_ip=$svc_ip"

  # ── ① apiserver 인증서 재생성(올바른 service-CIDR 포함) ───────────────────
  local cert_ok
  cert_ok="$(ssh_exec_sudo "$master_ip" "openssl x509 -in /etc/kubernetes/pki/apiserver.crt -noout -text 2>/dev/null | grep -Eq 'IP Address:${master_ip}([^0-9]|\$)' && openssl x509 -in /etc/kubernetes/pki/apiserver.crt -noout -text 2>/dev/null | grep -Eq 'IP Address:${svc_ip}([^0-9]|\$)' && echo yes || echo no" 2>/dev/null || echo no)"
  if [[ "$cert_ok" == "yes" ]]; then
    log_info "[$cluster] apiserver 인증서 SAN 정상(재생성 생략)"
  else
    log_step "[$cluster] apiserver 인증서 재생성(SAN: $master_ip, $svc_ip)"
    ssh_exec_sudo "$master_ip" "
      cd /etc/kubernetes/pki
      rm -f apiserver.crt apiserver.key
      kubeadm init phase certs apiserver \
        --apiserver-advertise-address=${master_ip} \
        --service-cidr=${svc_cidr} \
        --apiserver-cert-extra-sans=${master_ip} >/dev/null 2>&1
    " || log_warn "[$cluster] 인증서 재생성 실패"
  fi

  # ── ②-a 모든 kubeconfig(.conf)의 server 를 새 master IP 로 ────────────────
  log_step "[$cluster] control-plane .conf server IP 갱신"
  ssh_exec_sudo "$master_ip" "
    for f in admin controller-manager scheduler kubelet super-admin; do
      cf=/etc/kubernetes/\${f}.conf
      [ -f \"\$cf\" ] && sed -i 's#server: https://[0-9.]*:6443#server: https://${master_ip}:6443#' \"\$cf\"
    done
    true
  " || true

  # ── ②-b control-plane 정적 파드 재기동(새 conf/인증서 재로드) ─────────────
  log_step "[$cluster] control-plane 정적 파드 재기동"
  ssh_exec_sudo "$master_ip" "
    mkdir -p /tmp/cp-restart
    mv /etc/kubernetes/manifests/*.yaml /tmp/cp-restart/ 2>/dev/null || true
    sleep 8
    mv /tmp/cp-restart/*.yaml /etc/kubernetes/manifests/ 2>/dev/null || true
  " || true

  # apiserver 복귀 대기
  log_info "[$cluster] apiserver 복귀 대기..."
  for i in $(seq 1 40); do
    if kubectl --kubeconfig "$kc" --request-timeout=5s get --raw=/healthz >/dev/null 2>&1; then break; fi
    sleep 3
  done

  # ── ③ worker kubelet.conf 재지정 + kubelet 재시작 ────────────────────────
  while IFS= read -r worker; do
    if ! vm_is_running "$worker"; then log_warn "[$cluster] $worker 꺼짐(건너뜀)"; continue; fi
    local wip; wip="$(vm_get_ip "$worker")"
    log_step "[$cluster] $worker kubelet.conf -> $master_ip 재시작"
    ssh_exec_sudo "$wip" "
      sed -i 's#server: https://[0-9.]*:6443#server: https://${master_ip}:6443#' /etc/kubernetes/kubelet.conf 2>/dev/null || true
      systemctl restart kubelet
    " || log_warn "[$cluster] $worker kubelet 처리 실패"
  done < <(get_workers_for_cluster "$cluster")

  # ── ④ cilium(kube-proxy 대체)의 KUBERNETES_SERVICE_HOST 갱신 ──────────────
  local cil_ip
  cil_ip="$(kubectl --kubeconfig "$kc" -n kube-system get ds cilium -o jsonpath='{range .spec.template.spec.containers[0].env[?(@.name=="KUBERNETES_SERVICE_HOST")]}{.value}{end}' 2>/dev/null || echo "")"
  if [[ -n "$cil_ip" && "$cil_ip" != "$master_ip" ]]; then
    log_step "[$cluster] cilium KUBERNETES_SERVICE_HOST $cil_ip -> $master_ip"
    kubectl --kubeconfig "$kc" -n kube-system set env ds/cilium KUBERNETES_SERVICE_HOST="$master_ip" >/dev/null 2>&1 || true
    kubectl --kubeconfig "$kc" -n kube-system set env deploy/cilium-operator KUBERNETES_SERVICE_HOST="$master_ip" >/dev/null 2>&1 || true
  else
    log_info "[$cluster] cilium KUBERNETES_SERVICE_HOST 정상($cil_ip)"
  fi

  # ── coredns/cilium 재기동 ────────────────────────────────────────────────
  log_step "[$cluster] cilium/coredns 롤아웃 재시작"
  kubectl --kubeconfig "$kc" -n kube-system rollout restart ds/cilium deploy/cilium-operator deploy/coredns >/dev/null 2>&1 || true

  log_info "[$cluster] 복구 명령 완료. 확인: kubectl --kubeconfig $kc get nodes && ... get pods -n kube-system"
}

command -v jq >/dev/null 2>&1 || die "jq 필요"
for c in "${TARGETS[@]}"; do fix_cluster "$c"; done
log_section "완료 — 안정화까지 1~2분. 검증: ./scripts/status.sh"
