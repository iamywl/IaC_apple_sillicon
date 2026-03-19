# 오픈소스 도구 간 상호작용 가이드

tart-infra에서 사용하는 오픈소스 도구들이 서로 어떻게 연결되고, 어떤 상황에서 어떤 도구가 어떤 도구를 호출하는지 설명한다.

---

## 1. 전체 상호작용 흐름도

```
┌─────────────────────────────────────────────────────────────────────┐
│  호스트 Mac                                                          │
│                                                                     │
│  [Tart] ──VM 생성/관리──→ [10개 Ubuntu VM]                           │
│  [SRE Dashboard] ──SSH/kubectl──→ [4개 K8s 클러스터]                  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘

┌── Platform 클러스터 ────────────────────────────────────────────────┐
│                                                                     │
│  [Prometheus] ←──scrape──── [node-exporter] (각 노드)               │
│       │        ←──scrape──── [kube-state-metrics]                   │
│       │        ←──scrape──── [kubelet /metrics]                     │
│       ↓                                                             │
│  [Grafana] ←──query──── Prometheus (PromQL)                        │
│       ↑       ←──query──── [Loki] (LogQL)                          │
│       │                      ↑                                      │
│       │               [Promtail] ──push── Loki (각 노드 로그 수집)   │
│       │                                                             │
│  [AlertManager] ←──alert──── Prometheus (규칙 위반 시)              │
│       │                                                             │
│       └──webhook──→ [Webhook Logger]                                │
│                                                                     │
│  [Jenkins] ──빌드/테스트──→ 코드 리포지토리                          │
│       │                                                             │
│       └──트리거──→ [ArgoCD] ──sync──→ dev/staging/prod 클러스터     │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘

┌── Dev 클러스터 ─────────────────────────────────────────────────────┐
│                                                                     │
│  [istiod] ──설정 배포──→ [Envoy Sidecar] (demo 네임스페이스 전체)    │
│      │     ──인증서──→ Envoy (mTLS 자동 적용)                       │
│      │                                                              │
│  [Istio Gateway] ──라우팅──→ nginx-web / httpbin                    │
│                                                                     │
│  외부 → nginx-web → httpbin(v1/v2) → postgres/rabbitmq/keycloak    │
│                 └──→ redis                                          │
│                                                                     │
│  [Cilium] ──정책 적용──→ 모든 Pod (CiliumNetworkPolicy)             │
│  [metrics-server] ──메트릭──→ [HPA] ──스케일링──→ 데모 앱 레플리카   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. 인프라 레이어 상호작용

### 2.1 Tart → containerd → kubelet (VM → 컨테이너 런타임 → K8s)

```
Tart (VM 생성/시작/중지)
  └→ Ubuntu VM 부팅
      └→ containerd (컨테이너 런타임, systemd로 자동 시작)
          └→ kubelet (K8s 노드 에이전트, containerd에 컨테이너 생성 요청)
              └→ kube-apiserver에 등록 → 클러스터 합류
```

**언제 호출되는가:**
- `tart run <vm-name>` → VM 부팅 → systemd가 containerd → kubelet 순서로 시작
- kubelet이 Pod 생성 요청을 받으면 → containerd에 CRI(Container Runtime Interface)로 컨테이너 생성 요청
- containerd가 이미지 pull → 컨테이너 생성 → 네트워크 설정 (Cilium CNI 호출)

### 2.2 Cilium → Hubble (네트워킹 → 옵저버빌리티)

```
Cilium Agent (각 노드의 DaemonSet)
  ├→ eBPF 프로그램 로드 → 커널에서 패킷 처리 (kube-proxy 대체)
  ├→ Pod 간 네트워크 연결 제공
  ├→ CiliumNetworkPolicy 적용 (L3/L4/L7 필터링)
  └→ Hubble (Cilium 내장 옵저버빌리티)
      ├→ Hubble Relay → 모든 노드의 플로 데이터 집계
      └→ Hubble UI (:31235) → 네트워크 토폴로지 시각화
```

**언제 호출되는가:**
- 새 Pod가 생성될 때 → kubelet이 Cilium CNI 플러그인 호출 → Pod에 IP 할당 + eBPF 규칙 적용
- Pod 간 통신 발생 시 → Cilium eBPF가 패킷 필터링 → NetworkPolicy 검사 → 허용/차단
- Hubble는 Cilium이 처리하는 모든 패킷 이벤트를 실시간 캡처하여 Hubble Relay로 전달
- SRE 대시보드가 `hubble observe` 명령으로 최근 플로 200건을 10초마다 조회

---

## 3. 모니터링 파이프라인 상호작용

### 3.1 메트릭 수집: node-exporter → Prometheus → Grafana

```
[node-exporter] ──:9100/metrics──→ [Prometheus]
  (각 노드에서 CPU, 메모리,                (15초마다 scrape,
   디스크, 네트워크 메트릭 노출)             7일 보존, 10Gi 스토리지)

[kube-state-metrics] ──:8080/metrics──→ [Prometheus]
  (K8s 오브젝트 상태:
   Pod 수, Deployment 상태,
   노드 조건 등)

[kubelet] ──:10250/metrics──→ [Prometheus]
  (컨테이너별 CPU/메모리 사용량,
   cAdvisor 메트릭 포함)

[Prometheus] ←──PromQL 쿼리──── [Grafana :30300]
                                  (3개 대시보드:
                                   - K8s Cluster Overview
                                   - Node Exporter Full
                                   - K8s Pods)
```

**언제 호출되는가:**
- Prometheus는 설정된 scrape_interval(기본 15초)마다 각 target의 /metrics 엔드포인트를 HTTP GET으로 호출
- Grafana는 사용자가 대시보드를 열면 Prometheus에 PromQL 쿼리를 보내 데이터를 가져옴
- 예: `rate(node_cpu_seconds_total{mode!="idle"}[5m])` → 최근 5분 CPU 사용률

### 3.2 로그 수집: Promtail → Loki → Grafana

```
[Promtail] (각 노드 DaemonSet)
  ├→ /var/log/pods/** 파일 감시
  ├→ 컨테이너 로그에 K8s 라벨 자동 부착 (namespace, pod, container)
  └→ HTTP POST ──push──→ [Loki]
                           ├→ 로그 인덱싱 (라벨 기반, 전문 인덱싱 안 함)
                           └→ [Grafana] ←──LogQL 쿼리──
                               예: {namespace="demo", container="nginx"} |= "error"
```

**언제 호출되는가:**
- Promtail은 inotify로 로그 파일 변경을 감지하면 즉시 Loki에 push (배치 처리, 기본 1초)
- Grafana Explore에서 LogQL 쿼리를 실행하면 Loki의 `/loki/api/v1/query_range`를 호출
- Grafana 대시보드에서 로그 패널이 있으면 자동으로 Loki를 데이터소스로 쿼리

### 3.3 알림: Prometheus → AlertManager → Webhook

```
[Prometheus]
  ├→ PrometheusRule 평가 (30초 간격)
  │   - HighCpuUsage: CPU > 80% 5분 지속 → warning
  │   - HighMemoryUsage: 메모리 > 85% 5분 지속 → warning
  │   - NodeNotReady: 노드 비정상 5분 지속 → critical
  │   - PodCrashLooping: 15분 내 5회 이상 재시작 → warning
  │   - PodOOMKilled: OOM으로 종료 → warning
  │
  └→ 규칙 위반 감지 시 ──alert POST──→ [AlertManager :30903]
      ├→ 그룹핑: alertname + namespace로 묶음 (30초 대기)
      ├→ 라우팅: severity=critical → 10초 대기 후 즉시 전송
      │         severity=warning → 기본 경로
      ├→ 억제: critical 알림이 있으면 동일 alertname의 warning 억제
      └→ 수신자: ──HTTP POST──→ [Webhook Logger :8080/alert]
                                  (알림 내용 JSON 로깅)
```

**언제 호출되는가:**
- Prometheus는 30초마다 recording/alerting 규칙을 평가
- 조건이 `for` 기간 동안 유지되면 firing 상태가 되어 AlertManager에 POST 전송
- AlertManager는 group_wait(30초 또는 10초) 후 수신자에게 웹훅 전송
- 동일 알림이 반복되면 repeat_interval(12시간)마다 재전송

---

## 4. CI/CD 파이프라인 상호작용

### 4.1 Jenkins → ArgoCD → 클러스터 배포

```
[개발자] ──git push──→ [Git Repository]
                          │
                          ↓
[Jenkins :30900]  ←──webhook/polling──
  ├→ 파이프라인 실행:
  │   1. 코드 체크아웃
  │   2. 빌드 & 테스트
  │   3. 컨테이너 이미지 빌드 & push
  │   4. Git 매니페스트 업데이트 (이미지 태그 변경)
  │
  └→ 매니페스트 변경 감지
                          │
                          ↓
[ArgoCD :30800]  ←──Git polling (3분)──→ [Git Repository]
  ├→ 현재 클러스터 상태 vs Git 매니페스트 비교 (diff)
  ├→ OutOfSync 감지 → 자동 sync (sync-policy: automated)
  └→ kubectl apply ──→ [대상 클러스터 (dev/staging/prod)]
      ├→ Deployment 업데이트
      ├→ Rolling update 실행
      └→ 상태 확인 → Sync Status + Health Status 조합
```

**ArgoCD 상태 체계:**

ArgoCD는 **Sync Status**와 **Health Status** 두 축으로 애플리케이션 상태를 판단한다.

| Sync Status | 의미 |
|-------------|------|
| Synced | Git 매니페스트와 클러스터 상태가 일치 |
| OutOfSync | Git과 클러스터가 불일치 (배포 필요) |
| Unknown | 상태를 판단할 수 없음 (연결 불가 등) |

| Health Status | 의미 |
|---------------|------|
| Healthy | 모든 리소스가 정상 동작 |
| Progressing | 배포/롤아웃 진행 중 (예: Rolling update) |
| Degraded | 일부 리소스 비정상 (예: Pod CrashLoopBackOff, 레플리카 부족) |
| Suspended | 의도적으로 중단됨 (예: CronJob, 일시정지된 Deployment) |
| Missing | Git에 정의되었지만 클러스터에 리소스가 없음 |
| Unknown | 건강 상태를 판단할 수 없음 |

| 흔한 조합 | 의미 |
|-----------|------|
| Synced / Healthy | 이상적인 상태. Git과 일치하고 모든 리소스 정상 |
| OutOfSync / Healthy | Git에 새 변경이 있지만 아직 배포 안 됨 |
| Synced / Progressing | 배포 적용 완료, 롤아웃 진행 중 |
| Synced / Degraded | 배포는 했지만 Pod가 정상 기동 실패 |
| OutOfSync / Missing | 리소스가 아예 생성되지 않음 |

**언제 호출되는가:**
- Jenkins: Git 웹훅 수신 시 또는 polling 주기에 코드 변경 감지 시 파이프라인 시작
- ArgoCD: 기본 3분마다 Git 리포지토리를 polling하여 매니페스트 변경 감지
- sync-policy가 automated이면 변경 감지 즉시 자동 배포
- ArgoCD는 내부적으로 대상 클러스터의 kube-apiserver에 kubectl apply를 실행

### 4.2 ArgoCD 멀티 클러스터 배포

```
[ArgoCD (platform 클러스터)]
  │
  ├──kubeconfig──→ [dev 클러스터]      (개발 환경 배포)
  ├──kubeconfig──→ [staging 클러스터]  (스테이징 검증)
  └──kubeconfig──→ [prod 클러스터]     (프로덕션 배포)
```

ArgoCD는 platform 클러스터에 설치되어 있지만, 다른 클러스터의 kubeconfig를 등록하면 원격 클러스터에도 배포할 수 있다. 이것이 platform 클러스터를 "운영 기반 인프라"로 분리한 핵심 이유다.

---

## 5. 서비스 메시 상호작용 (Dev 클러스터)

### 5.1 istiod → Envoy Sidecar (컨트롤 플레인 → 데이터 플레인)

```
[istiod (istio-system)]
  │
  ├──xDS API (15010/15012)──→ [Envoy Sidecar] (demo 네임스페이스의 모든 Pod)
  │   ├→ 라우팅 규칙 배포 (VirtualService → Envoy route config)
  │   ├→ 서비스 디스커버리 (endpoint 목록 → Envoy cluster config)
  │   ├→ mTLS 인증서 배포 (SPIFFE 인증서 자동 갱신)
  │   └→ 정책 적용 (DestinationRule → circuit breaker, connection pool)
  │
  └──admission webhook──→ [kube-apiserver]
      (Pod 생성 시 자동으로 Envoy sidecar 컨테이너 주입)
```

**언제 호출되는가:**
- Pod 생성 시: kube-apiserver가 istiod의 mutating webhook을 호출 → Pod spec에 Envoy sidecar 컨테이너 자동 추가
- VirtualService/DestinationRule 변경 시: istiod가 xDS API로 모든 Envoy에 새 설정을 push (수 초 내)
- 인증서 만료 전: istiod가 자동으로 새 인증서를 생성하여 Envoy에 배포

### 5.2 트래픽 라우팅 체인

```
외부 요청
  │
  ↓
[Istio Ingress Gateway] (istio-ingress 네임스페이스)
  │  Gateway 리소스: port 80, hosts "*"
  │  VirtualService: /api → httpbin, / → nginx-web
  │
  ├─ /api 요청 ──→ [httpbin Envoy Sidecar]
  │                   │
  │                   ├─ x-canary: true 헤더 → [httpbin-v2 Pod]
  │                   └─ 기본: 80% → [httpbin-v1], 20% → [httpbin-v2]
  │                        │
  │                        ├→ [PostgreSQL] (DB 조회)
  │                        ├→ [RabbitMQ] (메시지 발행)
  │                        └→ [Keycloak] (인증 토큰 검증)
  │
  └─ / 요청 ──→ [nginx-web Envoy Sidecar]
                   │
                   ├→ [httpbin] (API 호출, GET만 허용)
                   └→ [Redis] (캐시 조회)
```

**언제 호출되는가:**
- 모든 요청은 대상 Pod에 직접 도달하지 않고, 반드시 Envoy Sidecar를 거친다
- Envoy는 요청을 가로채서: mTLS 검증 → 라우팅 규칙 적용 → 서킷 브레이커 확인 → 대상 전달
- 5xx 에러가 3회 연속 발생하면 DestinationRule의 outlier detection이 해당 Pod를 30초간 제외

### 5.3 CiliumNetworkPolicy + Istio 공존

```
요청 흐름:

[소스 Pod] → [Cilium eBPF (L3/L4 필터링)]
                  │
                  ├─ CiliumNetworkPolicy 검사 (IP, 포트, 프로토콜)
                  │   - 거부 → 패킷 드롭
                  │   - 허용 ↓
                  │
                  └→ [Envoy Sidecar (L7 필터링)]
                       │
                       ├─ mTLS 검증
                       ├─ VirtualService 라우팅
                       ├─ DestinationRule 정책
                       └→ [대상 Pod]
```

Cilium은 L3/L4(IP, 포트)에서 필터링하고, Istio/Envoy는 L7(HTTP 메서드, 헤더, 경로)에서 필터링한다. 이중 보안 레이어로 동작한다.

---

## 6. 오토스케일링 상호작용 (Dev 클러스터)

### 6.1 metrics-server → HPA → Deployment

```
[kubelet] ──cAdvisor 메트릭──→ [metrics-server (kube-system)]
                                  │
                                  ├→ Metrics API (/apis/metrics.k8s.io/v1beta1)
                                  │
                                  ↓
[HPA Controller] (kube-controller-manager 내장)
  │  15초마다 metrics-server에 쿼리
  │  현재 CPU 사용률 vs 목표(50%) 비교
  │
  ├─ CPU > 50% → scale up
  │   └→ Deployment replicas 증가 요청 → kube-apiserver
  │       └→ scheduler가 새 Pod 배치 → kubelet이 컨테이너 생성
  │
  └─ CPU < 50% → scale down (120초 안정화 대기 후)
      └→ Deployment replicas 감소 요청
          └→ PDB(PodDisruptionBudget) 확인 → 최소 가용 Pod 수 보장
```

**언제 호출되는가:**
- metrics-server는 kubelet의 /metrics/resource 엔드포인트를 주기적으로 scrape
- HPA 컨트롤러는 15초마다 metrics API를 조회하여 현재 리소스 사용량 확인
- 목표 CPU 사용률(50%)을 초과하면 즉시 스케일업 (nginx-web: 최대 15초마다 2 Pod 추가)
- 스케일다운은 120초 안정화 기간(stabilizationWindowSeconds) 후 실행
- PDB가 최소 가용 Pod 수를 보장하므로 스케일다운 시에도 서비스 중단 없음

### 6.2 HPA 예시 시나리오

```
시나리오: nginx-web에 부하 증가

t=0s   CPU: 30% (3 replicas)  → 정상
t=15s  CPU: 65% (3 replicas)  → 목표(50%) 초과 감지
t=30s  CPU: 70% (5 replicas)  → 2 Pod 추가 (scaleUp: 2 pods/15s)
t=45s  CPU: 55% (5 replicas)  → 여전히 초과, 추가 스케일업 대기
t=60s  CPU: 45% (5 replicas)  → 목표 이하, 안정화
...
t=180s CPU: 20% (5 replicas)  → 120초 안정화 완료
t=195s CPU: 20% (3 replicas)  → 스케일다운 (PDB: minAvailable=2 보장)
```

---

## 7. SRE 대시보드 상호작용

### 7.1 데이터 수집 체인

```
[SRE Dashboard Backend :3001]
  │
  ├── tart CLI ──→ VM 상태, IP 주소
  │
  ├── SSH (admin/admin) ──→ 각 VM
  │   ├→ top → CPU%
  │   ├→ free → 메모리%
  │   ├→ df → 디스크%
  │   ├→ ss → 오픈 포트
  │   └→ /proc/net/dev → 네트워크 RX/TX
  │
  ├── kubectl (kubeconfig) ──→ 각 클러스터
  │   ├→ get nodes → 노드 상태
  │   ├→ get pods -A → Pod 상태
  │   ├→ get hpa -A → HPA 메트릭
  │   └→ get svc,endpoints → 서비스 목록
  │
  └── kubectl exec cilium-agent ──→ Hubble
      └→ hubble observe → 네트워크 플로

[SRE Dashboard Frontend :3000]
  │
  └── /api/snapshot (5초 폴링) ──→ Backend
      └→ 전체 대시보드 상태 (VMs + 클러스터 + Pod + 리소스)
```

### 7.2 테스트 실행 체인

```
[사용자] ──테스트 실행 클릭──→ [Testing Page]
  │
  ↓
POST /api/tests/run ──→ [Backend]
  │
  ├→ K8s Job 생성 (dev 클러스터, demo 네임스페이스)
  │   ├→ k6 부하 테스트 (load, custom-load, scaling-test, cascade-test)
  │   └→ stress-ng 스트레스 테스트 (stress-cpu, stress-memory)
  │
  ├→ CiliumNetworkPolicy 생성 (테스트 Pod의 egress 허용)
  │
  └→ 2초마다 Job 상태 폴링
      │
      ├→ 완료 시: k6 JSON / stress-ng 출력 파싱 → 결과 저장
      └→ [Testing Page] ←── GET /api/tests/status ←── 결과 표시
```

---

## 8. 도구 간 의존성 요약

| 도구 | 의존하는 도구 | 의존하는 이유 |
|------|-------------|-------------|
| kubelet | containerd | 컨테이너 생성/삭제를 CRI로 요청 |
| kubelet | Cilium | Pod 네트워크 설정을 CNI로 요청 |
| Cilium | kube-apiserver | NetworkPolicy, Service 정보를 watch |
| Hubble | Cilium | Cilium의 eBPF 이벤트를 캡처 |
| Prometheus | node-exporter, kubelet, kube-state-metrics | 메트릭 수집 대상 (scrape target) |
| Grafana | Prometheus, Loki | 데이터소스 (PromQL, LogQL 쿼리) |
| AlertManager | Prometheus | 알림 수신 (Prometheus가 alert를 push) |
| Promtail | Loki | 로그 전송 대상 (HTTP push) |
| HPA | metrics-server | CPU/메모리 메트릭 조회 (Metrics API) |
| metrics-server | kubelet | cAdvisor 메트릭 수집 |
| Envoy Sidecar | istiod | 라우팅/인증서/정책 수신 (xDS API) |
| Istio Gateway | istiod | 게이트웨이 설정 수신 |
| ArgoCD | kube-apiserver (원격) | 매니페스트를 kubectl apply로 배포 |
| Jenkins | Git, ArgoCD | 빌드 후 매니페스트 업데이트 → ArgoCD 감지 |
| Keycloak | PostgreSQL | 사용자/세션 데이터 저장 |
| SRE Dashboard | tart, SSH, kubectl, Hubble | 모든 데이터 수집 경로 |

---

## 9. 장애 전파 시나리오

도구 간 의존관계를 이해하기 위해, 특정 구성 요소에 장애가 발생했을 때 어떤 영향이 전파되는지 살펴본다.

### 시나리오 1: Cilium Agent 장애

```
Cilium Agent 중단
  ├→ 새 Pod에 IP 할당 불가 → Pod가 Pending 상태로 대기
  ├→ NetworkPolicy 업데이트 불가 → 기존 eBPF 규칙은 유지
  ├→ Hubble 데이터 수집 중단 → SRE 대시보드 Traffic 페이지 데이터 없음
  └→ kube-proxy 대체 기능 중단 → Service ClusterIP 라우팅 불가 (신규 연결)
```

### 시나리오 2: Prometheus 장애

```
Prometheus 중단
  ├→ Grafana 대시보드: 데이터 없음 (쿼리 실패)
  ├→ AlertManager: 새 알림 수신 불가 (기존 firing 알림은 유지)
  ├→ HPA: 영향 없음 (metrics-server는 독립 동작)
  └→ 메트릭 유실: 중단 기간의 메트릭은 복구 불가
```

### 시나리오 3: istiod 장애

```
istiod 중단
  ├→ 기존 Envoy Sidecar: 마지막 수신한 설정으로 계속 동작
  ├→ 새 Pod: Sidecar 주입 실패 → Envoy 없이 생성 (mesh 밖에서 동작)
  ├→ mTLS 인증서: 만료 시 갱신 불가 → 서비스 간 통신 차단
  └→ VirtualService 변경: 반영 불가 (기존 라우팅은 유지)
```

### 시나리오 4: metrics-server 장애

```
metrics-server 중단
  ├→ HPA: 메트릭 조회 실패 → 현재 레플리카 수 유지 (스케일링 중단)
  ├→ kubectl top: 명령어 실패
  ├→ SRE 대시보드 Scaling 페이지: HPA 상태 "Unknown"
  └→ Prometheus: 영향 없음 (별도 수집 경로)
```

---

## 10. 요청 처리 전체 흐름 예시

사용자가 `http://<dev-worker-ip>:30080`에 접속했을 때 일어나는 일:

```
1. [사용자 브라우저] → HTTP GET / → [dev-worker1:30080]

2. [kube-proxy/Cilium eBPF] → NodePort 30080 → nginx-web Service → Pod 선택

3. [Cilium NetworkPolicy] → allow-external-to-nginx 규칙 확인 → 허용

4. [Envoy Sidecar (inbound)] → mTLS 종단 → 요청을 nginx 컨테이너로 전달

5. [nginx 컨테이너] → 정적 페이지 응답 반환

6. [nginx → httpbin 호출 시]
   → [Envoy Sidecar (outbound)]
   → mTLS 시작 + VirtualService 라우팅
   → 80% 확률로 httpbin-v1, 20% 확률로 httpbin-v2
   → [Cilium] allow-nginx-to-httpbin 확인 (GET만 허용)
   → [Envoy Sidecar (httpbin inbound)]
   → [httpbin 컨테이너]

7. [httpbin → PostgreSQL 호출 시]
   → [Envoy Sidecar (outbound)]
   → [Cilium] allow-httpbin-to-postgres 확인
   → [postgres 컨테이너:5432]

8. [모니터링 동시 발생]
   - Prometheus가 nginx Pod의 메트릭 scrape (15초마다)
   - Promtail이 nginx 로그를 Loki에 push
   - Hubble이 이 전체 트래픽 플로를 기록
   - metrics-server가 CPU 사용량 수집 → HPA가 스케일링 판단
```
