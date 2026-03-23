#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/k8s.sh"

log_section "Waiting for Kubernetes clusters to be ready"

for cluster_name in $(get_cluster_names); do
  log_info "Checking cluster: $cluster_name"

  master_name=$(get_master_for_cluster "$cluster_name")
  master_ip=$(vm_get_ip "$master_name")
  ssh_user="$(get_ssh_user)"

  # Check if current IP is in API server certificate SAN
  cert_has_ip=$(ssh_exec_sudo "$master_ip" \
    "openssl x509 -in /etc/kubernetes/pki/apiserver.crt -noout -text 2>/dev/null | grep -q 'IP Address:${master_ip}' && echo yes || echo no" || echo "no")

  if [[ "$cert_has_ip" != "yes" ]]; then
    log_info "Current IP $master_ip not in API server certificate. Regenerating certificates..."

    ssh_exec_sudo "$master_ip" "
      # Stop kubelet and move manifests out to prevent CrashLoop during update
      systemctl stop kubelet
      mkdir -p /tmp/k8s-manifests-backup
      mv /etc/kubernetes/manifests/*.yaml /tmp/k8s-manifests-backup/ 2>/dev/null || true
      sleep 3

      # Detect old IP from certificate
      OLD_IP=\$(openssl x509 -in /etc/kubernetes/pki/apiserver.crt -noout -text 2>/dev/null \
        | grep -oP 'IP Address:\K[0-9.]+' | grep -v '10\.' | head -1)

      # Remove old certificates (keep CA)
      rm -f /etc/kubernetes/pki/apiserver.crt /etc/kubernetes/pki/apiserver.key
      rm -f /etc/kubernetes/pki/apiserver-etcd-client.crt /etc/kubernetes/pki/apiserver-etcd-client.key
      rm -f /etc/kubernetes/pki/apiserver-kubelet-client.crt /etc/kubernetes/pki/apiserver-kubelet-client.key
      rm -f /etc/kubernetes/pki/etcd/server.crt /etc/kubernetes/pki/etcd/server.key
      rm -f /etc/kubernetes/pki/etcd/peer.crt /etc/kubernetes/pki/etcd/peer.key
      rm -f /etc/kubernetes/pki/etcd/healthcheck-client.crt /etc/kubernetes/pki/etcd/healthcheck-client.key
      rm -f /etc/kubernetes/pki/front-proxy-client.crt /etc/kubernetes/pki/front-proxy-client.key

      # Regenerate certificates with new IP
      kubeadm init phase certs apiserver --apiserver-advertise-address=${master_ip} --apiserver-cert-extra-sans=${master_ip}
      kubeadm init phase certs apiserver-kubelet-client
      kubeadm init phase certs apiserver-etcd-client
      kubeadm init phase certs etcd-server
      kubeadm init phase certs etcd-peer
      kubeadm init phase certs etcd-healthcheck-client
      kubeadm init phase certs front-proxy-client

      # Regenerate kubeconfig files with new IP
      rm -f /etc/kubernetes/admin.conf /etc/kubernetes/kubelet.conf /etc/kubernetes/controller-manager.conf /etc/kubernetes/scheduler.conf
      kubeadm init phase kubeconfig admin --apiserver-advertise-address=${master_ip}
      kubeadm init phase kubeconfig kubelet --apiserver-advertise-address=${master_ip}
      kubeadm init phase kubeconfig controller-manager --apiserver-advertise-address=${master_ip}
      kubeadm init phase kubeconfig scheduler --apiserver-advertise-address=${master_ip}

      # Update user kubeconfig
      cp /etc/kubernetes/admin.conf /home/${ssh_user}/.kube/config
      chown ${ssh_user}:${ssh_user} /home/${ssh_user}/.kube/config

      # Update IP in manifests and restore them
      for f in /tmp/k8s-manifests-backup/*.yaml; do
        [ -f \"\$f\" ] || continue
        if [ -n \"\$OLD_IP\" ]; then
          sed -i \"s|\$OLD_IP|${master_ip}|g\" \"\$f\"
        fi
      done
      mv /tmp/k8s-manifests-backup/*.yaml /etc/kubernetes/manifests/
      rmdir /tmp/k8s-manifests-backup 2>/dev/null || true
    " || true

    # Restart kubelet on all nodes (master picks up new certs, workers reconnect)
    for node_name in $(get_nodes_for_cluster "$cluster_name"); do
      node_ip=$(vm_get_ip "$node_name")
      log_info "Restarting kubelet on $node_name..."
      ssh_exec_sudo "$node_ip" "systemctl restart kubelet" || true
    done

    # Fetch fresh kubeconfig after cert regeneration
    log_info "Fetching new kubeconfig for $cluster_name..."
    mkdir -p "$(dirname "$(kubeconfig_for_cluster "$cluster_name")")"
    scp_from "$master_ip" ".kube/config" "$(kubeconfig_for_cluster "$cluster_name")"

  else
    log_info "Certificate SAN matches current IP ($master_ip). Skipping regeneration."

    # Only update local kubeconfig IP (no kubelet restart needed)
    local_kubeconfig="$(kubeconfig_for_cluster "$cluster_name")"
    if [[ -f "$local_kubeconfig" ]]; then
      sed -i '' "s|server: https://[0-9.]*:6443|server: https://${master_ip}:6443|" "$local_kubeconfig" 2>/dev/null || \
      sed -i "s|server: https://[0-9.]*:6443|server: https://${master_ip}:6443|" "$local_kubeconfig"
    else
      log_warn "Kubeconfig not found for $cluster_name, fetching from master..."
      scp_from "$master_ip" ".kube/config" "$local_kubeconfig"
    fi
  fi

  # Wait for API server
  wait_apiserver_ready "$cluster_name" 40

  # Uncordon any SchedulingDisabled nodes
  disabled_nodes=$(kubectl_cmd "$cluster_name" get nodes --no-headers 2>/dev/null | grep "SchedulingDisabled" | awk '{print $1}' || true)
  for node in $disabled_nodes; do
    log_info "Uncordoning node $node..."
    kubectl_cmd "$cluster_name" uncordon "$node" || true
  done

  wait_nodes_ready "$cluster_name" 60
done

log_info "All clusters are ready."
