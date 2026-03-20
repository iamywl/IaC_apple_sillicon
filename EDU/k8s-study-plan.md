# Kubernetes 자격증 34일 완성 학습 계획

> tart-infra 환경(4개 클러스터: platform/dev/staging/prod)을 활용한 실전 중심 학습 로드맵이다.
> 매일 **개념 학습 → Tart VM 실습 → 기출문제 연습 → 복습 체크리스트** 순서로 진행한다.

---

## 학습 환경 준비

```bash
# VM 부팅
./scripts/boot.sh

# 클러스터 상태 확인
./scripts/status.sh

# kubeconfig 설정
export KUBECONFIG=$(pwd)/kubeconfig/platform.yaml  # 또는 dev/staging/prod
```

| 클러스터 | 노드 | 주요 용도 | 학습 활용 |
|----------|------|----------|----------|
| **platform** | master + worker×2 | Prometheus, Grafana, Jenkins, ArgoCD | 모니터링/CI-CD 실습 |
| **dev** | master + worker×1 | Istio, HPA, CiliumNetworkPolicy, 데모앱 | 핵심 실습 클러스터 |
| **staging** | master + worker×1 | Pre-production | 트러블슈팅 연습 |
| **prod** | master + worker×2 | Production HA | HA/스케줄링 실습 |

---

## 자격증 학습 순서 및 일정 (총 34일)

```
[이론 기초]          [실기 핵심]              [실기 고급]
KCNA (5일) → KCSA (5일) → CKA (10일) → CKAD (7일) → CKS (7일)
 Day 1~5     Day 6~10    Day 11~20    Day 21~27    Day 28~34
```

---

## Phase 1: KCNA — Kubernetes and Cloud Native Associate (Day 1~5)

> 이론 시험 (객관식 60문제, 90분, 75% 합격)

| Day | 주제 | 도메인 | 학습 내용 |
|-----|------|--------|----------|
| **1** | K8s 아키텍처 | Fundamentals (46%) | Control Plane/Worker Node 구조, API Server, etcd, scheduler, controller-manager |
| **2** | 핵심 오브젝트 | Fundamentals (46%) | Pod, Deployment, Service, DaemonSet, StatefulSet, Job, CronJob, ConfigMap, Secret |
| **3** | 컨테이너 오케스트레이션 | Orchestration (22%) + Architecture (16%) | 컨테이너 런타임, CRI, 스케줄링, 오토스케일링, CNCF 프로젝트, MSA |
| **4** | 관측성 & 앱 딜리버리 | Observability (8%) + Delivery (8%) | Prometheus, Grafana, Logging, Helm, Kustomize, GitOps, CI/CD |
| **5** | 모의시험 & 총복습 | 전 도메인 | 40문제 모의시험, 오답노트, 취약 도메인 재학습 |

→ 상세: [KCNA/daily/](KCNA/daily/)

---

## Phase 2: KCSA — Kubernetes Security Associate (Day 6~10)

> 이론 시험 (객관식 60문제, 90분, 67% 합격)

| Day | 주제 | 도메인 | 학습 내용 |
|-----|------|--------|----------|
| **6** | 클라우드 네이티브 보안 개요 | Security Overview (14%) | 4C 모델, 공격 표면, 위협 모델링, STRIDE |
| **7** | 클러스터 컴포넌트 보안 | Cluster Security (22%) | API Server 보안, etcd 암호화, kubelet 인증, kube-bench |
| **8** | 보안 기초 | Security Fundamentals (22%) | RBAC, ServiceAccount, Secrets 관리, Pod Security Standards |
| **9** | 위협 모델 & 플랫폼 보안 | Threat Model (16%) + Platform (16%) | MITRE ATT&CK, 공급망 보안, 네트워크 보안, 런타임 보안 |
| **10** | Compliance & 모의시험 | Compliance (10%) + 전체 | 감사 로그, 규정 준수, 40문제 모의시험 |

→ 상세: [KCSA/daily/](KCSA/daily/)

---

## Phase 3: CKA — Certified Kubernetes Administrator (Day 11~20)

> 실기 시험 (hands-on, 120분, 66% 합격) — **가장 중요한 자격증**

| Day | 주제 | 도메인 (비중) | Tart VM 실습 |
|-----|------|--------------|-------------|
| **11** | 클러스터 아키텍처 & kubeadm | Architecture (25%) | 클러스터 구조 분석, static pod 확인, kubeadm 토큰 관리 |
| **12** | etcd 백업/복구 & 업그레이드 | Architecture (25%) | etcd snapshot 생성/복원, kubeadm upgrade 시뮬레이션 |
| **13** | RBAC & 인증서 관리 | Architecture (25%) | Role/ClusterRole 생성, kubeconfig 생성, 인증서 갱신 |
| **14** | Deployment & Rolling Update | Workloads (15%) | Deployment 생성, 롤링 업데이트, 롤백, 스케일링 |
| **15** | 스케줄링 심화 | Workloads (15%) | Taint/Toleration, NodeAffinity, DaemonSet, Job/CronJob |
| **16** | Service 타입 & DNS | Services (20%) | ClusterIP/NodePort/LB, CoreDNS, 서비스 디스커버리 |
| **17** | NetworkPolicy & Ingress | Services (20%) | CiliumNetworkPolicy, Ingress 규칙, CNI 구조 분석 |
| **18** | Storage | Storage (10%) | PV/PVC 생성, StorageClass, hostPath, emptyDir |
| **19** | Troubleshooting | Troubleshooting (30%) | Pod/Node 진단, kubelet 복구, DNS 장애, 로그 분석 |
| **20** | CKA 모의시험 | 전 도메인 | 50문제 종합 시나리오, 시간 측정 (120분) |

→ 상세: [CKA/daily/](CKA/daily/)

---

## Phase 4: CKAD — Certified Kubernetes Application Developer (Day 21~27)

> 실기 시험 (hands-on, 120분, 66% 합격)

| Day | 주제 | 도메인 (비중) | Tart VM 실습 |
|-----|------|--------------|-------------|
| **21** | Application Design | Design & Build (20%) | Dockerfile, Multi-container Pod (sidecar/init), Volume 공유 |
| **22** | Deployment 전략 | Deployment (20%) | Rolling Update, Blue/Green, Canary (Istio 활용) |
| **23** | Observability | Observability (15%) | Liveness/Readiness/Startup Probe, 로그 확인, 디버깅 |
| **24** | ConfigMap & Secret | Config & Security (25%) | ConfigMap/Secret 생성, 환경변수/볼륨 마운트, immutable 설정 |
| **25** | SecurityContext & SA | Config & Security (25%) | SecurityContext, ServiceAccount, RBAC, Resource Limits |
| **26** | Services & Networking | Services (20%) | Service 생성, Ingress, NetworkPolicy, DNS 활용 |
| **27** | CKAD 모의시험 | 전 도메인 | 종합 시나리오, 시간 측정 (120분) |

→ 상세: [CKAD/daily/](CKAD/daily/)

---

## Phase 5: CKS — Certified Kubernetes Security Specialist (Day 28~34)

> 실기 시험 (hands-on, 120분, 67% 합격) — CKA 합격 필수

| Day | 주제 | 도메인 (비중) | Tart VM 실습 |
|-----|------|--------------|-------------|
| **28** | Cluster Setup | Setup (10%) | NetworkPolicy default deny, kube-bench CIS 점검 |
| **29** | Cluster Hardening | Hardening (15%) | RBAC 최소 권한, SA 토큰 제한, API Server 감사 로그 |
| **30** | System Hardening | System (15%) | AppArmor 프로파일, seccomp, 불필요 패키지 제거 |
| **31** | Microservice 취약점 | Vulnerabilities (20%) | Pod Security Standards, SecurityContext, OPA Gatekeeper |
| **32** | Supply Chain Security | Supply Chain (20%) | Trivy 이미지 스캔, Admission Controller, 이미지 정책 |
| **33** | 런타임 보안 & 모니터링 | Monitoring (20%) | Falco 룰, Audit Log 분석, 이상 행위 탐지 |
| **34** | CKS 모의시험 | 전 도메인 | 종합 보안 시나리오, 시간 측정 (120분) |

→ 상세: [CKS/daily/](CKS/daily/)

---

## 학습 팁

### 시험별 핵심 전략

| 시험 | 유형 | 핵심 전략 |
|------|------|----------|
| KCNA | 객관식 | 개념 이해 → 키워드 암기 → 모의시험 반복 |
| KCSA | 객관식 | 보안 계층별 정리 → 도구 용도 파악 → 시나리오 연습 |
| CKA | 실기 | kubectl 속도 → YAML 템플릿 암기 → 트러블슈팅 패턴화 |
| CKAD | 실기 | `kubectl run/create` 활용 → 시간 관리 → 쉬운 문제 먼저 |
| CKS | 실기 | 보안 도구 CLI 숙달 → 정책 YAML 패턴 → 감사 로그 분석 |

### 매일 학습 루틴

```
1. 개념 학습 (30분)     — 해당 도메인 01-concepts.md 해당 섹션 정독
2. 예제 실습 (30분)     — 02-examples.md 코드 직접 타이핑
3. Tart VM 실습 (60분)  — daily/dayXX.md 실습 과제 수행
4. 기출문제 (30분)      — 03-exam-questions.md 관련 문제 풀기
5. 복습 체크리스트 (15분) — 오늘 배운 핵심 명령어/개념 3줄 요약
```

### kubectl 생산성 설정

```bash
# 별칭 설정 (시험장에서도 사용 가능)
alias k=kubectl
complete -o default -F __start_kubectl k

# dry-run으로 YAML 생성
k run nginx --image=nginx --dry-run=client -o yaml > pod.yaml
k create deploy web --image=nginx --replicas=3 --dry-run=client -o yaml > deploy.yaml

# 빠른 컨텍스트 전환
k config use-context platform
k config use-context dev
```

---

## 참고 자료

| 자격증 | 개념 | 예제 | 기출문제 | 실습 |
|--------|------|------|---------|------|
| KCNA | [01-concepts](KCNA/01-concepts.md) | [02-examples](KCNA/02-examples.md) | [03-exam-questions](KCNA/03-exam-questions.md) | [04-tart-infra-practice](KCNA/04-tart-infra-practice.md) |
| KCSA | [01-concepts](KCSA/01-concepts.md) | [02-examples](KCSA/02-examples.md) | [03-exam-questions](KCSA/03-exam-questions.md) | [04-tart-infra-practice](KCSA/04-tart-infra-practice.md) |
| CKA | [01-concepts](CKA/01-concepts.md) | [02-examples](CKA/02-examples.md) | [03-exam-questions](CKA/03-exam-questions.md) | [04-tart-infra-practice](CKA/04-tart-infra-practice.md) |
| CKAD | [01-concepts](CKAD/01-concepts.md) | [02-examples](CKAD/02-examples.md) | [03-exam-questions](CKAD/03-exam-questions.md) | [04-tart-infra-practice](CKAD/04-tart-infra-practice.md) |
| CKS | [01-concepts](CKS/01-concepts.md) | [02-examples](CKS/02-examples.md) | [03-exam-questions](CKS/03-exam-questions.md) | [04-tart-infra-practice](CKS/04-tart-infra-practice.md) |
