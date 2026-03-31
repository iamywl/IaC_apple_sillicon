# Day 5: Groups & Tags, 프로토콜, 브라우저 테스트

테스트 논리적 구조화(Groups), 메트릭 분류(Tags), HTTP/WebSocket/gRPC/SOAP 프로토콜 지원, 그리고 k6 Browser Module을 다룬다.

---

# Part 8: Groups & Tags

---

## 8.1 Groups — 테스트 논리적 구조화

`group()`은 테스트 로직을 논리적으로 묶어 결과를 계층적으로 표시한다. 각 group은 별도의 metric을 생성한다.

```javascript
import http from 'k6/http';
import { check, group, sleep } from 'k6';

const BASE_URL = 'http://httpbin.demo.svc.cluster.local';

export default function () {
  group('01_Homepage', function () {
    const res = http.get('http://nginx-web.demo.svc.cluster.local');
    check(res, {
      'homepage loaded': (r) => r.status === 200,
    });
    sleep(1);
  });

  group('02_API_Flow', function () {
    group('02a_Health_Check', function () {
      const res = http.get(`${BASE_URL}/get`);
      check(res, { 'health OK': (r) => r.status === 200 });
    });

    group('02b_Create_Resource', function () {
      const res = http.post(`${BASE_URL}/post`,
        JSON.stringify({ name: 'test' }),
        { headers: { 'Content-Type': 'application/json' } }
      );
      check(res, { 'created': (r) => r.status === 200 });
    });

    group('02c_Verify_Resource', function () {
      const res = http.get(`${BASE_URL}/get`);
      check(res, { 'verified': (r) => r.status === 200 });
    });
  });

  sleep(1);
}
```

**결과 출력:**
```
█ 01_Homepage
  ✓ homepage loaded

█ 02_API_Flow
  █ 02a_Health_Check
    ✓ health OK
  █ 02b_Create_Resource
    ✓ created
  █ 02c_Verify_Resource
    ✓ verified

group_duration{group:::01_Homepage}: avg=105ms min=100ms ...
group_duration{group:::02_API_Flow}: avg=310ms min=290ms ...
group_duration{group:::02_API_Flow::02a_Health_Check}: avg=100ms ...
```

### group의 주의사항

- group은 중첩 가능하다 (최대 깊이 제한 없음)
- group 이름은 metric 태그로 사용되므로, 동적 이름은 피해야 한다
- group은 `group_duration` metric을 자동 생성한다
- group 내에서 예외가 발생하면 해당 group의 나머지 코드가 실행되지 않는다

---

## 8.2 Tags — 메트릭 분류

### System Tags (자동 태그)

k6는 모든 HTTP 요청에 자동으로 system tag를 부여한다:

| Tag | 설명 | 예시 |
|-----|------|------|
| `method` | HTTP 메서드 | `GET`, `POST` |
| `url` | 요청 URL | `http://nginx-web.demo.svc.cluster.local/` |
| `name` | 요청 이름 (태그로 지정 가능) | URL과 같거나 커스텀 값 |
| `status` | HTTP 상태 코드 | `200`, `404`, `500` |
| `proto` | HTTP 프로토콜 | `HTTP/1.1`, `HTTP/2.0` |
| `group` | 현재 group 이름 | `::01_Homepage` |
| `scenario` | 현재 시나리오 이름 | `default`, `readers` |
| `check` | check 이름 | `status is 200` |
| `error` | 에러 유형 | `dial: connection refused` |
| `error_code` | k6 에러 코드 | `1000` (generic error) |
| `tls_version` | TLS 버전 | `tls1.2`, `tls1.3` |
| `expected_response` | 기대 응답 여부 | `true`, `false` |

### Custom Tags

```javascript
import http from 'k6/http';

export default function () {
  // 요청별 커스텀 태그
  http.get('http://nginx-web.demo.svc.cluster.local', {
    tags: {
      name: 'NginxHomepage',
      type: 'frontend',
      priority: 'high',
    },
  });

  http.get('http://httpbin.demo.svc.cluster.local/get', {
    tags: {
      name: 'HttpbinGet',
      type: 'api',
      priority: 'medium',
    },
  });
}

export const options = {
  thresholds: {
    'http_req_duration{type:frontend}': ['p(95)<200'],
    'http_req_duration{type:api}': ['p(95)<500'],
    'http_req_duration{priority:high}': ['p(99)<300'],
  },
};
```

### Tag 필터링 (CLI)

```bash
# 특정 태그 값만 출력에 포함
k6 run --tag name=NginxHomepage script.js

# JSON 출력에서 태그별 필터링
k6 run --out json=results.json script.js
# 후처리: jq '.data.tags.name' results.json | sort | uniq -c
```

### 시나리오별 Tags

```javascript
export const options = {
  scenarios: {
    api_test: {
      executor: 'constant-vus',
      vus: 50,
      duration: '5m',
      exec: 'apiTest',
      tags: { test_type: 'api', environment: 'dev' },
      env: { BASE_URL: 'http://httpbin.demo.svc.cluster.local' },
    },
    web_test: {
      executor: 'constant-vus',
      vus: 20,
      duration: '5m',
      exec: 'webTest',
      tags: { test_type: 'web', environment: 'dev' },
      env: { BASE_URL: 'http://nginx-web.demo.svc.cluster.local' },
    },
  },
};
```

---

# Part 9: Protocols (프로토콜 지원)

---

## 9.1 HTTP/1.1 & HTTP/2

k6는 HTTP/1.1과 HTTP/2를 기본 지원한다. HTTP/2는 ALPN negotiation을 통해 자동으로 선택된다.

```javascript
import http from 'k6/http';
import { check } from 'k6';

export const options = {
  // HTTP/2 관련 설정
  // k6는 기본적으로 HTTP/2를 지원한다. HTTPS 연결 시 자동으로 h2 negotiation이 이루어진다.
};

export default function () {
  const res = http.get('https://test.k6.io/');
  check(res, {
    'is HTTP/2': (r) => r.proto === 'HTTP/2.0',
  });
  console.log(`Protocol: ${res.proto}`);
}
```

### HTTP/2 특성과 k6에서의 동작

| 특성 | HTTP/1.1 | HTTP/2 |
|------|----------|--------|
| 연결 | 도메인당 6개 제한 | 단일 연결로 다중 스트림 |
| 헤더 | 텍스트, 중복 전송 | HPACK 압축 |
| 서버 푸시 | 미지원 | 지원 (k6에서는 무시) |
| 우선순위 | 불가 | 스트림 우선순위 |

---

## 9.2 WebSocket

k6는 WebSocket을 기본 지원한다. 실시간 통신 시스템(채팅, 알림, 실시간 데이터 스트림)의 부하 테스트에 사용한다.

```javascript
import ws from 'k6/ws';
import { check } from 'k6';

export const options = {
  vus: 10,
  duration: '1m',
};

export default function () {
  const url = 'ws://echo.websocket.org';
  const params = {
    headers: { 'X-Custom-Header': 'k6-test' },
    tags: { name: 'WebSocketEcho' },
  };

  const res = ws.connect(url, params, function (socket) {
    // 연결 성공
    socket.on('open', function () {
      console.log('WebSocket connected');

      // 주기적으로 메시지 전송
      socket.setInterval(function () {
        socket.send(JSON.stringify({
          type: 'ping',
          timestamp: Date.now(),
        }));
      }, 1000);  // 1초마다

      // 5초 후 종료
      socket.setTimeout(function () {
        console.log('Closing WebSocket');
        socket.close();
      }, 5000);
    });

    // 메시지 수신
    socket.on('message', function (msg) {
      const data = JSON.parse(msg);
      console.log(`Received: ${data.type}`);
    });

    // 에러 처리
    socket.on('error', function (e) {
      console.error(`WebSocket error: ${e.error()}`);
    });

    // 연결 종료
    socket.on('close', function () {
      console.log('WebSocket disconnected');
    });

    // ping/pong
    socket.on('pong', function () {
      console.log('Pong received');
    });
  });

  check(res, {
    'ws status is 101': (r) => r && r.status === 101,
  });
}
```

### WebSocket Metric

WebSocket 관련 built-in metric:

| Metric | 유형 | 설명 |
|--------|------|------|
| `ws_connecting` | Trend | WebSocket 연결 수립 시간 |
| `ws_msgs_sent` | Counter | 전송한 메시지 수 |
| `ws_msgs_received` | Counter | 수신한 메시지 수 |
| `ws_sessions` | Counter | WebSocket 세션 수 |
| `ws_session_duration` | Trend | 세션 지속 시간 |

---

## 9.3 gRPC

k6는 gRPC를 기본 지원한다. .proto 파일을 로드하여 gRPC 서비스를 테스트할 수 있다.

```javascript
import grpc from 'k6/net/grpc';
import { check, sleep } from 'k6';

const client = new grpc.Client();
client.load(['definitions'], 'hello.proto');

export const options = {
  vus: 10,
  duration: '30s',
};

export default function () {
  // gRPC 서버에 연결
  client.connect('grpc-server.example.com:443', {
    plaintext: false,          // TLS 사용
    // plaintext: true,        // TLS 미사용 (개발 환경)
    timeout: '5s',
    reflect: false,            // gRPC reflection 사용 여부
  });

  // Unary RPC
  const response = client.invoke('hello.HelloService/SayHello', {
    greeting: 'k6',
  });

  check(response, {
    'status is OK': (r) => r && r.status === grpc.StatusOK,
    'has message': (r) => r && r.message.reply !== '',
  });

  // 메타데이터(헤더) 전송
  const metadata = {
    'x-request-id': 'req-123',
    'authorization': 'Bearer token123',
  };

  const response2 = client.invoke('hello.HelloService/SayHello', {
    greeting: 'authenticated k6',
  }, { metadata: metadata });

  client.close();
  sleep(0.5);
}
```

### gRPC Status Codes

```javascript
import grpc from 'k6/net/grpc';

// 주요 gRPC 상태 코드
grpc.StatusOK;                  // 0  - 성공
grpc.StatusCancelled;           // 1  - 취소됨
grpc.StatusUnknown;             // 2  - 알 수 없는 에러
grpc.StatusInvalidArgument;     // 3  - 잘못된 인자
grpc.StatusDeadlineExceeded;    // 4  - 데드라인 초과
grpc.StatusNotFound;            // 5  - 찾을 수 없음
grpc.StatusAlreadyExists;       // 6  - 이미 존재
grpc.StatusPermissionDenied;    // 7  - 권한 거부
grpc.StatusResourceExhausted;   // 8  - 자원 소진
grpc.StatusFailedPrecondition;  // 9  - 전제 조건 실패
grpc.StatusAborted;             // 10 - 중단됨
grpc.StatusInternal;            // 13 - 내부 에러
grpc.StatusUnavailable;         // 14 - 서비스 불가
grpc.StatusUnauthenticated;     // 16 - 미인증
```

### gRPC Streaming

```javascript
import grpc from 'k6/net/grpc';
import { check } from 'k6';

const client = new grpc.Client();
client.load(['definitions'], 'streaming.proto');

export default function () {
  client.connect('grpc-server.example.com:443', { plaintext: true });

  // Server Streaming
  const stream = new grpc.Stream(client, 'streaming.StreamService/ServerStream');

  stream.on('data', function (data) {
    console.log('Received:', JSON.stringify(data));
  });

  stream.on('error', function (err) {
    console.error('Stream error:', err);
  });

  stream.on('end', function () {
    console.log('Stream ended');
    client.close();
  });

  // 스트림 시작 (request 전송)
  stream.write({ query: 'test' });
}
```

---

## 9.4 SOAP

k6는 SOAP 전용 모듈은 없지만, HTTP 모듈로 SOAP 요청을 보낼 수 있다:

```javascript
import http from 'k6/http';
import { check } from 'k6';

export default function () {
  const soapEnvelope = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:web="http://www.example.com/webservice">
  <soap:Header/>
  <soap:Body>
    <web:GetUser>
      <web:UserId>123</web:UserId>
    </web:GetUser>
  </soap:Body>
</soap:Envelope>`;

  const res = http.post('http://soap-service.example.com/ws', soapEnvelope, {
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction': 'http://www.example.com/webservice/GetUser',
    },
  });

  check(res, {
    'status is 200': (r) => r.status === 200,
    'has SOAP response': (r) => r.body.includes('GetUserResponse'),
  });
}
```

---

# Part 10: Browser Testing (브라우저 테스트)

---

## 10.1 k6 Browser Module

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

### Web Vitals 측정

브라우저 테스트로 Core Web Vitals를 측정할 수 있다:

| Metric | 설명 | 좋은 값 |
|--------|------|---------|
| LCP (Largest Contentful Paint) | 가장 큰 콘텐츠 요소가 표시되는 시간 | < 2.5s |
| FID (First Input Delay) | 사용자의 첫 입력에 대한 응답 지연 | < 100ms |
| CLS (Cumulative Layout Shift) | 레이아웃 변경 누적 점수 | < 0.1 |
| TTFB (Time to First Byte) | 서버 응답의 첫 바이트 수신 시간 | < 800ms |

### Page Object Model 패턴

```javascript
// page-objects/login-page.js
export class LoginPage {
  constructor(page) {
    this.page = page;
    this.usernameInput = page.locator('#username');
    this.passwordInput = page.locator('#password');
    this.submitButton = page.locator('button[type="submit"]');
    this.errorMessage = page.locator('.error-message');
  }

  async goto() {
    await this.page.goto('https://test.k6.io/my_messages.php');
  }

  async login(username, password) {
    await this.usernameInput.type(username);
    await this.passwordInput.type(password);
    await this.submitButton.click();
    await this.page.waitForNavigation();
  }

  isErrorVisible() {
    return this.errorMessage.isVisible();
  }
}
```

```javascript
// browser-test.js
import { browser } from 'k6/browser';
import { check } from 'https://jslib.k6.io/k6-utils/1.5.0/index.js';
import { LoginPage } from './page-objects/login-page.js';

export const options = {
  scenarios: {
    browser_login: {
      executor: 'shared-iterations',
      iterations: 5,
      vus: 1,
      options: {
        browser: { type: 'chromium' },
      },
    },
  },
};

export default async function () {
  const page = await browser.newPage();

  try {
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.login('admin', 'password123');

    check(page, {
      'login successful': (p) => p.url().includes('my_messages'),
      'no error': () => !loginPage.isErrorVisible(),
    });
  } finally {
    await page.close();
  }
}
```

### Protocol + Browser 혼합 테스트

실제 사용 사례에서는 브라우저 테스트와 프로토콜 테스트를 함께 실행한다:

```javascript
import http from 'k6/http';
import { browser } from 'k6/browser';
import { check, sleep } from 'k6';

export const options = {
  scenarios: {
    // 프로토콜 수준 부하 (많은 VU)
    api_load: {
      executor: 'constant-vus',
      vus: 100,
      duration: '5m',
      exec: 'apiTest',
    },
    // 브라우저 수준 테스트 (적은 VU)
    browser_test: {
      executor: 'shared-iterations',
      iterations: 10,
      vus: 2,
      exec: 'browserTest',
      options: {
        browser: { type: 'chromium' },
      },
    },
  },
};

export function apiTest() {
  http.get('http://nginx-web.demo.svc.cluster.local');
  sleep(0.1);
}

export async function browserTest() {
  const page = await browser.newPage();
  try {
    await page.goto('http://nginx-web.demo.svc.cluster.local');
    check(page, {
      'page loaded': (p) => p.locator('body').isVisible(),
    });
  } finally {
    await page.close();
  }
}
```

---

