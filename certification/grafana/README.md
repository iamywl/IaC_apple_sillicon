# Grafana - 메트릭 시각화 대시보드 학습 가이드

Grafana의 아키텍처, 데이터소스, 대시보드, 알림, 운영까지 7일간 체계적으로 학습하는 가이드이다.

---

## 학습 일정

| Day | 주제 | 파일 | 주요 내용 |
|-----|------|------|----------|
| 1 | 개념 및 아키텍처 심화 | [day01-concepts-and-architecture.md](day01-concepts-and-architecture.md) | Grafana 기본 개념, 핵심 용어, 실습 환경, Frontend/Backend/Database/Plugin/Provisioning 아키텍처 |
| 2 | Data Source 및 Dashboard 설계 | [day02-datasource-and-dashboard.md](day02-datasource-and-dashboard.md) | Data Source 연동 심화, Dashboard JSON Model, Variable 시스템, Annotation, 레이아웃 설계 |
| 3 | Panel 타입 및 쿼리 언어 | [day03-panel-and-query-languages.md](day03-panel-and-query-languages.md) | Panel 타입별 활용(Time series, Stat, Gauge, Table 등), PromQL in Grafana, LogQL in Grafana |
| 4 | Alerting 및 Provisioning 심화 | [day04-alerting-and-provisioning.md](day04-alerting-and-provisioning.md) | Unified Alerting(Grafana 9+) 구조, Alert Rule/Contact Point/Notification Policy, Provisioning 자동화 |
| 5 | 인증/권한, GaC, 성능, 플러그인 | [day05-auth-code-performance-plugin.md](day05-auth-code-performance-plugin.md) | RBAC/OAuth/LDAP 인증, Grafana as Code(Terraform, Grizzly), 성능 최적화, 플러그인 개발 |
| 6 | 고가용성, 트러블슈팅, 실전 대시보드 | [day06-ha-troubleshooting-dashboards.md](day06-ha-troubleshooting-dashboards.md) | HA 구성, 트러블슈팅 가이드, 실전 대시보드 설계 패턴 |
| 7 | Transformations, 실습, 자가 점검 | [day07-transformations-and-practice.md](day07-transformations-and-practice.md) | 데이터 변환(Transformations), 실습 과제, 예제 시나리오, 자가 점검 문제, 참고문헌 |

---

## 학습 방법

1. 각 Day 파일을 순서대로 읽으며 개념을 이해한다
2. 코드 블록과 설정 예시는 실습 환경에서 직접 실행해 본다
3. Day 7의 실습 과제와 자가 점검으로 이해도를 확인한다

## 실습 환경

- 클러스터: platform (`kubeconfig/platform.yaml`)
- 설치 스크립트: `scripts/install/07-install-monitoring.sh`
- Grafana 접근: NodePort 30300 또는 `kubectl port-forward -n monitoring svc/kube-prometheus-stack-grafana 3000:80`
- 기본 계정: admin / admin
