# KCNA 모의 시험 문제

> 총 40문항 | 도메인별 비율: Kubernetes Fundamentals(18), Container Orchestration(9), Cloud Native Architecture(6), Observability(4), Application Delivery(3)

---

## Kubernetes Fundamentals (문제 1~18)

### 문제 1.
Kubernetes 클러스터에서 모든 클러스터 상태 데이터를 영구적으로 저장하는 컴포넌트는 무엇인가?

A) kube-apiserver
B) kube-scheduler
C) etcd
D) kube-controller-manager

<details>
<summary>정답 확인</summary>

**정답: C) etcd ✅**

etcd는 분산 키-값 저장소로, Kubernetes 클러스터의 모든 상태 정보(desired state, current state)를 저장하는 단일 진실 소스(Single Source of Truth)이다. Raft 합의 알고리즘을 사용하여 데이터 일관성을 보장하며, kube-apiserver만이 etcd와 직접 통신한다.

**검증:**
```bash
# etcd 엔드포인트 상태 확인
kubectl -n kube-system exec etcd-<control-plane-node> -- etcdctl \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key \
  endpoint status --write-out=table

# etcd에 저장된 키 목록 확인 (prefix 지정)
kubectl -n kube-system exec etcd-<control-plane-node> -- etcdctl \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key \
  get /registry --prefix --keys-only | head -20
```
```text
# endpoint status 기대 출력
+------------------------+------------------+---------+---------+-----------+...
|        ENDPOINT        |        ID        | VERSION | DB SIZE | IS LEADER |...
+------------------------+------------------+---------+---------+-----------+...
| https://127.0.0.1:2379 | 8e9e05c52164694d |  3.5.x  |  5.6 MB |   true    |...
+------------------------+------------------+---------+---------+-----------+...

# get /registry 기대 출력
/registry/pods/default/nginx-xxxxx
/registry/services/specs/default/kubernetes
/registry/deployments/default/my-app
...
```

**오답 분석:**
- A) kube-apiserver: 클러스터의 API 진입점이다. 모든 컴포넌트(kubelet, scheduler, controller-manager)가 apiserver를 통해 통신하지만, 데이터를 직접 저장하지 않는다. etcd의 유일한 클라이언트로서 데이터 읽기/쓰기를 중개하는 역할이다.
- B) kube-scheduler: Pod를 노드에 배치하는 스케줄링만 담당한다. 상태를 저장하는 기능이 없다.
- D) kube-controller-manager: 다양한 컨트롤러(ReplicaSet, Deployment, Node 등)를 실행하여 현재 상태를 원하는 상태로 수렴시키는 제어 루프를 담당한다. 데이터 저장 역할이 아니다.

**내부 동작 원리:**
etcd는 Raft 합의 알고리즘으로 동작한다. 리더 노드가 쓰기 요청을 받으면 Write-Ahead Log(WAL)에 기록한 뒤 팔로워에게 복제하고, 과반수 이상 응답을 받으면 커밋한다. Kubernetes의 모든 리소스는 `/registry/<resource-type>/<namespace>/<name>` 형태의 키로 etcd에 protobuf 직렬화되어 저장된다. kube-apiserver의 watch 기능은 etcd의 watch API를 기반으로 구현되어, 리소스 변경을 실시간으로 감지할 수 있다.

**CNCF 생태계 맥락:**
etcd는 CNCF 졸업 프로젝트이다. CoreOS(현 Red Hat)가 개발하였으며, Kubernetes 외에도 Rook, Vitess 등 다른 CNCF 프로젝트에서 분산 합의 저장소로 활용된다. etcd의 watch 메커니즘이 Kubernetes의 선언적 모델(desired state → current state reconciliation)을 가능하게 하는 핵심 인프라이다.

**등장 배경:**
분산 시스템에서 클러스터 상태를 일관되게 관리하려면 합의 알고리즘 기반의 분산 저장소가 필요하다. ZooKeeper 같은 기존 솔루션은 Java 기반이고 운영 복잡도가 높았다. etcd는 Go로 작성되어 가볍고, gRPC/HTTP API를 제공하며, 단순한 키-값 모델로 Kubernetes와 같은 컨테이너 오케스트레이터의 상태 저장소로 적합하도록 설계되었다.
</details>

---

### 문제 2.
새로 생성된 Pod를 적절한 노드에 배치하는 역할을 담당하는 Control Plane 구성 요소는 무엇인가?

A) kubelet
B) kube-proxy
C) kube-controller-manager
D) kube-scheduler

<details>
<summary>정답 확인</summary>

**정답: D) kube-scheduler ✅**

kube-scheduler는 아직 노드에 할당되지 않은 새로운 Pod를 감지하고, 리소스 요구사항, 어피니티/안티-어피니티 규칙, 테인트/톨러레이션 등을 고려하여 최적의 노드를 선택한다. 필터링(Filtering)과 스코어링(Scoring) 2단계로 스케줄링을 수행한다.

**검증:**
```bash
# Pod가 어느 노드에 스케줄링되었는지 확인
kubectl get pods -o wide

# 특정 Pod의 스케줄링 이벤트 확인
kubectl describe pod <pod-name> | grep -A5 "Events:"

# scheduler 로그에서 스케줄링 결정 과정 확인
kubectl -n kube-system logs kube-scheduler-<control-plane-node> | tail -10
```
```text
# kubectl get pods -o wide 기대 출력
NAME         READY   STATUS    RESTARTS   AGE   IP           NODE
nginx-abc    1/1     Running   0          5m    10.244.1.3   worker-1

# kubectl describe pod 이벤트 기대 출력
Events:
  Type    Reason     Age   From               Message
  ----    ------     ----  ----               -------
  Normal  Scheduled  5m    default-scheduler  Successfully assigned default/nginx-abc to worker-1
  Normal  Pulled     5m    kubelet            Container image "nginx" already present on machine
  Normal  Created    5m    kubelet            Created container nginx
  Normal  Started    5m    kubelet            Started container nginx
```

**오답 분석:**
- A) kubelet: 각 워커 노드에서 실행되는 에이전트이다. 스케줄러가 결정한 노드에서 실제로 컨테이너를 시작하고 관리하는 역할이며, 노드 선택 자체에는 관여하지 않는다.
- B) kube-proxy: 각 노드에서 Service의 네트워크 규칙(iptables/IPVS)을 관리한다. Pod 스케줄링과 무관하다.
- C) kube-controller-manager: ReplicaSet 컨트롤러가 "Pod를 생성해야 한다"는 결정을 내리지만, 어느 노드에 배치할지 결정하는 것은 scheduler의 역할이다.

**내부 동작 원리:**
스케줄링은 2단계로 진행된다. (1) 필터링(Filtering): 노드 리소스 부족, 테인트, nodeSelector 불일치 등으로 부적격한 노드를 제외한다. (2) 스코어링(Scoring): 남은 노드에 대해 리소스 균형(LeastRequestedPriority), 어피니티 점수, 데이터 지역성 등을 기준으로 점수를 매겨 최고점 노드를 선택한다. 스케줄러는 선택된 노드 이름을 Pod의 `spec.nodeName`에 기록하는 Binding을 API 서버에 요청한다.

**CNCF 생태계 맥락:**
kube-scheduler는 Kubernetes 코어 컴포넌트이다. 스케줄링 확장을 위해 Scheduling Framework 플러그인 구조를 제공하며, Volcano(CNCF 인큐베이팅)는 배치 워크로드/GPU 스케줄링을 위한 별도 스케줄러를 제공한다. Descheduler 프로젝트는 이미 스케줄링된 Pod를 재배치하는 보완 도구이다.

**등장 배경:**
수동으로 컨테이너를 특정 서버에 배치하는 방식은 클러스터 규모가 커지면 비효율적이고 리소스 불균형이 발생한다. 자동 스케줄러는 리소스 요구사항, 제약 조건, 정책을 종합적으로 고려하여 최적의 노드를 선택함으로써 클러스터 리소스 활용도를 극대화하고 운영 부담을 제거한다.
</details>

---

### 문제 3.
Kubernetes에서 배포 가능한 가장 작은 단위는 무엇인가?

A) Container
B) Pod
C) ReplicaSet
D) Deployment

<details>
<summary>정답 확인</summary>

**정답: B) Pod ✅**

Pod는 Kubernetes에서 생성, 스케줄링, 관리할 수 있는 가장 작은 배포 단위이다. 하나 이상의 컨테이너를 포함하며, 같은 Pod 내 컨테이너는 네트워크 네임스페이스(IP, 포트)와 스토리지를 공유한다. Container 자체는 K8s의 오브젝트가 아니라 Pod 내에서 실행되는 런타임 단위이다.

**검증:**
```bash
# Pod 생성
kubectl run nginx --image=nginx

# Pod 내부 컨테이너 확인
kubectl get pod nginx -o jsonpath='{.spec.containers[*].name}'

# Pod에 할당된 IP 확인 (같은 Pod 내 컨테이너는 이 IP를 공유)
kubectl get pod nginx -o jsonpath='{.status.podIP}'

# Pod 상세 정보에서 컨테이너 목록 확인
kubectl describe pod nginx | grep -A3 "Containers:"
```
```text
# kubectl run nginx --image=nginx 기대 출력
pod/nginx created

# jsonpath containers 기대 출력
nginx

# jsonpath podIP 기대 출력
10.244.1.5

# describe 기대 출력
Containers:
  nginx:
    Container ID:   containerd://abc123...
    Image:          nginx
```

**오답 분석:**
- A) Container: Kubernetes API에서 독립적으로 관리되는 오브젝트가 아니다. Container는 반드시 Pod 안에 정의되어야 하며, 단독으로 생성/삭제/스케줄링할 수 없다. Docker 등 런타임 수준의 단위이다.
- C) ReplicaSet: Pod의 복제본 수를 관리하는 상위 리소스이다. ReplicaSet 자체가 배포 단위가 아니라, Pod를 원하는 수만큼 유지하는 컨트롤러이다.
- D) Deployment: ReplicaSet을 관리하는 더 상위 리소스이다. 롤링 업데이트, 롤백 등의 배포 전략을 제공하지만, 가장 작은 배포 단위는 아니다.

**내부 동작 원리:**
Pod가 생성되면 kubelet은 먼저 pause 컨테이너(infrastructure container)를 실행하여 네트워크 네임스페이스를 생성한다. 이후 사용자 컨테이너들이 이 네임스페이스에 합류하여 동일한 IP 주소와 포트 공간을 공유한다. 같은 Pod 내 컨테이너 간에는 `localhost`로 통신이 가능하고, emptyDir 등의 볼륨을 통해 파일 시스템도 공유할 수 있다.

**CNCF 생태계 맥락:**
Pod는 Kubernetes의 핵심 추상화 단위이다. 서비스 메시(Istio, Linkerd)는 Pod에 사이드카 프록시 컨테이너를 주입하여 동작한다. 관측성 도구(OpenTelemetry)도 사이드카 또는 init 컨테이너로 Pod에 추가되는 구조이다. Pod라는 멀티 컨테이너 단위가 있기 때문에 사이드카 패턴이 가능하다.

**등장 배경:**
Docker는 단일 컨테이너 단위로 관리하지만, 실제 워크로드에서는 밀접하게 결합된 여러 프로세스(예: 앱 + 로그 수집기, 앱 + 프록시)가 동일한 네트워크/스토리지 컨텍스트를 공유해야 하는 경우가 빈번하다. Pod는 이러한 "함께 스케줄링되고 함께 실행되어야 하는 컨테이너 그룹"이라는 개념을 추상화하여, 단일 컨테이너 모델의 한계를 해결한다.
</details>

---

### 문제 4.
다음 중 StatefulSet의 특성이 아닌 것은?

A) Pod 이름이 순서대로 고정된다 (예: web-0, web-1)
B) 각 Pod에 고유한 PersistentVolume이 연결된다
C) Pod의 생성과 삭제가 순서대로 이루어진다
D) 기본적으로 RollingUpdate 전략만 지원한다

<details>
<summary>정답 확인</summary>

**정답: D) 기본적으로 RollingUpdate 전략만 지원한다 ✅**

StatefulSet은 RollingUpdate와 OnDelete 두 가지 업데이트 전략을 지원한다. A, B, C는 모두 StatefulSet의 핵심 특성이다. 안정적이고 고유한 네트워크 식별자, 안정적이고 지속적인 스토리지, 순서 보장이 StatefulSet의 3가지 주요 보장 사항이다.

**검증:**
```bash
# StatefulSet 생성 후 Pod 이름 패턴 확인
kubectl create -f - <<EOF
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: web
spec:
  serviceName: "nginx"
  replicas: 3
  selector:
    matchLabels:
      app: nginx
  template:
    metadata:
      labels:
        app: nginx
    spec:
      containers:
      - name: nginx
        image: nginx
EOF

# Pod 이름이 순서대로 고정되는지 확인
kubectl get pods -l app=nginx

# StatefulSet의 업데이트 전략 확인
kubectl get sts web -o jsonpath='{.spec.updateStrategy}'
```
```text
# kubectl get pods 기대 출력
NAME    READY   STATUS    RESTARTS   AGE
web-0   1/1     Running   0          30s
web-1   1/1     Running   0          25s
web-2   1/1     Running   0          20s

# updateStrategy 기대 출력
{"rollingUpdate":{"partition":0},"type":"RollingUpdate"}
```

**오답 분석:**
- A) Pod 이름이 순서대로 고정된다: 맞는 설명이다. StatefulSet은 `<statefulset-name>-<ordinal>` 형태로 0부터 시작하는 고정된 이름을 부여한다. Pod가 삭제되고 재생성되어도 동일한 이름을 유지한다.
- B) 각 Pod에 고유한 PersistentVolume이 연결된다: 맞는 설명이다. volumeClaimTemplates를 통해 각 Pod에 독립적인 PVC가 생성된다. Pod가 재생성되면 동일한 PVC에 다시 바인딩된다.
- C) Pod의 생성과 삭제가 순서대로 이루어진다: 맞는 설명이다. 생성 시 web-0이 Ready 상태가 된 후에야 web-1이 생성된다. 삭제 시에는 역순(web-2 → web-1 → web-0)으로 진행된다.

**내부 동작 원리:**
StatefulSet 컨트롤러는 각 Pod에 대해 고유한 ordinal index(0, 1, 2, ...)를 할당하고, Headless Service와 조합하여 `<pod-name>.<service-name>.<namespace>.svc.cluster.local` 형태의 안정적인 DNS 레코드를 생성한다. volumeClaimTemplates에서 생성된 PVC는 Pod가 삭제되어도 함께 삭제되지 않아 데이터가 보존된다. RollingUpdate 전략은 역순(높은 ordinal부터)으로 업데이트하며, `partition` 필드로 카나리 업데이트가 가능하다.

**CNCF 생태계 맥락:**
StatefulSet은 Kubernetes 코어 리소스이다. 데이터베이스(PostgreSQL, MySQL), 메시지 큐(Kafka, RabbitMQ), 분산 저장소(etcd, Cassandra) 등 상태를 가지는 워크로드를 Kubernetes에서 실행할 수 있게 한다. Rook(CNCF 졸업)은 StatefulSet을 활용하여 Ceph 스토리지 클러스터를 Kubernetes 위에서 운영한다.

**등장 배경:**
Deployment/ReplicaSet은 Pod를 무작위 이름으로 생성하고 상호 교체 가능하게 다루므로, 안정적인 네트워크 ID와 지속적인 스토리지가 필요한 유상태(stateful) 워크로드에 부적합하다. 데이터베이스 클러스터처럼 각 인스턴스가 고유한 정체성과 저장소를 필요로 하는 경우, 순서 보장과 안정적 식별자를 제공하는 별도의 워크로드 리소스가 필요했고 이것이 StatefulSet이다.
</details>

---

### 문제 5.
클러스터 외부에서 접근할 수 없고, 클러스터 내부 서비스 간 통신에만 사용되는 Service 유형은?

A) NodePort
B) LoadBalancer
C) ClusterIP
D) ExternalName

<details>
<summary>정답 확인</summary>

**정답: C) ClusterIP ✅**

ClusterIP는 Service의 기본 유형으로, 클러스터 내부에서만 접근 가능한 가상 IP를 할당한다. 외부에서는 직접 접근할 수 없으며, 내부 서비스 간 통신에 사용된다. NodePort와 LoadBalancer는 외부 접근을 허용하고, ExternalName은 외부 DNS로 매핑하는 특수 유형이다.

**검증:**
```bash
# ClusterIP 서비스 생성
kubectl expose deployment nginx --port=80 --type=ClusterIP

# 서비스의 타입과 ClusterIP 확인
kubectl get svc nginx

# 클러스터 내부에서 접근 테스트 (임시 Pod 사용)
kubectl run curl-test --rm -it --image=curlimages/curl -- curl http://nginx.default.svc.cluster.local

# 서비스 상세 정보 확인
kubectl describe svc nginx
```
```text
# kubectl get svc 기대 출력
NAME    TYPE        CLUSTER-IP     EXTERNAL-IP   PORT(S)   AGE
nginx   ClusterIP   10.96.45.123   <none>        80/TCP    5s

# curl 기대 출력
<!DOCTYPE html>
<html>
<head><title>Welcome to nginx!</title></head>
...

# describe svc 기대 출력 (일부)
Type:              ClusterIP
IP:                10.96.45.123
Port:              <unset>  80/TCP
Endpoints:         10.244.1.5:80,10.244.2.3:80
```

**오답 분석:**
- A) NodePort: ClusterIP의 기능을 포함하면서, 추가로 모든 노드의 특정 포트(30000-32767)를 통해 외부 접근을 허용한다. `<NodeIP>:<NodePort>`로 외부에서 접근 가능하다.
- B) LoadBalancer: NodePort의 기능을 포함하면서, 추가로 클라우드 프로바이더의 외부 로드밸런서를 프로비저닝한다. 외부 IP가 할당된다.
- D) ExternalName: 클러스터 내부에서 외부 DNS 이름으로 매핑하는 특수 유형이다. ClusterIP를 할당하지 않고, CNAME 레코드를 반환한다. 외부 서비스를 Kubernetes 서비스 이름으로 참조할 때 사용한다.

**내부 동작 원리:**
ClusterIP 서비스가 생성되면 kube-apiserver가 서비스 CIDR 범위에서 가상 IP를 할당한다. kube-proxy는 이 변경을 watch하여 각 노드에 iptables 규칙(또는 IPVS 규칙)을 생성한다. 클라이언트가 ClusterIP로 요청하면 iptables의 DNAT 규칙에 의해 실제 Pod IP 중 하나로 트래픽이 전달된다. 이 가상 IP는 어떤 네트워크 인터페이스에도 바인딩되지 않으며, 커널의 netfilter에서만 존재한다.

**CNCF 생태계 맥락:**
Service는 Kubernetes의 서비스 디스커버리 메커니즘의 핵심이다. CoreDNS(CNCF 졸업)가 서비스 이름을 ClusterIP로 해석하여 DNS 기반 서비스 디스커버리를 제공한다. Cilium(CNCF 졸업)은 eBPF를 사용하여 kube-proxy를 대체하고 ClusterIP의 로드밸런싱을 커널 수준에서 처리한다.

**등장 배경:**
Pod는 일시적(ephemeral)이며 IP가 변경될 수 있다. 여러 Pod 복제본에 안정적으로 접근하려면 고정된 엔드포인트와 로드밸런싱이 필요하다. Service는 Pod 집합에 대한 안정적인 네트워크 추상화를 제공하여, 클라이언트가 개별 Pod의 IP를 알 필요 없이 서비스 이름이나 ClusterIP로 접근할 수 있게 한다.
</details>

---

### 문제 6.
NodePort Service에서 사용 가능한 기본 포트 범위는?

A) 1-65535
B) 8080-9090
C) 30000-32767
D) 20000-25000

<details>
<summary>정답 확인</summary>

**정답: C) 30000-32767 ✅**

NodePort 서비스는 모든 노드의 특정 포트를 통해 외부에서 접근할 수 있게 하며, 기본 포트 범위는 30000-32767이다. nodePort 필드를 지정하지 않으면 이 범위 내에서 자동으로 할당된다. 이 범위는 kube-apiserver의 `--service-node-port-range` 플래그로 변경할 수 있다.

**검증:**
```bash
# NodePort 서비스 생성
kubectl expose deployment nginx --port=80 --type=NodePort

# 할당된 NodePort 확인
kubectl get svc nginx -o jsonpath='{.spec.ports[0].nodePort}'

# 서비스 확인
kubectl get svc nginx

# kube-apiserver의 NodePort 범위 설정 확인 (kubeadm 클러스터 기준)
kubectl -n kube-system get pod kube-apiserver-<control-plane> -o yaml | grep service-node-port-range
```
```text
# kubectl get svc 기대 출력
NAME    TYPE       CLUSTER-IP     EXTERNAL-IP   PORT(S)        AGE
nginx   NodePort   10.96.78.200   <none>        80:31245/TCP   5s

# nodePort 기대 출력
31245

# apiserver 설정 기대 출력
    - --service-node-port-range=30000-32767
```

**오답 분석:**
- A) 1-65535: 전체 TCP/UDP 포트 범위이다. 이 범위를 모두 NodePort에 할당하면 시스템 서비스(SSH 22, HTTP 80 등)와 충돌이 발생한다.
- B) 8080-9090: 임의의 범위이며 Kubernetes에서 정의된 것이 아니다.
- D) 20000-25000: 임의의 범위이며 Kubernetes에서 정의된 것이 아니다.

**내부 동작 원리:**
NodePort 서비스가 생성되면 kube-proxy는 모든 노드에서 해당 포트에 대한 리스닝 규칙을 iptables에 추가한다. 외부 트래픽이 `<NodeIP>:<NodePort>`로 들어오면 DNAT 규칙에 의해 해당 서비스의 백엔드 Pod 중 하나로 전달된다. `externalTrafficPolicy: Local`로 설정하면 해당 노드에 있는 Pod로만 트래픽을 전달하여 불필요한 홉을 줄이고 클라이언트 소스 IP를 보존할 수 있다.

**CNCF 생태계 맥락:**
NodePort는 개발/테스트 환경에서 간편하게 외부 접근을 제공하지만, 프로덕션에서는 Ingress Controller(NGINX, Traefik, Contour 등 CNCF 프로젝트)나 LoadBalancer 타입을 사용하는 것이 일반적이다. MetalLB는 베어메탈 환경에서 LoadBalancer 타입을 지원하기 위한 CNCF 프로젝트이다.

**등장 배경:**
ClusterIP만으로는 클러스터 외부에서 서비스에 접근할 수 없다. NodePort는 별도의 외부 로드밸런서 없이도 노드의 IP와 포트 조합으로 외부 접근을 가능하게 하는 가장 단순한 방법이다. 30000-32767 범위를 기본값으로 설정한 이유는 well-known 포트(0-1023)와 일반 애플리케이션 포트(1024-29999)와의 충돌을 방지하기 위함이다.
</details>

---

### 문제 7.
ConfigMap에 대한 설명으로 올바르지 않은 것은?

A) 비기밀 설정 데이터를 키-값 쌍으로 저장한다
B) 환경 변수 또는 볼륨으로 Pod에 주입할 수 있다
C) ConfigMap이 변경되면 환경 변수로 주입된 값도 자동으로 갱신된다
D) 최대 크기는 1MiB이다

<details>
<summary>정답 확인</summary>

**정답: C) ConfigMap이 변경되면 환경 변수로 주입된 값도 자동으로 갱신된다 ✅**

ConfigMap이 변경될 때, 볼륨으로 마운트된 경우에는 자동으로 업데이트되지만, 환경 변수로 주입된 경우에는 Pod를 재시작해야 변경 사항이 반영된다. 이는 환경 변수가 Pod 생성 시점에 결정되어 컨테이너 프로세스에 전달되기 때문이다.

**검증:**
```bash
# ConfigMap 생성
kubectl create configmap app-config --from-literal=APP_MODE=production

# ConfigMap 내용 확인
kubectl get configmap app-config -o yaml

# ConfigMap을 환경 변수로 사용하는 Pod 내에서 확인
kubectl exec <pod-name> -- env | grep APP_MODE

# ConfigMap을 볼륨으로 마운트한 경우 파일 내용 확인
kubectl exec <pod-name> -- cat /etc/config/APP_MODE

# ConfigMap 크기 확인 (1MiB 제한)
kubectl get configmap app-config -o json | wc -c
```
```text
# kubectl get configmap 기대 출력
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
  namespace: default
data:
  APP_MODE: production

# env 기대 출력
APP_MODE=production
```

**오답 분석:**
- A) 비기밀 설정 데이터를 키-값 쌍으로 저장한다: 맞는 설명이다. ConfigMap은 비밀이 아닌 설정 데이터를 저장하는 용도이다. 민감한 데이터는 Secret을 사용해야 한다.
- B) 환경 변수 또는 볼륨으로 Pod에 주입할 수 있다: 맞는 설명이다. `envFrom`, `env.valueFrom.configMapKeyRef`로 환경 변수로, `volumes` + `volumeMounts`로 파일 형태로 주입 가능하다.
- D) 최대 크기는 1MiB이다: 맞는 설명이다. ConfigMap의 data 필드 크기는 1MiB(1,048,576바이트)로 제한된다. 이는 etcd의 개별 오브젝트 크기 제한과 관련이 있다.

**내부 동작 원리:**
환경 변수 방식은 Pod 생성 시점에 kubelet이 ConfigMap 데이터를 읽어 컨테이너의 환경 변수로 설정한다. 컨테이너 프로세스의 `/proc/<pid>/environ`에 고정되므로 변경이 불가하다. 볼륨 마운트 방식은 kubelet이 주기적으로(기본 60초) ConfigMap 변경을 체크하여 마운트된 파일을 심볼릭 링크 교체 방식으로 원자적(atomic)으로 업데이트한다. 단, 애플리케이션이 파일 변경을 감지하는 로직(inotify 등)이 필요하다.

**CNCF 생태계 맥락:**
ConfigMap은 Kubernetes 코어 리소스이다. Helm은 Chart의 values.yaml을 통해 ConfigMap을 템플릿으로 생성한다. Kustomize는 configMapGenerator를 통해 ConfigMap을 자동 생성하고, 내용이 변경되면 이름에 해시를 추가하여 Pod 롤링 업데이트를 유발하는 방식으로 환경 변수 방식의 한계를 우회한다.

**등장 배경:**
컨테이너 이미지에 설정 값을 하드코딩하면 환경별(개발/스테이징/프로덕션)로 이미지를 따로 빌드해야 한다. 12-Factor App 원칙에서는 설정을 코드에서 분리할 것을 권장한다. ConfigMap은 설정 데이터를 이미지 외부에서 관리하여, 동일한 이미지를 여러 환경에서 재사용할 수 있게 한다.
</details>

---

### 문제 8.
PersistentVolume의 접근 모드 중 여러 노드에서 동시에 읽기/쓰기가 가능한 모드는?

A) ReadWriteOnce (RWO)
B) ReadOnlyMany (ROX)
C) ReadWriteMany (RWX)
D) ReadWriteOncePod (RWOP)

<details>
<summary>정답 확인</summary>

**정답: C) ReadWriteMany (RWX) ✅**

ReadWriteMany(RWX)는 여러 노드에서 동시에 읽기와 쓰기가 가능한 접근 모드이다. NFS, CephFS 등의 스토리지 타입이 이 모드를 지원한다. RWO는 하나의 노드, ROX는 여러 노드에서 읽기만, RWOP는 하나의 Pod에서만 읽기/쓰기가 가능하다.

**검증:**
```bash
# PV의 접근 모드 확인
kubectl get pv -o custom-columns=NAME:.metadata.name,ACCESS_MODES:.spec.accessModes,CAPACITY:.spec.capacity.storage

# PVC의 접근 모드 확인
kubectl get pvc -o custom-columns=NAME:.metadata.name,ACCESS_MODES:.status.accessModes,VOLUME:.spec.volumeName

# 특정 StorageClass가 지원하는 정보 확인
kubectl describe storageclass <sc-name>
```
```text
# kubectl get pv 기대 출력
NAME      ACCESS_MODES       CAPACITY
pv-nfs    ["ReadWriteMany"]  10Gi
pv-local  ["ReadWriteOnce"]  5Gi

# kubectl get pvc 기대 출력
NAME       ACCESS_MODES       VOLUME
data-pvc   ["ReadWriteMany"]  pv-nfs
```

**오답 분석:**
- A) ReadWriteOnce (RWO): 단일 노드에서만 읽기/쓰기가 가능하다. 해당 노드에 있는 여러 Pod는 동시에 접근할 수 있지만, 다른 노드의 Pod에서는 접근 불가하다. AWS EBS, GCE PD 등 블록 스토리지가 이 모드를 지원한다.
- B) ReadOnlyMany (ROX): 여러 노드에서 동시에 읽기만 가능하다. 쓰기는 허용되지 않는다. 설정 파일이나 정적 데이터를 여러 Pod에서 공유할 때 사용한다.
- D) ReadWriteOncePod (RWOP): Kubernetes v1.22에서 추가된 모드로, 단일 Pod에서만 읽기/쓰기가 가능하다. RWO보다 더 엄격하게 하나의 Pod에만 접근을 제한하여 데이터 안전성을 보장한다.

**내부 동작 원리:**
접근 모드는 PV/PVC 수준에서 선언되며, 실제 제약은 스토리지 드라이버(CSI 드라이버)가 적용한다. 블록 스토리지(EBS, Azure Disk)는 물리적으로 하나의 노드에만 attach 가능하므로 RWX를 지원하지 않는다. 네트워크 파일 시스템(NFS, CephFS, GlusterFS)은 여러 노드에서 동시 마운트가 가능하므로 RWX를 지원한다. PVC가 PV에 바인딩될 때, 요청한 접근 모드가 PV가 지원하는 모드에 포함되어야 한다.

**CNCF 생태계 맥락:**
Rook(CNCF 졸업)은 Ceph를 Kubernetes 위에서 운영하여 RWX를 지원하는 CephFS 스토리지를 제공한다. Longhorn(CNCF 인큐베이팅)은 분산 블록 스토리지로 RWX를 NFS 기반으로 지원한다. CSI(Container Storage Interface)는 스토리지 벤더가 Kubernetes와 통합하기 위한 표준 인터페이스이다.

**등장 배경:**
다양한 워크로드가 서로 다른 스토리지 접근 패턴을 필요로 한다. 데이터베이스는 단일 노드 쓰기(RWO)를, 웹 서버의 정적 파일 공유는 다중 노드 읽기(ROX)를, 공유 파일 시스템은 다중 노드 읽기/쓰기(RWX)를 요구한다. 접근 모드를 명시적으로 선언함으로써 스토리지의 올바른 사용을 보장하고, 동시 접근으로 인한 데이터 손상을 방지한다.
</details>

---

### 문제 9.
Kubernetes에서 기본으로 생성되는 네임스페이스가 아닌 것은?

A) default
B) kube-system
C) kube-public
D) kube-apps

<details>
<summary>정답 확인</summary>

**정답: D) kube-apps ✅**

Kubernetes가 기본으로 생성하는 네임스페이스는 `default`, `kube-system`, `kube-public`, `kube-node-lease` 4가지이다. `kube-apps`라는 네임스페이스는 기본으로 존재하지 않는다. kube-system에는 시스템 컴포넌트가, kube-public에는 공개 데이터가, kube-node-lease에는 노드 하트비트 관련 Lease 오브젝트가 저장된다.

**검증:**
```bash
# 기본 네임스페이스 목록 확인
kubectl get namespaces

# kube-apps 네임스페이스 존재 여부 확인
kubectl get namespace kube-apps

# 각 네임스페이스의 리소스 확인
kubectl get all -n kube-system
kubectl get all -n kube-public
kubectl get lease -n kube-node-lease
```
```text
# kubectl get namespaces 기대 출력
NAME              STATUS   AGE
default           Active   5d
kube-node-lease   Active   5d
kube-public       Active   5d
kube-system       Active   5d

# kubectl get namespace kube-apps 기대 출력
Error from server (NotFound): namespaces "kube-apps" not found

# kube-node-lease 기대 출력
NAME       HOLDER     AGE
worker-1   worker-1   5d
worker-2   worker-2   5d
```

**오답 분석:**
- A) default: 기본 네임스페이스이다. 네임스페이스를 지정하지 않고 리소스를 생성하면 여기에 배치된다.
- B) kube-system: Kubernetes 시스템 컴포넌트(kube-apiserver, kube-scheduler, coredns, kube-proxy 등)가 실행되는 네임스페이스이다.
- C) kube-public: 모든 사용자(인증되지 않은 사용자 포함)가 읽을 수 있는 네임스페이스이다. cluster-info ConfigMap이 저장되며, 클러스터 부트스트랩 시 사용된다.

**내부 동작 원리:**
네임스페이스는 Kubernetes의 논리적 격리 단위이다. 동일한 물리 클러스터 내에서 리소스 이름 충돌을 방지하고, RBAC과 결합하여 접근 제어를, ResourceQuota와 결합하여 리소스 사용량 제한을 적용한다. kube-node-lease 네임스페이스의 Lease 오브젝트는 kubelet이 주기적으로(기본 10초) 갱신하여 노드 하트비트를 API 서버에 보고하는 경량 메커니즘이다. 이전에는 Node 오브젝트 전체를 업데이트했으나, Lease 도입으로 etcd 부하가 크게 감소하였다.

**CNCF 생태계 맥락:**
네임스페이스 기반 멀티테넌시는 Kubernetes의 핵심 패턴이다. Hierarchical Namespace Controller(HNC)는 네임스페이스 계층 구조를 지원한다. vCluster는 네임스페이스 내에 가상 클러스터를 생성하여 더 강력한 격리를 제공한다. CNCF 프로젝트들(Prometheus, ArgoCD 등)은 일반적으로 자체 네임스페이스(monitoring, argocd 등)에 설치된다.

**등장 배경:**
단일 클러스터에서 여러 팀이나 프로젝트가 리소스를 공유하면 이름 충돌과 권한 관리가 복잡해진다. 네임스페이스는 클러스터를 논리적으로 분할하여 팀별/환경별 격리를 제공한다. kube-node-lease는 v1.14에서 도입되었는데, 대규모 클러스터에서 Node 오브젝트 업데이트로 인한 etcd 쓰기 부하를 줄이기 위해 경량 Lease 오브젝트로 하트비트를 분리한 것이다.
</details>

---

### 문제 10.
Deployment의 롤링 업데이트 전략에서 `maxSurge: 1`과 `maxUnavailable: 0`으로 설정한 경우, 어떤 동작을 하는가?

A) 기존 Pod를 모두 삭제한 후 새 Pod를 생성한다
B) 새 Pod를 하나 추가 생성한 후 이전 Pod를 하나 삭제하는 방식으로 진행한다
C) 이전 Pod를 하나 삭제한 후 새 Pod를 하나 생성하는 방식으로 진행한다
D) 모든 새 Pod를 동시에 생성한다

<details>
<summary>정답 확인</summary>

**정답: B) 새 Pod를 하나 추가 생성한 후 이전 Pod를 하나 삭제하는 방식으로 진행한다 ✅**

`maxSurge: 1`은 원하는 복제본 수보다 최대 1개까지 추가 Pod를 생성할 수 있다는 의미이다. `maxUnavailable: 0`은 업데이트 중에 사용 불가능한 Pod가 없어야 한다는 의미이다. 따라서 새 Pod를 먼저 1개 생성하고, 해당 Pod가 준비되면 이전 Pod를 1개 삭제하는 방식으로 무중단 배포를 진행한다.

**검증:**
```bash
# Deployment의 롤링 업데이트 전략 확인
kubectl get deployment my-app -o jsonpath='{.spec.strategy}'

# 롤링 업데이트 진행 중 상태 확인
kubectl rollout status deployment my-app

# 업데이트 중 Pod 수 변화 확인 (replicas=3일 때)
kubectl get pods -l app=my-app -w

# 롤아웃 히스토리 확인
kubectl rollout history deployment my-app
```
```text
# strategy 기대 출력
{"rollingUpdate":{"maxSurge":1,"maxUnavailable":0},"type":"RollingUpdate"}

# rollout status 기대 출력
Waiting for deployment "my-app" rollout to finish: 1 out of 3 new replicas have been updated...
Waiting for deployment "my-app" rollout to finish: 2 out of 3 new replicas have been updated...
deployment "my-app" successfully rolled out

# kubectl get pods -w 기대 출력 (replicas=3 기준, 순서 관찰)
my-app-v2-xxxxx   0/1   ContainerCreating   0   0s    # 새 Pod 1개 추가 생성 (총 4개)
my-app-v2-xxxxx   1/1   Running             0   5s    # 새 Pod Ready
my-app-v1-yyyyy   1/1   Terminating         0   10m   # 이전 Pod 1개 삭제 (총 3개)
```

**오답 분석:**
- A) 기존 Pod를 모두 삭제한 후 새 Pod를 생성한다: Recreate 전략의 설명이다. `strategy.type: Recreate`로 설정하면 모든 기존 Pod를 먼저 삭제하고 새 Pod를 생성하므로 다운타임이 발생한다.
- C) 이전 Pod를 하나 삭제한 후 새 Pod를 하나 생성한다: `maxUnavailable: 1`, `maxSurge: 0`인 경우에 해당한다. 먼저 삭제 후 생성하므로 순간적으로 가용 Pod 수가 줄어든다.
- D) 모든 새 Pod를 동시에 생성한다: maxSurge가 replicas 수만큼 설정된 경우에만 가능하며, `maxSurge: 1`과는 맞지 않는다.

**내부 동작 원리:**
Deployment 컨트롤러는 업데이트 시 새로운 ReplicaSet을 생성한다. `maxSurge: 1, maxUnavailable: 0`이고 replicas=3인 경우, 새 ReplicaSet의 replicas를 1로 올리면 총 Pod가 4개가 된다. 새 Pod가 Ready 상태가 되면 이전 ReplicaSet의 replicas를 2로 줄인다. 이 과정을 반복하여 새 ReplicaSet=3, 이전 ReplicaSet=0이 될 때까지 진행한다. 이 방식은 항상 3개 이상의 Ready Pod를 유지하므로 무중단 배포가 보장된다.

**CNCF 생태계 맥락:**
Kubernetes의 기본 롤링 업데이트는 단순한 배포 전략이다. 더 정교한 배포(카나리, 블루/그린, A/B 테스트)를 위해 Argo Rollouts이나 Flagger(CNCF 인큐베이팅 Flux 프로젝트의 일부)가 사용된다. 이들은 메트릭 기반 자동 프로모션/롤백을 지원한다.

**등장 배경:**
애플리케이션 업데이트 시 전체 인스턴스를 동시에 교체하면 다운타임이 발생한다. 롤링 업데이트는 점진적으로 인스턴스를 교체하여 서비스 중단 없이 배포를 완료한다. maxSurge와 maxUnavailable 파라미터를 통해 배포 속도와 가용성 간의 트레이드오프를 세밀하게 제어할 수 있다.
</details>

---

### 문제 11.
다음 중 DaemonSet의 주요 사용 사례가 아닌 것은?

A) 각 노드에서 로그 수집 에이전트 실행
B) 각 노드에서 모니터링 에이전트 실행
C) 웹 애플리케이션의 복제본을 3개 실행
D) 각 노드에서 네트워크 플러그인 실행

<details>
<summary>정답 확인</summary>

**정답: C) 웹 애플리케이션의 복제본을 3개 실행 ✅**

DaemonSet은 모든(또는 특정) 노드에 Pod를 하나씩 실행하도록 보장하는 리소스이다. 로그 수집(fluentd), 모니터링(node-exporter), 네트워크 플러그인(calico) 등 각 노드에 반드시 하나씩 실행해야 하는 작업에 적합하다. 특정 수의 복제본을 실행하는 것은 Deployment의 역할이다.

**검증:**
```bash
# 클러스터에 존재하는 DaemonSet 확인
kubectl get daemonsets -A

# 특정 DaemonSet의 Pod가 모든 노드에 배포되었는지 확인
kubectl get pods -n kube-system -l k8s-app=kube-proxy -o wide

# DaemonSet 상세 정보 (DESIRED=노드 수와 동일해야 함)
kubectl get ds -n kube-system
```
```text
# kubectl get daemonsets -A 기대 출력
NAMESPACE     NAME          DESIRED   CURRENT   READY   UP-TO-DATE   AVAILABLE
kube-system   kube-proxy    3         3         3       3            3
kube-system   calico-node   3         3         3       3            3

# kubectl get pods -o wide 기대 출력
NAME                READY   STATUS    NODE
kube-proxy-abc12    1/1     Running   control-plane
kube-proxy-def34    1/1     Running   worker-1
kube-proxy-ghi56    1/1     Running   worker-2
```

**오답 분석:**
- A) 각 노드에서 로그 수집 에이전트 실행: DaemonSet의 대표적 사용 사례이다. Fluentd, Fluent Bit, Filebeat 등 로그 수집기를 모든 노드에 배포하여 해당 노드의 로그를 수집한다.
- B) 각 노드에서 모니터링 에이전트 실행: DaemonSet의 대표적 사용 사례이다. Prometheus node-exporter를 모든 노드에 배포하여 노드 수준 메트릭(CPU, 메모리, 디스크 등)을 수집한다.
- D) 각 노드에서 네트워크 플러그인 실행: DaemonSet의 대표적 사용 사례이다. Calico, Cilium, Flannel 등 CNI 플러그인은 각 노드에서 실행되어 Pod 네트워킹을 구성한다.

**내부 동작 원리:**
DaemonSet 컨트롤러는 클러스터의 노드 목록을 watch한다. 새 노드가 추가되면 해당 노드에 Pod를 자동 생성하고, 노드가 제거되면 Pod도 함께 정리된다. nodeSelector나 nodeAffinity를 사용하여 특정 노드에만 배포할 수도 있다. DaemonSet의 Pod는 스케줄러를 거치지 않고(v1.12부터는 기본 스케줄러 사용) 노드에 직접 할당되며, tolerations를 통해 taint가 적용된 노드에도 배포 가능하다.

**CNCF 생태계 맥락:**
대부분의 CNCF 인프라 도구가 DaemonSet으로 배포된다. Fluentd/Fluent Bit(로그 수집), Prometheus node-exporter(메트릭), Falco(런타임 보안), Cilium/Calico(네트워킹), OpenTelemetry Collector(텔레메트리) 등이 대표적이다. 이들은 노드 수준의 정보에 접근해야 하므로 모든 노드에 존재해야 한다.

**등장 배경:**
클러스터의 모든 노드에서 특정 에이전트를 실행해야 하는 요구사항은 Deployment로는 정확히 충족할 수 없다. Deployment는 "N개의 복제본"을 유지하지만, 어느 노드에 배치될지 보장하지 않는다. DaemonSet은 "모든 노드에 정확히 하나씩"이라는 시맨틱을 제공하여, 노드 수준 인프라 에이전트 배포 패턴을 공식적으로 지원한다.
</details>

---

### 문제 12.
`kubectl explain pod.spec.containers`와 동일한 결과를 얻을 수 있는 설명은?

A) Pod의 상태 정보를 조회한다
B) Pod의 spec.containers 필드에 대한 문서와 하위 필드를 확인한다
C) 실행 중인 모든 Pod의 컨테이너 목록을 조회한다
D) Pod 내 컨테이너의 로그를 조회한다

<details>
<summary>정답 확인</summary>

**정답: B) Pod의 spec.containers 필드에 대한 문서와 하위 필드를 확인한다 ✅**

`kubectl explain`은 API 리소스의 필드에 대한 문서를 조회하는 명령어이다. `kubectl explain pod.spec.containers`는 Pod의 spec.containers 필드가 어떤 타입인지, 어떤 하위 필드가 있는지, 각 필드의 설명을 보여준다. YAML을 작성할 때 필드 이름이나 용도를 확인하는 데 매우 유용하다.

**검증:**
```bash
# Pod의 spec.containers 필드 문서 조회
kubectl explain pod.spec.containers

# 재귀적으로 모든 하위 필드까지 확인
kubectl explain pod.spec.containers --recursive

# 특정 하위 필드 문서 확인
kubectl explain pod.spec.containers.resources
```
```text
# kubectl explain pod.spec.containers 기대 출력
KIND:     Pod
VERSION:  v1

RESOURCE: containers <[]Container>

DESCRIPTION:
     List of containers belonging to the pod. Containers cannot currently be
     added or removed. There must be at least one container in a Pod. Cannot be
     updated.

FIELDS:
   args         <[]string>
   command      <[]string>
   env          <[]EnvVar>
   image        <string>
   imagePullPolicy  <string>
   name         <string> -required-
   ports        <[]ContainerPort>
   resources    <ResourceRequirements>
   volumeMounts <[]VolumeMount>
   ...
```

**오답 분석:**
- A) Pod의 상태 정보를 조회한다: `kubectl describe pod <name>` 또는 `kubectl get pod <name> -o yaml`의 설명이다. explain은 실제 리소스 인스턴스가 아닌 API 스키마 문서를 보여준다.
- C) 실행 중인 모든 Pod의 컨테이너 목록을 조회한다: `kubectl get pods -o jsonpath='{.items[*].spec.containers[*].name}'`과 같은 명령의 설명이다. explain은 클러스터의 실제 리소스를 조회하지 않는다.
- D) Pod 내 컨테이너의 로그를 조회한다: `kubectl logs <pod-name> [-c container-name]`의 설명이다.

**내부 동작 원리:**
`kubectl explain`은 kube-apiserver의 OpenAPI(Swagger) 엔드포인트에서 API 스키마 정보를 가져온다. API 서버는 `/openapi/v2` 또는 `/openapi/v3` 경로에서 전체 API 스키마를 제공하며, explain 명령은 이 스키마에서 지정된 리소스 경로의 필드 정의, 타입, 설명을 추출하여 표시한다. `--api-version` 플래그로 특정 API 버전의 스키마를 조회할 수도 있다.

**CNCF 생태계 맥락:**
kubectl은 Kubernetes의 공식 CLI 도구이다. explain 명령은 CKA/CKAD/CKS 시험 환경에서 공식 문서 대신 API 필드를 확인하는 데 매우 유용하다. Custom Resource Definition(CRD)을 사용하는 CNCF 프로젝트들(Istio VirtualService, ArgoCD Application 등)도 스키마를 정의하면 explain으로 조회할 수 있다.

**등장 배경:**
Kubernetes YAML 매니페스트를 작성할 때 필드 이름, 타입, 필수 여부를 매번 공식 문서에서 찾는 것은 비효율적이다. explain은 CLI에서 직접 API 스키마를 조회할 수 있게 하여, 오프라인 환경이나 시험 환경에서도 정확한 YAML을 작성할 수 있도록 지원한다.
</details>

---

### 문제 13.
Secret에 대한 설명으로 올바른 것은?

A) Secret의 데이터는 기본적으로 AES-256으로 암호화되어 etcd에 저장된다
B) Secret은 Base64로 인코딩되어 저장되며, 이것만으로는 암호화가 아니다
C) Secret은 ConfigMap과 달리 볼륨으로 마운트할 수 없다
D) Secret의 최대 크기는 10MiB이다

<details>
<summary>정답 확인</summary>

**정답: B) Secret은 Base64로 인코딩되어 저장되며, 이것만으로는 암호화가 아니다 ✅**

Kubernetes Secret은 기본적으로 Base64 인코딩만 적용되어 etcd에 저장된다. Base64는 인코딩이지 암호화가 아니므로, 진정한 보안을 위해서는 EncryptionConfiguration을 통한 etcd 암호화 설정이나 외부 비밀 관리 도구(Vault 등)를 사용해야 한다. Secret도 ConfigMap과 마찬가지로 환경 변수나 볼륨으로 마운트할 수 있으며, 최대 크기는 1MiB이다.

**검증:**
```bash
# Secret 생성
kubectl create secret generic db-creds --from-literal=password=myS3cretP@ss

# Secret의 Base64 인코딩된 값 확인
kubectl get secret db-creds -o jsonpath='{.data.password}'

# Base64 디코딩으로 원본 값 복원 (암호화가 아님을 증명)
kubectl get secret db-creds -o jsonpath='{.data.password}' | base64 -d

# etcd 암호화 설정 여부 확인 (kubeadm 클러스터 기준)
kubectl -n kube-system get pod kube-apiserver-<control-plane> -o yaml | grep encryption-provider-config
```
```text
# Base64 인코딩된 값 기대 출력
bXlTM2NyZXRQQHNz

# Base64 디코딩 기대 출력
myS3cretP@ss

# 암호화 미설정 시 기대 출력 (출력 없음)
# 암호화 설정 시 기대 출력
    - --encryption-provider-config=/etc/kubernetes/enc/enc.yaml
```

**오답 분석:**
- A) Secret의 데이터는 기본적으로 AES-256으로 암호화되어 etcd에 저장된다: 기본 설정에서는 암호화되지 않는다. EncryptionConfiguration을 명시적으로 설정해야 AES-CBC, AES-GCM, secretbox 등의 암호화가 적용된다.
- C) Secret은 ConfigMap과 달리 볼륨으로 마운트할 수 없다: Secret도 볼륨으로 마운트 가능하다. 볼륨 마운트 시 tmpfs(메모리 파일 시스템)에 저장되어 디스크에 기록되지 않는다.
- D) Secret의 최대 크기는 10MiB이다: Secret의 최대 크기는 ConfigMap과 동일하게 1MiB이다.

**내부 동작 원리:**
Secret 생성 시 사용자가 제공한 데이터는 kubectl에 의해 Base64로 인코딩된 후 API 서버에 전달된다. API 서버는 이를 etcd에 저장한다. EncryptionConfiguration이 설정된 경우, API 서버가 etcd에 쓰기 전에 지정된 알고리즘으로 암호화한다. Secret을 볼륨으로 마운트하면 kubelet이 tmpfs에 파일을 생성하고, Pod 삭제 시 함께 정리된다. `stringData` 필드를 사용하면 인코딩 없이 평문으로 Secret을 작성할 수 있으며, API 서버가 자동으로 Base64 인코딩한다.

**CNCF 생태계 맥락:**
Kubernetes 기본 Secret의 보안 한계를 보완하기 위해 여러 프로젝트가 존재한다. HashiCorp Vault는 동적 시크릿 생성과 자동 로테이션을 지원한다. External Secrets Operator는 AWS Secrets Manager, GCP Secret Manager 등 외부 시크릿 저장소와 Kubernetes Secret을 동기화한다. Sealed Secrets(Bitnami)는 Git에 암호화된 시크릿을 안전하게 저장할 수 있게 한다.

**등장 배경:**
애플리케이션 코드나 컨테이너 이미지에 데이터베이스 비밀번호, API 키 같은 민감 정보를 하드코딩하면 보안 위험이 크다. Secret은 민감 데이터를 별도 리소스로 분리하여 관리하고, RBAC으로 접근 제어를 적용할 수 있게 한다. 다만 기본 Base64 인코딩만으로는 진정한 보안이 아니므로, etcd 암호화 설정이나 외부 비밀 관리 도구와의 연동이 필수적이다.
</details>

---

### 문제 14.
Kubernetes에서 Pod 간 네트워크 트래픽을 제어하는 리소스는?

A) Ingress
B) Service
C) NetworkPolicy
D) EndpointSlice

<details>
<summary>정답 확인</summary>

**정답: C) NetworkPolicy ✅**

NetworkPolicy는 Pod 간 또는 Pod와 외부 간의 네트워크 트래픽을 제어하는 리소스이다. 기본적으로 K8s의 모든 Pod는 서로 통신이 가능하지만, NetworkPolicy를 통해 인그레스(수신)와 이그레스(송신) 규칙을 정의하여 트래픽을 제한할 수 있다. 단, CNI 플러그인이 NetworkPolicy를 지원해야 동작한다 (Calico, Cilium 등).

**검증:**
```bash
# default 네임스페이스의 모든 인그레스를 차단하는 NetworkPolicy 생성
kubectl apply -f - <<EOF
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: deny-all-ingress
  namespace: default
spec:
  podSelector: {}
  policyTypes:
  - Ingress
EOF

# NetworkPolicy 확인
kubectl get networkpolicy

# NetworkPolicy 상세 정보
kubectl describe networkpolicy deny-all-ingress

# 통신 차단 테스트
kubectl exec curl-pod -- curl --connect-timeout 3 http://nginx-svc
```
```text
# kubectl get networkpolicy 기대 출력
NAME                POD-SELECTOR   AGE
deny-all-ingress    <none>         5s

# curl 테스트 기대 출력 (차단된 경우)
curl: (28) Connection timed out after 3000 milliseconds
```

**오답 분석:**
- A) Ingress: 클러스터 외부에서 내부 서비스로의 HTTP/HTTPS 라우팅 규칙을 정의한다. Pod 간 네트워크 트래픽 제어가 아니라 외부 트래픽의 L7 라우팅을 담당한다.
- B) Service: Pod 집합에 대한 안정적인 네트워크 엔드포인트와 로드밸런싱을 제공한다. 트래픽 제어(허용/차단)가 아니라 트래픽 라우팅을 담당한다.
- D) EndpointSlice: Service에 연결된 Pod의 IP/포트 정보를 저장하는 리소스이다. 트래픽 제어와 무관하며, Service의 백엔드 Pod 목록을 관리하는 데이터 구조이다.

**내부 동작 원리:**
NetworkPolicy는 podSelector로 대상 Pod를 선택하고, ingress/egress 규칙에서 허용할 소스/대상을 podSelector, namespaceSelector, ipBlock으로 지정한다. CNI 플러그인(Calico, Cilium)이 이 정책을 노드의 iptables 규칙 또는 eBPF 프로그램으로 변환하여 적용한다. 정책이 하나라도 적용된 Pod는 기본적으로 해당 방향의 트래픽이 모두 차단되고, 규칙에 명시된 트래픽만 허용되는 화이트리스트 방식으로 동작한다.

**CNCF 생태계 맥락:**
Kubernetes 기본 NetworkPolicy는 L3/L4 수준의 제어만 지원한다. Cilium(CNCF 졸업)은 CiliumNetworkPolicy CRD를 통해 L7(HTTP, gRPC, Kafka) 수준의 정밀한 트래픽 제어를 제공한다. Calico(CNCF 인큐베이팅 후보)는 GlobalNetworkPolicy로 클러스터 전체에 적용되는 정책을 지원한다. Istio의 AuthorizationPolicy도 서비스 메시 수준에서 유사한 기능을 제공한다.

**등장 배경:**
Kubernetes의 기본 네트워크 모델은 모든 Pod 간 통신을 허용(flat network)한다. 이는 개발 편의성에는 좋지만 보안상 위험하다. 한 Pod가 침해되면 클러스터 내 모든 서비스에 접근 가능하기 때문이다. NetworkPolicy는 최소 권한 원칙(Principle of Least Privilege)을 네트워크 수준에서 적용하여, 필요한 통신만 허용하는 마이크로세그멘테이션(micro-segmentation)을 구현한다.
</details>

---

### 문제 15.
kubelet에 대한 설명으로 올바르지 않은 것은?

A) 각 워커 노드에서 실행되는 에이전트이다
B) 컨테이너 런타임과 통신하여 컨테이너 생명주기를 관리한다
C) etcd에 직접 접근하여 Pod 정보를 읽어온다
D) 컨테이너의 Liveness/Readiness Probe를 실행한다

<details>
<summary>정답 확인</summary>

**정답: C) etcd에 직접 접근하여 Pod 정보를 읽어온다 ✅**

kubelet은 etcd에 직접 접근하지 않는다. etcd와 직접 통신하는 유일한 컴포넌트는 kube-apiserver이다. kubelet은 kube-apiserver로부터 PodSpec을 수신하고, 해당 명세에 따라 컨테이너가 정상적으로 실행되는지 확인한다. 또한 노드 상태를 주기적으로 API 서버에 보고한다.

**검증:**
```bash
# kubelet 프로세스 확인 (워커 노드에서)
systemctl status kubelet

# kubelet의 설정에서 API 서버 주소 확인 (etcd 주소 없음)
kubectl get nodes -o jsonpath='{.items[0].status.addresses}'

# kubelet이 관리하는 Pod 확인
kubectl get pods --field-selector spec.nodeName=<node-name>

# kubelet 로그 확인 (API 서버와의 통신 확인)
journalctl -u kubelet --no-pager | tail -10
```
```text
# systemctl status kubelet 기대 출력
● kubelet.service - kubelet: The Kubernetes Node Agent
   Loaded: loaded (/usr/lib/systemd/system/kubelet.service; enabled)
   Active: active (running) since ...
   Main PID: 1234 (kubelet)

# journalctl 기대 출력 (API 서버와 통신하는 로그)
kubelet: Successfully registered node worker-1
kubelet: Starting to sync pod status with apiserver
```

**오답 분석:**
- A) 각 워커 노드에서 실행되는 에이전트이다: 맞는 설명이다. kubelet은 모든 노드(컨트롤 플레인 포함)에서 systemd 서비스로 실행된다. Kubernetes 컴포넌트 중 유일하게 컨테이너가 아닌 호스트 프로세스로 실행된다.
- B) 컨테이너 런타임과 통신하여 컨테이너 생명주기를 관리한다: 맞는 설명이다. kubelet은 CRI(Container Runtime Interface)를 통해 containerd/CRI-O와 gRPC로 통신하여 컨테이너를 생성/시작/중지/삭제한다.
- D) 컨테이너의 Liveness/Readiness Probe를 실행한다: 맞는 설명이다. kubelet은 주기적으로 HTTP GET, TCP Socket, exec 방식의 프로브를 실행하여 컨테이너 상태를 확인한다.

**내부 동작 원리:**
kubelet은 kube-apiserver에 watch 연결을 유지하여, 자신의 노드에 할당된 Pod의 PodSpec 변경을 실시간으로 수신한다. PodSpec을 받으면 CRI를 통해 컨테이너 런타임에게 컨테이너 생성을 요청하고, CNI를 통해 네트워크를 설정하며, CSI를 통해 볼륨을 마운트한다. 주기적으로 노드 상태(Conditions: Ready, MemoryPressure, DiskPressure 등)와 리소스 사용량을 API 서버에 보고한다. 이 보고가 중단되면 Node 컨트롤러가 노드를 NotReady로 표시한다.

**CNCF 생태계 맥락:**
kubelet은 Kubernetes 코어 컴포넌트이며, CRI/CNI/CSI 세 가지 플러그인 인터페이스의 소비자이다. CRI 호환 런타임(containerd, CRI-O), CNI 플러그인(Calico, Cilium, Flannel), CSI 드라이버(Rook-Ceph, Longhorn) 등 CNCF 프로젝트들이 이 인터페이스를 통해 kubelet과 통합된다.

**등장 배경:**
컨테이너 오케스트레이터가 각 노드에서 컨테이너를 실행하고 관리하려면 노드 수준의 에이전트가 필요하다. kubelet은 "선언된 상태(PodSpec)를 실제 상태로 만드는" 역할을 노드에서 수행한다. API 서버를 통해서만 etcd에 접근하는 구조는 보안과 일관성을 보장한다. 모든 컴포넌트가 etcd에 직접 접근하면 데이터 무결성 유지가 불가능하기 때문이다.
</details>

---

### 문제 16.
RBAC에서 특정 네임스페이스 내의 권한을 정의하는 리소스는?

A) ClusterRole
B) Role
C) ClusterRoleBinding
D) ServiceAccount

<details>
<summary>정답 확인</summary>

**정답: B) Role ✅**

Role은 특정 네임스페이스 내에서의 권한(어떤 리소스에 어떤 동작을 허용할지)을 정의하는 리소스이다. ClusterRole은 클러스터 전체에 적용되는 권한을 정의한다. Role을 실제 사용자나 서비스 어카운트에 연결하려면 RoleBinding을 사용해야 한다.

**검증:**
```bash
# Role 생성 (default 네임스페이스에서 pods 읽기 권한)
kubectl create role pod-reader --verb=get,list,watch --resource=pods -n default

# Role 확인
kubectl get role pod-reader -n default -o yaml

# RoleBinding 생성 (user에게 Role 연결)
kubectl create rolebinding read-pods --role=pod-reader --user=jane -n default

# 권한 테스트
kubectl auth can-i list pods -n default --as=jane
kubectl auth can-i list pods -n kube-system --as=jane
```
```text
# kubectl get role 기대 출력
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: pod-reader
  namespace: default
rules:
- apiGroups: [""]
  resources: ["pods"]
  verbs: ["get", "list", "watch"]

# can-i list pods default 기대 출력
yes

# can-i list pods kube-system 기대 출력 (다른 네임스페이스이므로)
no
```

**오답 분석:**
- A) ClusterRole: 클러스터 전체 범위에서 권한을 정의한다. 네임스페이스에 속하지 않는 리소스(nodes, namespaces, persistentvolumes)에 대한 권한이나 모든 네임스페이스에 걸친 권한을 정의할 때 사용한다.
- C) ClusterRoleBinding: ClusterRole을 사용자/그룹/서비스 어카운트에 연결하는 리소스이다. 권한을 정의하는 것이 아니라 연결(바인딩)하는 역할이다.
- D) ServiceAccount: Pod가 API 서버에 인증할 때 사용하는 ID이다. 권한 자체를 정의하지 않으며, RoleBinding이나 ClusterRoleBinding을 통해 Role/ClusterRole의 권한을 부여받는다.

**내부 동작 원리:**
RBAC 인가 과정은 다음과 같다. (1) 요청자의 인증 정보(사용자, 그룹, ServiceAccount)가 확인된다. (2) RBAC 인가 모듈이 RoleBinding/ClusterRoleBinding을 조회하여 요청자에게 연결된 Role/ClusterRole을 찾는다. (3) Role의 rules에서 요청된 리소스(resource)와 동작(verb)이 허용되는지 확인한다. 허용하는 규칙이 하나라도 있으면 승인되고, 없으면 거부된다. RBAC은 기본적으로 거부(deny-by-default)이며 명시적 허용만 가능하다.

**CNCF 생태계 맥락:**
RBAC은 Kubernetes의 기본 인가 메커니즘이다. Helm Chart들은 ServiceAccount와 함께 필요한 Role/ClusterRole을 자동 생성한다. ArgoCD, Prometheus Operator 등 CNCF 프로젝트들은 설치 시 필요한 RBAC 리소스를 함께 배포한다. OPA/Gatekeeper(CNCF 졸업)는 RBAC을 넘어 정책 기반의 더 세밀한 접근 제어를 제공한다.

**등장 배경:**
초기 Kubernetes는 ABAC(Attribute-Based Access Control)를 사용했으나, 정책 파일을 수정하려면 API 서버를 재시작해야 하는 한계가 있었다. RBAC은 API 리소스(Role, RoleBinding)로 권한을 동적으로 관리할 수 있어 운영 편의성이 크게 향상되었다. v1.8부터 기본 인가 모드로 채택되었다.
</details>

---

### 문제 17.
Ingress에 대한 설명으로 올바르지 않은 것은?

A) 클러스터 외부에서 내부 서비스로의 HTTP/HTTPS 라우팅을 정의한다
B) Ingress 리소스만 생성하면 자동으로 동작한다
C) 하나의 IP로 여러 서비스에 대한 라우팅이 가능하다
D) TLS 종료를 처리할 수 있다

<details>
<summary>정답 확인</summary>

**정답: B) Ingress 리소스만 생성하면 자동으로 동작한다 ✅**

Ingress 리소스만으로는 동작하지 않으며, 반드시 Ingress Controller(NGINX Ingress Controller, Traefik 등)가 클러스터에 설치되어 있어야 한다. Ingress Controller가 Ingress 리소스를 감시하고 실제 라우팅 규칙을 구성한다.

**검증:**
```bash
# Ingress Controller 존재 여부 확인
kubectl get pods -n ingress-nginx
kubectl get ingressclass

# Ingress 리소스 확인
kubectl get ingress

# Ingress 상세 정보 (라우팅 규칙 확인)
kubectl describe ingress <ingress-name>
```
```text
# kubectl get ingressclass 기대 출력
NAME    CONTROLLER                     PARAMETERS   AGE
nginx   k8s.io/ingress-nginx           <none>       5d

# kubectl get ingress 기대 출력
NAME       CLASS   HOSTS           ADDRESS        PORTS     AGE
my-app     nginx   app.example.com 192.168.1.100  80, 443   1d

# describe ingress 기대 출력
Rules:
  Host              Path  Backends
  ----              ----  --------
  app.example.com
                    /api    api-svc:8080 (10.244.1.5:8080,10.244.2.3:8080)
                    /       web-svc:80 (10.244.1.6:80)
```

**오답 분석:**
- A) 클러스터 외부에서 내부 서비스로의 HTTP/HTTPS 라우팅을 정의한다: 맞는 설명이다. Ingress는 호스트명과 URL 경로 기반으로 L7 라우팅 규칙을 정의한다.
- C) 하나의 IP로 여러 서비스에 대한 라우팅이 가능하다: 맞는 설명이다. 호스트 기반(app1.example.com, app2.example.com) 또는 경로 기반(/api, /web) 라우팅으로 단일 IP에서 다중 서비스를 제공할 수 있다.
- D) TLS 종료를 처리할 수 있다: 맞는 설명이다. Ingress의 tls 섹션에 Secret(인증서)을 지정하여 HTTPS 요청을 복호화하고, 백엔드 서비스에는 HTTP로 전달할 수 있다.

**내부 동작 원리:**
Ingress Controller는 kube-apiserver를 watch하여 Ingress 리소스 변경을 감지한다. NGINX Ingress Controller의 경우, Ingress 규칙을 nginx.conf 설정으로 변환하고 NGINX를 reload한다. IngressClass 리소스를 통해 여러 Ingress Controller가 공존할 수 있으며, Ingress의 `ingressClassName` 필드로 어느 컨트롤러가 처리할지 지정한다. Kubernetes v1.19부터 Gateway API가 Ingress의 후속으로 개발되고 있다.

**CNCF 생태계 맥락:**
NGINX Ingress Controller, Traefik, Contour(CNCF 인큐베이팅), Emissary-ingress(CNCF 인큐베이팅)가 대표적인 Ingress Controller이다. Gateway API는 Ingress의 한계(L4 미지원, 역할 분리 부족 등)를 극복하기 위한 차세대 표준으로, Kubernetes SIG-Network에서 개발 중이며 Istio, Cilium, Contour 등이 지원한다.

**등장 배경:**
각 서비스마다 LoadBalancer를 생성하면 IP 주소와 비용이 낭비된다. Ingress는 하나의 로드밸런서 뒤에서 L7 라우팅을 수행하여 여러 서비스를 효율적으로 외부에 노출한다. 리소스(규칙 정의)와 컨트롤러(규칙 실행)를 분리한 설계는 Kubernetes의 선언적 모델을 따르며, 다양한 프록시 구현체를 플러그인 방식으로 지원할 수 있게 한다.
</details>

---

### 문제 18.
다음 중 Job 리소스에서 `restartPolicy`로 허용되는 값은?

A) Always, Never
B) Never, OnFailure
C) Always, OnFailure
D) Always, Never, OnFailure

<details>
<summary>정답 확인</summary>

**정답: B) Never, OnFailure ✅**

Job에서는 `restartPolicy`로 `Never` 또는 `OnFailure`만 허용된다. `Always`는 Job에서 사용할 수 없다. `Never`로 설정하면 실패 시 새 Pod를 생성하고, `OnFailure`로 설정하면 같은 Pod 내에서 컨테이너를 재시작한다. 일반 Pod의 기본 restartPolicy는 `Always`이다.

**검증:**
```bash
# Job 생성 (restartPolicy: Never)
kubectl create job test-job --image=busybox -- sh -c "echo hello && exit 0"

# Job 상태 확인
kubectl get jobs

# Job의 restartPolicy 확인
kubectl get job test-job -o jsonpath='{.spec.template.spec.restartPolicy}'

# Always로 설정 시도 시 에러 확인
kubectl apply -f - <<EOF
apiVersion: batch/v1
kind: Job
metadata:
  name: bad-job
spec:
  template:
    spec:
      containers:
      - name: test
        image: busybox
      restartPolicy: Always
EOF
```
```text
# kubectl get jobs 기대 출력
NAME       COMPLETIONS   DURATION   AGE
test-job   1/1           5s         10s

# restartPolicy 기대 출력
Never

# Always 설정 시 에러 기대 출력
The Job "bad-job" is invalid: spec.template.spec.restartPolicy: Invalid value: "Always": must be "Never" or "OnFailure"
```

**오답 분석:**
- A) Always, Never: Always는 Job에서 허용되지 않는다. Always를 사용하면 Job이 완료되더라도 Pod가 계속 재시작되어 Job의 "완료 후 종료" 시맨틱과 모순된다.
- C) Always, OnFailure: Always는 Job에서 허용되지 않는다.
- D) Always, Never, OnFailure: Always가 포함되어 있으므로 오답이다.

**내부 동작 원리:**
Job 컨트롤러는 Pod의 완료 상태를 추적한다. `restartPolicy: Never`인 경우, 컨테이너가 실패하면 Pod는 Failed 상태로 남고 Job 컨트롤러가 새 Pod를 생성한다. `backoffLimit`(기본 6)까지 재시도한다. `restartPolicy: OnFailure`인 경우, kubelet이 동일 Pod 내에서 컨테이너를 재시작하므로 Pod 수는 증가하지 않지만, 재시작 간격이 지수적으로 증가(exponential backoff: 10s, 20s, 40s, ..., 최대 300s)한다.

**CNCF 생태계 맥락:**
Job/CronJob은 Kubernetes 코어 리소스이다. Argo Workflows(CNCF 인큐베이팅)는 Job 기반의 복잡한 워크플로우(DAG, 단계별 실행)를 지원한다. Volcano(CNCF 인큐베이팅)는 배치 워크로드와 ML 학습 작업을 위한 고급 Job 스케줄링을 제공한다. Tekton(CD Foundation)은 CI/CD 파이프라인을 Kubernetes Job 기반으로 실행한다.

**등장 배경:**
Deployment는 "항상 실행 중"인 워크로드에 적합하지만, 데이터 마이그레이션, 배치 처리, ML 학습 등 "완료 후 종료"되는 워크로드는 다른 시맨틱이 필요하다. Job은 "지정된 횟수만큼 성공적으로 완료"를 보장하는 리소스이다. `restartPolicy: Always`를 금지하는 이유는 Job의 완료 시맨틱과 충돌하기 때문이다. 완료된 작업이 무한히 재시작되면 Job이 영원히 끝나지 않는다.
</details>

---

## Container Orchestration (문제 19~27)

### 문제 19.
컨테이너 기술에서 프로세스 격리를 제공하는 Linux 커널 기능은?

A) cgroups
B) namespace
C) SELinux
D) iptables

<details>
<summary>정답 확인</summary>

**정답: B) namespace ✅**

Linux namespace는 프로세스, 네트워크, 파일시스템, 사용자 등의 격리를 제공하는 커널 기능이다. 주요 namespace로는 PID(프로세스), NET(네트워크), MNT(파일시스템), UTS(호스트명), IPC(프로세스 간 통신), USER(사용자) 등이 있다. cgroups는 리소스 사용량(CPU, 메모리 등)을 제한하고 모니터링하는 기능이다.

**검증:**
```bash
# 컨테이너의 네임스페이스 확인 (노드에서 실행)
# 1. Pod 내 컨테이너의 PID 확인
kubectl exec <pod-name> -- cat /proc/1/status | grep NSpid

# 2. 노드에서 컨테이너 프로세스의 네임스페이스 확인
ls -la /proc/<container-pid>/ns/

# 3. 컨테이너 내부에서 격리 확인
kubectl exec <pod-name> -- ps aux      # PID 네임스페이스: PID 1부터 시작
kubectl exec <pod-name> -- hostname     # UTS 네임스페이스: Pod 이름 출력
kubectl exec <pod-name> -- ip addr      # NET 네임스페이스: Pod IP 출력
```
```text
# ps aux 기대 출력 (PID 네임스페이스 격리)
PID   USER     TIME  COMMAND
    1 root      0:00 nginx: master process nginx -g daemon off;
   29 nginx     0:00 nginx: worker process

# hostname 기대 출력
nginx-deployment-abc123

# ip addr 기대 출력
1: lo: <LOOPBACK,UP,LOWER_UP> ...
    inet 127.0.0.1/8 ...
3: eth0@if8: <BROADCAST,MULTICAST,UP,LOWER_UP> ...
    inet 10.244.1.5/24 ...

# ls /proc/<pid>/ns/ 기대 출력
lrwxrwxrwx 1 root root 0 ... cgroup -> 'cgroup:[4026532xxx]'
lrwxrwxrwx 1 root root 0 ... ipc -> 'ipc:[4026532xxx]'
lrwxrwxrwx 1 root root 0 ... mnt -> 'mnt:[4026532xxx]'
lrwxrwxrwx 1 root root 0 ... net -> 'net:[4026532xxx]'
lrwxrwxrwx 1 root root 0 ... pid -> 'pid:[4026532xxx]'
lrwxrwxrwx 1 root root 0 ... user -> 'user:[4026531xxx]'
lrwxrwxrwx 1 root root 0 ... uts -> 'uts:[4026532xxx]'
```

**오답 분석:**
- A) cgroups: 프로세스 격리가 아닌 리소스 제한을 담당한다. CPU, 메모리, I/O, 네트워크 대역폭 등의 사용량을 제한하고 모니터링한다. Kubernetes의 resources.limits/requests가 cgroups로 구현된다.
- C) SELinux: 커널 수준의 강제 접근 제어(MAC) 보안 모듈이다. 프로세스가 파일, 포트, 소켓 등에 접근할 수 있는 권한을 정책으로 제어한다. 격리가 아닌 접근 제어이다.
- D) iptables: Linux 커널의 netfilter 프레임워크를 관리하는 패킷 필터링 도구이다. 네트워크 트래픽 제어용이며, 프로세스 격리와 무관하다.

**내부 동작 원리:**
컨테이너 런타임(runc)이 컨테이너를 생성할 때 `clone()` 시스템 콜에 `CLONE_NEWPID | CLONE_NEWNET | CLONE_NEWNS | CLONE_NEWIPC | CLONE_NEWUTS` 등의 플래그를 전달하여 새로운 네임스페이스를 생성한다. PID 네임스페이스 안에서 컨테이너의 첫 번째 프로세스는 PID 1이 되고, 호스트의 다른 프로세스를 볼 수 없다. NET 네임스페이스는 독립된 네트워크 스택(인터페이스, 라우팅 테이블, iptables)을 제공한다. cgroups와 결합하여 namespace는 "무엇을 볼 수 있는가"를, cgroups는 "얼마나 사용할 수 있는가"를 제어한다.

**CNCF 생태계 맥락:**
Linux namespace와 cgroups는 모든 컨테이너 기술의 기반이다. containerd(CNCF 졸업)와 CRI-O(CNCF 인큐베이팅)는 내부적으로 runc를 사용하여 이 커널 기능을 활용한다. gVisor(Google)는 사용자 공간에서 별도의 커널을 실행하여 더 강한 격리를 제공하고, Kata Containers는 경량 VM을 사용하여 하드웨어 수준 격리를 제공한다. Falco(CNCF 인큐베이팅)는 커널 수준 시스템 콜을 모니터링하여 컨테이너 런타임 보안을 강화한다.

**등장 배경:**
VM은 하드웨어 가상화로 완전한 격리를 제공하지만 무겁고 느리다. 리눅스 커널의 namespace(2002년 도입)와 cgroups(2006년 도입)는 OS 수준에서 프로세스를 격리하고 리소스를 제한하는 경량 메커니즘이다. Docker(2013년)가 이 커널 기능을 조합하여 사용하기 쉬운 컨테이너 도구로 만들었고, 이것이 현재 컨테이너 생태계의 기반이 되었다.
</details>

---

### 문제 20.
OCI(Open Container Initiative)가 정의하는 사양이 아닌 것은?

A) Runtime Specification
B) Image Specification
C) Distribution Specification
D) Orchestration Specification

<details>
<summary>정답 확인</summary>

**정답: D) Orchestration Specification ✅**

OCI는 Runtime Specification(컨테이너 실행 방법), Image Specification(이미지 형식과 구조), Distribution Specification(이미지 배포 방식)의 세 가지 사양을 정의한다. Orchestration Specification은 OCI가 정의하는 사양이 아니다. OCI 표준 덕분에 서로 다른 런타임 간에 이미지 호환성이 보장된다.

**검증:**
```bash
# OCI 이미지 형식 확인 (이미지 매니페스트 조회)
kubectl run nginx --image=nginx
kubectl get pod nginx -o jsonpath='{.status.containerStatuses[0].imageID}'

# containerd에서 이미지 정보 확인 (노드에서 실행)
ctr -n k8s.io images list | grep nginx

# 이미지의 OCI 매니페스트 확인
crane manifest nginx:latest | jq '.mediaType'
```
```text
# imageID 기대 출력
docker.io/library/nginx@sha256:abc123...

# crane manifest 기대 출력
"application/vnd.oci.image.manifest.v1+json"
```

**오답 분석:**
- A) Runtime Specification: OCI 런타임 사양은 컨테이너의 설정, 실행 환경, 생명주기를 정의한다. runc가 이 사양의 참조 구현체이다. 파일시스템 번들, config.json(프로세스, 마운트, 네임스페이스 등) 형식을 규정한다.
- B) Image Specification: OCI 이미지 사양은 컨테이너 이미지의 형식을 정의한다. 이미지 매니페스트, 레이어(tar+gzip), 이미지 인덱스(멀티 아키텍처) 등의 구조를 규정한다.
- C) Distribution Specification: OCI 배포 사양은 컨테이너 이미지를 레지스트리에 push/pull하는 HTTP API를 정의한다. Docker Registry v2 API를 기반으로 표준화되었다.

**내부 동작 원리:**
OCI Runtime Spec에 따르면, 컨테이너는 "파일시스템 번들"과 "config.json"으로 구성된다. config.json에는 실행할 프로세스, 환경 변수, namespace, cgroups 설정이 포함된다. runc가 이 config.json을 읽고 `clone()` 시스템 콜로 격리된 프로세스를 생성한다. OCI Image Spec은 이미지를 레이어 기반으로 정의하여, 공통 레이어를 여러 이미지가 공유할 수 있게 한다. Distribution Spec은 /v2/<name>/manifests/<reference> 같은 REST API 경로를 정의한다.

**CNCF 생태계 맥락:**
OCI는 Linux Foundation 산하 프로젝트로, CNCF와 긴밀히 협력한다. CNCF 졸업 프로젝트인 containerd와 인큐베이팅 프로젝트인 CRI-O 모두 OCI 사양을 준수한다. Harbor(CNCF 졸업)는 OCI Distribution Spec을 구현하는 레지스트리이다. ORAS(OCI Registry As Storage)는 OCI 레지스트리에 컨테이너 이미지 외에 Helm Chart, WASM 모듈 등 임의의 아티팩트를 저장하는 프로젝트이다.

**등장 배경:**
Docker가 사실상 표준이었던 시절, 컨테이너 이미지와 런타임 형식이 Docker에 종속되어 있었다. 벤더 독립적인 표준이 없으면 생태계 발전이 제한된다. OCI는 2015년 Docker, Google, CoreOS, Red Hat 등이 참여하여 설립되었으며, 컨테이너 런타임과 이미지의 개방형 표준을 정의하여 다양한 구현체 간 호환성을 보장한다. 오케스트레이션은 OCI의 범위가 아니며 Kubernetes가 담당하는 영역이다.
</details>

---

### 문제 21.
Kubernetes v1.24 이후 컨테이너 런타임에 대한 설명으로 올바른 것은?

A) Docker를 직접 컨테이너 런타임으로 사용할 수 있다
B) dockershim이 제거되어 Docker를 직접 런타임으로 사용할 수 없지만, Docker로 빌드한 이미지는 사용 가능하다
C) containerd와 CRI-O 모두 사용할 수 없다
D) Docker만 유일하게 지원되는 런타임이다

<details>
<summary>정답 확인</summary>

**정답: B) dockershim이 제거되어 Docker를 직접 런타임으로 사용할 수 없지만, Docker로 빌드한 이미지는 사용 가능하다 ✅**

Kubernetes v1.24부터 dockershim이 제거되어 Docker를 직접 컨테이너 런타임으로 사용할 수 없다. 대신 containerd나 CRI-O를 사용해야 한다. 단, Docker로 빌드한 컨테이너 이미지는 OCI 표준을 따르므로 어떤 CRI 호환 런타임에서든 정상적으로 실행할 수 있다.

**검증:**
```bash
# 현재 사용 중인 컨테이너 런타임 확인
kubectl get nodes -o wide

# 노드의 런타임 상세 정보 확인
kubectl describe node <node-name> | grep "Container Runtime"

# containerd 소켓 확인 (노드에서)
ls -la /run/containerd/containerd.sock

# crictl로 런타임 정보 확인 (노드에서)
crictl info | head -5
```
```text
# kubectl get nodes -o wide 기대 출력
NAME           STATUS   ROLES           VERSION   CONTAINER-RUNTIME
control-plane  Ready    control-plane   v1.28.0   containerd://1.7.x
worker-1       Ready    <none>          v1.28.0   containerd://1.7.x

# describe node 기대 출력
Container Runtime Version:  containerd://1.7.x
```

**오답 분석:**
- A) Docker를 직접 컨테이너 런타임으로 사용할 수 있다: v1.24부터 dockershim이 제거되어 불가하다. Mirantis가 외부 프로젝트 cri-dockerd를 제공하여 Docker를 CRI 호환으로 사용할 수 있지만, 이는 공식 Kubernetes가 아닌 별도 어댑터이다.
- C) containerd와 CRI-O 모두 사용할 수 없다: 정반대이다. containerd(CNCF 졸업)와 CRI-O(CNCF 인큐베이팅)가 v1.24 이후 주요 CRI 호환 런타임이다.
- D) Docker만 유일하게 지원되는 런타임이다: 정반대이다. Docker(dockershim)가 제거된 것이다.

**내부 동작 원리:**
v1.24 이전에 kubelet은 내장된 dockershim을 통해 Docker Engine과 통신했다. 호출 흐름은 kubelet → dockershim → Docker Engine → containerd → runc였다. dockershim 제거 후에는 kubelet → CRI → containerd(또는 CRI-O) → runc로 단순화되었다. Docker Engine이라는 중간 계층이 제거되어 오버헤드가 줄었다. Docker로 빌드한 이미지는 OCI Image Spec을 준수하므로 containerd/CRI-O에서 그대로 실행된다.

**CNCF 생태계 맥락:**
containerd는 Docker에서 분리된 CNCF 졸업 프로젝트이다. CRI-O는 Kubernetes 전용으로 설계된 CNCF 인큐베이팅 프로젝트이다. 이미지 빌드 시에는 Docker 없이도 Buildah, kaniko, BuildKit 등을 사용할 수 있다. Podman은 Docker CLI 호환 도구로, 데몬 없이(daemonless) 컨테이너를 관리한다.

**등장 배경:**
Docker는 컨테이너 대중화에 기여했지만, Kubernetes 런타임으로 사용하기에는 불필요한 기능(Docker CLI, Docker Compose, swarm 등)이 많았다. kubelet → Docker → containerd → runc라는 긴 호출 체인은 성능 오버헤드와 디버깅 복잡도를 높였다. CRI(Container Runtime Interface) 표준을 통해 kubelet이 containerd/CRI-O와 직접 통신하게 하고, Docker 의존성을 제거하는 것이 목표였다. dockershim은 Kubernetes 코어 코드에 Docker 전용 로직이 포함되는 유지보수 부담도 있었다.
</details>

---

### 문제 22.
CRI(Container Runtime Interface)에 대한 설명으로 올바른 것은?

A) 컨테이너 이미지를 빌드하기 위한 인터페이스이다
B) Kubernetes가 컨테이너 런타임과 통신하기 위한 표준 API이다
C) 컨테이너 네트워크를 구성하기 위한 인터페이스이다
D) 컨테이너 스토리지를 관리하기 위한 인터페이스이다

<details>
<summary>정답 확인</summary>

**정답: B) Kubernetes가 컨테이너 런타임과 통신하기 위한 표준 API이다 ✅**

CRI(Container Runtime Interface)는 kubelet이 컨테이너 런타임과 통신하기 위한 표준 인터페이스이다. gRPC 기반의 API를 사용하며, RuntimeService(Pod/컨테이너 생명주기 관리)와 ImageService(이미지 관리) 두 가지 서비스를 정의한다. CRI 덕분에 K8s는 특정 런타임에 종속되지 않는다.

**검증:**
```bash
# 노드의 CRI 소켓 경로 확인
kubectl get node <node-name> -o jsonpath='{.status.nodeInfo.containerRuntimeVersion}'

# crictl (CRI CLI 도구)로 런타임 상태 확인
crictl info

# CRI를 통한 Pod 목록 조회
crictl pods

# CRI를 통한 컨테이너 목록 조회
crictl ps

# CRI를 통한 이미지 목록 조회
crictl images
```
```text
# containerRuntimeVersion 기대 출력
containerd://1.7.x

# crictl pods 기대 출력
POD ID          CREATED       STATE   NAME                    NAMESPACE
abc123def456    2 hours ago   Ready   nginx-xxx               default
fed987cba654    2 hours ago   Ready   coredns-xxx             kube-system

# crictl ps 기대 출력
CONTAINER       IMAGE          CREATED       STATE     NAME      POD ID
1234567890ab    nginx:latest   2 hours ago   Running   nginx     abc123def456
```

**오답 분석:**
- A) 컨테이너 이미지를 빌드하기 위한 인터페이스이다: CRI는 이미지 빌드와 무관하다. 이미지 빌드는 Docker, Buildah, kaniko 등의 빌드 도구가 담당한다. CRI의 ImageService는 이미지 pull/list/remove만 지원한다.
- C) 컨테이너 네트워크를 구성하기 위한 인터페이스이다: 네트워크 구성은 CNI(Container Network Interface)의 역할이다. CRI는 런타임 생명주기 관리이다.
- D) 컨테이너 스토리지를 관리하기 위한 인터페이스이다: 스토리지 관리는 CSI(Container Storage Interface)의 역할이다.

**내부 동작 원리:**
CRI는 protobuf로 정의된 gRPC 서비스이다. RuntimeService는 `RunPodSandbox()`, `CreateContainer()`, `StartContainer()`, `StopContainer()`, `RemoveContainer()` 등의 RPC를 정의한다. kubelet이 Pod를 실행할 때의 호출 순서는: (1) `RunPodSandbox()`로 Pod의 네트워크 네임스페이스 생성 (2) `CreateContainer()`로 컨테이너 생성 (3) `StartContainer()`로 컨테이너 시작이다. ImageService는 `PullImage()`, `ListImages()`, `RemoveImage()` 등을 제공한다.

**CNCF 생태계 맥락:**
CRI는 Kubernetes SIG-Node에서 정의하고 관리한다. CRI 호환 런타임으로는 containerd(CNCF 졸업), CRI-O(CNCF 인큐베이팅)가 대표적이다. Kubernetes의 3대 플러그인 인터페이스인 CRI(런타임), CNI(네트워크), CSI(스토리지)는 각각 독립적인 표준으로, CNCF 생태계의 다양한 구현체가 이 인터페이스를 통해 Kubernetes와 통합된다.

**등장 배경:**
초기 Kubernetes는 Docker에 직접 의존했다. 다른 런타임(rkt 등)을 지원하려면 kubelet 코드에 런타임별 로직을 추가해야 했다. CRI는 이 문제를 해결하기 위해 v1.5에서 도입된 표준 인터페이스이다. 런타임 구현체가 CRI만 준수하면 kubelet 코드 변경 없이 사용할 수 있어, 런타임 생태계의 혁신을 촉진한다.
</details>

---

### 문제 23.
containerd에 대한 설명으로 올바르지 않은 것은?

A) Docker에서 분리된 고수준 컨테이너 런타임이다
B) CNCF 졸업 프로젝트이다
C) 저수준 컨테이너 실행을 위해 내부적으로 runc를 사용한다
D) Kubernetes 전용으로 설계되어 Docker에서는 사용되지 않는다

<details>
<summary>정답 확인</summary>

**정답: D) Kubernetes 전용으로 설계되어 Docker에서는 사용되지 않는다 ✅**

containerd는 Docker에서 분리된 프로젝트이지만, Docker 엔진 자체도 내부적으로 containerd를 사용한다. 즉, Docker는 containerd를 기반으로 동작한다. containerd는 K8s 전용이 아니며, 독립적인 컨테이너 런타임으로서 다양한 환경에서 사용된다.

**검증:**
```bash
# containerd 버전 확인 (노드에서)
containerd --version

# containerd 네임스페이스 목록 확인 (Docker와 K8s 모두 사용)
ctr namespaces list

# containerd의 K8s 네임스페이스에서 이미지 확인
ctr -n k8s.io images list | head -5

# containerd 상태 확인
systemctl status containerd
```
```text
# containerd --version 기대 출력
containerd containerd.io 1.7.x abc123

# ctr namespaces list 기대 출력
NAME      LABELS
default
k8s.io              # Kubernetes가 사용하는 네임스페이스
moby                 # Docker가 사용하는 네임스페이스 (Docker 설치 시)

# systemctl status 기대 출력
● containerd.service - containerd container runtime
   Loaded: loaded (/usr/lib/systemd/system/containerd.service; enabled)
   Active: active (running) since ...
```

**오답 분석:**
- A) Docker에서 분리된 고수준 컨테이너 런타임이다: 맞는 설명이다. Docker Inc.가 2017년에 containerd를 CNCF에 기증하였다. 이미지 관리, 컨테이너 생명주기 관리, 스냅샷, 네트워킹 등의 고수준 기능을 제공한다.
- B) CNCF 졸업 프로젝트이다: 맞는 설명이다. 2019년에 CNCF 졸업 프로젝트가 되었다.
- C) 저수준 컨테이너 실행을 위해 내부적으로 runc를 사용한다: 맞는 설명이다. containerd는 고수준 런타임으로서 이미지 pull, 스냅샷 생성 등을 처리하고, 실제 컨테이너 프로세스 생성은 OCI 런타임인 runc에 위임한다.

**내부 동작 원리:**
containerd의 아키텍처는 플러그인 기반이다. 핵심 컴포넌트로 Content Store(이미지 레이어 저장), Snapshotter(파일시스템 스냅샷), Container/Task 서비스(컨테이너 관리), CRI 플러그인(Kubernetes 통합)이 있다. 컨테이너 생성 시 containerd는 이미지를 언팩하여 스냅샷을 생성하고, OCI 번들을 만들어 runc(또는 다른 OCI 런타임)에 전달한다. containerd의 shim 프로세스(containerd-shim-runc-v2)가 runc와 컨테이너 사이에서 중개하여, containerd가 재시작되어도 실행 중인 컨테이너에 영향이 없다.

**CNCF 생태계 맥락:**
containerd는 Kubernetes, Docker, 그리고 nerdctl(containerd 전용 CLI) 등 다양한 환경에서 사용된다. AWS Fargate, Google Cloud Run, Azure Container Instances 등 클라우드 서비스도 내부적으로 containerd를 활용한다. gVisor의 runsc나 Kata Containers의 kata-runtime 같은 대안적 OCI 런타임도 containerd의 런타임 shim 인터페이스를 통해 통합된다.

**등장 배경:**
Docker Engine은 빌드, 실행, 네트워킹, 볼륨 관리 등 다양한 기능을 하나의 데몬에 포함하고 있었다. 이 모놀리식 구조는 Kubernetes처럼 런타임 기능만 필요한 환경에서는 불필요한 복잡성과 공격 표면을 추가했다. containerd는 Docker에서 "컨테이너 실행"이라는 핵심 기능만 분리하여 경량화하고, CNCF에 기증하여 벤더 중립적인 표준 런타임이 되었다.
</details>

---

### 문제 24.
Dockerfile에서 컨테이너 시작 시 실행할 명령어를 지정하되, `docker run` 시 덮어쓸 수 없도록 고정하는 명령어는?

A) CMD
B) RUN
C) ENTRYPOINT
D) EXEC

<details>
<summary>정답 확인</summary>

**정답: C) ENTRYPOINT ✅**

ENTRYPOINT는 컨테이너 시작 시 실행할 명령어를 고정한다. `docker run` 시 인자를 전달하면 ENTRYPOINT의 인자로 추가된다. CMD는 기본 명령어를 지정하지만 `docker run` 시 다른 명령어로 쉽게 덮어쓸 수 있다. RUN은 이미지 빌드 시에만 실행된다.

**검증:**
```bash
# ENTRYPOINT가 설정된 이미지 실행
# Dockerfile: ENTRYPOINT ["echo"] CMD ["hello"]
docker run my-image               # "hello" 출력 (CMD가 ENTRYPOINT 인자로)
docker run my-image world          # "world" 출력 (CMD가 "world"로 대체)
docker run my-image ls             # "ls" 출력 (echo ls가 실행됨, ls 명령이 아님)

# Kubernetes에서 ENTRYPOINT/CMD 확인
kubectl get pod <pod-name> -o jsonpath='{.spec.containers[0].command}'  # ENTRYPOINT에 해당
kubectl get pod <pod-name> -o jsonpath='{.spec.containers[0].args}'     # CMD에 해당
```
```text
# docker run my-image 기대 출력
hello

# docker run my-image world 기대 출력
world

# docker run my-image ls 기대 출력
ls
```

**오답 분석:**
- A) CMD: 기본 실행 명령어를 지정하지만, `docker run <image> <new-command>` 형태로 쉽게 덮어쓸 수 있다. ENTRYPOINT와 함께 사용하면 CMD는 ENTRYPOINT의 기본 인자 역할을 한다.
- B) RUN: 이미지 빌드 타임에 실행되는 명령이다. `RUN apt-get install -y nginx`처럼 패키지 설치, 파일 복사 등 이미지 레이어를 생성하는 데 사용한다. 컨테이너 실행과 무관하다.
- D) EXEC: Dockerfile 명령어가 아니다. exec form(JSON 배열 형태: `["executable", "param1"]`)은 ENTRYPOINT와 CMD에서 사용하는 형식이다. `docker exec`는 실행 중인 컨테이너에 추가 프로세스를 실행하는 명령이다.

**내부 동작 원리:**
OCI 이미지의 config에는 `Entrypoint`와 `Cmd` 필드가 있다. 컨테이너 시작 시 실행되는 최종 명령은 `Entrypoint + Cmd`이다. Kubernetes Pod spec에서 `command` 필드는 Entrypoint를, `args` 필드는 Cmd를 오버라이드한다. exec form(`["cmd", "arg"]`)은 프로세스가 PID 1로 직접 실행되고, shell form(`cmd arg`)은 `/bin/sh -c "cmd arg"`로 래핑되어 실행된다. PID 1 프로세스가 SIGTERM을 직접 받으려면 exec form을 사용해야 한다.

**CNCF 생태계 맥락:**
OCI Image Spec에서 Entrypoint/Cmd는 컨테이너 실행 동작을 정의하는 핵심 메타데이터이다. Kubernetes는 이를 `command`/`args`로 오버라이드할 수 있어, 동일한 이미지를 다양한 용도로 재사용할 수 있다. Buildpacks(CNCF 인큐베이팅)는 Dockerfile 없이 소스 코드에서 OCI 이미지를 생성하며, 적절한 ENTRYPOINT를 자동으로 설정한다.

**등장 배경:**
컨테이너 이미지의 실행 명령을 설계할 때 두 가지 요구가 있다. 하나는 고정된 실행 파일(예: nginx, python)을 지정하는 것이고, 다른 하나는 기본 인자를 제공하되 사용자가 변경할 수 있게 하는 것이다. ENTRYPOINT + CMD 조합은 이 두 요구를 분리하여, 실행 파일은 고정하고 인자만 유연하게 변경할 수 있는 패턴을 제공한다.
</details>

---

### 문제 25.
컨테이너 오케스트레이션이 제공하는 기능이 아닌 것은?

A) 자동 복구 (Self-healing)
B) 서비스 디스커버리
C) 소스 코드 컴파일
D) 로드밸런싱

<details>
<summary>정답 확인</summary>

**정답: C) 소스 코드 컴파일 ✅**

컨테이너 오케스트레이션은 자동 복구, 서비스 디스커버리, 로드밸런싱, 스케줄링, 자동 스케일링, 롤링 업데이트, 설정 관리 등의 기능을 제공한다. 소스 코드 컴파일은 CI/CD 도구의 역할이며, 오케스트레이션의 영역이 아니다.

**검증:**
```bash
# Kubernetes 오케스트레이션 기능 확인

# 자동 복구: Pod 삭제 시 자동 재생성
kubectl delete pod <pod-name>  # Deployment가 관리하는 경우 자동 재생성
kubectl get pods -w            # 새 Pod 생성 관찰

# 서비스 디스커버리: DNS 기반 확인
kubectl exec <pod> -- nslookup my-service.default.svc.cluster.local

# 로드밸런싱: 서비스 엔드포인트 확인
kubectl get endpoints my-service

# 자동 스케일링: HPA 상태 확인
kubectl get hpa
```
```text
# 자동 복구 기대 출력
NAME         READY   STATUS        AGE
my-app-abc   1/1     Terminating   10m
my-app-xyz   1/1     Running       5s    # 자동 재생성됨

# nslookup 기대 출력
Server:    10.96.0.10
Address:   10.96.0.10#53
Name:      my-service.default.svc.cluster.local
Address:   10.96.45.123
```

**오답 분석:**
- A) 자동 복구 (Self-healing): 오케스트레이션의 핵심 기능이다. Pod가 비정상 종료되면 컨트롤러가 자동으로 재생성한다. Liveness Probe 실패 시에도 컨테이너를 재시작한다.
- B) 서비스 디스커버리: 오케스트레이션의 핵심 기능이다. Service와 DNS(CoreDNS)를 통해 Pod의 동적 IP 변경에 관계없이 서비스를 찾을 수 있다.
- D) 로드밸런싱: 오케스트레이션의 핵심 기능이다. Service가 여러 Pod 복제본에 트래픽을 분산한다.

**내부 동작 원리:**
컨테이너 오케스트레이터는 선언적 모델(Desired State)과 제어 루프(Control Loop)를 기반으로 동작한다. 사용자가 원하는 상태(예: "nginx 3개 실행")를 선언하면, 컨트롤러가 현재 상태를 지속적으로 감시하여 원하는 상태와의 차이(drift)를 자동으로 수정한다. 이 조정(reconciliation) 루프가 자동 복구, 스케일링, 롤링 업데이트 등 모든 오케스트레이션 기능의 기반이다.

**CNCF 생태계 맥락:**
Kubernetes는 CNCF 졸업 프로젝트이자 사실상 표준 컨테이너 오케스트레이터이다. 이전에는 Docker Swarm, Apache Mesos/Marathon, Nomad 등 경쟁 솔루션이 있었으나, Kubernetes가 업계 표준으로 자리잡았다. CNCF의 거의 모든 프로젝트가 Kubernetes 위에서 동작하거나 Kubernetes와 통합된다.

**등장 배경:**
컨테이너 수가 수십~수천 개로 늘어나면, 수동으로 배포/관리/모니터링하는 것은 불가능하다. 어떤 서버에 컨테이너를 배치할지, 장애 시 어떻게 복구할지, 트래픽을 어떻게 분산할지 등의 운영 문제를 자동화하는 것이 오케스트레이션이다. Google이 내부적으로 15년간 사용한 Borg 시스템의 경험을 바탕으로 Kubernetes가 탄생하였다.
</details>

---

### 문제 26.
컨테이너와 가상 머신(VM)을 비교한 설명으로 올바른 것은?

A) 컨테이너는 VM보다 보안 격리가 더 강하다
B) 컨테이너는 호스트 OS의 커널을 공유하므로 VM보다 가볍고 빠르다
C) VM은 컨테이너보다 시작 시간이 빠르다
D) 컨테이너는 각각 독립된 게스트 OS를 포함한다

<details>
<summary>정답 확인</summary>

**정답: B) 컨테이너는 호스트 OS의 커널을 공유하므로 VM보다 가볍고 빠르다 ✅**

컨테이너는 호스트 OS의 커널을 공유하므로 수 MB 크기이고 초 단위로 시작된다. VM은 각각 게스트 OS를 포함하므로 수 GB 크기이고 분 단위로 시작된다. 보안 격리 측면에서는 하드웨어 수준 격리를 제공하는 VM이 컨테이너보다 더 강하다.

**검증:**
```bash
# 컨테이너 시작 시간 측정
time kubectl run nginx --image=nginx
kubectl get pod nginx -w  # Running까지 시간 관찰

# 컨테이너 이미지 크기 확인
crictl images | grep nginx

# Pod의 리소스 사용량 확인 (경량성 확인)
kubectl top pod nginx
```
```text
# kubectl run 기대 출력
pod/nginx created
real    0m0.150s

# crictl images 기대 출력
IMAGE                   TAG       SIZE
docker.io/library/nginx latest    67.3MB

# kubectl top pod 기대 출력
NAME    CPU(cores)   MEMORY(bytes)
nginx   1m           3Mi
```

**오답 분석:**
- A) 컨테이너는 VM보다 보안 격리가 더 강하다: 반대이다. VM은 하이퍼바이저가 하드웨어 수준에서 격리하여 게스트 OS 간 완전한 분리를 제공한다. 컨테이너는 커널을 공유하므로 커널 취약점이 컨테이너 탈출(escape)로 이어질 수 있다.
- C) VM은 컨테이너보다 시작 시간이 빠르다: 반대이다. VM은 게스트 OS를 부팅해야 하므로 분 단위가 소요된다. 컨테이너는 프로세스 시작만 하면 되므로 초~밀리초 단위이다.
- D) 컨테이너는 각각 독립된 게스트 OS를 포함한다: VM의 설명이다. 컨테이너는 호스트 OS 커널을 공유하며, 게스트 OS를 포함하지 않는다.

**내부 동작 원리:**
VM은 하이퍼바이저(Type 1: 베어메탈, Type 2: 호스트형)가 하드웨어 리소스를 가상화하여 각 VM에 독립된 CPU, 메모리, 네트워크, 스토리지를 할당한다. 각 VM은 완전한 게스트 OS를 실행한다. 컨테이너는 호스트 OS의 커널 위에서 namespace(격리)와 cgroups(리소스 제한)를 사용하여 프로세스를 격리한다. 커널 공유 덕분에 오버헤드가 매우 적지만, 커널 수준의 취약점은 모든 컨테이너에 영향을 미칠 수 있다.

**CNCF 생태계 맥락:**
컨테이너와 VM의 장점을 결합하려는 시도가 활발하다. Kata Containers는 경량 VM 안에서 컨테이너를 실행하여 하드웨어 격리를 제공한다. gVisor(Google)는 사용자 공간 커널로 시스템 콜을 가로채어 호스트 커널 공격 표면을 줄인다. Firecracker(AWS)는 마이크로VM으로 서버리스 환경의 격리를 제공한다. Apple Silicon의 Virtualization.framework를 활용하는 Tart도 macOS에서 경량 VM을 제공한다.

**등장 배경:**
VM은 2000년대부터 서버 통합(server consolidation)의 핵심 기술이었다. 하나의 물리 서버에서 여러 VM을 실행하여 자원 활용도를 높였다. 그러나 각 VM이 전체 OS를 포함하는 오버헤드가 있었다. 2013년 Docker의 등장으로 OS 수준 가상화(컨테이너)가 대중화되었고, 밀도(하나의 호스트에 더 많은 워크로드), 속도(빠른 시작/종료), 이식성(이미지 기반 배포) 면에서 VM의 한계를 극복하였다.
</details>

---

### 문제 27.
CNCF 졸업 프로젝트인 오픈소스 프라이빗 컨테이너 레지스트리는?

A) Docker Hub
B) Quay
C) Harbor
D) Nexus

<details>
<summary>정답 확인</summary>

**정답: C) Harbor ✅**

Harbor는 CNCF 졸업 프로젝트인 오픈소스 프라이빗 컨테이너 레지스트리이다. 취약점 스캐닝, 이미지 서명, 접근 제어, 복제 등의 기능을 제공한다. Docker Hub는 공용 레지스트리이며, Quay는 Red Hat이 운영하는 레지스트리이고, Nexus는 Sonatype의 범용 아티팩트 저장소이다.

**검증:**
```bash
# Harbor에 이미지 푸시/풀 테스트
docker login harbor.example.com
docker tag nginx:latest harbor.example.com/library/nginx:latest
docker push harbor.example.com/library/nginx:latest

# Kubernetes에서 Harbor의 이미지 사용
kubectl run nginx --image=harbor.example.com/library/nginx:latest

# Harbor API로 프로젝트 목록 조회
curl -s https://harbor.example.com/api/v2.0/projects | jq '.[].name'
```
```text
# docker push 기대 출력
The push refers to repository [harbor.example.com/library/nginx]
latest: digest: sha256:abc123... size: 1234

# Harbor API 기대 출력
"library"
"my-project"
```

**오답 분석:**
- A) Docker Hub: Docker Inc.가 운영하는 퍼블릭 레지스트리이다. CNCF 프로젝트가 아니며, 오픈소스도 아니다. 무료 티어에서는 pull rate limit이 있다.
- B) Quay: Red Hat이 운영하는 컨테이너 레지스트리이다. 오픈소스 버전(Project Quay)이 있지만 CNCF 프로젝트가 아니다.
- D) Nexus: Sonatype이 개발한 범용 아티팩트 저장소이다. 컨테이너 이미지 외에 Maven, npm, PyPI 등 다양한 형식을 지원하지만 CNCF 프로젝트가 아니다.

**내부 동작 원리:**
Harbor는 Docker Registry v2(OCI Distribution Spec)를 핵심으로 하고, 그 위에 엔터프라이즈 기능을 추가한 구조이다. 주요 컴포넌트로는 Core(API 서버), Registry(이미지 저장), Trivy(취약점 스캐너), Notary(이미지 서명), PostgreSQL(메타데이터 DB), Redis(캐시)가 있다. 이미지 push 시 Core가 인증/인가를 처리하고, Registry가 이미지 레이어를 저장하며, webhook으로 취약점 스캐닝이 자동 트리거된다.

**CNCF 생태계 맥락:**
Harbor는 2020년에 CNCF 졸업 프로젝트가 되었다. VMware(현 Broadcom)가 주도하여 개발하였다. Trivy(Aqua Security)를 기본 취약점 스캐너로 통합하고, Cosign/Notary v2를 통한 이미지 서명을 지원한다. OCI Artifacts를 지원하여 Helm Chart, WASM 모듈 등도 저장할 수 있다. Dragonfly(CNCF 인큐베이팅)와 연동하여 P2P 기반 이미지 배포를 가속화할 수 있다.

**등장 배경:**
퍼블릭 레지스트리(Docker Hub)에 민감한 이미지를 저장하는 것은 보안 위험이 있다. 기업 환경에서는 이미지 접근 제어, 취약점 스캐닝, 서명 검증, 컴플라이언스 감사 등이 필수이다. Harbor는 이러한 엔터프라이즈 요구사항을 충족하는 프라이빗 레지스트리를 오픈소스로 제공하여, 벤더 종속 없이 안전한 이미지 관리를 가능하게 한다.
</details>

---

## Cloud Native Architecture (문제 28~33)

### 문제 28.
CNCF 프로젝트의 성숙도 단계를 올바른 순서대로 나열한 것은?

A) Incubating -> Sandbox -> Graduated
B) Sandbox -> Graduated -> Incubating
C) Sandbox -> Incubating -> Graduated
D) Graduated -> Incubating -> Sandbox

<details>
<summary>정답 확인</summary>

**정답: C) Sandbox -> Incubating -> Graduated ✅**

CNCF 프로젝트의 성숙도는 Sandbox(초기 실험 단계) -> Incubating(성장 단계, 프로덕션 사용 사례 존재) -> Graduated(성숙 단계, 광범위 채택 및 프로덕션 검증)의 순서로 발전한다. Graduated 프로젝트는 보안 감사를 완료해야 하며, Kubernetes, Prometheus, Helm, etcd 등이 대표적이다.

**검증:**
```bash
# CNCF 프로젝트 목록은 공식 사이트에서 확인
# https://www.cncf.io/projects/
# 또는 CNCF Landscape로 확인
# https://landscape.cncf.io/

# Kubernetes 클러스터에서 사용 중인 CNCF 졸업 프로젝트 확인
kubectl get pods -A -o jsonpath='{range .items[*]}{.spec.containers[*].image}{"\n"}{end}' | sort -u
```
```text
# 대표적 CNCF 프로젝트 성숙도 예시
Graduated: Kubernetes, Prometheus, Envoy, Fluentd, etcd, containerd, CoreDNS,
           Helm, Harbor, Argo, Flux, Cilium, Rook, Falco ...
Incubating: CRI-O, OpenTelemetry, Knative, Longhorn, Kyverno, Backstage ...
Sandbox: KubeVirt, Keycloak, OpenKruise, Radius ...
```

**오답 분석:**
- A) Incubating -> Sandbox -> Graduated: Sandbox가 가장 초기 단계이므로 순서가 틀렸다. Incubating은 Sandbox 다음 단계이다.
- B) Sandbox -> Graduated -> Incubating: Graduated가 최종 단계이므로 순서가 틀렸다. Incubating을 거쳐야 Graduated에 도달한다.
- D) Graduated -> Incubating -> Sandbox: 완전히 역순이다.

**내부 동작 원리:**
CNCF TOC(Technical Oversight Committee)가 프로젝트의 단계 전환(promotion)을 심의한다. Sandbox 진입에는 TOC 스폰서 2명이 필요하다. Incubating 전환에는 프로덕션 사용 사례, 건전한 기여자 커뮤니티, 보안 프로세스가 요구된다. Graduated 전환에는 독립적인 보안 감사 완료, 2개 이상의 프로덕션 사용자 사례, CII Best Practices 배지 취득, 다양한 기여자 생태계 등이 요구된다. 각 단계마다 CNCF의 마케팅, 인프라, 거버넌스 지원 수준이 다르다.

**CNCF 생태계 맥락:**
CNCF는 Linux Foundation 산하 조직으로, Cloud Native 생태계의 핵심 거버넌스 역할을 한다. 2024년 기준 180개 이상의 프로젝트를 호스팅한다. CNCF Landscape(landscape.cncf.io)는 Cloud Native 생태계의 전체 지도를 제공하며, 프로젝트 선택 시 참고 자료로 활용된다. KCNA 시험에서는 주요 프로젝트의 성숙도 단계와 역할을 이해하는 것이 중요하다.

**등장 배경:**
오픈소스 프로젝트는 성숙도가 천차만별이다. 기업이 프로덕션에 도입할 때 프로젝트의 안정성, 커뮤니티 활성화도, 보안 수준을 판단하기 어렵다. CNCF의 3단계 성숙도 모델은 프로젝트의 품질과 안정성에 대한 객관적 기준을 제공하여, 조직이 기술 선택 시 위험을 평가할 수 있게 한다.
</details>

---

### 문제 29.
마이크로서비스 아키텍처의 단점이 아닌 것은?

A) 분산 시스템의 복잡성이 증가한다
B) 서비스별로 독립적인 스케일링이 가능하다
C) 네트워크 통신으로 인한 지연이 발생한다
D) 분산 트랜잭션 관리가 어렵다

<details>
<summary>정답 확인</summary>

**정답: B) 서비스별로 독립적인 스케일링이 가능하다 ✅**

서비스별 독립적인 스케일링은 마이크로서비스의 장점이다. 마이크로서비스의 단점으로는 분산 시스템의 복잡성 증가, 네트워크 통신에 의한 지연(latency), 분산 트랜잭션 관리의 어려움, 서비스 간 의존성 관리, 운영 및 모니터링의 복잡화 등이 있다.

**검증:**
```bash
# 마이크로서비스의 독립적 스케일링 예시
kubectl scale deployment order-service --replicas=5    # 주문 서비스만 스케일 아웃
kubectl scale deployment user-service --replicas=2     # 사용자 서비스는 유지

# 각 서비스의 스케일 상태 확인
kubectl get deployments

# HPA를 통한 서비스별 자동 스케일링
kubectl autoscale deployment order-service --min=2 --max=10 --cpu-percent=50
```
```text
# kubectl get deployments 기대 출력
NAME             READY   UP-TO-DATE   AVAILABLE   AGE
order-service    5/5     5            5           1d
user-service     2/2     2            2           1d
payment-service  3/3     3            3           1d
```

**오답 분석:**
- A) 분산 시스템의 복잡성이 증가한다: 맞는 단점이다. 서비스 간 통신, 데이터 일관성, 장애 전파, 버전 호환성 등 모놀리식에서는 존재하지 않는 문제가 발생한다.
- C) 네트워크 통신으로 인한 지연이 발생한다: 맞는 단점이다. 모놀리식에서는 함수 호출(나노초)이었던 것이 HTTP/gRPC 호출(밀리초)로 변경되어 지연이 증가한다. 서비스 체인이 길어질수록 누적 지연이 커진다.
- D) 분산 트랜잭션 관리가 어렵다: 맞는 단점이다. 모놀리식에서는 단일 DB 트랜잭션으로 처리하던 것이, 마이크로서비스에서는 Saga 패턴, 이벤트 소싱 등 복잡한 패턴으로 해결해야 한다.

**내부 동작 원리:**
마이크로서비스 아키텍처에서 각 서비스는 독립된 프로세스로 실행되며, API(REST, gRPC, 메시지 큐)를 통해 통신한다. 각 서비스가 자체 데이터 저장소를 가지는 "Database per Service" 패턴이 일반적이다. 이로 인해 서비스별 독립 배포, 기술 스택 선택의 자유, 장애 격리(한 서비스 장애가 전체에 영향을 미치지 않음), 독립적 스케일링이 가능해지지만, 데이터 일관성과 운영 복잡도가 증가한다.

**CNCF 생태계 맥락:**
마이크로서비스의 복잡성을 관리하기 위한 CNCF 프로젝트가 다수 존재한다. Istio/Linkerd(서비스 메시)는 서비스 간 통신 관리, Jaeger/OpenTelemetry(분산 트레이싱)는 서비스 체인 추적, gRPC(CNCF 인큐베이팅)는 효율적인 서비스 간 통신, NATS(CNCF 인큐베이팅)는 비동기 메시징을 제공한다. Dapr(CNCF 인큐베이팅)은 마이크로서비스 빌딩 블록(상태 관리, pub/sub, 서비스 호출)을 사이드카로 제공한다.

**등장 배경:**
모놀리식 아키텍처는 전체 애플리케이션을 하나의 배포 단위로 관리한다. 규모가 커지면 빌드/테스트/배포 시간이 길어지고, 작은 변경에도 전체 재배포가 필요하며, 일부 컴포넌트만 스케일링하는 것이 불가능하다. 마이크로서비스는 서비스를 작은 단위로 분리하여 독립적 개발/배포/스케일링을 가능하게 하지만, 분산 시스템 고유의 복잡성을 수반한다.
</details>

---

### 문제 30.
서비스 메시의 Data Plane에서 각 서비스 옆에 배치되어 트래픽을 처리하는 구성 요소는?

A) Control Plane Controller
B) Sidecar Proxy
C) API Gateway
D) Load Balancer

<details>
<summary>정답 확인</summary>

**정답: B) Sidecar Proxy ✅**

서비스 메시의 Data Plane은 각 서비스 옆에 배치된 사이드카 프록시가 실제 트래픽을 처리하는 계층이다. Istio의 경우 Envoy를 사이드카 프록시로 사용한다. Control Plane은 이 프록시들의 설정과 정책을 관리하는 역할을 한다.

**검증:**
```bash
# Istio 사이드카 프록시 확인 (istio-proxy 컨테이너)
kubectl get pods -o jsonpath='{range .items[*]}{.metadata.name}{": "}{range .spec.containers[*]}{.name}{" "}{end}{"\n"}{end}'

# 특정 Pod의 사이드카 프록시 확인
kubectl describe pod <pod-name> | grep -A3 "istio-proxy"

# Envoy 프록시 설정 확인
kubectl exec <pod-name> -c istio-proxy -- pilot-agent request GET /config_dump | head -20

# 사이드카 프록시의 리스너/클러스터 확인
kubectl exec <pod-name> -c istio-proxy -- pilot-agent request GET /listeners
```
```text
# Pod 컨테이너 목록 기대 출력
my-app-abc: my-app istio-proxy    # 앱 컨테이너 + 사이드카 프록시

# describe 기대 출력
  istio-proxy:
    Container ID:  containerd://abc123...
    Image:         docker.io/istio/proxyv2:1.20.x
    Port:          15090/TCP
```

**오답 분석:**
- A) Control Plane Controller: 서비스 메시의 Control Plane은 프록시들의 설정을 배포하고 정책을 관리한다. 트래픽을 직접 처리하지 않는다. Istio의 경우 istiod가 Control Plane 역할을 한다.
- C) API Gateway: 클러스터 외부에서 들어오는 요청의 진입점 역할을 한다. 서비스 메시의 사이드카처럼 각 서비스 옆에 배치되는 것이 아니라, 클러스터 경계에 단일 인스턴스(또는 소수)로 배치된다.
- D) Load Balancer: 트래픽을 여러 백엔드에 분산하는 역할이다. 서비스 메시에서 사이드카 프록시가 로드밸런싱 기능을 포함하지만, Load Balancer 자체가 사이드카로 배치되는 것은 아니다.

**내부 동작 원리:**
사이드카 프록시는 Pod 내에서 애플리케이션 컨테이너와 동일한 네트워크 네임스페이스를 공유한다. iptables 규칙(또는 eBPF)으로 Pod의 모든 인바운드/아웃바운드 트래픽이 사이드카 프록시를 통과하도록 리다이렉트된다. 프록시는 mTLS(상호 TLS) 암호화, 로드밸런싱, 재시도, 서킷 브레이킹, 메트릭 수집 등을 투명하게(애플리케이션 코드 변경 없이) 처리한다. Control Plane(istiod)은 xDS(Discovery Service) API로 프록시에 설정을 배포한다.

**CNCF 생태계 맥락:**
Istio(CNCF 졸업)는 Envoy(CNCF 졸업)를 사이드카 프록시로 사용하는 가장 널리 채택된 서비스 메시이다. Linkerd(CNCF 졸업)는 Rust 기반의 자체 프록시(linkerd2-proxy)를 사용한다. Cilium은 eBPF 기반으로 사이드카 없이 커널 수준에서 서비스 메시 기능을 제공한다. Istio도 v1.22부터 Ambient Mesh 모드를 도입하여 사이드카 없는 아키텍처를 지원한다.

**등장 배경:**
마이크로서비스 간 통신에서 mTLS, 재시도, 서킷 브레이킹, 관측성 등을 각 서비스 코드에 구현하면 중복 코드가 발생하고 언어별로 라이브러리가 달라 일관성이 없다. 서비스 메시는 이러한 통신 로직을 애플리케이션에서 분리하여 인프라 계층(사이드카 프록시)으로 이동시킴으로써, 개발자가 비즈니스 로직에만 집중할 수 있게 한다.
</details>

---

### 문제 31.
HPA(Horizontal Pod Autoscaler)가 동작하기 위해 반드시 필요한 것은? (2가지)

A) Ingress Controller와 NetworkPolicy
B) metrics-server와 Pod의 resources.requests 설정
C) VPA와 Cluster Autoscaler
D) Prometheus와 Grafana

<details>
<summary>정답 확인</summary>

**정답: B) metrics-server와 Pod의 resources.requests 설정 ✅**

HPA가 동작하려면 두 가지가 필수이다. 첫째, metrics-server가 설치되어 Pod의 CPU/메모리 사용량 메트릭을 수집해야 한다. 둘째, Pod의 컨테이너에 resources.requests가 설정되어 있어야 HPA가 현재 사용률을 목표 사용률과 비교하여 스케일링 결정을 할 수 있다.

**검증:**
```bash
# metrics-server 설치 확인
kubectl get deployment metrics-server -n kube-system

# metrics-server가 메트릭을 수집하는지 확인
kubectl top pods
kubectl top nodes

# HPA 생성 (CPU 사용률 50% 기준)
kubectl autoscale deployment my-app --min=2 --max=10 --cpu-percent=50

# HPA 상태 확인
kubectl get hpa my-app

# Pod의 resources.requests 확인
kubectl get pod <pod-name> -o jsonpath='{.spec.containers[0].resources}'
```
```text
# kubectl top pods 기대 출력
NAME         CPU(cores)   MEMORY(bytes)
my-app-abc   45m          128Mi
my-app-def   52m          135Mi

# kubectl get hpa 기대 출력
NAME     REFERENCE           TARGETS   MINPODS   MAXPODS   REPLICAS   AGE
my-app   Deployment/my-app   48%/50%   2         10        2          5m

# resources 기대 출력
{"requests":{"cpu":"100m","memory":"256Mi"}}
```

**오답 분석:**
- A) Ingress Controller와 NetworkPolicy: HPA 동작과 무관하다. Ingress Controller는 외부 트래픽 라우팅, NetworkPolicy는 네트워크 트래픽 제어를 담당한다.
- C) VPA와 Cluster Autoscaler: VPA(Vertical Pod Autoscaler)는 Pod의 리소스 요청값을 조정하고, Cluster Autoscaler는 노드 수를 조정한다. 이들은 HPA와 별개의 오토스케일링 도구이다. HPA가 동작하기 위한 필수 요소가 아니다.
- D) Prometheus와 Grafana: Prometheus는 메트릭 수집, Grafana는 시각화 도구이다. Custom Metrics API를 통해 HPA의 메트릭 소스로 Prometheus를 사용할 수 있지만, 기본 CPU/메모리 메트릭은 metrics-server만으로 충분하다.

**내부 동작 원리:**
HPA 컨트롤러는 기본 15초 주기로(--horizontal-pod-autoscaler-sync-period) 다음 과정을 반복한다. (1) metrics-server(또는 Custom Metrics API)에서 대상 Pod의 현재 메트릭을 조회한다. (2) 현재 사용률과 목표 사용률을 비교하여 필요한 레플리카 수를 계산한다: `desiredReplicas = ceil(currentReplicas * (currentMetric / desiredMetric))`. (3) 계산된 레플리카 수가 현재와 다르면 Deployment의 replicas를 업데이트한다. 급격한 스케일링을 방지하기 위해 stabilization window(기본 5분)와 scaling policy가 적용된다.

**CNCF 생태계 맥락:**
metrics-server는 Kubernetes SIG-Instrumentation에서 관리하는 공식 메트릭 수집기이다. KEDA(Kubernetes Event-Driven Autoscaling, CNCF 졸업)는 HPA를 확장하여 Kafka 큐 길이, AWS SQS 메시지 수 등 외부 이벤트 소스 기반 스케일링을 지원하며, Scale-to-Zero도 가능하다. Prometheus Adapter는 Prometheus 메트릭을 Custom Metrics API로 노출하여 HPA의 메트릭 소스로 활용할 수 있게 한다.

**등장 배경:**
고정된 레플리카 수로 운영하면, 트래픽이 적을 때는 리소스 낭비가, 많을 때는 성능 저하가 발생한다. HPA는 실제 부하에 따라 Pod 수를 자동으로 조정하여 비용 효율성과 서비스 품질을 동시에 달성한다. resources.requests가 필수인 이유는, 현재 사용률을 "요청 대비 백분율"로 계산해야 스케일링 결정이 의미 있기 때문이다.
</details>

---

### 문제 32.
Kubernetes에서 Scale-to-Zero가 가능한 서버리스 플랫폼은?

A) Istio
B) Knative
C) Linkerd
D) Envoy

<details>
<summary>정답 확인</summary>

**정답: B) Knative ✅**

Knative는 Google이 주도하는 Kubernetes 기반 서버리스 플랫폼이다. Serving(서빙)과 Eventing(이벤팅) 컴포넌트로 구성되며, 요청이 없을 때 Pod를 0개로 줄이는 Scale-to-Zero 기능을 지원한다. Istio와 Linkerd는 서비스 메시이고, Envoy는 프록시이다.

**검증:**
```bash
# Knative Serving 설치 확인
kubectl get pods -n knative-serving

# Knative Service 생성
kubectl apply -f - <<EOF
apiVersion: serving.knative.dev/v1
kind: Service
metadata:
  name: hello
spec:
  template:
    spec:
      containers:
      - image: gcr.io/knative-samples/helloworld-go
        env:
        - name: TARGET
          value: "World"
EOF

# Knative Service 상태 확인
kubectl get ksvc hello

# 트래픽이 없을 때 Pod가 0으로 축소되는지 확인
kubectl get pods -l serving.knative.dev/service=hello -w
```
```text
# kubectl get ksvc 기대 출력
NAME    URL                                LATESTREADY    LATESTCREATED  READY
hello   http://hello.default.example.com   hello-00001    hello-00001    True

# Pod 축소 관찰 기대 출력 (약 60초 후 트래픽 없으면)
hello-00001-xxx   1/2   Running     0   30s
hello-00001-xxx   0/2   Terminating 0   90s
hello-00001-xxx   0/2   Terminating 0   95s   # Scale-to-Zero
```

**오답 분석:**
- A) Istio: 서비스 메시 프로젝트(CNCF 졸업)이다. 서비스 간 트래픽 관리, mTLS, 관측성을 제공하지만, 서버리스 플랫폼이 아니며 Scale-to-Zero 기능이 없다.
- C) Linkerd: 서비스 메시 프로젝트(CNCF 졸업)이다. Istio보다 경량이지만, 역시 서버리스 기능을 제공하지 않는다.
- D) Envoy: 고성능 L4/L7 프록시(CNCF 졸업)이다. Istio, Contour 등 여러 프로젝트의 Data Plane으로 사용되지만, 서버리스 플랫폼이 아니다.

**내부 동작 원리:**
Knative Serving의 Scale-to-Zero는 다음과 같이 동작한다. (1) Activator가 유휴 서비스로 향하는 요청을 가로챈다. (2) 요청이 들어오면 Activator가 KPA(Knative Pod Autoscaler)에게 스케일 업을 요청한다. (3) Pod가 0에서 1 이상으로 스케일 업되고, 버퍼링된 요청이 전달된다(Cold Start). (4) 설정된 시간(기본 60초) 동안 요청이 없으면 Pod를 0으로 축소한다. KPA는 요청 동시성(concurrency) 또는 RPS(requests per second)를 기준으로 스케일링한다.

**CNCF 생태계 맥락:**
Knative는 CNCF 인큐베이팅 프로젝트이다. Google Cloud Run의 기반 기술이며, Red Hat OpenShift Serverless의 핵심이기도 하다. KEDA(CNCF 졸업)도 Scale-to-Zero를 지원하지만 이벤트 기반 스케일링에 특화되어 있다. OpenFunction(CNCF 샌드박스)은 Knative와 KEDA를 결합한 서버리스 프레임워크이다.

**등장 배경:**
AWS Lambda 같은 클라우드 서버리스 서비스는 벤더에 종속된다. Kubernetes 위에서 서버리스를 구현하면 벤더 독립성을 유지하면서도 "사용한 만큼만 비용 지불"의 이점을 얻을 수 있다. Scale-to-Zero는 트래픽이 없는 시간에 리소스를 완전히 해제하여 비용을 최소화한다. 단, Cold Start 지연(0에서 1로 스케일 업하는 시간)이 트레이드오프이다.
</details>

---

### 문제 33.
Cluster Autoscaler에 대한 설명으로 올바른 것은?

A) Pod의 CPU/메모리 요청값을 자동으로 조정한다
B) Pod의 수를 자동으로 늘리거나 줄인다
C) 리소스 부족으로 Pending 상태인 Pod가 있으면 노드를 추가하고, 사용률이 낮은 노드를 제거한다
D) 서비스 메시의 사이드카 프록시 수를 자동으로 조정한다

<details>
<summary>정답 확인</summary>

**정답: C) 리소스 부족으로 Pending 상태인 Pod가 있으면 노드를 추가하고, 사용률이 낮은 노드를 제거한다 ✅**

Cluster Autoscaler는 클러스터의 노드 수를 자동으로 조정한다. 스케줄링할 수 없는 Pending Pod가 있으면 새 노드를 추가하고, 노드의 리소스 사용률이 낮으면 해당 노드의 Pod를 다른 노드로 이동시킨 후 노드를 제거한다. A는 VPA, B는 HPA의 설명이다.

**검증:**
```bash
# Cluster Autoscaler 상태 확인
kubectl get configmap cluster-autoscaler-status -n kube-system -o yaml

# Pending 상태의 Pod 확인 (스케줄링 불가)
kubectl get pods --field-selector=status.phase=Pending

# 노드 목록 및 할당 가능 리소스 확인
kubectl describe nodes | grep -A5 "Allocated resources"

# Cluster Autoscaler 로그 확인
kubectl logs -n kube-system deployment/cluster-autoscaler | tail -20
```
```text
# Pending Pod 기대 출력
NAME           READY   STATUS    RESTARTS   AGE
my-app-xyz     0/1     Pending   0          30s

# Cluster Autoscaler 로그 기대 출력 (스케일 업 시)
Scale-up: setting group ... size to 4
Successfully added node: ...

# Cluster Autoscaler 로그 기대 출력 (스케일 다운 시)
Node ... is unneeded since ...
Scale-down: removing node ...
```

**오답 분석:**
- A) Pod의 CPU/메모리 요청값을 자동으로 조정한다: VPA(Vertical Pod Autoscaler)의 설명이다. VPA는 Pod의 resources.requests/limits를 워크로드 패턴에 따라 자동으로 조정한다.
- B) Pod의 수를 자동으로 늘리거나 줄인다: HPA(Horizontal Pod Autoscaler)의 설명이다. HPA는 메트릭 기반으로 Deployment의 replicas를 조정한다.
- D) 서비스 메시의 사이드카 프록시 수를 자동으로 조정한다: 이런 기능을 하는 컴포넌트는 존재하지 않는다. 사이드카 프록시는 각 Pod에 자동 주입되며, Pod 수에 따라 자동으로 증감한다.

**내부 동작 원리:**
Cluster Autoscaler는 약 10초 주기로 동작한다. 스케일 업: 스케줄러가 노드 리소스 부족으로 Pod를 배치하지 못해 Pending 상태가 되면, Cluster Autoscaler가 클라우드 프로바이더 API를 호출하여 노드 그룹(ASG, MIG 등)의 크기를 늘린다. 스케일 다운: 노드의 리소스 사용률이 임계값(기본 50%) 미만이고 해당 노드의 모든 Pod가 다른 노드에 스케줄링 가능하면, 10분(기본) 대기 후 노드를 제거한다. PodDisruptionBudget과 `cluster-autoscaler.kubernetes.io/safe-to-evict` 어노테이션을 존중한다.

**CNCF 생태계 맥락:**
Cluster Autoscaler는 Kubernetes SIG-Autoscaling에서 관리한다. 주요 클라우드 프로바이더(AWS, GCP, Azure)별 구현체가 있다. Karpenter(AWS)는 Cluster Autoscaler의 대안으로, 노드 그룹 없이 Pod 요구사항에 맞는 최적의 인스턴스 타입을 직접 프로비저닝한다. HPA + Cluster Autoscaler를 조합하면 Pod 수준과 노드 수준 모두에서 자동 스케일링이 가능하다.

**등장 배경:**
HPA가 Pod 수를 늘려도 노드에 충분한 리소스가 없으면 새 Pod가 Pending 상태에 머문다. 수동으로 노드를 추가하면 비용 낭비가 발생하고, 야간/주말 등 트래픽이 적을 때 노드를 수동으로 축소하는 것도 비효율적이다. Cluster Autoscaler는 워크로드 수요에 따라 노드 수를 자동으로 조정하여, 클라우드 인프라 비용을 최적화한다.
</details>

---

## Cloud Native Observability (문제 34~37)

### 문제 34.
관측성(Observability)의 세 기둥(Three Pillars)을 올바르게 나열한 것은?

A) 메트릭, 로그, 트레이스
B) 모니터링, 경고, 대시보드
C) CPU, 메모리, 디스크
D) Prometheus, Grafana, Jaeger

<details>
<summary>정답 확인</summary>

**정답: A) 메트릭, 로그, 트레이스 ✅**

관측성의 세 기둥은 메트릭(Metrics), 로그(Logs), 트레이스(Traces/Distributed Tracing)이다. 메트릭은 시간에 따른 수치 데이터, 로그는 개별 이벤트의 시간순 기록, 트레이스는 분산 시스템에서 요청이 여러 서비스를 거치는 경로를 추적한 것이다. Prometheus, Grafana, Jaeger는 이를 구현하는 도구이다.

**검증:**
```bash
# 메트릭 확인: Prometheus에서 Pod CPU 사용량 조회
kubectl top pods                    # metrics-server 기반
curl http://prometheus:9090/api/v1/query?query=container_cpu_usage_seconds_total

# 로그 확인: Pod 로그 조회
kubectl logs <pod-name> --tail=10

# 트레이스 확인: Jaeger UI 또는 API
kubectl port-forward svc/jaeger-query 16686:16686
# http://localhost:16686에서 트레이스 조회
```
```text
# kubectl top pods 기대 출력
NAME         CPU(cores)   MEMORY(bytes)
my-app-abc   45m          128Mi

# kubectl logs 기대 출력
2024-01-15T10:30:45Z INFO  Request received: GET /api/users
2024-01-15T10:30:45Z INFO  Database query executed in 15ms
2024-01-15T10:30:46Z INFO  Response sent: 200 OK

# Jaeger 트레이스 기대 출력 (JSON API)
{"traceID":"abc123","spans":[
  {"operationName":"GET /api/users","duration":45000,"serviceName":"api-gateway"},
  {"operationName":"SELECT users","duration":15000,"serviceName":"user-service"}
]}
```

**오답 분석:**
- B) 모니터링, 경고, 대시보드: 관측성을 구현하는 활동/도구이지 관측성의 기둥이 아니다. 모니터링은 메트릭 기반, 경고는 조건 기반 알림, 대시보드는 시각화이다.
- C) CPU, 메모리, 디스크: 이들은 메트릭의 구체적 예시이다. 관측성의 기둥 자체가 아니다.
- D) Prometheus, Grafana, Jaeger: 관측성을 구현하는 도구이다. Prometheus는 메트릭, Jaeger는 트레이스를 담당하지만, 이들은 도구이지 개념적 기둥이 아니다.

**내부 동작 원리:**
세 기둥은 서로 보완적이다. 메트릭(Metrics)은 시계열 데이터로 시스템의 전반적 상태를 파악한다(예: CPU 사용률 90%). 메트릭이 이상을 감지하면 로그(Logs)로 개별 이벤트를 확인한다(예: OOM 에러 발생). 특정 요청의 전체 흐름을 추적하려면 트레이스(Traces)를 사용한다(예: 요청이 API → 인증 → DB → 응답으로 진행되며 DB 쿼리에서 병목 발생). 트레이스는 span으로 구성되며, 각 span은 하나의 작업 단위를 나타낸다.

**CNCF 생태계 맥락:**
각 기둥별 대표적 CNCF 프로젝트: 메트릭은 Prometheus(졸업), 로그는 Fluentd(졸업), 트레이스는 Jaeger(졸업)이다. OpenTelemetry(CNCF 인큐베이팅)는 세 기둥 모두의 데이터를 통합적으로 수집하는 프레임워크이다. Grafana(오픈소스)는 Loki(로그), Tempo(트레이스), Mimir(메트릭)로 세 기둥을 하나의 플랫폼에서 제공한다. Thanos(CNCF 인큐베이팅)는 Prometheus의 장기 스토리지를 제공한다.

**등장 배경:**
모놀리식 아키텍처에서는 하나의 서버 로그만 확인하면 문제를 파악할 수 있었다. 마이크로서비스와 분산 시스템에서는 수십~수백 개의 서비스가 상호작용하므로, 단일 데이터 소스만으로는 시스템 상태를 이해할 수 없다. 관측성(Observability)은 "시스템의 외부 출력만으로 내부 상태를 이해할 수 있는 능력"으로, 메트릭/로그/트레이스 세 기둥을 종합적으로 활용하여 복잡한 분산 시스템의 문제를 진단한다.
</details>

---

### 문제 35.
Prometheus의 메트릭 수집 방식에 대한 설명으로 올바른 것은?

A) 에이전트가 메트릭을 Prometheus 서버로 Push한다
B) Prometheus가 타겟의 /metrics 엔드포인트를 주기적으로 Pull(스크래핑)한다
C) 메시지 큐를 통해 메트릭을 전달한다
D) etcd에 저장된 메트릭을 조회한다

<details>
<summary>정답 확인</summary>

**정답: B) Prometheus가 타겟의 /metrics 엔드포인트를 주기적으로 Pull(스크래핑)한다 ✅**

Prometheus는 Pull 기반 메트릭 수집 모델을 사용한다. 모니터링 대상의 `/metrics` HTTP 엔드포인트를 주기적으로 스크래핑하여 메트릭을 수집한다. Pushgateway를 통한 Push 방식도 지원하지만 이는 단기 실행 작업(batch job) 등 특수한 경우에 사용된다. Pull 방식이 기본이자 권장 방식이다.

**검증:**
```bash
# Pod의 /metrics 엔드포인트 직접 조회
kubectl exec <pod-name> -- curl -s localhost:9090/metrics | head -20

# Prometheus 타겟 상태 확인
curl http://prometheus:9090/api/v1/targets | jq '.data.activeTargets[0]'

# Kubernetes 서비스에서 메트릭 엔드포인트 확인
kubectl get endpoints prometheus-kube-state-metrics

# Prometheus scrape 설정 확인
kubectl get configmap prometheus-config -o yaml | grep scrape_interval
```
```text
# /metrics 엔드포인트 기대 출력
# HELP process_cpu_seconds_total Total user and system CPU time spent in seconds.
# TYPE process_cpu_seconds_total counter
process_cpu_seconds_total 15.23
# HELP go_goroutines Number of goroutines that currently exist.
# TYPE go_goroutines gauge
go_goroutines 42

# targets API 기대 출력
{
  "discoveredLabels": {"__address__":"10.244.1.5:9090"},
  "labels": {"instance":"10.244.1.5:9090","job":"kubernetes-pods"},
  "scrapeUrl": "http://10.244.1.5:9090/metrics",
  "lastScrape": "2024-01-15T10:30:45Z",
  "health": "up"
}
```

**오답 분석:**
- A) 에이전트가 메트릭을 Prometheus 서버로 Push한다: Push 모델은 Datadog, InfluxDB/Telegraf 등이 사용하는 방식이다. Prometheus는 Pull 모델이 기본이다. Pushgateway를 통한 Push는 배치 작업 등 Pull이 어려운 특수한 경우에만 사용한다.
- C) 메시지 큐를 통해 메트릭을 전달한다: Prometheus는 HTTP 기반 직접 스크래핑을 사용한다. 메시지 큐(Kafka, RabbitMQ)를 거치지 않는다.
- D) etcd에 저장된 메트릭을 조회한다: Prometheus는 자체 TSDB(Time Series Database)에 메트릭을 저장한다. Kubernetes의 etcd와는 무관하다.

**내부 동작 원리:**
Prometheus는 설정 파일의 `scrape_configs`에 정의된 타겟을 `scrape_interval`(기본 15초) 주기로 HTTP GET 요청으로 스크래핑한다. 수집된 메트릭은 로컬 TSDB에 시계열 데이터로 저장된다. Service Discovery(Kubernetes SD, DNS SD, file SD 등)를 통해 동적으로 타겟을 발견한다. Kubernetes SD의 경우, API 서버를 watch하여 새로운 Pod/Service가 생성되면 자동으로 스크래핑 대상에 추가한다. Pull 모델의 장점은 타겟의 상태(up/down)를 스크래핑 자체로 파악할 수 있다는 것이다.

**CNCF 생태계 맥락:**
Prometheus는 CNCF의 두 번째 졸업 프로젝트(Kubernetes 다음)이다. Prometheus Operator는 Kubernetes에서 Prometheus를 선언적으로 관리한다. Thanos(CNCF 인큐베이팅)와 Cortex는 Prometheus의 장기 스토리지와 멀티클러스터 페더레이션을 제공한다. Alertmanager(Prometheus 에코시스템)는 알림 라우팅/그루핑/억제를 담당한다. node-exporter, kube-state-metrics 등 다양한 exporter가 Prometheus 메트릭을 노출한다.

**등장 배경:**
기존 모니터링 시스템(Nagios, Zabbix)은 호스트 기반으로, 동적으로 생성/삭제되는 컨테이너 환경에 부적합하였다. Push 모델은 모니터링 대상이 수집 서버를 알아야 하므로, 서비스 디스커버리가 복잡해진다. Prometheus의 Pull 모델은 수집 서버가 타겟을 발견하고 주기적으로 스크래핑하므로, Kubernetes의 동적 환경에 자연스럽게 적합하다. SoundCloud에서 2012년에 개발을 시작하였으며, Google의 Borgmon 시스템에서 영감을 받았다.
</details>

---

### 문제 36.
OpenTelemetry에 대한 설명으로 올바르지 않은 것은?

A) OpenTracing과 OpenCensus가 합병하여 탄생하였다
B) 메트릭, 로그, 트레이스를 위한 통합 프레임워크이다
C) 특정 벤더에 종속된 모니터링 솔루션이다
D) CNCF 인큐베이팅 프로젝트이다

<details>
<summary>정답 확인</summary>

**정답: C) 특정 벤더에 종속된 모니터링 솔루션이다 ✅**

OpenTelemetry(OTel)는 벤더 중립적(vendor-neutral)인 관측성 프레임워크이다. 특정 벤더에 종속되지 않으며, 수집한 텔레메트리 데이터를 Jaeger, Prometheus, Datadog, New Relic 등 다양한 백엔드로 전송할 수 있다. OpenTracing과 OpenCensus의 합병으로 탄생하였으며, CNCF 인큐베이팅 프로젝트이다.

**검증:**
```bash
# OpenTelemetry Collector 배포 확인
kubectl get pods -n observability -l app=otel-collector

# OTel Collector 설정 확인 (다양한 백엔드로 export 가능)
kubectl get configmap otel-collector-config -n observability -o yaml

# 자동 계측(auto-instrumentation) 확인
kubectl get pods -o jsonpath='{range .items[*]}{.metadata.name}{": "}{.metadata.annotations}{"\n"}{end}' | grep instrumentation
```
```text
# OTel Collector 설정 기대 출력 (일부)
exporters:
  jaeger:
    endpoint: "jaeger-collector:14250"
  prometheus:
    endpoint: "0.0.0.0:8889"
  otlp:
    endpoint: "tempo:4317"
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: "0.0.0.0:4317"
      http:
        endpoint: "0.0.0.0:4318"
```

**오답 분석:**
- A) OpenTracing과 OpenCensus가 합병하여 탄생하였다: 맞는 설명이다. 2019년에 두 프로젝트가 합병되었다. OpenTracing(CNCF)은 분산 트레이싱 API 표준, OpenCensus(Google)는 메트릭+트레이스 라이브러리였다.
- B) 메트릭, 로그, 트레이스를 위한 통합 프레임워크이다: 맞는 설명이다. OTel은 관측성의 세 기둥(메트릭, 로그, 트레이스) 모두에 대한 API, SDK, 수집기를 통합적으로 제공한다.
- D) CNCF 인큐베이팅 프로젝트이다: 맞는 설명이다. CNCF에서 Kubernetes 다음으로 활발한 프로젝트 중 하나이다.

**내부 동작 원리:**
OpenTelemetry는 세 가지 핵심 컴포넌트로 구성된다. (1) API: 텔레메트리 데이터를 생성하는 인터페이스(언어별 SDK 제공: Java, Go, Python, JS 등). (2) SDK: API의 구현체로, 데이터를 처리하고 export한다. (3) Collector: 텔레메트리 데이터를 수신(Receiver), 처리(Processor), 전송(Exporter)하는 에이전트/게이트웨이. OTLP(OpenTelemetry Protocol)는 텔레메트리 데이터 전송을 위한 표준 프로토콜로, gRPC와 HTTP를 지원한다.

**CNCF 생태계 맥락:**
OpenTelemetry는 CNCF 관측성 생태계의 통합 표준이다. Jaeger(졸업)는 OTel 트레이스의 백엔드로 사용된다. Prometheus(졸업)는 OTel 메트릭의 백엔드로 사용된다. OTel Collector는 Fluentd/Fluent Bit를 대체하여 로그 수집에도 사용 가능하다. Grafana Tempo, Elastic APM, AWS X-Ray 등 상용 솔루션도 OTel을 네이티브로 지원한다.

**등장 배경:**
OpenTracing과 OpenCensus가 별도로 존재하면서 생태계가 분열되었다. 개발자는 두 프로젝트 중 하나를 선택해야 했고, 라이브러리 간 호환성 문제가 발생했다. OpenTelemetry는 두 프로젝트를 통합하고 로그까지 포함하여, 관측성 데이터의 생성/수집/전송을 위한 단일 표준을 제공한다. 벤더 중립성은 벤더 락인을 방지하고, 언제든 백엔드를 교체할 수 있게 한다.
</details>

---

### 문제 37.
Fluentd에 대한 설명으로 올바른 것은?

A) CNCF 샌드박스 프로젝트이며, 메트릭 수집에 특화되어 있다
B) CNCF 졸업 프로젝트이며, 통합 로깅 계층(Unified Logging Layer)을 제공하는 데이터 수집기이다
C) Grafana Labs에서 개발한 로그 인덱싱 시스템이다
D) 분산 트레이싱 전용 도구이다

<details>
<summary>정답 확인</summary>

**정답: B) CNCF 졸업 프로젝트이며, 통합 로깅 계층(Unified Logging Layer)을 제공하는 데이터 수집기이다 ✅**

Fluentd는 CNCF 졸업 프로젝트인 오픈소스 데이터 수집기(로그 수집기)이다. 다양한 소스에서 로그를 수집하고, 필터링/변환하여 다양한 목적지로 전송하는 통합 로깅 계층을 제공한다. 500개 이상의 플러그인을 지원하며, K8s 환경에서는 DaemonSet으로 배포하는 것이 일반적이다.

**검증:**
```bash
# Fluentd DaemonSet 확인
kubectl get daemonset -n logging

# Fluentd Pod가 모든 노드에서 실행 중인지 확인
kubectl get pods -n logging -l app=fluentd -o wide

# Fluentd 설정 확인
kubectl get configmap fluentd-config -n logging -o yaml

# Fluentd 로그에서 수집 상태 확인
kubectl logs -n logging <fluentd-pod> --tail=10
```
```text
# DaemonSet 기대 출력
NAME      DESIRED   CURRENT   READY   UP-TO-DATE   AVAILABLE
fluentd   3         3         3       3            3

# Fluentd 설정 기대 출력 (일부)
<source>
  @type tail
  path /var/log/containers/*.log
  pos_file /var/log/fluentd-containers.log.pos
  tag kubernetes.*
  <parse>
    @type json
  </parse>
</source>
<match kubernetes.**>
  @type elasticsearch
  host elasticsearch
  port 9200
</match>

# Fluentd 로그 기대 출력
2024-01-15 10:30:45 +0000 [info]: #0 fluentd worker is now running worker=0
2024-01-15 10:30:45 +0000 [info]: #0 following tail of /var/log/containers/nginx-xxx.log
```

**오답 분석:**
- A) CNCF 샌드박스 프로젝트이며, 메트릭 수집에 특화되어 있다: 두 가지 모두 틀렸다. Fluentd는 졸업 프로젝트(샌드박스가 아님)이며, 메트릭이 아닌 로그 수집에 특화되어 있다.
- C) Grafana Labs에서 개발한 로그 인덱싱 시스템이다: Loki의 설명에 가깝다. Loki는 Grafana Labs가 개발한 로그 집계 시스템이다. Fluentd는 Treasure Data가 개발하였으며, 로그 인덱싱이 아닌 로그 수집/전달을 담당한다.
- D) 분산 트레이싱 전용 도구이다: Jaeger나 Zipkin의 설명이다. Fluentd는 트레이싱과 무관하며 로그 수집 도구이다.

**내부 동작 원리:**
Fluentd는 Input → Filter → Output의 파이프라인 구조로 동작한다. Input 플러그인이 다양한 소스(파일 tail, syslog, HTTP, TCP 등)에서 로그를 수집하고, Filter 플러그인이 로그를 변환/가공(파싱, 필드 추가/제거, 정규화)하며, Output 플러그인이 다양한 목적지(Elasticsearch, S3, Kafka, Loki 등)로 전송한다. 내부적으로 메시지 버퍼링과 재시도 메커니즘을 제공하여 데이터 유실을 방지한다. Ruby로 작성되었으며, C 기반 경량 버전인 Fluent Bit도 있다.

**CNCF 생태계 맥락:**
Fluentd는 CNCF의 여섯 번째 졸업 프로젝트이다. Kubernetes에서의 로깅 아키텍처 패턴으로는 EFK 스택(Elasticsearch + Fluentd + Kibana)이 대표적이다. 최근에는 경량 버전인 Fluent Bit(CNCF 졸업)가 노드 에이전트로, Fluentd가 집계기(aggregator)로 사용되는 2-tier 아키텍처가 일반적이다. Grafana Loki + Fluent Bit 조합도 널리 사용된다.

**등장 배경:**
분산 시스템에서는 로그가 수십~수백 개의 서비스와 노드에 분산되어 있다. 각 서비스가 서로 다른 형식으로 로그를 생성하므로, 통합 관리가 어렵다. Fluentd는 "통합 로깅 계층"이라는 개념으로, 다양한 소스의 로그를 일관된 형식으로 변환하고 중앙 저장소로 전달하는 역할을 한다. 500개 이상의 플러그인 생태계를 통해 거의 모든 로그 소스와 목적지를 연결할 수 있다.
</details>

---

## Cloud Native Application Delivery (문제 38~40)

### 문제 38.
GitOps의 핵심 원칙이 아닌 것은?

A) 모든 시스템 상태를 선언적으로 기술한다
B) Git을 단일 진실 소스(Single Source of Truth)로 사용한다
C) 변경 사항은 수동으로 서버에 SSH 접속하여 적용한다
D) 에이전트가 실제 상태를 감시하고 원하는 상태와의 차이를 자동으로 수정한다

<details>
<summary>정답 확인</summary>

**정답: C) 변경 사항은 수동으로 서버에 SSH 접속하여 적용한다 ✅**

GitOps에서 변경 사항은 Git에 커밋되고, 에이전트가 이를 감지하여 자동으로 시스템에 적용한다. 서버에 직접 SSH 접속하여 수동으로 변경하는 것은 GitOps 원칙에 위배된다. GitOps의 핵심은 선언적 설정, Git을 단일 진실 소스로 사용, 승인된 변경의 자동 적용, 지속적 조정(Reconciliation)이다.

**검증:**
```bash
# ArgoCD에서 GitOps 동기화 상태 확인
kubectl get applications -n argocd

# ArgoCD Application 상세 상태 확인
kubectl describe application my-app -n argocd | grep -A5 "Sync Status"

# Flux에서 GitOps 동기화 상태 확인
kubectl get gitrepositories -A
kubectl get kustomizations -A

# Git 커밋 후 자동 동기화 확인
kubectl get events -n argocd --sort-by='.lastTimestamp' | tail -5
```
```text
# ArgoCD applications 기대 출력
NAME     SYNC STATUS   HEALTH STATUS   PROJECT
my-app   Synced        Healthy         default

# ArgoCD describe 기대 출력
  Sync Status:    Synced
  Health Status:  Healthy
  Source:
    Repo URL:  https://github.com/org/k8s-manifests.git
    Path:      apps/my-app
    Target Revision:  main

# Flux gitrepositories 기대 출력
NAMESPACE     NAME        URL                                          READY
flux-system   my-repo     https://github.com/org/k8s-manifests.git     True
```

**오답 분석:**
- A) 모든 시스템 상태를 선언적으로 기술한다: GitOps의 핵심 원칙이다. 명령형(imperative) 방식이 아닌 선언형(declarative) 방식으로 시스템 상태를 Git에 기술한다.
- B) Git을 단일 진실 소스(Single Source of Truth)로 사용한다: GitOps의 핵심 원칙이다. Git 저장소가 시스템의 원하는 상태를 정의하는 유일한 소스이다.
- D) 에이전트가 실제 상태를 감시하고 원하는 상태와의 차이를 자동으로 수정한다: GitOps의 핵심 원칙이다. 지속적 조정(Continuous Reconciliation)을 통해 드리프트(drift)를 자동으로 감지하고 수정한다.

**내부 동작 원리:**
GitOps 에이전트(ArgoCD, Flux)는 지속적으로 Git 저장소를 폴링하거나 webhook으로 변경을 감지한다. 새 커밋이 감지되면 Git의 선언적 매니페스트와 클러스터의 현재 상태를 비교(diff)한다. 차이가 있으면 `kubectl apply`와 유사한 방식으로 변경을 적용한다. 이 조정 루프는 수동 변경(kubectl edit, kubectl delete 등)으로 인한 드리프트도 감지하여 Git의 상태로 자동 복원한다. Pull 기반 모델이므로 CI 시스템에 클러스터 접근 권한을 부여할 필요가 없다.

**CNCF 생태계 맥락:**
ArgoCD(CNCF 졸업)와 Flux(CNCF 졸업)는 GitOps의 양대 산맥이다. CNCF는 OpenGitOps 프로젝트를 통해 GitOps의 원칙과 용어를 표준화하였다. GitOps의 4대 원칙: (1) 선언적(Declarative), (2) 버전 관리(Versioned and Immutable), (3) 자동 적용(Pulled Automatically), (4) 지속적 조정(Continuously Reconciled). Crossplane(CNCF 인큐베이팅)은 GitOps를 인프라(AWS, GCP 리소스)까지 확장한다.

**등장 배경:**
전통적 배포 방식은 CI 서버가 클러스터에 직접 `kubectl apply`를 실행하는 Push 모델이었다. 이 방식은 CI에 클러스터 관리자 권한이 필요하고(보안 위험), 수동 변경 추적이 어렵고, 롤백이 복잡하다. GitOps는 Weaveworks의 Alexis Richardson이 2017년에 제안한 패턴으로, Git을 중심으로 배포 프로세스를 표준화하여 감사 추적(audit trail), 자동 롤백, 재현 가능한 배포를 제공한다.
</details>

---

### 문제 39.
Helm에 대한 설명으로 올바르지 않은 것은?

A) Kubernetes의 패키지 매니저이다
B) Chart는 여러 K8s 매니페스트를 하나의 패키지로 묶은 것이다
C) Helm v3에서는 클러스터 내에 Tiller를 반드시 설치해야 한다
D) helm install, helm upgrade, helm rollback 명령어를 지원한다

<details>
<summary>정답 확인</summary>

**정답: C) Helm v3에서는 클러스터 내에 Tiller를 반드시 설치해야 한다 ✅**

Helm v3에서는 Tiller가 제거되었다. Helm v2에서는 클러스터 내에 Tiller 서버 컴포넌트가 필요했으나, 보안 문제 등의 이유로 v3에서 완전히 제거되었다. Helm v3는 클라이언트만으로 동작하며, kubeconfig를 사용하여 직접 K8s API 서버와 통신한다.

**검증:**
```bash
# Helm 버전 확인 (v3에서는 Tiller 없음)
helm version

# 설치된 릴리스 목록 확인
helm list -A

# Chart 저장소 목록 확인
helm repo list

# Chart 정보 확인
helm show chart prometheus-community/prometheus

# 릴리스 히스토리 확인
helm history my-release
```
```text
# helm version 기대 출력
version.BuildInfo{Version:"v3.14.x", GitCommit:"abc123", GoVersion:"go1.21.x"}

# helm list 기대 출력
NAME          NAMESPACE   REVISION   STATUS     CHART               APP VERSION
prometheus    monitoring  3          deployed   prometheus-25.x.x   2.50.x
argocd        argocd      1          deployed   argo-cd-6.x.x       2.10.x

# helm history 기대 출력
REVISION   STATUS       CHART               DESCRIPTION
1          superseded   my-app-1.0.0        Install complete
2          superseded   my-app-1.1.0        Upgrade complete
3          deployed     my-app-1.2.0        Upgrade complete
```

**오답 분석:**
- A) Kubernetes의 패키지 매니저이다: 맞는 설명이다. Helm은 apt(Debian), brew(macOS)와 같은 역할을 Kubernetes 환경에서 수행한다.
- B) Chart는 여러 K8s 매니페스트를 하나의 패키지로 묶은 것이다: 맞는 설명이다. Chart는 Deployment, Service, ConfigMap, Secret 등 관련 리소스를 하나의 패키지로 묶어 설치/관리한다.
- D) helm install, helm upgrade, helm rollback 명령어를 지원한다: 맞는 설명이다. 릴리스 생명주기 관리를 위한 핵심 명령어이다.

**내부 동작 원리:**
Helm v3는 클라이언트 전용 아키텍처이다. `helm install` 실행 시: (1) Chart 템플릿을 values와 결합하여 Kubernetes 매니페스트로 렌더링(Go Template 엔진 사용). (2) 렌더링된 매니페스트를 kube-apiserver에 직접 전송. (3) 릴리스 정보(릴리스 이름, 버전, 매니페스트)를 Kubernetes Secret(기본) 또는 ConfigMap으로 해당 네임스페이스에 저장. 이전 버전의 릴리스 정보도 보존하여 `helm rollback`으로 이전 상태로 복원 가능하다.

**CNCF 생태계 맥락:**
Helm은 CNCF 졸업 프로젝트이다. 대부분의 CNCF 프로젝트(Prometheus, ArgoCD, Cilium, Istio 등)가 공식 Helm Chart를 제공한다. Artifact Hub(CNCF 프로젝트)는 Helm Chart를 검색하고 발견하는 중앙 허브이다. Helmfile은 여러 Helm 릴리스를 선언적으로 관리하는 도구이다. Kustomize는 Helm의 대안으로, 오버레이 기반의 매니페스트 커스터마이징을 제공한다.

**등장 배경:**
Kubernetes 애플리케이션은 여러 매니페스트 파일(Deployment, Service, ConfigMap 등)로 구성된다. 매번 `kubectl apply -f`로 개별 파일을 적용하면 관리가 번거롭고, 환경별 설정 변경이 어렵다. Helm v2의 Tiller는 클러스터 내에서 cluster-admin 권한으로 실행되어 보안 위험이 컸다(RBAC을 우회). Helm v3는 Tiller를 제거하고, 사용자의 kubeconfig 권한을 그대로 사용하여 보안을 강화하였다.
</details>

---

### 문제 40.
ArgoCD와 Flux의 공통점으로 올바른 것은?

A) 둘 다 CI(Continuous Integration) 도구이다
B) 둘 다 GitOps 원칙에 따라 Git 저장소의 변경 사항을 K8s 클러스터에 자동 동기화하는 CD 도구이다
C) 둘 다 컨테이너 이미지를 빌드하는 도구이다
D) 둘 다 서비스 메시 도구이다

<details>
<summary>정답 확인</summary>

**정답: B) 둘 다 GitOps 원칙에 따라 Git 저장소의 변경 사항을 K8s 클러스터에 자동 동기화하는 CD 도구이다 ✅**

ArgoCD와 Flux는 모두 CNCF 졸업 프로젝트이며, GitOps 원칙을 따르는 Kubernetes용 지속적 배포(Continuous Deployment) 도구이다. 둘 다 Git 저장소를 단일 진실 소스로 사용하여 K8s 클러스터의 상태를 자동으로 동기화한다. ArgoCD는 풍부한 웹 UI를 제공하고, Flux는 여러 컨트롤러로 구성된 모듈형 아키텍처를 특징으로 한다.

**검증:**
```bash
# ArgoCD 설치 확인
kubectl get pods -n argocd
kubectl get applications -n argocd

# Flux 설치 확인
kubectl get pods -n flux-system
kubectl get gitrepositories -n flux-system
kubectl get kustomizations -n flux-system

# ArgoCD 동기화 상태 확인
kubectl get app my-app -n argocd -o jsonpath='{.status.sync.status}'

# Flux 동기화 상태 확인
kubectl get kustomization my-app -n flux-system -o jsonpath='{.status.conditions[0].reason}'
```
```text
# ArgoCD pods 기대 출력
NAME                                  READY   STATUS    AGE
argocd-server-xxx                     1/1     Running   5d
argocd-repo-server-xxx                1/1     Running   5d
argocd-application-controller-xxx     1/1     Running   5d

# Flux pods 기대 출력
NAME                                    READY   STATUS    AGE
source-controller-xxx                   1/1     Running   5d
kustomize-controller-xxx                1/1     Running   5d
helm-controller-xxx                     1/1     Running   5d
notification-controller-xxx             1/1     Running   5d

# ArgoCD sync status 기대 출력
Synced

# Flux kustomization status 기대 출력
ReconciliationSucceeded
```

**오답 분석:**
- A) 둘 다 CI(Continuous Integration) 도구이다: CI(빌드, 테스트)가 아닌 CD(배포) 도구이다. CI는 Jenkins, GitHub Actions, GitLab CI 등이 담당한다. ArgoCD와 Flux는 빌드된 결과물을 클러스터에 배포하는 역할이다.
- C) 둘 다 컨테이너 이미지를 빌드하는 도구이다: 이미지 빌드와 무관하다. 이미지 빌드는 Docker, Buildah, kaniko 등이 담당한다.
- D) 둘 다 서비스 메시 도구이다: 서비스 메시는 Istio, Linkerd가 담당한다. ArgoCD/Flux는 배포 자동화 도구이다.

**내부 동작 원리:**
ArgoCD는 Application CRD로 배포 대상을 정의한다. Application Controller가 주기적으로(기본 3분) Git 저장소를 폴링하거나 webhook으로 변경을 감지하고, 클러스터 상태와 비교하여 동기화한다. Flux는 GitRepository, Kustomization, HelmRelease 등 여러 CRD로 구성된 모듈형 아키텍처이다. Source Controller가 Git/Helm 저장소를 폴링하고, Kustomize/Helm Controller가 매니페스트를 클러스터에 적용한다. 둘 다 Pull 모델(클러스터 내 에이전트가 Git을 폴링)을 사용하여 클러스터 외부에서의 접근 없이 동기화한다.

**CNCF 생태계 맥락:**
ArgoCD(CNCF 졸업, Intuit 기원)와 Flux(CNCF 졸업, Weaveworks 기원)는 GitOps의 양대 프로젝트이다. ArgoCD 생태계에는 Argo Rollouts(프로그레시브 배포), Argo Workflows(워크플로우), Argo Events(이벤트 기반 자동화)가 있다. Flux 생태계에는 Flagger(카나리/블루-그린 배포)가 있다. 둘 다 Helm, Kustomize, 순수 YAML 매니페스트를 지원한다.

**등장 배경:**
전통적 CI/CD 파이프라인에서는 CI 서버가 클러스터에 Push 방식으로 배포했다. 이 방식의 문제점: (1) CI 서버에 클러스터 관리 권한이 필요하여 보안 위험. (2) 클러스터의 실제 상태와 Git의 상태가 불일치(drift)할 수 있음. (3) 누가, 언제, 무엇을 변경했는지 추적 어려움. ArgoCD와 Flux는 GitOps 패턴으로 이러한 문제를 해결한다. Git 커밋 히스토리가 곧 배포 히스토리이며, 드리프트를 자동 감지/수정하고, 클러스터 내 에이전트가 Pull하므로 외부 접근 권한이 불필요하다.
</details>

---

## 채점 기준

| 도메인 | 문항 수 | 문항 번호 | 비율 |
|--------|---------|----------|------|
| Kubernetes Fundamentals | 18 | 1~18 | 45% |
| Container Orchestration | 9 | 19~27 | 22.5% |
| Cloud Native Architecture | 6 | 28~33 | 15% |
| Cloud Native Observability | 4 | 34~37 | 10% |
| Cloud Native Application Delivery | 3 | 38~40 | 7.5% |
| **합계** | **40** | | **100%** |

> 실제 KCNA 시험은 60문항에 90분이 주어지며, 75% 이상 득점 시 합격이다.
