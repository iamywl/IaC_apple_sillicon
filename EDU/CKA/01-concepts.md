# CKA 핵심 개념 정리

> CKA(Certified Kubernetes Administrator) 시험은 **실기 시험**이다. 모든 문제를 터미널에서 직접 해결해야 하므로, 개념을 이해하는 것뿐 아니라 **kubectl 명령어와 YAML 작성에 익숙**해야 한다.

---

## 1. Cluster Architecture, Installation & Configuration (25%)

### 1.1 쿠버네티스 클러스터 아키텍처

쿠버네티스 클러스터는 **Control Plane**과 **Worker Node**로 구성된다.

#### Control Plane 구성 요소

| 컴포넌트 | 역할 | 기본 포트 |
|---|---|---|
| **kube-apiserver** | 모든 API 요청의 진입점이다. 인증, 인가, admission control을 수행한다. | 6443 |
| **etcd** | 클러스터의 모든 상태 데이터를 저장하는 키-값 저장소이다. | 2379(클라이언트), 2380(피어) |
| **kube-scheduler** | 새로 생성된 Pod를 적절한 노드에 배치한다. 리소스 요청량, affinity, taint/toleration 등을 고려한다. | 10259 |
| **kube-controller-manager** | 다양한 컨트롤러(Deployment, ReplicaSet, Node, Job 등)를 실행한다. 선언된 상태와 현재 상태를 비교하여 조정한다. | 10257 |
| **cloud-controller-manager** | 클라우드 프로바이더별 컨트롤러(로드밸런서, 노드, 라우트 등)를 실행한다. | 10258 |

#### Worker Node 구성 요소

| 컴포넌트 | 역할 |
|---|---|
| **kubelet** | 노드에서 Pod의 생명주기를 관리한다. API 서버로부터 PodSpec을 받아 컨테이너 런타임에 지시한다. |
| **kube-proxy** | Service에 대한 네트워크 규칙을 관리한다. iptables 또는 IPVS 모드로 동작한다. |
| **Container Runtime** | 실제 컨테이너를 실행한다. containerd, CRI-O 등 CRI 호환 런타임을 사용한다. |

#### 통신 흐름

```
사용자 → kubectl → kube-apiserver → etcd (읽기/쓰기)
                         ↓
                    kube-scheduler (Pod 스케줄링)
                         ↓
                    kubelet (Pod 실행)
                         ↓
                    Container Runtime (컨테이너 생성)
```

모든 컴포넌트는 kube-apiserver를 통해서만 통신한다. 컴포넌트 간 직접 통신은 하지 않는다.

---

### 1.2 kubeadm을 이용한 클러스터 설치

#### 사전 요구 사항

- 스왑(swap)을 비활성화해야 한다: `swapoff -a`
- 필요한 커널 모듈을 로드해야 한다: `br_netfilter`, `overlay`
- sysctl 파라미터를 설정해야 한다:
  - `net.bridge.bridge-nf-call-iptables = 1`
  - `net.bridge.bridge-nf-call-ip6tables = 1`
  - `net.ipv4.ip_forward = 1`
- 컨테이너 런타임(containerd 등)을 설치해야 한다
- kubeadm, kubelet, kubectl을 설치해야 한다

#### kubeadm init 과정 (Control Plane 초기화)

`kubeadm init` 명령은 다음 단계를 순차적으로 수행한다:

1. **Preflight checks**: 시스템 요구사항(포트, 스왑, 커널 모듈 등)을 확인한다.
2. **인증서 생성**: `/etc/kubernetes/pki/` 디렉터리에 CA, apiserver, kubelet 등의 인증서를 생성한다.
3. **kubeconfig 파일 생성**: admin, controller-manager, scheduler, kubelet용 kubeconfig를 `/etc/kubernetes/`에 생성한다.
4. **Static Pod manifest 생성**: apiserver, controller-manager, scheduler, etcd의 매니페스트를 `/etc/kubernetes/manifests/`에 생성한다.
5. **kubelet 시작**: Static Pod를 통해 Control Plane 컴포넌트를 시작한다.
6. **Bootstrap token 생성**: Worker Node가 조인할 때 사용할 토큰을 생성한다.
7. **CoreDNS, kube-proxy addon 설치**: 클러스터 DNS와 네트워크 프록시를 배포한다.

주요 옵션:
- `--pod-network-cidr`: Pod 네트워크 대역 지정 (CNI에 따라 필수)
- `--apiserver-advertise-address`: API 서버의 광고 주소 지정
- `--control-plane-endpoint`: HA 구성 시 로드밸런서 주소 지정
- `--cri-socket`: 컨테이너 런타임 소켓 경로 지정
- `--kubernetes-version`: 설치할 쿠버네티스 버전 지정

#### kubeadm join 과정 (Worker Node 추가)

Worker Node를 클러스터에 추가하는 과정이다:

1. `kubeadm init` 완료 후 출력되는 `kubeadm join` 명령을 Worker Node에서 실행한다.
2. 토큰과 CA 인증서 해시를 사용하여 apiserver에 인증한다.
3. kubelet이 시작되고 노드가 클러스터에 등록된다.

토큰이 만료된 경우 새 토큰을 생성할 수 있다:
```bash
kubeadm token create --print-join-command
```

---

### 1.3 클러스터 업그레이드 절차

쿠버네티스 클러스터 업그레이드는 반드시 **한 마이너 버전씩 순차적**으로 수행해야 한다 (예: 1.28 → 1.29 → 1.30). 건너뛰기(skip) 업그레이드는 지원하지 않는다.

#### 업그레이드 순서 (반드시 준수)

1. **Control Plane 노드** (먼저)
2. **Worker Node** (나중에)

#### Control Plane 업그레이드 절차

```
1. kubeadm 업그레이드
2. kubeadm upgrade plan (업그레이드 가능 여부 확인)
3. kubeadm upgrade apply v1.XX.Y (Control Plane 컴포넌트 업그레이드)
4. 노드 drain (kubectl drain)
5. kubelet, kubectl 업그레이드
6. kubelet 재시작 (systemctl restart kubelet)
7. 노드 uncordon (kubectl uncordon)
```

#### Worker Node 업그레이드 절차

```
1. 노드 drain (kubectl drain --ignore-daemonsets --delete-emptydir-data)
2. kubeadm 업그레이드
3. kubeadm upgrade node (노드 설정 업그레이드)
4. kubelet, kubectl 업그레이드
5. kubelet 재시작
6. 노드 uncordon
```

핵심 포인트:
- `kubectl drain`은 해당 노드의 Pod를 다른 노드로 이동시킨다. `--ignore-daemonsets` 플래그는 DaemonSet Pod를 무시한다.
- `kubectl cordon`은 새로운 Pod가 스케줄링되는 것만 방지한다. 기존 Pod는 그대로 유지된다.
- `kubectl uncordon`은 노드를 다시 스케줄링 가능 상태로 복원한다.

---

### 1.4 etcd 백업과 복구

etcd는 클러스터의 모든 상태 데이터를 저장하므로, 정기적인 백업은 필수이다. CKA 시험에서 자주 출제된다.

#### etcd 백업 (etcdctl snapshot save)

etcdctl은 반드시 **API 버전 3**을 사용해야 한다.

필요한 인증서 파일:
- `--cacert`: CA 인증서 (`/etc/kubernetes/pki/etcd/ca.crt`)
- `--cert`: etcd 서버 인증서 (`/etc/kubernetes/pki/etcd/server.crt`)
- `--key`: etcd 서버 키 (`/etc/kubernetes/pki/etcd/server.key`)
- `--endpoints`: etcd 엔드포인트 (`https://127.0.0.1:2379`)

백업 명령:
```bash
ETCDCTL_API=3 etcdctl snapshot save /tmp/etcd-backup.db \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key
```

백업 검증:
```bash
ETCDCTL_API=3 etcdctl snapshot status /tmp/etcd-backup.db --write-out=table
```

#### etcd 복구 (etcdctl snapshot restore)

복구 절차:
1. etcd를 중지한다 (Static Pod의 경우 매니페스트를 `/etc/kubernetes/manifests/`에서 이동).
2. 기존 데이터 디렉터리를 백업한다.
3. 스냅샷을 복구한다.
4. 새 데이터 디렉터리를 사용하도록 etcd 매니페스트를 수정한다.
5. etcd를 재시작한다.

복구 명령:
```bash
ETCDCTL_API=3 etcdctl snapshot restore /tmp/etcd-backup.db \
  --data-dir=/var/lib/etcd-restored
```

복구 후 etcd 매니페스트(`/etc/kubernetes/manifests/etcd.yaml`)에서 `--data-dir`을 `/var/lib/etcd-restored`로 변경하거나, hostPath 볼륨 마운트 경로를 수정해야 한다.

---

### 1.5 RBAC (Role-Based Access Control)

RBAC는 쿠버네티스에서 인가(Authorization)를 담당하는 핵심 메커니즘이다.

#### RBAC 리소스 구조

| 리소스 | 범위 | 설명 |
|---|---|---|
| **Role** | 네임스페이스 | 특정 네임스페이스 내 리소스에 대한 권한을 정의한다. |
| **ClusterRole** | 클러스터 전체 | 클러스터 전체 또는 비-네임스페이스 리소스에 대한 권한을 정의한다. |
| **RoleBinding** | 네임스페이스 | Role 또는 ClusterRole을 사용자/그룹/서비스어카운트에 바인딩한다. |
| **ClusterRoleBinding** | 클러스터 전체 | ClusterRole을 사용자/그룹/서비스어카운트에 바인딩한다. |

#### 핵심 개념

- **Role/ClusterRole**은 "무엇을 할 수 있는가"를 정의한다 (verbs: get, list, watch, create, update, delete, patch).
- **RoleBinding/ClusterRoleBinding**은 "누가 그 권한을 가지는가"를 정의한다.
- **subjects**는 User, Group, ServiceAccount 중 하나이다.
- RoleBinding은 ClusterRole을 참조할 수 있다. 이 경우 ClusterRole의 권한이 해당 네임스페이스로 한정된다.

#### API Groups

- Core API (v1): pods, services, configmaps, secrets, namespaces, nodes, persistentvolumes, persistentvolumeclaims
- apps: deployments, replicasets, statefulsets, daemonsets
- batch: jobs, cronjobs
- networking.k8s.io: networkpolicies, ingresses
- rbac.authorization.k8s.io: roles, clusterroles, rolebindings, clusterrolebindings
- storage.k8s.io: storageclasses

Core API 그룹의 `apiGroups`는 `[""]`로 지정한다.

#### ServiceAccount

- 모든 네임스페이스에는 `default` ServiceAccount가 존재한다.
- Pod는 기본적으로 `default` ServiceAccount를 사용한다.
- 1.24 버전부터 ServiceAccount 생성 시 자동으로 시크릿이 생성되지 않는다. TokenRequest API를 사용한다.
- `spec.serviceAccountName`으로 Pod에 ServiceAccount를 지정한다.
- `automountServiceAccountToken: false`로 자동 마운트를 비활성화할 수 있다.

---

### 1.6 HA (High Availability) 클러스터

#### Stacked etcd 토폴로지

- etcd가 Control Plane 노드에 함께 실행된다.
- 설정이 간단하지만, Control Plane 노드 장애 시 etcd도 함께 영향을 받는다.
- 최소 3개의 Control Plane 노드가 필요하다 (etcd의 quorum 요구사항).

```
Control Plane Node 1         Control Plane Node 2         Control Plane Node 3
┌─────────────────┐         ┌─────────────────┐         ┌─────────────────┐
│ apiserver       │         │ apiserver       │         │ apiserver       │
│ scheduler       │         │ scheduler       │         │ scheduler       │
│ controller-mgr  │         │ controller-mgr  │         │ controller-mgr  │
│ etcd            │←───────→│ etcd            │←───────→│ etcd            │
└─────────────────┘         └─────────────────┘         └─────────────────┘
         ↑                           ↑                           ↑
         └───────────────────────────┼───────────────────────────┘
                                     │
                              Load Balancer
```

#### External etcd 토폴로지

- etcd가 별도의 노드에서 실행된다.
- Control Plane 노드 장애가 etcd에 영향을 주지 않는다.
- 더 많은 인프라가 필요하지만 안정성이 높다.
- etcd 클러스터와 Control Plane 클러스터를 독립적으로 확장할 수 있다.

#### etcd Quorum

- etcd는 Raft 합의 알고리즘을 사용한다.
- 쓰기 작업에는 과반수(quorum)의 동의가 필요하다.
- quorum = (n/2) + 1
  - 3개 노드: 1개 장애 허용 (quorum = 2)
  - 5개 노드: 2개 장애 허용 (quorum = 3)
  - 7개 노드: 3개 장애 허용 (quorum = 4)
- 짝수 개의 노드는 홀수 개와 같은 장애 허용 수를 가지므로 비효율적이다 (4개 노드도 quorum = 3이므로 1개만 허용).

---

### 1.7 kubeconfig 파일 구조와 컨텍스트 전환

kubeconfig 파일은 클러스터 접근 정보를 저장한다. 기본 위치는 `~/.kube/config`이다.

#### kubeconfig 구조

```yaml
apiVersion: v1
kind: Config
current-context: my-context    # 현재 활성 컨텍스트

clusters:                       # 클러스터 접속 정보
- cluster:
    certificate-authority-data: <base64-encoded-ca-cert>
    server: https://192.168.1.100:6443
  name: my-cluster

users:                          # 사용자 인증 정보
- name: my-user
  user:
    client-certificate-data: <base64-encoded-cert>
    client-key-data: <base64-encoded-key>

contexts:                       # 클러스터 + 사용자 + 네임스페이스 조합
- context:
    cluster: my-cluster
    user: my-user
    namespace: default
  name: my-context
```

#### 컨텍스트 관련 명령어

```bash
# 현재 컨텍스트 확인
kubectl config current-context

# 사용 가능한 컨텍스트 목록
kubectl config get-contexts

# 컨텍스트 전환
kubectl config use-context <context-name>

# 특정 컨텍스트의 기본 네임스페이스 변경
kubectl config set-context --current --namespace=<namespace>

# 새 컨텍스트 생성
kubectl config set-context <context-name> \
  --cluster=<cluster> --user=<user> --namespace=<namespace>

# 특정 kubeconfig 파일 사용
kubectl --kubeconfig=/path/to/config get pods
# 또는
export KUBECONFIG=/path/to/config
```

CKA 시험에서는 여러 클러스터를 전환하며 문제를 풀어야 한다. 각 문제 시작 시 `kubectl config use-context <context-name>` 명령이 주어진다. 반드시 실행한 후 문제를 풀어야 한다.

---

## 2. Workloads & Scheduling (15%)

### 2.1 Deployment 전략

#### Rolling Update (기본 전략)

Pod를 점진적으로 교체하는 전략이다. 서비스 중단 없이 업데이트할 수 있다.

```yaml
spec:
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 25%          # 원하는 수 대비 초과 생성할 수 있는 최대 Pod 수
      maxUnavailable: 25%    # 업데이트 중 사용 불가한 최대 Pod 수
```

- **maxSurge**: 업데이트 중 `replicas`보다 몇 개 더 생성할 수 있는지 지정한다. 백분율 또는 절대값으로 지정한다.
- **maxUnavailable**: 업데이트 중 몇 개까지 사용 불가능해도 되는지 지정한다. 백분율 또는 절대값으로 지정한다.
- 둘 다 0으로 설정할 수는 없다.

#### Recreate

모든 기존 Pod를 먼저 제거한 후 새 Pod를 생성한다. 다운타임이 발생한다.

```yaml
spec:
  strategy:
    type: Recreate
```

같은 볼륨을 공유하는 Pod가 동시에 실행되면 안 되는 경우에 사용한다.

#### Rollout 관리

```bash
# 배포 상태 확인
kubectl rollout status deployment/<name>

# 배포 이력 확인
kubectl rollout history deployment/<name>

# 특정 리비전 상세 확인
kubectl rollout history deployment/<name> --revision=2

# 이전 버전으로 롤백
kubectl rollout undo deployment/<name>

# 특정 리비전으로 롤백
kubectl rollout undo deployment/<name> --to-revision=2

# 배포 일시 정지
kubectl rollout pause deployment/<name>

# 배포 재개
kubectl rollout resume deployment/<name>
```

---

### 2.2 Pod 스케줄링

#### nodeSelector

가장 간단한 노드 선택 방법이다. 노드의 레이블과 매칭하여 스케줄링한다.

```yaml
spec:
  nodeSelector:
    disktype: ssd
    region: ap-northeast-2
```

해당 레이블이 있는 노드에만 Pod가 스케줄링된다. 매칭되는 노드가 없으면 Pod는 Pending 상태가 된다.

#### Node Affinity

nodeSelector보다 유연한 노드 선택 방법이다. 두 가지 종류가 있다:

**requiredDuringSchedulingIgnoredDuringExecution** (Hard): 반드시 만족해야 한다. 조건을 만족하는 노드가 없으면 Pod가 스케줄링되지 않는다.

```yaml
spec:
  affinity:
    nodeAffinity:
      requiredDuringSchedulingIgnoredDuringExecution:
        nodeSelectorTerms:
        - matchExpressions:
          - key: kubernetes.io/os
            operator: In
            values:
            - linux
          - key: disktype
            operator: In
            values:
            - ssd
            - nvme
```

**preferredDuringSchedulingIgnoredDuringExecution** (Soft): 가능하면 만족시키지만, 만족하는 노드가 없으면 다른 노드에도 스케줄링된다.

```yaml
spec:
  affinity:
    nodeAffinity:
      preferredDuringSchedulingIgnoredDuringExecution:
      - weight: 80
        preference:
          matchExpressions:
          - key: zone
            operator: In
            values:
            - zone-a
      - weight: 20
        preference:
          matchExpressions:
          - key: zone
            operator: In
            values:
            - zone-b
```

**operator 종류**: `In`, `NotIn`, `Exists`, `DoesNotExist`, `Gt`, `Lt`

#### Pod Affinity / Pod Anti-Affinity

다른 Pod와의 관계를 기반으로 스케줄링한다.

**podAffinity**: 특정 Pod가 실행 중인 노드에 함께 스케줄링한다.

```yaml
spec:
  affinity:
    podAffinity:
      requiredDuringSchedulingIgnoredDuringExecution:
      - labelSelector:
          matchExpressions:
          - key: app
            operator: In
            values:
            - cache
        topologyKey: kubernetes.io/hostname
```

**podAntiAffinity**: 특정 Pod가 실행 중인 노드를 피해서 스케줄링한다. 고가용성을 위해 같은 Deployment의 Pod를 서로 다른 노드에 분산시킬 때 사용한다.

```yaml
spec:
  affinity:
    podAntiAffinity:
      preferredDuringSchedulingIgnoredDuringExecution:
      - weight: 100
        podAffinityTerm:
          labelSelector:
            matchExpressions:
            - key: app
              operator: In
              values:
              - web
          topologyKey: kubernetes.io/hostname
```

`topologyKey`는 노드 레이블의 키로, 해당 레이블 값이 같은 노드를 하나의 "토폴로지 도메인"으로 취급한다. 일반적으로 `kubernetes.io/hostname`(노드 단위) 또는 `topology.kubernetes.io/zone`(존 단위)을 사용한다.

---

### 2.3 Taint와 Toleration

Taint는 노드에 설정하여 특정 조건을 만족하지 않는 Pod의 스케줄링을 거부한다. Toleration은 Pod에 설정하여 해당 Taint를 허용한다.

#### Taint Effect 종류

| Effect | 설명 |
|---|---|
| **NoSchedule** | Toleration이 없는 Pod는 해당 노드에 스케줄링되지 않는다. 이미 실행 중인 Pod에는 영향 없다. |
| **PreferNoSchedule** | 가능하면 스케줄링하지 않지만, 다른 노드가 없으면 스케줄링될 수 있다. |
| **NoExecute** | Toleration이 없는 Pod는 스케줄링되지 않고, 이미 실행 중인 Pod도 축출(evict)된다. |

#### Taint 관리

```bash
# Taint 추가
kubectl taint nodes node1 key=value:NoSchedule

# Taint 제거 (끝에 - 추가)
kubectl taint nodes node1 key=value:NoSchedule-

# 노드의 Taint 확인
kubectl describe node node1 | grep -A5 Taints
```

#### Toleration 설정

```yaml
spec:
  tolerations:
  - key: "key"
    operator: "Equal"
    value: "value"
    effect: "NoSchedule"

  # 또는 Exists operator (value 불필요)
  - key: "key"
    operator: "Exists"
    effect: "NoSchedule"

  # 모든 Taint를 tolerate
  - operator: "Exists"
```

- `operator: Equal`은 key, value, effect가 모두 일치해야 한다.
- `operator: Exists`는 key와 effect만 일치하면 된다 (value 불필요).
- key가 비어있고 `operator: Exists`이면 모든 Taint를 tolerate한다.
- `tolerationSeconds`를 지정하면 NoExecute Taint에 대해 해당 시간 동안만 tolerate한다.

Control Plane 노드에는 기본적으로 `node-role.kubernetes.io/control-plane:NoSchedule` Taint가 설정되어 있어 일반 Pod가 스케줄링되지 않는다.

---

### 2.4 Resource 관리

#### Requests와 Limits

```yaml
spec:
  containers:
  - name: app
    resources:
      requests:          # 스케줄링 시 보장되는 최소 리소스
        cpu: "250m"      # 0.25 CPU core
        memory: "128Mi"
      limits:            # 사용할 수 있는 최대 리소스
        cpu: "500m"
        memory: "256Mi"
```

- **requests**: 스케줄러가 Pod를 배치할 때 참고하는 값이다. 노드에 해당 리소스 여유가 있어야 스케줄링된다.
- **limits**: 컨테이너가 사용할 수 있는 최대값이다. CPU는 초과 시 throttling, 메모리는 초과 시 OOMKilled된다.
- CPU 단위: `1` = 1 vCPU, `100m` = 0.1 vCPU (m = milli)
- 메모리 단위: `Mi` (Mebibyte), `Gi` (Gibibyte), `M` (Megabyte), `G` (Gigabyte)

#### LimitRange

네임스페이스 내에서 컨테이너/Pod 단위의 리소스 기본값과 제한을 설정한다.

```yaml
apiVersion: v1
kind: LimitRange
metadata:
  name: resource-limits
  namespace: dev
spec:
  limits:
  - type: Container
    default:           # 기본 limits
      cpu: "500m"
      memory: "256Mi"
    defaultRequest:    # 기본 requests
      cpu: "100m"
      memory: "128Mi"
    max:               # 최대 허용값
      cpu: "2"
      memory: "1Gi"
    min:               # 최소 허용값
      cpu: "50m"
      memory: "64Mi"
  - type: Pod
    max:
      cpu: "4"
      memory: "2Gi"
```

#### ResourceQuota

네임스페이스 전체의 리소스 사용량을 제한한다.

```yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: compute-quota
  namespace: dev
spec:
  hard:
    requests.cpu: "4"
    requests.memory: "4Gi"
    limits.cpu: "8"
    limits.memory: "8Gi"
    pods: "20"
    services: "10"
    persistentvolumeclaims: "5"
    configmaps: "10"
    secrets: "10"
```

ResourceQuota가 설정된 네임스페이스에서는 모든 Pod에 requests/limits를 지정해야 한다. LimitRange로 기본값을 설정하면 편리하다.

---

### 2.5 워크로드 리소스 비교

#### DaemonSet

- 모든 노드(또는 지정된 노드)에 **정확히 하나의 Pod**를 실행한다.
- 노드가 추가되면 자동으로 Pod가 생성되고, 노드가 제거되면 Pod도 삭제된다.
- 사용 사례: 로그 수집(fluentd), 모니터링 에이전트(prometheus node-exporter), 네트워크 플러그인(kube-proxy, CNI)
- `spec.selector`와 `spec.template.metadata.labels`가 일치해야 한다.

#### StatefulSet

- Pod에 **고유한 순서 번호와 안정적인 네트워크 ID**를 부여한다.
- Pod 이름이 `<statefulset-name>-0`, `<statefulset-name>-1` 형태이다.
- **순서대로 생성**되고 **역순으로 삭제**된다.
- 각 Pod에 대해 별도의 PersistentVolumeClaim을 생성한다 (`volumeClaimTemplates`).
- **Headless Service**(`clusterIP: None`)가 필요하다. `<pod-name>.<service-name>.<namespace>.svc.cluster.local`로 개별 Pod에 접근한다.
- 사용 사례: 데이터베이스(MySQL, PostgreSQL), 메시지 큐(Kafka, RabbitMQ), 캐시(Redis Cluster)

#### Job

- 하나 이상의 Pod를 생성하여 **지정된 작업을 완료**할 때까지 실행한다.
- Pod가 성공적으로 완료되면 Job은 완료 상태가 된다.
- `spec.completions`: 성공적으로 완료해야 할 Pod 수
- `spec.parallelism`: 동시에 실행할 Pod 수
- `spec.backoffLimit`: 실패 시 재시도 횟수
- `spec.activeDeadlineSeconds`: Job의 최대 실행 시간
- `restartPolicy`는 `Never` 또는 `OnFailure`만 가능하다 (`Always` 불가).

#### CronJob

- **크론 스케줄**에 따라 주기적으로 Job을 생성한다.
- `spec.schedule`: 크론 표현식 (분 시 일 월 요일)
- `spec.successfulJobsHistoryLimit`: 보관할 성공 Job 수 (기본 3)
- `spec.failedJobsHistoryLimit`: 보관할 실패 Job 수 (기본 1)
- `spec.concurrencyPolicy`: `Allow`(기본), `Forbid`, `Replace`
- `spec.startingDeadlineSeconds`: 스케줄 시간 이후 허용되는 시작 지연 시간

---

### 2.6 Static Pod

kubelet이 직접 관리하는 Pod이다. API 서버를 거치지 않는다.

- 매니페스트 파일 위치: `/etc/kubernetes/manifests/` (기본값)
- kubelet의 `--pod-manifest-path` 또는 `--config` 파일의 `staticPodPath`로 경로를 변경할 수 있다.
- 매니페스트 파일을 해당 디렉터리에 배치하면 kubelet이 자동으로 Pod를 생성한다.
- 파일을 삭제하면 Pod도 삭제된다.
- API 서버에 미러(mirror) Pod로 표시되지만, kubectl로 삭제할 수 없다.
- Control Plane 컴포넌트(apiserver, scheduler, controller-manager, etcd)는 Static Pod로 실행된다.

Static Pod 경로 확인:
```bash
# kubelet 설정 파일에서 확인
cat /var/lib/kubelet/config.yaml | grep staticPodPath

# 또는 kubelet 프로세스에서 확인
ps aux | grep kubelet | grep -- --pod-manifest-path
```

---

## 3. Services & Networking (20%)

### 3.1 Service 유형

#### ClusterIP (기본값)

- 클러스터 내부에서만 접근 가능한 가상 IP를 할당한다.
- 외부에서 직접 접근할 수 없다.
- `selector`로 대상 Pod를 지정한다.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: my-service
spec:
  type: ClusterIP
  selector:
    app: my-app
  ports:
  - port: 80          # Service 포트
    targetPort: 8080   # Pod의 컨테이너 포트
    protocol: TCP
```

#### NodePort

- 모든 노드의 특정 포트(30000-32767)로 외부에서 접근할 수 있다.
- ClusterIP를 포함한다 (내부에서도 ClusterIP로 접근 가능).
- `nodePort`를 지정하지 않으면 자동 할당된다.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: my-nodeport-svc
spec:
  type: NodePort
  selector:
    app: my-app
  ports:
  - port: 80
    targetPort: 8080
    nodePort: 30080    # 노드에서 열리는 포트 (30000-32767)
```

접근 방법: `http://<NodeIP>:30080`

#### LoadBalancer

- 클라우드 프로바이더의 로드밸런서를 프로비저닝한다.
- NodePort와 ClusterIP를 모두 포함한다.
- 온프레미스에서는 MetalLB 같은 솔루션이 필요하다.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: my-lb-svc
spec:
  type: LoadBalancer
  selector:
    app: my-app
  ports:
  - port: 80
    targetPort: 8080
```

#### ExternalName

- 외부 DNS 이름에 대한 CNAME 레코드를 생성한다.
- 프록시나 포워딩이 아닌 DNS 레벨의 리다이렉션이다.
- selector가 없다.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: my-external-svc
spec:
  type: ExternalName
  externalName: my-database.example.com
```

#### Headless Service

- `clusterIP: None`으로 설정한다.
- 가상 IP를 할당하지 않고, DNS 조회 시 Pod의 IP를 직접 반환한다.
- StatefulSet과 함께 사용하여 개별 Pod에 DNS 이름으로 접근한다.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: my-headless-svc
spec:
  clusterIP: None
  selector:
    app: my-app
  ports:
  - port: 80
    targetPort: 8080
```

DNS 레코드: `<pod-name>.<service-name>.<namespace>.svc.cluster.local`

---

### 3.2 Ingress

Ingress는 클러스터 외부에서 내부 Service로의 HTTP/HTTPS 라우팅 규칙을 정의한다.

#### 구성 요소

- **Ingress Controller**: 실제 트래픽 라우팅을 수행하는 컨트롤러이다. nginx, traefik, HAProxy 등이 있다. 클러스터에 별도로 설치해야 한다.
- **IngressClass**: 어떤 Ingress Controller가 Ingress를 처리할지 지정한다.
- **Ingress 리소스**: 라우팅 규칙을 정의하는 쿠버네티스 리소스이다.

#### IngressClass

```yaml
apiVersion: networking.k8s.io/v1
kind: IngressClass
metadata:
  name: nginx
  annotations:
    ingressclass.kubernetes.io/is-default-class: "true"  # 기본 IngressClass
spec:
  controller: k8s.io/ingress-nginx
```

#### Ingress 리소스

**Path-based 라우팅:**

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: my-ingress
  annotations:
    nginx.ingress.kubernetes.io/rewrite-target: /
spec:
  ingressClassName: nginx
  rules:
  - host: myapp.example.com
    http:
      paths:
      - path: /api
        pathType: Prefix
        backend:
          service:
            name: api-service
            port:
              number: 80
      - path: /web
        pathType: Prefix
        backend:
          service:
            name: web-service
            port:
              number: 80
```

**Host-based 라우팅:**

```yaml
spec:
  rules:
  - host: api.example.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: api-service
            port:
              number: 80
  - host: web.example.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: web-service
            port:
              number: 80
```

**TLS 설정:**

```yaml
spec:
  tls:
  - hosts:
    - myapp.example.com
    secretName: tls-secret
  rules:
  - host: myapp.example.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: my-service
            port:
              number: 80
```

**pathType 종류:**
- `Exact`: 정확히 일치하는 경로만 매칭한다.
- `Prefix`: 접두사 기반으로 매칭한다 (`/api`는 `/api`, `/api/v1`, `/api/users` 등과 매칭).
- `ImplementationSpecific`: Ingress Controller의 구현에 따라 다르다.

---

### 3.3 NetworkPolicy

NetworkPolicy는 Pod 간 네트워크 트래픽을 제어하는 방화벽 규칙이다. **CNI 플러그인이 NetworkPolicy를 지원해야 한다** (Calico, Cilium, Weave Net 등 지원. Flannel은 미지원).

#### 기본 동작

- NetworkPolicy가 없으면 모든 트래픽이 허용된다.
- NetworkPolicy가 하나라도 적용되면, 해당 정책에서 **명시적으로 허용한 트래픽만** 통과한다.
- ingress(인바운드)와 egress(아웃바운드) 규칙을 각각 설정한다.

#### Default Deny 정책

**모든 인바운드 트래픽 차단:**

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-ingress
  namespace: production
spec:
  podSelector: {}          # 네임스페이스의 모든 Pod에 적용
  policyTypes:
  - Ingress                # Ingress 규칙이 비어있으므로 모든 인바운드 차단
```

**모든 아웃바운드 트래픽 차단:**

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-egress
  namespace: production
spec:
  podSelector: {}
  policyTypes:
  - Egress
```

**모든 트래픽 차단:**

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
  namespace: production
spec:
  podSelector: {}
  policyTypes:
  - Ingress
  - Egress
```

#### 특정 트래픽 허용

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-specific
  namespace: production
spec:
  podSelector:
    matchLabels:
      app: db                  # 이 정책이 적용되는 Pod
  policyTypes:
  - Ingress
  - Egress
  ingress:
  - from:
    - podSelector:             # 같은 네임스페이스의 특정 Pod에서 오는 트래픽
        matchLabels:
          app: backend
    - namespaceSelector:       # 특정 네임스페이스의 모든 Pod에서 오는 트래픽
        matchLabels:
          env: staging
    - ipBlock:                 # 특정 IP 대역에서 오는 트래픽
        cidr: 10.0.0.0/8
        except:
        - 10.0.1.0/24
    ports:
    - protocol: TCP
      port: 3306
  egress:
  - to:
    - podSelector:
        matchLabels:
          app: cache
    ports:
    - protocol: TCP
      port: 6379
```

**중요**: `from` 배열 내 항목들은 **OR** 관계이다. 하나의 항목 내에서 여러 셀렉터를 사용하면 **AND** 관계이다.

```yaml
# OR: podSelector 또는 namespaceSelector 중 하나만 만족하면 허용
ingress:
- from:
  - podSelector:
      matchLabels:
        app: frontend
  - namespaceSelector:
      matchLabels:
        env: production

# AND: podSelector와 namespaceSelector를 모두 만족해야 허용
ingress:
- from:
  - podSelector:
      matchLabels:
        app: frontend
    namespaceSelector:
      matchLabels:
        env: production
```

위 두 예시의 차이를 반드시 이해해야 한다. 첫 번째는 `-`가 두 개이므로 두 개의 별도 규칙(OR)이고, 두 번째는 `-`가 하나이므로 하나의 규칙 내 두 조건(AND)이다.

---

### 3.4 CoreDNS

CoreDNS는 쿠버네티스 클러스터의 DNS 서버이다. `kube-system` 네임스페이스에서 Deployment로 실행된다.

#### DNS 레코드 형식

| 리소스 | DNS 형식 |
|---|---|
| Service | `<service>.<namespace>.svc.cluster.local` |
| Pod | `<pod-ip-dashed>.<namespace>.pod.cluster.local` |
| StatefulSet Pod | `<pod-name>.<service>.<namespace>.svc.cluster.local` |

예시:
- Service: `my-svc.default.svc.cluster.local`
- Pod (IP: 10.244.1.5): `10-244-1-5.default.pod.cluster.local`
- StatefulSet Pod: `web-0.my-headless-svc.default.svc.cluster.local`

#### CoreDNS 설정

CoreDNS의 설정은 `kube-system` 네임스페이스의 `coredns` ConfigMap에 저장된다.

```bash
kubectl -n kube-system get configmap coredns -o yaml
```

#### Pod DNS 정책

`spec.dnsPolicy`로 Pod의 DNS 해석 방식을 제어한다:

- `ClusterFirst` (기본값): 클러스터 DNS(CoreDNS)를 먼저 사용한다.
- `Default`: 노드의 DNS 설정을 사용한다.
- `None`: `spec.dnsConfig`에서 수동으로 설정한다.
- `ClusterFirstWithHostNet`: `hostNetwork: true`인 Pod에서 클러스터 DNS를 사용한다.

---

### 3.5 CNI (Container Network Interface)

CNI는 컨테이너의 네트워크 인터페이스를 설정하는 표준 플러그인 인터페이스이다.

- CNI 플러그인 설정 파일 위치: `/etc/cni/net.d/`
- CNI 바이너리 위치: `/opt/cni/bin/`
- 주요 CNI 플러그인: Calico, Flannel, Weave Net, Cilium
- kubeadm으로 클러스터 설치 후 CNI 플러그인을 별도로 설치해야 한다.
- CNI가 설치되지 않으면 노드는 `NotReady` 상태이고, Pod는 네트워크를 사용할 수 없다.

---

## 4. Storage (10%)

### 4.1 Volume 종류

#### emptyDir

- Pod와 생명주기를 같이 한다. Pod가 삭제되면 데이터도 삭제된다.
- 같은 Pod 내 컨테이너 간 데이터 공유에 사용한다.
- `medium: Memory`로 설정하면 tmpfs(메모리)를 사용한다.

```yaml
spec:
  containers:
  - name: app
    volumeMounts:
    - name: shared-data
      mountPath: /data
  - name: sidecar
    volumeMounts:
    - name: shared-data
      mountPath: /log
  volumes:
  - name: shared-data
    emptyDir: {}
```

#### hostPath

- 노드의 파일시스템 경로를 Pod에 마운트한다.
- Pod가 재스케줄링되면 다른 노드의 데이터에 접근할 수 없다.
- 보안 위험이 있으므로 일반적으로 사용을 권장하지 않는다.
- 사용 사례: 노드의 로그 수집, Docker 소켓 접근

```yaml
spec:
  volumes:
  - name: host-vol
    hostPath:
      path: /var/log
      type: Directory     # Directory, DirectoryOrCreate, File, FileOrCreate 등
```

### 4.2 PersistentVolume (PV)과 PersistentVolumeClaim (PVC)

#### 개념

- **PersistentVolume (PV)**: 관리자가 프로비저닝한 클러스터 수준의 스토리지 리소스이다. 네임스페이스에 속하지 않는다.
- **PersistentVolumeClaim (PVC)**: 사용자가 스토리지를 요청하는 리소스이다. 네임스페이스에 속한다.
- Pod는 PVC를 통해 PV를 사용한다.

#### PV 정의

```yaml
apiVersion: v1
kind: PersistentVolume
metadata:
  name: my-pv
spec:
  capacity:
    storage: 10Gi
  accessModes:
  - ReadWriteOnce
  persistentVolumeReclaimPolicy: Retain
  storageClassName: manual
  hostPath:
    path: /mnt/data
```

#### PVC 정의

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: my-pvc
  namespace: default
spec:
  accessModes:
  - ReadWriteOnce
  resources:
    requests:
      storage: 5Gi
  storageClassName: manual
```

#### Pod에서 PVC 사용

```yaml
spec:
  containers:
  - name: app
    volumeMounts:
    - name: data
      mountPath: /app/data
  volumes:
  - name: data
    persistentVolumeClaim:
      claimName: my-pvc
```

#### PV-PVC 바인딩 조건

PVC는 다음 조건을 만족하는 PV에 바인딩된다:
1. **Access Mode**가 일치해야 한다.
2. **Capacity**가 PVC의 요청량 이상이어야 한다.
3. **StorageClass**가 일치해야 한다 (지정된 경우).
4. **Label Selector**가 일치해야 한다 (지정된 경우).

---

### 4.3 Access Modes

| 모드 | 약어 | 설명 |
|---|---|---|
| **ReadWriteOnce** | RWO | 하나의 노드에서 읽기/쓰기 마운트할 수 있다. |
| **ReadOnlyMany** | ROX | 여러 노드에서 읽기 전용으로 마운트할 수 있다. |
| **ReadWriteMany** | RWX | 여러 노드에서 읽기/쓰기 마운트할 수 있다. NFS 등이 지원한다. |
| **ReadWriteOncePod** | RWOP | 하나의 Pod에서만 읽기/쓰기 마운트할 수 있다 (1.22+). |

모든 스토리지 백엔드가 모든 Access Mode를 지원하는 것은 아니다. hostPath는 실제로 RWO만 지원한다.

---

### 4.4 StorageClass와 Dynamic Provisioning

StorageClass는 동적으로 PV를 프로비저닝하는 방법을 정의한다. PVC를 생성하면 자동으로 PV가 생성된다.

#### StorageClass 정의

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: fast-storage
  annotations:
    storageclass.kubernetes.io/is-default-class: "true"  # 기본 StorageClass
provisioner: kubernetes.io/aws-ebs     # 프로비저너
parameters:
  type: gp3
reclaimPolicy: Delete
allowVolumeExpansion: true
volumeBindingMode: WaitForFirstConsumer
```

- `provisioner`: 스토리지를 프로비저닝하는 프로바이더이다.
- `reclaimPolicy`: PVC 삭제 시 PV 처리 방법이다 (`Delete` 또는 `Retain`).
- `volumeBindingMode`:
  - `Immediate`: PVC 생성 즉시 PV를 프로비저닝한다.
  - `WaitForFirstConsumer`: Pod가 생성되어 해당 PVC를 사용할 때 PV를 프로비저닝한다. 노드의 zone을 고려할 수 있다.
- `allowVolumeExpansion`: 볼륨 확장 허용 여부이다.

---

### 4.5 PV 라이프사이클

```
Available → Bound → Released → (삭제 또는 재사용)
```

| 상태 | 설명 |
|---|---|
| **Available** | PV가 생성되어 PVC 바인딩을 기다리는 상태이다. |
| **Bound** | PVC에 바인딩된 상태이다. |
| **Released** | PVC가 삭제되었지만 PV는 아직 리소스를 회수하지 않은 상태이다. |
| **Failed** | 자동 회수에 실패한 상태이다. |

#### Reclaim Policy

| 정책 | 설명 |
|---|---|
| **Retain** | PVC 삭제 후에도 PV와 데이터를 보존한다. 관리자가 수동으로 처리해야 한다. Released 상태가 된다. |
| **Delete** | PVC 삭제 시 PV와 백엔드 스토리지도 함께 삭제한다. Dynamic Provisioning의 기본값이다. |
| **Recycle** | 더 이상 사용하지 않는다 (deprecated). `rm -rf /thevolume/*`를 수행한다. |

Released 상태의 PV를 다시 Available로 만들려면 `spec.claimRef`를 삭제해야 한다.

---

## 5. Troubleshooting (30%)

CKA 시험에서 가장 높은 비중을 차지하는 도메인이다. 체계적인 트러블슈팅 접근 방식이 중요하다.

### 5.1 노드 트러블슈팅

#### 노드 상태 확인

```bash
kubectl get nodes
kubectl describe node <node-name>
```

노드가 `NotReady` 상태인 경우 확인 사항:
1. **kubelet 서비스 상태**: `systemctl status kubelet`
2. **kubelet 로그**: `journalctl -u kubelet -f`
3. **인증서 만료**: `openssl x509 -in /etc/kubernetes/pki/apiserver.crt -noout -dates`
4. **컨테이너 런타임**: `systemctl status containerd`
5. **네트워크**: CNI 플러그인 상태 확인
6. **디스크 공간**: `df -h`
7. **메모리**: `free -m`

#### kubelet 문제 해결

```bash
# kubelet 상태 확인
systemctl status kubelet

# kubelet 재시작
systemctl restart kubelet

# kubelet 자동 시작 활성화
systemctl enable kubelet

# kubelet 설정 파일 확인
cat /var/lib/kubelet/config.yaml

# kubelet 로그 확인 (실시간)
journalctl -u kubelet -f

# kubelet 로그 확인 (최근)
journalctl -u kubelet --no-pager -l
```

#### 인증서 관련 트러블슈팅

```bash
# 인증서 만료일 확인
kubeadm certs check-expiration

# 인증서 갱신
kubeadm certs renew all

# 특정 인증서 정보 확인
openssl x509 -in /etc/kubernetes/pki/apiserver.crt -noout -text
```

---

### 5.2 Pod 상태별 진단

#### Pending

Pod가 스케줄링되지 않은 상태이다.

원인:
- **리소스 부족**: 노드에 충분한 CPU/메모리가 없다. → 다른 Pod의 리소스를 줄이거나 노드를 추가한다.
- **nodeSelector/Affinity 불일치**: 조건에 맞는 노드가 없다. → 노드에 레이블을 추가하거나 조건을 수정한다.
- **Taint/Toleration 불일치**: 모든 노드에 Taint가 있고 Pod에 Toleration이 없다. → Toleration을 추가하거나 Taint를 제거한다.
- **PVC 바인딩 실패**: 요청한 PVC가 Bound 상태가 아니다. → PV를 생성하거나 StorageClass를 확인한다.

진단:
```bash
kubectl describe pod <pod-name>   # Events 섹션 확인
kubectl get events --sort-by='.lastTimestamp'
```

#### CrashLoopBackOff

컨테이너가 반복적으로 시작하고 종료되는 상태이다.

원인:
- 애플리케이션 오류 (잘못된 설정, 의존성 누락)
- 잘못된 명령어 (command/args)
- 프로브(liveness/readiness) 실패
- 리소스 제한(OOM)

진단:
```bash
kubectl logs <pod-name> --previous   # 이전 컨테이너의 로그 확인
kubectl describe pod <pod-name>      # Exit Code, 재시작 횟수 확인
```

#### ImagePullBackOff

컨테이너 이미지를 가져올 수 없는 상태이다.

원인:
- 이미지 이름/태그 오류
- 프라이빗 레지스트리 인증 실패 (imagePullSecrets 누락)
- 네트워크 문제로 레지스트리에 접근 불가

진단:
```bash
kubectl describe pod <pod-name>   # Events에서 pull 실패 원인 확인
```

#### Error

컨테이너가 오류와 함께 종료된 상태이다.

진단:
```bash
kubectl logs <pod-name>
kubectl describe pod <pod-name>   # Exit Code 확인
```

일반적인 Exit Code:
- `0`: 정상 종료
- `1`: 애플리케이션 오류
- `137`: SIGKILL (OOMKilled 또는 수동 종료)
- `139`: SIGSEGV (세그멘테이션 폴트)
- `143`: SIGTERM (정상적인 종료 요청)

#### OOMKilled

컨테이너가 메모리 제한을 초과하여 종료된 상태이다.

진단:
```bash
kubectl describe pod <pod-name>   # "OOMKilled" 확인
```

해결:
- `resources.limits.memory`를 늘린다.
- 애플리케이션의 메모리 사용량을 최적화한다.

---

### 5.3 네트워크 트러블슈팅

#### Service 연결 불가

확인 사항:
1. **Service의 selector와 Pod의 label이 일치하는지 확인**
   ```bash
   kubectl get svc <service-name> -o wide
   kubectl get pods --show-labels
   kubectl get endpoints <service-name>   # 엔드포인트가 비어있으면 selector 불일치
   ```

2. **Service의 port와 targetPort 확인**
   - `port`: Service가 수신하는 포트
   - `targetPort`: Pod 컨테이너가 수신하는 포트

3. **Pod가 정상적으로 실행 중인지 확인**
   ```bash
   kubectl get pods
   ```

4. **kube-proxy 상태 확인**
   ```bash
   kubectl -n kube-system get pods -l k8s-app=kube-proxy
   ```

#### DNS 해석 실패

확인 사항:
1. **CoreDNS Pod 상태 확인**
   ```bash
   kubectl -n kube-system get pods -l k8s-app=kube-dns
   ```

2. **CoreDNS 로그 확인**
   ```bash
   kubectl -n kube-system logs -l k8s-app=kube-dns
   ```

3. **DNS 테스트**
   ```bash
   kubectl run test-dns --image=busybox:1.28 --rm -it --restart=Never -- \
     nslookup kubernetes.default
   ```

4. **CoreDNS ConfigMap 확인**
   ```bash
   kubectl -n kube-system get configmap coredns -o yaml
   ```

---

### 5.4 로그 분석 도구

#### kubectl 기반

```bash
# Pod 로그 확인
kubectl logs <pod-name>

# 특정 컨테이너 로그 (멀티 컨테이너 Pod)
kubectl logs <pod-name> -c <container-name>

# 이전 컨테이너 로그
kubectl logs <pod-name> --previous

# 실시간 로그
kubectl logs <pod-name> -f

# 최근 N줄
kubectl logs <pod-name> --tail=100

# 최근 N시간
kubectl logs <pod-name> --since=1h

# Pod 상세 정보 (Events 포함)
kubectl describe pod <pod-name>

# 클러스터 이벤트
kubectl get events --sort-by='.lastTimestamp'
kubectl get events -A --sort-by='.lastTimestamp'
```

#### 시스템 기반

```bash
# kubelet 로그
journalctl -u kubelet -f
journalctl -u kubelet --since "10 minutes ago"

# containerd 로그
journalctl -u containerd

# 시스템 로그
journalctl --no-pager -l
```

#### crictl (컨테이너 런타임 디버깅)

```bash
# 컨테이너 목록
crictl ps
crictl ps -a   # 종료된 컨테이너 포함

# 컨테이너 로그
crictl logs <container-id>

# Pod 목록
crictl pods

# 이미지 목록
crictl images
```

---

### 5.5 클러스터 컴포넌트 장애

#### kube-apiserver 장애

증상: `kubectl` 명령이 응답하지 않는다.

확인:
```bash
# Static Pod로 실행되는 경우
crictl ps | grep apiserver
cat /etc/kubernetes/manifests/kube-apiserver.yaml

# 로그 확인
crictl logs <apiserver-container-id>
# 또는
kubectl -n kube-system logs kube-apiserver-<node-name>   # apiserver가 동작하는 경우에만
```

일반적 원인:
- 매니페스트 파일의 설정 오류 (잘못된 인증서 경로, 포트 등)
- 인증서 만료
- etcd 연결 실패

#### kube-scheduler 장애

증상: 새로운 Pod가 `Pending` 상태에 머문다.

확인:
```bash
crictl ps | grep scheduler
cat /etc/kubernetes/manifests/kube-scheduler.yaml
crictl logs <scheduler-container-id>
```

#### kube-controller-manager 장애

증상: Deployment를 생성해도 ReplicaSet/Pod가 생성되지 않는다. 노드 상태가 갱신되지 않는다.

확인:
```bash
crictl ps | grep controller-manager
cat /etc/kubernetes/manifests/kube-controller-manager.yaml
crictl logs <controller-manager-container-id>
```

#### etcd 장애

증상: 클러스터 상태 데이터에 접근할 수 없다. API 서버가 정상 동작하지 않는다.

확인:
```bash
crictl ps | grep etcd
cat /etc/kubernetes/manifests/etcd.yaml
crictl logs <etcd-container-id>

# etcd 멤버 상태 확인
ETCDCTL_API=3 etcdctl member list \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key
```

---

## 시험 팁

### 시간 관리

- 총 시험 시간: 2시간, 문제 수: 15-20문제
- 쉬운 문제부터 풀고, 어려운 문제는 나중에 돌아온다.
- 각 문제의 배점을 확인하고 우선순위를 정한다.

### 필수 숙지 명령어

```bash
# 시험에서 자주 사용하는 명령어
kubectl run <name> --image=<image> --dry-run=client -o yaml > pod.yaml
kubectl create deployment <name> --image=<image> --replicas=3 --dry-run=client -o yaml > deploy.yaml
kubectl expose deployment <name> --port=80 --target-port=8080 --type=NodePort --dry-run=client -o yaml
kubectl create service clusterip <name> --tcp=80:8080 --dry-run=client -o yaml

# 리소스 필드 확인
kubectl explain pod.spec.containers
kubectl explain deployment.spec.strategy --recursive

# 빠른 편집
kubectl edit deployment <name>
kubectl set image deployment/<name> <container>=<image>
kubectl scale deployment <name> --replicas=5
```

### 시험 환경

- 허용되는 참고 자료: kubernetes.io 공식 문서 (docs, blog, GitHub)
- 복사/붙여넣기 가능
- vim/nano 에디터 사용 가능
- `kubectl` 자동 완성이 설정되어 있다
- 여러 클러스터를 전환하며 문제를 푼다 → 반드시 `kubectl config use-context` 실행

### vim 기본 설정 (시험 시작 시)

```bash
echo 'set tabstop=2 shiftwidth=2 expandtab' >> ~/.vimrc
```

이 설정으로 YAML 편집 시 탭이 2칸 스페이스로 변환된다.
