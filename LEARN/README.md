# LEARN — tart-infra 프로젝트 학습 가이드

> 이 디렉토리는 **tart-infra 프로젝트를 이해하기 위한 학습 자료**이다.
> 기초 개념부터 심화 내용까지 하나의 흐름으로 학습할 수 있도록 구성되어 있다.

---

## 학습 계획

**[STUDY_PLAN.md](STUDY_PLAN.md)** — 5주(25일) 프로젝트 학습 로드맵

| 주차 | 주제 | 기간 |
|------|------|------|
| 1주차 | 기초 (VM, 컨테이너, K8s) | Day 1~5 |
| 2주차 | 네트워크 & 보안 | Day 6~10 |
| 3주차 | 모니터링, IaC, CI/CD | Day 11~15 |
| 4주차 | 앱 운영 & 부하 테스트 | Day 16~20 |
| 5주차 | 보안 심화 & 통합 실습 | Day 21~25 |

---

## 문서 목차

| 번호 | 파일 | 내용 |
|------|------|------|
| 01 | [01-project-overview.md](01-project-overview.md) | 프로젝트 전체 구조, 아키텍처, 클러스터 구성 |
| 02 | [02-infrastructure.md](02-infrastructure.md) | 가상화 개념, Tart VM, Golden Image, Terraform |
| 03 | [03-kubernetes-setup.md](03-kubernetes-setup.md) | 컨테이너, K8s 기초, 설치 파이프라인 |
| 04 | [04-networking.md](04-networking.md) | CNI, Cilium, 네트워크 보안, 서비스 메시(Istio) |
| 05 | [05-monitoring.md](05-monitoring.md) | 옵저버빌리티, Prometheus, Grafana, Loki |
| 06 | [06-iac-automation.md](06-iac-automation.md) | Infrastructure as Code, Bash vs Terraform |
| 07 | [07-cicd-pipeline.md](07-cicd-pipeline.md) | CI/CD, Jenkins, ArgoCD, GitOps |
| 08 | [08-autoscaling.md](08-autoscaling.md) | HPA, PDB, metrics-server |
| 09 | [09-demo-apps.md](09-demo-apps.md) | 데모 앱, 3-Tier, OAuth 2.0, RabbitMQ |
| 10 | [10-dashboard.md](10-dashboard.md) | SRE 대시보드, React + Express |
| 11 | [11-load-testing.md](11-load-testing.md) | 부하 테스트, k6, p95/p99 |
| 12 | [12-troubleshooting.md](12-troubleshooting.md) | 트러블슈팅, 6단계 디버깅 |
| 13 | [13-summary.md](13-summary.md) | 전체 정리, Day 0/1/2 운영 |
| 14 | [14-how-to-modify.md](14-how-to-modify.md) | 코드 수정 가이드 |
| 15 | [15-tech-stack.md](15-tech-stack.md) | 기술 스택 레퍼런스 |

---

## 실습

실습은 [guide/](guide/) 디렉토리에서 단계별로 진행한다.

---

## 읽는 순서

처음이라면 **01 → 02 → 03** 순서로 읽는다.
특정 부분만 수정하고 싶다면 **14번(코드 수정 가이드)**를 먼저 본다.
전체 학습 계획을 따라가려면 **[STUDY_PLAN.md](STUDY_PLAN.md)**를 참고한다.

```
기초              네트워크/보안     운영 인프라        앱/테스트         보안/마무리
01 → 02 → 03 → 04 → 05 → 06 → 07 → 08 → 09 → 10 → 11 → 12 → 13
                                                                   │
                                                            14 (수정) + 15 (레퍼런스)
```
