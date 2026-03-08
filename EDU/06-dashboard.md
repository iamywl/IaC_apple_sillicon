# 06. SRE 대시보드 - React + Express

## 기술 스택

| 계층 | 기술 | 버전 |
|------|------|------|
| 프론트엔드 | React + TypeScript | React 19 |
| 스타일링 | Tailwind CSS | v4 |
| 차트 | Recharts | v3 |
| 라우팅 | react-router-dom | v6 |
| 빌드 | Vite | v7 |
| 백엔드 | Express + TypeScript | Express 5 |
| SSH | ssh2 (npm) | - |
| 쉘 실행 | execa (npm) | - |

## 실행 방법

```bash
cd dashboard
npm install
npm run dev    # 프론트엔드 (3000) + 백엔드 (3001) 동시 실행
```

## 백엔드 구조 (dashboard/server/)

### 진입점: server/index.ts

Express 앱을 생성하고 9개 API 엔드포인트를 등록합니다.

```typescript
// API 엔드포인트 목록
GET  /api/health              // 서버 상태 확인
GET  /api/snapshot            // 전체 인프라 스냅샷 (VM, 노드, Pod)
GET  /api/traffic/all         // 전체 클러스터 트래픽 요약
GET  /api/traffic?cluster=X   // 특정 클러스터 Hubble 플로우
GET  /api/cluster/:name/services  // K8s 서비스 + 엔드포인트
POST /api/tests/run           // 테스트 실행
GET  /api/tests/status        // 테스트 상태 조회
DELETE /api/tests/:id         // 테스트 취소
GET  /api/scaling/:cluster    // HPA 시계열 히스토리
```

### 데이터 수집: server/collector.ts

5초마다 모든 VM과 클러스터에서 데이터를 수집합니다.

```typescript
// 메인 수집 루프 (5초 간격)
setInterval(async () => {
    // 1. Tart VM 목록 + 상태
    await tart.collect();       // tart list → VM 이름, 상태, IP

    // 2. SSH로 각 VM 리소스 수집
    await ssh.collect();        // top → CPU%, free → 메모리%, df → 디스크%
                                // ss → 포트, /proc/net/dev → 네트워크

    // 3. kubectl로 K8s 상태 수집
    await kubectl.collect();    // nodes, pods 상태
}, 5000);

// 트래픽 수집 루프 (10초 간격)
setInterval(() => hubble.collect(), 10000);

// 스케일링 수집 루프 (5초 간격)
setInterval(() => scaling.collect(), 5000);

// 서비스 수집 루프 (30초 간격)
setInterval(() => services.collect(), 30000);
```

### Collectors (server/collectors/)

각 수집기가 담당하는 데이터:

| 파일 | 수집 명령 | 데이터 |
|------|----------|--------|
| `tart.ts` | `tart list` | VM 이름, 상태(running/stopped), IP |
| `ssh.ts` | SSH로 시스템 명령 | CPU%, 메모리%, 디스크%, 포트, 네트워크 |
| `kubectl.ts` | `kubectl get nodes/pods` | 노드 상태, Pod 상태/리소스 |
| `hubble.ts` | `hubble observe --output json` | 네트워크 플로우 (source→dest, verdict) |
| `scaling.ts` | `kubectl get hpa` | HPA 현재/목표 레플리카, CPU% |
| `services.ts` | `kubectl get svc/endpoints` | 서비스 타입, IP, 포트, 백엔드 Pod |

### Parsers (server/parsers/)

SSH로 받은 텍스트 출력을 구조화된 데이터로 변환합니다.

| 파일 | 입력 | 출력 |
|------|------|------|
| `top.ts` | `top -bn1` 출력 | `{ cpuPercent: 45.2 }` |
| `free.ts` | `free -m` 출력 | `{ memoryPercent: 62.1, totalMB: 4096, usedMB: 2543 }` |
| `df.ts` | `df /` 출력 | `{ diskPercent: 35, totalGB: 20, usedGB: 7 }` |
| `ss.ts` | `ss -tlnp` 출력 | `[{ port: 80, address: "0.0.0.0", process: "nginx" }]` |
| `netdev.ts` | `/proc/net/dev` 내용 | `{ rxBytes: 12345, txBytes: 67890 }` |
| `k6.ts` | k6 JSON 출력 | `{ p95: 120, p99: 250, rps: 1500, errorRate: 0.1 }` |
| `stress-ng.ts` | stress-ng 출력 | `{ bogoOps: 45000, duration: 30 }` |

### 테스트 실행: server/jobs.ts

부하 테스트와 스트레스 테스트를 K8s Job으로 실행합니다.

```typescript
// 테스트 실행 흐름
1. POST /api/tests/run 요청 수신
2. TestRun 객체 생성 (id, type, config, status="pending")
3. K8s Job YAML 생성 (k6-loadtest 또는 stress-test 템플릿)
4. kubectl apply -f 로 Job 적용
5. Job 상태 폴링 (pending → running → complete/failed)
6. 완료 시 k6.ts 또는 stress-ng.ts 파서로 결과 추출
7. TestRun.results에 저장
8. CSV 내보내기 가능
```

## 프론트엔드 구조 (dashboard/src/)

### 라우팅: App.tsx

```typescript
<Routes>
  <Route path="/"                element={<OverviewPage />} />
  <Route path="/cluster/:name"   element={<ClusterDetailPage />} />
  <Route path="/testing"         element={<TestingPage />} />
  <Route path="/traffic"         element={<TrafficPage />} />
  <Route path="/scaling"         element={<ScalingPage />} />
  <Route path="/analysis"        element={<LoadAnalysisPage />} />
</Routes>
```

### 6개 페이지 설명

#### 1. OverviewPage (/)
- 4개 클러스터를 2×2 그리드로 표시
- 각 카드: 노드 수, Pod 상태 배지(Running/Pending/Failed), CPU/RAM 바
- 네임스페이스별 Pod 수 테이블

#### 2. ClusterDetailPage (/cluster/:name)
- 노드별 게이지: CPU, 메모리, 디스크 사용률
- RX/TX 네트워크 스파크라인 (10포인트 히스토리)
- 열린 포트 테이블 (포트, 주소, 프로세스, 상태)
- Pod 목록 (리소스 requests/limits 포함)

#### 3. TestingPage (/testing)
- 13개 프리셋 시나리오 + 커스텀 테스트 빌더
- 프리셋 예시:
  - Light Load: 10 VUs, 15초
  - Standard Load: 50 VUs, 30초
  - Heavy Load: 200 VUs, 60초
  - CPU Stress: 1~2 worker, 30~60초
  - Memory Stress: 64M~128M, 30~60초
- 결과: p95/p99 지연시간, RPS, 에러율, CSV 내보내기

#### 4. TrafficPage (/traffic)
- 전체 보기: 클러스터별 트래픽 요약 (플로우 수, 프로토콜 분포)
- 단일 클러스터: SVG 토폴로지 다이어그램
  - 네임스페이스 그룹 → Pod 노드 → 베지어 커브 엣지
  - 초록선 = FORWARDED (허용), 빨간선 = DROPPED (차단)

#### 5. ScalingPage (/scaling)
- HPA 상태 카드: 현재/목표 레플리카, min/max, CPU%
- Pod 레플리카 시계열 (AreaChart, step interpolation)
- CPU 사용률 vs 목표 기준선

#### 6. LoadAnalysisPage (/analysis)
- 테스트 선택 → KPI 요약 (스케일업 지연, 피크 레플리카, RPS/Pod)
- Pod 스케일링 타임라인
- 처리량 vs Pod 수 (이중 Y축)
- Pod별 효율성 (RPS/Pod)

### 공유 타입: shared/types.ts

프론트엔드와 백엔드가 공유하는 TypeScript 인터페이스 25개 이상이 정의되어 있습니다.

```typescript
// 주요 타입 예시
interface VmInfo { name: string; status: string; ip: string; }
interface NodeResources { cpu: number; memory: number; disk: number; }
interface PodInfo { name: string; namespace: string; status: string; ... }
interface HubbleFlow { source: string; dest: string; verdict: string; ... }
interface TestRun { id: string; type: string; status: string; results?: TestResults; }
```

### 컴포넌트 구조

```
src/components/
  ├── layout/
  │   ├── AppShell.tsx      ← 전체 레이아웃 (사이드바 + 메인)
  │   ├── Sidebar.tsx       ← 좌측 네비게이션
  │   ├── Header.tsx        ← 상단 바
  │   └── MainLayout.tsx    ← 메인 콘텐츠 영역
  ├── cluster/
  │   ├── ClusterCard.tsx   ← Overview 페이지의 클러스터 카드
  │   └── NodeCard.tsx      ← 노드 상세 카드
  ├── common/
  │   ├── GaugeChart.tsx    ← 원형 게이지 (CPU, 메모리, 디스크)
  │   ├── SparkLine.tsx     ← 미니 라인 차트 (네트워크)
  │   └── StatusDot.tsx     ← 상태 표시 점 (녹색/빨간색)
  ├── pod/
  │   └── PodTable.tsx      ← Pod 목록 테이블
  └── vm/
      ├── VmResourceGauges.tsx  ← VM 리소스 게이지 묶음
      ├── VmNetworkStats.tsx    ← VM 네트워크 통계
      └── VmPortList.tsx        ← VM 포트 목록
```

### 데이터 폴링: hooks/usePolling.ts

```typescript
// 커스텀 훅: 지정된 간격으로 API 호출
function usePolling<T>(url: string, interval: number): T | null {
    const [data, setData] = useState<T | null>(null);
    useEffect(() => {
        const timer = setInterval(async () => {
            const res = await fetch(url);
            setData(await res.json());
        }, interval);
        return () => clearInterval(timer);
    }, [url, interval]);
    return data;
}

// 사용 예
const snapshot = usePolling<Snapshot>('/api/snapshot', 5000);
```

## Vite 설정: vite.config.ts

```typescript
export default defineConfig({
    server: {
        proxy: {
            '/api': 'http://localhost:3001'  // API 요청을 백엔드로 프록시
        }
    }
});
```

## 대시보드 수정 가이드

| 하고 싶은 것 | 수정할 파일 |
|-------------|-----------|
| 새 API 엔드포인트 추가 | `server/index.ts` |
| 새 데이터 수집기 추가 | `server/collectors/`에 파일 추가 + `collector.ts`에 등록 |
| 새 파서 추가 | `server/parsers/`에 파일 추가 |
| 새 페이지 추가 | `src/pages/`에 파일 + `App.tsx`에 Route + `Sidebar.tsx`에 링크 |
| 새 컴포넌트 추가 | `src/components/`에 파일 추가 |
| 폴링 간격 변경 | `server/collector.ts`의 setInterval 값 |
| 타입 추가 | `shared/types.ts` |
