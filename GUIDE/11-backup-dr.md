# 재연 가이드 11. 백업 & 재해 복구

이 문서는 Phase 15가 설치하는 etcd 백업과 Velero를 다룬다. 클러스터 상태를 보호하고 장애 시 복원하는 절차를 설명한다.


## 1. etcd 백업

### 1.1 개요

etcd는 Kubernetes 클러스터의 모든 상태(Pod, Deployment, ConfigMap, Secret 등)를 저장하는 분산 키-값 저장소이다. etcd가 손실되면 클러스터 전체가 무의미해진다.

Phase 15에서 모든 마스터 노드에 다음을 설정한다:
- `/opt/etcd-backup/backup.sh` — etcd 스냅샷 백업 스크립트
- 매일 02:00 자동 실행 (cron)
- 최근 5개 스냅샷만 보관 (자동 로테이션)

### 1.2 백업 아키텍처

```
┌─────────────────────────────────────────────────────┐
│  각 마스터 노드 (×4)                                 │
│                                                     │
│  cron (매일 02:00)                                  │
│       │                                             │
│       ▼                                             │
│  /opt/etcd-backup/backup.sh                         │
│       │                                             │
│       ├─ etcdctl snapshot save                      │
│       │   --endpoints=https://127.0.0.1:2379        │
│       │   --cacert=/etc/kubernetes/pki/etcd/ca.crt  │
│       │   --cert=/etc/kubernetes/pki/etcd/server.crt│
│       │   --key=/etc/kubernetes/pki/etcd/server.key │
│       │                                             │
│       ├─ etcdctl snapshot status (검증)             │
│       │                                             │
│       └─ 로테이션: 최근 5개만 보관                   │
│                                                     │
│  /opt/etcd-backup/                                  │
│   ├── etcd-snapshot-20260320-020000.db              │
│   ├── etcd-snapshot-20260319-020000.db              │
│   ├── etcd-snapshot-20260318-020000.db              │
│   ├── etcd-snapshot-20260317-020000.db              │
│   └── etcd-snapshot-20260316-020000.db              │
└─────────────────────────────────────────────────────┘
```

### 1.3 수동 백업 실행

```bash
# platform 마스터에서 백업 실행
ssh admin@$(tart ip platform-master) 'sudo /opt/etcd-backup/backup.sh'
```

예상 출력:

```
+----------+----------+------------+------------+
|   HASH   | REVISION |    TOTAL KEYS    | TOTAL SIZE |
+----------+----------+------------+------------+
| abcd1234 |   12345  |        850       |   3.2 MB   |
+----------+----------+------------+------------+
Backup completed: /opt/etcd-backup/etcd-snapshot-20260320-143000.db
```

### 1.4 백업 파일 확인

```bash
# 각 마스터의 백업 파일 목록 확인
for master in platform-master dev-master staging-master prod-master; do
  echo "=== $master ==="
  ssh admin@$(tart ip $master) 'ls -lh /opt/etcd-backup/etcd-snapshot-*.db 2>/dev/null || echo "  백업 없음"'
done
```

### 1.5 백업 로그 확인

```bash
ssh admin@$(tart ip platform-master) 'cat /var/log/etcd-backup.log'
```

### 1.6 etcd 복원 절차

> **주의**: etcd 복원은 클러스터를 특정 시점으로 되돌린다. 해당 시점 이후의 모든 변경사항이 손실된다.

```bash
# 1. 복원할 마스터에 SSH 접속
ssh admin@$(tart ip platform-master)

# 2. kube-apiserver 중지 (static pod manifest 이동)
sudo mv /etc/kubernetes/manifests/kube-apiserver.yaml /tmp/

# 3. etcd 중지
sudo mv /etc/kubernetes/manifests/etcd.yaml /tmp/

# 4. 기존 etcd 데이터 백업
sudo mv /var/lib/etcd /var/lib/etcd.bak

# 5. 스냅샷에서 복원
sudo ETCDCTL_API=3 etcdctl snapshot restore \
  /opt/etcd-backup/etcd-snapshot-20260320-020000.db \
  --data-dir=/var/lib/etcd

# 6. etcd + apiserver 재시작 (manifest 복원)
sudo mv /tmp/etcd.yaml /etc/kubernetes/manifests/
sudo mv /tmp/kube-apiserver.yaml /etc/kubernetes/manifests/

# 7. 클러스터 상태 확인 (1-2분 대기)
exit
kubectl --kubeconfig kubeconfig/platform.yaml get nodes
```


## 2. Velero — K8s 리소스 백업

### 2.1 개요

Velero는 Kubernetes 리소스(YAML 정의)와 Persistent Volume 데이터를 백업/복원한다. etcd 스냅샷이 전체 클러스터 복원용이라면, Velero는 네임스페이스 단위의 세밀한 복원이 가능하다.

Phase 15에서 platform 클러스터에 Velero를 설치한다.

### 2.2 백업 스케줄

| 스케줄 | 주기 | 대상 | 보관 기간 |
|--------|------|------|-----------|
| `daily-full-backup` | 매일 03:00 | demo, monitoring, jenkins, argocd | 7일 |
| `hourly-demo-backup` | 매시간 | demo | 24시간 |

### 2.3 Velero 상태 확인

```bash
export KUBECONFIG=kubeconfig/platform.yaml

# Velero Pod 상태
kubectl get pods -n velero

# 스케줄 목록
kubectl get schedules -n velero

# 백업 목록
kubectl get backups -n velero
```

### 2.4 수동 백업

```bash
# demo 네임스페이스 백업
kubectl -n velero create -f - <<EOF
apiVersion: velero.io/v1
kind: Backup
metadata:
  name: manual-demo-backup-$(date +%Y%m%d%H%M)
  namespace: velero
spec:
  includedNamespaces:
    - demo
  ttl: 72h0m0s
EOF

# 백업 상태 확인
kubectl get backup -n velero --sort-by=.metadata.creationTimestamp
```

### 2.5 Velero 복원

```bash
# 백업 목록에서 복원할 백업 선택
kubectl get backups -n velero

# 복원 실행
kubectl -n velero create -f - <<EOF
apiVersion: velero.io/v1
kind: Restore
metadata:
  name: restore-demo-$(date +%Y%m%d%H%M)
  namespace: velero
spec:
  backupName: manual-demo-backup-20260320
  includedNamespaces:
    - demo
EOF

# 복원 상태 확인
kubectl get restore -n velero
```


## 3. 백업 전략 요약

```
┌───────────────────────────────────────────────────────────┐
│                    백업 계층 (Defense in Depth)             │
│                                                           │
│  Layer 1: etcd 스냅샷                                     │
│  ├── 범위: 전체 클러스터 상태                              │
│  ├── 주기: 매일 02:00 (모든 마스터)                        │
│  ├── 보관: 최근 5개                                       │
│  └── 복원: 클러스터 전체 시점 복원                         │
│                                                           │
│  Layer 2: Velero 리소스 백업                               │
│  ├── 범위: 네임스페이스 단위 (demo, monitoring 등)         │
│  ├── 주기: 일간(전체) + 시간별(demo)                      │
│  ├── 보관: 7일(전체) / 24시간(demo)                       │
│  └── 복원: 네임스페이스 단위 세밀한 복원                   │
│                                                           │
│  Layer 3: GitOps (ArgoCD)                                 │
│  ├── 범위: 매니페스트 정의                                 │
│  ├── 주기: Git push 시 자동                               │
│  └── 복원: Git 리포지토리에서 자동 재동기화                │
└───────────────────────────────────────────────────────────┘
```

| 장애 유형 | 복원 방법 |
|-----------|-----------|
| Pod/Deployment 삭제 | ArgoCD 자동 복구 (selfHeal: true) |
| 네임스페이스 삭제 | Velero restore |
| etcd 손상 | etcd snapshot restore |
| 마스터 노드 전체 장애 | etcd snapshot restore + kubeadm |
| 전체 인프라 재구축 | `demo.sh` (전체 자동화) |
