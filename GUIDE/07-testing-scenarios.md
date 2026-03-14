# 재연 가이드 07. 테스트 시나리오

이 장에서는 인프라에서 실행할 수 있는 테스트 시나리오를 설명한다. 부하 테스트, 스트레스 테스트, 네트워크 보안 테스트, 서비스 메시 테스트, 장애 주입 테스트를 다룬다.


## 1. 부하 테스트 (k6)

k6는 Grafana에서 개발한 부하 테스트 도구이다. 클러스터 내에 Job으로 실행되며, 서비스에 HTTP 트래픽을 생성한다.

### 1.1 기본 k6 Job 실행

`manifests/demo/k6-loadtest.yaml`에 사전 정의된 테스트를 실행한다.

```bash
export KUBECONFIG=kubeconfig/dev.yaml

# 이전 Job이 있으면 삭제한다
kubectl delete job k6-loadtest -n demo --ignore-not-found
kubectl delete configmap k6-script -n demo --ignore-not-found

# k6 ConfigMap + Job 생성
kubectl apply -f manifests/demo/k6-loadtest.yaml
```

예상 출력:

```
configmap/k6-script created
job.batch/k6-loadtest created
```

사전 정의된 설정:
- VU(가상 사용자): 100
- 지속 시간: 60초
- 대상: `http://nginx-web.demo.svc.cluster.local` + `http://httpbin.demo.svc.cluster.local/get`
- 임계값: p95 < 1000ms, 에러율 < 10%

### 1.2 실행 상태 확인

```bash
kubectl get job k6-loadtest -n demo
```

예상 출력 (실행 중):

```
NAME          COMPLETIONS   DURATION   AGE
k6-loadtest   0/1           30s        30s
```

예상 출력 (완료):

```
NAME          COMPLETIONS   DURATION   AGE
k6-loadtest   1/1           65s        70s
```

Pod 상태 확인:

```bash
kubectl get pods -n demo -l job-name=k6-loadtest
```

### 1.3 결과 확인

```bash
kubectl logs job/k6-loadtest -n demo
```

예상 출력:

```
          /\      |‾‾| /‾‾/   /‾‾/
     /\  /  \     |  |/  /   /  /
    /  \/    \    |     (   /   ‾‾\
   /          \   |  |\  \ |  (‾)  |
  / __________ \  |__| \__\ \_____/ .io

  execution: local
     script: /scripts/loadtest.js
     output: -

  scenarios: (100.00%) 1 scenario, 100 max VUs, 1m30s max duration (incl. graceful stop):
           * default: 100 looping VUs for 1m0s (gracefulStop: 30s)

running (1m00.0s), 000/100 VUs, 12000 complete and 0 interrupted iterations
default ✓ [======================================] 100 VUs  1m0s

     ✓ nginx status is 200
     ✓ httpbin status is 200

     checks.........................: 100.00% ✓ 24000      ✗ 0
     data_received..................: 15 MB   250 kB/s
     data_sent......................: 2.4 MB  40 kB/s
     http_req_blocked...............: avg=1.2ms  min=0s     med=1µs    max=120ms  p(90)=2µs   p(95)=3µs
     http_req_connecting............: avg=0.8ms  min=0s     med=0s     max=80ms   p(90)=0s    p(95)=0s
     http_req_duration..............: avg=45ms   min=2ms    med=30ms   max=500ms  p(90)=100ms p(95)=150ms
       { expected_response:true }...: avg=45ms   min=2ms    med=30ms   max=500ms  p(90)=100ms p(95)=150ms
     http_req_failed................: 0.00%  ✓ 0           ✗ 24000
     http_req_receiving.............: avg=0.5ms  min=10µs   med=50µs   max=50ms   p(90)=1ms   p(95)=2ms
     http_req_sending...............: avg=0.1ms  min=5µs    med=20µs   max=10ms   p(90)=0.2ms p(95)=0.3ms
     http_req_tls_handshaking.......: avg=0s     min=0s     med=0s     max=0s     p(90)=0s    p(95)=0s
     http_req_waiting...............: avg=44ms   min=1ms    med=29ms   max=490ms  p(90)=98ms  p(95)=148ms
     http_reqs......................: 24000  400/s
     iteration_duration.............: avg=350ms  min=302ms  med=330ms  max=800ms  p(90)=400ms p(95)=450ms
     iterations.....................: 12000  200/s
     vus............................: 100    min=100       max=100
     vus_max........................: 100    min=100       max=100
```

### 1.4 결과 해석

| 메트릭 | 의미 | 정상 기준 |
|---|---|---|
| `http_req_duration` p95 | 95%의 요청이 이 시간 이내에 완료됨 | < 1000ms |
| `http_req_duration` p99 | 99%의 요청이 이 시간 이내에 완료됨 | < 2000ms |
| `http_req_failed` | 실패한 요청의 비율 | < 10% (0.1) |
| `http_reqs` | 초당 처리된 요청 수 (RPS) | 높을수록 좋다 |
| `checks` | 사용자 정의 검증 통과율 | 100%가 목표 |
| `vus` | 동시 가상 사용자 수 | 설정값과 일치해야 한다 |
| `iterations` | 완료된 테스트 반복 횟수 | VU x 시간에 비례 |

임계값(`thresholds`)을 초과하면 k6가 exit code 99로 종료한다. Job의 상태가 `Failed`로 표시된다.

### 1.5 단계별 부하 증가 시나리오

SRE 대시보드에서 Custom Load Test로 ramp-up 시나리오를 실행할 수 있다. 또는 직접 k6 스크립트를 작성한다.

```bash
cat << 'EOF' | kubectl apply -f -
apiVersion: v1
kind: ConfigMap
metadata:
  name: k6-ramp-script
  namespace: demo
data:
  loadtest.js: |
    import http from 'k6/http';
    import { check, sleep } from 'k6';

    export const options = {
      stages: [
        { duration: '30s', target: 20 },
        { duration: '30s', target: 50 },
        { duration: '30s', target: 100 },
        { duration: '30s', target: 200 },
        { duration: '30s', target: 0 },
      ],
      thresholds: {
        http_req_duration: ['p(95)<2000'],
        http_req_failed: ['rate<0.5'],
      },
    };

    export default function () {
      const res = http.get('http://nginx-web.demo.svc.cluster.local');
      check(res, { 'status is 200': (r) => r.status === 200 });
      sleep(0.1);
    }
---
apiVersion: batch/v1
kind: Job
metadata:
  name: k6-ramp-test
  namespace: demo
spec:
  backoffLimit: 0
  ttlSecondsAfterFinished: 300
  template:
    metadata:
      labels:
        sre-test: "true"
      annotations:
        sidecar.istio.io/inject: "false"
    spec:
      restartPolicy: Never
      containers:
        - name: k6
          image: grafana/k6:latest
          command: ["k6", "run", "--summary-trend-stats", "avg,min,med,max,p(90),p(95),p(99)", "/scripts/loadtest.js"]
          resources:
            requests:
              cpu: 100m
              memory: 64Mi
            limits:
              cpu: 500m
              memory: 256Mi
          volumeMounts:
            - name: script
              mountPath: /scripts
      volumes:
        - name: script
          configMap:
            name: k6-ramp-script
EOF
```

이 시나리오는 5단계로 부하를 증가시킨다:
1. 0 → 20 VU (30초): 워밍업
2. 20 → 50 VU (30초): 점진적 증가
3. 50 → 100 VU (30초): 중간 부하
4. 100 → 200 VU (30초): 최대 부하
5. 200 → 0 VU (30초): 쿨다운

실행 중 HPA 반응을 함께 관찰한다:

```bash
kubectl get hpa -n demo -w
```

### 1.6 정리

```bash
kubectl delete job k6-loadtest -n demo --ignore-not-found
kubectl delete job k6-ramp-test -n demo --ignore-not-found
kubectl delete configmap k6-script k6-ramp-script -n demo --ignore-not-found
```


## 2. 스트레스 테스트 (stress-ng)

stress-ng는 시스템 리소스에 의도적으로 부하를 가하는 도구이다. HPA 자동 스케일링 동작을 확인하는 데 사용한다.

### 2.1 CPU 스트레스 적용

`manifests/demo/stress-test.yaml`의 stress-cpu Job을 실행한다.

```bash
export KUBECONFIG=kubeconfig/dev.yaml

kubectl delete job stress-cpu -n demo --ignore-not-found
kubectl apply -f manifests/demo/stress-test.yaml
```

이 명령은 stress-cpu와 stress-memory 두 개의 Job을 모두 생성한다. CPU 스트레스만 실행하려면:

```bash
cat << 'EOF' | kubectl apply -f -
apiVersion: batch/v1
kind: Job
metadata:
  name: stress-cpu-test
  namespace: demo
spec:
  backoffLimit: 0
  ttlSecondsAfterFinished: 300
  template:
    metadata:
      labels:
        sre-test: "true"
      annotations:
        sidecar.istio.io/inject: "false"
    spec:
      restartPolicy: Never
      containers:
        - name: stress
          image: alexeiled/stress-ng:latest
          args: ["--cpu", "2", "--timeout", "60s", "--metrics-brief"]
          resources:
            requests:
              cpu: 100m
              memory: 64Mi
            limits:
              cpu: "2"
              memory: 256Mi
EOF
```

설정 의미:
- `--cpu 2`: 2개의 CPU 워커를 생성한다
- `--timeout 60s`: 60초 동안 실행한다
- `--metrics-brief`: 완료 후 요약 결과를 출력한다

### 2.2 메모리 스트레스 적용

```bash
cat << 'EOF' | kubectl apply -f -
apiVersion: batch/v1
kind: Job
metadata:
  name: stress-memory-test
  namespace: demo
spec:
  backoffLimit: 0
  ttlSecondsAfterFinished: 300
  template:
    metadata:
      labels:
        sre-test: "true"
      annotations:
        sidecar.istio.io/inject: "false"
    spec:
      restartPolicy: Never
      containers:
        - name: stress
          image: alexeiled/stress-ng:latest
          args: ["--vm", "2", "--vm-bytes", "128M", "--timeout", "60s", "--metrics-brief"]
          resources:
            requests:
              cpu: 50m
              memory: 128Mi
            limits:
              cpu: 500m
              memory: 512Mi
EOF
```

설정 의미:
- `--vm 2`: 2개의 메모리 워커를 생성한다
- `--vm-bytes 128M`: 각 워커가 128MB를 할당/해제 반복한다
- `--timeout 60s`: 60초 동안 실행한다

### 2.3 HPA 자동 스케일링 관찰

스트레스 테스트를 실행하면서 별도 터미널에서 HPA를 실시간 모니터링한다.

```bash
export KUBECONFIG=kubeconfig/dev.yaml
kubectl get hpa -n demo -w
```

예상 출력 (스트레스 적용 전):

```
NAME             REFERENCE              TARGETS        MINPODS   MAXPODS   REPLICAS   AGE
nginx-web-hpa    Deployment/nginx-web   20%/50%        3         10        3          2d
httpbin-hpa      Deployment/httpbin     15%/50%        2         8         2          2d
```

예상 출력 (스트레스 적용 후 CPU 사용률 증가):

```
nginx-web-hpa    Deployment/nginx-web   65%/50%        3         10        3          2d
nginx-web-hpa    Deployment/nginx-web   65%/50%        3         10        5          2d
nginx-web-hpa    Deployment/nginx-web   45%/50%        3         10        5          2d
```

nginx-web-hpa는 CPU 평균 사용률이 50%를 초과하면 레플리카를 증가시킨다. `behavior.scaleUp.stabilizationWindowSeconds: 30`이므로 30초 이내에 반응한다. 한 번에 최대 2개 Pod를 추가한다.

스케일다운은 `behavior.scaleDown.stabilizationWindowSeconds: 120`이므로 부하가 감소한 후 120초(2분) 후에 시작된다.

### 2.4 스트레스 결과 확인

```bash
kubectl logs job/stress-cpu-test -n demo
```

예상 출력:

```
stress-ng: info:  [1] dispatching hogs: 2 cpu
stress-ng: info:  [1] successful run completed in 60.00s
stress-ng: info:  [1] stressor       bogo ops real time  usr time  sys time   bogo ops/s   bogo ops/s
stress-ng: info:  [1]                           (secs)    (secs)    (secs)   (real time) (usr+sys time)
stress-ng: info:  [1] cpu              125000     60.00    119.50      0.10      2083.33      1045.85
```

`bogo ops`: 가상 연산 횟수이다. 시스템의 처리 능력을 나타낸다.

### 2.5 정리

```bash
kubectl delete job stress-cpu-test stress-memory-test stress-cpu stress-memory -n demo --ignore-not-found
```


## 3. 네트워크 보안 테스트

Dev 클러스터에는 CiliumNetworkPolicy가 적용되어 있다. `default-deny-all` 정책으로 모든 트래픽을 차단하고, 명시적 허용 정책만 통과시킨다.

### 3.1 적용된 정책 목록

```bash
export KUBECONFIG=kubeconfig/dev.yaml
kubectl get cnp -n demo
```

### 3.2 L3/L4 정책 검증

#### 허용: 외부 → nginx (포트 80)

`allow-external-to-nginx` 정책이 world/cluster 엔티티에서 nginx-web Pod의 포트 80으로의 TCP 트래픽을 허용한다.

```bash
DEV_WORKER1_IP=$(tart ip dev-worker1)
curl -sf -o /dev/null -w "%{http_code}\n" http://$DEV_WORKER1_IP:30080
```

예상 출력:

```
200
```

#### 허용: nginx → redis (포트 6379)

`allow-nginx-to-redis` 정책이 nginx-web에서 redis의 포트 6379으로의 TCP 트래픽을 허용한다.

```bash
kubectl exec -n demo deploy/nginx-web -c nginx -- \
  sh -c 'echo PING | nc -w 3 redis.demo.svc.cluster.local 6379'
```

예상 출력:

```
+PONG
```

#### 차단: redis → httpbin (정책 없음)

redis에서 httpbin으로의 트래픽을 허용하는 정책이 없으므로 차단된다.

```bash
kubectl exec -n demo deploy/redis -- \
  curl -sf --max-time 3 http://httpbin.demo.svc.cluster.local/get 2>&1 || echo "BLOCKED (exit code: $?)"
```

예상 출력:

```
BLOCKED (exit code: 28)
```

exit code 28은 curl의 연결 타임아웃이다.

#### 차단: httpbin → nginx (정책 없음)

```bash
kubectl exec -n demo deploy/httpbin -- \
  curl -sf --max-time 3 http://nginx-web.demo.svc.cluster.local 2>&1 || echo "BLOCKED (exit code: $?)"
```

예상 출력:

```
BLOCKED (exit code: 28)
```

### 3.3 L7 정책 검증

`allow-nginx-to-httpbin` 정책은 nginx에서 httpbin으로 GET 메서드만 허용한다.

#### 허용: GET 요청

```bash
kubectl exec -n demo deploy/nginx-web -c nginx -- \
  curl -sf -o /dev/null -w "%{http_code}\n" \
  http://httpbin.demo.svc.cluster.local/get
```

예상 출력:

```
200
```

#### 차단: POST 요청

```bash
kubectl exec -n demo deploy/nginx-web -c nginx -- \
  curl -sf -o /dev/null -w "%{http_code}\n" --max-time 5 \
  -X POST http://httpbin.demo.svc.cluster.local/post
```

예상 출력:

```
403
```

#### 차단: PUT 요청

```bash
kubectl exec -n demo deploy/nginx-web -c nginx -- \
  curl -sf -o /dev/null -w "%{http_code}\n" --max-time 5 \
  -X PUT http://httpbin.demo.svc.cluster.local/put
```

예상 출력:

```
403
```

#### 차단: DELETE 요청

```bash
kubectl exec -n demo deploy/nginx-web -c nginx -- \
  curl -sf -o /dev/null -w "%{http_code}\n" --max-time 5 \
  -X DELETE http://httpbin.demo.svc.cluster.local/delete
```

예상 출력:

```
403
```

### 3.4 DNS 정책 검증

`default-deny-all` 정책은 kube-dns(포트 53)으로의 egress만 허용한다. DNS 해석이 동작하는지 확인한다.

```bash
kubectl exec -n demo deploy/nginx-web -c nginx -- nslookup httpbin.demo.svc.cluster.local
```

예상 출력:

```
Server:    10.97.0.10
Address:   10.97.0.10#53

Name:   httpbin.demo.svc.cluster.local
Address: 10.97.x.x
```

### 3.5 전체 정책 매트릭스 검증 스크립트

```bash
#!/bin/bash
export KUBECONFIG=kubeconfig/dev.yaml
PASS=0; FAIL=0

check() {
  local desc=$1 expected=$2 actual=$3
  if [ "$actual" = "$expected" ]; then
    echo "  PASS: $desc (got $actual)"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc (expected $expected, got $actual)"
    FAIL=$((FAIL + 1))
  fi
}

echo "=== L3/L4 테스트 ==="

# 외부 → nginx
CODE=$(curl -sf -o /dev/null -w "%{http_code}" --max-time 5 http://$(tart ip dev-worker1):30080)
check "외부→nginx" "200" "$CODE"

# nginx → redis
RESULT=$(kubectl exec -n demo deploy/nginx-web -c nginx -- sh -c 'echo PING | nc -w 3 redis.demo.svc.cluster.local 6379 2>/dev/null' || echo "TIMEOUT")
if echo "$RESULT" | grep -q PONG; then check "nginx→redis" "PONG" "PONG"; else check "nginx→redis" "PONG" "TIMEOUT"; fi

# redis → httpbin (차단)
kubectl exec -n demo deploy/redis -- curl -sf --max-time 3 http://httpbin.demo.svc.cluster.local/get > /dev/null 2>&1
EXIT=$?
check "redis→httpbin(차단)" "28" "$EXIT"

echo ""
echo "=== L7 테스트 ==="

# nginx → httpbin GET (허용)
CODE=$(kubectl exec -n demo deploy/nginx-web -c nginx -- curl -sf -o /dev/null -w "%{http_code}" http://httpbin.demo.svc.cluster.local/get 2>/dev/null)
check "nginx→httpbin GET" "200" "$CODE"

# nginx → httpbin POST (차단)
CODE=$(kubectl exec -n demo deploy/nginx-web -c nginx -- curl -sf -o /dev/null -w "%{http_code}" --max-time 5 -X POST http://httpbin.demo.svc.cluster.local/post 2>/dev/null)
check "nginx→httpbin POST(차단)" "403" "$CODE"

echo ""
echo "=== 결과: $PASS passed, $FAIL failed ==="
```


## 4. 서비스 메시 테스트

Dev 클러스터에는 Istio 서비스 메시가 설치되어 있다. mTLS, 트래픽 라우팅, Circuit Breaker가 설정되어 있다.

### 4.1 mTLS 검증

`manifests/istio/peer-authentication.yaml`에 의해 demo 네임스페이스에 STRICT mTLS가 적용되어 있다.

```bash
export KUBECONFIG=kubeconfig/dev.yaml
kubectl get peerauthentication -n demo
```

예상 출력:

```
NAME               MODE     AGE
demo-strict-mtls   STRICT   2d
```

mTLS가 실제로 동작하는지 확인한다:

```bash
# Istio 사이드카가 주입된 Pod 간 통신 (TLS로 암호화됨)
kubectl exec -n demo deploy/nginx-web -c istio-proxy -- \
  curl -sf http://httpbin.demo.svc.cluster.local/get -o /dev/null -w "%{http_code}\n"
```

예상 출력:

```
200
```

sidecar가 없는 Pod에서 접속 시도 (STRICT 모드이므로 거부):

```bash
# sre-test 레이블이 붙은 Pod는 sidecar.istio.io/inject: "false"이므로 mTLS 없이 접속을 시도한다
# Istio Strict mTLS에 의해 차단될 수 있다
kubectl run mtls-test --image=curlimages/curl -n demo --restart=Never \
  --labels="sre-test=true" \
  --annotations="sidecar.istio.io/inject=false" \
  -- curl -sf --max-time 5 http://httpbin.demo.svc.cluster.local/get

kubectl logs mtls-test -n demo
kubectl delete pod mtls-test -n demo --ignore-not-found
```

STRICT mTLS가 적용된 서비스에 평문 HTTP로 접속하면 연결이 리셋된다.

### 4.2 Canary 배포 트래픽 분배 확인

현재 VirtualService 설정:
- 일반 요청: httpbin v1 80%, v2 20%
- `x-canary: true` 헤더: httpbin v2 100%

#### 가중치 기반 분배 테스트

```bash
export KUBECONFIG=kubeconfig/dev.yaml

# 100회 요청을 보내고 v1/v2 분포를 확인한다
for i in $(seq 1 100); do
  kubectl exec -n demo deploy/nginx-web -c nginx -- \
    curl -sf http://httpbin.demo.svc.cluster.local/headers 2>/dev/null
done | grep -c "v2"
```

약 20회(20%) 정도가 v2에서 응답해야 한다. 정확한 비율은 요청 수가 많을수록 80:20에 수렴한다.

#### 헤더 기반 라우팅 테스트

```bash
# x-canary: true 헤더로 v2로 강제 라우팅
kubectl exec -n demo deploy/nginx-web -c nginx -- \
  curl -sf -H "x-canary: true" http://httpbin.demo.svc.cluster.local/headers
```

응답에서 v2 Pod의 정보가 나와야 한다.

### 4.3 Circuit Breaker 트리거 테스트

`manifests/istio/destination-rule.yaml`에 다음 설정이 있다:

```yaml
trafficPolicy:
  outlierDetection:
    consecutive5xxErrors: 3
    interval: 30s
    baseEjectionTime: 30s
    maxEjectionPercent: 50
  connectionPool:
    tcp:
      maxConnections: 100
```

- `consecutive5xxErrors: 3`: 연속 3회 5xx 에러 시 해당 엔드포인트를 풀에서 제외한다
- `baseEjectionTime: 30s`: 30초 동안 제외한다
- `maxEjectionPercent: 50`: 최대 50%의 엔드포인트를 제외한다
- `maxConnections: 100`: 최대 동시 TCP 연결 수 100개

#### 연결 풀 테스트

```bash
# 동시에 많은 연결을 생성하여 circuit breaker를 트리거한다
kubectl exec -n demo deploy/nginx-web -c nginx -- \
  sh -c 'for i in $(seq 1 150); do curl -sf http://httpbin.demo.svc.cluster.local/get &; done; wait' 2>&1 | \
  grep -c "503"
```

maxConnections(100)을 초과하는 연결에 대해 503 에러가 반환된다.

#### Outlier Detection 확인

Istio proxy의 통계에서 ejection 카운트를 확인한다:

```bash
kubectl exec -n demo deploy/nginx-web -c istio-proxy -- \
  pilot-agent request GET stats | grep outlier_detection
```

`ejections_active`가 0보다 크면 circuit breaker가 동작한 것이다.


## 5. 장애 주입 테스트

### 5.1 Pod 강제 삭제 후 복구 관찰

Kubernetes는 Deployment의 레플리카 수를 유지한다. Pod를 삭제하면 자동으로 재생성한다.

```bash
export KUBECONFIG=kubeconfig/dev.yaml

# 현재 nginx Pod 목록 확인
kubectl get pods -n demo -l app=nginx-web

# Pod 하나를 강제 삭제한다
POD_NAME=$(kubectl get pods -n demo -l app=nginx-web -o jsonpath='{.items[0].metadata.name}')
echo "삭제 대상: $POD_NAME"
kubectl delete pod $POD_NAME -n demo --grace-period=0 --force
```

즉시 다른 터미널에서 복구를 관찰한다:

```bash
kubectl get pods -n demo -l app=nginx-web -w
```

예상 출력:

```
NAME              READY   STATUS        RESTARTS   AGE
nginx-web-abc12   2/2     Terminating   0          1d
nginx-web-def34   2/2     Running       0          1d
nginx-web-ghi56   2/2     Running       0          1d
nginx-web-xyz99   0/2     Pending       0          1s
nginx-web-xyz99   0/2     ContainerCreating   0          2s
nginx-web-xyz99   1/2     Running       0          5s
nginx-web-xyz99   2/2     Running       0          8s
```

새 Pod가 수 초 내에 생성되고 Running 상태가 된다. 서비스 중단 시간은 Pod가 Ready되기까지의 시간이다.

서비스 가용성 확인:

```bash
DEV_WORKER1_IP=$(tart ip dev-worker1)
# Pod 삭제 직후 요청
curl -sf -o /dev/null -w "%{http_code}\n" http://$DEV_WORKER1_IP:30080
```

레플리카가 3개이므로 1개가 삭제되어도 나머지 2개가 트래픽을 처리한다. 서비스 중단 없이 200이 반환되어야 한다.

### 5.2 노드 드레인 후 PDB 동작 확인

PodDisruptionBudget(PDB)은 자발적 중단(voluntary disruption) 시 최소 가용 Pod 수를 보장한다.

nginx-web의 PDB 설정:

```yaml
# manifests/hpa/pdb-nginx.yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: nginx-web-pdb
  namespace: demo
spec:
  minAvailable: 2
  selector:
    matchLabels:
      app: nginx-web
```

`minAvailable: 2`는 최소 2개의 Pod가 항상 가용해야 함을 의미한다.

#### PDB 상태 확인

```bash
export KUBECONFIG=kubeconfig/dev.yaml
kubectl get pdb -n demo
```

예상 출력:

```
NAME             MIN AVAILABLE   MAX UNAVAILABLE   ALLOWED DISRUPTIONS   AGE
nginx-web-pdb    2               N/A               1                     2d
pdb-httpbin      1               N/A               1                     2d
pdb-keycloak     1               N/A               0                     2d
pdb-nginx        2               N/A               1                     2d
pdb-postgres     1               N/A               0                     2d
pdb-rabbitmq     1               N/A               0                     2d
pdb-redis        1               N/A               0                     2d
```

`ALLOWED DISRUPTIONS`가 0이면 현재 더 이상 Pod를 제거할 수 없다는 의미이다.

#### 노드 드레인 테스트

dev-worker1 노드를 드레인하여 PDB 동작을 확인한다.

```bash
# 드레인 전 Pod 배치 확인
kubectl get pods -n demo -o wide -l app=nginx-web

# 드레인 시도 (60초 타임아웃)
kubectl drain dev-worker1 --ignore-daemonsets --delete-emptydir-data --timeout=60s
```

PDB에 의해 minAvailable 조건이 충족되지 않으면 드레인이 대기하거나 거부된다.

```
error when evicting pods/"nginx-web-abc12" -n "demo" (will retry after 5s):
Cannot evict pod as it would violate the pod's disruption budget.
```

드레인 후 복구:

```bash
# 노드를 다시 스케줄링 가능하게 한다
kubectl uncordon dev-worker1
```

```bash
# 노드 상태 확인
kubectl get nodes
```

dev-worker1이 `Ready`로 돌아와야 한다.

### 5.3 네트워크 파티션 시뮬레이션

VM 수준에서 네트워크를 차단하여 노드 간 통신 장애를 시뮬레이션한다.

#### worker 노드의 네트워크 차단

```bash
# dev-worker1의 IP를 확인한다
DEV_WORKER1_IP=$(tart ip dev-worker1)

# SSH로 접속하여 iptables로 다른 노드와의 통신을 차단한다
ssh admin@$DEV_WORKER1_IP "sudo iptables -A INPUT -s $(tart ip dev-master) -j DROP && sudo iptables -A OUTPUT -d $(tart ip dev-master) -j DROP"
```

#### 영향 관찰

별도 터미널에서 노드 상태를 모니터링한다:

```bash
export KUBECONFIG=kubeconfig/dev.yaml
kubectl get nodes -w
```

약 40초 후 (node-monitor-grace-period 기본값) dev-worker1의 상태가 `NotReady`로 변경된다:

```
dev-worker1   NotReady   <none>   2d   v1.31.x
```

5분 후 (pod-eviction-timeout) 해당 노드의 Pod가 다른 노드로 이동하거나 Terminating 상태가 된다.

#### 네트워크 복구

```bash
ssh admin@$DEV_WORKER1_IP "sudo iptables -F"
```

노드가 다시 `Ready` 상태로 돌아온다. evict된 Pod는 자동으로 재스케줄링된다.

### 5.4 다중 Pod 동시 삭제

```bash
export KUBECONFIG=kubeconfig/dev.yaml

# nginx Pod 전체 삭제
kubectl delete pods -n demo -l app=nginx-web --grace-period=0 --force
```

Deployment 컨트롤러가 즉시 새 Pod를 생성한다. HPA의 minReplicas(3)만큼 재생성된다:

```bash
kubectl get pods -n demo -l app=nginx-web -w
```

모든 Pod가 동시에 삭제되므로 짧은 서비스 중단이 발생할 수 있다. 이는 PDB의 `minAvailable: 2` 조건을 위반하는 비자발적 중단(involuntary disruption)이므로 PDB가 보호하지 않는다. PDB는 `kubectl drain`이나 노드 유지보수 등 자발적 중단에만 적용된다.

### 5.5 장애 복구 시간 측정

Pod 삭제부터 서비스 복구까지의 시간을 측정한다:

```bash
export KUBECONFIG=kubeconfig/dev.yaml
DEV_WORKER1_IP=$(tart ip dev-worker1)

# 시작 시간 기록
START=$(date +%s)

# Pod 하나 삭제
POD_NAME=$(kubectl get pods -n demo -l app=nginx-web -o jsonpath='{.items[0].metadata.name}')
kubectl delete pod $POD_NAME -n demo --grace-period=0 --force

# 서비스가 복구될 때까지 반복 확인
while true; do
  CODE=$(curl -sf -o /dev/null -w "%{http_code}" --max-time 2 http://$DEV_WORKER1_IP:30080 2>/dev/null || echo "000")
  NOW=$(date +%s)
  ELAPSED=$((NOW - START))
  echo "${ELAPSED}s: HTTP $CODE"
  if [ "$CODE" = "200" ]; then
    echo "서비스 복구 완료: ${ELAPSED}초"
    break
  fi
  sleep 1
done
```

레플리카가 3개인 경우, 1개가 삭제되어도 나머지 2개가 즉시 트래픽을 처리하므로 복구 시간은 0초에 가까워야 한다.
