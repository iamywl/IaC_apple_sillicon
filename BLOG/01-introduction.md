# 01. 인프라 엔지니어링 입문

> **시리즈**: Apple Silicon 맥에서 구축하는 멀티 클러스터 Kubernetes 인프라
>
> **대상 독자**: 인프라 경험이 전혀 없는 분. 터미널을 열어본 적은 있지만, 서버나 쿠버네티스는 처음인 분.

---

## 인프라가 뭔데?

**인프라(Infrastructure)**란, 소프트웨어가 실행되기 위해 필요한 모든 기반 시스템을 말한다. 아무리 좋은 코드를 작성해도, 그 코드가 돌아갈 **서버, 네트워크, 운영체제, 데이터베이스** 같은 기반이 없으면 서비스를 제공할 수 없다.

이 기반 전체를 우리는 **인프라**라고 부른다.

---

## 수동 인프라 구축의 고통

### 현실: 일일이 손으로 하면 어떻게 되나?

이 프로젝트가 구축하는 환경을 수동으로 만든다고 생각해보자. VM(가상 머신) 10대, 쿠버네티스 클러스터 4개를 세팅해야 한다.

```
수동 과정:

1. VM 생성          → tart clone + tart set을 10번 반복
2. IP 확인          → tart ip를 10번 실행, IP를 메모
3. SSH 접속 + 설정  → 10대에 각각 접속하여 swap off, 커널 모듈 로드, sysctl 설정
4. 런타임 설치      → 10대에 containerd 설치 + SystemdCgroup 설정
5. K8s 도구 설치    → 10대에 kubeadm, kubelet, kubectl 설치
6. 클러스터 초기화  → 4개 master에서 kubeadm init, 토큰 복사, 6개 worker에서 kubeadm join
7. CNI + 오픈소스   → 4개 클러스터에 Cilium 설치, platform에 Prometheus/Jenkins/ArgoCD 설치...
```

"그냥 하면 되는 거 아니야?"라고 생각할 수 있다. 하지만 실제로 해보면 이런 문제들이 생긴다:

| 문제 | 구체적 상황 |
|------|------------|
| **순서 의존성** | containerd를 설치하기 전에 kubeadm을 깔면 에러가 난다. 12단계의 순서를 모두 외워야 한다. |
| **반복 작업** | 같은 명령을 10대의 VM에 각각 입력해야 한다. 복사-붙여넣기의 반복. |
| **IP 변경** | VM을 재부팅하면 IP가 바뀐다. 메모했던 IP가 쓸모없어진다. |
| **오타 한 번의 대가** | sysctl 설정에서 오타 하나가 나면, 클러스터 전체가 안 뜬다. 어디서 틀렸는지 찾기가 어렵다. |
| **재현 불가** | "지난번에 어떻게 했더라?"를 매번 떠올려야 한다. 동료에게 인수인계할 수도 없다. |
| **시간** | 숙련된 엔지니어도 수동으로 1~2시간 이상 걸린다. 실수를 고치다 보면 반나절이 훌쩍. |

---

## 해결책: Infrastructure as Code (IaC)

### 코드로 인프라를 정의한다

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

### 실제 프로젝트에서는

이 프로젝트에서 IaC의 핵심은 `clusters.json`이라는 하나의 설정 파일이다. VM 10대의 이름, CPU, 메모리, 소속 클러스터가 모두 이 파일 하나에 정의되어 있다:

```json
{
  "base_image": "ghcr.io/cirruslabs/ubuntu:latest",
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
    },
    {
      "name": "dev",
      "nodes": [
        { "name": "dev-master", "role": "master", "cpu": 2, "memory": 4096, "disk": 20 },
        { "name": "dev-worker1", "role": "worker", "cpu": 2, "memory": 8192, "disk": 20 }
      ]
    }
    // ... staging, prod 클러스터도 동일한 형식
  ]
}
```

이 파일 하나가 **"단일 진실 공급원(Single Source of Truth)"** 역할을 한다. VM을 추가하고 싶으면? 이 파일에 한 줄 추가하면 된다. 메모리를 늘리고 싶으면? 숫자 하나만 바꾸면 된다.

---

## 수동 vs 자동화: 한눈에 비교

| 수동 작업 | 자동화 방식 | 담당 코드 |
|-----------|------------|-----------|
| VM 10대 하나씩 생성 | `clusters.json`에서 노드 목록을 읽어 **루프로 일괄 생성** | `scripts/install/01-create-vms.sh` |
| IP를 눈으로 확인하고 메모 | `tart ip` 명령을 **3초 간격, 최대 60회 자동 폴링** | `scripts/lib/vm.sh` -> `vm_wait_for_ip()` |
| SSH로 하나씩 접속해서 설정 | `sshpass`로 **자동 인증 후 원격 명령 일괄 실행** | `scripts/lib/ssh.sh` |
| swap 끄기, 커널 설정 | 10대 **모든 노드에 자동으로 동일 설정 적용** | `scripts/install/02-prepare-nodes.sh` |
| containerd + kubeadm 설치 | **APT 저장소 추가부터 설치까지 스크립트로 자동화** | `scripts/install/03~04-*.sh` |
| kubeadm init + join 토큰 복사 | master init 후 **토큰을 자동 추출하여 worker에 전달** | `scripts/install/05-init-clusters.sh` |
| Cilium, Prometheus 등 설치 | **Helm 차트 + values 파일로 선언적 설치** | `scripts/install/06~12-*.sh` |

수동으로 1~2시간 걸리던 작업이, 골든 이미지를 사용하면 **15~20분**에, 골든 이미지 없이도 45~60분에 완료된다. 그것도 명령어 **단 한 줄**로.

---

## 이 시리즈에서 배우게 될 것들

### 12단계 자동화 파이프라인 전체 구조

이 프로젝트는 `install.sh` 하나를 실행하면 12단계가 순서대로 자동 실행된다:

```
clusters.json (설정 파일 하나 -- Single Source of Truth)
    |
    +-> install.sh (오케스트레이터)
          |
          +- 01. VM 생성         : Tart로 10대 복제 + 리소스 할당
          +- 02. 노드 준비       : swap off, 커널 모듈, sysctl
          +- 03. 런타임 설치     : containerd + SystemdCgroup
          +- 04. K8s 도구        : kubeadm, kubelet, kubectl
          +- 05. 클러스터 초기화 : kubeadm init + worker join (x4 클러스터)
          +- 06. CNI 설치        : Cilium eBPF + Hubble (kube-proxy 대체)
          +- 07. 모니터링        : Prometheus + Grafana + Loki
          +- 08. CI/CD           : Jenkins + ArgoCD
          +- 09. 알림            : AlertManager + Prometheus Rules
          +- 10. 네트워크 정책   : Cilium L3/L4/L7 Zero-Trust
          +- 11. 오토스케일링    : metrics-server + HPA + PDB
          +- 12. 서비스 메시     : Istio mTLS + 카나리 + 서킷브레이커
```

각 단계가 무엇이고, 왜 그 순서여야 하는지, 이 시리즈의 각 글에서 하나씩 설명할 것이다.

### 시리즈 로드맵

| 글 번호 | 제목 | 다루는 내용 |
|---------|------|------------|
| **01** | 인프라 엔지니어링 입문 (지금 읽고 있는 글) | IaC 개념, 수동 vs 자동화, 전체 구조 |
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

### 이 시리즈를 마치면 이해할 수 있는 것들

이 시리즈를 끝까지 따라오면, 아래 문장들이 자연스럽게 이해될 것이다:

> "platform 클러스터의 worker1에 Prometheus가 떠 있고, dev 클러스터의 demo 네임스페이스에 nginx Pod가 HPA에 의해 3개에서 10개로 스케일 아웃됐다."

지금은 이 문장이 암호처럼 보일 수 있다. 괜찮다. 이 시리즈가 끝나면 이 문장의 모든 단어를 설명할 수 있게 된다.

---

## 실제로 무엇이 만들어지나?

최종 결과물을 먼저 보여주면, 전체 그림을 이해하기 쉽다.

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
|  |  Total: 10 VMs / 21 vCPU / ~71.5 GB RAM                        |  |
|  +------------------------------------------------------------------+  |
+------------------------------------------------------------------------+
```

### 왜 멀티 클러스터인가 — 단일 클러스터의 한계

단일 클러스터에 모든 워크로드를 넣으면 운영이 단순해 보이지만, 실제로는 세 가지 구조적 문제가 발생한다.

첫째, **blast radius(장애 영향 범위)**가 클러스터 전체로 확대된다. CNI 플러그인 업그레이드가 실패하면 모든 Pod의 네트워크가 끊기고, etcd 장애가 발생하면 모든 워크로드가 스케줄링 불가 상태에 빠진다. 클러스터를 분리하면 하나의 클러스터 장애가 다른 클러스터에 전파되지 않는다.

둘째, **환경 격리가 불가능**하다. 개발자가 CiliumNetworkPolicy를 실험하다 전체 네트워크를 차단하거나, HPA 부하 테스트가 프로덕션 워크로드의 CPU를 잠식하는 상황이 발생할 수 있다. Namespace 수준의 격리는 리소스 경합과 커널 수준 장애를 막지 못한다.

셋째, **배포 파이프라인의 단계적 검증이 불가능**하다. dev -> staging -> prod로 이어지는 프로모션 전략을 적용하려면, 각 단계가 독립된 클러스터여야 실질적인 검증이 된다.

### 4개 클러스터, 각각 다른 역할

| 클러스터 | 역할 | 분리 이유 |
|---------|------|----------|
| **platform** | 모니터링(Prometheus, Grafana, Loki), CI/CD(Jenkins, ArgoCD), 알림(AlertManager) | 관측/배포 인프라는 워크로드 클러스터와 독립적으로 운영되어야 한다. 워크로드 클러스터가 죽어도 모니터링과 CI/CD는 살아 있어야 장애 대응이 가능하다. |
| **dev** | 개발, 실험, 테스트. 데모 앱 배포, Istio, HPA, 네트워크 정책 적용 | 실험과 파괴적 테스트가 자유로워야 한다. 장애가 발생해도 다른 환경에 영향이 없다. |
| **staging** | 사전 검증. prod 배포 전 최종 확인 환경 | prod와 동일한 설정으로 배포를 검증하는 환경이다. dev에서 동작하더라도 prod에서 실패하는 경우(리소스 제약, 네트워크 정책 등)를 사전에 잡아낸다. |
| **prod** | 실제 서비스 운영. Worker 이중화로 고가용성 확보 | 안정성이 최우선이다. 검증되지 않은 설정은 적용하지 않는다. |

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

---

## 이 프로젝트를 실행하려면 뭐가 필요한가?

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

---

## 한 줄이면 시작된다

모든 도구가 설치되었다면, 정말로 한 줄이면 된다:

```bash
./scripts/demo.sh
```

이 명령 하나로:

1. VM 10대가 생성되고
2. 각 VM에 운영체제 설정이 적용되고
3. 컨테이너 런타임과 쿠버네티스 도구가 설치되고
4. 4개의 클러스터가 초기화되고
5. 네트워크, 모니터링, CI/CD, 보안 정책이 모두 구성되고
6. SRE 대시보드가 실행되어 브라우저가 자동으로 열린다

수동으로 하면 수백 줄의 명령어와 1~2시간의 고통이 필요한 작업이, **코드의 힘**으로 명령어 한 줄, 15~20분에 끝난다.

이것이 Infrastructure as Code의 힘이다.

---

## 다음 글 미리보기

다음 글에서는 이 모든 것의 출발점인 **가상화(Virtualization)**에 대해 알아본다.

- 컴퓨터 한 대에서 어떻게 10대의 VM을 돌릴 수 있는 걸까?
- Tart는 뭐고, Apple Hypervisor.framework는 뭔가?
- 골든 이미지라는 건 왜 만드는 걸까?

[다음 글: 02. 가상화와 VM 관리 (Tart) ->](./02-virtualization.md)
