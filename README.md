# Tart Multi-Cluster Kubernetes Infrastructure

Apple Silicon Mac 한 대에서 **프로덕션급 멀티클러스터 K8s 환경**을 자동으로 구축하고,
SRE 운영 대시보드로 부하 테스트 · 스케일링 · 트래픽 관측 · 인프라 분석까지 수행하는 풀스택 프로젝트.

---

## 목차

1. [전체 아키텍처](#전체-아키텍처)
2. [클러스터 구성](#클러스터-구성)
3. [기술 스택](#기술-스택)
4. [SRE 운영 대시보드](#sre-운영-대시보드)
5. [요구 사항](#요구-사항)
6. [설치 및 실행](#설치-및-실행)
7. [일상 운영](#일상-운영)
8. [서비스 접속](#서비스-접속)
9. [데모 앱](#데모-앱)
10. [프로젝트 구조](#프로젝트-구조)
11. [학습용 기술 문서](#학습용-기술-문서)
12. [검증 명령 모음](#검증-명령-모음)

---

## 전체 아키텍처

```
┌──────────────────────────────────────────────────────────────────────────┐
│  MacBook Pro Apple Silicon (M4 Max · 16 CPU / 128GB RAM)               │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  Tart VM Layer  (Apple Hypervisor.framework · ARM64 네이티브)    │   │
│  │                                                                  │   │
│  │  ┌─────────── platform ──────────┐  ┌──────── dev ──────────┐   │   │
│  │  │  master   (2C/4G)             │  │  master  (2C/4G)      │   │   │
│  │  │  worker1  (3C/12G)            │  │  worker1 (2C/8G)      │   │   │
│  │  │  worker2  (2C/8G)             │  └────────────────────────┘   │   │
│  │  └───────────────────────────────┘                               │   │
│  │  ┌──────── staging ─────────┐  ┌──────────── prod ────────────┐  │   │
│  │  │  master  (2C/4G)         │  │  master  (2C/3G)             │  │   │
│  │  │  worker1 (2C/8G)         │  │  worker1 (2C/8G)             │  │   │
│  │  └──────────────────────────┘  │  worker2 (2C/8G)             │  │   │
│  │                                └──────────────────────────────┘  │   │
│  │                                                                  │   │
│  │  총 10 VM / 21 vCPU / ~71.5 GB RAM                              │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                        │
│  ┌──────────── K8s Layer ───────────────────────────────────────────┐   │
│  │  kubeadm v1.31 · Cilium eBPF CNI · Hubble 네트워크 가시성       │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                        │
│  ┌── SRE Dashboard ──┐  ┌── IaC ─────────────┐  ┌── CI/CD ────────┐   │
│  │ React + Express    │  │ Bash Scripts        │  │ ArgoCD (GitOps) │   │
│  │ 6 페이지 · 9 API   │  │ Terraform           │  │ Jenkins (CI)    │   │
│  └────────────────────┘  └─────────────────────┘  └─────────────────┘   │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 클러스터 구성

4개 클러스터가 각각 독립된 역할을 수행하며, 실제 기업 환경의 멀티클러스터 전략을 재현한다.

### platform — 관리 클러스터

중앙 관제탑. 모니터링 · CI/CD · 알림 인프라가 집중 배치된다.

| 노드 | 스펙 | 역할 |
|------|------|------|
| platform-master | 2 vCPU / 4 GB | Control Plane (etcd, apiserver, scheduler, controller-manager) |
| platform-worker1 | 3 vCPU / 12 GB | **Prometheus** + **Grafana** + **Loki** + **AlertManager** (옵저버빌리티 전담) |
| platform-worker2 | 2 vCPU / 8 GB | **Jenkins** + **ArgoCD** (CI/CD 전담) |

| 항목 | 값 |
|------|-----|
| Pod CIDR | `10.10.0.0/16` |
| Service CIDR | `10.96.0.0/16` |
| 설치 대상 | Cilium + Hubble, kube-prometheus-stack (Prometheus/Grafana/AlertManager), Loki, ArgoCD, Jenkins |
| 알림 규칙 | HighCpuUsage, HighMemoryUsage, NodeNotReady, PodCrashLooping, PodOOMKilled 등 8개 PrometheusRule |

### dev — 개발·실험 클러스터

모든 실험적 기능이 적용되는 메인 워크로드 클러스터. Service Mesh, L7 네트워크 보안, HPA 오토스케일링, 부하 테스트가 여기서 수행된다.

| 노드 | 스펙 | 역할 |
|------|------|------|
| dev-master | 2 vCPU / 4 GB | Control Plane |
| dev-worker1 | 2 vCPU / 8 GB | 데모 앱 + Istio 사이드카 + HPA 대상 워크로드 |

| 항목 | 값 |
|------|-----|
| Pod CIDR | `10.20.0.0/16` |
| Service CIDR | `10.97.0.0/16` |
| 설치 대상 | Cilium + Hubble, **Istio** Service Mesh (mTLS/카나리/서킷브레이커), **metrics-server** + HPA, **CiliumNetworkPolicy** (Zero Trust L7), 데모 앱 (nginx, httpbin v1/v2, redis) |

적용된 기능:

| 기능 | 설정 | 설명 |
|------|------|------|
| Zero Trust | `default-deny.yaml` | 모든 ingress 차단, DNS만 허용 후 화이트리스트 개별 추가 |
| L7 필터 | `allow-nginx-to-httpbin.yaml` | nginx → httpbin **HTTP GET만** 허용 (POST/DELETE 차단) |
| mTLS | PeerAuthentication STRICT | 모든 Pod 간 통신 TLS 암호화 |
| 카나리 배포 | VirtualService | httpbin v1: 80% / v2: 20% 트래픽 분할 |
| 서킷브레이커 | DestinationRule | 연속 5xx 3회 → 인스턴스 30초 격리 |
| HPA | nginx-web | CPU 50% 기준, 3→10 Pod 자동 확장 |
| HPA | httpbin | CPU 50% 기준, 2→6 Pod 자동 확장 |
| PDB | nginx-web / httpbin | minAvailable: 2 / 1 — 스케일다운 시 최소 가용성 보장 |

### staging — 사전 검증 클러스터

프로덕션 배포 전 최종 검증 환경. dev에서 검증된 설정을 한 단계 더 확인한다.

| 노드 | 스펙 | 역할 |
|------|------|------|
| staging-master | 2 vCPU / 4 GB | Control Plane |
| staging-worker1 | 2 vCPU / 8 GB | 워크로드 검증 |

| 항목 | 값 |
|------|-----|
| Pod CIDR | `10.30.0.0/16` |
| Service CIDR | `10.98.0.0/16` |
| 설치 대상 | Cilium + Hubble, metrics-server |

### prod — 프로덕션 클러스터

안정성 최우선. 워커 노드 2개로 고가용성을 확보한다.

| 노드 | 스펙 | 역할 |
|------|------|------|
| prod-master | 2 vCPU / 3 GB | Control Plane |
| prod-worker1 | 2 vCPU / 8 GB | 프로덕션 워크로드 |
| prod-worker2 | 2 vCPU / 8 GB | 프로덕션 워크로드 (이중화) |

| 항목 | 값 |
|------|-----|
| Pod CIDR | `10.40.0.0/16` |
| Service CIDR | `10.99.0.0/16` |
| 설치 대상 | Cilium + Hubble |

### 클러스터 비교 요약

| | platform | dev | staging | prod |
|---|---|---|---|---|
| **역할** | 관제·모니터링·CI/CD | 개발·실험·테스트 | 사전 검증 | 프로덕션 |
| **노드 수** | 3 (7C / 24G) | 2 (4C / 12G) | 2 (4C / 12G) | 3 (6C / 19G) |
| **Cilium + Hubble** | O | O | O | O |
| **Istio Mesh** | — | O | — | — |
| **NetworkPolicy L7** | — | O | — | — |
| **HPA + PDB** | — | O | O (metrics-server) | — |
| **Prometheus/Grafana** | O | — | — | — |
| **Jenkins/ArgoCD** | O | — | — | — |
| **데모 앱** | — | O | — | — |

---

## 기술 스택

하향식으로, 사용자가 접하는 계층부터 인프라 기반까지 정리한다.

### 7계층 — SRE 대시보드 & 테스트

| 기술 | 역할 |
|------|------|
| React 19 + Vite 7 + TypeScript | SPA 프론트엔드 (6개 페이지, react-router-dom) |
| Tailwind CSS 4 | 다크 테마 UI |
| Recharts 3 | 시계열 AreaChart · LineChart · 게이지 차트 |
| Express 5 + TypeScript | REST API 서버 (9개 엔드포인트) |
| ssh2 (npm) | VM SSH 커넥션 풀 (10개 상시 연결) |
| k6 | K8s Job 기반 HTTP 부하 생성기 |
| stress-ng | K8s Job 기반 CPU/메모리 스트레스 테스트 |

### 6계층 — Service Mesh

| 기술 | 역할 |
|------|------|
| Istio (Envoy) | mTLS · 카나리 배포 · 서킷브레이커 (dev 클러스터 demo 네임스페이스) |

### 5계층 — 옵저버빌리티 & 알림

| 기술 | 역할 |
|------|------|
| Prometheus | 메트릭 수집/저장 (Pull 기반 TSDB) |
| Grafana | 시각화 대시보드 (K8s 클러스터 · 노드 · Pod 프리셋) |
| Loki + Promtail | 로그 수집/검색 |
| AlertManager | 알림 라우팅 (8개 규칙, 웹훅 수신기) |
| Hubble | Cilium 내장 네트워크 플로우 관측 |

### 4계층 — 네트워크 보안

| 기술 | 역할 |
|------|------|
| CiliumNetworkPolicy | L3/L4/L7 Zero Trust (default-deny + 화이트리스트) |

### 3계층 — 오케스트레이션 & 스케일링

| 기술 | 역할 |
|------|------|
| Kubernetes v1.31 (kubeadm) | 컨테이너 오케스트레이션 |
| metrics-server | Pod CPU/메모리 메트릭 (HPA 소스) |
| HPA | CPU 기반 수평 자동 확장 |
| PDB | 최소 가용성 보장 |

### 2계층 — 네트워크 (CNI)

| 기술 | 역할 |
|------|------|
| Cilium v1.16.5 (eBPF) | CNI — kube-proxy 완전 대체, L7 정책, Hubble 내장 |

### 1계층 — 컨테이너 런타임

| 기술 | 역할 |
|------|------|
| containerd | K8s 표준 CRI (SystemdCgroup 드라이버) |

### 0계층 — 가상화 & OS

| 기술 | 역할 |
|------|------|
| Tart | Apple Hypervisor.framework 기반 ARM64 네이티브 VM 런타임 |
| Ubuntu 24.04 (ARM64) | 게스트 OS |

### IaC & 자동화

| 기술 | 역할 |
|------|------|
| Bash 스크립트 | 명령형 자동화 (12단계 설치, 부팅, 종료, 상태 확인) |
| Terraform | 선언형 인프라 관리 (상태 추적, plan 미리보기) |
| Helm | K8s 패키지 관리 (values 파일 기반 재현 가능 배포) |

### CI/CD

| 기술 | 역할 |
|------|------|
| ArgoCD | GitOps 배포 (Git → Single Source of Truth) |
| Jenkins | CI 빌드 파이프라인 |

---

## SRE 운영 대시보드

실시간 인프라 모니터링, 부하 테스트, 스케일링 관측, 트래픽 분석을 통합한 웹 대시보드.

```bash
cd dashboard && npm install && npm run dev
# → http://localhost:3000
```

### 페이지 구성 (6개)

#### 1. Overview (`/`)

4개 클러스터 2×2 요약 카드. 각 카드에 노드 수, Pod 상태 (Running/Pending/Failed 뱃지), 평균 CPU/RAM 사용률 바, 네임스페이스별 Pod 분포 테이블이 표시된다.

#### 2. Cluster Detail (`/cluster/:name`)

개별 클러스터 심층 분석. 노드별 CPU/Memory/Disk 게이지 차트, RX/TX 네트워크 스파크라인, 열린 포트 테이블, Pod 목록이 확장/축소 가능한 카드로 제공된다.

#### 3. Testing (`/testing`)

13개 프리셋 시나리오 + 커스텀 테스트를 대시보드에서 직접 실행한다. 테스트 진행 중 실시간 프로그레스 바, 완료 시 p95/p99 지연시간 · RPS · 에러율 등 핵심 지표가 표시된다. 결과는 CSV로 다운로드 가능하다.

| 시나리오 | 타입 | 설정 |
|----------|------|------|
| Light Load | HTTP | 10 VUs / 15s |
| Standard Load | HTTP | 50 VUs / 30s |
| Heavy Load | HTTP | 200 VUs / 60s |
| Ramp-up Test | HTTP | 0→100 VUs, ramp 10s, sustain 30s |
| Httpbin API Test | HTTP | 30 VUs / 20s → httpbin /get |
| Strict SLA Test | HTTP | 50 VUs / 30s, p95<500ms, err<1% |
| Scale Test — Light | Scaling | 30 VUs / 60s + 60s cooldown |
| Scale Test — Heavy | Scaling | 200 VUs / 120s + 60s cooldown |
| Scale Test — Ramp | Scaling | 150 VUs, ramp 30s / 60s + 60s cooldown |
| CPU Stress Light | CPU | 1 worker / 30s |
| CPU Stress Heavy | CPU | 2 workers / 60s |
| Memory Stress 64M | Memory | 1 worker / 30s / 64M |
| Memory Stress 128M | Memory | 2 workers / 60s / 128M |

커스텀 테스트에서는 VU 수, 지속시간, 대상 URL, Ramp-up, SLA 임계값, 워커 수, VM 바이트 등을 자유롭게 설정할 수 있다.

#### 4. Traffic (`/traffic`)

Hubble 기반 실시간 네트워크 플로우 시각화.

- **전체 뷰**: 4개 클러스터를 카드로 나열, 클러스터별 트래픽 건수/프로토콜 요약
- **단일 클러스터 뷰**: SVG 토폴로지 맵 — 네임스페이스별로 그룹된 서비스 노드, 베지어 커브 에지로 트래픽 흐름 표시 (초록=FORWARDED / 빨강=DROPPED)
- 상위 연결 테이블, 최근 플로우 이벤트 테이블 제공

#### 5. Scaling (`/scaling`)

HPA 오토스케일링 실시간 모니터링.

- HPA 상태 카드: 현재 레플리카/최대 레플리카, 스케일 진행도 바, SCALING/AT MAX 뱃지
- Pod 레플리카 시계열 차트 (AreaChart, stepAfter)
- CPU 사용률 추이 차트 (LineChart) vs 타겟 CPU 기준선
- HPA 설정 테이블 (Namespace/Deployment/Current/Desired/Min/Max/CPU Usage/Target)

#### 6. Load Analysis (`/analysis`)

부하 테스트 중 인프라 동작을 종합 분석하는 전용 페이지.

- **테스트 셀렉터**: 스케일링 테스트 드롭다운 (실행 중 테스트 자동 선택, LIVE 뱃지)
- **KPI 요약 카드**: Scale-up Latency / Peak Replicas / Scale-down Start / RPS per Pod
- **Pod Scaling Timeline**: AreaChart — deployment별 레플리카 수 시계열, 부하 구간(파란 음영)/Cooldown 구간(주황 음영) 표시
- **Throughput vs Pods**: 이중 Y축 — 좌측 레플리카 수 Area + 우측 RPS 기준선
- **Per-Pod Efficiency**: LineChart — 각 시점별 RPS/Pod 효율성 추이
- **상세 분석 뷰** (토글): 테스트 설정 요약 + 디플로이먼트별 Baseline→Peak→Final 비교 (레플리카/CPU 변화량) + CPU 사용률 시계열 + HPA 이벤트 로그
- **트래픽 플로우 테이블**: 테스트 중 발생한 네트워크 흐름 (Source→Dest, Flows, 프로토콜, Verdict)
- **Infrastructure Impact**: VM별 CPU/Memory 현재 상태

### 백엔드 API (9개)

| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/health` | 서버 헬스체크 |
| GET | `/api/snapshot` | 전체 인프라 스냅샷 (VM, 리소스, 포트, 네트워크, 클러스터, Pod) |
| GET | `/api/traffic?cluster=X` | Hubble 트래픽 플로우 + 집계 에지 |
| GET | `/api/traffic/all` | 전 클러스터 트래픽 |
| GET | `/api/cluster/:name/services` | K8s 서비스 + 엔드포인트 |
| POST | `/api/tests/run` | k6/stress-ng/scaling 테스트 실행 |
| GET | `/api/tests/status` | 모든 테스트 상태 조회 |
| DELETE | `/api/tests/:id` | 테스트 삭제 + K8s Job 정리 |
| GET | `/api/scaling/:cluster` | HPA 스케일링 시계열 히스토리 |

### 백그라운드 수집 루프

| 루프 | 주기 | 수집 대상 |
|------|------|----------|
| Main | 5초 | VM 정보 (tart), SSH 리소스 (top/free/df/ss/net), kubectl 노드/Pod |
| Scaling | 5초 | HPA 상태 (360포인트 링버퍼) |
| Traffic | 10초 | Hubble 네트워크 플로우 (최근 200건) |
| Services | 30초 | K8s 서비스/엔드포인트 |

---

## 요구 사항

| 항목 | 최소 | 권장 |
|------|------|------|
| Mac | Apple Silicon (M1 이상) | M4 Max |
| RAM | 64 GB | 128 GB |
| 디스크 | 100 GB 여유 | 200 GB+ |
| macOS | 13 Ventura 이상 | 최신 |

---

## 설치 및 실행

### 1단계: 저장소 클론

```bash
git clone https://github.com/iamywl/IaC_apple_sillicon.git
cd IaC_apple_sillicon
```

### 2단계: 의존성 설치

```bash
brew install tart kubectl helm jq sshpass terraform
```

| 도구 | 용도 |
|------|------|
| `tart` | Apple Hypervisor 기반 ARM64 VM 관리 |
| `kubectl` | Kubernetes CLI |
| `helm` | K8s 패키지 매니저 |
| `jq` | JSON 파서 (설정 파일 파싱) |
| `sshpass` | SSH 비밀번호 자동 입력 |
| `terraform` | Infrastructure as Code |

### 3단계: 골든 이미지 빌드 (권장, 최초 1회)

containerd · kubeadm · K8s/Cilium 이미지를 미리 설치한 VM 틀을 만들어둔다.

```bash
./scripts/build-golden-image.sh    # ~10분
```

빌드가 끝나면 `config/clusters.json`의 `base_image`를 변경한다:

```diff
- "base_image": "ghcr.io/cirruslabs/ubuntu:latest",
+ "base_image": "k8s-golden",
```

> 골든 이미지 없이도 설치 가능하다. 이 단계를 건너뛰면 Phase 2~4가 매 VM마다 실행된다.

### 4단계: 전체 설치 (한 줄)

```bash
./scripts/install.sh
```

이 명령 하나로 다음이 **자동으로** 실행된다:

```
Phase 1  → VM 10개 생성 (tart clone + 리소스 할당)
Phase 2  → 노드 준비 (swap off, kernel modules, sysctl)       ← 골든 이미지 시 스킵
Phase 3  → containerd 설치                                    ← 골든 이미지 시 스킵
Phase 4  → kubeadm, kubelet, kubectl 설치                     ← 골든 이미지 시 스킵
Phase 5  → K8s 4개 클러스터 초기화 (kubeadm init + worker join)
Phase 6  → Cilium CNI + Hubble 설치 (전체 클러스터)
Phase 7  → Prometheus + Grafana + Loki 모니터링 (platform)
Phase 8  → Jenkins + ArgoCD CI/CD (platform)
Phase 9  → AlertManager + 알림 규칙 (platform)
Phase 10 → CiliumNetworkPolicy L7 보안 (dev)
Phase 11 → metrics-server + HPA 오토스케일링 (dev, staging)
Phase 12 → Istio Service Mesh (dev)
```

| 방식 | 소요 시간 |
|------|----------|
| 골든 이미지 사용 | **15~20분** |
| 골든 이미지 없이 | 45~60분 |

### 4단계 (대안): Terraform으로 설치

```bash
cd terraform
terraform init
terraform plan     # 변경 사항 미리보기
terraform apply    # 인프라 프로비저닝
```

---

## 일상 운영

### 맥북 켰을 때

```bash
./scripts/boot.sh
```

VM 10개 시작 → 클러스터 헬스체크 → 서비스 검증까지 자동 수행.

### 상태 확인

```bash
./scripts/status.sh
```

모든 VM 상태, 4개 클러스터 노드 Ready 여부, Platform 서비스 Pod 상태를 한눈에 확인.

### 맥북 끄기 전

```bash
./scripts/shutdown.sh
```

워커 노드 drain → VM graceful stop. 데이터 손실 없이 안전하게 종료.

### 전체 삭제

```bash
./scripts/destroy.sh
# 또는
cd terraform && terraform destroy
```

---

## 서비스 접속

VM IP는 DHCP이므로 재부팅 시 변경될 수 있다. 아래 명령으로 확인:

```bash
tart ip platform-worker1
```

### Platform 클러스터 서비스

| 서비스 | URL | 계정 |
|--------|-----|------|
| Grafana | `http://<platform-worker1>:30300` | admin / admin |
| AlertManager | `http://<platform-worker1>:30903` | — |
| ArgoCD | `http://<platform-worker1>:30800` | admin / 아래 명령 |
| Jenkins | `http://<platform-worker1>:30900` | admin / admin |
| Hubble UI | `http://<platform-worker1>:31235` | — |

```bash
# ArgoCD 비밀번호 확인
kubectl --kubeconfig kubeconfig/platform.yaml \
  -n argocd get secret argocd-initial-admin-secret \
  -o jsonpath="{.data.password}" | base64 -d && echo
```

### Dev 클러스터 서비스

| 서비스 | URL |
|--------|-----|
| Nginx 데모 | `http://<dev-worker1>:30080` |
| Istio Gateway | NodePort (자동 할당) |

### SRE 대시보드

```bash
cd dashboard && npm install && npm run dev
# → http://localhost:3000
```

### kubectl 접속

```bash
# 클러스터별
kubectl --kubeconfig kubeconfig/platform.yaml get nodes
kubectl --kubeconfig kubeconfig/dev.yaml get nodes
kubectl --kubeconfig kubeconfig/staging.yaml get nodes
kubectl --kubeconfig kubeconfig/prod.yaml get nodes

# 멀티 클러스터 통합
export KUBECONFIG=kubeconfig/platform.yaml:kubeconfig/dev.yaml:kubeconfig/staging.yaml:kubeconfig/prod.yaml
kubectl config get-contexts

# SSH 접속 (모든 VM 공통)
ssh admin@$(tart ip dev-worker1)    # 비밀번호: admin
```

---

## 데모 앱

dev 클러스터 `demo` 네임스페이스에 배포:

| 앱 | 이미지 | replicas | 용도 |
|----|--------|----------|------|
| nginx-web | nginx:alpine | 3 (HPA: 3→10) | 웹서버, NodePort 30080, 부하 테스트 대상 |
| httpbin v1 | kong/httpbin | 2 (HPA: 2→6) | REST API 테스트, 카나리 80% |
| httpbin v2 | kong/httpbin | 1 | 카나리 배포 대상 (20%) |
| redis | redis:7-alpine | 1 | 캐시/세션 저장소 |

---

## 프로젝트 구조

```
tart-infra/
│
├── config/
│   └── clusters.json                   ← 클러스터/VM 정의 (Single Source of Truth)
│
├── scripts/
│   ├── install.sh                      ← 전체 설치 (Phase 1~12)
│   ├── build-golden-image.sh           ← 골든 이미지 빌드 (최초 1회)
│   ├── boot.sh                         ← 일상 시작 (VM 부팅 → 헬스체크)
│   ├── shutdown.sh                     ← 안전 종료 (drain → stop)
│   ├── status.sh                       ← 전체 상태 확인
│   ├── destroy.sh                      ← 완전 삭제
│   ├── lib/                            ← 공유 함수 라이브러리
│   │   ├── common.sh                   ← 설정 파싱, 로깅, 유틸리티
│   │   ├── vm.sh                       ← VM 생명주기 (clone/start/stop/delete)
│   │   ├── ssh.sh                      ← SSH 연결 (exec/scp/wait)
│   │   └── k8s.sh                      ← K8s 관리 (init/join/cilium/hubble)
│   ├── install/                        ← 설치 단계 01~12
│   └── boot/                           ← 부팅 단계 01~03
│
├── manifests/
│   ├── cilium-values.yaml              ← Cilium CNI (eBPF, kubeProxyReplacement)
│   ├── hubble-values.yaml              ← Hubble 네트워크 관측
│   ├── monitoring-values.yaml          ← Prometheus + Grafana + AlertManager
│   ├── loki-values.yaml                ← Loki 로그 수집
│   ├── argocd-values.yaml              ← ArgoCD GitOps
│   ├── jenkins-values.yaml             ← Jenkins CI
│   ├── metrics-server-values.yaml      ← metrics-server (HPA 메트릭)
│   ├── alerting/                       ← PrometheusRule + 웹훅 수신기
│   ├── network-policies/               ← CiliumNetworkPolicy (Zero Trust L7)
│   ├── hpa/                            ← HPA + PDB
│   ├── istio/                          ← Istio 전체 설정 (mTLS, 카나리, 서킷브레이커)
│   └── demo/                           ← nginx, httpbin, redis, k6, stress-ng 매니페스트
│
├── terraform/
│   ├── main.tf                         ← 모듈 조합 (vms → k8s → helm)
│   ├── variables.tf                    ← clusters.json의 HCL 버전
│   ├── outputs.tf                      ← VM IP, kubeconfig, 서비스 URL
│   └── modules/
│       ├── tart-vm/                    ← VM 생성 → 시작 → IP 대기
│       ├── k8s-cluster/                ← kubeadm init/join
│       └── helm-releases/              ← Helm 차트 선언적 관리
│
├── dashboard/                          ← SRE 운영 웹 대시보드
│   ├── server/
│   │   ├── index.ts                    ← Express 서버 + API 라우팅 (9개 엔드포인트)
│   │   ├── collector.ts                ← 백그라운드 수집 루프 (VM/Pod/트래픽/HPA)
│   │   ├── jobs.ts                     ← K8s Job 라이프사이클 (k6/stress-ng/scaling 실행·결과·CSV)
│   │   ├── collectors/
│   │   │   ├── hubble.ts               ← Hubble CLI 트래픽 수집기
│   │   │   ├── scaling.ts              ← HPA 스케일링 수집기
│   │   │   └── services.ts             ← K8s 서비스/엔드포인트 수집기
│   │   └── parsers/
│   │       ├── k6.ts                   ← k6 출력 파서 (p95/p99/avg/RPS/에러율)
│   │       └── stress-ng.ts            ← stress-ng 출력 파서 (bogo-ops)
│   ├── src/
│   │   ├── App.tsx                     ← 라우팅 루트 (6개 Route)
│   │   ├── pages/
│   │   │   ├── OverviewPage.tsx        ← 클러스터 2×2 요약
│   │   │   ├── ClusterDetailPage.tsx   ← 노드/Pod/서비스 상세
│   │   │   ├── TestingPage.tsx         ← 13개 시나리오 + 커스텀 테스트
│   │   │   ├── TrafficPage.tsx         ← SVG 토폴로지 + 트래픽 플로우
│   │   │   ├── ScalingPage.tsx         ← HPA 시계열 모니터링
│   │   │   └── LoadAnalysisPage.tsx    ← 부하 테스트 인프라 종합 분석
│   │   ├── components/layout/
│   │   │   ├── AppShell.tsx            ← 사이드바 + 헤더 레이아웃
│   │   │   ├── Sidebar.tsx             ← 6개 네비게이션 링크
│   │   │   └── Header.tsx              ← 상태 표시 바
│   │   └── hooks/
│   │       └── usePolling.ts           ← 실시간 폴링 커스텀 훅
│   └── shared/
│       └── types.ts                    ← 프론트/백엔드 공유 타입 (25개 인터페이스)
│
├── kubeconfig/                         ← 클러스터별 kubeconfig (.gitignore)
│
└── doc/
    ├── dashboard.md                    ← 대시보드 상세 기술 문서
    ├── 20260227_010000_bug_report.md   ← 버그 7건 + 해결 과정
    └── learning/                       ← 학습용 기술 문서 (아래 참조)
```

---

## 학습용 기술 문서

이 프로젝트가 **어떻게 동작하는지**, 소프트웨어 공학 관점에서 설명하는 문서:

| 문서 | 내용 |
|------|------|
| [아키텍처 설계](doc/learning/architecture.md) | 8계층 레이어드 아키텍처, 멀티클러스터 CIDR 설계, clusters.json이 Single Source of Truth인 이유, 스크립트 디자인 패턴 (Facade · Strategy · Template Method), CPU 오버커밋 전략, Zero Trust 보안, ADR 5건 |
| [네트워크 심화](doc/learning/networking.md) | Tart NAT vs Softnet, Cilium eBPF가 iptables보다 빠른 이유, kubeProxyReplacement 부트스트랩 순환의존성, CiliumNetworkPolicy L7 HTTP 필터링, Istio 사이드카 mTLS/카나리/서킷브레이커, 패킷이 nginx→httpbin으로 가는 9단계 전체 경로 |
| [IaC와 자동화](doc/learning/iac-automation.md) | Bash 명령형 vs Terraform 선언형 비교, Phase 1~12 실행 흐름, null_resource로 Tart CLI 래핑, DHCP IP 해결 패턴, 멱등성 구현, Helm values 관리, GitOps 원칙, Day 0/1/2 자동화 분류 |
| [모니터링/옵저버빌리티](doc/learning/monitoring.md) | 옵저버빌리티 3기둥 (Metrics·Logs·Traces), Prometheus Pull 모델, Grafana 코드 프로비저닝, AlertManager 알림 흐름 (그룹핑·억제), HPA 공식 `⌈replicas × current/target⌉`, PDB 상호작용, 커스텀 대시보드 SSH Pool |
| [트러블슈팅 가이드](doc/learning/troubleshooting.md) | 6단계 디버깅 프레임워크, VM→SSH→K8s→Pod→Service 레이어별 체크리스트, 실제 버그 7건의 원인분석→가설→검증→해결 과정, kubectl/Helm/Cilium 진단 명령, 재해복구 절차 |

---

## 검증 명령 모음

```bash
# 전체 상태 확인
./scripts/status.sh

# 모든 VM IP 확인
for vm in platform-master platform-worker1 platform-worker2 \
          dev-master dev-worker1 staging-master staging-worker1 \
          prod-master prod-worker1 prod-worker2; do
  echo "$vm: $(tart ip $vm 2>/dev/null || echo 'not running')"
done

# Cilium 상태
kubectl --kubeconfig kubeconfig/dev.yaml exec -n kube-system ds/cilium -- cilium status

# Hubble 네트워크 관측
kubectl --kubeconfig kubeconfig/dev.yaml -n kube-system port-forward svc/hubble-relay 4245:80 &
hubble observe --namespace demo --verdict DROPPED

# Istio mTLS 확인
kubectl --kubeconfig kubeconfig/dev.yaml -n demo \
  exec deploy/nginx-web -c nginx -- curl -s http://httpbin/get

# HPA 실시간 확인
kubectl --kubeconfig kubeconfig/dev.yaml -n demo get hpa -w

# AlertManager 확인
open http://$(tart ip platform-worker1):30903

# Grafana 접속
open http://$(tart ip platform-worker1):30300
```

---

## 참고 문서

| 문서 | 설명 |
|------|------|
| [대시보드 기술 문서](doc/dashboard.md) | SRE 대시보드 아키텍처, API 9개, Job 관리, 트래픽 토폴로지, 스케일링 수집 |
| [버그 리포트](doc/20260227_010000_bug_report.md) | 7건 버그 발견 및 해결 과정 |
| [Tart 소개](doc/tart.md) | Tart VM 런타임 개요 |
| [Terraform 연동](doc/terraform.md) | Terraform 모듈 설계 |
