# nginx - 웹 서버 / 리버스 프록시 학습 가이드

nginx의 핵심 개념부터 프로덕션 수준의 설정까지, 5일간의 체계적 학습 과정이다.

---

## 학습 일정

| Day | 파일 | 주제 | 핵심 내용 |
|-----|------|------|----------|
| 1 | [day01-event-driven-config.md](day01-event-driven-config.md) | Event-Driven Architecture와 설정 기초 | nginx 개념, Event-Driven Architecture, epoll/kqueue, nginx vs Apache, Configuration Structure, Location Matching, HTTP 처리 파이프라인 (11 Phases) |
| 2 | [day02-proxy-loadbalancing-ssl.md](day02-proxy-loadbalancing-ssl.md) | Reverse Proxy, Load Balancing, SSL/TLS, Rate Limiting | proxy_pass 동작, Proxy Buffering/Timeout, Proxy Cache, Load Balancing 알고리즘, SSL/TLS Termination, TLS 1.3, OCSP Stapling, Leaky Bucket Rate Limiting |
| 3 | [day03-caching-security-ingress.md](day03-caching-security-ingress.md) | HTTP Caching, Security, Logging, Modules, Ingress Controller | HTTP Caching, Microcaching, Security Headers, CORS, Access Control, Logging, Stream Module, Nginx Ingress Controller, Canary 배포 |
| 4 | [day04-performance-advanced-labs.md](day04-performance-advanced-labs.md) | Performance Tuning, 고급 기능, 트러블슈팅, 실습 | Worker 설정, sendfile/tcp_nopush/tcp_nodelay, Gzip, open_file_cache, sub_filter, mirror, split_clients, 502/503/504 트러블슈팅, 실습 9개 |
| 5 | [day05-examples-review.md](day05-examples-review.md) | 예제와 자가 점검 | Kubernetes 배포, 리버스 프록시, Rate Limiting, SSL, Caching, Ingress, WebSocket, gzip, Production API Gateway, 정적 파일 최적화 예제 + 자가 점검 + 참고문헌 |

---

## 학습 방법

1. 각 Day의 파일을 순서대로 읽으며 개념을 이해한다
2. 코드 블록의 설정 예시를 직접 작성해 본다
3. 실습 과제(Day 4)를 dev 클러스터에서 직접 수행한다
4. 자가 점검(Day 5)으로 이해도를 확인한다

## 실습 환경

- 매니페스트: `manifests/demo/nginx-app.yaml`
- 실습 대상 클러스터: dev (`kubeconfig/dev.yaml`)
- Deployment: `nginx-web` (namespace: demo)
- Service: `nginx-web` (NodePort 30080)
- 이미지: `nginx:alpine`, Replicas: 3, HPA: min 3 ~ max 10
