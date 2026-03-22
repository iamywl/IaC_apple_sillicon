# CKA Day 7: Deployment & Rolling Update 기초

> 학습 목표 | CKA 도메인: Workloads & Scheduling (15%) - Part 1 | 예상 소요 시간: 4시간

---

## 오늘의 학습 목표

- [ ] Deployment의 내부 동작 원리를 완벽히 이해한다
- [ ] RollingUpdate와 Recreate 전략의 차이를 설명할 수 있다
- [ ] maxSurge와 maxUnavailable의 의미와 계산법을 알고 있다
- [ ] rollout 상태 확인, 이력 조회, 롤백을 자유롭게 수행한다
- [ ] 시험에서 Deployment를 빠르게 생성하고 조작한다
- [ ] Deployment Controller의 내부 동작 흐름을 설명할 수 있다
- [ ] progressDeadlineSeconds와 minReadySeconds의 역할을 이해한다

---

## 1. Deployment 완벽 이해

### 1.1 Deployment의 역할과 아키텍처

Deployment는 ReplicaSet을 관리하는 상위 컨트롤러로, Pod Template의 선언적 업데이트와 롤백을 자동화한다. Deployment Controller는 kube-controller-manager 내에서 Watch 기반 reconciliation loop를 실행하며, Pod Template 해시 변경 시 새 ReplicaSet을 생성하고 이전 ReplicaSet의 replicas를 점진적으로 0으로 축소한다.

**Deployment가 관리하는 핵심 메커니즘:**
- Pod Template이 변경되면 새 ReplicaSet이 생성되고, maxSurge/maxUnavailable 파라미터에 따라 롤링 교체가 수행된다
- 이전 ReplicaSet은 replicas=0으로 유지되어 롤백 시 해당 ReplicaSet의 Pod Template을 복원한다
- revisionHistoryLimit(기본값: 10)으로 보관할 이전 ReplicaSet 수를 제한한다

**Deployment가 제공하는 기능:**
1. **원하는 수의 Pod를 유지** -- replicas 수만큼 항상 Pod가 실행됨
2. **롤링 업데이트** -- 무중단으로 새 버전 배포
3. **롤백** -- 이전 버전으로 쉽게 되돌리기
4. **스케일링** -- Pod 수를 늘리거나 줄이기
5. **자동 복구** -- Pod가 실패하면 자동으로 새 Pod 생성
6. **일시정지/재개** -- 배포를 일시정지하고 여러 변경을 한 번에 적용
7. **배포 이력 관리** -- 이전 버전 이력을 관리하고 원하는 버전으로 롤백

### 1.2 Deployment → ReplicaSet → Pod 관계

```
Deployment (nginx-deploy)
│
├── ReplicaSet (nginx-deploy-7f6d8b9c5d)  ← 현재 활성 (revision 3)
│     ├── Pod (nginx-deploy-7f6d8b9c5d-abc12)  ← Running
│     ├── Pod (nginx-deploy-7f6d8b9c5d-def34)  ← Running
│     └── Pod (nginx-deploy-7f6d8b9c5d-ghi56)  ← Running
│
├── ReplicaSet (nginx-deploy-5b4f7d8a9e)  ← 이전 버전 (revision 2, replicas=0)
│     └── (Pod 없음 - 스케일 다운됨)
│
└── ReplicaSet (nginx-deploy-3c2e1f0b7a)  ← 더 이전 버전 (revision 1, replicas=0)
      └── (Pod 없음 - 스케일 다운됨)
```

**핵심:**
- Deployment는 직접 Pod를 관리하지 않는다. ReplicaSet을 통해 간접 관리한다
- 이미지 등을 업데이트하면 새 ReplicaSet이 생성되고, 이전 ReplicaSet은 replicas=0으로 유지된다
- 이전 ReplicaSet을 보관하는 이유는 **롤백**을 위해서이다
- `spec.revisionHistoryLimit`으로 보관할 ReplicaSet 수를 제한한다 (기본값: 10)

**ReplicaSet 이름 생성 규칙:**
```
ReplicaSet 이름 = Deployment 이름 + "-" + Pod Template Hash
                  nginx-deploy    +  -  + 7f6d8b9c5d

Pod Template Hash는 Pod Template(spec.template)의 내용을 해싱한 값이다.
따라서 Pod Template이 변경되면 새로운 Hash → 새로운 ReplicaSet이 생성된다.
```

**어떤 변경이 새 ReplicaSet을 트리거하는가?**
- spec.template 내부 변경 → 새 ReplicaSet 생성 (이미지, 환경변수, 명령어 등)
- spec.replicas 변경 → 새 ReplicaSet 생성 안 함 (기존 ReplicaSet의 replicas만 변경)
- metadata.labels 변경 → 새 ReplicaSet 생성 안 함

### 1.3 Deployment YAML 상세 분석

```yaml
apiVersion: apps/v1                    # API 그룹: apps, 버전: v1
                                       # Deployment는 core가 아닌 apps 그룹에 속함
                                       # kubectl api-resources | grep Deployment 로 확인 가능
kind: Deployment                       # 리소스 종류
metadata:
  name: nginx-deploy                   # Deployment 이름 (필수)
                                       # 이름은 DNS 호환 형식이어야 함 (소문자, 하이픈 허용)
  namespace: demo                      # 네임스페이스 (생략하면 default)
  labels:                              # Deployment 자체의 라벨 (선택)
    app: nginx-deploy                  # Deployment를 식별하기 위한 라벨
    version: v1                        # 버전 정보 라벨
  annotations:                         # 추가 메타데이터 (선택)
    description: "Nginx web server deployment"
    kubernetes.io/change-cause: "Initial deployment with nginx:1.24"
                                       # change-cause는 rollout history에 표시됨
spec:
  replicas: 3                          # 원하는 Pod 수 (기본값: 1)
                                       # → ReplicaSet이 이 수를 유지함
                                       # 0으로 설정하면 모든 Pod 삭제 (Deployment는 유지)

  revisionHistoryLimit: 10             # 보관할 이전 ReplicaSet 수 (기본값: 10)
                                       # 롤백 가능한 이력 수를 결정
                                       # 0으로 설정하면 롤백 불가!
                                       # 디스크 사용을 줄이려면 3~5 정도로 설정

  progressDeadlineSeconds: 600         # 배포 진행 타임아웃 (기본값: 600초)
                                       # 이 시간 내에 배포가 완료되지 않으면 실패로 간주
                                       # Condition: Progressing=False, Reason=ProgressDeadlineExceeded

  minReadySeconds: 0                   # 새 Pod가 Ready 후 이 시간(초)이 지나야 Available로 간주
                                       # 기본값: 0 (즉시 Available)
                                       # 프로덕션에서는 10~30초로 설정하여 안정성 확보

  selector:                            # Pod를 선택하는 조건 (필수!)
    matchLabels:                       # 이 라벨과 일치하는 Pod를 관리
      app: nginx-deploy               # ※ template.metadata.labels와 반드시 일치해야!
                                       # 일치하지 않으면 생성 시 validation 에러 발생

  strategy:                            # 배포 전략 설정
    type: RollingUpdate                # 전략 유형: RollingUpdate(기본) 또는 Recreate
    rollingUpdate:                     # RollingUpdate일 때만 사용
      maxSurge: 25%                    # replicas 대비 초과 생성 가능한 최대 Pod 수
                                       # 25% of 4 = 1 → 최대 5개까지 동시 존재
                                       # 정수(예: 2) 또는 퍼센트(예: 25%) 사용 가능
      maxUnavailable: 25%             # 업데이트 중 사용 불가한 최대 Pod 수
                                       # 25% of 4 = 1 → 최소 3개는 항상 사용 가능
                                       # 정수(예: 1) 또는 퍼센트(예: 25%) 사용 가능

  template:                            # Pod 템플릿 (Pod의 청사진)
    metadata:
      labels:                          # Pod에 적용할 라벨
        app: nginx-deploy              # ※ selector.matchLabels와 반드시 일치!
        version: v1                    # 추가 라벨 (선택)
      annotations:                     # Pod 어노테이션 (선택)
        prometheus.io/scrape: "true"   # 예: Prometheus 스크래핑 설정
    spec:                              # Pod 사양
      containers:
      - name: nginx                    # 컨테이너 이름
        image: nginx:1.24              # 컨테이너 이미지
        imagePullPolicy: IfNotPresent  # 이미지 풀 정책
                                       # Always: 항상 풀 (latest 태그 시 기본)
                                       # IfNotPresent: 없을 때만 풀 (태그 지정 시 기본)
                                       # Never: 로컬만 사용
        ports:
        - containerPort: 80            # 컨테이너 포트
          name: http                   # 포트 이름 (Service에서 참조 가능)
          protocol: TCP                # 프로토콜 (기본: TCP)
        resources:                     # 리소스 제한 (프로덕션에서 필수)
          requests:
            cpu: "50m"                 # 최소 CPU (1000m = 1 core)
            memory: "64Mi"             # 최소 메모리 (Mi = 메비바이트)
          limits:
            cpu: "200m"               # 최대 CPU (초과 시 쓰로틀링)
            memory: "128Mi"            # 최대 메모리 (초과 시 OOMKilled)
        readinessProbe:                # 준비 상태 검사 (트래픽 수신 가능 여부)
          httpGet:
            path: /
            port: 80
          initialDelaySeconds: 5       # 컨테이너 시작 후 첫 검사까지 대기
          periodSeconds: 5             # 검사 주기
          successThreshold: 1          # 성공으로 판단하기 위한 연속 성공 횟수
          failureThreshold: 3          # 실패로 판단하기 위한 연속 실패 횟수
        livenessProbe:                 # 생존 상태 검사 (컨테이너 재시작 여부)
          httpGet:
            path: /
            port: 80
          initialDelaySeconds: 15      # readinessProbe보다 길게 설정
          periodSeconds: 10
          failureThreshold: 3          # 3번 실패 시 컨테이너 재시작
      terminationGracePeriodSeconds: 30  # Pod 종료 시 유예 시간 (기본: 30초)
                                       # SIGTERM 전송 후 이 시간이 지나면 SIGKILL
```

### 1.4 Deployment 전략 상세

#### RollingUpdate (기본값) - 롤링 업데이트

Pod를 점진적으로 교체한다. **무중단 배포**가 가능하다.

```
업데이트 전:  [v1] [v1] [v1] [v1]     (4개 Pod, 모두 v1)
                     │
                     ▼ maxSurge=1, maxUnavailable=1
                     │
Step 1:       [v1] [v1] [v1] [v2]     (+1 v2 생성, 최대 5개)
Step 2:       [v1] [v1] [v2] [v2]     (-1 v1 삭제, +1 v2 생성)
Step 3:       [v1] [v2] [v2] [v2]     (-1 v1 삭제, +1 v2 생성)
Step 4:       [v2] [v2] [v2] [v2]     (완료, 모두 v2)
```

**maxSurge와 maxUnavailable 계산:**

| 설정 | replicas=4 | 의미 |
|---|---|---|
| maxSurge=25% | ceil(4*0.25)=1 | 최대 5개 Pod 동시 존재 |
| maxSurge=1 | 1 | 최대 5개 Pod 동시 존재 |
| maxSurge=50% | ceil(4*0.5)=2 | 최대 6개 Pod 동시 존재 |
| maxUnavailable=25% | floor(4*0.25)=1 | 최소 3개 Pod 사용 가능 |
| maxUnavailable=0 | 0 | 항상 4개 Pod 사용 가능 |
| maxUnavailable=1 | 1 | 최소 3개 Pod 사용 가능 |

**규칙:** maxSurge와 maxUnavailable을 **둘 다 0으로 설정할 수 없다** (업데이트가 진행되지 않으므로)

**퍼센트 계산 규칙 (시험 빈출!):**
```
maxSurge: ceil() 올림     → 25% of 4 = 1.0 → ceil(1.0) = 1
maxUnavailable: floor() 내림  → 25% of 4 = 1.0 → floor(1.0) = 1

예) replicas=10, maxSurge=30%, maxUnavailable=30%
maxSurge = ceil(10*0.3) = ceil(3.0) = 3 → 최대 13개 동시 존재
maxUnavailable = floor(10*0.3) = floor(3.0) = 3 → 최소 7개 사용 가능

예) replicas=3, maxSurge=25%, maxUnavailable=25%
maxSurge = ceil(3*0.25) = ceil(0.75) = 1 → 최대 4개 동시 존재
maxUnavailable = floor(3*0.25) = floor(0.75) = 0 → 최소 3개 사용 가능
```

**다양한 전략 조합:**
```
빠른 배포 (리소스 충분):    maxSurge=50%, maxUnavailable=0
  → 추가 Pod를 많이 만들어 빠르게, 기존 Pod는 즉시 삭제하지 않음

안전한 배포 (무중단 필수): maxSurge=1, maxUnavailable=0
  → 항상 replicas만큼 사용 가능, 하나씩 추가 후 교체

공격적 배포 (속도 최우선): maxSurge=100%, maxUnavailable=50%
  → 모든 새 Pod를 한꺼번에 생성, 절반은 바로 삭제

보수적 배포 (최소 영향):   maxSurge=0, maxUnavailable=1
  → 추가 Pod 없이, 하나씩 삭제 후 교체 (리소스 절약)
```

#### Recreate - 재생성

모든 기존 Pod를 **먼저 삭제**한 후 새 Pod를 생성한다. **다운타임이 발생**한다.

```
업데이트 전:  [v1] [v1] [v1] [v1]     (4개 Pod, 모두 v1)
                     │
                     ▼ Recreate 전략
                     │
Step 1:       [--] [--] [--] [--]     (모든 v1 삭제 → 다운타임!)
Step 2:       [v2] [v2] [v2] [v2]     (모든 v2 생성)
```

**사용 사례:**
- 같은 볼륨을 공유하는 Pod가 동시에 실행되면 안 되는 경우
- 데이터베이스 마이그레이션 등 이전 버전과 새 버전이 동시에 실행되면 문제가 되는 경우
- 리소스가 부족하여 추가 Pod를 생성할 수 없는 경우

```yaml
# Recreate 전략 Deployment
spec:
  strategy:
    type: Recreate                     # RollingUpdate 설정 없음!
                                       # rollingUpdate 섹션을 포함하면 에러 발생
```

### 1.5 Deployment 동작 원리 흐름도 (동작 원리)

```
kubectl set image deployment/nginx nginx=nginx:1.25
    │
    ▼
[1] kubectl이 API 요청 전송
    │   PUT /apis/apps/v1/namespaces/default/deployments/nginx
    │   Body: { spec.template.spec.containers[0].image: "nginx:1.25" }
    ▼
[2] kube-apiserver가 요청 처리
    │   - Authentication(인증): 사용자 확인
    │   - Authorization(인가): RBAC 권한 확인
    │   - Admission Control: MutatingWebhook, ValidatingWebhook 실행
    │   - etcd에 Deployment 스펙 저장
    ▼
[3] Deployment Controller가 변경 감지 (Watch를 통해)
    │   - Pod Template이 변경됨을 확인 (Hash 비교)
    │   - 새 ReplicaSet 생성 (nginx:1.25 이미지, replicas=0에서 시작)
    │   - 이전 ReplicaSet의 replicas를 점진적으로 감소
    │   - maxSurge와 maxUnavailable에 따라 속도 조절
    ▼
[4] ReplicaSet Controller가 새 ReplicaSet 감지
    │   - 새 ReplicaSet의 desired replicas > actual replicas
    │   - maxSurge만큼 새 Pod 생성 요청 (API Server로)
    ▼
[5] Scheduler가 새 Pod를 노드에 배정
    │   - nodeSelector, affinity, taint/toleration 고려
    │   - 리소스 가용성 확인
    │   - Pod의 spec.nodeName 필드 설정
    ▼
[6] kubelet이 새 Pod의 컨테이너 시작
    │   - 이미지 풀 (imagePullPolicy에 따라)
    │   - 컨테이너 런타임(containerd)을 통해 컨테이너 생성
    │   - Volume 마운트, 네트워크 설정
    ▼
[7] ReadinessProbe 통과
    │   - 새 Pod가 Ready 상태가 됨
    │   - minReadySeconds 대기 (설정된 경우)
    │   - Service의 Endpoints에 추가 → 트래픽 수신 시작
    ▼
[8] 이전 Pod 삭제
    │   - maxUnavailable에 따라 이전 Pod 삭제
    │   - terminationGracePeriodSeconds 동안 유예
    │   - SIGTERM → 유예 시간 → SIGKILL
    ▼
[9] [4]~[8] 반복하여 모든 Pod 교체 완료
    │
    ▼
[10] Deployment Controller가 Condition 업데이트
     - Progressing=True, Reason=NewReplicaSetAvailable
     - Available=True
```

**롤백 시 동작 원리:**
```
kubectl rollout undo deployment/nginx
    │
    ▼
[1] Deployment Controller가 이전 ReplicaSet 확인
    │   - revision 번호로 이전 ReplicaSet 식별
    │   - 이전 ReplicaSet의 Pod Template을 현재 Deployment의 template에 복사
    ▼
[2] 사실상 새로운 업데이트와 동일한 과정 수행
    │   - 이전 ReplicaSet의 replicas를 증가
    │   - 현재 ReplicaSet의 replicas를 감소
    │   - 새 revision 번호 부여 (이전 revision이 아닌 새 번호!)
    ▼
[3] 결과: 이전 버전의 Pod가 실행됨
```

---

## 2. Rollout 관리 명령어

### 2.1 핵심 명령어

```bash
# === 배포 상태 확인 ===
kubectl rollout status deployment/<name>
# 배포가 완료될 때까지 대기하며 상태 출력
# 출력 예: deployment "nginx" successfully rolled out
# 실패 시: error: deployment "nginx" exceeded its progress deadline

# === 배포 이력 확인 ===
kubectl rollout history deployment/<name>
# REVISION  CHANGE-CAUSE
# 1         <none>
# 2         kubectl set image deployment/nginx nginx=nginx:1.25

# === 특정 리비전 상세 확인 ===
kubectl rollout history deployment/<name> --revision=2
# Pod Template의 이미지, 라벨 등 상세 정보 표시

# === 이전 버전으로 롤백 ===
kubectl rollout undo deployment/<name>
# 바로 이전 리비전으로 롤백

# === 특정 리비전으로 롤백 ===
kubectl rollout undo deployment/<name> --to-revision=1
# 리비전 1로 롤백

# === 배포 일시정지 ===
kubectl rollout pause deployment/<name>
# 롤링 업데이트를 일시정지 (여러 변경을 한 번에 적용할 때 유용)

# === 배포 재개 ===
kubectl rollout resume deployment/<name>
# 일시정지된 롤링 업데이트를 재개

# === 재시작 (새 rollout 트리거) ===
kubectl rollout restart deployment/<name>
# 이미지 변경 없이 모든 Pod를 순차적으로 재시작
# Pod Template에 annotation이 추가되어 새 ReplicaSet이 생성됨
```

### 2.2 이미지 업데이트 방법 4가지

```bash
# 방법 1: kubectl set image (가장 빠름, 시험에서 권장)
kubectl set image deployment/nginx-deploy nginx=nginx:1.25
# 장점: 한 줄로 끝남, 빠름
# 단점: 복잡한 변경에는 부적합

# 방법 2: kubectl edit (YAML 편집기에서 수정)
kubectl edit deployment nginx-deploy
# 장점: 전체 YAML을 보면서 수정 가능
# 단점: 시험에서 시간 소모 큼, 오타 위험

# 방법 3: kubectl patch (JSON Patch)
kubectl patch deployment nginx-deploy -p \
  '{"spec":{"template":{"spec":{"containers":[{"name":"nginx","image":"nginx:1.25"}]}}}}'
# 장점: 스크립트에서 사용하기 좋음
# 단점: JSON 구문이 복잡

# 방법 4: kubectl apply (YAML 파일 수정 후 적용)
kubectl apply -f deployment.yaml
# 장점: 선언적 관리, GitOps에 적합
# 단점: 파일 수정이 필요
```

### 2.3 change-cause 기록하기

```bash
# 방법 1: --record 플래그 (deprecated, 하지만 시험에서 아직 사용 가능)
kubectl set image deployment/nginx nginx=nginx:1.25 --record

# 방법 2: annotation 직접 설정 (권장)
kubectl annotate deployment/nginx \
  kubernetes.io/change-cause="Update nginx to 1.25 for security fix"

# 이력 확인 시 CHANGE-CAUSE 컬럼에 표시됨
kubectl rollout history deployment/nginx
# REVISION  CHANGE-CAUSE
# 1         Initial deployment with nginx:1.24
# 2         Update nginx to 1.25 for security fix
```

### 2.4 Deployment 빠른 생성 (시험용)

```bash
# 기본 Deployment 생성
kubectl create deployment nginx-deploy --image=nginx:1.24 --replicas=3

# YAML 템플릿 생성 (파일로 저장 후 수정)
kubectl create deployment nginx-deploy \
  --image=nginx:1.24 \
  --replicas=3 \
  --dry-run=client -o yaml > deploy.yaml

# 포트 포함 Deployment 생성 (1.24+)
kubectl create deployment nginx-deploy \
  --image=nginx:1.24 \
  --replicas=3 \
  --port=80

# 스케일링
kubectl scale deployment nginx-deploy --replicas=5

# 자동 스케일링 (HPA)
kubectl autoscale deployment nginx-deploy --min=2 --max=10 --cpu-percent=80

# 현재 이미지 빠르게 확인
kubectl get deployment nginx-deploy -o jsonpath='{.spec.template.spec.containers[0].image}'

# ReplicaSet 확인
kubectl get rs -l app=nginx-deploy

# Deployment의 Condition 확인
kubectl get deployment nginx-deploy -o jsonpath='{.status.conditions[*].type}'
```

### 2.5 Deployment Conditions 이해

```
Deployment Status에는 3가지 Condition이 있다:

1. Available = True
   → minReadySeconds 조건을 만족하는 Pod가 충분히 존재
   → 사용자 트래픽을 처리할 수 있는 상태

2. Progressing = True
   → 배포가 진행 중이거나, 성공적으로 완료됨
   → Reason: NewReplicaSetCreated, FoundNewReplicaSet, ReplicaSetUpdated,
              NewReplicaSetAvailable
   → Reason: ProgressDeadlineExceeded (실패)

3. ReplicaFailure = True
   → ReplicaSet이 Pod를 생성하지 못함
   → 리소스 부족, 이미지 풀 실패 등
```

```bash
# Condition 확인 명령어
kubectl get deployment nginx-deploy -o jsonpath='{range .status.conditions[*]}{.type}: {.status} ({.reason}){"\n"}{end}'
```

---

## 3. 시험 출제 패턴 분석 (시험 출제 패턴)

### 3.1 출제 유형

1. **Deployment 생성** -- 이미지, 레플리카, 포트를 지정하여 Deployment 생성
2. **Rolling Update** -- 이미지를 변경하고 롤링 업데이트 상태 확인
3. **롤백** -- 이전 버전이나 특정 리비전으로 롤백
4. **스케일링** -- 레플리카 수 변경
5. **전략 설정** -- maxSurge, maxUnavailable을 지정하여 전략 설정
6. **Recreate 전략** -- Recreate 전략의 Deployment 생성
7. **Probe 포함 Deployment** -- readinessProbe, livenessProbe가 포함된 Deployment
8. **리소스 제한 Deployment** -- requests/limits가 포함된 Deployment
9. **Deployment와 Service 연결** -- Deployment를 Service로 노출

### 3.2 문제의 의도

- Deployment YAML의 필수 필드(selector, template)를 정확히 아는가?
- kubectl 명령으로 빠르게 Deployment를 조작할 수 있는가?
- maxSurge와 maxUnavailable의 의미를 이해하는가?
- rollout 명령어를 능숙하게 사용하는가?
- selector.matchLabels와 template.metadata.labels가 일치해야 함을 아는가?
- Recreate 전략에서 rollingUpdate 섹션이 없어야 함을 아는가?

### 3.3 시험에서 자주 하는 실수

```
1. selector.matchLabels와 template.metadata.labels 불일치
   → 에러: "selector does not match template labels"

2. Recreate 전략에 rollingUpdate 필드 포함
   → 에러: "rollingUpdate should not be set when strategy type is Recreate"

3. replicas를 문자열로 입력 ("3" 대신 3)
   → YAML에서 따옴표 없이 숫자로 입력해야 함

4. --record 플래그 잊어버림
   → CHANGE-CAUSE가 <none>으로 표시됨

5. rollout undo 후 revision 번호 혼동
   → undo하면 새 revision이 생성됨 (기존 번호로 돌아가지 않음)
```

---

## 4. 실전 시험 문제 (20문제)

### 문제 1. Deployment 생성 [4%]

**컨텍스트:** `kubectl config use-context dev`

네임스페이스 `demo`에 다음 조건으로 Deployment를 생성하라:
- 이름: `web-app`
- 이미지: `nginx:1.24`
- 레플리카: 3
- 컨테이너 포트: 80

<details>
<summary>풀이 과정</summary>

```bash
kubectl config use-context dev

# 방법 1: 빠른 생성 (포트 포함은 YAML 필요)
kubectl create deployment web-app \
  --image=nginx:1.24 \
  --replicas=3 \
  -n demo \
  --dry-run=client -o yaml > /tmp/web-app.yaml

# /tmp/web-app.yaml에 ports 추가 후 apply
# 또는 직접 YAML 작성:

cat <<EOF | kubectl apply -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web-app
  namespace: demo
spec:
  replicas: 3
  selector:
    matchLabels:
      app: web-app
  template:
    metadata:
      labels:
        app: web-app
    spec:
      containers:
      - name: nginx
        image: nginx:1.24
        ports:
        - containerPort: 80
EOF

# 확인
kubectl get deployment web-app -n demo
kubectl get pods -n demo -l app=web-app

# 정리
kubectl delete deployment web-app -n demo
```

</details>

---

### 문제 2. Rolling Update 수행 [4%]

**컨텍스트:** `kubectl config use-context dev`

`demo` 네임스페이스의 `nginx-web` Deployment를 다음과 같이 업데이트하라:
- 이미지를 `nginx:1.25`로 변경
- 배포가 완료될 때까지 확인
- 이력 확인

<details>
<summary>풀이 과정</summary>

```bash
kubectl config use-context dev

# 이미지 업데이트
kubectl set image deployment/nginx-web nginx=nginx:1.25 -n demo

# 배포 상태 확인
kubectl rollout status deployment/nginx-web -n demo

# 이력 확인
kubectl rollout history deployment/nginx-web -n demo

# 현재 이미지 확인
kubectl get deployment nginx-web -n demo \
  -o jsonpath='{.spec.template.spec.containers[0].image}'

# 원래 이미지로 복원
kubectl rollout undo deployment/nginx-web -n demo
```

</details>

---

### 문제 3. 특정 리비전으로 롤백 [4%]

**컨텍스트:** `kubectl config use-context dev`

`demo` 네임스페이스의 `nginx-web` Deployment를 리비전 1로 롤백하라.

<details>
<summary>풀이 과정</summary>

```bash
kubectl config use-context dev

# 이력 확인
kubectl rollout history deployment/nginx-web -n demo

# 리비전 1 상세
kubectl rollout history deployment/nginx-web -n demo --revision=1

# 롤백
kubectl rollout undo deployment/nginx-web -n demo --to-revision=1

# 완료 확인
kubectl rollout status deployment/nginx-web -n demo

# 이미지 확인
kubectl get deployment nginx-web -n demo \
  -o jsonpath='{.spec.template.spec.containers[0].image}'
echo ""
```

</details>

---

### 문제 4. 스케일링 [4%]

**컨텍스트:** `kubectl config use-context prod`

1. `scale-test` Deployment를 이미지 `nginx:1.24`, 레플리카 2로 생성하라
2. 레플리카를 5로 스케일 업하라
3. 레플리카를 1로 스케일 다운하라

<details>
<summary>풀이 과정</summary>

```bash
kubectl config use-context prod

# 1. 생성
kubectl create deployment scale-test --image=nginx:1.24 --replicas=2

# 확인
kubectl get deployment scale-test
kubectl get pods -l app=scale-test

# 2. 스케일 업
kubectl scale deployment scale-test --replicas=5
kubectl get pods -l app=scale-test

# 3. 스케일 다운
kubectl scale deployment scale-test --replicas=1
kubectl get pods -l app=scale-test

# 정리
kubectl delete deployment scale-test
```

</details>

---

### 문제 5. 전략 설정 [7%]

**컨텍스트:** `kubectl config use-context dev`

네임스페이스 `demo`에 다음 조건으로 Deployment를 생성하라:
- 이름: `strategy-test`
- 이미지: `httpd:2.4`
- 레플리카: 4
- 전략: RollingUpdate (maxSurge=2, maxUnavailable=1)

<details>
<summary>풀이 과정</summary>

```bash
kubectl config use-context dev

cat <<EOF | kubectl apply -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: strategy-test
  namespace: demo
spec:
  replicas: 4
  selector:
    matchLabels:
      app: strategy-test
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 2
      maxUnavailable: 1
  template:
    metadata:
      labels:
        app: strategy-test
    spec:
      containers:
      - name: httpd
        image: httpd:2.4
        ports:
        - containerPort: 80
EOF

# 확인
kubectl get deployment strategy-test -n demo
kubectl describe deployment strategy-test -n demo | grep -A5 Strategy

# 이미지 업데이트로 전략 동작 확인
kubectl set image deployment/strategy-test httpd=httpd:2.4.58 -n demo
kubectl rollout status deployment/strategy-test -n demo

# 정리
kubectl delete deployment strategy-test -n demo
```

</details>

---

### 문제 6. Recreate 전략 [4%]

**컨텍스트:** `kubectl config use-context dev`

Recreate 전략을 사용하는 Deployment `recreate-app`을 생성하라:
- 이미지: `nginx:1.24`
- 레플리카: 3
- 네임스페이스: `demo`

<details>
<summary>풀이 과정</summary>

```bash
cat <<EOF | kubectl apply -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: recreate-app
  namespace: demo
spec:
  replicas: 3
  selector:
    matchLabels:
      app: recreate-app
  strategy:
    type: Recreate
  template:
    metadata:
      labels:
        app: recreate-app
    spec:
      containers:
      - name: nginx
        image: nginx:1.24
EOF

# 확인
kubectl describe deployment recreate-app -n demo | grep Strategy

kubectl delete deployment recreate-app -n demo
```

</details>

---

### 문제 7. Deployment에 리소스 제한 추가 [7%]

**컨텍스트:** `kubectl config use-context dev`

다음 Deployment를 생성하라:
- 이름: `resource-app`
- 이미지: `nginx:1.24`
- 레플리카: 2
- CPU: requests=100m, limits=500m
- Memory: requests=128Mi, limits=256Mi

<details>
<summary>풀이 과정</summary>

```bash
cat <<EOF | kubectl apply -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: resource-app
  namespace: demo
spec:
  replicas: 2
  selector:
    matchLabels:
      app: resource-app
  template:
    metadata:
      labels:
        app: resource-app
    spec:
      containers:
      - name: nginx
        image: nginx:1.24
        ports:
        - containerPort: 80
        resources:
          requests:
            cpu: "100m"
            memory: "128Mi"
          limits:
            cpu: "500m"
            memory: "256Mi"
EOF

kubectl get deployment resource-app -n demo
kubectl get pods -n demo -l app=resource-app -o jsonpath='{.items[0].spec.containers[0].resources}'

kubectl delete deployment resource-app -n demo
```

</details>

---

### 문제 8. Deployment에 환경변수 추가 [4%]

**컨텍스트:** `kubectl config use-context dev`

다음 Deployment를 생성하라:
- 이름: `env-app`
- 이미지: `busybox:1.36`
- 명령어: `sh -c "echo $APP_ENV && sleep 3600"`
- 환경변수: APP_ENV=production, LOG_LEVEL=info

<details>
<summary>풀이 과정</summary>

```bash
cat <<EOF | kubectl apply -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: env-app
  namespace: demo
spec:
  replicas: 1
  selector:
    matchLabels:
      app: env-app
  template:
    metadata:
      labels:
        app: env-app
    spec:
      containers:
      - name: app
        image: busybox:1.36
        command: ["sh", "-c", "echo \$APP_ENV \$LOG_LEVEL && sleep 3600"]
        env:
        - name: APP_ENV
          value: "production"
        - name: LOG_LEVEL
          value: "info"
EOF

kubectl logs -n demo -l app=env-app

kubectl delete deployment env-app -n demo
```

</details>

---

## tart-infra 실습

### 실습 환경 설정

```bash
# dev 클러스터 접속 (demo 네임스페이스에 nginx 등 앱이 배포됨)
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/dev.yaml
kubectl config use-context dev
```

### 실습 1: 기존 Deployment의 Rolling Update 구조 분석

```bash
# demo 네임스페이스의 Deployment 목록 확인
kubectl get deployments -n demo

# nginx Deployment의 strategy 확인
kubectl get deployment nginx -n demo -o jsonpath='{.spec.strategy}' | python3 -m json.tool

# ReplicaSet 이력 확인 (롤링 업데이트 시 생성된 RS)
kubectl get rs -n demo -l app=nginx --sort-by=.metadata.creationTimestamp
```

**예상 출력:**
```json
{
    "rollingUpdate": {
        "maxSurge": "25%",
        "maxUnavailable": "25%"
    },
    "type": "RollingUpdate"
}
```

**동작 원리:**
1. `maxSurge: 25%`는 업데이트 중 desired replicas 대비 25%의 추가 Pod를 허용한다
2. `maxUnavailable: 25%`는 업데이트 중 25%의 Pod가 unavailable해도 허용한다
3. ReplicaSet 목록에서 이전 RS(replicas=0)와 현재 RS를 확인할 수 있다
4. `revisionHistoryLimit`만큼 이전 RS가 보관되어 롤백에 사용된다

### 실습 2: Rolling Update 및 Rollback 실습

```bash
# nginx 이미지 업데이트 (롤링 업데이트 발동)
kubectl set image deployment/nginx nginx=nginx:1.25 -n demo --record 2>/dev/null || \
kubectl set image deployment/nginx nginx=nginx:1.25 -n demo

# 롤아웃 상태 실시간 확인
kubectl rollout status deployment/nginx -n demo

# 롤아웃 이력 확인
kubectl rollout history deployment/nginx -n demo
```

**예상 출력:**
```
deployment "nginx" successfully rolled out

REVISION  CHANGE-CAUSE
1         <none>
2         <none>
```

```bash
# 이전 버전으로 롤백
kubectl rollout undo deployment/nginx -n demo

# 롤백 확인
kubectl rollout status deployment/nginx -n demo
kubectl get deployment nginx -n demo -o jsonpath='{.spec.template.spec.containers[0].image}'
```

**동작 원리:**
1. `set image`로 Pod Template이 변경되면 Deployment Controller가 새 ReplicaSet을 생성한다
2. 새 RS의 replicas를 점진적으로 증가시키고, 이전 RS를 점진적으로 감소시킨다
3. `rollout undo`는 이전 RS의 Pod Template을 복원하여 롤백을 수행한다
4. 롤백도 새로운 revision을 생성한다 (revision 번호가 증가함)

### 실습 3: httpbin v1/v2 Deployment 비교

```bash
# httpbin v1, v2 Deployment가 공존하는 구조 확인
kubectl get deployments -n demo -l app=httpbin -o wide

# 각 버전의 Pod Template 라벨 비교
kubectl get pods -n demo -l app=httpbin --show-labels
```

**예상 출력:**
```
NAME         READY   UP-TO-DATE   AVAILABLE   AGE   CONTAINERS   IMAGES          SELECTOR
httpbin-v1   1/1     1            1           30d   httpbin      httpbin:v1      app=httpbin,version=v1
httpbin-v2   1/1     1            1           30d   httpbin      httpbin:v2      app=httpbin,version=v2
```

**동작 원리:**
1. 동일 앱의 여러 버전을 별도 Deployment로 배포하면 독립적인 롤링 업데이트가 가능하다
2. `version` 라벨로 v1/v2를 구분하고, Istio VirtualService로 트래픽 분배를 제어한다
3. 이 패턴은 Canary 배포와 A/B 테스트에 활용된다

