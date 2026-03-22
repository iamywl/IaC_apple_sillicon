# CKA Day 3: etcd 백업/복구 & 클러스터 업그레이드

> 학습 목표 | CKA 도메인: Cluster Architecture, Installation & Configuration (25%) - Part 2 | 예상 소요 시간: 4시간

---

## 오늘의 학습 목표

- [ ] etcd의 역할과 내부 구조를 완벽히 이해한다
- [ ] etcdctl snapshot save/restore 절차를 암기한다
- [ ] kubeadm upgrade 절차를 Control Plane과 Worker Node로 구분하여 실행한다
- [ ] drain/cordon/uncordon의 차이를 정확히 이해한다
- [ ] 시험 출제 패턴에 맞는 문제 풀이 전략을 체득한다

---

## 1. etcd 완벽 이해

### 1.1 etcd의 역할과 내부 구조

etcd는 쿠버네티스 클러스터의 모든 상태 데이터를 저장하는 분산 키-값 저장소(distributed key-value store)이다.

**etcd의 핵심 아키텍처:**
- Raft 합의 알고리즘 기반으로 과반수(quorum) 노드의 합의를 통해 데이터 일관성을 보장한다
- 오직 kube-apiserver만 etcd에 gRPC로 직접 접근하며, 다른 컴포넌트는 API 서버를 경유한다
- etcd 데이터가 손실되면 모든 쿠버네티스 오브젝트 상태가 소실되어 클러스터 복구가 불가하다
- snapshot save/restore를 통해 특정 시점의 전체 상태를 백업 및 복구할 수 있다

**etcd에 저장되는 데이터:**
- 모든 쿠버네티스 오브젝트: Pod, Service, Deployment, ConfigMap, Secret 등
- 클러스터 설정: 네임스페이스, RBAC 규칙, StorageClass 등
- 인증/인가 정보: ServiceAccount, CertificateSigningRequest 등

**핵심 특성:**

| 특성 | 설명 |
|---|---|
| **분산 시스템** | 여러 etcd 노드가 데이터를 복제하여 고가용성 보장 |
| **Raft 합의** | 과반수 노드가 동의해야 데이터가 확정 (3노드면 2개 동의 필요) |
| **키-값 저장** | `/registry/pods/default/nginx` 같은 키에 JSON 값 저장 |
| **Watch 지원** | 데이터 변경을 실시간으로 구독할 수 있음 |
| **TLS 암호화** | 모든 통신이 인증서 기반으로 암호화됨 |
| **API v3** | 현재 쿠버네티스는 etcd API v3만 사용 |

### 1.2 etcd 데이터 구조

etcd에 저장된 데이터는 다음과 같은 키 구조를 가진다:

```
/registry/
├── pods/
│   ├── default/
│   │   ├── nginx-pod     → Pod 스펙 JSON
│   │   └── web-app       → Pod 스펙 JSON
│   └── kube-system/
│       ├── coredns-xxx   → Pod 스펙 JSON
│       └── kube-proxy-xx → Pod 스펙 JSON
├── deployments/
│   └── default/
│       └── nginx-deploy  → Deployment 스펙 JSON
├── services/
│   ├── default/
│   │   └── kubernetes    → Service 스펙 JSON
│   └── kube-system/
│       └── kube-dns      → Service 스펙 JSON
├── configmaps/
├── secrets/
├── namespaces/
├── clusterroles/
├── clusterrolebindings/
└── ...
```

### 1.3 etcd 인증서 경로 (시험 필수 암기!)

etcdctl 명령을 실행할 때 반드시 4가지 인증서 옵션을 지정해야 한다.

```bash
# === 반드시 암기해야 할 4가지 옵션 ===
--endpoints=https://127.0.0.1:2379     # etcd 서버 주소
--cacert=/etc/kubernetes/pki/etcd/ca.crt     # etcd CA 인증서
--cert=/etc/kubernetes/pki/etcd/server.crt   # etcd 서버 인증서
--key=/etc/kubernetes/pki/etcd/server.key    # etcd 서버 개인키
```

**기억나지 않을 때 확인하는 방법:**

```bash
# 방법 1: etcd Pod의 YAML에서 확인 (권장)
kubectl -n kube-system get pod etcd-<master-name> -o yaml | grep -E "cert|key|ca|endpoint"

# 방법 2: etcd Static Pod 매니페스트에서 직접 확인
sudo cat /etc/kubernetes/manifests/etcd.yaml | grep -E "cert-file|key-file|trusted-ca|data-dir"

# 방법 3: etcd 프로세스에서 확인
ps aux | grep etcd | grep -o "\-\-[a-z-]*=\S*"
```

### 1.4 etcdctl 환경변수

```bash
# API 버전 설정 (반드시 3으로 설정!)
export ETCDCTL_API=3

# 또는 매 명령마다 지정
ETCDCTL_API=3 etcdctl <command>
```

**왜 API v3인가?**
- 쿠버네티스 1.13부터 etcd v3만 지원한다
- v2와 v3는 데이터 모델이 완전히 다르다
- v2 명령(예: `etcdctl ls`)은 v3에서 동작하지 않는다

---

## 2. etcd 백업 (snapshot save) 완벽 가이드

### 2.1 백업이 왜 중요한가?

etcd 데이터가 손실되면:
- 모든 쿠버네티스 오브젝트가 사라진다
- Pod, Service, Deployment 등 모든 리소스가 소실된다
- 클러스터를 처음부터 다시 구성해야 한다

etcd 스냅샷은 boltdb의 전체 키-값 데이터를 일관된 시점(consistent snapshot)으로 파일에 직렬화한 것이다. 이 스냅샷으로 restore하면 해당 시점의 클러스터 상태로 복원된다.

### 2.2 snapshot save 명령어 상세

```bash
# etcd 스냅샷 저장
ETCDCTL_API=3 etcdctl snapshot save <저장경로> \
  --endpoints=https://127.0.0.1:2379 \       # etcd 서버 주소
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \  # CA 인증서: 서버 신뢰성 검증
  --cert=/etc/kubernetes/pki/etcd/server.crt \ # 클라이언트 인증서: "나는 권한 있는 클라이언트"
  --key=/etc/kubernetes/pki/etcd/server.key    # 클라이언트 개인키: 인증서의 짝
```

**각 옵션의 TLS 인증 역할:**

| 옵션 | 역할 | PKI 기능 |
|---|---|---|
| `--endpoints` | etcd 서버 gRPC 엔드포인트 | 대상 서버 주소 지정 |
| `--cacert` | CA 인증서 | 서버 인증서의 서명 검증(서버 identity 확인) |
| `--cert` | 클라이언트 인증서 | mTLS에서 클라이언트 identity 증명 |
| `--key` | 클라이언트 개인키 | 인증서와 쌍을 이루는 비밀키로 TLS 핸드셰이크 수행 |

### 2.3 백업 검증

```bash
# 스냅샷 상태 확인 (정상적으로 저장되었는지 검증)
ETCDCTL_API=3 etcdctl snapshot status <저장경로> --write-out=table
```

출력 예시:
```
+----------+----------+------------+------------+
|   HASH   | REVISION | TOTAL KEYS | TOTAL SIZE |
+----------+----------+------------+------------+
| fe01cf57 |       10 |         13 |     2.1 MB |
+----------+----------+------------+------------+
```

| 필드 | 의미 |
|---|---|
| HASH | 스냅샷 데이터의 해시값 (무결성 검증용) |
| REVISION | etcd의 현재 리비전 번호 |
| TOTAL KEYS | 저장된 총 키 수 |
| TOTAL SIZE | 스냅샷 파일 크기 |

### 2.4 기타 etcdctl 유용한 명령어

```bash
# etcd 멤버 목록 확인 (클러스터 구성 확인)
ETCDCTL_API=3 etcdctl member list \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key \
  --write-out=table

# etcd 엔드포인트 상태 확인
ETCDCTL_API=3 etcdctl endpoint status \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key \
  --write-out=table

# etcd 건강 상태 확인
ETCDCTL_API=3 etcdctl endpoint health \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key
```

---

## 3. etcd 복구 (snapshot restore) 완벽 가이드

### 3.1 복구 전체 흐름도

```
[1단계] 스냅샷 파일을 새 데이터 디렉터리로 복구
    │   etcdctl snapshot restore <파일> --data-dir=<새경로>
    │   ※ 인증서 옵션 불필요! (로컬 파일 복구이므로)
    ▼
[2단계] etcd Static Pod 매니페스트 수정
    │   /etc/kubernetes/manifests/etcd.yaml의
    │   volumes → hostPath → path를 <새경로>로 변경
    ▼
[3단계] kubelet이 변경을 감지하고 etcd Pod 재시작
    │   약 1~2분 소요
    ▼
[4단계] API 서버가 새 etcd에 연결
    │   kubectl get nodes로 확인
    ▼
[5단계] 클러스터 정상 동작 확인
    kubectl get pods -A
```

### 3.2 snapshot restore 명령어 상세

```bash
# 스냅샷 복구 (인증서 옵션 불필요!)
ETCDCTL_API=3 etcdctl snapshot restore /path/to/backup.db \
  --data-dir=/var/lib/etcd-restored    # 새 데이터 디렉터리 경로 (기존 경로와 달라야!)
```

**핵심 주의사항:**
1. `snapshot save`에는 인증서가 **필요하다** (네트워크를 통해 etcd에 접근하므로)
2. `snapshot restore`에는 인증서가 **불필요하다** (로컬 파일을 복구하므로)
3. 복구 시 반드시 `--data-dir`로 **새 경로**를 지정한다 (기존 데이터 덮어쓰기 금지!)

### 3.3 etcd 매니페스트 수정 상세

```yaml
# /etc/kubernetes/manifests/etcd.yaml에서 수정할 부분

# === 방법 1: volumes의 hostPath만 변경 (더 간단) ===
# 변경 전:
  volumes:
  - name: etcd-data
    hostPath:
      path: /var/lib/etcd                  # ← 이 경로를 변경
      type: DirectoryOrCreate

# 변경 후:
  volumes:
  - name: etcd-data
    hostPath:
      path: /var/lib/etcd-restored         # ← 새 경로로 변경
      type: DirectoryOrCreate

# === 방법 2: --data-dir 인자도 함께 변경 (더 정확) ===
# 변경 전:
    - --data-dir=/var/lib/etcd

# 변경 후:
    - --data-dir=/var/lib/etcd-restored

# 그리고 volumes도 함께 변경:
  volumes:
  - name: etcd-data
    hostPath:
      path: /var/lib/etcd-restored
```

**방법 1과 방법 2의 차이:**
- 방법 1: `--data-dir`은 그대로이지만, 실제 마운트되는 호스트 경로가 변경됨. 컨테이너 내부에서 `/var/lib/etcd`로 접근하지만 실제로는 호스트의 `/var/lib/etcd-restored`를 사용
- 방법 2: 모든 설정이 일관되게 새 경로를 가리킴

### 3.4 sed를 이용한 빠른 수정

```bash
# sed로 한 줄로 수정 (시험에서 시간 절약)
sudo sed -i 's|path: /var/lib/etcd$|path: /var/lib/etcd-restored|' \
  /etc/kubernetes/manifests/etcd.yaml
```

### 3.5 복구 후 확인

```bash
# etcd Pod 재시작 대기 (1~2분)
watch sudo crictl ps | grep etcd

# 또는 kubectl로 확인 (API 서버 연결 후)
kubectl get pods -n kube-system | grep etcd

# 클러스터 전체 상태 확인
kubectl get nodes
kubectl get pods -A
```

---

## 4. 클러스터 업그레이드 완벽 가이드

### 4.1 업그레이드 규칙

쿠버네티스 클러스터 업그레이드에는 엄격한 규칙이 있다:

1. **한 마이너 버전씩만** 업그레이드 가능 (예: 1.30 → 1.31, 1.31 → 1.32)
2. **1.30 → 1.32로 건너뛰기 불가** (반드시 1.31을 거쳐야 함)
3. **Control Plane을 먼저**, Worker Node를 나중에 업그레이드
4. kubelet은 apiserver보다 **최대 2 마이너 버전** 낮을 수 있다

```
쿠버네티스 버전 표기: v1.31.2
                      │  │  │
                      │  │  └─ 패치 버전 (버그 수정)
                      │  └──── 마이너 버전 (기능 추가)
                      └─────── 메이저 버전
```

### 4.2 업그레이드 전체 흐름도

```
[Control Plane 업그레이드]
    │
    ├── 1. kubeadm 패키지 업그레이드
    ├── 2. kubeadm upgrade plan (확인)
    ├── 3. kubeadm upgrade apply v1.XX.Y
    ├── 4. kubectl drain <master-node>
    ├── 5. kubelet, kubectl 패키지 업그레이드
    ├── 6. systemctl daemon-reload && restart kubelet
    └── 7. kubectl uncordon <master-node>
    │
    ▼
[Worker Node 업그레이드] (각 노드마다 반복)
    │
    ├── 1. kubectl drain <worker-node> (Control Plane에서 실행)
    ├── 2. SSH 접속
    ├── 3. kubeadm 패키지 업그레이드
    ├── 4. kubeadm upgrade node (upgrade apply가 아님!)
    ├── 5. kubelet, kubectl 패키지 업그레이드
    ├── 6. systemctl daemon-reload && restart kubelet
    ├── 7. SSH 종료
    └── 8. kubectl uncordon <worker-node> (Control Plane에서 실행)
```

### 4.3 Control Plane 업그레이드 상세 절차

```bash
# === Control Plane Master 노드에서 실행 ===

# Step 1: kubeadm 업그레이드
sudo apt-mark unhold kubeadm                    # 패키지 고정 해제
sudo apt-get update                              # 패키지 목록 업데이트
sudo apt-get install -y kubeadm=1.31.0-1.1      # 새 버전 설치
sudo apt-mark hold kubeadm                      # 패키지 고정 (자동 업데이트 방지)

# Step 2: 업그레이드 계획 확인 (어떤 컴포넌트가 업그레이드되는지 미리 확인)
sudo kubeadm upgrade plan
# 출력 예:
# [upgrade/config] Making sure the configuration is correct:
# ...
# Components that must be upgraded manually after you have upgraded the control plane with 'kubeadm upgrade apply':
# COMPONENT   CURRENT       TARGET
# kubelet     v1.30.0       v1.31.0
#
# Upgrade to the latest version in the v1.31 series:
# COMPONENT                 CURRENT   TARGET
# kube-apiserver            v1.30.0   v1.31.0
# kube-controller-manager   v1.30.0   v1.31.0
# kube-scheduler            v1.30.0   v1.31.0
# kube-proxy                v1.30.0   v1.31.0
# CoreDNS                   v1.11.1   v1.11.3
# etcd                      3.5.12    3.5.15

# Step 3: Control Plane 컴포넌트 업그레이드 (apiserver, scheduler, controller-manager, etcd)
sudo kubeadm upgrade apply v1.31.0
# ※ Control Plane 첫 번째 노드에서만 "apply" 사용
# ※ 추가 Control Plane 노드에서는 "kubeadm upgrade node" 사용

# Step 4: 노드 drain (워크로드 퇴거)
# ※ 다른 터미널 또는 exit 후 실행
kubectl drain <master-node> --ignore-daemonsets --delete-emptydir-data

# Step 5: kubelet, kubectl 업그레이드
sudo apt-mark unhold kubelet kubectl
sudo apt-get install -y kubelet=1.31.0-1.1 kubectl=1.31.0-1.1
sudo apt-mark hold kubelet kubectl

# Step 6: kubelet 재시작
sudo systemctl daemon-reload        # 서비스 설정 리로드
sudo systemctl restart kubelet       # kubelet 재시작

# Step 7: 스케줄링 재개
kubectl uncordon <master-node>

# 확인
kubectl get nodes
```

### 4.4 Worker Node 업그레이드 상세 절차

```bash
# === Control Plane에서 실행 ===

# Step 1: Worker Node drain (워크로드를 다른 노드로 이동)
kubectl drain <worker-node> --ignore-daemonsets --delete-emptydir-data

# === Worker Node에 SSH 접속 ===
ssh admin@<worker-node-ip>

# Step 2: kubeadm 업그레이드
sudo apt-mark unhold kubeadm
sudo apt-get update
sudo apt-get install -y kubeadm=1.31.0-1.1
sudo apt-mark hold kubeadm

# Step 3: 노드 설정 업그레이드
sudo kubeadm upgrade node
# ※ "upgrade apply"가 아니라 "upgrade node"!
# ※ Control Plane은 apply, Worker는 node

# Step 4: kubelet, kubectl 업그레이드
sudo apt-mark unhold kubelet kubectl
sudo apt-get install -y kubelet=1.31.0-1.1 kubectl=1.31.0-1.1
sudo apt-mark hold kubelet kubectl

# Step 5: kubelet 재시작
sudo systemctl daemon-reload
sudo systemctl restart kubelet

# === SSH 종료 ===
exit

# === Control Plane에서 실행 ===
# Step 6: 스케줄링 재개
kubectl uncordon <worker-node>

# 확인
kubectl get nodes
# 모든 노드가 v1.31.0으로 표시되어야 함
```

### 4.5 Control Plane vs Worker Node 업그레이드 차이점 정리

| 항목 | Control Plane | Worker Node |
|---|---|---|
| kubeadm 명령 | `kubeadm upgrade apply v1.XX.Y` | `kubeadm upgrade node` |
| drain 실행 위치 | 다른 터미널/노드에서 | Control Plane에서 |
| 업그레이드 대상 | apiserver, scheduler, CM, etcd | kubelet 설정만 |
| 순서 | 먼저 | 나중에 |

### 4.6 drain / cordon / uncordon 완벽 이해

```
                    ┌─────────────┐
                    │  Ready      │  ← 정상 상태. 새 Pod 스케줄 가능
                    │  (Schedulable)│
                    └──────┬──────┘
                           │
                    cordon │ (스케줄링만 차단)
                           │
                    ┌──────▼──────┐
                    │  Ready,     │  ← 기존 Pod는 유지, 새 Pod만 차단
                    │  Scheduling │
                    │  Disabled   │
                    └──────┬──────┘
                           │
                    drain  │ (스케줄링 차단 + 기존 Pod 퇴거)
                           │
                    ┌──────▼──────┐
                    │  Ready,     │  ← Pod 없음, 새 Pod도 차단
                    │  Scheduling │
                    │  Disabled   │
                    └──────┬──────┘
                           │
                    uncordon│ (스케줄링 재개)
                           │
                    ┌──────▼──────┐
                    │  Ready      │  ← 다시 정상 상태
                    │  (Schedulable)│
                    └─────────────┘
```

**명령어 비교:**

| 명령어 | 동작 | 기존 Pod | 새 Pod 스케줄링 |
|---|---|---|---|
| `kubectl cordon <node>` | 스케줄링만 차단 | 유지 | 차단 |
| `kubectl drain <node>` | cordon + 기존 Pod 퇴거 | 퇴거(다른 노드로 이동) | 차단 |
| `kubectl uncordon <node>` | 스케줄링 재개 | - | 허용 |

**drain 주요 옵션:**

```bash
kubectl drain <node> \
  --ignore-daemonsets \           # DaemonSet Pod는 무시 (다른 노드로 이동 불가하므로)
  --delete-emptydir-data \        # emptyDir 사용 Pod도 퇴거 (데이터 손실 경고 무시)
  --force \                       # ReplicaSet/Job 등에 속하지 않는 단독 Pod도 삭제
  --grace-period=60 \             # 종료 유예 시간 (초)
  --timeout=120s \                # drain 명령 타임아웃
  --dry-run=client                # 실제 실행하지 않고 시뮬레이션
```

---

## 5. 동작 원리 심화

### 5.1 etcd snapshot save 내부 동작

```
etcdctl snapshot save 실행
    │
    ▼
[1] etcd 서버에 TLS 연결 (인증서 검증)
    │
    ▼
[2] etcd 서버에 Snapshot API 호출
    │
    ▼
[3] etcd가 현재 메모리+디스크 데이터의 일관된 스냅샷 생성
    │   - 이 시점의 모든 키-값 데이터가 포함됨
    │   - 진행 중인 쓰기는 완료된 것만 포함 (ACID 보장)
    ▼
[4] 스냅샷 데이터를 지정된 파일로 저장
    │
    ▼
[5] 해시값과 메타데이터 기록
```

### 5.2 etcd snapshot restore 내부 동작

```
etcdctl snapshot restore 실행
    │
    ▼
[1] 스냅샷 파일 읽기 및 무결성 검증 (해시 확인)
    │
    ▼
[2] 새 데이터 디렉터리에 etcd 데이터 파일 생성
    │   - WAL (Write-Ahead Log) 파일 생성
    │   - 스냅샷 데이터 복원
    │   - 멤버 정보 초기화
    ▼
[3] 새 클러스터 ID 할당
    │   - 기존 클러스터와 혼동 방지
    ▼
[4] 완료 메시지 출력
```

### 5.3 kubeadm upgrade apply 내부 동작

```
kubeadm upgrade apply v1.31.0 실행
    │
    ▼
[1] Preflight checks
    │   - 현재 버전 확인
    │   - 업그레이드 가능 여부 확인
    │   - 인증서 유효성 확인
    ▼
[2] Static Pod 매니페스트 업데이트
    │   - /etc/kubernetes/manifests/ 파일들의 이미지 태그 변경
    │   - apiserver, scheduler, controller-manager, etcd
    ▼
[3] kubelet이 변경을 감지하고 Static Pod 재시작
    │   - 각 컴포넌트가 새 버전으로 교체
    ▼
[4] 애드온 업데이트
    │   - CoreDNS ConfigMap/Deployment 업데이트
    │   - kube-proxy DaemonSet 업데이트
    ▼
[5] 인증서 갱신 (필요시)
    │
    ▼
[6] 완료 메시지
```

---

## 6. 시험 출제 패턴 분석

### 6.1 이 주제가 시험에서 어떻게 나오는가

etcd 백업/복구와 클러스터 업그레이드는 CKA에서 **가장 자주 출제되는 주제**이다.

**출제 유형:**
1. **etcd 스냅샷 저장** - 인증서 경로가 주어지거나 직접 찾아야 하는 문제
2. **etcd 스냅샷 복구** - 스냅샷 파일이 주어지고 새 데이터 디렉터리로 복구하는 문제
3. **노드 drain/uncordon** - 유지보수를 위해 노드를 비우고 복구하는 문제
4. **클러스터 업그레이드** - Control Plane 또는 Worker Node를 특정 버전으로 업그레이드하는 문제

### 6.2 문제의 의도

- etcd 인증서 경로를 암기하거나 찾을 수 있는가?
- snapshot save와 restore의 차이(인증서 필요 여부)를 이해하는가?
- 복구 후 매니페스트 수정이 필요하다는 것을 아는가?
- 업그레이드 순서(Control Plane 먼저, Worker 나중)를 지키는가?
- drain과 uncordon을 적절히 사용하는가?

---

## 7. 실전 시험 문제 (12문제)

### 문제 1. etcd 스냅샷 저장 [7%]

**컨텍스트:** `kubectl config use-context platform`

etcd 데이터베이스의 스냅샷을 `/opt/etcd-snapshot.db` 경로에 저장하라.
- etcd 엔드포인트: `https://127.0.0.1:2379`
- 인증서는 etcd Pod의 설정에서 확인하라

<details>
<summary>풀이 과정</summary>

**의도:** etcd 인증서 경로를 찾고 snapshot save를 실행할 수 있는지 확인

```bash
kubectl config use-context platform

# Step 1: 인증서 경로 확인 (시험에서 기억 안 날 때!)
kubectl -n kube-system get pod etcd-platform-master -o yaml | grep -E "cert|key|ca"
# 또는
kubectl -n kube-system describe pod etcd-platform-master | grep -E "cert|key|ca"

# Step 2: SSH 접속
ssh admin@<platform-master-ip>

# Step 3: 스냅샷 저장
sudo ETCDCTL_API=3 etcdctl snapshot save /opt/etcd-snapshot.db \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key

# Step 4: 검증
sudo ETCDCTL_API=3 etcdctl snapshot status /opt/etcd-snapshot.db --write-out=table

exit
```

**체크포인트:**
- `ETCDCTL_API=3`을 빠뜨리지 않았는가?
- 인증서 경로 4개가 모두 정확한가?
- sudo를 사용했는가? (인증서 파일은 root 소유)

</details>

---

### 문제 2. etcd 스냅샷 복구 [7%]

**컨텍스트:** `kubectl config use-context staging`

`/opt/etcd-backup.db` 스냅샷을 사용하여 etcd를 복구하라. 복구된 데이터 디렉터리는 `/var/lib/etcd-from-backup`을 사용하라.

<details>
<summary>풀이 과정</summary>

```bash
# Step 1: SSH 접속
ssh admin@<staging-master-ip>

# Step 2: 스냅샷 복구 (인증서 불필요!)
sudo ETCDCTL_API=3 etcdctl snapshot restore /opt/etcd-backup.db \
  --data-dir=/var/lib/etcd-from-backup

# Step 3: etcd 매니페스트 수정
sudo vi /etc/kubernetes/manifests/etcd.yaml
# volumes 섹션에서 hostPath.path를 변경:
#   path: /var/lib/etcd  →  path: /var/lib/etcd-from-backup

# 또는 sed로 빠르게 수정:
sudo sed -i 's|path: /var/lib/etcd$|path: /var/lib/etcd-from-backup|' \
  /etc/kubernetes/manifests/etcd.yaml

# Step 4: etcd Pod 재시작 대기 (1~2분)
sleep 30
sudo crictl ps | grep etcd

# Step 5: 클러스터 정상 동작 확인
kubectl get nodes
kubectl get pods -A
```

**핵심 체크:**
- `snapshot restore`에 인증서 옵션을 넣지 않았는가? (불필요!)
- `--data-dir`에 새 경로를 지정했는가?
- 매니페스트의 `hostPath.path`를 변경했는가?

</details>

---

### 문제 3. etcd 백업 + 복구 통합 문제 [7%]

**컨텍스트:** `kubectl config use-context staging`

1. 현재 상태의 etcd 스냅샷을 `/tmp/current-snapshot.db`에 저장하라
2. 테스트용 네임스페이스 `test-ns`를 생성하라
3. `/tmp/current-snapshot.db` 스냅샷으로 etcd를 복구하라 (data-dir: `/var/lib/etcd-test-restore`)
4. `test-ns` 네임스페이스가 사라졌는지 확인하라

<details>
<summary>풀이 과정</summary>

```bash
ssh admin@<staging-master-ip>

# 1. 현재 상태 백업
sudo ETCDCTL_API=3 etcdctl snapshot save /tmp/current-snapshot.db \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key

# 2. 테스트 네임스페이스 생성
kubectl create namespace test-ns
kubectl get namespace test-ns  # 확인

# 3. 백업 시점으로 복구
sudo ETCDCTL_API=3 etcdctl snapshot restore /tmp/current-snapshot.db \
  --data-dir=/var/lib/etcd-test-restore

sudo sed -i 's|path: /var/lib/etcd$|path: /var/lib/etcd-test-restore|' \
  /etc/kubernetes/manifests/etcd.yaml

# 재시작 대기
sleep 60

# 4. 복구 확인
kubectl get namespace test-ns
# Error from server (NotFound): namespaces "test-ns" not found
# → 백업 시점에는 test-ns가 없었으므로 사라짐!

# 정리: 원래 상태로 복원
sudo sed -i 's|path: /var/lib/etcd-test-restore|path: /var/lib/etcd|' \
  /etc/kubernetes/manifests/etcd.yaml

exit
```

</details>

---

### 문제 4. 노드 drain [4%]

**컨텍스트:** `kubectl config use-context prod`

`prod-worker1` 노드를 유지보수를 위해 스케줄링 불가 상태로 만들고, 모든 워크로드를 퇴거하라. DaemonSet은 무시하라.

<details>
<summary>풀이 과정</summary>

```bash
kubectl config use-context prod

# drain 실행
kubectl drain prod-worker1 --ignore-daemonsets --delete-emptydir-data

# 상태 확인
kubectl get nodes
# prod-worker1: Ready,SchedulingDisabled

# Pod가 다른 노드로 이동했는지 확인
kubectl get pods -A -o wide | grep prod-worker1
# DaemonSet Pod만 남아있어야 함

# 유지보수 완료 후 uncordon
kubectl uncordon prod-worker1

# 정상 상태 확인
kubectl get nodes
```

**핵심:**
- `--ignore-daemonsets`: DaemonSet Pod는 다른 노드로 이동 불가하므로 무시
- `--delete-emptydir-data`: emptyDir 볼륨 사용 Pod도 퇴거 (데이터 손실 허용)
- `drain` = `cordon` + 기존 Pod 퇴거

</details>

---

## tart-infra 실습

### 실습 환경 설정

```bash
# platform 클러스터 접속 (etcd가 실행되는 클러스터)
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/platform.yaml
kubectl config use-context platform
```

### 실습 1: etcd 상태 확인 및 데이터 조회

```bash
# etcd Pod 확인
kubectl get pods -n kube-system -l component=etcd

# etcd Pod의 실행 명령에서 인증서 경로 확인
kubectl describe pod etcd-platform-master -n kube-system | grep -E '(--cert-file|--key-file|--trusted-ca-file|--listen-client-urls)'
```

**예상 출력:**
```
NAME                     READY   STATUS    RESTARTS   AGE
etcd-platform-master     1/1     Running   0          30d

--cert-file=/etc/kubernetes/pki/etcd/server.crt
--key-file=/etc/kubernetes/pki/etcd/server.key
--trusted-ca-file=/etc/kubernetes/pki/etcd/ca.crt
--listen-client-urls=https://127.0.0.1:2379,https://192.168.64.10:2379
```

**동작 원리:**
1. etcd는 Static Pod로 Control Plane 노드에서 실행된다
2. TLS 인증서(cert-file, key-file, trusted-ca-file)를 사용해 통신을 암호화한다
3. `listen-client-urls`는 kube-apiserver가 etcd에 접속하는 엔드포인트 주소이다
4. CKA 시험에서 etcd 백업/복구 시 이 인증서 경로를 `etcdctl` 옵션에 전달해야 한다

### 실습 2: drain/cordon으로 노드 유지보수 시뮬레이션

```bash
# dev 클러스터로 전환
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/dev.yaml
kubectl config use-context dev

# 현재 워커 노드의 Pod 분포 확인
kubectl get pods -n demo -o wide

# 워커 노드를 cordon (스케줄링 비활성화)
kubectl cordon dev-worker1
kubectl get nodes
```

**예상 출력:**
```
NAME          STATUS                     ROLES           AGE   VERSION
dev-master    Ready                      control-plane   30d   v1.31.0
dev-worker1   Ready,SchedulingDisabled   <none>          30d   v1.31.0
```

```bash
# cordon 해제 (실습 환경 복구)
kubectl uncordon dev-worker1
kubectl get nodes
```

**동작 원리:**
1. `cordon`은 노드의 `spec.unschedulable: true`를 설정하여 새 Pod 스케줄링을 차단한다
2. 기존 실행 중인 Pod에는 영향을 주지 않는다 (drain과의 차이)
3. `drain`은 cordon + 기존 Pod 퇴거(eviction)를 함께 수행한다
4. `uncordon`으로 `spec.unschedulable`을 해제하면 다시 스케줄링 대상이 된다

### 실습 3: 클러스터 버전 정보 확인

```bash
# 클러스터 버전 확인 (업그레이드 가능 여부 판단 기초)
kubectl version --short 2>/dev/null || kubectl version
kubectl get nodes -o custom-columns='NAME:.metadata.name,VERSION:.status.nodeInfo.kubeletVersion'
```

**예상 출력:**
```
NAME          VERSION
dev-master    v1.31.0
dev-worker1   v1.31.0
```

**동작 원리:**
1. `kubectl version`은 클라이언트(kubectl)와 서버(API Server) 버전을 모두 표시한다
2. kubeadm upgrade 시 Control Plane → Worker Node 순서로 업그레이드해야 한다
3. 모든 노드의 kubelet 버전이 동일한지 확인하는 것이 업그레이드 전 필수 점검 사항이다

