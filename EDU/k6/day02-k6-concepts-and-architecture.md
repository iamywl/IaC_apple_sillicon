# Day 2: k6 개념과 아키텍처

k6의 기본 개념, 내부 아키텍처(Go 런타임 + JavaScript VM), init code vs VU code, tart-infra 프로젝트 실습 환경, VU 라이프사이클, Open/Closed Model을 다룬다.

---

# Part 2: k6 개념

---

## 2.1 k6란?

k6는 Grafana Labs에서 개발한 오픈소스 부하 테스트 도구이다. 테스트 스크립트를 JavaScript(ES6+)로 작성하지만, 실행 엔진은 **Node.js가 아니라 Go 런타임에 내장된 goja JavaScript 엔진**이다. 이 아키텍처 선택이 k6의 핵심적인 성능 우위를 만든다.

### Node.js가 아닌 이유

Node.js 기반 도구(Artillery, Locust의 JS 바인딩 등)는 event loop와 garbage collection 오버헤드로 인해 VU 수가 증가할수록 테스트 도구 자체가 병목이 되는 문제가 있다. k6는 Go로 작성된 네이티브 바이너리 내부에서 goja(순수 Go로 구현된 ES5.1+ 엔진)를 사용하여 JavaScript를 실행한다. 각 VU는 독립적인 goja 런타임 인스턴스를 갖기 때문에 다음과 같은 이점이 있다:

- **높은 동시성**: goroutine 기반 스케줄링으로 수천 VU를 단일 프로세스에서 실행할 수 있다
- **낮은 메모리 사용량**: Node.js 대비 VU당 메모리 사용량이 현저히 적다
- **예측 가능한 성능**: GC pause가 최소화되어 측정 결과의 정확도가 높다
- **단일 바이너리 배포**: 의존성 없이 바이너리 하나로 실행 가능하다

---

## 2.2 k6 아키텍처 심화

### 전체 아키텍처 다이어그램

```
┌─────────────────────────────────────────────────────────┐
│                     k6 Process (Go)                      │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │                 Execution Scheduler                │   │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐            │   │
│  │  │Scenario1│ │Scenario2│ │Scenario3│  ...        │   │
│  │  │Executor │ │Executor │ │Executor │             │   │
│  │  └────┬────┘ └────┬────┘ └────┬────┘            │   │
│  └───────┼───────────┼───────────┼──────────────────┘   │
│          │           │           │                        │
│  ┌───────▼───────────▼───────────▼──────────────────┐   │
│  │                  VU Pool                           │   │
│  │  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐            │   │
│  │  │ VU 1 │ │ VU 2 │ │ VU 3 │ │VU N  │  ...       │   │
│  │  │(goja)│ │(goja)│ │(goja)│ │(goja)│             │   │
│  │  │      │ │      │ │      │ │      │             │   │
│  │  │ HTTP │ │ HTTP │ │ HTTP │ │ HTTP │             │   │
│  │  │Client│ │Client│ │Client│ │Client│             │   │
│  │  └──┬───┘ └──┬───┘ └──┬───┘ └──┬───┘            │   │
│  └─────┼────────┼────────┼────────┼─────────────────┘   │
│        │        │        │        │                       │
│  ┌─────▼────────▼────────▼────────▼─────────────────┐   │
│  │              Metrics Engine                        │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐       │   │
│  │  │ Built-in │  │ Custom   │  │ Threshold│       │   │
│  │  │ Metrics  │  │ Metrics  │  │ Engine   │       │   │
│  │  └──────────┘  └──────────┘  └──────────┘       │   │
│  └───────────────────┬──────────────────────────────┘   │
│                      │                                    │
│  ┌───────────────────▼──────────────────────────────┐   │
│  │               Output Engine                       │   │
│  │  ┌──────┐ ┌──────┐ ┌────────┐ ┌──────────────┐  │   │
│  │  │ JSON │ │ CSV  │ │InfluxDB│ │Prometheus RW │  │   │
│  │  └──────┘ └──────┘ └────────┘ └──────────────┘  │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

### Go Runtime의 역할

k6의 핵심 엔진은 Go로 작성되어 있다. Go 런타임은 다음을 담당한다:

1. **goroutine 스케줄링**: 각 VU는 하나의 goroutine으로 실행된다. Go 런타임의 M:N 스케줄링 모델(M개의 goroutine을 N개의 OS 스레드에 매핑)이 수천 VU의 동시 실행을 가능하게 한다.

2. **네트워크 I/O**: HTTP 클라이언트는 Go의 `net/http` 패키지를 사용한다. 연결 풀링, keep-alive, HTTP/2 multiplexing 등이 Go 표준 라이브러리 수준에서 처리된다.

3. **메모리 관리**: Go의 GC는 low-latency에 최적화되어 있다. 일반적으로 GC pause가 1ms 미만이므로, 측정 결과에 미치는 영향이 최소화된다.

4. **동시성 제어**: channel과 mutex를 사용하여 메트릭 수집, 임계값 평가, 출력 처리를 동시에 수행한다.

### goja JavaScript 엔진

goja는 순수 Go로 구현된 ECMAScript 5.1 호환 JavaScript 엔진이다. k6는 goja 위에 ES6+ 기능(arrow functions, template literals, destructuring, const/let 등)을 Babel 트랜스파일링으로 지원한다.

**goja의 특성:**

| 특성 | 설명 |
|------|------|
| JIT 없음 | 인터프리터 방식으로 실행된다. V8 대비 순수 JS 연산 속도는 느리지만, I/O 바운드 테스트에서는 차이가 미미하다 |
| 경량 | VM 인스턴스 하나가 수 KB 수준의 메모리만 사용한다 |
| 격리 | 각 VU의 goja 인스턴스는 완전히 격리되어 있다. 한 VU의 전역 상태가 다른 VU에 영향을 주지 않는다 |
| Go 연동 | Go 함수를 JavaScript에서 직접 호출할 수 있다. k6의 `http.get()` 등은 실제로 Go 함수를 호출하는 것이다 |

**goja에서 지원하지 않는 기능:**
- Node.js API (`fs`, `path`, `process` 등)
- 브라우저 API (`DOM`, `window`, `document` 등)
- `async/await` (k6 자체적으로 일부 지원)
- npm 패키지 직접 import (번들러를 통한 사용은 가능)

### VU Lifecycle 심화

각 VU의 생명주기를 상세히 살펴보면:

```
VU 생성
  │
  ▼
┌──────────────┐
│ 1. init code │ ← goja VM 초기화, 스크립트 파싱
│   (1회 실행)  │   import, open(), SharedArray 등
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ 2. setup()   │ ← 전체에서 딱 1회 실행 (VU 0번이 담당)
│   (1회 실행)  │   반환값은 JSON 직렬화되어 각 VU에 전달
└──────┬───────┘
       │
       ▼
┌──────────────┐     ┌───────────────────┐
│ 3. default() │────▶│ iteration 완료     │
│   (반복 실행) │◀────│ 조건 충족 시 반복  │
└──────┬───────┘     └───────────────────┘
       │ (duration 만료 또는 iterations 완료)
       ▼
┌──────────────┐
│ 4. teardown()│ ← 전체에서 딱 1회 실행
│   (1회 실행)  │   정리 작업 수행
└──────┬───────┘
       │
       ▼
VU 종료
```

**중요한 세부사항:**

1. **init code의 실행 횟수**: init code는 VU 수만큼 실행된다. VU가 100개이면 init code는 100번 실행된다. 이 때문에 대용량 파일을 `open()`으로 읽으면 메모리가 VU 수에 비례하여 증가한다.

2. **setup()의 반환값 직렬화**: setup()의 반환값은 `JSON.stringify()` → `JSON.parse()`를 거쳐 각 VU에 전달된다. 따라서 함수, Date 객체, RegExp 등 JSON으로 표현할 수 없는 값은 전달할 수 없다.

3. **VU 재사용**: `ramping-vus` executor에서 VU 수가 감소하면 VU가 풀에 반환되고, 다시 증가할 때 재사용된다. 이 때 VU의 전역 변수 상태가 유지된다.

4. **graceful stop**: duration이 만료되면 진행 중인 iteration이 즉시 중단되지 않고, `gracefulStop` 시간 동안 완료를 기다린다.

### Executor Model 심화

Executor는 VU를 언제, 얼마나 생성하고, iteration을 어떻게 분배할지를 결정하는 엔진이다.

```
┌─────────────────────────────────────────────────┐
│                    Scheduler                     │
│                                                  │
│  ┌────────────────┐    ┌────────────────┐       │
│  │  Executor A     │    │  Executor B     │       │
│  │  (ramping-vus)  │    │  (const-arr-rate)│      │
│  │                 │    │                  │       │
│  │  VU 할당 관리    │    │  Rate 유지 관리   │      │
│  │  Stage 전환     │    │  VU 자동 추가     │       │
│  └───────┬────────┘    └────────┬────────┘       │
│          │                      │                 │
│          ▼                      ▼                 │
│  ┌──────────────────────────────────────┐        │
│  │           VU Pool                     │        │
│  │  각 VU는 하나의 goroutine이다         │        │
│  │  Executor가 VU에 iteration을 할당한다 │        │
│  └──────────────────────────────────────┘        │
└─────────────────────────────────────────────────┘
```

**Executor의 핵심 책임:**
- VU의 생성과 소멸 시점 결정
- iteration의 시작 시점 결정 (Closed model: VU가 자율적, Open model: 외부에서 주입)
- stage 전환 (ramping 계열)
- maxVUs 관리 (arrival-rate 계열)

### Event Loop 동작

k6의 각 VU는 Go goroutine 내에서 동기적으로 실행된다. JavaScript 관점에서는 동기적으로 보이지만, 실제 네트워크 I/O는 Go 런타임의 비동기 I/O를 사용한다:

```
JavaScript (동기적 코드)          Go Runtime (비동기 I/O)
──────────────────────          ────────────────────────
http.get(url)          ──────▶  Go net/http 요청 발송
                                │
(goroutine blocked)    ◀────── 응답 대기 (epoll/kqueue)
                                │
response 반환          ◀────── 응답 수신
check(response, ...)            │
sleep(1)               ──────▶  time.Sleep(1 * time.Second)
(goroutine blocked)    ◀──────  │
다음 iteration 시작              │
```

이 모델의 핵심은, JavaScript 코드가 동기적으로 작성되지만 **Go 런타임 수준에서는 goroutine이 I/O 대기 중 다른 goroutine에게 CPU를 양보한다**는 것이다. 따라서 수천 VU가 동시에 실행되어도 CPU 코어 수 이상의 스레드가 필요하지 않다.

---

## 2.3 init code vs VU code

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

### init code에서 할 수 있는 것과 없는 것

| 가능 | 불가능 |
|------|--------|
| `import` 구문 | `http.get()`, `http.post()` 등 네트워크 호출 |
| `open()` — 로컬 파일 읽기 | `sleep()` |
| `SharedArray` 생성 | `check()` |
| 전역 변수 선언 | `group()` |
| `JSON.parse()` 등 데이터 처리 | metric 추가 (`counter.add()` 등) |
| `export const options = {...}` | |

---

## 2.4 이 프로젝트에서의 실습 환경

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

### 프로젝트 k6-loadtest.yaml 분석

프로젝트의 `manifests/demo/k6-loadtest.yaml`은 다음과 같은 구조이다:

```yaml
# ConfigMap: k6 스크립트를 Kubernetes에 저장한다
apiVersion: v1
kind: ConfigMap
metadata:
  name: k6-script
  namespace: demo
data:
  loadtest.js: |
    import http from 'k6/http';
    import { check, sleep } from 'k6';

    export const options = {
      vus: 100,              # 동시 가상 사용자 100명
      duration: '60s',       # 60초 동안 실행
      thresholds: {
        http_req_duration: ['p(95)<1000'],  # p95 < 1초
        http_req_failed: ['rate<0.1'],      # 에러율 < 10%
      },
    };

    export default function () {
      // nginx-web 서비스 테스트
      const resNginx = http.get('http://nginx-web.demo.svc.cluster.local');
      check(resNginx, {
        'nginx status is 200': (r) => r.status === 200,
      });

      // httpbin 서비스 테스트
      const resHttpbin = http.get('http://httpbin.demo.svc.cluster.local/get');
      check(resHttpbin, {
        'httpbin status is 200': (r) => r.status === 200,
      });

      sleep(0.3);  # 요청 간 300ms 대기
    }
---
# Job: k6를 Kubernetes에서 실행한다
apiVersion: batch/v1
kind: Job
metadata:
  name: k6-loadtest
  namespace: demo
spec:
  backoffLimit: 0           # 실패 시 재시도하지 않는다
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: k6
          image: grafana/k6:latest
          command: ["k6", "run", "/scripts/loadtest.js"]
          resources:
            requests:
              cpu: 500m       # 최소 0.5 코어
              memory: 256Mi   # 최소 256MB
            limits:
              cpu: "1"        # 최대 1 코어
              memory: 512Mi   # 최대 512MB
          volumeMounts:
            - name: k6-script
              mountPath: /scripts
      volumes:
        - name: k6-script
          configMap:
            name: k6-script
```

**주요 설정 분석:**

| 설정 | 값 | 의미 |
|------|---|------|
| `vus: 100` | 100개 VU | Little's law에 의해 약 323 RPS 생성 (avg response 10ms + sleep 300ms) |
| `duration: '60s'` | 60초 | 짧은 부하 테스트이다. HPA 반응을 확인하기에 충분한 시간이다 |
| `p(95)<1000` | p95 < 1초 | nginx 정적 페이지이므로 매우 관대한 기준이다 |
| `rate<0.1` | 에러율 < 10% | 스트레스 상황을 고려한 관대한 기준이다 |
| `cpu: 500m / 1` | 0.5~1 코어 | k6 프로세스가 100 VU를 실행하기에 충분한 자원이다 |
| `memory: 256Mi / 512Mi` | 256~512MB | VU당 약 2~3MB이므로 100 VU에 적절하다 |

### HPA 연동 관찰 방법

k6 부하 테스트를 실행하면서 HPA의 스케일링 동작을 관찰하는 워크플로우:

```bash
# 터미널 1: k6 부하 테스트 실행
export KUBECONFIG=kubeconfig/dev.yaml
kubectl apply -f manifests/demo/k6-loadtest.yaml
kubectl logs -n demo job/k6-loadtest -f

# 터미널 2: HPA 상태 실시간 모니터링
kubectl get hpa -n demo -w

# 터미널 3: Pod 수 변화 모니터링
kubectl get pods -n demo -l app=nginx-web -w

# 터미널 4: 리소스 사용량 모니터링
kubectl top pods -n demo --sort-by=cpu

# 테스트 완료 후 정리
kubectl delete job k6-loadtest -n demo
```

---

## 2.5 VU 라이프사이클

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

### handleSummary() — 결과 커스터마이징

k6는 테스트 종료 후 `handleSummary()` 함수를 호출하여 결과 출력을 커스터마이징할 수 있다:

```javascript
export function handleSummary(data) {
  // data 객체에는 모든 메트릭의 집계값이 포함되어 있다
  console.log('Total requests: ' + data.metrics.http_reqs.values.count);
  console.log('Avg duration: ' + data.metrics.http_req_duration.values.avg);

  return {
    // 파일로 출력
    'summary.json': JSON.stringify(data, null, 2),
    // stdout으로 출력 (기본 summary 대체)
    stdout: generateTextSummary(data),
  };
}

function generateTextSummary(data) {
  const duration = data.metrics.http_req_duration;
  return `
=== Custom Summary ===
Total Requests: ${data.metrics.http_reqs.values.count}
Avg Response Time: ${duration.values.avg.toFixed(2)}ms
P95 Response Time: ${duration.values['p(95)'].toFixed(2)}ms
P99 Response Time: ${duration.values['p(99)'].toFixed(2)}ms
Error Rate: ${(data.metrics.http_req_failed.values.rate * 100).toFixed(2)}%
`;
}
```

---

## 2.6 Open Model vs Closed Model

부하 테스트에는 두 가지 모델이 존재한다:

| 모델 | 설명 | k6 Executor |
|------|------|-------------|
| **Closed Model** | 이전 iteration이 완료되어야 다음 iteration이 시작된다. VU 수를 기준으로 부하를 조절한다 | `constant-vus`, `ramping-vus`, `shared-iterations`, `per-vu-iterations` |
| **Open Model** | iteration 완료 여부와 무관하게 일정한 rate로 새 iteration을 시작한다. 실제 트래픽 패턴에 가깝다 | `constant-arrival-rate`, `ramping-arrival-rate` |

Closed model은 서버 응답이 느려지면 자동으로 요청 rate가 감소한다(coordinated omission 문제). 실제 사용자 트래픽을 시뮬레이션할 때는 open model(arrival-rate 기반 executor)이 더 정확하다.

### Coordinated Omission 문제 상세

Coordinated omission은 부하 테스트에서 가장 흔한 측정 오류이다. Closed model에서 서버가 느려지면:

```
Closed Model (coordinated omission 발생):
──────────────────────────────────────────

VU 1: ├──req──┤├──req──┤├────req(느림)────┤├──req──┤
VU 2: ├──req──┤├──req──┤├────req(느림)────┤├──req──┤

서버가 느려지면 → 요청 간격이 자동으로 늘어남 → RPS 감소
→ "서버가 느려졌으니 부하를 줄여주겠다" (실제 사용자는 이렇게 하지 않는다!)

Open Model (coordinated omission 방지):
──────────────────────────────────────────

Rate: ├─req─┤├─req─┤├─req─┤├─req─┤├─req─┤├─req─┤
      ↑     ↑     ↑     ↑     ↑     ↑
      일정한 간격으로 새 요청 시작 (서버 응답과 무관)

서버가 느려져도 → 요청 간격 유지 → VU 자동 추가 (maxVUs까지)
→ "실제 사용자처럼 동작" (요청은 계속 들어온다)
```

실무에서의 권장사항:
- **API 성능 벤치마킹**: `constant-arrival-rate` 사용 (일정한 throughput 유지)
- **사용자 시나리오 시뮬레이션**: `ramping-vus` 사용 (think time 포함)
- **시스템 한계점 탐색**: `ramping-arrival-rate` 사용 (점진적 throughput 증가)

---

## 2.7 핵심 개념

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

