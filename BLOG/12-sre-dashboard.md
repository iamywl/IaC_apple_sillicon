# 12. SRE 대시보드 — React + Express 실시간 모니터링

> **시리즈**: Apple Silicon 맥에서 구축하는 멀티 클러스터 Kubernetes 인프라
>
> **난이도**: 입문 — 인프라를 한 번도 다뤄보지 않은 사람도 읽을 수 있다

---

## SRE가 뭔가?

**SRE(Site Reliability Engineering, 사이트 신뢰성 엔지니어링)**는
"서비스가 항상 안정적으로 돌아가게 만드는 엔지니어링 분야"다.

Google에서 시작된 개념으로, 한 문장으로 요약하면:

> "소프트웨어 엔지니어링 방법으로 운영(Ops) 문제를 해결하는 것"

SRE 엔지니어의 핵심 업무는 다음과 같다:
- **장애 대응**: 서비스 장애를 탐지하고 신속히 복구한다
- **모니터링**: 서비스 상태를 실시간으로 관측하여 이상 징후를 조기에 파악한다
- **알림 설정**: 임계치를 초과하면 자동으로 담당자에게 통보한다
- **자동화**: 반복적인 운영 작업을 코드로 자동화하여 인적 오류를 줄인다

서비스를 운영하다 보면 이런 질문이 생긴다:

- "지금 서버 CPU가 몇 % 쓰이고 있지?"
- "파드가 몇 개 돌고 있고, 다 정상인가?"
- "부하 테스트를 하면 서버가 얼마나 버틸까?"
- "트래픽이 어디서 어디로 흐르고 있지?"
- "오토스케일링이 제대로 동작하나?"

CLI에서 `kubectl get pods`를 클러스터마다 반복 실행하면 개별 리소스 상태는 확인할 수 있다. 그러나 4개 클러스터, 10개 노드, 수십 개 Pod의 전체 상태를 **동시에** 파악하는 것은 CLI만으로는 불가능하다. 터미널 출력은 시점 스냅샷이므로 시간에 따른 변화 추이를 볼 수 없고, 여러 리소스 간의 상관관계(CPU 증가 → HPA 반응 → Pod 수 변화)를 한눈에 파악할 수 없다. SRE 대시보드는 이 문제를 해결한다.

이런 질문에 **실시간으로 답을 주는 도구**가 SRE 대시보드다.
우리 프로젝트에서는 이 대시보드를 직접 만들었다.

---

## 대시보드 아키텍처

```
┌────────────────────────────────────────────────┐
│              브라우저 (사용자)                    │
│         React 19 프론트엔드 (:5173)             │
│                                                │
│  ┌─────────┬──────────┬──────────┬───────────┐ │
│  │Overview │ Cluster  │ Testing  │  Traffic  │ │
│  │         │ Detail   │          │           │ │
│  ├─────────┼──────────┼──────────┼───────────┤ │
│  │Scaling  │  Load    │          │           │ │
│  │         │ Analysis │          │           │ │
│  └─────────┴──────────┴──────────┴───────────┘ │
└───────────────────┬────────────────────────────┘
                    │ HTTP API 호출
                    ▼
┌────────────────────────────────────────────────┐
│         Express 5 백엔드 (:3001)                │
│                                                │
│  ┌───────────────────────────────────────────┐ │
│  │          Background Collectors             │ │
│  │  Main(5s) Scaling(5s) Traffic(10s)        │ │
│  │                    Services(30s)           │ │
│  └───────────────┬───────────────────────────┘ │
│                  │                              │
│  ┌───────────────▼───────────────────────────┐ │
│  │         SSH Connection Pool                │ │
│  │    (ssh2 npm — 10개 VM 연결 유지)           │ │
│  └───────────────┬───────────────────────────┘ │
└──────────────────┼─────────────────────────────┘
                   │ SSH + kubectl
    ┌──────────────┼──────────────────┐
    ▼              ▼                  ▼
┌────────┐  ┌──────────┐      ┌──────────┐
│  VM 1  │  │   VM 2   │ ...  │  VM 10   │
│ (tart) │  │  (tart)  │      │  (tart)  │
└────────┘  └──────────┘      └──────────┘
```

크게 세 부분으로 나뉜다:

1. **프론트엔드 (React 19)**: 사용자가 보는 화면, 6개 페이지
2. **백엔드 (Express 5)**: 데이터를 수집하고 API로 제공
3. **VM들 (tart)**: 실제 쿠버네티스 클러스터가 돌아가는 가상 머신

왜 React + Express 조합인가? 프론트엔드와 백엔드를 분리한 이유는 역할이 근본적으로 다르기 때문이다. 프론트엔드는 5초마다 갱신되는 데이터를 차트와 테이블로 렌더링하는 실시간 UI를 담당한다. 백엔드는 10개 VM에 SSH 연결을 유지하면서 kubectl 명령을 실행하고, 텍스트 출력을 파싱하여 구조화된 JSON으로 변환하는 데이터 수집 파이프라인을 담당한다. 이 두 관심사를 하나의 프로세스에 합치면, UI 렌더링 부하가 데이터 수집 주기에 영향을 주거나, SSH 타임아웃이 UI 응답성을 저하시키는 커플링이 발생한다.

---

## 데이터는 어떻게 수집하나?

### 전체 흐름: tart → SSH → kubectl → parse → serve

대시보드가 데이터를 수집하는 과정을 단계별로 살펴보자.

```
1. tart list          → VM 목록과 상태 확인 (running/stopped)
2. tart ip <vm-name>  → 각 VM의 IP 주소 획득
3. SSH 접속            → IP로 VM에 원격 접속
4. 시스템 명령 실행     → top, free, df, ss, /proc/net/dev
5. kubectl 실행        → 파드 목록, HPA 상태, Hubble 트래픽
6. 파서(parser) 처리   → 텍스트 출력을 구조화된 데이터로 변환
7. API로 제공          → 프론트엔드에 JSON 형태로 전달
```

각 VM에서 시스템 명령과 kubectl 명령을 SSH로 실행하여 원시 데이터를 수집하고, 파서가 이를 구조화된 JSON으로 변환한 뒤, Express API를 통해 React 프론트엔드에 전달하는 파이프라인이다.

---

## SSH 커넥션 풀 — 10개 VM과의 연결

VM에서 데이터를 가져오려면 **SSH(Secure Shell)**로 접속해야 한다.
매번 SSH 연결을 새로 만들면 시간이 많이 걸린다 (연결 수립에 0.5~1초).
5초마다 10개 VM에 접속하면 매번 5~10초가 낭비된다.

왜 커넥션 풀이 필요한가? SSH 연결 수립은 TCP 핸드셰이크, 키 교환, 인증의 3단계를 거치며, 각 단계에 네트워크 라운드트립이 발생한다. 이 오버헤드가 연결당 0.5~1초이다. 5초 주기로 10개 VM에서 데이터를 수집해야 하는데, 매번 연결을 새로 맺으면 수집 주기보다 연결 시간이 더 길어져 시스템이 동작할 수 없다.

그래서 **커넥션 풀(Connection Pool)** 패턴을 사용한다.
SSH 연결을 한 번 맺으면 끊지 않고 **계속 열어둔 상태로 재사용**하는 방식이다.

```typescript
// dashboard/server/collectors/ssh.ts

class SshPool {
  private connections = new Map<string, Client>();

  async exec(ip: string, command: string, timeoutMs = 8000): Promise<string> {
    const client = await this.getConnection(ip);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`SSH command timeout on ${ip}: ${command}`));
      }, timeoutMs);

      client.exec(command, (err, stream) => {
        if (err) { clearTimeout(timer); reject(err); return; }
        let stdout = '';
        stream.on('data', (data: Buffer) => { stdout += data.toString(); });
        stream.on('close', () => { clearTimeout(timer); resolve(stdout); });
      });
    });
  }
}
```

핵심 포인트:
- `connections = new Map()` — IP 주소별로 연결을 캐시한다
- `getConnection(ip)` — 기존 연결이 있으면 재사용, 없으면 새로 생성
- `timeoutMs = 8000` — 8초 안에 응답이 없으면 타임아웃 에러
- `keepaliveInterval: 15000` — 15초마다 keepalive 패킷을 보내 연결이 끊기지 않게 한다

| 방식 | 10개 VM, 3개 명령 실행 시 | 연결 수 |
|------|-------------------------|--------|
| 매번 새 연결 | 30번 연결 + 30번 끊기 (15~30초) | 30개 |
| 커넥션 풀 | 최초 10번 연결 후 재사용 (0.5초) | 10개 |

5초마다 수집하는데 연결에만 15초 걸리면 의미가 없다. 커넥션 풀은 이 오버헤드를 제거한다.

---

## 백그라운드 수집 루프

백엔드 서버가 시작하면 4개의 **백그라운드 루프**가 돌기 시작한다.

```typescript
// dashboard/server/collector.ts

const INTERVAL = 5000;          // 메인 수집: 5초
const TRAFFIC_INTERVAL = 10000;  // 트래픽: 10초
const SERVICES_INTERVAL = 30000; // 서비스: 30초
const SCALING_INTERVAL = 5000;   // 스케일링: 5초

export function startCollector() {
  console.log('[collector] starting background collection (5s interval)');
  collect();
  intervalId = setInterval(collect, INTERVAL);

  // 트래픽 수집 (10초 간격)
  setTimeout(() => {
    collectAllTraffic();
    trafficIntervalId = setInterval(collectAllTraffic, TRAFFIC_INTERVAL);
  }, 3000);

  // 서비스 수집 (30초 간격)
  setTimeout(() => {
    collectAllServices();
    servicesIntervalId = setInterval(collectAllServices, SERVICES_INTERVAL);
  }, 5000);

  // 스케일링/HPA 수집 (5초 간격)
  setTimeout(() => {
    collectAllScaling();
    scalingIntervalId = setInterval(collectAllScaling, SCALING_INTERVAL);
  }, 2000);
}
```

### 왜 주기가 다를까?

| 루프 | 주기 | 이유 |
|------|------|------|
| Main (VM 상태, 파드) | 5초 | CPU/메모리는 빠르게 변하므로 자주 확인 |
| Scaling (HPA) | 5초 | 오토스케일링 반응을 실시간 추적해야 하므로 |
| Traffic (Hubble) | 10초 | 네트워크 플로우 수집은 부하가 크므로 덜 자주 |
| Services (서비스 목록) | 30초 | 서비스 구성은 자주 바뀌지 않으므로 |

### setTimeout으로 시작을 분산하는 이유

모든 수집이 동시에 시작하면 서버 시작 시점에 부하가 집중된다.
`setTimeout`으로 2초, 3초, 5초 간격을 두어 **부하를 분산**한다.

---

## 메인 수집 루프가 하는 일

메인 `collect()` 함수가 5초마다 수행하는 작업을 살펴보자.

```typescript
// dashboard/server/collector.ts (collect 함수 요약)

async function collect(): Promise<void> {
  // 1단계: VM 목록 수집 (tart list)
  vms = await collectVmInfo();

  // 2단계: 실행 중인 VM의 리소스 수집 (SSH)
  for (const vm of runningVms) {
    // SSH로 3개 명령 동시 실행
    const [resources, ports, network] = await Promise.allSettled([
      collectVmResources(vm.ip),   // top, free, df
      collectVmPorts(vm.ip),       // ss -tlnp
      collectVmNetwork(vm.name, vm.ip),  // /proc/net/dev
    ]);
  }

  // 3단계: 클러스터 정보 수집 (kubectl)
  clusters = await collectClusterInfo();

  // 4단계: 각 클러스터의 파드 목록 수집
  for (const cluster of clusterConfigs) {
    clusterPods[cluster.name] = await collectPods(cluster.name);
  }
}
```

### 1단계: VM 정보 수집

```typescript
// dashboard/server/collectors/tart.ts

export async function collectVmInfo(): Promise<VmInfo[]> {
  const rawList = await getTartVmList();   // tart list 실행
  // 각 VM에 대해:
  return rawList.map(async (vm) => {
    const ip = vm.status === 'running'
      ? await getTartVmIp(vm.name)   // tart ip <vm-name> 실행
      : null;
    return {
      name: vm.name,
      status: vm.status,
      ip,
      cluster: meta.cluster,
      role: meta.role,     // master 또는 worker
      specs: { cpu, memoryMb, diskGb },
    };
  });
}
```

`tart list`는 Mac 호스트에서 실행하는 명령으로, 가상 머신의 이름, 상태, 디스크 크기를 알려준다.
`tart ip <vm-name>`으로 실행 중인 VM의 IP 주소를 가져온다.

### 2단계: VM 리소스 수집

각 VM에 SSH로 접속해서 시스템 상태를 확인한다.

```typescript
// dashboard/server/collector.ts

async function collectVmResources(ip: string): Promise<VmResources> {
  const [topOut, freeOut, dfOut] = await Promise.all([
    sshPool.exec(ip, 'top -bn1 | head -5'),     // CPU 사용률
    sshPool.exec(ip, 'free -m'),                  // 메모리 사용량
    sshPool.exec(ip, 'df / --output=size,used,avail,pcent | tail -1'),  // 디스크
  ]);

  const cpu = parseCpuUsage(topOut);    // 텍스트 → 숫자로 변환
  const mem = parseMemory(freeOut);
  const disk = parseDisk(dfOut);

  return { cpuPercent: cpu, memoryPercent: mem.percent, ... };
}
```

여기서 `Promise.all`은 **3개 명령을 동시에 실행**한다.
순서대로 하면 3배 느려지기 때문이다.

### 파서(Parser)란?

SSH로 받은 결과는 사람이 읽는 텍스트다:

```
              total        used        free      shared  buff/cache   available
Mem:           2048        1234         456          12         358         814
```

이 텍스트에서 `1234`(사용 중인 메모리)와 `2048`(전체 메모리)을 추출해야 한다.
명령어의 텍스트 출력을 정규식이나 문자열 분할로 파싱하여 구조화된 숫자 데이터로 변환하는 모듈이 **파서(Parser)**다.

프로젝트에는 7개의 파서가 있다:

| 파서 | 역할 | 입력 |
|------|------|------|
| `top.ts` | CPU 사용률 추출 | `top -bn1` 출력 |
| `free.ts` | 메모리 사용량 추출 | `free -m` 출력 |
| `df.ts` | 디스크 사용량 추출 | `df` 출력 |
| `ss.ts` | 열린 포트 목록 추출 | `ss -tlnp` 출력 |
| `netdev.ts` | 네트워크 송수신량 추출 | `/proc/net/dev` 내용 |
| `k6.ts` | 부하 테스트 결과 추출 | k6 출력 |
| `stress-ng.ts` | 스트레스 테스트 결과 추출 | stress-ng 출력 |

---

## 11개 백엔드 API

Express 백엔드가 프론트엔드에 제공하는 REST API 목록이다.

```
GET  /api/health                    → 서버 상태 확인
GET  /api/snapshot                  → 전체 VM/클러스터 스냅샷
GET  /api/traffic/all               → 전체 클러스터 트래픽
GET  /api/traffic?cluster=dev       → 특정 클러스터 트래픽
GET  /api/cluster/:name/services    → 특정 클러스터 서비스 목록
POST /api/tests/run                 → 테스트 실행
GET  /api/tests/status              → 전체 테스트 상태
DELETE /api/tests/:id               → 테스트 삭제
GET  /api/tests/export              → 테스트 결과 CSV 내보내기
GET  /api/scaling                   → 전체 스케일링 히스토리
GET  /api/scaling/:cluster          → 특정 클러스터 스케일링
```

왜 REST API 구조인가? REST는 리소스(resource) 단위로 엔드포인트를 설계하는 방식이다. `/api/traffic`, `/api/scaling`, `/api/tests`처럼 리소스별로 URL을 분리하면, 각 엔드포인트가 독립적으로 동작하므로 하나의 API 장애가 다른 API에 영향을 주지 않는다. 또한 HTTP 표준 메서드(GET/POST/DELETE)로 동작이 명확히 구분되어 프론트엔드와 백엔드 간의 인터페이스 계약이 단순해진다.

프론트엔드는 이 API 엔드포인트를 호출하여 필요한 데이터를 JSON으로 받는다. GET 요청은 데이터 조회, POST는 테스트 실행 같은 액션 트리거, DELETE는 리소스 삭제에 사용된다.

---

## 6개 페이지 상세 설명

### 1. Overview — 클러스터 전체 요약

```
┌─────────────────────────────────────────────┐
│                Overview                      │
│                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │ platform │  │   dev    │  │ staging  │  │
│  │ 3 nodes  │  │ 3 nodes  │  │ 2 nodes  │  │
│  │ 15 pods  │  │ 22 pods  │  │ 18 pods  │  │
│  │ CPU: 45% │  │ CPU: 62% │  │ CPU: 38% │  │
│  │ MEM: 71% │  │ MEM: 58% │  │ MEM: 65% │  │
│  └──────────┘  └──────────┘  └──────────┘  │
│                                              │
│  ┌──────────┐                                │
│  │   prod   │                                │
│  │ 2 nodes  │                                │
│  │ 20 pods  │                                │
│  │ CPU: 55% │                                │
│  │ MEM: 73% │                                │
│  └──────────┘                                │
└─────────────────────────────────────────────┘
```

각 클러스터를 **카드 형태**로 보여준다.
한 눈에 4개 클러스터(platform, dev, staging, prod)의 상태를 파악할 수 있다.

카드에 표시되는 정보:
- 노드 수와 Ready 상태
- 파드 수와 상태별 분류 (Running, Pending, Failed)
- VM 평균 CPU, 메모리 사용률

클러스터 카드를 클릭하면 **Cluster Detail** 페이지로 이동한다.

---

### 2. Cluster Detail — 노드/파드 상세 정보

특정 클러스터를 선택하면 해당 클러스터의 **상세 정보**를 볼 수 있다.

- **노드 목록**: 각 노드(VM)의 CPU, 메모리, 디스크 사용률, 네트워크 트래픽
- **파드 목록**: 네임스페이스별 파드 상태, 재시작 횟수, 리소스 사용량
- **열린 포트**: 각 VM에서 열려 있는 포트와 해당 프로세스

터미널에서 `kubectl get pods`로 일일이 확인하는 대신, 대시보드에서 모든 클러스터의 노드·파드 상태를 한 화면에서 확인할 수 있다.

---

### 3. Testing — 16개 사전 정의 시나리오

대시보드에서 **버튼 한 번**으로 다양한 테스트를 실행할 수 있다.

사전 정의된 시나리오 예시:

| 시나리오 | 설명 | 유형 |
|---------|------|------|
| Light Load | 10 VUs, 15s — 기본 성능 확인 | 부하 테스트 |
| Standard Load | 50 VUs, 30s — 일반 트래픽 시뮬레이션 | 부하 테스트 |
| Heavy Load | 200 VUs, 60s — 최대 부하 스트레스 | 부하 테스트 |
| Ramp-up Test | 0에서 100 VUs까지 점진적 증가 | 부하 테스트 |
| Strict SLA | p95 500ms 이하, 에러율 1% 미만 | SLA 검증 |
| Scale Test - Light | 30 VUs + 60s 쿨다운 | 스케일링 테스트 |
| Scale Test - Heavy | 200 VUs + 60s 쿨다운 | 스케일링 테스트 |
| CPU Stress | CPU 부하 발생 | 스트레스 테스트 |
| Memory Stress | 메모리 부하 발생 | 스트레스 테스트 |

**VU(Virtual User)**는 "가상 사용자"다.
"50 VUs, 30s"는 "50명의 가상 사용자가 30초 동안 동시에 요청을 보내는 것"을 의미한다.

### 테스트 실행 과정

```
1. 사용자가 시나리오 선택 → "Standard Load" 클릭
2. 프론트엔드 → POST /api/tests/run { type: "load", cluster: "dev" }
3. 백엔드가 k6 Job YAML 생성
4. kubectl apply -f - 로 쿠버네티스에 Job 생성
5. k6 파드가 클러스터 내부에서 부하 발생
6. 백엔드가 2초마다 Job 상태 폴링
7. 완료되면 kubectl logs로 결과 수집
8. k6 파서가 결과 텍스트를 구조화된 데이터로 변환
9. 프론트엔드에 결과 표시 (p95 지연시간, 에러율, RPS 등)
```

---

### 4. Traffic — Hubble 네트워크 토폴로지

**Hubble**은 Cilium(이전 편에서 배운 CNI)이 제공하는 네트워크 관측(Observability) 도구다.

이 페이지는 파드 간 트래픽 흐름을 시각적으로 보여준다.

```
demo/nginx-web ──(TCP/HTTP, 150건)──► demo/httpbin
demo/httpbin ──(TCP, 45건)──► demo/redis
demo/httpbin ──(TCP, 23건)──► demo/postgres
demo/keycloak ──(TCP, 12건)──► demo/postgres
kube-system/coredns ◄──(UDP/DNS, 200건)── 모든 파드
```

대시보드가 Hubble 데이터를 수집하는 방법:

```typescript
// dashboard/server/collectors/hubble.ts

export async function collectTrafficFlows(cluster: string) {
  // 1. cilium 에이전트 파드 찾기
  const podName = await kubectl(
    'get pods -n kube-system -l k8s-app=cilium -o jsonpath={.items[0].metadata.name}'
  );

  // 2. Hubble CLI로 최근 200개 플로우 가져오기
  const stdout = await kubectl(
    `exec -n kube-system ${podName} -- hubble observe --output json --last 200`
  );

  // 3. JSON 파싱 → 소스/목적지 추출 → 집계
  const flows = parseHubbleFlows(stdout);
  const aggregated = aggregateFlows(flows);
}
```

네트워크 정책을 설정한 후 "정말로 차단되고 있는가?"를 이 페이지에서 확인할 수 있다.
- `FORWARDED` = 정상적으로 전달된 트래픽
- `DROPPED` = 네트워크 정책에 의해 차단된 트래픽

차단된 트래픽이 보이면 네트워크 정책이 제대로 동작하고 있다는 증거다.
반대로, 차단되어야 할 트래픽이 `FORWARDED`로 보이면 정책에 구멍이 있다는 뜻이다.

---

### 5. Scaling — HPA 실시간 모니터링

**HPA(Horizontal Pod Autoscaler)**가 파드 수를 자동으로 조절하는 과정을
**실시간 차트**로 보여준다.

```
부하 테스트 시작
    │
    ▼
Replicas: 2 ──── 3 ──── 5 ──── 7 ──── 5 ──── 3 ──── 2
CPU:     30% ── 65% ── 85% ── 90% ── 60% ── 35% ── 25%
시간:    0s     15s     30s     45s    60s    90s    120s
         ├── 부하 구간 ──┤      ├── 쿨다운 구간 ──┤
```

수집 방식:

```typescript
// dashboard/server/collectors/scaling.ts

export async function collectScaling(cluster: string): Promise<void> {
  const { stdout } = await execaCommand(
    `kubectl --kubeconfig ${kubeconfig} get hpa -A -o json`,
    { timeout: 10000 }
  );

  // 각 HPA에서 추출하는 정보:
  // - 현재 레플리카 수 (currentReplicas)
  // - 목표 레플리카 수 (desiredReplicas)
  // - 최소/최대 레플리카 (minReplicas, maxReplicas)
  // - 현재 CPU 사용률 (currentCpuPercent)
  // - 목표 CPU 사용률 (targetCpuPercent)
}
```

5초마다 수집한 데이터를 **최대 360개 포인트** (약 30분치)까지 저장한다.
이 시계열 데이터를 차트로 그리면 스케일링 과정을 시각적으로 볼 수 있다.

### 스케일링 테스트에서 측정하는 지표

| 지표 | 의미 |
|------|------|
| Scale-up Latency | 부하 시작 후 첫 스케일업까지 걸린 시간 |
| Peak Replicas | 최대 몇 개까지 늘어났는가 |
| Scale-down Started | 부하 종료 후 스케일다운이 시작된 시점 |
| Avg RPS per Pod | 파드당 평균 초당 요청 수 |

---

### 6. Load Analysis — 종합 테스트 분석

실행한 모든 테스트의 결과를 **한 곳에서 비교 분석**한다.

표시되는 지표:
- **p95 Latency**: 요청의 95%가 이 시간 안에 완료됨
- **p99 Latency**: 요청의 99%가 이 시간 안에 완료됨
- **Error Rate**: 전체 요청 중 실패한 비율
- **RPS**: 초당 처리한 요청 수 (Requests Per Second)
- **Total Requests**: 테스트 중 보낸 총 요청 수

CSV 내보내기 기능도 있어서, 테스트 결과를 엑셀이나 Google Sheets에서 분석할 수 있다.

여러 테스트 결과를 비교할 수 있어야 최적화 전후의 성능 차이를 정량적으로 측정할 수 있다.

---

## 실제 프로젝트에서는

### 상용 SRE 도구와의 비교

| 기능 | 우리 대시보드 | Grafana + Prometheus | Datadog |
|------|-------------|---------------------|---------|
| 비용 | 무료 (직접 구축) | 무료 (오픈소스) | 유료 (월 수십만 원~) |
| 설정 난이도 | 낮음 (React+Express) | 중간 (PromQL 학습 필요) | 낮음 (SaaS) |
| 커스터마이징 | 자유로움 | 대시보드 수준 | 제한적 |
| 멀티 클러스터 | 네이티브 지원 | 추가 설정 필요 | 네이티브 지원 |
| 부하 테스트 통합 | 내장 | 별도 도구 필요 | 별도 도구 필요 |

우리 대시보드는 **학습과 데모 목적**으로 직접 만든 것이다.
실제 프로덕션에서는 Prometheus + Grafana (오픈소스) 또는 Datadog (SaaS)를 주로 사용한다.

하지만 직접 만들어봄으로써:
- API 설계를 이해하고
- 데이터 수집 파이프라인을 경험하고
- 프론트엔드-백엔드 통합을 실습할 수 있다

### SSH 기반 수집의 한계

우리 대시보드는 SSH로 `top`, `free` 등의 명령을 실행해 데이터를 수집한다.
이 방식의 장단점:

**장점**:
- 추가 에이전트 설치 불필요 (SSH만 있으면 된다)
- 구현이 단순하다
- 어떤 VM이든 동일한 방식으로 수집 가능하다

**단점**:
- 명령어 출력을 텍스트 파싱해야 한다 (포맷이 바뀌면 파서도 수정해야 한다)
- 수집 주기보다 짧은 순간적인 스파이크를 놓칠 수 있다
- SSH 연결 자체가 리소스를 소모한다

프로덕션에서는 **Prometheus 방식**(각 노드에 에이전트가 메트릭을 수집해 중앙으로 Push/Pull)이 표준이다.

---

## 전체 데이터 흐름 정리

```
[Mac 호스트]
     │
     │  tart list / tart ip
     ▼
[10개 VM]
     │
     │  SSH (ssh2 npm, Connection Pool)
     │  ├── top -bn1        → parsers/top.ts    → CPU %
     │  ├── free -m         → parsers/free.ts   → Memory %
     │  ├── df /            → parsers/df.ts     → Disk %
     │  ├── ss -tlnp        → parsers/ss.ts     → 열린 포트
     │  └── cat /proc/net/dev → parsers/netdev.ts → 네트워크 속도
     │
     │  kubectl (kubeconfig 기반)
     │  ├── get nodes       → 노드 상태
     │  ├── get pods -A     → 파드 목록
     │  ├── get hpa -A      → HPA 상태
     │  └── exec cilium     → Hubble 트래픽 플로우
     │
     ▼
[Express 백엔드 :3001]
     │
     │  4개 수집 루프가 데이터를 snapshot 객체에 저장
     │
     │  11개 REST API
     ▼
[React 프론트엔드 :5173]
     │
     │  6개 페이지로 시각화
     ▼
[사용자 브라우저]
```

---

## 핵심 정리

| 구성요소 | 기술 | 역할 | 참조 경로 |
|---------|------|------|----------|
| 프론트엔드 | React 19 + Vite | 6개 페이지 UI | `dashboard/src/pages/` |
| 백엔드 | Express 5 + TypeScript | 11개 API + 데이터 수집 | `dashboard/server/` |
| SSH 풀 | ssh2 npm | 10개 VM 상시 연결 | `server/collectors/ssh.ts` |
| VM 수집 | tart CLI | VM 목록/IP 확인 | `server/collectors/tart.ts` |
| 트래픽 수집 | Hubble CLI | 네트워크 플로우 관측 | `server/collectors/hubble.ts` |
| 스케일링 수집 | kubectl | HPA 시계열 데이터 | `server/collectors/scaling.ts` |
| 테스트 실행 | k6, stress-ng | 부하/스트레스 테스트 | `server/jobs.ts` |
| 파서 | 7개 TypeScript 모듈 | 텍스트 출력을 데이터로 변환 | `server/parsers/` |

---

## 시리즈를 마치며

10~12편에 걸쳐 서비스 메시(Istio), 데모 앱 아키텍처, SRE 대시보드를 살펴보았다.

이 세 가지가 합쳐지면:
1. **서비스 메시**가 파드 간 트래픽을 안전하고 효율적으로 관리하고
2. **데모 앱**이 현실적인 서비스 아키텍처를 재현하고
3. **SRE 대시보드**가 이 모든 것을 실시간으로 관측한다

Apple Silicon Mac 한 대 위에서 이 모든 것이 돌아간다는 것이
이 프로젝트가 증명하고자 하는 것이다.
