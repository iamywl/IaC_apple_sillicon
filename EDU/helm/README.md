# Helm - Kubernetes 패키지 매니저 학습 가이드

Helm 학습 자료를 8일 과정으로 구성한 스터디 가이드이다. 각 Day별 파일에서 해당 주제를 학습할 수 있다.

---

## 학습 일정

| Day | 주제 | 파일 | 핵심 내용 |
|-----|------|------|-----------|
| 1 | Helm 개요와 아키텍처 | [day01-overview-and-architecture.md](day01-overview-and-architecture.md) | Helm 기본 개념, Helm 2→3 아키텍처 변화, Release 저장 메커니즘, 3-Way Merge, 실습 환경 |
| 2 | Chart 구조와 Go Template | [day02-chart-structure-and-go-template.md](day02-chart-structure-and-go-template.md) | Chart 디렉토리 구조, Chart.yaml/values.yaml 상세, Go Template 심화 문법 |
| 3 | Template 함수와 Named Templates | [day03-template-functions-and-named-templates.md](day03-template-functions-and-named-templates.md) | Template 함수 레퍼런스, _helpers.tpl, Named Template 패턴 |
| 4 | Values, Dependencies, Hooks | [day04-values-dependencies-hooks.md](day04-values-dependencies-hooks.md) | Values 계층적 관리, Chart 의존성 관리, Helm Hook 생명주기 |
| 5 | Tests, Repository, Plugins, 보안 | [day05-tests-repository-plugins-security.md](day05-tests-repository-plugins-security.md) | Chart 테스트, Chart Repository/OCI Registry, Helm 플러그인, 보안 |
| 6 | CI/CD, 베스트 프랙티스, Library Charts, 성능 | [day06-cicd-bestpractices-library-performance.md](day06-cicd-bestpractices-library-performance.md) | CI/CD 연동, Chart 개발 규칙, Library Chart 패턴, 성능/트러블슈팅 |
| 7 | Release 생명주기와 실전 시나리오 | [day07-release-lifecycle-and-practice.md](day07-release-lifecycle-and-practice.md) | Release 관리, 실전 시나리오, 환경 변수, 배포 흐름, 실습 |
| 8 | 예제, 자가 점검, 부록 | [day08-examples-review-appendix.md](day08-examples-review-appendix.md) | 실전 예제 모음, 자가 점검, 명령어 참조, Values 전체 참조 |

---

## 학습 방법

1. Day 1부터 순서대로 학습한다
2. 각 Day 파일의 코드 예제를 직접 실행해본다
3. Day 7의 실습 과제를 수행한다
4. Day 8의 자가 점검 문제로 이해도를 확인한다

## 원본 구성

이 학습 자료는 원래 하나의 문서(약 4,666줄)로 작성되었으며, 학습 효율을 위해 일별 파일로 분리하였다.
