# Day 8: 실전 시나리오와 실습

Database Stress Test, SLO Validation, HPA Scaling Validation 실전 시나리오, Metrics 시스템 상세, 부하 테스트 유형별 상세, 그리고 실습 과제를 다룬다.

---

## 17.3 Database Stress Test (xk6-sql 사용)

```javascript
// db-stress-test.js (xk6-sql extension 필요)
import sql from 'k6/x/sql';
import { check, sleep } from 'k6';
import { Trend, Counter, Rate } from 'k6/metrics';

const queryLatency = new Trend('query_latency', true);
const writeLatency = new Trend('write_latency', true);
const queryErrors = new Counter('query_errors');
const querySuccess = new Rate('query_success_rate');

const db = sql.open('postgres',
  'postgres://user:pass@postgres.demo.svc.cluster.local:5432/testdb?sslmode=disable'
);

export const options = {
  scenarios: {
    // 읽기 워크로드 (80%)
    readers: {
      executor: 'constant-vus',
      vus: 40,
      duration: '5m',
      exec: 'readWorkload',
    },
    // 쓰기 워크로드 (20%)
    writers: {
      executor: 'constant-vus',
      vus: 10,
      duration: '5m',
      exec: 'writeWorkload',
    },
  },
  thresholds: {
    query_latency: ['p(95)<100', 'avg<50'],
    write_latency: ['p(95)<200', 'avg<100'],
    query_success_rate: ['rate>0.99'],
  },
};

export function setup() {
  db.exec(`CREATE TABLE IF NOT EXISTS load_test (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100),
    value INTEGER,
    created_at TIMESTAMP DEFAULT NOW()
  )`);

  // 초기 데이터 삽입
  for (let i = 0; i < 1000; i++) {
    db.exec(`INSERT INTO load_test (name, value) VALUES ($1, $2)`,
      `item-${i}`, Math.floor(Math.random() * 1000));
  }
}

export function readWorkload() {
  const start = Date.now();
  try {
    const rows = sql.query(db,
      `SELECT * FROM load_test WHERE id = $1`,
      Math.floor(Math.random() * 1000) + 1
    );
    queryLatency.add(Date.now() - start);
    querySuccess.add(true);
    check(rows, { 'has data': (r) => r.length > 0 });
  } catch (e) {
    queryLatency.add(Date.now() - start);
    querySuccess.add(false);
    queryErrors.add(1);
  }
  sleep(0.1);
}

export function writeWorkload() {
  const start = Date.now();
  try {
    db.exec(`INSERT INTO load_test (name, value) VALUES ($1, $2)`,
      `item-${__VU}-${__ITER}`, Math.floor(Math.random() * 1000));
    writeLatency.add(Date.now() - start);
    querySuccess.add(true);
  } catch (e) {
    writeLatency.add(Date.now() - start);
    querySuccess.add(false);
    queryErrors.add(1);
  }
  sleep(0.5);
}

export function teardown() {
  db.exec('DROP TABLE IF EXISTS load_test');
  db.close();
}
```

---

## 17.4 SLO Validation Test

SLO(Service Level Objective)를 k6 threshold로 직접 매핑하여 검증하는 테스트:

```javascript
// slo-validation.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// SLO 정의에 맞는 Custom Metrics
const availability = new Rate('slo_availability');     // SLO: 99.9% 가용성
const latencyP50 = new Trend('slo_latency_p50', true);
const latencyP95 = new Trend('slo_latency_p95', true);
const latencyP99 = new Trend('slo_latency_p99', true);

export const options = {
  scenarios: {
    slo_validation: {
      executor: 'constant-arrival-rate',
      rate: 100,                  // 초당 100 요청 (프로덕션 트래픽 시뮬레이션)
      timeUnit: '1s',
      duration: '10m',            // 10분간 검증 (통계적 유의성 확보)
      preAllocatedVUs: 50,
      maxVUs: 200,
    },
  },
  thresholds: {
    // === SLO Thresholds ===
    // SLO 1: 가용성 99.9%
    slo_availability: ['rate>0.999'],

    // SLO 2: 응답 시간 — p50 < 50ms, p95 < 200ms, p99 < 500ms
    slo_latency_p50: ['p(50)<50'],
    slo_latency_p95: ['p(95)<200'],
    slo_latency_p99: ['p(99)<500'],

    // SLO 3: 에러율 < 0.1%
    http_req_failed: ['rate<0.001'],

    // === 운영 Thresholds ===
    // dropped_iterations가 없어야 한다 (부하 생성기 자체 문제 없음)
    dropped_iterations: ['count==0'],
  },
};

export default function () {
  const res = http.get('http://nginx-web.demo.svc.cluster.local', {
    tags: { name: 'slo-target' },
  });

  // SLO 가용성: 200-399 상태 코드를 성공으로 간주
  const isAvailable = res.status >= 200 && res.status < 400;
  availability.add(isAvailable);

  // SLO 레이턴시
  latencyP50.add(res.timings.duration);
  latencyP95.add(res.timings.duration);
  latencyP99.add(res.timings.duration);

  check(res, {
    'SLO: available': () => isAvailable,
    'SLO: fast enough': (r) => r.timings.duration < 500,
  });

  // think time 없음 — arrival rate가 부하를 제어한다
}

// 결과를 JSON으로도 저장하여 SLO 이력 관리
export function handleSummary(data) {
  const sloResult = {
    timestamp: new Date().toISOString(),
    availability: data.metrics.slo_availability?.values?.rate || 0,
    latency_p50: data.metrics.slo_latency_p50?.values?.['p(50)'] || 0,
    latency_p95: data.metrics.slo_latency_p95?.values?.['p(95)'] || 0,
    latency_p99: data.metrics.slo_latency_p99?.values?.['p(99)'] || 0,
    error_rate: data.metrics.http_req_failed?.values?.rate || 0,
    total_requests: data.metrics.http_reqs?.values?.count || 0,
    thresholds_passed: Object.values(data.root_group?.checks || {}).every(c => c.passes > 0),
  };

  return {
    'slo-report.json': JSON.stringify(sloResult, null, 2),
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
  };
}
```

---

## 17.5 HPA Scaling Validation — tart-infra 전용

tart-infra 프로젝트에서 HPA가 부하에 올바르게 반응하는지 검증하는 테스트:

```javascript
// hpa-validation.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Gauge } from 'k6/metrics';

const responseTime = new Trend('hpa_response_time', true);

export const options = {
  scenarios: {
    // Phase 1: 기본 부하 (HPA minReplicas 상태 확인)
    baseline: {
      executor: 'constant-vus',
      vus: 10,
      duration: '2m',
      exec: 'loadTest',
      startTime: '0s',
    },
    // Phase 2: 부하 증가 (HPA 스케일 아웃 트리거)
    scale_up: {
      executor: 'ramping-vus',
      startVUs: 10,
      stages: [
        { duration: '1m', target: 200 },    // 급격한 부하 증가
        { duration: '3m', target: 200 },    // 유지 (스케일 아웃 대기)
      ],
      exec: 'loadTest',
      startTime: '2m',
    },
    // Phase 3: 부하 감소 (HPA 스케일 인 트리거)
    scale_down: {
      executor: 'ramping-vus',
      startVUs: 200,
      stages: [
        { duration: '1m', target: 10 },     // 급격한 부하 감소
        { duration: '5m', target: 10 },     // 유지 (스케일 인 대기)
      ],
      exec: 'loadTest',
      startTime: '6m',
    },
  },
  thresholds: {
    // HPA가 정상 동작하면 스케일 아웃 후 응답 시간이 안정화되어야 한다
    'hpa_response_time{scenario:scale_up}': ['p(95)<1000'],
  },
};

export function loadTest() {
  const res = http.get('http://nginx-web.demo.svc.cluster.local');
  check(res, {
    'status 200': (r) => r.status === 200,
  });
  responseTime.add(res.timings.duration);
  sleep(0.1);
}
```

실행 및 모니터링:

```bash
# 터미널 1: k6 실행
export KUBECONFIG=kubeconfig/dev.yaml

# ConfigMap 생성
kubectl create configmap k6-hpa-script \
  --from-file=hpa-validation.js \
  -n demo --dry-run=client -o yaml | kubectl apply -f -

# Job 실행
kubectl apply -f - <<EOF
apiVersion: batch/v1
kind: Job
metadata:
  name: k6-hpa-validation
  namespace: demo
spec:
  backoffLimit: 0
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: k6
          image: grafana/k6:latest
          command: ["k6", "run", "/scripts/hpa-validation.js"]
          resources:
            requests:
              cpu: "1"
              memory: "512Mi"
            limits:
              cpu: "2"
              memory: "1Gi"
          volumeMounts:
            - name: scripts
              mountPath: /scripts
      volumes:
        - name: scripts
          configMap:
            name: k6-hpa-script
EOF

# 터미널 2: HPA 모니터링
kubectl get hpa -n demo -w

# 터미널 3: Pod 수 변화 관찰
kubectl get pods -n demo -l app=nginx-web -w

# 터미널 4: k6 로그
kubectl logs job/k6-hpa-validation -n demo -f
```

---

# Part 18: Metrics (지표 시스템) 상세

---

## 18.1 Built-in HTTP Metrics

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

### Built-in 일반 Metrics

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

---

## 18.2 Custom Metrics 활용

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

---

## 18.3 Metric Tags와 Tag Filtering

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

# Part 19: 부하 테스트 유형별 상세

---

## 19.1 부하 테스트 유형 요약

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

# Part 20: 실습

---

## 실습 1: k6 설치 및 기본 테스트

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

## 실습 2: 부하 옵션 설정

```bash
# CLI에서 VU와 Duration 지정
k6 run --vus 10 --duration 30s script.js

# 또는 스크립트 내에 옵션 설정 (스크립트 옵션이 CLI보다 우선)
k6 run script.js

# CLI 옵션으로 스크립트 옵션 덮어쓰기 (환경 변수도 가능)
K6_VUS=20 K6_DURATION=1m k6 run script.js
```

## 실습 3: 프로젝트 테스트 실행

```bash
# dev 클러스터에서 k6 부하 테스트 실행
export KUBECONFIG=kubeconfig/dev.yaml

# k6 Job 실행
kubectl apply -f manifests/demo/k6-loadtest.yaml

# Job 로그 확인 (실시간)
kubectl logs -n demo job/k6-loadtest -f

# HPA 관찰 (다른 터미널)
kubectl get hpa -n demo -w

# Pod 수 변화 관찰 (다른 터미널)
kubectl get pods -n demo -l app=nginx-web -w

# 테스트 완료 후 정리
kubectl delete job k6-loadtest -n demo
```

## 실습 4: 결과 분석

```bash
# JSON 형식으로 결과 출력
k6 run --out json=results.json script.js

# CSV 형식으로 결과 출력
k6 run --out csv=results.csv script.js

# Summary + JSON 동시 출력
k6 run --out json=results.json --summary-trend-stats="avg,min,med,max,p(90),p(95),p(99)" script.js
```

## 실습 5: 스트레스 테스트 + HPA 관찰

```bash
# 스트레스 테스트 실행 (CPU/메모리)
export KUBECONFIG=kubeconfig/dev.yaml
kubectl apply -f manifests/demo/stress-test.yaml

# k6 부하 테스트 동시 실행
kubectl apply -f manifests/demo/k6-loadtest.yaml

# 모니터링
kubectl top pods -n demo --sort-by=cpu
kubectl get hpa -n demo -w
kubectl get events -n demo --sort-by=.lastTimestamp | tail -20

# 정리
kubectl delete job stress-cpu stress-memory k6-loadtest -n demo
```

## 실습 6: Custom Metrics 테스트

```bash
# 커스텀 메트릭 스크립트 실행
k6 run - <<'EOF'
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';

const pageLoadTime = new Trend('page_load_time', true);
const successRate = new Rate('page_success_rate');
const totalPages = new Counter('total_pages_loaded');

export const options = {
  vus: 5,
  duration: '30s',
  thresholds: {
    page_load_time: ['p(95)<500'],
    page_success_rate: ['rate>0.99'],
  },
};

export default function () {
  const res = http.get('https://test.k6.io/');
  pageLoadTime.add(res.timings.duration);
  successRate.add(res.status === 200);
  totalPages.add(1);
  check(res, { 'OK': (r) => r.status === 200 });
  sleep(1);
}
EOF
```

---

