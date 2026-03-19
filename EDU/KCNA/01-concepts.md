# KCNA 핵심 개념 정리

> KCNA(Kubernetes and Cloud Native Associate) 시험의 모든 도메인을 체계적으로 정리한 문서이다.

---

## 1. Kubernetes Fundamentals (46%)

Kubernetes(이하 K8s)는 컨테이너화된 애플리케이션의 배포, 확장, 관리를 자동화하는 오픈소스 오케스트레이션 플랫폼이다. Google이 내부적으로 사용하던 Borg 시스템의 경험을 바탕으로 설계되었으며, 현재 CNCF(Cloud Native Computing Foundation)에서 관리하고 있다.

### 1.1 Kubernetes 아키텍처

K8s 클러스터는 크게 **Control Plane(컨트롤 플레인)**과 **Worker Node(워커 노드)**로 구성된다.

#### 1.1.1 Control Plane 구성 요소

Control Plane은 클러스터 전체의 의사결정을 담당하며, 일반적으로 고가용성을 위해 여러 노드에 걸쳐 실행된다.

**kube-apiserver**
- K8s 클러스터의 프론트엔드 역할을 하는 핵심 구성 요소이다.
- 모든 내부/외부 통신은 API 서버를 통해 이루어진다.
- RESTful API를 노출하며, kubectl 명령어도 이 API를 호출하는 것이다.
- 인증(Authentication), 인가(Authorization), 어드미션 컨트롤(Admission Control)을 수행한다.
- 수평 확장(horizontal scaling)이 가능하므로, 여러 인스턴스를 동시에 실행하여 부하를 분산할 수 있다.
- etcd와 직접 통신하는 유일한 컴포넌트이다. 다른 모든 컴포넌트는 API 서버를 경유하여 etcd에 접근한다.

**etcd**
- 분산 키-값(Key-Value) 저장소이다.
- 클러스터의 모든 상태 정보(desired state, current state)를 저장한다.
- Raft 합의 알고리즘을 사용하여 데이터 일관성을 보장한다.
- 클러스터 데이터의 단일 진실 소스(Single Source of Truth)이다.
- 고가용성 환경에서는 일반적으로 3개 또는 5개(홀수)의 etcd 노드를 운영한다.
- etcd의 데이터 백업은 클러스터 복구에 매우 중요하므로 정기적으로 스냅샷을 생성해야 한다.

**kube-scheduler**
- 새로 생성된 Pod를 적절한 워커 노드에 배치(스케줄링)하는 역할을 한다.
- Pod가 아직 노드에 할당되지 않은 상태(Pending)일 때 동작한다.
- 스케줄링 결정 시 고려하는 요소는 다음과 같다:
  - 리소스 요구사항(CPU, 메모리)과 노드의 가용 리소스
  - 하드웨어/소프트웨어/정책 제약 조건
  - 어피니티(Affinity)와 안티-어피니티(Anti-Affinity) 규칙
  - 테인트(Taint)와 톨러레이션(Toleration)
  - 데이터 지역성(Data Locality)
- 스케줄링은 **필터링(Filtering)** 단계에서 조건에 맞지 않는 노드를 제외하고, **스코어링(Scoring)** 단계에서 남은 노드에 점수를 매겨 최적의 노드를 선택하는 2단계로 진행된다.

**kube-controller-manager**
- 클러스터의 상태를 지속적으로 감시하고, 현재 상태(current state)를 원하는 상태(desired state)로 맞추는 컨트롤 루프를 실행한다.
- 논리적으로는 개별 프로세스이지만, 복잡성을 줄이기 위해 하나의 바이너리로 컴파일되어 단일 프로세스로 실행된다.
- 주요 컨트롤러는 다음과 같다:
  - **Node Controller**: 노드의 상태를 모니터링하고, 노드가 다운되면 알림을 생성한다.
  - **Replication Controller**: 각 ReplicationController 오브젝트에 대해 올바른 수의 Pod가 유지되도록 보장한다.
  - **Endpoints Controller**: 서비스와 Pod를 연결하는 Endpoints 오브젝트를 관리한다.
  - **Service Account & Token Controller**: 새 네임스페이스에 대한 기본 계정과 API 접근 토큰을 생성한다.
  - **Job Controller**: Job 오브젝트를 감시하고 해당 작업을 수행할 Pod를 생성한다.
  - **Deployment Controller**: Deployment의 상태를 관리하고 ReplicaSet을 생성/갱신한다.

**cloud-controller-manager**
- 클라우드 제공업체(AWS, GCP, Azure 등)에 특화된 제어 로직을 실행한다.
- K8s 핵심 코드와 클라우드 제공업체의 코드를 분리하여 독립적으로 발전할 수 있게 한다.
- 온프레미스 환경에서는 이 컴포넌트가 없을 수 있다.
- 주요 컨트롤러는 다음과 같다:
  - **Node Controller**: 클라우드에서 노드가 삭제된 후 응답이 없으면 해당 노드를 제거한다.
  - **Route Controller**: 클라우드 인프라에서 네트워크 경로를 설정한다.
  - **Service Controller**: 클라우드 로드밸런서를 생성, 갱신, 삭제한다.

#### 1.1.2 Worker Node 구성 요소

Worker Node는 실제 애플리케이션 워크로드(Pod)가 실행되는 곳이다.

**kubelet**
- 각 워커 노드에서 실행되는 에이전트이다.
- API 서버로부터 PodSpec을 수신하고, 해당 명세에 따라 컨테이너가 정상적으로 실행 중인지 확인한다.
- 컨테이너 런타임(containerd 등)과 통신하여 컨테이너의 생명주기를 관리한다.
- 노드의 상태를 주기적으로 API 서버에 보고한다.
- K8s가 생성하지 않은 컨테이너는 관리하지 않는다.
- 컨테이너의 Liveness Probe, Readiness Probe, Startup Probe를 실행하여 상태를 확인한다.

**kube-proxy**
- 각 워커 노드에서 실행되는 네트워크 프록시이다.
- K8s 서비스(Service) 개념의 구현체이다.
- 노드의 네트워크 규칙(iptables 또는 IPVS)을 관리하여, 클러스터 내부 또는 외부에서 Pod로의 네트워크 통신을 가능하게 한다.
- 서비스의 ClusterIP로 들어오는 트래픽을 적절한 Pod로 로드밸런싱한다.
- 운영 모드에는 iptables 모드(기본값), IPVS 모드, userspace 모드가 있다.

**Container Runtime**
- 실제로 컨테이너를 실행하는 소프트웨어이다.
- K8s는 CRI(Container Runtime Interface)를 통해 컨테이너 런타임과 통신한다.
- 지원되는 런타임은 다음과 같다:
  - **containerd**: Docker에서 분리된 고성능 런타임으로, 현재 가장 널리 사용된다.
  - **CRI-O**: Red Hat이 주도하는 경량 런타임으로, K8s 전용으로 설계되었다.
- K8s v1.24부터 dockershim이 제거되었으므로, Docker를 직접 컨테이너 런타임으로 사용할 수 없다. 단, Docker로 빌드한 이미지는 OCI 표준을 따르므로 어떤 런타임에서든 실행 가능하다.

### 1.2 핵심 오브젝트(Workload Resources)

#### Pod
- K8s에서 배포 가능한 가장 작은 단위이다.
- 하나 이상의 컨테이너를 포함하며, 같은 Pod 내 컨테이너는 네트워크 네임스페이스(IP, 포트)와 스토리지를 공유한다.
- 일반적으로 Pod를 직접 생성하지 않고, Deployment 등의 상위 리소스를 통해 관리한다.
- Pod 내 컨테이너는 localhost로 서로 통신 가능하다.
- Pod의 생명주기 상태(Phase)는 Pending, Running, Succeeded, Failed, Unknown이 있다.
- 멀티컨테이너 Pod 패턴은 다음과 같다:
  - **Sidecar**: 메인 컨테이너를 보조하는 기능을 제공한다 (로그 수집기, 프록시 등).
  - **Ambassador**: 메인 컨테이너의 네트워크 연결을 대리(proxy)한다.
  - **Adapter**: 메인 컨테이너의 출력을 표준화한다.
- **Init Container**: 앱 컨테이너가 시작되기 전에 실행되며 순차적으로 완료되어야 한다. 초기화 작업(DB 스키마 설정, 설정 파일 다운로드 등)에 사용된다.

#### ReplicaSet
- 지정된 수의 Pod 복제본(replica)이 항상 실행되도록 보장하는 리소스이다.
- 셀렉터(selector)를 사용하여 관리할 Pod를 식별한다.
- 직접 사용하기보다 Deployment를 통해 간접적으로 사용하는 것이 권장된다.
- ReplicationController의 후속 버전이며, 집합 기반(set-based) 셀렉터를 지원한다.

#### Deployment
- 상태 비저장(Stateless) 애플리케이션을 배포하고 관리하는 데 가장 많이 사용되는 리소스이다.
- 내부적으로 ReplicaSet을 생성하고 관리한다.
- 롤링 업데이트(Rolling Update)와 롤백(Rollback) 기능을 제공한다.
- 배포 전략은 다음과 같다:
  - **RollingUpdate(기본값)**: 점진적으로 새 버전의 Pod를 생성하고 이전 버전을 제거한다. `maxSurge`(최대 초과 Pod 수)와 `maxUnavailable`(최대 사용 불가 Pod 수)을 설정할 수 있다.
  - **Recreate**: 기존 Pod를 모두 제거한 후 새 Pod를 생성한다. 일시적인 다운타임이 발생하지만, 동시에 두 버전이 존재하지 않는다.
- `kubectl rollout` 명령어를 통해 롤아웃 상태 확인, 일시중지, 재개, 이력 조회, 롤백이 가능하다.

#### DaemonSet
- 모든(또는 특정) 노드에 Pod 하나씩을 실행하도록 보장하는 리소스이다.
- 노드가 클러스터에 추가되면 자동으로 해당 노드에 Pod를 배치하고, 노드가 제거되면 해당 Pod도 삭제된다.
- 주요 사용 사례는 다음과 같다:
  - 클러스터 스토리지 데몬 (예: glusterd, ceph)
  - 로그 수집 데몬 (예: fluentd, filebeat)
  - 노드 모니터링 데몬 (예: Prometheus Node Exporter)
  - 네트워크 플러그인 (예: calico-node, kube-proxy)
- tolerations를 설정하면 마스터 노드에도 Pod를 배치할 수 있다.

#### StatefulSet
- 상태 유지(Stateful) 애플리케이션을 관리하는 리소스이다.
- Deployment와 달리 다음의 특성을 보장한다:
  - **안정적이고 고유한 네트워크 식별자**: Pod 이름이 순서에 따라 고정된다 (예: web-0, web-1, web-2).
  - **안정적이고 지속적인 스토리지**: 각 Pod에 고유한 PersistentVolume이 연결된다.
  - **순서 보장**: Pod의 생성, 삭제, 스케일링이 순서대로 이루어진다 (0번부터 순차적으로 생성, 역순으로 삭제).
- Headless Service(ClusterIP가 None인 서비스)와 함께 사용해야 한다.
- 주요 사용 사례: 데이터베이스(MySQL, PostgreSQL), 분산 시스템(Kafka, ZooKeeper, Elasticsearch)

#### Job
- 하나 이상의 Pod를 생성하여 지정된 수의 Pod가 성공적으로 종료될 때까지 실행하는 리소스이다.
- Pod가 실패하면 새로운 Pod를 생성하여 재시도한다.
- `completions` 필드로 성공적으로 완료해야 하는 Pod 수를 지정한다.
- `parallelism` 필드로 동시에 실행할 수 있는 Pod 수를 지정한다.
- `backoffLimit` 필드로 최대 재시도 횟수를 지정한다.
- `activeDeadlineSeconds`로 Job의 최대 실행 시간을 제한할 수 있다.
- 주요 사용 사례: 배치 처리, 데이터 마이그레이션, 일회성 작업

#### CronJob
- Job을 Cron 스케줄에 따라 주기적으로 생성하는 리소스이다.
- Cron 표현식 형식: `분 시 일 월 요일` (예: `*/5 * * * *`는 5분마다).
- `concurrencyPolicy` 설정은 다음과 같다:
  - **Allow(기본값)**: 동시 실행을 허용한다.
  - **Forbid**: 이전 Job이 아직 실행 중이면 새 Job을 건너뛴다.
  - **Replace**: 이전 Job을 취소하고 새 Job으로 대체한다.
- `successfulJobsHistoryLimit`와 `failedJobsHistoryLimit`로 보관할 Job 이력 수를 지정한다.
- 주요 사용 사례: 정기 백업, 리포트 생성, 이메일 발송

### 1.3 Service (서비스)

Service는 Pod 집합에 대한 안정적인 네트워크 엔드포인트를 제공하는 추상화 계층이다. Pod는 생성과 삭제가 빈번하여 IP가 자주 변경되지만, Service는 고정된 IP와 DNS 이름을 제공한다.

#### ClusterIP (기본 유형)
- 클러스터 내부에서만 접근 가능한 가상 IP를 할당한다.
- 외부에서는 접근할 수 없으며, 내부 서비스 간 통신에 사용된다.
- DNS 형식: `<서비스명>.<네임스페이스>.svc.cluster.local`
- 예를 들어 `my-service.default.svc.cluster.local`로 접근 가능하다.
- 같은 네임스페이스 내에서는 서비스명만으로도 접근 가능하다.

#### NodePort
- ClusterIP의 기능에 추가로, 모든 노드의 특정 포트(기본 30000-32767)를 통해 외부에서 접근 가능하게 한다.
- `<노드IP>:<NodePort>`로 접근할 수 있다.
- 내부적으로 ClusterIP 서비스를 자동으로 생성한다.
- 프로덕션 환경보다는 개발/테스트 환경에서 주로 사용된다.

#### LoadBalancer
- NodePort의 기능에 추가로, 클라우드 제공업체의 외부 로드밸런서를 자동으로 프로비저닝한다.
- 외부 트래픽을 서비스로 라우팅하는 가장 일반적인 방법이다.
- 내부적으로 NodePort와 ClusterIP를 자동으로 생성한다.
- 각 서비스마다 로드밸런서가 하나씩 생성되므로 비용이 발생할 수 있다.
- `externalTrafficPolicy`를 `Local`로 설정하면 클라이언트의 소스 IP를 보존할 수 있다.

#### ExternalName
- 서비스를 외부 DNS 이름에 매핑하는 특수한 서비스 유형이다.
- ClusterIP를 할당하지 않으며, CNAME 레코드를 반환한다.
- 클러스터 외부의 서비스(예: 외부 데이터베이스)를 클러스터 내부 서비스처럼 사용할 수 있게 해준다.
- 프록시나 포워딩 없이 DNS 수준에서 동작한다.
- 예시: 외부 DB를 `my-database.default.svc.cluster.local`이라는 내부 이름으로 접근 가능하게 할 수 있다.

#### Headless Service
- `spec.clusterIP: None`으로 설정하는 특수한 형태이다.
- 로드밸런싱이나 프록시 없이 개별 Pod의 IP를 직접 반환한다.
- StatefulSet과 함께 사용하여 각 Pod에 고유한 DNS를 부여할 때 주로 사용된다.
- DNS 조회 시 해당 서비스에 연결된 모든 Pod의 IP가 반환된다.

### 1.4 설정과 스토리지

#### ConfigMap
- 비기밀(non-confidential) 설정 데이터를 키-값 쌍으로 저장하는 리소스이다.
- Pod에서 사용하는 방법은 다음과 같다:
  - 환경 변수로 주입
  - 커맨드라인 인자로 전달
  - 볼륨으로 마운트하여 설정 파일로 사용
- ConfigMap이 변경되면 볼륨으로 마운트된 경우 자동으로 업데이트되지만, 환경 변수로 주입된 경우에는 Pod를 재시작해야 반영된다.
- 최대 크기는 1MiB이다.

#### Secret
- 비밀번호, 토큰, SSH 키 등 민감한 데이터를 저장하는 리소스이다.
- ConfigMap과 사용법은 유사하지만, 데이터가 Base64로 인코딩되어 저장된다.
- Base64 인코딩은 암호화가 아니므로, 진정한 보안을 위해서는 EncryptionConfiguration을 설정하거나 외부 비밀 관리 도구(Vault 등)를 사용해야 한다.
- 주요 Secret 유형은 다음과 같다:
  - `Opaque` (기본값): 임의의 키-값 데이터
  - `kubernetes.io/dockerconfigjson`: Docker 레지스트리 인증 정보
  - `kubernetes.io/tls`: TLS 인증서와 키
  - `kubernetes.io/basic-auth`: 기본 인증 자격 증명
  - `kubernetes.io/service-account-token`: 서비스 어카운트 토큰

#### Volume (볼륨)
- Pod 내 컨테이너가 데이터를 저장하고 공유하는 데 사용하는 디렉토리이다.
- 컨테이너의 파일시스템은 임시적이므로, 컨테이너가 재시작되면 데이터가 사라진다. Volume은 이 문제를 해결한다.
- 주요 볼륨 유형은 다음과 같다:
  - **emptyDir**: Pod가 생성될 때 빈 디렉토리로 시작하며, Pod가 삭제되면 함께 삭제된다. 같은 Pod 내 컨테이너 간 데이터 공유에 사용된다.
  - **hostPath**: 호스트 노드의 파일시스템을 Pod에 마운트한다. 보안상 주의가 필요하다.
  - **nfs**: NFS 서버의 디렉토리를 마운트한다.
  - **configMap, secret**: ConfigMap이나 Secret 데이터를 파일로 마운트한다.

#### PersistentVolume (PV)
- 클러스터 관리자가 프로비저닝한 스토리지 리소스이다.
- Pod의 생명주기와 독립적으로 존재하는 클러스터 수준의 리소스이다.
- 접근 모드(Access Mode)는 다음과 같다:
  - **ReadWriteOnce (RWO)**: 하나의 노드에서 읽기/쓰기 가능
  - **ReadOnlyMany (ROX)**: 여러 노드에서 읽기 가능
  - **ReadWriteMany (RWX)**: 여러 노드에서 읽기/쓰기 가능
  - **ReadWriteOncePod (RWOP)**: 하나의 Pod에서만 읽기/쓰기 가능
- 회수 정책(Reclaim Policy)은 다음과 같다:
  - **Retain**: PVC가 삭제되어도 PV와 데이터를 보존한다. 관리자가 수동으로 정리해야 한다.
  - **Delete**: PVC가 삭제되면 PV와 외부 스토리지 자원도 함께 삭제된다.
  - **Recycle** (deprecated): PV의 데이터를 삭제(rm -rf)하고 재사용 가능 상태로 만든다.

#### PersistentVolumeClaim (PVC)
- 사용자(개발자)가 스토리지를 요청하는 리소스이다.
- PVC는 적절한 PV에 바인딩된다. 요청한 용량, 접근 모드, StorageClass 등이 일치하는 PV가 자동으로 선택된다.
- PV와 PVC의 관계는 1:1이다. 하나의 PV는 하나의 PVC에만 바인딩될 수 있다.

#### StorageClass
- 동적 프로비저닝(Dynamic Provisioning)을 가능하게 하는 리소스이다.
- PVC가 생성될 때 적합한 PV가 없으면, StorageClass의 설정에 따라 PV를 자동으로 생성한다.
- 프로비저너(Provisioner)를 지정하여 어떤 스토리지 백엔드를 사용할지 정의한다.
- 클라우드 환경에서는 각 클라우드 제공업체의 프로비저너를 사용한다 (예: `kubernetes.io/aws-ebs`, `kubernetes.io/gce-pd`).
- `volumeBindingMode`를 `WaitForFirstConsumer`로 설정하면 PVC를 사용하는 Pod가 스케줄링될 때까지 바인딩을 지연시킬 수 있다.

### 1.5 네임스페이스, 라벨, 셀렉터, 어노테이션

#### Namespace (네임스페이스)
- 하나의 물리적 클러스터를 여러 가상 클러스터로 나누는 방법이다.
- 리소스 이름의 범위를 제공하며, 같은 네임스페이스 내에서는 이름이 유일해야 한다.
- K8s가 기본으로 생성하는 네임스페이스는 다음과 같다:
  - **default**: 네임스페이스를 지정하지 않을 때 사용되는 기본 네임스페이스
  - **kube-system**: K8s 시스템 컴포넌트가 실행되는 네임스페이스
  - **kube-public**: 모든 사용자(인증 없이도)가 읽을 수 있는 공개 네임스페이스
  - **kube-node-lease**: 노드의 하트비트(heartbeat)와 관련된 Lease 오브젝트가 저장되는 네임스페이스
- ResourceQuota와 LimitRange를 사용하여 네임스페이스별 리소스 사용량을 제한할 수 있다.
- 네임스페이스는 클러스터 수준 리소스(Node, PV, Namespace 자체 등)에는 적용되지 않는다.

#### Label (라벨)
- 오브젝트에 부착하는 키-값 쌍의 메타데이터이다.
- 오브젝트를 식별하고 그룹화하는 데 사용된다.
- 예시: `app: nginx`, `env: production`, `tier: frontend`
- 라벨은 생성 후에도 언제든지 추가, 수정, 삭제가 가능하다.
- 하나의 오브젝트에 여러 라벨을 부착할 수 있다.

#### Selector (셀렉터)
- 라벨을 기반으로 오브젝트를 선택(필터링)하는 메커니즘이다.
- 두 가지 유형이 있다:
  - **동등성 기반(Equality-based)**: `=`, `==`, `!=` 연산자를 사용한다. 예: `env=production`
  - **집합 기반(Set-based)**: `in`, `notin`, `exists` 연산자를 사용한다. 예: `env in (production, staging)`
- Service와 Deployment는 셀렉터를 사용하여 관리할 Pod를 선택한다.

#### Annotation (어노테이션)
- 오브젝트에 부착하는 키-값 쌍의 메타데이터이지만, 라벨과 달리 오브젝트를 식별하거나 선택하는 데 사용되지 않는다.
- 주로 도구나 라이브러리가 사용하는 비식별(non-identifying) 정보를 저장한다.
- 예시: 빌드/릴리스 정보, Git 커밋 해시, 담당자 연락처, Ingress 설정 등
- 라벨과 달리 구조화되지 않은 큰 데이터도 저장할 수 있다.

### 1.6 kubectl 기본 명령어 정리

kubectl은 K8s 클러스터와 통신하기 위한 커맨드라인 도구이다.

| 명령어 | 설명 |
|--------|------|
| `kubectl get <리소스>` | 리소스 목록을 조회한다 |
| `kubectl get <리소스> -o wide` | 추가 정보(노드, IP 등)를 포함하여 조회한다 |
| `kubectl get <리소스> -o yaml` | YAML 형식으로 상세 정보를 조회한다 |
| `kubectl describe <리소스> <이름>` | 리소스의 상세 정보와 이벤트를 조회한다 |
| `kubectl create -f <파일>` | YAML 파일로 리소스를 생성한다 (이미 존재하면 오류) |
| `kubectl apply -f <파일>` | YAML 파일로 리소스를 생성하거나 갱신한다 (선언적 방식) |
| `kubectl delete <리소스> <이름>` | 리소스를 삭제한다 |
| `kubectl delete -f <파일>` | YAML 파일에 정의된 리소스를 삭제한다 |
| `kubectl logs <Pod>` | Pod의 로그를 조회한다 |
| `kubectl logs <Pod> -c <컨테이너>` | 멀티컨테이너 Pod에서 특정 컨테이너의 로그를 조회한다 |
| `kubectl logs <Pod> -f` | 로그를 실시간으로 스트리밍한다 |
| `kubectl exec -it <Pod> -- <명령어>` | Pod 내 컨테이너에서 명령어를 실행한다 |
| `kubectl run <이름> --image=<이미지>` | 간단한 Pod를 생성한다 |
| `kubectl scale deployment <이름> --replicas=<수>` | Deployment의 복제본 수를 조정한다 |
| `kubectl rollout status deployment <이름>` | Deployment 롤아웃 상태를 확인한다 |
| `kubectl rollout undo deployment <이름>` | 이전 버전으로 롤백한다 |
| `kubectl rollout history deployment <이름>` | 롤아웃 이력을 조회한다 |
| `kubectl top nodes` | 노드의 리소스 사용량을 조회한다 (metrics-server 필요) |
| `kubectl top pods` | Pod의 리소스 사용량을 조회한다 |
| `kubectl explain <리소스>` | 리소스의 필드 문서를 조회한다 |
| `kubectl explain <리소스>.spec` | 특정 필드의 하위 필드 문서를 조회한다 |
| `kubectl config view` | kubeconfig 설정을 조회한다 |
| `kubectl config use-context <이름>` | 현재 사용 컨텍스트를 변경한다 |
| `kubectl api-resources` | 사용 가능한 API 리소스 목록을 조회한다 |
| `kubectl port-forward <Pod> <로컬포트>:<Pod포트>` | 로컬 포트를 Pod 포트로 포워딩한다 |
| `kubectl label <리소스> <이름> <키>=<값>` | 리소스에 라벨을 추가한다 |
| `kubectl annotate <리소스> <이름> <키>=<값>` | 리소스에 어노테이션을 추가한다 |
| `kubectl edit <리소스> <이름>` | 리소스를 편집기에서 직접 수정한다 |
| `kubectl patch <리소스> <이름> -p '<JSON>'` | 리소스를 부분적으로 수정한다 |
| `kubectl drain <노드>` | 노드의 Pod를 안전하게 퇴거시킨다 |
| `kubectl cordon <노드>` | 노드를 스케줄링 불가 상태로 설정한다 |
| `kubectl uncordon <노드>` | 노드를 스케줄링 가능 상태로 복원한다 |
| `kubectl taint nodes <노드> <키>=<값>:<효과>` | 노드에 테인트를 추가한다 |

### 1.7 RBAC (역할 기반 접근 제어)

RBAC(Role-Based Access Control)은 K8s에서 사용자 및 서비스 어카운트의 권한을 관리하는 메커니즘이다.

- **Role**: 특정 네임스페이스 내에서의 권한을 정의한다.
- **ClusterRole**: 클러스터 전체에 적용되는 권한을 정의한다.
- **RoleBinding**: Role을 사용자/그룹/서비스어카운트에 바인딩한다.
- **ClusterRoleBinding**: ClusterRole을 사용자/그룹/서비스어카운트에 바인딩한다.
- K8s의 인가 방식에는 RBAC 외에도 ABAC, Webhook, Node 방식이 있다.

### 1.8 Ingress

- 클러스터 외부에서 내부 서비스로의 HTTP/HTTPS 라우팅 규칙을 정의하는 리소스이다.
- 하나의 IP 주소로 여러 서비스에 대한 라우팅이 가능하다 (호스트 기반, 경로 기반).
- Ingress 리소스만으로는 동작하지 않으며, Ingress Controller가 필요하다.
- 주요 Ingress Controller: NGINX Ingress Controller, Traefik, HAProxy, AWS ALB Ingress Controller
- TLS 종료(TLS Termination)를 Ingress에서 처리할 수 있다.

### 1.9 NetworkPolicy

- Pod 간 또는 Pod와 외부 간의 네트워크 트래픽을 제어하는 리소스이다.
- 기본적으로 K8s의 모든 Pod는 다른 모든 Pod와 통신이 가능하다 (Flat Network).
- NetworkPolicy를 통해 인그레스(수신)와 이그레스(송신) 규칙을 정의하여 트래픽을 제한할 수 있다.
- NetworkPolicy가 동작하려면 CNI 플러그인이 이를 지원해야 한다 (Calico, Cilium 등).
- Flannel은 NetworkPolicy를 지원하지 않는다.

---

## 2. Container Orchestration (22%)

### 2.1 컨테이너 기본 개념

#### 컨테이너란?
- 애플리케이션과 그 의존성을 하나의 패키지로 묶어 격리된 환경에서 실행하는 기술이다.
- 가상 머신(VM)과 달리 호스트 OS의 커널을 공유하므로 가볍고 빠르다.
- Linux 커널의 namespace와 cgroups 기술을 기반으로 동작한다.
  - **namespace**: 프로세스, 네트워크, 파일시스템 등의 격리를 제공한다. 주요 namespace는 PID, NET, MNT, UTS, IPC, USER이다.
  - **cgroups(Control Groups)**: CPU, 메모리, I/O 등의 리소스 사용량을 제한하고 모니터링한다.

#### 컨테이너 vs 가상 머신
| 항목 | 컨테이너 | 가상 머신 |
|------|----------|----------|
| 격리 수준 | 프로세스 수준 | 하드웨어 수준 |
| OS | 호스트 커널 공유 | 게스트 OS 포함 |
| 크기 | 수 MB | 수 GB |
| 시작 시간 | 초 단위 | 분 단위 |
| 리소스 효율성 | 높음 | 낮음 |
| 보안 격리 | 상대적으로 약함 | 강함 |

### 2.2 OCI (Open Container Initiative) 표준

- Linux Foundation 산하 프로젝트로, 컨테이너 형식과 런타임에 대한 개방형 산업 표준을 정의한다.
- 두 가지 주요 사양이 있다:
  - **Runtime Specification (runtime-spec)**: 컨테이너 런타임이 컨테이너를 어떻게 실행해야 하는지를 정의한다.
  - **Image Specification (image-spec)**: 컨테이너 이미지의 형식과 구조를 정의한다.
  - **Distribution Specification (distribution-spec)**: 컨테이너 이미지의 배포 방식을 정의한다.
- OCI 표준 덕분에 Docker로 빌드한 이미지를 containerd, CRI-O 등 다른 런타임에서도 실행할 수 있다.

### 2.3 CRI (Container Runtime Interface)

- K8s가 컨테이너 런타임과 통신하기 위한 표준 인터페이스(API)이다.
- CRI를 도입함으로써 K8s는 특정 컨테이너 런타임에 종속되지 않게 되었다.
- gRPC 기반의 API를 사용하며, 두 가지 서비스를 정의한다:
  - **RuntimeService**: Pod 및 컨테이너의 생명주기를 관리한다 (생성, 시작, 중지, 삭제).
  - **ImageService**: 컨테이너 이미지를 관리한다 (가져오기, 조회, 삭제).

### 2.4 containerd

- Docker에서 분리된 고수준 컨테이너 런타임이다.
- CNCF 졸업(graduated) 프로젝트이다.
- K8s에서 가장 널리 사용되는 컨테이너 런타임이다.
- 컨테이너의 전체 생명주기를 관리한다: 이미지 전송, 스토리지, 컨테이너 실행, 네트워킹.
- 낮은 수준의 컨테이너 실행은 runc에 위임한다.
- Docker 엔진 자체도 내부적으로 containerd를 사용한다.

### 2.5 runc

- OCI Runtime Specification의 참조 구현체로, 저수준 컨테이너 런타임이다.
- 실제로 Linux 커널의 namespace, cgroups 등을 호출하여 컨테이너 프로세스를 생성한다.
- containerd와 CRI-O 모두 기본적으로 runc를 사용하여 컨테이너를 생성하고 실행한다.
- Go 언어로 작성되었으며 CLI 도구로 사용할 수 있다.

### 2.6 컨테이너 이미지

#### 이미지 빌드
- **Dockerfile**: 컨테이너 이미지를 빌드하기 위한 명세 파일이다.
- 주요 명령어:
  - `FROM`: 베이스 이미지를 지정한다.
  - `RUN`: 이미지 빌드 시 명령어를 실행한다.
  - `COPY` / `ADD`: 파일을 이미지에 복사한다.
  - `WORKDIR`: 작업 디렉토리를 설정한다.
  - `EXPOSE`: 컨테이너가 수신할 포트를 문서화한다.
  - `ENV`: 환경 변수를 설정한다.
  - `CMD`: 컨테이너 시작 시 실행할 기본 명령어를 지정한다.
  - `ENTRYPOINT`: 컨테이너 시작 시 실행할 명령어를 고정한다 (CMD와 다르게 덮어쓸 수 없다).
- **멀티스테이지 빌드**: 빌드 단계와 실행 단계를 분리하여 최종 이미지 크기를 줄이는 기법이다.
- Docker 외에 Buildah, Kaniko, BuildKit 등의 빌드 도구도 있다.

#### 컨테이너 레지스트리
- 컨테이너 이미지를 저장하고 배포하는 서비스이다.
- 주요 레지스트리는 다음과 같다:
  - **Docker Hub**: 가장 대표적인 공용 레지스트리
  - **GitHub Container Registry (ghcr.io)**: GitHub에서 제공하는 레지스트리
  - **AWS ECR, GCP Artifact Registry, Azure ACR**: 클라우드 제공업체의 관리형 레지스트리
  - **Harbor**: CNCF 졸업 프로젝트인 오픈소스 프라이빗 레지스트리
- 이미지 태그는 특정 버전을 식별하는 데 사용되며, `latest`는 기본 태그이지만 프로덕션에서는 명시적 버전 태그를 사용하는 것이 권장된다.
- **이미지 다이제스트(digest)**: SHA256 해시로 이미지를 고유하게 식별하며, 태그보다 안전하다.

### 2.7 오케스트레이션의 필요성

컨테이너 오케스트레이션이 필요한 이유는 다음과 같다:

- **스케줄링**: 수많은 컨테이너를 여러 노드에 효율적으로 배치해야 한다. 리소스 가용성, 제약 조건 등을 고려하여 최적의 노드를 선택한다.
- **자동 복구(Self-healing)**: 컨테이너나 노드가 실패하면 자동으로 감지하고 복구한다.
  - 컨테이너가 비정상 종료되면 자동으로 재시작한다.
  - Liveness Probe 실패 시 컨테이너를 재시작한다.
  - Readiness Probe 실패 시 서비스 엔드포인트에서 제거한다.
  - 노드가 다운되면 해당 노드의 Pod를 다른 노드에 재스케줄링한다.
- **서비스 디스커버리(Service Discovery)**: 동적으로 생성/삭제되는 컨테이너를 안정적으로 찾을 수 있어야 한다.
  - K8s는 DNS 기반 서비스 디스커버리를 제공한다 (CoreDNS).
  - 환경 변수를 통한 서비스 디스커버리도 지원한다.
- **로드밸런싱**: 트래픽을 여러 컨테이너에 분산한다.
- **스케일링**: 부하에 따라 컨테이너 수를 자동으로 조정한다.
- **롤링 업데이트와 롤백**: 무중단 배포와 문제 발생 시 이전 버전으로의 신속한 복원을 지원한다.
- **설정 관리**: 애플리케이션 설정을 코드와 분리하여 관리한다.

### 2.8 K8s 외 오케스트레이션 도구

- **Docker Swarm**: Docker 내장 오케스트레이션 도구이다. K8s보다 간단하지만 기능이 제한적이다.
- **Apache Mesos**: 대규모 데이터센터의 리소스를 관리하는 프레임워크이다. Marathon 프레임워크와 함께 컨테이너 오케스트레이션이 가능하다.
- **Nomad (HashiCorp)**: 컨테이너뿐 아니라 VM, 바이너리 등 다양한 워크로드를 관리할 수 있는 오케스트레이터이다.

---

## 3. Cloud Native Architecture (16%)

### 3.1 CNCF (Cloud Native Computing Foundation)

- Linux Foundation 산하 재단으로, 클라우드 네이티브 컴퓨팅 기술의 채택을 촉진하기 위해 설립되었다.
- 오픈소스 프로젝트를 호스팅하고 커뮤니티를 지원한다.
- **Cloud Native의 정의 (CNCF)**: 클라우드 네이티브 기술은 퍼블릭, 프라이빗, 하이브리드 클라우드 환경에서 확장 가능한 애플리케이션을 빌드하고 실행할 수 있게 한다. 컨테이너, 서비스 메시, 마이크로서비스, 불변 인프라, 선언적 API가 이 접근 방식의 대표적 예이다.

#### CNCF Landscape
- 클라우드 네이티브 생태계의 전체 지도를 시각화한 것이다.
- 수백 개의 프로젝트와 제품을 카테고리별로 분류한다.
- 주요 카테고리: App Definition & Development, Orchestration & Management, Runtime, Provisioning, Observability & Analysis 등

#### 프로젝트 성숙도 단계
CNCF 프로젝트는 세 단계의 성숙도를 가진다:

**Sandbox (샌드박스)**
- 초기 단계의 프로젝트로, 아직 실험적이다.
- CNCF 기술 감독 위원회(TOC)의 승인이 필요하다.
- 아직 널리 채택되지 않았으며, 프로덕션 사용은 권장되지 않을 수 있다.

**Incubating (인큐베이팅)**
- 성장 중인 프로젝트로, 커뮤니티와 채택이 늘어나고 있다.
- 프로덕션에서 사용되는 사례가 있으며, 건강한 커뮤니티가 형성되어 있다.
- 예시: Argo, Containerd(과거), Cilium(과거)

**Graduated (졸업)**
- 성숙한 프로젝트로, 광범위하게 채택되었으며 프로덕션에서 검증되었다.
- 보안 감사(security audit)를 완료해야 한다.
- 주요 졸업 프로젝트:
  - Kubernetes, Prometheus, Envoy, CoreDNS
  - containerd, etcd, Fluentd, Helm
  - Harbor, Jaeger, Linkerd, Open Policy Agent (OPA)
  - Rook, TiKV, Vitess, TUF, Falco
  - Argo, Flux, Cilium, CloudEvents

### 3.2 마이크로서비스 vs 모놀리식

#### 모놀리식(Monolithic) 아키텍처
- 모든 기능이 하나의 코드베이스, 하나의 프로세스로 실행되는 구조이다.
- 장점:
  - 개발과 배포가 간단하다.
  - 로컬 함수 호출이므로 성능이 좋다.
  - 디버깅과 테스트가 비교적 쉽다.
  - 트랜잭션 관리가 단순하다.
- 단점:
  - 코드베이스가 커지면 이해하고 유지보수하기 어려워진다.
  - 일부 기능만 변경해도 전체를 재배포해야 한다.
  - 기술 스택 변경이 어렵다 (기술 종속).
  - 한 부분의 장애가 전체 시스템에 영향을 미칠 수 있다.
  - 특정 기능만 독립적으로 스케일링하기 어렵다.

#### 마이크로서비스(Microservices) 아키텍처
- 애플리케이션을 작고 독립적인 서비스 단위로 분리하는 구조이다.
- 각 서비스는 특정 비즈니스 기능을 담당하며, 독립적으로 개발, 배포, 확장 가능하다.
- 서비스 간 통신은 API(REST, gRPC 등)를 통해 이루어진다.
- 장점:
  - 독립적 배포가 가능하여 빠른 릴리스 주기를 갖는다.
  - 서비스별로 최적의 기술 스택을 선택할 수 있다 (폴리글랏).
  - 특정 서비스만 독립적으로 스케일링 가능하다.
  - 장애가 격리되어 전체 시스템에 미치는 영향이 줄어든다.
  - 팀별 독립적 개발이 가능하다.
- 단점:
  - 분산 시스템의 복잡성이 증가한다.
  - 네트워크 통신으로 인한 지연(latency)이 발생한다.
  - 분산 트랜잭션 관리가 어렵다.
  - 서비스 간 의존성 관리가 필요하다.
  - 운영 및 모니터링이 복잡해진다.

### 3.3 서버리스 (Serverless)

- 개발자가 서버 인프라를 관리하지 않고 코드만 작성하여 실행하는 모델이다.
- 실제로 서버가 없는 것이 아니라, 서버의 관리를 클라우드 제공업체가 대신 수행하는 것이다.
- 두 가지 형태가 있다:
  - **FaaS (Function as a Service)**: 이벤트에 응답하여 함수를 실행한다. AWS Lambda, Google Cloud Functions, Azure Functions 등이 대표적이다.
  - **BaaS (Backend as a Service)**: 데이터베이스, 인증 등 백엔드 기능을 관리형 서비스로 제공한다. Firebase, AWS Cognito 등이 해당된다.
- 특징:
  - 사용한 만큼만 비용을 지불한다 (요청 수, 실행 시간 기반).
  - 자동으로 스케일링된다 (0에서 무한대까지).
  - 콜드 스타트(Cold Start) 문제가 있을 수 있다.
- K8s 기반 서버리스 플랫폼: **Knative**, **OpenFaaS**, **Kubeless**
- **Knative**: Google이 주도하는 K8s 기반 서버리스 플랫폼으로, Serving(서빙)과 Eventing(이벤팅) 컴포넌트로 구성된다. Scale-to-zero가 가능하다.

### 3.4 서비스 메시 (Service Mesh)

- 마이크로서비스 간의 통신을 관리하는 인프라 계층이다.
- 애플리케이션 코드를 수정하지 않고 사이드카 프록시를 통해 트래픽을 제어한다.
- 주요 기능:
  - **트래픽 관리**: 로드밸런싱, 라우팅, 카나리 배포, A/B 테스트
  - **보안**: 서비스 간 mTLS(상호 TLS) 암호화, 인증/인가
  - **관측성(Observability)**: 분산 트레이싱, 메트릭 수집, 로깅
  - **회복탄력성(Resiliency)**: 재시도(Retry), 타임아웃, 서킷 브레이커(Circuit Breaker)
- 아키텍처:
  - **Data Plane**: 각 서비스 옆에 배치된 사이드카 프록시(Envoy 등)가 실제 트래픽을 처리한다.
  - **Control Plane**: 프록시의 설정과 정책을 관리한다.
- 주요 서비스 메시:
  - **Istio**: Google, IBM, Lyft가 개발한 가장 유명한 서비스 메시이다. Envoy를 사이드카 프록시로 사용한다.
  - **Linkerd**: CNCF 졸업 프로젝트이며, 경량 서비스 메시이다. Rust로 작성된 자체 프록시(linkerd2-proxy)를 사용한다.
  - **Consul Connect**: HashiCorp의 서비스 디스커버리 도구인 Consul에 메시 기능을 추가한 것이다.

### 3.5 Autoscaling (자동 스케일링)

#### HPA (Horizontal Pod Autoscaler)
- Pod의 수를 자동으로 조정하여 수평 확장/축소를 수행한다.
- CPU 사용률, 메모리 사용률, 또는 커스텀 메트릭을 기반으로 동작한다.
- `metrics-server`가 설치되어 있어야 한다.
- 설정 항목: `minReplicas`, `maxReplicas`, `targetCPUUtilizationPercentage` 또는 `metrics` 배열
- 기본적으로 15초마다 메트릭을 확인한다.
- 스케일다운 안정화 기간(default 5분)이 있어, 메트릭이 일시적으로 낮아져도 즉시 축소하지 않는다.

#### VPA (Vertical Pod Autoscaler)
- Pod의 리소스 요청(requests)과 제한(limits)을 자동으로 조정한다.
- 세 가지 구성 요소가 있다:
  - **Recommender**: 리소스 사용 패턴을 분석하고 권장 값을 계산한다.
  - **Updater**: Pod의 리소스를 업데이트하기 위해 Pod를 재시작한다.
  - **Admission Controller**: 새로 생성되는 Pod에 권장 리소스 값을 적용한다.
- HPA와 동시에 같은 메트릭(CPU/메모리)에 대해 사용하면 충돌이 발생할 수 있으므로 주의해야 한다.
- 업데이트 모드: Auto, Recreate, Initial, Off

#### Cluster Autoscaler
- 클러스터의 노드 수를 자동으로 조정한다.
- 리소스 부족으로 스케줄링할 수 없는 Pending Pod가 있으면 노드를 추가한다.
- 노드의 리소스 사용률이 낮으면 노드를 제거한다 (해당 노드의 Pod는 다른 노드로 이동).
- 클라우드 제공업체의 Auto Scaling Group(ASG), Managed Instance Group(MIG) 등과 연동된다.
- K8s의 공식 프로젝트이며, 주요 클라우드 제공업체를 지원한다.
- **Karpenter**: AWS에서 개발한 차세대 노드 프로비저너로, Cluster Autoscaler보다 빠르고 유연한 스케일링을 제공한다. CNCF 인큐베이팅 프로젝트이다.

### 3.6 Cloud Native 설계 원칙

- **불변 인프라(Immutable Infrastructure)**: 배포된 인프라를 수정하지 않고, 변경이 필요하면 새로 빌드하여 교체한다. 컨테이너 이미지가 대표적이다.
- **선언적 설정(Declarative Configuration)**: "어떻게(How)"가 아닌 "무엇을(What)" 원하는지를 기술한다. K8s의 YAML 매니페스트가 대표적이다.
- **자동화(Automation)**: 빌드, 테스트, 배포, 스케일링 등 가능한 모든 것을 자동화한다.
- **12-Factor App**: Heroku에서 제시한 클라우드 네이티브 애플리케이션 설계 방법론으로, 코드베이스, 의존성 명시, 설정의 외부화, 백엔드 서비스 분리, 빌드/릴리스/실행 분리, 무상태 프로세스, 포트 바인딩, 동시성, 폐기 용이성, 개발/프로덕션 일치, 로그 스트림, 관리 프로세스의 12가지 원칙을 다룬다.

---

## 4. Cloud Native Observability (8%)

관측성(Observability)은 시스템의 외부 출력을 관찰하여 내부 상태를 이해할 수 있는 능력이다. 클라우드 네이티브 환경에서는 특히 중요하며, 세 가지 핵심 축(Three Pillars)으로 구성된다.

### 4.1 세 기둥 (Three Pillars of Observability)

#### 메트릭 (Metrics)
- 시간에 따른 수치 데이터를 측정한 것이다.
- CPU 사용률, 메모리 사용량, 요청 수, 응답 시간 등이 대표적이다.
- 집계와 통계적 분석에 적합하다.
- 저장 비용이 상대적으로 낮다.
- 대시보드와 경고(Alert)에 활용된다.

#### 로그 (Logs)
- 시스템에서 발생하는 개별 이벤트를 시간순으로 기록한 것이다.
- 구조화된(structured) 로그와 비구조화된(unstructured) 로그가 있다.
- 특정 이벤트의 상세한 컨텍스트를 파악하는 데 유용하다.
- 저장 비용이 상대적으로 높을 수 있다.
- 디버깅과 감사(audit)에 주로 사용된다.

#### 트레이스 (Traces / Distributed Tracing)
- 분산 시스템에서 하나의 요청이 여러 서비스를 거치는 경로를 추적한 것이다.
- 각 서비스에서의 처리 시간(span)과 서비스 간 호출 관계를 시각화한다.
- 성능 병목 지점 식별과 서비스 간 의존 관계 파악에 유용하다.
- 일반적으로 모든 요청이 아닌 일부만 샘플링하여 추적한다.

### 4.2 모니터링: Prometheus & Grafana

#### Prometheus
- CNCF 졸업 프로젝트이며, K8s 생태계의 사실상 표준 모니터링 시스템이다.
- 주요 특징:
  - **Pull 기반 메트릭 수집**: 타겟의 `/metrics` 엔드포인트를 주기적으로 스크래핑(scraping)한다.
  - **다차원 데이터 모델**: 메트릭 이름과 라벨(key-value)로 시계열 데이터를 구분한다.
  - **PromQL**: Prometheus 전용 쿼리 언어로, 강력한 데이터 조회와 집계가 가능하다.
  - **자체 시계열 데이터베이스(TSDB)**: 내장 스토리지에 시계열 데이터를 효율적으로 저장한다.
  - **Alertmanager**: 알림 규칙에 따라 이메일, Slack, PagerDuty 등으로 경고를 전송한다.
  - **서비스 디스커버리**: K8s의 서비스, Pod, 노드 등을 자동으로 검색하여 모니터링 대상으로 등록한다.
- 메트릭 유형: Counter(누적 값), Gauge(현재 값), Histogram(분포), Summary(요약)
- Pushgateway를 통해 Push 방식도 지원한다 (단기 실행 작업에 적합).

#### Grafana
- 오픈소스 데이터 시각화 및 대시보드 도구이다.
- Prometheus, Loki, Elasticsearch, InfluxDB 등 다양한 데이터 소스를 지원한다.
- 풍부한 시각화 옵션(그래프, 게이지, 히트맵, 테이블 등)을 제공한다.
- 대시보드를 JSON으로 내보내고 가져올 수 있으며, Grafana.com에서 커뮤니티 대시보드를 다운로드할 수 있다.
- 경고(Alert) 기능도 내장되어 있다.

### 4.3 로깅: Fluentd, Loki, EFK

#### Fluentd
- CNCF 졸업 프로젝트이며, 오픈소스 데이터 수집기(로그 수집기)이다.
- 다양한 소스에서 로그를 수집하고, 필터링/변환하여 다양한 목적지로 전송한다.
- **통합 로깅 계층(Unified Logging Layer)**을 제공한다.
- 500개 이상의 플러그인을 지원하여 입력, 출력, 필터를 유연하게 구성할 수 있다.
- K8s 환경에서는 DaemonSet으로 배포하여 각 노드의 로그를 수집하는 것이 일반적이다.
- Fluent Bit: Fluentd의 경량 버전으로, 리소스 소비가 적어 에지/IoT 환경에 적합하다. CNCF 졸업 프로젝트이다.

#### Loki
- Grafana Labs에서 개발한 로그 집계 시스템이다.
- "Prometheus의 로그 버전"이라고 불린다.
- 로그 내용을 인덱싱하지 않고 라벨만 인덱싱하므로 비용 효율적이다.
- Grafana와 네이티브 통합되어 로그를 쉽게 검색하고 시각화할 수 있다.
- LogQL이라는 쿼리 언어를 사용한다.
- Promtail이라는 에이전트를 통해 로그를 수집한다.

#### EFK Stack
- **Elasticsearch + Fluentd + Kibana**의 조합이다.
- Elasticsearch: 로그를 저장하고 검색하는 분산 검색 엔진이다.
- Fluentd: 로그를 수집하고 Elasticsearch로 전송한다.
- Kibana: Elasticsearch에 저장된 로그를 시각화하고 분석하는 대시보드 도구이다.
- ELK Stack(Elasticsearch + Logstash + Kibana)에서 Logstash 대신 Fluentd를 사용한 것이다.

### 4.4 트레이싱: Jaeger, OpenTelemetry

#### Jaeger
- CNCF 졸업 프로젝트이며, 분산 트레이싱 시스템이다.
- Uber에서 개발하여 오픈소스로 공개되었다.
- 주요 기능:
  - 분산 트랜잭션 모니터링
  - 성능 및 지연 최적화
  - 서비스 의존성 분석
  - 근본 원인 분석(Root Cause Analysis)
- OpenTracing 표준과 호환된다.
- 구성 요소: Agent, Collector, Query, UI, Storage(Cassandra, Elasticsearch 등)

#### OpenTelemetry (OTel)
- CNCF 인큐베이팅 프로젝트이며, 관측성 데이터(메트릭, 로그, 트레이스)를 생성하고 수집하기 위한 통합 프레임워크이다.
- OpenTracing과 OpenCensus가 합병하여 탄생하였다.
- 벤더 중립적(vendor-neutral)이므로, 백엔드를 자유롭게 선택할 수 있다 (Jaeger, Prometheus, Datadog 등).
- 주요 구성 요소:
  - **API**: 텔레메트리 데이터를 생성하기 위한 인터페이스
  - **SDK**: API의 구현체로, 데이터를 처리하고 내보내는 기능을 제공한다.
  - **Collector**: 텔레메트리 데이터를 수신, 처리, 내보내는 에이전트이다. 수신기(Receiver), 처리기(Processor), 내보내기(Exporter)로 구성된다.
  - **Instrumentation Libraries**: 다양한 언어(Java, Python, Go, JavaScript 등)용 라이브러리를 제공한다.
- 클라우드 네이티브 관측성의 미래 표준으로 자리 잡고 있다.

### 4.5 Cost Management (비용 관리)

- 클라우드 네이티브 환경에서 비용을 효율적으로 관리하는 것은 중요한 과제이다.
- 리소스 요청(requests)과 제한(limits)을 적절히 설정하여 리소스 낭비를 줄여야 한다.
- **Kubecost**: K8s 비용을 모니터링하고 최적화하는 오픈소스 도구이다.
- FinOps(Financial Operations): 클라우드 비용의 가시성, 최적화, 거버넌스를 위한 운영 모델이다.

---

## 5. Cloud Native Application Delivery (8%)

### 5.1 GitOps

- Git 저장소를 단일 진실 소스(Single Source of Truth)로 사용하여 인프라와 애플리케이션을 관리하는 방법론이다.
- **핵심 원칙:**
  1. **선언적 설정**: 모든 시스템 상태를 선언적으로 기술한다.
  2. **Git을 단일 진실 소스로**: 원하는 상태(desired state)는 Git에 저장된다.
  3. **자동 적용**: 승인된 변경 사항은 자동으로 시스템에 적용된다.
  4. **지속적 조정(Reconciliation)**: 에이전트가 실제 상태를 지속적으로 감시하고, 원하는 상태와 차이가 있으면 자동으로 수정한다.
- 장점:
  - 모든 변경 이력이 Git에 남으므로 감사(audit) 추적이 용이하다.
  - Pull Request 기반 리뷰로 변경 사항을 검토할 수 있다.
  - 롤백이 간단하다 (Git revert).
  - 개발자 친화적인 워크플로우이다.

#### ArgoCD
- K8s를 위한 선언적 GitOps 지속적 배포 도구이다.
- CNCF 졸업 프로젝트(Argo 프로젝트의 일부)이다.
- 주요 기능:
  - Git 저장소의 K8s 매니페스트를 감시하고 클러스터에 자동 동기화한다.
  - 웹 UI를 제공하여 애플리케이션 상태를 시각적으로 확인할 수 있다.
  - Helm, Kustomize, Jsonnet, 일반 YAML 등 다양한 매니페스트 형식을 지원한다.
  - 멀티 클러스터 배포를 지원한다.
  - SSO(Single Sign-On) 통합을 지원한다.
  - RBAC을 통한 접근 제어가 가능하다.
  - 자동 동기화(Auto-Sync)와 수동 동기화(Manual Sync)를 선택할 수 있다.
  - Health 상태 검사와 동기화 상태를 제공한다.

#### Flux
- K8s를 위한 GitOps 도구이다.
- CNCF 졸업 프로젝트이다.
- 주요 기능:
  - Git 저장소의 변경 사항을 감시하고 클러스터에 자동 적용한다.
  - Helm Controller, Kustomize Controller 등 여러 컨트롤러로 구성된다.
  - Image Automation Controller를 통해 새로운 이미지가 레지스트리에 푸시되면 자동으로 매니페스트를 업데이트한다.
  - 멀티 테넌시(Multi-tenancy)를 지원한다.
  - Notification Controller를 통해 Slack, Teams 등으로 알림을 전송한다.

### 5.2 CI/CD 파이프라인

#### CI (Continuous Integration, 지속적 통합)
- 개발자가 코드 변경을 자주(하루에 여러 번) 메인 브랜치에 병합하는 관행이다.
- 병합할 때마다 자동으로 빌드와 테스트를 수행한다.
- 코드 품질 문제를 조기에 발견하고 해결할 수 있다.
- 주요 CI 도구: Jenkins, GitHub Actions, GitLab CI, CircleCI, Travis CI, Tekton

#### CD (Continuous Delivery / Deployment, 지속적 전달/배포)
- **Continuous Delivery**: 소프트웨어를 언제든지 프로덕션에 배포할 수 있는 상태로 유지하는 것이다. 프로덕션 배포는 수동 승인이 필요할 수 있다.
- **Continuous Deployment**: 모든 변경 사항이 자동으로 프로덕션에 배포되는 것이다. 수동 승인 없이 완전 자동화된다.
- 배포 전략:
  - **롤링 업데이트(Rolling Update)**: 점진적으로 새 버전을 배포한다.
  - **블루/그린(Blue/Green)**: 두 환경을 준비하고, 트래픽을 한 번에 전환한다.
  - **카나리(Canary)**: 일부 트래픽만 새 버전으로 보내어 테스트한 후 점진적으로 확대한다.
  - **A/B 테스트**: 사용자 그룹에 따라 다른 버전을 제공한다.

#### Tekton
- K8s 네이티브 CI/CD 파이프라인 프레임워크이다.
- CNCF 프로젝트이다.
- CI/CD 파이프라인의 각 단계를 K8s 커스텀 리소스(CRD)로 정의한다.
- 주요 개념: Task, TaskRun, Pipeline, PipelineRun, Workspace

### 5.3 Helm

- K8s의 패키지 매니저이다.
- CNCF 졸업 프로젝트이다.
- 주요 개념:
  - **Chart**: K8s 리소스를 정의하는 패키지이다. 여러 K8s 매니페스트를 하나로 묶은 것이다.
  - **Release**: Chart의 인스턴스이다. 같은 Chart를 여러 번 설치하면 각각 별도의 Release가 된다.
  - **Repository**: Chart를 저장하고 공유하는 장소이다.
  - **Values**: Chart의 기본 설정을 오버라이드하는 사용자 정의 값이다.
- Chart 구조:
  ```
  mychart/
    Chart.yaml        # Chart의 메타데이터 (이름, 버전 등)
    values.yaml       # 기본 설정 값
    templates/         # K8s 매니페스트 템플릿
      deployment.yaml
      service.yaml
      _helpers.tpl     # 템플릿 헬퍼 함수
    charts/            # 의존성 차트
  ```
- Helm v3에서는 Tiller가 제거되어 보안이 향상되었으며, 3-way 전략적 병합 패치(3-way strategic merge patch)를 사용한다.
- 주요 명령어: `helm install`, `helm upgrade`, `helm rollback`, `helm uninstall`, `helm list`, `helm repo add`, `helm search`, `helm template`

### 5.4 Kustomize

- K8s 매니페스트를 템플릿 없이 커스터마이징하는 도구이다.
- kubectl에 내장되어 있어 별도 설치 없이 `kubectl apply -k` 명령으로 사용할 수 있다.
- 기본 매니페스트(base)에 환경별 오버레이(overlay)를 적용하는 방식으로 동작한다.
- 주요 기능:
  - **패치(Patches)**: Strategic Merge Patch 또는 JSON Patch를 통해 리소스를 부분 수정한다.
  - **네임 프리픽스/서픽스**: 리소스 이름에 접두사/접미사를 추가한다.
  - **라벨/어노테이션 추가**: 모든 리소스에 공통 라벨이나 어노테이션을 추가한다.
  - **ConfigMap/Secret 생성**: 파일이나 리터럴에서 자동으로 생성한다.
  - **이미지 태그 변경**: 이미지 이름이나 태그를 쉽게 변경한다.
- `kustomization.yaml` 파일로 설정을 관리한다.
- Helm과 달리 Go 템플릿을 사용하지 않으므로, YAML의 유효성을 항상 보장한다.

### 5.5 IaC (Infrastructure as Code)

- 인프라를 코드로 정의하고 관리하는 방법론이다.
- 인프라를 수동으로 프로비저닝하는 대신, 코드로 선언하여 버전 관리, 재현성, 일관성을 보장한다.
- 주요 도구:
  - **Terraform (HashiCorp)**: 멀티 클라우드 IaC 도구로 가장 널리 사용된다. HCL(HashiCorp Configuration Language)을 사용하며, 선언적 방식으로 인프라를 정의한다. OpenTofu는 Terraform의 오픈소스 포크이다.
  - **Pulumi**: 일반 프로그래밍 언어(TypeScript, Python, Go 등)로 인프라를 정의할 수 있다.
  - **AWS CloudFormation**: AWS 전용 IaC 서비스이다.
  - **Ansible (Red Hat)**: 에이전트리스(agentless) 설정 관리 도구로, YAML로 플레이북을 작성한다. 절차적(imperative) 방식에 가깝다.
  - **Crossplane**: K8s를 기반으로 클라우드 인프라를 관리하는 CNCF 인큐베이팅 프로젝트이다. K8s CRD를 통해 클라우드 리소스를 선언적으로 관리한다.

---

## 부록: 시험 정보 요약

| 항목 | 내용 |
|------|------|
| 시험 이름 | Kubernetes and Cloud Native Associate (KCNA) |
| 출제 기관 | CNCF / Linux Foundation |
| 문항 수 | 60문항 (객관식) |
| 합격 기준 | 75% 이상 |
| 시험 시간 | 90분 |
| 시험 형식 | 온라인 감독(proctored) 시험 |
| 유효 기간 | 3년 |
| 시험 언어 | 영어, 일본어, 중국어 등 |
| 비용 | USD $250 (1회 재시험 포함) |
| 선수 조건 | 없음 |

KCNA는 K8s 및 클라우드 네이티브 생태계에 대한 기초 지식을 평가하는 자격증이다. CKA, CKAD, CKS와 같은 상위 자격증을 준비하기 위한 첫 단계로 적합하다.
