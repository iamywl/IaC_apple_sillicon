# 01. 프로젝트 전체 구조

## 이 프로젝트가 하는 일

macOS Apple Silicon 위에서 Tart 가상머신 10대를 띄우고, 그 안에 Kubernetes 클러스터 4개를 구성하는 인프라 자동화 프로젝트입니다.

```
macOS (Apple Silicon)
  └─ Tart (가상화 런타임)
       ├─ platform 클러스터 (3 VM) ─ 모니터링, CI/CD
       ├─ dev 클러스터 (2 VM)      ─ 개발 환경, Istio, 네트워크 정책
       ├─ staging 클러스터 (2 VM)   ─ 스테이징 환경
       └─ prod 클러스터 (3 VM)      ─ 프로덕션 환경
```

## 수동으로 하면 이런 과정이 필요하다

VM 10대에 Kubernetes 클러스터 4개를 구성하려면, 수동으로는 다음과 같은 작업을 **반복적으로** 수행해야 합니다.

### 1단계: VM 생성 및 리소스 할당
```bash
# VM 10대를 하나씩 복제하고 CPU/메모리를 설정
tart clone ghcr.io/cirruslabs/ubuntu:latest platform-master
tart set platform-master --cpu 2 --memory 4096
tart clone ghcr.io/cirruslabs/ubuntu:latest platform-worker1
tart set platform-worker1 --cpu 3 --memory 12288
# ... 나머지 8대도 반복
```

### 2단계: VM 시작 및 IP 확인
```bash
# VM을 띄우고 DHCP로 IP가 할당될 때까지 대기
tart run platform-master &
tart ip platform-master   # IP가 나올 때까지 반복 확인
# → 192.168.64.5 같은 IP를 메모
# ... 10대 모두 반복, IP를 어딘가에 기록해둬야 함
```

### 3단계: SSH 접속 및 노드 준비
```bash
# 각 VM에 SSH로 접속해서 커널 설정 변경
ssh admin@192.168.64.5
sudo swapoff -a                          # swap 비활성화
sudo modprobe overlay br_netfilter       # 커널 모듈 로드
sudo sysctl -w net.bridge.bridge-nf-call-iptables=1
sudo sysctl -w net.ipv4.ip_forward=1
# ... 10대 모두 반복
```

### 4단계: 컨테이너 런타임 및 K8s 도구 설치
```bash
# 각 VM에 containerd, kubeadm, kubelet, kubectl 설치
ssh admin@192.168.64.5
sudo apt-get install containerd
sudo containerd config default > /etc/containerd/config.toml
# SystemdCgroup = true로 수정
sudo apt-get install kubeadm kubelet kubectl
# ... 10대 모두 반복
```

### 5단계: 클러스터 초기화 및 워커 조인
```bash
# 각 클러스터의 master에서 kubeadm init 실행
ssh admin@192.168.64.5  # platform-master
sudo kubeadm init --pod-network-cidr=10.10.0.0/16 ...
# → join 토큰을 복사해서 worker에 붙여넣기

ssh admin@192.168.64.6  # platform-worker1
sudo kubeadm join 192.168.64.5:6443 --token <토큰> ...
# ... 4개 클러스터 × master/worker 조합만큼 반복
```

### 6단계: CNI, 모니터링, CI/CD 등 설치
```bash
# 클러스터마다 Cilium 설치, platform에는 Prometheus/Grafana/Jenkins/ArgoCD 설치
# dev에는 Istio, NetworkPolicy, HPA 설치
# kubeconfig 파일 복사, Helm 차트 설정...
```

> **문제점**: VM 10대 × 6단계 = 수십 번의 SSH 접속과 수백 줄의 명령어를 순서대로 실행해야 합니다.
> IP가 바뀌면 처음부터 다시 확인해야 하고, 한 단계라도 빠뜨리면 클러스터가 정상 동작하지 않습니다.
> 전체 과정에 **수동으로 1~2시간** 이상 걸리며, 실수 가능성이 높습니다.

## 이 프로젝트는 이것을 어떻게 자동화했는가

위의 모든 수동 과정을 **명령어 하나**로 실행합니다.

```bash
./scripts/install.sh
```

> **참고**: `install.sh`는 인프라 구성(VM + K8s + 오픈소스 설치)만 자동화합니다.
> SRE 운영 대시보드(`dashboard/`)는 별도의 React+Express 앱으로, 인프라 구성 완료 후 독립적으로 실행합니다.

### 자동화 핵심 설계

| 수동 작업 | 자동화 방식 | 담당 코드 |
|-----------|------------|-----------|
| VM 10대 하나씩 생성 | `clusters.json`에서 노드 목록을 읽어 **루프로 일괄 생성** | `scripts/install/01-create-vms.sh` + `scripts/lib/vm.sh` |
| IP를 눈으로 확인하고 메모 | `tart ip` 명령을 **3초 간격으로 최대 60회 자동 폴링** | `scripts/lib/vm.sh` → `vm_wait_for_ip()` |
| SSH로 하나씩 접속해서 설정 | `sshpass`로 **자동 인증 후 원격 명령 일괄 실행** | `scripts/lib/ssh.sh` → `ssh_exec()` |
| swap 끄기, 커널 모듈 등 노드 준비 | 10대 **모든 노드에 자동으로 동일한 설정 적용** | `scripts/install/02-prepare-nodes.sh` |
| containerd + kubeadm 설치 | **APT 저장소 추가부터 설치까지 스크립트로 자동화** | `scripts/install/03~04-*.sh` |
| kubeadm init + join 토큰 복사 | master init 후 **토큰을 자동 추출하여 worker에 전달** | `scripts/install/05-init-clusters.sh` → `scripts/lib/k8s.sh` |
| kubeconfig 파일 복사 | master에서 **SCP로 자동 다운로드** → `kubeconfig/` 디렉토리에 저장 | `scripts/lib/k8s.sh` → `scp_from()` |
| Cilium, Prometheus 등 설치 | **Helm 차트 + values 파일로 선언적 설치** | `scripts/install/06~12-*.sh` + `manifests/` |

**일상 운영도 자동화** (install.sh와는 별도):

| 수동 작업 | 자동화 방식 | 담당 코드 |
|-----------|------------|-----------|
| 매일 VM 10대 시작/종료 | `boot.sh` / `shutdown.sh`로 **일괄 관리** | `scripts/boot.sh`, `scripts/shutdown.sh` |
| 인프라 상태 확인 | `status.sh`로 **VM + 클러스터 + 서비스 한눈에 확인** | `scripts/status.sh` |
| 실시간 모니터링 | **SRE 대시보드**로 4개 클러스터 상태를 웹 UI에서 확인 | `dashboard/` (React + Express, 별도 실행) |

### 자동화 12단계 파이프라인

```
clusters.json (설정 파일 하나)
    │
    └─→ install.sh (오케스트레이터)
          │
          ├─ 01. VM 생성        : Tart로 10대 복제 + 리소스 할당
          ├─ 02. 노드 준비      : swap off, 커널 모듈, sysctl 설정
          ├─ 03. 런타임 설치    : containerd + SystemdCgroup
          ├─ 04. K8s 도구 설치  : kubeadm, kubelet, kubectl
          ├─ 05. 클러스터 초기화 : kubeadm init + worker join (4개 클러스터)
          ├─ 06. CNI 설치       : Cilium eBPF + Hubble (kube-proxy 대체)
          ├─ 07. 모니터링       : Prometheus + Grafana + Loki
          ├─ 08. CI/CD          : Jenkins + ArgoCD
          ├─ 09. 알림           : AlertManager + Prometheus Rules
          ├─ 10. 네트워크 정책  : Cilium L3/L4/L7 Zero-Trust
          ├─ 11. 오토스케일링   : metrics-server + HPA + PDB
          └─ 12. 서비스 메시    : Istio mTLS + 카나리 배포 + 서킷 브레이커
```

### 골든 이미지로 추가 시간 단축

2~4단계(노드 준비, 런타임, K8s 도구 설치)를 미리 포함한 골든 이미지를 빌드하면, 설치 시간을 **45~60분 → 15~20분**으로 단축할 수 있습니다.

```bash
./scripts/build-golden-image.sh    # 골든 이미지 빌드 (1회)
# → config/clusters.json의 baseImage를 "k8s-golden"으로 변경
# → 이후 install.sh 실행 시 2~4단계가 자동 스킵
```

## 4개 클러스터의 역할

| 클러스터 | VM 수 | 리소스 | 역할 |
|----------|--------|--------|------|
| **platform** | master + worker1 + worker2 | 7 vCPU / 24 GB | Prometheus, Grafana, Loki, Jenkins, ArgoCD |
| **dev** | master + worker1 | 4 vCPU / 12 GB | 데모 앱, Istio 서비스 메시, HPA, 네트워크 정책 |
| **staging** | master + worker1 | 4 vCPU / 12 GB | 스테이징 검증 환경 |
| **prod** | master + worker1 + worker2 | 6 vCPU / 19 GB | 프로덕션 (worker 2대로 고가용성) |

## 디렉토리 구조

```
tart-infra/
├── config/
│   └── clusters.json          ← 모든 설정의 단일 원천 (VM 스펙, CIDR, SSH 정보)
│
├── scripts/
│   ├── install.sh             ← 전체 설치 오케스트레이터 (12단계)
│   ├── boot.sh                ← 매일 아침 VM 시작
│   ├── shutdown.sh            ← 매일 저녁 VM 종료
│   ├── status.sh              ← 인프라 상태 확인
│   ├── destroy.sh             ← 전체 삭제
│   ├── build-golden-image.sh  ← 골든 이미지 빌드 (설치 시간 단축)
│   ├── lib/                   ← 공유 함수 라이브러리
│   │   ├── common.sh          ← 설정 파싱, 로깅, 색상 출력
│   │   ├── vm.sh              ← Tart VM 생명주기 관리
│   │   ├── ssh.sh             ← SSH 실행, 파일 전송
│   │   └── k8s.sh             ← kubeadm, Helm, Cilium 설치
│   ├── install/               ← 설치 단계별 스크립트 (01~12)
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
│   └── demo/                  ← nginx, httpbin, redis, k6, stress-ng
│
├── dashboard/
│   ├── server/                ← Express 백엔드 (API 9개)
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
├── kubeconfig/                ← 생성된 kubeconfig 파일
└── doc/                       ← 기존 문서
```

## 설정의 단일 원천: clusters.json

`config/clusters.json`이 프로젝트의 핵심 설정 파일입니다. 모든 스크립트와 Terraform이 이 파일을 참조합니다.

```json
{
  "baseImage": "ghcr.io/cirruslabs/ubuntu:latest",
  "sshUser": "admin",
  "sshPassword": "admin",
  "clusters": {
    "platform": {
      "podCIDR": "10.10.0.0/16",
      "serviceCIDR": "10.110.0.0/16",
      "nodes": {
        "platform-master": { "cpu": 2, "memory": 4096, "role": "master" },
        "platform-worker1": { "cpu": 3, "memory": 12288, "role": "worker" },
        "platform-worker2": { "cpu": 2, "memory": 8192, "role": "worker" }
      }
    }
    // dev, staging, prod도 동일 구조
  }
}
```

**수정 예시**: 새 클러스터를 추가하려면 이 파일에 항목만 추가하면 됩니다.

## 데이터 흐름 개요

```
[clusters.json]
      │
      ├──→ scripts/lib/common.sh (jq로 파싱)
      │         │
      │         ├──→ install.sh → 12단계 설치
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

## 기술 스택 요약

| 계층 | 기술 | 역할 |
|------|------|------|
| 가상화 | Tart (Apple Hypervisor.framework) | ARM64 VM 관리 |
| OS | Ubuntu 24.04 ARM64 | 게스트 OS |
| 컨테이너 런타임 | containerd | 컨테이너 실행 |
| 오케스트레이션 | Kubernetes 1.31 (kubeadm) | 컨테이너 오케스트레이션 |
| CNI | Cilium (eBPF) | 네트워킹 + kube-proxy 대체 |
| 관측성 | Hubble + Prometheus + Grafana + Loki | 메트릭, 로그, 네트워크 플로우 |
| 서비스 메시 | Istio + Envoy | mTLS, 카나리 배포, 서킷 브레이커 |
| CI/CD | Jenkins + ArgoCD | 빌드 + GitOps |
| IaC | Terraform + Bash | 인프라 자동화 |
| 대시보드 | React 19 + Express 5 + TypeScript | SRE 운영 대시보드 |
