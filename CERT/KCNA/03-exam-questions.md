# KCNA 모의 시험 문제

> 총 40문항 | 도메인별 비율: Kubernetes Fundamentals(18), Container Orchestration(9), Cloud Native Architecture(6), Observability(4), Application Delivery(3)

---

## Kubernetes Fundamentals (문제 1~18)

### 문제 1.
Kubernetes 클러스터에서 모든 클러스터 상태 데이터를 영구적으로 저장하는 컴포넌트는 무엇인가?

A) kube-apiserver
B) kube-scheduler
C) etcd
D) kube-controller-manager

<details>
<summary>정답 확인</summary>

**정답: C) etcd ✅**

etcd는 분산 키-값 저장소로, Kubernetes 클러스터의 모든 상태 정보(desired state, current state)를 저장하는 단일 진실 소스(Single Source of Truth)이다. Raft 합의 알고리즘을 사용하여 데이터 일관성을 보장하며, kube-apiserver만이 etcd와 직접 통신한다.
</details>

---

### 문제 2.
새로 생성된 Pod를 적절한 노드에 배치하는 역할을 담당하는 Control Plane 구성 요소는 무엇인가?

A) kubelet
B) kube-proxy
C) kube-controller-manager
D) kube-scheduler

<details>
<summary>정답 확인</summary>

**정답: D) kube-scheduler ✅**

kube-scheduler는 아직 노드에 할당되지 않은 새로운 Pod를 감지하고, 리소스 요구사항, 어피니티/안티-어피니티 규칙, 테인트/톨러레이션 등을 고려하여 최적의 노드를 선택한다. 필터링(Filtering)과 스코어링(Scoring) 2단계로 스케줄링을 수행한다.
</details>

---

### 문제 3.
Kubernetes에서 배포 가능한 가장 작은 단위는 무엇인가?

A) Container
B) Pod
C) ReplicaSet
D) Deployment

<details>
<summary>정답 확인</summary>

**정답: B) Pod ✅**

Pod는 Kubernetes에서 생성, 스케줄링, 관리할 수 있는 가장 작은 배포 단위이다. 하나 이상의 컨테이너를 포함하며, 같은 Pod 내 컨테이너는 네트워크 네임스페이스(IP, 포트)와 스토리지를 공유한다. Container 자체는 K8s의 오브젝트가 아니라 Pod 내에서 실행되는 런타임 단위이다.
</details>

---

### 문제 4.
다음 중 StatefulSet의 특성이 아닌 것은?

A) Pod 이름이 순서대로 고정된다 (예: web-0, web-1)
B) 각 Pod에 고유한 PersistentVolume이 연결된다
C) Pod의 생성과 삭제가 순서대로 이루어진다
D) 기본적으로 RollingUpdate 전략만 지원한다

<details>
<summary>정답 확인</summary>

**정답: D) 기본적으로 RollingUpdate 전략만 지원한다 ✅**

StatefulSet은 RollingUpdate와 OnDelete 두 가지 업데이트 전략을 지원한다. A, B, C는 모두 StatefulSet의 핵심 특성이다. 안정적이고 고유한 네트워크 식별자, 안정적이고 지속적인 스토리지, 순서 보장이 StatefulSet의 3가지 주요 보장 사항이다.
</details>

---

### 문제 5.
클러스터 외부에서 접근할 수 없고, 클러스터 내부 서비스 간 통신에만 사용되는 Service 유형은?

A) NodePort
B) LoadBalancer
C) ClusterIP
D) ExternalName

<details>
<summary>정답 확인</summary>

**정답: C) ClusterIP ✅**

ClusterIP는 Service의 기본 유형으로, 클러스터 내부에서만 접근 가능한 가상 IP를 할당한다. 외부에서는 직접 접근할 수 없으며, 내부 서비스 간 통신에 사용된다. NodePort와 LoadBalancer는 외부 접근을 허용하고, ExternalName은 외부 DNS로 매핑하는 특수 유형이다.
</details>

---

### 문제 6.
NodePort Service에서 사용 가능한 기본 포트 범위는?

A) 1-65535
B) 8080-9090
C) 30000-32767
D) 20000-25000

<details>
<summary>정답 확인</summary>

**정답: C) 30000-32767 ✅**

NodePort 서비스는 모든 노드의 특정 포트를 통해 외부에서 접근할 수 있게 하며, 기본 포트 범위는 30000-32767이다. nodePort 필드를 지정하지 않으면 이 범위 내에서 자동으로 할당된다. 이 범위는 kube-apiserver의 `--service-node-port-range` 플래그로 변경할 수 있다.
</details>

---

### 문제 7.
ConfigMap에 대한 설명으로 올바르지 않은 것은?

A) 비기밀 설정 데이터를 키-값 쌍으로 저장한다
B) 환경 변수 또는 볼륨으로 Pod에 주입할 수 있다
C) ConfigMap이 변경되면 환경 변수로 주입된 값도 자동으로 갱신된다
D) 최대 크기는 1MiB이다

<details>
<summary>정답 확인</summary>

**정답: C) ConfigMap이 변경되면 환경 변수로 주입된 값도 자동으로 갱신된다 ✅**

ConfigMap이 변경될 때, 볼륨으로 마운트된 경우에는 자동으로 업데이트되지만, 환경 변수로 주입된 경우에는 Pod를 재시작해야 변경 사항이 반영된다. 이는 환경 변수가 Pod 생성 시점에 결정되어 컨테이너 프로세스에 전달되기 때문이다.
</details>

---

### 문제 8.
PersistentVolume의 접근 모드 중 여러 노드에서 동시에 읽기/쓰기가 가능한 모드는?

A) ReadWriteOnce (RWO)
B) ReadOnlyMany (ROX)
C) ReadWriteMany (RWX)
D) ReadWriteOncePod (RWOP)

<details>
<summary>정답 확인</summary>

**정답: C) ReadWriteMany (RWX) ✅**

ReadWriteMany(RWX)는 여러 노드에서 동시에 읽기와 쓰기가 가능한 접근 모드이다. NFS, CephFS 등의 스토리지 타입이 이 모드를 지원한다. RWO는 하나의 노드, ROX는 여러 노드에서 읽기만, RWOP는 하나의 Pod에서만 읽기/쓰기가 가능하다.
</details>

---

### 문제 9.
Kubernetes에서 기본으로 생성되는 네임스페이스가 아닌 것은?

A) default
B) kube-system
C) kube-public
D) kube-apps

<details>
<summary>정답 확인</summary>

**정답: D) kube-apps ✅**

Kubernetes가 기본으로 생성하는 네임스페이스는 `default`, `kube-system`, `kube-public`, `kube-node-lease` 4가지이다. `kube-apps`라는 네임스페이스는 기본으로 존재하지 않는다. kube-system에는 시스템 컴포넌트가, kube-public에는 공개 데이터가, kube-node-lease에는 노드 하트비트 관련 Lease 오브젝트가 저장된다.
</details>

---

### 문제 10.
Deployment의 롤링 업데이트 전략에서 `maxSurge: 1`과 `maxUnavailable: 0`으로 설정한 경우, 어떤 동작을 하는가?

A) 기존 Pod를 모두 삭제한 후 새 Pod를 생성한다
B) 새 Pod를 하나 추가 생성한 후 이전 Pod를 하나 삭제하는 방식으로 진행한다
C) 이전 Pod를 하나 삭제한 후 새 Pod를 하나 생성하는 방식으로 진행한다
D) 모든 새 Pod를 동시에 생성한다

<details>
<summary>정답 확인</summary>

**정답: B) 새 Pod를 하나 추가 생성한 후 이전 Pod를 하나 삭제하는 방식으로 진행한다 ✅**

`maxSurge: 1`은 원하는 복제본 수보다 최대 1개까지 추가 Pod를 생성할 수 있다는 의미이다. `maxUnavailable: 0`은 업데이트 중에 사용 불가능한 Pod가 없어야 한다는 의미이다. 따라서 새 Pod를 먼저 1개 생성하고, 해당 Pod가 준비되면 이전 Pod를 1개 삭제하는 방식으로 무중단 배포를 진행한다.
</details>

---

### 문제 11.
다음 중 DaemonSet의 주요 사용 사례가 아닌 것은?

A) 각 노드에서 로그 수집 에이전트 실행
B) 각 노드에서 모니터링 에이전트 실행
C) 웹 애플리케이션의 복제본을 3개 실행
D) 각 노드에서 네트워크 플러그인 실행

<details>
<summary>정답 확인</summary>

**정답: C) 웹 애플리케이션의 복제본을 3개 실행 ✅**

DaemonSet은 모든(또는 특정) 노드에 Pod를 하나씩 실행하도록 보장하는 리소스이다. 로그 수집(fluentd), 모니터링(node-exporter), 네트워크 플러그인(calico) 등 각 노드에 반드시 하나씩 실행해야 하는 작업에 적합하다. 특정 수의 복제본을 실행하는 것은 Deployment의 역할이다.
</details>

---

### 문제 12.
`kubectl explain pod.spec.containers`와 동일한 결과를 얻을 수 있는 설명은?

A) Pod의 상태 정보를 조회한다
B) Pod의 spec.containers 필드에 대한 문서와 하위 필드를 확인한다
C) 실행 중인 모든 Pod의 컨테이너 목록을 조회한다
D) Pod 내 컨테이너의 로그를 조회한다

<details>
<summary>정답 확인</summary>

**정답: B) Pod의 spec.containers 필드에 대한 문서와 하위 필드를 확인한다 ✅**

`kubectl explain`은 API 리소스의 필드에 대한 문서를 조회하는 명령어이다. `kubectl explain pod.spec.containers`는 Pod의 spec.containers 필드가 어떤 타입인지, 어떤 하위 필드가 있는지, 각 필드의 설명을 보여준다. YAML을 작성할 때 필드 이름이나 용도를 확인하는 데 매우 유용하다.
</details>

---

### 문제 13.
Secret에 대한 설명으로 올바른 것은?

A) Secret의 데이터는 기본적으로 AES-256으로 암호화되어 etcd에 저장된다
B) Secret은 Base64로 인코딩되어 저장되며, 이것만으로는 암호화가 아니다
C) Secret은 ConfigMap과 달리 볼륨으로 마운트할 수 없다
D) Secret의 최대 크기는 10MiB이다

<details>
<summary>정답 확인</summary>

**정답: B) Secret은 Base64로 인코딩되어 저장되며, 이것만으로는 암호화가 아니다 ✅**

Kubernetes Secret은 기본적으로 Base64 인코딩만 적용되어 etcd에 저장된다. Base64는 인코딩이지 암호화가 아니므로, 진정한 보안을 위해서는 EncryptionConfiguration을 통한 etcd 암호화 설정이나 외부 비밀 관리 도구(Vault 등)를 사용해야 한다. Secret도 ConfigMap과 마찬가지로 환경 변수나 볼륨으로 마운트할 수 있으며, 최대 크기는 1MiB이다.
</details>

---

### 문제 14.
Kubernetes에서 Pod 간 네트워크 트래픽을 제어하는 리소스는?

A) Ingress
B) Service
C) NetworkPolicy
D) EndpointSlice

<details>
<summary>정답 확인</summary>

**정답: C) NetworkPolicy ✅**

NetworkPolicy는 Pod 간 또는 Pod와 외부 간의 네트워크 트래픽을 제어하는 리소스이다. 기본적으로 K8s의 모든 Pod는 서로 통신이 가능하지만, NetworkPolicy를 통해 인그레스(수신)와 이그레스(송신) 규칙을 정의하여 트래픽을 제한할 수 있다. 단, CNI 플러그인이 NetworkPolicy를 지원해야 동작한다 (Calico, Cilium 등).
</details>

---

### 문제 15.
kubelet에 대한 설명으로 올바르지 않은 것은?

A) 각 워커 노드에서 실행되는 에이전트이다
B) 컨테이너 런타임과 통신하여 컨테이너 생명주기를 관리한다
C) etcd에 직접 접근하여 Pod 정보를 읽어온다
D) 컨테이너의 Liveness/Readiness Probe를 실행한다

<details>
<summary>정답 확인</summary>

**정답: C) etcd에 직접 접근하여 Pod 정보를 읽어온다 ✅**

kubelet은 etcd에 직접 접근하지 않는다. etcd와 직접 통신하는 유일한 컴포넌트는 kube-apiserver이다. kubelet은 kube-apiserver로부터 PodSpec을 수신하고, 해당 명세에 따라 컨테이너가 정상적으로 실행되는지 확인한다. 또한 노드 상태를 주기적으로 API 서버에 보고한다.
</details>

---

### 문제 16.
RBAC에서 특정 네임스페이스 내의 권한을 정의하는 리소스는?

A) ClusterRole
B) Role
C) ClusterRoleBinding
D) ServiceAccount

<details>
<summary>정답 확인</summary>

**정답: B) Role ✅**

Role은 특정 네임스페이스 내에서의 권한(어떤 리소스에 어떤 동작을 허용할지)을 정의하는 리소스이다. ClusterRole은 클러스터 전체에 적용되는 권한을 정의한다. Role을 실제 사용자나 서비스 어카운트에 연결하려면 RoleBinding을 사용해야 한다.
</details>

---

### 문제 17.
Ingress에 대한 설명으로 올바르지 않은 것은?

A) 클러스터 외부에서 내부 서비스로의 HTTP/HTTPS 라우팅을 정의한다
B) Ingress 리소스만 생성하면 자동으로 동작한다
C) 하나의 IP로 여러 서비스에 대한 라우팅이 가능하다
D) TLS 종료를 처리할 수 있다

<details>
<summary>정답 확인</summary>

**정답: B) Ingress 리소스만 생성하면 자동으로 동작한다 ✅**

Ingress 리소스만으로는 동작하지 않으며, 반드시 Ingress Controller(NGINX Ingress Controller, Traefik 등)가 클러스터에 설치되어 있어야 한다. Ingress Controller가 Ingress 리소스를 감시하고 실제 라우팅 규칙을 구성한다.
</details>

---

### 문제 18.
다음 중 Job 리소스에서 `restartPolicy`로 허용되는 값은?

A) Always, Never
B) Never, OnFailure
C) Always, OnFailure
D) Always, Never, OnFailure

<details>
<summary>정답 확인</summary>

**정답: B) Never, OnFailure ✅**

Job에서는 `restartPolicy`로 `Never` 또는 `OnFailure`만 허용된다. `Always`는 Job에서 사용할 수 없다. `Never`로 설정하면 실패 시 새 Pod를 생성하고, `OnFailure`로 설정하면 같은 Pod 내에서 컨테이너를 재시작한다. 일반 Pod의 기본 restartPolicy는 `Always`이다.
</details>

---

## Container Orchestration (문제 19~27)

### 문제 19.
컨테이너 기술에서 프로세스 격리를 제공하는 Linux 커널 기능은?

A) cgroups
B) namespace
C) SELinux
D) iptables

<details>
<summary>정답 확인</summary>

**정답: B) namespace ✅**

Linux namespace는 프로세스, 네트워크, 파일시스템, 사용자 등의 격리를 제공하는 커널 기능이다. 주요 namespace로는 PID(프로세스), NET(네트워크), MNT(파일시스템), UTS(호스트명), IPC(프로세스 간 통신), USER(사용자) 등이 있다. cgroups는 리소스 사용량(CPU, 메모리 등)을 제한하고 모니터링하는 기능이다.
</details>

---

### 문제 20.
OCI(Open Container Initiative)가 정의하는 사양이 아닌 것은?

A) Runtime Specification
B) Image Specification
C) Distribution Specification
D) Orchestration Specification

<details>
<summary>정답 확인</summary>

**정답: D) Orchestration Specification ✅**

OCI는 Runtime Specification(컨테이너 실행 방법), Image Specification(이미지 형식과 구조), Distribution Specification(이미지 배포 방식)의 세 가지 사양을 정의한다. Orchestration Specification은 OCI가 정의하는 사양이 아니다. OCI 표준 덕분에 서로 다른 런타임 간에 이미지 호환성이 보장된다.
</details>

---

### 문제 21.
Kubernetes v1.24 이후 컨테이너 런타임에 대한 설명으로 올바른 것은?

A) Docker를 직접 컨테이너 런타임으로 사용할 수 있다
B) dockershim이 제거되어 Docker를 직접 런타임으로 사용할 수 없지만, Docker로 빌드한 이미지는 사용 가능하다
C) containerd와 CRI-O 모두 사용할 수 없다
D) Docker만 유일하게 지원되는 런타임이다

<details>
<summary>정답 확인</summary>

**정답: B) dockershim이 제거되어 Docker를 직접 런타임으로 사용할 수 없지만, Docker로 빌드한 이미지는 사용 가능하다 ✅**

Kubernetes v1.24부터 dockershim이 제거되어 Docker를 직접 컨테이너 런타임으로 사용할 수 없다. 대신 containerd나 CRI-O를 사용해야 한다. 단, Docker로 빌드한 컨테이너 이미지는 OCI 표준을 따르므로 어떤 CRI 호환 런타임에서든 정상적으로 실행할 수 있다.
</details>

---

### 문제 22.
CRI(Container Runtime Interface)에 대한 설명으로 올바른 것은?

A) 컨테이너 이미지를 빌드하기 위한 인터페이스이다
B) Kubernetes가 컨테이너 런타임과 통신하기 위한 표준 API이다
C) 컨테이너 네트워크를 구성하기 위한 인터페이스이다
D) 컨테이너 스토리지를 관리하기 위한 인터페이스이다

<details>
<summary>정답 확인</summary>

**정답: B) Kubernetes가 컨테이너 런타임과 통신하기 위한 표준 API이다 ✅**

CRI(Container Runtime Interface)는 kubelet이 컨테이너 런타임과 통신하기 위한 표준 인터페이스이다. gRPC 기반의 API를 사용하며, RuntimeService(Pod/컨테이너 생명주기 관리)와 ImageService(이미지 관리) 두 가지 서비스를 정의한다. CRI 덕분에 K8s는 특정 런타임에 종속되지 않는다.
</details>

---

### 문제 23.
containerd에 대한 설명으로 올바르지 않은 것은?

A) Docker에서 분리된 고수준 컨테이너 런타임이다
B) CNCF 졸업 프로젝트이다
C) 저수준 컨테이너 실행을 위해 내부적으로 runc를 사용한다
D) Kubernetes 전용으로 설계되어 Docker에서는 사용되지 않는다

<details>
<summary>정답 확인</summary>

**정답: D) Kubernetes 전용으로 설계되어 Docker에서는 사용되지 않는다 ✅**

containerd는 Docker에서 분리된 프로젝트이지만, Docker 엔진 자체도 내부적으로 containerd를 사용한다. 즉, Docker는 containerd를 기반으로 동작한다. containerd는 K8s 전용이 아니며, 독립적인 컨테이너 런타임으로서 다양한 환경에서 사용된다.
</details>

---

### 문제 24.
Dockerfile에서 컨테이너 시작 시 실행할 명령어를 지정하되, `docker run` 시 덮어쓸 수 없도록 고정하는 명령어는?

A) CMD
B) RUN
C) ENTRYPOINT
D) EXEC

<details>
<summary>정답 확인</summary>

**정답: C) ENTRYPOINT ✅**

ENTRYPOINT는 컨테이너 시작 시 실행할 명령어를 고정한다. `docker run` 시 인자를 전달하면 ENTRYPOINT의 인자로 추가된다. CMD는 기본 명령어를 지정하지만 `docker run` 시 다른 명령어로 쉽게 덮어쓸 수 있다. RUN은 이미지 빌드 시에만 실행된다.
</details>

---

### 문제 25.
컨테이너 오케스트레이션이 제공하는 기능이 아닌 것은?

A) 자동 복구 (Self-healing)
B) 서비스 디스커버리
C) 소스 코드 컴파일
D) 로드밸런싱

<details>
<summary>정답 확인</summary>

**정답: C) 소스 코드 컴파일 ✅**

컨테이너 오케스트레이션은 자동 복구, 서비스 디스커버리, 로드밸런싱, 스케줄링, 자동 스케일링, 롤링 업데이트, 설정 관리 등의 기능을 제공한다. 소스 코드 컴파일은 CI/CD 도구의 역할이며, 오케스트레이션의 영역이 아니다.
</details>

---

### 문제 26.
컨테이너와 가상 머신(VM)을 비교한 설명으로 올바른 것은?

A) 컨테이너는 VM보다 보안 격리가 더 강하다
B) 컨테이너는 호스트 OS의 커널을 공유하므로 VM보다 가볍고 빠르다
C) VM은 컨테이너보다 시작 시간이 빠르다
D) 컨테이너는 각각 독립된 게스트 OS를 포함한다

<details>
<summary>정답 확인</summary>

**정답: B) 컨테이너는 호스트 OS의 커널을 공유하므로 VM보다 가볍고 빠르다 ✅**

컨테이너는 호스트 OS의 커널을 공유하므로 수 MB 크기이고 초 단위로 시작된다. VM은 각각 게스트 OS를 포함하므로 수 GB 크기이고 분 단위로 시작된다. 보안 격리 측면에서는 하드웨어 수준 격리를 제공하는 VM이 컨테이너보다 더 강하다.
</details>

---

### 문제 27.
CNCF 졸업 프로젝트인 오픈소스 프라이빗 컨테이너 레지스트리는?

A) Docker Hub
B) Quay
C) Harbor
D) Nexus

<details>
<summary>정답 확인</summary>

**정답: C) Harbor ✅**

Harbor는 CNCF 졸업 프로젝트인 오픈소스 프라이빗 컨테이너 레지스트리이다. 취약점 스캐닝, 이미지 서명, 접근 제어, 복제 등의 기능을 제공한다. Docker Hub는 공용 레지스트리이며, Quay는 Red Hat이 운영하는 레지스트리이고, Nexus는 Sonatype의 범용 아티팩트 저장소이다.
</details>

---

## Cloud Native Architecture (문제 28~33)

### 문제 28.
CNCF 프로젝트의 성숙도 단계를 올바른 순서대로 나열한 것은?

A) Incubating -> Sandbox -> Graduated
B) Sandbox -> Graduated -> Incubating
C) Sandbox -> Incubating -> Graduated
D) Graduated -> Incubating -> Sandbox

<details>
<summary>정답 확인</summary>

**정답: C) Sandbox -> Incubating -> Graduated ✅**

CNCF 프로젝트의 성숙도는 Sandbox(초기 실험 단계) -> Incubating(성장 단계, 프로덕션 사용 사례 존재) -> Graduated(성숙 단계, 광범위 채택 및 프로덕션 검증)의 순서로 발전한다. Graduated 프로젝트는 보안 감사를 완료해야 하며, Kubernetes, Prometheus, Helm, etcd 등이 대표적이다.
</details>

---

### 문제 29.
마이크로서비스 아키텍처의 단점이 아닌 것은?

A) 분산 시스템의 복잡성이 증가한다
B) 서비스별로 독립적인 스케일링이 가능하다
C) 네트워크 통신으로 인한 지연이 발생한다
D) 분산 트랜잭션 관리가 어렵다

<details>
<summary>정답 확인</summary>

**정답: B) 서비스별로 독립적인 스케일링이 가능하다 ✅**

서비스별 독립적인 스케일링은 마이크로서비스의 장점이다. 마이크로서비스의 단점으로는 분산 시스템의 복잡성 증가, 네트워크 통신에 의한 지연(latency), 분산 트랜잭션 관리의 어려움, 서비스 간 의존성 관리, 운영 및 모니터링의 복잡화 등이 있다.
</details>

---

### 문제 30.
서비스 메시의 Data Plane에서 각 서비스 옆에 배치되어 트래픽을 처리하는 구성 요소는?

A) Control Plane Controller
B) Sidecar Proxy
C) API Gateway
D) Load Balancer

<details>
<summary>정답 확인</summary>

**정답: B) Sidecar Proxy ✅**

서비스 메시의 Data Plane은 각 서비스 옆에 배치된 사이드카 프록시가 실제 트래픽을 처리하는 계층이다. Istio의 경우 Envoy를 사이드카 프록시로 사용한다. Control Plane은 이 프록시들의 설정과 정책을 관리하는 역할을 한다.
</details>

---

### 문제 31.
HPA(Horizontal Pod Autoscaler)가 동작하기 위해 반드시 필요한 것은? (2가지)

A) Ingress Controller와 NetworkPolicy
B) metrics-server와 Pod의 resources.requests 설정
C) VPA와 Cluster Autoscaler
D) Prometheus와 Grafana

<details>
<summary>정답 확인</summary>

**정답: B) metrics-server와 Pod의 resources.requests 설정 ✅**

HPA가 동작하려면 두 가지가 필수이다. 첫째, metrics-server가 설치되어 Pod의 CPU/메모리 사용량 메트릭을 수집해야 한다. 둘째, Pod의 컨테이너에 resources.requests가 설정되어 있어야 HPA가 현재 사용률을 목표 사용률과 비교하여 스케일링 결정을 할 수 있다.
</details>

---

### 문제 32.
Kubernetes에서 Scale-to-Zero가 가능한 서버리스 플랫폼은?

A) Istio
B) Knative
C) Linkerd
D) Envoy

<details>
<summary>정답 확인</summary>

**정답: B) Knative ✅**

Knative는 Google이 주도하는 Kubernetes 기반 서버리스 플랫폼이다. Serving(서빙)과 Eventing(이벤팅) 컴포넌트로 구성되며, 요청이 없을 때 Pod를 0개로 줄이는 Scale-to-Zero 기능을 지원한다. Istio와 Linkerd는 서비스 메시이고, Envoy는 프록시이다.
</details>

---

### 문제 33.
Cluster Autoscaler에 대한 설명으로 올바른 것은?

A) Pod의 CPU/메모리 요청값을 자동으로 조정한다
B) Pod의 수를 자동으로 늘리거나 줄인다
C) 리소스 부족으로 Pending 상태인 Pod가 있으면 노드를 추가하고, 사용률이 낮은 노드를 제거한다
D) 서비스 메시의 사이드카 프록시 수를 자동으로 조정한다

<details>
<summary>정답 확인</summary>

**정답: C) 리소스 부족으로 Pending 상태인 Pod가 있으면 노드를 추가하고, 사용률이 낮은 노드를 제거한다 ✅**

Cluster Autoscaler는 클러스터의 노드 수를 자동으로 조정한다. 스케줄링할 수 없는 Pending Pod가 있으면 새 노드를 추가하고, 노드의 리소스 사용률이 낮으면 해당 노드의 Pod를 다른 노드로 이동시킨 후 노드를 제거한다. A는 VPA, B는 HPA의 설명이다.
</details>

---

## Cloud Native Observability (문제 34~37)

### 문제 34.
관측성(Observability)의 세 기둥(Three Pillars)을 올바르게 나열한 것은?

A) 메트릭, 로그, 트레이스
B) 모니터링, 경고, 대시보드
C) CPU, 메모리, 디스크
D) Prometheus, Grafana, Jaeger

<details>
<summary>정답 확인</summary>

**정답: A) 메트릭, 로그, 트레이스 ✅**

관측성의 세 기둥은 메트릭(Metrics), 로그(Logs), 트레이스(Traces/Distributed Tracing)이다. 메트릭은 시간에 따른 수치 데이터, 로그는 개별 이벤트의 시간순 기록, 트레이스는 분산 시스템에서 요청이 여러 서비스를 거치는 경로를 추적한 것이다. Prometheus, Grafana, Jaeger는 이를 구현하는 도구이다.
</details>

---

### 문제 35.
Prometheus의 메트릭 수집 방식에 대한 설명으로 올바른 것은?

A) 에이전트가 메트릭을 Prometheus 서버로 Push한다
B) Prometheus가 타겟의 /metrics 엔드포인트를 주기적으로 Pull(스크래핑)한다
C) 메시지 큐를 통해 메트릭을 전달한다
D) etcd에 저장된 메트릭을 조회한다

<details>
<summary>정답 확인</summary>

**정답: B) Prometheus가 타겟의 /metrics 엔드포인트를 주기적으로 Pull(스크래핑)한다 ✅**

Prometheus는 Pull 기반 메트릭 수집 모델을 사용한다. 모니터링 대상의 `/metrics` HTTP 엔드포인트를 주기적으로 스크래핑하여 메트릭을 수집한다. Pushgateway를 통한 Push 방식도 지원하지만 이는 단기 실행 작업(batch job) 등 특수한 경우에 사용된다. Pull 방식이 기본이자 권장 방식이다.
</details>

---

### 문제 36.
OpenTelemetry에 대한 설명으로 올바르지 않은 것은?

A) OpenTracing과 OpenCensus가 합병하여 탄생하였다
B) 메트릭, 로그, 트레이스를 위한 통합 프레임워크이다
C) 특정 벤더에 종속된 모니터링 솔루션이다
D) CNCF 인큐베이팅 프로젝트이다

<details>
<summary>정답 확인</summary>

**정답: C) 특정 벤더에 종속된 모니터링 솔루션이다 ✅**

OpenTelemetry(OTel)는 벤더 중립적(vendor-neutral)인 관측성 프레임워크이다. 특정 벤더에 종속되지 않으며, 수집한 텔레메트리 데이터를 Jaeger, Prometheus, Datadog, New Relic 등 다양한 백엔드로 전송할 수 있다. OpenTracing과 OpenCensus의 합병으로 탄생하였으며, CNCF 인큐베이팅 프로젝트이다.
</details>

---

### 문제 37.
Fluentd에 대한 설명으로 올바른 것은?

A) CNCF 샌드박스 프로젝트이며, 메트릭 수집에 특화되어 있다
B) CNCF 졸업 프로젝트이며, 통합 로깅 계층(Unified Logging Layer)을 제공하는 데이터 수집기이다
C) Grafana Labs에서 개발한 로그 인덱싱 시스템이다
D) 분산 트레이싱 전용 도구이다

<details>
<summary>정답 확인</summary>

**정답: B) CNCF 졸업 프로젝트이며, 통합 로깅 계층(Unified Logging Layer)을 제공하는 데이터 수집기이다 ✅**

Fluentd는 CNCF 졸업 프로젝트인 오픈소스 데이터 수집기(로그 수집기)이다. 다양한 소스에서 로그를 수집하고, 필터링/변환하여 다양한 목적지로 전송하는 통합 로깅 계층을 제공한다. 500개 이상의 플러그인을 지원하며, K8s 환경에서는 DaemonSet으로 배포하는 것이 일반적이다.
</details>

---

## Cloud Native Application Delivery (문제 38~40)

### 문제 38.
GitOps의 핵심 원칙이 아닌 것은?

A) 모든 시스템 상태를 선언적으로 기술한다
B) Git을 단일 진실 소스(Single Source of Truth)로 사용한다
C) 변경 사항은 수동으로 서버에 SSH 접속하여 적용한다
D) 에이전트가 실제 상태를 감시하고 원하는 상태와의 차이를 자동으로 수정한다

<details>
<summary>정답 확인</summary>

**정답: C) 변경 사항은 수동으로 서버에 SSH 접속하여 적용한다 ✅**

GitOps에서 변경 사항은 Git에 커밋되고, 에이전트가 이를 감지하여 자동으로 시스템에 적용한다. 서버에 직접 SSH 접속하여 수동으로 변경하는 것은 GitOps 원칙에 위배된다. GitOps의 핵심은 선언적 설정, Git을 단일 진실 소스로 사용, 승인된 변경의 자동 적용, 지속적 조정(Reconciliation)이다.
</details>

---

### 문제 39.
Helm에 대한 설명으로 올바르지 않은 것은?

A) Kubernetes의 패키지 매니저이다
B) Chart는 여러 K8s 매니페스트를 하나의 패키지로 묶은 것이다
C) Helm v3에서는 클러스터 내에 Tiller를 반드시 설치해야 한다
D) helm install, helm upgrade, helm rollback 명령어를 지원한다

<details>
<summary>정답 확인</summary>

**정답: C) Helm v3에서는 클러스터 내에 Tiller를 반드시 설치해야 한다 ✅**

Helm v3에서는 Tiller가 제거되었다. Helm v2에서는 클러스터 내에 Tiller 서버 컴포넌트가 필요했으나, 보안 문제 등의 이유로 v3에서 완전히 제거되었다. Helm v3는 클라이언트만으로 동작하며, kubeconfig를 사용하여 직접 K8s API 서버와 통신한다.
</details>

---

### 문제 40.
ArgoCD와 Flux의 공통점으로 올바른 것은?

A) 둘 다 CI(Continuous Integration) 도구이다
B) 둘 다 GitOps 원칙에 따라 Git 저장소의 변경 사항을 K8s 클러스터에 자동 동기화하는 CD 도구이다
C) 둘 다 컨테이너 이미지를 빌드하는 도구이다
D) 둘 다 서비스 메시 도구이다

<details>
<summary>정답 확인</summary>

**정답: B) 둘 다 GitOps 원칙에 따라 Git 저장소의 변경 사항을 K8s 클러스터에 자동 동기화하는 CD 도구이다 ✅**

ArgoCD와 Flux는 모두 CNCF 졸업 프로젝트이며, GitOps 원칙을 따르는 Kubernetes용 지속적 배포(Continuous Deployment) 도구이다. 둘 다 Git 저장소를 단일 진실 소스로 사용하여 K8s 클러스터의 상태를 자동으로 동기화한다. ArgoCD는 풍부한 웹 UI를 제공하고, Flux는 여러 컨트롤러로 구성된 모듈형 아키텍처를 특징으로 한다.
</details>

---

## 채점 기준

| 도메인 | 문항 수 | 문항 번호 | 비율 |
|--------|---------|----------|------|
| Kubernetes Fundamentals | 18 | 1~18 | 45% |
| Container Orchestration | 9 | 19~27 | 22.5% |
| Cloud Native Architecture | 6 | 28~33 | 15% |
| Cloud Native Observability | 4 | 34~37 | 10% |
| Cloud Native Application Delivery | 3 | 38~40 | 7.5% |
| **합계** | **40** | | **100%** |

> 실제 KCNA 시험은 60문항에 90분이 주어지며, 75% 이상 득점 시 합격이다.
