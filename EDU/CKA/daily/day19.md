# CKA Day 19: 모의시험 Part 1 (문제 1~14)

> 학습 목표 | CKA 도메인: 전 도메인 종합 (100%) | 예상 소요 시간: 2.5시간 (시험 120분 + 풀이 30분)

---

## 오늘의 학습 목표

- [ ] 120분 시간 제한 모의시험을 실전처럼 수행한다
- [ ] 25문제를 CKA 실제 난이도와 배점으로 풀어본다
- [ ] 시간 관리 전략을 체득한다
- [ ] 약점 도메인을 파악하고 보완 계획을 수립한다

---

## 시험 전 준비

### 환경 설정

```bash
# kubeconfig 설정
export KUBECONFIG=kubeconfig/platform.yaml:kubeconfig/dev.yaml:kubeconfig/staging.yaml:kubeconfig/prod.yaml

# vim 설정
echo 'set tabstop=2 shiftwidth=2 expandtab' >> ~/.vimrc

# alias 설정
alias k=kubectl
source <(kubectl completion bash)
complete -o default -F __start_kubectl k
export do="--dry-run=client -o yaml"
```

### 시간 관리 전략

- 총 시간: 120분, 25문제
- 평균 5분/문제, 쉬운 문제 3~4분, 어려운 문제 10~12분
- 배점이 높은 문제(7%)를 우선 풀고, 막히면 다음 문제로 넘어간다
- 마지막 10분은 미완성 문제 재시도에 사용한다

### 시험 전 체크리스트

```
□ kubectl alias 설정 완료 (alias k=kubectl)
□ bash completion 활성화 완료
□ vim 설정 완료 (tabstop=2)
□ 시험 환경에서 kubernetes.io 문서 접근 가능 확인
□ 타이머 120분 설정 완료
```

### 시험 응시 팁 (동작 원리)

```
CKA 시험의 내부 구조:

[1] 시험 환경:
    - 브라우저 기반 터미널 (PSI 환경)
    - 여러 클러스터가 제공됨 (각 문제마다 다른 클러스터)
    - 문제마다 kubectl config use-context <name> 실행 필수!

[2] 채점 방식:
    - 자동 채점 (스크립트로 결과물 확인)
    - 부분 점수 가능 (리소스가 생성되었지만 일부 필드 누락 시)
    - 리소스 이름, 네임스페이스, 이미지 등 정확히 일치해야 함

[3] 시간 관리 전략:
    ┌──────────────────────────────────────┐
    │  0~60분: 쉬운 문제(4%) 먼저 해결     │
    │  60~100분: 어려운 문제(7%) 도전       │
    │  100~110분: 미완성 문제 재시도        │
    │  110~120분: 최종 검증                 │
    └──────────────────────────────────────┘

[4] 문제 유형별 소요 시간 예상:
    - Deployment/Pod 생성: 2~4분
    - RBAC 설정: 4~6분
    - NetworkPolicy: 5~7분
    - etcd 백업/복원: 5~8분
    - 트러블슈팅: 5~10분
    - PV/PVC 생성: 4~6분
    - Ingress 설정: 4~6분
```

### 시작!

타이머를 120분으로 설정하고 시작하라. 각 문제의 컨텍스트를 반드시 먼저 실행하라.

---

## 모의시험 문제

### 문제 1. [4%] etcd 백업

**컨텍스트:** `kubectl config use-context platform`

`platform` 클러스터의 etcd 스냅샷을 `/opt/etcd-backup-exam.db`에 저장하라.

- etcd 엔드포인트: `https://127.0.0.1:2379`
- 인증서 경로: etcd Pod의 설정에서 확인하라

<details>
<summary>풀이 (시험 후 확인)</summary>

**문제 의도:** etcd 백업 절차와 인증서 경로를 알고 있는가?

**동작 원리:**
```
etcd 백업 흐름:
[1] etcd Pod의 YAML에서 인증서 경로 확인
[2] etcdctl snapshot save 명령으로 스냅샷 저장
[3] etcdctl snapshot status로 스냅샷 유효성 확인

etcd는 Kubernetes의 모든 상태를 저장하는 핵심 데이터 저장소이다.
백업을 통해 클러스터를 특정 시점으로 복원할 수 있다.
```

```bash
kubectl config use-context platform

# 인증서 경로 확인 (방법 1: etcd Pod YAML)
kubectl -n kube-system get pod etcd-platform-master -o yaml | grep -E "cert|key|ca"

# 인증서 경로 확인 (방법 2: etcd Pod의 command)
kubectl -n kube-system describe pod etcd-platform-master | grep -E "\-\-cert|\-\-key|\-\-ca"

# SSH 접속 후 백업
ssh admin@<platform-master-ip>
sudo ETCDCTL_API=3 etcdctl snapshot save /opt/etcd-backup-exam.db \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key

# 스냅샷 확인
sudo ETCDCTL_API=3 etcdctl snapshot status /opt/etcd-backup-exam.db --write-out=table
```

**시험 출제 패턴:**
- 인증서 경로를 직접 알려주는 경우도 있고, etcd Pod에서 확인하라고 하는 경우도 있다
- endpoint, cacert, cert, key 4가지를 모두 정확히 지정해야 한다
- ETCDCTL_API=3 환경변수를 잊지 말 것

</details>

---

### 문제 2. [7%] RBAC 설정

**컨텍스트:** `kubectl config use-context dev`

다음 RBAC를 설정하라:
1. `demo` 네임스페이스에 `app-developer` Role 생성
   - pods: get, list, watch, create, delete
   - deployments: get, list, create, update
   - services: get, list
2. 사용자 `alex`에게 `app-developer` 바인딩 (RoleBinding 이름: `alex-dev-binding`)
3. `alex`가 `demo` 네임스페이스에서 Pod를 생성할 수 있는지 확인하라

<details>
<summary>풀이</summary>

**문제 의도:** Role/RoleBinding YAML 구조와 apiGroups를 정확히 아는가?

**동작 원리:**
```
RBAC 인가 흐름:
[1] 사용자 alex가 kubectl create pod 요청
[2] API Server가 인증(Authentication) 수행
[3] RBAC Authorizer가 RoleBinding 확인
    → alex 사용자에게 바인딩된 Role 찾기
[4] Role의 rules에서 pods + create verb 확인
    → 허용되면 요청 처리
    → 거부되면 403 Forbidden
```

```bash
kubectl config use-context dev

# Role 생성 (kubectl create 명령어로)
kubectl create role app-developer \
  --verb=get,list,watch,create,delete --resource=pods \
  --verb=get,list,create,update --resource=deployments \
  --verb=get,list --resource=services \
  -n demo

# 위 명령이 복잡하면 YAML로
cat <<EOF | kubectl apply -f -
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: app-developer
  namespace: demo
rules:
- apiGroups: [""]                      # core API 그룹 (Pod, Service)
  resources: ["pods"]
  verbs: ["get", "list", "watch", "create", "delete"]
- apiGroups: ["apps"]                  # apps API 그룹 (Deployment)
  resources: ["deployments"]
  verbs: ["get", "list", "create", "update"]
- apiGroups: [""]
  resources: ["services"]
  verbs: ["get", "list"]
EOF

# RoleBinding 생성
kubectl create rolebinding alex-dev-binding \
  --role=app-developer \
  --user=alex \
  -n demo

# 확인
kubectl auth can-i create pods --as=alex -n demo           # yes
kubectl auth can-i delete deployments --as=alex -n demo     # no
kubectl auth can-i create services --as=alex -n demo        # no
```

**시험 출제 패턴:**
- apiGroups를 정확히 아는지가 핵심 (pods→"", deployments→"apps")
- Role vs ClusterRole, RoleBinding vs ClusterRoleBinding 구분
- `kubectl auth can-i`로 검증하라는 문제가 자주 출제됨

</details>

---

### 문제 3. [4%] Static Pod 생성

**컨텍스트:** `kubectl config use-context staging`

`staging-master` 노드에 Static Pod를 생성하라:
- 이름: `static-busybox`
- 이미지: `busybox:1.36`
- 명령어: `sleep 3600`

<details>
<summary>풀이</summary>

**문제 의도:** Static Pod의 생성 방법과 manifest 경로를 아는가?

**동작 원리:**
```
Static Pod 생성 흐름:
[1] SSH로 해당 노드 접속
[2] kubelet config에서 staticPodPath 확인
[3] 해당 경로에 YAML 파일 생성
[4] kubelet이 자동으로 감지하여 Pod 생성
[5] API Server에 mirror Pod 생성 (읽기 전용)
```

```bash
ssh admin@<staging-master-ip>

# staticPodPath 확인
cat /var/lib/kubelet/config.yaml | grep staticPodPath
# staticPodPath: /etc/kubernetes/manifests

sudo cat <<EOF > /etc/kubernetes/manifests/static-busybox.yaml
apiVersion: v1
kind: Pod
metadata:
  name: static-busybox
spec:
  containers:
  - name: busybox
    image: busybox:1.36
    command: ["sleep", "3600"]
EOF

exit
kubectl config use-context staging
kubectl get pods -A | grep static-busybox
```

</details>

---

### 문제 4. [7%] Deployment 생성 및 Rolling Update

**컨텍스트:** `kubectl config use-context prod`

1. Deployment `web-frontend` 생성 (이미지: `nginx:1.24`, 레플리카: 4, 포트: 80)
2. maxSurge=2, maxUnavailable=1로 전략 설정
3. 이미지를 `nginx:1.25`로 업데이트
4. 롤백하여 원래 이미지(`nginx:1.24`)로 복원

<details>
<summary>풀이</summary>

**문제 의도:** Deployment 생성, 전략 설정, 업데이트, 롤백을 모두 수행할 수 있는가?

```bash
kubectl config use-context prod

cat <<EOF | kubectl apply -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web-frontend
spec:
  replicas: 4
  selector:
    matchLabels:
      app: web-frontend
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 2
      maxUnavailable: 1
  template:
    metadata:
      labels:
        app: web-frontend
    spec:
      containers:
      - name: nginx
        image: nginx:1.24
        ports:
        - containerPort: 80
EOF

kubectl rollout status deployment/web-frontend

# 이미지 업데이트
kubectl set image deployment/web-frontend nginx=nginx:1.25
kubectl rollout status deployment/web-frontend

# 현재 이미지 확인
kubectl get deployment web-frontend -o jsonpath='{.spec.template.spec.containers[0].image}'
echo ""

# 롤백
kubectl rollout undo deployment/web-frontend
kubectl rollout status deployment/web-frontend

# 롤백 후 이미지 확인
kubectl get deployment web-frontend -o jsonpath='{.spec.template.spec.containers[0].image}'
echo ""
```

</details>

---

### 문제 5. [4%] NodePort Service 생성

**컨텍스트:** `kubectl config use-context prod`

`web-frontend` Deployment를 위한 NodePort Service를 생성하라:
- 이름: `web-frontend-svc`
- 포트: 80
- NodePort: 30180

<details>
<summary>풀이</summary>

**문제 의도:** Service YAML의 port/targetPort/nodePort 필드를 정확히 아는가?

```bash
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: Service
metadata:
  name: web-frontend-svc
spec:
  type: NodePort
  selector:
    app: web-frontend                  # Deployment의 Pod 라벨과 일치해야!
  ports:
  - port: 80                           # Service 포트 (ClusterIP에서 접근하는 포트)
    targetPort: 80                     # 컨테이너 포트
    nodePort: 30180                    # 노드에서 접근하는 포트 (30000-32767)
EOF

kubectl get svc web-frontend-svc
kubectl get endpoints web-frontend-svc
```

**시험 출제 패턴:**
- `kubectl expose`로 빠르게 생성 후 nodePort를 edit으로 추가하는 방법도 가능
- selector가 Pod 라벨과 일치하지 않으면 Endpoints가 비어있음

</details>

---

### 문제 6. [7%] NetworkPolicy 생성

**컨텍스트:** `kubectl config use-context dev`

`demo` 네임스페이스에 다음 NetworkPolicy를 생성하라:
- 이름: `db-policy`
- 대상: `app=postgres` Pod
- 인바운드 허용: `tier=backend` Pod에서 TCP 5432만 허용
- 그 외 인바운드는 차단

<details>
<summary>풀이</summary>

**문제 의도:** NetworkPolicy의 podSelector, ingress 규칙을 정확히 작성할 수 있는가?

**동작 원리:**
```
NetworkPolicy 처리 흐름:
[1] NetworkPolicy 생성 → CNI 플러그인이 감지
[2] podSelector로 대상 Pod 식별 (app=postgres)
[3] policyTypes에 Ingress가 있으면:
    → ingress 규칙에 매칭되는 트래픽만 허용
    → 매칭되지 않는 트래픽은 모두 차단
[4] CNI가 iptables/eBPF 규칙으로 네트워크 필터링 적용

주의: NetworkPolicy가 없는 Pod는 모든 트래픽 허용 (기본 동작)
     NetworkPolicy가 적용되면 명시적으로 허용된 트래픽만 통과
```

```bash
kubectl config use-context dev

cat <<EOF | kubectl apply -f -
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: db-policy
  namespace: demo
spec:
  podSelector:                         # 이 정책이 적용될 Pod (대상)
    matchLabels:
      app: postgres
  policyTypes:                         # 정책 유형 (Ingress, Egress 또는 둘 다)
  - Ingress                            # 인바운드 규칙만 적용
  ingress:
  - from:                              # 허용할 소스
    - podSelector:                     # 같은 네임스페이스의 Pod
        matchLabels:
          tier: backend
    ports:                             # 허용할 포트
    - protocol: TCP
      port: 5432
EOF

kubectl describe networkpolicy db-policy -n demo
```

**시험 출제 패턴:**
- from에 podSelector와 namespaceSelector를 조합하는 문제
- podSelector가 비어있으면({}) 모든 Pod 선택
- ingress가 비어있으면([]) 모든 인바운드 차단
- ingress를 생략하면 모든 인바운드 허용

</details>

---

### 문제 7. [7%] PV와 PVC 생성 및 Pod 마운트

**컨텍스트:** `kubectl config use-context staging`

1. PV `exam-pv`: 5Gi, RWO, hostPath `/opt/exam-data`, storageClassName `exam-storage`
2. PVC `exam-pvc`: 3Gi, RWO, storageClassName `exam-storage`
3. Pod `exam-pod`: nginx 이미지, PVC를 `/usr/share/nginx/html`에 마운트

<details>
<summary>풀이</summary>

**문제 의도:** PV-PVC 바인딩 조건과 Pod 볼륨 마운트를 이해하는가?

**동작 원리:**
```
PV-PVC 바인딩 흐름:
[1] PV 생성 (관리자가 생성)
    - capacity: 5Gi
    - accessModes: RWO
    - storageClassName: exam-storage

[2] PVC 생성 (개발자가 요청)
    - requests.storage: 3Gi (PV capacity 이하여야 함)
    - accessModes: RWO (PV와 일치해야 함)
    - storageClassName: exam-storage (PV와 일치해야 함)

[3] PV Controller가 바인딩 수행
    - storageClassName 일치 확인
    - accessModes 일치 확인
    - capacity >= requests 확인
    → 조건 충족 시 PV와 PVC 바인딩

[4] Pod가 PVC를 볼륨으로 사용
    - volumes에서 PVC 참조
    - volumeMounts로 컨테이너 경로에 마운트
```

```bash
kubectl config use-context staging

cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: PersistentVolume
metadata:
  name: exam-pv
spec:
  capacity:
    storage: 5Gi                       # PV 용량
  accessModes:
  - ReadWriteOnce                      # 단일 노드에서 읽기/쓰기
  storageClassName: exam-storage       # 스토리지 클래스 이름 (PVC와 매칭)
  hostPath:
    path: /opt/exam-data               # 노드의 실제 경로
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: exam-pvc
spec:
  accessModes:
  - ReadWriteOnce                      # PV의 accessModes와 일치해야 함
  resources:
    requests:
      storage: 3Gi                     # 요청 용량 (PV capacity 이하)
  storageClassName: exam-storage       # PV의 storageClassName과 일치해야 함
---
apiVersion: v1
kind: Pod
metadata:
  name: exam-pod
spec:
  containers:
  - name: nginx
    image: nginx
    volumeMounts:
    - name: data                       # volumes의 name과 일치
      mountPath: /usr/share/nginx/html # 컨테이너 내부 경로
  volumes:
  - name: data                         # volumeMounts의 name과 일치
    persistentVolumeClaim:
      claimName: exam-pvc              # PVC 이름
EOF

kubectl get pv exam-pv
kubectl get pvc exam-pvc
kubectl get pod exam-pod
```

</details>

---

### 문제 8. [4%] Taint와 Toleration

**컨텍스트:** `kubectl config use-context prod`

1. `prod-worker2`에 `dedicated=special:NoSchedule` Taint를 추가하라
2. 이 Taint를 tolerate하는 Pod `special-pod` (이미지: nginx)를 생성하라

<details>
<summary>풀이</summary>

```bash
kubectl config use-context prod

kubectl taint nodes prod-worker2 dedicated=special:NoSchedule

cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: special-pod
spec:
  tolerations:
  - key: "dedicated"
    operator: "Equal"
    value: "special"
    effect: "NoSchedule"
  containers:
  - name: nginx
    image: nginx
EOF

kubectl get pod special-pod -o wide
```

</details>

---

### 문제 9. [7%] 노드 drain 및 업그레이드 준비

**컨텍스트:** `kubectl config use-context staging`

`staging-worker1` 노드를 유지보수 모드로 전환하라:
1. 노드의 모든 워크로드를 안전하게 퇴거하라 (DaemonSet 무시)
2. 새로운 Pod가 스케줄링되지 않도록 하라
3. 유지보수 완료 후 노드를 정상 상태로 복원하라

<details>
<summary>풀이</summary>

**문제 의도:** kubectl drain과 uncordon의 사용법을 아는가?

**동작 원리:**
```
kubectl drain 내부 동작:
[1] 노드를 SchedulingDisabled (cordon) 상태로 변경
    → spec.unschedulable = true
    → 새 Pod 스케줄링 차단

[2] 해당 노드의 모든 Pod 퇴거 (eviction)
    → DaemonSet Pod는 --ignore-daemonsets로 무시
    → emptyDir 데이터는 --delete-emptydir-data로 삭제 허용
    → PodDisruptionBudget 존중 (위반 시 대기)

[3] Pod 퇴거 시:
    → ReplicaSet/Deployment 관리 Pod → 다른 노드에 재생성
    → Static Pod → 그대로 유지 (kubelet 관리)
    → 관리되지 않는 Pod → --force 없으면 거부

kubectl uncordon 내부 동작:
[1] 노드를 SchedulingDisabled 해제
    → spec.unschedulable = false
    → 새 Pod 스케줄링 허용
[2] 기존에 퇴거된 Pod가 자동으로 돌아오지는 않음!
```

```bash
kubectl config use-context staging

# drain (퇴거)
kubectl drain staging-worker1 --ignore-daemonsets --delete-emptydir-data
kubectl get nodes
# staging-worker1: SchedulingDisabled

# 유지보수 완료 후 uncordon
kubectl uncordon staging-worker1
kubectl get nodes
# staging-worker1: Ready
```

**시험 출제 패턴:**
- `--ignore-daemonsets` 플래그를 잊으면 에러 발생
- `--delete-emptydir-data`가 필요한 경우가 있음
- cordon만으로는 기존 Pod를 퇴거하지 않음 (drain과의 차이)

</details>

---

### 문제 10. [4%] DaemonSet 생성

**컨텍스트:** `kubectl config use-context dev`

`kube-system` 네임스페이스에 DaemonSet `log-collector`를 생성하라:
- 이미지: `busybox:1.36`
- 명령어: `sh -c "while true; do echo collecting; sleep 60; done"`
- 모든 Worker Node에서 실행

<details>
<summary>풀이</summary>

```bash
kubectl config use-context dev

cat <<EOF | kubectl apply -f -
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: log-collector
  namespace: kube-system
spec:
  selector:
    matchLabels:
      app: log-collector
  template:
    metadata:
      labels:
        app: log-collector
    spec:
      containers:
      - name: collector
        image: busybox:1.36
        command: ["sh", "-c", "while true; do echo collecting; sleep 60; done"]
EOF

kubectl get daemonset log-collector -n kube-system
kubectl get pods -n kube-system -l app=log-collector -o wide
```

</details>

---

### 문제 11. [7%] Ingress 생성

**컨텍스트:** `kubectl config use-context dev`

`demo` 네임스페이스에 Ingress를 생성하라:
- 이름: `demo-ingress`
- 호스트: `demo.tart.local`
- `/api` → `httpbin` Service (포트 8000)
- `/` → `nginx-web` Service (포트 80)
- pathType: Prefix

<details>
<summary>풀이</summary>

**문제 의도:** Ingress YAML의 rules, paths, backend 구조를 아는가?

**동작 원리:**
```
Ingress 트래픽 흐름:
[1] 클라이언트가 demo.tart.local/api로 요청
[2] Ingress Controller(nginx)가 요청 수신
[3] Ingress 규칙 매칭:
    ├── /api → httpbin:8000
    └── /    → nginx-web:80
[4] 매칭된 백엔드 Service로 트래픽 전달
[5] Service가 Pod로 트래픽 전달

pathType:
  - Exact: 정확히 일치 (/api만 매칭, /api/v1은 불일치)
  - Prefix: 접두사 일치 (/api, /api/v1, /api/v2 모두 매칭)
  - ImplementationSpecific: Ingress Controller에 따라 다름
```

```bash
kubectl config use-context dev

cat <<EOF | kubectl apply -f -
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: demo-ingress
  namespace: demo
spec:
  rules:
  - host: demo.tart.local
    http:
      paths:
      - path: /api
        pathType: Prefix
        backend:
          service:
            name: httpbin
            port:
              number: 8000
      - path: /
        pathType: Prefix
        backend:
          service:
            name: nginx-web
            port:
              number: 80
EOF

kubectl get ingress demo-ingress -n demo
```

</details>

---

### 문제 12. [4%] Job 생성

**컨텍스트:** `kubectl config use-context dev`

`demo` 네임스페이스에 Job을 생성하라:
- 이름: `report-job`
- 이미지: `busybox:1.36`
- 명령어: `sh -c "echo Report generated at $(date) > /dev/stdout"`
- completions: 3
- parallelism: 2

<details>
<summary>풀이</summary>

```bash
kubectl config use-context dev

cat <<EOF | kubectl apply -f -
apiVersion: batch/v1
kind: Job
metadata:
  name: report-job
  namespace: demo
spec:
  completions: 3
  parallelism: 2
  template:
    spec:
      restartPolicy: Never
      containers:
      - name: reporter
        image: busybox:1.36
        command: ["sh", "-c", "echo Report generated && date"]
EOF

kubectl get job report-job -n demo
kubectl get pods -n demo -l job-name=report-job
```

</details>

---

### 문제 13. [4%] 클러스터 정보 조회

**컨텍스트:** `kubectl config use-context platform`

다음 정보를 `/tmp/cluster-info.txt`에 저장하라:
1. 클러스터의 모든 노드 이름과 역할
2. kube-apiserver의 `--service-cluster-ip-range` 값

<details>
<summary>풀이</summary>

**문제 의도:** 클러스터 정보를 다양한 방법으로 조회할 수 있는가?

```bash
kubectl config use-context platform

# 노드 정보
kubectl get nodes -o custom-columns='NAME:.metadata.name,ROLES:.metadata.labels.node-role\.kubernetes\.io/control-plane' > /tmp/cluster-info.txt

# service-cluster-ip-range
kubectl -n kube-system get pod -l component=kube-apiserver -o yaml | grep service-cluster-ip-range >> /tmp/cluster-info.txt

cat /tmp/cluster-info.txt
```

</details>

---

### 문제 14. [7%] Pod 트러블슈팅

**컨텍스트:** `kubectl config use-context dev`

`demo` 네임스페이스의 `broken-app` Pod가 정상 동작하지 않는다. 문제를 진단하고 수정하라.

(시뮬레이션: 잘못된 이미지 태그 + 잘못된 command)

<details>
<summary>풀이</summary>

**문제 의도:** Pod 상태를 보고 문제를 진단하고 수정할 수 있는가?

**동작 원리 -- 트러블슈팅 흐름:**
```
Pod 문제 진단 단계별 접근법:

[1] kubectl get pod <name> -n <ns>
    → STATUS 확인:
    ├── Pending: 스케줄링 문제 (리소스 부족, nodeSelector 미매칭, Taint)
    ├── ImagePullBackOff/ErrImagePull: 이미지 풀 실패
    ├── CrashLoopBackOff: 컨테이너 반복 충돌
    ├── Error: 컨테이너 실행 오류
    └── Running (but not Ready): Probe 실패

[2] kubectl describe pod <name> -n <ns>
    → Events 섹션 확인:
    ├── Failed to pull image: 이미지 이름/태그 오류
    ├── FailedScheduling: 스케줄링 실패 원인
    ├── Back-off restarting: 컨테이너 반복 재시작
    └── Unhealthy: Probe 실패 상세

[3] kubectl logs <name> -n <ns>
    → 컨테이너 로그 확인
    → --previous: 이전 컨테이너 로그

[4] 수정 방법:
    ├── Pod 삭제 후 올바른 YAML로 재생성
    ├── kubectl edit pod <name> (제한적)
    └── Deployment 관리 Pod는 Deployment를 수정
```

```bash
kubectl config use-context dev

# 장애 생성
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: broken-app
  namespace: demo
spec:
  containers:
  - name: app
    image: nginx:nonexistent
    command: ["invalid-command"]
EOF

# 진단
kubectl get pod broken-app -n demo
# STATUS: ImagePullBackOff 또는 ErrImagePull

kubectl describe pod broken-app -n demo | grep -A10 Events
# Failed to pull image "nginx:nonexistent"

kubectl logs broken-app -n demo --previous 2>/dev/null

# 수정
kubectl delete pod broken-app -n demo
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: broken-app
  namespace: demo
spec:
  containers:
  - name: app
    image: nginx:1.24
EOF

kubectl get pod broken-app -n demo
# STATUS: Running
```

</details>

---

## tart-infra 실습

### 실습 환경 설정

```bash
# 모의시험과 동일하게 4개 클러스터 kubeconfig 로드
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/platform.yaml:~/sideproejct/tart-infra/kubeconfig/dev.yaml:~/sideproejct/tart-infra/kubeconfig/staging.yaml:~/sideproejct/tart-infra/kubeconfig/prod.yaml

# 시험용 alias 설정
alias k=kubectl
```

### 실습 1: 컨텍스트 전환 속도 연습

```bash
# 모든 컨텍스트 확인
kubectl config get-contexts -o name

# 빠르게 컨텍스트 전환하며 각 클러스터 노드 수 확인 (시간 측정)
time (
  for ctx in platform dev staging prod; do
    kubectl config use-context $ctx > /dev/null
    echo "$ctx: $(kubectl get nodes --no-headers | wc -l) nodes"
  done
)
```

**예상 출력:**
```
platform: 3 nodes
dev: 2 nodes
staging: 2 nodes
prod: 2 nodes

real    0m4.xxx
```

**동작 원리:**
1. CKA 시험에서는 매 문제마다 `kubectl config use-context` 전환이 필요하다
2. 컨텍스트 전환 실수로 잘못된 클러스터에서 작업하면 해당 문제는 0점이다
3. `--no-headers`와 `wc -l`로 빠르게 노드 수를 파악하는 패턴을 숙지한다

### 실습 2: 시험 빈출 패턴 - 빠른 리소스 생성

```bash
kubectl config use-context dev

# dry-run으로 YAML 생성 후 수정 적용 (시험 핵심 패턴)
kubectl run exam-pod --image=nginx:1.24 --dry-run=client -o yaml | \
  kubectl apply -f -

# Deployment 빠른 생성
kubectl create deployment exam-deploy --image=nginx:1.24 --replicas=3 -n demo --dry-run=client -o yaml | \
  kubectl apply -f -

# 확인
kubectl get pod exam-pod
kubectl get deployment exam-deploy -n demo

# 정리
kubectl delete pod exam-pod
kubectl delete deployment exam-deploy -n demo
```

**예상 출력:**
```
pod/exam-pod created
deployment.apps/exam-deploy created
```

**동작 원리:**
1. `--dry-run=client -o yaml`은 API Server에 전송하지 않고 YAML만 출력한다
2. 파이프로 `kubectl apply -f -`에 전달하면 한 번에 생성할 수 있다
3. YAML 수정이 필요하면 파이프 대신 파일로 저장(`> pod.yaml`)한 후 vim으로 편집한다
4. 시험에서 YAML을 처음부터 작성하는 것보다 이 방식이 2-3배 빠르다

### 실습 3: 멀티 클러스터 상태 종합 점검

```bash
# 전 클러스터 비정상 Pod 한번에 확인 (시험 시작 전 환경 점검용)
for ctx in platform dev staging prod; do
  echo "=== $ctx ==="
  kubectl --context=$ctx get pods -A --field-selector=status.phase!=Running,status.phase!=Succeeded 2>/dev/null | head -5
done
```

**동작 원리:**
1. `--context=` 플래그로 `use-context` 없이 일시적으로 다른 클러스터에 명령을 보낼 수 있다
2. `--field-selector`는 서버 측 필터링으로 대량 Pod 환경에서도 빠르게 비정상 Pod를 찾는다
3. 시험 시작 시 전체 클러스터 상태를 빠르게 파악해두면 문제 풀이에 도움이 된다

