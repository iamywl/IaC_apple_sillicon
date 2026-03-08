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

## 읽는 순서

처음이라면 01 → 02 → 03 순서로 읽으세요.
특정 부분만 수정하고 싶다면 08번 문서를 먼저 보세요.
