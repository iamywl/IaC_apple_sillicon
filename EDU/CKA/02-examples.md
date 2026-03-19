# CKA 실전 실습 예제 모음

> 이 문서는 CKA 시험에서 출제되는 주요 실습 항목을 명령어와 YAML 예제로 정리한 것이다. 모든 예제는 **즉시 사용 가능한 형태**로 작성되어 있다.

---

## 1. 클러스터 설치 및 구성

### 1.1 kubeadm을 이용한 클러스터 초기화

#### 사전 준비 (모든 노드에서 실행)

```bash
# 스왑 비활성화
sudo swapoff -a
sudo sed -i '/ swap / s/^/#/' /etc/fstab

# 커널 모듈 로드
cat <<EOF | sudo tee /etc/modules-load.d/k8s.conf
overlay
br_netfilter
EOF

sudo modprobe overlay
sudo modprobe br_netfilter

# sysctl 파라미터 설정
cat <<EOF | sudo tee /etc/sysctl.d/k8s.conf
net.bridge.bridge-nf-call-iptables  = 1
net.bridge.bridge-nf-call-ip6tables = 1
net.ipv4.ip_forward                 = 1
EOF

sudo sysctl --system

# containerd 설치 (Ubuntu/Debian)
sudo apt-get update
sudo apt-get install -y containerd

# containerd 기본 설정 생성
sudo mkdir -p /etc/containerd
containerd config default | sudo tee /etc/containerd/config.toml
# SystemdCgroup = true로 변경
sudo sed -i 's/SystemdCgroup = false/SystemdCgroup = true/' /etc/containerd/config.toml
sudo systemctl restart containerd
sudo systemctl enable containerd

# kubeadm, kubelet, kubectl 설치 (Ubuntu/Debian, v1.30 예시)
sudo apt-get update
sudo apt-get install -y apt-transport-https ca-certificates curl gpg

curl -fsSL https://pkgs.k8s.io/core:/stable:/v1.30/deb/Release.key | \
  sudo gpg --dearmor -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg

echo 'deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/v1.30/deb/ /' | \
  sudo tee /etc/apt/sources.list.d/kubernetes.list

sudo apt-get update
sudo apt-get install -y kubelet=1.30.0-1.1 kubeadm=1.30.0-1.1 kubectl=1.30.0-1.1
sudo apt-mark hold kubelet kubeadm kubectl

sudo systemctl enable --now kubelet
```

#### Control Plane 초기화

```bash
# 기본 초기화
sudo kubeadm init \
  --pod-network-cidr=10.244.0.0/16 \
  --apiserver-advertise-address=192.168.1.100 \
  --kubernetes-version=v1.30.0

# kubeconfig 설정
mkdir -p $HOME/.kube
sudo cp -i /etc/kubernetes/admin.conf $HOME/.kube/config
sudo chown $(id -u):$(id -g) $HOME/.kube/config

# CNI 설치 (Calico 예시)
kubectl apply -f https://raw.githubusercontent.com/projectcalico/calico/v3.27.0/manifests/calico.yaml

# 또는 Flannel
kubectl apply -f https://github.com/flannel-io/flannel/releases/latest/download/kube-flannel.yml
```

#### Worker Node 조인

```bash
# Control Plane 초기화 시 출력된 명령 실행
sudo kubeadm join 192.168.1.100:6443 \
  --token abcdef.0123456789abcdef \
  --discovery-token-ca-cert-hash sha256:abc123...

# 토큰이 만료된 경우 새로 생성
kubeadm token create --print-join-command

# 토큰 목록 확인
kubeadm token list
```

---

### 1.2 클러스터 업그레이드 (v1.30.0 → v1.31.0 예시)

#### Control Plane 노드 업그레이드

```bash
# 1단계: kubeadm 업그레이드
sudo apt-mark unhold kubeadm
sudo apt-get update
sudo apt-get install -y kubeadm=1.31.0-1.1
sudo apt-mark hold kubeadm

# 2단계: 업그레이드 계획 확인
sudo kubeadm upgrade plan

# 3단계: Control Plane 컴포넌트 업그레이드
sudo kubeadm upgrade apply v1.31.0

# 4단계: 노드 drain
kubectl drain <control-plane-node> --ignore-daemonsets --delete-emptydir-data

# 5단계: kubelet, kubectl 업그레이드
sudo apt-mark unhold kubelet kubectl
sudo apt-get install -y kubelet=1.31.0-1.1 kubectl=1.31.0-1.1
sudo apt-mark hold kubelet kubectl

# 6단계: kubelet 재시작
sudo systemctl daemon-reload
sudo systemctl restart kubelet

# 7단계: 노드 uncordon
kubectl uncordon <control-plane-node>

# 8단계: 확인
kubectl get nodes
```

#### Worker Node 업그레이드

```bash
# Control Plane에서 실행: Worker Node drain
kubectl drain <worker-node> --ignore-daemonsets --delete-emptydir-data

# Worker Node에서 실행:
# 1단계: kubeadm 업그레이드
sudo apt-mark unhold kubeadm
sudo apt-get update
sudo apt-get install -y kubeadm=1.31.0-1.1
sudo apt-mark hold kubeadm

# 2단계: 노드 설정 업그레이드
sudo kubeadm upgrade node

# 3단계: kubelet, kubectl 업그레이드
sudo apt-mark unhold kubelet kubectl
sudo apt-get install -y kubelet=1.31.0-1.1 kubectl=1.31.0-1.1
sudo apt-mark hold kubelet kubectl

# 4단계: kubelet 재시작
sudo systemctl daemon-reload
sudo systemctl restart kubelet

# Control Plane에서 실행: 노드 uncordon
kubectl uncordon <worker-node>
```

---

### 1.3 etcd 백업과 복구

#### etcd 백업

```bash
# etcd Pod에서 인증서 경로 확인
kubectl -n kube-system describe pod etcd-controlplane | grep -A5 "Command"

# 백업 수행
ETCDCTL_API=3 etcdctl snapshot save /opt/etcd-backup.db \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key

# 백업 검증
ETCDCTL_API=3 etcdctl snapshot status /opt/etcd-backup.db --write-out=table
```

출력 예시:
```
+----------+----------+------------+------------+
|   HASH   | REVISION | TOTAL KEYS | TOTAL SIZE |
+----------+----------+------------+------------+
| fe01cf57 |       10 |         13 |     2.1 MB |
+----------+----------+------------+------------+
```

#### etcd 복구

```bash
# 1단계: etcd 복구 (새 데이터 디렉터리로)
ETCDCTL_API=3 etcdctl snapshot restore /opt/etcd-backup.db \
  --data-dir=/var/lib/etcd-restored

# 2단계: etcd 매니페스트 수정
# /etc/kubernetes/manifests/etcd.yaml에서 hostPath 수정
```

etcd.yaml 수정 부분:
```yaml
# 변경 전
  volumes:
  - hostPath:
      path: /var/lib/etcd
      type: DirectoryOrCreate
    name: etcd-data

# 변경 후
  volumes:
  - hostPath:
      path: /var/lib/etcd-restored
      type: DirectoryOrCreate
    name: etcd-data
```

```bash
# 3단계: etcd Pod가 재시작될 때까지 대기
# Static Pod이므로 매니페스트 변경 후 자동으로 재시작된다
watch crictl ps | grep etcd

# 4단계: 정상 동작 확인
kubectl get pods -A
```

---

### 1.4 RBAC 설정

#### kubectl 명령어로 생성

```bash
# Role 생성 (네임스페이스 범위)
kubectl create role pod-reader \
  --verb=get,list,watch \
  --resource=pods \
  -n development

# ClusterRole 생성 (클러스터 범위)
kubectl create clusterrole node-reader \
  --verb=get,list,watch \
  --resource=nodes

# RoleBinding 생성
kubectl create rolebinding pod-reader-binding \
  --role=pod-reader \
  --user=jane \
  -n development

# ClusterRoleBinding 생성
kubectl create clusterrolebinding node-reader-binding \
  --clusterrole=node-reader \
  --user=jane

# ServiceAccount에 바인딩
kubectl create rolebinding sa-binding \
  --role=pod-reader \
  --serviceaccount=development:my-sa \
  -n development

# 그룹에 바인딩
kubectl create clusterrolebinding dev-group-binding \
  --clusterrole=edit \
  --group=developers
```

#### YAML로 생성

**Role:**
```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: pod-manager
  namespace: development
rules:
- apiGroups: [""]              # core API group
  resources: ["pods"]
  verbs: ["get", "list", "watch", "create", "delete"]
- apiGroups: [""]
  resources: ["pods/log"]      # 서브리소스
  verbs: ["get"]
- apiGroups: ["apps"]
  resources: ["deployments"]
  verbs: ["get", "list", "create", "update", "patch"]
```

**ClusterRole:**
```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: secret-reader
rules:
- apiGroups: [""]
  resources: ["secrets"]
  verbs: ["get", "list", "watch"]
- apiGroups: [""]
  resources: ["namespaces"]
  verbs: ["get", "list"]
```

**RoleBinding:**
```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: pod-manager-binding
  namespace: development
subjects:
- kind: User
  name: jane
  apiGroup: rbac.authorization.k8s.io
- kind: ServiceAccount
  name: deploy-bot
  namespace: development
roleRef:
  kind: Role
  name: pod-manager
  apiGroup: rbac.authorization.k8s.io
```

**ClusterRoleBinding:**
```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: secret-reader-global
subjects:
- kind: Group
  name: auditors
  apiGroup: rbac.authorization.k8s.io
roleRef:
  kind: ClusterRole
  name: secret-reader
  apiGroup: rbac.authorization.k8s.io
```

#### 권한 확인

```bash
# 현재 사용자의 권한 확인
kubectl auth can-i create pods
kubectl auth can-i delete deployments -n production

# 특정 사용자의 권한 확인
kubectl auth can-i get pods --as=jane -n development
kubectl auth can-i list nodes --as=jane

# ServiceAccount의 권한 확인
kubectl auth can-i get secrets --as=system:serviceaccount:development:my-sa -n development

# 모든 권한 확인
kubectl auth can-i --list --as=jane -n development
```

#### ServiceAccount 생성

```bash
# ServiceAccount 생성
kubectl create serviceaccount my-sa -n development

# Pod에서 ServiceAccount 사용
kubectl run my-pod --image=nginx --serviceaccount=my-sa -n development --dry-run=client -o yaml
```

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: my-pod
  namespace: development
spec:
  serviceAccountName: my-sa
  automountServiceAccountToken: true
  containers:
  - name: app
    image: nginx
```

---

## 2. 워크로드 관리

### 2.1 Deployment 생성 및 관리

#### 생성

```bash
# 명령어로 생성
kubectl create deployment nginx-deploy \
  --image=nginx:1.24 \
  --replicas=3 \
  --dry-run=client -o yaml > nginx-deploy.yaml

# 적용
kubectl apply -f nginx-deploy.yaml
```

**YAML:**
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nginx-deploy
  labels:
    app: nginx
spec:
  replicas: 3
  selector:
    matchLabels:
      app: nginx
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  template:
    metadata:
      labels:
        app: nginx
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
            cpu: "200m"
            memory: "256Mi"
        readinessProbe:
          httpGet:
            path: /
            port: 80
          initialDelaySeconds: 5
          periodSeconds: 10
        livenessProbe:
          httpGet:
            path: /
            port: 80
          initialDelaySeconds: 15
          periodSeconds: 20
```

#### Rolling Update 및 Rollback

```bash
# 이미지 업데이트 (Rolling Update 트리거)
kubectl set image deployment/nginx-deploy nginx=nginx:1.25

# 또는 edit으로 수정
kubectl edit deployment nginx-deploy

# 배포 상태 확인
kubectl rollout status deployment/nginx-deploy

# 배포 이력 확인
kubectl rollout history deployment/nginx-deploy

# 특정 리비전 상세 확인
kubectl rollout history deployment/nginx-deploy --revision=2

# 이전 버전으로 롤백
kubectl rollout undo deployment/nginx-deploy

# 특정 리비전으로 롤백
kubectl rollout undo deployment/nginx-deploy --to-revision=1

# 스케일링
kubectl scale deployment nginx-deploy --replicas=5

# 배포 일시 정지/재개 (여러 변경을 한 번에 적용할 때)
kubectl rollout pause deployment/nginx-deploy
kubectl set image deployment/nginx-deploy nginx=nginx:1.25
kubectl set resources deployment/nginx-deploy -c=nginx --limits=cpu=200m,memory=512Mi
kubectl rollout resume deployment/nginx-deploy
```

---

### 2.2 nodeSelector 예제

```bash
# 노드에 레이블 추가
kubectl label nodes worker-1 disktype=ssd
kubectl label nodes worker-2 disktype=hdd

# 레이블 확인
kubectl get nodes --show-labels
kubectl get nodes -L disktype
```

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: ssd-pod
spec:
  nodeSelector:
    disktype: ssd
  containers:
  - name: nginx
    image: nginx
```

---

### 2.3 Node Affinity 예제

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: zone-aware-deploy
spec:
  replicas: 3
  selector:
    matchLabels:
      app: zone-aware
  template:
    metadata:
      labels:
        app: zone-aware
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
          - weight: 70
            preference:
              matchExpressions:
              - key: zone
                operator: In
                values:
                - zone-a
          - weight: 30
            preference:
              matchExpressions:
              - key: zone
                operator: In
                values:
                - zone-b
      containers:
      - name: app
        image: nginx
```

---

### 2.4 Pod Anti-Affinity 예제 (고가용성)

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ha-web
spec:
  replicas: 3
  selector:
    matchLabels:
      app: ha-web
  template:
    metadata:
      labels:
        app: ha-web
    spec:
      affinity:
        podAntiAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
          - labelSelector:
              matchExpressions:
              - key: app
                operator: In
                values:
                - ha-web
            topologyKey: kubernetes.io/hostname
      containers:
      - name: web
        image: nginx
```

이 설정은 같은 Deployment의 Pod가 서로 다른 노드에 분산되도록 강제한다. 노드가 3개 미만이면 일부 Pod가 Pending 상태가 된다.

---

### 2.5 Taint와 Toleration 예제

```bash
# Taint 추가
kubectl taint nodes worker-1 dedicated=gpu:NoSchedule
kubectl taint nodes worker-2 environment=production:NoExecute

# Taint 확인
kubectl describe node worker-1 | grep -i taint

# Taint 제거
kubectl taint nodes worker-1 dedicated=gpu:NoSchedule-
```

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: gpu-pod
spec:
  tolerations:
  - key: "dedicated"
    operator: "Equal"
    value: "gpu"
    effect: "NoSchedule"
  containers:
  - name: gpu-app
    image: nvidia/cuda:12.0-base
  nodeSelector:
    dedicated: gpu
```

Toleration은 해당 Taint가 있는 노드에 스케줄링을 "허용"할 뿐, 반드시 그 노드로 가는 것은 아니다. 특정 노드에만 배치하려면 `nodeSelector`나 `nodeAffinity`와 함께 사용해야 한다.

---

### 2.6 DaemonSet 예제

```yaml
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
      tolerations:
      - key: node-role.kubernetes.io/control-plane
        operator: Exists
        effect: NoSchedule
      containers:
      - name: fluentd
        image: fluentd:v1.16
        volumeMounts:
        - name: varlog
          mountPath: /var/log
          readOnly: true
      volumes:
      - name: varlog
        hostPath:
          path: /var/log
```

---

### 2.7 Job과 CronJob 예제

**Job:**
```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: pi-calculator
spec:
  completions: 5        # 총 5번 성공해야 완료
  parallelism: 2        # 동시에 2개씩 실행
  backoffLimit: 4        # 최대 4번 재시도
  activeDeadlineSeconds: 300  # 최대 5분
  template:
    spec:
      restartPolicy: Never
      containers:
      - name: pi
        image: perl:5.34
        command: ["perl", "-Mbignum=bpi", "-wle", "print bpi(2000)"]
```

```bash
# Job 상태 확인
kubectl get jobs
kubectl describe job pi-calculator

# Job이 생성한 Pod 확인
kubectl get pods --selector=job-name=pi-calculator
```

**CronJob:**
```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: db-backup
spec:
  schedule: "0 2 * * *"         # 매일 새벽 2시
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 1
  concurrencyPolicy: Forbid      # 이전 Job이 실행 중이면 새 Job을 생성하지 않음
  startingDeadlineSeconds: 200
  jobTemplate:
    spec:
      template:
        spec:
          restartPolicy: OnFailure
          containers:
          - name: backup
            image: mysql:8.0
            command:
            - /bin/sh
            - -c
            - "mysqldump -h mysql-svc -u root -p$MYSQL_PASSWORD mydb > /backup/dump.sql"
            envFrom:
            - secretRef:
                name: mysql-secret
```

크론 표현식: `분(0-59) 시(0-23) 일(1-31) 월(1-12) 요일(0-6, 0=일)`

---

### 2.8 Static Pod 생성

```bash
# Static Pod 매니페스트 경로 확인
cat /var/lib/kubelet/config.yaml | grep staticPodPath
# 출력: staticPodPath: /etc/kubernetes/manifests

# Static Pod 생성
cat <<EOF > /etc/kubernetes/manifests/static-nginx.yaml
apiVersion: v1
kind: Pod
metadata:
  name: static-nginx
  labels:
    role: static
spec:
  containers:
  - name: nginx
    image: nginx:1.24
    ports:
    - containerPort: 80
EOF

# 확인 (노드 이름이 접미사로 붙음)
kubectl get pods
# static-nginx-<node-name>

# 삭제 (매니페스트 파일 삭제)
rm /etc/kubernetes/manifests/static-nginx.yaml
```

---

### 2.9 Multi-Container Pod (Sidecar 패턴)

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: multi-container-pod
spec:
  containers:
  - name: app
    image: nginx
    volumeMounts:
    - name: shared-logs
      mountPath: /var/log/nginx
  - name: log-sidecar
    image: busybox:1.36
    command: ["/bin/sh", "-c", "tail -f /var/log/nginx/access.log"]
    volumeMounts:
    - name: shared-logs
      mountPath: /var/log/nginx
      readOnly: true
  volumes:
  - name: shared-logs
    emptyDir: {}
```

---

### 2.10 Init Container 예제

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: init-pod
spec:
  initContainers:
  - name: wait-for-service
    image: busybox:1.36
    command: ['sh', '-c', 'until nslookup my-service.default.svc.cluster.local; do echo waiting; sleep 2; done']
  - name: init-db
    image: busybox:1.36
    command: ['sh', '-c', 'echo "DB initialized" > /work-dir/init-status']
    volumeMounts:
    - name: workdir
      mountPath: /work-dir
  containers:
  - name: app
    image: nginx
    volumeMounts:
    - name: workdir
      mountPath: /app/data
  volumes:
  - name: workdir
    emptyDir: {}
```

Init Container는 순서대로 실행되며, 모든 Init Container가 성공해야 메인 컨테이너가 시작된다.

---

## 3. 서비스 및 네트워킹

### 3.1 Service 생성

```bash
# ClusterIP Service (기본)
kubectl expose deployment nginx-deploy --port=80 --target-port=80 --name=nginx-svc

# NodePort Service
kubectl expose deployment nginx-deploy --port=80 --target-port=80 \
  --type=NodePort --name=nginx-nodeport

# 특정 NodePort 지정 (YAML 필요)
kubectl create service nodeport nginx-np --tcp=80:80 --node-port=30080 \
  --dry-run=client -o yaml > nodeport-svc.yaml

# Service 확인
kubectl get svc
kubectl describe svc nginx-svc
kubectl get endpoints nginx-svc
```

**ClusterIP YAML:**
```yaml
apiVersion: v1
kind: Service
metadata:
  name: nginx-svc
spec:
  type: ClusterIP
  selector:
    app: nginx
  ports:
  - name: http
    port: 80
    targetPort: 80
    protocol: TCP
```

**NodePort YAML:**
```yaml
apiVersion: v1
kind: Service
metadata:
  name: nginx-nodeport
spec:
  type: NodePort
  selector:
    app: nginx
  ports:
  - name: http
    port: 80
    targetPort: 80
    nodePort: 30080
    protocol: TCP
```

**Headless Service YAML:**
```yaml
apiVersion: v1
kind: Service
metadata:
  name: nginx-headless
spec:
  clusterIP: None
  selector:
    app: nginx
  ports:
  - port: 80
    targetPort: 80
```

---

### 3.2 Ingress 예제

#### Path-based Routing

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: app-ingress
  annotations:
    nginx.ingress.kubernetes.io/rewrite-target: /$2
spec:
  ingressClassName: nginx
  rules:
  - host: myapp.example.com
    http:
      paths:
      - path: /api(/|$)(.*)
        pathType: ImplementationSpecific
        backend:
          service:
            name: api-service
            port:
              number: 8080
      - path: /web(/|$)(.*)
        pathType: ImplementationSpecific
        backend:
          service:
            name: web-service
            port:
              number: 80
```

#### 단순 Path Routing (rewrite 없이)

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: simple-ingress
spec:
  ingressClassName: nginx
  rules:
  - host: myapp.example.com
    http:
      paths:
      - path: /api
        pathType: Prefix
        backend:
          service:
            name: api-service
            port:
              number: 8080
      - path: /
        pathType: Prefix
        backend:
          service:
            name: web-service
            port:
              number: 80
```

#### Default Backend

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: default-backend-ingress
spec:
  ingressClassName: nginx
  defaultBackend:
    service:
      name: default-service
      port:
        number: 80
  rules:
  - host: myapp.example.com
    http:
      paths:
      - path: /api
        pathType: Prefix
        backend:
          service:
            name: api-service
            port:
              number: 8080
```

#### TLS Ingress

```bash
# TLS Secret 생성
kubectl create secret tls tls-secret \
  --cert=tls.crt \
  --key=tls.key
```

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: tls-ingress
spec:
  ingressClassName: nginx
  tls:
  - hosts:
    - myapp.example.com
    secretName: tls-secret
  rules:
  - host: myapp.example.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: web-service
            port:
              number: 80
```

```bash
# Ingress 확인
kubectl get ingress
kubectl describe ingress app-ingress
```

---

### 3.3 NetworkPolicy 예제

#### Default Deny All (Ingress)

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-ingress
  namespace: production
spec:
  podSelector: {}
  policyTypes:
  - Ingress
```

#### Default Deny All (Ingress + Egress)

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
  namespace: production
spec:
  podSelector: {}
  policyTypes:
  - Ingress
  - Egress
```

#### 특정 Pod에서 오는 Ingress만 허용

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-frontend-to-backend
  namespace: production
spec:
  podSelector:
    matchLabels:
      tier: backend
  policyTypes:
  - Ingress
  ingress:
  - from:
    - podSelector:
        matchLabels:
          tier: frontend
    ports:
    - protocol: TCP
      port: 8080
```

#### 특정 네임스페이스에서 오는 트래픽 허용

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-from-monitoring
  namespace: production
spec:
  podSelector:
    matchLabels:
      app: web
  policyTypes:
  - Ingress
  ingress:
  - from:
    - namespaceSelector:
        matchLabels:
          purpose: monitoring
    ports:
    - protocol: TCP
      port: 9090
```

#### Egress 정책 (DNS 허용 포함)

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: backend-egress
  namespace: production
spec:
  podSelector:
    matchLabels:
      tier: backend
  policyTypes:
  - Egress
  egress:
  # DNS 허용 (필수! 그렇지 않으면 서비스 이름 해석 불가)
  - to: []
    ports:
    - protocol: UDP
      port: 53
    - protocol: TCP
      port: 53
  # 데이터베이스 접근 허용
  - to:
    - podSelector:
        matchLabels:
          tier: database
    ports:
    - protocol: TCP
      port: 3306
```

Egress 정책을 설정할 때 **DNS(포트 53)**를 허용하지 않으면 서비스 이름을 해석할 수 없으므로 주의해야 한다.

#### AND 조건과 OR 조건 비교

```yaml
# OR 조건: frontend Pod 또는 monitoring 네임스페이스의 모든 Pod 허용
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: or-example
spec:
  podSelector:
    matchLabels:
      app: backend
  policyTypes:
  - Ingress
  ingress:
  - from:
    - podSelector:           # 규칙 1
        matchLabels:
          app: frontend
    - namespaceSelector:     # 규칙 2
        matchLabels:
          team: monitoring
    ports:
    - protocol: TCP
      port: 8080
---
# AND 조건: monitoring 네임스페이스의 frontend Pod만 허용
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: and-example
spec:
  podSelector:
    matchLabels:
      app: backend
  policyTypes:
  - Ingress
  ingress:
  - from:
    - podSelector:           # 하나의 규칙에 두 조건
        matchLabels:
          app: frontend
      namespaceSelector:
        matchLabels:
          team: monitoring
    ports:
    - protocol: TCP
      port: 8080
```

---

## 4. 스토리지

### 4.1 PV / PVC / Pod 연동

**PersistentVolume:**
```yaml
apiVersion: v1
kind: PersistentVolume
metadata:
  name: task-pv
  labels:
    type: local
spec:
  capacity:
    storage: 10Gi
  accessModes:
  - ReadWriteOnce
  persistentVolumeReclaimPolicy: Retain
  storageClassName: manual
  hostPath:
    path: /mnt/data
```

**PersistentVolumeClaim:**
```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: task-pvc
spec:
  accessModes:
  - ReadWriteOnce
  resources:
    requests:
      storage: 5Gi
  storageClassName: manual
```

**Pod:**
```yaml
apiVersion: v1
kind: Pod
metadata:
  name: task-pod
spec:
  containers:
  - name: app
    image: nginx
    volumeMounts:
    - name: task-volume
      mountPath: /usr/share/nginx/html
  volumes:
  - name: task-volume
    persistentVolumeClaim:
      claimName: task-pvc
```

```bash
# PV/PVC 상태 확인
kubectl get pv
kubectl get pvc
kubectl describe pv task-pv
kubectl describe pvc task-pvc
```

---

### 4.2 StorageClass와 Dynamic Provisioning

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: fast
  annotations:
    storageclass.kubernetes.io/is-default-class: "true"
provisioner: kubernetes.io/no-provisioner   # 로컬 테스트용
reclaimPolicy: Delete
volumeBindingMode: WaitForFirstConsumer
allowVolumeExpansion: true
```

Dynamic Provisioning PVC (StorageClass 사용):
```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: dynamic-pvc
spec:
  accessModes:
  - ReadWriteOnce
  resources:
    requests:
      storage: 20Gi
  storageClassName: fast
```

StorageClass가 지정되지 않으면(`storageClassName` 필드 없음) 기본(default) StorageClass가 사용된다. 빈 문자열(`storageClassName: ""`)을 지정하면 Dynamic Provisioning을 사용하지 않고 수동으로 PV를 바인딩해야 한다.

---

### 4.3 StatefulSet with volumeClaimTemplates

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: mysql
spec:
  serviceName: mysql-headless
  replicas: 3
  selector:
    matchLabels:
      app: mysql
  template:
    metadata:
      labels:
        app: mysql
    spec:
      containers:
      - name: mysql
        image: mysql:8.0
        ports:
        - containerPort: 3306
        env:
        - name: MYSQL_ROOT_PASSWORD
          valueFrom:
            secretKeyRef:
              name: mysql-secret
              key: password
        volumeMounts:
        - name: data
          mountPath: /var/lib/mysql
  volumeClaimTemplates:
  - metadata:
      name: data
    spec:
      accessModes:
      - ReadWriteOnce
      resources:
        requests:
          storage: 10Gi
      storageClassName: fast
---
apiVersion: v1
kind: Service
metadata:
  name: mysql-headless
spec:
  clusterIP: None
  selector:
    app: mysql
  ports:
  - port: 3306
    targetPort: 3306
```

각 Pod(mysql-0, mysql-1, mysql-2)에 대해 별도의 PVC(data-mysql-0, data-mysql-1, data-mysql-2)가 자동 생성된다.

---

## 5. 트러블슈팅 명령어 치트시트

### 5.1 클러스터 상태 확인

```bash
# 노드 상태
kubectl get nodes -o wide
kubectl describe node <node-name>
kubectl top nodes                          # 리소스 사용량 (metrics-server 필요)

# 클러스터 정보
kubectl cluster-info
kubectl cluster-info dump

# 컴포넌트 상태 (deprecated이지만 참고용)
kubectl get componentstatuses

# 모든 네임스페이스의 Pod
kubectl get pods -A -o wide

# 이벤트 확인
kubectl get events --sort-by='.lastTimestamp'
kubectl get events -A --sort-by='.lastTimestamp'
kubectl get events --field-selector reason=Failed
```

### 5.2 Pod 디버깅

```bash
# Pod 상태 확인
kubectl get pods -o wide
kubectl describe pod <pod-name>

# Pod 로그
kubectl logs <pod-name>
kubectl logs <pod-name> -c <container-name>    # 멀티 컨테이너
kubectl logs <pod-name> --previous             # 이전 컨테이너
kubectl logs <pod-name> -f                     # 실시간
kubectl logs <pod-name> --tail=50              # 최근 50줄
kubectl logs <pod-name> --since=1h             # 최근 1시간

# Pod 내부 접속
kubectl exec -it <pod-name> -- /bin/sh
kubectl exec -it <pod-name> -c <container-name> -- /bin/bash

# 임시 디버깅 Pod
kubectl run debug --image=busybox:1.36 --rm -it --restart=Never -- /bin/sh
kubectl run debug --image=nicolaka/netshoot --rm -it --restart=Never -- /bin/bash

# Pod 리소스 사용량
kubectl top pods
kubectl top pods -A --sort-by=memory
```

### 5.3 서비스/네트워크 디버깅

```bash
# Service 확인
kubectl get svc -o wide
kubectl describe svc <service-name>
kubectl get endpoints <service-name>

# DNS 테스트
kubectl run dns-test --image=busybox:1.28 --rm -it --restart=Never -- \
  nslookup <service-name>.<namespace>.svc.cluster.local

kubectl run dns-test --image=busybox:1.28 --rm -it --restart=Never -- \
  nslookup kubernetes.default

# 연결 테스트
kubectl run curl-test --image=curlimages/curl --rm -it --restart=Never -- \
  curl -s http://<service-name>:<port>

# CoreDNS 확인
kubectl -n kube-system get pods -l k8s-app=kube-dns
kubectl -n kube-system logs -l k8s-app=kube-dns
kubectl -n kube-system get configmap coredns -o yaml

# kube-proxy 확인
kubectl -n kube-system get pods -l k8s-app=kube-proxy
kubectl -n kube-system logs -l k8s-app=kube-proxy
```

### 5.4 노드 디버깅 (노드에 SSH 접속 후)

```bash
# kubelet 상태
systemctl status kubelet
systemctl restart kubelet
journalctl -u kubelet -f
journalctl -u kubelet --since "5 minutes ago" --no-pager

# containerd 상태
systemctl status containerd
systemctl restart containerd

# 컨테이너 확인 (crictl)
crictl ps
crictl ps -a
crictl pods
crictl logs <container-id>
crictl inspect <container-id>

# Control Plane 컴포넌트 확인 (Static Pod)
ls /etc/kubernetes/manifests/
crictl ps | grep -E "apiserver|scheduler|controller|etcd"

# 디스크/메모리 확인
df -h
free -m

# 네트워크 확인
ip addr
ip route
ss -tlnp
```

### 5.5 인증서 확인

```bash
# kubeadm으로 설치된 클러스터의 인증서 만료일 확인
kubeadm certs check-expiration

# 개별 인증서 확인
openssl x509 -in /etc/kubernetes/pki/apiserver.crt -noout -dates
openssl x509 -in /etc/kubernetes/pki/apiserver.crt -noout -subject -issuer

# 인증서 갱신
kubeadm certs renew all
# 갱신 후 Static Pod를 재시작해야 한다
```

---

## 6. 시험 필수 kubectl 명령어 모음

### 6.1 빠른 리소스 생성 (Imperative)

```bash
# Pod 생성
kubectl run nginx --image=nginx

# Pod 생성 (YAML 생성만)
kubectl run nginx --image=nginx --dry-run=client -o yaml > pod.yaml

# Pod 생성 (포트, 레이블, 명령어 포함)
kubectl run nginx --image=nginx --port=80 --labels="app=web,tier=frontend"
kubectl run busybox --image=busybox --restart=Never --command -- sleep 3600

# Deployment 생성
kubectl create deployment nginx-deploy --image=nginx --replicas=3

# Service 생성
kubectl expose pod nginx --port=80 --target-port=80 --name=nginx-svc
kubectl expose deployment nginx-deploy --port=80 --type=NodePort

# ConfigMap 생성
kubectl create configmap my-config \
  --from-literal=key1=value1 \
  --from-literal=key2=value2
kubectl create configmap my-config --from-file=config.txt
kubectl create configmap my-config --from-file=my-dir/

# Secret 생성
kubectl create secret generic my-secret \
  --from-literal=username=admin \
  --from-literal=password=secret123
kubectl create secret generic my-secret --from-file=ssh-key=id_rsa

# Namespace 생성
kubectl create namespace development

# ServiceAccount 생성
kubectl create serviceaccount my-sa -n development

# Job 생성
kubectl create job my-job --image=busybox -- echo "Hello"

# CronJob 생성
kubectl create cronjob my-cron --image=busybox --schedule="*/5 * * * *" -- echo "Hello"
```

### 6.2 YAML 생성 패턴 (--dry-run=client -o yaml)

```bash
# 거의 모든 create/run 명령에 --dry-run=client -o yaml을 추가하면 YAML을 얻을 수 있다
kubectl run nginx --image=nginx --dry-run=client -o yaml > pod.yaml
kubectl create deployment web --image=nginx --replicas=3 --dry-run=client -o yaml > deploy.yaml
kubectl expose deployment web --port=80 --type=NodePort --dry-run=client -o yaml > svc.yaml
kubectl create role my-role --verb=get,list --resource=pods --dry-run=client -o yaml > role.yaml
kubectl create rolebinding my-rb --role=my-role --user=jane --dry-run=client -o yaml > rb.yaml
kubectl create job my-job --image=busybox --dry-run=client -o yaml > job.yaml
kubectl create cronjob my-cron --image=busybox --schedule="0 * * * *" --dry-run=client -o yaml > cron.yaml
```

### 6.3 리소스 조회 및 필터링

```bash
# 출력 형식
kubectl get pods -o wide                    # 추가 정보 (노드, IP)
kubectl get pods -o yaml                    # 전체 YAML
kubectl get pods -o json                    # 전체 JSON
kubectl get pods -o name                    # 이름만
kubectl get pod nginx -o jsonpath='{.status.podIP}'  # 특정 필드

# 레이블 필터링
kubectl get pods -l app=nginx
kubectl get pods -l 'app in (nginx, web)'
kubectl get pods -l app!=nginx
kubectl get pods --show-labels

# 필드 셀렉터
kubectl get pods --field-selector status.phase=Running
kubectl get pods --field-selector spec.nodeName=worker-1
kubectl get events --field-selector reason=Failed

# 모든 리소스 조회
kubectl get all -n development
kubectl api-resources                        # 사용 가능한 모든 리소스 타입
kubectl api-resources --namespaced=true      # 네임스페이스 범위 리소스만
kubectl api-resources --namespaced=false     # 클러스터 범위 리소스만
```

### 6.4 리소스 필드 확인 (kubectl explain)

```bash
# 리소스 구조 확인 (시험 중 YAML 필드명을 모를 때 필수)
kubectl explain pod
kubectl explain pod.spec
kubectl explain pod.spec.containers
kubectl explain pod.spec.containers.resources
kubectl explain pod.spec.affinity.nodeAffinity
kubectl explain deployment.spec.strategy

# 재귀적으로 모든 필드 표시
kubectl explain pod.spec --recursive
kubectl explain deployment.spec.strategy --recursive

# 특정 API 버전 지정
kubectl explain ingress --api-version=networking.k8s.io/v1
```

`kubectl explain`은 시험 중 가장 유용한 명령어 중 하나이다. YAML 필드명이 기억나지 않을 때 빠르게 확인할 수 있다.

### 6.5 레이블/어노테이션 관리

```bash
# 레이블 추가/수정
kubectl label pods nginx env=production
kubectl label pods nginx env=staging --overwrite
kubectl label nodes worker-1 disktype=ssd

# 레이블 삭제
kubectl label pods nginx env-

# 어노테이션 추가/수정
kubectl annotate pods nginx description="My nginx pod"

# 어노테이션 삭제
kubectl annotate pods nginx description-
```

### 6.6 기타 유용한 명령어

```bash
# 리소스 수정
kubectl edit deployment nginx-deploy
kubectl patch deployment nginx-deploy -p '{"spec":{"replicas":5}}'
kubectl replace -f deployment.yaml --force   # 강제 교체

# 리소스 삭제
kubectl delete pod nginx
kubectl delete pod nginx --grace-period=0 --force  # 즉시 삭제
kubectl delete pods -l app=old
kubectl delete all --all -n test                   # 네임스페이스의 모든 리소스

# 정렬
kubectl get pods --sort-by='.metadata.creationTimestamp'
kubectl get pods --sort-by='.status.containerStatuses[0].restartCount'
kubectl top pods --sort-by=cpu
kubectl top pods --sort-by=memory

# 특정 컬럼만 출력
kubectl get pods -o custom-columns=NAME:.metadata.name,STATUS:.status.phase,NODE:.spec.nodeName

# JSONPath
kubectl get nodes -o jsonpath='{.items[*].metadata.name}'
kubectl get pods -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.status.phase}{"\n"}{end}'
kubectl get nodes -o jsonpath='{.items[*].status.addresses[?(@.type=="InternalIP")].address}'
```

---

## 시험 시작 시 설정

시험을 시작하면 다음을 먼저 실행하는 것을 권장한다:

```bash
# vim 설정 (YAML 편집용)
echo 'set tabstop=2 shiftwidth=2 expandtab' >> ~/.vimrc

# kubectl 자동 완성 (보통 이미 설정되어 있음)
source <(kubectl completion bash)

# 별칭 설정 (보통 이미 설정되어 있음, 없으면 추가)
alias k=kubectl
complete -o default -F __start_kubectl k

# 자주 사용하는 변수 (선택)
export do="--dry-run=client -o yaml"
# 사용: kubectl run nginx --image=nginx $do > pod.yaml
```
