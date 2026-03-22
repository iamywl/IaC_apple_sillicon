# 직무 매핑 포트폴리오 — 인프라/DevOps 엔지니어

> 이 문서는 **tart-infra 프로젝트**가 인프라/DevOps 엔지니어 직무의 각 요구사항을 어떻게 충족하는지 1:1로 매핑합니다.

---

## 1. 주요 직무 ↔ 프로젝트 매핑

### 1.1 네트워크 및 장비 운영

> **직무**: 본사, IDC, Cloud(AWS) 네트워크 및 장비 운영

| 프로젝트 구현 | 관련 파일 | 설명 |
|-------------|----------|------|
| Tart VM 10대 네트워크 구성 | `config/clusters.json` | Apple Hypervisor 기반 10대 VM을 4개 클러스터로 구성, DHCP IP 자동 감지 + SSH 커넥션 풀 관리 |
| Cilium eBPF CNI | `manifests/cilium-values.yaml` | kube-proxy 완전 대체, 커널 레벨 L3/L4/L7 네트워킹. IDC 물리 네트워크의 가상화 버전 |
| 클러스터별 독립 CIDR 설계 | `config/clusters.json` | Pod CIDR 10.10~40.0.0/16, Service CIDR 10.96~99.0.0/16 — 실제 IDC 서브넷 분리와 동일한 설계 |
| Hubble 네트워크 관측 | `manifests/hubble-values.yaml` | L3/L4/L7 트래픽 플로우 실시간 수집 — 네트워크 장비 모니터링과 동일한 가시성 |
| SRE 대시보드 Traffic 페이지 | `dashboard/src/pages/TrafficPage.tsx` | SVG 토폴로지 맵으로 서비스 간 트래픽 흐름 시각화, FORWARDED/DROPPED 판정 |

### 1.2 망분리 환경 운영 및 개선

> **직무**: 망분리환경을 운영 및 환경 개선

| 프로젝트 구현 | 관련 파일 | 설명 |
|-------------|----------|------|
| 4개 클러스터 분리 운영 | `config/clusters.json` | platform(관제)/dev(개발)/staging(검증)/prod(운영) — 실제 기업의 망분리 전략 재현 |
| CiliumNetworkPolicy Zero-Trust | `manifests/network-policies/default-deny.yaml` | 기본 차단(Default Deny) + 화이트리스트 방식 — 망분리 환경의 방화벽 정책과 동일 |
| L7 HTTP 필터링 | `manifests/network-policies/allow-nginx-to-httpbin.yaml` | HTTP GET만 허용, POST/DELETE 차단 — 애플리케이션 레벨 접근 제어 |
| 서비스별 접근 제어 10개 정책 | `manifests/network-policies/` | nginx↔httpbin↔redis↔postgres↔rabbitmq↔keycloak 간 최소 권한 원칙(Least Privilege) 적용 |
| Istio mTLS | `manifests/istio/peer-authentication.yaml` | 모든 Pod 간 통신 TLS 암호화 — 망 내부에서도 암호화 통신 보장 |

### 1.3 On-premises, Cloud Infra 관리

> **직무**: On-premises, Cloud Infra 전반적 관리, 설치 및 운영

| 프로젝트 구현 | 관련 파일 | 설명 |
|-------------|----------|------|
| VM 10대 자동 프로비저닝 | `scripts/install/01-create-vms.sh` | Tart VM을 코드로 생성 — 온프레미스 서버 프로비저닝 자동화와 동일 |
| 12단계 설치 자동화 | `scripts/install.sh` | VM 생성 → OS 설정 → 런타임 → K8s → CNI → 모니터링 → CI/CD → 보안 → 서비스 메시 |
| 골든 이미지 빌드 | `scripts/build-golden-image.sh` | 사전 설치된 VM 템플릿 — 클라우드 AMI/이미지 빌드와 동일한 패턴 |
| 일상 운영 스크립트 | `scripts/boot.sh`, `scripts/shutdown.sh`, `scripts/status.sh` | 부팅/종료/상태 확인 자동화 — Day 2 운영 |
| 안전한 종료 절차 | `scripts/shutdown.sh` | 워커 노드 드레인(Drain) → 안전 종료 — 데이터 무결성 보장 |

### 1.4 계정 및 권한 관리 (AD기반, IAM, SSO)

> **직무**: 계정 및 권한을 관리 (AD기반, IAM, SSO)

| 프로젝트 구현 | 관련 파일 | 설명 |
|-------------|----------|------|
| **Keycloak IAM/SSO 서버** | `manifests/demo/keycloak-app.yaml` | OAuth 2.0 / OpenID Connect / SSO 인증 서버. 실제 엔터프라이즈 IAM 아키텍처 재현 |
| Keycloak → PostgreSQL 백엔드 | `manifests/demo/keycloak-app.yaml` | 인증 데이터를 PostgreSQL에 저장 — AD/LDAP 백엔드와 동일한 패턴 |
| K8s RBAC | `kubeadm init` → 자동 생성 | 4개 클러스터 각각 독립된 kubeconfig 기반 접근 제어 |
| 서비스별 네트워크 인증 | `manifests/network-policies/allow-httpbin-to-keycloak.yaml` | 앱→인증서버 통신을 네트워크 정책으로 제어 |
| ArgoCD/Jenkins 접근 관리 | `manifests/argocd-values.yaml`, `manifests/jenkins-values.yaml` | 각 서비스별 독립된 인증 체계 (initial-admin-secret, admin/admin) |

### 1.5 대규모 클러스터 시스템 구축/운영

> **직무**: IDC 내 CPU/GPU 서버, 고대역 네트워크, 분산스토리지 등 대규모 클러스터 시스템의 구축, 운영

| 프로젝트 구현 | 관련 파일 | 설명 |
|-------------|----------|------|
| 4개 K8s 클러스터 (10 노드) | `config/clusters.json` | 21 vCPU / 71.5 GB RAM 분배, CPU 오버커밋 전략 적용 |
| 멀티클러스터 관리 | `kubeconfig/` | 4개 클러스터 독립 kubeconfig, 통합 KUBECONFIG 설정 |
| HPA 오토스케일링 (6개 대상) | `manifests/hpa/` | nginx(3→10), httpbin(2→6), redis(1→4), postgres(1→4), rabbitmq(1→3) — CPU 기반 자동 확장 |
| PDB 가용성 보장 (6개 대상) | `manifests/hpa/pdb-*.yaml` | 스케일다운/드레인 시 최소 Pod 수 보장 |
| 리소스 모니터링 대시보드 | `dashboard/src/pages/ScalingPage.tsx` | HPA 레플리카 시계열, CPU 사용률 추이 실시간 모니터링 |
| local-path-provisioner 스토리지 | `scripts/install/08-install-cicd.sh` | 동적 PersistentVolume 프로비저닝 — 분산 스토리지 관리 |

### 1.6 시스템 소프트웨어 설치/관리

> **직무**: GPU 드라이버, 통신 라이브러리, 디렉터리 서비스, 분산 파일 시스템 등 다양한 시스템 소프트웨어 설치, 관리

| 프로젝트 구현 | 관련 파일 | 설명 |
|-------------|----------|------|
| containerd 런타임 설치 | `scripts/install/03-install-runtime.sh` | SystemdCgroup 모드 설정, 10대 노드 일괄 설치 |
| 커널 모듈/sysctl 설정 | `scripts/install/02-prepare-nodes.sh` | `overlay`, `br_netfilter` 모듈 로드, IP 포워딩 설정 — 시스템 레벨 튜닝 |
| APT 패키지 관리 | `scripts/lib/k8s.sh` | kubeadm/kubelet/kubectl + 의존성 일괄 설치 및 버전 고정 |
| Helm 차트 기반 소프트웨어 배포 | `manifests/*.yaml` | 10개+ Helm 차트를 values.yaml 기반으로 선언적 설치 |
| Cilium eBPF 네트워크 스택 | `manifests/cilium-values.yaml` | 커널 레벨 eBPF 프로그램으로 네트워킹 처리 — 고성능 통신 라이브러리와 유사 |

### 1.7 Kubernetes 컨테이너 오케스트레이션

> **직무**: Kubernetes 등 컨테이너 오케스트레이션 도구 설치, 관리

| 프로젝트 구현 | 관련 파일 | 설명 |
|-------------|----------|------|
| **kubeadm 기반 4개 클러스터 구축** | `scripts/install/05-init-clusters.sh` | master init → worker join → kubeconfig 수집 전체 자동화 |
| Cilium CNI 설치 | `scripts/install/06-install-cilium.sh` | eBPF 기반 CNI, kube-proxy 대체, Hubble 관측성 |
| Istio 서비스 메시 | `scripts/install/12-install-istio.sh` | mTLS, 카나리 배포(80/20), 서킷 브레이커 |
| metrics-server + HPA | `scripts/install/11-install-hpa.sh` | 리소스 메트릭 수집 → CPU 기반 오토스케일링 |
| 6개 데모 앱 배포 | `manifests/demo/` | nginx, httpbin, redis, postgres, rabbitmq, keycloak — 3-Tier + Auth + MQ 아키텍처 |

### 1.8 IaC 자동화 및 코드화

> **직무**: Terraform, Ansible 등 IaC 툴을 사용하여 자동화 및 코드화 수행

| 프로젝트 구현 | 관련 파일 | 설명 |
|-------------|----------|------|
| **Terraform IaC** | `terraform/` | VM 생성 → K8s 초기화 → Helm 배포 모듈 체인. `terraform plan/apply`로 인프라 프로비저닝 |
| Terraform 모듈 설계 | `terraform/modules/` | tart-vm / k8s-cluster / helm-releases 3개 모듈 분리 |
| Bash 명령형 자동화 | `scripts/` | 12단계 파이프라인, 공유 라이브러리(common/vm/ssh/k8s), 멱등성 보장 |
| Helm 선언적 배포 | `manifests/*-values.yaml` | values 파일 기반 재현 가능한 배포. 10개+ Helm 차트 관리 |
| clusters.json 단일 진실 공급원 | `config/clusters.json` | 모든 스크립트가 하나의 설정 파일을 참조 — Single Source of Truth |

### 1.9 CI/CD 파이프라인 구축/관리

> **직무**: 배포를 위한 CI/CD 파이프라인 구축, 관리

| 프로젝트 구현 | 관련 파일 | 설명 |
|-------------|----------|------|
| **Jenkins 7단계 CI 파이프라인** | `manifests/jenkins/demo-pipeline.yaml` | Validate → Security Scan → Deploy → Rollout → Health Check → Integration Test → Smoke Test |
| **ArgoCD GitOps CD** | `manifests/argocd/demo-app.yaml` | Git 저장소 감시 → 자동 동기화(Auto Sync) + 자동 복구(Self-Heal) + 자동 정리(Prune) |
| Jenkins Kubernetes 플러그인 | `manifests/jenkins-values.yaml` | Pod 기반 동적 빌드 에이전트 — 리소스 효율적 CI |
| 보안 검사 단계 | Jenkins Stage 2 | 하드코딩 시크릿 탐지, 리소스 제한 확인, :latest 태그 경고 |
| E2E 통합 테스트 | Jenkins Stage 6-7 | 6개 서비스 개별 연결 검증 + L7 정책 검증 + 전체 요청 체인 확인 |

### 1.10 모니터링 및 장애 분석

> **직무**: 클러스터 자원 및 시스템 성능 모니터링 구축, 시스템 장애 발생 시 원인 분석 및 해결

| 프로젝트 구현 | 관련 파일 | 설명 |
|-------------|----------|------|
| **Prometheus + Grafana** | `manifests/monitoring-values.yaml` | 30초 간격 메트릭 수집, 7일 보관, 3개 기본 대시보드 |
| **AlertManager 8개 알림 규칙** | `manifests/alerting/prometheus-rules.yaml` | HighCPU, HighMemory, NodeNotReady, DiskPressure, CrashLoop, OOMKilled, HighRestart, PodNotReady |
| **Loki 로그 수집** | `manifests/loki-values.yaml` | Promtail → Loki → Grafana LogQL 검색 |
| **SRE 대시보드 6개 페이지** | `dashboard/src/pages/` | Overview, ClusterDetail, Testing, Traffic, Scaling, LoadAnalysis |
| k6 부하 테스트 (16개 시나리오) | `dashboard/src/pages/TestingPage.tsx` | HTTP/Scaling/Cascade/CPU/Memory 테스트 → p95/p99/RPS/에러율 측정 |
| Hubble 네트워크 트러블슈팅 | `manifests/hubble-values.yaml` | DROPPED 패킷 추적 → 네트워크 정책 디버깅 |
| stress-ng 장애 시뮬레이션 | `manifests/demo/stress-test.yaml` | CPU/메모리 부하 주입 → HPA 반응 관측 → 장애 복구 과정 확인 |

---

## 2. 우대사항 ↔ 프로젝트 매핑

### 2.1 GPU/HPC 클러스터 운영 경험

| 프로젝트 연관성 | 설명 |
|---------------|------|
| 멀티노드 클러스터 구축 | 10 노드 / 4 클러스터를 코드로 관리 — HPC 클러스터와 동일한 노드 관리 패턴 |
| 리소스 할당 전략 | CPU 오버커밋(21 vCPU / 16 물리 코어), 메모리 분배 최적화 |
| HPA 기반 워크로드 스케일링 | CPU 부하에 따른 자동 확장 — GPU 워크로드 스케일링과 동일한 원리 |
| 성능 모니터링 | Prometheus 메트릭, SRE 대시보드로 노드별 CPU/Memory/Disk 실시간 관측 |

### 2.2 고가용성 및 DR 아키텍처 설계 경험

| 프로젝트 구현 | 설명 |
|-------------|------|
| PDB (Pod Disruption Budget) | 6개 서비스에 minAvailable 설정 — 스케일다운/유지보수 시 가용성 보장 |
| HPA 오토스케일링 | 부하 증가 시 자동 확장, 안정화 윈도우로 급격한 축소 방지 |
| 멀티클러스터 분리 | platform(관제)이 dev/staging/prod와 분리 — 관제 시스템 독립성 보장 |
| 안전한 종료 절차 | `shutdown.sh` — 워커 노드 drain → graceful stop |
| 서킷 브레이커 | Istio DestinationRule — 연속 5xx 3회 시 인스턴스 30초 격리 |

### 2.3 대규모 분산 시스템 성능 튜닝 경험

| 프로젝트 구현 | 설명 |
|-------------|------|
| k6 부하 테스트 | 10~200 VU, 15s~120s 다양한 시나리오로 성능 측정 |
| Cascade 테스트 | 3-Tier 전체에 동시 부하 → 연쇄 스케일링 관측 |
| HPA behavior 튜닝 | scaleUp: 15초/2개씩, scaleDown: 60초/1개씩 — 안정화 윈도우 최적화 |
| p95/p99 지연시간 분석 | k6 결과 파싱 → 성능 병목 식별 |
| LoadAnalysis 페이지 | 스케일업 지연, 피크 레플리카, Pod당 RPS 효율 분석 |

### 2.4 DevSecOps 및 보안 인증 대응 경험

| 프로젝트 구현 | 설명 |
|-------------|------|
| Zero-Trust 네트워크 | CiliumNetworkPolicy default-deny + 화이트리스트 10개 정책 |
| L7 HTTP 필터링 | GET만 허용, POST/DELETE 차단 — 애플리케이션 레벨 보안 |
| mTLS 암호화 | Istio PeerAuthentication STRICT — 내부 통신 전체 암호화 |
| Jenkins Security Scan 단계 | 시크릿 탐지, 리소스 제한 확인, 이미지 태그 검증 |
| Keycloak IAM | OAuth 2.0 / SSO / OIDC 인증 서버 — 보안 인증 인프라 |
| RBAC | K8s 클러스터별 독립 kubeconfig 기반 접근 제어 |

### 2.5 인프라 자동화 고도화 및 GitOps 경험

| 프로젝트 구현 | 설명 |
|-------------|------|
| **ArgoCD GitOps** | Git = Single Source of Truth, 자동 동기화 + 자가 복구 + 자동 정리 |
| **Terraform IaC** | 3개 모듈 체인 (tart-vm → k8s-cluster → helm-releases) |
| **Bash 12단계 자동화** | `install.sh` 한 줄로 전체 인프라 구축 |
| **Helm 선언적 배포** | 10개+ values.yaml 기반 재현 가능한 배포 |
| **골든 이미지 패턴** | `build-golden-image.sh` — AMI/이미지 빌드 자동화 |
| **Jenkins 7단계 파이프라인** | Validate → Security → Deploy → Verify — 완전 자동화된 배포 |

---

## 3. 기술 스택 한눈에 보기

```
┌─────────────────────────────────────────────────────────────────────┐
│                    tart-infra 프로젝트 기술 맵                       │
│                                                                     │
│  [인프라]        [오케스트레이션]     [네트워킹]       [보안]          │
│  Tart VM         Kubernetes 1.31    Cilium eBPF     Zero-Trust     │
│  Ubuntu ARM64    kubeadm            Hubble          mTLS (Istio)   │
│  containerd      HPA + PDB          Istio Envoy     L7 필터링      │
│  골든 이미지      metrics-server     CIDR 분리       Keycloak IAM   │
│                                                                     │
│  [자동화/IaC]    [CI/CD]            [모니터링]       [데모 앱]       │
│  Terraform       Jenkins (7단계)    Prometheus       nginx          │
│  Bash Scripts    ArgoCD (GitOps)    Grafana          httpbin        │
│  Helm Charts     Pod 기반 Agent     Loki + Promtail  PostgreSQL     │
│  clusters.json   Security Scan      AlertManager     Redis          │
│                  E2E Test           SRE Dashboard     RabbitMQ       │
│                                     k6 + stress-ng   Keycloak       │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 4. 프로젝트 핵심 수치

| 항목 | 수치 |
|------|------|
| Kubernetes 클러스터 | 4개 (platform / dev / staging / prod) |
| VM 노드 | 10대 (21 vCPU / 71.5 GB RAM) |
| 오픈소스 프로젝트 | 30개+ |
| CNCF 프로젝트 | 8개 (Graduated) |
| 설치 자동화 단계 | 12단계 |
| CI/CD 파이프라인 단계 | 7단계 |
| 데모 애플리케이션 | 6개 서비스 (3-Tier + Auth + MQ) |
| HPA 오토스케일링 대상 | 5개 Deployment |
| PDB 가용성 보호 | 6개 서비스 |
| 네트워크 정책 | 10개 CiliumNetworkPolicy (Zero-Trust) |
| 알림 규칙 | 8개 PrometheusRule |
| SRE 대시보드 페이지 | 6개 |
| API 엔드포인트 | 11개 |
| 부하 테스트 시나리오 | 16개 프리셋 |
| Bash 자동화 스크립트 | 15개+ |
| Helm values 파일 | 10개+ |
| Terraform 모듈 | 3개 |

---

## 5. 아키텍처 다이어그램

```
┌──── macOS Apple Silicon ──────────────────────────────────────────────────────┐
│                                                                               │
│  ┌─ Tart VM Layer (10 VMs) ────────────────────────────────────────────────┐  │
│  │                                                                          │  │
│  │  platform (3 nodes)     dev (2 nodes)     staging (2)    prod (3)       │  │
│  │  ├─ Prometheus          ├─ nginx           ├─ Cilium      ├─ Cilium     │  │
│  │  ├─ Grafana             ├─ httpbin v1/v2   └─ metrics     ├─ HA         │  │
│  │  ├─ Loki               ├─ redis                           └─ workers   │  │
│  │  ├─ AlertManager        ├─ postgres                                     │  │
│  │  ├─ Jenkins             ├─ rabbitmq                                     │  │
│  │  └─ ArgoCD              ├─ keycloak                                     │  │
│  │                          ├─ Istio mTLS                                   │  │
│  │                          ├─ CiliumNetworkPolicy (10)                     │  │
│  │                          └─ HPA (5) + PDB (6)                            │  │
│  └──────────────────────────────────────────────────────────────────────────┘  │
│                                                                               │
│  ┌─ Automation Layer ──────────────────────────────────────────────────────┐  │
│  │  Bash 12-Phase │ Terraform 3-Module │ Helm 10+ Charts │ GitOps (ArgoCD) │  │
│  └──────────────────────────────────────────────────────────────────────────┘  │
│                                                                               │
│  ┌─ SRE Dashboard ─────────────────────────────────────────────────────────┐  │
│  │  React 19 + Express 5 │ 6 Pages │ 11 APIs │ 16 Test Scenarios │ CSV    │  │
│  └──────────────────────────────────────────────────────────────────────────┘  │
│                                                                               │
│  ┌─ CI/CD Pipeline ────────────────────────────────────────────────────────┐  │
│  │  Jenkins: Validate → Security → Deploy → Rollout → Health → E2E → Smoke │  │
│  │  ArgoCD:  Git Watch → Auto Sync → Self-Heal → Prune                     │  │
│  └──────────────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────────────────┘
```

---

## 6. 직무별 관련 코드 빠른 참조

| 직무 키워드 | 핵심 파일/디렉토리 |
|-----------|------------------|
| 네트워크 | `manifests/cilium-values.yaml`, `manifests/hubble-values.yaml`, `manifests/network-policies/` |
| 망분리 | `manifests/network-policies/default-deny.yaml`, `config/clusters.json` (CIDR 설계) |
| 클라우드/온프레미스 | `scripts/install/`, `terraform/`, `config/clusters.json` |
| IAM/SSO | `manifests/demo/keycloak-app.yaml`, `manifests/network-policies/allow-*-keycloak.yaml` |
| 클러스터 구축 | `scripts/install/05-init-clusters.sh`, `scripts/lib/k8s.sh` |
| 시스템 소프트웨어 | `scripts/install/02~04-*.sh`, `manifests/cilium-values.yaml` |
| Kubernetes | `scripts/install/05-init-clusters.sh`, `manifests/hpa/`, `manifests/demo/` |
| IaC/Terraform | `terraform/`, `scripts/`, `manifests/*-values.yaml` |
| CI/CD | `manifests/jenkins/demo-pipeline.yaml`, `manifests/argocd/demo-app.yaml` |
| 모니터링 | `manifests/monitoring-values.yaml`, `manifests/alerting/`, `dashboard/` |
| 고가용성/DR | `manifests/hpa/pdb-*.yaml`, Istio 서킷브레이커, 멀티클러스터 |
| 성능 튜닝 | `dashboard/src/pages/TestingPage.tsx`, `manifests/hpa/*-hpa.yaml` |
| DevSecOps | `manifests/network-policies/`, `manifests/istio/peer-authentication.yaml`, Jenkins Security Scan |
| GitOps | `manifests/argocd/demo-app.yaml`, `manifests/jenkins/demo-pipeline.yaml` |
