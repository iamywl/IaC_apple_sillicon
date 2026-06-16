# 새 클러스터 `seclab` 만들기 — VM 띄우기부터 보안 캡처까지 (실측 워크다운)

작성: 2026-06-16 · 대상 브랜치: `codex-remediation`

이 문서는 platform/dev/staging/prod/cks 를 건드리지 않고 **클러스터/노드 단위 보안 실습**(Gatekeeper 설치·apiserver audit 로깅·Falco runc)을 하려고 **별도 클러스터 `seclab`** 을 새로 만든 전 과정을 실제 실행 결과로 기록한다. 네임스페이스로는 컨트롤플레인 전역 변경을 가를 수 없다는 결론(아래 §0)이 이 작업의 출발점이다.

## 0. 왜 네임스페이스가 아니라 새 클러스터인가

쿠버네티스 네임스페이스는 **하나의 컨트롤플레인 안에서 namespaced 리소스**(Pod·Service·RBAC·NetworkPolicy·PSA 등)만 칸막이한다. 다음은 클러스터에 하나뿐이라 네임스페이스로 못 가른다:

| 바꿔야 하는 대상 | 레벨 | 네임스페이스로 격리? |
|:--|:--|:--|
| apiserver audit 로깅(`--audit-policy-file`) | kube-apiserver 정적 파드(클러스터 1개) | ❌ |
| Gatekeeper 설치(webhook+CRD+컨트롤러) | admission webhook(클러스터 전역) | △ 적용 ns만 좁힘, 설치는 전역 |
| containerd·런타임(runc/gVisor)·노드 포트 | 노드(호스트) | ❌ |
| RBAC·NetworkPolicy·PSA·Pod | namespaced | ✅ (이미 ns로 처리) |

→ 클러스터/노드 단위 변경의 격리 단위는 **클러스터(VM 한 벌)** 다. 그래서 일회용 `seclab` 을 만든다. 부수면 `reset-cluster.sh --yes seclab` 한 줄로 통째 재생성된다.

## 1. 사전: 용량 확보 (호스트 ~13 VM 한계)

운영 4클러스터 + cks = 12 VM 가동 중이었다. seclab 2 VM 을 더하면 임계(~13)를 넘으므로, 이 캡처에 불필요한 **platform(3 VM/24GB) 을 정지**해 자리를 만든다. 삭제가 아니라 정지라 데이터는 보존된다.

```bash
tart stop platform-master platform-worker1 platform-worker2
# 복구는 나중에: tart run platform-* && ./scripts/fix-cluster-ip-drift.sh platform
```

## 2. 클러스터 정의 추가 (Single Source of Truth)

클러스터·노드는 전부 `config/clusters.json` 한 곳에서 정의된다. 여기에 블록만 추가하면 모든 스크립트가 자동으로 새 클러스터를 인식한다(`scripts/lib/common.sh` 의 `get_cluster_names`/`get_nodes_for_cluster`/`get_pod_cidr` 등이 jq 로 파싱).

```json
{
  "name": "seclab",
  "pod_cidr": "10.60.0.0/16",
  "service_cidr": "10.101.0.0/16",
  "nodes": [
    { "name": "seclab-master",  "role": "master", "cpu": 2, "memory": 4096, "disk": 20 },
    { "name": "seclab-worker1", "role": "worker", "cpu": 2, "memory": 8192, "disk": 20 }
  ]
}
```

**CIDR는 기존과 겹치면 안 된다.** 기존 pod 10.10~10.50 / svc 10.96~10.100 을 쓰므로 seclab 은 pod `10.60.0.0/16`, svc `10.101.0.0/16` 로 잡았다.

## 3. 생성 — 명령 한 줄

```bash
./scripts/reset-cluster.sh --yes seclab
```

이 스크립트가 5단계를 수행한다(실제 로그):

```
[STEP] [seclab] 1/5 기존 VM 삭제
[STEP] [seclab] 2/5 VM 재생성 + 기동
[INFO]   seclab-master (192.168.67.17) SSH ready
[INFO]   seclab-worker1 (192.168.67.18) SSH ready
[STEP] [seclab] 3/5 노드 준비 + containerd + kubeadm 설치(노드당 수 분)
[STEP] [seclab] 4/5 kubeadm init + worker join
[STEP] [seclab] 5/5 Cilium 설치 + 노드 Ready 대기
[INFO] All nodes in 'seclab' are Ready.
```

### 3.1 VM이 어떻게 뜨는가 (tart)

tart 는 Apple Hypervisor.framework 기반 macOS/Linux VM 도구다. `scripts/lib/vm.sh` 가 다음을 한다:

```bash
tart clone ghcr.io/cirruslabs/ubuntu:latest seclab-master   # 베이스 이미지에서 복제
tart set seclab-master --cpu 2 --memory 4096                 # 리소스 할당
tart run seclab-master --no-graphics --net-softnet-allow=0.0.0.0/0 &   # 부팅(백그라운드)
tart ip seclab-master                                        # DHCP IP 조회(192.168.64~67.x)
```

- IP는 부팅 시 softnet DHCP 로 받는다 → `vm_wait_for_ip` 가 `tart ip` 를 3초 간격으로 폴링(최대 3분).
- **IP 드리프트**: tart 는 재부팅마다 IP를 새로 준다. kubeadm 은 init 시점 IP에 묶이므로 재부팅 후 깨진다. 그래서 fresh 생성(reset-cluster)은 항상 "현재 IP"로 init 해 드리프트를 원천 차단한다. 기존 클러스터 재부팅 시엔 `scripts/fix-cluster-ip-drift.sh` 가 apiserver 인증서 SAN·control-plane 정적파드·worker kubelet.conf·Cilium env 4겹을 고친다.

### 3.2 노드 준비 → 런타임 → kubeadm

`scripts/lib/k8s.sh` 가 SSH(`sshpass`, admin/admin)로 각 노드에:
1. swap off, 커널 모듈(`overlay`/`br_netfilter`), sysctl(`bridge-nf-call-iptables`·`ip_forward`), hostname.
2. `containerd` 설치(`SystemdCgroup=true`) — 실측 버전 **containerd 2.2.1**, runc 1.3.4.
3. `kubeadm`/`kubelet`/`kubectl` 설치 — 실측 **v1.31.14**, cri-tools 1.31.1.

### 3.3 kubeadm init + join + CNI

```bash
# master (현재 IP, clusters.json 의 CIDR, kube-proxy 제외 — Cilium이 대체)
kubeadm init --pod-network-cidr=10.60.0.0/16 --service-cidr=10.101.0.0/16 \
  --skip-phases=addon/kube-proxy --apiserver-advertise-address=192.168.67.17 \
  --node-name=seclab-master
# worker
kubeadm token create --print-join-command   # → worker에서 실행 + --node-name=seclab-worker1
# CNI
helm upgrade --install cilium cilium/cilium -n kube-system \
  --values manifests/cilium-values.yaml \
  --set k8sServiceHost=192.168.67.17 --set cluster.name=seclab --wait
```

kubeconfig 는 `kubeconfig/seclab.yaml` 에 생성된다(gitignore).

## 4. 검증 (실측)

```bash
kubectl --kubeconfig kubeconfig/seclab.yaml get nodes -o wide
# NAME            STATUS  VERSION    CONTAINER-RUNTIME
# seclab-master   Ready   v1.31.14   containerd://2.2.1
# seclab-worker1  Ready   v1.31.14   containerd://2.2.1
```

cilium/coredns 가 Running 이면 정상. 노드 SSH는 키 배포로 비밀번호 없이:

```bash
./scripts/setup-ssh-keys.sh --no-boot seclab   # ~/.ssh/tart_k8scert + ~/.ssh/config 관리블록
# 비대화형에서 ProxyCommand(tart ip)가 빈값이면 직접 IP 사용:
ssh -i ~/.ssh/tart_k8scert admin@192.168.67.17
```

## 5. seclab 에서 한 보안 실습·캡처 (네임스페이스로 못 하던 것)

| 실습 | 방법(seclab) | 교재 반영 |
|:--|:--|:--|
| **Gatekeeper 거부** | `gatekeeper.yaml`(v3.17.1) 설치 → `K8sAllowedRepos` ConstraintTemplate+Constraint → 비허용 레지스트리 Pod가 `validation.gatekeeper.sh` 로 거부 | CKS day08 `cks-gatekeeper-repo-deny.png` |
| **apiserver audit 로깅** | `seclab-master` 의 `kube-apiserver.yaml` 에 `--audit-policy-file`·`--audit-log-path`+hostPath 마운트(python3 패치) → 시크릿 생성/조회 → `jq` 로 `audit.log` 분석 | CKS 01-concepts `cks-audit-secrets-jq.png`, day14 `cks-audit-analysis.png` |
| **Falco(runc) 컨테이너 귀속** | Falco helm(`modern_ebpf`) DaemonSet → `demo/nginx`(runc)에서 `cat /etc/shadow` → `Read sensitive file untrusted` 경보에 `container_id`·`k8s_pod_name` 포함 | CKS day12 `cks-falco-runc-shadow.png` |

핵심: cks 는 Kyverno 상주·gVisor 런타임이라 Gatekeeper 충돌·syscall host-only 한계가 있었는데, seclab 은 깨끗한 runc + webhook 없는 상태라 위 세 가지가 정확히 잡힌다.

## 6. 정리 / 복구

```bash
# seclab 통째 재생성(망가지면)
./scripts/reset-cluster.sh --yes seclab
# seclab 잠시 끄기 / 켜기
tart stop seclab-master seclab-worker1
tart run seclab-master --no-graphics & tart run seclab-worker1 --no-graphics &
./scripts/fix-cluster-ip-drift.sh seclab     # 재부팅 후 IP 드리프트 복구
# platform 복구(자리 돌려주기)
tart run platform-master --no-graphics & ... ; ./scripts/fix-cluster-ip-drift.sh platform
# seclab 완전 삭제(필요 시): clusters.json 에서 블록 제거 + tart delete seclab-*
```

> 6개 클러스터 동시 가동은 호스트 용량(~13 VM)을 넘는다. 필요한 클러스터만 켜고 나머지는 `tart stop` 으로 내린다.
