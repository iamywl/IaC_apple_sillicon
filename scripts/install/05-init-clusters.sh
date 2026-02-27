#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/k8s.sh"

log_section "Phase 5: Initializing Kubernetes Clusters"

for cluster_name in $(get_cluster_names); do
  init_cluster "$cluster_name"
done

log_info "All clusters initialized."
