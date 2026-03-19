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

---

### Lab 1.3: Container 레이어 — containerd 격리, securityContext

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

---

### Lab 2.2: etcd 보안 확인 (인증서 경로, 접근 제한)

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
