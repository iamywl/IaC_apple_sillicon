# KCNA Day 7: 관측성(Observability) - Prometheus, Grafana, 로깅, 트레이싱

> 학습 목표: 관측성의 3대 축과 주요 도구(Prometheus, Grafana, Loki, Jaeger, OpenTelemetry)를 이해한다.
> 예상 소요 시간: 60분 (개념 40분 + 심화 학습 20분)
> 시험 도메인: Cloud Native Observability (8%)
> 난이도: ★★★★☆

---

## 오늘의 학습 목표

- 관측성의 3대 축(Metrics, Logs, Traces)을 설명할 수 있다
- Prometheus의 Pull 기반 메트릭 수집 방식과 4가지 메트릭 유형을 이해한다
- Grafana, Loki, Jaeger, OpenTelemetry의 역할을 구분한다
- 비용 관리(ResourceQuota, LimitRange)를 이해한다

---

## 0. 등장 배경

모놀리식 애플리케이션에서는 하나의 프로세스에서 모든 로직이 실행되었으므로, 로그 파일 하나를 grep하면 문제를 찾을 수 있었다. 그러나 마이크로서비스 아키텍처에서는 하나의 사용자 요청이 수십 개의 서비스를 거친다. 어떤 서비스에서 지연이 발생하는지, 어떤 서비스가 에러를 반환하는지 파악하려면 개별 서비스의 로그만으로는 부족하다. 이 문제를 해결하기 위해 관측성(Observability)이라는 개념이 등장했다. 메트릭(숫자)으로 전체 시스템 상태를 모니터링하고, 로그(텍스트)로 개별 이벤트를 추적하며, 트레이스(경로)로 서비스 간 호출 관계를 가시화한다. Prometheus(2012, SoundCloud), Fluentd(2011, Treasure Data), Jaeger(2016, Uber)는 각각 이 세 가지 축을 담당하며, OpenTelemetry는 이들을 하나의 표준으로 통합하려는 프로젝트이다.

---

## 1. 관측성(Observability)의 3대 축

### 1.1 관측성이란?

> **관측성(Observability)**이란?
> 시스템의 **외부 출력**(메트릭, 로그, 트레이스)을 관찰하여 **내부 상태**를 이해하는 능력이다. 단순히 "무엇이 잘못되었는가?"뿐 아니라 "왜 잘못되었는가?"를 파악할 수 있어야 한다.

> **기술 원리:** 관측성은 제어 이론에서 유래한 개념으로, 시스템의 외부 출력(Metrics, Logs, Traces)만으로 내부 상태를 추론할 수 있는 시스템의 속성이다. Metrics는 시계열 수치 데이터(Prometheus), Logs는 이산 이벤트 기록(Fluentd/Loki), Traces는 분산 요청의 인과 관계 경로(Jaeger/OpenTelemetry)를 제공한다.

> **모니터링(Monitoring) vs 관측성(Observability):**
> - **모니터링**: "알려진 문제"를 감시한다. "CPU가 90% 이상이면 알림"
> - **관측성**: "알려지지 않은 문제"도 진단할 수 있다. "왜 이 요청이 느린지 추적"

### 1.2 3대 축 상세 (시험 빈출!)

```
관측성의 3대 축 (Three Pillars of Observability)
============================================================

1. Metrics (메트릭)                    도구: Prometheus
   - 시간에 따른 수치 데이터
   - "현재 CPU 사용률이 85%이다"
   - 대시보드, 알림(Alert)에 사용
   - 집계/요약 데이터 (고효율)

2. Logs (로그)                         도구: Fluentd, Loki
   - 개별 이벤트의 시간순 기록
   - "2024-01-15 10:23:45 ERROR: DB connection failed"
   - 디버깅, 감사 추적에 사용
   - 상세한 컨텍스트 정보 포함

3. Traces (트레이스)                   도구: Jaeger, Zipkin
   - 분산 요청의 경로 추적
   - "사용자 요청 → API(50ms) → DB(200ms) → 캐시(5ms)"
   - 서비스 간 의존성 시각화
   - 성능 병목 구간 식별

매우 중요한 시험 포인트:
- "Three Pillars" = Metrics, Logs, Traces
- Prometheus, Grafana, Jaeger는 "도구"이지 "축"이 아니다!
```

| 축 | 특성 | 질문에 대한 답 | 주요 도구 |
|----|------|-------------|----------|
| **Metrics** | 수치, 시계열, 집계 | "지금 어떤 상태인가?" | Prometheus, Datadog |
| **Logs** | 텍스트, 이벤트, 상세 | "무엇이 일어났는가?" | Fluentd, Loki, EFK |
| **Traces** | 경로, 분산, 인과관계 | "어디서 느려졌는가?" | Jaeger, Zipkin, Tempo |

---

## 2. Prometheus - 메트릭 모니터링

### 2.1 Prometheus 개요

> **Prometheus**란?
> CNCF **졸업** 프로젝트로, Kubernetes 생태계의 사실상 표준 모니터링 시스템이다. SoundCloud에서 2012년에 개발되었으며, Google의 Borgmon 시스템에서 영감을 받았다.

### 2.2 Prometheus 핵심 특징

```
Prometheus 아키텍처
============================================================

  서비스 디스커버리          Prometheus Server
  (K8s API 등)               +------------------+
  +------------+             |                  |
  | 타겟 자동   |----------->| TSDB             |  시계열 DB
  | 검색        |             | (Time Series DB) |
  +------------+             |                  |
                             | Scraper          |  Pull 방식
                      +----->| (스크래퍼)        |<------+
                      |      |                  |       |
  +----------+        |      | Rule Engine      |       |
  | 타겟 A   |--------+      | (규칙 엔진)      |       |
  | /metrics |               +---+-----------+--+       |
  +----------+                   |           |          |
                                 v           v          |
  +----------+           +-----------+ +-----------+    |
  | 타겟 B   |-----------| AlertMgr  | | PromQL    |    |
  | /metrics |           | (알림)    | | (쿼리)    |    |
  +----------+           +-----+-----+ +-----+-----+   |
                               |             |          |
  +----------+                 v             v          |
  | 타겟 C   |--------+  [Slack,Email]  [Grafana]      |
  | /metrics |        |                                |
  +----------+        +--------------------------------+

핵심 포인트:
1. Pull 기반: Prometheus가 타겟의 /metrics를 주기적으로 가져옴
2. 자체 TSDB: 시계열 데이터를 자체 저장
3. PromQL: 강력한 쿼리 언어
4. AlertManager: 알림 전송 (Slack, Email, PagerDuty 등)
5. 서비스 디스커버리: K8s API로 타겟 자동 검색
```

### 2.3 Pull vs Push 방식 (시험 빈출!)

```
Pull 방식 (Prometheus):
Prometheus ----HTTP GET----> 타겟의 /metrics 엔드포인트
              주기적으로        (타겟이 메트릭 노출)

장점:
- Prometheus가 타겟의 상태를 능동적으로 확인 가능
- 타겟이 다운되면 즉시 감지 (스크래핑 실패)
- 중앙 관리 용이

Push 방식 (Pushgateway 사용 시):
타겟 ----HTTP POST----> Pushgateway ----Pull----> Prometheus

사용 사례:
- 단기 실행 작업(Job, CronJob)이 완료 전 메트릭 전송
- 방화벽으로 Pull 불가능한 환경

시험 포인트:
- Prometheus는 기본적으로 "Pull 기반"이다! (Push 아님!)
- Pushgateway를 통해 Push도 가능하지만 예외적 사용
```

### 2.4 Prometheus 메트릭 유형 (4가지)

| 유형 | 설명 | 증가/감소 | 예시 |
|------|------|----------|------|
| **Counter** | 누적 값, 리셋 시에만 0으로 | **증가만** | HTTP 요청 총 수, 에러 총 수 |
| **Gauge** | 현재 값, 임의 변동 | **증가/감소** | CPU 사용률, 메모리 사용량, 온도 |
| **Histogram** | 값의 분포를 버킷에 기록 | - | 응답 시간 분포 (0.1s, 0.5s, 1s) |
| **Summary** | 클라이언트에서 계산된 백분위수 | - | p50, p90, p99 응답 시간 |

```
Counter vs Gauge 동작 특성
============================================================

Counter (카운터) = 단조 증가(monotonically increasing) 누적값
  - 값이 0에서 시작하여 증가만 가능 (프로세스 재시작 시 리셋)
  - rate() 또는 increase() 함수로 변화율을 계산하여 사용
  - 예: http_requests_total = 15234 → rate()로 초당 요청 수 산출

Gauge (게이지) = 순간 스냅샷(point-in-time) 값
  - 임의 시점의 측정값으로 증가/감소 모두 가능
  - 직접 값을 사용하거나 delta(), deriv() 등으로 변화 추세 분석
  - 예: node_memory_usage_bytes = 4294967296 (현재 메모리 사용량)
```

### 2.5 Prometheus 관련 YAML (ServiceMonitor)

```yaml
# ServiceMonitor: Prometheus Operator가 사용하는 CRD
# 어떤 Service의 메트릭을 스크래핑할지 선언적으로 정의
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: nginx-monitor
  namespace: monitoring
  labels:
    release: prometheus            # Prometheus가 이 라벨로 선택
spec:
  selector:
    matchLabels:
      app: nginx-web               # 이 라벨의 Service를 대상으로
  namespaceSelector:
    matchNames:
    - demo                         # demo 네임스페이스의 Service
  endpoints:
  - port: http                     # Service의 포트 이름
    interval: 30s                  # 30초마다 스크래핑
    path: /metrics                 # 메트릭 엔드포인트 경로

---
# PrometheusRule: 알림 규칙 정의
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: pod-alerts
  namespace: monitoring
spec:
  groups:
  - name: pod.rules
    rules:
    - alert: PodCrashLooping       # 알림 이름
      expr: rate(kube_pod_container_status_restarts_total[5m]) > 0
      for: 5m                     # 5분 이상 지속 시 발생
      labels:
        severity: warning
      annotations:
        summary: "Pod {{ $labels.pod }}가 반복적으로 재시작 중"
        description: "네임스페이스 {{ $labels.namespace }}의 Pod {{ $labels.pod }}가 5분간 재시작 반복"
```

---

## 3. Grafana - 데이터 시각화

### 3.1 Grafana 개요

> **Grafana**란?
> 오픈소스 데이터 시각화 및 대시보드 도구이다. Prometheus뿐 아니라 다양한 데이터 소스의 데이터를 시각화할 수 있다.

**Grafana 핵심 특징:**

| 특징 | 설명 |
|------|------|
| **다중 데이터 소스** | Prometheus, Loki, Elasticsearch, InfluxDB, MySQL 등 |
| **대시보드** | JSON으로 정의, 내보내기/가져오기 가능 |
| **알림** | Grafana 자체 알림 기능 (Slack, Email 등) |
| **플러그인** | 커뮤니티 플러그인으로 기능 확장 |
| **프로비저닝** | ConfigMap/파일로 대시보드를 코드로 관리 가능 |

---

## 4. 로깅: Fluentd, Loki, EFK

### 4.1 Fluentd

> **Fluentd**란?
> CNCF **졸업** 프로젝트인 오픈소스 **통합 로깅 계층(Unified Logging Layer)** 데이터 수집기이다. 다양한 소스에서 로그를 수집하여 다양한 목적지로 전달한다.

```
Fluentd 동작 원리
============================================================

소스(Input)              Fluentd                목적지(Output)
+----------+           +-----------+           +------------+
| 앱 로그   |---------->|           |---------->| Elasticsearch|
+----------+           | 파싱      |           +------------+
| 시스템 로그 |--------->| 필터링    |---------->| S3          |
+----------+           | 버퍼링    |           +------------+
| K8s 로그  |---------->| 라우팅    |---------->| Loki        |
+----------+           |           |           +------------+
                       +-----------+

K8s 배포 방식: DaemonSet (각 노드에 하나씩)
500+ 플러그인 지원
```

**Fluent Bit:**
- Fluentd의 **경량 버전** (C로 작성, 더 작은 메모리 사용)
- CNCF **졸업** 프로젝트
- Edge/IoT 환경이나 리소스 제약 환경에 적합
- Fluentd와 조합하여 사용 가능 (Fluent Bit → Fluentd → 저장소)

### 4.2 Loki

> **Loki**란?
> Grafana Labs에서 개발한 로그 집계 시스템으로, "**Prometheus의 로그 버전**"이라 불린다. 로그 내용을 전문 인덱싱하지 않고 **라벨만 인덱싱**하여 비용 효율적이다.

```
Loki vs Elasticsearch 비교
============================================================

Elasticsearch (전문 인덱싱):
  모든 로그 텍스트를 인덱싱
  → 빠른 전문 검색 가능
  → 인덱싱 비용 높음, 스토리지 많이 사용
  → 복잡한 운영

Loki (라벨 인덱싱):
  라벨(app=nginx, env=prod)만 인덱싱
  로그 내용은 압축 저장만
  → 라벨 기반 필터 후 로그 검색 (LogQL)
  → 인덱싱 비용 낮음, 스토리지 적게 사용
  → 운영 간단
```

**Loki 핵심:**
- **LogQL** 쿼리 언어: PromQL과 유사한 문법
- **Promtail** 에이전트: 로그 수집 (DaemonSet으로 배포)
- Grafana에서 직접 조회 가능 (데이터 소스로 추가)
- 비용 효율적 (인덱싱 최소화)

### 4.3 EFK Stack

```
EFK Stack 구성
============================================================

E = Elasticsearch  (저장/검색)
  - 분산 검색 엔진
  - RESTful API
  - 전문(full-text) 인덱싱

F = Fluentd  (수집)
  - 로그 수집/변환/전달
  - DaemonSet 배포
  - CNCF 졸업

K = Kibana  (시각화)
  - Elasticsearch 전용 대시보드
  - 로그 검색/분석 UI
  - 시각화 차트
```

---

## 5. 트레이싱: Jaeger, OpenTelemetry

### 5.1 Jaeger

> **Jaeger**란?
> CNCF **졸업** 프로젝트인 분산 트레이싱 시스템이다. Uber에서 개발하여 오픈소스로 공개했다.

```
분산 트레이싱 개념
============================================================

사용자 요청이 여러 서비스를 거치는 경로를 추적:

사용자 → [API Gateway] → [User Service] → [DB]
              |
              +------→ [Order Service] → [Payment Service]
                              |
                              +------→ [Inventory Service]

Trace (트레이스): 하나의 요청이 거치는 전체 경로
  └── Span (스팬): 트레이스 내의 개별 작업 단위
        - API Gateway: 5ms
        - User Service: 20ms
        - Order Service: 50ms
        - Payment Service: 200ms  ← 병목 발견!
        - Inventory Service: 10ms

총 응답 시간: 285ms, 병목: Payment Service (200ms)
```

### 5.2 OpenTelemetry (OTel) - 시험 빈출!

> **OpenTelemetry**란?
> 메트릭, 로그, 트레이스를 위한 **통합 관측성 프레임워크**이다. OpenTracing + OpenCensus가 합병하여 탄생했다. CNCF **인큐베이팅** 프로젝트이다.

```
OpenTelemetry 구성
============================================================

애플리케이션
+---------------------+
| OTel SDK            |  ← 앱에 통합
| (계측 라이브러리)     |
+--------+------------+
         |
         v (OTLP 프로토콜)
+---------------------+
| OTel Collector      |  ← 수집/처리/전달
| - Receiver          |     다양한 소스에서 수신
| - Processor         |     변환, 필터링, 배치
| - Exporter          |     백엔드로 전달
+--------+------------+
         |
    +----+----+----+
    |         |    |
    v         v    v
[Jaeger] [Prometheus] [Datadog]  ← 벤더 중립적!
(트레이스)  (메트릭)   (통합)       어떤 백엔드든 선택 가능
```

**OpenTelemetry 핵심 포인트:**
- **벤더 중립적(Vendor-neutral)**: 어떤 백엔드든 자유롭게 선택 가능
- 메트릭 + 로그 + 트레이스 = **통합 프레임워크**
- OTLP(OpenTelemetry Protocol): 표준 데이터 전송 프로토콜
- 클라우드 네이티브 관측성의 **미래 표준**

---

## 6. 비용 관리 (Cost Management)

### 6.1 K8s 비용 최적화

| 전략 | 설명 |
|------|------|
| **리소스 requests/limits 최적화** | 과도한 할당 방지, 적절한 값 설정 |
| **Kubecost** | K8s 비용 모니터링/최적화 오픈소스 |
| **FinOps** | 클라우드 비용 가시성/최적화/거버넌스 운영 모델 |
| **Spot/Preemptible 인스턴스** | 저렴한 비정규 인스턴스 활용 |
| **ResourceQuota** | 네임스페이스별 리소스 총량 제한 |
| **LimitRange** | Pod/컨테이너별 기본 리소스 설정 |

```yaml
# ResourceQuota 예제: 네임스페이스 리소스 제한
apiVersion: v1
kind: ResourceQuota
metadata:
  name: compute-quota
  namespace: dev
spec:
  hard:
    requests.cpu: "10"           # CPU 요청 총합 최대 10코어
    requests.memory: 20Gi        # 메모리 요청 총합 최대 20Gi
    limits.cpu: "20"             # CPU 제한 총합 최대 20코어
    limits.memory: 40Gi          # 메모리 제한 총합 최대 40Gi
    pods: "50"                   # Pod 최대 50개
    services: "20"               # Service 최대 20개
    persistentvolumeclaims: "10" # PVC 최대 10개

---
# LimitRange 예제: Pod/컨테이너 기본 리소스
apiVersion: v1
kind: LimitRange
metadata:
  name: default-limits
  namespace: dev
spec:
  limits:
  - type: Container
    default:                     # limits 기본값
      cpu: "500m"
      memory: "256Mi"
    defaultRequest:              # requests 기본값
      cpu: "100m"
      memory: "128Mi"
    max:                         # 최대값
      cpu: "2"
      memory: "2Gi"
    min:                         # 최소값
      cpu: "50m"
      memory: "64Mi"
```

---

## 7. 심화 학습: 관측성 도구 상세

### 7.1 Prometheus 메트릭 4가지 유형 상세

```
Prometheus 메트릭 유형 (4가지 데이터 모델)
═══════════════════════════════════════════

1. Counter (카운터) — 단조 증가(monotonically increasing) 누적값
   특성: 프로세스 재시작 시에만 0으로 리셋, 그 외 증가만 가능
   예시: http_requests_total = 총 HTTP 요청 수
         node_cpu_seconds_total = CPU 사용 누적 시간(초)
   PromQL: rate(http_requests_total[5m]) = 5분 윈도우 기준 초당 변화율

2. Gauge (게이지) — 순간 스냅샷(point-in-time) 측정값
   특성: 증가/감소 모두 가능, 특정 시점의 상태를 나타냄
   예시: node_memory_MemAvailable_bytes = 현재 가용 메모리 바이트
         kube_pod_status_ready = 현재 Ready 상태 Pod 수
   PromQL: node_memory_MemAvailable_bytes = 직접 사용 또는 delta()로 변화량 계산

3. Histogram (히스토그램) — 관측값의 버킷별 분포
   특성: 사전 정의된 버킷 경계(le)에 따라 관측값 누적 카운트 기록
   예시: http_request_duration_seconds_bucket{le="0.5"} = 0.5초 이하 요청 수
   PromQL: histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))
           = P95 지연 시간 (서버 측 집계 가능)

4. Summary (서머리) — 클라이언트 측 사전 계산 분위수
   특성: 클라이언트 SDK가 슬라이딩 윈도우로 분위수를 직접 계산
   예시: go_gc_duration_seconds{quantile="0.5"} = GC 시간 중앙값
   제약: 서버(Prometheus) 측에서 다중 인스턴스 집계 불가 → Histogram 권장
```

### 7.2 PromQL 기본 문법 (KCNA 이해 수준)

```
PromQL 핵심 함수 (집계 연산자)
═════════════════════════════

rate(): Range Vector에 대한 초당 변화율 계산 (Counter 전용)
  수식: (마지막 값 - 첫 값) / 구간(초), 리셋 자동 보정
  rate(http_requests_total[5m]) = 5분 윈도우 기준 초당 요청 수

sum(): 모든 시계열의 값을 합산하는 집계 연산자
  sum(rate(http_requests_total[5m])) = 전체 인스턴스의 초당 요청 합계

avg(): 모든 시계열의 산술 평균 집계
  avg(node_cpu_utilization) = 전체 노드 평균 CPU 사용률

max() / min(): 최대값/최소값 집계
  max(node_memory_usage_bytes) = 메모리 사용량이 가장 높은 노드

by(): 라벨 기준 그룹화 (GROUP BY 절과 유사)
  sum(rate(http_requests_total[5m])) by (method)
  = HTTP 메서드(GET, POST, DELETE)별 초당 요청 수 분리 집계

topk(): 값 기준 상위 N개 시계열 선택
  topk(5, rate(http_requests_total[5m])) = 요청률 상위 5개 인스턴스
```

### 7.3 로그 수집 아키텍처 (Loki + Promtail)

```
로그 수집 흐름
═════════════

[Pod A] → stdout/stderr → [containerd log] → /var/log/pods/...
                                                    │
                                              [Promtail]
                                              (DaemonSet)
                                              로그 수집 + 라벨 부착
                                                    │
                                              ┌─────┴──────┐
                                              │    Loki     │
                                              │  로그 저장   │
                                              │  + 인덱싱    │
                                              └─────┬──────┘
                                                    │
                                              ┌─────┴──────┐
                                              │   Grafana   │
                                              │  로그 검색   │
                                              │  + 시각화    │
                                              └────────────┘

Loki의 특징 (Prometheus와의 차이):
  - Prometheus: 메트릭(숫자) 저장 → PromQL로 검색
  - Loki: 로그(텍스트) 저장 → LogQL로 검색
  - Loki는 로그 내용을 인덱싱하지 않고, 라벨만 인덱싱 → 저렴한 스토리지 비용
  - "Like Prometheus, but for logs"
```

### 7.4 분산 트레이싱 (OpenTelemetry + Jaeger)

```
분산 트레이싱 (Distributed Tracing)
═══════════════════════════════════

분산 시스템에서 단일 요청이 다수의 마이크로서비스를 거치는 전체 호출 경로를
인과 관계(causality)와 타이밍 정보를 포함하여 기록하는 관측 기법이다.

분산 트레이싱:
  사용자 요청 → API Gateway → 주문 서비스 → 재고 서비스 → DB
                    │             │              │
                 Span 1        Span 2         Span 3
                 (10ms)        (50ms)         (200ms)
                    │             │              │
                    └─────────────┴──────────────┘
                          Trace (전체 요청 경로)
                          총 260ms

핵심 용어:
  Trace: 하나의 요청이 여러 서비스를 거치는 전체 경로
  Span: 각 서비스에서의 작업 단위 (시작 시간, 종료 시간, 메타데이터)
  Trace ID: 하나의 요청을 추적하는 고유 ID (모든 Span이 공유)
  Parent Span ID: 부모 Span의 ID (호출 관계를 나타냄)

OpenTelemetry의 역할:
  - 트레이스, 메트릭, 로그를 통합 수집하는 표준 (CNCF Incubating)
  - 벤더 중립: Jaeger, Zipkin, Datadog 등 다양한 백엔드와 호환
  - SDK + Collector 구조: 앱에 SDK를 적용 → Collector가 수집 → 백엔드 전송
```

---

## 8. 트러블슈팅

### Prometheus 스크래핑 실패

```
증상: 특정 타겟이 Prometheus에서 "down" 상태이다

디버깅 순서:
  1. Prometheus UI에서 Targets 페이지 확인
     → http://<prometheus-ip>:9090/targets
  2. ServiceMonitor의 selector가 올바른 Service를 지정하는지 확인
     $ kubectl get servicemonitor -n monitoring -o yaml
  3. 타겟 Pod의 /metrics 엔드포인트가 정상인지 직접 확인
     $ kubectl port-forward <pod-name> 9090:9090 -n <namespace>
     $ curl http://localhost:9090/metrics
  4. 네트워크 정책(NetworkPolicy)이 Prometheus에서 타겟으로의 접근을 차단하는지 확인

핵심: Pull 기반의 장점은 타겟이 다운되면 즉시 감지할 수 있다는 것이다.
     스크래핑 실패 자체가 타겟 장애의 신호이다.
```

### 로그 수집 누락

```
증상: Grafana에서 특정 Pod의 로그가 검색되지 않는다

원인 분석:
  1. Promtail/Fluent Bit DaemonSet이 해당 노드에서 동작하지 않는다
  2. Pod가 stdout/stderr가 아닌 파일에 로그를 기록하고 있다
     → Kubernetes는 stdout/stderr만 /var/log/pods/에 수집한다
  3. Loki에 라벨 카디널리티 문제가 있다

디버깅:
  $ kubectl get daemonset -n monitoring | grep promtail
  $ kubectl logs <promtail-pod> -n monitoring | grep error
```

---

## 9. 복습 체크리스트

- [ ] 관측성 3대 축: Metrics, Logs, Traces (도구명이 아님!)
- [ ] Prometheus = Pull 기반 메트릭 수집 (Push가 아님!)
- [ ] Prometheus 메트릭 유형 4가지: Counter(증가만), Gauge(증감), Histogram(분포), Summary(백분위)
- [ ] Fluentd = CNCF 졸업, 통합 로깅 계층, DaemonSet 배포
- [ ] Fluent Bit = Fluentd 경량 버전, CNCF 졸업
- [ ] Loki = "Prometheus의 로그 버전", 라벨만 인덱싱, LogQL
- [ ] Jaeger = CNCF 졸업, 분산 트레이싱, Uber 개발
- [ ] OpenTelemetry = 벤더 중립적, 관측성 통합 프레임워크, CNCF 인큐베이팅
- [ ] EFK Stack = Elasticsearch + Fluentd + Kibana
- [ ] ResourceQuota = 네임스페이스별 리소스 총량 제한
- [ ] LimitRange = Pod/컨테이너별 기본 리소스 설정

---

## 10. 내일 학습 예고

> Day 8에서는 Cloud Native Application Delivery를 학습한다. GitOps의 핵심 4대 원칙과 ArgoCD/Flux의 차이, Helm과 Kustomize 비교, CI/CD 파이프라인과 배포 전략(롤링, 블루/그린, 카나리)을 다룬다.

---

## tart-infra 실습

### 실습 환경 설정

```bash
# platform 클러스터에 접속 (모니터링 + GitOps 도구가 설치된 환경)
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/platform.yaml
kubectl get nodes
```

**예상 출력:**
```
NAME               STATUS   ROLES           AGE   VERSION
platform-master    Ready    control-plane   30d   v1.31.0
platform-worker1   Ready    <none>          30d   v1.31.0
platform-worker2   Ready    <none>          30d   v1.31.0
```

### 실습 1: 관측성(Observability) 3대 축 확인

```bash
# Prometheus (메트릭) 확인
kubectl get pods -n monitoring -l app.kubernetes.io/name=prometheus 2>/dev/null || kubectl get pods -n monitoring 2>/dev/null | grep prometheus
```

검증:

```text
prometheus-kube-prometheus-prometheus-0   2/2     Running   0          30d
```

```bash
# Grafana (시각화) 확인 - NodePort 30300
kubectl get svc -n monitoring 2>/dev/null | grep grafana
```

검증:

```text
grafana   NodePort   10.96.x.x   <none>   80:30300/TCP   30d
```

```bash
# Loki (로그) 확인
kubectl get pods -n monitoring 2>/dev/null | grep loki
```

검증:

```text
loki-0   1/1     Running   0          30d
```

```bash
# AlertManager (알림) 확인 - NodePort 30903
kubectl get svc -n monitoring 2>/dev/null | grep alertmanager
```

검증:

```text
alertmanager-operated   ClusterIP   None   <none>   9093/TCP,9094/TCP,9094/UDP   30d
```

**동작 원리:** 관측성 3대 축:
1. **Metrics** (Prometheus): 시계열 데이터를 Pull 방식으로 수집. Counter(증가만)/Gauge(증감)/Histogram/Summary 타입
2. **Logs** (Loki): 로그 데이터를 라벨 기반으로 인덱싱. LogQL로 쿼리
3. **Traces** (Jaeger/OpenTelemetry): 분산 트레이싱 — 요청이 여러 서비스를 거치는 경로 추적
4. Grafana가 이 세 가지를 하나의 대시보드에서 통합 시각화한다

```bash
# Grafana 접근 URL
PLATFORM_IP=$(kubectl get node platform-worker1 -o jsonpath='{.status.addresses[0].address}')
echo "Grafana: http://${PLATFORM_IP}:30300"
echo "AlertManager: http://${PLATFORM_IP}:30903"
```

### 실습 2: Prometheus 메트릭 수집 확인

```bash
# ServiceMonitor 확인 (어떤 Service를 스크래핑하는지)
kubectl get servicemonitor -n monitoring 2>/dev/null

# PrometheusRule 확인 (알림 규칙)
kubectl get prometheusrule -n monitoring 2>/dev/null
```

**동작 원리:** Prometheus 동작 방식:
1. **Pull 기반**: Prometheus가 타겟의 /metrics 엔드포인트를 주기적으로 스크래핑
2. **ServiceMonitor**: 어떤 Service를 스크래핑할지 CRD로 선언적 정의
3. **PrometheusRule**: 알림 규칙을 CRD로 정의 (Alert → AlertManager → Slack/Email)
4. **PromQL**: rate(), sum(), avg() 등으로 메트릭 분석
