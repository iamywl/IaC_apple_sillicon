# KCNA 실습 가이드 — tart-infra 활용

> 이 문서는 tart-infra 환경의 4개 Kubernetes 클러스터(platform/dev/staging/prod)를 활용하여 KCNA 시험의 5개 도메인을 실습하는 가이드이다.
> 실제 클러스터에서 직접 명령어를 실행하며 개념을 체득하는 것이 목표이다.

| 도메인 | 비중 | 실습 수 |
|--------|------|---------|
| Kubernetes Fundamentals | 46% | 12 |
| Container Orchestration | 22% | 6 |
| Cloud Native Architecture | 16% | 5 |
| Cloud Native Observability | 8% | 4 |
| Cloud Native Application Delivery | 8% | 4 |

---

## 사전 준비

### kubeconfig 설정

```bash
# 현재 컨텍스트 확인
kubectl config get-contexts

# dev 클러스터로 전환 (데모 앱이 배포되어 있는 클러스터)
kubectl config use-context dev

# 각 클러스터 노드 확인
for ctx in platform dev staging prod; do
  echo "=== $ctx ==="
  kubectl --context=$ctx get nodes -o wide
done
```

### 필수 도구 확인

```bash
# kubectl 버전 확인
kubectl version --client

# helm 확인
helm version

# 접근 가능한 서비스
echo "Grafana:      http://<node-ip>:30300"
echo "ArgoCD:       http://<node-ip>:30800"
echo "Jenkins:      http://<node-ip>:30900"
echo "AlertManager: http://<node-ip>:30903"
```

---

## 1. Kubernetes Fundamentals (46%)

### 실습 1-1. 클러스터 구조 파악 — 노드 확인

tart-infra의 4개 클러스터에서 **노드의 역할과 상태**를 확인하라.

```bash
# 모든 클러스터의 노드 목록
for ctx in platform dev staging prod; do
  echo "=== Cluster: $ctx ==="
  kubectl --context=$ctx get nodes -o wide
  echo ""
done

# 특정 노드의 상세 정보
kubectl describe node <node-name>

# 노드 레이블 확인
kubectl get nodes --show-labels

# 컨트롤 플레인과 워커 노드 구분
kubectl get nodes -l node-role.kubernetes.io/control-plane
```

**학습 포인트:** Kubernetes 클러스터는 컨트롤 플레인(Control Plane)과 워커 노드(Worker Node)로 구성된다. 컨트롤 플레인은 API Server, Scheduler, Controller Manager, etcd를 실행한다. 워커 노드는 kubelet과 컨테이너 런타임을 통해 Pod를 실행한다.

---

### 실습 1-2. Pod — 쿠버네티스의 최소 단위

**Pod를 생성, 확인, 삭제**하는 기본 작업을 수행하라.

```bash
# Pod 생성 (명령형)
kubectl run my-pod --image=nginx:1.25

# Pod 목록 확인
kubectl get pods
kubectl get pods -o wide

# Pod 상세 정보
kubectl describe pod my-pod

# Pod 로그 확인
kubectl logs my-pod

# Pod 내부 접속
kubectl exec -it my-pod -- bash

# Pod 삭제
kubectl delete pod my-pod
```

```yaml
# Pod YAML 선언형 생성
apiVersion: v1
kind: Pod
metadata:
  name: my-pod
  labels:
    app: my-app
spec:
  containers:
    - name: web
      image: nginx:1.25
      ports:
        - containerPort: 80
```

```bash
kubectl apply -f pod.yaml
```

**학습 포인트:** Pod는 Kubernetes의 최소 배포 단위이다. 하나 이상의 컨테이너를 포함하며, 같은 Pod 내 컨테이너는 네트워크와 스토리지를 공유한다. `kubectl run`은 명령형(imperative), `kubectl apply -f`는 선언형(declarative) 방식이다.

---

### 실습 1-3. Deployment — 워크로드 관리

**Deployment를 생성하고 관리**하라. tart-infra의 데모 앱 Deployment를 확인하라.

```bash
# dev 클러스터의 Deployment 확인
kubectl --context=dev get deployments --all-namespaces

# Deployment 생성
kubectl create deployment web-app --image=nginx:1.25 --replicas=3

# Deployment 확인
kubectl get deployments
kubectl get replicasets
kubectl get pods -l app=web-app

# 스케일링
kubectl scale deployment web-app --replicas=5

# 이미지 업데이트 (롤링 업데이트)
kubectl set image deployment/web-app nginx=nginx:1.26

# 롤아웃 상태 확인
kubectl rollout status deployment/web-app

# 롤백
kubectl rollout undo deployment/web-app

# 삭제
kubectl delete deployment web-app
```

**학습 포인트:** Deployment는 Pod의 선언적 업데이트를 관리한다. ReplicaSet을 통해 원하는 수의 Pod를 유지한다. 롤링 업데이트(Rolling Update)는 기본 전략으로, 무중단으로 새 버전을 배포한다.

---

### 실습 1-4. Service — Pod에 대한 네트워크 접근

**Service를 생성하여 Pod에 접근**하라.

```bash
# dev 클러스터의 Service 확인
kubectl --context=dev get svc --all-namespaces

# ClusterIP Service 생성
kubectl expose deployment web-app --port=80 --target-port=80 --type=ClusterIP

# NodePort Service 생성
kubectl expose deployment web-app --port=80 --target-port=80 --type=NodePort --name=web-nodeport

# Service 확인
kubectl get svc
kubectl describe svc web-app

# Service를 통한 접근 테스트
kubectl run curl-test --rm -it --image=curlimages/curl \
  -- curl -s web-app.default.svc.cluster.local
```

**학습 포인트:** Service는 Pod에 안정적인 네트워크 접근을 제공한다. Pod의 IP는 변경될 수 있지만, Service의 ClusterIP는 고정이다. 타입은 ClusterIP(내부), NodePort(외부-노드포트), LoadBalancer(외부-클라우드) 세 가지가 있다.

---

### 실습 1-5. ConfigMap — 설정 데이터 관리

**ConfigMap을 생성하고 Pod에서 사용**하라.

```bash
# ConfigMap 생성 (리터럴)
kubectl create configmap app-config \
  --from-literal=APP_ENV=development \
  --from-literal=LOG_LEVEL=info \
  --from-literal=DB_HOST=postgres.dev.svc

# ConfigMap 확인
kubectl get configmap app-config -o yaml

# ConfigMap을 환경변수로 사용하는 Pod
kubectl apply -f - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: config-pod
spec:
  containers:
    - name: app
      image: busybox:1.36
      command: ["sh", "-c", "env && sleep 3600"]
      envFrom:
        - configMapRef:
            name: app-config
EOF

# 환경변수 확인
kubectl exec config-pod -- env | grep -E "(APP_ENV|LOG_LEVEL|DB_HOST)"

# ConfigMap을 볼륨으로 마운트
kubectl apply -f - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: config-volume-pod
spec:
  containers:
    - name: app
      image: busybox:1.36
      command: ["sh", "-c", "cat /etc/config/* && sleep 3600"]
      volumeMounts:
        - name: config
          mountPath: /etc/config
  volumes:
    - name: config
      configMap:
        name: app-config
EOF

kubectl exec config-volume-pod -- ls /etc/config/
kubectl exec config-volume-pod -- cat /etc/config/APP_ENV
```

**학습 포인트:** ConfigMap은 비밀이 아닌 설정 데이터를 키-값 쌍으로 저장한다. 환경변수 또는 볼륨 마운트 방식으로 Pod에 전달할 수 있다. 설정을 코드와 분리하는 Cloud Native 원칙의 핵심이다.

---

### 실습 1-6. Namespace — 리소스 격리

**Namespace를 생성하고 리소스를 격리**하라.

```bash
# 현재 네임스페이스 확인
kubectl get namespaces

# tart-infra에서 사용 중인 네임스페이스
kubectl --context=dev get namespaces

# 네임스페이스 생성
kubectl create namespace test-ns

# 네임스페이스에 Pod 생성
kubectl run test-pod --image=nginx:1.25 -n test-ns

# 네임스페이스별 리소스 확인
kubectl get all -n test-ns
kubectl get all -n kube-system

# 기본 네임스페이스 변경
kubectl config set-context --current --namespace=test-ns

# 네임스페이스 삭제 (내부 리소스도 함께 삭제)
kubectl delete namespace test-ns
```

**학습 포인트:** Namespace는 클러스터 내 리소스를 논리적으로 격리한다. tart-infra에서는 `monitoring`, `argocd`, `kube-system` 등 용도별 네임스페이스를 사용한다. 같은 네임스페이스의 리소스는 이름으로 접근하고, 다른 네임스페이스는 FQDN(`<svc>.<ns>.svc.cluster.local`)을 사용한다.

---

### 실습 1-7. kubectl 핵심 명령어 마스터

**kubectl의 핵심 명령어**를 연습하라.

```bash
# 리소스 조회
kubectl get pods,svc,deployments
kubectl get all --all-namespaces

# 출력 형식 변경
kubectl get pods -o wide          # 추가 정보 (IP, 노드)
kubectl get pods -o yaml          # YAML 형식
kubectl get pods -o json          # JSON 형식
kubectl get pods -o name          # 이름만

# 커스텀 컬럼
kubectl get pods -o custom-columns='NAME:.metadata.name,STATUS:.status.phase,NODE:.spec.nodeName'

# 정렬
kubectl get pods --sort-by='.metadata.creationTimestamp'

# 레이블 필터
kubectl get pods -l app=nginx
kubectl get pods -l 'app in (nginx, web-app)'

# JSONPath
kubectl get nodes -o jsonpath='{.items[*].metadata.name}'
kubectl get pods -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.status.phase}{"\n"}{end}'

# 리소스 설명 (API 레퍼런스)
kubectl explain pod.spec.containers
kubectl explain deployment.spec.strategy

# dry-run으로 YAML 생성
kubectl run my-pod --image=nginx --dry-run=client -o yaml > pod.yaml
kubectl create deployment my-dep --image=nginx --dry-run=client -o yaml > dep.yaml
```

**학습 포인트:** `kubectl`은 Kubernetes를 관리하는 CLI 도구이다. `--dry-run=client -o yaml`은 YAML 템플릿을 빠르게 생성하는 데 유용하다. `kubectl explain`은 리소스 필드의 설명을 확인할 수 있어 공식 문서를 대체할 수 있다.

---

### 실습 1-8. Secret — 민감 데이터 관리

**Secret을 생성하고 Pod에서 사용**하라.

```bash
# Secret 생성
kubectl create secret generic db-secret \
  --from-literal=username=admin \
  --from-literal=password='P@ssw0rd!'

# Secret 확인 (base64 인코딩됨)
kubectl get secret db-secret -o yaml

# Secret 값 디코딩
kubectl get secret db-secret -o jsonpath='{.data.password}' | base64 -d

# Secret을 Pod에서 사용
kubectl apply -f - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: secret-pod
spec:
  containers:
    - name: app
      image: busybox:1.36
      command: ["sh", "-c", "echo Username: \$DB_USER && sleep 3600"]
      env:
        - name: DB_USER
          valueFrom:
            secretKeyRef:
              name: db-secret
              key: username
        - name: DB_PASS
          valueFrom:
            secretKeyRef:
              name: db-secret
              key: password
EOF

kubectl exec secret-pod -- env | grep DB_
```

**학습 포인트:** Secret은 비밀번호, 토큰, 인증서 등 민감한 데이터를 저장한다. ConfigMap과 유사하지만, base64로 인코딩되어 저장된다. 주의: base64는 암호화가 아니므로, etcd 암호화를 별도로 설정해야 진정한 보안이 보장된다.

---

### 실습 1-9. ReplicaSet과 자가 복구

**ReplicaSet의 자가 복구(self-healing) 동작**을 확인하라.

```bash
# Deployment를 통해 ReplicaSet 생성
kubectl create deployment self-heal --image=nginx:1.25 --replicas=3

# ReplicaSet 확인
kubectl get replicasets

# Pod 하나 삭제 후 자가 복구 확인
kubectl get pods -l app=self-heal
kubectl delete pod <pod-name>
kubectl get pods -l app=self-heal -w  # 실시간 관찰
# 삭제된 Pod가 즉시 새로 생성되는 것을 확인

# 노드에서 Pod 강제 종료 시뮬레이션
kubectl get pods -l app=self-heal -o wide  # 노드 확인
```

**학습 포인트:** Kubernetes의 핵심 기능 중 하나가 자가 복구(Self-Healing)이다. ReplicaSet은 원하는 수의 Pod 복제본(replicas)을 항상 유지한다. Pod가 삭제되거나 노드 장애가 발생하면 자동으로 새 Pod를 생성한다.

---

### 실습 1-10. Label과 Selector

**Label을 사용하여 리소스를 조직하고 선택**하라.

```bash
# 현재 Pod의 레이블 확인
kubectl --context=dev get pods --all-namespaces --show-labels | head -20

# 레이블 추가
kubectl label pod my-pod env=production tier=frontend

# 레이블로 필터링
kubectl get pods -l env=production
kubectl get pods -l 'env in (production, staging)'
kubectl get pods -l env!=development

# 레이블 수정
kubectl label pod my-pod env=staging --overwrite

# 레이블 삭제
kubectl label pod my-pod tier-

# 여러 리소스에서 레이블 사용 확인
kubectl --context=dev get pods,svc -l app=prometheus -n monitoring
```

**학습 포인트:** Label은 키-값 쌍으로, Kubernetes 리소스를 조직하고 선택하는 데 사용된다. Service의 `selector`는 Label을 기반으로 Pod를 선택한다. Label은 Kubernetes의 느슨한 결합(Loose Coupling) 아키텍처의 핵심이다.

---

### 실습 1-11. Annotation

**Annotation을 사용하여 리소스에 메타데이터를 추가**하라.

```bash
# Annotation 추가
kubectl annotate pod my-pod description="This is a test pod" owner="team-alpha"

# Annotation 확인
kubectl describe pod my-pod | grep Annotations

# tart-infra 리소스의 Annotation 확인
kubectl --context=dev get deployment -n argocd argocd-server -o jsonpath='{.metadata.annotations}' | jq .

# Annotation 삭제
kubectl annotate pod my-pod description-
```

**학습 포인트:** Annotation은 Label과 달리 선택(selection)에 사용되지 않는다. 빌드 정보, 관리 도구 설정, 문서 링크 등 비식별 메타데이터를 저장하는 데 사용된다. ArgoCD, Prometheus 등 많은 도구가 Annotation을 활용한다.

---

### 실습 1-12. API 리소스 탐색

**Kubernetes API 리소스 구조를 탐색**하라.

```bash
# 모든 API 리소스 목록
kubectl api-resources

# 네임스페이스 범위의 리소스
kubectl api-resources --namespaced=true

# 클러스터 범위의 리소스
kubectl api-resources --namespaced=false

# 특정 API 그룹
kubectl api-resources --api-group=apps

# API 버전 확인
kubectl api-versions

# 리소스 필드 설명
kubectl explain pods
kubectl explain pods.spec
kubectl explain pods.spec.containers.resources
```

**학습 포인트:** Kubernetes는 선언적 API를 중심으로 동작한다. 모든 리소스는 API 그룹, 버전, 리소스 종류로 구분된다. `kubectl api-resources`로 클러스터에서 사용 가능한 모든 리소스를 확인할 수 있다.

---

## 2. Container Orchestration (22%)

### 실습 2-1. 컨테이너 런타임 확인 — containerd

tart-infra에서 사용하는 **컨테이너 런타임(containerd)**의 상태를 확인하라.

```bash
# 노드의 컨테이너 런타임 확인
kubectl get nodes -o wide
# CONTAINER-RUNTIME 열에서 containerd 확인

# containerd 상태 확인 (노드에서)
sudo systemctl status containerd

# crictl로 컨테이너 확인 (containerd CLI)
sudo crictl ps
sudo crictl images

# 컨테이너 런타임 버전
sudo containerd --version
```

**학습 포인트:** 컨테이너 런타임은 실제 컨테이너를 실행하는 소프트웨어이다. Kubernetes는 CRI(Container Runtime Interface)를 통해 런타임과 통신한다. tart-infra는 containerd를 사용한다. Docker는 Kubernetes 1.24부터 지원이 중단되었다.

---

### 실습 2-2. 자가 복구(Self-Healing) 동작 확인

Kubernetes의 **자가 복구 메커니즘**을 실제로 확인하라.

```bash
# Deployment 생성 (replicas=3)
kubectl create deployment heal-test --image=nginx:1.25 --replicas=3

# Pod 목록 확인
kubectl get pods -l app=heal-test -o wide

# Pod 하나를 강제 삭제
POD=$(kubectl get pods -l app=heal-test -o jsonpath='{.items[0].metadata.name}')
kubectl delete pod $POD

# 즉시 새 Pod가 생성되는지 확인
kubectl get pods -l app=heal-test -w

# 헬스 체크 실패 시뮬레이션
kubectl apply -f - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: health-test
spec:
  containers:
    - name: app
      image: busybox:1.36
      command: ["sh", "-c", "touch /tmp/healthy && sleep 30 && rm /tmp/healthy && sleep 600"]
      livenessProbe:
        exec:
          command: ["cat", "/tmp/healthy"]
        initialDelaySeconds: 5
        periodSeconds: 5
EOF

# 30초 후 livenessProbe 실패로 Pod 재시작 확인
kubectl get pod health-test -w
kubectl describe pod health-test | grep -A10 "Events:"
```

**학습 포인트:** 자가 복구는 세 가지 수준에서 동작한다: (1) ReplicaSet이 Pod 수를 유지, (2) livenessProbe가 컨테이너 건강 상태를 확인하고 재시작, (3) readinessProbe가 트래픽 수신 준비 상태를 확인. 이것이 컨테이너 오케스트레이션의 핵심 가치이다.

---

### 실습 2-3. 스케줄링 동작 이해

Kubernetes의 **스케줄러가 Pod를 노드에 배치하는 과정**을 확인하라.

```bash
# Pod가 어떤 노드에 스케줄되었는지 확인
kubectl get pods -o wide

# 스케줄러가 고려하는 노드 리소스
kubectl describe nodes | grep -A10 "Allocated resources"

# nodeSelector로 특정 노드에 배치
kubectl apply -f - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: node-select-pod
spec:
  nodeSelector:
    kubernetes.io/os: linux
  containers:
    - name: app
      image: nginx:1.25
EOF

# Pod의 스케줄링 이벤트 확인
kubectl describe pod node-select-pod | grep -A5 "Events:"

# 스케줄러 로그 확인
kubectl --context=dev logs -n kube-system kube-scheduler-<node> --tail=10
```

**학습 포인트:** kube-scheduler는 노드의 가용 리소스, affinity/anti-affinity, taint/toleration, nodeSelector 등을 종합적으로 고려하여 Pod를 배치한다. `describe pod`의 Events에서 스케줄링 결정을 확인할 수 있다.

---

### 실습 2-4. 롤링 업데이트와 롤백

**롤링 업데이트 전략**을 확인하고 롤백을 수행하라.

```bash
# Deployment의 업데이트 전략 확인
kubectl get deployment web-app -o yaml | grep -A10 strategy

# 이미지 업데이트 (롤링 업데이트 발생)
kubectl set image deployment/web-app nginx=nginx:1.26

# 업데이트 진행 상태 실시간 관찰
kubectl rollout status deployment/web-app

# ReplicaSet 히스토리 확인
kubectl get replicasets -l app=web-app
kubectl rollout history deployment/web-app

# 롤백
kubectl rollout undo deployment/web-app

# 업데이트 일시 중지/재개
kubectl rollout pause deployment/web-app
kubectl rollout resume deployment/web-app
```

**학습 포인트:** 롤링 업데이트는 `maxSurge`(최대 초과 Pod 수)와 `maxUnavailable`(최대 사용 불가 Pod 수)로 제어한다. 기본값은 각각 25%이다. 롤백 시 이전 ReplicaSet의 Pod 템플릿으로 되돌아간다.

---

### 실습 2-5. DaemonSet과 StatefulSet 이해

tart-infra에서 사용 중인 **DaemonSet과 StatefulSet**을 확인하라.

```bash
# DaemonSet 확인 (모든 노드에 실행되는 Pod)
kubectl --context=dev get daemonsets --all-namespaces
# Cilium이 DaemonSet으로 실행되는 것을 확인

# DaemonSet 상세 정보
kubectl --context=dev describe daemonset cilium -n kube-system

# StatefulSet 확인 (상태를 유지하는 워크로드)
kubectl --context=dev get statefulsets --all-namespaces

# StatefulSet의 특징 확인
# - 순서 보장된 Pod 이름 (pod-0, pod-1, pod-2)
# - 안정적인 네트워크 ID
# - 순서대로 생성/삭제
```

**학습 포인트:** DaemonSet은 모든 노드에 Pod 하나를 실행한다(로그 수집, 모니터링 에이전트, CNI). StatefulSet은 상태가 있는 워크로드(데이터베이스, 메시지 큐)를 위한 것으로, 순서 보장과 안정적인 네트워크 ID를 제공한다. Deployment는 상태 없는(stateless) 워크로드에 사용한다.

---

### 실습 2-6. Job과 CronJob

**일회성 작업(Job)과 주기적 작업(CronJob)**을 실습하라.

```bash
# Job 생성
kubectl create job backup-job --image=busybox:1.36 \
  -- sh -c "echo 'Backup completed at $(date)'"

# Job 상태 확인
kubectl get jobs
kubectl describe job backup-job
kubectl logs job/backup-job

# CronJob 생성 (매 5분마다)
kubectl create cronjob health-check \
  --image=busybox:1.36 \
  --schedule="*/5 * * * *" \
  -- sh -c "echo 'Check at $(date)'"

# CronJob 확인
kubectl get cronjobs
kubectl get jobs --watch

# CronJob 삭제
kubectl delete cronjob health-check
```

**학습 포인트:** Job은 작업이 성공적으로 완료될 때까지 Pod를 실행한다. CronJob은 Cron 형식의 스케줄에 따라 Job을 자동 생성한다. 배치 처리, 백업, 정기 점검 등에 사용된다.

---

## 3. Cloud Native Architecture (16%)

### 실습 3-1. CNCF 프로젝트 확인 — tart-infra에 설치된 도구

tart-infra에 설치된 **CNCF 프로젝트들을 확인**하라.

```bash
# tart-infra에서 사용하는 CNCF 프로젝트 확인
echo "=== CNCF Graduated ==="
echo "- Kubernetes: 컨테이너 오케스트레이션"
echo "- Prometheus: 모니터링 및 메트릭 수집"
echo "- Helm: 패키지 매니저"
echo "- containerd: 컨테이너 런타임"

echo ""
echo "=== CNCF Incubating ==="
echo "- Cilium: CNI 및 네트워크 보안"
echo "- ArgoCD: GitOps 배포 도구"

echo ""
echo "=== CNCF Sandbox / 기타 ==="
echo "- Grafana: 대시보드 및 시각화"
echo "- Loki: 로그 수집"
echo "- AlertManager: 알림 관리"

# 실제 설치 확인
kubectl --context=dev get pods -n kube-system | grep cilium
kubectl --context=dev get pods -n monitoring | grep prometheus
kubectl --context=dev get pods -n argocd | grep argocd
kubectl --context=dev get pods -n monitoring | grep grafana
```

**학습 포인트:** CNCF(Cloud Native Computing Foundation)는 클라우드 네이티브 오픈소스 프로젝트를 관리한다. 프로젝트는 Sandbox -> Incubating -> Graduated 단계를 거친다. Kubernetes, Prometheus, containerd는 Graduated 프로젝트이다. KCNA 시험에서 CNCF 프로젝트의 역할과 성숙도 단계를 묻는 문제가 출제된다.

---

### 실습 3-2. 마이크로서비스 아키텍처 확인

tart-infra의 **데모 앱이 마이크로서비스 패턴을 따르는지** 확인하라.

```bash
# dev 클러스터의 데모 앱 구성 확인
kubectl --context=dev get deployments --all-namespaces | grep -v kube-system
kubectl --context=dev get svc --all-namespaces | grep -v kube-system

# 서비스 간 관계 파악
kubectl --context=dev get pods --all-namespaces -o wide

# ConfigMap으로 외부화된 설정 확인
kubectl --context=dev get configmaps --all-namespaces | grep -v kube-system

# Secret으로 관리되는 민감 정보 확인
kubectl --context=dev get secrets --all-namespaces | grep -v kube-system | grep -v default-token
```

**학습 포인트:** 마이크로서비스 아키텍처는 애플리케이션을 독립적으로 배포 가능한 작은 서비스들로 분해한다. 각 서비스는 자체 데이터베이스를 가지고, API를 통해 통신한다. Kubernetes의 Service, ConfigMap, Secret은 마이크로서비스 패턴을 자연스럽게 지원한다.

---

### 실습 3-3. 서비스 메시 개념 — Cilium/Hubble

tart-infra의 **Cilium과 Hubble을 통해 서비스 메시 개념**을 이해하라.

```bash
# Cilium 상태 확인
kubectl --context=dev get pods -n kube-system -l k8s-app=cilium

# Cilium 상태 상세
kubectl --context=dev exec -n kube-system ds/cilium -- cilium status --brief

# Hubble (관측 가능성)
kubectl --context=dev exec -n kube-system ds/cilium -- hubble observe --last 5

# 네트워크 정책 확인 (서비스 메시의 트래픽 제어)
kubectl --context=dev get networkpolicies --all-namespaces
```

**학습 포인트:** 서비스 메시는 마이크로서비스 간 통신을 관리하는 인프라 계층이다. Istio, Linkerd가 대표적이며, Cilium도 서비스 메시 기능을 제공한다. 주요 기능은 트래픽 관리, mTLS, 관측 가능성, 접근 제어이다. tart-infra에서는 Cilium + Hubble로 네트워크 트래픽을 관찰할 수 있다.

---

### 실습 3-4. HPA — 자동 스케일링

**HPA(Horizontal Pod Autoscaler)**를 설정하고 동작을 확인하라.

```bash
# Deployment에 리소스 요청 설정 (HPA 전제 조건)
kubectl apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: hpa-test
spec:
  replicas: 1
  selector:
    matchLabels:
      app: hpa-test
  template:
    metadata:
      labels:
        app: hpa-test
    spec:
      containers:
        - name: app
          image: nginx:1.25
          resources:
            requests:
              cpu: 50m
              memory: 64Mi
            limits:
              cpu: 200m
              memory: 128Mi
EOF

# HPA 생성
kubectl autoscale deployment hpa-test --min=1 --max=5 --cpu-percent=50

# HPA 상태 확인
kubectl get hpa
kubectl describe hpa hpa-test

# Metrics Server 확인
kubectl top pods
```

**학습 포인트:** HPA는 CPU/메모리 사용률에 따라 Pod 수를 자동으로 조정한다. 동작 전제 조건은 (1) Metrics Server 설치, (2) Pod에 리소스 requests 설정이다. VPA(Vertical Pod Autoscaler)는 Pod의 리소스 requests/limits를 자동 조정한다.

---

### 실습 3-5. Cloud Native 원칙 확인

tart-infra 구성이 **12-Factor App 원칙을 따르는지** 확인하라.

```bash
# Factor 3: 설정의 외부화 — ConfigMap/Secret
kubectl --context=dev get configmaps -n monitoring

# Factor 6: 무상태 프로세스 — Deployment
kubectl --context=dev get deployments --all-namespaces

# Factor 8: 동시성 — 스케일링
kubectl --context=dev get hpa --all-namespaces 2>/dev/null

# Factor 9: 폐기 용이성 — Pod 생명주기
kubectl --context=dev get pods -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.terminationGracePeriodSeconds}{"\n"}{end}' -n monitoring

# Factor 11: 로그 — stdout/stderr
kubectl --context=dev logs -n monitoring deployment/prometheus-server --tail=5

# IaC(Infrastructure as Code) — tart-infra의 Terraform/Helm 사용
helm --kube-context=dev list --all-namespaces
```

**학습 포인트:** Cloud Native 원칙은 애플리케이션이 클라우드 환경에서 최적으로 동작하도록 하는 설계 원칙이다. 핵심은 (1) 설정 외부화, (2) 무상태 설계, (3) 로그를 스트림으로 처리, (4) IaC, (5) 마이크로서비스이다. KCNA 시험에서 이러한 원칙에 대한 이해를 묻는다.

---

## 4. Cloud Native Observability (8%)

### 실습 4-1. Grafana 대시보드 탐색

tart-infra의 **Grafana(:30300)에 접속하여 대시보드**를 확인하라.

```bash
# Grafana 접근 확인
echo "Grafana UI: http://<node-ip>:30300"

# Grafana Pod 상태
kubectl --context=dev get pods -n monitoring -l app.kubernetes.io/name=grafana

# Grafana Service 확인
kubectl --context=dev get svc -n monitoring | grep grafana

# Grafana 데이터소스 확인 (Prometheus)
kubectl --context=dev get configmaps -n monitoring | grep grafana

# Grafana에서 확인할 주요 대시보드:
# - Kubernetes Cluster Overview: 클러스터 전체 현황
# - Node Exporter: 노드별 CPU, 메모리, 디스크
# - Pod Resources: Pod별 리소스 사용량
# - Network: 네트워크 트래픽
```

**학습 포인트:** Grafana는 Prometheus 등의 데이터소스에서 수집한 메트릭을 시각화하는 대시보드 도구이다. tart-infra에서는 NodePort 30300으로 접근할 수 있다. 대시보드를 통해 클러스터 건강 상태를 한눈에 파악할 수 있다.

---

### 실습 4-2. PromQL 기본 쿼리

**Prometheus에서 PromQL로 메트릭을 조회**하라.

```bash
# Prometheus API로 직접 쿼리
kubectl --context=dev run prom-query --rm -it --image=curlimages/curl -- \
  curl -s 'http://prometheus-server.monitoring:9090/api/v1/query?query=up' | jq .

# 주요 PromQL 쿼리 예시 (Prometheus UI에서 실행)

# 1. 실행 중인 타겟 수
# up

# 2. 노드 CPU 사용률
# 100 - (avg by(instance)(rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)

# 3. 노드 메모리 사용률
# (1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes) * 100

# 4. Pod 재시작 횟수
# kube_pod_container_status_restarts_total

# 5. 네임스페이스별 Pod 수
# count by(namespace)(kube_pod_info)

# Prometheus 타겟 상태 확인
kubectl --context=dev run prom-query --rm -it --image=curlimages/curl -- \
  curl -s 'http://prometheus-server.monitoring:9090/api/v1/targets' | jq '.data.activeTargets | length'
```

**학습 포인트:** PromQL(Prometheus Query Language)은 Prometheus에 저장된 시계열 데이터를 조회하는 언어이다. `rate()`는 카운터 메트릭의 초당 증가율을, `avg by()`는 그룹별 평균을 계산한다. KCNA에서는 기본적인 PromQL 개념을 이해하고 있어야 한다.

---

### 실습 4-3. Loki를 통한 로그 관리

tart-infra에서 **Loki를 통해 로그를 조회**하라.

```bash
# Loki Pod 상태 확인
kubectl --context=dev get pods -n monitoring | grep loki

# Loki Service 확인
kubectl --context=dev get svc -n monitoring | grep loki

# 직접 로그 확인 (kubectl 사용)
kubectl --context=dev logs -n monitoring deployment/prometheus-server --tail=10

# 모든 Pod의 로그 확인 (특정 네임스페이스)
for pod in $(kubectl --context=dev get pods -n monitoring -o name); do
  echo "=== $pod ==="
  kubectl --context=dev logs $pod -n monitoring --tail=3 2>/dev/null
done

# Grafana에서 Loki 데이터소스로 로그 조회
# LogQL 예시:
# {namespace="monitoring"} |= "error"
# {app="prometheus"} | json | level="error"
```

**학습 포인트:** Loki는 Grafana Labs에서 개발한 로그 수집 시스템이다. Prometheus와 유사한 레이블 기반 접근 방식을 사용한다. LogQL로 로그를 필터링하고 집계할 수 있다. Grafana에서 로그와 메트릭을 함께 확인하면 문제의 원인을 빠르게 파악할 수 있다.

---

### 실습 4-4. AlertManager를 통한 알림 관리

tart-infra의 **AlertManager(:30903)를 확인**하라.

```bash
# AlertManager 접근
echo "AlertManager UI: http://<node-ip>:30903"

# AlertManager Pod 상태
kubectl --context=dev get pods -n monitoring | grep alertmanager

# AlertManager Service
kubectl --context=dev get svc -n monitoring | grep alertmanager

# 현재 활성 알림 확인
kubectl --context=dev run alert-check --rm -it --image=curlimages/curl -- \
  curl -s http://alertmanager.monitoring:9093/api/v2/alerts | jq '.[].labels.alertname'

# Prometheus Alert Rules 확인
kubectl --context=dev get configmap -n monitoring prometheus-server -o yaml | \
  grep -A5 "alerting_rules"

# 알림 상태 확인
kubectl --context=dev run alert-check --rm -it --image=curlimages/curl -- \
  curl -s 'http://prometheus-server.monitoring:9090/api/v1/alerts' | jq '.data.alerts | length'
```

**학습 포인트:** AlertManager는 Prometheus가 발생시킨 알림을 관리하고 라우팅한다. 주요 기능은 알림 그룹핑(Grouping), 억제(Inhibition), 무음(Silencing)이다. 알림을 Slack, Email, PagerDuty 등으로 전송할 수 있다. tart-infra에서는 NodePort 30903으로 접근한다.

---

## 5. Cloud Native Application Delivery (8%)

### 실습 5-1. ArgoCD를 통한 GitOps 배포

tart-infra의 **ArgoCD(:30800)를 확인하고 GitOps 워크플로**를 이해하라.

```bash
# ArgoCD 접근
echo "ArgoCD UI: http://<node-ip>:30800"

# ArgoCD Pod 상태
kubectl --context=dev get pods -n argocd

# ArgoCD 서비스 확인
kubectl --context=dev get svc -n argocd

# ArgoCD 초기 admin 비밀번호 확인
kubectl --context=dev get secret argocd-initial-admin-secret -n argocd \
  -o jsonpath='{.data.password}' | base64 -d && echo

# ArgoCD Application 목록 확인
kubectl --context=dev get applications -n argocd

# ArgoCD Application 상세 정보
kubectl --context=dev describe application <app-name> -n argocd

# ArgoCD CLI 사용 (설치된 경우)
argocd app list
argocd app get <app-name>
argocd app sync <app-name>
```

**학습 포인트:** ArgoCD는 GitOps 기반의 배포 도구이다. Git 저장소를 Single Source of Truth로 사용하며, Git의 원하는 상태와 클러스터의 실제 상태를 자동으로 동기화한다. KCNA에서는 GitOps의 개념과 장점(감사 추적, 롤백 용이성, 선언적 관리)을 이해해야 한다.

---

### 실습 5-2. Helm을 통한 패키지 관리

tart-infra에서 **Helm으로 배포된 차트를 확인**하라.

```bash
# 설치된 Helm 릴리스 확인
helm --kube-context=dev list --all-namespaces

# 특정 릴리스 상세 정보
helm --kube-context=dev status <release-name> -n <namespace>

# Helm 차트 값(values) 확인
helm --kube-context=dev get values <release-name> -n <namespace>

# Helm 릴리스 히스토리
helm --kube-context=dev history <release-name> -n <namespace>

# 차트 검색
helm search repo prometheus
helm search hub grafana

# 차트 정보 확인
helm show chart prometheus-community/prometheus
helm show values prometheus-community/prometheus | head -50
```

**학습 포인트:** Helm은 Kubernetes의 패키지 매니저이다. Chart(패키지), Release(설치된 인스턴스), Repository(차트 저장소) 세 가지 핵심 개념이 있다. `helm list`로 설치된 릴리스를 확인하고, `helm get values`로 커스텀 설정값을 확인한다. tart-infra의 Prometheus, Grafana 등이 Helm으로 배포되어 있다.

---

### 실습 5-3. Jenkins를 통한 CI/CD 파이프라인

tart-infra의 **Jenkins(:30900)를 확인**하라.

```bash
# Jenkins 접근
echo "Jenkins UI: http://<node-ip>:30900"

# Jenkins Pod 상태
kubectl --context=dev get pods --all-namespaces | grep jenkins

# Jenkins Service
kubectl --context=dev get svc --all-namespaces | grep jenkins

# Jenkins 초기 비밀번호 확인
kubectl --context=dev exec -it <jenkins-pod> -n <namespace> -- cat /var/jenkins_home/secrets/initialAdminPassword 2>/dev/null

# CI/CD 파이프라인 개념:
# 1. CI (Continuous Integration)
#    - 코드 커밋 -> 빌드 -> 테스트 -> 이미지 빌드 -> 레지스트리 푸시
# 2. CD (Continuous Delivery/Deployment)
#    - 이미지 업데이트 -> ArgoCD가 감지 -> 클러스터에 배포
```

**학습 포인트:** Jenkins는 오픈소스 CI/CD 자동화 서버이다. 파이프라인을 통해 빌드, 테스트, 배포를 자동화한다. tart-infra에서는 Jenkins(CI) + ArgoCD(CD) 조합으로 전체 CI/CD 파이프라인을 구성할 수 있다. KCNA에서는 CI/CD 개념과 GitOps의 관계를 이해해야 한다.

---

### 실습 5-4. 배포 전략 비교

다양한 **배포 전략의 차이점을 실습**으로 확인하라.

```bash
# 1. 롤링 업데이트 (기본 전략)
kubectl apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: rolling-deploy
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  selector:
    matchLabels:
      app: rolling-deploy
  template:
    metadata:
      labels:
        app: rolling-deploy
    spec:
      containers:
        - name: app
          image: nginx:1.24
EOF

# 롤링 업데이트 실행 및 관찰
kubectl set image deployment/rolling-deploy app=nginx:1.25
kubectl rollout status deployment/rolling-deploy

# 2. Recreate 전략 (모든 Pod를 먼저 삭제 후 재생성)
kubectl apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: recreate-deploy
spec:
  replicas: 3
  strategy:
    type: Recreate
  selector:
    matchLabels:
      app: recreate-deploy
  template:
    metadata:
      labels:
        app: recreate-deploy
    spec:
      containers:
        - name: app
          image: nginx:1.24
EOF

kubectl set image deployment/recreate-deploy app=nginx:1.25
kubectl get pods -l app=recreate-deploy -w

# 3. 블루/그린 배포 (Service selector 변경)
# 블루 (현재 버전)
kubectl create deployment blue --image=nginx:1.24 --replicas=3
kubectl expose deployment blue --port=80 --name=app-svc

# 그린 (새 버전) - 새 Deployment 생성
kubectl create deployment green --image=nginx:1.25 --replicas=3

# 트래픽 전환 (Service selector 변경)
kubectl patch svc app-svc -p '{"spec":{"selector":{"app":"green"}}}'
```

**학습 포인트:** 주요 배포 전략은 세 가지이다: (1) 롤링 업데이트 — 점진적 교체, 무중단, (2) Recreate — 전체 중단 후 재생성, 빠르지만 다운타임 발생, (3) 블루/그린 — 두 환경을 준비하고 트래픽을 전환, 빠른 롤백 가능. 카나리(Canary) 배포는 일부 트래픽만 새 버전으로 보내는 방식이다.

---

## 학습 참고

| 리소스 | 설명 |
|--------|------|
| [Kubernetes 공식 문서](https://kubernetes.io/docs/) | 핵심 개념 및 API 레퍼런스 |
| [CNCF Landscape](https://landscape.cncf.io/) | CNCF 프로젝트 전체 지도 |
| [KCNA 공식 커리큘럼](https://github.com/cncf/curriculum) | 시험 범위 및 비중 |
| [12-Factor App](https://12factor.net/) | Cloud Native 애플리케이션 원칙 |
| [Helm 공식 문서](https://helm.sh/docs/) | 패키지 관리 |
| [ArgoCD 공식 문서](https://argo-cd.readthedocs.io/) | GitOps 배포 |

### tart-infra 주요 접근 정보

| 서비스 | 포트 | 용도 |
|--------|------|------|
| Grafana | `:30300` | 메트릭 대시보드 |
| ArgoCD | `:30800` | GitOps 배포 관리 |
| Jenkins | `:30900` | CI/CD 파이프라인 |
| AlertManager | `:30903` | 알림 관리 |
