# SRE 운영 대시보드 — 기술 문서

## 1. 개요

10개 Tart VM / 4개 K8s 클러스터를 운영하는 인프라의 SRE(Site Reliability Engineering) 대시보드.
실시간 리소스 모니터링, 부하/스트레스 테스트 실행, Cilium Hubble 기반 트래픽 가시성, HPA 오토스케일링 추이를 웹 브라우저에서 제공한다.

```bash
cd dashboard && npm install && npm run dev
# Frontend: http://localhost:3000  |  Backend: http://localhost:3001
```

---

## 2. 기술 스택

| 계층 | 기술 | 역할 |
|------|------|------|
| Frontend | React 19 + Vite 7 + TypeScript 5.9 | SPA, HMR 개발 환경 |
| Routing | react-router-dom v7 | 클라이언트 사이드 라우팅 (5개 페이지) |
| Styling | Tailwind CSS 4 | 유틸리티 기반 다크 테마 |
| Charts | Recharts 3 | AreaChart, LineChart, 게이지 |
| Backend | Express 5 + TypeScript | REST API (9개 엔드포인트) |
| SSH | ssh2 (npm) | VM 커넥션 풀 (10개 persistent 연결) |
| CLI | execa | tart, kubectl 명령 실행 |
| 런타임 | tsx (watch) | TS 직접 실행 + 핫리로드 |

---

## 3. 아키텍처

### 3.1 시스템 구조

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser (localhost:3000)                                       │
│                                                                 │
│  ┌──── Sidebar ────┐  ┌──── Content Area ─────────────────────┐│
│  │ Overview         │  │  <Routes>                             ││
│  │ Testing          │  │    /            → OverviewPage        ││
│  │ Traffic          │  │    /cluster/:n  → ClusterDetailPage   ││
│  │ Scaling          │  │    /testing     → TestingPage         ││
│  │                  │  │    /traffic     → TrafficPage         ││
│  │                  │  │    /scaling     → ScalingPage         ││
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

### 3.2 설계 원칙 (소프트웨어 공학 관점)

| 원칙 | 적용 |
|------|------|
| **관심사 분리 (Separation of Concerns)** | 수집기(collector), 파서(parser), API(index), UI(pages) 계층 분리 |
| **단일 책임 원칙 (SRP)** | 파일 하나가 하나의 역할만 수행 (예: `k6.ts`는 k6 출력 파싱만, `scaling.ts`는 HPA 수집만) |
| **캐시 패턴 (Cache-Aside)** | 수집기가 백그라운드에서 데이터를 캐시에 저장, API는 캐시만 조회 (비동기 분리) |
| **풀 기반 아키텍처 (Pull-based)** | 서버가 주기적으로 데이터를 풀링, 클라이언트도 5초 폴링 (양방향 풀) |
| **커넥션 풀 (Connection Pool)** | SSH 연결을 VM당 1개 유지, 매 수집마다 재사용 |
| **Graceful Degradation** | `Promise.allSettled`로 일부 VM/클러스터 장애 시에도 나머지 데이터 수집 |
| **타입 안전성 (Type Safety)** | `shared/types.ts`로 프론트/백엔드 25개 인터페이스 공유, 컴파일 타임 검증 |

---

## 4. 프로젝트 구조

```
dashboard/
├── package.json                    # 의존성 + scripts (dev, build, preview)
├── vite.config.ts                  # Vite + Tailwind + API proxy + strictPort
├── tsconfig.json                   # TypeScript 설정 (verbatimModuleSyntax)
├── index.html                      # SPA 엔트리
│
├── shared/
│   └── types.ts                    # 프론트/백엔드 공유 타입 (25개 인터페이스)
│
├── server/
│   ├── index.ts                    # Express 서버 (9개 API 엔드포인트)
│   ├── config.ts                   # clusters.json 파싱, kubeconfig 경로
│   ├── collector.ts                # 4개 백그라운드 수집 루프 관리
│   ├── jobs.ts                     # K8s Job 라이프사이클 (생성→감시→수집→파싱→CSV)
│   │
│   ├── collectors/
│   │   ├── tart.ts                 # tart list/ip 실행 → VmInfo[]
│   │   ├── ssh.ts                  # ssh2 커넥션 풀 (VM당 1 persistent 연결)
│   │   ├── kubectl.ts              # kubectl get nodes/pods -o json
│   │   ├── hubble.ts               # Hubble observe → TrafficFlow[] + AggregatedEdge[]
│   │   ├── services.ts             # kubectl get svc/endpoints → ServiceInfo[]
│   │   └── scaling.ts              # kubectl get hpa → HpaSnapshot[] (360개 링 버퍼)
│   │
│   └── parsers/
│       ├── top.ts                  # CPU% 파싱 (top -bn1)
│       ├── free.ts                 # 메모리 파싱 (free -m)
│       ├── df.ts                   # 디스크 파싱 (df)
│       ├── ss.ts                   # 포트 파싱 (ss -tlnp)
│       ├── netdev.ts               # 네트워크 파싱 (/proc/net/dev → bytes/sec)
│       ├── k6.ts                   # k6 출력 → p95/p99/avgLatency/errorRate/RPS
│       └── stress-ng.ts            # stress-ng metrics-brief → bogo-ops
│
└── src/
    ├── main.tsx                    # 엔트리 (BrowserRouter 래핑)
    ├── App.tsx                     # 라우터 + 폴링 + 네트워크 히스토리
    │
    ├── hooks/
    │   └── usePolling.ts           # 범용 폴링 훅 (interval, raw 모드)
    │
    ├── pages/
    │   ├── OverviewPage.tsx        # 4개 클러스터 2×2 요약
    │   ├── ClusterDetailPage.tsx   # 개별 클러스터 상세
    │   ├── TestingPage.tsx         # 10개 프리셋 + 커스텀 테스트 + CSV
    │   ├── TrafficPage.tsx         # SVG 토폴로지 (VM 고정, Pod 내부 배치)
    │   └── ScalingPage.tsx         # HPA 상태 + 시계열 차트
    │
    ├── components/
    │   ├── layout/
    │   │   ├── AppShell.tsx        # Sidebar + Header + Content 레이아웃
    │   │   ├── Sidebar.tsx         # 세로 내비게이션 (4개 링크, SVG 아이콘)
    │   │   ├── Header.tsx          # 상단바 (상태, 에러수, 타임스탬프)
    │   │   └── MainLayout.tsx      # 레거시 (호환용)
    │   ├── cluster/                # ClusterCard, NodeCard
    │   ├── vm/                     # VmResourceGauges, VmPortList, VmNetworkStats
    │   ├── pod/                    # PodTable
    │   └── common/                 # StatusDot, GaugeChart, SparkLine
    │
    └── styles/
        └── globals.css             # 다크 테마 + flow-edge-animated 애니메이션
```

---

## 5. API 엔드포인트

| Method | Path | 설명 | 폴링 간격 |
|--------|------|------|-----------|
| GET | `/api/health` | 서버 상태 확인 | — |
| GET | `/api/snapshot` | 전체 인프라 스냅샷 (VM/리소스/포트/네트워크/클러스터/Pod) | 5s |
| GET | `/api/traffic?cluster=X` | Hubble 트래픽 플로우 + 집계 엣지 | 5s |
| GET | `/api/cluster/:name/services` | K8s 서비스 + 엔드포인트 목록 | — |
| POST | `/api/tests/run` | 테스트 실행 `{type, cluster, config?, stressConfig?, scenarioName?}` | — |
| GET | `/api/tests/status` | 전체 테스트 상태 목록 | 3s |
| DELETE | `/api/tests/:id` | 테스트 취소 + K8s Job/ConfigMap 삭제 | — |
| GET | `/api/tests/export` | 완료된 테스트 결과 CSV 다운로드 | — |
| GET | `/api/scaling?cluster=X` | HPA 스케일링 히스토리 (시계열) | 3s |

### 5.1 `/api/snapshot` 응답 구조

```typescript
{
  data: {
    vms: VmInfo[];                           // 10개 VM 상태/IP/specs
    vmResources: Record<string, VmResources>; // VM별 CPU/MEM/DISK %
    vmPorts: Record<string, PortInfo[]>;      // VM별 열린 포트
    vmNetwork: Record<string, NetworkStats>;  // VM별 RX/TX bytes/sec
    clusters: ClusterInfo[];                  // 4개 클러스터 노드 상태
    clusterPods: Record<string, PodInfo[]>;   // 클러스터별 Pod 목록
    collectedAt: number;                      // 수집 시각 (Unix ms)
    errors: { source: string; message: string }[];
  },
  timestamp: number,
  stale: boolean
}
```

### 5.2 `/api/traffic` 응답 구조

```typescript
{
  flows: TrafficFlow[];        // 최근 200개 개별 플로우
  aggregated: AggregatedEdge[]; // source/destination 쌍별 집계
  collectedAt: number;
  cluster: string;
}
```

### 5.3 `/api/tests/export` CSV 컬럼 (23개)

```
id, type, scenario, cluster, status, started_at, completed_at, duration_sec,
vus, load_duration, target_url, stress_workers, stress_timeout, stress_vm_bytes,
p95_latency_ms, p99_latency_ms, avg_latency_ms, error_rate, rps, total_requests,
cpu_bogo_ops, memory_bogo_ops, error
```

---

## 6. 페이지별 상세

### 6.1 Overview (`/`)

4개 클러스터를 2×2 그리드로 요약. 각 카드에 노드 수, Pod 상태별 카운트(Running/Pending/Failed), 평균 CPU/RAM 표시.
카드 클릭 시 `/cluster/:name`으로 이동.

### 6.2 Cluster Detail (`/cluster/:name`)

개별 클러스터의 노드 카드 목록. 각 노드를 클릭하면 확장되어:
- CPU/Memory/Disk 원형 게이지 (70%↑노랑, 90%↑빨강)
- RX/TX 네트워크 스파크라인
- 열린 포트 테이블 (포트, 바인드 주소, 프로세스명)
- Pod 목록 테이블 (이름, 네임스페이스, 상태, 재시작 횟수, Age)

### 6.3 Testing (`/testing`)

**설계 패턴: Strategy Pattern** — 테스트 타입(load/stress-cpu/stress-memory)에 따라 다른 Job YAML을 생성하는 전략 패턴 적용.

| 탭 | 기능 |
|----|------|
| **Scenarios** | 10개 프리셋 시나리오 카드, 클릭으로 즉시 실행 |
| **Custom** | VUs, Duration, Target URL, Ramp-up, p95 Threshold, Workers, Timeout, VM Bytes 커스텀 입력 |

**백엔드 Job 라이프사이클** (`jobs.ts`):

```
POST /api/tests/run
  ↓
1. YAML 생성 (k6 ConfigMap + Job 또는 stress-ng Job)
2. CiliumNetworkPolicy 자동 적용 (sre-test: "true" 라벨)
3. kubectl apply -f - (Job 생성)
4. 2초 간격 폴링 시작 (kubectl get pods -l job-name=ID)
  ↓
Pod Pending → Running → Succeeded/Failed
  ↓
5. kubectl logs 수집 → k6/stress-ng 파서로 메트릭 추출
6. TestRun 상태 업데이트 (completed/failed + results)
7. ConfigMap 자동 삭제
```

**k6 부하 테스트 옵션:**
- **고정 VU**: `vus: N, duration: 'Xs'`
- **Ramp-up**: `stages: [{ duration: ramp, target: vus }, { duration: sustain, target: vus }, { duration: ramp, target: 0 }]`
- **임계값**: `thresholds: { http_req_duration: ['p(95)<N'], http_req_failed: ['rate<N'] }`

**Istio 사이드카 우회**: Job Pod에 `sidecar.istio.io/inject: "false"` 어노테이션을 설정하여 Istio 사이드카 주입을 방지. 사이드카가 있으면 Job이 종료되지 않는 문제 해결.

### 6.4 Traffic (`/traffic`)

**설계 패턴: Composite Pattern** — VM 안에 Pod를 포함하는 계층적 구조.

**레이아웃 계산 과정:**

```
1. clusterVms + clusterNodes의 IP 주소를 매칭하여 K8s node → VM 매핑
2. 각 Pod의 nodeName으로 해당 VM에 배치
3. Pod를 service 단위로 그룹핑 (ReplicaSet 해시 접미사 제거)
4. VM 박스를 수평 배치 (master 우선)
5. Pod를 VM 박스 내부에 그리드로 배치
```

**SVG 렌더링:**
- **VM 박스**: 둥근 사각형. master=보라 테두리, worker=파랑, external=회색
- **Pod 노드**: 원(circle), 네임스페이스별 색상 (`kube-system=파랑, demo=초록, monitoring=보라, argocd=주황`)
- **트래픽 엣지**: Quadratic Bezier 곡선, CSS `stroke-dasharray` + `stroke-dashoffset` 애니메이션
  - 두께 = `log2(flowCount + 1)` (1.5~4px)
  - 초록 = FORWARDED, 빨강 = DROPPED

**인터랙션:**
- **호버**: 연결된 노드/엣지만 강조, 나머지 dim 처리
- **클릭**: 특정 서비스 선택 → 관련 플로우만 하단 테이블에 필터링
- **배경 클릭**: 선택 해제

**데이터 소스** (`collectors/hubble.ts`):
```bash
kubectl exec -n kube-system deploy/hubble-relay -- \
  hubble observe --output json --last 200
```
JSON 라인 파싱 → `TrafficFlow[]` → source/destination 별 `AggregatedEdge[]` 집계

### 6.5 Scaling (`/scaling`)

**설계 패턴: Time-Series Data Store** — 5초 간격 HPA 스냅샷을 360개(30분) 링 버퍼로 저장.

| 섹션 | 내용 |
|------|------|
| **HPA 상태 카드** | 배포별 현재/최대 레플리카, CPU%, 스케일 바, SCALING/AT MAX 뱃지 |
| **Pod Replica Count** | AreaChart (stepAfter) — 시간 축 Pod 수 추이, maxReplicas 기준선 |
| **CPU Utilization** | LineChart — CPU 사용률 추이, targetCpuPercent 기준선 |
| **HPA Config 테이블** | 배포명, min/max, target CPU, 현재 CPU, 현재 레플리카 |

---

## 7. 데이터 수집 방식

### 7.1 수집 루프 (collector.ts)

4개 독립 수집 루프가 병렬 실행:

| 루프 | 간격 | 시작 지연 | 수집 내용 |
|------|------|-----------|-----------|
| Main | 5s | 0s | tart list → SSH resources → kubectl nodes/pods |
| Traffic | 10s | 3s | Hubble observe → flows + aggregated edges |
| Services | 30s | 5s | kubectl get svc/ep → ServiceInfo[] |
| Scaling | 5s | 2s | kubectl get hpa → HpaSnapshot[] |

### 7.2 SSH 커넥션 풀

- `ssh2` 라이브러리로 VM당 1개 persistent TCP 연결 유지
- 5초마다 새로 연결하지 않고 기존 연결 재사용
- 연결 끊기면 자동 재연결
- `Promise.allSettled`로 일부 VM 장애 시에도 나머지 데이터 수집

### 7.3 네트워크 트래픽 계산

```
prevReading = /proc/net/dev 이전 값 (cumulative bytes)
currReading = /proc/net/dev 현재 값
bytesPerSec = (currReading - prevReading) / elapsed_seconds
```

프론트엔드에서 최근 60개(5분) 데이터포인트를 `useRef` 링 버퍼로 유지하여 스파크라인 표시.

### 7.4 VM-Pod 매핑 (TrafficPage)

```
1. ClusterNode.internalIp → VmInfo.ip 매칭
2. kNodeToVm Map 생성: K8s node name → VM name
3. Pod.nodeName → kNodeToVm → VM box 내부 배치
4. 매칭 안 되는 Pod → "External" 박스
```

---

## 8. 타입 시스템

`shared/types.ts`에 25개 인터페이스를 정의하여 프론트/백엔드 타입 안전성 보장:

| 카테고리 | 인터페이스 |
|----------|-----------|
| VM | `VmInfo`, `VmResources`, `PortInfo`, `NetworkStats` |
| K8s | `ClusterInfo`, `NodeInfo`, `PodInfo`, `ServiceInfo` |
| 테스트 | `TestRun`, `TestResults`, `CustomLoadConfig`, `StressConfig`, `TestScenario` |
| 트래픽 | `TrafficFlow`, `TrafficSummary`, `AggregatedEdge` |
| 스케일링 | `HpaSnapshot`, `ScalingDataPoint` |
| 네트워크 | `ConnectionInfo`, `NamespacePodCount` |
| 집계 | `DashboardSnapshot` (루트 타입) |

---

## 9. 발견한 버그 및 해결

### BUG: Tailwind CSS 동적 클래스 컴파일 불가

- **원인**: `bg-${status.bg}/10` 형태로 런타임에 생성되는 클래스는 Tailwind의 JIT 컴파일러가 감지 불가
- **해결**: `bgClass: 'bg-blue-400/10'` 형태로 전체 정적 문자열 사용

### BUG: 지속시간 파싱 NaN

- **원인**: `parseInt('1m')` → `NaN` (숫자가 아닌 접미사)
- **해결**: `parseDurationSec()` 함수 추가 — s/m/h 접미사 처리

### BUG: Vite 포트 충돌

- **원인**: 좀비 프로세스가 3000 포트 점유 → Vite가 3001로 폴백 → Express와 충돌
- **해결**: `vite.config.ts`에 `strictPort: true` 설정

### BUG: Istio 사이드카가 Job 완료 방해

- **원인**: Istio 사이드카가 주입되면 Job Pod이 종료 불가 (사이드카는 계속 실행)
- **해결**: Job Pod에 `sidecar.istio.io/inject: "false"` 어노테이션

### BUG: CiliumNetworkPolicy가 k6 트래픽 차단

- **원인**: demo 네임스페이스의 `default-deny` 정책이 k6 Pod의 egress 차단
- **해결**: `sre-test: "true"` 라벨 기반 CiliumNetworkPolicy 자동 적용 (full egress + ingress)

---

## 10. 성능 고려사항

| 항목 | 설계 |
|------|------|
| SSH 오버헤드 | 커넥션 풀로 TCP 핸드셰이크 제거 (10개 연결 × 5s = 초당 2회 재사용) |
| kubectl 호출 | JSON 출력(`-o json`)으로 파싱 안정성 확보, 4개 클러스터 병렬 호출 |
| 프론트엔드 렌더링 | `useMemo`로 SVG 레이아웃/엣지 계산 캐싱, `useCallback`으로 이벤트 핸들러 안정화 |
| 메모리 | 스케일링 히스토리 360포인트(30분) 링 버퍼, 네트워크 히스토리 60포인트(5분) 링 버퍼 |
| 번들 크기 | Vite 코드 스플리팅, Recharts tree-shaking (AreaChart, LineChart만 import) |
