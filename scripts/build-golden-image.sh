#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# Golden Image Builder
# ============================================================
# Ubuntu base 이미지에 containerd + kubeadm + K8s/Cilium 이미지를
# 미리 설치한 "k8s-golden" 이미지를 생성한다.
#
# 이후 install.sh에서 이 이미지를 base_image로 사용하면
# Phase 2~4를 건너뛰어 설치 시간이 45분 → 15분으로 단축된다.
#
# 사용법:
#   ./scripts/build-golden-image.sh          # 빌드 (~10분)
#   vim config/clusters.json                 # base_image → "k8s-golden"
#   ./scripts/install.sh                     # 15~20분이면 완료
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"
source "$SCRIPT_DIR/lib/ssh.sh"

GOLDEN_NAME="k8s-golden"
BASE_IMAGE="ghcr.io/cirruslabs/ubuntu:latest"
K8S_VERSION="1.31"
GOLDEN_CPU=2
GOLDEN_MEM=4096

# Cilium & K8s images to pre-pull
CILIUM_VERSION="1.16.5"
CILIUM_IMAGES=(
  "quay.io/cilium/cilium:v${CILIUM_VERSION}"
  "quay.io/cilium/operator-generic:v${CILIUM_VERSION}"
  "quay.io/cilium/hubble-relay:v${CILIUM_VERSION}"
)

# ── Cleanup on exit ──
cleanup() {
  if tart list 2>/dev/null | grep -q "${GOLDEN_NAME}-build"; then
    log_info "Cleaning up build VM..."
    tart stop "${GOLDEN_NAME}-build" 2>/dev/null || true
    sleep 2
    tart delete "${GOLDEN_NAME}-build" 2>/dev/null || true
  fi
}
trap cleanup ERR

# ── Main ──
log_section "Golden Image Builder"

# Check if golden image already exists
if tart list | grep -q "local.*${GOLDEN_NAME} "; then
  log_warn "Golden image '$GOLDEN_NAME' already exists."
  log_warn "Delete it first to rebuild: tart delete $GOLDEN_NAME"
  exit 1
fi

# Step 1: Pull base image
log_section "Step 1/7: Pulling base image"
if ! tart list | grep -q "$BASE_IMAGE"; then
  log_info "Pulling $BASE_IMAGE..."
  tart pull "$BASE_IMAGE"
else
  log_info "Base image already cached."
fi

# Step 2: Clone build VM
log_section "Step 2/7: Creating build VM"
tart clone "$BASE_IMAGE" "${GOLDEN_NAME}-build"
tart set "${GOLDEN_NAME}-build" --cpu "$GOLDEN_CPU" --memory "$GOLDEN_MEM"

# Step 3: Start and wait for SSH
log_section "Step 3/7: Starting build VM"
tart run "${GOLDEN_NAME}-build" --no-graphics &
sleep 5

BUILD_IP=""
log_info "Waiting for IP..."
for ((i=1; i<=60; i++)); do
  BUILD_IP=$(tart ip "${GOLDEN_NAME}-build" 2>/dev/null || true)
  if [[ -n "$BUILD_IP" ]]; then
    log_info "Build VM IP: $BUILD_IP"
    break
  fi
  sleep 3
done
[[ -z "$BUILD_IP" ]] && die "Timeout waiting for build VM IP"

log_info "Waiting for SSH..."
ssh_wait_ready "$BUILD_IP"
log_info "SSH ready."

# Step 4: Prepare node (swap, kernel modules, sysctl)
log_section "Step 4/7: Preparing node (OS config)"
ssh_exec_sudo "$BUILD_IP" "
  swapoff -a && sed -i '/swap/d' /etc/fstab

  cat > /etc/modules-load.d/k8s.conf <<MODEOF
overlay
br_netfilter
MODEOF
  modprobe overlay
  modprobe br_netfilter

  cat > /etc/sysctl.d/k8s.conf <<SYSEOF
net.bridge.bridge-nf-call-iptables  = 1
net.bridge.bridge-nf-call-ip6tables = 1
net.ipv4.ip_forward                 = 1
SYSEOF
  sysctl --system
"

# Step 5: Install containerd
log_section "Step 5/7: Installing containerd"
ssh_exec_sudo "$BUILD_IP" "
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq containerd apt-transport-https ca-certificates curl gnupg conntrack

  mkdir -p /etc/containerd
  containerd config default > /etc/containerd/config.toml
  sed -i 's/SystemdCgroup = false/SystemdCgroup = true/' /etc/containerd/config.toml

  systemctl restart containerd
  systemctl enable containerd
"

# Step 6: Install kubeadm, kubelet, kubectl
log_section "Step 6/7: Installing kubeadm v${K8S_VERSION}"
ssh_exec_sudo "$BUILD_IP" "
  curl -fsSL https://pkgs.k8s.io/core:/stable:/v${K8S_VERSION}/deb/Release.key | gpg --dearmor -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg 2>/dev/null
  echo 'deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/v${K8S_VERSION}/deb/ /' > /etc/apt/sources.list.d/kubernetes.list

  apt-get update -qq
  apt-get install -y -qq kubelet kubeadm kubectl
  apt-mark hold kubelet kubeadm kubectl

  systemctl enable kubelet
"

# Step 7: Pre-pull K8s + Cilium images
log_section "Step 7/7: Pre-pulling container images"
log_info "Pulling kubeadm images..."
ssh_exec_sudo "$BUILD_IP" "kubeadm config images pull"

log_info "Pulling Cilium images..."
for img in "${CILIUM_IMAGES[@]}"; do
  log_info "  Pulling $img..."
  ssh_exec_sudo "$BUILD_IP" "ctr -n k8s.io images pull '$img'" || log_warn "  Failed to pull $img (non-fatal)"
done

# Leave a marker so install.sh knows this is a golden image
ssh_exec_sudo "$BUILD_IP" "echo 'k8s-golden:${K8S_VERSION}' > /etc/k8s-golden"

# Clean apt cache to reduce image size
ssh_exec_sudo "$BUILD_IP" "apt-get clean && rm -rf /var/lib/apt/lists/*"

# Stop build VM
log_section "Finalizing golden image"
tart stop "${GOLDEN_NAME}-build"
sleep 3

# Rename build VM to golden image
log_info "Saving as '$GOLDEN_NAME'..."
tart clone "${GOLDEN_NAME}-build" "$GOLDEN_NAME"
tart delete "${GOLDEN_NAME}-build"

log_section "Golden Image Ready!"
log_info "Image name: $GOLDEN_NAME"
log_info ""
log_info "사용 방법:"
log_info "  1. config/clusters.json에서 base_image를 'k8s-golden'으로 변경"
log_info "  2. ./scripts/install.sh 실행 (Phase 2~4 자동 스킵)"
log_info ""
log_info "재빌드하려면:"
log_info "  tart delete $GOLDEN_NAME"
log_info "  ./scripts/build-golden-image.sh"
