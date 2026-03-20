# Terraform - Infrastructure as Code 학습 가이드

Terraform 학습 자료를 8일 과정으로 구성한 스터디 가이드이다. 각 Day별 파일에서 해당 주제를 학습할 수 있다.

---

## 학습 일정

| Day | 주제 | 파일 | 핵심 내용 |
|-----|------|------|-----------|
| 1 | IaC 기초와 실습 환경 | [day01-iac-basics-and-lab.md](day01-iac-basics-and-lab.md) | IaC 개념, 선언적 vs 명령형, 멱등성, Drift Detection, 핵심 개념, 실습 환경 |
| 2 | 아키텍처와 HCL 심화 | [day02-architecture-and-hcl.md](day02-architecture-and-hcl.md) | Core 내부 구조, Provider 동작, DAG 실행 엔진, HCL 표현식/조건/for/Dynamic Block |
| 3 | Provider와 Resource 심화 | [day03-provider-and-resource.md](day03-provider-and-resource.md) | Provider 설정/Alias, Resource Lifecycle, Precondition/Postcondition, Provisioners, count vs for_each |
| 4 | Data Sources와 State 심화 | [day04-data-sources-and-state.md](day04-data-sources-and-state.md) | Data Source, external Data Source, Remote Backend, State Locking/보안/조작 |
| 5 | Module, Variables, Functions | [day05-module-variables-functions.md](day05-module-variables-functions.md) | Module 설계/소스/Composition, Variable 타입/검증, Output, 내장 함수 레퍼런스 |
| 6 | Workspaces, Import, Testing | [day06-workspaces-import-testing.md](day06-workspaces-import-testing.md) | CLI/Cloud Workspaces, terraform import, moved 블록, terraform test, Terratest |
| 7 | CI/CD, 보안, 성능, 트러블슈팅 | [day07-cicd-security-performance-troubleshooting.md](day07-cicd-security-performance-troubleshooting.md) | GitHub Actions/Atlantis, Secrets/OIDC, Policy as Code, 성능 최적화, 트러블슈팅 |
| 8 | 실전 패턴, 실습, 자가 점검 | [day08-patterns-practice-review.md](day08-patterns-practice-review.md) | Multi-Environment, Zero-Downtime 배포, 실습 가이드, 자가 점검, 참고문헌 |

---

## 학습 방법

1. Day 1부터 순서대로 학습한다
2. 각 Day 파일의 코드 예제를 직접 실행해본다
3. Day 8의 실습 가이드를 수행한다
4. Day 8의 자가 점검 문제로 이해도를 확인한다

## 원본 구성

이 학습 자료는 원래 하나의 문서(약 5,227줄)로 작성되었으며, 학습 효율을 위해 일별 파일로 분리하였다.
