# Tart Multi-Cluster Kubernetes Infrastructure

Apple Silicon Mac 한 대에서 **프로덕션급(Production-grade) 멀티클러스터(Multi-cluster) K8s(Kubernetes) 환경**을 자동으로 구축하고,
SRE(Site Reliability Engineering) 운영 대시보드(Operations Dashboard)로 부하 테스트(Load Testing) · 오토스케일링(Auto Scaling) · 트래픽 관측(Traffic Observability) · 인프라 분석(Infrastructure Analysis)까지 수행하는 풀스택(Full-stack) 프로젝트.

---

## 목차(Table of Contents)

1. [이 프로젝트가 해결하는 문제(What This Project Solves)](#이-프로젝트가-해결하는-문제what-this-project-solves)
2. [전체 아키텍처(Architecture Overview)](#전체-아키텍처architecture-overview)
3. [클러스터 구성(Cluster Configuration)](#클러스터-구성cluster-configuration)
4. [기술 스택(Tech Stack)](#기술-스택tech-stack)
5. [SRE 운영 대시보드(SRE Operations Dashboard)](#sre-운영-대시보드sre-operations-dashboard)
6. [요구 사항(Requirements)](#요구-사항requirements)
7. [설치 및 실행(Installation)](#설치-및-실행installation)
8. [일상 운영(Daily Operations)](#일상-운영daily-operations)
9. [서비스 접속(Service Access)](#서비스-접속service-access)
10. [데모 앱(Demo Applications)](#데모-앱demo-applications)
11. [DevOps 파이프라인 데모(DevOps Pipeline Demo)](#devops-파이프라인-데모devops-pipeline-demo)
12. [프로젝트 구조(Project Structure)](#프로젝트-구조project-structure)
13. [학습용 기술 문서(Learning Documents)](#학습용-기술-문서learning-documents)
14. [검증 명령 모음(Verification Commands)](#검증-명령-모음verification-commands)

---

## 이 프로젝트가 해결하는 문제(What This Project Solves)

Kubernetes 멀티클러스터 환경을 수동으로 구축하려면 VM 10대에 대해 아래 과정을 **하나씩 반복**해야 한다.

```
수동(Manual) 과정:

1. VM 생성          → tart clone + tart set을 10번 반복
2. IP 확인          → tart ip를 10번 실행, IP를 메모
3. SSH 접속 + 설정  → 10대에 각각 접속하여 swap off, 커널 모듈 로드, sysctl 설정
4. 런타임 설치      → 10대에 containerd 설치 + SystemdCgroup 설정
5. K8s 도구 설치    → 10대에 kubeadm, kubelet, kubectl 설치
6. 클러스터 초기화  → 4개 master에서 kubeadm init, 토큰 복사, 6개 worker에서 kubeadm join
7. CNI + 오픈소스   → 4개 클러스터에 Cilium 설치, platform에 Prometheus/Jenkins/ArgoCD 설치...
```

> **문제점(Pain Points)**: 수십 번의 SSH 접속, 수백 줄의 명령어, 순서 의존성(Order Dependency).
> IP가 바뀌면 처음부터 다시 확인해야 하고, 한 단계라도 빠뜨리면 클러스터가 정상 동작하지 않는다.
> 전체 과정에 **수동으로 1~2시간** 이상, 실수 가능성이 높다.

### 이 프로젝트의 자동화 방식(How This Project Automates It)

위의 모든 과정을 **명령어 하나**로 실행한다.

```bash
./scripts/demo.sh          # 인프라 설치 + 대시보드까지 한 번에
# 또는(or)
./scripts/install.sh       # 인프라만 설치 (대시보드 별도)
```

| 수동 작업(Manual Work) | 자동화 방식(Automation) | 담당 코드(Code) |
|-----------|------------|-----------|
| VM 10대 하나씩 생성 | `clusters.json`에서 노드 목록을 읽어 **루프로 일괄 생성** | `scripts/install/01-create-vms.sh` + `scripts/lib/vm.sh` |
| IP를 눈으로 확인하고 메모 | `tart ip` 명령을 **3초 간격 최대 60회 자동 폴링(Auto Polling)** | `scripts/lib/vm.sh` → `vm_wait_for_ip()` |
| SSH로 하나씩 접속해서 설정 | `sshpass`로 **자동 인증 후 원격 명령 일괄 실행** | `scripts/lib/ssh.sh` → `ssh_exec()` |
| swap 끄기, 커널 모듈 등 노드 준비 | 10대 **모든 노드에 자동으로 동일한 설정 적용** | `scripts/install/02-prepare-nodes.sh` |
| containerd + kubeadm 설치 | **APT 저장소 추가부터 설치까지 스크립트로 자동화** | `scripts/install/03~04-*.sh` |
| kubeadm init + join 토큰 복사 | master init 후 **토큰을 자동 추출하여 worker에 전달** | `scripts/install/05-init-clusters.sh` + `scripts/lib/k8s.sh` |
| kubeconfig 파일 복사 | master에서 **SCP로 자동 다운로드** → `kubeconfig/` 디렉토리에 저장 | `scripts/lib/k8s.sh` → `scp_from()` |
| Cilium, Prometheus 등 설치 | **Helm 차트 + values 파일로 선언적(Declarative) 설치** | `scripts/install/06~17-*.sh` + `manifests/` |

### 자동화 17단계 파이프라인(17-Phase Automation Pipeline)

```
clusters.json (설정 파일 하나 — Single Source of Truth)
    │
    └─→ install.sh (오케스트레이터)
          │
          ├─ 01. VM 생성(Create VMs)       : Tart로 10대 복제 + 리소스 할당
          ├─ 02. 노드 준비(Prepare Nodes)  : swap off, 커널 모듈, sysctl      ← 골든 이미지 시 스킵
          ├─ 03. 런타임 설치(Runtime)      : containerd + SystemdCgroup       ← 골든 이미지 시 스킵
          ├─ 04. K8s 도구(K8s Tools)       : kubeadm, kubelet, kubectl        ← 골든 이미지 시 스킵
          ├─ 05. 클러스터 초기화(Init)     : kubeadm init + worker join (×4 클러스터)
          ├─ 06. CNI 설치(Cilium)          : Cilium eBPF + Hubble (kube-proxy 대체)
          ├─ 07. 모니터링(Monitoring)      : Prometheus + Grafana + Loki
          ├─ 08. CI/CD                     : Jenkins + ArgoCD
          ├─ 09. 알림(Alerting)            : AlertManager + Prometheus Rules
          ├─ 10. 네트워크 정책(NetPol)     : Cilium L3/L4/L7 Zero-Trust
          ├─ 11. 오토스케일링(HPA)         : metrics-server + HPA + PDB
          ├─ 12. 서비스 메시(Service Mesh) : Istio mTLS + 카나리 + 서킷브레이커
          ├─ 13. 시크릿 관리(Secrets)      : Sealed Secrets 컨트롤러 + RBAC
          ├─ 14. 정책 강제(Policy)         : RBAC + OPA Gatekeeper 제약 조건
          ├─ 15. 백업/DR(Backup)           : etcd 스냅샷 + Velero 리소스 백업
          ├─ 16. 리소스 관리(Quotas)       : ResourceQuota + LimitRange
          └─ 17. 이미지 레지스트리(Registry): Harbor 프라이빗 컨테이너 레지스트리
```

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
│  │  │  master  (2C/4G)         │  │  master  (2C/4G)             │  │   │
│  │  │  worker1 (2C/8G)         │  │  worker1 (2C/8G)             │  │   │
│  │  └──────────────────────────┘  │  worker2 (2C/8G)             │  │   │
│  │                                └──────────────────────────────┘  │   │
│  │                                                                  │   │
│  │  Total: 10 VMs / 21 vCPU / ~68 GB RAM                          │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                        │
│  ┌──────────── K8s Layer ───────────────────────────────────────────┐   │
│  │  kubeadm v1.31 · Cilium eBPF CNI · Hubble Network Observability │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                        │
│  ┌── SRE Dashboard ──┐  ┌── IaC ─────────────┐  ┌── CI/CD ────────┐   │
│  │ React + Express    │  │ Bash Scripts        │  │ ArgoCD (GitOps) │   │
│  │ 6 Pages · 11 APIs  │  │ Terraform           │  │ Jenkins (CI)    │   │
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
| 설치 대상(Installed Components) | Cilium + Hubble, **Istio** 서비스 메시(Service Mesh) — mTLS(mutual TLS)/카나리(Canary)/서킷브레이커(Circuit Breaker), **metrics-server** + HPA(Horizontal Pod Autoscaler), **CiliumNetworkPolicy** — 제로 트러스트(Zero Trust) L7, 데모 앱(Demo Apps) — nginx, httpbin v1/v2, redis, **postgres**, **rabbitmq**, **keycloak** |

적용된 기능(Applied Features):

| 기능(Feature) | 설정(Config) | 설명(Description) |
|------|------|------|
| 제로 트러스트(Zero Trust) | `default-deny.yaml` | 모든 인그레스(Ingress) 차단, DNS(Domain Name System)만 허용 후 화이트리스트(Whitelist) 개별 추가 |
| L7 필터(L7 Filtering) | `allow-nginx-to-httpbin.yaml` | nginx → httpbin **HTTP GET만** 허용 (POST/DELETE 차단) |
| DB 접근 제어(DB Access) | `allow-httpbin-to-postgres.yaml` | httpbin → postgres:5432 TCP 허용 |
| MQ 접근 제어(MQ Access) | `allow-httpbin-to-rabbitmq.yaml` | httpbin → rabbitmq:5672 AMQP 허용 |
| Auth 접근 제어(Auth Access) | `allow-httpbin-to-keycloak.yaml` | httpbin → keycloak:8080 HTTP 허용 |
| Keycloak DB 접근(Keycloak DB) | `allow-keycloak-to-postgres.yaml` | keycloak → postgres:5432 TCP 허용 |
| 외부 인증(External Auth) | `allow-external-to-keycloak.yaml` | 외부 → keycloak:8080 NodePort 허용 |
| 상호 TLS(mTLS) | PeerAuthentication STRICT | 모든 Pod 간 통신 TLS(Transport Layer Security) 암호화(Encryption) |
| 카나리 배포(Canary Deployment) | VirtualService | httpbin v1: 80% / v2: 20% 트래픽 분할(Traffic Splitting) |
| 서킷브레이커(Circuit Breaker) | DestinationRule | 연속 5xx 3회 → 인스턴스 30초 격리(Ejection) |
| HPA(Horizontal Pod Autoscaler) | nginx-web | CPU 50% 기준, 3→10 Pod 자동 확장(Auto Scaling) |
| HPA(Horizontal Pod Autoscaler) | httpbin | CPU 50% 기준, 2→6 Pod 자동 확장(Auto Scaling) |
| HPA(Horizontal Pod Autoscaler) | redis | CPU 50% 기준, 1→4 Pod 자동 확장(Auto Scaling) |
| HPA(Horizontal Pod Autoscaler) | postgres | CPU 50% 기준, 1→4 Pod 자동 확장(Auto Scaling) |
| HPA(Horizontal Pod Autoscaler) | rabbitmq | CPU 50% 기준, 1→3 Pod 자동 확장(Auto Scaling) |
| PDB(Pod Disruption Budget) | nginx / httpbin / redis / postgres / rabbitmq / keycloak | 스케일다운(Scale-down) 시 최소 가용성(Minimum Availability) 보장 |
| 인증(Auth) | Keycloak → PostgreSQL | OAuth 2.0 / SSO 인증 서버, PostgreSQL을 백엔드 DB로 사용 |
| 메시지 큐(Message Queue) | RabbitMQ | 비동기 메시지 브로커(Async Message Broker), Management UI 포함 |

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
| prod-master | 2 vCPU / 4 GB | 컨트롤 플레인(Control Plane) |
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
| **노드 수(Nodes)** | 3 (7C / 24G) | 2 (4C / 12G) | 2 (4C / 12G) | 3 (6C / 20G) |
| **Cilium + Hubble** | O | O | O | O |
| **Istio 서비스 메시(Service Mesh)** | — | O | — | — |
| **네트워크 정책(NetworkPolicy) L7** | — | O | — | — |
| **HPA(Horizontal Pod Autoscaler) + PDB(Pod Disruption Budget)** | — | O | O (metrics-server) | — |
| **Prometheus/Grafana** | O | — | — | — |
| **Jenkins/ArgoCD** | O | — | — | — |
| **Sealed Secrets** | O (controller) | O (secrets) | — | — |
| **OPA Gatekeeper** | — | O | — | — |
| **RBAC 커스텀 역할(Custom Roles)** | O | O | O | O |
| **etcd 백업(Backup)** | O | O | O | O |
| **Velero 리소스 백업(Resource Backup)** | O | — | — | — |
| **ResourceQuota + LimitRange** | — | O | O | O |
| **Harbor 레지스트리(Registry)** | O | — | — | — |
| **데모 앱(Demo Apps)** | — | O | — | — |

---

## 기술 스택(Tech Stack)

하향식(Top-down)으로, 사용자가 접하는 계층부터 인프라 기반까지 정리한다.

### 7계층(Layer 7) — SRE 대시보드(Dashboard) & 테스트(Testing)

| | 기술(Technology) | 역할(Role) |
|:---:|------|------|
| <img src="https://img.shields.io/badge/React_19-61DAFB?logo=react&logoColor=black" height="22"/> | **React** 19 + **Vite** 7 + **TypeScript** | SPA(Single Page Application) 프론트엔드 — 6개 페이지, react-router-dom |
| <img src="https://img.shields.io/badge/Tailwind_CSS_4-06B6D4?logo=tailwindcss&logoColor=white" height="22"/> | **Tailwind CSS** 4 | 다크 테마(Dark Theme) UI |
| <img src="https://img.shields.io/badge/Recharts_3-22B5BF?logo=chart.js&logoColor=white" height="22"/> | **Recharts** 3 | 시계열(Time Series) AreaChart · LineChart · 게이지 차트(Gauge Chart) |
| <img src="https://img.shields.io/badge/Express_5-000000?logo=express&logoColor=white" height="22"/> | **Express** 5 + **TypeScript** | REST(Representational State Transfer) API 서버 — 11개 엔드포인트(Endpoint) |
| <img src="https://img.shields.io/badge/ssh2-000000?logo=openssh&logoColor=white" height="22"/> | **ssh2** (npm) | VM SSH 커넥션 풀(Connection Pool) — 10개 상시 연결 |
| <img src="https://img.shields.io/badge/k6-7D64FF?logo=k6&logoColor=white" height="22"/> | **k6** | K8s Job 기반 HTTP 부하 생성기(Load Generator) |
| <img src="https://img.shields.io/badge/stress--ng-CC0000?logo=linux&logoColor=white" height="22"/> | **stress-ng** | K8s Job 기반 CPU/메모리 스트레스 테스트(Stress Test) |

### 6계층(Layer 6) — 서비스 메시(Service Mesh)

| | 기술(Technology) | 역할(Role) |
|:---:|------|------|
| <img src="https://img.shields.io/badge/Istio-466BB0?logo=istio&logoColor=white" height="22"/> | **Istio** (Envoy) | 상호 TLS(mTLS) · 카나리 배포(Canary Deployment) · 서킷브레이커(Circuit Breaker) — dev 클러스터 demo 네임스페이스 |

### 5계층(Layer 5) — 옵저버빌리티(Observability) & 알림(Alerting)

| | 기술(Technology) | 역할(Role) |
|:---:|------|------|
| <img src="https://img.shields.io/badge/Prometheus-E6522C?logo=prometheus&logoColor=white" height="22"/> | **Prometheus** | 메트릭 수집/저장(Metrics Collection/Storage) — Pull 기반 TSDB(Time Series Database) |
| <img src="https://img.shields.io/badge/Grafana-F46800?logo=grafana&logoColor=white" height="22"/> | **Grafana** | 시각화 대시보드(Visualization Dashboard) — K8s 클러스터 · 노드 · Pod 프리셋 |
| <img src="https://img.shields.io/badge/Loki-F46800?logo=grafana&logoColor=white" height="22"/> | **Loki** + **Promtail** | 로그 수집/검색(Log Aggregation/Search) |
| <img src="https://img.shields.io/badge/AlertManager-E6522C?logo=prometheus&logoColor=white" height="22"/> | **AlertManager** | 알림 라우팅(Alert Routing) — 8개 규칙, 웹훅 수신기(Webhook Receiver) |
| <img src="https://img.shields.io/badge/Hubble-F8C517?logo=cilium&logoColor=black" height="22"/> | **Hubble** | Cilium 내장 네트워크 플로우 관측(Network Flow Observation) |

### 4계층(Layer 4) — 보안 & 정책(Security & Policy)

| | 기술(Technology) | 역할(Role) |
|:---:|------|------|
| <img src="https://img.shields.io/badge/Cilium-F8C517?logo=cilium&logoColor=black" height="22"/> | **CiliumNetworkPolicy** | L3/L4/L7 제로 트러스트(Zero Trust) — 기본 차단(Default Deny) + 화이트리스트(Whitelist) |
| <img src="https://img.shields.io/badge/Sealed_Secrets-326CE5?logo=kubernetes&logoColor=white" height="22"/> | **Sealed Secrets** | 시크릿 관리(Secret Management) — Git에 안전하게 암호화된 시크릿 저장 |
| <img src="https://img.shields.io/badge/OPA_Gatekeeper-7D64FF?logo=openpolicyagent&logoColor=white" height="22"/> | **OPA Gatekeeper** | 정책 강제(Policy Enforcement) — ConstraintTemplate + Constraint (라벨 필수, 리소스 제한 필수, 특권 컨테이너 차단) |
| <img src="https://img.shields.io/badge/RBAC-326CE5?logo=kubernetes&logoColor=white" height="22"/> | **RBAC** | 역할 기반 접근 제어(Role-Based Access Control) — namespace-admin, cluster-readonly, developer 역할 |

### 3계층(Layer 3) — 오케스트레이션(Orchestration) & 스케일링(Scaling)

| | 기술(Technology) | 역할(Role) |
|:---:|------|------|
| <img src="https://img.shields.io/badge/Kubernetes-326CE5?logo=kubernetes&logoColor=white" height="22"/> | **Kubernetes** v1.31 (kubeadm) | 컨테이너 오케스트레이션(Container Orchestration) |
| <img src="https://img.shields.io/badge/metrics--server-326CE5?logo=kubernetes&logoColor=white" height="22"/> | **metrics-server** | Pod CPU/메모리 메트릭(Metrics) — HPA(Horizontal Pod Autoscaler) 데이터 소스 |

### 2계층(Layer 2) — 네트워크(Network / CNI)

| | 기술(Technology) | 역할(Role) |
|:---:|------|------|
| <img src="https://img.shields.io/badge/Cilium-F8C517?logo=cilium&logoColor=black" height="22"/> | **Cilium** (eBPF) | CNI(Container Network Interface) — kube-proxy 완전 대체(Full Replacement), L7 정책(Policy), Hubble 내장 |

### 1계층(Layer 1) — 컨테이너 런타임(Container Runtime)

| | 기술(Technology) | 역할(Role) |
|:---:|------|------|
| <img src="https://img.shields.io/badge/containerd-575757?logo=containerd&logoColor=white" height="22"/> | **containerd** | K8s 표준 CRI(Container Runtime Interface) — SystemdCgroup 드라이버 |

### 0계층(Layer 0) — 가상화(Virtualization) & OS

| | 기술(Technology) | 역할(Role) |
|:---:|------|------|
| <img src="https://img.shields.io/badge/Tart-000000?logo=apple&logoColor=white" height="22"/> | **Tart** | Apple Hypervisor.framework 기반 ARM64 네이티브 VM 런타임(Runtime) |
| <img src="https://img.shields.io/badge/Ubuntu-E95420?logo=ubuntu&logoColor=white" height="22"/> | **Ubuntu** 24.04 (ARM64) | 게스트 OS(Guest OS) |

### 데모 앱 & 미들웨어(Demo Apps & Middleware)

| | 기술(Technology) | 역할(Role) |
|:---:|------|------|
| <img src="https://img.shields.io/badge/nginx-009639?logo=nginx&logoColor=white" height="22"/> | **nginx** | 웹 서버(Web Server) — 3-Tier 웹 계층, NodePort 30080, HPA 3→10 |
| <img src="https://img.shields.io/badge/httpbin-4B8BBE?logo=python&logoColor=white" height="22"/> | **httpbin** | REST API 테스트 서버 — 3-Tier 앱 계층, L7 필터링 검증 |
| <img src="https://img.shields.io/badge/PostgreSQL_16-4169E1?logo=postgresql&logoColor=white" height="22"/> | **PostgreSQL** 16 | 관계형 데이터베이스(RDBMS) — Keycloak 백엔드 + 3-Tier DB 계층 |
| <img src="https://img.shields.io/badge/Redis_7-FF4438?logo=redis&logoColor=white" height="22"/> | **Redis** 7 | 인메모리 캐시(In-memory Cache) — 세션/캐시 저장소 |
| <img src="https://img.shields.io/badge/RabbitMQ_3-FF6600?logo=rabbitmq&logoColor=white" height="22"/> | **RabbitMQ** 3 | 메시지 큐(Message Queue) — 비동기 메시지 브로커, Management UI |
| <img src="https://img.shields.io/badge/Keycloak-4D4D4D?logo=keycloak&logoColor=white" height="22"/> | **Keycloak** | ID/인증 관리(Identity & Access Management) — SSO, OAuth 2.0, PostgreSQL 백엔드 |

### 백업 & 복구(Backup & Disaster Recovery)

| | 기술(Technology) | 역할(Role) |
|:---:|------|------|
| <img src="https://img.shields.io/badge/etcd-419EDA?logo=etcd&logoColor=white" height="22"/> | **etcd 스냅샷** | 클러스터 상태 백업(Cluster State Backup) — 일 1회 자동, 5개 보관, 전체 마스터 노드 |
| <img src="https://img.shields.io/badge/Velero-43A047?logo=kubernetes&logoColor=white" height="22"/> | **Velero** | K8s 리소스 백업/복원(Resource Backup/Restore) — Schedule 기반 자동 백업, 네임스페이스 단위 |

### 리소스 관리(Resource Management)

| | 기술(Technology) | 역할(Role) |
|:---:|------|------|
| <img src="https://img.shields.io/badge/ResourceQuota-326CE5?logo=kubernetes&logoColor=white" height="22"/> | **ResourceQuota** | 네임스페이스 리소스 상한(Namespace Resource Caps) — CPU, 메모리, Pod 수 제한 |
| <img src="https://img.shields.io/badge/LimitRange-326CE5?logo=kubernetes&logoColor=white" height="22"/> | **LimitRange** | 컨테이너 기본 리소스(Default Container Resources) — 기본 request/limit 자동 적용 |

### 컨테이너 레지스트리(Container Registry)

| | 기술(Technology) | 역할(Role) |
|:---:|------|------|
| <img src="https://img.shields.io/badge/Harbor-60B932?logo=harbor&logoColor=white" height="22"/> | **Harbor** | 프라이빗 이미지 레지스트리(Private Image Registry) — 이미지 저장소 + Trivy 취약점 스캔 |

### IaC(Infrastructure as Code) & 자동화(Automation)

| | 기술(Technology) | 역할(Role) |
|:---:|------|------|
| <img src="https://img.shields.io/badge/Bash-4EAA25?logo=gnubash&logoColor=white" height="22"/> | **Bash** 스크립트 | 명령형 자동화(Imperative Automation) — 17단계 설치, 부팅, 종료, 상태 확인 |
| <img src="https://img.shields.io/badge/Terraform-844FBA?logo=terraform&logoColor=white" height="22"/> | **Terraform** | 선언형 인프라 관리(Declarative Infrastructure Management) — 상태 추적(State Tracking), plan 미리보기 |
| <img src="https://img.shields.io/badge/Helm-0F1689?logo=helm&logoColor=white" height="22"/> | **Helm** | K8s 패키지 관리(Package Management) — values 파일 기반 재현 가능(Reproducible) 배포 |

### CI/CD(Continuous Integration / Continuous Delivery)

| | 기술(Technology) | 역할(Role) |
|:---:|------|------|
| <img src="https://img.shields.io/badge/Argo_CD-EF7B4D?logo=argo&logoColor=white" height="22"/> | **ArgoCD** | GitOps 배포(Deployment) — Git = 단일 진실 공급원(Single Source of Truth), 자동 동기화(Auto Sync) |
| <img src="https://img.shields.io/badge/Jenkins-D24939?logo=jenkins&logoColor=white" height="22"/> | **Jenkins** | CI 파이프라인(Pipeline) — 7단계: Validate → Security → Deploy → Rollout → Health → Integration → Smoke |

---

## SRE 운영 대시보드(SRE Operations Dashboard)

실시간 인프라 모니터링(Real-time Infrastructure Monitoring), 부하 테스트(Load Testing), 스케일링 관측(Scaling Observation), 트래픽 분석(Traffic Analysis)을 통합한 웹 대시보드.

```bash
cd dashboard && npm install && npm run dev
# → http://localhost:5173 (프론트엔드) / http://localhost:3000 (백엔드 API)
```

### 페이지 구성(Pages) — 6개

#### 1. Overview — 개요(`/`)

4개 클러스터 2×2 요약 카드(Summary Cards). 각 카드에 노드 수(Node Count), Pod 상태(Status) — Running/Pending/Failed 뱃지(Badge), 평균 CPU/RAM 사용률 바(Utilization Bar), 네임스페이스(Namespace)별 Pod 분포 테이블이 표시된다.

#### 2. Cluster Detail — 클러스터 상세(`/cluster/:name`)

개별 클러스터 심층 분석(Deep Dive). 노드별 CPU/Memory/Disk 게이지 차트(Gauge Chart), RX/TX 네트워크 스파크라인(Sparkline), 열린 포트(Open Ports) 테이블, Pod 목록이 확장/축소 가능한(Collapsible) 카드로 제공된다.

#### 3. Testing — 테스트(`/testing`)

16개 프리셋(Preset) 시나리오 + 커스텀(Custom) 테스트를 대시보드에서 직접 실행한다. 테스트 진행 중 실시간 프로그레스 바(Progress Bar), 완료 시 p95/p99 지연시간(Latency) · RPS(Requests Per Second) · 에러율(Error Rate) 등 핵심 지표(Key Metrics)가 표시된다. 결과는 CSV(Comma-Separated Values)로 다운로드 가능하다.

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
| Cascade — Light | Cascade | 30 VUs / 60s + 60s 쿨다운(Cooldown) — 웹+앱(Web+App) 동시 부하, 4개 HPA(Horizontal Pod Autoscaler) 관측 |
| Cascade — Heavy | Cascade | 150 VUs / 120s + 90s 쿨다운(Cooldown) — 3-Tier 전체 부하(Full 3-Tier Load) |
| Cascade — Ramp | Cascade | 0→100 VUs ramp 20s / 60s + 60s 쿨다운(Cooldown) — 점진적 3-Tier 부하 |
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

### 백엔드 API(Backend APIs) — 11개

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
# 방법 1: 인프라 설치 + 대시보드까지 한 번에 (권장)
./scripts/demo.sh

# 방법 2: 인프라만 설치 (대시보드 별도 실행)
./scripts/install.sh
```

`demo.sh`는 인프라 설치 → 상태 확인 → 대시보드 기동 → 브라우저 자동 오픈까지 원스톱(One-stop)으로 실행한다.

```bash
# demo.sh 옵션(Options)
./scripts/demo.sh                  # 전체: 설치 + 대시보드
./scripts/demo.sh --skip-install   # 기존 VM 부팅 + 대시보드
./scripts/demo.sh --dashboard-only # 대시보드만 실행
./scripts/demo.sh --skip-dashboard # 인프라만 설치 (대시보드 없이)
```

`install.sh` 또는 `demo.sh` 실행 시 다음이 **자동으로** 실행된다:

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
Phase 13 → Sealed Secrets 시크릿 관리 (platform, dev)
Phase 14 → RBAC + OPA Gatekeeper 정책 강제 (전체, dev)
Phase 15 → etcd 백업 + Velero 리소스 백업 (전체, platform)
Phase 16 → ResourceQuota + LimitRange (dev, staging, prod)
Phase 17 → Harbor 프라이빗 레지스트리 (platform)
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

### 맥북 켰을 때(Boot) — 권장: demo.sh

```bash
# 방법 1: VM 부팅 + 대시보드 한 번에 (권장)
./scripts/demo.sh --skip-install

# 방법 2: VM만 부팅 (대시보드 별도)
./scripts/boot.sh
```

`demo.sh --skip-install`은 VM 10개 시작 → 클러스터 헬스체크(Health Check) → 서비스 검증(Service Verification) → 대시보드 기동 → 브라우저 오픈까지 자동 수행.

### SRE 대시보드만 실행(Start Dashboard Only)

```bash
# 방법 1: demo.sh 사용
./scripts/demo.sh --dashboard-only

# 방법 2: 직접 실행
cd dashboard && npm install && npm run dev
# → http://localhost:5173 (프론트엔드) / http://localhost:3000 (백엔드 API)
```

맥 로컬에서 실행되는 Node.js 프로세스. VM과는 별도이므로 VM 부팅 후 시작해야 한다.

### SRE 대시보드 종료(Stop Dashboard)

```bash
# 포그라운드(Foreground)에서 실행 중이면 Ctrl+C
# 백그라운드(Background)에서 실행 중이면
kill $(lsof -t -i:3000)
```

`shutdown.sh`는 VM만 종료하므로, 대시보드는 별도로 종료해야 한다.

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

> **참고(Note)**: `shutdown.sh`는 Tart VM만 종료한다. 대시보드가 실행 중이면 `kill $(lsof -t -i:3000)`으로 별도 종료할 것.

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
| Harbor | `http://<platform-worker1>:30400` | admin / Harbor12345 |

```bash
# ArgoCD 비밀번호 확인(Get ArgoCD Password)
kubectl --kubeconfig kubeconfig/platform.yaml \
  -n argocd get secret argocd-initial-admin-secret \
  -o jsonpath="{.data.password}" | base64 --decode && echo
```

### Dev 클러스터 서비스(Dev Cluster Services)

| 서비스(Service) | URL | 계정(Credentials) |
|--------|-----|------|
| Nginx 데모(Demo) | `http://<dev-worker1>:30080` | — |
| Keycloak | `http://<dev-worker1>:30880` | admin / admin |
| Istio Gateway | NodePort (자동 할당 / Auto-assigned) | — |

### SRE 대시보드(SRE Dashboard)

```bash
cd dashboard && npm install && npm run dev
# → http://localhost:5173 (프론트엔드) / http://localhost:3000 (백엔드 API)
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
| redis | redis:7-alpine | 1 (HPA: 1→4) | 캐시/세션 저장소(Cache/Session Store) |
| postgres | postgres:16-alpine | 1 (HPA: 1→4) | 데이터베이스(Database) — Keycloak 백엔드(Backend) + 3-Tier DB 계층 |
| rabbitmq | rabbitmq:3-management-alpine | 1 (HPA: 1→3) | 메시지 큐(Message Queue) — AMQP 5672 + Management UI 15672 |
| keycloak | quay.io/keycloak/keycloak | 1 | 인증 서버(Auth Server) — SSO/OAuth 2.0, NodePort 30880, PostgreSQL 백엔드 |

### 서비스 아키텍처(Service Architecture)

```
                    ┌───────────────────────────────────────────────────────┐
                    │                    demo namespace                     │
                    │                                                       │
  Client ──:30080─→ │  nginx ──→ httpbin ──→ redis (cache)                  │
                    │   (web)      (api)  ├→ postgres (DB)                  │
                    │                     └→ rabbitmq (MQ)                  │
                    │                                                       │
  Client ──:30880─→ │  keycloak ──→ postgres (auth DB)                     │
                    │   (SSO)                                               │
                    └───────────────────────────────────────────────────────┘
```

---

## DevOps 파이프라인 데모(DevOps Pipeline Demo)

### ArgoCD Application — GitOps 배포(GitOps Deployment)

`manifests/argocd/demo-app.yaml`로 ArgoCD Application CR(Custom Resource)을 정의한다.
Git 저장소의 `manifests/demo/` 디렉토리를 감시하여, 변경이 감지되면 dev 클러스터에 자동 동기화(Auto Sync)한다.

```yaml
# manifests/argocd/demo-app.yaml
spec:
  source:
    repoURL: https://github.com/iamywl/IaC_apple_sillicon.git
    path: manifests/demo              # 데모 앱 매니페스트 경로
  destination:
    name: dev-cluster
    namespace: demo
  syncPolicy:
    automated:
      prune: true                     # Git에서 삭제된 리소스 자동 정리
      selfHeal: true                  # 수동 변경 시 자동 복구
```

### Jenkins Pipeline — 7단계 CI/CD 파이프라인(7-Stage CI/CD Pipeline)

`manifests/jenkins/demo-pipeline.yaml`에 실제 서비스 배포 전체 과정을 재현하는 7단계 파이프라인이 정의되어 있다.

```
Git Push → Jenkins Pipeline
  │
  ├─ 1. Validate Manifests   : kubectl --dry-run=client 문법 검증
  ├─ 2. Security Scan        : 하드코딩 시크릿/리소스 제한/이미지 태그 검사
  ├─ 3. Deploy to Dev        : ArgoCD app sync (GitOps)
  ├─ 4. Wait for Rollouts    : 6개 Deployment rollout status 대기
  ├─ 5. Health Check         : Pod/HPA/Service/NetworkPolicy 상태 확인
  ├─ 6. Integration Test     : nginx/keycloak/httpbin/redis/postgres/rabbitmq 연결 검증
  └─ 7. Smoke Test           : E2E 요청 체인 + L7 정책 검증 + Keycloak 헬스체크
```

| 단계(Stage) | 동작(Action) |
|------------|------------|
| Validate Manifests | demo + hpa + network-policies 전체 매니페스트 `--dry-run=client` 검증 |
| Security Scan | 하드코딩 시크릿(Secret) 탐지, 리소스 제한(Resource Limits) 확인, `:latest` 태그 경고 |
| Deploy to Dev | `argocd app sync`로 GitOps 동기화 트리거 |
| Wait for Rollouts | nginx, httpbin, redis, postgres, rabbitmq, keycloak 6개 Deployment `rollout status` 대기 |
| Health Check | Pod 상태, HPA 현황, Service 목록, CiliumNetworkPolicy 확인 |
| Integration Test | nginx HTTP · Keycloak 콘솔 · httpbin API · Redis PING · PostgreSQL `pg_isready` · RabbitMQ Management API 연결 검증 |
| Smoke Test | 전체 요청 체인(nginx→httpbin) 확인, L7 정책(GET 허용/POST 차단) 검증, Keycloak `/health/ready` 확인 |

---

## 프로젝트 구조(Project Structure)

```
tart-infra/
│
├── config/
│   └── clusters.json                   ← 클러스터/VM 정의 — 단일 진실 공급원(Single Source of Truth)
│
├── scripts/
│   ├── demo.sh                         ← 원스톱 데모(One-stop Demo) — 설치 + 대시보드 한 번에
│   ├── install.sh                      ← 전체 설치(Full Install) — Phase 1~17
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
│   ├── install/                        ← 설치 단계(Install Phases) 01~17
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
│   ├── velero-values.yaml              ← Velero 백업 설정(Backup Config)
│   ├── harbor-values.yaml              ← Harbor 레지스트리 설정(Registry Config)
│   ├── alerting/                       ← PrometheusRule + 웹훅 수신기(Webhook Receiver)
│   ├── network-policies/               ← CiliumNetworkPolicy — 제로 트러스트(Zero Trust) L7
│   ├── hpa/                            ← HPA + PDB
│   ├── istio/                          ← Istio 전체 설정 — mTLS, 카나리(Canary), 서킷브레이커(Circuit Breaker)
│   ├── sealed-secrets/                 ← Sealed Secrets 데모 시크릿 + RBAC
│   ├── rbac/                           ← RBAC 커스텀 역할(Custom Roles) — namespace-admin, readonly, developer
│   ├── gatekeeper/                     ← OPA Gatekeeper ConstraintTemplate + Constraint
│   ├── backup/                         ← Velero Schedule (일간 + 시간별 백업)
│   ├── resource-quotas/                ← ResourceQuota + LimitRange (dev/staging/prod)
│   ├── argocd/                         ← ArgoCD Application CR — GitOps 배포(Deployment)
│   ├── jenkins/                        ← Jenkins Pipeline ConfigMap — CI 데모(Demo)
│   └── demo/                           ← nginx, httpbin, redis, postgres, rabbitmq, keycloak, k6, stress-ng 매니페스트(Manifests)
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
│   │   ├── index.ts                    ← Express 서버 + API 라우팅(Routing) — 11개 엔드포인트
│   │   ├── collector.ts                ← 백그라운드 수집 루프(Background Collection Loop) — VM/Pod/트래픽/HPA
│   │   ├── jobs.ts                     ← K8s Job 라이프사이클(Lifecycle) — k6/stress-ng/scaling/cascade 실행·결과·CSV
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
│   │   │   ├── TestingPage.tsx         ← 16개 시나리오 + 커스텀 테스트(Custom Test)
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
├── LEARN/                                 ← 프로젝트 학습 (이론 + 실습)
│   ├── STUDY_PLAN.md                    ← 5주(25일) 학습 계획
│   ├── 01~15-*.md                       ← 학습 가이드 15개 문서
│   ├── guide/                           ← 실습 가이드 13개 문서
│   └── presentation.md                  ← 프로젝트 소개 PPT
│
├── k8scert/                               ← K8s 자격증 (CKA, CKAD, CKS, KCNA, KCSA)
│
├── certification/                         ← 기술별 심화 학습
│   └── {alertmanager,argocd,...}/       ← 20개 기술별 심화 학습
│
└── docs/                                  ← 참고 자료, 다이어그램
```

---

## 프로젝트 학습(Project Learning)

이 프로젝트가 **어떻게 동작하는지** 처음부터 끝까지 설명하는 학습 자료:

- **[LEARN/](LEARN/)** — 프로젝트 학습 (이론 15개 + 실습 13개 + 학습 계획 + PPT)
- **[k8scert/](k8scert/)** — K8s 자격증 (CKA, CKAD, CKS, KCNA, KCSA)
- **[certification/](certification/)** — 기술별 심화 학습 (20개 모듈)

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

# Harbor 레지스트리 접속(Harbor Registry Access)
open http://$(tart ip platform-worker1):30400

# Sealed Secrets 상태(Sealed Secrets Status)
kubectl --kubeconfig kubeconfig/platform.yaml -n sealed-secrets get pods

# OPA Gatekeeper 제약 조건 위반 확인(Gatekeeper Constraint Violations)
kubectl --kubeconfig kubeconfig/dev.yaml get constraints

# RBAC 역할 확인(RBAC Roles)
kubectl --kubeconfig kubeconfig/dev.yaml get clusterrole | grep tart-infra

# ResourceQuota 사용량 확인(ResourceQuota Usage)
kubectl --kubeconfig kubeconfig/dev.yaml describe resourcequota demo-quota -n demo

# etcd 백업 상태 확인(etcd Backup Status)
ssh admin@$(tart ip platform-master) 'ls -la /opt/etcd-backup/'

# Velero 백업 확인(Velero Backup List)
kubectl --kubeconfig kubeconfig/platform.yaml -n velero get schedules
```

---

## 참고 문서(Reference Documents)

| 문서(Document) | 설명(Description) |
|------|------|
| [프레젠테이션(Presentation)](docs/presentation.md) | 프로젝트 발표 자료 |
| [아키텍처 다이어그램(Architecture Diagrams)](docs/) | SVG 형식 아키텍처 다이어그램 5종 |
| [Tart 소개(Tart Introduction)](docs/tart.md) | Tart VM 런타임(Runtime) 개요(Overview) |
| [Terraform 연동(Terraform Integration)](docs/terraform.md) | Terraform 모듈 설계(Module Design) |
# IaC_apple_sillicon
