# Tart Infra Dashboard - 상세 문서

## 개요

VM 인프라 전체를 실시간으로 시각화하는 웹 대시보드. macOS 호스트에서 직접 실행하며 10개 VM의 리소스, 네트워크, Pod 상태를 5초 간격으로 수집/표시한다.

## 기술 스택

| 구분 | 기술 | 용도 |
|------|------|------|
| Frontend | React 19 + Vite 7 + TypeScript | SPA UI |
| Styling | Tailwind CSS 4 | 다크 테마 UI |
| Charts | Recharts | 게이지, 스파크라인 |
| Backend | Express 5 + TypeScript | REST API 서버 |
| SSH | ssh2 (npm) | VM 커넥션 풀 + 명령 실행 |
| CLI 실행 | execa | tart, kubectl 명령 실행 |
| 런타임 | tsx (watch) | TS 직접 실행 + 핫리로드 |

## 아키텍처

```
┌─────────────────────────────────────────────────┐
│  Browser (localhost:3000)                       │
│  React App ← usePolling('/api/snapshot', 5s)    │
└───────────────┬─────────────────────────────────┘
                │ HTTP (Vite proxy)
┌───────────────▼─────────────────────────────────┐
│  Express Server (localhost:3001)                 │
│                                                  │
│  ┌── Background Collector (5s interval) ──────┐ │
│  │                                             │ │
│  │  1. tart list → VM 목록/상태               │ │
│  │  2. tart ip <vm> → IP 확인                 │ │
│  │  3. SSH (ssh2 pool) → 리소스/포트/네트워크  │ │
│  │  4. kubectl → 노드/Pod 정보               │ │
│  │                                             │ │
│  │  → 메모리 캐시 (DashboardSnapshot)          │ │
│  └─────────────────────────────────────────────┘ │
│                                                  │
│  GET /api/snapshot → 캐시된 스냅샷 반환          │
└──────────────────────────────────────────────────┘
         │              │              │
    ┌────▼────┐   ┌────▼────┐   ┌────▼────┐
    │ tart CLI│   │ SSH x10 │   │kubectl x4│
    └─────────┘   └─────────┘   └──────────┘
```

## 프로젝트 구조

```
dashboard/
├── package.json              # 의존성 + scripts
├── vite.config.ts            # Vite + Tailwind + API proxy
├── index.html
├── server/
│   ├── index.ts              # Express 서버 (port 3001)
│   ├── config.ts             # clusters.json 파싱, 경로 설정
│   ├── collector.ts          # 5초 백그라운드 수집 루프
│   ├── collectors/
│   │   ├── tart.ts           # tart list/ip 실행 및 파싱
│   │   ├── ssh.ts            # ssh2 커넥션 풀 (VM당 1 연결 유지)
│   │   └── kubectl.ts        # kubectl get nodes/pods -o json
│   └── parsers/
│       ├── top.ts            # CPU% 파싱 (top -bn1)
│       ├── free.ts           # 메모리 파싱 (free -m)
│       ├── df.ts             # 디스크 파싱 (df)
│       ├── ss.ts             # 포트 파싱 (ss -tlnp)
│       └── netdev.ts         # 네트워크 파싱 (/proc/net/dev)
├── src/
│   ├── main.tsx              # 엔트리포인트
│   ├── App.tsx               # 메인 컴포넌트 (폴링 + 레이아웃)
│   ├── hooks/
│   │   └── usePolling.ts     # 범용 5초 폴링 훅
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Header.tsx    # 상단바 (상태, 에러수, 마지막 업데이트)
│   │   │   └── MainLayout.tsx
│   │   ├── cluster/
│   │   │   ├── ClusterCard.tsx  # 클러스터 카드 (노드/Pod 집계)
│   │   │   └── NodeCard.tsx     # 노드 카드 (확장식: 리소스/포트/네트워크/Pod)
│   │   ├── vm/
│   │   │   ├── VmResourceGauges.tsx  # CPU/MEM/DISK 원형 게이지
│   │   │   ├── VmPortList.tsx        # 열린 포트 테이블
│   │   │   └── VmNetworkStats.tsx    # RX/TX 스파크라인
│   │   ├── pod/
│   │   │   └── PodTable.tsx          # Pod 목록 테이블
│   │   └── common/
│   │       ├── StatusDot.tsx    # 상태 표시등
│   │       ├── GaugeChart.tsx   # SVG 원형 게이지
│   │       └── SparkLine.tsx    # 미니 라인 차트
│   └── styles/
│       └── globals.css       # 다크 테마 CSS
└── shared/
    └── types.ts              # 프론트/백엔드 공유 타입
```

## API

### `GET /api/health`
서버 상태 확인.

### `GET /api/snapshot`
전체 인프라 스냅샷을 반환. 프론트엔드는 이 endpoint 하나만 호출한다.

응답 구조:
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

## 데이터 수집 방식

| 데이터 | 수집 방법 | 명령 |
|--------|-----------|------|
| VM 목록/상태 | tart CLI | `tart list` |
| VM IP | tart CLI | `tart ip <vm>` |
| CPU 사용률 | SSH → 파싱 | `top -bn1 \| head -5` |
| 메모리 사용률 | SSH → 파싱 | `free -m` |
| 디스크 사용률 | SSH → 파싱 | `df / --output=size,used,avail,pcent \| tail -1` |
| 열린 포트 | SSH → 파싱 | `sudo ss -tlnp` |
| 네트워크 트래픽 | SSH → 파싱 | `cat /proc/net/dev` |
| K8s 노드 상태 | kubectl | `kubectl get nodes -o json` |
| K8s Pod 목록 | kubectl | `kubectl get pods -A -o json` |

### SSH 커넥션 풀
- `ssh2` 라이브러리로 VM당 1개 persistent TCP 연결 유지
- 5초마다 새로 연결하지 않고 기존 연결 재사용
- 연결 끊기면 자동 재연결
- `Promise.allSettled`로 일부 VM 장애 시에도 나머지 데이터 수집

### 네트워크 트래픽 계산
- `/proc/net/dev`에서 cumulative RX/TX bytes 읽기
- 이전 readings과의 차이를 시간으로 나눠 bytes/sec 계산
- 프론트엔드에서 최근 60개(5분) 데이터포인트를 링 버퍼로 유지하여 스파크라인 표시

## 실행 방법

```bash
cd dashboard
npm install
npm run dev
# Frontend: http://localhost:3000
# Backend:  http://localhost:3001
```

## 대시보드 UI 구성

### 헤더
- 연결 상태 (healthy/degraded/down)
- 에러 카운트
- 마지막 업데이트 시각
- 폴링 간격 표시

### 클러스터 카드 (platform / dev / staging / prod)
- 클러스터명, Pod/Service CIDR
- Ready 노드 수 / 전체 노드 수
- Running Pod 수 / 전체 Pod 수
- 색상 구분: platform=보라, dev=파랑, staging=초록, prod=빨강

### 노드 카드 (클릭하여 확장)
- VM 이름, 상태, IP, 할당 리소스 (CPU/RAM/DISK)
- 축약 보기: CPU%, MEM%, Pod 수
- 확장 시:
  - **Resources**: CPU/Memory/Disk 원형 게이지 (70%↑노랑, 90%↑빨강)
  - **Network Traffic**: RX/TX bytes/sec + 스파크라인
  - **Open Ports**: 포트 번호, 바인드 주소, 프로세스명
  - **Pods**: 이름, 네임스페이스, 상태, 재시작 횟수, Age

## 발견한 버그 및 수정

### BUG: common.sh SCRIPT_DIR 충돌
- **원인**: `common.sh`에서 `SCRIPT_DIR` 변수를 재정의하여 `boot.sh`의 `SCRIPT_DIR`을 덮어씀
- **증상**: `boot.sh` 실행 시 `scripts/lib/boot/01-start-vms.sh: No such file or directory`
- **해결**: `common.sh`의 변수명을 `_COMMON_DIR`로 변경

### BUG: ESM 환경에서 __dirname 미정의
- **원인**: `package.json`의 `"type": "module"` 설정으로 ESM 모드인데 `__dirname` 사용
- **해결**: `import.meta.url` + `fileURLToPath`로 대체

### BUG: tart list 파싱 오류
- **원인**: `tart list` 출력 컬럼이 예상과 다름 (Source Name Disk Size Accessed State)
- **증상**: VM status가 `"20"` (disk 값)으로 잘못 파싱
- **해결**: State가 항상 마지막 컬럼임을 이용하여 `parts[parts.length - 1]`로 수정
