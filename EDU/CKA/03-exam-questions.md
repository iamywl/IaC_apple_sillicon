# CKA 모의 실기 문제

> 총 40문제이다. 실제 CKA 시험과 동일하게 **터미널에서 직접 명령어를 입력하여** 문제를 해결해야 한다. 각 문제에서 `kubectl config use-context` 명령이 주어지면 반드시 먼저 실행한 후 풀어야 한다.

---

## Cluster Architecture, Installation & Configuration

### 문제 1. [클러스터 설치] kubeadm으로 Worker Node 조인

`kubectl config use-context k8s-cluster1`

클러스터 `k8s-cluster1`에 새로운 Worker Node `worker-3`을 추가해야 한다.
- Control Plane 노드에서 조인 토큰을 생성하라.
- `worker-3` 노드에 SSH 접속하여 클러스터에 조인하라.
- 노드가 `Ready` 상태인지 확인하라.

<details>
<summary>풀이 확인</summary>

**풀이:**

```bash
# Control Plane에서 조인 명령 생성
kubeadm token create --print-join-command
```

출력 예시:
```
kubeadm join 192.168.1.100:6443 --token abcdef.0123456789abcdef --discovery-token-ca-cert-hash sha256:abc123...
```

```bash
# worker-3에 SSH 접속
ssh worker-3

# 조인 명령 실행 (위에서 출력된 명령)
sudo kubeadm join 192.168.1.100:6443 \
  --token abcdef.0123456789abcdef \
  --discovery-token-ca-cert-hash sha256:abc123...

# Control Plane으로 돌아와서 확인
exit
kubectl get nodes
```

`kubeadm token create --print-join-command`는 토큰 생성과 조인 명령 출력을 동시에 수행한다. 이 명령 하나로 Worker Node에서 실행할 전체 명령을 얻을 수 있다.

</details>

---

### 문제 2. [클러스터 업그레이드] Control Plane 업그레이드

`kubectl config use-context k8s-upgrade`

Control Plane 노드 `controlplane`의 쿠버네티스 버전을 `v1.30.0`에서 `v1.31.0`으로 업그레이드하라.
- kubeadm, kubelet, kubectl을 모두 업그레이드하라.
- 업그레이드 중 워크로드에 영향을 최소화하라.

<details>
<summary>풀이 확인</summary>

**풀이:**

```bash
# 1. kubeadm 업그레이드
sudo apt-mark unhold kubeadm
sudo apt-get update
sudo apt-get install -y kubeadm=1.31.0-1.1
sudo apt-mark hold kubeadm

# 2. 업그레이드 계획 확인
sudo kubeadm upgrade plan

# 3. Control Plane 컴포넌트 업그레이드
sudo kubeadm upgrade apply v1.31.0

# 4. 노드 drain
kubectl drain controlplane --ignore-daemonsets --delete-emptydir-data

# 5. kubelet, kubectl 업그레이드
sudo apt-mark unhold kubelet kubectl
sudo apt-get install -y kubelet=1.31.0-1.1 kubectl=1.31.0-1.1
sudo apt-mark hold kubelet kubectl

# 6. kubelet 재시작
sudo systemctl daemon-reload
sudo systemctl restart kubelet

# 7. 노드 uncordon
kubectl uncordon controlplane

# 8. 확인
kubectl get nodes
```

업그레이드 순서가 중요하다: kubeadm 먼저 → upgrade apply → drain → kubelet/kubectl 업그레이드 → restart → uncordon 순서이다.

</details>

---

### 문제 3. [클러스터 업그레이드] Worker Node 업그레이드

`kubectl config use-context k8s-upgrade`

Worker Node `worker-1`의 쿠버네티스 버전을 `v1.30.0`에서 `v1.31.0`으로 업그레이드하라.

<details>
<summary>풀이 확인</summary>

**풀이:**

```bash
# Control Plane에서: 노드 drain
kubectl drain worker-1 --ignore-daemonsets --delete-emptydir-data

# worker-1에 SSH 접속
ssh worker-1

# 1. kubeadm 업그레이드
sudo apt-mark unhold kubeadm
sudo apt-get update
sudo apt-get install -y kubeadm=1.31.0-1.1
sudo apt-mark hold kubeadm

# 2. 노드 설정 업그레이드
sudo kubeadm upgrade node

# 3. kubelet, kubectl 업그레이드
sudo apt-mark unhold kubelet kubectl
sudo apt-get install -y kubelet=1.31.0-1.1 kubectl=1.31.0-1.1
sudo apt-mark hold kubelet kubectl

# 4. kubelet 재시작
sudo systemctl daemon-reload
sudo systemctl restart kubelet

# Control Plane으로 돌아와서 uncordon
exit
kubectl uncordon worker-1

# 확인
kubectl get nodes
```

Worker Node 업그레이드 시에는 `kubeadm upgrade apply` 대신 `kubeadm upgrade node`를 사용한다.

</details>

---

### 문제 4. [etcd 백업] etcd 스냅샷 생성

`kubectl config use-context k8s-cluster1`

etcd 데이터베이스의 스냅샷을 `/opt/etcd-backup-$(date +%Y%m%d).db` 경로에 저장하라. etcd는 `https://127.0.0.1:2379`에서 실행 중이다.

<details>
<summary>풀이 확인</summary>

**풀이:**

```bash
# etcd Pod에서 인증서 경로 확인
kubectl -n kube-system describe pod etcd-controlplane | grep -E "cert|key|cacert"

# 스냅샷 저장
ETCDCTL_API=3 etcdctl snapshot save /opt/etcd-backup-$(date +%Y%m%d).db \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key

# 검증
ETCDCTL_API=3 etcdctl snapshot status /opt/etcd-backup-$(date +%Y%m%d).db --write-out=table
```

인증서 경로가 기억나지 않으면 etcd Pod의 명령어 인자를 확인하면 된다. `kubectl -n kube-system get pod etcd-controlplane -o yaml`로 전체 스펙을 볼 수도 있다.

</details>

---

### 문제 5. [etcd 복구] etcd 스냅샷 복구

`kubectl config use-context k8s-cluster1`

`/opt/etcd-backup.db` 스냅샷 파일을 사용하여 etcd 데이터를 복구하라. 복구된 데이터 디렉터리는 `/var/lib/etcd-restored`를 사용하라.

<details>
<summary>풀이 확인</summary>

**풀이:**

```bash
# 1. 스냅샷 복구
ETCDCTL_API=3 etcdctl snapshot restore /opt/etcd-backup.db \
  --data-dir=/var/lib/etcd-restored

# 2. etcd 매니페스트 수정
sudo vi /etc/kubernetes/manifests/etcd.yaml
```

```yaml
# etcd.yaml에서 volumes 섹션의 etcd-data hostPath를 수정한다:
# 변경 전:
  volumes:
  - hostPath:
      path: /var/lib/etcd
      type: DirectoryOrCreate
    name: etcd-data

# 변경 후:
  volumes:
  - hostPath:
      path: /var/lib/etcd-restored
      type: DirectoryOrCreate
    name: etcd-data
```

```bash
# 3. etcd Pod가 재시작될 때까지 대기 (매니페스트 변경 시 자동 재시작)
watch crictl ps

# 4. 클러스터 정상 동작 확인
kubectl get pods -A
kubectl get nodes
```

`etcd.yaml` 매니페스트를 수정하면 kubelet이 변경을 감지하고 etcd Pod를 자동으로 재시작한다. 재시작에 1-2분 소요될 수 있다.

</details>

---

### 문제 6. [RBAC] Role과 RoleBinding 생성

`kubectl config use-context k8s-cluster1`

네임스페이스 `development`에서 다음 RBAC 설정을 수행하라:
- `developer-role`이라는 Role을 생성하여 pods와 deployments에 대해 get, list, create, update, delete 권한을 부여하라.
- `developer-binding`이라는 RoleBinding을 생성하여 사용자 `jane`에게 `developer-role`을 바인딩하라.

<details>
<summary>풀이 확인</summary>

**풀이:**

```bash
# 네임스페이스 생성 (없는 경우)
kubectl create namespace development

# Role 생성
kubectl create role developer-role \
  --verb=get,list,create,update,delete \
  --resource=pods,deployments \
  -n development

# RoleBinding 생성
kubectl create rolebinding developer-binding \
  --role=developer-role \
  --user=jane \
  -n development

# 확인
kubectl get role,rolebinding -n development
kubectl describe role developer-role -n development
kubectl describe rolebinding developer-binding -n development

# 권한 테스트
kubectl auth can-i create pods --as=jane -n development
kubectl auth can-i delete deployments --as=jane -n development
kubectl auth can-i create services --as=jane -n development  # 이것은 no여야 한다
```

</details>

---

### 문제 7. [RBAC] ClusterRole과 ClusterRoleBinding 생성

`kubectl config use-context k8s-cluster1`

- `node-viewer`라는 ClusterRole을 생성하여 nodes에 대해 get, list, watch 권한을 부여하라.
- `node-viewer-binding`이라는 ClusterRoleBinding을 생성하여 그룹 `ops-team`에게 `node-viewer`를 바인딩하라.

<details>
<summary>풀이 확인</summary>

**풀이:**

```bash
# ClusterRole 생성
kubectl create clusterrole node-viewer \
  --verb=get,list,watch \
  --resource=nodes

# ClusterRoleBinding 생성
kubectl create clusterrolebinding node-viewer-binding \
  --clusterrole=node-viewer \
  --group=ops-team

# 확인
kubectl describe clusterrole node-viewer
kubectl describe clusterrolebinding node-viewer-binding

# 권한 테스트
kubectl auth can-i list nodes --as-group=ops-team --as=test-user
```

</details>

---

### 문제 8. [RBAC] ServiceAccount 기반 RBAC

`kubectl config use-context k8s-cluster1`

네임스페이스 `monitoring`에서 다음을 수행하라:
- `monitoring-sa`라는 ServiceAccount를 생성하라.
- `pod-reader`라는 ClusterRole을 생성하여 모든 네임스페이스의 pods에 대해 get, list, watch 권한을 부여하라.
- `monitoring-sa`에 ClusterRoleBinding을 사용하여 `pod-reader` ClusterRole을 바인딩하라.
- `monitor-pod`라는 Pod를 생성하여 `monitoring-sa` ServiceAccount를 사용하고 `curlimages/curl` 이미지로 실행하라. 명령어는 `sleep 3600`이다.

<details>
<summary>풀이 확인</summary>

**풀이:**

```bash
# 네임스페이스 생성
kubectl create namespace monitoring

# ServiceAccount 생성
kubectl create serviceaccount monitoring-sa -n monitoring

# ClusterRole 생성
kubectl create clusterrole pod-reader \
  --verb=get,list,watch \
  --resource=pods

# ClusterRoleBinding 생성 (ServiceAccount에 바인딩)
kubectl create clusterrolebinding monitoring-sa-binding \
  --clusterrole=pod-reader \
  --serviceaccount=monitoring:monitoring-sa
```

```yaml
# Pod 생성
apiVersion: v1
kind: Pod
metadata:
  name: monitor-pod
  namespace: monitoring
spec:
  serviceAccountName: monitoring-sa
  containers:
  - name: curl
    image: curlimages/curl
    command: ["sleep", "3600"]
```

```bash
# 또는 명령어로 YAML 생성 후 수정
kubectl run monitor-pod -n monitoring \
  --image=curlimages/curl \
  --dry-run=client -o yaml --command -- sleep 3600 > monitor-pod.yaml

# monitor-pod.yaml에 serviceAccountName: monitoring-sa 추가 후 적용
kubectl apply -f monitor-pod.yaml

# 확인
kubectl get pod monitor-pod -n monitoring -o yaml | grep serviceAccountName
kubectl auth can-i list pods --as=system:serviceaccount:monitoring:monitoring-sa
kubectl auth can-i list pods --as=system:serviceaccount:monitoring:monitoring-sa -n kube-system
```

</details>

---

### 문제 9. [kubeconfig] 컨텍스트 관리

`kubectl config use-context k8s-cluster1`

다음 작업을 수행하라:
- 현재 클러스터에 대해 `dev-context`라는 새 컨텍스트를 생성하라. 사용자는 기존 `kubernetes-admin`을 사용하고, 기본 네임스페이스는 `development`로 설정하라.
- `dev-context`로 전환하라.
- 현재 컨텍스트가 `dev-context`인지 확인하라.

<details>
<summary>풀이 확인</summary>

**풀이:**

```bash
# 현재 설정 확인
kubectl config get-contexts
kubectl config view --minify

# 현재 클러스터명과 사용자명 확인
kubectl config view --minify -o jsonpath='{.clusters[0].name}'
kubectl config view --minify -o jsonpath='{.users[0].name}'

# 네임스페이스 생성 (없는 경우)
kubectl create namespace development

# 새 컨텍스트 생성
kubectl config set-context dev-context \
  --cluster=kubernetes \
  --user=kubernetes-admin \
  --namespace=development

# 컨텍스트 전환
kubectl config use-context dev-context

# 확인
kubectl config current-context
# 출력: dev-context

# 기본 네임스페이스 확인
kubectl get pods
# development 네임스페이스의 Pod가 표시되어야 한다
```

`--cluster`와 `--user` 값은 현재 kubeconfig에 정의된 이름과 정확히 일치해야 한다. `kubectl config view`로 확인할 수 있다.

</details>

---

### 문제 10. [HA 클러스터] Control Plane 노드 추가

`kubectl config use-context k8s-ha`

기존 HA 클러스터에 새로운 Control Plane 노드 `controlplane-3`를 추가하라. 클러스터는 stacked etcd 토폴로지를 사용한다.

<details>
<summary>풀이 확인</summary>

**풀이:**

```bash
# 기존 Control Plane 노드에서 인증서 키 업로드
sudo kubeadm init phase upload-certs --upload-certs
# 출력에서 certificate-key 값을 복사

# 조인 명령 생성 (Control Plane용)
kubeadm token create --print-join-command
# 출력된 명령에 --control-plane --certificate-key를 추가

# controlplane-3에서 실행
ssh controlplane-3

sudo kubeadm join 192.168.1.100:6443 \
  --token abcdef.0123456789abcdef \
  --discovery-token-ca-cert-hash sha256:abc123... \
  --control-plane \
  --certificate-key <certificate-key-from-upload-certs>

# kubeconfig 설정
mkdir -p $HOME/.kube
sudo cp -i /etc/kubernetes/admin.conf $HOME/.kube/config
sudo chown $(id -u):$(id -g) $HOME/.kube/config

# 확인
exit
kubectl get nodes
```

Worker Node 조인과 달리 Control Plane 조인에는 `--control-plane`과 `--certificate-key` 옵션이 추가된다. `--certificate-key`는 `kubeadm init phase upload-certs --upload-certs` 명령으로 생성할 수 있다.

</details>

---

## Workloads & Scheduling

### 문제 11. [Deployment] Rolling Update 설정

`kubectl config use-context k8s-cluster1`

다음 조건으로 Deployment를 생성하라:
- 이름: `webapp`
- 네임스페이스: `default`
- 이미지: `nginx:1.24`
- 레플리카: 4
- Rolling Update 전략: maxSurge=1, maxUnavailable=0 (zero-downtime)
- 생성 후 이미지를 `nginx:1.25`로 업데이트하라.

<details>
<summary>풀이 확인</summary>

**풀이:**

```bash
# Deployment YAML 생성
kubectl create deployment webapp --image=nginx:1.24 --replicas=4 --dry-run=client -o yaml > webapp.yaml
```

```yaml
# webapp.yaml 수정
apiVersion: apps/v1
kind: Deployment
metadata:
  name: webapp
spec:
  replicas: 4
  selector:
    matchLabels:
      app: webapp
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  template:
    metadata:
      labels:
        app: webapp
    spec:
      containers:
      - name: nginx
        image: nginx:1.24
        ports:
        - containerPort: 80
```

```bash
# 적용
kubectl apply -f webapp.yaml

# 이미지 업데이트
kubectl set image deployment/webapp nginx=nginx:1.25

# 롤아웃 상태 확인
kubectl rollout status deployment/webapp

# 이력 확인
kubectl rollout history deployment/webapp
```

`maxUnavailable: 0`은 업데이트 중 사용 불가한 Pod가 없도록 보장한다. 새 Pod가 Ready 상태가 된 후에야 기존 Pod가 종료된다.

</details>

---

### 문제 12. [Scheduling] nodeAffinity로 Pod 배치

`kubectl config use-context k8s-cluster1`

다음 조건으로 Deployment를 생성하라:
- 이름: `cache-deploy`
- 이미지: `redis:7`
- 레플리카: 2
- `disktype=ssd` 레이블이 있는 노드에만(required) 배치하라.
- `zone=zone-a` 레이블이 있는 노드를 선호(preferred, weight=80)하도록 설정하라.

<details>
<summary>풀이 확인</summary>

**풀이:**

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: cache-deploy
spec:
  replicas: 2
  selector:
    matchLabels:
      app: cache
  template:
    metadata:
      labels:
        app: cache
    spec:
      affinity:
        nodeAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
            nodeSelectorTerms:
            - matchExpressions:
              - key: disktype
                operator: In
                values:
                - ssd
          preferredDuringSchedulingIgnoredDuringExecution:
          - weight: 80
            preference:
              matchExpressions:
              - key: zone
                operator: In
                values:
                - zone-a
      containers:
      - name: redis
        image: redis:7
```

```bash
# 노드에 레이블이 없으면 추가
kubectl label nodes worker-1 disktype=ssd
kubectl label nodes worker-1 zone=zone-a

# 적용
kubectl apply -f cache-deploy.yaml

# Pod가 올바른 노드에 배치되었는지 확인
kubectl get pods -o wide
```

</details>

---

### 문제 13. [Taint/Toleration] 전용 노드 설정

`kubectl config use-context k8s-cluster1`

Worker Node `worker-2`를 GPU 워크로드 전용 노드로 설정하라:
- `worker-2`에 `gpu=true:NoSchedule` Taint를 추가하라.
- `gpu-pod`라는 Pod를 생성하여 해당 Taint를 tolerate하고 `worker-2`에서만 실행되도록 하라. 이미지는 `nvidia/cuda:12.0-base`를 사용하라.

<details>
<summary>풀이 확인</summary>

**풀이:**

```bash
# Taint 추가
kubectl taint nodes worker-2 gpu=true:NoSchedule

# 노드에 레이블 추가 (nodeSelector용)
kubectl label nodes worker-2 gpu=true
```

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: gpu-pod
spec:
  tolerations:
  - key: "gpu"
    operator: "Equal"
    value: "true"
    effect: "NoSchedule"
  nodeSelector:
    gpu: "true"
  containers:
  - name: cuda
    image: nvidia/cuda:12.0-base
    command: ["sleep", "3600"]
```

```bash
kubectl apply -f gpu-pod.yaml

# 확인
kubectl get pod gpu-pod -o wide
# NODE 컬럼이 worker-2여야 한다
```

Toleration만으로는 해당 노드에 "반드시" 배치되는 것이 아니다. `nodeSelector`와 함께 사용해야 해당 노드에만 배치된다.

</details>

---

### 문제 14. [Resource] LimitRange와 ResourceQuota 설정

`kubectl config use-context k8s-cluster1`

네임스페이스 `restricted`에 다음을 설정하라:
- LimitRange: 컨테이너 기본 requests(cpu: 100m, memory: 128Mi), 기본 limits(cpu: 500m, memory: 256Mi)
- ResourceQuota: 전체 requests.cpu=2, requests.memory=2Gi, limits.cpu=4, limits.memory=4Gi, pods=10

<details>
<summary>풀이 확인</summary>

**풀이:**

```bash
kubectl create namespace restricted
```

```yaml
# LimitRange
apiVersion: v1
kind: LimitRange
metadata:
  name: default-limits
  namespace: restricted
spec:
  limits:
  - type: Container
    default:
      cpu: "500m"
      memory: "256Mi"
    defaultRequest:
      cpu: "100m"
      memory: "128Mi"
---
# ResourceQuota
apiVersion: v1
kind: ResourceQuota
metadata:
  name: compute-quota
  namespace: restricted
spec:
  hard:
    requests.cpu: "2"
    requests.memory: "2Gi"
    limits.cpu: "4"
    limits.memory: "4Gi"
    pods: "10"
```

```bash
kubectl apply -f limitrange-quota.yaml

# 확인
kubectl describe limitrange default-limits -n restricted
kubectl describe resourcequota compute-quota -n restricted

# 테스트: requests/limits 없이 Pod 생성 (LimitRange의 기본값이 적용되어야 함)
kubectl run test-pod --image=nginx -n restricted
kubectl get pod test-pod -n restricted -o yaml | grep -A5 resources
```

</details>

---

### 문제 15. [Job] 병렬 Job 생성

`kubectl config use-context k8s-cluster1`

다음 조건으로 Job을 생성하라:
- 이름: `data-processor`
- 이미지: `busybox:1.36`
- 명령어: `echo "Processing data item $RANDOM" && sleep 5`
- 총 6개의 작업을 완료해야 한다 (completions=6).
- 동시에 3개씩 실행한다 (parallelism=3).
- 최대 재시도 횟수: 2

<details>
<summary>풀이 확인</summary>

**풀이:**

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: data-processor
spec:
  completions: 6
  parallelism: 3
  backoffLimit: 2
  template:
    spec:
      restartPolicy: Never
      containers:
      - name: processor
        image: busybox:1.36
        command: ["/bin/sh", "-c", "echo Processing data item $RANDOM && sleep 5"]
```

```bash
kubectl apply -f data-processor.yaml

# 상태 확인
kubectl get jobs data-processor
kubectl get pods --selector=job-name=data-processor

# 완료 후 확인
kubectl describe job data-processor
```

`completions=6, parallelism=3`이면 3개씩 두 번에 나눠서 실행된다. 모든 6개가 성공해야 Job이 완료된다.

</details>

---

### 문제 16. [Static Pod] Static Pod 생성

`kubectl config use-context k8s-cluster1`

Worker Node `worker-1`에서 Static Pod를 생성하라:
- 이름: `static-web`
- 이미지: `nginx:1.25`
- 포트: 80

<details>
<summary>풀이 확인</summary>

**풀이:**

```bash
# worker-1에 SSH 접속
ssh worker-1

# Static Pod 경로 확인
cat /var/lib/kubelet/config.yaml | grep staticPodPath
# 출력: staticPodPath: /etc/kubernetes/manifests

# Static Pod 매니페스트 생성
cat <<EOF > /etc/kubernetes/manifests/static-web.yaml
apiVersion: v1
kind: Pod
metadata:
  name: static-web
  labels:
    role: static-web
spec:
  containers:
  - name: nginx
    image: nginx:1.25
    ports:
    - containerPort: 80
EOF

# Control Plane으로 돌아와서 확인
exit
kubectl get pods -o wide | grep static-web
# static-web-worker-1 이라는 이름의 Pod가 보여야 한다
```

Static Pod의 이름은 `<pod-name>-<node-name>` 형식으로 API 서버에 표시된다. 삭제하려면 매니페스트 파일을 삭제해야 한다.

</details>

---

## Services & Networking

### 문제 17. [Service] ClusterIP Service 생성

`kubectl config use-context k8s-cluster1`

`default` 네임스페이스에서:
- `backend`라는 Deployment를 생성하라 (이미지: `nginx:1.25`, 레플리카: 3).
- `backend-svc`라는 ClusterIP Service를 생성하여 포트 80으로 해당 Deployment를 노출하라.
- Service의 엔드포인트가 3개의 Pod IP를 포함하고 있는지 확인하라.

<details>
<summary>풀이 확인</summary>

**풀이:**

```bash
# Deployment 생성
kubectl create deployment backend --image=nginx:1.25 --replicas=3

# Service 생성
kubectl expose deployment backend --port=80 --target-port=80 --name=backend-svc

# 확인
kubectl get svc backend-svc
kubectl get endpoints backend-svc

# 엔드포인트에 3개의 IP가 있는지 확인
kubectl get endpoints backend-svc -o jsonpath='{.subsets[0].addresses[*].ip}'

# 연결 테스트
kubectl run curl-test --image=curlimages/curl --rm -it --restart=Never -- \
  curl -s http://backend-svc
```

</details>

---

### 문제 18. [Service] NodePort Service 생성

`kubectl config use-context k8s-cluster1`

다음 조건으로 NodePort Service를 생성하라:
- 이름: `webapp-nodeport`
- 대상 Deployment: `webapp` (이미지 `nginx`, 레플리카 2)
- Service 포트: 80
- NodePort: 30080

<details>
<summary>풀이 확인</summary>

**풀이:**

```bash
# Deployment 생성 (없는 경우)
kubectl create deployment webapp --image=nginx --replicas=2
```

```yaml
apiVersion: v1
kind: Service
metadata:
  name: webapp-nodeport
spec:
  type: NodePort
  selector:
    app: webapp
  ports:
  - port: 80
    targetPort: 80
    nodePort: 30080
    protocol: TCP
```

```bash
kubectl apply -f webapp-nodeport.yaml

# 확인
kubectl get svc webapp-nodeport
kubectl describe svc webapp-nodeport

# 접근 테스트 (노드 IP 확인)
kubectl get nodes -o wide
# curl http://<Node-IP>:30080
```

`nodePort`를 직접 지정하지 않으면 30000-32767 범위에서 자동 할당된다.

</details>

---

### 문제 19. [Ingress] Path-based Routing 설정

`kubectl config use-context k8s-cluster1`

다음 조건의 Ingress를 생성하라:
- 이름: `app-ingress`
- IngressClass: `nginx`
- 호스트: `myapp.example.com`
- `/api` 경로 → `api-service:8080`
- `/web` 경로 → `web-service:80`
- pathType: Prefix

<details>
<summary>풀이 확인</summary>

**풀이:**

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: app-ingress
  annotations:
    nginx.ingress.kubernetes.io/rewrite-target: /
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
      - path: /web
        pathType: Prefix
        backend:
          service:
            name: web-service
            port:
              number: 80
```

```bash
kubectl apply -f app-ingress.yaml

# 확인
kubectl get ingress app-ingress
kubectl describe ingress app-ingress
```

Ingress가 동작하려면 Ingress Controller(예: nginx-ingress-controller)가 클러스터에 설치되어 있어야 한다. 또한 `api-service`와 `web-service`가 미리 존재해야 한다.

</details>

---

### 문제 20. [NetworkPolicy] Default Deny 설정

`kubectl config use-context k8s-cluster1`

네임스페이스 `secure`에 모든 인바운드 트래픽을 차단하는 Default Deny NetworkPolicy를 생성하라. 이름은 `default-deny-ingress`로 하라.

<details>
<summary>풀이 확인</summary>

**풀이:**

```bash
kubectl create namespace secure
```

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-ingress
  namespace: secure
spec:
  podSelector: {}
  policyTypes:
  - Ingress
```

```bash
kubectl apply -f default-deny.yaml

# 확인
kubectl get networkpolicy -n secure
kubectl describe networkpolicy default-deny-ingress -n secure
```

`podSelector: {}`는 네임스페이스의 모든 Pod에 적용된다. `policyTypes`에 `Ingress`만 있고 `ingress` 규칙이 비어있으므로 모든 인바운드 트래픽이 차단된다.

</details>

---

### 문제 21. [NetworkPolicy] 특정 Pod 간 통신 허용

`kubectl config use-context k8s-cluster1`

네임스페이스 `secure`에서 다음 NetworkPolicy를 생성하라:
- 이름: `allow-frontend-to-backend`
- `tier=backend` 레이블의 Pod에 적용
- `tier=frontend` 레이블의 Pod에서 오는 TCP 포트 8080 트래픽만 허용
- 그 외 모든 인바운드 트래픽은 차단

<details>
<summary>풀이 확인</summary>

**풀이:**

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-frontend-to-backend
  namespace: secure
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

```bash
kubectl apply -f allow-frontend.yaml

# 확인
kubectl describe networkpolicy allow-frontend-to-backend -n secure

# 테스트 (backend Pod 생성)
kubectl run backend -n secure --image=nginx --labels="tier=backend" --port=8080

# frontend Pod에서 연결 테스트
kubectl run frontend -n secure --image=busybox:1.36 --labels="tier=frontend" --rm -it --restart=Never -- \
  wget -qO- --timeout=3 http://backend:8080

# 다른 레이블의 Pod에서는 접근 불가
kubectl run other -n secure --image=busybox:1.36 --labels="tier=other" --rm -it --restart=Never -- \
  wget -qO- --timeout=3 http://backend:8080
```

</details>

---

### 문제 22. [NetworkPolicy] Egress 정책 (DNS 허용 포함)

`kubectl config use-context k8s-cluster1`

네임스페이스 `secure`에서 `tier=backend` Pod의 Egress 정책을 설정하라:
- 이름: `backend-egress`
- DNS 트래픽(UDP/TCP 53)을 허용하라.
- `tier=database` Pod의 TCP 3306 포트로만 트래픽을 허용하라.
- 그 외 아웃바운드 트래픽은 차단하라.

<details>
<summary>풀이 확인</summary>

**풀이:**

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: backend-egress
  namespace: secure
spec:
  podSelector:
    matchLabels:
      tier: backend
  policyTypes:
  - Egress
  egress:
  - ports:
    - protocol: UDP
      port: 53
    - protocol: TCP
      port: 53
  - to:
    - podSelector:
        matchLabels:
          tier: database
    ports:
    - protocol: TCP
      port: 3306
```

```bash
kubectl apply -f backend-egress.yaml

# 확인
kubectl describe networkpolicy backend-egress -n secure
```

Egress 정책에서 DNS(포트 53)를 허용하지 않으면 서비스 이름 해석이 불가능해지므로, 사실상 모든 서비스 기반 통신이 차단된다. DNS 허용은 거의 항상 필요하다.

</details>

---

### 문제 23. [DNS] CoreDNS 트러블슈팅

`kubectl config use-context k8s-cluster1`

클러스터의 DNS가 정상적으로 동작하지 않는다. 다음을 수행하라:
- CoreDNS Pod의 상태를 확인하라.
- CoreDNS의 로그를 확인하여 문제를 진단하라.
- CoreDNS ConfigMap을 확인하라.
- DNS 해석이 정상적으로 동작하는지 테스트하라.

<details>
<summary>풀이 확인</summary>

**풀이:**

```bash
# 1. CoreDNS Pod 상태 확인
kubectl -n kube-system get pods -l k8s-app=kube-dns
kubectl -n kube-system describe pods -l k8s-app=kube-dns

# 2. CoreDNS 로그 확인
kubectl -n kube-system logs -l k8s-app=kube-dns

# 3. CoreDNS ConfigMap 확인
kubectl -n kube-system get configmap coredns -o yaml

# 4. CoreDNS Deployment 확인
kubectl -n kube-system get deployment coredns
kubectl -n kube-system describe deployment coredns

# 5. CoreDNS Service 확인
kubectl -n kube-system get svc kube-dns

# 6. DNS 테스트
kubectl run dns-test --image=busybox:1.28 --rm -it --restart=Never -- \
  nslookup kubernetes.default.svc.cluster.local

# 7. 외부 DNS 해석 테스트
kubectl run dns-test2 --image=busybox:1.28 --rm -it --restart=Never -- \
  nslookup google.com

# 일반적인 해결 방법:
# - CoreDNS Pod가 CrashLoopBackOff이면 로그를 확인한다
# - ConfigMap에 오류가 있으면 수정한다
# - CoreDNS Pod를 재시작한다
kubectl -n kube-system rollout restart deployment coredns
```

일반적인 CoreDNS 문제:
- ConfigMap(Corefile)의 구문 오류
- 업스트림 DNS 서버에 접근 불가
- CoreDNS Pod의 리소스 부족
- CoreDNS Service(kube-dns)의 endpoint가 비어 있는 경우

</details>

---

### 문제 24. [Ingress] TLS Ingress 설정

`kubectl config use-context k8s-cluster1`

다음 조건으로 TLS Ingress를 생성하라:
- 이름: `secure-ingress`
- 호스트: `secure.example.com`
- TLS Secret: `tls-secret` (이미 존재한다고 가정)
- 백엔드: `secure-service:443`
- pathType: Prefix, path: /

<details>
<summary>풀이 확인</summary>

**풀이:**

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: secure-ingress
spec:
  ingressClassName: nginx
  tls:
  - hosts:
    - secure.example.com
    secretName: tls-secret
  rules:
  - host: secure.example.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: secure-service
            port:
              number: 443
```

```bash
# TLS Secret이 없는 경우 생성 (자체 서명 인증서)
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout tls.key -out tls.crt -subj "/CN=secure.example.com"

kubectl create secret tls tls-secret --cert=tls.crt --key=tls.key

# Ingress 적용
kubectl apply -f secure-ingress.yaml

# 확인
kubectl get ingress secure-ingress
kubectl describe ingress secure-ingress
```

</details>

---

## Storage

### 문제 25. [PV/PVC] PersistentVolume과 PersistentVolumeClaim 생성

`kubectl config use-context k8s-cluster1`

다음을 생성하라:
- PV: 이름 `app-pv`, 용량 1Gi, accessMode RWO, hostPath `/mnt/app-data`, storageClassName `manual`, reclaimPolicy Retain
- PVC: 이름 `app-pvc`, 용량 500Mi, accessMode RWO, storageClassName `manual`
- Pod: 이름 `app-pod`, 이미지 `nginx`, PVC를 `/app/data`에 마운트

<details>
<summary>풀이 확인</summary>

**풀이:**

```yaml
apiVersion: v1
kind: PersistentVolume
metadata:
  name: app-pv
spec:
  capacity:
    storage: 1Gi
  accessModes:
  - ReadWriteOnce
  persistentVolumeReclaimPolicy: Retain
  storageClassName: manual
  hostPath:
    path: /mnt/app-data
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: app-pvc
spec:
  accessModes:
  - ReadWriteOnce
  resources:
    requests:
      storage: 500Mi
  storageClassName: manual
---
apiVersion: v1
kind: Pod
metadata:
  name: app-pod
spec:
  containers:
  - name: nginx
    image: nginx
    volumeMounts:
    - name: app-volume
      mountPath: /app/data
  volumes:
  - name: app-volume
    persistentVolumeClaim:
      claimName: app-pvc
```

```bash
kubectl apply -f app-pv-pvc-pod.yaml

# PV/PVC 바인딩 확인
kubectl get pv
kubectl get pvc

# Pod 상태 확인
kubectl get pod app-pod

# 마운트 확인
kubectl exec app-pod -- df -h /app/data
kubectl exec app-pod -- touch /app/data/test-file
kubectl exec app-pod -- ls /app/data
```

PV의 capacity(1Gi)가 PVC의 requests(500Mi)보다 크거나 같아야 바인딩된다. storageClassName과 accessModes도 일치해야 한다.

</details>

---

### 문제 26. [StorageClass] Dynamic Provisioning 설정

`kubectl config use-context k8s-cluster1`

다음을 설정하라:
- StorageClass `fast-storage`를 생성하라 (provisioner: `kubernetes.io/no-provisioner`, reclaimPolicy: Delete, volumeBindingMode: WaitForFirstConsumer).
- 해당 StorageClass를 사용하는 PVC `dynamic-pvc`를 생성하라 (용량: 5Gi, accessMode: RWO).

<details>
<summary>풀이 확인</summary>

**풀이:**

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: fast-storage
provisioner: kubernetes.io/no-provisioner
reclaimPolicy: Delete
volumeBindingMode: WaitForFirstConsumer
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: dynamic-pvc
spec:
  accessModes:
  - ReadWriteOnce
  resources:
    requests:
      storage: 5Gi
  storageClassName: fast-storage
```

```bash
kubectl apply -f fast-storage.yaml

# 확인
kubectl get storageclass
kubectl get pvc dynamic-pvc
```

`kubernetes.io/no-provisioner`는 로컬 볼륨용이므로 실제 동적 프로비저닝은 되지 않는다. PV를 수동으로 생성해야 한다. 실제 클라우드 환경에서는 `kubernetes.io/aws-ebs`, `kubernetes.io/gce-pd` 등의 프로비저너를 사용한다.

`WaitForFirstConsumer`는 PVC를 사용하는 Pod가 생성될 때까지 바인딩을 지연시킨다. 이를 통해 Pod가 스케줄링되는 노드의 토폴로지(zone 등)를 고려할 수 있다.

</details>

---

### 문제 27. [Volume] emptyDir을 이용한 사이드카 패턴

`kubectl config use-context k8s-cluster1`

다음 조건으로 Multi-container Pod를 생성하라:
- 이름: `logging-pod`
- 컨테이너 1 (`app`): `busybox:1.36`, 명령어: `while true; do echo "$(date) - Log message" >> /var/log/app/app.log; sleep 5; done`
- 컨테이너 2 (`sidecar`): `busybox:1.36`, 명령어: `tail -f /var/log/app/app.log`
- 두 컨테이너가 emptyDir 볼륨을 공유하여 `/var/log/app`에 마운트

<details>
<summary>풀이 확인</summary>

**풀이:**

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: logging-pod
spec:
  containers:
  - name: app
    image: busybox:1.36
    command: ["/bin/sh", "-c"]
    args:
    - >
      while true; do
        echo "$(date) - Log message" >> /var/log/app/app.log;
        sleep 5;
      done
    volumeMounts:
    - name: log-volume
      mountPath: /var/log/app
  - name: sidecar
    image: busybox:1.36
    command: ["/bin/sh", "-c", "tail -f /var/log/app/app.log"]
    volumeMounts:
    - name: log-volume
      mountPath: /var/log/app
      readOnly: true
  volumes:
  - name: log-volume
    emptyDir: {}
```

```bash
kubectl apply -f logging-pod.yaml

# 사이드카 로그 확인
kubectl logs logging-pod -c sidecar -f

# app 컨테이너의 로그 파일 확인
kubectl exec logging-pod -c app -- cat /var/log/app/app.log
```

emptyDir 볼륨은 Pod와 생명주기를 같이 하므로 Pod가 삭제되면 데이터도 삭제된다.

</details>

---

### 문제 28. [PV] PV Reclaim 처리

`kubectl config use-context k8s-cluster1`

Released 상태의 PV `old-pv`가 있다. 이 PV를 다시 Available 상태로 변경하여 새 PVC에 바인딩할 수 있도록 하라.

<details>
<summary>풀이 확인</summary>

**풀이:**

```bash
# PV 상태 확인
kubectl get pv old-pv

# claimRef를 제거하여 Available 상태로 변경
kubectl patch pv old-pv --type json -p '[{"op": "remove", "path": "/spec/claimRef"}]'

# 또는 kubectl edit 사용
kubectl edit pv old-pv
# spec.claimRef 섹션 전체를 삭제한다

# 상태 확인
kubectl get pv old-pv
# STATUS가 Available이어야 한다
```

PV가 Released 상태인 것은 이전에 바인딩된 PVC가 삭제되었지만 `spec.claimRef`가 남아 있기 때문이다. `claimRef`를 제거하면 PV가 다시 Available 상태가 되어 새 PVC에 바인딩될 수 있다.

주의: Retain 정책의 PV에서만 이 작업이 의미가 있다. Delete 정책의 PV는 PVC 삭제 시 함께 삭제된다.

</details>

---

## Troubleshooting

### 문제 29. [노드 장애] Worker Node NotReady

`kubectl config use-context k8s-cluster1`

Worker Node `worker-1`이 `NotReady` 상태이다. 원인을 파악하고 해결하라.

<details>
<summary>풀이 확인</summary>

**풀이:**

```bash
# 1. 노드 상태 확인
kubectl get nodes
kubectl describe node worker-1

# 2. worker-1에 SSH 접속
ssh worker-1

# 3. kubelet 상태 확인
sudo systemctl status kubelet

# 4. kubelet이 비활성화(stopped/failed)인 경우
sudo systemctl start kubelet
sudo systemctl enable kubelet

# 5. kubelet 로그 확인
sudo journalctl -u kubelet --no-pager -l | tail -50

# 일반적인 원인과 해결:

# 원인 1: kubelet이 중지됨
sudo systemctl restart kubelet
sudo systemctl enable kubelet

# 원인 2: kubelet 설정 파일 오류
sudo cat /var/lib/kubelet/config.yaml
# 오류를 수정한 후 kubelet 재시작

# 원인 3: containerd가 중지됨
sudo systemctl status containerd
sudo systemctl restart containerd

# 원인 4: 인증서 오류
sudo openssl x509 -in /var/lib/kubelet/pki/kubelet.crt -noout -dates
# 인증서가 만료된 경우 갱신 필요

# 원인 5: 디스크 공간 부족
df -h
# 디스크가 가득 찬 경우 불필요한 파일 삭제

# 6. Control Plane으로 돌아와서 확인
exit
kubectl get nodes
```

시험에서 `NotReady` 문제는 보통 kubelet 서비스가 중지되었거나 설정 파일에 오류가 있는 경우이다. 항상 `systemctl status kubelet`과 `journalctl -u kubelet`을 먼저 확인한다.

</details>

---

### 문제 30. [Pod 장애] CrashLoopBackOff 진단 및 해결

`kubectl config use-context k8s-cluster1`

네임스페이스 `default`에 `crash-app`이라는 Pod가 `CrashLoopBackOff` 상태이다. 원인을 파악하고 해결하라.

<details>
<summary>풀이 확인</summary>

**풀이:**

```bash
# 1. Pod 상태 확인
kubectl get pod crash-app
kubectl describe pod crash-app

# 2. 이전 컨테이너 로그 확인
kubectl logs crash-app --previous

# 3. Events 섹션에서 Exit Code 확인
kubectl describe pod crash-app | grep -A5 "Last State"
# Exit Code 1: 애플리케이션 오류
# Exit Code 137: OOMKilled (메모리 부족)
# Exit Code 139: Segmentation fault

# 4. Pod 스펙 확인
kubectl get pod crash-app -o yaml

# 일반적인 원인과 해결:

# 원인 1: 잘못된 command/args
kubectl get pod crash-app -o yaml | grep -A5 command
# 올바른 명령어로 수정

# 원인 2: 환경변수/ConfigMap/Secret 누락
kubectl describe pod crash-app | grep -A10 "Environment"
# 필요한 ConfigMap/Secret을 생성

# 원인 3: OOMKilled (메모리 부족)
kubectl describe pod crash-app | grep OOMKilled
# resources.limits.memory를 늘려서 Pod를 재생성

# 원인 4: 존재하지 않는 볼륨 마운트
kubectl describe pod crash-app | grep -A5 "Volumes"
# 해당 볼륨(PVC, ConfigMap, Secret 등)이 존재하는지 확인

# 해결 후: Pod 재생성
kubectl delete pod crash-app
kubectl apply -f crash-app-fixed.yaml

# 또는 Deployment인 경우 edit
kubectl edit deployment crash-app-deploy
```

</details>

---

### 문제 31. [Pod 장애] ImagePullBackOff 해결

`kubectl config use-context k8s-cluster1`

`default` 네임스페이스의 `broken-pod`가 `ImagePullBackOff` 상태이다. 원인을 파악하고 해결하라. 올바른 이미지는 `nginx:1.25`이다.

<details>
<summary>풀이 확인</summary>

**풀이:**

```bash
# 1. Pod 상태 확인
kubectl describe pod broken-pod

# Events 섹션에서 pull 실패 원인 확인:
# - "repository does not exist": 이미지 이름 오류
# - "tag not found": 태그 오류
# - "unauthorized": 인증 필요 (imagePullSecrets)

# 2. 현재 이미지 확인
kubectl get pod broken-pod -o jsonpath='{.spec.containers[0].image}'
# 예: nginx:99.99 (존재하지 않는 태그)

# 3. 이미지를 올바른 것으로 수정
# Pod는 직접 수정할 수 없으므로 삭제 후 재생성
kubectl get pod broken-pod -o yaml > broken-pod.yaml

# YAML에서 이미지를 nginx:1.25로 수정
# vi broken-pod.yaml

kubectl delete pod broken-pod
kubectl apply -f broken-pod.yaml

# 또는 Deployment에 의해 관리되는 경우
kubectl set image deployment/<deployment-name> <container-name>=nginx:1.25

# 4. 확인
kubectl get pod broken-pod
```

Pod는 직접 이미지를 수정할 수 없으므로 삭제 후 재생성해야 한다. Deployment가 관리하는 경우 `kubectl set image`로 수정할 수 있다.

</details>

---

### 문제 32. [Pod 장애] Pending Pod 해결

`kubectl config use-context k8s-cluster1`

`default` 네임스페이스의 `pending-pod`가 계속 `Pending` 상태이다. 원인을 파악하고 해결하라.

<details>
<summary>풀이 확인</summary>

**풀이:**

```bash
# 1. Pod 상태 확인
kubectl describe pod pending-pod

# Events 섹션 확인 (일반적인 메시지):
# "Insufficient cpu/memory": 리소스 부족
# "didn't match Pod's node affinity/selector": 노드 선택 불일치
# "node(s) had taint": Taint/Toleration 불일치
# "persistentvolumeclaim not found/not bound": PVC 문제

# 2. 원인별 해결

# 원인 1: 리소스 부족
kubectl describe pod pending-pod | grep -A3 "Requests"
kubectl top nodes
# 해결: requests를 줄이거나 다른 Pod를 종료

# 원인 2: nodeSelector 불일치
kubectl get pod pending-pod -o yaml | grep -A3 nodeSelector
kubectl get nodes --show-labels
# 해결: 노드에 레이블 추가
kubectl label nodes <node-name> <key>=<value>

# 원인 3: Taint/Toleration 불일치
kubectl describe nodes | grep -A3 Taints
# 해결: Pod에 toleration 추가 또는 노드의 taint 제거
kubectl taint nodes <node-name> <key>-

# 원인 4: PVC 미바인딩
kubectl get pvc
kubectl get pv
# 해결: 적절한 PV를 생성하거나 PVC를 수정

# 3. 확인
kubectl get pod pending-pod
```

Pending 상태의 Pod를 진단할 때 `kubectl describe pod`의 Events 섹션이 가장 중요한 정보를 제공한다.

</details>

---

### 문제 33. [Service 장애] Service 연결 불가

`kubectl config use-context k8s-cluster1`

`default` 네임스페이스의 `web-service`가 `web-deploy` Deployment의 Pod로 트래픽을 전달하지 못한다. 원인을 파악하고 해결하라.

<details>
<summary>풀이 확인</summary>

**풀이:**

```bash
# 1. Service 확인
kubectl get svc web-service
kubectl describe svc web-service

# 2. Endpoints 확인 (비어 있으면 selector 불일치)
kubectl get endpoints web-service
# ENDPOINTS가 <none>이면 문제

# 3. Service의 selector 확인
kubectl get svc web-service -o jsonpath='{.spec.selector}'
# 예: {"app":"web-app"}

# 4. Pod의 labels 확인
kubectl get pods --show-labels
kubectl get pods -l app=web-deploy
# selector와 Pod의 label이 일치하는지 확인

# 5. 불일치하는 경우:

# 방법 A: Service의 selector를 Pod의 label에 맞게 수정
kubectl edit svc web-service
# spec.selector를 Pod의 label과 일치하도록 수정

# 방법 B: Pod의 label을 Service의 selector에 맞게 수정
kubectl label pods -l app=web-deploy app=web-app --overwrite

# 6. port/targetPort 확인
kubectl get svc web-service -o yaml | grep -A5 ports
# targetPort가 Pod의 containerPort와 일치하는지 확인

kubectl get pod <pod-name> -o yaml | grep containerPort

# 7. 수정 후 확인
kubectl get endpoints web-service
# ENDPOINTS에 Pod IP가 표시되어야 한다

# 8. 연결 테스트
kubectl run test --image=curlimages/curl --rm -it --restart=Never -- \
  curl -s http://web-service
```

Service 트러블슈팅의 핵심은 **Endpoints**를 확인하는 것이다. Endpoints가 비어있으면 selector와 Pod label이 불일치하거나 Pod가 Ready 상태가 아닌 것이다.

</details>

---

### 문제 34. [컴포넌트 장애] kube-scheduler 복구

`kubectl config use-context k8s-cluster1`

새로 생성한 Pod가 모두 `Pending` 상태에 머물고 있다. `kubectl describe`를 확인하니 Events에 스케줄링 관련 메시지가 없다. kube-scheduler가 정상적으로 동작하는지 확인하고 문제를 해결하라.

<details>
<summary>풀이 확인</summary>

**풀이:**

```bash
# 1. kube-scheduler Pod 상태 확인
kubectl -n kube-system get pods | grep scheduler

# 2. Pod가 없거나 CrashLoopBackOff인 경우
# Static Pod 매니페스트 확인
cat /etc/kubernetes/manifests/kube-scheduler.yaml

# 3. 컨테이너 상태 확인
crictl ps -a | grep scheduler

# 4. 컨테이너 로그 확인
crictl logs <scheduler-container-id>

# 일반적인 원인:

# 원인 1: 매니페스트 파일이 삭제됨
# 해결: kube-scheduler.yaml을 다시 생성

# 원인 2: 매니페스트 파일에 오타가 있음
vi /etc/kubernetes/manifests/kube-scheduler.yaml
# 예: --kubeconfig 경로가 잘못됨, 포트가 잘못됨
# 수정 후 저장하면 kubelet이 자동으로 재시작

# 원인 3: 인증서 경로 오류
# --authentication-kubeconfig, --authorization-kubeconfig 경로 확인

# 5. 복구 확인
kubectl -n kube-system get pods | grep scheduler
# Running 상태여야 한다

# 6. 테스트 Pod 생성하여 스케줄링 확인
kubectl run test-scheduler --image=nginx
kubectl get pod test-scheduler
# Pending이 아닌 Running이어야 한다
```

Events에 스케줄링 관련 메시지가 전혀 없으면 kube-scheduler가 동작하지 않는 것이다. kube-scheduler는 Static Pod이므로 `/etc/kubernetes/manifests/kube-scheduler.yaml`을 확인해야 한다.

</details>

---

### 문제 35. [컴포넌트 장애] kubelet 설정 오류 복구

`kubectl config use-context k8s-cluster1`

Worker Node `worker-2`가 `NotReady` 상태이다. SSH 접속하여 kubelet 로그를 확인하니 설정 파일 관련 오류가 있다. kubelet 설정을 수정하고 정상 상태로 복구하라.

<details>
<summary>풀이 확인</summary>

**풀이:**

```bash
# 1. worker-2에 SSH 접속
ssh worker-2

# 2. kubelet 상태 확인
sudo systemctl status kubelet

# 3. kubelet 로그 확인 (오류 메시지에서 원인 파악)
sudo journalctl -u kubelet --no-pager -l | tail -30

# 일반적인 오류 메시지와 해결:

# 오류: "failed to load kubelet config file"
# 해결: 설정 파일 경로 확인
sudo cat /var/lib/kubelet/config.yaml
# YAML 구문 오류를 수정

# 오류: "unable to load client CA file"
# 해결: 인증서 파일 경로 확인 및 수정
# config.yaml의 authentication.x509.clientCAFile 경로 확인

# 오류: "node not found" 또는 "unauthorized"
# 해결: kubeconfig 파일 확인
sudo cat /etc/kubernetes/kubelet.conf
# server 주소가 올바른지 확인

# 오류: "container runtime is not running"
# 해결: containerd 재시작
sudo systemctl restart containerd

# 4. kubelet 설정 수정 후 재시작
sudo vi /var/lib/kubelet/config.yaml
# 오류를 수정

sudo systemctl daemon-reload
sudo systemctl restart kubelet
sudo systemctl enable kubelet

# 5. 상태 확인
sudo systemctl status kubelet
sudo journalctl -u kubelet -f

# 6. Control Plane에서 확인
exit
kubectl get nodes
# worker-2가 Ready 상태여야 한다
```

kubelet 설정 파일의 일반적인 오류:
- YAML 들여쓰기 오류
- 인증서 파일 경로 오류
- API 서버 주소 오류
- port 번호 오류

</details>

---

### 문제 36. [로그 분석] 특정 Pod의 로그 분석

`kubectl config use-context k8s-cluster1`

네임스페이스 `production`에서 실행 중인 `app-server` Pod가 간헐적으로 5xx 오류를 반환한다. 다음을 수행하라:
- Pod의 최근 100줄 로그를 확인하라.
- 최근 30분 이내의 로그에서 "error" 또는 "Error" 패턴을 검색하라.
- Pod의 이전 컨테이너 로그도 확인하라 (재시작 이력이 있는 경우).
- 문제 원인을 `/opt/answer/error-log.txt`에 저장하라.

<details>
<summary>풀이 확인</summary>

**풀이:**

```bash
# 1. 최근 100줄 로그 확인
kubectl logs app-server -n production --tail=100

# 2. 최근 30분 로그에서 에러 검색
kubectl logs app-server -n production --since=30m | grep -i error

# 3. 이전 컨테이너 로그 확인 (재시작된 경우)
kubectl logs app-server -n production --previous

# 4. Pod 상세 정보 확인 (재시작 횟수, Exit Code 등)
kubectl describe pod app-server -n production | grep -A10 "Last State"
kubectl describe pod app-server -n production | grep "Restart Count"

# 5. 멀티 컨테이너인 경우 각 컨테이너 로그 확인
kubectl get pod app-server -n production -o jsonpath='{.spec.containers[*].name}'
kubectl logs app-server -n production -c <container-name>

# 6. 에러 로그를 파일로 저장
mkdir -p /opt/answer
kubectl logs app-server -n production --since=30m | grep -i error > /opt/answer/error-log.txt

# 결과 확인
cat /opt/answer/error-log.txt
```

</details>

---

### 문제 37. [컴포넌트 장애] etcd 장애 복구

`kubectl config use-context k8s-cluster1`

`kubectl get pods` 명령이 "connection refused" 오류를 반환한다. API 서버 로그를 확인하니 etcd 연결 실패 메시지가 있다. etcd를 복구하라.

<details>
<summary>풀이 확인</summary>

**풀이:**

```bash
# 1. etcd 컨테이너 상태 확인
crictl ps -a | grep etcd

# 2. etcd 로그 확인
crictl logs <etcd-container-id>

# 3. etcd 매니페스트 확인
cat /etc/kubernetes/manifests/etcd.yaml

# 일반적인 원인:

# 원인 1: etcd 매니페스트의 설정 오류
vi /etc/kubernetes/manifests/etcd.yaml
# 확인 사항:
# - --data-dir 경로가 올바른지
# - --cert-file, --key-file, --trusted-ca-file 경로가 올바른지
# - --listen-client-urls, --advertise-client-urls가 올바른지
# - volume mount 경로가 올바른지

# 원인 2: 데이터 디렉터리 손상
ls -la /var/lib/etcd/
# 디렉터리가 없거나 빈 경우, 백업에서 복구

# 원인 3: 인증서 파일 누락/오류
ls -la /etc/kubernetes/pki/etcd/
# ca.crt, server.crt, server.key가 존재하는지 확인

# 4. 매니페스트 수정 후 etcd Pod 재시작 대기
# Static Pod이므로 매니페스트 저장 시 자동 재시작

# 5. 복구 확인
crictl ps | grep etcd
kubectl get pods -A
kubectl get nodes
```

etcd가 동작하지 않으면 API 서버도 정상 동작하지 않는다. `kubectl` 명령이 실패하므로 `crictl`을 사용하여 컨테이너를 직접 확인해야 한다.

</details>

---

### 문제 38. [네트워크 장애] Service DNS 해석 실패

`kubectl config use-context k8s-cluster1`

Pod에서 `nslookup my-service.default.svc.cluster.local` 명령이 실패한다. DNS 해석이 되지 않는 원인을 파악하고 해결하라.

<details>
<summary>풀이 확인</summary>

**풀이:**

```bash
# 1. CoreDNS Pod 상태 확인
kubectl -n kube-system get pods -l k8s-app=kube-dns

# 2. CoreDNS Pod가 Running이 아닌 경우
kubectl -n kube-system describe pods -l k8s-app=kube-dns
kubectl -n kube-system logs -l k8s-app=kube-dns

# 3. CoreDNS Service 확인
kubectl -n kube-system get svc kube-dns
kubectl -n kube-system get endpoints kube-dns

# 4. CoreDNS ConfigMap 확인
kubectl -n kube-system get configmap coredns -o yaml
# Corefile 구문 오류가 있는지 확인

# 일반적인 원인:

# 원인 1: CoreDNS Pod가 CrashLoopBackOff
# 로그 확인 후 ConfigMap(Corefile) 수정
kubectl -n kube-system edit configmap coredns
# 구문 오류를 수정한 후 CoreDNS 재시작
kubectl -n kube-system rollout restart deployment coredns

# 원인 2: CoreDNS Deployment의 replicas가 0
kubectl -n kube-system scale deployment coredns --replicas=2

# 원인 3: kube-dns Service의 ClusterIP가 변경됨
# Pod의 /etc/resolv.conf 확인
kubectl run dns-debug --image=busybox:1.28 --rm -it --restart=Never -- cat /etc/resolv.conf
# nameserver가 kube-dns Service의 ClusterIP와 일치하는지 확인

# 원인 4: NetworkPolicy가 DNS 트래픽을 차단
kubectl get networkpolicy -A
# DNS(포트 53) 트래픽을 허용하는지 확인

# 5. 해결 후 DNS 테스트
kubectl run dns-test --image=busybox:1.28 --rm -it --restart=Never -- \
  nslookup my-service.default.svc.cluster.local

kubectl run dns-test2 --image=busybox:1.28 --rm -it --restart=Never -- \
  nslookup kubernetes.default
```

DNS 문제 진단 순서: CoreDNS Pod 상태 → CoreDNS 로그 → CoreDNS ConfigMap → kube-dns Service → NetworkPolicy 순서로 확인한다.

</details>

---

### 문제 39. [노드 관리] 노드 Drain과 Maintenance

`kubectl config use-context k8s-cluster1`

Worker Node `worker-1`에서 유지보수 작업을 수행해야 한다. 다음을 수행하라:
- `worker-1`을 안전하게 drain하라 (DaemonSet Pod는 무시, emptyDir 데이터가 있는 Pod도 삭제 허용).
- 유지보수 완료 후 노드를 다시 스케줄링 가능 상태로 복원하라.
- 노드 상태를 확인하라.

<details>
<summary>풀이 확인</summary>

**풀이:**

```bash
# 1. 현재 worker-1에서 실행 중인 Pod 확인
kubectl get pods -A -o wide --field-selector spec.nodeName=worker-1

# 2. 노드 drain (안전하게 Pod 이동)
kubectl drain worker-1 --ignore-daemonsets --delete-emptydir-data

# --ignore-daemonsets: DaemonSet이 관리하는 Pod는 drain 대상에서 제외
# --delete-emptydir-data: emptyDir 볼륨을 사용하는 Pod도 삭제 허용
# --force: ReplicaSet/Deployment 등에 의해 관리되지 않는 단독 Pod도 삭제

# 만약 단독 Pod(Deployment 등으로 관리되지 않는)가 있어 실패하면:
kubectl drain worker-1 --ignore-daemonsets --delete-emptydir-data --force

# 3. drain 결과 확인
kubectl get nodes
# worker-1이 Ready,SchedulingDisabled 상태

kubectl get pods -A -o wide --field-selector spec.nodeName=worker-1
# DaemonSet Pod만 남아있어야 한다

# === 유지보수 작업 수행 ===

# 4. 유지보수 완료 후 노드 복원
kubectl uncordon worker-1

# 5. 노드 상태 확인
kubectl get nodes
# worker-1이 Ready 상태 (SchedulingDisabled 없음)
```

`drain` = `cordon` + Pod 이동이다. `cordon`만 하면 새 Pod가 스케줄링되지 않지만 기존 Pod는 그대로 유지된다. `drain`은 기존 Pod도 안전하게 다른 노드로 이동시킨다.

</details>

---

### 문제 40. [종합] 전체 클러스터 상태 점검

`kubectl config use-context k8s-cluster1`

클러스터 전체 상태를 점검하고, 발견된 모든 문제를 `/opt/answer/cluster-health.txt`에 보고하라. 다음을 확인해야 한다:
- 모든 노드의 상태
- kube-system 네임스페이스의 모든 Pod 상태
- 모든 네임스페이스에서 Running이 아닌 Pod 목록
- etcd 클러스터 상태
- CoreDNS 동작 여부

<details>
<summary>풀이 확인</summary>

**풀이:**

```bash
mkdir -p /opt/answer

# 보고서 작성 시작
cat <<'REPORT' > /opt/answer/cluster-health.txt
=== 클러스터 상태 점검 보고서 ===
REPORT

# 1. 노드 상태
echo -e "\n--- 노드 상태 ---" >> /opt/answer/cluster-health.txt
kubectl get nodes -o wide >> /opt/answer/cluster-health.txt 2>&1

# NotReady 노드 확인
echo -e "\n--- NotReady 노드 ---" >> /opt/answer/cluster-health.txt
kubectl get nodes | grep NotReady >> /opt/answer/cluster-health.txt 2>&1 || echo "없음" >> /opt/answer/cluster-health.txt

# 2. kube-system Pod 상태
echo -e "\n--- kube-system Pod 상태 ---" >> /opt/answer/cluster-health.txt
kubectl get pods -n kube-system -o wide >> /opt/answer/cluster-health.txt 2>&1

# 3. 비정상 Pod 목록 (모든 네임스페이스)
echo -e "\n--- 비정상 Pod 목록 (Running/Completed 아닌 Pod) ---" >> /opt/answer/cluster-health.txt
kubectl get pods -A --field-selector 'status.phase!=Running,status.phase!=Succeeded' >> /opt/answer/cluster-health.txt 2>&1 || echo "없음" >> /opt/answer/cluster-health.txt

# 4. etcd 클러스터 상태
echo -e "\n--- etcd 클러스터 상태 ---" >> /opt/answer/cluster-health.txt
ETCDCTL_API=3 etcdctl member list \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key \
  --write-out=table >> /opt/answer/cluster-health.txt 2>&1

# etcd 엔드포인트 상태
echo -e "\n--- etcd 엔드포인트 상태 ---" >> /opt/answer/cluster-health.txt
ETCDCTL_API=3 etcdctl endpoint health \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key >> /opt/answer/cluster-health.txt 2>&1

# 5. CoreDNS 동작 확인
echo -e "\n--- CoreDNS 상태 ---" >> /opt/answer/cluster-health.txt
kubectl -n kube-system get pods -l k8s-app=kube-dns >> /opt/answer/cluster-health.txt 2>&1

echo -e "\n--- DNS 테스트 ---" >> /opt/answer/cluster-health.txt
kubectl run dns-health-check --image=busybox:1.28 --rm -it --restart=Never -- \
  nslookup kubernetes.default.svc.cluster.local >> /opt/answer/cluster-health.txt 2>&1

# 6. 이벤트 확인 (최근 Warning 이벤트)
echo -e "\n--- 최근 Warning 이벤트 ---" >> /opt/answer/cluster-health.txt
kubectl get events -A --field-selector type=Warning --sort-by='.lastTimestamp' | tail -20 >> /opt/answer/cluster-health.txt 2>&1

# 보고서 확인
cat /opt/answer/cluster-health.txt
```

클러스터 점검 시 확인 순서:
1. 노드 상태 (NotReady가 없는지)
2. Control Plane 컴포넌트 (kube-system Pod)
3. 비정상 Pod (모든 네임스페이스)
4. etcd 상태
5. DNS 동작
6. Warning 이벤트

이 순서로 확인하면 대부분의 클러스터 문제를 발견할 수 있다.

</details>
