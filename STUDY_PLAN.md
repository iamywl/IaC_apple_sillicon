# 학습 계획 — tart-infra 인프라 엔지니어링 완전 정복

> **전제**: 하루 2시간 학습 | **총 소요**: 약 7주 (35일, 총 70시간)
> **학습 자료**: BLOG 15편 + GUIDE 13편 + EDU 9편
> **방식**: 이론(BLOG) → 심화(EDU) → 실습(GUIDE) 순서로 계층별 학습한다.

---

## 전체 일정 요약

| 주차 | 주제 | 기간 | 핵심 키워드 |
|------|------|------|------------|
| **1주차** | 기초 — 가상화, 컨테이너, K8s | Day 1~5 | VM, containerd, Pod, Deployment |
| **2주차** | 네트워크 & 보안 | Day 6~10 | Cilium, eBPF, Zero Trust, Istio, mTLS |
| **3주차** | 모니터링 & IaC | Day 11~15 | Prometheus, Grafana, Terraform, 멱등성 |
| **4주차** | CI/CD & 고급 운영 | Day 16~20 | Jenkins, ArgoCD, HPA, SRE 대시보드 |
| **5주차** | 앱 운영 & 부하 테스트 | Day 21~25 | 데모앱, k6, PDB, 트러블슈팅 |
| **6주차** | 보안 심화 & 운영 안정성 | Day 26~30 | Sealed Secrets, RBAC, Gatekeeper, Backup, Quotas, Harbor |
| **7주차** | 통합 실습 & 마무리 | Day 31~35 | 전체 구축 재현, Terraform 대안 |

---

## 상세 일정

### 1주차: 기초 — 가상화, 컨테이너, 쿠버네티스

#### Day 1 (2h) — 인프라 엔지니어링 입문
| 시간 | 활동 | 자료 |
|------|------|------|
| 1h | 이론: 인프라 엔지니어링의 정의와 17단계 파이프라인 전체 흐름을 학습한다. | [BLOG/01-introduction.md](BLOG/01-introduction.md) |
| 30m | 심화: 프로젝트 전체 아키텍처를 파악한다. | [EDU/01-project-overview.md](EDU/01-project-overview.md) |
| 30m | 실습: 필수 도구를 설치하고 시스템 요구사항을 점검한다. | [GUIDE/00-prerequisites.md](GUIDE/00-prerequisites.md) |

**학습 목표**: IaC가 왜 필요한지, 반복 가능한 인프라가 무엇을 의미하는지 이해하는 것이다. 프로젝트 전체 구조를 파악하는 것이 핵심이다.

#### Day 2 (2h) — 가상화와 VM
| 시간 | 활동 | 자료 |
|------|------|------|
| 1h | 이론: Hypervisor 종류, 커널 격리, Golden Image 개념을 학습한다. | [BLOG/02-virtualization.md](BLOG/02-virtualization.md) |
| 30m | 심화: Tart VM과 Terraform 인프라 계층을 학습한다. | [EDU/02-infrastructure.md](EDU/02-infrastructure.md) |
| 30m | 실습: 4 클러스터 구조와 네트워크 설계를 확인한다. | [GUIDE/01-architecture.md](GUIDE/01-architecture.md) |

**학습 목표**: Type 1/2 Hypervisor의 차이를 이해하고, Apple Silicon에서 VM이 어떻게 동작하는지 아는 것이다.

#### Day 3 (2h) — 컨테이너와 쿠버네티스 기초
| 시간 | 활동 | 자료 |
|------|------|------|
| 1.5h | 이론: containerd, CRI, Pod, Deployment, kubeadm을 학습한다. | [BLOG/03-containers-and-kubernetes.md](BLOG/03-containers-and-kubernetes.md) |
| 30m | 심화: 17단계 설치 스크립트의 구조를 파악한다. | [EDU/03-kubernetes-setup.md](EDU/03-kubernetes-setup.md) |

**학습 목표**: 컨테이너와 VM의 차이를 설명할 수 있어야 한다. K8s 핵심 오브젝트인 Pod, Deployment, Service의 관계를 이해하는 것이다.

#### Day 4 (2h) — 쿠버네티스 실습
| 시간 | 활동 | 자료 |
|------|------|------|
| 1h | 실습: demo.sh로 전체 환경을 구축해본다. | [GUIDE/02-quick-start.md](GUIDE/02-quick-start.md) |
| 1h | 실습: 17단계 설치 파이프라인 중 Phase 1~6의 동작을 확인한다. | [GUIDE/03-phase-by-phase.md](GUIDE/03-phase-by-phase.md) (Phase 1~6) |

**학습 목표**: 실제로 클러스터를 구축하는 경험을 쌓는 것이다. 각 Phase가 어떤 역할을 하는지 파악해야 한다.

#### Day 5 (2h) — 클러스터 검증 + 1주차 복습
| 시간 | 활동 | 자료 |
|------|------|------|
| 1h | 실습: 노드, Pod, 서비스가 정상 동작하는지 확인한다. | [GUIDE/04-cluster-verification.md](GUIDE/04-cluster-verification.md) |
| 1h | 복습: 1주차 핵심 개념을 정리하고 kubectl 명령어를 연습한다. | 1주차 전체 자료 |

**학습 목표**: 클러스터 상태를 스스로 진단할 수 있어야 한다. kubectl 기본 명령어에 익숙해지는 것이 목표이다.

---

### 2주차: 네트워크 & 보안

#### Day 6 (2h) — 쿠버네티스 네트워킹 기초
| 시간 | 활동 | 자료 |
|------|------|------|
| 1.5h | 이론: CNI, eBPF, Pod CIDR, NAT 없는 통신을 학습한다. | [BLOG/04-networking.md](BLOG/04-networking.md) |
| 30m | 심화: Cilium CNI와 Hubble의 구조를 파악한다. | [EDU/04-networking.md](EDU/04-networking.md) (전반부) |

**학습 목표**: Pod 간 통신이 어떻게 이루어지는지 원리를 이해하는 것이다. Cilium이 kube-proxy를 대체하는 이유를 설명할 수 있어야 한다.

#### Day 7 (2h) — 네트워크 심화 + Istio
| 시간 | 활동 | 자료 |
|------|------|------|
| 1h | 심화: Istio와 네트워크 정책을 상세히 학습한다. | [EDU/04-networking.md](EDU/04-networking.md) (후반부) |
| 1h | 실습: Phase 7~12 설치 파이프라인 중 네트워크 관련 Phase를 확인한다. | [GUIDE/03-phase-by-phase.md](GUIDE/03-phase-by-phase.md) (Phase 7~12) |

**학습 목표**: Service Mesh의 개념을 처음 접하는 단계이다. 네트워크 정책이 트래픽을 어떻게 제어하는지 흐름을 이해해야 한다.

#### Day 8 (2h) — 네트워크 보안: 제로 트러스트
| 시간 | 활동 | 자료 |
|------|------|------|
| 2h | 이론: Default Deny, L3/L4/L7 필터링, CiliumNetworkPolicy를 학습한다. | [BLOG/08-network-security.md](BLOG/08-network-security.md) |

**학습 목표**: 제로 트러스트 보안 모델을 이해하는 것이다. Whitelist 기반의 네트워크 정책을 직접 작성할 수 있어야 한다.

#### Day 9 (2h) — 서비스 메시
| 시간 | 활동 | 자료 |
|------|------|------|
| 2h | 이론: Sidecar 패턴, mTLS, VirtualService, 카나리 배포를 학습한다. | [BLOG/10-service-mesh.md](BLOG/10-service-mesh.md) |

**학습 목표**: Istio 아키텍처를 이해하고, mTLS 자동 암호화와 트래픽 분할 배포가 어떻게 동작하는지 아는 것이다.

#### Day 10 (2h) — 2주차 복습 + 네트워크 실습
| 시간 | 활동 | 자료 |
|------|------|------|
| 1h | 실습: Hubble로 네트워크 플로우를 직접 관찰한다. | [GUIDE/07-testing-scenarios.md](GUIDE/07-testing-scenarios.md) (네트워크 부분) |
| 1h | 복습: 네트워크 계층별로 정리하고(L3→L4→L7), 보안 정책을 요약한다. | 2주차 전체 자료 |

**학습 목표**: 이론으로 배운 내용을 실제 트래픽 관찰로 연결하는 것이다. 보안 정책의 전체 흐름을 정리할 수 있어야 한다.

---

### 3주차: 모니터링 & Infrastructure as Code

#### Day 11 (2h) — 모니터링 기초
| 시간 | 활동 | 자료 |
|------|------|------|
| 1.5h | 이론: 옵저버빌리티 Three Pillars(Metrics/Logs/Traces)와 Prometheus Pull 모델을 학습한다. | [BLOG/05-monitoring.md](BLOG/05-monitoring.md) |
| 30m | 심화: Prometheus와 Grafana의 내부 구조를 파악한다. | [EDU/05-monitoring.md](EDU/05-monitoring.md) (전반부) |

**학습 목표**: 옵저버빌리티의 3대 요소를 이해하는 것이다. MTTD/MTTR 개념과 Prometheus TSDB의 동작 원리를 파악해야 한다.

#### Day 12 (2h) — 모니터링 심화
| 시간 | 활동 | 자료 |
|------|------|------|
| 1h | 심화: Loki, AlertManager, 알림 라우팅을 학습한다. | [EDU/05-monitoring.md](EDU/05-monitoring.md) (후반부) |
| 1h | 실습: Grafana 대시보드에 접속하여 메트릭을 직접 확인한다. | [GUIDE/05-dashboard-guide.md](GUIDE/05-dashboard-guide.md) (모니터링 부분) |

**학습 목표**: 로그 수집 파이프라인의 흐름을 이해하는 것이다. 알림 규칙을 작성하고 Grafana 대시보드를 활용할 수 있어야 한다.

#### Day 13 (2h) — Infrastructure as Code
| 시간 | 활동 | 자료 |
|------|------|------|
| 2h | 이론: Bash vs Terraform, 명령형 vs 선언형, 멱등성, SSOT를 학습한다. | [BLOG/06-iac-automation.md](BLOG/06-iac-automation.md) |

**학습 목표**: IaC의 핵심 원칙을 이해하는 것이다. Terraform HCL 기본 문법과 State 관리 방식을 파악해야 한다.

#### Day 14 (2h) — Terraform 실습
| 시간 | 활동 | 자료 |
|------|------|------|
| 2h | 실습: Terraform 모듈로 동일한 인프라를 구축해본다. | [GUIDE/09-terraform-alternative.md](GUIDE/09-terraform-alternative.md) |

**학습 목표**: terraform init → plan → apply 워크플로우를 직접 수행하는 것이다. 모듈 구조가 어떻게 구성되어 있는지 파악해야 한다.

#### Day 15 (2h) — 3주차 복습
| 시간 | 활동 | 자료 |
|------|------|------|
| 1h | 복습: 모니터링 스택 전체 아키텍처를 직접 그려본다. | 3주차 전체 자료 |
| 1h | 실습: Prometheus PromQL 쿼리를 연습하고, Terraform 코드를 읽어본다. | [manifests/](manifests/) + [terraform/](terraform/) |

**학습 목표**: 모니터링과 IaC의 핵심 개념을 완전히 내재화하는 것이다.

---

### 4주차: CI/CD & 고급 운영

#### Day 16 (2h) — CI/CD 파이프라인 이론
| 시간 | 활동 | 자료 |
|------|------|------|
| 2h | 이론: Jenkins 7단계 파이프라인과 ArgoCD GitOps를 학습한다. | [BLOG/07-cicd-pipeline.md](BLOG/07-cicd-pipeline.md) |

**학습 목표**: CI와 CD의 차이를 명확히 구분하는 것이다. GitOps 원칙과 자동 배포 파이프라인의 전체 흐름을 이해해야 한다.

#### Day 17 (2h) — CI/CD 실습
| 시간 | 활동 | 자료 |
|------|------|------|
| 2h | 실습: Jenkins + ArgoCD 파이프라인을 직접 구성하고 동작을 확인한다. | [GUIDE/06-cicd-workflow.md](GUIDE/06-cicd-workflow.md) |

**학습 목표**: Jenkinsfile을 작성하고, ArgoCD Sync 정책을 설정하는 것이다. 배포 자동화를 직접 경험하는 것이 핵심이다.

#### Day 18 (2h) — 오토스케일링
| 시간 | 활동 | 자료 |
|------|------|------|
| 1.5h | 이론: metrics-server, HPA 공식, PDB를 학습한다. | [BLOG/09-autoscaling.md](BLOG/09-autoscaling.md) |
| 30m | 실습: HPA가 실제로 동작하는 것을 관찰한다. | [GUIDE/07-testing-scenarios.md](GUIDE/07-testing-scenarios.md) (스케일링 부분) |

**학습 목표**: HPA 계산 공식을 이해하고, PDB로 가용성을 보장하는 방법을 아는 것이다.

#### Day 19 (2h) — SRE 대시보드
| 시간 | 활동 | 자료 |
|------|------|------|
| 1h | 이론: SRE 대시보드의 구조(6 Pages, 11 APIs)를 학습한다. | [BLOG/12-sre-dashboard.md](BLOG/12-sre-dashboard.md) |
| 1h | 심화: React + Express 코드 구조를 분석한다. | [EDU/06-dashboard.md](EDU/06-dashboard.md) |

**학습 목표**: SRE 대시보드가 운영에서 어떤 역할을 하는지 이해하는 것이다. 실시간 모니터링 API가 어떻게 설계되었는지 파악해야 한다.

#### Day 20 (2h) — SRE 대시보드 실습 + 4주차 복습
| 시간 | 활동 | 자료 |
|------|------|------|
| 1h | 실습: 대시보드를 설치하고 직접 사용해본다. | [GUIDE/05-dashboard-guide.md](GUIDE/05-dashboard-guide.md) |
| 1h | 복습: CI/CD → 배포 → 스케일링 → 모니터링의 전체 흐름을 정리한다. | 4주차 전체 자료 |

**학습 목표**: 운영 파이프라인의 End-to-End 흐름을 완전히 이해하는 것이다.

---

### 5주차: 데모 앱 & 부하 테스트

#### Day 21 (2h) — 데모 앱 구성
| 시간 | 활동 | 자료 |
|------|------|------|
| 1.5h | 이론: 3-Tier 아키텍처, OAuth 2.0, RabbitMQ를 학습한다. | [BLOG/11-demo-apps.md](BLOG/11-demo-apps.md) |
| 30m | 심화: 데모 앱과 HPA 설정을 상세히 분석한다. | [EDU/07-demo-apps.md](EDU/07-demo-apps.md) (전반부) |

**학습 목표**: 마이크로서비스 아키텍처 패턴을 이해하는 것이다. Keycloak을 통한 인증 통합이 어떻게 동작하는지 파악해야 한다.

#### Day 22 (2h) — 부하 테스트 이론
| 시간 | 활동 | 자료 |
|------|------|------|
| 1.5h | 이론: k6, VU(Virtual Users), p95/p99, RPS, SLA를 학습한다. | [BLOG/13-load-testing.md](BLOG/13-load-testing.md) |
| 30m | 심화: stress-ng와 Cascade 시나리오를 학습한다. | [EDU/07-demo-apps.md](EDU/07-demo-apps.md) (후반부) |

**학습 목표**: 부하 테스트를 설계하는 방법을 이해하는 것이다. p95/p99 같은 성능 지표를 해석하고 SLA 기준을 정할 수 있어야 한다.

#### Day 23 (2h) — 부하 테스트 실습
| 시간 | 활동 | 자료 |
|------|------|------|
| 2h | 실습: 16개 시나리오 중 주요 시나리오를 직접 실행한다. | [GUIDE/07-testing-scenarios.md](GUIDE/07-testing-scenarios.md) |

**학습 목표**: k6 스크립트를 작성하고 실행하는 것이다. HPA가 부하에 반응하여 스케일링되는 과정을 실시간으로 관찰해야 한다.

#### Day 24 (2h) — 트러블슈팅
| 시간 | 활동 | 자료 |
|------|------|------|
| 1h | 이론: 6단계 디버깅 방법론과 레이어별 체크리스트를 학습한다. | [BLOG/14-troubleshooting.md](BLOG/14-troubleshooting.md) |
| 1h | 실습: 계층별 문제 진단을 직접 수행한다. | [GUIDE/08-troubleshooting.md](GUIDE/08-troubleshooting.md) |

**학습 목표**: 체계적인 디버깅 방법론을 익히는 것이다. Postmortem 문서를 작성하는 방법도 알아야 한다.

#### Day 25 (2h) — 5주차 복습
| 시간 | 활동 | 자료 |
|------|------|------|
| 1h | 복습: 앱 배포 → 부하 테스트 → 스케일링 → 장애 대응의 전체 흐름을 정리한다. | 5주차 전체 자료 |
| 1h | 실습: Pod를 삭제하여 장애를 시뮬레이션하고 복구 과정을 관찰한다. | [GUIDE/07-testing-scenarios.md](GUIDE/07-testing-scenarios.md) |

**학습 목표**: 운영 시나리오별로 대응할 수 있는 능력을 확보하는 것이다.

---

### 6주차: 보안 심화 & 운영 안정성

#### Day 26 (2h) — 시크릿 관리 & RBAC
| 시간 | 활동 | 자료 |
|------|------|------|
| 1h | 이론+실습: Sealed Secrets로 시크릿을 암호화하고 Git에 저장하는 흐름을 학습한다. | [GUIDE/10-security-secrets.md](GUIDE/10-security-secrets.md) (1~2장) |
| 1h | 실습: RBAC 커스텀 역할을 확인하고, 권한 테스트를 수행한다. | [GUIDE/10-security-secrets.md](GUIDE/10-security-secrets.md) (2장) |

**학습 목표**: K8s Secret의 한계를 이해하고 Sealed Secrets로 해결하는 방법을 아는 것이다. RBAC으로 최소 권한 원칙을 적용할 수 있어야 한다.

#### Day 27 (2h) — OPA Gatekeeper 정책 강제
| 시간 | 활동 | 자료 |
|------|------|------|
| 1h | 이론: ConstraintTemplate과 Constraint의 구조, Rego 정책 언어를 학습한다. | [GUIDE/10-security-secrets.md](GUIDE/10-security-secrets.md) (3장) |
| 1h | 실습: 정책 위반 테스트 — 특권 컨테이너 차단, 라벨 누락 경고를 직접 확인한다. | [manifests/gatekeeper/](manifests/gatekeeper/) |

**학습 목표**: Admission Webhook 기반 정책 강제가 어떻게 동작하는지 이해하는 것이다. warn과 deny의 차이를 설명할 수 있어야 한다.

#### Day 28 (2h) — 백업 & 재해 복구
| 시간 | 활동 | 자료 |
|------|------|------|
| 1h | 이론: etcd 스냅샷과 Velero의 백업 전략(3계층 방어)을 학습한다. | [GUIDE/11-backup-dr.md](GUIDE/11-backup-dr.md) (1~2장) |
| 1h | 실습: etcd 백업 실행, Velero 스케줄 확인, 복원 절차를 따라해본다. | [GUIDE/11-backup-dr.md](GUIDE/11-backup-dr.md) (3장) |

**학습 목표**: etcd가 클러스터에서 차지하는 역할을 이해하는 것이다. 장애 유형별 복원 방법을 구분할 수 있어야 한다.

#### Day 29 (2h) — 리소스 관리 & Harbor
| 시간 | 활동 | 자료 |
|------|------|------|
| 1h | 이론+실습: ResourceQuota와 LimitRange로 리소스를 제한하고 기본값을 적용한다. | [GUIDE/12-resource-management.md](GUIDE/12-resource-management.md) (1~2장) |
| 1h | 실습: Harbor에 이미지를 Push하고, Trivy 취약점 스캔 결과를 확인한다. | [GUIDE/12-resource-management.md](GUIDE/12-resource-management.md) (3장) |

**학습 목표**: 환경별 차등 리소스 정책의 필요성을 이해하는 것이다. 프라이빗 레지스트리로 이미지 공급망을 통제할 수 있어야 한다.

#### Day 30 (2h) — 6주차 복습 + 보안 통합 검증
| 시간 | 활동 | 자료 |
|------|------|------|
| 1h | 실습: Phase 13~17 전체 검증 스크립트를 실행한다. | [GUIDE/04-cluster-verification.md](GUIDE/04-cluster-verification.md) (7~11장) |
| 1h | 복습: 보안 체크리스트를 작성하고, 전체 방어 계층을 정리한다. | 6주차 전체 자료 |

**학습 목표**: 네트워크 보안(Cilium) → 서비스 메시(Istio mTLS) → 시크릿(Sealed Secrets) → 접근 제어(RBAC) → 정책(Gatekeeper) → 리소스(Quotas) → 이미지(Harbor)의 전체 보안 스택을 설명할 수 있어야 한다.

---

### 7주차: 통합 & 마무리

#### Day 31 (2h) — 전체 정리
| 시간 | 활동 | 자료 |
|------|------|------|
| 2h | 학습: Day 0/1/2 운영 개념, 커리어 패스, 치트시트를 정리한다. | [BLOG/15-putting-it-all-together.md](BLOG/15-putting-it-all-together.md) |

**학습 목표**: 인프라 엔지니어의 역할별 Day 0/1/2 업무를 이해하는 것이다. 앞으로의 성장 로드맵을 파악해야 한다.

#### Day 32 (2h) — 코드 수정 가이드
| 시간 | 활동 | 자료 |
|------|------|------|
| 1h | 학습: 새 클러스터, 앱, 기능을 추가하는 방법을 익힌다. | [EDU/08-how-to-modify.md](EDU/08-how-to-modify.md) |
| 1h | 학습: 전체 기술 스택 레퍼런스를 확인한다. | [EDU/09-tech-stack.md](EDU/09-tech-stack.md) |

**학습 목표**: 프로젝트를 직접 확장할 수 있는 능력을 갖추는 것이다. 기술 스택의 전체 버전과 포트 정보를 파악해야 한다.

#### Day 33 (2h) — 처음부터 끝까지 구축 (1)
| 시간 | 활동 | 자료 |
|------|------|------|
| 2h | 통합 실습: 클린 환경에서 demo.sh로 전체 인프라 구축을 시작한다. | [GUIDE/02-quick-start.md](GUIDE/02-quick-start.md) + [GUIDE/03-phase-by-phase.md](GUIDE/03-phase-by-phase.md) |

**학습 목표**: 전체 파이프라인을 처음부터 혼자서 구축하는 것이다. 이전에 배운 모든 지식을 종합적으로 활용해야 한다.

#### Day 34 (2h) — 처음부터 끝까지 구축 (2)
| 시간 | 활동 | 자료 |
|------|------|------|
| 2h | 통합 실습: 클러스터 검증, 대시보드 설치, 부하 테스트까지 완료한다. | [GUIDE/04-cluster-verification.md](GUIDE/04-cluster-verification.md) ~ [GUIDE/07-testing-scenarios.md](GUIDE/07-testing-scenarios.md) |

**학습 목표**: 구축 → 검증 → 운영의 전체 사이클을 끝까지 완주하는 것이다.

#### Day 35 (2h) — 최종 복습 & 정리
| 시간 | 활동 | 자료 |
|------|------|------|
| 1h | 복습: 전체 아키텍처 다이어그램을 직접 그려본다. | 전체 자료 |
| 1h | 정리: 부족한 부분을 보충하고 나만의 치트시트를 작성한다. | 자유 |

**학습 목표**: 전체 스택을 다른 사람에게 설명할 수 있는 수준에 도달하는 것이다.

---

## 학습 자료 매핑 — 언제 무엇을 읽는가

| 자료 | 총 분량(추정) | 학습 시점 | 용도 |
|------|-------------|----------|------|
| [BLOG/01](BLOG/01-introduction.md)~[03](BLOG/03-containers-and-kubernetes.md) | 3.5h | Day 1~3 | 기초 이론이다. |
| [BLOG/04](BLOG/04-networking.md), [08](BLOG/08-network-security.md), [10](BLOG/10-service-mesh.md) | 5.5h | Day 6~9 | 네트워크/보안 이론이다. |
| [BLOG/05](BLOG/05-monitoring.md)~[06](BLOG/06-iac-automation.md) | 3.5h | Day 11~13 | 모니터링/IaC 이론이다. |
| [BLOG/07](BLOG/07-cicd-pipeline.md), [09](BLOG/09-autoscaling.md), [12](BLOG/12-sre-dashboard.md) | 4.5h | Day 16~19 | CI/CD, 스케일링, 대시보드 이론이다. |
| [BLOG/11](BLOG/11-demo-apps.md), [13](BLOG/13-load-testing.md)~[15](BLOG/15-putting-it-all-together.md) | 7h | Day 21~31 | 앱, 테스트, 트러블슈팅, 정리이다. |
| [EDU/01](EDU/01-project-overview.md)~[03](EDU/03-kubernetes-setup.md) | 1.5h | Day 1~3 | 기초 심화이다. |
| [EDU/04](EDU/04-networking.md)~[05](EDU/05-monitoring.md) | 2h | Day 6~12 | 네트워크/모니터링 심화이다. |
| [EDU/06](EDU/06-dashboard.md)~[07](EDU/07-demo-apps.md) | 2h | Day 19~22 | 대시보드/앱 심화이다. |
| [EDU/08](EDU/08-how-to-modify.md)~[09](EDU/09-tech-stack.md) | 2h | Day 32 | 확장/레퍼런스이다. |
| [GUIDE/00](GUIDE/00-prerequisites.md)~[04](GUIDE/04-cluster-verification.md) | 5h | Day 1~5 | 환경 구축 실습이다. |
| [GUIDE/05](GUIDE/05-dashboard-guide.md)~[09](GUIDE/09-terraform-alternative.md) | 8h | Day 12~25 | 운영, 테스트, 대안 실습이다. |
| [GUIDE/10](GUIDE/10-security-secrets.md)~[12](GUIDE/12-resource-management.md) | 5h | Day 26~30 | 보안, 백업, 리소스 관리 실습이다. |

> 위 분량은 해당 자료에 실제 배정된 시간의 합계이다. 이해 속도에 따라 달라질 수 있다.

---

## 난이도별 학습 팁

### 쉬움 (1주차 ~ 2주차 전반)
- BLOG 글을 천천히 읽으며 **용어에 익숙해지는 것**이 핵심이다.
- 모르는 용어가 나오면 바로 검색하지 말고, 일단 맥락으로 파악한다. 이후 EDU 자료에서 보충하면 된다.

### 보통 (2주차 후반 ~ 4주차)
- Terraform과 CI/CD는 **직접 코드를 읽으며** 이해해야 한다.
- [manifests/](manifests/)와 [terraform/](terraform/) 디렉토리의 실제 파일을 함께 열어보는 것이 중요하다.

### 어려움 (5~6주차)
- 부하 테스트와 트러블슈팅은 **실습 중심**으로 학습해야 한다.
- 장애를 일부러 만들어보고 복구하는 연습이 가장 효과적이다.
- 6주차의 보안 스택은 **개념 간 연결**이 중요하다. 각 컴포넌트가 어떤 위협을 방어하는지 매핑해야 한다.

---

## 체크리스트 — 주차별 자가 평가

### 1주차 완료 시 답할 수 있어야 하는 질문이다.
- [ ] VM과 컨테이너의 차이를 설명할 수 있는가?
- [ ] Pod, Deployment, Service의 관계를 설명할 수 있는가?
- [ ] kubectl로 클러스터 상태를 확인할 수 있는가?

### 2주차 완료 시 답할 수 있어야 하는 질문이다.
- [ ] Cilium이 kube-proxy를 대체하는 이유를 설명할 수 있는가?
- [ ] 제로 트러스트 네트워크 정책을 작성할 수 있는가?
- [ ] mTLS가 무엇이고 왜 필요한지 설명할 수 있는가?

### 3주차 완료 시 답할 수 있어야 하는 질문이다.
- [ ] Prometheus의 Pull 모델을 설명할 수 있는가?
- [ ] Terraform의 멱등성이 왜 중요한지 설명할 수 있는가?
- [ ] terraform plan 결과를 읽고 해석할 수 있는가?

### 4주차 완료 시 답할 수 있어야 하는 질문이다.
- [ ] Jenkins 파이프라인 7단계를 나열할 수 있는가?
- [ ] GitOps의 핵심 원칙을 설명할 수 있는가?
- [ ] HPA 스케일링 공식을 설명할 수 있는가?

### 5주차 완료 시 답할 수 있어야 하는 질문이다.
- [ ] k6로 부하 테스트 스크립트를 작성할 수 있는가?
- [ ] p95/p99의 의미를 설명할 수 있는가?
- [ ] 장애 발생 시 체계적으로 디버깅할 수 있는가?

### 6주차 완료 시 답할 수 있어야 하는 질문이다.
- [ ] Sealed Secrets의 암호화/복호화 흐름을 설명할 수 있는가?
- [ ] RBAC에서 ClusterRole과 Role의 차이를 설명할 수 있는가?
- [ ] OPA Gatekeeper의 ConstraintTemplate을 작성할 수 있는가?
- [ ] etcd 백업에서 복원까지의 절차를 수행할 수 있는가?
- [ ] ResourceQuota가 초과되었을 때 어떤 일이 발생하는지 아는가?
- [ ] Harbor에 이미지를 Push하고 K8s에서 사용할 수 있는가?

### 7주차 완료 시 답할 수 있어야 하는 질문이다.
- [ ] 전체 인프라를 처음부터 혼자 구축할 수 있는가?
- [ ] 전체 아키텍처를 그림으로 설명할 수 있는가?
- [ ] Day 0/1/2 운영 업무를 구분해서 설명할 수 있는가?
- [ ] 17단계 파이프라인 전체를 순서와 이유를 포함하여 설명할 수 있는가?
