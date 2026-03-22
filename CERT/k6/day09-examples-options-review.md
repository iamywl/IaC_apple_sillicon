# Day 9: 예제, 옵션 레퍼런스, 자가 점검

k6 예제 모음(Smoke Test, Load Test, Stress Test, API 시나리오, Correlation, 파라미터화, Custom Metrics, Kubernetes Job), k6 옵션 전체 레퍼런스, 자가 점검 문제, 그리고 참고문헌을 다룬다.

---

# Part 21: 예제 모음

---

## 예제 1: Smoke Test

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

## 예제 2: Load Test (Ramp-up/down)

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

## 예제 3: Stress Test

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

## 예제 4: API 시나리오 테스트

```javascript
// api-scenario.js
import http from 'k6/http';
import { check, group, sleep } from 'k6';

export const options = {
  vus: 10,
  duration: '5m',
};

const BASE_URL = 'http://httpbin.demo.svc.cluster.local';

export default function () {
  group('API 워크플로우', function () {
    // 1단계: 헬스체크
    group('헬스체크', function () {
      const res = http.get(`${BASE_URL}/get`);
      check(res, { 'health OK': (r) => r.status === 200 });
    });

    // 2단계: 데이터 조회
    group('데이터 조회', function () {
      const res = http.get(`${BASE_URL}/get`);
      check(res, {
        'data returned': (r) => r.status === 200,
        'has body': (r) => r.body.length > 0,
      });
    });

    // 3단계: 데이터 생성
    group('데이터 생성', function () {
      const payload = JSON.stringify({ name: 'test', value: 42 });
      const params = { headers: { 'Content-Type': 'application/json' } };
      const res = http.post(`${BASE_URL}/post`, payload, params);
      check(res, { 'created': (r) => r.status === 200 });
    });
  });

  sleep(1);
}
```

## 예제 5: Correlation (응답 값 추출 및 재사용)

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

## 예제 6: 외부 데이터 파라미터화 (CSV/JSON)

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

## 예제 7: Custom Metrics 활용

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

## 예제 8: Kubernetes Job으로 k6 실행

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

# Part 22: k6 옵션 전체 레퍼런스

---

## 22.1 주요 옵션 정리

```javascript
export const options = {
  // === 기본 실행 옵션 ===
  vus: 100,                     // 동시 VU 수
  duration: '5m',               // 테스트 지속 시간
  iterations: 1000,             // 총 iteration 수 (duration과 함께 사용 가능)
  stages: [                     // ramping-vus 패턴
    { duration: '2m', target: 50 },
    { duration: '5m', target: 50 },
    { duration: '2m', target: 0 },
  ],

  // === Threshold ===
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
  },

  // === HTTP 설정 ===
  batch: 20,                    // http.batch()의 최대 병렬 요청 수 (기본: 20)
  batchPerHost: 6,              // 호스트당 최대 병렬 요청 수 (기본: 6)
  httpDebug: 'full',            // HTTP 디버그 출력 ('full' 또는 'headers')
  insecureSkipTLSVerify: true,  // TLS 인증서 검증 건너뛰기
  noConnectionReuse: false,     // true: 매 요청마다 새 연결
  noVUConnectionReuse: false,   // true: 매 iteration마다 새 연결
  userAgent: 'k6/0.49.0',      // User-Agent 헤더
  maxRedirects: 10,             // 최대 리다이렉트 횟수

  // === DNS 설정 ===
  dns: {
    ttl: '5m',                  // DNS 캐시 TTL
    select: 'first',            // 'first', 'random', 'roundRobin'
    policy: 'preferIPv4',       // IP 버전 선택
  },

  // === TLS 설정 ===
  tlsVersion: {
    min: 'tls1.2',              // 최소 TLS 버전
    max: 'tls1.3',              // 최대 TLS 버전
  },
  tlsAuth: [                    // 클라이언트 인증서
    {
      cert: open('cert.pem'),
      key: open('key.pem'),
    },
  ],

  // === 요약 출력 설정 ===
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  summaryTimeUnit: 'ms',       // 시간 단위 ('us', 'ms', 's')
  noSummary: false,             // true: 요약 출력 비활성화

  // === 기타 ===
  setupTimeout: '60s',          // setup() 타임아웃
  teardownTimeout: '60s',       // teardown() 타임아웃
  gracefulStop: '30s',          // 테스트 종료 시 대기 시간
  throw: false,                 // true: HTTP 에러 시 예외 발생
  tags: {                       // 모든 metric에 적용되는 전역 태그
    testType: 'load',
    environment: 'dev',
  },
};
```

## 22.2 옵션 우선순위

k6 옵션은 다음 우선순위로 적용된다 (높은 것이 낮은 것을 덮어쓴다):

```
1. CLI 플래그            (최고 우선순위)
   k6 run --vus 50 script.js

2. 환경 변수
   K6_VUS=50 k6 run script.js

3. 스크립트 옵션
   export const options = { vus: 50 };

4. 설정 파일
   k6 run --config config.json script.js

5. 기본값              (최저 우선순위)
```

---

# Part 23: 자가 점검

---

## 성능 테스트 이론

- [ ] 성능 테스트와 기능 테스트의 차이를 설명할 수 있는가?
- [ ] Little's law를 사용하여 목표 RPS에 필요한 VU 수를 계산할 수 있는가?
- [ ] 평균(average) 대신 백분위수(percentile)를 사용해야 하는 이유를 설명할 수 있는가?
- [ ] p95, p99 응답 시간의 의미를 설명할 수 있는가?
- [ ] Smoke, Load, Stress, Spike, Soak, Breakpoint 테스트의 차이를 설명할 수 있는가?
- [ ] Coordinated omission 문제를 설명하고, Open model이 이를 해결하는 방식을 설명할 수 있는가?
- [ ] Capacity planning 프로세스를 설명할 수 있는가?

## k6 아키텍처

- [ ] k6가 Node.js가 아닌 Go+goja 엔진을 사용하는 이유와 성능상 이점을 설명할 수 있는가?
- [ ] init code와 VU code의 차이를 설명할 수 있는가?
- [ ] VU 라이프사이클(init → setup → default → teardown)을 설명할 수 있는가?
- [ ] goja 엔진의 특성과 제약사항을 설명할 수 있는가?
- [ ] Open model과 Closed model의 차이를 설명할 수 있는가?

## API & 기능

- [ ] http.get/post/put/patch/del/batch/request의 사용법을 알고 있는가?
- [ ] Params 객체의 주요 속성(headers, tags, timeout, cookies 등)을 활용할 수 있는가?
- [ ] Cookie 처리, Authentication 패턴을 구현할 수 있는가?
- [ ] 파일 업로드 테스트를 작성할 수 있는가?
- [ ] Response 객체의 json(), html(), timings 속성을 활용할 수 있는가?

## Checks & Thresholds

- [ ] Check와 Threshold의 차이를 설명할 수 있는가?
- [ ] Threshold의 abortOnFail, delayAbortEval 옵션을 설명할 수 있는가?
- [ ] Tag filtering을 사용하여 특정 요청에 대한 threshold를 설정할 수 있는가?
- [ ] Custom metric에 threshold를 적용할 수 있는가?

## Custom Metrics & Tags

- [ ] Custom metrics(Counter, Gauge, Rate, Trend)를 정의하고 활용할 수 있는가?
- [ ] 각 metric 유형의 집계 함수를 알고 있는가?
- [ ] System tag와 Custom tag의 차이를 설명할 수 있는가?
- [ ] Tag를 사용한 sub-metric threshold를 설정할 수 있는가?

## Scenarios & Executors

- [ ] 6가지 executor의 차이와 적절한 사용 시점을 설명할 수 있는가?
- [ ] 여러 시나리오를 병렬로 실행하는 구성을 작성할 수 있는가?
- [ ] arrival-rate executor에서 preAllocatedVUs, maxVUs, dropped_iterations의 관계를 설명할 수 있는가?
- [ ] gracefulStop, gracefulRampDown, startTime 옵션을 활용할 수 있는가?

## Data & Parameterization

- [ ] SharedArray를 사용한 데이터 파라미터화를 구현할 수 있는가?
- [ ] SharedArray와 open()의 메모리 차이를 설명할 수 있는가?
- [ ] CSV/JSON 데이터를 로드하고 활용할 수 있는가?
- [ ] __ENV, __VU, __ITER, k6/execution 모듈을 활용할 수 있는가?

## 프로토콜 & 브라우저

- [ ] WebSocket 테스트를 작성할 수 있는가?
- [ ] gRPC 테스트를 작성할 수 있는가?
- [ ] k6 browser module을 사용한 브라우저 테스트를 작성할 수 있는가?
- [ ] Protocol + Browser 혼합 테스트를 구성할 수 있는가?

## 운영 & 분석

- [ ] Correlation(응답 값 추출 및 재사용) 패턴을 구현할 수 있는가?
- [ ] k6 결과를 읽고 성능 병목을 파악할 수 있는가?
- [ ] HTTP timing 지표를 분해하여 병목 위치를 판단할 수 있는가?
- [ ] CI/CD 파이프라인에 k6를 통합할 수 있는가?
- [ ] k6-operator를 사용한 분산 테스트 구성을 이해하는가?
- [ ] SLO를 k6 threshold로 매핑하여 검증할 수 있는가?

## 트러블슈팅

- [ ] k6 프로세스의 CPU/메모리 문제를 진단하고 해결할 수 있는가?
- [ ] DNS, 연결 재사용, 파일 디스크립터 관련 문제를 해결할 수 있는가?
- [ ] 스크립트의 메모리 누수 패턴을 식별할 수 있는가?

---

# Part 24: 참고문헌

---

- [k6 공식 문서](https://grafana.com/docs/k6/latest/) - Grafana Labs에서 관리하는 공식 레퍼런스이다
- [k6 GitHub 저장소](https://github.com/grafana/k6) - 소스 코드 및 릴리스 정보이다
- [k6 JavaScript API Reference](https://grafana.com/docs/k6/latest/javascript-api/) - 모든 모듈과 API의 상세 문서이다
- [k6 Examples](https://grafana.com/docs/k6/latest/examples/) - 공식 예제 모음이다
- [k6 Extensions Registry](https://grafana.com/docs/k6/latest/extensions/) - xk6 확장 목록이다
- [k6 Browser Module](https://grafana.com/docs/k6/latest/using-k6-browser/) - 브라우저 테스트 가이드이다
- [k6 OSS vs Grafana Cloud k6](https://grafana.com/docs/grafana-cloud/testing/k6/) - 클라우드 서비스 문서이다
- [Awesome k6](https://github.com/grafana/awesome-k6) - 커뮤니티 리소스 모음이다
- [k6-operator](https://github.com/grafana/k6-operator) - Kubernetes operator for k6 분산 테스트이다
- [goja GitHub](https://github.com/dop251/goja) - k6가 사용하는 JavaScript 엔진 소스 코드이다
- [Gil Tene - How NOT to Measure Latency](https://www.youtube.com/watch?v=lJ8ydIuPFeU) - coordinated omission과 HDR Histogram 설명이다
- [Google SRE Book - Chapter 4: SLOs](https://sre.google/sre-book/service-level-objectives/) - SLO 정의와 운영 가이드이다
