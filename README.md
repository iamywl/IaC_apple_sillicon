# Tart Multi-Cluster Kubernetes Infrastructure

Apple Silicon Mac 한 대에서 **프로덕션급 멀티클러스터 K8s 환경**을 자동으로 구축하는 프로젝트.

Tart VM 위에 kubeadm으로 4개 클러스터(10 VM)를 생성하고, Cilium CNI · Istio Service Mesh · Prometheus 모니터링 · ArgoCD GitOps · Terraform IaC까지 전체 스택을 포함한다.

---

## 요구 사항

| 항목 | 최소 | 권장 |
|------|------|------|
| Mac | Apple Silicon (M1 이상) | M4 Max |
| RAM | 64 GB | 128 GB |
| 디스크 | 100 GB 여유 | 200 GB+ |
| macOS | 13 Ventura 이상 | 최신 |

---

## 설치 및 실행

### 1단계: 저장소 클론

```bash
git clone https://github.com/iamywl/IaC_apple_sillicon.git
cd IaC_apple_sillicon
```

### 2단계: 의존성 설치

```bash
brew install tart kubectl helm jq sshpass terraform
```

| 도구 | 용도 |
|------|------|
| `tart` | Apple Hypervisor 기반 ARM64 VM 관리 |
| `kubectl` | Kubernetes CLI |
| `helm` | K8s 패키지 매니저 |
| `jq` | JSON 파서 (설정 파일 파싱) |
| `sshpass` | SSH 비밀번호 자동 입력 |
| `terraform` | Infrastructure as Code |

### 3단계: 전체 설치 (한 줄)

```bash
./scripts/install.sh
```

이 명령 하나로 다음이 **자동으로** 실행된다:

```
Phase 1  → VM 10개 생성 (tart clone + 리소스 할당)
Phase 2  → 노드 준비 (swap off, kernel modules, sysctl)
Phase 3  → containerd 설치
Phase 4  → kubeadm, kubelet, kubectl 설치
Phase 5  → K8s 4개 클러스터 초기화 (kubeadm init + worker join)
Phase 6  → Cilium CNI + Hubble 설치 (전체 클러스터)
Phase 7  → Prometheus + Grafana + Loki 모니터링 (platform)
Phase 8  → Jenkins + ArgoCD CI/CD (platform)
Phase 9  → AlertManager + 알림 규칙 (platform)
Phase 10 → CiliumNetworkPolicy L7 보안 (dev)
Phase 11 → metrics-server + HPA 오토스케일링 (dev, staging)
Phase 12 → Istio Service Mesh (dev)
```

소요 시간: 약 45~60분 (네트워크 속도에 따라 상이)

### 3단계 (대안): Terraform으로 설치

```bash
cd terraform
terraform init
terraform plan     # 변경 사항 미리보기
terraform apply    # 인프라 프로비저닝
```

---

## 일상 운영

### 맥북 켰을 때

```bash
./scripts/boot.sh
```

VM 10개 시작 → 클러스터 헬스체크 → 서비스 검증까지 자동 수행.

### 상태 확인

```bash
./scripts/status.sh
```

모든 VM 상태, 4개 클러스터 노드 Ready 여부, Platform 서비스 Pod 상태를 한눈에 확인.

### 맥북 끄기 전

```bash
./scripts/shutdown.sh
```

워커 노드 drain → VM graceful stop. 데이터 손실 없이 안전하게 종료.

### 전체 삭제

```bash
./scripts/destroy.sh
# 또는
cd terraform && terraform destroy
```

---

## 서비스 접속

VM IP는 DHCP이므로 재부팅 시 변경될 수 있다. 아래 명령으로 확인:

```bash
tart ip platform-worker1
```

### Platform 클러스터 서비스

| 서비스 | URL | 계정 |
|--------|-----|------|
| Grafana | `http://<platform-worker1>:30300` | admin / admin |
| AlertManager | `http://<platform-worker1>:30903` | — |
| ArgoCD | `http://<platform-worker1>:30800` | admin / 아래 명령 |
| Jenkins | `http://<platform-worker1>:30900` | admin / admin |
| Hubble UI | `http://<platform-worker1>:31235` | — |

```bash
# ArgoCD 비밀번호 확인
kubectl --kubeconfig kubeconfig/platform.yaml \
  -n argocd get secret argocd-initial-admin-secret \
  -o jsonpath="{.data.password}" | base64 -d && echo
```

### Dev 클러스터 서비스

| 서비스 | URL |
|--------|-----|
| Nginx 데모 | `http://<dev-worker1>:30080` |
| Istio Gateway | NodePort (자동 할당) |

### kubectl 접속

```bash
# 클러스터별
kubectl --kubeconfig kubeconfig/platform.yaml get nodes
kubectl --kubeconfig kubeconfig/dev.yaml get nodes
kubectl --kubeconfig kubeconfig/staging.yaml get nodes
kubectl --kubeconfig kubeconfig/prod.yaml get nodes

# 멀티 클러스터 통합
export KUBECONFIG=kubeconfig/platform.yaml:kubeconfig/dev.yaml:kubeconfig/staging.yaml:kubeconfig/prod.yaml
kubectl config get-contexts

# SSH 접속 (모든 VM 공통)
ssh admin@$(tart ip dev-worker1)    # 비밀번호: admin
```

---

## 아키텍처

```
┌───────────────────────────────────────────────────────────────┐
│  MacBook Pro Apple Silicon (16 CPU / 128GB RAM)               │
│                                                               │
│  ┌─────────────── platform 클러스터 ──────────────┐           │
│  │  master (2C/4G)                                │           │
│  │  worker1 (3C/12G) ← Prometheus, Grafana, Loki, │           │
│  │                      AlertManager               │           │
│  │  worker2 (2C/8G)  ← Jenkins, ArgoCD            │           │
│  └────────────────────────────────────────────────┘           │
│                                                               │
│  ┌──── dev 클러스터 ──────────┐  ┌── staging 클러스터 ──┐     │
│  │  master (2C/4G)            │  │  master (2C/4G)      │     │
│  │  worker1 (2C/8G)           │  │  worker1 (2C/8G)     │     │
│  │  ├ Istio Service Mesh      │  │                      │     │
│  │  ├ metrics-server + HPA    │  │  metrics-server      │     │
│  │  └ CiliumNetworkPolicy     │  │                      │     │
│  └────────────────────────────┘  └──────────────────────┘     │
│                                                               │
│  ┌─────────────── prod 클러스터 ──────────────────┐           │
│  │  master (2C/3G)  worker1 (2C/8G)  worker2 (2C/8G)│           │
│  └───────────────────────────────────────────────────┘           │
│                                                               │
│  총 10 VM / 21 vCPU / ~71.5GB RAM                             │
└───────────────────────────────────────────────────────────────┘
```

### 클러스터 역할

| 클러스터 | 노드 | 역할 | Pod CIDR | Service CIDR |
|----------|------|------|----------|--------------|
| **platform** | 3 (7C / 24G) | 모니터링 · CI/CD · 알림 | 10.10.0.0/16 | 10.96.0.0/16 |
| **dev** | 2 (4C / 12G) | 개발 · Istio · HPA · NetworkPolicy | 10.20.0.0/16 | 10.97.0.0/16 |
| **staging** | 2 (4C / 12G) | 프로덕션 전 검증 | 10.30.0.0/16 | 10.98.0.0/16 |
| **prod** | 3 (6C / 19.5G) | 프로덕션 워크로드 | 10.40.0.0/16 | 10.99.0.0/16 |

---

## 기술 스택

### 가상화 & OS

| 기술 | 역할 | 왜 선택했는가 |
|------|------|--------------|
| [Tart](https://tart.run/) | VM 런타임 | Apple Hypervisor.framework 기반, ARM64 네이티브, CLI 자동화 최적화 |
| Ubuntu 24.04 (ARM64) | 게스트 OS | K8s 공식 지원, 안정적인 apt 패키지 관리 |
| containerd | 컨테이너 런타임 | K8s 표준 CRI, systemd cgroup 드라이버 |

→ 구동 원리: [아키텍처 설계 문서](doc/learning/architecture.md) — VM 레이어, DHCP IP, softnet 네트워크

### Kubernetes

| 기술 | 역할 | 왜 선택했는가 |
|------|------|--------------|
| [kubeadm](https://kubernetes.io/docs/setup/production-environment/tools/kubeadm/) v1.31 | 클러스터 부트스트랩 | 프로덕션과 동일한 구성 (etcd, apiserver, scheduler 개별 실행) |
| [Cilium](https://cilium.io/) | CNI (네트워크 플러그인) | eBPF 기반으로 kube-proxy 완전 대체, L7 NetworkPolicy, Hubble 내장 |
| [Hubble](https://docs.cilium.io/en/stable/observability/hubble/) | 네트워크 가시성 | Cilium에 내장, 패킷 흐름 실시간 관찰, DROPPED/FORWARDED 필터 |

→ 구동 원리: [네트워크 심화 문서](doc/learning/networking.md) — eBPF vs iptables, kubeProxyReplacement 부트스트랩 문제

### Service Mesh

| 기술 | 역할 | 왜 선택했는가 |
|------|------|--------------|
| [Istio](https://istio.io/) | Service Mesh | 산업 표준, Envoy 사이드카로 mTLS · 카나리 · 서킷브레이커 |
| Envoy Proxy | 사이드카 프록시 | Pod마다 자동 주입, 앱 코드 변경 없이 트래픽 제어 |

적용 범위 (dev 클러스터 demo 네임스페이스):

| 기능 | 설정 | 매니페스트 |
|------|------|-----------|
| mTLS | STRICT — 모든 Pod 간 통신 암호화 | `manifests/istio/peer-authentication.yaml` |
| 카나리 배포 | httpbin v1:80% / v2:20% | `manifests/istio/virtual-service.yaml` |
| 서킷브레이커 | 연속 5xx 3회 → 인스턴스 격리 | `manifests/istio/destination-rule.yaml` |
| Ingress Gateway | /api→httpbin, /→nginx L7 라우팅 | `manifests/istio/istio-gateway.yaml` |

→ 구동 원리: [네트워크 심화 문서 §5](doc/learning/networking.md) — 사이드카 패턴, mTLS 핸드셰이크, 패킷 9단계 여정

### 네트워크 보안

| 기술 | 역할 | 왜 선택했는가 |
|------|------|--------------|
| [CiliumNetworkPolicy](https://docs.cilium.io/en/stable/security/policy/) | L3/L4/L7 트래픽 제어 | Cilium 전용 CRD, HTTP 메서드 필터링(GET만 허용 등) |

적용된 정책 (dev 클러스터 demo 네임스페이스):

| 정책 파일 | 동작 |
|-----------|------|
| `default-deny.yaml` | 모든 ingress 차단, DNS만 허용 (Zero Trust) |
| `allow-external-to-nginx.yaml` | 외부 → nginx:80 허용 |
| `allow-nginx-to-httpbin.yaml` | nginx → httpbin **HTTP GET만** 허용 (L7) |
| `allow-nginx-to-redis.yaml` | nginx → redis:6379 허용 |
| `allow-nginx-egress.yaml` | nginx 아웃바운드 허용 |

→ 구동 원리: [네트워크 심화 문서 §4](doc/learning/networking.md) — Zero Trust, L7 필터링, Hubble 관측

### 모니터링 & 옵저버빌리티

| 기술 | 역할 | 왜 선택했는가 |
|------|------|--------------|
| [Prometheus](https://prometheus.io/) | 메트릭 수집/저장 | Pull 기반 TSDB, K8s 네이티브 ServiceMonitor |
| [Grafana](https://grafana.com/) | 시각화 대시보드 | 코드로 대시보드 프로비저닝 (gnetId), 다중 데이터소스 |
| [Loki](https://grafana.com/oss/loki/) | 로그 수집 | Promtail로 Pod 로그 수집, LogQL 쿼리 |
| [AlertManager](https://prometheus.io/docs/alerting/latest/alertmanager/) | 알림 라우팅 | 그룹핑 · 억제 · 반복 발송 제어 |

알림 규칙 (PrometheusRule CRD):

| 규칙 | 조건 | 심각도 |
|------|------|--------|
| HighCpuUsage | CPU > 80% (5분) | warning |
| HighMemoryUsage | Memory > 85% (5분) | warning |
| NodeNotReady | 노드 NotReady (5분) | **critical** |
| PodCrashLooping | 15분간 5회 이상 재시작 | warning |
| PodOOMKilled | OOM으로 종료됨 | warning |

→ 구동 원리: [모니터링 문서](doc/learning/monitoring.md) — Pull 모델, PromQL, AlertManager 흐름, Grafana 프로비저닝

### 오토스케일링

| 기술 | 역할 | 왜 선택했는가 |
|------|------|--------------|
| [metrics-server](https://github.com/kubernetes-sigs/metrics-server) | Pod CPU/메모리 메트릭 | HPA의 메트릭 소스, Metrics API 제공 |
| [HPA](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/) | 수평 자동 확장 | CPU 50% 기준 Pod 자동 증감 |
| [PDB](https://kubernetes.io/docs/tasks/run-application/configure-pdb/) | 최소 가용성 보장 | 스케일다운/업데이트 시 최소 Pod 수 유지 |

| 앱 | CPU Target | Min → Max | PDB |
|----|-----------|-----------|-----|
| nginx-web | 50% | 3 → 10 | minAvailable: 2 |
| httpbin | 50% | 2 → 6 | minAvailable: 1 |

→ 구동 원리: [모니터링 문서 §6](doc/learning/monitoring.md) — HPA 공식, 스케일업/다운 동작, PDB 상호작용

### CI/CD

| 기술 | 역할 | 왜 선택했는가 |
|------|------|--------------|
| [Jenkins](https://www.jenkins.io/) | CI 빌드 파이프라인 | 범용 빌드 서버, 플러그인 생태계 |
| [ArgoCD](https://argo-cd.readthedocs.io/) | GitOps 배포 | Git 저장소를 Single Source of Truth로 사용하는 선언적 배포 |

→ 구동 원리: [IaC 문서 §4](doc/learning/iac-automation.md) — GitOps 원칙, 배포 전략 비교

### IaC & 자동화

| 기술 | 역할 | 왜 선택했는가 |
|------|------|--------------|
| [Terraform](https://www.terraform.io/) | 선언적 인프라 관리 | 상태 추적, `plan`으로 변경 미리보기, 모듈화 |
| Bash 스크립트 | 명령형 자동화 | 빠른 프로토타이핑, 디버깅 용이 |
| [Helm](https://helm.sh/) | K8s 패키지 관리 | values 파일로 재현 가능한 차트 배포 |

두 가지 설치 방식을 **모두 지원**한다:

| 방식 | 명령 | 장점 |
|------|------|------|
| Bash (명령형) | `./scripts/install.sh` | 빠른 실행, 디버깅 용이 |
| Terraform (선언형) | `terraform apply` | 상태 관리, 변경 미리보기, 롤백 |

→ 구동 원리: [IaC 문서](doc/learning/iac-automation.md) — Bash vs Terraform 비교, 멱등성, Helm 관리

### 커스텀 대시보드

| 기술 | 역할 |
|------|------|
| React 19 + Vite 7 | SPA 프론트엔드 |
| Tailwind CSS 4 | 다크 테마 UI |
| Recharts | 게이지 차트, 스파크라인 |
| Express 5 + TypeScript | REST API 서버 |
| ssh2 (npm) | VM SSH 커넥션 풀 |

```bash
cd dashboard && npm install && npm run dev
# → http://localhost:3000
```

10개 VM의 CPU/메모리/디스크, 열린 포트, 네트워크 트래픽, 4개 클러스터의 노드/Pod 상태를 5초 간격으로 실시간 시각화.

→ 상세: [대시보드 기술 문서](doc/dashboard.md) — 아키텍처, API, SSH Pool, 데이터 수집 방식

### 부하테스트

| 기술 | 역할 |
|------|------|
| [k6](https://k6.io/) | HTTP 부하 생성기 |
| stress-ng | CPU/메모리 스트레스 |

```bash
# HTTP 부하 (100 동시 사용자, 60초)
kubectl --kubeconfig kubeconfig/dev.yaml apply -f manifests/demo/k6-loadtest.yaml

# HPA 자동 확장 실시간 확인
kubectl --kubeconfig kubeconfig/dev.yaml -n demo get hpa -w
```

---

## 데모 앱

모든 클러스터의 `demo` 네임스페이스에 배포:

| 앱 | 이미지 | replicas | 용도 |
|----|--------|----------|------|
| nginx-web | nginx:alpine | 3 (HPA: 3~10) | 웹서버, NodePort 30080 |
| httpbin v1 | kong/httpbin | 2 (HPA: 2~6) | REST API 테스트 |
| httpbin v2 | kong/httpbin | 1 | 카나리 배포 대상 (20%) |
| redis | redis:7-alpine | 1 | 캐시/세션 저장소 |

---

## 프로젝트 구조

```
tart-infra/
│
├── config/
│   └── clusters.json              ← 클러스터/VM 정의 (Single Source of Truth)
│
├── scripts/
│   ├── install.sh                 ← 전체 설치 (Phase 1~12)
│   ├── boot.sh                    ← 일상 시작 (VM 부팅 → 헬스체크)
│   ├── shutdown.sh                ← 안전 종료 (drain → stop)
│   ├── status.sh                  ← 전체 상태 확인
│   ├── destroy.sh                 ← 완전 삭제
│   ├── lib/                       ← 공유 함수 라이브러리
│   │   ├── common.sh              ← 설정 파싱, 로깅, 유틸리티
│   │   ├── vm.sh                  ← VM 생명주기 (clone/start/stop/delete)
│   │   ├── ssh.sh                 ← SSH 연결 (exec/scp/wait)
│   │   └── k8s.sh                 ← K8s 관리 (init/join/cilium/hubble)
│   ├── install/                   ← 설치 단계 01~12
│   └── boot/                      ← 부팅 단계 01~03
│
├── manifests/
│   ├── cilium-values.yaml         ← Cilium CNI (eBPF, kubeProxyReplacement)
│   ├── hubble-values.yaml         ← Hubble 네트워크 관측
│   ├── monitoring-values.yaml     ← Prometheus + Grafana + AlertManager
│   ├── loki-values.yaml           ← Loki 로그 수집
│   ├── argocd-values.yaml         ← ArgoCD GitOps
│   ├── jenkins-values.yaml        ← Jenkins CI
│   ├── metrics-server-values.yaml ← metrics-server (HPA 메트릭)
│   ├── alerting/                  ← PrometheusRule + webhook receiver
│   ├── network-policies/          ← CiliumNetworkPolicy (L7)
│   ├── hpa/                       ← HPA + PDB
│   ├── istio/                     ← Istio Service Mesh 전체 설정
│   └── demo/                      ← nginx, httpbin, redis, k6, stress
│
├── terraform/
│   ├── main.tf                    ← 모듈 조합 (vms → k8s → helm)
│   ├── variables.tf               ← clusters.json의 HCL 버전
│   ├── outputs.tf                 ← VM IP, kubeconfig, 서비스 URL
│   └── modules/
│       ├── tart-vm/               ← VM clone → set → start → IP 대기
│       ├── k8s-cluster/           ← kubeadm init/join
│       └── helm-releases/         ← Helm 차트 선언적 관리
│
├── dashboard/                     ← 커스텀 모니터링 웹 대시보드
│   ├── server/                    ← Express + SSH + kubectl 수집기
│   └── src/                       ← React + Tailwind UI
│
├── kubeconfig/                    ← 클러스터별 kubeconfig (.gitignore)
│
└── doc/
    ├── dashboard.md               ← 대시보드 상세 문서
    ├── 20260227_010000_bug_report.md ← 버그 7건 + 해결 과정
    └── learning/                  ← 학습용 기술 문서 (아래 참조)
```

---

## 학습용 기술 문서

이 프로젝트가 **어떻게 동작하는지**, 소프트웨어 공학 관점에서 설명하는 문서:

| 문서 | 내용 |
|------|------|
| [아키텍처 설계](doc/learning/architecture.md) | 8계층 레이어드 아키텍처, 멀티클러스터 CIDR 설계, clusters.json이 Single Source of Truth인 이유, 스크립트 디자인 패턴 (Facade · Strategy · Template Method), CPU 오버커밋 전략, Zero Trust 보안, ADR 5건 |
| [네트워크 심화](doc/learning/networking.md) | Tart NAT vs Softnet, Cilium eBPF가 iptables보다 빠른 이유, kubeProxyReplacement 부트스트랩 순환의존성, CiliumNetworkPolicy L7 HTTP 필터링, Istio 사이드카 mTLS/카나리/서킷브레이커, 패킷이 nginx→httpbin으로 가는 9단계 전체 경로 |
| [IaC와 자동화](doc/learning/iac-automation.md) | Bash 명령형 vs Terraform 선언형 비교, Phase 1~12 실행 흐름, null_resource로 Tart CLI 래핑, DHCP IP 해결 패턴, 멱등성 구현, Helm values 관리, GitOps 원칙, Day 0/1/2 자동화 분류 |
| [모니터링/옵저버빌리티](doc/learning/monitoring.md) | 옵저버빌리티 3기둥 (Metrics·Logs·Traces), Prometheus Pull 모델, Grafana 코드 프로비저닝, AlertManager 알림 흐름 (그룹핑·억제), HPA 공식 `⌈replicas × current/target⌉`, PDB 상호작용, 커스텀 대시보드 SSH Pool |
| [트러블슈팅 가이드](doc/learning/troubleshooting.md) | 6단계 디버깅 프레임워크, VM→SSH→K8s→Pod→Service 레이어별 체크리스트, 실제 버그 7건의 원인분석→가설→검증→해결 과정, kubectl/Helm/Cilium 진단 명령, 재해복구 절차 |

---

## 검증 명령 모음

```bash
# 전체 상태 확인
./scripts/status.sh

# 모든 VM IP 확인
for vm in platform-master platform-worker1 platform-worker2 \
          dev-master dev-worker1 staging-master staging-worker1 \
          prod-master prod-worker1 prod-worker2; do
  echo "$vm: $(tart ip $vm 2>/dev/null || echo 'not running')"
done

# Cilium 상태
kubectl --kubeconfig kubeconfig/dev.yaml exec -n kube-system ds/cilium -- cilium status

# Hubble 네트워크 관측
kubectl --kubeconfig kubeconfig/dev.yaml -n kube-system port-forward svc/hubble-relay 4245:80 &
hubble observe --namespace demo --verdict DROPPED

# Istio mTLS 확인
kubectl --kubeconfig kubeconfig/dev.yaml -n demo \
  exec deploy/nginx-web -c nginx -- curl -s http://httpbin/get

# HPA 실시간 확인
kubectl --kubeconfig kubeconfig/dev.yaml -n demo get hpa -w

# AlertManager 확인
open http://$(tart ip platform-worker1):30903

# Grafana 접속
open http://$(tart ip platform-worker1):30300
```

---

## 참고 문서

| 문서 | 설명 |
|------|------|
| [대시보드 기술 문서](doc/dashboard.md) | 아키텍처, API, SSH Pool, 데이터 수집 |
| [버그 리포트](doc/20260227_010000_bug_report.md) | 7건 버그 발견 및 해결 과정 (타임스탬프) |
| [Tart 소개](doc/tart.md) | Tart VM 런타임 개요 |
| [Terraform 연동](doc/terraform.md) | Terraform 모듈 설계 |
