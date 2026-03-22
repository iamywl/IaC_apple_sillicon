# tart-infra 프로젝트 완전 가이드

> 이 문서는 프로젝트의 구동 원리, 코드베이스 구조, 데이터 흐름을 처음부터 이해할 수 있도록 작성되었습니다.

---

## 1. 프로젝트 한 줄 요약

**Apple Silicon Mac 한 대에서 10개의 VM으로 4개의 독립 Kubernetes 클러스터를 구성하고, 모니터링/CI·CD/서비스 메시까지 포함한 프로덕션급 인프라를 자동화한 프로젝트.**

---

## 2. 전체 아키텍처

```
┌─────────────────────────────────────────────────────────────────┐
│  MacBook Pro (Apple Silicon)                                    │
│                                                                 │
│  ┌── 레이어 0: Tart 가상화 ──────────────────────────────────┐ │
│  │  Tart (Apple Hypervisor Framework) + softnet 브릿지        │ │
│  │                                                             │ │
│  │  platform-master ─┐                dev-master ───┐         │ │
│  │  platform-worker1 ├─ platform      dev-worker1 ──┴─ dev    │ │
│  │  platform-worker2 ┘  (3노드)                       (2노드)  │ │
│  │                                                             │ │
│  │  staging-master ──┐                prod-master ──┐         │ │
│  │  staging-worker1 ─┴─ staging       prod-worker1 ─┤         │ │
│  │                      (2노드)        prod-worker2 ─┴─ prod   │ │
│  │                                                   (3노드)   │ │
│  └─────────────────────────────────────────────────────────────┘ │
│           ↑ SSH (sshpass)          ↑ kubectl/helm               │
│                                                                 │
│  ┌── 로컬 프로세스 ──────────────────────────────────────────┐ │
│  │  scripts/ (Bash 자동화) ← config/clusters.json (설정 원본) │ │
│  │  terraform/ (IaC 대안)                                     │ │
│  │  dashboard/ (React + Express SRE 대시보드)                 │ │
│  └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### 클러스터별 역할

| 클러스터 | 노드 수 | CPU/RAM | 역할 | 핵심 구성요소 |
|----------|---------|---------|------|---------------|
| **platform** | 3 | 7C/24G | 중앙 관리 | Prometheus, Grafana, Loki, Jenkins, ArgoCD, AlertManager |
| **dev** | 2 | 4C/12G | 개발/실험 | Istio 서비스 메시, HPA, 데모 앱, L7 네트워크 정책 |
| **staging** | 2 | 4C/12G | 스테이징 | Cilium, metrics-server, HPA 테스트 |
| **prod** | 3 | 6C/19G | 프로덕션 | HA(워커 2개), Cilium + Hubble |

### 네트워크 CIDR 설계

각 클러스터는 독립된 네트워크 대역을 사용하여 IP 충돌 없이 격리됩니다:

```
platform:  Pod 10.10.0.0/16, Service 10.96.0.0/16
dev:       Pod 10.20.0.0/16, Service 10.97.0.0/16
staging:   Pod 10.30.0.0/16, Service 10.98.0.0/16
prod:      Pod 10.40.0.0/16, Service 10.99.0.0/16
```

---

## 3. 핵심 구동 원리

### 3.1 설정의 단일 원본 (Single Source of Truth)

모든 것의 시작점은 `config/clusters.json` 입니다:

```json
{
  "base_image": "ghcr.io/cirruslabs/ubuntu:latest",
  "ssh_user": "admin",
  "ssh_password": "admin",
  "clusters": [
    {
      "name": "platform",
      "pod_cidr": "10.10.0.0/16",
      "service_cidr": "10.96.0.0/16",
      "nodes": [
        { "name": "platform-master", "role": "master", "cpu": 2, "memory": 4096, "disk": 20 }
      ]
    }
  ]
}
```

모든 스크립트와 대시보드가 이 파일을 `jq`로 파싱하여 클러스터 이름, 노드 목록, CPU/메모리 등을 읽어옵니다.
→ 노드를 추가하거나 리소스를 변경하고 싶으면 이 파일만 수정하면 됩니다.

### 3.2 설치 파이프라인 (install.sh)

`scripts/install.sh`가 전체 설치를 12단계로 오케스트레이션합니다:

```
Phase 1   VM 생성 (tart clone + 리소스 할당)
  ↓
Phase 2   노드 준비 (swap off, 커널 모듈, sysctl)     ┐
Phase 3   containerd 설치 (컨테이너 런타임)              ├─ 골든 이미지면 스킵
Phase 4   kubeadm 설치 (kubelet, kubectl v1.31)         ┘
  ↓
Phase 5   클러스터 초기화 (kubeadm init + worker join)
Phase 6   Cilium + Hubble 설치 (eBPF CNI)
  ↓
Phase 7   모니터링 (Prometheus, Grafana, Loki)         ← platform 전용
Phase 8   CI/CD (ArgoCD, Jenkins)                     ← platform 전용
Phase 9   알림 규칙 (PrometheusRule, AlertManager)     ← platform 전용
  ↓
Phase 10  네트워크 정책 (CiliumNetworkPolicy L7)       ← dev 전용
Phase 11  HPA + PDB (오토스케일링)                     ← dev/staging
Phase 12  Istio 서비스 메시 (mTLS, 카나리)             ← dev 전용
```

**골든 이미지 최적화**: Phase 2~4는 모든 노드에 동일한 작업을 수행하므로, 미리 준비된 이미지(`k8s-golden`)를 사용하면 이 단계를 건너뛰어 설치 시간이 45~60분 → 15~20분으로 단축됩니다.

### 3.3 일상 운영 사이클

```
┌─ boot.sh ──────────────────────────────────────┐
│  1. VM 10개 전부 시작 (tart run)                │
│  2. SSH 접속 대기 → 클러스터 노드 Ready 대기     │
│  3. 플랫폼 서비스 정상 확인 (Grafana, ArgoCD 등) │
└────────────────────────────────────────────────┘
             ↕  (하루 동안 작업)
┌─ shutdown.sh ──────────────────────────────────┐
│  1. 워커 노드 drain (파드 안전 이동)             │
│  2. VM 10개 전부 중지 (tart stop)               │
│  → Mac 종료/슬립 안전                           │
└────────────────────────────────────────────────┘
```

### 3.4 VM ↔ Kubernetes 연결 방식

```
[Mac] → tart run (Apple Hypervisor) → [Ubuntu 24.04 ARM64 VM]
                                            ↓
                                      containerd (CRI)
                                            ↓
                                      kubelet ← kubeadm join
                                            ↓
                                      Kubernetes Node
                                            ↓
                                      Cilium (eBPF CNI)
                                            ↓
                                      Pod 네트워킹 완성
```

Mac에서 VM에 접근하는 방법은 2가지:
1. **SSH**: `sshpass -p admin ssh admin@<VM_IP>` — 스크립트 자동화, 대시보드 리소스 수집
2. **kubectl**: `kubectl --kubeconfig kubeconfig/<cluster>.yaml` — 쿠버네티스 API 호출

---

## 4. 코드베이스 가이드

### 4.1 디렉토리 구조 한눈에 보기

```
tart-infra/
├── config/clusters.json          ★ 설정 원본 (여기만 수정하면 전체 반영)
│
├── scripts/                      ★ Bash 자동화 프레임워크
│   ├── install.sh                   전체 설치 오케스트레이터
│   ├── boot.sh                      일일 시작
│   ├── shutdown.sh                  안전 종료
│   ├── status.sh                    상태 확인
│   ├── destroy.sh                   완전 삭제
│   ├── build-golden-image.sh        골든 이미지 빌드
│   ├── install/                     설치 단계별 스크립트 (01~12)
│   ├── boot/                        부팅 단계별 스크립트 (01~03)
│   └── lib/                         ★ 공유 라이브러리
│       ├── common.sh                   설정 파싱, 로깅, kubectl 래퍼
│       ├── vm.sh                       Tart VM 생명주기 (clone/start/stop)
│       ├── ssh.sh                      SSH 실행 유틸리티
│       └── k8s.sh                      K8s 설치/초기화 함수
│
├── manifests/                    ★ Kubernetes YAML/Helm Values
│   ├── cilium-values.yaml           CNI + kube-proxy 대체
│   ├── hubble-values.yaml           네트워크 관측
│   ├── monitoring-values.yaml       Prometheus/Grafana/AlertManager
│   ├── loki-values.yaml             로그 수집
│   ├── argocd-values.yaml           GitOps CD
│   ├── jenkins-values.yaml          CI 파이프라인
│   ├── alerting/                    알림 규칙 + 웹훅 수신기
│   ├── network-policies/            CiliumNetworkPolicy (L7 필터링)
│   ├── hpa/                         오토스케일링 + PDB
│   ├── istio/                       서비스 메시 (mTLS, 카나리, 서킷 브레이커)
│   └── demo/                        데모 앱 (nginx, httpbin, redis, k6)
│
├── dashboard/                    ★ SRE 웹 대시보드
│   ├── server/                      Express 백엔드
│   │   ├── index.ts                    9개 REST API 엔드포인트
│   │   ├── collector.ts                백그라운드 수집 루프 (5/10/30초)
│   │   ├── jobs.ts                     K8s Job 관리 (k6, stress-ng)
│   │   ├── collectors/                 데이터 수집기
│   │   │   ├── tart.ts                    tart list → VM 목록
│   │   │   ├── ssh.ts                     SSH 커넥션 풀
│   │   │   ├── kubectl.ts                 노드/파드 정보
│   │   │   ├── hubble.ts                  트래픽 플로우
│   │   │   ├── scaling.ts                 HPA 이력
│   │   │   └── services.ts               K8s 서비스 목록
│   │   └── parsers/                    출력 파서
│   │       ├── top.ts                     CPU 사용률 파싱
│   │       ├── free.ts                    메모리 파싱
│   │       ├── df.ts                      디스크 파싱
│   │       ├── ss.ts                      포트 파싱
│   │       ├── netdev.ts                  네트워크 I/O 파싱
│   │       ├── k6.ts                      부하 테스트 결과 파싱
│   │       └── stress-ng.ts               스트레스 테스트 파싱
│   ├── src/                         React 프론트엔드
│   │   ├── App.tsx                     라우터 (6페이지)
│   │   └── pages/                      페이지 컴포넌트
│   │       ├── Overview.tsx               전체 클러스터 현황
│   │       ├── ClusterDetail.tsx          클러스터 상세 (CPU/메모리/디스크)
│   │       ├── Testing.tsx                SRE 부하 테스트
│   │       ├── Traffic.tsx                트래픽 토폴로지 시각화
│   │       ├── Scaling.tsx                HPA 오토스케일링 모니터링
│   │       └── LoadAnalysis.tsx           부하 테스트 심층 분석
│   └── shared/types.ts             TypeScript 타입 정의 (25+ 인터페이스)
│
├── terraform/                    Terraform IaC (Bash의 선언적 대안)
│   ├── main.tf                      모듈 오케스트레이션
│   └── modules/
│       ├── tart-vm/                    VM 프로비저닝
│       ├── k8s-cluster/                쿠버네티스 초기화
│       └── helm-releases/              Helm 차트 배포
│
├── doc/                          기술 문서
│   ├── learning/                    학습 문서 (아키텍처, 네트워킹, IaC 등)
│   └── bug-reports/                 버그 발견/해결 기록 (19건)
│
└── kubeconfig/                   생성된 클러스터별 kubeconfig (gitignore)
```

### 4.2 스크립트 라이브러리 의존 관계

```
common.sh (최상위 — 모든 스크립트가 의존)
  ├── 설정 파싱: get_cluster_names(), get_nodes_for_cluster(), get_pod_cidr() 등
  ├── 로깅: log_info(), log_error(), log_section()
  ├── 의존성 체크: check_dependencies()
  └── kubectl 래퍼: kubectl_cmd()

vm.sh (common.sh 의존)
  └── VM 생명주기: vm_clone(), vm_start(), vm_stop(), vm_get_ip(), vm_wait_for_ip()

ssh.sh (common.sh 의존)
  └── 원격 실행: ssh_exec_sudo(), ssh_wait_ready(), scp_from()

k8s.sh (common.sh + vm.sh + ssh.sh 의존)
  └── K8s 설치: prepare_node(), install_containerd(), install_kubeadm()
      init_cluster(), join_nodes(), install_cilium(), install_hubble()
```

### 4.3 대시보드 데이터 흐름

```
┌─────────────────── 백엔드 (Express :3001) ───────────────────┐
│                                                               │
│  startCollector() 호출 시 4개의 백그라운드 루프가 시작됨:      │
│                                                               │
│  [5초마다] collect()                                          │
│    ├── collectVmInfo() → tart list → VM 목록/상태/IP          │
│    ├── SSH 풀로 10개 VM 병렬 접속                              │
│    │    ├── top -bn1 → parseCpuUsage() → CPU %               │
│    │    ├── free -m → parseMemory() → 메모리 사용량            │
│    │    ├── df / → parseDisk() → 디스크 사용량                 │
│    │    ├── ss -tlnp → parsePorts() → 열린 포트               │
│    │    └── /proc/net/dev → parseNetDev() → 네트워크 I/O      │
│    ├── collectClusterInfo() → kubectl get nodes               │
│    └── collectPods() → kubectl get pods --all-namespaces      │
│        ↓                                                      │
│    snapshot 객체에 저장 (메모리 캐시)                          │
│                                                               │
│  [10초마다] collectAllTraffic()                               │
│    └── hubble observe → 트래픽 플로우 (최근 200건 유지)        │
│                                                               │
│  [5초마다] collectAllScaling()                                │
│    └── kubectl get hpa → 360포인트 링 버퍼 (30분 이력)        │
│                                                               │
│  [30초마다] collectAllServices()                              │
│    └── kubectl get svc,endpoints → 서비스 목록                │
│                                                               │
└───────────────────────────────────────────────────────────────┘
            ↑ REST API (GET /api/snapshot 등)
            │
┌─────────── 프론트엔드 (React :3000) ─────────────────────────┐
│  usePolling() 커스텀 훅으로 5초마다 API 호출                   │
│  → 받은 데이터를 페이지별 컴포넌트에서 시각화                   │
│  → Recharts (AreaChart, LineChart, Gauge 등)                  │
│  → Tailwind CSS 다크 테마                                     │
└───────────────────────────────────────────────────────────────┘
```

핵심 패턴: **캐시 어사이드(Cache-Aside)**
- 백그라운드 루프가 주기적으로 데이터를 수집하여 메모리에 저장
- API는 캐시된 데이터를 즉시 반환 (수집과 응답이 분리됨)
- 하나의 VM이 응답하지 않아도 나머지 데이터는 정상 수집됨 (`Promise.allSettled`)

---

## 5. 기술 스택 레이어별 정리

| 레이어 | 기술 | 역할 | 해당 파일 |
|--------|------|------|-----------|
| 가상화 | Tart + Apple Hypervisor | ARM64 VM 실행 | `scripts/lib/vm.sh` |
| OS | Ubuntu 24.04 ARM64 | VM 게스트 OS | `config/clusters.json` |
| 컨테이너 런타임 | containerd + SystemdCgroup | CRI 구현체 | `scripts/lib/k8s.sh` |
| 오케스트레이션 | Kubernetes v1.31 (kubeadm) | 컨테이너 오케스트레이션 | `scripts/install/05-init-clusters.sh` |
| CNI | Cilium v1.16.5 (eBPF) | kube-proxy 완전 대체, L7 정책 | `manifests/cilium-values.yaml` |
| 관측성 | Prometheus + Grafana + Loki | 메트릭/시각화/로그 | `manifests/monitoring-values.yaml` |
| 알림 | AlertManager + PrometheusRule | 8개 알림 규칙, 웹훅 수신 | `manifests/alerting/` |
| CI/CD | ArgoCD + Jenkins | GitOps 배포 + CI 파이프라인 | `manifests/argocd-values.yaml` |
| 서비스 메시 | Istio (Envoy) | mTLS, 카나리 배포, 서킷 브레이커 | `manifests/istio/` |
| 오토스케일링 | HPA + PDB + metrics-server | 자동 스케일링 + 중단 예산 | `manifests/hpa/` |
| 대시보드 | React 19 + Express 5 | SRE 운영 UI | `dashboard/` |
| 테스트 | k6 + stress-ng | 부하/스트레스 테스트 | `manifests/demo/` |

---

## 6. 주요 설계 결정과 이유

### 왜 Tart인가?
Apple Silicon의 네이티브 Hypervisor Framework를 사용하여 x86 에뮬레이션 없이 ARM64 VM을 실행합니다. Docker Desktop보다 더 현실적인 멀티노드 쿠버네티스 환경을 구현할 수 있습니다.

### 왜 Cilium (eBPF)인가?
기존 kube-proxy(iptables 기반)를 완전히 대체(`kubeProxyReplacement: true`)합니다. L3/L4뿐 아니라 L7(HTTP 메서드, 경로) 수준의 네트워크 정책을 적용할 수 있고, Hubble을 통해 네트워크 흐름을 실시간 관측할 수 있습니다.

### 왜 Bash + Terraform 병행인가?
- **Bash** (`scripts/`): 명령형(imperative) 방식. 각 단계를 순서대로 실행하며, 디버깅이 쉽고 학습에 용이합니다.
- **Terraform** (`terraform/`): 선언적(declarative) 방식. 동일한 인프라를 IaC로 관리하는 대안. 프로덕션 환경에 더 적합합니다.
- 두 가지를 모두 구현하여 방식의 차이를 비교할 수 있게 했습니다.

### 왜 4개의 클러스터인가?
실제 기업 환경의 멀티 클러스터 운영을 시뮬레이션합니다:
- **platform**: 다른 클러스터들을 관찰/관리하는 중앙 허브
- **dev → staging → prod**: 코드가 이동하는 배포 파이프라인 반영

### 왜 골든 이미지인가?
Phase 2~4(swap off, containerd, kubeadm)는 10개 노드에 동일 작업을 반복합니다. 한 번 수행한 결과를 이미지로 구워두면(`build-golden-image.sh`), 이후 설치 시 clone만 하면 되어 30분 이상 절약됩니다.

---

## 7. 파일 찾기 가이드 — "이걸 수정하려면 어디를 보지?"

| 하고 싶은 일 | 보아야 할 파일 |
|-------------|---------------|
| 노드 추가/리소스 변경 | `config/clusters.json` |
| 설치 단계 수정 | `scripts/install/<phase>.sh` |
| Cilium 설정 변경 | `manifests/cilium-values.yaml` |
| 모니터링 설정 변경 | `manifests/monitoring-values.yaml` |
| 알림 규칙 추가 | `manifests/alerting/prometheus-rules.yaml` |
| 네트워크 정책 추가 | `manifests/network-policies/` |
| HPA 임계값 변경 | `manifests/hpa/` |
| Istio 트래픽 비율 변경 | `manifests/istio/` |
| 대시보드 API 추가 | `dashboard/server/index.ts` |
| 대시보드 수집기 추가 | `dashboard/server/collectors/` |
| 대시보드 페이지 추가 | `dashboard/src/pages/` |
| 파서 로직 수정 | `dashboard/server/parsers/` |
| 타입 정의 추가 | `dashboard/shared/types.ts` |
| SSH/VM 유틸 수정 | `scripts/lib/vm.sh`, `scripts/lib/ssh.sh` |
| K8s 설치 로직 수정 | `scripts/lib/k8s.sh` |
| 데모 앱 추가 | `manifests/demo/` |
| Terraform 수정 | `terraform/modules/` |

---

## 8. 서비스 접근 URL

모든 서비스는 NodePort로 노출되며, `platform-worker1`의 IP를 통해 접근합니다:

| 서비스 | URL | 인증 |
|--------|-----|------|
| Grafana | `http://<platform-worker1>:30300` | admin / admin |
| ArgoCD | `http://<platform-worker1>:30800` | admin / (시크릿 확인) |
| Jenkins | `http://<platform-worker1>:30900` | admin / (시크릿 확인) |
| AlertManager | `http://<platform-worker1>:30903` | - |
| 데모 nginx | `http://<dev-worker1>:30080` | - |
| SRE 대시보드 | `http://localhost:3000` (프론트) / `:3001` (백엔드) | - |

---

## 9. 일상 운영 명령어

```bash
# 전체 설치 (최초 1회)
./scripts/install.sh

# 매일 아침 — 인프라 시작
./scripts/boot.sh

# 상태 확인
./scripts/status.sh

# 대시보드 시작
cd dashboard && npm run dev

# 퇴근 전 — 안전 종료
./scripts/shutdown.sh

# 완전 초기화 (VM 전부 삭제)
./scripts/destroy.sh

# 클러스터별 kubectl
kubectl --kubeconfig kubeconfig/platform.yaml get nodes
kubectl --kubeconfig kubeconfig/dev.yaml get pods -A
```

---

## 10. 학습 자료 안내

더 깊은 이해가 필요하면 `doc/learning/` 디렉토리를 참고하세요:

| 문서 | 내용 |
|------|------|
| `architecture.md` | 8레이어 설계, CIDR 계획, 설계 패턴, CPU 오버커밋 전략 |
| `networking.md` | Cilium eBPF 원리, L7 필터링, Istio mTLS, 패킷 여정(9홉) |
| `iac-automation.md` | Bash vs Terraform 비교, 멱등성, Helm values 패턴 |
| `monitoring.md` | 관측성 3기둥, Prometheus pull 모델, HPA 공식 |
| `troubleshooting.md` | 6단계 디버깅 프레임워크, 실제 버그 7건 분석 |
| `bug-reports/` | 19건의 버그 발견·해결 기록 |
