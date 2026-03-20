# Day 7: 분산 테스트, 성능 분석, 트러블슈팅, 실전 시나리오

k6-operator를 활용한 Kubernetes 분산 테스트, Response Time 분석과 병목 식별, 트러블슈팅 가이드, 그리고 API Load Test와 Microservice Chain Test 실전 시나리오를 다룬다.

---

# Part 14: Distributed Testing (분산 테스트)

---

## 14.1 k6-operator for Kubernetes

k6-operator는 Kubernetes에서 k6를 분산 실행하는 operator이다. 단일 머신의 자원 제한을 넘어서는 대규모 부하 테스트를 가능하게 한다.

### 아키텍처

```
┌──────────────────────────────────────────────────────┐
│                  Kubernetes Cluster                    │
│                                                       │
│  ┌─────────────┐                                     │
│  │ k6-operator  │ ← CRD 감시, TestRun 관리           │
│  │ (Controller) │                                     │
│  └──────┬──────┘                                     │
│         │                                             │
│         ▼                                             │
│  ┌──────────────────────────────────────────┐        │
│  │          TestRun CRD                      │        │
│  │  spec:                                    │        │
│  │    parallelism: 4  ← 4개의 k6 Pod 실행    │        │
│  │    script:                                │        │
│  │      configMap: k6-script                 │        │
│  └──────────────────────────────────────────┘        │
│         │                                             │
│         ▼                                             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐│
│  │ k6 Pod 1 │ │ k6 Pod 2 │ │ k6 Pod 3 │ │ k6 Pod 4 ││
│  │ 25 VU    │ │ 25 VU    │ │ 25 VU    │ │ 25 VU    ││
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘│
│       │            │            │            │        │
│       └────────────┼────────────┼────────────┘        │
│                    ▼                                   │
│            ┌──────────────┐                           │
│            │ Target Service│                           │
│            │ (nginx-web)  │                           │
│            └──────────────┘                           │
└──────────────────────────────────────────────────────┘
```

### k6-operator 설치

```bash
# Helm으로 설치
helm repo add grafana https://grafana.github.io/helm-charts
helm repo update
helm install k6-operator grafana/k6-operator -n k6-operator-system --create-namespace

# 또는 kubectl로 직접 설치
kubectl apply -f https://github.com/grafana/k6-operator/releases/latest/download/bundle.yaml
```

### TestRun CRD 정의

```yaml
# k6-distributed-test.yaml
apiVersion: k6.io/v1alpha1
kind: TestRun
metadata:
  name: k6-distributed-load-test
  namespace: demo
spec:
  parallelism: 4                    # 4개의 k6 Pod 실행
  script:
    configMap:
      name: k6-script               # ConfigMap에 저장된 스크립트
      file: loadtest.js
  runner:
    image: grafana/k6:latest
    resources:
      requests:
        cpu: "500m"
        memory: "256Mi"
      limits:
        cpu: "1"
        memory: "512Mi"
    env:
      - name: K6_OUT
        value: "influxdb=http://influxdb.monitoring:8086/k6"
  separate: false                   # true: 각 Pod가 독립적으로 실행
                                    # false: 동기화된 시작 (기본값)
```

```bash
# tart-infra 프로젝트에서 분산 테스트 실행
export KUBECONFIG=kubeconfig/dev.yaml
kubectl apply -f k6-distributed-test.yaml

# TestRun 상태 확인
kubectl get testrun -n demo

# k6 Pod 로그 확인
kubectl logs -l k6_cr=k6-distributed-load-test -n demo -f
```

### 분산 실행 시 VU 분배

parallelism=4, 스크립트에 vus=100인 경우:
- 각 Pod가 vus=100으로 실행된다 (총 400 VU)
- 총 VU를 나누려면 스크립트에서 환경 변수로 조정해야 한다

```javascript
// 분산 실행을 고려한 스크립트
const TOTAL_VUS = parseInt(__ENV.TOTAL_VUS || '100');
const PARALLELISM = parseInt(__ENV.PARALLELISM || '1');
const VUS_PER_POD = Math.ceil(TOTAL_VUS / PARALLELISM);

export const options = {
  vus: VUS_PER_POD,
  duration: '5m',
};
```

---

# Part 15: 성능 분석

---

## 15.1 Response Time Distribution 분석

응답 시간 분포를 분석하면 시스템의 성능 특성을 파악할 수 있다.

### 정상 분포 vs 이상 분포

```
정상 분포 (unimodal):
  │    ▄▄▄
  │   ▄████▄
  │  ▄██████▄
  │ ▄████████▄
  │▄██████████▄
  └──────────────── 응답 시간
     avg=med → 정상

이중 피크 분포 (bimodal):
  │  ▄▄▄        ▄▄
  │ ▄████▄    ▄████▄
  │▄██████▄  ▄██████▄
  └──────────────────── 응답 시간
  ← 빠른 응답    느린 응답 →
  캐시 히트      캐시 미스
  → 두 가지 다른 코드 경로가 존재

오른쪽 꼬리 분포 (right-skewed):
  │▄▄▄
  │████▄
  │█████▄▄
  │██████████▄▄▄▄▄___________
  └──────────────────────────── 응답 시간
  avg > med → tail latency 존재
  → GC, DB lock, 외부 서비스 지연 등이 원인
```

### Throughput Analysis

```
이상적인 throughput 곡선:

  RPS│         ┌──────────── 포화점 (saturation)
     │        ╱
     │       ╱
     │      ╱  ← 선형 구간 (부하에 비례하여 throughput 증가)
     │     ╱
     │    ╱
     │   ╱
     │  ╱
     │ ╱
     └──────────────── VU (부하)

실제 throughput 곡선:

  RPS│         ┌────────── 포화점
     │        ╱ ╲
     │       ╱   ╲  ← 과부하 구간 (throughput 감소)
     │      ╱     ╲
     │     ╱       ╲
     │    ╱
     │   ╱
     │  ╱
     │ ╱
     └──────────────── VU (부하)

     포화점 이후 throughput이 감소하면:
     - CPU 경쟁으로 context switch 증가
     - 연결 풀 고갈로 대기 시간 증가
     - 메모리 부족으로 GC 빈도 증가
```

---

## 15.2 Correlation Analysis (상관 분석)

성능 지표 간의 상관관계를 분석하면 병목의 원인을 찾을 수 있다:

| 현상 | 가능한 원인 | 확인 방법 |
|------|------------|-----------|
| VU 증가 → 응답 시간 선형 증가 | CPU 병목 | `kubectl top pods`, CPU 사용률 확인 |
| VU 증가 → 응답 시간 급증 | 연결 풀/스레드 풀 고갈 | `http_req_blocked` 증가 여부 |
| 시간 경과 → 응답 시간 점진적 증가 | 메모리 누수 | 메모리 사용량 추이 |
| 특정 시점에 에러 급증 | OOM Kill, Pod 재시작 | `kubectl get events` |
| p99 >> p95 >> p50 | tail latency, GC pause | GC 로그, 외부 호출 분석 |
| `http_req_blocked` 높음 | 연결 풀 포화 | 연결 수 모니터링 |
| `http_req_connecting` 높음 | DNS 문제, TLS 오버헤드 | `http_req_tls_handshaking` 확인 |
| `http_req_waiting` 높음 | 서버 처리 시간 | 서버 측 APM 확인 |

---

## 15.3 Bottleneck Identification

### 응답 시간 분해

k6의 HTTP timing 지표를 사용하여 병목 위치를 정확히 파악한다:

```
total duration = blocked + connecting + tls_handshaking + sending + waiting + receiving

┌─blocked─┬─connecting─┬─tls─┬─sending─┬──waiting──┬─receiving─┐
│         │            │     │         │           │           │
│ 연결 풀  │  TCP 연결   │ TLS │ 요청 전송│ 서버 처리  │ 응답 수신  │
│ 대기     │  수립       │     │         │ (TTFB)    │           │
└─────────┴────────────┴─────┴─────────┴───────────┴───────────┘

병목 판단:
  blocked ↑    → 연결 풀 포화. maxConnectionsPerHost 증가 또는 VU 감소 필요
  connecting ↑ → DNS 문제 또는 네트워크 지연. DNS 캐싱 확인
  tls ↑        → TLS handshake 오버헤드. TLS session resumption 확인
  sending ↑    → 요청 body가 큰 경우. 압축 고려
  waiting ↑    → 서버 처리 시간. 서버 측 최적화 필요 (쿼리, 캐시 등)
  receiving ↑  → 응답 body가 큰 경우. 페이지네이션, 필드 선택 고려
```

### tart-infra에서의 병목 분석

```bash
# 1. k6 부하 테스트 실행
export KUBECONFIG=kubeconfig/dev.yaml
kubectl apply -f manifests/demo/k6-loadtest.yaml

# 2. 테스트 중 리소스 모니터링
kubectl top pods -n demo --sort-by=cpu
kubectl top pods -n demo --sort-by=memory

# 3. HPA 상태 확인 — 스케일링이 발생하는지
kubectl get hpa -n demo -w

# 4. Pod 이벤트 확인 — OOM Kill 등
kubectl get events -n demo --sort-by=.lastTimestamp

# 5. k6 결과에서 병목 판단
kubectl logs job/k6-loadtest -n demo | tail -30
# → http_req_blocked가 높으면: 연결 풀 문제
# → http_req_waiting이 높으면: 서버 CPU/메모리 부족
# → http_req_failed가 높으면: Pod OOM Kill 또는 서비스 불가
```

---

# Part 16: 트러블슈팅

---

## 16.1 Resource Limits (자원 제한)

### k6 프로세스 자체의 자원 제한

k6는 Go 프로그램이므로, 실행 환경의 자원 제한에 영향을 받는다.

**파일 디스크립터 제한:**

```bash
# 현재 파일 디스크립터 제한 확인
ulimit -n

# 제한 증가 (Linux)
ulimit -n 65536

# 영구 설정 (/etc/security/limits.conf)
# * soft nofile 65536
# * hard nofile 65536
```

VU 수가 많으면 TCP 연결 수가 급증하여 파일 디스크립터가 부족할 수 있다. VU 1,000개를 실행하면 최소 1,000개의 TCP 연결(파일 디스크립터)이 필요하다.

**CPU 제한:**

```
증상: k6 프로세스의 CPU 사용률이 100%에 도달
원인: VU 수가 CPU 코어 수 대비 너무 많음
해결:
  1. VU 수를 줄인다
  2. sleep을 늘린다 (VU가 CPU를 점유하는 시간 감소)
  3. 분산 실행한다 (k6-operator)
  4. 더 강력한 머신을 사용한다

확인:
  Kubernetes에서: resources.limits.cpu를 충분히 설정
  로컬에서: top 또는 htop으로 k6 프로세스 CPU 확인
```

**메모리 제한:**

```
증상: k6 프로세스가 OOM Kill 됨
원인:
  1. open()으로 대용량 파일을 읽을 때 (VU 수 × 파일 크기)
  2. 응답 body가 큰 요청을 많이 보낼 때
  3. Custom metric이 너무 많을 때

해결:
  1. SharedArray 사용 (open() 대신)
  2. responseType: 'none' 사용 (body 무시)
  3. 태그 카디널리티 줄이기 (동적 URL 그룹핑)
  4. resources.limits.memory 증가

메모리 추정:
  VU 100개 × VU당 ~3MB = ~300MB
  + SharedArray 데이터 크기
  + 응답 body 캐시
  → 최소 512MB, 여유 있게 1GB 권장
```

---

## 16.2 DNS Issues

```
증상: http_req_connecting이 비정상적으로 높음
원인: DNS 해석이 매 요청마다 발생

해결:

1. k6 DNS 캐싱 설정 (options):
export const options = {
  dns: {
    ttl: '5m',        // DNS 캐시 TTL (기본값: 5m)
    select: 'first',  // 'first', 'random', 'roundRobin'
    policy: 'preferIPv4',  // 'preferIPv4', 'preferIPv6', 'onlyIPv4', 'onlyIPv6', 'any'
  },
};

2. Kubernetes에서: CoreDNS 캐시 설정 확인
3. /etc/hosts에 직접 IP 지정 (극단적 케이스)
```

---

## 16.3 Connection Reuse

```
증상: http_req_connecting이 0이 아닌 값이 자주 나타남
원인: HTTP keep-alive가 비활성화되었거나, 연결 풀이 포화됨

확인:
  http_req_connecting > 0인 요청 비율 확인
  정상: 첫 요청만 connecting > 0, 이후는 0 (keep-alive)
  비정상: 대부분의 요청에서 connecting > 0

해결:
export const options = {
  // 연결 풀 설정은 k6가 자동 관리한다
  // 서버 측에서 keep-alive를 비활성화하지 않았는지 확인:
  // nginx: keepalive_timeout 65;
  // Apache: KeepAlive On
};

// 강제로 연결을 닫고 싶을 때 (매 요청마다 새 연결):
http.get(url, {
  headers: { 'Connection': 'close' },
});
```

---

## 16.4 High CPU on k6

```
증상: k6 프로세스의 CPU 사용률이 100%에 도달하여 정확한 측정이 불가능
확인 방법:
  - 로컬: top, htop
  - Kubernetes: kubectl top pods (k6 Pod)

원인과 해결:

1. VU가 너무 많음
   → VU 수를 줄이거나 분산 실행

2. sleep이 없거나 너무 짧음
   → sleep(0.1) 이상 추가

3. 응답 body 파싱이 무거움
   → res.json() 호출 최소화
   → responseType: 'none'으로 body 무시

4. 복잡한 JavaScript 연산
   → 무거운 로직은 init code로 이동
   → 정규식, JSON 파싱 최소화

5. Custom metric 과다
   → 불필요한 metric 제거
   → 태그 카디널리티 줄이기
```

---

## 16.5 Memory Leaks in Scripts

k6 스크립트에서 메모리 누수가 발생할 수 있는 패턴:

```javascript
// 나쁜 예: 전역 배열에 데이터 누적
const allResponses = [];  // ← 이 배열이 무한히 커진다!

export default function () {
  const res = http.get('http://nginx-web.demo.svc.cluster.local');
  allResponses.push(res.body);  // ← iteration마다 누적
}

// 좋은 예: 필요한 데이터만 유지
export default function () {
  const res = http.get('http://nginx-web.demo.svc.cluster.local');
  // 응답을 변수에 저장하되, iteration이 끝나면 GC 대상이 된다
  const status = res.status;
  check(res, { 'OK': (r) => r.status === 200 });
}
```

```javascript
// 나쁜 예: 동적 태그로 인한 metric explosion
export default function () {
  http.get(`http://api.example.com/users/${Math.random()}`, {
    tags: { userId: `user-${Math.random()}` },  // ← 무한한 태그 조합!
  });
}
// → 각 고유 태그 조합마다 별도의 time series가 생성되어 메모리 폭발

// 좋은 예: 태그 카디널리티 제한
export default function () {
  const userId = Math.floor(Math.random() * 1000);
  http.get(`http://api.example.com/users/${userId}`, {
    tags: { name: 'GetUser' },  // ← 고정된 태그
  });
}
```

---

## 16.6 흔한 에러와 해결

| 에러 메시지 | 원인 | 해결 |
|------------|------|------|
| `WARN[0001] Request Failed error="dial: connection refused"` | 대상 서버가 응답하지 않음 | 서버 상태, 포트, 네트워크 확인 |
| `WARN[0001] Request Failed error="context deadline exceeded"` | 요청 타임아웃 | timeout 값 증가 또는 서버 성능 확인 |
| `dropped_iterations` 발생 | arrival-rate executor에서 VU 부족 | maxVUs 증가 또는 preAllocatedVUs 증가 |
| `ERRO[0000] GoError: open: file does not exist` | open()에 지정한 파일 경로 오류 | 파일 경로 확인 (상대 경로는 스크립트 위치 기준) |
| k6 프로세스 OOM Kill | 메모리 부족 | SharedArray 사용, VU 수 감소, memory limit 증가 |
| `too many open files` | 파일 디스크립터 부족 | `ulimit -n 65536` |
| `cannot allocate memory` | 시스템 메모리 부족 | VU 수 감소 또는 분산 실행 |

---

# Part 17: 실전 시나리오

---

## 17.1 API Load Test — tart-infra 프로젝트

프로젝트의 nginx-web과 httpbin 서비스에 대한 종합적인 부하 테스트:

```javascript
// api-load-test.js — tart-infra dev 클러스터용
import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

// Custom Metrics
const nginxLatency = new Trend('nginx_latency', true);
const httpbinLatency = new Trend('httpbin_latency', true);
const errorRate = new Rate('custom_error_rate');
const totalRequests = new Counter('custom_total_requests');

export const options = {
  scenarios: {
    // 일반 트래픽 (읽기 중심)
    normal_traffic: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m', target: 50 },    // ramp up
        { duration: '3m', target: 50 },    // steady
        { duration: '1m', target: 100 },   // increase
        { duration: '3m', target: 100 },   // steady
        { duration: '2m', target: 0 },     // ramp down
      ],
      exec: 'normalTraffic',
    },
    // 헬스체크 (저빈도)
    health_check: {
      executor: 'constant-arrival-rate',
      rate: 1,
      timeUnit: '5s',   // 5초당 1회
      duration: '10m',
      preAllocatedVUs: 2,
      maxVUs: 5,
      exec: 'healthCheck',
    },
  },
  thresholds: {
    'nginx_latency': ['p(95)<200', 'avg<100'],
    'httpbin_latency': ['p(95)<500', 'avg<200'],
    'custom_error_rate': ['rate<0.05'],
    'http_req_failed': ['rate<0.05'],
    'checks': ['rate>0.95'],
  },
};

export function normalTraffic() {
  group('Nginx Web', function () {
    const res = http.get('http://nginx-web.demo.svc.cluster.local', {
      tags: { name: 'nginx-homepage' },
    });
    check(res, {
      'nginx: status 200': (r) => r.status === 200,
      'nginx: body not empty': (r) => r.body.length > 0,
    });
    nginxLatency.add(res.timings.duration);
    errorRate.add(res.status !== 200);
    totalRequests.add(1);
  });

  group('Httpbin API', function () {
    const res = http.get('http://httpbin.demo.svc.cluster.local/get', {
      tags: { name: 'httpbin-get' },
    });
    check(res, {
      'httpbin: status 200': (r) => r.status === 200,
      'httpbin: valid JSON': (r) => {
        try { r.json(); return true; } catch (e) { return false; }
      },
    });
    httpbinLatency.add(res.timings.duration);
    errorRate.add(res.status !== 200);
    totalRequests.add(1);
  });

  sleep(Math.random() * 2 + 0.5);  // 0.5~2.5초 랜덤 think time
}

export function healthCheck() {
  const res = http.get('http://nginx-web.demo.svc.cluster.local', {
    tags: { name: 'health-check' },
    timeout: '5s',
  });
  check(res, {
    'health: responsive': (r) => r.status === 200,
    'health: fast': (r) => r.timings.duration < 100,
  });
}
```

### Kubernetes에서 실행

```yaml
# k6-api-load-test.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: k6-api-load-script
  namespace: demo
data:
  api-load-test.js: |
    # 위 스크립트 내용을 여기에 붙여넣는다
---
apiVersion: batch/v1
kind: Job
metadata:
  name: k6-api-load-test
  namespace: demo
spec:
  backoffLimit: 0
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: k6
          image: grafana/k6:latest
          command: ["k6", "run", "/scripts/api-load-test.js"]
          resources:
            requests:
              cpu: "500m"
              memory: "256Mi"
            limits:
              cpu: "1"
              memory: "512Mi"
          volumeMounts:
            - name: scripts
              mountPath: /scripts
      volumes:
        - name: scripts
          configMap:
            name: k6-api-load-script
```

---

## 17.2 Microservice Chain Test

마이크로서비스 아키텍처에서 서비스 간 호출 체인을 테스트하는 시나리오:

```javascript
// microservice-chain-test.js
import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Trend, Counter } from 'k6/metrics';

const e2eLatency = new Trend('e2e_latency', true);
const chainErrors = new Counter('chain_errors');

export const options = {
  scenarios: {
    user_journey: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m', target: 20 },
        { duration: '5m', target: 20 },
        { duration: '1m', target: 0 },
      ],
    },
  },
  thresholds: {
    e2e_latency: ['p(95)<2000'],   // 전체 체인 p95 < 2초
    chain_errors: ['count<10'],
  },
};

export default function () {
  const startTime = Date.now();

  // 서비스 A → 서비스 B → 서비스 C 호출 체인 시뮬레이션
  let success = true;

  group('Step 1: Frontend (nginx)', function () {
    const res = http.get('http://nginx-web.demo.svc.cluster.local', {
      tags: { name: 'step1-frontend' },
    });
    success = success && check(res, {
      'step1: OK': (r) => r.status === 200,
    });
  });

  if (success) {
    group('Step 2: API Gateway (httpbin)', function () {
      const res = http.get('http://httpbin.demo.svc.cluster.local/get', {
        tags: { name: 'step2-api' },
      });
      success = success && check(res, {
        'step2: OK': (r) => r.status === 200,
      });
    });
  }

  if (success) {
    group('Step 3: Backend Processing', function () {
      const payload = JSON.stringify({
        action: 'process',
        data: { userId: __VU, timestamp: Date.now() },
      });
      const res = http.post('http://httpbin.demo.svc.cluster.local/post', payload, {
        headers: { 'Content-Type': 'application/json' },
        tags: { name: 'step3-backend' },
      });
      success = success && check(res, {
        'step3: OK': (r) => r.status === 200,
      });
    });
  }

  const totalDuration = Date.now() - startTime;
  e2eLatency.add(totalDuration);

  if (!success) {
    chainErrors.add(1);
  }

  sleep(1);
}
```

---

