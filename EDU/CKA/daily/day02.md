# CKA Day 2: 클러스터 아키텍처 시험 문제 & YAML 예제

> CKA 도메인: Cluster Architecture (25%) - Part 1 실전 | 예상 소요 시간: 2시간

---

### 문제 6. 노드 레이블 관리 [4%]

**컨텍스트:** `kubectl config use-context dev`

다음 작업을 수행하라:
1. `dev-worker1` 노드에 `environment=development` 레이블을 추가하라
2. `dev-worker1` 노드에 `disk=ssd` 레이블을 추가하라
3. 모든 노드의 레이블을 확인하라
4. `disk` 레이블을 삭제하라

<details>
<summary>풀이 과정</summary>

```bash
kubectl config use-context dev

# 1. 레이블 추가
kubectl label nodes dev-worker1 environment=development

# 2. 레이블 추가
kubectl label nodes dev-worker1 disk=ssd

# 3. 레이블 확인
kubectl get nodes --show-labels
# 또는 특정 레이블만 확인
kubectl get nodes -L environment,disk

# 4. 레이블 삭제 (키 뒤에 - 추가)
kubectl label nodes dev-worker1 disk-

# 확인
kubectl get nodes -L disk
```

**핵심:**
- 레이블 추가: `kubectl label nodes <node> key=value`
- 레이블 변경: `kubectl label nodes <node> key=newvalue --overwrite`
- 레이블 삭제: `kubectl label nodes <node> key-`

</details>

---

### 문제 7. 노드 Taint 확인 [4%]

**컨텍스트:** `kubectl config use-context prod`

다음 작업을 수행하라:
1. `prod-master`의 모든 Taint를 확인하라
2. Taint 정보를 `/tmp/master-taints.txt`에 저장하라

<details>
<summary>풀이 과정</summary>

```bash
kubectl config use-context prod

# 방법 1: describe로 확인
kubectl describe node prod-master | grep -A5 Taints > /tmp/master-taints.txt

# 방법 2: jsonpath로 확인
kubectl get node prod-master -o jsonpath='{.spec.taints}' > /tmp/master-taints.txt

# 방법 3: custom-columns로 확인
kubectl get nodes -o custom-columns='NAME:.metadata.name,TAINTS:.spec.taints'

# 확인
cat /tmp/master-taints.txt
# 기대: node-role.kubernetes.io/control-plane:NoSchedule
```

</details>

---

### 문제 8. 클러스터 노드 리소스 확인 [4%]

**컨텍스트:** `kubectl config use-context platform`

모든 노드의 CPU, Memory 용량과 Pod 수 제한을 확인하여 `/tmp/node-capacity.txt`에 저장하라.

<details>
<summary>풀이 과정</summary>

```bash
kubectl config use-context platform

# custom-columns로 깔끔하게 출력
kubectl get nodes -o custom-columns=\
'NAME:.metadata.name,CPU:.status.capacity.cpu,MEMORY:.status.capacity.memory,PODS:.status.capacity.pods' \
> /tmp/node-capacity.txt

# 확인
cat /tmp/node-capacity.txt
```

</details>

---

### 문제 9. Pod CIDR 확인 [4%]

**컨텍스트:** `kubectl config use-context dev`

각 노드에 할당된 Pod CIDR을 확인하여 `/tmp/pod-cidr.txt`에 저장하라.

<details>
<summary>풀이 과정</summary>

```bash
kubectl config use-context dev

kubectl get nodes -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.podCIDR}{"\n"}{end}' \
  > /tmp/pod-cidr.txt

cat /tmp/pod-cidr.txt
# 기대:
# dev-master    10.20.0.0/24
# dev-worker1   10.20.1.0/24
```

</details>

---

### 문제 10. kube-system Pod 상태 확인 [4%]

**컨텍스트:** `kubectl config use-context platform`

`kube-system` 네임스페이스의 모든 Pod를 상태(STATUS)별로 분류하여 `/tmp/kube-system-status.txt`에 저장하라.

<details>
<summary>풀이 과정</summary>

```bash
kubectl config use-context platform

kubectl get pods -n kube-system -o custom-columns=\
'NAME:.metadata.name,STATUS:.status.phase,NODE:.spec.nodeName' \
> /tmp/kube-system-status.txt

# 또는 간단하게
kubectl get pods -n kube-system > /tmp/kube-system-status.txt

cat /tmp/kube-system-status.txt
```

</details>

---

### 문제 11. 인증서 만료일 확인 [7%]

**컨텍스트:** `kubectl config use-context platform`

`platform-master`에 SSH 접속하여 다음을 수행하라:
1. `kubeadm certs check-expiration`으로 모든 인증서 만료일을 확인하라
2. API 서버 인증서의 만료일을 `/tmp/cert-expiry.txt`에 저장하라

<details>
<summary>풀이 과정</summary>

```bash
# Step 1: SSH 접속
ssh admin@<platform-master-ip>

# Step 2: 모든 인증서 만료일 확인
sudo kubeadm certs check-expiration

# Step 3: API 서버 인증서 만료일만 저장
sudo openssl x509 -in /etc/kubernetes/pki/apiserver.crt -noout -enddate > /tmp/cert-expiry.txt

# 또는 kubeadm 결과에서 추출
sudo kubeadm certs check-expiration | grep apiserver | head -1 >> /tmp/cert-expiry.txt

cat /tmp/cert-expiry.txt
exit
```

</details>

---

### 문제 12. 새 kubeconfig 컨텍스트 생성 [7%]

**컨텍스트:** `kubectl config use-context dev`

kubeconfig에 다음 조건의 새 컨텍스트를 추가하라:
- 컨텍스트 이름: `dev-restricted`
- 클러스터: 현재 dev 클러스터와 동일
- 사용자: `restricted-user` (인증서 경로: `/tmp/restricted.crt`, `/tmp/restricted.key`)
- 기본 네임스페이스: `demo`

<details>
<summary>풀이 과정</summary>

```bash
kubectl config use-context dev

# 현재 클러스터 이름 확인
kubectl config get-contexts dev
# CLUSTER 열에서 클러스터 이름 확인 (예: dev)

# 사용자 추가
kubectl config set-credentials restricted-user \
  --client-certificate=/tmp/restricted.crt \
  --client-key=/tmp/restricted.key

# 컨텍스트 추가
kubectl config set-context dev-restricted \
  --cluster=dev \
  --user=restricted-user \
  --namespace=demo

# 확인
kubectl config get-contexts
# dev-restricted 컨텍스트가 표시되어야 함

# 테스트 (인증서가 실제로 존재해야 작동)
kubectl config use-context dev-restricted

# 원래 컨텍스트로 복원
kubectl config use-context dev
```

</details>

---

### 문제 13. etcd 매니페스트에서 데이터 디렉터리 확인 [4%]

**컨텍스트:** `kubectl config use-context platform`

etcd의 `--data-dir` 값을 확인하여 `/tmp/etcd-data-dir.txt`에 저장하라.

<details>
<summary>풀이 과정</summary>

```bash
kubectl config use-context platform

# 방법 1: kubectl로 확인
kubectl -n kube-system get pod etcd-platform-master -o yaml | \
  grep "\-\-data-dir" | awk -F= '{print $2}' > /tmp/etcd-data-dir.txt

# 방법 2: SSH로 확인
ssh admin@<platform-master-ip>
sudo grep "data-dir" /etc/kubernetes/manifests/etcd.yaml | awk -F= '{print $2}' > /tmp/etcd-data-dir.txt
exit

cat /tmp/etcd-data-dir.txt
# 기대: /var/lib/etcd
```

</details>

---

### 문제 14. 클러스터별 네임스페이스 비교 [4%]

**컨텍스트:** 모든 클러스터

각 클러스터(platform, dev, staging, prod)의 네임스페이스 목록을 `/tmp/ns-comparison.txt`에 저장하라.

<details>
<summary>풀이 과정</summary>

```bash
for ctx in platform dev staging prod; do
  echo "=== $ctx ===" >> /tmp/ns-comparison.txt
  kubectl --context=$ctx get namespaces --no-headers | awk '{print $1}' >> /tmp/ns-comparison.txt
  echo "" >> /tmp/ns-comparison.txt
done

cat /tmp/ns-comparison.txt
```

</details>

---

### 문제 15. Control Plane 컴포넌트 포트 확인 [7%]

**컨텍스트:** `kubectl config use-context platform`

다음 Control Plane 컴포넌트의 실제 리스닝 포트를 확인하여 `/tmp/control-plane-ports.txt`에 저장하라:
1. kube-apiserver
2. kube-scheduler
3. kube-controller-manager
4. etcd

<details>
<summary>풀이 과정</summary>

```bash
kubectl config use-context platform

# 방법 1: Pod 설정에서 포트 확인
echo "=== kube-apiserver ===" > /tmp/control-plane-ports.txt
kubectl -n kube-system get pod kube-apiserver-platform-master -o yaml | \
  grep -E "secure-port|--port" >> /tmp/control-plane-ports.txt

echo "=== kube-scheduler ===" >> /tmp/control-plane-ports.txt
kubectl -n kube-system get pod kube-scheduler-platform-master -o yaml | \
  grep -E "secure-port|--port" >> /tmp/control-plane-ports.txt

echo "=== kube-controller-manager ===" >> /tmp/control-plane-ports.txt
kubectl -n kube-system get pod kube-controller-manager-platform-master -o yaml | \
  grep -E "secure-port|--port" >> /tmp/control-plane-ports.txt

echo "=== etcd ===" >> /tmp/control-plane-ports.txt
kubectl -n kube-system get pod etcd-platform-master -o yaml | \
  grep "listen-client-urls" >> /tmp/control-plane-ports.txt

cat /tmp/control-plane-ports.txt
# 기대:
# apiserver: 6443
# scheduler: 10259
# controller-manager: 10257
# etcd: 2379
```

**방법 2: SSH 접속하여 확인**
```bash
ssh admin@<platform-master-ip>
sudo ss -tlnp | grep -E "6443|10259|10257|2379"
exit
```

</details>

---

## 5. 추가 YAML 예제 모음

### 5.1 Pod 기본 예제

```yaml
# 가장 기본적인 Pod
apiVersion: v1                    # API 버전: Pod는 core 그룹 → v1
kind: Pod                         # 리소스 종류
metadata:                         # 메타데이터
  name: basic-pod                 # Pod 이름 (필수, 네임스페이스 내에서 고유)
  namespace: default              # 네임스페이스 (생략하면 default)
  labels:                         # 라벨 (Service 연결, 검색에 사용)
    app: basic                    # 키-값 형태의 라벨
spec:                             # Pod 사양
  containers:                     # 컨테이너 목록 (최소 1개)
  - name: nginx                   # 컨테이너 이름
    image: nginx:1.24             # 컨테이너 이미지
    ports:                        # 노출 포트 (정보성, 실제 접근은 Service 필요)
    - containerPort: 80           # 컨테이너 포트
```

### 5.2 Multi-Container Pod 예제

```yaml
# 두 개의 컨테이너가 볼륨을 공유하는 Pod (사이드카 패턴)
apiVersion: v1
kind: Pod
metadata:
  name: multi-container-pod
  namespace: default
  labels:
    app: multi-demo
spec:
  containers:
  # 메인 컨테이너: 웹 서버
  - name: web-server              # 첫 번째 컨테이너 이름
    image: nginx:1.24
    ports:
    - containerPort: 80
    volumeMounts:                  # 볼륨 마운트 설정
    - name: shared-logs            # 마운트할 볼륨 이름 (아래 volumes와 일치)
      mountPath: /var/log/nginx    # 컨테이너 내부 마운트 경로
  # 사이드카 컨테이너: 로그 수집기
  - name: log-collector           # 두 번째 컨테이너 이름
    image: busybox:1.36
    command: ["sh", "-c", "tail -f /logs/access.log"]
    volumeMounts:
    - name: shared-logs
      mountPath: /logs             # 같은 볼륨을 다른 경로에 마운트
      readOnly: true               # 읽기 전용
  volumes:                         # Pod 수준에서 볼륨 정의
  - name: shared-logs              # 볼륨 이름
    emptyDir: {}                   # emptyDir: Pod가 실행되는 동안만 존재하는 임시 볼륨
```

### 5.3 리소스 제한이 있는 Pod

```yaml
# CPU/Memory 제한이 설정된 Pod
apiVersion: v1
kind: Pod
metadata:
  name: resource-limited-pod
spec:
  containers:
  - name: app
    image: nginx:1.24
    resources:
      requests:                    # 최소 보장 리소스 (스케줄링 기준)
        cpu: "100m"                # 100 밀리코어 = 0.1 CPU
        memory: "128Mi"            # 128 메비바이트
      limits:                      # 최대 허용 리소스
        cpu: "500m"                # 500 밀리코어 = 0.5 CPU
        memory: "256Mi"            # CPU 초과 → 쓰로틀링, Memory 초과 → OOMKilled
    ports:
    - containerPort: 80
```

### 5.4 환경변수가 있는 Pod

```yaml
# 환경변수를 사용하는 Pod
apiVersion: v1
kind: Pod
metadata:
  name: env-pod
spec:
  containers:
  - name: app
    image: busybox:1.36
    command: ["sh", "-c", "echo $APP_NAME running in $APP_ENV && sleep 3600"]
    env:                           # 환경변수 목록
    - name: APP_NAME               # 환경변수 이름
      value: "my-application"      # 값을 직접 지정
    - name: APP_ENV
      value: "production"
    - name: NODE_NAME              # 다운워드 API로 노드 정보 주입
      valueFrom:
        fieldRef:
          fieldPath: spec.nodeName
    - name: POD_IP                 # Pod IP 주입
      valueFrom:
        fieldRef:
          fieldPath: status.podIP
```

### 5.5 Probe가 설정된 Pod

```yaml
# 건강 검사(Probe)가 설정된 Pod
apiVersion: v1
kind: Pod
metadata:
  name: probe-pod
spec:
  containers:
  - name: web
    image: nginx:1.24
    ports:
    - containerPort: 80
    # 활성 프로브: 컨테이너가 살아있는지 확인
    # 실패하면 컨테이너를 재시작한다
    livenessProbe:
      httpGet:                     # HTTP GET 요청으로 확인
        path: /healthz             # 요청 경로
        port: 80                   # 요청 포트
      initialDelaySeconds: 15      # 컨테이너 시작 후 15초 대기
      periodSeconds: 10            # 10초마다 검사
      failureThreshold: 3          # 3번 연속 실패 시 재시작
    # 준비 프로브: 트래픽을 받을 준비가 되었는지 확인
    # 실패하면 Service 엔드포인트에서 제거한다
    readinessProbe:
      httpGet:
        path: /ready
        port: 80
      initialDelaySeconds: 5
      periodSeconds: 5
    # 시작 프로브: 앱이 시작 완료되었는지 확인
    # 성공할 때까지 liveness/readiness를 비활성화한다
    startupProbe:
      httpGet:
        path: /startup
        port: 80
      failureThreshold: 30         # 30번까지 허용
      periodSeconds: 10            # 30 * 10 = 300초(5분) 내에 시작 필요
```

### 5.6 hostNetwork를 사용하는 Pod

```yaml
# 호스트 네트워크를 사용하는 Pod
apiVersion: v1
kind: Pod
metadata:
  name: host-network-pod
spec:
  hostNetwork: true                # Pod IP = 노드 IP (Control Plane 컴포넌트가 이 방식)
  containers:
  - name: nettools
    image: nicolaka/netshoot
    command: ["sleep", "3600"]
```

### 5.7 nodeSelector가 있는 Pod

```yaml
# 특정 레이블이 있는 노드에만 배치되는 Pod
apiVersion: v1
kind: Pod
metadata:
  name: nodeselector-pod
spec:
  nodeSelector:                    # 노드 선택 조건 (간단한 방식)
    disk: ssd                      # 이 레이블이 있는 노드에만 배치
    environment: production
  containers:
  - name: app
    image: nginx:1.24
```

### 5.8 Toleration이 있는 Pod

```yaml
# Control Plane 노드에도 배치 가능한 Pod
apiVersion: v1
kind: Pod
metadata:
  name: toleration-pod
spec:
  tolerations:                     # Taint를 허용(tolerate)하는 설정
  - key: "node-role.kubernetes.io/control-plane"  # 허용할 Taint의 키
    operator: "Exists"             # Exists: 키만 일치하면 됨, Equal: 값도 일치해야 함
    effect: "NoSchedule"           # 허용할 효과
  containers:
  - name: app
    image: nginx:1.24
```

### 5.9 Init Container가 있는 Pod

```yaml
# Init Container: 메인 컨테이너 실행 전에 먼저 실행되는 초기화 컨테이너
apiVersion: v1
kind: Pod
metadata:
  name: init-container-pod
spec:
  initContainers:                  # 초기화 컨테이너 목록 (순서대로 실행)
  - name: init-db-check            # 첫 번째 초기화 컨테이너
    image: busybox:1.36
    command: ['sh', '-c', 'until nslookup db-service; do echo waiting for db; sleep 2; done']
  - name: init-config              # 두 번째 초기화 컨테이너
    image: busybox:1.36
    command: ['sh', '-c', 'echo config loaded > /shared/config.txt']
    volumeMounts:
    - name: config
      mountPath: /shared
  containers:                      # 메인 컨테이너 (init 완료 후 시작)
  - name: app
    image: nginx:1.24
    volumeMounts:
    - name: config
      mountPath: /app/config
  volumes:
  - name: config
    emptyDir: {}
```

### 5.10 SecurityContext가 있는 Pod

```yaml
# 보안 컨텍스트가 설정된 Pod
apiVersion: v1
kind: Pod
metadata:
  name: security-pod
spec:
  securityContext:                 # Pod 수준 보안 설정
    runAsUser: 1000                # 컨테이너를 UID 1000으로 실행
    runAsGroup: 3000               # 그룹 GID 3000
    fsGroup: 2000                  # 볼륨 파일의 그룹을 2000으로 설정
  containers:
  - name: app
    image: busybox:1.36
    command: ["sh", "-c", "id && sleep 3600"]
    securityContext:               # 컨테이너 수준 보안 설정 (Pod 수준을 덮어씀)
      allowPrivilegeEscalation: false  # 권한 상승 불허
      readOnlyRootFilesystem: true     # 루트 파일시스템 읽기 전용
      capabilities:
        drop: ["ALL"]              # 모든 Linux capability 제거
```

### 5.11 configMap을 환경변수로 사용하는 Pod

```yaml
# ConfigMap의 값을 환경변수로 주입하는 Pod
apiVersion: v1
kind: Pod
metadata:
  name: configmap-env-pod
spec:
  containers:
  - name: app
    image: busybox:1.36
    command: ["sh", "-c", "env | sort && sleep 3600"]
    envFrom:                       # ConfigMap의 모든 키를 환경변수로 주입
    - configMapRef:
        name: app-config           # ConfigMap 이름
    env:                           # 개별 키만 선택적으로 주입
    - name: SPECIAL_KEY
      valueFrom:
        configMapKeyRef:
          name: app-config
          key: special.key         # ConfigMap의 특정 키
```

### 5.12 Secret을 사용하는 Pod

```yaml
# Secret을 볼륨으로 마운트하는 Pod
apiVersion: v1
kind: Pod
metadata:
  name: secret-pod
spec:
  containers:
  - name: app
    image: busybox:1.36
    command: ["sh", "-c", "cat /secrets/password && sleep 3600"]
    volumeMounts:
    - name: secret-vol
      mountPath: /secrets          # 마운트 경로
      readOnly: true               # 읽기 전용 (보안 모범 사례)
    env:
    - name: DB_PASSWORD            # Secret의 값을 환경변수로도 주입 가능
      valueFrom:
        secretKeyRef:
          name: db-secret          # Secret 이름
          key: password            # Secret의 키
  volumes:
  - name: secret-vol
    secret:
      secretName: db-secret        # 마운트할 Secret 이름
      defaultMode: 0400            # 파일 권한 (읽기 전용)
```

### 5.13 ServiceAccount를 지정하는 Pod

```yaml
# 특정 ServiceAccount로 실행되는 Pod
apiVersion: v1
kind: Pod
metadata:
  name: sa-pod
  namespace: demo
spec:
  serviceAccountName: my-sa        # 사용할 ServiceAccount 이름
  automountServiceAccountToken: true  # SA 토큰 자동 마운트 (기본값: true)
  containers:
  - name: app
    image: busybox:1.36
    command: ["sh", "-c", "cat /var/run/secrets/kubernetes.io/serviceaccount/token && sleep 3600"]
```

### 5.14 DNS 설정이 커스터마이즈된 Pod

```yaml
# DNS 설정을 커스텀하는 Pod
apiVersion: v1
kind: Pod
metadata:
  name: custom-dns-pod
spec:
  dnsPolicy: None                  # DNS 정책을 수동으로 설정
  dnsConfig:                       # 커스텀 DNS 설정
    nameservers:                   # DNS 서버 주소
    - 8.8.8.8
    - 8.8.4.4
    searches:                      # 검색 도메인
    - my-namespace.svc.cluster.local
    - svc.cluster.local
    options:                       # DNS 옵션
    - name: ndots
      value: "5"
  containers:
  - name: app
    image: busybox:1.36
    command: ["sh", "-c", "cat /etc/resolv.conf && sleep 3600"]
```

### 5.15 HostPath 볼륨을 사용하는 Pod

```yaml
# 호스트 파일시스템을 마운트하는 Pod
apiVersion: v1
kind: Pod
metadata:
  name: hostpath-pod
spec:
  containers:
  - name: app
    image: busybox:1.36
    command: ["sh", "-c", "ls /host-var-log && sleep 3600"]
    volumeMounts:
    - name: host-log
      mountPath: /host-var-log     # 컨테이너 내부 경로
      readOnly: true
  volumes:
  - name: host-log
    hostPath:
      path: /var/log               # 호스트의 /var/log 디렉터리
      type: Directory              # 타입: Directory, DirectoryOrCreate, File, FileOrCreate
```

### 5.16 Namespace 생성 예제

```yaml
# 네임스페이스 생성
apiVersion: v1                     # 네임스페이스도 core API 그룹
kind: Namespace                    # 리소스 종류
metadata:
  name: my-namespace               # 네임스페이스 이름
  labels:
    environment: development       # 네임스페이스에도 라벨 가능 (NetworkPolicy에서 활용)
    team: backend
```

### 5.17 kubeadm ClusterConfiguration 예제

```yaml
# kubeadm init 시 사용할 클러스터 설정 파일
apiVersion: kubeadm.k8s.io/v1beta3     # kubeadm 설정 API 버전
kind: ClusterConfiguration              # 클러스터 설정
kubernetesVersion: v1.31.0              # 설치할 K8s 버전
controlPlaneEndpoint: "192.168.64.10:6443"  # Control Plane 엔드포인트
networking:
  podSubnet: "10.10.0.0/16"             # Pod CIDR (CNI에 전달)
  serviceSubnet: "10.96.0.0/16"         # Service CIDR
  dnsDomain: "cluster.local"            # 클러스터 DNS 도메인
apiServer:
  extraArgs:                             # API 서버 추가 인자
    authorization-mode: "Node,RBAC"
    audit-log-path: "/var/log/apiserver/audit.log"
  certSANs:                             # 인증서에 추가할 SAN
  - "192.168.64.10"
  - "k8s.example.com"
etcd:
  local:                                 # 로컬 etcd 사용
    dataDir: "/var/lib/etcd"             # 데이터 디렉터리
```

---

## 6. 복습 체크리스트

### 개념 확인

- [ ] Control Plane 4개 컴포넌트(apiserver, etcd, scheduler, controller-manager)의 역할과 포트를 암기했는가?
- [ ] Worker Node 4개 컴포넌트(kubelet, kube-proxy, containerd, CNI)의 역할을 설명할 수 있는가?
- [ ] API 요청 처리 흐름(kubectl → apiserver → etcd → controller → scheduler → kubelet)을 설명할 수 있는가?
- [ ] Static Pod와 일반 Pod의 차이 5가지를 설명할 수 있는가?
- [ ] kubeadm init의 7단계를 순서대로 설명할 수 있는가?
- [ ] kubeconfig 파일의 3가지 구성 요소(clusters, users, contexts)를 이해하는가?
- [ ] 인증서 구조(/etc/kubernetes/pki/)를 파악하고 있는가?

### 시험 팁

1. **Static Pod 경로 찾기** — kubelet config.yaml의 `staticPodPath` 필드를 확인한다
2. **apiserver 설정 확인** — `kubectl -n kube-system get pod <apiserver-pod> -o yaml`로 인자를 확인한다
3. **컨텍스트 전환** — 매 문제마다 `kubectl config use-context` 명령을 반드시 실행한다
4. **kubeadm join** — `kubeadm token create --print-join-command` 하나로 전체 명령을 얻는다
5. **빠른 Pod 생성** — `kubectl run <name> --image=<image> --dry-run=client -o yaml > pod.yaml`
6. **YAML 필드 확인** — `kubectl explain pod.spec.containers` 명령으로 필드 정보를 확인한다

### 핵심 명령어 암기

```bash
# Pod 빠른 생성
kubectl run nginx --image=nginx:1.24 --port=80

# YAML 기본 틀 생성
kubectl run nginx --image=nginx:1.24 --dry-run=client -o yaml > pod.yaml

# 필드 확인
kubectl explain pod.spec
kubectl explain pod.spec.containers
kubectl explain pod.spec.containers.resources

# Static Pod 경로
cat /var/lib/kubelet/config.yaml | grep staticPodPath

# 컨텍스트 전환
kubectl config use-context <name>

# join 명령 생성
kubeadm token create --print-join-command
```

---

## 내일 예고

**Day 3: etcd 백업/복구 & 클러스터 업그레이드** -- CKA에서 가장 빈출되는 etcd snapshot save/restore와 kubeadm upgrade 절차를 실습한다. etcd 인증서 옵션 4개를 반드시 암기하고 오자.

---

## tart-infra 실습

### 실습 환경 설정

```bash
# platform 클러스터에 접속 (Control Plane 구성요소 확인용)
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/platform.yaml

# 노드 확인
kubectl get nodes -o wide
```

**예상 출력:**
```
NAME               STATUS   ROLES           AGE   VERSION   INTERNAL-IP     OS-IMAGE
platform-master    Ready    control-plane   30d   v1.31.0   192.168.64.10   Ubuntu 24.04 LTS
platform-worker1   Ready    <none>          30d   v1.31.0   192.168.64.11   Ubuntu 24.04 LTS
platform-worker2   Ready    <none>          30d   v1.31.0   192.168.64.12   Ubuntu 24.04 LTS
```

**동작 원리:** `kubectl get nodes -o wide` 명령을 실행하면:
1. kubectl이 kubeconfig 파일에서 platform 클러스터의 API Server 주소를 읽는다
2. 클라이언트 인증서(client-certificate-data)로 TLS 핸드셰이크를 수행한다
3. API Server가 RBAC 인가를 확인한 뒤 etcd에서 Node 오브젝트 목록을 조회한다
4. `-o wide` 플래그로 인해 INTERNAL-IP, OS-IMAGE 등 추가 컬럼이 포함된다

### 실습 1: Control Plane 구성요소 확인

```bash
# kube-system 네임스페이스의 Control Plane Pod 확인
kubectl get pods -n kube-system -o wide
```

**예상 출력:**
```
NAME                                       READY   STATUS    RESTARTS   AGE   IP              NODE
coredns-xxxxxxx-xxxxx                      1/1     Running   0          30d   10.10.0.2       platform-master
coredns-xxxxxxx-yyyyy                      1/1     Running   0          30d   10.10.0.3       platform-master
etcd-platform-master                       1/1     Running   0          30d   192.168.64.10   platform-master
kube-apiserver-platform-master             1/1     Running   0          30d   192.168.64.10   platform-master
kube-controller-manager-platform-master    1/1     Running   0          30d   192.168.64.10   platform-master
kube-scheduler-platform-master             1/1     Running   0          30d   192.168.64.10   platform-master
```

**동작 원리:** Control Plane 구성요소(etcd, kube-apiserver, kube-controller-manager, kube-scheduler)는 Static Pod로 실행된다:
1. kubelet이 `/etc/kubernetes/manifests/` 디렉터리를 감시한다
2. 이 디렉터리에 있는 YAML 파일을 기반으로 Pod를 직접 생성한다
3. API Server를 거치지 않으므로 API Server 자체도 이 방식으로 부트스트랩된다
4. Pod 이름에 노드 이름이 접미사로 붙는다 (예: `etcd-platform-master`)

### 실습 2: 멀티 클러스터 구조 이해

```bash
# 4개 클러스터의 kubeconfig를 순회하며 노드 확인
for cluster in platform dev staging prod; do
  echo "=== $cluster cluster ==="
  KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/${cluster}.yaml kubectl get nodes
  echo ""
done
```

**예상 출력:**
```
=== platform cluster ===
NAME               STATUS   ROLES           AGE   VERSION
platform-master    Ready    control-plane   30d   v1.31.0
platform-worker1   Ready    <none>          30d   v1.31.0
platform-worker2   Ready    <none>          30d   v1.31.0

=== dev cluster ===
NAME          STATUS   ROLES           AGE   VERSION
dev-master    Ready    control-plane   30d   v1.31.0
dev-worker1   Ready    <none>          30d   v1.31.0

=== staging cluster ===
NAME              STATUS   ROLES           AGE   VERSION
staging-master    Ready    control-plane   30d   v1.31.0
staging-worker1   Ready    <none>          30d   v1.31.0

=== prod cluster ===
NAME           STATUS   ROLES           AGE   VERSION
prod-master    Ready    control-plane   30d   v1.31.0
prod-worker1   Ready    <none>          30d   v1.31.0
prod-worker2   Ready    <none>          30d   v1.31.0
```

**동작 원리:** 각 클러스터는 독립된 kubeadm 클러스터이다:
1. 각 클러스터마다 별도의 etcd, API Server, Controller Manager, Scheduler가 실행된다
2. Pod CIDR이 서로 다르다: platform(10.10.0.0/16), dev(10.20.0.0/16), staging(10.30.0.0/16), prod(10.40.0.0/16)
3. Service CIDR도 서로 다르다: 10.96~10.99.0.0/16
4. 모든 VM은 Tart 가상화(Apple Silicon)로 Ubuntu 24.04 ARM64를 실행한다

### 실습 3: API Server 접근 과정 확인

```bash
# kubeconfig에서 API Server 주소 확인
kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}'
echo ""

# API Server에 직접 요청 (verbose 모드로 인증 과정 확인)
kubectl get nodes -v=6
```

**동작 원리:** `-v=6` 플래그는 HTTP 요청/응답을 출력한다:
1. `GET https://<master-ip>:6443/api/v1/nodes` 요청이 전송된다
2. 인증(Authentication): 클라이언트 인증서로 사용자 신원을 확인한다
3. 인가(Authorization): RBAC 정책으로 nodes 리소스 조회 권한을 확인한다
4. 어드미션 컨트롤(Admission Control): GET 요청이므로 해당 없음 (변경 요청에만 적용)
5. etcd에서 데이터를 읽어 응답한다

### 실습 4: Cilium CNI 확인

```bash
# CNI 플러그인 확인 (모든 클러스터가 Cilium 사용)
kubectl get pods -n kube-system -l k8s-app=cilium -o wide
```

**예상 출력:**
```
NAME           READY   STATUS    RESTARTS   AGE   IP              NODE
cilium-xxxxx   1/1     Running   0          30d   192.168.64.10   platform-master
cilium-yyyyy   1/1     Running   0          30d   192.168.64.11   platform-worker1
cilium-zzzzz   1/1     Running   0          30d   192.168.64.12   platform-worker2
```

**동작 원리:** Cilium은 DaemonSet으로 모든 노드에 하나씩 배포된다:
1. Cilium Agent가 각 노드에서 eBPF 프로그램을 커널에 로드한다
2. Pod 간 네트워킹, NetworkPolicy 적용, 로드밸런싱을 eBPF로 처리한다
3. 기존 iptables 기반 CNI보다 성능이 뛰어나다 (커널 공간에서 처리)
4. tart-infra의 모든 4개 클러스터가 Cilium을 CNI로 사용한다
