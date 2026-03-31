# CKAD Day 8: Helm 실전과 Deployment 내부 동작 심화

> CKAD 도메인: Application Deployment (20%) - Part 2b | 예상 소요 시간: 1시간

---

## 오늘의 학습 목표

- [ ] Helm 실전 활용 패턴(환경별 배포, 롤백)을 연습한다
- [ ] Deployment Controller의 상세 내부 동작을 이해한다
- [ ] Helm과 Deployment 관련 실전 문제를 풀 수 있다
- [ ] 자주 하는 실수와 주의사항을 숙지한다

---

## 1. Helm 실전 활용

### 1.1 등장 배경

Kubernetes 매니페스트를 직접 관리하면 다음과 같은 한계가 있다:

```
[기존 방식의 한계]

1. 환경별 분기 불가
   - dev/staging/prod에 동일 YAML을 복사 후 수동 수정
   - 환경 간 불일치 발생 (drift)

2. 롤백 어려움
   - kubectl apply로 배포하면 이전 상태를 추적할 수 없다
   - git revert 후 재배포해야 하며, 순서 의존성 관리가 불가능하다

3. 다수 리소스 일괄 관리 불가
   - Deployment, Service, ConfigMap, Ingress를 개별 관리해야 한다
   - 하나의 앱이 10개 이상의 YAML 파일을 가질 수 있다

Helm은 이 문제를 Chart(패키지) 단위로 해결한다.
values.yaml로 환경별 변수를 주입하고, Release 단위로 버전/롤백을 관리한다.
```

### 1.2 환경별 배포

```bash
# dev 환경
helm install myapp ./mychart -f values-dev.yaml -n dev

# staging 환경
helm install myapp ./mychart -f values-staging.yaml -n staging

# production 환경
helm install myapp ./mychart -f values-prod.yaml -n production \
  --set image.tag=v2.0.1 \
  --set replicaCount=5
```

검증:
```bash
helm list -n production
```

기대 출력:
```text
NAME    NAMESPACE    REVISION    UPDATED                                 STATUS      CHART            APP VERSION
myapp   production   1           2024-01-15 10:30:00.123456 +0900 KST    deployed    mychart-0.1.0    1.0.0
```

### 1.3 Helm으로 배포 관리

```bash
# 업그레이드
helm upgrade myapp ./mychart -f values-prod.yaml --set image.tag=v2.0.2

# 업그레이드 히스토리 확인
helm history myapp -n production

# 문제 발생 시 롤백
helm rollback myapp 2 -n production

# Release가 사용 중인 values 확인
helm get values myapp -n production
```

검증:
```bash
helm history myapp -n production
```

기대 출력:
```text
REVISION    UPDATED                     STATUS        CHART            APP VERSION    DESCRIPTION
1           Mon Jan 15 10:30:00 2024    superseded    mychart-0.1.0    1.0.0          Install complete
2           Mon Jan 15 11:00:00 2024    superseded    mychart-0.1.0    1.0.0          Upgrade complete
3           Mon Jan 15 11:30:00 2024    deployed      mychart-0.1.0    1.0.0          Rollback to 2
```

### 1.4 Helm 내부 동작 원리

```
[helm install 실행 시 내부 과정]

1. Chart 로딩
   - templates/ 디렉토리의 Go 템플릿 파일 파싱
   - values.yaml + -f 오버라이드 + --set 값 병합

2. 템플릿 렌더링
   - Go template 엔진이 {{ .Values.xxx }}를 치환
   - 결과물은 순수 Kubernetes YAML 매니페스트

3. API Server에 전송
   - 렌더링된 매니페스트를 kubectl apply와 동일하게 전송
   - 리소스 간 의존성 순서(Namespace -> ConfigMap -> Deployment)로 적용

4. Release 정보 저장
   - Release 메타데이터를 해당 네임스페이스의 Secret으로 저장
   - Secret 이름 형식: sh.helm.release.v1.<release-name>.v<revision>
   - 이 Secret에 렌더링된 매니페스트, values, Chart 메타데이터가 포함된다
```

---

## 2. Deployment Controller 내부 동작 심화

### 2.1 Deployment Controller의 상세 동작

```
[kubectl apply -f deployment.yaml]
    |
    v
[API Server]
    ├── Admission Controllers (ResourceQuota, LimitRange 등)
    ├── Validation (YAML 문법, 필드 검증)
    └── etcd에 Deployment 오브젝트 저장
    |
    v
[Deployment Controller] (kube-controller-manager 내부)
    ├── Deployment 변경 감지 (Informer/Watch)
    ├── spec.template 해시 계산
    |   └── 이전 ReplicaSet과 비교
    |
    ├── [새 template인 경우]
    |   ├── 새 ReplicaSet 생성 (hash suffix 포함)
    |   |   예: app-deploy-6d5b7c9f8d (해시: 6d5b7c9f8d)
    |   |
    |   └── strategy에 따라 스케일 조정
    |       ├── RollingUpdate:
    |       |   ├── 새 RS replicas 증가 (maxSurge만큼)
    |       |   └── 이전 RS replicas 감소 (maxUnavailable만큼)
    |       |   └── 반복 (모든 Pod가 새 버전이 될 때까지)
    |       |
    |       └── Recreate:
    |           ├── 이전 RS replicas -> 0 (모든 Pod 종료)
    |           └── 새 RS replicas -> desired (새 Pod 생성)
    |
    └── [같은 template인 경우]
        └── replicas만 조정 (기존 RS 사용)
    |
    v
[ReplicaSet Controller]
    ├── desired vs actual Pod 수 비교
    ├── 부족하면: Pod 생성 요청
    └── 초과하면: Pod 삭제 요청
    |
    v
[Scheduler]
    ├── 생성 요청된 Pod에 적합한 Node 선택
    └── Pod에 nodeName 할당
    |
    v
[Kubelet]
    ├── 할당된 Pod 감지
    ├── 컨테이너 런타임(containerd)에 컨테이너 생성 요청
    └── Probe 실행 (Startup -> Liveness, Readiness)
```

### 2.2 RollingUpdate 상세 과정 (replicas=4, maxSurge=1, maxUnavailable=1)

```
초기 상태: Old RS (4 Pod)
최대 총 Pod 수: 4 + 1(maxSurge) = 5
최소 가용 Pod 수: 4 - 1(maxUnavailable) = 3

단계 1: New RS 생성, 1 Pod 시작 (maxSurge=1)
  Old RS: ████ (4 running)
  New RS: ░    (1 starting)
  총: 5 (최대 5 이내), 가용: 4 (최소 3 이상)

단계 2: New Pod Ready -> Old Pod 1개 종료
  Old RS: ███  (3 running, 1 terminating)
  New RS: █    (1 running)
  총: 4, 가용: 4

단계 3: Old Pod 종료 완료, New Pod 1개 추가
  Old RS: ███  (3 running)
  New RS: █░   (1 running, 1 starting)
  총: 5, 가용: 4

... (반복)

최종: New RS (4 Pod), Old RS (0 Pod)
  Old RS: (0, 보관됨, revisionHistoryLimit까지)
  New RS: ████ (4 running)
```

### 2.3 Revision과 ReplicaSet의 관계

```bash
# Deployment의 revision 히스토리
kubectl rollout history deployment/app-deploy
# REVISION  CHANGE-CAUSE
# 1         <none>
# 2         kubectl set image deployment/app-deploy nginx=nginx:1.25
# 3         kubectl set image deployment/app-deploy nginx=nginx:1.26

# 각 revision은 ReplicaSet에 매핑
kubectl get rs -l app=app-deploy
# NAME                     DESIRED   CURRENT   READY   AGE
# app-deploy-6d5b7c9f8d    0         0         0       10m   # revision 1
# app-deploy-7f8b9c1d2e    0         0         0       5m    # revision 2
# app-deploy-3a4b5c6d7e    4         4         4       1m    # revision 3 (현재)

# 특정 revision의 상세 정보
kubectl rollout history deployment/app-deploy --revision=2
# 이미지, 환경변수, 레이블 등 확인 가능

# revisionHistoryLimit (기본: 10)
# 오래된 ReplicaSet은 자동 삭제됨
```

---

## 3. 실전 시험 문제 (12문제)

### 문제 1. Helm 설치 및 값 오버라이드

bitnami 리포지토리에서 nginx Chart를 설치하라.

- Release 이름: `web-release`
- 네임스페이스: `helm-exam` (없으면 생성)
- replicaCount: 2
- service.type: NodePort

<details><summary>풀이</summary>

```bash
helm repo add bitnami https://charts.bitnami.com/bitnami
helm repo update

helm install web-release bitnami/nginx \
  -n helm-exam --create-namespace \
  --set replicaCount=2 \
  --set service.type=NodePort
```

검증:
```bash
helm list -n helm-exam
```

기대 출력:
```text
NAME          NAMESPACE    REVISION    STATUS      CHART          APP VERSION
web-release   helm-exam    1           deployed    nginx-x.x.x   x.x.x
```

```bash
kubectl get deploy,svc -n helm-exam
```

기대 출력:
```text
NAME                          READY   UP-TO-DATE   AVAILABLE   AGE
deployment.apps/web-release   2/2     2            2           30s

NAME                  TYPE       CLUSTER-IP     EXTERNAL-IP   PORT(S)        AGE
service/web-release   NodePort   10.96.x.x     <none>        80:3xxxx/TCP   30s
```

</details>

---

### 문제 2. Helm 업그레이드

문제 1에서 설치한 `web-release`를 업그레이드하라.

- replicaCount: 4
- service.type: ClusterIP

<details><summary>풀이</summary>

```bash
helm upgrade web-release bitnami/nginx \
  -n helm-exam \
  --set replicaCount=4 \
  --set service.type=ClusterIP
```

검증:
```bash
helm history web-release -n helm-exam
```

기대 출력:
```text
REVISION    UPDATED                     STATUS        CHART          DESCRIPTION
1           ...                         superseded    nginx-x.x.x   Install complete
2           ...                         deployed      nginx-x.x.x   Upgrade complete
```

```bash
kubectl get deploy -n helm-exam -o jsonpath='{.items[0].spec.replicas}'
```

기대 출력:
```text
4
```

</details>

---

### 문제 3. Helm 롤백

`web-release`를 revision 1로 롤백하라.

<details><summary>풀이</summary>

```bash
helm rollback web-release 1 -n helm-exam
```

검증:
```bash
helm history web-release -n helm-exam
```

기대 출력:
```text
REVISION    UPDATED                     STATUS        CHART          DESCRIPTION
1           ...                         superseded    nginx-x.x.x   Install complete
2           ...                         superseded    nginx-x.x.x   Upgrade complete
3           ...                         deployed      nginx-x.x.x   Rollback to 1
```

```bash
kubectl get deploy -n helm-exam -o jsonpath='{.items[0].spec.replicas}'
```

기대 출력:
```text
2
```

</details>

---

### 문제 4. Helm Release 정보 확인

`web-release`의 현재 적용된 values를 YAML로 출력하고 `/tmp/helm-values.yaml`에 저장하라.

<details><summary>풀이</summary>

```bash
helm get values web-release -n helm-exam -o yaml > /tmp/helm-values.yaml
cat /tmp/helm-values.yaml
```

기대 출력:
```text
USER-SUPPLIED VALUES:
replicaCount: 2
service:
  type: NodePort
```

</details>

---

### 문제 5. Helm 삭제

`web-release`를 삭제하라.

<details><summary>풀이</summary>

```bash
helm uninstall web-release -n helm-exam
```

검증:
```bash
helm list -n helm-exam
```

기대 출력:
```text
NAME    NAMESPACE    REVISION    UPDATED    STATUS    CHART    APP VERSION
```

```bash
kubectl get deploy -n helm-exam
```

기대 출력:
```text
No resources found in helm-exam namespace.
```

</details>

---

### 문제 6. Deployment maxSurge/maxUnavailable 분석

다음 Deployment가 업데이트될 때 동시에 존재할 수 있는 최대 Pod 수와 최소 가용 Pod 수를 계산하라.

```yaml
spec:
  replicas: 6
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 2
      maxUnavailable: 1
```

<details><summary>풀이</summary>

```
최대 총 Pod 수 = replicas + maxSurge = 6 + 2 = 8
최소 가용 Pod 수 = replicas - maxUnavailable = 6 - 1 = 5

따라서:
- 업데이트 중 최대 8개의 Pod가 동시에 존재할 수 있다
- 항상 최소 5개의 Pod가 Ready 상태를 유지한다
```

</details>

---

### 문제 7. Deployment Recreate 전략

replicas=3인 Deployment를 Recreate 전략으로 생성하라.

- 이름: `batch-deploy`, 이미지: `busybox:1.36`
- command: `["sh", "-c", "sleep 3600"]`

이미지를 `busybox:1.37`로 업데이트하고 동작을 관찰하라.

<details><summary>풀이</summary>

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: batch-deploy
spec:
  replicas: 3
  strategy:
    type: Recreate
  selector:
    matchLabels:
      app: batch-deploy
  template:
    metadata:
      labels:
        app: batch-deploy
    spec:
      containers:
        - name: app
          image: busybox:1.36
          command: ["sh", "-c", "sleep 3600"]
```

```bash
kubectl apply -f batch-deploy.yaml
kubectl set image deployment/batch-deploy app=busybox:1.37

# 관찰: 모든 Old Pod가 먼저 Terminating -> 그 후 New Pod 생성
kubectl get pods -w -l app=batch-deploy
```

기대 출력 (시간 순서):
```text
NAME                           READY   STATUS        RESTARTS   AGE
batch-deploy-6d5b7c9f8d-abc    1/1     Terminating   0          2m
batch-deploy-6d5b7c9f8d-def    1/1     Terminating   0          2m
batch-deploy-6d5b7c9f8d-ghi    1/1     Terminating   0          2m
batch-deploy-7f8b9c1d2e-xyz    0/1     Pending       0          0s
batch-deploy-7f8b9c1d2e-xyz    0/1     ContainerCreating   0   0s
batch-deploy-7f8b9c1d2e-xyz    1/1     Running       0          3s
```

**핵심**: Recreate 전략은 모든 기존 Pod를 먼저 종료한 후 새 Pod를 생성한다. 다운타임이 발생하므로 stateless 배치 작업에 적합하다.

</details>

---

### 문제 8. Rollout pause/resume

Deployment `rolling-app` (nginx:1.24, replicas=4)를 생성하고:

1. 롤아웃을 일시 중지하라
2. 이미지를 nginx:1.25로 업데이트하라 (pause 상태에서)
3. replicas를 6으로 변경하라
4. 롤아웃을 재개하라 (모든 변경이 한 번에 적용)

<details><summary>풀이</summary>

```bash
kubectl create deployment rolling-app --image=nginx:1.24 --replicas=4

# 1. pause
kubectl rollout pause deployment/rolling-app

# 2-3. 여러 변경 사항 적용 (pause 중이므로 롤아웃 안 됨)
kubectl set image deployment/rolling-app nginx=nginx:1.25
kubectl scale deployment/rolling-app --replicas=6

# 4. resume (한 번에 적용)
kubectl rollout resume deployment/rolling-app
kubectl rollout status deployment/rolling-app
```

검증:
```bash
kubectl rollout status deployment/rolling-app
```

기대 출력:
```text
deployment "rolling-app" successfully rolled out
```

```bash
kubectl get deployment rolling-app -o jsonpath='{.spec.replicas} {.spec.template.spec.containers[0].image}'
```

기대 출력:
```text
6 nginx:1.25
```

**핵심**: `rollout pause`를 사용하면 여러 변경 사항을 모아서 한 번의 롤아웃으로 적용할 수 있다. pause 상태에서는 spec 변경이 반영되지 않고, resume 시 누적된 변경이 단일 revision으로 반영된다.

</details>

---

### 문제 9. Deployment revision 관리

1. Deployment `versioned-app`을 nginx:1.23으로 생성하라 (replicas=2)
2. 이미지를 nginx:1.24로 업데이트하라
3. CHANGE-CAUSE를 annotation으로 수동 기록하라
4. nginx:1.25로 업데이트하라
5. rollout history를 확인하고 revision 1로 롤백하라

<details><summary>풀이</summary>

```bash
# 1. 생성
kubectl create deployment versioned-app --image=nginx:1.23 --replicas=2

# 2. 업데이트
kubectl set image deployment/versioned-app nginx=nginx:1.24

# 3. CHANGE-CAUSE annotation 추가
kubectl annotate deployment/versioned-app \
  kubernetes.io/change-cause="Update to nginx:1.24"

# 4. 다시 업데이트
kubectl set image deployment/versioned-app nginx=nginx:1.25
kubectl annotate deployment/versioned-app \
  kubernetes.io/change-cause="Update to nginx:1.25"

# 5. 히스토리 확인 및 롤백
kubectl rollout history deployment/versioned-app
kubectl rollout undo deployment/versioned-app --to-revision=1

# 현재 이미지 확인
kubectl get deployment versioned-app -o jsonpath='{.spec.template.spec.containers[0].image}'
# nginx:1.23
```

</details>

---

### 문제 10. Canary 배포 트래픽 비율

Canary 배포를 구현하고 트래픽 비율을 90:10으로 설정하라.

- Stable: `api-stable` (nginx:1.24, replicas=9, labels: app=api)
- Canary: `api-canary` (nginx:1.25, replicas=1, labels: app=api)
- Service: `api-svc` (selector: app=api)

<details><summary>풀이</summary>

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-stable
spec:
  replicas: 9
  selector:
    matchLabels:
      app: api
      version: stable
  template:
    metadata:
      labels:
        app: api
        version: stable
    spec:
      containers:
        - name: nginx
          image: nginx:1.24
          ports:
            - containerPort: 80
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-canary
spec:
  replicas: 1
  selector:
    matchLabels:
      app: api
      version: canary
  template:
    metadata:
      labels:
        app: api
        version: canary
    spec:
      containers:
        - name: nginx
          image: nginx:1.25
          ports:
            - containerPort: 80
---
apiVersion: v1
kind: Service
metadata:
  name: api-svc
spec:
  selector:
    app: api
  ports:
    - port: 80
      targetPort: 80
```

검증:
```bash
kubectl get pods -l app=api --show-labels
```

기대 출력:
```text
NAME                          READY   STATUS    RESTARTS   AGE   LABELS
api-stable-xxx-aaa            1/1     Running   0          30s   app=api,version=stable
api-stable-xxx-bbb            1/1     Running   0          30s   app=api,version=stable
...  (9개)
api-canary-yyy-ccc            1/1     Running   0          30s   app=api,version=canary
```

**핵심**: Service selector가 `app=api`이므로 stable(9개)과 canary(1개) Pod 모두에 트래픽이 분배된다. replica 비율 9:1로 약 90%는 stable, 10%는 canary로 트래픽이 전달된다. 이 방식은 Ingress Controller 없이도 구현 가능하지만, 정밀한 가중치 제어가 필요하면 Istio VirtualService를 사용한다.

</details>

---

### 문제 11. Helm values 파일로 설치

다음 values 파일을 작성하고 nginx Chart를 설치하라.

요구사항:
- replicaCount: 3
- image.tag: "1.25"
- service.type: ClusterIP
- resources.requests: cpu=100m, memory=128Mi

<details><summary>풀이</summary>

```bash
cat > /tmp/custom-values.yaml << 'EOF'
replicaCount: 3
image:
  tag: "1.25"
service:
  type: ClusterIP
resources:
  requests:
    cpu: 100m
    memory: 128Mi
EOF

helm install custom-nginx bitnami/nginx \
  -f /tmp/custom-values.yaml \
  -n helm-exam --create-namespace
```

</details>

---

### 문제 12. Deployment 상태 분석

다음 Deployment의 상태를 분석하고 문제를 해결하라.

```bash
kubectl get deployment web-app -o wide
# NAME      READY   UP-TO-DATE   AVAILABLE   AGE
# web-app   2/4     2            2           5m
```

4개의 Pod 중 2개만 Ready 상태이다. 원인을 찾고 해결하라.

<details><summary>풀이</summary>

```bash
# 1. Pod 상태 확인
kubectl get pods -l app=web-app

# 2. 문제 Pod 상세 확인
kubectl describe pod <problem-pod-name>

# 가능한 원인과 해결:
# a) Pending: 리소스 부족
kubectl describe node | grep -A5 "Allocated resources"

# b) ImagePullBackOff: 이미지 없음
kubectl set image deployment/web-app web=nginx:1.25

# c) CrashLoopBackOff: 앱 오류
kubectl logs <pod-name> --previous

# 3. Events 확인
kubectl get events --sort-by=.lastTimestamp | tail -20
```

**핵심**: Deployment 상태에서 READY, UP-TO-DATE, AVAILABLE의 의미:
- **READY**: 현재 Ready인 Pod / 원하는 Pod 수
- **UP-TO-DATE**: 최신 template으로 생성된 Pod 수
- **AVAILABLE**: 사용 가능한 Pod 수 (minReadySeconds 이후)

</details>

---

## 4. 자주 하는 실수와 주의사항

### 실수 1: Helm install과 upgrade 혼동

```bash
# install은 새 Release만 가능 (이미 존재하면 에러)
helm install my-release bitnami/nginx
# Error: INSTALLATION FAILED: cannot re-use a name that is still in use

# 해결: upgrade --install (없으면 설치, 있으면 업그레이드)
helm upgrade --install my-release bitnami/nginx
```

### 실수 2: Helm values 우선순위

```bash
# 우선순위 (높은 것이 승리):
# 1. --set (가장 높음)
# 2. -f values-override.yaml (나중에 지정한 것이 우선)
# 3. Chart의 values.yaml (가장 낮음)

helm install myapp ./mychart \
  -f values-base.yaml \
  -f values-prod.yaml \
  --set image.tag=v2.0.0
# image.tag는 v2.0.0 (--set이 최우선)
```

### 실수 3: maxSurge와 maxUnavailable 동시에 0

```yaml
# 잘못된 설정 (둘 다 0이면 업데이트 불가)
strategy:
  type: RollingUpdate
  rollingUpdate:
    maxSurge: 0           # 추가 Pod 생성 불가
    maxUnavailable: 0     # 기존 Pod 제거 불가
# -> 업데이트가 진행되지 않음!

# 올바른 설정: 최소 하나는 1 이상
    maxSurge: 1
    maxUnavailable: 0     # 다운타임 없는 배포 (하나씩 교체)
```

### 실수 4: rollout undo와 revision 번호

```bash
# 롤백 후에도 새 revision이 생성됨
# revision 3에서 1로 롤백하면 -> revision 4가 생성 (내용은 1과 동일)
```

---

## 5. 트러블슈팅

### 장애 시나리오 1: helm upgrade 후 Pod가 CrashLoopBackOff

```bash
# 증상: 업그레이드 후 Pod가 반복 재시작
helm history myapp -n production
kubectl get pods -n production

# 디버깅
kubectl describe pod <pod-name> -n production
kubectl logs <pod-name> -n production --previous

# 원인: values에 잘못된 이미지 태그, 환경변수 누락 등
# 해결: 즉시 롤백
helm rollback myapp <previous-revision> -n production
```

### 장애 시나리오 2: RollingUpdate가 진행되지 않음

```bash
# 증상: rollout status가 멈춤
kubectl rollout status deployment/app-deploy
# Waiting for deployment "app-deploy" rollout to finish: 1 out of 4 new replicas have been updated...

# 디버깅
kubectl get rs -l app=app-deploy
kubectl get pods -l app=app-deploy
kubectl describe pod <pending-or-failing-pod>

# 흔한 원인:
# 1. 새 Pod의 Readiness Probe 실패 -> maxUnavailable=0이면 진행 불가
# 2. 리소스 부족으로 새 Pod가 Pending
# 3. 이미지 Pull 실패

# 해결
kubectl rollout undo deployment/app-deploy    # 이전 버전으로 롤백
```

### 장애 시나리오 3: helm install 시 "already exists" 에러

```bash
# 증상
helm install myapp ./mychart -n production
# Error: INSTALLATION FAILED: cannot re-use a name that is still in use

# 디버깅: 기존 Release 상태 확인
helm list -n production
helm status myapp -n production

# 해결 방법 1: upgrade --install 사용 (멱등성 확보)
helm upgrade --install myapp ./mychart -n production

# 해결 방법 2: 기존 Release가 failed 상태이면 삭제 후 재설치
helm uninstall myapp -n production
helm install myapp ./mychart -n production
```

---

## 6. 복습 체크리스트

- [ ] Deployment Controller가 ReplicaSet을 어떻게 관리하는지 설명할 수 있다
- [ ] RollingUpdate 시 maxSurge, maxUnavailable에 따른 최대/최소 Pod 수를 계산할 수 있다
- [ ] revision과 ReplicaSet의 관계를 이해한다
- [ ] Deployment 상태(READY, UP-TO-DATE, AVAILABLE)를 분석할 수 있다
- [ ] Helm values 우선순위를 안다 (--set > -f > Chart defaults)
- [ ] `helm upgrade --install` 패턴을 사용할 수 있다

---

## tart-infra 실습

### 실습 환경 설정

```bash
# dev 클러스터에 접속
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/dev.yaml
kubectl get nodes
```

### 실습 1: Helm Release 확인

```bash
# 설치된 Helm Release 확인
helm list -A
```

**동작 원리:** Helm Release 정보:
1. Helm v3는 Release 정보를 해당 네임스페이스의 Secret으로 저장한다
2. Secret 이름: `sh.helm.release.v1.<release-name>.v<revision>`
3. `helm list -A`는 모든 네임스페이스의 Release를 조회한다

### 실습 2: Deployment 롤아웃 분석

```bash
# nginx-web Deployment의 롤아웃 히스토리
kubectl rollout history deployment/nginx-web -n demo

# ReplicaSet 목록 (각 revision에 대응)
kubectl get rs -n demo -l app=nginx-web

# 현재 strategy 확인
kubectl get deployment nginx-web -n demo -o jsonpath='{.spec.strategy}' | python3 -m json.tool
```

### 실습 3: Helm Chart values 분석

```bash
# Cilium Chart의 현재 values 확인
helm get values cilium -n kube-system -o yaml | head -30
```

**동작 원리:** Helm values 시스템:
1. Chart에 `values.yaml`이 기본값을 정의한다
2. 설치/업그레이드 시 `-f values.yaml` 또는 `--set`으로 오버라이드한다
3. `helm get values`는 사용자가 오버라이드한 값만 보여준다
4. `helm get values --all`은 기본값을 포함한 모든 값을 보여준다
