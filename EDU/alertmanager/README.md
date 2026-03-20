# AlertManager - 알림 관리 학습 가이드

> AlertManager의 개념부터 아키텍처, 설정, 운영, 트러블슈팅까지 6일 과정으로 구성된 학습 가이드이다.

---

## 학습 일정

| 일차 | 주제 | 파일 |
|------|------|------|
| Day 1 | 개념, 아키텍처, 실습 기초 | [day01-concepts-and-basics.md](day01-concepts-and-basics.md) |
| Day 2 | 아키텍처 심화, Routing 심화, Grouping 심화 | [day02-architecture-routing-grouping.md](day02-architecture-routing-grouping.md) |
| Day 3 | Inhibition 심화, Silence 심화, Receiver 심화 | [day03-inhibition-silence-receiver.md](day03-inhibition-silence-receiver.md) |
| Day 4 | 알림 템플릿 심화, HA 심화, 알림 설계 모범 사례 | [day04-template-ha-best-practices.md](day04-template-ha-best-practices.md) |
| Day 5 | Prometheus Alert Rules 심화, amtool CLI 심화, 트러블슈팅 | [day05-alert-rules-amtool-troubleshooting.md](day05-alert-rules-amtool-troubleshooting.md) |
| Day 6 | 고급 실습, 프로덕션 예제, 자가 점검 | [day06-advanced-labs-review.md](day06-advanced-labs-review.md) |

---

## Day 1: 개념, 아키텍처, 실습 기초

AlertManager의 핵심 개념과 내부 아키텍처를 학습한다. Routing Tree, Grouping 타이머, Inhibition Rules, High Availability의 기본 개념을 이해하고, Notification Template과 Receiver 통합 방법을 익힌다. amtool CLI 사용법과 기초 실습, 예제를 통해 실전 감각을 기른다. Alerting Best Practices로 올바른 알림 설계 원칙을 학습한다.

- [day01-concepts-and-basics.md](day01-concepts-and-basics.md)

## Day 2: 아키텍처 심화, Routing 심화, Grouping 심화

AlertManager의 전체 알림 처리 파이프라인을 상세하게 분석한다. Alert 구조체, Fingerprint 계산, Alert 상태 머신을 이해한다. Route Tree의 DFS 기반 매칭 알고리즘, group_by의 세 가지 동작 방식, active/mute time_intervals, 라우팅 설계 패턴을 학습한다. Grouping 타이머의 상호 작용을 타임라인 다이어그램으로 이해한다.

- [day02-architecture-routing-grouping.md](day02-architecture-routing-grouping.md)

## Day 3: Inhibition 심화, Silence 심화, Receiver 심화

Inhibition의 source/target matchers 동작 원리와 equal labels의 역할을 상세히 이해한다. Silence의 생성, 매칭 로직, 만료 관리, 자동화 방법을 학습한다. Slack, PagerDuty, Email, Webhook, OpsGenie, Teams, Telegram 등 다양한 Receiver 통합 방법과 커스텀 Receiver 구현 패턴을 익힌다.

- [day03-inhibition-silence-receiver.md](day03-inhibition-silence-receiver.md)

## Day 4: 알림 템플릿 심화, HA 심화, 알림 설계 모범 사례

Go template 문법(조건문, 반복문, 변수, 파이프라인, 커스텀 함수)을 상세히 학습하고 템플릿 디버깅 방법을 익힌다. HA 클러스터의 Gossip 프로토콜 동작, split-brain 대응, Kubernetes에서의 HA 설정을 이해한다. 프로덕션 환경에서의 알림 설계 원칙과 모범 사례를 학습한다.

- [day04-template-ha-best-practices.md](day04-template-ha-best-practices.md)

## Day 5: Prometheus Alert Rules 심화, amtool CLI 심화, 트러블슈팅

Prometheus Alert Rule 작성법(for/pending, absent, predict_linear, SLO 기반 에러 버짓, Golden Signals)을 심층적으로 학습한다. promtool 단위 테스트와 amtool CLI 고급 사용법을 익힌다. 알림 미발송, 중복, 지연 등 실전 트러블슈팅 절차를 학습한다.

- [day05-alert-rules-amtool-troubleshooting.md](day05-alert-rules-amtool-troubleshooting.md)

## Day 6: 고급 실습, 프로덕션 예제, 자가 점검

Inhibition 규칙 설정 및 검증 실습과 완전한 프로덕션 AlertManager 설정 예제를 다룬다. 전체 학습 내용에 대한 자가 점검 체크리스트로 학습 성과를 확인하고, 참고문헌을 통해 추가 학습 자료를 확인한다.

- [day06-advanced-labs-review.md](day06-advanced-labs-review.md)

---

## 참고문헌

- [AlertManager 공식 문서](https://prometheus.io/docs/alerting/latest/alertmanager/)
- [AlertManager GitHub 저장소](https://github.com/prometheus/alertmanager)
- [AlertManager Configuration](https://prometheus.io/docs/alerting/latest/configuration/)
- [Alerting Rules](https://prometheus.io/docs/prometheus/latest/configuration/alerting_rules/)
- [Notification Template Reference](https://prometheus.io/docs/alerting/latest/notifications/)
- [amtool](https://github.com/prometheus/alertmanager#amtool)
- [Awesome Prometheus Alerts](https://awesome-prometheus-alerts.grep.to/)
- [Prometheus: Up & Running (O'Reilly)](https://www.oreilly.com/library/view/prometheus-up/9781098131135/)
