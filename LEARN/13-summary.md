# 13. 전체 정리 — Day 0/1/2 운영과 커리어 패스

> Apple Silicon 맥에서 구축하는 멀티 클러스터 Kubernetes 인프라

---

## 목차

1. [이번 문서에서 배울 것](#이번-문서에서-배울-것)
2. [전체 아키텍처 한눈에 보기](#전체-아키텍처-한눈에-보기)
3. [17단계 파이프라인 복습 — 모든 것은 연결되어 있다](#17단계-파이프라인-복습--모든-것은-연결되어-있다)
4. [Day 0 / Day 1 / Day 2 운영](#day-0--day-1--day-2-운영)
   - [Day 0: 계획 — "무엇을 만들 것인가"](#day-0-계획--무엇을-만들-것인가)
   - [Day 1: 배포 — "실제로 만들기"](#day-1-배포--실제로-만들기)
   - [Day 2: 운영 — "매일매일 관리하기"](#day-2-운영--매일매일-관리하기)
   - [실제 프로젝트에서는](#실제-프로젝트에서는)
5. [일상적인 워크플로우](#일상적인-워크플로우)
   - [아침: 시작](#아침-시작)
   - [낮: 작업](#낮-작업)
   - [저녁: 종료](#저녁-종료)
6. [이 시리즈에서 배운 기술 총정리](#이-시리즈에서-배운-기술-총정리)
7. [실제 기업 인프라와의 비교](#실제-기업-인프라와의-비교)
8. [커리어 패스 — 이 지식을 어디에 쓸 수 있나](#커리어-패스--이-지식을-어디에-쓸-수-있나)
9. [다음 단계 — 여기서 더 나아가려면](#다음-단계--여기서-더-나아가려면)
10. [명령어 치트 시트](#명령어-치트-시트)
11. [프로젝트 구조 최종 요약](#프로젝트-구조-최종-요약)
12. [마치며](#마치며)

---

## 이번 문서에서 배울 것

14편에 걸쳐 Apple Silicon Mac 한 대에서 **프로덕션급 멀티클러스터 Kubernetes 인프라**를 만들었다. 이번 마지막 편에서는 모든 것을 한데 모아 정리한다.

- 전체 아키텍처를 한 장의 그림으로 복습
- 17단계가 어떻게 연결되는지
- Day 0 / Day 1 / Day 2 운영
- 일상적인 워크플로우
- 이 시리즈에서 배운 기술들
- 실무와의 연결 — 커리어 패스

---

## 전체 아키텍처 한눈에 보기

```
┌──────────────────────────────────────────────────────────────────────────┐
│  MacBook Pro Apple Silicon (M4 Max / 16 CPU / 128GB RAM)               │
│                                                                        │
│  ┌──── Tart VM Layer ────────────────────────────────────────────────┐  │
│  │                                                                    │  │
│  │  ┌── platform (관제) ──────┐  ┌──── dev (개발) ─────────────┐    │  │
│  │  │ master  (2C/4G)         │  │ master  (2C/4G)              │    │  │
│  │  │ worker1 (3C/12G)        │  │ worker1 (2C/8G)              │    │  │
│  │  │   └ Prometheus+Grafana  │  │   └ nginx+httpbin+redis      │    │  │
│  │  │     +Loki+AlertManager  │  │     +postgres+rabbitmq       │    │  │
│  │  │ worker2 (2C/8G)         │  │     +keycloak+Istio          │    │  │
│  │  │   └ Jenkins+ArgoCD      │  └──────────────────────────────┘    │  │
│  │  └─────────────────────────┘                                      │  │
│  │  ┌── staging (검증) ──────┐  ┌──── prod (운영) ─────────────┐    │  │
│  │  │ master  (2C/4G)        │  │ master  (2C/3G)               │    │  │
│  │  │ worker1 (2C/8G)        │  │ worker1 (2C/8G)               │    │  │
│  │  └────────────────────────┘  │ worker2 (2C/8G)               │    │  │
│  │                               └──────────────────────────────┘    │  │
│  │                                                                    │  │
│  │  합계: 10 VM / 21 vCPU / 66 GB RAM                               │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                        │
│  ┌── Kubernetes Layer ────────────────────────────────────────────────┐  │
│  │ kubeadm v1.31 / Cilium eBPF CNI / Hubble / metrics-server / HPA  │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                        │
│  ┌── Application Layer ──────────────────────────────────────────────┐  │
│  │ SRE Dashboard (React+Express) / k6 / stress-ng / Istio Service   │  │
│  │ Mesh / CiliumNetworkPolicy L7 / ArgoCD GitOps / Jenkins CI       │  │
│  └────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘
```

이 그림 하나에 전체 인프라가 담겨 있다. 아래에서 위로:

1. **Mac 하드웨어** — 물리적 기반
2. **Tart VM** — 가상 머신 10대
3. **Kubernetes** — 컨테이너 오케스트레이션 4개 클러스터
4. **Application** — 모니터링, 테스트, 보안, CI/CD

---

## 17단계 파이프라인 복습 — 모든 것은 연결되어 있다

각 단계는 이전 단계의 결과물 위에 구축된다. 이 순서는 임의로 정한 것이 아니라 **의존성 그래프**에 의해 결정된다. VM이 없으면 OS를 설정할 수 없고, 컨테이너 런타임이 없으면 K8s가 Pod를 실행할 수 없고, CNI가 없으면 Pod 간 네트워크가 형성되지 않는다. 이 의존성 체인이 Day 0(인프라) → Day 1(플랫폼) → Day 2(앱/운영)의 순서를 강제한다. 각 Phase가 무엇을 담당하는지 정리하면 다음과 같다.

| 단계 | 수행 내용 | 구축 대상 |
|------|----------|----------|
| Phase 1 | VM 프로비저닝 | VM 10대 생성 |
| Phase 2 | OS 레벨 설정 | 노드 준비 (swap off, 커널 설정) |
| Phase 3 | 컨테이너 런타임 설치 | containerd 설치 |
| Phase 4 | K8s 바이너리 설치 | kubeadm/kubelet/kubectl 설치 |
| Phase 5 | 클러스터 초기화 | K8s 클러스터 초기화 |
| Phase 6 | CNI 설치 | Cilium CNI + Hubble |
| Phase 7 | 관측성 구축 | Prometheus + Grafana + Loki |
| Phase 8 | CI/CD 구축 | Jenkins + ArgoCD |
| Phase 9 | 알림 설정 | AlertManager + 알림 규칙 |
| Phase 10 | 네트워크 보안 | CiliumNetworkPolicy 제로 트러스트 |
| Phase 11 | 오토스케일링 | metrics-server + HPA |
| Phase 12 | 서비스 메시 | Istio mTLS + 카나리 + 서킷브레이커 |

### 연결 관계

```
Phase 1 (VM)
    └─→ Phase 2-4 (노드 준비)
           └─→ Phase 5 (클러스터 초기화)
                  └─→ Phase 6 (CNI) ← 모든 네트워크의 기반
                         ├─→ Phase 7 (모니터링)
                         ├─→ Phase 8 (CI/CD)
                         ├─→ Phase 9 (알림) ← Phase 7의 Prometheus 필요
                         ├─→ Phase 10 (네트워크 정책) ← Phase 6의 Cilium 필요
                         ├─→ Phase 11 (HPA) ← Phase 7의 metrics 필요
                         └─→ Phase 12 (서비스 메시)
```

순서가 중요하다. VM 없이 K8s를 설치할 수 없고, Cilium 없이 네트워크 정책을 적용할 수 없다. `install.sh`가 이 순서를 자동으로 보장한다.

---

## Day 0 / Day 1 / Day 2 운영

인프라 운영은 크게 세 단계로 나뉜다.

### Day 0: 계획 — "무엇을 만들 것인가"

Day 0은 **인프라 설계 단계**이다. 이 프로젝트에서는 `config/clusters.json`이 전체 인프라의 단일 진실 소스(Single Source of Truth) 역할을 한다.

왜 Single Source of Truth가 중요한가? 인프라 정의가 여러 곳에 분산되면 **구성 드리프트(configuration drift)**가 발생한다. 스크립트 A에서는 VM 메모리를 8GB로 알고 있는데 스크립트 B에서는 4GB로 설정하는 식이다. 이런 불일치는 재현 불가능한 장애의 원인이 된다. 모든 자동화 스크립트가 `clusters.json` 하나에서 값을 읽도록 강제하면, 설정 변경이 한 곳에서만 이루어지므로 드리프트가 구조적으로 방지된다. 또한 이 파일 하나만 있으면 전체 인프라를 처음부터 동일하게 재현할 수 있다.

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
    // ... dev, staging, prod 클러스터
  ]
}
```

**핵심 결정 사항들:**
- 클러스터 4개 (platform, dev, staging, prod) — 역할 분리
- Pod/Service CIDR — 클러스터 간 IP 충돌 방지
- 각 노드의 CPU/메모리 — 물리적 한계(16 CPU / 128GB) 내 분배
- 기본 이미지, SSH 인증 정보

이 설정 파일 하나에 전체 인프라의 구조, 리소스 할당, 네트워크 대역이 모두 정의된다. 모든 자동화 스크립트는 이 파일을 읽어서 동작한다.

### Day 1: 배포 — "실제로 만들기"

Day 1은 **설계를 실제 인프라로 프로비저닝하는 단계**이다. 두 가지 방법이 있다.

```bash
# 방법 1: 원스톱 — 설치 + 대시보드까지 한 번에
./scripts/demo.sh

# 방법 2: 인프라만 설치
./scripts/install.sh
```

`demo.sh`의 실행 흐름:

```
demo.sh
  ├─ Phase 1: install.sh 또는 boot.sh 실행
  │     ├─ VM 10대 생성/부팅
  │     ├─ Phase 2-4: 노드 준비 (골든 이미지 시 스킵)
  │     ├─ Phase 5: 4개 클러스터 초기화
  │     ├─ Phase 6-12: Cilium ~ Istio 설치
  │     └─ 상태 확인
  ├─ Phase 2: status.sh로 전체 검증
  └─ Phase 3: SRE 대시보드 기동 + 브라우저 오픈
```

### Day 2: 운영 — "매일매일 관리하기"

Day 2는 **프로비저닝된 인프라를 지속적으로 운영하는 단계**이다.

| 활동 | 도구 | 빈도 |
|------|------|------|
| 인프라 모니터링 | SRE 대시보드, Grafana | 상시 |
| 부하 테스트 | k6, stress-ng (대시보드에서) | 필요 시 |
| 스케일링 관찰 | 대시보드 Scaling 페이지 | 부하 테스트 시 |
| 트래픽 분석 | 대시보드 Traffic 페이지, Hubble | 필요 시 |
| 알림 확인 | AlertManager | 알림 발생 시 |
| 트러블슈팅 | kubectl, hubble, SSH | 문제 발생 시 |

### 실제 프로젝트에서는

실제 기업에서도 동일한 Day 0/1/2 구분을 사용한다.

- **Day 0**: 아키텍처 리뷰 회의, CIDR 설계, 보안 정책 수립, 예산 산정
- **Day 1**: Terraform으로 클라우드 인프라 프로비저닝, CI/CD 파이프라인 구성
- **Day 2**: 모니터링 대시보드 확인, 알림 대응, 용량 계획, 보안 패치

---

## 일상적인 워크플로우

매일 이 프로젝트를 사용하는 흐름은 다음과 같다.

### 아침: 시작

```bash
# Mac을 켜고 터미널에서:
cd ~/sideproject/tart-infra

# VM 부팅 + 대시보드 한 번에 시작
./scripts/demo.sh --skip-install
```

이 명령 하나로:
1. 10개 VM이 시작된다
2. 각 VM의 IP가 할당될 때까지 대기한다
3. 4개 클러스터의 노드가 Ready인지 확인한다
4. Platform 서비스(Prometheus, Jenkins 등)가 정상인지 검증한다
5. SRE 대시보드가 시작되고 브라우저가 열린다

### 낮: 작업

```bash
# SRE 대시보드 (http://localhost:5173)
# → Overview: 4개 클러스터 전체 상태 확인
# → Testing: 부하 테스트 실행
# → Scaling: HPA 오토스케일링 관찰
# → Traffic: 네트워크 플로우 분석
# → Analysis: 부하 테스트 결과 종합 분석

# kubectl로 직접 확인
kubectl --kubeconfig kubeconfig/dev.yaml get pods -n demo
kubectl --kubeconfig kubeconfig/platform.yaml get pods -n monitoring

# Grafana 대시보드
open http://$(tart ip platform-worker1):30300
```

### 저녁: 종료

```bash
# 대시보드가 포그라운드에서 실행 중이면: Ctrl+C

# VM 안전 종료
./scripts/shutdown.sh
```

`shutdown.sh`는 단순히 VM을 끄는 것이 아니라:
1. 각 클러스터의 워커 노드를 **드레인(drain)** — 실행 중인 Pod를 안전하게 이동
2. 모든 VM을 **정상 종료(graceful stop)** — 데이터 손실 없음

---

## 이 시리즈에서 배운 기술 총정리

### 1편~4편: 인프라 기초

| 편 | 주제 | 핵심 기술 |
|----|------|----------|
| 1 | 가상화란? | Tart, Apple Hypervisor, VM vs 컨테이너 |
| 2 | VM 만들기 | tart clone, tart set, tart run, SSH 접속 |
| 3 | 노드 준비 | swap off, kernel modules, sysctl, containerd |
| 4 | K8s 설치 | kubeadm init, kubeadm join, kubectl |

**배운 개념**: 하이퍼바이저, VM, 컨테이너 런타임, 쿠버네티스 컨트롤 플레인

### 5편~6편: 네트워크

| 편 | 주제 | 핵심 기술 |
|----|------|----------|
| 5 | CNI와 Cilium | eBPF, kube-proxy 대체, Pod 네트워크 |
| 6 | Hubble | 네트워크 관측, 트래픽 플로우, FORWARDED/DROPPED |

**배운 개념**: CNI, eBPF, 네트워크 관측성, ClusterIP, NodePort

### 7편~8편: 모니터링과 CI/CD

| 편 | 주제 | 핵심 기술 |
|----|------|----------|
| 7 | 모니터링 | Prometheus, Grafana, Loki, 메트릭 vs 로그 |
| 8 | CI/CD | Jenkins, ArgoCD, GitOps, 파이프라인 |

**배운 개념**: Pull 모델 메트릭 수집, TSDB, 시각화, GitOps, 지속적 통합/배포

### 9편~10편: 알림과 보안

| 편 | 주제 | 핵심 기술 |
|----|------|----------|
| 9 | AlertManager | 알림 규칙, 라우팅, 그룹핑, 억제 |
| 10 | 네트워크 정책 | CiliumNetworkPolicy, 제로 트러스트, L7 필터링 |

**배운 개념**: PrometheusRule, 알림 파이프라인, 기본 차단, 화이트리스트

### 11편~12편: 스케일링과 서비스 메시

| 편 | 주제 | 핵심 기술 |
|----|------|----------|
| 11 | HPA | metrics-server, 오토스케일링, PDB |
| 12 | Istio | mTLS, 카나리 배포, 서킷브레이커 |

**배운 개념**: 수평적 Pod 오토스케일링, 사이드카 패턴, 상호 TLS, 트래픽 분할

### 13편~14편: 테스트와 트러블슈팅

| 편 | 주제 | 핵심 기술 |
|----|------|----------|
| 13 | 부하 테스트 | k6, stress-ng, VU, p95/p99, RPS |
| 14 | 트러블슈팅 | 6단계 프레임워크, 레이어별 디버깅 |

**배운 개념**: 부하 테스트, 스트레스 테스트, 결과 분석, 체계적 문제 해결

---

## 실제 기업 인프라와의 비교

### 이 프로젝트 vs 실제 기업

| 항목 | 이 프로젝트 | 실제 기업 |
|------|-------------|----------|
| **인프라** | Mac 1대 + Tart VM | AWS/GCP/Azure 클라우드 |
| **클러스터 수** | 4개 | 수십~수백 개 |
| **노드 수** | 10개 | 수백~수천 개 |
| **네트워크** | Softnet 브릿지 | VPC, 전용선, CDN |
| **모니터링** | Prometheus + Grafana | 동일 (+ Datadog/New Relic) |
| **CI/CD** | Jenkins + ArgoCD | 동일 (+ GitHub Actions/GitLab CI) |
| **서비스 메시** | Istio (dev만) | Istio/Linkerd (전체) |
| **부하 테스트** | k6 (대시보드) | k6/Gatling/Locust |

### 핵심 메시지

**도구와 규모만 다를 뿐, 개념과 패턴은 동일하다.**

- `clusters.json`으로 한 것을 기업에서는 Terraform + 클라우드 API로 한다
- `CiliumNetworkPolicy`로 한 것을 기업에서는 동일한 도구 또는 클라우드 방화벽으로 한다
- 대시보드에서 k6 테스트를 실행한 것을 기업에서는 CI/CD 파이프라인에 통합한다

이 프로젝트를 이해했다면, 실제 클라우드 환경에 적응하는 것은 "같은 개념의 다른 구현"을 배우는 것뿐이다.

---

## 커리어 패스 — 이 지식을 어디에 쓸 수 있나

### 1. DevOps 엔지니어

**역할**: 개발팀과 운영팀의 연결고리이다. CI/CD 파이프라인을 구축하고 인프라를 자동화한다.

**이 프로젝트에서 배운 관련 기술:**
- Jenkins + ArgoCD 파이프라인 구성 (8편)
- Bash 스크립트 자동화 (2~4편)
- Helm 차트 관리 (6~12편)

### 2. SRE (Site Reliability Engineer)

**역할**: 서비스의 안정성을 보장한다. 모니터링, 알림, 장애 대응, 용량 계획을 담당한다.

**이 프로젝트에서 배운 관련 기술:**
- Prometheus + Grafana 모니터링 (7편)
- AlertManager 알림 체계 (9편)
- 부하 테스트와 SLA 관리 (13편)
- 트러블슈팅 프레임워크 (14편)
- HPA 오토스케일링 (11편)

### 3. Platform 엔지니어

**역할**: 개발자들이 사용하는 내부 플랫폼을 구축한다. 개발자가 인프라를 신경 쓰지 않고 애플리케이션에 집중할 수 있는 환경을 만든다.

**이 프로젝트에서 배운 관련 기술:**
- 멀티클러스터 설계 (전체)
- 네트워크 정책 (10편)
- 서비스 메시 (12편)
- SRE 대시보드 개발 (전체)

### 4. Cloud Architect

**역할**: 전체 클라우드 인프라를 설계한다. CIDR 계획, 보안 아키텍처, 비용 최적화를 담당한다.

**이 프로젝트에서 배운 관련 기술:**
- 멀티클러스터 아키텍처 설계 (1편, 15편)
- CIDR 설계와 네트워크 분리 (5편)
- 제로 트러스트 보안 모델 (10편)
- Day 0/1/2 운영 분류 (15편)

---

## 다음 단계 — 여기서 더 나아가려면

### 1. 클라우드 마이그레이션

이 프로젝트를 실제 클라우드(AWS/GCP/Azure)로 옮겨 보라.

```
현재                          클라우드
Tart VM          →           EC2 / GCE / Azure VM
clusters.json    →           Terraform + Cloud API
수동 kubeadm     →           EKS / GKE / AKS (관리형 K8s)
Softnet 브릿지    →           VPC + 서브넷
```

**시작하기 좋은 순서:**
1. AWS Free Tier로 EC2 인스턴스 만들어 보기
2. Terraform으로 인프라 코드화
3. EKS (AWS 관리형 K8s) 클러스터 생성
4. 이 프로젝트의 Helm values를 그대로 적용

### 2. 멀티 리전(Multi-Region)

현재는 Mac 한 대(단일 리전)이다. 클라우드에서는 여러 지역에 클러스터를 배치할 수 있다.

```
현재: Mac 1대
    └─ platform, dev, staging, prod (모두 같은 네트워크)

미래: 멀티 리전
    ├─ us-east-1: platform + prod-east
    ├─ us-west-2: prod-west
    └─ ap-northeast-2 (서울): dev + staging
```

### 3. 서비스 메시 심화

현재는 dev 클러스터에만 Istio를 설치했다. 더 깊이 들어가면:

- **멀티클러스터 메시**: 여러 클러스터를 하나의 메시로 연결
- **Observability 심화**: 분산 추적(Distributed Tracing)으로 요청 경로 전체 추적
- **트래픽 관리 심화**: A/B 테스트, 블루/그린 배포, 페일오버

### 4. GitOps 심화

ArgoCD로 단순 동기화만 했다. 더 나아가면:

- **ApplicationSet**: 하나의 정의로 여러 클러스터에 동시 배포
- **Kustomize/Helm 통합**: 환경별(dev/staging/prod) 설정 분리
- **Progressive Delivery**: Argo Rollouts로 자동 카나리 + 자동 롤백

### 5. 보안 심화

- **OPA/Gatekeeper**: Pod 생성 시 보안 정책 강제 (예: root 실행 금지)
- **Vault**: 시크릿 중앙 관리
- **Falco**: 런타임 보안 모니터링
- **이미지 스캐닝**: 컨테이너 이미지의 취약점 자동 검사

---

## 명령어 치트 시트

### 인프라 생명주기

```bash
# 최초 설치 (한 번만)
./scripts/demo.sh                    # 전체: 설치 + 대시보드
./scripts/install.sh                 # 인프라만 설치

# 골든 이미지 빌드 (선택, 최초 1회)
./scripts/build-golden-image.sh

# 일상 시작
./scripts/demo.sh --skip-install     # VM 부팅 + 대시보드
./scripts/boot.sh                    # VM만 부팅

# 대시보드만
./scripts/demo.sh --dashboard-only
cd dashboard && npm run dev          # 직접 실행

# 상태 확인
./scripts/status.sh

# 종료
./scripts/shutdown.sh                # 안전 종료 (drain + stop)

# 완전 삭제
./scripts/destroy.sh
```

### kubectl 기본

```bash
# 클러스터별 노드 확인
kubectl --kubeconfig kubeconfig/platform.yaml get nodes
kubectl --kubeconfig kubeconfig/dev.yaml get nodes
kubectl --kubeconfig kubeconfig/staging.yaml get nodes
kubectl --kubeconfig kubeconfig/prod.yaml get nodes

# Pod 확인
kubectl --kubeconfig kubeconfig/dev.yaml get pods -n demo
kubectl --kubeconfig kubeconfig/dev.yaml get pods -A           # 모든 네임스페이스

# Pod 상세
kubectl --kubeconfig kubeconfig/dev.yaml describe pod <name> -n demo

# Pod 로그
kubectl --kubeconfig kubeconfig/dev.yaml logs <name> -n demo
kubectl --kubeconfig kubeconfig/dev.yaml logs <name> -n demo --previous

# Pod 내부 접속
kubectl --kubeconfig kubeconfig/dev.yaml exec -it deploy/nginx-web -n demo -- /bin/sh
```

### 서비스 확인

```bash
# 서비스 + 엔드포인트
kubectl --kubeconfig kubeconfig/dev.yaml get svc -n demo
kubectl --kubeconfig kubeconfig/dev.yaml get endpoints -n demo

# HPA 상태
kubectl --kubeconfig kubeconfig/dev.yaml get hpa -n demo
kubectl --kubeconfig kubeconfig/dev.yaml get hpa -n demo -w    # 실시간 감시

# 네트워크 정책
kubectl --kubeconfig kubeconfig/dev.yaml get cnp -n demo
```

### 모니터링 접속

```bash
# VM IP 확인
tart ip platform-worker1

# Grafana
open http://$(tart ip platform-worker1):30300    # admin / admin

# AlertManager
open http://$(tart ip platform-worker1):30903

# ArgoCD
open http://$(tart ip platform-worker1):30800

# Jenkins
open http://$(tart ip platform-worker1):30900    # admin / admin

# Nginx 데모
open http://$(tart ip dev-worker1):30080

# Keycloak
open http://$(tart ip dev-worker1):30880         # admin / admin
```

### 디버깅

```bash
# VM 상태
tart list

# VM IP
tart ip <vm-name>

# SSH 접속
ssh admin@$(tart ip dev-worker1)                 # 비밀번호: admin

# Cilium 상태
kubectl --kubeconfig kubeconfig/dev.yaml exec -n kube-system ds/cilium -- cilium status

# Hubble 트래픽
kubectl --kubeconfig kubeconfig/dev.yaml -n kube-system port-forward svc/hubble-relay 4245:80 &
hubble observe --namespace demo --verdict DROPPED

# 리소스 사용량
kubectl --kubeconfig kubeconfig/dev.yaml top nodes
kubectl --kubeconfig kubeconfig/dev.yaml top pods -n demo

# 이벤트 (최근 순)
kubectl --kubeconfig kubeconfig/dev.yaml get events --sort-by='.lastTimestamp' -n demo
```

### Helm 관리

```bash
# 설치된 차트 목록
helm --kubeconfig kubeconfig/platform.yaml list -A

# 차트 values 확인
helm --kubeconfig kubeconfig/platform.yaml get values cilium -n kube-system

# 롤백
helm --kubeconfig kubeconfig/platform.yaml rollback cilium 1 -n kube-system
```

---

## 프로젝트 구조 최종 요약

```
tart-infra/
├── config/clusters.json           ← Day 0: 전체 설계 (Single Source of Truth)
│
├── scripts/
│   ├── demo.sh                    ← Day 1: 원스톱 설치 + 대시보드
│   ├── install.sh                 ← Day 1: 17단계 자동 설치
│   ├── boot.sh                    ← Day 2: 일상 시작
│   ├── shutdown.sh                ← Day 2: 안전 종료
│   ├── status.sh                  ← Day 2: 상태 확인
│   ├── destroy.sh                 ← 완전 삭제
│   ├── build-golden-image.sh      ← 골든 이미지 빌드
│   ├── lib/                       ← 공유 함수 (vm, ssh, k8s, common)
│   ├── install/01~17              ← 설치 단계별 스크립트
│   └── boot/01~03                 ← 부팅 단계별 스크립트
│
├── manifests/                     ← 선언적 인프라 정의
│   ├── *-values.yaml              ← Helm 차트 설정
│   ├── demo/                      ← 데모 앱 (nginx, httpbin, redis ...)
│   ├── network-policies/          ← 제로 트러스트 L7 정책
│   ├── hpa/                       ← HPA + PDB
│   ├── istio/                     ← 서비스 메시 설정
│   ├── alerting/                  ← 알림 규칙 + 웹훅
│   ├── argocd/                    ← GitOps Application
│   └── jenkins/                   ← CI 파이프라인
│
├── dashboard/                     ← SRE 운영 대시보드
│   ├── server/                    ← Express API (11개 엔드포인트)
│   │   ├── jobs.ts                ← 테스트 Job 관리 (k6/stress-ng)
│   │   ├── collector.ts           ← 백그라운드 데이터 수집
│   │   └── collectors/            ← Hubble, Scaling, Services
│   ├── src/pages/                 ← React 6개 페이지
│   └── shared/types.ts            ← 공유 타입 (25개 인터페이스)
│
├── terraform/                     ← IaC 대안 (Terraform)
├── kubeconfig/                    ← 클러스터별 인증 파일
└── docs/                          ← 학습 문서 + 버그 리포트
```

---

## 마치며

왜 전체 통합이 필요한가? 개별 컴포넌트가 단독으로 동작하는 것과 시스템 전체가 통합되어 동작하는 것은 다르다. Cilium이 단독으로 정상이고, Istio가 단독으로 정상이어도, 둘이 함께 동작할 때 eBPF와 iptables 규칙이 충돌할 수 있다. HPA가 Pod를 늘려도 네트워크 정책이 새 Pod의 트래픽을 차단할 수 있다. 이런 통합 레벨의 문제는 모든 컴포넌트를 함께 실행해야만 드러나며, 이것이 전체 파이프라인을 end-to-end로 검증해야 하는 이유이다.

14편에 걸쳐 **빈 Mac에서 프로덕션급 멀티클러스터 인프라**를 만들었다. 돌아보면:

1. **VM 10대**를 만들고 네트워크로 연결했다
2. **K8s 4개 클러스터**를 초기화하고 CNI로 Pod 네트워크를 구성했다
3. **모니터링** (Prometheus + Grafana + Loki)으로 인프라를 관찰했다
4. **CI/CD** (Jenkins + ArgoCD)로 배포를 자동화했다
5. **알림** (AlertManager)으로 문제를 조기에 감지했다
6. **네트워크 보안** (CiliumNetworkPolicy)으로 제로 트러스트를 구현했다
7. **오토스케일링** (HPA)으로 트래픽에 자동 대응했다
8. **서비스 메시** (Istio)로 mTLS, 카나리, 서킷브레이커를 적용했다
9. **부하 테스트** (k6 + stress-ng)로 인프라를 검증했다
10. **트러블슈팅** 프레임워크로 문제를 체계적으로 해결했다

이 모든 것을 **명령어 한 줄** (`./scripts/demo.sh`)로 재현할 수 있다는 것이 이 프로젝트의 핵심이다.

인프라는 어렵지 않다. 단지 **한 번에 모든 것을 이해하려 하면** 어려운 것뿐이다. 하나씩, 레이어 하나씩, 개념 하나씩 쌓아 올리면 결국 전체 그림이 보인다.

이 시리즈가 인프라 여정의 **첫 걸음**이 되었기를 바란다.
