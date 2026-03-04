# 05. 데이터 흐름과 파이프라인

이 문서는 프로젝트의 5가지 핵심 데이터 흐름을 그림으로 설명합니다.

---

## 1. VM 프로비저닝 → K8s 클러스터 구축 파이프라인

전체 설치 과정에서 데이터(설정값, IP, 인증서, 토큰)가 어떻게 흘러가는지:

```
config/clusters.json (Single Source of Truth)
       │
       │  jq로 파싱 (common.sh → get_config())
       ▼
┌──────────────────────────────────────────────────────────┐
│ Phase 1: VM 생성                                         │
│                                                          │
│  base_image ──tart clone──→ 10개 VM                      │
│                   │                                      │
│              tart set (CPU, Memory)                      │
│                   │                                      │
│              tart run --net-softnet-allow                 │
│                   │                                      │
│              tart ip (DHCP 할당 대기)                     │
│                   │                                      │
│              VM별 IP 확정                                 │
└──────────┬───────────────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────────────┐
│ Phase 2~4: 노드 준비 (SSH로 원격 실행)                     │
│                                                          │
│  Mac ──sshpass──→ 각 VM                                  │
│         │                                                │
│         ├── swap off + 커널 모듈 로드                      │
│         ├── containerd 설치 (SystemdCgroup=true)           │
│         └── kubeadm v1.31 설치 (apt-mark hold)            │
└──────────┬───────────────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────────────┐
│ Phase 5: 클러스터 초기화 (각 클러스터별 반복)                 │
│                                                          │
│  kubeadm init (master)                                   │
│    │                                                     │
│    ├── API server 인증서 생성                               │
│    ├── etcd 초기화                                         │
│    ├── admin.conf 생성 (kubeconfig)                        │
│    │     │                                               │
│    │     └──scp──→ Mac의 kubeconfig/ 디렉토리               │
│    │                                                     │
│    └── join token 생성                                     │
│          │                                               │
│          └──SSH──→ 각 worker VM                           │
│                    kubeadm join (토큰 + master IP)         │
└──────────┬───────────────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────────────┐
│ Phase 6: Cilium 설치 (Mac에서 Helm 실행)                   │
│                                                          │
│  helm install cilium                                     │
│    │                                                     │
│    ├── --kubeconfig (Phase 5에서 복사한 파일)                │
│    ├── --set pod_cidr (clusters.json에서 읽은 값)           │
│    ├── --set k8sServiceHost (master IP)                   │
│    └── --values manifests/cilium-values.yaml              │
│                                                          │
│  → Cilium이 eBPF 프로그램을 커널에 로드                      │
│  → kube-proxy 없이 Service 라우팅 시작                      │
│  → Hubble이 네트워크 플로우 수집 시작                        │
└──────────────────────────────────────────────────────────┘
```

**핵심 포인트:**
- 모든 것이 `clusters.json`에서 시작
- IP는 DHCP로 동적 할당되므로 부팅할 때마다 변경될 수 있음
- kubeconfig는 master VM에서 Mac으로 복사되어 로컬 kubectl 사용 가능
- join token은 master에서 생성하여 worker에 전달

---

## 2. 대시보드 데이터 수집 파이프라인

대시보드가 10개 VM과 4개 클러스터에서 데이터를 수집하여 브라우저에 표시하는 흐름:

```
┌──────────────────────────────────────────────────────────────┐
│                    Express 백엔드 (port 3001)                  │
│                                                              │
│  ┌───────────────────────────────────────────────────────┐   │
│  │              SSH Connection Pool                      │   │
│  │  10개 VM에 상시 SSH 연결 유지 (ssh2 라이브러리)          │   │
│  │  연결 끊어지면 자동 재연결                               │   │
│  └───────┬───────────────────────────────────────────────┘   │
│          │                                                   │
│  ┌───────▼───────────────────────────────────────────────┐   │
│  │           Background Collectors (4개 루프)             │   │
│  │                                                       │   │
│  │  [Main 루프 — 5초마다]                                  │   │
│  │  SSH 명령 실행:                                        │   │
│  │    top -bn1      ──→ Parsers ──→ CPU%                 │   │
│  │    free -m       ──→ Parsers ──→ Memory 사용량         │   │
│  │    df            ──→ Parsers ──→ Disk 사용량           │   │
│  │    ss -tlnp      ──→ Parsers ──→ 열린 포트 목록        │   │
│  │    /proc/net/dev ──→ Parsers ──→ 네트워크 RX/TX 속도    │   │
│  │  kubectl 실행:                                        │   │
│  │    kubectl get nodes ──→ 노드 상태                     │   │
│  │    kubectl get pods  ──→ Pod 상태                      │   │
│  │                                                       │   │
│  │  [Scaling 루프 — 5초마다]                               │   │
│  │    kubectl get hpa ──→ 360포인트 링 버퍼 (30분 히스토리) │   │
│  │                                                       │   │
│  │  [Traffic 루프 — 10초마다]                               │   │
│  │    hubble observe --output json ──→ 최근 200개 플로우    │   │
│  │                                                       │   │
│  │  [Services 루프 — 30초마다]                              │   │
│  │    kubectl get svc + endpoints ──→ 서비스 목록          │   │
│  └───────┬───────────────────────────────────────────────┘   │
│          │                                                   │
│          ▼ 수집된 데이터를 메모리에 캐시                        │
│  ┌───────────────────────────────────────────────────────┐   │
│  │              REST API (9개 엔드포인트)                  │   │
│  │                                                       │   │
│  │  GET /api/snapshot  ← 캐시에서 즉시 반환 (< 10ms)      │   │
│  │  GET /api/traffic                                     │   │
│  │  GET /api/scaling/:cluster                            │   │
│  │  POST /api/tests/run  ← K8s Job 생성 (k6/stress-ng)   │   │
│  │  ...                                                  │   │
│  └───────┬───────────────────────────────────────────────┘   │
└──────────┼───────────────────────────────────────────────────┘
           │ HTTP
           ▼
┌──────────────────────────────────────────────────────────────┐
│              React 프론트엔드 (port 3000)                     │
│                                                              │
│  ┌──────────┐ ┌──────────────┐ ┌─────────┐ ┌─────────────┐ │
│  │ Overview │ │ClusterDetail │ │ Traffic │ │   Scaling   │ │
│  │ Page     │ │    Page      │ │  Page   │ │    Page     │ │
│  │          │ │              │ │         │ │             │ │
│  │클러스터   │ │노드별 CPU/   │ │SVG 토폴 │ │HPA 리플리카  │ │
│  │요약 카드  │ │메모리/디스크  │ │로지 맵   │ │변화 차트     │ │
│  └──────────┘ └──────────────┘ └─────────┘ └─────────────┘ │
│  ┌──────────┐ ┌──────────────┐                              │
│  │ Testing  │ │LoadAnalysis  │                              │
│  │  Page    │ │    Page      │                              │
│  │          │ │              │                              │
│  │부하 테스트│ │스케일링 분석  │                              │
│  │실행/결과  │ │타임라인 차트  │                              │
│  └──────────┘ └──────────────┘                              │
└──────────────────────────────────────────────────────────────┘
```

**핵심 포인트:**
- API 요청과 데이터 수집이 **분리**되어 있음 (Cache-Aside 패턴)
- SSH Connection Pool로 매번 연결/해제 오버헤드 제거
- `Promise.allSettled` 사용 → VM 하나가 응답 안 해도 나머지는 정상 수집
- Vite dev server가 `/api` 요청을 백엔드(3001)로 프록시

---

## 3. 네트워크 트래픽 흐름 (Cilium + Hubble)

Pod 간 통신이 어떻게 처리되고 관찰되는지:

```
┌───────────────────────────────────────────────────────────┐
│                     Kubernetes Node (VM)                   │
│                                                           │
│  ┌─────────┐         ┌─────────┐                         │
│  │ nginx   │ ──TCP──→│ httpbin │                         │
│  │ Pod     │  :80    │ Pod     │                         │
│  └────┬────┘         └────┬────┘                         │
│       │                   │                              │
│       ▼                   ▼                              │
│  ┌────────────────────────────────────────────────────┐  │
│  │              Linux Kernel (eBPF)                    │  │
│  │                                                    │  │
│  │  1. Cilium eBPF 프로그램이 패킷을 가로챔              │  │
│  │     (TC ingress/egress hook)                       │  │
│  │                                                    │  │
│  │  2. CiliumNetworkPolicy 평가                        │  │
│  │     ├── default-deny: 기본 차단                     │  │
│  │     ├── allow-nginx-to-httpbin: GET만 허용           │  │
│  │     └── 결과: FORWARDED 또는 DROPPED                │  │
│  │                                                    │  │
│  │  3. kube-proxy 대체 (Service → Pod 라우팅)            │  │
│  │     eBPF 해시맵에서 O(1) 조회                        │  │
│  │                                                    │  │
│  │  4. Hubble이 이벤트를 eBPF 링 버퍼에서 수집            │  │
│  │     ├── 출발지/목적지 Pod                            │  │
│  │     ├── 프로토콜, 포트                               │  │
│  │     ├── 판정 (FORWARDED/DROPPED)                    │  │
│  │     └── L7 정보 (HTTP method, status code)          │  │
│  └────────────────────────────────────────────────────┘  │
│                        │                                  │
│                        ▼                                  │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Hubble (DaemonSet — 모든 노드에 배포)               │  │
│  │    ├── hubble-relay: 여러 노드의 플로우를 수집         │  │
│  │    └── hubble-ui: 웹 UI (NodePort 31235)            │  │
│  └────────────────────────────────────────────────────┘  │
└───────────────────────────────────┬───────────────────────┘
                                    │
                                    ▼
┌───────────────────────────────────────────────────────────┐
│  대시보드 Traffic 수집 루프 (10초마다)                       │
│                                                           │
│  hubble observe --last 200 --output json                  │
│       │                                                   │
│       ▼                                                   │
│  TrafficFlow 파싱                                          │
│    ├── source: {namespace, pod, ip}                        │
│    ├── destination: {namespace, pod, ip, port}             │
│    ├── verdict: FORWARDED / DROPPED                        │
│    ├── type: L3_L4 / L7                                   │
│    └── l7info: {method, url, code}                        │
│       │                                                   │
│       ▼                                                   │
│  AggregatedEdge 계산 (같은 src→dst 통합)                    │
│       │                                                   │
│       ▼                                                   │
│  React TrafficPage → SVG 토폴로지 맵                       │
│    ├── 녹색 선: FORWARDED                                   │
│    ├── 빨간 선: DROPPED                                    │
│    └── 노드 색상: Namespace별                               │
└───────────────────────────────────────────────────────────┘
```

---

## 4. HPA 오토스케일링 파이프라인

Pod에 부하가 걸렸을 때 자동으로 스케일링되는 흐름:

```
┌────────────────────────────────────────────────────────────┐
│ 1. 부하 발생                                                │
│                                                            │
│    k6 Job (100 VUs) ──HTTP──→ nginx Pod (CPU 증가)          │
│    또는 stress-ng Job ──→ 직접 CPU/메모리 부하                │
└───────────┬────────────────────────────────────────────────┘
            │
            ▼
┌────────────────────────────────────────────────────────────┐
│ 2. 메트릭 수집                                              │
│                                                            │
│    metrics-server (15초마다)                                 │
│      ├── kubelet API에서 Pod CPU/메모리 사용량 조회           │
│      └── Metrics API로 노출 (/apis/metrics.k8s.io/v1beta1) │
└───────────┬────────────────────────────────────────────────┘
            │
            ▼
┌────────────────────────────────────────────────────────────┐
│ 3. HPA 컨트롤러 (15초마다 평가)                              │
│                                                            │
│    현재 상태:                                               │
│      CPU 사용률: 85% (목표: 50%)                             │
│      현재 Pod 수: 3개                                       │
│                                                            │
│    계산: ceil(3 × 85/50) = ceil(5.1) = 6                    │
│    결정: 3개 → 6개로 스케일 업                                │
│                                                            │
│    제약:                                                    │
│      ├── maxReplicas: 10 (최대 10개까지)                     │
│      ├── scaleUp: 최대 2개/15초                              │
│      └── PDB: minAvailable 2 (최소 2개는 항상 유지)           │
│                                                            │
│    실행: ReplicaSet에 replicas 증가 요청                     │
└───────────┬────────────────────────────────────────────────┘
            │
            ▼
┌────────────────────────────────────────────────────────────┐
│ 4. Pod 생성                                                 │
│                                                            │
│    Scheduler ──→ 적절한 Node 선택                            │
│    kubelet ──→ containerd ──→ 컨테이너 시작                   │
│    Cilium ──→ 네트워크 설정 (eBPF 프로그램 적용)               │
│    Readiness Probe 통과 ──→ Service 엔드포인트 등록            │
└───────────┬────────────────────────────────────────────────┘
            │
            ▼
┌────────────────────────────────────────────────────────────┐
│ 5. 대시보드에서 관찰                                         │
│                                                            │
│    Scaling 수집 루프 (5초마다):                               │
│      kubectl get hpa ──→ {현재 CPU%, 현재 Pod 수, 목표 CPU%} │
│                    │                                       │
│                    ▼                                       │
│      360포인트 링 버퍼에 저장 (30분 히스토리)                  │
│                    │                                       │
│                    ▼                                       │
│    React ScalingPage:                                      │
│      ├── Pod 수 변화 AreaChart (stepAfter)                   │
│      ├── CPU 사용률 LineChart (목표선 대비)                   │
│      └── HPA 상태 카드 (min/max/current)                    │
└────────────────────────────────────────────────────────────┘
```

**부하 해소 후 스케일 다운:**
```
CPU 사용률 감소 → HPA 계산: ceil(6 × 20/50) = 3
→ stabilizationWindowSeconds: 120초 대기 (급격한 축소 방지)
→ 3개로 스케일 다운
→ PDB: minAvailable 2이므로 한 번에 1개씩만 제거
```

---

## 5. 알림 파이프라인

문제가 발생했을 때 알림이 전달되는 흐름:

```
┌────────────────────────────────────────────────────────────┐
│ 1. 문제 발생                                                │
│                                                            │
│    예: Pod가 반복적으로 재시작 (CrashLoopBackOff)             │
└───────────┬────────────────────────────────────────────────┘
            │
            ▼
┌────────────────────────────────────────────────────────────┐
│ 2. Prometheus가 메트릭 수집 (15초마다 scrape)                │
│                                                            │
│    kube_pod_container_status_restarts_total 증가 감지         │
└───────────┬────────────────────────────────────────────────┘
            │
            ▼
┌────────────────────────────────────────────────────────────┐
│ 3. PrometheusRule 평가                                      │
│                                                            │
│    manifests/alerting/prometheus-rules.yaml:                │
│                                                            │
│    - alert: PodCrashLooping                                │
│      expr: rate(kube_pod_container_status_restarts[5m]) > 0│
│      for: 5m      ← 5분 동안 지속되면 발동                   │
│      severity: critical                                    │
│                                                            │
│    8개 규칙 중 해당 조건 충족 시 → AlertManager로 전송         │
└───────────┬────────────────────────────────────────────────┘
            │
            ▼
┌────────────────────────────────────────────────────────────┐
│ 4. AlertManager 처리                                        │
│                                                            │
│    ├── 그룹화: 같은 알림 이름끼리 묶음 (5분 단위)              │
│    ├── 중복 제거: 동일 알림 반복 전송 방지 (4시간 간격)        │
│    ├── 억제(inhibit): critical이 발동되면 warning 알림 숨김   │
│    └── 라우팅: webhook-logger로 전송                         │
│                                                            │
│    monitoring-values.yaml 설정:                             │
│    route:                                                  │
│      receiver: webhook-logger                              │
│      group_wait: 30s                                       │
│      group_interval: 5m                                    │
│      repeat_interval: 4h                                   │
└───────────┬────────────────────────────────────────────────┘
            │
            ▼
┌────────────────────────────────────────────────────────────┐
│ 5. webhook-logger 수신                                      │
│                                                            │
│    manifests/alerting/webhook-logger.yaml:                  │
│    mendhak/http-https-echo 컨테이너 (port 8080)              │
│                                                            │
│    수신한 알림을 그대로 HTTP 응답 + 로그로 출력                │
│    → kubectl logs로 알림 내용 확인 가능                      │
│    → 실제 환경에서는 Slack, PagerDuty, Email 등으로 교체       │
└────────────────────────────────────────────────────────────┘
```

**설정된 8개 알림 규칙:**

| 규칙 | 조건 | 심각도 |
|------|------|--------|
| HighCpuUsage | CPU > 80% (5분 지속) | warning |
| HighMemoryUsage | Memory > 85% (5분 지속) | warning |
| NodeNotReady | 노드 NotReady (2분 지속) | critical |
| NodeDiskPressure | 디스크 부족 (5분 지속) | warning |
| PodCrashLooping | Pod 반복 재시작 (5분 지속) | critical |
| PodOOMKilled | OOM으로 종료됨 | critical |
| HighPodRestartRate | 재시작 빈도 높음 (15분 지속) | warning |
| PodNotReady | Pod 미준비 (10분 지속) | warning |

---

## 파이프라인 전체 요약

```
설치 파이프라인:   clusters.json → Bash/Terraform → VM → K8s → Cilium → 모니터링/CI/CD
부팅 파이프라인:   VM 시작 → SSH 대기 → IP 업데이트 → K8s Ready → 서비스 확인
데이터 수집:       SSH Pool → Parser → 캐시 → REST API → React
트래픽 관찰:       Pod 통신 → eBPF → Hubble → Dashboard
오토스케일링:      부하 → metrics-server → HPA → Pod 증감 → Dashboard
알림:              이상 → Prometheus → Rule 평가 → AlertManager → webhook
```

각 파이프라인에서 문제가 발생하면 [04-code-navigation-guide.md](04-code-navigation-guide.md)의 시나리오별 가이드를 참고하여 원인을 추적하세요.
