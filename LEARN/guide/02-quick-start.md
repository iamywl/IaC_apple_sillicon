# 재연 가이드 02. 빠른 시작 (One-Command)

이 문서는 `demo.sh` 한 줄로 전체 인프라를 구축하는 방법, Golden Image로 시간을 단축하는 방법, 구축 후 상태 확인과 종료/재시작 절차를 다룬다.

---

## demo.sh로 전체 구축

### 실행 전 확인사항

1. [00. 사전 준비](00-prerequisites.md)의 모든 소프트웨어가 설치되어 있는지 확인한다:

```bash
tart --version && kubectl version --client && helm version --short && jq --version && sshpass -V 2>&1 | head -1
```

2. 디스크 여유 공간을 확인한다:

```bash
df -h /
```

최소 200GB 여유가 있어야 한다.

3. 기존 Tart VM이 없는지 확인한다:

```bash
tart list
```

기존 VM이 있으면 demo.sh가 "Boot existing VMs instead of reinstalling?" 프롬프트를 표시한다. 완전히 새로 시작하려면 먼저 삭제한다:

```bash
./scripts/destroy.sh
```

4. 프로젝트 루트 디렉토리에 있는지 확인한다:

```bash
pwd
# /path/to/tart-infra
ls config/clusters.json
# config/clusters.json
```

### 실행 명령어

```bash
./scripts/demo.sh
```

### demo.sh의 동작 흐름

demo.sh는 내부적으로 3단계를 순서대로 실행한다:

```
Phase 1: Infrastructure Install (install.sh)
  └── 17단계 설치 파이프라인 (01-create-vms.sh ~ 17-install-harbor.sh)

Phase 2: Infrastructure Status (status.sh)
  └── 각 클러스터 노드 상태, Pod 상태 출력

Phase 3: SRE Dashboard
  └── npm install + npm run dev (localhost:5173)
```

### 각 단계별 예상 출력

**Phase 1 시작 시:**
```
========== Tart Multi-Cluster K8s Installation ==========

[INFO] This will create 10 VMs and set up 4 Kubernetes clusters.
[INFO] Estimated time: 45-60 minutes
[INFO] All dependencies are installed.
```

**VM 생성 (약 5~10분):**
```
========== Phase 1: Creating VMs ==========

[INFO] Pulling ghcr.io/cirruslabs/ubuntu:latest...
[INFO] Cloning 'ghcr.io/cirruslabs/ubuntu:latest' -> 'platform-master'...
[INFO] Setting resources for 'platform-master': 2 CPU, 4096MB RAM
[INFO] Cloning 'ghcr.io/cirruslabs/ubuntu:latest' -> 'platform-worker1'...
[INFO] Setting resources for 'platform-worker1': 3 CPU, 12288MB RAM
...
[INFO] All VMs created successfully.
```

**노드 준비 (약 5분):**
```
========== Phase 2: Preparing Nodes (OS config) ==========

[INFO] Preparing node 'platform-master' (192.168.64.x)...
[INFO] Preparing node 'platform-worker1' (192.168.64.x)...
...
[INFO] All nodes prepared.
```

**containerd 설치 (약 10분):**
```
========== Phase 3: Installing Container Runtime (containerd) ==========

[INFO] Installing containerd on 'platform-master'...
...
[INFO] containerd installed on all nodes.
```

**kubeadm 설치 (약 10분):**
```
========== Phase 4: Installing kubeadm, kubelet, kubectl ==========

[INFO] Installing kubeadm on 'platform-master'...
...
[INFO] kubeadm installed on all nodes.
```

**클러스터 초기화 (약 5분):**
```
========== Initializing cluster: platform ==========

[INFO] Master: platform-master (192.168.64.x)
...
[INFO] Joining worker 'platform-worker1' (192.168.64.x) to cluster 'platform'...
...
[INFO] All clusters initialized.
```

**Cilium + Hubble (약 5분):**
```
========== Phase 6: Installing Cilium + Hubble ==========

[INFO] Installing Cilium on 'platform' (API: 192.168.64.x)...
[INFO] Enabling Hubble on 'platform'...
...
[INFO] All nodes in 'platform' are Ready.
```

**모니터링, CI/CD 등 (약 10~15분):**
```
========== Phase 7: Installing Monitoring Stack on 'platform' ==========
...
========== Phase 8: Installing CI/CD (ArgoCD + Jenkins) on 'platform' ==========
...
========== Phase 12: Installing Istio Service Mesh on 'dev' ==========
...
```

**완료:**
```
========== Installation Complete! ==========

[INFO] Clusters:
[INFO]   platform: kubectl --kubeconfig kubeconfig/platform.yaml get nodes
[INFO]   dev: kubectl --kubeconfig kubeconfig/dev.yaml get nodes
[INFO]   staging: kubectl --kubeconfig kubeconfig/staging.yaml get nodes
[INFO]   prod: kubectl --kubeconfig kubeconfig/prod.yaml get nodes

[INFO] Access URLs:
[INFO]   Grafana:  http://192.168.64.x:30300  (admin/admin)
[INFO]   ArgoCD:   http://192.168.64.x:30800
[INFO]   Jenkins:  http://192.168.64.x:30900
[INFO]   AlertMgr: http://192.168.64.x:30903
```

**대시보드 시작:**
```
========== Phase 3: Starting SRE Dashboard ==========

[INFO] Installing dashboard dependencies...
[INFO] Dashboard started (PID: xxxxx)
[INFO]   Frontend: http://localhost:5173
[INFO]   Backend:  http://localhost:3000
```

이후 브라우저가 자동으로 `http://localhost:5173`을 열어 SRE 대시보드를 표시한다.

### 예상 소요 시간

| 모드 | 소요 시간 | 설명 |
|------|----------|------|
| 일반 설치 (base image) | 45~60분 | 모든 단계를 처음부터 실행한다 |
| Golden image 사용 | 15~20분 | Phase 2~4를 건너뛴다 |
| 기존 VM 부팅 (--skip-install) | 3~5분 | VM 시작 + 헬스 체크만 수행한다 |

### demo.sh 옵션

```bash
# 전체 설치 + 대시보드 (기본)
./scripts/demo.sh

# 기존 VM 부팅 + 대시보드 (설치 건너뛰기)
./scripts/demo.sh --skip-install

# 전체 설치만 (대시보드 없이)
./scripts/demo.sh --skip-dashboard

# 대시보드만 실행 (인프라가 이미 실행 중일 때)
./scripts/demo.sh --dashboard-only
```

---

## Golden Image로 시간 단축

### Golden Image란

Golden image는 Ubuntu 베이스 이미지에 containerd, kubeadm, kubelet, kubectl, 그리고 Cilium/Kubernetes 컨테이너 이미지를 미리 설치한 VM 이미지이다. 이 이미지를 사용하면 install.sh가 Phase 2(노드 준비), Phase 3(containerd 설치), Phase 4(kubeadm 설치)를 자동으로 건너뛴다.

### 어떤 단계를 건너뛰는가

| 단계 | 일반 설치 | Golden image |
|------|----------|-------------|
| Phase 1: VM 생성 | 실행 | 실행 |
| Phase 2: 노드 준비 (swap, kernel modules) | 실행 | **건너뜀** |
| Phase 3: containerd 설치 | 실행 | **건너뜀** |
| Phase 4: kubeadm 설치 | 실행 | **건너뜀** |
| Phase 5~12 | 실행 | 실행 |

Golden image에서도 hostname 설정만은 Phase 2~4 대신 별도로 수행한다. VM마다 hostname이 달라야 Kubernetes 노드 이름이 올바르게 등록되기 때문이다.

### Golden Image 빌드 방법

```bash
./scripts/build-golden-image.sh
```

빌드 과정 (약 10분):

```
========== Golden Image Builder ==========

========== Step 1/7: Pulling base image ==========
[INFO] Pulling ghcr.io/cirruslabs/ubuntu:latest...

========== Step 2/7: Creating build VM ==========
[INFO] Setting resources: 2 CPU, 4096MB RAM

========== Step 3/7: Starting build VM ==========
[INFO] Build VM IP: 192.168.64.x
[INFO] SSH ready.

========== Step 4/7: Preparing node (OS config) ==========
[INFO] swap off, kernel modules, sysctl...

========== Step 5/7: Installing containerd ==========

========== Step 6/7: Installing kubeadm v1.31 ==========

========== Step 7/7: Pre-pulling container images ==========
[INFO] Pulling kubeadm images...
[INFO] Pulling Cilium images...

========== Finalizing golden image ==========
[INFO] Saving as 'k8s-golden'...

========== Golden Image Ready! ==========
[INFO] Image name: k8s-golden
```

### clusters.json의 base_image 변경

Golden image 빌드 후, `config/clusters.json`의 `base_image`를 변경한다:

```bash
# 변경 전
"base_image": "ghcr.io/cirruslabs/ubuntu:latest"

# 변경 후
"base_image": "k8s-golden"
```

이 변경 후 `./scripts/demo.sh` 또는 `./scripts/install.sh`를 실행하면 자동으로 Golden image 모드가 활성화된다:

```
[INFO] Golden image detected → Phase 2~4 will be skipped
[INFO] Estimated time: 15-20 minutes
```

### Golden Image 재빌드

기존 Golden image가 있으면 빌드가 실패한다. 먼저 삭제한다:

```bash
tart delete k8s-golden
./scripts/build-golden-image.sh
```

---

## 구축 완료 후 확인

### 각 클러스터 노드 상태 확인

```bash
# 일괄 상태 확인
./scripts/status.sh
```

또는 클러스터별로 개별 확인:

```bash
kubectl --kubeconfig kubeconfig/platform.yaml get nodes
```

예상 출력:
```
NAME                STATUS   ROLES           AGE   VERSION
platform-master     Ready    control-plane   45m   v1.31.x
platform-worker1    Ready    <none>          44m   v1.31.x
platform-worker2    Ready    <none>          44m   v1.31.x
```

```bash
kubectl --kubeconfig kubeconfig/dev.yaml get nodes
```

예상 출력:
```
NAME          STATUS   ROLES           AGE   VERSION
dev-master    Ready    control-plane   40m   v1.31.x
dev-worker1   Ready    <none>          39m   v1.31.x
```

```bash
kubectl --kubeconfig kubeconfig/staging.yaml get nodes
```

예상 출력:
```
NAME              STATUS   ROLES           AGE   VERSION
staging-master    Ready    control-plane   35m   v1.31.x
staging-worker1   Ready    <none>          34m   v1.31.x
```

```bash
kubectl --kubeconfig kubeconfig/prod.yaml get nodes
```

예상 출력:
```
NAME           STATUS   ROLES           AGE   VERSION
prod-master    Ready    control-plane   30m   v1.31.x
prod-worker1   Ready    <none>          29m   v1.31.x
prod-worker2   Ready    <none>          29m   v1.31.x
```

모든 노드의 STATUS가 `Ready`여야 한다. `NotReady`인 노드가 있으면 Cilium 설치가 완료되지 않은 것이다. 2~3분 기다린 후 다시 확인한다.

### 서비스 접속 정보

먼저 platform-worker1의 IP를 확인한다:

```bash
tart ip platform-worker1
```

예상 출력:
```
192.168.64.x
```

이 IP를 사용하여 각 서비스에 접속한다:

| 서비스 | URL | 기본 계정 |
|--------|-----|----------|
| Grafana | `http://<IP>:30300` | admin / admin |
| ArgoCD | `http://<IP>:30800` | admin / (자동 생성된 비밀번호) |
| Jenkins | `http://<IP>:30900` | admin / (자동 생성된 비밀번호) |
| AlertManager | `http://<IP>:30903` | 인증 없음 |
| SRE Dashboard | `http://localhost:5173` | 인증 없음 |

### ArgoCD 비밀번호 확인

```bash
kubectl --kubeconfig kubeconfig/platform.yaml -n argocd get secret argocd-initial-admin-secret -o jsonpath="{.data.password}" | base64 -d
echo  # 줄바꿈
```

### Jenkins 비밀번호 확인

```bash
kubectl --kubeconfig kubeconfig/platform.yaml -n jenkins get secret jenkins -o jsonpath="{.data.jenkins-admin-password}" | base64 -d
echo  # 줄바꿈
```

### Platform 클러스터 Pod 상태 확인

```bash
# 모니터링 네임스페이스
kubectl --kubeconfig kubeconfig/platform.yaml -n monitoring get pods

# CI/CD 네임스페이스
kubectl --kubeconfig kubeconfig/platform.yaml -n argocd get pods
kubectl --kubeconfig kubeconfig/platform.yaml -n jenkins get pods
```

모든 Pod이 `Running` 또는 `Completed` 상태여야 한다.

### Dev 클러스터 데모 앱 확인

```bash
kubectl --kubeconfig kubeconfig/dev.yaml -n demo get pods
```

예상 출력 (Istio 사이드카 주입 후):
```
NAME                          READY   STATUS    RESTARTS   AGE
httpbin-xxx-xxx               2/2     Running   0          10m
nginx-web-xxx-xxx             2/2     Running   0          10m
redis-xxx-xxx                 2/2     Running   0          10m
postgres-xxx-xxx              2/2     Running   0          10m
rabbitmq-xxx-xxx              2/2     Running   0          10m
keycloak-xxx-xxx              2/2     Running   0          10m
```

`READY` 열이 `2/2`인 것은 애플리케이션 컨테이너 + Istio Envoy 사이드카 2개가 동작 중임을 뜻한다.

### Istio 상태 확인

```bash
kubectl --kubeconfig kubeconfig/dev.yaml -n istio-system get pods
```

예상 출력:
```
NAME                      READY   STATUS    RESTARTS   AGE
istiod-xxx-xxx            1/1     Running   0          10m
```

---

## 종료와 재시작

### Graceful Shutdown (권장)

```bash
./scripts/shutdown.sh
```

이 스크립트는 다음을 수행한다:

1. 모든 클러스터의 워커 노드에서 `kubectl drain`을 실행하여 Pod을 안전하게 축출한다
2. 모든 VM을 `tart stop`으로 정지한다

예상 출력:
```
========== Graceful Shutdown ==========

[INFO] Draining workers in cluster 'platform'...
[INFO] Draining workers in cluster 'dev'...
[INFO] Draining workers in cluster 'staging'...
[INFO] Draining workers in cluster 'prod'...

========== Stopping all VMs ==========

[INFO] Stopping VM 'platform-master'...
[INFO] Stopping VM 'platform-worker1'...
...
[INFO] All VMs stopped. Safe to shut down your Mac.
```

shutdown 후에는 Mac을 꺼도 데이터가 보존된다.

### VM 재시작

```bash
./scripts/boot.sh
```

이 스크립트는 다음을 수행한다:

1. 모든 VM을 시작하고 IP 할당을 대기한다
2. 각 클러스터의 API server가 응답할 때까지 대기한다
3. 주요 서비스(모니터링, CI/CD 등)의 상태를 확인한다

예상 출력:
```
========== Tart Multi-Cluster Boot ==========

[INFO] Starting all VMs and verifying cluster health...
...
========== Boot Complete! ==========
```

부팅 후 VM의 IP가 변경될 수 있다. kubeconfig 파일에는 이전 IP가 기록되어 있으므로, API server에 접근이 안 되면 kubeconfig의 server 주소를 갱신해야 한다.

> **참고**: kubeconfig의 server 주소 갱신이 필요한 경우, 수동으로 `kubeconfig/<cluster>.yaml` 파일의 `server:` 필드를 새 IP로 변경한다. 또는 destroy 후 재설치하면 자동으로 올바른 IP가 설정된다.

### 기존 인프라 부팅 + 대시보드

```bash
./scripts/demo.sh --skip-install
```

install 단계를 건너뛰고 VM 부팅 + 상태 확인 + 대시보드 실행만 수행한다.

### 완전 삭제

```bash
./scripts/destroy.sh
```

이 스크립트는 다음을 수행한다:

1. "Are you sure? (yes/no)" 확인 프롬프트를 표시한다
2. `yes`를 입력하면 모든 VM을 정지하고 삭제한다
3. `kubeconfig/` 디렉토리의 모든 .yaml 파일을 삭제한다

예상 출력:
```
========== Destroying All Infrastructure ==========

[WARN] This will delete ALL VMs and kubeconfigs!

Are you sure? (yes/no): yes
[INFO] Stopping VM 'platform-master'...
[INFO] Deleting VM 'platform-master'...
...
[INFO] All infrastructure destroyed.
```

삭제 후 `tart list`를 실행하면 해당 VM들이 더 이상 나타나지 않는다.

> **주의**: destroy.sh는 되돌릴 수 없다. 모든 VM 디스크 데이터, Kubernetes 상태, 설치된 애플리케이션이 영구 삭제된다. 재설치하려면 `./scripts/demo.sh`를 다시 실행해야 한다.

---

## 문제 해결

### "tart pull" 단계에서 멈추는 경우

네트워크 문제일 가능성이 높다. 프록시 환경이라면 환경 변수를 확인한다:

```bash
echo $HTTP_PROXY
echo $HTTPS_PROXY
```

### VM이 IP를 받지 못하는 경우

macOS 방화벽 또는 네트워크 설정 문제이다:

```bash
# VM 목록에서 상태 확인
tart list

# 특정 VM의 IP 확인
tart ip platform-master
```

IP가 나오지 않으면 VM을 재시작해본다:

```bash
tart stop platform-master
tart run platform-master --no-graphics &
sleep 10
tart ip platform-master
```

### Helm 설치가 timeout으로 실패하는 경우

컨테이너 이미지 pull이 느린 경우이다. Golden image를 사용하면 주요 이미지가 미리 캐시되어 이 문제를 줄일 수 있다. 또는 노드의 메모리가 부족하여 Pod이 스케줄링되지 않는 상태일 수 있다:

```bash
kubectl --kubeconfig kubeconfig/platform.yaml get pods -A | grep -v Running | grep -v Completed
kubectl --kubeconfig kubeconfig/platform.yaml describe pod <pod-name> -n <namespace>
```

### 대시보드가 시작되지 않는 경우

Node.js가 설치되어 있는지, 포트 5173/3000이 사용 중이지 않은지 확인한다:

```bash
node --version
lsof -i :5173
lsof -i :3000
```

---

다음 장: [03. 17단계 설치 파이프라인 상세](03-phase-by-phase.md)
