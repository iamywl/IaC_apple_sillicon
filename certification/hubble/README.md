# Hubble - Cilium 네트워크 옵저버빌리티 학습 가이드

Cilium 기반 네트워크 옵저버빌리티 플랫폼 Hubble의 개념부터 보안 감사, 성능 튜닝까지 6일간의 체계적 학습 과정이다.

---

## 학습 일정

| Day | 파일 | 주제 | 핵심 내용 |
|-----|------|------|----------|
| 1 | [day01-concepts-architecture.md](day01-concepts-architecture.md) | 개념과 내부 아키텍처 심화 | Hubble 개념, eBPF 데이터 수집, hubble-relay, Flow 데이터 구조, L7 프로토콜 가시성, Metrics, UI, Monitor 컴포넌트, Flow 파싱 엔진, L7 파서(HTTP/DNS/Kafka/gRPC), Ring Buffer, gRPC API |
| 2 | [day02-flow-relay-ui.md](day02-flow-relay-ui.md) | Flow 데이터 구조 심화, hubble-relay 심화, Hubble UI 심화 | Protocol Buffers 정의, Flow 타입, Verdict, Drop Reason 코드, Reserved Identity, hubble-relay Peer Discovery/Connection Pool/Flow Merging, mTLS, HA, 필터 푸시다운, Hubble UI React 아키텍처, Service Map 렌더링 |
| 3 | [day03-metrics-cli.md](day03-metrics-cli.md) | Hubble Metrics 심화와 CLI 심화 | Prometheus 메트릭 구조, 핸들러별 메트릭, Grafana 대시보드 PromQL, 커스텀 메트릭, hubble observe 필터 옵션 전체, 출력 형식, Follow 모드, jq 후처리 |
| 4 | [day04-troubleshooting-security-tuning.md](day04-troubleshooting-security-tuning.md) | 트러블슈팅, 보안 감사, 성능 튜닝 | Pod 통신 실패, DNS 실패, NetworkPolicy 검증, 레이턴시 분석, egress 차단, TCP RST, lateral movement 탐지, 데이터 유출 탐지, Ring buffer 최적화, L7 visibility 성능 영향 |
| 5 | [day05-labs.md](day05-labs.md) | 실습 | CLI 기본, 필터 조합, UI 접속, 정책 검증, DNS 트러블슈팅, Lateral Movement 탐지, Inter-Namespace 모니터링, Metrics-Grafana 대시보드, HTTP 경로 분석, 시간 범위 조회, JSON+jq, network-policies 검증 (12개 실습) |
| 6 | [day06-examples-review.md](day06-examples-review.md) | 예제, 자가 점검, 참고문헌 | 트래픽 모니터링 스크립트, 정책 디버깅 스크립트, PromQL 쿼리, Grafana 대시보드 JSON, 감사 자동화 스크립트, 이상 트래픽 탐지 스크립트 + 자가 점검 + 참고문헌 |

---

## 학습 방법

1. 각 Day의 파일을 순서대로 읽으며 개념을 이해한다
2. 아키텍처 다이어그램과 프로토콜 구조를 직접 그려본다
3. 실습 과제(Day 5)를 dev 클러스터에서 직접 수행한다
4. 자가 점검(Day 6)으로 이해도를 확인한다

## 실습 환경

- 설치 스크립트: `scripts/install/06-install-cilium.sh`
- Helm values: `manifests/hubble-values.yaml`
- Hubble UI: NodePort 31235
- Hubble Metrics: DNS, drop, TCP, flow, ICMP, HTTP
- 실습 대상 클러스터: dev (`kubeconfig/dev.yaml`)
