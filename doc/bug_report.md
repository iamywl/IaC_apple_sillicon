# Tart Multi-Cluster K8s 인프라 - 전체 버그 리포트

## 프로젝트 정보
- **환경**: M4 Max MacBook Pro (16 CPU, 128GB RAM), macOS Darwin 24.6.0
- **인프라**: Tart VM 7개, K8s 3 클러스터 (kubeadm v1.31)
- **기간**: 2026-02-27

---

## 목차

| # | 타임스탬프 | 심각도 | 카테고리 | 제목 | 상태 |
|---|-----------|--------|----------|------|------|
| BUG-001 | 2026-02-27 01:00 | High | SSH | ssh_exec_sudo 따옴표 깨짐 | 해결 |
| BUG-002 | 2026-02-27 01:15 | High | K8s | conntrack 패키지 미설치 | 해결 |
| BUG-003 | 2026-02-27 01:30 | Critical | Network | VM 간 통신 불가 (Shared Network) | 해결 |
| BUG-004 | 2026-02-27 02:00 | Critical | CNI | Cilium K8s API 서버 접근 실패 | 해결 |
| BUG-005 | 2026-02-27 02:30 | Medium | Script | wait_nodes_ready wc 파싱 에러 | 해결 |
| BUG-006 | 2026-02-27 03:00 | High | CI/CD | Jenkins PVC Pending + Values 키 변경 | 해결 |
| BUG-007 | 2026-02-27 04:00 | Medium | Dashboard | ESM __dirname 미정의 | 해결 |
| BUG-008 | 2026-02-27 04:15 | Medium | Dashboard | tart list 상태 컬럼 파싱 오류 | 해결 |
| BUG-009 | 2026-02-27 04:30 | High | VM | tart ip 전체 null 반환 | 해결 |
| BUG-010 | 2026-02-27 04:45 | Medium | Script | boot.sh SCRIPT_DIR 변수 충돌 | 해결 |

---

## BUG-001: ssh_exec_sudo 따옴표 깨짐

**타임스탬프**: 2026-02-27 01:00
**심각도**: High
**카테고리**: SSH
**발견 단계**: Phase 2 (노드 준비)

### 증상
```
sed: -e expression #1, char 15: unterminated `s' command
```

### 원인
`ssh_exec_sudo` 함수가 `bash -c '$*'` 형태로 명령을 전달하여, `sed`, `iptables` 등 작은따옴표가 포함된 명령의 이스케이핑이 깨짐.

### 트러블슈팅 과정
1. `ssh_exec_sudo` 내부에서 전달되는 명령 문자열 확인
2. `bash -c` 에서 중첩 따옴표 문제 확인
3. heredoc 방식으로 변경하여 따옴표 이스케이핑 문제 근본 해결

### 해결
```bash
# Before (broken)
ssh_exec "$ip" "echo '$password' | sudo -S bash -c '$*'"

# After (fixed)
sshpass -p "$password" ssh $SSH_OPTS "${user}@${ip}" sudo bash -s <<EOF
$*
EOF
```

### 영향 범위
- `scripts/lib/ssh.sh` - ssh_exec_sudo 함수

### 교훈
원격 서버에 복잡한 명령을 전달할 때 heredoc이 안전함. `bash -c` 중첩은 특수문자 이스케이핑 지옥을 유발.

---

## BUG-002: conntrack 패키지 미설치

**타임스탬프**: 2026-02-27 01:15
**심각도**: High
**카테고리**: K8s
**발견 단계**: Phase 5 (클러스터 초기화)

### 증상
```
[ERROR FileExisting-conntrack]: conntrack not found in system path
```

### 원인
kubeadm init preflight 체크에서 `conntrack`이 필수인데 Tart Ubuntu 기본 이미지에 미포함.

### 트러블슈팅 과정
1. `kubeadm init` preflight 오류 메시지 확인
2. Ubuntu VM 내에서 `which conntrack` → 없음 확인
3. `apt-get install conntrack` 추가

### 해결
```bash
apt-get install -y -qq containerd apt-transport-https ca-certificates curl gnupg conntrack
```

### 영향 범위
- `scripts/lib/k8s.sh` - install_containerd 함수

### 교훈
kubeadm preflight는 conntrack, socat, ebtables 등 네트워크 유틸을 요구. 기본 이미지에 없으면 사전 설치 필요.

---

## BUG-003: VM 간 통신 불가 (Shared Network)

**타임스탬프**: 2026-02-27 01:30
**심각도**: Critical
**카테고리**: Network
**발견 단계**: Phase 5 (클러스터 초기화)

### 증상
```
$ ping -c 2 192.168.66.2  # worker1 → master
From 192.168.66.3 icmp_seq=1 Destination Host Unreachable
100% packet loss
```
kubeadm join 실패:
```
error execution phase preflight: couldn't validate the identity of the API Server:
failed to request the cluster-info ConfigMap: client rate limiter Wait returned an error:
rate: Wait(n=1) would exceed context deadline
```

### 원인
Tart 기본 shared networking(NAT)에서 VM 간 직접 통신이 차단됨. macOS Virtualization.framework의 NAT 모드는 호스트→VM만 허용, VM→VM 트래픽은 드롭.

### 트러블슈팅 과정
1. `ping` VM→VM 실패 확인
2. `--net-bridged=en0` 시도 → IP 할당 자체 실패 (shared IP 무효화)
3. Tart 문서에서 `--net-softnet-allow` 플래그 발견
4. `--net-softnet-allow=0.0.0.0/0` 적용 → 소프트웨어 네트워킹으로 VM 간 통신 허용

### 해결
```bash
# Before
tart run "$vm_name" --no-graphics &

# After
tart run "$vm_name" --no-graphics --net-softnet-allow=0.0.0.0/0 &
```
IP 대역 변경: `192.168.66.x` → `192.168.65.x`

### 검증
```
$ ping -c 2 192.168.65.35  # worker1(192.168.65.36) → master
64 bytes from 192.168.65.35: icmp_seq=1 ttl=64 time=0.524 ms
0% packet loss
```

### 영향 범위
- `scripts/lib/vm.sh` - vm_start 함수
- 전체 VM 네트워크 토폴로지 변경

### 교훈
Tart shared networking은 기본적으로 L2 isolation이 적용됨. 멀티 VM 클러스터 환경에서는 `--net-softnet-allow` 필수. IP 대역이 변경되므로 기존 설정 의존성 확인 필요.

---

## BUG-004: Cilium K8s API 서버 접근 실패

**타임스탬프**: 2026-02-27 02:00
**심각도**: Critical
**카테고리**: CNI
**발견 단계**: Phase 6 (Cilium 설치)

### 증상
```
level=error msg="Unable to contact k8s api-server"
ipAddr=https://10.96.0.1:443
error="dial tcp 10.96.0.1:443: i/o timeout"
```

### 원인
`kubeadm init --skip-phases=addon/kube-proxy`로 kube-proxy를 건너뛰었으므로, ClusterIP(10.96.0.1)로의 라우팅이 존재하지 않음. Cilium이 이를 대체해야 하지만 부트스트랩 시점에는 아직 Cilium 자체가 동작 전인 치킨-에그 문제.

### 트러블슈팅 과정
1. `cilium status` → connecting 상태 지속 확인
2. `kubectl logs -n kube-system -l app.kubernetes.io/name=cilium-agent` → ClusterIP 접근 실패 로그
3. Cilium 문서에서 `k8sServiceHost`/`k8sServicePort` 설정 발견
4. 마스터 노드의 실제 IP를 직접 지정하여 ClusterIP 우회

### 해결
```bash
helm upgrade --install cilium cilium/cilium \
  --set k8sServiceHost="$master_ip" \
  --set k8sServicePort=6443 \
  ...
```

### 영향 범위
- `scripts/lib/k8s.sh` - install_cilium 함수

### 교훈
kube-proxy 대체 모드에서 Cilium 설치 시, 부트스트랩 단계에는 ClusterIP 라우팅이 없으므로 반드시 `k8sServiceHost`로 마스터 실제 IP를 지정해야 함. 공식 문서의 "kubeProxy-free" 가이드에 명시되어 있으나 놓치기 쉬운 설정.

---

## BUG-005: wait_nodes_ready wc 파싱 에러

**타임스탬프**: 2026-02-27 02:30
**심각도**: Medium
**카테고리**: Script
**발견 단계**: Phase 6 (Cilium 설치 후 노드 대기)

### 증상
```
/Users/ywlee/tart-infra/scripts/lib/k8s.sh: line 129:
[[: 0
99: syntax error in expression (error token is "99")
```

### 원인
`wc -l` 출력에 선행 공백이 포함(macOS의 wc 동작)되어 `[[ "  0\n99" -eq 0 ]]` 비교가 실패. 또한 파이프 실패 시 기본값 "99"가 같은 줄에 이어붙여짐.

### 트러블슈팅 과정
1. 에러 메시지의 "0\n99" 패턴에서 wc 출력 + fallback 문자열 합쳐짐 확인
2. macOS `wc -l` 의 공백 포함 출력 확인 (`echo test | wc -l` → `       1`)
3. `grep -cv` 로 대체 (직접 카운트, 공백 없음)

### 해결
```bash
# Before
not_ready=$(kubectl_cmd ... | grep -v "Ready" | wc -l || echo "99")

# After
not_ready=$(kubectl_cmd ... | grep -cv " Ready " || true)
```

### 영향 범위
- `scripts/lib/k8s.sh` - wait_nodes_ready 함수

### 교훈
macOS와 Linux의 `wc` 출력 형식이 다름. 크로스 플랫폼 스크립트에서는 `wc` 대신 `grep -c`를 사용하는 것이 안전.

---

## BUG-006: Jenkins PVC Pending + Values 키 변경

**타임스탬프**: 2026-02-27 03:00
**심각도**: High
**카테고리**: CI/CD
**발견 단계**: Phase 8 (CI/CD 설치)

### 증상
```
Warning  FailedScheduling  pod has unbound immediate PersistentVolumeClaims
```
```
Error: `controller.adminPassword` no longer exists. It has been renamed to `controller.admin.password`
```

### 원인
1. kubeadm 기본 설치에는 StorageClass가 없어 PVC가 바인딩 불가
2. Jenkins Helm 차트 최신 버전에서 `controller.adminPassword` → `controller.admin.password`로 키 변경됨

### 트러블슈팅 과정
1. `kubectl get pvc -n jenkins` → Pending 확인
2. `kubectl get sc` → StorageClass 없음 확인
3. local-path-provisioner 설치하여 동적 프로비저닝 활성화
4. Helm 오류 메시지에서 키 변경 안내 확인 → values 수정

### 해결
```bash
# 1. StorageClass 추가
kubectl apply -f https://raw.githubusercontent.com/rancher/local-path-provisioner/v0.0.28/deploy/local-path-storage.yaml
kubectl patch storageclass local-path -p '{"metadata":{"annotations":{"storageclass.kubernetes.io/is-default-class":"true"}}}'
```
```yaml
# 2. Values 키 수정
# Before
controller:
  adminPassword: admin

# After
controller:
  admin:
    password: admin
```

### 영향 범위
- `scripts/install/08-install-cicd.sh` - local-path-provisioner 설치 추가
- `manifests/jenkins-values.yaml` - admin.password 키 변경

### 교훈
kubeadm bare-metal 환경에는 StorageClass가 기본 미포함. Helm 차트의 breaking changes는 릴리스 노트를 확인해야 함.

---

## BUG-007: ESM __dirname 미정의

**타임스탬프**: 2026-02-27 04:00
**심각도**: Medium
**카테고리**: Dashboard
**발견 단계**: 대시보드 백엔드 개발

### 증상
```
ReferenceError: __dirname is not defined in ES module scope
```

### 원인
`dashboard/package.json`에 `"type": "module"` 설정으로 ESM 모드에서 실행. ESM에서는 `__dirname`과 `__filename`이 정의되지 않음.

### 트러블슈팅 과정
1. `tsx watch server/index.ts` 실행 시 `__dirname` 오류 확인
2. package.json의 `"type": "module"` 확인
3. ESM 호환 방식으로 변경

### 해결
```typescript
// Before (CJS only)
const configPath = path.join(__dirname, '../../config/clusters.json');

// After (ESM compatible)
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
```

### 영향 범위
- `dashboard/server/config.ts`

### 교훈
ESM(`"type": "module"`)에서는 `__dirname`, `__filename`, `require`가 없음. `import.meta.url`과 `fileURLToPath`를 사용해야 함.

---

## BUG-008: tart list 상태 컬럼 파싱 오류

**타임스탬프**: 2026-02-27 04:15
**심각도**: Medium
**카테고리**: Dashboard
**발견 단계**: 대시보드 Tart 데이터 수집

### 증상
모든 VM 상태가 "20"으로 표시됨 (실제로는 running/stopped).

### 원인
`tart list` 출력의 컬럼 형식:
```
Source  Name              Disk  Size   Accessed  State
local   platform-master   20    4.9G   30m ago   running
```
고정 인덱스(index 3)로 State를 파싱했으나, 실제로는 "Disk" 컬럼(값: 20)이 선택됨.

### 트러블슈팅 과정
1. VM 상태가 모두 "20"으로 나오는 것 확인
2. `tart list` 실제 출력 컬럼 순서 확인
3. "Accessed" 컬럼이 "30m ago" 처럼 공백 포함하여 split 결과가 가변적임을 발견
4. State가 항상 마지막 컬럼임을 확인

### 해결
```typescript
// Before (wrong column index)
const state = parts[3];

// After (always last column)
const state = parts[parts.length - 1];
```

### 영향 범위
- `dashboard/server/collectors/tart.ts`

### 교훈
CLI 출력 파싱 시 고정 인덱스 의존은 위험. 공백 포함 컬럼("30m ago")이 split 결과를 변동시킴. 마지막 컬럼이나 헤더 기반 파싱이 안전.

---

## BUG-009: tart ip 전체 null 반환

**타임스탬프**: 2026-02-27 04:30
**심각도**: High
**카테고리**: VM
**발견 단계**: 대시보드 데이터 수집 테스트

### 증상
```
[collector] 7 VMs found, but all IPs are null
```
`tart ip <vm>` 명령이 모든 VM에 대해 빈 결과 반환.

### 원인
이전 세션에서 VM이 비정상 종료되어 stale 상태. `tart list`에서 running으로 표시되지만 실제 프로세스는 없는 좀비 상태.

### 트러블슈팅 과정
1. `tart list` → 모든 VM "running" 표시 확인
2. `tart ip platform-master` → 빈 출력 확인
3. VM 프로세스 확인 → 실제 tart 프로세스 없음
4. `shutdown.sh` → `boot.sh` 순서로 정상 재시작

### 해결
```bash
# 1. 정상 종료
./scripts/shutdown.sh

# 2. 재시작 (softnet 모드)
./scripts/boot.sh
```

### 영향 범위
- 전체 인프라 (7개 VM)

### 교훈
Tart VM은 호스트 재부팅 시 프로세스가 종료되지만 상태 파일은 "running"으로 남을 수 있음. `boot.sh`로 재시작하면 정리됨. 대시보드에서는 `tart ip` 실패를 graceful하게 처리해야 함.

---

## BUG-010: boot.sh SCRIPT_DIR 변수 충돌

**타임스탬프**: 2026-02-27 04:45
**심각도**: Medium
**카테고리**: Script
**발견 단계**: 부트 스크립트 실행

### 증상
```
bash: /Users/ywlee/tart-infra/scripts/lib/boot/01-start-vms.sh: No such file or directory
```

### 원인
`boot.sh`와 `scripts/lib/common.sh` 둘 다 `SCRIPT_DIR` 변수를 정의. `common.sh`가 `source`되면서 `boot.sh`의 `SCRIPT_DIR`을 덮어쓰기하여, 이후 `$SCRIPT_DIR/boot/01-start-vms.sh` 경로가 `scripts/lib/boot/01-start-vms.sh`로 잘못 해석됨.

### 트러블슈팅 과정
1. 오류 경로에서 `scripts/lib/boot/` 가 비정상적임을 확인
2. `boot.sh`의 `SCRIPT_DIR`과 `common.sh`의 `SCRIPT_DIR` 이름 충돌 발견
3. `common.sh`의 변수명을 `_COMMON_DIR`로 변경

### 해결
```bash
# Before (common.sh)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# After (common.sh)
_COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
```

### 영향 범위
- `scripts/lib/common.sh` - 변수명 변경
- `scripts/lib/common.sh` 내부에서 `SCRIPT_DIR` 참조하던 모든 곳 → `_COMMON_DIR`로 변경

### 교훈
`source`로 여러 스크립트를 로드할 때 전역 변수명 충돌 주의. 라이브러리 스크립트는 `_` prefix를 사용하여 호출자와의 충돌을 방지.

---

## 버그 통계

| 카테고리 | 건수 | 심각도 분포 |
|----------|------|------------|
| Network/CNI | 2 | Critical: 2 |
| K8s/CI/CD | 2 | High: 2 |
| SSH | 1 | High: 1 |
| VM | 1 | High: 1 |
| Script | 2 | Medium: 2 |
| Dashboard | 2 | Medium: 2 |
| **합계** | **10** | Critical: 2, High: 4, Medium: 4 |

## 핵심 교훈 요약

1. **네트워크 설정은 가장 먼저 검증**: VM 간 통신이 안 되면 K8s 클러스터 자체가 불가 (BUG-003)
2. **부트스트랩 치킨-에그 문제 주의**: kube-proxy 없이 Cilium 설치 시 ClusterIP 우회 필요 (BUG-004)
3. **CLI 출력 파싱은 방어적으로**: 공백, 줄바꿈, OS별 차이를 고려 (BUG-005, BUG-008)
4. **ESM vs CJS 호환성**: `"type": "module"` 설정 시 Node.js 전역 변수 사용 불가 (BUG-007)
5. **셸 변수 스코핑**: `source`로 로드하는 라이브러리는 변수명 충돌 방지 필요 (BUG-010)
6. **Helm 차트 Breaking Changes**: 최신 차트는 키 이름 변경이 빈번 (BUG-006)
7. **VM 상태와 프로세스 상태의 괴리**: 상태 파일만 믿지 말고 실제 프로세스 확인 (BUG-009)
