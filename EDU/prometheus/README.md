# Prometheus - 메트릭 수집 및 저장 학습 가이드

Prometheus의 아키텍처, PromQL, TSDB, Alerting, Operator, 운영까지 8일간 체계적으로 학습하는 가이드이다.

---

## 학습 일정

| Day | 주제 | 파일 | 주요 내용 |
|-----|------|------|----------|
| 1 | 개념, 아키텍처, 데이터 모델 | [day01-concepts-architecture-datamodel.md](day01-concepts-architecture-datamodel.md) | 기본 개념, 메트릭 유형(Counter/Gauge/Histogram/Summary), 실습 환경, 내부 아키텍처 컴포넌트, 시계열 데이터 모델 심화 |
| 2 | PromQL 완전 가이드 | [day02-promql-guide.md](day02-promql-guide.md) | PromQL 데이터 타입, 셀렉터, 연산자, 집계 함수, 내장 함수, 서브쿼리 |
| 3 | Pull 모델, Service Discovery, TSDB | [day03-pull-discovery-tsdb.md](day03-pull-discovery-tsdb.md) | Pull 기반 수집, Kubernetes Service Discovery, TSDB WAL/블록/컴팩션/인덱스 구조 |
| 4 | Recording Rules, Alerting Rules, Storage | [day04-rules-and-storage.md](day04-rules-and-storage.md) | Recording Rule 사전 계산, Alerting Rule과 Alertmanager 연동, Remote Write/Read, Storage 심화 |
| 5 | Federation, Push Gateway, Exporters, Instrumentation | [day05-federation-exporters-instrumentation.md](day05-federation-exporters-instrumentation.md) | Federation 구성, Push Gateway, 주요 Exporter 심화, 애플리케이션 계측 |
| 6 | Operator, 성능 튜닝, 보안 | [day06-operator-tuning-security.md](day06-operator-tuning-security.md) | Prometheus Operator/CRD, 카디널리티 관리, 메모리 최적화, TLS/인증/RBAC |
| 7 | 트러블슈팅 및 실전 시나리오 | [day07-troubleshooting-and-scenarios.md](day07-troubleshooting-and-scenarios.md) | 문제 진단/해결, SLO 모니터링, 카나리 배포 메트릭, 멀티클러스터 |
| 8 | 실습, 예제, 자가 점검 | [day08-practice-and-review.md](day08-practice-and-review.md) | 실습 과제, 예제 시나리오, 자가 점검 문제, 참고문헌 |

---

## 학습 방법

1. 각 Day 파일을 순서대로 읽으며 개념을 이해한다
2. 코드 블록과 설정 예시는 실습 환경에서 직접 실행해 본다
3. Day 8의 실습 과제와 자가 점검으로 이해도를 확인한다

## 실습 환경

- 클러스터: platform (`kubeconfig/platform.yaml`)
- 설치 스크립트: `scripts/install/07-install-monitoring.sh`
- Helm Chart: `kube-prometheus-stack`
- Prometheus 접근: `kubectl port-forward -n monitoring svc/kube-prometheus-stack-prometheus 9090:9090`
- Alertmanager: NodePort 30903
- 데이터 보존: 7일, PVC 10GB
