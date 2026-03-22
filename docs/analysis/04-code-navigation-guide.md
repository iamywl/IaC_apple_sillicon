# 04. 실무 코드 탐색 가이드

이 문서는 **"코드 전체를 모르는 상태에서 특정 문제를 해결해야 할 때"** 어디부터 봐야 하는지를 시나리오별로 안내합니다.

---

## 원칙: 전체를 읽지 마라, 경로 하나만 따라가라

이 프로젝트에는 수십 개의 파일이 있지만, 하나의 이슈를 해결하는 데 필요한 파일은 보통 **2~3개**입니다.

```
전체 프로젝트                    네가 봐야 할 부분
┌────────────────┐              ┌────────────────┐
│ ████████████   │              │ ░░░░████░░░░   │
│ ████████████   │     →        │ ░░░░░░░░░░░░   │
│ ████████████   │              │ ░░░░░░█░░░░░   │
│ ████████████   │              │ ░░░░░░░░░░░░   │
└────────────────┘              └────────────────┘
  (전체 100%)                     (관련 부분 5~10%)
```

---

## 핵심 진입점 정리

어떤 작업을 하든, 시작점은 이 파일들 중 하나입니다:

| 상황 | 시작 파일 | 역할 |
|------|----------|------|
| 설치 관련 | `scripts/install/install.sh` | 12단계 설치 오케스트레이터 |
| 부팅 관련 | `scripts/boot.sh` | 3단계 부팅 오케스트레이터 |
| 종료 관련 | `scripts/shutdown.sh` | drain + VM 종료 |
| VM 관련 | `scripts/lib/vm.sh` | VM 생성/시작/중지/삭제/IP 조회 |
| SSH 관련 | `scripts/lib/ssh.sh` | SSH 실행, SCP, 연결 대기 |
| K8s 설치 관련 | `scripts/lib/k8s.sh` | containerd, kubeadm, Cilium 설치 |
| 설정 변경 | `config/clusters.json` | 클러스터/노드 정의 |
| Helm 값 변경 | `manifests/*.yaml` | 각 도구의 설치 설정 |
| 대시보드 백엔드 | `dashboard/server/index.ts` | Express 서버 진입점 |
| 대시보드 프론트 | `dashboard/src/App.tsx` | React 라우팅 진입점 |
| Terraform | `terraform/main.tf` | IaC 루트 모듈 |

---

## lib/ 함수 의존관계 맵

모든 스크립트의 기반이 되는 4개 라이브러리 파일입니다:

```
common.sh (기반 — 모든 스크립트가 의존)
  │
  ├── 설정 파싱: get_config(), get_cluster_names(), get_nodes_for_cluster()
  ├── 로깅: log_info(), log_warn(), log_error(), log_section()
  ├── kubectl 래퍼: kubectl_cmd("클러스터명", ...)
  └── 의존성 체크: check_dependencies()
  │
  ├──→ vm.sh (common.sh에 의존)
  │      ├── vm_clone(), vm_start(), vm_stop(), vm_delete()
  │      ├── vm_get_ip(), vm_wait_for_ip()
  │      └── vm_create_all(), vm_start_all(), vm_stop_all()
  │
  ├──→ ssh.sh (common.sh에 의존)
  │      ├── ssh_exec(), ssh_exec_sudo()
  │      ├── scp_to(), scp_from()
  │      └── ssh_wait_ready()
  │
  └──→ k8s.sh (common.sh + vm.sh + ssh.sh 모두에 의존)
         ├── prepare_node(), install_containerd(), install_kubeadm()
         ├── init_cluster() (kubeadm init + join)
         ├── install_cilium(), install_hubble()
         └── wait_nodes_ready()
```

**규칙**: 어떤 함수가 뭔지 모르겠으면 이 4개 파일에서 `grep`으로 찾으면 됩니다.

```bash
grep -n "함수이름" scripts/lib/*.sh
```

---

## 설치 파이프라인 흐름도 (12단계)

```
install.sh (오케스트레이터)
│
├── Phase 1:  01-create-vms.sh        ← vm_create_all() 호출
├── Phase 2:  02-prepare-nodes.sh     ← prepare_node() x 10개   (골든 이미지 시 스킵)
├── Phase 3:  03-install-runtime.sh   ← install_containerd() x 10개 (골든 이미지 시 스킵)
├── Phase 4:  04-install-kubeadm.sh   ← install_kubeadm() x 10개  (골든 이미지 시 스킵)
├── Phase 5:  05-init-clusters.sh     ← init_cluster() x 4개 클러스터
├── Phase 6:  06-install-cilium.sh    ← install_cilium() + install_hubble() x 4개
├── Phase 7:  07-install-monitoring.sh ← Prometheus + Grafana + Loki (platform만)
├── Phase 8:  08-install-cicd.sh      ← ArgoCD + Jenkins (platform만)
├── Phase 9:  09-install-alerting.sh  ← PrometheusRule + webhook (platform만)
├── Phase 10: 10-install-network-policies.sh ← CiliumNetworkPolicy (dev만)
├── Phase 11: 11-install-hpa.sh       ← metrics-server + HPA + PDB (dev+staging)
└── Phase 12: 12-install-istio.sh     ← Istio 서비스 메시 (dev만)
```

**부팅 파이프라인 (3단계):**
```
boot.sh
├── 01-start-vms.sh      ← VM 시작 + SSH 대기
├── 02-wait-clusters.sh   ← kubelet 재시작 + kubeconfig IP 업데이트 + Ready 대기
└── 03-verify-services.sh ← Cilium/모니터링/CI/CD 상태 확인 + URL 출력
```

---

## 시나리오별 코드 탐색 가이드

### 시나리오 1: "Cilium 설치가 실패한다"

```
1. 키워드 검색
   $ grep -rn "cilium" scripts/
   → scripts/install/06-install-cilium.sh
   → scripts/lib/k8s.sh

2. 06-install-cilium.sh 열기 (11줄밖에 안 됨)
   → install_cilium(), install_hubble() 호출하는 게 전부

3. k8s.sh에서 install_cilium() 찾기 (157행)
   → helm upgrade --install cilium ...
   → --values manifests/cilium-values.yaml

4. cilium-values.yaml 확인
   → 설정값에 문제가 있는지 확인

✅ 본 파일: 3개 (06-install-cilium.sh, k8s.sh, cilium-values.yaml)
```

### 시나리오 2: "부팅 후 VM IP가 바뀌어서 kubectl이 안 된다"

```
1. 부팅 스크립트에서 IP 관련 로직 찾기
   $ grep -rn "ip" scripts/boot/
   → 02-wait-clusters.sh 에서 IP 업데이트 로직 발견

2. 02-wait-clusters.sh 열기
   → vm_get_ip()로 새 IP 조회
   → kubeconfig 파일의 server 주소를 새 IP로 교체 (sed 사용)

3. vm_get_ip()가 어떻게 동작하는지 궁금하면
   → scripts/lib/vm.sh에서 vm_get_ip() 확인
   → tart ip 명령어 래핑

✅ 본 파일: 2개 (02-wait-clusters.sh, vm.sh)
```

### 시나리오 3: "새 클러스터를 추가해달라"

```
1. 기존 클러스터 정의 확인
   → config/clusters.json 열기
   → 패턴이 보임: name, pod_cidr, service_cidr, nodes 배열

2. 이 JSON을 누가 읽는지 확인
   $ grep -rn "clusters.json" scripts/
   → scripts/lib/common.sh의 get_config() 함수

3. 클러스터 이름을 어디서 순회하는지 확인
   $ grep -rn "get_cluster_names" scripts/
   → 거의 모든 install 스크립트에서 for 루프로 사용

4. 결론
   → clusters.json에 새 항목 추가하면 모든 스크립트가 자동으로 새 클러스터 처리
   → CIDR이 기존과 겹치지 않게만 설정하면 됨

✅ 수정 파일: 1개 (clusters.json만)
```

### 시나리오 4: "대시보드에서 CPU 사용률이 0%로 나온다"

```
1. 대시보드에서 CPU 데이터가 어디서 오는지 추적
   $ grep -rn "cpu" dashboard/server/
   → server/collectors/ssh.ts에서 SSH로 top 명령 실행
   → server/parsers/top.ts에서 출력 파싱

2. top.ts 열기
   → top -bn1 출력에서 CPU% 추출하는 정규식 확인
   → 파싱 로직에 문제가 있는지 확인

3. ssh.ts에서 실제 실행되는 명령어 확인
   → SSH 연결이 실패하고 있는지, top 명령 자체가 에러인지 판단

✅ 본 파일: 2개 (ssh.ts, top.ts)
```

### 시나리오 5: "HPA가 Pod를 늘리지 않는다"

```
1. HPA 관련 파일 찾기
   $ grep -rn "hpa" manifests/
   → manifests/hpa/nginx-hpa.yaml, httpbin-hpa.yaml

2. nginx-hpa.yaml 열기
   → targetAverageUtilization: 50 (CPU 50% 넘으면 스케일 업)
   → minReplicas: 3, maxReplicas: 10

3. metrics-server가 설치되어 있는지 확인
   → scripts/install/11-install-hpa.sh 열기
   → metrics-server Helm 설치 확인

4. metrics-server 설정 확인
   → manifests/metrics-server-values.yaml
   → --kubelet-insecure-tls 옵션이 있는지 (없으면 인증서 문제로 메트릭 수집 실패)

✅ 본 파일: 3개 (nginx-hpa.yaml, 11-install-hpa.sh, metrics-server-values.yaml)
```

### 시나리오 6: "네트워크 정책 때문에 특정 서비스 통신이 차단된다"

```
1. 네트워크 정책 파일 찾기
   $ ls manifests/network-policies/
   → default-deny.yaml (기본: 전부 차단)
   → allow-external-to-nginx.yaml
   → allow-nginx-to-httpbin.yaml
   → allow-nginx-to-redis.yaml
   → allow-nginx-egress.yaml

2. 어떤 통신이 허용되어 있는지 확인
   → default-deny.yaml: 모든 ingress 차단, DNS egress만 허용
   → 필요한 통신이 allow 정책에 포함되어 있는지 확인

3. 새 정책 추가가 필요하면
   → 기존 allow-*.yaml을 복사해서 수정
   → 10-install-network-policies.sh에서 kubectl apply 추가

✅ 본 파일: 해당 allow-*.yaml 1~2개
```

---

## 실전 탐색 도구 모음

### grep으로 키워드 찾기

```bash
# 특정 함수가 어디에 정의되어 있는지
grep -rn "install_cilium" scripts/lib/

# 특정 설정이 어디서 사용되는지
grep -rn "30300" manifests/     # Grafana 포트 30300

# clusters.json을 읽는 모든 코드
grep -rn "clusters.json" scripts/ terraform/ dashboard/
```

### git blame으로 의도 파악

```bash
# 이 줄을 누가, 왜 작성했는지
git blame scripts/lib/k8s.sh

# 특정 파일의 변경 이력
git log --oneline -10 -- scripts/lib/k8s.sh

# 특정 커밋에서 뭘 바꿨는지
git show <커밋해시>
```

### git log로 히스토리 추적

```bash
# 이 파일이 언제 어떻게 변해왔는지
git log -p -- manifests/cilium-values.yaml

# "cilium" 관련 커밋만 보기
git log --all --oneline --grep="cilium"
```

---

## 점진적 영역 확장 로드맵

이 프로젝트를 처음 접했을 때 권장하는 학습 순서:

```
1일차:   config/clusters.json 읽기 → 클러스터 구성 이해
         scripts/status.sh 실행 → 현재 상태 확인
         scripts/boot.sh 읽기 → 부팅 흐름 이해

1주차:   scripts/lib/ 4개 파일 훑어보기 → 핵심 함수 파악
         scripts/install/ 번호순으로 훑어보기 → 설치 흐름 이해
         manifests/*.yaml 설정값 확인 → 각 도구가 어떻게 설정되었는지

2주차:   dashboard/ 코드 읽기 → 데이터 수집/시각화 파이프라인
         terraform/ 코드 읽기 → Bash와 비교하며 IaC 이해

1개월:   doc/learning/ 학습 문서 읽기 → 아키텍처/네트워킹/모니터링 심화
         doc/bug-reports/ 버그 리포트 읽기 → 실제 발생한 문제와 해결 과정
```

---

## 핵심 요약

| 원칙 | 방법 |
|------|------|
| **뭐가 어디있는지 모를 때** | `grep -rn "키워드" scripts/` or `manifests/` |
| **함수 정의를 찾을 때** | `scripts/lib/` 아래 4개 파일에서 grep |
| **설치 순서가 궁금할 때** | `scripts/install/01~12` 파일명이 곧 실행 순서 |
| **왜 이렇게 짰는지 모를 때** | `git blame` → 커밋 메시지 → 티켓/문서 |
| **설정을 바꿔야 할 때** | `config/clusters.json` + `manifests/*.yaml` |
| **위 방법으로 안 풀릴 때** | `doc/bug-reports/`에서 유사 사례 검색 |

---

## 다음 문서

데이터가 시스템을 어떻게 흘러가는지 알고 싶다면 → [05-data-flow.md](05-data-flow.md)
