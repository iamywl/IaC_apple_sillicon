# 01. 프로젝트 전체 개요

## 한 줄 요약

> **Apple Silicon Mac 한 대에서 Tart VM으로 10개 가상머신을 만들고, 4개의 Kubernetes 클러스터를 구축하여 실제 기업 수준의 인프라 환경을 재현하는 프로젝트**

---

## 이 프로젝트가 해결하는 문제

실제 기업에서는 개발(dev), 스테이징(staging), 프로덕션(prod) 환경이 분리되어 있고, 이를 관리하는 플랫폼(platform) 클러스터가 별도로 존재합니다. 하지만 이런 환경을 직접 경험하려면 AWS나 GCP에 수백만 원을 쓰거나 회사에 입사해야 합니다.

이 프로젝트는 **맥북 한 대로 이 모든 것을 로컬에서 구현**합니다.

---

## 실행 환경

| 항목 | 사양 |
|------|------|
| 하드웨어 | MacBook Pro M4 Max (16 CPU / 128GB RAM) |
| 가상화 | Tart (Apple Hypervisor.framework 기반) |
| 게스트 OS | Ubuntu ARM64 (ghcr.io/cirruslabs/ubuntu:latest) |
| VM 수 | 10개 (master 4 + worker 6) |
| 총 vCPU | 21개 |
| 총 메모리 | ~68GB |

---

## 디렉토리 구조

```
tart-infra/
│
├── config/                    # 클러스터 설정 (Single Source of Truth)
│   └── clusters.json          # 모든 클러스터/노드 정의
│
├── scripts/                   # Bash 자동화 스크립트
│   ├── install/               # 설치 (17단계 파이프라인)
│   │   ├── install.sh         # 설치 오케스트레이터
│   │   ├── 01-create-vms.sh   # VM 생성
│   │   ├── 02-prepare-nodes.sh # 노드 준비 (swap off, 커널 모듈)
│   │   ├── ...
│   │   └── 12-install-istio.sh # Istio 서비스 메시
│   ├── boot/                  # 부팅 (3단계)
│   │   ├── 01-start-vms.sh
│   │   ├── 02-wait-clusters.sh
│   │   └── 03-verify-services.sh
│   ├── lib/                   # 공유 함수 라이브러리
│   │   ├── common.sh          # 설정 파싱, 로깅, kubectl 래퍼
│   │   ├── vm.sh              # Tart VM 수명주기 관리
│   │   ├── ssh.sh             # SSH/SCP 실행 헬퍼
│   │   └── k8s.sh             # K8s 설치/관리 함수
│   ├── boot.sh                # 일일 부팅 스크립트
│   ├── shutdown.sh            # 안전한 종료
│   ├── shutdown-all.sh        # 전체 종료 (대시보드 포함)
│   ├── status.sh              # 상태 확인
│   └── destroy.sh             # 완전 삭제
│
├── terraform/                 # Terraform IaC (Bash의 선언적 대안)
│   ├── main.tf                # 루트 모듈
│   ├── variables.tf           # 변수 정의
│   ├── outputs.tf             # 출력값
│   ├── providers.tf           # 프로바이더 설정
│   └── modules/
│       ├── tart-vm/           # VM 프로비저닝 모듈
│       ├── k8s-cluster/       # K8s 클러스터 초기화 모듈
│       └── helm-releases/     # Helm 차트 배포 모듈
│
├── manifests/                 # Kubernetes 매니페스트 & Helm values
│   ├── cilium-values.yaml     # Cilium CNI 설정
│   ├── hubble-values.yaml     # Hubble 옵저버빌리티 설정
│   ├── monitoring-values.yaml # Prometheus + Grafana 설정
│   ├── loki-values.yaml       # Loki 로그 수집 설정
│   ├── argocd-values.yaml     # ArgoCD GitOps 설정
│   ├── jenkins-values.yaml    # Jenkins CI 설정
│   ├── metrics-server-values.yaml # HPA 메트릭 소스
│   ├── demo/                  # 데모 애플리케이션
│   ├── network-policies/      # Zero Trust 네트워크 정책
│   ├── hpa/                   # HPA + PDB 매니페스트
│   ├── alerting/              # 알림 규칙 + webhook
│   └── istio/                 # Istio 서비스 메시 설정
│
├── dashboard/                 # SRE 운영 대시보드
│   ├── server/                # Express 백엔드 (데이터 수집)
│   ├── src/                   # React 프론트엔드 (6개 페이지)
│   └── shared/                # 프론트/백 공유 타입 정의
│
├── kubeconfig/                # 클러스터별 kubeconfig (gitignored)
└── doc/                       # 문서
    ├── analysis/              # 프로젝트 분석 문서 (이 문서들)
    ├── learning/              # 학습 문서 5개
    └── bug-reports/           # 버그 리포트 19개
```

---

## 핵심 설정 파일: clusters.json

모든 스크립트, Terraform, 대시보드가 이 파일 하나를 읽습니다. **Single Source of Truth** (단일 진실의 원천)입니다.

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
        { "name": "platform-master", "role": "master", "cpu": 2, "memory": 4096, "disk": 20 },
        { "name": "platform-worker1", "role": "worker", "cpu": 3, "memory": 12288, "disk": 20 },
        { "name": "platform-worker2", "role": "worker", "cpu": 2, "memory": 8192, "disk": 20 }
      ]
    }
    // ... dev, staging, prod
  ]
}
```

**구조 설명:**
- `base_image`: VM에 사용할 기본 Ubuntu 이미지
- `ssh_user` / `ssh_password`: 모든 VM에 접속할 SSH 자격증명
- `clusters[].name`: 클러스터 이름 (스크립트에서 이 이름으로 모든 것을 참조)
- `clusters[].pod_cidr`: Pod에 할당할 IP 대역 (클러스터마다 다르게 설정하여 충돌 방지)
- `clusters[].service_cidr`: Service에 할당할 IP 대역
- `clusters[].nodes[]`: 각 노드의 이름, 역할(master/worker), CPU, 메모리(MB), 디스크(GB)

**새 클러스터를 추가하고 싶으면?** → 이 파일에 항목만 추가하면 됩니다. 모든 스크립트가 `for cluster_name in $(get_cluster_names)` 루프를 돌기 때문에 자동으로 반영됩니다.

---

## 4개 클러스터의 역할

```
┌─────────────────────────────────────────────────────────┐
│                    Mac (호스트)                           │
│                                                         │
│  ┌─────────────┐  ┌──────┐  ┌─────────┐  ┌──────┐     │
│  │  platform    │  │ dev  │  │ staging │  │ prod │     │
│  │  (3 nodes)   │  │(2 n) │  │ (2 n)   │  │(3 n) │     │
│  │             │  │      │  │         │  │      │     │
│  │ Prometheus  │  │Istio │  │ HPA     │  │ HA   │     │
│  │ Grafana     │  │ HPA  │  │ Demo    │  │ Demo │     │
│  │ Loki        │  │ L7   │  │ Apps    │  │ Apps │     │
│  │ ArgoCD      │  │Policy│  │         │  │      │     │
│  │ Jenkins     │  │ Demo │  │         │  │      │     │
│  │ AlertManager│  │ Apps │  │         │  │      │     │
│  └─────────────┘  └──────┘  └─────────┘  └──────┘     │
│        ↑               ↑          ↑           ↑        │
│        └───────────────┴──────────┴───────────┘        │
│                    Cilium + Hubble (전 클러스터)          │
└─────────────────────────────────────────────────────────┘
```

| 클러스터 | 노드 수 | 역할 | 설치된 것 |
|----------|---------|------|-----------|
| **platform** | 3 (master+2worker) | 중앙 관리 허브 | Prometheus, Grafana, Loki, ArgoCD, Jenkins, AlertManager |
| **dev** | 2 (master+1worker) | 개발 환경 | Istio 서비스 메시, HPA, L7 네트워크 정책, 데모 앱 |
| **staging** | 2 (master+1worker) | 스테이징 환경 | HPA, 데모 앱 (프로덕션 전 검증용) |
| **prod** | 3 (master+2worker) | 프로덕션 환경 | 워커 2개로 고가용성(HA), 데모 앱 |

**왜 이렇게 나눴나:**
- **platform**은 모니터링/CI/CD 전용 → 서비스 앱과 분리하여 안정성 확보
- **dev**에만 Istio/L7 정책 → 개발 환경에서 실험적 기능을 먼저 적용
- **staging**은 prod와 유사한 설정 → 배포 전 검증
- **prod**는 워커 2개 → 하나가 죽어도 서비스 유지 (HA)

---

## 연관 프로젝트

이 프로젝트 외에 관련된 로컬 디렉토리들이 있습니다:

```
~/
├── tart-infra/        ← 이 프로젝트 (실제 인프라 구축)
├── cilium/            ← Cilium 공식 소스코드 클론 (참조용)
├── hubble/            ← Hubble 공식 소스코드 클론 (참조용)
└── CNCF/              ← CNCF 오픈소스 학습 워크스페이스
    ├── hubble_EDU/    ← Hubble 심층 학습
    ├── helm_EDU/      ← Helm 심층 학습
    └── ...
```

| 디렉토리 | 역할 | tart-infra와의 관계 |
|----------|------|---------------------|
| `~/cilium/` | cilium/cilium 공식 저장소 클론 (v1.20.0-dev) | Cilium 소스코드를 읽으며 내부 동작을 이해하기 위한 참조본. tart-infra에서는 Helm 차트로 배포 |
| `~/hubble/` | cilium/hubble 공식 저장소 클론 (v1.18.5) | Hubble CLI 소스코드 참조. tart-infra에서는 Cilium Helm 차트의 일부로 배포 |
| `~/CNCF/` | CNCF 프로젝트 학습용 워크스페이스 | 각 오픈소스 도구를 개별적으로 학습한 내용. tart-infra 구축의 지식적 기반 |

**관계 정리:**
- `CNCF/`에서 개별 도구를 학습 → `cilium/`, `hubble/`에서 소스코드 레벨로 이해 → `tart-infra/`에서 실제로 통합 구축
- tart-infra는 cilium/hubble 소스를 직접 사용하지 않음. 모두 공식 Helm 차트(`helm.cilium.io`)에서 설치

---

## 다음 문서

아키텍처를 왜 이렇게 설계했는지 알고 싶다면 → [02-architecture-decisions.md](02-architecture-decisions.md)
