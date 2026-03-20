# Day 3: JavaScript API와 Checks & Thresholds

k6 HTTP Module 상세(요청, 응답, 인증, 쿠키, 파일 업로드), URL 그룹핑, Check 패턴, Threshold 구문 상세를 다룬다.

---

# Part 3: JavaScript API 완전 가이드

---

## 3.1 HTTP Module 상세

`k6/http` 모듈은 k6의 핵심 모듈이다. HTTP 요청을 보내고 응답을 처리하는 모든 기능을 제공한다.

### http.get()

```javascript
import http from 'k6/http';

export default function () {
  // 기본 GET 요청
  const res = http.get('http://nginx-web.demo.svc.cluster.local');

  // params 포함 GET 요청
  const res2 = http.get('http://httpbin.demo.svc.cluster.local/get', {
    headers: {
      'Accept': 'application/json',
      'X-Custom-Header': 'k6-test',
    },
    tags: { name: 'httpbin-get' },
    timeout: '10s',
  });

  // Response 객체 속성
  console.log(res.status);            // HTTP 상태 코드 (200, 404, 500 등)
  console.log(res.body);              // 응답 본문 (string)
  console.log(res.headers);           // 응답 헤더 (object)
  console.log(res.timings.duration);  // 전체 요청 소요 시간 (ms)
  console.log(res.timings.blocked);   // TCP 연결 대기 시간
  console.log(res.timings.connecting);// TCP 연결 수립 시간
  console.log(res.timings.sending);   // 요청 전송 시간
  console.log(res.timings.waiting);   // TTFB (서버 처리 시간)
  console.log(res.timings.receiving); // 응답 수신 시간
}
```

### http.post()

```javascript
import http from 'k6/http';

export default function () {
  // JSON POST 요청
  const jsonPayload = JSON.stringify({
    name: 'test-item',
    value: 42,
  });
  const jsonRes = http.post(
    'http://httpbin.demo.svc.cluster.local/post',
    jsonPayload,
    { headers: { 'Content-Type': 'application/json' } }
  );

  // Form POST 요청 (application/x-www-form-urlencoded)
  const formRes = http.post(
    'http://httpbin.demo.svc.cluster.local/post',
    { username: 'testuser', password: 'testpass' }
    // Content-Type은 자동으로 application/x-www-form-urlencoded로 설정된다
  );

  // 문자열 body POST 요청
  const textRes = http.post(
    'http://httpbin.demo.svc.cluster.local/post',
    'raw text body',
    { headers: { 'Content-Type': 'text/plain' } }
  );
}
```

### http.put(), http.patch(), http.del()

```javascript
import http from 'k6/http';

export default function () {
  const baseUrl = 'http://httpbin.demo.svc.cluster.local';

  // PUT — 리소스 전체 교체
  const putRes = http.put(
    `${baseUrl}/put`,
    JSON.stringify({ name: 'updated-item', value: 100 }),
    { headers: { 'Content-Type': 'application/json' } }
  );

  // PATCH — 리소스 부분 수정
  const patchRes = http.patch(
    `${baseUrl}/patch`,
    JSON.stringify({ value: 200 }),
    { headers: { 'Content-Type': 'application/json' } }
  );

  // DELETE — 리소스 삭제
  const delRes = http.del(
    `${baseUrl}/delete`,
    null,  // body (보통 null)
    { headers: { 'Authorization': 'Bearer token123' } }
  );
}
```

### http.batch() — 병렬 요청

`http.batch()`는 여러 HTTP 요청을 병렬로 전송한다. 단일 VU 내에서 동시에 여러 리소스를 요청할 때 사용한다.

```javascript
import http from 'k6/http';
import { check } from 'k6';

export default function () {
  // 배열 형식: [method, url, body, params]
  const responses = http.batch([
    ['GET', 'http://nginx-web.demo.svc.cluster.local/', null, { tags: { name: 'nginx' } }],
    ['GET', 'http://httpbin.demo.svc.cluster.local/get', null, { tags: { name: 'httpbin' } }],
    ['GET', 'http://httpbin.demo.svc.cluster.local/ip', null, { tags: { name: 'ip' } }],
  ]);

  // 각 응답 검증
  responses.forEach((res, i) => {
    check(res, {
      [`batch[${i}] status 200`]: (r) => r.status === 200,
    });
  });

  // 객체 형식: key-value로 이름 지정
  const namedResponses = http.batch({
    nginx: ['GET', 'http://nginx-web.demo.svc.cluster.local/'],
    httpbin: ['GET', 'http://httpbin.demo.svc.cluster.local/get'],
  });

  check(namedResponses.nginx, {
    'nginx OK': (r) => r.status === 200,
  });
  check(namedResponses.httpbin, {
    'httpbin OK': (r) => r.status === 200,
  });
}
```

### http.request() — 범용 메서드

```javascript
import http from 'k6/http';

export default function () {
  // 임의의 HTTP 메서드 사용
  const res = http.request('OPTIONS', 'http://httpbin.demo.svc.cluster.local/', null, {
    headers: { 'Origin': 'http://example.com' },
  });

  // HEAD 요청
  const headRes = http.request('HEAD', 'http://nginx-web.demo.svc.cluster.local/');
  console.log('Content-Length:', headRes.headers['Content-Length']);
}
```

### Params 객체 상세

모든 HTTP 메서드의 마지막 인자로 params 객체를 전달할 수 있다:

```javascript
import http from 'k6/http';

const params = {
  // 요청 헤더
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Authorization': 'Bearer token123',
    'X-Request-ID': 'req-001',
  },

  // 커스텀 태그 (메트릭 필터링에 사용)
  tags: {
    name: 'CreateItem',    // URL 대신 사용할 이름 (동적 URL 그룹핑)
    type: 'api',
    endpoint: 'items',
  },

  // 타임아웃 설정
  timeout: '30s',          // 요청 타임아웃 (기본값: 60s)

  // 리다이렉트 설정
  redirects: 5,            // 최대 리다이렉트 횟수 (기본값: 10, 0으로 비활성화)

  // 응답 유형 설정
  responseType: 'text',    // 'text' (기본), 'binary', 'none'
                           // 'none': body를 읽지 않는다 (대용량 응답 무시 시)

  // 압축
  compression: 'gzip',     // 요청 본문 압축

  // TLS
  // (k6 options에서 전역으로 설정하는 것이 일반적)
};

export default function () {
  http.get('http://httpbin.demo.svc.cluster.local/get', params);
}
```

### Cookie 처리

k6는 VU별로 cookie jar를 유지한다. 서버가 `Set-Cookie` 헤더를 보내면 자동으로 저장되고 후속 요청에 포함된다.

```javascript
import http from 'k6/http';
import { check } from 'k6';

export default function () {
  // 자동 cookie 처리 (VU별 cookie jar)
  // 로그인 응답의 Set-Cookie가 자동으로 저장된다
  http.post('http://httpbin.demo.svc.cluster.local/cookies/set', null, {
    headers: { 'Content-Type': 'application/json' },
  });

  // 수동 cookie 설정
  const res = http.get('http://httpbin.demo.svc.cluster.local/cookies', {
    cookies: {
      session_id: 'abc123',
      user_pref: 'dark_mode',
    },
  });

  // cookie jar 직접 접근
  const jar = http.cookieJar();
  jar.set('http://httpbin.demo.svc.cluster.local', 'custom_cookie', 'value123');

  // 설정된 cookie 확인
  const cookies = jar.cookiesForURL('http://httpbin.demo.svc.cluster.local');
  console.log('Cookies:', JSON.stringify(cookies));

  // 모든 cookie 초기화
  jar.clear('http://httpbin.demo.svc.cluster.local');
}
```

### Authentication (인증)

```javascript
import http from 'k6/http';
import { check } from 'k6';
import encoding from 'k6/encoding';

export default function () {
  // 1. Basic Authentication
  const basicRes = http.get('http://httpbin.demo.svc.cluster.local/basic-auth/user/pass', {
    headers: {
      'Authorization': 'Basic ' + encoding.b64encode('user:pass'),
    },
  });

  // 2. Bearer Token Authentication
  const token = 'eyJhbGciOiJIUzI1NiIs...';  // setup()에서 획득한 토큰
  const bearerRes = http.get('http://api.example.com/protected', {
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  // 3. API Key Authentication
  const apiKeyRes = http.get('http://api.example.com/data', {
    headers: {
      'X-API-Key': 'api-key-12345',
    },
  });

  // 4. OAuth2 Client Credentials Flow
  const oauthRes = http.post('http://auth.example.com/oauth/token', {
    grant_type: 'client_credentials',
    client_id: 'my-client',
    client_secret: 'my-secret',
    scope: 'read write',
  });
  const accessToken = oauthRes.json('access_token');
}
```

### File Upload (파일 업로드)

```javascript
import http from 'k6/http';
import { check } from 'k6';

// init code에서 파일을 읽는다 (바이너리 모드)
const file = open('./testdata/image.png', 'b');  // 'b' = binary

export default function () {
  // multipart/form-data 파일 업로드
  const data = {
    file: http.file(file, 'image.png', 'image/png'),
    description: 'Test upload',
  };

  const res = http.post('http://httpbin.demo.svc.cluster.local/post', data);

  check(res, {
    'upload succeeded': (r) => r.status === 200,
  });
}
```

### Response 객체 활용

```javascript
import http from 'k6/http';
import { check } from 'k6';

export default function () {
  const res = http.get('http://httpbin.demo.svc.cluster.local/json');

  // JSON 파싱 — json() 메서드
  const data = res.json();             // 전체 JSON 파싱
  const origin = res.json('origin');   // JSONPath로 특정 필드 추출
  const nested = res.json('headers.Host');  // 중첩된 필드 추출

  // HTML 파싱 — html() 메서드
  const htmlRes = http.get('http://nginx-web.demo.svc.cluster.local');
  const doc = htmlRes.html();
  const title = doc.find('title').text();
  const links = doc.find('a').toArray();

  // 응답 시간 세부 분석
  console.log(`Total duration: ${res.timings.duration}ms`);
  console.log(`  - Blocked: ${res.timings.blocked}ms`);
  console.log(`  - Connecting: ${res.timings.connecting}ms`);
  console.log(`  - TLS: ${res.timings.tls_handshaking}ms`);
  console.log(`  - Sending: ${res.timings.sending}ms`);
  console.log(`  - Waiting (TTFB): ${res.timings.waiting}ms`);
  console.log(`  - Receiving: ${res.timings.receiving}ms`);
}
```

---

## 3.2 URL 그룹핑

동적 URL(예: `/users/123`, `/users/456`)을 사용하면 k6가 각 URL을 별도의 metric으로 기록하여 결과가 분산된다. `tags.name`이나 `http.url` 템플릿 함수를 사용하여 URL을 그룹핑해야 한다.

```javascript
import http from 'k6/http';

export default function () {
  const userId = Math.floor(Math.random() * 1000);

  // 나쁜 예: 각 URL이 별도 metric으로 기록된다
  // http.get(`http://api.example.com/users/${userId}`);

  // 좋은 예 1: tags.name으로 그룹핑
  http.get(`http://api.example.com/users/${userId}`, {
    tags: { name: 'GetUser' },
  });

  // 좋은 예 2: http.url 템플릿 리터럴
  http.get(http.url`http://api.example.com/users/${userId}`);
  // → metric URL이 "http://api.example.com/users/{}"로 그룹핑된다
}
```

---

# Part 4: Checks & Thresholds 심화

---

## 4.1 Check 패턴

Check는 개별 응답에 대한 assertion이다. 실패해도 테스트가 중단되지 않는다(soft fail).

### 기본 Check 패턴

```javascript
import http from 'k6/http';
import { check } from 'k6';

export default function () {
  const res = http.get('http://nginx-web.demo.svc.cluster.local');

  // 상태 코드 검증
  check(res, {
    'status is 200': (r) => r.status === 200,
    'status is not 500': (r) => r.status !== 500,
  });

  // 응답 본문 검증
  check(res, {
    'body is not empty': (r) => r.body.length > 0,
    'body contains expected text': (r) => r.body.includes('Welcome'),
  });

  // 응답 시간 검증
  check(res, {
    'response time < 200ms': (r) => r.timings.duration < 200,
    'TTFB < 100ms': (r) => r.timings.waiting < 100,
  });

  // 헤더 검증
  check(res, {
    'content-type is html': (r) =>
      r.headers['Content-Type'] && r.headers['Content-Type'].includes('text/html'),
    'has cache-control': (r) => r.headers['Cache-Control'] !== undefined,
  });
}
```

### JSON 응답 Check

```javascript
import http from 'k6/http';
import { check } from 'k6';

export default function () {
  const res = http.get('http://httpbin.demo.svc.cluster.local/json');

  check(res, {
    'status is 200': (r) => r.status === 200,
    'is valid JSON': (r) => {
      try {
        r.json();
        return true;
      } catch (e) {
        return false;
      }
    },
    'has slideshow data': (r) => r.json('slideshow') !== undefined,
    'slideshow has title': (r) => r.json('slideshow.title') !== undefined,
    'slideshow has slides': (r) => {
      const slides = r.json('slideshow.slides');
      return Array.isArray(slides) && slides.length > 0;
    },
  });
}
```

### Check와 태그 결합

```javascript
import http from 'k6/http';
import { check } from 'k6';

export default function () {
  // check에 태그를 부여하여 결과를 구분할 수 있다
  const nginxRes = http.get('http://nginx-web.demo.svc.cluster.local');
  check(nginxRes, {
    'nginx: status 200': (r) => r.status === 200,
  }, { service: 'nginx' });  // 세 번째 인자로 태그 전달

  const httpbinRes = http.get('http://httpbin.demo.svc.cluster.local/get');
  check(httpbinRes, {
    'httpbin: status 200': (r) => r.status === 200,
  }, { service: 'httpbin' });
}
```

### 조건부 Check — check 실패를 Threshold로 연결

```javascript
import http from 'k6/http';
import { check } from 'k6';
import { Rate } from 'k6/metrics';

// 커스텀 Rate metric으로 특정 check의 실패를 추적
const loginFailRate = new Rate('login_fail_rate');

export const options = {
  thresholds: {
    // check 전체 성공률이 99% 이상이어야 한다
    checks: ['rate>0.99'],
    // 로그인 실패율이 5% 미만이어야 한다
    login_fail_rate: ['rate<0.05'],
  },
};

export default function () {
  const res = http.post('http://api.example.com/login', JSON.stringify({
    username: 'user',
    password: 'pass',
  }), { headers: { 'Content-Type': 'application/json' } });

  const success = check(res, {
    'login succeeded': (r) => r.status === 200,
    'has token': (r) => r.json('token') !== undefined,
  });

  // check() 반환값: 모든 check가 통과하면 true, 하나라도 실패하면 false
  loginFailRate.add(!success);
}
```

---

## 4.2 Threshold 구문 상세

Threshold는 metric 집계값에 대한 통과/실패 기준이다. 테스트의 exit code를 결정하여 CI/CD 게이트 역할을 한다.

### Threshold에서 사용할 수 있는 집계 함수

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

### 다중 Threshold

하나의 metric에 여러 threshold를 설정할 수 있다. 모든 조건을 충족해야 통과한다:

```javascript
export const options = {
  thresholds: {
    http_req_duration: [
      'avg<200',      // 평균 200ms 미만
      'p(90)<300',    // p90 300ms 미만
      'p(95)<500',    // p95 500ms 미만
      'p(99)<1000',   // p99 1초 미만
      'max<3000',     // 최대 3초 미만
    ],
    http_req_failed: [
      'rate<0.01',    // 에러율 1% 미만
    ],
    http_reqs: [
      'count>1000',   // 최소 1000건 이상의 요청이 실행되어야 한다
    ],
    checks: [
      'rate>0.99',    // check 성공률 99% 이상
    ],
  },
};
```

### abortOnFail — 조기 중단 조건

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

**delayAbortEval의 중요성**: 테스트 시작 직후에는 연결 설정, JIT 워밍업 등으로 응답 시간이 비정상적으로 높을 수 있다. `delayAbortEval`을 설정하면 이 기간을 무시하고 안정 상태에서만 threshold를 평가한다.

### Tag-filtered Threshold

특정 태그를 가진 요청에 대해서만 threshold를 적용할 수 있다:

```javascript
export const options = {
  thresholds: {
    // URL name 태그로 필터링
    'http_req_duration{name:GetItems}': ['p(95)<300'],
    'http_req_duration{name:CreateItem}': ['p(95)<500'],
    'http_req_duration{name:HealthCheck}': ['p(95)<100'],

    // 커스텀 태그로 필터링
    'http_req_duration{type:api}': ['avg<200'],
    'http_req_duration{type:health}': ['avg<50'],

    // 시나리오별 필터링
    'http_req_duration{scenario:readers}': ['p(95)<200'],
    'http_req_duration{scenario:writers}': ['p(95)<500'],

    // HTTP 메서드별 필터링
    'http_req_duration{method:GET}': ['p(95)<200'],
    'http_req_duration{method:POST}': ['p(95)<500'],

    // 상태 코드별 필터링
    'http_req_duration{status:200}': ['max<1000'],
  },
};
```

### Custom Metric Threshold

커스텀 메트릭에도 threshold를 적용할 수 있다:

```javascript
import { Counter, Rate, Trend } from 'k6/metrics';

const apiLatency = new Trend('api_latency', true);
const apiErrors = new Counter('api_errors');
const apiSuccess = new Rate('api_success_rate');

export const options = {
  thresholds: {
    api_latency: ['p(95)<300', 'avg<100'],
    api_errors: ['count<10'],
    api_success_rate: ['rate>0.99'],
  },
};
```

---

## 4.3 Checks vs Thresholds 비교

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

