# CKAD Day 11: API Deprecation과 버전 관리

> CKAD 도메인: Application Observability and Maintenance (15%) - Part 2a | 예상 소요 시간: 1시간

---

## 오늘의 학습 목표

- [ ] Kubernetes API 버전 단계(alpha/beta/stable)를 이해한다
- [ ] API Deprecation 정책과 버전 변경 이력을 숙지한다
- [ ] `kubectl api-versions`, `kubectl api-resources` 명령을 활용할 수 있다
- [ ] Deprecated 매니페스트를 최신 API로 마이그레이션할 수 있다
- [ ] `kubectl convert` 플러그인을 사용할 수 있다

---

## 1. Kubernetes API 버전 체계

### 1.1 등장 배경

```
[API Deprecation 정책이 필요한 이유]

Kubernetes는 빠르게 진화한다. 새로운 기능이 추가되면서 API 구조가 변경된다.
그러나 기존 사용자의 매니페스트를 즉시 무효화하면 운영 장애가 발생한다.

기존 방식의 한계:
- API를 변경하면 모든 사용자가 즉시 업데이트해야 한다
- 하위 호환성 없이 변경하면 CI/CD 파이프라인이 깨진다
- Helm Chart, Operator 등 생태계 전체에 파급 효과가 있다

해결:
- Alpha -> Beta -> GA 3단계로 API를 성숙시킨다
- Deprecation 후 일정 기간(최소 2~3 릴리스) 유지 후 제거한다
- 이 기간 동안 Warning 헤더로 사용자에게 마이그레이션을 안내한다
```

### 1.2 API 버전 단계

Kubernetes API는 Alpha -> Beta -> Stable(GA) 3단계 성숙도 모델을 따른다. 각 API 리소스는 특정 API 그룹과 버전의 조합(예: `apps/v1`, `batch/v1`)으로 식별되며, 상위 버전으로의 승격(promotion) 과정에서 하위 버전은 Deprecation 정책에 따라 제거된다. Kubernetes는 Deprecation 후 최소 N개의 마이너 릴리스 동안 해당 API를 유지한 후 제거하며, 이 기간은 버전 단계에 따라 다르다.

```
[API 버전 단계]

1. Alpha (예: v1alpha1)
   - 기본 비활성화 (feature gate 필요)
   - 언제든 변경/제거 가능
   - 프로덕션 사용 금지
   - 다음 릴리스에서 호환성 보장 없음

2. Beta (예: v1beta1, v2beta1)
   - 기본 활성화
   - 스키마 변경 가능하나 마이그레이션 경로 제공
   - Deprecation 후 3개 마이너 릴리스 유지 (v1.22+)
   - 프로덕션 사용 가능하나 주의 필요

3. Stable/GA (예: v1, v2)
   - 항상 활성화
   - 호환성 보장
   - Deprecation 후에도 장기간 유지
   - 프로덕션 권장
```

### 1.3 API 그룹

```
[주요 API 그룹]

Core (레거시)    ""          -> v1
                              Pod, Service, ConfigMap, Secret,
                              Namespace, Node, PersistentVolume

apps            "apps"      -> apps/v1
                              Deployment, ReplicaSet, StatefulSet,
                              DaemonSet

batch           "batch"     -> batch/v1
                              Job, CronJob (v1.21+)

networking      "networking.k8s.io" -> networking.k8s.io/v1
                              Ingress (v1.19+), NetworkPolicy

rbac            "rbac.authorization.k8s.io" -> rbac.authorization.k8s.io/v1
                              Role, ClusterRole, RoleBinding

autoscaling     "autoscaling" -> autoscaling/v2
                              HorizontalPodAutoscaler

policy          "policy"    -> policy/v1
                              PodDisruptionBudget (v1.21+)
```

### 1.4 주요 API 버전 변경 이력

```
[중요한 API 변경 이력]

Kubernetes 1.16 (2019):
  - Deployment:    extensions/v1beta1 -> apps/v1 (제거)
  - ReplicaSet:    extensions/v1beta1 -> apps/v1 (제거)
  - DaemonSet:     extensions/v1beta1 -> apps/v1 (제거)
  - StatefulSet:   apps/v1beta1       -> apps/v1 (제거)

Kubernetes 1.22 (2021):
  - Ingress:       extensions/v1beta1         -> networking.k8s.io/v1 (제거)
  - Ingress:       networking.k8s.io/v1beta1  -> networking.k8s.io/v1 (제거)
  - CronJob:       batch/v1beta1              -> batch/v1 (deprecated)

Kubernetes 1.25 (2022):
  - CronJob:       batch/v1beta1      -> batch/v1 (제거)
  - PodDisruptionBudget: policy/v1beta1 -> policy/v1 (제거)
  - EndpointSlice: discovery.k8s.io/v1beta1 -> discovery.k8s.io/v1 (제거)

Kubernetes 1.29 (2023):
  - FlowSchema:    flowcontrol.apiserver.k8s.io/v1beta2 -> v1beta3 (제거)
```

---

### 1.5 API 버전 변환의 내부 동작

```
[API Server의 버전 변환 메커니즘]

API Server는 리소스를 "내부 버전(internal version)"으로 저장한다.
클라이언트가 특정 API 버전으로 요청하면 자동 변환이 발생한다.

1. 요청 수신: extensions/v1beta1 Deployment
2. 디코딩: v1beta1 스키마로 파싱
3. 내부 변환: internal version으로 변환
4. Admission: Admission Controller 실행
5. 저장: etcd에 "preferred version"(apps/v1)으로 인코딩하여 저장
6. 응답: 요청된 API 버전으로 다시 변환하여 응답

따라서 v1beta1로 생성한 Deployment도 etcd에는 apps/v1 형식으로 저장된다.
해당 API 버전이 제거되면 v1beta1 형식의 요청 자체가 거부된다.
```

---

## 2. API 버전 확인 명령어

### 2.1 kubectl api-versions

```bash
# 클러스터에서 지원하는 모든 API 버전 확인
kubectl api-versions
# 출력 예:
# admissionregistration.k8s.io/v1
# apps/v1
# batch/v1
# networking.k8s.io/v1
# v1
# ...

# 특정 API 그룹 필터링
kubectl api-versions | grep apps
# apps/v1

kubectl api-versions | grep batch
# batch/v1

kubectl api-versions | grep networking
# networking.k8s.io/v1
```

### 2.2 kubectl api-resources

```bash
# 모든 리소스 확인 (이름, shortname, API 그룹, 종류)
kubectl api-resources
# NAME          SHORTNAMES  APIVERSION              NAMESPACED  KIND
# pods          po          v1                      true        Pod
# services      svc         v1                      true        Service
# deployments   deploy      apps/v1                 true        Deployment
# ingresses     ing         networking.k8s.io/v1    true        Ingress

# 특정 API 그룹의 리소스만 확인
kubectl api-resources --api-group=apps
# NAME          SHORTNAMES  APIVERSION  NAMESPACED  KIND
# deployments   deploy      apps/v1     true        Deployment
# replicasets   rs          apps/v1     true        ReplicaSet
# statefulsets  sts         apps/v1     true        StatefulSet
# daemonsets    ds          apps/v1     true        DaemonSet

# Namespaced 리소스만 확인
kubectl api-resources --namespaced=true

# 특정 verb를 지원하는 리소스 확인
kubectl api-resources --verbs=list,watch

# 특정 리소스의 API 버전 확인
kubectl explain deployment | head -5
# KIND:     Deployment
# VERSION:  apps/v1
```

### 2.3 리소스별 API 버전 확인

```bash
# 특정 리소스의 상세 스키마 확인
kubectl explain pod.spec.containers
kubectl explain deployment.spec.strategy
kubectl explain ingress.spec.rules

# 재귀적 필드 확인
kubectl explain pod.spec --recursive | head -50
```

---

## 3. Deprecated 매니페스트 마이그레이션

### 3.1 Ingress 마이그레이션 (가장 자주 출제)

```yaml
# === 이전 버전 (extensions/v1beta1) - 제거됨 ===
apiVersion: extensions/v1beta1
kind: Ingress
metadata:
  name: my-ingress
  annotations:
    kubernetes.io/ingress.class: nginx    # annotation으로 class 지정
spec:
  rules:
    - host: app.example.com
      http:
        paths:
          - path: /
            backend:
              serviceName: web-svc        # 옛 필드명
              servicePort: 80             # 옛 필드명

# === 현재 버전 (networking.k8s.io/v1) ===
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: my-ingress
spec:
  ingressClassName: nginx                 # annotation 대신 spec 필드
  rules:
    - host: app.example.com
      http:
        paths:
          - path: /
            pathType: Prefix              # 필수 필드 추가
            backend:
              service:                    # 구조 변경
                name: web-svc
                port:
                  number: 80
```

**핵심 변경점:**
```
1. apiVersion: extensions/v1beta1 -> networking.k8s.io/v1
2. annotation kubernetes.io/ingress.class -> spec.ingressClassName
3. pathType 필드 추가 (Prefix, Exact, ImplementationSpecific)
4. backend 구조 변경:
   serviceName -> service.name
   servicePort -> service.port.number (또는 service.port.name)
```

### 3.2 CronJob 마이그레이션

```yaml
# === 이전 버전 (batch/v1beta1) - 제거됨 ===
apiVersion: batch/v1beta1
kind: CronJob
metadata:
  name: backup-job

# === 현재 버전 (batch/v1) ===
apiVersion: batch/v1
kind: CronJob
metadata:
  name: backup-job
# 나머지 spec은 동일
```

### 3.3 Deployment 마이그레이션

```yaml
# === 이전 버전 (extensions/v1beta1) - 제거됨 ===
apiVersion: extensions/v1beta1
kind: Deployment
metadata:
  name: web-deploy
spec:
  replicas: 3
  template:
    # selector가 자동 생성됨 (옛 방식)
    metadata:
      labels:
        app: web
    spec:
      containers:
        - name: web
          image: nginx:1.25

# === 현재 버전 (apps/v1) ===
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web-deploy
spec:
  replicas: 3
  selector:               # selector 필수!
    matchLabels:
      app: web
  template:
    metadata:
      labels:
        app: web
    spec:
      containers:
        - name: web
          image: nginx:1.25
```

**핵심 변경점:**
```
1. apiVersion: extensions/v1beta1 -> apps/v1
2. spec.selector 필수 (matchLabels 명시)
3. selector는 불변(immutable) - 생성 후 변경 불가
```

---

## 4. kubectl convert 플러그인

### 4.1 설치 및 사용

```bash
# kubectl-convert 플러그인 설치 (krew 사용)
kubectl krew install convert

# 또는 직접 바이너리 설치
curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl-convert"
chmod +x kubectl-convert
sudo mv kubectl-convert /usr/local/bin/

# 사용법: 이전 API 버전의 매니페스트를 최신 버전으로 변환
kubectl convert -f old-ingress.yaml --output-version networking.k8s.io/v1

# 파일에 저장
kubectl convert -f old-ingress.yaml \
  --output-version networking.k8s.io/v1 > new-ingress.yaml

# Deployment 변환
kubectl convert -f old-deploy.yaml --output-version apps/v1

# 변환 후 적용
kubectl convert -f old-manifest.yaml --output-version apps/v1 | kubectl apply -f -
```

### 4.2 Deprecation Warning 확인

```bash
# kubectl 사용 시 Deprecation Warning 확인
kubectl apply -f old-manifest.yaml
# Warning: extensions/v1beta1 Ingress is deprecated in v1.14+,
# unavailable in v1.22+; use networking.k8s.io/v1 Ingress

# 클러스터의 deprecated API 사용 현황 확인
kubectl get --raw /metrics | grep apiserver_requested_deprecated_apis
```

---

## 5. 실전 시험 문제 (6문제)

### 문제 1. API 버전 확인

클러스터에서 지원하는 `batch` 그룹의 API 버전을 확인하고 `/tmp/batch-versions.txt`에 저장하라.

<details><summary>풀이</summary>

```bash
kubectl api-versions | grep batch > /tmp/batch-versions.txt
cat /tmp/batch-versions.txt
```

기대 출력:
```text
batch/v1
```

</details>

---

### 문제 2. API 리소스 확인

`apps` API 그룹에 속한 모든 리소스를 확인하고 `/tmp/apps-resources.txt`에 저장하라.

<details><summary>풀이</summary>

```bash
kubectl api-resources --api-group=apps > /tmp/apps-resources.txt
cat /tmp/apps-resources.txt
```

기대 출력:
```text
NAME                  SHORTNAMES   APIVERSION   NAMESPACED   KIND
controllerrevisions                apps/v1      true         ControllerRevision
daemonsets            ds           apps/v1      true         DaemonSet
deployments           deploy       apps/v1      true         Deployment
replicasets           rs           apps/v1      true         ReplicaSet
statefulsets          sts          apps/v1      true         StatefulSet
```

</details>

---

### 문제 3. Ingress 마이그레이션

다음 `extensions/v1beta1` Ingress를 `networking.k8s.io/v1`로 변환하여 `/tmp/new-ingress.yaml`에 저장하라.

```yaml
apiVersion: extensions/v1beta1
kind: Ingress
metadata:
  name: app-ingress
  annotations:
    kubernetes.io/ingress.class: nginx
spec:
  rules:
    - host: app.example.com
      http:
        paths:
          - path: /api
            backend:
              serviceName: api-svc
              servicePort: 8080
          - path: /
            backend:
              serviceName: web-svc
              servicePort: 80
```

<details><summary>풀이</summary>

```yaml
# /tmp/new-ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: app-ingress
spec:
  ingressClassName: nginx
  rules:
    - host: app.example.com
      http:
        paths:
          - path: /api
            pathType: Prefix
            backend:
              service:
                name: api-svc
                port:
                  number: 8080
          - path: /
            pathType: Prefix
            backend:
              service:
                name: web-svc
                port:
                  number: 80
```

**핵심 변경 사항:**
1. `apiVersion` 변경
2. `annotation` -> `ingressClassName`
3. `pathType: Prefix` 추가 (필수)
4. `backend` 구조 변경 (`serviceName/servicePort` -> `service.name/service.port.number`)

</details>

---

### 문제 4. Deployment API 버전 확인

다음 명령으로 Deployment의 올바른 API 버전과 필수 필드를 확인하라.

<details><summary>풀이</summary>

```bash
# API 버전 확인
kubectl explain deployment | head -3
# KIND:     Deployment
# VERSION:  apps/v1

# 필수 필드 확인
kubectl explain deployment.spec
# selector는 Required 필드임을 확인

# selector 상세
kubectl explain deployment.spec.selector
```

**핵심**: `apps/v1`에서 `spec.selector`는 필수이며 불변(immutable)이다.

</details>

---

### 문제 5. 특정 리소스의 API 정보

Pod에서 사용 가능한 `volumes` 타입을 `kubectl explain`으로 확인하라.

<details><summary>풀이</summary>

```bash
kubectl explain pod.spec.volumes
# emptyDir, hostPath, configMap, secret, persistentVolumeClaim 등

# 특정 볼륨 타입 상세
kubectl explain pod.spec.volumes.configMap
kubectl explain pod.spec.volumes.secret
```

</details>

---

### 문제 6. CronJob 마이그레이션

`batch/v1beta1` CronJob 매니페스트를 `batch/v1`로 변환하라.

```yaml
apiVersion: batch/v1beta1
kind: CronJob
metadata:
  name: log-cleanup
spec:
  schedule: "0 3 * * *"
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: cleanup
              image: busybox:1.36
              command: ["sh", "-c", "echo cleanup done"]
          restartPolicy: OnFailure
```

<details><summary>풀이</summary>

```yaml
apiVersion: batch/v1          # v1beta1 -> v1
kind: CronJob
metadata:
  name: log-cleanup
spec:
  schedule: "0 3 * * *"
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: cleanup
              image: busybox:1.36
              command: ["sh", "-c", "echo cleanup done"]
          restartPolicy: OnFailure
```

**핵심**: CronJob의 경우 `apiVersion`만 변경하면 된다. spec 구조는 동일하다.

</details>

---

## 6. 트러블슈팅

### 장애 시나리오 1: kubectl apply 시 "no matches for kind" 에러

```bash
# 증상
kubectl apply -f old-ingress.yaml
# error: resource mapping not found for name: "my-ingress" namespace: ""
# from "old-ingress.yaml": no matches for kind "Ingress" in version "extensions/v1beta1"

# 원인: 클러스터 버전이 1.22 이상이고 extensions/v1beta1 Ingress가 제거됨
# 디버깅: 현재 지원되는 Ingress API 확인
kubectl api-resources | grep ingress
```

```text
ingresses   ing   networking.k8s.io/v1   true   Ingress
```

```bash
# 해결: apiVersion을 networking.k8s.io/v1로 변경하고 스키마도 수정
# pathType 추가, backend 구조 변경, ingressClassName 사용
```

### 장애 시나리오 2: Helm Chart 업그레이드 시 deprecated API 에러

```bash
# 증상: helm upgrade 실행 시 에러
helm upgrade myrelease ./mychart
# Error: UPGRADE FAILED: current release manifest contains removed kubernetes API(s)
# for this kubernetes version and it is therefore unable to build the kubernetes objects

# 원인: 이전에 설치된 Release의 매니페스트가 제거된 API를 사용
# 디버깅
helm get manifest myrelease | grep apiVersion

# 해결: helm-mapkubeapis 플러그인으로 Release 매니페스트 업데이트
helm plugin install https://github.com/helm/helm-mapkubeapis
helm mapkubeapis myrelease
```

### 장애 시나리오 3: kubectl explain 결과와 실제 YAML 불일치

```bash
# 증상: kubectl explain에 표시된 필드를 사용했는데 에러
kubectl explain hpa.spec.metrics
# VERSION:  autoscaling/v2

kubectl apply -f hpa.yaml
# error: the API version in the data (autoscaling/v1) does not match the expected API version (autoscaling/v2)

# 원인: YAML의 apiVersion이 v1인데 v2 전용 필드(metrics)를 사용
# 해결: apiVersion을 autoscaling/v2로 변경
```

---

## 7. 복습 체크리스트

- [ ] API 버전 3단계(alpha/beta/stable)의 특성을 설명할 수 있다
- [ ] `kubectl api-versions`와 `kubectl api-resources`를 사용할 수 있다
- [ ] Ingress 마이그레이션(extensions/v1beta1 -> networking.k8s.io/v1) 변경점을 안다
- [ ] `pathType` 필드가 필수인 이유를 안다
- [ ] `kubectl explain`으로 리소스 스키마를 확인할 수 있다
- [ ] `kubectl convert`로 deprecated 매니페스트를 변환할 수 있다

---

## tart-infra 실습

### 실습 환경 설정

```bash
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/dev.yaml
kubectl version --short 2>/dev/null || kubectl version
```

### 실습 1: 클러스터의 API 버전 및 리소스 확인

dev 클러스터에서 지원하는 API 버전과 리소스를 확인한다.

```bash
# 지원 API 버전 목록
kubectl api-versions | sort

# 주요 리소스의 API 그룹 확인
kubectl api-resources | grep -E "^(deployments|ingresses|cronjobs|networkpolicies|poddisruptionbudgets)"

# 특정 리소스의 preferred version 확인
kubectl api-resources --api-group=batch
kubectl api-resources --api-group=networking.k8s.io
```

**예상 출력:**
```
NAME           SHORTNAMES   APIVERSION          NAMESPACED   KIND
cronjobs       cj           batch/v1            true         CronJob
jobs                        batch/v1            true         Job
```

**동작 원리:** `kubectl api-resources`는 API Server의 discovery endpoint(`/apis`)를 조회하여 지원 리소스 목록을 반환한다. `--api-group` 플래그로 특정 그룹만 필터링할 수 있다. CKAD 시험에서 올바른 apiVersion을 빠르게 찾는 핵심 명령이다.

### 실습 2: kubectl explain으로 리소스 스키마 탐색

```bash
# Ingress의 현재 API 스키마 확인
kubectl explain ingress.spec.rules.http.paths

# HPA의 API 스키마 확인 (dev 클러스터에 HPA 설정 존재)
kubectl explain hpa.spec.metrics

# 실제 HPA 리소스의 apiVersion 확인
kubectl get hpa -n demo -o yaml 2>/dev/null | grep apiVersion || echo "HPA가 없으면 manifests/hpa/ 확인"
```

**예상 출력 (explain):**
```
KIND:     Ingress
VERSION:  networking.k8s.io/v1

FIELD: paths <[]Object>
   path         <string>
   pathType     <string> -required-
   backend      <Object> -required-
```

**동작 원리:** `kubectl explain`은 API Server의 OpenAPI 스키마를 조회하여 각 필드의 타입, 필수 여부, 설명을 보여준다. `.`으로 중첩 필드를 탐색할 수 있다. 시험에서 YAML 필드명이 기억나지 않을 때 즉시 확인하는 방법이다.

### 실습 3: 실제 리소스의 API 버전 검증

```bash
# demo 네임스페이스의 모든 리소스와 API 버전 확인
kubectl get deploy,svc,ingress,networkpolicy -n demo -o jsonpath='{range .items[*]}{.apiVersion}{" "}{.kind}{" "}{.metadata.name}{"\n"}{end}'

# NetworkPolicy API 확인 (tart-infra에 설정 존재)
kubectl get networkpolicy -n demo -o yaml 2>/dev/null | grep -E "apiVersion|kind|name" | head -9
```

**동작 원리:** 클러스터에 배포된 리소스들의 apiVersion을 확인하면 해당 클러스터가 지원하는 API 수준을 파악할 수 있다. deprecated API를 사용하는 매니페스트가 있으면 클러스터 업그레이드 시 오류가 발생할 수 있으므로 사전 점검이 중요하다.
