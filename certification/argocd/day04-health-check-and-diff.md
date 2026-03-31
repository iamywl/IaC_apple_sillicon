# Day 4: Health 체크와 Diff 전략

리소스별 Health 체크 로직, Custom Health Check(Lua 스크립트), Diff 전략(Structured Merge Diff, JQ Path Expression), 그리고 Diff 커스터마이징을 다룬다.

---

## 5장: Health 체크 상세

### Health Status

| 상태 | 설명 |
|------|------|
| **Healthy** | 리소스가 정상적으로 동작하고 있다 |
| **Progressing** | 리소스가 아직 원하는 상태에 도달하지 않았지만 진행 중이다 (예: Deployment rollout 중) |
| **Degraded** | 리소스에 문제가 발생했다 (예: Pod CrashLoopBackOff, Deployment 가용 replica 부족) |
| **Suspended** | 리소스가 일시 중단 상태이다 (예: CronJob suspended, Deployment paused) |
| **Missing** | 리소스가 클러스터에 존재하지 않는다 |
| **Unknown** | Health 상태를 판별할 수 없다 |

### 기본 제공 Health Check 상세

ArgoCD는 주요 Kubernetes 리소스에 대해 내장 Health Check를 제공한다:

#### Deployment Health Check

```
Healthy 조건:
  - spec.replicas == status.updatedReplicas
  - spec.replicas == status.availableReplicas
  - status.observedGeneration == metadata.generation

Progressing 조건:
  - updatedReplicas < spec.replicas (새 버전 rollout 진행 중)
  - availableReplicas < updatedReplicas (새 Pod가 아직 Ready가 아님)

Degraded 조건:
  - Progressing condition이 "False"이고 reason이 "ProgressDeadlineExceeded"
  - 이는 spec.progressDeadlineSeconds (기본 600초) 내에 rollout이 완료되지 않은 경우

Suspended 조건:
  - spec.paused == true
```

#### StatefulSet Health Check

```
Healthy 조건:
  - spec.replicas == status.updatedReplicas
  - spec.replicas == status.readyReplicas
  - status.currentRevision == status.updateRevision
  - status.observedGeneration == metadata.generation

Progressing 조건:
  - 위 조건 중 하나라도 만족하지 않으면 Progressing
  - updateStrategy.type == "OnDelete"이면 currentRevision != updateRevision이어도 Healthy
```

#### DaemonSet Health Check

```
Healthy 조건:
  - status.desiredNumberScheduled == status.updatedNumberScheduled
  - status.desiredNumberScheduled == status.numberAvailable
  - status.observedGeneration == metadata.generation

Progressing 조건:
  - 위 조건이 아직 만족되지 않은 경우
```

#### Pod Health Check

```
Healthy 조건:
  - status.phase == "Running" AND 모든 container가 Ready

Progressing 조건:
  - status.phase == "Pending"

Degraded 조건:
  - status.phase == "Failed"
  - status.phase == "Unknown"
  - containerStatuses에 CrashLoopBackOff, ImagePullBackOff 등이 있는 경우

Suspended 조건:
  - status.phase == "Succeeded" (완료된 Pod, 예: Job의 Pod)
```

#### Service Health Check

```
Healthy 조건:
  - type이 ClusterIP, NodePort, ExternalName이면 항상 Healthy
  - type이 LoadBalancer이면 status.loadBalancer.ingress가 비어있지 않아야 Healthy

Progressing 조건:
  - type이 LoadBalancer이고 status.loadBalancer.ingress가 비어있는 경우
```

#### Ingress Health Check

```
Healthy 조건:
  - status.loadBalancer.ingress가 비어있지 않으면 Healthy

Progressing 조건:
  - status.loadBalancer.ingress가 비어있으면 Progressing

참고: 일부 Ingress Controller(예: nginx)는 status를 업데이트하지 않으므로
      이 경우 ArgoCD 설정에서 Ingress health check를 커스터마이징해야 한다
```

#### PersistentVolumeClaim Health Check

```
Healthy 조건:
  - status.phase == "Bound"

Progressing 조건:
  - status.phase == "Pending"

Degraded 조건:
  - status.phase == "Lost"
```

#### Job Health Check

```
Healthy 조건:
  - status.conditions에 type "Complete"가 있고 status가 "True"

Progressing 조건:
  - 아직 완료되지 않은 경우 (Complete/Failed condition이 없는 경우)

Degraded 조건:
  - status.conditions에 type "Failed"가 있고 status가 "True"
```

### Custom Health Check (Lua 스크립트)

ArgoCD는 Lua 스크립트를 사용하여 CRD 등 커스텀 리소스에 대한 Health Check를 정의할 수 있다. `argocd-cm` ConfigMap에 설정한다:

```yaml
# argocd-cm ConfigMap
data:
  resource.customizations.health.certmanager.k8s.io_Certificate: |
    hs = {}
    if obj.status ~= nil then
      if obj.status.conditions ~= nil then
        for i, condition in ipairs(obj.status.conditions) do
          if condition.type == "Ready" and condition.status == "False" then
            hs.status = "Degraded"
            hs.message = condition.message
            return hs
          end
          if condition.type == "Ready" and condition.status == "True" then
            hs.status = "Healthy"
            hs.message = condition.message
            return hs
          end
        end
      end
    end
    hs.status = "Progressing"
    hs.message = "Waiting for certificate"
    return hs
```

#### Lua Health Check 작성 가이드

Lua health check 스크립트는 다음 규칙을 따른다:

```lua
-- 반환 객체 구조
hs = {}
hs.status = "Healthy"      -- Healthy | Progressing | Degraded | Suspended | Unknown
hs.message = "상태 설명"   -- UI에 표시되는 메시지

-- 사용 가능한 전역 변수
-- obj: 평가 대상 Kubernetes 리소스 (JSON을 Lua table로 변환한 것)

-- Lua 문법 주의사항
-- nil 체크: ~= nil
-- 배열 순회: ipairs()
-- 테이블 순회: pairs()
-- 문자열 비교: == (대소문자 구분)
```

#### 실전 Custom Health Check 예시

##### Argo Rollouts Rollout 리소스

```yaml
data:
  resource.customizations.health.argoproj.io_Rollout: |
    hs = {}
    if obj.status == nil then
      hs.status = "Progressing"
      hs.message = "Waiting for rollout status"
      return hs
    end

    if obj.status.conditions ~= nil then
      for _, condition in ipairs(obj.status.conditions) do
        if condition.type == "Paused" and condition.status == "True" then
          hs.status = "Suspended"
          hs.message = condition.message
          return hs
        end
        if condition.type == "InvalidSpec" then
          hs.status = "Degraded"
          hs.message = condition.message
          return hs
        end
      end
    end

    if obj.status.phase == "Healthy" then
      hs.status = "Healthy"
      hs.message = "Rollout is healthy"
    elseif obj.status.phase == "Paused" then
      hs.status = "Suspended"
      hs.message = "Rollout is paused"
    elseif obj.status.phase == "Degraded" then
      hs.status = "Degraded"
      hs.message = "Rollout is degraded"
    else
      hs.status = "Progressing"
      hs.message = "Rollout is progressing"
    end
    return hs
```

##### Sealed Secrets

```yaml
data:
  resource.customizations.health.bitnami.com_SealedSecret: |
    hs = {}
    if obj.status ~= nil then
      if obj.status.conditions ~= nil then
        for _, condition in ipairs(obj.status.conditions) do
          if condition.type == "Synced" and condition.status == "True" then
            hs.status = "Healthy"
            hs.message = "SealedSecret is synced"
            return hs
          end
          if condition.type == "Synced" and condition.status == "False" then
            hs.status = "Degraded"
            hs.message = condition.message
            return hs
          end
        end
      end
    end
    hs.status = "Progressing"
    hs.message = "Waiting for SealedSecret to be synced"
    return hs
```

##### ExternalSecret (External Secrets Operator)

```yaml
data:
  resource.customizations.health.external-secrets.io_ExternalSecret: |
    hs = {}
    if obj.status ~= nil then
      if obj.status.conditions ~= nil then
        for _, condition in ipairs(obj.status.conditions) do
          if condition.type == "Ready" then
            if condition.status == "True" then
              hs.status = "Healthy"
              hs.message = condition.message or "ExternalSecret is ready"
            else
              hs.status = "Degraded"
              hs.message = condition.message or "ExternalSecret is not ready"
            end
            return hs
          end
        end
      end
    end
    hs.status = "Progressing"
    hs.message = "Waiting for ExternalSecret"
    return hs
```

### Health Check 비활성화

특정 리소스 타입에 대해 health check를 비활성화할 수 있다:

```yaml
# argocd-cm ConfigMap
data:
  # ConfigMap의 health check를 비활성화 (항상 Healthy로 표시)
  resource.customizations.health.ConfigMap: |
    hs = {}
    hs.status = "Healthy"
    return hs

  # 특정 CRD에 대해 health check를 완전히 무시
  resource.customizations.useOpenAPI.argoproj.io_Rollout: "false"
```

### Application 전체 Health 계산

Application의 전체 health status는 관리하는 모든 리소스의 health를 종합하여 결정한다:

```
Application Health 판정 규칙:

1. 하나라도 Missing → Application은 Missing
2. 하나라도 Unknown → Application은 Unknown
3. 하나라도 Degraded → Application은 Degraded
4. 하나라도 Progressing → Application은 Progressing
5. 하나라도 Suspended → Application은 Suspended
6. 모두 Healthy → Application은 Healthy

우선순위: Missing > Unknown > Degraded > Progressing > Suspended > Healthy
(가장 심각한 상태가 Application 전체 상태가 된다)
```

---

## 6장: Diff 전략 상세

### Reconciliation Loop에서의 Diff

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Git Repo    │     │  Repo Server │     │  Application │
│  (Desired)   │────►│  (Render)    │────►│  Controller  │
└──────────────┘     └──────────────┘     └──────┬───────┘
                                                  │
                                           Diff 계산
                                                  │
                                          ┌───────▼───────┐
                                          │  K8s Cluster  │
                                          │  (Live State) │
                                          └───────────────┘
```

- 기본 Polling 주기는 **3분**(180초)이다 (`timeout.reconciliation` 설정으로 변경 가능하다)
- `argocd-cm` ConfigMap의 `timeout.reconciliation` 값으로 주기를 조정한다
- Webhook 기반 트리거를 설정하면 Git push 이벤트 발생 시 즉시 동기화를 시작한다 (polling 대기 없이)
- 수동으로 Hard Refresh를 실행하면 캐시를 무시하고 Git에서 최신 매니페스트를 가져온다

### Diff 계산 방식

- ArgoCD는 자체 diff 엔진을 사용하여 Desired State와 Live State를 비교한다
- `kubectl diff`와 유사하지만 ArgoCD 고유의 정규화(normalization) 과정을 거친다
- Kubernetes가 자동으로 추가하는 필드(defaulting)를 고려하여 오탐(false positive)을 줄인다
- Server-Side Diff 모드를 활성화하면 Kubernetes API Server의 dry-run 기능을 활용하여 더 정확한 diff를 계산한다 (ArgoCD 2.10+)

### Diff 정규화(Normalization) 과정

ArgoCD가 diff를 계산하기 전에 수행하는 정규화 과정을 상세히 살펴본다:

```
┌──────────────────────────────────────────────────────────────┐
│                    Diff 정규화 과정                           │
│                                                               │
│  1. Kubernetes Defaulting 처리                                │
│     - API Server가 자동으로 추가하는 기본값을 제거한다         │
│     - 예: spec.restartPolicy (기본값 "Always")                │
│     - 예: spec.terminationGracePeriodSeconds (기본값 30)      │
│     - 예: spec.dnsPolicy (기본값 "ClusterFirst")              │
│                                                               │
│  2. 시스템 필드 제거                                          │
│     - metadata.managedFields                                  │
│     - metadata.resourceVersion                                │
│     - metadata.uid                                            │
│     - metadata.creationTimestamp                               │
│     - metadata.generation                                     │
│     - status (대부분의 리소스)                                 │
│                                                               │
│  3. 시스템 어노테이션 제거                                    │
│     - kubectl.kubernetes.io/last-applied-configuration        │
│     - deployment.kubernetes.io/revision                       │
│                                                               │
│  4. ignoreDifferences 적용                                    │
│     - 사용자가 지정한 경로/필드를 제거한다                    │
│                                                               │
│  5. 리소스별 특수 처리                                        │
│     - Secret: data 값을 base64 디코딩 후 비교한다             │
│     - Service: clusterIP 자동 할당 값을 무시한다              │
│     - Deployment: strategy 기본값을 처리한다                  │
└──────────────────────────────────────────────────────────────┘
```

### Structured Merge Diff

ArgoCD는 Go의 `structured-merge-diff` 라이브러리를 사용하여 diff를 계산한다. 이 방식은 Kubernetes의 Server-Side Apply와 동일한 알고리즘이다:

```
Structured Merge Diff의 특징:

1. 스키마 인식(Schema-Aware)
   - OpenAPI 스키마를 기반으로 diff를 계산한다
   - 맵(map)과 리스트(list)를 올바르게 구분한다
   - 리스트의 merge key를 인식하여 순서 무관 비교가 가능하다

2. Strategic Merge Patch 지원
   - Kubernetes 리소스의 merge 전략을 이해한다
   - patchMergeKey가 설정된 리스트는 키 기반으로 병합한다
   - 예: containers[].name을 merge key로 사용하여 컨테이너를 매칭한다

3. 필드 소유권(Field Ownership)
   - Server-Side Apply 모드에서 각 필드의 소유자를 추적한다
   - ArgoCD가 소유하지 않는 필드의 변경은 무시할 수 있다
```

### JSON Pointer vs jqPathExpressions vs managedFieldsManagers

ignoreDifferences에서 사용하는 세 가지 경로 지정 방식의 차이이다:

```yaml
spec:
  ignoreDifferences:
    # 1. JSON Pointer (RFC 6901)
    # - 단순한 경로 지정에 적합하다
    # - 배열 인덱스를 사용해야 하므로 동적 배열에는 부적합하다
    - group: apps
      kind: Deployment
      jsonPointers:
        - /spec/replicas
        - /spec/template/metadata/annotations/kubectl.kubernetes.io~1restartedAt
        # ~1은 / 이스케이프, ~0은 ~ 이스케이프

    # 2. jqPathExpressions (jq 문법)
    # - 복잡한 경로 지정이 가능하다
    # - 배열 필터링, 조건부 매칭 등 고급 기능을 지원한다
    - group: apps
      kind: Deployment
      jqPathExpressions:
        - .spec.replicas
        - .spec.template.metadata.annotations."kubectl.kubernetes.io/restartedAt"
        # 배열 내 특정 요소 지정
        - .spec.template.spec.containers[] | select(.name == "sidecar") | .image
        # 모든 container의 resources 무시
        - .spec.template.spec.containers[].resources

    # 3. managedFieldsManagers
    # - 특정 controller가 관리하는 모든 필드를 한 번에 무시한다
    # - HPA, VPA, Istio sidecar injector 등에 유용하다
    - group: "*"
      kind: "*"
      managedFieldsManagers:
        - kube-controller-manager   # 시스템 컨트롤러
        - vpa-recommender           # VPA가 관리하는 필드
        - cluster-autoscaler        # CA가 관리하는 필드
```

### Resource Tracking 방식

ArgoCD가 관리 대상 리소스를 추적하는 방법은 세 가지이다:

| 방식 | 설명 |
|------|------|
| **annotation** (기본값) | `kubectl.kubernetes.io/last-applied-configuration` 어노테이션을 사용한다 |
| **label** | `app.kubernetes.io/instance` 레이블을 사용한다 |
| **annotation+label** | 두 방식을 모두 사용한다. ArgoCD 2.2+에서 권장하는 방식이다 |

- `argocd-cm` ConfigMap의 `application.resourceTrackingMethod` 값으로 설정한다

### Server-Side Diff (ArgoCD 2.10+)

ArgoCD 2.10부터 도입된 Server-Side Diff는 Kubernetes API Server의 dry-run 기능을 활용한다:

```
Client-Side Diff (기본값):
  1. ArgoCD가 Git에서 Desired State를 가져온다
  2. Kubernetes API에서 Live State를 가져온다
  3. ArgoCD 내부에서 diff를 계산한다
  4. 문제: Kubernetes defaulting을 완벽히 처리하지 못할 수 있다

Server-Side Diff:
  1. ArgoCD가 Git에서 Desired State를 가져온다
  2. Desired State를 Kubernetes API에 dry-run으로 apply한다
  3. dry-run 결과(defaulting이 적용된 상태)와 Live State를 비교한다
  4. 장점: Kubernetes가 추가하는 기본값이 diff에 나타나지 않는다
  5. 장점: Admission Webhook이 추가하는 필드도 올바르게 처리한다
```

Server-Side Diff 활성화 방법:

```yaml
# argocd-cm ConfigMap
data:
  # 전체 적용
  controller.diff.server.side: "true"

# 또는 Application별로 설정
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  annotations:
    argocd.argoproj.io/compare-options: ServerSideDiff=true
```

### 전역 Diff 커스터마이징

`argocd-cm` ConfigMap에서 전체 시스템에 적용되는 diff 설정을 할 수 있다:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: argocd-cm
  namespace: argocd
data:
  # 전체 리소스에 적용되는 ignoreDifferences
  resource.customizations.ignoreDifferences.all: |
    managedFieldsManagers:
      - kube-controller-manager
      - kube-scheduler
    jqPathExpressions:
      - .metadata.annotations."kubectl.kubernetes.io/restartedAt"

  # 특정 리소스 타입에 적용
  resource.customizations.ignoreDifferences.apps_Deployment: |
    jqPathExpressions:
      - .spec.replicas

  # 커스텀 리소스에 적용
  resource.customizations.ignoreDifferences.admissionregistration.k8s.io_MutatingWebhookConfiguration: |
    jqPathExpressions:
      - .webhooks[]?.clientConfig.caBundle
```

---

