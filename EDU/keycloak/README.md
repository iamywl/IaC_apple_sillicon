# Keycloak - IAM / SSO 학습 가이드

> Keycloak의 개념부터 OAuth 2.0, OpenID Connect, JWT, Kubernetes 연동, 보안, 트러블슈팅까지 6일 과정으로 구성된 학습 가이드이다.

---

## 학습 일정

| 일차 | 주제 | 파일 |
|------|------|------|
| Day 1 | 개념, 아키텍처, 핵심 구성 요소 | [day01-concepts-and-architecture.md](day01-concepts-and-architecture.md) |
| Day 2 | OAuth 2.0 심화, OpenID Connect 심화 | [day02-oauth2-oidc.md](day02-oauth2-oidc.md) |
| Day 3 | JWT/JWK 심화, Realm 구성 심화, Client 구성 심화 | [day03-jwt-realm-client.md](day03-jwt-realm-client.md) |
| Day 4 | Identity Brokering, Kubernetes 연동, 보안 모범 사례 | [day04-federation-k8s-security.md](day04-federation-k8s-security.md) |
| Day 5 | 트러블슈팅, 실습 | [day05-troubleshooting-and-labs.md](day05-troubleshooting-and-labs.md) |
| Day 6 | 고급 예제, 자가 점검 | [day06-examples-and-review.md](day06-examples-and-review.md) |

---

## Day 1: 개념, 아키텍처, 핵심 구성 요소

Keycloak의 기본 개념(Realm, Client, User, Role, Group, Token)과 Quarkus 기반 아키텍처를 학습한다. OAuth 2.0 인증 흐름(Authorization Code Flow, Client Credentials, Device Authorization), JWT 구조, 그리고 이 프로젝트에서의 실습 환경을 이해한다.

- [day01-concepts-and-architecture.md](day01-concepts-and-architecture.md)

## Day 2: OAuth 2.0 심화, OpenID Connect 심화

OAuth 2.0의 심화 내용(Authorization Code Flow 상세, PKCE, Token Endpoint, Scope, 보안 고려사항)을 학습한다. OpenID Connect의 ID Token, UserInfo Endpoint, Discovery, Session Management, Logout 흐름을 이해한다.

- [day02-oauth2-oidc.md](day02-oauth2-oidc.md)

## Day 3: JWT/JWK 심화, Realm 구성 심화, Client 구성 심화

JWT/JWK 심화(토큰 구조, 서명 검증, JWKS Endpoint, 토큰 교환, Token Introspection)를 학습한다. Realm 구성(로그인 설정, Brute Force Protection, Session 정책, OTP)과 Client 구성(Client Scopes, Protocol Mappers, Service Account, Fine-Grained Authorization)을 이해한다.

- [day03-jwt-realm-client.md](day03-jwt-realm-client.md)

## Day 4: Identity Brokering, Kubernetes 연동, 보안 모범 사례

Identity Brokering & Federation(소셜 로그인, LDAP/AD 연동, Identity Provider Mappers)을 학습한다. Kubernetes 연동(OIDC 인증, RBAC 매핑, Ingress 보호, ArgoCD/Grafana SSO 통합)과 보안 모범 사례를 이해한다.

- [day04-federation-k8s-security.md](day04-federation-k8s-security.md)

## Day 5: 트러블슈팅, 실습

Keycloak 트러블슈팅(로그인 실패, 토큰 오류, 성능 문제, 인증서 문제, DB 연결 문제)을 학습한다. 기초부터 고급까지의 실습(Realm/Client 설정, 로그인 테스트, RBAC, Token 분석, PKCE, Service Account)을 수행한다.

- [day05-troubleshooting-and-labs.md](day05-troubleshooting-and-labs.md)

## Day 6: 고급 예제, 자가 점검

프로덕션 환경 Keycloak 설정 예제(Realm Export, Helm Values, Terraform)와 Kubernetes OIDC 연동 예제, OAuth2 Proxy 연동을 다룬다. 전체 학습 내용에 대한 자가 점검 체크리스트와 참고문헌을 확인한다.

- [day06-examples-and-review.md](day06-examples-and-review.md)

---

## 참고문헌

- [Keycloak 공식 문서](https://www.keycloak.org/documentation)
- [Keycloak GitHub 저장소](https://github.com/keycloak/keycloak)
- [OAuth 2.0 RFC 6749](https://tools.ietf.org/html/rfc6749)
- [OpenID Connect Core](https://openid.net/specs/openid-connect-core-1_0.html)
- [JWT RFC 7519](https://tools.ietf.org/html/rfc7519)
