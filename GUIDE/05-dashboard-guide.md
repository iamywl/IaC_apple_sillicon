# 재연 가이드 05. SRE 대시보드

이 장에서는 SRE 대시보드의 아키텍처, 실행 방법, 각 페이지의 기능, API 엔드포인트, 부하 테스트 실행 방법을 설명한다.


## 1. 대시보드 아키텍처

SRE 대시보드는 `dashboard/` 디렉토리에 위치한다. 프론트엔드와 백엔드가 하나의 프로젝트에 포함된 모노리포 구조이다.

### 1.1 기술 스택

| 구성 요소 | 기술 | 포트 |
|---|---|---|
| Frontend | React 19 + Vite 7 + Tailwind CSS 4 + Recharts 3 | 5173 |
| Backend | Express 5 + TypeScript (tsx) | 3001 |
| 라우팅 | React Router 7 | - |
| 차트 | Recharts 3 | - |
| SSH 연결 | ssh2 라이브러리 | - |
| 프로세스 실행 | execa | - |

### 1.2 데이터 수집 구조

백엔드 서버는 여러 수집기(collector)를 주기적으로 실행하여 인프라 상태를 수집한다.

| 수집 대상 | 방법 | 주기 | 소스 파일 |
|---|---|---|---|
| VM 상태 (CPU, 메모리, 디스크, 네트워크) | SSH (ssh2) + `top`, `free`, `df`, `/proc/net/dev` | 5초 | `server/collectors/tart.ts`, `server/collectors/ssh.ts` |
| 클러스터 노드/Pod 정보 | `kubectl` (kubeconfig 파일 사용) | 5초 | `server/collectors/kubectl.ts` |
| Hubble 네트워크 트래픽 | `kubectl exec cilium -- hubble observe` | 10초 | `server/collectors/hubble.ts` |
| 서비스 목록 | `kubectl get svc` | 30초 | `server/collectors/services.ts` |
| HPA 스케일링 이력 | `kubectl get hpa` | 5초 | `server/collectors/scaling.ts` |

설정 파일(`config/clusters.json`)에서 VM 이름, SSH 자격 증명(`admin`/`admin`), 클러스터 구성을 읽는다. kubeconfig 파일은 `kubeconfig/<클러스터명>.yaml` 경로를 사용한다.

### 1.3 디렉토리 구조

```
dashboard/
├── server/                  # Express 5 백엔드
│   ├── index.ts             # API 라우트 정의
│   ├── config.ts            # clusters.json 로드, kubeconfig 경로
│   ├── collector.ts         # 수집 오케스트레이터 (5s/10s/30s 주기)
│   ├── jobs.ts              # 테스트 실행/관리 (k6, stress-ng)
│   ├── collectors/          # 개별 수집기
│   │   ├── tart.ts          # tart list, tart ip
│   │   ├── ssh.ts           # SSH 연결 풀
│   │   ├── kubectl.ts       # 클러스터 노드/Pod 수집
│   │   ├── hubble.ts        # Cilium Hubble 트래픽 수집
│   │   ├── services.ts      # Kubernetes 서비스 수집
│   │   └── scaling.ts       # HPA 스케일링 이력 수집
│   └── parsers/             # 명령 출력 파서
│       ├── top.ts           # top 명령 파싱
│       ├── free.ts          # free 명령 파싱
│       ├── df.ts            # df 명령 파싱
│       ├── ss.ts            # ss 명령 파싱 (포트 정보)
│       ├── netdev.ts        # /proc/net/dev 파싱
│       ├── k6.ts            # k6 출력 파싱
│       └── stress-ng.ts     # stress-ng 출력 파싱
├── src/                     # React 19 프론트엔드
│   ├── App.tsx              # 라우팅 설정
│   ├── pages/               # 페이지 컴포넌트
│   │   ├── OverviewPage.tsx
│   │   ├── ClusterDetailPage.tsx
│   │   ├── TestingPage.tsx
│   │   ├── TrafficPage.tsx
│   │   ├── ScalingPage.tsx
│   │   └── LoadAnalysisPage.tsx
│   ├── components/          # 공유 UI 컴포넌트
│   └── hooks/               # React 커스텀 훅
├── shared/                  # 프론트/백 공유 타입 정의
│   └── types.ts
├── package.json
├── vite.config.ts
└── tsconfig.json
```


## 2. 실행 방법

### 2.1 사전 요구 사항

- Node.js 20 이상
- npm
- tart CLI (VM 관리 명령)
- kubectl
- 모든 VM이 실행 중이어야 한다 (`tart list`에서 running 상태)

### 2.2 설치 및 실행

```bash
cd dashboard
npm install
npm run dev
```

`npm run dev`는 `concurrently`를 사용하여 두 프로세스를 동시에 시작한다:
- `npm run dev:server` → `tsx watch server/index.ts` (Express 백엔드, 포트 3001)
- `npm run dev:client` → `vite` (React 프론트엔드, 포트 5173)

예상 출력:

```
[server] listening on http://localhost:3001
[collector] starting background collection (5s interval)
[collector] 12:00:05 | VMs: 10/10 running | Errors: 0

  VITE v7.3.1  ready in 200 ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose
```

### 2.3 접속

브라우저에서 `http://localhost:5173` 으로 접속한다.

백엔드 API가 정상 동작하는지 확인:

```bash
curl -sf http://localhost:3001/api/health
```

예상 출력:

```json
{"status":"ok","timestamp":1710000000000}
```

### 2.4 빌드 (프로덕션)

```bash
cd dashboard
npm run build
```

빌드 결과물은 `dashboard/dist/` 에 생성된다.


## 3. 페이지별 기능

### 3.1 Overview 페이지

경로: `/` (루트)

전체 인프라의 상태를 한눈에 보여주는 대시보드이다.

표시 내용:
- **VM 상태 카드**: 10개 VM 각각의 이름, IP, 상태(running/stopped), 소속 클러스터, 역할(master/worker)
- **리소스 게이지**: 각 VM의 CPU 사용률(%), 메모리 사용률(%), 디스크 사용률(%)을 게이지 차트로 표시
- **클러스터 헬스**: 4개 클러스터 각각의 노드 수, Ready 노드 수, Pod 수
- **네트워크 I/O**: VM별 수신/송신 바이트/초
- **에러 목록**: 수집 중 발생한 오류를 표시

데이터는 5초마다 `/api/snapshot` 엔드포인트에서 갱신된다.

### 3.2 Cluster Detail 페이지

경로: `/cluster/:name` (예: `/cluster/dev`)

특정 클러스터의 상세 정보를 보여준다.

표시 내용:
- **노드 테이블**: 노드 이름, 상태, 역할, IP, OS, Kubernetes 버전
- **Pod 테이블**: 네임스페이스별 Pod 목록, 상태, 재시작 횟수, 노드 배치
- **서비스 목록**: ClusterIP, NodePort, LoadBalancer 서비스 목록
- **네트워크 히스토리**: 시간대별 네트워크 트래픽 추이 (Recharts 라인 차트)

### 3.3 Testing 페이지

경로: `/testing`

SRE 부하 테스트와 스트레스 테스트를 실행하고 결과를 확인하는 페이지이다.

제공 테스트 유형:
1. **Load Test (k6)**: nginx 서비스에 대한 HTTP 부하 테스트 (기본: 50 VU, 30초)
2. **Custom Load Test**: VU 수, 지속 시간, 대상 URL, ramp-up, threshold를 직접 설정
3. **Stress CPU**: stress-ng를 사용한 CPU 스트레스 (worker 수, timeout 설정)
4. **Stress Memory**: stress-ng를 사용한 메모리 스트레스 (worker 수, vm-bytes, timeout 설정)
5. **Scaling Test**: k6 부하와 HPA 스케일링 관찰을 결합한 테스트 (cooldown 포함)
6. **Cascade Test**: 복수 서비스(nginx + httpbin)에 동시 부하를 가하는 테스트

표시 내용:
- 테스트 설정 폼 (유형, 클러스터, 파라미터)
- 실행 중인 테스트 상태 (pending → running → completed/failed)
- 완료된 테스트 결과 (p95/p99 레이턴시, 에러율, RPS, bogo-ops)
- 원본 로그 출력
- CSV 내보내기 버튼

### 3.4 Traffic 페이지

경로: `/traffic`

Cilium Hubble에서 수집한 네트워크 트래픽을 시각화한다.

표시 내용:
- **클러스터 선택**: 드롭다운으로 클러스터 선택
- **Flow 목록**: 소스 Pod → 대상 Pod, 프로토콜, 포트, verdict(FORWARDED/DROPPED)
- **집계 데이터**: 소스-대상 쌍별 트래픽 카운트
- **트래픽 방향**: ingress/egress 구분

데이터는 10초마다 갱신된다.

### 3.5 Scaling 페이지

경로: `/scaling`

HPA 자동 스케일링 이력을 시각화한다.

표시 내용:
- **클러스터 선택**: 드롭다운으로 클러스터 선택
- **HPA 상태 테이블**: 디플로이먼트별 현재/최소/최대 레플리카, CPU 사용률
- **스케일링 이력 차트**: 시간에 따른 레플리카 수 변화 (Recharts)
- **스케일링 테스트 결과**: scaleUpLatency, peakReplicas, scaleDownStarted 등의 메트릭

### 3.6 Load Analysis 페이지

경로: `/load-analysis`

완료된 부하 테스트 결과를 분석한다.

표시 내용:
- **테스트 결과 목록**: 모든 완료/실패 테스트
- **성능 메트릭**: p95 레이턴시, p99 레이턴시, 평균 레이턴시, 에러율, RPS, 총 요청 수
- **스트레스 메트릭**: CPU bogo-ops, 메모리 bogo-ops
- **스케일링 메트릭**: 스케일업 지연시간, 피크 레플리카, 스케일다운 시작 시점, Pod당 평균 RPS
- **CSV 내보내기**: 전체 테스트 결과를 CSV 파일로 다운로드


## 4. API 엔드포인트

모든 API는 `http://localhost:3001` 에서 제공된다.

### 4.1 헬스 체크

```
GET /api/health
```

```bash
curl http://localhost:3001/api/health
```

```json
{"status":"ok","timestamp":1710000000000}
```

### 4.2 인프라 스냅샷

```
GET /api/snapshot
```

전체 인프라 상태(VM, 클러스터, Pod, 리소스, 네트워크)를 반환한다.

```bash
curl http://localhost:3001/api/snapshot | jq '.data.vms | length'
```

예상 출력:

```
10
```

응답 구조:

```json
{
  "data": {
    "vms": [...],
    "vmResources": {"platform-master": {"cpuPercent": 25, "memoryPercent": 60, ...}, ...},
    "vmPorts": {"platform-worker1": [{"port": 30300, "process": "kube-proxy"}, ...], ...},
    "vmNetwork": {"dev-worker1": {"rxBytesPerSec": 12345, "txBytesPerSec": 6789, ...}, ...},
    "clusters": [...],
    "clusterPods": {"dev": [...], "platform": [...], ...},
    "collectedAt": 1710000000000,
    "errors": []
  },
  "timestamp": 1710000000000,
  "stale": false
}
```

`stale`이 `true`이면 마지막 수집 후 10초 이상 경과한 것이다.

### 4.3 트래픽

```
GET /api/traffic/all
```

모든 클러스터의 Hubble 트래픽 데이터를 반환한다.

```
GET /api/traffic?cluster=dev
```

특정 클러스터의 트래픽만 반환한다.

```bash
curl http://localhost:3001/api/traffic?cluster=dev | jq '.flows | length'
```

### 4.4 서비스

```
GET /api/cluster/:name/services
```

특정 클러스터의 Kubernetes 서비스 목록을 반환한다.

```bash
curl http://localhost:3001/api/cluster/dev/services | jq '.[].name'
```

### 4.5 테스트 실행

```
POST /api/tests/run
```

요청 바디:

```json
{
  "type": "load",
  "cluster": "dev"
}
```

지원하는 `type` 값:
- `load`: 기본 k6 부하 테스트 (50 VU, 30초)
- `custom-load`: 사용자 정의 k6 부하 테스트
- `stress-cpu`: CPU 스트레스 테스트
- `stress-memory`: 메모리 스트레스 테스트
- `scaling-test`: k6 + HPA 관찰 테스트
- `cascade-test`: 다중 서비스 부하 테스트

custom-load 예시:

```bash
curl -X POST http://localhost:3001/api/tests/run \
  -H "Content-Type: application/json" \
  -d '{
    "type": "custom-load",
    "cluster": "dev",
    "config": {
      "vus": 100,
      "duration": "60s",
      "targetUrl": "http://nginx-web.demo.svc.cluster.local",
      "thresholdP95": 2000,
      "thresholdErrorRate": 0.5,
      "rampUp": "10s"
    }
  }'
```

stress-cpu 예시:

```bash
curl -X POST http://localhost:3001/api/tests/run \
  -H "Content-Type: application/json" \
  -d '{
    "type": "stress-cpu",
    "cluster": "dev",
    "stressConfig": {
      "workers": 2,
      "timeout": "60s"
    }
  }'
```

stress-memory 예시:

```bash
curl -X POST http://localhost:3001/api/tests/run \
  -H "Content-Type: application/json" \
  -d '{
    "type": "stress-memory",
    "cluster": "dev",
    "stressConfig": {
      "workers": 2,
      "timeout": "60s",
      "vmBytes": "128M"
    }
  }'
```

한 번에 하나의 테스트만 실행할 수 있다. 이미 실행 중인 테스트가 있으면 에러를 반환한다.

### 4.6 테스트 상태 조회

```
GET /api/tests/status
```

모든 테스트(실행 중 + 완료)의 상태를 반환한다.

```bash
curl http://localhost:3001/api/tests/status | jq '.[0].status'
```

### 4.7 테스트 삭제

```
DELETE /api/tests/:id
```

테스트 기록을 삭제하고, Kubernetes Job과 ConfigMap도 정리한다.

```bash
curl -X DELETE http://localhost:3001/api/tests/load-abc123
```

### 4.8 테스트 결과 CSV 내보내기

```
GET /api/tests/export
```

완료된 모든 테스트 결과를 CSV 파일로 다운로드한다.

```bash
curl -o sre-test-results.csv http://localhost:3001/api/tests/export
```

CSV 컬럼: id, type, scenario, cluster, status, started_at, completed_at, duration_sec, vus, load_duration, target_url, stress_workers, stress_timeout, stress_vm_bytes, p95_latency_ms, p99_latency_ms, avg_latency_ms, error_rate, rps, total_requests, cpu_bogo_ops, memory_bogo_ops, scale_up_latency_ms, peak_replicas, scale_down_started_ms, avg_rps_per_pod, error

### 4.9 스케일링 이력

```
GET /api/scaling
```

모든 클러스터의 HPA 스케일링 이력을 반환한다.

```
GET /api/scaling/:cluster
```

특정 클러스터의 스케일링 이력만 반환한다.

```bash
curl http://localhost:3001/api/scaling/dev | jq '.[0].hpas[0]'
```

예상 출력:

```json
{
  "name": "nginx-web-hpa",
  "namespace": "demo",
  "deployment": "nginx-web",
  "currentReplicas": 3,
  "desiredReplicas": 3,
  "minReplicas": 3,
  "maxReplicas": 10,
  "cpuPercent": 20,
  "cpuTarget": 50
}
```


## 5. 부하 테스트 실행 (대시보드 UI)

### 5.1 k6 Load Test

1. 브라우저에서 `http://localhost:5173/testing` 에 접속한다
2. 테스트 유형에서 `Load Test`를 선택한다
3. 클러스터에서 `dev`를 선택한다
4. `Run Test` 버튼을 클릭한다
5. 상태가 `pending` → `running` → `completed`로 변경되는 것을 확인한다

기본 설정: 50 VU, 30초, 대상 URL `http://nginx-web.demo.svc.cluster.local`

완료 후 결과:
- p95 레이턴시 (ms)
- p99 레이턴시 (ms)
- 평균 레이턴시 (ms)
- 에러율 (%)
- 초당 요청 수 (RPS)
- 총 요청 수

### 5.2 Custom Load Test

1. 테스트 유형에서 `Custom Load`를 선택한다
2. 다음 파라미터를 설정한다:
   - **VUs**: 동시 가상 사용자 수 (예: 100)
   - **Duration**: 테스트 지속 시간 (예: 60s)
   - **Target URL**: 대상 서비스 URL (예: `http://httpbin.demo.svc.cluster.local/get`)
   - **Ramp Up**: VU를 점진적으로 증가시키는 시간 (예: 10s, 선택사항)
   - **Threshold P95**: p95 레이턴시 임계값 (기본: 2000ms)
   - **Threshold Error Rate**: 에러율 임계값 (기본: 0.5)
3. `Run Test`를 클릭한다

ramp-up을 설정하면 k6가 stages 모드로 실행된다: ramp-up → sustain → ramp-down.

### 5.3 Stress Test

1. 테스트 유형에서 `Stress CPU` 또는 `Stress Memory`를 선택한다
2. 파라미터를 설정한다:
   - **Workers**: stress-ng 워커 수 (CPU: `--cpu`, Memory: `--vm`)
   - **Timeout**: 스트레스 지속 시간 (예: 60s)
   - **VM Bytes** (Memory만): 워커당 할당 메모리 (예: 128M)
3. `Run Test`를 클릭한다

스트레스 테스트는 클러스터 내에 Job으로 생성된다. 완료 후 stress-ng의 bogo-ops 결과를 확인할 수 있다. CPU 스트레스를 실행하면 HPA가 반응하여 디플로이먼트의 레플리카가 증가하는 것을 Scaling 페이지에서 관찰할 수 있다.

### 5.4 Scaling Test

1. 테스트 유형에서 `Scaling Test`를 선택한다
2. k6 부하 파라미터를 설정한다
3. Cooldown 시간을 설정한다 (기본: 60초)
4. `Run Test`를 클릭한다

이 테스트는 k6 부하를 가하면서 HPA 스케일링 이력을 동시에 수집한다. k6 완료 후 cooldown 기간 동안 스케일다운도 추적한다. 결과에는 scaleUpLatency, peakReplicas, scaleDownStarted, avgRpsPerPod 메트릭이 포함된다.

### 5.5 Cascade Test

1. 테스트 유형에서 `Cascade Test`를 선택한다
2. k6 파라미터와 대상 URL 목록을 설정한다
3. `Run Test`를 클릭한다

기본 대상: `nginx-web` + `httpbin`. 여러 서비스에 동시에 부하를 가하여 서비스 간 의존성과 전체 시스템의 내구성을 테스트한다.

### 5.6 테스트 완료 후 정리

완료된 테스트의 Kubernetes Job은 `ttlSecondsAfterFinished: 300`에 의해 5분 후 자동 삭제된다. 대시보드 UI에서 삭제 버튼을 클릭하면 즉시 Job과 ConfigMap이 삭제되고 기록도 제거된다.
