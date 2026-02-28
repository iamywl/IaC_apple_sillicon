# 소프트웨어 아키텍처 설계 문서(Software Architecture Design Document)

## 1. 시스템 개요(System Overview)

이 프로젝트는 **단일 물리 머신(Single Physical Machine, M4 Max MacBook Pro)** 위에서 프로덕션(Production) 수준의 멀티클러스터(Multi-cluster) Kubernetes 인프라(Infrastructure)를 구축한다. 소프트웨어 공학적(Software Engineering)으로 다음 원칙을 따른다:

- **선언적 인프라(Declarative Infrastructure)**: JSON/YAML/HCL로 원하는 상태(Desired State)를 정의하고, 도구가 이를 실현
- **관심사 분리(Separation of Concerns)**: 네트워크(Network), 컴퓨팅(Computing), 오케스트레이션(Orchestration), 관측(Observation)을 각각 독립 레이어(Layer)로 분리
- **멱등성(Idempotency)**: 스크립트와 Terraform 모두 여러 번 실행해도 동일한 결과를 보장
- **Fail-Fast + Graceful Degradation**: `set -euo pipefail`로 즉시 실패하되, 모니터링 수집은 `Promise.allSettled`로 부분 실패(Partial Failure) 허용

---

## 2. 계층 아키텍처(Layered Architecture)

```
┌──────────────────────────────────────────────────────────────┐
│ Layer 7: Application                                         │
│   Demo Apps (nginx, httpbin v1/v2, redis)                    │
│   Istio VirtualService, DestinationRule                      │
├──────────────────────────────────────────────────────────────┤
│ Layer 6: Service Mesh (Istio)                                │
│   사이드카 프록시(Sidecar Proxy, Envoy) ← 자동 주입(Auto Injection)│
│   mTLS(Mutual TLS), 카나리 라우팅(Canary Routing),               │
│   서킷브레이커(Circuit Breaker)                                   │
├──────────────────────────────────────────────────────────────┤
│ Layer 5: Observability                                       │
│   Prometheus → Grafana (메트릭, Metrics)                      │
│   Loki → Grafana (로그, Logs)                                │
│   AlertManager → Webhook (알림, Alerting)                     │
│   Hubble UI (네트워크 흐름, Network Flows)                     │
│   Custom Dashboard (VM/Pod 실시간, Real-time)                 │
├──────────────────────────────────────────────────────────────┤
│ Layer 4: Network Policy                                      │
│   CiliumNetworkPolicy (L3/L4/L7)                             │
│   Default Deny → Whitelist 패턴(Pattern)                      │
├──────────────────────────────────────────────────────────────┤
│ Layer 3: Orchestration (Kubernetes)                           │
│   kubeadm v1.31 (4 clusters)                                 │
│   HPA(Horizontal Pod Autoscaler) + metrics-server            │
│   + PDB(Pod Disruption Budget)                               │
│   CI/CD: Jenkins, ArgoCD                                     │
├──────────────────────────────────────────────────────────────┤
│ Layer 2: Container Networking (Cilium)                        │
│   eBPF(extended Berkeley Packet Filter) 기반 CNI              │
│   kubeProxyReplacement: true (kube-proxy 대체, Replacement)   │
│   Hubble (네트워크 가시성, Network Visibility)                  │
├──────────────────────────────────────────────────────────────┤
│ Layer 1: Container Runtime (containerd)                       │
│   SystemdCgroup = true                                       │
│   kubeadm이 관리하는 컨테이너 라이프사이클(Container Lifecycle)   │
├──────────────────────────────────────────────────────────────┤
│ Layer 0: Virtual Machine (Tart)                               │
│   Apple Hypervisor.framework (ARM64 네이티브, Native)          │
│   Softnet networking (VM 간 통신, Inter-VM Communication)      │
│   DHCP 기반 IP 할당(IP Assignment)                             │
├──────────────────────────────────────────────────────────────┤
│ Hardware: M4 Max (16 CPU / 128GB RAM / Apple Silicon)         │
└──────────────────────────────────────────────────────────────┘
```

### 왜 이 구조인가?(Why This Structure?)

**각 레이어가 독립적으로 교체 가능(Independently Replaceable)**하다:
- Tart → UTM/QEMU로 교체해도 L1 이상은 동일
- Cilium → Calico로 교체해도 L3 이상은 동일
- Istio → Linkerd로 교체해도 L7 애플리케이션(Application)은 동일

이것이 **레이어드 아키텍처(Layered Architecture)의 핵심 가치**: 변경의 영향 범위(Blast Radius)를 해당 레이어로 격리(Isolate)한다.

---

## 3. 멀티클러스터 설계(Multi-cluster Design)

### 3.1 클러스터 역할 분리(Cluster Role Separation)

```
┌─────────────────────────────────────────────────────────────┐
│                    멀티클러스터 토폴로지(Multi-cluster Topology)  │
│                                                             │
│  ┌─── platform ───┐   "관리 클러스터(Management Cluster)"     │
│  │  Prometheus     │   - 모니터링(Monitoring) 스택 집중 배치   │
│  │  Grafana        │   - CI/CD 파이프라인(Pipeline)           │
│  │  Loki           │   - 알림 시스템(Alerting System)         │
│  │  AlertManager   │   → 워크로드(Workload)와 관리를 물리적 분리│
│  │  Jenkins        │                                        │
│  │  ArgoCD         │                                        │
│  └─────────────────┘                                        │
│                                                             │
│  ┌── dev ──────┐  ┌── staging ──┐  ┌── prod ──────┐        │
│  │ Istio       │  │             │  │              │        │
│  │ HPA         │  │ metrics-    │  │ 3 nodes      │        │
│  │ NetworkPol  │  │ server      │  │ HA 구성(HA   │        │
│  │ metrics-srv │  │             │  │  Config)     │        │
│  └─────────────┘  └─────────────┘  └──────────────┘        │
│                                                             │
│  "개발환경(Dev)"      "스테이징(Staging)"  "프로덕션(Production)"│
│  실험적 기능 검증      프로덕션 전 검증     안정성 우선           │
│  (Feature Testing)  (Pre-prod Verify)  (Stability First)   │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 네트워크 격리 설계(Network Isolation Design)

| 클러스터(Cluster) | Pod CIDR | Service CIDR | 설계 의도(Design Intent) |
|----------|----------|--------------|-----------|
| platform | 10.10.0.0/16 | 10.96.0.0/16 | 관리용(Management) — 65,534 Pod IP |
| dev | 10.20.0.0/16 | 10.97.0.0/16 | 개발(Development) — 서비스 메시(Service Mesh) 실험 |
| staging | 10.30.0.0/16 | 10.98.0.0/16 | 검증(Verification) |
| prod | 10.40.0.0/16 | 10.99.0.0/16 | 운영(Production) |

**왜 /16인가?(Why /16?)**
- /16 = 65,534개 Pod IP → 단일 클러스터에서 충분
- 클러스터 간 CIDR이 겹치지 않아 향후 클러스터 메시(Cluster Mesh) 구성 가능
- Service CIDR도 10.96~10.99로 분리하여 충돌 방지(Conflict Prevention)

---

## 4. 설정 중앙 집중화(Centralized Configuration) — Single Source of Truth

### 4.1 clusters.json — 진실의 단일 소스(Single Source of Truth)

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

**모든 스크립트와 도구가 이 파일을 참조**한다:
- Bash 스크립트: `jq`로 파싱(Parsing) (`scripts/lib/common.sh`)
- Terraform: `variables.tf`로 동일 구조 재현 (HCL)
- Dashboard: `server/config.ts`에서 파싱

이것이 **DRY(Don't Repeat Yourself)** 원칙의 실현이다. 클러스터를 추가할 때 이 파일 하나만 수정하면 모든 도구가 반영된다.

### 4.2 설정 흐름(Configuration Flow)

```
clusters.json
    ├── scripts/lib/common.sh → jq 파싱 → get_cluster_names(), get_pod_cidr() 등
    ├── terraform/variables.tf → HCL 변수(Variables) — 동일 구조
    └── dashboard/server/config.ts → JSON.parse → 타입 안전 설정(Type-safe Configuration)
```

---

## 5. 스크립트 아키텍처(Script Architecture) — Modular Shell Design

### 5.1 모듈 구조(Module Structure)

```
scripts/
├── lib/                  ← 공유 라이브러리(Shared Library) — 재사용 함수(Reusable Functions)
│   ├── common.sh         ← 설정 파싱(Config Parsing), 로깅(Logging), 유틸리티(Utilities)
│   ├── vm.sh             ← VM 생명주기(Lifecycle) — clone, start, stop, delete
│   ├── ssh.sh            ← SSH 연결(Connection) — exec, scp, wait
│   └── k8s.sh            ← K8s 관리(Management) — init, join, cilium, hubble
│
├── install/              ← 설치 단계(Installation Phases) — 01~12, 순차 실행(Sequential Execution)
│   ├── 01-create-vms.sh
│   ├── ...
│   └── 12-install-istio.sh
│
├── boot/                 ← 부팅 단계(Boot Phases) — 01~03
│   ├── 01-start-vms.sh
│   ├── 02-wait-clusters.sh
│   └── 03-verify-services.sh
│
├── install.sh            ← 설치 진입점(Installation Entry Point) — Phase 1~12 순차 호출
├── boot.sh               ← 일상 시작(Daily Start)
├── shutdown.sh            ← 종료(Shutdown)
├── status.sh             ← 상태 확인(Status Check)
└── destroy.sh            ← 전체 삭제(Full Teardown)
```

### 5.2 소프트웨어 공학 패턴(Software Engineering Patterns)

**1. 퍼사드 패턴(Facade Pattern)**
- `install.sh`는 12개 서브스크립트(Sub-scripts)의 Facade
- 사용자는 `./scripts/install.sh` 하나만 실행

**2. 템플릿 메서드 패턴(Template Method Pattern)**
- 모든 설치 스크립트가 동일한 구조: `source lib → iterate clusters → iterate nodes → execute`
- `common.sh`가 템플릿(Template) 제공

**3. 전략 패턴(Strategy Pattern)**
- `ssh_exec` vs `ssh_exec_sudo`: 동일한 인터페이스(Interface), 다른 실행 전략(Execution Strategy)
- `kubectl_cmd`: 클러스터별 kubeconfig를 주입(Inject)하여 동일 명령으로 다른 클러스터 제어

**4. 책임 연쇄 패턴(Chain of Responsibility)**
- `install.sh`의 Phase 1→12는 체인(Chain)
- 각 Phase는 이전 Phase의 결과에 의존(Dependency) — VM → Runtime → K8s → CNI → Apps

### 5.3 에러 처리 전략(Error Handling Strategy)

```bash
set -euo pipefail    # 즉시 실패(Fail-Fast)
```

| 플래그(Flag) | 의미(Meaning) | 소프트웨어 공학 원칙(Principle) |
|--------|------|---------------------|
| `-e` | 명령 실패 시 즉시 종료(Exit on Error) | Fail-Fast |
| `-u` | 미정의 변수 사용 시 에러(Undefined Variable Error) | 안전성(Safety) |
| `-o pipefail` | 파이프(Pipe) 중간 실패도 감지 | 완전한 에러 전파(Full Error Propagation) |

---

## 6. 데이터 흐름(Data Flow)

### 6.1 설치 시 데이터 흐름(Installation Data Flow)

```
clusters.json
    │
    ▼
┌─── Phase 1: VM 생성(Creation) ───┐
│ tart clone → tart set              │ → VM 이미지 + 리소스 설정
└─────────┬───────────────────────────┘
          ▼
┌─── Phase 2-4: 노드 준비(Node Preparation) ─┐
│ SSH → apt → kubeadm                          │ → 컨테이너 런타임(Container Runtime) + K8s 바이너리(Binaries)
└─────────┬────────────────────────────────────┘
          ▼
┌─── Phase 5: 클러스터 초기화(Cluster Init) ─┐
│ kubeadm init → join                         │ → kubeconfig 생성 → 로컬 저장(Local Save)
└─────────┬───────────────────────────────────┘
          ▼
┌─── Phase 6: CNI ──────────┐
│ Helm → Cilium              │ → Pod 네트워킹 활성화(Networking Enabled) → 노드 Ready
└─────────┬─────────────────┘
          ▼
┌─── Phase 7-12: 스택(Stack) ──────┐
│ Monitoring, CI/CD, Istio          │ → 옵저버빌리티(Observability) + 배포 파이프라인(Deployment Pipeline)
└───────────────────────────────────┘
```

### 6.2 런타임 데이터 흐름(Runtime Data Flow) — 대시보드(Dashboard)

```
     Browser (React)
         │ GET /api/snapshot (5초 간격, 5s interval)
         ▼
     Express Server
         │
    ┌────┼─────────────────┐
    │    │                  │
    ▼    ▼                  ▼
tart CLI  SSH Pool       kubectl
(VM상태)  (리소스/포트)   (노드/Pod)
    │    │                  │
    └────┼─────────────────┘
         │
    DashboardSnapshot (메모리 캐시, In-memory Cache)
         │
         ▼
     JSON Response → React State → UI 렌더링(Rendering)
```

---

## 7. 리소스 관리 전략(Resource Management Strategy)

### 7.1 CPU 오버커밋(CPU Overcommit)

| 항목(Item) | 값(Value) |
|------|-----|
| 물리 CPU(Physical CPU) | 16 코어(Cores) |
| 할당 vCPU(Allocated vCPU) | 21 코어 |
| 오버커밋 비율(Overcommit Ratio) | 1.31x |

**왜 오버커밋하는가?(Why Overcommit?)**
- K8s 컨트롤 플레인(Control Plane) 노드는 대부분 유휴 상태(Idle) — etcd, scheduler는 CPU 1% 미만
- 실제 CPU 사용률(Utilization)은 전체 30% 미만
- 프로덕션(Production)에서도 2~3x 오버커밋은 일반적

### 7.2 메모리 할당(Memory Allocation) — 오버커밋 없음(No Overcommit)

| 항목(Item) | 값(Value) |
|------|-----|
| 물리 RAM(Physical RAM) | 128 GB |
| 할당 RAM(Allocated RAM) | ~71.5 GB |
| 여유(Free) | ~56.5 GB |

**메모리는 오버커밋하지 않는다** — OOM Killer가 프로세스를 죽이면 데이터 손실(Data Loss) 위험.

### 7.3 클러스터별 리소스 배분(Resource Distribution per Cluster)

| 클러스터(Cluster) | 노드 수(Nodes) | vCPU | RAM | 역할(Role) |
|----------|---------|------|-----|------|
| platform | 3 | 7 | 24 GB | 모니터링(Monitoring), CI/CD |
| dev | 2 | 4 | 12 GB | 개발(Development), 실험(Experiment) |
| staging | 2 | 4 | 12 GB | 검증(Verification) |
| prod | 3 | 6 | 19.5 GB | 프로덕션(Production) |
| **합계(Total)** | **10** | **21** | **~71.5 GB** | |

---

## 8. 보안 설계(Security Design)

### 8.1 네트워크 보안 계층(Network Security Layers)

```
┌── Layer 1: VM 격리(VM Isolation) ────────────────────────┐
│  Tart softnet → 호스트(Host)만 VM에 접근 가능              │
│  외부 네트워크에서 VM 직접 접근 불가                         │
├── Layer 2: K8s API 인증(Authentication) ─────────────────┤
│  kubeconfig (x509 인증서, Certificate) → 클러스터별 독립 CA │
│  RBAC(Role-Based Access Control)                         │
├── Layer 3: CiliumNetworkPolicy ──────────────────────────┤
│  Default Deny → Whitelist (명시적 허용, Explicit Allow)    │
│  L7 HTTP 메서드(Method) 필터링(Filtering) — GET만 허용 등   │
├── Layer 4: Istio mTLS(Mutual TLS) ───────────────────────┤
│  Pod 간 통신 전체 암호화(Full Encryption, STRICT 모드)      │
│  인증서 자동 회전(Auto Certificate Rotation, Citadel)       │
└──────────────────────────────────────────────────────────┘
```

### 8.2 Zero Trust 원칙 적용(Zero Trust Principle Application)

| 원칙(Principle) | 구현(Implementation) |
|------|------|
| 기본 차단(Default Deny) | CiliumNetworkPolicy `default-deny-all` |
| 최소 권한(Least Privilege) | nginx → httpbin은 GET만 허용 |
| 상호 인증(Mutual Authentication) | Istio mTLS STRICT |
| 관측 가능(Observable) | Hubble로 모든 네트워크 흐름(Network Flow) 관찰 |

---

## 9. 확장성 고려사항(Scalability Considerations)

### 9.1 수평 확장(Horizontal Scale-Out)

```
현재(Current): 4 클러스터 / 10 VM / 21 vCPU / 71.5 GB RAM
최대(Maximum): 5-6 클러스터 / 13-14 VM / ~28 vCPU / ~90 GB RAM
```

**새 클러스터 추가 절차(New Cluster Addition Procedure):**
1. `config/clusters.json`에 클러스터 정의(Cluster Definition) 추가
2. `terraform/variables.tf`에 동일 구조 추가
3. `./scripts/install.sh` 또는 `terraform apply` 실행

### 9.2 수직 확장(Vertical Scale-Up)

- HPA(Horizontal Pod Autoscaler)가 CPU 50% 기준으로 Pod 자동 확장(Auto-scaling) — min 3 → max 10
- PDB(Pod Disruption Budget)로 최소 가용(Minimum Available) Pod 보장
- metrics-server가 실시간(Real-time) CPU/메모리 메트릭(Metrics) 제공

---

## 10. 설계 결정 기록(Architecture Decision Records, ADR)

### ADR-001: Tart 선택 (vs UTM, Lima)

**결정(Decision)**: Apple Hypervisor.framework 기반 Tart를 VM 런타임(Runtime)으로 선택
**근거(Rationale)**:
- ARM64 네이티브(Native) — 에뮬레이션(Emulation) 없음, 최대 성능
- CLI 우선 설계(CLI-first Design) → 스크립트 자동화(Script Automation)에 적합
- macOS에 최적화된 네트워크 스택(Network Stack) — softnet

### ADR-002: Cilium 선택 (vs Calico, Flannel)

**결정(Decision)**: eBPF(extended Berkeley Packet Filter) 기반 Cilium을 CNI(Container Network Interface)로 선택
**근거(Rationale)**:
- kube-proxy 완전 대체(Full Replacement) — kubeProxyReplacement: true → 성능 향상
- L7 네트워크 정책(Network Policy) 지원 — HTTP 메서드 필터링(Method Filtering)
- Hubble로 네트워크 가시성(Network Visibility) 내장

### ADR-003: kubeadm 선택 (vs k3s, kind, minikube)

**결정(Decision)**: kubeadm으로 프로덕션급(Production-grade) 클러스터 구성
**근거(Rationale)**:
- 실제 프로덕션과 동일한 구성 요소(Components) — etcd, kube-apiserver, scheduler
- kube-proxy 스킵(Skip) 가능 — Cilium과 조합
- 학습 목적(Learning Purpose)에 적합 — 수동 구성으로 원리 이해

### ADR-004: Istio 선택 (vs Linkerd)

**결정(Decision)**: dev 클러스터에 Istio 배포(Deploy)
**근거(Rationale)**:
- 산업 표준(Industry Standard) Service Mesh — 가장 넓은 생태계(Ecosystem)
- 카나리 배포(Canary Deployment), 서킷브레이커(Circuit Breaker), mTLS 등 풍부한 트래픽 관리(Traffic Management)
- Cilium과 공존 가능(Coexistence) — Cilium=L3/L4, Istio=L7 사이드카(Sidecar)

### ADR-005: Bash + Terraform 이중 관리(Dual Management)

**결정(Decision)**: Bash 스크립트와 Terraform을 모두 유지
**근거(Rationale)**:
- Bash: 빠른 프로토타이핑(Rapid Prototyping), 디버깅(Debugging), 학습용
- Terraform: 선언적 관리(Declarative Management), 상태 추적(State Tracking), 재현성(Reproducibility)
- 두 접근법의 장단점(Pros/Cons)을 직접 비교할 수 있는 학습 기회

---

## 부록: 핵심 용어 정리(Glossary)

| 용어(Term) | 설명(Description) |
|------|------|
| kubeadm | K8s 클러스터 부트스트랩(Bootstrap) 도구 |
| Cilium | eBPF(extended Berkeley Packet Filter) 기반 컨테이너 네트워크 인터페이스(Container Network Interface) |
| Istio | Envoy 프록시(Proxy) 기반 서비스 메시(Service Mesh) |
| HPA | Horizontal Pod Autoscaler — 수평 Pod 자동 확장기 |
| PDB | Pod Disruption Budget — 최소 가용(Minimum Available) Pod 보장 |
| mTLS | Mutual TLS — 상호 TLS (양방향 인증서 검증, Bidirectional Certificate Verification) |
| CIDR | Classless Inter-Domain Routing — IP 대역 표기법(IP Range Notation) |
| eBPF | extended Berkeley Packet Filter — 커널 레벨 프로그래밍(Kernel-level Programming) |
| Helm | K8s 패키지 매니저(Package Manager) |
| ArgoCD | GitOps 기반 지속적 배포(Continuous Deployment) 도구 |
