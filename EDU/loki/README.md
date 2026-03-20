# Loki - 로그 수집 및 저장 학습 가이드

Grafana Loki의 개념부터 프로덕션 운영까지, 6일간의 체계적 학습 과정이다.

---

## 학습 일정

| Day | 파일 | 주제 | 핵심 내용 |
|-----|------|------|----------|
| 1 | [day01-concepts-promtail-logql.md](day01-concepts-promtail-logql.md) | 개념, 아키텍처, Promtail 심화, LogQL 심화 | Loki 개념, ELK 비교, 레이블 모범 사례, 배포 모드, 핵심 컴포넌트, Write/Read Path, Promtail Pipeline Stages, LogQL 문법 |
| 2 | [day02-architecture-deep-dive.md](day02-architecture-deep-dive.md) | Loki 아키텍처 심화 | Distributor, Ingester, Querier, Query Frontend, Compactor, Ruler, Hash Ring, WAL, Chunk Flushing, Replication, gRPC 통신, memberlist |
| 3 | [day03-storage-promtail-advanced.md](day03-storage-promtail-advanced.md) | 스토리지 심화와 Promtail 고급 설정 | Index Storage(TSDB), Chunk Storage, Schema Config, 캐싱, Promtail Pipeline Stages 상세, Service Discovery, 멀티라인 로그, 로그 수집 에이전트 비교 |
| 4 | [day04-logql-advanced-multitenancy-grafana.md](day04-logql-advanced-multitenancy-grafana.md) | LogQL 고급, 멀티테넌시, Grafana 활용 | LogQL 전체 연산자/함수, Line Format Expression, Binary Operations, 멀티테넌시(X-Scope-OrgID), Grafana 로그 탐색, Derived Fields, Tempo 연동 |
| 5 | [day05-performance-troubleshooting-security.md](day05-performance-troubleshooting-security.md) | 성능 최적화, 트러블슈팅, 보안 | 쿼리 최적화, Ingester 튜닝, Chunk/Index 최적화, Compactor 관리, 일반적 오류 진단, TLS 설정, 인증/인가, 감사 로그 |
| 6 | [day06-labs-examples-review.md](day06-labs-examples-review.md) | 실습, 예제, 자가 점검, 참고문헌 | Loki 상태 확인, LogQL 쿼리 실습, Grafana 탐색, API 호출, Pipeline Stage 테스트, 멀티테넌트, 대시보드, Promtail 설정, 구조화된 로깅, 알림, 프로덕션 설정, Retention, 복합 LogQL + 자가 점검 + 참고문헌 |

---

## 학습 방법

1. 각 Day의 파일을 순서대로 읽으며 개념을 이해한다
2. LogQL 쿼리를 Grafana Explore에서 직접 실행해 본다
3. 실습 과제(Day 6)를 platform 클러스터에서 직접 수행한다
4. 자가 점검(Day 6)으로 이해도를 확인한다

## 실습 환경

- 설치 스크립트: `scripts/install/07-install-monitoring.sh`
- Helm Chart: `loki-stack` (Loki + Promtail)
- Helm values: `manifests/loki-values.yaml`
- Grafana에서 Loki 데이터소스로 연동
- 실습 대상 클러스터: platform (`kubeconfig/platform.yaml`)
