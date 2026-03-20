# Day 1: 성능 테스트 이론

성능 테스트의 기본 개념, 부하 테스트 6가지 유형(Smoke, Load, Stress, Spike, Soak, Breakpoint), Capacity Planning, Little's Law, Percentile 수학을 다룬다.

---

# k6 - 성능 및 부하 테스트 완전 가이드

---

# Part 1: 성능 테스트 이론

---

## 1.1 성능 테스트란 무엇인가

성능 테스트(Performance Testing)는 시스템이 특정 워크로드 조건에서 얼마나 잘 동작하는지를 측정하는 활동이다. 단순히 "서버가 죽는지"를 확인하는 것이 아니라, 응답 시간(latency), 처리량(throughput), 자원 사용률(resource utilization), 안정성(stability)을 정량적으로 측정하고 분석하는 것이 목적이다.

성능 테스트는 다음과 같은 질문에 답을 제공한다:

- 시스템이 동시 사용자 1,000명을 처리할 수 있는가?
- 응답 시간의 95번째 백분위수(p95)가 SLA 기준 내에 있는가?
- 24시간 연속 운영 시 메모리 누수가 발생하는가?
- 트래픽이 갑작스럽게 10배 증가하면 시스템이 어떻게 반응하는가?
- 자동 스케일링(HPA)이 부하에 적절히 대응하는가?

### 성능 테스트 vs 기능 테스트

| 구분 | 기능 테스트 | 성능 테스트 |
|------|------------|------------|
| 목적 | "올바르게 동작하는가?" | "얼마나 빠르고 안정적인가?" |
| 사용자 수 | 단일 사용자 | 다수의 동시 사용자 |
| 관심 지표 | 정확성(correctness) | 응답 시간, 처리량, 에러율 |
| 실행 환경 | 개발/테스트 환경 | 프로덕션과 유사한 환경 |
| 실행 빈도 | 모든 코드 변경 시 | 릴리스 전, 정기적 |

---

## 1.2 부하 테스트 유형 상세

부하 테스트에는 6가지 주요 유형이 존재한다. 각각의 목적과 설정 방식이 다르며, 프로젝트의 요구사항에 따라 적절한 유형을 선택해야 한다.

### Smoke Test (연기 테스트)

Smoke test는 최소한의 부하로 시스템의 기본 동작을 확인하는 테스트이다. 새로운 배포 후 "시스템이 기본적으로 동작하는가?"를 빠르게 검증하는 것이 목적이다.

```
VU(부하)
  │
  5│ ─────────────────
  │
  0└──────────────────── 시간
    0        1m
```

**특성:**
- VU: 1~5명
- Duration: 30초 ~ 2분
- 목적: 기본 기능 동작 확인, 스크립트 오류 검출
- 사용 시점: CI/CD 파이프라인의 첫 번째 게이트, 배포 직후 검증
- 기대 결과: 에러율 0%, 응답 시간 정상 범위

```javascript
// smoke-test.js — tart-infra 프로젝트용
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 1,
  duration: '1m',
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate==0'],  // 에러가 전혀 없어야 한다
  },
};

export default function () {
  const res = http.get('http://nginx-web.demo.svc.cluster.local');
  check(res, {
    'status is 200': (r) => r.status === 200,
    'body is not empty': (r) => r.body.length > 0,
    'response time < 500ms': (r) => r.timings.duration < 500,
  });
  sleep(1);
}
```

### Load Test (부하 테스트)

Load test는 예상되는 정상 트래픽 수준에서 시스템의 동작을 확인하는 테스트이다. "프로덕션 트래픽 패턴에서 SLA를 충족하는가?"를 검증한다.

```
VU(부하)
  │        ┌──────────┐
 50│        │          │
  │      ╱ │          │ ╲
 20│    ╱   │          │   ╲
  │  ╱     │          │     ╲
  0│╱       │          │       ╲
  └──────────────────────────── 시간
   0   2m   4m        9m  11m 13m
      ramp  sustain        ramp
       up                  down
```

**특성:**
- VU: 예상 동시 사용자 수 (일반적으로 50~200)
- Duration: 10분 ~ 30분
- 목적: SLA 충족 여부, 평균/p95/p99 응답 시간 측정
- 사용 시점: 릴리스 전 검증, 정기적 성능 회귀 테스트
- 기대 결과: SLA 기준 내 응답 시간, 에러율 < 1%

### Stress Test (스트레스 테스트)

Stress test는 시스템을 예상 트래픽 이상으로 밀어붙여 한계 상황에서의 동작을 확인하는 테스트이다. "시스템이 과부하 상황에서 어떻게 degradation되는가?"를 확인한다.

```
VU(부하)
  │                  ┌────┐
300│                  │    │
  │            ┌────┐│    │
200│            │    ││    │
  │      ┌────┐│    ││    │ ╲
100│      │    ││    ││    │   ╲
  │    ╱ │    ││    ││    │     ╲
  0│──╱   │    ││    ││    │       ╲
  └──────────────────────────────── 시간
   0  2m  4m   9m  11m  16m  21m 26m
```

**특성:**
- VU: 정상 트래픽의 2~5배
- Duration: 20분 ~ 1시간
- 목적: breaking point 발견, 에러 처리 동작 확인, graceful degradation 검증
- 사용 시점: 새로운 인프라 구성 후, 대규모 이벤트 전
- 기대 결과: 시스템이 점진적으로 성능 저하되되, crash하지 않아야 한다

### Spike Test (스파이크 테스트)

Spike test는 극단적으로 짧은 시간 내에 부하를 급증시켜 시스템의 반응을 확인하는 테스트이다. 플래시 세일, 뉴스 이벤트, 마케팅 캠페인 등 갑작스러운 트래픽 폭증을 시뮬레이션한다.

```
VU(부하)
  │        ╱╲
1000│       ╱  ╲
  │      ╱    ╲
  │     ╱      ╲
  │    ╱        ╲
 10│───╱          ╲────────
  └──────────────────────── 시간
   0  1m  3m  5m  7m   10m
```

**특성:**
- VU: 정상의 10~100배로 급증 후 급감
- Duration: 5~15분
- 목적: 자동 스케일링 검증, 서킷 브레이커 동작 확인
- 사용 시점: HPA 설정 검증, 대규모 이벤트 대비
- 기대 결과: 자동 스케일링 작동, 일시적 성능 저하 후 복구

```javascript
// spike-test.js — tart-infra 프로젝트용
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '1m', target: 10 },     // 정상 트래픽
    { duration: '30s', target: 1000 },   // 급격한 폭증
    { duration: '2m', target: 1000 },    // 최대 부하 유지
    { duration: '30s', target: 10 },     // 급격한 감소
    { duration: '3m', target: 10 },      // 복구 확인
  ],
  thresholds: {
    http_req_failed: ['rate<0.15'],  // 스파이크 중 15% 미만 에러 허용
  },
};

export default function () {
  const res = http.get('http://nginx-web.demo.svc.cluster.local');
  check(res, { 'status is 200': (r) => r.status === 200 });
  sleep(0.1);
}
```

### Soak Test (내구성 테스트)

Soak test는 장시간 동안 일정한 부하를 유지하여 시스템의 안정성을 확인하는 테스트이다. 시간이 지남에 따라 나타나는 문제(메모리 누수, 연결 풀 고갈, 파일 디스크립터 소진 등)를 발견하는 것이 목적이다.

```
VU(부하)
  │    ┌──────────────────────────────┐
100│    │                              │
  │  ╱ │                              │ ╲
  0│╱   │                              │   ╲
  └──────────────────────────────────────── 시간
   0  5m                           2h+   2h10m
```

**특성:**
- VU: 예상 동시 사용자 수 (정상 수준)
- Duration: 2시간 ~ 24시간
- 목적: 메모리 누수 탐지, 연결 풀 고갈 확인, 로그 디스크 사용량 확인
- 사용 시점: 대규모 배포 전, 정기적 안정성 검증
- 기대 결과: 응답 시간이 시간에 따라 증가하지 않아야 한다

**Soak test로 발견할 수 있는 문제:**
- 메모리 누수: 시간이 지남에 따라 메모리 사용량이 지속적으로 증가
- 연결 풀 고갈: DB 연결이 제대로 반환되지 않아 고갈
- 파일 디스크립터 소진: 열린 파일/소켓 수가 지속적으로 증가
- 로그 디스크 사용량: 로그 파일이 디스크를 가득 채움
- GC pressure: 가비지 컬렉션 빈도 증가로 인한 성능 저하

### Breakpoint Test (한계점 테스트)

Breakpoint test는 시스템의 절대적인 한계점(breaking point)을 찾는 테스트이다. VU를 점진적으로 증가시키며 시스템이 더 이상 정상적으로 동작하지 않는 지점을 탐지한다.

```
VU(부하)
  │                          ╱ ← 에러율 급증 (breaking point)
  │                        ╱
  │                      ╱
  │                    ╱
  │                  ╱
  │                ╱
  │              ╱
  │            ╱
  │          ╱
  │        ╱
  │      ╱
  │    ╱
  │  ╱
  0│╱
  └──────────────────────── 시간
```

**특성:**
- VU: 0에서 시작하여 시스템이 실패할 때까지 점진적 증가
- Duration: 가변적 (시스템이 실패할 때까지)
- 목적: 최대 처리 용량(capacity) 확인
- 사용 시점: 용량 계획(capacity planning) 수립 시

```javascript
// breakpoint-test.js
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  executor: 'ramping-arrival-rate',
  stages: [
    { duration: '2m', target: 100 },    // 분당 100 요청
    { duration: '2m', target: 500 },    // 분당 500 요청
    { duration: '2m', target: 1000 },   // 분당 1000 요청
    { duration: '2m', target: 2000 },   // 분당 2000 요청
    { duration: '2m', target: 5000 },   // 분당 5000 요청
    { duration: '2m', target: 10000 },  // 분당 10000 요청
  ],
  preAllocatedVUs: 500,
  maxVUs: 2000,
  thresholds: {
    http_req_failed: [{
      threshold: 'rate<0.10',
      abortOnFail: true,      // 에러율 10% 초과 시 중단
      delayAbortEval: '30s',
    }],
  },
};

export default function () {
  const res = http.get('http://nginx-web.demo.svc.cluster.local');
  check(res, { 'status is 200': (r) => r.status === 200 });
  sleep(0.01);
}
```

---

## 1.3 Capacity Planning (용량 계획)

Capacity planning은 현재와 미래의 워크로드를 처리하기 위해 필요한 인프라 자원을 결정하는 과정이다. 성능 테스트 결과는 용량 계획의 핵심 입력 데이터가 된다.

### 용량 계획의 핵심 지표

| 지표 | 설명 | 측정 방법 |
|------|------|-----------|
| Peak Concurrent Users | 동시 접속 최대 사용자 수 | APM, 로그 분석 |
| Requests Per Second (RPS) | 초당 처리 요청 수 | 부하 테스트 |
| Average Response Time | 평균 응답 시간 | 부하 테스트 |
| Error Rate at Capacity | 최대 용량 시 에러율 | Breakpoint test |
| Resource Utilization | CPU, 메모리, 네트워크 사용률 | 모니터링 |

### 용량 계획 프로세스

```
1. 현재 워크로드 분석
   └→ APM/로그에서 현재 peak 트래픽 패턴 추출

2. 성장 예측
   └→ 비즈니스 성장률, 이벤트 계획 반영

3. 성능 테스트 실행
   └→ Breakpoint test로 현재 시스템의 한계점 파악

4. 용량 격차 분석
   └→ (예상 peak 트래픽) vs (현재 한계점) 비교

5. 스케일링 계획 수립
   └→ 수평 확장(replica 수), 수직 확장(resource limits) 결정

6. 검증
   └→ 스케일링 적용 후 재테스트
```

---

## 1.4 Little's Law (리틀의 법칙)

Little's law는 큐잉 이론(queueing theory)에서 가장 기본적인 법칙으로, 시스템의 동시 사용자 수, 처리량, 응답 시간 사이의 관계를 정의한다. 성능 테스트에서 VU 수를 결정할 때 핵심적으로 활용된다.

### 공식

```
L = λ × W

L : 시스템 내 평균 동시 요청 수 (= 동시 사용자 수, VU)
λ : 단위 시간당 도착률 (= throughput, requests/second)
W : 평균 체류 시간 (= 응답 시간, seconds)
```

### 실전 적용

**예시 1: VU 수 결정**

"초당 100건(λ=100 RPS)을 처리해야 하고, 평균 응답 시간이 200ms(W=0.2s)인 시스템"에 필요한 VU 수는:

```
L = λ × W
L = 100 × 0.2
L = 20 VU
```

따라서 20 VU로 테스트하면 초당 약 100건의 요청이 생성된다.

**예시 2: 예상 RPS 계산**

"VU 50개, 평균 응답 시간 500ms(0.5s)"인 테스트의 예상 RPS는:

```
λ = L / W
λ = 50 / 0.5
λ = 100 RPS
```

**예시 3: tart-infra 프로젝트 적용**

프로젝트의 `k6-loadtest.yaml`은 VU=100, 테스트 대상은 nginx-web이다. nginx의 평균 응답 시간이 10ms(0.01s)라고 가정하면:

```
λ = L / W
λ = 100 / (0.01 + 0.3)    ← sleep(0.3) 포함
λ = 100 / 0.31
λ ≈ 323 RPS
```

sleep(0.3)을 포함하면 실제 RPS는 약 323이 된다. sleep 없이는 약 10,000 RPS가 가능하다.

### Little's Law를 사용한 k6 설정 역산

목표 성능 요구사항에서 k6 설정값을 역산하는 과정:

```
목표:
  - Target RPS: 500
  - Expected avg response time: 200ms
  - Test duration: 5분

계산:
  VU = RPS × avg_response_time
  VU = 500 × 0.2
  VU = 100

k6 설정:
  vus: 100
  duration: '5m'

검증:
  테스트 실행 후 실제 RPS가 500에 근접하는지 확인한다.
  목표에 미달하면 VU를 늘리거나 sleep을 조정한다.
```

> **주의**: Little's law는 정상 상태(steady state)를 가정한다. 시스템이 포화 상태에 이르면 응답 시간이 급격히 증가하여 실제 RPS는 예상보다 낮아진다. 이것이 바로 Closed model의 "coordinated omission" 문제이다.

---

## 1.5 Percentile 수학 (백분위수)

성능 측정에서 평균(average)만으로는 시스템의 실제 성능을 정확히 파악할 수 없다. 백분위수(percentile)가 훨씬 더 의미 있는 지표이다.

### 왜 평균이 아닌 백분위수인가

다음 두 시스템의 응답 시간 분포를 비교하자:

```
시스템 A: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10] ms
  avg = 10ms, p50 = 10ms, p95 = 10ms, p99 = 10ms

시스템 B: [5, 5, 5, 5, 5, 5, 5, 5, 5, 500] ms
  avg = 54ms, p50 = 5ms, p95 = 5ms, p99 = 500ms
```

시스템 B의 평균은 54ms로 시스템 A보다 5배 느려 보이지만, 실제로는 99%의 요청이 5ms 이내에 처리된다. 한편 p99는 500ms로 극단적인 지연이 존재함을 보여준다. 이처럼 **평균은 이상치(outlier)에 왜곡되기 쉬우므로, 백분위수를 사용해야 한다**.

### 백분위수의 의미

| 백분위수 | 의미 | 활용 |
|----------|------|------|
| p50 (median) | 요청의 50%가 이 값 이하 | "일반적인" 사용자 경험 |
| p90 | 요청의 90%가 이 값 이하 | 대부분의 사용자 경험 |
| p95 | 요청의 95%가 이 값 이하 | SLA에 자주 사용 |
| p99 | 요청의 99%가 이 값 이하 | tail latency 관리 |
| p99.9 | 요청의 99.9%가 이 값 이하 | 극단적 tail latency |

### 백분위수 계산 예시

100개의 요청 응답 시간이 있다고 가정하면:

```
p95를 계산하려면:
  1. 모든 응답 시간을 오름차순 정렬한다
  2. 95번째 값 (100 × 0.95 = 95번째)을 찾는다
  3. 이 값이 p95이다

예: [1, 2, 3, ..., 95, 100, 200, 300, 500, 1000] ms
p95 = 95ms  (95번째 값)
p99 = 500ms (99번째 값)
```

### SLA에서의 백분위수

실무에서 SLA(Service Level Agreement)는 일반적으로 다음과 같이 정의된다:

```
SLA 예시:
  - "API 응답 시간 p95 < 200ms"
    → 95%의 요청이 200ms 이내에 처리되어야 한다
  - "에러율 < 0.1%"
    → 1000건 중 1건 미만의 에러가 허용된다
  - "가용성 99.9%"
    → 월간 다운타임 43분 이내

k6 threshold 매핑:
  thresholds: {
    http_req_duration: ['p(95)<200'],
    http_req_failed: ['rate<0.001'],
  }
```

### HDR Histogram (High Dynamic Range Histogram)

k6는 내부적으로 HDR Histogram을 사용하여 백분위수를 계산한다. HDR Histogram은 넓은 범위의 값을 일정한 상대 오차로 기록할 수 있는 자료구조이다. 이를 통해 메모리를 효율적으로 사용하면서도 정확한 백분위수를 제공한다.

일반적인 히스토그램은 버킷 경계를 미리 정해야 하지만, HDR Histogram은 값의 범위가 넓어도(1 마이크로초 ~ 1시간) 일정한 정밀도(예: 유효숫자 3자리)를 유지한다.

---

