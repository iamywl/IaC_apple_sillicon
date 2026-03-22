# CKAD Day 5: Deployment와 배포 전략 (RollingUpdate, Recreate)

> CKAD 도메인: Application Deployment (20%) - Part 1a | 예상 소요 시간: 1시간

---

## 오늘의 학습 목표

- [ ] Deployment의 개념과 YAML 구조를 이해한다
- [ ] ReplicaSet과 Deployment의 관계를 설명할 수 있다
- [ ] RollingUpdate와 Recreate 전략의 차이를 숙지한다
- [ ] maxSurge, maxUnavailable 파라미터를 설정할 수 있다
- [ ] kubectl rollout 명령어로 롤백을 수행할 수 있다

---

## 1. Deployment (디플로이먼트) - 선언적 애플리케이션 관리

### 1.1 Deployment란?

**공학적 정의:**
Deployment는 apps/v1 API 그룹의 워크로드 컨트롤러로, ReplicaSet을 관리하여 선언적(declarative) 방식으로 Pod의 원하는 상태(desired state)를 유지한다. Deployment Controller는 spec.template의 변경을 감지하여 새 ReplicaSet을 생성하고, spec.strategy에 따라 이전 ReplicaSet의 Pod를 새 ReplicaSet의 Pod로 점진적(RollingUpdate) 또는 일괄(Recreate) 교체한다. 각 업데이트는 revision으로 기록되어 rollback이 가능하다.

**핵심 특징:**
- Pod의 원하는 수(replicas)를 자동으로 유지
- 이미지 업데이트 시 자동 롤링 업데이트
- 업데이트 이력(revision) 관리 및 롤백
- 스케일링(수평 확장/축소)

### 1.2 Deployment YAML 상세

```yaml
apiVersion: apps/v1              # apps API 그룹
kind: Deployment
metadata:
  name: web-deploy               # Deployment 이름
  namespace: demo
  labels:
    app: web                     # Deployment 자체의 레이블

spec:
  replicas: 3                    # 원하는 Pod 수

  selector:                      # 관리할 Pod를 선택하는 레이블
    matchLabels:
      app: web                   # template.metadata.labels와 반드시 일치!

  revisionHistoryLimit: 10       # 보관할 이전 ReplicaSet 수 (기본: 10)

  strategy:                      # 업데이트 전략
    type: RollingUpdate          # RollingUpdate(기본) 또는 Recreate
    rollingUpdate:
      maxSurge: 1                # 추가 허용 Pod 수 (3+1=4개까지)
      maxUnavailable: 1          # 동시 비가용 허용 수 (3-1=2개 최소 유지)

  template:                      # Pod 템플릿
    metadata:
      labels:
        app: web                 # selector.matchLabels와 일치해야 함!
    spec:
      containers:
        - name: nginx
          image: nginx:1.25
          ports:
            - containerPort: 80
```

### 1.3 Deployment와 ReplicaSet의 관계

```
[Deployment: web-deploy]
    |
    ├── [ReplicaSet: web-deploy-abc123] (현재, replicas=3)
    |   ├── [Pod: web-deploy-abc123-xxxxx]
    |   ├── [Pod: web-deploy-abc123-yyyyy]
    |   └── [Pod: web-deploy-abc123-zzzzz]
    |
    └── [ReplicaSet: web-deploy-def456] (이전, replicas=0)
        └── (Pod 없음, 롤백 시 사용)

Deployment가 ReplicaSet을 관리하고,
ReplicaSet이 Pod를 관리한다.
이미지 업데이트 시 새 ReplicaSet이 생성된다.
```

```bash
# Deployment 빠른 생성
kubectl create deployment web-deploy --image=nginx:1.25 --replicas=3

# Deployment 확인
kubectl get deployments -n demo
kubectl get replicasets -n demo    # Deployment가 관리하는 RS 확인
kubectl get pods -n demo           # RS가 관리하는 Pod 확인

# Deployment 상세 정보
kubectl describe deployment web-deploy -n demo

# 스케일링
kubectl scale deployment web-deploy --replicas=5 -n demo
```

---

## 2. Deployment 업데이트 전략

### 2.1 RollingUpdate (기본)

**공학적 정의:**
RollingUpdate는 Deployment Controller가 새 ReplicaSet의 Pod를 점진적으로 생성하면서 동시에 이전 ReplicaSet의 Pod를 종료하여 다운타임 없이 업데이트를 수행하는 전략이다. maxSurge와 maxUnavailable 파라미터로 동시 작업량을 제어한다.

```yaml
strategy:
  type: RollingUpdate
  rollingUpdate:
    maxSurge: 1                # replicas(3) + maxSurge(1) = 최대 4개 Pod
                               # 정수 또는 퍼센트(25%) 가능
    maxUnavailable: 1          # replicas(3) - maxUnavailable(1) = 최소 2개 가용
                               # 정수 또는 퍼센트(25%) 가능
```

**RollingUpdate 과정 (replicas=3, maxSurge=1, maxUnavailable=1):**

```
초기 상태:
  Old RS: [Pod-1] [Pod-2] [Pod-3]  (3/3 Running)
  New RS: (없음)

Step 1: 새 Pod 생성 + 이전 Pod 종료 시작
  Old RS: [Pod-1] [Pod-2] [Pod-3 Terminating]
  New RS: [Pod-4 Creating]

Step 2: 교체 진행
  Old RS: [Pod-1] [Pod-2 Terminating]
  New RS: [Pod-4 Running] [Pod-5 Creating]

Step 3: 교체 완료
  Old RS: (replicas=0, Pod 없음)
  New RS: [Pod-4] [Pod-5] [Pod-6]  (3/3 Running)
```

### 2.2 Recreate

**공학적 정의:**
Recreate 전략은 이전 ReplicaSet의 모든 Pod를 먼저 종료한 후 새 ReplicaSet의 Pod를 생성한다. 업데이트 중 서비스 중단(다운타임)이 발생하지만, 이전 버전과 새 버전이 동시에 실행되면 안 되는 경우(예: 스키마 마이그레이션)에 사용한다.

```yaml
strategy:
  type: Recreate              # 모든 이전 Pod 종료 후 새 Pod 생성
  # rollingUpdate 필드 사용 불가
```

**Recreate 과정:**

```
초기 상태:
  Old RS: [Pod-1] [Pod-2] [Pod-3]

Step 1: 모든 이전 Pod 종료
  Old RS: [Terminating] [Terminating] [Terminating]
  서비스 중단!

Step 2: 모든 새 Pod 생성
  New RS: [Pod-4] [Pod-5] [Pod-6]
  서비스 복구!
```

### 2.3 RollingUpdate vs Recreate 비교

| 항목 | RollingUpdate | Recreate |
|------|-------------|----------|
| 다운타임 | 없음 (Zero-downtime) | 있음 |
| 리소스 사용 | 일시적으로 더 많은 Pod | 동일 |
| 버전 공존 | 일시적으로 두 버전 공존 | 한 버전만 실행 |
| 사용 시나리오 | 일반적인 웹 앱 | DB 스키마 변경, 호환성 문제 |
| 속도 | 느림 (점진적) | 빠름 (일괄) |

---

## 3. Rollback과 Rollout 관리

### 3.1 이미지 업데이트

```bash
# 방법 1: kubectl set image
kubectl set image deployment/web-deploy nginx=nginx:1.25 -n demo
# 컨테이너 이름=새이미지

# 방법 2: kubectl edit
kubectl edit deployment web-deploy -n demo
# spec.template.spec.containers[0].image를 수정

# 방법 3: kubectl patch
kubectl patch deployment web-deploy -n demo \
  -p '{"spec":{"template":{"spec":{"containers":[{"name":"nginx","image":"nginx:1.25"}]}}}}'
```

### 3.2 Rollout 상태 확인

```bash
# 롤아웃 상태 확인
kubectl rollout status deployment/web-deploy -n demo
# "deployment "web-deploy" successfully rolled out"

# 롤아웃 이력 확인
kubectl rollout history deployment/web-deploy -n demo
# REVISION  CHANGE-CAUSE
# 1         <none>
# 2         <none>

# 특정 revision 상세 확인
kubectl rollout history deployment/web-deploy -n demo --revision=2
```

### 3.3 Rollback (롤백)

```bash
# 이전 버전으로 롤백
kubectl rollout undo deployment/web-deploy -n demo

# 특정 revision으로 롤백
kubectl rollout undo deployment/web-deploy -n demo --to-revision=1

# 일시 정지/재개
kubectl rollout pause deployment/web-deploy -n demo
kubectl rollout resume deployment/web-deploy -n demo
```

### 3.4 change-cause 기록

```bash
# 업데이트 시 이유 기록 (--record는 deprecated, annotation 사용)
kubectl annotate deployment web-deploy \
  kubernetes.io/change-cause="Update to nginx:1.25 for security patch" \
  -n demo

# 또는 YAML에서
metadata:
  annotations:
    kubernetes.io/change-cause: "Initial deployment"
```

---

## 4. 시험 출제 패턴과 팁

Application Deployment 도메인은 CKAD의 **20%**를 차지한다:

1. **Deployment 생성**: replicas, strategy 설정
2. **이미지 업데이트**: kubectl set image 또는 YAML 수정
3. **RollingUpdate 파라미터**: maxSurge, maxUnavailable 설정
4. **Rollback**: kubectl rollout undo --to-revision

```bash
# Deployment 빠른 생성
kubectl create deployment web --image=nginx:1.25 --replicas=3 --dry-run=client -o yaml > dep.yaml

# 이미지 업데이트
kubectl set image deployment/web nginx=nginx:1.25

# 롤아웃 관리
kubectl rollout status deployment/web
kubectl rollout history deployment/web
kubectl rollout undo deployment/web --to-revision=1

# 필드 구조 확인
kubectl explain deployment.spec.strategy
kubectl explain deployment.spec.strategy.rollingUpdate
```

---

## 5. 복습 체크리스트

- [ ] Deployment의 spec.selector.matchLabels와 template.metadata.labels가 일치해야 하는 이유를 안다
- [ ] Deployment -> ReplicaSet -> Pod의 관계를 설명할 수 있다
- [ ] RollingUpdate의 maxSurge와 maxUnavailable 파라미터를 설정할 수 있다
- [ ] Recreate 전략의 특성과 사용 시나리오를 안다
- [ ] `kubectl set image`로 이미지를 업데이트할 수 있다
- [ ] `kubectl rollout status/history/undo` 명령을 사용할 수 있다
- [ ] 특정 revision으로 롤백하는 방법을 안다
- [ ] `kubectl rollout pause/resume`으로 여러 변경을 한 번에 적용할 수 있다
- [ ] revisionHistoryLimit의 역할을 안다

---

## tart-infra 실습

### 실습 환경 설정

```bash
# dev 클러스터에 접속
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/dev.yaml
kubectl get nodes
```

### 실습 1: Deployment 상태 확인

```bash
# demo 네임스페이스의 Deployment 확인
kubectl get deployments -n demo -o wide

# ReplicaSet 확인 (Deployment가 관리하는 RS)
kubectl get rs -n demo

# Deployment 상세 정보
kubectl describe deployment nginx-web -n demo | head -30
```

**동작 원리:** Deployment의 업데이트 과정:
1. Deployment Controller가 spec.template 변경을 감지한다
2. 새 ReplicaSet을 생성하고 strategy에 따라 Pod를 교체한다
3. 이전 ReplicaSet은 replicas=0으로 유지되어 롤백 시 재사용된다
4. revisionHistoryLimit으로 보관할 RS 수를 제한한다

### 실습 2: Rollout 이력 확인

```bash
# nginx-web의 롤아웃 이력
kubectl rollout history deployment/nginx-web -n demo

# 현재 롤아웃 상태
kubectl rollout status deployment/nginx-web -n demo
```

**동작 원리:** Rollout 과정에서의 Pod 생명주기:
1. 새 ReplicaSet의 Pod가 생성되면 Scheduler가 노드에 배치한다
2. kubelet이 컨테이너를 시작하고 Readiness Probe가 성공하면 Ready 상태가 된다
3. Ready 상태가 되어야 Service Endpoints에 등록되어 트래픽을 수신한다
4. 이전 ReplicaSet의 Pod는 graceful shutdown(SIGTERM -> 대기 -> SIGKILL)으로 종료된다

### 실습 3: Scale 테스트

```bash
# nginx-web 스케일링
kubectl scale deployment nginx-web --replicas=2 -n demo
kubectl get pods -n demo -l app=nginx-web -w

# 원래대로 복구
kubectl scale deployment nginx-web --replicas=1 -n demo
```

**동작 원리:** Scale 동작:
1. kubectl scale은 Deployment의 spec.replicas를 변경한다
2. ReplicaSet Controller가 현재 Pod 수와 desired를 비교한다
3. 부족하면 새 Pod를 생성하고, 초과하면 Pod를 종료한다
4. HPA(Horizontal Pod Autoscaler)도 이 메커니즘을 사용한다
