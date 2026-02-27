# 소프트웨어 아키텍처 설계 문서

## 1. 시스템 개요

이 프로젝트는 **단일 물리 머신(M4 Max MacBook Pro)** 위에서 프로덕션 수준의 멀티클러스터 Kubernetes 인프라를 구축한다. 소프트웨어 공학적으로 다음 원칙을 따른다:

- **선언적 인프라(Declarative Infrastructure)**: JSON/YAML/HCL로 원하는 상태를 정의하고, 도구가 이를 실현
- **관심사 분리(Separation of Concerns)**: 네트워크, 컴퓨팅, 오케스트레이션, 관측을 각각 독립 레이어로 분리
- **멱등성(Idempotency)**: 스크립트와 Terraform 모두 여러 번 실행해도 동일한 결과를 보장
- **Fail-Fast + Graceful Degradation**: `set -euo pipefail`로 즉시 실패하되, 모니터링 수집은 `Promise.allSettled`로 부분 실패 허용

---

## 2. 계층 아키텍처 (Layered Architecture)

```
┌──────────────────────────────────────────────────────────────┐
│ Layer 7: Application                                         │
│   Demo Apps (nginx, httpbin v1/v2, redis)                    │
│   Istio VirtualService, DestinationRule                      │
├──────────────────────────────────────────────────────────────┤
│ Layer 6: Service Mesh (Istio)                                │
│   Sidecar Proxy (Envoy) ← 자동 주입                          │
│   mTLS, 카나리 라우팅, 서킷브레이커                             │
├──────────────────────────────────────────────────────────────┤
│ Layer 5: Observability                                       │
│   Prometheus → Grafana (메트릭)                               │
│   Loki → Grafana (로그)                                      │
│   AlertManager → Webhook (알림)                               │
│   Hubble UI (네트워크 흐름)                                    │
│   Custom Dashboard (VM/Pod 실시간)                            │
├──────────────────────────────────────────────────────────────┤
│ Layer 4: Network Policy                                      │
│   CiliumNetworkPolicy (L3/L4/L7)                             │
│   Default Deny → Whitelist 패턴                               │
├──────────────────────────────────────────────────────────────┤
│ Layer 3: Orchestration (Kubernetes)                           │
│   kubeadm v1.31 (4 clusters)                                 │
│   HPA + metrics-server + PDB                                 │
│   CI/CD: Jenkins, ArgoCD                                     │
├──────────────────────────────────────────────────────────────┤
│ Layer 2: Container Networking (Cilium)                        │
│   eBPF 기반 CNI                                               │
│   kubeProxyReplacement: true (kube-proxy 대체)                │
│   Hubble (네트워크 가시성)                                     │
├──────────────────────────────────────────────────────────────┤
│ Layer 1: Container Runtime (containerd)                       │
│   SystemdCgroup = true                                       │
│   kubeadm이 관리하는 컨테이너 라이프사이클                       │
├──────────────────────────────────────────────────────────────┤
│ Layer 0: Virtual Machine (Tart)                               │
│   Apple Hypervisor.framework (ARM64 네이티브)                  │
│   Softnet networking (VM 간 통신)                              │
│   DHCP 기반 IP 할당                                           │
├──────────────────────────────────────────────────────────────┤
│ Hardware: M4 Max (16 CPU / 128GB RAM / Apple Silicon)         │
└──────────────────────────────────────────────────────────────┘
```

### 왜 이 구조인가?

**각 레이어가 독립적으로 교체 가능**하다:
- Tart → UTM/QEMU로 교체해도 L1 이상은 동일
- Cilium → Calico로 교체해도 L3 이상은 동일
- Istio → Linkerd로 교체해도 L7 애플리케이션은 동일

이것이 **레이어드 아키텍처의 핵심 가치**: 변경의 영향 범위를 해당 레이어로 격리한다.

---

## 3. 멀티클러스터 설계

### 3.1 클러스터 역할 분리

```
┌─────────────────────────────────────────────────────────────┐
│                    멀티클러스터 토폴로지                        │
│                                                             │
│  ┌─── platform ───┐   "관리 클러스터"                        │
│  │  Prometheus     │   - 모니터링 스택 집중 배치              │
│  │  Grafana        │   - CI/CD 파이프라인                    │
│  │  Loki           │   - 알림 시스템                         │
│  │  AlertManager   │   → 워크로드와 관리를 물리적 분리        │
│  │  Jenkins        │                                        │
│  │  ArgoCD         │                                        │
│  └─────────────────┘                                        │
│                                                             │
│  ┌── dev ──────┐  ┌── staging ──┐  ┌── prod ──────┐        │
│  │ Istio       │  │             │  │              │        │
│  │ HPA         │  │ metrics-    │  │ 3 nodes      │        │
│  │ NetworkPol  │  │ server      │  │ HA 구성      │        │
│  │ metrics-srv │  │             │  │              │        │
│  └─────────────┘  └─────────────┘  └──────────────┘        │
│                                                             │
│  "개발환경"          "스테이징"         "프로덕션"              │
│  실험적 기능 검증     프로덕션 전 검증    안정성 우선           │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 네트워크 격리 설계

| 클러스터 | Pod CIDR | Service CIDR | 설계 의도 |
|----------|----------|--------------|-----------|
| platform | 10.10.0.0/16 | 10.96.0.0/16 | 관리용 (65,534 Pod IP) |
| dev | 10.20.0.0/16 | 10.97.0.0/16 | 개발 (서비스 메시 실험) |
| staging | 10.30.0.0/16 | 10.98.0.0/16 | 검증 |
| prod | 10.40.0.0/16 | 10.99.0.0/16 | 운영 |

**왜 /16인가?**
- /16 = 65,534개 Pod IP → 단일 클러스터에서 충분
- 클러스터 간 CIDR이 겹치지 않아 향후 클러스터 메시(Cluster Mesh) 구성 가능
- Service CIDR도 10.96~10.99로 분리하여 충돌 방지

---

## 4. 설정 중앙 집중화 (Single Source of Truth)

### 4.1 clusters.json — 진실의 단일 소스

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
- Bash 스크립트: `jq`로 파싱 (`scripts/lib/common.sh`)
- Terraform: `variables.tf`로 동일 구조 재현 (HCL)
- Dashboard: `server/config.ts`에서 파싱

이것이 **DRY(Don't Repeat Yourself)** 원칙의 실현이다. 클러스터를 추가할 때 이 파일 하나만 수정하면 모든 도구가 반영된다.

### 4.2 설정 흐름

```
clusters.json
    ├── scripts/lib/common.sh → jq 파싱 → get_cluster_names(), get_pod_cidr() 등
    ├── terraform/variables.tf → HCL 변수 (동일 구조)
    └── dashboard/server/config.ts → JSON.parse → 타입 안전 설정
```

---

## 5. 스크립트 아키텍처 (Modular Shell Design)

### 5.1 모듈 구조

```
scripts/
├── lib/                  ← 공유 라이브러리 (재사용 함수)
│   ├── common.sh         ← 설정 파싱, 로깅, 유틸리티
│   ├── vm.sh             ← VM 생명주기 (clone, start, stop, delete)
│   ├── ssh.sh            ← SSH 연결 (exec, scp, wait)
│   └── k8s.sh            ← K8s 관리 (init, join, cilium, hubble)
│
├── install/              ← 설치 단계 (01~12, 순차 실행)
│   ├── 01-create-vms.sh
│   ├── ...
│   └── 12-install-istio.sh
│
├── boot/                 ← 부팅 단계 (01~03)
│   ├── 01-start-vms.sh
│   ├── 02-wait-clusters.sh
│   └── 03-verify-services.sh
│
├── install.sh            ← 설치 진입점 (Phase 1~12 순차 호출)
├── boot.sh               ← 일상 시작
├── shutdown.sh            ← 종료
├── status.sh             ← 상태 확인
└── destroy.sh            ← 전체 삭제
```

### 5.2 소프트웨어 공학 패턴

**1. Facade 패턴**
- `install.sh`는 12개 서브스크립트의 Facade
- 사용자는 `./scripts/install.sh` 하나만 실행

**2. Template Method 패턴**
- 모든 설치 스크립트가 동일한 구조: `source lib → iterate clusters → iterate nodes → execute`
- `common.sh`가 템플릿 제공

**3. Strategy 패턴**
- `ssh_exec` vs `ssh_exec_sudo`: 동일한 인터페이스, 다른 실행 전략
- `kubectl_cmd`: 클러스터별 kubeconfig를 주입하여 동일 명령으로 다른 클러스터 제어

**4. Chain of Responsibility**
- `install.sh`의 Phase 1→12는 체인
- 각 Phase는 이전 Phase의 결과에 의존 (VM → Runtime → K8s → CNI → Apps)

### 5.3 에러 처리 전략

```bash
set -euo pipefail    # 즉시 실패 (Fail-Fast)
```

| 플래그 | 의미 | 소프트웨어 공학 원칙 |
|--------|------|---------------------|
| `-e` | 명령 실패 시 즉시 종료 | Fail-Fast |
| `-u` | 미정의 변수 사용 시 에러 | 안전성 (Safety) |
| `-o pipefail` | 파이프 중간 실패도 감지 | 완전한 에러 전파 |

---

## 6. 데이터 흐름 (Data Flow)

### 6.1 설치 시 데이터 흐름

```
clusters.json
    │
    ▼
┌─── Phase 1: VM 생성 ───┐
│ tart clone → tart set   │ → VM 이미지 + 리소스 설정
└─────────┬───────────────┘
          ▼
┌─── Phase 2-4: 노드 준비 ─┐
│ SSH → apt → kubeadm       │ → 컨테이너 런타임 + K8s 바이너리
└─────────┬─────────────────┘
          ▼
┌─── Phase 5: 클러스터 초기화 ─┐
│ kubeadm init → join          │ → kubeconfig 생성 → 로컬 저장
└─────────┬────────────────────┘
          ▼
┌─── Phase 6: CNI ──────────┐
│ Helm → Cilium              │ → Pod 네트워킹 활성화 → 노드 Ready
└─────────┬─────────────────┘
          ▼
┌─── Phase 7-12: 스택 ──────┐
│ Monitoring, CI/CD, Istio   │ → 관측성 + 배포 파이프라인
└────────────────────────────┘
```

### 6.2 런타임 데이터 흐름 (대시보드)

```
     Browser (React)
         │ GET /api/snapshot (5초 간격)
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
    DashboardSnapshot (메모리 캐시)
         │
         ▼
     JSON Response → React State → UI 렌더링
```

---

## 7. 리소스 관리 전략

### 7.1 CPU 오버커밋

| 항목 | 값 |
|------|-----|
| 물리 CPU | 16 코어 |
| 할당 vCPU | 21 코어 |
| 오버커밋 비율 | 1.31x |

**왜 오버커밋하는가?**
- K8s control plane 노드는 대부분 유휴 상태 (etcd, scheduler는 CPU 1% 미만)
- 실제 CPU 사용률은 전체 30% 미만
- 프로덕션에서도 2~3x 오버커밋은 일반적

### 7.2 메모리 할당 (오버커밋 없음)

| 항목 | 값 |
|------|-----|
| 물리 RAM | 128 GB |
| 할당 RAM | ~71.5 GB |
| 여유 | ~56.5 GB |

**메모리는 오버커밋하지 않는다** — OOM Killer가 프로세스를 죽이면 데이터 손실 위험.

### 7.3 클러스터별 리소스 배분

| 클러스터 | 노드 수 | vCPU | RAM | 역할 |
|----------|---------|------|-----|------|
| platform | 3 | 7 | 24 GB | 모니터링, CI/CD |
| dev | 2 | 4 | 12 GB | 개발, 실험 |
| staging | 2 | 4 | 12 GB | 검증 |
| prod | 3 | 6 | 19.5 GB | 프로덕션 |
| **합계** | **10** | **21** | **~71.5 GB** | |

---

## 8. 보안 설계

### 8.1 네트워크 보안 계층

```
┌── Layer 1: VM 격리 ──────────────────────────────────┐
│  Tart softnet → 호스트만 VM에 접근 가능              │
│  외부 네트워크에서 VM 직접 접근 불가                   │
├── Layer 2: K8s API 인증 ─────────────────────────────┤
│  kubeconfig (x509 인증서) → 클러스터별 독립 CA        │
│  RBAC (Role-Based Access Control)                    │
├── Layer 3: CiliumNetworkPolicy ──────────────────────┤
│  Default Deny → Whitelist (명시적 허용만)             │
│  L7 HTTP 메서드 필터링 (GET만 허용 등)                │
├── Layer 4: Istio mTLS ───────────────────────────────┤
│  Pod 간 통신 전체 암호화 (STRICT 모드)                │
│  인증서 자동 회전 (Citadel)                           │
└──────────────────────────────────────────────────────┘
```

### 8.2 Zero Trust 원칙 적용

| 원칙 | 구현 |
|------|------|
| 기본 차단 | CiliumNetworkPolicy `default-deny-all` |
| 최소 권한 | nginx → httpbin은 GET만 허용 |
| 상호 인증 | Istio mTLS STRICT |
| 관측 가능 | Hubble로 모든 네트워크 흐름 관찰 |

---

## 9. 확장성 고려사항

### 9.1 수평 확장 (Scale-Out)

```
현재: 4 클러스터 / 10 VM / 21 vCPU / 71.5 GB RAM
최대: 5-6 클러스터 / 13-14 VM / ~28 vCPU / ~90 GB RAM
```

**새 클러스터 추가 절차:**
1. `config/clusters.json`에 클러스터 정의 추가
2. `terraform/variables.tf`에 동일 구조 추가
3. `./scripts/install.sh` 또는 `terraform apply` 실행

### 9.2 수직 확장 (Scale-Up)

- HPA가 CPU 50% 기준으로 Pod 자동 확장 (min 3 → max 10)
- PDB(PodDisruptionBudget)로 최소 가용 Pod 보장
- metrics-server가 실시간 CPU/메모리 메트릭 제공

---

## 10. 설계 결정 기록 (ADR)

### ADR-001: Tart 선택 (vs UTM, Lima)

**결정**: Apple Hypervisor.framework 기반 Tart를 VM 런타임으로 선택
**근거**:
- ARM64 네이티브 (에뮬레이션 없음, 최대 성능)
- CLI 우선 설계 → 스크립트 자동화에 적합
- macOS에 최적화된 네트워크 스택 (softnet)

### ADR-002: Cilium 선택 (vs Calico, Flannel)

**결정**: eBPF 기반 Cilium을 CNI로 선택
**근거**:
- kube-proxy 완전 대체 (kubeProxyReplacement: true) → 성능 향상
- L7 네트워크 정책 지원 (HTTP 메서드 필터링)
- Hubble로 네트워크 가시성 내장

### ADR-003: kubeadm 선택 (vs k3s, kind, minikube)

**결정**: kubeadm으로 프로덕션급 클러스터 구성
**근거**:
- 실제 프로덕션과 동일한 구성 요소 (etcd, kube-apiserver, scheduler)
- kube-proxy 스킵 가능 (Cilium과 조합)
- 학습 목적에 적합 (수동 구성으로 원리 이해)

### ADR-004: Istio 선택 (vs Linkerd)

**결정**: dev 클러스터에 Istio 배포
**근거**:
- 산업 표준 Service Mesh (가장 넓은 생태계)
- 카나리 배포, 서킷브레이커, mTLS 등 풍부한 트래픽 관리
- Cilium과 공존 가능 (Cilium=L3/L4, Istio=L7 사이드카)

### ADR-005: Bash + Terraform 이중 관리

**결정**: Bash 스크립트와 Terraform을 모두 유지
**근거**:
- Bash: 빠른 프로토타이핑, 디버깅, 학습용
- Terraform: 선언적 관리, 상태 추적, 재현성
- 두 접근법의 장단점을 직접 비교할 수 있는 학습 기회

---

## 부록: 핵심 용어 정리

| 용어 | 설명 |
|------|------|
| kubeadm | K8s 클러스터 부트스트랩 도구 |
| Cilium | eBPF 기반 컨테이너 네트워크 인터페이스 |
| Istio | Envoy 프록시 기반 서비스 메시 |
| HPA | Horizontal Pod Autoscaler |
| PDB | PodDisruptionBudget (최소 가용 Pod 보장) |
| mTLS | 상호 TLS (양방향 인증서 검증) |
| CIDR | Classless Inter-Domain Routing (IP 대역 표기) |
| eBPF | extended Berkeley Packet Filter (커널 레벨 프로그래밍) |
| Helm | K8s 패키지 매니저 |
| ArgoCD | GitOps 기반 지속적 배포 도구 |
