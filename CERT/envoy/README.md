# Envoy - 고성능 L7 프록시 학습 가이드

Envoy의 아키텍처, 필터 체인, xDS, 로드밸런싱, 보안, Istio 연동까지 8일간 체계적으로 학습하는 가이드이다.

---

## 학습 일정

| Day | 주제 | 파일 | 주요 내용 |
|-----|------|------|----------|
| 1 | 개념 및 아키텍처 | [day01-concepts-and-architecture.md](day01-concepts-and-architecture.md) | Envoy 탄생 배경, 핵심 개념(Downstream/Upstream, Listener, Cluster, Filter, xDS), Static/Dynamic 설정, Bootstrap, 요청 흐름, 스레딩 모델 |
| 2 | Listener, Filter Chain, HCM | [day02-listener-filter-hcm.md](day02-listener-filter-hcm.md) | Listener 구조 심화, Filter Chain 매칭/처리, HTTP Connection Manager 라우팅/재시도/타임아웃 |
| 3 | xDS, Cluster, 로드밸런싱 | [day03-xds-cluster-loadbalancing.md](day03-xds-cluster-loadbalancing.md) | xDS Discovery Service(LDS, RDS, CDS, EDS, SDS), Cluster 관리, 로드밸런싱 알고리즘(Round Robin, Least Request, Ring Hash 등) |
| 4 | 헬스체크, 서킷 브레이커, Hot Restart, TLS | [day04-health-circuit-hotrestart-tls.md](day04-health-circuit-hotrestart-tls.md) | Active/Passive 헬스체크, 서킷 브레이커 설정, 무중단 업데이트(Hot Restart), TLS/mTLS 보안 |
| 5 | 관찰성 및 Rate Limiting | [day05-observability-and-ratelimiting.md](day05-observability-and-ratelimiting.md) | 통계/분산 추적/액세스 로깅, Local/Global Rate Limiting |
| 6 | Wasm, Sidecar (Istio), 성능 튜닝 | [day06-wasm-sidecar-performance.md](day06-wasm-sidecar-performance.md) | WebAssembly 확장 개발, Istio 환경 Envoy Sidecar 동작, 성능 튜닝 전략 |
| 7 | 트러블슈팅 및 실전 시나리오 | [day07-troubleshooting-and-scenarios.md](day07-troubleshooting-and-scenarios.md) | 문제 진단/해결, Canary 배포, gRPC 프록시, WebSocket, 멀티클러스터 시나리오 |
| 8 | 실습, 예제, 자가 점검 | [day08-practice-and-review.md](day08-practice-and-review.md) | 실습 과제, 예제 시나리오, 자가 점검 문제, 참고문헌 |

---

## 학습 방법

1. 각 Day 파일을 순서대로 읽으며 개념을 이해한다
2. 코드 블록과 설정 예시는 실습 환경에서 직접 실행해 본다
3. Day 8의 실습 과제와 자가 점검으로 이해도를 확인한다

## 실습 환경

- Envoy는 Istio의 데이터 플레인으로 사이드카 형태로 배포된다
- Istio 설치: `scripts/install/` 내 Istio 관련 스크립트 참조
- Envoy Admin: `kubectl port-forward <pod> 15000:15000` 으로 접근
