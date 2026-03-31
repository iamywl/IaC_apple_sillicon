# KCSA 보안 실습 가이드 — tart-infra 활용

이 가이드는 tart-infra 환경을 활용하여 KCSA(Kubernetes and Cloud Native Security Associate) 시험 범위의 보안 개념을 실습하는 종합 안내서이다. 총 6개 실습 영역과 3개 종합 시나리오를 통해, 실제 클러스터에서 보안 정책을 분석하고 테스트하며 강화하는 방법을 단계별로 학습한다.

tart-infra는 macOS 위에서 Tart 가상 머신을 통해 Kubernetes 클러스터를 구성하고, Cilium CNI, Istio 서비스 메시, 그리고 다양한 데모 애플리케이션(nginx, httpbin, redis, postgres, rabbitmq, keycloak)을 배포한 학습 환경이다. 11개의 CiliumNetworkPolicy, Istio STRICT mTLS, Prometheus 알림 규칙 등이 미리 구성되어 있어 실제 운영 환경과 유사한 보안 실습이 가능하다.

---

## 사전 준비

### 환경 설정

tart-infra 실습을 시작하기 전에 다음 환경이 준비되어 있어야 한다.

**1단계: kubeconfig 설정**

```bash
# tart-infra 루트 디렉토리에서 실행한다
export KUBECONFIG=kubeconfig/dev-kubeconfig

# 클러스터 접속 확인
kubectl cluster-info
```

예상 출력:
```
Kubernetes control plane is running at https://<dev-master-ip>:6443
CoreDNS is running at https://<dev-master-ip>:6443/api/v1/namespaces/kube-system/services/kube-dns:dns/proxy
```

**2단계: 노드 상태 확인**

```bash
kubectl get nodes -o wide
```

예상 출력:
```
NAME          STATUS   ROLES           AGE   VERSION   INTERNAL-IP     OS-IMAGE
dev-master    Ready    control-plane   XXd   v1.XX.X   192.168.64.X    Ubuntu XX.XX
dev-worker1   Ready    <none>          XXd   v1.XX.X   192.168.64.X    Ubuntu XX.XX
```

**3단계: demo 네임스페이스 리소스 확인**

```bash
kubectl get all -n demo
```

예상 출력:
```
NAME                              READY   STATUS    RESTARTS   AGE
pod/httpbin-xxxx-xxxxx            2/2     Running   0          XXd
pod/keycloak-xxxx-xxxxx           2/2     Running   0          XXd
pod/nginx-web-xxxx-xxxxx          2/2     Running   0          XXd
pod/postgres-xxxx-xxxxx           2/2     Running   0          XXd
pod/rabbitmq-xxxx-xxxxx           2/2     Running   0          XXd
pod/redis-xxxx-xxxxx              2/2     Running   0          XXd

NAME                TYPE        CLUSTER-IP       EXTERNAL-IP   PORT(S)
service/httpbin     ClusterIP   10.96.x.x        <none>        80/TCP
service/keycloak    NodePort    10.96.x.x        <none>        8080:30880/TCP
service/nginx-web   NodePort    10.96.x.x        <none>        80:30080/TCP
service/postgres    ClusterIP   10.96.x.x        <none>        5432/TCP
service/rabbitmq    ClusterIP   10.96.x.x        <none>        5672/TCP,15672/TCP
service/redis       ClusterIP   10.96.x.x        <none>        6379/TCP
```

> **참고**: Pod의 READY 열이 `2/2`인 이유는 Istio 사이드카 프록시(envoy)가 각 Pod에 자동 주입되어 있기 때문이다.

**4단계: SSH 접속 테스트**

```bash
# 모든 VM에 SSH 접속 가능 여부를 확인한다 (계정: admin / 비밀번호: admin)
ssh admin@<dev-master-ip> 'hostname'
```

예상 출력:
```
dev-master
```

**5단계: 필수 도구 설치 확인**

```bash
# kubectl 버전 확인
kubectl version --client

# istioctl 설치 확인 (선택)
istioctl version 2>/dev/null || echo "istioctl 미설치 — Istio 실습 시 설치 필요"

# trivy 설치 확인 (실습 4.3에서 필요)
trivy --version 2>/dev/null || echo "trivy 미설치 — brew install trivy 로 설치"
```

**6단계: CiliumNetworkPolicy 목록 사전 확인**

```bash
kubectl get ciliumnetworkpolicy -n demo
```

예상 출력:
```
NAME                           AGE
default-deny-all               XXd
allow-external-to-nginx        XXd
allow-nginx-to-httpbin         XXd
allow-nginx-to-redis           XXd
allow-nginx-egress             XXd
allow-httpbin-to-postgres      XXd
allow-httpbin-to-rabbitmq      XXd
allow-httpbin-to-keycloak      XXd
allow-keycloak-to-postgres     XXd
allow-external-to-keycloak     XXd
allow-istio-control-plane      XXd
```

11개 정책이 모두 표시되면 실습 준비가 완료된 것이다.

---

## 실습 1: 4C 보안 모델 분석 (Cloud Native Security 14%)

Cloud Native Security의 기본 프레임워크인 4C 모델(Cloud, Cluster, Container, Code)을 tart-infra 환경에 매핑하여 각 레이어의 보안 요소를 분석한다.

```
┌─────────────────────────────────────────┐
│              Code (앱 코드)              │
│  ┌───────────────────────────────────┐  │
│  │        Container (컨테이너)        │  │
│  │  ┌─────────────────────────────┐  │  │
│  │  │      Cluster (클러스터)      │  │  │
│  │  │  ┌───────────────────────┐  │  │  │
│  │  │  │    Cloud (인프라)      │  │  │  │
│  │  │  └───────────────────────┘  │  │  │
│  │  └─────────────────────────────┘  │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

---

### Lab 1.1: Cloud 레이어 — VM 격리 확인 (Tart)

#### 학습 목표
- Cloud 레이어에서 인프라 격리가 어떻게 이루어지는지 이해한다.
- Tart VM이 macOS 호스트와 어떻게 분리되어 동작하는지 확인한다.
- VM 수준의 격리가 컨테이너 격리보다 강력한 이유를 설명할 수 있다.

#### 실습 단계

**1단계: Tart VM 목록 확인**

macOS 호스트에서 실행한다.

```bash
tart list
```

예상 출력:
```
Source  Name          Disk (GB)  Size (GB)  State    OS
local   dev-master    50         12.3       running  linux
local   dev-worker1   50         11.8       running  linux
```

**2단계: VM 격리 수준 확인 — 프로세스 격리**

```bash
# macOS 호스트에서 Tart VM 프로세스 확인
ps aux | grep -i tart | grep -v grep
```

예상 출력:
```
ywlee   12345  2.3  4.5  ... /Applications/Tart.app/.../tart run dev-master
ywlee   12346  1.8  3.2  ... /Applications/Tart.app/.../tart run dev-worker1
```

각 VM은 독립된 프로세스로 실행되며, macOS의 Virtualization.framework를 사용하여 하드웨어 수준 격리를 제공한다.

**3단계: VM 내부 커널 확인**

```bash
# VM에 SSH 접속하여 커널 정보 확인
ssh admin@<dev-master-ip> 'uname -a'
```

예상 출력:
```
Linux dev-master 5.15.0-XX-generic #XX-Ubuntu SMP ... aarch64 GNU/Linux
```

```bash
# macOS 호스트의 커널 정보와 비교
uname -a
```

예상 출력:
```
Darwin <hostname> 24.6.0 Darwin Kernel Version 24.6.0 ... arm64
```

VM 내부는 Linux 커널, 호스트는 Darwin(macOS) 커널이 동작하는 것을 확인할 수 있다. 이는 VM이 완전히 독립된 커널 공간을 가지고 있음을 의미한다.

**4단계: VM 네트워크 격리 확인**

```bash
# VM 내부에서 네트워크 인터페이스 확인
ssh admin@<dev-master-ip> 'ip addr show'
```

예상 출력:
```
1: lo: <LOOPBACK,UP,LOWER_UP> ...
    inet 127.0.0.1/8 scope host lo
2: enp0s1: <BROADCAST,MULTICAST,UP,LOWER_UP> ...
    inet 192.168.64.X/24 brd 192.168.64.255 scope global enp0s1
```

```bash
# macOS 호스트에서 VM 전용 네트워크 브리지 확인
ifconfig | grep -A 2 bridge
```

Tart VM은 macOS의 NAT 네트워크를 통해 격리된 네트워크 세그먼트에서 동작한다.

**5단계: VM 리소스 격리 확인**

```bash
# VM에 할당된 CPU/메모리 확인
ssh admin@<dev-master-ip> 'nproc && free -h | head -2'
```

예상 출력:
```
4
              total        used        free      shared  buff/cache   available
Mem:          7.8Gi       3.2Gi       1.1Gi       12Mi       3.5Gi       4.3Gi
```

VM은 호스트의 물리 리소스 중 일부만 할당받아 사용하며, 다른 VM이나 호스트에 영향을 줄 수 없다.

**6단계: 컨테이너 격리와의 비교**

```bash
# VM 내부에서 컨테이너 런타임 확인
ssh admin@<dev-master-ip> 'sudo crictl info | head -20'
```

컨테이너는 호스트 커널을 공유하지만, VM은 독립된 커널을 사용한다. 이것이 VM 격리가 컨테이너 격리보다 더 강력한 근본적인 이유이다.

| 특성 | VM (Tart) | 컨테이너 (containerd) |
|------|-----------|----------------------|
| 커널 | 독립 커널 | 호스트 커널 공유 |
| 부팅 | 전체 OS 부팅 | 프로세스 시작 |
| 격리 수준 | 하드웨어 수준 | 프로세스/namespace 수준 |
| 오버헤드 | 높음 | 낮음 |
| 보안 경계 | 강함 | 상대적으로 약함 |

#### 확인 문제
1. Tart VM은 어떤 가상화 프레임워크를 사용하는가?
2. VM 격리가 컨테이너 격리보다 보안적으로 강력한 이유는 무엇인가?
3. Cloud 레이어에서의 보안 책임(Shared Responsibility Model)에서 VM 격리는 누구의 책임인가?

#### 관련 KCSA 시험 주제
- Cloud Native Security의 4C 모델
- Cloud 레이어 보안 요소
- 격리 기술의 비교 (VM vs. Container)

#### 등장 배경과 기존 한계점

VM 격리 기술은 물리 서버 1대에 1개의 워크로드만 실행하던 시대의 자원 낭비 문제를 해결하기 위해 등장하였다. 1960년대 IBM CP/CMS에서 시작된 가상화 기술은 2000년대 VMware, Xen을 거쳐 현재의 KVM, Hyper-V, Apple Virtualization.framework로 발전하였다. 기존 물리 서버 격리 방식은 하드웨어 자원의 활용률이 10-15%에 불과했으며, 서버 프로비저닝에 수주가 소요되었다. VM은 이 문제를 해결했지만, OS 부팅 오버헤드(수십 초~수분)와 디스크 사용량(GB 단위) 문제가 남았다. 이를 해결하기 위해 컨테이너 기술이 등장했으나, 컨테이너는 커널을 공유하므로 보안 경계가 VM보다 약하다. 따라서 현대 클라우드 네이티브 아키텍처에서는 VM과 컨테이너를 계층적으로 조합하여 사용한다.

#### 공격-방어 매핑

| 공격 벡터 | VM 격리의 방어 효과 | 컨테이너만 사용 시 위험 |
|----------|-------------------|---------------------|
| 커널 취약점 악용 (Container Escape) | VM 내부 커널이 독립적이므로 호스트 커널에 영향 없음 | 공유 커널 취약점으로 호스트 탈출 가능 |
| 자원 고갈 공격 (Resource Exhaustion) | 하드웨어 수준에서 CPU/메모리 격리 | cgroup 우회 가능성 존재 |
| 네트워크 스니핑 | VM별 독립 네트워크 스택 | 같은 호스트 네트워크 네임스페이스 간 가시성 가능 |
| 사이드채널 공격 (Spectre/Meltdown) | VM 하이퍼바이저가 추가 방어 계층 제공 | 공유 커널에서 직접 노출 |

#### 트러블슈팅 가이드

**문제 1: Tart VM이 시작되지 않는 경우**

```bash
# VM 상태 확인
tart list
```

```text
Source  Name          Disk (GB)  Size (GB)  State    OS
local   dev-master    50         12.3       stopped  linux
```

대응 방법:
```bash
# VM 시작
tart run dev-master &

# 시작 실패 시 로그 확인
tart run dev-master 2>&1 | head -20
```

```text
Starting VM dev-master...
VM started successfully
```

**문제 2: VM SSH 접속 실패**

```bash
# VM IP 확인
tart ip dev-master
```

```text
192.168.64.4
```

```bash
# SSH 접속 테스트
ssh -o ConnectTimeout=5 admin@192.168.64.4 'echo ok'
```

```text
ok
```

접속 실패 시 원인 분석:
1. VM이 아직 부팅 중인 경우: `tart list`로 State가 `running`인지 확인한다.
2. 네트워크 미할당: VM 내부에서 DHCP가 완료되지 않은 경우이다. 30초 후 재시도한다.
3. SSH 데몬 미실행: VM 콘솔에서 `systemctl status sshd`를 확인한다.

#### 심화 검증: Virtualization.framework 격리 수준

```bash
# VM 내부에서 호스트 파일시스템 접근 시도 (실패해야 한다)
ssh admin@<dev-master-ip> 'ls /Volumes 2>&1'
```

```text
ls: cannot access '/Volumes': No such file or directory
```

VM 내부에서 호스트 파일시스템에 접근할 수 없다. 이는 Virtualization.framework가 파일시스템 수준의 격리를 제공하기 때문이다.

```bash
# VM 간 프로세스 격리 확인 — dev-master에서 dev-worker1의 프로세스를 볼 수 없어야 한다
ssh admin@<dev-master-ip> 'ps aux | grep worker1'
```

```text
admin     12345  0.0  0.0   6400   720 pts/0    S+   10:30   0:00 grep worker1
```

grep 자신만 보이고 worker1의 프로세스는 보이지 않는다. VM 간 프로세스 격리가 정상 동작하는 것이다.

---

### Lab 1.2: Cluster 레이어 — RBAC, NetworkPolicy, Admission Control

#### 학습 목표
- Cluster 레이어에서 적용되는 보안 메커니즘(RBAC, NetworkPolicy, Admission Controller)을 파악한다.
- tart-infra 클러스터에 적용된 보안 설정을 실제로 확인한다.
- 각 보안 메커니즘의 역할과 상호 보완 관계를 이해한다.

#### 실습 단계

**1단계: RBAC 활성화 확인**

```bash
# API Server의 authorization-mode 확인
ssh admin@<dev-master-ip> 'sudo cat /etc/kubernetes/manifests/kube-apiserver.yaml' | grep authorization-mode
```

예상 출력:
```
    - --authorization-mode=Node,RBAC
```

Node와 RBAC 두 가지 인가 모드가 활성화되어 있다. Node 인가는 kubelet의 API 요청을 제어하고, RBAC는 사용자와 서비스 계정의 접근을 제어한다.

**2단계: Admission Controller 확인**

```bash
ssh admin@<dev-master-ip> 'sudo cat /etc/kubernetes/manifests/kube-apiserver.yaml' | grep enable-admission
```

예상 출력:
```
    - --enable-admission-plugins=NodeRestriction
```

NodeRestriction Admission Controller는 kubelet이 자신의 Node 객체와 해당 Node에서 실행되는 Pod만 수정할 수 있도록 제한한다.

**3단계: NetworkPolicy 엔진 확인 — Cilium**

```bash
# Cilium Agent 상태 확인
kubectl get pods -n kube-system -l k8s-app=cilium
```

예상 출력:
```
NAME           READY   STATUS    RESTARTS   AGE
cilium-xxxxx   1/1     Running   0          XXd
cilium-yyyyy   1/1     Running   0          XXd
```

```bash
# Cilium 상태 상세 확인
kubectl exec -n kube-system $(kubectl get pod -n kube-system -l k8s-app=cilium -o name | head -1) -- cilium status --brief
```

예상 출력:
```
KVStore:                 Ok   Disabled
Kubernetes:              Ok   1.XX (vX.XX.X)
Kubernetes APIs:         ["cilium/v2::CiliumNetworkPolicy", ...]
KubeProxyReplacement:    ...
Cilium:                  Ok   ...
NodeMonitor:             Listening for events on ...
```

**4단계: CiliumNetworkPolicy 개수 확인**

```bash
kubectl get cnp -n demo --no-headers | wc -l
```

예상 출력:
```
11
```

11개의 CiliumNetworkPolicy가 demo 네임스페이스에 적용되어 있다.

**5단계: 클러스터 수준 보안 요소 종합 확인**

```bash
# 1) Namespace 목록 확인
kubectl get namespaces

# 2) ServiceAccount 확인
kubectl get sa -n demo

# 3) 클러스터 Role 개수 확인
kubectl get clusterrole --no-headers | wc -l

# 4) ClusterRoleBinding 개수 확인
kubectl get clusterrolebinding --no-headers | wc -l
```

**6단계: PodSecurityAdmission 레이블 확인**

```bash
kubectl get namespace demo -o yaml | grep -A 5 labels
```

예상 출력:
```yaml
  labels:
    kubernetes.io/metadata.name: demo
    istio-injection: enabled
```

현재 demo 네임스페이스에는 Pod Security Admission 레이블이 적용되어 있지 않다. 이는 실습 3.8에서 직접 설정해 볼 것이다.

#### 확인 문제
1. tart-infra 클러스터에서 사용 중인 인가(authorization) 모드 두 가지는 무엇인가?
2. NodeRestriction Admission Controller의 역할은 무엇인가?
3. Cilium이 기본 Kubernetes NetworkPolicy 대비 제공하는 추가 기능은 무엇인가?

#### 관련 KCSA 시험 주제
- Kubernetes RBAC
- Admission Controllers
- NetworkPolicy와 CNI 플러그인
- Cluster 레이어 보안 구성 요소

#### 등장 배경과 기존 한계점

Kubernetes 초기 버전(v1.0~v1.5)에서는 인가 메커니즘으로 ABAC(Attribute-Based Access Control)를 사용하였다. ABAC는 JSON 파일에 정책을 정의하고 API Server 재시작이 필요하여 운영 부담이 컸다. 정책 변경 시 다운타임이 발생하고, 정책 파일이 커지면 관리가 어려워졌다. RBAC는 Kubernetes 1.6에서 beta, 1.8에서 stable로 도입되어 이 문제를 해결하였다. RBAC는 Kubernetes API 오브젝트(Role, ClusterRole, RoleBinding, ClusterRoleBinding)로 정의되므로 `kubectl`로 동적 관리가 가능하고, API Server 재시작이 불필요하다.

NetworkPolicy의 경우, Kubernetes 초기에는 모든 Pod가 다른 모든 Pod와 무제한 통신 가능한 flat network 모델만 존재하였다. 이는 마이크로서비스 아키텍처에서 하나의 Pod 침해가 전체 클러스터 침해로 이어질 수 있는 심각한 보안 문제였다. NetworkPolicy는 Kubernetes 1.3에서 도입되어 Pod 수준의 네트워크 세그멘테이션을 가능하게 하였다. 그러나 표준 NetworkPolicy는 L3/L4(IP/포트) 수준만 지원하여, Cilium과 같은 CNI 플러그인이 L7(HTTP, DNS) 수준의 정책을 확장하였다.

#### 공격-방어 매핑

| 공격 벡터 | 방어 메커니즘 | tart-infra 적용 상태 |
|----------|-------------|---------------------|
| 무단 API 접근 | RBAC (Node,RBAC 모드) | 적용됨 |
| kubelet 무단 수정 | NodeRestriction Admission Controller | 적용됨 |
| Pod 간 무단 통신 | CiliumNetworkPolicy (11개) | 적용됨 |
| 위험한 Pod 설정 배포 | PSA (미설정 — Lab 3.8에서 실습) | 미적용 |

#### 트러블슈팅 가이드

**문제: RBAC 권한 거부(403 Forbidden) 디버깅**

```bash
# 현재 사용자의 권한 목록 확인
kubectl auth can-i --list -n demo 2>/dev/null | head -10
```

```text
Resources                                       Non-Resource URLs   Resource Names   Verbs
*.*                                             []                  []               [*]
                                                [*]                 []               [*]
```

```bash
# 특정 ServiceAccount의 권한 확인
kubectl auth can-i --list --as=system:serviceaccount:demo:default -n demo 2>/dev/null | head -10
```

```text
Resources                                       Non-Resource URLs   Resource Names   Verbs
selfsubjectaccessreviews.authorization.k8s.io   []                  []               [create]
selfsubjectrulesreviews.authorization.k8s.io    []                  []               [create]
```

**문제: CiliumNetworkPolicy가 적용되지 않는 경우**

```bash
# Cilium Agent 상태 확인
kubectl exec -n kube-system $(kubectl get pod -n kube-system -l k8s-app=cilium -o name | head -1) -- cilium status --brief 2>/dev/null
```

```text
KVStore:                 Ok   Disabled
Kubernetes:              Ok   1.30 (v1.30.2)
Kubernetes APIs:         ["cilium/v2::CiliumNetworkPolicy", ...]
Cilium:                  Ok   1.16.0
```

```bash
# 엔드포인트별 정책 적용 상태 확인
kubectl exec -n kube-system $(kubectl get pod -n kube-system -l k8s-app=cilium -o name | head -1) -- cilium endpoint list 2>/dev/null | head -10
```

```text
ENDPOINT   POLICY (ingress)   POLICY (egress)   IDENTITY   LABELS (source:key[=value])
1234       Enabled            Enabled           12345      k8s:app=nginx-web
```

Policy가 `Enabled`가 아닌 `Disabled`로 표시되면 정책이 적용되지 않은 것이다. `cilium policy get` 명령으로 로드된 정책을 확인한다.

---

### Lab 1.3: Container 레이어 — containerd 격리, securityContext

#### 등장 배경과 기존 한계점

컨테이너 격리 기술은 Linux 커널의 두 가지 핵심 기능에 기반한다:

1. **Namespaces (격리)**: 프로세스에게 독립된 시스템 뷰를 제공한다. PID namespace(프로세스 ID 격리), Network namespace(네트워크 스택 격리), Mount namespace(파일시스템 격리), UTS namespace(호스트네임 격리), IPC namespace(프로세스 간 통신 격리), User namespace(사용자 ID 격리)의 6가지가 있다.

2. **Cgroups (자원 제한)**: 프로세스 그룹의 CPU, 메모리, 디스크 I/O, 네트워크 대역폭을 제한한다. Kubernetes의 resources.requests/limits가 cgroup으로 구현된다.

컨테이너 런타임의 발전 과정:
- **Docker (2013~)**: 컨테이너 기술을 대중화했으나, Docker daemon이 root로 실행되어 보안 문제가 있었다.
- **containerd (2016~)**: Docker에서 분리된 산업 표준 컨테이너 런타임이다. CRI(Container Runtime Interface)를 지원하여 Kubernetes와 직접 연동된다.
- **CRI-O (2017~)**: Red Hat이 개발한 Kubernetes 전용 경량 런타임이다.

securityContext는 Pod/Container 수준에서 보안 설정을 지정하는 메커니즘이다. 주요 필드와 방어 효과:

| securityContext 필드 | 기본값 | 권장값 | 방어 효과 |
|---------------------|-------|--------|----------|
| `runAsNonRoot` | false | true | root 사용자로 실행 방지 |
| `runAsUser` | 0 (root) | 1000+ | 비특권 사용자로 실행 |
| `readOnlyRootFilesystem` | false | true | 파일시스템 변조 방지 (악성 바이너리 다운로드 차단) |
| `allowPrivilegeEscalation` | true | false | setuid 바이너리를 통한 권한 상승 차단 |
| `privileged` | false | false | 호스트 커널 기능 전체 접근 차단 |
| `capabilities.drop` | 없음 | ["ALL"] | 불필요한 Linux capabilities 제거 |

#### 공격-방어 매핑

| 공격 벡터 | securityContext 없이 | securityContext 강화 시 |
|----------|-------------------|---------------------|
| root 사용자로 시스템 파일 수정 | 가능 | runAsNonRoot: true로 차단 |
| setuid 바이너리로 권한 상승 | 가능 | allowPrivilegeEscalation: false로 차단 |
| 악성 바이너리 다운로드 후 실행 | 가능 | readOnlyRootFilesystem: true로 차단 |
| CAP_NET_RAW로 ARP 스푸핑 | 가능 | capabilities.drop: ALL로 차단 |
| 호스트 디바이스 접근 | 가능 (privileged 시) | privileged: false로 차단 |
| 리소스 고갈 (DoS) | 가능 (limits 없이) | resources.limits 설정으로 차단 |

#### 트러블슈팅 가이드

**문제: readOnlyRootFilesystem 설정 후 앱이 실행되지 않는 경우**

일부 앱은 `/tmp`, `/var/cache` 등에 임시 파일을 쓰기 때문에 readOnlyRootFilesystem과 호환되지 않는다.

해결 방법: 쓰기가 필요한 디렉토리에 emptyDir 볼륨을 마운트한다.

```yaml
# readOnlyRootFilesystem과 호환되는 설정 패턴
containers:
  - name: app
    securityContext:
      readOnlyRootFilesystem: true
    volumeMounts:
      - name: tmp
        mountPath: /tmp
      - name: cache
        mountPath: /var/cache
volumes:
  - name: tmp
    emptyDir: {}
  - name: cache
    emptyDir: {}
```

검증:
```bash
# 파일시스템 쓰기 테스트
kubectl exec -n demo <pod-name> -- touch /test-file 2>&1
```

```text
touch: /test-file: Read-only file system
```

```bash
# tmp 디렉토리 쓰기 테스트 (성공해야 한다)
kubectl exec -n demo <pod-name> -- touch /tmp/test-file 2>&1
echo $?
```

```text
0
```

**문제: capabilities 설정 확인**

```bash
# 컨테이너의 실제 capabilities 확인
kubectl exec -n demo $(kubectl get pod -n demo -l app=nginx-web -o name | head -1) -c nginx-web -- cat /proc/1/status | grep Cap
```

```text
CapInh: 00000000a80425fb
CapPrm: 00000000a80425fb
CapEff: 00000000a80425fb
CapBnd: 00000000a80425fb
CapAmb: 0000000000000000
```

이 16진수 값을 디코딩하여 어떤 capabilities가 활성화되어 있는지 확인할 수 있다.

```bash
# capabilities 디코딩 (capsh 명령이 있는 경우)
capsh --decode=00000000a80425fb 2>/dev/null
```

```text
0x00000000a80425fb=cap_chown,cap_dac_override,cap_fowner,cap_fsetid,cap_kill,cap_setgid,cap_setuid,cap_setpcap,cap_net_bind_service,cap_net_raw,cap_sys_chroot,cap_mknod,cap_audit_write,cap_setfcap
```

`cap_net_raw`가 활성화되어 있으면 ARP 스푸핑이 가능하다. `capabilities.drop: ["ALL"]`로 모든 capabilities를 제거하고, 필요한 것만 `capabilities.add`로 추가하는 것이 권장된다.

#### 학습 목표
- 컨테이너 런타임(containerd)이 제공하는 격리 메커니즘을 이해한다.
- Pod의 securityContext 설정을 분석하여 컨테이너 보안 수준을 평가한다.
- Linux namespace와 cgroup이 컨테이너 격리에 어떻게 기여하는지 파악한다.

#### 실습 단계

**1단계: 컨테이너 런타임 확인**

```bash
ssh admin@<dev-master-ip> 'sudo crictl version'
```

예상 출력:
```
Version:  0.1.0
RuntimeName:  containerd
RuntimeVersion:  v1.7.x
RuntimeApiVersion:  v1
```

**2단계: containerd 설정 확인**

```bash
ssh admin@<dev-master-ip> 'sudo cat /etc/containerd/config.toml | head -30'
```

containerd의 기본 런타임과 보안 관련 설정을 확인한다.

**3단계: demo 앱 Pod의 securityContext 분석**

```bash
# nginx Pod의 securityContext 확인
kubectl get pod -n demo -l app=nginx-web -o jsonpath='{.items[0].spec.containers[0].securityContext}' | python3 -m json.tool
```

```bash
# httpbin Pod의 securityContext 확인
kubectl get pod -n demo -l app=httpbin -o jsonpath='{.items[0].spec.containers[0].securityContext}' | python3 -m json.tool
```

```bash
# keycloak Pod의 securityContext 확인
kubectl get pod -n demo -l app=keycloak -o jsonpath='{.items[0].spec.containers[0].securityContext}' | python3 -m json.tool
```

```bash
# postgres Pod의 securityContext 확인
kubectl get pod -n demo -l app=postgres -o jsonpath='{.items[0].spec.containers[0].securityContext}' | python3 -m json.tool
```

```bash
# redis Pod의 securityContext 확인
kubectl get pod -n demo -l app=redis -o jsonpath='{.items[0].spec.containers[0].securityContext}' | python3 -m json.tool
```

```bash
# rabbitmq Pod의 securityContext 확인
kubectl get pod -n demo -l app=rabbitmq -o jsonpath='{.items[0].spec.containers[0].securityContext}' | python3 -m json.tool
```

**4단계: 전체 Pod securityContext 종합 분석**

```bash
# 모든 demo Pod에서 runAsNonRoot, readOnlyRootFilesystem, allowPrivilegeEscalation 확인
for app in nginx-web httpbin redis postgres rabbitmq keycloak; do
  echo "=== $app ==="
  kubectl get pod -n demo -l app=$app -o jsonpath='{.items[0].spec.containers[0].securityContext}' 2>/dev/null
  echo ""
done
```

**5단계: 컨테이너 내부에서 Linux namespace 확인**

```bash
# nginx Pod에 진입하여 프로세스 격리 확인
kubectl exec -n demo $(kubectl get pod -n demo -l app=nginx-web -o name | head -1) -c nginx-web -- cat /proc/1/status | grep -E "^(Name|Pid|NSpid|NStgid)"
```

예상 출력:
```
Name:   nginx
Pid:    1
NSpid:  1       12345
NStgid: 1       12345
```

컨테이너 내부에서는 PID 1로 보이지만, 호스트에서는 다른 PID를 가진다. 이것이 PID namespace 격리이다.

**6단계: 컨테이너 리소스 제한 확인**

```bash
# 각 Pod의 resource limits/requests 확인
kubectl get pod -n demo -o custom-columns='NAME:.metadata.name,CPU_REQ:.spec.containers[0].resources.requests.cpu,CPU_LIM:.spec.containers[0].resources.limits.cpu,MEM_REQ:.spec.containers[0].resources.requests.memory,MEM_LIM:.spec.containers[0].resources.limits.memory'
```

리소스 제한이 설정되어 있지 않은 Pod는 DoS 공격에 취약할 수 있다. 이는 KCSA 시험에서 자주 출제되는 보안 이슈이다.

**7단계: 컨테이너 권한 수준 확인**

```bash
# privileged 모드로 실행 중인 컨테이너가 있는지 확인
kubectl get pods -n demo -o jsonpath='{range .items[*]}{.metadata.name}{" privileged="}{.spec.containers[0].securityContext.privileged}{"\n"}{end}'
```

privileged 컨테이너는 호스트의 모든 장치와 커널 기능에 접근할 수 있으므로, 프로덕션 환경에서는 절대 사용해서는 안 된다.

#### 확인 문제
1. containerd가 컨테이너 격리를 위해 사용하는 Linux 커널 기능 두 가지는 무엇인가?
2. `runAsNonRoot: true` 설정의 보안적 의의는 무엇인가?
3. `readOnlyRootFilesystem: true`가 방어하는 공격 유형은 무엇인가?
4. privileged 컨테이너가 위험한 이유를 설명하라.

#### 관련 KCSA 시험 주제
- Container 격리 메커니즘 (namespace, cgroup)
- SecurityContext 설정
- 컨테이너 런타임 보안
- 최소 권한 원칙 (Principle of Least Privilege)

---

### Lab 1.4: Code 레이어 — 앱별 환경 변수 보안 분석

#### 등장 배경과 기존 한계점

4C 모델에서 Code 레이어는 가장 안쪽 계층으로, 애플리케이션 코드 자체의 보안을 다룬다. Code 레이어 보안은 다음 영역을 포함한다:

1. **민감 정보 관리**: 비밀번호, API 키, 인증서 등을 안전하게 저장하고 사용하는 방법
2. **의존성 보안**: 사용 중인 라이브러리/패키지의 취약점 관리 (SBOM, SCA)
3. **입력 검증**: SQL Injection, XSS 등 애플리케이션 레벨 공격 방어
4. **안전한 통신**: TLS/mTLS를 통한 서비스 간 암호화
5. **시크릿 하드코딩 방지**: 소스 코드에 비밀번호를 직접 작성하지 않는 것

Code 레이어 보안의 핵심 원칙: "아무리 강력한 인프라 보안(Cloud, Cluster, Container)을 적용해도, 코드에 SQL Injection 취약점이 있거나 비밀번호가 하드코딩되어 있으면 보안이 무의미하다." 이것이 4C 모델이 모든 계층의 독립적 보안을 요구하는 이유이다.

환경 변수에 민감 정보를 직접 저장하는 것의 위험성:
1. `kubectl describe pod`로 모든 환경 변수를 볼 수 있다.
2. Pod 내부에서 `/proc/1/environ`으로 환경 변수를 읽을 수 있다.
3. 로그에 환경 변수가 출력될 수 있다(예: debug 로그의 전체 환경 덤프).
4. Audit 로그에 Pod 생성 요청의 본문(환경 변수 포함)이 기록될 수 있다.
5. Git 리포지토리에 Deployment YAML이 커밋되면 비밀번호가 영구적으로 기록된다.

#### 공격-방어 매핑

| 공격 벡터 | 환경 변수 직접 저장 시 | Secret 사용 시 | Secret + Vault 사용 시 |
|----------|------------------|-------------|---------------------|
| kubectl describe pod | 평문 비밀번호 노출 | Secret 참조만 표시 | Secret 참조만 표시 |
| Git 히스토리 검색 | YAML에 평문 포함 | Secret YAML에 base64 | Git에 비밀 미저장 |
| Pod 침투 후 환경 변수 읽기 | /proc/1/environ에서 읽기 | /proc/1/environ에서 읽기 | Volume 마운트 시 파일 권한으로 보호 |
| RBAC 제어 | ConfigMap과 동일한 접근 제어 | Secret 별도 RBAC 가능 | Secret 별도 RBAC + Vault ACL |
| 비밀번호 로테이션 | 수동 Deployment 업데이트 필요 | 수동 Secret 업데이트 | ESO로 자동 동기화 |

#### 학습 목표
- Code 레이어에서의 보안 요소(환경 변수, 민감 정보 관리)를 분석한다.
- 각 데모 앱의 환경 변수에 민감 정보가 노출되어 있는지 확인한다.
- Secret을 통한 민감 정보 관리와 직접 환경 변수 지정의 차이를 이해한다.

#### 실습 단계

**1단계: 각 앱의 환경 변수 확인**

```bash
# postgres 환경 변수 확인 — 비밀번호가 포함되어 있다
kubectl get pod -n demo -l app=postgres -o jsonpath='{.items[0].spec.containers[0].env}' | python3 -m json.tool
```

예상 출력 (일부):
```json
[
    {
        "name": "POSTGRES_PASSWORD",
        "value": "demo123"
    },
    {
        "name": "POSTGRES_DB",
        "value": "keycloak"
    }
]
```

> **보안 경고**: 비밀번호가 환경 변수에 평문으로 저장되어 있다. 프로덕션 환경에서는 반드시 Kubernetes Secret을 사용해야 한다.

```bash
# rabbitmq 환경 변수 확인
kubectl get pod -n demo -l app=rabbitmq -o jsonpath='{.items[0].spec.containers[0].env}' | python3 -m json.tool
```

예상 출력 (일부):
```json
[
    {
        "name": "RABBITMQ_DEFAULT_USER",
        "value": "demo"
    },
    {
        "name": "RABBITMQ_DEFAULT_PASS",
        "value": "demo123"
    }
]
```

```bash
# keycloak 환경 변수 확인
kubectl get pod -n demo -l app=keycloak -o jsonpath='{.items[0].spec.containers[0].env}' | python3 -m json.tool
```

예상 출력 (일부):
```json
[
    {
        "name": "KEYCLOAK_ADMIN",
        "value": "admin"
    },
    {
        "name": "KEYCLOAK_ADMIN_PASSWORD",
        "value": "admin"
    },
    {
        "name": "KC_DB_PASSWORD",
        "value": "demo123"
    }
]
```

**2단계: 환경 변수에서 민감 정보 검색**

```bash
# 모든 demo Pod의 환경 변수에서 비밀번호 관련 항목 검색
for app in nginx-web httpbin redis postgres rabbitmq keycloak; do
  echo "=== $app ==="
  kubectl get pod -n demo -l app=$app -o jsonpath='{.items[0].spec.containers[0].env[*].name}' 2>/dev/null
  echo ""
done
```

**3단계: Secret 사용 여부 확인**

```bash
# 환경 변수가 Secret을 참조하는지 확인
kubectl get pod -n demo -l app=postgres -o jsonpath='{.items[0].spec.containers[0].env[*].valueFrom}' | python3 -m json.tool 2>/dev/null || echo "Secret 참조 없음 — 평문 값 사용 중"
```

**4단계: 보안 개선 방안 분석**

현재 demo 앱의 Code 레이어 보안 현황을 정리하면 다음과 같다.

| 앱 | 민감 정보 | 저장 방식 | 보안 수준 | 개선 필요 |
|-----|-----------|-----------|-----------|-----------|
| postgres | POSTGRES_PASSWORD=demo123 | 평문 env | 낮음 | Secret 사용 필요 |
| rabbitmq | RABBITMQ_DEFAULT_PASS=demo123 | 평문 env | 낮음 | Secret 사용 필요 |
| keycloak | KEYCLOAK_ADMIN_PASSWORD=admin | 평문 env | 낮음 | Secret 사용 필요 |
| keycloak | KC_DB_PASSWORD=demo123 | 평문 env | 낮음 | Secret 사용 필요 |
| nginx | - | - | 해당없음 | - |
| httpbin | - | - | 해당없음 | - |
| redis | - | - | 중간 | 인증 설정 필요 |

**5단계: Keycloak 프로브 설정 확인 (Code 레이어 건강성 관리)**

```bash
# Keycloak의 readinessProbe와 livenessProbe 확인
kubectl get pod -n demo -l app=keycloak -o jsonpath='{.items[0].spec.containers[0].readinessProbe}' | python3 -m json.tool
```

예상 출력:
```json
{
    "httpGet": {
        "path": "/health/ready",
        "port": 8080
    }
}
```

```bash
kubectl get pod -n demo -l app=keycloak -o jsonpath='{.items[0].spec.containers[0].livenessProbe}' | python3 -m json.tool
```

예상 출력:
```json
{
    "httpGet": {
        "path": "/health/live",
        "port": 8080
    }
}
```

프로브 설정은 애플리케이션의 가용성을 보장하는 Code 레이어 보안의 일부이다. 잘못된 프로브 설정은 서비스 장애로 이어질 수 있다.

#### 확인 문제
1. 환경 변수에 비밀번호를 평문으로 저장하는 것의 위험성은 무엇인가?
2. Kubernetes Secret을 사용하면 환경 변수 대비 어떤 보안 이점이 있는가?
3. Code 레이어에서의 보안은 다른 3개 레이어(Cloud, Cluster, Container)와 어떻게 상호 보완되는가?
4. readiness/liveness 프로브가 보안에 미치는 영향은 무엇인가?

#### 관련 KCSA 시험 주제
- 4C 모델의 Code 레이어
- 민감 정보 관리 (Secrets Management)
- 애플리케이션 보안 모범 사례
- Supply Chain Security (코드/설정 수준)

---

## 실습 2: Cluster Component Security (22%)

Kubernetes 클러스터의 핵심 구성 요소(API Server, etcd, kubelet, CoreDNS)의 보안 설정을 분석한다. KCSA 시험에서 22%를 차지하는 가장 비중이 높은 영역 중 하나이다.

---

### Lab 2.1: API Server 보안 설정 분석

#### 등장 배경과 기존 한계점

kube-apiserver는 Kubernetes 클러스터의 유일한 진입점(single entry point)이다. 모든 컴포넌트(kubectl, kubelet, controller-manager, scheduler, 외부 시스템)가 API Server를 통해 클러스터와 상호작용한다. 이 중앙 집중형 설계는 보안 관점에서 장단점이 명확하다.

장점: 단일 지점에서 인증, 인가, 감사를 통합 관리할 수 있다. 방화벽 규칙을 API Server 포트(6443)에만 집중할 수 있다.
단점: API Server가 침해되면 전체 클러스터가 침해된다. 이를 "Single Point of Failure"라 한다. 따라서 API Server의 보안 설정은 클러스터 보안에서 가장 중요한 요소이다.

초기 Kubernetes에서는 `--insecure-port=8080` 플래그로 인증 없는 HTTP 포트를 열어 개발 편의를 제공하였다. 이 포트는 인증과 인가를 모두 우회하므로 극도로 위험했다. Kubernetes 1.20에서 deprecated, 1.24에서 완전히 제거되었다. 또한 초기에는 `--authorization-mode=AlwaysAllow`가 기본값이어서 모든 인증된 요청이 허가되었다. 현재는 RBAC가 사실상 표준이다.

#### 공격-방어 매핑

| 공격 벡터 | API Server 플래그 | 방어 효과 |
|----------|-----------------|----------|
| 미인증 API 접근 | `--anonymous-auth=false` | 인증되지 않은 요청 차단 |
| 권한 없는 리소스 접근 | `--authorization-mode=Node,RBAC` | 역할 기반 접근 제어 |
| kubelet의 다른 노드 데이터 접근 | `--enable-admission-plugins=NodeRestriction` | 노드 간 접근 격리 |
| TLS 미적용 통신 도청 | `--tls-cert-file`, `--tls-private-key-file` | 전송 중 데이터 암호화 |
| Secret 접근 추적 불가 | `--audit-policy-file`, `--audit-log-path` | 감사 로그 기록 |

#### 트러블슈팅 가이드

**문제: API Server 응답 없음 진단**

```bash
# Static Pod 매니페스트 문법 확인
ssh admin@<dev-master-ip> 'sudo python3 -c "import yaml; yaml.safe_load(open(\"/etc/kubernetes/manifests/kube-apiserver.yaml\"))" 2>&1'
```

```text
# 정상 시: 출력 없음
# 오류 시: yaml.scanner.ScannerError: ... 에러 메시지 출력
```

```bash
# API Server 컨테이너 로그 확인
ssh admin@<dev-master-ip> 'sudo crictl logs $(sudo crictl ps --name kube-apiserver -q 2>/dev/null) 2>&1 | tail -10'
```

```text
I0115 10:30:00.000000       1 server.go:155] Version: v1.30.2
I0115 10:30:00.100000       1 secure_serving.go:210] Serving securely on [::]:6443
```

**문제: `--anonymous-auth=true` 상태에서의 보안 확인**

```bash
# anonymous-auth가 true여도 RBAC가 접근을 제한하는지 확인
curl -k https://<dev-master-ip>:6443/api/v1/namespaces --max-time 5 2>/dev/null | python3 -m json.tool 2>/dev/null | head -10
```

```text
{
    "kind": "Status",
    "apiVersion": "v1",
    "metadata": {},
    "status": "Failure",
    "message": "namespaces is forbidden: User \"system:anonymous\" cannot list resource \"namespaces\"...",
    "reason": "Forbidden",
    "code": 403
}
```

RBAC가 활성화되어 있으면 `system:anonymous` 사용자의 접근이 403으로 거부된다. 그러나 `anonymous-auth=false`로 설정하면 인증 자체가 실패하여 401이 반환되므로 보안이 더 강화된다.

#### 학습 목표
- kube-apiserver의 주요 보안 플래그를 파악하고 각각의 역할을 설명할 수 있다.
- authorization-mode, admission-plugins, anonymous-auth 설정의 보안적 의미를 이해한다.
- API Server가 클러스터 보안의 중심인 이유를 설명할 수 있다.

#### 실습 단계

**1단계: kube-apiserver Static Pod 매니페스트 전체 확인**

```bash
ssh admin@<dev-master-ip> 'sudo cat /etc/kubernetes/manifests/kube-apiserver.yaml'
```

이 파일은 Static Pod으로 관리되는 API Server의 전체 설정을 포함하고 있다.

**2단계: 인가(Authorization) 모드 확인**

```bash
ssh admin@<dev-master-ip> 'sudo cat /etc/kubernetes/manifests/kube-apiserver.yaml' | grep authorization-mode
```

예상 출력:
```
    - --authorization-mode=Node,RBAC
```

- **Node**: kubelet이 자신의 Node에 할당된 Pod 정보만 읽을 수 있도록 제한한다.
- **RBAC**: Role-Based Access Control로, 역할 기반의 세밀한 접근 제어를 제공한다.

> **보안 참고**: `AlwaysAllow`가 설정되어 있다면 모든 요청이 허가되므로 매우 위험하다. 프로덕션에서는 반드시 RBAC를 사용해야 한다.

**3단계: Admission Controller 확인**

```bash
ssh admin@<dev-master-ip> 'sudo cat /etc/kubernetes/manifests/kube-apiserver.yaml' | grep enable-admission
```

예상 출력:
```
    - --enable-admission-plugins=NodeRestriction
```

NodeRestriction Admission Controller의 역할:
- kubelet이 자신의 Node 레이블 중 `node-restriction.kubernetes.io/` 접두사가 있는 레이블만 수정할 수 있도록 제한한다.
- kubelet이 다른 Node의 객체를 수정하는 것을 방지한다.

**4단계: 익명 인증(Anonymous Auth) 확인**

```bash
ssh admin@<dev-master-ip> 'sudo cat /etc/kubernetes/manifests/kube-apiserver.yaml' | grep anonymous-auth
```

예상 출력:
```
    - --anonymous-auth=true
```

또는 해당 플래그가 없을 수 있다 (기본값은 true이다).

> **보안 참고**: `anonymous-auth=true`는 인증되지 않은 요청을 `system:anonymous` 사용자로 처리한다. 단, RBAC에 의해 접근 권한이 제한되므로 즉각적인 위험은 아니지만, 프로덕션에서는 `false`로 설정하는 것이 권장된다.

**5단계: API Server 인증 설정 확인**

```bash
ssh admin@<dev-master-ip> 'sudo cat /etc/kubernetes/manifests/kube-apiserver.yaml' | grep -E "client-ca-file|service-account-key|service-account-issuer|token-auth"
```

예상 출력:
```
    - --client-ca-file=/etc/kubernetes/pki/ca.crt
    - --service-account-key-file=/etc/kubernetes/pki/sa.pub
    - --service-account-issuer=https://kubernetes.default.svc.cluster.local
```

- `client-ca-file`: 클라이언트 인증서를 검증하는 CA 인증서이다.
- `service-account-key-file`: ServiceAccount 토큰 서명을 검증하는 공개키이다.

**6단계: API Server TLS 설정 확인**

```bash
ssh admin@<dev-master-ip> 'sudo cat /etc/kubernetes/manifests/kube-apiserver.yaml' | grep -E "tls-cert-file|tls-private-key"
```

예상 출력:
```
    - --tls-cert-file=/etc/kubernetes/pki/apiserver.crt
    - --tls-private-key-file=/etc/kubernetes/pki/apiserver-key.pem
```

**7단계: Audit 로깅 설정 확인**

```bash
ssh admin@<dev-master-ip> 'sudo cat /etc/kubernetes/manifests/kube-apiserver.yaml' | grep -E "audit-policy|audit-log"
```

audit 관련 설정이 없다면, API Server의 감사 로깅이 비활성화되어 있는 것이다. 이는 실습 6.2에서 직접 설정해 볼 것이다.

**8단계: API Server 접근 테스트**

```bash
# 인증 없이 API Server에 접근 시도
curl -k https://<dev-master-ip>:6443/api/v1/namespaces --max-time 5
```

예상 출력:
```json
{
  "kind": "Status",
  "apiVersion": "v1",
  "status": "Failure",
  "message": "namespaces is forbidden: User \"system:anonymous\" cannot list resource \"namespaces\" ...",
  "reason": "Forbidden",
  "code": 403
}
```

anonymous-auth가 true여도, RBAC가 접근을 차단하는 것을 확인할 수 있다.

#### 확인 문제
1. `--authorization-mode=Node,RBAC`에서 Node 인가 모드의 역할은 무엇인가?
2. `anonymous-auth=true`일 때 API Server는 인증되지 않은 요청을 어떻게 처리하는가?
3. NodeRestriction Admission Controller가 없다면 어떤 보안 위험이 발생하는가?
4. API Server의 audit 로깅이 비활성화되어 있을 때의 문제점은 무엇인가?
5. `--tls-cert-file`과 `--client-ca-file`의 차이는 무엇인가?

#### 관련 KCSA 시험 주제
- API Server 보안 구성
- 인증(Authentication)과 인가(Authorization)
- Admission Controllers
- Audit Logging

#### 등장 배경과 기존 한계점

kube-apiserver는 Kubernetes 클러스터의 유일한 진입점(single entry point)이다. 모든 컴포넌트(kubectl, kubelet, controller-manager, scheduler, 외부 시스템)가 API Server를 통해 클러스터와 상호작용한다. 이 중앙 집중형 설계는 보안 관점에서 장단점이 명확하다.

장점: 단일 지점에서 인증, 인가, 감사를 통합 관리할 수 있다. 방화벽 규칙을 API Server 포트(6443)에만 집중할 수 있다.
단점: API Server가 침해되면 전체 클러스터가 침해된다. 이를 "Single Point of Failure"라 한다. 따라서 API Server의 보안 설정은 클러스터 보안에서 가장 중요한 요소이다.

초기 Kubernetes에서는 `--insecure-port=8080` 플래그로 인증 없는 HTTP 포트를 열어 개발 편의를 제공하였다. 이 포트는 인증과 인가를 모두 우회하므로 극도로 위험했다. Kubernetes 1.20에서 deprecated, 1.24에서 완전히 제거되었다.

#### 공격-방어 매핑

| 공격 벡터 | API Server 플래그 | 방어 효과 |
|----------|-----------------|----------|
| 미인증 API 접근 | `--anonymous-auth=false` | 인증되지 않은 요청 차단 |
| 권한 없는 리소스 접근 | `--authorization-mode=Node,RBAC` | 역할 기반 접근 제어 |
| kubelet의 다른 노드 데이터 접근 | `--enable-admission-plugins=NodeRestriction` | 노드 간 접근 격리 |
| TLS 미적용 통신 도청 | `--tls-cert-file`, `--tls-private-key-file` | 전송 중 데이터 암호화 |
| Secret 접근 추적 불가 | `--audit-policy-file`, `--audit-log-path` | 감사 로그 기록 |
| etcd 평문 저장 | `--encryption-provider-config` | 저장 시 데이터 암호화 |

#### 트러블슈팅 가이드

**문제: API Server 인증서 만료로 접근 불가**

```bash
# 인증서 만료일 확인
ssh admin@<dev-master-ip> 'sudo openssl x509 -in /etc/kubernetes/pki/apiserver.crt -noout -dates'
```

```text
notBefore=Jan 15 10:00:00 2024 GMT
notAfter=Jan 15 10:00:00 2025 GMT
```

만료된 경우:
```bash
ssh admin@<dev-master-ip> 'sudo kubeadm certs renew apiserver'
```

```text
[renew] Reading configuration from the cluster...
[renew] Creating new CSR for the apiserver serving cert and key
certificate for serving the Kubernetes API renewed
```

갱신 후 API Server가 새 인증서를 로드하도록 Static Pod가 자동 재시작된다.

---

### Lab 2.2: etcd 보안 확인 (인증서 경로, 접근 제한)

#### 등장 배경과 기존 한계점

etcd는 CoreOS(현 Red Hat)가 개발한 분산 키-값 저장소이다. Kubernetes는 etcd를 유일한 데이터 저장소로 사용하며, 클러스터의 모든 상태(Pod, Service, Secret, ConfigMap, RBAC 설정 등)가 etcd에 저장된다. 이는 etcd가 Kubernetes 보안의 최후 방어선임을 의미한다.

etcd 보안이 중요해진 배경은 다음과 같다. 초기 Kubernetes 배포에서는 etcd를 TLS 없이 운영하거나, API Server와 동일한 노드에서 localhost로만 접근하는 방식이 일반적이었다. 그러나 etcd에 직접 접근할 수 있는 공격자는 API Server의 인증/인가를 완전히 우회하여 모든 데이터를 읽고 수정할 수 있다. 특히 Secret은 etcd에 base64 인코딩(암호화 아님)으로 저장되므로, etcd 접근은 곧 모든 Secret 탈취를 의미한다.

이 위험에 대응하기 위해 다음 보안 메커니즘이 도입되었다:
1. etcd TLS(서버/클라이언트/피어): 통신 암호화 및 상호 인증
2. Encryption at Rest(EncryptionConfiguration): etcd 저장 데이터 암호화
3. KMS v2: 외부 키 관리 서비스와 연동한 봉투 암호화(Envelope Encryption)

#### 공격-방어 매핑

| 공격 벡터 | 공격 설명 | 방어 메커니즘 | tart-infra 상태 |
|----------|---------|-------------|----------------|
| 네트워크 도청 | etcd 통신을 스니핑하여 데이터 탈취 | TLS 암호화 (cert-file, key-file) | 적용됨 |
| 중간자 공격 (MITM) | 가짜 etcd 서버/클라이언트로 통신 가로채기 | 상호 TLS 인증 (trusted-ca-file) | 적용됨 |
| etcd 데이터 직접 읽기 | etcd 파일시스템 또는 API 직접 접근 | Encryption at Rest | 미적용 (확인 필요) |
| 피어 노드 위장 | 가짜 etcd 멤버를 클러스터에 추가 | 피어 TLS (peer-cert-file) | 적용됨 |
| 개인키 탈취 | 파일시스템에서 .key 파일 읽기 | 파일 권한 600 (소유자만 읽기) | 확인 필요 |

#### 트러블슈팅 가이드

**문제 1: etcd 클러스터 상태 확인**

```bash
ssh admin@<dev-master-ip> 'sudo ETCDCTL_API=3 etcdctl \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/healthcheck-client.crt \
  --key=/etc/kubernetes/pki/etcd/healthcheck-client.key \
  endpoint health'
```

```text
https://127.0.0.1:2379 is healthy: successfully committed proposal: took = 2.5ms
```

**문제 2: etcd TLS 인증서 불일치**

```bash
# 인증서의 CN(Common Name) 확인
ssh admin@<dev-master-ip> 'sudo openssl x509 -in /etc/kubernetes/pki/etcd/server.crt -noout -subject'
```

```text
subject=CN = dev-master
```

```bash
# 인증서의 SAN 확인
ssh admin@<dev-master-ip> 'sudo openssl x509 -in /etc/kubernetes/pki/etcd/server.crt -noout -text' | grep -A1 "Subject Alternative Name"
```

```text
            X509v3 Subject Alternative Name:
                DNS:dev-master, DNS:localhost, IP Address:192.168.64.4, IP Address:127.0.0.1
```

listen-client-urls의 IP가 SAN에 포함되어 있지 않으면 TLS 핸드셰이크가 실패한다. 이 경우 인증서를 재발급해야 한다.

#### 학습 목표
- etcd가 Kubernetes에서 수행하는 역할과 보안 중요성을 이해한다.
- etcd의 TLS 인증서 설정을 확인하고 분석한다.
- etcd에 대한 접근 제한이 적절히 설정되어 있는지 검증한다.

#### 실습 단계

**1단계: etcd Static Pod 매니페스트 확인**

```bash
ssh admin@<dev-master-ip> 'sudo cat /etc/kubernetes/manifests/etcd.yaml'
```

**2단계: etcd TLS 인증서 설정 확인**

```bash
ssh admin@<dev-master-ip> 'sudo cat /etc/kubernetes/manifests/etcd.yaml' | grep -E "cert-file|key-file|trusted-ca"
```

예상 출력:
```
    - --cert-file=/etc/kubernetes/pki/etcd/server.crt
    - --key-file=/etc/kubernetes/pki/etcd/server.key
    - --peer-cert-file=/etc/kubernetes/pki/etcd/peer.crt
    - --peer-key-file=/etc/kubernetes/pki/etcd/peer.key
    - --peer-trusted-ca-file=/etc/kubernetes/pki/etcd/ca.crt
    - --trusted-ca-file=/etc/kubernetes/pki/etcd/ca.crt
```

각 설정의 의미:
- `cert-file` / `key-file`: etcd 서버의 TLS 인증서와 개인키이다. 클라이언트(API Server)가 etcd에 접속할 때 서버 인증에 사용된다.
- `peer-cert-file` / `peer-key-file`: etcd 클러스터 노드 간 통신에 사용되는 인증서이다.
- `trusted-ca-file`: 클라이언트 인증서를 검증하는 CA이다.
- `peer-trusted-ca-file`: 피어 노드 인증서를 검증하는 CA이다.

**3단계: etcd 클라이언트 URL 확인**

```bash
ssh admin@<dev-master-ip> 'sudo cat /etc/kubernetes/manifests/etcd.yaml' | grep -E "listen-client|advertise-client"
```

예상 출력:
```
    - --listen-client-urls=https://127.0.0.1:2379,https://<dev-master-ip>:2379
    - --advertise-client-urls=https://<dev-master-ip>:2379
```

`listen-client-urls`에 `https://`가 사용되고 있어 모든 클라이언트 통신이 TLS로 암호화된다.

**4단계: API Server → etcd 접속 인증서 확인**

```bash
ssh admin@<dev-master-ip> 'sudo cat /etc/kubernetes/manifests/kube-apiserver.yaml' | grep etcd
```

예상 출력:
```
    - --etcd-servers=https://127.0.0.1:2379
    - --etcd-cafile=/etc/kubernetes/pki/etcd/ca.crt
    - --etcd-certfile=/etc/kubernetes/pki/apiserver-etcd-client.crt
    - --etcd-keyfile=/etc/kubernetes/pki/apiserver-etcd-client.key
```

API Server는 전용 클라이언트 인증서(`apiserver-etcd-client.crt`)를 사용하여 etcd에 접근한다.

**5단계: etcd 인증서 파일 존재 확인**

```bash
ssh admin@<dev-master-ip> 'sudo ls -la /etc/kubernetes/pki/etcd/'
```

예상 출력:
```
total XX
drwxr-xr-x 2 root root ... .
drwxr-xr-x 3 root root ... ..
-rw-r--r-- 1 root root ... ca.crt
-rw------- 1 root root ... ca.key
-rw-r--r-- 1 root root ... healthcheck-client.crt
-rw------- 1 root root ... healthcheck-client.key
-rw-r--r-- 1 root root ... peer.crt
-rw------- 1 root root ... peer.key
-rw-r--r-- 1 root root ... server.crt
-rw------- 1 root root ... server.key
```

> **보안 점검**: `.key` 파일의 권한이 `600`(소유자만 읽기/쓰기)인지 확인한다. 다른 사용자가 읽을 수 있다면 보안 위험이다.

**6단계: etcd 데이터 암호화(Encryption at Rest) 확인**

```bash
ssh admin@<dev-master-ip> 'sudo cat /etc/kubernetes/manifests/kube-apiserver.yaml' | grep encryption-provider
```

해당 플래그가 없다면, etcd에 저장된 Secret 등의 민감 데이터가 암호화되지 않은 상태(평문)로 저장되어 있는 것이다.

**7단계: etcd 데이터 직접 확인 (보안 위험 시연)**

```bash
# etcd에서 Secret 데이터를 직접 조회 (인증서 필요)
ssh admin@<dev-master-ip> 'sudo ETCDCTL_API=3 etcdctl \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/healthcheck-client.crt \
  --key=/etc/kubernetes/pki/etcd/healthcheck-client.key \
  get /registry/secrets/demo --prefix --keys-only' 2>/dev/null | head -10
```

etcd에 접근할 수 있으면 모든 Kubernetes 데이터(Secret 포함)를 읽을 수 있다. 이것이 etcd 보안이 중요한 이유이다.

#### 확인 문제
1. etcd에 TLS가 적용되지 않으면 어떤 공격이 가능한가?
2. `peer-cert-file`과 `cert-file`의 차이는 무엇인가?
3. Encryption at Rest가 비활성화된 상태에서 etcd에 접근 가능한 공격자는 무엇을 할 수 있는가?
4. etcd의 개인키 파일 권한이 `644`로 설정되어 있다면 어떤 보안 문제가 있는가?

#### 관련 KCSA 시험 주제
- etcd 보안 (TLS, encryption at rest)
- PKI 인증서 관리
- 데이터 보호 (Data Protection)

---

### Lab 2.3: kubelet 보안 설정 (config.yaml)

#### 등장 배경과 기존 한계점

kubelet은 각 노드에서 실행되는 에이전트로, Pod의 생명주기를 관리한다. kubelet은 API Server와 통신하여 Pod 스펙을 수신하고, 컨테이너 런타임(containerd)을 통해 컨테이너를 실행한다.

kubelet 보안이 중요한 이유: kubelet은 노드에서 root 권한으로 실행되며, 해당 노드의 모든 Pod에 대한 제어 권한을 가진다. kubelet API(10250 포트)에 접근할 수 있는 공격자는 다음을 수행할 수 있다:
1. 노드에서 실행 중인 모든 Pod의 로그 읽기
2. Pod 내부에서 명령 실행(exec)
3. Pod의 환경 변수(비밀번호 포함) 읽기
4. 노드의 리소스 사용량 정보 수집

kubelet 보안의 발전 과정:
- **초기**: `--anonymous-auth=true`, `--authorization-mode=AlwaysAllow`가 기본값이었다. kubelet API에 인증/인가 없이 접근 가능했다.
- **Kubernetes 1.5+**: `--authorization-mode=Webhook`이 도입되어 API Server에 인가를 위임할 수 있게 되었다.
- **Kubernetes 1.8+**: `--anonymous-auth=false`가 권장 설정이 되었다.
- **Kubernetes 1.13+**: kubelet TLS bootstrapping이 기본 활성화되어 인증서 자동 발급/갱신이 가능해졌다.
- **현재**: CIS Benchmark는 anonymous 인증 비활성화, Webhook 인가, readOnlyPort 비활성화를 필수로 요구한다.

#### 공격-방어 매핑

| 공격 벡터 | kubelet 설정 | 방어 효과 |
|----------|------------|----------|
| kubelet API 무단 접근 | `authentication.anonymous.enabled: false` | 인증되지 않은 요청 차단 |
| kubelet API 권한 우회 | `authorization.mode: Webhook` | API Server RBAC로 인가 |
| 읽기 전용 포트 정보 노출 | `readOnlyPort: 0` | 인증 없는 정보 조회 차단 |
| kubelet 인증서 위조 | `x509.clientCAFile: /etc/kubernetes/pki/ca.crt` | 클라이언트 인증서 검증 |
| 타 노드 kubelet 접근 | Node authorization + NodeRestriction | 노드 간 격리 |

#### 트러블슈팅 가이드

**문제: kubelet API 접근이 차단되지 않는 경우**

```bash
# 인증 없이 kubelet API 접근 테스트
curl -k https://<dev-master-ip>:10250/pods --max-time 5 2>/dev/null
```

```text
Unauthorized
```

`Unauthorized`가 반환되면 anonymous 인증이 비활성화된 것이다. 만약 Pod 목록이 반환되면 anonymous 인증이 활성화되어 있으므로 즉시 수정해야 한다.

```bash
# kubelet 설정에서 anonymous 인증 상태 확인
ssh admin@<dev-master-ip> 'sudo cat /var/lib/kubelet/config.yaml | grep -A2 "anonymous"'
```

```text
  anonymous:
    enabled: false
```

**문제: readOnlyPort가 열려 있는지 확인**

```bash
# readOnlyPort 접근 테스트 (기본 10255)
curl -s http://<dev-master-ip>:10255/pods --max-time 3 2>/dev/null | head -5
```

```text
# readOnlyPort: 0 이면 연결 거부됨 (정상)
curl: (7) Failed to connect to <dev-master-ip> port 10255: Connection refused
```

readOnlyPort가 열려 있으면 인증 없이 다음 정보가 노출된다:
- `/pods`: 노드에서 실행 중인 모든 Pod 목록
- `/spec`: 노드의 하드웨어 스펙
- `/stats`: 리소스 사용 통계
- `/metrics`: Prometheus 메트릭

**문제: Master와 Worker 노드의 kubelet 설정 일관성 확인**

```bash
# Master 노드 설정
ssh admin@<dev-master-ip> 'sudo cat /var/lib/kubelet/config.yaml | grep -E "anonymous|authorization|readOnly" -A1'
```

```text
  anonymous:
    enabled: false
  mode: Webhook
readOnlyPort: 0
```

```bash
# Worker 노드 설정 (동일해야 한다)
ssh admin@<dev-worker1-ip> 'sudo cat /var/lib/kubelet/config.yaml | grep -E "anonymous|authorization|readOnly" -A1'
```

```text
  anonymous:
    enabled: false
  mode: Webhook
readOnlyPort: 0
```

두 노드의 설정이 동일하지 않으면 Worker 노드가 보안 공백이 된다.

#### 학습 목표
- kubelet의 보안 관련 설정을 파악하고 분석한다.
- kubelet의 인증(authentication)과 인가(authorization) 설정을 이해한다.
- 안전하지 않은 kubelet 설정이 초래하는 보안 위험을 설명할 수 있다.

#### 실습 단계

**1단계: kubelet 설정 파일 전체 확인**

```bash
ssh admin@<dev-master-ip> 'sudo cat /var/lib/kubelet/config.yaml'
```

**2단계: 인증 설정 확인**

```bash
ssh admin@<dev-master-ip> 'sudo cat /var/lib/kubelet/config.yaml' | grep -A 5 authentication
```

예상 출력:
```yaml
authentication:
  anonymous:
    enabled: false
  webhook:
    cacheTTL: 0s
    enabled: true
  x509:
    clientCAFile: /etc/kubernetes/pki/ca.crt
```

- `anonymous.enabled: false`: 익명 접근을 차단한다.
- `webhook.enabled: true`: API Server를 통해 인증을 수행한다.
- `x509.clientCAFile`: 클라이언트 인증서 기반 인증을 지원한다.

**3단계: 인가 설정 확인**

```bash
ssh admin@<dev-master-ip> 'sudo cat /var/lib/kubelet/config.yaml' | grep -A 3 authorization
```

예상 출력:
```yaml
authorization:
  mode: Webhook
  webhook:
    cacheAuthorizedTTL: 0s
```

- `mode: Webhook`: API Server에 인가 결정을 위임한다. 이는 RBAC 정책이 kubelet API 접근에도 적용됨을 의미한다.

> **보안 경고**: `mode: AlwaysAllow`로 설정되어 있다면, kubelet API에 대한 모든 요청이 허가되어 Pod 내부의 명령 실행, 로그 조회 등이 무제한으로 가능해진다.

**4단계: kubelet의 read-only 포트 확인**

```bash
ssh admin@<dev-master-ip> 'sudo cat /var/lib/kubelet/config.yaml' | grep readOnlyPort
```

예상 출력:
```yaml
readOnlyPort: 0
```

`readOnlyPort: 0`은 인증 없이 접근 가능한 읽기 전용 포트(기본값 10255)를 비활성화한 것이다. 이 포트가 열려 있으면 클러스터 정보가 노출될 수 있다.

**5단계: kubelet 인증서 경로 확인**

```bash
ssh admin@<dev-master-ip> 'sudo cat /var/lib/kubelet/config.yaml' | grep -E "tlsCertFile|tlsPrivateKey"
```

**6단계: Worker 노드 kubelet 설정 비교**

```bash
ssh admin@<dev-worker1-ip> 'sudo cat /var/lib/kubelet/config.yaml' | grep -A 5 -E "authentication|authorization"
```

Master와 Worker 노드의 kubelet 설정이 동일하게 보안이 적용되어 있는지 비교한다.

**7단계: kubelet API 직접 접근 테스트**

```bash
# 인증 없이 kubelet API에 접근 시도
curl -k https://<dev-master-ip>:10250/pods --max-time 5
```

예상 출력:
```
Unauthorized
```

anonymous 인증이 비활성화되어 있으므로 접근이 차단된다.

#### 확인 문제
1. kubelet의 `authentication.anonymous.enabled: false` 설정이 중요한 이유는 무엇인가?
2. kubelet의 `authorization.mode: Webhook`은 인가 결정을 어디에 위임하는가?
3. `readOnlyPort: 10255`가 열려 있으면 노출되는 정보는 무엇인가?
4. kubelet이 `AlwaysAllow` 인가 모드를 사용할 때의 위험은 무엇인가?

#### 관련 KCSA 시험 주제
- kubelet 보안 구성
- kubelet 인증과 인가
- Node 보안

---

### Lab 2.4: TLS 인증서 목록 확인 (/etc/kubernetes/pki/)

#### 등장 배경과 기존 한계점

Kubernetes는 내부 통신에 PKI(Public Key Infrastructure)를 사용한다. kubeadm으로 클러스터를 생성하면 자동으로 CA(Certificate Authority)와 각 컴포넌트의 인증서가 생성된다.

PKI가 Kubernetes에 도입된 이유: 초기 Kubernetes에서는 컴포넌트 간 통신이 평문(HTTP)으로 이루어지기도 했다. 이는 클러스터 내부 네트워크에서 통신을 도청하거나 위조할 수 있는 심각한 보안 문제였다. PKI 기반 TLS를 도입하여 다음을 달성하였다:
1. **기밀성(Confidentiality)**: 통신 내용을 암호화하여 도청을 방지한다.
2. **무결성(Integrity)**: 통신 내용이 변조되지 않았음을 보장한다.
3. **인증(Authentication)**: 통신 상대방이 정당한 주체임을 검증한다.

Kubernetes PKI의 구조:
```
Root CA (ca.crt/ca.key)
├── API Server 인증서 (apiserver.crt)
├── API Server → kubelet 클라이언트 (apiserver-kubelet-client.crt)
├── API Server → etcd 클라이언트 (apiserver-etcd-client.crt)
└── ServiceAccount 토큰 서명 키 (sa.key/sa.pub)

etcd CA (etcd/ca.crt/ca.key)
├── etcd 서버 인증서 (etcd/server.crt)
├── etcd 피어 인증서 (etcd/peer.crt)
└── etcd 헬스체크 클라이언트 (etcd/healthcheck-client.crt)

Front Proxy CA (front-proxy-ca.crt/front-proxy-ca.key)
└── Front Proxy 클라이언트 (front-proxy-client.crt)
```

#### 공격-방어 매핑

| 인증서 유출 시 공격 벡터 | 영향 범위 | 위험도 |
|----------------------|---------|--------|
| `ca.key` 유출 | 임의의 클라이언트 인증서 발급 가능 → 클러스터 완전 침해 | CRITICAL |
| `apiserver.key` 유출 | API Server 위장(MITM) 가능 | CRITICAL |
| `apiserver-etcd-client.key` 유출 | etcd에 직접 접근하여 모든 데이터 읽기/수정 | CRITICAL |
| `sa.key` 유출 | 임의의 ServiceAccount 토큰 생성 가능 | HIGH |
| `etcd/peer.key` 유출 | 가짜 etcd 멤버 추가로 데이터 변조 | HIGH |
| 인증서 만료 (미갱신) | 컴포넌트 간 통신 불가 → 클러스터 운영 장애 | HIGH |

#### 트러블슈팅 가이드

**문제: 인증서 만료 시 클러스터 복구**

```bash
# 인증서 만료 여부 확인
ssh admin@<dev-master-ip> 'sudo kubeadm certs check-expiration 2>/dev/null'
```

```text
CERTIFICATE                EXPIRES                  RESIDUAL TIME
admin.conf                 Jan 15, 2025 10:00 UTC   340d
apiserver                  Jan 15, 2025 10:00 UTC   340d
```

만료된 인증서가 있는 경우:
```bash
# 전체 인증서 갱신
ssh admin@<dev-master-ip> 'sudo kubeadm certs renew all'
```

```text
[renew] Reading configuration from the cluster...
certificate embedded in admin.conf renewed
certificate for serving the Kubernetes API renewed
certificate the apiserver uses to access etcd renewed
certificate for the apiserver to connect to kubelet renewed
...
Done renewing certificates. You must restart the kube-apiserver, kube-controller-manager,
kube-scheduler and etcd, so that they can use the new certificates.
```

갱신 후 Static Pod 재시작이 필요하다:
```bash
# Static Pod 매니페스트를 임시 이동하여 재시작 유도
ssh admin@<dev-master-ip> 'sudo mv /etc/kubernetes/manifests/kube-apiserver.yaml /tmp/ && sleep 5 && sudo mv /tmp/kube-apiserver.yaml /etc/kubernetes/manifests/'
```

**문제: 개인키 파일 권한 점검**

```bash
# 개인키 파일의 권한이 600인지 확인
ssh admin@<dev-master-ip> 'sudo stat -c "%a %n" /etc/kubernetes/pki/*.key /etc/kubernetes/pki/etcd/*.key 2>/dev/null'
```

```text
600 /etc/kubernetes/pki/apiserver.key
600 /etc/kubernetes/pki/apiserver-etcd-client.key
600 /etc/kubernetes/pki/apiserver-kubelet-client.key
600 /etc/kubernetes/pki/ca.key
600 /etc/kubernetes/pki/front-proxy-ca.key
600 /etc/kubernetes/pki/front-proxy-client.key
600 /etc/kubernetes/pki/sa.key
600 /etc/kubernetes/pki/etcd/ca.key
600 /etc/kubernetes/pki/etcd/healthcheck-client.key
600 /etc/kubernetes/pki/etcd/peer.key
600 /etc/kubernetes/pki/etcd/server.key
```

권한이 600이 아닌 파일이 있으면 즉시 수정한다:
```bash
ssh admin@<dev-master-ip> 'sudo chmod 600 /etc/kubernetes/pki/*.key /etc/kubernetes/pki/etcd/*.key'
```

#### 학습 목표
- Kubernetes PKI(Public Key Infrastructure)의 구조를 이해한다.
- 각 인증서의 용도와 역할을 파악한다.
- 인증서 만료일을 확인하는 방법을 학습한다.

#### 실습 단계

**1단계: PKI 디렉토리 전체 조회**

```bash
ssh admin@<dev-master-ip> 'sudo ls -la /etc/kubernetes/pki/'
```

예상 출력:
```
total XX
drwxr-xr-x 3 root root ... .
drwxrwxr-x 4 root root ... ..
-rw-r--r-- 1 root root ... apiserver.crt
-rw------- 1 root root ... apiserver.key
-rw-r--r-- 1 root root ... apiserver-etcd-client.crt
-rw------- 1 root root ... apiserver-etcd-client.key
-rw-r--r-- 1 root root ... apiserver-kubelet-client.crt
-rw------- 1 root root ... apiserver-kubelet-client.key
-rw-r--r-- 1 root root ... ca.crt
-rw------- 1 root root ... ca.key
drwxr-xr-x 2 root root ... etcd
-rw-r--r-- 1 root root ... front-proxy-ca.crt
-rw------- 1 root root ... front-proxy-ca.key
-rw-r--r-- 1 root root ... front-proxy-client.crt
-rw------- 1 root root ... front-proxy-client.key
-rw------- 1 root root ... sa.key
-rw-r--r-- 1 root root ... sa.pub
```

**2단계: 인증서 용도 매핑**

각 인증서의 역할을 이해한다.

| 인증서 파일 | 용도 |
|------------|------|
| `ca.crt` / `ca.key` | Kubernetes 루트 CA — 모든 컴포넌트 인증서의 서명 기관 |
| `apiserver.crt` / `apiserver.key` | API Server의 TLS 서버 인증서 |
| `apiserver-etcd-client.crt` | API Server가 etcd에 접속할 때 사용하는 클라이언트 인증서 |
| `apiserver-kubelet-client.crt` | API Server가 kubelet에 접속할 때 사용하는 클라이언트 인증서 |
| `front-proxy-ca.crt` / `front-proxy-client.crt` | Aggregation Layer(API 확장)에 사용되는 인증서 |
| `sa.key` / `sa.pub` | ServiceAccount 토큰 서명용 키 쌍 |
| `etcd/` | etcd 전용 인증서 디렉토리 |

**3단계: 인증서 만료일 확인**

```bash
# API Server 인증서 만료일 확인
ssh admin@<dev-master-ip> 'sudo openssl x509 -in /etc/kubernetes/pki/apiserver.crt -noout -enddate'
```

예상 출력:
```
notAfter=MMM DD HH:MM:SS YYYY GMT
```

```bash
# CA 인증서 만료일 확인
ssh admin@<dev-master-ip> 'sudo openssl x509 -in /etc/kubernetes/pki/ca.crt -noout -enddate'
```

```bash
# 모든 인증서 만료일을 한 번에 확인
ssh admin@<dev-master-ip> 'for cert in /etc/kubernetes/pki/*.crt; do echo "=== $cert ==="; sudo openssl x509 -in $cert -noout -enddate; done'
```

**4단계: 인증서 상세 정보 확인**

```bash
# API Server 인증서의 Subject Alternative Names (SAN) 확인
ssh admin@<dev-master-ip> 'sudo openssl x509 -in /etc/kubernetes/pki/apiserver.crt -noout -text' | grep -A 5 "Subject Alternative Name"
```

예상 출력:
```
            X509v3 Subject Alternative Name:
                DNS:dev-master, DNS:kubernetes, DNS:kubernetes.default, DNS:kubernetes.default.svc, DNS:kubernetes.default.svc.cluster.local, IP Address:10.96.0.1, IP Address:192.168.64.X
```

SAN에 포함된 이름/IP로만 API Server에 TLS 접속이 가능하다.

**5단계: 인증서 파일 권한 보안 점검**

```bash
# 개인키 파일의 권한 확인 — 600(소유자만 읽기/쓰기)이어야 안전하다
ssh admin@<dev-master-ip> 'sudo stat -c "%a %n" /etc/kubernetes/pki/*.key'
```

예상 출력:
```
600 /etc/kubernetes/pki/apiserver.key
600 /etc/kubernetes/pki/apiserver-etcd-client.key
600 /etc/kubernetes/pki/apiserver-kubelet-client.key
600 /etc/kubernetes/pki/ca.key
600 /etc/kubernetes/pki/front-proxy-ca.key
600 /etc/kubernetes/pki/front-proxy-client.key
600 /etc/kubernetes/pki/sa.key
```

**6단계: kubeadm 인증서 관리 명령어**

```bash
# kubeadm으로 인증서 만료 정보 확인 (가능한 경우)
ssh admin@<dev-master-ip> 'sudo kubeadm certs check-expiration' 2>/dev/null
```

예상 출력:
```
CERTIFICATE                EXPIRES                  RESIDUAL TIME   ...   EXTERNALLY MANAGED
admin.conf                 MMM DD, YYYY HH:MM UTC   XXXd                  no
apiserver                  MMM DD, YYYY HH:MM UTC   XXXd                  no
apiserver-etcd-client      MMM DD, YYYY HH:MM UTC   XXXd                  no
...
```

#### 확인 문제
1. Kubernetes PKI에서 CA 인증서(`ca.crt`)가 유출되면 어떤 보안 위험이 발생하는가?
2. `apiserver-etcd-client.crt`와 `apiserver-kubelet-client.crt`의 용도 차이는 무엇인가?
3. 인증서 만료 시 클러스터에 어떤 영향이 있는가?
4. `sa.key`와 `sa.pub`의 역할은 무엇이며, 이 키가 유출되면 어떤 위험이 있는가?
5. 개인키 파일의 권한이 `644`로 설정되어 있다면 어떻게 수정해야 하는가?

#### 관련 KCSA 시험 주제
- Kubernetes PKI 구조
- TLS 인증서 관리
- Control Plane 보안
- 인증서 갱신(Certificate Rotation)

---

### Lab 2.5: CoreDNS 설정 확인

#### 등장 배경과 기존 한계점

Kubernetes는 서비스 디스커버리를 위해 클러스터 내부 DNS를 제공한다. 초기에는 kube-dns(SkyDNS + dnsmasq)를 사용하였으나, Kubernetes 1.11부터 CoreDNS가 기본 DNS 서버로 채택되었다.

kube-dns에서 CoreDNS로 전환된 이유:
1. **단일 바이너리**: kube-dns는 3개 컨테이너(SkyDNS, dnsmasq, sidecar)로 구성되었으나, CoreDNS는 단일 바이너리이다.
2. **플러그인 아키텍처**: CoreDNS는 플러그인 체인으로 기능을 확장할 수 있다.
3. **설정 유연성**: Corefile을 통해 세밀한 DNS 정책을 설정할 수 있다.
4. **보안 강화**: dnsmasq의 알려진 취약점(CVE-2017-14491 등)을 회피한다.

CoreDNS가 보안에 중요한 이유: Kubernetes에서 서비스 간 통신은 DNS 이름(예: `httpbin.demo.svc.cluster.local`)을 사용한다. CoreDNS가 침해되면 공격자는 DNS 응답을 위조하여 트래픽을 악성 Pod로 리다이렉트할 수 있다(DNS 스푸핑). 또한 default-deny NetworkPolicy에서 DNS(53/UDP)를 허용하지 않으면 모든 서비스 이름 해석이 불가능하여 서비스 간 통신이 완전히 차단된다.

#### 공격-방어 매핑

| 공격 벡터 | CoreDNS 관련 방어 | tart-infra 상태 |
|----------|-----------------|----------------|
| DNS 스푸핑 | CoreDNS Pod 격리, RBAC로 ConfigMap 보호 | Cilium으로 CoreDNS 접근 제한 |
| DNS 터널링 (데이터 유출) | DNS 쿼리 모니터링, L7 DNS 정책 | 기본 53/UDP만 허용 |
| DNS 증폭 공격 | CoreDNS 리소스 제한, rate limiting | 기본 설정 |
| ConfigMap 변조 | RBAC로 kube-system ConfigMap 수정 제한 | RBAC 적용됨 |

#### 트러블슈팅 가이드

**문제: DNS 조회 실패 진단**

```bash
# DNS Pod 상태 확인
kubectl get pods -n kube-system -l k8s-app=kube-dns
```

```text
NAME                       READY   STATUS    RESTARTS   AGE
coredns-xxxxxxx-xxxxx      1/1     Running   0          10d
coredns-xxxxxxx-yyyyy      1/1     Running   0          10d
```

```bash
# DNS 서비스 접근 테스트
kubectl run dns-debug --image=busybox:1.36 --rm -it --restart=Never -- nslookup kubernetes.default.svc.cluster.local 2>/dev/null
```

```text
Server:    10.96.0.10
Address 1: 10.96.0.10 kube-dns.kube-system.svc.cluster.local

Name:      kubernetes.default.svc.cluster.local
Address 1: 10.96.0.1 kubernetes.default.svc.cluster.local
```

DNS 조회가 실패하는 경우:
1. CoreDNS Pod가 Running이 아닌지 확인한다.
2. kube-dns Service(10.96.0.10)가 존재하는지 확인한다.
3. NetworkPolicy에서 53/UDP egress가 허용되는지 확인한다.
4. CoreDNS ConfigMap의 Corefile에 문법 오류가 없는지 확인한다.

**문제: `pods insecure` 설정의 보안 영향**

```bash
# CoreDNS Corefile에서 pods 옵션 확인
kubectl get configmap coredns -n kube-system -o jsonpath='{.data.Corefile}' | grep pods
```

```text
           pods insecure
```

`pods insecure`는 Pod의 역방향 DNS 조회(IP → 이름)를 허용하되, 실제 Pod IP 매칭을 검증하지 않는다. `pods verified`로 변경하면 실제 존재하는 Pod IP만 응답하여 보안이 강화된다. `pods disabled`로 설정하면 Pod DNS 레코드를 완전히 비활성화한다.

#### 학습 목표
- CoreDNS가 Kubernetes에서 수행하는 역할을 이해한다.
- CoreDNS 설정(ConfigMap)을 분석하여 보안 관련 구성을 확인한다.
- DNS가 네트워크 정책과 어떻게 연동되는지 파악한다.

#### 실습 단계

**1단계: CoreDNS Pod 상태 확인**

```bash
kubectl get pods -n kube-system -l k8s-app=kube-dns
```

예상 출력:
```
NAME                       READY   STATUS    RESTARTS   AGE
coredns-xxxxxxx-xxxxx      1/1     Running   0          XXd
coredns-xxxxxxx-yyyyy      1/1     Running   0          XXd
```

**2단계: CoreDNS ConfigMap 확인**

```bash
kubectl get configmap coredns -n kube-system -o yaml
```

예상 출력:
```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: coredns
  namespace: kube-system
data:
  Corefile: |
    .:53 {
        errors
        health {
           lameduck 5s
        }
        ready
        kubernetes cluster.local in-addr.arpa ip6.arpa {
           pods insecure
           fallthrough in-addr.arpa ip6.arpa
           ttl 30
        }
        prometheus :9153
        forward . /etc/resolv.conf {
           max_concurrent 1000
        }
        cache 30
        loop
        reload
        loadbalance
    }
```

**3단계: DNS 서비스 확인**

```bash
kubectl get svc -n kube-system kube-dns
```

예상 출력:
```
NAME       TYPE        CLUSTER-IP   EXTERNAL-IP   PORT(S)                  AGE
kube-dns   ClusterIP   10.96.0.10   <none>        53/UDP,53/TCP,9153/TCP   XXd
```

CoreDNS는 `kube-dns`라는 이름의 서비스로 노출되며, 클러스터 내 모든 Pod의 DNS 조회는 이 서비스(10.96.0.10:53)를 통해 이루어진다.

**4단계: DNS 조회 테스트**

```bash
# demo 네임스페이스의 Pod에서 DNS 조회 테스트
kubectl exec -n demo $(kubectl get pod -n demo -l app=nginx-web -o name | head -1) -c nginx-web -- nslookup httpbin.demo.svc.cluster.local 2>/dev/null || \
kubectl run dns-test --image=busybox:1.36 --rm -it --restart=Never -n demo -- nslookup httpbin.demo.svc.cluster.local
```

예상 출력:
```
Server:    10.96.0.10
Address 1: 10.96.0.10 kube-dns.kube-system.svc.cluster.local

Name:      httpbin.demo.svc.cluster.local
Address 1: 10.96.X.X httpbin.demo.svc.cluster.local
```

**5단계: CiliumNetworkPolicy에서의 DNS 허용 확인**

```bash
# default-deny-all 정책에서 DNS 허용 부분 확인
kubectl get cnp default-deny-all -n demo -o yaml
```

default-deny-all 정책은 모든 트래픽을 차단하지만, egress에서 kube-dns(53/UDP)로의 통신은 허용한다. DNS가 차단되면 서비스 이름을 IP로 해석할 수 없어 모든 서비스 간 통신이 불가능해지기 때문이다.

```yaml
# default-deny-all 정책 구조
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: default-deny-all
  namespace: demo
spec:
  endpointSelector: {}
  ingress: []
  egress:
    - toEndpoints:
        - matchLabels:
            io.kubernetes.pod.namespace: kube-system
            k8s-app: kube-dns
      toPorts:
        - ports:
            - port: "53"
              protocol: UDP
```

#### 확인 문제
1. CoreDNS ConfigMap의 `pods insecure` 옵션이 의미하는 바는 무엇인가?
2. default-deny-all 네트워크 정책에서 DNS(53/UDP)를 반드시 허용해야 하는 이유는 무엇인가?
3. CoreDNS가 공격 대상이 되면 어떤 보안 위험이 발생하는가?

#### 관련 KCSA 시험 주제
- DNS 보안
- CoreDNS 구성
- 네트워크 정책과 DNS의 관계

---

## 실습 3: Security Fundamentals (22%)

Kubernetes 보안의 핵심 기초 요소인 NetworkPolicy, RBAC, ServiceAccount, Secret, Pod Security Admission을 심층 분석한다. 이 영역은 KCSA 시험에서 22%로 가장 비중이 높은 영역 중 하나이다.

---

### Lab 3.1: CiliumNetworkPolicy 완전 분석 (11개 정책 하나씩 분석)

#### 등장 배경과 기존 한계점

Kubernetes의 기본 네트워크 모델은 "모든 Pod가 다른 모든 Pod와 자유롭게 통신할 수 있다"는 flat network이다. 이는 개발 편의를 위한 설계였으나, 프로덕션 보안 관점에서는 치명적인 문제이다.

기존 한계와 발전 과정:
1. **Kubernetes NetworkPolicy (v1.3+)**: L3(IP)/L4(포트) 수준의 트래픽 제어를 제공한다. 그러나 CNI 플러그인이 지원해야 하며, 기본 CNI(kubenet)는 NetworkPolicy를 지원하지 않는다.
2. **Calico NetworkPolicy**: L3/L4에 더해 일부 L7 기능을 제공하지만, eBPF 기반이 아니라 iptables 기반이므로 대규모 정책에서 성능 저하가 발생한다.
3. **CiliumNetworkPolicy**: eBPF(extended Berkeley Packet Filter) 기반으로 L3/L4/L7 트래픽을 제어한다. iptables를 사용하지 않으므로 정책 수가 증가해도 성능 저하가 최소화된다.

eBPF가 네트워크 정책에 혁신을 가져온 이유는 커널 공간에서 직접 패킷을 처리하기 때문이다. 기존 iptables 방식은 규칙 수에 비례하여 O(n) 탐색이 필요했으나, eBPF는 해시 맵 기반으로 O(1) 조회가 가능하다. 또한 eBPF는 HTTP 헤더, DNS 쿼리 등 L7 프로토콜을 커널에서 직접 파싱할 수 있다(단, HTTP L7 정책의 경우 Envoy 프록시를 사이드카로 사용한다).

#### 공격-방어 매핑

| 공격 벡터 | 방어 정책 | tart-infra 적용 |
|----------|---------|----------------|
| 횡적 이동 (Lateral Movement) | default-deny-all | 적용됨 |
| API 엔드포인트 무단 접근 | L7 HTTP 메서드/경로 필터링 | 적용됨 (GET only) |
| DNS 터널링 | DNS egress 제한 | 부분 적용 (53/UDP만 허용) |
| 서비스 간 무단 통신 | 레이블 기반 엔드포인트 셀렉터 | 적용됨 (11개 정책) |
| 클러스터 외부 데이터 유출 | egress 제한 | 적용됨 (명시적 대상만 허용) |

#### 트러블슈팅 가이드

**문제: 정책이 적용되었지만 트래픽이 차단되지 않는 경우**

```bash
# 1) Cilium 엔드포인트에 정책이 실제로 적용되었는지 확인
kubectl exec -n kube-system $(kubectl get pod -n kube-system -l k8s-app=cilium -o name | head -1) -- \
  cilium endpoint list 2>/dev/null | grep nginx
```

```text
ENDPOINT   POLICY (ingress)   POLICY (egress)   IDENTITY   LABELS
1234       Enabled            Enabled           56789      k8s:app=nginx-web
```

POLICY가 `Disabled`이면 정책이 해당 엔드포인트에 적용되지 않은 것이다.

```bash
# 2) 정책 조건과 Pod 레이블 매칭 확인
kubectl get pod -n demo -l app=nginx-web --show-labels
```

```text
NAME                  READY   STATUS    RESTARTS   AGE   LABELS
nginx-web-xxx-yyy     2/2     Running   0          10d   app=nginx-web,pod-template-hash=xxx
```

정책의 `endpointSelector.matchLabels`에 지정된 레이블이 Pod에 존재하는지 확인한다. 레이블이 불일치하면 정책이 적용되지 않는다.

#### 학습 목표
- tart-infra에 적용된 11개의 CiliumNetworkPolicy를 하나씩 분석하고 이해한다.
- 각 정책의 ingress/egress 규칙, 레이블 셀렉터, 포트, L7 필터링을 완벽히 파악한다.
- 정책 간의 상호 관계를 이해하고 전체 트래픽 흐름 맵을 구성할 수 있다.

#### 실습 단계

**1단계: 전체 정책 목록 확인**

```bash
kubectl get cnp -n demo -o custom-columns='NAME:.metadata.name,ENDPOINT:.spec.endpointSelector'
```

**정책 1: default-deny-all**

```bash
kubectl get cnp default-deny-all -n demo -o yaml
```

분석:
```yaml
spec:
  endpointSelector: {}          # 모든 Pod에 적용
  ingress: []                   # 모든 ingress 차단
  egress:
    - toEndpoints:
        - matchLabels:
            io.kubernetes.pod.namespace: kube-system
            k8s-app: kube-dns
      toPorts:
        - ports:
            - port: "53"
              protocol: UDP     # DNS 조회만 허용
```

- **대상**: demo 네임스페이스의 모든 Pod (selector `{}`)
- **Ingress**: 빈 배열 `[]` — 모든 인바운드 트래픽 차단
- **Egress**: kube-dns(53/UDP)로의 DNS 조회만 허용
- **목적**: Zero Trust 원칙 적용. 명시적으로 허용하지 않은 모든 트래픽을 차단한다.

> **핵심 개념**: 이 정책이 모든 네트워크 보안의 기반이다. 이후의 10개 정책은 이 기본 차단 위에 필요한 통신만 선택적으로 허용한다.

---

**정책 2: allow-external-to-nginx**

```bash
kubectl get cnp allow-external-to-nginx -n demo -o yaml
```

분석:
```yaml
spec:
  endpointSelector:
    matchLabels:
      app: nginx-web            # nginx Pod에 적용
  ingress:
    - fromEntities:
        - world                 # 클러스터 외부에서의 접근
        - cluster               # 클러스터 내부에서의 접근
      toPorts:
        - ports:
            - port: "80"        # 80번 포트만 허용
```

- **대상**: `app=nginx-web` 레이블이 있는 Pod
- **Ingress**: world(외부) 및 cluster(내부) 엔터티에서 80번 포트로의 접근 허용
- **목적**: nginx가 외부 사용자에게 웹 서비스를 제공하기 위한 정책

---

**정책 3: allow-nginx-to-httpbin**

```bash
kubectl get cnp allow-nginx-to-httpbin -n demo -o yaml
```

분석:
```yaml
spec:
  endpointSelector:
    matchLabels:
      app: httpbin              # httpbin Pod에 적용
  ingress:
    - fromEndpoints:
        - matchLabels:
            app: nginx-web      # nginx에서만 접근 허용
      toPorts:
        - ports:
            - port: "80"
          rules:
            http:
              - method: GET     # HTTP GET만 허용 (L7 필터링)
```

- **대상**: `app=httpbin` 레이블이 있는 Pod
- **Ingress**: `app=nginx-web` Pod에서 80번 포트로의 HTTP GET 요청만 허용
- **L7 필터링**: POST, PUT, DELETE 등 다른 HTTP 메서드는 모두 차단된다
- **목적**: 최소 권한 원칙을 네트워크 레벨에서 적용

> **핵심 개념**: 이것이 Cilium의 L7(애플리케이션 레이어) 네트워크 정책이다. 기본 Kubernetes NetworkPolicy는 L3/L4(IP/포트)만 제어할 수 있지만, Cilium은 HTTP 메서드, 경로 등 L7 수준의 필터링을 지원한다.

---

**정책 4: allow-nginx-to-redis**

```bash
kubectl get cnp allow-nginx-to-redis -n demo -o yaml
```

분석:
```yaml
spec:
  endpointSelector:
    matchLabels:
      app: redis                # redis Pod에 적용
  ingress:
    - fromEndpoints:
        - matchLabels:
            app: nginx-web      # nginx에서만 접근 허용
      toPorts:
        - ports:
            - port: "6379"      # Redis 포트
```

- **대상**: `app=redis` Pod
- **Ingress**: `app=nginx-web`에서 6379 포트로의 접근만 허용
- **목적**: nginx가 Redis를 캐시 저장소로 사용할 수 있도록 허용

---

**정책 5: allow-nginx-egress**

```bash
kubectl get cnp allow-nginx-egress -n demo -o yaml
```

분석:
```yaml
spec:
  endpointSelector:
    matchLabels:
      app: nginx-web            # nginx Pod에 적용
  egress:
    - toEndpoints:
        - matchLabels:
            app: httpbin
      toPorts:
        - ports:
            - port: "80"
          rules:
            http:
              - method: GET     # httpbin에 GET만 허용
    - toEndpoints:
        - matchLabels:
            app: redis
      toPorts:
        - ports:
            - port: "6379"      # Redis 접근 허용
    - toEndpoints:
        - matchLabels:
            io.kubernetes.pod.namespace: kube-system
            k8s-app: kube-dns
      toPorts:
        - ports:
            - port: "53"
              protocol: UDP     # DNS 조회 허용
```

- **대상**: `app=nginx-web` Pod
- **Egress**: httpbin(80, GET only), redis(6379), kube-dns(53/UDP)로의 아웃바운드만 허용
- **목적**: nginx의 아웃바운드 트래픽을 필요한 대상으로만 제한

> **핵심 개념**: ingress와 egress 정책은 양방향으로 모두 설정해야 한다. ingress만 허용하고 egress를 허용하지 않으면 통신이 성립하지 않는다.

---

**정책 6: allow-httpbin-to-postgres**

```bash
kubectl get cnp allow-httpbin-to-postgres -n demo -o yaml
```

분석:
```yaml
spec:
  endpointSelector:
    matchLabels:
      app: postgres             # postgres Pod에 적용
  ingress:
    - fromEndpoints:
        - matchLabels:
            app: httpbin        # httpbin에서만 접근 허용
      toPorts:
        - ports:
            - port: "5432"      # PostgreSQL 포트
```

- **대상**: `app=postgres` Pod
- **Ingress**: `app=httpbin`에서 5432 포트로의 접근만 허용
- **목적**: httpbin이 백엔드 데이터베이스(postgres)에 접근할 수 있도록 허용

---

**정책 7: allow-httpbin-to-rabbitmq**

```bash
kubectl get cnp allow-httpbin-to-rabbitmq -n demo -o yaml
```

분석:
```yaml
spec:
  endpointSelector:
    matchLabels:
      app: rabbitmq             # rabbitmq Pod에 적용
  ingress:
    - fromEndpoints:
        - matchLabels:
            app: httpbin        # httpbin에서만 접근 허용
      toPorts:
        - ports:
            - port: "5672"      # RabbitMQ AMQP 포트
```

- **대상**: `app=rabbitmq` Pod
- **Ingress**: `app=httpbin`에서 5672 포트로의 접근만 허용
- **목적**: httpbin이 메시지 큐(rabbitmq)에 메시지를 발행/소비할 수 있도록 허용

---

**정책 8: allow-httpbin-to-keycloak**

```bash
kubectl get cnp allow-httpbin-to-keycloak -n demo -o yaml
```

분석:
```yaml
spec:
  endpointSelector:
    matchLabels:
      app: keycloak             # keycloak Pod에 적용
  ingress:
    - fromEndpoints:
        - matchLabels:
            app: httpbin        # httpbin에서만 접근 허용
      toPorts:
        - ports:
            - port: "8080"      # Keycloak 포트
```

- **대상**: `app=keycloak` Pod
- **Ingress**: `app=httpbin`에서 8080 포트로의 접근 허용
- **목적**: httpbin이 Keycloak에 인증/인가 요청을 보낼 수 있도록 허용

---

**정책 9: allow-keycloak-to-postgres**

```bash
kubectl get cnp allow-keycloak-to-postgres -n demo -o yaml
```

분석:
```yaml
spec:
  endpointSelector:
    matchLabels:
      app: postgres             # postgres Pod에 적용
  ingress:
    - fromEndpoints:
        - matchLabels:
            app: keycloak       # keycloak에서만 접근 허용
      toPorts:
        - ports:
            - port: "5432"      # PostgreSQL 포트
```

- **대상**: `app=postgres` Pod
- **Ingress**: `app=keycloak`에서 5432 포트로의 접근 허용
- **목적**: Keycloak이 사용자/세션 데이터를 postgres에 저장할 수 있도록 허용

> **참고**: postgres는 두 개의 ingress 정책을 가진다 — httpbin과 keycloak으로부터의 접근이 각각 허용된다.

---

**정책 10: allow-external-to-keycloak**

```bash
kubectl get cnp allow-external-to-keycloak -n demo -o yaml
```

분석:
```yaml
spec:
  endpointSelector:
    matchLabels:
      app: keycloak             # keycloak Pod에 적용
  ingress:
    - fromEntities:
        - world                 # 클러스터 외부에서의 접근
        - cluster               # 클러스터 내부에서의 접근
      toPorts:
        - ports:
            - port: "8080"      # Keycloak 포트
```

- **대상**: `app=keycloak` Pod
- **Ingress**: world 및 cluster 엔터티에서 8080 포트로의 접근 허용
- **목적**: 외부 사용자가 Keycloak 관리 콘솔(NodePort 30880)에 접근할 수 있도록 허용

---

**정책 11: allow-istio-control-plane**

```bash
kubectl get cnp allow-istio-control-plane -n demo -o yaml
```

분석:
```yaml
spec:
  endpointSelector: {}         # 모든 Pod에 적용
  ingress:
    - fromEndpoints:
        - matchLabels:
            io.kubernetes.pod.namespace: istio-system
      toPorts:
        - ports:
            - port: "15010"    # Istio gRPC (plaintext)
            - port: "15012"    # Istio gRPC (mTLS)
            - port: "15017"    # Istio webhook
```

- **대상**: demo 네임스페이스의 모든 Pod
- **Ingress**: istio-system 네임스페이스에서 Istio 제어 평면 포트(15010, 15012, 15017)로의 접근 허용
- **목적**: Istio 사이드카 프록시가 제어 평면(istiod)과 통신할 수 있도록 허용

---

**2단계: 전체 트래픽 흐름 다이어그램**

```
                    ┌──────────────┐
     world/cluster  │              │  world/cluster
     ───── :80 ────>│  nginx-web   │
                    │  (NodePort   │
                    │   30080)     │
                    └──┬───────┬───┘
                       │       │
              GET :80  │       │  :6379
                       v       v
                 ┌──────┐  ┌───────┐
                 │httpbin│  │ redis │
                 └──┬─┬──┘  └───────┘
                    │ │
         :5432 ─────┘ │ :5672        :8080
                      │               │
              ┌───────┘    ┌──────────┘
              v            v
         ┌─────────┐  ┌──────────┐
         │rabbitmq │  │ keycloak │ <── world/cluster :8080
         └─────────┘  │(NodePort │     (30880)
                      │  30880)  │
                      └────┬─────┘
                           │ :5432
                           v
                      ┌──────────┐
                      │ postgres │ <── httpbin :5432
                      │ (pw:     │ <── keycloak :5432
                      │  demo123)│
                      └──────────┘

     ──── 모든 Pod ──── :53/UDP ────> kube-dns (kube-system)
     ──── istio-system ──── :15010,15012,15017 ────> 모든 Pod
```

#### 확인 문제
1. `endpointSelector: {}`의 의미는 무엇인가?
2. `fromEntities: [world, cluster]`와 `fromEndpoints`의 차이는 무엇인가?
3. postgres Pod에 접근할 수 있는 Pod는 어떤 것들인가?
4. L7 정책(HTTP GET only)이 L4 정책(포트 허용)보다 보안적으로 우수한 이유는 무엇인가?
5. default-deny-all에서 DNS를 허용하지 않으면 어떤 현상이 발생하는가?
6. Istio 제어 평면 포트 3개(15010, 15012, 15017)의 각 용도는 무엇인가?

#### 관련 KCSA 시험 주제
- NetworkPolicy (ingress/egress)
- Zero Trust 네트워크 모델
- CNI 플러그인의 확장 기능
- L3/L4 vs L7 네트워크 정책

---

### Lab 3.2: Default Deny 정책 테스트 (busybox Pod에서 차단 확인)

#### 학습 목표
- default-deny-all 정책이 실제로 트래픽을 차단하는지 검증한다.
- 허용 정책이 없는 Pod에서의 통신 시도가 차단되는 것을 직접 확인한다.
- Zero Trust 네트워크 모델의 실효성을 체험한다.

#### 실습 단계

**1단계: 테스트용 busybox Pod 생성**

```bash
# demo 네임스페이스에 레이블 없는 busybox Pod 생성
kubectl run busybox-test --image=busybox:1.36 -n demo --restart=Never --labels="test=deny" -- sleep 3600
```

**2단계: busybox Pod 상태 확인**

```bash
kubectl get pod busybox-test -n demo -o wide
```

예상 출력:
```
NAME           READY   STATUS    RESTARTS   AGE   IP            NODE
busybox-test   2/2     Running   0          30s   10.0.X.X      dev-worker1
```

> **참고**: Istio 사이드카가 자동 주입되어 `2/2`로 표시될 수 있다.

**3단계: DNS 조회 테스트 (허용됨)**

```bash
kubectl exec -n demo busybox-test -- nslookup httpbin.demo.svc.cluster.local
```

예상 출력:
```
Server:    10.96.0.10
Address 1: 10.96.0.10 kube-dns.kube-system.svc.cluster.local

Name:      httpbin.demo.svc.cluster.local
Address 1: 10.96.X.X httpbin.demo.svc.cluster.local
```

DNS 조회는 default-deny-all 정책의 egress에서 허용되었으므로 성공한다.

**4단계: nginx 접근 시도 (차단됨)**

```bash
kubectl exec -n demo busybox-test -- wget -O- --timeout=5 http://nginx-web.demo.svc.cluster.local:80 2>&1
```

예상 출력:
```
Connecting to nginx-web.demo.svc.cluster.local:80 (10.96.X.X:80)
wget: download timed out
```

busybox-test Pod에는 nginx-web으로의 egress가 허용되지 않으므로 연결 시간 초과가 발생한다.

**5단계: httpbin 접근 시도 (차단됨)**

```bash
kubectl exec -n demo busybox-test -- wget -O- --timeout=5 http://httpbin.demo.svc.cluster.local:80 2>&1
```

예상 출력:
```
Connecting to httpbin.demo.svc.cluster.local:80 (10.96.X.X:80)
wget: download timed out
```

**6단계: redis 접근 시도 (차단됨)**

```bash
kubectl exec -n demo busybox-test -- nc -z -w 5 redis.demo.svc.cluster.local 6379 2>&1
echo "Exit code: $?"
```

예상 출력:
```
nc: redis.demo.svc.cluster.local (10.96.X.X:6379): Connection timed out
Exit code: 1
```

**7단계: postgres 접근 시도 (차단됨)**

```bash
kubectl exec -n demo busybox-test -- nc -z -w 5 postgres.demo.svc.cluster.local 5432 2>&1
```

예상 출력:
```
nc: postgres.demo.svc.cluster.local (10.96.X.X:5432): Connection timed out
```

**8단계: rabbitmq 접근 시도 (차단됨)**

```bash
kubectl exec -n demo busybox-test -- nc -z -w 5 rabbitmq.demo.svc.cluster.local 5672 2>&1
```

예상 출력:
```
nc: rabbitmq.demo.svc.cluster.local (10.96.X.X:5672): Connection timed out
```

**9단계: keycloak 접근 시도 (차단됨)**

```bash
kubectl exec -n demo busybox-test -- wget -O- --timeout=5 http://keycloak.demo.svc.cluster.local:8080 2>&1
```

예상 출력:
```
Connecting to keycloak.demo.svc.cluster.local:8080 (10.96.X.X:8080)
wget: download timed out
```

**10단계: 외부 인터넷 접근 시도 (차단됨)**

```bash
kubectl exec -n demo busybox-test -- wget -O- --timeout=5 http://example.com 2>&1
```

예상 출력:
```
Connecting to example.com (93.184.216.34:80)
wget: download timed out
```

DNS 조회는 성공하지만(IP 해석됨), 실제 연결은 egress 정책에 의해 차단된다.

**11단계: 정리**

```bash
kubectl delete pod busybox-test -n demo --grace-period=0 --force
```

#### 확인 문제
1. busybox Pod에서 DNS 조회는 성공하지만 HTTP 접근은 실패하는 이유는 무엇인가?
2. default-deny-all 정책 없이 개별 허용 정책만 있으면 어떤 보안 문제가 발생하는가?
3. Zero Trust 네트워크 모델의 핵심 원칙은 무엇인가?

#### 관련 KCSA 시험 주제
- Default Deny NetworkPolicy
- Zero Trust 네트워크 아키텍처
- 네트워크 정책 테스트 방법론

---

### Lab 3.3: L7 정책 테스트 (nginx→httpbin GET 허용, POST 차단)

#### 학습 목표
- Cilium의 L7(HTTP) 네트워크 정책이 실제로 동작하는지 검증한다.
- HTTP GET은 허용되고 POST는 차단되는 것을 직접 확인한다.
- L7 필터링의 보안적 가치를 체험한다.

#### 실습 단계

**1단계: nginx Pod에서 httpbin으로 GET 요청 (허용됨)**

```bash
# nginx Pod에서 httpbin으로 HTTP GET 요청
kubectl exec -n demo $(kubectl get pod -n demo -l app=nginx-web -o name | head -1) -c nginx-web -- \
  curl -s -o /dev/null -w "%{http_code}" http://httpbin.demo.svc.cluster.local:80/get --max-time 10
```

예상 출력:
```
200
```

GET 요청은 allow-nginx-to-httpbin 정책에 의해 허용되어 HTTP 200 응답을 받는다.

**2단계: nginx Pod에서 httpbin으로 GET 요청 — 상세 확인**

```bash
kubectl exec -n demo $(kubectl get pod -n demo -l app=nginx-web -o name | head -1) -c nginx-web -- \
  curl -s http://httpbin.demo.svc.cluster.local:80/get --max-time 10
```

예상 출력 (JSON 형식):
```json
{
  "args": {},
  "headers": {
    "Accept": "*/*",
    "Host": "httpbin.demo.svc.cluster.local",
    ...
  },
  "origin": "10.0.X.X",
  "url": "http://httpbin.demo.svc.cluster.local/get"
}
```

**3단계: nginx Pod에서 httpbin으로 POST 요청 (차단됨)**

```bash
kubectl exec -n demo $(kubectl get pod -n demo -l app=nginx-web -o name | head -1) -c nginx-web -- \
  curl -s -o /dev/null -w "%{http_code}" -X POST http://httpbin.demo.svc.cluster.local:80/post --max-time 10
```

예상 출력:
```
403
```

POST 요청은 L7 정책에 의해 차단되어 HTTP 403 Forbidden 응답을 받는다.

**4단계: nginx Pod에서 httpbin으로 PUT 요청 (차단됨)**

```bash
kubectl exec -n demo $(kubectl get pod -n demo -l app=nginx-web -o name | head -1) -c nginx-web -- \
  curl -s -o /dev/null -w "%{http_code}" -X PUT http://httpbin.demo.svc.cluster.local:80/put --max-time 10
```

예상 출력:
```
403
```

**5단계: nginx Pod에서 httpbin으로 DELETE 요청 (차단됨)**

```bash
kubectl exec -n demo $(kubectl get pod -n demo -l app=nginx-web -o name | head -1) -c nginx-web -- \
  curl -s -o /dev/null -w "%{http_code}" -X DELETE http://httpbin.demo.svc.cluster.local:80/delete --max-time 10
```

예상 출력:
```
403
```

**6단계: nginx Pod에서 httpbin으로 PATCH 요청 (차단됨)**

```bash
kubectl exec -n demo $(kubectl get pod -n demo -l app=nginx-web -o name | head -1) -c nginx-web -- \
  curl -s -o /dev/null -w "%{http_code}" -X PATCH http://httpbin.demo.svc.cluster.local:80/patch --max-time 10
```

예상 출력:
```
403
```

**7단계: 결과 요약**

| HTTP 메서드 | 예상 응답 코드 | 결과 |
|------------|--------------|------|
| GET | 200 | 허용됨 |
| POST | 403 | 차단됨 |
| PUT | 403 | 차단됨 |
| DELETE | 403 | 차단됨 |
| PATCH | 403 | 차단됨 |

**8단계: L4 vs L7 정책 비교**

L4(포트 기반) 정책만 있었다면 80번 포트의 모든 트래픽이 허용되었을 것이다. L7 정책을 통해 특정 HTTP 메서드만 허용함으로써 "읽기만 가능하고 쓰기는 불가능"한 세밀한 접근 제어가 가능하다.

```
L4 정책: 포트 80 허용 → GET, POST, PUT, DELETE 모두 허용 (보안 취약)
L7 정책: 포트 80 + GET만 허용 → GET만 가능, 나머지 차단 (보안 강화)
```

#### 확인 문제
1. L7 네트워크 정책에서 HTTP 403과 연결 시간 초과의 차이는 무엇인가?
2. L7 정책이 L4 정책보다 성능 오버헤드가 큰 이유는 무엇인가?
3. Cilium이 L7 정책을 구현하기 위해 사용하는 프록시는 무엇인가?
4. KCSA 시험에서 L7 NetworkPolicy 지원 여부로 CNI 플러그인을 구분할 때, Cilium과 Calico의 차이는 무엇인가?

#### 관련 KCSA 시험 주제
- L7 네트워크 정책
- 애플리케이션 레이어 보안
- CNI 플러그인 비교 (Cilium vs Calico)
- 최소 권한 원칙의 네트워크 적용

---

### Lab 3.4: RBAC 분석 (ClusterRole, ClusterRoleBinding 목록)

#### 등장 배경과 기존 한계점

RBAC(Role-Based Access Control)는 "누가(Subject) 무엇을(Resource) 어떻게(Verb) 할 수 있는가"를 정의하는 인가 메커니즘이다.

Kubernetes RBAC의 4가지 리소스:

| 리소스 | 범위 | 역할 |
|--------|------|------|
| **Role** | 네임스페이스 | 특정 네임스페이스 내의 권한 정의 |
| **ClusterRole** | 클러스터 전체 | 클러스터 범위의 권한 정의 또는 네임스페이스 리소스의 권한 템플릿 |
| **RoleBinding** | 네임스페이스 | Role/ClusterRole을 특정 네임스페이스에서 주체에 바인딩 |
| **ClusterRoleBinding** | 클러스터 전체 | ClusterRole을 클러스터 전체에서 주체에 바인딩 |

RBAC의 핵심 동작 원리: RBAC는 "화이트리스트" 방식이다. 명시적으로 허용되지 않은 모든 접근은 거부된다. 이는 보안에 유리하지만, 새로운 워크로드를 배포할 때 필요한 권한을 누락하면 동작하지 않는다.

위험한 RBAC 패턴:

| 패턴 | 위험도 | 설명 |
|------|--------|------|
| `resources: ["*"], verbs: ["*"]` | CRITICAL | 모든 리소스에 대한 모든 작업 허용 |
| `verbs: ["escalate"]` on roles | CRITICAL | 자신의 Role에 임의의 권한 추가 가능 |
| `verbs: ["bind"]` on rolebindings | CRITICAL | 임의의 Role을 자신에게 바인딩 가능 |
| `verbs: ["impersonate"]` on users | HIGH | 다른 사용자로 가장(impersonate) 가능 |
| `resources: ["secrets"], verbs: ["get", "list"]` | HIGH | 모든 Secret 읽기 가능 |
| `resources: ["pods/exec"], verbs: ["create"]` | HIGH | 모든 Pod에 exec 가능 |

#### 공격-방어 매핑

| 공격 벡터 | RBAC 방어 | 검증 명령어 |
|----------|---------|-----------|
| 과도한 Secret 접근 | Secret 읽기 권한 최소화 | `kubectl auth can-i list secrets --as=...` |
| Pod exec로 횡적 이동 | pods/exec 권한 제한 | `kubectl auth can-i create pods/exec --as=...` |
| RBAC 권한 상승 | escalate/bind verb 제한 | `kubectl auth can-i escalate clusterroles --as=...` |
| 와일드카드 권한 남용 | 구체적인 리소스/verb 지정 | `kubectl auth can-i '*' '*' --as=...` |
| ServiceAccount 토큰 탈취 | automountServiceAccountToken: false | Pod 내 토큰 존재 확인 |

#### 트러블슈팅 가이드

**문제: 특정 ServiceAccount의 실제 권한 파악**

RBAC 규칙이 여러 계층으로 중첩되면 실제 권한을 파악하기 어렵다. `kubectl auth can-i --list`로 최종 권한을 확인한다.

```bash
# demo 네임스페이스의 default SA가 가진 모든 권한 확인
kubectl auth can-i --list --as=system:serviceaccount:demo:default -n demo
```

```text
Resources                                       Non-Resource URLs   Resource Names   Verbs
selfsubjectaccessreviews.authorization.k8s.io   []                  []               [create]
selfsubjectrulesreviews.authorization.k8s.io    []                  []               [create]
```

출력이 매우 제한적이면 최소 권한 원칙이 잘 적용된 것이다. `*` 권한이 표시되면 과도한 권한이다.

**문제: wildcard 권한을 가진 ClusterRole 탐지**

```bash
# 위험한 와일드카드 권한을 가진 ClusterRole 검색
kubectl get clusterrole -o json | python3 -c "
import json, sys
data = json.load(sys.stdin)
for item in data['items']:
    name = item['metadata']['name']
    for rule in item.get('rules', []):
        if '*' in rule.get('verbs', []) and '*' in rule.get('resources', []):
            print(f'[CRITICAL] {name}: resources=[*], verbs=[*]')
        elif '*' in rule.get('verbs', []):
            resources = rule.get('resources', [])
            print(f'[HIGH] {name}: resources={resources}, verbs=[*]')
" 2>/dev/null
```

```text
[CRITICAL] cluster-admin: resources=[*], verbs=[*]
[CRITICAL] system:controller:generic-garbage-collector: resources=[*], verbs=[*]
```

`cluster-admin`은 예상된 결과이지만, 사용자 정의 ClusterRole에 와일드카드가 있으면 즉시 수정해야 한다.

#### 학습 목표
- Kubernetes RBAC의 4가지 리소스(Role, ClusterRole, RoleBinding, ClusterRoleBinding)를 이해한다.
- 클러스터에 정의된 주요 ClusterRole과 ClusterRoleBinding을 분석한다.
- RBAC의 보안 원칙과 모범 사례를 파악한다.

#### 실습 단계

**1단계: ClusterRole 목록 확인**

```bash
kubectl get clusterrole | head -30
```

예상 출력 (일부):
```
NAME                                                                   CREATED AT
admin                                                                  ...
cluster-admin                                                          ...
edit                                                                   ...
system:aggregate-to-admin                                              ...
system:aggregate-to-edit                                                ...
system:aggregate-to-view                                                ...
system:controller:*                                                     ...
view                                                                   ...
```

**2단계: cluster-admin ClusterRole 분석**

```bash
kubectl get clusterrole cluster-admin -o yaml
```

예상 출력:
```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: cluster-admin
rules:
- apiGroups:
  - '*'
  resources:
  - '*'
  verbs:
  - '*'
- nonResourceURLs:
  - '*'
  verbs:
  - '*'
```

`cluster-admin`은 모든 리소스에 대한 모든 권한을 가진 최상위 역할이다. 이 역할은 절대 일반 사용자에게 부여해서는 안 된다.

**3단계: 기본 ClusterRole 비교 분석**

```bash
# admin ClusterRole — 네임스페이스 내 거의 모든 리소스 관리 가능
kubectl get clusterrole admin -o yaml | grep -A 2 "verbs:"

# edit ClusterRole — admin과 유사하지만 RBAC 관련 리소스 수정 불가
kubectl get clusterrole edit -o yaml | grep -A 2 "verbs:"

# view ClusterRole — 읽기 전용
kubectl get clusterrole view -o yaml | grep -A 2 "verbs:"
```

| ClusterRole | 권한 수준 | 주요 차이 |
|-------------|----------|----------|
| cluster-admin | 최상위 — 모든 것 | 클러스터 전체 관리 |
| admin | 높음 — 네임스페이스 관리 | RBAC, 리소스 쿼터 관리 가능 |
| edit | 중간 — 리소스 수정 | RBAC 수정 불가 |
| view | 낮음 — 읽기 전용 | Secret 읽기는 가능 |

**4단계: ClusterRoleBinding 목록 확인**

```bash
kubectl get clusterrolebinding | head -30
```

**5단계: cluster-admin 바인딩 확인**

```bash
kubectl get clusterrolebinding cluster-admin -o yaml
```

예상 출력:
```yaml
subjects:
- apiGroup: rbac.authorization.k8s.io
  kind: Group
  name: system:masters
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: cluster-admin
```

`system:masters` 그룹에 `cluster-admin` ClusterRole이 바인딩되어 있다. kubeadm으로 생성된 관리자 kubeconfig가 이 그룹에 속한다.

**6단계: demo 네임스페이스의 Role/RoleBinding 확인**

```bash
# demo 네임스페이스의 Role 확인
kubectl get role -n demo

# demo 네임스페이스의 RoleBinding 확인
kubectl get rolebinding -n demo
```

**7단계: 특정 ServiceAccount의 권한 확인**

```bash
# demo 네임스페이스의 default ServiceAccount가 할 수 있는 작업 목록
kubectl auth can-i --list --as=system:serviceaccount:demo:default -n demo
```

예상 출력:
```
Resources                          Non-Resource URLs   Resource Names   Verbs
selfsubjectreviews.authentication.k8s.io   []          []               [create]
selfsubjectaccessreviews.authorization.k8s.io []      []               [create]
selfsubjectrulesreviews.authorization.k8s.io  []      []               [create]
...
```

default ServiceAccount는 기본적으로 매우 제한된 권한만 가지고 있다.

**8단계: 위험한 RBAC 설정 탐지**

```bash
# wildcard(*) 권한을 가진 ClusterRole 찾기
kubectl get clusterrole -o json | python3 -c "
import json, sys
data = json.load(sys.stdin)
for item in data['items']:
    name = item['metadata']['name']
    for rule in item.get('rules', []):
        if '*' in rule.get('verbs', []) and '*' in rule.get('resources', []):
            print(f'WARNING: {name} has wildcard permissions')
" 2>/dev/null
```

#### 확인 문제
1. ClusterRole과 Role의 차이는 무엇인가?
2. ClusterRoleBinding과 RoleBinding의 적용 범위 차이는 무엇인가?
3. `cluster-admin` ClusterRole을 일반 사용자에게 부여하면 어떤 위험이 있는가?
4. `view` ClusterRole이 Secret을 읽을 수 있다면 어떤 보안 문제가 발생하는가?

#### 관련 KCSA 시험 주제
- RBAC 4가지 리소스
- 최소 권한 원칙
- 기본 ClusterRole (admin, edit, view)
- ServiceAccount 권한 관리

---

### Lab 3.5: 최소 권한 Role 생성 실습

#### 등장 배경과 기존 한계점

최소 권한 원칙(Principle of Least Privilege)은 1975년 Jerome Saltzer와 Michael Schroeder가 제안한 보안 설계 원칙이다. "모든 프로그램과 모든 특권 사용자는 업무 수행에 필요한 최소한의 권한만 가져야 한다"는 원칙이다.

Kubernetes에서 최소 권한 원칙이 중요한 이유:
1. **침해 범위 최소화**: Pod가 침해되었을 때 공격자가 접근할 수 있는 리소스 범위를 제한한다.
2. **실수 방지**: 개발자가 의도하지 않게 중요 리소스를 삭제/수정하는 것을 방지한다.
3. **컴플라이언스**: SOC 2, ISO 27001 등의 규정이 최소 권한 원칙을 요구한다.
4. **감사 효율**: 각 주체의 권한이 명확하면 비정상 접근 패턴을 쉽게 탐지할 수 있다.

기존 방식의 한계: 많은 조직에서 편의를 위해 개발자에게 `cluster-admin` 또는 `admin` ClusterRole을 부여한다. 이는 개발 속도를 높이지만, 하나의 계정 침해로 전체 클러스터가 위험해진다.

RBAC 설계 모범 사례:
1. **기본 거부**: RBAC는 기본적으로 모든 접근을 거부한다. 필요한 권한만 명시적으로 부여한다.
2. **네임스페이스 분리**: Role(네임스페이스 범위)을 우선 사용하고, ClusterRole은 진정으로 클러스터 범위가 필요한 경우에만 사용한다.
3. **verb 최소화**: `["*"]` 대신 필요한 verb(get, list, create 등)만 지정한다.
4. **resourceNames 활용**: 특정 리소스 인스턴스에만 접근을 허용한다(예: 특정 ConfigMap만).
5. **감사 정기 실행**: `kubectl auth can-i --list`로 정기적으로 권한을 점검한다.

#### 트러블슈팅 가이드

**문제: Role 생성 후 권한이 적용되지 않는 경우**

```bash
# Role이 존재하는지 확인
kubectl get role pod-viewer -n demo
```

```text
NAME         CREATED AT
pod-viewer   2024-01-15T10:00:00Z
```

```bash
# RoleBinding이 올바르게 연결되었는지 확인
kubectl get rolebinding pod-viewer-binding -n demo -o yaml | grep -A5 "subjects:"
```

```text
subjects:
- kind: ServiceAccount
  name: pod-viewer-sa
  namespace: demo
```

```bash
# RoleBinding의 roleRef 확인
kubectl get rolebinding pod-viewer-binding -n demo -o yaml | grep -A5 "roleRef:"
```

```text
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: pod-viewer
```

subjects와 roleRef가 올바르면 권한이 즉시 적용된다. RBAC 변경은 API Server 재시작 없이 즉시 반영된다.

**문제: ClusterRoleBinding으로 네임스페이스 Role을 바인딩하는 실수**

ClusterRoleBinding은 ClusterRole만 참조할 수 있다. 네임스페이스 Role을 ClusterRoleBinding으로 바인딩하면 오류가 발생한다.

```bash
# 잘못된 바인딩 시도
kubectl create clusterrolebinding wrong-binding --role=pod-viewer --serviceaccount=demo:pod-viewer-sa 2>&1
```

```text
error: failed to create clusterrolebinding: ... roles can only be referenced by RoleBindings
```

#### 학습 목표
- 최소 권한 원칙(Principle of Least Privilege)에 따라 Role을 생성한다.
- 특정 작업만 수행할 수 있는 세밀한 RBAC 정책을 설계한다.
- 생성한 Role의 권한을 테스트하여 올바르게 동작하는지 확인한다.

#### 실습 단계

**1단계: 시나리오 정의**

demo 네임스페이스의 Pod 상태만 조회할 수 있는 "pod-viewer" Role을 생성한다. 이 Role은 Pod의 목록 조회(list)와 상세 조회(get)만 가능하고, 생성/수정/삭제는 불가능해야 한다.

**2단계: Role 생성**

```bash
kubectl create role pod-viewer \
  --verb=get,list,watch \
  --resource=pods \
  -n demo
```

예상 출력:
```
role.rbac.authorization.k8s.io/pod-viewer created
```

**3단계: Role 내용 확인**

```bash
kubectl get role pod-viewer -n demo -o yaml
```

예상 출력:
```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: pod-viewer
  namespace: demo
rules:
- apiGroups:
  - ""
  resources:
  - pods
  verbs:
  - get
  - list
  - watch
```

**4단계: ServiceAccount 생성 및 RoleBinding**

```bash
# ServiceAccount 생성
kubectl create serviceaccount pod-viewer-sa -n demo

# RoleBinding 생성 — pod-viewer-sa에 pod-viewer Role 바인딩
kubectl create rolebinding pod-viewer-binding \
  --role=pod-viewer \
  --serviceaccount=demo:pod-viewer-sa \
  -n demo
```

**5단계: 권한 테스트 — 허용된 작업**

```bash
# Pod 목록 조회 (허용됨)
kubectl auth can-i list pods --as=system:serviceaccount:demo:pod-viewer-sa -n demo
```

예상 출력:
```
yes
```

```bash
# Pod 상세 조회 (허용됨)
kubectl auth can-i get pods --as=system:serviceaccount:demo:pod-viewer-sa -n demo
```

예상 출력:
```
yes
```

**6단계: 권한 테스트 — 차단된 작업**

```bash
# Pod 생성 (차단됨)
kubectl auth can-i create pods --as=system:serviceaccount:demo:pod-viewer-sa -n demo
```

예상 출력:
```
no
```

```bash
# Pod 삭제 (차단됨)
kubectl auth can-i delete pods --as=system:serviceaccount:demo:pod-viewer-sa -n demo
```

예상 출력:
```
no
```

```bash
# Secret 조회 (차단됨)
kubectl auth can-i get secrets --as=system:serviceaccount:demo:pod-viewer-sa -n demo
```

예상 출력:
```
no
```

```bash
# 다른 네임스페이스의 Pod 조회 (차단됨)
kubectl auth can-i list pods --as=system:serviceaccount:demo:pod-viewer-sa -n kube-system
```

예상 출력:
```
no
```

**7단계: 전체 권한 목록 확인**

```bash
kubectl auth can-i --list --as=system:serviceaccount:demo:pod-viewer-sa -n demo
```

**8단계: 정리**

```bash
kubectl delete rolebinding pod-viewer-binding -n demo
kubectl delete role pod-viewer -n demo
kubectl delete serviceaccount pod-viewer-sa -n demo
```

#### 확인 문제
1. Role에서 `apiGroups: [""]`이 의미하는 바는 무엇인가?
2. `watch` verb의 역할은 무엇이며, `list`와의 차이는 무엇인가?
3. 이 Role을 ClusterRole로 변경하면 어떤 차이가 발생하는가?
4. 최소 권한 원칙을 RBAC에 적용할 때 주의할 점은 무엇인가?

#### 관련 KCSA 시험 주제
- 최소 권한 원칙 (Principle of Least Privilege)
- Role/RoleBinding 생성
- RBAC 권한 테스트 (`kubectl auth can-i`)

---

### Lab 3.6: ServiceAccount 보안 확인 (automountServiceAccountToken)

#### 등장 배경과 기존 한계점

Kubernetes ServiceAccount 토큰 관리의 발전 과정:

**Phase 1 (Kubernetes 1.0~1.20)**: ServiceAccount 생성 시 자동으로 Secret이 생성되고, 이 Secret에 만료 없는 JWT 토큰이 포함되었다. 토큰이 유출되면 Secret을 삭제하기 전까지 영구적으로 사용 가능했다.

**Phase 2 (Kubernetes 1.21~1.23)**: BoundServiceAccountToken 기능이 기본 활성화되어, Pod에 마운트되는 토큰은 만료 시간(기본 1시간, 갱신 가능)이 있는 바운드 토큰으로 변경되었다. 그러나 자동 Secret 생성은 여전히 유지되었다.

**Phase 3 (Kubernetes 1.24+)**: ServiceAccount 자동 Secret 생성이 완전히 중단되었다. `kubectl create token` 명령 또는 TokenRequest API로 필요한 시점에 토큰을 발급한다. Pod에 마운트되는 토큰은 projected volume을 통해 자동 갱신되는 바운드 토큰이다.

#### 공격-방어 매핑

| 공격 벡터 | automountServiceAccountToken=true | automountServiceAccountToken=false |
|----------|----------------------------------|-----------------------------------|
| Pod 침해 후 SA 토큰 탈취 | `/var/run/secrets/.../token` 읽기 가능 | 토큰 파일 미존재 |
| 탈취한 토큰으로 API Server 접근 | SA에 바인딩된 RBAC 권한으로 API 호출 가능 | 불가능 |
| 횡적 이동 (Secret 읽기) | SA에 Secret 읽기 권한이 있으면 탈취 가능 | 불가능 |
| Pod exec로 다른 Pod 접근 | SA에 exec 권한이 있으면 가능 | 불가능 |

#### 트러블슈팅 가이드

**문제: automountServiceAccountToken=false 설정 후 앱이 API Server에 접근하지 못하는 경우**

일부 앱(Prometheus, ArgoCD 등)은 API Server와 통신해야 한다. 이 경우 automountServiceAccountToken=false를 사용하되, 필요한 Pod에서만 명시적으로 활성화한다.

```bash
# Pod 레벨에서 명시적 활성화
kubectl get pod <pod-name> -n <namespace> -o jsonpath='{.spec.automountServiceAccountToken}'
```

```text
true
```

```bash
# ServiceAccount 레벨에서 비활성화, Pod 레벨에서 활성화하는 패턴
# ServiceAccount: automountServiceAccountToken: false (기본 비활성화)
# Pod: automountServiceAccountToken: true (필요한 Pod만 활성화)
```

**문제: Kubernetes 1.24+ 환경에서 장기 토큰이 필요한 경우**

```bash
# 수동으로 장기 토큰 Secret 생성 (Kubernetes 1.24+)
kubectl apply -f - <<EOF
apiVersion: v1
kind: Secret
metadata:
  name: my-sa-token
  namespace: demo
  annotations:
    kubernetes.io/service-account.name: my-sa
type: kubernetes.io/service-account-token
EOF
```

```bash
# 생성된 토큰 확인
kubectl get secret my-sa-token -n demo -o jsonpath='{.data.token}' | base64 -d
```

```text
eyJhbGciOiJSUzI1NiIsImtpZCI6IjEyMzQ1Njc4OTAifQ...
```

> **보안 경고**: 장기 토큰은 보안 위험이 있으므로 TokenRequest API를 통한 단기 토큰 사용이 권장된다.

#### 학습 목표
- ServiceAccount 토큰의 자동 마운트 메커니즘을 이해한다.
- `automountServiceAccountToken: false`의 보안적 의미를 파악한다.
- 불필요한 토큰 마운트가 초래하는 보안 위험을 설명할 수 있다.

#### 실습 단계

**1단계: demo 네임스페이스의 ServiceAccount 목록**

```bash
kubectl get sa -n demo
```

예상 출력:
```
NAME      SECRETS   AGE
default   0         XXd
```

**2단계: default ServiceAccount의 automountServiceAccountToken 확인**

```bash
kubectl get sa default -n demo -o yaml
```

예상 출력:
```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: default
  namespace: demo
```

`automountServiceAccountToken` 필드가 명시되지 않은 경우, 기본값은 `true`이다. 즉, 이 ServiceAccount를 사용하는 모든 Pod에 자동으로 API Server 접근 토큰이 마운트된다.

**3단계: Pod에 마운트된 ServiceAccount 토큰 확인**

```bash
# nginx Pod의 ServiceAccount 토큰 마운트 확인
kubectl exec -n demo $(kubectl get pod -n demo -l app=nginx-web -o name | head -1) -c nginx-web -- \
  ls /var/run/secrets/kubernetes.io/serviceaccount/
```

예상 출력:
```
ca.crt
namespace
token
```

```bash
# 토큰 내용 확인 (JWT)
kubectl exec -n demo $(kubectl get pod -n demo -l app=nginx-web -o name | head -1) -c nginx-web -- \
  cat /var/run/secrets/kubernetes.io/serviceaccount/token
```

이 토큰을 사용하면 Pod 내부에서 API Server에 인증된 요청을 보낼 수 있다. 컨테이너가 침투당하면 공격자가 이 토큰을 탈취하여 클러스터 API에 접근할 수 있다.

**4단계: 토큰으로 API Server 접근 시도**

```bash
# nginx Pod 내부에서 API Server에 접근
kubectl exec -n demo $(kubectl get pod -n demo -l app=nginx-web -o name | head -1) -c nginx-web -- \
  sh -c 'TOKEN=$(cat /var/run/secrets/kubernetes.io/serviceaccount/token) && \
  curl -s -k -H "Authorization: Bearer $TOKEN" \
  https://kubernetes.default.svc.cluster.local/api/v1/namespaces/demo/pods' 2>/dev/null | head -5
```

RBAC에 의해 제한될 수 있지만, 토큰 자체는 유효한 인증 수단이다.

**5단계: 각 Pod의 automountServiceAccountToken 설정 확인**

```bash
for app in nginx-web httpbin redis postgres rabbitmq keycloak; do
  echo "=== $app ==="
  kubectl get pod -n demo -l app=$app -o jsonpath='{.items[0].spec.automountServiceAccountToken}' 2>/dev/null
  echo ""
done
```

**6단계: 보안 개선 — automountServiceAccountToken 비활성화 테스트**

```bash
# automountServiceAccountToken을 false로 설정한 테스트 Pod 생성
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: secure-test
  namespace: demo
  labels:
    test: secure
spec:
  automountServiceAccountToken: false
  containers:
  - name: busybox
    image: busybox:1.36
    command: ["sleep", "3600"]
EOF
```

```bash
# 토큰 마운트 확인 — 마운트되지 않아야 한다
kubectl exec -n demo secure-test -- ls /var/run/secrets/kubernetes.io/serviceaccount/ 2>&1
```

예상 출력:
```
ls: /var/run/secrets/kubernetes.io/serviceaccount/: No such file or directory
```

토큰 디렉토리가 존재하지 않는다. 이 Pod가 침투당하더라도 API Server 토큰을 탈취할 수 없다.

**7단계: 정리**

```bash
kubectl delete pod secure-test -n demo --grace-period=0 --force
```

#### 확인 문제
1. ServiceAccount 토큰이 Pod에 자동 마운트되면 어떤 공격 벡터가 열리는가?
2. `automountServiceAccountToken: false`를 Pod 수준과 ServiceAccount 수준 중 어디에 설정하는 것이 좋은가?
3. API Server에 접근할 필요 없는 애플리케이션 Pod에서 토큰 마운트를 비활성화해야 하는 이유는?
4. Kubernetes 1.24 이후 ServiceAccount 토큰 관리 방식이 어떻게 변경되었는가?

#### 관련 KCSA 시험 주제
- ServiceAccount 토큰 보안
- automountServiceAccountToken
- Pod 보안 모범 사례
- 자격 증명(Credential) 관리

---

### Lab 3.7: Secret 보안 분석 (postgres/rabbitmq 패스워드 base64 디코딩)

#### 등장 배경과 기존 한계점

Kubernetes Secret은 비밀번호, API 키, TLS 인증서 등 민감 데이터를 관리하기 위한 리소스이다. Secret이 도입되기 전에는 민감 데이터를 ConfigMap이나 환경 변수에 직접 저장하는 방식이 일반적이었다. 이 방식의 문제점:

1. **Git 노출**: Deployment YAML에 평문 비밀번호가 포함되어 Git 리포지토리에 커밋되면, 리포지토리에 접근할 수 있는 모든 사용자가 비밀번호를 볼 수 있다.
2. **RBAC 분리 불가**: ConfigMap과 민감 데이터가 동일한 리소스 유형이면 접근 권한을 분리할 수 없다.
3. **감사 불가**: 누가 민감 데이터에 접근했는지 추적할 수 없다.

Kubernetes Secret은 이 문제를 부분적으로 해결한다. Secret은 별도의 리소스 유형이므로 RBAC로 접근 권한을 분리할 수 있고, Audit 로그로 접근을 추적할 수 있다. 그러나 중요한 한계가 있다: Secret의 데이터는 base64 인코딩일 뿐 암호화가 아니다. etcd에 저장된 Secret은 EncryptionConfiguration 없이는 평문과 다름없다.

이 한계를 극복하기 위한 발전 과정:
1. **EncryptionConfiguration (Kubernetes 1.7+)**: etcd에 저장되는 Secret을 AES 등으로 암호화한다.
2. **KMS v1/v2 (Kubernetes 1.10+/1.27+)**: 외부 KMS와 연동하여 봉투 암호화를 수행한다.
3. **External Secrets Operator**: 외부 비밀 저장소(Vault, AWS SM 등)와 자동 동기화한다.
4. **CSI Secret Store Driver**: 파일시스템 볼륨으로 Secret을 마운트하며, etcd 미저장 옵션을 제공한다.

#### 공격-방어 매핑

| 공격 벡터 | 현재 tart-infra 상태 | 위험도 | 대응 방안 |
|----------|---------------------|--------|----------|
| `kubectl get secret -o yaml`로 Secret 읽기 | 평문 비밀번호 확인 가능 | 높음 | RBAC로 Secret 접근 제한 |
| etcd 직접 접근으로 데이터 읽기 | 암호화 미적용 시 평문 읽기 | 높음 | EncryptionConfiguration 적용 |
| 환경 변수에 평문 비밀번호 저장 | `kubectl describe pod`로 확인 가능 | 높음 | Secret으로 이관 |
| Pod 침투 후 환경 변수 읽기 | `/proc/1/environ`에서 확인 가능 | 높음 | volumeMount 방식 Secret 사용 |
| Git 리포지토리에 비밀번호 노출 | YAML에 비밀번호 포함 | 높음 | Sealed Secrets 또는 ESO 사용 |

#### 트러블슈팅 가이드

**문제: Secret 데이터가 base64 디코딩되지 않는 경우**

```bash
# Secret의 data 필드 확인 (base64 인코딩)
kubectl get secret demo-passwords -n demo -o jsonpath='{.data.postgres-password}'
```

```text
ZGVtbzEyMw==
```

```bash
# base64 디코딩
echo "ZGVtbzEyMw==" | base64 -d
```

```text
demo123
```

base64 디코딩이 실패하는 경우는 대부분 줄바꿈 문자가 포함된 경우이다. `base64 -d` 대신 `base64 --decode`를 사용하거나, `tr -d '\n'`으로 줄바꿈을 제거한다.

**문제: Secret을 환경 변수에서 volumeMount로 전환하는 방법**

환경 변수 방식은 `/proc/1/environ`에서 읽을 수 있어 보안이 취약하다. volumeMount 방식은 파일 시스템 권한으로 보호된다.

```yaml
# 환경 변수 방식 (취약)
env:
  - name: DB_PASSWORD
    valueFrom:
      secretKeyRef:
        name: db-secret
        key: password

# volumeMount 방식 (권장)
volumeMounts:
  - name: db-secret
    mountPath: /etc/secrets
    readOnly: true
volumes:
  - name: db-secret
    secret:
      secretName: db-secret
```

검증:
```bash
# volumeMount 방식 확인
kubectl exec -n demo <pod-name> -- ls -la /etc/secrets/
```

```text
total 0
lrwxrwxrwx 1 root root 15 Jan 15 10:00 password -> ..data/password
```

```bash
# 파일 내용 확인
kubectl exec -n demo <pod-name> -- cat /etc/secrets/password
```

```text
demo123
```

#### 학습 목표
- Kubernetes Secret이 base64 인코딩일 뿐 암호화가 아님을 이해한다.
- Secret에 저장된 민감 정보를 디코딩하여 보안 위험을 체험한다.
- Secret 보안 강화 방안(encryption at rest, external secret manager)을 파악한다.

#### 실습 단계

**1단계: demo 네임스페이스의 Secret 목록 확인**

```bash
kubectl get secret -n demo
```

예상 출력:
```
NAME                    TYPE                                  DATA   AGE
default-token-xxxxx     kubernetes.io/service-account-token   3      XXd
postgres-secret         Opaque                                X      XXd
rabbitmq-secret         Opaque                                X      XXd
...
```

**2단계: postgres Secret 내용 확인**

```bash
kubectl get secret -n demo -l app=postgres -o yaml 2>/dev/null || \
kubectl get secret postgres-secret -n demo -o yaml 2>/dev/null || \
echo "Secret을 찾을 수 없음 — 환경 변수에 직접 값이 설정되어 있을 수 있다"
```

Secret이 존재하는 경우:
```bash
# base64로 인코딩된 비밀번호 확인
kubectl get secret postgres-secret -n demo -o jsonpath='{.data.password}' 2>/dev/null
```

**3단계: base64 디코딩 시연**

```bash
# base64 인코딩은 암호화가 아니다 — 누구나 디코딩할 수 있다
echo "demo123" | base64
# 출력: ZGVtbzEyMwo=

echo "ZGVtbzEyMwo=" | base64 -d
# 출력: demo123
```

이 시연은 base64가 얼마나 쉽게 디코딩되는지를 보여준다. Secret에 저장된 값은 `kubectl get secret -o yaml`로 조회할 수 있는 모든 사용자가 디코딩할 수 있다.

**4단계: 환경 변수에서 직접 비밀번호 확인 (Secret 미사용 시)**

```bash
# postgres Pod의 환경 변수에서 비밀번호 직접 확인
kubectl get pod -n demo -l app=postgres -o jsonpath='{.items[0].spec.containers[0].env[?(@.name=="POSTGRES_PASSWORD")].value}'
```

예상 출력:
```
demo123
```

```bash
# rabbitmq Pod의 환경 변수에서 비밀번호 직접 확인
kubectl get pod -n demo -l app=rabbitmq -o jsonpath='{.items[0].spec.containers[0].env[?(@.name=="RABBITMQ_DEFAULT_PASS")].value}'
```

예상 출력:
```
demo123
```

```bash
# keycloak Pod의 환경 변수에서 관리자 비밀번호 확인
kubectl get pod -n demo -l app=keycloak -o jsonpath='{.items[0].spec.containers[0].env[?(@.name=="KEYCLOAK_ADMIN_PASSWORD")].value}'
```

예상 출력:
```
admin
```

**5단계: Secret으로 비밀번호 관리하는 올바른 방법 시연**

```bash
# Secret 생성
kubectl create secret generic demo-passwords \
  --from-literal=postgres-password=demo123 \
  --from-literal=rabbitmq-password=demo123 \
  --from-literal=keycloak-admin-password=admin \
  -n demo
```

```bash
# 생성된 Secret 확인 — base64로 인코딩되어 저장됨
kubectl get secret demo-passwords -n demo -o yaml
```

예상 출력:
```yaml
apiVersion: v1
kind: Secret
metadata:
  name: demo-passwords
  namespace: demo
type: Opaque
data:
  keycloak-admin-password: YWRtaW4=
  postgres-password: ZGVtbzEyMw==
  rabbitmq-password: ZGVtbzEyMw==
```

```bash
# Secret 값을 디코딩하여 원본 확인
kubectl get secret demo-passwords -n demo -o jsonpath='{.data.postgres-password}' | base64 -d
```

예상 출력:
```
demo123
```

**6단계: Encryption at Rest 설정 확인**

```bash
# API Server에 encryption-provider-config가 설정되어 있는지 확인
ssh admin@<dev-master-ip> 'sudo cat /etc/kubernetes/manifests/kube-apiserver.yaml' | grep encryption-provider
```

설정이 없다면 etcd에 저장된 Secret은 평문(base64 인코딩만)으로 저장되어 있다.

**7단계: 정리**

```bash
kubectl delete secret demo-passwords -n demo
```

**8단계: 보안 개선 방안 정리**

| 현재 상태 | 위험도 | 개선 방안 |
|-----------|-------|----------|
| 환경 변수에 평문 비밀번호 | 높음 | Kubernetes Secret으로 이관 |
| Secret이 base64 인코딩만 | 중간 | Encryption at Rest 설정 |
| etcd 평문 저장 | 높음 | EncryptionConfiguration 적용 |
| 외부 Secret 관리 없음 | 중간 | Vault, AWS Secrets Manager 등 연동 |

#### 확인 문제
1. base64 인코딩과 암호화의 차이는 무엇인가?
2. Kubernetes Secret의 `type: Opaque`는 무엇을 의미하는가?
3. Encryption at Rest를 설정하면 Secret이 어떻게 보호되는가?
4. 외부 Secret 관리 도구(Vault 등)를 사용하면 어떤 추가 이점이 있는가?
5. Secret에 접근할 수 있는 RBAC 권한을 제한해야 하는 이유는?

#### 관련 KCSA 시험 주제
- Secret 관리
- base64 인코딩 vs 암호화
- Encryption at Rest
- 외부 Secret 관리 통합

---

### Lab 3.8: Pod Security Admission 실습 (restricted 네임스페이스 생성 → 위반 Pod 배포)

#### 등장 배경과 기존 한계점

Pod Security Admission(PSA)은 PodSecurityPolicy(PSP)의 후속 메커니즘이다. PSP는 Kubernetes 1.0부터 존재했으나, 여러 근본적인 문제로 Kubernetes 1.21에서 deprecated, 1.25에서 제거되었다.

PSP의 한계:
1. **복잡한 바인딩 모델**: PSP는 RBAC를 통해 간접적으로 적용되어, 어떤 PSP가 어떤 Pod에 적용되는지 파악하기 어려웠다.
2. **우선순위 문제**: 여러 PSP가 매칭될 때 우선순위 결정 규칙이 복잡하고 예측하기 어려웠다.
3. **Dry-run 미지원**: 기존 워크로드에 PSP를 적용했을 때의 영향을 사전에 파악할 수 없었다.
4. **Mutating과 Validating 혼합**: PSP는 Pod 스펙을 수정(mutate)하고 검증(validate)하는 기능을 동시에 수행하여 동작 예측이 어려웠다.

PSA는 이 문제를 해결하기 위해 설계되었다:
1. **네임스페이스 레이블 기반**: 단순한 레이블로 정책 적용 — RBAC 바인딩 불필요
2. **3가지 표준화된 프로파일**: privileged, baseline, restricted — 명확한 보안 수준 계층
3. **3가지 동작 모드**: enforce(차단), audit(감사), warn(경고) — 점진적 적용 가능

#### 공격-방어 매핑

| 공격 벡터 | baseline에서 차단 | restricted에서 추가 차단 |
|----------|-----------------|----------------------|
| privileged 컨테이너로 호스트 탈출 | 차단 | 차단 |
| hostNetwork로 네트워크 스니핑 | 차단 | 차단 |
| hostPath로 호스트 파일시스템 접근 | 차단 | 차단 |
| root 사용자(UID 0)로 권한 상승 | 허용 | 차단 (runAsNonRoot 필수) |
| allowPrivilegeEscalation으로 setuid 악용 | 허용 | 차단 |
| 불필요한 Linux capabilities 악용 | 허용 | 차단 (drop: ALL 필수) |
| seccomp 미설정으로 커널 공격 | 허용 | 차단 (RuntimeDefault 필수) |

#### 트러블슈팅 가이드

**문제: restricted 위반 Pod의 정확한 위반 항목 확인**

```bash
# dry-run으로 위반 항목 상세 확인
kubectl run violation-check --image=nginx -n psa-test --dry-run=server 2>&1
```

```text
Error from server (Forbidden): pods "violation-check" is forbidden:
violates PodSecurity "restricted:latest":
  allowPrivilegeEscalation != false (container "violation-check" must set securityContext.allowPrivilegeEscalation=false),
  unrestricted capabilities (container "violation-check" must set securityContext.capabilities.drop=["ALL"]),
  runAsNonRoot != true (pod or container "violation-check" must set securityContext.runAsNonRoot=true),
  seccompProfile (pod or container "violation-check" must set securityContext.seccompProfile.type to "RuntimeDefault" or "Localhost")
```

이 출력은 위반 항목을 정확히 나열하므로, 하나씩 수정하여 준수하는 Pod 스펙을 작성할 수 있다.

#### 학습 목표
- Pod Security Admission(PSA)의 3가지 프로파일(privileged, baseline, restricted)을 이해한다.
- PSA의 3가지 모드(enforce, audit, warn)의 동작 차이를 파악한다.
- restricted 프로파일이 적용된 네임스페이스에서 보안 위반 Pod를 배포하여 차단되는 것을 확인한다.

#### 실습 단계

**1단계: PSA 개념 이해**

```
PSA 프로파일:
┌─────────────────────────────────────────────────┐
│ privileged (특권)                                │  ← 제한 없음
│  ┌──────────────────────────────────────────┐   │
│  │ baseline (기준)                           │   │  ← 알려진 권한 상승 차단
│  │  ┌───────────────────────────────────┐   │   │
│  │  │ restricted (제한)                  │   │   │  ← 최소 권한 강제
│  │  └───────────────────────────────────┘   │   │
│  └──────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

**2단계: restricted 프로파일 네임스페이스 생성**

```bash
kubectl create namespace psa-test

# restricted 프로파일을 enforce 모드로 적용
kubectl label namespace psa-test \
  pod-security.kubernetes.io/enforce=restricted \
  pod-security.kubernetes.io/enforce-version=latest \
  pod-security.kubernetes.io/audit=restricted \
  pod-security.kubernetes.io/warn=restricted
```

```bash
# 레이블 확인
kubectl get namespace psa-test -o yaml | grep pod-security
```

예상 출력:
```
    pod-security.kubernetes.io/audit: restricted
    pod-security.kubernetes.io/enforce: restricted
    pod-security.kubernetes.io/enforce-version: latest
    pod-security.kubernetes.io/warn: restricted
```

**3단계: 보안 위반 Pod 배포 시도 — privileged 컨테이너**

```bash
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: privileged-pod
  namespace: psa-test
spec:
  containers:
  - name: test
    image: busybox:1.36
    command: ["sleep", "3600"]
    securityContext:
      privileged: true
EOF
```

예상 출력:
```
Error from server (Forbidden): error when creating "STDIN": pods "privileged-pod" is forbidden:
violates PodSecurity "restricted:latest": privileged (container "test" must not set
securityContext.privileged=true), ...
```

privileged 컨테이너는 restricted 프로파일에서 완전히 차단된다.

**4단계: 보안 위반 Pod 배포 시도 — root 사용자**

```bash
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: root-pod
  namespace: psa-test
spec:
  containers:
  - name: test
    image: busybox:1.36
    command: ["sleep", "3600"]
    securityContext:
      runAsUser: 0
EOF
```

예상 출력:
```
Error from server (Forbidden): error when creating "STDIN": pods "root-pod" is forbidden:
violates PodSecurity "restricted:latest": runAsUser=0 (pod must not set runAsUser=0), ...
```

root(UID 0)로 실행하는 Pod도 차단된다.

**5단계: 보안 위반 Pod 배포 시도 — hostNetwork**

```bash
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: hostnet-pod
  namespace: psa-test
spec:
  hostNetwork: true
  containers:
  - name: test
    image: busybox:1.36
    command: ["sleep", "3600"]
    securityContext:
      runAsNonRoot: true
      runAsUser: 1000
      seccompProfile:
        type: RuntimeDefault
      allowPrivilegeEscalation: false
      capabilities:
        drop:
          - ALL
EOF
```

예상 출력:
```
Error from server (Forbidden): ... violates PodSecurity "restricted:latest": hostNetwork ...
```

**6단계: restricted 프로파일을 준수하는 Pod 배포 (성공)**

```bash
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: secure-pod
  namespace: psa-test
spec:
  securityContext:
    runAsNonRoot: true
    runAsUser: 1000
    seccompProfile:
      type: RuntimeDefault
  containers:
  - name: test
    image: busybox:1.36
    command: ["sleep", "3600"]
    securityContext:
      allowPrivilegeEscalation: false
      capabilities:
        drop:
          - ALL
EOF
```

예상 출력:
```
pod/secure-pod created
```

이 Pod는 restricted 프로파일의 모든 조건을 충족한다:
- `runAsNonRoot: true` — root가 아닌 사용자로 실행
- `runAsUser: 1000` — UID 1000으로 실행
- `seccompProfile.type: RuntimeDefault` — seccomp 프로파일 적용
- `allowPrivilegeEscalation: false` — 권한 상승 차단
- `capabilities.drop: [ALL]` — 모든 Linux capability 제거

**7단계: 정리**

```bash
kubectl delete namespace psa-test
```

#### 확인 문제
1. PSA의 3가지 프로파일(privileged, baseline, restricted)의 차이를 설명하라.
2. enforce 모드와 warn 모드의 차이는 무엇인가?
3. restricted 프로파일에서 반드시 설정해야 하는 securityContext 항목들을 나열하라.
4. PSA가 PodSecurityPolicy(PSP)를 대체한 이유는 무엇인가?

#### 관련 KCSA 시험 주제
- Pod Security Admission (PSA)
- Pod Security Standards (privileged, baseline, restricted)
- SecurityContext 모범 사례
- 워크로드 보안

---

## 실습 4: Threat Model (16%)

위협 모델링 기법(STRIDE)과 공급망 보안을 tart-infra 환경에 적용한다.

---

### Lab 4.1: STRIDE 위협 모델 적용 (demo 앱 6개에 STRIDE 분석)

#### 등장 배경과 기존 한계점

STRIDE는 1999년 Microsoft의 Loren Kohnfelder와 Praerit Garg가 개발한 위협 모델링 프레임워크이다. 소프트웨어 시스템의 보안 위협을 체계적으로 분류하기 위해 설계되었다.

위협 모델링이 필요한 이유: 보안 취약점은 구현 오류뿐 아니라 설계 결함에서도 발생한다. 코드 리뷰나 취약점 스캔은 구현 오류를 발견할 수 있지만, 아키텍처 수준의 보안 결함(예: 인증 없이 노출된 API, 감사 로그 부재)은 설계 단계에서 위협 모델링을 통해 식별해야 한다.

STRIDE 이전에는 ad-hoc 방식으로 보안 위협을 나열하였으나, 위협 범주가 체계화되지 않아 누락이 빈번하였다. STRIDE는 6가지 위협 범주를 제공하여 체계적인 분석을 가능하게 한다.

Kubernetes 환경에서 STRIDE를 적용할 때는 MITRE ATT&CK for Containers 프레임워크와 결합하면 효과적이다. STRIDE는 위협을 분류하는 프레임워크이고, MITRE ATT&CK는 실제 공격 기법을 목록화한 지식 베이스이다.

| STRIDE 범주 | MITRE ATT&CK 전술 | Kubernetes 공격 기법 예시 |
|------------|------------------|----------------------|
| Spoofing | Initial Access | 유출된 kubeconfig로 클러스터 접근 |
| Tampering | Execution | etcd 데이터 직접 변경 |
| Repudiation | Defense Evasion | 감사 로그 삭제/비활성화 |
| Information Disclosure | Credential Access | ServiceAccount 토큰 탈취 |
| Denial of Service | Impact | 리소스 제한 없는 Pod로 노드 과부하 |
| Elevation of Privilege | Privilege Escalation | privileged 컨테이너에서 호스트 탈출 |

#### 심화 검증: STRIDE 위협 판정 자동화

```bash
# 전체 demo 앱에 대한 STRIDE 자동 점검 스크립트
for app in nginx-web httpbin redis postgres rabbitmq keycloak; do
  echo "=== $app STRIDE 점검 ==="

  # [S] Spoofing - SA 토큰 존재 여부
  TOKEN_EXISTS=$(kubectl exec -n demo $(kubectl get pod -n demo -l app=$app -o name | head -1) -c $app -- ls /var/run/secrets/kubernetes.io/serviceaccount/token 2>/dev/null && echo "YES" || echo "NO")
  echo "[S] SA 토큰 마운트: $TOKEN_EXISTS"

  # [T] Tampering - 이미지 다이제스트 사용 여부
  IMAGE=$(kubectl get pod -n demo -l app=$app -o jsonpath='{.items[0].spec.containers[0].image}' 2>/dev/null)
  echo "[T] 이미지: $IMAGE (sha256 미사용 시 변조 위험)"

  # [I] Info Disclosure - 환경 변수 비밀번호 확인
  PWD_COUNT=$(kubectl get pod -n demo -l app=$app -o jsonpath='{.items[0].spec.containers[0].env}' 2>/dev/null | grep -ci "password" || echo "0")
  echo "[I] 환경 변수 비밀번호 항목: $PWD_COUNT"

  # [D] DoS - 리소스 제한 확인
  LIMITS=$(kubectl get pod -n demo -l app=$app -o jsonpath='{.items[0].spec.containers[0].resources.limits}' 2>/dev/null)
  [ -z "$LIMITS" ] && echo "[D] 리소스 제한: 없음 (DoS 취약)" || echo "[D] 리소스 제한: 설정됨"

  echo ""
done
```

```text
=== nginx-web STRIDE 점검 ===
[S] SA 토큰 마운트: YES
[T] 이미지: nginx:alpine (sha256 미사용 시 변조 위험)
[I] 환경 변수 비밀번호 항목: 0
[D] 리소스 제한: 없음 (DoS 취약)

=== postgres STRIDE 점검 ===
[S] SA 토큰 마운트: YES
[T] 이미지: postgres:16-alpine (sha256 미사용 시 변조 위험)
[I] 환경 변수 비밀번호 항목: 1
[D] 리소스 제한: 없음 (DoS 취약)
```

이 스크립트의 출력에서 `[I] 환경 변수 비밀번호 항목: 1`이 표시되면 해당 앱에 Information Disclosure 위험이 존재하는 것이다.

#### 학습 목표
- STRIDE 위협 모델링 프레임워크를 이해하고 적용한다.
- tart-infra의 6개 데모 앱 각각에 STRIDE 분석을 수행한다.
- 식별된 위협에 대한 대응 방안을 제시한다.

#### 실습 단계

**1단계: STRIDE 프레임워크 이해**

| 위협 | 설명 | 대응 기술 |
|------|------|----------|
| **S**poofing (위장) | 다른 사용자/시스템으로 가장 | 인증 (Authentication) |
| **T**ampering (변조) | 데이터나 코드 무단 변경 | 무결성 검증 (Integrity) |
| **R**epudiation (부인) | 행위에 대한 부인 | 감사 로깅 (Audit Logging) |
| **I**nformation Disclosure (정보 노출) | 민감 정보 유출 | 암호화 (Encryption) |
| **D**enial of Service (서비스 거부) | 서비스 가용성 방해 | 가용성 (Availability) |
| **E**levation of Privilege (권한 상승) | 불법적인 권한 획득 | 인가 (Authorization) |

**2단계: nginx에 STRIDE 적용**

```bash
# [S] Spoofing — ServiceAccount 토큰 확인
kubectl exec -n demo $(kubectl get pod -n demo -l app=nginx-web -o name | head -1) -c nginx-web -- \
  ls /var/run/secrets/kubernetes.io/serviceaccount/token 2>/dev/null && echo "토큰 존재 — 위장 위험"

# [T] Tampering — 이미지 태그 확인 (다이제스트 미사용)
kubectl get pod -n demo -l app=nginx-web -o jsonpath='{.items[0].spec.containers[0].image}'
echo ""
# 출력이 "nginx:alpine"이면 태그 기반 — 이미지 변조 가능

# [R] Repudiation — 감사 로그 확인
echo "API Server audit 로그 확인 필요"

# [I] Information Disclosure — 환경 변수에 민감 정보 확인
kubectl get pod -n demo -l app=nginx-web -o jsonpath='{.items[0].spec.containers[0].env}' 2>/dev/null || echo "환경 변수 없음"

# [D] Denial of Service — 리소스 제한 확인
kubectl get pod -n demo -l app=nginx-web -o jsonpath='{.items[0].spec.containers[0].resources}' 2>/dev/null || echo "리소스 제한 없음 — DoS 취약"

# [E] Elevation of Privilege — securityContext 확인
kubectl get pod -n demo -l app=nginx-web -o jsonpath='{.items[0].spec.containers[0].securityContext}' 2>/dev/null || echo "securityContext 없음"
```

**3단계: postgres에 STRIDE 적용**

```bash
# [S] Spoofing — 인증 설정 확인
kubectl get pod -n demo -l app=postgres -o jsonpath='{.items[0].spec.containers[0].env[?(@.name=="POSTGRES_PASSWORD")].value}'
echo ""
echo "비밀번호: demo123 — 약한 비밀번호로 위장(Spoofing) 공격 가능"

# [T] Tampering — 볼륨 마운트 확인 (데이터 변조 위험)
kubectl get pod -n demo -l app=postgres -o jsonpath='{.items[0].spec.containers[0].volumeMounts}' | python3 -m json.tool 2>/dev/null

# [I] Information Disclosure — 비밀번호 평문 노출
echo "POSTGRES_PASSWORD=demo123이 환경 변수에 평문으로 노출됨"

# [D] Denial of Service — 연결 제한 확인
echo "네트워크 정책으로 httpbin, keycloak에서만 접근 가능 — DoS 위험 경감"

# [E] Elevation of Privilege — securityContext 확인
kubectl get pod -n demo -l app=postgres -o jsonpath='{.items[0].spec.containers[0].securityContext}' 2>/dev/null
```

**4단계: keycloak에 STRIDE 적용**

```bash
# [S] Spoofing — 관리자 비밀번호 확인
kubectl get pod -n demo -l app=keycloak -o jsonpath='{.items[0].spec.containers[0].env[?(@.name=="KEYCLOAK_ADMIN_PASSWORD")].value}'
echo ""
echo "관리자 비밀번호: admin — 매우 약한 비밀번호"

# [I] Information Disclosure — 외부 노출 확인
kubectl get svc keycloak -n demo
echo "NodePort 30880으로 외부 노출 — 관리 콘솔이 인터넷에 직접 노출됨"

# [E] Elevation of Privilege — DB 접근 확인
echo "KC_DB_PASSWORD=demo123으로 postgres에 직접 접근 가능 — DB 권한 상승 위험"
```

**5단계: 전체 앱 STRIDE 분석 요약표**

| 앱 | Spoofing | Tampering | Repudiation | Info Disclosure | DoS | Elevation |
|-----|----------|-----------|-------------|-----------------|-----|-----------|
| nginx | SA 토큰 노출 | 태그 기반 이미지 | 감사 로그 없음 | - | 리소스 제한 없음 | secCtx 미설정 |
| httpbin | SA 토큰 노출 | 태그 기반 이미지 | 감사 로그 없음 | - | 리소스 제한 없음 | secCtx 미설정 |
| redis | 인증 없음 | 태그 기반 이미지 | 감사 로그 없음 | 데이터 평문 | 리소스 제한 없음 | secCtx 미설정 |
| postgres | 약한 비밀번호 | 태그 기반 이미지 | 감사 로그 없음 | 비밀번호 평문 | NP로 경감 | secCtx 미설정 |
| rabbitmq | 약한 비밀번호 | 태그 기반 이미지 | 감사 로그 없음 | 비밀번호 평문 | 리소스 제한 없음 | secCtx 미설정 |
| keycloak | 약한 관리자 PW | 태그 기반 이미지 | 감사 로그 없음 | 관리 콘솔 노출 | NP로 경감 | DB 접근 가능 |

#### 확인 문제
1. STRIDE의 6가지 위협 범주를 나열하고 각각을 설명하라.
2. tart-infra에서 가장 심각한 보안 위협은 무엇이며, 그 이유는?
3. "Information Disclosure"에 해당하는 tart-infra의 구체적인 사례 3가지를 들어라.
4. STRIDE 분석 결과를 기반으로 가장 먼저 개선해야 할 항목은 무엇인가?

#### 관련 KCSA 시험 주제
- STRIDE 위협 모델링
- 위협 식별 및 분류
- 위험 평가 및 대응

---

### Lab 4.2: 공급망 보안 — 이미지 출처 분석

#### 등장 배경과 기존 한계점

소프트웨어 공급망 공격(Supply Chain Attack)은 2020년 SolarWinds 사건을 계기로 전 세계적인 보안 이슈가 되었다. SolarWinds 공격에서 공격자는 빌드 시스템에 악성 코드를 주입하여 18,000개 이상의 조직에 백도어가 포함된 업데이트를 배포하였다.

컨테이너 이미지 공급망에서의 주요 공격 유형:
1. **Typosquatting**: 정상 이미지와 유사한 이름의 악성 이미지를 레지스트리에 게시한다(예: `ngixn` vs `nginx`).
2. **태그 변조(Tag Mutation)**: 이미 게시된 태그가 가리키는 이미지를 악성 이미지로 교체한다. 태그는 변경 가능(mutable)하므로 `nginx:alpine`이 어제와 오늘 다른 이미지를 가리킬 수 있다.
3. **베이스 이미지 오염**: 많은 이미지가 의존하는 베이스 이미지에 악성 코드를 주입한다.
4. **빌드 파이프라인 침해**: CI/CD 시스템을 공격하여 빌드 과정에 악성 단계를 삽입한다.
5. **의존성 혼동(Dependency Confusion)**: 내부 패키지와 동일한 이름의 악성 패키지를 공개 레지스트리에 게시한다.

이에 대응하기 위한 보안 메커니즘:
- **이미지 다이제스트(sha256)**: 이미지의 불변 식별자로, 태그 변조 공격을 방지한다.
- **이미지 서명(cosign/Notary)**: 이미지의 게시자를 암호학적으로 검증한다.
- **SBOM(Software Bill of Materials)**: 이미지에 포함된 모든 컴포넌트를 목록화한다.
- **SLSA(Supply-chain Levels for Software Artifacts)**: 빌드 프로세스의 보안 수준을 증명한다.
- **Admission Controller 연동**: Kyverno verifyImages 규칙으로 서명되지 않은 이미지를 차단한다.

#### 공격-방어 매핑

| 공격 유형 | 방어 메커니즘 | 검증 명령어 |
|----------|-------------|-----------|
| 태그 변조 | 다이제스트 기반 이미지 참조 | `kubectl get pod -o jsonpath='{.status.containerStatuses[0].imageID}'` |
| Typosquatting | 허용된 레지스트리만 사용 (Kyverno/Gatekeeper) | `kubectl get clusterpolicy restrict-image-registries` |
| 악성 이미지 | 이미지 서명 검증 (cosign + Kyverno verifyImages) | `cosign verify --key cosign.pub <image>` |
| 알려진 취약점 | 이미지 스캔 (Trivy) | `trivy image --severity CRITICAL,HIGH <image>` |
| 변조된 빌드 | SLSA provenance 검증 | `cosign verify-attestation --type slsaprovenance <image>` |

#### 트러블슈팅 가이드

**문제: 이미지 다이제스트 확인 방법**

```bash
# 실행 중인 이미지의 실제 다이제스트 확인
kubectl get pods -n demo -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.status.containerStatuses[0].imageID}{"\n"}{end}'
```

```text
httpbin-xxxx     docker.io/kong/httpbin@sha256:abc123...
nginx-web-xxxx   docker.io/library/nginx@sha256:def456...
postgres-xxxx    docker.io/library/postgres@sha256:789abc...
```

**문제: 태그와 다이제스트의 차이 검증**

```bash
# 태그 기반 참조 (변조 가능)
echo "image: nginx:alpine"
echo "→ 이 태그는 언제든 다른 이미지를 가리킬 수 있다"

# 다이제스트 기반 참조 (불변)
echo "image: nginx@sha256:abc123def456..."
echo "→ 이 다이제스트는 특정 이미지 레이어를 영구적으로 식별한다"
```

#### 학습 목표
- 컨테이너 이미지 공급망의 보안 요소를 이해한다.
- 각 데모 앱 이미지의 출처(registry)와 태그 방식을 분석한다.
- 이미지 다이제스트, 서명, 스캔의 중요성을 파악한다.

#### 실습 단계

**1단계: 모든 데모 앱의 컨테이너 이미지 목록**

```bash
kubectl get pods -n demo -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.containers[*].image}{"\n"}{end}'
```

예상 출력:
```
httpbin-xxxx-xxxxx         kong/httpbin
keycloak-xxxx-xxxxx        quay.io/keycloak/keycloak
nginx-web-xxxx-xxxxx       nginx:alpine
postgres-xxxx-xxxxx        postgres:16-alpine
rabbitmq-xxxx-xxxxx        rabbitmq:3-management
redis-xxxx-xxxxx           redis:7-alpine
```

**2단계: 이미지 출처(Registry) 분석**

```bash
# 고유 이미지 목록 추출
kubectl get pods -n demo -o jsonpath='{range .items[*]}{.spec.containers[*].image}{"\n"}{end}' | sort -u
```

| 이미지 | Registry | 공식/비공식 | 위험도 |
|--------|----------|-----------|--------|
| nginx:alpine | Docker Hub (docker.io) | 공식 이미지 | 낮음 |
| postgres:16-alpine | Docker Hub (docker.io) | 공식 이미지 | 낮음 |
| redis:7-alpine | Docker Hub (docker.io) | 공식 이미지 | 낮음 |
| rabbitmq:3-management | Docker Hub (docker.io) | 공식 이미지 | 낮음 |
| kong/httpbin | Docker Hub (docker.io) | 커뮤니티 이미지 | 중간 |
| quay.io/keycloak/keycloak | Quay.io (Red Hat) | 공식 이미지 | 낮음 |

**3단계: 이미지 다이제스트 사용 여부 확인**

```bash
# 현재 실행 중인 이미지의 다이제스트 확인
kubectl get pods -n demo -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.status.containerStatuses[0].imageID}{"\n"}{end}'
```

예상 출력:
```
httpbin-xxxx-xxxxx         docker.io/kong/httpbin@sha256:abcdef...
keycloak-xxxx-xxxxx        quay.io/keycloak/keycloak@sha256:123456...
nginx-web-xxxx-xxxxx       docker.io/library/nginx@sha256:789abc...
...
```

Pod 배포 시 태그(`nginx:alpine`)를 사용했지만, 실제 런타임에서는 다이제스트로 고정된다. 그러나 배포 매니페스트에 다이제스트를 명시하지 않으면 태그가 가리키는 이미지가 변경될 수 있다(태그 변조 공격).

**4단계: 이미지 태그 vs 다이제스트 비교**

```bash
# 태그 기반 참조 (변조 가능)
echo "nginx:alpine — 이 태그는 언제든 다른 이미지를 가리킬 수 있다"

# 다이제스트 기반 참조 (불변)
echo "nginx@sha256:abc123... — 이 다이제스트는 특정 이미지를 영구적으로 가리킨다"
```

**5단계: 이미지 풀 정책 확인**

```bash
kubectl get pods -n demo -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.containers[0].imagePullPolicy}{"\n"}{end}'
```

- `Always`: 매번 레지스트리에서 확인 — 최신 이미지 보장
- `IfNotPresent`: 로컬에 없을 때만 풀 — 성능 우선
- `Never`: 로컬 이미지만 사용

#### 확인 문제
1. 컨테이너 이미지 공급망 공격의 유형 3가지를 나열하라.
2. 이미지 태그 대신 다이제스트를 사용해야 하는 이유는?
3. 프라이빗 레지스트리를 사용하면 어떤 보안 이점이 있는가?
4. 이미지 서명(Cosign, Notary)의 역할은 무엇인가?

#### 관련 KCSA 시험 주제
- 소프트웨어 공급망 보안
- 컨테이너 이미지 보안
- 이미지 서명 및 검증
- SBOM (Software Bill of Materials)

---

### Lab 4.3: Trivy 이미지 스캔 (nginx:alpine, postgres:16-alpine, keycloak)

#### 학습 목표
- Trivy를 사용하여 컨테이너 이미지의 취약점을 스캔한다.
- 스캔 결과를 분석하여 CVE 위험도를 평가한다.
- 취약점 발견 시 대응 방안을 수립한다.

#### 실습 단계

**1단계: Trivy 설치 확인**

```bash
trivy --version
```

설치되어 있지 않다면:
```bash
brew install trivy
```

**2단계: nginx:alpine 이미지 스캔**

```bash
trivy image nginx:alpine
```

예상 출력 (일부):
```
nginx:alpine (alpine 3.XX)
==========================
Total: XX (UNKNOWN: X, LOW: X, MEDIUM: X, HIGH: X, CRITICAL: X)

┌────────────────────┬──────────────┬──────────┬────────┬─────────────────┐
│     Library        │ Vulnerability│ Severity │ Status │ Fixed Version   │
├────────────────────┼──────────────┼──────────┼────────┼─────────────────┤
│ libcurl            │ CVE-XXXX-XXXX│ HIGH     │ fixed  │ X.XX.X-rX       │
│ openssl            │ CVE-XXXX-XXXX│ MEDIUM   │ fixed  │ X.X.X-rX        │
└────────────────────┴──────────────┴──────────┴────────┴─────────────────┘
```

**3단계: postgres:16-alpine 이미지 스캔**

```bash
trivy image postgres:16-alpine
```

**4단계: keycloak 이미지 스캔**

```bash
trivy image quay.io/keycloak/keycloak
```

> **주의**: Keycloak 이미지는 크기가 크므로 스캔에 시간이 소요될 수 있다.

**5단계: CRITICAL/HIGH 취약점만 필터링**

```bash
trivy image --severity CRITICAL,HIGH nginx:alpine
trivy image --severity CRITICAL,HIGH postgres:16-alpine
trivy image --severity CRITICAL,HIGH quay.io/keycloak/keycloak
```

**6단계: 스캔 결과를 JSON으로 저장**

```bash
trivy image -f json -o nginx-scan.json nginx:alpine
trivy image -f json -o postgres-scan.json postgres:16-alpine
```

**7단계: redis:7-alpine 스캔**

```bash
trivy image --severity CRITICAL,HIGH redis:7-alpine
```

**8단계: rabbitmq:3-management 스캔**

```bash
trivy image --severity CRITICAL,HIGH rabbitmq:3-management
```

**9단계: 스캔 결과 종합 분석**

| 이미지 | Base OS | CRITICAL | HIGH | MEDIUM | LOW | 조치 |
|--------|---------|----------|------|--------|-----|------|
| nginx:alpine | Alpine | X | X | X | X | 업데이트 필요 |
| postgres:16-alpine | Alpine | X | X | X | X | 패치 확인 |
| redis:7-alpine | Alpine | X | X | X | X | 패치 확인 |
| rabbitmq:3-management | Ubuntu | X | X | X | X | 업데이트 필요 |
| kong/httpbin | - | X | X | X | X | 대안 검토 |
| keycloak | UBI | X | X | X | X | 업데이트 필요 |

**10단계: 정리**

```bash
rm -f nginx-scan.json postgres-scan.json
```

#### 확인 문제
1. Trivy가 스캔하는 대상은 무엇인가 (OS 패키지, 언어별 라이브러리 등)?
2. CRITICAL 취약점이 발견되면 어떤 조치를 취해야 하는가?
3. Alpine 기반 이미지가 Ubuntu 기반보다 취약점이 적은 경향이 있는 이유는?
4. CI/CD 파이프라인에 이미지 스캔을 통합하면 어떤 이점이 있는가?

#### 관련 KCSA 시험 주제
- 이미지 취약점 스캐닝
- CVE (Common Vulnerabilities and Exposures)
- 공급망 보안 도구
- Admission Controller를 통한 취약 이미지 차단

---

## 실습 5: Platform Security (16%)

Istio mTLS, Cilium L7 정책 심화, AppArmor, seccomp 등 플랫폼 수준의 보안 기술을 실습한다.

---

### Lab 5.1: Istio mTLS 확인 및 테스트

#### 등장 배경과 기존 한계점

서비스 간 통신 암호화는 마이크로서비스 아키텍처에서 필수적인 보안 요구사항이다. 기존 모놀리식 아키텍처에서는 서비스 간 통신이 프로세스 내부 함수 호출이었으므로 네트워크 암호화가 불필요했다. 그러나 마이크로서비스로 분해되면서 서비스 간 통신이 네트워크를 통해 이루어지게 되었고, 이 통신을 보호해야 하는 필요성이 대두되었다.

기존 방식의 한계:
1. **애플리케이션 레벨 TLS**: 각 서비스에 TLS 인증서를 수동으로 배포하고, 인증서 갱신 주기를 관리해야 한다. 서비스 수가 수백 개로 증가하면 운영 부담이 비현실적으로 증가한다.
2. **로드밸런서 TLS 종단**: 로드밸런서에서 TLS를 종단하면 로드밸런서와 백엔드 서비스 간 통신은 평문이 된다. 내부 네트워크 도청에 취약하다.
3. **VPN/IPsec 터널**: 네트워크 레벨에서 암호화하지만, 서비스 간 상호 인증(누가 누구에게 요청하는가)을 제공하지 않는다.

Istio mTLS는 이 문제를 해결한다. 사이드카 프록시(Envoy)가 서비스 코드 변경 없이 자동으로 mTLS를 적용하고, istiod가 인증서를 자동 발급/갱신한다. SPIFFE 기반 워크로드 ID로 서비스 간 상호 인증을 제공한다.

mTLS의 동작 원리:
1. istiod가 각 워크로드에 SPIFFE SVID(X.509 인증서)를 발급한다.
2. 인증서에 워크로드 ID가 포함된다: `spiffe://cluster.local/ns/<namespace>/sa/<service-account>`
3. 클라이언트 사이드카가 서버 사이드카에 TLS 핸드셰이크를 수행한다.
4. 양쪽 인증서를 검증하여 상호 인증을 완료한다.
5. 인증서 기본 유효기간은 24시간이며 자동 갱신된다.

#### 공격-방어 매핑

| 공격 벡터 | mTLS 없이 | mTLS STRICT 적용 시 |
|----------|---------|-------------------|
| 네트워크 도청 (Eavesdropping) | 평문 트래픽 읽기 가능 | 암호화되어 읽기 불가 |
| 서비스 위장 (Service Impersonation) | IP/DNS 스푸핑으로 가능 | SPIFFE ID 검증으로 차단 |
| 중간자 공격 (MITM) | ARP 스푸핑 등으로 가능 | TLS 핸드셰이크에서 탐지 |
| 비인가 서비스 접근 | 네트워크 접근 가능하면 통신 가능 | 유효한 인증서 없으면 차단 |

#### 트러블슈팅 가이드

**문제: STRICT 모드에서 사이드카 없는 Pod 통신 실패**

```bash
# 사이드카 주입 상태 확인
kubectl get pod -n demo -o jsonpath='{range .items[*]}{.metadata.name}{" containers: "}{range .spec.containers[*]}{.name}{" "}{end}{"\n"}{end}'
```

```text
httpbin-xxx containers: httpbin istio-proxy
nginx-web-xxx containers: nginx-web istio-proxy
```

사이드카(`istio-proxy`)가 없는 Pod는 STRICT 모드에서 통신이 차단된다. 해결 방법:
1. 네임스페이스에 `istio-injection: enabled` 레이블을 추가한다.
2. 또는 Pod에 `sidecar.istio.io/inject: "true"` 어노테이션을 추가한다.
3. PERMISSIVE 모드로 전환하여 평문 트래픽도 허용한다(보안 수준 저하).

```bash
# mTLS 연결 상태 확인 (istioctl 사용)
istioctl proxy-status 2>/dev/null | head -10
```

```text
NAME                                  CLUSTER        CDS        LDS        EDS        RDS        ECDS
httpbin-xxx.demo                      Kubernetes     SYNCED     SYNCED     SYNCED     SYNCED     NOT SENT
nginx-web-xxx.demo                    Kubernetes     SYNCED     SYNCED     SYNCED     SYNCED     NOT SENT
```

STATUS가 `SYNCED`이면 사이드카가 정상적으로 istiod와 동기화된 것이다. `STALE`이면 통신 문제가 있다.

#### 학습 목표
- Istio의 PeerAuthentication을 통한 mTLS(mutual TLS) 설정을 확인한다.
- STRICT mTLS가 적용된 환경에서의 통신 방식을 이해한다.
- mTLS가 제공하는 보안 이점을 체험한다.

#### 실습 단계

**1단계: PeerAuthentication 정책 확인**

```bash
kubectl get peerauthentication -n demo -o yaml
```

예상 출력:
```yaml
apiVersion: security.istio.io/v1beta1
kind: PeerAuthentication
metadata:
  name: default
  namespace: demo
spec:
  mtls:
    mode: STRICT
```

STRICT 모드는 demo 네임스페이스의 모든 서비스 간 통신에 mTLS를 강제한다. 평문(plaintext) 통신은 완전히 차단된다.

**2단계: istio-system 네임스페이스의 PeerAuthentication 확인**

```bash
kubectl get peerauthentication -n istio-system -o yaml 2>/dev/null || echo "istio-system에 PeerAuthentication 없음"
```

**3단계: Istio 사이드카 프록시 확인**

```bash
# demo Pod의 컨테이너 목록 확인 — istio-proxy 사이드카 존재 확인
kubectl get pod -n demo -l app=nginx-web -o jsonpath='{.items[0].spec.containers[*].name}'
```

예상 출력:
```
nginx-web istio-proxy
```

`istio-proxy`(Envoy) 컨테이너가 사이드카로 주입되어 모든 트래픽을 가로채고 mTLS를 적용한다.

**4단계: mTLS 인증서 확인**

```bash
# istio-proxy 사이드카의 인증서 정보 확인
kubectl exec -n demo $(kubectl get pod -n demo -l app=nginx-web -o name | head -1) -c istio-proxy -- \
  openssl s_client -connect httpbin.demo.svc.cluster.local:80 -showcerts </dev/null 2>/dev/null | head -20
```

**5단계: Istio가 자동 발급한 SPIFFE ID 확인**

```bash
kubectl exec -n demo $(kubectl get pod -n demo -l app=nginx-web -o name | head -1) -c istio-proxy -- \
  cat /var/run/secrets/istio/root-cert.pem 2>/dev/null | openssl x509 -noout -subject 2>/dev/null
```

Istio는 각 워크로드에 SPIFFE(Secure Production Identity Framework for Everyone) 기반의 ID를 부여한다. 형식은 `spiffe://<trust-domain>/ns/<namespace>/sa/<service-account>`이다.

**6단계: mTLS 없는 통신 시도 (Istio 사이드카 없는 Pod에서)**

```bash
# Istio 사이드카 없이 Pod 생성 (sidecar.istio.io/inject: "false")
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: no-sidecar-test
  namespace: demo
  labels:
    test: no-sidecar
  annotations:
    sidecar.istio.io/inject: "false"
spec:
  containers:
  - name: curl
    image: curlimages/curl:latest
    command: ["sleep", "3600"]
EOF
```

```bash
# Istio 사이드카 없는 Pod에서 httpbin 접근 시도
kubectl exec -n demo no-sidecar-test -- \
  curl -s -o /dev/null -w "%{http_code}" http://httpbin.demo.svc.cluster.local:80/get --max-time 10 2>&1
```

STRICT mTLS가 적용되어 있으므로, 사이드카 없는 Pod의 평문 요청은 거부될 수 있다.

**7단계: 정리**

```bash
kubectl delete pod no-sidecar-test -n demo --grace-period=0 --force 2>/dev/null
```

#### 확인 문제
1. mTLS에서 "mutual"의 의미는 무엇인가?
2. STRICT 모드와 PERMISSIVE 모드의 차이는 무엇인가?
3. Istio mTLS와 CiliumNetworkPolicy는 어떻게 상호 보완되는가?
4. SPIFFE ID가 서비스 인증에 사용되는 방식을 설명하라.

#### 관련 KCSA 시험 주제
- 서비스 메시 보안
- mTLS (mutual TLS)
- 서비스 간 인증
- Zero Trust 네트워킹

---

### Lab 5.2: Cilium L7 정책 심화 (HTTP 메서드별 차단 테스트)

#### 학습 목표
- Cilium L7 정책의 다양한 필터링 옵션을 탐구한다.
- HTTP 경로(path) 기반 필터링을 테스트한다.
- L7 정책의 실전 활용 시나리오를 이해한다.

#### 실습 단계

**1단계: 현재 L7 정책 상세 확인**

```bash
kubectl get cnp allow-nginx-to-httpbin -n demo -o yaml
```

현재 정책은 HTTP GET만 허용하고 있다.

**2단계: 다양한 HTTP 경로에 대한 GET 테스트**

```bash
# /get 경로 (허용됨)
kubectl exec -n demo $(kubectl get pod -n demo -l app=nginx-web -o name | head -1) -c nginx-web -- \
  curl -s -o /dev/null -w "GET /get: %{http_code}\n" http://httpbin.demo.svc.cluster.local:80/get --max-time 10

# /headers 경로 (허용됨 — GET 메서드이므로)
kubectl exec -n demo $(kubectl get pod -n demo -l app=nginx-web -o name | head -1) -c nginx-web -- \
  curl -s -o /dev/null -w "GET /headers: %{http_code}\n" http://httpbin.demo.svc.cluster.local:80/headers --max-time 10

# /ip 경로 (허용됨 — GET 메서드이므로)
kubectl exec -n demo $(kubectl get pod -n demo -l app=nginx-web -o name | head -1) -c nginx-web -- \
  curl -s -o /dev/null -w "GET /ip: %{http_code}\n" http://httpbin.demo.svc.cluster.local:80/ip --max-time 10

# /user-agent 경로 (허용됨 — GET 메서드이므로)
kubectl exec -n demo $(kubectl get pod -n demo -l app=nginx-web -o name | head -1) -c nginx-web -- \
  curl -s -o /dev/null -w "GET /user-agent: %{http_code}\n" http://httpbin.demo.svc.cluster.local:80/user-agent --max-time 10
```

**3단계: POST를 다양한 경로에 테스트 (모두 차단)**

```bash
# /post 경로 — POST (차단됨)
kubectl exec -n demo $(kubectl get pod -n demo -l app=nginx-web -o name | head -1) -c nginx-web -- \
  curl -s -o /dev/null -w "POST /post: %{http_code}\n" -X POST http://httpbin.demo.svc.cluster.local:80/post --max-time 10

# /anything 경로 — POST (차단됨)
kubectl exec -n demo $(kubectl get pod -n demo -l app=nginx-web -o name | head -1) -c nginx-web -- \
  curl -s -o /dev/null -w "POST /anything: %{http_code}\n" -X POST http://httpbin.demo.svc.cluster.local:80/anything --max-time 10
```

**4단계: Cilium L7 정책 경로 기반 필터링 예시**

경로(path) 기반 필터링을 추가하면 더 세밀한 제어가 가능하다. 아래는 예시 정책이다 (적용하지 않고 구조만 분석한다):

```yaml
# 예시: /get과 /headers 경로에 대한 GET만 허용
spec:
  endpointSelector:
    matchLabels:
      app: httpbin
  ingress:
    - fromEndpoints:
        - matchLabels:
            app: nginx-web
      toPorts:
        - ports:
            - port: "80"
          rules:
            http:
              - method: GET
                path: "/get"
              - method: GET
                path: "/headers"
```

이 정책이 적용되면 `/get`과 `/headers`에 대한 GET만 허용되고, `/ip`, `/user-agent` 등은 차단된다.

**5단계: Cilium 정책 모니터링**

```bash
# Cilium 정책 적용 상태 확인
kubectl exec -n kube-system $(kubectl get pod -n kube-system -l k8s-app=cilium -o name | head -1) -- \
  cilium policy get 2>/dev/null | head -30
```

#### 확인 문제
1. L7 정책에서 HTTP 메서드와 경로를 함께 필터링하면 어떤 보안 이점이 있는가?
2. Cilium의 L7 프록시가 Envoy를 사용하는 이유는 무엇인가?
3. L7 정책의 성능 오버헤드를 최소화하는 방법은 무엇인가?

#### 관련 KCSA 시험 주제
- L7 네트워크 정책
- 애플리케이션 레이어 방화벽
- API 게이트웨이 보안

---

### Lab 5.3: AppArmor 프로파일 적용 실습

#### 등장 배경과 기존 한계점

AppArmor(Application Armor)는 Canonical(Ubuntu)이 개발한 Linux Security Module(LSM)이다. 파일 시스템 접근, 네트워크 접근, 프로세스 실행 등을 프로그램별로 제한한다. 유사한 기술인 SELinux(Red Hat 기반)와 비교하여 다음과 같은 차이가 있다:

| 비교 항목 | AppArmor | SELinux |
|----------|----------|---------|
| 기반 배포판 | Ubuntu, Debian, SUSE | RHEL, CentOS, Fedora |
| 정책 모델 | 경로(path) 기반 | 레이블(label) 기반 |
| 학습 곡선 | 상대적으로 낮음 | 높음 (복잡한 정책 문법) |
| 보안 강도 | 파일 경로에 의존 | 레이블 기반으로 더 정밀 |
| Kubernetes 지원 | `securityContext.appArmorProfile` (v1.30+) | `seLinuxOptions` 필드 |

AppArmor가 컨테이너 보안에 기여하는 방식: 컨테이너의 프로세스가 접근할 수 있는 파일, 네트워크, 기능을 프로파일로 제한한다. seccomp이 시스템 콜 수준의 제한이라면, AppArmor는 파일 경로/네트워크 수준의 제한이다. 두 기술은 상호 보완적으로 사용된다.

Kubernetes에서 AppArmor 지원의 발전 과정:
- **Kubernetes 1.4**: annotation 기반 AppArmor 프로파일 지정 (`container.apparmor.security.beta.kubernetes.io/<container-name>`)
- **Kubernetes 1.30**: securityContext에 `appArmorProfile` 필드 추가 (GA)

#### 공격-방어 매핑

| 공격 벡터 | AppArmor 없이 | AppArmor RuntimeDefault 적용 시 |
|----------|-------------|-------------------------------|
| `/etc/shadow` 읽기 | 가능 (root일 경우) | 차단 가능 (커스텀 프로파일) |
| `/proc/sysrq-trigger` 쓰기 | 가능 (privileged일 경우) | 차단 |
| 네트워크 raw 소켓 | 가능 | 제한 가능 |
| 바이너리 실행 경로 제한 | 제한 없음 | 허용된 경로만 실행 가능 |

#### 학습 목표
- AppArmor가 컨테이너 보안에 기여하는 방식을 이해한다.
- Pod에 AppArmor 프로파일을 적용하는 방법을 학습한다.
- AppArmor가 차단하는 작업을 직접 확인한다.

#### 실습 단계

**1단계: 노드에 AppArmor 설치 확인**

```bash
ssh admin@<dev-master-ip> 'sudo aa-status 2>/dev/null | head -10 || echo "AppArmor 미설치"'
```

**2단계: 현재 로드된 AppArmor 프로파일 확인**

```bash
ssh admin@<dev-master-ip> 'sudo aa-status 2>/dev/null | grep -E "profiles|processes"'
```

**3단계: AppArmor 프로파일 적용 Pod 생성**

```bash
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: apparmor-test
  namespace: demo
  labels:
    test: apparmor
spec:
  securityContext:
    runAsNonRoot: true
    runAsUser: 1000
    seccompProfile:
      type: RuntimeDefault
  containers:
  - name: test
    image: busybox:1.36
    command: ["sleep", "3600"]
    securityContext:
      allowPrivilegeEscalation: false
      capabilities:
        drop:
          - ALL
      appArmorProfile:
        type: RuntimeDefault
EOF
```

**4단계: AppArmor 프로파일 동작 확인**

```bash
# RuntimeDefault 프로파일이 적용된 상태에서의 파일 접근 테스트
kubectl exec -n demo apparmor-test -- cat /proc/1/status | head -5
kubectl exec -n demo apparmor-test -- ls /proc/sysrq-trigger 2>&1
```

RuntimeDefault 프로파일은 민감한 시스템 파일에 대한 접근을 제한한다.

**5단계: 커스텀 AppArmor 프로파일 예시 분석**

아래는 nginx 전용 AppArmor 프로파일의 예시이다 (구조 분석만 수행):

```
# /etc/apparmor.d/k8s-nginx
#include <tunables/global>

profile k8s-nginx flags=(attach_disconnected) {
  #include <abstractions/base>

  # 네트워크 접근 허용
  network inet tcp,
  network inet udp,

  # nginx 실행 파일 허용
  /usr/sbin/nginx mr,

  # 설정 파일 읽기 허용
  /etc/nginx/** r,

  # 웹 컨텐츠 읽기 허용
  /usr/share/nginx/html/** r,

  # 로그 쓰기 허용
  /var/log/nginx/** w,

  # 그 외 모든 파일 시스템 접근 거부
  deny /etc/shadow r,
  deny /etc/passwd w,
  deny /proc/** w,
}
```

**6단계: 정리**

```bash
kubectl delete pod apparmor-test -n demo --grace-period=0 --force 2>/dev/null
```

#### 확인 문제
1. AppArmor와 SELinux의 차이는 무엇인가?
2. RuntimeDefault AppArmor 프로파일이 제한하는 작업은 무엇인가?
3. 커스텀 AppArmor 프로파일을 작성할 때 주의할 점은 무엇인가?
4. Kubernetes에서 AppArmor 프로파일을 지정하는 방법은?

#### 관련 KCSA 시험 주제
- Linux 보안 모듈 (LSM)
- AppArmor 프로파일
- 컨테이너 런타임 보안
- 워크로드 격리

---

### Lab 5.4: seccomp RuntimeDefault 적용 실습

#### 등장 배경과 기존 한계점

seccomp(Secure Computing Mode)은 2005년 Linux 커널 2.6.12에 도입된 보안 기능이다. 초기 seccomp(strict mode)은 `read`, `write`, `exit`, `sigreturn` 4개 시스템 콜만 허용하여 실용성이 제한적이었다. 2012년 Linux 3.5에서 seccomp-bpf(filter mode)가 도입되어 BPF 프로그램으로 시스템 콜을 세밀하게 필터링할 수 있게 되었다.

seccomp이 컨테이너 보안에 중요한 이유: Linux 커널은 300개 이상의 시스템 콜을 제공하지만, 일반 웹 애플리케이션은 50-70개 정도만 사용한다. 나머지 시스템 콜은 공격자가 커널 취약점을 악용하는 데 사용될 수 있다. seccomp은 불필요한 시스템 콜을 차단하여 커널 공격 표면(attack surface)을 축소한다.

실제 사례: CVE-2022-0185(Linux 커널 취약점)는 `fsconfig` 시스템 콜의 힙 오버플로우를 통해 컨테이너 탈출이 가능했다. RuntimeDefault seccomp 프로파일은 `fsconfig`을 차단하므로 이 취약점을 무력화한다.

#### RuntimeDefault 프로파일의 차단 대상

RuntimeDefault 프로파일(containerd 기준)이 차단하는 주요 시스템 콜:

| 시스템 콜 | 기능 | 차단 이유 |
|----------|------|----------|
| `mount` / `umount` | 파일시스템 마운트 | 호스트 파일시스템 접근 가능 |
| `reboot` | 시스템 재부팅 | 호스트 재부팅 가능 |
| `ptrace` | 프로세스 추적/디버깅 | 다른 프로세스 메모리 읽기/쓰기 |
| `kexec_load` | 새 커널 로드 | 커널 교체를 통한 rootkit 설치 |
| `bpf` | BPF 프로그램 로드 | 커널 레벨 코드 실행 |
| `unshare` | 네임스페이스 생성 | 사용자 네임스페이스를 통한 권한 상승 |

#### 공격-방어 매핑

| CVE/공격 | 악용 시스템 콜 | RuntimeDefault 차단 여부 |
|---------|-------------|----------------------|
| CVE-2022-0185 (fsconfig overflow) | `fsconfig` | 차단 |
| CVE-2022-0847 (Dirty Pipe) | `splice` | 허용 (별도 패치 필요) |
| CVE-2021-31440 (BPF verifier) | `bpf` | 차단 |
| Container escape via mount | `mount` | 차단 |
| Namespace escape | `unshare` | 차단 |

#### 학습 목표
- seccomp(secure computing mode)의 역할을 이해한다.
- RuntimeDefault seccomp 프로파일이 차단하는 시스템 콜을 파악한다.
- Pod에 seccomp 프로파일을 적용하는 방법을 학습한다.

#### 실습 단계

**1단계: seccomp 개념 이해**

seccomp은 프로세스가 사용할 수 있는 시스템 콜(syscall)을 제한하는 Linux 커널 기능이다. 컨테이너가 불필요한 시스템 콜을 실행하는 것을 방지하여 커널 수준 공격을 차단한다.

```
프로파일 종류:
- Unconfined: 제한 없음 (위험)
- RuntimeDefault: containerd 기본 프로파일 (권장)
- Localhost: 커스텀 프로파일
```

**2단계: seccomp 프로파일 없는 Pod 생성 (비교 대상)**

```bash
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: no-seccomp-test
  namespace: demo
  labels:
    test: no-seccomp
spec:
  containers:
  - name: test
    image: busybox:1.36
    command: ["sleep", "3600"]
EOF
```

**3단계: RuntimeDefault seccomp 프로파일 적용 Pod 생성**

```bash
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: seccomp-test
  namespace: demo
  labels:
    test: seccomp
spec:
  securityContext:
    seccompProfile:
      type: RuntimeDefault
  containers:
  - name: test
    image: busybox:1.36
    command: ["sleep", "3600"]
EOF
```

**4단계: seccomp 프로파일 적용 확인**

```bash
# seccomp 상태 확인
kubectl exec -n demo seccomp-test -- cat /proc/1/status | grep Seccomp
```

예상 출력:
```
Seccomp:     2
Seccomp_filters:     1
```

- `Seccomp: 2`는 SECCOMP_MODE_FILTER (필터 모드)가 활성화되어 있음을 의미한다.
- `Seccomp: 0`은 비활성화 상태이다.

```bash
# seccomp 없는 Pod의 상태 비교
kubectl exec -n demo no-seccomp-test -- cat /proc/1/status | grep Seccomp
```

**5단계: RuntimeDefault 프로파일이 차단하는 시스템 콜 테스트**

```bash
# unshare 시스템 콜 테스트 (RuntimeDefault에서 차단될 수 있음)
kubectl exec -n demo seccomp-test -- unshare -r whoami 2>&1
```

예상 출력:
```
unshare: unshare(0x10000000): Operation not permitted
```

```bash
# 비교: seccomp 없는 Pod에서는 성공할 수 있음
kubectl exec -n demo no-seccomp-test -- unshare -r whoami 2>&1
```

**6단계: containerd RuntimeDefault 프로파일 내용 확인**

```bash
# containerd의 기본 seccomp 프로파일 확인 (노드에서)
ssh admin@<dev-master-ip> 'sudo cat /etc/containerd/config.toml' | grep -i seccomp
```

RuntimeDefault 프로파일은 약 300개 이상의 시스템 콜 중 위험한 것들(예: `reboot`, `mount`, `kexec_load`, `bpf`)을 차단한다.

**7단계: 정리**

```bash
kubectl delete pod no-seccomp-test seccomp-test -n demo --grace-period=0 --force 2>/dev/null
```

#### 확인 문제
1. seccomp이 차단하는 대표적인 시스템 콜 5가지를 나열하라.
2. RuntimeDefault seccomp 프로파일과 Unconfined의 차이는 무엇인가?
3. PSA restricted 프로파일에서 seccomp 프로파일이 필수인 이유는?
4. 커스텀 seccomp 프로파일을 만들 때 strace 도구를 사용하는 이유는?

#### 관련 KCSA 시험 주제
- seccomp 프로파일
- 시스템 콜 필터링
- 컨테이너 런타임 보안
- Linux 커널 보안 기능

---

## 실습 6: Compliance (10%)

보안 규정 준수를 위한 CIS Benchmark 실행, Audit Policy 설정, 보안 체크리스트 작성을 실습한다.

---

### Lab 6.1: kube-bench CIS Benchmark 실행 및 결과 분석

#### 등장 배경과 기존 한계점

CIS(Center for Internet Security) Benchmark는 IT 시스템의 보안 설정 표준을 정의하는 비영리 기관이 발행하는 문서이다. CIS Kubernetes Benchmark는 Kubernetes 클러스터의 보안 설정을 체계적으로 점검하기 위한 표준이다.

CIS Benchmark 이전에는 Kubernetes 보안 설정에 대한 표준화된 기준이 없었다. 각 조직이 독자적인 보안 체크리스트를 작성하여 사용하였으나, 누락 항목이 빈번하고 검증이 어려웠다. CIS Benchmark는 보안 전문가 커뮤니티가 합의한 표준을 제공하여 이 문제를 해결하였다.

kube-bench는 Aqua Security가 개발한 오픈소스 도구로, CIS Kubernetes Benchmark를 자동으로 실행하고 결과를 리포트한다. 수동으로 수백 개의 설정을 하나씩 확인하는 대신, 자동화된 검사를 통해 시간과 인력을 절약한다.

CIS Benchmark 검사 영역:
1. **Control Plane Components**: API Server, Controller Manager, Scheduler, etcd
2. **Worker Nodes**: kubelet, kube-proxy
3. **Policies**: RBAC, Pod Security, NetworkPolicy, Secret 관리
4. **Managed Services**: 클라우드 프로바이더별 추가 검사 항목

#### 공격-방어 매핑

| CIS 검사 항목 | 미준수 시 공격 벡터 | 위험도 |
|-------------|-----------------|--------|
| anonymous-auth=true | 미인증 API 접근 | 높음 |
| audit-log-path 미설정 | 공격 행위 추적 불가 | 높음 |
| encryption-provider 미설정 | etcd Secret 평문 읽기 | 높음 |
| kubelet anonymous auth enabled | kubelet API 무단 접근 | 높음 |
| readOnlyPort != 0 | 노드 정보 노출 | 중간 |
| .key 파일 권한 != 600 | 개인키 탈취 | 높음 |

#### 트러블슈팅 가이드

**문제: kube-bench Job이 실패하는 경우**

```bash
# Pod 상태 확인
kubectl get pods -l job-name=kube-bench
```

```text
NAME               READY   STATUS             RESTARTS   AGE
kube-bench-xxxxx   0/1     CrashLoopBackOff   3          2m
```

```bash
# 로그로 원인 확인
kubectl logs -l job-name=kube-bench
```

```text
Error: unable to read /etc/kubernetes/manifests/kube-apiserver.yaml: permission denied
```

해결: kube-bench Pod에 hostPID, hostPath 등 필요한 권한이 부여되어 있는지 확인한다. Worker 노드에서 실행된 경우 Control Plane 파일에 접근할 수 없으므로 `--targets node`를 지정한다.

**FAIL 항목의 우선순위 결정 기준**

| 분류 | 기준 | 예시 |
|------|------|------|
| 즉시 수정 (P0) | 원격 공격 가능, 데이터 유출 위험 | anonymous-auth, encryption 미설정 |
| 조기 수정 (P1) | 공격 추적 불가, 감사 실패 | audit-log 미설정 |
| 계획 수정 (P2) | 방어 심화, 모범 사례 | protect-kernel-defaults |
| 수용 가능 (P3) | 환경 특성상 미적용 | 학습 환경에서의 SSH 비밀번호 인증 |

#### 학습 목표
- CIS(Center for Internet Security) Kubernetes Benchmark의 목적을 이해한다.
- kube-bench를 사용하여 클러스터의 CIS 준수 여부를 검사한다.
- 검사 결과를 분석하고 실패 항목에 대한 대응 방안을 수립한다.

#### 실습 단계

**1단계: kube-bench Job 배포**

```bash
kubectl apply -f https://raw.githubusercontent.com/aquasecurity/kube-bench/main/job.yaml
```

예상 출력:
```
job.batch/kube-bench created
```

**2단계: Job 완료 대기**

```bash
kubectl wait --for=condition=complete job/kube-bench --timeout=120s
```

**3단계: kube-bench 결과 확인**

```bash
kubectl logs job/kube-bench
```

예상 출력 (일부):
```
[INFO] 1 Control Plane Security Configuration
[INFO] 1.1 Control Plane Node Configuration Files
[PASS] 1.1.1 Ensure that the API server pod specification file permissions are set to 644 or more restrictive
[PASS] 1.1.2 Ensure that the API server pod specification file ownership is set to root:root
...
[FAIL] 1.2.6 Ensure that the --kubelet-certificate-authority argument is set
...
[INFO] 1.3 Controller Manager
[PASS] 1.3.1 Ensure that the --terminated-pod-gc-threshold argument is set as appropriate
...

== Summary total ==
XX checks PASS
XX checks FAIL
XX checks WARN
XX checks INFO
```

**4단계: FAIL 항목만 추출**

```bash
kubectl logs job/kube-bench | grep "\[FAIL\]"
```

**5단계: 주요 FAIL 항목 분석**

```bash
# 상세 실패 원인과 대응 방법 확인
kubectl logs job/kube-bench | grep -A 5 "\[FAIL\]" | head -50
```

주요 실패 항목과 대응 방안:

| CIS 항목 | 설명 | 대응 방안 |
|----------|------|----------|
| 1.2.6 | kubelet-certificate-authority 미설정 | API Server 매니페스트에 플래그 추가 |
| 1.2.16 | audit-log-path 미설정 | Audit Policy 구성 (Lab 6.2) |
| 1.2.18 | audit-log-maxage 미설정 | 감사 로그 보존 기간 설정 |
| 4.2.6 | --protect-kernel-defaults 미설정 | kubelet 설정에 추가 |

**6단계: PASS/FAIL/WARN 통계 확인**

```bash
kubectl logs job/kube-bench | tail -10
```

**7단계: Worker 노드 스캔 (선택)**

```bash
# Worker 노드에서 kube-bench 직접 실행
ssh admin@<dev-worker1-ip> 'sudo docker run --rm --pid=host -v /etc:/etc:ro -v /var:/var:ro aquasec/kube-bench node' 2>/dev/null | tail -20
```

**8단계: 정리**

```bash
kubectl delete job kube-bench
```

#### 확인 문제
1. CIS Benchmark의 목적은 무엇인가?
2. kube-bench가 검사하는 주요 영역 5가지를 나열하라.
3. FAIL 항목을 발견했을 때 즉시 수정해야 하는 항목과 수용 가능한 항목을 어떻게 구분하는가?
4. CIS Benchmark와 NIST, SOC2 등 다른 프레임워크의 관계는 무엇인가?

#### 관련 KCSA 시험 주제
- CIS Kubernetes Benchmark
- 규정 준수 (Compliance)
- 보안 감사 (Security Audit)
- kube-bench 도구

---

### Lab 6.2: Audit Policy 설정 실습

#### 등장 배경과 기존 한계점

Kubernetes Audit Logging은 API Server에 대한 모든 요청을 기록하는 메커니즘이다. Kubernetes 1.7에서 alpha, 1.12에서 GA로 도입되었다.

Audit Logging 도입 이전에는 API Server에 대한 접근 기록이 없어 다음 문제가 있었다:
1. **보안 사고 추적 불가**: 누가 언제 어떤 리소스에 접근했는지 파악할 수 없었다.
2. **컴플라이언스 미충족**: SOC 2, PCI DSS 등은 API 접근 로그를 필수로 요구한다.
3. **이상 행위 탐지 불가**: 비정상적인 API 호출 패턴을 탐지할 수 없었다.
4. **포렌식 불가**: 사고 발생 후 근본 원인 분석(Root Cause Analysis)이 불가능했다.

Audit Policy 설계 시 고려 사항:
- **로그 볼륨**: RequestResponse 레벨은 모든 요청/응답 본문을 기록하므로 저장 공간을 빠르게 소비한다.
- **민감 데이터 노출**: Secret에 대해 RequestResponse 레벨을 사용하면 Secret 값이 로그에 기록되어 오히려 보안 위험이 된다.
- **성능 영향**: 과도한 로깅은 API Server 성능에 영향을 줄 수 있다.
- **노이즈 제거**: 시스템 컴포넌트의 반복적 읽기 요청을 제외하여 유의미한 로그만 기록한다.

#### 공격-방어 매핑

| STRIDE 위협 | Audit Logging의 역할 | Audit Policy 설정 |
|-----------|-------------------|-------------------|
| Repudiation (부인) | 모든 API 요청의 행위자/시간/대상 기록 | Metadata 수준 이상 |
| Information Disclosure | Secret 접근 기록으로 유출 추적 | Secret은 Metadata (본문 제외) |
| Elevation of Privilege | RBAC 변경 기록으로 권한 상승 추적 | RBAC 리소스는 RequestResponse |
| Tampering | ConfigMap/Deployment 변경 기록 | 변경 작업은 Request 이상 |

#### 트러블슈팅 가이드

**문제: Audit 로그가 생성되지 않는 경우**

```bash
# API Server에 audit 플래그가 설정되어 있는지 확인
ssh admin@<dev-master-ip> 'sudo cat /etc/kubernetes/manifests/kube-apiserver.yaml | grep audit'
```

```text
# 출력이 없으면 Audit Logging이 비활성화된 것이다
```

설정 방법:
1. `/etc/kubernetes/audit-policy.yaml` 파일을 생성한다.
2. API Server 매니페스트에 `--audit-policy-file`과 `--audit-log-path`를 추가한다.
3. volumeMount로 정책 파일과 로그 디렉토리를 API Server Pod에 마운트한다.

**문제: Audit 로그에서 보안 이벤트 검색**

```bash
# Secret 접근 이벤트 검색
ssh admin@<dev-master-ip> 'sudo cat /var/log/kubernetes/audit/audit.log 2>/dev/null | python3 -c "
import sys, json
for line in sys.stdin:
    try:
        event = json.loads(line)
        if event.get(\"objectRef\", {}).get(\"resource\") == \"secrets\":
            print(f\"{event[\"requestReceivedTimestamp\"]} {event[\"verb\"]} {event[\"objectRef\"][\"namespace\"]}/{event[\"objectRef\"].get(\"name\", \"*\")} by {event[\"user\"][\"username\"]}\")
    except: pass
" 2>/dev/null | tail -10'
```

```text
2024-01-15T10:30:00.000000Z list demo/* by system:serviceaccount:demo:default
2024-01-15T10:31:00.000000Z get kube-system/admin-token by system:kube-controller-manager
```

이 출력에서 `demo` 네임스페이스의 Secret을 `default` ServiceAccount가 조회한 기록을 확인할 수 있다. 이 ServiceAccount에 Secret 접근 권한이 부여되어 있는지, 해당 접근이 정당한지 검토해야 한다.

#### 학습 목표
- Kubernetes Audit Logging의 구조와 이벤트 레벨을 이해한다.
- Audit Policy를 작성하여 API Server에 적용하는 방법을 학습한다.
- 감사 로그를 분석하여 보안 이벤트를 탐지하는 방법을 파악한다.

#### 실습 단계

**1단계: Audit Policy 파일 작성 (개념 설명)**

Kubernetes Audit은 API Server에 대한 모든 요청을 기록한다. 4가지 이벤트 레벨이 있다:

| 레벨 | 기록 내용 |
|------|----------|
| None | 기록하지 않음 |
| Metadata | 요청 메타데이터만 (사용자, 시간, 리소스, verb) |
| Request | 메타데이터 + 요청 본문 |
| RequestResponse | 메타데이터 + 요청 본문 + 응답 본문 |

**2단계: Audit Policy 예시 분석**

아래는 tart-infra에 적용할 수 있는 Audit Policy이다:

```yaml
# /etc/kubernetes/audit-policy.yaml
apiVersion: audit.k8s.io/v1
kind: Policy
rules:
  # Secret 관련 작업은 Request 레벨로 기록
  - level: Request
    resources:
      - group: ""
        resources: ["secrets"]

  # 인증 관련 작업은 RequestResponse 레벨로 기록
  - level: RequestResponse
    resources:
      - group: "authentication.k8s.io"
        resources: ["tokenreviews"]
      - group: "authorization.k8s.io"
        resources: ["subjectaccessreviews"]

  # ConfigMap, Pod 관련 작업은 Metadata 레벨로 기록
  - level: Metadata
    resources:
      - group: ""
        resources: ["configmaps", "pods"]

  # 읽기 전용 요청은 기록하지 않음 (로그 양 관리)
  - level: None
    verbs: ["get", "list", "watch"]

  # 그 외 모든 요청은 Metadata 레벨로 기록
  - level: Metadata
```

**3단계: API Server에 Audit Policy 적용 방법 (참고)**

실제 적용 시 API Server 매니페스트에 다음 플래그를 추가한다:

```yaml
# /etc/kubernetes/manifests/kube-apiserver.yaml에 추가
spec:
  containers:
  - command:
    - kube-apiserver
    - --audit-policy-file=/etc/kubernetes/audit-policy.yaml
    - --audit-log-path=/var/log/kubernetes/audit/audit.log
    - --audit-log-maxage=30
    - --audit-log-maxbackup=10
    - --audit-log-maxsize=100
```

> **주의**: API Server 매니페스트를 수정하면 API Server가 자동으로 재시작된다. 프로덕션 환경에서는 사전에 충분한 테스트가 필요하다.

**4단계: Audit 로그 예시 분석**

실제 감사 로그 항목의 구조:

```json
{
  "kind": "Event",
  "apiVersion": "audit.k8s.io/v1",
  "level": "Request",
  "auditID": "abc-123-def",
  "stage": "ResponseComplete",
  "requestURI": "/api/v1/namespaces/demo/secrets/postgres-secret",
  "verb": "get",
  "user": {
    "username": "system:serviceaccount:demo:default",
    "groups": ["system:serviceaccounts", "system:serviceaccounts:demo"]
  },
  "sourceIPs": ["10.0.0.5"],
  "objectRef": {
    "resource": "secrets",
    "namespace": "demo",
    "name": "postgres-secret",
    "apiVersion": "v1"
  },
  "responseStatus": {
    "code": 200
  },
  "requestReceivedTimestamp": "2024-01-15T10:30:00.000000Z",
  "stageTimestamp": "2024-01-15T10:30:00.001000Z"
}
```

이 로그에서 "demo 네임스페이스의 default ServiceAccount가 postgres-secret을 조회했다"는 사실을 확인할 수 있다.

**5단계: 보안 이벤트 탐지를 위한 로그 분석 패턴**

```bash
# Secret 접근 로그 필터링 (audit.log가 있는 경우)
ssh admin@<dev-master-ip> 'sudo cat /var/log/kubernetes/audit/audit.log 2>/dev/null' | \
  grep '"resource":"secrets"' | head -5

# 실패한 인증 시도 필터링
ssh admin@<dev-master-ip> 'sudo cat /var/log/kubernetes/audit/audit.log 2>/dev/null' | \
  grep '"code":403' | head -5
```

#### 확인 문제
1. Audit 이벤트 레벨 4가지(None, Metadata, Request, RequestResponse)의 차이를 설명하라.
2. Secret 접근에 RequestResponse 레벨을 사용하지 않는 이유는 무엇인가?
3. Audit 로그의 보존 기간과 크기를 관리해야 하는 이유는?
4. SIEM(Security Information and Event Management)과 Audit 로그의 연계 방법은?

#### 관련 KCSA 시험 주제
- Kubernetes Audit Logging
- Audit Policy 구성
- 보안 모니터링
- 사고 대응 (Incident Response)

---

### Lab 6.3: 보안 체크리스트 작성

#### 학습 목표
- tart-infra 환경의 보안 상태를 종합적으로 평가한다.
- 실습 1~6에서 확인한 결과를 바탕으로 보안 체크리스트를 작성한다.
- 보안 개선 우선순위를 결정한다.

#### 실습 단계

**1단계: Control Plane 보안 체크리스트**

```bash
# API Server 보안 점검
echo "=== API Server ==="
ssh admin@<dev-master-ip> 'sudo cat /etc/kubernetes/manifests/kube-apiserver.yaml' | grep -c "authorization-mode" && echo "[OK] authorization-mode 설정됨"
ssh admin@<dev-master-ip> 'sudo cat /etc/kubernetes/manifests/kube-apiserver.yaml' | grep -c "enable-admission" && echo "[OK] admission plugins 설정됨"
ssh admin@<dev-master-ip> 'sudo cat /etc/kubernetes/manifests/kube-apiserver.yaml' | grep -c "audit-policy-file" && echo "[OK] audit policy 설정됨" || echo "[WARN] audit policy 미설정"
ssh admin@<dev-master-ip> 'sudo cat /etc/kubernetes/manifests/kube-apiserver.yaml' | grep -c "encryption-provider" && echo "[OK] encryption at rest 설정됨" || echo "[WARN] encryption at rest 미설정"

# etcd 보안 점검
echo "=== etcd ==="
ssh admin@<dev-master-ip> 'sudo cat /etc/kubernetes/manifests/etcd.yaml' | grep -c "cert-file" && echo "[OK] TLS 인증서 설정됨"
ssh admin@<dev-master-ip> 'sudo cat /etc/kubernetes/manifests/etcd.yaml' | grep -c "peer-cert-file" && echo "[OK] 피어 TLS 설정됨"

# kubelet 보안 점검
echo "=== kubelet ==="
ssh admin@<dev-master-ip> 'sudo cat /var/lib/kubelet/config.yaml' | grep "anonymous" -A 1 | grep -c "false" && echo "[OK] anonymous 인증 비활성화"
ssh admin@<dev-master-ip> 'sudo cat /var/lib/kubelet/config.yaml' | grep -c "Webhook" && echo "[OK] Webhook 인가 설정됨"
```

**2단계: 네트워크 보안 체크리스트**

```bash
echo "=== NetworkPolicy ==="
CNP_COUNT=$(kubectl get cnp -n demo --no-headers | wc -l)
echo "CiliumNetworkPolicy 개수: $CNP_COUNT"
[ "$CNP_COUNT" -ge 11 ] && echo "[OK] 11개 이상 정책 적용됨" || echo "[WARN] 정책 부족"

echo "=== Default Deny ==="
kubectl get cnp default-deny-all -n demo &>/dev/null && echo "[OK] Default Deny 정책 존재" || echo "[FAIL] Default Deny 정책 없음"

echo "=== mTLS ==="
kubectl get peerauthentication -n demo &>/dev/null && echo "[OK] Istio PeerAuthentication 존재" || echo "[WARN] mTLS 미설정"
```

**3단계: 워크로드 보안 체크리스트**

```bash
echo "=== Secret 관리 ==="
# 환경 변수에 평문 비밀번호가 있는지 확인
for app in postgres rabbitmq keycloak; do
  PWD_COUNT=$(kubectl get pod -n demo -l app=$app -o jsonpath='{.items[0].spec.containers[0].env}' 2>/dev/null | grep -ci "password")
  if [ "$PWD_COUNT" -gt 0 ]; then
    echo "[WARN] $app: 환경 변수에 비밀번호 존재 ($PWD_COUNT개)"
  else
    echo "[OK] $app: 환경 변수에 비밀번호 없음"
  fi
done

echo "=== ServiceAccount Token ==="
for app in nginx-web httpbin redis postgres rabbitmq keycloak; do
  AUTOMOUNT=$(kubectl get pod -n demo -l app=$app -o jsonpath='{.items[0].spec.automountServiceAccountToken}' 2>/dev/null)
  if [ "$AUTOMOUNT" = "false" ]; then
    echo "[OK] $app: automountServiceAccountToken=false"
  else
    echo "[WARN] $app: SA 토큰 자동 마운트됨"
  fi
done
```

**4단계: 종합 보안 평가표**

| 영역 | 항목 | 상태 | 우선순위 |
|------|------|------|---------|
| Control Plane | API Server RBAC | OK | - |
| Control Plane | Audit Logging | WARN | 높음 |
| Control Plane | Encryption at Rest | WARN | 높음 |
| Network | Default Deny | OK | - |
| Network | L7 Policy | OK | - |
| Network | mTLS | OK | - |
| Workload | Secret 평문 저장 | WARN | 높음 |
| Workload | SA 토큰 자동 마운트 | WARN | 중간 |
| Workload | securityContext 미설정 | WARN | 중간 |
| Workload | 이미지 태그 사용 | WARN | 중간 |
| Compliance | CIS Benchmark FAIL 항목 | WARN | 중간 |

**5단계: 개선 우선순위 결정**

보안 개선 로드맵:

1. **즉시(P0)**: Secret을 Kubernetes Secret으로 이관, 약한 비밀번호 변경
2. **단기(P1)**: Audit Logging 활성화, Encryption at Rest 설정
3. **중기(P2)**: automountServiceAccountToken 비활성화, securityContext 강화
4. **장기(P3)**: 이미지 다이제스트 사용, 커스텀 AppArmor/seccomp 프로파일 적용

#### 확인 문제
1. 보안 체크리스트에서 "즉시 조치" 항목을 결정하는 기준은 무엇인가?
2. 보안 개선 로드맵에서 비용 대비 효과가 가장 큰 항목은 무엇인가?
3. 규정 준수(Compliance)와 실제 보안(Security) 사이의 차이는 무엇인가?

#### 관련 KCSA 시험 주제
- 보안 평가 (Security Assessment)
- 규정 준수 프레임워크
- 보안 개선 우선순위
- 지속적인 보안 모니터링

---

## 종합 보안 시나리오

실습 1~6에서 학습한 내용을 종합하여 실제 보안 시나리오를 시뮬레이션한다.

---

### 시나리오 1: 보안 사고 대응 — postgres Secret 노출 탐지 및 대응

#### 학습 목표
- 보안 사고(Security Incident)의 탐지, 분석, 대응, 복구 프로세스를 체험한다.
- Secret 노출 사고의 영향 범위를 분석한다.
- 사고 후 재발 방지 대책을 수립한다.

#### 시나리오 배경

팀원이 실수로 `kubectl get secret -o yaml` 출력을 공유 채널에 게시하여 postgres 비밀번호(`demo123`)가 노출되었다는 보고가 접수되었다. 보안 사고 대응 절차에 따라 조사 및 대응을 수행한다.

#### 실습 단계

**Phase 1: 탐지 (Detection)**

```bash
# 1) 현재 postgres 비밀번호 확인
kubectl get pod -n demo -l app=postgres -o jsonpath='{.items[0].spec.containers[0].env[?(@.name=="POSTGRES_PASSWORD")].value}'
echo ""
echo "노출된 비밀번호: demo123"

# 2) 이 비밀번호로 접근 가능한 서비스 파악
echo "=== postgres에 접근 가능한 서비스 ==="
echo "- httpbin (allow-httpbin-to-postgres 정책)"
echo "- keycloak (allow-keycloak-to-postgres 정책, KC_DB_PASSWORD=demo123)"
```

**Phase 2: 분석 (Analysis)**

```bash
# 3) 영향 범위 분석
echo "=== 영향 범위 ==="
echo "1. postgres 데이터베이스 — 모든 데이터 접근 가능"
echo "2. keycloak — DB에 저장된 사용자 정보, 세션 데이터 노출 가능"
echo "3. keycloak 관리자 — admin/admin으로 관리 콘솔 접근 가능"

# 4) 네트워크 정책으로 인한 공격 제한 확인
echo "=== 네트워크 정책에 의한 위험 경감 ==="
echo "CiliumNetworkPolicy에 의해 postgres:5432에 접근 가능한 Pod는 httpbin과 keycloak만 존재"
echo "외부에서 직접 postgres에 접근은 불가능 (ClusterIP 서비스)"
kubectl get svc postgres -n demo
```

**Phase 3: 대응 (Containment)**

```bash
# 5) 비밀번호 변경을 위한 Secret 생성
kubectl create secret generic postgres-new-password \
  --from-literal=password=$(openssl rand -base64 32) \
  -n demo --dry-run=client -o yaml
echo ""
echo "새로운 강력한 비밀번호를 생성하여 Secret으로 관리한다."

# 6) Audit 로그에서 최근 Secret 접근 기록 확인 (감사 로깅이 활성화된 경우)
ssh admin@<dev-master-ip> 'sudo cat /var/log/kubernetes/audit/audit.log 2>/dev/null' | \
  grep -i "secret" | grep -i "demo" | tail -5 || echo "Audit 로그 없음 — 향후 활성화 필요"
```

**Phase 4: 복구 및 재발 방지 (Recovery & Lessons Learned)**

```bash
# 7) 재발 방지 대책
echo "=== 재발 방지 대책 ==="
echo "1. 모든 비밀번호를 Kubernetes Secret으로 관리 (환경 변수 직접 지정 금지)"
echo "2. RBAC로 Secret 접근 권한 제한 (view ClusterRole에서 Secret 제외 검토)"
echo "3. Audit Logging 활성화로 Secret 접근 추적"
echo "4. Encryption at Rest 설정으로 etcd 내 Secret 보호"
echo "5. External Secret Manager(Vault) 도입 검토"
echo "6. 강력한 비밀번호 정책 수립 (최소 16자, 특수문자 포함)"
```

**Phase 5: 사고 보고서 작성**

보안 사고 보고서에 포함해야 할 항목:

1. **사고 요약**: postgres 비밀번호(demo123)가 공유 채널에 노출
2. **탐지 시각**: YYYY-MM-DD HH:MM
3. **영향 범위**: postgres DB, keycloak 사용자 데이터
4. **근본 원인**: 비밀번호가 환경 변수에 평문 저장, Secret 미사용
5. **대응 조치**: 비밀번호 변경, Secret 이관
6. **재발 방지**: Audit Logging, RBAC 강화, Vault 도입

#### 확인 문제
1. 보안 사고 대응의 4단계(탐지, 분석, 대응, 복구)를 설명하라.
2. 네트워크 정책(CiliumNetworkPolicy)이 이 사고의 영향을 어떻게 줄였는가?
3. Audit Logging이 활성화되어 있었다면 어떤 추가 분석이 가능했는가?
4. "비밀번호 변경"만으로 충분한 대응이 되지 않는 이유는?

#### 관련 KCSA 시험 주제
- 보안 사고 대응 (Incident Response)
- Secret 관리 모범 사례
- 보안 이벤트 분석
- 포렌식 (Forensics)

---

### 시나리오 2: 새 앱 보안 배포 — NetworkPolicy + PSA + RBAC + 이미지 스캔

#### 학습 목표
- 새로운 애플리케이션을 보안 모범 사례에 따라 배포하는 전체 과정을 체험한다.
- NetworkPolicy, PSA, RBAC, 이미지 스캔을 통합적으로 적용한다.
- "Shift Left" 보안 원칙을 이해한다.

#### 시나리오 배경

새로운 "order-api"(주문 API) 서비스를 demo 네임스페이스에 배포해야 한다. 이 서비스는 httpbin에서만 접근 가능하고, postgres에 주문 데이터를 저장한다. 보안 모범 사례에 따라 배포 전 점검부터 시작한다.

#### 실습 단계

**Phase 1: 이미지 보안 점검**

```bash
# 1) 사용할 이미지 취약점 스캔
trivy image --severity CRITICAL,HIGH python:3.12-alpine

# 2) CRITICAL 취약점이 있으면 대안 이미지 검토
echo "CRITICAL 취약점이 발견되면 패치된 버전을 사용하거나 distroless 이미지를 고려한다"
```

**Phase 2: RBAC 설정**

```bash
# 3) order-api 전용 ServiceAccount 생성
kubectl create serviceaccount order-api-sa -n demo

# 4) 최소 권한 Role 생성 — ConfigMap 읽기만 허용
kubectl create role order-api-role \
  --verb=get,list \
  --resource=configmaps \
  -n demo

# 5) RoleBinding 생성
kubectl create rolebinding order-api-binding \
  --role=order-api-role \
  --serviceaccount=demo:order-api-sa \
  -n demo

# 6) 권한 확인
kubectl auth can-i list configmaps --as=system:serviceaccount:demo:order-api-sa -n demo
kubectl auth can-i list secrets --as=system:serviceaccount:demo:order-api-sa -n demo
kubectl auth can-i list pods --as=system:serviceaccount:demo:order-api-sa -n demo
```

예상 출력:
```
yes
no
no
```

**Phase 3: 보안 Pod 배포**

```bash
# 7) 보안 모범 사례를 적용한 Pod 배포
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: order-api
  namespace: demo
  labels:
    app: order-api
spec:
  serviceAccountName: order-api-sa
  automountServiceAccountToken: false
  securityContext:
    runAsNonRoot: true
    runAsUser: 1000
    runAsGroup: 1000
    fsGroup: 1000
    seccompProfile:
      type: RuntimeDefault
  containers:
  - name: order-api
    image: python:3.12-alpine
    command: ["sleep", "3600"]
    ports:
    - containerPort: 8000
    securityContext:
      allowPrivilegeEscalation: false
      readOnlyRootFilesystem: true
      capabilities:
        drop:
          - ALL
    resources:
      limits:
        cpu: "500m"
        memory: "256Mi"
      requests:
        cpu: "100m"
        memory: "128Mi"
EOF
```

**Phase 4: NetworkPolicy 적용**

```bash
# 8) order-api에 대한 ingress 정책 — httpbin에서만 접근 허용
cat <<EOF | kubectl apply -f -
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: allow-httpbin-to-order-api
  namespace: demo
spec:
  endpointSelector:
    matchLabels:
      app: order-api
  ingress:
    - fromEndpoints:
        - matchLabels:
            app: httpbin
      toPorts:
        - ports:
            - port: "8000"
EOF
```

```bash
# 9) order-api의 egress 정책 — postgres와 DNS만 허용
cat <<EOF | kubectl apply -f -
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: allow-order-api-egress
  namespace: demo
spec:
  endpointSelector:
    matchLabels:
      app: order-api
  egress:
    - toEndpoints:
        - matchLabels:
            app: postgres
      toPorts:
        - ports:
            - port: "5432"
    - toEndpoints:
        - matchLabels:
            io.kubernetes.pod.namespace: kube-system
            k8s-app: kube-dns
      toPorts:
        - ports:
            - port: "53"
              protocol: UDP
EOF
```

**Phase 5: 보안 검증**

```bash
# 10) Pod 상태 확인
kubectl get pod order-api -n demo

# 11) securityContext 확인
kubectl get pod order-api -n demo -o jsonpath='{.spec.containers[0].securityContext}' | python3 -m json.tool

# 12) SA 토큰 마운트 확인
kubectl exec -n demo order-api -- ls /var/run/secrets/kubernetes.io/serviceaccount/ 2>&1
echo "기대: No such file or directory"

# 13) 네트워크 정책 테스트 — busybox에서 order-api 접근 시도 (차단됨)
kubectl run nettest --image=busybox:1.36 -n demo --restart=Never --labels="test=nettest" -- sleep 60
kubectl exec -n demo nettest -- wget -O- --timeout=5 http://order-api.demo.svc.cluster.local:8000 2>&1
echo "기대: Connection timed out"
kubectl delete pod nettest -n demo --grace-period=0 --force
```

**Phase 6: 정리**

```bash
kubectl delete pod order-api -n demo --grace-period=0 --force
kubectl delete cnp allow-httpbin-to-order-api allow-order-api-egress -n demo
kubectl delete rolebinding order-api-binding -n demo
kubectl delete role order-api-role -n demo
kubectl delete sa order-api-sa -n demo
```

#### 확인 문제
1. "Shift Left" 보안 원칙이 의미하는 바는 무엇인가?
2. 새 앱 배포 시 보안 체크리스트의 필수 항목 5가지를 나열하라.
3. `readOnlyRootFilesystem: true`가 보안에 기여하는 방식은?
4. NetworkPolicy를 ingress와 egress 양방향으로 설정해야 하는 이유는?
5. 리소스 limits를 설정하지 않으면 어떤 보안 위험이 있는가?

#### 관련 KCSA 시험 주제
- 보안 배포 모범 사례
- Defense in Depth (다층 방어)
- Shift Left Security
- DevSecOps

---

### 시나리오 3: 침투 테스트 — 네트워크 정책 우회 시도 및 방어 확인

#### 등장 배경과 기존 한계점

침투 테스트(Penetration Testing)는 공격자의 관점에서 시스템의 보안을 평가하는 방법론이다. OWASP, PTES(Penetration Testing Execution Standard), NIST SP 800-115 등이 표준 프레임워크를 제공한다.

Kubernetes 환경의 침투 테스트가 기존 네트워크 침투 테스트와 다른 점:
1. **동적 인프라**: Pod가 수시로 생성/삭제되어 IP가 변경된다. 고정 IP 기반의 전통적 네트워크 스캔이 제한적이다.
2. **레이블 기반 정책**: NetworkPolicy가 IP가 아닌 레이블로 동작하므로, 레이블 위조가 새로운 공격 벡터이다.
3. **API Server 중심**: 전통적 시스템에서는 각 서버에 개별 접근하지만, Kubernetes에서는 API Server를 통해 모든 리소스를 제어한다.
4. **서비스 메시**: Istio mTLS가 적용되면 네트워크 레벨의 도청/스푸핑이 어려워진다.

이 시나리오의 핵심 교훈: NetworkPolicy는 보안의 한 레이어일 뿐이며, RBAC(Pod 생성 권한 제한), Admission Controller(레이블 정책 강제), 런타임 보안(Falco) 등과 결합해야 완전한 방어가 가능하다. 이것이 Defense in Depth(다층 방어)의 실천이다.

#### 공격 체인 분석

```
1. 정찰 (Reconnaissance)
   └─ 외부 노출 서비스 파악 (NodePort 30080, 30880)
      │
2. 초기 접근 (Initial Access)
   └─ nginx Pod 침해 가정
      │
3. 횡적 이동 시도 (Lateral Movement)
   ├─ nginx→postgres: 차단 (egress 정책)
   ├─ nginx→rabbitmq: 차단 (egress 정책)
   ├─ nginx→httpbin POST: 차단 (L7 정책)
   └─ 새 Pod 생성→postgres: 차단 (default-deny)
      │
4. 정책 우회 시도 (Defense Evasion)
   └─ 레이블 위조 Pod→postgres: 성공 가능!
      │
5. 데이터 탈취 (Exfiltration)
   └─ postgres 데이터 접근
```

각 방어 레이어의 역할:

| 방어 레이어 | 이 시나리오에서의 역할 | 차단한 공격 |
|-----------|-------------------|-----------|
| CiliumNetworkPolicy (egress) | nginx의 아웃바운드를 제한 | 공격 시도 1, 2 |
| CiliumNetworkPolicy (L7) | HTTP 메서드 필터링 | 공격 시도 3 |
| CiliumNetworkPolicy (default-deny) | 허용되지 않은 Pod의 통신 차단 | 공격 시도 4 |
| RBAC | Pod 생성 권한 제한 | 공격 시도 5 (미설정 시 우회 가능) |
| Admission Controller | 특정 레이블 사용 제한 | 레이블 위조 방지 |
| Istio mTLS | 서비스 간 상호 인증 | 위조 Pod의 통신 차단 (STRICT 모드) |

#### 학습 목표
- 공격자의 관점에서 네트워크 정책 우회를 시도한다.
- 방어가 올바르게 동작하는지 검증한다.
- 침투 테스트(Penetration Testing)의 기본 방법론을 체험한다.

#### 시나리오 배경

보안 감사의 일환으로, 공격자가 demo 네임스페이스의 nginx Pod를 통해 postgres 데이터베이스에 직접 접근할 수 있는지 테스트한다. 네트워크 정책이 이 공격을 효과적으로 차단하는지 확인한다.

#### 실습 단계

**Phase 1: 정찰 (Reconnaissance)**

```bash
# 1) 공격자 관점 — 현재 사용 가능한 서비스 파악
echo "=== 외부 노출 서비스 ==="
kubectl get svc -n demo --no-headers | grep NodePort
echo ""
echo "nginx-web: NodePort 30080 (외부 접근 가능)"
echo "keycloak: NodePort 30880 (외부 접근 가능)"

# 2) 모든 서비스 IP와 포트 파악
kubectl get svc -n demo
```

**Phase 2: 공격 시도 1 — nginx에서 postgres 직접 접근**

```bash
# 3) nginx Pod에서 postgres로 직접 TCP 연결 시도
kubectl exec -n demo $(kubectl get pod -n demo -l app=nginx-web -o name | head -1) -c nginx-web -- \
  sh -c 'echo "SELECT 1;" | nc -w 5 postgres.demo.svc.cluster.local 5432 2>&1' || echo "연결 실패"
```

예상 결과: 연결 시간 초과 또는 거부. nginx의 egress 정책(allow-nginx-egress)에는 postgres가 포함되어 있지 않으므로 접근이 차단된다.

**Phase 3: 공격 시도 2 — nginx에서 rabbitmq 접근**

```bash
# 4) nginx Pod에서 rabbitmq로 직접 접근 시도
kubectl exec -n demo $(kubectl get pod -n demo -l app=nginx-web -o name | head -1) -c nginx-web -- \
  sh -c 'nc -z -w 5 rabbitmq.demo.svc.cluster.local 5672 2>&1' || echo "연결 실패"
```

예상 결과: 차단됨. nginx의 egress에는 rabbitmq가 포함되어 있지 않다.

**Phase 4: 공격 시도 3 — nginx에서 httpbin으로 POST 시도 (L7 우회)**

```bash
# 5) nginx에서 httpbin으로 POST 요청 — L7 정책 우회 시도
kubectl exec -n demo $(kubectl get pod -n demo -l app=nginx-web -o name | head -1) -c nginx-web -- \
  curl -s -o /dev/null -w "%{http_code}" -X POST -d '{"attack":"payload"}' \
  http://httpbin.demo.svc.cluster.local:80/post --max-time 10
```

예상 출력: `403` — L7 정책에 의해 POST 메서드가 차단된다.

**Phase 5: 공격 시도 4 — 새 Pod 생성하여 postgres 접근 시도**

```bash
# 6) 공격자가 새로운 Pod를 생성하여 postgres에 접근 시도
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: attacker-pod
  namespace: demo
  labels:
    app: attacker
spec:
  containers:
  - name: attacker
    image: postgres:16-alpine
    command: ["sleep", "3600"]
EOF
```

```bash
# 7) 공격자 Pod에서 postgres 접근 시도
kubectl exec -n demo attacker-pod -- \
  sh -c 'PGPASSWORD=demo123 psql -h postgres.demo.svc.cluster.local -U postgres -d keycloak -c "SELECT 1;" 2>&1' --timeout=10
```

예상 결과: 연결 시간 초과. default-deny-all 정책에 의해 `app: attacker` 레이블을 가진 Pod의 egress가 차단된다 (DNS 제외).

```bash
# 8) DNS 조회는 가능하지만 실제 연결은 차단됨
kubectl exec -n demo attacker-pod -- nslookup postgres.demo.svc.cluster.local
echo "DNS 조회는 성공하지만 TCP 연결은 차단됨"
```

**Phase 6: 공격 시도 5 — 레이블 위조**

```bash
# 9) httpbin 레이블을 가진 Pod를 만들어 postgres 접근 시도
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: label-spoof-pod
  namespace: demo
  labels:
    app: httpbin
spec:
  containers:
  - name: attacker
    image: postgres:16-alpine
    command: ["sleep", "3600"]
EOF
```

```bash
# 10) httpbin 레이블로 위장한 Pod에서 postgres 접근 시도
kubectl exec -n demo label-spoof-pod -- \
  sh -c 'PGPASSWORD=demo123 psql -h postgres.demo.svc.cluster.local -U postgres -d keycloak -c "SELECT 1;" 2>&1'
```

> **중요**: 이 공격이 성공할 수 있다! CiliumNetworkPolicy는 Pod 레이블을 기반으로 동작하므로, RBAC로 Pod 생성 권한을 제한하지 않으면 레이블 위조 공격이 가능하다. 이것이 RBAC와 NetworkPolicy를 함께 사용해야 하는 이유이다.

**Phase 7: 방어 분석 및 결과 정리**

```bash
echo "=== 침투 테스트 결과 ==="
echo ""
echo "공격 시도 1: nginx→postgres 직접 접근     → 차단됨 (egress 정책)"
echo "공격 시도 2: nginx→rabbitmq 접근           → 차단됨 (egress 정책)"
echo "공격 시도 3: nginx→httpbin POST            → 차단됨 (L7 정책)"
echo "공격 시도 4: 새 Pod→postgres 접근          → 차단됨 (default-deny)"
echo "공격 시도 5: 레이블 위조→postgres 접근      → 성공 가능! (RBAC 미설정 시)"
echo ""
echo "=== 발견된 취약점 ==="
echo "1. Pod 생성 권한이 있는 사용자가 레이블을 위조하여 NetworkPolicy를 우회할 수 있음"
echo "2. 대응: RBAC로 demo 네임스페이스의 Pod 생성 권한을 엄격히 제한"
echo "3. 대응: Admission Controller(OPA/Gatekeeper)로 특정 레이블 사용 제한"
```

**Phase 8: 정리**

```bash
kubectl delete pod attacker-pod label-spoof-pod -n demo --grace-period=0 --force 2>/dev/null
```

#### 확인 문제
1. 레이블 위조 공격이 가능한 근본적인 이유는 무엇인가?
2. 레이블 위조 공격을 방지하기 위한 대책 3가지를 제시하라.
3. 침투 테스트에서 "정찰 → 공격 시도 → 결과 분석"의 순서가 중요한 이유는?
4. NetworkPolicy만으로는 완벽한 보안을 달성할 수 없는 이유를 설명하라.
5. Defense in Depth(다층 방어) 관점에서 이 시나리오의 각 방어 레이어를 설명하라.

#### 관련 KCSA 시험 주제
- 침투 테스트 기본 방법론
- NetworkPolicy의 한계
- RBAC와 NetworkPolicy의 상호 보완
- Defense in Depth
- Admission Controller를 활용한 정책 강제

---

## 부록: Prometheus 알림 규칙과 보안

tart-infra에 구성된 Prometheus 알림 규칙은 보안 모니터링의 일부이다.

| 알림 규칙 | 조건 | 심각도 | 보안 관련성 |
|-----------|------|--------|------------|
| HighCpuUsage | CPU > 80% / 5분 | warning | 크립토재킹, DoS 공격 징후 |
| HighMemoryUsage | Memory > 85% / 5분 | warning | 메모리 누수, DoS 공격 징후 |
| NodeNotReady | Node 미준비 / 5분 | critical | 인프라 공격, 장애 |
| PodCrashLooping | 재시작 > 5 / 15분 | warning | 설정 오류, 공격 시도 흔적 |
| PodOOMKilled | OOM 즉시 | warning | 리소스 고갈 공격, 메모리 제한 미설정 |

```bash
# 현재 알림 상태 확인 (Prometheus가 설치된 경우)
kubectl get pods -n monitoring -l app=prometheus 2>/dev/null
```

이러한 알림 규칙은 보안 사고의 조기 탐지에 핵심적인 역할을 한다. 특히 HighCpuUsage는 크립토재킹(암호화폐 채굴 악성코드) 감지에 유용하고, PodCrashLooping은 침입 시도의 흔적일 수 있다.

---

## 부록: SSH 보안 점검

tart-infra의 모든 VM은 `admin/admin` 계정으로 SSH 접속이 가능하다. 이는 학습 환경의 편의를 위한 설정이며, 프로덕션 환경에서는 절대로 사용해서는 안 된다.

```bash
# SSH 보안 점검
ssh admin@<dev-master-ip> 'sudo cat /etc/ssh/sshd_config' | grep -E "PasswordAuthentication|PermitRootLogin|PubkeyAuthentication"
```

프로덕션 보안 권장 사항:
- `PasswordAuthentication no` — 비밀번호 인증 비활성화
- `PermitRootLogin no` — root SSH 접근 차단
- `PubkeyAuthentication yes` — 공개키 인증만 허용
- SSH 키 최소 4096비트 RSA 또는 Ed25519 사용
- fail2ban 등으로 SSH 무차별 대입 공격 방지

---

## 부록: KCSA 시험 영역별 실습 매핑

| KCSA 시험 영역 | 비중 | 관련 실습 |
|---------------|------|----------|
| Overview of Cloud Native Security | 14% | 실습 1 (Lab 1.1~1.4) |
| Kubernetes Cluster Component Security | 22% | 실습 2 (Lab 2.1~2.5) |
| Kubernetes Security Fundamentals | 22% | 실습 3 (Lab 3.1~3.8) |
| Kubernetes Threat Model | 16% | 실습 4 (Lab 4.1~4.3) |
| Platform Security | 16% | 실습 5 (Lab 5.1~5.4) |
| Compliance and Security Frameworks | 10% | 실습 6 (Lab 6.1~6.3) |

---

## 부록: 핵심 kubectl 보안 명령어 치트시트

```bash
# === RBAC ===
kubectl auth can-i --list                                    # 현재 사용자 권한 확인
kubectl auth can-i create pods --as=system:serviceaccount:demo:default -n demo  # 특정 SA 권한 테스트
kubectl get clusterrole cluster-admin -o yaml                # ClusterRole 상세 확인
kubectl get clusterrolebinding -o wide                       # 바인딩 관계 확인

# === NetworkPolicy ===
kubectl get cnp -n demo                                      # CiliumNetworkPolicy 목록
kubectl get cnp <name> -n demo -o yaml                       # 정책 상세 확인
kubectl get networkpolicy -n demo                            # 기본 NetworkPolicy 목록

# === Secret ===
kubectl get secret -n demo                                   # Secret 목록
kubectl get secret <name> -n demo -o jsonpath='{.data}'      # Secret 데이터 (base64)
echo '<base64-data>' | base64 -d                             # base64 디코딩

# === Pod 보안 ===
kubectl get pod <name> -n demo -o jsonpath='{.spec.securityContext}'     # Pod 보안 컨텍스트
kubectl get pod <name> -n demo -o jsonpath='{.spec.containers[0].securityContext}'  # 컨테이너 보안 컨텍스트
kubectl get pod <name> -n demo -o jsonpath='{.spec.automountServiceAccountToken}'   # SA 토큰 마운트

# === Istio ===
kubectl get peerauthentication -n demo -o yaml               # mTLS 설정 확인
kubectl get destinationrule -n demo                          # 목적지 규칙 확인

# === 감사 ===
kubectl get events -n demo --sort-by='.lastTimestamp'        # 이벤트 확인 (보안 관련)
kubectl logs <pod> -n demo --previous                        # 이전 컨테이너 로그 (크래시 분석)

# === 노드 보안 ===
ssh admin@<node-ip> 'sudo cat /etc/kubernetes/manifests/kube-apiserver.yaml'  # API Server 설정
ssh admin@<node-ip> 'sudo cat /var/lib/kubelet/config.yaml'                   # kubelet 설정
ssh admin@<node-ip> 'sudo ls -la /etc/kubernetes/pki/'                        # PKI 인증서 목록
```

---

## 마무리

이 가이드에서는 tart-infra 환경을 활용하여 KCSA 시험의 전체 영역을 실습하였다. 핵심 내용을 요약하면 다음과 같다.

1. **4C 모델**: Cloud(VM 격리) → Cluster(RBAC, NetworkPolicy) → Container(securityContext) → Code(Secret 관리)의 각 레이어에서 보안을 적용해야 한다.

2. **Zero Trust**: default-deny-all 정책을 기본으로 하고, 필요한 통신만 명시적으로 허용한다. tart-infra의 11개 CiliumNetworkPolicy가 이 원칙을 구현하고 있다.

3. **Defense in Depth**: NetworkPolicy, RBAC, mTLS, PSA, seccomp, AppArmor 등 여러 보안 메커니즘을 중첩하여 단일 방어 실패 시에도 보안을 유지한다.

4. **최소 권한 원칙**: RBAC Role, ServiceAccount, securityContext 모두에서 필요한 최소한의 권한만 부여한다.

5. **지속적 모니터링**: Prometheus 알림 규칙, Audit Logging, CIS Benchmark 정기 실행을 통해 보안 상태를 지속적으로 모니터링한다.

6. **사고 대응**: 보안 사고 발생 시 탐지 → 분석 → 대응 → 복구 → 재발 방지의 체계적인 절차를 따른다.

이 모든 개념과 실습은 KCSA 시험 준비뿐만 아니라, 실제 Kubernetes 운영 환경에서의 보안 강화에도 직접 적용할 수 있다.
