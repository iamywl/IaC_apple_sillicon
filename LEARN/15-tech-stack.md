# 15. 기술 스택 레퍼런스 — 버전, 포트, 도구 연동

> 이 프로젝트에서 사용하는 **모든** 기술, 도구, 라이브러리의 버전과 포트를 정리하고, 도구 간 상호작용 흐름을 설명한다.

---

## 목차

- [1. 오픈소스 프로젝트 총정리](#1-오픈소스-프로젝트-총정리)
- [2. 인프라 계층](#2-인프라-계층)
- [3. Kubernetes 계층](#3-kubernetes-계층)
- [4. 관측성 스택 (platform 클러스터)](#4-관측성-스택-platform-클러스터)
- [5. CI/CD 스택 (platform 클러스터)](#5-cicd-스택-platform-클러스터)
- [6. 서비스 메시 (dev 클러스터)](#6-서비스-메시-dev-클러스터)
- [7. 네트워크 정책](#7-네트워크-정책)
- [8. 데모 앱 + 테스트 도구](#8-데모-앱--테스트-도구)
- [9. SRE 대시보드 (Full-Stack TypeScript)](#9-sre-대시보드-full-stack-typescript)
- [10. Terraform (IaC 대안)](#10-terraform-iac-대안)
- [11. 서비스 접속 포트 전체 목록](#11-서비스-접속-포트-전체-목록)
- [12. 버전 고정 vs 최신 정책](#12-버전-고정-vs-최신-정책)
- [13. 전체 상호작용 흐름도](#13-전체-상호작용-흐름도)
- [14. 인프라 레이어 상호작용](#14-인프라-레이어-상호작용)
- [15. 모니터링 파이프라인 상호작용](#15-모니터링-파이프라인-상호작용)
- [16. CI/CD 파이프라인 상호작용](#16-cicd-파이프라인-상호작용)
- [17. 서비스 메시 상호작용](#17-서비스-메시-상호작용)
- [18. 오토스케일링 상호작용](#18-오토스케일링-상호작용)
- [19. SRE 대시보드 상호작용](#19-sre-대시보드-상호작용)
- [20. 도구 간 의존성 요약](#20-도구-간-의존성-요약)
- [21. 장애 전파 시나리오](#21-장애-전파-시나리오)
- [22. 요청 처리 전체 흐름 예시](#22-요청-처리-전체-흐름-예시)

---

## 1. 오픈소스 프로젝트 총정리

이 프로젝트는 **30개 이상의 오픈소스 프로젝트**를 조합하여 구성되었다.

### 인프라 & 오케스트레이션

| | 프로젝트 | 역할 | 공식 사이트 |
|:---:|---------|------|-----------|
| <img src="https://img.shields.io/badge/Kubernetes-326CE5?logo=kubernetes&logoColor=white" height="28"/> | **Kubernetes** 1.31 | 컨테이너 오케스트레이션 플랫폼. 4개 클러스터(platform/dev/staging/prod)에서 Pod 배포, 스케일링, 자가 치유를 담당 | [kubernetes.io](https://kubernetes.io/) |
| <img src="https://img.shields.io/badge/containerd-575757?logo=containerd&logoColor=white" height="28"/> | **containerd** | 컨테이너 런타임. 각 VM 노드에서 컨테이너 이미지를 풀링하고 실행하는 저수준 런타임 (SystemdCgroup 모드) | [containerd.io](https://containerd.io/) |
| <img src="https://img.shields.io/badge/Helm-0F1689?logo=helm&logoColor=white" height="28"/> | **Helm** | Kubernetes 패키지 매니저. Cilium, Prometheus, Jenkins, ArgoCD 등 모든 클러스터 소프트웨어를 values.yaml 기반으로 선언적 설치 | [helm.sh](https://helm.sh/) |
| <img src="https://img.shields.io/badge/Terraform-844FBA?logo=terraform&logoColor=white" height="28"/> | **Terraform** >= 1.5 | Infrastructure as Code. Bash 스크립트의 대안으로, VM 생성 → K8s 초기화 → Helm 배포를 모듈 체인으로 자동화 | [terraform.io](https://www.terraform.io/) |
| <img src="https://img.shields.io/badge/Tart-000000?logo=apple&logoColor=white" height="28"/> | **Tart** | Apple Silicon 전용 VM 관리 도구. macOS Hypervisor.framework 위에서 ARM64 Ubuntu VM 10대를 생성/시작/종료 | [tart.run](https://tart.run/) |
| <img src="https://img.shields.io/badge/Ubuntu-E95420?logo=ubuntu&logoColor=white" height="28"/> | **Ubuntu** (ARM64) | 게스트 OS. `ghcr.io/cirruslabs/ubuntu:latest` 이미지 기반으로 VM 10대에 설치 | [ubuntu.com](https://ubuntu.com/) |

### 네트워킹 & 서비스 메시

| | 프로젝트 | 역할 | 공식 사이트 |
|:---:|---------|------|-----------|
| <img src="https://img.shields.io/badge/Cilium-F8C517?logo=cilium&logoColor=black" height="28"/> | **Cilium** | eBPF 기반 CNI(Container Network Interface). kube-proxy를 완전 대체하여 커널 레벨에서 L3/L4/L7 네트워킹과 네트워크 정책을 처리 | [cilium.io](https://cilium.io/) |
| <img src="https://img.shields.io/badge/Hubble-F8C517?logo=cilium&logoColor=black" height="28"/> | **Hubble** | Cilium의 네트워크 관측성 도구. Pod 간 트래픽 플로우를 실시간으로 수집하여 FORWARDED/DROPPED 판정과 L7 프로토콜(HTTP/DNS)을 추적 | [docs.cilium.io/hubble](https://docs.cilium.io/en/stable/observability/hubble/) |
| <img src="https://img.shields.io/badge/Istio-466BB0?logo=istio&logoColor=white" height="28"/> | **Istio** | 서비스 메시. dev 클러스터에서 Envoy 사이드카 프록시를 자동 주입하여 mTLS 암호화, 카나리 배포(80/20), 서킷 브레이커를 구현 | [istio.io](https://istio.io/) |
| <img src="https://img.shields.io/badge/Envoy-AC6199?logo=envoyproxy&logoColor=white" height="28"/> | **Envoy** | 고성능 L7 프록시. Istio의 데이터 플레인으로, 각 Pod 옆에 사이드카로 배포되어 모든 인/아웃바운드 트래픽을 중계 | [envoyproxy.io](https://www.envoyproxy.io/) |

### 관측성 & 모니터링

| | 프로젝트 | 역할 | 공식 사이트 |
|:---:|---------|------|-----------|
| <img src="https://img.shields.io/badge/Prometheus-E6522C?logo=prometheus&logoColor=white" height="28"/> | **Prometheus** | 메트릭 수집 및 저장 엔진. 30초 간격으로 모든 노드와 Pod의 CPU/메모리/네트워크 메트릭을 스크래핑하고 7일간 보관 (10Gi) | [prometheus.io](https://prometheus.io/) |
| <img src="https://img.shields.io/badge/AlertManager-E6522C?logo=prometheus&logoColor=white" height="28"/> | **AlertManager** | 알림 라우팅 엔진. Prometheus가 감지한 8개 알림 규칙(HighCPU, OOM, CrashLoop 등)을 웹훅으로 전달 | [prometheus.io/alerting](https://prometheus.io/docs/alerting/latest/alertmanager/) |
| <img src="https://img.shields.io/badge/Grafana-F46800?logo=grafana&logoColor=white" height="28"/> | **Grafana** | 메트릭 시각화 대시보드. Kubernetes Cluster, Node Exporter, Pods 3개 기본 대시보드로 인프라 상태를 한눈에 파악 | [grafana.com](https://grafana.com/) |
| <img src="https://img.shields.io/badge/Loki-F46800?logo=grafana&logoColor=white" height="28"/> | **Loki** | 로그 수집 및 인덱싱 엔진. Promtail이 각 노드의 컨테이너 로그를 수집하여 Loki에 저장, Grafana에서 LogQL로 검색 | [grafana.com/oss/loki](https://grafana.com/oss/loki/) |
| <img src="https://img.shields.io/badge/Node_Exporter-E6522C?logo=prometheus&logoColor=white" height="28"/> | **Node Exporter** | 하드웨어/OS 메트릭 수출기. 각 VM 노드의 CPU, 메모리, 디스크, 네트워크 메트릭을 Prometheus 형식으로 노출 | [github.com/prometheus/node_exporter](https://github.com/prometheus/node_exporter) |

### CI/CD

| | 프로젝트 | 역할 | 공식 사이트 |
|:---:|---------|------|-----------|
| <img src="https://img.shields.io/badge/Jenkins-D24939?logo=jenkins&logoColor=white" height="28"/> | **Jenkins** | CI(Continuous Integration) 서버. Kubernetes 플러그인으로 Pod 기반 빌드 에이전트를 동적 생성하여 파이프라인 실행 | [jenkins.io](https://www.jenkins.io/) |
| <img src="https://img.shields.io/badge/Argo_CD-EF7B4D?logo=argo&logoColor=white" height="28"/> | **ArgoCD** | GitOps CD(Continuous Delivery) 도구. Git 저장소의 매니페스트를 감시하여 클러스터 상태를 자동으로 동기화 | [argoproj.github.io](https://argoproj.github.io/cd/) |

### SRE 대시보드 (프론트엔드)

| | 프로젝트 | 역할 | 공식 사이트 |
|:---:|---------|------|-----------|
| <img src="https://img.shields.io/badge/React_19-61DAFB?logo=react&logoColor=black" height="28"/> | **React** 19 | UI 프레임워크. 6개 페이지(Overview, ClusterDetail, Traffic, Scaling, Testing, Analysis)를 컴포넌트 트리로 구성 | [react.dev](https://react.dev/) |
| <img src="https://img.shields.io/badge/Vite_7-646CFF?logo=vite&logoColor=white" height="28"/> | **Vite** 7 | 프론트엔드 빌드 도구. 개발 서버(port 3000) + `/api/*` 프록시 + HMR(Hot Module Replacement) 제공 | [vite.dev](https://vite.dev/) |
| <img src="https://img.shields.io/badge/TypeScript_5.9-3178C6?logo=typescript&logoColor=white" height="28"/> | **TypeScript** 5.9 | 정적 타입 언어. `shared/types.ts`로 프론트/백엔드 간 25개 이상의 인터페이스를 공유하여 API 계약 보장 | [typescriptlang.org](https://www.typescriptlang.org/) |
| <img src="https://img.shields.io/badge/Tailwind_CSS_4-06B6D4?logo=tailwindcss&logoColor=white" height="28"/> | **Tailwind CSS** 4 | 유틸리티 기반 CSS 프레임워크. `className="flex items-center gap-2 text-slate-400"` 형태로 인라인 스타일링 | [tailwindcss.com](https://tailwindcss.com/) |
| <img src="https://img.shields.io/badge/Recharts_3-22B5BF?logo=chart.js&logoColor=white" height="28"/> | **Recharts** 3 | React 차트 라이브러리. GaugeChart(원형 게이지), SparkLine(미니 라인), AreaChart(시계열 영역) 등 시각화 | [recharts.org](https://recharts.org/) |
| <img src="https://img.shields.io/badge/React_Router_7-CA4245?logo=reactrouter&logoColor=white" height="28"/> | **React Router** 7 | 클라이언트 사이드 라우팅. `/`, `/cluster/:name`, `/traffic`, `/scaling`, `/testing`, `/analysis` 6개 경로 관리 | [reactrouter.com](https://reactrouter.com/) |

### SRE 대시보드 (백엔드)

| | 프로젝트 | 역할 | 공식 사이트 |
|:---:|---------|------|-----------|
| <img src="https://img.shields.io/badge/Node.js-5FA04E?logo=nodedotjs&logoColor=white" height="28"/> | **Node.js** | JavaScript 런타임. Express 서버를 실행하고 SSH/kubectl 명령을 비동기로 처리 | [nodejs.org](https://nodejs.org/) |
| <img src="https://img.shields.io/badge/Express_5-000000?logo=express&logoColor=white" height="28"/> | **Express** 5 | REST API 프레임워크. 11개 엔드포인트로 수집된 인프라 데이터를 프론트엔드에 제공 (port 3001) | [expressjs.com](https://expressjs.com/) |
| <img src="https://img.shields.io/badge/ssh2-000000?logo=openssh&logoColor=white" height="28"/> | **ssh2** | Node.js SSH 클라이언트. 커넥션 풀을 유지하며 10대 VM에 `top/free/df/ss` 명령을 원격 실행하여 리소스 수집 | [github.com/mscdex/ssh2](https://github.com/mscdex/ssh2) |
| <img src="https://img.shields.io/badge/execa_9-000000?logo=gnubash&logoColor=white" height="28"/> | **execa** 9 | Node.js 셸 실행 라이브러리. `tart list`, `tart ip`, `kubectl` 등 로컬 CLI 명령을 실행하고 출력을 파싱 | [github.com/sindresorhus/execa](https://github.com/sindresorhus/execa) |

### 테스트 & 데모 앱

| | 프로젝트 | 역할 | 공식 사이트 |
|:---:|---------|------|-----------|
| <img src="https://img.shields.io/badge/k6-7D64FF?logo=k6&logoColor=white" height="28"/> | **k6** | HTTP 부하 테스트 도구. VU(Virtual User) 기반으로 Light(10VU)/Standard(50VU)/Heavy(200VU) 부하 시나리오 실행 | [k6.io](https://k6.io/) |
| <img src="https://img.shields.io/badge/stress--ng-CC0000?logo=linux&logoColor=white" height="28"/> | **stress-ng** | 시스템 스트레스 테스트 도구. CPU bogo-ops/메모리 할당 테스트로 HPA 오토스케일링 트리거 검증 | [github.com/ColinIanKing/stress-ng](https://github.com/ColinIanKing/stress-ng) |
| <img src="https://img.shields.io/badge/nginx-009639?logo=nginx&logoColor=white" height="28"/> | **nginx** | 웹 서버. 데모 앱의 프론트엔드로 NodePort 30080에서 서비스, HPA(min 3 → max 10)로 오토스케일링 | [nginx.org](https://nginx.org/) |
| <img src="https://img.shields.io/badge/httpbin-4B8BBE?logo=python&logoColor=white" height="28"/> | **httpbin** | HTTP 테스트 서버. GET/POST/PUT/DELETE 요청을 미러링하여 네트워크 정책(L7 필터링) 검증에 사용 | [httpbin.org](https://httpbin.org/) |
| <img src="https://img.shields.io/badge/Redis_7-FF4438?logo=redis&logoColor=white" height="28"/> | **Redis** 7 | 인메모리 캐시 서버. 데모 앱에서 nginx → redis 통신으로 네트워크 정책 검증에 사용 | [redis.io](https://redis.io/) |
| <img src="https://img.shields.io/badge/PostgreSQL_16-4169E1?logo=postgresql&logoColor=white" height="28"/> | **PostgreSQL** 16 | 관계형 데이터베이스. 3-Tier DB 계층 + Keycloak 백엔드 DB. httpbin/keycloak → postgres 통신 | [postgresql.org](https://www.postgresql.org/) |
| <img src="https://img.shields.io/badge/RabbitMQ_3-FF6600?logo=rabbitmq&logoColor=white" height="28"/> | **RabbitMQ** 3 | 메시지 큐(Message Queue). AMQP 프로토콜 기반 비동기 메시지 브로커. Management UI(15672)로 모니터링 | [rabbitmq.com](https://www.rabbitmq.com/) |
| <img src="https://img.shields.io/badge/Keycloak-4D4D4D?logo=keycloak&logoColor=white" height="28"/> | **Keycloak** | ID/인증 관리(IAM) 서버. OAuth 2.0/SSO 제공, PostgreSQL을 백엔드 DB로 사용. NodePort 30880 | [keycloak.org](https://www.keycloak.org/) |

### 호스트 CLI 도구

| | 프로젝트 | 역할 | 공식 사이트 |
|:---:|---------|------|-----------|
| <img src="https://img.shields.io/badge/jq-000000?logo=jq&logoColor=white" height="28"/> | **jq** | 커맨드라인 JSON 프로세서. `config/clusters.json`에서 클러스터/노드 정보를 파싱하여 Bash 변수로 추출 | [jqlang.github.io/jq](https://jqlang.github.io/jq/) |
| <img src="https://img.shields.io/badge/sshpass-000000?logo=openssh&logoColor=white" height="28"/> | **sshpass** | SSH 비밀번호 자동화. VM 프로비저닝 시 수동 입력 없이 `admin/admin`으로 자동 인증 | [sourceforge.net/projects/sshpass](https://sourceforge.net/projects/sshpass/) |
| <img src="https://img.shields.io/badge/local--path--provisioner-0075A8?logo=rancher&logoColor=white" height="28"/> | **local-path-provisioner** v0.0.28 | 동적 PersistentVolume 프로비저너. Rancher 프로젝트, Jenkins/Prometheus의 스토리지 자동 생성 | [github.com/rancher/local-path-provisioner](https://github.com/rancher/local-path-provisioner) |
| <img src="https://img.shields.io/badge/ESLint-4B32C3?logo=eslint&logoColor=white" height="28"/> | **ESLint** 9 | JavaScript/TypeScript 린터. 대시보드 코드 품질 유지 | [eslint.org](https://eslint.org/) |

### CNCF(Cloud Native Computing Foundation) 프로젝트 현황

| | 프로젝트 | CNCF 상태 |
|:---:|---------|----------|
| <img src="https://img.shields.io/badge/Kubernetes-326CE5?logo=kubernetes&logoColor=white" height="22"/> | Kubernetes | Graduated |
| <img src="https://img.shields.io/badge/containerd-575757?logo=containerd&logoColor=white" height="22"/> | containerd | Graduated |
| <img src="https://img.shields.io/badge/Prometheus-E6522C?logo=prometheus&logoColor=white" height="22"/> | Prometheus | Graduated |
| <img src="https://img.shields.io/badge/Cilium-F8C517?logo=cilium&logoColor=black" height="22"/> | Cilium | Graduated |
| <img src="https://img.shields.io/badge/Istio-466BB0?logo=istio&logoColor=white" height="22"/> | Istio | Graduated |
| <img src="https://img.shields.io/badge/Argo_CD-EF7B4D?logo=argo&logoColor=white" height="22"/> | Argo (ArgoCD) | Graduated |
| <img src="https://img.shields.io/badge/Envoy-AC6199?logo=envoyproxy&logoColor=white" height="22"/> | Envoy | Graduated |
| <img src="https://img.shields.io/badge/Helm-0F1689?logo=helm&logoColor=white" height="22"/> | Helm | Graduated |

---

## 2. 인프라 계층

### 2.1 호스트 환경 (macOS)

| 도구 | 역할 | 비고 |
|------|------|------|
| **Tart** | Apple Hypervisor.framework 기반 VM 관리 | ARM64 전용, `tart list/run/ip/clone/set` |
| **kubectl** | Kubernetes CLI | 4개 클러스터 각각 `--kubeconfig`로 접근 |
| **Helm** | Kubernetes 패키지 매니저 | Cilium, Prometheus, Jenkins 등 설치 |
| **jq** | JSON 파서 | `config/clusters.json` 파싱 (`scripts/lib/common.sh`) |
| **sshpass** | SSH 비밀번호 자동화 | VM 프로비저닝 시 자동 인증 (`scripts/lib/ssh.sh`) |
| **Terraform** | IaC (Infrastructure as Code) | >= 1.5 필요 (Bash 스크립트의 대안) |

### 2.2 게스트 VM

| 항목 | 값 | 설정 위치 |
|------|---|----------|
| **Base Image** | `ghcr.io/cirruslabs/ubuntu:latest` | `config/clusters.json` → `base_image` |
| **SSH 인증** | user: `admin`, password: `admin` | `config/clusters.json` → `ssh_user`, `ssh_password` |
| **VM 수** | 10대 (4개 클러스터) | `config/clusters.json` → `clusters[].nodes[]` |

### 2.3 VM 내부 설치 패키지 (APT)

| 패키지 | 역할 | 설치 스크립트 |
|--------|------|-------------|
| **containerd** | 컨테이너 런타임 (SystemdCgroup 활성화) | `scripts/install/03-install-runtime.sh` |
| **kubeadm** 1.31 | 클러스터 초기화 도구 | `scripts/install/04-install-kubeadm.sh` |
| **kubelet** 1.31 | 노드 에이전트 | `scripts/install/04-install-kubeadm.sh` |
| **kubectl** 1.31 | 클러스터 관리 CLI | `scripts/install/04-install-kubeadm.sh` |
| apt-transport-https | HTTPS APT 지원 | `scripts/lib/k8s.sh` |
| ca-certificates | 인증서 번들 | `scripts/lib/k8s.sh` |
| curl | HTTP 클라이언트 | `scripts/lib/k8s.sh` |
| gnupg | GPG 암호화 | `scripts/lib/k8s.sh` |
| conntrack | iptables 연결 추적 | `scripts/lib/k8s.sh` |

---

## 3. Kubernetes 계층

### 3.1 핵심 컴포넌트

| 기술 | 버전 | 역할 | 설정 파일 |
|------|------|------|----------|
| **Kubernetes** | 1.31 | 컨테이너 오케스트레이션 | `scripts/lib/k8s.sh` |
| **containerd** | latest (APT) | 컨테이너 런타임 | `scripts/install/03-install-runtime.sh` |
| **Cilium** | latest (Helm) | eBPF CNI + kube-proxy 대체 | `manifests/cilium-values.yaml` |
| **Hubble** | latest (Helm) | 네트워크 관측성 (트래픽 플로우) | `manifests/hubble-values.yaml` |
| **metrics-server** | latest (Helm) | HPA를 위한 리소스 메트릭 수집 | `manifests/metrics-server-values.yaml` |
| **local-path-provisioner** | v0.0.28 | 동적 PV 프로비저닝 | `scripts/install/08-install-cicd.sh` |

### 3.2 클러스터 네트워크 설정

| 클러스터 | Pod CIDR | Service CIDR |
|----------|----------|-------------|
| platform | 10.10.0.0/16 | 10.96.0.0/16 |
| dev | 10.20.0.0/16 | 10.97.0.0/16 |
| staging | 10.30.0.0/16 | 10.98.0.0/16 |
| prod | 10.40.0.0/16 | 10.99.0.0/16 |

### 3.3 클러스터별 리소스

| 클러스터 | 노드 구성 | 총 vCPU | 총 메모리 |
|----------|----------|---------|----------|
| platform | master(2C/4G) + worker1(3C/12G) + worker2(2C/8G) | 7 | 24 GB |
| dev | master(2C/4G) + worker1(2C/8G) | 4 | 12 GB |
| staging | master(2C/4G) + worker1(2C/8G) | 4 | 12 GB |
| prod | master(2C/3G) + worker1(2C/8G) + worker2(2C/8G) | 6 | 19 GB |

---

## 4. 관측성 스택 (platform 클러스터)

### 4.1 모니터링

| 기술 | Helm Chart | 역할 | NodePort | 설정 파일 |
|------|-----------|------|----------|----------|
| **Prometheus** | kube-prometheus-stack | 메트릭 수집 + 알림 규칙 평가 | - | `manifests/monitoring-values.yaml` |
| **Grafana** | kube-prometheus-stack에 포함 | 메트릭 시각화 대시보드 | 30300 | `manifests/monitoring-values.yaml` |
| **AlertManager** | kube-prometheus-stack에 포함 | 알림 라우팅 + 웹훅 전달 | 30903 | `manifests/alerting/` |
| **Node Exporter** | kube-prometheus-stack에 포함 | VM 레벨 메트릭 (CPU, 메모리, 디스크) | - | 자동 설치 |
| **kube-state-metrics** | kube-prometheus-stack에 포함 | K8s 오브젝트 상태 메트릭 | - | 자동 설치 |
| **Loki** | grafana/loki-stack | 로그 수집 + 인덱싱 | - | `manifests/loki-values.yaml` |
| **Promtail** | loki-stack에 포함 | 로그 전송 에이전트 | - | 자동 설치 |

Helm Chart Repository:
- prometheus-community: `https://prometheus-community.github.io/helm-charts`
- grafana: `https://grafana.github.io/helm-charts`

#### Prometheus 주요 설정

| 설정 | 값 | 설정 위치 |
|------|---|----------|
| 데이터 보관 기간 | 7일 | `monitoring-values.yaml` → `retention` |
| 스토리지 크기 | 10Gi | `monitoring-values.yaml` → `storageSpec` |
| 스크래핑 간격 | 30초 (기본값, 명시적 설정 없음) | kube-prometheus-stack 기본값 |

#### Grafana 기본 대시보드

| 대시보드 | gnetId | Revision |
|----------|--------|----------|
| Kubernetes Cluster | 7249 | 1 |
| Node Exporter Full | 1860 | 37 |
| Kubernetes Pods | 6417 | 1 |

#### AlertManager 알림 규칙 (8개, 2그룹)

**node.rules** (평가 간격: 30초):

| 규칙 | 조건 | 대기 시간 | 심각도 | 설정 파일 |
|------|------|----------|--------|----------|
| HighCpuUsage | CPU > 80% (5분 irate) | 5분 | warning | `manifests/alerting/prometheus-rules.yaml` |
| HighMemoryUsage | 메모리 > 85% | 5분 | warning | 〃 |
| NodeNotReady | 노드 Ready=false | 5분 | critical | 〃 |
| NodeDiskPressure | 노드 DiskPressure=true | 5분 | warning | 〃 |

**pod.rules** (평가 간격: 30초):

| 규칙 | 조건 | 대기 시간 | 심각도 | 설정 파일 |
|------|------|----------|--------|----------|
| PodCrashLooping | 15분간 재시작 > 5회 | 5분 | warning | 〃 |
| PodOOMKilled | OOMKilled 사유 종료 | 즉시 | warning | 〃 |
| HighPodRestartRate | 1시간 내 재시작 > 10회 | 즉시 | warning | 〃 |
| PodNotReady | Pod Ready=false | 10분 | warning | 〃 |

### 4.2 네트워크 관측성

| 기술 | 역할 | NodePort | 설정 파일 |
|------|------|----------|----------|
| **Hubble** | 네트워크 플로우 수집 (L3/L4/L7) | - | `manifests/hubble-values.yaml` |
| **Hubble UI** | 네트워크 토폴로지 시각화 | 31235 | `manifests/hubble-values.yaml` |
| **Hubble Relay** | Hubble 데이터 집계 | - | 자동 설치 |

Hubble 메트릭: `dns`, `drop`, `tcp`, `flow`, `icmp`, `http`

---

## 5. CI/CD 스택 (platform 클러스터)

| 기술 | Helm Chart | 역할 | NodePort | 설정 파일 |
|------|-----------|------|----------|----------|
| **Jenkins** | jenkins/jenkins | CI 빌드 서버 | 30900 | `manifests/jenkins-values.yaml` |
| **ArgoCD** | argo/argo-cd | GitOps CD | 30800 | `manifests/argocd-values.yaml` |

Helm Chart Repository:
- jenkins: `https://charts.jenkins.io`
- argo: `https://argoproj.github.io/argo-helm`

#### Jenkins 플러그인

| 플러그인 | 역할 |
|---------|------|
| kubernetes | K8s 에이전트 기반 빌드 |
| workflow-aggregator | 파이프라인 기능 |
| git | Git 소스 관리 연동 |
| configuration-as-code | JCasC (설정 코드화) |
| pipeline-stage-view | 파이프라인 단계 시각화 |
| blueocean | 모던 UI |

#### ArgoCD 설정

| 설정 | 값 |
|------|---|
| 관리자 비밀번호 | 초기 설정 필요 |
| 서비스 타입 | NodePort (30800) |
| TLS | --insecure (개발 환경) |

---

## 6. 서비스 메시 (dev 클러스터)

| 기술 | Helm Chart | 역할 | 설정 파일 |
|------|-----------|------|----------|
| **Istio Base** | istio/base | CRD (Custom Resource Definition) 설치 | `manifests/istio/istio-values.yaml` |
| **Istiod** | istio/istiod | 컨트롤 플레인 (Pilot) | `manifests/istio/istio-values.yaml` |
| **Istio Gateway** | istio/gateway | Ingress 게이트웨이 | `manifests/istio/istio-gateway.yaml` |

Helm Chart Repository: `https://istio-release.storage.googleapis.com/charts`

#### Istio 리소스 설정

| 컴포넌트 | CPU Request | Memory Request | Memory Limit |
|---------|------------|---------------|-------------|
| Pilot (istiod) | 200m | 256Mi | 512Mi |
| Sidecar Proxy (envoy) | 50m | 64Mi | 128Mi |
| Proxy Init | 10m | 16Mi | 64Mi |

#### Istio Manifest 파일

| 파일 | 역할 |
|------|------|
| `peer-authentication.yaml` | mTLS STRICT 모드 (모든 Pod 간 암호화) |
| `virtual-service.yaml` | 카나리 배포 (v1: 80%, v2: 20%) |
| `destination-rule.yaml` | 서킷 브레이커 + 로드밸런싱 |
| `httpbin-v2.yaml` | httpbin v2 (카나리 배포 대상) |
| `istio-gateway.yaml` | 외부 트래픽 진입점 |

---

## 7. 네트워크 정책

| 파일 | 유형 | 역할 |
|------|------|------|
| `default-deny.yaml` | Ingress 차단 | 모든 인바운드 기본 차단 (Zero-Trust) |
| `allow-external-to-nginx.yaml` | Ingress 허용 | 외부 → nginx 트래픽 허용 |
| `allow-nginx-to-httpbin.yaml` | Ingress + L7 | nginx → httpbin (GET만 허용) |
| `allow-nginx-to-redis.yaml` | Ingress | nginx → redis:6379 허용 |
| `allow-nginx-egress.yaml` | Egress | nginx 아웃바운드 제한 (httpbin, redis, DNS만) |
| `allow-httpbin-to-postgres.yaml` | Ingress | httpbin → postgres:5432 TCP 허용 |
| `allow-httpbin-to-rabbitmq.yaml` | Ingress | httpbin → rabbitmq:5672 AMQP 허용 |
| `allow-httpbin-to-keycloak.yaml` | Ingress | httpbin → keycloak:8080 HTTP 허용 |
| `allow-keycloak-to-postgres.yaml` | Ingress | keycloak → postgres:5432 TCP 허용 |
| `allow-external-to-keycloak.yaml` | Ingress | 외부 → keycloak:8080 NodePort 허용 |
| `allow-istio-sidecars.yaml` | Ingress | Envoy 사이드카 포트 허용 (15000, 15006) |

모든 정책은 `CiliumNetworkPolicy` (L3/L4/L7 지원)로 작성되었다.

---

## 8. 데모 앱 + 테스트 도구

### 8.1 데모 앱 컨테이너 이미지

| 앱 | 이미지 | 역할 | Manifest |
|----|--------|------|----------|
| **nginx** | `nginx:alpine` | 웹 서버 (NodePort 30080) | `manifests/demo/nginx-app.yaml` |
| **httpbin** | `kong/httpbin:latest` | REST API 테스트 서버 | `manifests/demo/httpbin-app.yaml` |
| **redis** | `redis:7-alpine` | 캐시 서버 | `manifests/demo/redis-app.yaml` |
| **postgres** | `postgres:16-alpine` | 데이터베이스 (3-Tier DB + Keycloak 백엔드) | `manifests/demo/postgres-app.yaml` |
| **rabbitmq** | `rabbitmq:3-management-alpine` | 메시지 큐 (AMQP + Management UI) | `manifests/demo/rabbitmq-app.yaml` |
| **keycloak** | `quay.io/keycloak/keycloak:latest` | 인증 서버 (SSO/OAuth 2.0, NodePort 30880) | `manifests/demo/keycloak-app.yaml` |

### 8.2 테스트 도구

| 도구 | 이미지 | 역할 | Manifest |
|------|--------|------|----------|
| **k6** | `grafana/k6:latest` | HTTP 부하 테스트 (VU 기반) | `manifests/demo/k6-loadtest.yaml` |
| **stress-ng** | `alexeiled/stress-ng:latest` | CPU/메모리 스트레스 테스트 | `manifests/demo/stress-test.yaml` |

### 8.3 HPA (Horizontal Pod Autoscaler)

| 대상 | 파일 | Min | Max | CPU Target |
|------|------|-----|-----|-----------|
| nginx | `manifests/hpa/nginx-hpa.yaml` | 3 | 10 | 50% |
| httpbin | `manifests/hpa/httpbin-hpa.yaml` | 2 | 8 | 50% |
| redis | `manifests/hpa/redis-hpa.yaml` | 1 | 4 | 50% |
| postgres | `manifests/hpa/postgres-hpa.yaml` | 1 | 4 | 50% |
| rabbitmq | `manifests/hpa/rabbitmq-hpa.yaml` | 1 | 3 | 50% |

| PDB (Pod Disruption Budget) | 파일 | minAvailable |
|-----------------------------|------|-------------|
| nginx | `manifests/hpa/pdb-nginx.yaml` | 2 |
| httpbin | `manifests/hpa/pdb-httpbin.yaml` | 1 |
| redis | `manifests/hpa/pdb-redis.yaml` | 1 |
| postgres | `manifests/hpa/pdb-postgres.yaml` | 1 |
| rabbitmq | `manifests/hpa/pdb-rabbitmq.yaml` | 1 |
| keycloak | `manifests/hpa/pdb-keycloak.yaml` | 1 |

---

## 9. SRE 대시보드 (Full-Stack TypeScript)

### 9.1 프론트엔드

| 라이브러리 | 버전 | 역할 |
|-----------|------|------|
| **React** | ^19.2.0 | UI 프레임워크 |
| **react-dom** | ^19.2.0 | React DOM 렌더링 |
| **react-router-dom** | ^7.13.1 | 클라이언트 사이드 라우팅 (6개 페이지) |
| **Recharts** | ^3.7.0 | 차트 라이브러리 (게이지, 라인, 영역 차트) |
| **Tailwind CSS** | ^4.2.1 | 유틸리티 기반 CSS 스타일링 |

### 9.2 백엔드

| 라이브러리 | 버전 | 역할 |
|-----------|------|------|
| **Express** | ^5.2.1 | REST API 서버 (port 3001, 11개 엔드포인트) |
| **ssh2** | ^1.17.0 | SSH 커넥션 풀 (VM 원격 명령 실행) |
| **execa** | ^9.6.1 | 로컬 셸 명령 실행 (tart, kubectl) |

### 9.3 빌드 + 개발 도구

| 도구 | 버전 | 역할 |
|------|------|------|
| **TypeScript** | ~5.9.3 | 타입 안전성 (프론트/백엔드 공유 타입) |
| **Vite** | ^7.3.1 | 빌드 도구 + dev server + API 프록시 |
| **@vitejs/plugin-react** | ^5.1.1 | React Babel 플러그인 |
| **@tailwindcss/vite** | ^4.2.1 | Vite용 Tailwind 플러그인 |
| **tsx** | ^4.21.0 | TypeScript 실행기 (서버 개발용) |
| **concurrently** | ^9.2.1 | 프론트+백엔드 동시 실행 |
| **ESLint** | ^9.39.1 | 코드 린팅 |
| **typescript-eslint** | ^8.48.0 | TypeScript ESLint 규칙 |
| **eslint-plugin-react-hooks** | ^7.0.1 | React Hooks 린트 규칙 |
| **eslint-plugin-react-refresh** | ^0.4.24 | React Fast Refresh 호환성 |

### 9.4 타입 정의

| 패키지 | 버전 |
|--------|------|
| @types/node | ^24.10.14 |
| @types/express | ^5.0.6 |
| @types/react | ^19.2.7 |
| @types/react-dom | ^19.2.3 |
| @types/ssh2 | ^1.15.5 |

---

## 10. Terraform (IaC 대안)

| 항목 | 버전/값 | 설정 파일 |
|------|--------|----------|
| **Terraform** | >= 1.5 | `terraform/providers.tf` |
| **hashicorp/null** | ~> 3.2 | 셸 명령 실행용 프로바이더 |
| **hashicorp/helm** | ~> 2.12 | Helm 차트 배포 프로바이더 |
| **hashicorp/local** | ~> 2.4 | 로컬 파일 관리 프로바이더 |

### Terraform 모듈 구조

| 모듈 | 경로 | 역할 |
|------|------|------|
| tart-vm | `terraform/modules/tart-vm/` | VM 생성 + 리소스 할당 |
| k8s-cluster | `terraform/modules/k8s-cluster/` | kubeadm 초기화 + worker join |
| helm-releases | `terraform/modules/helm-releases/` | Helm 차트 배포 (platform) |

---

## 11. 서비스 접속 포트 전체 목록

| 서비스 | NodePort | 클러스터 | 접속 URL 예시 |
|--------|----------|---------|-------------|
| Grafana | 30300 | platform | `http://<platform-worker-ip>:30300` |
| ArgoCD | 30800 | platform | `http://<platform-worker-ip>:30800` |
| Jenkins | 30900 | platform | `http://<platform-worker-ip>:30900` |
| AlertManager | 30903 | platform | `http://<platform-worker-ip>:30903` |
| nginx demo | 30080 | dev | `http://<dev-worker-ip>:30080` |
| Keycloak | 30880 | dev | `http://<dev-worker-ip>:30880` |
| Hubble UI | 31235 | 각 클러스터 | `http://<worker-ip>:31235` |
| SRE Dashboard (Frontend) | 3000 | localhost | `http://localhost:3000` |
| SRE Dashboard (Backend) | 3001 | localhost | `http://localhost:3001` |

---

## 12. 버전 고정 vs 최신 정책

| 구분 | 기술 | 버전 전략 | 이유 |
|------|------|----------|------|
| **고정** | Kubernetes | 1.31 | kubeadm/kubelet/kubectl 버전 일치 필수 |
| **고정** | local-path-provisioner | v0.0.28 | 안정성 |
| **고정** | npm 패키지 | ^(major 고정) | `package-lock.json`으로 재현성 보장 |
| **고정** | Terraform 프로바이더 | ~>(minor 고정) | `.terraform.lock.hcl`로 재현성 보장 |
| **최신** | Helm 차트 (Cilium 등) | latest | 설치 시점 최신. 재현성보다 최신 기능 우선 |
| **최신** | 컨테이너 이미지 (nginx:alpine 등) | latest/tag | 데모 용도이므로 최신 사용 |
| **최신** | Base VM Image | ghcr.io/.../ubuntu:latest | 항상 최신 Ubuntu 사용 |

> **주의**: Helm 차트는 설치 시점에 최신 버전을 가져온다.
> 프로덕션에서는 `--version` 플래그로 버전을 고정하는 것을 권장한다.

---

## 13. 전체 상호작용 흐름도

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

## 14. 인프라 레이어 상호작용

### 14.1 Tart → containerd → kubelet (VM → 컨테이너 런타임 → K8s)

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

### 14.2 Cilium → Hubble (네트워킹 → 옵저버빌리티)

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

## 15. 모니터링 파이프라인 상호작용

### 15.1 메트릭 수집: node-exporter → Prometheus → Grafana

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

### 15.2 로그 수집: Promtail → Loki → Grafana

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

### 15.3 알림: Prometheus → AlertManager → Webhook

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

## 16. CI/CD 파이프라인 상호작용

### 16.1 Jenkins → ArgoCD → 클러스터 배포

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

### 16.2 ArgoCD 멀티 클러스터 배포

```
[ArgoCD (platform 클러스터)]
  │
  ├──kubeconfig──→ [dev 클러스터]      (개발 환경 배포)
  ├──kubeconfig──→ [staging 클러스터]  (스테이징 검증)
  └──kubeconfig──→ [prod 클러스터]     (프로덕션 배포)
```

ArgoCD는 platform 클러스터에 설치되어 있지만, 다른 클러스터의 kubeconfig를 등록하면 원격 클러스터에도 배포할 수 있다. 이것이 platform 클러스터를 "운영 기반 인프라"로 분리한 핵심 이유다.

---

## 17. 서비스 메시 상호작용

### 17.1 istiod → Envoy Sidecar (컨트롤 플레인 → 데이터 플레인)

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

### 17.2 트래픽 라우팅 체인

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

### 17.3 CiliumNetworkPolicy + Istio 공존

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

## 18. 오토스케일링 상호작용

### 18.1 metrics-server → HPA → Deployment

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

### 18.2 HPA 예시 시나리오

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

## 19. SRE 대시보드 상호작용

### 19.1 데이터 수집 체인

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

### 19.2 테스트 실행 체인

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

## 20. 도구 간 의존성 요약

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

## 21. 장애 전파 시나리오

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

## 22. 요청 처리 전체 흐름 예시

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
