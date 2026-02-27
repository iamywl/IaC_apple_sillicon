# Tart Multi-Cluster K8s Infrastructure

M4 Max MacBook Pro (16 CPU, 128GB RAM)에서 Tart VM 기반으로 MSA 지향 멀티클러스터 Kubernetes 환경을 자동 구축하는 프로젝트.

## 현재 상태

| 항목 | 상태 |
|------|------|
| VM | 10개 running (platform 3, dev 2, staging 2, prod 3) |
| K8s | 4 클러스터 전 노드 Ready (kubeadm v1.31) |
| CNI | Cilium + Hubble UI |
| Service Mesh | Istio (dev 클러스터 - mTLS, 카나리, 서킷브레이커) |
| 모니터링 | Prometheus + Grafana + Loki + AlertManager (platform) |
| 알림 | PrometheusRule 8개 + AlertManager webhook |
| CI/CD | Jenkins + ArgoCD (platform) |
| 네트워크 정책 | CiliumNetworkPolicy (L7 HTTP 필터링) |
| 오토스케일링 | HPA + metrics-server + PDB (dev) |
| IaC | Terraform (VM + K8s + Helm 전체 관리) |
| 부하테스트 | k6 100 VUs / 60초 |
| 대시보드 | 커스텀 웹 대시보드 (React + Express) |

## 아키텍처

```
┌─────────────────────────────────────────────────────────┐
│  MacBook Pro M4 Max (16 CPU / 128GB RAM)                │
│                                                         │
│  ┌─────────────── platform 클러스터 ──────────────┐     │
│  │  master (2C/4G)                                │     │
│  │  worker1 (3C/12G) ← Prometheus, Grafana, Loki  │     │
│  │             AlertManager, webhook-logger        │     │
│  │  worker2 (2C/8G)  ← Jenkins, ArgoCD           │     │
│  └────────────────────────────────────────────────┘     │
│                                                         │
│  ┌──── dev 클러스터 ────────┐  ┌── staging 클러스터 ──┐ │
│  │  master (2C/4G)          │  │  master (2C/4G)      │ │
│  │  worker1 (2C/8G)         │  │  worker1 (2C/8G)     │ │
│  │  ├ Istio (istiod)        │  │                      │ │
│  │  ├ Istio Ingress Gateway │  │                      │ │
│  │  ├ metrics-server        │  │  metrics-server      │ │
│  │  ├ HPA (nginx, httpbin)  │  │                      │ │
│  │  └ CiliumNetworkPolicy   │  │                      │ │
│  └──────────────────────────┘  └──────────────────────┘ │
│                                                         │
│  ┌─────────────── prod 클러스터 ────────────────┐       │
│  │  master (2C/3G)                               │       │
│  │  worker1 (2C/8G)                              │       │
│  │  worker2 (2C/8G)                              │       │
│  └───────────────────────────────────────────────┘       │
│                                                         │
│  총 10 VM / 21 vCPU / ~71.5GB RAM                       │
└─────────────────────────────────────────────────────────┘
```

## 기술 스택

| 구분 | 기술 | 용도 |
|------|------|------|
| VM | Tart (Apple Hypervisor.framework) | ARM64 Linux VM 관리 |
| IaC | Terraform (null_resource + Helm provider) | 인프라 선언적 관리 |
| K8s | kubeadm v1.31 | 클러스터 구성 |
| CNI | Cilium + Hubble UI | eBPF 네트워킹 + 네트워크 가시성 |
| Service Mesh | Istio | mTLS, 트래픽 라우팅, 서킷브레이커 |
| 모니터링 | Prometheus + Grafana + Loki + AlertManager | 메트릭 + 대시보드 + 로그 + 알림 |
| CI/CD | Jenkins + ArgoCD | 빌드 + GitOps 배포 |
| 네트워크 정책 | CiliumNetworkPolicy | L3/L4/L7 트래픽 제어 |
| 오토스케일링 | HPA + metrics-server + PDB | CPU 기반 자동 확장 |
| 대시보드 | React + Vite + Express | 커스텀 인프라 모니터링 |

---

## Quick Start

### 사전 준비
```bash
brew install tart kubectl helm jq sshpass terraform
```

### 최초 설치 (Bash)
```bash
./scripts/install.sh
```
VM 10개 생성 → K8s 4 클러스터 → Cilium → 모니터링 → CI/CD → AlertManager → NetworkPolicy → HPA → Istio 전부 자동 설치.

### 최초 설치 (Terraform)
```bash
cd terraform
terraform init
terraform plan
terraform apply
```

### 일상 사용
```bash
./scripts/boot.sh       # 노트북 켰을 때
./scripts/status.sh     # 상태 확인
./scripts/shutdown.sh   # 노트북 끄기 전
```

### 전체 삭제
```bash
./scripts/destroy.sh
# 또는
cd terraform && terraform destroy
```

---

## 서비스 접속

VM IP는 재부팅 시 변경될 수 있습니다. `boot.sh` 출력 또는 아래 명령으로 확인:
```bash
tart ip platform-worker1
```

### Platform 클러스터

| 서비스 | 포트 | 계정 |
|--------|------|------|
| Hubble UI | 31235 | 없음 |
| Grafana | 30300 | admin / admin |
| AlertManager | 30903 | 없음 |
| ArgoCD | 30800 | admin / (명령으로 확인) |
| Jenkins | 30900 | admin / admin |

ArgoCD 비밀번호:
```bash
kubectl --kubeconfig kubeconfig/platform.yaml \
  -n argocd get secret argocd-initial-admin-secret \
  -o jsonpath="{.data.password}" | base64 -d
```

### Dev 클러스터

| 서비스 | 포트 |
|--------|------|
| Nginx (NodePort) | 30080 |
| Istio Ingress Gateway | NodePort (자동 할당) |

---

## Service Mesh (Istio)

dev 클러스터에 Istio가 설치되어 있으며, demo 네임스페이스에 사이드카가 자동 주입됩니다.

### 주요 기능

| 기능 | 설명 | 매니페스트 |
|------|------|-----------|
| mTLS | STRICT 모드 - 모든 서비스 간 통신 암호화 | `manifests/istio/peer-authentication.yaml` |
| 카나리 배포 | httpbin v1:80% / v2:20% 트래픽 분할 | `manifests/istio/virtual-service.yaml` |
| 서킷브레이커 | 연속 5xx 3회 시 인스턴스 격리 | `manifests/istio/destination-rule.yaml` |
| Ingress Gateway | L7 라우팅 (/api → httpbin, / → nginx) | `manifests/istio/istio-gateway.yaml` |

### 검증
```bash
# mTLS 확인
kubectl --kubeconfig kubeconfig/dev.yaml -n demo \
  exec deploy/nginx-web -c nginx -- curl -s http://httpbin/get

# 카나리 트래픽 분배 확인
for i in $(seq 1 10); do
  kubectl --kubeconfig kubeconfig/dev.yaml -n demo \
    exec deploy/nginx-web -c nginx -- curl -s http://httpbin/get | head -1
done
```

---

## NetworkPolicy (Cilium L7)

dev 클러스터의 demo 네임스페이스에 CiliumNetworkPolicy가 적용되어 있습니다.

| 정책 | 설명 |
|------|------|
| default-deny-all | 모든 ingress 차단, DNS만 허용 |
| allow-external-to-nginx | 외부 → nginx:80 허용 |
| allow-nginx-to-httpbin | nginx → httpbin HTTP **GET만** 허용 (L7) |
| allow-nginx-to-redis | nginx → redis:6379 허용 |
| allow-nginx-egress | nginx 아웃바운드 (httpbin, redis, DNS) |

### 검증
```bash
# Hubble로 차단된 트래픽 확인
kubectl --kubeconfig kubeconfig/dev.yaml -n kube-system \
  port-forward svc/hubble-relay 4245:80 &
hubble observe --namespace demo --verdict DROPPED
```

---

## 오토스케일링 (HPA)

| 앱 | CPU Target | Min | Max | PDB |
|----|-----------|-----|-----|-----|
| nginx-web | 50% | 3 | 10 | minAvailable: 2 |
| httpbin | 50% | 2 | 6 | minAvailable: 1 |

### 검증
```bash
# HPA 상태 확인
kubectl --kubeconfig kubeconfig/dev.yaml -n demo get hpa

# 부하테스트로 HPA 트리거
kubectl --kubeconfig kubeconfig/dev.yaml apply -f manifests/demo/k6-loadtest.yaml
kubectl --kubeconfig kubeconfig/dev.yaml -n demo get hpa -w
```

---

## AlertManager

platform 클러스터에서 운영. PrometheusRule CRD로 알림 규칙 정의.

### 알림 규칙

| 규칙 | 조건 | 심각도 |
|------|------|--------|
| HighCpuUsage | CPU > 80% (5분) | warning |
| HighMemoryUsage | Memory > 85% (5분) | warning |
| NodeNotReady | 노드 NotReady (5분) | critical |
| NodeDiskPressure | 디스크 부족 (5분) | warning |
| PodCrashLooping | 15분간 5회 이상 재시작 | warning |
| PodOOMKilled | OOM으로 종료됨 | warning |
| HighPodRestartRate | 1시간 10회 이상 재시작 | warning |
| PodNotReady | Pod NotReady (10분) | warning |

### 검증
```bash
# AlertManager UI
open http://$(tart ip platform-worker1):30903

# Webhook 로그 확인
kubectl --kubeconfig kubeconfig/platform.yaml -n monitoring \
  logs -l app=alertmanager-webhook
```

---

## Terraform IaC

전체 인프라를 Terraform으로 선언적 관리 가능. `null_resource` + `local-exec`로 Tart CLI를 래핑하고, Helm provider로 차트를 관리.

```
terraform/
├── providers.tf           # null, helm, local providers
├── variables.tf           # clusters.json 대체 (HCL)
├── terraform.tfvars       # 환경별 변수값
├── main.tf                # 모듈 조합
├── outputs.tf             # VM IP, kubeconfig, 서비스 URL
└── modules/
    ├── tart-vm/           # VM clone → set → start → IP 대기
    ├── k8s-cluster/       # kubeadm init/join (기존 bash 호출)
    └── helm-releases/     # 모든 Helm 차트 선언적 관리
```

### 사용법
```bash
cd terraform
terraform init
terraform plan     # 변경 사항 미리보기
terraform apply    # 인프라 프로비저닝
terraform destroy  # 전체 삭제
```

---

## 커스텀 인프라 대시보드

VM 리소스, 네트워크, 포트, Pod를 실시간으로 시각화하는 웹 대시보드.

```bash
cd dashboard && npm install && npm run dev
# → http://localhost:3000
```

| 기능 | 설명 |
|------|------|
| VM 상태 | 10개 VM별 running/stopped, IP, CPU/RAM/Disk 스펙 |
| 실시간 리소스 | CPU%, Memory%, Disk% 원형 게이지 (5초 갱신) |
| 열린 포트 | VM별 리스닝 포트 + 프로세스명 |
| 네트워크 트래픽 | RX/TX bytes/sec 스파크라인 |
| Pod 시각화 | 클러스터 → 노드 → Pod 계층 구조 |
| 클러스터 상태 | 4 클러스터 노드 Ready/NotReady |

상세: [대시보드 기술 문서](doc/dashboard.md)

---

## VM 관리

```bash
# VM 목록
tart list

# 모든 VM IP 확인
for vm in platform-master platform-worker1 platform-worker2 \
          dev-master dev-worker1 staging-master staging-worker1 \
          prod-master prod-worker1 prod-worker2; do
  echo "$vm: $(tart ip $vm 2>/dev/null || echo 'not running')"
done

# SSH 접속 (admin / admin)
ssh admin@$(tart ip dev-worker1)

# 통합 상태 확인
./scripts/status.sh
```

---

## kubectl 사용

```bash
# 클러스터별 접속
export KUBECONFIG=kubeconfig/platform.yaml
export KUBECONFIG=kubeconfig/dev.yaml
export KUBECONFIG=kubeconfig/staging.yaml
export KUBECONFIG=kubeconfig/prod.yaml

# 멀티 클러스터
export KUBECONFIG=kubeconfig/platform.yaml:kubeconfig/dev.yaml:kubeconfig/staging.yaml:kubeconfig/prod.yaml
kubectl config get-contexts
```

---

## 데모 앱

dev/staging 클러스터에 배포:
```bash
export KUBECONFIG=kubeconfig/dev.yaml
kubectl apply -f manifests/demo/nginx-app.yaml
kubectl apply -f manifests/demo/httpbin-app.yaml
kubectl apply -f manifests/demo/redis-app.yaml
```

| 앱 | 이미지 | replicas |
|----|--------|----------|
| nginx-web | nginx:alpine | 3 (HPA: 3~10) |
| httpbin v1 | kong/httpbin | 2 (HPA: 2~6) |
| httpbin v2 | kong/httpbin | 1 (카나리 20%) |
| redis | redis:7-alpine | 1 |

## 부하테스트

```bash
# CPU/메모리 스트레스 (60초)
kubectl apply -f manifests/demo/stress-test.yaml

# HTTP 부하 테스트 (100 VUs, 60초)
kubectl apply -f manifests/demo/k6-loadtest.yaml

# 결과 확인
kubectl logs -n demo job/stress-cpu
kubectl logs -n demo job/k6-loadtest

# HPA 반응 확인
kubectl -n demo get hpa -w
```

---

## 프로젝트 구조

```
tart-infra/
├── config/clusters.json              # 클러스터/VM 정의
├── terraform/                        # Terraform IaC
│   ├── main.tf, variables.tf         # 루트 모듈
│   └── modules/                      # tart-vm, k8s-cluster, helm-releases
├── scripts/
│   ├── install.sh                    # 최초 설치 (12 Phase)
│   ├── boot.sh / shutdown.sh         # 일상 운영
│   ├── status.sh / destroy.sh        # 상태/삭제
│   ├── lib/                          # 공통 함수 (common, vm, ssh, k8s)
│   ├── install/                      # 설치 단계 (01~12)
│   └── boot/                         # 부팅 단계 (01~03)
├── manifests/
│   ├── cilium-values.yaml            # Cilium CNI
│   ├── hubble-values.yaml            # Hubble 네트워크 가시성
│   ├── monitoring-values.yaml        # Prometheus + Grafana + AlertManager
│   ├── loki-values.yaml              # Loki 로그
│   ├── argocd-values.yaml            # ArgoCD GitOps
│   ├── jenkins-values.yaml           # Jenkins CI
│   ├── metrics-server-values.yaml    # metrics-server (HPA용)
│   ├── alerting/                     # AlertManager 규칙 + webhook
│   ├── network-policies/             # CiliumNetworkPolicy (L7)
│   ├── hpa/                          # HPA + PDB
│   ├── istio/                        # Istio Service Mesh
│   └── demo/                         # nginx, httpbin, redis, stress, k6
├── dashboard/                        # 커스텀 모니터링 대시보드 (React+Express)
├── kubeconfig/                       # 클러스터별 kubeconfig (.gitignore)
└── doc/                              # 문서
```

## 참고 문서

- [대시보드 기술 문서](doc/dashboard.md) - 아키텍처, API, 데이터 수집
- [버그 리포트](doc/20260227_010000_bug_report.md) - 7건 버그 발견 및 해결 과정 (타임스탬프 포함)
- [Tart 소개](doc/tart.md)
- [Terraform 연동](doc/terraform.md)

## 학습용 기술 문서

소프트웨어 공학 관점에서 프로젝트 동작 원리를 설명하는 문서:

- [아키텍처 설계](doc/learning/architecture.md) - 계층 구조, 멀티클러스터 설계, ADR
- [네트워크 심화](doc/learning/networking.md) - CNI(Cilium), NetworkPolicy, Istio Service Mesh
- [IaC와 자동화](doc/learning/iac-automation.md) - Bash vs Terraform, CI/CD, Helm 관리
- [모니터링/옵저버빌리티](doc/learning/monitoring.md) - Prometheus, Grafana, AlertManager, HPA
- [트러블슈팅 가이드](doc/learning/troubleshooting.md) - 레이어별 디버깅, 실제 버그 해결 사례
