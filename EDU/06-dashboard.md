# 06. SRE 대시보드 - 데이터 수집부터 화면 렌더링까지

> **이 문서의 목표**: 대시보드가 어떻게 10대의 VM과 4개 클러스터에서 데이터를 가져와서 화면에 표시하는지, 그 **전체 흐름**을 이해합니다.
>
> **선행 문서**: [01-project-overview.md](01-project-overview.md) (프로젝트 구조), [05-monitoring.md](05-monitoring.md) (Prometheus/Grafana)
>
> **다음 문서**: [07-demo-apps.md](07-demo-apps.md) (데모 앱과 테스트)

---

## 0. `npm run dev` 부터 첫 화면까지: 전체 부팅 시퀀스

`npm run dev`를 치는 순간부터 브라우저에 첫 데이터가 렌더링되기까지, **실제 코드가 실행되는 순서**를 추적합니다.

### 0.1 프로세스 시작 (t=0초)

```
사용자: npm run dev
         │
         ▼
    package.json scripts.dev
    → concurrently "npm run dev:server" "npm run dev:client"
         │
         ├── 프로세스 1: npm run dev:server
         │   → tsx watch server/index.ts
         │
         └── 프로세스 2: npm run dev:client
             → vite (port 3000, /api/* → localhost:3001 프록시)
```

> `concurrently`가 백엔드와 프론트엔드를 **동시에** 별도 프로세스로 실행합니다.

### 0.2 백엔드 부팅 시퀀스 (server/index.ts → collector.ts → collectors/*)

```
tsx watch server/index.ts 실행
         │
         ▼
┌─ server/index.ts ──────────────────────────────────────────────┐
│                                                                 │
│  ① import 단계 (모듈 로딩)                                      │
│     Express, collector, jobs, hubble, services, scaling 임포트    │
│                                                                 │
│  ② Express 앱 생성                                              │
│     const app = express()                                       │
│     app.use(express.json())                                     │
│                                                                 │
│  ③ 11개 API 라우트 등록                                          │
│     GET  /api/health                                            │
│     GET  /api/snapshot                                          │
│     GET  /api/traffic/all                                       │
│     GET  /api/traffic                                           │
│     GET  /api/cluster/:name/services                            │
│     POST /api/tests/run                                         │
│     GET  /api/tests/status                                      │
│     DELETE /api/tests/:id                                       │
│     GET  /api/tests/export                                      │
│     GET  /api/scaling                                           │
│     GET  /api/scaling/:cluster                                  │
│                                                                 │
│  ④ app.listen(3001, callback)                                   │
│     │                                                           │
│     ▼                                                           │
│     "[server] listening on http://localhost:3001"                │
│     │                                                           │
│     ▼                                                           │
│     startCollector()  ← 여기서 데이터 수집이 시작됨               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 0.3 Collector 초기화 시퀀스 (collector.ts → startCollector())

`startCollector()`가 호출되면 **4개의 독립적인 수집 루프**가 시간차를 두고 시작됩니다.

```
startCollector() 호출 (t=0)
│
├── ① 즉시: collect() 최초 실행 + setInterval(collect, 5000) 등록
│   │
│   │  collect() 내부 실행 순서:
│   │  ┌─────────────────────────────────────────────────────┐
│   │  │ 1. collectVmInfo()                                  │
│   │  │    │                                                │
│   │  │    ├── loadConfig()                                 │
│   │  │    │   config/clusters.json 파일을 읽어 파싱         │
│   │  │    │   → 클러스터 4개, 노드 10개 정보 메모리에 캐시   │
│   │  │    │                                                │
│   │  │    ├── getTartVmList()                              │
│   │  │    │   execa('tart list') 실행                      │
│   │  │    │   → 텍스트 출력을 파싱하여 VM 이름+상태 추출     │
│   │  │    │                                                │
│   │  │    └── 각 running VM에 대해 getTartVmIp(name)       │
│   │  │        execa('tart ip <name>') → IP 문자열 반환      │
│   │  │                                                     │
│   │  │ 2. running VM들에 대해 SSH 수집 (Promise.allSettled)│
│   │  │    │                                                │
│   │  │    │  각 VM마다 동시에 3가지 수집:                    │
│   │  │    ├── collectVmResources(ip)                       │
│   │  │    │   SSH 커넥션 풀에서 연결 획득 (최초: 새로 생성)  │
│   │  │    │   ├── sshPool.exec(ip, 'top -bn1 | head -5')  │
│   │  │    │   ├── sshPool.exec(ip, 'free -m')             │
│   │  │    │   └── sshPool.exec(ip, 'df / --output=...')   │
│   │  │    │   각 결과를 Parser로 변환                       │
│   │  │    │                                                │
│   │  │    ├── collectVmPorts(ip)                           │
│   │  │    │   sshPool.exec(ip, 'sudo ss -tlnp')           │
│   │  │    │   → parsePorts()                               │
│   │  │    │                                                │
│   │  │    └── collectVmNetwork(vmName, ip)                 │
│   │  │        sshPool.exec(ip, 'cat /proc/net/dev')       │
│   │  │        → parseNetDev() → 이전 값과 비교 → bytes/sec │
│   │  │                                                     │
│   │  │ 3. collectClusterInfo()                             │
│   │  │    4개 클러스터별 kubectl get nodes -o json          │
│   │  │                                                     │
│   │  │ 4. collectPods() × 4 클러스터                       │
│   │  │    kubectl get pods -A -o json                      │
│   │  │                                                     │
│   │  │ 5. snapshot 변수에 결과 저장                         │
│   │  │    snapshot = { vms, vmResources, vmPorts,          │
│   │  │      vmNetwork, clusters, clusterPods,              │
│   │  │      collectedAt: Date.now(), errors }              │
│   │  └─────────────────────────────────────────────────────┘
│   │
│   └── 이후 5초마다 위 과정 반복
│
├── ② t+2초: collectAllScaling() + setInterval(5초)
│   각 클러스터에 kubectl get hpa -A -o json
│   → ScalingDataPoint 배열에 push (최대 360개 유지)
│
├── ③ t+3초: collectAllTraffic() + setInterval(10초)
│   각 클러스터에 kubectl exec cilium-agent -- hubble observe --output json --last 200
│   → TrafficFlow[] 파싱 + AggregatedEdge[] 집계
│
└── ④ t+5초: collectAllServices() + setInterval(30초)
    각 클러스터에 kubectl get svc,endpoints -A -o json
    → ServiceInfo[] 캐시 갱신
```

> **시간차를 두는 이유**: 모든 수집기가 동시에 시작하면 kubectl/SSH 명령이 한꺼번에 몰려 시스템 부하가 급증합니다. 2~5초 간격으로 분산시켜 안정적으로 시작합니다.

### 0.4 SSH 커넥션 풀 최초 연결 (server/collectors/ssh.ts)

첫 번째 `collect()` 실행 시, SSH 풀에는 연결이 하나도 없습니다. 최초 연결 과정:

```
sshPool.exec("192.168.64.5", "top -bn1 | head -5")
     │
     ▼
  getConnection("192.168.64.5")
     │
     ├── connections Map에 없음 (빈 상태)
     ├── connecting Map에도 없음
     │
     ▼
  connect("192.168.64.5") 시작
     │
     ├── loadConfig() → getSshCredentials()
     │   config/clusters.json에서 ssh_user, ssh_password 읽기
     │
     ├── new ssh2.Client()
     │   { host: "192.168.64.5", port: 22,
     │     username: "admin", password: "admin",
     │     readyTimeout: 10000, keepaliveInterval: 15000 }
     │
     ├── 'ready' 이벤트 → connections Map에 저장
     │
     └── 이후 같은 IP로의 요청은 이 연결 재사용
         (keepaliveInterval: 15초로 연결 유지)
```

### 0.5 프론트엔드 부팅 시퀀스 (main.tsx → App.tsx → usePolling)

```
Vite dev server 시작 (port 3000)
     │
     ▼
브라우저에서 http://localhost:3000 접속
     │
     ▼
┌─ index.html ──→ main.tsx 로드 ─────────────────────────────────┐
│                                                                 │
│  createRoot(document.getElementById('root')!)                   │
│  .render(                                                       │
│    <StrictMode>                                                 │
│      <BrowserRouter>                                            │
│        <App />          ← 여기서 데이터 페칭 시작                │
│      </BrowserRouter>                                           │
│    </StrictMode>                                                │
│  )                                                              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─ App.tsx 마운트 ────────────────────────────────────────────────┐
│                                                                 │
│  ① usePolling<DashboardSnapshot>('/api/snapshot', 5000)         │
│     │                                                           │
│     ├── useState: data=null, error=null, lastUpdated=0          │
│     │                                                           │
│     ├── useEffect 실행 (마운트 시):                              │
│     │   ├── fetchData() 즉시 호출                               │
│     │   │   fetch('/api/snapshot')                              │
│     │   │        │                                              │
│     │   │        ▼ Vite 프록시                                  │
│     │   │   http://localhost:3001/api/snapshot                  │
│     │   │        │                                              │
│     │   │        ▼ Express                                      │
│     │   │   getSnapshot() → snapshot 변수 반환                   │
│     │   │        │                                              │
│     │   │        ▼                                              │
│     │   │   res.json({ data: snapshot, timestamp, stale })      │
│     │   │        │                                              │
│     │   │        ▼ 프론트엔드                                   │
│     │   │   setData(json.data) → data에 DashboardSnapshot 저장  │
│     │   │                                                       │
│     │   └── setInterval(fetchData, 5000) 등록                   │
│     │                                                           │
│  ② 첫 렌더링 (data === null 일 때)                              │
│     └── 로딩 스피너 표시: "Loading dashboard..."                 │
│                                                                 │
│  ③ fetchData 완료 → data에 값이 들어옴 → 리렌더링              │
│     │                                                           │
│     ├── connectionStatus 계산                                   │
│     │   error? → 'down'                                         │
│     │   !data? → 'degraded'                                     │
│     │   errors > 3? → 'degraded'                                │
│     │   else → 'healthy'                                        │
│     │                                                           │
│     ├── networkHistoryRef 업데이트                               │
│     │   각 VM의 rxBytesPerSec, txBytesPerSec를 배열에 push      │
│     │                                                           │
│     └── <Routes> 렌더링                                         │
│         경로 "/"이면 → <OverviewPage data={data} />             │
│         OverviewPage가 data.clusters를 순회하며                  │
│         ClusterCard × 4개를 2×2 그리드로 렌더링                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 0.6 전체 타임라인 요약

```
t=0.0s  npm run dev
        ├── tsx watch server/index.ts 시작
        └── vite 시작

t=0.5s  Express app.listen(3001) 완료
        └── startCollector() 호출

t=0.5s  collect() 최초 실행
        ├── loadConfig(): config/clusters.json 읽기 (1회, 이후 캐시)
        ├── tart list → VM 목록 획득
        ├── tart ip × N → 각 VM의 IP 획득
        ├── SSH 커넥션 풀: 최초 연결 생성 (running VM 수만큼)
        ├── top/free/df/ss/netdev → 각 VM 리소스 수집
        └── kubectl get nodes/pods → 클러스터 상태 수집

t=1.0s  Vite dev server ready (port 3000)

t=2.5s  collectAllScaling() 최초 실행
        └── kubectl get hpa -A

t=3.0s  snapshot 변수에 첫 데이터 저장 완료 ✓

t=3.5s  collectAllTraffic() 최초 실행
        └── hubble observe --last 200

t=5.5s  collectAllServices() 최초 실행
        └── kubectl get svc/endpoints

t=?     사용자가 브라우저에서 localhost:3000 접속
        ├── main.tsx → App.tsx 마운트
        ├── usePolling: fetch('/api/snapshot') 첫 호출
        ├── Vite 프록시 → Express → getSnapshot() 반환
        ├── data=null → 로딩 스피너 표시
        └── data 수신 → OverviewPage 렌더링 (첫 화면 표시) ✓

t=+5s   usePolling: 두 번째 fetch → 데이터 갱신
t=+10s  세 번째 fetch → 이후 5초 간격으로 계속 반복...
```

> **핵심 포인트**: 백엔드의 `collect()`가 완료되기 전에 프론트엔드가 `/api/snapshot`을 호출하면, 초기 빈 snapshot (`{ vms: [], clusters: [], ... }`)이 반환됩니다. 5초 후 다음 폴링에서 실제 데이터가 채워집니다.

---

## 1. 기술 스택 한눈에 보기

### 프론트엔드 vs 백엔드 비교

| 구분 | 프론트엔드 (port 3000) | 백엔드 (port 3001) |
|------|----------------------|-------------------|
| **런타임** | 브라우저 (Vite dev server) | Node.js (tsx) |
| **언어** | TypeScript 5.9 | TypeScript 5.9 |
| **프레임워크** | React 19 | Express 5 |
| **핵심 역할** | 데이터 시각화 + 사용자 인터랙션 | 데이터 수집 + API 제공 |
| **상태 관리** | React useState + useRef | In-Memory 캐시 (변수) |

### 기술 스택 상세

```
┌─ 프론트엔드 ─────────────────────────────────────────────┐
│  React 19          UI 프레임워크                          │
│  Vite 7            빌드 도구 + 개발 서버 + API 프록시      │
│  Tailwind CSS 4    유틸리티 기반 스타일링                   │
│  Recharts 3        차트 라이브러리 (게이지, 라인, 영역)      │
│  react-router-dom 7  클라이언트 사이드 라우팅               │
└──────────────────────────────────────────────────────────┘

┌─ 백엔드 ─────────────────────────────────────────────────┐
│  Express 5         REST API 서버                          │
│  ssh2              SSH 커넥션 풀 (VM 원격 명령 실행)        │
│  execa 9           로컬 셸 명령 실행 (tart, kubectl)       │
│  concurrently      프론트+백엔드 동시 실행 (npm run dev)    │
└──────────────────────────────────────────────────────────┘

┌─ 공유 계층 ──────────────────────────────────────────────┐
│  shared/types.ts   프론트/백엔드 공유 TypeScript 인터페이스  │
│                    → API 계약(contract)이 깨지지 않도록 보장 │
└──────────────────────────────────────────────────────────┘
```

### 왜 이 스택인가?

| 선택 | 이유 |
|------|------|
| **React + TypeScript** | 타입 안전성으로 프론트/백엔드 API 계약 보장. `shared/types.ts` 하나로 양쪽 동기화 |
| **Express (DB 없음)** | 대시보드는 실시간 스냅샷만 보여줌. 히스토리 저장이 불필요하므로 In-Memory 캐시로 충분 |
| **SSH (ssh2)** | VM 내부 메트릭(CPU, 메모리, 디스크)은 Prometheus가 아닌 직접 SSH로 수집. 별도 에이전트 설치 불필요 |
| **Recharts** | D3.js보다 가볍고, React 컴포넌트 형태로 바로 사용 가능 |
| **Vite** | 빌드 속도 + `/api/*` 프록시 설정으로 CORS 문제 없이 개발 |

---

## 2. 전체 아키텍처: 데이터가 화면까지 도달하는 경로

```
┌──────────────────── 데이터 소스 ────────────────────┐
│                                                     │
│  ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌──────┐│
│  │ Tart CLI │  │ SSH (VM) │  │ kubectl  │  │Hubble││
│  │ tart list│  │ top/free │  │ get nodes│  │observe│
│  │ tart ip  │  │ df/ss    │  │ get pods │  │ flows││
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └──┬───┘│
│       │              │             │            │    │
└───────┼──────────────┼─────────────┼────────────┼───┘
        │              │             │            │
        ▼              ▼             ▼            ▼
┌──────────────────── 백엔드 (Express, port 3001) ────────────────────┐
│                                                                      │
│  ┌─ Collectors ──────────────────────────────────────────────────┐  │
│  │  tart.ts → VmInfo[]        (5초 간격)                         │  │
│  │  ssh.ts  → VmResources{}   (5초 간격, 커넥션 풀)               │  │
│  │  kubectl.ts → ClusterInfo[], PodInfo[]  (5초 간격)             │  │
│  │  hubble.ts → TrafficFlow[], AggregatedEdge[]  (10초 간격)      │  │
│  │  scaling.ts → HpaSnapshot[], ScalingDataPoint[]  (5초 간격)    │  │
│  │  services.ts → ServiceInfo[]  (30초 간격)                      │  │
│  └───────────────────────────┬───────────────────────────────────┘  │
│                              │                                      │
│  ┌─ Parsers ────────────────┤──────────────────────────────────┐   │
│  │  top.ts  : "top -bn1"    → cpuPercent                      │   │
│  │  free.ts : "free -m"     → memoryPercent, usedMb, totalMb  │   │
│  │  df.ts   : "df /"        → diskPercent, usedGb, totalGb    │   │
│  │  ss.ts   : "ss -tlnp"   → PortInfo[]                      │   │
│  │  netdev.ts: /proc/net/dev → rxBytes, txBytes               │   │
│  └──────────────────────────┘                                      │
│                              │                                      │
│  ┌─ In-Memory Cache ────────┴──────────────────────────────────┐  │
│  │  snapshot: DashboardSnapshot  (VM + 클러스터 + Pod 전체)      │  │
│  │  trafficCache: Map<cluster, TrafficSummary>                  │  │
│  │  scalingHistory: Map<cluster, ScalingDataPoint[]> (360 포인트)│  │
│  │  servicesCache: Map<cluster, ServiceInfo[]>                  │  │
│  │  tests: Map<id, TestRun>                                     │  │
│  └──────────────────────────┬──────────────────────────────────┘  │
│                              │                                      │
│  ┌─ REST API ───────────────┴──────────────────────────────────┐  │
│  │  GET /api/snapshot       → DashboardSnapshot 전체 반환       │  │
│  │  GET /api/traffic/all    → 전 클러스터 트래픽                 │  │
│  │  GET /api/scaling/:name  → HPA 시계열 히스토리                │  │
│  │  ... (총 11개 엔드포인트)                                    │  │
│  └──────────────────────────┬──────────────────────────────────┘  │
└─────────────────────────────┼──────────────────────────────────────┘
                              │ HTTP (Vite 프록시: /api/* → :3001)
                              ▼
┌──────────────────── 프론트엔드 (React, port 3000) ──────────────────┐
│                                                                      │
│  ┌─ usePolling Hook ────────────────────────────────────────────┐   │
│  │  5초마다 /api/snapshot 호출                                    │   │
│  │  → { data: DashboardSnapshot, error, lastUpdated }            │   │
│  └──────────────────────────┬───────────────────────────────────┘   │
│                              │                                       │
│  ┌─ App.tsx ────────────────┴──────────────────────────────────┐    │
│  │  data를 각 페이지 컴포넌트에 Props로 전달                      │    │
│  │  networkHistory를 useRef로 유지 (최대 60 포인트)               │    │
│  └──────────────────────────┬──────────────────────────────────┘    │
│                              │                                       │
│  ┌─ Pages ──────────────────┴──────────────────────────────────┐   │
│  │  OverviewPage        → ClusterCard (2×2 그리드)              │   │
│  │  ClusterDetailPage   → GaugeChart + SparkLine + PodTable    │   │
│  │  TrafficPage         → SVG 토폴로지 다이어그램                │   │
│  │  ScalingPage         → Recharts AreaChart (시계열)           │   │
│  │  TestingPage         → 시나리오 카드 + 결과 테이블            │   │
│  │  LoadAnalysisPage    → KPI 요약 + 이중 Y축 차트              │   │
│  └─────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 3. 데이터 수집: 어떻게 값을 가져오는가

### 3.1 수집 주기와 데이터 소스

백엔드가 시작되면 `startCollector()` 함수가 호출되고, 4개의 독립적인 수집 루프가 시작됩니다.

> **핵심 코드**: `dashboard/server/collector.ts` → `startCollector()`

```
서버 시작 (listen)
  │
  ├── 즉시 → collect() 실행 + 5초 interval 등록
  │           (VM 상태 + SSH 리소스 + K8s 노드/Pod)
  │
  ├── 2초 후 → collectAllScaling() + 5초 interval
  │             (HPA 상태, 360 포인트 히스토리 유지)
  │
  ├── 3초 후 → collectAllTraffic() + 10초 interval
  │             (Hubble 네트워크 플로우)
  │
  └── 5초 후 → collectAllServices() + 30초 interval
                (K8s 서비스 + 엔드포인트)
```

### 3.2 수집기별 상세 동작

#### ① Tart VM 수집기 (`server/collectors/tart.ts`)

```
tart list                        tart ip <vm-name>
    │                                  │
    ▼                                  ▼
 VM 이름, 상태 목록            각 VM의 IP 주소
 (running / stopped)           (DHCP 할당)
    │                                  │
    └──────────┬───────────────────────┘
               ▼
         VmInfo[] 생성
         { name, status, ip, cluster, role, specs }
```

- **실행 방식**: `execa`로 로컬 셸 명령 실행
- **참조 파일**: `dashboard/server/collectors/tart.ts`
- **데이터 소스**: macOS 호스트의 Tart 하이퍼바이저

#### ② SSH 리소스 수집기 (`server/collectors/ssh.ts` + `server/parsers/`)

```
running VM 목록에서 IP 추출
         │
         ▼
   SSH 커넥션 풀에서 연결 가져오기 (또는 새로 생성)
         │
         ├── top -bn1 | head -5     ──→ parseCpuUsage()   ──→ cpuPercent
         │
         ├── free -m                ──→ parseMemory()      ──→ memoryPercent, usedMb, totalMb
         │
         ├── df / --output=...      ──→ parseDisk()        ──→ diskPercent, usedGb, totalGb
         │
         ├── sudo ss -tlnp          ──→ parsePorts()       ──→ PortInfo[]
         │
         └── cat /proc/net/dev      ──→ parseNetDev()      ──→ rxBytes, txBytes
                                          │
                                          ▼
                                    이전 읽기값과 비교하여
                                    rxBytesPerSec, txBytesPerSec 계산
```

**SSH 커넥션 풀 동작 원리** (`server/collectors/ssh.ts`):

```
exec(ip, command) 호출
     │
     ├── connections.has(ip)?  ──YES──→ 기존 연결 재사용
     │         │
     │        NO
     │         │
     │         ├── connecting.has(ip)?  ──YES──→ 진행 중인 연결 대기
     │         │         │
     │         │        NO
     │         │         │
     │         │         ▼
     │         │   ssh2 Client 생성
     │         │   { host: ip, port: 22, username, password }
     │         │   keepaliveInterval: 15초
     │         │   readyTimeout: 10초
     │         │         │
     │         │         ▼
     │         │   connections Map에 저장
     │         └─────────┘
     │
     ▼
  command 실행 (timeout: 8초)
     │
     ▼
  stdout 문자열 반환
```

- **왜 커넥션 풀인가?**: 5초마다 VM 10대에 각 5개 명령을 실행하면 초당 10개의 SSH 연결이 필요합니다. 풀링으로 연결을 재사용하면 이 오버헤드가 사라집니다.
- **왜 Prometheus가 아닌 SSH인가?**: VM에 node-exporter를 설치하지 않아도 되므로, VM 이미지를 깨끗하게 유지할 수 있습니다.

#### ③ kubectl 수집기 (`server/collectors/kubectl.ts`)

```
config/clusters.json에서 클러스터 목록 읽기
         │
         ▼
  각 클러스터에 대해 (platform, dev, staging, prod):
         │
         ├── kubectl get nodes -o json
         │   --kubeconfig kubeconfig/<cluster>.yaml
         │         │
         │         ▼
         │   NodeInfo[] { name, status, roles, kubeletVersion, ip }
         │
         └── kubectl get pods -A -o json
             --kubeconfig kubeconfig/<cluster>.yaml
                   │
                   ▼
             PodInfo[] { name, namespace, status, node, restarts, age }
```

#### ④ Hubble 트래픽 수집기 (`server/collectors/hubble.ts`)

```
각 클러스터에 대해:
  │
  ▼
kubectl exec <cilium-agent-pod> -n kube-system \
  -- hubble observe --output json --last 200
  │
  ▼
JSON 플로우 레코드 200개 파싱
  │
  ├── TrafficFlow[] 생성
  │   { source/dest namespace+pod, port, protocol, verdict }
  │
  └── AggregatedEdge[] 집계
      source→destination 쌍별로 flowCount, forwardedCount, droppedCount 합산
```

#### ⑤ HPA 스케일링 수집기 (`server/collectors/scaling.ts`)

```
kubectl get hpa -A -o json
  │
  ▼
HpaSnapshot[] {
  name, namespace, deployment,
  currentReplicas, desiredReplicas,
  minReplicas, maxReplicas,
  currentCpuPercent, targetCpuPercent
}
  │
  ▼
ScalingDataPoint { timestamp, hpas[] }
  │
  ▼
히스토리 배열에 추가 (최대 360 포인트 ≈ 30분)
```

### 3.3 수집 주기 요약표

| 수집기 | 간격 | 명령 | 출력 타입 | 용도 |
|--------|------|------|----------|------|
| Tart VM | 5초 | `tart list`, `tart ip` | `VmInfo[]` | VM 상태 + IP |
| SSH 리소스 | 5초 | `top`, `free`, `df` | `VmResources` | CPU/메모리/디스크 % |
| SSH 포트 | 5초 | `ss -tlnp` | `PortInfo[]` | 열린 포트 목록 |
| SSH 네트워크 | 5초 | `/proc/net/dev` | `NetworkStats` | RX/TX 처리량 |
| K8s 노드/Pod | 5초 | `kubectl get nodes/pods` | `ClusterInfo[]`, `PodInfo[]` | 클러스터 상태 |
| Hubble 트래픽 | 10초 | `hubble observe --last 200` | `TrafficFlow[]` | 네트워크 플로우 |
| HPA 스케일링 | 5초 | `kubectl get hpa` | `ScalingDataPoint[]` | 오토스케일링 |
| K8s 서비스 | 30초 | `kubectl get svc/endpoints` | `ServiceInfo[]` | 서비스 디스커버리 |

### 3.4 Parser: 텍스트 출력을 구조화된 데이터로 변환

SSH로 받는 것은 **사람이 읽는 텍스트**입니다. Parser가 이것을 **프로그램이 사용하는 데이터**로 변환합니다.

```
입력 (SSH 출력 텍스트)                    Parser                 출력 (TypeScript 객체)
─────────────────────                    ──────                 ────────────────────
"%Cpu(s):  5.3 us, 2.1 sy, 92.6 id"  → top.ts               → { cpuPercent: 7.4 }
                                         (100 - idle로 계산)

"Mem:  4096  2543  1553  ..."          → free.ts              → { percent: 62.1,
                                                                  usedMb: 2543,
                                                                  totalMb: 4096 }

"20G  7G  13G  35%"                    → df.ts                → { percent: 35,
                                                                  usedGb: 7,
                                                                  totalGb: 20 }

"LISTEN  0  128  0.0.0.0:80  nginx"   → ss.ts                → [{ port: 80,
                                                                   address: "0.0.0.0",
                                                                   process: "nginx" }]

"eth0: 12345 ... 67890"               → netdev.ts            → { eth0: { rxBytes: 12345,
                                                                          txBytes: 67890 } }
```

> **핵심 파일 경로**: `dashboard/server/parsers/` 디렉토리 내 7개 파서 파일

---

## 4. API 계층: 수집한 데이터를 어떻게 제공하는가

### 4.1 REST API 엔드포인트 전체 목록

> **핵심 코드**: `dashboard/server/index.ts`

| Method | 엔드포인트 | 응답 데이터 | 갱신 주기 | 사용 페이지 |
|--------|-----------|------------|----------|------------|
| GET | `/api/health` | `{ status, timestamp }` | 요청 시 | Header (연결 상태) |
| GET | `/api/snapshot` | `DashboardSnapshot` 전체 | 5초 | Overview, ClusterDetail |
| GET | `/api/traffic/all` | 전 클러스터 트래픽 요약 | 10초 | Traffic |
| GET | `/api/traffic?cluster=X` | 특정 클러스터 플로우 | 10초 | Traffic |
| GET | `/api/cluster/:name/services` | 서비스 + 엔드포인트 | 30초 | ClusterDetail |
| GET | `/api/scaling` | 전 클러스터 HPA 히스토리 | 5초 | Scaling |
| GET | `/api/scaling/:cluster` | 특정 클러스터 HPA | 5초 | Scaling |
| POST | `/api/tests/run` | `TestRun` 생성 | 요청 시 | Testing |
| GET | `/api/tests/status` | `TestRun[]` 전체 | 요청 시 | Testing |
| DELETE | `/api/tests/:id` | `{ success }` | 요청 시 | Testing |
| GET | `/api/tests/export` | CSV 파일 다운로드 | 요청 시 | Testing |

### 4.2 DashboardSnapshot 구조

`/api/snapshot`이 반환하는 핵심 데이터 구조입니다. 대시보드의 대부분의 화면이 이 하나의 응답으로 렌더링됩니다.

```typescript
// dashboard/shared/types.ts
interface DashboardSnapshot {
  vms: VmInfo[];                           // VM 10대의 상태 + IP
  vmResources: Record<string, VmResources>; // VM별 CPU/메모리/디스크 %
  vmPorts: Record<string, PortInfo[]>;      // VM별 열린 포트
  vmNetwork: Record<string, NetworkStats>;  // VM별 네트워크 처리량
  clusters: ClusterInfo[];                  // 4개 클러스터의 노드 상태
  clusterPods: Record<string, PodInfo[]>;   // 클러스터별 Pod 목록
  collectedAt: number;                      // 수집 타임스탬프
  errors: { source: string; message: string }[];  // 수집 중 발생한 에러
}
```

### 4.3 Vite 프록시: 프론트엔드 → 백엔드 연결

개발 환경에서 프론트엔드(3000)와 백엔드(3001)가 다른 포트에서 실행되므로, CORS 문제를 피하기 위해 Vite가 `/api/*` 요청을 백엔드로 프록시합니다.

```
브라우저                     Vite (3000)                 Express (3001)
   │                            │                             │
   │  GET /api/snapshot         │                             │
   │ ──────────────────────────→│                             │
   │                            │  GET /api/snapshot          │
   │                            │ ───────────────────────────→│
   │                            │                             │
   │                            │  { data: DashboardSnapshot }│
   │                            │ ←───────────────────────────│
   │  { data: DashboardSnapshot}│                             │
   │ ←──────────────────────────│                             │
```

> **설정 위치**: `dashboard/vite.config.ts` → `server.proxy`

---

## 5. 프론트엔드: 데이터를 어떻게 화면에 그리는가

### 5.1 데이터 폴링 메커니즘

> **핵심 코드**: `dashboard/src/hooks/usePolling.ts`

```typescript
// 사용 예 (App.tsx)
const { data, error, lastUpdated } = usePolling<DashboardSnapshot>('/api/snapshot', 5000);
```

```
usePolling 동작 흐름:

컴포넌트 마운트
     │
     ├── fetchData() 즉시 호출 (첫 데이터 로드)
     │
     ├── setInterval(fetchData, 5000) 등록
     │
     │   매 5초마다:
     │     ├── fetch(url) → res.json()
     │     ├── 성공 → setData(json.data ?? json)
     │     │         setLastUpdated(timestamp)
     │     │         setError(null)
     │     └── 실패 → setError(e)
     │
     └── 언마운트 시 → clearInterval()
```

### 5.2 App.tsx: 중앙 데이터 허브

`App.tsx`는 전체 대시보드의 **데이터 허브** 역할을 합니다.

```
App.tsx
  │
  ├── usePolling('/api/snapshot', 5000) → data: DashboardSnapshot
  │
  ├── networkHistoryRef (useRef)
  │     각 VM의 RX/TX 값을 최대 60개까지 누적
  │     → ClusterDetailPage의 SparkLine에 사용
  │
  ├── connectionStatus 계산
  │     error 있음 → 'down'
  │     data 없음 → 'degraded'
  │     errors > 3 → 'degraded'
  │     그 외 → 'healthy'
  │
  └── Routes (data를 Props로 전달)
        ├── / → OverviewPage(data)
        ├── /cluster/:name → ClusterDetailPage(data, networkHistory)
        ├── /testing → TestingPage(clusters)
        ├── /traffic → TrafficPage(clusters, pods, vms)
        ├── /scaling → ScalingPage(clusters)
        └── /analysis → LoadAnalysisPage(clusters, data)
```

### 5.3 6개 페이지와 시각화 방법

#### 페이지별 데이터 흐름

```
┌──────────────────────────────────────────────────────────────────────────┐
│ 페이지               데이터 소스          시각화 컴포넌트                  │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│ OverviewPage         /api/snapshot        ClusterCard (2×2 그리드)        │
│ (/)                  └→ vms, clusters     ├── StatusDot (녹색/빨간색)     │
│                         clusterPods       ├── 노드 수 배지                │
│                                           ├── Pod 상태 (Running/Pending) │
│                                           └── CPU/RAM 프로그레스 바       │
│                                                                          │
│ ClusterDetailPage    /api/snapshot        GaugeChart (CPU/메모리/디스크)   │
│ (/cluster/:name)     └→ vmResources      SparkLine (RX/TX 10포인트)      │
│                         vmPorts           VmPortList (포트 테이블)        │
│                         vmNetwork         PodTable (Pod 목록)            │
│                         clusterPods                                      │
│                                                                          │
│ TrafficPage          /api/traffic/all     플로우 요약 카드                 │
│ (/traffic)           /api/traffic?cluster  SVG 토폴로지 다이어그램         │
│                      └→ flows,            ├── 네임스페이스 그룹 박스       │
│                         aggregated        ├── Pod 노드 (원)              │
│                                           └── 베지어 커브 (초록=허용,     │
│                                               빨강=차단)                 │
│                                                                          │
│ ScalingPage          /api/scaling         HPA 상태 카드                   │
│ (/scaling)           └→ ScalingDataPoint[] Recharts AreaChart            │
│                         (360 포인트)       ├── current (파란색 영역)       │
│                                           ├── desired (주황색 선)         │
│                                           ├── min/max (회색 점선)         │
│                                           └── CPU% 오버레이              │
│                                                                          │
│ TestingPage          /api/tests/*         16개 프리셋 시나리오 카드        │
│ (/testing)           └→ TestRun[]         커스텀 테스트 빌더              │
│                                           결과 테이블 + CSV 내보내기      │
│                                                                          │
│ LoadAnalysisPage     /api/tests/status    KPI 요약 (스케일업 지연, 피크)   │
│ (/analysis)          /api/scaling         이중 Y축 차트 (RPS vs Pod수)    │
│                                           Pod 효율성 차트                 │
└──────────────────────────────────────────────────────────────────────────┘
```

#### 핵심 시각화 컴포넌트

| 컴포넌트 | 파일 | 라이브러리 | 설명 |
|---------|------|----------|------|
| `GaugeChart` | `src/components/common/GaugeChart.tsx` | Recharts PieChart | 원형 게이지. 0-60% 녹색, 60-80% 노란색, 80-100% 빨간색 |
| `SparkLine` | `src/components/common/SparkLine.tsx` | Recharts LineChart | 축 없는 미니 라인 차트. 10포인트 히스토리 |
| `StatusDot` | `src/components/common/StatusDot.tsx` | CSS | 상태 표시 원 (녹색=정상, 빨강=장애) |
| `ClusterCard` | `src/components/cluster/ClusterCard.tsx` | - | 클러스터 요약 카드 (노드, Pod, 리소스) |
| `PodTable` | `src/components/pod/PodTable.tsx` | - | Pod 목록 테이블 (네임스페이스, 상태, 리소스) |

---

## 6. 컴포넌트 구조와 레이아웃

```
AppShell
├── Sidebar (좌측 네비게이션)
│   ├── 로고
│   ├── Overview 링크 (/)
│   ├── 클러스터별 링크 (/cluster/:name) × 4
│   ├── Traffic 링크 (/traffic)
│   ├── Scaling 링크 (/scaling)
│   ├── Testing 링크 (/testing)
│   └── Analysis 링크 (/analysis)
│
├── Header (상단 바)
│   ├── 연결 상태 (healthy / degraded / down)
│   ├── VM 수 / 클러스터 수
│   ├── 에러 카운트
│   └── 마지막 업데이트 시각
│
└── MainLayout (메인 콘텐츠 영역)
    └── <Routes> → 현재 페이지 컴포넌트
```

```
src/components/
├── layout/                ← 전체 레이아웃
│   ├── AppShell.tsx       ← 루트 컨테이너 (사이드바 + 헤더 + 메인)
│   ├── Sidebar.tsx        ← 좌측 네비게이션
│   ├── Header.tsx         ← 상단 상태 바
│   └── MainLayout.tsx     ← 콘텐츠 래퍼
├── cluster/               ← 클러스터 관련
│   ├── ClusterCard.tsx    ← Overview의 클러스터 요약 카드
│   └── NodeCard.tsx       ← 노드 상세 카드
├── common/                ← 재사용 가능한 공통 UI
│   ├── GaugeChart.tsx     ← 원형 게이지 (Recharts)
│   ├── SparkLine.tsx      ← 미니 라인 차트 (Recharts)
│   └── StatusDot.tsx      ← 상태 표시 점
├── pod/
│   └── PodTable.tsx       ← Pod 목록 테이블
└── vm/
    ├── VmResourceGauges.tsx  ← VM 리소스 게이지 묶음
    ├── VmNetworkStats.tsx    ← VM 네트워크 통계
    └── VmPortList.tsx        ← VM 포트 목록
```

---

## 7. 실행 방법과 개발 환경

### 7.1 실행

```bash
cd dashboard
npm install        # 의존성 설치
npm run dev        # 프론트엔드(3000) + 백엔드(3001) 동시 실행
```

`npm run dev`는 내부적으로 `concurrently`를 사용하여 두 프로세스를 동시에 실행합니다:
- `dev:client` → Vite dev server (port 3000)
- `dev:server` → tsx로 Express 서버 (port 3001)

### 7.2 전제 조건

대시보드가 데이터를 수집하려면 다음이 필요합니다:

| 조건 | 확인 방법 | 필요 이유 |
|------|----------|----------|
| VM이 실행 중 | `tart list` | VM 상태 + IP 수집 |
| SSH 접속 가능 | `ssh admin@<ip>` | CPU/메모리/디스크/포트/네트워크 수집 |
| kubeconfig 존재 | `ls kubeconfig/` | kubectl 명령 실행 |
| Cilium+Hubble 설치 | `cilium status` | 트래픽 플로우 수집 |

---

## 8. 수정 가이드: 새 기능을 추가하려면

| 하고 싶은 것 | 수정할 파일 | 순서 |
|-------------|-----------|------|
| 새 메트릭 수집 | ① `shared/types.ts`에 타입 추가 → ② `server/parsers/`에 파서 작성 → ③ `server/collectors/`에 수집기 작성 → ④ `server/collector.ts`에 루프 등록 |
| 새 API 엔드포인트 | ① `server/index.ts`에 라우트 추가 |
| 새 페이지 | ① `src/pages/`에 컴포넌트 작성 → ② `src/App.tsx`에 Route 추가 → ③ `src/components/layout/Sidebar.tsx`에 링크 추가 |
| 새 컴포넌트 | `src/components/`의 적절한 하위 디렉토리에 파일 추가 |
| 폴링 간격 변경 | `server/collector.ts` 상단의 `INTERVAL`, `TRAFFIC_INTERVAL` 등 상수 수정 |
| SSH 타임아웃 변경 | `server/collectors/ssh.ts` → `exec()` 메서드의 `timeoutMs` 파라미터 (기본 8000ms) |

---

## 9. 핵심 설계 결정과 그 이유

| 결정 | 왜(Why) |
|------|---------|
| **DB 없이 In-Memory만 사용** | 대시보드는 "지금 상태"만 보여주면 됩니다. 히스토리는 Prometheus/Grafana가 담당합니다 |
| **Full-Stack TypeScript** | `shared/types.ts` 하나로 프론트/백엔드 타입을 공유하면 API 응답 구조가 변경될 때 컴파일 에러로 즉시 발견됩니다 |
| **SSH 커넥션 풀** | 5초마다 10대 VM × 5개 명령 = 매 주기 50개 SSH 세션. 풀링 없이는 연결/해제 오버헤드가 데이터 수집보다 느려집니다 |
| **Hubble JSON 출력** | 텍스트 파싱 대신 `--output json`을 사용하여 구조화된 네트워크 플로우를 바로 사용합니다 |
| **스케일링 히스토리 360 포인트 제한** | 5초 × 360 = 30분. 메모리 사용을 제한하면서 오토스케일링 추이를 충분히 보여줍니다 |
| **한 번에 테스트 1개만 실행** | 부하 테스트가 동시에 실행되면 결과가 서로 영향을 주어 신뢰할 수 없습니다 |
| **Vite 프록시** | 개발 환경에서 CORS 설정 없이 프론트→백엔드 통신을 투명하게 처리합니다 |

---

> **다음 단계**: [07-demo-apps.md](07-demo-apps.md)에서 대시보드의 Testing 페이지가 실행하는 k6 부하 테스트와 stress-ng 스트레스 테스트의 동작 방식을 학습합니다.
