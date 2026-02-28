# Tart Multi-Cluster Kubernetes Infrastructure

Apple Silicon Mac 한 대에서 **프로덕션급(Production-grade) 멀티클러스터(Multi-cluster) K8s(Kubernetes) 환경**을 자동으로 구축하고,
SRE(Site Reliability Engineering) 운영 대시보드(Operations Dashboard)로 부하 테스트(Load Testing) · 오토스케일링(Auto Scaling) · 트래픽 관측(Traffic Observability) · 인프라 분석(Infrastructure Analysis)까지 수행하는 풀스택(Full-stack) 프로젝트.

---

## 목차(Table of Contents)

1. [전체 아키텍처(Architecture Overview)](#전체-아키텍처architecture-overview)
2. [클러스터 구성(Cluster Configuration)](#클러스터-구성cluster-configuration)
3. [기술 스택(Tech Stack)](#기술-스택tech-stack)
4. [SRE 운영 대시보드(SRE Operations Dashboard)](#sre-운영-대시보드sre-operations-dashboard)
5. [요구 사항(Requirements)](#요구-사항requirements)
6. [설치 및 실행(Installation)](#설치-및-실행installation)
7. [일상 운영(Daily Operations)](#일상-운영daily-operations)
8. [서비스 접속(Service Access)](#서비스-접속service-access)
9. [데모 앱(Demo Applications)](#데모-앱demo-applications)
10. [프로젝트 구조(Project Structure)](#프로젝트-구조project-structure)
11. [학습용 기술 문서(Learning Documents)](#학습용-기술-문서learning-documents)
12. [검증 명령 모음(Verification Commands)](#검증-명령-모음verification-commands)

---

## 전체 아키텍처(Architecture Overview)

```
┌──────────────────────────────────────────────────────────────────────────┐
│  MacBook Pro Apple Silicon (M4 Max · 16 CPU / 128GB RAM)               │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  Tart VM Layer  (Apple Hypervisor.framework · ARM64 Native)     │   │
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
│  │  Total: 10 VMs / 21 vCPU / ~71.5 GB RAM                        │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                        │
│  ┌──────────── K8s Layer ───────────────────────────────────────────┐   │
│  │  kubeadm v1.31 · Cilium eBPF CNI · Hubble Network Observability │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                        │
│  ┌── SRE Dashboard ──┐  ┌── IaC ─────────────┐  ┌── CI/CD ────────┐   │
│  │ React + Express    │  │ Bash Scripts        │  │ ArgoCD (GitOps) │   │
│  │ 6 Pages · 9 APIs   │  │ Terraform           │  │ Jenkins (CI)    │   │
│  └────────────────────┘  └─────────────────────┘  └─────────────────┘   │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 클러스터 구성(Cluster Configuration)

4개 클러스터가 각각 독립된 역할을 수행하며, 실제 기업 환경의 멀티클러스터 전략(Multi-cluster Strategy)을 재현한다.

### platform — 관리 클러스터(Management Cluster)

중앙 관제탑(Central Control Tower). 모니터링(Monitoring) · CI/CD(Continuous Integration/Continuous Delivery) · 알림(Alerting) 인프라가 집중 배치된다.

| 노드(Node) | 스펙(Spec) | 역할(Role) |
|------|------|------|
| platform-master | 2 vCPU / 4 GB | 컨트롤 플레인(Control Plane) — etcd, apiserver, scheduler, controller-manager |
| platform-worker1 | 3 vCPU / 12 GB | **Prometheus** + **Grafana** + **Loki** + **AlertManager** — 옵저버빌리티(Observability) 전담 |
| platform-worker2 | 2 vCPU / 8 GB | **Jenkins** + **ArgoCD** — CI/CD(Continuous Integration/Continuous Delivery) 전담 |

| 항목 | 값 |
|------|-----|
| Pod CIDR(Classless Inter-Domain Routing) | `10.10.0.0/16` |
| Service CIDR(Classless Inter-Domain Routing) | `10.96.0.0/16` |
| 설치 대상(Installed Components) | Cilium + Hubble, kube-prometheus-stack (Prometheus/Grafana/AlertManager), Loki, ArgoCD, Jenkins |
| 알림 규칙(Alert Rules) | HighCpuUsage, HighMemoryUsage, NodeNotReady, PodCrashLooping, PodOOMKilled 등 8개 PrometheusRule |

### dev — 개발·실험 클러스터(Development & Experimentation Cluster)

모든 실험적 기능이 적용되는 메인 워크로드(Workload) 클러스터. 서비스 메시(Service Mesh), L7 네트워크 보안(Network Security), HPA(Horizontal Pod Autoscaler) 오토스케일링(Auto Scaling), 부하 테스트(Load Testing)가 여기서 수행된다.

| 노드(Node) | 스펙(Spec) | 역할(Role) |
|------|------|------|
| dev-master | 2 vCPU / 4 GB | 컨트롤 플레인(Control Plane) |
| dev-worker1 | 2 vCPU / 8 GB | 데모 앱(Demo Apps) + Istio 사이드카(Sidecar) + HPA(Horizontal Pod Autoscaler) 대상 워크로드 |

| 항목 | 값 |
|------|-----|
| Pod CIDR(Classless Inter-Domain Routing) | `10.20.0.0/16` |
| Service CIDR(Classless Inter-Domain Routing) | `10.97.0.0/16` |
| 설치 대상(Installed Components) | Cilium + Hubble, **Istio** 서비스 메시(Service Mesh) — mTLS(mutual TLS)/카나리(Canary)/서킷브레이커(Circuit Breaker), **metrics-server** + HPA(Horizontal Pod Autoscaler), **CiliumNetworkPolicy** — 제로 트러스트(Zero Trust) L7, 데모 앱(Demo Apps) — nginx, httpbin v1/v2, redis |

적용된 기능(Applied Features):

| 기능(Feature) | 설정(Config) | 설명(Description) |
|------|------|------|
| 제로 트러스트(Zero Trust) | `default-deny.yaml` | 모든 인그레스(Ingress) 차단, DNS(Domain Name System)만 허용 후 화이트리스트(Whitelist) 개별 추가 |
| L7 필터(L7 Filtering) | `allow-nginx-to-httpbin.yaml` | nginx → httpbin **HTTP GET만** 허용 (POST/DELETE 차단) |
| 상호 TLS(mTLS) | PeerAuthentication STRICT | 모든 Pod 간 통신 TLS(Transport Layer Security) 암호화(Encryption) |
| 카나리 배포(Canary Deployment) | VirtualService | httpbin v1: 80% / v2: 20% 트래픽 분할(Traffic Splitting) |
| 서킷브레이커(Circuit Breaker) | DestinationRule | 연속 5xx 3회 → 인스턴스 30초 격리(Ejection) |
| HPA(Horizontal Pod Autoscaler) | nginx-web | CPU 50% 기준, 3→10 Pod 자동 확장(Auto Scaling) |
| HPA(Horizontal Pod Autoscaler) | httpbin | CPU 50% 기준, 2→6 Pod 자동 확장(Auto Scaling) |
| PDB(Pod Disruption Budget) | nginx-web / httpbin | minAvailable: 2 / 1 — 스케일다운(Scale-down) 시 최소 가용성(Minimum Availability) 보장 |

### staging — 사전 검증 클러스터(Pre-production Validation Cluster)

프로덕션(Production) 배포 전 최종 검증 환경. dev에서 검증된 설정을 한 단계 더 확인한다.

| 노드(Node) | 스펙(Spec) | 역할(Role) |
|------|------|------|
| staging-master | 2 vCPU / 4 GB | 컨트롤 플레인(Control Plane) |
| staging-worker1 | 2 vCPU / 8 GB | 워크로드 검증(Workload Validation) |

| 항목 | 값 |
|------|-----|
| Pod CIDR(Classless Inter-Domain Routing) | `10.30.0.0/16` |
| Service CIDR(Classless Inter-Domain Routing) | `10.98.0.0/16` |
| 설치 대상(Installed Components) | Cilium + Hubble, metrics-server |

### prod — 프로덕션 클러스터(Production Cluster)

안정성(Stability) 최우선. 워커 노드(Worker Node) 2개로 고가용성(High Availability)을 확보한다.

| 노드(Node) | 스펙(Spec) | 역할(Role) |
|------|------|------|
| prod-master | 2 vCPU / 3 GB | 컨트롤 플레인(Control Plane) |
| prod-worker1 | 2 vCPU / 8 GB | 프로덕션 워크로드(Production Workload) |
| prod-worker2 | 2 vCPU / 8 GB | 프로덕션 워크로드(Production Workload) — 이중화(Redundancy) |

| 항목 | 값 |
|------|-----|
| Pod CIDR(Classless Inter-Domain Routing) | `10.40.0.0/16` |
| Service CIDR(Classless Inter-Domain Routing) | `10.99.0.0/16` |
| 설치 대상(Installed Components) | Cilium + Hubble |

### 클러스터 비교 요약(Cluster Comparison Summary)

| | platform | dev | staging | prod |
|---|---|---|---|---|
| **역할(Role)** | 관제·모니터링·CI/CD(Continuous Integration/Continuous Delivery) | 개발·실험·테스트 | 사전 검증(Pre-prod) | 프로덕션(Production) |
| **노드 수(Nodes)** | 3 (7C / 24G) | 2 (4C / 12G) | 2 (4C / 12G) | 3 (6C / 19G) |
| **Cilium + Hubble** | O | O | O | O |
| **Istio 서비스 메시(Service Mesh)** | — | O | — | — |
| **네트워크 정책(NetworkPolicy) L7** | — | O | — | — |
| **HPA(Horizontal Pod Autoscaler) + PDB(Pod Disruption Budget)** | — | O | O (metrics-server) | — |
| **Prometheus/Grafana** | O | — | — | — |
| **Jenkins/ArgoCD** | O | — | — | — |
| **데모 앱(Demo Apps)** | — | O | — | — |

---

## 기술 스택(Tech Stack)

하향식(Top-down)으로, 사용자가 접하는 계층부터 인프라 기반까지 정리한다.

### 7계층(Layer 7) — SRE 대시보드(Dashboard) & 테스트(Testing)

| 기술(Technology) | 역할(Role) |
|------|------|
| React 19 + Vite 7 + TypeScript | SPA(Single Page Application) 프론트엔드 — 6개 페이지, react-router-dom |
| Tailwind CSS 4 | 다크 테마(Dark Theme) UI |
| Recharts 3 | 시계열(Time Series) AreaChart · LineChart · 게이지 차트(Gauge Chart) |
| Express 5 + TypeScript | REST(Representational State Transfer) API 서버 — 9개 엔드포인트(Endpoint) |
| ssh2 (npm) | VM SSH 커넥션 풀(Connection Pool) — 10개 상시 연결 |
| k6 | K8s Job 기반 HTTP 부하 생성기(Load Generator) |
| stress-ng | K8s Job 기반 CPU/메모리 스트레스 테스트(Stress Test) |

### 6계층(Layer 6) — 서비스 메시(Service Mesh)

| 기술(Technology) | 역할(Role) |
|------|------|
| Istio (Envoy) | 상호 TLS(mTLS) · 카나리 배포(Canary Deployment) · 서킷브레이커(Circuit Breaker) — dev 클러스터 demo 네임스페이스 |

### 5계층(Layer 5) — 옵저버빌리티(Observability) & 알림(Alerting)

| 기술(Technology) | 역할(Role) |
|------|------|
| Prometheus | 메트릭 수집/저장(Metrics Collection/Storage) — Pull 기반 TSDB(Time Series Database) |
| Grafana | 시각화 대시보드(Visualization Dashboard) — K8s 클러스터 · 노드 · Pod 프리셋 |
| Loki + Promtail | 로그 수집/검색(Log Aggregation/Search) |
| AlertManager | 알림 라우팅(Alert Routing) — 8개 규칙, 웹훅 수신기(Webhook Receiver) |
| Hubble | Cilium 내장 네트워크 플로우 관측(Network Flow Observation) |

### 4계층(Layer 4) — 네트워크 보안(Network Security)

| 기술(Technology) | 역할(Role) |
|------|------|
| CiliumNetworkPolicy | L3/L4/L7 제로 트러스트(Zero Trust) — 기본 차단(Default Deny) + 화이트리스트(Whitelist) |

### 3계층(Layer 3) — 오케스트레이션(Orchestration) & 스케일링(Scaling)

| 기술(Technology) | 역할(Role) |
|------|------|
| Kubernetes v1.31 (kubeadm) | 컨테이너 오케스트레이션(Container Orchestration) |
| metrics-server | Pod CPU/메모리 메트릭(Metrics) — HPA(Horizontal Pod Autoscaler) 데이터 소스 |
| HPA(Horizontal Pod Autoscaler) | CPU 기반 수평 자동 확장(Horizontal Auto Scaling) |
| PDB(Pod Disruption Budget) | 최소 가용성 보장(Minimum Availability Guarantee) |

### 2계층(Layer 2) — 네트워크(Network / CNI)

| 기술(Technology) | 역할(Role) |
|------|------|
| Cilium v1.16.5 (eBPF) | CNI(Container Network Interface) — kube-proxy 완전 대체(Full Replacement), L7 정책(Policy), Hubble 내장 |

### 1계층(Layer 1) — 컨테이너 런타임(Container Runtime)

| 기술(Technology) | 역할(Role) |
|------|------|
| containerd | K8s 표준 CRI(Container Runtime Interface) — SystemdCgroup 드라이버 |

### 0계층(Layer 0) — 가상화(Virtualization) & OS

| 기술(Technology) | 역할(Role) |
|------|------|
| Tart | Apple Hypervisor.framework 기반 ARM64 네이티브 VM 런타임(Runtime) |
| Ubuntu 24.04 (ARM64) | 게스트 OS(Guest OS) |

### IaC(Infrastructure as Code) & 자동화(Automation)

| 기술(Technology) | 역할(Role) |
|------|------|
| Bash 스크립트 | 명령형 자동화(Imperative Automation) — 12단계 설치, 부팅, 종료, 상태 확인 |
| Terraform | 선언형 인프라 관리(Declarative Infrastructure Management) — 상태 추적(State Tracking), plan 미리보기 |
| Helm | K8s 패키지 관리(Package Management) — values 파일 기반 재현 가능(Reproducible) 배포 |

### CI/CD(Continuous Integration / Continuous Delivery)

| 기술(Technology) | 역할(Role) |
|------|------|
| ArgoCD | GitOps 배포(Deployment) — Git = 단일 진실 공급원(Single Source of Truth) |
| Jenkins | CI 빌드 파이프라인(Build Pipeline) |

---

## SRE 운영 대시보드(SRE Operations Dashboard)

실시간 인프라 모니터링(Real-time Infrastructure Monitoring), 부하 테스트(Load Testing), 스케일링 관측(Scaling Observation), 트래픽 분석(Traffic Analysis)을 통합한 웹 대시보드.

```bash
cd dashboard && npm install && npm run dev
# → http://localhost:3000
```

### 페이지 구성(Pages) — 6개

#### 1. Overview — 개요(`/`)

4개 클러스터 2×2 요약 카드(Summary Cards). 각 카드에 노드 수(Node Count), Pod 상태(Status) — Running/Pending/Failed 뱃지(Badge), 평균 CPU/RAM 사용률 바(Utilization Bar), 네임스페이스(Namespace)별 Pod 분포 테이블이 표시된다.

#### 2. Cluster Detail — 클러스터 상세(`/cluster/:name`)

개별 클러스터 심층 분석(Deep Dive). 노드별 CPU/Memory/Disk 게이지 차트(Gauge Chart), RX/TX 네트워크 스파크라인(Sparkline), 열린 포트(Open Ports) 테이블, Pod 목록이 확장/축소 가능한(Collapsible) 카드로 제공된다.

#### 3. Testing — 테스트(`/testing`)

13개 프리셋(Preset) 시나리오 + 커스텀(Custom) 테스트를 대시보드에서 직접 실행한다. 테스트 진행 중 실시간 프로그레스 바(Progress Bar), 완료 시 p95/p99 지연시간(Latency) · RPS(Requests Per Second) · 에러율(Error Rate) 등 핵심 지표(Key Metrics)가 표시된다. 결과는 CSV(Comma-Separated Values)로 다운로드 가능하다.

| 시나리오(Scenario) | 타입(Type) | 설정(Config) |
|----------|------|------|
| Light Load | HTTP | 10 VUs / 15s |
| Standard Load | HTTP | 50 VUs / 30s |
| Heavy Load | HTTP | 200 VUs / 60s |
| Ramp-up Test | HTTP | 0→100 VUs, ramp 10s, sustain 30s |
| Httpbin API Test | HTTP | 30 VUs / 20s → httpbin /get |
| Strict SLA Test | HTTP | 50 VUs / 30s, p95<500ms, err<1% |
| Scale Test — Light | Scaling | 30 VUs / 60s + 60s 쿨다운(Cooldown) |
| Scale Test — Heavy | Scaling | 200 VUs / 120s + 60s 쿨다운(Cooldown) |
| Scale Test — Ramp | Scaling | 150 VUs, ramp 30s / 60s + 60s 쿨다운(Cooldown) |
| CPU Stress Light | CPU | 1 worker / 30s |
| CPU Stress Heavy | CPU | 2 workers / 60s |
| Memory Stress 64M | Memory | 1 worker / 30s / 64M |
| Memory Stress 128M | Memory | 2 workers / 60s / 128M |

커스텀 테스트에서는 VU(Virtual User) 수, 지속시간(Duration), 대상 URL(Target URL), 램프업(Ramp-up), SLA(Service Level Agreement) 임계값(Threshold), 워커 수(Workers), VM 바이트(Bytes) 등을 자유롭게 설정할 수 있다.

#### 4. Traffic — 트래픽(`/traffic`)

Hubble 기반 실시간 네트워크 플로우(Network Flow) 시각화(Visualization).

- **전체 뷰(All-clusters View)**: 4개 클러스터를 카드로 나열, 클러스터별 트래픽 건수/프로토콜(Protocol) 요약
- **단일 클러스터 뷰(Single-cluster View)**: SVG(Scalable Vector Graphics) 토폴로지 맵(Topology Map) — 네임스페이스별로 그룹된 서비스 노드, 베지어 커브(Bezier Curve) 에지(Edge)로 트래픽 흐름 표시 (초록=FORWARDED / 빨강=DROPPED)
- 상위 연결(Top Connections) 테이블, 최근 플로우 이벤트(Recent Flow Events) 테이블 제공

#### 5. Scaling — 스케일링(`/scaling`)

HPA(Horizontal Pod Autoscaler) 오토스케일링 실시간 모니터링(Real-time Monitoring).

- HPA(Horizontal Pod Autoscaler) 상태 카드(Status Cards): 현재 레플리카(Current Replicas)/최대 레플리카(Max Replicas), 스케일 진행도 바(Scale Progress Bar), SCALING/AT MAX 뱃지
- Pod 레플리카(Replica) 시계열 차트(Time Series Chart) — AreaChart, stepAfter
- CPU 사용률(Utilization) 추이 차트 — LineChart vs 타겟(Target) CPU 기준선(Reference Line)
- HPA(Horizontal Pod Autoscaler) 설정 테이블(Configuration Table) — Namespace/Deployment/Current/Desired/Min/Max/CPU Usage/Target

#### 6. Load Analysis — 부하 분석(`/analysis`)

부하 테스트(Load Test) 중 인프라 동작을 종합 분석(Comprehensive Analysis)하는 전용 페이지.

- **테스트 셀렉터(Test Selector)**: 스케일링 테스트 드롭다운(Dropdown) — 실행 중 테스트 자동 선택, LIVE 뱃지
- **KPI(Key Performance Indicator) 요약 카드(Summary Cards)**: 스케일업 지연(Scale-up Latency) / 최대 레플리카(Peak Replicas) / 스케일다운 시작(Scale-down Start) / Pod당 RPS(Requests Per Second)
- **Pod 스케일링 타임라인(Scaling Timeline)**: AreaChart — 디플로이먼트(Deployment)별 레플리카 수 시계열, 부하 구간(Load Phase, 파란 음영)/쿨다운 구간(Cooldown Phase, 주황 음영) 표시
- **처리량 vs Pod(Throughput vs Pods)**: 이중 Y축(Dual Y-Axis) — 좌측 레플리카 수 Area + 우측 RPS(Requests Per Second) 기준선(Reference Line)
- **Pod당 효율(Per-Pod Efficiency)**: LineChart — 각 시점별 RPS(Requests Per Second)/Pod 효율성 추이(Trend)
- **상세 분석 뷰(Detailed Analysis View)** (토글): 테스트 설정 요약 + 디플로이먼트별 기준선→최대→최종(Baseline→Peak→Final) 비교 — 레플리카/CPU 변화량(Delta) + CPU 사용률 시계열 + HPA(Horizontal Pod Autoscaler) 이벤트 로그(Event Log)
- **트래픽 플로우 테이블(Traffic Flow Table)**: 테스트 중 발생한 네트워크 흐름(Network Flows) — Source→Dest, Flows, 프로토콜(Protocol), 판정(Verdict)
- **인프라 영향(Infrastructure Impact)**: VM별 CPU/Memory 현재 상태

### 백엔드 API(Backend APIs) — 9개

| 메서드(Method) | 경로(Path) | 설명(Description) |
|--------|------|------|
| GET | `/api/health` | 서버 헬스체크(Health Check) |
| GET | `/api/snapshot` | 전체 인프라 스냅샷(Infrastructure Snapshot) — VM, 리소스, 포트, 네트워크, 클러스터, Pod |
| GET | `/api/traffic?cluster=X` | Hubble 트래픽 플로우(Traffic Flows) + 집계 에지(Aggregated Edges) |
| GET | `/api/traffic/all` | 전 클러스터 트래픽(All-cluster Traffic) |
| GET | `/api/cluster/:name/services` | K8s 서비스(Services) + 엔드포인트(Endpoints) |
| POST | `/api/tests/run` | k6/stress-ng/scaling 테스트 실행(Run Test) |
| GET | `/api/tests/status` | 모든 테스트 상태 조회(Test Status) |
| DELETE | `/api/tests/:id` | 테스트 삭제(Delete Test) + K8s Job 정리(Cleanup) |
| GET | `/api/scaling/:cluster` | HPA(Horizontal Pod Autoscaler) 스케일링 시계열 히스토리(Scaling Time Series History) |

### 백그라운드 수집 루프(Background Collection Loops)

| 루프(Loop) | 주기(Interval) | 수집 대상(Data Collected) |
|------|------|----------|
| Main | 5초(5s) | VM 정보(tart), SSH(Secure Shell) 리소스(top/free/df/ss/net), kubectl 노드/Pod |
| Scaling | 5초(5s) | HPA(Horizontal Pod Autoscaler) 상태 — 360포인트 링버퍼(Ring Buffer) |
| Traffic | 10초(10s) | Hubble 네트워크 플로우(Network Flows) — 최근 200건 |
| Services | 30초(30s) | K8s 서비스/엔드포인트(Services/Endpoints) |

---

## 요구 사항(Requirements)

| 항목(Item) | 최소(Minimum) | 권장(Recommended) |
|------|------|------|
| Mac | Apple Silicon (M1 이상) | M4 Max |
| RAM | 64 GB | 128 GB |
| 디스크(Disk) | 100 GB 여유(Free) | 200 GB+ |
| macOS | 13 Ventura 이상 | 최신(Latest) |

---

## 설치 및 실행(Installation)

### 1단계: 저장소 클론(Clone Repository)

```bash
git clone https://github.com/iamywl/IaC_apple_sillicon.git
cd IaC_apple_sillicon
```

### 2단계: 의존성 설치(Install Dependencies)

```bash
brew install tart kubectl helm jq sshpass terraform
```

| 도구(Tool) | 용도(Purpose) |
|------|------|
| `tart` | Apple Hypervisor 기반 ARM64 VM 관리(Management) |
| `kubectl` | Kubernetes CLI(Command Line Interface) |
| `helm` | K8s 패키지 매니저(Package Manager) |
| `jq` | JSON 파서(Parser) — 설정 파일 파싱(Config Parsing) |
| `sshpass` | SSH 비밀번호 자동 입력(Auto Password Input) |
| `terraform` | IaC(Infrastructure as Code) |

### 3단계: 골든 이미지 빌드(Build Golden Image) — 권장, 최초 1회

containerd · kubeadm · K8s/Cilium 이미지를 미리 설치한(Pre-baked) VM 틀(Template)을 만들어둔다.

```bash
./scripts/build-golden-image.sh    # ~10분
```

빌드가 끝나면 `config/clusters.json`의 `base_image`를 변경한다:

```diff
- "base_image": "ghcr.io/cirruslabs/ubuntu:latest",
+ "base_image": "k8s-golden",
```

> 골든 이미지 없이도 설치 가능하다. 이 단계를 건너뛰면 Phase 2~4가 매 VM마다 실행된다.

### 4단계: 전체 설치(Full Installation) — 한 줄

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

| 방식(Method) | 소요 시간(Duration) |
|------|----------|
| 골든 이미지 사용(With Golden Image) | **15~20분** |
| 골든 이미지 없이(Without Golden Image) | 45~60분 |

### 4단계 대안(Alternative): Terraform으로 설치

```bash
cd terraform
terraform init
terraform plan     # 변경 사항 미리보기(Preview Changes)
terraform apply    # 인프라 프로비저닝(Provision Infrastructure)
```

---

## 일상 운영(Daily Operations)

### 맥북 켰을 때(Boot)

```bash
./scripts/boot.sh
```

VM 10개 시작 → 클러스터 헬스체크(Health Check) → 서비스 검증(Service Verification)까지 자동 수행.

### 상태 확인(Status Check)

```bash
./scripts/status.sh
```

모든 VM 상태, 4개 클러스터 노드 Ready 여부, Platform 서비스 Pod 상태를 한눈에 확인.

### 맥북 끄기 전(Shutdown)

```bash
./scripts/shutdown.sh
```

워커 노드 드레인(Drain) → VM 안전 종료(Graceful Stop). 데이터 손실 없이 안전하게 종료.

### 전체 삭제(Destroy)

```bash
./scripts/destroy.sh
# 또는(or)
cd terraform && terraform destroy
```

---

## 서비스 접속(Service Access)

VM IP는 DHCP(Dynamic Host Configuration Protocol)이므로 재부팅(Reboot) 시 변경될 수 있다. 아래 명령으로 확인:

```bash
tart ip platform-worker1
```

### Platform 클러스터 서비스(Platform Cluster Services)

| 서비스(Service) | URL | 계정(Credentials) |
|--------|-----|------|
| Grafana | `http://<platform-worker1>:30300` | admin / admin |
| AlertManager | `http://<platform-worker1>:30903` | — |
| ArgoCD | `http://<platform-worker1>:30800` | admin / 아래 명령(see below) |
| Jenkins | `http://<platform-worker1>:30900` | admin / admin |
| Hubble UI | `http://<platform-worker1>:31235` | — |

```bash
# ArgoCD 비밀번호 확인(Get ArgoCD Password)
kubectl --kubeconfig kubeconfig/platform.yaml \
  -n argocd get secret argocd-initial-admin-secret \
  -o jsonpath="{.data.password}" | base64 -d && echo
```

### Dev 클러스터 서비스(Dev Cluster Services)

| 서비스(Service) | URL |
|--------|-----|
| Nginx 데모(Demo) | `http://<dev-worker1>:30080` |
| Istio Gateway | NodePort (자동 할당 / Auto-assigned) |

### SRE 대시보드(SRE Dashboard)

```bash
cd dashboard && npm install && npm run dev
# → http://localhost:3000
```

### kubectl 접속(kubectl Access)

```bash
# 클러스터별(Per Cluster)
kubectl --kubeconfig kubeconfig/platform.yaml get nodes
kubectl --kubeconfig kubeconfig/dev.yaml get nodes
kubectl --kubeconfig kubeconfig/staging.yaml get nodes
kubectl --kubeconfig kubeconfig/prod.yaml get nodes

# 멀티 클러스터 통합(Multi-cluster Unified)
export KUBECONFIG=kubeconfig/platform.yaml:kubeconfig/dev.yaml:kubeconfig/staging.yaml:kubeconfig/prod.yaml
kubectl config get-contexts

# SSH 접속(SSH Access) — 모든 VM 공통(All VMs)
ssh admin@$(tart ip dev-worker1)    # 비밀번호(password): admin
```

---

## 데모 앱(Demo Applications)

dev 클러스터 `demo` 네임스페이스(Namespace)에 배포(Deployed):

| 앱(App) | 이미지(Image) | 레플리카(Replicas) | 용도(Purpose) |
|----|--------|----------|------|
| nginx-web | nginx:alpine | 3 (HPA: 3→10) | 웹서버(Web Server), NodePort 30080, 부하 테스트 대상(Load Test Target) |
| httpbin v1 | kong/httpbin | 2 (HPA: 2→6) | REST(Representational State Transfer) API 테스트, 카나리(Canary) 80% |
| httpbin v2 | kong/httpbin | 1 | 카나리 배포 대상(Canary Target) — 20% |
| redis | redis:7-alpine | 1 | 캐시/세션 저장소(Cache/Session Store) |

---

## 프로젝트 구조(Project Structure)

```
tart-infra/
│
├── config/
│   └── clusters.json                   ← 클러스터/VM 정의 — 단일 진실 공급원(Single Source of Truth)
│
├── scripts/
│   ├── install.sh                      ← 전체 설치(Full Install) — Phase 1~12
│   ├── build-golden-image.sh           ← 골든 이미지 빌드(Golden Image Build) — 최초 1회
│   ├── boot.sh                         ← 일상 시작(Daily Boot) — VM 부팅 → 헬스체크(Health Check)
│   ├── shutdown.sh                     ← 안전 종료(Graceful Shutdown) — 드레인(Drain) → 정지(Stop)
│   ├── status.sh                       ← 전체 상태 확인(Status Check)
│   ├── destroy.sh                      ← 완전 삭제(Full Destroy)
│   ├── lib/                            ← 공유 함수 라이브러리(Shared Function Library)
│   │   ├── common.sh                   ← 설정 파싱(Config Parsing), 로깅(Logging), 유틸리티(Utilities)
│   │   ├── vm.sh                       ← VM 생명주기(Lifecycle) — clone/start/stop/delete
│   │   ├── ssh.sh                      ← SSH 연결(Connection) — exec/scp/wait
│   │   └── k8s.sh                      ← K8s 관리(Management) — init/join/cilium/hubble
│   ├── install/                        ← 설치 단계(Install Phases) 01~12
│   └── boot/                           ← 부팅 단계(Boot Phases) 01~03
│
├── manifests/
│   ├── cilium-values.yaml              ← Cilium CNI — eBPF, kubeProxyReplacement
│   ├── hubble-values.yaml              ← Hubble 네트워크 관측(Network Observation)
│   ├── monitoring-values.yaml          ← Prometheus + Grafana + AlertManager
│   ├── loki-values.yaml                ← Loki 로그 수집(Log Aggregation)
│   ├── argocd-values.yaml              ← ArgoCD GitOps
│   ├── jenkins-values.yaml             ← Jenkins CI
│   ├── metrics-server-values.yaml      ← metrics-server — HPA 메트릭(Metrics)
│   ├── alerting/                       ← PrometheusRule + 웹훅 수신기(Webhook Receiver)
│   ├── network-policies/               ← CiliumNetworkPolicy — 제로 트러스트(Zero Trust) L7
│   ├── hpa/                            ← HPA + PDB
│   ├── istio/                          ← Istio 전체 설정 — mTLS, 카나리(Canary), 서킷브레이커(Circuit Breaker)
│   └── demo/                           ← nginx, httpbin, redis, k6, stress-ng 매니페스트(Manifests)
│
├── terraform/
│   ├── main.tf                         ← 모듈 조합(Module Composition) — vms → k8s → helm
│   ├── variables.tf                    ← clusters.json의 HCL 버전(HCL Version)
│   ├── outputs.tf                      ← VM IP, kubeconfig, 서비스 URL
│   └── modules/
│       ├── tart-vm/                    ← VM 생성(Create) → 시작(Start) → IP 대기(Wait)
│       ├── k8s-cluster/                ← kubeadm init/join
│       └── helm-releases/              ← Helm 차트 선언적 관리(Declarative Chart Management)
│
├── dashboard/                          ← SRE 운영 웹 대시보드(Operations Web Dashboard)
│   ├── server/
│   │   ├── index.ts                    ← Express 서버 + API 라우팅(Routing) — 9개 엔드포인트
│   │   ├── collector.ts                ← 백그라운드 수집 루프(Background Collection Loop) — VM/Pod/트래픽/HPA
│   │   ├── jobs.ts                     ← K8s Job 라이프사이클(Lifecycle) — k6/stress-ng/scaling 실행·결과·CSV
│   │   ├── collectors/
│   │   │   ├── hubble.ts               ← Hubble CLI 트래픽 수집기(Traffic Collector)
│   │   │   ├── scaling.ts              ← HPA 스케일링 수집기(Scaling Collector)
│   │   │   └── services.ts             ← K8s 서비스/엔드포인트 수집기(Service Collector)
│   │   └── parsers/
│   │       ├── k6.ts                   ← k6 출력 파서(Output Parser) — p95/p99/avg/RPS/에러율
│   │       └── stress-ng.ts            ← stress-ng 출력 파서(Output Parser) — bogo-ops
│   ├── src/
│   │   ├── App.tsx                     ← 라우팅 루트(Routing Root) — 6개 Route
│   │   ├── pages/
│   │   │   ├── OverviewPage.tsx        ← 클러스터 2×2 요약(Cluster Summary)
│   │   │   ├── ClusterDetailPage.tsx   ← 노드/Pod/서비스 상세(Node/Pod/Service Detail)
│   │   │   ├── TestingPage.tsx         ← 13개 시나리오 + 커스텀 테스트(Custom Test)
│   │   │   ├── TrafficPage.tsx         ← SVG 토폴로지(Topology) + 트래픽 플로우(Traffic Flow)
│   │   │   ├── ScalingPage.tsx         ← HPA 시계열 모니터링(Time Series Monitoring)
│   │   │   └── LoadAnalysisPage.tsx    ← 부하 테스트 인프라 종합 분석(Load Test Infrastructure Analysis)
│   │   ├── components/layout/
│   │   │   ├── AppShell.tsx            ← 사이드바(Sidebar) + 헤더(Header) 레이아웃(Layout)
│   │   │   ├── Sidebar.tsx             ← 6개 네비게이션 링크(Navigation Links)
│   │   │   └── Header.tsx              ← 상태 표시 바(Status Bar)
│   │   └── hooks/
│   │       └── usePolling.ts           ← 실시간 폴링 커스텀 훅(Real-time Polling Custom Hook)
│   └── shared/
│       └── types.ts                    ← 프론트/백엔드 공유 타입(Shared Types) — 25개 인터페이스(Interfaces)
│
├── kubeconfig/                         ← 클러스터별 kubeconfig — .gitignore
│
└── doc/
    ├── dashboard.md                    ← 대시보드 상세 기술 문서(Dashboard Technical Spec)
    ├── tart.md                         ← Tart VM 런타임 개요(Tart VM Runtime Overview)
    ├── terraform.md                    ← Terraform 모듈 설계(Terraform Module Design)
    ├── bug-reports/                    ← 버그 리포트 모음(Bug Reports Collection) — 19건
    └── learning/                       ← 학습용 기술 문서(Learning Documents)
```

---

## 학습용 기술 문서(Learning Documents)

이 프로젝트가 **어떻게 동작하는지**, 소프트웨어 공학(Software Engineering) 관점에서 설명하는 문서:

| 문서(Document) | 내용(Contents) |
|------|------|
| [아키텍처 설계(Architecture Design)](doc/learning/architecture.md) | 8계층 레이어드 아키텍처(Layered Architecture), 멀티클러스터 CIDR(Classless Inter-Domain Routing) 설계, clusters.json이 단일 진실 공급원(Single Source of Truth)인 이유, 스크립트 디자인 패턴(Design Patterns) — Facade · Strategy · Template Method, CPU 오버커밋(Overcommit) 전략, 제로 트러스트(Zero Trust) 보안, ADR(Architecture Decision Records) 5건 |
| [네트워크 심화(Networking Deep Dive)](doc/learning/networking.md) | Tart NAT(Network Address Translation) vs Softnet, Cilium eBPF(extended Berkeley Packet Filter)가 iptables보다 빠른 이유, kubeProxyReplacement 부트스트랩 순환의존성(Circular Dependency), CiliumNetworkPolicy L7 HTTP 필터링(Filtering), Istio 사이드카(Sidecar) mTLS(mutual TLS)/카나리(Canary)/서킷브레이커(Circuit Breaker), 패킷이 nginx→httpbin으로 가는 9단계 전체 경로(Full Packet Journey) |
| [IaC와 자동화(IaC & Automation)](doc/learning/iac-automation.md) | Bash 명령형(Imperative) vs Terraform 선언형(Declarative) 비교, Phase 1~12 실행 흐름(Execution Flow), null_resource로 Tart CLI(Command Line Interface) 래핑(Wrapping), DHCP(Dynamic Host Configuration Protocol) IP 해결 패턴(Resolution Pattern), 멱등성(Idempotency) 구현, Helm values 관리, GitOps 원칙(Principles), Day 0/1/2 자동화 분류(Automation Classification) |
| [모니터링/옵저버빌리티(Monitoring/Observability)](doc/learning/monitoring.md) | 옵저버빌리티 3기둥(Three Pillars) — Metrics·Logs·Traces, Prometheus Pull 모델(Pull Model), Grafana 코드 프로비저닝(Code Provisioning), AlertManager 알림 흐름(Alert Flow) — 그룹핑(Grouping)·억제(Inhibition), HPA(Horizontal Pod Autoscaler) 공식(Formula) `⌈replicas × current/target⌉`, PDB(Pod Disruption Budget) 상호작용(Interaction), 커스텀 대시보드 SSH(Secure Shell) 풀(SSH Pool) |
| [트러블슈팅 가이드(Troubleshooting Guide)](doc/learning/troubleshooting.md) | 6단계 디버깅 프레임워크(Debugging Framework), VM→SSH(Secure Shell)→K8s→Pod→Service 레이어별 체크리스트(Per-layer Checklist), 실제 버그 7건의 근본 원인 분석(Root Cause Analysis)→가설(Hypothesis)→검증(Verification)→해결(Resolution) 과정, kubectl/Helm/Cilium 진단(Diagnostics) 명령, 재해복구(Disaster Recovery) 절차 |

---

## 검증 명령 모음(Verification Commands)

```bash
# 전체 상태 확인(Full Status Check)
./scripts/status.sh

# 모든 VM IP 확인(Check All VM IPs)
for vm in platform-master platform-worker1 platform-worker2 \
          dev-master dev-worker1 staging-master staging-worker1 \
          prod-master prod-worker1 prod-worker2; do
  echo "$vm: $(tart ip $vm 2>/dev/null || echo 'not running')"
done

# Cilium 상태(Cilium Status)
kubectl --kubeconfig kubeconfig/dev.yaml exec -n kube-system ds/cilium -- cilium status

# Hubble 네트워크 관측(Hubble Network Observation)
kubectl --kubeconfig kubeconfig/dev.yaml -n kube-system port-forward svc/hubble-relay 4245:80 &
hubble observe --namespace demo --verdict DROPPED

# Istio 상호 TLS 확인(Istio mTLS Verification)
kubectl --kubeconfig kubeconfig/dev.yaml -n demo \
  exec deploy/nginx-web -c nginx -- curl -s http://httpbin/get

# HPA 실시간 확인(HPA Real-time Watch)
kubectl --kubeconfig kubeconfig/dev.yaml -n demo get hpa -w

# AlertManager 확인(AlertManager Access)
open http://$(tart ip platform-worker1):30903

# Grafana 접속(Grafana Access)
open http://$(tart ip platform-worker1):30300
```

---

## 참고 문서(Reference Documents)

| 문서(Document) | 설명(Description) |
|------|------|
| [대시보드 기술 문서(Dashboard Technical Spec)](doc/dashboard.md) | SRE 대시보드 아키텍처(Architecture), API 9개, Job 관리(Management), 트래픽 토폴로지(Traffic Topology), 스케일링 수집(Scaling Collection) |
| [버그 리포트(Bug Report)](doc/bug-reports/) | 19건 버그 발견 및 해결 과정(Discovery & Resolution) |
| [Tart 소개(Tart Introduction)](doc/tart.md) | Tart VM 런타임(Runtime) 개요(Overview) |
| [Terraform 연동(Terraform Integration)](doc/terraform.md) | Terraform 모듈 설계(Module Design) |
