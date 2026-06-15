# 버그 레포트 — cks 랩 클러스터 프로비저닝 중 발견 (2026-06-15)

> 작성: CKS 전용 랩 클러스터(`cks`)를 `reset-cluster.sh`로 신규 구성하던 중 만난 인프라 버그 기록.
> 기존 4개 클러스터(platform/dev/staging/prod)는 영향 없음. 발견된 버그는 `scripts/lib/k8s.sh`에 수정 반영(커밋됨).

## 환경
- Apple Silicon Mac, RAM 128GB(86% 여유). tart VM. base image `ghcr.io/cirruslabs/ubuntu:latest`(non-golden → 풀 노드 프로비저닝 경로).
- 대상: `cks` 클러스터(cks-master + cks-worker1), pod 10.50/16, svc 10.100/16. K8S_VERSION=1.31.

---

## BUG 1 — 신규 VM의 systemd-resolved DNS 해석 실패 (HIGH) — ✅ 수정됨

**증상:** `install_kubeadm` 단계에서
```
curl: (6) Could not resolve host: prod-cdn.packages.k8s.io
W: Failed to fetch https://pkgs.k8s.io/.../InRelease  Temporary failure resolving 'prod-cdn.packages.k8s.io'
E: Unable to locate package kubelet/kubeadm/kubectl
```
직전 `install_containerd`(Ubuntu 기본 저장소)는 성공 → DNS가 "완전 불통"은 아님.

**근본 원인:** VM의 `systemd-resolved` 가 `prod-cdn.packages.k8s.io`(→ CloudFront `dkhzw6k7x6ord.cloudfront.net` CNAME 체인)에서 `resolvectl query` → `resolve call failed: Received invalid reply` 로 실패. 호스트 Mac에서는 정상 해석(52.85.x). 즉 VM의 upstream DNS(DHCP/NAT 제공)가 특정 CNAME 응답을 systemd-resolved 가 거부.
- `pkgs.k8s.io` 자체는 해석되나, 리다이렉트 대상 CDN 호스트에서 실패.

**수정:** `scripts/lib/k8s.sh` `prepare_node()` 에 신뢰 가능한 공개 resolver 고정 추가:
```
mkdir -p /etc/systemd/resolved.conf.d
printf '[Resolve]\nDNS=8.8.8.8 1.1.1.1\nFallbackDNS=9.9.9.9\n' > /etc/systemd/resolved.conf.d/k8s-dns.conf
systemctl restart systemd-resolved
```
적용 후 `getent hosts prod-cdn.packages.k8s.io` 정상. 향후 모든 신규 클러스터 빌드 안정화.

---

## BUG 2 — kubeadm apt GPG 키링 덮어쓰기 실패 (HIGH) — ✅ 수정됨

**증상:** BUG 1 수정 후 재실행 시
```
W: GPG error: ... InRelease: NO_PUBKEY 234654DA9A296436
E: The repository '...' is not signed.
```

**근본 원인:** `install_kubeadm()` 의 키 등록이
```
curl -fsSL .../Release.key | gpg --dearmor -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg 2>/dev/null
```
인데, ⓐ `gpg --dearmor -o <file>` 는 **출력 파일이 이미 있으면 덮어쓰기를 거부**한다(`File exists`). BUG 1로 실패한 이전 실행이 빈/불완전 키링 파일을 남겨, 재실행 시 gpg가 갱신 못 함 → 키 없음 → NO_PUBKEY. ⓑ `2>/dev/null` 이 이 오류를 가림. ⓒ `/etc/apt/keyrings` 부재 가능성.

**수정:** `scripts/lib/k8s.sh` `install_kubeadm()`:
```
mkdir -p /etc/apt/keyrings
rm -f /etc/apt/keyrings/kubernetes-apt-keyring.gpg   # 덮어쓰기 거부 회피
curl -fsSL .../Release.key | gpg --dearmor -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg   # 2>/dev/null 제거(오류 표면화)
```
적용 후 kubelet/kubeadm/kubectl 양 노드 설치 성공(set on hold 확인).

---

## BUG 3 — kubeadm init 중 containerd.service 미발견 / exit 5 (조사 중) — 🔍

**증상:** BUG 1·2 수정 후 kubeadm 설치는 통과했으나 `init_cluster` 단계에서 exit 5, 로그에
```
[reset] ...
Failed to restart containerd.service: Unit containerd.service not found.
```

**조사 결과(현재):** cks-master에서 직접 확인하니 containerd 는 **정상 설치·실행 중**:
- `which containerd` → `/usr/bin/containerd`, `dpkg -l` → `containerd 2.2.1` 설치됨
- `/usr/lib/systemd/system/containerd.service` 존재, `systemctl status containerd` → **active (running)**

**가설:** init_cluster 의 `kubeadm reset` → `systemctl restart containerd` 시점에 `systemctl daemon-reload` 가 선행되지 않아 일시적으로 unit 미인식이었을 가능성. 현재는 containerd 가 떠 있으므로 **init + Cilium 단계만 재실행하면 통과 가능성 높음**.

**다음 조치(다음 세션 또는 이어서):**
1. cks-master/worker 에서 `sudo systemctl daemon-reload` 후 init 재시도.
2. `init_cluster cks` → `wait_apiserver_ready cks` → `install_cilium cks` → `wait_nodes_ready cks` 재실행(완료 스크립트 `/tmp/complete-cks.sh` 의 init 이후 부분).
3. 필요 시 `scripts/lib/k8s.sh init_cluster` 에 `systemctl daemon-reload` 선행 추가 검토.

---

## BUG 4 — gVisor(runsc)가 containerd 2.x(config v3)에서 미인식 (MED) — ✅ 수정됨

**증상:** cks 노드에 runsc 바이너리 설치 + `runsc install` 후 RuntimeClass `gvisor`(handler=runsc) Pod를 만들면 `FailedCreatePodSandBox: no runtime for "runsc" is configured`로 ContainerCreating에서 멈춤.

**근본 원인:** cks 노드의 containerd는 **2.2.1, config `version = 3`** 이다. v3 schema의 CRI 런타임은 `[plugins.'io.containerd.cri.v1.runtime'.containerd.runtimes.*]` 아래에 정의되는데, `runsc install`은 구버전 경로(`io.containerd.grpc.v1.cri`)에 등록해 CRI(v1.runtime)가 인식하지 못했다.

**수정:** config.toml에 v3 위치로 runsc 런타임을 추가:
```toml
[plugins.'io.containerd.cri.v1.runtime'.containerd.runtimes.runsc]
  runtime_type = 'io.containerd.runsc.v1'
```
containerd 재시작 후 `runtimeClassName: gvisor` Pod 정상 기동. (`runsc install`의 containerd 2.x 미대응이 원인이므로, 향후 자동화 시 이 v3 스탠자를 직접 주입해야 한다.)

## 요약
| 버그 | 심각도 | 상태 | 수정 위치 |
|:--|:--:|:--|:--|
| 1. VM DNS(systemd-resolved) 실패 | HIGH | ✅ 수정 | `lib/k8s.sh prepare_node` |
| 2. kubeadm GPG 키링 덮어쓰기 | HIGH | ✅ 수정 | `lib/k8s.sh install_kubeadm` |
| 3. init 중 containerd unit 미발견(exit 5) | MED | 🔍 조사/재시도 | `init_cluster` (daemon-reload 선행 검토) |

발견 가치: cks 구성 부산물로 **신규 클러스터 빌드 파이프라인의 실제 버그 2건을 영구 수정**(BUG 1·2). 어떤 클러스터든 재생성 안정성 향상.
