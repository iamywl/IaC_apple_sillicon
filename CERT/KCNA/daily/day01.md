# KCNA Day 1: K8s 아키텍처 - Control Plane & Worker Node 구성요소

> 학습 목표: Control Plane과 Worker Node의 핵심 구성요소를 완벽히 이해한다.
> 예상 소요 시간: 60분 (개념 40분 + YAML 분석 20분)
> 시험 도메인: Kubernetes Fundamentals (46%) - Part 1
> 난이도: ★★★★★ (KCNA 시험의 핵심 중 핵심)

---

## 오늘의 학습 목표

- Control Plane 4대 구성요소(API Server, etcd, Scheduler, Controller Manager)의 역할을 설명할 수 있다
- Worker Node 3대 구성요소(kubelet, kube-proxy, Container Runtime)의 역할을 설명할 수 있다
- 각 컴포넌트의 Static Pod YAML을 읽고 각 필드의 의미를 설명할 수 있다
- Kubernetes가 "선언적(Declarative)" 시스템인 이유를 설명할 수 있다

---

## 1. Kubernetes란 무엇인가?

### 1.1 시스템 구성요소 개요

Kubernetes는 분산 시스템 아키텍처에 기반한 컨테이너 오케스트레이션 플랫폼이다. 클러스터는 크게 **Control Plane**(제어부)과 **Worker Node**(데이터부)로 분리되며, 각 구성요소는 단일 책임 원칙(Single Responsibility Principle)에 따라 설계되었다.

```
Kubernetes 핵심 구성요소 매핑
=============================================

구성요소                      아키텍처 역할
-----------------------------------------
Control Plane             =    클러스터 제어부 (의사결정 계층)
Worker Node               =    워크로드 실행부 (데이터 계층)
Container                 =    Linux namespace/cgroups 기반 프로세스 격리 단위
Pod                       =    공유 네트워크/스토리지를 갖는 컨테이너 그룹 (최소 스케줄링 단위)
API Server                =    RESTful API 게이트웨이 (클러스터 통신 허브)
etcd                      =    Raft 기반 분산 키-값 저장소 (SSOT)
Scheduler                 =    필터링/스코어링 기반 Pod 배치 엔진
Controller Manager         =    Reconciliation Loop 기반 상태 수렴 컨트롤러
kubelet                   =    노드 레벨 에이전트 (CRI 클라이언트)
kube-proxy                =    iptables/IPVS 기반 L4 로드밸런서
Container Runtime          =    OCI 호환 컨테이너 실행 엔진
```

각 구성요소의 역할과 상호 의존 관계를 이해하는 것이 Kubernetes 아키텍처 학습의 핵심이다.

### 1.2 Kubernetes의 정의

**Kubernetes(쿠버네티스)**는 Google이 내부에서 사용하던 **Borg** 시스템을 기반으로 2014년에 오픈소스로 공개한 **컨테이너 오케스트레이션(Container Orchestration) 플랫폼**이다.

> **컨테이너 오케스트레이션(Container Orchestration)**이란?
> 여러 대의 서버에서 실행되는 수많은 컨테이너를 자동으로 배포, 관리, 확장, 복구하는 기술이다. Kubernetes는 스케줄링, 헬스체크, 자동 복구, 수평 확장 등의 기능을 통해 분산 환경의 컨테이너 라이프사이클을 자동으로 관리한다.

### 1.3 왜 Kubernetes가 필요한가?

컨테이너 하나를 실행하는 것은 간단하다. 하지만 수백, 수천 개의 컨테이너를 여러 서버에서 운영해야 한다면?

```
문제 상황:
==================================================

서버 1      서버 2      서버 3      서버 4
+------+   +------+   +------+   +------+
| 앱 A |   | 앱 B |   | 앱 C |   | 앱 D |
| 앱 E |   | 앱 F |   |  ??  |   | 앱 G |
+------+   +------+   +------+   +------+

질문들:
- 앱 C가 죽으면 누가 재시작하나?
- 서버 3이 다운되면 앱 C는 어디서 실행하나?
- 트래픽이 급증하면 앱 A를 몇 개로 늘려야 하나?
- 앱 B를 새 버전으로 교체할 때 다운타임 없이 어떻게 하나?
- 앱 A에서 앱 F로 통신하려면 IP 주소를 어떻게 알아내나?

=> Kubernetes가 이 모든 것을 자동으로 해결한다!
```

### 1.4 선언적(Declarative) vs 명령적(Imperative) 방식

Kubernetes의 가장 중요한 철학은 **선언적(Declarative) 접근 방식**이다.

> **선언적(Declarative)**이란?
> "무엇을(What)" 원하는지만 기술하는 방식이다. "어떻게(How)" 할지는 시스템이 알아서 결정한다.
>
> **명령적(Imperative)**이란?
> "어떻게(How)" 해야 하는지 단계별로 지시하는 방식이다.

```
선언적 vs 명령적 패러다임 비교
==================================================

명령적 방식 (Imperative) - 절차적 제어:
사용자가 실행 순서와 구체적 동작을 하나하나 지시한다.
  kubectl run nginx --image=nginx
  kubectl scale deployment nginx --replicas=3
  kubectl expose deployment nginx --port=80

선언적 방식 (Declarative) - 상태 기반 수렴:
사용자가 최종 상태(Desired State)를 정의하면,
시스템의 Reconciliation Loop가 현재 상태(Current State)를
목표 상태로 자동 수렴시킨다.
  kubectl apply -f deployment.yaml
=> Controller Manager가 Desired State와 Current State의 차이(drift)를 감지하고 자동 보정한다.
```

Kubernetes에서는 YAML 파일로 **"원하는 상태(Desired State)"**를 기술하면, 시스템이 자동으로 **"현재 상태(Current State)"**를 원하는 상태와 일치시킨다.

```yaml
# 선언적 방식 예시: "nginx 3개를 실행해줘"
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nginx-web
spec:
  replicas: 3          # 원하는 상태: nginx가 3개 실행되어야 한다
  selector:
    matchLabels:
      app: nginx
  template:
    metadata:
      labels:
        app: nginx
    spec:
      containers:
      - name: nginx
        image: nginx:1.25
```

---

## 2. Kubernetes 클러스터 전체 아키텍처

### 2.1 클러스터(Cluster)란?

> **클러스터(Cluster)**란?
> Kubernetes를 실행하는 서버(노드)들의 집합이다. 최소 1대의 Control Plane 노드와 1대 이상의 Worker Node로 구성된다.

```
+==============================================================+
|                    Kubernetes 클러스터                          |
|                                                              |
|  +------------------------+     +-------------------------+  |
|  |    Control Plane 노드   |     |     Worker Node #1      |  |
|  |   (마스터 노드)          |     |                         |  |
|  |                        |     |  +-------+ +--------+   |  |
|  |  +---------+           |     |  |Pod    | |Pod     |   |  |
|  |  |API      |           |     |  |+-----+| |+------+|   |  |
|  |  |Server   |<---------+-----+->||nginx || ||redis ||   |  |
|  |  +---------+           |     |  |+-----+| |+------+|   |  |
|  |       |                |     |  +-------+ +--------+   |  |
|  |  +---------+           |     |                         |  |
|  |  |etcd     |           |     |  kubelet  kube-proxy    |  |
|  |  |(DB)     |           |     |  containerd             |  |
|  |  +---------+           |     +-------------------------+  |
|  |       |                |                                  |
|  |  +---------+           |     +-------------------------+  |
|  |  |Scheduler|           |     |     Worker Node #2      |  |
|  |  +---------+           |     |                         |  |
|  |       |                |     |  +-------+ +--------+   |  |
|  |  +---------+           |     |  |Pod    | |Pod     |   |  |
|  |  |Controller|          |     |  |+-----+| |+------+|   |  |
|  |  |Manager  |          |     |  ||app  || ||mysql ||   |  |
|  |  +---------+           |     |  |+-----+| |+------+|   |  |
|  |                        |     |  +-------+ +--------+   |  |
|  |  +----------+          |     |                         |  |
|  |  |Cloud     |          |     |  kubelet  kube-proxy    |  |
|  |  |Controller|          |     |  containerd             |  |
|  |  |Manager   |          |     +-------------------------+  |
|  |  +----------+          |                                  |
|  +------------------------+                                  |
+==============================================================+
```

### 2.2 Control Plane vs Worker Node 비교

| 구분 | Control Plane | Worker Node |
|------|--------------|-------------|
| **역할** | 클러스터 관리/제어 | 실제 워크로드(앱) 실행 |
| **아키텍처 계층** | 제어부 (Control Path) | 데이터부 (Data Path) |
| **구성요소** | API Server, etcd, Scheduler, Controller Manager | kubelet, kube-proxy, Container Runtime |
| **Pod 실행** | 시스템 Pod만 (보통) | 사용자 앱 Pod |
| **수량** | 보통 1~3대 (HA 구성) | 필요에 따라 수십~수천 대 |
| **장애 영향** | 클러스터 관리 불가 (기존 Pod는 유지) | 해당 노드의 Pod만 영향 |

---

## 3. Control Plane 구성요소 상세

### 3.1 kube-apiserver - 클러스터의 관문

> **kube-apiserver**란?
> Kubernetes 클러스터의 **중앙 API 게이트웨이**이다. 외부(kubectl, 대시보드)와 내부(kubelet, scheduler) 모든 통신이 이 API Server를 거쳐야 한다. 모든 컴포넌트 간 통신을 중재하는 **허브-앤-스포크(Hub-and-Spoke) 아키텍처**의 중심점이다.

#### 핵심 역할

1. **RESTful API 제공**: 모든 K8s 오브젝트를 CRUD(생성/조회/수정/삭제) 할 수 있는 HTTP API를 제공
2. **인증/인가/어드미션 컨트롤**: 요청이 유효한지 3단계로 검증
3. **etcd와의 유일한 통신**: **etcd에 직접 접근하는 유일한 컴포넌트** (시험 빈출!)
4. **수평 확장(Horizontal Scaling)**: 여러 인스턴스를 실행하여 부하 분산 가능
5. **Watch 메커니즘**: 변경 사항을 실시간으로 다른 컴포넌트에 통지

#### 요청 처리 흐름 (3단계)

```
사용자 요청 (kubectl apply ...)
           |
           v
+------------------------------------------+
| 1단계: 인증 (Authentication)              |
|   "당신은 누구인가?"                       |
|   - X.509 인증서                         |
|   - Bearer 토큰                          |
|   - OIDC (OpenID Connect)                |
|   - ServiceAccount 토큰                  |
+------------------------------------------+
           |
           v
+------------------------------------------+
| 2단계: 인가 (Authorization)               |
|   "당신은 이 작업을 할 권한이 있는가?"       |
|   - RBAC (Role-Based Access Control)     |
|   - ABAC (Attribute-Based)               |
|   - Webhook                             |
+------------------------------------------+
           |
           v
+------------------------------------------+
| 3단계: 어드미션 컨트롤 (Admission Control) |
|   "이 요청은 정책에 부합하는가?"            |
|   - Mutating Admission (변형)            |
|     -> 리소스 자동 수정 (라벨 추가 등)      |
|   - Validating Admission (검증)          |
|     -> 정책 위반 시 거부                  |
+------------------------------------------+
           |
           v
      etcd에 저장
```

#### kube-apiserver Static Pod YAML 상세 분석

Control Plane 노드의 `/etc/kubernetes/manifests/kube-apiserver.yaml`에 위치한다.

```yaml
# kube-apiserver Static Pod 매니페스트
# 파일 위치: /etc/kubernetes/manifests/kube-apiserver.yaml
# kubelet이 이 파일을 감시하여 자동으로 Pod를 생성한다

apiVersion: v1                    # API 버전. 핵심 리소스는 v1을 사용
kind: Pod                        # 리소스 종류. Static Pod이므로 Pod를 직접 정의
metadata:
  name: kube-apiserver           # Pod 이름
  namespace: kube-system          # 시스템 컴포넌트는 kube-system 네임스페이스에 배치
  labels:
    component: kube-apiserver     # 컴포넌트 식별용 라벨
    tier: control-plane           # Control Plane 계층임을 표시
  annotations:
    kubeadm.kubernetes.io/kube-apiserver.advertise-address.endpoint: 192.168.64.2:6443
spec:
  containers:
  - name: kube-apiserver
    image: registry.k8s.io/kube-apiserver:v1.29.0    # 공식 K8s 이미지
    command:
    - kube-apiserver
    # === 주요 플래그 설명 ===
    - --advertise-address=192.168.64.2          # 다른 컴포넌트에 알리는 API Server 주소
    - --etcd-servers=https://192.168.64.2:2379  # etcd 서버 주소 (etcd와 통신)
    - --service-cluster-ip-range=10.96.0.0/12   # Service에 할당되는 ClusterIP 대역
    - --service-account-key-file=/etc/kubernetes/pki/sa.pub
    - --tls-cert-file=/etc/kubernetes/pki/apiserver.crt       # TLS 인증서
    - --tls-private-key-file=/etc/kubernetes/pki/apiserver.key # TLS 개인키
    - --client-ca-file=/etc/kubernetes/pki/ca.crt             # 클라이언트 CA
    - --authorization-mode=Node,RBAC            # 인가 모드: Node 인가 + RBAC
    - --enable-admission-plugins=NodeRestriction # 어드미션 플러그인
    - --secure-port=6443                        # HTTPS 포트 (기본 6443)
    - --allow-privileged=true                   # 특권 컨테이너 허용
    ports:
    - containerPort: 6443                       # API Server 포트
      name: https
      protocol: TCP
    # 리소스 제한 설정
    resources:
      requests:
        cpu: 250m                               # 최소 CPU 요청량
    # Liveness Probe: API Server 생존 확인
    livenessProbe:
      httpGet:
        host: 192.168.64.2
        path: /livez                            # 생존 확인 엔드포인트
        port: 6443
        scheme: HTTPS
      initialDelaySeconds: 10
      timeoutSeconds: 15
    # Readiness Probe: API Server 준비 확인
    readinessProbe:
      httpGet:
        host: 192.168.64.2
        path: /readyz                           # 준비 확인 엔드포인트
        port: 6443
        scheme: HTTPS
    # 볼륨 마운트 (인증서, 설정 파일)
    volumeMounts:
    - mountPath: /etc/kubernetes/pki            # PKI 인증서 디렉토리
      name: k8s-certs
      readOnly: true
    - mountPath: /etc/ssl/certs                 # 시스템 CA 인증서
      name: ca-certs
      readOnly: true
    - mountPath: /etc/kubernetes/audit          # 감사 로그 설정
      name: audit
      readOnly: true
  # 호스트 네트워크 사용 (Pod 네트워크가 아닌 노드 네트워크)
  hostNetwork: true
  # 이 Pod의 우선순위 (시스템 컴포넌트는 최고 우선순위)
  priorityClassName: system-node-critical
  volumes:
  - hostPath:
      path: /etc/kubernetes/pki
      type: DirectoryOrCreate
    name: k8s-certs
  - hostPath:
      path: /etc/ssl/certs
      type: DirectoryOrCreate
    name: ca-certs
```

> **YAML 필드 설명:**
> - `apiVersion`: 이 리소스가 사용하는 API 그룹과 버전. `v1`은 핵심(core) API 그룹
> - `kind`: 리소스 종류. Pod, Deployment, Service 등이 있다
> - `metadata`: 이름, 네임스페이스, 라벨 등 메타 정보
> - `spec`: 원하는 상태(desired state)를 기술하는 핵심 섹션
> - `hostNetwork: true`: Pod가 노드의 네트워크를 직접 사용 (6443 포트를 노드에서 직접 리스닝)
> - `priorityClassName: system-node-critical`: 리소스 부족 시에도 이 Pod는 절대 축출(evict)하지 않음

**시험 포인트:**
- "모든 컴포넌트가 통신하는 중심점" = API Server
- "etcd에 직접 접근하는 유일한 컴포넌트" = API Server
- RESTful API를 노출한다 (HTTP 기반)
- 기본 포트는 **6443** (HTTPS)
- 인증(Authentication) -> 인가(Authorization) -> 어드미션 컨트롤(Admission Control) 순서

---

### 3.2 etcd - 클러스터의 뇌

> **etcd**란?
> Kubernetes 클러스터의 모든 상태 정보를 저장하는 **Raft 합의 알고리즘 기반 분산 키-값(Key-Value) 저장소**이다. 클러스터의 **단일 진실 소스(Single Source of Truth, SSOT)**로서 모든 오브젝트의 Desired State와 Current State(어떤 Pod가 어디에서 실행 중인지, 어떤 설정이 적용되어 있는지 등)를 `/registry/` 프리픽스 하위에 직렬화하여 저장한다.

#### 핵심 특성

| 특성 | 설명 |
|------|------|
| **분산 저장소** | 여러 노드에 데이터를 분산 저장하여 고가용성 보장 |
| **키-값 저장** | `/registry/pods/default/nginx-pod` 같은 키로 데이터 저장 |
| **Raft 합의 알고리즘** | 노드 간 데이터 일관성을 보장하는 합의 메커니즘 |
| **단일 진실 소스 (SSOT)** | 클러스터의 유일한 상태 저장소 |
| **Watch 기능** | 데이터 변경을 실시간으로 감지하여 통지 |
| **홀수 노드 운영** | 3, 5, 7개 등 홀수 노드로 구성 (과반수 투표 때문) |

#### Raft 합의 알고리즘 동작 원리

> **Raft 합의 알고리즘**이란?
> 여러 대의 서버가 동일한 데이터를 유지하도록 보장하는 방법이다. 투표를 통해 하나의 **리더(Leader)**를 선출하고, 리더가 모든 쓰기 요청을 처리한다.

```
Raft 합의 알고리즘 (3노드 etcd 클러스터)
============================================================

etcd-1 (Leader)         etcd-2 (Follower)     etcd-3 (Follower)
+---------------+       +---------------+     +---------------+
| 쓰기 요청 수신 |------>| 복제 수신      |     | 복제 수신      |
| 과반수 확인    |       | ACK 응답       |---->| ACK 응답       |
| 커밋 완료      |<------|               |     |               |
+---------------+       +---------------+     +---------------+

쓰기 과정:
1. 클라이언트(API Server)가 Leader에게 쓰기 요청
2. Leader가 Follower들에게 데이터 복제 요청
3. 과반수(2/3)가 응답하면 커밋 완료
4. 나머지 Follower에게도 커밋 통지

장애 허용 (Fault Tolerance):
- 3 노드 → 1 노드 장애 허용 (과반수 = 2)
- 5 노드 → 2 노드 장애 허용 (과반수 = 3)
- 7 노드 → 3 노드 장애 허용 (과반수 = 4)

왜 홀수인가?
- 짝수(4노드)면: 2노드 장애 시 과반수(3) 불가 → 3노드와 동일한 장애 허용
- 홀수가 더 효율적!
```

#### etcd Static Pod YAML 상세 분석

```yaml
# etcd Static Pod 매니페스트
# 파일 위치: /etc/kubernetes/manifests/etcd.yaml

apiVersion: v1
kind: Pod
metadata:
  name: etcd
  namespace: kube-system
  labels:
    component: etcd
    tier: control-plane
spec:
  containers:
  - name: etcd
    image: registry.k8s.io/etcd:3.5.10-0         # etcd 이미지 (K8s와 별도 버전)
    command:
    - etcd
    # === 주요 플래그 설명 ===
    - --name=master                               # 이 etcd 멤버의 이름
    - --data-dir=/var/lib/etcd                    # 데이터 저장 디렉토리 (매우 중요!)
    - --listen-client-urls=https://192.168.64.2:2379,https://127.0.0.1:2379
                                                   # 클라이언트(API Server) 요청 수신 포트
    - --advertise-client-urls=https://192.168.64.2:2379
                                                   # 다른 멤버에 알리는 클라이언트 URL
    - --listen-peer-urls=https://192.168.64.2:2380
                                                   # 다른 etcd 멤버와 통신하는 피어 포트
    - --initial-advertise-peer-urls=https://192.168.64.2:2380
    - --initial-cluster=master=https://192.168.64.2:2380
    - --cert-file=/etc/kubernetes/pki/etcd/server.crt
    - --key-file=/etc/kubernetes/pki/etcd/server.key
    - --trusted-ca-file=/etc/kubernetes/pki/etcd/ca.crt
    - --snapshot-count=10000                      # 10000 트랜잭션마다 스냅샷 저장
    ports:
    - containerPort: 2379                         # 클라이언트 포트
      name: client
    - containerPort: 2380                         # 피어(멤버 간) 포트
      name: peer
    livenessProbe:
      httpGet:
        host: 192.168.64.2
        path: /health?exclude=NOSPACE             # 헬스체크 엔드포인트
        port: 2379
        scheme: HTTPS
      initialDelaySeconds: 10
      periodSeconds: 10
      timeoutSeconds: 15
    resources:
      requests:
        cpu: 100m
        memory: 100Mi
    volumeMounts:
    - mountPath: /var/lib/etcd                    # etcd 데이터 디렉토리
      name: etcd-data
    - mountPath: /etc/kubernetes/pki/etcd         # etcd 인증서
      name: etcd-certs
  hostNetwork: true
  priorityClassName: system-node-critical
  volumes:
  - hostPath:
      path: /var/lib/etcd                         # 호스트의 실제 데이터 경로
      type: DirectoryOrCreate
    name: etcd-data
  - hostPath:
      path: /etc/kubernetes/pki/etcd
      type: DirectoryOrCreate
    name: etcd-certs
```

> **중요 포트 정리:**
> - **2379**: 클라이언트(API Server) 통신 포트
> - **2380**: etcd 멤버 간 피어(peer) 통신 포트

**시험 포인트:**
- "클러스터 상태를 저장하는 곳" = etcd
- "분산 키-값 저장소" = etcd
- "Raft 합의 알고리즘" = etcd
- 홀수 개 노드 운영 (3, 5, 7...)
- **정기적인 스냅샷 백업이 운영에서 매우 중요** (데이터 유실 방지)
- API Server만 etcd에 직접 접근 가능

---

### 3.3 kube-scheduler - Pod 배치 담당

> **kube-scheduler**란?
> 새로 생성된 Pod를 어떤 Worker Node에서 실행할지 결정하는 컴포넌트이다. Filtering(제약 조건 기반 후보 노드 필터링)과 Scoring(가중치 기반 최적 노드 선정) 2단계 알고리즘을 통해 Pod의 리소스 요구사항, Affinity/Anti-Affinity 규칙, Taint/Toleration 등을 종합적으로 평가하여 최적의 노드를 결정한다.

#### 2단계 스케줄링 과정

```
새로운 Pod 생성 (아직 노드 미할당, Pending 상태)
                |
                v
+====================================+
| 1단계: 필터링 (Filtering)           |
|                                    |
| "이 Pod를 실행할 수 없는 노드 제외"  |
|                                    |
| 체크 항목:                          |
| - 노드에 충분한 CPU/메모리가 있는가? |
| - Node Selector 조건 충족?         |
| - Taints/Tolerations 매칭?         |
| - 노드 Affinity 규칙 충족?          |
| - PV가 해당 노드에서 접근 가능?      |
|                                    |
| 예: 5개 노드 중 3개 필터링 통과      |
+====================================+
                |
                v
+====================================+
| 2단계: 스코어링 (Scoring)           |
|                                    |
| "남은 노드에 점수를 매겨 최적 선택"  |
|                                    |
| 스코어링 기준:                      |
| - 리소스 균형 배분 (Balanced)       |
| - Pod Affinity/Anti-Affinity      |
| - 이미지가 이미 존재하는 노드 가점  |
| - 선호 노드(Preferred Affinity)    |
|                                    |
| 예: Node-A=80점, Node-B=95점,     |
|     Node-C=70점 → Node-B 선택     |
+====================================+
                |
                v
      Pod를 Node-B에 배치 (Binding)
```

#### 스케줄링 관련 YAML 예제

```yaml
# Node Selector 예제: 특정 라벨이 있는 노드에만 배치
apiVersion: v1
kind: Pod
metadata:
  name: gpu-pod
spec:
  nodeSelector:                    # 노드 라벨 기반 선택 (단순)
    gpu-type: nvidia-a100          # gpu-type=nvidia-a100 라벨이 있는 노드에만 배치
  containers:
  - name: ml-training
    image: tensorflow/tensorflow:latest-gpu
    resources:
      limits:
        nvidia.com/gpu: 1          # GPU 1개 요청
---
# Node Affinity 예제: 더 세밀한 노드 선택
apiVersion: v1
kind: Pod
metadata:
  name: web-app
spec:
  affinity:
    nodeAffinity:
      # 반드시 충족해야 하는 조건 (Hard)
      requiredDuringSchedulingIgnoredDuringExecution:
        nodeSelectorTerms:
        - matchExpressions:
          - key: zone                           # zone 라벨 기준
            operator: In                        # 포함 여부
            values:
            - ap-northeast-2a                   # 서울 리전 a 존
            - ap-northeast-2c                   # 서울 리전 c 존
      # 가능하면 충족하는 조건 (Soft)
      preferredDuringSchedulingIgnoredDuringExecution:
      - weight: 80                              # 가중치 (1~100)
        preference:
          matchExpressions:
          - key: disk-type
            operator: In
            values:
            - ssd                               # SSD 디스크 노드 선호
  containers:
  - name: web
    image: nginx:1.25
---
# Taint와 Toleration 예제
# 1. 노드에 Taint 설정: kubectl taint nodes node1 gpu=true:NoSchedule
# 2. Pod에 Toleration 설정:
apiVersion: v1
kind: Pod
metadata:
  name: gpu-workload
spec:
  tolerations:                     # Taint를 "참을 수 있는" 설정
  - key: "gpu"
    operator: "Equal"
    value: "true"
    effect: "NoSchedule"           # NoSchedule Taint를 허용
  containers:
  - name: compute
    image: nvidia/cuda:12.0-runtime
```

> **Taint와 Toleration 메커니즘:**
> - **Taint(오염)**: 노드에 설정하는 스케줄링 제약 조건이다. `key=value:effect` 형식으로 정의하며, effect는 `NoSchedule`(배치 거부), `PreferNoSchedule`(배치 회피), `NoExecute`(기존 Pod 퇴거)의 3가지가 있다.
> - **Toleration(관용)**: Pod에 설정하는 Taint 허용 규칙이다. Pod의 Toleration이 노드의 Taint와 매칭되어야 해당 노드에 스케줄링될 수 있다.

**시험 포인트:**
- "Pod를 노드에 배치" = Scheduler
- 필터링(Filtering) -> 스코어링(Scoring) 2단계 과정
- Scheduler는 Pod를 직접 실행하지 않고, **nodeName 필드만 설정** (실제 실행은 kubelet)
- nodeSelector: 단순한 라벨 기반 선택
- nodeAffinity: 더 표현력 있는 선택 규칙

---

### 3.4 kube-controller-manager - 상태 유지 관리자

> **kube-controller-manager**란?
> 클러스터의 **"현재 상태(Current State)"를 "원하는 상태(Desired State)"로 계속 수렴시키는** 역할을 한다. 제어 이론(Control Theory)의 **피드백 루프(Feedback Loop)** 원리를 구현한 것으로, Observe(관찰) -> Compare(비교) -> Act(동작)의 Reconciliation Loop를 무한 반복하며 상태 드리프트(State Drift)를 자동 보정한다.

#### 컨트롤 루프(Reconciliation Loop) 개념

```
컨트롤 루프 (무한 반복)
============================================================

         +----------+
         | 관찰     |  현재 상태 확인
         | (Observe)|  (API Server에 질의)
         +----+-----+
              |
              v
         +----------+
         | 비교     |  현재 상태 vs 원하는 상태
         | (Compare)|  일치하는가?
         +----+-----+
              |
      +-------+-------+
      |               |
      v               v
  +------+       +-------+
  | 일치 |       | 불일치 |
  | 대기 |       | 조치   |  상태를 맞추기 위한 액션 실행
  +------+       +-------+
      |               |
      +-------+-------+
              |
              v
         (다시 처음으로)

예시:
- Desired: replicas=3 (Pod 3개가 필요)
- Current: Pod 2개만 실행 중
- Action: Pod 1개 추가 생성
```

#### 주요 컨트롤러 목록

| 컨트롤러 | 역할 | 감시 대상 |
|----------|------|----------|
| **Node Controller** | 노드 상태 모니터링, 응답 없는 노드 감지 | Node |
| **Replication Controller** | 올바른 수의 Pod 유지 | ReplicaSet |
| **Deployment Controller** | Deployment의 ReplicaSet 관리 | Deployment |
| **Endpoints Controller** | Service와 Pod IP를 연결 | Endpoints |
| **ServiceAccount Controller** | 네임스페이스에 기본 ServiceAccount 생성 | Namespace |
| **Job Controller** | Job 완료까지 Pod 관리 | Job |
| **CronJob Controller** | 스케줄에 따라 Job 생성 | CronJob |
| **StatefulSet Controller** | StatefulSet의 순서/고유성 보장 | StatefulSet |
| **DaemonSet Controller** | 모든 노드에 Pod 하나씩 유지 | DaemonSet |

이들은 논리적으로 개별 프로세스이지만, 복잡도를 줄이기 위해 **하나의 바이너리(kube-controller-manager)**로 컴파일되어 실행된다.

**시험 포인트:**
- "desired state와 current state를 맞추는 역할" = Controller Manager
- "컨트롤 루프(reconciliation loop)" = Controller Manager의 동작 방식
- 여러 컨트롤러가 하나의 프로세스로 실행된다

---

### 3.5 cloud-controller-manager

> **cloud-controller-manager**란?
> AWS, GCP, Azure 같은 클라우드 제공업체에 특화된 제어 로직을 실행하는 컴포넌트이다. 온프레미스(자체 서버) 환경에서는 없을 수 있다.

| 컨트롤러 | 역할 |
|----------|------|
| **Node Controller** | 클라우드에서 노드 정보(IP, 리전 등) 동기화 |
| **Route Controller** | 클라우드 네트워크에서 라우팅 설정 |
| **Service Controller** | LoadBalancer 타입 Service 생성 시 클라우드 LB 프로비저닝 |

---

## 4. Worker Node 구성요소 상세

### 4.1 kubelet - 노드의 에이전트

> **kubelet**이란?
> 각 Worker Node에서 실행되는 **노드 레벨 에이전트 프로세스**이다. API Server의 Watch 메커니즘을 통해 해당 노드에 할당된 PodSpec을 수신하고, CRI(Container Runtime Interface) gRPC API를 호출하여 containerd 등의 런타임에 컨테이너 생성/삭제를 위임한다.

#### kubelet의 핵심 역할

```
API Server                kubelet (각 노드)               containerd
+---------+              +----------------+              +------------+
|         |  PodSpec     |                |   CRI API    |            |
|         |------------->| 1. PodSpec 수신 |------------>| 컨테이너   |
|         |              | 2. 컨테이너 생성 |              | 생성/실행  |
|         |              | 3. 상태 모니터링 |<------------|            |
|         |<-------------| 4. 상태 보고    |              |            |
|         |  Node Status | 5. Probe 실행   |              |            |
+---------+              +----------------+              +------------+
```

1. **PodSpec 수신**: API Server로부터 이 노드에서 실행해야 할 Pod 목록을 받는다
2. **컨테이너 실행**: CRI(Container Runtime Interface)를 통해 containerd에게 컨테이너 실행을 요청
3. **상태 모니터링**: 컨테이너가 정상 실행 중인지 지속 확인
4. **상태 보고**: 노드 상태(CPU, 메모리, 디스크 등)를 주기적으로 API Server에 보고
5. **Probe 실행**: Liveness, Readiness, Startup Probe를 실행하여 앱 상태 확인

#### Probe(프로브) 상세 설명

> **Probe(프로브)**란?
> 컨테이너의 정상 동작 여부를 주기적으로 확인하는 헬스체크 메커니즘이다. kubelet이 설정된 주기(periodSeconds)마다 HTTP GET, TCP Socket, 또는 exec 방식으로 컨테이너 상태를 진단한다.

```yaml
# Probe 예제가 포함된 Pod YAML
apiVersion: v1
kind: Pod
metadata:
  name: web-server
  namespace: default
spec:
  containers:
  - name: nginx
    image: nginx:1.25
    ports:
    - containerPort: 80

    # === Liveness Probe (생존 검사) ===
    # "컨테이너가 살아있는가?" → 실패 시 컨테이너 재시작
    # 프로세스 생존 여부 확인 → 실패 시 restartPolicy에 따라 컨테이너 재시작
    livenessProbe:
      httpGet:                    # HTTP GET 방식으로 확인
        path: /healthz            # 이 경로에 요청
        port: 80                  # 이 포트로 요청
      initialDelaySeconds: 15     # 컨테이너 시작 후 15초 대기 후 첫 검사
      periodSeconds: 10           # 10초마다 검사 반복
      timeoutSeconds: 3           # 3초 내 응답 없으면 실패
      failureThreshold: 3         # 3번 연속 실패 시 컨테이너 재시작

    # === Readiness Probe (준비 검사) ===
    # "트래픽을 받을 준비가 되었는가?" → 실패 시 Service에서 제거
    # 트래픽 수신 가능 여부 확인 → 실패 시 Endpoints 오브젝트에서 Pod IP 제거
    readinessProbe:
      httpGet:
        path: /ready
        port: 80
      initialDelaySeconds: 5
      periodSeconds: 5
      successThreshold: 1         # 1번 성공하면 Ready
      failureThreshold: 3         # 3번 실패하면 NotReady → Service 엔드포인트에서 제거

    # === Startup Probe (시작 검사) ===
    # "앱이 시작되었는가?" → 성공할 때까지 Liveness/Readiness 비활성화
    # 애플리케이션 초기화 완료 여부 확인 → 성공 전까지 Liveness/Readiness Probe 비활성화
    startupProbe:
      httpGet:
        path: /startup
        port: 80
      initialDelaySeconds: 0
      periodSeconds: 5
      failureThreshold: 30        # 최대 150초(5*30) 동안 시작 대기
```

| Probe | 실패 시 동작 | 사용 시나리오 |
|-------|-------------|-------------|
| **Liveness** | 컨테이너 **재시작** | 데드락, 무한루프 감지 |
| **Readiness** | Service 엔드포인트에서 **제거** | 초기화 중, DB 연결 대기 |
| **Startup** | Liveness/Readiness **비활성화** 유지 | 시작 시간이 긴 앱 |

**시험 포인트:**
- "각 노드에서 실행되는 에이전트" = kubelet
- kubelet은 **etcd에 직접 접근하지 않는다** (API Server를 통해서만)
- Probe를 실행하는 주체 = kubelet
- **K8s가 생성하지 않은 컨테이너는 관리하지 않는다** (docker run 등으로 직접 만든 컨테이너)
- kubelet은 Static Pod를 관리한다 (`/etc/kubernetes/manifests/` 디렉토리 감시)

---

### 4.2 kube-proxy - 네트워크 규칙 관리

> **kube-proxy**란?
> 각 Worker Node에서 실행되는 **L4 네트워크 프록시**이다. Kubernetes Service 오브젝트의 변경을 Watch하여 iptables 규칙 또는 IPVS 가상 서버 테이블을 동적으로 갱신한다. Service의 Virtual IP(ClusterIP)로 들어오는 패킷을 DNAT(Destination NAT)를 통해 백엔드 Pod의 실제 IP로 전달하며, 라운드로빈 등의 로드밸런싱 알고리즘을 적용한다.

```
Service (ClusterIP: 10.96.0.100)
            |
            v
+---------------------------+
| kube-proxy가 관리하는      |
| iptables/IPVS 규칙        |
|                           |
| 10.96.0.100:80 →          |
|   Pod-A (10.244.1.5:80)   |
|   Pod-B (10.244.2.3:80)   |
|   Pod-C (10.244.1.8:80)   |
|                           |
| 로드밸런싱: 라운드로빈      |
+---------------------------+
```

#### kube-proxy 운영 모드

| 모드 | 설명 | 성능 |
|------|------|------|
| **iptables** (기본) | Linux iptables 규칙으로 트래픽 라우팅 | 중간 (대규모 서비스에서 느려짐) |
| **IPVS** | Linux IPVS 커널 모듈 사용 | 높음 (수천 서비스도 효율적) |
| **userspace** | 사용자 공간에서 프록시 (레거시) | 낮음 (거의 사용 안 함) |

**시험 포인트:**
- "Service의 네트워크 규칙을 관리" = kube-proxy
- iptables 규칙 또는 IPVS 규칙을 설정한다
- **DaemonSet**으로 모든 노드에 배포된다
- kube-proxy가 없어도 Pod 간 직접 통신은 가능 (CNI가 담당)
- Cilium 같은 CNI가 kube-proxy 기능을 대체할 수 있다

---

### 4.3 Container Runtime - 컨테이너 실행 엔진

> **Container Runtime(컨테이너 런타임)**이란?
> 실제로 컨테이너를 생성하고 실행하는 소프트웨어이다. kubelet이 CRI(Container Runtime Interface) gRPC 호출을 통해 고수준 런타임(containerd)에 요청을 전달하면, 고수준 런타임이 OCI 스펙에 따라 저수준 런타임(runc)을 호출하여 Linux namespace(프로세스/네트워크/파일시스템 격리)와 cgroups(CPU/메모리/I/O 리소스 제한)를 설정한 컨테이너 프로세스를 생성한다.

#### 런타임 계층 구조

```
kubelet
   |
   | CRI (Container Runtime Interface) - 표준 API
   |
   v
containerd (고수준 런타임)
   |  - 이미지 관리 (pull, push)
   |  - 컨테이너 생명주기
   |  - 스토리지, 네트워킹
   |
   v
runc (저수준 런타임, OCI 참조 구현)
   |  - 실제 커널 호출
   |  - namespace 생성 (격리)
   |  - cgroups 설정 (리소스 제한)
   |
   v
Linux Kernel
```

#### 주요 런타임 비교

| 런타임 | 수준 | 설명 | CNCF |
|--------|------|------|------|
| **containerd** | 고수준 | Docker에서 분리, 가장 널리 사용 | 졸업 |
| **CRI-O** | 고수준 | Red Hat 주도, K8s 전용 경량 런타임 | 인큐베이팅 |
| **runc** | 저수준 | OCI 참조 구현체, containerd/CRI-O 내부에서 사용 | - |
| **gVisor (runsc)** | 저수준 | Google, 보안 강화 런타임 (커널 샌드박스) | - |
| **Kata Containers** | 저수준 | 경량 VM 기반 런타임 (강한 격리) | - |

**시험 포인트:**
- **K8s v1.24부터 dockershim 제거** -> Docker를 직접 런타임으로 사용 불가 (매우 빈출!)
- Docker로 빌드한 이미지는 **OCI 표준**을 따르므로 어떤 런타임에서든 실행 가능
- containerd = **CNCF 졸업 프로젝트**
- CRI = K8s와 런타임 간의 표준 인터페이스 (gRPC 기반)

---

## tart-infra 실습

### 실습 환경 설정

```bash
# platform 클러스터 접속 (Control Plane 구성요소 확인용)
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/platform.yaml

# 클러스터 연결 확인
kubectl cluster-info
kubectl get nodes
```

### 실습 1: Control Plane 구성요소 확인

kube-system 네임스페이스에서 Static Pod로 실행 중인 Control Plane 구성요소를 직접 확인한다.

```bash
# Control Plane 구성요소 Pod 확인
kubectl get pods -n kube-system -l tier=control-plane

# 예상 출력:
# NAME                                      READY   STATUS    RESTARTS   AGE
# etcd-platform-control-plane               1/1     Running   0          7d
# kube-apiserver-platform-control-plane     1/1     Running   0          7d
# kube-controller-manager-platform-...      1/1     Running   0          7d
# kube-scheduler-platform-control-plane     1/1     Running   0          7d
```

**동작 원리:** Control Plane의 4대 구성요소(etcd, kube-apiserver, kube-controller-manager, kube-scheduler)는 kubelet이 Static Pod 매니페스트(`/etc/kubernetes/manifests/`)를 직접 읽어 실행한다. Deployment가 아닌 Static Pod이므로 `kubectl delete`로 삭제해도 kubelet이 자동으로 재생성한다.

### 실습 2: Worker Node 구성요소 확인

```bash
# kube-proxy DaemonSet 확인 (모든 노드에서 실행)
kubectl get daemonset kube-proxy -n kube-system
kubectl get pods -n kube-system -l k8s-app=kube-proxy -o wide

# 예상 출력:
# NAME               DESIRED   CURRENT   READY   UP-TO-DATE   NODE-SELECTOR   AGE
# kube-proxy         1         1         1       1            <none>          7d

# kubelet 상태 확인 (노드 Conditions)
kubectl get nodes -o wide
kubectl describe node | grep -A5 "Conditions:"
```

**동작 원리:** kube-proxy는 DaemonSet으로 모든 노드에 하나씩 배포되어 iptables/IPVS 규칙을 관리한다. kubelet은 시스템 데몬(systemd)으로 실행되므로 Pod 목록에 나타나지 않는다.

### 실습 3: API Server 통신 흐름 확인

```bash
# dev 클러스터로 전환하여 멀티 클러스터 환경 확인
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/dev.yaml

# API Server 엔드포인트 확인
kubectl cluster-info

# demo 네임스페이스의 워크로드를 통해 선언적 시스템 확인
kubectl get all -n demo

# 예상 출력: nginx, httpbin 등의 Deployment/Service/Pod가 표시됨
# kubectl이 API Server에 GET 요청 → API Server가 etcd에서 조회 → 결과 반환
```

**동작 원리:** 모든 kubectl 명령은 API Server를 거친다. `kubectl get all`은 API Server에 RESTful GET 요청을 보내고, API Server만이 etcd에 직접 접근하여 오브젝트 상태를 조회한다. 이것이 "API Server = 유일한 etcd 클라이언트" 원칙이다.

---

## 복습 체크리스트

- [ ] Control Plane 4대 구성요소를 모두 나열하고 각 역할을 설명할 수 있다
- [ ] "etcd에 직접 접근하는 유일한 컴포넌트는 API Server"를 기억한다
- [ ] Worker Node 3대 구성요소를 모두 나열하고 각 역할을 설명할 수 있다
- [ ] kubelet은 etcd에 직접 접근하지 않는다는 것을 이해한다
- [ ] kube-scheduler의 2단계(필터링 -> 스코어링) 과정을 설명할 수 있다
- [ ] kube-controller-manager가 "desired state = current state"를 유지하는 역할임을 이해한다
- [ ] K8s v1.24부터 dockershim이 제거되었지만, Docker 이미지는 OCI 표준으로 계속 사용 가능함을 안다
- [ ] API Server의 인증 → 인가 → 어드미션 컨트롤 순서를 기억한다
- [ ] Liveness Probe = 재시작, Readiness Probe = 엔드포인트 제거를 구분한다
- [ ] Taint/Toleration, nodeSelector, nodeAffinity의 기본 개념을 안다

---

## 내일 학습 예고

> Day 2에서는 K8s 아키텍처의 통신 흐름, Static Pod 개념, 주요 포트 번호를 학습하고 20문제 모의시험으로 실전 연습을 진행한다.
