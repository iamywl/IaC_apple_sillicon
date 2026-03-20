#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/k8s.sh"
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/ssh.sh"
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/vm.sh"

log_section "Phase 15: Setting up etcd Backup & Disaster Recovery"

BACKUP_DIR="$PROJECT_ROOT/backups"
mkdir -p "$BACKUP_DIR"

# ──────────────────────────────────────────────
# Part 1: Install Velero on platform cluster
# ──────────────────────────────────────────────
CLUSTER="platform"
log_info "Installing Velero on '$CLUSTER' (local backup provider)..."

helm repo add vmware-tanzu https://vmware-tanzu.github.io/helm-charts 2>/dev/null || true
helm repo update

kubectl_cmd "$CLUSTER" create namespace velero 2>/dev/null || true

helm upgrade --install velero vmware-tanzu/velero \
  --kubeconfig "$(kubeconfig_for_cluster "$CLUSTER")" \
  --namespace velero \
  --values "$PROJECT_ROOT/manifests/velero-values.yaml" \
  --wait --timeout 5m

log_info "Velero installed on '$CLUSTER'."

# ──────────────────────────────────────────────
# Part 2: Setup etcd backup CronJob on each master
# ──────────────────────────────────────────────
for cluster_name in $(get_cluster_names); do
  master_node=$(get_master_for_cluster "$cluster_name")
  master_ip=$(vm_get_ip "$master_node")

  log_info "Setting up etcd backup script on $master_node ($master_ip)..."

  # Create backup directory on master
  ssh_exec_sudo "$master_ip" "mkdir -p /opt/etcd-backup"

  # Deploy etcd backup script
  ssh_exec_sudo "$master_ip" "cat > /opt/etcd-backup/backup.sh << 'SCRIPT'
#!/bin/bash
set -euo pipefail
BACKUP_DIR=/opt/etcd-backup
TIMESTAMP=\$(date +%Y%m%d-%H%M%S)
BACKUP_FILE=\$BACKUP_DIR/etcd-snapshot-\$TIMESTAMP.db

# etcd backup using etcdctl
ETCDCTL_API=3 etcdctl snapshot save \$BACKUP_FILE \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key

# Verify snapshot
ETCDCTL_API=3 etcdctl snapshot status \$BACKUP_FILE --write-out=table

# Rotate: keep last 5 backups
ls -t \$BACKUP_DIR/etcd-snapshot-*.db 2>/dev/null | tail -n +6 | xargs -r rm -f

echo \"Backup completed: \$BACKUP_FILE\"
SCRIPT"

  ssh_exec_sudo "$master_ip" "chmod +x /opt/etcd-backup/backup.sh"

  # Setup cron job for daily backup at 2am
  ssh_exec_sudo "$master_ip" "echo '0 2 * * * root /opt/etcd-backup/backup.sh >> /var/log/etcd-backup.log 2>&1' > /etc/cron.d/etcd-backup"
  ssh_exec_sudo "$master_ip" "chmod 644 /etc/cron.d/etcd-backup"

  # Run initial backup
  log_info "Running initial etcd backup on $master_node..."
  ssh_exec_sudo "$master_ip" "/opt/etcd-backup/backup.sh" || log_warn "Initial backup may have failed (etcdctl might not be installed yet)"

  log_info "etcd backup configured on $master_node"
done

# ──────────────────────────────────────────────
# Part 3: Apply backup-related K8s manifests
# ──────────────────────────────────────────────
log_info "Applying backup schedule manifests..."
kubectl_cmd "platform" apply -f "$PROJECT_ROOT/manifests/backup/velero-schedule.yaml" 2>/dev/null || true

log_info ""
log_info "Backup setup complete."
log_info "etcd backup: Daily at 02:00 on each master node (/opt/etcd-backup/)"
log_info "Velero: Installed on platform cluster for K8s resource backup"
log_info ""
log_info "Manual etcd backup:"
log_info "  ssh admin@<master-ip> 'sudo /opt/etcd-backup/backup.sh'"
log_info ""
log_info "Restore etcd from snapshot:"
log_info "  ssh admin@<master-ip> 'sudo ETCDCTL_API=3 etcdctl snapshot restore /opt/etcd-backup/etcd-snapshot-<timestamp>.db --data-dir=/var/lib/etcd-restore'"
log_info ""
log_info "Velero backup:"
log_info "  velero backup create my-backup --kubeconfig kubeconfig/platform.yaml"
log_info "  velero restore create --from-backup my-backup --kubeconfig kubeconfig/platform.yaml"
log_info "Phase 15 complete."
