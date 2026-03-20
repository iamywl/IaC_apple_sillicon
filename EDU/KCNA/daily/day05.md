# KCNA Day 5: 컨테이너 오케스트레이션 & 컨테이너 기술

> 학습 목표: 컨테이너 핵심 기술(namespace, cgroups, OCI)과 오케스트레이션 개념을 이해한다.
> 예상 소요 시간: 60분 (개념 40분 + 문제 20분)
> 시험 도메인: Container Orchestration (22%) - Part 1
> 난이도: ★★★★☆

---

## 오늘의 학습 목표

- Linux namespace와 cgroups의 차이를 명확히 구분한다
- 컨테이너와 VM의 차이를 설명할 수 있다
- OCI(Open Container Initiative) 3가지 사양을 안다
- CRI, CNI, CSI 인터페이스를 구분한다
- Dockerfile 지시어(CMD vs ENTRYPOINT)를 이해한다
- 컨테이너 이미지 관련 개념(Tag, Digest, 멀티스테이지 빌드)을 안다

---

## 1. 컨테이너 핵심 기술

### 1.1 Linux namespace와 cgroups (시험 빈출!)

```
namespace vs cgroups (절대 혼동 금지!)
============================================================

namespace (네임스페이스) = 격리 (Isolation)
  프로세스가 볼 수 있는 시스템 리소스의 범위를 제한
  종류:
  - PID namespace: 프로세스 ID 격리
  - Network namespace: 네트워크 인터페이스/IP 격리
  - Mount namespace: 파일 시스템 마운트 격리
  - UTS namespace: 호스트명 격리
  - IPC namespace: 프로세스 간 통신 격리
  - User namespace: 사용자/그룹 ID 격리
  - Cgroup namespace: cgroup 계층 격리

cgroups (Control Groups) = 리소스 제한 (Resource Limitation)
  프로세스 그룹의 리소스 사용량을 제한하고 모니터링
  제한 대상:
  - CPU: 사용 가능한 CPU 시간 제한
  - Memory: 메모리 사용량 제한 (초과 시 OOMKill)
  - I/O: 디스크 I/O 대역폭 제한
  - Network: 네트워크 대역폭 제한

핵심 암기:
  namespace = "무엇을 볼 수 있는가?" (격리)
  cgroups = "얼마나 사용할 수 있는가?" (제한)
```

### 1.2 컨테이너 vs VM

```
컨테이너 vs VM 비교
============================================================

VM (Virtual Machine):
+-------------------------------------------+
| 앱 A    | 앱 B    | 앱 C                   |
| 바이너리 | 바이너리 | 바이너리                |
| 게스트OS | 게스트OS | 게스트OS               |
+-------------------------------------------+
|          Hypervisor (VMware, KVM)          |
+-------------------------------------------+
|              Host OS                       |
+-------------------------------------------+
|            Hardware                        |
+-------------------------------------------+

컨테이너 (Container):
+-------------------------------------------+
| 앱 A    | 앱 B    | 앱 C                   |
| 바이너리 | 바이너리 | 바이너리                |
+-------------------------------------------+
|     Container Runtime (containerd)         |
+-------------------------------------------+
|           Host OS (커널 공유!)              |
+-------------------------------------------+
|            Hardware                        |
+-------------------------------------------+
```

| 항목 | 컨테이너 | VM |
|------|---------|-----|
| **크기** | 수 MB ~ 수백 MB | 수 GB |
| **시작 시간** | 초 단위 | 분 단위 |
| **커널** | **호스트 커널 공유** | 게스트 OS 별도 커널 |
| **격리 수준** | 프로세스 수준 (약함) | 하드웨어 수준 (**강함**) |
| **밀도** | 높음 (수십~수백 개) | 낮음 (수~수십 개) |
| **오버헤드** | 매우 적음 | 큼 (게스트 OS) |

**시험 포인트:**
- 컨테이너는 호스트 **커널을 공유**한다!
- 보안 격리는 **VM이 더 강하다** (하드웨어 수준)
- 컨테이너가 더 **가볍고 빠르다**

---

## 2. OCI (Open Container Initiative)

### 2.1 OCI 3가지 사양

> **OCI**란?
> Linux Foundation 하위 프로젝트로, 컨테이너 포맷과 런타임에 대한 **개방형 표준**을 정의한다.

| 사양 | 설명 |
|------|------|
| **Runtime Specification** | 컨테이너 실행 방법 정의 (runc가 참조 구현체) |
| **Image Specification** | 컨테이너 이미지 포맷 정의 |
| **Distribution Specification** | 이미지 배포(레지스트리) API 정의 |

```
OCI 핵심 포인트:
- Runtime Spec + Image Spec + Distribution Spec = 3가지 (시험!)
- "Orchestration Specification"은 OCI에 없다!
- Docker 이미지 = OCI 이미지 표준 호환
- dockershim 제거(v1.24) 후에도 Docker 이미지는 OCI로 계속 사용 가능
```

---

## 3. 컨테이너 런타임 계층

### 3.1 런타임 비교

```
런타임 계층 구조
============================================================

kubelet
   |
   | CRI (Container Runtime Interface)
   |
   v
containerd (고수준 런타임, CNCF 졸업)
   |  - 이미지 관리 (pull, push)
   |  - 컨테이너 생명주기
   |
   v
runc (저수준 런타임, OCI 참조 구현체)
   |  - Linux namespace 생성
   |  - cgroups 설정
   |
   v
Linux Kernel
```

| 런타임 | 수준 | 설명 | CNCF |
|--------|------|------|------|
| **containerd** | 고수준 | Docker에서 분리, 가장 널리 사용 | **졸업** |
| **CRI-O** | 고수준 | Red Hat 주도, K8s 전용 경량 | **인큐베이팅** |
| **runc** | 저수준 | OCI 참조 구현체 | - |
| **gVisor** | 저수준 | Google, 커널 샌드박스 보안 강화 | - |
| **Kata Containers** | 저수준 | 경량 VM 기반 (강한 격리) | - |

---

## 4. CRI, CNI, CSI 인터페이스

```
K8s 표준 인터페이스 3종
============================================================

CRI (Container Runtime Interface):
  kubelet ↔ 컨테이너 런타임 (containerd, CRI-O)
  목적: 런타임 교체 가능

CNI (Container Network Interface):
  K8s ↔ 네트워크 플러그인 (Calico, Cilium, Flannel)
  목적: 네트워크 플러그인 교체 가능

CSI (Container Storage Interface):
  K8s ↔ 스토리지 플러그인 (AWS EBS, Ceph, NFS)
  목적: 스토리지 드라이버 교체 가능
```

---

## 5. Dockerfile 핵심

### 5.1 CMD vs ENTRYPOINT (시험 빈출!)

```
CMD vs ENTRYPOINT
============================================================

CMD:
  - 컨테이너 시작 시 실행할 기본 명령어
  - docker run 인자로 덮어쓸 수 있음
  - K8s에서 spec.containers[].args에 매핑

ENTRYPOINT:
  - 컨테이너가 항상 실행할 고정 명령어
  - --entrypoint 플래그로만 변경 가능
  - K8s에서 spec.containers[].command에 매핑

K8s 매핑:
  Dockerfile ENTRYPOINT → K8s command
  Dockerfile CMD        → K8s args
```

### 5.2 멀티스테이지 빌드

```
멀티스테이지 빌드 (Multi-stage Build)
============================================================

목적: 빌드 도구를 최종 이미지에서 제외하여 크기 감소

# Stage 1: 빌드
FROM golang:1.21 AS builder
WORKDIR /app
COPY . .
RUN go build -o myapp

# Stage 2: 실행 (빌드 도구 없음!)
FROM alpine:3.18
COPY --from=builder /app/myapp /usr/local/bin/
CMD ["myapp"]

결과: 800MB(Go SDK 포함) → 15MB(바이너리만)
```

---

## 6. 컨테이너 이미지 관련 개념

### 6.1 Tag vs Digest

```
Tag vs Digest
============================================================

Tag (태그):
  nginx:1.25
  - 사람이 읽기 쉬운 식별자
  - 동일 태그에 다른 이미지를 push 가능 (변경 가능!)
  - :latest는 자동 업데이트 위험

Digest (다이제스트):
  nginx@sha256:abc123...
  - SHA-256 해시로 이미지를 고유 식별
  - 불변(immutable)! 안전한 참조 방식
  - 프로덕션 환경에서 권장

시험 포인트:
- Tag = 변경 가능
- Digest = 불변 (SHA-256 해시)
- 프로덕션에서는 Digest 사용 권장
```

### 6.2 컨테이너 레지스트리

| 레지스트리 | 설명 | CNCF |
|-----------|------|------|
| **Docker Hub** | 가장 유명한 공개 레지스트리 | - |
| **Harbor** | 오픈소스 프라이빗 레지스트리 | **졸업** |
| **Quay** | Red Hat의 레지스트리 | - |
| **GCR/ECR/ACR** | 클라우드 제공업체 레지스트리 | - |

---

## 7. 컨테이너 오케스트레이션 개요

### 7.1 오케스트레이션이란?

```
컨테이너 오케스트레이션이 제공하는 기능
============================================================

1. 스케줄링: Pod를 최적의 노드에 배치
2. 자동 복구 (Self-healing): 장애 시 자동 재시작/재배치
3. 수평 확장 (Horizontal Scaling): 트래픽에 따라 Pod 수 조절
4. 서비스 디스커버리: Service/DNS로 Pod 검색
5. 로드밸런싱: 트래픽을 여러 Pod에 분배
6. 롤링 업데이트: 무중단 배포
7. 설정 관리: ConfigMap/Secret으로 설정 외부화

오케스트레이션이 아닌 것:
- 소스 코드 컴파일 (CI 도구의 역할)
- 코드 테스트 (CI 도구의 역할)
```

### 7.2 K8s 서비스 디스커버리

> **CoreDNS**란?
> K8s의 기본 DNS 서버이며, CNCF **졸업** 프로젝트이다. 이전의 kube-dns를 대체하였다. Pod가 Service 이름으로 접근하면 CoreDNS가 해당 Service의 ClusterIP를 반환한다.

---

## 8. KCNA 실전 모의 문제 (12문제)

### 문제 1.
리소스 사용량(CPU, 메모리)을 제한하는 Linux 커널 기능은?

A) namespace
B) cgroups
C) seccomp
D) AppArmor

<details><summary>정답 확인</summary>

**정답: B) cgroups**

**cgroups(Control Groups)**는 CPU, 메모리, I/O 등의 리소스 사용량을 제한한다. **namespace**는 프로세스 격리를 제공한다.
</details>

---

### 문제 2.
컨테이너와 VM을 비교한 설명으로 올바른 것은?

A) 컨테이너는 VM보다 보안 격리가 강하다
B) 컨테이너는 호스트 OS의 커널을 공유하므로 VM보다 가볍다
C) VM은 컨테이너보다 시작 시간이 빠르다
D) 컨테이너는 각각 독립된 게스트 OS를 포함한다

<details><summary>정답 확인</summary>

**정답: B) 컨테이너는 호스트 OS의 커널을 공유하므로 VM보다 가볍다**

컨테이너는 호스트 커널을 공유하여 수 MB 크기, 초 단위 시작이다. VM은 게스트 OS를 포함하여 수 GB 크기이다. 보안 격리는 VM이 더 강하다.
</details>

---

### 문제 3.
OCI(Open Container Initiative)가 정의하는 사양이 아닌 것은?

A) Runtime Specification
B) Image Specification
C) Distribution Specification
D) Orchestration Specification

<details><summary>정답 확인</summary>

**정답: D) Orchestration Specification**

OCI는 **Runtime Spec, Image Spec, Distribution Spec** 3가지만 정의한다. Orchestration은 OCI의 범위가 아니다.
</details>

---

### 문제 4.
runc에 대한 설명으로 올바른 것은?

A) 고수준 컨테이너 런타임으로, 이미지 관리를 담당한다
B) OCI Runtime Specification의 참조 구현체로, 저수준 컨테이너 런타임이다
C) K8s의 패키지 매니저이다
D) 컨테이너 네트워크 플러그인이다

<details><summary>정답 확인</summary>

**정답: B) OCI Runtime Specification의 참조 구현체로, 저수준 컨테이너 런타임이다**

**runc**는 Linux namespace, cgroups를 호출하여 컨테이너 프로세스를 생성하는 저수준 런타임이다.
</details>

---

### 문제 5.
CMD와 ENTRYPOINT의 차이로 올바른 것은?

A) CMD는 고정이고 ENTRYPOINT는 덮어쓰기 가능하다
B) CMD는 덮어쓰기 가능하고 ENTRYPOINT는 고정이다
C) 둘은 동일한 기능을 한다
D) CMD는 빌드 시, ENTRYPOINT는 런타임에 실행된다

<details><summary>정답 확인</summary>

**정답: B) CMD는 덮어쓰기 가능하고 ENTRYPOINT는 고정이다**

K8s에서 CMD는 `args`, ENTRYPOINT는 `command`에 매핑된다.
</details>

---

### 문제 6.
K8s의 서비스 디스커버리를 담당하는 기본 DNS 서버는?

A) kube-dns
B) CoreDNS
C) PowerDNS
D) BIND

<details><summary>정답 확인</summary>

**정답: B) CoreDNS**

**CoreDNS**는 K8s의 기본 DNS 서버이며, CNCF 졸업 프로젝트이다.
</details>

---

### 문제 7.
멀티스테이지 빌드의 주된 목적은?

A) 빌드 속도 향상
B) 빌드와 실행 분리로 최종 이미지 크기 감소
C) 여러 OS 지원
D) 보안 취약점 자동 수정

<details><summary>정답 확인</summary>

**정답: B) 빌드와 실행 분리로 최종 이미지 크기 감소**

멀티스테이지 빌드는 빌드 도구를 최종 이미지에서 제외하여 크기를 대폭 줄인다.
</details>

---

### 문제 8.
컨테이너 이미지의 특정 버전을 SHA256 해시로 고유하게 식별하는 것은?

A) Tag
B) Digest
C) Label
D) Version

<details><summary>정답 확인</summary>

**정답: B) Digest**

이미지 **다이제스트(Digest)**는 SHA256 해시로 이미지를 고유하게 식별한다. 태그는 변경 가능하지만 다이제스트는 불변이다.
</details>

---

### 문제 9.
CNCF 졸업 프로젝트인 오픈소스 프라이빗 컨테이너 레지스트리는?

A) Docker Hub
B) Quay
C) Harbor
D) Nexus

<details><summary>정답 확인</summary>

**정답: C) Harbor**

**Harbor**는 CNCF 졸업 프로젝트인 오픈소스 프라이빗 레지스트리이다.
</details>

---

### 문제 10.
CRI(Container Runtime Interface)에 대한 설명으로 올바른 것은?

A) 컨테이너 네트워크를 설정하는 인터페이스이다
B) kubelet과 컨테이너 런타임 간의 표준 통신 인터페이스이다
C) 스토리지 플러그인을 위한 인터페이스이다
D) DNS 서비스를 위한 인터페이스이다

<details><summary>정답 확인</summary>

**정답: B) kubelet과 컨테이너 런타임 간의 표준 통신 인터페이스이다**

CRI = kubelet ↔ 런타임, CNI = 네트워크, CSI = 스토리지
</details>

---

### 문제 11.
컨테이너 오케스트레이션이 제공하는 기능이 아닌 것은?

A) 자동 복구 (Self-healing)
B) 서비스 디스커버리
C) 소스 코드 컴파일
D) 로드밸런싱

<details><summary>정답 확인</summary>

**정답: C) 소스 코드 컴파일**

소스 코드 컴파일은 CI 도구의 역할이다. 오케스트레이션은 자동 복구, 서비스 디스커버리, 로드밸런싱, 스케줄링 등을 제공한다.
</details>

---

### 문제 12.
K8s v1.24부터 적용된 중요한 변경 사항은?

A) etcd가 제거되었다
B) dockershim이 제거되었다
C) kubelet이 제거되었다
D) kube-proxy가 제거되었다

<details><summary>정답 확인</summary>

**정답: B) dockershim이 제거되었다**

K8s v1.24부터 dockershim이 제거되어 Docker를 직접 런타임으로 사용할 수 없다. Docker 이미지는 OCI 표준이므로 containerd 등에서 계속 사용 가능하다.
</details>

---

## tart-infra 실습

### 실습 환경 설정

```bash
# dev 클러스터 접속 (컨테이너 런타임 및 리소스 제한 확인용)
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/dev.yaml

# 노드 정보 확인
kubectl get nodes -o wide
```

### 실습 1: 컨테이너 런타임(CRI) 확인

클러스터에서 사용 중인 컨테이너 런타임을 확인하고 CRI 인터페이스를 이해한다.

```bash
# 노드의 컨테이너 런타임 확인
kubectl get nodes -o custom-columns=NAME:.metadata.name,RUNTIME:.status.nodeInfo.containerRuntimeVersion

# 예상 출력:
# NAME                   RUNTIME
# dev-control-plane      containerd://1.7.x
# dev-worker             containerd://1.7.x

# kubelet이 사용하는 CRI 엔드포인트 확인
kubectl get node -o jsonpath='{.items[0].status.nodeInfo.containerRuntimeVersion}'
```

**동작 원리:** K8s v1.24부터 dockershim이 제거되어 containerd가 기본 런타임이다. kubelet은 CRI(Container Runtime Interface, gRPC 기반)를 통해 containerd에 컨테이너 생성/삭제를 요청한다. containerd는 내부적으로 OCI 호환 저수준 런타임(runc)을 호출한다.

### 실습 2: cgroups를 통한 리소스 제한 확인

Pod의 resources.requests/limits 설정이 cgroups로 어떻게 반영되는지 확인한다.

```bash
# demo 네임스페이스의 Pod 리소스 설정 확인
kubectl get pods -n demo -o custom-columns=NAME:.metadata.name,CPU_REQ:.spec.containers[0].resources.requests.cpu,MEM_REQ:.spec.containers[0].resources.requests.memory,CPU_LIM:.spec.containers[0].resources.limits.cpu,MEM_LIM:.spec.containers[0].resources.limits.memory

# 예상 출력:
# NAME              CPU_REQ   MEM_REQ    CPU_LIM   MEM_LIM
# nginx-xxx         100m      128Mi      200m      256Mi
# httpbin-xxx       100m      128Mi      200m      256Mi

# 특정 Pod의 상세 리소스 확인
kubectl describe pod -n demo -l app=nginx | grep -A6 "Limits\|Requests"
```

**동작 원리:** K8s의 resources.requests는 스케줄러가 Pod 배치 시 참고하는 최소 보장 리소스이고, limits는 cgroups를 통해 커널 수준에서 강제하는 최대 제한이다. 메모리 limits 초과 시 OOMKill이 발생하며, CPU limits 초과 시 스로틀링(throttling)된다.

### 실습 3: CNI 네트워크 플러그인 확인

```bash
# dev 클러스터의 CNI 확인 (Cilium 사용)
kubectl get pods -n kube-system -l k8s-app=cilium

# Pod 네트워크 대역 확인 (CNI가 할당)
kubectl get pods -n demo -o custom-columns=NAME:.metadata.name,IP:.status.podIP

# 예상 출력:
# NAME              IP
# nginx-xxx         10.244.1.x
# httpbin-xxx       10.244.1.y
```

**동작 원리:** CNI(Container Network Interface)는 Pod 생성 시 네트워크 인터페이스와 IP를 할당하는 표준 인터페이스이다. dev 클러스터는 Cilium CNI를 사용하며, eBPF 기반으로 kube-proxy 없이도 서비스 로드밸런싱과 네트워크 정책을 처리할 수 있다.

---

## 복습 체크리스트

- [ ] namespace = 격리 / cgroups = 리소스 제한 (절대 혼동 금지!)
- [ ] 컨테이너 vs VM: 커널 공유, 수 MB, 초 단위, 보안은 VM이 강함
- [ ] OCI 3 사양: Runtime / Image / Distribution (Orchestration 없음!)
- [ ] CRI = 런타임, CNI = 네트워크, CSI = 스토리지
- [ ] containerd = 고수준(졸업), runc = 저수준(OCI 참조)
- [ ] CRI-O = K8s 전용 경량 런타임(인큐베이팅)
- [ ] CMD = 덮어쓰기 가능 / ENTRYPOINT = 고정
- [ ] K8s에서 CMD → args, ENTRYPOINT → command
- [ ] 멀티스테이지 빌드 = 이미지 크기 감소
- [ ] Tag = 변경 가능, Digest = 불변(SHA256)
- [ ] Harbor = CNCF 졸업 프라이빗 레지스트리
- [ ] CoreDNS = K8s 기본 DNS (CNCF 졸업)
- [ ] dockershim 제거 = v1.24 (OCI 이미지는 계속 사용)

---

## 내일 학습 예고

> Day 6에서는 Cloud Native Architecture를 학습한다. CNCF 생태계, 마이크로서비스 vs 모놀리식, 서비스 메시, 오토스케일링(HPA/VPA), 서버리스, 12-Factor App을 다룬다.
