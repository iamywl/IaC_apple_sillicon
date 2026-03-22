# 학습 계획 — tart-infra 프로젝트 완전 정복

> **전제**: 하루 2시간 학습 | **총 소요**: 5주 (25일, 총 50시간)
> **방식**: 개념(EDU) → 실습(GUIDE) 순서로 학습한다.

---

## 목차

- [전체 일정 요약](#전체-일정-요약)
- [1주차: 기초 — 가상화, 컨테이너, K8s](#1주차-기초--가상화-컨테이너-k8s)
- [2주차: 네트워크 & 보안](#2주차-네트워크--보안)
- [3주차: 모니터링, IaC, CI/CD](#3주차-모니터링-iac-cicd)
- [4주차: 앱 운영 & 부하 테스트](#4주차-앱-운영--부하-테스트)
- [5주차: 보안 심화 & 통합](#5주차-보안-심화--통합)
- [학습 자료 매핑](#학습-자료-매핑)
- [자가 평가 체크리스트](#자가-평가-체크리스트)
- [학습 팁](#학습-팁)

---

## 전체 일정 요약

| 주차 | 주제 | 기간 | 핵심 키워드 |
|------|------|------|------------|
| **1주차** | 기초 (VM, 컨테이너, K8s) | Day 1~5 | VM, containerd, Pod, Deployment |
| **2주차** | 네트워크 & 보안 | Day 6~10 | Cilium, eBPF, Zero Trust, Istio, mTLS |
| **3주차** | 모니터링, IaC, CI/CD | Day 11~15 | Prometheus, Grafana, Terraform, Jenkins, ArgoCD |
| **4주차** | 앱 운영 & 부하 테스트 | Day 16~20 | HPA, 데모앱, k6, SRE 대시보드, 트러블슈팅 |
| **5주차** | 보안 심화 & 통합 실습 | Day 21~25 | Sealed Secrets, RBAC, Gatekeeper, Backup, 전체 구축 |

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

## 1주차: 기초 — 가상화, 컨테이너, K8s

### Day 1 (2h) — 인프라 엔지니어링 입문
| 시간 | 활동 | 자료 |
|------|------|------|
| 1h | 이론: 인프라 엔지니어링의 정의와 파이프라인 전체 흐름을 학습한다. | [01-project-overview.md](01-project-overview.md) |
| 30m | 실습: 필수 도구를 설치하고 시스템 요구사항을 점검한다. | [GUIDE/00-prerequisites.md](guide/00-prerequisites.md) |
| 30m | 실습: 4 클러스터 구조와 네트워크 설계를 확인한다. | [GUIDE/01-architecture.md](guide/01-architecture.md) |

**학습 목표**: IaC가 왜 필요한지, 반복 가능한 인프라가 무엇을 의미하는지 이해한다.

### Day 2 (2h) — 가상화와 VM
| 시간 | 활동 | 자료 |
|------|------|------|
| 1.5h | 이론: Hypervisor, 커널 격리, Golden Image, Tart VM 구조를 학습한다. | [02-infrastructure.md](02-infrastructure.md) |
| 30m | 실습: demo.sh로 전체 환경 구축을 시작한다. | [GUIDE/02-quick-start.md](guide/02-quick-start.md) |

**학습 목표**: Type 1/2 Hypervisor의 차이와 Apple Silicon에서 VM 동작 원리를 이해한다.

### Day 3 (2h) — 컨테이너와 쿠버네티스 기초
| 시간 | 활동 | 자료 |
|------|------|------|
| 1.5h | 이론: containerd, CRI, Pod, Deployment, kubeadm, 설치 파이프라인을 학습한다. | [03-kubernetes-setup.md](03-kubernetes-setup.md) |
| 30m | 실습: Phase 1~6 동작을 확인한다. | [GUIDE/03-phase-by-phase.md](guide/03-phase-by-phase.md) (Phase 1~6) |

**학습 목표**: 컨테이너와 VM의 차이, Pod/Deployment/Service 관계를 이해한다.

### Day 4 (2h) — 쿠버네티스 실습
| 시간 | 활동 | 자료 |
|------|------|------|
| 1h | 실습: Phase 7~12 설치 파이프라인을 확인한다. | [GUIDE/03-phase-by-phase.md](guide/03-phase-by-phase.md) (Phase 7~12) |
| 1h | 실습: 노드, Pod, 서비스 정상 동작을 확인한다. | [GUIDE/04-cluster-verification.md](guide/04-cluster-verification.md) |

**학습 목표**: 클러스터를 구축하고 상태를 직접 진단할 수 있어야 한다.

### Day 5 (2h) — 1주차 복습
| 시간 | 활동 | 자료 |
|------|------|------|
| 1h | 실습: Phase 13~17 확인 및 kubectl 명령어 연습 | [GUIDE/03-phase-by-phase.md](guide/03-phase-by-phase.md) (Phase 13~17) |
| 1h | 복습: 1주차 핵심 개념 정리, kubectl 기본 명령어 숙달 | 1주차 전체 자료 |

**학습 목표**: kubectl 기본 명령어에 익숙해지고, 전체 파이프라인 흐름을 파악한다.

---

## 2주차: 네트워크 & 보안

### Day 6 (2h) — 쿠버네티스 네트워킹
| 시간 | 활동 | 자료 |
|------|------|------|
| 2h | 이론: CNI, eBPF, Cilium, Hubble, 네트워크 기초 | [04-networking.md](04-networking.md) (1~2장) |

**학습 목표**: Pod 간 통신 원리를 이해하고, Cilium이 kube-proxy를 대체하는 이유를 설명할 수 있어야 한다.

### Day 7 (2h) — 네트워크 보안과 서비스 메시
| 시간 | 활동 | 자료 |
|------|------|------|
| 2h | 이론: 제로 트러스트, CiliumNetworkPolicy, Istio mTLS, 카나리 배포 | [04-networking.md](04-networking.md) (3~5장) |

**학습 목표**: Default Deny 정책과 mTLS 자동 암호화의 동작 원리를 이해한다.

### Day 8 (2h) — 네트워크 실습
| 시간 | 활동 | 자료 |
|------|------|------|
| 1h | 실습: 네트워크 관련 Phase 동작 확인 | [GUIDE/03-phase-by-phase.md](guide/03-phase-by-phase.md) (네트워크) |
| 1h | 실습: Hubble로 네트워크 플로우 관찰 | [GUIDE/07-testing-scenarios.md](guide/07-testing-scenarios.md) (네트워크 부분) |

**학습 목표**: 이론을 실제 트래픽 관찰로 연결한다.

### Day 9 (2h) — 모니터링과 옵저버빌리티
| 시간 | 활동 | 자료 |
|------|------|------|
| 2h | 이론: Three Pillars, Prometheus, Grafana, Loki, AlertManager | [05-monitoring.md](05-monitoring.md) |

**학습 목표**: 옵저버빌리티 3대 요소와 Prometheus TSDB 동작 원리를 파악한다.

### Day 10 (2h) — 모니터링 실습 + 2주차 복습
| 시간 | 활동 | 자료 |
|------|------|------|
| 1h | 실습: Grafana 대시보드에 접속하여 메트릭을 확인한다. | [GUIDE/05-dashboard-guide.md](guide/05-dashboard-guide.md) |
| 1h | 복습: 네트워크 계층별 정리(L3→L4→L7), 모니터링 스택 아키텍처 정리 | 2주차 전체 자료 |

**학습 목표**: 네트워크와 모니터링의 전체 흐름을 정리할 수 있어야 한다.

---

## 3주차: 모니터링, IaC, CI/CD

### Day 11 (2h) — Infrastructure as Code
| 시간 | 활동 | 자료 |
|------|------|------|
| 2h | 이론: Bash vs Terraform, 명령형 vs 선언형, 멱등성, SSOT | [06-iac-automation.md](06-iac-automation.md) |

**학습 목표**: IaC 핵심 원칙과 Terraform HCL 기본 문법을 이해한다.

### Day 12 (2h) — Terraform 실습
| 시간 | 활동 | 자료 |
|------|------|------|
| 2h | 실습: Terraform 모듈로 동일 인프라를 구축해본다. | [GUIDE/09-terraform-alternative.md](guide/09-terraform-alternative.md) |

**학습 목표**: terraform init → plan → apply 워크플로우를 직접 수행한다.

### Day 13 (2h) — CI/CD 파이프라인
| 시간 | 활동 | 자료 |
|------|------|------|
| 2h | 이론: Jenkins 7단계 파이프라인, ArgoCD GitOps 원칙 | [07-cicd-pipeline.md](07-cicd-pipeline.md) |

**학습 목표**: CI와 CD의 차이, GitOps 원칙과 자동 배포 파이프라인 흐름을 이해한다.

### Day 14 (2h) — CI/CD 실습
| 시간 | 활동 | 자료 |
|------|------|------|
| 2h | 실습: Jenkins + ArgoCD 파이프라인을 직접 구성한다. | [GUIDE/06-cicd-workflow.md](guide/06-cicd-workflow.md) |

**학습 목표**: Jenkinsfile 작성과 ArgoCD Sync 정책 설정을 경험한다.

### Day 15 (2h) — 3주차 복습
| 시간 | 활동 | 자료 |
|------|------|------|
| 1h | 복습: IaC + CI/CD 전체 흐름 정리, PromQL 쿼리 연습 | 3주차 전체 자료 |
| 1h | 실습: manifests/ 와 terraform/ 디렉토리 코드 분석 | [manifests/](../manifests/) + [terraform/](../terraform/) |

**학습 목표**: 모니터링, IaC, CI/CD의 핵심 개념을 완전히 내재화한다.

---

## 4주차: 앱 운영 & 부하 테스트

### Day 16 (2h) — 오토스케일링
| 시간 | 활동 | 자료 |
|------|------|------|
| 1.5h | 이론: metrics-server, HPA 공식, PDB를 학습한다. | [08-autoscaling.md](08-autoscaling.md) |
| 30m | 실습: HPA 동작을 관찰한다. | [GUIDE/07-testing-scenarios.md](guide/07-testing-scenarios.md) (스케일링) |

**학습 목표**: HPA 계산 공식과 PDB로 가용성을 보장하는 방법을 이해한다.

### Day 17 (2h) — 데모 앱과 마이크로서비스
| 시간 | 활동 | 자료 |
|------|------|------|
| 2h | 이론: 3-Tier 아키텍처, OAuth 2.0, RabbitMQ, HPA 설정 | [09-demo-apps.md](09-demo-apps.md) |

**학습 목표**: 마이크로서비스 아키텍처 패턴과 Keycloak 인증 통합을 이해한다.

### Day 18 (2h) — SRE 대시보드
| 시간 | 활동 | 자료 |
|------|------|------|
| 1h | 이론: SRE 대시보드 구조, React + Express 아키텍처 | [10-dashboard.md](10-dashboard.md) |
| 1h | 실습: 대시보드를 설치하고 사용한다. | [GUIDE/05-dashboard-guide.md](guide/05-dashboard-guide.md) |

**학습 목표**: SRE 대시보드의 운영 역할과 실시간 모니터링 API 설계를 파악한다.

### Day 19 (2h) — 부하 테스트
| 시간 | 활동 | 자료 |
|------|------|------|
| 1h | 이론: k6, VU, p95/p99, RPS, SLA | [11-load-testing.md](11-load-testing.md) |
| 1h | 실습: 주요 시나리오를 직접 실행한다. | [GUIDE/07-testing-scenarios.md](guide/07-testing-scenarios.md) |

**학습 목표**: 부하 테스트를 설계하고, 성능 지표를 해석할 수 있어야 한다.

### Day 20 (2h) — 트러블슈팅 + 4주차 복습
| 시간 | 활동 | 자료 |
|------|------|------|
| 1h | 이론+실습: 6단계 디버깅 방법론과 레이어별 체크리스트 | [12-troubleshooting.md](12-troubleshooting.md) + [GUIDE/08-troubleshooting.md](guide/08-troubleshooting.md) |
| 1h | 복습: 앱 배포 → 스케일링 → 모니터링 → 장애 대응 흐름 정리 | 4주차 전체 자료 |

**학습 목표**: 체계적인 디버깅 방법론을 익히고, 운영 End-to-End 흐름을 이해한다.

---

## 5주차: 보안 심화 & 통합

### Day 21 (2h) — 시크릿 관리 & RBAC
| 시간 | 활동 | 자료 |
|------|------|------|
| 1h | 이론+실습: Sealed Secrets로 시크릿 암호화, Git 저장 흐름 | [GUIDE/10-security-secrets.md](guide/10-security-secrets.md) (1~2장) |
| 1h | 실습: RBAC 커스텀 역할 확인, 권한 테스트 | [GUIDE/10-security-secrets.md](guide/10-security-secrets.md) (2장) |

**학습 목표**: Sealed Secrets와 RBAC 최소 권한 원칙을 적용할 수 있어야 한다.

### Day 22 (2h) — OPA Gatekeeper 정책 강제
| 시간 | 활동 | 자료 |
|------|------|------|
| 1h | 이론: ConstraintTemplate, Constraint 구조, Rego 정책 언어 | [GUIDE/10-security-secrets.md](guide/10-security-secrets.md) (3장) |
| 1h | 실습: 정책 위반 테스트 — 특권 컨테이너 차단, 라벨 누락 경고 | [manifests/gatekeeper/](../manifests/gatekeeper/) |

**학습 목표**: Admission Webhook 기반 정책 강제의 동작 원리를 이해한다.

### Day 23 (2h) — 백업 & 재해 복구 + 리소스 관리
| 시간 | 활동 | 자료 |
|------|------|------|
| 1h | 이론+실습: etcd 스냅샷, Velero 백업/복원 | [GUIDE/11-backup-dr.md](guide/11-backup-dr.md) |
| 1h | 이론+실습: ResourceQuota, LimitRange, Harbor | [GUIDE/12-resource-management.md](guide/12-resource-management.md) |

**학습 목표**: 장애 유형별 복원 방법과 환경별 리소스 정책을 이해한다.

### Day 24 (2h) — 통합 구축 실습
| 시간 | 활동 | 자료 |
|------|------|------|
| 2h | 통합: 클린 환경에서 전체 인프라 구축, 검증, 부하 테스트 완료 | [GUIDE/02-quick-start.md](guide/02-quick-start.md) ~ [GUIDE/07-testing-scenarios.md](guide/07-testing-scenarios.md) |

**학습 목표**: 전체 파이프라인을 처음부터 혼자서 구축한다.

### Day 25 (2h) — 최종 정리
| 시간 | 활동 | 자료 |
|------|------|------|
| 1h | 학습: Day 0/1/2 운영, 커리어 패스, 전체 정리 | [13-summary.md](13-summary.md) |
| 1h | 정리: 전체 아키텍처 직접 그리기, 나만의 치트시트 작성 | [14-how-to-modify.md](14-how-to-modify.md) + [15-tech-stack.md](15-tech-stack.md) |

**학습 목표**: 전체 스택을 다른 사람에게 설명할 수 있는 수준에 도달한다.

---

## 학습 자료 매핑

### EDU 문서 (이론 + 심화)

| 문서 | 학습 시점 | 용도 |
|------|----------|------|
| [01-project-overview.md](01-project-overview.md) | Day 1 | 프로젝트 전체 구조, 아키텍처 |
| [02-infrastructure.md](02-infrastructure.md) | Day 2 | 가상화, Tart VM, Terraform |
| [03-kubernetes-setup.md](03-kubernetes-setup.md) | Day 3 | 컨테이너, K8s, 설치 파이프라인 |
| [04-networking.md](04-networking.md) | Day 6~7 | 네트워킹, 보안 정책, 서비스 메시 |
| [05-monitoring.md](05-monitoring.md) | Day 9 | 모니터링, 옵저버빌리티 |
| [06-iac-automation.md](06-iac-automation.md) | Day 11 | Infrastructure as Code |
| [07-cicd-pipeline.md](07-cicd-pipeline.md) | Day 13 | CI/CD, Jenkins, ArgoCD |
| [08-autoscaling.md](08-autoscaling.md) | Day 16 | HPA, PDB |
| [09-demo-apps.md](09-demo-apps.md) | Day 17 | 데모앱, 마이크로서비스 |
| [10-dashboard.md](10-dashboard.md) | Day 18 | SRE 대시보드 |
| [11-load-testing.md](11-load-testing.md) | Day 19 | 부하 테스트, k6 |
| [12-troubleshooting.md](12-troubleshooting.md) | Day 20 | 트러블슈팅 |
| [13-summary.md](13-summary.md) | Day 25 | 전체 정리, 커리어 |
| [14-how-to-modify.md](14-how-to-modify.md) | Day 25 | 코드 수정 가이드 |
| [15-tech-stack.md](15-tech-stack.md) | Day 25 | 기술 스택 레퍼런스 |

### GUIDE 문서 (실습)

| 문서 | 학습 시점 | 용도 |
|------|----------|------|
| [GUIDE/00-prerequisites.md](guide/00-prerequisites.md) | Day 1 | 환경 구축 |
| [GUIDE/01-architecture.md](guide/01-architecture.md) | Day 1 | 아키텍처 이해 |
| [GUIDE/02-quick-start.md](guide/02-quick-start.md) | Day 2 | 빠른 시작 |
| [GUIDE/03-phase-by-phase.md](guide/03-phase-by-phase.md) | Day 3~5 | 설치 파이프라인 |
| [GUIDE/04-cluster-verification.md](guide/04-cluster-verification.md) | Day 4 | 클러스터 검증 |
| [GUIDE/05-dashboard-guide.md](guide/05-dashboard-guide.md) | Day 10, 18 | 대시보드 사용법 |
| [GUIDE/06-cicd-workflow.md](guide/06-cicd-workflow.md) | Day 14 | CI/CD 실습 |
| [GUIDE/07-testing-scenarios.md](guide/07-testing-scenarios.md) | Day 8, 16, 19 | 테스트 시나리오 |
| [GUIDE/08-troubleshooting.md](guide/08-troubleshooting.md) | Day 20 | 트러블슈팅 실습 |
| [GUIDE/09-terraform-alternative.md](guide/09-terraform-alternative.md) | Day 12 | Terraform 실습 |
| [GUIDE/10-security-secrets.md](guide/10-security-secrets.md) | Day 21~22 | 보안 실습 |
| [GUIDE/11-backup-dr.md](guide/11-backup-dr.md) | Day 23 | 백업/복구 |
| [GUIDE/12-resource-management.md](guide/12-resource-management.md) | Day 23 | 리소스 관리 |

---

## 자가 평가 체크리스트

### 1주차 완료 시
- [ ] VM과 컨테이너의 차이를 설명할 수 있는가?
- [ ] Pod, Deployment, Service의 관계를 설명할 수 있는가?
- [ ] kubectl로 클러스터 상태를 확인할 수 있는가?

### 2주차 완료 시
- [ ] Cilium이 kube-proxy를 대체하는 이유를 설명할 수 있는가?
- [ ] 제로 트러스트 네트워크 정책을 작성할 수 있는가?
- [ ] mTLS가 무엇이고 왜 필요한지 설명할 수 있는가?
- [ ] Prometheus의 Pull 모델을 설명할 수 있는가?

### 3주차 완료 시
- [ ] Terraform의 멱등성이 왜 중요한지 설명할 수 있는가?
- [ ] terraform plan 결과를 읽고 해석할 수 있는가?
- [ ] Jenkins 파이프라인 단계를 나열할 수 있는가?
- [ ] GitOps의 핵심 원칙을 설명할 수 있는가?

### 4주차 완료 시
- [ ] HPA 스케일링 공식을 설명할 수 있는가?
- [ ] k6로 부하 테스트 스크립트를 작성할 수 있는가?
- [ ] p95/p99의 의미를 설명할 수 있는가?
- [ ] 장애 발생 시 체계적으로 디버깅할 수 있는가?

### 5주차 (전체 학습 완료) 시
- [ ] Sealed Secrets의 암호화/복호화 흐름을 설명할 수 있는가?
- [ ] RBAC에서 ClusterRole과 Role의 차이를 설명할 수 있는가?
- [ ] OPA Gatekeeper의 ConstraintTemplate을 작성할 수 있는가?
- [ ] etcd 백업에서 복원까지의 절차를 수행할 수 있는가?
- [ ] 전체 인프라를 처음부터 혼자 구축할 수 있는가?
- [ ] 전체 아키텍처를 그림으로 설명할 수 있는가?
- [ ] 17단계 파이프라인 전체를 순서와 이유를 포함하여 설명할 수 있는가?

---

## 학습 팁

### 난이도별

| 난이도 | 기간 | 핵심 전략 |
|--------|------|----------|
| 쉬움 | 1주차 | 용어에 익숙해지는 것이 핵심. 모르는 용어는 맥락으로 파악 후 심화 자료에서 보충. |
| 보통 | 2~3주차 | 코드를 직접 읽으며 이해. manifests/와 terraform/ 파일을 함께 열어본다. |
| 어려움 | 4~5주차 | 실습 중심 학습. 장애를 일부러 만들어보고 복구하는 연습이 가장 효과적. |
