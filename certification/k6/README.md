# k6 - 성능 및 부하 테스트 학습 가이드

k6 학습 자료를 9일 과정으로 구성한 스터디 가이드이다. 각 Day별 파일에서 해당 주제를 학습할 수 있다.

---

## 학습 일정

| Day | 주제 | 파일 | 핵심 내용 |
|-----|------|------|-----------|
| 1 | 성능 테스트 이론 | [day01-performance-testing-theory.md](day01-performance-testing-theory.md) | 성능 테스트 개념, 부하 테스트 6가지 유형, Capacity Planning, Little's Law, Percentile |
| 2 | k6 개념과 아키텍처 | [day02-k6-concepts-and-architecture.md](day02-k6-concepts-and-architecture.md) | k6 개요, Go+JS 아키텍처, init/VU code, 실습 환경, VU 라이프사이클 |
| 3 | JavaScript API와 Checks & Thresholds | [day03-javascript-api-checks-thresholds.md](day03-javascript-api-checks-thresholds.md) | HTTP Module 상세, URL 그룹핑, Check 패턴, Threshold 구문 |
| 4 | Custom Metrics, Scenarios, Data | [day04-custom-metrics-scenarios-data.md](day04-custom-metrics-scenarios-data.md) | Counter/Gauge/Rate/Trend, Executor 상세, 복합 Scenario, 데이터 파라미터화 |
| 5 | Groups & Tags, 프로토콜, 브라우저 | [day05-groups-tags-protocols-browser.md](day05-groups-tags-protocols-browser.md) | Groups, Tags, HTTP/WebSocket/gRPC/SOAP, k6 Browser Module |
| 6 | Extensions, CI/CD, Output | [day06-extensions-cicd-output.md](day06-extensions-cicd-output.md) | xk6 확장, GitHub Actions/Jenkins/GitLab CI, JSON/CSV/InfluxDB/Prometheus 출력 |
| 7 | 분산 테스트, 성능 분석, 트러블슈팅 | [day07-distributed-analysis-troubleshooting-scenarios.md](day07-distributed-analysis-troubleshooting-scenarios.md) | k6-operator, 성능 분석, 트러블슈팅, API/Microservice 실전 시나리오 |
| 8 | 실전 시나리오와 실습 | [day08-scenarios-metrics-practice.md](day08-scenarios-metrics-practice.md) | DB Stress Test, SLO Validation, HPA Scaling, Metrics 심화, 실습 과제 |
| 9 | 예제, 옵션 레퍼런스, 자가 점검 | [day09-examples-options-review.md](day09-examples-options-review.md) | 예제 모음 8종, k6 옵션 전체 레퍼런스, 자가 점검, 참고문헌 |

---

## 학습 방법

1. Day 1부터 순서대로 학습한다 (Day 1은 이론, Day 2부터 k6 실습)
2. 각 Day 파일의 코드 예제를 직접 실행해본다
3. Day 8의 실습 과제를 수행한다
4. Day 9의 자가 점검 문제로 이해도를 확인한다

## 원본 구성

이 학습 자료는 원래 하나의 문서(약 5,244줄)로 작성되었으며, 학습 효율을 위해 일별 파일로 분리하였다.
