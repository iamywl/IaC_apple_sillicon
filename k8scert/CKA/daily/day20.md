# CKA Day 20: 모의시험 Part 2 (문제 15~25) & 자가 평가

> CKA 도메인: 전 도메인 종합 (100%) - Part 2 | 예상 소요 시간: 1.5시간

---

### 문제 15. [4%] ConfigMap과 Secret

**컨텍스트:** `kubectl config use-context dev`

1. ConfigMap `app-settings` 생성: `APP_ENV=production`, `LOG_LEVEL=info`
2. Secret `db-password` 생성: `password=exam-pass-2026`
3. Pod `config-test`에서 ConfigMap은 환경변수로, Secret은 `/secrets`에 볼륨 마운트

<details>
<summary>풀이</summary>

**문제 의도:** ConfigMap/Secret 생성과 Pod에서의 사용 방법(환경변수, 볼륨)을 아는가?

```bash
kubectl config use-context dev

# ConfigMap 생성
kubectl create configmap app-settings \
  --from-literal=APP_ENV=production \
  --from-literal=LOG_LEVEL=info \
  -n demo

# Secret 생성
kubectl create secret generic db-password \
  --from-literal=password=exam-pass-2026 \
  -n demo

# Pod 생성
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: config-test
  namespace: demo
spec:
  containers:
  - name: app
    image: busybox:1.36
    command: ["sh", "-c", "env | grep APP_ && cat /secrets/password && sleep 3600"]
    envFrom:                           # ConfigMap의 모든 키를 환경변수로
    - configMapRef:
        name: app-settings
    volumeMounts:
    - name: secret-vol
      mountPath: /secrets              # Secret을 볼륨으로 마운트
      readOnly: true
  volumes:
  - name: secret-vol
    secret:
      secretName: db-password
EOF

kubectl logs config-test -n demo
```

**검증 기대 출력:**

```text
APP_ENV=production
LOG_LEVEL=info
exam-pass-2026
```

**내부 동작 원리:** `envFrom`은 ConfigMap의 모든 키-값 쌍을 환경변수로 주입한다. Secret 볼륨 마운트 시 kubelet이 Secret 데이터를 tmpfs에 base64 디코딩하여 파일로 기록한다. 각 key가 파일 이름이 되고 value가 파일 내용이 된다. Secret은 etcd에 base64 인코딩으로 저장되며, encryption at rest를 별도 설정해야 실제 암호화된다.

**시험 출제 패턴:**
- envFrom vs env의 차이를 구분해야 한다 (전체 주입 vs 개별 키 주입)
- Secret 볼륨 마운트 시 각 key가 파일 이름이 된다
- `kubectl create configmap/secret` 빠른 생성 명령어를 외워야 한다

</details>

---

### 문제 16. [7%] Node Affinity와 Pod Anti-Affinity

**컨텍스트:** `kubectl config use-context prod`

Deployment `ha-app`을 생성하라:
- 이미지: `nginx:1.24`, 레플리카: 3
- Node Affinity: `kubernetes.io/os=linux` (required)
- Pod Anti-Affinity: 같은 Deployment의 Pod가 서로 다른 노드에 배치 (preferred)

<details>
<summary>풀이</summary>

**문제 의도:** Node Affinity와 Pod Anti-Affinity를 동시에 설정할 수 있는가?

```bash
kubectl config use-context prod

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
        nodeAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
            nodeSelectorTerms:
            - matchExpressions:
              - key: kubernetes.io/os
                operator: In
                values:
                - linux
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
```

**검증 기대 출력:**

```text
NAME                      READY   STATUS    RESTARTS   AGE   IP           NODE
ha-app-xxxxxxxxx-aaaaa    1/1     Running   0          10s   10.244.1.x   worker1
ha-app-xxxxxxxxx-bbbbb    1/1     Running   0          10s   10.244.2.x   worker2
ha-app-xxxxxxxxx-ccccc    1/1     Running   0          10s   10.244.3.x   worker3
```

**내부 동작 원리:** `requiredDuringSchedulingIgnoredDuringExecution`의 Node Affinity는 kube-scheduler의 Filtering 단계에서 평가된다. 조건을 만족하지 않는 노드는 후보에서 제외된다. `preferredDuringSchedulingIgnoredDuringExecution`의 Pod Anti-Affinity는 Scoring 단계에서 평가되어, 같은 app=ha-app Pod가 이미 있는 노드의 점수를 감점한다. weight=100이므로 최대 감점이 적용되지만, 노드가 부족하면 같은 노드에 배치될 수 있다(preferred이므로).

</details>

---

### 문제 17. [7%] Multi-Container Pod + 로그 확인

**컨텍스트:** `kubectl config use-context dev`

Multi-Container Pod를 생성하라:
- Pod 이름: `multi-pod`
- 컨테이너 1: `main` (nginx)
- 컨테이너 2: `sidecar` (busybox:1.36), 명령: `sh -c "while true; do echo $(date) Sidecar running >> /var/log/sidecar.log; sleep 5; done"`
- emptyDir 볼륨을 공유하여 `main`은 `/var/log/nginx`, `sidecar`는 `/var/log`에 마운트
- sidecar 컨테이너의 최근 5줄 로그를 `/tmp/sidecar-logs.txt`에 저장하라

<details>
<summary>풀이</summary>

**문제 의도:** Multi-Container Pod와 emptyDir 볼륨 공유, 특정 컨테이너 로그 확인을 할 수 있는가?

**동작 원리:**
```
Multi-Container Pod에서 emptyDir 볼륨 공유:

Pod
├── Container: main (nginx)
│   └── mountPath: /var/log/nginx  → emptyDir
│
├── Container: sidecar (busybox)
│   └── mountPath: /var/log        → emptyDir (같은 볼륨!)
│
└── Volume: shared-logs (emptyDir)

emptyDir는 Pod 레벨의 임시 볼륨이다.
같은 Pod의 모든 컨테이너가 공유할 수 있다.
Pod가 삭제되면 emptyDir 데이터도 삭제된다.
```

```bash
kubectl config use-context dev

cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: multi-pod
  namespace: demo
spec:
  containers:
  - name: main
    image: nginx
    volumeMounts:
    - name: shared-logs
      mountPath: /var/log/nginx
  - name: sidecar
    image: busybox:1.36
    command: ["sh", "-c", "while true; do date >> /var/log/sidecar.log; echo 'Sidecar running' >> /var/log/sidecar.log; sleep 5; done"]
    volumeMounts:
    - name: shared-logs
      mountPath: /var/log
  volumes:
  - name: shared-logs
    emptyDir: {}
EOF

sleep 15
kubectl logs multi-pod -c sidecar -n demo --tail=5 > /tmp/sidecar-logs.txt
cat /tmp/sidecar-logs.txt
```

**시험 출제 패턴:**
- `-c <container>` 플래그로 특정 컨테이너 로그 확인
- `--tail=N`으로 최근 N줄만 출력
- emptyDir 볼륨을 사용한 컨테이너 간 데이터 공유

</details>

---

### 문제 18. [4%] CronJob 생성

**컨텍스트:** `kubectl config use-context dev`

`demo` 네임스페이스에 다음 CronJob을 생성하라:
- 이름: `backup-job`
- 스케줄: 매일 새벽 2시 (`0 2 * * *`)
- 이미지: `busybox:1.36`
- 명령: `echo "Backup completed"`
- successfulJobsHistoryLimit: 3

<details>
<summary>풀이</summary>

```bash
kubectl config use-context dev

kubectl create cronjob backup-job \
  --image=busybox:1.36 \
  --schedule="0 2 * * *" \
  -n demo \
  -- sh -c "echo Backup completed"

# successfulJobsHistoryLimit 추가 (edit 또는 patch)
kubectl patch cronjob backup-job -n demo \
  -p '{"spec":{"successfulJobsHistoryLimit":3}}'

kubectl get cronjobs backup-job -n demo
```

**검증 기대 출력:**

```text
NAME         SCHEDULE    SUSPEND   ACTIVE   LAST SCHEDULE   AGE
backup-job   0 2 * * *   False     0        <none>          5s
```

**내부 동작 원리:** CronJob Controller가 schedule 필드를 파싱하여 다음 실행 시각을 계산한다. 실행 시각이 되면 Job 객체를 생성하고, Job Controller가 Pod를 생성하여 작업을 수행한다. `successfulJobsHistoryLimit: 3`은 성공한 Job 객체를 최근 3개만 보존하고 나머지는 자동 삭제한다는 의미이다. 이를 통해 완료된 Job/Pod가 무한히 쌓이는 것을 방지한다.

</details>

---

### 문제 19. [7%] ServiceAccount와 RBAC

**컨텍스트:** `kubectl config use-context dev`

1. `demo` 네임스페이스에 ServiceAccount `app-sa` 생성
2. ClusterRole `pod-reader`를 생성 (pods: get, list, watch)
3. RoleBinding `app-sa-binding`으로 `app-sa`에 `pod-reader` ClusterRole 바인딩 (`demo` 네임스페이스)
4. `app-sa` ServiceAccount를 사용하는 Pod `sa-pod` 생성 (busybox, sleep 3600)

<details>
<summary>풀이</summary>

**문제 의도:** ServiceAccount, ClusterRole, RoleBinding의 조합을 이해하는가?

**동작 원리:**
```
ServiceAccount + RBAC 흐름:

[1] ServiceAccount 생성 → 자동으로 Token 생성 (v1.24+에서는 수동)
[2] ClusterRole: 클러스터 범위의 권한 정의
    → RoleBinding으로 바인딩하면 특정 네임스페이스에서만 적용
    → ClusterRoleBinding으로 바인딩하면 모든 네임스페이스에서 적용
[3] Pod에서 SA 사용:
    → Pod의 spec.serviceAccountName 설정
    → 토큰이 /var/run/secrets/kubernetes.io/serviceaccount/에 마운트
    → Pod 내에서 kubectl 사용 시 이 토큰으로 인증
```

```bash
kubectl config use-context dev

# 1. ServiceAccount 생성
kubectl create serviceaccount app-sa -n demo

# 2. ClusterRole 생성
kubectl create clusterrole pod-reader \
  --verb=get,list,watch \
  --resource=pods

# 3. RoleBinding (ClusterRole을 namespace에 바인딩)
kubectl create rolebinding app-sa-binding \
  --clusterrole=pod-reader \
  --serviceaccount=demo:app-sa \
  -n demo

# 4. Pod 생성
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: sa-pod
  namespace: demo
spec:
  serviceAccountName: app-sa
  containers:
  - name: app
    image: busybox:1.36
    command: ["sleep", "3600"]
EOF

# 검증
kubectl auth can-i list pods --as=system:serviceaccount:demo:app-sa -n demo
kubectl auth can-i create pods --as=system:serviceaccount:demo:app-sa -n demo
```

**검증 기대 출력:**

```text
yes
no
```

**내부 동작 원리:** ClusterRole을 RoleBinding으로 바인딩하면, ClusterRole에 정의된 권한이 해당 네임스페이스에서만 적용된다. 이는 "같은 권한 세트를 여러 네임스페이스에 재사용"하는 패턴이다. ClusterRoleBinding으로 바인딩하면 모든 네임스페이스에서 적용된다. ServiceAccount의 FQDN은 `system:serviceaccount:<namespace>:<name>` 형식이다.

</details>

---

### 문제 20. [4%] 로그 확인 및 출력

**컨텍스트:** `kubectl config use-context dev`

`demo` 네임스페이스에서:
1. `app=nginx-web` 라벨을 가진 Pod의 로그 중 "error"를 포함하는 줄을 `/tmp/error-logs.txt`에 저장하라
2. 해당 Pod의 이전 컨테이너 로그를 확인하라

<details>
<summary>풀이</summary>

```bash
kubectl config use-context dev

# 1. error 로그 추출
kubectl logs -n demo -l app=nginx-web | grep -i "error" > /tmp/error-logs.txt

# 2. 이전 컨테이너 로그
kubectl logs -n demo -l app=nginx-web --previous

# 또는 Pod 이름을 직접 지정
POD=$(kubectl get pods -n demo -l app=nginx-web -o jsonpath='{.items[0].metadata.name}')
kubectl logs $POD -n demo --previous
```

</details>

---

### 문제 21. [7%] etcd 복원

**컨텍스트:** `kubectl config use-context platform`

`/opt/etcd-backup-exam.db` 스냅샷을 사용하여 etcd를 `/var/lib/etcd-restored`로 복원하라.

<details>
<summary>풀이</summary>

**문제 의도:** etcd 복원 절차 전체를 수행할 수 있는가?

**동작 원리:**
```
etcd 복원 흐름:

[1] etcdctl snapshot restore 실행
    → 스냅샷을 새 디렉터리로 복원

[2] etcd Pod의 데이터 디렉터리 변경
    → /etc/kubernetes/manifests/etcd.yaml 수정
    → hostPath의 path를 새 디렉터리로 변경

[3] kubelet이 etcd Pod 자동 재시작
    → Static Pod이므로 YAML 변경 감지 시 재생성

[4] kube-apiserver가 새 etcd에 연결
    → 클러스터 상태가 스냅샷 시점으로 복원됨
```

```bash
ssh admin@<platform-master-ip>

# 스냅샷 복원
sudo ETCDCTL_API=3 etcdctl snapshot restore /opt/etcd-backup-exam.db \
  --data-dir=/var/lib/etcd-restored

# etcd Pod의 데이터 디렉터리 변경
sudo vi /etc/kubernetes/manifests/etcd.yaml
# volumes 섹션에서 hostPath를 /var/lib/etcd-restored로 변경

# 변경 내용:
# - hostPath:
#     path: /var/lib/etcd-restored    # 기존: /var/lib/etcd
#     type: DirectoryOrCreate

# kubelet이 etcd Pod를 자동 재시작 (1-2분 대기)
# 확인
sudo crictl ps | grep etcd
exit

kubectl config use-context platform
kubectl get pods -n kube-system | grep etcd
```

**시험 출제 패턴:**
- 복원 후 etcd.yaml의 hostPath만 변경하면 됨
- member 디렉터리가 자동 생성됨
- 복원 시 --endpoints, --cacert 등은 불필요 (복원은 로컬 파일 작업)

</details>

---

### 문제 22. [4%] 노드 스케줄링 제어

**컨텍스트:** `kubectl config use-context staging`

1. `staging-worker2` 노드를 cordon하여 새 Pod가 스케줄링되지 않게 하라
2. cordon 상태에서 Deployment `test-deploy` (nginx, replicas=3) 생성
3. Pod가 어느 노드에 배치되었는지 확인하라
4. 노드를 uncordon하라

<details>
<summary>풀이</summary>

**문제 의도:** cordon과 drain의 차이를 아는가?

```bash
kubectl config use-context staging

# 1. cordon (새 Pod 스케줄링 차단, 기존 Pod 유지)
kubectl cordon staging-worker2
kubectl get nodes
# staging-worker2: SchedulingDisabled

# 2. Deployment 생성
kubectl create deployment test-deploy --image=nginx --replicas=3

# 3. Pod 배치 확인 (staging-worker2에는 배치되지 않음)
kubectl get pods -l app=test-deploy -o wide

# 4. uncordon
kubectl uncordon staging-worker2
kubectl get nodes

# 정리
kubectl delete deployment test-deploy
```

**검증 기대 출력:**

```text
# kubectl get nodes (cordon 후)
NAME               STATUS                     ROLES           AGE   VERSION
staging-worker2    Ready,SchedulingDisabled    <none>          5d    v1.29.x

# kubectl get pods -l app=test-deploy -o wide
NAME                           READY   STATUS    RESTARTS   AGE   NODE
test-deploy-xxxxxxxxx-aaaaa    1/1     Running   0          10s   staging-worker1
test-deploy-xxxxxxxxx-bbbbb    1/1     Running   0          10s   staging-worker1
test-deploy-xxxxxxxxx-ccccc    1/1     Running   0          10s   staging-master

# kubectl get nodes (uncordon 후)
NAME               STATUS   ROLES           AGE   VERSION
staging-worker2    Ready    <none>          5d    v1.29.x
```

**cordon vs drain 내부 동작 원리:**
```
cordon:
  - Node의 spec.unschedulable을 true로 설정한다
  - 새 Pod 스케줄링만 차단하고, 기존 Pod는 그대로 유지한다

drain:
  - cordon을 먼저 수행한 뒤, 해당 노드의 모든 Pod에 eviction API를 호출한다
  - PodDisruptionBudget을 존중하여 안전하게 퇴거한다
  - ReplicaSet/Deployment 관리 Pod는 다른 노드에서 재생성된다
  - 관리되지 않는 standalone Pod는 --force 없이는 퇴거를 거부한다
```

</details>

---

### 문제 23. [4%] Headless Service 생성

**컨텍스트:** `kubectl config use-context dev`

`demo` 네임스페이스에 Headless Service를 생성하라:
- 이름: `db-headless`
- 대상: `app=postgres` Pod
- 포트: 5432
- clusterIP: None

<details>
<summary>풀이</summary>

**문제 의도:** Headless Service의 특징과 설정 방법을 아는가?

**동작 원리:**
```
일반 ClusterIP Service:
  → DNS 조회 시 ClusterIP 반환 (단일 IP)
  → kube-proxy가 로드밸런싱

Headless Service (clusterIP: None):
  → DNS 조회 시 Pod IP 목록 반환 (A 레코드)
  → 클라이언트가 직접 Pod에 연결
  → StatefulSet과 함께 사용 시 Pod별 DNS 엔트리 생성
     예: postgres-0.db-headless.demo.svc.cluster.local
```

```bash
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: Service
metadata:
  name: db-headless
  namespace: demo
spec:
  clusterIP: None                      # Headless Service의 핵심!
  selector:
    app: postgres
  ports:
  - port: 5432
    targetPort: 5432
EOF

kubectl get svc db-headless -n demo
```

**검증 기대 출력:**

```text
NAME          TYPE        CLUSTER-IP   EXTERNAL-IP   PORT(S)    AGE
db-headless   ClusterIP   None         <none>        5432/TCP   5s
```

**트러블슈팅:** Headless Service를 생성했는데 DNS 조회 시 Pod IP가 반환되지 않으면, selector와 일치하는 Pod가 있는지 확인한다. `kubectl get endpoints db-headless -n demo`로 Endpoints가 채워져 있는지 확인하고, 비어 있으면 Pod의 label을 점검한다.

</details>

---

### 문제 24. [7%] 노드 문제 진단

**컨텍스트:** `kubectl config use-context staging`

`staging-worker1` 노드가 NotReady 상태이다. 원인을 진단하고 수정하라.

(시뮬레이션: kubelet이 중지된 상태)

<details>
<summary>풀이</summary>

**문제 의도:** 노드 NotReady 상태의 원인을 찾고 수정할 수 있는가?

**동작 원리 -- 노드 NotReady 진단 흐름:**
```
노드 문제 진단 단계:

[1] kubectl get nodes
    → NotReady 확인

[2] kubectl describe node <name>
    → Conditions 확인:
    ├── Ready=False: kubelet 문제
    ├── MemoryPressure=True: 메모리 부족
    ├── DiskPressure=True: 디스크 부족
    └── PIDPressure=True: PID 부족

[3] SSH로 노드 접속

[4] kubelet 상태 확인:
    sudo systemctl status kubelet
    sudo journalctl -u kubelet -f

[5] 일반적인 원인과 해결:
    ├── kubelet 중지 → sudo systemctl start kubelet
    ├── kubelet 설정 오류 → /var/lib/kubelet/config.yaml 확인
    ├── 인증서 만료 → 인증서 갱신
    ├── 컨테이너 런타임 문제 → sudo systemctl restart containerd
    └── 디스크 부족 → 불필요한 이미지/컨테이너 정리
```

```bash
kubectl config use-context staging

# 1. 노드 상태 확인
kubectl get nodes
# staging-worker1: NotReady

# 2. 노드 상세 확인
kubectl describe node staging-worker1 | grep -A5 Conditions

# 3. SSH 접속
ssh admin@<staging-worker1-ip>

# 4. kubelet 상태 확인
sudo systemctl status kubelet
# Active: inactive (dead)

# 5. kubelet 시작
sudo systemctl start kubelet

# 6. kubelet 부팅 시 자동 시작 설정
sudo systemctl enable kubelet

# 7. 상태 확인
sudo systemctl status kubelet
# Active: active (running)

exit

# 8. 노드 상태 확인 (1-2분 대기)
kubectl get nodes
# staging-worker1: Ready
```

**시험 출제 패턴:**
- NotReady 원인이 kubelet 중지인 경우가 가장 흔함
- containerd 중지, 인증서 만료도 출제 가능
- `sudo journalctl -u kubelet --no-pager | tail -50`으로 상세 로그 확인

</details>

---

### 문제 25. [4%] 리소스 사용량 확인

**컨텍스트:** `kubectl config use-context prod`

1. 가장 많은 CPU를 사용하는 Pod를 찾아 이름을 `/tmp/high-cpu-pod.txt`에 저장하라
2. 가장 많은 메모리를 사용하는 노드를 찾아 이름을 `/tmp/high-mem-node.txt`에 저장하라

<details>
<summary>풀이</summary>

**문제 의도:** kubectl top 명령어를 사용하여 리소스 사용량을 확인할 수 있는가?

```bash
kubectl config use-context prod

# 1. CPU 사용량 기준 Pod 정렬
kubectl top pod -A --sort-by=cpu | head -2
# 첫 번째 Pod의 이름을 저장
kubectl top pod -A --sort-by=cpu --no-headers | head -1 | awk '{print $2}' > /tmp/high-cpu-pod.txt

# 2. 메모리 사용량 기준 노드 정렬
kubectl top node --sort-by=memory | head -2
kubectl top node --sort-by=memory --no-headers | head -1 | awk '{print $1}' > /tmp/high-mem-node.txt

cat /tmp/high-cpu-pod.txt
cat /tmp/high-mem-node.txt
```

**검증 기대 출력:**

```text
# kubectl top pod -A --sort-by=cpu | head -3
NAMESPACE     NAME                                  CPU(cores)   MEMORY(bytes)
kube-system   etcd-platform-master                  45m          120Mi
kube-system   kube-apiserver-platform-master         40m          280Mi

# kubectl top node --sort-by=memory | head -3
NAME               CPU(cores)   CPU%   MEMORY(bytes)   MEMORY%
platform-master    120m         6%     1200Mi          31%
worker1            80m          4%     800Mi           20%
```

**내부 동작 원리:** `kubectl top`은 Metrics Server API(`metrics.k8s.io`)를 호출한다. Metrics Server는 각 노드의 kubelet에서 cAdvisor 메트릭(CPU/메모리 사용량)을 수집하여 인메모리에 저장한다. `--sort-by=cpu`는 클라이언트 측 정렬이 아니라 서버 측에서 정렬된 결과를 반환한다.

**주의:** `kubectl top`은 metrics-server가 설치되어 있어야 동작한다.

</details>

---

## 시험 종료

### 채점 기준

| 문제 | 배점 | 도메인 |
|------|------|--------|
| 1. etcd 백업 | 4% | Architecture |
| 2. RBAC 설정 | 7% | Architecture |
| 3. Static Pod | 4% | Architecture |
| 4. Deployment + Rolling Update | 7% | Workloads |
| 5. NodePort Service | 4% | Services |
| 6. NetworkPolicy | 7% | Services |
| 7. PV/PVC/Pod | 7% | Storage |
| 8. Taint/Toleration | 4% | Workloads |
| 9. drain/uncordon | 7% | Architecture |
| 10. DaemonSet | 4% | Workloads |
| 11. Ingress | 7% | Services |
| 12. Job | 4% | Workloads |
| 13. 클러스터 정보 | 4% | Architecture |
| 14. Pod 트러블슈팅 | 7% | Troubleshooting |
| 15. ConfigMap/Secret | 4% | Storage |
| 16. Affinity/Anti-Affinity | 7% | Workloads |
| 17. Multi-Container Pod | 7% | Troubleshooting |
| 18. CronJob | 4% | Workloads |
| 19. ServiceAccount + RBAC | 7% | Architecture |
| 20. 로그 확인 | 4% | Troubleshooting |
| 21. etcd 복원 | 7% | Architecture |
| 22. cordon/uncordon | 4% | Architecture |
| 23. Headless Service | 4% | Services |
| 24. 노드 트러블슈팅 | 7% | Troubleshooting |
| 25. 리소스 사용량 | 4% | Troubleshooting |
| **합계** | **131%** | (실제 시험은 100%) |

합격 기준: **66% 이상** (약 66점 이상)

### 도메인별 배점 분석

| 도메인 | 문제 수 | 총 배점 | CKA 비중 |
|--------|---------|---------|----------|
| Architecture (25%) | 8문제 | 44% | 충분히 커버 |
| Workloads (15%) | 5문제 | 26% | 충분히 커버 |
| Services (20%) | 4문제 | 22% | 적정 |
| Storage (10%) | 2문제 | 11% | 적정 |
| Troubleshooting (30%) | 5문제 | 29% | 적정 |

---

## 시험 후 자가 평가 (시험 출제 패턴)

### 도메인별 핵심 출제 패턴 정리

```
Architecture (25%):
  ├── etcd 백업/복원 (거의 매번 출제)
  ├── RBAC (Role/ClusterRole, RoleBinding/ClusterRoleBinding)
  ├── kubeadm 업그레이드 (control plane + worker)
  ├── Static Pod (생성/삭제)
  └── 클러스터 정보 조회

Workloads (15%):
  ├── Deployment 생성/업데이트/롤백
  ├── DaemonSet 생성
  ├── Job/CronJob 생성
  ├── Taint/Toleration
  └── Node Affinity / Pod Anti-Affinity

Services (20%):
  ├── Service (ClusterIP, NodePort) 생성
  ├── Ingress 생성
  ├── NetworkPolicy (Ingress/Egress)
  ├── CoreDNS 설정
  └── Headless Service

Storage (10%):
  ├── PV/PVC 생성 및 바인딩
  ├── StorageClass 사용
  ├── ConfigMap/Secret 생성 및 사용
  └── emptyDir/hostPath 볼륨

Troubleshooting (30%):
  ├── Pod 문제 진단 (ImagePullBackOff, CrashLoopBackOff)
  ├── 노드 NotReady 해결 (kubelet 재시작)
  ├── 로그 확인 및 분석
  ├── kubectl top (리소스 사용량)
  └── 네트워크 연결 문제 진단
```

### 자가 평가표

각 문제를 다음 기준으로 평가하라:
- **A**: 시간 내 완료, 자신 있음
- **B**: 완료했지만 불확실한 부분 있음
- **C**: 미완료 또는 오답

| 문제 | 평가 | 보완 필요 사항 |
|------|------|---------------|
| 1. etcd 백업 | | |
| 2. RBAC | | |
| 3. Static Pod | | |
| 4. Deployment | | |
| 5. NodePort | | |
| 6. NetworkPolicy | | |
| 7. PV/PVC | | |
| 8. Taint/Toleration | | |
| 9. drain/uncordon | | |
| 10. DaemonSet | | |
| 11. Ingress | | |
| 12. Job | | |
| 13. 클러스터 정보 | | |
| 14. 트러블슈팅 | | |
| 15. ConfigMap/Secret | | |
| 16. Affinity | | |
| 17. Multi-Container | | |
| 18. CronJob | | |
| 19. ServiceAccount | | |
| 20. 로그 확인 | | |
| 21. etcd 복원 | | |
| 22. cordon/uncordon | | |
| 23. Headless Service | | |
| 24. 노드 트러블슈팅 | | |
| 25. 리소스 사용량 | | |

### 약점 보완 계획

C등급 문제의 해당 Day 자료를 다시 학습하라:
- Architecture 약점 → Day 1~6 복습
- Workloads 약점 → Day 7~10 복습
- Services 약점 → Day 11~14 복습
- Storage 약점 → Day 15~16 복습
- Troubleshooting 약점 → Day 17~18 복습

---

## 빠른 참조 가이드

### 시험에서 가장 많이 사용하는 명령어 Top 20

```bash
# 1. 리소스 생성
kubectl create deployment <name> --image=<image> --replicas=<n>
kubectl run <name> --image=<image> -- <command>
kubectl create job <name> --image=<image> -- <command>
kubectl create cronjob <name> --image=<image> --schedule="<cron>" -- <command>

# 2. YAML 템플릿 생성
kubectl create deployment <name> --image=<image> --dry-run=client -o yaml > file.yaml

# 3. Service 생성
kubectl expose deployment <name> --port=<port> --target-port=<port> --type=<type>

# 4. RBAC
kubectl create role <name> --verb=<verbs> --resource=<resources>
kubectl create rolebinding <name> --role=<role> --user=<user>
kubectl create clusterrole <name> --verb=<verbs> --resource=<resources>
kubectl create clusterrolebinding <name> --clusterrole=<role> --user=<user>
kubectl auth can-i <verb> <resource> --as=<user> -n <ns>

# 5. 롤아웃
kubectl rollout status deployment/<name>
kubectl rollout history deployment/<name>
kubectl rollout undo deployment/<name>
kubectl set image deployment/<name> <container>=<image>

# 6. 스케일링
kubectl scale deployment <name> --replicas=<n>

# 7. Taint
kubectl taint nodes <node> key=value:Effect
kubectl taint nodes <node> key=value:Effect-

# 8. 라벨
kubectl label nodes <node> key=value
kubectl label nodes <node> key-

# 9. 노드 관리
kubectl cordon <node>
kubectl uncordon <node>
kubectl drain <node> --ignore-daemonsets --delete-emptydir-data

# 10. 로그 및 디버깅
kubectl logs <pod> -c <container> --tail=<n>
kubectl logs <pod> --previous
kubectl describe pod <pod>
kubectl top pod --sort-by=cpu
kubectl top node --sort-by=memory
```

### 핵심 YAML 필드 빠른 참조

```bash
# apiGroups 참조
""         → core API (Pod, Service, ConfigMap, Secret, PV, PVC, Node)
"apps"     → Deployment, ReplicaSet, DaemonSet, StatefulSet
"batch"    → Job, CronJob
"networking.k8s.io" → NetworkPolicy, Ingress
"rbac.authorization.k8s.io" → Role, ClusterRole, RoleBinding

# accessModes 참조
ReadWriteOnce (RWO)  → 단일 노드에서 읽기/쓰기
ReadOnlyMany (ROX)   → 여러 노드에서 읽기
ReadWriteMany (RWX)  → 여러 노드에서 읽기/쓰기

# Service DNS 형식
<svc>.<ns>.svc.cluster.local
# 예: nginx-web.demo.svc.cluster.local
```

### 최종 시험 팁

1. **컨텍스트 전환** -- 매 문제마다 `kubectl config use-context` 반드시 실행
2. **시간 관리** -- 7% 문제 우선, 4% 문제는 빠르게, 막히면 건너뛰기
3. **dry-run 활용** -- `kubectl create/run --dry-run=client -o yaml`로 YAML 기본 틀 생성
4. **kubectl explain** -- YAML 필드가 기억나지 않을 때 `kubectl explain <resource>.spec`
5. **공식 문서** -- kubernetes.io 문서에서 검색하여 YAML 복사/붙여넣기
6. **검증** -- 작업 후 반드시 `kubectl get/describe`로 결과 확인
7. **네임스페이스** -- 문제에서 지정한 네임스페이스를 반드시 확인 (-n 플래그)
8. **부분 점수** -- 완벽하지 않아도 리소스가 생성되면 부분 점수 가능
9. **alias 활용** -- alias k=kubectl, export do="--dry-run=client -o yaml"
10. **차분하게** -- 시험 시간은 충분하다. 서두르지 말고 정확하게

---

## 20일 학습 완료

Day 1~20 학습을 모두 완료했다. CKA 시험의 모든 도메인을 tart-infra 환경에서 실습했다.

**다음 단계:**
1. 모의시험에서 C등급 문제를 해당 Day에서 복습
2. 03-exam-questions.md의 40문제를 추가로 풀기
3. 04-tart-infra-practice.md의 50개 Lab을 추가 실습
4. 시험 2~3일 전에 Day 19~20 모의시험을 한 번 더 수행

---

## tart-infra 실습

### 실습 환경 설정

```bash
# 전체 클러스터 kubeconfig 로드
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/platform.yaml:~/sideproejct/tart-infra/kubeconfig/dev.yaml:~/sideproejct/tart-infra/kubeconfig/staging.yaml:~/sideproejct/tart-infra/kubeconfig/prod.yaml
alias k=kubectl
```

### 실습 1: 전 도메인 종합 점검 - 클러스터 아키텍처

```bash
# 각 클러스터의 핵심 정보 종합 리포트
for ctx in platform dev staging prod; do
  echo "=== $ctx ==="
  echo "Nodes: $(kubectl --context=$ctx get nodes --no-headers | wc -l)"
  echo "Namespaces: $(kubectl --context=$ctx get ns --no-headers | wc -l)"
  echo "Total Pods: $(kubectl --context=$ctx get pods -A --no-headers | wc -l)"
  echo ""
done
```

**예상 출력:**
```
=== platform ===
Nodes: 3
Namespaces: 8
Total Pods: 35

=== dev ===
Nodes: 2
Namespaces: 5
Total Pods: 20
```

**동작 원리:**
1. 시험 종료 전 각 클러스터의 리소스 수를 확인하여 작업 누락을 방지한다
2. `--no-headers`로 헤더 라인을 제외하고 `wc -l`로 정확한 수량을 파악한다
3. 예상보다 Pod 수가 적으면 작업이 누락되었을 가능성을 점검한다

### 실습 2: dev 클러스터 전체 아키텍처 검증

```bash
kubectl config use-context dev

# 핵심 리소스 상태 한번에 확인 (시험 마지막 검증용)
echo "--- Deployments ---"
kubectl get deploy -n demo
echo "--- Services ---"
kubectl get svc -n demo
echo "--- NetworkPolicies ---"
kubectl get ciliumnetworkpolicies -n demo --no-headers | wc -l
echo "--- HPA ---"
kubectl get hpa -n demo
echo "--- PDB ---"
kubectl get pdb -n demo
echo "--- PVC ---"
kubectl get pvc -n demo
```

**예상 출력:**
```
--- Deployments ---
nginx, httpbin-v1, httpbin-v2 등 다수
--- Services ---
nginx(NodePort:30080), keycloak(NodePort:30888), postgresql, redis, rabbitmq
--- NetworkPolicies ---
11
--- HPA ---
nginx HPA (CPU 기반)
--- PDB ---
nginx PDB (minAvailable: 1)
--- PVC ---
data-postgresql-0, data-redis-0, data-rabbitmq-0
```

**동작 원리:**
1. 단일 명령 체인으로 전체 아키텍처를 빠르게 검증할 수 있다
2. CiliumNetworkPolicy 11개는 마이크로서비스 간 통신을 세밀하게 제어한다
3. HPA+PDB 조합으로 오토스케일링과 가용성을 동시에 보장한다
4. StatefulSet의 PVC는 Pod 재시작 후에도 데이터 영속성을 보장한다

### 실습 3: 자가 평가 체크리스트 실행

```bash
# 각 도메인별 핵심 명령 실행 가능 여부 빠른 점검
echo "[1] RBAC" && kubectl auth can-i list pods -n demo --as=system:serviceaccount:demo:default && echo "OK"
echo "[2] DNS" && kubectl run dnscheck --image=busybox:1.36 -n demo --rm -it --restart=Never -- nslookup nginx.demo.svc.cluster.local > /dev/null 2>&1 && echo "OK"
echo "[3] Storage" && kubectl get pvc -n demo --no-headers | wc -l | xargs -I{} echo "{} PVCs bound"
echo "[4] Networking" && kubectl get svc nginx -n demo -o jsonpath='{.spec.type}:{.spec.ports[0].nodePort}' && echo " OK"
```

**동작 원리:**
1. 시험 종료 전 각 도메인별 핵심 기능이 정상 동작하는지 빠르게 확인한다
2. RBAC → DNS → Storage → Networking 순서로 의존성 계층을 따라 검증한다
3. 하나라도 실패하면 해당 도메인의 작업을 재점검한다
