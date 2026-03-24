# 01. 프로젝트 개요 — 인프라 엔지니어링 입문

이 문서는 tart-infra 프로젝트의 전체 그림을 한 곳에서 파악할 수 있도록 구성한 통합 가이드입니다. 인프라가 처음인 분을 위한 개념 설명에서 출발하여, 프로젝트 아키텍처와 자동화 설계를 거쳐, 클러스터별 상세 구성까지 단계적으로 다룹니다.

---

## 목차

- [개념 이해](#개념-이해)
  - [인프라가 뭔데?](#인프라가-뭔데)
  - [수동 인프라 구축의 고통](#수동-인프라-구축의-고통)
  - [해결책: Infrastructure as Code (IaC)](#해결책-infrastructure-as-code-iac)
  - [수동 vs 자동화: 한눈에 비교](#수동-vs-자동화-한눈에-비교)
- [프로젝트 아키텍처](#프로젝트-아키텍처)
  - [이 프로젝트가 하는 일](#이-프로젝트가-하는-일)
  - [아키텍처 전체 그림](#아키텍처-전체-그림)
  - [왜 멀티 클러스터인가](#왜-멀티-클러스터인가--단일-클러스터의-한계)
  - [설정의 단일 원천: clusters.json](#설정의-단일-원천-clustersjson)
  - [자동화 17단계 파이프라인](#자동화-17단계-파이프라인)
  - [골든 이미지로 추가 시간 단축](#골든-이미지로-추가-시간-단축)
  - [데이터 흐름 개요](#데이터-흐름-개요)
  - [디렉토리 구조](#디렉토리-구조)
- [클러스터 구성 상세](#클러스터-구성-상세)
  - [전체 구성 요약](#전체-구성-요약)
  - [Platform 클러스터 — 운영 기반 인프라](#1-platform-클러스터--운영-기반-인프라)
  - [Dev 클러스터 — 개발·실험 환경](#2-dev-클러스터--개발실험-환경)
  - [Staging 클러스터 — 배포 전 검증 환경](#3-staging-클러스터--배포-전-검증-환경)
  - [Prod 클러스터 — 프로덕션 환경](#4-prod-클러스터--프로덕션-환경)
  - [SRE 대시보드 — 전체 클러스터 통합 관제](#5-sre-대시보드--전체-클러스터-통합-관제)
- [실행 가이드](#실행-가이드)
  - [필요 사양](#필요-사양)
  - [왜 Apple Silicon / Tart 기반인가](#왜-apple-silicon--tart-기반인가)
  - [설치해야 할 도구들](#설치해야-할-도구들)
  - [한 줄이면 시작된다](#한-줄이면-시작된다)
- [기술 스택 요약](#기술-스택-요약)
- [전체 포트 요약](#전체-포트-요약)
- [시리즈 로드맵](#시리즈-로드맵)

---

## 개념 이해

### 인프라가 뭔데?

**인프라(Infrastructure)**란, 소프트웨어가 실행되기 위해 필요한 모든 기반 시스템을 말한다. 아무리 좋은 코드를 작성해도, 그 코드가 돌아갈 **서버, 네트워크, 운영체제, 데이터베이스** 같은 기반이 없으면 서비스를 제공할 수 없다.

이 기반 전체를 우리는 **인프라**라고 부른다.

### 수동 인프라 구축의 고통

이 프로젝트가 구축하는 환경을 수동으로 만든다고 생각해보자. VM(가상 머신) 10대, 쿠버네티스 클러스터 4개를 세팅해야 한다.

#### 1단계: VM 생성 및 리소스 할당
```bash
# VM 10대를 하나씩 복제하고 CPU/메모리를 설정
tart clone ghcr.io/cirruslabs/ubuntu:latest platform-master
tart set platform-master --cpu 2 --memory 4096
tart clone ghcr.io/cirruslabs/ubuntu:latest platform-worker1
tart set platform-worker1 --cpu 3 --memory 12288
# ... 나머지 8대도 반복
```

#### 2단계: VM 시작 및 IP 확인
```bash
# VM을 띄우고 DHCP로 IP가 할당될 때까지 대기
tart run platform-master &
tart ip platform-master   # IP가 나올 때까지 반복 확인
# → 192.168.64.5 같은 IP를 메모
# ... 10대 모두 반복, IP를 어딘가에 기록해둬야 함
```

#### 3단계: SSH 접속 및 노드 준비
```bash
# 각 VM에 SSH로 접속해서 커널 설정 변경
ssh admin@192.168.64.5
sudo swapoff -a                          # swap 비활성화
sudo modprobe overlay br_netfilter       # 커널 모듈 로드
sudo sysctl -w net.bridge.bridge-nf-call-iptables=1
sudo sysctl -w net.ipv4.ip_forward=1
# ... 10대 모두 반복
```

#### 4단계: 컨테이너 런타임 및 K8s 도구 설치
```bash
# 각 VM에 containerd, kubeadm, kubelet, kubectl 설치
ssh admin@192.168.64.5
sudo apt-get install containerd
sudo containerd config default > /etc/containerd/config.toml
# SystemdCgroup = true로 수정
sudo apt-get install kubeadm kubelet kubectl
# ... 10대 모두 반복
```

#### 5단계: 클러스터 초기화 및 워커 조인
```bash
# 각 클러스터의 master에서 kubeadm init 실행
ssh admin@192.168.64.5  # platform-master
sudo kubeadm init --pod-network-cidr=10.10.0.0/16 ...
# → join 토큰을 복사해서 worker에 붙여넣기

ssh admin@192.168.64.6  # platform-worker1
sudo kubeadm join 192.168.64.5:6443 --token <토큰> ...
# ... 4개 클러스터 × master/worker 조합만큼 반복
```

#### 6단계: CNI, 모니터링, CI/CD 등 설치
```bash
# 클러스터마다 Cilium 설치, platform에는 Prometheus/Grafana/Jenkins/ArgoCD 설치
# dev에는 Istio, NetworkPolicy, HPA 설치
# kubeconfig 파일 복사, Helm 차트 설정...
```

> **문제점**: VM 10대 × 6단계 = 수십 번의 SSH 접속과 수백 줄의 명령어를 순서대로 실행해야 한다.
> IP가 바뀌면 처음부터 다시 확인해야 하고, 한 단계라도 빠뜨리면 클러스터가 정상 동작하지 않는다.

| 문제 | 구체적 상황 |
|------|------------|
| **순서 의존성** | containerd를 설치하기 전에 kubeadm을 깔면 에러가 난다. 17단계의 순서를 모두 외워야 한다. |
| **반복 작업** | 같은 명령을 10대의 VM에 각각 입력해야 한다. 복사-붙여넣기의 반복. |
| **IP 변경** | VM을 재부팅하면 IP가 바뀐다. 메모했던 IP가 쓸모없어진다. |
| **오타 한 번의 대가** | sysctl 설정에서 오타 하나가 나면, 클러스터 전체가 안 뜬다. 어디서 틀렸는지 찾기가 어렵다. |
| **재현 불가** | "지난번에 어떻게 했더라?"를 매번 떠올려야 한다. 동료에게 인수인계할 수도 없다. |
| **시간** | 숙련된 엔지니어도 수동으로 1~2시간 이상 걸린다. 실수를 고치다 보면 반나절이 훌쩍. |

### 해결책: Infrastructure as Code (IaC)

Infrastructure as Code(코드로서의 인프라, 줄여서 IaC)는 이름 그대로, **인프라 설정을 코드 파일에 적어두는 것**이다.

코드로 적어두면 세 가지 큰 장점이 생긴다:

**1. 반복 가능 (Repeatable)**
```bash
# 이 한 줄이면 매번 동일한 인프라가 만들어진다
./scripts/demo.sh
```

**2. 버전 관리 가능 (Version Controlled)**
```
Git에 코드를 저장하니까:
- 누가, 언제, 무엇을 바꿨는지 추적 가능
- 문제가 생기면 이전 버전으로 되돌리기 가능
- 동료와 코드 리뷰 가능
```

**3. 공유 가능 (Shareable)**
```
설계도를 공유하면 누구나 동일한 환경을 만들 수 있다.
"내 컴퓨터에서는 되는데..." 문제가 사라진다.
```

### 수동 vs 자동화: 한눈에 비교

| 수동 작업 | 자동화 방식 | 담당 코드 |
|-----------|------------|-----------|
| VM 10대 하나씩 생성 | `clusters.json`에서 노드 목록을 읽어 **루프로 일괄 생성** | `scripts/install/01-create-vms.sh` + `scripts/lib/vm.sh` |
| IP를 눈으로 확인하고 메모 | `tart ip` 명령을 **3초 간격으로 최대 60회 자동 폴링** | `scripts/lib/vm.sh` -> `vm_wait_for_ip()` |
| SSH로 하나씩 접속해서 설정 | `sshpass`로 **자동 인증 후 원격 명령 일괄 실행** | `scripts/lib/ssh.sh` -> `ssh_exec()` |
| swap 끄기, 커널 모듈 등 노드 준비 | 10대 **모든 노드에 자동으로 동일한 설정 적용** | `scripts/install/02-prepare-nodes.sh` |
| containerd + kubeadm 설치 | **APT 저장소 추가부터 설치까지 스크립트로 자동화** | `scripts/install/03~04-*.sh` |
| kubeadm init + join 토큰 복사 | master init 후 **토큰을 자동 추출하여 worker에 전달** | `scripts/install/05-init-clusters.sh` -> `scripts/lib/k8s.sh` |
| kubeconfig 파일 복사 | master에서 **SCP로 자동 다운로드** -> `kubeconfig/` 디렉토리에 저장 | `scripts/lib/k8s.sh` -> `scp_from()` |
| Cilium, Prometheus 등 설치 | **Helm 차트 + values 파일로 선언적 설치** | `scripts/install/06~12-*.sh` + `manifests/` |

**일상 운영도 자동화** (install.sh와는 별도):

| 수동 작업 | 자동화 방식 | 담당 코드 |
|-----------|------------|-----------|
| 매일 VM 10대 시작/종료 | `boot.sh` / `shutdown.sh` / `shutdown-all.sh`로 **일괄 관리** | `scripts/boot.sh`, `scripts/shutdown.sh`, `scripts/shutdown-all.sh` |
| 인프라 상태 확인 | `status.sh`로 **VM + 클러스터 + 서비스 한눈에 확인** | `scripts/status.sh` |
| 실시간 모니터링 | **SRE 대시보드**로 4개 클러스터 상태를 웹 UI에서 확인 | `dashboard/` (React + Express, 별도 실행) |

수동으로 1~2시간 걸리던 작업이, 골든 이미지를 사용하면 **15~20분**에, 골든 이미지 없이도 45~60분에 완료된다. 그것도 명령어 **단 한 줄**로.

---

## 프로젝트 아키텍처

### 이 프로젝트가 하는 일

macOS Apple Silicon 위에서 Tart 가상머신 10대를 띄우고, 그 안에 Kubernetes 클러스터 4개를 구성하는 인프라 자동화 프로젝트이다.

```
macOS (Apple Silicon)
  └─ Tart (가상화 런타임)
       ├─ platform 클러스터 (3 VM) ─ 모니터링, CI/CD
       ├─ dev 클러스터 (2 VM)      ─ 개발 환경, Istio, 네트워크 정책
       ├─ staging 클러스터 (2 VM)   ─ 스테이징 환경
       └─ prod 클러스터 (3 VM)      ─ 프로덕션 환경
```

### 아키텍처 전체 그림

```
+------------------------------------------------------------------------+
|  MacBook Pro Apple Silicon (M4 Max, 16 CPU / 128GB RAM)                |
|                                                                        |
|  +------------------------------------------------------------------+  |
|  |  Tart VM Layer  (Apple Hypervisor.framework, ARM64 Native)       |  |
|  |                                                                  |  |
|  |  +----------- platform -----------+  +------ dev --------+      |  |
|  |  |  master   (2C/4G)             |  |  master  (2C/4G)   |      |  |
|  |  |  worker1  (3C/12G)  [모니터링]|  |  worker1 (2C/8G)   |      |  |
|  |  |  worker2  (2C/8G)   [CI/CD]   |  |  [데모 앱]         |      |  |
|  |  +--------------------------------+  +--------------------+      |  |
|  |  +------ staging --------+  +----------- prod -----------+      |  |
|  |  |  master  (2C/4G)      |  |  master  (2C/3G)           |      |  |
|  |  |  worker1 (2C/8G)      |  |  worker1 (2C/8G)           |      |  |
|  |  +------------------------+  |  worker2 (2C/8G)           |      |  |
|  |                              +----------------------------+      |  |
|  |                                                                  |  |
|  |  Total: 10 VMs / 21 vCPU / ~68 GB RAM                          |  |
|  +------------------------------------------------------------------+  |
+------------------------------------------------------------------------+
```

### 왜 멀티 클러스터인가 — 단일 클러스터의 한계

단일 클러스터에 모든 워크로드를 넣으면 운영이 단순해 보이지만, 실제로는 세 가지 구조적 문제가 발생한다.

첫째, **blast radius(장애 영향 범위)**가 클러스터 전체로 확대된다. CNI 플러그인 업그레이드가 실패하면 모든 Pod의 네트워크가 끊기고, etcd 장애가 발생하면 모든 워크로드가 스케줄링 불가 상태에 빠진다. 클러스터를 분리하면 하나의 클러스터 장애가 다른 클러스터에 전파되지 않는다.

둘째, **환경 격리가 불가능**하다. 개발자가 CiliumNetworkPolicy를 실험하다 전체 네트워크를 차단하거나, HPA 부하 테스트가 프로덕션 워크로드의 CPU를 잠식하는 상황이 발생할 수 있다. Namespace 수준의 격리는 리소스 경합과 커널 수준 장애를 막지 못한다.

셋째, **배포 파이프라인의 단계적 검증이 불가능**하다. dev -> staging -> prod로 이어지는 프로모션 전략을 적용하려면, 각 단계가 독립된 클러스터여야 실질적인 검증이 된다.

### 데모 앱 구성

dev 클러스터에는 실제 서비스를 흉내 낸 데모 앱들이 배포된다:

```
Client --:30080--> nginx --> httpbin --> redis (캐시)
                    (웹)      (API)  +-> postgres (DB)
                                     +-> rabbitmq (메시지 큐)

Client --:30880--> keycloak --> postgres (인증 DB)
                    (로그인)
```

이것은 실제 회사에서 흔히 볼 수 있는 **3-Tier 아키텍처**(웹 서버 -> API 서버 -> 데이터베이스)를 그대로 재현한 것이다.

### 설정의 단일 원천: clusters.json

`config/clusters.json`이 프로젝트의 핵심 설정 파일이다. 모든 스크립트와 Terraform이 이 파일을 참조한다.

```json
{
  "base_image": "ghcr.io/cirruslabs/ubuntu:latest",
  "ssh_user": "admin",
  "ssh_password": "admin",
  "clusters": [
    {
      "name": "platform",
      "pod_cidr": "10.10.0.0/16",
      "service_cidr": "10.96.0.0/16",
      "nodes": [
        { "name": "platform-master", "role": "master", "cpu": 2, "memory": 4096, "disk": 20 },
        { "name": "platform-worker1", "role": "worker", "cpu": 3, "memory": 12288, "disk": 20 },
        { "name": "platform-worker2", "role": "worker", "cpu": 2, "memory": 8192, "disk": 20 }
      ]
    }
    // dev, staging, prod도 동일 구조 (배열 원소)
  ]
}
```

이 파일 하나가 **"단일 진실 공급원(Single Source of Truth)"** 역할을 한다. VM을 추가하고 싶으면? 이 파일에 한 줄 추가하면 된다. 메모리를 늘리고 싶으면? 숫자 하나만 바꾸면 된다.

### 자동화 17단계 파이프라인

```
clusters.json (설정 파일 하나)
    │
    └─→ install.sh (오케스트레이터)
          │
          ├─ 01. VM 생성        : Tart로 10대 복제 + 리소스 할당
          ├─ 02. 노드 준비      : swap off, 커널 모듈, sysctl 설정        ← 골든 이미지 시 스킵
          ├─ 03. 런타임 설치    : containerd + SystemdCgroup               ← 골든 이미지 시 스킵
          ├─ 04. K8s 도구 설치  : kubeadm, kubelet, kubectl               ← 골든 이미지 시 스킵
          ├─ 05. 클러스터 초기화 : kubeadm init + worker join (4개 클러스터)
          ├─ 06. CNI 설치       : Cilium eBPF + Hubble (kube-proxy 대체)
          ├─ 07. 모니터링       : Prometheus + Grafana + Loki
          ├─ 08. CI/CD          : Jenkins + ArgoCD
          ├─ 09. 알림           : AlertManager + Prometheus Rules
          ├─ 10. 네트워크 정책  : Cilium L3/L4/L7 Zero-Trust
          ├─ 11. 오토스케일링   : metrics-server + HPA + PDB
          ├─ 12. 서비스 메시    : Istio mTLS + 카나리 배포 + 서킷 브레이커
          ├─ 13. 시크릿 관리    : Sealed Secrets 컨트롤러 + RBAC
          ├─ 14. 정책 강제      : RBAC + OPA Gatekeeper 제약 조건
          ├─ 15. 백업/DR        : etcd 스냅샷 + Velero 리소스 백업
          ├─ 16. 리소스 관리    : ResourceQuota + LimitRange
          └─ 17. 이미지 레지스트리 : Harbor 프라이빗 컨테이너 레지스트리
```

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
| 13 | install-sealed-secrets.sh | 전체 | Sealed Secrets 컨트롤러, 시크릿 RBAC |
| 14 | install-rbac-gatekeeper.sh | 전체 | RBAC 커스텀 역할, OPA Gatekeeper 정책 |
| 15 | install-backup.sh | 전체 | etcd 스냅샷, Velero 스케줄 백업 |
| 16 | install-resource-quotas.sh | dev, staging, prod | ResourceQuota, LimitRange |
| 17 | install-harbor.sh | platform | Harbor 프라이빗 컨테이너 레지스트리 |

### 골든 이미지로 추가 시간 단축

2~4단계(노드 준비, 런타임, K8s 도구 설치)를 미리 포함한 골든 이미지를 빌드하면, 설치 시간을 **45~60분 -> 15~20분**으로 단축할 수 있다.

```bash
./scripts/build-golden-image.sh    # 골든 이미지 빌드 (1회)
# → config/clusters.json의 base_image를 "k8s-golden"으로 변경
# → 이후 install.sh 실행 시 2~4단계가 자동 스킵
```

### 데이터 흐름 개요

```
[clusters.json]
      │
      ├──→ scripts/lib/common.sh (jq로 파싱)
      │         │
      │         ├──→ install.sh → 17단계 설치
      │         ├──→ boot.sh → VM 시작 + 클러스터 확인
      │         └──→ shutdown.sh → 안전한 종료
      │
      ├──→ terraform/variables.tf
      │         │
      │         └──→ main.tf → VM → K8s → Helm 순서 배포
      │
      └──→ dashboard/server/config.ts
                │
                └──→ 5초 폴링 → API → React UI
```

### 디렉토리 구조

```
tart-infra/
├── config/
│   └── clusters.json          ← 모든 설정의 단일 원천 (VM 스펙, CIDR, SSH 정보)
│
├── scripts/
│   ├── demo.sh                ← 원스톱 데모 (install + dashboard 한번에)
│   ├── install.sh             ← 전체 설치 오케스트레이터 (17단계)
│   ├── boot.sh                ← 매일 아침 VM 시작
│   ├── shutdown.sh            ← 단일 클러스터 종료
│   ├── shutdown-all.sh        ← 전체 클러스터 일괄 종료
│   ├── status.sh              ← 인프라 상태 확인
│   ├── destroy.sh             ← 전체 삭제
│   ├── build-golden-image.sh  ← 골든 이미지 빌드 (설치 시간 단축)
│   ├── lib/                   ← 공유 함수 라이브러리
│   │   ├── common.sh          ← 설정 파싱, 로깅, 색상 출력
│   │   ├── vm.sh              ← Tart VM 생명주기 관리
│   │   ├── ssh.sh             ← SSH 실행, 파일 전송
│   │   └── k8s.sh             ← kubeadm, Helm, Cilium 설치
│   ├── install/               ← 설치 단계별 스크립트 (01~17)
│   └── boot/                  ← 부팅 단계별 스크립트 (01~03)
│
├── terraform/
│   ├── main.tf                ← 모듈 조합 (VM → K8s → Helm)
│   ├── variables.tf           ← 변수 정의
│   ├── modules/
│   │   ├── tart-vm/           ← VM 프로비저닝
│   │   ├── k8s-cluster/       ← kubeadm 클러스터 초기화
│   │   └── helm-releases/     ← Helm 차트 배포
│   └── providers.tf           ← Terraform 프로바이더 설정
│
├── manifests/
│   ├── cilium-values.yaml     ← Cilium eBPF CNI 설정
│   ├── hubble-values.yaml     ← 네트워크 관측성
│   ├── monitoring-values.yaml ← Prometheus + Grafana 설정
│   ├── loki-values.yaml       ← 로그 수집
│   ├── argocd-values.yaml     ← GitOps
│   ├── jenkins-values.yaml    ← CI
│   ├── network-policies/      ← CiliumNetworkPolicy (L3/L4/L7)
│   ├── hpa/                   ← HorizontalPodAutoscaler
│   ├── istio/                 ← mTLS, 카나리 배포, 서킷 브레이커
│   ├── demo/                  ← nginx, httpbin, redis, k6, stress-ng
│   ├── sealed-secrets/        ← Sealed Secrets 시크릿 암호화
│   ├── rbac/                  ← RBAC 커스텀 역할
│   ├── gatekeeper/            ← OPA Gatekeeper 정책
│   ├── backup/                ← Velero 백업 스케줄
│   ├── resource-quotas/       ← ResourceQuota + LimitRange
│   ├── harbor-values.yaml     ← Harbor 레지스트리 설정
│   └── velero-values.yaml     ← Velero 백업 설정
│
├── dashboard/
│   ├── server/                ← Express 백엔드 (API 11개)
│   │   ├── index.ts           ← API 라우팅
│   │   ├── collector.ts       ← 5초 주기 데이터 수집
│   │   ├── collectors/        ← tart, ssh, kubectl, hubble, scaling, services
│   │   ├── parsers/           ← top, free, df, ss, netdev, k6, stress-ng
│   │   └── jobs.ts            ← 테스트 실행/관리
│   ├── src/                   ← React 프론트엔드
│   │   ├── pages/             ← 6개 페이지
│   │   └── components/        ← UI 컴포넌트
│   └── shared/types.ts        ← 공유 TypeScript 타입
│
├── kubeconfig/                ← 생성된 kubeconfig 파일 (클러스터별 .yaml)
│
├── docs/                      ← 상세 기술 문서
│   ├── analysis/              ← 프로젝트 분석 (아키텍처 결정, 데이터 플로우 등 5편)
│   ├── bug-reports/           ← 버그 리포트 및 트러블슈팅 기록
│   ├── dashboard.md           ← 대시보드 설계 문서
│   ├── tart.md                ← Tart VM 참고 문서
│   └── terraform.md           ← Terraform 모듈 참고 문서
│
└── LEARN/                     ← 학습 가이드 (이 문서 시리즈)
```

> **`docs/` vs `LEARN/` 차이**: `docs/`는 설계 의도, 아키텍처 결정, 트러블슈팅 기록 등 **참고 자료**이다.
> `LEARN/`은 프로젝트를 처음 접하는 사람을 위한 **단계별 학습 가이드**이다.

---

## 클러스터 구성 상세

### 전체 구성 요약

| 클러스터 | 노드 수 | 총 vCPU | 총 메모리 | 역할 |
|----------|---------|---------|-----------|------|
| platform | 3 (master + worker×2) | 7 | 24 GB | 모니터링, CI/CD, 알림 — 운영 기반 인프라 |
| dev | 2 (master + worker×1) | 4 | 12 GB | 서비스 메시, 데모 앱, 네트워크 정책, 오토스케일링 실습 |
| staging | 2 (master + worker×1) | 4 | 12 GB | 배포 전 검증 환경 (최소 구성) |
| prod | 3 (master + worker×2) | 6 | 19 GB | ArgoCD가 배포하는 프로덕션 대상 클러스터 |

**공통 구성 (모든 노드):** Ubuntu ARM64, containerd, kubelet, Cilium CNI, Hubble, node-exporter, Promtail

### 1. Platform 클러스터 — 운영 기반 인프라

**목적:** 개발/운영에 필요한 공용 서비스(모니터링, CI/CD, 알림)를 집중 배치한다. 다른 클러스터는 워크로드만 돌리고, platform이 전체를 관찰/배포/알림한다.

#### 노드 구성

| 노드 | CPU | 메모리 | 역할 |
|------|-----|--------|------|
| platform-master | 2 | 4 GB | K8s Control Plane (API Server, etcd, scheduler, controller-manager) |
| platform-worker1 | 3 | 12 GB | 모니터링 + CI/CD + 스토리지 (가장 무거운 워크로드) |
| platform-worker2 | 2 | 8 GB | DaemonSet 오버플로 (node-exporter, Promtail, Cilium Agent) |

#### 설치되는 소프트웨어

| 소프트웨어 | 네임스페이스 | NodePort | 역할 |
|-----------|-------------|----------|------|
| **Prometheus** | monitoring | — | 메트릭 수집/저장 (7일 보존, 10Gi PVC) |
| **Grafana** | monitoring | 30300 | 대시보드 시각화 (K8s Cluster, Node Exporter, Pods 대시보드 3종) |
| **Loki** | monitoring | — | 로그 수집/저장 (Promtail이 각 노드에서 로그 전송) |
| **AlertManager** | monitoring | 30903 | 알림 라우팅 (critical/warning 분리, webhook 전달) |
| **Webhook Logger** | monitoring | — | AlertManager 수신 테스트용 에코 서버 |
| **ArgoCD** | argocd | 30800 | GitOps 배포 (dev/prod 클러스터에 앱 배포) |
| **Jenkins** | jenkins | 30900 | CI 파이프라인 (5Gi PVC, BlueOcean 플러그인) |
| **local-path-provisioner** | local-path-storage | — | Jenkins PVC용 로컬 스토리지 |

#### 접속 정보

```
Grafana:      http://<platform-worker-ip>:30300  (admin / admin)
AlertManager: http://<platform-worker-ip>:30903
ArgoCD:       http://<platform-worker-ip>:30800  (admin / kubectl -n argocd get secret argocd-initial-admin-secret)
Jenkins:      http://<platform-worker-ip>:30900  (admin / kubectl -n jenkins get secret jenkins)
Hubble UI:    http://<platform-worker-ip>:31235
```

#### 학습 포인트

- Prometheus + Grafana 기반 메트릭 모니터링 파이프라인 구축
- Loki + Promtail 기반 중앙 로그 수집
- AlertManager 알림 규칙(HighCpuUsage, NodeNotReady, PodCrashLooping 등) 설계
- ArgoCD GitOps 워크플로 (Git -> 자동 배포)
- Jenkins CI 파이프라인 구성

### 2. Dev 클러스터 — 개발/실험 환경

**목적:** 서비스 메시, 네트워크 보안, 오토스케일링, 데모 애플리케이션 등 다양한 CNCF 기술을 실험하는 곳이다. 가장 많은 워크로드가 돌아간다.

#### 노드 구성

| 노드 | CPU | 메모리 | 역할 |
|------|-----|--------|------|
| dev-master | 2 | 4 GB | K8s Control Plane + istiod (Istio 컨트롤 플레인) |
| dev-worker1 | 2 | 8 GB | 데모 앱 6종 + Istio Gateway + HPA + 네트워크 정책 |

#### 설치되는 소프트웨어

**서비스 메시 (istio-system, istio-ingress 네임스페이스)**

| 소프트웨어 | 역할 |
|-----------|------|
| **istiod** | 서비스 메시 컨트롤 플레인 — 사이드카 설정 배포, mTLS 인증서 관리 |
| **Istio Ingress Gateway** | 외부 트래픽 -> 클러스터 내부 라우팅 (NodePort) |
| **Envoy Sidecar** | demo 네임스페이스의 모든 Pod에 자동 주입, L7 트래픽 제어 |

**데모 애플리케이션 (demo 네임스페이스)**

| 앱 | 이미지 | 포트 | 접속 | 역할 |
|----|--------|------|------|------|
| **nginx-web** | nginx:alpine | 80 (NodePort 30080) | 외부 접근 가능 | 프론트엔드 웹서버 (3->10 레플리카 HPA) |
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

| 대상 | 최소->최대 레플리카 | CPU 임계치 | 스케일업 | 스케일다운 |
|------|-------------------|-----------|---------|-----------|
| nginx-web | 3->10 | 50% | 2 pods/15s | 120s |
| httpbin | 2->6 | 50% | 기본 | 120s |
| redis | 1->4 | 50% | 기본 | 120s |
| postgres | 1->4 | 50% | 기본 | 120s |
| rabbitmq | 1->3 | 50% | 기본 | 120s |

**Istio 트래픽 관리**

| 리소스 | 설정 |
|--------|------|
| PeerAuthentication | demo 네임스페이스 전체 Strict mTLS |
| VirtualService (httpbin) | `x-canary: true` 헤더 -> v2, 기본 80% v1 / 20% v2 |
| DestinationRule | 5xx 3회 연속 시 30s 서킷 브레이크, TCP 최대 100 연결 |
| Gateway + VirtualService | `/api` -> httpbin, 나머지 -> nginx-web |

#### 접속 정보

```
nginx-web:  http://<dev-worker-ip>:30080
Keycloak:   http://<dev-worker-ip>:30880  (admin / admin)
Hubble UI:  http://<dev-worker-ip>:31235
```

#### 학습 포인트

- Istio 서비스 메시 + Envoy 사이드카 기반 L7 트래픽 제어
- 카나리 배포 (가중치 기반 트래픽 분배)
- mTLS 자동 적용 및 서킷 브레이커
- CiliumNetworkPolicy 기반 제로 트러스트 네트워크
- HPA + metrics-server 기반 오토스케일링
- 3-tier 애플리케이션 아키텍처 (웹 -> API -> DB/캐시/큐)

### 3. Staging 클러스터 — 배포 전 검증 환경

**목적:** 프로덕션 배포 전에 동일한 K8s 환경에서 검증하는 용도다. 의도적으로 최소한의 구성만 갖추어 prod와 유사한 "깨끗한" 상태를 유지한다.

#### 노드 구성

| 노드 | CPU | 메모리 | 역할 |
|------|-----|--------|------|
| staging-master | 2 | 4 GB | K8s Control Plane |
| staging-worker1 | 2 | 8 GB | 워크로드 노드 (현재 metrics-server만 동작) |

#### 설치되는 소프트웨어

| 소프트웨어 | 네임스페이스 | 역할 |
|-----------|-------------|------|
| **metrics-server** | kube-system | 리소스 메트릭 수집 (kubectl top 명령어 활성화) |

그 외에는 공통 구성(Cilium, Hubble, node-exporter, Promtail)만 동작한다.

#### 활용 방법

```bash
# ArgoCD에서 staging 클러스터를 대상으로 Application을 생성하여 배포 테스트
argocd cluster add staging --kubeconfig kubeconfig/staging.yaml

# 배포 후 검증
kubectl --kubeconfig kubeconfig/staging.yaml get pods -A

# 리소스 확인
kubectl --kubeconfig kubeconfig/staging.yaml top nodes
kubectl --kubeconfig kubeconfig/staging.yaml top pods -A
```

#### 학습 포인트

- 스테이징 환경 설계 원칙 (프로덕션과 동일 구성, 최소 워크로드)
- ArgoCD를 통한 멀티 클러스터 배포 대상 추가
- 배포 전 smoke test 수행

### 4. Prod 클러스터 — 프로덕션 환경

**목적:** ArgoCD가 GitOps로 배포하는 최종 프로덕션 대상이다. 현재는 K8s + Cilium만 동작하는 "빈 슬레이트" 상태이며, ArgoCD Application이 워크로드를 자동 배포한다.

#### 노드 구성

| 노드 | CPU | 메모리 | 역할 |
|------|-----|--------|------|
| prod-master | 2 | 4 GB | K8s Control Plane |
| prod-worker1 | 2 | 8 GB | 워크로드 노드 |
| prod-worker2 | 2 | 8 GB | 워크로드 노드 (고가용성을 위한 2대 구성) |

#### 설치되는 소프트웨어

공통 구성(Cilium, Hubble, node-exporter, Promtail)만 동작한다. 애플리케이션은 ArgoCD가 Git에서 자동 배포한다.

#### 활용 방법

```bash
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

#### 학습 포인트

- GitOps 기반 프로덕션 배포 파이프라인 (코드 커밋 -> 자동 배포)
- 멀티 워커 노드 고가용성 구성
- 프로덕션 환경 격리 원칙

### 5. SRE 대시보드 — 전체 클러스터 통합 관제

대시보드는 4개 클러스터 전체를 실시간으로 모니터링하는 웹 애플리케이션이다.

#### 기술 스택

| 구분 | 기술 | 버전 |
|------|------|------|
| 프론트엔드 | React + TypeScript + Tailwind CSS | React 19, Vite 7 |
| 백엔드 | Express + TypeScript | Express 5, Node.js |
| 차트 | Recharts | 3.7 |

#### 실행 방법

```bash
cd dashboard
npm install
npm run dev          # 프론트엔드 :3000 + 백엔드 :3001 동시 실행
```

#### 페이지 구성

| 경로 | 페이지 | 데이터 갱신 주기 | 설명 |
|------|--------|-----------------|------|
| `/` | Overview | 5초 | 4개 클러스터 요약 카드 (노드 상태, Pod 수, CPU/메모리) |
| `/cluster/:name` | Cluster Detail | 5초 + 30초(서비스) | 개별 클러스터 상세 (노드, Pod 목록, 리소스 게이지) |
| `/traffic` | Traffic | 10초 | Hubble 기반 네트워크 토폴로지 시각화 |
| `/scaling` | Scaling | 3초 | HPA 스케일링 히스토리 차트 |
| `/testing` | Testing | 2초 | SRE 테스트 실행 (k6 부하, stress-ng) 16개 프리셋 |
| `/analysis` | Load Analysis | — | 성능 분석 KPI 요약, Pod 효율 차트 |

#### 데이터 수집 방식

| 수집 대상 | 방식 | 주기 |
|-----------|------|------|
| VM 상태/IP | `tart list`, `tart ip` | 5초 |
| CPU/메모리/디스크/네트워크 | SSH -> top, free, df, /proc/net/dev | 5초 |
| 노드/Pod 상태 | kubectl get nodes/pods | 5초 |
| HPA 상태 | kubectl get hpa | 5초 |
| 서비스/엔드포인트 | kubectl get svc,endpoints | 30초 |
| 네트워크 플로 | Hubble observe (최근 200건) | 10초 |

---

## 실행 가이드

### 필요 사양

| 항목 | 최소 사양 | 권장 사양 |
|------|----------|----------|
| Mac | Apple Silicon (M1 이상) | M4 Max |
| RAM | 64 GB | 128 GB |
| 디스크 | 100 GB 여유 | 200 GB 이상 |
| macOS | 13 Ventura 이상 | 최신 |

### 왜 Apple Silicon / Tart 기반인가

이 프로젝트가 Apple Silicon Mac을 기반으로 하는 이유는 세 가지다.

첫째, **ARM64 네이티브 성능**이다. Apple Silicon의 Hypervisor.framework는 하드웨어 가상화 확장(VHE)을 직접 활용하므로, Rosetta 변환이나 x86 에뮬레이션 없이 ARM64 Linux VM을 네이티브 속도로 실행한다. VM 10대를 동시에 돌리는 이 프로젝트에서 에뮬레이션 오버헤드는 치명적이다.

둘째, **클라우드 비용 절감**이다. 동일한 구성(VM 10대, 21 vCPU, 72GB RAM)을 AWS나 GCP에서 운영하면 월 수십만 원의 비용이 발생한다. 로컬 Mac 한 대로 전체 인프라를 재현하면 추가 비용이 없다.

셋째, **로컬 학습 환경**이다. 클라우드 환경에서는 managed Kubernetes(EKS, GKE)가 Control Plane을 추상화하므로, kubeadm init, CNI 설치, etcd 구성 같은 클러스터 부트스트래핑 과정을 직접 경험할 수 없다. 로컬 환경에서 바닥부터 구축해야 각 컴포넌트의 역할과 의존 관계를 실질적으로 이해할 수 있다.

### 설치해야 할 도구들

```bash
brew install tart kubectl helm jq sshpass terraform
```

| 도구 | 한 줄 설명 |
|------|-----------|
| `tart` | VM을 만들고 관리하는 도구 (Apple Silicon 전용) |
| `kubectl` | 쿠버네티스에게 명령을 내리는 CLI 도구 |
| `helm` | 쿠버네티스용 패키지 관리자 |
| `jq` | JSON 파일을 읽고 파싱하는 도구 |
| `sshpass` | SSH 접속 시 비밀번호를 자동 입력해주는 도구 |
| `terraform` | 선언적 인프라 관리 도구 |

### 한 줄이면 시작된다

```bash
# 방법 1: 인프라 설치 + 대시보드까지 한번에 (원스톱 데모)
./scripts/demo.sh

# 방법 2: 인프라 설치만
./scripts/install.sh
```

> **`demo.sh` 옵션**:
> - `--skip-install` : 이미 설치된 VM을 부팅만 하고 대시보드 시작
> - `--dashboard-only` : 대시보드만 시작 (인프라가 이미 실행 중일 때)
> - `--skip-dashboard` : 인프라만 구성하고 대시보드는 건너뜀

이 명령 하나로:

1. VM 10대가 생성되고
2. 각 VM에 운영체제 설정이 적용되고
3. 컨테이너 런타임과 쿠버네티스 도구가 설치되고
4. 4개의 클러스터가 초기화되고
5. 네트워크, 모니터링, CI/CD, 보안 정책이 모두 구성되고
6. SRE 대시보드가 실행되어 브라우저가 자동으로 열린다

수동으로 하면 수백 줄의 명령어와 1~2시간의 고통이 필요한 작업이, **코드의 힘**으로 명령어 한 줄, 15~20분에 끝난다. 이것이 Infrastructure as Code의 힘이다.

---

## 기술 스택 요약

> 전체 기술 스택의 상세 버전과 설정은 [09-tech-stack.md](09-tech-stack.md)를 참고하세요.

| 계층 | 기술 | 역할 |
|------|------|------|
| 가상화 | Tart (Apple Hypervisor.framework) | ARM64 VM 관리 |
| OS | Ubuntu (ghcr.io/cirruslabs/ubuntu:latest) | 게스트 OS |
| 컨테이너 런타임 | containerd (SystemdCgroup) | 컨테이너 실행 |
| 오케스트레이션 | Kubernetes 1.31 (kubeadm) | 컨테이너 오케스트레이션 |
| CNI | Cilium (eBPF) + Hubble | 네트워킹 + kube-proxy 대체 + 네트워크 관측성 |
| 관측성 | Prometheus + Grafana + Loki + AlertManager | 메트릭, 로그, 알림 |
| 서비스 메시 | Istio + Envoy | mTLS, 카나리 배포, 서킷 브레이커 |
| CI/CD | Jenkins + ArgoCD | 빌드 + GitOps |
| IaC | Terraform (>= 1.5) + Bash | 인프라 자동화 |
| 대시보드 | React 19 + Express 5 + TypeScript 5.9 | SRE 운영 대시보드 |
| 빌드 도구 | Vite 7 + Tailwind CSS 4 | 프론트엔드 빌드 + 스타일링 |
| 테스트 도구 | k6 + stress-ng | 부하 테스트 + 스트레스 테스트 |
| 호스트 도구 | tart, kubectl, helm, jq, sshpass | macOS에서 실행하는 CLI 도구 |

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

## 시리즈 로드맵

이 시리즈를 끝까지 따라오면, 아래 문장이 자연스럽게 이해될 것이다:

> "platform 클러스터의 worker1에 Prometheus가 떠 있고, dev 클러스터의 demo 네임스페이스에 nginx Pod가 HPA에 의해 3개에서 10개로 스케일 아웃됐다."

| 글 번호 | 제목 | 다루는 내용 |
|---------|------|------------|
| **01** | 프로젝트 개요 — 인프라 엔지니어링 입문 (지금 읽고 있는 글) | IaC 개념, 수동 vs 자동화, 전체 구조 |
| **02** | 가상화와 VM 관리 (Tart) | VM, 하이퍼바이저, 골든 이미지, Phase 1 |
| **03** | 컨테이너와 Kubernetes | 컨테이너, containerd, K8s 기초, Phase 2~5 |
| 04 | 네트워킹과 CNI (Cilium) | CNI, eBPF, Hubble, 네트워크 정책 |
| 05 | 모니터링 스택 (Prometheus/Grafana/Loki) | Prometheus, Grafana, Loki, 알림 |
| 06 | Infrastructure as Code | Terraform, 선언적 인프라 관리, clusters.json |
| 07 | CI/CD 파이프라인 (Jenkins/ArgoCD) | Jenkins, ArgoCD, GitOps |
| 08 | 네트워크 보안 (CiliumNetworkPolicy) | L3/L4/L7 정책, Zero-Trust 네트워크 |
| 09 | 오토스케일링 (HPA/PDB) | metrics-server, HPA, PDB |
| 10 | 서비스 메시 (Istio) | mTLS, 카나리 배포, 서킷브레이커 |
| 11 | 데모 애플리케이션 배포 | nginx, httpbin, redis, postgres, rabbitmq, keycloak |
| 12 | SRE 대시보드 | React + Express, 실시간 모니터링 |
| 13 | 부하 테스트 (k6/stress-ng) | 부하 테스트 시나리오, 성능 분석 |
| 14 | 트러블슈팅 프레임워크 | 장애 진단, 디버깅 절차, 로그 분석 |
| 15 | 통합과 운영 | 전체 파이프라인 통합, 운영 전략 |
