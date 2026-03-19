# k6 - 성능 및 부하 테스트

## 개념

### k6란?

k6는 Grafana Labs에서 개발한 오픈소스 부하 테스트 도구이다. 테스트 스크립트를 JavaScript(ES6+)로 작성하지만, 실행 엔진은 **Node.js가 아니라 Go 런타임에 내장된 goja JavaScript 엔진**이다. 이 아키텍처 선택이 k6의 핵심적인 성능 우위를 만든다.

#### Node.js가 아닌 이유

Node.js 기반 도구(Artillery, Locust의 JS 바인딩 등)는 event loop와 garbage collection 오버헤드로 인해 VU 수가 증가할수록 테스트 도구 자체가 병목이 되는 문제가 있다. k6는 Go로 작성된 네이티브 바이너리 내부에서 goja(순수 Go로 구현된 ES5.1+ 엔진)를 사용하여 JavaScript를 실행한다. 각 VU는 독립적인 goja 런타임 인스턴스를 갖기 때문에 다음과 같은 이점이 있다:

- **높은 동시성**: goroutine 기반 스케줄링으로 수천 VU를 단일 프로세스에서 실행할 수 있다
- **낮은 메모리 사용량**: Node.js 대비 VU당 메모리 사용량이 현저히 적다
- **예측 가능한 성능**: GC pause가 최소화되어 측정 결과의 정확도가 높다
- **단일 바이너리 배포**: 의존성 없이 바이너리 하나로 실행 가능하다

#### init code vs VU code

k6 스크립트에는 두 가지 실행 컨텍스트가 존재한다:

```javascript
// === init code (init context) ===
// 테스트 시작 전에 한 번만 실행된다.
// 파일 읽기, 모듈 import 등 초기화 작업을 수행한다.
// http.get() 같은 네트워크 호출은 허용되지 않는다.
import http from 'k6/http';
import { check } from 'k6';
import { SharedArray } from 'k6/data';

const data = new SharedArray('users', function () {
  return JSON.parse(open('./users.json'));
});

// === VU code (default function) ===
// 각 VU가 반복적으로 실행하는 코드이다.
// 네트워크 호출, check, sleep 등을 수행한다.
export default function () {
  const res = http.get('https://test-api.example.com/');
  check(res, { 'status is 200': (r) => r.status === 200 });
}
```

init code에서 `open()`으로 파일을 읽으면 **모든 VU가 메모리를 공유**하지 않고 각 VU에 복사된다. 대용량 데이터를 다룰 때는 `SharedArray`를 사용하여 메모리를 절약해야 한다.

---

### 이 프로젝트에서의 실습 환경

이 프로젝트에서 k6는 dev 클러스터의 데모 앱에 부하 테스트를 수행한다.

- 부하 테스트 매니페스트: `manifests/demo/k6-loadtest.yaml`
- 스트레스 테스트: `manifests/demo/stress-test.yaml`
- 테스트 대상: `nginx-web.demo.svc.cluster.local`, `httpbin.demo.svc.cluster.local`
- VU: 100, Duration: 60초
- HPA와 연동하여 자동 스케일링을 관찰할 수 있다
- 실습 대상 클러스터: dev (`kubeconfig/dev.yaml`)

```bash
# dev 클러스터에서 k6 부하 테스트 실행
export KUBECONFIG=kubeconfig/dev.yaml
kubectl apply -f manifests/demo/k6-loadtest.yaml
kubectl logs -n demo job/k6-loadtest -f

# HPA 관찰 (다른 터미널)
kubectl get hpa -n demo -w
```

---

### VU 라이프사이클

k6의 실행 모델은 4단계 라이프사이클을 따른다:

```
1. init         → 스크립트 파싱, 모듈 로드, 전역 변수 초기화
2. setup()      → 테스트 시작 전 1회 실행 (DB 시드, 토큰 발급 등)
3. default()    → 각 VU가 반복 실행하는 메인 테스트 로직
4. teardown()   → 테스트 종료 후 1회 실행 (정리 작업)
```

```javascript
import http from 'k6/http';
import { check } from 'k6';

export const options = {
  vus: 10,
  duration: '30s',
};

// setup: 테스트 전 1회 실행된다. 반환값이 default와 teardown에 전달된다.
export function setup() {
  const loginRes = http.post('https://api.example.com/auth/login', JSON.stringify({
    username: 'testuser',
    password: 'testpass',
  }), { headers: { 'Content-Type': 'application/json' } });

  const token = loginRes.json('access_token');
  return { token: token };  // default()와 teardown()에 data로 전달된다
}

// default: 각 VU가 duration 동안 반복 실행한다.
export default function (data) {
  const params = {
    headers: { Authorization: `Bearer ${data.token}` },
  };
  const res = http.get('https://api.example.com/items', params);
  check(res, { 'status is 200': (r) => r.status === 200 });
}

// teardown: 테스트 종료 후 1회 실행된다.
export function teardown(data) {
  http.post('https://api.example.com/auth/logout', null, {
    headers: { Authorization: `Bearer ${data.token}` },
  });
}
```

`setup()`의 반환값은 JSON 직렬화를 거쳐 `default()`와 `teardown()`에 전달되므로, 함수나 프로토타입 체인은 전달할 수 없다.

---

### Open Model vs Closed Model

부하 테스트에는 두 가지 모델이 존재한다:

| 모델 | 설명 | k6 Executor |
|------|------|-------------|
| **Closed Model** | 이전 iteration이 완료되어야 다음 iteration이 시작된다. VU 수를 기준으로 부하를 조절한다 | `constant-vus`, `ramping-vus`, `shared-iterations`, `per-vu-iterations` |
| **Open Model** | iteration 완료 여부와 무관하게 일정한 rate로 새 iteration을 시작한다. 실제 트래픽 패턴에 가깝다 | `constant-arrival-rate`, `ramping-arrival-rate` |

Closed model은 서버 응답이 느려지면 자동으로 요청 rate가 감소한다(coordinated omission 문제). 실제 사용자 트래픽을 시뮬레이션할 때는 open model(arrival-rate 기반 executor)이 더 정확하다.

---

### 핵심 개념

| 개념 | 설명 |
|------|------|
| VU (Virtual User) | 시뮬레이션되는 가상 사용자이다. 각 VU는 독립적인 JavaScript 런타임을 가진다 |
| Iteration | 한 VU가 `default` 함수를 한 번 실행하는 것이다 |
| Duration | 테스트 지속 시간이다 |
| RPS | 초당 요청 수(Requests Per Second)이다. 직접 제어하는 것이 아니라 VU 수와 iteration 속도의 결과값이다 |
| p95/p99 | 응답 시간의 95번째/99번째 백분위수이다 |
| Threshold | 테스트 통과/실패를 결정하는 기준이다. CI/CD에서 exit code를 결정한다 |
| Check | 응답을 검증하는 assertion이다. 실패해도 테스트가 중단되지 않는다(soft fail) |
| Scenario | 서로 다른 부하 패턴을 정의하는 구성 단위이다. 여러 시나리오를 병렬로 실행할 수 있다 |
| Executor | 시나리오의 부하 생성 방식을 결정하는 실행 엔진이다 |
| Group | 테스트 로직을 논리적으로 묶어 결과를 계층적으로 표시한다 |

---

### Executor 상세

k6는 6가지 executor를 제공한다. 각각의 사용 목적이 다르다:

#### Closed Model Executor

| Executor | 동작 | 사용 시점 |
|----------|------|-----------|
| `shared-iterations` | 전체 VU가 총 N회 iteration을 나누어 실행한다 | 정확히 N번의 요청이 필요할 때 (데이터 마이그레이션 등) |
| `per-vu-iterations` | 각 VU가 N회 iteration을 실행한다 | VU별 균등한 작업량이 필요할 때 |
| `constant-vus` | 고정된 VU 수로 duration 동안 실행한다 | 기본적인 부하 테스트 |
| `ramping-vus` | stages에 따라 VU 수를 증감한다 | ramp-up/down 패턴이 필요할 때 |

#### Open Model Executor

| Executor | 동작 | 사용 시점 |
|----------|------|-----------|
| `constant-arrival-rate` | 초당 고정된 수의 iteration을 시작한다. 응답 지연 시 VU를 자동 추가한다(maxVUs까지) | 일정한 throughput을 유지해야 할 때 |
| `ramping-arrival-rate` | stages에 따라 iteration rate를 증감한다 | 점진적으로 throughput을 변경할 때 |

```javascript
export const options = {
  scenarios: {
    // 초당 50개의 iteration을 유지하는 예제
    constant_load: {
      executor: 'constant-arrival-rate',
      rate: 50,              // 초당 50 iteration
      timeUnit: '1s',
      duration: '5m',
      preAllocatedVUs: 50,   // 미리 할당할 VU 수
      maxVUs: 200,           // 응답 지연 시 최대 VU 수
    },
  },
};
```

---

### Scenario (시나리오)

여러 시나리오를 병렬로 실행하여 복합적인 부하 패턴을 구성할 수 있다. 각 시나리오는 독립적인 executor, 부하 설정, 실행 함수를 가진다.

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
      gracefulRampDown: '30s',  // VU 감소 시 진행 중인 iteration 완료 대기 시간
      exec: 'readScenario',     // 실행할 함수명
    },
    // 시나리오 2: 쓰기 트래픽 (낮은 비율)
    writers: {
      executor: 'constant-arrival-rate',
      rate: 10,
      timeUnit: '1s',
      duration: '9m',
      preAllocatedVUs: 20,
      maxVUs: 50,
      gracefulStop: '1m',       // 시나리오 종료 시 진행 중인 iteration 완료 대기 시간
      exec: 'writeScenario',
    },
  },
};

export function readScenario() {
  http.get('https://api.example.com/items');
  sleep(1);
}

export function writeScenario() {
  const payload = JSON.stringify({ name: `item-${Date.now()}` });
  http.post('https://api.example.com/items', payload, {
    headers: { 'Content-Type': 'application/json' },
  });
}
```

주요 시나리오 옵션:
- **`exec`**: 시나리오가 실행할 exported 함수명이다. 지정하지 않으면 `default`가 실행된다
- **`gracefulStop`**: 시나리오 종료 시점에 진행 중인 iteration의 완료를 기다리는 시간이다 (기본값: `30s`)
- **`gracefulRampDown`**: `ramping-vus`에서 VU 수를 줄일 때 진행 중인 iteration의 완료를 기다리는 시간이다 (기본값: `30s`)

---

### 부하 테스트 유형

```
Smoke Test:        낮은 부하로 기본 동작 확인
  VU: 1-5, Duration: 1m

Load Test:         예상 트래픽 수준으로 테스트
  VU: 50-100, Duration: 10m

Stress Test:       한계까지 부하 증가
  VU: 100→500, Duration: 30m

Spike Test:        갑작스러운 부하 폭증
  VU: 10→1000→10, Duration: 10m

Soak Test:         장시간 안정성 테스트 (메모리 누수, 연결 풀 고갈 등 탐지)
  VU: 100, Duration: 2h+

Breakpoint Test:   시스템 한계점(breaking point)을 찾는 테스트
  VU: 점진적 증가 → 실패 시점 탐지
```

---

### Metrics (지표 시스템)

#### Built-in HTTP Metrics

k6는 HTTP 요청의 각 단계를 세분화하여 측정한다:

| Metric | 유형 | 설명 |
|--------|------|------|
| `http_reqs` | Counter | 총 HTTP 요청 수이다 |
| `http_req_duration` | Trend | 전체 요청 소요 시간이다 (sending + waiting + receiving) |
| `http_req_blocked` | Trend | TCP 연결 대기 시간이다 (연결 풀 포화 시 증가) |
| `http_req_connecting` | Trend | TCP 연결 수립 시간이다 |
| `http_req_tls_handshaking` | Trend | TLS handshake 시간이다 |
| `http_req_sending` | Trend | 요청 본문 전송 시간이다 |
| `http_req_waiting` | Trend | TTFB(Time to First Byte), 서버 처리 시간이다 |
| `http_req_receiving` | Trend | 응답 본문 수신 시간이다 |
| `http_req_failed` | Rate | 실패한 요청의 비율이다 (status code 4xx/5xx) |

#### Built-in 일반 Metrics

| Metric | 유형 | 설명 |
|--------|------|------|
| `vus` | Gauge | 현재 활성 VU 수이다 |
| `vus_max` | Gauge | 최대 VU 수이다 |
| `iterations` | Counter | 완료된 iteration 수이다 |
| `iteration_duration` | Trend | iteration 1회 소요 시간이다 (sleep 포함) |
| `data_received` | Counter | 수신된 데이터 바이트 수이다 |
| `data_sent` | Counter | 전송된 데이터 바이트 수이다 |
| `checks` | Rate | 성공한 check의 비율이다 |
| `dropped_iterations` | Counter | arrival-rate executor에서 VU 부족으로 시작하지 못한 iteration 수이다 |

#### Custom Metrics

4가지 custom metric 유형을 사용할 수 있다:

```javascript
import http from 'k6/http';
import { Counter, Gauge, Rate, Trend } from 'k6/metrics';

// Counter: 누적 합계이다
const totalErrors = new Counter('total_errors');

// Gauge: 마지막으로 추가된 값만 유지한다 (현재 상태)
const activeConnections = new Gauge('active_connections');

// Rate: 0이 아닌 값의 비율이다 (true/false 비율 측정)
const successRate = new Rate('success_rate');

// Trend: 통계 분석이 가능한 값 집합이다 (avg, min, max, med, p(N))
const apiLatency = new Trend('api_latency', true); // true: 밀리초 단위

export default function () {
  const res = http.get('https://api.example.com/data');

  // Custom metric에 값 추가
  if (res.status !== 200) {
    totalErrors.add(1);
  }
  activeConnections.add(42);
  successRate.add(res.status === 200);  // true=1, false=0
  apiLatency.add(res.timings.duration);
}
```

#### Metric Tags와 Tag Filtering

모든 metric에는 tag가 자동으로 부여된다 (method, url, status, scenario 등). 추가 tag를 지정하여 결과를 세분화할 수 있다:

```javascript
import http from 'k6/http';

export default function () {
  // 요청별 custom tag 지정
  http.get('https://api.example.com/items', {
    tags: { name: 'GetItems', type: 'api' },
  });

  http.get('https://api.example.com/health', {
    tags: { name: 'HealthCheck', type: 'health' },
  });
}

export const options = {
  thresholds: {
    // tag 필터링을 사용한 threshold
    'http_req_duration{name:GetItems}': ['p(95)<300'],
    'http_req_duration{name:HealthCheck}': ['p(95)<100'],
    'http_req_duration{type:api}': ['avg<200'],
  },
};
```

---

### Checks vs Thresholds

이 두 개념은 명확히 구분해야 한다:

| 구분 | Check | Threshold |
|------|-------|-----------|
| 역할 | 개별 응답에 대한 assertion이다 | metric 집계값에 대한 통과/실패 기준이다 |
| 실패 시 동작 | 테스트가 계속 진행된다 (soft fail) | 테스트의 exit code가 non-zero가 된다 |
| CI/CD 연동 | exit code에 영향을 주지 않는다 | exit code로 파이프라인 통과/실패를 결정한다 |
| 적용 대상 | 개별 응답(response 단위) | 전체 테스트 결과(aggregate 단위) |

```javascript
import http from 'k6/http';
import { check } from 'k6';

export const options = {
  thresholds: {
    // Threshold: 전체 테스트에서 check 성공률이 99% 이상이어야 한다
    checks: ['rate>0.99'],
    // Threshold: p(95)가 500ms 미만이어야 한다
    http_req_duration: ['p(95)<500'],
  },
};

export default function () {
  const res = http.get('https://api.example.com/data');

  // Check: 개별 응답 검증 (실패해도 테스트 중단 안 됨)
  check(res, {
    'status is 200': (r) => r.status === 200,
    'body has data': (r) => r.json().data !== undefined,
  });
}
```

---

### Thresholds 상세

Threshold에서 사용할 수 있는 집계 함수:

| 집계 함수 | 적용 가능 Metric 유형 | 예시 |
|-----------|----------------------|------|
| `avg` | Trend | `http_req_duration: ['avg<200']` |
| `min` | Trend | `http_req_duration: ['min<50']` |
| `max` | Trend | `http_req_duration: ['max<1000']` |
| `med` | Trend | `http_req_duration: ['med<150']` |
| `p(N)` | Trend | `http_req_duration: ['p(95)<300', 'p(99)<500']` |
| `count` | Counter | `http_reqs: ['count>1000']` |
| `rate` | Rate | `http_req_failed: ['rate<0.01']` |
| `value` | Gauge | `vus: ['value>0']` |

#### 고급 Threshold 옵션

```javascript
export const options = {
  thresholds: {
    http_req_duration: [
      {
        threshold: 'p(95)<500',
        abortOnFail: true,       // threshold 위반 시 테스트를 즉시 중단한다
        delayAbortEval: '30s',   // 테스트 시작 후 30초 동안은 abort 판단을 유예한다
                                  // (warm-up 기간 고려)
      },
    ],
    http_req_failed: [
      {
        threshold: 'rate<0.05',
        abortOnFail: true,
        delayAbortEval: '10s',
      },
    ],
  },
};
```

---

### 프로토콜 지원

k6는 HTTP 외에도 다양한 프로토콜을 지원한다:

| 프로토콜 | 모듈 | 상태 |
|----------|------|------|
| HTTP/1.1, HTTP/2 | `k6/http` | 기본 내장이다 |
| WebSocket | `k6/ws` | 기본 내장이다 |
| gRPC | `k6/net/grpc` | 기본 내장이다 |
| Browser (Chromium) | `k6/browser` | 기본 내장이다 (k6 v0.46+) |

#### WebSocket 예제

```javascript
import ws from 'k6/ws';
import { check } from 'k6';

export default function () {
  const url = 'ws://echo.websocket.org';
  const res = ws.connect(url, {}, function (socket) {
    socket.on('open', function () {
      socket.send('hello');
    });
    socket.on('message', function (msg) {
      check(msg, { 'message received': (m) => m === 'hello' });
      socket.close();
    });
    socket.on('close', function () {});
    socket.setTimeout(function () {
      socket.close();
    }, 5000);
  });
  check(res, { 'ws status is 101': (r) => r && r.status === 101 });
}
```

#### gRPC 예제

```javascript
import grpc from 'k6/net/grpc';
import { check } from 'k6';

const client = new grpc.Client();
client.load(['definitions'], 'hello.proto');

export default function () {
  client.connect('grpc-server.example.com:443', { plaintext: false });

  const response = client.invoke('hello.HelloService/SayHello', {
    greeting: 'k6',
  });

  check(response, {
    'status is OK': (r) => r && r.status === grpc.StatusOK,
  });

  client.close();
}
```

---

### k6 Browser Module

k6 browser module은 Chromium 기반 브라우저를 제어하여 실제 사용자의 브라우저 경험을 측정한다. Playwright와 유사한 API를 제공한다.

```javascript
import { browser } from 'k6/browser';
import { check } from 'https://jslib.k6.io/k6-utils/1.5.0/index.js';

export const options = {
  scenarios: {
    browser_test: {
      executor: 'shared-iterations',
      options: {
        browser: {
          type: 'chromium',
        },
      },
    },
  },
};

export default async function () {
  const page = await browser.newPage();

  try {
    await page.goto('https://test.k6.io/');
    await page.locator('a[href="/contacts.php"]').click();
    await page.waitForNavigation();

    check(page, {
      'contacts header visible': (p) =>
        p.locator('h3').textContent() === 'Contact us',
    });
  } finally {
    await page.close();
  }
}
```

---

### Extensions (xk6)

xk6는 Go 기반 extension을 추가하여 커스텀 k6 바이너리를 빌드하는 도구이다. SQL 데이터베이스, Kafka, Redis 등 다양한 프로토콜과 기능을 확장할 수 있다.

```bash
# xk6 설치
go install go.k6.io/xk6/cmd/xk6@latest

# SQL extension이 포함된 커스텀 k6 빌드
xk6 build --with github.com/grafana/xk6-sql

# Kafka extension이 포함된 커스텀 k6 빌드
xk6 build --with github.com/mostafa/xk6-kafka
```

k6 Extension Registry(https://grafana.com/docs/k6/latest/extensions/)에서 커뮤니티가 만든 다양한 extension을 확인할 수 있다.

---

### 결과 출력 (Output)

k6는 다양한 형식으로 결과를 출력할 수 있다:

| 출력 방식 | 명령어 옵션 | 설명 |
|-----------|-------------|------|
| Console Summary | (기본) | 테스트 종료 시 터미널에 요약 출력 |
| JSON | `--out json=results.json` | 모든 metric을 JSON으로 저장 |
| CSV | `--out csv=results.csv` | 모든 metric을 CSV로 저장 |
| InfluxDB | `--out influxdb=http://localhost:8086/k6` | InfluxDB에 실시간 전송 |
| Prometheus Remote Write | `--out experimental-prometheus-rw` | Prometheus에 실시간 전송 |
| Grafana Cloud k6 | `--out cloud` | Grafana Cloud k6 서비스에 전송 |

여러 출력을 동시에 사용할 수 있다:

```bash
k6 run --out json=results.json --out influxdb=http://localhost:8086/k6 script.js
```

#### Console Summary 결과 읽기

```
http_req_duration:
  avg=120ms   ← 평균 응답시간
  med=100ms   ← 중앙값 (절반의 요청이 이 값 이하)
  p(90)=200ms ← 90%의 요청이 200ms 이내
  p(95)=250ms ← 95%의 요청이 250ms 이내
  p(99)=500ms ← 99%의 요청이 500ms 이내
  min=20ms    ← 최소 응답시간
  max=2000ms  ← 최대 응답시간

http_req_failed:   0.5%   ← 실패율
http_reqs:         15000  ← 총 요청 수
iterations:        15000  ← 완료된 iteration 수
vus:               100    ← 동시 사용자 수
vus_max:           100    ← 최대 동시 사용자 수
data_received:     5.2 MB ← 수신 데이터 총량
data_sent:         1.1 MB ← 전송 데이터 총량
```

---

## 실습

### 실습 1: k6 설치 및 기본 테스트

```bash
# k6 설치 (macOS)
brew install k6

# 또는 Docker로 실행
# docker run --rm -i grafana/k6 run - <script.js

# 버전 확인
k6 version

# 간단한 테스트 실행
k6 run - <<EOF
import http from 'k6/http';
import { check } from 'k6';

export default function () {
  const res = http.get('https://httpbin.org/get');
  check(res, {
    'status is 200': (r) => r.status === 200,
  });
}
EOF
```

### 실습 2: 부하 옵션 설정

```bash
# CLI에서 VU와 Duration 지정
k6 run --vus 10 --duration 30s script.js

# 또는 스크립트 내에 옵션 설정 (스크립트 옵션이 CLI보다 우선)
k6 run script.js

# CLI 옵션으로 스크립트 옵션 덮어쓰기 (환경 변수도 가능)
K6_VUS=20 K6_DURATION=1m k6 run script.js
```

### 실습 3: 프로젝트 테스트 시나리오 실행

```bash
# 프로젝트의 k6 테스트 확인
ls ../../manifests/k6/

# Kubernetes Job으로 k6 실행
kubectl apply -f ../../manifests/k6/load-test-job.yaml

# Job 결과 확인
kubectl logs job/k6-load-test
```

### 실습 4: 결과 분석

```bash
# JSON 형식으로 결과 출력
k6 run --out json=results.json script.js

# CSV 형식으로 결과 출력
k6 run --out csv=results.csv script.js

# Summary + JSON 동시 출력
k6 run --out json=results.json --summary-trend-stats="avg,min,med,max,p(90),p(95),p(99)" script.js
```

---

## 예제

### 예제 1: Smoke Test

```javascript
// smoke-test.js
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 1,
  duration: '1m',
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
  },
};

export default function () {
  const res = http.get('http://nginx-web.demo.svc.cluster.local');

  check(res, {
    'status is 200': (r) => r.status === 200,
    'response time < 500ms': (r) => r.timings.duration < 500,
  });

  sleep(1);
}
```

### 예제 2: Load Test (Ramp-up/down)

```javascript
// load-test.js
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '2m', target: 20 },   // 2분간 20 VU로 증가
    { duration: '5m', target: 20 },   // 5분간 20 VU 유지
    { duration: '2m', target: 50 },   // 2분간 50 VU로 증가
    { duration: '5m', target: 50 },   // 5분간 50 VU 유지
    { duration: '2m', target: 0 },    // 2분간 0으로 감소
  ],
  thresholds: {
    http_req_duration: ['p(95)<300', 'p(99)<500'],
    http_req_failed: ['rate<0.05'],
  },
};

export default function () {
  const res = http.get('http://nginx-web.demo.svc.cluster.local');

  check(res, {
    'status is 200': (r) => r.status === 200,
  });

  sleep(1);
}
```

### 예제 3: Stress Test

```javascript
// stress-test.js
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '2m', target: 100 },
    { duration: '5m', target: 100 },
    { duration: '2m', target: 200 },
    { duration: '5m', target: 200 },
    { duration: '2m', target: 300 },
    { duration: '5m', target: 300 },
    { duration: '5m', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(99)<1500'],
    http_req_failed: ['rate<0.10'],
  },
};

export default function () {
  const responses = http.batch([
    ['GET', 'http://nginx-web.demo.svc.cluster.local/'],
    ['GET', 'http://httpbin.demo.svc.cluster.local/get'],
  ]);

  responses.forEach((res) => {
    check(res, {
      'status is 200': (r) => r.status === 200,
    });
  });

  sleep(0.5);
}
```

### 예제 4: API 시나리오 테스트

```javascript
// api-scenario.js
import http from 'k6/http';
import { check, group, sleep } from 'k6';

export const options = {
  vus: 10,
  duration: '5m',
};

const BASE_URL = 'http://api.demo.svc.cluster.local';

export default function () {
  group('API 워크플로우', function () {
    // 1단계: 헬스체크
    group('헬스체크', function () {
      const res = http.get(`${BASE_URL}/health`);
      check(res, { 'health OK': (r) => r.status === 200 });
    });

    // 2단계: 데이터 조회
    group('데이터 조회', function () {
      const res = http.get(`${BASE_URL}/api/items`);
      check(res, {
        'items returned': (r) => r.status === 200,
        'has items': (r) => JSON.parse(r.body).length > 0,
      });
    });

    // 3단계: 데이터 생성
    group('데이터 생성', function () {
      const payload = JSON.stringify({ name: 'test', value: 42 });
      const params = { headers: { 'Content-Type': 'application/json' } };
      const res = http.post(`${BASE_URL}/api/items`, payload, params);
      check(res, { 'created': (r) => r.status === 201 });
    });
  });

  sleep(1);
}
```

### 예제 5: Correlation (응답 값 추출 및 재사용)

실제 시나리오에서는 이전 요청의 응답에서 값을 추출하여 다음 요청에 사용하는 경우가 많다.

```javascript
// correlation.js
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 5,
  duration: '2m',
};

const BASE_URL = 'https://api.example.com';

export default function () {
  // 1. 로그인하여 토큰 획득
  const loginRes = http.post(`${BASE_URL}/auth/login`, JSON.stringify({
    username: 'testuser',
    password: 'testpass',
  }), { headers: { 'Content-Type': 'application/json' } });

  const token = loginRes.json('access_token');
  check(loginRes, {
    'login succeeded': (r) => r.status === 200,
    'has token': () => token !== undefined,
  });

  const authHeaders = {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  };

  // 2. 아이템 생성 → 생성된 ID 추출
  const createRes = http.post(`${BASE_URL}/api/items`,
    JSON.stringify({ name: `item-${__VU}-${__ITER}` }),
    authHeaders
  );
  const itemId = createRes.json('id');
  check(createRes, {
    'item created': (r) => r.status === 201,
    'has id': () => itemId !== undefined,
  });

  // 3. 추출한 ID로 상세 조회
  const getRes = http.get(`${BASE_URL}/api/items/${itemId}`, authHeaders);
  check(getRes, {
    'item retrieved': (r) => r.status === 200,
    'correct item': (r) => r.json('id') === itemId,
  });

  sleep(1);
}
```

### 예제 6: 외부 데이터 파라미터화 (CSV/JSON)

```javascript
// parameterization.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';
import papaparse from 'https://jslib.k6.io/papaparse/5.1.1/index.js';

// JSON 파일에서 데이터 로드 (SharedArray로 메모리 공유)
const users = new SharedArray('users', function () {
  return JSON.parse(open('./testdata/users.json'));
  // users.json 형식: [{"username": "user1", "password": "pass1"}, ...]
});

// CSV 파일에서 데이터 로드
const products = new SharedArray('products', function () {
  return papaparse.parse(open('./testdata/products.csv'), { header: true }).data;
  // products.csv 형식: id,name,price
});

export const options = {
  vus: 10,
  iterations: 100,
};

export default function () {
  // VU별로 다른 사용자 데이터 사용
  const user = users[__VU % users.length];
  const product = products[__ITER % products.length];

  // 로그인
  const loginRes = http.post('https://api.example.com/login', JSON.stringify({
    username: user.username,
    password: user.password,
  }), { headers: { 'Content-Type': 'application/json' } });

  check(loginRes, { 'logged in': (r) => r.status === 200 });

  // 상품 조회
  const productRes = http.get(`https://api.example.com/products/${product.id}`);
  check(productRes, {
    'product found': (r) => r.status === 200,
  });

  sleep(0.5);
}
```

### 예제 7: Custom Metrics 활용

```javascript
// custom-metrics.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

// Custom metrics 정의
const loginDuration = new Trend('login_duration', true);
const apiErrors = new Counter('api_errors');
const loginSuccess = new Rate('login_success_rate');

export const options = {
  vus: 20,
  duration: '5m',
  thresholds: {
    login_duration: ['p(95)<1000'],     // 로그인 p95 < 1초
    api_errors: ['count<50'],           // API 에러 50건 미만
    login_success_rate: ['rate>0.95'],  // 로그인 성공률 95% 이상
  },
};

export default function () {
  const start = Date.now();
  const loginRes = http.post('https://api.example.com/login', JSON.stringify({
    username: 'user',
    password: 'pass',
  }), { headers: { 'Content-Type': 'application/json' } });
  loginDuration.add(Date.now() - start);

  const success = loginRes.status === 200;
  loginSuccess.add(success);

  if (!success) {
    apiErrors.add(1);
  }

  sleep(1);
}
```

### 예제 8: Kubernetes Job으로 k6 실행

```yaml
# k6-job.yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: k6-load-test
  namespace: demo
spec:
  template:
    spec:
      containers:
        - name: k6
          image: grafana/k6:latest
          command: ['k6', 'run', '/scripts/load-test.js']
          volumeMounts:
            - name: scripts
              mountPath: /scripts
          resources:
            requests:
              cpu: "500m"
              memory: "256Mi"
            limits:
              cpu: "1000m"
              memory: "512Mi"
      volumes:
        - name: scripts
          configMap:
            name: k6-scripts
      restartPolicy: Never
  backoffLimit: 0
```

---

## 자가 점검

- [ ] k6가 Node.js가 아닌 Go+goja 엔진을 사용하는 이유와 성능상 이점을 설명할 수 있는가?
- [ ] init code와 VU code의 차이를 설명할 수 있는가?
- [ ] VU 라이프사이클(init → setup → default → teardown)을 설명할 수 있는가?
- [ ] Open model과 Closed model의 차이를 설명할 수 있는가?
- [ ] 6가지 executor의 차이와 적절한 사용 시점을 설명할 수 있는가?
- [ ] VU(Virtual User)의 개념을 설명할 수 있는가?
- [ ] p95, p99 응답 시간의 의미를 설명할 수 있는가?
- [ ] Smoke, Load, Stress, Spike, Soak 테스트의 차이를 설명할 수 있는가?
- [ ] Check와 Threshold의 차이를 설명할 수 있는가?
- [ ] Custom metrics(Counter, Gauge, Rate, Trend)를 정의하고 활용할 수 있는가?
- [ ] Threshold의 abortOnFail, delayAbortEval 옵션을 설명할 수 있는가?
- [ ] Tag filtering을 사용하여 특정 요청에 대한 threshold를 설정할 수 있는가?
- [ ] Correlation(응답 값 추출 및 재사용) 패턴을 구현할 수 있는가?
- [ ] SharedArray를 사용한 데이터 파라미터화를 구현할 수 있는가?
- [ ] k6 결과를 읽고 성능 병목을 파악할 수 있는가?
- [ ] 여러 시나리오를 병렬로 실행하는 구성을 작성할 수 있는가?

---

## 참고문헌

- [k6 공식 문서](https://grafana.com/docs/k6/latest/) - Grafana Labs에서 관리하는 공식 레퍼런스이다
- [k6 GitHub 저장소](https://github.com/grafana/k6) - 소스 코드 및 릴리스 정보이다
- [k6 JavaScript API Reference](https://grafana.com/docs/k6/latest/javascript-api/) - 모든 모듈과 API의 상세 문서이다
- [k6 Examples](https://grafana.com/docs/k6/latest/examples/) - 공식 예제 모음이다
- [k6 Extensions Registry](https://grafana.com/docs/k6/latest/extensions/) - xk6 확장 목록이다
- [k6 Browser Module](https://grafana.com/docs/k6/latest/using-k6-browser/) - 브라우저 테스트 가이드이다
- [k6 OSS vs Grafana Cloud k6](https://grafana.com/docs/grafana-cloud/testing/k6/) - 클라우드 서비스 문서이다
- [Awesome k6](https://github.com/grafana/awesome-k6) - 커뮤니티 리소스 모음이다
