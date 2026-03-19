# CKA 실습 가이드 — tart-infra 활용

> 이 문서는 tart-infra 환경의 4개 Kubernetes 클러스터(platform/dev/staging/prod)를 활용하여 CKA 시험 도메인을 실습하는 가이드이다.
> 각 실습은 실제 인프라 구성 요소(Cilium, Prometheus, ArgoCD, 데모 앱 등)를 대상으로 진행한다.

| 도메인 | 비중 | 실습 수 |
|--------|------|---------|
| Cluster Architecture, Installation & Configuration | 25% | 10 |
| Workloads & Scheduling | 15% | 8 |
| Services & Networking | 20% | 8 |
| Storage | 10% | 5 |
| Troubleshooting | 30% | 10 |

---

## 사전 준비

### kubeconfig 설정

tart-infra의 4개 클러스터에 접근하기 위한 kubeconfig를 설정한다.

```bash
# 현재 사용 가능한 컨텍스트 확인
kubectl config get-contexts

# 클러스터별 컨텍스트 전환
kubectl config use-context platform
kubectl config use-context dev
kubectl config use-context staging
kubectl config use-context prod

# 또는 명령마다 컨텍스트 지정
kubectl --context=dev get nodes
kubectl --context=platform get nodes
```

### 클러스터 구성 확인

```bash
# 각 클러스터 노드 확인
for ctx in platform dev staging prod; do
  echo "=== $ctx ==="
  kubectl --context=$ctx get nodes -o wide
done

# dev 클러스터에 데모 앱 확인
kubectl --context=dev get pods --all-namespaces | grep -v kube-system
```

---

## 1. Cluster Architecture, Installation & Configuration (25%)

### 실습 1-1. 클러스터 노드 상태 확인

tart-infra의 4개 클러스터에서 **노드 상태, 버전, 역할**을 확인하라.

```bash
# 모든 클러스터의 노드 정보 확인
for ctx in platform dev staging prod; do
  echo "=== Cluster: $ctx ==="
  kubectl --context=$ctx get nodes -o wide
  echo ""
done

# 특정 노드의 상세 정보
kubectl --context=dev describe node <node-name>

# 노드 리소스 사용량
kubectl --context=dev top nodes
```

**학습 포인트:** `kubectl get nodes -o wide`는 노드의 IP, OS, 커널 버전, 컨테이너 런타임을 보여준다. CKA 시험에서는 노드 상태 확인이 기본 중의 기본이다.

---

### 실습 1-2. 컨트롤 플레인 구성 요소 확인

`platform` 클러스터의 **컨트롤 플레인 구성 요소** 상태를 확인하라.

```bash
# 컨트롤 플레인 컴포넌트 확인
kubectl --context=platform get pods -n kube-system

# 각 컴포넌트 상태
kubectl --context=platform get componentstatuses 2>/dev/null

# Static Pod 매니페스트 위치 확인 (노드에서)
ls /etc/kubernetes/manifests/

# API Server 설정 확인
kubectl --context=platform -n kube-system get pod kube-apiserver-<node> -o yaml | \
  grep -A 50 "command:"

# etcd 상태 확인
kubectl --context=platform -n kube-system get pod etcd-<node> -o yaml
```

**학습 포인트:** 컨트롤 플레인은 kube-apiserver, kube-controller-manager, kube-scheduler, etcd로 구성된다. Static Pod로 실행되며, 매니페스트는 `/etc/kubernetes/manifests/`에 위치한다.

---

### 실습 1-3. etcd 백업 및 복원

`platform` 클러스터의 **etcd를 백업하고 복원**하라.

```bash
# etcd Pod에서 엔드포인트 및 인증서 경로 확인
kubectl --context=platform -n kube-system get pod etcd-<node> -o yaml | \
  grep -E "(--cert-file|--key-file|--trusted-ca-file|--listen-client)"

# etcd 백업
ETCDCTL_API=3 etcdctl snapshot save /tmp/etcd-backup.db \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key

# 백업 검증
ETCDCTL_API=3 etcdctl snapshot status /tmp/etcd-backup.db --write-table

# etcd 복원 (테스트 목적)
ETCDCTL_API=3 etcdctl snapshot restore /tmp/etcd-backup.db \
  --data-dir=/var/lib/etcd-restored
```

**학습 포인트:** etcd 백업은 CKA 시험에서 거의 매번 출제된다. 인증서 경로를 etcd Pod의 YAML에서 정확히 확인하는 것이 핵심이다. 백업 파일의 `snapshot status`로 무결성을 확인할 수 있다.

---

### 실습 1-4. kubeconfig 파일 작성

새로운 사용자 `dev-admin`을 위한 **kubeconfig 파일을 수동으로 작성**하라. `dev` 클러스터에 접근하되, `dev-apps` 네임스페이스를 기본으로 설정하라.

```bash
# 클러스터 CA 인증서 확인
kubectl --context=dev config view --raw -o jsonpath='{.clusters[0].cluster.certificate-authority-data}' | base64 -d > /tmp/dev-ca.crt

# API Server 주소 확인
kubectl --context=dev config view -o jsonpath='{.clusters[0].cluster.server}'

# kubeconfig 생성
kubectl config set-cluster dev-cluster \
  --server=https://<api-server-address>:6443 \
  --certificate-authority=/tmp/dev-ca.crt \
  --embed-certs=true \
  --kubeconfig=/tmp/dev-admin.kubeconfig

kubectl config set-credentials dev-admin \
  --client-certificate=/path/to/dev-admin.crt \
  --client-key=/path/to/dev-admin.key \
  --embed-certs=true \
  --kubeconfig=/tmp/dev-admin.kubeconfig

kubectl config set-context dev-admin-context \
  --cluster=dev-cluster \
  --user=dev-admin \
  --namespace=dev-apps \
  --kubeconfig=/tmp/dev-admin.kubeconfig

kubectl config use-context dev-admin-context \
  --kubeconfig=/tmp/dev-admin.kubeconfig

# 테스트
kubectl --kubeconfig=/tmp/dev-admin.kubeconfig get pods
```

**학습 포인트:** kubeconfig는 clusters, users, contexts 세 섹션으로 구성된다. `--embed-certs=true`를 사용하면 인증서를 파일 내에 인라인으로 포함한다. CKA 시험에서는 kubeconfig를 수동으로 구성하는 문제가 출제될 수 있다.

---

### 실습 1-5. RBAC 설정 — Role/ClusterRole

`dev` 클러스터에서 다음 RBAC 구성을 수행하라:
- `dev-apps` 네임스페이스에 `app-manager` Role 생성 (Deployment, Service, ConfigMap CRUD 가능)
- `dev-viewer` ClusterRole 생성 (모든 리소스 읽기 전용)

```bash
# Role 생성
kubectl --context=dev create role app-manager \
  --verb=get,list,watch,create,update,delete \
  --resource=deployments,services,configmaps \
  -n dev-apps

# ClusterRole 생성
kubectl --context=dev create clusterrole dev-viewer \
  --verb=get,list,watch \
  --resource='*'

# RoleBinding
kubectl --context=dev create rolebinding app-manager-binding \
  --role=app-manager \
  --serviceaccount=dev-apps:default \
  -n dev-apps

# ClusterRoleBinding
kubectl --context=dev create clusterrolebinding dev-viewer-binding \
  --clusterrole=dev-viewer \
  --user=dev-user

# 권한 확인
kubectl --context=dev auth can-i create deployments \
  --as=system:serviceaccount:dev-apps:default -n dev-apps
# yes

kubectl --context=dev auth can-i delete nodes --as=dev-user
# no
```

**학습 포인트:** `kubectl create role`/`clusterrole` 명령을 사용하면 YAML 작성 없이 빠르게 RBAC을 설정할 수 있다. CKA 시험에서는 시간이 제한적이므로 명령형(imperative) 방식을 적극 활용해야 한다.

---

### 실습 1-6. 클러스터 인증서 확인

tart-infra 클러스터의 **인증서 만료일**을 확인하라.

```bash
# kubeadm으로 인증서 만료일 확인 (컨트롤 플레인 노드에서)
sudo kubeadm certs check-expiration

# API Server 인증서 직접 확인
openssl x509 -in /etc/kubernetes/pki/apiserver.crt -noout -text | grep -A2 "Validity"

# etcd 인증서 확인
openssl x509 -in /etc/kubernetes/pki/etcd/server.crt -noout -dates

# 인증서 갱신
sudo kubeadm certs renew all
```

**학습 포인트:** Kubernetes 인증서는 기본적으로 1년 만료이다. `kubeadm certs check-expiration`으로 모든 인증서의 만료 상태를 한눈에 확인할 수 있다.

---

### 실습 1-7. 신규 워커 노드 조인 토큰 생성

새로운 워커 노드를 클러스터에 추가하기 위한 **조인 토큰을 생성**하라.

```bash
# 기존 토큰 확인
kubeadm token list

# 새 토큰 생성 (24시간 유효)
kubeadm token create --print-join-command

# CA 인증서 해시 확인
openssl x509 -pubkey -in /etc/kubernetes/pki/ca.crt | \
  openssl rsa -pubin -outform der 2>/dev/null | \
  openssl dgst -sha256 -hex | sed 's/^.* //'
```

**학습 포인트:** `kubeadm token create --print-join-command`는 워커 노드가 실행해야 할 전체 명령어를 출력한다. 토큰의 기본 유효 기간은 24시간이다.

---

### 실습 1-8. 클러스터 업그레이드 계획 확인

현재 클러스터 버전에서 **업그레이드 가능한 버전을 확인**하라.

```bash
# 현재 버전 확인
kubectl --context=platform version --short 2>/dev/null || kubectl --context=platform version

# kubeadm 업그레이드 계획
sudo kubeadm upgrade plan

# 패키지 저장소에서 사용 가능한 버전 확인
apt-cache madison kubeadm 2>/dev/null || yum list kubeadm --showduplicates
```

**학습 포인트:** 업그레이드는 반드시 한 마이너 버전씩 순차적으로 수행해야 한다(예: 1.29 -> 1.30). `kubeadm upgrade plan`은 현재 버전과 업그레이드 가능 버전, 주의사항을 보여준다.

---

### 실습 1-9. 네임스페이스 관리

tart-infra `dev` 클러스터의 **네임스페이스 구조를 확인**하고, 새 네임스페이스를 생성하라.

```bash
# 모든 네임스페이스 확인
kubectl --context=dev get namespaces

# 네임스페이스별 리소스 확인
kubectl --context=dev get all -n argocd
kubectl --context=dev get all -n monitoring

# 새 네임스페이스 생성 (ResourceQuota 포함)
kubectl --context=dev create namespace test-ns

kubectl --context=dev apply -f - <<EOF
apiVersion: v1
kind: ResourceQuota
metadata:
  name: test-quota
  namespace: test-ns
spec:
  hard:
    pods: "10"
    requests.cpu: "2"
    requests.memory: 4Gi
    limits.cpu: "4"
    limits.memory: 8Gi
EOF

# ResourceQuota 확인
kubectl --context=dev describe quota test-quota -n test-ns
```

**학습 포인트:** ResourceQuota는 네임스페이스별 리소스 사용량을 제한한다. LimitRange는 개별 Pod/Container의 기본 리소스 제한을 설정한다. 두 가지를 함께 사용하면 효과적인 리소스 관리가 가능하다.

---

### 실습 1-10. ServiceAccount 관리

`dev` 클러스터에서 **ServiceAccount를 생성하고 토큰을 확인**하라.

```bash
# ServiceAccount 생성
kubectl --context=dev create serviceaccount app-sa -n dev-apps

# 토큰 생성 (Kubernetes 1.24+)
kubectl --context=dev create token app-sa -n dev-apps --duration=24h

# 또는 Secret 기반 토큰 생성
kubectl --context=dev apply -f - <<EOF
apiVersion: v1
kind: Secret
metadata:
  name: app-sa-token
  namespace: dev-apps
  annotations:
    kubernetes.io/service-account.name: app-sa
type: kubernetes.io/service-account-token
EOF

# 토큰 확인
kubectl --context=dev get secret app-sa-token -n dev-apps -o jsonpath='{.data.token}' | base64 -d
```

**학습 포인트:** Kubernetes 1.24부터 ServiceAccount 생성 시 자동으로 Secret이 생성되지 않는다. `kubectl create token` 명령으로 시간 제한이 있는 토큰을 생성하거나, Secret을 수동으로 생성해야 한다.

---

## 2. Workloads & Scheduling (15%)

### 실습 2-1. Deployment 생성 및 롤링 업데이트

`dev` 클러스터에서 데모 앱의 **Deployment를 확인하고 롤링 업데이트**를 수행하라.

```bash
# 기존 Deployment 확인
kubectl --context=dev get deployments --all-namespaces

# 새 Deployment 생성
kubectl --context=dev create deployment web-app \
  --image=nginx:1.24 \
  --replicas=3 \
  -n dev-apps

# 롤링 업데이트
kubectl --context=dev set image deployment/web-app \
  nginx=nginx:1.25 \
  -n dev-apps

# 업데이트 상태 확인
kubectl --context=dev rollout status deployment/web-app -n dev-apps

# 히스토리 확인
kubectl --context=dev rollout history deployment/web-app -n dev-apps

# 롤백
kubectl --context=dev rollout undo deployment/web-app -n dev-apps

# 특정 리비전으로 롤백
kubectl --context=dev rollout undo deployment/web-app --to-revision=1 -n dev-apps
```

**학습 포인트:** `kubectl rollout` 명령은 Deployment의 업데이트 상태 확인, 히스토리 조회, 롤백에 사용된다. `--record` 플래그(deprecated)가 없어도 `CHANGE-CAUSE`를 `metadata.annotations`에 기록할 수 있다.

---

### 실습 2-2. 스케일링과 HPA

`dev` 클러스터의 Deployment에 **HPA(Horizontal Pod Autoscaler)**를 설정하라.

```bash
# 수동 스케일링
kubectl --context=dev scale deployment/web-app --replicas=5 -n dev-apps

# HPA 생성
kubectl --context=dev autoscale deployment/web-app \
  --min=2 --max=10 --cpu-percent=50 \
  -n dev-apps

# HPA 상태 확인
kubectl --context=dev get hpa -n dev-apps
kubectl --context=dev describe hpa web-app -n dev-apps

# Metrics Server 확인 (HPA 동작 전제 조건)
kubectl --context=dev top pods -n dev-apps
```

**학습 포인트:** HPA가 동작하려면 Metrics Server가 설치되어 있어야 한다. `--cpu-percent`는 requests 대비 사용률을 의미한다. Pod에 CPU requests가 설정되어 있지 않으면 HPA가 동작하지 않는다.

---

### 실습 2-3. Taint/Toleration 및 Node Affinity

클러스터 노드에 **Taint를 추가하고, Toleration이 있는 Pod만 스케줄링**되도록 설정하라.

```bash
# 현재 노드의 Taint 확인
kubectl --context=dev describe nodes | grep -A3 Taints

# 노드에 Taint 추가
kubectl --context=dev taint nodes <node-name> env=production:NoSchedule

# Toleration이 있는 Pod 생성
kubectl --context=dev apply -f - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: toleration-pod
  namespace: dev-apps
spec:
  tolerations:
    - key: "env"
      operator: "Equal"
      value: "production"
      effect: "NoSchedule"
  containers:
    - name: app
      image: nginx:1.25
EOF

# Node Affinity 설정
kubectl --context=dev apply -f - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: affinity-pod
  namespace: dev-apps
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
  containers:
    - name: app
      image: nginx:1.25
EOF

# Taint 제거
kubectl --context=dev taint nodes <node-name> env=production:NoSchedule-
```

**학습 포인트:** Taint는 노드에 설정하여 Pod를 밀어내고, Toleration은 Pod에 설정하여 Taint를 허용한다. `NoSchedule`은 새 Pod 스케줄링 차단, `NoExecute`는 기존 Pod도 퇴거시킨다. Node Affinity는 Taint/Toleration보다 세밀한 스케줄링 제어를 제공한다.

---

### 실습 2-4. Static Pod 생성

컨트롤 플레인 노드에 **Static Pod를 생성**하라.

```bash
# Static Pod 매니페스트 디렉토리 확인
# kubelet 설정에서 staticPodPath 확인
cat /var/lib/kubelet/config.yaml | grep staticPodPath
# 기본값: /etc/kubernetes/manifests

# Static Pod 매니페스트 생성
sudo tee /etc/kubernetes/manifests/static-web.yaml <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: static-web
  labels:
    app: static-web
spec:
  containers:
    - name: web
      image: nginx:1.25
      ports:
        - containerPort: 80
EOF

# Static Pod 확인 (이름에 노드명이 접미사로 붙음)
kubectl get pods --all-namespaces | grep static-web

# Static Pod 삭제 (매니페스트 파일 삭제)
sudo rm /etc/kubernetes/manifests/static-web.yaml
```

**학습 포인트:** Static Pod는 kubelet이 직접 관리하며, API Server를 통해 삭제할 수 없다. 매니페스트 파일을 삭제해야 Pod가 제거된다. kube-apiserver, etcd 등 컨트롤 플레인 구성 요소가 Static Pod로 실행된다.

---

### 실습 2-5. 리소스 요청/제한 설정

`dev` 클러스터의 Deployment에 적절한 **리소스 requests/limits**를 설정하라.

```bash
# 현재 리소스 사용량 확인
kubectl --context=dev top pods -n dev-apps

# Deployment에 리소스 설정
kubectl --context=dev set resources deployment/web-app \
  --requests=cpu=50m,memory=64Mi \
  --limits=cpu=200m,memory=256Mi \
  -n dev-apps

# LimitRange 생성 (네임스페이스 기본값)
kubectl --context=dev apply -f - <<EOF
apiVersion: v1
kind: LimitRange
metadata:
  name: default-limits
  namespace: dev-apps
spec:
  limits:
    - default:
        cpu: "200m"
        memory: "256Mi"
      defaultRequest:
        cpu: "50m"
        memory: "64Mi"
      type: Container
EOF

# 확인
kubectl --context=dev describe limitrange default-limits -n dev-apps
```

**학습 포인트:** `requests`는 Pod 스케줄링에 사용되는 최소 보장 리소스이고, `limits`는 최대 사용 가능 리소스이다. LimitRange는 네임스페이스 내 Pod에 기본 리소스 값을 자동 적용한다.

---

### 실습 2-6. DaemonSet 확인 및 생성

tart-infra에서 사용 중인 **DaemonSet을 확인**하고, 새로운 DaemonSet을 생성하라.

```bash
# 기존 DaemonSet 확인 (Cilium, 모니터링 등)
kubectl --context=dev get daemonsets --all-namespaces

# Cilium DaemonSet 상세 확인
kubectl --context=dev describe daemonset cilium -n kube-system

# 로그 수집용 DaemonSet 생성
kubectl --context=dev apply -f - <<EOF
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: log-collector
  namespace: dev-apps
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
          command: ["sh", "-c", "while true; do echo \$(date) collecting logs; sleep 60; done"]
          resources:
            requests:
              cpu: 10m
              memory: 32Mi
            limits:
              cpu: 50m
              memory: 64Mi
EOF
```

**학습 포인트:** DaemonSet은 모든 노드(또는 선택된 노드)에 Pod 하나씩을 실행한다. 로그 수집, 모니터링 에이전트, 네트워크 플러그인(Cilium) 등에 사용된다. tart-infra에서는 Cilium이 DaemonSet으로 배포되어 있다.

---

### 실습 2-7. Job과 CronJob

`dev` 클러스터에서 **Job과 CronJob**을 생성하라.

```bash
# 일회성 Job 생성
kubectl --context=dev create job backup-job \
  --image=busybox:1.36 \
  -n dev-apps \
  -- sh -c "echo 'Backup completed at $(date)' && sleep 5"

# Job 상태 확인
kubectl --context=dev get jobs -n dev-apps
kubectl --context=dev logs job/backup-job -n dev-apps

# CronJob 생성 (매 5분마다)
kubectl --context=dev create cronjob health-check \
  --image=busybox:1.36 \
  --schedule="*/5 * * * *" \
  -n dev-apps \
  -- sh -c "echo 'Health check at $(date)'"

# CronJob 확인
kubectl --context=dev get cronjobs -n dev-apps
```

**학습 포인트:** Job은 지정된 수의 Pod를 성공적으로 완료할 때까지 실행한다. CronJob은 Cron 스케줄에 따라 Job을 생성한다. `completions`, `parallelism`, `backoffLimit` 등의 설정으로 동작을 세밀하게 제어할 수 있다.

---

### 실습 2-8. ConfigMap과 Secret 관리

`dev` 클러스터의 데모 앱에서 사용하는 **ConfigMap과 Secret**을 확인하고 관리하라.

```bash
# 기존 ConfigMap 확인
kubectl --context=dev get configmaps --all-namespaces | grep -v kube-system

# ConfigMap 생성
kubectl --context=dev create configmap app-config \
  --from-literal=DB_HOST=postgres.dev.svc \
  --from-literal=LOG_LEVEL=info \
  -n dev-apps

# Secret 생성
kubectl --context=dev create secret generic app-secret \
  --from-literal=DB_PASSWORD=mypassword \
  -n dev-apps

# Pod에서 ConfigMap/Secret 사용
kubectl --context=dev apply -f - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: config-test
  namespace: dev-apps
spec:
  containers:
    - name: app
      image: nginx:1.25
      envFrom:
        - configMapRef:
            name: app-config
      env:
        - name: DB_PASSWORD
          valueFrom:
            secretKeyRef:
              name: app-secret
              key: DB_PASSWORD
      volumeMounts:
        - name: config-volume
          mountPath: /etc/app-config
  volumes:
    - name: config-volume
      configMap:
        name: app-config
EOF
```

**학습 포인트:** ConfigMap은 비밀이 아닌 설정 데이터, Secret은 민감한 데이터를 저장한다. 환경변수 또는 볼륨 마운트로 Pod에 전달할 수 있다. `envFrom`은 ConfigMap의 모든 키-값을 환경변수로 로드한다.

---

## 3. Services & Networking (20%)

### 실습 3-1. Service 타입별 생성 및 확인

tart-infra의 서비스들을 확인하고, **ClusterIP, NodePort, LoadBalancer** 타입의 Service를 생성하라.

```bash
# 기존 Service 확인
kubectl --context=dev get svc --all-namespaces

# ClusterIP Service
kubectl --context=dev expose deployment web-app \
  --port=80 --target-port=80 \
  --type=ClusterIP --name=web-clusterip \
  -n dev-apps

# NodePort Service
kubectl --context=dev expose deployment web-app \
  --port=80 --target-port=80 \
  --type=NodePort --name=web-nodeport \
  -n dev-apps

# Service 확인
kubectl --context=dev get svc -n dev-apps

# Endpoints 확인
kubectl --context=dev get endpoints web-clusterip -n dev-apps

# Service에 접근 테스트
kubectl --context=dev run curl-test --rm -it --image=curlimages/curl \
  -- curl -s web-clusterip.dev-apps.svc.cluster.local
```

**학습 포인트:** tart-infra에서는 NodePort를 통해 외부 접근을 제공한다(예: Grafana:30300, ArgoCD:30800, Jenkins:30900). ClusterIP는 클러스터 내부 통신에, NodePort는 외부 노출에 사용한다.

---

### 실습 3-2. NetworkPolicy 설정 (Cilium 기반)

tart-infra는 **Cilium CNI**를 사용한다. NetworkPolicy를 생성하여 트래픽을 제어하라.

```bash
# Cilium 상태 확인
kubectl --context=dev get pods -n kube-system -l k8s-app=cilium

# 기본 거부 정책 생성
kubectl --context=dev apply -f - <<EOF
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
  namespace: dev-apps
spec:
  podSelector: {}
  policyTypes:
    - Ingress
    - Egress
EOF

# 특정 트래픽 허용
kubectl --context=dev apply -f - <<EOF
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-web-traffic
  namespace: dev-apps
spec:
  podSelector:
    matchLabels:
      app: web-app
  policyTypes:
    - Ingress
    - Egress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              role: client
      ports:
        - protocol: TCP
          port: 80
  egress:
    - to:
        - namespaceSelector: {}
          podSelector:
            matchLabels:
              k8s-app: kube-dns
      ports:
        - protocol: UDP
          port: 53
EOF

# NetworkPolicy 확인
kubectl --context=dev get networkpolicies -n dev-apps
kubectl --context=dev describe networkpolicy allow-web-traffic -n dev-apps
```

**학습 포인트:** tart-infra는 Cilium을 CNI로 사용하므로 NetworkPolicy가 완벽하게 지원된다. 기본 거부 정책을 먼저 적용하고, 필요한 트래픽만 허용하는 것이 보안 모범 사례이다. Cilium은 L7 수준의 NetworkPolicy도 지원한다.

---

### 실습 3-3. DNS 확인 및 디버깅

클러스터 내부 **DNS 동작을 확인하고 디버깅**하라.

```bash
# CoreDNS 상태 확인
kubectl --context=dev get pods -n kube-system -l k8s-app=kube-dns
kubectl --context=dev get svc -n kube-system -l k8s-app=kube-dns

# DNS 테스트 Pod에서 확인
kubectl --context=dev run dns-test --rm -it --image=busybox:1.36 \
  -- nslookup kubernetes.default.svc.cluster.local

# 서비스 DNS 확인
kubectl --context=dev run dns-test --rm -it --image=busybox:1.36 \
  -- nslookup web-clusterip.dev-apps.svc.cluster.local

# CoreDNS 설정 확인
kubectl --context=dev get configmap coredns -n kube-system -o yaml

# CoreDNS 로그 확인
kubectl --context=dev logs -l k8s-app=kube-dns -n kube-system --tail=20
```

**학습 포인트:** Kubernetes DNS 형식은 `<service>.<namespace>.svc.cluster.local`이다. Pod DNS는 `<pod-ip-dashes>.<namespace>.pod.cluster.local`이다. CKA 시험에서 DNS 디버깅 문제가 출제될 수 있다.

---

### 실습 3-4. Cilium CNI 확인

tart-infra의 **Cilium CNI 구성을 확인**하라.

```bash
# Cilium Pod 상태
kubectl --context=dev get pods -n kube-system -l k8s-app=cilium -o wide

# Cilium 상태 (cilium CLI 사용)
kubectl --context=dev exec -n kube-system ds/cilium -- cilium status

# Cilium 네트워크 정책 확인
kubectl --context=dev exec -n kube-system ds/cilium -- cilium policy get

# 노드 간 연결 확인
kubectl --context=dev exec -n kube-system ds/cilium -- cilium-health status

# Pod CIDR 확인
kubectl --context=dev get nodes -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.podCIDR}{"\n"}{end}'
```

**학습 포인트:** CNI(Container Network Interface)는 Pod 네트워킹을 담당한다. tart-infra는 Cilium을 사용하며, eBPF 기반으로 고성능 네트워킹을 제공한다. CKA 시험에서는 CNI 플러그인의 동작 원리를 이해해야 한다.

---

### 실습 3-5. Ingress 설정

`dev` 클러스터에서 **Ingress 리소스를 확인하고 생성**하라.

```bash
# 기존 Ingress 확인
kubectl --context=dev get ingress --all-namespaces

# Ingress Controller 확인
kubectl --context=dev get pods --all-namespaces | grep ingress

# Ingress 생성
kubectl --context=dev apply -f - <<EOF
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: web-ingress
  namespace: dev-apps
spec:
  rules:
    - host: web.dev.local
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: web-clusterip
                port:
                  number: 80
          - path: /api
            pathType: Prefix
            backend:
              service:
                name: api-svc
                port:
                  number: 8080
EOF

kubectl --context=dev describe ingress web-ingress -n dev-apps
```

**학습 포인트:** Ingress는 L7 라우팅을 제공한다. 호스트 기반, 경로 기반 라우팅이 가능하다. `pathType`은 `Prefix`(접두사 매칭) 또는 `Exact`(정확한 매칭)를 지정한다.

---

### 실습 3-6. 서비스 메시 개념 확인

tart-infra에서 **Hubble UI를 통해 서비스 간 통신을 관찰**하라.

```bash
# Hubble 상태 확인
kubectl --context=dev get pods -n kube-system -l k8s-app=hubble-relay

# Hubble CLI로 네트워크 흐름 관찰
kubectl --context=dev exec -n kube-system ds/cilium -- hubble observe --last 10

# 특정 네임스페이스의 트래픽 관찰
kubectl --context=dev exec -n kube-system ds/cilium -- \
  hubble observe --namespace dev-apps --last 20

# Hubble UI 접근 (NodePort로 노출되어 있는 경우)
echo "Hubble UI: http://<node-ip>:<hubble-ui-port>"
```

**학습 포인트:** Hubble은 Cilium의 관측 가능성 도구로, 서비스 간 네트워크 흐름을 실시간으로 관찰할 수 있다. CKA에서 직접 출제되지는 않지만, 네트워킹 디버깅에 유용하다.

---

### 실습 3-7. 서비스 디버깅

Service에 **접근이 안 되는 경우의 디버깅 절차**를 수행하라.

```bash
# 1. Service 확인
kubectl --context=dev get svc web-clusterip -n dev-apps

# 2. Endpoints 확인 (Pod가 연결되어 있는지)
kubectl --context=dev get endpoints web-clusterip -n dev-apps

# 3. Pod 레이블 매칭 확인
kubectl --context=dev get pods -n dev-apps --show-labels
kubectl --context=dev get svc web-clusterip -n dev-apps -o jsonpath='{.spec.selector}'

# 4. Pod 상태 확인
kubectl --context=dev get pods -n dev-apps -l app=web-app

# 5. Pod 내부에서 접근 테스트
kubectl --context=dev run debug --rm -it --image=busybox:1.36 -- wget -qO- web-clusterip.dev-apps:80

# 6. NetworkPolicy 확인
kubectl --context=dev get networkpolicies -n dev-apps
```

**학습 포인트:** Service 접근 문제의 가장 흔한 원인은 (1) selector와 Pod 레이블 불일치, (2) Pod가 Running 상태가 아님, (3) 컨테이너 포트와 targetPort 불일치, (4) NetworkPolicy에 의한 차단이다.

---

### 실습 3-8. Pod 간 통신 테스트

**서로 다른 네임스페이스의 Pod 간 통신**을 테스트하라.

```bash
# 네임스페이스 A의 Pod에서 네임스페이스 B의 Service로 접근
kubectl --context=dev run test-a -n dev-apps --rm -it --image=curlimages/curl \
  -- curl -s prometheus-server.monitoring.svc.cluster.local:9090/api/v1/status/config

# 크로스 네임스페이스 DNS 확인
kubectl --context=dev run dns-test -n dev-apps --rm -it --image=busybox:1.36 \
  -- nslookup argocd-server.argocd.svc.cluster.local
```

**학습 포인트:** 기본적으로 Kubernetes에서 모든 Pod는 모든 네임스페이스의 Pod/Service와 통신할 수 있다. NetworkPolicy를 적용하면 이 기본 동작을 제한할 수 있다. DNS FQDN을 사용하면 네임스페이스 간 통신이 가능하다.

---

## 4. Storage (10%)

### 실습 4-1. PersistentVolumeClaim 생성 및 사용

`dev` 클러스터에서 **PVC를 생성하고 Pod에 마운트**하라.

```bash
# StorageClass 확인
kubectl --context=dev get storageclass

# PVC 생성
kubectl --context=dev apply -f - <<EOF
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: data-pvc
  namespace: dev-apps
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 1Gi
EOF

# PVC를 사용하는 Pod 생성
kubectl --context=dev apply -f - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: storage-pod
  namespace: dev-apps
spec:
  containers:
    - name: app
      image: nginx:1.25
      volumeMounts:
        - name: data
          mountPath: /data
  volumes:
    - name: data
      persistentVolumeClaim:
        claimName: data-pvc
EOF

# PVC 상태 확인
kubectl --context=dev get pvc -n dev-apps
kubectl --context=dev get pv
```

**학습 포인트:** PVC는 스토리지를 요청하는 리소스이다. StorageClass가 설정되어 있으면 동적 프로비저닝으로 PV가 자동 생성된다. `accessModes`는 `ReadWriteOnce`(단일 노드 읽기/쓰기), `ReadOnlyMany`(다수 노드 읽기), `ReadWriteMany`(다수 노드 읽기/쓰기)가 있다.

---

### 실습 4-2. StorageClass 확인 및 생성

클러스터의 **StorageClass를 확인**하고, 새로운 StorageClass를 생성하라.

```bash
# 기존 StorageClass 확인
kubectl --context=dev get storageclass
kubectl --context=dev describe storageclass <name>

# 기본 StorageClass 확인
kubectl --context=dev get storageclass -o jsonpath='{.items[?(@.metadata.annotations.storageclass\.kubernetes\.io/is-default-class=="true")].metadata.name}'

# StorageClass 상세 정보
kubectl --context=dev get storageclass -o yaml
```

**학습 포인트:** StorageClass는 동적 프로비저닝의 기반이다. `reclaimPolicy`는 `Delete`(PVC 삭제 시 PV도 삭제) 또는 `Retain`(PV 보존)을 설정한다. `volumeBindingMode: WaitForFirstConsumer`는 Pod가 스케줄될 때까지 PV 바인딩을 지연한다.

---

### 실습 4-3. PV 라이프사이클 관리

**PersistentVolume의 생성, 바인딩, 회수** 라이프사이클을 실습하라.

```bash
# 수동 PV 생성
kubectl --context=dev apply -f - <<EOF
apiVersion: v1
kind: PersistentVolume
metadata:
  name: manual-pv
spec:
  capacity:
    storage: 2Gi
  accessModes:
    - ReadWriteOnce
  persistentVolumeReclaimPolicy: Retain
  hostPath:
    path: /data/manual-pv
EOF

# PV를 사용하는 PVC 생성
kubectl --context=dev apply -f - <<EOF
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: manual-pvc
  namespace: dev-apps
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 2Gi
  storageClassName: ""
  volumeName: manual-pv
EOF

# 바인딩 확인
kubectl --context=dev get pv manual-pv
kubectl --context=dev get pvc manual-pvc -n dev-apps

# PVC 삭제 후 PV 상태 확인 (Retain 정책)
kubectl --context=dev delete pvc manual-pvc -n dev-apps
kubectl --context=dev get pv manual-pv
# STATUS: Released
```

**학습 포인트:** PV 상태는 Available -> Bound -> Released -> (Available 또는 삭제)로 변한다. `Retain` 정책에서 PVC를 삭제하면 PV는 `Released` 상태가 되며, 재사용하려면 `claimRef`를 제거해야 한다.

---

### 실습 4-4. emptyDir과 hostPath 볼륨

**emptyDir과 hostPath 볼륨**을 사용하는 Pod를 생성하라.

```bash
# emptyDir (사이드카 컨테이너 간 데이터 공유)
kubectl --context=dev apply -f - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: sidecar-pod
  namespace: dev-apps
spec:
  containers:
    - name: writer
      image: busybox:1.36
      command: ["sh", "-c", "while true; do echo \$(date) >> /shared/log.txt; sleep 5; done"]
      volumeMounts:
        - name: shared-data
          mountPath: /shared
    - name: reader
      image: busybox:1.36
      command: ["sh", "-c", "tail -f /shared/log.txt"]
      volumeMounts:
        - name: shared-data
          mountPath: /shared
  volumes:
    - name: shared-data
      emptyDir: {}
EOF

# 확인
kubectl --context=dev logs sidecar-pod -c reader -n dev-apps --tail=5
```

**학습 포인트:** `emptyDir`은 Pod 내 컨테이너 간 데이터 공유에 사용된다. Pod가 삭제되면 데이터도 사라진다. `hostPath`는 호스트 파일시스템을 직접 마운트하며, 보안상 주의가 필요하다.

---

### 실습 4-5. 기존 인프라의 PVC 확인

tart-infra에서 **Prometheus, Grafana 등의 PVC 상태**를 확인하라.

```bash
# 모든 네임스페이스의 PVC 확인
kubectl --context=dev get pvc --all-namespaces

# PV 확인
kubectl --context=dev get pv

# 특정 PVC 상세 정보
kubectl --context=dev describe pvc -n monitoring

# PVC 용량 확인
kubectl --context=dev get pvc --all-namespaces -o custom-columns=\
'NAMESPACE:.metadata.namespace,NAME:.metadata.name,STATUS:.status.phase,CAPACITY:.status.capacity.storage,STORAGECLASS:.spec.storageClassName'
```

**학습 포인트:** Prometheus, Grafana 등의 모니터링 도구는 데이터 지속성을 위해 PVC를 사용한다. `custom-columns` 출력 형식을 사용하면 필요한 정보만 추출할 수 있어 CKA 시험에서 유용하다.

---

## 5. Troubleshooting (30%)

### 실습 5-1. Pod 상태 진단

`dev` 클러스터에서 **문제가 있는 Pod를 진단**하라.

```bash
# Pod 상태 확인
kubectl --context=dev get pods --all-namespaces | grep -v Running | grep -v Completed

# 문제 Pod 상세 확인
kubectl --context=dev describe pod <pod-name> -n <namespace>

# 로그 확인
kubectl --context=dev logs <pod-name> -n <namespace>
kubectl --context=dev logs <pod-name> -n <namespace> --previous

# 이벤트 확인 (시간순)
kubectl --context=dev get events -n <namespace> --sort-by='.lastTimestamp'

# Pod 내부 디버깅
kubectl --context=dev exec -it <pod-name> -n <namespace> -- sh

# 일반적인 오류 패턴:
# - CrashLoopBackOff: 컨테이너 반복 재시작 -> 로그 확인
# - ImagePullBackOff: 이미지 풀 실패 -> 이미지 이름, 레지스트리 인증 확인
# - Pending: 스케줄링 불가 -> describe로 Events 확인
# - OOMKilled: 메모리 초과 -> 리소스 limits 조정
```

**학습 포인트:** CKA 시험의 30%가 트러블슈팅이다. `kubectl describe`의 Events 섹션과 `kubectl logs`가 핵심 도구이다. `--previous` 플래그는 이전 컨테이너의 로그를 보여주어 CrashLoopBackOff 디버깅에 필수적이다.

---

### 실습 5-2. kubelet 트러블슈팅

노드의 **kubelet 상태를 확인하고 문제를 해결**하라.

```bash
# kubelet 상태 확인
sudo systemctl status kubelet

# kubelet 로그 확인
sudo journalctl -u kubelet --since "30 minutes ago" --no-pager | tail -50

# kubelet 설정 확인
sudo cat /var/lib/kubelet/config.yaml

# kubelet 재시작
sudo systemctl restart kubelet

# 노드 상태가 NotReady인 경우 확인 사항:
# 1. kubelet 서비스 상태
sudo systemctl status kubelet
# 2. 컨테이너 런타임 상태
sudo systemctl status containerd
# 3. 인증서 유효성
sudo openssl x509 -in /var/lib/kubelet/pki/kubelet.crt -noout -dates
# 4. 디스크 공간
df -h
# 5. swap 상태 (비활성화 필요)
free -h
```

**학습 포인트:** 노드가 `NotReady` 상태일 때 가장 먼저 확인할 것은 kubelet 서비스 상태이다. `journalctl -u kubelet`으로 상세 로그를 확인할 수 있다. 일반적인 원인은 kubelet 서비스 중단, 인증서 만료, 디스크 풀, 컨테이너 런타임 문제이다.

---

### 실습 5-3. 이벤트 및 로그 분석

클러스터 **이벤트를 수집하고 분석**하라.

```bash
# 클러스터 전체 이벤트 (최근 1시간)
kubectl --context=dev get events --all-namespaces --sort-by='.lastTimestamp' | tail -30

# Warning 이벤트만 필터링
kubectl --context=dev get events --all-namespaces --field-selector type=Warning

# 특정 리소스의 이벤트
kubectl --context=dev get events -n dev-apps --field-selector involvedObject.name=web-app

# kube-apiserver 로그
kubectl --context=dev logs -n kube-system kube-apiserver-<node> --tail=30

# kube-scheduler 로그
kubectl --context=dev logs -n kube-system kube-scheduler-<node> --tail=30

# kube-controller-manager 로그
kubectl --context=dev logs -n kube-system kube-controller-manager-<node> --tail=30
```

**학습 포인트:** `--field-selector`로 이벤트를 필터링할 수 있다. 컨트롤 플레인 구성 요소의 로그는 Pod 로그로 확인할 수 있다. CKA 시험에서는 이벤트를 통해 문제의 원인을 빠르게 파악해야 한다.

---

### 실습 5-4. 네트워크 트러블슈팅

Pod 간 **네트워크 연결 문제를 디버깅**하라.

```bash
# 디버깅 Pod 생성
kubectl --context=dev run netdebug --rm -it \
  --image=nicolaka/netshoot \
  -n dev-apps -- bash

# Pod 내부에서 실행:
# DNS 확인
nslookup kubernetes.default
dig web-clusterip.dev-apps.svc.cluster.local

# 연결 테스트
curl -v web-clusterip.dev-apps:80
nc -zv web-clusterip.dev-apps 80
ping <pod-ip>

# 라우팅 테이블 확인
ip route

# 네트워크 인터페이스 확인
ip addr

# traceroute
traceroute <target-ip>

# NetworkPolicy 영향 확인
kubectl --context=dev get networkpolicies -n dev-apps -o yaml
```

**학습 포인트:** `nicolaka/netshoot` 이미지는 네트워크 디버깅에 필요한 모든 도구를 포함한다. CKA 시험에서는 `busybox`나 `curl` 이미지로 충분하지만, 실무에서는 netshoot이 유용하다. NetworkPolicy가 트래픽을 차단하고 있는지 반드시 확인해야 한다.

---

### 실습 5-5. 인증서 관련 트러블슈팅

클러스터 **인증서 문제를 진단하고 해결**하라.

```bash
# 모든 인증서 만료일 확인
sudo kubeadm certs check-expiration

# 특정 인증서 상세 확인
openssl x509 -in /etc/kubernetes/pki/apiserver.crt -noout -text

# 인증서 체인 검증
openssl verify -CAfile /etc/kubernetes/pki/ca.crt /etc/kubernetes/pki/apiserver.crt

# 인증서 갱신 (만료 시)
sudo kubeadm certs renew apiserver
sudo kubeadm certs renew apiserver-kubelet-client

# kubelet 인증서 갱신
sudo kubeadm certs renew all

# 갱신 후 컨트롤 플레인 재시작
sudo systemctl restart kubelet
```

**학습 포인트:** Kubernetes 인증서 만료는 클러스터 중단의 주요 원인 중 하나이다. `kubeadm certs check-expiration`으로 정기적으로 확인하고, `kubeadm certs renew`로 갱신한다. 갱신 후 kubelet 재시작이 필요할 수 있다.

---

### 실습 5-6. Deployment 롤백

**문제가 있는 Deployment를 이전 버전으로 롤백**하라.

```bash
# 현재 상태 확인
kubectl --context=dev rollout status deployment/web-app -n dev-apps

# 히스토리 확인
kubectl --context=dev rollout history deployment/web-app -n dev-apps

# 특정 리비전 상세 확인
kubectl --context=dev rollout history deployment/web-app --revision=2 -n dev-apps

# 이전 버전으로 롤백
kubectl --context=dev rollout undo deployment/web-app -n dev-apps

# 특정 리비전으로 롤백
kubectl --context=dev rollout undo deployment/web-app --to-revision=1 -n dev-apps

# 롤백 확인
kubectl --context=dev rollout status deployment/web-app -n dev-apps
kubectl --context=dev get pods -n dev-apps -l app=web-app
```

**학습 포인트:** `kubectl rollout undo`는 Deployment를 이전 리비전으로 되돌린다. `--to-revision` 플래그로 특정 리비전을 지정할 수 있다. 롤백 후에도 새로운 리비전 번호가 생성된다.

---

### 실습 5-7. 리소스 부족 문제 해결

**리소스 부족으로 인한 스케줄링 실패**를 진단하고 해결하라.

```bash
# Pending 상태 Pod 확인
kubectl --context=dev get pods --all-namespaces --field-selector status.phase=Pending

# 원인 확인
kubectl --context=dev describe pod <pending-pod> -n <namespace>
# Events:
#   Warning  FailedScheduling  ... 0/3 nodes are available: 3 Insufficient cpu

# 노드 리소스 확인
kubectl --context=dev top nodes
kubectl --context=dev describe nodes | grep -A5 "Allocated resources"

# ResourceQuota 확인
kubectl --context=dev get resourcequota --all-namespaces

# 해결 방법:
# 1. Pod의 리소스 요청 줄이기
kubectl --context=dev set resources deployment/web-app \
  --requests=cpu=50m,memory=64Mi -n dev-apps

# 2. 불필요한 Pod 삭제
kubectl --context=dev delete pod <unnecessary-pod> -n dev-apps

# 3. ResourceQuota 조정
kubectl --context=dev edit resourcequota -n dev-apps
```

**학습 포인트:** `FailedScheduling` 이벤트는 노드에 충분한 리소스가 없음을 의미한다. `kubectl describe nodes`의 `Allocated resources` 섹션에서 현재 할당량을 확인할 수 있다. requests를 줄이거나 불필요한 워크로드를 정리하는 것이 해결 방법이다.

---

### 실습 5-8. 모니터링 도구 활용 — Prometheus/Grafana

tart-infra의 **Prometheus와 Grafana를 활용한 문제 탐지**를 수행하라.

```bash
# Prometheus 접근 (NodePort)
echo "Prometheus UI: http://<node-ip>:30090"

# 주요 PromQL 쿼리
# CPU 사용률이 높은 Pod
# container_cpu_usage_seconds_total

# 메모리 사용률이 높은 Pod
# container_memory_working_set_bytes

# Pod 재시작 횟수
# kube_pod_container_status_restarts_total

# Grafana 접근 (NodePort 30300)
echo "Grafana UI: http://<node-ip>:30300"

# API Server 상태
kubectl --context=dev get --raw /healthz
kubectl --context=dev get --raw /readyz

# Prometheus API로 메트릭 확인
kubectl --context=dev run prom-test --rm -it --image=curlimages/curl \
  -- curl -s 'prometheus-server.monitoring:9090/api/v1/query?query=up'
```

**학습 포인트:** tart-infra는 Prometheus(:30090)와 Grafana(:30300)가 설치되어 있다. CKA 시험에서는 `kubectl top` 명령을 사용하지만, 실무에서는 Prometheus/Grafana가 필수적이다. Pod 재시작 횟수, CPU/메모리 사용률 등을 모니터링하여 문제를 사전에 탐지할 수 있다.

---

### 실습 5-9. CoreDNS 트러블슈팅

**CoreDNS가 정상 동작하지 않는 경우**를 진단하고 해결하라.

```bash
# CoreDNS Pod 상태 확인
kubectl --context=dev get pods -n kube-system -l k8s-app=kube-dns

# CoreDNS 로그 확인
kubectl --context=dev logs -n kube-system -l k8s-app=kube-dns --tail=30

# CoreDNS ConfigMap 확인
kubectl --context=dev get configmap coredns -n kube-system -o yaml

# DNS 테스트
kubectl --context=dev run dns-test --rm -it --image=busybox:1.36 -- nslookup kubernetes

# DNS Service 확인
kubectl --context=dev get svc kube-dns -n kube-system

# Endpoints 확인
kubectl --context=dev get endpoints kube-dns -n kube-system

# CoreDNS가 CrashLoopBackOff인 경우:
# 1. ConfigMap의 Corefile 문법 확인
# 2. 상위 DNS 서버 연결 확인
# 3. CoreDNS Pod 재시작
kubectl --context=dev rollout restart deployment coredns -n kube-system
```

**학습 포인트:** CoreDNS 문제는 클러스터 전체 서비스에 영향을 미친다. 가장 흔한 원인은 ConfigMap(Corefile) 설정 오류, 상위 DNS 서버 접근 불가, CoreDNS Pod 리소스 부족이다. DNS 서비스의 Endpoints가 비어 있으면 CoreDNS Pod가 정상적으로 실행되지 않는 것이다.

---

### 실습 5-10. 종합 트러블슈팅 체크리스트

클러스터의 **전반적인 건강 상태를 점검**하는 체크리스트를 수행하라.

```bash
#!/bin/bash
CTX=${1:-dev}
echo "=== 클러스터 건강 상태 점검: $CTX ==="

echo ""
echo "[ 1. 노드 상태 ]"
kubectl --context=$CTX get nodes

echo ""
echo "[ 2. 컨트롤 플레인 ]"
kubectl --context=$CTX get pods -n kube-system | grep -E "(apiserver|controller|scheduler|etcd)"

echo ""
echo "[ 3. 비정상 Pod ]"
kubectl --context=$CTX get pods --all-namespaces | grep -v Running | grep -v Completed

echo ""
echo "[ 4. Warning 이벤트 ]"
kubectl --context=$CTX get events --all-namespaces --field-selector type=Warning --sort-by='.lastTimestamp' | tail -10

echo ""
echo "[ 5. 리소스 사용량 ]"
kubectl --context=$CTX top nodes 2>/dev/null || echo "Metrics server not available"

echo ""
echo "[ 6. PVC 상태 ]"
kubectl --context=$CTX get pvc --all-namespaces | grep -v Bound

echo ""
echo "[ 7. 네트워크 ]"
kubectl --context=$CTX get svc --all-namespaces | head -20

echo ""
echo "=== 점검 완료 ==="
```

```bash
# 각 클러스터에 대해 실행
for ctx in platform dev staging prod; do
  bash health-check.sh $ctx
  echo ""
done
```

**학습 포인트:** 체계적인 트러블슈팅은 노드 -> 컨트롤 플레인 -> Pod -> 네트워크 -> 스토리지 순서로 진행하는 것이 효과적이다. CKA 시험에서는 시간이 제한적이므로, `kubectl get pods --all-namespaces`로 전체 현황을 빠르게 파악한 후 문제를 좁혀 나가야 한다.

---

## tart-infra 주요 접근 정보

| 서비스 | 접근 방법 | 비고 |
|--------|----------|------|
| Grafana | `http://<node-ip>:30300` | 모니터링 대시보드 |
| ArgoCD | `http://<node-ip>:30800` | GitOps 배포 관리 |
| Jenkins | `http://<node-ip>:30900` | CI/CD 파이프라인 |
| AlertManager | `http://<node-ip>:30903` | 알림 관리 |
| Prometheus | `http://<node-ip>:30090` | 메트릭 수집 |
