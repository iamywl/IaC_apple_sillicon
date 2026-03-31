# CKA Day 8: Deployment 시험 문제 심화 & 고급 패턴

> CKA 도메인: Workloads & Scheduling (15%) - Part 1 실전 | 예상 소요 시간: 2시간

---

### 문제 9. Deployment 일시정지/재개 [7%]

**컨텍스트:** `kubectl config use-context dev`

1. `pause-test` Deployment 생성 (nginx:1.24, replicas=3)
2. 배포를 일시정지하라
3. 이미지를 nginx:1.25로 변경하라
4. 레플리카를 5로 변경하라
5. 배포를 재개하여 모든 변경을 한 번에 적용하라

<details>
<summary>풀이 과정</summary>

```bash
# 1. 생성
kubectl create deployment pause-test --image=nginx:1.24 --replicas=3 -n demo

# 2. 일시정지
kubectl rollout pause deployment/pause-test -n demo

# 3. 이미지 변경 (배포 시작되지 않음)
kubectl set image deployment/pause-test nginx=nginx:1.25 -n demo

# 4. 레플리카 변경
kubectl scale deployment/pause-test --replicas=5 -n demo

# 5. 재개 (모든 변경이 한 번에 적용)
kubectl rollout resume deployment/pause-test -n demo
kubectl rollout status deployment/pause-test -n demo

# 확인
kubectl get deployment pause-test -n demo
```

**검증 - 기대 출력:**
```text
NAME         READY   UP-TO-DATE   AVAILABLE   AGE
pause-test   5/5     5            5           2m
```

이미지가 nginx:1.25로 변경되고 레플리카가 5로 증가한 것을 확인한다. pause 상태에서 이미지를 변경해도 롤아웃이 시작되지 않았다가, resume 시 한 번의 롤아웃으로 모든 변경이 적용된다. 이 방식은 불필요한 중간 롤아웃을 방지한다.

```bash
kubectl delete deployment pause-test -n demo
```

</details>

---

### 문제 10. Deployment와 Service 연결 [7%]

**컨텍스트:** `kubectl config use-context prod`

1. `web-frontend` Deployment (nginx:1.24, replicas=3, port=80) 생성
2. 이 Deployment를 위한 ClusterIP Service `web-frontend-svc` (port=80) 생성
3. Service의 Endpoints가 올바른지 확인

<details>
<summary>풀이 과정</summary>

```bash
kubectl config use-context prod

# 1. Deployment 생성
kubectl create deployment web-frontend --image=nginx:1.24 --replicas=3

# 2. Service 생성
kubectl expose deployment web-frontend --port=80 --target-port=80 --name=web-frontend-svc

# 3. 확인
kubectl get svc web-frontend-svc
kubectl get endpoints web-frontend-svc
kubectl get pods -l app=web-frontend -o wide
```

**검증 - 기대 출력 (Service):**
```text
NAME               TYPE        CLUSTER-IP     EXTERNAL-IP   PORT(S)   AGE
web-frontend-svc   ClusterIP   10.96.15.230   <none>        80/TCP    30s
```

**검증 - 기대 출력 (Endpoints):**
```text
NAME               ENDPOINTS                                      AGE
web-frontend-svc   10.20.1.5:80,10.20.1.6:80,10.20.1.7:80        30s
```

Endpoints의 IP가 Pod의 IP와 일치해야 한다. 불일치하면 Service의 selector 라벨이 Pod의 labels와 맞지 않는 것이다.

```bash
# Endpoints의 IP가 Pod의 IP와 일치하는지 확인

# 정리
kubectl delete deployment web-frontend
kubectl delete svc web-frontend-svc
```

</details>

---

### 문제 11. revisionHistoryLimit 설정 [4%]

**컨텍스트:** `kubectl config use-context dev`

`history-test` Deployment를 생성하되, 이전 ReplicaSet을 최대 3개만 보관하도록 설정하라.

<details>
<summary>풀이 과정</summary>

```bash
cat <<EOF | kubectl apply -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: history-test
  namespace: demo
spec:
  replicas: 2
  revisionHistoryLimit: 3
  selector:
    matchLabels:
      app: history-test
  template:
    metadata:
      labels:
        app: history-test
    spec:
      containers:
      - name: nginx
        image: nginx:1.24
EOF

kubectl describe deployment history-test -n demo | grep -i revision

kubectl delete deployment history-test -n demo
```

</details>

---

### 문제 12. Probe가 포함된 Deployment [7%]

**컨텍스트:** `kubectl config use-context dev`

다음 Deployment를 생성하라:
- 이름: `probe-deploy`
- 이미지: `nginx:1.24`
- 레플리카: 2
- Readiness Probe: HTTP GET / 포트 80, 초기 대기 5초, 주기 5초
- Liveness Probe: HTTP GET / 포트 80, 초기 대기 15초, 주기 10초

<details>
<summary>풀이 과정</summary>

```bash
cat <<EOF | kubectl apply -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: probe-deploy
  namespace: demo
spec:
  replicas: 2
  selector:
    matchLabels:
      app: probe-deploy
  template:
    metadata:
      labels:
        app: probe-deploy
    spec:
      containers:
      - name: nginx
        image: nginx:1.24
        ports:
        - containerPort: 80
        readinessProbe:
          httpGet:
            path: /
            port: 80
          initialDelaySeconds: 5
          periodSeconds: 5
        livenessProbe:
          httpGet:
            path: /
            port: 80
          initialDelaySeconds: 15
          periodSeconds: 10
EOF

kubectl get deployment probe-deploy -n demo
kubectl describe deployment probe-deploy -n demo | grep -A5 "Liveness\|Readiness"

kubectl delete deployment probe-deploy -n demo
```

</details>

---

### 문제 13. minReadySeconds 설정 [4%]

**컨텍스트:** `kubectl config use-context dev`

다음 Deployment를 생성하라:
- 이름: `stable-deploy`
- 이미지: `nginx:1.24`
- 레플리카: 3
- minReadySeconds: 30 (Pod가 Ready 후 30초 대기)
- progressDeadlineSeconds: 600

<details>
<summary>풀이 과정</summary>

```bash
cat <<EOF | kubectl apply -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: stable-deploy
  namespace: demo
spec:
  replicas: 3
  minReadySeconds: 30
  progressDeadlineSeconds: 600
  selector:
    matchLabels:
      app: stable-deploy
  template:
    metadata:
      labels:
        app: stable-deploy
    spec:
      containers:
      - name: nginx
        image: nginx:1.24
        ports:
        - containerPort: 80
EOF

# minReadySeconds 확인
kubectl get deployment stable-deploy -n demo -o jsonpath='{.spec.minReadySeconds}'
echo ""

# 이미지 업데이트하여 동작 확인 (30초마다 Pod가 교체됨)
kubectl set image deployment/stable-deploy nginx=nginx:1.25 -n demo
kubectl rollout status deployment/stable-deploy -n demo

kubectl delete deployment stable-deploy -n demo
```

</details>

---

### 문제 14. 다중 컨테이너 Deployment [7%]

**컨텍스트:** `kubectl config use-context dev`

다음 Deployment를 생성하라:
- 이름: `multi-container-deploy`
- 레플리카: 2
- 컨테이너 1: `nginx` (nginx:1.24, port=80)
- 컨테이너 2: `sidecar` (busybox:1.36, command: `sh -c "while true; do echo heartbeat; sleep 10; done"`)
- emptyDir 볼륨 `shared-data`를 nginx는 `/usr/share/nginx/html`, sidecar는 `/data`에 마운트

<details>
<summary>풀이 과정</summary>

```bash
cat <<EOF | kubectl apply -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: multi-container-deploy
  namespace: demo
spec:
  replicas: 2
  selector:
    matchLabels:
      app: multi-container-deploy
  template:
    metadata:
      labels:
        app: multi-container-deploy
    spec:
      containers:
      - name: nginx
        image: nginx:1.24
        ports:
        - containerPort: 80
        volumeMounts:
        - name: shared-data
          mountPath: /usr/share/nginx/html
      - name: sidecar
        image: busybox:1.36
        command: ["sh", "-c", "while true; do echo heartbeat; sleep 10; done"]
        volumeMounts:
        - name: shared-data
          mountPath: /data
      volumes:
      - name: shared-data
        emptyDir: {}
EOF

# 확인
kubectl get deployment multi-container-deploy -n demo
kubectl get pods -n demo -l app=multi-container-deploy

# sidecar 로그 확인
POD=$(kubectl get pods -n demo -l app=multi-container-deploy -o jsonpath='{.items[0].metadata.name}')
kubectl logs $POD -c sidecar -n demo

kubectl delete deployment multi-container-deploy -n demo
```

</details>

---

### 문제 15. Deployment의 이미지 변경 이력 추적 [4%]

**컨텍스트:** `kubectl config use-context dev`

1. `track-deploy` Deployment 생성 (nginx:1.22, replicas=2)
2. 이미지를 nginx:1.23으로 업데이트 (change-cause 기록)
3. 이미지를 nginx:1.24로 업데이트 (change-cause 기록)
4. 이미지를 nginx:1.25로 업데이트 (change-cause 기록)
5. rollout history 확인
6. revision 2의 이미지를 확인하라

<details>
<summary>풀이 과정</summary>

```bash
kubectl config use-context dev

# 1. 생성
kubectl create deployment track-deploy --image=nginx:1.22 --replicas=2 -n demo
kubectl annotate deployment track-deploy -n demo \
  kubernetes.io/change-cause="Initial: nginx:1.22"

# 2. 업데이트 1
kubectl set image deployment/track-deploy nginx=nginx:1.23 -n demo
kubectl annotate deployment track-deploy -n demo \
  kubernetes.io/change-cause="Update: nginx:1.23"

# 3. 업데이트 2
kubectl set image deployment/track-deploy nginx=nginx:1.24 -n demo
kubectl annotate deployment track-deploy -n demo \
  kubernetes.io/change-cause="Update: nginx:1.24"

# 4. 업데이트 3
kubectl set image deployment/track-deploy nginx=nginx:1.25 -n demo
kubectl annotate deployment track-deploy -n demo \
  kubernetes.io/change-cause="Update: nginx:1.25"

# 5. 이력 확인
kubectl rollout history deployment/track-deploy -n demo

# 6. revision 2 상세 확인
kubectl rollout history deployment/track-deploy -n demo --revision=2

# 정리
kubectl delete deployment track-deploy -n demo
```

</details>

---

### 문제 16. maxSurge=0 전략 Deployment [7%]

**컨텍스트:** `kubectl config use-context dev`

리소스가 부족한 환경에서 추가 Pod 없이 업데이트하는 Deployment를 생성하라:
- 이름: `low-resource-deploy`
- 이미지: `nginx:1.24`
- 레플리카: 4
- 전략: RollingUpdate (maxSurge=0, maxUnavailable=1)
- 이 전략이 의미하는 바를 설명하라

<details>
<summary>풀이 과정</summary>

```bash
cat <<EOF | kubectl apply -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: low-resource-deploy
  namespace: demo
spec:
  replicas: 4
  selector:
    matchLabels:
      app: low-resource-deploy
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 0            # 추가 Pod 생성 안 함 (리소스 절약)
      maxUnavailable: 1      # 하나씩 삭제 후 교체
  template:
    metadata:
      labels:
        app: low-resource-deploy
    spec:
      containers:
      - name: nginx
        image: nginx:1.24
        ports:
        - containerPort: 80
EOF

# 전략 의미:
# maxSurge=0 → 최대 4개 Pod (추가 없음)
# maxUnavailable=1 → 최소 3개 사용 가능
# 동작: 1개 삭제 → 1개 생성 → Ready 확인 → 1개 삭제 → ... 반복
# 장점: 리소스를 추가로 사용하지 않음
# 단점: 업데이트 속도가 느림, 업데이트 중 3/4만 가용

# 확인
kubectl describe deployment low-resource-deploy -n demo | grep -A5 Strategy

# 업데이트 테스트
kubectl set image deployment/low-resource-deploy nginx=nginx:1.25 -n demo
kubectl rollout status deployment/low-resource-deploy -n demo

kubectl delete deployment low-resource-deploy -n demo
```

</details>

---

### 문제 17. Deployment rollout restart [4%]

**컨텍스트:** `kubectl config use-context dev`

`demo` 네임스페이스의 `nginx-web` Deployment를 이미지 변경 없이 모든 Pod를 재시작하라.

<details>
<summary>풀이 과정</summary>

```bash
kubectl config use-context dev

# 현재 Pod 확인
kubectl get pods -n demo -l app=nginx-web -o wide

# rollout restart
kubectl rollout restart deployment/nginx-web -n demo

# 상태 확인
kubectl rollout status deployment/nginx-web -n demo

# 새로운 Pod가 생성되었는지 확인 (AGE가 짧은 Pod)
kubectl get pods -n demo -l app=nginx-web -o wide

# 동작 원리:
# rollout restart는 Pod Template에 annotation을 추가함
# kubectl.kubernetes.io/restartedAt: "2026-03-19T09:00:00Z"
# 이로 인해 새 ReplicaSet이 생성되고 RollingUpdate 수행
```

</details>

---

### 문제 18. Deployment에 matchExpressions 사용 [4%]

**컨텍스트:** `kubectl config use-context dev`

matchExpressions를 사용하는 Deployment를 생성하라:
- 이름: `expr-deploy`
- selector가 matchExpressions를 사용하여 `app In [expr-deploy]` 조건
- 이미지: `nginx:1.24`
- 레플리카: 2

<details>
<summary>풀이 과정</summary>

```bash
cat <<EOF | kubectl apply -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: expr-deploy
  namespace: demo
spec:
  replicas: 2
  selector:
    matchExpressions:               # matchLabels 대신 matchExpressions 사용
    - key: app                      # 라벨 키
      operator: In                  # 연산자: In, NotIn, Exists, DoesNotExist
      values:                       # 값 목록
      - expr-deploy
  template:
    metadata:
      labels:
        app: expr-deploy            # matchExpressions 조건과 일치해야 함
    spec:
      containers:
      - name: nginx
        image: nginx:1.24
EOF

kubectl get deployment expr-deploy -n demo
kubectl get pods -n demo -l app=expr-deploy

kubectl delete deployment expr-deploy -n demo
```

</details>

---

### 문제 19. Deployment 업데이트 중 문제 진단 [7%]

**컨텍스트:** `kubectl config use-context dev`

1. `diag-deploy` Deployment 생성 (nginx:1.24, replicas=3)
2. 존재하지 않는 이미지 `nginx:nonexistent`로 업데이트
3. 롤아웃 상태를 확인하고 문제를 진단하라
4. 이전 버전으로 롤백하라

<details>
<summary>풀이 과정</summary>

```bash
kubectl config use-context dev

# 1. 생성
kubectl create deployment diag-deploy --image=nginx:1.24 --replicas=3 -n demo
kubectl rollout status deployment/diag-deploy -n demo

# 2. 잘못된 이미지로 업데이트
kubectl set image deployment/diag-deploy nginx=nginx:nonexistent -n demo

# 3. 문제 진단
# 롤아웃 상태 확인 (멈춰 있음)
kubectl rollout status deployment/diag-deploy -n demo --timeout=30s

# Pod 상태 확인 (ImagePullBackOff 또는 ErrImagePull)
kubectl get pods -n demo -l app=diag-deploy

# 이벤트 확인
kubectl describe deployment diag-deploy -n demo

# 새 ReplicaSet의 Pod 상세 확인
kubectl get rs -n demo -l app=diag-deploy
NEW_RS=$(kubectl get rs -n demo -l app=diag-deploy --sort-by=.metadata.creationTimestamp -o jsonpath='{.items[-1].metadata.name}')
kubectl describe rs $NEW_RS -n demo

# 4. 롤백
kubectl rollout undo deployment/diag-deploy -n demo
kubectl rollout status deployment/diag-deploy -n demo

# 이미지 확인
kubectl get deployment diag-deploy -n demo \
  -o jsonpath='{.spec.template.spec.containers[0].image}'
echo ""

kubectl delete deployment diag-deploy -n demo
```

</details>

---

### 문제 20. 복합 Deployment 생성 [7%]

**컨텍스트:** `kubectl config use-context prod`

다음 모든 조건을 만족하는 Deployment를 생성하라:
- 이름: `full-deploy`
- 이미지: `nginx:1.24`
- 레플리카: 3
- 컨테이너 포트: 80 (이름: http)
- 전략: RollingUpdate (maxSurge=1, maxUnavailable=0)
- revisionHistoryLimit: 5
- minReadySeconds: 10
- resources: requests(cpu=100m, memory=128Mi), limits(cpu=500m, memory=256Mi)
- readinessProbe: HTTP GET / 포트 80, 초기 5초, 주기 3초
- 라벨: app=full-deploy, tier=frontend, env=production

<details>
<summary>풀이 과정</summary>

```bash
kubectl config use-context prod

cat <<EOF | kubectl apply -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: full-deploy
  labels:
    app: full-deploy
    tier: frontend
    env: production
spec:
  replicas: 3
  revisionHistoryLimit: 5
  minReadySeconds: 10
  selector:
    matchLabels:
      app: full-deploy
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  template:
    metadata:
      labels:
        app: full-deploy
        tier: frontend
        env: production
    spec:
      containers:
      - name: nginx
        image: nginx:1.24
        ports:
        - containerPort: 80
          name: http
        resources:
          requests:
            cpu: "100m"
            memory: "128Mi"
          limits:
            cpu: "500m"
            memory: "256Mi"
        readinessProbe:
          httpGet:
            path: /
            port: 80
          initialDelaySeconds: 5
          periodSeconds: 3
EOF

# 전체 확인
kubectl get deployment full-deploy -o wide
kubectl describe deployment full-deploy | head -40

# 정리
kubectl delete deployment full-deploy
```

</details>

---

## 5. Deployment 고급 동작 원리 (동작 원리)

### 5.1 Deployment Controller의 Reconciliation Loop

```
Deployment Controller는 kube-controller-manager 내에서 실행되며,
지속적으로 "원하는 상태(desired state)"와 "현재 상태(actual state)"를 비교한다.

┌───────────────────────────────────────────────┐
│         Deployment Controller Loop            │
│                                               │
│  1. Watch: Deployment 리소스 변경 감시         │
│     │                                         │
│  2. Sync: 변경 감지 시 동기화 수행             │
│     │                                         │
│  3. 판단:                                     │
│     ├── Pod Template 변경? → 새 ReplicaSet    │
│     ├── Replicas 변경? → 기존 RS 스케일       │
│     ├── Pause 상태? → 변경 기록만, 적용 안 함  │
│     └── 롤백 요청? → 이전 RS의 template 복원  │
│     │                                         │
│  4. 실행:                                     │
│     ├── 새 RS replicas 증가                   │
│     ├── 이전 RS replicas 감소                 │
│     ├── maxSurge/maxUnavailable 준수          │
│     └── Condition 업데이트                     │
│     │                                         │
│  5. 반복 (무한 루프)                           │
└───────────────────────────────────────────────┘
```

### 5.2 Rolling Update 상세 시퀀스 (replicas=4, maxSurge=1, maxUnavailable=1)

```
시점 0: 업데이트 시작
  Old RS: 4/4 (4개 Running)
  New RS: 0/0
  Total: 4  Available: 4

시점 1: New RS 스케일업 + Old RS 스케일다운
  Old RS: 3/4 (1개 Terminating)
  New RS: 1/1 (1개 Creating)
  Total: 5 (maxSurge=1 허용)  Available: 3 (maxUnavailable=1 허용)

시점 2: New Pod Ready
  Old RS: 3/3
  New RS: 1/1 (Ready)
  Total: 4  Available: 4

시점 3: 다음 교체
  Old RS: 2/3 (1개 Terminating)
  New RS: 2/2 (1개 Creating)
  Total: 5  Available: 3

... 반복 ...

시점 최종: 완료
  Old RS: 0/0
  New RS: 4/4
  Total: 4  Available: 4
```

### 5.3 Pause/Resume 동작 원리

```
일시정지(Pause) 시:
  - Deployment의 spec.paused = true 로 설정
  - 이후 spec.template 변경을 해도 새 ReplicaSet이 생성되지 않음
  - scale 변경은 즉시 적용됨 (pause와 무관)

재개(Resume) 시:
  - spec.paused = false 로 설정
  - 축적된 모든 template 변경이 한 번의 롤아웃으로 적용
  - 하나의 새 ReplicaSet만 생성 (중간 버전 없이)
  - revision도 1개만 증가

활용 시나리오:
  - 이미지 변경 + 리소스 변경 + 환경변수 변경을 한 번에 적용
  - 각 변경마다 rollout이 발생하면 3번의 rollout → pause/resume으로 1번
```

---

## 6. 복습 체크리스트

### 개념 확인

- [ ] RollingUpdate와 Recreate의 차이를 설명할 수 있는가?
- [ ] maxSurge=25%, replicas=4일 때 최대 Pod 수를 계산할 수 있는가?
- [ ] maxSurge=25%, replicas=3일 때 최대 Pod 수를 계산할 수 있는가?
- [ ] Deployment → ReplicaSet → Pod 관계를 이해하는가?
- [ ] rollout undo와 rollout undo --to-revision의 차이를 아는가?
- [ ] selector.matchLabels와 template.metadata.labels가 일치해야 하는 이유를 아는가?
- [ ] revisionHistoryLimit의 기본값과 역할을 아는가?
- [ ] progressDeadlineSeconds의 역할을 아는가?
- [ ] minReadySeconds의 역할을 아는가?
- [ ] rollout restart의 동작 원리를 이해하는가?
- [ ] 어떤 변경이 새 ReplicaSet을 트리거하는지 아는가?
- [ ] Deployment Conditions (Available, Progressing)의 의미를 아는가?

### 시험 팁

1. **빠른 생성** -- `kubectl create deployment <name> --image=<image> --replicas=<n>`
2. **이미지 업데이트** -- `kubectl set image deployment/<name> <container>=<image>`
3. **롤백** -- `kubectl rollout undo deployment/<name>`
4. **전략 추가** -- `--dry-run=client -o yaml`로 기본 YAML 생성 후 strategy 추가
5. **상태 확인** -- `kubectl rollout status`로 배포 완료 대기
6. **이력 확인** -- `kubectl rollout history`로 리비전 목록 확인
7. **change-cause 기록** -- `kubectl annotate deployment/<name> kubernetes.io/change-cause="..."`
8. **재시작** -- `kubectl rollout restart deployment/<name>`
9. **일시정지** -- 여러 변경을 한 번에 적용할 때 `pause` → 변경 → `resume`
10. **YAML 필드 확인** -- `kubectl explain deployment.spec.strategy`로 필드 확인

### 자주 사용하는 kubectl explain 경로

```bash
kubectl explain deployment.spec.strategy
kubectl explain deployment.spec.strategy.rollingUpdate
kubectl explain deployment.spec.revisionHistoryLimit
kubectl explain deployment.spec.minReadySeconds
kubectl explain deployment.spec.progressDeadlineSeconds
kubectl explain deployment.spec.selector
kubectl explain deployment.spec.template.spec.containers.readinessProbe
kubectl explain deployment.spec.template.spec.containers.livenessProbe
kubectl explain deployment.spec.template.spec.containers.resources
```

---

## 내일 예고

**Day 9: 스케줄링 심화** -- Taint/Toleration, NodeAffinity, DaemonSet, Job/CronJob, Resource 관리를 실습한다. tolerations YAML 문법을 미리 확인해오자.


---

## tart-infra 실습

### 실습 환경 설정

```bash
# dev 클러스터에 접속 (demo 앱이 배포된 클러스터)
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/dev.yaml
kubectl get nodes
```

**예상 출력:**
```
NAME          STATUS   ROLES           AGE   VERSION
dev-master    Ready    control-plane   30d   v1.31.0
dev-worker1   Ready    <none>          30d   v1.31.0
```

### 실습 1: 기존 Deployment 분석

```bash
# demo 네임스페이스의 Deployment 확인
kubectl get deployments -n demo
```

**예상 출력:**
```
NAME         READY   UP-TO-DATE   AVAILABLE   AGE
httpbin-v1   1/1     1            1           5d
httpbin-v2   1/1     1            1           5d
nginx-web    1/1     1            1           5d
```

**동작 원리:** `kubectl get deployments`를 실행하면:
1. API Server가 etcd에서 apps/v1 Deployment 오브젝트를 조회한다
2. READY 필드는 `readyReplicas/replicas`를 보여준다
3. UP-TO-DATE는 최신 ReplicaSet의 Pod 수를 나타낸다
4. Deployment -> ReplicaSet -> Pod 3계층 구조로 관리된다

```bash
# nginx-web Deployment의 상세 정보 확인
kubectl describe deployment nginx-web -n demo
```

**예상 출력 (주요 부분):**
```
Name:                   nginx-web
Namespace:              demo
Selector:               app=nginx-web
Replicas:               1 desired | 1 updated | 1 total | 1 available | 0 unavailable
StrategyType:           RollingUpdate
RollingUpdateStrategy:  25% max unavailable, 25% max surge
Pod Template:
  Labels:  app=nginx-web
  Containers:
   nginx:
    Image:   nginx:1.25
    Port:    80/TCP
```

### 실습 2: Rolling Update 실습

```bash
# 현재 이미지 확인
kubectl get deployment nginx-web -n demo -o jsonpath='{.spec.template.spec.containers[0].image}'
echo ""

# 롤아웃 이력 확인
kubectl rollout history deployment/nginx-web -n demo
```

**예상 출력:**
```
nginx:1.25
deployment.apps/nginx-web
REVISION  CHANGE-CAUSE
1         <none>
```

**동작 원리:** Deployment의 Rolling Update 과정:
1. 이미지를 변경하면 Deployment Controller가 새 ReplicaSet을 생성한다
2. 새 ReplicaSet의 Pod를 하나씩 올리고, 기존 ReplicaSet의 Pod를 하나씩 줄인다
3. `maxSurge`는 동시에 추가 생성할 수 있는 Pod 수를, `maxUnavailable`은 동시에 줄일 수 있는 Pod 수를 제한한다
4. 각 리비전은 별도의 ReplicaSet으로 보관되어 롤백이 가능하다

### 실습 3: ReplicaSet 관계 확인

```bash
# Deployment가 관리하는 ReplicaSet 확인
kubectl get replicasets -n demo -l app=nginx-web
```

**예상 출력:**
```
NAME                    DESIRED   CURRENT   READY   AGE
nginx-web-xxxxxxxxxx    1         1         1       5d
```

**동작 원리:** Deployment -> ReplicaSet -> Pod 관계:
1. Deployment Controller가 Pod Template의 해시를 기반으로 ReplicaSet 이름을 생성한다
2. Pod Template이 변경될 때마다 새 ReplicaSet이 생성된다
3. 기존 ReplicaSet은 `replicas: 0`으로 축소되지만 삭제되지 않는다 (롤백용)
4. `spec.revisionHistoryLimit`(기본값 10)에 따라 보관할 ReplicaSet 수가 결정된다

### 실습 4: 스케일링 테스트

```bash
# nginx-web을 3개로 스케일링
kubectl scale deployment nginx-web -n demo --replicas=3

# Pod 배포 상태 확인
kubectl get pods -n demo -l app=nginx-web -o wide

# 원래 상태로 복원
kubectl scale deployment nginx-web -n demo --replicas=1
```

**예상 출력 (스케일링 후):**
```
NAME                         READY   STATUS    RESTARTS   AGE   IP           NODE
nginx-web-xxxxxxxxxx-aaaaa   1/1     Running   0          5d    10.20.1.15   dev-worker1
nginx-web-xxxxxxxxxx-bbbbb   1/1     Running   0          5s    10.20.1.40   dev-worker1
nginx-web-xxxxxxxxxx-ccccc   1/1     Running   0          5s    10.20.1.41   dev-worker1
```

**동작 원리:** `kubectl scale`은 Deployment의 `spec.replicas`를 변경한다:
1. API Server가 Deployment 오브젝트의 replicas 필드를 업데이트한다
2. Deployment Controller가 변경을 감지하고 ReplicaSet의 replicas를 조정한다
3. ReplicaSet Controller가 부족한 Pod 수만큼 새 Pod를 생성한다
4. Scheduler가 각 Pod를 적절한 노드에 배치한다 (dev 클러스터는 worker1만 있으므로 모두 dev-worker1에 배치)
