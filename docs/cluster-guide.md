# 클러스터별 활용 가이드

tart-infra는 Apple Silicon Mac 위에 Tart VM 10대를 띄우고, 4개의 독립된 Kubernetes 클러스터를 구성한다.
각 클러스터는 실무 환경의 역할 분리를 그대로 재현한다.

---

## 전체 구성 요약

| 클러스터 | 노드 수 | 총 vCPU | 총 메모리 | 역할 |
|----------|---------|---------|-----------|------|
| platform | 3 (master + worker×2) | 7 | 24.5 GB | 모니터링, CI/CD, 알림 — 운영 기반 인프라 |
| dev | 2 (master + worker×1) | 4 | 12 GB | 서비스 메시, 데모 앱, 네트워크 정책, 오토스케일링 실습 |
| staging | 2 (master + worker×1) | 4 | 12 GB | 배포 전 검증 환경 (최소 구성) |
| prod | 3 (master + worker×2) | 6 | 19.25 GB | ArgoCD가 배포하는 프로덕션 대상 클러스터 |

**공통 구성 (모든 노드):** Ubuntu ARM64, containerd, kubelet, Cilium CNI, Hubble, node-exporter, Promtail

---

## 1. Platform 클러스터 — 운영 기반 인프라

**목적:** 개발·운영에 필요한 공용 서비스(모니터링, CI/CD, 알림)를 집중 배치한다. 다른 클러스터는 워크로드만 돌리고, platform이 전체를 관찰·배포·알림한다.

### 노드 구성

| 노드 | CPU | 메모리 | 역할 |
|------|-----|--------|------|
| platform-master | 2 | 4 GB | K8s Control Plane (API Server, etcd, scheduler, controller-manager) |
| platform-worker1 | 3 | 12 GB | 모니터링 + CI/CD + 스토리지 (가장 무거운 워크로드) |
| platform-worker2 | 2 | 8 GB | DaemonSet 오버플로 (node-exporter, Promtail, Cilium Agent) |

### 설치되는 소프트웨어

| 소프트웨어 | 네임스페이스 | NodePort | 역할 |
|-----------|-------------|----------|------|
| **Prometheus** | monitoring | — | 메트릭 수집·저장 (7일 보존, 10Gi PVC) |
| **Grafana** | monitoring | 30300 | 대시보드 시각화 (K8s Cluster, Node Exporter, Pods 대시보드 3종) |
| **Loki** | monitoring | — | 로그 수집·저장 (Promtail이 각 노드에서 로그 전송) |
| **AlertManager** | monitoring | 30903 | 알림 라우팅 (critical/warning 분리, webhook 전달) |
| **Webhook Logger** | monitoring | — | AlertManager 수신 테스트용 에코 서버 |
| **ArgoCD** | argocd | 30800 | GitOps 배포 (dev·prod 클러스터에 앱 배포) |
| **Jenkins** | jenkins | 30900 | CI 파이프라인 (5Gi PVC, BlueOcean 플러그인) |
| **local-path-provisioner** | local-path-storage | — | Jenkins PVC용 로컬 스토리지 |

### 접속 정보

```
Grafana:      http://<platform-worker-ip>:30300  (admin / admin)
AlertManager: http://<platform-worker-ip>:30903
ArgoCD:       http://<platform-worker-ip>:30800  (admin / kubectl -n argocd get secret argocd-initial-admin-secret)
Jenkins:      http://<platform-worker-ip>:30900  (admin / kubectl -n jenkins get secret jenkins)
Hubble UI:    http://<platform-worker-ip>:31235
```

### 이 클러스터에서 학습할 수 있는 것

- Prometheus + Grafana 기반 메트릭 모니터링 파이프라인 구축
- Loki + Promtail 기반 중앙 로그 수집
- AlertManager 알림 규칙(HighCpuUsage, NodeNotReady, PodCrashLooping 등) 설계
- ArgoCD GitOps 워크플로 (Git → 자동 배포)
- Jenkins CI 파이프라인 구성

---

## 2. Dev 클러스터 — 개발·실험 환경

**목적:** 서비스 메시, 네트워크 보안, 오토스케일링, 데모 애플리케이션 등 다양한 CNCF 기술을 실험하는 곳이다. 가장 많은 워크로드가 돌아간다.

### 노드 구성

| 노드 | CPU | 메모리 | 역할 |
|------|-----|--------|------|
| dev-master | 2 | 4 GB | K8s Control Plane + istiod (Istio 컨트롤 플레인) |
| dev-worker1 | 2 | 8 GB | 데모 앱 6종 + Istio Gateway + HPA + 네트워크 정책 |

### 설치되는 소프트웨어

**서비스 메시 (istio-system, istio-ingress 네임스페이스)**

| 소프트웨어 | 역할 |
|-----------|------|
| **istiod** | 서비스 메시 컨트롤 플레인 — 사이드카 설정 배포, mTLS 인증서 관리 |
| **Istio Ingress Gateway** | 외부 트래픽 → 클러스터 내부 라우팅 (NodePort) |
| **Envoy Sidecar** | demo 네임스페이스의 모든 Pod에 자동 주입, L7 트래픽 제어 |

**데모 애플리케이션 (demo 네임스페이스)**

| 앱 | 이미지 | 포트 | 접속 | 역할 |
|----|--------|------|------|------|
| **nginx-web** | nginx:alpine | 80 (NodePort 30080) | 외부 접근 가능 | 프론트엔드 웹서버 (3→10 레플리카 HPA) |
| **httpbin** | kong/httpbin | 80 (ClusterIP) | 내부 전용 | REST API 목업 서버, v1/v2 카나리 배포 |
| **httpbin-v2** | kong/httpbin | 80 (ClusterIP) | 내부 전용 | 카나리 버전 (20% 트래픽) |
| **Redis** | redis:7-alpine | 6379 (ClusterIP) | 내부 전용 | 캐시/세션 저장소 |
| **PostgreSQL** | postgres:16-alpine | 5432 (ClusterIP) | 내부 전용 | RDBMS (demo/demo/demo123) |
| **RabbitMQ** | rabbitmq:3-management | 5672, 15672 (ClusterIP) | 내부 전용 | 메시지 큐 (demo/demo123) |
| **Keycloak** | keycloak:latest | 8080 (NodePort 30880) | 외부 접근 가능 | IAM/SSO 인증 서버 (admin/admin) |

**네트워크 보안 (CiliumNetworkPolicy)**

기본 정책은 **default-deny** (모든 트래픽 차단, DNS만 허용)이며, 필요한 통신만 명시적으로 허용한다:

```
외부 → nginx-web:80           (allow-external-to-nginx)
nginx-web → httpbin:80         (allow-nginx-to-httpbin, GET만)
nginx-web → redis:6379         (allow-nginx-to-redis)
httpbin → postgres:5432        (allow-httpbin-to-postgres)
httpbin → rabbitmq:5672        (allow-httpbin-to-rabbitmq)
httpbin → keycloak:8080        (allow-httpbin-to-keycloak)
keycloak → postgres:5432       (allow-keycloak-to-postgres)
외부 → keycloak:8080           (allow-external-to-keycloak)
```

**오토스케일링 (HPA + PDB)**

| 대상 | 최소→최대 레플리카 | CPU 임계치 | 스케일업 | 스케일다운 |
|------|-------------------|-----------|---------|-----------|
| nginx-web | 3→10 | 50% | 2 pods/15s | 120s |
| httpbin | 2→6 | 50% | 기본 | 120s |
| redis | 1→4 | 50% | 기본 | 120s |
| postgres | 1→4 | 50% | 기본 | 120s |
| rabbitmq | 1→3 | 50% | 기본 | 120s |

**Istio 트래픽 관리**

| 리소스 | 설정 |
|--------|------|
| PeerAuthentication | demo 네임스페이스 전체 Strict mTLS |
| VirtualService (httpbin) | `x-canary: true` 헤더 → v2, 기본 80% v1 / 20% v2 |
| DestinationRule | 5xx 3회 연속 시 30s 서킷 브레이크, TCP 최대 100 연결 |
| Gateway + VirtualService | `/api` → httpbin, 나머지 → nginx-web |

### 접속 정보

```
nginx-web:  http://<dev-worker-ip>:30080
Keycloak:   http://<dev-worker-ip>:30880  (admin / admin)
Hubble UI:  http://<dev-worker-ip>:31235
```

### 이 클러스터에서 학습할 수 있는 것

- Istio 서비스 메시 + Envoy 사이드카 기반 L7 트래픽 제어
- 카나리 배포 (가중치 기반 트래픽 분배)
- mTLS 자동 적용 및 서킷 브레이커
- CiliumNetworkPolicy 기반 제로 트러스트 네트워크
- HPA + metrics-server 기반 오토스케일링
- 3-tier 애플리케이션 아키텍처 (웹 → API → DB/캐시/큐)

---

## 3. Staging 클러스터 — 배포 전 검증 환경

**목적:** 프로덕션 배포 전에 동일한 K8s 환경에서 검증하는 용도다. 의도적으로 최소한의 구성만 갖추어 prod와 유사한 "깨끗한" 상태를 유지한다.

### 노드 구성

| 노드 | CPU | 메모리 | 역할 |
|------|-----|--------|------|
| staging-master | 2 | 4 GB | K8s Control Plane |
| staging-worker1 | 2 | 8 GB | 워크로드 노드 (현재 metrics-server만 동작) |

### 설치되는 소프트웨어

| 소프트웨어 | 네임스페이스 | 역할 |
|-----------|-------------|------|
| **metrics-server** | kube-system | 리소스 메트릭 수집 (kubectl top 명령어 활성화) |

그 외에는 공통 구성(Cilium, Hubble, node-exporter, Promtail)만 동작한다.

### 활용 방법

```
# ArgoCD에서 staging 클러스터를 대상으로 Application을 생성하여 배포 테스트
argocd cluster add staging --kubeconfig kubeconfig/staging.yaml

# 배포 후 검증
kubectl --kubeconfig kubeconfig/staging.yaml get pods -A

# 리소스 확인
kubectl --kubeconfig kubeconfig/staging.yaml top nodes
kubectl --kubeconfig kubeconfig/staging.yaml top pods -A
```

### 이 클러스터에서 학습할 수 있는 것

- 스테이징 환경 설계 원칙 (프로덕션과 동일 구성, 최소 워크로드)
- ArgoCD를 통한 멀티 클러스터 배포 대상 추가
- 배포 전 smoke test 수행

---

## 4. Prod 클러스터 — 프로덕션 환경

**목적:** ArgoCD가 GitOps로 배포하는 최종 프로덕션 대상이다. 현재는 K8s + Cilium만 동작하는 "빈 슬레이트" 상태이며, ArgoCD Application이 워크로드를 자동 배포한다.

### 노드 구성

| 노드 | CPU | 메모리 | 역할 |
|------|-----|--------|------|
| prod-master | 2 | 3 GB | K8s Control Plane |
| prod-worker1 | 2 | 8 GB | 워크로드 노드 |
| prod-worker2 | 2 | 8 GB | 워크로드 노드 (고가용성을 위한 2대 구성) |

### 설치되는 소프트웨어

공통 구성(Cilium, Hubble, node-exporter, Promtail)만 동작한다. 애플리케이션은 ArgoCD가 Git에서 자동 배포한다.

### 활용 방법

```
# platform 클러스터의 ArgoCD에서 prod 클러스터를 등록
argocd cluster add prod --kubeconfig kubeconfig/prod.yaml

# ArgoCD Application 생성 (Git 리포지토리 → prod 클러스터 자동 배포)
argocd app create my-app \
  --repo https://github.com/your-repo.git \
  --path manifests/prod \
  --dest-server https://<prod-master-ip>:6443 \
  --dest-namespace default \
  --sync-policy automated

# 배포 상태 확인
argocd app get my-app
```

### 이 클러스터에서 학습할 수 있는 것

- GitOps 기반 프로덕션 배포 파이프라인 (코드 커밋 → 자동 배포)
- 멀티 워커 노드 고가용성 구성
- 프로덕션 환경 격리 원칙

---

## 5. SRE 대시보드 — 전체 클러스터 통합 관제

대시보드는 4개 클러스터 전체를 실시간으로 모니터링하는 웹 애플리케이션이다.

### 기술 스택

| 구분 | 기술 | 버전 |
|------|------|------|
| 프론트엔드 | React + TypeScript + Tailwind CSS | React 19, Vite 7 |
| 백엔드 | Express + TypeScript | Express 5, Node.js |
| 차트 | Recharts | 3.7 |

### 실행 방법

```bash
cd dashboard
npm install
npm run dev          # 프론트엔드 :3000 + 백엔드 :3001 동시 실행
```

### 페이지 구성

| 경로 | 페이지 | 데이터 갱신 주기 | 설명 |
|------|--------|-----------------|------|
| `/` | Overview | 5초 | 4개 클러스터 요약 카드 (노드 상태, Pod 수, CPU/메모리) |
| `/cluster/:name` | Cluster Detail | 5초 + 30초(서비스) | 개별 클러스터 상세 (노드, Pod 목록, 리소스 게이지) |
| `/traffic` | Traffic | 10초 | Hubble 기반 네트워크 토폴로지 시각화 |
| `/scaling` | Scaling | 3초 | HPA 스케일링 히스토리 차트 |
| `/testing` | Testing | 2초 | SRE 테스트 실행 (k6 부하, stress-ng) 16개 프리셋 |
| `/analysis` | Load Analysis | — | 성능 분석 KPI 요약, Pod 효율 차트 |

### 데이터 수집 방식

| 수집 대상 | 방식 | 주기 |
|-----------|------|------|
| VM 상태/IP | `tart list`, `tart ip` | 5초 |
| CPU/메모리/디스크/네트워크 | SSH → top, free, df, /proc/net/dev | 5초 |
| 노드/Pod 상태 | kubectl get nodes/pods | 5초 |
| HPA 상태 | kubectl get hpa | 5초 |
| 서비스/엔드포인트 | kubectl get svc,endpoints | 30초 |
| 네트워크 플로 | Hubble observe (최근 200건) | 10초 |

---

## 전체 포트 요약

| 포트 | 서비스 | 클러스터 | 비고 |
|------|--------|----------|------|
| 30080 | nginx-web | dev | 데모 웹서버 |
| 30300 | Grafana | platform | 모니터링 대시보드 |
| 30800 | ArgoCD | platform | GitOps UI |
| 30880 | Keycloak | dev | IAM/SSO |
| 30900 | Jenkins | platform | CI/CD |
| 30903 | AlertManager | platform | 알림 UI |
| 31235 | Hubble UI | 전체 | 네트워크 옵저버빌리티 |
| 3000 | SRE Dashboard (FE) | 호스트 Mac | React 프론트엔드 |
| 3001 | SRE Dashboard (BE) | 호스트 Mac | Express API 서버 |

---

## 12단계 자동 설치 파이프라인

전체 인프라는 `scripts/install.sh`로 한 번에 설치된다.

| 단계 | 스크립트 | 대상 클러스터 | 설명 |
|------|---------|-------------|------|
| 01 | create-vms.sh | 전체 | Tart VM 10대 생성 (CPU, 메모리, 디스크 할당) |
| 02 | prepare-nodes.sh | 전체 | swap 해제, 커널 모듈 로드, sysctl 설정 |
| 03 | install-runtime.sh | 전체 | containerd 설치 (systemd cgroup) |
| 04 | install-kubeadm.sh | 전체 | kubelet, kubeadm, kubectl v1.31 설치 |
| 05 | init-clusters.sh | 전체 | kubeadm init/join, kubeconfig 복사 |
| 06 | install-cilium.sh | 전체 | Cilium CNI + Hubble (kube-proxy 대체) |
| 07 | install-monitoring.sh | platform | Prometheus, Grafana, Loki, Promtail |
| 08 | install-cicd.sh | platform | ArgoCD, Jenkins, local-path-provisioner |
| 09 | install-alerting.sh | platform | AlertManager 규칙 + webhook logger |
| 10 | install-network-policies.sh | dev | CiliumNetworkPolicy 10종 (default-deny + 허용) |
| 11 | install-hpa.sh | dev, staging | metrics-server, 데모 앱 6종, HPA 5종, PDB 5종 |
| 12 | install-istio.sh | dev | Istio, Envoy sidecar, 카나리 배포, mTLS |
