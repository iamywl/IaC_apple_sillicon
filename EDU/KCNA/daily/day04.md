# KCNA Day 4: 핵심 오브젝트 Part 2 - ConfigMap, Secret, Namespace, RBAC, Ingress, PV/PVC

> 학습 목표: K8s 설정, 보안, 네트워킹, 스토리지 관련 핵심 오브젝트를 이해하고 YAML 구조를 분석한다.
> 예상 소요 시간: 60분 (개념 40분 + YAML 분석 20분)
> 시험 도메인: Kubernetes Fundamentals (46%) - Part 4
> 난이도: ★★★★★ (KCNA 시험의 핵심 중 핵심)

---

## 오늘의 학습 목표

- ConfigMap과 Secret의 차이를 설명하고 YAML을 작성할 수 있다
- Namespace의 역할과 기본 네임스페이스 4가지를 안다
- Label, Selector, Annotation의 차이를 설명할 수 있다
- RBAC(Role, ClusterRole, RoleBinding, ClusterRoleBinding)을 이해한다
- Ingress의 동작 원리와 Ingress Controller의 필요성을 안다
- PV, PVC, StorageClass의 관계를 설명할 수 있다

---

## 1. ConfigMap - 비기밀 설정 데이터

### 1.1 ConfigMap 개념

> **ConfigMap**이란?
> 컨테이너에 전달할 **비기밀(non-confidential) 설정 데이터**를 키-값 쌍으로 저장하는 K8s 오브젝트이다. 환경 변수, 설정 파일, 명령줄 인자 등을 컨테이너 이미지와 분리하여 관리한다.

### 1.2 ConfigMap YAML 예제

```yaml
# ConfigMap 생성
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
  namespace: demo
data:
  # 단순 키-값
  DATABASE_HOST: "postgres-svc"
  DATABASE_PORT: "5432"
  LOG_LEVEL: "info"

  # 파일 형태 데이터
  nginx.conf: |
    server {
      listen 80;
      server_name localhost;
      location / {
        root /usr/share/nginx/html;
        index index.html;
      }
    }
```

### 1.3 ConfigMap 사용 방법

```yaml
# Pod에서 ConfigMap 사용
apiVersion: v1
kind: Pod
metadata:
  name: app
spec:
  containers:
  - name: app
    image: my-app:1.0
    # 방법 1: 환경 변수로 주입
    envFrom:
    - configMapRef:
        name: app-config           # ConfigMap의 모든 키를 환경 변수로
    # 방법 2: 특정 키만 환경 변수로
    env:
    - name: DB_HOST
      valueFrom:
        configMapKeyRef:
          name: app-config
          key: DATABASE_HOST
    # 방법 3: 볼륨으로 마운트 (파일)
    volumeMounts:
    - name: config-volume
      mountPath: /etc/nginx/conf.d
  volumes:
  - name: config-volume
    configMap:
      name: app-config
      items:
      - key: nginx.conf
        path: default.conf         # /etc/nginx/conf.d/default.conf로 마운트
```

### 1.4 ConfigMap 변경 반영 (시험 빈출!)

```
ConfigMap 변경 시 반영 방식
============================================================

볼륨 마운트: 자동 반영 (kubelet sync 주기, 약 1분 지연)
환경 변수:   Pod 재시작 필요 (프로세스 시작 시 설정됨)

핵심:
- 볼륨 = 자동 반영
- 환경 변수 = Pod 재시작 필요
```

---

## 2. Secret - 기밀 데이터

### 2.1 Secret 개념

> **Secret**이란?
> 비밀번호, API 키, TLS 인증서 등 **기밀(confidential) 데이터**를 저장하는 K8s 오브젝트이다. ConfigMap과 유사하지만 데이터가 **Base64 인코딩**되어 저장된다.

### 2.2 Secret YAML 예제

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: db-credentials
  namespace: demo
type: Opaque                       # 범용 Secret 타입
data:
  # Base64 인코딩된 값
  username: YWRtaW4=               # echo -n 'admin' | base64
  password: cGFzc3dvcmQxMjM=       # echo -n 'password123' | base64

---
# stringData로 평문 입력 가능 (저장 시 자동 Base64 인코딩)
apiVersion: v1
kind: Secret
metadata:
  name: db-credentials-plain
type: Opaque
stringData:
  username: admin
  password: password123
```

### 2.3 Secret 유형

| 유형 | 설명 | 사용 사례 |
|------|------|----------|
| **Opaque** (기본) | 범용 키-값 데이터 | DB 비밀번호, API 키 |
| **kubernetes.io/tls** | TLS 인증서와 키 | HTTPS 인증서 |
| **kubernetes.io/dockerconfigjson** | 도커 레지스트리 인증 정보 | 프라이빗 레지스트리 |
| **kubernetes.io/service-account-token** | ServiceAccount 토큰 | API 인증 |

### 2.4 Secret 보안 주의사항 (시험 빈출!)

```
Secret 보안 특성
============================================================

1. Base64 인코딩 ≠ 암호화!
   - Base64는 누구나 디코딩 가능 (echo 'YWRtaW4=' | base64 -d → admin)
   - 진정한 암호화를 위해서는 별도 설정 필요

2. etcd에서의 암호화:
   - 기본: 평문(Base64)으로 저장
   - EncryptionConfiguration으로 AES-256 암호화 가능
   - 외부 시크릿 관리: HashiCorp Vault, AWS Secrets Manager

3. Secret 크기 제한: 최대 1MiB

시험 포인트:
- "Secret은 암호화인가?" → 아니다! Base64 인코딩일 뿐이다!
```

---

## 3. Namespace - 가상 클러스터 분리

### 3.1 Namespace 개념

> **Namespace(네임스페이스)**란?
> 하나의 물리 클러스터를 여러 **가상 클러스터**로 논리 분리하는 메커니즘이다. 팀별, 환경별(dev/staging/prod), 프로젝트별로 리소스를 격리한다.

### 3.2 기본 Namespace (시험 빈출!)

```
K8s 기본 네임스페이스 (4개)
============================================================

1. default        - 네임스페이스 미지정 시 사용하는 기본 공간
2. kube-system    - K8s 시스템 컴포넌트용 (CoreDNS, kube-proxy 등)
3. kube-public    - 모든 사용자(인증 안 된 포함)가 읽을 수 있는 공간
4. kube-node-lease - 노드 하트비트용 Lease 오브젝트 저장

시험 포인트:
- 기본 NS는 4개: default, kube-system, kube-public, kube-node-lease
- "kube-apps"는 존재하지 않는다!
```

### 3.3 Namespace 범위 리소스 vs 클러스터 범위 리소스

| 범위 | 리소스 예시 |
|------|-----------|
| **Namespace 범위** | Pod, Deployment, Service, ConfigMap, Secret, Role, RoleBinding |
| **클러스터 범위** | Node, PersistentVolume, Namespace, ClusterRole, ClusterRoleBinding, StorageClass |

---

## 4. Label, Selector, Annotation

### 4.1 Label과 Annotation 비교 (시험 빈출!)

```
Label vs Annotation
============================================================

Label (라벨):
  - 오브젝트를 식별하고 선택(select)하는 데 사용
  - Selector로 필터링/그룹화 가능
  - 키: 63자 제한, 값: 63자 제한
  - 예: app=nginx, environment=prod, tier=frontend

Annotation (어노테이션):
  - 비식별 메타데이터를 저장
  - Selector로 선택 불가
  - 값 크기 제한이 더 넉넉 (256KB)
  - 예: 빌드 정보, 변경 이유, 외부 도구 설정

핵심: Label = Selector 가능, Annotation = Selector 불가
```

### 4.2 Selector 유형

```yaml
# 1. Equality-based Selector (등호 기반)
selector:
  matchLabels:
    app: nginx                    # app=nginx인 오브젝트 선택

# 2. Set-based Selector (집합 기반)
selector:
  matchExpressions:
  - key: environment
    operator: In                  # In, NotIn, Exists, DoesNotExist
    values:
    - production
    - staging
```

---

## 5. RBAC - 역할 기반 접근 제어

### 5.1 RBAC 개념

> **RBAC(Role-Based Access Control)**이란?
> 사용자/서비스의 K8s API 접근 권한을 **역할(Role)** 기반으로 관리하는 인가(Authorization) 메커니즘이다.

### 5.2 RBAC 4대 리소스

```
RBAC 구조
============================================================

누가(Subject)        무엇을 할 수 있는가(Role)       연결(Binding)
+----------+       +-------------------+          +-------------+
| User     |       | Role (NS 범위)     |<-------->| RoleBinding  |
| Group    |       | - pods: get,list  |          |             |
| SA       |       +-------------------+          +-------------+
+----------+
                   +-------------------+          +-------------+
                   | ClusterRole       |<-------->| ClusterRole  |
                   | (클러스터 범위)     |          | Binding      |
                   | - nodes: get,list |          |             |
                   +-------------------+          +-------------+

Role:               네임스페이스 내 권한 정의
ClusterRole:        클러스터 전체 권한 정의
RoleBinding:        Role을 Subject에 연결 (NS 범위)
ClusterRoleBinding: ClusterRole을 Subject에 연결 (클러스터 범위)
```

### 5.3 RBAC YAML 예제

```yaml
# 1. Role: demo 네임스페이스에서 Pod 조회 권한
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: pod-reader
  namespace: demo
rules:
- apiGroups: [""]                  # 핵심 API 그룹 (Pod, Service 등)
  resources: ["pods"]              # 대상 리소스
  verbs: ["get", "list", "watch"]  # 허용 동작

---
# 2. RoleBinding: dev-user에게 pod-reader Role 부여
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: read-pods
  namespace: demo
subjects:
- kind: User
  name: dev-user
  apiGroup: rbac.authorization.k8s.io
roleRef:
  kind: Role
  name: pod-reader
  apiGroup: rbac.authorization.k8s.io

---
# 3. ClusterRole: 클러스터 전체 노드 조회 권한
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: node-reader
rules:
- apiGroups: [""]
  resources: ["nodes"]
  verbs: ["get", "list", "watch"]
```

**RBAC verbs 목록:**

| Verb | 설명 | HTTP 메서드 |
|------|------|-----------|
| get | 단일 리소스 조회 | GET |
| list | 리소스 목록 조회 | GET |
| watch | 변경 감시 | GET (watch) |
| create | 리소스 생성 | POST |
| update | 리소스 수정 | PUT |
| patch | 리소스 부분 수정 | PATCH |
| delete | 리소스 삭제 | DELETE |

---

## 6. Ingress - HTTP/HTTPS 라우팅

### 6.1 Ingress 개념

> **Ingress**란?
> 클러스터 외부에서 내부 Service로의 **HTTP/HTTPS 트래픽을 라우팅**하는 규칙을 정의하는 API 오브젝트이다. 하나의 외부 IP로 여러 Service에 접근할 수 있게 한다.

### 6.2 Ingress Controller 필수! (시험 빈출!)

```
Ingress 동작 구조
============================================================

외부 트래픽
    |
    v
+-------------------+
| Ingress Controller|  ← 반드시 설치해야 함! (없으면 Ingress 무용지물)
| (nginx, traefik   |
|  등)              |
+--------+----------+
         |
         | Ingress 규칙 적용
         v
+---------+--------+---------+
|         |        |         |
v         v        v         v
Service-A Service-B Service-C Service-D
/api      /web     /admin    /docs

핵심: Ingress 리소스만으로는 동작하지 않는다!
     Ingress Controller가 반드시 필요하다!
```

### 6.3 Ingress YAML 예제

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: web-ingress
  namespace: demo
  annotations:
    nginx.ingress.kubernetes.io/rewrite-target: /
spec:
  ingressClassName: nginx          # 사용할 Ingress Controller
  rules:
  - host: app.example.com          # 호스트 기반 라우팅
    http:
      paths:
      - path: /api                 # 경로 기반 라우팅
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
  tls:                             # HTTPS 설정
  - hosts:
    - app.example.com
    secretName: tls-secret         # TLS 인증서 Secret
```

---

## 7. PersistentVolume & PersistentVolumeClaim

### 7.1 PV/PVC 개념

> **PersistentVolume(PV)**란?
> 클러스터 관리자가 프로비저닝한 **클러스터 수준의 스토리지 리소스**이다. 노드처럼 클러스터에 존재하는 리소스이다.

> **PersistentVolumeClaim(PVC)**란?
> 사용자(Pod)가 스토리지를 **요청(claim)** 하는 오브젝트이다. PVC가 생성되면 조건에 맞는 PV에 바인딩된다.

```
PV/PVC 관계
============================================================

관리자 영역:                        사용자 영역:
+-------------+                    +-------------+
| PV          | <--- 바인딩 --->  | PVC          |
| 10Gi        |                    | 10Gi 요청    |
| NFS         |                    |             |
| RWX         |                    | RWX 요청    |
+-------------+                    +------+------+
                                          |
                                   +------+------+
                                   | Pod          |
                                   | volumeMounts:|
                                   |  /data       |
                                   +-------------+

또는 StorageClass를 통한 동적 프로비저닝:
PVC 생성 → StorageClass가 자동으로 PV 생성 → 바인딩
```

### 7.2 PV/PVC YAML 예제

```yaml
# PersistentVolume
apiVersion: v1
kind: PersistentVolume
metadata:
  name: nfs-pv
spec:
  capacity:
    storage: 10Gi                  # 스토리지 크기
  accessModes:
  - ReadWriteMany                  # 접근 모드
  persistentVolumeReclaimPolicy: Retain  # 회수 정책
  nfs:
    server: 192.168.64.10
    path: /data/shared

---
# PersistentVolumeClaim
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: app-data
  namespace: demo
spec:
  accessModes:
  - ReadWriteMany
  resources:
    requests:
      storage: 10Gi
  storageClassName: ""             # 빈 문자열 = 정적 바인딩

---
# StorageClass (동적 프로비저닝)
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: fast-ssd
provisioner: kubernetes.io/aws-ebs
parameters:
  type: gp3
  fsType: ext4
volumeBindingMode: WaitForFirstConsumer  # Pod 스케줄링 시까지 바인딩 지연
reclaimPolicy: Delete
```

### 7.3 접근 모드 (Access Modes)

| 모드 | 약어 | 설명 |
|------|------|------|
| **ReadWriteOnce** | RWO | 단일 노드에서 읽기/쓰기 |
| **ReadOnlyMany** | ROX | 여러 노드에서 읽기 전용 |
| **ReadWriteMany** | RWX | 여러 노드에서 읽기/쓰기 |
| **ReadWriteOncePod** | RWOP | 단일 Pod에서만 읽기/쓰기 (K8s 1.22+) |

### 7.4 회수 정책 (Reclaim Policy) - 시험 빈출!

```
PV 회수 정책 (PVC 삭제 시 PV 처리 방식)
============================================================

Retain (보존):
  PVC 삭제 → PV 보존 (Released 상태)
  데이터 보존, 관리자가 수동으로 정리
  프로덕션에서 가장 안전

Delete (삭제):
  PVC 삭제 → PV 삭제 + 외부 스토리지도 삭제
  클라우드 환경(AWS EBS, GCE PD)의 기본값

Recycle (재사용):
  PVC 삭제 → PV의 데이터만 삭제 (rm -rf /data/*)
  ⚠️ Deprecated! 사용하지 않음
```

### 7.5 volumeBindingMode (시험 빈출!)

| 모드 | 설명 |
|------|------|
| **Immediate** (기본) | PVC 생성 즉시 PV에 바인딩 |
| **WaitForFirstConsumer** | PVC를 사용하는 Pod가 스케줄링될 때까지 바인딩 지연 |

**WaitForFirstConsumer의 장점:** Pod와 동일한 존(zone)/노드에 PV가 생성되어 데이터 접근성 보장

---

## 8. KCNA 실전 모의 문제 (15문제)

### 문제 1.
Secret의 데이터 저장 방식에 대한 설명으로 올바른 것은?

A) AES-256으로 암호화되어 etcd에 저장된다
B) Base64로 인코딩되어 저장되며, 이것만으로는 암호화가 아니다
C) SHA-256 해시로 저장된다
D) RSA로 암호화되어 저장된다

<details><summary>정답 확인</summary>

**정답: B) Base64로 인코딩되어 저장되며, 이것만으로는 암호화가 아니다**

Secret은 기본적으로 **Base64 인코딩**만 적용된다. 진정한 암호화를 위해서는 EncryptionConfiguration 또는 외부 Vault를 사용해야 한다.
</details>

---

### 문제 2.
ConfigMap이 변경되었을 때 Pod에 반영되는 방식으로 올바른 것은?

A) 환경 변수와 볼륨 마운트 모두 자동으로 즉시 반영된다
B) 볼륨 마운트는 자동 반영되지만, 환경 변수는 Pod 재시작이 필요하다
C) 환경 변수는 자동 반영되지만, 볼륨 마운트는 Pod 재시작이 필요하다
D) 둘 다 Pod 재시작이 필요하다

<details><summary>정답 확인</summary>

**정답: B) 볼륨 마운트는 자동 반영되지만, 환경 변수는 Pod 재시작이 필요하다**

볼륨으로 마운트된 ConfigMap은 kubelet의 sync 주기에 따라 자동 업데이트된다. 환경 변수로 주입된 값은 Pod 재시작이 필요하다.
</details>

---

### 문제 3.
다음 중 K8s 기본 네임스페이스가 아닌 것은?

A) default
B) kube-system
C) kube-apps
D) kube-node-lease

<details><summary>정답 확인</summary>

**정답: C) kube-apps**

기본 네임스페이스는 **default, kube-system, kube-public, kube-node-lease** 4가지이다. kube-apps는 존재하지 않는다.
</details>

---

### 문제 4.
Label과 Annotation의 차이로 올바른 것은?

A) Label은 크기 제한이 없고, Annotation은 63자 제한이 있다
B) Label은 셀렉터로 오브젝트를 선택할 수 있지만, Annotation은 할 수 없다
C) Annotation은 오브젝트를 그룹화하는 데 사용된다
D) Label과 Annotation은 동일한 기능을 한다

<details><summary>정답 확인</summary>

**정답: B) Label은 셀렉터로 오브젝트를 선택할 수 있지만, Annotation은 할 수 없다**

**Label**은 셀렉터로 선택 가능 (키/값 63자 제한). **Annotation**은 비식별 메타데이터로 셀렉터 불가 (크기 제한 넉넉).
</details>

---

### 문제 5.
RBAC에서 클러스터 전체에 적용되는 권한을 정의하는 리소스는?

A) Role
B) ClusterRole
C) RoleBinding
D) ServiceAccount

<details><summary>정답 확인</summary>

**정답: B) ClusterRole**

**ClusterRole**은 클러스터 전체 범위의 권한을 정의한다. **Role**은 특정 네임스페이스 내에서만 적용된다.
</details>

---

### 문제 6.
Ingress에 대한 설명으로 올바른 것은?

A) Ingress 리소스만 생성하면 자동으로 동작한다
B) TCP/UDP 트래픽을 모두 라우팅할 수 있다
C) Ingress Controller가 반드시 설치되어 있어야 동작한다
D) 각 서비스마다 별도의 IP가 할당된다

<details><summary>정답 확인</summary>

**정답: C) Ingress Controller가 반드시 설치되어 있어야 동작한다**

Ingress 리소스만으로는 동작하지 않으며, NGINX Ingress Controller 등의 **Ingress Controller**가 필요하다. Ingress는 주로 HTTP/HTTPS(L7)를 처리한다.
</details>

---

### 문제 7.
PersistentVolume의 회수 정책(Reclaim Policy) 중 PVC 삭제 시 PV와 데이터를 보존하는 정책은?

A) Delete
B) Retain
C) Recycle
D) Archive

<details><summary>정답 확인</summary>

**정답: B) Retain**

**Retain**은 PVC 삭제 시 PV와 데이터를 보존한다. **Delete**는 PV와 외부 스토리지를 삭제하고, **Recycle**은 deprecated, **Archive**는 존재하지 않는 정책이다.
</details>

---

### 문제 8.
StorageClass의 volumeBindingMode를 WaitForFirstConsumer로 설정하면?

A) PVC 생성 즉시 PV에 바인딩된다
B) PVC를 사용하는 Pod가 스케줄링될 때까지 바인딩을 지연한다
C) PV를 수동으로 생성해야 바인딩된다
D) 바인딩이 불가능하다

<details><summary>정답 확인</summary>

**정답: B) PVC를 사용하는 Pod가 스케줄링될 때까지 바인딩을 지연한다**

**WaitForFirstConsumer**는 Pod 스케줄링 시까지 PV 바인딩을 지연하여 Pod와 동일한 존에 PV가 생성되도록 한다.
</details>

---

### 문제 9.
다음 중 클러스터 수준 리소스(Namespace에 속하지 않는 리소스)가 아닌 것은?

A) Node
B) PersistentVolume
C) Deployment
D) Namespace

<details><summary>정답 확인</summary>

**정답: C) Deployment**

**Deployment**는 네임스페이스에 속하는 리소스이다. Node, PersistentVolume, Namespace, ClusterRole 등은 클러스터 수준 리소스이다.
</details>

---

### 문제 10.
kubectl 명령어 중 리소스의 필드 문서를 조회하는 명령어는?

A) kubectl describe
B) kubectl get -o yaml
C) kubectl explain
D) kubectl inspect

<details><summary>정답 확인</summary>

**정답: C) kubectl explain**

`kubectl explain`은 API 리소스의 필드에 대한 문서를 조회한다. 예: `kubectl explain pod.spec.containers`
</details>

---

### 문제 11.
Secret에 대한 설명으로 올바르지 않은 것은?

A) Secret은 볼륨으로 마운트할 수 있다
B) Secret은 환경 변수로 주입할 수 있다
C) Secret의 최대 크기는 10MiB이다
D) Secret의 데이터는 Base64로 인코딩된다

<details><summary>정답 확인</summary>

**정답: C) Secret의 최대 크기는 10MiB이다**

Secret의 최대 크기는 **1MiB**이다. 10MiB가 아니다.
</details>

---

### 문제 12.
NetworkPolicy가 없는 네임스페이스에서 Pod 간 통신은?

A) 모든 통신이 차단된다
B) 같은 네임스페이스만 허용된다
C) 모든 통신이 허용된다
D) Ingress만 허용된다

<details><summary>정답 확인</summary>

**정답: C) 모든 통신이 허용된다**

NetworkPolicy가 없으면 기본적으로 모든 Ingress/Egress 트래픽이 허용된다. NetworkPolicy를 적용하면 명시적으로 허용하지 않은 트래픽은 차단된다.
</details>

---

### 문제 13.
NetworkPolicy가 동작하기 위해 필요한 것은?

A) kube-proxy만 있으면 된다
B) NetworkPolicy를 지원하는 CNI 플러그인이 필요하다
C) Ingress Controller가 필요하다
D) Service Mesh가 필요하다

<details><summary>정답 확인</summary>

**정답: B) NetworkPolicy를 지원하는 CNI 플러그인이 필요하다**

Calico, Cilium, Weave 등이 NetworkPolicy를 지원한다. **Flannel**은 지원하지 않는다.
</details>

---

### 문제 14.
Pod의 restartPolicy 기본값은?

A) Never
B) OnFailure
C) Always
D) Unless-Stopped

<details><summary>정답 확인</summary>

**정답: C) Always**

일반 Pod의 restartPolicy 기본값은 **Always**이다. Job에서는 Never 또는 OnFailure만 사용 가능하다.
</details>

---

### 문제 15.
PVC에서 요청할 수 있는 접근 모드(Access Mode)가 아닌 것은?

A) ReadWriteOnce (RWO)
B) ReadOnlyMany (ROX)
C) ReadWriteMany (RWX)
D) ReadWriteAll (RWA)

<details><summary>정답 확인</summary>

**정답: D) ReadWriteAll (RWA)**

K8s의 접근 모드는 RWO, ROX, RWX, RWOP 4가지이다. RWA는 존재하지 않는다.
</details>

---

## 복습 체크리스트

- [ ] ConfigMap = 비기밀 설정, Secret = 기밀 데이터 (Base64 인코딩)
- [ ] ConfigMap 변경: 볼륨=자동 반영, 환경 변수=Pod 재시작 필요
- [ ] Secret은 Base64 인코딩이며 암호화가 아니다! (EncryptionConfiguration 필요)
- [ ] Secret 최대 크기: 1MiB
- [ ] 기본 NS 4개: default, kube-system, kube-public, kube-node-lease
- [ ] Label = Selector 가능, Annotation = Selector 불가
- [ ] RBAC 4대 리소스: Role, ClusterRole, RoleBinding, ClusterRoleBinding
- [ ] Role = NS 범위, ClusterRole = 클러스터 범위
- [ ] Ingress는 Ingress Controller가 반드시 필요하다!
- [ ] PV Reclaim: Retain(보존), Delete(삭제), Recycle(deprecated)
- [ ] WaitForFirstConsumer = Pod 스케줄링 시까지 PV 바인딩 지연
- [ ] NetworkPolicy 없으면 모든 통신 허용, CNI 지원 필요 (Flannel 미지원)
- [ ] restartPolicy 기본값 = Always, Job은 Never/OnFailure만

---

## 내일 학습 예고

> Day 5에서는 컨테이너 오케스트레이션과 Cloud Native Architecture를 학습한다. 컨테이너 기술(namespace, cgroups, OCI), CNCF 생태계, 마이크로서비스, 서비스 메시, 오토스케일링을 다룬다.

---

## tart-infra 실습

### 실습 환경 설정

```bash
# dev 클러스터에 접속
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/dev.yaml
kubectl get nodes
```

### 실습 1: ConfigMap과 Secret 확인

```bash
# ConfigMap 확인
kubectl get cm -n demo --no-headers
kubectl get cm -n demo -o yaml | head -30

# Secret 확인 (Base64 인코딩 확인)
kubectl get secret -n demo --no-headers
kubectl get secret -n demo -o yaml | head -30
```

**동작 원리:** ConfigMap vs Secret:
1. ConfigMap: 비기밀 설정 (DB 호스트, 로그 레벨 등)
2. Secret: 기밀 데이터 (비밀번호, API 키 등) - Base64 인코딩
3. 둘 다 환경 변수 또는 볼륨으로 Pod에 주입 가능
4. 볼륨 마운트 시 자동 갱신, 환경 변수는 Pod 재시작 필요

### 실습 2: RBAC 확인

```bash
# ClusterRole 확인
kubectl get clusterrole --no-headers | head -10

# RoleBinding 확인
kubectl get rolebinding -n demo --no-headers 2>/dev/null

# ServiceAccount 확인
kubectl get sa -n demo --no-headers
```

**동작 원리:** RBAC 구조:
1. Role(NS 범위) / ClusterRole(클러스터 범위) = 권한 정의
2. RoleBinding / ClusterRoleBinding = 권한을 Subject에 연결
3. Subject = User, Group, ServiceAccount
4. API Server가 인증 -> 인가(RBAC) -> 어드미션 순서로 처리

### 실습 3: PV/PVC 확인

```bash
# PersistentVolume 확인 (클러스터 수준)
kubectl get pv --no-headers

# PersistentVolumeClaim 확인 (네임스페이스 수준)
kubectl get pvc -n demo --no-headers 2>/dev/null

# StorageClass 확인
kubectl get storageclass --no-headers
```

**동작 원리:** 스토리지 계층:
1. PV = 실제 스토리지 리소스 (클러스터 수준)
2. PVC = 스토리지 사용 요청 (네임스페이스 수준)
3. StorageClass = 동적 PV 프로비저닝 정책
4. volumeBindingMode: WaitForFirstConsumer = Pod 스케줄링까지 바인딩 지연
