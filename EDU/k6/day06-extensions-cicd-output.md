# Day 6: Extensions, CI/CD, Output

xk6 확장 모듈(dashboard, sql, kafka), CI/CD 연동(GitHub Actions, Jenkins, GitLab CI), 그리고 출력 방식(JSON, CSV, InfluxDB, Prometheus, Grafana Cloud, Datadog)을 다룬다.

---

# Part 11: Extensions (xk6)

---

## 11.1 xk6 개요

xk6는 Go 기반 extension을 추가하여 커스텀 k6 바이너리를 빌드하는 도구이다. SQL 데이터베이스, Kafka, Redis 등 다양한 프로토콜과 기능을 확장할 수 있다.

```bash
# xk6 설치
go install go.k6.io/xk6/cmd/xk6@latest

# SQL extension이 포함된 커스텀 k6 빌드
xk6 build --with github.com/grafana/xk6-sql

# Kafka extension이 포함된 커스텀 k6 빌드
xk6 build --with github.com/mostafa/xk6-kafka

# 여러 extension 동시 빌드
xk6 build \
  --with github.com/grafana/xk6-sql \
  --with github.com/mostafa/xk6-kafka \
  --with github.com/grafana/xk6-dashboard
```

k6 Extension Registry(https://grafana.com/docs/k6/latest/extensions/)에서 커뮤니티가 만든 다양한 extension을 확인할 수 있다.

### 주요 Extension 목록

| Extension | 용도 | 설명 |
|-----------|------|------|
| xk6-dashboard | 실시간 대시보드 | 테스트 실행 중 웹 기반 실시간 대시보드 제공 |
| xk6-sql | 데이터베이스 | PostgreSQL, MySQL, SQLite 등 SQL DB 테스트 |
| xk6-kafka | 메시지 큐 | Apache Kafka 프로듀서/컨슈머 테스트 |
| xk6-redis | 캐시 | Redis 명령어 실행 |
| xk6-amqp | 메시지 큐 | RabbitMQ(AMQP) 테스트 |
| xk6-output-prometheus-remote | 모니터링 | Prometheus Remote Write 출력 |
| xk6-disruptor | 카오스 엔지니어링 | Pod/Service 장애 주입 |

---

## 11.2 xk6-dashboard

실시간 웹 대시보드를 제공한다. 테스트 실행 중 브라우저에서 메트릭을 확인할 수 있다.

```bash
# 빌드
xk6 build --with github.com/grafana/xk6-dashboard@latest

# 실행 (대시보드 포트: 5665)
./k6 run --out dashboard script.js

# 커스텀 포트
./k6 run --out dashboard=port=8080 script.js

# 브라우저에서 http://localhost:5665 접속
```

---

## 11.3 xk6-sql

SQL 데이터베이스를 직접 테스트할 수 있다. 연결 풀, 쿼리 성능, 트랜잭션 처리를 부하 테스트한다.

```javascript
import sql from 'k6/x/sql';
import { check } from 'k6';

// PostgreSQL 연결
const db = sql.open('postgres', 'postgres://user:pass@localhost:5432/testdb?sslmode=disable');

export function setup() {
  // 테스트 테이블 생성
  db.exec(`CREATE TABLE IF NOT EXISTS test_items (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100),
    created_at TIMESTAMP DEFAULT NOW()
  )`);
}

export default function () {
  // INSERT
  const insertResult = db.exec(
    `INSERT INTO test_items (name) VALUES ($1)`,
    `item-${__VU}-${__ITER}`
  );
  check(insertResult, {
    'insert successful': (r) => r !== null,
  });

  // SELECT
  const rows = sql.query(db,
    `SELECT id, name FROM test_items ORDER BY id DESC LIMIT 10`
  );
  check(rows, {
    'has rows': (r) => r.length > 0,
  });
}

export function teardown() {
  db.exec('DROP TABLE IF EXISTS test_items');
  db.close();
}
```

---

## 11.4 xk6-kafka

Apache Kafka 프로듀서/컨슈머를 테스트한다:

```javascript
import { Writer, Reader, Connection } from 'k6/x/kafka';
import { check } from 'k6';

const writer = new Writer({
  brokers: ['kafka.example.com:9092'],
  topic: 'test-topic',
});

const reader = new Reader({
  brokers: ['kafka.example.com:9092'],
  topic: 'test-topic',
  groupID: 'k6-test-group',
});

export default function () {
  // 메시지 프로듀싱
  const messages = [
    {
      key: JSON.stringify({ id: __VU }),
      value: JSON.stringify({
        message: `Hello from VU ${__VU}`,
        timestamp: Date.now(),
      }),
    },
  ];

  const produceError = writer.produce({ messages: messages });
  check(produceError, {
    'produce successful': (err) => err === null,
  });

  // 메시지 컨슈밍
  const consumed = reader.consume({ limit: 10 });
  check(consumed, {
    'consumed messages': (msgs) => msgs.length > 0,
  });
}

export function teardown() {
  writer.close();
  reader.close();
}
```

---

# Part 12: CI/CD Integration

---

## 12.1 GitHub Actions

```yaml
# .github/workflows/performance-test.yml
name: Performance Test

on:
  pull_request:
    branches: [main]
  workflow_dispatch:

jobs:
  load-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install k6
        run: |
          sudo gpg -k
          sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
          echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
          sudo apt-get update
          sudo apt-get install k6

      - name: Run smoke test
        run: k6 run --out json=smoke-results.json tests/smoke-test.js

      - name: Run load test
        run: k6 run --out json=load-results.json tests/load-test.js
        # threshold 위반 시 exit code가 non-zero → step 실패 → PR 블록

      - name: Upload results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: k6-results
          path: |
            smoke-results.json
            load-results.json

      - name: Comment PR with results
        if: github.event_name == 'pull_request' && always()
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const results = JSON.parse(fs.readFileSync('load-results.json', 'utf8'));
            // 결과 요약을 PR 코멘트로 게시
            await github.rest.issues.createComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
              body: `## Performance Test Results\n- Status: ${process.exitCode === 0 ? 'PASSED' : 'FAILED'}`
            });
```

### Threshold-based Gate

k6의 threshold는 exit code를 제어한다. CI/CD에서 이를 활용하여 성능 기준을 충족하지 못하면 배포를 차단할 수 있다:

```
Exit Code 0: 모든 threshold 통과 → 배포 허용
Exit Code 99: 하나 이상의 threshold 실패 → 배포 차단
Exit Code 기타: 런타임 에러 → 조사 필요
```

```javascript
// ci-test.js — CI/CD 게이트용
export const options = {
  vus: 50,
  duration: '5m',
  thresholds: {
    // SLA 기준
    http_req_duration: [
      { threshold: 'p(95)<200', abortOnFail: true, delayAbortEval: '30s' },
      { threshold: 'p(99)<500', abortOnFail: true, delayAbortEval: '30s' },
    ],
    http_req_failed: [
      { threshold: 'rate<0.01', abortOnFail: true, delayAbortEval: '10s' },
    ],
    checks: ['rate>0.99'],
  },
};
```

---

## 12.2 Jenkins

```groovy
// Jenkinsfile
pipeline {
    agent any

    stages {
        stage('Install k6') {
            steps {
                sh '''
                    curl -L https://github.com/grafana/k6/releases/download/v0.49.0/k6-v0.49.0-linux-amd64.tar.gz | tar xz
                    mv k6-v0.49.0-linux-amd64/k6 /usr/local/bin/
                '''
            }
        }

        stage('Smoke Test') {
            steps {
                sh 'k6 run tests/smoke-test.js'
            }
        }

        stage('Load Test') {
            steps {
                sh 'k6 run --out json=results.json tests/load-test.js'
            }
            post {
                always {
                    archiveArtifacts artifacts: 'results.json', fingerprint: true
                }
            }
        }
    }

    post {
        failure {
            // threshold 실패 시 알림
            slackSend(
                color: 'danger',
                message: "Performance test FAILED: ${env.BUILD_URL}"
            )
        }
    }
}
```

---

## 12.3 GitLab CI

```yaml
# .gitlab-ci.yml
stages:
  - test
  - performance

smoke-test:
  stage: performance
  image: grafana/k6:latest
  script:
    - k6 run tests/smoke-test.js
  only:
    - merge_requests

load-test:
  stage: performance
  image: grafana/k6:latest
  script:
    - k6 run --out json=/tmp/results.json tests/load-test.js
  artifacts:
    paths:
      - /tmp/results.json
    when: always
  only:
    - main
  allow_failure: false  # threshold 실패 시 파이프라인 차단
```

---

## 12.4 Kubernetes에서의 CI/CD 연동

tart-infra 프로젝트에서는 k6를 Kubernetes Job으로 실행한다:

```bash
# CI/CD 파이프라인에서 k6 테스트 실행
export KUBECONFIG=kubeconfig/dev.yaml

# 이전 Job 정리
kubectl delete job k6-loadtest -n demo --ignore-not-found

# k6 Job 실행
kubectl apply -f manifests/demo/k6-loadtest.yaml

# Job 완료 대기 (exit code로 threshold 결과 확인)
kubectl wait --for=condition=complete job/k6-loadtest -n demo --timeout=300s
EXIT_CODE=$?

# 로그 수집
kubectl logs job/k6-loadtest -n demo > k6-results.log

# exit code에 따라 배포 진행/중단 결정
if [ $EXIT_CODE -ne 0 ]; then
  echo "Performance test FAILED — blocking deployment"
  exit 1
fi
echo "Performance test PASSED — proceeding with deployment"
```

---

# Part 13: Output 심화

---

## 13.1 출력 방식 개요

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

---

## 13.2 Console Summary 결과 읽기

```
          /\      |‾‾| /‾‾/   /‾‾/
     /\  /  \     |  |/  /   /  /
    /  \/    \    |     (   /   ‾‾\
   /          \   |  |\  \ |  (‾)  |
  / __________ \  |__| \__\ \_____/ .io

  execution: local
     script: loadtest.js
     output: -

  scenarios: (100.00%) 1 scenario, 100 max VUs, 1m30s max duration
           * default: 100 looping VUs for 1m0s (gracefulStop: 30s)

running (1m00.0s), 000/100 VUs, 15234 complete and 0 interrupted iterations
default ✓ [======================================] 100 VUs  1m0s

     ✓ nginx status is 200
     ✓ httpbin status is 200

     checks.........................: 100.00% ✓ 30468     ✗ 0
     data_received..................: 45 MB   750 kB/s
     data_sent......................: 2.1 MB  35 kB/s
     http_req_blocked...............: avg=1.2ms  min=1µs    med=3µs    max=150ms  p(90)=5µs    p(95)=8µs
     http_req_connecting............: avg=0.8ms  min=0µs    med=0µs    max=120ms  p(90)=0µs    p(95)=0µs
     http_req_duration..............: avg=12ms   min=1ms    med=8ms    max=250ms  p(90)=25ms   p(95)=40ms
       { expected_response:true }...: avg=12ms   min=1ms    med=8ms    max=250ms  p(90)=25ms   p(95)=40ms
     http_req_failed................: 0.00%  ✓ 0          ✗ 30468
     http_req_receiving.............: avg=0.1ms  min=10µs   med=50µs   max=15ms   p(90)=0.2ms  p(95)=0.3ms
     http_req_sending...............: avg=0.05ms min=5µs    med=20µs   max=10ms   p(90)=0.1ms  p(95)=0.1ms
     http_req_tls_handshaking.......: avg=0µs    min=0µs    med=0µs    max=0µs    p(90)=0µs    p(95)=0µs
     http_req_waiting...............: avg=11.8ms min=0.9ms  med=7.8ms  max=249ms  p(90)=24ms   p(95)=39ms
     http_reqs......................: 30468  507.8/s
     iteration_duration.............: avg=395ms  min=310ms  med=380ms  max=850ms  p(90)=430ms  p(95)=460ms
     iterations.....................: 15234  253.9/s
     vus............................: 100    min=100     max=100
     vus_max........................: 100    min=100     max=100

     ✓ http_req_duration..............: p(95)<1000
     ✓ http_req_failed................: rate<0.1
```

**결과 해석 가이드:**

| 항목 | 값 | 해석 |
|------|---|------|
| `http_req_duration avg=12ms` | 평균 12ms | 매우 빠른 응답 (nginx 정적 페이지) |
| `p(95)=40ms` | 95% 요청이 40ms 이내 | threshold `p(95)<1000` 통과 |
| `http_req_failed: 0.00%` | 에러 없음 | threshold `rate<0.1` 통과 |
| `http_reqs: 30468 507.8/s` | 총 30468건, 507.8 RPS | 초당 약 508개 요청 처리 |
| `iterations: 15234 253.9/s` | 총 15234 iteration, 253.9/s | iteration당 2개 요청 (nginx + httpbin) |
| `http_req_blocked avg=1.2ms` | 연결 대기 평균 1.2ms | 연결 풀이 정상 동작 |
| `http_req_connecting avg=0.8ms` | TCP 연결 0.8ms | keep-alive로 대부분 재사용 |

---

## 13.3 JSON Output 상세

```bash
# JSON으로 출력
k6 run --out json=results.json script.js

# JSON Lines 형식: 각 줄이 하나의 JSON 객체
# 두 가지 유형의 객체가 출력된다:
# 1. Point: 개별 metric 데이터 포인트
# 2. Metric: metric 정의
```

JSON 출력의 구조:

```json
{"type":"Metric","data":{"name":"http_req_duration","type":"trend","contains":"time","tainted":null,"thresholds":["p(95)<1000"],"submetrics":null,"sub":{"name":"","parent":"","suffix":"","tags":null}},"metric":"http_req_duration"}
{"type":"Point","data":{"time":"2024-01-01T00:00:01.000Z","value":12.345,"tags":{"method":"GET","url":"http://nginx-web.demo.svc.cluster.local/","status":"200","name":"http://nginx-web.demo.svc.cluster.local/","group":"","proto":"HTTP/1.1","scenario":"default","expected_response":"true"}},"metric":"http_req_duration"}
```

### JSON 후처리 (jq)

```bash
# 평균 응답 시간 계산
cat results.json | jq -r 'select(.type=="Point" and .metric=="http_req_duration") | .data.value' | awk '{sum+=$1; count++} END {print "avg:", sum/count, "ms"}'

# URL별 요청 수
cat results.json | jq -r 'select(.type=="Point" and .metric=="http_req_duration") | .data.tags.url' | sort | uniq -c | sort -rn

# 에러 요청만 추출
cat results.json | jq -r 'select(.type=="Point" and .metric=="http_req_duration" and (.data.tags.status | tonumber) >= 400)'

# 시간대별 응답 시간 추이
cat results.json | jq -r 'select(.type=="Point" and .metric=="http_req_duration") | [.data.time, .data.value] | @csv'
```

---

## 13.4 CSV Output

```bash
k6 run --out csv=results.csv script.js
```

CSV 형식:

```csv
metric_name,timestamp,metric_value,check,error,error_code,expected_response,group,method,name,proto,scenario,service,status,subproto,tls_version,url,extra_tags
http_req_duration,1704067201,12.345,,,,true,,GET,http://nginx-web.demo.svc.cluster.local/,HTTP/1.1,default,,200,,,http://nginx-web.demo.svc.cluster.local/,
```

---

## 13.5 InfluxDB Output

```bash
# InfluxDB 1.x
k6 run --out influxdb=http://localhost:8086/k6db script.js

# 인증 포함
K6_INFLUXDB_USERNAME=admin K6_INFLUXDB_PASSWORD=password \
  k6 run --out influxdb=http://localhost:8086/k6db script.js

# InfluxDB 2.x (환경 변수로 설정)
K6_INFLUXDB_ORGANIZATION=myorg \
K6_INFLUXDB_BUCKET=k6 \
K6_INFLUXDB_TOKEN=mytoken \
  k6 run --out influxdb=http://localhost:8086 script.js
```

### InfluxDB + Grafana 대시보드

InfluxDB에 저장된 k6 데이터를 Grafana에서 시각화할 수 있다. Grafana에서 제공하는 k6 전용 대시보드 템플릿(ID: 2587)을 사용하면 즉시 시각화가 가능하다.

---

## 13.6 Prometheus Remote Write

```bash
# Prometheus Remote Write 출력
K6_PROMETHEUS_RW_SERVER_URL=http://prometheus:9090/api/v1/write \
  k6 run --out experimental-prometheus-rw script.js

# 추가 설정
K6_PROMETHEUS_RW_TREND_AS_NATIVE_HISTOGRAM=true \
K6_PROMETHEUS_RW_PUSH_INTERVAL=5s \
  k6 run --out experimental-prometheus-rw script.js
```

### Prometheus에서의 k6 메트릭 쿼리

```promql
# 평균 응답 시간
avg(k6_http_req_duration_seconds)

# p95 응답 시간
histogram_quantile(0.95, sum(rate(k6_http_req_duration_seconds_bucket[1m])) by (le))

# 초당 요청 수
rate(k6_http_reqs_total[1m])

# 에러율
rate(k6_http_req_failed_total[1m]) / rate(k6_http_reqs_total[1m])

# URL별 응답 시간
avg(k6_http_req_duration_seconds) by (name)
```

---

## 13.7 Grafana Cloud k6

```bash
# Grafana Cloud k6 계정 설정
export K6_CLOUD_TOKEN=your-api-token

# 클라우드에 결과 전송 (로컬 실행)
k6 run --out cloud script.js

# 클라우드에서 실행 (분산 실행)
k6 cloud script.js
```

---

## 13.8 Datadog Output

```bash
# Datadog에 메트릭 전송
K6_DATADOG_API_KEY=your-api-key \
K6_STATSD_ADDR=localhost:8125 \
  k6 run --out datadog script.js

# 또는 StatsD 출력 사용
k6 run --out statsd=localhost:8125 script.js
```

---

