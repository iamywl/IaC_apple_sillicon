# CKA Day 10: 스케줄링 시험 문제 & Resource 관리

> CKA 도메인: Workloads & Scheduling (15%) - Part 2 실전 | 예상 소요 시간: 2시간

---

### 문제 4. CronJob 생성 [4%]

**컨텍스트:** `kubectl config use-context dev`

매 5분마다 실행되는 CronJob 생성:
- 이름: `health-check`
- 이미지: `busybox:1.36`
- 명령: `echo "Health check OK"`

<details>
<summary>풀이</summary>

```bash
kubectl create cronjob health-check \
  --image=busybox:1.36 \
  --schedule="*/5 * * * *" \
  -n demo \
  -- sh -c "echo Health check OK"

kubectl get cronjobs -n demo

kubectl delete cronjob health-check -n demo
```

</details>

---

### 문제 5. Node Affinity [7%]

**컨텍스트:** `kubectl config use-context prod`

Deployment 생성:
- 이름: `cache-deploy`
- 이미지: `redis:7`
- 레플리카: 2
- Node Affinity: `kubernetes.io/os=linux` (required), Worker Node 선호 (preferred)

<details>
<summary>풀이</summary>

```bash
cat <<EOF | kubectl apply -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: cache-deploy
spec:
  replicas: 2
  selector:
    matchLabels:
      app: cache-deploy
  template:
    metadata:
      labels:
        app: cache-deploy
    spec:
      affinity:
        nodeAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
            nodeSelectorTerms:
            - matchExpressions:
              - key: kubernetes.io/os
                operator: In
                values:
                - linux
          preferredDuringSchedulingIgnoredDuringExecution:
          - weight: 100
            preference:
              matchExpressions:
              - key: node-role.kubernetes.io/control-plane
                operator: DoesNotExist
      containers:
      - name: redis
        image: redis:7
EOF

kubectl get pods -l app=cache-deploy -o wide

kubectl delete deployment cache-deploy
```

</details>

---

### 문제 6. ResourceQuota [4%]

**컨텍스트:** `kubectl config use-context dev`

`quota-test` 네임스페이스에 ResourceQuota 적용:
- Pod 수: 최대 5개
- requests.cpu: 최대 2, requests.memory: 최대 2Gi
- limits.cpu: 최대 4, limits.memory: 최대 4Gi

<details>
<summary>풀이</summary>

```bash
kubectl create namespace quota-test

cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: ResourceQuota
metadata:
  name: compute-quota
  namespace: quota-test
spec:
  hard:
    pods: "5"
    requests.cpu: "2"
    requests.memory: "2Gi"
    limits.cpu: "4"
    limits.memory: "4Gi"
EOF

kubectl describe resourcequota compute-quota -n quota-test

kubectl delete namespace quota-test
```

</details>

---

### 문제 7. LimitRange [4%]

**컨텍스트:** `kubectl config use-context dev`

`demo` 네임스페이스에 컨테이너 기본 리소스 설정:
- 기본 limits: cpu=200m, memory=128Mi
- 기본 requests: cpu=100m, memory=64Mi

<details>
<summary>풀이</summary>

```bash
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: LimitRange
metadata:
  name: default-limits
  namespace: demo
spec:
  limits:
  - type: Container
    default:
      cpu: "200m"
      memory: "128Mi"
    defaultRequest:
      cpu: "100m"
      memory: "64Mi"
EOF

kubectl describe limitrange default-limits -n demo

kubectl delete limitrange default-limits -n demo
```

</details>

---

### 문제 8. nodeSelector [4%]

**컨텍스트:** `kubectl config use-context prod`

1. `prod-worker1`에 `tier=frontend` 라벨 추가
2. `tier=frontend` 노드에만 배치되는 Deployment `frontend-app` 생성 (nginx:1.24, replicas=3)

<details>
<summary>풀이</summary>

```bash
kubectl config use-context prod

kubectl label nodes prod-worker1 tier=frontend

cat <<EOF | kubectl apply -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: frontend-app
spec:
  replicas: 3
  selector:
    matchLabels:
      app: frontend-app
  template:
    metadata:
      labels:
        app: frontend-app
    spec:
      nodeSelector:
        tier: frontend
      containers:
      - name: nginx
        image: nginx:1.24
EOF

kubectl get pods -l app=frontend-app -o wide

kubectl delete deployment frontend-app
kubectl label nodes prod-worker1 tier-
```

</details>

---

### 문제 9. NoExecute Taint [7%]

**컨텍스트:** `kubectl config use-context staging`

1. `staging-worker1`에서 실행 중인 Pod를 확인하라
2. `maintenance=true:NoExecute` Taint 추가
3. 기존 Pod가 축출되는지 확인하라
4. Taint를 제거하라

<details>
<summary>풀이</summary>

```bash
kubectl config use-context staging

# 1. 현재 Pod 확인
kubectl get pods -A -o wide | grep staging-worker1

# 2. NoExecute Taint 추가
kubectl taint nodes staging-worker1 maintenance=true:NoExecute

# 3. 기존 Pod 축출 확인 (Toleration 없는 Pod는 퇴거됨)
kubectl get pods -A -o wide | grep staging-worker1

# 4. Taint 제거
kubectl taint nodes staging-worker1 maintenance=true:NoExecute-
```

</details>

---

### 문제 10. Pod Anti-Affinity [7%]

**컨텍스트:** `kubectl config use-context prod`

Deployment `ha-app` 생성:
- nginx:1.24, replicas=3
- 같은 Deployment의 Pod가 서로 다른 노드에 배치 (preferred)

<details>
<summary>풀이</summary>

```bash
cat <<EOF | kubectl apply -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ha-app
spec:
  replicas: 3
  selector:
    matchLabels:
      app: ha-app
  template:
    metadata:
      labels:
        app: ha-app
    spec:
      affinity:
        podAntiAffinity:
          preferredDuringSchedulingIgnoredDuringExecution:
          - weight: 100
            podAffinityTerm:
              labelSelector:
                matchExpressions:
                - key: app
                  operator: In
                  values:
                  - ha-app
              topologyKey: kubernetes.io/hostname
      containers:
      - name: nginx
        image: nginx:1.24
EOF

kubectl get pods -l app=ha-app -o wide

kubectl delete deployment ha-app
```

</details>

---

### 문제 11. 특정 노드 전용 DaemonSet [4%]

**컨텍스트:** `kubectl config use-context prod`

1. `prod-worker1`, `prod-worker2`에 `monitoring=true` 라벨 추가
2. `monitoring=true` 노드에서만 실행되는 DaemonSet `node-exporter` 생성

<details>
<summary>풀이</summary>

```bash
kubectl label nodes prod-worker1 prod-worker2 monitoring=true

cat <<EOF | kubectl apply -f -
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: node-exporter
spec:
  selector:
    matchLabels:
      app: node-exporter
  template:
    metadata:
      labels:
        app: node-exporter
    spec:
      nodeSelector:
        monitoring: "true"
      containers:
      - name: exporter
        image: prom/node-exporter:v1.7.0
        ports:
        - containerPort: 9100
EOF

kubectl get pods -l app=node-exporter -o wide

kubectl delete daemonset node-exporter
kubectl label nodes prod-worker1 prod-worker2 monitoring-
```

</details>

---

### 문제 12. activeDeadlineSeconds Job [4%]

**컨텍스트:** `kubectl config use-context dev`

60초 내에 완료되지 않으면 실패하는 Job 생성:
- 이름: `timeout-job`
- 이미지: `busybox:1.36`
- 명령: `sleep 30` (30초면 성공, 아슬아슬)

<details>
<summary>풀이</summary>

```bash
cat <<EOF | kubectl apply -f -
apiVersion: batch/v1
kind: Job
metadata:
  name: timeout-job
  namespace: demo
spec:
  activeDeadlineSeconds: 60
  backoffLimit: 2
  template:
    spec:
      restartPolicy: Never
      containers:
      - name: worker
        image: busybox:1.36
        command: ["sleep", "30"]
EOF

kubectl get job timeout-job -n demo -w

kubectl delete job timeout-job -n demo
```

</details>

---

### 문제 13. Taint Exists 연산자 [4%]

**컨텍스트:** `kubectl config use-context dev`

1. `dev-worker1`에 `env=staging:NoSchedule` Taint 추가
2. Exists 연산자를 사용하여 `env` 키의 모든 값에 대해 tolerate하는 Pod `flexible-pod` 생성 (nginx 이미지)

<details>
<summary>풀이</summary>

```bash
kubectl config use-context dev

# 1. Taint 추가
kubectl taint nodes dev-worker1 env=staging:NoSchedule

# 2. Pod 생성 (Exists 연산자로 value 무관하게 매칭)
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: flexible-pod
spec:
  tolerations:
  - key: "env"
    operator: "Exists"        # value를 지정하지 않음, key만 매칭
    effect: "NoSchedule"
  containers:
  - name: nginx
    image: nginx
EOF

kubectl get pod flexible-pod -o wide

# 정리
kubectl delete pod flexible-pod
kubectl taint nodes dev-worker1 env=staging:NoSchedule-
```

</details>

---

### 문제 14. CronJob concurrencyPolicy 설정 [7%]

**컨텍스트:** `kubectl config use-context dev`

다음 CronJob을 생성하라:
- 이름: `sync-job`
- 이미지: `busybox:1.36`
- 명령: `sh -c "echo Syncing && sleep 120"` (2분 소요)
- 스케줄: 매 1분 (`*/1 * * * *`)
- concurrencyPolicy: Forbid (이전 Job 실행 중이면 스킵)
- successfulJobsHistoryLimit: 2
- failedJobsHistoryLimit: 1

<details>
<summary>풀이</summary>

```bash
cat <<EOF | kubectl apply -f -
apiVersion: batch/v1
kind: CronJob
metadata:
  name: sync-job
  namespace: demo
spec:
  schedule: "*/1 * * * *"
  concurrencyPolicy: Forbid
  successfulJobsHistoryLimit: 2
  failedJobsHistoryLimit: 1
  jobTemplate:
    spec:
      template:
        spec:
          restartPolicy: OnFailure
          containers:
          - name: sync
            image: busybox:1.36
            command: ["sh", "-c", "echo Syncing && sleep 120"]
EOF

# 확인 (1-2분 대기 후)
kubectl get cronjobs sync-job -n demo
kubectl get jobs -n demo -l job-name  # Forbid로 인해 동시 실행되지 않음

kubectl delete cronjob sync-job -n demo
```

</details>

---

### 문제 15. Pod Affinity [7%]

**컨텍스트:** `kubectl config use-context prod`

1. `cache-pod` Pod 생성 (redis:7, 라벨: app=cache)
2. `cache-pod`와 같은 노드에 배치되어야 하는 Pod `web-pod` 생성 (nginx:1.24)
   - Pod Affinity (required) 사용

<details>
<summary>풀이</summary>

```bash
kubectl config use-context prod

# 1. cache Pod 생성
kubectl run cache-pod --image=redis:7 --labels="app=cache"

# 2. web Pod 생성 (cache Pod와 같은 노드)
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: web-pod
spec:
  affinity:
    podAffinity:
      requiredDuringSchedulingIgnoredDuringExecution:
      - labelSelector:
          matchExpressions:
          - key: app
            operator: In
            values:
            - cache
        topologyKey: kubernetes.io/hostname
  containers:
  - name: nginx
    image: nginx:1.24
EOF

# 같은 노드에 배치되었는지 확인
kubectl get pods cache-pod web-pod -o wide

# 정리
kubectl delete pod cache-pod web-pod
```

</details>

---

### 문제 16. Job ttlSecondsAfterFinished [4%]

**컨텍스트:** `kubectl config use-context dev`

완료 후 30초 뒤에 자동으로 삭제되는 Job을 생성하라:
- 이름: `auto-cleanup-job`
- 이미지: `busybox:1.36`
- 명령: `echo "Done"`

<details>
<summary>풀이</summary>

```bash
cat <<EOF | kubectl apply -f -
apiVersion: batch/v1
kind: Job
metadata:
  name: auto-cleanup-job
  namespace: demo
spec:
  ttlSecondsAfterFinished: 30        # 완료 후 30초 뒤 자동 삭제
  template:
    spec:
      restartPolicy: Never
      containers:
      - name: worker
        image: busybox:1.36
        command: ["echo", "Done"]
EOF

# 완료 확인
kubectl get job auto-cleanup-job -n demo

# 30초 후 자동 삭제 확인
kubectl get job auto-cleanup-job -n demo  # 삭제되어 Not Found
```

</details>

---

### 문제 17. Multiple Tolerations [7%]

**컨텍스트:** `kubectl config use-context prod`

1. `prod-worker1`에 두 개의 Taint 추가:
   - `env=production:NoSchedule`
   - `team=backend:NoExecute`
2. 두 Taint를 모두 tolerate하는 Pod `multi-taint-pod` 생성 (nginx 이미지)

<details>
<summary>풀이</summary>

```bash
kubectl config use-context prod

# 1. Taint 추가
kubectl taint nodes prod-worker1 env=production:NoSchedule
kubectl taint nodes prod-worker1 team=backend:NoExecute

# 2. Pod 생성 (두 Taint 모두 tolerate)
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: multi-taint-pod
spec:
  tolerations:
  - key: "env"
    operator: "Equal"
    value: "production"
    effect: "NoSchedule"
  - key: "team"
    operator: "Equal"
    value: "backend"
    effect: "NoExecute"
  nodeSelector:
    kubernetes.io/hostname: prod-worker1
  containers:
  - name: nginx
    image: nginx
EOF

kubectl get pod multi-taint-pod -o wide

# 정리
kubectl delete pod multi-taint-pod
kubectl taint nodes prod-worker1 env=production:NoSchedule-
kubectl taint nodes prod-worker1 team=backend:NoExecute-
```

</details>

---

### 문제 18. LimitRange min/max 설정 [4%]

**컨텍스트:** `kubectl config use-context dev`

`demo` 네임스페이스에 다음 LimitRange 생성:
- 컨테이너 최소: cpu=50m, memory=64Mi
- 컨테이너 최대: cpu=1, memory=512Mi
- 기본 limits: cpu=500m, memory=256Mi
- 기본 requests: cpu=100m, memory=128Mi

<details>
<summary>풀이</summary>

```bash
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: LimitRange
metadata:
  name: strict-limits
  namespace: demo
spec:
  limits:
  - type: Container
    min:
      cpu: "50m"
      memory: "64Mi"
    max:
      cpu: "1"
      memory: "512Mi"
    default:
      cpu: "500m"
      memory: "256Mi"
    defaultRequest:
      cpu: "100m"
      memory: "128Mi"
EOF

kubectl describe limitrange strict-limits -n demo

# 테스트: 최대값 초과 Pod 생성 시도 (거부됨)
kubectl run test-exceed --image=nginx -n demo \
  --overrides='{"spec":{"containers":[{"name":"nginx","image":"nginx","resources":{"limits":{"cpu":"2","memory":"1Gi"}}}]}}' \
  --dry-run=server 2>&1 || echo "Expected: forbidden by LimitRange"

kubectl delete limitrange strict-limits -n demo
```

</details>

---

### 문제 19. DaemonSet updateStrategy OnDelete [4%]

**컨텍스트:** `kubectl config use-context dev`

OnDelete 전략을 사용하는 DaemonSet을 생성하라:
- 이름: `manual-ds`
- 이미지: `nginx:1.24`
- updateStrategy: OnDelete

<details>
<summary>풀이</summary>

```bash
cat <<EOF | kubectl apply -f -
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: manual-ds
  namespace: demo
spec:
  selector:
    matchLabels:
      app: manual-ds
  updateStrategy:
    type: OnDelete
  template:
    metadata:
      labels:
        app: manual-ds
    spec:
      containers:
      - name: nginx
        image: nginx:1.24
EOF

kubectl get daemonset manual-ds -n demo
kubectl describe daemonset manual-ds -n demo | grep "Update Strategy"

# 이미지 업데이트 (자동으로 적용되지 않음)
kubectl set image daemonset/manual-ds nginx=nginx:1.25 -n demo

# 수동으로 Pod 삭제해야 새 버전 적용
# kubectl delete pod <pod-name> -n demo

kubectl delete daemonset manual-ds -n demo
```

</details>

---

### 문제 20. tolerationSeconds 설정 [7%]

**컨텍스트:** `kubectl config use-context prod`

1. NoExecute Taint에 대해 60초 동안만 유지되는 Pod를 생성하라
   - Pod 이름: `graceful-pod`
   - 이미지: `nginx`
   - Toleration: `maintenance=true:NoExecute` (tolerationSeconds=60)
2. `prod-worker1`에 `maintenance=true:NoExecute` Taint를 추가하고 Pod 동작을 관찰하라

<details>
<summary>풀이</summary>

```bash
kubectl config use-context prod

# 1. Pod 생성
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: graceful-pod
spec:
  tolerations:
  - key: "maintenance"
    operator: "Equal"
    value: "true"
    effect: "NoExecute"
    tolerationSeconds: 60              # 60초 동안만 유지, 이후 축출
  containers:
  - name: nginx
    image: nginx
EOF

kubectl get pod graceful-pod -o wide

# 2. Taint 추가
kubectl taint nodes prod-worker1 maintenance=true:NoExecute

# Pod가 해당 노드에서 실행 중이면:
# - 즉시 축출되지 않음 (tolerationSeconds 때문)
# - 60초 후 축출됨

# 관찰
kubectl get pod graceful-pod -o wide -w

# 정리
kubectl delete pod graceful-pod --force 2>/dev/null
kubectl taint nodes prod-worker1 maintenance=true:NoExecute-
```

</details>

---

## 9. 복습 체크리스트

### 개념 확인

- [ ] NoSchedule, PreferNoSchedule, NoExecute의 차이를 설명할 수 있는가?
- [ ] Toleration의 Equal과 Exists 연산자의 차이를 아는가?
- [ ] tolerationSeconds의 용도를 아는가?
- [ ] nodeSelector와 Node Affinity의 차이를 설명할 수 있는가?
- [ ] required와 preferred Affinity의 차이를 아는가?
- [ ] Pod Affinity의 topologyKey 역할을 이해하는가?
- [ ] DaemonSet에 replicas 필드가 없는 이유를 아는가?
- [ ] DaemonSet의 updateStrategy 옵션을 아는가?
- [ ] Job의 restartPolicy 제한을 아는가? (Never/OnFailure)
- [ ] CronJob의 concurrencyPolicy 3가지를 설명할 수 있는가?
- [ ] ResourceQuota와 LimitRange의 차이를 아는가?
- [ ] QoS 클래스 3가지와 결정 기준을 아는가?
- [ ] Static Pod의 특징과 경로를 아는가?

### 시험 팁

1. **모든 Taint tolerate** -- `tolerations: [{operator: Exists}]`
2. **DaemonSet 빠른 생성** -- Deployment YAML에서 replicas/strategy 제거, kind를 DaemonSet으로
3. **Job 빠른 생성** -- `kubectl create job <name> --image=<image> -- <command>`
4. **CronJob 빠른 생성** -- `kubectl create cronjob <name> --image=<image> --schedule="<cron>" -- <command>`
5. **Node Affinity** -- `kubectl explain pod.spec.affinity.nodeAffinity`로 구조 확인
6. **Taint 확인** -- `kubectl describe node <node> | grep -A5 Taints`
7. **라벨 추가** -- `kubectl label nodes <node> key=value`
8. **ResourceQuota 확인** -- `kubectl describe resourcequota -n <ns>`
9. **CronJob 수동 트리거** -- `kubectl create job <name> --from=cronjob/<cronjob>`
10. **Static Pod 경로** -- `/etc/kubernetes/manifests/`

### 자주 사용하는 kubectl explain 경로

```bash
kubectl explain pod.spec.tolerations
kubectl explain pod.spec.nodeSelector
kubectl explain pod.spec.affinity.nodeAffinity
kubectl explain pod.spec.affinity.podAffinity
kubectl explain pod.spec.affinity.podAntiAffinity
kubectl explain daemonset.spec.updateStrategy
kubectl explain job.spec.completions
kubectl explain job.spec.parallelism
kubectl explain job.spec.backoffLimit
kubectl explain cronjob.spec.schedule
kubectl explain cronjob.spec.concurrencyPolicy
kubectl explain limitrange.spec.limits
kubectl explain resourcequota.spec.hard
```

---

## 내일 예고

**Day 11: Service 타입 & DNS** -- ClusterIP, NodePort, Headless Service, CoreDNS를 실습한다. Service DNS 형식 `<svc>.<ns>.svc.cluster.local`을 반드시 외워오자.


---

## tart-infra 실습

### 실습 환경 설정

```bash
# dev 클러스터에 접속
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/dev.yaml
kubectl get nodes
```

**예상 출력:**
```
NAME          STATUS   ROLES           AGE   VERSION
dev-master    Ready    control-plane   30d   v1.31.0
dev-worker1   Ready    <none>          30d   v1.31.0
```

### 실습 1: 노드 Taint 확인

```bash
# 모든 노드의 Taint 확인
kubectl describe nodes | grep -A3 "Taints:"
```

**예상 출력:**
```
Taints:             node-role.kubernetes.io/control-plane:NoSchedule
--
Taints:             <none>
```

**동작 원리:** Control Plane 노드의 Taint:
1. kubeadm이 Control Plane 노드에 `node-role.kubernetes.io/control-plane:NoSchedule` Taint를 자동 설정한다
2. 이 Taint에 대한 Toleration이 없는 Pod는 Control Plane 노드에 스케줄되지 않는다
3. kube-system의 시스템 Pod(CoreDNS 등)는 이 Taint를 tolerate하는 Toleration이 있다
4. dev-worker1에는 Taint가 없으므로 일반 워크로드가 이 노드에 배치된다

### 실습 2: DaemonSet 확인

```bash
# Cilium DaemonSet 확인 (모든 노드에 하나씩 배포)
kubectl get daemonset -n kube-system
```

**예상 출력:**
```
NAME           DESIRED   CURRENT   READY   UP-TO-DATE   AVAILABLE   NODE SELECTOR   AGE
cilium         2         2         2       2            2           <none>          30d
cilium-envoy   2         2         2       2            2           <none>          30d
kube-proxy     2         2         2       2            2           <none>          30d
```

**동작 원리:** DaemonSet의 스케줄링:
1. DaemonSet Controller가 각 노드에 대해 Pod를 생성한다
2. DESIRED=2인 이유: dev 클러스터에 노드가 2개(master + worker1)이다
3. Cilium은 Control Plane Taint를 tolerate하므로 master에도 배포된다
4. DaemonSet에는 `replicas` 필드가 없다 -- 노드 수에 따라 자동 결정된다

### 실습 3: Resource Request/Limit 확인

```bash
# demo 네임스페이스 Pod의 리소스 설정 확인
kubectl get pods -n demo -o custom-columns=NAME:.metadata.name,CPU_REQ:.spec.containers[0].resources.requests.cpu,CPU_LIM:.spec.containers[0].resources.limits.cpu,MEM_REQ:.spec.containers[0].resources.requests.memory,MEM_LIM:.spec.containers[0].resources.limits.memory
```

**동작 원리:** Resource Request와 Limit의 역할:
1. Request: Scheduler가 노드 배치를 결정할 때 사용한다 (예약량)
2. Limit: kubelet이 컨테이너의 실제 사용량을 제한한다
3. CPU Limit 초과 -> 쓰로틀링 (속도 저하), Memory Limit 초과 -> OOMKilled
4. Request 없이 Limit만 설정하면, Request = Limit으로 자동 설정된다

### 실습 4: HPA 동작 확인

```bash
# dev 클러스터의 HPA 확인
kubectl get hpa -n demo
```

**예상 출력:**
```
NAME        REFERENCE              TARGETS   MINPODS   MAXPODS   REPLICAS   AGE
nginx-web   Deployment/nginx-web   10%/70%   1         5         1          5d
```

**동작 원리:** HPA(Horizontal Pod Autoscaler) 동작 과정:
1. HPA Controller가 metrics-server에서 Pod의 CPU/메모리 사용률을 주기적으로 조회한다 (기본 15초)
2. 현재 사용률(10%)이 목표(70%)보다 낮으므로 replicas=1(최소값)을 유지한다
3. 사용률이 70%를 초과하면 ceil(현재 replicas * (현재/목표)) 공식으로 필요 replicas를 계산한다
4. metrics-server가 kubelet의 /metrics/resource 엔드포인트에서 데이터를 수집한다

```bash
# metrics-server 확인
kubectl get deployment metrics-server -n kube-system
kubectl top nodes
kubectl top pods -n demo
```
