# CKA Day 1: 클러스터 아키텍처 & kubeadm 기초

> 학습 목표 | CKA 도메인: Cluster Architecture, Installation & Configuration (25%) - Part 1 | 예상 소요 시간: 4시간

---

## 오늘의 학습 목표

- [ ] Control Plane / Worker Node 아키텍처를 완벽히 이해한다
- [ ] Static Pod의 동작 원리와 관리 방법을 숙지한다
- [ ] kubeadm의 init/join 과정을 단계별로 설명할 수 있다
- [ ] kubeconfig 파일 구조를 완벽히 이해한다
- [ ] 시험 유형별 문제 풀이 전략을 체득한다

---

## 1. 쿠버네티스 아키텍처 완벽 해부

### 1.1 쿠버네티스란 무엇인가?

쿠버네티스(Kubernetes, 줄여서 K8s)는 컨테이너화된 애플리케이션을 자동으로 배포, 확장, 관리해주는 오케스트레이션(orchestration) 플랫폼이다. 선언적 구성(declarative configuration)과 자동화를 기반으로, desired state와 current state 간의 차이를 지속적으로 reconciliation하는 제어 루프(control loop) 아키텍처를 채택한다.

**핵심 용어 정리:**

| 용어 | 설명 | 아키텍처 역할 |
|---|---|---|
| **클러스터(Cluster)** | 쿠버네티스를 구성하는 서버(노드)들의 집합 | Control Plane + Worker Node로 구성된 분산 시스템 |
| **노드(Node)** | 클러스터를 구성하는 개별 서버(물리/가상 머신) | kubelet, container runtime, kube-proxy가 실행되는 호스트 |
| **Pod** | 쿠버네티스에서 배포 가능한 최소 단위. 하나 이상의 컨테이너를 포함 | 동일 Linux namespace(network, IPC, UTS)를 공유하는 컨테이너 그룹 |
| **컨테이너(Container)** | 애플리케이션과 실행 환경을 패키징한 격리된 프로세스 | cgroup + namespace로 격리된 프로세스 |
| **네임스페이스(Namespace)** | 클러스터 내부를 논리적으로 분리하는 가상 공간 | RBAC, ResourceQuota, NetworkPolicy의 스코프 경계 |

### 1.2 Control Plane(마스터 노드) 구성 요소 심화

Control Plane은 클러스터의 제어 계층(control plane)으로, desired state와 current state의 차이를 감지하고 reconciliation을 수행하는 모든 관리 컴포넌트가 실행된다.

```
┌──────────────────────────────────────────────────────────────────┐
│                    Control Plane (Master Node)                    │
│                                                                  │
│  ┌─────────────────┐  ┌──────────────────┐  ┌───────────────┐  │
│  │  kube-apiserver  │  │  kube-scheduler  │  │  kube-controller│  │
│  │   (포트: 6443)   │  │  (포트: 10259)   │  │  -manager      │  │
│  │                 │  │                  │  │  (포트: 10257)  │  │
│  │  모든 요청의     │  │  Pod를 어떤      │  │  다양한 컨트롤러│  │
│  │  진입점         │  │  노드에 배치할지  │  │  를 실행        │  │
│  │                 │  │  결정            │  │                │  │
│  └────────┬────────┘  └──────────────────┘  └───────────────┘  │
│           │                                                      │
│  ┌────────▼────────┐                                            │
│  │      etcd        │                                            │
│  │  (포트: 2379/80) │                                            │
│  │  클러스터 상태를  │                                            │
│  │  저장하는 DB      │                                            │
│  └─────────────────┘                                            │
│                                                                  │
│  kubelet (모든 노드에서 실행, 포트: 10250)                       │
└──────────────────────────────────────────────────────────────────┘
```

#### kube-apiserver (API 서버)

API 서버는 쿠버네티스 클러스터의 유일한 etcd 접근 게이트웨이이다. kubectl, kubelet, controller-manager, scheduler 등 모든 컴포넌트는 RESTful API를 통해 API 서버와 통신하며, etcd에 직접 접근하는 것은 API 서버뿐이다.

**주요 역할:**
1. **인증(Authentication)**: X.509 인증서, Bearer Token, OIDC 등을 통해 요청자의 identity를 검증
2. **인가(Authorization)**: RBAC, Node, Webhook 등의 인가 모듈로 해당 리소스에 대한 verb 권한 확인
3. **Admission Control**: MutatingAdmissionWebhook, ValidatingAdmissionWebhook 등으로 정책 준수 검증 및 오브젝트 변환
4. **etcd 접근**: 검증된 요청을 etcd에 저장하거나 조회

```yaml
# kube-apiserver Static Pod 매니페스트 상세 분석
# 파일 위치: /etc/kubernetes/manifests/kube-apiserver.yaml
apiVersion: v1                    # 쿠버네티스 API 버전. v1은 핵심(core) API 그룹
kind: Pod                         # 이 YAML이 정의하는 리소스 종류. Pod = 쿠버네티스 최소 배포 단위
metadata:                         # 리소스의 메타데이터(이름, 라벨 등 식별 정보)
  name: kube-apiserver            # Pod의 이름. Static Pod이므로 뒤에 노드 이름이 자동 추가됨
  namespace: kube-system          # 이 Pod가 속하는 네임스페이스. 시스템 컴포넌트는 kube-system
  labels:                         # Pod를 분류하기 위한 키-값 쌍
    component: kube-apiserver     # 컴포넌트 이름 라벨
    tier: control-plane           # Control Plane 계층 라벨
spec:                             # Pod의 상세 사양(스펙)
  containers:                     # Pod 내부에서 실행할 컨테이너 목록
  - name: kube-apiserver          # 컨테이너 이름
    image: registry.k8s.io/kube-apiserver:v1.31.0  # 사용할 컨테이너 이미지
    command:                      # 컨테이너 시작 시 실행할 명령어
    - kube-apiserver              # apiserver 바이너리 실행
    # === 인증/인가 관련 설정 ===
    - --advertise-address=192.168.64.10   # 다른 컴포넌트에 알려줄 API 서버 IP
    - --authorization-mode=Node,RBAC      # 인가 방식: Node(kubelet용) + RBAC(역할기반)
    - --enable-admission-plugins=NodeRestriction  # 활성화할 Admission 플러그인
    # === 인증서 관련 설정 ===
    - --client-ca-file=/etc/kubernetes/pki/ca.crt              # 클라이언트 인증서 검증용 CA
    - --tls-cert-file=/etc/kubernetes/pki/apiserver.crt        # API 서버 TLS 인증서
    - --tls-private-key-file=/etc/kubernetes/pki/apiserver.key # API 서버 TLS 개인키
    - --kubelet-client-certificate=/etc/kubernetes/pki/apiserver-kubelet-client.crt  # kubelet 접속용
    - --kubelet-client-key=/etc/kubernetes/pki/apiserver-kubelet-client.key
    # === etcd 연결 설정 ===
    - --etcd-servers=https://127.0.0.1:2379      # etcd 서버 주소 (로컬)
    - --etcd-cafile=/etc/kubernetes/pki/etcd/ca.crt     # etcd CA 인증서
    - --etcd-certfile=/etc/kubernetes/pki/apiserver-etcd-client.crt  # etcd 접속용 인증서
    - --etcd-keyfile=/etc/kubernetes/pki/apiserver-etcd-client.key
    # === 서비스/네트워크 설정 ===
    - --service-cluster-ip-range=10.96.0.0/16    # Service에 할당할 가상 IP 대역
    - --service-account-key-file=/etc/kubernetes/pki/sa.pub       # ServiceAccount 토큰 검증 키
    - --service-account-signing-key-file=/etc/kubernetes/pki/sa.key  # SA 토큰 서명 키
    - --service-account-issuer=https://kubernetes.default.svc.cluster.local
    # === 프록시/기타 설정 ===
    - --proxy-client-cert-file=/etc/kubernetes/pki/front-proxy-client.crt
    - --proxy-client-key-file=/etc/kubernetes/pki/front-proxy-client.key
    - --requestheader-client-ca-file=/etc/kubernetes/pki/front-proxy-ca.crt
    - --secure-port=6443              # HTTPS 포트 (기본값)
    ports:                            # 컨테이너가 노출하는 포트
    - containerPort: 6443             # 6443 포트로 API 요청을 수신
      hostPort: 6443                  # 호스트(노드)의 6443 포트와 직접 매핑
      protocol: TCP
    volumeMounts:                     # 컨테이너에 마운트할 볼륨
    - name: k8s-certs                 # 인증서 볼륨 마운트
      mountPath: /etc/kubernetes/pki  # 컨테이너 내부 경로
      readOnly: true                  # 읽기 전용
    - name: etcd-certs
      mountPath: /etc/kubernetes/pki/etcd
      readOnly: true
  hostNetwork: true                   # 호스트 네트워크 사용 (Pod IP = 노드 IP)
  volumes:                            # Pod에 제공할 볼륨 정의
  - name: k8s-certs
    hostPath:                         # 노드의 파일시스템 경로를 마운트
      path: /etc/kubernetes/pki       # 호스트의 인증서 디렉터리
      type: DirectoryOrCreate
  - name: etcd-certs
    hostPath:
      path: /etc/kubernetes/pki/etcd
      type: DirectoryOrCreate
```

#### etcd (분산 키-값 저장소)

etcd는 Raft 합의 알고리즘 기반의 분산 키-값 저장소로, 모든 쿠버네티스 오브젝트(Pod, Service, Deployment 등)의 상태를 /registry 프리픽스 하위에 protobuf 직렬화된 형태로 저장한다. linearizable read를 보장하며, 오직 kube-apiserver만 etcd와 직접 통신한다.

**핵심 특성:**
- Raft 합의 알고리즘(consensus algorithm) 기반 - 여러 etcd 노드 중 과반수가 동의해야 데이터가 확정됨
- 키-값(key-value) 형태로 데이터 저장 (예: `/registry/pods/default/nginx` → Pod 정보)
- API 버전 3 사용 (`ETCDCTL_API=3`)
- TLS 인증서 기반 통신 (암호화된 통신)

```yaml
# etcd Static Pod 매니페스트 상세 분석
# 파일 위치: /etc/kubernetes/manifests/etcd.yaml
apiVersion: v1
kind: Pod
metadata:
  name: etcd                          # Pod 이름
  namespace: kube-system
  labels:
    component: etcd
    tier: control-plane
spec:
  containers:
  - name: etcd
    image: registry.k8s.io/etcd:3.5.15-0
    command:
    - etcd
    # === 데이터 저장 ===
    - --data-dir=/var/lib/etcd                    # 데이터 저장 디렉터리 (시험에서 중요!)
    # === 인증서 설정 ===
    - --cert-file=/etc/kubernetes/pki/etcd/server.crt     # 서버 인증서
    - --key-file=/etc/kubernetes/pki/etcd/server.key      # 서버 개인키
    - --trusted-ca-file=/etc/kubernetes/pki/etcd/ca.crt   # 신뢰할 CA 인증서
    - --client-cert-auth=true                             # 클라이언트 인증서 인증 활성화
    # === 피어(peer) 통신 설정 (etcd 클러스터 간) ===
    - --peer-cert-file=/etc/kubernetes/pki/etcd/peer.crt
    - --peer-key-file=/etc/kubernetes/pki/etcd/peer.key
    - --peer-trusted-ca-file=/etc/kubernetes/pki/etcd/ca.crt
    # === 엔드포인트 설정 ===
    - --listen-client-urls=https://127.0.0.1:2379,https://192.168.64.10:2379
    - --advertise-client-urls=https://192.168.64.10:2379
    - --listen-peer-urls=https://192.168.64.10:2380
    - --initial-advertise-peer-urls=https://192.168.64.10:2380
    # === 스냅샷 설정 ===
    - --snapshot-count=10000                      # 10000개 변경마다 스냅샷 생성
    volumeMounts:
    - name: etcd-data                             # 데이터 볼륨
      mountPath: /var/lib/etcd                    # 컨테이너 내부 데이터 경로
    - name: etcd-certs                            # 인증서 볼륨
      mountPath: /etc/kubernetes/pki/etcd
      readOnly: true
  volumes:
  - name: etcd-data
    hostPath:
      path: /var/lib/etcd                         # 호스트의 etcd 데이터 디렉터리
      type: DirectoryOrCreate
  - name: etcd-certs
    hostPath:
      path: /etc/kubernetes/pki/etcd
      type: DirectoryOrCreate
```

#### kube-scheduler (스케줄러)

스케줄러는 nodeName이 미설정된 새 Pod를 감지하여, 필터링(Filtering)과 스코어링(Scoring) 2단계 알고리즘으로 최적의 노드를 선택하고 바인딩(Binding)하는 컴포넌트이다.

**스케줄링 과정:**
1. **필터링(Filtering)**: 조건에 맞지 않는 노드를 제거 (리소스 부족, Taint 불일치, 노드 셀렉터 불일치 등)
2. **점수 매기기(Scoring)**: 남은 노드에 점수를 부여 (리소스 균형, 어피니티 등)
3. **바인딩(Binding)**: 가장 높은 점수의 노드에 Pod를 배정

```
Pod 생성 요청
    │
    ▼
[필터링] 노드 10개 중 조건에 맞는 3개만 남김
    │    - 노드A: 리소스 부족 → 제외
    │    - 노드B: Taint 있는데 Toleration 없음 → 제외
    │    - 노드C: nodeSelector 불일치 → 제외
    │    - ...
    ▼
[점수 매기기] 3개 노드에 점수 부여
    │    - 노드D: 85점 (리소스 여유, Affinity 일치)
    │    - 노드E: 72점 (리소스 보통)
    │    - 노드F: 68점 (리소스 빡빡)
    ▼
[바인딩] 노드D에 Pod 배정 (API 서버에 알림)
```

#### kube-controller-manager (컨트롤러 매니저)

컨트롤러 매니저는 다수의 독립적인 제어 루프(control loop)를 단일 바이너리로 실행하는 컴포넌트이다. 각 컨트롤러는 Watch 메커니즘으로 리소스 변경을 감지하고, current state를 desired state로 수렴시키는 reconciliation 로직을 수행한다.

**내부에 포함된 주요 컨트롤러:**

| 컨트롤러 | 역할 |
|---|---|
| **ReplicaSet Controller** | 지정된 수의 Pod 레플리카가 실행 중인지 확인 |
| **Deployment Controller** | Deployment 업데이트 시 새 ReplicaSet 생성/관리 |
| **Node Controller** | 노드 상태 모니터링, NotReady 노드의 Pod 퇴거 |
| **Job Controller** | Job이 완료될 때까지 Pod 실행 관리 |
| **ServiceAccount Controller** | 새 네임스페이스에 기본 ServiceAccount 생성 |
| **Namespace Controller** | 삭제 중인 네임스페이스의 리소스 정리 |
| **EndpointSlice Controller** | Service와 Pod를 연결하는 EndpointSlice 관리 |

### 1.3 Worker Node 구성 요소

Worker Node는 kubelet, container runtime(containerd), kube-proxy(또는 eBPF 기반 CNI)가 실행되며 실제 워크로드 Pod를 호스팅하는 데이터 플레인 노드이다.

```
┌──────────────────────────────────────────────────────────────┐
│                       Worker Node                             │
│                                                              │
│  ┌─────────────┐  ┌───────────────┐  ┌────────────────────┐ │
│  │   kubelet    │  │  kube-proxy   │  │  Container Runtime │ │
│  │             │  │               │  │  (containerd)      │ │
│  │  Pod 생명주기│  │  Service      │  │                    │ │
│  │  관리        │  │  네트워크     │  │  컨테이너 실행     │ │
│  │  포트:10250  │  │  규칙 관리    │  │  엔진              │ │
│  └─────────────┘  └───────────────┘  └────────────────────┘ │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │                    CNI Plugin (Cilium)                    │ │
│  │                    Pod 네트워크 설정                       │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌───────┐  ┌───────┐  ┌───────┐  ┌───────┐                │
│  │ Pod A │  │ Pod B │  │ Pod C │  │ Pod D │                │
│  └───────┘  └───────┘  └───────┘  └───────┘                │
└──────────────────────────────────────────────────────────────┘
```

#### kubelet

kubelet은 각 노드에서 실행되는 에이전트로, API 서버로부터 PodSpec을 수신하여 CRI(Container Runtime Interface)를 통해 컨테이너 생명주기를 관리한다.

**주요 역할:**
- API 서버로부터 Pod 스펙을 수신하여 컨테이너 실행
- Pod의 건강 상태를 주기적으로 확인 (Liveness/Readiness Probe)
- 노드 상태를 API 서버에 보고
- Static Pod 관리 (매니페스트 파일 감시)

**설정 파일 위치:**
```bash
# kubelet 메인 설정 파일
/var/lib/kubelet/config.yaml

# kubelet 서비스 파일
/etc/systemd/system/kubelet.service.d/10-kubeadm.conf

# kubelet kubeconfig (API 서버 인증 정보)
/etc/kubernetes/kubelet.conf
```

```yaml
# kubelet 설정 파일 상세 분석
# 파일 위치: /var/lib/kubelet/config.yaml
apiVersion: kubelet.config.k8s.io/v1beta1  # kubelet 설정 API 버전
kind: KubeletConfiguration                  # 리소스 종류
# === 클러스터 DNS 설정 ===
clusterDNS:                                 # 클러스터 내부 DNS 서버 IP 목록
- 10.96.0.10                                # CoreDNS Service의 ClusterIP
clusterDomain: cluster.local                # 클러스터 도메인 이름
# === Static Pod 설정 ===
staticPodPath: /etc/kubernetes/manifests    # Static Pod 매니페스트 경로 (시험 핵심!)
# === 인증 설정 ===
authentication:
  anonymous:
    enabled: false                          # 익명 접근 불허
  webhook:
    enabled: true                           # Webhook 인증 사용
authorization:
  mode: Webhook                             # Webhook 인가 사용
# === 리소스 설정 ===
cgroupDriver: systemd                       # cgroup 드라이버 (containerd와 일치 필요)
containerRuntimeEndpoint: unix:///run/containerd/containerd.sock
# === 기타 설정 ===
rotateCertificates: true                    # 인증서 자동 갱신
```

#### kube-proxy

kube-proxy는 "네트워크 안내원"이다. Service로 들어오는 트래픽을 올바른 Pod로 전달하는 규칙을 관리한다.

**동작 모드:**
- **iptables** (기본): iptables 규칙으로 트래픽 라우팅
- **IPVS**: Linux IPVS(IP Virtual Server)로 라우팅 (고성능)
- **nftables**: 차세대 Linux 방화벽 프레임워크

**참고:** tart-infra는 Cilium CNI를 `kubeProxyReplacement=true`로 사용하므로, kube-proxy 대신 Cilium이 이 역할을 수행한다.

#### Container Runtime (컨테이너 런타임)

컨테이너 런타임은 "컨테이너 실행 엔진"이다. kubelet의 지시를 받아 실제로 컨테이너를 생성/실행/삭제한다.

쿠버네티스는 CRI(Container Runtime Interface)를 통해 다양한 런타임을 지원한다:
- **containerd** (가장 많이 사용, Docker에서 분리된 핵심 엔진)
- **CRI-O** (Red Hat/OpenShift에서 주로 사용)

```
kubelet → CRI → containerd → runc → 컨테이너
```

### 1.4 API 요청 처리 전체 흐름

사용자가 `kubectl apply -f deployment.yaml`을 실행하면 어떤 일이 일어날까?

```
사용자: kubectl apply -f deployment.yaml
    │
    ▼
[1단계] kube-apiserver
    │  - 인증: kubeconfig의 인증서로 사용자 확인
    │  - 인가: RBAC 정책으로 권한 확인
    │  - Admission Control: 정책 검증 (예: ResourceQuota)
    │  - Validation: YAML 문법 및 필드 유효성 검사
    │  - etcd에 Deployment 오브젝트 저장
    ▼
[2단계] kube-controller-manager (Deployment Controller)
    │  - etcd에서 Deployment 변경 감지 (watch)
    │  - ReplicaSet 오브젝트 생성
    │  - etcd에 ReplicaSet 저장
    ▼
[3단계] kube-controller-manager (ReplicaSet Controller)
    │  - ReplicaSet 변경 감지
    │  - 지정된 수의 Pod 오브젝트 생성
    │  - etcd에 Pod 저장 (nodeName 미지정 상태)
    ▼
[4단계] kube-scheduler
    │  - nodeName이 비어있는 Pod 감지
    │  - 필터링 + 점수 매기기로 최적 노드 선택
    │  - Pod의 nodeName 필드에 노드 이름 바인딩
    │  - etcd 업데이트
    ▼
[5단계] kubelet (해당 노드)
    │  - 자신의 노드에 배정된 새 Pod 감지
    │  - containerd에 컨테이너 생성 요청
    │  - CNI 플러그인(Cilium)으로 네트워크 설정
    │  - 컨테이너 시작
    │  - Pod 상태를 Running으로 업데이트
    ▼
[6단계] kube-proxy / Cilium
    - Service가 있으면 네트워크 규칙 업데이트
    - 외부/내부 트래픽을 Pod로 라우팅
```

### 1.5 Static Pod 심화

Static Pod는 kubelet이 직접 관리하는 특별한 Pod이다. API 서버 없이도 동작한다.

Static Pod는 kubelet이 API 서버를 경유하지 않고 staticPodPath 디렉터리의 매니페스트 파일을 직접 감시(inotify)하여 생성/삭제하는 Pod이다. API 서버에는 읽기 전용 mirror Pod으로 반영된다.

**핵심 특성:**
1. kubelet이 지정된 디렉터리(staticPodPath)를 주기적으로 감시한다
2. 해당 디렉터리에 YAML 파일을 추가하면 Pod가 자동 생성된다
3. 파일을 삭제하면 Pod도 자동으로 삭제된다
4. API 서버에 "미러 Pod(Mirror Pod)"로 표시된다 - 보이지만 kubectl로 삭제할 수 없다
5. Pod 이름에 노드 이름이 접미사로 붙는다 (예: `etcd-platform-master`)

**왜 중요한가?**
Control Plane의 핵심 컴포넌트(apiserver, etcd, scheduler, controller-manager)가 모두 Static Pod로 실행된다!

```
Static Pod 매니페스트 디렉터리 구조:
/etc/kubernetes/manifests/
├── etcd.yaml                          # etcd 데이터베이스
├── kube-apiserver.yaml                # API 서버
├── kube-controller-manager.yaml       # 컨트롤러 매니저
└── kube-scheduler.yaml                # 스케줄러
```

**Static Pod 경로 확인 방법 3가지:**

```bash
# 방법 1: kubelet 설정 파일에서 확인 (가장 권장)
cat /var/lib/kubelet/config.yaml | grep staticPodPath
# 출력: staticPodPath: /etc/kubernetes/manifests

# 방법 2: kubelet 프로세스 인자에서 확인
ps aux | grep kubelet | grep -- --pod-manifest-path

# 방법 3: kubelet 서비스 파일에서 확인
systemctl cat kubelet
```

**Static Pod YAML 예제:**

```yaml
# Static Pod 생성 예제
# 파일 위치: /etc/kubernetes/manifests/static-web.yaml
apiVersion: v1                # API 버전 - Pod는 core 그룹이므로 v1
kind: Pod                     # 리소스 종류 - Static Pod도 일반 Pod와 동일한 형식
metadata:                     # 메타데이터 섹션
  name: static-web            # Pod 이름 (실제로는 static-web-<노드이름>으로 표시)
  namespace: default          # 네임스페이스 (Static Pod도 네임스페이스 지정 가능)
  labels:                     # 라벨 (선택사항이지만 관리 편의를 위해 권장)
    role: static-web          # 커스텀 라벨
    tier: frontend            # 계층 라벨
spec:                         # Pod 사양
  containers:                 # 컨테이너 목록 (최소 1개 필수)
  - name: nginx               # 컨테이너 이름
    image: nginx:1.24         # 사용할 이미지 (태그까지 명시하는 것이 모범 사례)
    ports:                    # 노출할 포트
    - containerPort: 80       # 컨테이너 내부 포트
      name: http              # 포트 이름 (선택사항)
      protocol: TCP           # 프로토콜 (기본값: TCP)
    resources:                # 리소스 제한 (선택사항이지만 권장)
      requests:               # 최소 보장 리소스
        cpu: "50m"            # 50 밀리코어 (0.05 CPU)
        memory: "64Mi"        # 64 메비바이트
      limits:                 # 최대 사용 가능 리소스
        cpu: "200m"
        memory: "128Mi"
```

### 1.6 kubeadm 완벽 이해

kubeadm은 쿠버네티스 클러스터를 빠르게 설치하고 관리하기 위한 공식 도구이다.

kubeadm은 PKI 인증서 생성, kubeconfig 파일 생성, Static Pod 매니페스트 배치, Bootstrap Token 발급 등의 과정을 자동화하여 쿠버네티스 클러스터를 부트스트래핑하는 도구이다.

#### kubeadm init 7단계 상세

```
kubeadm init 실행
    │
    ▼
[1단계] Preflight Checks (사전 점검)
    │  - root 권한 확인
    │  - 스왑(swap) 비활성화 여부 확인
    │  - 필요한 포트(6443, 2379, 10250 등) 사용 가능 여부 확인
    │  - 커널 모듈(br_netfilter, overlay) 로드 확인
    │  - 컨테이너 런타임(containerd) 실행 중인지 확인
    ▼
[2단계] 인증서 생성
    │  - /etc/kubernetes/pki/ 디렉터리에 인증서 생성
    │  - CA 인증서, API 서버 인증서, etcd 인증서 등
    │  - 기본 유효기간: 1년 (CA는 10년)
    ▼
[3단계] kubeconfig 파일 생성
    │  - /etc/kubernetes/admin.conf (관리자용)
    │  - /etc/kubernetes/kubelet.conf (kubelet용)
    │  - /etc/kubernetes/controller-manager.conf
    │  - /etc/kubernetes/scheduler.conf
    ▼
[4단계] Static Pod 매니페스트 생성
    │  - /etc/kubernetes/manifests/ 디렉터리에 4개 파일 생성
    │  - etcd.yaml, kube-apiserver.yaml
    │  - kube-controller-manager.yaml, kube-scheduler.yaml
    ▼
[5단계] kubelet이 Static Pod 시작
    │  - kubelet이 manifests 디렉터리를 감지
    │  - Control Plane 컴포넌트를 Pod로 시작
    │  - API 서버가 응답할 때까지 대기
    ▼
[6단계] Bootstrap Token 생성
    │  - Worker Node 조인용 토큰 생성
    │  - 기본 TTL: 24시간
    ▼
[7단계] Addon 설치
    - CoreDNS Deployment 배포
    - kube-proxy DaemonSet 배포
```

#### kubeadm 핵심 명령어

```bash
# === 클러스터 초기화 ===
kubeadm init \
  --pod-network-cidr=10.10.0.0/16 \        # Pod에 할당할 IP 대역
  --service-cidr=10.96.0.0/16 \            # Service에 할당할 IP 대역
  --kubernetes-version=v1.31.0 \           # 설치할 K8s 버전
  --control-plane-endpoint=<LB-IP>:6443 \  # 고가용성(HA) 엔드포인트
  --apiserver-advertise-address=<IP>       # API 서버 광고 주소

# === Worker Node 조인 ===
kubeadm join <apiserver>:6443 \
  --token <token> \                        # Bootstrap 토큰
  --discovery-token-ca-cert-hash sha256:<hash>  # CA 인증서 해시

# === 토큰 관리 ===
kubeadm token create --print-join-command  # 새 토큰 생성 + join 명령 출력
kubeadm token list                          # 토큰 목록 조회
kubeadm token delete <token-id>            # 토큰 삭제

# === 인증서 관리 ===
kubeadm certs check-expiration             # 인증서 만료일 확인
kubeadm certs renew all                     # 모든 인증서 갱신
kubeadm certs renew apiserver              # 특정 인증서만 갱신

# === 업그레이드 ===
kubeadm upgrade plan                        # 업그레이드 가능한 버전 확인
kubeadm upgrade apply v1.32.0              # Control Plane 업그레이드
kubeadm upgrade node                        # Worker Node 업그레이드

# === 리셋 ===
kubeadm reset                              # 클러스터 초기화 (주의! 모든 데이터 삭제)
```

### 1.7 kubeconfig 파일 완벽 이해

kubeconfig는 kubectl이 클러스터에 접속하기 위한 설정 파일이다.

kubeconfig는 cluster(API 서버 endpoint + CA 인증서), user(클라이언트 인증서/토큰), context(cluster + user + namespace 조합)의 3요소로 구성된 YAML 기반 인증 구성 파일이다.

```yaml
# kubeconfig 파일 상세 분석
apiVersion: v1                    # API 버전
kind: Config                      # kubeconfig 타입
current-context: platform         # 현재 활성 컨텍스트 (기본으로 사용할 컨텍스트)

# === 클러스터 정보 ===
# 접속할 쿠버네티스 클러스터의 주소와 CA 인증서
clusters:
- name: platform                  # 클러스터 식별 이름
  cluster:
    server: https://192.168.64.10:6443     # API 서버 주소
    certificate-authority-data: LS0tLS...  # CA 인증서 (base64 인코딩)
    # 또는 파일 경로로 지정:
    # certificate-authority: /etc/kubernetes/pki/ca.crt
- name: dev
  cluster:
    server: https://192.168.64.20:6443
    certificate-authority-data: LS0tLS...

# === 사용자 인증 정보 ===
# 클러스터에 인증할 때 사용할 인증서 또는 토큰
users:
- name: admin                     # 사용자 식별 이름
  user:
    client-certificate-data: LS0tLS...  # 클라이언트 인증서 (base64)
    client-key-data: LS0tLS...          # 클라이언트 개인키 (base64)
    # 또는 토큰 기반 인증:
    # token: eyJhbGci...
- name: dev-admin
  user:
    client-certificate-data: LS0tLS...
    client-key-data: LS0tLS...

# === 컨텍스트 (클러스터 + 사용자 + 네임스페이스 조합) ===
# "어떤 클러스터에 어떤 사용자로 어떤 네임스페이스에 접근할지" 정의
contexts:
- name: platform                  # 컨텍스트 이름
  context:
    cluster: platform             # 사용할 클러스터
    user: admin                   # 사용할 사용자
    namespace: default            # 기본 네임스페이스
- name: dev
  context:
    cluster: dev
    user: dev-admin
    namespace: demo
```

#### kubeconfig 관련 핵심 명령어

```bash
# 현재 설정 보기
kubectl config view
kubectl config view --minify    # 현재 컨텍스트 정보만 표시

# 컨텍스트 관리
kubectl config get-contexts                    # 모든 컨텍스트 나열
kubectl config current-context                  # 현재 컨텍스트 확인
kubectl config use-context dev                 # 컨텍스트 전환

# 기본 네임스페이스 변경
kubectl config set-context --current --namespace=demo

# 클러스터 API 서버 주소 확인
kubectl config view -o jsonpath='{.clusters[?(@.name=="prod")].cluster.server}'

# kubeconfig 수동 생성
kubectl config set-cluster <name> --server=https://<ip>:6443 \
  --certificate-authority=<ca-path> --kubeconfig=<file>

kubectl config set-credentials <user> \
  --client-certificate=<cert> --client-key=<key> --kubeconfig=<file>

kubectl config set-context <ctx> --cluster=<cluster> \
  --user=<user> --namespace=<ns> --kubeconfig=<file>
```

### 1.8 인증서 구조 완벽 정리

```
/etc/kubernetes/pki/
│
├── ca.crt / ca.key                        # 클러스터 루트 CA
│   └── 역할: 모든 쿠버네티스 인증서의 부모 인증서
│   └── 유효기간: 10년
│
├── apiserver.crt / apiserver.key          # API 서버 인증서
│   └── 역할: API 서버가 클라이언트에게 제시하는 신분증
│   └── SAN: kubernetes, kubernetes.default, <IP>, <hostname> 등
│
├── apiserver-kubelet-client.crt / .key    # API → kubelet 통신용
│   └── 역할: API 서버가 kubelet에 접속할 때 사용
│
├── apiserver-etcd-client.crt / .key       # API → etcd 통신용
│   └── 역할: API 서버가 etcd에 접속할 때 사용
│
├── front-proxy-ca.crt / .key             # 프론트 프록시 CA
├── front-proxy-client.crt / .key         # 프론트 프록시 클라이언트
│   └── 역할: API aggregation layer용
│
├── sa.key / sa.pub                        # ServiceAccount 서명 키쌍
│   └── 역할: ServiceAccount 토큰 발급/검증
│
└── etcd/
    ├── ca.crt / ca.key                    # etcd 전용 CA
    ├── server.crt / server.key            # etcd 서버 인증서
    ├── peer.crt / peer.key                # etcd 피어 통신 인증서
    └── healthcheck-client.crt / .key      # etcd 헬스체크용
```

---

## 2. 동작 원리 심화

### 2.1 Pod 생성 전체 흐름도

```
┌──────────┐     ┌──────────────┐     ┌───────┐
│  kubectl  │────▶│ kube-apiserver│────▶│ etcd  │
│  (사용자)  │     │  (인증/인가)   │     │(저장) │
└──────────┘     └──────┬───────┘     └───────┘
                        │
              ┌─────────┴──────────┐
              │                    │
     ┌────────▼─────────┐  ┌──────▼──────────────┐
     │ controller-manager│  │   kube-scheduler     │
     │ (ReplicaSet생성)  │  │   (노드 선택)        │
     └──────────────────┘  └──────────────────────┘
                                    │
                           ┌────────▼────────┐
                           │    kubelet       │
                           │ (Pod 실행)       │
                           └────────┬────────┘
                                    │
                           ┌────────▼────────┐
                           │   containerd    │
                           │ (컨테이너 생성)  │
                           └────────┬────────┘
                                    │
                           ┌────────▼────────┐
                           │   CNI (Cilium)  │
                           │ (네트워크 설정)   │
                           └─────────────────┘
```

### 2.2 Watch 메커니즘

쿠버네티스의 핵심 동작 원리는 "Watch(감시)"이다. 각 컴포넌트는 API 서버에 Watch 요청을 보내서 관심 있는 리소스의 변경 사항을 실시간으로 받는다.

```
controller-manager → API 서버에 Watch 요청: "Deployment 변경 알려줘"
scheduler          → API 서버에 Watch 요청: "nodeName 없는 Pod 알려줘"
kubelet            → API 서버에 Watch 요청: "내 노드에 배정된 Pod 알려줘"
```

이 패턴을 "컨트롤 루프(Control Loop)" 또는 "Reconciliation Loop"라고 한다:
1. 현재 상태(Current State) 관찰
2. 원하는 상태(Desired State)와 비교
3. 차이가 있으면 조치

---

## 3. 시험 출제 패턴 분석

### 3.1 이 주제가 시험에서 어떻게 나오는가

CKA 시험에서 "Cluster Architecture" 관련 문제는 전체의 25%를 차지한다. 주로 다음 유형으로 출제된다:

1. **Static Pod 생성/수정** - 특정 노드에 SSH 접속하여 Static Pod 매니페스트를 생성하거나 수정하는 문제
2. **클러스터 컴포넌트 설정 확인** - API 서버의 특정 설정값을 찾아 파일에 저장하는 문제
3. **kubeconfig 관리** - 컨텍스트 전환, 새 컨텍스트 추가, 기본 네임스페이스 변경 문제
4. **kubeadm 토큰 관리** - join 명령 생성, 토큰 목록 확인 문제
5. **노드 정보 조회** - 레이블, Taint, 리소스 용량 확인 문제

### 3.2 문제의 의도

시험 출제자는 다음을 검증하려 한다:
- Static Pod의 매니페스트 경로를 찾을 수 있는가?
- kubectl과 SSH를 적절히 사용할 수 있는가?
- kubeconfig의 구조를 이해하고 있는가?
- 클러스터 컴포넌트의 설정을 조회할 수 있는가?

---

## 4. 실전 시험 문제 (15문제)

### 문제 1. Static Pod 생성 [7%]

**컨텍스트:** `kubectl config use-context platform`

`platform-master` 노드에 다음 조건으로 Static Pod를 생성하라:
- Pod 이름: `static-nginx`
- 이미지: `nginx:1.24`
- 포트: `80`
- 네임스페이스: `default`

<details>
<summary>풀이 과정</summary>

**의도 분석:** Static Pod의 매니페스트 경로를 찾고, YAML 파일을 올바르게 작성할 수 있는지 확인하는 문제.

**풀이 단계:**

```bash
# Step 1: SSH 접속
ssh admin@<platform-master-ip>

# Step 2: Static Pod 매니페스트 경로 확인 (가장 중요한 첫 단계!)
cat /var/lib/kubelet/config.yaml | grep staticPodPath
# 출력: staticPodPath: /etc/kubernetes/manifests

# Step 3: Static Pod 매니페스트 생성
sudo tee /etc/kubernetes/manifests/static-nginx.yaml <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: static-nginx
  namespace: default
  labels:
    role: static-nginx
spec:
  containers:
  - name: nginx
    image: nginx:1.24
    ports:
    - containerPort: 80
EOF

# Step 4: 생성 확인 (약 10~30초 대기)
# SSH에서 나온 후 kubectl로 확인
exit
kubectl --context=platform get pods -A | grep static-nginx
# 출력: default   static-nginx-platform-master   1/1   Running   ...
```

**핵심 포인트:**
- Static Pod 이름에 자동으로 노드 이름이 접미사로 붙는다
- `kubectl delete pod static-nginx-platform-master`로 삭제해도 매니페스트 파일이 있으면 다시 생성된다
- 삭제하려면 반드시 SSH 접속하여 매니페스트 파일을 삭제해야 한다

**정리:**
```bash
ssh admin@<platform-master-ip>
sudo rm /etc/kubernetes/manifests/static-nginx.yaml
exit
```

</details>

---

### 문제 2. Static Pod 매니페스트 경로가 변경된 경우 [7%]

**컨텍스트:** `kubectl config use-context staging`

`staging-master` 노드에서 Static Pod 매니페스트 경로가 기본 경로가 아닌 다른 경로로 설정되어 있다. 올바른 경로를 찾아 Static Pod `static-httpd`(이미지: `httpd:2.4`)를 생성하라.

<details>
<summary>풀이 과정</summary>

```bash
# Step 1: SSH 접속
ssh admin@<staging-master-ip>

# Step 2: staticPodPath 확인 (핵심!)
cat /var/lib/kubelet/config.yaml | grep staticPodPath
# 출력 예: staticPodPath: /etc/kubernetes/custom-manifests
# 또는 기본값: staticPodPath: /etc/kubernetes/manifests

# Step 2-2: kubelet 프로세스에서 직접 확인 (대안)
ps aux | grep kubelet | grep -o "\-\-pod-manifest-path=[^ ]*"

# Step 2-3: kubelet 서비스 파일에서 확인 (대안)
systemctl cat kubelet | grep -i manifest

# Step 3: 확인된 경로에 매니페스트 생성
MANIFEST_PATH=$(cat /var/lib/kubelet/config.yaml | grep staticPodPath | awk '{print $2}')

sudo tee ${MANIFEST_PATH}/static-httpd.yaml <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: static-httpd
spec:
  containers:
  - name: httpd
    image: httpd:2.4
    ports:
    - containerPort: 80
EOF

# Step 4: 확인
exit
kubectl --context=staging get pods | grep static-httpd
```

</details>

---

### 문제 3. kubeadm join 명령 생성 [4%]

**컨텍스트:** `kubectl config use-context staging`

`staging` 클러스터에 새 Worker Node를 추가하기 위한 `kubeadm join` 명령을 생성하라. 명령을 `/tmp/join-command.txt`에 저장하라.

<details>
<summary>풀이 과정</summary>

```bash
# Step 1: staging master에 SSH 접속
ssh admin@<staging-master-ip>

# Step 2: join 명령 생성 (한 줄 명령!)
sudo kubeadm token create --print-join-command > /tmp/join-command.txt

# Step 3: 결과 확인
cat /tmp/join-command.txt
# 출력 예:
# kubeadm join 192.168.64.30:6443 --token abc123.xyz456 \
#   --discovery-token-ca-cert-hash sha256:abcdef1234567890...

# Step 4: 토큰 만료 시간 확인 (추가 확인)
sudo kubeadm token list
```

**핵심 포인트:**
- `kubeadm token create --print-join-command`는 시험에서 가장 많이 사용되는 명령 중 하나
- 기본 토큰 TTL은 24시간
- `--ttl 0`으로 만료되지 않는 토큰 생성 가능 (보안상 비권장)

</details>

---

### 문제 4. API 서버 설정 확인 [4%]

**컨텍스트:** `kubectl config use-context platform`

`platform` 클러스터의 kube-apiserver에서 다음 설정값을 확인하여 `/tmp/apiserver-config.txt`에 저장하라:
1. `--authorization-mode` 값
2. `--service-cluster-ip-range` 값

<details>
<summary>풀이 과정</summary>

```bash
kubectl config use-context platform

# 방법 1: kubectl로 apiserver Pod의 설정 확인 (권장)
kubectl -n kube-system get pod kube-apiserver-platform-master -o yaml | \
  grep -E "authorization-mode|service-cluster-ip-range" > /tmp/apiserver-config.txt

# 방법 2: SSH 접속하여 매니페스트 직접 확인
ssh admin@<platform-master-ip>
sudo grep -E "authorization-mode|service-cluster-ip-range" \
  /etc/kubernetes/manifests/kube-apiserver.yaml | tee /tmp/apiserver-config.txt
exit

# 결과 확인
cat /tmp/apiserver-config.txt
# 출력:
# --authorization-mode=Node,RBAC
# --service-cluster-ip-range=10.96.0.0/16
```

</details>

---

### 문제 5. kubeconfig 컨텍스트 관리 [7%]

**컨텍스트:** 없음 (여러 클러스터 전환)

다음 작업을 수행하라:
1. 현재 설정된 모든 컨텍스트를 나열하라
2. `dev` 컨텍스트로 전환하라
3. 현재 컨텍스트의 기본 네임스페이스를 `demo`로 변경하라
4. `prod` 컨텍스트의 클러스터 API 서버 주소를 `/tmp/prod-server.txt`에 저장하라

<details>
<summary>풀이 과정</summary>

```bash
# 1. 모든 컨텍스트 나열
kubectl config get-contexts

# 2. dev 컨텍스트로 전환
kubectl config use-context dev

# 3. 기본 네임스페이스를 demo로 변경
kubectl config set-context --current --namespace=demo

# 확인
kubectl config get-contexts
# dev 컨텍스트의 NAMESPACE 열에 demo가 표시된다

# 4. prod 클러스터의 API 서버 주소 확인
kubectl config view -o jsonpath='{.clusters[?(@.name=="prod")].cluster.server}' > /tmp/prod-server.txt

# 확인
cat /tmp/prod-server.txt
```

**핵심 포인트:**
- CKA 시험에서는 매 문제마다 `kubectl config use-context <context>` 명령이 주어진다
- **반드시 컨텍스트를 먼저 전환한 후 문제를 풀어야 한다**
- 잘못된 컨텍스트에서 작업하면 0점이다

</details>

---

## tart-infra 실습

### 실습 환경 설정

```bash
# 4개 클러스터 kubeconfig를 모두 로드
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/platform.yaml:~/sideproejct/tart-infra/kubeconfig/dev.yaml:~/sideproejct/tart-infra/kubeconfig/staging.yaml:~/sideproejct/tart-infra/kubeconfig/prod.yaml

# 사용 가능한 컨텍스트 확인
kubectl config get-contexts
```

**예상 출력:**
```
CURRENT   NAME       CLUSTER    AUTHINFO   NAMESPACE
*         platform   platform   platform
          dev        dev        dev
          staging    staging    staging
          prod       prod       prod
```

### 실습 1: Control Plane 아키텍처 직접 확인

```bash
# platform 클러스터의 Control Plane Static Pod 확인
kubectl config use-context platform
kubectl get pods -n kube-system -o custom-columns='NAME:.metadata.name,NODE:.spec.nodeName,STATUS:.status.phase'
```

**예상 출력:**
```
NAME                                       NODE              STATUS
etcd-platform-master                       platform-master   Running
kube-apiserver-platform-master             platform-master   Running
kube-controller-manager-platform-master    platform-master   Running
kube-scheduler-platform-master             platform-master   Running
coredns-xxxxxxx-xxxxx                      platform-master   Running
```

**동작 원리:**
1. Static Pod는 kubelet이 `/etc/kubernetes/manifests/` 디렉터리의 YAML을 직접 읽어 생성한다
2. API Server 자체가 Static Pod이므로 API Server 없이도 부트스트랩이 가능하다
3. Pod 이름에 노드명이 접미사로 붙는다 (`etcd-platform-master`)
4. `custom-columns` 출력으로 Static Pod가 모두 Control Plane 노드에서 실행됨을 확인한다

### 실습 2: 멀티 클러스터 kubeconfig 구조 분석

```bash
# kubeconfig 내의 클러스터/유저/컨텍스트 구조 확인
kubectl config view -o jsonpath='{range .clusters[*]}{.name}{"\t"}{.cluster.server}{"\n"}{end}'
```

**예상 출력:**
```
platform	https://192.168.64.10:6443
dev	https://192.168.64.20:6443
staging	https://192.168.64.30:6443
prod	https://192.168.64.40:6443
```

**동작 원리:**
1. `KUBECONFIG` 환경변수에 `:` 구분자로 여러 파일을 지정하면 kubectl이 자동 머지한다
2. 각 kubeconfig 파일에는 cluster(API Server 주소), user(인증 정보), context(cluster+user 조합)가 정의된다
3. `kubectl config use-context`로 활성 컨텍스트를 전환하면 이후 명령이 해당 클러스터로 전달된다

### 실습 3: Worker Node 상태 및 컴포넌트 확인

```bash
# dev 클러스터로 전환 후 노드 상세 정보 확인
kubectl config use-context dev
kubectl get nodes -o wide

# 노드의 kubelet 버전과 컨테이너 런타임 확인
kubectl get nodes -o custom-columns='NAME:.metadata.name,KUBELET:.status.nodeInfo.kubeletVersion,RUNTIME:.status.nodeInfo.containerRuntimeVersion'
```

**예상 출력:**
```
NAME          KUBELET   RUNTIME
dev-master    v1.31.0   containerd://1.7.x
dev-worker1   v1.31.0   containerd://1.7.x
```

**동작 원리:**
1. kubelet은 각 노드에서 실행되며 Node 오브젝트의 `.status.nodeInfo`에 자신의 버전 정보를 보고한다
2. 컨테이너 런타임(containerd)은 CRI(Container Runtime Interface)를 통해 kubelet과 통신한다
3. `-o custom-columns`는 JSONPath 기반으로 원하는 필드만 추출하여 표시한다

