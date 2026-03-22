# 10. SRE 대시보드 — React + Express 실시간 모니터링

> **이 문서의 목표**: SRE 대시보드의 개념과 필요성을 이해하고, React + Express 아키텍처로 10대 VM과 4개 클러스터에서 데이터를 수집하여 화면에 표시하는 전체 흐름을 학습합니다.
>
> **선행 문서**: [01-project-overview.md](01-project-overview.md) (프로젝트 구조), [05-monitoring.md](05-monitoring.md) (Prometheus/Grafana)

---

## 목차

1. [SRE와 대시보드의 필요성](#1-sre와-대시보드의-필요성)
2. [기술 스택](#2-기술-스택)
3. [전체 아키텍처](#3-전체-아키텍처)
4. [부팅 시퀀스: `npm run dev`부터 첫 화면까지](#4-부팅-시퀀스-npm-run-dev부터-첫-화면까지)
5. [데이터 수집 파이프라인](#5-데이터-수집-파이프라인)
6. [SSH 커넥션 풀](#6-ssh-커넥션-풀)
7. [백그라운드 수집 루프](#7-백그라운드-수집-루프)
8. [수집기별 상세 동작](#8-수집기별-상세-동작)
9. [Parser: 텍스트를 구조화된 데이터로 변환](#9-parser-텍스트를-구조화된-데이터로-변환)
10. [API 계층](#10-api-계층)
11. [프론트엔드: 데이터 폴링과 렌더링](#11-프론트엔드-데이터-폴링과-렌더링)
12. [6개 페이지 상세 설명](#12-6개-페이지-상세-설명)
13. [컴포넌트 구조와 레이아웃](#13-컴포넌트-구조와-레이아웃)
14. [실행 방법과 개발 환경](#14-실행-방법과-개발-환경)
15. [수정 가이드: 새 기능 추가하기](#15-수정-가이드-새-기능-추가하기)
16. [핵심 설계 결정과 그 이유](#16-핵심-설계-결정과-그-이유)
17. [상용 SRE 도구와의 비교](#17-상용-sre-도구와의-비교)

---

## 1. SRE와 대시보드의 필요성

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

CLI에서 `kubectl get pods`를 클러스터마다 반복 실행하면 개별 리소스 상태는 확인할 수 있다. 그러나 4개 클러스터, 10개 노드, 수십 개 Pod의 전체 상태를 **동시에** 파악하는 것은 CLI만으로는 불가능하다. 터미널 출력은 시점 스냅샷이므로 시간에 따른 변화 추이를 볼 수 없고, 여러 리소스 간의 상관관계(CPU 증가 → HPA 반응 → Pod 수 변화)를 한눈에 파악할 수 없다.

이런 질문에 **실시간으로 답을 주는 도구**가 SRE 대시보드다.
우리 프로젝트에서는 이 대시보드를 직접 만들었다.

---

## 2. 기술 스택

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

## 3. 전체 아키텍처

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

### 데이터가 화면까지 도달하는 경로

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

## 4. 부팅 시퀀스: `npm run dev`부터 첫 화면까지

`npm run dev`를 치는 순간부터 브라우저에 첫 데이터가 렌더링되기까지, **실제 코드가 실행되는 순서**를 추적한다.

### 4.1 프로세스 시작 (t=0초)

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

> `concurrently`가 백엔드와 프론트엔드를 **동시에** 별도 프로세스로 실행한다.

### 4.2 백엔드 부팅 시퀀스 (server/index.ts → collector.ts → collectors/*)

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

### 4.3 Collector 초기화 시퀀스 (collector.ts → startCollector())

`startCollector()`가 호출되면 **4개의 독립적인 수집 루프**가 시간차를 두고 시작된다.

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

> **시간차를 두는 이유**: 모든 수집기가 동시에 시작하면 kubectl/SSH 명령이 한꺼번에 몰려 시스템 부하가 급증한다. 2~5초 간격으로 분산시켜 안정적으로 시작한다.

### 4.4 프론트엔드 부팅 시퀀스 (main.tsx → App.tsx → usePolling)

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

### 4.5 전체 타임라인 요약

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

t=3.0s  snapshot 변수에 첫 데이터 저장 완료

t=3.5s  collectAllTraffic() 최초 실행
        └── hubble observe --last 200

t=5.5s  collectAllServices() 최초 실행
        └── kubectl get svc/endpoints

t=?     사용자가 브라우저에서 localhost:3000 접속
        ├── main.tsx → App.tsx 마운트
        ├── usePolling: fetch('/api/snapshot') 첫 호출
        ├── Vite 프록시 → Express → getSnapshot() 반환
        ├── data=null → 로딩 스피너 표시
        └── data 수신 → OverviewPage 렌더링 (첫 화면 표시)

t=+5s   usePolling: 두 번째 fetch → 데이터 갱신
t=+10s  세 번째 fetch → 이후 5초 간격으로 계속 반복...
```

> **핵심 포인트**: 백엔드의 `collect()`가 완료되기 전에 프론트엔드가 `/api/snapshot`을 호출하면, 초기 빈 snapshot (`{ vms: [], clusters: [], ... }`)이 반환된다. 5초 후 다음 폴링에서 실제 데이터가 채워진다.

---

## 5. 데이터 수집 파이프라인

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

### 전체 데이터 흐름 정리

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

## 6. SSH 커넥션 풀

VM에서 데이터를 가져오려면 **SSH(Secure Shell)**로 접속해야 한다.
매번 SSH 연결을 새로 만들면 시간이 많이 걸린다 (연결 수립에 0.5~1초).
5초마다 10개 VM에 접속하면 매번 5~10초가 낭비된다.

SSH 연결 수립은 TCP 핸드셰이크, 키 교환, 인증의 3단계를 거치며, 각 단계에 네트워크 라운드트립이 발생한다. 이 오버헤드가 연결당 0.5~1초이다. 5초 주기로 10개 VM에서 데이터를 수집해야 하는데, 매번 연결을 새로 맺으면 수집 주기보다 연결 시간이 더 길어져 시스템이 동작할 수 없다.

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

### SSH 커넥션 풀 최초 연결 과정

첫 번째 `collect()` 실행 시, SSH 풀에는 연결이 하나도 없다. 최초 연결 과정:

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

### 커넥션 풀 상세 동작 흐름

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

- **왜 커넥션 풀인가?**: 5초마다 VM 10대에 각 5개 명령을 실행하면 초당 10개의 SSH 연결이 필요하다. 풀링으로 연결을 재사용하면 이 오버헤드가 사라진다.
- **왜 Prometheus가 아닌 SSH인가?**: VM에 node-exporter를 설치하지 않아도 되므로, VM 이미지를 깨끗하게 유지할 수 있다.

---

## 7. 백그라운드 수집 루프

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

### 메인 수집 루프가 하는 일

메인 `collect()` 함수가 5초마다 수행하는 작업:

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

---

## 8. 수집기별 상세 동작

### 8.1 Tart VM 수집기 (`server/collectors/tart.ts`)

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

- **실행 방식**: `execa`로 로컬 셸 명령 실행
- **데이터 소스**: macOS 호스트의 Tart 하이퍼바이저

### 8.2 SSH 리소스 수집기 (`server/collectors/ssh.ts` + `server/parsers/`)

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

### 8.3 kubectl 수집기 (`server/collectors/kubectl.ts`)

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

### 8.4 Hubble 트래픽 수집기 (`server/collectors/hubble.ts`)

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

### 8.5 HPA 스케일링 수집기 (`server/collectors/scaling.ts`)

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

### 수집 주기 요약표

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

---

## 9. Parser: 텍스트를 구조화된 데이터로 변환

SSH로 받은 결과는 사람이 읽는 텍스트다:

```
              total        used        free      shared  buff/cache   available
Mem:           2048        1234         456          12         358         814
```

이 텍스트에서 `1234`(사용 중인 메모리)와 `2048`(전체 메모리)을 추출해야 한다.
명령어의 텍스트 출력을 정규식이나 문자열 분할로 파싱하여 구조화된 숫자 데이터로 변환하는 모듈이 **파서(Parser)**다.

### 파서별 입출력 변환

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

> **핵심 파일 경로**: `dashboard/server/parsers/` 디렉토리 내 7개 파서 파일

---

## 10. API 계층

### REST API 엔드포인트 전체 목록

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

왜 REST API 구조인가? REST는 리소스(resource) 단위로 엔드포인트를 설계하는 방식이다. `/api/traffic`, `/api/scaling`, `/api/tests`처럼 리소스별로 URL을 분리하면, 각 엔드포인트가 독립적으로 동작하므로 하나의 API 장애가 다른 API에 영향을 주지 않는다. 또한 HTTP 표준 메서드(GET/POST/DELETE)로 동작이 명확히 구분되어 프론트엔드와 백엔드 간의 인터페이스 계약이 단순해진다.

### DashboardSnapshot 구조

`/api/snapshot`이 반환하는 핵심 데이터 구조다. 대시보드의 대부분의 화면이 이 하나의 응답으로 렌더링된다.

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

### Vite 프록시: 프론트엔드 → 백엔드 연결

개발 환경에서 프론트엔드(3000)와 백엔드(3001)가 다른 포트에서 실행되므로, CORS 문제를 피하기 위해 Vite가 `/api/*` 요청을 백엔드로 프록시한다.

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

## 11. 프론트엔드: 데이터 폴링과 렌더링

### 데이터 폴링 메커니즘

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

### App.tsx: 중앙 데이터 허브

`App.tsx`는 전체 대시보드의 **데이터 허브** 역할을 한다.

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

### 페이지별 데이터 흐름과 시각화

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

### 핵심 시각화 컴포넌트

| 컴포넌트 | 파일 | 라이브러리 | 설명 |
|---------|------|----------|------|
| `GaugeChart` | `src/components/common/GaugeChart.tsx` | Recharts PieChart | 원형 게이지. 0-60% 녹색, 60-80% 노란색, 80-100% 빨간색 |
| `SparkLine` | `src/components/common/SparkLine.tsx` | Recharts LineChart | 축 없는 미니 라인 차트. 10포인트 히스토리 |
| `StatusDot` | `src/components/common/StatusDot.tsx` | CSS | 상태 표시 원 (녹색=정상, 빨강=장애) |
| `ClusterCard` | `src/components/cluster/ClusterCard.tsx` | - | 클러스터 요약 카드 (노드, Pod, 리소스) |
| `PodTable` | `src/components/pod/PodTable.tsx` | - | Pod 목록 테이블 (네임스페이스, 상태, 리소스) |

---

## 12. 6개 페이지 상세 설명

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

### 2. Cluster Detail — 노드/파드 상세 정보

특정 클러스터를 선택하면 해당 클러스터의 **상세 정보**를 볼 수 있다.

- **노드 목록**: 각 노드(VM)의 CPU, 메모리, 디스크 사용률, 네트워크 트래픽
- **파드 목록**: 네임스페이스별 파드 상태, 재시작 횟수, 리소스 사용량
- **열린 포트**: 각 VM에서 열려 있는 포트와 해당 프로세스

터미널에서 `kubectl get pods`로 일일이 확인하는 대신, 대시보드에서 모든 클러스터의 노드/파드 상태를 한 화면에서 확인할 수 있다.

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

#### 테스트 실행 과정

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

### 4. Traffic — Hubble 네트워크 토폴로지

**Hubble**은 Cilium(CNI)이 제공하는 네트워크 관측(Observability) 도구다.

이 페이지는 파드 간 트래픽 흐름을 시각적으로 보여준다.

```
demo/nginx-web ──(TCP/HTTP, 150건)──► demo/httpbin
demo/httpbin ──(TCP, 45건)──► demo/redis
demo/httpbin ──(TCP, 23건)──► demo/postgres
demo/keycloak ──(TCP, 12건)──► demo/postgres
kube-system/coredns ◄──(UDP/DNS, 200건)── 모든 파드
```

네트워크 정책을 설정한 후 "정말로 차단되고 있는가?"를 이 페이지에서 확인할 수 있다.
- `FORWARDED` = 정상적으로 전달된 트래픽
- `DROPPED` = 네트워크 정책에 의해 차단된 트래픽

차단된 트래픽이 보이면 네트워크 정책이 제대로 동작하고 있다는 증거다.
반대로, 차단되어야 할 트래픽이 `FORWARDED`로 보이면 정책에 구멍이 있다는 뜻이다.

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

5초마다 수집한 데이터를 **최대 360개 포인트** (약 30분치)까지 저장한다.
이 시계열 데이터를 차트로 그리면 스케일링 과정을 시각적으로 볼 수 있다.

#### 스케일링 테스트에서 측정하는 지표

| 지표 | 의미 |
|------|------|
| Scale-up Latency | 부하 시작 후 첫 스케일업까지 걸린 시간 |
| Peak Replicas | 최대 몇 개까지 늘어났는가 |
| Scale-down Started | 부하 종료 후 스케일다운이 시작된 시점 |
| Avg RPS per Pod | 파드당 평균 초당 요청 수 |

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

## 13. 컴포넌트 구조와 레이아웃

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

## 14. 실행 방법과 개발 환경

### 실행

```bash
cd dashboard
npm install        # 의존성 설치
npm run dev        # 프론트엔드(3000) + 백엔드(3001) 동시 실행
```

`npm run dev`는 내부적으로 `concurrently`를 사용하여 두 프로세스를 동시에 실행한다:
- `dev:client` → Vite dev server (port 3000)
- `dev:server` → tsx로 Express 서버 (port 3001)

### 전제 조건

대시보드가 데이터를 수집하려면 다음이 필요하다:

| 조건 | 확인 방법 | 필요 이유 |
|------|----------|----------|
| VM이 실행 중 | `tart list` | VM 상태 + IP 수집 |
| SSH 접속 가능 | `ssh admin@<ip>` | CPU/메모리/디스크/포트/네트워크 수집 |
| kubeconfig 존재 | `ls kubeconfig/` | kubectl 명령 실행 |
| Cilium+Hubble 설치 | `cilium status` | 트래픽 플로우 수집 |

---

## 15. 수정 가이드: 새 기능 추가하기

| 하고 싶은 것 | 수정할 파일 | 순서 |
|-------------|-----------|------|
| 새 메트릭 수집 | ① `shared/types.ts`에 타입 추가 → ② `server/parsers/`에 파서 작성 → ③ `server/collectors/`에 수집기 작성 → ④ `server/collector.ts`에 루프 등록 |
| 새 API 엔드포인트 | ① `server/index.ts`에 라우트 추가 |
| 새 페이지 | ① `src/pages/`에 컴포넌트 작성 → ② `src/App.tsx`에 Route 추가 → ③ `src/components/layout/Sidebar.tsx`에 링크 추가 |
| 새 컴포넌트 | `src/components/`의 적절한 하위 디렉토리에 파일 추가 |
| 폴링 간격 변경 | `server/collector.ts` 상단의 `INTERVAL`, `TRAFFIC_INTERVAL` 등 상수 수정 |
| SSH 타임아웃 변경 | `server/collectors/ssh.ts` → `exec()` 메서드의 `timeoutMs` 파라미터 (기본 8000ms) |

---

## 16. 핵심 설계 결정과 그 이유

| 결정 | 왜(Why) |
|------|---------|
| **DB 없이 In-Memory만 사용** | 대시보드는 "지금 상태"만 보여주면 된다. 히스토리는 Prometheus/Grafana가 담당한다 |
| **Full-Stack TypeScript** | `shared/types.ts` 하나로 프론트/백엔드 타입을 공유하면 API 응답 구조가 변경될 때 컴파일 에러로 즉시 발견된다 |
| **SSH 커넥션 풀** | 5초마다 10대 VM x 5개 명령 = 매 주기 50개 SSH 세션. 풀링 없이는 연결/해제 오버헤드가 데이터 수집보다 느려진다 |
| **Hubble JSON 출력** | 텍스트 파싱 대신 `--output json`을 사용하여 구조화된 네트워크 플로우를 바로 사용한다 |
| **스케일링 히스토리 360 포인트 제한** | 5초 x 360 = 30분. 메모리 사용을 제한하면서 오토스케일링 추이를 충분히 보여준다 |
| **한 번에 테스트 1개만 실행** | 부하 테스트가 동시에 실행되면 결과가 서로 영향을 주어 신뢰할 수 없다 |
| **Vite 프록시** | 개발 환경에서 CORS 설정 없이 프론트 → 백엔드 통신을 투명하게 처리한다 |

---

## 17. 상용 SRE 도구와의 비교

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
