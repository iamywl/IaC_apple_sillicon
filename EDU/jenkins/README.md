# Jenkins - CI 서버 학습 가이드

Jenkins 학습 자료를 8일 과정으로 구성한 스터디 가이드이다. 각 Day별 파일에서 해당 주제를 학습할 수 있다.

---

## 학습 일정

| Day | 주제 | 파일 | 핵심 내용 |
|-----|------|------|-----------|
| 1 | Jenkins 개념과 아키텍처 | [day01-concepts-and-architecture.md](day01-concepts-and-architecture.md) | 기본 개념, CI/CD 용어, Controller-Agent 아키텍처, 실습 환경 |
| 2 | Pipeline과 Groovy | [day02-pipeline-and-groovy.md](day02-pipeline-and-groovy.md) | Pipeline 유형, Declarative Pipeline 문법, Groovy 심화 |
| 3 | Shared Libraries, K8s 플러그인, Agent | [day03-shared-libraries-k8s-plugin-agent.md](day03-shared-libraries-k8s-plugin-agent.md) | Shared Libraries, Kubernetes 동적 Agent, Agent 관리 |
| 4 | Credentials, Multibranch, Triggers, Artifact | [day04-credentials-multibranch-triggers-artifacts.md](day04-credentials-multibranch-triggers-artifacts.md) | Credentials 관리, Multibranch Pipeline, Build Triggers, Artifact, 테스트 통합 |
| 5 | 보안, 성능 튜닝, 고가용성 | [day05-security-performance-ha.md](day05-security-performance-ha.md) | CSRF/RBAC/API Token 보안, JVM 성능 튜닝, HA 구성 |
| 6 | 모니터링, JCasC, 트러블슈팅 | [day06-monitoring-jcasc-troubleshooting.md](day06-monitoring-jcasc-troubleshooting.md) | Prometheus 모니터링, Configuration as Code, 트러블슈팅 |
| 7 | 실전 파이프라인과 실습 | [day07-real-world-pipelines-and-practice.md](day07-real-world-pipelines-and-practice.md) | 실전 파이프라인 예제, GitOps 연동, 실습 과제 |
| 8 | 예제, API, CLI, 베스트 프랙티스 | [day08-examples-api-cli-bestpractices.md](day08-examples-api-cli-bestpractices.md) | 예제 모음, REST API, CLI, 베스트 프랙티스, 자가 점검 |

---

## 학습 방법

1. Day 1부터 순서대로 학습한다
2. 각 Day 파일의 코드 예제를 직접 실행해본다
3. Day 7의 실습 과제를 수행한다
4. Day 8의 자가 점검 문제로 이해도를 확인한다

## 원본 구성

이 학습 자료는 원래 하나의 문서(약 5,062줄)로 작성되었으며, 학습 효율을 위해 일별 파일로 분리하였다.
