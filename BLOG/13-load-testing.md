# 13편: 부하 테스트 — k6와 stress-ng로 인프라 검증하기

## 이번 글에서 배울 것

지금까지 우리는 VM을 만들고, Kubernetes 클러스터를 구성하고, 모니터링과 오토스케일링까지 설정했습니다. 그런데 한 가지 중요한 질문이 남아 있습니다.

> "이 인프라가 실제로 트래픽을 감당할 수 있는가?"

이번 글에서는 **부하 테스트(Load Testing)**가 무엇인지, 왜 직접 우리 시스템을 "공격"해야 하는지, 그리고 이 프로젝트에서 사용하는 16가지 테스트 시나리오를 하나하나 살펴봅니다.

---

## 부하 테스트란?

### 비유로 이해하기

새로 지은 다리를 생각해 보세요. 다리를 완공한 뒤 바로 차량을 통행시키나요? 아닙니다. 먼저 무거운 트럭을 올려놓고, 다리가 얼마나 버티는지 **의도적으로** 테스트합니다.

부하 테스트도 마찬가지입니다. 우리가 만든 인프라에 **의도적으로 많은 요청을 보내서**, 어느 지점에서 문제가 생기는지 미리 파악하는 겁니다.

### 왜 이게 필요한가?

- **병목 지점 발견**: CPU, 메모리, 네트워크 중 어디가 먼저 한계에 도달하는지 알 수 있습니다
- **오토스케일링 검증**: 11편에서 설정한 HPA가 실제로 Pod를 늘리는지 확인합니다
- **SLA 기준 설정**: "우리 서비스는 p95 응답 시간 500ms 이하를 보장합니다"라고 말하려면, 근거가 필요합니다
- **장애 사전 예방**: 실제 사용자가 몰리기 전에 문제를 발견하고 고칩니다

### 실제 프로젝트에서는

실제 기업에서 부하 테스트는 **배포 전 필수 단계**입니다. Netflix는 "Chaos Monkey"라는 도구로 프로덕션 환경에서 의도적으로 서버를 죽이며, Amazon은 Prime Day 전에 수개월간 부하 테스트를 진행합니다. 우리 프로젝트에서는 이러한 과정을 축소된 규모로 재현합니다.

---

## k6 — HTTP 부하 생성기

### k6가 뭔가요?

k6는 Grafana Labs에서 만든 **HTTP 부하 테스트 도구**입니다. "가상의 사용자 100명이 동시에 웹사이트를 방문한다"를 시뮬레이션할 수 있습니다.

### 비유로 이해하기

식당을 열었다고 합시다. 메뉴판도 만들고, 주방도 준비했습니다. 그런데 실제로 손님 100명이 동시에 오면 주방이 감당할 수 있을까요? k6는 **가짜 손님을 대량으로 보내서** 주방(서버)이 얼마나 빨리 음식(응답)을 내놓는지 측정하는 도구입니다.

### k6 스크립트 기본 구조

이 프로젝트에서 k6 테스트는 Kubernetes Job으로 실행됩니다. `dashboard/server/jobs.ts`에서 자동으로 생성되는 k6 스크립트의 구조를 살펴보겠습니다.

```javascript
// k6 테스트 스크립트 — jobs.ts에서 자동 생성됨
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 50,              // 가상 사용자(Virtual Users) 50명
  duration: '30s',      // 30초 동안 실행
  thresholds: {
    http_req_duration: ['p(95)<2000'],  // 95%의 요청이 2초 이내
    http_req_failed: ['rate<0.5'],      // 에러율 50% 미만
  },
};

export default function () {
  const res = http.get('http://nginx-web.demo.svc.cluster.local');
  check(res, { 'status is 200': (r) => r.status === 200 });
  sleep(0.1);  // 요청 사이에 0.1초 대기
}
```

**핵심 개념 설명:**

- `vus: 50` — 50명의 가상 사용자가 동시에 접속합니다
- `duration: '30s'` — 30초 동안 계속 요청을 보냅니다
- `thresholds` — 테스트 통과/실패 기준입니다
- `sleep(0.1)` — 실제 사용자처럼 요청 사이에 약간의 간격을 둡니다

---

## VU(Virtual User)란?

VU는 "가상 사용자"입니다. VU 1명은 루프를 돌면서 계속 HTTP 요청을 보내는 하나의 시뮬레이션된 사용자입니다.

| VU 수 | 비유 | 부하 수준 |
|-------|------|----------|
| 10 | 조용한 카페 | 가벼움 |
| 50 | 점심시간 식당 | 보통 |
| 200 | 블랙프라이데이 쇼핑몰 | 고부하 |

VU 50이면, 50명의 사용자가 **동시에** 0.1초 간격으로 웹 서버에 요청을 보냅니다. 30초 동안이면 한 VU당 약 300회, 총 약 15,000회의 요청이 발생합니다.

---

## stress-ng — CPU/메모리 스트레스 테스트

### stress-ng가 뭔가요?

k6가 "네트워크 트래픽"으로 서버를 테스트한다면, stress-ng는 **CPU와 메모리를 직접 혹사**시키는 도구입니다.

### 비유로 이해하기

k6가 "손님을 많이 보내서 주방을 바쁘게 만드는 것"이라면, stress-ng는 "주방의 가스레인지를 직접 최대로 켜서 주방이 얼마나 뜨거워지는지 테스트하는 것"입니다.

### stress-ng Job 생성 코드

```yaml
# jobs.ts에서 생성되는 stress-ng Job YAML
apiVersion: batch/v1
kind: Job
metadata:
  name: stress-cpu-abc123
  namespace: demo
spec:
  backoffLimit: 0
  ttlSecondsAfterFinished: 300
  template:
    metadata:
      labels:
        sre-test: "true"
    spec:
      restartPolicy: Never
      containers:
        - name: stress
          image: alexeiled/stress-ng:latest
          args: ["--cpu", "1", "--timeout", "30s", "--metrics-brief"]
          resources:
            requests:
              cpu: 50m
              memory: 32Mi
            limits:
              cpu: "1"
              memory: 256Mi
```

**핵심 인자 설명:**

- `--cpu 1` — CPU 스트레스 워커 1개 (코어 1개를 100% 사용)
- `--vm 1 --vm-bytes 64M` — 메모리 64MB를 할당/해제 반복
- `--timeout 30s` — 30초 후 자동 종료
- `--metrics-brief` — 결과를 bogo ops(가상 연산 횟수)로 출력

---

## Kubernetes Job — 테스트를 실행하는 방법

### 왜 이게 필요한가?

일반적인 Pod는 계속 실행됩니다. 하지만 테스트는 "실행 → 완료 → 결과 수집 → 정리"의 흐름이 필요합니다. Kubernetes의 **Job**이 바로 이런 용도입니다.

### 비유로 이해하기

일반 Pod가 "정규직 직원" (계속 근무)이라면, Job은 "외부 컨설턴트" (프로젝트 끝나면 퇴장)입니다.

### Job의 핵심 설정

```yaml
spec:
  backoffLimit: 0                    # 실패하면 재시도 안 함
  ttlSecondsAfterFinished: 300       # 완료 후 5분 뒤 자동 삭제
  template:
    spec:
      restartPolicy: Never           # 한 번만 실행
```

이 프로젝트에서는 `dashboard/server/jobs.ts`의 `runTest()` 함수가 이 Job YAML을 자동으로 생성하고 `kubectl apply`로 실행합니다.

```typescript
// jobs.ts — 테스트 실행 함수 (핵심 로직)
export async function runTest(type: TestType, cluster: string, ...): Promise<TestRun> {
  const running = getRunningTest();
  if (running) {
    throw new Error(`Test "${running.id}" is still ${running.status}. Wait for it to finish.`);
  }

  const id = `${type}-${Date.now().toString(36)}`;
  const yaml = generateJobYaml(id, type, config, stressConfig);

  await execaCommand(
    `kubectl --kubeconfig ${kubeconfig} apply -f -`,
    { input: yaml, timeout: 15000 }
  );
  // ... 이후 2초 간격으로 Pod 상태를 폴링하여 완료를 감지
}
```

**한 번에 하나의 테스트만 실행됩니다.** 이전 테스트가 완료되어야 다음 테스트를 실행할 수 있습니다.

---

## 16가지 테스트 시나리오 상세 설명

이 프로젝트의 SRE 대시보드에는 16개의 프리셋 테스트 시나리오가 있습니다. 카테고리별로 자세히 살펴보겠습니다.

### 카테고리 1: HTTP 부하 테스트 (6가지)

HTTP 부하 테스트는 k6를 사용해서 웹 서버(nginx)에 HTTP GET 요청을 대량으로 보냅니다.

#### 1. Light Load — 가벼운 부하

```
VUs: 10명  |  시간: 15초  |  대상: nginx
```

"카페에 손님 10명이 15초 동안 방문하는 상황"입니다. 서버가 정상적으로 응답하는지 기본 확인용입니다. 모든 테스트의 시작점으로, 이것이 통과하지 않으면 인프라에 근본적인 문제가 있는 것입니다.

#### 2. Standard Load — 표준 부하

```
VUs: 50명  |  시간: 30초  |  대상: nginx
```

일상적인 트래픽 수준입니다. "점심시간 식당 정도의 붐빔"에 해당합니다. 대부분의 서비스는 이 정도 부하를 문제 없이 처리해야 합니다.

#### 3. Heavy Load — 고부하

```
VUs: 200명  |  시간: 60초  |  대상: nginx
```

"블랙프라이데이 수준"입니다. 서버가 한계에 도달하기 시작하며, HPA가 Pod를 늘리기 시작해야 합니다. p95 지연시간이 급격히 올라가는 것을 관찰할 수 있습니다.

#### 4. Ramp-up Test — 점진적 부하 증가

```
VUs: 0→100명 (10초간 증가) → 100명 유지 (30초) → 0명 (10초간 감소)
```

실제 트래픽은 한 번에 몰리지 않습니다. 아침에 출근하면서 서서히 트래픽이 증가하는 패턴을 시뮬레이션합니다. k6의 `stages` 기능을 사용합니다.

```javascript
// Ramp-up 테스트의 options 설정
export const options = {
  stages: [
    { duration: '10s', target: 100 },   // 10초에 걸쳐 0→100 VU로 증가
    { duration: '30s', target: 100 },   // 100 VU를 30초 유지
    { duration: '10s', target: 0 },     // 10초에 걸쳐 100→0 VU로 감소
  ],
  thresholds: {
    http_req_duration: ['p(95)<2000'],
    http_req_failed: ['rate<0.5'],
  },
};
```

#### 5. Httpbin API Test — API 서버 테스트

```
VUs: 30명  |  시간: 20초  |  대상: httpbin /get
```

nginx(정적 웹 서버)가 아닌 httpbin(동적 API 서버)을 테스트합니다. API 서버는 요청을 파싱하고 JSON을 생성해야 하므로 nginx보다 느립니다. 대상 URL이 다른 것이 핵심 차이입니다.

```
nginx: http://nginx-web.demo.svc.cluster.local        ← 정적 HTML 반환
httpbin: http://httpbin.demo.svc.cluster.local/get     ← JSON 동적 생성
```

#### 6. Strict SLA Test — 엄격한 SLA 테스트

```
VUs: 50명  |  시간: 30초  |  p95 < 500ms  |  에러율 < 1%
```

다른 테스트의 기본 임계값은 "p95 < 2000ms, 에러율 < 50%"로 느슨합니다. 이 테스트는 **실제 운영 수준의 엄격한 기준**을 적용합니다. 프로덕션 SLA를 충족하는지 확인하는 테스트입니다.

### 카테고리 2: 스케일링 테스트 (3가지)

스케일링 테스트는 HTTP 부하를 보내면서 **HPA가 실제로 Pod를 늘리고 줄이는 과정**을 관찰합니다. 테스트가 끝난 뒤에도 **쿨다운(cooldown) 시간**을 두고 Pod가 다시 줄어드는 것까지 기록합니다.

#### 7. Scale Test — Light

```
VUs: 30명  |  시간: 60초  |  쿨다운: 60초
```

가벼운 부하로 스케일링이 발생하는지 확인합니다. 30 VU 정도면 HPA가 1~2개의 Pod를 추가로 생성할 수 있습니다.

#### 8. Scale Test — Heavy

```
VUs: 200명  |  시간: 120초  |  쿨다운: 60초
```

강한 부하로 최대 스케일링을 유도합니다. nginx의 HPA 최대값은 10이므로, Pod가 3개에서 10개 근처까지 늘어나는 것을 관찰합니다.

#### 9. Scale Test — Ramp

```
VUs: 0→150명 (30초간 증가) → 150명 유지 (60초) → 0명 (30초간 감소)  |  쿨다운: 60초
```

점진적으로 부하를 올려서, HPA가 **단계적으로** Pod를 늘리는 과정을 봅니다.

### 카테고리 3: 캐스케이드 테스트 (3가지)

#### 왜 이게 필요한가?

캐스케이드(Cascade)는 "폭포처럼 연쇄적으로"라는 뜻입니다. 앞선 테스트는 nginx **하나만** 공격했습니다. 하지만 실제 시스템에서는 사용자 요청이 웹 서버 → API 서버 → 데이터베이스로 **연쇄적으로** 전파됩니다.

캐스케이드 테스트는 **nginx와 httpbin을 동시에** 공격해서, 다단계(multi-tier) 부하가 인프라 전체에 어떤 영향을 미치는지 관찰합니다.

```javascript
// cascade 테스트 스크립트 — jobs.ts에서 생성
const URLS = [
  'http://nginx-web.demo.svc.cluster.local',
  'http://httpbin.demo.svc.cluster.local/get'
];

export default function () {
  for (const url of URLS) {                          // 모든 URL에 순차적으로 요청
    const res = http.get(url);
    check(res, { 'status is 200': (r) => r.status === 200 });
  }
  sleep(0.1);
}
```

**핵심 차이**: 일반 테스트는 URL 1개, 캐스케이드는 URL 2개 이상을 **한 VU가 루프 안에서 모두** 요청합니다.

#### 10. Cascade — Light

```
VUs: 30명  |  시간: 60초  |  대상: nginx + httpbin  |  쿨다운: 60초
HPA 관측: nginx, httpbin, redis, postgres (4개 Deployment)
```

#### 11. Cascade — Heavy

```
VUs: 150명  |  시간: 120초  |  대상: nginx + httpbin  |  쿨다운: 90초
```

3-Tier 전체에 강한 부하를 줍니다. nginx와 httpbin의 HPA가 동시에 반응하며, CPU 사용률이 급등합니다.

#### 12. Cascade — Ramp

```
VUs: 0→100명 (20초 증가) → 100명 유지 (60초) → 0명 (20초 감소)  |  쿨다운: 60초
```

점진적 3-Tier 부하로, 시스템이 어떻게 **단계적으로 반응**하는지 관찰합니다.

### 카테고리 4: CPU 스트레스 테스트 (2가지)

#### 13. CPU Stress Light — CPU 가벼운 부하

```
워커: 1개  |  시간: 30초
```

CPU 코어 1개를 30초 동안 100% 사용합니다. 서버의 CPU 여유분을 확인하는 기본 테스트입니다.

#### 14. CPU Stress Heavy — CPU 강한 부하

```
워커: 2개  |  시간: 60초
```

CPU 코어 2개를 60초 동안 100% 사용합니다. Pod의 `limits.cpu: "1"` 설정 때문에 실제로는 1코어 이상 사용하지 못하지만, CPU throttling이 발생하는 것을 관찰할 수 있습니다.

### 카테고리 5: 메모리 스트레스 테스트 (2가지)

#### 15. Memory Stress 64M

```
워커: 1개  |  시간: 30초  |  메모리: 64MB
```

64MB의 메모리를 반복적으로 할당하고 해제합니다. Pod의 메모리 한계(256Mi) 내에서 동작하므로 안전합니다.

#### 16. Memory Stress 128M

```
워커: 2개  |  시간: 60초  |  메모리: 128MB
```

128MB를 할당합니다. Pod 한계에 가까워지면 **OOMKilled**(Out of Memory로 프로세스 강제 종료)가 발생할 수 있습니다. 이것이 바로 **메모리 한계를 알기 위한** 테스트입니다.

---

## 테스트 결과 이해하기

### HTTP 테스트 핵심 지표

테스트가 끝나면 k6가 출력하는 결과에서 다음 지표들을 확인합니다.

| 지표 | 의미 | 좋은 값 | 비유 |
|------|------|---------|------|
| **p95** | 95%의 요청이 이 시간 안에 완료됨 | < 500ms | "손님 100명 중 95명이 5분 안에 음식을 받음" |
| **p99** | 99%의 요청이 이 시간 안에 완료됨 | < 1000ms | "거의 모든 손님이 10분 안에 음식을 받음" |
| **avg** | 평균 응답 시간 | < 200ms | "평균 대기 시간 2분" |
| **RPS** | 초당 처리된 요청 수 | 높을수록 좋음 | "주방이 1분에 요리 50개를 만듦" |
| **에러율** | 실패한 요청의 비율 | < 1% | "주문 100건 중 1건만 실수" |

### 비유: p95 vs p99

학교 시험을 생각해 보세요.

- **p95 = 500ms**: "학생 100명 중 95명이 500ms 이내에 응답을 받았다"
- **p99 = 1000ms**: "학생 100명 중 99명이 1000ms 이내에 응답을 받았다"

p95와 p99의 차이가 크다면, 일부 요청이 비정상적으로 느리다는 뜻입니다. 이런 "꼬리 지연(tail latency)"은 종종 가비지 컬렉션, 네트워크 지연, 디스크 I/O 등의 문제를 나타냅니다.

### CPU/메모리 스트레스 테스트 결과

stress-ng는 **bogo ops** (bogus operations)라는 단위를 사용합니다. "초당 얼마나 많은 가상 연산을 수행했는가"를 나타냅니다.

- bogo ops가 높을수록 성능이 좋음
- 같은 Pod에서 반복 테스트하여 값이 급격히 떨어지면 리소스 경쟁이 있다는 신호

---

## 스케일링 테스트의 특별한 점

### 쿨다운(Cooldown) 기간

스케일링 테스트와 캐스케이드 테스트에는 **쿨다운 기간**이 있습니다. k6 부하가 끝난 뒤에도 일정 시간(60~90초) 동안 계속 관찰합니다.

```
[부하 시작] ────── 부하 구간 ────── [부하 종료] ── 쿨다운 ── [테스트 완료]
                                                    ↑
                                          Pod가 줄어드는 것을 관찰
```

### 왜 이게 필요한가?

HPA는 Pod를 늘리는 것(scale-up)도 중요하지만, 부하가 줄었을 때 Pod를 다시 줄이는 것(scale-down)도 중요합니다. 쿨다운 기간에 다음을 관찰합니다:

- **scaleUpLatency**: 부하 시작 후 첫 번째 Pod가 추가되기까지 걸린 시간
- **peakReplicas**: 최대로 늘어난 Pod 수
- **scaleDownStarted**: 부하 종료 후 Pod가 줄어들기 시작한 시점
- **avgRpsPerPod**: Pod 하나당 처리한 평균 RPS

```typescript
// jobs.ts — 스케일링 메타 데이터 수집
function calculateScalingMeta(
  snapshots: ScalingDataPoint[],
  testStart: number,
  testEnd: number,
  cooldownEnd: number,
  baselineReplicas: Record<string, number>,
  rps: number | null,
  targetDeployments?: string[],
): ScalingTestMeta {
  // 1. scaleUpLatency — 첫 번째 레플리카 증가 시점
  for (const point of snapshots) {
    if (point.timestamp < testStart) continue;
    for (const hpa of filterHpas(point.hpas)) {
      if (hpa.currentReplicas > baseline) {
        scaleUpLatency = point.timestamp - testStart;
        break;
      }
    }
  }
  // 2. peakReplicas — 최대 레플리카 수
  // 3. scaleDownStarted — 부하 종료 후 감소 시작 시점
  // 4. avgRpsPerPod — Pod당 평균 처리량
}
```

---

## 캐스케이드 테스트의 작동 원리

### 일반 테스트 vs 캐스케이드 테스트

```
일반 테스트:
  VU → nginx만 공격
  결과: nginx만 바빠짐

캐스케이드 테스트:
  VU → nginx + httpbin 동시 공격
  결과: nginx 바빠짐 → httpbin도 바빠짐 → 4개 HPA 모두 반응
```

### 관찰할 수 있는 것

1. **nginx HPA**: Pod 3→10 확장
2. **httpbin HPA**: Pod 2→6 확장
3. **redis HPA**: 간접적 영향으로 확장 가능
4. **postgres HPA**: 간접적 영향으로 확장 가능

캐스케이드 테스트는 "한 서비스의 부하가 다른 서비스로 전파되는 현상"을 관찰하는 것이 핵심입니다.

---

## 네트워크 정책과 테스트

테스트 Pod가 실행되려면 클러스터 내부의 다른 서비스에 접근할 수 있어야 합니다. 하지만 10편에서 설정한 제로 트러스트 네트워크 정책이 모든 트래픽을 기본적으로 차단합니다.

이를 해결하기 위해, 테스트 Job을 생성할 때마다 **CiliumNetworkPolicy**도 함께 적용됩니다.

```yaml
# jobs.ts에서 모든 테스트 Job과 함께 생성되는 정책
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: allow-sre-tests
  namespace: demo
spec:
  endpointSelector:
    matchLabels:
      sre-test: "true"        # 테스트 Pod에만 적용
  ingress:
  - fromEntities:
    - cluster
    - world
  egress:
  - toEntities:
    - cluster
    - world
  - toEndpoints:
    - matchLabels:
        k8s-app: kube-dns      # DNS 조회 허용
    toPorts:
    - ports:
      - port: "53"
        protocol: ANY
```

테스트 Pod에는 `sre-test: "true"` 라벨이 붙고, 이 정책이 해당 Pod에게 클러스터 내부 모든 곳으로의 통신을 허용합니다.

---

## CSV 내보내기 — 결과 분석

### 왜 이게 필요한가?

테스트 결과를 대시보드에서 보는 것도 좋지만, 여러 테스트를 비교하거나 추이를 분석하려면 **스프레드시트(Excel, Google Sheets)** 가 편리합니다.

### CSV 내보내기 구조

```typescript
// jobs.ts — exportTestsCsv()
const headers = [
  'id', 'type', 'scenario', 'cluster', 'status',
  'started_at', 'completed_at', 'duration_sec',
  'vus', 'load_duration', 'target_url',
  'stress_workers', 'stress_timeout', 'stress_vm_bytes',
  'p95_latency_ms', 'p99_latency_ms', 'avg_latency_ms',
  'error_rate', 'rps', 'total_requests',
  'cpu_bogo_ops', 'memory_bogo_ops',
  'scale_up_latency_ms', 'peak_replicas', 'scale_down_started_ms', 'avg_rps_per_pod',
  'error',
];
```

다운로드한 CSV를 열면 이런 형태의 표를 볼 수 있습니다:

```
| id            | type  | p95_latency_ms | rps   | error_rate | peak_replicas |
|---------------|-------|----------------|-------|------------|---------------|
| load-abc123   | load  | 45.2           | 487.3 | 0.00       | -             |
| scaling-def456| scale | 312.5          | 234.1 | 0.02       | 8             |
```

### 실제 프로젝트에서는

실제 기업에서는 이 CSV 데이터를 시계열 데이터베이스(Prometheus, InfluxDB)에 저장하고, Grafana 대시보드로 "지난 30일간 p95 지연시간 추이"같은 차트를 만듭니다. 우리 프로젝트에서는 CSV 내보내기로 이 워크플로우를 간소화합니다.

---

## 테스트 실행 전체 흐름 요약

```
1. 대시보드에서 시나리오 선택 (또는 커스텀 설정)
       ↓
2. POST /api/tests/run → jobs.ts의 runTest() 호출
       ↓
3. generateJobYaml()로 YAML 생성 (ConfigMap + Job)
       ↓
4. kubectl apply → K8s에 Job 생성
       ↓
5. Pod가 생성되어 k6 또는 stress-ng 실행
       ↓
6. 2초 간격으로 Pod 상태 폴링 (startWatching)
       ↓
7. Pod 완료 → kubectl logs로 결과 수집
       ↓
8. parseK6Output() 또는 parseStressNgOutput()으로 파싱
       ↓
9. 결과가 대시보드에 표시 (p95, RPS, 에러율 등)
       ↓
10. (스케일링/캐스케이드) 쿨다운 기간 동안 HPA 변화 기록
       ↓
11. 최종 결과 + 스케일링 메타데이터 저장
```

---

## 한 줄 요약

| 테스트 카테고리 | 도구 | 무엇을 확인하나 |
|---------------|------|----------------|
| HTTP 부하 (6종) | k6 | 웹/API 서버의 응답 속도와 에러율 |
| 스케일링 (3종) | k6 + HPA 관찰 | 오토스케일링이 제대로 작동하는지 |
| 캐스케이드 (3종) | k6 멀티 URL | 다단계 서비스 간 부하 전파 |
| CPU 스트레스 (2종) | stress-ng | CPU 한계와 throttling |
| 메모리 스트레스 (2종) | stress-ng | 메모리 한계와 OOMKilled |

다음 편에서는 이 모든 과정에서 **문제가 생겼을 때 어떻게 해결하는지**, 트러블슈팅에 대해 알아보겠습니다.
