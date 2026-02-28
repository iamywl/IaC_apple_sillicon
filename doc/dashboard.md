# SRE(Site Reliability Engineering) 운영 대시보드(Operations Dashboard) — 기술 문서(Technical Document)

## 1. 개요(Overview)

10개 Tart VM / 4개 K8s(Kubernetes) 클러스터(Cluster)를 운영하는 인프라(Infrastructure)의 SRE 대시보드.
실시간 리소스 모니터링(Real-time Resource Monitoring), 부하/스트레스 테스트(Load/Stress Testing) 실행, Cilium Hubble 기반 트래픽 가시성(Traffic Visibility), HPA(Horizontal Pod Autoscaler) 오토스케일링(Auto-scaling) 추이, 부하 분석(Load Analysis)을 웹 브라우저에서 제공한다.

```bash
cd dashboard && npm install && npm run dev
# Frontend: http://localhost:3000  |  Backend: http://localhost:3001
```

---

## 2. 기술 스택(Tech Stack)

| 계층(Layer) | 기술(Technology) | 역할(Role) |
|------|------|------|
| 프론트엔드(Frontend) | React 19 + Vite 7 + TypeScript 5.9 | SPA(Single Page Application), HMR(Hot Module Replacement) 개발 환경 |
| 라우팅(Routing) | react-router-dom v7 | 클라이언트 사이드 라우팅(Client-side Routing) — 6개 페이지(Pages) |
| 스타일링(Styling) | Tailwind CSS 4 | 유틸리티 기반 다크 테마(Utility-first Dark Theme) |
| 차트(Charts) | Recharts 3 | AreaChart, LineChart, BarChart, 게이지(Gauge) |
| 백엔드(Backend) | Express 5 + TypeScript | REST API — 9개 엔드포인트(Endpoints) |
| SSH | ssh2 (npm) | VM 커넥션 풀(Connection Pool) — 10개 영속 연결(Persistent Connections) |
| CLI | execa | tart, kubectl 명령 실행(Command Execution) |
| 런타임(Runtime) | tsx (watch) | TS 직접 실행 + 핫리로드(Hot Reload) |

---

## 3. 아키텍처(Architecture)

### 3.1 시스템 구조(System Structure)

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser (localhost:3000)                                       │
│                                                                 │
│  ┌──── Sidebar ────┐  ┌──── Content Area ─────────────────────┐│
│  │ Overview         │  │  <Routes>                             ││
│  │ Testing          │  │    /            → OverviewPage        ││
│  │ Traffic          │  │    /cluster/:n  → ClusterDetailPage   ││
│  │ Scaling          │  │    /testing     → TestingPage         ││
│  │ Analysis         │  │    /traffic     → TrafficPage         ││
│  │                  │  │    /scaling     → ScalingPage         ││
│  │                  │  │    /analysis    → LoadAnalysisPage    ││
│  └──────────────────┘  └──────────────────────────────────────┘│
│             ▲ usePolling (5s) / fetch (on demand)              │
└─────────────┬──────────────────────────────────────────────────┘
              │ HTTP (Vite proxy → :3001)
┌─────────────▼──────────────────────────────────────────────────┐
│  Express Server (localhost:3001)                                │
│                                                                 │
│  ┌── Collector Loops ─────────────────────────────────────────┐│
│  │  5s  │ VM info (tart) + SSH resources + kubectl nodes/pods ││
│  │  5s  │ HPA scaling history (kubectl get hpa)               ││
│  │ 10s  │ Hubble traffic flows (kubectl exec hubble-relay)    ││
│  │ 30s  │ K8s services/endpoints (kubectl get svc/ep)         ││
│  └────────────────────────────────────────────────────────────┘│
│                                                                 │
│  ┌── Job Manager ─────────────────────────────────────────────┐│
│  │  K8s Job 생성 → 2s 폴링 → 완료 시 로그 수집 → 파싱       ││
│  │  k6 / stress-ng / CiliumNetworkPolicy 자동 적용           ││
│  └────────────────────────────────────────────────────────────┘│
│                                                                 │
│  API: 9 endpoints (GET/POST/DELETE)                            │
└──────┬──────────┬──────────┬──────────────────────────────────┘
       │          │          │
  ┌────▼────┐ ┌──▼────┐ ┌──▼──────┐
  │tart CLI │ │SSH×10 │ │kubectl×4│
  └─────────┘ └───────┘ └─────────┘
```

### 3.2 설계 원칙(Design Principles) — 소프트웨어 공학(Software Engineering) 관점

| 원칙(Principle) | 적용(Application) |
|------|------|
| **관심사 분리(Separation of Concerns)** | 수집기(Collector), 파서(Parser), API(index), UI(Pages) 계층 분리 |
| **단일 책임 원칙(Single Responsibility Principle, SRP)** | 파일 하나가 하나의 역할만 수행 (예: `k6.ts`는 k6 출력 파싱(Parsing)만, `scaling.ts`는 HPA 수집만) |
| **캐시 패턴(Cache-Aside Pattern)** | 수집기가 백그라운드(Background)에서 데이터를 캐시(Cache)에 저장, API는 캐시만 조회 (비동기 분리) |
| **풀 기반 아키텍처(Pull-based Architecture)** | 서버가 주기적으로 데이터를 풀링(Pulling), 클라이언트도 5초 폴링(Polling) — 양방향 풀(Bidirectional Pull) |
| **커넥션 풀(Connection Pool)** | SSH 연결을 VM당 1개 유지, 매 수집마다 재사용(Reuse) |
| **우아한 성능 저하(Graceful Degradation)** | `Promise.allSettled`로 일부 VM/클러스터 장애 시에도 나머지 데이터 수집 |
| **타입 안전성(Type Safety)** | `shared/types.ts`로 프론트/백엔드 25+개 인터페이스(Interface) 공유, 컴파일 타임 검증(Compile-time Validation) |

---

## 4. 프로젝트 구조(Project Structure)

```
dashboard/
├── package.json                    # 의존성(Dependencies) + scripts (dev, build, preview)
├── vite.config.ts                  # Vite + Tailwind + API proxy + strictPort
├── tsconfig.json                   # TypeScript 설정(Configuration) (verbatimModuleSyntax)
├── index.html                      # SPA 엔트리(Entry Point)
│
├── shared/
│   └── types.ts                    # 프론트/백엔드 공유 타입(Shared Types) — 25+개 인터페이스
│
├── server/
│   ├── index.ts                    # Express 서버(Server) — 9개 API 엔드포인트
│   ├── config.ts                   # clusters.json 파싱(Parsing), kubeconfig 경로(Path)
│   ├── collector.ts                # 4개 백그라운드 수집 루프(Collection Loops) 관리
│   ├── jobs.ts                     # K8s Job 라이프사이클(Lifecycle) — 생성→감시→수집→파싱→CSV
│   │
│   ├── collectors/
│   │   ├── tart.ts                 # tart list/ip 실행 → VmInfo[]
│   │   ├── ssh.ts                  # ssh2 커넥션 풀(Connection Pool) — VM당 1 영속 연결(Persistent Connection)
│   │   ├── kubectl.ts              # kubectl get nodes/pods -o json
│   │   ├── hubble.ts               # Hubble observe → TrafficFlow[] + AggregatedEdge[]
│   │   ├── services.ts             # kubectl get svc/endpoints → ServiceInfo[]
│   │   └── scaling.ts              # kubectl get hpa → HpaSnapshot[] — 360개 링 버퍼(Ring Buffer)
│   │
│   └── parsers/
│       ├── top.ts                  # CPU% 파싱 (top -bn1)
│       ├── free.ts                 # 메모리(Memory) 파싱 (free -m)
│       ├── df.ts                   # 디스크(Disk) 파싱 (df)
│       ├── ss.ts                   # 포트(Port) 파싱 (ss -tlnp)
│       ├── netdev.ts               # 네트워크(Network) 파싱 (/proc/net/dev → bytes/sec)
│       ├── k6.ts                   # k6 출력(Output) → p95/p99/avgLatency/errorRate/RPS
│       └── stress-ng.ts            # stress-ng metrics-brief → bogo-ops
│
└── src/
    ├── main.tsx                    # 엔트리(Entry) — BrowserRouter 래핑(Wrapping)
    ├── App.tsx                     # 라우터(Router) + 폴링(Polling) + 네트워크 히스토리(Network History)
    │
    ├── hooks/
    │   └── usePolling.ts           # 범용 폴링 훅(Generic Polling Hook) — interval, raw 모드
    │
    ├── pages/
    │   ├── OverviewPage.tsx        # 4개 클러스터 2×2 요약(Summary)
    │   ├── ClusterDetailPage.tsx   # 개별 클러스터 상세(Detail)
    │   ├── TestingPage.tsx         # 13개 프리셋(Preset) + 커스텀 테스트(Custom Test) + CSV
    │   ├── TrafficPage.tsx         # SVG 토폴로지(Topology) — VM 고정, Pod 내부 배치
    │   ├── ScalingPage.tsx         # HPA 상태(Status) + 시계열 차트(Time-series Chart)
    │   └── LoadAnalysisPage.tsx    # 부하 분석(Load Analysis) — 테스트 결과 종합 대시보드
    │
    ├── components/
    │   ├── layout/
    │   │   ├── AppShell.tsx        # Sidebar + Header + Content 레이아웃(Layout)
    │   │   ├── Sidebar.tsx         # 세로 내비게이션(Vertical Navigation) — 5개 링크, SVG 아이콘(Icons)
    │   │   ├── Header.tsx          # 상단바(Top Bar) — 상태, 에러수, 타임스탬프(Timestamp)
    │   │   └── MainLayout.tsx      # 레거시(Legacy) — 호환용(Backward Compatibility)
    │   ├── cluster/                # ClusterCard, NodeCard
    │   ├── vm/                     # VmResourceGauges, VmPortList, VmNetworkStats
    │   ├── pod/                    # PodTable
    │   └── common/                 # StatusDot, GaugeChart, SparkLine
    │
    └── styles/
        └── globals.css             # 다크 테마(Dark Theme) + flow-edge-animated 애니메이션(Animation)
```

---

## 5. API 엔드포인트(Endpoints)

| 메서드(Method) | 경로(Path) | 설명(Description) | 폴링 간격(Polling Interval) |
|--------|------|------|-----------|
| GET | `/api/health` | 서버 상태 확인(Health Check) | — |
| GET | `/api/snapshot` | 전체 인프라 스냅샷(Full Infrastructure Snapshot) — VM/리소스/포트/네트워크/클러스터/Pod | 5s |
| GET | `/api/traffic?cluster=X` | Hubble 트래픽 플로우(Traffic Flows) + 집계 엣지(Aggregated Edges) | 5s |
| GET | `/api/cluster/:name/services` | K8s 서비스(Services) + 엔드포인트(Endpoints) 목록 | — |
| POST | `/api/tests/run` | 테스트 실행(Run Test) `{type, cluster, config?, stressConfig?, scalingConfig?, scenarioName?}` | — |
| GET | `/api/tests/status` | 전체 테스트 상태 목록(Test Status List) | 3s |
| DELETE | `/api/tests/:id` | 테스트 취소(Cancel) + K8s Job/ConfigMap 삭제(Delete) | — |
| GET | `/api/tests/export` | 완료된 테스트 결과 CSV 다운로드(Download) | — |
| GET | `/api/scaling?cluster=X` | HPA 스케일링 히스토리(Scaling History) — 시계열(Time-series) | 3s |

### 5.1 `/api/snapshot` 응답 구조(Response Structure)

```typescript
{
  data: {
    vms: VmInfo[];                           // 10개 VM 상태/IP/스펙(Specs)
    vmResources: Record<string, VmResources>; // VM별 CPU/MEM/DISK %
    vmPorts: Record<string, PortInfo[]>;      // VM별 열린 포트(Open Ports)
    vmNetwork: Record<string, NetworkStats>;  // VM별 RX/TX bytes/sec
    clusters: ClusterInfo[];                  // 4개 클러스터 노드 상태(Node Status)
    clusterPods: Record<string, PodInfo[]>;   // 클러스터별 Pod 목록(Pod List)
    collectedAt: number;                      // 수집 시각(Collection Timestamp) — Unix ms
    errors: { source: string; message: string }[];
  },
  timestamp: number,
  stale: boolean
}
```

### 5.2 `/api/traffic` 응답 구조(Response Structure)

```typescript
{
  flows: TrafficFlow[];        // 최근 200개 개별 플로우(Individual Flows)
  aggregated: AggregatedEdge[]; // source/destination 쌍별 집계(Pair Aggregation)
  collectedAt: number;
  cluster: string;
}
```

### 5.3 `/api/tests/export` CSV 컬럼(Columns) — 23개

```
id, type, scenario, cluster, status, started_at, completed_at, duration_sec,
vus, load_duration, target_url, stress_workers, stress_timeout, stress_vm_bytes,
p95_latency_ms, p99_latency_ms, avg_latency_ms, error_rate, rps, total_requests,
cpu_bogo_ops, memory_bogo_ops, error
```

---

## 6. 페이지별 상세(Page Details)

### 6.1 Overview (`/`)

4개 클러스터를 2×2 그리드(Grid)로 요약. 각 카드(Card)에 노드 수, Pod 상태별 카운트(Running/Pending/Failed), 평균 CPU/RAM 표시.
카드 클릭 시 `/cluster/:name`으로 이동.

### 6.2 Cluster Detail (`/cluster/:name`)

개별 클러스터의 노드 카드(Node Card) 목록. 각 노드를 클릭하면 확장:
- CPU/Memory/Disk 원형 게이지(Circular Gauge) — 70%↑노랑, 90%↑빨강
- RX/TX 네트워크 스파크라인(SparkLine)
- 열린 포트 테이블(Open Ports Table) — 포트, 바인드 주소(Bind Address), 프로세스명(Process Name)
- Pod 목록 테이블(Pod List Table) — 이름, 네임스페이스(Namespace), 상태, 재시작 횟수(Restart Count), Age

### 6.3 Testing (`/testing`)

**설계 패턴(Design Pattern): 전략 패턴(Strategy Pattern)** — 테스트 타입(Test Type: load/custom-load/stress-cpu/stress-memory/scaling-test)에 따라 다른 Job YAML을 생성하는 전략 패턴 적용.

| 탭(Tab) | 기능(Function) |
|----|------|
| **Scenarios** | 13개 프리셋 시나리오(Preset Scenarios) 카드, 클릭으로 즉시 실행 |
| **Custom** | VUs, Duration, Target URL, Ramp-up, p95 임계값(Threshold), Workers, Timeout, VM Bytes 커스텀 입력 |

**13개 프리셋 시나리오(Preset Scenarios):**

| 카테고리(Category) | 시나리오(Scenario) | 타입(Type) | 설명(Description) |
|------|------|------|------|
| 부하 테스트(Load Test) | Light Load | custom-load | 10 VUs, 15s — 기준선 성능 확인(Baseline Performance Check) |
| | Standard Load | load | 50 VUs, 30s — 일반 트래픽 시뮬레이션(Normal Traffic Simulation) |
| | Heavy Load | custom-load | 200 VUs, 60s — 피크 트래픽 부하(Peak Traffic Stress) |
| | Ramp-up Test | custom-load | 0→100 VUs 램프(Ramp) 10s, 유지(Sustain) 30s |
| | Httpbin API | custom-load | 30 VUs, 20s — httpbin /get 대상 |
| | Strict SLA | custom-load | 50 VUs, 30s — p95<500ms, err<1% 임계값(Threshold) |
| 스케일링 테스트(Scaling Test) | Scale Test — Light | scaling-test | 30 VUs, 60s + 60s 쿨다운(Cooldown) — HPA 관찰(Observe) |
| | Scale Test — Heavy | scaling-test | 200 VUs, 120s + 60s 쿨다운 — 전체 HPA 부하(Full HPA Stress) |
| | Scale Test — Ramp | scaling-test | 0→150 VUs 램프 30s, 유지 60s + 60s 쿨다운 |
| 스트레스 테스트(Stress Test) | CPU Light | stress-cpu | 1 워커(Worker), 30s — 단일 코어(Single Core) |
| | CPU Heavy | stress-cpu | 2 워커, 60s — 멀티 코어(Multi-core) |
| | Mem 64M | stress-memory | 1 워커, 30s, 64MB 할당(Allocation) |
| | Mem 128M | stress-memory | 2 워커, 60s, 128MB 할당 |

**백엔드(Backend) Job 라이프사이클(Lifecycle)** (`jobs.ts`):

```
POST /api/tests/run
  ↓
1. YAML 생성(Generate) — k6 ConfigMap + Job 또는 stress-ng Job
2. CiliumNetworkPolicy 자동 적용(Auto-apply) — sre-test: "true" 라벨(Label)
3. kubectl apply -f - (Job 생성)
4. 2초 간격 폴링(Polling) 시작 — kubectl get pods -l job-name=ID
  ↓
Pod Pending → Running → Succeeded/Failed
  ↓
5. kubectl logs 수집 → k6/stress-ng 파서(Parser)로 메트릭(Metrics) 추출
6. TestRun 상태 업데이트(Status Update) — completed/failed + results
7. ConfigMap 자동 삭제(Auto-delete)
```

**k6 부하 테스트(Load Test) 옵션(Options):**
- **고정 VU(Fixed VU)**: `vus: N, duration: 'Xs'`
- **Ramp-up**: `stages: [{ duration: ramp, target: vus }, { duration: sustain, target: vus }, { duration: ramp, target: 0 }]`
- **임계값(Thresholds)**: `thresholds: { http_req_duration: ['p(95)<N'], http_req_failed: ['rate<N'] }`

**Istio 사이드카(Sidecar) 우회(Bypass)**: Job Pod에 `sidecar.istio.io/inject: "false"` 어노테이션(Annotation)을 설정하여 Istio 사이드카 주입(Injection)을 방지. 사이드카가 있으면 Job이 종료되지 않는 문제 해결.

**스케일링 테스트(Scaling Test) 워크플로우(Workflow):**

```
1. k6 부하 테스트 실행 (동일 Job YAML)
2. 부하 중 HPA 스냅샷(Snapshot) 주기적 수집 (5초 간격)
3. k6 완료 후 쿨다운(Cooldown) 기간 돌입
4. 쿨다운 중에도 HPA 스냅샷 계속 수집
5. 쿨다운 종료 → ScalingTestMeta 생성:
   - 스케일업 지연시간(Scale-up Latency)
   - 최대 레플리카(Peak Replicas)
   - 스케일다운 시작 시점(Scale-down Start)
   - Pod당 평균 RPS(Avg RPS per Pod)
```

### 6.4 Traffic (`/traffic`)

**설계 패턴(Design Pattern): 복합 패턴(Composite Pattern)** — VM 안에 Pod를 포함하는 계층적 구조(Hierarchical Structure).

**레이아웃 계산 과정(Layout Calculation):**

```
1. clusterVms + clusterNodes의 IP 주소를 매칭하여 K8s node → VM 매핑(Mapping)
2. 각 Pod의 nodeName으로 해당 VM에 배치(Placement)
3. Pod를 서비스(Service) 단위로 그룹핑(Grouping) — ReplicaSet 해시 접미사(Hash Suffix) 제거
4. VM 박스를 수평 배치(Horizontal Layout) — master 우선
5. Pod를 VM 박스 내부에 그리드(Grid)로 배치
```

**SVG 렌더링(Rendering):**
- **VM 박스**: 둥근 사각형(Rounded Rectangle). master=보라 테두리, worker=파랑, external=회색
- **Pod 노드(Node)**: 원(Circle), 네임스페이스(Namespace)별 색상 (`kube-system=파랑, demo=초록, monitoring=보라, argocd=주황`)
- **트래픽 엣지(Traffic Edge)**: 이차 베지어 곡선(Quadratic Bezier Curve), CSS `stroke-dasharray` + `stroke-dashoffset` 애니메이션(Animation)
  - 두께(Width) = `log2(flowCount + 1)` — 1.5~4px
  - 초록 = FORWARDED, 빨강 = DROPPED

**인터랙션(Interaction):**
- **호버(Hover)**: 연결된 노드/엣지만 강조(Highlight), 나머지 dim 처리
- **클릭(Click)**: 특정 서비스 선택 → 관련 플로우만 하단 테이블에 필터링(Filtering)
- **배경 클릭(Background Click)**: 선택 해제(Deselect)

**데이터 소스(Data Source)** (`collectors/hubble.ts`):
```bash
kubectl exec -n kube-system deploy/hubble-relay -- \
  hubble observe --output json --last 200
```
JSON 라인 파싱(Line Parsing) → `TrafficFlow[]` → source/destination 별 `AggregatedEdge[]` 집계(Aggregation)

### 6.5 Scaling (`/scaling`)

**설계 패턴(Design Pattern): 시계열 데이터 저장소(Time-Series Data Store)** — 5초 간격 HPA 스냅샷(Snapshot)을 360개(30분) 링 버퍼(Ring Buffer)로 저장.

| 섹션(Section) | 내용(Content) |
|------|------|
| **HPA 상태 카드(Status Card)** | 배포(Deployment)별 현재/최대 레플리카(Replicas), CPU%, 스케일 바(Scale Bar), SCALING/AT MAX 뱃지(Badge) |
| **Pod Replica Count** | AreaChart (stepAfter) — 시간 축(Time Axis) Pod 수 추이(Trend), maxReplicas 기준선(Baseline) |
| **CPU Utilization** | LineChart — CPU 사용률(Utilization) 추이, targetCpuPercent 기준선 |
| **HPA Config 테이블(Table)** | 배포명(Deployment Name), min/max, target CPU, 현재 CPU, 현재 레플리카 |

### 6.6 Load Analysis (`/analysis`)

**설계 목적(Design Purpose):** 완료된 테스트 결과를 종합적으로 분석(Comprehensive Analysis)하는 대시보드 페이지.

| 섹션(Section) | 내용(Content) |
|------|------|
| **요약 통계(Summary Statistics)** | 총 테스트 수(Total Tests), 성공/실패율(Success/Failure Rate), 평균 응답 시간(Avg Response Time) |
| **지연시간 분포(Latency Distribution)** | p95/p99/평균(Avg) 지연시간(Latency) 비교 BarChart |
| **처리량 추이(Throughput Trend)** | RPS(Requests Per Second) 시계열 차트 |
| **에러율 분석(Error Rate Analysis)** | 테스트별 에러율(Error Rate) 비교 |
| **스케일링 상관관계(Scaling Correlation)** | 부하량(Load) 대비 HPA 레플리카(Replicas) 변화, 스케일업 지연시간(Scale-up Latency) |
| **상세 패널(Detail Panel)** | 개별 테스트 클릭 시 원시 출력(Raw Output) + 메트릭(Metrics) 상세 표시 |

---

## 7. 데이터 수집 방식(Data Collection)

### 7.1 수집 루프(Collection Loops) — collector.ts

4개 독립 수집 루프가 병렬 실행(Parallel Execution):

| 루프(Loop) | 간격(Interval) | 시작 지연(Start Delay) | 수집 내용(Collected Data) |
|------|------|-----------|-----------|
| Main | 5s | 0s | tart list → SSH resources → kubectl nodes/pods |
| Traffic | 10s | 3s | Hubble observe → flows + aggregated edges |
| Services | 30s | 5s | kubectl get svc/ep → ServiceInfo[] |
| Scaling | 5s | 2s | kubectl get hpa → HpaSnapshot[] |

### 7.2 SSH 커넥션 풀(Connection Pool)

- `ssh2` 라이브러리로 VM당 1개 영속 TCP 연결(Persistent TCP Connection) 유지
- 5초마다 새로 연결하지 않고 기존 연결 재사용(Reuse)
- 연결 끊기면 자동 재연결(Auto-reconnect)
- `Promise.allSettled`로 일부 VM 장애 시에도 나머지 데이터 수집

### 7.3 네트워크 트래픽 계산(Network Traffic Calculation)

```
prevReading = /proc/net/dev 이전 값 (cumulative bytes)
currReading = /proc/net/dev 현재 값
bytesPerSec = (currReading - prevReading) / elapsed_seconds
```

프론트엔드에서 최근 60개(5분) 데이터포인트(Data Points)를 `useRef` 링 버퍼(Ring Buffer)로 유지하여 스파크라인(SparkLine) 표시.

### 7.4 VM-Pod 매핑(Mapping) — TrafficPage

```
1. ClusterNode.internalIp → VmInfo.ip 매칭(Matching)
2. kNodeToVm Map 생성: K8s node name → VM name
3. Pod.nodeName → kNodeToVm → VM box 내부 배치(Placement)
4. 매칭 안 되는 Pod → "External" 박스
```

---

## 8. 타입 시스템(Type System)

`shared/types.ts`에 25+개 인터페이스(Interface)를 정의하여 프론트/백엔드 타입 안전성(Type Safety) 보장:

| 카테고리(Category) | 인터페이스(Interface) |
|----------|-----------|
| VM | `VmInfo`, `VmResources`, `PortInfo`, `NetworkStats` |
| K8s | `ClusterInfo`, `NodeInfo`, `PodInfo`, `ServiceInfo` |
| 테스트(Test) | `TestRun`, `TestResults`, `CustomLoadConfig`, `StressConfig`, `TestScenario` |
| 스케일링 테스트(Scaling Test) | `ScalingTestConfig`, `ScalingTestMeta` |
| 트래픽(Traffic) | `TrafficFlow`, `TrafficSummary`, `AggregatedEdge` |
| 스케일링(Scaling) | `HpaSnapshot`, `ScalingDataPoint` |
| 네트워크(Network) | `ConnectionInfo`, `NamespacePodCount` |
| 집계(Aggregation) | `DashboardSnapshot` — 루트 타입(Root Type) |

**주요 신규 타입(Key New Types):**

```typescript
// 스케일링 테스트 설정(Scaling Test Configuration) — CustomLoadConfig 확장(Extends)
interface ScalingTestConfig extends CustomLoadConfig {
  cooldownSec: number;              // 쿨다운 시간(Cooldown Duration) — 초(Seconds)
  targetDeployments?: string[];     // 관찰 대상 배포(Target Deployments)
}

// 스케일링 테스트 메타데이터(Scaling Test Metadata)
interface ScalingTestMeta {
  scalingSnapshots: ScalingDataPoint[];  // HPA 스냅샷 시계열(Time-series)
  testStartTimestamp: number;            // 테스트 시작(Test Start)
  testEndTimestamp: number;              // 테스트 종료(Test End)
  cooldownEndTimestamp: number;          // 쿨다운 종료(Cooldown End)
  scaleUpLatency: number | null;        // 스케일업 지연시간(Scale-up Latency) — ms
  peakReplicas: number;                 // 최대 레플리카(Peak Replicas)
  scaleDownStarted: number | null;      // 스케일다운 시작(Scale-down Start)
  avgRpsPerPod: number | null;          // Pod당 평균 RPS(Avg RPS per Pod)
  targetDeployments: string[];
}
```

---

## 9. 버그 기록(Bug Reports)

대시보드 개발 중 발견된 버그와 해결 과정은 별도 디렉토리에서 관리:

→ **[bug-reports/](bug-reports/)** 참조

주요 버그 요약(Key Bug Summary):
- Tailwind CSS 동적 클래스(Dynamic Class) JIT 컴파일(Compilation) 불가 → 정적 문자열(Static String) 사용
- 지속시간 파싱(Duration Parsing) NaN → `parseDurationSec()` 함수 추가 (s/m/h 접미사 처리)
- Vite 포트 충돌(Port Conflict) → `strictPort: true` 설정
- Istio 사이드카(Sidecar)가 Job 완료 방해 → `sidecar.istio.io/inject: "false"` 어노테이션(Annotation)
- CiliumNetworkPolicy가 k6 트래픽 차단(Block) → `sre-test: "true"` 라벨(Label) 기반 정책 자동 적용

---

## 10. 성능 고려사항(Performance Considerations)

| 항목(Item) | 설계(Design) |
|------|------|
| SSH 오버헤드(Overhead) | 커넥션 풀(Connection Pool)로 TCP 핸드셰이크(Handshake) 제거 — 10개 연결 × 5s = 초당 2회 재사용 |
| kubectl 호출(Invocation) | JSON 출력(`-o json`)으로 파싱 안정성(Parsing Stability) 확보, 4개 클러스터 병렬 호출(Parallel Invocation) |
| 프론트엔드 렌더링(Frontend Rendering) | `useMemo`로 SVG 레이아웃/엣지 계산 캐싱(Caching), `useCallback`으로 이벤트 핸들러(Event Handler) 안정화 |
| 메모리(Memory) | 스케일링 히스토리(Scaling History) 360포인트(30분) 링 버퍼, 네트워크 히스토리 60포인트(5분) 링 버퍼 |
| 번들 크기(Bundle Size) | Vite 코드 스플리팅(Code Splitting), Recharts 트리 셰이킹(Tree Shaking) — AreaChart, LineChart, BarChart만 import |
