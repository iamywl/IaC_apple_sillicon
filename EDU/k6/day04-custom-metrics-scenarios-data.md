# Day 4: Custom Metrics, Scenarios, Data Parameterization

사용자 정의 메트릭(Counter, Gauge, Rate, Trend), Metric Tagging, Executor 상세(shared-iterations, per-vu-iterations, constant-vus 등), 복합 Scenario 구성, 그리고 데이터 파라미터화를 다룬다.

---

# Part 5: Custom Metrics (사용자 정의 메트릭)

---

## 5.1 Metric 유형 상세

k6는 4가지 custom metric 유형을 제공한다. 각각의 특성과 적합한 사용 사례가 다르다.

### Counter — 누적 합계

Counter는 값을 누적하는 metric이다. "총 얼마나 발생했는가?"를 측정한다.

```javascript
import { Counter } from 'k6/metrics';

const totalErrors = new Counter('total_errors');
const totalBytes = new Counter('total_bytes_processed');
const retryCount = new Counter('retry_count');

export const options = {
  thresholds: {
    total_errors: ['count<100'],         // 전체 에러 100건 미만
    retry_count: ['count<50'],           // 재시도 50건 미만
  },
};

export default function () {
  const res = http.get('http://nginx-web.demo.svc.cluster.local');

  if (res.status !== 200) {
    totalErrors.add(1);  // 에러 1건 카운트
  }

  totalBytes.add(res.body.length);  // 수신 바이트 누적

  // 재시도 로직
  if (res.status === 503) {
    retryCount.add(1);
    sleep(1);
    http.get('http://nginx-web.demo.svc.cluster.local');  // 재시도
  }
}
```

**Counter 집계 함수:** `count` (누적 합계), `rate` (초당 증가율)

### Gauge — 현재 상태값

Gauge는 마지막으로 추가된 값만 유지한다. "현재 상태가 어떤가?"를 측정한다.

```javascript
import { Gauge } from 'k6/metrics';

const queueSize = new Gauge('queue_size');
const lastResponseTime = new Gauge('last_response_time');
const memoryUsage = new Gauge('memory_usage_mb');

export const options = {
  thresholds: {
    queue_size: ['value<1000'],           // 큐 크기 1000 미만
    last_response_time: ['value<500'],    // 마지막 응답 시간 500ms 미만
  },
};

export default function () {
  const res = http.get('http://api.example.com/stats');
  const stats = res.json();

  queueSize.add(stats.queueSize);               // 현재 큐 크기
  lastResponseTime.add(res.timings.duration);    // 마지막 응답 시간
  memoryUsage.add(stats.memoryMB);               // 현재 메모리 사용량
}
```

**Gauge 집계 함수:** `value` (마지막 값)

### Rate — 비율

Rate는 0이 아닌 값(true)의 비율을 계산한다. "성공/실패 비율이 어떤가?"를 측정한다.

```javascript
import { Rate } from 'k6/metrics';

const successRate = new Rate('success_rate');
const cacheHitRate = new Rate('cache_hit_rate');
const slaCompliance = new Rate('sla_compliance');

export const options = {
  thresholds: {
    success_rate: ['rate>0.99'],          // 성공률 99% 이상
    cache_hit_rate: ['rate>0.80'],        // 캐시 히트율 80% 이상
    sla_compliance: ['rate>0.95'],        // SLA 준수율 95% 이상
  },
};

export default function () {
  const res = http.get('http://nginx-web.demo.svc.cluster.local');

  // boolean 값 추가 (true=1, false=0)
  successRate.add(res.status === 200);

  // 캐시 히트 여부
  cacheHitRate.add(res.headers['X-Cache'] === 'HIT');

  // SLA 준수 (p95 < 200ms)
  slaCompliance.add(res.timings.duration < 200);
}
```

**Rate 집계 함수:** `rate` (true 비율, 0.0~1.0)

### Trend — 통계 분석 가능한 값 집합

Trend는 값의 분포를 기록하여 통계 분석(avg, min, max, med, p(N))이 가능한 metric이다. "응답 시간의 분포가 어떤가?"를 측정한다.

```javascript
import { Trend } from 'k6/metrics';

const loginLatency = new Trend('login_latency', true);    // true: 밀리초 단위
const queryLatency = new Trend('query_latency', true);
const payloadSize = new Trend('payload_size');

export const options = {
  thresholds: {
    login_latency: ['p(95)<1000', 'avg<500', 'med<300'],
    query_latency: ['p(95)<200', 'max<2000'],
    payload_size: ['avg<10240'],    // 평균 페이로드 10KB 미만
  },
};

export default function () {
  const loginRes = http.post('http://api.example.com/login', /* ... */);
  loginLatency.add(loginRes.timings.duration);

  const queryRes = http.get('http://api.example.com/data');
  queryLatency.add(queryRes.timings.duration);
  payloadSize.add(queryRes.body.length);
}
```

**Trend 집계 함수:** `avg`, `min`, `max`, `med`, `p(N)`, `count`

---

## 5.2 Metric Tagging과 Sub-metrics

Custom metric에 태그를 추가하여 세분화된 분석이 가능하다:

```javascript
import http from 'k6/http';
import { Trend, Counter } from 'k6/metrics';

const apiLatency = new Trend('api_latency', true);
const apiErrors = new Counter('api_errors');

export const options = {
  thresholds: {
    // 태그별 sub-metric threshold
    'api_latency{endpoint:users}': ['p(95)<300'],
    'api_latency{endpoint:orders}': ['p(95)<500'],
    'api_latency{method:GET}': ['avg<200'],
    'api_latency{method:POST}': ['avg<400'],
    'api_errors{severity:critical}': ['count<5'],
  },
};

export default function () {
  const usersRes = http.get('http://api.example.com/users');
  apiLatency.add(usersRes.timings.duration, {
    endpoint: 'users',
    method: 'GET',
  });

  const orderRes = http.post('http://api.example.com/orders', /* ... */);
  apiLatency.add(orderRes.timings.duration, {
    endpoint: 'orders',
    method: 'POST',
  });

  if (orderRes.status >= 500) {
    apiErrors.add(1, { severity: 'critical', endpoint: 'orders' });
  } else if (orderRes.status >= 400) {
    apiErrors.add(1, { severity: 'warning', endpoint: 'orders' });
  }
}
```

---

# Part 6: Scenarios & Executors 심화

---

## 6.1 Executor 상세

k6는 6가지 executor를 제공한다. 각각의 사용 목적이 다르다:

### Closed Model Executor

| Executor | 동작 | 사용 시점 |
|----------|------|-----------|
| `shared-iterations` | 전체 VU가 총 N회 iteration을 나누어 실행한다 | 정확히 N번의 요청이 필요할 때 (데이터 마이그레이션 등) |
| `per-vu-iterations` | 각 VU가 N회 iteration을 실행한다 | VU별 균등한 작업량이 필요할 때 |
| `constant-vus` | 고정된 VU 수로 duration 동안 실행한다 | 기본적인 부하 테스트 |
| `ramping-vus` | stages에 따라 VU 수를 증감한다 | ramp-up/down 패턴이 필요할 때 |

### Open Model Executor

| Executor | 동작 | 사용 시점 |
|----------|------|-----------|
| `constant-arrival-rate` | 초당 고정된 수의 iteration을 시작한다. 응답 지연 시 VU를 자동 추가한다(maxVUs까지) | 일정한 throughput을 유지해야 할 때 |
| `ramping-arrival-rate` | stages에 따라 iteration rate를 증감한다 | 점진적으로 throughput을 변경할 때 |

### shared-iterations 상세

전체 VU가 총 iterations를 공유하여 나누어 실행한다. 빠른 VU가 더 많은 iteration을 처리한다.

```javascript
export const options = {
  scenarios: {
    data_migration: {
      executor: 'shared-iterations',
      vus: 10,                  // 10개 VU가 공유
      iterations: 1000,         // 총 1000회 iteration
      maxDuration: '30m',       // 최대 30분
    },
  },
};

// 사용 예: 정확히 1000개의 레코드를 처리해야 할 때
export default function () {
  const recordId = __ITER;  // 0~999, VU간 중복 없음
  http.post(`http://api.example.com/migrate/${recordId}`);
}
```

**특성:**
- 총 iteration 수가 정확히 보장된다
- 빠른 VU가 더 많은 iteration을 처리하므로, VU 간 작업량이 불균등하다
- `__ITER`는 VU 내에서의 iteration 번호이므로 전역적으로 유일하지 않다

### per-vu-iterations 상세

각 VU가 정해진 iterations 수를 독립적으로 실행한다.

```javascript
export const options = {
  scenarios: {
    user_workflow: {
      executor: 'per-vu-iterations',
      vus: 50,                  // 50개 VU
      iterations: 20,           // 각 VU가 20회 실행
      maxDuration: '10m',       // 최대 10분
    },
  },
};

// 사용 예: 각 사용자가 동일한 워크플로우를 20번 반복
// 총 iteration = 50 × 20 = 1000
```

**특성:**
- 각 VU가 정확히 N회 iteration을 실행한다
- VU 간 작업량이 균등하다
- 총 iteration 수 = VU 수 × iterations

### constant-vus 상세

가장 기본적인 executor이다. 고정된 VU 수로 duration 동안 실행한다.

```javascript
export const options = {
  scenarios: {
    steady_load: {
      executor: 'constant-vus',
      vus: 100,                 // 100개 VU
      duration: '5m',           // 5분 동안
      gracefulStop: '30s',      // 종료 시 30초 대기
    },
  },
};

// vus + duration의 단축 표현:
export const optionsShort = {
  vus: 100,
  duration: '5m',
  // 이것은 executor: 'constant-vus'와 동일하다
};
```

### ramping-vus 상세

stages에 따라 VU 수를 증감한다. 가장 많이 사용되는 executor이다.

```javascript
export const options = {
  scenarios: {
    load_test: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '2m', target: 50 },    // 0→50 VU (2분)
        { duration: '5m', target: 50 },    // 50 VU 유지 (5분)
        { duration: '2m', target: 100 },   // 50→100 VU (2분)
        { duration: '5m', target: 100 },   // 100 VU 유지 (5분)
        { duration: '3m', target: 0 },     // 100→0 VU (3분)
      ],
      gracefulRampDown: '30s',  // VU 감소 시 진행 중 iteration 완료 대기
    },
  },
};
```

**gracefulRampDown 동작:**
VU 수가 감소할 때, 이미 iteration을 시작한 VU는 즉시 중단되지 않고 `gracefulRampDown` 시간 동안 현재 iteration을 완료할 기회를 받는다. 이 시간이 지나면 강제 중단된다.

### constant-arrival-rate 상세

Open model executor이다. 서버 응답 속도와 무관하게 일정한 rate로 새 iteration을 시작한다.

```javascript
export const options = {
  scenarios: {
    constant_throughput: {
      executor: 'constant-arrival-rate',
      rate: 50,                 // 초당 50 iteration
      timeUnit: '1s',           // rate의 시간 단위
      duration: '5m',           // 5분 동안
      preAllocatedVUs: 50,      // 미리 할당할 VU 수
      maxVUs: 200,              // 응답 지연 시 최대 VU 수
    },
  },
};
```

**핵심 개념:**
- `rate`: 단위 시간(`timeUnit`)당 시작할 iteration 수
- `preAllocatedVUs`: 테스트 시작 시 미리 생성할 VU 수 (VU 생성 오버헤드 방지)
- `maxVUs`: 응답이 느려져 VU가 부족할 때 최대 생성할 수 있는 VU 수
- `dropped_iterations`: maxVUs에 도달하여 시작하지 못한 iteration 수 (이 값이 0이어야 한다)

**VU 부족 시 동작:**
```
Rate = 50 iter/s, 응답 시간 = 100ms → 필요 VU = 50 × 0.1 = 5 (여유 있음)
Rate = 50 iter/s, 응답 시간 = 2s   → 필요 VU = 50 × 2 = 100 (VU 추가 필요)
Rate = 50 iter/s, 응답 시간 = 5s   → 필요 VU = 50 × 5 = 250 (maxVUs 초과!)
  → maxVUs=200이므로 초당 50 iteration을 유지할 수 없다
  → dropped_iterations가 발생한다
```

### ramping-arrival-rate 상세

stages에 따라 iteration rate를 증감한다. Breakpoint test에 적합하다.

```javascript
export const options = {
  scenarios: {
    ramp_throughput: {
      executor: 'ramping-arrival-rate',
      startRate: 10,            // 초당 10 iteration으로 시작
      timeUnit: '1s',
      stages: [
        { duration: '2m', target: 50 },    // 초당 50으로 증가
        { duration: '3m', target: 50 },    // 초당 50 유지
        { duration: '2m', target: 100 },   // 초당 100으로 증가
        { duration: '3m', target: 100 },   // 초당 100 유지
      ],
      preAllocatedVUs: 100,
      maxVUs: 500,
    },
  },
};
```

---

## 6.2 복합 Scenario 구성

여러 시나리오를 병렬로 실행하여 실제 프로덕션 트래픽 패턴을 시뮬레이션할 수 있다.

```javascript
import http from 'k6/http';
import { sleep } from 'k6';

export const options = {
  scenarios: {
    // 시나리오 1: 읽기 트래픽 (높은 비율)
    readers: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '2m', target: 100 },
        { duration: '5m', target: 100 },
        { duration: '2m', target: 0 },
      ],
      gracefulRampDown: '30s',
      exec: 'readScenario',
    },
    // 시나리오 2: 쓰기 트래픽 (낮은 비율)
    writers: {
      executor: 'constant-arrival-rate',
      rate: 10,
      timeUnit: '1s',
      duration: '9m',
      preAllocatedVUs: 20,
      maxVUs: 50,
      gracefulStop: '1m',
      exec: 'writeScenario',
    },
  },
};

export function readScenario() {
  http.get('http://nginx-web.demo.svc.cluster.local');
  sleep(1);
}

export function writeScenario() {
  const payload = JSON.stringify({ name: `item-${Date.now()}` });
  http.post('http://httpbin.demo.svc.cluster.local/post', payload, {
    headers: { 'Content-Type': 'application/json' },
  });
}
```

### 시나리오 실행 타이밍 제어

```javascript
export const options = {
  scenarios: {
    // 즉시 시작
    warmup: {
      executor: 'constant-vus',
      vus: 5,
      duration: '1m',
      exec: 'warmupScenario',
    },
    // 1분 후 시작 (warmup 완료 후)
    main_load: {
      executor: 'ramping-vus',
      startTime: '1m',           // 테스트 시작 후 1분에 시작
      startVUs: 0,
      stages: [
        { duration: '3m', target: 100 },
        { duration: '5m', target: 100 },
        { duration: '2m', target: 0 },
      ],
      exec: 'mainScenario',
    },
    // 2분 후 시작 (main_load와 병렬 실행)
    spike: {
      executor: 'ramping-vus',
      startTime: '4m',           // 4분에 시작
      startVUs: 0,
      stages: [
        { duration: '30s', target: 500 },
        { duration: '1m', target: 500 },
        { duration: '30s', target: 0 },
      ],
      exec: 'mainScenario',
    },
  },
};
```

주요 시나리오 옵션:
- **`exec`**: 시나리오가 실행할 exported 함수명이다. 지정하지 않으면 `default`가 실행된다
- **`startTime`**: 테스트 시작 후 시나리오가 시작되는 시점이다 (기본값: `0s`)
- **`gracefulStop`**: 시나리오 종료 시점에 진행 중인 iteration의 완료를 기다리는 시간이다 (기본값: `30s`)
- **`gracefulRampDown`**: `ramping-vus`에서 VU 수를 줄일 때 진행 중인 iteration의 완료를 기다리는 시간이다 (기본값: `30s`)
- **`env`**: 시나리오별 환경 변수를 설정한다
- **`tags`**: 시나리오별 태그를 설정한다

---

# Part 7: Data Parameterization (데이터 파라미터화)

---

## 7.1 SharedArray

`SharedArray`는 init code에서 로드한 데이터를 모든 VU가 공유하는 read-only 배열이다. `open()`으로 읽은 데이터는 각 VU에 복사되지만, SharedArray는 단일 복사본을 공유하여 메모리를 절약한다.

```javascript
import { SharedArray } from 'k6/data';

// SharedArray: 메모리 효율적 (1개 복사본)
const users = new SharedArray('users', function () {
  return JSON.parse(open('./testdata/users.json'));
});

// open() 직접 사용: 메모리 비효율적 (VU 수만큼 복사)
// const users = JSON.parse(open('./testdata/users.json'));
// → VU 100개 × 10MB JSON = 1GB 메모리 사용

export default function () {
  // 배열 인덱스로 접근 (read-only)
  const user = users[__VU % users.length];
  console.log(user.username);
}
```

**메모리 비교:**

| 방식 | 100 VU × 10MB JSON | 1000 VU × 10MB JSON |
|------|---------------------|----------------------|
| `open()` 직접 | ~1 GB | ~10 GB |
| `SharedArray` | ~10 MB | ~10 MB |

### SharedArray의 제약사항

- **read-only**: 배열 내용을 수정할 수 없다
- **init code에서만 생성**: VU code에서 `new SharedArray()`를 호출할 수 없다
- **JSON 직렬화 가능한 데이터만**: 함수, Date 객체 등은 저장할 수 없다
- **인덱스 접근만 가능**: `forEach()`, `map()`, `filter()` 등 배열 메서드를 사용할 수 없다

---

## 7.2 CSV/JSON 데이터 로딩

### JSON 파일 로딩

```javascript
import { SharedArray } from 'k6/data';

// users.json: [{"username": "user1", "password": "pass1"}, ...]
const users = new SharedArray('users', function () {
  return JSON.parse(open('./testdata/users.json'));
});

export default function () {
  // 순차적 접근: 각 VU가 고유한 사용자 사용
  const user = users[__VU % users.length];

  // 랜덤 접근
  const randomUser = users[Math.floor(Math.random() * users.length)];
}
```

### CSV 파일 로딩

```javascript
import { SharedArray } from 'k6/data';
import papaparse from 'https://jslib.k6.io/papaparse/5.1.1/index.js';

// products.csv:
// id,name,price
// 1,Widget,9.99
// 2,Gadget,24.99
const products = new SharedArray('products', function () {
  return papaparse.parse(open('./testdata/products.csv'), {
    header: true,       // 첫 행을 헤더로 사용
    skipEmptyLines: true,
  }).data;
});

export default function () {
  const product = products[__ITER % products.length];
  console.log(`Product: ${product.name}, Price: ${product.price}`);
}
```

### CSV 수동 파싱 (외부 라이브러리 없이)

```javascript
import { SharedArray } from 'k6/data';

const csvData = new SharedArray('csv', function () {
  const lines = open('./testdata/data.csv').split('\n');
  const header = lines[0].split(',');
  return lines.slice(1).filter(line => line.length > 0).map(line => {
    const values = line.split(',');
    const obj = {};
    header.forEach((key, i) => {
      obj[key.trim()] = values[i] ? values[i].trim() : '';
    });
    return obj;
  });
});
```

---

## 7.3 환경 변수와 실행 컨텍스트

### __ENV — 환경 변수 접근

```javascript
export const options = {
  vus: __ENV.K6_VUS ? parseInt(__ENV.K6_VUS) : 10,
  duration: __ENV.K6_DURATION || '30s',
};

const BASE_URL = __ENV.BASE_URL || 'http://nginx-web.demo.svc.cluster.local';

export default function () {
  http.get(`${BASE_URL}/`);
}
```

```bash
# 환경 변수를 통한 설정 주입
K6_VUS=50 K6_DURATION=5m BASE_URL=http://nginx-web.demo.svc.cluster.local \
  k6 run script.js

# -e 플래그로도 전달 가능
k6 run -e BASE_URL=http://nginx-web.demo.svc.cluster.local script.js
```

### execution 컨텍스트 — k6/execution 모듈

```javascript
import exec from 'k6/execution';

export const options = {
  scenarios: {
    main: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m', target: 50 },
        { duration: '2m', target: 50 },
        { duration: '1m', target: 0 },
      ],
    },
  },
};

export default function () {
  // VU 정보
  console.log(`VU ID: ${exec.vu.idInInstance}`);      // VU 번호 (인스턴스 내)
  console.log(`VU ID (global): ${exec.vu.idInTest}`); // VU 번호 (테스트 전체)
  console.log(`Iteration (VU): ${exec.vu.iterationInInstance}`);   // VU 내 iteration 번호
  console.log(`Iteration (scenario): ${exec.vu.iterationInScenario}`); // 시나리오 내 iteration 번호

  // 시나리오 정보
  console.log(`Scenario: ${exec.scenario.name}`);              // 시나리오 이름
  console.log(`Executor: ${exec.scenario.executor}`);          // executor 이름
  console.log(`Progress: ${exec.scenario.progress}`);          // 진행률 (0.0~1.0)
  console.log(`Iteration: ${exec.scenario.iterationInInstance}`); // 시나리오 내 전체 iteration 수

  // 테스트 정보
  console.log(`Test running: ${exec.instance.vusActive}`);     // 현재 활성 VU 수
  console.log(`Iterations done: ${exec.instance.iterationsCompleted}`); // 완료된 iteration 수
}
```

### __VU와 __ITER

```javascript
export default function () {
  // __VU: 현재 VU의 번호 (1부터 시작)
  // __ITER: 현재 VU 내에서의 iteration 번호 (0부터 시작)

  console.log(`VU ${__VU}, Iteration ${__ITER}`);

  // 패턴: VU별로 다른 데이터 사용
  const userId = __VU;                     // VU 1 → user 1, VU 2 → user 2, ...
  const pageNum = __ITER + 1;              // iteration 0 → page 1, iteration 1 → page 2, ...
  const uniqueId = `${__VU}-${__ITER}`;    // 전역적으로 고유한 ID
}
```

---

