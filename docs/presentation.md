---
marp: true
theme: default
paginate: true
backgroundColor: #1a1a2e
color: #eaeaea
style: |
  section {
    font-family: 'Pretendard', 'Apple SD Gothic Neo', sans-serif;
    padding: 40px 60px;
  }
  h1 { color: #00d2ff; font-size: 2.2em; border-bottom: 3px solid #00d2ff; padding-bottom: 10px; }
  h2 { color: #7b2ff7; font-size: 1.7em; }
  h3 { color: #00d2ff; font-size: 1.3em; }
  strong { color: #ff6b6b; }
  code { background: #16213e; color: #0ff; padding: 2px 8px; border-radius: 4px; }
  pre { background: #16213e !important; border-radius: 8px; }
  table { font-size: 0.75em; }
  th { background: #7b2ff7; color: white; }
  td { background: #16213e; }
  blockquote { border-left: 4px solid #ff6b6b; background: #16213e; padding: 10px 20px; font-size: 0.9em; }
  a { color: #00d2ff; }
  .columns { display: flex; gap: 30px; }
  .col { flex: 1; }
  img[alt~="center"] { display: block; margin: 0 auto; }
  section.lead h1 { border: none; text-align: center; font-size: 2.8em; }
  section.lead h2 { text-align: center; color: #eaeaea; font-size: 1.3em; font-weight: 300; }
  section.lead p { text-align: center; }
---

<!-- _class: lead -->

# Tart Multi-Cluster K8s Infrastructure

## Apple Silicon Mac 한 대로 구축하는
## 프로덕션급 멀티클러스터 Kubernetes + SRE 운영 대시보드

---

# 목차

1. **프로젝트 소개** — 무엇을, 왜 만들었는가
2. **구현** — 아키텍처, 기술 스택, 자동화 파이프라인
3. **시나리오별 동작 원리** — 실제로 어떻게 흘러가는가
4. **구현 과정에서 어려웠던 점** — 19건의 버그와 해결 과정
5. **결과** — 최종 산출물과 의미

---

<!-- _class: lead -->

# 1. 프로젝트 소개

---

# 이 프로젝트가 해결하는 문제

### 수동으로 멀티클러스터 K8s를 구축하면?

```
VM 10대 하나씩 생성 → IP 10번 확인 → SSH 10번 접속 → swap/커널 설정
→ containerd 10번 설치 → kubeadm 10번 설치 → 4개 클러스터 init
→ 6대 worker join → Cilium 4번 → Prometheus/Jenkins/ArgoCD 설치 → ...
```

> **수동 소요 시간: 1~2시간**, 수십 번의 SSH 접속, 수백 줄의 명령어
> 한 단계라도 빠뜨리면 클러스터가 정상 동작하지 않는다

### 이 프로젝트의 해결 방식

```bash
./scripts/demo.sh    # 명령어 한 줄로 전체 인프라 + 대시보드까지
```

> **자동 소요 시간: 15~20분** (골든 이미지 사용 시)

---

# 프로젝트 개요

<div class="columns">
<div class="col">

### 한 줄 요약
Apple Silicon Mac **한 대**에서
VM 10대 → K8s 4개 클러스터 →
CNCF 오픈소스 20+ 종 자동 설치 →
SRE 대시보드로 통합 관제

### 핵심 수치

| 항목 | 값 |
|------|-----|
| VM | **10대** |
| K8s 클러스터 | **4개** (platform/dev/staging/prod) |
| 총 vCPU | **21 코어** |
| 총 메모리 | **68 GB** |
| 오픈소스 도구 | **28종** |
| 자동화 단계 | **17 Phase** |
| 설치 소요시간 | **15~20분** |

</div>
<div class="col">

### 클러스터 역할 분리
```
platform ─── 모니터링 + CI/CD + 알림
             (Prometheus, Grafana, Loki,
              Jenkins, ArgoCD, AlertManager)

dev ──────── 서비스 메시 + 데모 앱 + 보안
             (Istio, 6종 앱, NetworkPolicy,
              HPA, 카나리 배포)

staging ──── 배포 전 검증 (최소 구성)
             (metrics-server만)

prod ─────── 프로덕션 배포 대상
             (ArgoCD GitOps 타겟)
```

</div>
</div>

---

<!-- _class: lead -->

# 2. 구현

---

# 전체 아키텍처

```
┌────────────────────────────────────────────────────────────────────┐
│  MacBook Pro Apple Silicon (M4 Max · 16 CPU / 128GB RAM)          │
│                                                                    │
│  ┌──── Tart VM Layer (Apple Hypervisor.framework · ARM64) ─────┐  │
│  │                                                              │  │
│  │  ┌── platform (7C/24G) ──┐   ┌── dev (4C/12G) ──────────┐  │  │
│  │  │ master  + worker×2    │   │ master + worker×1         │  │  │
│  │  │ Prometheus, Grafana   │   │ Istio, 6종 데모앱         │  │  │
│  │  │ Jenkins, ArgoCD       │   │ NetworkPolicy, HPA        │  │  │
│  │  └───────────────────────┘   └───────────────────────────┘  │  │
│  │  ┌── staging (4C/12G) ───┐   ┌── prod (6C/20G) ─────────┐  │  │
│  │  │ master + worker×1     │   │ master + worker×2         │  │  │
│  │  │ metrics-server        │   │ ArgoCD 배포 대상          │  │  │
│  │  └───────────────────────┘   └───────────────────────────┘  │  │
│  │  Total: 10 VMs / 21 vCPU / 68 GB RAM                     │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                    │
│  ┌─ SRE Dashboard ──┐  ┌─ IaC ────────────┐  ┌─ CI/CD ────────┐  │
│  │ React 19+Express │  │ Bash 17-Phase    │  │ ArgoCD GitOps  │  │
│  │ 6 Pages·11 APIs  │  │ Terraform        │  │ Jenkins CI     │  │
│  └──────────────────┘  └──────────────────┘  └────────────────┘  │
└────────────────────────────────────────────────────────────────────┘
```

---

# 기술 스택 — 8계층 구조

| 계층 | 기술 | 역할 |
|------|------|------|
| **L7 — 대시보드** | React 19, Vite 7, Express 5, TypeScript | SRE 운영 대시보드 (6페이지, 11 API) |
| **L6 — 서비스 메시** | Istio + Envoy | mTLS, 카나리 배포, 서킷브레이커 |
| **L5 — 옵저버빌리티** | Prometheus, Grafana, Loki, AlertManager, Hubble | 메트릭/로그/네트워크 관측 + 알림 |
| **L4 — 네트워크 보안** | CiliumNetworkPolicy | L3/L4/L7 제로 트러스트 |
| **L3 — 오케스트레이션** | Kubernetes v1.31 (kubeadm), HPA, metrics-server | 컨테이너 오케스트레이션 + 오토스케일링 |
| **L2 — 네트워크 (CNI)** | Cilium (eBPF) | kube-proxy 완전 대체, L7 정책 |
| **L1 — 런타임** | containerd | K8s CRI, SystemdCgroup |
| **L0 — 가상화** | Tart (Apple Hypervisor.framework) | ARM64 네이티브 VM |

> 추가: Jenkins + ArgoCD (CI/CD), Helm (패키지), Terraform (IaC)
> 데모앱: nginx, httpbin, Redis, PostgreSQL, RabbitMQ, Keycloak

---

# 17단계 자동화 파이프라인

```
clusters.json (Single Source of Truth)
    │
    └─→ install.sh
          │
          ├─ 01. VM 생성         ← Tart로 10대 복제 + 리소스 할당     ─┐
          ├─ 02. 노드 준비       ← swap off, 커널 모듈, sysctl        │ 골든 이미지
          ├─ 03. 런타임 설치     ← containerd + SystemdCgroup          │ 사용 시
          ├─ 04. K8s 도구 설치   ← kubeadm, kubelet, kubectl v1.31   ─┘ Phase 2~4 스킵
          ├─ 05. 클러스터 초기화 ← kubeadm init + worker join ×4 클러스터
          ├─ 06. CNI 설치        ← Cilium eBPF + Hubble (전체)
          ├─ 07. 모니터링        ← Prometheus + Grafana + Loki (platform)
          ├─ 08. CI/CD           ← Jenkins + ArgoCD (platform)
          ├─ 09. 알림            ← AlertManager + PrometheusRule (platform)
          ├─ 10. 네트워크 정책   ← CiliumNetworkPolicy L7 (dev)
          ├─ 11. 오토스케일링    ← metrics-server + HPA + PDB (dev, staging)
          └─ 12. 서비스 메시     ← Istio mTLS + 카나리 + 서킷브레이커 (dev)
```

---

# SRE 운영 대시보드

<div class="columns">
<div class="col">

### 6개 페이지

| 페이지 | 기능 |
|--------|------|
| **Overview** | 4개 클러스터 2×2 요약 카드 |
| **Cluster Detail** | 노드별 CPU/MEM/Disk 게이지 |
| **Traffic** | Hubble 네트워크 토폴로지 |
| **Scaling** | HPA 스케일링 시계열 차트 |
| **Testing** | 16개 프리셋 + 커스텀 테스트 |
| **Load Analysis** | 부하 테스트 종합 분석 |

### 데이터 수집
- VM 메트릭: SSH (5초)
- K8s 상태: kubectl (5초)
- 네트워크: Hubble (10초)
- 서비스: kubectl (30초)

</div>
<div class="col">

### 11개 백엔드 API

```
GET  /api/health          서버 상태
GET  /api/snapshot         전체 인프라 스냅샷
GET  /api/traffic/all      전체 트래픽
GET  /api/traffic?cluster= 클러스터별 트래픽
GET  /api/cluster/:name/services
POST /api/tests/run        테스트 실행
GET  /api/tests/status     테스트 상태
DEL  /api/tests/:id        테스트 삭제
GET  /api/tests/export     CSV 다운로드
GET  /api/scaling          전체 HPA
GET  /api/scaling/:cluster HPA 시계열
```

### 기술 스택
Frontend: React 19 + Vite 7 + Tailwind 4
Backend: Express 5 + ssh2 + execa

</div>
</div>

---

<!-- _class: lead -->

# 3. 시나리오별 동작 원리

---

# 시나리오 1: 외부 요청이 nginx에 도달하기까지

```
사용자 브라우저 → http://<dev-worker-ip>:30080
   │
   ↓
① Cilium eBPF  ─── NodePort 30080 → nginx-web Service → Pod 선택
   │
   ↓
② CiliumNetworkPolicy  ─── allow-external-to-nginx 규칙 확인 → 허용
   │
   ↓
③ Envoy Sidecar (inbound)  ─── mTLS 종단 → nginx 컨테이너로 전달
   │
   ↓
④ nginx 컨테이너  ─── 정적 페이지 응답 반환
```

> Cilium이 **L3/L4** (IP, 포트)에서 필터링
> Envoy가 **L7** (HTTP 메서드, 헤더)에서 필터링
> **이중 보안 레이어**로 동작

---

# 시나리오 2: 3-Tier 앱 요청 체인

```
nginx ──→ httpbin ──→ PostgreSQL / Redis / RabbitMQ
 (웹)      (API)       (DB)      (캐시)   (메시지큐)
```

각 단계마다 **3가지 검증**을 통과해야 한다:

| 단계 | Cilium (L3/L4) | Envoy (L7) | Istio (트래픽) |
|------|----------------|------------|----------------|
| nginx → httpbin | `allow-nginx-to-httpbin` | **GET만 허용** (POST 차단) | 80% v1, 20% v2 카나리 |
| httpbin → postgres | `allow-httpbin-to-postgres` | TCP 5432 | mTLS 암호화 |
| httpbin → redis | — (nginx→redis만 허용) | **차단됨** | — |
| httpbin → rabbitmq | `allow-httpbin-to-rabbitmq` | AMQP 5672 | mTLS 암호화 |

> httpbin이 redis에 직접 접근하면 **NetworkPolicy에 의해 차단**된다
> 반드시 nginx → redis 경로만 허용 — 제로 트러스트

---

# 시나리오 3: 부하 발생 → HPA 오토스케일링

```
t=0s    부하 시작                    CPU: 30%  (3 replicas)   정상
t=15s   metrics-server → HPA 감지   CPU: 65%  (3 replicas)   50% 초과!
t=30s   HPA → Deployment 스케일업   CPU: 70%  (5 replicas)   +2 Pod
t=45s   계속 모니터링               CPU: 55%  (5 replicas)   안정화 중
  ...
t=180s  부하 종료 + 120s 안정화     CPU: 20%  (5 replicas)   스케일다운 대기
t=195s  HPA → 스케일다운            CPU: 20%  (3 replicas)   PDB 보장
```

<div class="columns">
<div class="col">

### 동작 흐름
```
kubelet → metrics-server → HPA 컨트롤러
              (15초마다)
                 │
     ┌───────────┴───────────┐
     │ CPU > 50% → 스케일업  │
     │ CPU < 50% → 스케일다운│
     └───────────────────────┘
                 │
         Deployment replicas 변경
                 │
         PDB 최소 가용성 보장
```

</div>
<div class="col">

### HPA 설정 요약

| 대상 | 범위 | CPU 목표 |
|------|------|---------|
| nginx | 3→10 | 50% |
| httpbin | 2→6 | 50% |
| redis | 1→4 | 50% |
| postgres | 1→4 | 50% |
| rabbitmq | 1→3 | 50% |

스케일다운 안정화: **120초**

</div>
</div>

---

# 시나리오 4: 모니터링 → 알림 파이프라인

```
각 노드 [node-exporter]  ──:9100──→  [Prometheus]  ──규칙 평가(30초)──→
                                          │
각 노드 [Promtail]  ──push──→  [Loki]    │   조건 위반 시
                                  │       ↓
                            [Grafana] ← [AlertManager]  ──webhook──→  [Webhook Logger]
                          PromQL/LogQL      │
                            시각화       그룹핑 + 라우팅
                                        severity별 분리
```

### AlertManager 규칙 예시

| 규칙 | 조건 | 심각도 | 대기 |
|------|------|--------|------|
| HighCpuUsage | CPU > 80% 5분 지속 | warning | 30초 |
| NodeNotReady | 노드 비정상 5분 지속 | **critical** | **10초** |
| PodCrashLooping | 15분 내 5회 재시작 | warning | 30초 |
| PodOOMKilled | OOM 종료 감지 | warning | 30초 |

> critical 알림은 **10초** 만에 전달, 동일 alertname의 warning은 **억제**

---

# 시나리오 5: GitOps 배포 (Jenkins → ArgoCD → 클러스터)

```
개발자 git push → [Jenkins :30900]
                      │
                      ├─ 1. Validate ── kubectl --dry-run 문법 검증
                      ├─ 2. Security ── 하드코딩 시크릿/리소스 제한 검사
                      ├─ 3. Deploy ──── ArgoCD app sync 트리거
                      ├─ 4. Rollout ─── 6개 Deployment rollout 대기
                      ├─ 5. Health ──── Pod/HPA/Service 상태 확인
                      ├─ 6. Integration  nginx/redis/postgres 연결 검증
                      └─ 7. Smoke ───── E2E 체인 + L7 정책 검증

[ArgoCD :30800] ←── Git polling (3분)
      │
      ├──→ dev 클러스터      (개발 환경)
      ├──→ staging 클러스터  (사전 검증)
      └──→ prod 클러스터     (프로덕션)
```

> ArgoCD는 **platform** 클러스터에 설치, **원격 클러스터**에 배포
> Git이 **Single Source of Truth** — 수동 변경 시 자동 복구 (selfHeal)

---

# 시나리오 6: Istio 카나리 배포 + 서킷브레이커

<div class="columns">
<div class="col">

### 카나리 배포 (httpbin)
```
요청 → Istio Ingress Gateway
         │
         ├─ Header "x-canary: true"
         │   └→ httpbin-v2 (100%)
         │
         └─ 기본 요청
             ├→ httpbin-v1 (80%)
             └→ httpbin-v2 (20%)
```

점진적으로 v2 비율을 올려
안전하게 새 버전을 배포

</div>
<div class="col">

### 서킷브레이커
```
정상 상태:  요청 → httpbin Pod
                     ↓ 정상 응답

장애 감지:  5xx 에러 3회 연속
            → 해당 Pod 30초 격리 (ejection)
            → 나머지 Pod로 트래픽 전환

복구:       30초 후 자동 복귀
            → 다시 5xx 발생 시 재격리
```

최대 50%의 엔드포인트만 격리
서비스 전체 다운 방지

</div>
</div>

> **PeerAuthentication: STRICT** — 모든 Pod 간 통신이 mTLS로 암호화
> 인증서는 istiod가 자동 발급·갱신

---

<!-- _class: lead -->

# 4. 구현 과정에서 어려웠던 점

---

# 총 19건의 버그 — 3단계에 걸쳐 발생

| 단계 | 시기 | 버그 수 | 심각도 |
|------|------|---------|--------|
| **VM 배포** | Phase 1 | 4건 | Critical ×2, High ×2 |
| **클러스터 설치** | Phase 2~12 | 7건 | Critical ×2, High ×4, Medium ×1 |
| **대시보드 개발** | 프론트/백엔드 | 8건 | High ×2, Medium ×4, Low ×2 |

### 카테고리별 분포

| 카테고리 | 건수 | 대표 버그 |
|----------|------|----------|
| 네트워크/CNI | 3 | VM간 통신 차단, Cilium 부트스트랩 순환의존성 |
| VM/런타임 | 3 | tart --config 미지원, cloud-init 미지원 |
| SSH/스크립트 | 4 | 따옴표 이스케이핑, 변수 충돌, wc 파싱 |
| K8s/CI-CD | 3 | conntrack 누락, Jenkins PVC, CPU 부족 |
| 대시보드 | 4 | ESM __dirname, tart list 파싱, Tailwind JIT |
| 설정 | 2 | Vite 포트 충돌, k6 NetworkPolicy 차단 |

---

# 난관 1: VM간 통신 불가 (Critical)

### 문제
Worker 노드가 Master에 `kubeadm join` 시도 → **ping 자체가 실패**
```
$ ping 192.168.64.5
Destination Host Unreachable
```

### 원인
Tart의 기본 NAT 네트워킹은 **호스트 → VM**만 허용
**VM → VM** 직접 통신은 차단됨

### 해결
```bash
# Softnet 플래그를 발견하여 VM간 통신 활성화
tart run <vm> --no-graphics --net-softnet-allow=0.0.0.0/0
```

> Tart 공식 문서에서도 잘 드러나지 않는 옵션
> 이 한 줄이 없으면 멀티노드 K8s 클러스터 자체가 불가능

---

# 난관 2: Cilium 부트스트랩 순환의존성 (Critical)

### 문제
kube-proxy를 Cilium으로 대체하기 위해 `--skip-phases=addon/kube-proxy`로 init
→ Cilium 설치 시 **K8s API Server에 접근 불가** (ClusterIP 10.96.0.1 타임아웃)

### 원인 — 닭과 달걀 문제
```
Cilium이 ClusterIP 라우팅을 제공해야 하는데
    → Cilium 자신이 설치되려면 ClusterIP로 API Server에 접근해야 함
        → 하지만 kube-proxy가 없으므로 ClusterIP 라우팅이 없음
            → Cilium 설치 실패 → 무한 루프
```

### 해결
```bash
# ClusterIP를 우회하여 Master 노드의 실제 IP를 직접 지정
helm install cilium cilium/cilium \
  --set k8sServiceHost="$MASTER_IP" \   # 10.96.0.1 대신 실제 IP
  --set k8sServicePort=6443
```

> Cilium 공식 문서의 kubeProxyReplacement 가이드에서 힌트를 얻음

---

# 난관 3: 골든 이미지 만들기

### 문제
Phase 2~4 (OS 준비 + containerd + kubeadm)를 10대에 매번 반복 → **30분+ 소모**

### 해결: 골든 이미지 패턴

```bash
./scripts/build-golden-image.sh    # 1회 빌드 (~10분)
```

```
① base 이미지 pull (ghcr.io/cirruslabs/ubuntu:latest)
② 임시 VM 생성 (k8s-golden-build)
③ OS 준비: swap off, 커널 모듈, sysctl
④ containerd 설치 + SystemdCgroup 설정
⑤ kubeadm, kubelet, kubectl v1.31 설치
⑥ K8s + Cilium 컨테이너 이미지 미리 pull
⑦ 마커 파일 생성 (/etc/k8s-golden) + apt 캐시 정리
⑧ VM 정지 → "k8s-golden"으로 저장
```

### 골든 이미지 저장 경로
```
~/.tart/vms/k8s-golden/
├── config.json      # VM 설정 (CPU, 메모리)
├── disk.img         # 디스크 이미지 (~20GB)
└── nvram.bin        # UEFI NVRAM
```

> `config/clusters.json`의 `base_image`를 `"k8s-golden"`으로 변경하면
> install.sh가 Phase 2~4를 자동 스킵 → **45분 → 15분**

---

# 난관 4: SSH 따옴표 이스케이핑 지옥

### 문제
```bash
ssh_exec_sudo "$IP" "sed -i 's/SystemdCgroup = false/SystemdCgroup = true/' /etc/containerd/config.toml"
```
→ `unterminated 's' command` 에러

### 원인
`bash -c '$*'` 래핑 → 중첩된 따옴표가 쉘 해석 과정에서 파괴됨
```
호스트 쉘 → ssh → 원격 bash -c → sudo bash -c → 실제 명령
                     ↑ 여기서 따옴표 소실
```

### 해결: Heredoc 방식으로 전환
```bash
# Before (깨짐)
sshpass -p "$pw" ssh ... "sudo bash -c '$*'"

# After (안전)
sshpass -p "$pw" ssh ... sudo bash -s <<EOF
$*
EOF
```

> Heredoc은 쉘 해석을 거치지 않으므로 모든 특수문자가 안전하게 전달

---

# 난관 5: 대시보드 개발 시 만난 함정들

<div class="columns">
<div class="col">

### ESM `__dirname` 미정의
```typescript
// package.json: "type": "module"
// → __dirname, __filename 사용 불가

// 해결: ESM 방식으로 교체
import { fileURLToPath } from 'url';
const __dirname = dirname(
  fileURLToPath(import.meta.url)
);
```

### `tart list` 파싱 오류
```
# "30m ago" 같은 공백 포함 컬럼 때문에
# 고정 인덱스 파싱 실패 → VM 상태가 "20"

# 해결: 마지막 컬럼 사용
const state = parts[parts.length - 1];
```

</div>
<div class="col">

### Tailwind JIT 동적 클래스 실패
```typescript
// Before (작동 안 함)
bgClass: `bg-${color}/10`

// After (작동)
bgClass: 'bg-blue-400/10'
// Tailwind JIT는 정적 분석만 가능
```

### k6 테스트가 전부 타임아웃
```
원인: default-deny NetworkPolicy가
      k6 Pod의 egress를 차단

해결: 테스트 Job 생성 시
      CiliumNetworkPolicy 예외 자동 적용
      (label: sre-test: "true")
```

</div>
</div>

---

# 난관들에서 얻은 교훈

| 교훈 | 설명 |
|------|------|
| **네트워크가 기반이다** | VM간 통신이 안 되면 그 위의 모든 것이 무너진다 |
| **부트스트랩 순환의존성** | kube-proxy 대체 시 반드시 실제 IP 우회 필요 |
| **CLI 출력 파싱은 취약하다** | 고정 인덱스 대신 마지막 컬럼, 헤더 기반 파싱 사용 |
| **쉘 스크립트 변수 스코핑** | source 시 변수 충돌 — 라이브러리는 `_` 접두사 |
| **Helm 차트 Breaking Change** | 버전 올리면 키 이름이 바뀔 수 있다 — 릴리스 노트 확인 |
| **제로 트러스트의 부작용** | default-deny는 내부 테스트 도구도 차단한다 |
| **골든 이미지 = 시간 절약** | 반복 작업을 이미지에 굽는 것이 가장 효과적 |

---

<!-- _class: lead -->

# 5. 결과

---

# 최종 산출물

<div class="columns">
<div class="col">

### 인프라 자동화
- VM 10대 + K8s 4개 클러스터
  **명령어 한 줄**로 구축
- 17단계 파이프라인 완전 자동화
- 골든 이미지로 **15분 내 완료**
- 부팅/종료/상태확인 스크립트

### CI/CD 파이프라인
- **Jenkins** 7단계 CI 파이프라인
  (검증→보안→배포→헬스체크→테스트)
- **ArgoCD** GitOps 배포
  (Git = Single Source of Truth)
- 멀티 클러스터 자동 배포

</div>
<div class="col">

### SRE 운영 대시보드
- **6개 페이지** 실시간 모니터링
- **16개 테스트 시나리오** 프리셋
- 부하 테스트 → 스케일링 → 분석
  **end-to-end** 관측
- CSV 결과 다운로드

### 문서화
- **19건 버그 리포트**
  (원인 분석 → 해결 과정 전체 기록)
- **5편 학습 문서**
  (아키텍처, 네트워크, IaC, 모니터링, 트러블슈팅)
- 클러스터별 활용 가이드
- 도구 간 상호작용 문서

</div>
</div>

---

# 적용한 CNCF 오픈소스 — 28종

```
┌─ 가상화/OS ────────────────────────────────────────────────────────┐
│  Tart · Ubuntu                                                     │
├─ 런타임/네트워크 ──────────────────────────────────────────────────┤
│  containerd · Cilium (eBPF) · Hubble                               │
├─ 오케스트레이션 ───────────────────────────────────────────────────┤
│  Kubernetes · Helm · metrics-server                                │
├─ 옵저버빌리티 ─────────────────────────────────────────────────────┤
│  Prometheus · Grafana · Loki · Promtail · AlertManager             │
├─ 서비스 메시 ──────────────────────────────────────────────────────┤
│  Istio · Envoy                                                     │
├─ CI/CD · IaC ──────────────────────────────────────────────────────┤
│  ArgoCD · Jenkins · Terraform                                      │
├─ 데모 앱/미들웨어 ─────────────────────────────────────────────────┤
│  nginx · httpbin · PostgreSQL · Redis · RabbitMQ · Keycloak        │
├─ 대시보드 ─────────────────────────────────────────────────────────┤
│  React · Vite · TypeScript · Tailwind CSS · Express · Node.js      │
├─ 테스트 ───────────────────────────────────────────────────────────┤
│  k6 · stress-ng                                                    │
└────────────────────────────────────────────────────────────────────┘
```

---

# 프로젝트의 의미

### 기술적 의미

> Apple Silicon Mac **한 대**로 실무 수준의 멀티클러스터 K8s 환경을
> **재현 가능하게** 구축할 수 있음을 증명

- 클라우드 없이 **로컬에서** 프로덕션급 인프라 학습 가능
- VM 생성부터 서비스 메시까지 **end-to-end 자동화**
- 실시간 모니터링 + 부하 테스트 + 오토스케일링 **직접 관찰**

### 학습적 의미

| 영역 | 학습한 것 |
|------|----------|
| 인프라 | Tart VM, containerd, Cilium eBPF, Kubernetes kubeadm |
| 네트워크 | CiliumNetworkPolicy L7, Istio mTLS, 카나리, 서킷브레이커 |
| 옵저버빌리티 | Prometheus + Grafana + Loki + AlertManager + Hubble |
| CI/CD | Jenkins Pipeline, ArgoCD GitOps, 멀티클러스터 배포 |
| SRE | 부하 테스트(k6), 오토스케일링(HPA), 장애 대응, 운영 대시보드 |
| 트러블슈팅 | 19건의 실전 버그 해결 경험 |

---

<!-- _class: lead -->

# 감사합니다

**GitHub**: github.com/iamywl/IaC_apple_sillicon

명령어 한 줄로 시작:
```bash
./scripts/demo.sh
```
