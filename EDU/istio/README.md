# Istio - 서비스 메시 학습 가이드

> Istio 서비스 메시의 개념부터 아키텍처, 트래픽 관리, 보안, 관찰성, 고급 패턴, 성능 튜닝, 트러블슈팅까지 6일 과정으로 구성된 학습 가이드이다.

---

## 학습 일정

| 일차 | 주제 | 파일 |
|------|------|------|
| Day 1 | Service Mesh 개념, Istio 아키텍처 | [day01-service-mesh-architecture.md](day01-service-mesh-architecture.md) |
| Day 2 | 트래픽 관리 심화 | [day02-traffic-management.md](day02-traffic-management.md) |
| Day 3 | 보안 심화, 관찰성(Observability) | [day03-security-observability.md](day03-security-observability.md) |
| Day 4 | 고급 트래픽 패턴, Multi-cluster, Gateway API | [day04-advanced-traffic-multicluster.md](day04-advanced-traffic-multicluster.md) |
| Day 5 | 성능 튜닝, 트러블슈팅, Ambient Mesh, 실전 시나리오 | [day05-tuning-troubleshooting-ambient.md](day05-tuning-troubleshooting-ambient.md) |
| Day 6 | 실습 환경, 실습, 예제, 디버깅, 자가 점검 | [day06-labs-examples-review.md](day06-labs-examples-review.md) |

---

## Day 1: Service Mesh 개념, Istio 아키텍처

Service Mesh가 필요한 이유와 분산 컴퓨팅의 8가지 오류를 학습한다. Sidecar vs Ambient 패턴을 비교하고, Istio의 전체 아키텍처(Control Plane, Data Plane)를 이해한다. istiod 내부 구조, Envoy Proxy 상세, xDS API, Sidecar Injection 메커니즘을 학습한다.

- [day01-service-mesh-architecture.md](day01-service-mesh-architecture.md)

## Day 2: 트래픽 관리 심화

VirtualService, DestinationRule, Gateway, ServiceEntry, Sidecar 리소스의 상세 스펙과 동작 원리를 학습한다. 로드밸런싱 알고리즘, Connection Pool, Outlier Detection, Circuit Breaker, 재시도/타임아웃 설정을 이해한다.

- [day02-traffic-management.md](day02-traffic-management.md)

## Day 3: 보안 심화, 관찰성(Observability)

Istio 보안 아키텍처(mTLS, PeerAuthentication, RequestAuthentication, AuthorizationPolicy, 인증서 관리)를 학습한다. 관찰성(메트릭, 분산 트레이싱, 접근 로그, Kiali 서비스 토폴로지, Envoy 통계)을 이해한다.

- [day03-security-observability.md](day03-security-observability.md)

## Day 4: 고급 트래픽 패턴, Multi-cluster, Gateway API

고급 트래픽 패턴(카나리 배포, A/B 테스트, 트래픽 미러링, Fault Injection, Rate Limiting, Locality Load Balancing)을 학습한다. Multi-cluster/Multi-network Mesh와 Istio Gateway API를 이해한다.

- [day04-advanced-traffic-multicluster.md](day04-advanced-traffic-multicluster.md)

## Day 5: 성능 튜닝, 트러블슈팅, Ambient Mesh, 실전 시나리오

성능 튜닝, 트러블슈팅 방법론, Ambient Mesh(ztunnel, waypoint proxy)를 학습한다. Zero-downtime 배포, gRPC 로드밸런싱, 외부 서비스 통합 등 실전 시나리오를 이해한다.

- [day05-tuning-troubleshooting-ambient.md](day05-tuning-troubleshooting-ambient.md)

## Day 6: 실습 환경, 실습, 예제, 디버깅, 자가 점검

이 프로젝트에서의 Istio 실습 환경을 설정하고, 트래픽 관리/보안 정책/카나리 배포 실습을 수행한다. VirtualService, mTLS, 프로덕션 설정 예제와 디버깅 명령어를 익히고, 자가 점검으로 학습 성과를 확인한다.

- [day06-labs-examples-review.md](day06-labs-examples-review.md)

---

## 참고문헌

- [Istio 공식 문서](https://istio.io/latest/docs/)
- [Istio GitHub 저장소](https://github.com/istio/istio)
- [Envoy Proxy 공식 문서](https://www.envoyproxy.io/docs/envoy/latest/)
- [Istio in Action (Manning)](https://www.manning.com/books/istio-in-action)
