# CKA Day 4: etcd & 업그레이드 시험 문제 심화

> CKA 도메인: Cluster Architecture (25%) - Part 2 심화 | 예상 소요 시간: 2시간

---

### 문제 5. cordon과 uncordon [4%]

**컨텍스트:** `kubectl config use-context staging`

1. `staging-worker1` 노드를 스케줄링 불가로 설정하라 (기존 Pod는 유지)
2. 새 Pod `test-pod`(이미지: nginx)를 생성하고 어느 노드에 배치되는지 확인하라
3. `staging-worker1` 노드를 다시 스케줄링 가능으로 복원하라

<details>
<summary>풀이 과정</summary>

```bash
kubectl config use-context staging

# 1. cordon (스케줄링만 차단, 기존 Pod 유지)
kubectl cordon staging-worker1
kubectl get nodes
# staging-worker1: Ready,SchedulingDisabled

# 2. 새 Pod 생성
kubectl run test-pod --image=nginx
kubectl get pod test-pod -o wide
# staging-worker1에는 배치되지 않음 (SchedulingDisabled이므로)

# 3. uncordon (스케줄링 재개)
kubectl uncordon staging-worker1
kubectl get nodes
# staging-worker1: Ready

# 정리
kubectl delete pod test-pod
```

</details>

---

### 문제 6. Control Plane 업그레이드 [7%]

**컨텍스트:** `kubectl config use-context staging`

`staging-master` 노드의 쿠버네티스를 v1.30.x에서 v1.31.0으로 업그레이드하라. kubeadm, kubelet, kubectl을 모두 업그레이드하라.

<details>
<summary>풀이 과정</summary>

```bash
# 현재 버전 확인
kubectl config use-context staging
kubectl get nodes

# SSH 접속
ssh admin@<staging-master-ip>

# 1. kubeadm 업그레이드
sudo apt-mark unhold kubeadm
sudo apt-get update
sudo apt-get install -y kubeadm=1.31.0-1.1
sudo apt-mark hold kubeadm

# 2. 업그레이드 계획 확인
sudo kubeadm upgrade plan

# 3. Control Plane 컴포넌트 업그레이드
sudo kubeadm upgrade apply v1.31.0

# 4. 노드 drain (다른 터미널에서)
exit
kubectl drain staging-master --ignore-daemonsets --delete-emptydir-data

# 5. kubelet, kubectl 업그레이드
ssh admin@<staging-master-ip>
sudo apt-mark unhold kubelet kubectl
sudo apt-get install -y kubelet=1.31.0-1.1 kubectl=1.31.0-1.1
sudo apt-mark hold kubelet kubectl

# 6. kubelet 재시작
sudo systemctl daemon-reload
sudo systemctl restart kubelet

# 7. uncordon
exit
kubectl uncordon staging-master

# 8. 확인
kubectl get nodes
# staging-master: v1.31.0
```

</details>

---

### 문제 7. Worker Node 업그레이드 [7%]

**컨텍스트:** `kubectl config use-context staging`

`staging-worker1` 노드를 `staging-master`와 동일한 버전(v1.31.0)으로 업그레이드하라.

<details>
<summary>풀이 과정</summary>

```bash
kubectl config use-context staging

# 1. drain
kubectl drain staging-worker1 --ignore-daemonsets --delete-emptydir-data

# 2. SSH 접속
ssh admin@<staging-worker1-ip>

# 3. kubeadm 업그레이드
sudo apt-mark unhold kubeadm
sudo apt-get update
sudo apt-get install -y kubeadm=1.31.0-1.1
sudo apt-mark hold kubeadm

# 4. 노드 설정 업그레이드 (apply가 아닌 node!)
sudo kubeadm upgrade node

# 5. kubelet, kubectl 업그레이드
sudo apt-mark unhold kubelet kubectl
sudo apt-get install -y kubelet=1.31.0-1.1 kubectl=1.31.0-1.1
sudo apt-mark hold kubelet kubectl

# 6. 재시작
sudo systemctl daemon-reload
sudo systemctl restart kubelet

# 7. uncordon
exit
kubectl uncordon staging-worker1

# 8. 확인
kubectl get nodes
```

**핵심:** Worker Node에서는 `kubeadm upgrade node` (apply가 아님!)

</details>

---

### 문제 8. etcd 멤버 상태 확인 [4%]

**컨텍스트:** `kubectl config use-context platform`

etcd 클러스터의 멤버 상태와 엔드포인트 건강 상태를 확인하여 `/tmp/etcd-health.txt`에 저장하라.

<details>
<summary>풀이 과정</summary>

```bash
ssh admin@<platform-master-ip>

# 멤버 목록
sudo ETCDCTL_API=3 etcdctl member list \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key \
  --write-out=table > /tmp/etcd-health.txt

# 건강 상태
sudo ETCDCTL_API=3 etcdctl endpoint health \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key >> /tmp/etcd-health.txt

cat /tmp/etcd-health.txt
exit
```

</details>

---

### 문제 9. 업그레이드 사전 확인 [4%]

**컨텍스트:** `kubectl config use-context staging`

다음 작업을 수행하라:
1. 현재 클러스터의 모든 노드 버전을 확인하라
2. `kubeadm upgrade plan`의 결과를 `/tmp/upgrade-plan.txt`에 저장하라
3. drain을 시뮬레이션(dry-run)하라

<details>
<summary>풀이 과정</summary>

```bash
kubectl config use-context staging

# 1. 노드 버전 확인
kubectl get nodes -o wide

# 2. 업그레이드 계획
ssh admin@<staging-master-ip>
sudo kubeadm upgrade plan > /tmp/upgrade-plan.txt 2>&1
cat /tmp/upgrade-plan.txt

# 3. drain 시뮬레이션
exit
kubectl drain staging-master --ignore-daemonsets --delete-emptydir-data --dry-run=client
```

</details>

---

### 문제 10. etcd 데이터 디렉터리 확인 [4%]

**컨텍스트:** `kubectl config use-context platform`

etcd의 데이터 디렉터리 경로와 사용 중인 디스크 공간을 확인하여 `/tmp/etcd-storage.txt`에 저장하라.

<details>
<summary>풀이 과정</summary>

```bash
# etcd 데이터 디렉터리 확인
kubectl -n kube-system get pod etcd-platform-master -o yaml | \
  grep "\-\-data-dir" > /tmp/etcd-storage.txt

# SSH 접속하여 디스크 사용량 확인
ssh admin@<platform-master-ip>
sudo du -sh /var/lib/etcd >> /tmp/etcd-storage.txt
cat /tmp/etcd-storage.txt
exit
```

</details>

---

### 문제 11. 인증서 갱신 확인 [4%]

**컨텍스트:** `kubectl config use-context platform`

모든 쿠버네티스 인증서의 만료일을 확인하고, 만료까지 30일 이내인 인증서가 있는지 확인하라.

<details>
<summary>풀이 과정</summary>

```bash
ssh admin@<platform-master-ip>

# 모든 인증서 만료일 확인
sudo kubeadm certs check-expiration

# 개별 인증서 확인
for cert in /etc/kubernetes/pki/*.crt; do
  echo "=== $cert ==="
  sudo openssl x509 -in $cert -noout -enddate
done

exit
```

</details>

---

### 문제 12. drain 실패 시 해결 [7%]

**컨텍스트:** `kubectl config use-context dev`

`dev-worker1` 노드를 drain하려고 했으나 실패한다. 원인을 파악하고 해결하라.

<details>
<summary>풀이 과정</summary>

```bash
kubectl config use-context dev

# drain 시도
kubectl drain dev-worker1 --ignore-daemonsets
# 오류 발생 가능:
# "cannot delete Pods with local storage" → --delete-emptydir-data 추가
# "cannot delete Pods not managed by ReplicationController, ReplicaSet, Job, DaemonSet or StatefulSet" → --force 추가

# 해결: 필요한 옵션 추가
kubectl drain dev-worker1 --ignore-daemonsets --delete-emptydir-data --force

# 또는 문제 Pod를 먼저 확인
kubectl get pods -A -o wide | grep dev-worker1

# 확인
kubectl get nodes

# 복원
kubectl uncordon dev-worker1
```

**일반적인 drain 실패 원인:**
1. 단독 Pod (ReplicaSet 없음) → `--force` 필요
2. emptyDir 사용 Pod → `--delete-emptydir-data` 필요
3. DaemonSet Pod → `--ignore-daemonsets` 필요
4. PDB(PodDisruptionBudget) 제한 → PDB 확인/수정

</details>

---

## 8. 추가 YAML 예제

### 8.1 etcd 백업 CronJob

```yaml
# 자동 etcd 백업을 위한 CronJob
apiVersion: batch/v1
kind: CronJob
metadata:
  name: etcd-backup
  namespace: kube-system
spec:
  schedule: "0 */6 * * *"                # 매 6시간마다 실행
  concurrencyPolicy: Forbid               # 이전 Job 실행 중이면 새 Job 생성 안 함
  successfulJobsHistoryLimit: 3            # 성공 Job 이력 3개 보존
  failedJobsHistoryLimit: 1               # 실패 Job 이력 1개 보존
  jobTemplate:
    spec:
      template:
        spec:
          hostNetwork: true                # 호스트 네트워크 사용 (etcd 접속용)
          containers:
          - name: backup
            image: registry.k8s.io/etcd:3.5.15-0
            command:
            - /bin/sh
            - -c
            - |
              ETCDCTL_API=3 etcdctl snapshot save /backup/etcd-$(date +%Y%m%d-%H%M%S).db \
                --endpoints=https://127.0.0.1:2379 \
                --cacert=/etc/kubernetes/pki/etcd/ca.crt \
                --cert=/etc/kubernetes/pki/etcd/server.crt \
                --key=/etc/kubernetes/pki/etcd/server.key
            volumeMounts:
            - name: etcd-certs
              mountPath: /etc/kubernetes/pki/etcd
              readOnly: true
            - name: backup-dir
              mountPath: /backup
          restartPolicy: OnFailure
          nodeSelector:
            node-role.kubernetes.io/control-plane: ""    # Control Plane 노드에서만 실행
          tolerations:
          - key: node-role.kubernetes.io/control-plane
            operator: Exists
            effect: NoSchedule
          volumes:
          - name: etcd-certs
            hostPath:
              path: /etc/kubernetes/pki/etcd
          - name: backup-dir
            hostPath:
              path: /opt/etcd-backups
              type: DirectoryOrCreate
```

### 8.2 PodDisruptionBudget (PDB) 예제

```yaml
# drain 시 최소 가용 Pod 수를 보장하는 PDB
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: web-app-pdb
  namespace: default
spec:
  minAvailable: 2                          # 최소 2개 Pod는 항상 가용해야 함
  # 또는: maxUnavailable: 1               # 최대 1개만 동시에 불가용 허용
  selector:
    matchLabels:
      app: web-app                         # 이 라벨을 가진 Pod에 적용
```

### 8.3 drain 시 안전한 Deployment 설정

```yaml
# drain에 안전한 Deployment 설정 예제
apiVersion: apps/v1
kind: Deployment
metadata:
  name: safe-app
spec:
  replicas: 3
  selector:
    matchLabels:
      app: safe-app
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0                    # 업데이트 중에도 항상 3개 유지
  template:
    metadata:
      labels:
        app: safe-app
    spec:
      # Pod Anti-Affinity: 같은 노드에 배치되지 않도록
      affinity:
        podAntiAffinity:
          preferredDuringSchedulingIgnoredDuringExecution:
          - weight: 100
            podAffinityTerm:
              labelSelector:
                matchExpressions:
                - key: app
                  operator: In
                  values:
                  - safe-app
              topologyKey: kubernetes.io/hostname
      containers:
      - name: app
        image: nginx:1.24
        resources:
          requests:
            cpu: "100m"
            memory: "128Mi"
          limits:
            cpu: "200m"
            memory: "256Mi"
        readinessProbe:
          httpGet:
            path: /
            port: 80
          initialDelaySeconds: 5
          periodSeconds: 5
```

---

## 9. 복습 체크리스트

### 개념 확인

- [ ] etcdctl snapshot save에 필요한 4개 옵션을 암기했는가?
- [ ] snapshot save는 인증서 필요, restore는 불필요한 이유를 설명할 수 있는가?
- [ ] etcd 복구 후 매니페스트에서 수정해야 할 부분을 정확히 알고 있는가?
- [ ] drain과 cordon의 차이를 설명할 수 있는가?
- [ ] Control Plane과 Worker Node 업그레이드의 차이(apply vs node)를 알고 있는가?
- [ ] 업그레이드 순서(kubeadm → upgrade plan/apply → drain → kubelet → restart → uncordon)를 외웠는가?

### 시험 팁

1. **etcd 인증서 경로** -- 기억나지 않으면 etcd Pod의 yaml에서 확인한다
2. **snapshot restore** -- 인증서 불필요, `--data-dir`만 지정한다
3. **매니페스트 수정** -- `hostPath.path`를 새 데이터 디렉터리로 변경한다
4. **업그레이드 순서** -- kubeadm 먼저 → upgrade plan/apply → drain → kubelet → restart → uncordon
5. **Worker Node** -- `kubeadm upgrade node` (apply가 아님!)
6. **drain 옵션** -- `--ignore-daemonsets --delete-emptydir-data`는 거의 항상 필요하다
7. **시간 절약** -- `sed` 명령으로 매니페스트를 빠르게 수정한다

---

## 내일 예고

**Day 5: RBAC & 인증서 관리** -- Role, ClusterRole, Binding 구조와 kubeconfig 수동 생성, CSR 처리를 실습한다. kubectl create role/rolebinding 명령을 반드시 외워오자.

---

## tart-infra 실습

### 실습 환경 설정

```bash
# platform 클러스터에 접속 (etcd가 실행 중인 클러스터)
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/platform.yaml
kubectl get nodes
```

**예상 출력:**
```
NAME               STATUS   ROLES           AGE   VERSION
platform-master    Ready    control-plane   30d   v1.31.0
platform-worker1   Ready    <none>          30d   v1.31.0
platform-worker2   Ready    <none>          30d   v1.31.0
```

### 실습 1: etcd Pod 상태 및 인증서 경로 확인

```bash
# etcd Static Pod 확인
kubectl get pod etcd-platform-master -n kube-system -o yaml | grep -A5 "command:"
```

**예상 출력 (주요 부분):**
```yaml
    - --cert-file=/etc/kubernetes/pki/etcd/server.crt
    - --key-file=/etc/kubernetes/pki/etcd/server.key
    - --trusted-ca-file=/etc/kubernetes/pki/etcd/ca.crt
    - --peer-cert-file=/etc/kubernetes/pki/etcd/peer.crt
    - --data-dir=/var/lib/etcd
```

**동작 원리:** etcd 인증서 경로를 확인하는 이유:
1. `etcdctl snapshot save` 명령에는 `--cacert`, `--cert`, `--key` 3개 인증서 옵션이 필요하다
2. 이 경로들은 etcd Pod의 매니페스트(`/etc/kubernetes/manifests/etcd.yaml`)에서도 확인 가능하다
3. CKA 시험에서 etcd 백업 문제가 나오면 먼저 이 경로를 확인해야 한다

### 실습 2: etcd 스냅샷 백업 시뮬레이션

```bash
# etcd 엔드포인트 health 확인 (SSH로 master 노드 접속 후)
# tart ssh platform-master
# ETCDCTL_API=3 etcdctl endpoint health \
#   --endpoints=https://127.0.0.1:2379 \
#   --cacert=/etc/kubernetes/pki/etcd/ca.crt \
#   --cert=/etc/kubernetes/pki/etcd/server.crt \
#   --key=/etc/kubernetes/pki/etcd/server.key
```

**예상 출력:**
```
https://127.0.0.1:2379 is healthy: successfully committed proposal: took = 12.345ms
```

**동작 원리:** etcd snapshot 백업 과정:
1. `etcdctl`이 TLS 인증서로 etcd에 gRPC 연결을 맺는다
2. `snapshot save`는 etcd의 boltdb 데이터를 파일로 복사한다
3. 백업 파일에는 모든 K8s 오브젝트(Pod, Service, Secret 등)의 상태가 저장된다
4. 복구 시 `--data-dir`로 새 디렉터리를 지정하고, etcd 매니페스트의 `hostPath`를 수정한다

### 실습 3: 클러스터 버전 확인 및 업그레이드 계획

```bash
# 현재 클러스터 버전 확인
kubectl version --short 2>/dev/null || kubectl version
```

**예상 출력:**
```
Client Version: v1.31.0
Server Version: v1.31.0
```

```bash
# kubeadm 업그레이드 가능 버전 확인 (SSH로 master 노드 접속 후)
# tart ssh platform-master
# sudo kubeadm upgrade plan
```

**동작 원리:** kubeadm upgrade 절차:
1. `kubeadm upgrade plan`: 현재 버전과 업그레이드 가능한 버전을 비교한다
2. `kubeadm upgrade apply v1.x.y`: Control Plane 컴포넌트(API Server, CM, Scheduler, etcd)를 업그레이드한다
3. `kubectl drain <node>`: 워크로드를 안전하게 퇴거시킨다
4. kubelet/kubectl 패키지 업그레이드 → `systemctl restart kubelet`
5. `kubectl uncordon <node>`: 노드를 다시 스케줄 가능 상태로 전환한다

### 실습 4: drain/cordon 동작 확인

```bash
# 노드 상태 확인 (SchedulingDisabled 여부)
kubectl get nodes

# cordon 테스트 (노드를 스케줄 불가 상태로 변경)
kubectl cordon platform-worker2
kubectl get nodes
```

**예상 출력:**
```
NAME               STATUS                     ROLES           AGE   VERSION
platform-master    Ready                      control-plane   30d   v1.31.0
platform-worker1   Ready                      <none>          30d   v1.31.0
platform-worker2   Ready,SchedulingDisabled   <none>          30d   v1.31.0
```

**동작 원리:** `kubectl cordon`은 노드에 `node.kubernetes.io/unschedulable` taint를 추가한다:
1. 새로운 Pod가 이 노드에 스케줄되지 않는다
2. 기존에 실행 중인 Pod는 영향을 받지 않는다
3. `kubectl drain`은 cordon + 기존 Pod 퇴거(eviction)를 함께 수행한다
4. 작업 후 반드시 `kubectl uncordon platform-worker2`로 복원한다

```bash
# 반드시 uncordon으로 복원!
kubectl uncordon platform-worker2
```

---

## 추가 심화 학습: etcd 내부 구조와 Raft 합의 알고리즘

### etcd의 데이터 저장 구조 (Key-Value 계층)

```
etcd 내부 구조 (계층적 키-값 네임스페이스)
══════════════════════════════════════════

/registry/                          ← etcd의 루트 디렉터리
├── pods/
│   ├── default/                    ← 네임스페이스
│   │   ├── nginx-pod               ← Pod 오브젝트의 전체 JSON
│   │   └── web-app
│   └── kube-system/
│       ├── coredns-xxxx
│       └── kube-proxy-xxxx
├── services/
│   ├── default/
│   │   └── kubernetes              ← default/kubernetes 서비스
│   └── kube-system/
│       └── kube-dns
├── deployments/
│   └── default/
│       └── nginx-deployment
├── secrets/
│   └── default/
│       └── my-secret               ← Secret 데이터 (Base64 인코딩)
├── configmaps/
│   └── default/
│       └── my-config
└── events/                         ← 이벤트 (기본 1시간 유지)
    └── default/
        └── nginx-pod.xxxxx

핵심: API Server만 etcd에 직접 접근한다!
       kubectl → API Server → etcd (직접 접근 불가)
```

### Raft 합의 알고리즘 상세 설명

```
Raft 합의 과정 (Leader-Follower 복제 프로토콜)
═══════════════════════════════════

3노드 etcd 클러스터:
  Node A (Leader)     Node B (Follower)     Node C (Follower)
      │                    │                      │
      │── "Pod 생성" ────►│                      │
      │── "Pod 생성" ────────────────────────────►│
      │                    │                      │
      │◄── "동의" ────────│                      │
      │◄── "동의" ────────────────────────────────│
      │                    │                      │
      │   2/3 동의 → 커밋!                        │
      │── "커밋 확정" ───►│                      │
      │── "커밋 확정" ──────────────────────────►│

핵심 규칙:
  - Leader가 모든 쓰기 요청을 처리한다
  - 과반수(Quorum)의 동의가 있어야 데이터를 커밋한다
  - 3노드: 1노드 장애까지 허용 (2/3 = 과반수)
  - 5노드: 2노드 장애까지 허용 (3/5 = 과반수)
  - 짝수 노드는 비추천 (4노드 = 3노드와 동일한 내결함성)
```

### etcdctl 고급 명령어 YAML 예제

```yaml
# etcd 클러스터 상태 확인을 위한 스크립트
# etcd-health-check.sh

# ── etcd 엔드포인트 상태 확인 ──
# ETCDCTL_API=3: etcd v3 API를 사용한다 (v2는 deprecated)
# --endpoints: etcd 서버 주소 (기본 2379 포트)
# --cacert: etcd CA 인증서 경로
# --cert: etcd 클라이언트 인증서
# --key: etcd 클라이언트 키

# etcd 멤버 목록 확인
# ETCDCTL_API=3 etcdctl member list \
#   --endpoints=https://127.0.0.1:2379 \
#   --cacert=/etc/kubernetes/pki/etcd/ca.crt \
#   --cert=/etc/kubernetes/pki/etcd/server.crt \
#   --key=/etc/kubernetes/pki/etcd/server.key \
#   --write-out=table

# etcd 엔드포인트 건강 상태 확인
# ETCDCTL_API=3 etcdctl endpoint health \
#   --endpoints=https://127.0.0.1:2379 \
#   --cacert=/etc/kubernetes/pki/etcd/ca.crt \
#   --cert=/etc/kubernetes/pki/etcd/server.crt \
#   --key=/etc/kubernetes/pki/etcd/server.key

# etcd 엔드포인트 상세 상태 (Leader 확인)
# ETCDCTL_API=3 etcdctl endpoint status \
#   --endpoints=https://127.0.0.1:2379 \
#   --cacert=/etc/kubernetes/pki/etcd/ca.crt \
#   --cert=/etc/kubernetes/pki/etcd/server.crt \
#   --key=/etc/kubernetes/pki/etcd/server.key \
#   --write-out=table
```

### 연습 문제: etcd 백업/복구 시나리오

**문제 1:** etcd 스냅샷을 `/opt/etcd-backup.db`에 저장하시오.

```bash
# 정답:
ETCDCTL_API=3 etcdctl snapshot save /opt/etcd-backup.db \
  --endpoints=https://127.0.0.1:2379 \        # etcd 서버 주소
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \   # CA 인증서 (신뢰 확인)
  --cert=/etc/kubernetes/pki/etcd/server.crt \ # 클라이언트 인증서
  --key=/etc/kubernetes/pki/etcd/server.key    # 클라이언트 키

# 스냅샷 상태 확인
ETCDCTL_API=3 etcdctl snapshot status /opt/etcd-backup.db --write-out=table
```

**동작 원리:** 각 플래그가 하는 역할:
1. `--endpoints`: etcd의 gRPC 서버에 연결할 주소. Static Pod 매니페스트의 `--listen-client-urls`와 일치해야 한다
2. `--cacert`: TLS 통신에서 서버를 신뢰할 수 있는지 확인하는 CA 인증서
3. `--cert`, `--key`: 클라이언트가 자신을 증명하는 인증서와 개인 키 (mTLS)
4. 이 세 가지 인증서 경로는 `/etc/kubernetes/manifests/etcd.yaml`에서 확인할 수 있다

**문제 2:** 위에서 저장한 스냅샷으로 etcd를 `/var/lib/etcd-restored`에 복구하시오.

```bash
# Step 1: 스냅샷 복구 (새 데이터 디렉터리에 복원)
ETCDCTL_API=3 etcdctl snapshot restore /opt/etcd-backup.db \
  --data-dir=/var/lib/etcd-restored   # 기존 디렉터리가 아닌 새 디렉터리

# Step 2: etcd Static Pod 매니페스트 수정
# /etc/kubernetes/manifests/etcd.yaml 에서 hostPath를 변경:
```

```yaml
# 수정 전
# spec.volumes에서 etcd-data의 hostPath:
volumes:
  - hostPath:
      path: /var/lib/etcd       # ← 기존 경로
      type: DirectoryOrCreate
    name: etcd-data

# 수정 후
volumes:
  - hostPath:
      path: /var/lib/etcd-restored   # ← 복구된 경로로 변경!
      type: DirectoryOrCreate
    name: etcd-data
```

**동작 원리:** 복구 절차에서 주의할 점:
1. `snapshot restore`는 기존 데이터를 덮어쓰지 않고 새 디렉터리에 복원한다
2. 반드시 etcd Static Pod의 `hostPath`를 새 디렉터리로 변경해야 한다
3. kubelet이 매니페스트 변경을 감지하면 etcd Pod를 자동 재시작한다
4. 복구 후 모든 K8s 오브젝트가 스냅샷 시점의 상태로 돌아간다

**문제 3:** `kubeadm upgrade`로 Control Plane을 v1.31.0에서 v1.32.0으로 업그레이드하시오.

```bash
# Step 1: 업그레이드 가능한 버전 확인
sudo kubeadm upgrade plan

# Step 2: kubeadm 패키지 업그레이드 (Ubuntu/Debian)
sudo apt-mark unhold kubeadm                          # hold 해제
sudo apt-get update && sudo apt-get install -y kubeadm=1.32.0-*  # 설치
sudo apt-mark hold kubeadm                            # 다시 hold

# Step 3: Control Plane 업그레이드 적용
sudo kubeadm upgrade apply v1.32.0

# Step 4: 노드 drain (워크로드 안전 퇴거)
kubectl drain <node-name> --ignore-daemonsets --delete-emptydir-data

# Step 5: kubelet, kubectl 업그레이드
sudo apt-mark unhold kubelet kubectl
sudo apt-get update && sudo apt-get install -y kubelet=1.32.0-* kubectl=1.32.0-*
sudo apt-mark hold kubelet kubectl

# Step 6: kubelet 재시작
sudo systemctl daemon-reload
sudo systemctl restart kubelet

# Step 7: uncordon (스케줄링 복원)
kubectl uncordon <node-name>
```

**동작 원리:** 업그레이드 순서가 중요한 이유:
1. kubeadm을 먼저 업그레이드 → 새 버전의 업그레이드 로직이 필요하기 때문
2. Control Plane을 먼저 → API Server가 이전 버전 kubelet과 호환 가능 (N-1 버전까지)
3. Worker Node는 하나씩 → 서비스 중단을 최소화하기 위해 rolling 방식
4. drain → upgrade → uncordon 패턴을 반드시 지킨다

### kubeadm upgrade 시 발생할 수 있는 트러블슈팅

```
문제 상황과 해결 방법
═══════════════════

문제 1: "unable to upgrade, etcd is unhealthy"
  원인: etcd Pod가 비정상 상태
  해결: crictl ps | grep etcd 로 etcd 컨테이너 상태 확인
        crictl logs <etcd-container-id> 로 에러 확인

문제 2: "connection to API Server was refused"
  원인: API Server가 업그레이드 중 일시 정지
  해결: 1-2분 대기 후 재시도 (Static Pod 재시작 중)

문제 3: drain 실패 - "cannot delete pod with local data"
  원인: emptyDir 볼륨이 있는 Pod
  해결: --delete-emptydir-data 플래그 추가

문제 4: drain 실패 - "DaemonSet-managed pod"
  원인: DaemonSet Pod는 drain 대상이 아님
  해결: --ignore-daemonsets 플래그 추가

문제 5: drain 실패 - "pod not managed by controller"
  원인: ReplicaSet/Deployment 없이 직접 생성된 Pod
  해결: --force 플래그 (단, 이 Pod는 삭제되고 복구 안 됨!)
```

### CKA 시험 팁: etcd 백업/복구 빠른 풀이 전략

```
시험 시간 절약 전략
══════════════════

1. etcd 인증서 경로 빠르게 찾기:
   cat /etc/kubernetes/manifests/etcd.yaml | grep -E "(cert|key|ca)"

2. 백업 한 줄 명령어 (복사-붙여넣기용):
   ETCDCTL_API=3 etcdctl snapshot save /path/to/backup.db \
     --endpoints=https://127.0.0.1:2379 \
     --cacert=/etc/kubernetes/pki/etcd/ca.crt \
     --cert=/etc/kubernetes/pki/etcd/server.crt \
     --key=/etc/kubernetes/pki/etcd/server.key

3. 복구 시 체크리스트:
   □ snapshot restore --data-dir=<새경로>
   □ etcd.yaml에서 volumes.hostPath.path 수정
   □ etcd Pod 재시작 확인: crictl ps | grep etcd
   □ kubectl get pods 로 클러스터 정상 동작 확인

4. 시험에서 자주 틀리는 포인트:
   - 인증서 경로를 외우지 말고, etcd.yaml에서 복사!
   - restore 후 반드시 hostPath를 새 경로로 변경!
   - 기존 /var/lib/etcd를 절대 삭제하지 마라!
```
