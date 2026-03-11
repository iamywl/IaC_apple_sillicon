# EDU - 프로젝트 학습 가이드

이 디렉토리는 tart-infra 프로젝트의 전체 구조와 동작 방식을 설명합니다.
누구나 이 문서를 읽고 코드를 이해하고 수정할 수 있도록 작성되었습니다.

## 문서 목차

| 번호 | 파일 | 내용 |
|------|------|------|
| 01 | [01-project-overview.md](01-project-overview.md) | 프로젝트 전체 구조와 아키텍처 개요 |
| 02 | [02-infrastructure.md](02-infrastructure.md) | Tart VM + Terraform 인프라 계층 |
| 03 | [03-kubernetes-setup.md](03-kubernetes-setup.md) | 12단계 설치 스크립트와 K8s 클러스터 구성 |
| 04 | [04-networking.md](04-networking.md) | Cilium CNI, Hubble, Istio, 네트워크 정책 |
| 05 | [05-monitoring.md](05-monitoring.md) | Prometheus, Grafana, Loki, AlertManager |
| 06 | [06-dashboard.md](06-dashboard.md) | SRE 대시보드 (React + Express) 구조와 API |
| 07 | [07-demo-apps.md](07-demo-apps.md) | 데모 앱, HPA, 부하 테스트, 스트레스 테스트 |
| 08 | [08-how-to-modify.md](08-how-to-modify.md) | 코드 수정 가이드 - 새 클러스터/앱/기능 추가 방법 |
| 09 | [09-tech-stack.md](09-tech-stack.md) | 전체 기술 스택 상세 (버전, 설정, 포트 총정리) |

## 읽는 순서

처음이라면 01 → 02 → 03 순서로 읽으세요.
특정 부분만 수정하고 싶다면 08번 문서를 먼저 보세요.

## `doc/` 디렉토리와의 관계

프로젝트 루트의 `doc/` 디렉토리에는 설계 의도, 아키텍처 결정 기록(ADR), 트러블슈팅 기록 등 **참고 자료**가 있습니다.

| 디렉토리 | 성격 | 대상 |
|----------|------|------|
| **EDU/** | 단계별 학습 가이드 | 프로젝트를 처음 접하는 사람 |
| **doc/analysis/** | 프로젝트 분석 (아키텍처 결정, 데이터 플로우 등) | 설계 배경을 깊이 이해하고 싶을 때 |
| **doc/learning/** | 기술 학습 (IaC, 네트워킹, 모니터링 개념) | 관련 기술의 배경 지식이 필요할 때 |
| **doc/bug-reports/** | 버그 리포트 및 해결 기록 | 유사한 문제를 만났을 때 |
