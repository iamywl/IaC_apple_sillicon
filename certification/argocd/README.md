# ArgoCD - GitOps CD 학습 가이드

ArgoCD 학습 자료를 9일 과정으로 구성한 스터디 가이드이다. 각 Day별 파일에서 해당 주제를 학습할 수 있다.

---

## 학습 일정

| Day | 주제 | 파일 | 핵심 내용 |
|-----|------|------|-----------|
| 1 | GitOps 원칙과 ArgoCD 개념 | [day01-gitops-and-concepts.md](day01-gitops-and-concepts.md) | 기본 개념, GitOps 4대 원칙, Push vs Pull 모델, 실습 환경 |
| 2 | ArgoCD 아키텍처 상세 | [day02-architecture.md](day02-architecture.md) | API Server, Repo Server, Controller, Redis, Dex, 데이터 흐름 |
| 3 | Application CRD와 Sync 메커니즘 | [day03-application-crd-and-sync.md](day03-application-crd-and-sync.md) | Application 스펙, Source/Destination, Sync Policy, Sync Wave, Hook |
| 4 | Health 체크와 Diff 전략 | [day04-health-check-and-diff.md](day04-health-check-and-diff.md) | Health Check 로직, Custom Health(Lua), Diff 전략, Diff 커스터마이징 |
| 5 | ApplicationSet과 Multi-Cluster | [day05-applicationset-and-multi-cluster.md](day05-applicationset-and-multi-cluster.md) | Generator 유형, 템플릿 기반 대량 생성, Multi-Cluster 관리 |
| 6 | SSO & RBAC, Notifications, Image Updater | [day06-sso-rbac-notifications-image-updater.md](day06-sso-rbac-notifications-image-updater.md) | Dex SSO, RBAC 정책, Slack/Email 알림, Image Updater |
| 7 | Secrets, 성능 최적화, 보안 강화 | [day07-secrets-performance-security.md](day07-secrets-performance-security.md) | Sealed Secrets, ESO, Vault, 캐싱/Sharding, TLS/RBAC/감사 로그 |
| 8 | Helm/Kustomize, 트러블슈팅, 실전 패턴 | [day08-helm-kustomize-troubleshooting-patterns.md](day08-helm-kustomize-troubleshooting-patterns.md) | Helm/Kustomize 통합, CMP, 트러블슈팅, App of Apps, Argo Rollouts |
| 9 | 실습, 예제, 자가 점검 | [day09-practice-examples-review.md](day09-practice-examples-review.md) | CLI 실습, Application 관리, 예제 모음, 자가 점검, 참고문헌 |

---

## 학습 방법

1. Day 1부터 순서대로 학습한다
2. 각 Day 파일의 코드 예제를 직접 실행해본다
3. Day 9의 실습 과제를 수행한다
4. Day 9의 자가 점검 문제로 이해도를 확인한다

## 원본 구성

이 학습 자료는 원래 하나의 문서(약 5,340줄)로 작성되었으며, 학습 효율을 위해 일별 파일로 분리하였다.
