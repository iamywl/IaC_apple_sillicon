# KCNA Day 3: 핵심 오브젝트 Part 1 - Pod, Deployment, Service, DaemonSet, StatefulSet, Job/CronJob

> 학습 목표: K8s 핵심 워크로드 리소스(Pod, Deployment, Service, DaemonSet, StatefulSet, Job, CronJob)를 완벽히 이해한다.
> 예상 소요 시간: 60분 (개념 40분 + YAML 분석 20분)
> 시험 도메인: Kubernetes Fundamentals (46%) - Part 3
> 난이도: ★★★★★ (KCNA 시험의 핵심 중 핵심)

---

## 오늘의 학습 목표

- Pod, Deployment, Service의 관계를 완벽히 설명할 수 있다
- DaemonSet, StatefulSet, Job, CronJob의 차이와 사용 사례를 이해한다
- 각 오브젝트의 YAML 구조를 읽고 필드의 의미를 설명할 수 있다
- 배포 전략(RollingUpdate vs Recreate)의 차이를 이해한다

---

## 1. Kubernetes 오브젝트 개요

### 1.0 등장 배경

컨테이너 하나를 실행하는 것은 `docker run` 한 줄이면 된다. 그러나 프로덕션 환경에서는 단일 컨테이너가 아니라 수십~수백 개의 서로 연관된 컨테이너를 조율해야 한다. 기존 Docker Compose는 단일 호스트에서만 동작했고, 장애 자동 복구, 스케일링, 롤백 등의 기능이 없었다. Kubernetes는 이를 해결하기 위해 모든 인프라 구성요소를 선언적 오브젝트(Object)로 추상화했다. 사용자는 YAML로 원하는 상태를 선언하고, Controller가 현재 상태를 자동으로 수렴시키는 구조이다. 이 추상화 덕분에 Pod, Deployment, Service, PV 등 다양한 리소스를 일관된 방식(kubectl apply -f)으로 관리할 수 있다.

### 1.1 오브젝트란 무엇인가?

> **Kubernetes 오브젝트**란?
> 클러스터의 **원하는 상태(Desired State)**를 표현하는 영구 엔티티(entity)이다. 오브젝트를 생성하면 K8s 시스템이 해당 오브젝트가 존재하도록 지속적으로 작업한다.

모든 K8s 오브젝트는 두 가지 핵심 정보를 포함한다:

- **spec (원하는 상태)**: 사용자가 기술하는 "이렇게 되었으면 좋겠다"
- **status (현재 상태)**: K8s 시스템이 관리하는 "현재 이렇다"

### 1.2 오브젝트 분류

```
Kubernetes 오브젝트 분류
============================================================

워크로드 리소스 (앱 실행)
├── Pod              - 가장 작은 배포 단위
├── Deployment       - 상태 비저장(Stateless) 앱 관리
├── ReplicaSet       - Pod 복제본 관리 (보통 직접 사용 안 함)
├── StatefulSet      - 상태 유지(Stateful) 앱 관리
├── DaemonSet        - 모든 노드에 Pod 하나씩
├── Job              - 일회성 작업
└── CronJob          - 주기적 작업

서비스/네트워킹 리소스
├── Service          - 안정적 네트워크 엔드포인트
├── Ingress          - HTTP/HTTPS 라우팅
├── NetworkPolicy    - 네트워크 접근 제어
└── Endpoints        - Service와 Pod IP 매핑

설정/스토리지 리소스
├── ConfigMap        - 비기밀 설정 데이터
├── Secret           - 민감한 데이터 (비밀번호 등)
├── PersistentVolume (PV)        - 클러스터 수준 스토리지
├── PersistentVolumeClaim (PVC)  - PV 요청
└── StorageClass     - 동적 PV 프로비저닝 정의

클러스터 리소스
├── Namespace        - 가상 클러스터 분리
├── Node             - 워커 노드
├── ServiceAccount   - Pod의 API 인증 계정
├── Role / ClusterRole           - 권한 정의
├── RoleBinding / ClusterRoleBinding  - 권한 바인딩
└── ResourceQuota    - 네임스페이스 리소스 제한
```

### 1.3 워크로드 리소스 계층 구조

```
Deployment (배포 관리)
  |
  +---> ReplicaSet (복제본 관리, Deployment가 자동 생성)
          |
          +---> Pod (가장 작은 단위)
                  |
                  +---> Container(s) (실제 실행되는 프로세스)
                  |
                  +---> Volume(s) (데이터 저장 공간, 선택)

각 리소스의 제어 관계:
- Deployment = 상위 컨트롤러 (롤링 업데이트/롤백 전략 관리, ReplicaSet 생명주기 제어)
- ReplicaSet = 중간 컨트롤러 (Desired replicas 수 유지, Pod 생성/삭제 수행)
- Pod = 최소 스케줄링 단위 (공유 네트워크/볼륨을 가진 컨테이너 그룹)
- Container = 실행 프로세스 (Linux namespace/cgroups로 격리된 프로세스)
```

---

## 2. Pod - 가장 작은 배포 단위

### 2.1 Pod 개념

> **Pod(파드)**란?
> Kubernetes에서 생성, 스케줄링, 관리할 수 있는 **가장 작은 배포 단위**이다. 하나 이상의 컨테이너를 포함하며, 같은 Pod 내 컨테이너는 네트워크와 스토리지를 공유한다.

```
Pod 내부 구조
============================================================

+------------------------------------------+
|              Pod (고유 IP: 10.244.1.5)    |
|                                          |
|  +---------------+  +---------------+    |
|  | Container 1   |  | Container 2   |    |
|  | (nginx)       |  | (log-agent)   |    |
|  | Port: 80      |  | Port: 9090    |    |
|  +-------+-------+  +-------+-------+    |
|          |                   |            |
|          +---localhost-------+            |
|          (같은 네트워크 네임스페이스 공유)   |
|                                          |
|  +------------------------------------+  |
|  |         Shared Volume              |  |
|  |     (두 컨테이너가 공유하는 저장소)   |  |
|  +------------------------------------+  |
+------------------------------------------+

핵심 포인트:
- Pod 내 컨테이너는 같은 IP를 공유한다
- 컨테이너 간 localhost로 통신 가능하다
- 볼륨을 공유하여 파일을 교환할 수 있다
- 각 컨테이너는 서로 다른 포트를 사용해야 한다
```

> **기술 원리:** Pod 내 컨테이너들은 동일한 Linux Network Namespace를 공유하므로 같은 IP 주소를 갖고 localhost(127.0.0.1)로 상호 통신할 수 있다. 또한 공유 Volume을 통해 파일시스템 레벨의 데이터 교환이 가능하다. 단, 같은 Network Namespace 내에서 동일 포트 바인딩은 불가하므로 각 컨테이너는 서로 다른 포트를 사용해야 한다.

### 2.2 Pod YAML 상세 분석

```yaml
# Pod 매니페스트 상세 분석
apiVersion: v1                 # API 버전
kind: Pod                      # 리소스 종류: Pod
metadata:                      # 메타데이터 섹션
  name: web-server             # Pod의 고유 이름 (네임스페이스 내 유일)
  namespace: default           # 소속 네임스페이스 (생략 시 default)
  labels:                      # 라벨: 오브젝트 식별 및 선택에 사용
    app: web                   # key=app, value=web
    environment: dev           # key=environment, value=dev
spec:                          # 원하는 상태(Desired State) 기술
  containers:
  - name: nginx                # 컨테이너 이름 (Pod 내 유일)
    image: nginx:1.25          # 컨테이너 이미지
    ports:
    - containerPort: 80        # 컨테이너가 수신하는 포트
    env:
    - name: APP_ENV            # 환경 변수 이름
      value: "production"      # 직접 값 지정
    resources:
      requests:                # 최소 보장 리소스 (스케줄링 기준)
        cpu: "100m"            # 100밀리코어 = 0.1 CPU 코어
        memory: "128Mi"        # 128 메비바이트
      limits:                  # 최대 사용 가능 리소스
        cpu: "500m"            # 500밀리코어 = 0.5 CPU 코어
        memory: "256Mi"        # 256 메비바이트
    livenessProbe:
      httpGet:
        path: /healthz
        port: 80
      initialDelaySeconds: 10
      periodSeconds: 10
    readinessProbe:
      httpGet:
        path: /ready
        port: 80
      initialDelaySeconds: 5
      periodSeconds: 5
  initContainers:
  - name: init-db-check        # 앱 컨테이너 시작 전 실행
    image: busybox:1.36
    command: ['sh', '-c', 'until nc -z db-service 5432; do echo waiting for db; sleep 2; done']
  restartPolicy: Always        # 재시작 정책: Always(기본), OnFailure, Never
```

> **리소스 단위 설명:**
> - CPU: `1` = 1코어, `100m` = 0.1코어 (m = 밀리코어, 1000m = 1코어)
> - 메모리: `128Mi` = 128 메비바이트 (Mi = 2^20 바이트), `1Gi` = 1 기비바이트
> - requests: 스케줄러가 노드를 선택할 때 사용하는 최소 보장 리소스
> - limits: 이 값을 초과하면 CPU는 쓰로틀링, 메모리는 OOMKill

### 2.3 Pod 생명주기 상태 (Phase)

```
Pod 생명주기
============================================================

  +----------+     +----------+     +-----------+
  | Pending  |---->| Running  |---->| Succeeded |
  +----------+     +----+-----+     +-----------+
       |                |
       |                +---------->+-----------+
       |                            |  Failed   |
       +--------------------------->+-----------+
       |
       +--------------------------->+-----------+
                                    |  Unknown  |
                                    +-----------+
```

| Phase | 설명 | 원인 예시 |
|-------|------|----------|
| **Pending** | 스케줄링 대기 또는 이미지 다운로드 중 | 리소스 부족, 이미지 pull 중 |
| **Running** | 최소 하나의 컨테이너가 실행 중 | 정상 동작 |
| **Succeeded** | 모든 컨테이너가 성공적으로 종료 (종료 코드 0) | Job 완료 |
| **Failed** | 하나 이상의 컨테이너가 실패로 종료 (종료 코드 != 0) | 앱 크래시 |
| **Unknown** | 노드와 통신 불가로 상태 확인 불가 | 네트워크 단절, 노드 장애 |

### 2.4 멀티컨테이너 Pod 패턴 (시험 빈출!)

> 하나의 Pod에 여러 컨테이너를 넣는 이유는? **밀접하게 관련된 작업을 함께 수행**하기 위해서이다.

```
멀티컨테이너 패턴 비교
============================================================

1. Sidecar 패턴 (가장 일반적)
역할: 메인 앱을 보조하는 부가 기능 제공
예시: 로그 수집기, 모니터링 에이전트, Istio 프록시

2. Ambassador 패턴
역할: 메인 앱의 네트워크 연결을 대리(proxy)
예시: DB 프록시, API 게이트웨이 프록시

3. Adapter 패턴
역할: 메인 앱의 출력을 표준 형식으로 변환
예시: 로그 형식 변환, 메트릭 형식 변환
```

### 2.5 Init Container (초기화 컨테이너)

> **Init Container**란?
> 앱 컨테이너가 시작되기 **전에** 순차적으로 실행되는 특수 컨테이너이다. 모든 Init Container가 성공적으로 완료되어야 앱 컨테이너가 시작된다.

```yaml
# Init Container 사용 예제
apiVersion: v1
kind: Pod
metadata:
  name: app-with-init
spec:
  initContainers:
  - name: wait-for-db
    image: busybox:1.36
    command: ['sh', '-c', 'until nc -z postgres-svc 5432; do echo "Waiting for DB..."; sleep 2; done']
  - name: download-config
    image: busybox:1.36
    command: ['wget', '-O', '/config/app.conf', 'http://config-server/app.conf']
    volumeMounts:
    - name: config
      mountPath: /config
  containers:
  - name: app
    image: my-app:1.0
    volumeMounts:
    - name: config
      mountPath: /config
  volumes:
  - name: config
    emptyDir: {}
```

---

## 3. Deployment - 상태 비저장 앱 관리

### 3.1 Deployment 개념

> **Deployment**란?
> **상태 비저장(Stateless) 애플리케이션**을 배포하고 관리하는 가장 일반적인 K8s 리소스이다. 내부적으로 ReplicaSet을 생성하여 Pod 복제본 수를 관리하며, 롤링 업데이트와 롤백 기능을 제공한다.

### 3.2 Deployment YAML 상세 분석

```yaml
apiVersion: apps/v1            # API 그룹: apps, 버전: v1
kind: Deployment               # 리소스 종류: Deployment
metadata:
  name: nginx-web              # Deployment 이름
  namespace: demo
spec:
  replicas: 3                  # 항상 3개의 Pod를 유지
  selector:                    # 이 Deployment가 관리할 Pod를 선택하는 기준
    matchLabels:
      app: nginx-web           # 반드시 template.metadata.labels와 일치해야 함!
  strategy:
    type: RollingUpdate        # 전략 유형: RollingUpdate (기본) 또는 Recreate
    rollingUpdate:
      maxSurge: 1              # 업데이트 중 추가로 생성할 수 있는 최대 Pod 수
      maxUnavailable: 0        # 업데이트 중 사용 불가능한 최대 Pod 수
  revisionHistoryLimit: 10     # 롤백을 위해 보관할 ReplicaSet 수 (기본 10)
  template:                    # Pod 정의
    metadata:
      labels:
        app: nginx-web         # 반드시 selector.matchLabels와 일치!
    spec:
      containers:
      - name: nginx
        image: nginx:1.25.3
        ports:
        - containerPort: 80
        resources:
          requests:
            cpu: 50m
            memory: 64Mi
          limits:
            cpu: 200m
            memory: 128Mi
```

### 3.3 배포 전략 비교

```
RollingUpdate vs Recreate
============================================================

RollingUpdate (기본값) - 무중단 배포
---------------------------------------------
시작:  [v1] [v1] [v1]          ← 3개 Pod v1
단계1: [v1] [v1] [v1] [v2]    ← v2 1개 추가 (maxSurge=1)
단계2: [v1] [v1] [v2] [v2]    ← v1 1개 제거, v2 1개 추가
단계3: [v1] [v2] [v2] [v2]    ← v1 1개 제거, v2 1개 추가
단계4: [v2] [v2] [v2]         ← 완료! 다운타임 없음

Recreate - 일시적 다운타임 발생
---------------------------------------------
시작:  [v1] [v1] [v1]          ← 3개 Pod v1
단계1: [ ] [ ] [ ]              ← 모든 v1 삭제 (다운타임!)
단계2: [v2] [v2] [v2]          ← 3개 Pod v2 생성

언제 Recreate를 사용하는가?
- 두 버전이 동시에 실행되면 안 되는 경우 (DB 스키마 변경 등)
- 리소스 제약이 심해 추가 Pod를 만들 수 없는 경우
```

### 3.4 롤백 동작 원리

```
Deployment 롤백 원리 (ReplicaSet 보관)
============================================================

초기 배포 (nginx:1.24):
  Deployment → ReplicaSet-A (replicas: 3) → Pod-1, Pod-2, Pod-3

업데이트 (nginx:1.25):
  Deployment → ReplicaSet-A (replicas: 0, 보관)  ← 이전 버전
             → ReplicaSet-B (replicas: 3) → Pod-4, Pod-5, Pod-6  ← 현재

롤백 실행 (kubectl rollout undo):
  Deployment → ReplicaSet-A (replicas: 3) → Pod-7, Pod-8, Pod-9  ← 복원!
             → ReplicaSet-B (replicas: 0, 보관)

핵심: Deployment는 이전 ReplicaSet을 삭제하지 않고 보관한다!
      revisionHistoryLimit으로 보관 수를 설정한다.
```

---

## 4. Service - 안정적인 네트워크 엔드포인트

### 4.1 Service가 필요한 이유

> **Service**란?
> Pod 집합에 대한 **안정적인 네트워크 엔드포인트(IP와 DNS)**를 제공하는 리소스이다. Pod는 재시작될 때마다 IP가 변하지만, Service의 IP(ClusterIP)는 변하지 않는다.

### 4.2 Service 유형별 YAML과 동작

```yaml
# 1. ClusterIP Service (기본값) - 클러스터 내부만 접근 가능
apiVersion: v1
kind: Service
metadata:
  name: backend-svc
spec:
  type: ClusterIP
  selector:
    app: backend
  ports:
  - port: 80
    targetPort: 8080

---
# 2. NodePort Service - 외부에서 노드IP:포트로 접근 가능
apiVersion: v1
kind: Service
metadata:
  name: nginx-web
spec:
  type: NodePort
  selector:
    app: nginx-web
  ports:
  - port: 80
    targetPort: 80
    nodePort: 30080            # 외부 접근 포트 (30000-32767 범위)

---
# 3. LoadBalancer Service - 클라우드 LB를 자동 생성
apiVersion: v1
kind: Service
metadata:
  name: web-public
spec:
  type: LoadBalancer
  selector:
    app: web
  ports:
  - port: 443
    targetPort: 8443

---
# 4. ExternalName Service - 외부 서비스를 CNAME으로 매핑
apiVersion: v1
kind: Service
metadata:
  name: external-db
spec:
  type: ExternalName
  externalName: database.example.com

---
# 5. Headless Service - 개별 Pod DNS 제공 (StatefulSet용)
apiVersion: v1
kind: Service
metadata:
  name: mysql-headless
spec:
  clusterIP: None              # 핵심! ClusterIP를 할당하지 않음
  selector:
    app: mysql
  ports:
  - port: 3306
    targetPort: 3306
```

### 4.3 Service 유형 비교표

| 유형 | 접근 범위 | 포트 범위 | 사용 시나리오 |
|------|----------|----------|-------------|
| **ClusterIP** (기본) | 클러스터 내부만 | 1-65535 | 내부 서비스 간 통신 |
| **NodePort** | 외부 (노드IP:포트) | 30000-32767 | 개발/테스트 |
| **LoadBalancer** | 외부 (LB IP) | 1-65535 | 프로덕션 외부 노출 |
| **ExternalName** | CNAME 리다이렉션 | - | 외부 서비스 매핑 |
| **Headless** | 개별 Pod DNS | - | StatefulSet |

### 4.4 Service DNS 체계

```
Service DNS 형식
============================================================

전체 FQDN: <서비스명>.<네임스페이스>.svc.cluster.local

예시: nginx-web.demo.svc.cluster.local

단축 형태 (같은 네임스페이스 내): nginx-web
단축 형태 (다른 네임스페이스): nginx-web.demo

Headless Service의 Pod DNS:
<Pod명>.<서비스명>.<네임스페이스>.svc.cluster.local
예: mysql-0.mysql-headless.database.svc.cluster.local
```

---

## 5. DaemonSet - 모든 노드에 하나씩

### 5.1 DaemonSet 개념

> **DaemonSet**이란?
> 모든(또는 특정) 노드에 **Pod를 정확히 하나씩** 실행하도록 보장하는 리소스이다. 새 노드가 추가되면 자동으로 Pod가 배치되고, 노드가 제거되면 Pod가 삭제된다.

### 5.2 DaemonSet YAML 예제

```yaml
apiVersion: apps/v1
kind: DaemonSet                # Deployment가 아닌 DaemonSet
metadata:
  name: fluentd-agent
  namespace: kube-system
spec:
  selector:
    matchLabels:
      app: fluentd
  template:
    metadata:
      labels:
        app: fluentd
    spec:
      tolerations:
      - key: node-role.kubernetes.io/control-plane
        effect: NoSchedule       # Control Plane 노드에도 배치 허용
      containers:
      - name: fluentd
        image: fluent/fluentd:v1.16
        resources:
          requests:
            cpu: 50m
            memory: 100Mi
        volumeMounts:
        - name: varlog
          mountPath: /var/log
      volumes:
      - name: varlog
        hostPath:
          path: /var/log
  # DaemonSet은 replicas 필드가 없다! (노드 수만큼 자동)
```

**DaemonSet 사용 사례:**
- **로그 수집**: Fluentd, Fluent Bit, Filebeat
- **모니터링**: Prometheus Node Exporter, Datadog Agent
- **네트워크**: Cilium, Calico, kube-proxy
- **스토리지**: Ceph, GlusterFS 에이전트

---

## 6. StatefulSet - 상태 유지 앱 관리

### 6.1 StatefulSet 개념

> **StatefulSet**이란?
> 데이터베이스, 메시지 큐 같은 **상태를 유지해야 하는(Stateful) 애플리케이션**을 관리하는 리소스이다. Deployment와 달리 Pod의 이름, 네트워크 ID, 스토리지가 고유하고 안정적이다.

### 6.2 Deployment vs StatefulSet 비교

| 특성 | Deployment | StatefulSet |
|------|-----------|-------------|
| **Pod 이름** | 랜덤 (nginx-abc123) | 순서 번호 (mysql-0, mysql-1, mysql-2) |
| **네트워크 ID** | 변경 가능 | **안정적** (재시작해도 동일 DNS) |
| **스토리지** | 공유 가능 | **각 Pod마다 고유 PV** |
| **생성 순서** | 동시 | **0번부터 순차적** |
| **삭제 순서** | 동시 | **역순** (2 → 1 → 0) |
| **Headless Service** | 선택 | **필수** |
| **사용 사례** | 웹 서버, API 서버 | DB, Kafka, ZooKeeper |

### 6.3 StatefulSet YAML 예제

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: mysql
  namespace: database
spec:
  serviceName: mysql-headless   # 필수! Headless Service 이름
  replicas: 3
  selector:
    matchLabels:
      app: mysql
  template:
    metadata:
      labels:
        app: mysql
    spec:
      containers:
      - name: mysql
        image: mysql:8.0
        ports:
        - containerPort: 3306
        volumeMounts:
        - name: mysql-data
          mountPath: /var/lib/mysql
  volumeClaimTemplates:
  - metadata:
      name: mysql-data
    spec:
      accessModes: ["ReadWriteOnce"]
      storageClassName: standard
      resources:
        requests:
          storage: 10Gi
  # 결과:
  # mysql-0 → PVC: mysql-data-mysql-0 → PV (10Gi)
  # mysql-1 → PVC: mysql-data-mysql-1 → PV (10Gi)
  # mysql-2 → PVC: mysql-data-mysql-2 → PV (10Gi)
```

---

## 7. Job & CronJob

### 7.1 Job - 일회성 작업

> **Job**이란?
> 지정된 수의 Pod가 **성공적으로 완료될 때까지** 실행하는 리소스이다. 배치 처리, 데이터 마이그레이션 등 일회성 작업에 사용한다.

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: db-migration
spec:
  completions: 1                # 성공 완료해야 하는 Pod 수
  parallelism: 1                # 동시 실행할 Pod 수
  backoffLimit: 3               # 최대 재시도 횟수
  activeDeadlineSeconds: 300    # 최대 실행 시간 (초)
  ttlSecondsAfterFinished: 100  # 완료 후 100초 뒤 자동 삭제
  template:
    spec:
      containers:
      - name: migration
        image: my-app/migration:1.0
        command: ["python", "migrate.py"]
      restartPolicy: Never      # Job에서는 Never 또는 OnFailure만 허용!
                                # Always는 사용 불가! (시험 빈출!)
```

### 7.2 CronJob - 주기적 작업

> **CronJob**이란?
> Unix cron과 동일한 스케줄 형식으로 **주기적으로 Job을 생성**하는 리소스이다.

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: db-backup
spec:
  schedule: "0 2 * * *"         # cron 형식: 매일 02:00에 실행
  concurrencyPolicy: Forbid     # 이전 Job 실행 중이면 새 Job 건너뜀
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 1
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: backup
            image: postgres:15
            command: ["pg_dump", "-h", "postgres-svc", "-U", "admin", "mydb"]
          restartPolicy: OnFailure
```

**Cron 스케줄 형식:**
```
┌───────── 분 (0-59)
│ ┌─────── 시 (0-23)
│ │ ┌───── 일 (1-31)
│ │ │ ┌─── 월 (1-12)
│ │ │ │ ┌─ 요일 (0-6, 일=0)
│ │ │ │ │
* * * * *

예시:
"0 2 * * *"       매일 02:00
"*/5 * * * *"     5분마다
"0 0 1 * *"       매월 1일 00:00
"0 9 * * 1-5"     평일 09:00
```

**concurrencyPolicy 옵션:**
| 정책 | 동작 |
|------|------|
| **Allow** (기본) | 이전 Job과 동시 실행 허용 |
| **Forbid** | 이전 Job 실행 중이면 새 Job 건너뜀 |
| **Replace** | 이전 Job 취소하고 새 Job으로 대체 |

---

## tart-infra 실습

### 실습 환경 설정

```bash
# dev 클러스터 접속 (다양한 워크로드 오브젝트 확인용)
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/dev.yaml

# demo 네임스페이스의 전체 리소스 확인
kubectl get all -n demo
```

### 실습 1: Pod, Deployment, Service 관계 분석

demo 네임스페이스의 nginx를 통해 Deployment → ReplicaSet → Pod 계층 구조와 Service 연결을 확인한다.

```bash
# Deployment 확인
kubectl get deployment -n demo nginx -o wide
```

검증:

```text
NAME    READY   UP-TO-DATE   AVAILABLE   AGE   CONTAINERS   IMAGES        SELECTOR
nginx   1/1     1            1           7d    nginx        nginx:1.25    app=nginx
```

```bash
# Deployment가 관리하는 ReplicaSet 확인
kubectl get replicaset -n demo -l app=nginx
```

검증:

```text
NAME              DESIRED   CURRENT   READY   AGE
nginx-5d5dd5f7f   1         1         1       7d
```

```bash
# ReplicaSet이 관리하는 Pod 확인
kubectl get pods -n demo -l app=nginx -o wide
```

검증:

```text
NAME                    READY   STATUS    RESTARTS   AGE   IP           NODE
nginx-5d5dd5f7f-abc12   1/1     Running   0          7d    10.244.1.5   dev-worker
```

```bash
# Service와 Endpoints 매핑 확인
kubectl get svc -n demo nginx
kubectl get endpoints -n demo nginx
```

검증:

```text
NAME    ENDPOINTS          AGE
nginx   10.244.1.5:80      7d
```

**동작 원리:** Deployment가 ReplicaSet을 생성하고, ReplicaSet이 Pod를 관리한다. Service는 Label Selector(`app=nginx`)로 Pod를 찾아 Endpoints에 등록한다. Pod IP가 변경되어도 Service의 ClusterIP는 고정이므로 안정적인 접근이 가능하다.

### 실습 2: DaemonSet과 StatefulSet 비교

```bash
# platform 클러스터에서 DaemonSet 확인 (모든 노드에 하나씩)
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/platform.yaml
kubectl get daemonset -A

# dev 클러스터에서 StatefulSet 확인 (순서 보장, 고유 이름)
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/dev.yaml
kubectl get statefulset -n demo

# StatefulSet Pod 이름 패턴 확인 (pod-0, pod-1 순서)
kubectl get pods -n demo -l app=postgresql

# 예상 출력:
# NAME             READY   STATUS    RESTARTS   AGE
# postgresql-0     1/1     Running   0          7d
```

**동작 원리:** DaemonSet은 replicas 필드 없이 모든 노드에 Pod를 하나씩 배치한다. StatefulSet은 Pod에 순서가 있는 고유 이름(pod-0, pod-1)을 부여하고, PVC도 각 Pod별로 독립 생성된다. 이것이 PostgreSQL 같은 상태 유지 앱에 StatefulSet을 사용하는 이유이다.

### 실습 3: Service 유형 비교

```bash
# ClusterIP vs NodePort 서비스 확인
kubectl get svc -n demo -o wide

# NodePort 범위(30000-32767) 확인
kubectl get svc -n demo -o custom-columns=NAME:.metadata.name,TYPE:.spec.type,CLUSTER-IP:.spec.clusterIP,PORT:.spec.ports[0].port,NODEPORT:.spec.ports[0].nodePort

# Service DNS 형식 확인 (서비스명.네임스페이스.svc.cluster.local)
kubectl run dns-test --image=busybox --rm -it --restart=Never -n demo -- nslookup nginx.demo.svc.cluster.local
```

**동작 원리:** ClusterIP는 클러스터 내부에서만 접근 가능한 가상 IP를 할당한다. NodePort는 모든 노드의 지정 포트(30000-32767)로 외부 트래픽을 받아 ClusterIP로 전달한다. DNS 조회 결과는 CoreDNS가 `<서비스명>.<네임스페이스>.svc.cluster.local` 형식으로 반환한다.

---

## 트러블슈팅

### Pod가 CrashLoopBackOff 상태일 때

```
디버깅 순서:
  1. Pod 로그 확인
     $ kubectl logs <pod-name> -n <namespace>
     $ kubectl logs <pod-name> -n <namespace> --previous  # 이전 크래시 로그
  2. Pod 이벤트 확인
     $ kubectl describe pod <pod-name> -n <namespace>
  3. 흔한 원인:
     - 앱 코드 오류 (Exit Code 1)
     - 설정 파일 누락 (ConfigMap/Secret 마운트 오류)
     - DB 연결 실패 (Init Container 미사용)
     - 메모리 부족 (OOMKilled, Exit Code 137)
     - 잘못된 command/args 지정
  4. Exit Code 해석:
     - 0: 정상 종료
     - 1: 일반 에러
     - 137: OOMKilled (128 + SIGKILL=9)
     - 143: SIGTERM (128 + SIGTERM=15)
```

### Service Endpoints가 비어 있을 때

```
증상: Service에 접근해도 응답이 없다
  $ kubectl get endpoints <svc-name> -n <namespace>
  → ENDPOINTS 컬럼이 <none>으로 표시된다

원인 분석:
  1. Service의 selector와 Pod의 labels가 불일치한다
     $ kubectl get svc <svc-name> -n <namespace> -o yaml | grep -A3 selector
     $ kubectl get pods -n <namespace> --show-labels
  2. Pod가 Ready 상태가 아니다 (Readiness Probe 실패)
  3. Pod가 존재하지 않는다

핵심: Service는 Label Selector로 Pod를 선택한다.
     라벨이 한 글자라도 다르면 연결되지 않는다.
```

---

## 복습 체크리스트

- [ ] Pod가 K8s의 가장 작은 배포 단위임을 기억한다 (Container가 아님!)
- [ ] Pod 생명주기 5가지 Phase: Pending, Running, Succeeded, Failed, Unknown
- [ ] 멀티컨테이너 Pod 패턴 3가지: Sidecar(보조), Ambassador(네트워크 대리), Adapter(출력 변환)
- [ ] Init Container: 앱 컨테이너 전에 순차 실행, 모두 성공해야 앱 시작
- [ ] Deployment → ReplicaSet → Pod 계층 구조를 이해한다
- [ ] 배포 전략: RollingUpdate(기본, 무중단) vs Recreate(다운타임)
- [ ] maxSurge와 maxUnavailable의 의미를 설명할 수 있다
- [ ] 5가지 Service 유형(ClusterIP, NodePort, LoadBalancer, ExternalName, Headless)
- [ ] NodePort 범위: 30000-32767
- [ ] Service DNS: `<서비스명>.<네임스페이스>.svc.cluster.local`
- [ ] DaemonSet = 모든 노드에 하나씩 (replicas 필드 없음)
- [ ] StatefulSet = 순서, 고유 이름, 고유 스토리지, Headless Service 필수
- [ ] Job의 restartPolicy: Never 또는 OnFailure만 (Always 불가!)
- [ ] CronJob concurrencyPolicy: Allow(기본), Forbid, Replace

---

## 내일 학습 예고

> Day 4에서는 핵심 오브젝트 Part 2를 학습한다. ConfigMap/Secret, Namespace, Label/Selector/Annotation, RBAC, Ingress, PV/PVC의 개념과 YAML 구조를 다루고, 20문제 모의시험으로 점검한다.
