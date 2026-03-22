# tart-infra 프로젝트 분석 문서

이 디렉토리는 **tart-infra 프로젝트를 처음 접하는 사람**이 빠르게 이해할 수 있도록 작성된 분석 문서 모음입니다.

전체 코드를 다 읽지 않아도, 이 문서들을 순서대로 읽으면 프로젝트의 구조, 설계 의도, 그리고 실제 작업 시 어디부터 봐야 하는지 알 수 있습니다.

---

## 문서 목록과 읽는 순서

| 순서 | 문서 | 내용 | 소요 시간 |
|------|------|------|-----------|
| 1 | [01-project-overview.md](01-project-overview.md) | 프로젝트가 뭔지, 디렉토리 구조, 클러스터 구성 | 10분 |
| 2 | [02-architecture-decisions.md](02-architecture-decisions.md) | 왜 이런 기술을 선택했는지 (8가지 핵심 결정) | 15분 |
| 3 | [03-opensource-tools.md](03-opensource-tools.md) | 사용된 오픈소스 도구 16개의 역할과 선택 이유 | 15분 |
| 4 | [04-code-navigation-guide.md](04-code-navigation-guide.md) | 실무에서 코드를 탐색하는 방법 (시나리오별 가이드) | 15분 |
| 5 | [05-data-flow.md](05-data-flow.md) | 데이터가 어떻게 흘러가는지 (설치/부팅/모니터링/알림) | 10분 |

---

## 누가 읽으면 좋은가

- 이 프로젝트에 처음 합류한 사람
- Kubernetes 인프라에 관심은 있지만 실제 구축 경험이 없는 사람
- 코드를 수정하거나 기능을 추가해야 하는데 어디부터 봐야 할지 모르는 사람
- 프로젝트의 설계 의도와 기술 선택 배경을 알고 싶은 사람

## 읽기 전 권장 사전 지식

- Linux 기본 명령어 (ssh, grep, vim 등)
- Kubernetes 기초 개념 (Pod, Service, Node, Namespace)
- Docker 또는 컨테이너 기본 개념
- Helm chart가 뭔지 대략적인 이해

> 위 지식이 없어도 각 문서에서 필요한 배경은 간략히 설명합니다.
