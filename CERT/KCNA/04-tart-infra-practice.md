# KCNA 실습 가이드 — tart-infra 활용

> 이 문서는 tart-infra 환경의 4개 Kubernetes 클러스터(platform / dev / staging / prod)를 활용하여 KCNA 시험의 5개 도메인을 실습하는 종합 가이드이다.
> 실제 클러스터에서 직접 명령어를 실행하며 개념을 체득하는 것이 목표이다.
> 모든 실습은 tart-infra의 실제 인프라 구성을 기반으로 하며, 각 Lab마다 학습 목표, 단계별 명령어, 기대 출력 설명, 확인 문제, 관련 KCNA 시험 주제를 포함한다.

---

## 인프라 개요

### 클러스터 구성

| 클러스터 | 용도 | Pod CIDR |
|----------|------|----------|
| platform | 플랫폼 서비스 (모니터링, CI/CD) | 10.10.0.0/16 |
| dev | 개발 환경 (데모 앱 배포) | 10.20.0.0/16 |
| staging | 스테이징 환경 | 10.30.0.0/16 |
| prod | 프로덕션 환경 | 10.40.0.0/16 |

### SSH 접속 정보

```
사용자: admin
비밀번호: admin
```

### 데모 앱 구성 (dev 클러스터, demo 네임스페이스)

| 앱 | 이미지 | 레플리카 | 서비스 타입 | 포트 |
|----|--------|----------|-------------|------|
| nginx-web | nginx:alpine | 3 | NodePort 30080 | 80 |
| httpbin v1 | kong/httpbin:latest | 2 | ClusterIP | 80 |
| httpbin v2 | kong/httpbin:latest | 1 | — | 80 |
| redis | redis:7-alpine | 1 | ClusterIP | 6379 |
| postgres | postgres:16-alpine | 1 | ClusterIP | 5432 |
| rabbitmq | rabbitmq:3-management-alpine | 1 | ClusterIP | 5672/15672 |
| keycloak | quay.io/keycloak/keycloak:latest | 1 | NodePort 30880 | 8080 |

### 리소스 설정 (nginx-web 기준)

| 항목 | 값 |
|------|-----|
| requests.cpu | 50m |
| requests.memory | 64Mi |
| limits.cpu | 200m |
| limits.memory | 128Mi |

### HPA 설정

| 대상 | min → max | CPU 임계치 |
|------|-----------|-----------|
| nginx-web | 3 → 10 | 50% |
| httpbin | 2 → 6 | — |
| redis | 1 → 4 | — |
| postgres | 1 → 4 | — |
| rabbitmq | 1 → 3 | — |

### PDB 설정

| 대상 | minAvailable |
|------|-------------|
| nginx-web | 2 |
| httpbin | 1 |
| redis | 1 |
| postgres | 1 |
| rabbitmq | 1 |
| keycloak | 1 |

### 모니터링 접근 정보

| 서비스 | 포트 | 인증 |
|--------|------|------|
| Grafana | :30300 | admin / admin |
| AlertManager | :30903 | — |
| Prometheus | — | 7일 보관, 10Gi |
| ArgoCD | :30800 | — |
| Jenkins | :30900 | admin / admin |
| Hubble UI | :31235 | — |

### KCNA 도메인별 실습 매핑

| 도메인 | 비중 | 실습 |
|--------|------|------|
| Kubernetes Fundamentals | 46% | 실습 1 ~ 4 |
| Container Orchestration | 22% | 실습 5 |
| Cloud Native Architecture | 16% | 실습 6 |
| Cloud Native Observability | 8% | 실습 7 |
| Cloud Native Application Delivery | 8% | 실습 8 |

---

## 사전 준비

### kubeconfig 설정

tart-infra의 4개 클러스터에 접근하기 위해 kubeconfig를 설정한다.

```bash
# 1. 현재 설정된 컨텍스트 목록 확인
kubectl config get-contexts
```

**기대 출력:**

```
CURRENT   NAME       CLUSTER    AUTHINFO   NAMESPACE
          platform   platform   admin
*         dev        dev        admin
          staging    staging    admin
          prod       prod       admin
```

4개의 컨텍스트(platform, dev, staging, prod)가 모두 표시되어야 한다.

```bash
# 2. dev 클러스터로 전환 (데모 앱이 배포된 클러스터)
kubectl config use-context dev

# 3. 전환 확인
kubectl config current-context
```

**기대 출력:** `dev`

```bash
# 4. 각 클러스터 노드 상태 확인
for ctx in platform dev staging prod; do
  echo "========================================="
  echo "클러스터: $ctx"
  echo "========================================="
  kubectl --context=$ctx get nodes -o wide
  echo ""
done
```

**기대 출력:** 각 클러스터마다 노드 목록이 출력된다. 노드의 STATUS가 모두 `Ready`인지 확인한다. CONTAINER-RUNTIME 열에서 `containerd`를 확인한다.

### 필수 도구 확인

```bash
# kubectl 버전
kubectl version --client

# helm 버전
helm version

# 접근 가능한 서비스 URL 확인
echo "============================================="
echo "서비스 접근 정보"
echo "============================================="
echo "Grafana:       http://<node-ip>:30300  (admin/admin)"
echo "ArgoCD:        http://<node-ip>:30800"
echo "Jenkins:       http://<node-ip>:30900  (admin/admin)"
echo "AlertManager:  http://<node-ip>:30903"
echo "Hubble UI:     http://<node-ip>:31235"
echo "nginx-web:     http://<node-ip>:30080"
echo "Keycloak:      http://<node-ip>:30880"
```

### 데모 네임스페이스 확인

```bash
# demo 네임스페이스 존재 확인
kubectl --context=dev get namespace demo

# demo 네임스페이스의 모든 리소스 확인
kubectl --context=dev get all -n demo
```

**기대 출력:** Deployment, ReplicaSet, Pod, Service 등이 모두 표시된다. nginx-web 3개, httpbin 관련 Pod 3개(v1 2개 + v2 1개), redis 1개, postgres 1개, rabbitmq 1개, keycloak 1개가 확인되어야 한다.

---

## 실습 1: Kubernetes 아키텍처 이해 (Fundamentals 46%)

> Kubernetes 클러스터의 Control Plane과 Worker Node 구성 요소를 직접 확인하고, 각 컴포넌트의 역할을 이해한다.

---

### Lab 1.1: 4개 클러스터의 Control Plane 구성 확인

**학습 목표:**
- Kubernetes Control Plane의 4대 핵심 컴포넌트(API Server, etcd, Scheduler, Controller Manager)를 식별한다.
- 4개 클러스터(platform, dev, staging, prod)의 Control Plane이 동일한 구조인지 비교한다.
- 각 컴포넌트가 Static Pod로 실행되는 원리를 이해한다.

**Step 1: kube-system 네임스페이스의 Control Plane Pod 확인**

```bash
# 각 클러스터의 kube-system Pod 확인
for ctx in platform dev staging prod; do
  echo "========================================="
  echo "클러스터: $ctx — Control Plane Pods"
  echo "========================================="
  kubectl --context=$ctx get pods -n kube-system \
    -l tier=control-plane \
    -o custom-columns='NAME:.metadata.name,STATUS:.status.phase,NODE:.spec.nodeName'
  echo ""
done
```

**기대 출력:** 각 클러스터에서 다음 4개의 Control Plane Pod가 표시된다:
- `kube-apiserver-<node>` — API Server
- `etcd-<node>` — etcd (분산 키-값 저장소)
- `kube-scheduler-<node>` — Scheduler
- `kube-controller-manager-<node>` — Controller Manager

**Step 2: API Server 상세 정보 확인**

```bash
# dev 클러스터의 API Server Pod 상세 확인
kubectl --context=dev describe pod -n kube-system \
  $(kubectl --context=dev get pods -n kube-system -l component=kube-apiserver -o name)
```

**기대 출력:** Pod의 상세 정보가 출력된다. 다음 항목을 확인한다:
- `Image`: API Server의 이미지 버전
- `Args`: 실행 인자 (--etcd-servers, --service-cluster-ip-range 등)
- `Ports`: 6443 (HTTPS)
- `Status`: Running

**Step 3: API Server의 주요 설정 인자 확인**

```bash
# API Server의 실행 인자만 추출
kubectl --context=dev get pod -n kube-system \
  -l component=kube-apiserver \
  -o jsonpath='{.items[0].spec.containers[0].command}' | tr ',' '\n'
```

**기대 출력:** `--etcd-servers`, `--service-cluster-ip-range`, `--advertise-address` 등의 인자가 표시된다. 이것은 API Server가 etcd와 통신하고, Service IP 범위를 관리하는 방법을 보여준다.

**Step 4: Controller Manager 확인**

```bash
# Controller Manager Pod 확인
kubectl --context=dev describe pod -n kube-system \
  $(kubectl --context=dev get pods -n kube-system -l component=kube-controller-manager -o name)
```

**기대 출력:** Controller Manager의 인자에서 `--cluster-cidr` 값을 확인한다. dev 클러스터의 경우 `10.20.0.0/16`이 설정되어 있어야 한다.

**Step 5: 4개 클러스터의 Pod CIDR 비교**

```bash
# 각 클러스터의 Pod CIDR 확인
for ctx in platform dev staging prod; do
  echo "=== $ctx ==="
  kubectl --context=$ctx get pod -n kube-system \
    -l component=kube-controller-manager \
    -o jsonpath='{.items[0].spec.containers[0].command}' | tr ',' '\n' | grep cluster-cidr
  echo ""
done
```

**기대 출력:**
- platform: `--cluster-cidr=10.10.0.0/16`
- dev: `--cluster-cidr=10.20.0.0/16`
- staging: `--cluster-cidr=10.30.0.0/16`
- prod: `--cluster-cidr=10.40.0.0/16`

각 클러스터마다 서로 다른 Pod CIDR이 할당되어 있음을 확인한다.

**Step 6: Static Pod 매니페스트 확인 (SSH 접속 필요)**

```bash
# SSH로 노드에 접속
ssh admin@<node-ip>
# 비밀번호: admin

# Static Pod 매니페스트 디렉토리 확인
ls -la /etc/kubernetes/manifests/
```

**기대 출력:**
```
-rw------- 1 root root  etcd.yaml
-rw------- 1 root root  kube-apiserver.yaml
-rw------- 1 root root  kube-controller-manager.yaml
-rw------- 1 root root  kube-scheduler.yaml
```

Static Pod는 kubelet이 직접 관리하는 Pod이다. `/etc/kubernetes/manifests/` 디렉토리에 YAML 파일을 넣으면 kubelet이 자동으로 해당 Pod를 실행한다.

**확인 문제:**
1. Control Plane의 4대 컴포넌트는 무엇인가? 각각의 역할을 한 줄로 설명하라.
2. Static Pod와 일반 Pod의 차이점은 무엇인가?
3. 4개 클러스터의 Pod CIDR이 서로 다른 이유는 무엇인가?
4. API Server가 사용하는 포트 번호는 무엇인가?

**관련 KCNA 시험 주제:** Kubernetes Fundamentals — Kubernetes Architecture, Control Plane Components

---

### Lab 1.2: Worker Node 구성 요소 확인

**학습 목표:**
- Worker Node의 3대 핵심 컴포넌트(kubelet, kube-proxy, Container Runtime)를 확인한다.
- kubelet의 역할과 설정을 파악한다.
- Container Runtime Interface(CRI)의 개념을 이해한다.

**Step 1: Worker Node 목록 확인**

```bash
# 모든 노드 목록과 역할 확인
kubectl --context=dev get nodes -o wide
```

**기대 출력:**

```
NAME         STATUS   ROLES           AGE   VERSION   INTERNAL-IP   EXTERNAL-IP   OS-IMAGE   KERNEL-VERSION   CONTAINER-RUNTIME
<node-name>  Ready    control-plane   ...   v1.xx     <IP>          <none>        ...        ...              containerd://x.x.x
```

`CONTAINER-RUNTIME` 열에서 `containerd`가 사용되고 있음을 확인한다.

**Step 2: 노드의 상세 정보 확인**

```bash
# 노드 상세 정보 확인
kubectl --context=dev describe node $(kubectl --context=dev get nodes -o jsonpath='{.items[0].metadata.name}')
```

**기대 출력 중 확인할 항목:**
- `Conditions`: Ready, MemoryPressure, DiskPressure, PIDPressure
- `Capacity`: CPU, 메모리, Pod 수 제한
- `Allocatable`: 실제 사용 가능한 리소스
- `Allocated resources`: 현재 할당된 리소스

**Step 3: 노드의 리소스 사용량 확인**

```bash
# 노드 리소스 사용량 (Metrics Server 필요)
kubectl --context=dev top nodes
```

**기대 출력:**

```
NAME         CPU(cores)   CPU%   MEMORY(bytes)   MEMORY%
<node-name>  250m         12%    1200Mi          60%
```

**Step 4: kubelet 프로세스 확인 (SSH 접속)**

```bash
ssh admin@<node-ip>
# 비밀번호: admin

# kubelet 상태 확인
sudo systemctl status kubelet

# kubelet 설정 확인
sudo cat /var/lib/kubelet/config.yaml | head -30
```

**기대 출력:** kubelet이 active (running) 상태이며, 설정 파일에서 `clusterDNS`, `clusterDomain`, `cgroupDriver` 등의 설정을 확인할 수 있다.

**Step 5: kube-proxy 확인**

```bash
# kube-proxy는 DaemonSet으로 실행된다
kubectl --context=dev get daemonset kube-proxy -n kube-system

# kube-proxy Pod 확인
kubectl --context=dev get pods -n kube-system -l k8s-app=kube-proxy -o wide
```

**기대 출력:** 모든 노드에 kube-proxy Pod가 하나씩 실행되고 있음을 확인한다.

**Step 6: kube-proxy 모드 확인**

```bash
# kube-proxy 설정 확인
kubectl --context=dev get configmap kube-proxy -n kube-system -o yaml | grep mode
```

**기대 출력:** `mode` 값이 `iptables` 또는 `ipvs`로 설정되어 있다. 이것은 Service의 트래픽 라우팅 방식을 결정한다.

**Step 7: Container Runtime 확인 (SSH 접속)**

```bash
ssh admin@<node-ip>
# 비밀번호: admin

# containerd 상태
sudo systemctl status containerd

# containerd 버전
containerd --version

# crictl로 실행 중인 컨테이너 목록
sudo crictl ps

# crictl로 이미지 목록
sudo crictl images
```

**기대 출력:** containerd가 active (running) 상태이며, crictl로 현재 실행 중인 모든 컨테이너와 이미지를 확인할 수 있다.

**확인 문제:**
1. Worker Node의 3대 컴포넌트는 무엇이며, 각각의 역할은 무엇인가?
2. kubelet과 Container Runtime은 어떤 인터페이스를 통해 통신하는가?
3. kube-proxy가 DaemonSet으로 실행되는 이유는 무엇인가?
4. containerd와 Docker의 관계는 무엇인가? Kubernetes에서 Docker 지원이 중단된 이유는?

**관련 KCNA 시험 주제:** Kubernetes Fundamentals — Node Components, Container Runtime Interface (CRI)

---

### Lab 1.3: etcd 데이터 조회

**학습 목표:**
- etcd가 Kubernetes 클러스터의 모든 상태를 저장하는 유일한 저장소임을 이해한다.
- etcdctl을 사용하여 실제 저장된 데이터를 조회한다.
- etcd의 키 구조를 파악한다.

**Step 1: etcd Pod 확인**

```bash
# etcd Pod 확인
kubectl --context=dev get pods -n kube-system -l component=etcd
```

**기대 출력:** etcd Pod가 Running 상태이다.

**Step 2: etcd Pod 내부에서 etcdctl 실행**

```bash
# etcd Pod 이름 가져오기
ETCD_POD=$(kubectl --context=dev get pods -n kube-system -l component=etcd -o jsonpath='{.items[0].metadata.name}')

# etcd에 저장된 키 목록 조회 (상위 레벨)
kubectl --context=dev exec -n kube-system $ETCD_POD -- \
  etcdctl get / --prefix --keys-only --limit=20 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key
```

**기대 출력:** `/registry/` 하위에 다양한 키가 표시된다. 예를 들면:
```
/registry/pods/demo/nginx-web-xxxxx
/registry/services/specs/demo/nginx-web
/registry/deployments/demo/nginx-web
```

**Step 3: 특정 리소스의 etcd 데이터 조회**

```bash
# demo 네임스페이스의 nginx-web 서비스 데이터 조회
kubectl --context=dev exec -n kube-system $ETCD_POD -- \
  etcdctl get /registry/services/specs/demo/nginx-web \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key
```

**기대 출력:** 바이너리 형식의 Service 데이터가 출력된다. etcd는 protobuf 형식으로 데이터를 저장하므로 직접 읽기는 어렵다.

**Step 4: etcd 상태 확인**

```bash
# etcd 클러스터 상태
kubectl --context=dev exec -n kube-system $ETCD_POD -- \
  etcdctl endpoint status --write-out=table \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key
```

**기대 출력:**

```
+----------------+------------------+---------+---------+-----------+
|    ENDPOINT    |        ID        | VERSION | DB SIZE | IS LEADER |
+----------------+------------------+---------+---------+-----------+
| 127.0.0.1:2379 | xxxxxxxxxxxxxxxx |   3.x.x |  xx MB  |   true    |
+----------------+------------------+---------+---------+-----------+
```

**Step 5: etcd 멤버 확인**

```bash
# etcd 멤버 목록
kubectl --context=dev exec -n kube-system $ETCD_POD -- \
  etcdctl member list --write-out=table \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key
```

**기대 출력:** etcd 클러스터의 멤버 정보가 표시된다. 단일 노드 클러스터에서는 멤버가 하나이다.

**Step 6: Namespace별 키 수 확인**

```bash
# demo 네임스페이스의 Pod 키 수 조회
kubectl --context=dev exec -n kube-system $ETCD_POD -- \
  etcdctl get /registry/pods/demo --prefix --keys-only \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key | grep -c "/"
```

**기대 출력:** demo 네임스페이스에 존재하는 Pod 수에 해당하는 숫자가 출력된다 (nginx-web 3 + httpbin v1 2 + httpbin v2 1 + redis 1 + postgres 1 + rabbitmq 1 + keycloak 1 = 약 10개).

**확인 문제:**
1. etcd는 어떤 유형의 데이터베이스인가? (관계형 / 키-값 / 문서형)
2. etcd에 저장되는 데이터의 키 구조 패턴은 무엇인가?
3. etcd가 손상되면 Kubernetes 클러스터에 어떤 일이 발생하는가?
4. etcd 백업이 중요한 이유는 무엇인가?

**관련 KCNA 시험 주제:** Kubernetes Fundamentals — etcd, Cluster State Management

---

### Lab 1.4: kube-scheduler 동작 관찰

**학습 목표:**
- kube-scheduler가 Pod를 특정 노드에 배치하는 과정을 이해한다.
- Pending 상태의 Pod를 통해 스케줄링 실패 시나리오를 관찰한다.
- 스케줄링에 영향을 주는 요소(리소스, nodeSelector, taint/toleration)를 파악한다.

**Step 1: Scheduler Pod 확인**

```bash
# Scheduler Pod 확인
kubectl --context=dev get pods -n kube-system -l component=kube-scheduler
```

**기대 출력:** kube-scheduler Pod가 Running 상태이다.

**Step 2: 스케줄링 이벤트 관찰**

```bash
# 테스트 Pod 생성
kubectl --context=dev run scheduler-test --image=nginx:alpine -n demo

# Pod의 이벤트에서 스케줄링 결정 확인
kubectl --context=dev describe pod scheduler-test -n demo | grep -A 5 "Events:"
```

**기대 출력:**
```
Events:
  Type    Reason     Age   From               Message
  ----    ------     ----  ----               -------
  Normal  Scheduled  10s   default-scheduler  Successfully assigned demo/scheduler-test to <node-name>
  Normal  Pulling    9s    kubelet            Pulling image "nginx:alpine"
  Normal  Pulled     5s    kubelet            Successfully pulled image "nginx:alpine"
  Normal  Created    5s    kubelet            Created container scheduler-test
  Normal  Started    4s    kubelet            Started container scheduler-test
```

`Scheduled` 이벤트에서 스케줄러가 Pod를 어떤 노드에 배치했는지 확인할 수 있다.

**Step 3: 리소스 부족으로 인한 스케줄링 실패 시뮬레이션**

```bash
# 과도한 리소스를 요청하는 Pod 생성
kubectl --context=dev apply -n demo -f - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: unschedulable-pod
  namespace: demo
spec:
  containers:
    - name: test
      image: nginx:alpine
      resources:
        requests:
          cpu: "100"
          memory: "1000Gi"
EOF

# Pod 상태 확인
kubectl --context=dev get pod unschedulable-pod -n demo
```

**기대 출력:** Pod가 `Pending` 상태로 유지된다.

```bash
# Pending 사유 확인
kubectl --context=dev describe pod unschedulable-pod -n demo | grep -A 3 "Events:"
```

**기대 출력:**
```
Events:
  Type     Reason            Age   From               Message
  ----     ------            ----  ----               -------
  Warning  FailedScheduling  10s   default-scheduler  0/1 nodes are available: 1 Insufficient cpu, 1 Insufficient memory.
```

**Step 4: 정리**

```bash
# 테스트 Pod 삭제
kubectl --context=dev delete pod scheduler-test unschedulable-pod -n demo --ignore-not-found
```

**Step 5: Scheduler 로그 확인**

```bash
# Scheduler 로그에서 스케줄링 결정 확인
SCHEDULER_POD=$(kubectl --context=dev get pods -n kube-system -l component=kube-scheduler -o jsonpath='{.items[0].metadata.name}')
kubectl --context=dev logs $SCHEDULER_POD -n kube-system --tail=20
```

**기대 출력:** 스케줄링 관련 로그 메시지가 출력된다.

**Step 6: 노드 Allocatable 리소스 확인**

```bash
# 각 노드의 할당 가능 리소스 확인
kubectl --context=dev get nodes -o custom-columns=\
'NAME:.metadata.name,CPU_ALLOC:.status.allocatable.cpu,MEM_ALLOC:.status.allocatable.memory,PODS_ALLOC:.status.allocatable.pods'
```

**기대 출력:** 각 노드의 할당 가능 CPU, 메모리, Pod 수가 표시된다. 스케줄러는 이 정보를 바탕으로 Pod를 배치한다.

**확인 문제:**
1. kube-scheduler는 Pod를 노드에 배치할 때 어떤 두 단계(Filtering, Scoring)를 거치는가?
2. Pod가 Pending 상태인 경우 가장 먼저 확인해야 할 것은 무엇인가?
3. nodeSelector와 nodeAffinity의 차이점은 무엇인가?
4. taint와 toleration의 관계를 설명하라.

**관련 KCNA 시험 주제:** Kubernetes Fundamentals — Scheduling, Pod Lifecycle

---

## 실습 2: 워크로드 리소스 탐색 (Fundamentals)

> Deployment, ReplicaSet, Pod의 계층 구조를 이해하고, 다양한 워크로드 리소스의 특성을 파악한다.

---

### Lab 2.1: Deployment → ReplicaSet → Pod 계층 분석 (nginx-web)

**학습 목표:**
- Deployment가 ReplicaSet을 생성하고, ReplicaSet이 Pod를 생성하는 계층 구조를 이해한다.
- ownerReferences를 통해 리소스 간 소유 관계를 확인한다.
- nginx-web Deployment의 실제 구조를 분석한다.

**Step 1: nginx-web Deployment 확인**

```bash
# Deployment 목록 확인
kubectl --context=dev get deployments -n demo
```

**기대 출력:**

```
NAME         READY   UP-TO-DATE   AVAILABLE   AGE
nginx-web    3/3     3            3           ...
httpbin-v1   2/2     2            2           ...
httpbin-v2   1/1     1            1           ...
redis        1/1     1            1           ...
postgres     1/1     1            1           ...
rabbitmq     1/1     1            1           ...
keycloak     1/1     1            1           ...
```

nginx-web의 READY 열이 3/3으로, 3개의 레플리카가 모두 준비 상태임을 확인한다.

**Step 2: Deployment의 상세 YAML 확인**

```bash
# nginx-web Deployment YAML 확인
kubectl --context=dev get deployment nginx-web -n demo -o yaml
```

**기대 출력 중 핵심 부분:**
- `spec.replicas: 3` — 3개의 레플리카
- `spec.selector.matchLabels.app: nginx-web` — 레이블 셀렉터
- `spec.template.spec.containers[0].image: nginx:alpine` — 컨테이너 이미지
- `spec.template.spec.containers[0].resources.requests.cpu: 50m` — CPU 요청
- `spec.template.spec.containers[0].resources.requests.memory: 64Mi` — 메모리 요청
- `spec.template.spec.containers[0].resources.limits.cpu: 200m` — CPU 제한
- `spec.template.spec.containers[0].resources.limits.memory: 128Mi` — 메모리 제한

**Step 3: ReplicaSet 확인**

```bash
# nginx-web의 ReplicaSet 확인
kubectl --context=dev get replicasets -n demo -l app=nginx-web
```

**기대 출력:**

```
NAME                    DESIRED   CURRENT   READY   AGE
nginx-web-xxxxxxxxxx    3         3         3       ...
```

Deployment가 ReplicaSet을 하나 생성하였고, ReplicaSet이 3개의 Pod를 유지한다.

**Step 4: ReplicaSet의 ownerReferences 확인**

```bash
# ReplicaSet의 소유자 확인
kubectl --context=dev get replicaset -n demo -l app=nginx-web \
  -o jsonpath='{.items[0].metadata.ownerReferences[0].kind}: {.items[0].metadata.ownerReferences[0].name}'
echo ""
```

**기대 출력:** `Deployment: nginx-web`

이것은 ReplicaSet이 nginx-web Deployment에 의해 소유되고 있음을 증명한다.

**Step 5: Pod 확인**

```bash
# nginx-web Pod 목록 확인
kubectl --context=dev get pods -n demo -l app=nginx-web -o wide
```

**기대 출력:** 3개의 Pod가 Running 상태이며, 각각 다른 IP를 가진다. IP는 10.20.x.x 범위 (dev 클러스터의 Pod CIDR)에 속한다.

**Step 6: Pod의 ownerReferences 확인**

```bash
# Pod의 소유자 확인
POD_NAME=$(kubectl --context=dev get pods -n demo -l app=nginx-web -o jsonpath='{.items[0].metadata.name}')
kubectl --context=dev get pod $POD_NAME -n demo \
  -o jsonpath='{.metadata.ownerReferences[0].kind}: {.metadata.ownerReferences[0].name}'
echo ""
```

**기대 출력:** `ReplicaSet: nginx-web-xxxxxxxxxx`

Pod는 ReplicaSet에 의해 소유된다. 즉, 계층 구조는 다음과 같다:
```
Deployment (nginx-web)
  └── ReplicaSet (nginx-web-xxxxxxxxxx)
      ├── Pod (nginx-web-xxxxxxxxxx-xxxxx)
      ├── Pod (nginx-web-xxxxxxxxxx-yyyyy)
      └── Pod (nginx-web-xxxxxxxxxx-zzzzz)
```

**Step 7: 전체 계층 한번에 확인**

```bash
# Deployment → ReplicaSet → Pod 전체 계층 시각화
echo "=== Deployment ==="
kubectl --context=dev get deployment nginx-web -n demo -o custom-columns='NAME:.metadata.name,REPLICAS:.spec.replicas,IMAGE:.spec.template.spec.containers[0].image'
echo ""
echo "=== ReplicaSet ==="
kubectl --context=dev get rs -n demo -l app=nginx-web -o custom-columns='NAME:.metadata.name,DESIRED:.spec.replicas,CURRENT:.status.replicas,READY:.status.readyReplicas'
echo ""
echo "=== Pods ==="
kubectl --context=dev get pods -n demo -l app=nginx-web -o custom-columns='NAME:.metadata.name,STATUS:.status.phase,IP:.status.podIP,NODE:.spec.nodeName'
```

**확인 문제:**
1. Deployment를 삭제하면 ReplicaSet과 Pod는 어떻게 되는가?
2. ReplicaSet을 직접 삭제하면 Deployment는 어떻게 반응하는가?
3. ownerReferences의 역할은 무엇인가?
4. Deployment가 관리하는 Pod의 수를 변경하려면 어떤 명령을 사용하는가?

**관련 KCNA 시험 주제:** Kubernetes Fundamentals — Workload Resources, Deployment, ReplicaSet

---

### Lab 2.2: Pod 상세 분석 (labels, annotations, resources, containers)

**학습 목표:**
- Pod의 메타데이터(labels, annotations)를 확인하고 그 용도를 이해한다.
- 컨테이너의 리소스 요청(requests)과 제한(limits)의 차이를 이해한다.
- Pod의 생명주기(Phase)를 파악한다.

**Step 1: Pod의 Labels 확인**

```bash
# demo 네임스페이스의 모든 Pod와 Labels 확인
kubectl --context=dev get pods -n demo --show-labels
```

**기대 출력:**

```
NAME                          READY   STATUS    LABELS
nginx-web-xxxxx               1/1     Running   app=nginx-web,pod-template-hash=xxxxx
httpbin-v1-xxxxx              1/1     Running   app=httpbin,version=v1,pod-template-hash=xxxxx
httpbin-v2-xxxxx              1/1     Running   app=httpbin,version=v2,pod-template-hash=xxxxx
redis-xxxxx                   1/1     Running   app=redis,pod-template-hash=xxxxx
postgres-xxxxx                1/1     Running   app=postgres,pod-template-hash=xxxxx
rabbitmq-xxxxx                1/1     Running   app=rabbitmq,pod-template-hash=xxxxx
keycloak-xxxxx                1/1     Running   app=keycloak,pod-template-hash=xxxxx
```

**Step 2: Label Selector로 필터링**

```bash
# app=httpbin인 모든 Pod (v1 + v2)
kubectl --context=dev get pods -n demo -l app=httpbin

# version=v1인 httpbin Pod만
kubectl --context=dev get pods -n demo -l app=httpbin,version=v1

# version=v2인 httpbin Pod만
kubectl --context=dev get pods -n demo -l app=httpbin,version=v2
```

**기대 출력:** 첫 번째 명령은 httpbin Pod 3개(v1 2개 + v2 1개), 두 번째는 2개, 세 번째는 1개가 출력된다.

**Step 3: Pod의 리소스 설정 확인**

```bash
# nginx-web Pod의 리소스 요청/제한 확인
kubectl --context=dev get pods -n demo -l app=nginx-web \
  -o custom-columns='NAME:.metadata.name,CPU_REQ:.spec.containers[0].resources.requests.cpu,MEM_REQ:.spec.containers[0].resources.requests.memory,CPU_LIM:.spec.containers[0].resources.limits.cpu,MEM_LIM:.spec.containers[0].resources.limits.memory'
```

**기대 출력:**

```
NAME                CPU_REQ   MEM_REQ   CPU_LIM   MEM_LIM
nginx-web-xxxxx     50m       64Mi      200m      128Mi
nginx-web-yyyyy     50m       64Mi      200m      128Mi
nginx-web-zzzzz     50m       64Mi      200m      128Mi
```

**Step 4: 실제 리소스 사용량 vs 요청/제한 비교**

```bash
# 실제 사용량 확인
kubectl --context=dev top pods -n demo -l app=nginx-web
```

**기대 출력:**

```
NAME                CPU(cores)   MEMORY(bytes)
nginx-web-xxxxx     2m           10Mi
nginx-web-yyyyy     1m           9Mi
nginx-web-zzzzz     2m           11Mi
```

실제 사용량이 requests(50m CPU, 64Mi 메모리)보다 훨씬 낮다. 이것은 정상이다. requests는 최소 보장 리소스이고, limits는 최대 사용 가능 리소스이다.

**Step 5: Pod의 Phase(상태) 확인**

```bash
# Pod의 Phase 확인
kubectl --context=dev get pods -n demo -o custom-columns='NAME:.metadata.name,PHASE:.status.phase,CONDITIONS:.status.conditions[*].type'
```

**기대 출력:** 모든 Pod의 PHASE가 `Running`이다. Pod의 가능한 Phase는 다음과 같다:
- `Pending`: 스케줄링 대기 또는 이미지 다운로드 중
- `Running`: 컨테이너가 실행 중
- `Succeeded`: 모든 컨테이너가 성공적으로 종료
- `Failed`: 하나 이상의 컨테이너가 실패
- `Unknown`: 노드와 통신 불가

**Step 6: Pod의 Annotations 확인**

```bash
# nginx-web Pod의 Annotations 확인
POD_NAME=$(kubectl --context=dev get pods -n demo -l app=nginx-web -o jsonpath='{.items[0].metadata.name}')
kubectl --context=dev get pod $POD_NAME -n demo -o jsonpath='{.metadata.annotations}' | python3 -m json.tool
```

**기대 출력:** Annotations에는 비식별 메타데이터가 포함된다. Istio sidecar 주입, Prometheus scrape 설정 등이 Annotations으로 관리될 수 있다.

**Step 7: 컨테이너 상세 정보**

```bash
# Pod 내 컨테이너 정보 확인
kubectl --context=dev get pod $POD_NAME -n demo \
  -o jsonpath='{range .spec.containers[*]}Container: {.name}{"\n"}Image: {.image}{"\n"}Ports: {.ports[*].containerPort}{"\n"}{end}'
```

**확인 문제:**
1. requests와 limits의 차이점은 무엇인가? requests를 초과하면 어떻게 되는가?
2. limits.memory를 초과하면 컨테이너에 어떤 일이 발생하는가? (OOMKilled)
3. Label과 Annotation의 차이점 3가지를 설명하라.
4. Pod Phase 중 `Pending`의 가능한 원인 3가지를 나열하라.

**관련 KCNA 시험 주제:** Kubernetes Fundamentals — Pod Lifecycle, Labels and Selectors, Resource Management

---

### Lab 2.3: DaemonSet 확인 (Cilium)

**학습 목표:**
- DaemonSet이 모든 노드에 Pod를 하나씩 실행하는 원리를 이해한다.
- tart-infra에서 Cilium이 DaemonSet으로 배포된 이유를 파악한다.
- DaemonSet의 업데이트 전략을 확인한다.

**Step 1: DaemonSet 목록 확인**

```bash
# 모든 네임스페이스의 DaemonSet 확인
kubectl --context=dev get daemonsets --all-namespaces
```

**기대 출력:**

```
NAMESPACE     NAME          DESIRED   CURRENT   READY   UP-TO-DATE   AVAILABLE
kube-system   cilium        1         1         1       1            1
kube-system   kube-proxy    1         1         1       1            1
...
```

Cilium과 kube-proxy가 DaemonSet으로 실행되고 있다. DESIRED와 CURRENT, READY가 모두 동일해야 한다.

**Step 2: Cilium DaemonSet 상세 확인**

```bash
# Cilium DaemonSet 상세
kubectl --context=dev describe daemonset cilium -n kube-system
```

**기대 출력 중 확인할 항목:**
- `Node-Selector`: DaemonSet이 실행될 노드 조건
- `Update Strategy`: `RollingUpdate` (DaemonSet의 업데이트 방식)
- `Pods Status`: Running 상태의 Pod 수

**Step 3: Cilium Pod가 모든 노드에 실행되는지 확인**

```bash
# Cilium Pod와 실행 노드 확인
kubectl --context=dev get pods -n kube-system -l k8s-app=cilium -o wide
```

**기대 출력:** 모든 노드에 Cilium Pod가 하나씩 실행되고 있다. DaemonSet은 새 노드가 추가되면 자동으로 해당 노드에 Pod를 생성한다.

**Step 4: Cilium 상태 확인**

```bash
# Cilium 에이전트 상태 확인
CILIUM_POD=$(kubectl --context=dev get pods -n kube-system -l k8s-app=cilium -o jsonpath='{.items[0].metadata.name}')
kubectl --context=dev exec -n kube-system $CILIUM_POD -- cilium status --brief
```

**기대 출력:** Cilium 에이전트의 상태 요약이 출력된다. KVStore, ContainerRuntime, Kubernetes, IPAM 등의 상태가 `OK`여야 한다.

**Step 5: DaemonSet의 업데이트 전략 확인**

```bash
# DaemonSet의 updateStrategy 확인
kubectl --context=dev get daemonset cilium -n kube-system \
  -o jsonpath='{.spec.updateStrategy}' | python3 -m json.tool
```

**기대 출력:** `type: RollingUpdate`와 `maxUnavailable` 값이 표시된다. DaemonSet은 Deployment와 달리 `Recreate`와 `RollingUpdate` 두 가지 전략만 지원한다.

**확인 문제:**
1. DaemonSet과 Deployment의 차이점은 무엇인가?
2. CNI 플러그인(Cilium)이 DaemonSet으로 배포되는 이유는 무엇인가?
3. DaemonSet에서 특정 노드에만 Pod를 실행하려면 어떤 설정을 사용하는가?
4. DaemonSet의 DESIRED 수는 어떻게 결정되는가?

**관련 KCNA 시험 주제:** Kubernetes Fundamentals — DaemonSet, Container Networking Interface (CNI)

---

### Lab 2.4: Job 생성 및 실행 (k6 부하 테스트 Job)

**학습 목표:**
- Job이 일회성 작업을 실행하고 완료되면 종료하는 워크로드 유형임을 이해한다.
- k6를 사용하여 nginx-web에 부하를 생성하는 Job을 실행한다.
- Job의 completions, parallelism, backoffLimit 설정을 이해한다.

**Step 1: 간단한 Job 생성**

```bash
# 기본 Job 생성
kubectl --context=dev apply -n demo -f - <<EOF
apiVersion: batch/v1
kind: Job
metadata:
  name: hello-job
  namespace: demo
spec:
  template:
    spec:
      containers:
        - name: hello
          image: busybox:1.36
          command: ["sh", "-c", "echo 'Hello from Kubernetes Job!' && date && sleep 5"]
      restartPolicy: Never
  backoffLimit: 4
EOF

# Job 상태 확인
kubectl --context=dev get jobs -n demo
```

**기대 출력:**

```
NAME        COMPLETIONS   DURATION   AGE
hello-job   0/1           5s         5s
```

잠시 후:

```
NAME        COMPLETIONS   DURATION   AGE
hello-job   1/1           10s        15s
```

**Step 2: Job 로그 확인**

```bash
# Job의 Pod 로그 확인
kubectl --context=dev logs job/hello-job -n demo
```

**기대 출력:**
```
Hello from Kubernetes Job!
Thu Mar 19 12:00:00 UTC 2026
```

**Step 3: k6 부하 테스트 Job 생성**

```bash
# nginx-web에 대한 k6 부하 테스트 Job
kubectl --context=dev apply -n demo -f - <<EOF
apiVersion: batch/v1
kind: Job
metadata:
  name: k6-load-test
  namespace: demo
spec:
  template:
    spec:
      containers:
        - name: k6
          image: grafana/k6:latest
          command:
            - k6
            - run
            - --vus=10
            - --duration=30s
            - "-"
          stdin: true
          env:
            - name: K6_SCRIPT
              value: |
                import http from 'k6/http';
                import { check, sleep } from 'k6';
                export default function () {
                  const res = http.get('http://nginx-web.demo.svc.cluster.local');
                  check(res, { 'status is 200': (r) => r.status === 200 });
                  sleep(0.1);
                }
      restartPolicy: Never
  backoffLimit: 2
EOF

# Job 진행 상태 관찰
kubectl --context=dev get job k6-load-test -n demo -w
```

**기대 출력:** Job이 30초간 실행된 후 완료된다.

**Step 4: 부하 테스트 결과 확인**

```bash
# k6 결과 로그
kubectl --context=dev logs job/k6-load-test -n demo
```

**기대 출력:** k6의 테스트 결과 요약이 출력된다. 요청 수, 성공률, 응답 시간 등의 메트릭이 표시된다.

**Step 5: parallelism을 사용한 병렬 Job**

```bash
# 병렬로 실행되는 Job (3개 Pod 동시 실행, 총 5회 완료)
kubectl --context=dev apply -n demo -f - <<EOF
apiVersion: batch/v1
kind: Job
metadata:
  name: parallel-job
  namespace: demo
spec:
  completions: 5
  parallelism: 3
  template:
    spec:
      containers:
        - name: worker
          image: busybox:1.36
          command: ["sh", "-c", "echo Worker $(hostname) started && sleep 10 && echo Done"]
      restartPolicy: Never
EOF

# 병렬 실행 관찰
kubectl --context=dev get pods -n demo -l job-name=parallel-job -w
```

**기대 출력:** 처음에 3개의 Pod가 동시에 생성(parallelism=3)되고, 완료되면 나머지 2개가 실행되어 총 5개(completions=5)가 완료된다.

**Step 6: 정리**

```bash
# 생성한 Job 삭제
kubectl --context=dev delete job hello-job k6-load-test parallel-job -n demo --ignore-not-found
```

**확인 문제:**
1. Job의 `restartPolicy`로 사용 가능한 값은 무엇인가? (`Always`는 사용 가능한가?)
2. `completions`과 `parallelism`의 차이점을 설명하라.
3. `backoffLimit`이 초과되면 Job은 어떤 상태가 되는가?
4. Job과 Deployment의 주요 차이점은 무엇인가?

**관련 KCNA 시험 주제:** Kubernetes Fundamentals — Job, Batch Processing

---

### Lab 2.5: CronJob 생성 실습

**학습 목표:**
- CronJob이 스케줄에 따라 Job을 자동 생성하는 원리를 이해한다.
- Cron 표현식을 읽고 작성할 수 있다.
- CronJob의 동시성 정책(concurrencyPolicy)을 이해한다.

**Step 1: CronJob 생성**

```bash
# 매 2분마다 nginx-web 헬스 체크를 수행하는 CronJob
kubectl --context=dev apply -n demo -f - <<EOF
apiVersion: batch/v1
kind: CronJob
metadata:
  name: nginx-health-check
  namespace: demo
spec:
  schedule: "*/2 * * * *"
  concurrencyPolicy: Forbid
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 1
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: health-checker
              image: curlimages/curl:latest
              command:
                - sh
                - -c
                - |
                  echo "=== Health Check: $(date) ==="
                  STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://nginx-web.demo.svc.cluster.local)
                  if [ "$STATUS" = "200" ]; then
                    echo "nginx-web: OK (HTTP $STATUS)"
                  else
                    echo "nginx-web: FAIL (HTTP $STATUS)"
                    exit 1
                  fi
          restartPolicy: OnFailure
EOF

# CronJob 확인
kubectl --context=dev get cronjobs -n demo
```

**기대 출력:**

```
NAME                 SCHEDULE      SUSPEND   ACTIVE   LAST SCHEDULE   AGE
nginx-health-check   */2 * * * *   False     0        <none>          5s
```

**Step 2: CronJob이 생성한 Job 관찰**

```bash
# 2분 후 Job이 생성되는지 확인
kubectl --context=dev get jobs -n demo -l job-name -w
```

**기대 출력:** 2분마다 새로운 Job이 생성되고 완료되는 것을 관찰할 수 있다.

**Step 3: CronJob이 생성한 Job의 로그 확인**

```bash
# 가장 최근 Job의 로그 확인
LATEST_JOB=$(kubectl --context=dev get jobs -n demo --sort-by=.metadata.creationTimestamp -o jsonpath='{.items[-1].metadata.name}')
kubectl --context=dev logs job/$LATEST_JOB -n demo
```

**기대 출력:**
```
=== Health Check: Thu Mar 19 12:02:00 UTC 2026 ===
nginx-web: OK (HTTP 200)
```

**Step 4: DB 백업 CronJob 생성**

```bash
# postgres 백업을 시뮬레이션하는 CronJob
kubectl --context=dev apply -n demo -f - <<EOF
apiVersion: batch/v1
kind: CronJob
metadata:
  name: postgres-backup
  namespace: demo
spec:
  schedule: "0 2 * * *"
  concurrencyPolicy: Replace
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: backup
              image: postgres:16-alpine
              command:
                - sh
                - -c
                - |
                  echo "Starting PostgreSQL backup at $(date)"
                  PGPASSWORD=demo123 pg_dump -h postgres.demo.svc.cluster.local \
                    -U demo -d demo > /dev/null 2>&1 && \
                    echo "Backup completed successfully" || \
                    echo "Backup failed"
          restartPolicy: OnFailure
EOF

# CronJob 확인
kubectl --context=dev get cronjobs -n demo
```

**기대 출력:** postgres-backup CronJob이 매일 오전 2시(0 2 * * *)에 실행되도록 설정된다.

**Step 5: 정리**

```bash
# CronJob 삭제
kubectl --context=dev delete cronjob nginx-health-check postgres-backup -n demo --ignore-not-found
```

**확인 문제:**
1. Cron 표현식 `*/5 * * * *`의 의미는 무엇인가?
2. `concurrencyPolicy`의 세 가지 옵션(Allow, Forbid, Replace)의 차이를 설명하라.
3. `successfulJobsHistoryLimit`의 역할은 무엇인가?
4. CronJob이 생성한 Job이 실패하면 어떻게 되는가?

**관련 KCNA 시험 주제:** Kubernetes Fundamentals — CronJob, Job Scheduling

---

## 실습 3: Service와 네트워킹 (Fundamentals)

> Kubernetes Service의 타입별 특성을 이해하고, 클러스터 내부/외부 네트워킹을 실습한다.

---

### Lab 3.1: ClusterIP vs NodePort 비교 (httpbin vs nginx)

**학습 목표:**
- ClusterIP와 NodePort Service의 차이를 실습으로 체감한다.
- nginx-web(NodePort 30080)과 httpbin(ClusterIP)의 접근 방식 차이를 확인한다.
- Service의 selector가 Pod를 어떻게 선택하는지 이해한다.

**Step 1: Service 목록 확인**

```bash
# demo 네임스페이스의 Service 목록
kubectl --context=dev get svc -n demo
```

**기대 출력:**

```
NAME         TYPE        CLUSTER-IP     EXTERNAL-IP   PORT(S)           AGE
nginx-web    NodePort    10.xx.xx.xx    <none>        80:30080/TCP      ...
httpbin      ClusterIP   10.xx.xx.xx    <none>        80/TCP            ...
redis        ClusterIP   10.xx.xx.xx    <none>        6379/TCP          ...
postgres     ClusterIP   10.xx.xx.xx    <none>        5432/TCP          ...
rabbitmq     ClusterIP   10.xx.xx.xx    <none>        5672/TCP,15672/TCP ...
keycloak     NodePort    10.xx.xx.xx    <none>        8080:30880/TCP    ...
```

nginx-web과 keycloak은 NodePort, 나머지는 ClusterIP이다.

**Step 2: NodePort Service 상세 확인**

```bash
# nginx-web NodePort Service 상세
kubectl --context=dev describe svc nginx-web -n demo
```

**기대 출력 중 핵심:**
- `Type: NodePort`
- `Port: 80/TCP`
- `TargetPort: 80/TCP`
- `NodePort: 30080`
- `Endpoints: 10.20.x.x:80, 10.20.x.x:80, 10.20.x.x:80` (3개의 Pod IP)
- `Selector: app=nginx-web`

**Step 3: ClusterIP Service 상세 확인**

```bash
# httpbin ClusterIP Service 상세
kubectl --context=dev describe svc httpbin -n demo
```

**기대 출력 중 핵심:**
- `Type: ClusterIP`
- `Port: 80/TCP`
- `Endpoints: 10.20.x.x:80, 10.20.x.x:80` (v1의 2개 Pod IP만 포함)
- `Selector: app=httpbin,version=v1` 또는 `Selector: app=httpbin`

**Step 4: NodePort로 외부 접근 테스트**

```bash
# NodePort를 통한 nginx-web 접근 (클러스터 외부에서)
curl -s http://<node-ip>:30080 | head -5
```

**기대 출력:** nginx의 기본 HTML 페이지가 출력된다. NodePort는 클러스터 외부에서 접근 가능하다.

**Step 5: ClusterIP로는 외부 접근 불가 확인**

```bash
# ClusterIP로는 클러스터 외부에서 접근 불가
curl -s --connect-timeout 3 http://<node-ip>:80 || echo "접근 불가 — ClusterIP는 클러스터 내부에서만 접근 가능하다"
```

**기대 출력:** 접근이 실패한다. ClusterIP Service는 클러스터 내부에서만 접근 가능하다.

**Step 6: 클러스터 내부에서 ClusterIP 접근 테스트**

```bash
# 임시 Pod를 생성하여 클러스터 내부에서 httpbin 접근
kubectl --context=dev run curl-test --rm -it --image=curlimages/curl -n demo \
  -- curl -s http://httpbin.demo.svc.cluster.local/get | head -10
```

**기대 출력:** httpbin의 응답 JSON이 출력된다. 클러스터 내부에서는 Service 이름으로 접근할 수 있다.

**Step 7: Service 타입 비교 정리**

```bash
# Service 타입별 비교
echo "============================================="
echo "Service 타입 비교"
echo "============================================="
echo "ClusterIP: 클러스터 내부에서만 접근 가능 (기본값)"
echo "  예: httpbin, redis, postgres, rabbitmq"
echo ""
echo "NodePort: 노드의 특정 포트로 외부 접근 가능 (30000-32767)"
echo "  예: nginx-web(30080), keycloak(30880)"
echo ""
echo "LoadBalancer: 클라우드 로드밸런서 연동 (tart-infra에서는 미사용)"
```

**확인 문제:**
1. ClusterIP, NodePort, LoadBalancer의 접근 범위를 각각 설명하라.
2. NodePort의 기본 포트 범위는 무엇인가?
3. Service의 selector와 Pod의 labels는 어떤 관계인가?
4. Service가 없어도 Pod에 직접 접근할 수 있는가? 그렇다면 왜 Service를 사용하는가?

**관련 KCNA 시험 주제:** Kubernetes Fundamentals — Service Types, Networking

---

### Lab 3.2: Service Endpoint 확인

**학습 목표:**
- Service와 Endpoint의 관계를 이해한다.
- Endpoint가 Pod의 IP 목록임을 확인한다.
- Pod가 추가/삭제될 때 Endpoint가 자동 업데이트됨을 관찰한다.

**Step 1: Endpoints 리소스 확인**

```bash
# nginx-web Service의 Endpoints 확인
kubectl --context=dev get endpoints nginx-web -n demo
```

**기대 출력:**

```
NAME        ENDPOINTS                                       AGE
nginx-web   10.20.x.x:80,10.20.x.x:80,10.20.x.x:80       ...
```

3개의 Pod IP:Port가 표시된다 (레플리카 3개).

**Step 2: Endpoints와 Pod IP 대조**

```bash
# Pod IP 확인
echo "=== Pod IPs ==="
kubectl --context=dev get pods -n demo -l app=nginx-web -o custom-columns='NAME:.metadata.name,IP:.status.podIP'

echo ""
echo "=== Service Endpoints ==="
kubectl --context=dev get endpoints nginx-web -n demo
```

**기대 출력:** Pod의 IP와 Endpoints의 IP가 정확히 일치한다.

**Step 3: Pod 삭제 후 Endpoint 변화 관찰**

```bash
# Endpoints 실시간 관찰 (별도 터미널에서)
kubectl --context=dev get endpoints nginx-web -n demo -w
```

```bash
# 다른 터미널에서 Pod 하나 삭제
POD_NAME=$(kubectl --context=dev get pods -n demo -l app=nginx-web -o jsonpath='{.items[0].metadata.name}')
kubectl --context=dev delete pod $POD_NAME -n demo
```

**기대 출력:** Pod가 삭제되면 해당 IP가 Endpoints에서 제거되고, 새 Pod가 생성되면 새 IP가 Endpoints에 추가된다. 이 과정은 자동이다.

**Step 4: 모든 데모 앱의 Endpoints 확인**

```bash
# 모든 Service의 Endpoints 확인
kubectl --context=dev get endpoints -n demo
```

**기대 출력:**

```
NAME         ENDPOINTS
nginx-web    10.20.x.x:80,10.20.x.x:80,10.20.x.x:80
httpbin      10.20.x.x:80,10.20.x.x:80
redis        10.20.x.x:6379
postgres     10.20.x.x:5432
rabbitmq     10.20.x.x:5672,10.20.x.x:15672
keycloak     10.20.x.x:8080
```

**확인 문제:**
1. Endpoint는 누가 관리하는가? (사용자 / Endpoint Controller)
2. Service의 selector에 매칭되지만 Ready 상태가 아닌 Pod는 Endpoint에 포함되는가?
3. EndpointSlice와 Endpoints의 차이점은 무엇인가?
4. Headless Service(ClusterIP: None)의 Endpoint는 어떻게 동작하는가?

**관련 KCNA 시험 주제:** Kubernetes Fundamentals — Service Discovery, Endpoints

---

### Lab 3.3: DNS 해석 테스트 (busybox Pod에서 nslookup)

**학습 목표:**
- Kubernetes 클러스터 내부 DNS(CoreDNS)의 동작 원리를 이해한다.
- Service FQDN 형식을 파악한다.
- 다른 네임스페이스의 Service에 접근하는 방법을 학습한다.

**Step 1: CoreDNS Pod 확인**

```bash
# CoreDNS Pod 확인
kubectl --context=dev get pods -n kube-system -l k8s-app=kube-dns
```

**기대 출력:** CoreDNS Pod가 Running 상태이다.

**Step 2: DNS 테스트 Pod 생성**

```bash
# busybox Pod를 생성하여 DNS 조회 테스트
kubectl --context=dev run dns-test --rm -it --image=busybox:1.36 -n demo \
  -- nslookup nginx-web.demo.svc.cluster.local
```

**기대 출력:**

```
Server:         10.xx.0.10
Address:        10.xx.0.10:53

Name:           nginx-web.demo.svc.cluster.local
Address:        10.xx.xx.xx
```

`Server`는 CoreDNS의 ClusterIP이고, `Address`는 nginx-web Service의 ClusterIP이다.

**Step 3: 다양한 DNS 이름 형식 테스트**

```bash
# 같은 네임스페이스 — 짧은 이름
kubectl --context=dev run dns-test --rm -it --image=busybox:1.36 -n demo \
  -- nslookup nginx-web

# 네임스페이스 포함
kubectl --context=dev run dns-test --rm -it --image=busybox:1.36 -n demo \
  -- nslookup nginx-web.demo

# 전체 FQDN
kubectl --context=dev run dns-test --rm -it --image=busybox:1.36 -n demo \
  -- nslookup nginx-web.demo.svc.cluster.local
```

**기대 출력:** 세 가지 형식 모두 동일한 ClusterIP로 해석된다. 같은 네임스페이스에서는 짧은 이름만으로도 접근 가능하다.

**Step 4: 다른 네임스페이스의 Service 조회**

```bash
# demo 네임스페이스에서 monitoring 네임스페이스의 Service 조회
kubectl --context=dev run dns-test --rm -it --image=busybox:1.36 -n demo \
  -- nslookup prometheus-server.monitoring.svc.cluster.local
```

**기대 출력:** 다른 네임스페이스의 Service에 접근하려면 최소한 `<service>.<namespace>` 형식을 사용해야 한다.

**Step 5: Pod의 DNS 설정 확인**

```bash
# Pod 내부의 DNS 설정 확인
kubectl --context=dev run dns-test --rm -it --image=busybox:1.36 -n demo \
  -- cat /etc/resolv.conf
```

**기대 출력:**

```
nameserver 10.xx.0.10
search demo.svc.cluster.local svc.cluster.local cluster.local
ndots:5
```

`search` 도메인 덕분에 짧은 이름(`nginx-web`)이 `nginx-web.demo.svc.cluster.local`로 해석된다.

**Step 6: 모든 데모 앱 Service DNS 확인**

```bash
# 모든 데모 앱의 DNS 해석 한번에 테스트
kubectl --context=dev run dns-test --rm -it --image=busybox:1.36 -n demo \
  -- sh -c '
    for svc in nginx-web httpbin redis postgres rabbitmq keycloak; do
      echo "=== $svc ==="
      nslookup $svc 2>/dev/null | grep Address | tail -1
    done
  '
```

**기대 출력:** 각 Service의 ClusterIP가 출력된다.

**확인 문제:**
1. Kubernetes DNS FQDN의 전체 형식은 무엇인가? (`<service>.<namespace>.<type>.<cluster-domain>`)
2. 같은 네임스페이스에서 Service에 접근할 때 최소한의 DNS 이름은 무엇인가?
3. `ndots:5` 설정의 의미는 무엇인가?
4. CoreDNS는 어떤 네임스페이스에서 실행되는가?

**관련 KCNA 시험 주제:** Kubernetes Fundamentals — DNS, Service Discovery

---

### Lab 3.4: Pod 간 통신 테스트

**학습 목표:**
- Pod 간 직접 통신(Pod IP)과 Service를 통한 통신의 차이를 이해한다.
- 데모 앱의 마이크로서비스 토폴로지(nginx→httpbin→postgres/redis/rabbitmq)를 검증한다.
- 통신 경로를 실제로 테스트한다.

**Step 1: Pod IP를 사용한 직접 통신**

```bash
# nginx-web Pod의 IP 확인
NGINX_IP=$(kubectl --context=dev get pods -n demo -l app=nginx-web -o jsonpath='{.items[0].status.podIP}')
echo "nginx-web Pod IP: $NGINX_IP"

# 다른 Pod에서 nginx-web Pod IP로 직접 접근
kubectl --context=dev run comm-test --rm -it --image=curlimages/curl -n demo \
  -- curl -s http://$NGINX_IP
```

**기대 출력:** nginx의 HTML 페이지가 출력된다. Pod IP로 직접 통신이 가능하다.

**Step 2: Service를 통한 통신**

```bash
# Service 이름을 통한 접근 (추천 방식)
kubectl --context=dev run comm-test --rm -it --image=curlimages/curl -n demo \
  -- curl -s http://nginx-web
```

**기대 출력:** 동일한 결과이다. 하지만 Service를 통하면 로드밸런싱이 적용되고, Pod IP가 변경되어도 접근이 보장된다.

**Step 3: nginx → httpbin 통신 테스트**

```bash
# nginx Pod에서 httpbin Service 접근
NGINX_POD=$(kubectl --context=dev get pods -n demo -l app=nginx-web -o jsonpath='{.items[0].metadata.name}')
kubectl --context=dev exec -n demo $NGINX_POD -- \
  wget -qO- http://httpbin.demo.svc.cluster.local/get 2>/dev/null | head -5
```

**기대 출력:** httpbin의 GET 응답 JSON이 출력된다.

**Step 4: httpbin → postgres 통신 테스트**

```bash
# httpbin Pod에서 postgres 포트 접근 확인
HTTPBIN_POD=$(kubectl --context=dev get pods -n demo -l app=httpbin,version=v1 -o jsonpath='{.items[0].metadata.name}')
kubectl --context=dev exec -n demo $HTTPBIN_POD -- \
  sh -c 'nc -zv postgres.demo.svc.cluster.local 5432 2>&1 || echo "Connection test completed"'
```

**기대 출력:** postgres:5432 포트로의 연결이 성공한다.

**Step 5: httpbin → redis 통신 테스트**

```bash
# httpbin Pod에서 redis 포트 접근 확인
kubectl --context=dev exec -n demo $HTTPBIN_POD -- \
  sh -c 'nc -zv redis.demo.svc.cluster.local 6379 2>&1 || echo "Connection test completed"'
```

**기대 출력:** redis:6379 포트로의 연결이 성공한다.

**Step 6: httpbin → rabbitmq 통신 테스트**

```bash
# httpbin Pod에서 rabbitmq 포트 접근 확인
kubectl --context=dev exec -n demo $HTTPBIN_POD -- \
  sh -c 'nc -zv rabbitmq.demo.svc.cluster.local 5672 2>&1 || echo "Connection test completed"'
```

**기대 출력:** rabbitmq:5672 포트로의 연결이 성공한다.

**Step 7: 통신 토폴로지 정리**

```bash
echo "============================================="
echo "데모 앱 마이크로서비스 토폴로지"
echo "============================================="
echo ""
echo "  [외부 사용자]"
echo "       │"
echo "       ▼ NodePort 30080"
echo "  [nginx-web] ──────► [httpbin v1/v2]"
echo "       │                    │"
echo "       │                    ├──► [postgres:5432]"
echo "       │                    ├──► [redis:6379]"
echo "       │                    ├──► [rabbitmq:5672]"
echo "       │                    └──► [keycloak:8080]"
echo "       │"
echo "       └──► [redis:6379] (캐시)"
echo ""
echo "  [keycloak] ──────► [postgres:5432]"
```

**확인 문제:**
1. Pod IP는 고정되는가? Pod가 재시작되면 IP는 어떻게 되는가?
2. Service가 로드밸런싱하는 방식(기본)은 무엇인가?
3. 다른 네임스페이스의 Pod와 통신하려면 어떤 DNS 이름을 사용해야 하는가?
4. Pod CIDR 10.20.0.0/16에서 최대 몇 개의 Pod IP를 할당할 수 있는가?

**관련 KCNA 시험 주제:** Kubernetes Fundamentals — Pod Networking, Service Routing

---

## 실습 4: 설정과 스토리지 (Fundamentals)

> ConfigMap, Secret, PVC를 활용하여 설정 외부화와 데이터 영속성을 실습한다.

---

### Lab 4.1: ConfigMap 생성 및 Pod에 마운트

**학습 목표:**
- ConfigMap을 생성하는 여러 방법(리터럴, 파일, YAML)을 학습한다.
- ConfigMap을 환경변수와 볼륨으로 Pod에 전달하는 방법을 실습한다.
- 설정 외부화(Externalized Configuration)의 장점을 이해한다.

**Step 1: 리터럴로 ConfigMap 생성**

```bash
# 리터럴로 ConfigMap 생성
kubectl --context=dev create configmap app-config -n demo \
  --from-literal=APP_ENV=development \
  --from-literal=LOG_LEVEL=info \
  --from-literal=DB_HOST=postgres.demo.svc.cluster.local \
  --from-literal=REDIS_HOST=redis.demo.svc.cluster.local \
  --from-literal=RABBITMQ_HOST=rabbitmq.demo.svc.cluster.local

# ConfigMap 확인
kubectl --context=dev get configmap app-config -n demo -o yaml
```

**기대 출력:**

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
  namespace: demo
data:
  APP_ENV: development
  DB_HOST: postgres.demo.svc.cluster.local
  LOG_LEVEL: info
  RABBITMQ_HOST: rabbitmq.demo.svc.cluster.local
  REDIS_HOST: redis.demo.svc.cluster.local
```

**Step 2: ConfigMap을 환경변수로 사용**

```bash
# ConfigMap을 환경변수로 사용하는 Pod 생성
kubectl --context=dev apply -n demo -f - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: config-env-pod
  namespace: demo
spec:
  containers:
    - name: app
      image: busybox:1.36
      command: ["sh", "-c", "env | sort && sleep 3600"]
      envFrom:
        - configMapRef:
            name: app-config
EOF

# 환경변수 확인
kubectl --context=dev exec config-env-pod -n demo -- env | grep -E "(APP_ENV|LOG_LEVEL|DB_HOST|REDIS_HOST|RABBITMQ_HOST)"
```

**기대 출력:**

```
APP_ENV=development
DB_HOST=postgres.demo.svc.cluster.local
LOG_LEVEL=info
RABBITMQ_HOST=rabbitmq.demo.svc.cluster.local
REDIS_HOST=redis.demo.svc.cluster.local
```

**Step 3: ConfigMap을 볼륨으로 마운트**

```bash
# ConfigMap을 파일로 마운트하는 Pod
kubectl --context=dev apply -n demo -f - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: config-volume-pod
  namespace: demo
spec:
  containers:
    - name: app
      image: busybox:1.36
      command: ["sh", "-c", "ls -la /etc/app-config/ && echo '---' && cat /etc/app-config/APP_ENV && sleep 3600"]
      volumeMounts:
        - name: config
          mountPath: /etc/app-config
          readOnly: true
  volumes:
    - name: config
      configMap:
        name: app-config
EOF

# 마운트된 파일 확인
kubectl --context=dev exec config-volume-pod -n demo -- ls -la /etc/app-config/
kubectl --context=dev exec config-volume-pod -n demo -- cat /etc/app-config/DB_HOST
```

**기대 출력:** `/etc/app-config/` 디렉토리에 ConfigMap의 각 키가 파일로 생성된다. 파일 내용은 해당 키의 값이다.

**Step 4: nginx 설정 파일을 ConfigMap으로 관리**

```bash
# nginx 설정 파일을 ConfigMap으로 생성
kubectl --context=dev apply -n demo -f - <<EOF
apiVersion: v1
kind: ConfigMap
metadata:
  name: nginx-config
  namespace: demo
data:
  nginx.conf: |
    server {
        listen 80;
        server_name localhost;

        location / {
            root /usr/share/nginx/html;
            index index.html;
        }

        location /api {
            proxy_pass http://httpbin.demo.svc.cluster.local;
            proxy_set_header Host \$host;
            proxy_set_header X-Real-IP \$remote_addr;
        }

        location /health {
            return 200 'OK';
            add_header Content-Type text/plain;
        }
    }
EOF

# ConfigMap 확인
kubectl --context=dev get configmap nginx-config -n demo -o yaml
```

**Step 5: 정리**

```bash
kubectl --context=dev delete pod config-env-pod config-volume-pod -n demo --ignore-not-found
kubectl --context=dev delete configmap app-config nginx-config -n demo --ignore-not-found
```

**확인 문제:**
1. ConfigMap을 Pod에 전달하는 두 가지 방법은 무엇인가?
2. ConfigMap을 볼륨으로 마운트했을 때, ConfigMap을 업데이트하면 Pod에 자동 반영되는가?
3. ConfigMap에 민감한 데이터(비밀번호)를 저장하면 안 되는 이유는 무엇인가?
4. `envFrom`과 `env[].valueFrom.configMapKeyRef`의 차이는 무엇인가?

**관련 KCNA 시험 주제:** Kubernetes Fundamentals — ConfigMap, Configuration Management

---

### Lab 4.2: Secret 확인 (postgres, rabbitmq 패스워드)

**학습 목표:**
- Kubernetes Secret의 저장 방식(base64 인코딩)을 이해한다.
- tart-infra 데모 앱의 실제 Secret을 확인한다.
- Secret과 ConfigMap의 차이를 파악한다.

**Step 1: demo 네임스페이스의 Secret 목록 확인**

```bash
# Secret 목록 확인
kubectl --context=dev get secrets -n demo
```

**기대 출력:** postgres, rabbitmq, keycloak 관련 Secret이 표시된다.

**Step 2: postgres Secret 확인**

```bash
# postgres 관련 Secret 확인
kubectl --context=dev get secret -n demo -l app=postgres -o yaml
```

**기대 출력:** base64로 인코딩된 Secret 데이터가 표시된다.

**Step 3: Secret 값 디코딩**

```bash
# postgres 환경변수 확인 (Deployment에서)
kubectl --context=dev get deployment postgres -n demo \
  -o jsonpath='{range .spec.template.spec.containers[0].env[*]}{.name}={.value}{"\n"}{end}'
```

**기대 출력:**

```
POSTGRES_DB=demo
POSTGRES_USER=demo
POSTGRES_PASSWORD=demo123
```

**Step 4: rabbitmq 환경변수 확인**

```bash
# rabbitmq 환경변수 확인
kubectl --context=dev get deployment rabbitmq -n demo \
  -o jsonpath='{range .spec.template.spec.containers[0].env[*]}{.name}={.value}{"\n"}{end}'
```

**기대 출력:**

```
RABBITMQ_DEFAULT_USER=demo
RABBITMQ_DEFAULT_PASS=demo123
```

**Step 5: keycloak 환경변수 확인**

```bash
# keycloak 환경변수 확인
kubectl --context=dev get deployment keycloak -n demo \
  -o jsonpath='{range .spec.template.spec.containers[0].env[*]}{.name}={.value}{"\n"}{end}'
```

**기대 출력:**

```
KEYCLOAK_ADMIN=admin
KC_DB_URL=jdbc:postgresql://postgres:5432/demo
```

**Step 6: Secret 생성 실습**

```bash
# Secret 생성
kubectl --context=dev create secret generic demo-db-secret -n demo \
  --from-literal=username=demo \
  --from-literal=password=demo123

# Secret 확인 (base64 인코딩된 상태)
kubectl --context=dev get secret demo-db-secret -n demo -o yaml

# Secret 값 디코딩
kubectl --context=dev get secret demo-db-secret -n demo \
  -o jsonpath='{.data.username}' | base64 -d && echo ""
kubectl --context=dev get secret demo-db-secret -n demo \
  -o jsonpath='{.data.password}' | base64 -d && echo ""
```

**기대 출력:** `demo`와 `demo123`이 각각 출력된다.

**Step 7: 정리**

```bash
kubectl --context=dev delete secret demo-db-secret -n demo --ignore-not-found
```

**확인 문제:**
1. Secret은 기본적으로 암호화되어 저장되는가? (base64는 암호화인가?)
2. etcd에서 Secret을 암호화하려면 어떤 설정이 필요한가?
3. Secret을 Pod에 전달하는 방법은 ConfigMap과 동일한가?
4. Secret의 type 필드에 올 수 있는 값 3가지를 나열하라.

**관련 KCNA 시험 주제:** Kubernetes Fundamentals — Secrets, Security

---

### Lab 4.3: PVC 확인 (Prometheus 10Gi, Jenkins 5Gi)

**학습 목표:**
- PersistentVolume(PV)과 PersistentVolumeClaim(PVC)의 관계를 이해한다.
- tart-infra에서 Prometheus와 Jenkins가 사용하는 스토리지를 확인한다.
- Storage Class의 역할을 파악한다.

**Step 1: PVC 목록 확인**

```bash
# 전체 PVC 목록
kubectl --context=dev get pvc --all-namespaces
```

**기대 출력:** monitoring 네임스페이스의 Prometheus PVC(10Gi)와 Jenkins PVC(5Gi) 등이 표시된다.

**Step 2: Prometheus PVC 상세 확인**

```bash
# Prometheus PVC 상세
kubectl --context=dev get pvc -n monitoring -o wide
```

**기대 출력:**

```
NAME                       STATUS   VOLUME   CAPACITY   ACCESS MODES   STORAGECLASS
prometheus-server           Bound    pv-xxx   10Gi       RWO            local-path
```

STATUS가 `Bound`이면 PV와 성공적으로 연결된 것이다.

**Step 3: PVC 상세 정보**

```bash
# PVC 상세 정보
kubectl --context=dev describe pvc -n monitoring $(kubectl --context=dev get pvc -n monitoring -o jsonpath='{.items[0].metadata.name}')
```

**기대 출력 중 핵심:**
- `Status: Bound`
- `Capacity: 10Gi`
- `Access Modes: RWO (ReadWriteOnce)`
- `StorageClass: local-path`

**Step 4: PV 확인**

```bash
# PV 확인
kubectl --context=dev get pv
```

**기대 출력:** PVC에 바인딩된 PV 목록이 표시된다.

**Step 5: Storage Class 확인**

```bash
# Storage Class 확인
kubectl --context=dev get storageclass
```

**기대 출력:** 사용 가능한 StorageClass 목록이 표시된다. `(default)` 표시가 있는 것이 기본 StorageClass이다.

**Step 6: Prometheus의 데이터 보관 설정 확인**

```bash
# Prometheus의 retention 설정 확인
kubectl --context=dev get deployment -n monitoring -l app.kubernetes.io/name=prometheus -o yaml | grep -A 2 "retention"
```

**기대 출력:** Prometheus의 데이터 보관 기간이 7일(7d)로 설정되어 있다. 10Gi 볼륨에 7일치의 메트릭 데이터가 저장된다.

**Step 7: PVC 생성 실습**

```bash
# PVC 생성 실습
kubectl --context=dev apply -n demo -f - <<EOF
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: test-pvc
  namespace: demo
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 1Gi
EOF

# PVC 상태 확인
kubectl --context=dev get pvc test-pvc -n demo

# PVC를 사용하는 Pod 생성
kubectl --context=dev apply -n demo -f - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: pvc-test-pod
  namespace: demo
spec:
  containers:
    - name: app
      image: busybox:1.36
      command: ["sh", "-c", "echo 'Hello PVC' > /data/test.txt && cat /data/test.txt && sleep 3600"]
      volumeMounts:
        - name: data
          mountPath: /data
  volumes:
    - name: data
      persistentVolumeClaim:
        claimName: test-pvc
EOF

# 데이터 확인
kubectl --context=dev exec pvc-test-pod -n demo -- cat /data/test.txt
```

**기대 출력:** `Hello PVC`가 출력된다.

**Step 8: 정리**

```bash
kubectl --context=dev delete pod pvc-test-pod -n demo --ignore-not-found
kubectl --context=dev delete pvc test-pvc -n demo --ignore-not-found
```

**확인 문제:**
1. PV와 PVC의 관계를 설명하라. 누가 PV를 생성하고, 누가 PVC를 생성하는가?
2. Access Mode 중 RWO, ROX, RWX의 차이는 무엇인가?
3. StorageClass의 역할은 무엇인가? Dynamic Provisioning이란 무엇인가?
4. PVC가 Pending 상태인 경우 가능한 원인은 무엇인가?

**관련 KCNA 시험 주제:** Kubernetes Fundamentals — Persistent Storage, PV/PVC

---

## 실습 5: 컨테이너 오케스트레이션 (22%)

> 컨테이너 런타임, 자동 복구, 롤링 업데이트, 스케줄링 등 오케스트레이션의 핵심 개념을 실습한다.

---

### Lab 5.1: containerd와 CRI 확인 (SSH로 crictl)

**학습 목표:**
- Container Runtime Interface(CRI)의 개념을 이해한다.
- containerd와 crictl을 사용하여 컨테이너를 직접 관리하는 방법을 학습한다.
- Kubernetes가 컨테이너를 실행하는 내부 과정을 파악한다.

**Step 1: SSH로 노드 접속**

```bash
# 노드 IP 확인
kubectl --context=dev get nodes -o wide

# SSH 접속
ssh admin@<node-ip>
# 비밀번호: admin
```

**Step 2: containerd 상태 확인**

```bash
# containerd 서비스 상태
sudo systemctl status containerd

# containerd 버전
containerd --version

# containerd 설정 파일 위치
ls -la /etc/containerd/config.toml
```

**기대 출력:** containerd가 `active (running)` 상태이다.

**Step 3: crictl로 컨테이너 조회**

```bash
# 실행 중인 컨테이너 목록
sudo crictl ps

# 모든 컨테이너 (중지된 것 포함)
sudo crictl ps -a

# 특정 Pod의 컨테이너 확인
sudo crictl ps --name nginx
```

**기대 출력:** 현재 노드에서 실행 중인 모든 컨테이너가 표시된다. nginx-web, cilium, kube-proxy 등의 컨테이너가 보인다.

**Step 4: crictl로 이미지 조회**

```bash
# 노드에 캐시된 이미지 목록
sudo crictl images

# 이미지 크기 확인
sudo crictl images --output=table
```

**기대 출력:** nginx:alpine, redis:7-alpine, postgres:16-alpine 등의 이미지가 표시된다.

**Step 5: crictl로 Pod 조회**

```bash
# Pod 목록 (crictl에서의 Pod = sandbox)
sudo crictl pods

# 특정 네임스페이스의 Pod
sudo crictl pods --namespace demo
```

**기대 출력:** Kubernetes Pod가 crictl에서는 sandbox로 표현된다.

**Step 6: 컨테이너 상세 정보**

```bash
# nginx 컨테이너 ID 확인
CONTAINER_ID=$(sudo crictl ps --name nginx -q | head -1)

# 컨테이너 상세 정보
sudo crictl inspect $CONTAINER_ID | head -30
```

**기대 출력:** 컨테이너의 상세 설정(이미지, 환경변수, 마운트 등)이 JSON 형식으로 출력된다.

**Step 7: SSH 세션 종료**

```bash
exit
```

**확인 문제:**
1. CRI(Container Runtime Interface)란 무엇인가?
2. containerd와 Docker의 관계를 설명하라.
3. crictl과 kubectl의 차이점은 무엇인가?
4. Kubernetes 1.24에서 dockershim이 제거된 이유는 무엇인가?

**관련 KCNA 시험 주제:** Container Orchestration — Container Runtime, CRI, containerd

---

### Lab 5.2: 자동 복구 관찰 (Pod 삭제 → 자동 재생성)

**학습 목표:**
- Kubernetes의 자가 복구(Self-Healing) 메커니즘을 직접 관찰한다.
- ReplicaSet이 원하는 상태(desired state)를 유지하는 과정을 이해한다.
- 다양한 장애 시나리오에서의 복구 동작을 확인한다.

**Step 1: 현재 nginx-web Pod 상태 확인**

```bash
# nginx-web Pod 3개 확인
kubectl --context=dev get pods -n demo -l app=nginx-web -o wide
```

**기대 출력:** 3개의 Pod가 모두 Running 상태이다.

**Step 2: Pod 하나 삭제**

```bash
# Pod 이름 기록
kubectl --context=dev get pods -n demo -l app=nginx-web -o name

# 첫 번째 Pod 삭제
POD_NAME=$(kubectl --context=dev get pods -n demo -l app=nginx-web -o jsonpath='{.items[0].metadata.name}')
echo "삭제할 Pod: $POD_NAME"
kubectl --context=dev delete pod $POD_NAME -n demo
```

**Step 3: 자동 재생성 관찰**

```bash
# 즉시 Pod 목록 확인
kubectl --context=dev get pods -n demo -l app=nginx-web -o wide
```

**기대 출력:** 삭제한 Pod가 사라지고, 새로운 이름의 Pod가 자동으로 생성되어 3개를 유지한다. 새 Pod의 AGE가 매우 짧다.

**Step 4: 실시간 관찰 (watch 모드)**

```bash
# 다른 Pod 삭제하면서 실시간 관찰
kubectl --context=dev get pods -n demo -l app=nginx-web -w &
WATCH_PID=$!

# 2초 후 Pod 삭제
sleep 2
POD_NAME=$(kubectl --context=dev get pods -n demo -l app=nginx-web -o jsonpath='{.items[0].metadata.name}')
kubectl --context=dev delete pod $POD_NAME -n demo

# 10초 관찰 후 watch 중지
sleep 10
kill $WATCH_PID 2>/dev/null
```

**기대 출력:** Pod가 `Terminating` → 새 Pod가 `Pending` → `ContainerCreating` → `Running` 상태로 전환되는 과정을 실시간으로 관찰한다.

**Step 5: ReplicaSet 이벤트 확인**

```bash
# ReplicaSet 이벤트에서 자가 복구 기록 확인
RS_NAME=$(kubectl --context=dev get rs -n demo -l app=nginx-web -o jsonpath='{.items[0].metadata.name}')
kubectl --context=dev describe rs $RS_NAME -n demo | grep -A 20 "Events:"
```

**기대 출력:**
```
Events:
  Type    Reason            Age   From                   Message
  ----    ------            ----  ----                   -------
  Normal  SuccessfulCreate  10s   replicaset-controller  Created pod: nginx-web-xxxxx-yyyyy
```

ReplicaSet Controller가 새 Pod를 생성한 이벤트가 기록된다.

**Step 6: Liveness/Readiness Probe에 의한 자동 재시작 실습**

```bash
# liveness probe가 설정된 테스트 Pod 생성
kubectl --context=dev apply -n demo -f - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: liveness-test
  namespace: demo
spec:
  containers:
    - name: app
      image: busybox:1.36
      command: ["sh", "-c", "touch /tmp/healthy && sleep 20 && rm /tmp/healthy && sleep 600"]
      livenessProbe:
        exec:
          command: ["cat", "/tmp/healthy"]
        initialDelaySeconds: 5
        periodSeconds: 5
        failureThreshold: 3
EOF

# Pod 상태 관찰 (20초 후 liveness probe 실패 → 재시작)
kubectl --context=dev get pod liveness-test -n demo -w
```

**기대 출력:** 약 35초 후 (20초 대기 + 15초 probe 실패 3회) Pod가 재시작(RESTARTS 카운트 증가)된다.

**Step 7: 재시작 확인**

```bash
# 재시작 횟수 확인
kubectl --context=dev get pod liveness-test -n demo
```

**기대 출력:**

```
NAME            READY   STATUS    RESTARTS      AGE
liveness-test   1/1     Running   1 (10s ago)   60s
```

**Step 8: 정리**

```bash
kubectl --context=dev delete pod liveness-test -n demo --ignore-not-found
```

**확인 문제:**
1. Pod가 삭제되었을 때 새 Pod를 생성하는 것은 어떤 컴포넌트인가?
2. livenessProbe와 readinessProbe의 차이점은 무엇인가?
3. `failureThreshold`와 `periodSeconds`의 관계를 설명하라.
4. Self-Healing이 동작하지 않는 경우는 언제인가? (예: 독립 Pod)

**관련 KCNA 시험 주제:** Container Orchestration — Self-Healing, Health Checks, Probes

---

### Lab 5.3: Rolling Update 실습 (nginx 이미지 변경 → rollout)

**학습 목표:**
- Rolling Update 전략의 동작 원리를 이해한다.
- maxSurge와 maxUnavailable 설정의 효과를 확인한다.
- Rollback을 수행하고 Revision History를 관리한다.

**Step 1: 현재 nginx-web Deployment 상태 확인**

```bash
# Deployment 상태
kubectl --context=dev get deployment nginx-web -n demo

# 현재 이미지 확인
kubectl --context=dev get deployment nginx-web -n demo \
  -o jsonpath='{.spec.template.spec.containers[0].image}'
echo ""
```

**기대 출력:** `nginx:alpine`

**Step 2: Rolling Update 실행 전 — 테스트 Deployment 생성**

```bash
# 롤링 업데이트 테스트용 Deployment 생성 (실제 nginx-web은 건드리지 않음)
kubectl --context=dev apply -n demo -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: rollout-test
  namespace: demo
spec:
  replicas: 4
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 1
  selector:
    matchLabels:
      app: rollout-test
  template:
    metadata:
      labels:
        app: rollout-test
    spec:
      containers:
        - name: web
          image: nginx:1.24-alpine
          ports:
            - containerPort: 80
          resources:
            requests:
              cpu: 50m
              memory: 64Mi
EOF

# Pod 생성 대기
kubectl --context=dev rollout status deployment/rollout-test -n demo
```

**기대 출력:** `deployment "rollout-test" successfully rolled out`

**Step 3: 이미지 업데이트 (Rolling Update 트리거)**

```bash
# 이미지 변경 (롤링 업데이트 시작)
kubectl --context=dev set image deployment/rollout-test web=nginx:1.25-alpine -n demo

# 롤아웃 상태 실시간 관찰
kubectl --context=dev rollout status deployment/rollout-test -n demo
```

**기대 출력:**
```
Waiting for deployment "rollout-test" rollout to finish: 1 out of 4 new replicas have been updated...
Waiting for deployment "rollout-test" rollout to finish: 2 out of 4 new replicas have been updated...
Waiting for deployment "rollout-test" rollout to finish: 3 out of 4 new replicas have been updated...
deployment "rollout-test" successfully rolled out
```

**Step 4: ReplicaSet 히스토리 확인**

```bash
# ReplicaSet 확인 — 이전 RS와 새 RS가 모두 존재
kubectl --context=dev get rs -n demo -l app=rollout-test
```

**기대 출력:**

```
NAME                      DESIRED   CURRENT   READY   AGE
rollout-test-xxxxxxxxxx   0         0         0       2m    ← 이전 (nginx:1.24)
rollout-test-yyyyyyyyyy   4         4         4       30s   ← 현재 (nginx:1.25)
```

이전 ReplicaSet은 DESIRED=0으로 유지된다 (롤백에 사용).

**Step 5: Rollout History 확인**

```bash
# 롤아웃 히스토리
kubectl --context=dev rollout history deployment/rollout-test -n demo
```

**기대 출력:**

```
deployment.apps/rollout-test
REVISION  CHANGE-CAUSE
1         <none>
2         <none>
```

**Step 6: Rollback 실행**

```bash
# 이전 버전으로 롤백
kubectl --context=dev rollout undo deployment/rollout-test -n demo

# 롤백 확인
kubectl --context=dev rollout status deployment/rollout-test -n demo

# 이미지 확인 — 원래 버전으로 복구
kubectl --context=dev get deployment rollout-test -n demo \
  -o jsonpath='{.spec.template.spec.containers[0].image}'
echo ""
```

**기대 출력:** `nginx:1.24-alpine` — 이전 버전으로 복구되었다.

**Step 7: 특정 Revision으로 롤백**

```bash
# 히스토리 확인
kubectl --context=dev rollout history deployment/rollout-test -n demo

# 특정 revision으로 롤백
kubectl --context=dev rollout undo deployment/rollout-test -n demo --to-revision=2

# 확인
kubectl --context=dev get deployment rollout-test -n demo \
  -o jsonpath='{.spec.template.spec.containers[0].image}'
echo ""
```

**Step 8: 정리**

```bash
kubectl --context=dev delete deployment rollout-test -n demo --ignore-not-found
```

**확인 문제:**
1. `maxSurge: 1`, `maxUnavailable: 1` 설정에서 4개 레플리카를 업데이트할 때, 동시에 존재할 수 있는 최대 Pod 수는?
2. Rollback 시 이전 ReplicaSet이 즉시 삭제되지 않는 이유는 무엇인가?
3. Rolling Update와 Recreate 전략의 장단점을 비교하라.
4. `kubectl rollout pause`와 `resume`은 어떤 상황에서 유용한가?

**관련 KCNA 시험 주제:** Container Orchestration — Rolling Update, Deployment Strategy, Rollback

---

### Lab 5.4: 스케줄링 확인 (nodeSelector, taint/toleration)

**학습 목표:**
- nodeSelector를 사용하여 Pod를 특정 노드에 배치하는 방법을 학습한다.
- Taint와 Toleration의 개념을 이해한다.
- Control Plane 노드에 Taint가 설정된 이유를 파악한다.

**Step 1: 노드 Labels 확인**

```bash
# 모든 노드의 Labels 확인
kubectl --context=dev get nodes --show-labels
```

**기대 출력:** 각 노드에 기본 Labels가 설정되어 있다:
- `kubernetes.io/os=linux`
- `kubernetes.io/arch=arm64` (Apple Silicon 기반)
- `node-role.kubernetes.io/control-plane` (컨트롤 플레인 노드)

**Step 2: 노드 Taint 확인**

```bash
# 노드의 Taint 확인
kubectl --context=dev get nodes -o custom-columns='NAME:.metadata.name,TAINTS:.spec.taints'
```

**기대 출력:** Control Plane 노드에 `node-role.kubernetes.io/control-plane:NoSchedule` Taint가 설정되어 있을 수 있다. 이 Taint는 일반 Pod가 Control Plane 노드에 스케줄되는 것을 방지한다.

**Step 3: nodeSelector를 사용한 스케줄링**

```bash
# nodeSelector로 특정 노드에 Pod 배치
kubectl --context=dev apply -n demo -f - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: selector-test
  namespace: demo
spec:
  nodeSelector:
    kubernetes.io/os: linux
  containers:
    - name: app
      image: nginx:alpine
      resources:
        requests:
          cpu: 50m
          memory: 64Mi
EOF

# Pod가 배치된 노드 확인
kubectl --context=dev get pod selector-test -n demo -o wide
```

**기대 출력:** Pod가 `kubernetes.io/os=linux` Label이 있는 노드에 배치된다.

**Step 4: Toleration 실습**

```bash
# Taint가 있는 노드에도 배치될 수 있는 Pod (toleration 설정)
kubectl --context=dev apply -n demo -f - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: toleration-test
  namespace: demo
spec:
  tolerations:
    - key: "node-role.kubernetes.io/control-plane"
      operator: "Exists"
      effect: "NoSchedule"
  containers:
    - name: app
      image: nginx:alpine
      resources:
        requests:
          cpu: 50m
          memory: 64Mi
EOF

# Pod 배치 확인
kubectl --context=dev get pod toleration-test -n demo -o wide
```

**기대 출력:** toleration이 설정된 Pod는 Control Plane 노드에도 스케줄될 수 있다.

**Step 5: Control Plane의 System Pod가 Toleration을 가지는 이유 확인**

```bash
# kube-system의 Pod가 Control Plane에서 실행되는 이유 확인
kubectl --context=dev get pod -n kube-system -l k8s-app=kube-dns \
  -o jsonpath='{.items[0].spec.tolerations}' | python3 -m json.tool
```

**기대 출력:** CoreDNS Pod에 다양한 Toleration이 설정되어 있어 어떤 노드에서든 실행될 수 있다.

**Step 6: 정리**

```bash
kubectl --context=dev delete pod selector-test toleration-test -n demo --ignore-not-found
```

**확인 문제:**
1. nodeSelector와 nodeAffinity의 차이점은 무엇인가?
2. Taint의 effect 3가지(NoSchedule, PreferNoSchedule, NoExecute)의 차이를 설명하라.
3. Control Plane 노드에 Taint가 설정되는 이유는 무엇인가?
4. Pod Anti-Affinity를 사용하면 어떤 이점이 있는가?

**관련 KCNA 시험 주제:** Container Orchestration — Scheduling, Taints and Tolerations, Node Selection

---

## 실습 6: 클라우드 네이티브 아키텍처 (16%)

> CNCF 프로젝트 매핑, 마이크로서비스 패턴, 서비스 메시, 오토스케일링 등을 실습한다.

---

### Lab 6.1: CNCF 프로젝트 매핑 (인프라에서 사용 중인 CNCF 프로젝트 목록 작성)

**학습 목표:**
- tart-infra에서 사용하는 CNCF 프로젝트를 식별하고 분류한다.
- CNCF 프로젝트의 성숙도 단계(Sandbox → Incubating → Graduated)를 이해한다.
- 각 프로젝트의 역할과 카테고리를 매핑한다.

**Step 1: Helm Release에서 설치된 프로젝트 확인**

```bash
# 설치된 Helm 차트 목록
helm --kube-context=dev list --all-namespaces
```

**기대 출력:** cilium, hubble, prometheus-stack, loki, argocd, jenkins, metrics-server 등의 Helm Release가 표시된다.

**Step 2: 각 프로젝트 Pod 확인**

```bash
# CNCF 프로젝트별 Pod 확인
echo "=== Kubernetes (Graduated) — 컨테이너 오케스트레이션 ==="
kubectl --context=dev get pods -n kube-system -l tier=control-plane --no-headers | wc -l
echo "Control Plane Pod 수"

echo ""
echo "=== containerd (Graduated) — 컨테이너 런타임 ==="
kubectl --context=dev get nodes -o jsonpath='{.items[0].status.nodeInfo.containerRuntimeVersion}'
echo ""

echo ""
echo "=== Prometheus (Graduated) — 모니터링 및 메트릭 ==="
kubectl --context=dev get pods -n monitoring -l app.kubernetes.io/name=prometheus

echo ""
echo "=== Helm (Graduated) — 패키지 관리자 ==="
helm version --short

echo ""
echo "=== Cilium (Graduated) — CNI 및 네트워크 보안 ==="
kubectl --context=dev get pods -n kube-system -l k8s-app=cilium

echo ""
echo "=== ArgoCD (Graduated) — GitOps 배포 ==="
kubectl --context=dev get pods -n argocd

echo ""
echo "=== Grafana (— ) — 대시보드 및 시각화 ==="
kubectl --context=dev get pods -n monitoring -l app.kubernetes.io/name=grafana

echo ""
echo "=== Loki (— ) — 로그 수집 ==="
kubectl --context=dev get pods -n monitoring -l app.kubernetes.io/name=loki

echo ""
echo "=== Hubble (Cilium 생태계) — 네트워크 관측 ==="
kubectl --context=dev get pods -n kube-system -l k8s-app=hubble-ui
```

**Step 3: CNCF 프로젝트 카테고리별 정리**

```bash
echo "============================================="
echo "tart-infra CNCF 프로젝트 매핑"
echo "============================================="
echo ""
echo "1. Container Runtime"
echo "   └── containerd (Graduated)"
echo ""
echo "2. Container Orchestration"
echo "   └── Kubernetes (Graduated)"
echo ""
echo "3. Networking / CNI"
echo "   └── Cilium (Graduated)"
echo "   └── Hubble (Cilium 생태계)"
echo ""
echo "4. Service Mesh"
echo "   └── Istio (Graduated)"
echo ""
echo "5. Monitoring & Observability"
echo "   ├── Prometheus (Graduated) — 메트릭 수집/저장"
echo "   ├── Grafana — 시각화"
echo "   ├── Loki — 로그 집계"
echo "   └── AlertManager — 알림 관리"
echo ""
echo "6. Application Definition & Delivery"
echo "   ├── Helm (Graduated) — 패키지 관리"
echo "   └── ArgoCD (Graduated) — GitOps CD"
echo ""
echo "7. CI/CD"
echo "   └── Jenkins (CNCF 외부) — CI 자동화"
echo ""
echo "8. Autoscaling"
echo "   └── Metrics Server — 리소스 메트릭 제공"
```

**Step 4: CNCF Landscape 카테고리 연습**

```bash
echo "============================================="
echo "KCNA 시험 핵심: CNCF 프로젝트 성숙도"
echo "============================================="
echo ""
echo "Graduated (졸업) — 프로덕션 준비 완료:"
echo "  Kubernetes, Prometheus, containerd, Helm, Cilium, ArgoCD, Istio"
echo ""
echo "Incubating (인큐베이팅) — 성장 단계:"
echo "  (tart-infra에서 직접 사용하는 것 없음)"
echo ""
echo "Sandbox (샌드박스) — 초기 단계:"
echo "  (tart-infra에서 직접 사용하는 것 없음)"
echo ""
echo "비 CNCF 프로젝트:"
echo "  Jenkins, Grafana, Loki, Keycloak, RabbitMQ, PostgreSQL, Redis"
```

**확인 문제:**
1. CNCF 프로젝트의 세 가지 성숙도 단계를 설명하라.
2. tart-infra에서 사용하는 Graduated 프로젝트 5개를 나열하라.
3. Prometheus와 Grafana의 관계를 설명하라.
4. CNCF Landscape에서 "Observability" 카테고리에 속하는 프로젝트는 무엇인가?

**관련 KCNA 시험 주제:** Cloud Native Architecture — CNCF Projects, Cloud Native Landscape

---

### Lab 6.2: 마이크로서비스 토폴로지 분석 (nginx→httpbin→postgres/redis/rabbitmq)

**학습 목표:**
- tart-infra 데모 앱의 마이크로서비스 토폴로지를 분석한다.
- 각 서비스의 역할과 통신 관계를 파악한다.
- 마이크로서비스 패턴(API Gateway, Backend Service, Database)을 식별한다.

**Step 1: 전체 서비스 토폴로지 확인**

```bash
# 모든 Deployment와 이미지 확인
kubectl --context=dev get deployments -n demo \
  -o custom-columns='NAME:.metadata.name,IMAGE:.spec.template.spec.containers[0].image,REPLICAS:.spec.replicas'
```

**기대 출력:**

```
NAME         IMAGE                               REPLICAS
nginx-web    nginx:alpine                        3
httpbin-v1   kong/httpbin:latest                 2
httpbin-v2   kong/httpbin:latest                 1
redis        redis:7-alpine                      1
postgres     postgres:16-alpine                  1
rabbitmq     rabbitmq:3-management-alpine        1
keycloak     quay.io/keycloak/keycloak:latest    1
```

**Step 2: 각 서비스의 역할 분석**

```bash
echo "============================================="
echo "데모 앱 마이크로서비스 역할 분석"
echo "============================================="
echo ""
echo "[nginx-web] — API Gateway / Reverse Proxy"
echo "  이미지: nginx:alpine"
echo "  레플리카: 3 (고가용성)"
echo "  접근: NodePort 30080 (외부 트래픽 진입점)"
echo "  역할: 외부 요청을 받아 적절한 백엔드로 라우팅"
echo ""
echo "[httpbin v1/v2] — API 서비스 (카나리 배포 대상)"
echo "  이미지: kong/httpbin:latest"
echo "  v1 레플리카: 2, v2 레플리카: 1"
echo "  접근: ClusterIP (내부 전용)"
echo "  역할: HTTP 요청/응답 테스트, API 엔드포인트 제공"
echo ""
echo "[redis] — 캐시/세션 스토어"
echo "  이미지: redis:7-alpine"
echo "  레플리카: 1"
echo "  포트: 6379"
echo "  역할: 인메모리 캐시, 세션 저장"
echo ""
echo "[postgres] — 관계형 데이터베이스"
echo "  이미지: postgres:16-alpine"
echo "  레플리카: 1"
echo "  포트: 5432"
echo "  데이터베이스: demo, 사용자: demo"
echo "  역할: 영구 데이터 저장"
echo ""
echo "[rabbitmq] — 메시지 브로커"
echo "  이미지: rabbitmq:3-management-alpine"
echo "  레플리카: 1"
echo "  포트: 5672 (AMQP), 15672 (관리 UI)"
echo "  역할: 비동기 메시지 큐"
echo ""
echo "[keycloak] — 인증/인가 서버"
echo "  이미지: quay.io/keycloak/keycloak:latest"
echo "  레플리카: 1"
echo "  접근: NodePort 30880"
echo "  역할: OAuth 2.0 / OpenID Connect 기반 인증"
```

**Step 3: 서비스 간 통신 관계 확인**

```bash
# keycloak의 DB 연결 설정 확인
kubectl --context=dev get deployment keycloak -n demo \
  -o jsonpath='{range .spec.template.spec.containers[0].env[*]}{.name}: {.value}{"\n"}{end}'
```

**기대 출력:**

```
KEYCLOAK_ADMIN: admin
KC_DB_URL: jdbc:postgresql://postgres:5432/demo
```

keycloak이 postgres와 통신하는 것을 확인할 수 있다.

**Step 4: 마이크로서비스 패턴 식별**

```bash
echo "============================================="
echo "마이크로서비스 패턴 식별"
echo "============================================="
echo ""
echo "1. API Gateway 패턴"
echo "   nginx-web이 외부 트래픽의 진입점 역할"
echo "   /api → httpbin, / → nginx static"
echo ""
echo "2. Database per Service 패턴"
echo "   postgres가 중앙 DB이지만, 각 서비스가 독립적 접근"
echo ""
echo "3. Event-Driven 패턴"
echo "   rabbitmq를 통한 비동기 메시지 전달"
echo ""
echo "4. Caching 패턴"
echo "   redis를 통한 인메모리 캐싱"
echo ""
echo "5. Identity Provider 패턴"
echo "   keycloak으로 중앙집중식 인증 관리"
echo ""
echo "6. Canary Deployment 패턴"
echo "   httpbin v1(80%)/v2(20%) 트래픽 분배"
```

**확인 문제:**
1. 마이크로서비스 아키텍처의 장점 3가지를 나열하라.
2. API Gateway 패턴의 역할은 무엇인가?
3. 메시지 브로커(RabbitMQ)를 사용하는 이유는 무엇인가?
4. 모놀리식 아키텍처와 마이크로서비스 아키텍처의 주요 차이점은?

**관련 KCNA 시험 주제:** Cloud Native Architecture — Microservices, Design Patterns

---

### Lab 6.3: 서비스 메시 관찰 (Istio sidecar, VirtualService, DestinationRule)

**학습 목표:**
- Istio 서비스 메시의 구성 요소를 확인한다.
- VirtualService, DestinationRule, Gateway 리소스를 분석한다.
- mTLS, 카나리 배포, Circuit Breaker 설정을 확인한다.

**Step 1: Istio 컴포넌트 확인**

```bash
# Istio 시스템 Pod 확인
kubectl --context=dev get pods -n istio-system
```

**기대 출력:** istiod(Pilot), istio-ingressgateway 등의 Pod가 Running 상태이다.

**Step 2: Sidecar Injection 확인**

```bash
# demo 네임스페이스의 sidecar injection 설정 확인
kubectl --context=dev get namespace demo -o yaml | grep istio

# Pod에 istio-proxy sidecar가 주입되었는지 확인
kubectl --context=dev get pods -n demo -o jsonpath='{range .items[*]}{.metadata.name}: {range .spec.containers[*]}{.name} {end}{"\n"}{end}'
```

**기대 출력:** 각 Pod에 `istio-proxy` 컨테이너가 sidecar로 주입되어 있으면 서비스 메시가 적용된 것이다.

**Step 3: VirtualService 확인 (카나리 배포)**

```bash
# VirtualService 확인
kubectl --context=dev get virtualservices -n demo
kubectl --context=dev get virtualservice -n demo -o yaml
```

**기대 출력 중 핵심 (httpbin 카나리 배포):**

```yaml
apiVersion: networking.istio.io/v1
kind: VirtualService
metadata:
  name: httpbin
  namespace: demo
spec:
  hosts:
    - httpbin
  http:
    - route:
        - destination:
            host: httpbin
            subset: v1
          weight: 80
        - destination:
            host: httpbin
            subset: v2
          weight: 20
```

httpbin 트래픽의 80%가 v1으로, 20%가 v2로 라우팅된다.

**Step 4: DestinationRule 확인 (Circuit Breaker)**

```bash
# DestinationRule 확인
kubectl --context=dev get destinationrules -n demo
kubectl --context=dev get destinationrule -n demo -o yaml
```

**기대 출력 중 핵심 (Circuit Breaker 설정):**

```yaml
apiVersion: networking.istio.io/v1
kind: DestinationRule
metadata:
  name: httpbin
  namespace: demo
spec:
  host: httpbin
  trafficPolicy:
    connectionPool:
      tcp:
        maxConnections: 100
    outlierDetection:
      consecutive5xxErrors: 3
      interval: 30s
      baseEjectionTime: 30s
  subsets:
    - name: v1
      labels:
        version: v1
    - name: v2
      labels:
        version: v2
```

Circuit Breaker: 연속 3회 5xx 에러 발생 시 30초간 ejection (트래픽 차단).

**Step 5: Gateway 확인**

```bash
# Istio Gateway 확인
kubectl --context=dev get gateways -n demo
kubectl --context=dev get gateway -n demo -o yaml
```

**기대 출력 중 핵심:**
- `/api` → httpbin Service로 라우팅
- `/` → nginx-web Service로 라우팅

**Step 6: mTLS 설정 확인**

```bash
# PeerAuthentication 확인 (mTLS)
kubectl --context=dev get peerauthentication -n demo
kubectl --context=dev get peerauthentication -n demo -o yaml
```

**기대 출력:**

```yaml
apiVersion: security.istio.io/v1
kind: PeerAuthentication
metadata:
  name: default
  namespace: demo
spec:
  mtls:
    mode: STRICT
```

`mode: STRICT`는 demo 네임스페이스의 모든 서비스 간 통신이 mTLS로 암호화됨을 의미한다.

**Step 7: 카나리 배포 동작 확인**

```bash
# httpbin에 반복 요청을 보내 카나리 비율 확인
kubectl --context=dev run canary-test --rm -it --image=curlimages/curl -n demo \
  -- sh -c '
    V1=0; V2=0
    for i in $(seq 1 100); do
      RESULT=$(curl -s http://httpbin/get 2>/dev/null)
      # 응답에서 버전 판별 로직 (실제 구현에 따라 다름)
      echo -n "."
    done
    echo ""
    echo "100 requests completed"
  '
```

**기대 출력:** 100번의 요청 중 약 80번은 v1으로, 약 20번은 v2로 라우팅된다.

**확인 문제:**
1. 서비스 메시의 3대 핵심 기능은 무엇인가?
2. Sidecar Proxy 패턴의 장단점을 설명하라.
3. VirtualService와 DestinationRule의 역할 차이는 무엇인가?
4. mTLS의 STRICT 모드와 PERMISSIVE 모드의 차이는 무엇인가?

**관련 KCNA 시험 주제:** Cloud Native Architecture — Service Mesh, Traffic Management, mTLS

---

### Lab 6.4: HPA 오토스케일링 관찰 및 부하 테스트

**학습 목표:**
- HPA(Horizontal Pod Autoscaler)의 동작 원리를 이해한다.
- tart-infra의 HPA 설정을 확인하고 부하 테스트로 스케일아웃을 관찰한다.
- Metrics Server와 HPA의 관계를 파악한다.

**Step 1: HPA 목록 확인**

```bash
# demo 네임스페이스의 HPA 확인
kubectl --context=dev get hpa -n demo
```

**기대 출력:**

```
NAME         REFERENCE               TARGETS   MINPODS   MAXPODS   REPLICAS   AGE
nginx-web    Deployment/nginx-web    10%/50%   3         10        3          ...
httpbin      Deployment/httpbin-v1   5%/80%    2         6         2          ...
redis        Deployment/redis        3%/80%    1         4         1          ...
postgres     Deployment/postgres     2%/80%    1         4         1          ...
rabbitmq     Deployment/rabbitmq     1%/80%    1         3         1          ...
```

TARGETS 열에서 현재 CPU 사용률 / 임계치를 확인할 수 있다.

**Step 2: HPA 상세 정보 확인**

```bash
# nginx-web HPA 상세
kubectl --context=dev describe hpa nginx-web -n demo
```

**기대 출력 중 핵심:**
- `Reference: Deployment/nginx-web`
- `Metrics: cpu resource utilization (percentage of request)`
- `Min replicas: 3`
- `Max replicas: 10`
- `Target CPU utilization: 50%`
- `Current CPU utilization: 10%` (부하가 없으면 낮음)
- `Current replicas: 3`

**Step 3: Metrics Server 확인**

```bash
# Metrics Server Pod 확인
kubectl --context=dev get pods -n kube-system -l k8s-app=metrics-server

# 현재 Pod 리소스 사용량
kubectl --context=dev top pods -n demo
```

**기대 출력:**

```
NAME                          CPU(cores)   MEMORY(bytes)
nginx-web-xxxxx               2m           10Mi
nginx-web-yyyyy               1m           9Mi
nginx-web-zzzzz               2m           11Mi
httpbin-v1-xxxxx              3m           15Mi
httpbin-v2-xxxxx              2m           14Mi
redis-xxxxx                   5m           8Mi
postgres-xxxxx                3m           20Mi
rabbitmq-xxxxx                10m          80Mi
keycloak-xxxxx                50m          200Mi
```

**Step 4: 부하 테스트로 스케일아웃 트리거**

```bash
# nginx-web에 부하 생성 (별도 터미널에서)
kubectl --context=dev run load-generator --rm -it --image=busybox:1.36 -n demo \
  -- sh -c "while true; do wget -q -O- http://nginx-web > /dev/null 2>&1; done"
```

```bash
# 다른 터미널에서 HPA 상태 실시간 관찰
kubectl --context=dev get hpa nginx-web -n demo -w
```

**기대 출력:** CPU 사용률이 50%를 초과하면 HPA가 레플리카 수를 3에서 최대 10까지 증가시킨다.

```
NAME        REFERENCE              TARGETS   MINPODS   MAXPODS   REPLICAS
nginx-web   Deployment/nginx-web   10%/50%   3         10        3
nginx-web   Deployment/nginx-web   55%/50%   3         10        3
nginx-web   Deployment/nginx-web   72%/50%   3         10        5
nginx-web   Deployment/nginx-web   60%/50%   3         10        7
```

**Step 5: 부하 중단 후 스케일인 관찰**

```bash
# load-generator Pod를 Ctrl+C로 중단하거나 삭제
kubectl --context=dev delete pod load-generator -n demo --ignore-not-found

# 스케일인 관찰 (5분 정도 소요)
kubectl --context=dev get hpa nginx-web -n demo -w
```

**기대 출력:** CPU 사용률이 낮아지면 HPA가 레플리카 수를 다시 3으로 줄인다 (기본 안정화 시간 5분).

**Step 6: HPA 이벤트 확인**

```bash
# HPA 이벤트 확인
kubectl --context=dev describe hpa nginx-web -n demo | grep -A 20 "Events:"
```

**기대 출력:** 스케일아웃/스케일인 이벤트가 기록되어 있다.

**확인 문제:**
1. HPA가 동작하기 위한 두 가지 전제 조건은 무엇인가?
2. HPA의 스케일아웃과 스케일인의 기본 안정화 시간(cooldown)은 각각 얼마인가?
3. VPA(Vertical Pod Autoscaler)와 HPA의 차이점은 무엇인가?
4. CPU 기반 HPA 외에 커스텀 메트릭을 사용할 수 있는가?

**관련 KCNA 시험 주제:** Cloud Native Architecture — Autoscaling, HPA, Resource Management

---

### Lab 6.5: PDB 확인 및 노드 drain 테스트

**학습 목표:**
- PDB(PodDisruptionBudget)가 자발적 중단(voluntary disruption) 시 최소 가용 Pod 수를 보장하는 원리를 이해한다.
- tart-infra의 PDB 설정을 확인한다.
- 노드 drain 시 PDB가 어떻게 동작하는지 관찰한다.

**Step 1: PDB 목록 확인**

```bash
# demo 네임스페이스의 PDB 확인
kubectl --context=dev get pdb -n demo
```

**기대 출력:**

```
NAME         MIN AVAILABLE   MAX UNAVAILABLE   ALLOWED DISRUPTIONS   AGE
nginx-web    2               N/A               1                     ...
httpbin      1               N/A               1                     ...
redis        1               N/A               0                     ...
postgres     1               N/A               0                     ...
rabbitmq     1               N/A               0                     ...
keycloak     1               N/A               0                     ...
```

**Step 2: PDB 상세 확인**

```bash
# nginx-web PDB 상세
kubectl --context=dev describe pdb nginx-web -n demo
```

**기대 출력 중 핵심:**
- `Min Available: 2`
- `Current Healthy: 3`
- `Desired Healthy: 2`
- `Allowed Disruptions: 1` (3개 중 2개를 유지하므로 1개만 중단 가능)

**Step 3: PDB의 ALLOWED DISRUPTIONS 이해**

```bash
echo "============================================="
echo "PDB Allowed Disruptions 계산"
echo "============================================="
echo ""
echo "nginx-web: 현재 3개 Pod, minAvailable=2"
echo "  → Allowed Disruptions = 3 - 2 = 1"
echo "  → 동시에 1개의 Pod만 중단 가능"
echo ""
echo "redis: 현재 1개 Pod, minAvailable=1"
echo "  → Allowed Disruptions = 1 - 1 = 0"
echo "  → 이 Pod는 자발적으로 중단 불가 (drain 시 차단)"
echo ""
echo "postgres: 현재 1개 Pod, minAvailable=1"
echo "  → Allowed Disruptions = 1 - 1 = 0"
echo "  → 이 Pod는 자발적으로 중단 불가"
```

**Step 4: PDB가 drain을 차단하는 시나리오 이해**

```bash
# 주의: 실제로 drain을 실행하면 서비스에 영향이 있을 수 있다!
# 이 명령은 --dry-run으로만 실행한다.

echo "============================================="
echo "노드 drain 시 PDB 동작 시나리오"
echo "============================================="
echo ""
echo "시나리오: 단일 노드 클러스터에서 drain 시도"
echo ""
echo "1. kubectl drain <node> --ignore-daemonsets"
echo "2. 스케줄러가 nginx-web Pod 1개를 evict 시도"
echo "3. PDB 확인: minAvailable=2, 현재 3개 → 1개 evict 허용"
echo "4. redis Pod evict 시도"
echo "5. PDB 확인: minAvailable=1, 현재 1개 → 0개 evict 허용"
echo "6. drain 대기 (PDB가 보호)"
echo ""
echo "결론: PDB는 자발적 중단(drain, rolling update)에만 적용된다."
echo "비자발적 중단(노드 장애, OOM)에는 적용되지 않는다."
```

**Step 5: PDB YAML 구조 확인**

```bash
# nginx-web PDB YAML 확인
kubectl --context=dev get pdb nginx-web -n demo -o yaml
```

**기대 출력:**

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: nginx-web
  namespace: demo
spec:
  minAvailable: 2
  selector:
    matchLabels:
      app: nginx-web
```

**확인 문제:**
1. PDB가 보호하는 "자발적 중단(voluntary disruption)"의 예시 3가지를 나열하라.
2. PDB가 보호하지 못하는 "비자발적 중단(involuntary disruption)"의 예시 2가지를 나열하라.
3. `minAvailable`과 `maxUnavailable` 중 하나만 설정해야 하는 이유는 무엇인가?
4. PDB의 `ALLOWED DISRUPTIONS`이 0이면 어떤 영향이 있는가?

**관련 KCNA 시험 주제:** Cloud Native Architecture — PodDisruptionBudget, High Availability

---

## 실습 7: 관측성 (8%)

> Grafana, Prometheus, Loki, AlertManager, Hubble을 활용하여 클러스터를 관측한다.

---

### Lab 7.1: Grafana 대시보드 탐색 (3개 대시보드)

**학습 목표:**
- Grafana(30300)에 접속하여 사전 구성된 대시보드를 탐색한다.
- 대시보드에서 클러스터, 노드, Pod의 상태를 파악하는 방법을 학습한다.
- 데이터소스(Prometheus, Loki)의 역할을 이해한다.

**Step 1: Grafana 접속 확인**

```bash
# Grafana Pod 상태
kubectl --context=dev get pods -n monitoring -l app.kubernetes.io/name=grafana

# Grafana Service 확인
kubectl --context=dev get svc -n monitoring -l app.kubernetes.io/name=grafana
```

**기대 출력:** Grafana Pod가 Running 상태이고, NodePort 30300으로 서비스가 노출되어 있다.

```bash
echo "============================================="
echo "Grafana 접속 정보"
echo "============================================="
echo "URL: http://<node-ip>:30300"
echo "ID: admin"
echo "PW: admin"
```

**Step 2: 대시보드 1 — Kubernetes Cluster Overview**

```
웹 브라우저에서 Grafana에 접속하여 다음 대시보드를 탐색한다:

대시보드: "Kubernetes / Cluster Overview"

확인할 항목:
1. 클러스터 전체 CPU 사용률 그래프
2. 클러스터 전체 메모리 사용률 그래프
3. 네임스페이스별 Pod 수
4. 노드 상태 (Ready/NotReady)
5. 전체 Pod 수와 상태 분포
```

**Step 3: 대시보드 2 — Node Exporter**

```
대시보드: "Node Exporter / Nodes"

확인할 항목:
1. 각 노드의 CPU 사용률 (코어별)
2. 메모리 사용량 (Used, Buffers, Cached, Free)
3. 디스크 I/O 속도
4. 네트워크 트래픽 (수신/발신)
5. 파일시스템 사용률
```

**Step 4: 대시보드 3 — Pod Resources**

```
대시보드: "Kubernetes / Pod Resources"

확인할 항목:
1. Pod별 CPU 사용률 vs requests vs limits
2. Pod별 메모리 사용량 vs requests vs limits
3. 네임스페이스별 리소스 사용 비율
4. 컨테이너 재시작 횟수
```

**Step 5: Grafana 데이터소스 확인**

```bash
# Grafana에 설정된 데이터소스를 ConfigMap에서 확인
kubectl --context=dev get configmap -n monitoring -l grafana_datasource=1 -o yaml
```

**기대 출력:** Prometheus와 Loki가 데이터소스로 설정되어 있다.

**확인 문제:**
1. Grafana의 3대 핵심 개념(Dashboard, Panel, Data Source)을 설명하라.
2. Grafana는 직접 데이터를 수집하는가? Grafana와 Prometheus의 관계를 설명하라.
3. Grafana 대시보드에서 특정 시간 범위를 선택하면 어떻게 동작하는가?
4. Grafana 알림(Alert)과 AlertManager 알림의 차이점은 무엇인가?

**관련 KCNA 시험 주제:** Cloud Native Observability — Dashboards, Visualization

---

### Lab 7.2: PromQL 쿼리 실습 (CPU, 메모리, Pod 상태)

**학습 목표:**
- PromQL(Prometheus Query Language)의 기본 구문을 학습한다.
- CPU, 메모리, Pod 상태에 대한 실용적인 쿼리를 작성한다.
- 함수(rate, avg, sum, count)의 동작을 이해한다.

**Step 1: Prometheus 접근 확인**

```bash
# Prometheus Pod 확인
kubectl --context=dev get pods -n monitoring -l app.kubernetes.io/name=prometheus

# Prometheus Service 확인
kubectl --context=dev get svc -n monitoring -l app.kubernetes.io/name=prometheus
```

**Step 2: 기본 PromQL 쿼리 — up 메트릭**

```bash
# Prometheus API를 통한 쿼리
kubectl --context=dev run prom-query --rm -it --image=curlimages/curl -n monitoring \
  -- curl -s 'http://prometheus-server:9090/api/v1/query?query=up' | python3 -m json.tool | head -20
```

**기대 출력:** `up` 메트릭은 각 스크래핑 타겟의 상태를 나타낸다. 값이 `1`이면 정상, `0`이면 비정상이다.

**Step 3: 노드 CPU 사용률 쿼리**

```
Prometheus UI 또는 Grafana의 Explore에서 실행:

# 노드 CPU 사용률 (%)
100 - (avg by(instance)(rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)

설명:
- node_cpu_seconds_total{mode="idle"}: CPU가 idle 상태인 시간
- rate(...[5m]): 5분간의 초당 변화율
- avg by(instance): 인스턴스별 평균
- 100 - ...: idle의 반대 = 사용률
```

**Step 4: 노드 메모리 사용률 쿼리**

```
# 노드 메모리 사용률 (%)
(1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes) * 100

설명:
- node_memory_MemTotal_bytes: 전체 메모리
- node_memory_MemAvailable_bytes: 사용 가능한 메모리
- 1 - (사용가능/전체) = 사용률
```

**Step 5: Pod 관련 메트릭 쿼리**

```
# 네임스페이스별 실행 중인 Pod 수
count by(namespace)(kube_pod_info)

# Pod 재시작 횟수
kube_pod_container_status_restarts_total

# demo 네임스페이스의 Pod 재시작 횟수
kube_pod_container_status_restarts_total{namespace="demo"}

# Pod CPU 사용량 (각 Pod별)
rate(container_cpu_usage_seconds_total{namespace="demo",container!="POD",container!=""}[5m])

# Pod 메모리 사용량
container_memory_working_set_bytes{namespace="demo",container!="POD",container!=""}
```

**Step 6: 고급 PromQL 쿼리**

```
# 5분간 평균 CPU 사용률이 가장 높은 Pod Top 5
topk(5, avg by(pod)(rate(container_cpu_usage_seconds_total{namespace="demo",container!="POD"}[5m])))

# OOMKilled된 컨테이너
kube_pod_container_status_terminated_reason{reason="OOMKilled"}

# 15분간 재시작 횟수가 5회 이상인 Pod
rate(kube_pod_container_status_restarts_total[15m]) * 60 * 15 > 5

# HPA의 현재/원하는 레플리카 수
kube_horizontalpodautoscaler_status_current_replicas{namespace="demo"}
kube_horizontalpodautoscaler_spec_max_replicas{namespace="demo"}
```

**Step 7: PromQL 함수 정리**

```bash
echo "============================================="
echo "PromQL 핵심 함수 정리"
echo "============================================="
echo ""
echo "rate(): 카운터의 초당 변화율 (증가하는 메트릭에 사용)"
echo "  예: rate(http_requests_total[5m])"
echo ""
echo "sum(): 합계"
echo "  예: sum(rate(http_requests_total[5m]))"
echo ""
echo "avg(): 평균"
echo "  예: avg by(instance)(node_cpu_seconds_total)"
echo ""
echo "count(): 시계열 수"
echo "  예: count by(namespace)(kube_pod_info)"
echo ""
echo "topk(): 상위 N개"
echo "  예: topk(5, rate(http_requests_total[5m]))"
echo ""
echo "histogram_quantile(): 백분위수"
echo "  예: histogram_quantile(0.99, rate(http_request_duration_seconds_bucket[5m]))"
```

**확인 문제:**
1. Counter와 Gauge 메트릭 타입의 차이를 설명하라.
2. `rate()` 함수를 Counter 메트릭에만 사용해야 하는 이유는 무엇인가?
3. `[5m]` 같은 범위 벡터(Range Vector)는 무엇을 의미하는가?
4. `by(label)` 절의 역할은 무엇인가?

**관련 KCNA 시험 주제:** Cloud Native Observability — Prometheus, PromQL, Metrics

---

### Lab 7.3: Loki LogQL 쿼리 (namespace, container 필터)

**학습 목표:**
- Loki의 LogQL 쿼리 언어를 학습한다.
- Grafana에서 Loki 데이터소스를 사용하여 로그를 조회한다.
- 레이블 필터, 파이프라인, 집계 함수를 사용한다.

**Step 1: Loki 상태 확인**

```bash
# Loki Pod 상태
kubectl --context=dev get pods -n monitoring -l app.kubernetes.io/name=loki

# Loki Service
kubectl --context=dev get svc -n monitoring -l app.kubernetes.io/name=loki
```

**기대 출력:** Loki Pod가 Running 상태이다.

**Step 2: 기본 LogQL 쿼리 (Grafana Explore에서 실행)**

```
Grafana → Explore → Data source: Loki

# demo 네임스페이스의 모든 로그
{namespace="demo"}

# nginx-web 컨테이너의 로그만
{namespace="demo", container="nginx-web"}

# 특정 Pod의 로그
{namespace="demo", pod=~"nginx-web.*"}
```

**Step 3: 파이프라인 필터**

```
# "error"를 포함하는 로그
{namespace="demo"} |= "error"

# "error"를 포함하지 않는 로그
{namespace="demo"} != "error"

# 정규식 매치
{namespace="demo"} |~ "4[0-9]{2}"

# JSON 파싱
{namespace="demo", container="httpbin"} | json

# 특정 필드 필터
{namespace="demo", container="httpbin"} | json | status >= 400
```

**Step 4: 로그 집계 쿼리**

```
# 네임스페이스별 로그 볼륨 (초당)
sum by(namespace)(rate({job="kubernetes-pods"}[5m]))

# 컨테이너별 에러 로그 수 (1시간)
sum by(container)(count_over_time({namespace="demo"} |= "error"[1h]))

# Pod별 로그 라인 수 (5분)
sum by(pod)(count_over_time({namespace="demo"}[5m]))
```

**Step 5: kubectl로 직접 로그 조회 비교**

```bash
# kubectl 로그 조회 (Loki 없이)
kubectl --context=dev logs -n demo deployment/nginx-web --tail=10

# 모든 nginx-web Pod의 로그
kubectl --context=dev logs -n demo -l app=nginx-web --tail=5

# postgres 로그
kubectl --context=dev logs -n demo deployment/postgres --tail=10

# rabbitmq 로그
kubectl --context=dev logs -n demo deployment/rabbitmq --tail=10
```

**Step 6: LogQL과 kubectl logs 비교**

```bash
echo "============================================="
echo "Loki LogQL vs kubectl logs 비교"
echo "============================================="
echo ""
echo "kubectl logs:"
echo "  + 즉시 사용 가능, 별도 설치 불필요"
echo "  - 현재 실행 중인 Pod만 조회 가능"
echo "  - 텍스트 검색/집계 불가"
echo "  - Pod가 삭제되면 로그 소실"
echo ""
echo "Loki LogQL:"
echo "  + 장기 저장 및 검색"
echo "  + 레이블 기반 필터링"
echo "  + 집계 함수 (count, rate)"
echo "  + 삭제된 Pod의 로그도 조회 가능"
echo "  - 별도 설치 및 스토리지 필요"
```

**확인 문제:**
1. LogQL의 레이블 셀렉터 `{namespace="demo", container="nginx-web"}`에서 쉼표의 의미는?
2. `|=`와 `|~` 연산자의 차이를 설명하라.
3. Loki가 Elasticsearch보다 리소스 효율적인 이유는 무엇인가?
4. 로그 관측성에서 "구조화된 로그(Structured Logging)"가 중요한 이유는?

**관련 KCNA 시험 주제:** Cloud Native Observability — Logging, Log Aggregation

---

### Lab 7.4: AlertManager 알림 규칙 확인 (8개 규칙)

**학습 목표:**
- tart-infra에 설정된 8개의 알림 규칙을 확인한다.
- 각 규칙의 조건(expr), 지속 시간(for), 심각도(severity)를 분석한다.
- AlertManager의 알림 라우팅 구조를 이해한다.

**Step 1: AlertManager 접속 확인**

```bash
# AlertManager Pod 확인
kubectl --context=dev get pods -n monitoring -l app.kubernetes.io/name=alertmanager

# AlertManager Service
kubectl --context=dev get svc -n monitoring -l app.kubernetes.io/name=alertmanager
```

```bash
echo "============================================="
echo "AlertManager 접속 정보"
echo "============================================="
echo "URL: http://<node-ip>:30903"
```

**Step 2: 알림 규칙 확인**

```bash
# Prometheus AlertRule 확인
kubectl --context=dev get configmap -n monitoring -l app.kubernetes.io/name=prometheus -o yaml | grep -A 10 "alert:"
```

**Step 3: 8개 알림 규칙 상세**

```bash
echo "============================================="
echo "tart-infra 알림 규칙 (8개)"
echo "============================================="
echo ""
echo "1. HighCpuUsage"
echo "   조건: CPU 사용률 > 80%"
echo "   지속: 5분"
echo "   심각도: warning"
echo "   expr: 100 - (avg by(instance)(rate(node_cpu_seconds_total{mode=\"idle\"}[5m])) * 100) > 80"
echo ""
echo "2. HighMemoryUsage"
echo "   조건: 메모리 사용률 > 85%"
echo "   지속: 5분"
echo "   심각도: warning"
echo "   expr: (1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes) * 100 > 85"
echo ""
echo "3. NodeNotReady"
echo "   조건: 노드 상태가 Ready가 아님"
echo "   지속: 5분"
echo "   심각도: critical"
echo "   expr: kube_node_status_condition{condition=\"Ready\",status=\"true\"} == 0"
echo ""
echo "4. NodeDiskPressure"
echo "   조건: 노드 디스크 압력 상태"
echo "   지속: 5분"
echo "   심각도: warning"
echo "   expr: kube_node_status_condition{condition=\"DiskPressure\",status=\"true\"} == 1"
echo ""
echo "5. PodCrashLooping"
echo "   조건: 15분 내 재시작 > 5회"
echo "   지속: 즉시 (15m 평가)"
echo "   심각도: warning"
echo "   expr: rate(kube_pod_container_status_restarts_total[15m]) * 60 * 15 > 5"
echo ""
echo "6. PodOOMKilled"
echo "   조건: OOMKilled 발생"
echo "   지속: 즉시"
echo "   심각도: warning"
echo "   expr: kube_pod_container_status_terminated_reason{reason=\"OOMKilled\"} > 0"
echo ""
echo "7. HighPodRestartRate"
echo "   조건: 1시간 내 재시작 > 10회"
echo "   지속: 즉시 (1h 평가)"
echo "   심각도: warning"
echo "   expr: increase(kube_pod_container_status_restarts_total[1h]) > 10"
echo ""
echo "8. PodNotReady"
echo "   조건: Pod가 Ready 상태가 아님"
echo "   지속: 10분"
echo "   심각도: warning"
echo "   expr: kube_pod_status_ready{condition=\"true\"} == 0"
```

**Step 4: 현재 활성 알림 확인**

```bash
# AlertManager API로 활성 알림 조회
kubectl --context=dev run alert-check --rm -it --image=curlimages/curl -n monitoring \
  -- curl -s http://alertmanager:9093/api/v2/alerts | python3 -m json.tool | head -30
```

**기대 출력:** 현재 발생 중인 알림 목록이 JSON으로 표시된다. 정상 상태라면 알림이 없거나 소수의 informational 알림만 있다.

**Step 5: Prometheus에서 알림 규칙 상태 확인**

```bash
# Prometheus API로 알림 규칙 상태 조회
kubectl --context=dev run alert-check --rm -it --image=curlimages/curl -n monitoring \
  -- curl -s 'http://prometheus-server:9090/api/v1/rules?type=alert' | python3 -m json.tool | head -50
```

**기대 출력:** 모든 알림 규칙의 상태(inactive, pending, firing)가 표시된다.

**Step 6: AlertManager 설정 구조 이해**

```bash
echo "============================================="
echo "AlertManager 핵심 개념"
echo "============================================="
echo ""
echo "1. Grouping (그룹핑)"
echo "   같은 유형의 알림을 하나로 묶어 알림 피로도 감소"
echo "   예: 동일 노드의 여러 Pod 장애를 하나의 알림으로"
echo ""
echo "2. Inhibition (억제)"
echo "   특정 알림이 발생하면 관련된 하위 알림을 억제"
echo "   예: NodeNotReady 시 해당 노드의 PodNotReady 억제"
echo ""
echo "3. Silencing (무음)"
echo "   특정 시간 동안 알림을 일시적으로 무시"
echo "   예: 유지보수 시간 동안 알림 차단"
echo ""
echo "4. Routing (라우팅)"
echo "   알림을 적절한 수신자에게 전달"
echo "   예: critical → PagerDuty, warning → Slack"
```

**확인 문제:**
1. AlertManager에서 Grouping, Inhibition, Silencing의 역할을 각각 설명하라.
2. 알림 규칙에서 `for: 5m`의 의미는 무엇인가?
3. `severity: critical`과 `severity: warning`의 차이는 어떻게 활용되는가?
4. PodCrashLooping 알림이 발생했을 때 취해야 할 조치 3가지를 나열하라.

**관련 KCNA 시험 주제:** Cloud Native Observability — Alerting, AlertManager, Alert Rules

---

### Lab 7.5: Hubble 네트워크 플로 관찰

**학습 목표:**
- Hubble UI(31235)를 통해 네트워크 트래픽 플로를 시각화한다.
- Hubble CLI로 실시간 네트워크 이벤트를 관찰한다.
- CiliumNetworkPolicy에 의한 트래픽 허용/차단을 확인한다.

**Step 1: Hubble Pod 확인**

```bash
# Hubble UI Pod 확인
kubectl --context=dev get pods -n kube-system -l k8s-app=hubble-ui

# Hubble Relay Pod 확인
kubectl --context=dev get pods -n kube-system -l k8s-app=hubble-relay
```

```bash
echo "============================================="
echo "Hubble UI 접속 정보"
echo "============================================="
echo "URL: http://<node-ip>:31235"
```

**Step 2: Hubble CLI로 네트워크 플로 관찰**

```bash
# Cilium Pod에서 Hubble observe 실행
CILIUM_POD=$(kubectl --context=dev get pods -n kube-system -l k8s-app=cilium -o jsonpath='{.items[0].metadata.name}')

# 최근 네트워크 이벤트 10개 확인
kubectl --context=dev exec -n kube-system $CILIUM_POD -- hubble observe --last 10
```

**기대 출력:** 최근 10개의 네트워크 이벤트가 표시된다. 출발지, 목적지, 프로토콜, 포트, 결정(FORWARDED/DROPPED) 등의 정보가 포함된다.

**Step 3: 특정 네임스페이스의 트래픽 관찰**

```bash
# demo 네임스페이스의 트래픽만 관찰
kubectl --context=dev exec -n kube-system $CILIUM_POD -- \
  hubble observe --namespace demo --last 20
```

**기대 출력:** demo 네임스페이스의 Pod 간 통신 이벤트가 표시된다.

**Step 4: CiliumNetworkPolicy 확인**

```bash
# CiliumNetworkPolicy 목록
kubectl --context=dev get ciliumnetworkpolicies -n demo
```

**기대 출력:**

```
NAME                          AGE
default-deny-all              ...
allow-external-to-nginx       ...
allow-nginx-to-httpbin        ...
allow-nginx-to-redis          ...
allow-httpbin-to-postgres     ...
allow-httpbin-to-rabbitmq     ...
allow-httpbin-to-keycloak     ...
allow-keycloak-to-postgres    ...
allow-external-to-keycloak    ...
```

**Step 5: 각 NetworkPolicy 상세 확인**

```bash
# default-deny-all 정책
kubectl --context=dev get ciliumnetworkpolicy default-deny-all -n demo -o yaml
```

**기대 출력:**

```yaml
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: default-deny-all
  namespace: demo
spec:
  endpointSelector: {}
  ingress:
    - {}
  egress:
    - {}
```

이 정책은 demo 네임스페이스의 모든 트래픽을 기본적으로 차단한다.

```bash
# allow-external-to-nginx 정책 (외부 → nginx:80)
kubectl --context=dev get ciliumnetworkpolicy allow-external-to-nginx -n demo -o yaml
```

**기대 출력:** 외부(world)에서 nginx-web의 포트 80으로의 인그레스 트래픽을 허용하는 정책이다.

```bash
# allow-nginx-to-httpbin 정책 (L7 GET만 허용)
kubectl --context=dev get ciliumnetworkpolicy allow-nginx-to-httpbin -n demo -o yaml
```

**기대 출력:** nginx에서 httpbin으로의 HTTP GET 요청만 허용하는 L7 정책이다. POST, PUT 등은 차단된다.

**Step 6: NetworkPolicy 동작 테스트**

```bash
# nginx에서 httpbin으로 GET 요청 (허용)
NGINX_POD=$(kubectl --context=dev get pods -n demo -l app=nginx-web -o jsonpath='{.items[0].metadata.name}')
kubectl --context=dev exec -n demo $NGINX_POD -- \
  wget -qO- --timeout=5 http://httpbin/get 2>/dev/null | head -5
echo "→ GET 요청: 허용됨"

# nginx에서 redis로 접근 (6379 허용)
kubectl --context=dev exec -n demo $NGINX_POD -- \
  sh -c 'nc -zv -w 3 redis 6379 2>&1'
echo "→ Redis 6379: 허용됨"
```

**Step 7: 네트워크 정책 토폴로지 정리**

```bash
echo "============================================="
echo "CiliumNetworkPolicy 트래픽 플로"
echo "============================================="
echo ""
echo "기본 정책: default-deny-all (모두 차단)"
echo ""
echo "허용된 트래픽:"
echo "  [world] ──► [nginx-web:80]       allow-external-to-nginx"
echo "  [world] ──► [keycloak:8080]      allow-external-to-keycloak"
echo "  [nginx] ──► [httpbin:80] (GET)   allow-nginx-to-httpbin (L7)"
echo "  [nginx] ──► [redis:6379]         allow-nginx-to-redis"
echo "  [httpbin] ──► [postgres:5432]    allow-httpbin-to-postgres"
echo "  [httpbin] ──► [rabbitmq:5672]    allow-httpbin-to-rabbitmq"
echo "  [httpbin] ──► [keycloak:8080]    allow-httpbin-to-keycloak"
echo "  [keycloak] ──► [postgres:5432]   allow-keycloak-to-postgres"
```

**확인 문제:**
1. NetworkPolicy에서 "default deny"를 먼저 설정하는 이유는 무엇인가?
2. L3/L4 NetworkPolicy와 L7 NetworkPolicy의 차이를 설명하라.
3. Hubble이 제공하는 관측 가능성의 3가지 핵심 기능은 무엇인가?
4. CiliumNetworkPolicy와 Kubernetes NetworkPolicy의 차이점은 무엇인가?

**관련 KCNA 시험 주제:** Cloud Native Observability — Network Observability, Network Policy

---

## 실습 8: 애플리케이션 배포 (8%)

> ArgoCD, Helm, Jenkins를 활용한 GitOps 기반 배포와 CI/CD 파이프라인을 실습한다.

---

### Lab 8.1: ArgoCD 웹 UI 탐색 (Sync Status, Health Status)

**학습 목표:**
- ArgoCD 웹 UI에 접속하여 애플리케이션의 동기화 상태를 확인한다.
- Sync Status와 Health Status의 차이를 이해한다.
- ArgoCD의 자동 동기화(auto-sync) 동작을 파악한다.

**Step 1: ArgoCD 접속 정보 확인**

```bash
# ArgoCD Pod 상태
kubectl --context=dev get pods -n argocd

# ArgoCD Service 확인
kubectl --context=dev get svc -n argocd
```

```bash
echo "============================================="
echo "ArgoCD 접속 정보"
echo "============================================="
echo "URL: http://<node-ip>:30800"
echo ""
echo "초기 비밀번호 확인:"
kubectl --context=dev get secret argocd-initial-admin-secret -n argocd \
  -o jsonpath='{.data.password}' | base64 -d && echo ""
```

**Step 2: ArgoCD Application 목록 확인**

```bash
# ArgoCD Application 리소스 확인
kubectl --context=dev get applications -n argocd
```

**기대 출력:**

```
NAME        SYNC STATUS   HEALTH STATUS   PROJECT
demo-app    Synced        Healthy         default
```

**Step 3: Application 상세 정보**

```bash
# Application 상세
kubectl --context=dev describe application demo-app -n argocd
```

**기대 출력 중 핵심:**
- `Source`: `github.com/iamywl/IaC_apple_sillicon.git`
- `Path`: `manifests/demo`
- `Sync Policy`: Auto-Sync, Prune, Self-Heal
- `Sync Status`: Synced
- `Health Status`: Healthy

**Step 4: ArgoCD Application YAML 확인**

```bash
# Application YAML 확인
kubectl --context=dev get application demo-app -n argocd -o yaml
```

**기대 출력 중 핵심:**

```yaml
spec:
  source:
    repoURL: https://github.com/iamywl/IaC_apple_sillicon.git
    path: manifests/demo
    targetRevision: HEAD
  destination:
    server: https://kubernetes.default.svc
    namespace: demo
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
```

**Step 5: Sync Status와 Health Status 이해**

```bash
echo "============================================="
echo "ArgoCD 상태 이해"
echo "============================================="
echo ""
echo "Sync Status (동기화 상태):"
echo "  Synced: Git과 클러스터의 상태가 일치"
echo "  OutOfSync: Git과 클러스터의 상태가 불일치"
echo "  Unknown: 상태를 확인할 수 없음"
echo ""
echo "Health Status (건강 상태):"
echo "  Healthy: 모든 리소스가 정상 동작"
echo "  Degraded: 일부 리소스에 문제 발생"
echo "  Progressing: 배포 진행 중"
echo "  Missing: 리소스가 존재하지 않음"
echo "  Suspended: 일시 중지됨"
echo ""
echo "Auto-Sync 정책:"
echo "  prune: true — Git에서 삭제된 리소스를 클러스터에서도 삭제"
echo "  selfHeal: true — 수동 변경을 자동으로 원래 상태로 복구"
```

**Step 6: Self-Heal 동작 테스트**

```bash
# 수동으로 nginx-web 레플리카를 변경 (ArgoCD가 복구하는지 확인)
kubectl --context=dev scale deployment nginx-web -n demo --replicas=5

# 30초 대기 후 확인 (selfHeal이 활성화되어 있으므로 원래 값으로 복구)
sleep 30
kubectl --context=dev get deployment nginx-web -n demo
```

**기대 출력:** ArgoCD의 selfHeal 정책에 의해 레플리카가 Git에 정의된 3으로 복구된다.

**확인 문제:**
1. GitOps의 핵심 원칙은 무엇인가?
2. ArgoCD의 auto-sync에서 `prune`과 `selfHeal`의 차이를 설명하라.
3. ArgoCD가 Git 저장소를 폴링하는 기본 주기는 얼마인가?
4. ArgoCD Application의 `destination.server`가 `https://kubernetes.default.svc`인 이유는?

**관련 KCNA 시험 주제:** Cloud Native Application Delivery — GitOps, ArgoCD, Declarative Management

---

### Lab 8.2: GitOps 흐름 체험 (manifests/demo 수정 → push → auto-sync)

**학습 목표:**
- Git 저장소 변경이 ArgoCD를 통해 클러스터에 자동 반영되는 흐름을 체험한다.
- GitOps의 "Git = Single Source of Truth" 원칙을 이해한다.
- 변경 이력 추적과 롤백의 장점을 파악한다.

**Step 1: Git 저장소 구조 확인**

```bash
echo "============================================="
echo "GitOps 흐름"
echo "============================================="
echo ""
echo "Git 저장소: github.com/iamywl/IaC_apple_sillicon.git"
echo "매니페스트 경로: manifests/demo/"
echo ""
echo "흐름:"
echo "  1. 개발자가 manifests/demo/ 디렉토리의 YAML 파일 수정"
echo "  2. Git commit & push"
echo "  3. ArgoCD가 변경 감지 (자동 폴링 또는 Webhook)"
echo "  4. ArgoCD가 클러스터에 변경 사항 적용 (auto-sync)"
echo "  5. 클러스터 상태가 Git과 일치하게 됨"
echo ""
echo "롤백:"
echo "  1. Git에서 이전 커밋으로 revert"
echo "  2. ArgoCD가 변경 감지"
echo "  3. 이전 상태로 자동 복구"
```

**Step 2: ArgoCD에서 동기화 이력 확인**

```bash
# Application 이벤트 확인 (동기화 이력)
kubectl --context=dev get events -n argocd --sort-by=.metadata.creationTimestamp | tail -20
```

**Step 3: ArgoCD Application의 동기화 상태 상세 확인**

```bash
# 각 리소스의 동기화 상태 확인
kubectl --context=dev get application demo-app -n argocd \
  -o jsonpath='{range .status.resources[*]}{.kind}/{.name}: {.status}{"\n"}{end}'
```

**기대 출력:** 각 리소스(Deployment, Service, HPA, PDB, NetworkPolicy 등)의 동기화 상태가 표시된다.

**Step 4: GitOps 장점 정리**

```bash
echo "============================================="
echo "GitOps의 장점"
echo "============================================="
echo ""
echo "1. 감사 추적 (Audit Trail)"
echo "   모든 인프라 변경이 Git 커밋 이력으로 남는다"
echo ""
echo "2. 선언적 관리 (Declarative)"
echo "   원하는 상태를 YAML로 선언하면 자동으로 적용된다"
echo ""
echo "3. 롤백 용이성"
echo "   Git revert만으로 이전 상태로 복구할 수 있다"
echo ""
echo "4. 코드 리뷰"
echo "   인프라 변경도 Pull Request를 통해 리뷰할 수 있다"
echo ""
echo "5. 자동 복구 (Self-Heal)"
echo "   누군가 수동으로 클러스터를 변경해도 Git 상태로 자동 복구된다"
```

**확인 문제:**
1. "Single Source of Truth"가 GitOps에서 왜 중요한가?
2. Push-based CD(Jenkins)와 Pull-based CD(ArgoCD)의 차이점을 설명하라.
3. GitOps에서 Secret은 어떻게 관리하는가? (Sealed Secrets, SOPS 등)
4. ArgoCD Application에서 `prune: true`를 설정하지 않으면 어떤 문제가 발생할 수 있는가?

**관련 KCNA 시험 주제:** Cloud Native Application Delivery — GitOps Workflow, Continuous Delivery

---

### Lab 8.3: Helm Release 목록 및 values 확인

**학습 목표:**
- tart-infra에 Helm으로 배포된 모든 Release를 확인한다.
- 각 Release의 커스텀 values를 분석한다.
- Helm Chart, Release, Repository의 관계를 이해한다.

**Step 1: Helm Release 목록 확인**

```bash
# 모든 네임스페이스의 Helm Release
helm --kube-context=dev list --all-namespaces
```

**기대 출력:**

```
NAME                NAMESPACE    REVISION  STATUS    CHART                          APP VERSION
cilium              kube-system  1         deployed  cilium-x.x.x                  x.x.x
hubble              kube-system  1         deployed  hubble-x.x.x                  x.x.x
prometheus-stack    monitoring   1         deployed  kube-prometheus-stack-x.x.x    x.x.x
loki                monitoring   1         deployed  loki-x.x.x                    x.x.x
argocd              argocd       1         deployed  argo-cd-x.x.x                 x.x.x
jenkins             jenkins      1         deployed  jenkins-x.x.x                 x.x.x
metrics-server      kube-system  1         deployed  metrics-server-x.x.x          x.x.x
```

**Step 2: 각 Release의 values 확인**

```bash
# Cilium values
echo "=== Cilium ==="
helm --kube-context=dev get values cilium -n kube-system 2>/dev/null | head -20
echo ""

# Prometheus Stack values
echo "=== Prometheus Stack ==="
helm --kube-context=dev get values prometheus-stack -n monitoring 2>/dev/null | head -20
echo ""

# ArgoCD values
echo "=== ArgoCD ==="
helm --kube-context=dev get values argocd -n argocd 2>/dev/null | head -20
```

**Step 3: Helm Release 히스토리 확인**

```bash
# Prometheus Stack의 히스토리
helm --kube-context=dev history prometheus-stack -n monitoring
```

**기대 출력:**

```
REVISION  UPDATED                   STATUS     CHART                       DESCRIPTION
1         2026-01-15 10:00:00 UTC   deployed   kube-prometheus-stack-x.x.x Install complete
```

**Step 4: Helm Chart 구조 이해**

```bash
echo "============================================="
echo "tart-infra Helm Chart 매핑"
echo "============================================="
echo ""
echo "1. cilium — CNI 네트워크 플러그인"
echo "   네임스페이스: kube-system"
echo "   역할: Pod 네트워킹, NetworkPolicy, eBPF"
echo ""
echo "2. hubble — 네트워크 관측 (Cilium 생태계)"
echo "   네임스페이스: kube-system"
echo "   역할: 네트워크 플로 시각화 (UI :31235)"
echo ""
echo "3. prometheus-stack — 모니터링 스택"
echo "   네임스페이스: monitoring"
echo "   포함: Prometheus, Grafana(:30300), AlertManager(:30903)"
echo "   Prometheus 보관: 7d, 스토리지: 10Gi"
echo ""
echo "4. loki — 로그 수집"
echo "   네임스페이스: monitoring"
echo "   역할: Pod 로그 집계"
echo ""
echo "5. argocd — GitOps CD"
echo "   네임스페이스: argocd"
echo "   포트: :30800"
echo ""
echo "6. jenkins — CI 서버"
echo "   네임스페이스: jenkins"
echo "   포트: :30900 (admin/admin)"
echo ""
echo "7. metrics-server — 리소스 메트릭"
echo "   네임스페이스: kube-system"
echo "   역할: kubectl top, HPA에 메트릭 제공"
```

**Step 5: Helm 핵심 개념 정리**

```bash
echo "============================================="
echo "Helm 핵심 개념"
echo "============================================="
echo ""
echo "Chart: Kubernetes 리소스의 패키지 (Deployment, Service 등의 템플릿 묶음)"
echo "Release: Chart의 설치된 인스턴스 (같은 Chart를 여러 번 설치 가능)"
echo "Repository: Chart가 저장된 원격 저장소"
echo "Values: Chart의 설정값 (커스터마이징)"
echo ""
echo "주요 명령어:"
echo "  helm install: 새 Release 설치"
echo "  helm upgrade: 기존 Release 업그레이드"
echo "  helm rollback: 이전 Revision으로 롤백"
echo "  helm list: Release 목록 확인"
echo "  helm get values: 커스텀 values 확인"
echo "  helm history: Revision 히스토리"
```

**확인 문제:**
1. Helm Chart의 세 가지 핵심 파일(Chart.yaml, values.yaml, templates/)의 역할을 설명하라.
2. `helm install`과 `helm upgrade`의 차이는 무엇인가?
3. `helm rollback`은 어떤 정보를 기반으로 롤백하는가?
4. Helm과 Kustomize의 차이점을 설명하라.

**관련 KCNA 시험 주제:** Cloud Native Application Delivery — Helm, Package Management

---

### Lab 8.4: Jenkins 파이프라인 7단계 분석

**학습 목표:**
- Jenkins CI/CD 파이프라인의 7단계를 이해한다.
- CI(Continuous Integration)와 CD(Continuous Delivery)의 경계를 파악한다.
- Jenkins와 ArgoCD의 역할 분담을 이해한다.

**Step 1: Jenkins 접속 정보**

```bash
# Jenkins Pod 확인
kubectl --context=dev get pods --all-namespaces -l app.kubernetes.io/name=jenkins

# Jenkins Service 확인
kubectl --context=dev get svc --all-namespaces -l app.kubernetes.io/name=jenkins
```

```bash
echo "============================================="
echo "Jenkins 접속 정보"
echo "============================================="
echo "URL: http://<node-ip>:30900"
echo "ID: admin"
echo "PW: admin"
```

**Step 2: Jenkins 파이프라인 7단계 분석**

```bash
echo "============================================="
echo "Jenkins CI/CD 파이프라인 7단계"
echo "============================================="
echo ""
echo "━━━━━━━━━━━━━━━━━━━ CI (Continuous Integration) ━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Stage 1: Checkout (코드 체크아웃)"
echo "  Git 저장소에서 소스 코드 클론"
echo "  git clone https://github.com/iamywl/IaC_apple_sillicon.git"
echo ""
echo "Stage 2: Build (빌드)"
echo "  소스 코드 컴파일/빌드"
echo "  예: go build, npm build, mvn package"
echo ""
echo "Stage 3: Unit Test (단위 테스트)"
echo "  단위 테스트 실행 및 커버리지 리포트"
echo "  예: go test, npm test, mvn test"
echo ""
echo "Stage 4: Code Quality (코드 품질 검사)"
echo "  정적 분석, 린팅, 보안 스캔"
echo "  예: SonarQube, golangci-lint, eslint"
echo ""
echo "Stage 5: Docker Build & Push (이미지 빌드 및 푸시)"
echo "  Docker 이미지 빌드 후 레지스트리에 푸시"
echo "  docker build -t <registry>/<image>:<tag> ."
echo "  docker push <registry>/<image>:<tag>"
echo ""
echo "━━━━━━━━━━━━━━━━━━━ CD (Continuous Delivery) ━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Stage 6: Update Manifests (매니페스트 업데이트)"
echo "  Kubernetes 매니페스트의 이미지 태그 업데이트"
echo "  manifests/demo/deployment.yaml의 image 필드 변경"
echo "  Git commit & push"
echo ""
echo "Stage 7: ArgoCD Sync (자동 배포)"
echo "  ArgoCD가 Git 변경 감지 → 클러스터에 자동 적용"
echo "  (Jenkins가 직접 배포하지 않음 — GitOps 방식)"
```

**Step 3: CI와 CD의 경계 이해**

```bash
echo "============================================="
echo "CI/CD 경계"
echo "============================================="
echo ""
echo "Jenkins (CI) 담당:"
echo "  - 코드 빌드, 테스트, 이미지 생성"
echo "  - 매니페스트 파일의 이미지 태그 업데이트"
echo "  - Git 저장소에 변경 사항 push"
echo ""
echo "ArgoCD (CD) 담당:"
echo "  - Git 저장소 변경 감지"
echo "  - Kubernetes 클러스터에 매니페스트 적용"
echo "  - 동기화 상태 관리 및 자동 복구"
echo ""
echo "핵심: Jenkins는 클러스터에 직접 접근하지 않는다!"
echo "      모든 배포는 Git을 거쳐 ArgoCD가 처리한다."
```

**Step 4: Jenkinsfile 구조 예시**

```bash
echo "============================================="
echo "Jenkinsfile 예시 구조"
echo "============================================="
cat << 'JENKINSFILE'

pipeline {
    agent any
    stages {
        stage('Checkout') {
            steps {
                git 'https://github.com/iamywl/IaC_apple_sillicon.git'
            }
        }
        stage('Build') {
            steps {
                sh 'docker build -t myapp:${BUILD_NUMBER} .'
            }
        }
        stage('Test') {
            steps {
                sh 'docker run myapp:${BUILD_NUMBER} npm test'
            }
        }
        stage('Push') {
            steps {
                sh 'docker push registry/myapp:${BUILD_NUMBER}'
            }
        }
        stage('Update Manifest') {
            steps {
                sh "sed -i 's|image:.*|image: registry/myapp:${BUILD_NUMBER}|' manifests/demo/deployment.yaml"
                sh 'git commit -am "Update image to ${BUILD_NUMBER}"'
                sh 'git push'
            }
        }
    }
}
JENKINSFILE
```

**확인 문제:**
1. CI(Continuous Integration)의 핵심 목표는 무엇인가?
2. CD(Continuous Delivery)와 CD(Continuous Deployment)의 차이는 무엇인가?
3. Jenkins + ArgoCD 조합에서 Jenkins가 클러스터에 직접 배포하지 않는 이유는?
4. 파이프라인에서 실패가 발생하면 어떻게 처리해야 하는가?

**관련 KCNA 시험 주제:** Cloud Native Application Delivery — CI/CD, Pipeline, Jenkins

---

## 종합 시나리오

> 지금까지 학습한 내용을 종합하여, 실제 운영 시나리오를 처음부터 끝까지 수행한다.

---

### 시나리오 1: 신규 앱 배포 (처음부터 끝까지)

**학습 목표:**
- Deployment, Service, HPA, NetworkPolicy를 처음부터 생성하여 완전한 앱을 배포한다.
- 각 리소스의 역할과 상호 관계를 종합적으로 이해한다.
- Cloud Native 배포의 전체 흐름을 체험한다.

**시나리오:** demo 네임스페이스에 `echo-server`라는 새로운 앱을 배포한다.

**Step 1: Deployment 생성**

```bash
kubectl --context=dev apply -n demo -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: echo-server
  namespace: demo
  labels:
    app: echo-server
spec:
  replicas: 2
  selector:
    matchLabels:
      app: echo-server
  template:
    metadata:
      labels:
        app: echo-server
    spec:
      containers:
        - name: echo
          image: hashicorp/http-echo:latest
          args:
            - "-text=Hello from echo-server"
          ports:
            - containerPort: 5678
          resources:
            requests:
              cpu: 50m
              memory: 64Mi
            limits:
              cpu: 200m
              memory: 128Mi
          readinessProbe:
            httpGet:
              path: /
              port: 5678
            initialDelaySeconds: 5
            periodSeconds: 10
          livenessProbe:
            httpGet:
              path: /
              port: 5678
            initialDelaySeconds: 10
            periodSeconds: 15
EOF

# Deployment 상태 확인
kubectl --context=dev rollout status deployment/echo-server -n demo
```

**기대 출력:** `deployment "echo-server" successfully rolled out`

**Step 2: Pod 확인**

```bash
# Pod 확인
kubectl --context=dev get pods -n demo -l app=echo-server -o wide
```

**기대 출력:** 2개의 Pod가 Running 상태이다.

**Step 3: Service 생성 (NodePort)**

```bash
kubectl --context=dev apply -n demo -f - <<EOF
apiVersion: v1
kind: Service
metadata:
  name: echo-server
  namespace: demo
spec:
  type: NodePort
  selector:
    app: echo-server
  ports:
    - port: 80
      targetPort: 5678
      nodePort: 30567
EOF

# Service 확인
kubectl --context=dev get svc echo-server -n demo
```

**기대 출력:** NodePort 30567로 서비스가 노출된다.

**Step 4: 접근 테스트**

```bash
# 클러스터 내부 테스트
kubectl --context=dev run echo-test --rm -it --image=curlimages/curl -n demo \
  -- curl -s http://echo-server

# 외부 접근 테스트
curl -s http://<node-ip>:30567
```

**기대 출력:** `Hello from echo-server`

**Step 5: HPA 생성**

```bash
kubectl --context=dev apply -n demo -f - <<EOF
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: echo-server
  namespace: demo
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: echo-server
  minReplicas: 2
  maxReplicas: 8
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 50
EOF

# HPA 확인
kubectl --context=dev get hpa echo-server -n demo
```

**Step 6: PDB 생성**

```bash
kubectl --context=dev apply -n demo -f - <<EOF
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: echo-server
  namespace: demo
spec:
  minAvailable: 1
  selector:
    matchLabels:
      app: echo-server
EOF

# PDB 확인
kubectl --context=dev get pdb echo-server -n demo
```

**Step 7: CiliumNetworkPolicy 생성**

```bash
kubectl --context=dev apply -n demo -f - <<EOF
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: allow-external-to-echo
  namespace: demo
spec:
  endpointSelector:
    matchLabels:
      app: echo-server
  ingress:
    - fromEntities:
        - world
      toPorts:
        - ports:
            - port: "5678"
              protocol: TCP
EOF

# NetworkPolicy 확인
kubectl --context=dev get ciliumnetworkpolicy allow-external-to-echo -n demo
```

**Step 8: 전체 배포 확인**

```bash
echo "============================================="
echo "echo-server 배포 완료 — 전체 리소스 확인"
echo "============================================="
echo ""
echo "=== Deployment ==="
kubectl --context=dev get deployment echo-server -n demo
echo ""
echo "=== Pods ==="
kubectl --context=dev get pods -n demo -l app=echo-server -o wide
echo ""
echo "=== Service ==="
kubectl --context=dev get svc echo-server -n demo
echo ""
echo "=== Endpoints ==="
kubectl --context=dev get endpoints echo-server -n demo
echo ""
echo "=== HPA ==="
kubectl --context=dev get hpa echo-server -n demo
echo ""
echo "=== PDB ==="
kubectl --context=dev get pdb echo-server -n demo
echo ""
echo "=== NetworkPolicy ==="
kubectl --context=dev get ciliumnetworkpolicy allow-external-to-echo -n demo
```

**Step 9: 정리**

```bash
kubectl --context=dev delete deployment echo-server -n demo --ignore-not-found
kubectl --context=dev delete svc echo-server -n demo --ignore-not-found
kubectl --context=dev delete hpa echo-server -n demo --ignore-not-found
kubectl --context=dev delete pdb echo-server -n demo --ignore-not-found
kubectl --context=dev delete ciliumnetworkpolicy allow-external-to-echo -n demo --ignore-not-found
```

**확인 문제:**
1. 앱 배포 시 Deployment, Service, HPA, PDB, NetworkPolicy를 모두 생성하는 이유는 무엇인가?
2. readinessProbe와 livenessProbe를 모두 설정해야 하는 이유를 설명하라.
3. 이 배포를 GitOps 방식으로 관리하려면 어떻게 해야 하는가?
4. 프로덕션 환경에서 추가로 고려해야 할 리소스는 무엇인가? (Ingress, TLS, ResourceQuota 등)

**관련 KCNA 시험 주제:** 종합 — Kubernetes Fundamentals + Cloud Native Architecture + Application Delivery

---

### 시나리오 2: 장애 대응 (Pod 강제 종료 → 모니터링 확인 → 자동 복구 → 알림 확인)

**학습 목표:**
- 장애 발생 시 모니터링, 자동 복구, 알림의 흐름을 체험한다.
- Grafana, Prometheus, AlertManager를 활용한 장애 분석 방법을 학습한다.
- 자가 복구 후 상태 확인 절차를 이해한다.

**시나리오:** nginx-web Pod 하나가 비정상 종료된 상황을 시뮬레이션한다.

**Step 1: 현재 상태 확인 (정상 베이스라인)**

```bash
echo "=== 장애 발생 전 상태 ==="
echo ""
echo "Deployment:"
kubectl --context=dev get deployment nginx-web -n demo
echo ""
echo "Pods:"
kubectl --context=dev get pods -n demo -l app=nginx-web -o wide
echo ""
echo "HPA:"
kubectl --context=dev get hpa nginx-web -n demo
echo ""
echo "PDB:"
kubectl --context=dev get pdb nginx-web -n demo
```

**Step 2: 장애 시뮬레이션 — Pod 강제 삭제**

```bash
# Pod 하나를 강제 삭제 (grace period 0)
POD_NAME=$(kubectl --context=dev get pods -n demo -l app=nginx-web -o jsonpath='{.items[0].metadata.name}')
echo "강제 삭제할 Pod: $POD_NAME"
kubectl --context=dev delete pod $POD_NAME -n demo --grace-period=0 --force
```

**Step 3: 자동 복구 관찰**

```bash
# 즉시 Pod 상태 확인
kubectl --context=dev get pods -n demo -l app=nginx-web -o wide
```

**기대 출력:** 삭제된 Pod 대신 새 Pod가 자동으로 생성되어 3개를 유지한다.

**Step 4: ReplicaSet 이벤트에서 복구 기록 확인**

```bash
# ReplicaSet 이벤트
RS_NAME=$(kubectl --context=dev get rs -n demo -l app=nginx-web -o jsonpath='{.items[0].metadata.name}')
kubectl --context=dev describe rs $RS_NAME -n demo | grep -A 10 "Events:"
```

**기대 출력:** `SuccessfulCreate` 이벤트가 기록되어 있다.

**Step 5: Prometheus에서 재시작 메트릭 확인**

```bash
# Pod 재시작 횟수 확인
kubectl --context=dev run prom-check --rm -it --image=curlimages/curl -n monitoring \
  -- curl -s 'http://prometheus-server:9090/api/v1/query?query=kube_pod_container_status_restarts_total{namespace="demo",pod=~"nginx-web.*"}' | python3 -m json.tool
```

**Step 6: Grafana에서 시각적 확인**

```
웹 브라우저에서 Grafana(:30300) 접속:

1. "Kubernetes / Pod Resources" 대시보드 열기
2. namespace: demo, pod: nginx-web 선택
3. Pod 재시작 그래프에서 스파이크 확인
4. CPU/메모리 그래프에서 Pod 종료 시점의 드롭 확인
```

**Step 7: AlertManager에서 알림 확인**

```bash
# AlertManager 활성 알림 확인
kubectl --context=dev run alert-check --rm -it --image=curlimages/curl -n monitoring \
  -- curl -s http://alertmanager:9093/api/v2/alerts | python3 -m json.tool | head -30
```

**기대 출력:** PodCrashLooping 또는 HighPodRestartRate 알림이 발생했을 수 있다 (장애 빈도에 따라).

**Step 8: 서비스 정상 동작 확인**

```bash
# nginx-web 서비스 응답 확인
curl -s --connect-timeout 5 http://<node-ip>:30080 | head -3
echo ""
echo "서비스 정상 동작 확인 완료"
```

**Step 9: 장애 대응 플로우 정리**

```bash
echo "============================================="
echo "장애 대응 플로우"
echo "============================================="
echo ""
echo "1. 장애 감지"
echo "   - AlertManager 알림 수신"
echo "   - Grafana 대시보드 이상 징후"
echo "   - kubectl get pods에서 비정상 상태 확인"
echo ""
echo "2. 원인 분석"
echo "   - kubectl describe pod <pod>로 이벤트 확인"
echo "   - kubectl logs <pod>로 로그 확인"
echo "   - Prometheus PromQL로 메트릭 추이 분석"
echo "   - Loki LogQL로 시간대별 로그 검색"
echo ""
echo "3. 자동 복구 확인"
echo "   - ReplicaSet이 Pod 수 자동 복원"
echo "   - HPA가 부하에 따라 스케일링"
echo "   - ArgoCD selfHeal이 설정 변경 자동 복구"
echo ""
echo "4. 사후 확인"
echo "   - 서비스 응답 정상 확인"
echo "   - 메트릭 정상 범위 복귀 확인"
echo "   - 알림 해소 확인"
echo ""
echo "5. 포스트모텀 (사후 분석)"
echo "   - 장애 원인 문서화"
echo "   - 재발 방지 대책 수립"
echo "   - 모니터링/알림 규칙 개선"
```

**확인 문제:**
1. Pod가 CrashLoopBackOff 상태일 때 가장 먼저 확인해야 할 명령어는?
2. 자가 복구가 되었는데도 알림을 설정해야 하는 이유는 무엇인가?
3. `--grace-period=0 --force`로 삭제하는 것과 일반 삭제의 차이는?
4. PDB가 설정된 상태에서 drain 시 nginx-web Pod 삭제 순서는 어떻게 되는가?

**관련 KCNA 시험 주제:** 종합 — Container Orchestration (Self-Healing) + Observability (Monitoring, Alerting)

---

### 시나리오 3: 카나리 배포 (httpbin v1/v2 비율 변경)

**학습 목표:**
- Istio VirtualService를 사용한 카나리 배포를 체험한다.
- 트래픽 비율을 80/20에서 50/50으로 변경하고 관찰한다.
- 카나리 배포의 진행 과정(점진적 롤아웃)을 이해한다.

**시나리오:** httpbin v2의 트래픽 비율을 20%에서 50%로, 최종적으로 100%로 변경한다.

**Step 1: 현재 카나리 설정 확인**

```bash
# 현재 VirtualService 확인
kubectl --context=dev get virtualservice httpbin -n demo -o yaml
```

**기대 출력:** v1에 80%, v2에 20%의 weight가 설정되어 있다.

**Step 2: 현재 Pod 상태 확인**

```bash
# httpbin v1과 v2 Pod 확인
echo "=== httpbin v1 ==="
kubectl --context=dev get pods -n demo -l app=httpbin,version=v1 -o wide
echo ""
echo "=== httpbin v2 ==="
kubectl --context=dev get pods -n demo -l app=httpbin,version=v2 -o wide
```

**기대 출력:** v1 2개, v2 1개의 Pod가 실행 중이다.

**Step 3: 카나리 비율 변경 (80/20 → 50/50)**

```bash
# VirtualService 업데이트 — 50/50 비율
kubectl --context=dev apply -n demo -f - <<EOF
apiVersion: networking.istio.io/v1
kind: VirtualService
metadata:
  name: httpbin
  namespace: demo
spec:
  hosts:
    - httpbin
  http:
    - route:
        - destination:
            host: httpbin
            subset: v1
          weight: 50
        - destination:
            host: httpbin
            subset: v2
          weight: 50
EOF

echo "트래픽 비율 변경: v1(80%) → v1(50%), v2(20%) → v2(50%)"
```

**Step 4: 트래픽 분배 확인**

```bash
# 100번 요청으로 비율 확인
kubectl --context=dev run canary-test --rm -it --image=curlimages/curl -n demo \
  -- sh -c '
    echo "100 requests to httpbin..."
    for i in $(seq 1 100); do
      curl -s -o /dev/null -w "%{http_code}" http://httpbin/get
      echo -n " "
    done
    echo ""
    echo "Test completed"
  '
```

**Step 5: 카나리 비율 변경 (50/50 → 0/100, v2 완전 전환)**

```bash
# VirtualService 업데이트 — v2로 완전 전환
kubectl --context=dev apply -n demo -f - <<EOF
apiVersion: networking.istio.io/v1
kind: VirtualService
metadata:
  name: httpbin
  namespace: demo
spec:
  hosts:
    - httpbin
  http:
    - route:
        - destination:
            host: httpbin
            subset: v1
          weight: 0
        - destination:
            host: httpbin
            subset: v2
          weight: 100
EOF

echo "트래픽 비율 변경: v1(0%), v2(100%) — 완전 전환"
```

**Step 6: 문제 발견 시 롤백**

```bash
# v2에 문제가 있다면 즉시 롤백
kubectl --context=dev apply -n demo -f - <<EOF
apiVersion: networking.istio.io/v1
kind: VirtualService
metadata:
  name: httpbin
  namespace: demo
spec:
  hosts:
    - httpbin
  http:
    - route:
        - destination:
            host: httpbin
            subset: v1
          weight: 100
        - destination:
            host: httpbin
            subset: v2
          weight: 0
EOF

echo "롤백 완료: 모든 트래픽이 v1으로 돌아감"
```

**Step 7: 원래 상태로 복구 (80/20)**

```bash
# 원래 80/20 비율로 복구
kubectl --context=dev apply -n demo -f - <<EOF
apiVersion: networking.istio.io/v1
kind: VirtualService
metadata:
  name: httpbin
  namespace: demo
spec:
  hosts:
    - httpbin
  http:
    - route:
        - destination:
            host: httpbin
            subset: v1
          weight: 80
        - destination:
            host: httpbin
            subset: v2
          weight: 20
EOF

echo "원래 비율로 복구: v1(80%), v2(20%)"
```

**Step 8: 카나리 배포 전략 정리**

```bash
echo "============================================="
echo "카나리 배포 진행 과정"
echo "============================================="
echo ""
echo "단계 1: 초기 배포 — v1(100%)"
echo "  새 버전(v2) Deployment 생성, 트래픽 0%"
echo ""
echo "단계 2: 소량 트래픽 — v1(80%), v2(20%)"
echo "  v2로 소량의 트래픽을 보내 검증"
echo "  에러율, 응답 시간 등 모니터링"
echo ""
echo "단계 3: 절반 전환 — v1(50%), v2(50%)"
echo "  v2가 안정적이면 비율 증가"
echo "  지속적 모니터링"
echo ""
echo "단계 4: 완전 전환 — v1(0%), v2(100%)"
echo "  v2가 충분히 검증되면 완전 전환"
echo "  v1 Deployment는 일정 기간 유지 (롤백 대비)"
echo ""
echo "단계 5: 정리 — v2만 유지"
echo "  v1 Deployment 삭제"
echo "  VirtualService에서 v1 라우팅 제거"
echo ""
echo "장점: 문제 발생 시 즉시 이전 버전으로 트래픽 전환 가능"
echo "단점: 두 버전을 동시에 운영해야 하므로 리소스 사용 증가"
```

**Step 9: Circuit Breaker 동작 확인**

```bash
echo "============================================="
echo "Circuit Breaker 설정 확인"
echo "============================================="
echo ""
echo "DestinationRule의 outlierDetection 설정:"
echo "  consecutive5xxErrors: 3  — 연속 3회 5xx 에러"
echo "  interval: 30s            — 30초 간격으로 검사"
echo "  baseEjectionTime: 30s    — 30초간 트래픽 차단"
echo ""
echo "동작:"
echo "  1. httpbin v2에서 연속 3회 5xx 에러 발생"
echo "  2. Circuit Breaker 작동 — v2를 30초간 ejection"
echo "  3. 모든 트래픽이 v1으로 전달"
echo "  4. 30초 후 v2를 다시 풀에 포함"
echo "  5. 여전히 에러 발생 시 다시 ejection"
```

**확인 문제:**
1. 카나리 배포와 블루/그린 배포의 차이점을 설명하라.
2. VirtualService의 weight 합이 100이 아니면 어떻게 되는가?
3. Circuit Breaker의 `consecutive5xxErrors`와 `baseEjectionTime`의 관계를 설명하라.
4. 카나리 배포 중 v2의 에러율이 높다면 어떤 조치를 취해야 하는가?

**관련 KCNA 시험 주제:** 종합 — Cloud Native Architecture (Service Mesh, Deployment Strategies) + Application Delivery

---

## 학습 참고 자료

| 리소스 | 설명 |
|--------|------|
| [Kubernetes 공식 문서](https://kubernetes.io/docs/) | 핵심 개념 및 API 레퍼런스 |
| [CNCF Landscape](https://landscape.cncf.io/) | CNCF 프로젝트 전체 지도 |
| [KCNA 공식 커리큘럼](https://github.com/cncf/curriculum) | 시험 범위 및 비중 |
| [12-Factor App](https://12factor.net/) | Cloud Native 애플리케이션 원칙 |
| [Helm 공식 문서](https://helm.sh/docs/) | 패키지 관리 |
| [ArgoCD 공식 문서](https://argo-cd.readthedocs.io/) | GitOps 배포 |
| [Cilium 공식 문서](https://docs.cilium.io/) | CNI 및 NetworkPolicy |
| [Istio 공식 문서](https://istio.io/latest/docs/) | 서비스 메시 |
| [Prometheus 공식 문서](https://prometheus.io/docs/) | 모니터링 및 PromQL |
| [Grafana 공식 문서](https://grafana.com/docs/) | 대시보드 및 시각화 |

---

## tart-infra 주요 접근 정보 요약

| 서비스 | 포트 | 인증 | 용도 |
|--------|------|------|------|
| nginx-web | `:30080` | — | 데모 웹 서버 |
| Keycloak | `:30880` | admin / — | IAM / SSO |
| Grafana | `:30300` | admin / admin | 메트릭 대시보드 |
| ArgoCD | `:30800` | admin / (secret 확인) | GitOps 배포 관리 |
| Jenkins | `:30900` | admin / admin | CI/CD 파이프라인 |
| AlertManager | `:30903` | — | 알림 관리 |
| Hubble UI | `:31235` | — | 네트워크 플로 시각화 |

---

## KCNA 시험 도메인별 Lab 매핑

| 도메인 | 비중 | Lab |
|--------|------|-----|
| Kubernetes Fundamentals | 46% | Lab 1.1 ~ 1.4, Lab 2.1 ~ 2.5, Lab 3.1 ~ 3.4, Lab 4.1 ~ 4.3 |
| Container Orchestration | 22% | Lab 5.1 ~ 5.4 |
| Cloud Native Architecture | 16% | Lab 6.1 ~ 6.5 |
| Cloud Native Observability | 8% | Lab 7.1 ~ 7.5 |
| Cloud Native Application Delivery | 8% | Lab 8.1 ~ 8.4 |
| 종합 | — | 시나리오 1 ~ 3 |
