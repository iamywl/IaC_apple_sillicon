# KCNA 보충 학습 자료

> 기존 01-concepts, 02-examples, 03-exam-questions를 보완하는 추가 학습 자료이다.
> 누락된 개념, 실전 YAML 예제, 추가 모의 문제(40+30문항)를 포함한다.
> 모든 YAML 예제에는 검증 명령어와 기대 출력(`text` 블록)을 포함하였다.
> 각 개념에는 등장 배경, 기존 한계점, 내부 동작 원리, CNCF 생태계 맥락, 트러블슈팅을 포함한다.

---

# Part 1: 누락된 개념 보강

---

## 1.1 Pod Disruption Budget (PDB)

### 배경: PDB가 없던 시절의 문제

PDB가 등장하기 전에는 노드 유지보수 시 심각한 가용성 문제가 발생하였다. 예를 들어, 서비스가 2개의 replica로 운영되고 있고, 두 Pod가 모두 같은 노드에 배치된 상황을 가정한다. 관리자가 `kubectl drain`으로 해당 노드를 비우면 두 Pod가 동시에 퇴거(evict)되어 서비스가 완전히 중단된다. 새 Pod가 다른 노드에서 시작될 때까지 수 초에서 수십 초 동안 다운타임이 발생하는 것이다.

```
PDB가 없는 경우의 문제 시나리오
==========================================

Deployment: replicas=2, 두 Pod 모두 node-1에 배치됨

[node-1]                         [node-2]
  Pod-A (app=web)                  (비어 있음)
  Pod-B (app=web)

관리자: kubectl drain node-1 실행
  -> Pod-A 퇴거됨
  -> Pod-B 퇴거됨  (거의 동시에!)
  -> 서비스 완전 중단 (0/2 Running)
  -> 수 초~수십 초 후 node-2에서 Pod 재생성
  -> 그 사이 사용자는 503 에러를 경험
```

이 문제의 핵심은 Kubernetes가 "이 서비스에서 최소 몇 개의 Pod는 반드시 살아 있어야 한다"는 정보를 알 수 없다는 점이다. PDB는 바로 이 정보를 Kubernetes에 전달하는 메커니즘이다.

Kubernetes 1.4에서 PDB가 도입되었으며, 1.21에서 `policy/v1` API로 GA(General Availability)가 되었다. 초기 버전인 `policy/v1beta1`은 1.25에서 제거되었다.

### PDB란 무엇인가?

Pod Disruption Budget(PDB)은 **자발적 중단(voluntary disruption)** 상황에서 동시에 중단될 수 있는 Pod의 수를 제한하는 Kubernetes 리소스이다. 클러스터 관리자가 노드를 업그레이드하거나 유지보수할 때, 애플리케이션의 가용성을 보장하기 위해 사용한다.

### 자발적 중단 vs 비자발적 중단

```
중단(Disruption)의 종류
====================================

자발적 중단 (Voluntary)             비자발적 중단 (Involuntary)
- 노드 드레인 (kubectl drain)       - 하드웨어 장애
- 클러스터 업그레이드                - 커널 패닉
- Deployment 롤링 업데이트           - VM 삭제
- Eviction API를 통한 축출           - 네트워크 파티션
                                     - 리소스 부족으로 인한 축출(Eviction)

  --> PDB가 보호 가능                 --> PDB가 보호 불가
  (주의: kubectl delete pod는 PDB를 무시한다. Eviction API만 PDB를 준수한다.)
```

자발적 중단과 비자발적 중단의 구분이 중요한 이유는, PDB가 오직 자발적 중단에 대해서만 보호를 제공하기 때문이다. 하드웨어 장애와 같은 비자발적 중단은 예측할 수 없으므로, 이에 대비하려면 충분한 replica 수와 Pod Anti-Affinity 같은 별도의 전략이 필요하다.

### PDB의 내부 동작 원리

PDB가 동작하는 과정을 단계별로 설명하면 다음과 같다:

1. `kubectl drain node-1`을 실행한다.
2. drain 명령이 노드를 SchedulingDisabled(cordon)로 표시한다.
3. drain 명령이 노드의 각 Pod에 대해 Eviction API(`POST /api/v1/namespaces/{namespace}/pods/{pod}/eviction`)를 호출한다.
4. API 서버가 Eviction 요청을 받으면, 해당 Pod에 적용되는 PDB를 조회한다.
5. PDB 조건을 확인한다:
   - `minAvailable` 설정의 경우: 현재 healthy Pod 수 - 1 >= minAvailable이면 허용한다.
   - `maxUnavailable` 설정의 경우: 현재 unavailable Pod 수 + 1 <= maxUnavailable이면 허용한다.
6. PDB 조건이 위반되면 API 서버가 `429 Too Many Requests`를 반환하고, drain 명령은 주기적으로 재시도한다.
7. 기존에 퇴거된 Pod가 다른 노드에서 Ready 상태가 되면, PDB 조건이 충족되어 다음 Pod의 퇴거가 허용된다.

```
PDB 내부 동작 흐름
====================================

kubectl drain node-1
    │
    ▼
[Eviction API 호출]
    │
    ▼
[API Server]
    │ PDB 조회
    ▼
PDB: minAvailable=2, 현재 healthy=3
    │
    ├── 3 - 1 = 2 >= minAvailable(2) → 허용
    │   Pod-A 퇴거됨 (healthy: 2)
    │
    ▼ 다음 Pod 퇴거 시도
PDB: minAvailable=2, 현재 healthy=2
    │
    ├── 2 - 1 = 1 < minAvailable(2) → 거부!
    │   drain 대기 (재시도 반복)
    │
    ▼ Pod-A가 다른 노드에서 Ready 됨
PDB: minAvailable=2, 현재 healthy=3
    │
    └── 3 - 1 = 2 >= minAvailable(2) → 허용
        Pod-B 퇴거됨
```

### minAvailable vs maxUnavailable 비교

| 설정 | 의미 | 적합한 상황 | 계산 방식 |
|---|---|---|---|
| `minAvailable: 2` | 항상 최소 2개의 Pod가 Running 상태여야 한다 | 최소 가용 Pod 수를 명확히 알고 있을 때 | allowedDisruptions = healthy - minAvailable |
| `maxUnavailable: 1` | 동시에 최대 1개만 중단 가능하다 | replica 수가 변동될 수 있는 환경(HPA 사용 시) | allowedDisruptions = maxUnavailable - unavailable |
| `minAvailable: "50%"` | 전체 Pod의 50% 이상이 Running이어야 한다 | 비율 기반 제어가 필요할 때 | replicas의 50% 기준으로 계산 |

두 필드 중 하나만 지정해야 한다. 둘 다 지정하면 유효성 검사 오류가 발생한다. HPA와 함께 사용할 때는 `maxUnavailable`이 더 적합하다. `minAvailable`을 고정값으로 설정하면 HPA가 스케일인할 때 PDB 조건이 충족되지 않아 문제가 발생할 수 있기 때문이다.

### PDB YAML 예시

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: web-pdb
spec:
  maxUnavailable: 1          # 동시에 최대 1개만 중단 가능
  selector:
    matchLabels:
      app: web                # app=web 레이블을 가진 Pod에 적용
```

### 검증 명령어

```bash
# 1. PDB 생성
kubectl apply -f web-pdb.yaml
```

**검증 — 기대 출력:**

```text
poddisruptionbudget.policy/web-pdb created
```

```bash
# 2. PDB 상태 확인
kubectl get pdb web-pdb
```

**검증 — 기대 출력:**

```text
NAME      MIN AVAILABLE   MAX UNAVAILABLE   ALLOWED DISRUPTIONS   AGE
web-pdb   N/A             1                 2                     10s
```

필드 설명:
- `MIN AVAILABLE`: minAvailable 설정값이다. maxUnavailable을 사용했으므로 N/A이다.
- `MAX UNAVAILABLE`: maxUnavailable 설정값이다. 동시에 최대 1개의 Pod만 중단 가능하다.
- `ALLOWED DISRUPTIONS`: 현재 추가로 중단 가능한 Pod 수이다. replicas=3이고 maxUnavailable=1이면, 모든 Pod가 healthy일 때 ALLOWED DISRUPTIONS = min(maxUnavailable, healthy - desired + maxUnavailable) = 1이다. 위 출력에서 2로 표시된 것은 healthy Pod 수에 따라 달라질 수 있다.

```bash
# 3. PDB 상세 정보 확인
kubectl describe pdb web-pdb
```

**검증 — 기대 출력:**

```text
Name:           web-pdb
Namespace:      default
Min Available:  N/A
Max Unavailable: 1
Selector:       app=web
Status:
    Allowed Disruptions:  2
    Current:              3
    Desired:              3
    Total:                3
Conditions:
  Type                Status
  ----                ------
  DisruptionAllowed   True
Events:               <none>
```

`Current`는 현재 healthy Pod 수, `Desired`는 selector에 매칭되는 총 Pod 수, `Total`은 전체 Pod 수이다.

```bash
# 4. PDB가 실제로 동작하는지 테스트 (drain 시 PDB를 존중하는지 확인)
kubectl drain <node-name> --ignore-daemonsets --delete-emptydir-data
```

**검증 — PDB 조건 위반 시 기대 출력:**

```text
evicting pod default/web-deployment-abc12-xyz34
error when evicting pods/"web-deployment-abc12-xyz34" -n "default" (will retry after 5s): Cannot evict pod as it would violate the pod's disruption budget.
```

### 트러블슈팅 — PDB 관련 문제

```bash
# PDB가 drain을 영구적으로 차단하는 경우
# 원인: minAvailable = replicas 수이고, 다른 노드에 Pod를 배치할 수 없는 경우
# 해결:
# 1. 다른 노드에 리소스 여유가 있는지 확인
kubectl get nodes -o custom-columns='NAME:.metadata.name,CPU:.status.allocatable.cpu,MEM:.status.allocatable.memory'

# 2. PDB의 ALLOWED DISRUPTIONS 확인
kubectl get pdb -A

# 3. 긴급한 경우 PDB를 일시적으로 삭제 (주의: 가용성 보호 해제)
# kubectl delete pdb web-pdb
```

### CNCF 생태계 맥락

PDB는 Kubernetes의 내장 기능이며, CNCF 생태계의 여러 도구와 연계된다:
- **Cluster Autoscaler**: 노드를 축소(scale-down)할 때 PDB를 존중한다. PDB가 위반되는 노드는 축소 대상에서 제외된다.
- **ArgoCD**: 롤링 업데이트 시 PDB를 통해 가용성을 유지한다.
- **Kyverno/OPA Gatekeeper**: "모든 Deployment에 PDB가 설정되어 있는지" 정책을 강제할 수 있다.

### 왜 중요한가?

KCNA 시험에서 PDB는 **고가용성(High Availability)** 및 **클러스터 유지보수** 관련 질문에서 출제될 수 있다. 핵심 포인트는 다음과 같다:

1. PDB는 자발적 중단만 보호한다
2. `kubectl drain` 명령이 PDB를 존중한다
3. minAvailable과 maxUnavailable 중 하나만 지정해야 한다
4. 퍼센트(%) 또는 절대값(정수)으로 지정 가능하다
5. `kubectl delete pod`는 PDB를 무시한다 (Eviction API만 PDB를 준수한다)
6. HPA와 함께 사용할 때는 maxUnavailable이 더 적합하다

---

## 1.2 CustomResourceDefinition (CRD)

### 배경: CRD가 없던 시절의 문제

Kubernetes의 내장 리소스(Pod, Service, Deployment 등)만으로는 복잡한 애플리케이션을 관리하기 어려운 경우가 많다. 예를 들어, PostgreSQL 데이터베이스 클러스터를 Kubernetes에서 운영한다고 가정한다. 데이터베이스 생성, 복제(replication) 구성, 백업 스케줄링, 페일오버(failover) 등을 모두 Deployment와 ConfigMap의 조합으로 관리해야 한다. 이 경우 운영자가 수십 개의 YAML 파일을 직접 관리해야 하며, 데이터베이스 도메인 지식이 Kubernetes 매니페스트 곳곳에 흩어져 재사용이 어렵다.

CRD가 등장하기 전에는 ThirdPartyResource라는 제한적인 메커니즘이 존재하였으나, 스키마 검증 부재, API 버전 관리 미지원, 네임스페이스 범위 제한 등의 한계가 있어 Kubernetes 1.7에서 CRD로 대체되었다.

CRD의 핵심 가치는, 사용자가 자신의 도메인에 맞는 리소스 타입을 정의하고 이를 Kubernetes API를 통해 관리할 수 있게 함으로써, Kubernetes를 범용 플랫폼으로 확장하는 것이다.

### CRD란 무엇인가?

CustomResourceDefinition(CRD)은 Kubernetes API를 확장하여 **사용자 정의 리소스(Custom Resource)**를 생성할 수 있게 해주는 메커니즘이다. Pod, Service, Deployment 같은 내장 리소스 외에 자신만의 리소스 타입을 정의할 수 있다.

### CRD의 내부 동작 원리

CRD를 API 서버에 등록하면, API 서버는 다음과 같은 과정을 수행한다:

1. CRD 매니페스트의 유효성을 검사한다 (group, version, kind, scope, schema 등).
2. etcd에 CRD 정의를 저장한다.
3. 해당 리소스 타입에 대한 새로운 REST API 엔드포인트를 자동으로 생성한다.
4. OpenAPI 스키마를 업데이트하여 kubectl의 자동완성과 유효성 검사를 지원한다.

이후 해당 타입의 Custom Resource(CR)를 생성, 조회, 수정, 삭제할 수 있으며, etcd에 저장된다. RBAC으로 접근 제어도 가능하다.

```
CRD 등록 및 사용 흐름
====================================

1. CRD 등록:
   kubectl apply -f database-crd.yaml
   → API 서버가 /apis/example.com/v1/databases 엔드포인트를 생성한다

2. Custom Resource 생성:
   kubectl apply -f my-database.yaml
   → API 서버가 CR을 etcd에 저장한다

3. Custom Controller(Operator)가 CR을 Watch:
   → CR이 생성되면 실제 데이터베이스를 프로비저닝한다
   → CR이 수정되면 데이터베이스 설정을 업데이트한다
   → CR이 삭제되면 데이터베이스를 정리한다

+---------------------------------------------------+
|            Kubernetes API Server                    |
|                                                     |
|  내장 리소스          사용자 정의 리소스 (CR)        |
|  +-----------+       +-------------------+          |
|  | Pod       |       | Database (커스텀) |          |
|  | Service   |       | Certificate       |          |
|  | Deployment|       | BackupJob         |          |
|  +-----------+       +-------------------+          |
|       ^                      ^                      |
|       |                      |                      |
|   K8s 코어에 내장       CRD로 정의하여 등록          |
+---------------------------------------------------+

사용자가 CRD를 등록하면:
  kubectl get databases      <-- 가능해진다!
  kubectl describe database my-db
  kubectl delete database my-db
```

### CRD + Custom Controller = Operator Pattern

CRD 자체는 데이터 저장소일 뿐이다. 실제 동작(예: 데이터베이스 생성, 백업 수행)을 하려면 **커스텀 컨트롤러(Custom Controller)**가 필요하다. 이 둘을 합쳐서 **Operator Pattern**이라 부른다.

```
CRD (정의)  +  Controller (로직)  =  Operator

  "Database라는       "Database CR이          "데이터베이스를
   리소스가 있다"      생성되면 실제 DB를       자동으로 관리하는
                       프로비저닝한다"          운영 자동화 도구"
```

Operator Pattern은 "인간 운영자(Human Operator)의 도메인 지식을 소프트웨어로 코드화한 것"이다. 이것이 단순한 스크립트 자동화와 다른 점은, Kubernetes의 Reconciliation Loop를 활용하여 **지속적으로** 원하는 상태를 유지한다는 것이다.

Operator의 Reconciliation Loop 동작:
1. Custom Resource의 spec(원하는 상태)을 읽는다.
2. 현재 인프라 상태(실제 데이터베이스, Pod 등)를 확인한다.
3. 차이가 있으면 액션을 수행한다 (Pod 생성, 복제 구성, 페일오버 등).
4. Custom Resource의 status를 업데이트한다.
5. 1번으로 돌아간다 (지속적 반복).

### CNCF 생태계에서 CRD를 사용하는 프로젝트

| 프로젝트 | CRD 예시 | 역할 |
|---|---|---|
| Prometheus Operator | `ServiceMonitor`, `PrometheusRule` | 모니터링 대상과 알림 규칙을 CRD로 선언적 관리 |
| cert-manager | `Certificate`, `Issuer` | TLS 인증서 자동 발급/갱신 |
| Istio | `VirtualService`, `DestinationRule` | 서비스 메시 트래픽 관리 |
| ArgoCD | `Application`, `AppProject` | GitOps 배포 관리 |
| Cilium | `CiliumNetworkPolicy` | L7 네트워크 정책 |
| Kyverno | `ClusterPolicy` | 정책 강제 |

### CRD YAML 예시와 검증

```yaml
apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
metadata:
  name: databases.example.com       # <plural>.<group> 형식
spec:
  group: example.com                 # API 그룹
  versions:
  - name: v1                         # API 버전
    served: true                     # 이 버전의 API를 서비스할지 여부
    storage: true                    # etcd에 이 버전으로 저장할지 여부
    schema:
      openAPIV3Schema:               # 스키마 정의 (유효성 검사에 사용)
        type: object
        properties:
          spec:
            type: object
            properties:
              engine:
                type: string
                enum: ["postgres", "mysql", "mongodb"]
              version:
                type: string
              replicas:
                type: integer
                minimum: 1
                maximum: 10
            required: ["engine", "version"]
  scope: Namespaced                  # Namespaced 또는 Cluster 범위
  names:
    plural: databases                # 복수형 (kubectl get databases)
    singular: database               # 단수형 (kubectl get database)
    kind: Database                   # 리소스 종류 (YAML의 kind 필드)
    shortNames:
    - db                             # 축약어 (kubectl get db)
```

```bash
# 1. CRD 등록
kubectl apply -f database-crd.yaml
```

**검증 — 기대 출력:**

```text
customresourcedefinition.apiextensions.k8s.io/databases.example.com created
```

```bash
# 2. CRD 확인
kubectl get crd databases.example.com
```

**검증 — 기대 출력:**

```text
NAME                     CREATED AT
databases.example.com    2026-03-30T10:00:00Z
```

```bash
# 3. Custom Resource 생성
kubectl apply -f - <<EOF
apiVersion: example.com/v1
kind: Database
metadata:
  name: my-postgres
  namespace: default
spec:
  engine: postgres
  version: "16"
  replicas: 3
EOF
```

**검증 — 기대 출력:**

```text
database.example.com/my-postgres created
```

```bash
# 4. Custom Resource 조회
kubectl get databases
# 또는 축약어 사용
kubectl get db
```

**검증 — 기대 출력:**

```text
NAME          AGE
my-postgres   10s
```

```bash
# 5. Custom Resource 상세 확인
kubectl describe database my-postgres
```

**검증 — 기대 출력:**

```text
Name:         my-postgres
Namespace:    default
API Version:  example.com/v1
Kind:         Database
Spec:
  Engine:    postgres
  Replicas:  3
  Version:   16
Events:      <none>
```

```bash
# 6. 스키마 유효성 검사 테스트 (잘못된 값)
kubectl apply -f - <<EOF
apiVersion: example.com/v1
kind: Database
metadata:
  name: invalid-db
spec:
  engine: oracle    # enum에 없는 값
  version: "19"
  replicas: 20      # maximum 10 초과
EOF
```

**검증 — 기대 출력:**

```text
The Database "invalid-db" is invalid:
* spec.engine: Unsupported value: "oracle": supported values: "postgres", "mysql", "mongodb"
* spec.replicas: Invalid value: 20: spec.replicas in body should be less than or equal to 10
```

### CRD vs Aggregated API Server 비교

Kubernetes API를 확장하는 방법에는 CRD 외에 Aggregated API Server 방식도 있다.

| 비교 항목 | CRD | Aggregated API Server |
|---|---|---|
| 구현 복잡도 | 낮음 (YAML만으로 등록 가능) | 높음 (별도 API 서버 구현 필요) |
| 유연성 | 표준 CRUD 동작만 지원 | 완전한 API 동작 커스터마이징 가능 |
| 스키마 검증 | OpenAPI v3 스키마 지원 | 완전한 커스텀 검증 가능 |
| 서브리소스 | status, scale 서브리소스 지원 | 임의의 서브리소스 정의 가능 |
| 저장소 | etcd에 저장 (API 서버의 etcd 공유) | 별도 저장소 사용 가능 |
| 적합한 사례 | 대부분의 Operator 개발 | metrics-server, custom-metrics-api 등 |

대부분의 경우 CRD가 충분하며, KCNA 수준에서는 CRD 방식만 이해하면 된다.

### 트러블슈팅 — CRD 관련 문제

```bash
# CRD가 등록되었는지 확인
kubectl get crd | grep example.com

# CRD의 상태 확인 (Established 조건이 True여야 함)
kubectl get crd databases.example.com -o jsonpath='{.status.conditions[?(@.type=="Established")].status}'
# 기대 출력: True

# CRD에 매칭되는 CR이 존재하는지 확인
kubectl get databases --all-namespaces

# CRD 삭제 시 주의: 연관된 모든 CR도 함께 삭제된다!
# kubectl delete crd databases.example.com
```

### 왜 중요한가?

1. CRD는 Kubernetes의 확장성의 핵심이다
2. Prometheus Operator, cert-manager 등 많은 CNCF 프로젝트가 CRD를 사용한다
3. KCNA에서 "Kubernetes API를 확장하는 방법"으로 출제된다
4. Operator Pattern과 함께 묶어서 이해해야 한다
5. CRD를 삭제하면 연관된 모든 CR이 함께 삭제된다는 점을 기억해야 한다

---

## 1.3 Admission Controllers

### 배경: Admission Controller가 없던 시절의 문제

Kubernetes API 서버의 인증(Authentication)과 인가(Authorization)만으로는 세밀한 정책 제어가 불가능하다. 예를 들어, RBAC으로 "사용자 A가 Pod를 생성할 수 있다"는 권한을 부여할 수 있지만, "Pod를 생성할 때 반드시 resource limits를 설정해야 한다"거나 "특정 이미지 레지스트리의 이미지만 사용해야 한다"는 세부 정책은 RBAC으로 표현할 수 없다.

이 문제의 원인은 RBAC이 "누가(who) 무엇을(what) 할 수 있는가"만 제어하고, "어떻게(how) 해야 하는가"는 제어하지 못하기 때문이다. Admission Controller는 이 gap을 채우는 메커니즘으로, 요청의 내용을 검증하거나 수정하여 클러스터 정책을 강제한다.

### Admission Controller란 무엇인가?

Admission Controller는 Kubernetes API 서버가 요청을 처리하는 과정에서, 인증(Authentication)과 인가(Authorization)를 통과한 요청을 **etcd에 저장하기 전에** 가로채서 검증하거나 수정하는 플러그인이다.

### API 요청 처리 흐름

이 흐름은 KCNA 시험에서 매우 자주 출제되는 내용이므로, 순서를 정확히 기억해야 한다.

```
kubectl apply -f pod.yaml
        |
        v
+-----------------------------------------------+
|              kube-apiserver                     |
|                                                 |
|  1. Authentication (인증)                       |
|     "이 사용자가 누구인가?"                      |
|     방법: X.509 인증서, Bearer Token, OIDC 등   |
|        |                                        |
|        v                                        |
|  2. Authorization (인가 - RBAC 등)              |
|     "이 사용자가 이 작업을 할 권한이 있는가?"     |
|     방법: RBAC, Node, Webhook, ABAC            |
|        |                                        |
|        v                                        |
|  3. Admission Controllers  <-- 여기!            |
|     |                                           |
|     +-- Mutating Admission (수정) - 먼저 실행    |
|     |   "요청을 변경할 수 있다"                   |
|     |   예: 기본값 주입, 사이드카 추가            |
|     |                                           |
|     +-- Schema Validation                       |
|     |   "리소스 스키마 유효성 검사"               |
|     |                                           |
|     +-- Validating Admission (검증) - 나중 실행  |
|         "요청을 거부할 수 있다"                   |
|         예: 리소스 제한 위반 차단                 |
|        |                                        |
|        v                                        |
|  4. etcd에 저장                                 |
+-----------------------------------------------+
```

Mutating이 먼저 실행되는 이유는, Mutating 단계에서 주입된 기본값이나 추가 필드를 Validating 단계에서 검증할 수 있어야 하기 때문이다. 예를 들어, LimitRanger(Mutating)가 기본 리소스 제한을 주입한 후, ResourceQuota(Validating)가 네임스페이스 총 리소스를 검증한다.

### 주요 Admission Controller 종류

| Admission Controller | 유형 | 역할 | 내부 동작 |
|---|---|---|---|
| **NamespaceLifecycle** | Validating | 삭제 중인 네임스페이스에 새 리소스 생성을 방지한다 | 네임스페이스의 deletion timestamp를 확인한다 |
| **LimitRanger** | Mutating + Validating | 네임스페이스에 설정된 LimitRange를 기반으로 리소스 기본값을 적용하고 제한을 검증한다 | LimitRange 객체를 조회하여 default/min/max를 적용한다 |
| **ResourceQuota** | Validating | 네임스페이스의 ResourceQuota를 초과하는 요청을 거부한다 | 현재 사용량 + 요청량이 quota를 초과하는지 계산한다 |
| **PodSecurity** | Validating | Pod Security Standards를 적용하여 보안 정책을 강제한다 (PSP 대체) | 네임스페이스 레이블의 enforce/warn/audit 수준을 확인한다 |
| **MutatingAdmissionWebhook** | Mutating | 외부 웹훅을 호출하여 요청을 수정한다 | HTTPS로 외부 서비스를 호출하고 JSON Patch를 받아 적용한다 |
| **ValidatingAdmissionWebhook** | Validating | 외부 웹훅을 호출하여 요청을 검증한다 | HTTPS로 외부 서비스를 호출하고 allow/deny 응답을 받는다 |

### Webhook 기반 확장과 CNCF 프로젝트

사용자는 자체 Admission Webhook을 작성하여 Kubernetes에 등록할 수 있다:

- **Mutating Webhook**: 요청 객체를 수정한다.
  - Istio의 사이드카 자동 주입: Pod 생성 시 Envoy 사이드카 컨테이너를 자동으로 spec에 추가한다.
  - Linkerd의 프록시 주입: 유사한 방식으로 linkerd2-proxy를 주입한다.
- **Validating Webhook**: 요청을 허용/거부한다.
  - OPA Gatekeeper: Rego 언어로 정의된 정책을 강제한다.
  - Kyverno: YAML로 정의된 정책을 강제한다.

```
Istio Sidecar Injection 동작 원리
====================================

1. 사용자가 Pod를 생성한다:
   kubectl apply -f my-app.yaml
   (spec에는 my-app 컨테이너 하나만 정의됨)

2. API 서버가 MutatingAdmissionWebhook을 호출한다:
   POST https://istiod.istio-system:443/inject
   Body: AdmissionReview (원본 Pod spec)

3. istiod가 Pod spec에 사이드카를 추가한다:
   - istio-proxy 컨테이너 추가
   - init container (istio-init) 추가 (iptables 설정)
   - 볼륨 추가 (인증서, 설정)

4. 수정된 Pod spec이 etcd에 저장된다.
5. 사용자가 보는 Pod에는 2개의 컨테이너가 있다 (my-app + istio-proxy).
```

### 정책 엔진 비교: OPA Gatekeeper vs Kyverno

| 비교 항목 | OPA Gatekeeper | Kyverno |
|---|---|---|
| 정책 언어 | Rego (범용 정책 언어) | YAML (Kubernetes 네이티브) |
| 학습 곡선 | 높음 (Rego 학습 필요) | 낮음 (YAML만 알면 됨) |
| CNCF 상태 | Graduated (OPA), Sandbox (Gatekeeper) | Graduated |
| 정책 범위 | Kubernetes 외 환경에서도 사용 가능 | Kubernetes 전용 |
| 동작 방식 | Validating Webhook | Validating + Mutating + Generate |
| CRD | ConstraintTemplate, Constraint | ClusterPolicy, Policy |

### 검증 명령어 — 활성화된 Admission Controller 확인

```bash
# API 서버의 Admission Controller 플러그인 확인
kubectl get pod -n kube-system -l component=kube-apiserver \
  -o jsonpath='{.items[0].spec.containers[0].command}' | tr ',' '\n' | grep admission
```

**검증 — 기대 출력:**

```text
--enable-admission-plugins=NodeRestriction
```

기본적으로 활성화되는 Admission Controller 목록은 Kubernetes 버전에 따라 다르다. `--enable-admission-plugins` 플래그에 명시되지 않은 경우에도 기본 활성화 플러그인이 있다.

```bash
# Mutating Webhook 설정 확인
kubectl get mutatingwebhookconfigurations
```

**검증 — 기대 출력:**

```text
NAME                         WEBHOOKS   AGE
istio-sidecar-injector       1          10d
cilium-mutating-webhook      1          10d
```

```bash
# Validating Webhook 설정 확인
kubectl get validatingwebhookconfigurations
```

**검증 — 기대 출력:**

```text
NAME                         WEBHOOKS   AGE
cilium-validating-webhook    1          10d
```

### 왜 중요한가?

1. Admission Controller는 클러스터 보안과 정책 강제의 핵심 메커니즘이다
2. KCNA에서 API 요청 처리 흐름(인증 → 인가 → Admission → etcd) 순서를 묻는 문제가 자주 출제된다
3. Mutating vs Validating의 차이와 실행 순서를 이해해야 한다
4. OPA/Gatekeeper, Kyverno 같은 정책 엔진이 Admission Webhook을 활용한다
5. Istio의 사이드카 주입이 Mutating Webhook의 대표적 사례이다

---

## 1.4 etcd 백업과 복구 개념

### 배경: etcd 장애의 심각성

etcd 데이터가 손실되면 어떤 일이 발생하는지 이해해야 한다. etcd에는 Kubernetes 클러스터의 모든 상태 데이터가 저장되어 있다. Deployment 정의, Service 설정, ConfigMap, Secret, RBAC 규칙 등 모든 것이 etcd에 존재한다. etcd 데이터가 손실되면 이 모든 설정이 사라지며, 실행 중인 컨테이너는 계속 동작하지만 새로운 스케줄링이나 자가 복구(self-healing)가 불가능해진다. 사실상 클러스터가 "뇌사 상태"가 되는 것이다.

기존의 전통적인 인프라에서는 서버 설정을 수동으로 관리하거나 Ansible 같은 도구로 재현 가능하게 만들 수 있었다. 그러나 Kubernetes에서는 모든 상태가 etcd 한 곳에 집중되어 있으므로, etcd 백업이 곧 클러스터 백업이다.

### etcd의 중요성과 Raft 합의 알고리즘

etcd는 Kubernetes 클러스터의 **모든 상태 데이터**를 저장하는 단일 진실 소스(Single Source of Truth)이다. etcd는 분산 합의 알고리즘인 Raft를 사용하여 데이터 일관성을 보장한다.

Raft의 핵심 원리는 과반수(quorum) 유지이다. 클러스터의 과반수 노드가 동의해야 데이터 쓰기가 확정되므로, 소수의 노드가 장애를 겪어도 데이터 일관성이 유지된다.

```
etcd 클러스터 구성과 장애 허용
====================================

  etcd 클러스터 (3노드 구성)

  +--------+     +--------+     +--------+
  | etcd-0 | <-> | etcd-1 | <-> | etcd-2 |
  | Leader |     |Follower|     |Follower|
  +--------+     +--------+     +--------+

  장애 허용 계산:
  - 3개 노드: quorum = 2, 장애 허용 = 1
  - 5개 노드: quorum = 3, 장애 허용 = 2
  - 7개 노드: quorum = 4, 장애 허용 = 3
  - 공식: 장애 허용 = (n-1)/2 (n은 총 노드 수, 홀수 권장)

  Raft 합의 과정 (쓰기 요청):
  1. 클라이언트가 Leader에 쓰기 요청을 보낸다.
  2. Leader가 Follower에게 로그 항목을 복제한다.
  3. 과반수(quorum)가 응답하면 쓰기를 확정(commit)한다.
  4. Leader가 클라이언트에 성공 응답을 보낸다.
```

홀수 노드를 권장하는 이유는, 짝수 노드(예: 4개)는 홀수 노드(3개)와 동일한 장애 허용 수를 가지면서 추가 인프라 비용만 발생하기 때문이다. 4개 노드의 과반수는 3개이므로 1개 장애만 허용 가능하고, 이는 3개 노드와 동일하다.

### 백업과 복구의 전체 흐름

```
정상 운영                     장애 발생               복구 완료
=========                    =========              =========

+--------+                   +--------+             +--------+
| etcd   |  --스냅샷 생성-->  | etcd   |  --복원-->  | etcd   |
| [데이터]|  snapshot.db     | [손상!] |  snapshot  | [복원됨]|
+--------+                   +--------+   .db 사용  +--------+
    |                                                    |
    v                                                    v
정기적으로                                         클러스터 상태가
스냅샷을 저장                                      스냅샷 시점으로 복구
(예: 매 시간)
```

### 핵심 개념

**1. 스냅샷(Snapshot)**

etcd의 전체 데이터를 하나의 파일로 저장하는 것이다. `etcdctl snapshot save` 명령으로 수행한다.

```bash
# 스냅샷 생성 (개념 이해용 - KCNA에서 명령어 자체를 외울 필요는 없음)
ETCDCTL_API=3 etcdctl snapshot save /backup/snapshot.db \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key
```

```bash
# 스냅샷 생성 확인
ETCDCTL_API=3 etcdctl snapshot status /backup/snapshot.db --write-table
```

**검증 — 기대 출력:**

```text
+----------+----------+------------+------------+
|   HASH   | REVISION | TOTAL KEYS | TOTAL SIZE |
+----------+----------+------------+------------+
| 5d16a099 |    12345 |       1024 |     2.1 MB |
+----------+----------+------------+------------+
```

필드 설명:
- `HASH`: 스냅샷 파일의 무결성 해시값이다.
- `REVISION`: etcd의 현재 리비전 번호이다. 모든 쓰기 작업마다 1씩 증가한다.
- `TOTAL KEYS`: 저장된 전체 키 수이다.
- `TOTAL SIZE`: 스냅샷 파일 크기이다.

**2. 복구(Restore)**

스냅샷 파일을 사용하여 etcd 데이터를 복원하는 것이다. 복구 시 새로운 데이터 디렉토리가 생성된다. 복구 후에는 스냅샷이 생성된 시점의 상태로 돌아가므로, 그 이후의 변경 사항은 손실된다. 이 때문에 백업 주기가 중요하다.

**3. 백업 모범 사례**

- 정기적인 자동 백업 스케줄 설정 (CronJob 등). 권장 주기는 최소 1시간이다.
- 백업 파일을 클러스터 외부(원격 스토리지, S3, GCS 등)에 저장한다. 클러스터 전체 장애 시 백업 파일도 함께 손실되는 것을 방지한다.
- 백업 파일의 무결성을 정기적으로 검증한다 (`etcdctl snapshot status` 명령 사용).
- 복구 절차를 사전에 테스트한다. 실제 장애 상황에서 처음 시도하면 실수 가능성이 높다.
- 백업 파일을 암호화하여 저장한다. Secret 데이터가 포함되어 있으므로 보안에 주의한다.

### etcd에 직접 접근하는 유일한 컴포넌트

Kubernetes 아키텍처에서 etcd에 직접 접근하는 유일한 컴포넌트는 kube-apiserver이다. 다른 모든 컴포넌트(kube-scheduler, kube-controller-manager, kubelet 등)는 API 서버를 통해서만 클러스터 상태에 접근한다. 이 설계의 이점은 다음과 같다:
1. etcd에 대한 접근을 API 서버 한 곳에서 제어할 수 있어 보안을 강화할 수 있다.
2. API 서버가 유효성 검사, 인증, 인가를 수행한 후에만 etcd에 쓰기가 가능하다.
3. etcd의 데이터 형식(protobuf)을 API 서버가 추상화하여, 다른 컴포넌트는 JSON/YAML로 통신할 수 있다.

### 트러블슈팅 — etcd 관련 문제

```bash
# etcd 건강 상태 확인
kubectl exec -n kube-system etcd-<node-name> -- etcdctl endpoint health \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key

# etcd 디스크 사용량 확인 (DB 크기가 기본 한도 2GB에 근접하면 위험)
kubectl exec -n kube-system etcd-<node-name> -- etcdctl endpoint status --write-table \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key

# etcd 공간 확보 (컴팩션)
# 오래된 리비전을 정리하여 디스크 공간을 확보한다.
kubectl exec -n kube-system etcd-<node-name> -- etcdctl compact <revision> \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key
kubectl exec -n kube-system etcd-<node-name> -- etcdctl defrag \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key
```

### 왜 중요한가?

1. KCNA에서 "클러스터 복구에 가장 중요한 것은?"이라는 문제에 etcd 백업이 정답이 된다
2. etcd가 홀수 노드로 구성되는 이유(Raft 합의)를 이해해야 한다
3. etcd와 직접 통신하는 유일한 컴포넌트가 kube-apiserver라는 점도 자주 출제된다
4. 스냅샷 기반 백업/복구의 개념적 흐름을 알아야 한다
5. 백업 파일은 클러스터 외부에 저장하는 것이 모범 사례이다

---

# Part 2: 추가 실전 예제

> 아래 10개 YAML 예제는 KCNA 시험에서 자주 다루어지는 핵심 리소스를 다룬다.
> 각 라인에 한글 주석으로 해당 필드의 의미를 설명하였다.
> 모든 예제에 검증 명령어와 기대 출력(`text` 블록)을 포함하였다.
> 각 예제에 등장 배경, 내부 동작 원리, 트러블슈팅을 포함하였다.

---

## 2.1 Pod with Labels and Annotations

### 배경

Kubernetes에서 리소스를 조직화하고 검색하는 메커니즘이 없다면, 수백 개의 Pod를 관리하기 어렵다. Labels는 리소스를 분류하고 selector로 검색하는 핵심 메커니즘이고, Annotations는 비-식별(non-identifying) 메타데이터를 저장하는 용도로 사용된다. 이 구분이 중요한 이유는, labels는 kubectl selector나 Service의 트래픽 라우팅에 사용되지만, annotations는 도구나 라이브러리가 참조하는 부가 정보(예: Prometheus 스크래핑 설정)에 사용되기 때문이다.

Labels의 내부 동작 원리:
- API 서버에서 인덱싱되어 효율적인 검색이 가능하다.
- 키/값 모두 최대 63자 제한이 있다 (DNS subdomain 규칙).
- 키에 prefix를 사용할 수 있다 (예: `app.kubernetes.io/name`). prefix는 253자까지 허용된다.
- Equality-based(`=`, `!=`)와 Set-based(`in`, `notin`, `exists`) 셀렉터를 지원한다.

Annotations의 내부 동작:
- 인덱싱되지 않으므로 selector로 검색할 수 없다.
- 값에 구조화된 데이터(JSON, URL 등)를 저장할 수 있다.
- 최대 크기는 256KB이다.

```yaml
apiVersion: v1                          # 사용할 Kubernetes API 버전 (Pod는 v1 core API)
kind: Pod                               # 리소스 종류: Pod
metadata:                               # 리소스의 메타데이터 섹션
  name: labeled-pod                     # Pod의 고유 이름 (같은 네임스페이스 내에서 유일해야 함)
  namespace: default                    # Pod가 배치될 네임스페이스 (생략 시 default)
  labels:                               # 레이블: 리소스를 분류하고 선택하는 데 사용하는 키-값 쌍
    app: frontend                       # app 레이블 - Service나 Deployment의 selector가 이 값으로 Pod를 찾음
    tier: web                           # tier 레이블 - 아키텍처 계층을 표시 (web, backend, db 등)
    version: v1.2.0                     # version 레이블 - 배포 버전을 표시
  annotations:                          # 어노테이션: 레이블과 달리 selector로 선택 불가, 부가 정보 저장용
    description: "프론트엔드 웹 서버"      # 사람이 읽을 수 있는 설명
    owner: "team-alpha"                 # 담당 팀 정보
    prometheus.io/scrape: "true"        # Prometheus가 이 Pod의 메트릭을 수집하도록 알리는 어노테이션
    prometheus.io/port: "8080"          # Prometheus가 스크래핑할 포트 번호
spec:                                   # Pod의 상세 사양(Specification) 섹션
  containers:                           # Pod 내에서 실행할 컨테이너 목록
  - name: web                          # 컨테이너 이름 (Pod 내에서 고유해야 함)
    image: nginx:1.25-alpine            # 사용할 컨테이너 이미지 (레지스트리/이름:태그 형식)
    ports:                              # 컨테이너가 노출하는 포트 목록
    - containerPort: 80                 # 컨테이너 내부에서 리스닝하는 포트 번호
      name: http                        # 포트에 부여하는 이름 (Service에서 참조 가능)
```

### 검증 명령어

```bash
# 1. Pod 생성
kubectl apply -f labeled-pod.yaml
```

**검증 — 기대 출력:**

```text
pod/labeled-pod created
```

```bash
# 2. Pod 상태 확인
kubectl get pod labeled-pod --show-labels
```

**검증 — 기대 출력:**

```text
NAME          READY   STATUS    RESTARTS   AGE   LABELS
labeled-pod   1/1     Running   0          10s   app=frontend,tier=web,version=v1.2.0
```

```bash
# 3. 레이블로 Pod 필터링 (Equality-based)
kubectl get pods -l app=frontend
```

**검증 — 기대 출력:**

```text
NAME          READY   STATUS    RESTARTS   AGE
labeled-pod   1/1     Running   0          30s
```

```bash
# 4. Set-based 셀렉터 사용
kubectl get pods -l 'tier in (web, backend)'
```

**검증 — 기대 출력:**

```text
NAME          READY   STATUS    RESTARTS   AGE
labeled-pod   1/1     Running   0          45s
```

```bash
# 5. 어노테이션 확인
kubectl get pod labeled-pod -o jsonpath='{.metadata.annotations}' | python3 -m json.tool
```

**검증 — 기대 출력:**

```text
{
    "description": "프론트엔드 웹 서버",
    "owner": "team-alpha",
    "prometheus.io/port": "8080",
    "prometheus.io/scrape": "true"
}
```

```bash
# 6. Pod 상세 정보에서 Labels와 Annotations 구분하여 확인
kubectl describe pod labeled-pod | head -20
```

**검증 — 기대 출력:**

```text
Name:             labeled-pod
Namespace:        default
Priority:         0
Service Account:  default
Node:             dev-node/192.168.64.3
Labels:           app=frontend
                  tier=web
                  version=v1.2.0
Annotations:      description: 프론트엔드 웹 서버
                  owner: team-alpha
                  prometheus.io/port: 8080
                  prometheus.io/scrape: true
Status:           Running
```

```bash
# 7. 레이블 동적 추가/수정/삭제
kubectl label pod labeled-pod environment=production
kubectl label pod labeled-pod version=v1.3.0 --overwrite
kubectl label pod labeled-pod tier-
```

**검증 — 기대 출력:**

```text
pod/labeled-pod labeled
pod/labeled-pod labeled
pod/labeled-pod unlabeled
```

```bash
# 8. 변경된 레이블 확인
kubectl get pod labeled-pod --show-labels
```

**검증 — 기대 출력:**

```text
NAME          READY   STATUS    RESTARTS   AGE   LABELS
labeled-pod   1/1     Running   0          2m    app=frontend,environment=production,version=v1.3.0
```

### 트러블슈팅 — Labels 관련 문제

```bash
# Service가 Pod를 찾지 못하는 경우 — selector와 labels 불일치 확인
kubectl get svc <service-name> -o jsonpath='{.spec.selector}'
kubectl get pods --show-labels | grep <app-label>

# 레이블 키/값이 규칙을 위반하는 경우
# 오류: "a valid label must be an empty string or consist of alphanumeric characters"
# 해결: 레이블 값은 영숫자, '-', '_', '.' 만 사용 가능하고 63자 이하여야 한다.
```

> **핵심 포인트**: labels는 Service의 selector가 Pod를 찾는 데 사용하고, annotations는 도구나 사람을 위한 부가 정보를 저장한다. labels는 검색/선택이 가능하고, annotations는 불가하다.

---

## 2.2 Deployment with Replicas and Strategy

### 배경

Pod를 직접 생성하면, Pod가 죽었을 때 자동으로 다시 생성되지 않는다. ReplicaSet은 Pod 수를 유지하지만, 롤링 업데이트 같은 배포 전략을 지원하지 않는다. Deployment는 ReplicaSet을 관리하면서 롤링 업데이트, 롤백, 스케일링 등 선언적 배포 관리를 제공하는 상위 추상화 계층이다. 계층 구조는 Deployment → ReplicaSet → Pod 순서이다.

Deployment의 내부 동작 원리 — 롤링 업데이트:
1. Deployment Controller가 이미지 변경을 감지한다.
2. 새로운 pod-template-hash를 가진 ReplicaSet을 생성한다.
3. 새 ReplicaSet의 replicas를 점진적으로 증가시킨다.
4. 동시에 이전 ReplicaSet의 replicas를 점진적으로 감소시킨다.
5. maxSurge와 maxUnavailable 설정에 따라 동시에 존재하는 Pod 수가 제어된다.
6. 완료되면 이전 ReplicaSet은 replicas=0으로 유지된다 (롤백에 사용).

```
롤링 업데이트 과정 (maxSurge=1, maxUnavailable=0, replicas=3)
====================================

  시점 0:                시점 1:              시점 2:              시점 3:
  [Old RS: 3]           [Old RS: 3]         [Old RS: 2]         [Old RS: 1]
  [New RS: 0]           [New RS: 1]         [New RS: 2]         [New RS: 3]
  총 Pod: 3             총 Pod: 4(+surge)   총 Pod: 4           총 Pod: 4

  시점 4:
  [Old RS: 0]  ← replicas=0 (삭제 안 됨, 롤백용)
  [New RS: 3]
  총 Pod: 3
```

Deployment의 업데이트 전략에는 두 가지가 있다:
- **RollingUpdate** (기본값): 새 버전의 Pod를 점진적으로 생성하고 기존 Pod를 점진적으로 제거한다. 무중단 배포가 가능하다.
- **Recreate**: 기존 Pod를 모두 제거한 후 새 Pod를 생성한다. 다운타임이 발생하지만, 두 버전이 동시에 실행되면 안 되는 경우(예: DB 스키마 변경, 파일 잠금)에 사용한다.

```yaml
apiVersion: apps/v1                     # Deployment는 apps 그룹의 v1 API를 사용
kind: Deployment                        # 리소스 종류: Deployment (선언적 Pod 배포 관리)
metadata:
  name: web-deployment                  # Deployment 이름
  labels:
    app: web                            # Deployment 자체에 붙이는 레이블
spec:                                   # Deployment 사양
  replicas: 3                           # 유지할 Pod 복제본 수 (3개의 동일한 Pod를 실행)
  selector:                             # 이 Deployment가 관리할 Pod를 찾는 기준
    matchLabels:
      app: web                          # app=web 레이블을 가진 Pod를 관리 대상으로 선택
  strategy:                             # 업데이트 전략 설정
    type: RollingUpdate                 # 롤링 업데이트: 점진적으로 새 버전 Pod로 교체 (무중단 배포)
    rollingUpdate:
      maxSurge: 1                       # 업데이트 중 replicas보다 최대 1개 더 생성 허용 (총 4개까지)
      maxUnavailable: 0                 # 업데이트 중 사용 불가 Pod 수 0 (항상 3개 유지)
  template:                             # Pod 템플릿 - 생성할 Pod의 명세
    metadata:
      labels:
        app: web                        # Pod에 붙일 레이블 (selector.matchLabels와 반드시 일치해야 함)
    spec:
      containers:
      - name: web                       # 컨테이너 이름
        image: nginx:1.25               # 컨테이너 이미지
        ports:
        - containerPort: 80             # 컨테이너 포트
        resources:                      # 리소스 요청/제한 설정
          requests:                     # 최소 보장 리소스 (스케줄링 기준)
            cpu: "100m"                 # CPU 100 밀리코어 요청 (1코어의 10%)
            memory: "128Mi"             # 메모리 128MiB 요청
          limits:                       # 최대 사용 가능 리소스 (초과 시 throttle/OOMKill)
            cpu: "250m"                 # CPU 최대 250 밀리코어
            memory: "256Mi"             # 메모리 최대 256MiB (초과 시 OOM으로 Pod 재시작)
```

### 검증 명령어

```bash
# 1. Deployment 생성
kubectl apply -f web-deployment.yaml
```

**검증 — 기대 출력:**

```text
deployment.apps/web-deployment created
```

```bash
# 2. Deployment 상태 확인
kubectl get deployment web-deployment
```

**검증 — 기대 출력:**

```text
NAME             READY   UP-TO-DATE   AVAILABLE   AGE
web-deployment   3/3     3            3           30s
```

```bash
# 3. Deployment가 생성한 ReplicaSet 확인
kubectl get replicaset -l app=web
```

**검증 — 기대 출력:**

```text
NAME                        DESIRED   CURRENT   READY   AGE
web-deployment-7d9f5b4c6    3         3         3       45s
```

```bash
# 4. 개별 Pod 확인
kubectl get pods -l app=web
```

**검증 — 기대 출력:**

```text
NAME                              READY   STATUS    RESTARTS   AGE
web-deployment-7d9f5b4c6-abc12    1/1     Running   0          60s
web-deployment-7d9f5b4c6-def34    1/1     Running   0          60s
web-deployment-7d9f5b4c6-ghi56    1/1     Running   0          60s
```

```bash
# 5. 롤링 업데이트 수행 후 상태 확인
kubectl set image deployment/web-deployment web=nginx:1.26
kubectl rollout status deployment/web-deployment
```

**검증 — 기대 출력:**

```text
Waiting for deployment "web-deployment" rollout to finish: 1 out of 3 new replicas have been updated...
Waiting for deployment "web-deployment" rollout to finish: 2 out of 3 new replicas have been updated...
Waiting for deployment "web-deployment" rollout to finish: 3 out of 3 new replicas have been updated...
Waiting for deployment "web-deployment" rollout to finish: 1 old replicas are pending termination...
deployment "web-deployment" successfully rolled out
```

```bash
# 6. 롤아웃 히스토리 확인
kubectl rollout history deployment/web-deployment
```

**검증 — 기대 출력:**

```text
deployment.apps/web-deployment
REVISION  CHANGE-CAUSE
1         <none>
2         <none>
```

```bash
# 7. 롤백 실행
kubectl rollout undo deployment/web-deployment
kubectl rollout status deployment/web-deployment
```

**검증 — 기대 출력:**

```text
deployment.apps/web-deployment rolled back
deployment "web-deployment" successfully rolled out
```

```bash
# 8. 롤백 후 이미지 확인
kubectl get deployment web-deployment -o jsonpath='{.spec.template.spec.containers[0].image}'
```

**검증 — 기대 출력:**

```text
nginx:1.25
```

### 트러블슈팅 — Deployment 관련 문제

```bash
# 롤링 업데이트가 멈춘 경우
kubectl rollout status deployment/web-deployment
# "Waiting for deployment ... rollout to finish" 메시지가 계속되면:
# 1. 새 Pod가 Ready가 되지 않는 원인 확인
kubectl get pods -l app=web
kubectl describe pod <pending-or-crashloop-pod>

# 2. 이미지가 존재하지 않는 경우
# "ImagePullBackOff" 상태 → 이미지 이름/태그 확인

# 3. readinessProbe 실패
# Pod는 Running이지만 READY가 0/1인 경우 → probe 설정 확인

# 4. 긴급 롤백
kubectl rollout undo deployment/web-deployment
```

> **핵심 포인트**: Deployment는 직접 Pod를 관리하지 않고 ReplicaSet을 생성하고, ReplicaSet이 Pod를 관리한다. strategy.type은 RollingUpdate(기본값)와 Recreate 두 가지가 있다. 롤링 업데이트 시 이전 ReplicaSet은 삭제되지 않고 replicas=0으로 유지되어 롤백에 사용된다.

---

# Part 3: 개념별 확인 문제 (40문항)

> 도메인별 비율: Kubernetes Fundamentals(18), Container Orchestration(9), Cloud Native Architecture(6), Observability(4), Application Delivery(3)
> 03-exam-questions.md의 문제와 중복되지 않도록 구성하였다.
> 각 문제에 대한 해설에는 내부 동작 원리와 CNCF 생태계 맥락을 포함하였다.

---

## Kubernetes Fundamentals (문제 1~18)

### 문제 1.
Pod Disruption Budget(PDB)의 역할로 올바른 것은?

A) Pod의 CPU와 메모리 사용량을 제한한다
B) 자발적 중단(voluntary disruption) 시 동시에 중단되는 Pod 수를 제한하여 가용성을 보장한다
C) Pod가 비정상 상태일 때 자동으로 재시작한다
D) 네트워크 장애로 인한 Pod 중단을 방지한다

<details>
<summary>정답 확인</summary>

**정답: B) 자발적 중단(voluntary disruption) 시 동시에 중단되는 Pod 수를 제한하여 가용성을 보장한다**

PDB는 노드 드레인, 클러스터 업그레이드 등 자발적 중단 상황에서 최소 가용 Pod 수(minAvailable) 또는 최대 중단 가능 Pod 수(maxUnavailable)를 설정하여 애플리케이션의 고가용성을 보장한다. 내부적으로 Eviction API를 통해 동작하며, `kubectl drain`이 Eviction 요청을 보내면 API 서버가 PDB를 확인하여 조건 위반 시 요청을 거부한다. 하드웨어 장애 같은 비자발적 중단은 PDB로 보호할 수 없다. A는 LimitRange/ResourceQuota의 역할, C는 livenessProbe의 역할, D는 NetworkPolicy의 역할이다.
</details>

---

### 문제 2.
CustomResourceDefinition(CRD)에 대한 설명으로 올바른 것은?

A) CRD를 등록하면 자동으로 커스텀 컨트롤러도 생성된다
B) CRD는 Kubernetes API를 확장하여 사용자 정의 리소스 타입을 추가하는 메커니즘이다
C) CRD는 오직 클러스터 관리자만 생성할 수 있으며 RBAC 제어가 불가능하다
D) CRD는 Kubernetes 1.0부터 존재한 핵심 기능이다

<details>
<summary>정답 확인</summary>

**정답: B) CRD는 Kubernetes API를 확장하여 사용자 정의 리소스 타입을 추가하는 메커니즘이다**

CRD를 등록하면 API 서버가 해당 리소스 타입에 대한 REST API 엔드포인트를 자동으로 생성하여 kubectl로 해당 리소스를 관리할 수 있게 된다. 그러나 실제 비즈니스 로직을 수행하려면 별도의 커스텀 컨트롤러가 필요하다. CRD + Custom Controller = Operator Pattern이다. CRD도 RBAC으로 접근 제어가 가능하다. CRD는 Kubernetes 1.7에서 도입되었으며, 이전에는 ThirdPartyResource라는 제한적인 메커니즘이 있었다.
</details>

---

### 문제 3.
Kubernetes API 서버가 요청을 처리하는 올바른 순서는?

A) Authorization → Authentication → Admission Control → etcd 저장
B) Authentication → Admission Control → Authorization → etcd 저장
C) Authentication → Authorization → Admission Control → etcd 저장
D) Admission Control → Authentication → Authorization → etcd 저장

<details>
<summary>정답 확인</summary>

**정답: C) Authentication → Authorization → Admission Control → etcd 저장**

API 서버는 먼저 요청자의 신원을 확인(Authentication: X.509 인증서, Bearer Token, OIDC 등), 그 다음 해당 작업의 권한을 확인(Authorization: RBAC, Node, Webhook 등), 마지막으로 Admission Controller가 요청을 검증/수정한 후 etcd에 저장한다. Admission Controller 내에서는 Mutating이 먼저 실행되고 Validating이 나중에 실행된다. 이 순서는 KCNA에서 매우 자주 출제되는 내용이다.
</details>

---

### 문제 4.
Mutating Admission Webhook과 Validating Admission Webhook의 차이점으로 올바른 것은?

A) Mutating은 요청을 수정할 수 있고, Validating은 요청을 허용하거나 거부만 할 수 있다
B) Mutating은 요청을 거부하고, Validating은 요청을 수정한다
C) 둘 다 요청을 수정할 수 있지만 실행 순서만 다르다
D) Mutating은 클러스터 범위이고, Validating은 네임스페이스 범위이다

<details>
<summary>정답 확인</summary>

**정답: A) Mutating은 요청을 수정할 수 있고, Validating은 요청을 허용하거나 거부만 할 수 있다**

Mutating Admission Webhook은 요청 객체를 변경할 수 있다(예: Istio의 사이드카 컨테이너 자동 주입, LimitRanger의 기본 리소스 제한 추가). JSON Patch를 반환하여 요청을 수정한다. Validating Admission Webhook은 요청을 검증하여 허용(allow)하거나 거부(deny)만 할 수 있다. Mutating이 먼저 실행되는 이유는, Mutating 단계에서 주입된 필드를 Validating 단계에서 검증할 수 있어야 하기 때문이다.
</details>

---

### 문제 5.
etcd 클러스터를 5개 노드로 구성했을 때, 최대 몇 개의 노드 장애까지 허용할 수 있는가?

A) 1개
B) 2개
C) 3개
D) 4개

<details>
<summary>정답 확인</summary>

**정답: B) 2개**

etcd는 Raft 합의 알고리즘을 사용하며, 과반수(quorum)가 유지되어야 정상 동작한다. 5개 노드의 과반수는 3개이므로, 최대 2개 노드까지 장애를 허용할 수 있다. 공식은 (n-1)/2이며, 이 때문에 etcd 노드 수는 홀수(3, 5, 7)로 구성하는 것이 권장된다. 4개 노드의 과반수는 3개이므로 1개 장애만 허용 가능하며, 이는 3개 노드와 동일하다. 따라서 4개 노드는 3개 노드 대비 추가 비용만 발생하고 장애 허용은 동일하다.
</details>

---

### 문제 6.
etcd 백업에 대한 설명으로 올바르지 않은 것은?

A) etcdctl snapshot save 명령으로 스냅샷을 생성할 수 있다
B) 스냅샷 파일에는 클러스터의 모든 상태 정보가 포함된다
C) etcd 백업 파일은 반드시 같은 클러스터 내부에만 저장해야 한다
D) 정기적인 백업은 클러스터 재해 복구(Disaster Recovery)의 핵심이다

<details>
<summary>정답 확인</summary>

**정답: C) etcd 백업 파일은 반드시 같은 클러스터 내부에만 저장해야 한다**

etcd 백업 파일은 클러스터 외부의 안전한 원격 스토리지(S3, GCS 등)에 저장하는 것이 모범 사례이다. 클러스터 내부에만 저장하면 클러스터 전체 장애 시 백업 파일도 함께 손실될 위험이 있다. 또한 백업 파일에는 Secret 데이터가 포함되어 있으므로 암호화하여 저장해야 한다.
</details>

---

### 문제 7.
Operator Pattern에 대한 설명으로 올바른 것은?

A) Kubernetes 내장 컨트롤러를 통칭하는 용어이다
B) CRD와 커스텀 컨트롤러를 결합하여 애플리케이션의 운영 지식을 자동화한 것이다
C) kubectl 명령어를 자동화하는 스크립트 패턴이다
D) Pod 내에서 여러 컨테이너를 실행하는 디자인 패턴이다

<details>
<summary>정답 확인</summary>

**정답: B) CRD와 커스텀 컨트롤러를 결합하여 애플리케이션의 운영 지식을 자동화한 것이다**

Operator는 CRD(사용자 정의 리소스 정의)와 Custom Controller(비즈니스 로직)를 결합하여, 인간 운영자의 운영 지식을 소프트웨어로 구현한 것이다. 단순한 스크립트 자동화와 다른 점은 Kubernetes의 Reconciliation Loop를 활용하여 지속적으로 원하는 상태를 유지한다는 것이다. CNCF 생태계에서 Prometheus Operator, cert-manager, ArgoCD 등이 대표적인 Operator이다. D는 Sidecar 패턴에 대한 설명이다.
</details>

---

### 문제 8.
kube-proxy의 기본 모드로 올바른 것은?

A) userspace
B) iptables
C) IPVS
D) eBPF

<details>
<summary>정답 확인</summary>

**정답: B) iptables**

kube-proxy는 Service의 ClusterIP를 실제 Pod IP로 변환하는 역할을 한다. 기본 모드는 iptables이며, iptables 규칙을 생성하여 DNAT(Destination NAT)를 수행한다. userspace 모드는 Kubernetes 초기 버전에서 사용된 레거시 방식으로, 모든 패킷이 kube-proxy 프로세스를 경유하여 성능이 낮다. IPVS 모드는 대규모 Service(수천 개)에서 iptables보다 성능이 우수하며, `--proxy-mode=ipvs`로 활성화한다. eBPF 모드는 kube-proxy가 아닌 Cilium이 제공하는 기능으로, kube-proxy를 완전히 대체한다.
</details>

---

### 문제 9.
Taint가 `NoExecute`로 설정된 노드에 이미 실행 중인 Pod는 어떻게 되는가?

A) 영향을 받지 않고 계속 실행된다
B) 해당 Taint를 toleration하지 않으면 퇴거(evict)된다
C) 즉시 삭제되고 다른 노드에서 재생성되지 않는다
D) Pod의 상태가 Unknown으로 변경된다

<details>
<summary>정답 확인</summary>

**정답: B) 해당 Taint를 toleration하지 않으면 퇴거(evict)된다**

Taint의 effect는 세 가지이다. `NoSchedule`은 새 Pod의 스케줄링만 차단하고 기존 Pod에는 영향 없다. `PreferNoSchedule`은 가능하면 스케줄링하지 않지만 강제는 아니다. `NoExecute`는 가장 강력하여, 기존에 실행 중인 Pod도 해당 Taint를 toleration하지 않으면 퇴거시킨다. 노드 장애 시 node controller가 자동으로 `node.kubernetes.io/not-ready:NoExecute` Taint를 추가하여, 해당 노드의 Pod를 다른 노드로 이동시킨다. `tolerationSeconds`를 설정하면 퇴거까지의 유예 시간을 지정할 수 있다.
</details>

---

### 문제 10.
HPA(Horizontal Pod Autoscaler)와 VPA(Vertical Pod Autoscaler)의 차이점으로 올바른 것은?

A) HPA는 Pod 수를 조정하고, VPA는 Pod의 리소스(CPU/메모리)를 조정한다
B) HPA는 노드 수를 조정하고, VPA는 Pod 수를 조정한다
C) HPA와 VPA는 동일한 기능을 하며 이름만 다르다
D) HPA는 수평 스케일링, VPA는 Pod를 삭제하여 부하를 줄인다

<details>
<summary>정답 확인</summary>

**정답: A) HPA는 Pod 수를 조정하고, VPA는 Pod의 리소스(CPU/메모리)를 조정한다**

HPA(Horizontal)는 Pod의 레플리카 수를 늘리거나 줄여 수평 확장한다. VPA(Vertical)는 개별 Pod의 requests/limits를 조정하여 수직 확장한다. VPA는 Pod를 재시작해야 리소스가 반영되므로, 현재 버전에서는 Pod를 삭제하고 새로운 리소스 설정으로 재생성한다. HPA와 VPA를 동시에 같은 CPU/메모리 메트릭으로 사용하면 충돌이 발생할 수 있으므로, VPA는 HPA가 사용하지 않는 메트릭(예: 커스텀 메트릭)에 적용하거나, VPA의 UpdateMode를 "Off"로 설정하여 추천만 받는 것이 권장된다. 노드 수를 조정하는 것은 Cluster Autoscaler이다.
</details>

---

### 문제 11.
LimitRange의 역할로 올바른 것은?

A) 클러스터 전체의 총 리소스 사용량을 제한한다
B) 네임스페이스 내 개별 Pod/Container의 리소스 기본값과 제한을 설정한다
C) 노드의 CPU/메모리 할당 비율을 설정한다
D) Pod의 네트워크 대역폭을 제한한다

<details>
<summary>정답 확인</summary>

**정답: B) 네임스페이스 내 개별 Pod/Container의 리소스 기본값과 제한을 설정한다**

LimitRange는 네임스페이스 범위에서 개별 Pod/Container에 대한 리소스 정책을 설정한다. 기능: (1) 기본 requests/limits 설정 — Pod에 리소스를 명시하지 않으면 LimitRange의 기본값이 자동 적용된다(Mutating Admission), (2) 최소/최대 리소스 제한 — Container의 requests/limits가 허용 범위를 벗어나면 거부된다(Validating Admission), (3) requests/limits 비율 제한. 클러스터 전체가 아닌 개별 Pod/Container 수준이라는 점이 핵심이다. 네임스페이스 전체의 총 리소스를 제한하는 것은 ResourceQuota이다.
</details>

---

### 문제 12.
ResourceQuota에 대한 설명으로 올바른 것은?

A) 개별 Pod의 리소스 사용량을 제한한다
B) 네임스페이스 내 총 리소스 사용량과 오브젝트 수를 제한한다
C) 클러스터 전체의 노드 수를 제한한다
D) Pod의 네트워크 연결 수를 제한한다

<details>
<summary>정답 확인</summary>

**정답: B) 네임스페이스 내 총 리소스 사용량과 오브젝트 수를 제한한다**

ResourceQuota는 네임스페이스 범위에서 총 리소스(CPU/메모리 requests/limits 합계)와 오브젝트 수(Pod, Service, ConfigMap, PVC 등의 최대 개수)를 제한한다. 멀티 테넌트 클러스터에서 특정 팀이 리소스를 독점하는 것을 방지하기 위해 사용한다. ResourceQuota가 설정되면, 해당 네임스페이스에 Pod를 생성할 때 반드시 requests/limits를 명시해야 한다(명시하지 않으면 quota 계산이 불가능하므로 거부). LimitRange와 함께 사용하면 기본값을 제공할 수 있다.
</details>

---

### 문제 13.
Pod의 Phase(상태)에 해당하지 않는 것은?

A) Pending
B) Running
C) Succeeded
D) Evicted

<details>
<summary>정답 확인</summary>

**정답: D) Evicted**

Pod Phase는 5가지이다: `Pending`(스케줄링 대기 또는 이미지 pull 중), `Running`(최소 1개 컨테이너 실행 중), `Succeeded`(모든 컨테이너 정상 종료, exit 0), `Failed`(최소 1개 컨테이너 비정상 종료), `Unknown`(kubelet과 통신 불가). `Evicted`는 Phase가 아닌 Pod의 reason 필드 값이다. kubelet이 노드의 리소스(디스크, 메모리) 부족 시 우선순위가 낮은 Pod를 축출할 때 `status.reason: Evicted`로 표시된다. CKA/CKAD에서도 자주 출제되는 내용이다.
</details>

---

### 문제 14.
Init Container에 대한 설명으로 올바른 것은?

A) 메인 컨테이너와 동시에 실행되며 보조 작업을 수행한다
B) 메인 컨테이너가 시작되기 전에 순서대로 실행되며, 모두 성공해야 메인 컨테이너가 시작된다
C) Pod가 종료될 때 정리 작업을 수행하는 컨테이너이다
D) 오직 데이터베이스 초기화에만 사용 가능하다

<details>
<summary>정답 확인</summary>

**정답: B) 메인 컨테이너가 시작되기 전에 순서대로 실행되며, 모두 성공해야 메인 컨테이너가 시작된다**

Init Container는 Pod의 메인 컨테이너보다 먼저 실행되는 특수 컨테이너이다. 여러 개의 Init Container가 있으면 정의된 순서대로 하나씩 실행되며, 이전 Init Container가 성공(exit 0)해야 다음이 시작된다. 사용 사례: (1) 데이터베이스가 준비될 때까지 대기, (2) 설정 파일 다운로드, (3) 외부 시크릿 주입, (4) 파일시스템 권한 설정. A는 Sidecar 패턴에 대한 설명이다. Kubernetes 1.28에서 도입된 Sidecar Container(restartPolicy: Always인 Init Container)는 메인 컨테이너와 함께 실행되는 공식 Sidecar 메커니즘이다.
</details>

---

### 문제 15.
Service Account에 대한 설명으로 올바른 것은?

A) 클러스터 관리자만 사용하는 인증 방법이다
B) Pod 내부에서 Kubernetes API에 접근할 때 사용하는 ID이다
C) 외부 사용자의 SSH 접속을 위한 계정이다
D) Service Account는 하나의 클러스터에 하나만 존재한다

<details>
<summary>정답 확인</summary>

**정답: B) Pod 내부에서 Kubernetes API에 접근할 때 사용하는 ID이다**

Service Account는 Pod(프로세스)가 Kubernetes API에 접근할 때 사용하는 ID이다. 각 네임스페이스에 `default` Service Account가 자동 생성되며, Pod에 별도 설정이 없으면 이 계정을 사용한다. Kubernetes 1.24부터는 Service Account에 자동으로 Secret이 생성되지 않으며, TokenRequest API를 통해 시간 제한이 있는 토큰(bound token)이 발급된다. 이 토큰은 `/var/run/secrets/kubernetes.io/serviceaccount/token`에 마운트된다. RBAC(Role/RoleBinding, ClusterRole/ClusterRoleBinding)으로 Service Account의 권한을 세밀하게 제어할 수 있다.
</details>

---

### 문제 16.
`kubectl drain` 명령에 대한 설명으로 올바른 것은?

A) 노드의 모든 Pod를 즉시 삭제하고 다른 노드에서 재생성하지 않는다
B) 노드를 SchedulingDisabled로 표시하고, Eviction API로 Pod를 안전하게 퇴거시킨다
C) 노드의 디스크를 초기화한다
D) 노드의 네트워크 설정을 리셋한다

<details>
<summary>정답 확인</summary>

**정답: B) 노드를 SchedulingDisabled로 표시하고, Eviction API로 Pod를 안전하게 퇴거시킨다**

`kubectl drain`은 내부적으로 두 단계를 수행한다. (1) `kubectl cordon`으로 노드를 SchedulingDisabled로 표시하여 새 Pod가 스케줄링되지 않도록 한다. (2) 노드의 각 Pod에 대해 Eviction API를 호출하여 안전하게 퇴거시킨다. Eviction API는 PDB를 확인하므로, PDB 조건이 위반되면 퇴거가 차단된다. DaemonSet Pod는 기본적으로 건너뛰며, `--ignore-daemonsets` 옵션이 필요하다. 로컬 스토리지(emptyDir)를 사용하는 Pod도 기본적으로 건너뛰며, `--delete-emptydir-data` 옵션이 필요하다.
</details>

---

### 문제 17.
선언적(Declarative) 관리 방식의 특징으로 올바른 것은?

A) 명령어로 단계별 작업을 지시한다 (예: kubectl create, kubectl scale)
B) 원하는 최종 상태를 정의하고, 시스템이 현재 상태를 원하는 상태로 조정한다
C) 변경 이력을 추적할 수 없다
D) 오직 YAML 파일로만 가능하며 JSON은 지원하지 않는다

<details>
<summary>정답 확인</summary>

**정답: B) 원하는 최종 상태를 정의하고, 시스템이 현재 상태를 원하는 상태로 조정한다**

선언적 관리는 `kubectl apply -f manifest.yaml`로 수행하며, 원하는 상태(desired state)를 정의하면 Kubernetes가 현재 상태와 비교하여 필요한 조치를 자동으로 수행한다. 명령적(Imperative) 방식은 `kubectl create`, `kubectl scale` 같은 명령어로 개별 작업을 지시하는 방식이다. 선언적 방식의 장점: (1) 재현성 — 같은 매니페스트를 적용하면 항상 같은 결과, (2) 버전 관리 — YAML 파일을 Git에 저장하여 변경 이력 추적, (3) GitOps 호환 — ArgoCD/Flux와 연동 가능. Kubernetes는 YAML과 JSON 모두 지원한다.
</details>

---

### 문제 18.
Headless Service(ClusterIP: None)의 특징으로 올바른 것은?

A) 외부에서 직접 접근할 수 있는 IP를 제공한다
B) ClusterIP를 할당하지 않고, DNS 조회 시 개별 Pod IP를 직접 반환한다
C) Service 앞에 로드밸런서를 배치한다
D) 오직 StatefulSet에서만 사용 가능하다

<details>
<summary>정답 확인</summary>

**정답: B) ClusterIP를 할당하지 않고, DNS 조회 시 개별 Pod IP를 직접 반환한다**

일반 ClusterIP Service는 DNS 조회 시 가상 IP(ClusterIP)를 반환하고, kube-proxy가 이 IP를 실제 Pod IP로 변환한다. Headless Service는 ClusterIP를 할당하지 않으므로, DNS 조회 시 A 레코드로 개별 Pod의 IP를 직접 반환한다. 이는 클라이언트 측 로드밸런싱이나, StatefulSet의 각 Pod에 안정적인 DNS 이름을 부여할 때 사용한다(예: `postgres-0.postgres-headless.demo.svc.cluster.local`). StatefulSet 전용은 아니며, 일반 Deployment에서도 사용 가능하다.
</details>

---

## Container Orchestration (문제 19~27)

### 문제 19.
CNI(Container Network Interface)의 역할로 올바른 것은?

A) 컨테이너 이미지를 빌드하는 표준 인터페이스이다
B) 컨테이너의 네트워크 인터페이스를 설정하고 IP를 할당하는 표준 플러그인 인터페이스이다
C) 컨테이너의 스토리지를 관리하는 인터페이스이다
D) 컨테이너 런타임의 라이프사이클을 관리하는 인터페이스이다

<details>
<summary>정답 확인</summary>

**정답: B) 컨테이너의 네트워크 인터페이스를 설정하고 IP를 할당하는 표준 플러그인 인터페이스이다**

CNI는 CNCF 프로젝트로, 컨테이너 런타임이 컨테이너의 네트워크를 설정할 때 사용하는 표준 인터페이스이다. Pod가 생성되면 kubelet이 CNI 플러그인을 호출하여 veth pair 생성, IP 할당, 라우팅 설정을 수행한다. 대표적인 CNI 플러그인: Cilium(eBPF 기반, L7 정책), Calico(BGP 기반, iptables 정책), Flannel(VXLAN, 간단한 오버레이), Weave Net(메시 네트워크). C는 CSI(Container Storage Interface)의 역할, D는 CRI(Container Runtime Interface)의 역할이다.
</details>

---

### 문제 20.
CSI(Container Storage Interface)에 대한 설명으로 올바른 것은?

A) 컨테이너 이미지의 보안을 검사하는 인터페이스이다
B) 스토리지 벤더가 Kubernetes에 맞는 드라이버를 개발할 수 있는 표준 인터페이스이다
C) 오직 로컬 디스크만 지원하는 인터페이스이다
D) kubelet과 컨테이너 런타임 사이의 통신 인터페이스이다

<details>
<summary>정답 확인</summary>

**정답: B) 스토리지 벤더가 Kubernetes에 맞는 드라이버를 개발할 수 있는 표준 인터페이스이다**

CSI는 Kubernetes와 스토리지 시스템 사이의 표준 인터페이스이다. CSI 이전에는 스토리지 드라이버가 Kubernetes 코드에 직접 포함(in-tree)되어야 했으므로, 새 스토리지를 지원하려면 Kubernetes 자체를 수정해야 했다. CSI를 통해 스토리지 벤더가 독립적으로 드라이버를 개발하고 배포할 수 있다(out-of-tree). 대표적인 CSI 드라이버: AWS EBS CSI, GCE PD CSI, NFS CSI, local-path-provisioner. CRI(Container Runtime Interface), CNI(Container Network Interface)와 함께 Kubernetes의 3대 플러그인 인터페이스를 구성한다.
</details>

---

### 문제 21.
Sidecar 패턴에 대한 설명으로 올바른 것은?

A) Pod 내에 메인 컨테이너와 보조 컨테이너를 함께 실행하여 로깅, 프록시 등의 부가 기능을 제공한다
B) 메인 컨테이너가 시작되기 전에 초기화 작업을 수행하는 패턴이다
C) 하나의 Pod에 하나의 컨테이너만 실행하는 패턴이다
D) Pod 간에 네트워크를 공유하는 패턴이다

<details>
<summary>정답 확인</summary>

**정답: A) Pod 내에 메인 컨테이너와 보조 컨테이너를 함께 실행하여 로깅, 프록시 등의 부가 기능을 제공한다**

Sidecar 패턴은 Pod 내에 메인 컨테이너와 하나 이상의 보조 컨테이너를 배치하여, 메인 애플리케이션을 수정하지 않고 부가 기능을 추가하는 패턴이다. 동일 Pod 내 컨테이너는 네트워크 네임스페이스(localhost 통신), 스토리지(emptyDir 공유), PID 네임스페이스를 공유한다. 대표적 사용 사례: (1) Istio Envoy 프록시 — mTLS, 트래픽 관리, (2) Fluentd/Promtail — 로그 수집, (3) Vault Agent — 시크릿 주입. B는 Init Container 패턴이다. Kubernetes 1.28에서 네이티브 Sidecar Container(`initContainers`에 `restartPolicy: Always` 지정)가 도입되어 라이프사이클 관리가 개선되었다.
</details>

---

### 문제 22.
컨테이너 이미지의 레이어(Layer)에 대한 설명으로 올바른 것은?

A) 각 레이어는 독립적이며 다른 이미지와 공유할 수 없다
B) Dockerfile의 각 명령어가 읽기 전용 레이어를 생성하며, 레이어는 여러 이미지 간에 공유된다
C) 레이어는 컨테이너가 실행될 때 동적으로 생성된다
D) 이미지는 항상 단일 레이어로 구성된다

<details>
<summary>정답 확인</summary>

**정답: B) Dockerfile의 각 명령어가 읽기 전용 레이어를 생성하며, 레이어는 여러 이미지 간에 공유된다**

컨테이너 이미지는 Union Filesystem(OverlayFS)을 사용하여 여러 읽기 전용 레이어를 겹쳐서 하나의 파일시스템처럼 보이게 한다. Dockerfile의 `FROM`, `RUN`, `COPY`, `ADD` 등의 명령어가 각각 하나의 레이어를 생성한다. 동일한 베이스 이미지를 사용하는 여러 컨테이너는 베이스 레이어를 공유하여 디스크 공간과 이미지 pull 시간을 절약한다. 컨테이너가 파일을 수정하면 최상위의 쓰기 가능 레이어(container layer)에만 변경이 기록된다(Copy-on-Write).
</details>

---

### 문제 23.
멀티 스테이지 빌드(Multi-stage Build)의 주요 목적은?

A) 여러 이미지를 동시에 빌드한다
B) 빌드 도구를 최종 이미지에서 제외하여 이미지 크기를 줄인다
C) 여러 플랫폼(amd64, arm64)에 대한 이미지를 동시에 빌드한다
D) Dockerfile 없이 이미지를 빌드한다

<details>
<summary>정답 확인</summary>

**정답: B) 빌드 도구를 최종 이미지에서 제외하여 이미지 크기를 줄인다**

멀티 스테이지 빌드는 하나의 Dockerfile에 여러 `FROM` 문을 사용하여, 빌드 단계와 실행 단계를 분리한다. 빌드 단계에서 컴파일러, 패키지 매니저 등을 사용하고, 최종 단계에서는 빌드 결과물(바이너리)만 복사한다. 예를 들어, Go 애플리케이션의 빌드 이미지는 1GB 이상이지만, 멀티 스테이지 빌드로 최종 이미지를 10MB 이하로 줄일 수 있다. 이는 보안(공격 표면 감소)과 성능(이미지 pull 시간 단축) 양쪽에 이점이 있다. C는 `docker buildx`의 multi-platform 빌드에 대한 설명이다.
</details>

---

### 문제 24.
CRI-O에 대한 설명으로 올바른 것은?

A) Docker Engine의 새로운 이름이다
B) Kubernetes CRI를 구현한 경량 컨테이너 런타임으로, OCI 호환 런타임을 사용한다
C) 오직 Red Hat 운영체제에서만 동작한다
D) 컨테이너 이미지를 빌드하는 도구이다

<details>
<summary>정답 확인</summary>

**정답: B) Kubernetes CRI를 구현한 경량 컨테이너 런타임으로, OCI 호환 런타임을 사용한다**

CRI-O는 Kubernetes 전용으로 설계된 경량 컨테이너 런타임이다. containerd와 마찬가지로 CRI(Container Runtime Interface)를 구현하며, OCI(Open Container Initiative) 호환 런타임(runc, crun)을 사용하여 실제 컨테이너를 실행한다. containerd가 Docker 생태계에서 분리된 범용 런타임인 반면, CRI-O는 처음부터 Kubernetes만을 위해 설계되어 불필요한 기능이 없다. Red Hat OpenShift에서 기본 런타임으로 사용되지만, 다른 리눅스 배포판에서도 동작한다. CNCF Incubating 프로젝트이다.
</details>

---

### 문제 25.
`docker tag`(또는 이미지 태그)에 대한 설명으로 올바르지 않은 것은?

A) 태그는 이미지의 특정 버전을 식별하는 레이블이다
B) `latest` 태그는 항상 가장 최신 이미지를 가리킨다
C) 하나의 이미지에 여러 태그를 부여할 수 있다
D) 태그를 지정하지 않으면 기본적으로 `latest`가 사용된다

<details>
<summary>정답 확인</summary>

**정답: B) `latest` 태그는 항상 가장 최신 이미지를 가리킨다**

`latest`는 특별한 의미가 있는 태그가 아니라, 태그를 지정하지 않았을 때 사용되는 기본값일 뿐이다. `latest`가 실제로 최신 이미지를 가리키는지는 보장되지 않는다. 이미지 관리자가 다른 태그를 push한 후 `latest`를 업데이트하지 않으면, `latest`는 오래된 이미지를 가리킬 수 있다. 프로덕션 환경에서는 `latest` 대신 명시적 버전 태그(예: `nginx:1.25.3`)를 사용하는 것이 모범 사례이다. 이는 재현 가능한 배포와 롤백을 보장한다.
</details>

---

### 문제 26.
Pod Security Standards(PSS)의 세 가지 수준(level)으로 올바른 것은?

A) Low, Medium, High
B) Privileged, Baseline, Restricted
C) Allow, Warn, Deny
D) Open, Standard, Strict

<details>
<summary>정답 확인</summary>

**정답: B) Privileged, Baseline, Restricted**

Pod Security Standards는 Pod Security Admission(PSA)에서 사용하는 세 가지 정책 수준이다. `Privileged`는 제한 없음(특권 컨테이너, hostNetwork 등 모두 허용), `Baseline`은 알려진 위험한 설정을 차단(hostNetwork, hostPID 등 금지, 비특권 컨테이너), `Restricted`는 가장 엄격(runAsNonRoot 필수, 특정 seccomp 프로필 필수, 권한 상승 금지). PSA는 네임스페이스 레이블로 적용하며, `enforce`(거부), `warn`(경고만), `audit`(감사 로그만) 세 가지 모드가 있다. PSS/PSA는 Kubernetes 1.25에서 GA가 되었으며, 이전의 PodSecurityPolicy(PSP)를 대체한다.
</details>

---

### 문제 27.
gVisor와 Kata Containers에 대한 설명으로 올바른 것은?

A) 둘 다 컨테이너 이미지를 빌드하는 도구이다
B) 둘 다 컨테이너의 보안을 강화하는 샌드박스 런타임이며, gVisor는 커널 시스템 콜을 가로채고 Kata는 경량 VM을 사용한다
C) 둘 다 Kubernetes에서 공식 지원하는 CNI 플러그인이다
D) gVisor는 네트워크 보안, Kata는 스토리지 보안을 담당한다

<details>
<summary>정답 확인</summary>

**정답: B) 둘 다 컨테이너의 보안을 강화하는 샌드박스 런타임이며, gVisor는 커널 시스템 콜을 가로채고 Kata는 경량 VM을 사용한다**

기본 컨테이너 런타임(runc)은 호스트 커널을 직접 공유하므로, 커널 취약점을 통해 컨테이너 탈출(container escape)이 가능하다. gVisor(Google)는 사용자 공간에서 커널 시스템 콜을 가로채는 "Sentry" 프로세스를 통해 컨테이너와 호스트 커널 사이에 추가 격리 계층을 제공한다. Kata Containers는 경량 가상 머신(lightweight VM) 안에서 컨테이너를 실행하여 하드웨어 수준의 격리를 제공한다. 둘 다 OCI 호환 런타임이므로 Kubernetes RuntimeClass를 통해 Pod별로 선택적으로 사용할 수 있다.
</details>

---

## Cloud Native Architecture (문제 28~33)

### 문제 28.
12-Factor App의 Factor III(Config)에서 권장하는 설정 관리 방법은?

A) 소스 코드에 설정값을 하드코딩한다
B) 설정을 코드와 분리하여 환경 변수에 저장한다
C) 설정 파일을 컨테이너 이미지에 포함한다
D) 설정은 데이터베이스에만 저장해야 한다

<details>
<summary>정답 확인</summary>

**정답: B) 설정을 코드와 분리하여 환경 변수에 저장한다**

12-Factor App은 Heroku의 엔지니어들이 정리한 클라우드 네이티브 애플리케이션 설계 원칙이다. Factor III(Config)는 설정(데이터베이스 URL, API 키, 외부 서비스 엔드포인트 등)을 코드와 분리하여 환경 변수에 저장할 것을 권장한다. 이를 통해 동일한 코드를 환경(dev/staging/prod)에 따라 다른 설정으로 실행할 수 있다. Kubernetes에서는 ConfigMap과 Secret이 이 원칙을 구현하는 핵심 메커니즘이다. 12-Factor의 다른 핵심 원칙: I(Codebase — 하나의 코드베이스, 여러 배포), VI(Processes — 무상태 프로세스), IX(Disposability — 빠른 시작과 우아한 종료).
</details>

---

### 문제 29.
Service Mesh의 주요 기능으로 올바르지 않은 것은?

A) 서비스 간 mTLS(상호 TLS) 암호화
B) 트래픽 관리(카나리 배포, 트래픽 분할)
C) 컨테이너 이미지 빌드 자동화
D) 분산 추적(Distributed Tracing)과 관측성

<details>
<summary>정답 확인</summary>

**정답: C) 컨테이너 이미지 빌드 자동화**

Service Mesh는 마이크로서비스 간 통신을 관리하는 인프라 계층이다. 핵심 기능: (1) 보안 — mTLS로 서비스 간 통신을 자동 암호화하고 인증한다, (2) 트래픽 관리 — 카나리 배포, A/B 테스팅, 트래픽 미러링, 서킷 브레이커, 타임아웃, 재시도, (3) 관측성 — 서비스 간 지연시간, 에러율, 처리량(RED 메트릭)을 자동 수집한다. 이 기능들은 사이드카 프록시(Envoy)가 제공하므로, 애플리케이션 코드를 수정하지 않아도 된다. 대표적인 Service Mesh: Istio(CNCF 외), Linkerd(CNCF Graduated). 이미지 빌드는 CI 도구(Jenkins, GitHub Actions 등)의 영역이다.
</details>

---

### 문제 30.
Istio의 istiod 컴포넌트에 대한 설명으로 올바른 것은?

A) 각 Pod에 주입되는 사이드카 프록시이다
B) Pilot, Citadel, Galley 기능을 통합한 단일 컨트롤 플레인 컴포넌트이다
C) Istio의 CLI 도구이다
D) 외부 트래픽을 클러스터로 라우팅하는 Ingress Gateway이다

<details>
<summary>정답 확인</summary>

**정답: B) Pilot, Citadel, Galley 기능을 통합한 단일 컨트롤 플레인 컴포넌트이다**

Istio 1.5 이전에는 Pilot(트래픽 관리, xDS 설정 배포), Citadel(인증서 발급, mTLS), Galley(설정 검증) 등 여러 컴포넌트가 분리되어 있었다. 이는 배포와 운영이 복잡하고 컴포넌트 간 통신 오버헤드가 있었다. Istio 1.5부터 이 기능들을 istiod라는 단일 바이너리로 통합하여, 배포 단순화와 성능 향상을 달성하였다. istiod는 Envoy 사이드카에 xDS API로 설정을 배포하고, 인증서를 발급하며, 설정을 검증한다. A는 Envoy 프록시(사이드카)에 대한 설명이다.
</details>

---

### 문제 31.
FinOps에 대한 설명으로 올바른 것은?

A) 금융 서비스를 위한 Kubernetes 배포 패턴이다
B) 클라우드 비용을 엔지니어링, 재무, 비즈니스 팀이 협력하여 최적화하는 운영 모델이다
C) 컨테이너의 네트워크 비용을 계산하는 도구이다
D) Kubernetes 클러스터의 라이선스 관리 방법이다

<details>
<summary>정답 확인</summary>

**정답: B) 클라우드 비용을 엔지니어링, 재무, 비즈니스 팀이 협력하여 최적화하는 운영 모델이다**

FinOps(Cloud Financial Operations)는 클라우드 비용에 대한 가시성을 확보하고, 엔지니어링 팀이 비용을 고려한 의사결정을 내릴 수 있도록 하는 운영 모델이다. Kubernetes 환경에서의 FinOps 실천 사항: (1) 리소스 requests/limits를 적절히 설정하여 과대 프로비저닝 방지, (2) HPA/VPA로 사용량에 맞는 자동 스케일링, (3) Spot/Preemptible 인스턴스 활용, (4) 네임스페이스별 ResourceQuota로 비용 할당, (5) Kubecost, OpenCost 같은 도구로 비용 가시성 확보. KCNA에서 FinOps 개념은 Cloud Native Architecture 도메인에서 출제될 수 있다.
</details>

---

### 문제 32.
Sidecar-less Service Mesh(Ambient Mesh)의 특징으로 올바른 것은?

A) Service Mesh의 모든 기능을 제거하여 성능을 높인다
B) 사이드카 프록시 없이 노드 레벨의 프록시와 L7 워크로드 프록시로 기능을 제공한다
C) 오직 L3/L4 트래픽만 처리할 수 있다
D) 기존 Sidecar 방식과 호환되지 않는다

<details>
<summary>정답 확인</summary>

**정답: B) 사이드카 프록시 없이 노드 레벨의 프록시와 L7 워크로드 프록시로 기능을 제공한다**

전통적인 Service Mesh(Istio, Linkerd)는 각 Pod에 사이드카 프록시를 주입하여 동작한다. 이 방식은 Pod 수만큼 프록시가 필요하여 리소스 오버헤드가 크고, 사이드카 주입/업그레이드 관리가 복잡하다. Istio Ambient Mesh는 두 계층으로 분리한다: (1) ztunnel — 각 노드에 1개씩 배포되는 L4 프록시로, mTLS와 L4 정책을 처리한다, (2) waypoint proxy — 필요한 서비스에만 배포되는 L7 프록시로, HTTP 라우팅, 재시도 등을 처리한다. 이를 통해 사이드카 없이도 Service Mesh 기능을 제공하면서 리소스 사용량을 크게 줄인다.
</details>

---

### 문제 33.
다음 중 CNCF Graduated 프로젝트가 아닌 것은?

A) Kubernetes
B) Prometheus
C) Istio
D) Helm

<details>
<summary>정답 확인</summary>

**정답: C) Istio**

Istio는 CNCF 프로젝트가 아니다(2022년 CNCF에 기부되어 현재 Graduated 상태이다 — 주의: 시험 시점에 따라 달라질 수 있으므로 최신 정보를 확인해야 한다). Kubernetes(2018 Graduated), Prometheus(2018 Graduated), Helm(2020 Graduated)은 모두 CNCF Graduated 프로젝트이다. 다른 주요 Graduated 프로젝트: Envoy, CoreDNS, containerd, Fluentd, Jaeger, Vitess, TUF, Cilium, Argo, Flux. CNCF Landscape(https://landscape.cncf.io)에서 최신 성숙도 단계를 확인하는 것이 중요하다. 시험에서는 특정 프로젝트의 성숙도 단계를 묻는 문제가 자주 출제된다.
</details>

---

## Cloud Native Observability (문제 34~37)

### 문제 34.
Prometheus의 4가지 메트릭 타입에 해당하지 않는 것은?

A) Counter
B) Gauge
C) Histogram
D) Timer

<details>
<summary>정답 확인</summary>

**정답: D) Timer**

Prometheus의 4가지 메트릭 타입: (1) `Counter` — 단조 증가하는 누적값(예: 총 요청 수, 총 에러 수). 리셋 시에만 0으로 돌아간다. `rate()`와 함께 사용하여 초당 비율을 계산한다. (2) `Gauge` — 증가/감소하는 현재값(예: CPU 사용률, 메모리 사용량, 큐 길이). 그대로 사용한다. (3) `Histogram` — 값의 분포를 버킷(bucket)별로 누적 카운트한다(예: 요청 지연시간). `histogram_quantile()`로 백분위수를 계산한다. (4) `Summary` — Histogram과 유사하지만 클라이언트 측에서 백분위수를 계산한다. Timer는 Prometheus 메트릭 타입이 아니다. Histogram과 Summary의 차이: Histogram은 서버 측에서 집계 가능하지만, Summary는 클라이언트 측에서 계산되어 여러 인스턴스 간 집계가 불가능하다.
</details>

---

### 문제 35.
Grafana에 대한 설명으로 올바르지 않은 것은?

A) 다양한 데이터 소스(Prometheus, Loki, InfluxDB 등)를 지원하는 시각화 도구이다
B) CNCF Graduated 프로젝트이다
C) Dashboard, Panel, Row 구조로 시각화를 구성한다
D) 변수(Variables)를 사용하여 동적 대시보드를 만들 수 있다

<details>
<summary>정답 확인</summary>

**정답: B) CNCF Graduated 프로젝트이다**

Grafana는 Grafana Labs가 개발한 오픈소스 시각화 도구이며, CNCF 프로젝트가 아니다. Apache 2.0 라이선스로 공개되어 있지만, CNCF의 거버넌스 아래에 있지 않다. 그러나 Cloud Native 관측성 스택의 사실상 표준 시각화 도구로, Prometheus, Loki, Tempo, Mimir 등과 긴밀하게 연동된다. Grafana의 구조: Dashboard(대시보드)는 여러 Panel(패널)을 포함하고, Panel은 특정 Data Source에서 쿼리하여 시각화한다. Variables는 드롭다운으로 네임스페이스, Pod 등을 선택할 수 있게 하여 하나의 대시보드를 여러 대상에 재사용할 수 있다.
</details>

---

### 문제 36.
Loki에 대한 설명으로 올바른 것은?

A) 메트릭을 수집하고 저장하는 시계열 데이터베이스이다
B) 로그 본문을 인덱싱하지 않고 레이블만 인덱싱하여 경량 로그 집계를 제공한다
C) 분산 추적(Distributed Tracing)을 위한 도구이다
D) 컨테이너 로그를 자동으로 삭제하는 도구이다

<details>
<summary>정답 확인</summary>

**정답: B) 로그 본문을 인덱싱하지 않고 레이블만 인덱싱하여 경량 로그 집계를 제공한다**

Loki는 Grafana Labs가 개발한 로그 집계 시스템으로, "Prometheus for logs"라고 불린다. 핵심 설계 결정: 로그 본문을 전문 검색 인덱스(inverted index)로 인덱싱하지 않고, 메타데이터 레이블(namespace, pod, container 등)만 인덱싱한다. 이로 인해 Elasticsearch 대비 인덱스 크기가 100배 이상 작고, 운영 복잡도가 낮다. 단점은 레이블로 필터링한 후 로그 본문을 grep하는 방식이므로, 대량의 로그에서 특정 문자열을 검색할 때 느릴 수 있다. Promtail(또는 Grafana Alloy)이 로그를 수집하여 Loki로 전송하고, Grafana에서 LogQL로 조회한다. A는 Prometheus, C는 Jaeger/Tempo에 대한 설명이다.
</details>

---

### 문제 37.
Jaeger에 대한 설명으로 올바른 것은?

A) 메트릭 수집 및 알림 도구이다
B) 마이크로서비스 환경에서 분산 추적(Distributed Tracing)을 제공하는 CNCF Graduated 프로젝트이다
C) 로그 집계 시스템이다
D) 서비스 메시의 데이터 플레인이다

<details>
<summary>정답 확인</summary>

**정답: B) 마이크로서비스 환경에서 분산 추적(Distributed Tracing)을 제공하는 CNCF Graduated 프로젝트이다**

Jaeger(예거)는 Uber에서 개발한 분산 추적 시스템으로, CNCF Graduated 프로젝트이다. 마이크로서비스 환경에서 하나의 요청이 여러 서비스를 거치면서 발생하는 지연시간을 추적(trace)한다. 각 서비스에서의 처리 시간(span)을 수집하여, 전체 요청 경로를 시각화한다. 이를 통해 병목 지점을 식별할 수 있다. 관측성의 3대 축(Three Pillars of Observability): 메트릭(Prometheus), 로그(Loki), 추적(Jaeger/Tempo). OpenTelemetry(CNCF Incubating)는 이 세 가지 데이터를 통합적으로 수집하는 표준 프레임워크이다. Grafana Tempo는 Jaeger의 대안으로, 오브젝트 스토리지에 trace를 저장하여 운영 비용을 줄인다.
</details>

---

## Cloud Native Application Delivery (문제 38~40)

### 문제 38.
Helm Chart에 대한 설명으로 올바른 것은?

A) Kubernetes 클러스터를 설치하는 도구이다
B) Go 템플릿 기반의 Kubernetes 리소스 패키지로, values 파일로 설정을 주입한다
C) Docker 이미지를 빌드하는 설정 파일이다
D) Kubernetes API 서버의 확장 기능이다

<details>
<summary>정답 확인</summary>

**정답: B) Go 템플릿 기반의 Kubernetes 리소스 패키지로, values 파일로 설정을 주입한다**

Helm은 CNCF Graduated 프로젝트로, Kubernetes의 패키지 매니저이다. Chart는 관련된 Kubernetes 리소스를 하나의 패키지로 묶은 것이다. Go 템플릿 엔진을 사용하여 `{{ .Values.replicaCount }}` 같은 변수를 YAML에 삽입하고, values.yaml 파일이나 `--set` 플래그로 값을 주입한다. 이를 통해 동일한 Chart를 환경별로 다른 설정으로 배포할 수 있다. Helm의 3가지 핵심 개념: Chart(패키지), Release(Chart의 설치된 인스턴스), Repository(Chart 저장소). Helm 3부터 Tiller(서버 사이드 컴포넌트)가 제거되어 보안이 향상되었다.
</details>

---

### 문제 39.
Kustomize에 대한 설명으로 올바른 것은?

A) Helm과 동일한 기능을 제공하는 외부 도구이다
B) 템플릿 없이 YAML 오버레이(overlay) 방식으로 환경별 커스터마이징을 수행하며, kubectl에 내장되어 있다
C) Kubernetes API 서버에서 실행되는 Admission Controller이다
D) 오직 ConfigMap과 Secret만 관리할 수 있다

<details>
<summary>정답 확인</summary>

**정답: B) 템플릿 없이 YAML 오버레이(overlay) 방식으로 환경별 커스터마이징을 수행하며, kubectl에 내장되어 있다**

Kustomize는 Kubernetes 1.14부터 kubectl에 내장된 설정 관리 도구이다(`kubectl apply -k`). Helm이 Go 템플릿으로 YAML을 생성하는 반면, Kustomize는 기본 YAML(base)에 환경별 패치(overlay)를 적용하는 방식이다. 템플릿 엔진이 없으므로 YAML의 유효성이 항상 보장된다. 주요 기능: (1) patches — 기존 리소스의 특정 필드를 변경, (2) namePrefix/nameSuffix — 리소스 이름에 접두/접미사 추가, (3) commonLabels — 모든 리소스에 레이블 추가, (4) configMapGenerator/secretGenerator — ConfigMap/Secret 자동 생성. Helm vs Kustomize는 KCNA에서 자주 비교 출제된다.
</details>

---

### 문제 40.
GitOps에서 Pull-based 모델이 Push-based 모델보다 보안에 유리한 이유는?

A) Git 저장소에 접근 권한이 필요 없기 때문이다
B) CI 시스템에 클러스터 접근 권한(kubeconfig)을 부여할 필요가 없기 때문이다
C) 암호화된 통신만 사용하기 때문이다
D) 배포 속도가 더 빠르기 때문이다

<details>
<summary>정답 확인</summary>

**정답: B) CI 시스템에 클러스터 접근 권한(kubeconfig)을 부여할 필요가 없기 때문이다**

Push-based 모델에서는 CI 서버(Jenkins 등)가 `kubectl apply`로 클러스터에 직접 배포하므로, CI 서버에 클러스터의 kubeconfig(또는 Service Account 토큰)를 저장해야 한다. CI 서버가 침해되면 클러스터에 대한 전체 접근 권한이 노출된다. Pull-based 모델(ArgoCD, Flux)에서는 클러스터 내부의 에이전트가 Git 저장소를 감시하고 배포하므로, 클러스터 접근 권한이 클러스터 외부로 노출되지 않는다. 에이전트는 Git 저장소의 읽기 권한만 필요하며, 이는 공격 표면(attack surface)을 크게 줄인다. 이것이 GitOps가 보안 모범 사례로 권장되는 핵심 이유이다.
</details>

---

# Part 4: 기출 유형 덤프 문제 (30문항)

> 실제 KCNA 시험에서 자주 보고되는 유형을 기반으로 구성한 문제이다.
> 도메인 비중에 따라 Kubernetes Fundamentals에 더 많은 문제를 배정하였다.
> 각 문제 해설에 내부 동작 원리, CNCF 생태계 맥락, 트러블슈팅 정보를 포함하였다.

---

### 문제 1.
Kubernetes에서 클러스터 DNS를 담당하는 기본 컴포넌트는?

A) kube-dns
B) CoreDNS
C) Bind9
D) dnsmasq

<details>
<summary>정답 확인</summary>

**정답: B) CoreDNS**

Kubernetes 1.13부터 CoreDNS가 기본 클러스터 DNS 서버로 채택되었다. CoreDNS는 CNCF Graduated 프로젝트이며, 플러그인 기반 아키텍처로 유연한 DNS 설정이 가능하다. Corefile이라는 설정 파일에서 플러그인 체인을 정의한다. 서비스 이름을 ClusterIP로 해석하는 서비스 디스커버리(Service Discovery)의 핵심 컴포넌트이다. kube-dns는 CoreDNS 이전에 사용되던 레거시 DNS 서버이다.
</details>

---

### 문제 2.
`kubectl cordon node01` 명령의 효과는?

A) node01에서 실행 중인 모든 Pod를 삭제한다
B) node01을 스케줄링 불가(SchedulingDisabled)로 표시하지만, 기존 Pod는 계속 실행된다
C) node01을 클러스터에서 완전히 제거한다
D) node01의 kubelet을 재시작한다

<details>
<summary>정답 확인</summary>

**정답: B) node01을 스케줄링 불가(SchedulingDisabled)로 표시하지만, 기존 Pod는 계속 실행된다**

`kubectl cordon`은 노드에 `node.kubernetes.io/unschedulable:NoSchedule` taint를 추가하여 새로운 Pod가 스케줄링되지 않도록 한다. 이미 실행 중인 Pod에는 영향을 주지 않는다. 기존 Pod도 퇴거시키려면 `kubectl drain`을 사용해야 한다. drain은 내부적으로 cordon을 먼저 수행한 후 Pod를 evict한다. 유지보수 완료 후에는 `kubectl uncordon`으로 스케줄링을 다시 허용한다.
</details>

---

### 문제 3.
CNCF 프로젝트가 Graduated 단계에 도달하기 위한 필수 조건으로 올바르지 않은 것은?

A) 독립적인 보안 감사(security audit)를 완료해야 한다
B) 다수의 프로덕션 환경 채택자가 있어야 한다
C) CNCF가 프로젝트의 모든 코드를 직접 작성해야 한다
D) 건전한 거버넌스와 커뮤니티를 갖추어야 한다

<details>
<summary>정답 확인</summary>

**정답: C) CNCF가 프로젝트의 모든 코드를 직접 작성해야 한다**

CNCF는 프로젝트의 코드를 직접 작성하지 않는다. CNCF는 중립적인 홈(neutral home)을 제공하고, 프로젝트의 거버넌스, 마케팅, 법적 지원을 담당한다. Graduated 조건: (1) 보안 감사 완료, (2) 최소 2개 이상의 대규모 프로덕션 채택자, (3) 건전한 거버넌스(GOVERNANCE.md), (4) 기여자 다양성, (5) CLA/DCO 프로세스, (6) CNCF Code of Conduct 준수. Sandbox → Incubating → Graduated 순으로 성숙도가 높아지며, 각 단계 전환은 CNCF TOC(Technical Oversight Committee) 투표로 결정된다.
</details>

---

### 문제 4.
12-Factor App의 Factor VII(Port Binding)에서 권장하는 방식은?

A) 웹 서버(Apache, Nginx)에 의존하여 서비스를 제공한다
B) 애플리케이션이 자체적으로 포트를 바인딩하여 HTTP 서비스를 제공한다
C) 반드시 80번 포트만 사용해야 한다
D) 포트 바인딩은 운영체제가 관리한다

<details>
<summary>정답 확인</summary>

**정답: B) 애플리케이션이 자체적으로 포트를 바인딩하여 HTTP 서비스를 제공한다**

Factor VII은 애플리케이션이 외부 웹 서버에 의존하지 않고, 자체적으로 포트를 바인딩하여 HTTP(또는 다른 프로토콜) 서비스를 제공해야 한다고 명시한다. 예를 들어, PHP 앱이 Apache에 의존하는 대신, Flask/Express/Spring Boot처럼 내장 HTTP 서버를 사용한다. 이 원칙은 컨테이너 환경에 자연스럽게 부합한다. 컨테이너는 하나의 프로세스를 실행하며, 해당 프로세스가 직접 포트를 노출한다. Kubernetes Service는 이 포트를 클러스터 내부/외부로 노출하는 역할을 한다.
</details>

---

### 문제 5.
Kubernetes Service DNS 이름 `my-svc.my-ns.svc.cluster.local`에서 각 부분의 의미로 올바른 것은?

A) my-svc=Pod이름, my-ns=노드이름, svc=서비스, cluster.local=도메인
B) my-svc=서비스이름, my-ns=네임스페이스, svc=서비스, cluster.local=클러스터도메인
C) my-svc=컨테이너이름, my-ns=네임스페이스, svc=서브넷, cluster.local=DNS서버
D) my-svc=레이블, my-ns=어노테이션, svc=셀렉터, cluster.local=엔드포인트

<details>
<summary>정답 확인</summary>

**정답: B) my-svc=서비스이름, my-ns=네임스페이스, svc=서비스, cluster.local=클러스터도메인**

Kubernetes의 Service DNS FQDN 형식: `<service-name>.<namespace>.svc.<cluster-domain>`. CoreDNS가 이 형식의 DNS 쿼리를 Service의 ClusterIP로 해석한다. 같은 네임스페이스 내에서는 서비스 이름만으로 접근 가능하다(예: `my-svc`). 다른 네임스페이스의 서비스에 접근하려면 최소 `my-svc.other-ns`까지 명시해야 한다. Pod의 `/etc/resolv.conf`에 `search <ns>.svc.cluster.local svc.cluster.local cluster.local`이 설정되어 있어 짧은 이름이 자동 확장된다.
</details>

---

### 문제 6.
PromQL에서 `rate()` 함수에 대한 설명으로 올바른 것은?

A) Gauge 메트릭의 현재 값을 반환한다
B) Counter 메트릭의 시간 범위 내 초당 평균 증가율을 계산한다
C) 메트릭의 최대값을 반환한다
D) 메트릭의 레이블을 변경한다

<details>
<summary>정답 확인</summary>

**정답: B) Counter 메트릭의 시간 범위 내 초당 평균 증가율을 계산한다**

`rate(counter[5m])`는 5분 범위 내의 초당 평균 증가율을 계산한다. 내부적으로 `(마지막 값 - 첫 번째 값) / 시간 간격`으로 계산하며, Counter 리셋(프로세스 재시작 등)을 자동 감지하여 보정한다. Counter 메트릭에 rate()를 적용하지 않으면 단조 증가하는 누적값만 보이므로 유의미한 정보를 얻을 수 없다. `irate()`는 마지막 두 샘플만 사용하여 순간 비율을 계산하므로 더 민감하지만 노이즈가 많다. rate()는 트래픽 비율, 에러율 등을 계산할 때 가장 많이 사용되는 PromQL 함수이다.
</details>

---

### 문제 7.
ArgoCD와 Flux의 공통점으로 올바른 것은?

A) 둘 다 CI(Continuous Integration) 도구이다
B) 둘 다 GitOps 원칙에 기반한 Pull-based CD 도구이다
C) 둘 다 Helm Chart만 지원한다
D) 둘 다 Google에서 개발하였다

<details>
<summary>정답 확인</summary>

**정답: B) 둘 다 GitOps 원칙에 기반한 Pull-based CD 도구이다**

ArgoCD(Intuit이 개발, CNCF Graduated)와 Flux(Weaveworks가 개발, CNCF Graduated)는 모두 GitOps 원칙에 기반한 Kubernetes용 CD 도구이다. 공통점: Git을 Single Source of Truth로 사용하고, 클러스터 내부에서 Git을 감시하여 Pull-based 배포를 수행한다. 차이점: ArgoCD는 Web UI가 강력하고 Application CRD 중심이며, Flux는 CLI 중심이고 GitRepository/Kustomization/HelmRelease 등 세분화된 CRD를 사용한다. 둘 다 Helm, Kustomize, 순수 YAML을 지원한다.
</details>

---

### 문제 8.
Helm과 Kustomize의 차이점으로 올바른 것은?

A) Helm은 템플릿 기반이고, Kustomize는 오버레이(패치) 기반이다
B) Helm만 Kubernetes에서 사용 가능하고, Kustomize는 Docker에서 사용한다
C) Kustomize가 Helm보다 항상 우수하다
D) 둘 다 동일한 방식으로 동작한다

<details>
<summary>정답 확인</summary>

**정답: A) Helm은 템플릿 기반이고, Kustomize는 오버레이(패치) 기반이다**

Helm은 Go 템플릿 엔진을 사용하여 `{{ .Values.xxx }}`로 변수를 주입한다. 템플릿이 복잡해지면 YAML의 유효성을 보장하기 어렵고, 디버깅이 어려울 수 있다. Kustomize는 유효한 YAML(base)에 패치(overlay)를 적용하므로, 원본 YAML이 항상 유효하다. Helm의 장점: 패키지 관리(repository, dependency), Chart 생태계(Artifact Hub). Kustomize의 장점: kubectl 내장, 학습 곡선이 낮음, YAML 유효성 보장. 프로젝트 요구사항에 따라 선택하며, ArgoCD에서는 둘 다 사용 가능하다.
</details>

---

### 문제 9.
CronJob의 리소스 계층 구조로 올바른 것은?

A) CronJob → Pod → Container
B) CronJob → Job → Pod → Container
C) CronJob → Deployment → ReplicaSet → Pod
D) CronJob → StatefulSet → Pod → Container

<details>
<summary>정답 확인</summary>

**정답: B) CronJob → Job → Pod → Container**

CronJob은 cron 스케줄에 따라 Job을 생성한다. Job은 하나 이상의 Pod를 생성하여 작업을 수행하고, 모든 Pod가 성공적으로 완료되면 Job이 완료 상태가 된다. CronJob이 Job을 관리하고, Job이 Pod를 관리하는 2단계 소유 구조이다. 이는 Deployment가 ReplicaSet을 관리하고, ReplicaSet이 Pod를 관리하는 구조와 유사하다. CronJob의 `concurrencyPolicy` 설정: `Allow`(기본값, 동시 실행 허용), `Forbid`(이전 Job이 실행 중이면 새 Job 생성 안 함), `Replace`(이전 Job을 종료하고 새 Job 생성).
</details>

---

### 문제 10.
Label Selector에 대한 설명으로 올바른 것은?

A) Label은 Pod에만 사용할 수 있다
B) Label Selector는 특정 레이블을 가진 리소스를 선택하는 메커니즘으로, Service, Deployment, NetworkPolicy 등에서 사용된다
C) Label은 한 리소스에 하나만 부여할 수 있다
D) Label Selector는 오직 `kubectl` 명령어에서만 사용 가능하다

<details>
<summary>정답 확인</summary>

**정답: B) Label Selector는 특정 레이블을 가진 리소스를 선택하는 메커니즘으로, Service, Deployment, NetworkPolicy 등에서 사용된다**

Label은 key-value 쌍으로, 모든 Kubernetes 리소스에 부여할 수 있으며, 하나의 리소스에 여러 Label을 부여할 수 있다. Label Selector는 두 가지 유형이 있다: (1) Equality-based — `app=web`, `environment!=prod` (동등/비동등 비교), (2) Set-based — `app in (web, api)`, `environment notin (prod)`, `!gpu` (집합 연산). Service의 `spec.selector`, Deployment의 `spec.selector.matchLabels`, NetworkPolicy의 `spec.podSelector` 등에서 Label Selector를 사용하여 대상 Pod를 선택한다. Label과 Annotation의 차이: Label은 셀렉터로 선택 가능하고, Annotation은 메타데이터만 저장한다.
</details>

---

### 문제 11.
Prometheus 메트릭에서 Counter와 Gauge의 차이점으로 올바른 것은?

A) Counter는 증가/감소하고, Gauge는 단조 증가한다
B) Counter는 단조 증가하고, Gauge는 증가/감소하는 현재 값이다
C) 둘 다 동일하지만 이름만 다르다
D) Counter는 문자열, Gauge는 숫자 값을 저장한다

<details>
<summary>정답 확인</summary>

**정답: B) Counter는 단조 증가하고, Gauge는 증가/감소하는 현재 값이다**

Counter는 누적 값으로, 프로세스 재시작 시에만 0으로 리셋된다. 예: `http_requests_total`, `node_cpu_seconds_total`. 시간 경과에 따른 비율을 보려면 `rate()`를 적용해야 한다. Gauge는 특정 시점의 현재 값으로, 증가하거나 감소할 수 있다. 예: `node_memory_MemAvailable_bytes`, `kube_deployment_spec_replicas`. Gauge는 그대로 사용하거나 `avg_over_time()`, `max_over_time()` 등을 적용한다. Counter에 rate()를 적용하지 않고 그래프를 그리면 단조 증가하는 직선만 보이므로 유의미한 정보를 얻을 수 없다.
</details>

---

### 문제 12.
Linkerd에 대한 설명으로 올바른 것은?

A) Kubernetes용 CI/CD 도구이다
B) Rust(프록시)와 Go(컨트롤 플레인)로 작성된 경량 Service Mesh이며 CNCF Graduated 프로젝트이다
C) 컨테이너 이미지 레지스트리이다
D) Kubernetes 클러스터 설치 도구이다

<details>
<summary>정답 확인</summary>

**정답: B) Rust(프록시)와 Go(컨트롤 플레인)로 작성된 경량 Service Mesh이며 CNCF Graduated 프로젝트이다**

Linkerd는 Buoyant가 개발한 Service Mesh로, CNCF Graduated 프로젝트이다. Istio가 Envoy(C++)를 사이드카 프록시로 사용하는 반면, Linkerd는 Rust로 작성된 자체 프록시(linkerd2-proxy)를 사용한다. Rust 프록시는 C++ 대비 메모리 안전성이 높고, 리소스 사용량이 매우 적다(약 10MB 메모리). Linkerd는 Istio보다 기능이 적지만, 설치와 운영이 단순하고 리소스 오버헤드가 낮다. "Service Mesh를 시작하려면 Linkerd, 고급 기능이 필요하면 Istio"라는 것이 일반적인 가이드이다.
</details>

---

### 문제 13.
Namespace에 대한 설명으로 올바르지 않은 것은?

A) 리소스를 논리적으로 분리하는 가상 클러스터이다
B) Namespace 간에 네트워크 트래픽은 기본적으로 차단된다
C) ResourceQuota는 Namespace 범위에서 적용된다
D) RBAC으로 Namespace별 접근 권한을 제어할 수 있다

<details>
<summary>정답 확인</summary>

**정답: B) Namespace 간에 네트워크 트래픽은 기본적으로 차단된다**

Kubernetes의 기본 네트워크 정책은 모든 Pod 간 통신을 허용한다(flat network). Namespace 간에도 기본적으로 네트워크 트래픽이 허용된다. Namespace 간 트래픽을 차단하려면 NetworkPolicy를 명시적으로 설정해야 한다. Namespace의 주요 기능: (1) 리소스의 논리적 분리(팀별, 환경별), (2) ResourceQuota와 LimitRange의 적용 범위, (3) RBAC의 권한 범위(RoleBinding). 기본 네임스페이스: `default`, `kube-system`(시스템 컴포넌트), `kube-public`(공개 리소스), `kube-node-lease`(노드 하트비트).
</details>

---

### 문제 14.
OPA(Open Policy Agent) Gatekeeper에 대한 설명으로 올바른 것은?

A) Kubernetes의 인증(Authentication) 시스템이다
B) Kubernetes Admission Controller로 동작하여, 정책 기반으로 리소스 생성을 허용/거부한다
C) 컨테이너 런타임의 보안을 강화하는 도구이다
D) 네트워크 트래픽을 필터링하는 방화벽이다

<details>
<summary>정답 확인</summary>

**정답: B) Kubernetes Admission Controller로 동작하여, 정책 기반으로 리소스 생성을 허용/거부한다**

OPA(Open Policy Agent)는 CNCF Graduated 프로젝트로, 범용 정책 엔진이다. Gatekeeper는 OPA를 Kubernetes Validating Admission Webhook으로 통합한 것이다. Rego 언어로 정책을 작성하여, 클러스터에 생성되는 리소스가 조직의 정책을 준수하는지 검증한다. 예: "모든 Pod에 리소스 limits가 설정되어야 한다", "latest 태그 사용 금지", "특정 레지스트리의 이미지만 허용". ConstraintTemplate(정책 템플릿)과 Constraint(정책 인스턴스)로 구성된다. Kyverno는 Gatekeeper의 대안으로, YAML 기반 정책을 지원하여 학습 곡선이 낮다.
</details>

---

### 문제 15.
12-Factor App의 Factor VI(Processes)에서 권장하는 프로세스의 특성은?

A) 프로세스는 반드시 멀티 스레드로 실행해야 한다
B) 프로세스는 무상태(stateless)이고 아무것도 공유하지 않아야 한다(share-nothing)
C) 프로세스는 영구적으로 실행되어야 하며 재시작하면 안 된다
D) 프로세스는 로컬 파일시스템에 세션 데이터를 저장해야 한다

<details>
<summary>정답 확인</summary>

**정답: B) 프로세스는 무상태(stateless)이고 아무것도 공유하지 않아야 한다(share-nothing)**

Factor VI는 애플리케이션 프로세스가 무상태이어야 하며, 영속적 데이터는 외부 백킹 서비스(데이터베이스, Redis, S3 등)에 저장해야 한다고 명시한다. 로컬 메모리나 파일시스템은 일시적 캐시로만 사용해야 한다. 이 원칙은 컨테이너 환경에서 특히 중요하다. 컨테이너는 언제든지 종료/재시작/이동될 수 있으므로, 로컬 상태에 의존하면 데이터가 손실된다. Kubernetes의 Deployment는 이 원칙을 전제로 설계되어 있다. 상태가 필요한 워크로드는 StatefulSet과 PersistentVolume을 사용한다.
</details>

---

### 문제 16.
containerd와 CRI-O의 공통점으로 올바른 것은?

A) 둘 다 Docker Engine의 구성 요소이다
B) 둘 다 CRI를 구현한 OCI 호환 컨테이너 런타임이다
C) 둘 다 컨테이너 이미지를 빌드하는 기능을 포함한다
D) 둘 다 오직 runc만 하위 런타임으로 사용할 수 있다

<details>
<summary>정답 확인</summary>

**정답: B) 둘 다 CRI를 구현한 OCI 호환 컨테이너 런타임이다**

containerd(CNCF Graduated)와 CRI-O(CNCF Incubating)는 모두 kubelet과 CRI(gRPC) 프로토콜로 통신하며, OCI(Open Container Initiative) 호환 런타임(runc, crun, gVisor의 runsc, Kata의 kata-runtime)을 하위 런타임으로 사용한다. 차이점: containerd는 Docker에서 분리된 범용 런타임으로, Docker CLI와도 호환되고 Kubernetes 외의 환경에서도 사용 가능하다. CRI-O는 Kubernetes 전용으로 설계되어, 불필요한 기능이 없고 코드가 간결하다. 둘 다 이미지 빌드 기능은 포함하지 않는다(이미지 빌드는 Buildah, kaniko, BuildKit 등이 담당).
</details>

---

### 문제 17.
Liveness Probe와 Readiness Probe의 차이점으로 올바른 것은?

A) Liveness 실패 시 Pod가 서비스에서 제거되고, Readiness 실패 시 컨테이너가 재시작된다
B) Liveness 실패 시 컨테이너가 재시작되고, Readiness 실패 시 Service Endpoints에서 제거된다
C) 둘 다 동일하게 컨테이너를 재시작한다
D) Liveness는 TCP 체크만, Readiness는 HTTP 체크만 지원한다

<details>
<summary>정답 확인</summary>

**정답: B) Liveness 실패 시 컨테이너가 재시작되고, Readiness 실패 시 Service Endpoints에서 제거된다**

Liveness Probe는 컨테이너가 살아 있는지(deadlock 등에 빠지지 않았는지) 확인한다. 실패 시 kubelet이 컨테이너를 재시작한다(`restartPolicy`에 따라). Readiness Probe는 컨테이너가 트래픽을 받을 준비가 되었는지 확인한다. 실패 시 Service의 Endpoints에서 해당 Pod를 제거하여 트래픽이 전달되지 않도록 한다. 컨테이너를 재시작하지 않는다. 둘 다 httpGet, tcpSocket, exec 세 가지 방식을 지원한다. Startup Probe(Kubernetes 1.20 GA)는 느리게 시작하는 애플리케이션에서 Liveness Probe의 오작동(시작 전 재시작)을 방지한다.
</details>

---

### 문제 18.
Envoy Proxy에 대한 설명으로 올바른 것은?

A) Kubernetes API 서버의 내장 프록시이다
B) CNCF Graduated 프로젝트로, Istio와 여러 서비스 메시에서 데이터 플레인 프록시로 사용된다
C) 오직 HTTP 프로토콜만 지원한다
D) Python으로 작성된 리버스 프록시이다

<details>
<summary>정답 확인</summary>

**정답: B) CNCF Graduated 프로젝트로, Istio와 여러 서비스 메시에서 데이터 플레인 프록시로 사용된다**

Envoy는 Lyft에서 개발한 고성능 L4/L7 프록시로, C++로 작성되었다. CNCF Graduated 프로젝트이다. xDS(discovery service) API를 통해 동적으로 설정을 업데이트할 수 있으며, 이 기능이 서비스 메시의 데이터 플레인으로 적합한 핵심 이유이다. Istio, AWS App Mesh, Consul Connect 등 다수의 서비스 메시가 Envoy를 사이드카 프록시로 사용한다. HTTP/1.1, HTTP/2, gRPC, TCP, MongoDB, Redis 등 다양한 프로토콜을 지원한다. Kubernetes Ingress Controller로도 사용 가능하다(Contour, Envoy Gateway 등).
</details>

---

### 문제 19.
GitOps의 4가지 원칙(OpenGitOps) 중 올바르지 않은 것은?

A) Declarative (선언적)
B) Versioned and Immutable (버전 관리 및 불변)
C) Pushed Manually (수동 배포)
D) Continuously Reconciled (지속적 조정)

<details>
<summary>정답 확인</summary>

**정답: C) Pushed Manually (수동 배포)**

OpenGitOps의 4원칙: (1) Declarative — 원하는 상태를 선언적으로 정의한다, (2) Versioned and Immutable — 원하는 상태가 버전 관리 시스템(Git)에 불변으로 저장된다, (3) Pulled Automatically — 에이전트가 원하는 상태를 자동으로 가져온다(Pull-based), (4) Continuously Reconciled — 실제 상태와 원하는 상태의 차이를 지속적으로 조정한다. "Pushed Manually"는 GitOps의 원칙에 반하며, 전통적인 Push-based CD에 해당한다. Pull-based 모델은 보안과 상태 일관성 측면에서 Push-based보다 우수하다.
</details>

---

### 문제 20.
Kubernetes에서 리소스 `requests`와 `limits`의 차이점으로 올바른 것은?

A) requests는 최대값, limits는 최소값이다
B) requests는 스케줄링 시 보장되는 최소 리소스, limits는 사용 가능한 최대 리소스이다
C) requests와 limits는 동일한 값이어야 한다
D) limits만 설정하면 requests는 무시된다

<details>
<summary>정답 확인</summary>

**정답: B) requests는 스케줄링 시 보장되는 최소 리소스, limits는 사용 가능한 최대 리소스이다**

`requests`는 스케줄러가 Pod를 배치할 노드를 선택할 때 사용하는 값이다. 노드에 requests만큼의 여유 리소스가 있어야 Pod가 배치된다. `limits`는 컨테이너가 사용할 수 있는 최대 리소스이다. CPU limits를 초과하면 스로틀링(throttling)이 발생하고, 메모리 limits를 초과하면 OOMKill이 발생한다. QoS 클래스 결정: requests=limits이면 `Guaranteed`, requests<limits이면 `Burstable`, 둘 다 없으면 `BestEffort`. 리소스 부족 시 BestEffort → Burstable → Guaranteed 순으로 축출된다.
</details>

---

### 문제 21.
mTLS(mutual TLS)에 대한 설명으로 올바른 것은?

A) 클라이언트만 서버의 인증서를 검증한다
B) 클라이언트와 서버가 서로의 인증서를 검증하여 양방향 인증을 수행한다
C) TLS 없이 평문으로 통신하는 방식이다
D) 오직 HTTPS에서만 사용 가능하다

<details>
<summary>정답 확인</summary>

**정답: B) 클라이언트와 서버가 서로의 인증서를 검증하여 양방향 인증을 수행한다**

일반 TLS에서는 클라이언트가 서버의 인증서만 검증한다(단방향). mTLS에서는 서버도 클라이언트의 인증서를 검증하여 양방향 인증을 수행한다. 이를 통해 마이크로서비스 간 통신에서 (1) 암호화 — 도청 방지, (2) 인증 — 통신 상대방의 신원 확인, (3) 무결성 — 메시지 변조 감지를 보장한다. Service Mesh(Istio, Linkerd)는 mTLS를 자동으로 설정하여, 애플리케이션 코드를 수정하지 않고도 모든 서비스 간 통신을 암호화한다. 인증서는 Service Mesh의 컨트롤 플레인(Istio의 istiod)이 자동 발급하고 주기적으로 갱신한다.
</details>

---

### 문제 22.
`kubectl rollout undo deployment/web`이 내부적으로 수행하는 동작은?

A) Deployment를 삭제하고 새로 생성한다
B) 이전 ReplicaSet의 replicas를 원래 값으로 복구하고, 현재 ReplicaSet의 replicas를 0으로 줄인다
C) Git에서 이전 커밋을 checkout한다
D) 모든 Pod를 동시에 삭제하고 이전 이미지로 재생성한다

<details>
<summary>정답 확인</summary>

**정답: B) 이전 ReplicaSet의 replicas를 원래 값으로 복구하고, 현재 ReplicaSet의 replicas를 0으로 줄인다**

Rolling Update 시 Deployment Controller는 이전 ReplicaSet을 삭제하지 않고 replicas=0으로 유지한다. `rollout undo`를 실행하면 Deployment의 Pod 템플릿을 이전 ReplicaSet의 템플릿으로 변경한다. 이에 따라 이전 ReplicaSet의 replicas가 다시 원래 값으로 증가하고, 현재 ReplicaSet의 replicas가 0으로 줄어든다. 이 과정도 Rolling Update 전략에 따라 점진적으로 수행된다. `revisionHistoryLimit`(기본값 10)은 보관할 이전 ReplicaSet의 최대 수를 지정한다. 특정 리비전으로 롤백하려면 `kubectl rollout undo deployment/web --to-revision=2`를 사용한다.
</details>

---

### 문제 23.
Cloud Native의 핵심 특성에 해당하지 않는 것은?

A) 컨테이너화(Containerization)
B) 마이크로서비스 아키텍처(Microservices)
C) 모놀리식 아키텍처(Monolithic Architecture)
D) 동적 오케스트레이션(Dynamic Orchestration)

<details>
<summary>정답 확인</summary>

**정답: C) 모놀리식 아키텍처(Monolithic Architecture)**

CNCF의 Cloud Native 정의에 따르면, Cloud Native 기술은 퍼블릭, 프라이빗, 하이브리드 클라우드에서 확장 가능한 애플리케이션을 구축하고 실행할 수 있게 한다. 핵심 특성: (1) 컨테이너화 — 애플리케이션을 컨테이너로 패키징, (2) 마이크로서비스 — 독립적으로 배포/확장 가능한 작은 서비스로 분리, (3) 동적 오케스트레이션 — Kubernetes 등으로 자동 배포/스케일링/관리, (4) 선언적 API — 원하는 상태를 선언적으로 정의. 모놀리식 아키텍처는 Cloud Native와 반대되는 전통적 아키텍처 스타일이다. 단, Cloud Native로의 전환이 반드시 마이크로서비스를 의미하지는 않으며, 모놀리스를 컨테이너화하는 것도 Cloud Native 여정의 시작일 수 있다.
</details>

---

### 문제 24.
노드 장애 시 Kubernetes가 해당 노드의 Pod를 다른 노드로 재배치하는 과정으로 올바른 것은?

A) kubelet이 즉시 다른 노드에 Pod를 생성한다
B) Node Controller가 노드를 NotReady로 표시하고, 일정 시간 후 Pod를 다른 노드로 재스케줄링한다
C) kube-proxy가 Pod를 다른 노드로 이동시킨다
D) etcd가 직접 Pod를 재생성한다

<details>
<summary>정답 확인</summary>

**정답: B) Node Controller가 노드를 NotReady로 표시하고, 일정 시간 후 Pod를 다른 노드로 재스케줄링한다**

노드 장애 복구 과정: (1) kubelet이 kube-apiserver에 하트비트(NodeLease)를 전송하지 못한다. (2) kube-controller-manager 내의 Node Controller가 `node-monitor-grace-period`(기본 40초) 후 노드를 `NotReady`로 표시한다. (3) Node Controller가 `pod-eviction-timeout`(기본 5분) 후 해당 노드의 Pod에 `node.kubernetes.io/not-ready:NoExecute` Taint를 추가한다. (4) 이 Taint를 toleration하지 않는 Pod가 퇴거되어 다른 노드에 재스케줄링된다. StatefulSet의 Pod는 이전 Pod가 확실히 종료되었는지 확인될 때까지 새 Pod를 생성하지 않아 데이터 손상을 방지한다.
</details>

---

### 문제 25.
OpenTelemetry에 대한 설명으로 올바른 것은?

A) 오직 메트릭만 수집하는 도구이다
B) 메트릭, 로그, 추적(trace)을 통합적으로 수집하는 관측성 프레임워크이며 CNCF Incubating 프로젝트이다
C) Prometheus를 대체하는 시계열 데이터베이스이다
D) 컨테이너 로그만 관리하는 도구이다

<details>
<summary>정답 확인</summary>

**정답: B) 메트릭, 로그, 추적(trace)을 통합적으로 수집하는 관측성 프레임워크이며 CNCF Incubating 프로젝트이다**

OpenTelemetry(OTel)는 OpenTracing과 OpenCensus가 합쳐져 탄생한 관측성 표준 프레임워크이다. 관측성의 세 축(메트릭, 로그, 추적)을 단일 SDK와 Collector로 통합하여 수집한다. 벤더 중립적이어서, 수집된 데이터를 Prometheus, Jaeger, Grafana, Datadog 등 다양한 백엔드로 전송할 수 있다. OTel Collector는 수집(receive), 처리(process), 내보내기(export) 파이프라인으로 구성된다. 각 언어(Java, Python, Go, JavaScript 등)에 대한 SDK를 제공하여, 애플리케이션에 계측(instrumentation)을 추가할 수 있다.
</details>

---

### 문제 26.
Set-based Label Selector에서 `app in (web, api)` 표현식의 의미는?

A) app 레이블이 "web" 또는 "api"인 리소스를 선택한다
B) app 레이블이 "web"이고 동시에 "api"인 리소스를 선택한다
C) app 레이블이 "web" 또는 "api"가 아닌 리소스를 선택한다
D) app 레이블의 값을 "web, api"로 변경한다

<details>
<summary>정답 확인</summary>

**정답: A) app 레이블이 "web" 또는 "api"인 리소스를 선택한다**

Set-based Selector는 집합 연산을 지원한다. `in` 연산자는 레이블 값이 주어진 집합에 포함되는 리소스를 선택한다. `notin` 연산자는 포함되지 않는 리소스를 선택한다. `exists`(키만 지정, 예: `app`)는 해당 키가 있는 리소스를 선택하고, `!`(예: `!app`)는 해당 키가 없는 리소스를 선택한다. kubectl에서 Set-based Selector 사용 예: `kubectl get pods -l 'app in (web, api), environment notin (prod)'`. Deployment의 `spec.selector.matchExpressions`에서도 Set-based Selector를 사용할 수 있다.
</details>

---

### 문제 27.
Kyverno에 대한 설명으로 올바른 것은?

A) Kubernetes용 CI/CD 도구이다
B) YAML 기반의 Kubernetes 정책 엔진으로, OPA/Gatekeeper의 대안이다
C) 컨테이너 이미지 스캔 도구이다
D) Kubernetes 클러스터 모니터링 도구이다

<details>
<summary>정답 확인</summary>

**정답: B) YAML 기반의 Kubernetes 정책 엔진으로, OPA/Gatekeeper의 대안이다**

Kyverno는 CNCF Incubating 프로젝트로, Kubernetes 네이티브 정책 엔진이다. OPA/Gatekeeper가 Rego라는 별도 언어로 정책을 작성하는 반면, Kyverno는 Kubernetes YAML과 유사한 형식으로 정책을 작성하여 학습 곡선이 낮다. 기능: (1) Validate — 리소스 생성/수정 시 검증(예: latest 태그 금지), (2) Mutate — 리소스에 기본값 주입(예: 리소스 limits 자동 추가), (3) Generate — 다른 리소스 자동 생성(예: 네임스페이스 생성 시 NetworkPolicy 자동 생성), (4) Verify Images — 이미지 서명 검증(Cosign/Notary). Kubernetes Admission Webhook으로 동작한다.
</details>

---

### 문제 28.
Kubernetes API 리소스의 범위(scope)에 대한 설명으로 올바른 것은?

A) 모든 리소스는 Namespace 범위이다
B) Namespace 범위 리소스(Pod, Service 등)와 Cluster 범위 리소스(Node, Namespace 등)가 있다
C) Cluster 범위 리소스는 존재하지 않는다
D) 리소스의 범위는 사용자가 자유롭게 변경할 수 있다

<details>
<summary>정답 확인</summary>

**정답: B) Namespace 범위 리소스(Pod, Service 등)와 Cluster 범위 리소스(Node, Namespace 등)가 있다**

Kubernetes 리소스는 두 가지 범위로 나뉜다. Namespace 범위: Pod, Service, Deployment, ConfigMap, Secret, PVC, Role, RoleBinding 등 — 특정 네임스페이스에 속하며, 같은 이름이 다른 네임스페이스에 존재할 수 있다. Cluster 범위: Node, Namespace, PersistentVolume, ClusterRole, ClusterRoleBinding, StorageClass, CRD 등 — 클러스터 전체에 하나만 존재한다. `kubectl api-resources --namespaced=true`로 Namespace 범위 리소스를, `kubectl api-resources --namespaced=false`로 Cluster 범위 리소스를 확인할 수 있다.
</details>

---

### 문제 29.
HPA의 `--horizontal-pod-autoscaler-sync-period`의 기본값은?

A) 5초
B) 15초
C) 30초
D) 60초

<details>
<summary>정답 확인</summary>

**정답: B) 15초**

HPA Controller는 kube-controller-manager 내부에서 동작하며, 기본 15초 간격으로 메트릭을 조회하고 필요한 레플리카 수를 계산한다. 이 주기는 `--horizontal-pod-autoscaler-sync-period` 플래그로 변경할 수 있다. 주기가 짧으면 더 빠르게 반응하지만 API 서버와 metrics-server에 부하가 증가한다. 주기가 길면 반응이 느려진다. 스케일다운 안정화 기간(stabilization window)은 기본 300초(5분)이며, 이 기간 동안 가장 높은 추천 레플리카 수를 유지하여 트래픽 변동에 의한 불필요한 스케일인을 방지한다.
</details>

---

### 문제 30.
다음 중 Kubernetes 클러스터의 컨트롤 플레인 컴포넌트가 아닌 것은?

A) kube-apiserver
B) kube-scheduler
C) kube-controller-manager
D) kube-proxy

<details>
<summary>정답 확인</summary>

**정답: D) kube-proxy**

Kubernetes 컨트롤 플레인 컴포넌트: kube-apiserver(API 서버, 모든 통신의 중앙 허브), kube-scheduler(Pod를 적절한 노드에 배치), kube-controller-manager(Reconciliation Loop 실행, 여러 컨트롤러 포함), etcd(분산 키-값 저장소, 클러스터 상태 저장), cloud-controller-manager(클라우드 프로바이더 연동). kube-proxy는 각 워커 노드에서 실행되는 노드 컴포넌트로, Service의 ClusterIP를 실제 Pod IP로 변환하는 네트워크 프록시이다. kubelet도 노드 컴포넌트로, 컨테이너 런타임과 통신하여 Pod를 관리한다.
</details>

---

> **학습 팁**: 이 보충 자료의 문제를 풀고 틀린 문제의 해설을 반복적으로 읽는 것이 KCNA 합격의 핵심이다. 특히 Kubernetes Fundamentals(46%)에 가장 많은 시간을 투자하는 것이 효율적이다. 각 개념의 등장 배경과 내부 동작 원리를 이해하면, 문제의 변형에도 대응할 수 있다.

> **CNCF 프로젝트 확인**: 시험 전에 반드시 CNCF Landscape(https://landscape.cncf.io)에서 최신 Graduated/Incubating/Sandbox 프로젝트 목록을 확인하라. 프로젝트의 성숙도 단계는 변경될 수 있다.

> **트러블슈팅 역량**: KCNA는 트러블슈팅 문제를 직접 출제하지는 않지만, 문제의 맥락을 이해하기 위해 트러블슈팅 지식이 필요하다. 예를 들어 "Pod가 Pending인 원인"을 묻는 문제에서, 스케줄러의 Filtering/Scoring 과정을 이해하면 정확한 답을 선택할 수 있다.
