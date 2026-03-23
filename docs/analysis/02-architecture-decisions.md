# 02. 아키텍처 결정과 이유

이 문서는 프로젝트의 핵심 기술 결정 8가지를 설명합니다.
각 결정마다 **"왜 이걸 선택했는가"**와 **"다른 선택지는 뭐가 있었는가"**를 비교합니다.

---

## 결정 1: 왜 Tart VM인가

### 문제
Apple Silicon Mac에서 멀티 노드 Kubernetes를 구성하려면 가상머신이 필요합니다. Docker Desktop이나 minikube는 단일 노드만 지원하여 실제 클러스터 환경을 재현할 수 없습니다.

### 선택: Tart

| 도구 | 아키텍처 | 멀티 노드 | 성능 | 네트워크 격리 |
|------|----------|----------|------|-------------|
| **Tart** | Apple Hypervisor.framework (네이티브) | O (VM 단위) | 네이티브 ARM64 | softnet으로 VM 간 통신 |
| Docker Desktop | Linux VM 위에서 실행 | X (단일 노드) | 오버헤드 있음 | Docker 네트워크 |
| Vagrant + VirtualBox | x86 에뮬레이션 | O | 매우 느림 (Rosetta) | NAT/Bridged |
| Lima | QEMU 기반 | O | Tart보다 느림 | User networking |
| UTM | QEMU 래퍼 | O | GUI 중심, 자동화 어려움 | NAT |

### 왜 Tart를 선택했는가
1. **네이티브 성능**: Apple Hypervisor.framework를 직접 사용하여 x86 에뮬레이션 없이 ARM64 Ubuntu 실행
2. **CLI 자동화 친화적**: `tart clone`, `tart run`, `tart ip` 등 스크립트로 완전 자동화 가능
3. **리소스 효율**: 10개 VM을 128GB RAM에서 동시 운영 가능
4. **softnet 네트워킹**: `--net-softnet-allow` 옵션으로 VM 간 직접 통신 가능 (kubeadm join에 필수)

---

## 결정 2: 왜 4개 클러스터인가

### 문제
"Kubernetes를 배우려면 클러스터 하나면 되지 않나?"

### 왜 4개인가
실제 기업에서는 **절대로** 하나의 클러스터에 모든 것을 넣지 않습니다.

```
기업 환경:
┌──────────┐    ┌──────┐    ┌─────────┐    ┌──────┐
│ Platform │    │ Dev  │───→│ Staging │───→│ Prod │
│ (관리)    │    │(개발) │    │ (검증)   │    │(운영) │
└──────────┘    └──────┘    └─────────┘    └──────┘
      │              │           │              │
      └──────────────┴───────────┴──────────────┘
              모니터링, GitOps, CI/CD로 연결
```

| 클러스터 | 왜 분리하는가 |
|----------|--------------|
| **platform** | 모니터링/CI/CD는 서비스 장애에 영향 받으면 안 됨. 관찰 도구가 관찰 대상과 같은 곳에 있으면 장애 시 원인 파악 불가 |
| **dev** | 실험적 기능(Istio, L7 정책)을 안전하게 테스트. prod가 깨져도 dev는 무관 |
| **staging** | prod 배포 전 최종 검증. prod와 유사한 설정으로 "여기서 되면 거기서도 된다" |
| **prod** | 실제 서비스 운영. 워커 2개로 고가용성, PDB로 최소 가용 Pod 보장 |

### 대안과 비교

| 구성 | 장점 | 단점 |
|------|------|------|
| 클러스터 1개 + Namespace 분리 | 리소스 절약 | Namespace는 네트워크/리소스 완전 격리 안 됨 |
| 클러스터 2개 (dev + prod) | 단순함 | staging 없으면 prod 배포가 도박 |
| **클러스터 4개** | 실제 기업 환경 재현 | 리소스 많이 필요 (128GB RAM) |

---

## 결정 3: 왜 kubeadm인가

### 문제
Kubernetes를 설치하는 방법은 여러 가지입니다.

### 선택: kubeadm

| 도구 | 프로덕션 수준 | 학습 가치 | 커스터마이징 | 설치 난이도 |
|------|-------------|----------|------------|-----------|
| **kubeadm** | O (공식 도구) | 매우 높음 | 높음 | 중간 |
| k3s | O (경량) | 낮음 (많은 것이 숨겨짐) | 낮음 | 쉬움 |
| kind | X (테스트용) | 낮음 | 매우 낮음 | 매우 쉬움 |
| minikube | X (단일 노드) | 낮음 | 낮음 | 매우 쉬움 |
| kops | O | 중간 | 높음 | AWS 필요 |

### 왜 kubeadm을 선택했는가
1. **Kubernetes 공식 클러스터 부트스트래핑 도구**: CKA/CKS 시험에서도 사용
2. **내부 동작이 투명**: swap off, 커널 모듈 로드, containerd 설정, API server 인증서 생성 등 모든 과정을 직접 제어
3. **kube-proxy 제거 가능**: `--skip-phases=addon/kube-proxy` 옵션으로 Cilium이 대체
4. **멀티 마스터, 커스텀 CIDR**: 클러스터별 Pod/Service CIDR 지정 가능

k3s를 사용했다면 설치는 빨랐겠지만, "왜 swap을 꺼야 하는지", "왜 br_netfilter 모듈이 필요한지" 같은 핵심 지식을 얻을 수 없습니다.

---

## 결정 4: 왜 Bash + Terraform 이중 자동화인가

### 문제
자동화를 Bash로 할까, Terraform으로 할까?

### 답: 둘 다

```
scripts/install/          ← 명령형 (Imperative): "이 순서대로 실행해라"
terraform/                ← 선언형 (Declarative): "최종 상태가 이래야 한다"
```

| 방식 | 장점 | 단점 |
|------|------|------|
| **Bash (명령형)** | 디버깅 쉬움 (echo로 중간값 확인), 단계별 실행 가능, 학습 곡선 낮음 | 상태 관리 없음, 멱등성 직접 구현 필요 |
| **Terraform (선언형)** | 상태 파일로 현재 상태 추적, `plan`으로 변경 사항 미리 확인, 의존성 자동 해결 | Tart 공식 Provider 없어서 `null_resource` + `local-exec`로 우회 |

### 왜 둘 다 유지하는가
1. **Bash가 먼저 만들어짐**: 프로토타입과 디버깅 용도로 Bash 스크립트가 먼저 작성됨
2. **Terraform이 Bash를 재사용**: Terraform 모듈 안에서 `scripts/lib/`의 함수를 직접 호출 (`source scripts/lib/k8s.sh`)
3. **용도가 다름**: 일상적인 부팅/종료는 Bash가 편하고, 전체 인프라를 한 번에 올리거나 내릴 때는 Terraform이 안전
4. **학습 목적**: 같은 결과를 두 가지 방법으로 달성하면서 IaC의 장단점을 체감

---

## 결정 5: 왜 kube-proxy를 제거하고 Cilium으로 대체했는가

### 문제
Kubernetes의 기본 네트워크 구성은 `kube-proxy` (iptables 기반) + 별도 CNI 플러그인입니다.

### 선택: Cilium으로 kube-proxy까지 대체

```
일반적인 구성:                    이 프로젝트의 구성:
┌──────────────┐                ┌──────────────┐
│  kube-proxy  │ (iptables)     │              │
│  + Flannel   │ (VXLAN)        │  Cilium      │ (eBPF)
│  또는 Calico  │ (BGP)          │  = CNI       │
│              │                │  + kube-proxy│
│  2개 컴포넌트 │                │  + 옵저버빌리티│
└──────────────┘                │  1개로 통합   │
                                └──────────────┘
```

| 항목 | kube-proxy + Flannel | Cilium (kube-proxy 대체) |
|------|---------------------|------------------------|
| 구현 기술 | iptables 규칙 | eBPF 프로그램 (커널 내) |
| 성능 | 규칙 많아지면 O(n) 성능 저하 | eBPF 해시맵으로 O(1) |
| 네트워크 정책 | L3/L4만 가능 | L7까지 가능 (HTTP 메소드 필터링) |
| 옵저버빌리티 | 별도 도구 필요 | Hubble 내장 (DNS, TCP, HTTP 메트릭) |
| 컴포넌트 수 | 2개 (kube-proxy + CNI) | 1개 (Cilium이 모두 대체) |

### 핵심 설정

```yaml
# manifests/cilium-values.yaml
kubeProxyReplacement: true   # kube-proxy 완전 대체
ipam:
  mode: cluster-pool          # IP 할당 방식
```

```bash
# scripts/lib/k8s.sh - init_cluster()
kubeadm init \
  --skip-phases=addon/kube-proxy \  # kube-proxy 설치 안 함
  ...
```

### 이 프로젝트에서 L7 정책 활용 예시

```yaml
# manifests/network-policies/allow-nginx-to-httpbin.yaml
# nginx → httpbin으로의 HTTP GET만 허용 (POST, DELETE는 차단)
rules:
  http:
    - method: GET
```

iptables 기반 kube-proxy로는 이런 HTTP 메소드 레벨 제어가 불가능합니다.

---

## 결정 6: 왜 softnet 네트워킹인가

### 문제
Tart VM의 기본 네트워크 모드는 **NAT**입니다. NAT에서는 호스트(Mac) → VM 접속은 가능하지만, **VM ↔ VM 직접 통신이 안 됩니다.**

### 왜 이게 문제인가
```
kubeadm join 실행 시:
  worker VM ──────→ master VM (API server 6443 포트)
                     ↑
                     이 통신이 NAT에서는 불가능!
```

### 해결: softnet

```bash
# scripts/lib/vm.sh - vm_start()
tart run "$vm_name" --no-graphics --net-softnet-allow=0.0.0.0/0 &
```

`--net-softnet-allow=0.0.0.0/0` 옵션을 사용하면:
- 모든 VM이 같은 소프트웨어 네트워크에 연결됨
- VM 간 직접 IP 통신 가능
- DHCP로 IP 자동 할당 (재부팅 시 IP 변경됨 → boot 스크립트에서 TLS 인증서 재생성 + 매니페스트/kubeconfig IP 갱신)

### 대안

| 방식 | 가능 여부 |
|------|----------|
| NAT (기본) | VM 간 통신 불가 → kubeadm join 실패 |
| Bridged | macOS에서 Wi-Fi 브릿지 지원 안 함 |
| **softnet** | VM 간 통신 가능, 설정 간단 |

---

## 결정 7: 왜 골든 이미지 패턴인가

### 문제
10개 VM에 동일한 작업(swap off, containerd 설치, kubeadm 설치)을 반복하면 **30분 이상** 소요됩니다.

### 해결: 한 번만 설치하고 이미지로 저장

```
일반 설치:                        골든 이미지 사용:
base image ─clone→ VM1            base image ─clone→ golden-vm
base image ─clone→ VM2              ├─ swap off
base image ─clone→ VM3              ├─ containerd 설치
  ...                                ├─ kubeadm 설치
base image ─clone→ VM10             └─ 이미지 저장: k8s-golden
                                         │
각 VM에 개별 설치 (x10)               k8s-golden ─clone→ VM1~10
= 45~60분                            = 15~20분 (설치 건너뜀)
```

```bash
# scripts/install/build-golden-image.sh
# 1. 기본 이미지 클론
# 2. swap off, 커널 모듈, containerd, kubeadm 설치
# 3. Kubernetes + Cilium 컨테이너 이미지 미리 다운로드
# 4. "k8s-golden"으로 저장
```

```bash
# scripts/install/install.sh
# 골든 이미지가 있으면 Phase 2~4를 건너뜀
if tart list | grep -q "k8s-golden"; then
  BASE_IMAGE="k8s-golden"
  # Phase 2, 3, 4 스킵
fi
```

이 패턴은 실제 클라우드 환경에서도 사용됩니다 (AWS AMI, GCP Machine Image 등).

---

## 결정 8: 대시보드의 백그라운드 수집 + Cache-Aside 패턴

### 문제
대시보드가 API 요청을 받을 때마다 10개 VM에 SSH 접속해서 데이터를 수집하면?
→ 응답 시간이 10~30초, VM 하나라도 응답 안 하면 전체 실패

### 해결: 백그라운드에서 주기적으로 수집하고, API는 캐시된 데이터를 즉시 반환

```
┌─────────────────────────────────────────┐
│           Express 백엔드                 │
│                                         │
│  ┌─────────────┐    ┌───────────────┐  │
│  │ Background   │    │ REST API      │  │
│  │ Collectors   │──→ │ /api/snapshot │  │
│  │              │    │ /api/traffic  │  │
│  │ Main: 5초    │    │ /api/scaling  │  │
│  │ Scaling: 5초 │    │               │  │
│  │ Traffic: 10초│    │ 캐시에서 즉시  │  │
│  │ Services: 30초│   │ 반환 (< 10ms) │  │
│  └──────┬───────┘    └───────────────┘  │
│         │                               │
│    SSH Connection Pool                   │
│    (10개 VM에 상시 연결 유지)              │
└─────────────────────────────────────────┘
```

| 수집 루프 | 주기 | 수집 내용 |
|----------|------|----------|
| Main | 5초 | VM 정보, SSH 리소스(CPU/메모리/디스크/네트워크), kubectl 노드/파드 |
| Scaling | 5초 | HPA 상태 (360포인트 링 버퍼 = 30분 히스토리) |
| Traffic | 10초 | Hubble 네트워크 플로우 (최근 200개) |
| Services | 30초 | K8s 서비스 + 엔드포인트 |

### 왜 이 패턴인가

| 방식 | 응답 시간 | 장애 내성 | 구현 복잡도 |
|------|----------|----------|-----------|
| 요청마다 수집 | 10~30초 | VM 1개 죽으면 전체 실패 | 낮음 |
| **백그라운드 수집 + 캐시** | < 10ms | `Promise.allSettled`로 일부 실패해도 나머지 정상 | 중간 |
| WebSocket 스트리밍 | 실시간 | 복잡한 재연결 로직 필요 | 높음 |

---

## 요약: 8가지 결정 한눈에

| # | 결정 | 핵심 이유 |
|---|------|----------|
| 1 | Tart VM | Apple Silicon 네이티브 성능 + CLI 자동화 |
| 2 | 4개 클러스터 | 실제 기업 멀티 클러스터 전략 재현 |
| 3 | kubeadm | 프로덕션급 + 내부 동작 학습 가능 |
| 4 | Bash + Terraform | 디버깅 편의성(Bash) + 상태 관리(Terraform) |
| 5 | Cilium (kube-proxy 대체) | eBPF 성능 + L7 정책 + Hubble 옵저버빌리티 통합 |
| 6 | softnet | VM 간 직접 통신 (kubeadm join에 필수) |
| 7 | 골든 이미지 | 설치 시간 45분 → 15분 단축 |
| 8 | 백그라운드 수집 | API 응답 < 10ms + 부분 장애 허용 |

---

## 다음 문서

각 오픈소스 도구를 왜 선택했는지 알고 싶다면 → [03-opensource-tools.md](03-opensource-tools.md)
