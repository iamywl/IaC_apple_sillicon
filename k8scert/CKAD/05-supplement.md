# CKAD 보충 학습 자료

> 기존 학습 자료(01~04)에서 다루지 않은 핵심 개념과 추가 실전 예제, 확인 문제, 기출 유형 덤프 문제를 정리한 보충 문서이다.
> 기술 용어는 영어를 병기하며, 모든 YAML은 시험에서 바로 사용할 수 있도록 완전한 형태로 작성하였다.
> 각 개념은 배경(기존 기법의 한계), 동작 원리, 엣지 케이스를 포함하며, 모든 예제에는 검증 명령어와 기대 출력을 제공한다.
> 모든 실습 단계에 내부 동작 원리, 트러블슈팅, 장애 시나리오를 포함한다.

---

## Part 1: 누락된 개념 보강

---

### 1.1 StatefulSet

#### 배경: Deployment의 한계

Deployment는 모든 Pod를 동일하고 교체 가능한(interchangeable) 존재로 취급한다. Pod 이름은 `deployment-name-<replicaset-hash>-<random>` 형태의 무작위 문자열이며, 어떤 순서로든 생성/삭제될 수 있다. 이 설계는 stateless 애플리케이션에는 적합하지만, 다음과 같은 stateful 애플리케이션에서는 심각한 문제를 유발한다:

- **데이터베이스 (MySQL, PostgreSQL)**: 각 인스턴스가 고유한 데이터 디렉터리를 가져야 한다. Pod가 재시작되면 동일한 PV에 다시 연결되어야 하지만, Deployment는 이를 보장하지 않는다.
- **메시징 시스템 (Kafka, ZooKeeper)**: 각 브로커/노드가 고유한 ID를 가지고 서로를 식별해야 한다. 무작위 Pod 이름으로는 안정적인 클러스터 멤버십을 구성할 수 없다.
- **순서 의존적 시스템 (Elasticsearch)**: 마스터 노드가 먼저 기동되어야 데이터 노드가 클러스터에 참여할 수 있다. Deployment는 Pod 생성 순서를 보장하지 않는다.

요약하면, Deployment는 **안정적인 네트워크 ID**, **순차적 기동/종료**, **Pod별 전용 퍼시스턴트 스토리지**를 제공하지 못한다. StatefulSet은 이 세 가지 문제를 해결하기 위해 도입된 워크로드 리소스이다.

#### 동작 원리

StatefulSet 컨트롤러는 다음과 같이 동작한다:

1. **순차적 Pod 생성**: Pod를 ordinal index 순서(0, 1, 2...)로 생성한다. 이전 Pod가 Running 및 Ready 상태가 되어야 다음 Pod를 생성한다.
2. **안정적 이름 부여**: 각 Pod는 `<statefulset-name>-<ordinal>` 형태의 고정된 이름을 받는다. Pod가 삭제되고 재생성되어도 동일한 이름을 유지한다.
3. **Headless Service와 결합한 DNS**: `clusterIP: None`인 Headless Service와 함께 사용하면, 각 Pod에 `<pod-name>.<service-name>.<namespace>.svc.cluster.local` 형태의 안정적 DNS 레코드가 생성된다.
4. **volumeClaimTemplates**: StatefulSet spec에 `volumeClaimTemplates`를 정의하면, 각 Pod마다 개별 PVC가 자동으로 생성된다. PVC 이름은 `<volume-name>-<statefulset-name>-<ordinal>` 형태이다. Pod가 삭제되어도 PVC는 유지되며, 동일한 ordinal의 Pod가 재생성되면 기존 PVC에 다시 연결된다.

**내부 동작 원리 — 컨트롤러 루프:**

StatefulSet 컨트롤러는 kube-controller-manager 내에서 동작하는 control loop이다. 매 sync 주기마다 다음을 수행한다:

1. StatefulSet의 desired state(spec.replicas)를 확인한다.
2. 현재 존재하는 Pod 목록을 ordinal 순서로 정렬한다.
3. 부족한 Pod가 있으면 가장 작은 빠진 ordinal부터 생성한다.
4. 초과 Pod가 있으면 가장 큰 ordinal부터 삭제한다.
5. Pod의 spec이 변경되었으면(이미지 업데이트 등) 업데이트 전략에 따라 처리한다.

`OrderedReady` 정책(기본값)에서는 이전 Pod가 Running+Ready가 아니면 다음 Pod를 생성하지 않는다. 이는 분산 시스템에서 클러스터 멤버십 초기화 순서를 보장하기 위함이다.

**핵심 특징**

| 특징 | 설명 |
|------|------|
| 순서 기반 이름(Ordinal Naming) | Pod 이름이 `<statefulset-name>-0`, `-1`, `-2` 형태로 고정된다 |
| 순차적 스케일링(Ordered Scaling) | Pod 생성은 0번부터 순서대로, 삭제는 역순으로 진행된다 |
| 안정적 네트워크 ID | Headless Service와 결합하여 `<pod-name>.<service-name>.<namespace>.svc.cluster.local` DNS를 제공한다 |
| 안정적 스토리지 | `volumeClaimTemplates`로 각 Pod마다 고유한 PVC를 자동 생성한다 |

**Headless Service**

StatefulSet과 함께 사용하는 Headless Service는 `clusterIP: None`으로 설정한다. 일반 ClusterIP Service는 가상 IP를 통해 로드밸런싱하지만, Headless Service는 각 Pod의 IP를 DNS A 레코드로 직접 반환한다. 이를 통해 클라이언트가 특정 Pod에 직접 접근할 수 있다.

**내부 동작 — Headless Service DNS 해석:**

CoreDNS가 Headless Service에 대한 DNS 쿼리를 처리하는 방식:

1. 클라이언트가 `mysql-headless.default.svc.cluster.local`에 대한 A 레코드를 질의한다.
2. CoreDNS가 쿠버네티스 API에서 해당 Service의 Endpoints를 조회한다.
3. 모든 Ready Pod의 IP 주소를 A 레코드로 반환한다.
4. 개별 Pod DNS(`mysql-0.mysql-headless.default.svc.cluster.local`)에 대한 질의는 해당 Pod의 IP만 반환한다.

일반 ClusterIP Service는 Service의 가상 IP(ClusterIP)만 반환하므로 개별 Pod에 접근할 수 없다.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: mysql-headless
  labels:
    app: mysql
spec:
  ports:
    - port: 3306
      name: mysql
  clusterIP: None
  selector:
    app: mysql
```

**StatefulSet YAML 예제**

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: mysql
spec:
  serviceName: mysql-headless    # 반드시 Headless Service 이름을 지정한다
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
              name: mysql
          env:
            - name: MYSQL_ROOT_PASSWORD
              value: "rootpassword"
          volumeMounts:
            - name: data
              mountPath: /var/lib/mysql
  volumeClaimTemplates:          # Pod마다 개별 PVC가 생성된다
    - metadata:
        name: data
      spec:
        accessModes: ["ReadWriteOnce"]
        resources:
          requests:
            storage: 10Gi
```

**검증**

```bash
# StatefulSet 상태 확인
kubectl get statefulset mysql
```

```text
NAME    READY   AGE
mysql   3/3     2m
```

```bash
# Pod 이름이 순서대로 생성되었는지 확인
kubectl get pods -l app=mysql
```

```text
NAME      READY   STATUS    RESTARTS   AGE
mysql-0   1/1     Running   0          2m
mysql-1   1/1     Running   0          90s
mysql-2   1/1     Running   0          60s
```

```bash
# 개별 PVC 확인
kubectl get pvc
```

```text
NAME           STATUS   VOLUME   CAPACITY   ACCESS MODES   AGE
data-mysql-0   Bound    pv-xx    10Gi       RWO            2m
data-mysql-1   Bound    pv-yy    10Gi       RWO            90s
data-mysql-2   Bound    pv-zz    10Gi       RWO            60s
```

```bash
# DNS 확인 (임시 Pod에서 nslookup 실행)
kubectl run dns-test --image=busybox:1.36 --rm -it --restart=Never -- nslookup mysql-0.mysql-headless.default.svc.cluster.local
```

```text
Server:    10.96.0.10
Address:   10.96.0.10:53
Name:      mysql-0.mysql-headless.default.svc.cluster.local
Address:   10.244.1.5
```

**스케일링 동작**

- Scale Up: 0 -> 1 -> 2 순서로 이전 Pod가 Running 상태가 되어야 다음 Pod를 생성한다.
- Scale Down: 2 -> 1 -> 0 역순으로 삭제한다.
- `podManagementPolicy: Parallel`로 설정하면 동시에 생성/삭제할 수 있다. 그러나 이 경우 순서 보장이 사라지므로, 순서 의존적 애플리케이션에서는 사용하면 안 된다.

**업데이트 전략:**

| 전략 | 동작 |
|------|------|
| `RollingUpdate` (기본값) | 역순(N-1 -> 0)으로 Pod를 하나씩 교체한다. `partition` 필드를 설정하면 해당 ordinal 이상의 Pod만 업데이트한다 (단계적 롤아웃에 유용) |
| `OnDelete` | 사용자가 수동으로 Pod를 삭제해야 새 버전으로 재생성된다 |

```bash
# partition을 사용한 단계적 업데이트 예시
# partition=2이면 mysql-2만 새 버전으로 업데이트하고, mysql-0, mysql-1은 기존 버전 유지
kubectl patch statefulset mysql --type='json' -p='[{"op":"replace","path":"/spec/updateStrategy/rollingUpdate/partition","value":2}]'
```

**트러블슈팅:**

| 증상 | 원인 | 해결 |
|------|------|------|
| Pod가 Pending 상태 | PVC 바인딩 실패 (StorageClass 없음 또는 PV 부족) | `kubectl get pvc`, StorageClass 확인 |
| mysql-1이 생성되지 않음 | mysql-0이 Ready가 아님 | `kubectl describe pod mysql-0`, Readiness Probe 확인 |
| Pod 재생성 후 데이터 유실 | PVC가 삭제됨 (수동 삭제) | PVC 삭제하지 않도록 주의, reclaimPolicy 확인 |
| DNS 해석 실패 | Headless Service가 존재하지 않음 | `kubectl get svc mysql-headless` 확인 |

**엣지 케이스**

- StatefulSet을 삭제해도 연결된 PVC는 자동으로 삭제되지 않는다. 데이터 보존을 위한 안전 장치이며, 수동으로 PVC를 삭제해야 한다.
- Pod가 `Terminating` 상태에서 멈추면 `kubectl delete pod <name> --force --grace-period=0`으로 강제 삭제할 수 있지만, 분산 시스템에서는 split-brain 문제가 발생할 수 있으므로 주의해야 한다.
- `serviceName` 필드에 지정한 Headless Service가 존재하지 않으면 StatefulSet은 생성되지만, Pod DNS가 작동하지 않는다. 반드시 Headless Service를 먼저 생성해야 한다.
- StatefulSet Pod를 수동으로 삭제하면, 동일한 이름과 ordinal로 재생성된다. 동일한 PVC에 다시 연결되므로 데이터가 보존된다.

**장애 시나리오 — PVC 바인딩 실패:**

```bash
# PVC가 Pending 상태인 경우 진단
kubectl get pvc -l app=mysql
```

```text
NAME           STATUS    VOLUME   CAPACITY   ACCESS MODES   STORAGECLASS   AGE
data-mysql-0   Pending                                                      30s
```

```bash
# 원인 확인
kubectl describe pvc data-mysql-0
```

```text
Events:
  Warning  ProvisioningFailed  5s  persistentvolume-controller
    storageclass.storage.k8s.io "standard" not found
```

해결: StorageClass를 생성하거나, volumeClaimTemplates에 올바른 storageClassName을 지정한다.

---

### 1.2 DaemonSet

#### 배경: 노드별 에이전트 배포의 어려움

클러스터의 모든 노드에 로그 수집기나 모니터링 에이전트를 배포해야 하는 상황을 가정한다. Deployment를 사용하면 다음과 같은 문제가 발생한다:

- **레플리카 수를 노드 수와 동기화해야 한다**: 노드가 추가/제거될 때마다 수동으로 replicas 수를 변경해야 한다.
- **Pod가 특정 노드에만 몰릴 수 있다**: 스케줄러는 리소스 가용성에 따라 Pod를 배치하므로, 일부 노드에는 에이전트가 없을 수 있다.
- **노드당 정확히 하나만 실행되어야 한다**: Deployment는 노드당 Pod 수를 제어하는 메커니즘이 없다.

DaemonSet은 이 문제를 해결하기 위해 존재한다. DaemonSet 컨트롤러는 클러스터의 모든 노드(또는 nodeSelector/affinity로 지정한 노드)에 **정확히 하나의 Pod**를 자동으로 배포한다. 새로운 노드가 클러스터에 추가되면 자동으로 Pod가 배포되고, 노드가 제거되면 해당 Pod도 함께 제거된다.

#### 동작 원리

DaemonSet 컨트롤러는 주기적으로 클러스터의 노드 목록을 확인한다. 각 노드에 대해:
1. 해당 노드에 DaemonSet Pod가 없으면 새로 생성한다.
2. 해당 노드에 DaemonSet Pod가 이미 있으면 아무것도 하지 않는다.
3. 노드가 제거되면 해당 Pod도 가비지 컬렉션에 의해 제거된다.

내부적으로 DaemonSet 컨트롤러는 각 Pod에 `nodeName` 또는 `nodeAffinity`를 설정하여 특정 노드에 강제 배치한다. 스케줄러를 우회하는 것이 아니라, 스케줄러가 올바른 노드에 배치하도록 affinity를 설정하는 방식이다.

**내부 동작 상세:**

쿠버네티스 1.12 이전에는 DaemonSet 컨트롤러가 Pod의 `spec.nodeName`을 직접 설정하여 스케줄러를 우회하였다. 이 방식은 스케줄러의 리소스 확인, taint/toleration 처리 등을 건너뛰는 문제가 있었다. 1.12 이후로는 `nodeAffinity`를 사용하여 스케줄러를 통해 배치한다. 이를 통해:

- 스케줄러가 리소스 가용성을 확인한다.
- taint/toleration이 올바르게 처리된다.
- 노드의 unschedulable 상태가 존중된다 (단, DaemonSet Pod는 기본적으로 unschedulable 노드에도 배치된다).

**주요 용도**

- 로그 수집 에이전트 (fluentd, filebeat, fluent-bit)
- 모니터링 에이전트 (node-exporter, datadog-agent)
- 네트워크 플러그인 (kube-proxy, calico-node, cilium-agent)
- 스토리지 데몬 (ceph, glusterd)

**nodeSelector를 사용한 특정 노드 선택**

```yaml
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: monitoring-agent
  namespace: monitoring
spec:
  selector:
    matchLabels:
      app: monitoring-agent
  template:
    metadata:
      labels:
        app: monitoring-agent
    spec:
      nodeSelector:
        disk: ssd                # disk=ssd 레이블이 있는 노드에만 배포한다
      containers:
        - name: agent
          image: datadog/agent:7
          resources:
            limits:
              memory: 256Mi
              cpu: 250m
            requests:
              memory: 128Mi
              cpu: 100m
```

**검증**

```bash
# DaemonSet 상태 확인
kubectl get daemonset monitoring-agent -n monitoring
```

```text
NAME               DESIRED   CURRENT   READY   UP-TO-DATE   AVAILABLE   NODE SELECTOR   AGE
monitoring-agent   2         2         2       2            2           disk=ssd        30s
```

```bash
# 각 Pod가 어떤 노드에 배포되었는지 확인
kubectl get pods -n monitoring -o wide -l app=monitoring-agent
```

```text
NAME                     READY   STATUS    NODE
monitoring-agent-abc12   1/1     Running   node1
monitoring-agent-def34   1/1     Running   node3
```

```bash
# disk=ssd 레이블이 있는 노드 확인
kubectl get nodes -l disk=ssd
```

```text
NAME    STATUS   ROLES    AGE
node1   Ready    <none>   10d
node3   Ready    <none>   10d
```

**tolerations를 사용한 컨트롤 플레인 노드 배포**

기본적으로 컨트롤 플레인 노드에는 `node-role.kubernetes.io/control-plane:NoSchedule` taint가 설정되어 있어 일반 Pod가 스케줄되지 않는다. DaemonSet에 toleration을 추가하면 컨트롤 플레인 노드에도 배포할 수 있다.

```yaml
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: fluentd
  namespace: kube-system
spec:
  selector:
    matchLabels:
      app: fluentd
  template:
    metadata:
      labels:
        app: fluentd
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
      volumes:
        - name: varlog
          hostPath:
            path: /var/log
```

**검증**

```bash
# 컨트롤 플레인 노드를 포함한 모든 노드에 Pod가 배포되었는지 확인
kubectl get pods -n kube-system -l app=fluentd -o wide
```

```text
NAME            READY   STATUS    NODE
fluentd-abc12   1/1     Running   control-plane
fluentd-def34   1/1     Running   node1
fluentd-ghi56   1/1     Running   node2
```

```bash
# DESIRED와 CURRENT가 클러스터 전체 노드 수와 일치하는지 확인
kubectl get ds fluentd -n kube-system
```

```text
NAME      DESIRED   CURRENT   READY   UP-TO-DATE   AVAILABLE   AGE
fluentd   3         3         3       3            3           1m
```

**DaemonSet 업데이트 전략**

| 전략 | 동작 | 사용 시나리오 |
|------|------|------------|
| `RollingUpdate` (기본값) | 한 번에 하나씩 Pod를 교체한다 | 일반적인 업데이트 |
| `OnDelete` | 수동으로 Pod를 삭제해야 새 버전이 배포된다 | 노드별 수동 검증이 필요한 경우 |

```yaml
spec:
  updateStrategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 1          # 한 번에 업데이트하는 Pod 수
```

**내부 동작 — maxUnavailable 계산:**

DaemonSet의 `maxUnavailable`은 Deployment와 달리 노드 수 기준으로 적용된다. `maxUnavailable: 1`이면 한 번에 한 노드의 DaemonSet Pod만 교체한다. `maxSurge`는 DaemonSet에서 지원되지 않는다 (노드당 정확히 하나의 Pod만 실행해야 하므로).

**트러블슈팅:**

| 증상 | 원인 | 해결 |
|------|------|------|
| DESIRED와 CURRENT가 다름 | 일부 노드에 Pod 생성 실패 | `kubectl describe pod <pending-pod>` 확인 |
| Pod가 Pending | 노드 리소스 부족 | `kubectl describe node <node>`, DaemonSet 리소스 요청 감소 |
| 특정 노드에 Pod 미배포 | 노드에 taint가 설정됨 | toleration 추가 또는 taint 제거 |
| Pod가 CrashLoopBackOff | hostPath 볼륨 경로 부재 | 노드에 해당 디렉터리 생성 |

**엣지 케이스**

- `maxUnavailable`을 노드 수보다 크게 설정하면 모든 Pod가 동시에 교체된다. 로그 수집이나 모니터링에 공백이 생길 수 있으므로 주의해야 한다.
- DaemonSet Pod가 `Pending` 상태이면 노드의 리소스가 부족한 것이다. `kubectl describe pod`로 이벤트를 확인하여 원인을 파악해야 한다.
- `nodeSelector`를 변경하면 더 이상 매칭되지 않는 노드의 Pod는 자동으로 제거되고, 새로 매칭되는 노드에는 Pod가 생성된다.
- DaemonSet Pod는 `kubectl drain` 시 기본적으로 evict 대상이다. `--ignore-daemonsets` 플래그를 사용하면 DaemonSet Pod를 무시하고 drain을 진행한다.

---

### 1.3 Taints and Tolerations

#### 배경: 노드별 접근 제어의 필요성

쿠버네티스 스케줄러는 기본적으로 리소스 가용성에 따라 Pod를 노드에 배치한다. 그러나 운영 환경에서는 다음과 같은 요구사항이 존재한다:

- **전용 노드 확보**: GPU 노드를 GPU 워크로드 전용으로 사용하고 싶지만, 스케줄러가 일반 Pod를 배치할 수 있다.
- **컨트롤 플레인 보호**: 컨트롤 플레인 노드에 사용자 워크로드가 배치되면 클러스터 안정성이 저하된다.
- **노드 유지보수**: 특정 노드를 유지보수 모드로 전환할 때 새로운 Pod가 스케줄되지 않아야 하고, 기존 Pod도 퇴출되어야 한다.

`nodeSelector`나 `nodeAffinity`만으로는 이 문제를 완전히 해결할 수 없다. 이 두 메커니즘은 Pod 입장에서 "어디에 가고 싶은지"를 표현하는 것이지, 노드 입장에서 "누구를 거부할지"를 표현하는 것이 아니다. Taint/Toleration은 노드 입장에서 접근 제어를 수행하는 메커니즘이다.

**nodeSelector/nodeAffinity vs Taint/Toleration:**

| 메커니즘 | 주체 | 동작 | 비유 |
|---------|------|------|------|
| nodeSelector | Pod | "나는 이 노드에 가고 싶다" | 지원자가 회사를 선택 |
| nodeAffinity | Pod | "나는 이런 조건의 노드를 선호한다" | 지원자의 선호 조건 |
| Taint | Node | "나는 이런 Pod를 거부한다" | 회사의 채용 조건 |
| Toleration | Pod | "나는 이 Taint를 견딜 수 있다" | 지원자가 조건을 충족함을 증명 |

일반적인 패턴: Taint로 노드를 보호하고, Toleration + nodeSelector로 허용된 Pod만 배치한다.

#### 동작 원리

Taint는 노드에 설정하는 속성이다. `key=value:effect` 형태로 구성된다. 스케줄러는 Pod를 노드에 배치하기 전에 해당 노드의 taint 목록을 확인한다. Pod에 해당 taint를 허용하는 toleration이 없으면 스케줄링을 거부한다.

Toleration은 Pod에 설정하는 속성이다. "나는 이 taint가 있는 노드에 배치되어도 괜찮다"는 의미이다. toleration이 있다고 해서 반드시 해당 노드에 배치되는 것은 아니다. 단지 배치가 "허용"될 뿐이다.

**Taint Effect 종류**

| Effect | 동작 | 기존 Pod 영향 |
|--------|------|-------------|
| `NoSchedule` | toleration이 없는 새로운 Pod는 스케줄되지 않는다 | 영향 없음 |
| `PreferNoSchedule` | toleration이 없는 Pod를 가능하면 스케줄하지 않으나, 다른 노드에 자리가 없으면 스케줄할 수 있다 (soft 제약) | 영향 없음 |
| `NoExecute` | toleration이 없는 새로운 Pod는 스케줄되지 않고, 기존에 실행 중인 Pod도 **퇴출(evict)**된다 | **퇴출됨** |

`NoSchedule`과 `NoExecute`의 핵심 차이는 기존 Pod에 대한 영향이다. `NoSchedule`은 taint 추가 이후 새로운 Pod만 차단하지만, `NoExecute`는 이미 실행 중인 Pod까지 퇴출한다.

**내부 동작 — NoExecute 퇴출 메커니즘:**

노드에 `NoExecute` taint가 추가되면:
1. kubelet이 해당 노드의 모든 Pod를 순회한다.
2. 각 Pod의 toleration 목록에서 해당 taint를 허용하는 toleration이 있는지 확인한다.
3. toleration이 없는 Pod는 즉시 eviction 대상이 된다.
4. toleration에 `tolerationSeconds`가 설정된 Pod는 해당 시간이 경과한 후 eviction 대상이 된다.
5. eviction은 graceful shutdown을 수행한다 (Pod의 terminationGracePeriodSeconds를 존중).

**Taint 관리 명령어**

```bash
# taint 추가
kubectl taint nodes node1 env=production:NoSchedule

# taint 확인
kubectl describe node node1 | grep -i taint

# taint 제거 (끝에 - 를 붙인다)
kubectl taint nodes node1 env=production:NoSchedule-
```

**검증**

```bash
# taint가 올바르게 설정되었는지 확인
kubectl describe node node1 | grep -A3 Taints
```

```text
Taints:             env=production:NoSchedule
```

```bash
# taint 제거 후 확인
kubectl taint nodes node1 env=production:NoSchedule-
kubectl describe node node1 | grep -A3 Taints
```

```text
node/node1 untainted
Taints:             <none>
```

**Toleration 설정 방법**

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: production-app
spec:
  tolerations:
    # Equal 연산자: key, value, effect가 모두 일치해야 한다
    - key: "env"
      operator: "Equal"
      value: "production"
      effect: "NoSchedule"
  containers:
    - name: app
      image: nginx:1.25
```

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: special-app
spec:
  tolerations:
    # Exists 연산자: key만 일치하면 된다 (value 무시)
    - key: "env"
      operator: "Exists"
      effect: "NoSchedule"
    # NoExecute에 tolerationSeconds를 지정하면 해당 시간 후 퇴출된다
    - key: "node.kubernetes.io/unreachable"
      operator: "Exists"
      effect: "NoExecute"
      tolerationSeconds: 300     # 300초 동안 유지 후 퇴출
  containers:
    - name: app
      image: nginx:1.25
```

**검증**

```bash
# Pod가 taint가 있는 노드에 스케줄되었는지 확인
kubectl get pod production-app -o wide
```

```text
NAME             READY   STATUS    NODE
production-app   1/1     Running   node1
```

```bash
# toleration이 올바르게 설정되었는지 확인
kubectl get pod production-app -o jsonpath='{.spec.tolerations}'
```

```text
[{"effect":"NoSchedule","key":"env","operator":"Equal","value":"production"}]
```

**모든 taint를 허용하는 toleration**

```yaml
tolerations:
  - operator: "Exists"           # key를 생략하면 모든 taint를 허용한다
```

> **주의**: Taint/Toleration은 Pod를 특정 노드에 "배치"하는 것이 아니라, 특정 노드에서 "거부"하는 메커니즘이다. 특정 노드에 Pod를 배치하려면 `nodeSelector`나 `nodeAffinity`를 함께 사용해야 한다. 전형적인 패턴은 taint로 일반 Pod를 거부하고, toleration + nodeSelector로 원하는 Pod만 해당 노드에 배치하는 것이다.

**트러블슈팅:**

| 증상 | 원인 | 해결 |
|------|------|------|
| Pod가 Pending, "didn't tolerate" | 노드에 taint가 있고 Pod에 toleration이 없음 | toleration 추가 또는 taint 제거 |
| Pod가 갑자기 eviction됨 | 노드에 NoExecute taint가 추가됨 | tolerationSeconds 설정 또는 taint 제거 |
| 모든 노드에서 스케줄 실패 | 모든 노드에 taint가 설정됨 | 최소 하나의 노드에서 taint 제거 |

**엣지 케이스**

- `NoExecute` taint를 추가하면 toleration이 없는 기존 Pod는 즉시 퇴출된다. `tolerationSeconds`를 설정한 Pod는 해당 시간만큼 유예 기간을 가진다.
- 여러 taint가 한 노드에 설정된 경우, Pod는 모든 taint에 대한 toleration을 가져야 스케줄될 수 있다. 하나라도 매칭되지 않으면 거부된다.
- `PreferNoSchedule`은 soft 제약이므로, 다른 노드에 자리가 없으면 해당 노드에 스케줄될 수 있다. 반드시 거부해야 하는 경우 `NoSchedule`을 사용해야 한다.
- 쿠버네티스는 자동으로 다음 taint를 노드에 추가한다: `node.kubernetes.io/not-ready`, `node.kubernetes.io/unreachable`. 기본적으로 Pod에는 이 taint에 대한 toleration이 300초(5분)로 설정되어 있다.

---

### 1.4 RBAC (Role-Based Access Control)

#### 배경: 기존 인가 방식의 한계

쿠버네티스 초기에는 ABAC(Attribute-Based Access Control)를 사용하였다. ABAC는 정책 파일을 JSON으로 작성하여 API 서버 시작 시 로드하는 방식이다. 정책을 변경하려면 파일을 수정하고 API 서버를 재시작해야 하므로 운영이 어렵다. RBAC는 쿠버네티스 API 리소스(Role, RoleBinding)로 정책을 관리하므로, `kubectl apply`로 즉시 반영할 수 있다.

#### 동작 원리

RBAC 인가 플로우:

1. 클라이언트가 API 서버에 요청을 전송한다 (예: `GET /api/v1/namespaces/demo/pods`).
2. Authentication(인증): 요청의 인증 정보(토큰, 인증서)를 검증하여 사용자/ServiceAccount를 식별한다.
3. Authorization(인가): RBAC 모듈이 해당 사용자에게 바인딩된 모든 Role/ClusterRole을 검색한다.
4. 바인딩된 Role의 rules에서 요청의 API group, resource, verb가 매칭되는지 확인한다.
5. 하나라도 매칭되면 허용(allow), 아무것도 매칭되지 않으면 거부(deny, HTTP 403)한다.

**핵심 리소스:**

| 리소스 | 범위 | 설명 |
|--------|------|------|
| Role | 네임스페이스 | 특정 네임스페이스 내 권한을 정의한다 |
| ClusterRole | 클러스터 전체 | 클러스터 수준 리소스 또는 모든 네임스페이스에 대한 권한을 정의한다 |
| RoleBinding | 네임스페이스 | Role/ClusterRole을 사용자/그룹/SA에 바인딩한다 |
| ClusterRoleBinding | 클러스터 전체 | ClusterRole을 클러스터 전체 범위로 바인딩한다 |

**YAML 예제:**

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: pod-reader
  namespace: demo
rules:
  - apiGroups: [""]             # core API group
    resources: ["pods", "pods/log"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["apps"]
    resources: ["deployments"]
    verbs: ["get", "list"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: read-pods
  namespace: demo
subjects:
  - kind: ServiceAccount
    name: app-sa
    namespace: demo
roleRef:
  kind: Role
  name: pod-reader
  apiGroup: rbac.authorization.k8s.io
```

```bash
kubectl apply -f rbac.yaml
```

**검증**

```bash
# Role 확인
kubectl get role pod-reader -n demo -o yaml | grep -A10 "rules:"
```

```text
rules:
- apiGroups:
  - ""
  resources:
  - pods
  - pods/log
  verbs:
  - get
  - list
  - watch
```

```bash
# RoleBinding 확인
kubectl get rolebinding read-pods -n demo -o jsonpath='{.subjects[0].name}'
echo ""
```

```text
app-sa
```

```bash
# 권한 테스트 (can-i)
kubectl auth can-i get pods -n demo --as=system:serviceaccount:demo:app-sa
```

```text
yes
```

```bash
kubectl auth can-i delete pods -n demo --as=system:serviceaccount:demo:app-sa
```

```text
no
```

**트러블슈팅:**

| 증상 | 원인 | 진단 명령어 | 해결 |
|------|------|-----------|------|
| 403 Forbidden | Role에 해당 verb/resource가 없음 | `kubectl auth can-i <verb> <resource> --as=<user>` | Role의 rules에 누락된 권한 추가 |
| RoleBinding이 있지만 권한 없음 | Role과 RoleBinding의 namespace가 다름 | `kubectl get rolebinding -n <ns>` | 동일 namespace에 생성 |
| apiGroups 오류 | core API는 `""`, apps는 `"apps"` | `kubectl api-resources` | 정확한 apiGroup 확인 |

**확인 문제:**

1. Role과 ClusterRole의 차이점은 무엇인가?
2. RoleBinding이 ClusterRole을 참조할 수 있는가? 그 효과는 무엇인가?
3. `kubectl auth can-i --list --as=system:serviceaccount:demo:app-sa -n demo` 명령의 출력은 무엇을 보여주는가?

---

### 1.5 PodDisruptionBudget (PDB)

#### 배경: 기존 한계

`kubectl drain` 또는 클러스터 업그레이드 시 노드의 모든 Pod가 동시에 퇴출되면 서비스 중단이 발생한다. Deployment의 replicas가 3이더라도 drain이 모든 Pod를 한 번에 제거할 수 있다. PDB는 "자발적 중단(voluntary disruption)" 시 최소 가용 Pod 수를 보장하는 메커니즘이다.

자발적 중단: `kubectl drain`, 클러스터 오토스케일러의 노드 축소, 롤링 업데이트
비자발적 중단: 노드 장애, OOM, 하드웨어 고장 (PDB가 보호하지 않음)

#### 동작 원리

PDB는 Eviction API를 통해 동작한다:

1. `kubectl drain`이 노드의 각 Pod에 대해 Eviction API를 호출한다.
2. API 서버가 해당 Pod에 적용되는 PDB를 확인한다.
3. 퇴출 후에도 `minAvailable` 또는 `maxUnavailable` 조건이 충족되면 퇴출을 허용한다.
4. 조건이 위반되면 퇴출을 거부한다 (HTTP 429 Too Many Requests).
5. `kubectl drain`은 재시도하며, PDB 조건이 충족될 때까지 대기한다.

**YAML 예제:**

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: webapp-pdb
  namespace: demo
spec:
  minAvailable: 2              # 최소 2개 Pod가 항상 가용해야 함
  # maxUnavailable: 1          # 또는 최대 1개만 동시에 중단 가능
  selector:
    matchLabels:
      app: webapp
```

```bash
kubectl apply -f pdb.yaml
```

**검증**

```bash
kubectl get pdb webapp-pdb -n demo
```

```text
NAME         MIN AVAILABLE   MAX UNAVAILABLE   ALLOWED DISRUPTIONS   AGE
webapp-pdb   2               N/A               1                     10s
```

`ALLOWED DISRUPTIONS`는 현재 상태에서 추가로 중단할 수 있는 Pod 수이다. replicas=3이고 minAvailable=2이면, 최대 1개 Pod를 중단할 수 있다.

```bash
kubectl describe pdb webapp-pdb -n demo | grep -A5 "Status:"
```

```text
Status:
    Conditions:
      ...
    Current Healthy:   3
    Desired Healthy:   2
    Disruptions Allowed:  1
```

**장애 시나리오 — PDB가 drain을 블로킹하는 경우:**

```bash
# replicas=2, minAvailable=2인 상태에서 drain 시도
kubectl drain <node-name> --ignore-daemonsets --delete-emptydir-data
```

```text
evicting pod demo/webapp-xxx
error when evicting pods/"webapp-xxx" -n "demo" (will retry after 5s):
Cannot evict pod as it would violate the pod's disruption budget.
```

이 상태에서 drain은 무한 대기한다. 해결 방법:
1. PDB의 minAvailable을 낮추거나
2. replicas를 증가시키거나
3. `--force` 플래그를 사용한다 (PDB를 무시, 비권장)

**트러블슈팅:**

| 증상 | 원인 | 진단 명령어 | 해결 |
|------|------|-----------|------|
| drain이 무한 대기 | PDB가 퇴출을 차단 | `kubectl get pdb -n demo` | ALLOWED DISRUPTIONS가 0인지 확인 |
| PDB가 적용되지 않음 | selector가 Pod label과 불일치 | `kubectl get pdb -o yaml` | selector 확인 |
| minAvailable이 replicas보다 큼 | 잘못된 PDB 설정 | `kubectl describe pdb` | minAvailable을 replicas 미만으로 조정 |

**확인 문제:**

1. `minAvailable`과 `maxUnavailable`을 동시에 설정할 수 있는가?
2. PDB는 `kubectl delete pod`를 차단하는가?
3. PDB의 `ALLOWED DISRUPTIONS`가 0인 상태에서 노드 장애가 발생하면 어떻게 되는가?

---

### 1.6 ServiceAccount 토큰 자동 마운트

#### 배경: 기존 한계

쿠버네티스 1.23 이전에는 ServiceAccount를 생성하면 자동으로 Secret(영구 토큰)이 생성되었다. 이 토큰은 만료되지 않아, 유출 시 무기한으로 API에 접근할 수 있는 심각한 보안 위험이 있었다. 1.24부터 TokenRequest API를 통한 시간 제한(기본 1시간) 토큰이 기본값이 되었다. projected volume을 통해 kubelet이 토큰을 주기적으로 갱신한다.

#### 동작 원리

1. Pod가 생성되면 ServiceAccount Admission Controller가 `serviceAccountName` 필드를 확인한다 (미지정 시 `default` SA).
2. `automountServiceAccountToken`이 true(기본값)이면, projected volume을 Pod spec에 주입한다.
3. kubelet이 TokenRequest API를 호출하여 시간 제한 토큰을 발급받는다.
4. 토큰을 `/var/run/secrets/kubernetes.io/serviceaccount/token`에 파일로 마운트한다.
5. 토큰 만료 전에 kubelet이 자동으로 새 토큰을 발급받아 파일을 갱신한다.
6. 같은 경로에 `ca.crt`(API 서버 CA 인증서)와 `namespace`(현재 네임스페이스) 파일도 마운트된다.

**검증:**

```bash
# 기본 ServiceAccount의 토큰 마운트 확인
kubectl run sa-test --image=busybox:1.36 -n demo --restart=Never -- sleep 3600
kubectl exec sa-test -n demo -- ls /var/run/secrets/kubernetes.io/serviceaccount/
```

```text
ca.crt
namespace
token
```

```bash
# 토큰 내용 일부 확인 (JWT)
kubectl exec sa-test -n demo -- cat /var/run/secrets/kubernetes.io/serviceaccount/token | cut -d. -f2 | base64 -d 2>/dev/null | head -c 200
```

```text
{"aud":["https://kubernetes.default.svc.cluster.local"],"exp":1704110400,"iat":1704067200,"iss":"https://kubernetes.default.svc.cluster.local","kubernetes.io":{"namespace":"demo","pod":{"name":"sa-test"...
```

`exp` 필드가 존재하여 토큰 만료 시간이 설정되어 있다.

```bash
# automountServiceAccountToken 비활성화
kubectl run sa-nomount --image=busybox:1.36 -n demo --restart=Never \
  --overrides='{"spec":{"automountServiceAccountToken":false}}' -- sleep 3600
kubectl exec sa-nomount -n demo -- ls /var/run/secrets/ 2>&1
```

```text
ls: /var/run/secrets/: No such file or directory
```

**트러블슈팅:**

| 증상 | 원인 | 진단 명령어 | 해결 |
|------|------|-----------|------|
| Pod 내에서 API 호출 시 401 Unauthorized | 토큰 만료 또는 SA 권한 없음 | `kubectl exec <pod> -- cat /var/.../token` | SA에 RBAC 바인딩 추가 |
| 토큰 파일이 없음 | automountServiceAccountToken=false | `kubectl get pod -o yaml` | true로 변경 또는 수동 volume 마운트 |
| 1.24 업그레이드 후 장기 토큰 사라짐 | Secret 기반 토큰이 더 이상 자동 생성되지 않음 | `kubectl get secret -n demo` | TokenRequest API 또는 수동 Secret 생성 |

**확인 문제:**

1. 쿠버네티스 1.24 전후로 ServiceAccount 토큰 관리 방식이 어떻게 변경되었는가?
2. `automountServiceAccountToken: false`를 설정해야 하는 경우는 언제인가?
3. projected volume 토큰의 기본 만료 시간은 얼마인가?

---

## Part 2: 추가 실전 예제

---

### 예제 1. StatefulSet + volumeClaimTemplates

#### 등장 배경

MySQL과 같은 관계형 데이터베이스를 쿠버네티스에서 운영하려면, 각 인스턴스가 고유한 데이터 디렉터리를 가져야 하며 Pod가 재시작되어도 동일한 스토리지에 연결되어야 한다. Deployment로는 이를 보장할 수 없으므로 StatefulSet이 필요하다.

MySQL StatefulSet을 3개 레플리카로 배포하고, 각 Pod에 전용 PVC를 할당한다.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: mysql-headless
spec:
  ports:
    - port: 3306
      name: mysql
  clusterIP: None
  selector:
    app: mysql
---
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
              name: mysql
          env:
            - name: MYSQL_ROOT_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: mysql-secret
                  key: root-password
          volumeMounts:
            - name: mysql-data
              mountPath: /var/lib/mysql
          resources:
            requests:
              memory: 512Mi
              cpu: 250m
            limits:
              memory: 1Gi
              cpu: 500m
  volumeClaimTemplates:
    - metadata:
        name: mysql-data
      spec:
        accessModes: ["ReadWriteOnce"]
        storageClassName: standard
        resources:
          requests:
            storage: 10Gi
```

**검증**

```bash
# StatefulSet 상태 확인
kubectl get sts mysql
```

```text
NAME    READY   AGE
mysql   3/3     3m
```

```bash
# 생성된 PVC 확인 (Pod별 개별 PVC)
kubectl get pvc
```

```text
NAME                 STATUS   VOLUME   CAPACITY   ACCESS MODES   STORAGECLASS   AGE
mysql-data-mysql-0   Bound    pv-xx    10Gi       RWO            standard       3m
mysql-data-mysql-1   Bound    pv-yy    10Gi       RWO            standard       2m
mysql-data-mysql-2   Bound    pv-zz    10Gi       RWO            standard       1m
```

```bash
# 개별 Pod DNS 접근 확인 (같은 네임스페이스 내에서)
kubectl run dns-test --image=busybox:1.36 --rm -it --restart=Never -- nslookup mysql-0.mysql-headless
```

```text
Name:      mysql-0.mysql-headless.default.svc.cluster.local
Address:   10.244.1.5
```

```bash
# MySQL 연결 확인
kubectl run mysql-client --image=mysql:8.0 --rm -it --restart=Never -- \
  mysql -h mysql-0.mysql-headless -u root -prootpassword -e "SELECT 1"
```

```text
+---+
| 1 |
+---+
| 1 |
+---+
```

**트러블슈팅:**

| 증상 | 원인 | 진단 명령어 | 해결 |
|------|------|-----------|------|
| mysql-0 Pending | PVC 바인딩 실패 | `kubectl describe pvc mysql-data-mysql-0` | StorageClass 생성 또는 PV 프로비저닝 |
| mysql-1 생성 안 됨 | mysql-0 Ready 아님 | `kubectl get pod mysql-0` | mysql-0의 Readiness 문제 해결 |
| MySQL 연결 실패 | Headless Service 없음 | `kubectl get svc mysql-headless` | Service 생성 |
| Pod 재생성 후 데이터 유실 | PVC reclaimPolicy가 Delete | `kubectl get pv` | reclaimPolicy를 Retain으로 변경 |

---

### 예제 2. DaemonSet — 모든 노드에 모니터링 에이전트 배포

#### 등장 배경

Deployment로 모니터링 에이전트를 배포하면, 스케줄러가 Pod를 특정 노드에 집중 배치할 수 있다. 노드가 추가되어도 자동으로 에이전트가 배포되지 않는다. DaemonSet은 모든(또는 특정) 노드에 정확히 하나의 Pod를 실행하는 워크로드 리소스이다. 노드가 추가되면 자동으로 Pod가 생성되고, 제거되면 자동으로 삭제된다.

**내부 동작 원리:**

DaemonSet 컨트롤러는 매 sync 주기마다 다음을 수행한다:
1. 클러스터의 모든 노드 목록을 조회한다.
2. 각 노드에 대해 DaemonSet의 Pod가 존재하는지 확인한다.
3. Pod가 없는 노드가 있으면 해당 노드에 Pod를 생성한다 (nodeAffinity를 자동 설정).
4. 대상이 아닌 노드에 Pod가 있으면 삭제한다.
5. DaemonSet은 기본적으로 `SchedulerName`을 사용하지 않고 직접 nodeAffinity를 지정한다.

```yaml
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: node-exporter
  namespace: monitoring
spec:
  selector:
    matchLabels:
      app: node-exporter
  template:
    metadata:
      labels:
        app: node-exporter
    spec:
      tolerations:
        - key: node-role.kubernetes.io/control-plane
          operator: Exists
          effect: NoSchedule
      containers:
        - name: node-exporter
          image: prom/node-exporter:v1.7.0
          ports:
            - containerPort: 9100
              hostPort: 9100
          resources:
            requests:
              cpu: 50m
              memory: 64Mi
            limits:
              cpu: 100m
              memory: 128Mi
```

**검증**

```bash
kubectl get daemonset node-exporter -n monitoring
```

```text
NAME            DESIRED   CURRENT   READY   UP-TO-DATE   AVAILABLE   NODE SELECTOR   AGE
node-exporter   3         3         3       3            3           <none>           30s
```

```bash
# 모든 노드에 Pod가 하나씩 배치되었는지 확인
kubectl get pods -n monitoring -l app=node-exporter -o wide
```

```text
NAME                  READY   STATUS    RESTARTS   AGE   IP            NODE
node-exporter-abc12   1/1     Running   0          30s   10.244.0.5    control-plane
node-exporter-def34   1/1     Running   0          30s   10.244.1.5    worker1
node-exporter-ghi56   1/1     Running   0          30s   10.244.2.5    worker2
```

**트러블슈팅:**

| 증상 | 원인 | 진단 명령어 | 해결 |
|------|------|-----------|------|
| DESIRED와 CURRENT가 다름 | 특정 노드에서 Pod 생성 실패 | `kubectl describe ds node-exporter -n monitoring` | 노드의 taint, 리소스 부족 확인 |
| control-plane에 배포 안 됨 | NoSchedule taint에 대한 toleration 없음 | `kubectl describe node <cp>` | toleration 추가 |
| Pod가 Pending | hostPort 충돌 | `kubectl describe pod <pod>` | 다른 프로세스가 9100 포트 사용 중인지 확인 |

---

### 예제 3. CronJob — 주기적 데이터 백업

#### 등장 배경

데이터 백업, 로그 정리, 리포트 생성 등은 주기적으로 실행되어야 한다. 기존에는 외부 스케줄러(cron)나 별도 운영 도구에 의존하였다. CronJob은 쿠버네티스 내에서 cron 표현식 기반 스케줄링을 제공하며, Job의 생성/실패 관리를 자동으로 수행한다.

**내부 동작 원리:**

CronJob 컨트롤러는 매 10초마다 모든 CronJob을 검사한다:
1. 현재 시간이 `schedule`에 해당하는지 확인한다.
2. 해당하면 새 Job을 생성한다.
3. `concurrencyPolicy`에 따라 이전 Job이 아직 실행 중일 때의 동작을 결정한다:
   - `Allow`: 동시 실행 허용 (기본값)
   - `Forbid`: 이전 Job이 실행 중이면 새 Job을 건너뜀
   - `Replace`: 이전 Job을 삭제하고 새 Job을 생성
4. `successfulJobsHistoryLimit`(기본 3)과 `failedJobsHistoryLimit`(기본 1)에 따라 이전 Job을 정리한다.

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: db-backup
spec:
  schedule: "0 2 * * *"          # 매일 02:00 UTC
  concurrencyPolicy: Forbid
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 1
  startingDeadlineSeconds: 200
  jobTemplate:
    spec:
      backoffLimit: 2
      template:
        spec:
          restartPolicy: OnFailure
          containers:
            - name: backup
              image: busybox:1.36
              command: ["sh", "-c", "echo 'Backup started at $(date)' && sleep 5 && echo 'Backup completed'"]
```

**검증**

```bash
# 수동 트리거로 즉시 테스트
kubectl create job --from=cronjob/db-backup manual-backup
kubectl get jobs
```

```text
NAME            COMPLETIONS   DURATION   AGE
manual-backup   1/1           8s         15s
```

```bash
kubectl logs job/manual-backup
```

```text
Backup started at Mon Jan 1 00:00:00 UTC 2024
Backup completed
```

```bash
kubectl get cronjob db-backup
```

```text
NAME        SCHEDULE      SUSPEND   ACTIVE   LAST SCHEDULE   AGE
db-backup   0 2 * * *     False     0        <none>          30s
```

**트러블슈팅:**

| 증상 | 원인 | 진단 명령어 | 해결 |
|------|------|-----------|------|
| Job이 생성되지 않음 | `startingDeadlineSeconds` 초과 | `kubectl describe cronjob db-backup` | deadline 증가 또는 schedule 확인 |
| 동시 실행 발생 | concurrencyPolicy가 Allow | `kubectl get jobs` | Forbid 또는 Replace로 변경 |
| Job은 완료되었지만 Pod가 남아 있음 | `successfulJobsHistoryLimit`에 의해 유지됨 | `kubectl get pods` | historyLimit 조정 |

---

### 예제 4. HPA (Horizontal Pod Autoscaler)

#### 등장 배경

트래픽이 급증할 때 수동으로 `kubectl scale`을 실행하면 대응이 늦다. 트래픽이 줄어든 후에도 replicas를 축소하지 않으면 리소스가 낭비된다. HPA는 CPU/메모리 사용률이나 커스텀 메트릭을 기반으로 Deployment의 replicas를 자동으로 조정한다.

**내부 동작 원리:**

HPA 컨트롤러는 기본 15초 주기로 동작한다:
1. Metrics API(metrics-server)에서 대상 Pod의 평균 CPU/메모리 사용률을 조회한다.
2. `desiredReplicas = ceil(currentReplicas * (currentMetric / targetMetric))` 공식으로 필요 replicas를 계산한다.
3. 계산된 replicas가 `minReplicas`~`maxReplicas` 범위를 벗어나지 않도록 조정한다.
4. 스케일 업은 즉시, 스케일 다운은 안정화 기간(기본 5분) 후에 적용한다.

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: webapp-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: webapp
  minReplicas: 2
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
  behavior:
    scaleDown:
      stabilizationWindowSeconds: 300
```

**검증**

```bash
kubectl get hpa webapp-hpa
```

```text
NAME         REFERENCE          TARGETS   MINPODS   MAXPODS   REPLICAS   AGE
webapp-hpa   Deployment/webapp   35%/70%   2         10        2          30s
```

```bash
kubectl describe hpa webapp-hpa | grep -A3 "Conditions:"
```

```text
Conditions:
  Type            Status  Reason              Message
  ----            ------  ------              -------
  AbleToScale     True    ReadyForNewScale    recommended size matches current size
  ScalingActive   True    ValidMetricFound    the HPA was able to successfully calculate a replica count
```

**트러블슈팅:**

| 증상 | 원인 | 진단 명령어 | 해결 |
|------|------|-----------|------|
| TARGETS: `<unknown>/70%` | metrics-server 미설치 또는 Pod에 resource requests 미설정 | `kubectl describe hpa` | metrics-server 설치, requests 설정 |
| 스케일 업이 되지 않음 | 이미 maxReplicas에 도달 | `kubectl get hpa` | maxReplicas 증가 |
| 스케일 다운이 느림 | stabilizationWindowSeconds 대기 중 | `kubectl describe hpa` | stabilizationWindow 조정 |

---

### 예제 5. Job — 일회성 데이터 처리

#### 등장 배경

Deployment는 항상 실행 상태를 유지하도록 설계되어 있다. 데이터 마이그레이션, 배치 처리, 초기 설정 등 한 번 실행하고 종료되는 작업에는 적합하지 않다. Job은 Pod가 성공적으로 완료될 때까지 실행을 보장하는 워크로드이다.

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: data-migration
spec:
  completions: 5           # 총 5개 Pod가 성공해야 완료
  parallelism: 2           # 동시에 2개 Pod 실행
  backoffLimit: 3
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: migrate
          image: busybox:1.36
          command: ["sh", "-c", "echo Processing chunk $JOB_COMPLETION_INDEX && sleep 3"]
          env:
            - name: JOB_COMPLETION_INDEX
              valueFrom:
                fieldRef:
                  fieldPath: metadata.annotations['batch.kubernetes.io/job-completion-index']
```

**검증**

```bash
kubectl get job data-migration -w
```

```text
NAME             COMPLETIONS   DURATION   AGE
data-migration   0/5           3s         3s
data-migration   1/5           6s         6s
data-migration   2/5           9s         9s
data-migration   3/5           12s        12s
data-migration   4/5           15s        15s
data-migration   5/5           18s        18s
```

```bash
# 병렬 실행 확인
kubectl get pods -l job-name=data-migration
```

```text
NAME                     READY   STATUS      RESTARTS   AGE
data-migration-0-abc     0/1     Completed   0          18s
data-migration-1-def     0/1     Completed   0          18s
data-migration-2-ghi     0/1     Completed   0          12s
data-migration-3-jkl     0/1     Completed   0          12s
data-migration-4-mno     0/1     Completed   0          6s
```

**트러블슈팅:**

| 증상 | 원인 | 진단 명령어 | 해결 |
|------|------|-----------|------|
| Job이 Failed 상태 | backoffLimit 초과 | `kubectl describe job` | backoffLimit 증가 또는 명령어 수정 |
| completions 미달 | 일부 Pod가 실패 | `kubectl logs <failed-pod>` | 실패 원인 확인 후 Job 재생성 |

---

### 예제 6. PersistentVolumeClaim — 동적 프로비저닝

#### 등장 배경

초기 쿠버네티스에서는 관리자가 수동으로 PV를 생성하고, 사용자가 PVC로 바인딩하는 정적 프로비저닝만 가능하였다. 동적 프로비저닝은 PVC 생성 시 StorageClass에 지정된 프로비저너가 자동으로 PV를 생성하여, 관리자의 수동 작업을 제거한다.

**내부 동작 원리:**

1. 사용자가 StorageClass를 지정한 PVC를 생성한다.
2. PV Controller가 PVC를 감지하고, StorageClass의 provisioner를 호출한다.
3. 프로비저너(CSI driver 등)가 실제 스토리지(디스크, NFS 등)를 생성한다.
4. 프로비저너가 PV를 생성하고 PVC에 바인딩한다.
5. Pod가 PVC를 마운트하면 kubelet이 CSI driver를 통해 볼륨을 노드에 attach/mount한다.

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: app-data
spec:
  accessModes:
    - ReadWriteOnce
  storageClassName: standard
  resources:
    requests:
      storage: 5Gi
```

**검증**

```bash
kubectl get pvc app-data
```

```text
NAME       STATUS   VOLUME     CAPACITY   ACCESS MODES   STORAGECLASS   AGE
app-data   Bound    pv-abc12   5Gi        RWO            standard       10s
```

```bash
kubectl get pv pv-abc12
```

```text
NAME       CAPACITY   ACCESS MODES   RECLAIM POLICY   STATUS   CLAIM              STORAGECLASS   AGE
pv-abc12   5Gi        RWO            Delete           Bound    default/app-data   standard       10s
```

**트러블슈팅:**

| 증상 | 원인 | 진단 명령어 | 해결 |
|------|------|-----------|------|
| PVC가 Pending | StorageClass가 존재하지 않음 | `kubectl get sc` | StorageClass 생성 또는 이름 확인 |
| PVC가 Pending | 프로비저너가 설치되지 않음 | `kubectl get pods -n kube-system` | CSI driver 설치 |
| Pod가 마운트 실패 | PVC와 Pod가 다른 네임스페이스 | `kubectl describe pod` | 동일 네임스페이스에 PVC 생성 |

---

### 예제 7. NetworkPolicy — 네임스페이스 간 접근 제어

#### 등장 배경

멀티 테넌트 환경에서 네임스페이스 A의 Pod가 네임스페이스 B의 데이터베이스에 무단 접근하면 데이터 유출이 발생할 수 있다. NetworkPolicy의 `namespaceSelector`를 사용하면 특정 네임스페이스에서 오는 트래픽만 허용할 수 있다.

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-from-frontend-ns
  namespace: backend
spec:
  podSelector:
    matchLabels:
      app: api-server
  policyTypes:
    - Ingress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              purpose: frontend
        - podSelector:
            matchLabels:
              role: web
      ports:
        - protocol: TCP
          port: 8080
```

주의: 위 YAML에서 `namespaceSelector`와 `podSelector`가 별도의 `-` 항목이므로 OR 조건이다 (frontend 네임스페이스의 모든 Pod 또는 같은 네임스페이스의 role=web Pod). AND 조건으로 만들려면 같은 `-` 항목 내에 두 selector를 배치해야 한다.

**검증**

```bash
kubectl get networkpolicy allow-from-frontend-ns -n backend
```

```text
NAME                     POD-SELECTOR      AGE
allow-from-frontend-ns   app=api-server    10s
```

```bash
kubectl describe networkpolicy allow-from-frontend-ns -n backend | grep -A10 "Allowing ingress"
```

```text
  Allowing ingress traffic:
    To Port: 8080/TCP
    From:
      NamespaceSelector: purpose=frontend
    From:
      PodSelector: role=web
```

---

### 예제 8. Probes 조합 — Startup + Liveness + Readiness

#### 등장 배경

느린 초기화 애플리케이션에서 세 가지 Probe를 올바르게 조합하지 않으면 두 가지 문제가 발생한다: (1) 초기화 중 Liveness Probe 실패로 무한 재시작, (2) 초기화 완료 후 장애 감지가 느림. Startup Probe가 성공할 때까지 Liveness/Readiness를 비활성화하여 이 딜레마를 해결한다.

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: java-app
spec:
  containers:
    - name: app
      image: openjdk:17-alpine
      command: ["sh", "-c", "sleep 30 && echo started > /tmp/healthy && java -jar /app/app.jar"]
      startupProbe:
        exec:
          command: ["cat", "/tmp/healthy"]
        periodSeconds: 5
        failureThreshold: 30       # 최대 150초 대기
      livenessProbe:
        httpGet:
          path: /actuator/health/liveness
          port: 8080
        periodSeconds: 10
        failureThreshold: 3
      readinessProbe:
        httpGet:
          path: /actuator/health/readiness
          port: 8080
        periodSeconds: 5
        failureThreshold: 3
```

**검증**

```bash
kubectl describe pod java-app | grep -E "Startup:|Liveness:|Readiness:"
```

```text
    Startup:    exec [cat /tmp/healthy] delay=0s timeout=1s period=5s #success=1 #failure=30
    Liveness:   http-get http://:8080/actuator/health/liveness delay=0s timeout=1s period=10s #success=1 #failure=3
    Readiness:  http-get http://:8080/actuator/health/readiness delay=0s timeout=1s period=5s #success=1 #failure=3
```

**내부 동작 순서:**
1. Pod 시작 -> Startup Probe만 활성화 (5초 간격, 최대 150초)
2. Startup 성공 -> Liveness(10초 간격) + Readiness(5초 간격) 활성화
3. Readiness 성공 -> Endpoint에 추가, 트래픽 수신 시작
4. Liveness 실패 3회 연속 -> 컨테이너 재시작

---

### 예제 9. ResourceQuota + LimitRange 조합

#### 등장 배경

ResourceQuota만 설정하면, Pod에 requests/limits를 명시하지 않은 경우 생성 자체가 거부된다 (quota가 설정된 네임스페이스에서 requests 없는 Pod 생성 불가). LimitRange를 함께 설정하면 기본값이 자동 주입되어 이 문제가 해결된다.

```yaml
apiVersion: v1
kind: LimitRange
metadata:
  name: default-limits
  namespace: quota-demo
spec:
  limits:
    - type: Container
      default:
        cpu: 200m
        memory: 256Mi
      defaultRequest:
        cpu: 100m
        memory: 128Mi
---
apiVersion: v1
kind: ResourceQuota
metadata:
  name: ns-quota
  namespace: quota-demo
spec:
  hard:
    requests.cpu: "4"
    requests.memory: 8Gi
    limits.cpu: "8"
    limits.memory: 16Gi
    pods: "20"
```

**검증**

```bash
# requests 없이 Pod 생성 (LimitRange가 기본값 주입)
kubectl run test --image=busybox:1.36 -n quota-demo --restart=Never -- sleep 3600
kubectl get pod test -n quota-demo -o jsonpath='{.spec.containers[0].resources}'
echo ""
```

```text
{"limits":{"cpu":"200m","memory":"256Mi"},"requests":{"cpu":"100m","memory":"128Mi"}}
```

```bash
kubectl describe resourcequota ns-quota -n quota-demo | grep -E "requests|limits|pods"
```

```text
  limits.cpu       200m  8
  limits.memory    256Mi  16Gi
  pods             1     20
  requests.cpu     100m  4
  requests.memory  128Mi  8Gi
```

---

### 예제 10. Ingress — 경로 기반 라우팅과 TLS

#### 등장 배경

하나의 도메인에서 `/api`는 백엔드 서비스로, `/web`은 프론트엔드 서비스로 분배해야 하는 경우가 일반적이다. Ingress의 경로 기반 라우팅은 이를 하나의 엔트리 포인트에서 처리한다. TLS 종단(termination)은 Ingress Controller에서 HTTPS를 처리하고, 백엔드로는 HTTP로 전달하여 인증서 관리를 중앙화한다.

**내부 동작 원리:**

nginx Ingress Controller의 경우:
1. Ingress 리소스 변경을 감지한다.
2. `server_name`, `location` 블록을 포함하는 nginx.conf를 동적으로 생성한다.
3. `nginx -s reload`로 설정을 적용한다 (기존 연결 유지).
4. TLS Secret이 지정된 경우 `ssl_certificate` 지시자를 추가한다.

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: multi-path-ingress
  annotations:
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
spec:
  ingressClassName: nginx
  tls:
    - hosts:
        - myapp.example.com
      secretName: myapp-tls
  rules:
    - host: myapp.example.com
      http:
        paths:
          - path: /api
            pathType: Prefix
            backend:
              service:
                name: api-svc
                port:
                  number: 8080
          - path: /
            pathType: Prefix
            backend:
              service:
                name: web-svc
                port:
                  number: 80
```

**검증**

```bash
kubectl get ingress multi-path-ingress
```

```text
NAME                 CLASS   HOSTS               ADDRESS        PORTS     AGE
multi-path-ingress   nginx   myapp.example.com   192.168.64.2   80, 443   10s
```

```bash
kubectl describe ingress multi-path-ingress | grep -A10 "Rules:"
```

```text
Rules:
  Host               Path  Backends
  ----               ----  --------
  myapp.example.com
                     /api   api-svc:8080 (10.244.1.10:8080)
                     /      web-svc:80 (10.244.2.8:80,10.244.2.9:80)
TLS:
  myapp-tls terminates myapp.example.com
```

**트러블슈팅:**

| 증상 | 원인 | 진단 명령어 | 해결 |
|------|------|-----------|------|
| TLS 인증서 오류 | Secret이 존재하지 않거나 형식이 잘못됨 | `kubectl get secret myapp-tls -o yaml` | `tls.crt`와 `tls.key` 필드 확인 |
| `/api` 경로가 404 | pathType이 Exact인데 `/api/users`로 접근 | `kubectl describe ingress` | pathType을 Prefix로 변경 |
| 특정 경로만 503 | 해당 backend Service의 Endpoint가 비어 있음 | `kubectl get endpoints <svc>` | backend Pod 상태 확인 |

---

## Part 3: 개념별 확인 문제 (30문항)

> 각 문제에 대한 풀이는 kubectl 명령어와 YAML을 함께 제공한다. 모든 풀이에 검증 명령어와 기대 출력이 포함되어 있다.
> 각 문제에 **내부 동작 원리**, **트러블슈팅**, **장애 시나리오** 설명을 보강하였다.

---

### Application Design and Build (8문항)

---

**문제 1.** `ckad-build` 네임스페이스에 `web-sts`라는 이름의 StatefulSet을 생성하라. `nginx:1.25` 이미지를 사용하고, 레플리카는 3개, 서비스 이름은 `web-headless`로 설정하라. 각 Pod에 1Gi의 PVC를 할당하라.

<details><summary>풀이 확인</summary>

```bash
kubectl create namespace ckad-build
```

```yaml
apiVersion: v1
kind: Service
metadata:
  name: web-headless
  namespace: ckad-build
spec:
  clusterIP: None
  selector:
    app: web-sts
  ports:
    - port: 80
      name: web
---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: web-sts
  namespace: ckad-build
spec:
  serviceName: web-headless
  replicas: 3
  selector:
    matchLabels:
      app: web-sts
  template:
    metadata:
      labels:
        app: web-sts
    spec:
      containers:
        - name: nginx
          image: nginx:1.25
          ports:
            - containerPort: 80
          volumeMounts:
            - name: www
              mountPath: /usr/share/nginx/html
  volumeClaimTemplates:
    - metadata:
        name: www
      spec:
        accessModes: ["ReadWriteOnce"]
        resources:
          requests:
            storage: 1Gi
```

```bash
kubectl apply -f statefulset.yaml
```

**검증**

```bash
# StatefulSet, Pod, PVC가 모두 정상인지 확인
kubectl get sts,pods,pvc -n ckad-build
```

```text
NAME                       READY   AGE
statefulset.apps/web-sts   3/3     2m

NAME            READY   STATUS    RESTARTS   AGE
pod/web-sts-0   1/1     Running   0          2m
pod/web-sts-1   1/1     Running   0          90s
pod/web-sts-2   1/1     Running   0          60s

NAME                              STATUS   VOLUME   CAPACITY   ACCESS MODES   AGE
persistentvolumeclaim/www-web-sts-0   Bound    pv-xx    1Gi        RWO            2m
persistentvolumeclaim/www-web-sts-1   Bound    pv-yy    1Gi        RWO            90s
persistentvolumeclaim/www-web-sts-2   Bound    pv-zz    1Gi        RWO            60s
```

```bash
# DNS 확인
kubectl run dns-test --image=busybox:1.36 --rm -it --restart=Never -n ckad-build -- \
  nslookup web-sts-0.web-headless.ckad-build.svc.cluster.local
```

```text
Name:      web-sts-0.web-headless.ckad-build.svc.cluster.local
Address:   10.244.x.x
```

**트러블슈팅:**

- Pod가 순서대로 생성되지 않으면 `kubectl describe sts web-sts -n ckad-build`로 이벤트를 확인한다.
- PVC가 Pending이면 StorageClass가 존재하는지 확인한다: `kubectl get sc`
- Headless Service를 StatefulSet보다 먼저 생성해야 DNS가 정상 동작한다.

</details>

---

**문제 2.** `data-job`이라는 Job을 생성하라. `busybox` 이미지를 사용하고, `echo "processing complete"` 명령을 실행한다. `backoffLimit`은 4, `activeDeadlineSeconds`는 30으로 설정하라.

<details><summary>풀이 확인</summary>

**등장 배경:**

Job은 일회성 또는 배치 작업을 실행하기 위한 워크로드 리소스이다. Deployment와 달리 작업이 완료되면 Pod를 재시작하지 않는다. `backoffLimit`은 Pod 실패 시 최대 재시도 횟수를 제한하고, `activeDeadlineSeconds`는 전체 실행 시간에 상한을 설정한다. 이 두 필드가 없으면 Job이 무한 재시도 루프에 빠져 클러스터 리소스를 고갈시킬 수 있다.

```bash
kubectl create job data-job --image=busybox --dry-run=client -o yaml -- sh -c "echo processing complete" > job.yaml
```

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: data-job
spec:
  backoffLimit: 4
  activeDeadlineSeconds: 30
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: data-job
          image: busybox
          command: ["sh", "-c", "echo processing complete"]
```

```bash
kubectl apply -f job.yaml
```

**검증**

```bash
# Job 완료 확인
kubectl get jobs data-job
```

```text
NAME       COMPLETIONS   DURATION   AGE
data-job   1/1           3s         10s
```

```bash
# Pod 로그로 명령 실행 결과 확인
kubectl logs job/data-job
```

```text
processing complete
```

```bash
# Job 상세 정보에서 backoffLimit, activeDeadlineSeconds 확인
kubectl describe job data-job | grep -E "Backoff|Deadline"
```

```text
Backoff Limit:   4
Active Deadline Seconds: 30
```

**내부 동작 — Job 실패 재시도:**

Pod가 0이 아닌 exit code로 종료되면 Job 컨트롤러는 새 Pod를 생성하여 재시도한다. 재시도 간격은 지수적 백오프(10초, 20초, 40초...)로 증가한다. `backoffLimit`에 도달하면 Job은 `Failed` 상태가 된다. `activeDeadlineSeconds`에 도달하면 모든 실행 중인 Pod가 종료되고 Job은 `DeadlineExceeded` 사유로 실패한다.

**restartPolicy 동작:**

| restartPolicy | 동작 |
|--------------|------|
| `Never` | Pod 실패 시 새 Pod를 생성하여 재시도한다. 실패한 Pod는 유지된다 (로그 확인 가능). |
| `OnFailure` | 같은 Pod 내에서 컨테이너를 재시작한다. 실패한 Pod가 누적되지 않는다. |
| `Always` | Job에서 사용 불가. 유효성 검증에서 거부된다. |

</details>

---

**문제 3.** Init Container를 사용하여 메인 컨테이너 실행 전에 설정 파일을 준비하는 Pod를 생성하라. Init Container는 `busybox` 이미지로 `/work-dir/config.txt`에 `ready=true`를 기록하고, 메인 컨테이너는 `nginx` 이미지로 해당 파일을 `/usr/share/nginx/html/config.txt`에서 서빙한다.

<details><summary>풀이 확인</summary>

**등장 배경:**

메인 컨테이너가 실행되기 전에 설정 파일 생성, DB 마이그레이션, 의존 서비스 대기 등 선행 작업이 필요한 경우가 있다. Init Container는 메인 컨테이너보다 먼저 실행되고, 성공적으로 완료되어야 메인 컨테이너가 시작된다. 여러 Init Container는 정의된 순서대로 순차 실행된다.

**내부 동작 원리:**

kubelet은 Pod spec의 `initContainers` 배열을 인덱스 순서로 실행한다. 각 Init Container가 exit code 0으로 종료해야 다음으로 진행한다. 하나라도 실패하면 restartPolicy에 따라 재시도한다. 모든 Init Container가 성공하면 `containers` 배열의 컨테이너들이 동시에 시작된다.

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: init-demo
  namespace: ckad-build
spec:
  initContainers:
    - name: prepare-config
      image: busybox:1.36
      command: ["sh", "-c", "echo 'ready=true' > /work-dir/config.txt"]
      volumeMounts:
        - name: shared
          mountPath: /work-dir
  containers:
    - name: nginx
      image: nginx:1.25
      ports:
        - containerPort: 80
      volumeMounts:
        - name: shared
          mountPath: /usr/share/nginx/html
  volumes:
    - name: shared
      emptyDir: {}
```

```bash
kubectl apply -f init-demo.yaml
```

**검증**

```bash
kubectl get pod init-demo -n ckad-build
```

```text
NAME        READY   STATUS    RESTARTS   AGE
init-demo   1/1     Running   0          15s
```

```bash
kubectl exec init-demo -n ckad-build -- cat /usr/share/nginx/html/config.txt
```

```text
ready=true
```

```bash
# Init Container 완료 상태 확인
kubectl get pod init-demo -n ckad-build -o jsonpath='{.status.initContainerStatuses[0].state}'
```

```text
{"terminated":{"containerID":"...","exitCode":0,"finishedAt":"...","reason":"Completed","startedAt":"..."}}
```

**트러블슈팅:**

| 증상 | 원인 | 진단 명령어 | 해결 |
|------|------|-----------|------|
| Pod STATUS: Init:Error | Init Container 명령어 실패 | `kubectl logs init-demo -c prepare-config` | command 수정 |
| Pod STATUS: Init:CrashLoopBackOff | Init Container가 반복 실패 | `kubectl describe pod init-demo` | 볼륨 마운트 경로/권한 확인 |

</details>

---

**문제 4.** Sidecar 패턴을 구현하라. 메인 컨테이너(`nginx`)가 접근 로그를 `/var/log/nginx/access.log`에 기록하고, sidecar 컨테이너(`busybox`)가 해당 로그를 `tail -F`로 stdout에 출력하도록 설정하라.

<details><summary>풀이 확인</summary>

**등장 배경:**

Sidecar 패턴은 메인 컨테이너의 기능을 확장하는 보조 컨테이너를 동일 Pod에 배치하는 설계 패턴이다. 로그 수집, 프록시, 모니터링 에이전트 등에 사용된다. 메인 컨테이너는 비즈니스 로직에만 집중하고, 부가 기능은 sidecar가 담당하므로 관심사 분리(Separation of Concerns)가 실현된다.

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: sidecar-log
  namespace: ckad-build
spec:
  containers:
    - name: nginx
      image: nginx:1.25
      ports:
        - containerPort: 80
      volumeMounts:
        - name: logs
          mountPath: /var/log/nginx
    - name: log-collector
      image: busybox:1.36
      command: ["sh", "-c", "tail -F /var/log/nginx/access.log"]
      volumeMounts:
        - name: logs
          mountPath: /var/log/nginx
  volumes:
    - name: logs
      emptyDir: {}
```

**검증**

```bash
kubectl get pod sidecar-log -n ckad-build
```

```text
NAME          READY   STATUS    RESTARTS   AGE
sidecar-log   2/2     Running   0          15s
```

```bash
# 접근 로그 생성
kubectl exec sidecar-log -c nginx -n ckad-build -- curl -s localhost > /dev/null
# sidecar 로그 확인
kubectl logs sidecar-log -c log-collector -n ckad-build --tail=1
```

```text
127.0.0.1 - - [01/Jan/2024:00:00:00 +0000] "GET / HTTP/1.1" 200 615 "-" "curl/8.5.0"
```

</details>

---

**문제 5.** `emptyDir`, `hostPath`, `PVC` 세 가지 Volume 유형의 차이점을 설명하고, `emptyDir`에 `medium: Memory`를 설정한 Pod를 생성하여 tmpfs 마운트를 검증하라.

<details><summary>풀이 확인</summary>

**등장 배경:**

| Volume 유형 | 라이프사이클 | 사용 사례 |
|------------|------------|----------|
| `emptyDir` | Pod와 동일 (Pod 삭제 시 데이터 삭제) | 컨테이너 간 임시 데이터 공유 |
| `hostPath` | 노드와 동일 (Pod 삭제 후에도 노드에 잔존) | 노드 로그 접근, 노드 설정 파일 접근 |
| `PVC` | PV 라이프사이클 (reclaimPolicy에 따라 결정) | 영구 데이터 (DB, 파일 스토리지) |

`emptyDir`에 `medium: Memory`를 설정하면 디스크 대신 tmpfs(RAM 기반 파일시스템)를 사용한다. I/O 속도가 빠르지만 노드 메모리를 소비하며, Pod의 memory limits에 포함된다.

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: tmpfs-demo
  namespace: ckad-build
spec:
  containers:
    - name: app
      image: busybox:1.36
      command: ["sh", "-c", "df -h /cache && sleep 3600"]
      volumeMounts:
        - name: cache
          mountPath: /cache
  volumes:
    - name: cache
      emptyDir:
        medium: Memory
        sizeLimit: 64Mi
```

**검증**

```bash
kubectl logs tmpfs-demo -n ckad-build
```

```text
Filesystem                Size      Used Available Use% Mounted on
tmpfs                    64.0M         0     64.0M   0% /cache
```

`Filesystem`이 `tmpfs`로 표시되어 RAM 기반 파일시스템임을 확인할 수 있다.

```bash
kubectl exec tmpfs-demo -n ckad-build -- mount | grep cache
```

```text
tmpfs on /cache type tmpfs (rw,nosuid,nodev,noexec,relatime,size=65536k)
```

</details>

---

**문제 6.** `ambassador` 패턴을 구현하라. 메인 컨테이너가 localhost:6379로 Redis에 접근하면, ambassador 컨테이너가 이를 외부 Redis 서비스로 프록시하는 Pod를 설계하라 (개념 설명 + YAML 작성).

<details><summary>풀이 확인</summary>

**등장 배경:**

Ambassador 패턴은 메인 컨테이너가 항상 localhost로 통신하고, ambassador 컨테이너가 실제 외부 서비스로 프록시하는 패턴이다. 환경별로 외부 서비스 주소가 다른 경우, 메인 컨테이너 코드를 변경하지 않고 ambassador 설정만 변경하면 된다.

**내부 동작 원리:**

같은 Pod 내의 컨테이너는 네트워크 네임스페이스를 공유한다. 따라서 메인 컨테이너가 `localhost:6379`에 연결하면, 같은 Pod에서 6379 포트를 수신하는 ambassador 컨테이너가 요청을 받는다.

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: ambassador-demo
  namespace: ckad-build
spec:
  containers:
    - name: app
      image: busybox:1.36
      command: ["sh", "-c", "while true; do echo PING | nc localhost 6379; sleep 5; done"]
    - name: redis-ambassador
      image: alpine/socat:latest
      command: ["socat", "TCP-LISTEN:6379,fork,reuseaddr", "TCP:redis-external.default.svc.cluster.local:6379"]
      ports:
        - containerPort: 6379
```

메인 컨테이너는 `localhost:6379`로만 통신한다. ambassador가 이를 `redis-external.default.svc.cluster.local:6379`로 중계한다. 환경이 변경되면 ambassador의 대상 주소만 수정하면 된다.

**검증**

```bash
kubectl get pod ambassador-demo -n ckad-build
```

```text
NAME              READY   STATUS    RESTARTS   AGE
ambassador-demo   2/2     Running   0          15s
```

</details>

---

**문제 7.** Multi-container Pod에서 `shareProcessNamespace: true`를 설정하고, 한 컨테이너에서 다른 컨테이너의 프로세스를 `ps` 명령으로 확인하라.

<details><summary>풀이 확인</summary>

**등장 배경:**

기본적으로 각 컨테이너는 별도의 PID 네임스페이스를 가지므로, 한 컨테이너에서 다른 컨테이너의 프로세스를 볼 수 없다. `shareProcessNamespace: true`를 설정하면 Pod 내 모든 컨테이너가 PID 네임스페이스를 공유하여, 프로세스 모니터링이나 시그널 전송이 가능해진다.

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: shared-pid
  namespace: ckad-build
spec:
  shareProcessNamespace: true
  containers:
    - name: nginx
      image: nginx:1.25
    - name: sidecar
      image: busybox:1.36
      command: ["sh", "-c", "sleep 3600"]
```

**검증**

```bash
kubectl exec shared-pid -c sidecar -n ckad-build -- ps aux
```

```text
PID   USER     TIME  COMMAND
    1 65535     0:00 /pause
    7 root      0:00 nginx: master process nginx -g daemon off;
   37 101       0:00 nginx: worker process
   38 root      0:00 sh -c sleep 3600
   39 root      0:00 sleep 3600
   45 root      0:00 ps aux
```

sidecar 컨테이너에서 nginx 프로세스(PID 7)를 확인할 수 있다. PID 1은 pause 컨테이너(인프라 컨테이너)이다.

</details>

---

**문제 8.** Dockerfile 분석 문제: 다음 Dockerfile의 문제점을 3가지 이상 지적하고 최적화하라.

```dockerfile
FROM ubuntu:latest
RUN apt-get update
RUN apt-get install -y python3 python3-pip curl wget vim
COPY . /app
RUN pip3 install -r /app/requirements.txt
USER root
EXPOSE 8080
CMD ["python3", "/app/main.py"]
```

<details><summary>풀이 확인</summary>

**등장 배경:**

컨테이너 이미지 최적화는 보안, 빌드 속도, 런타임 성능에 직접 영향을 미친다. 불필요하게 큰 이미지는 pull 시간 증가, 스토리지 낭비, 공격 표면(attack surface) 확대를 초래한다.

**문제점과 해결:**

| # | 문제점 | 영향 | 해결 |
|---|--------|------|------|
| 1 | `ubuntu:latest` 태그 사용 | 빌드 재현성 없음, 이미지 크기 큼 | `python:3.11-slim` 또는 특정 버전 태그 사용 |
| 2 | `RUN`이 분리되어 레이어 수 증가 | 이미지 크기 증가, 캐시 비효율 | `RUN` 명령을 `&&`로 합침 |
| 3 | 불필요한 도구(vim, wget) 설치 | 이미지 크기 증가, 공격 표면 확대 | 필요한 패키지만 설치 |
| 4 | `USER root`로 실행 | 컨테이너 탈출 시 root 권한 획득 | 비root 사용자 생성 후 `USER appuser` |
| 5 | `COPY . /app`이 `pip install` 전에 위치 | 소스 변경마다 의존성 재설치 | requirements.txt만 먼저 COPY |

**최적화된 Dockerfile:**

```dockerfile
FROM python:3.11-slim AS builder
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

FROM python:3.11-slim
RUN groupadd -r appuser && useradd -r -g appuser appuser
WORKDIR /app
COPY --from=builder /usr/local/lib/python3.11/site-packages/ /usr/local/lib/python3.11/site-packages/
COPY . .
USER appuser
EXPOSE 8080
CMD ["python3", "main.py"]
```

</details>

---

### Application Deployment (6문항)

---

**문제 9.** `webapp`이라는 Deployment를 생성하라. `nginx:1.24` 이미지, 레플리카 4개이다. 이후 이미지를 `nginx:1.25`로 Rolling Update 하되, `maxSurge=1`, `maxUnavailable=0`으로 설정하라.

<details><summary>풀이 확인</summary>

**등장 배경 — zero-downtime 업데이트:**

`maxUnavailable: 0`으로 설정하면 업데이트 중에도 항상 원래 레플리카 수(4개)를 유지한다. 새 Pod가 Ready가 되어야 기존 Pod가 제거되므로 서비스 중단이 발생하지 않는다. `maxSurge: 1`은 업데이트 중 최대 5개(4+1) Pod가 동시에 존재할 수 있음을 의미한다.

이 설정의 트레이드오프: 추가 Pod를 위한 노드 리소스가 필요하며, 배포 속도가 느려진다 (새 Pod Ready 대기 시간).

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: webapp
spec:
  replicas: 4
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  selector:
    matchLabels:
      app: webapp
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
kubectl apply -f webapp.yaml

# 이미지 업데이트
kubectl set image deployment/webapp nginx=nginx:1.25

# 변경 사유 기록 (--record는 deprecated, annotate 사용)
kubectl annotate deployment/webapp kubernetes.io/change-cause="updated image to nginx:1.25"
```

**검증**

```bash
# 롤아웃 상태 확인
kubectl rollout status deployment/webapp
```

```text
deployment "webapp" successfully rolled out
```

```bash
# 현재 이미지 확인
kubectl get deployment webapp -o jsonpath='{.spec.template.spec.containers[0].image}'
```

```text
nginx:1.25
```

```bash
# 롤아웃 이력 확인
kubectl rollout history deployment/webapp
```

```text
REVISION  CHANGE-CAUSE
1         <none>
2         updated image to nginx:1.25
```

```bash
# 업데이트 전략 확인
kubectl get deployment webapp -o jsonpath='{.spec.strategy.rollingUpdate}'
```

```text
{"maxSurge":1,"maxUnavailable":0}
```

```bash
# 모든 Pod가 Running인지 확인
kubectl get pods -l app=webapp
```

```text
NAME                      READY   STATUS    RESTARTS   AGE
webapp-xxxx-abc12         1/1     Running   0          30s
webapp-xxxx-def34         1/1     Running   0          25s
webapp-xxxx-ghi56         1/1     Running   0          20s
webapp-xxxx-jkl78         1/1     Running   0          15s
```

**트러블슈팅 — 롤아웃이 멈추는 경우:**

새 Pod의 Readiness Probe가 실패하면 롤아웃이 진행되지 않는다 (maxUnavailable=0이므로 기존 Pod를 제거할 수 없고, maxSurge=1이므로 추가 Pod도 생성할 수 없다). 이 상태를 해결하려면:

```bash
# 롤아웃 진행 상태 확인
kubectl rollout status deployment/webapp --timeout=30s

# 새 Pod의 이벤트 확인
kubectl describe pod -l app=webapp | grep -A5 "Events:"

# 롤아웃 취소 (이전 버전으로 복원)
kubectl rollout undo deployment/webapp
```

</details>

---

**문제 10.** `webapp` Deployment의 현재 이미지가 `nginx:1.25`이다. 이미지를 `nginx:1.26`으로 업데이트하되, 변경 사유를 annotation으로 기록하라. 이후 revision 1로 롤백하라.

<details><summary>풀이 확인</summary>

**등장 배경:**

`--record` 플래그는 deprecated되었다. 대신 annotation `kubernetes.io/change-cause`로 변경 사유를 기록하는 것이 권장된다.

```bash
kubectl set image deployment/webapp nginx=nginx:1.26
kubectl annotate deployment/webapp kubernetes.io/change-cause="upgrade to nginx:1.26"

# 히스토리 확인
kubectl rollout history deployment/webapp
```

```text
REVISION  CHANGE-CAUSE
1         <none>
2         updated image to nginx:1.25
3         upgrade to nginx:1.26
```

```bash
# revision 1로 롤백
kubectl rollout undo deployment/webapp --to-revision=1
kubectl rollout status deployment/webapp
```

```text
deployment "webapp" successfully rolled out
```

```bash
kubectl get deployment webapp -o jsonpath='{.spec.template.spec.containers[0].image}'
echo ""
```

```text
nginx:1.24
```

**트러블슈팅:**

롤백 시 새 revision 번호(4)가 생성된다. revision 1은 목록에서 사라진다.

</details>

---

**문제 11.** `blue-green` 배포를 구현하라. `app-blue` Deployment(nginx:1.24, 3 replicas)와 `app-green` Deployment(nginx:1.25, 3 replicas)를 생성하고, Service의 selector를 변경하여 트래픽을 전환하라.

<details><summary>풀이 확인</summary>

**등장 배경:**

Blue-Green 배포는 두 환경(Blue=현재, Green=신규)을 동시에 유지하다가, Service selector를 변경하여 트래픽을 한 번에 전환하는 전략이다. Canary와 달리 부분 전환이 아닌 전체 전환이므로 구현이 간단하지만, 두 배의 리소스가 필요하다.

```bash
# Blue Deployment
kubectl create deployment app-blue --image=nginx:1.24 --replicas=3
kubectl label deployment app-blue version=blue

# Green Deployment
kubectl create deployment app-green --image=nginx:1.25 --replicas=3
kubectl label deployment app-green version=green

# Service (현재 Blue를 가리킴)
cat <<'EOF' | kubectl apply -f -
apiVersion: v1
kind: Service
metadata:
  name: app-svc
spec:
  selector:
    app: app-blue
  ports:
    - port: 80
      targetPort: 80
EOF
```

**검증 — Blue 상태**

```bash
kubectl get endpoints app-svc
```

```text
NAME      ENDPOINTS                                      AGE
app-svc   10.244.1.10:80,10.244.1.11:80,10.244.2.8:80   10s
```

```bash
# Green으로 전환
kubectl patch svc app-svc -p '{"spec":{"selector":{"app":"app-green"}}}'

# 전환 후 Endpoint 확인
kubectl get endpoints app-svc
```

```text
NAME      ENDPOINTS                                        AGE
app-svc   10.244.2.10:80,10.244.2.11:80,10.244.3.8:80   30s
```

**트러블슈팅:**

전환 후 문제가 발견되면 selector를 다시 `app: app-blue`로 변경하여 즉시 롤백할 수 있다.

</details>

---

**문제 12.** Helm chart에서 `values.yaml`의 값을 오버라이드하여 배포하라. `bitnami/nginx` chart를 `replicaCount=3`, `service.type=NodePort`로 설치하라.

<details><summary>풀이 확인</summary>

**등장 배경:**

Helm의 핵심은 동일한 chart를 다양한 values로 배포할 수 있다는 점이다. 명령줄 `--set` 또는 커스텀 values 파일(`-f`)로 오버라이드한다.

```bash
helm repo add bitnami https://charts.bitnami.com/bitnami
helm repo update

helm install my-nginx bitnami/nginx \
  --set replicaCount=3 \
  --set service.type=NodePort
```

**검증**

```bash
helm list
```

```text
NAME      NAMESPACE  REVISION  UPDATED       STATUS    CHART          APP VERSION
my-nginx  default    1         2024-...      deployed  nginx-15.x.x   1.25.x
```

```bash
kubectl get deployment -l app.kubernetes.io/instance=my-nginx
```

```text
NAME             READY   UP-TO-DATE   AVAILABLE   AGE
my-nginx-nginx   3/3     3            3           30s
```

```bash
kubectl get svc -l app.kubernetes.io/instance=my-nginx
```

```text
NAME             TYPE       CLUSTER-IP     EXTERNAL-IP   PORT(S)        AGE
my-nginx-nginx   NodePort   10.96.45.123   <none>        80:31234/TCP   30s
```

```bash
# 적용된 values 확인
helm get values my-nginx
```

```text
USER-SUPPLIED VALUES:
replicaCount: 3
service:
  type: NodePort
```

</details>

---

**문제 13.** Kustomize를 사용하여 base에 정의된 Deployment에 namespace와 label을 추가하는 overlay를 작성하라.

<details><summary>풀이 확인</summary>

**등장 배경:**

Kustomize의 `commonLabels`는 모든 리소스와 selector에 label을 자동 추가한다. `namespace` 필드는 모든 리소스에 네임스페이스를 설정한다.

```yaml
# overlays/staging/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - ../../base
namespace: staging
commonLabels:
  env: staging
  team: platform
```

**검증**

```bash
kubectl kustomize overlays/staging/
```

```text
apiVersion: apps/v1
kind: Deployment
metadata:
  labels:
    app: web-app
    env: staging
    team: platform
  name: web-app
  namespace: staging
spec:
  selector:
    matchLabels:
      app: web-app
      env: staging
      team: platform
...
```

`commonLabels`가 metadata.labels와 selector.matchLabels 모두에 추가되었다.

**주의:** `commonLabels`는 selector에도 영향을 주므로, 이미 배포된 리소스에 적용하면 selector 불일치로 문제가 발생할 수 있다.

</details>

---

**문제 14.** Deployment의 `strategy.type`을 `Recreate`로 설정하여 배포하라. Rolling Update와의 차이점을 설명하라.

<details><summary>풀이 확인</summary>

**등장 배경:**

Recreate 전략은 모든 기존 Pod를 먼저 삭제한 후 새 Pod를 생성한다. 다운타임이 발생하지만, 이전 버전과 새 버전이 동시에 실행되면 안 되는 경우(DB 스키마 변경 등)에 필요하다.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: recreate-demo
spec:
  replicas: 3
  strategy:
    type: Recreate           # maxSurge, maxUnavailable 설정 불가
  selector:
    matchLabels:
      app: recreate-demo
  template:
    metadata:
      labels:
        app: recreate-demo
    spec:
      containers:
        - name: app
          image: nginx:1.24
```

**검증**

```bash
# 이미지 업데이트 후 동작 관찰
kubectl set image deployment/recreate-demo app=nginx:1.25
kubectl get pods -l app=recreate-demo -w
```

```text
NAME                      READY   STATUS        RESTARTS   AGE
recreate-demo-aaa-111     1/1     Terminating   0          2m
recreate-demo-aaa-222     1/1     Terminating   0          2m
recreate-demo-aaa-333     1/1     Terminating   0          2m
recreate-demo-bbb-111     0/1     Pending       0          0s
recreate-demo-bbb-222     0/1     Pending       0          0s
recreate-demo-bbb-333     0/1     Pending       0          0s
recreate-demo-bbb-111     1/1     Running       0          5s
recreate-demo-bbb-222     1/1     Running       0          5s
recreate-demo-bbb-333     1/1     Running       0          5s
```

모든 기존 Pod가 Terminating된 후 새 Pod가 생성되는 것을 확인할 수 있다. 이 사이에 서비스 다운타임이 발생한다.

| 전략 | 다운타임 | 두 버전 동시 실행 | 리소스 오버헤드 |
|------|---------|-----------------|---------------|
| RollingUpdate | 없음 | 있음 | maxSurge만큼 추가 |
| Recreate | 있음 | 없음 | 없음 |

</details>

---

### Application Observability and Maintenance (5문항)

---

**문제 15.** Pod에 Liveness, Readiness, Startup Probe를 모두 설정하라. `httpGet` 방식으로 `/healthz`(liveness), `/ready`(readiness), `/started`(startup)를 사용하라.

<details><summary>풀이 확인</summary>

**등장 배경:**

세 가지 Probe는 각각 다른 목적을 가진다. Startup은 초기화 완료를 판단하고, Readiness는 트래픽 수신 가능 여부를, Liveness는 컨테이너 건강 상태를 판단한다. 세 Probe를 올바르게 조합하면 느린 초기화, 일시적 과부하, 영구적 장애를 모두 적절히 처리할 수 있다.

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: probe-all
spec:
  containers:
    - name: app
      image: nginx:1.25
      ports:
        - containerPort: 80
      startupProbe:
        httpGet:
          path: /started
          port: 80
        periodSeconds: 5
        failureThreshold: 30
      livenessProbe:
        httpGet:
          path: /healthz
          port: 80
        periodSeconds: 10
        failureThreshold: 3
      readinessProbe:
        httpGet:
          path: /ready
          port: 80
        periodSeconds: 5
        failureThreshold: 3
```

**검증**

```bash
kubectl describe pod probe-all | grep -E "Startup:|Liveness:|Readiness:"
```

```text
    Startup:    http-get http://:80/started delay=0s timeout=1s period=5s #success=1 #failure=30
    Liveness:   http-get http://:80/healthz delay=0s timeout=1s period=10s #success=1 #failure=3
    Readiness:  http-get http://:80/ready delay=0s timeout=1s period=5s #success=1 #failure=3
```

**내부 동작 순서:**

1. Pod 시작 -> Startup Probe만 활성화 (최대 150초 대기)
2. Startup 성공 -> Liveness + Readiness 활성화
3. Readiness 성공 -> Endpoint 추가
4. Liveness 3회 연속 실패 -> 컨테이너 재시작

</details>

---

**문제 16.** CrashLoopBackOff 상태의 Pod를 진단하라. `kubectl logs --previous`로 이전 컨테이너 로그를 확인하고, `kubectl describe pod`로 재시작 원인을 파악하라.

<details><summary>풀이 확인</summary>

**등장 배경:**

CrashLoopBackOff는 컨테이너가 반복적으로 실패하고 재시작되는 상태이다. kubelet은 지수적 백오프(10초, 20초, 40초, ..., 최대 5분)로 재시작 간격을 늘린다. 원인 파악을 위해 이전 컨테이너의 로그를 확인해야 한다.

```bash
# CrashLoopBackOff Pod 생성 (의도적 실패)
kubectl run crash-demo --image=busybox:1.36 --restart=Always -- sh -c "exit 1"
```

**검증**

```bash
kubectl get pod crash-demo
```

```text
NAME         READY   STATUS             RESTARTS      AGE
crash-demo   0/1     CrashLoopBackOff   3 (30s ago)   1m
```

```bash
kubectl logs crash-demo --previous
```

```text
(빈 출력 — exit 1만 실행했으므로)
```

```bash
kubectl describe pod crash-demo | grep -A10 "Last State:"
```

```text
    Last State:     Terminated
      Reason:       Error
      Exit Code:    1
      Started:      Mon, 01 Jan 2024 00:00:00 +0000
      Finished:     Mon, 01 Jan 2024 00:00:00 +0000
```

**진단 플로우:**

```
CrashLoopBackOff
├── Exit Code 1 → 애플리케이션 에러 → kubectl logs --previous
├── Exit Code 137 → OOMKilled → kubectl describe pod → memory limits 증가
├── Exit Code 0 → 정상 종료인데 restartPolicy=Always → 명령어 확인
└── Exit Code 126/127 → command/entrypoint 오류 → 이미지의 바이너리 경로 확인
```

</details>

---

**문제 17.** `kubectl debug`로 ephemeral container를 추가하여 실행 중인 Pod를 디버깅하라. 디버깅 이미지로 `busybox:1.36`을 사용하고, Pod 내부의 네트워크 상태를 확인하라.

<details><summary>풀이 확인</summary>

**등장 배경:**

distroless 이미지에는 셸이 없어 `kubectl exec`가 불가능하다. ephemeral container는 실행 중인 Pod에 디버깅용 컨테이너를 주입하여, Pod를 재시작하지 않고 진단한다.

```bash
# 대상 Pod 생성
kubectl run debug-target --image=nginx:1.25 --restart=Never

# Ephemeral container 추가
kubectl debug -it debug-target --image=busybox:1.36 --target=debug-target -- sh
```

ephemeral container 내부에서:

```bash
# 네트워크 인터페이스 확인
ifconfig
# DNS 확인
nslookup kubernetes.default
# 포트 확인
netstat -tlnp
# 대상 컨테이너의 프로세스 확인 (--target 지정 시)
ps aux
```

**검증**

```bash
kubectl get pod debug-target -o jsonpath='{.spec.ephemeralContainers}' | jq length
```

```text
1
```

**트러블슈팅:**

- "ephemeral containers are disabled" 오류: API 서버의 `EphemeralContainers` feature gate가 비활성화되어 있다 (쿠버네티스 1.25+에서는 기본 활성화).
- `--target`을 지정하지 않으면 프로세스 네임스페이스를 공유하지 않아 대상 컨테이너의 프로세스를 볼 수 없다.

</details>

---

**문제 18.** `kubectl top pod`으로 네임스페이스 내 모든 Pod의 CPU/메모리 사용량을 확인하고, 가장 많은 CPU를 사용하는 Pod를 찾아라.

<details><summary>풀이 확인</summary>

**등장 배경:**

metrics-server가 kubelet의 cAdvisor에서 수집한 메트릭을 기반으로 `kubectl top`이 동작한다. 리소스 사용량을 실시간으로 모니터링하여 OOM이나 CPU 스로틀링 위험을 사전에 감지할 수 있다.

```bash
# Pod CPU 기준 정렬
kubectl top pod -n demo --sort-by=cpu
```

```text
NAME                      CPU(cores)   MEMORY(bytes)
keycloak-xxx-aaa          120m         512Mi
grafana-xxx-bbb           45m          256Mi
nginx-xxx-ccc             3m           25Mi
```

```bash
# 가장 많은 CPU를 사용하는 Pod 이름만 추출
kubectl top pod -n demo --sort-by=cpu --no-headers | head -1 | awk '{print $1}'
```

```text
keycloak-xxx-aaa
```

**트러블슈팅:**

`kubectl top`이 "error: Metrics API not available" 오류를 반환하면 metrics-server가 설치되지 않았거나 Ready가 아닌 상태이다. `kubectl get deployment metrics-server -n kube-system`으로 확인한다.

</details>

---

**문제 19.** Pod의 재시작 횟수가 증가하는 원인을 체계적으로 진단하라. `kubectl get`, `kubectl describe`, `kubectl logs`를 순서대로 사용하여 원인을 파악하는 절차를 설명하라.

<details><summary>풀이 확인</summary>

**등장 배경:**

재시작 원인은 다양하다: OOMKill, Liveness Probe 실패, 애플리케이션 크래시, 잘못된 command/args 등. 체계적 진단 절차를 따르면 원인을 빠르게 파악할 수 있다.

**체계적 진단 절차:**

```bash
# Step 1: 현재 상태 확인
kubectl get pod <pod> -o wide
```

```text
NAME     READY   STATUS    RESTARTS      AGE   IP            NODE
myapp    1/1     Running   5 (2m ago)    10m   10.244.1.10   worker1
```

```bash
# Step 2: 재시작 원인 확인
kubectl describe pod <pod> | grep -A5 "Last State:"
```

```text
    Last State:     Terminated
      Reason:       OOMKilled
      Exit Code:    137
      Started:      Mon, 01 Jan 2024 00:00:00 +0000
      Finished:     Mon, 01 Jan 2024 00:00:30 +0000
```

```bash
# Step 3: 이전 컨테이너 로그 확인
kubectl logs <pod> --previous | tail -20
```

```text
Exception in thread "main" java.lang.OutOfMemoryError: Java heap space
```

```bash
# Step 4: 이벤트 확인
kubectl get events --field-selector involvedObject.name=<pod> --sort-by=.metadata.creationTimestamp
```

```text
LAST SEEN   TYPE      REASON      OBJECT       MESSAGE
2m          Warning   OOMKilling  pod/myapp    Memory cgroup out of memory: Killed process 1
```

**원인별 해결 테이블:**

| Exit Code | Reason | 원인 | 해결 |
|-----------|--------|------|------|
| 137 | OOMKilled | 메모리 사용량 > limits | memory limits 증가 |
| 1 | Error | 애플리케이션 에러 | 로그 확인 후 코드 수정 |
| 0 | Completed | 정상 종료 (restartPolicy=Always) | 컨테이너 명령어 확인 |
| 126 | Error | 권한 부족으로 실행 불가 | 파일 권한 또는 securityContext 확인 |
| 127 | Error | 명령어를 찾을 수 없음 | command/args의 바이너리 경로 확인 |

</details>

---

### Application Environment, Configuration and Security (6문항)

---

**문제 20.** ConfigMap을 volume으로 마운트한 Pod를 생성하라. ConfigMap 변경 후 Pod 내 파일이 자동 갱신되는 것을 확인하라. subPath 마운트와 일반 마운트의 차이를 설명하라.

<details><summary>풀이 확인</summary>

**등장 배경:**

ConfigMap을 volume으로 마운트하면 kubelet이 주기적으로(기본 60초 + 일정 지터) 변경을 확인하여 파일을 갱신한다. 단, `subPath` 마운트는 자동 갱신이 되지 않는다. 이 차이를 이해하지 않으면 설정 변경 후 애플리케이션이 이전 설정으로 동작하는 문제가 발생한다.

**내부 동작 원리:**

일반 마운트: kubelet이 ConfigMap 데이터를 심볼릭 링크 구조로 관리한다. `/data` -> `..data` -> `..2024_01_01_00_00_00.123456` -> 실제 파일. ConfigMap 변경 시 새 디렉터리를 생성하고 `..data` 심볼릭 링크만 교체하므로, atomic update가 보장된다.

subPath 마운트: 파일을 직접 bind mount하므로 심볼릭 링크 갱신이 적용되지 않는다.

```bash
kubectl create configmap web-config --from-literal=index.html="<h1>Version 1</h1>"

cat <<'EOF' | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: cm-vol
spec:
  containers:
    - name: nginx
      image: nginx:1.25
      volumeMounts:
        - name: config
          mountPath: /usr/share/nginx/html
  volumes:
    - name: config
      configMap:
        name: web-config
EOF
```

**검증**

```bash
kubectl exec cm-vol -- cat /usr/share/nginx/html/index.html
```

```text
<h1>Version 1</h1>
```

```bash
# ConfigMap 업데이트
kubectl patch configmap web-config -p '{"data":{"index.html":"<h1>Version 2</h1>"}}'

# 약 60초 후 확인
kubectl exec cm-vol -- cat /usr/share/nginx/html/index.html
```

```text
<h1>Version 2</h1>
```

```bash
# 심볼릭 링크 구조 확인
kubectl exec cm-vol -- ls -la /usr/share/nginx/html/
```

```text
total 0
drwxrwxrwx    3 root     root           80 Jan  1 00:00 .
drwxr-xr-x    3 root     root         4096 Jan  1 00:00 ..
drwxr-xr-x    2 root     root           60 Jan  1 00:01 ..2024_01_01_00_01_00.456789
lrwxrwxrwx    1 root     root           31 Jan  1 00:01 ..data -> ..2024_01_01_00_01_00.456789
lrwxrwxrwx    1 root     root           17 Jan  1 00:00 index.html -> ..data/index.html
```

</details>

---

**문제 21.** Secret을 환경변수와 volume 두 가지 방식으로 Pod에 주입하라. 각 방식의 보안 특성 차이를 설명하라.

<details><summary>풀이 확인</summary>

**등장 배경:**

환경변수 방식은 `kubectl exec -- env`로 쉽게 노출될 수 있고, 프로세스 메모리에 상주한다. Volume 방식은 tmpfs에 마운트되어 디스크에 기록되지 않으며, `defaultMode`로 파일 권한을 제한할 수 있다.

```bash
kubectl create secret generic app-creds --from-literal=DB_PASS=s3cret --from-literal=API_KEY=key123

cat <<'EOF' | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: secret-both
spec:
  containers:
    - name: app
      image: busybox:1.36
      command: ["sh", "-c", "echo ENV=$DB_PASS && cat /secrets/API_KEY && sleep 3600"]
      env:
        - name: DB_PASS
          valueFrom:
            secretKeyRef:
              name: app-creds
              key: DB_PASS
      volumeMounts:
        - name: sec-vol
          mountPath: /secrets
          readOnly: true
  volumes:
    - name: sec-vol
      secret:
        secretName: app-creds
        defaultMode: 0400       # 소유자만 읽기
EOF
```

**검증**

```bash
kubectl logs secret-both | head -2
```

```text
ENV=s3cret
key123
```

```bash
kubectl exec secret-both -- ls -la /secrets/
```

```text
total 0
drwxrwxrwt    3 root     root          120 Jan  1 00:00 .
lr--------    1 root     root           14 Jan  1 00:00 API_KEY -> ..data/API_KEY
lr--------    1 root     root           14 Jan  1 00:00 DB_PASS -> ..data/DB_PASS
```

파일 권한이 `0400`(읽기 전용)으로 설정되어 있다.

| 특성 | 환경변수 | Volume |
|------|---------|--------|
| 접근 방법 | `$VAR` | 파일 읽기 |
| 보안 | `env` 명령으로 노출 가능 | 파일 권한으로 제한 가능 |
| 자동 갱신 | 불가 (Pod 재시작 필요) | 가능 (kubelet이 주기적 갱신) |
| 저장 위치 | 프로세스 메모리 | tmpfs (디스크에 기록 안 됨) |

</details>

---

**문제 22.** SecurityContext를 사용하여 다음 조건을 만족하는 Pod를 생성하라: root가 아닌 사용자(UID 1000)로 실행, root filesystem 읽기 전용, 모든 Linux capabilities 제거.

<details><summary>풀이 확인</summary>

**등장 배경:**

최소 권한 원칙(Principle of Least Privilege)을 적용하면 컨테이너 탈출 취약점이 발견되어도 호스트에 대한 영향을 최소화할 수 있다. `readOnlyRootFilesystem`은 파일시스템 변조를 방지하고, `capabilities: drop: [ALL]`은 권한 상승 경로를 차단한다.

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: hardened-pod
spec:
  securityContext:
    runAsUser: 1000
    runAsGroup: 1000
    runAsNonRoot: true
  containers:
    - name: app
      image: busybox:1.36
      command: ["sh", "-c", "id && whoami && sleep 3600"]
      securityContext:
        readOnlyRootFilesystem: true
        allowPrivilegeEscalation: false
        capabilities:
          drop:
            - ALL
      volumeMounts:
        - name: tmp
          mountPath: /tmp
  volumes:
    - name: tmp
      emptyDir: {}
```

**검증**

```bash
kubectl logs hardened-pod
```

```text
uid=1000 gid=1000
whoami: unknown uid 1000
```

```bash
# root filesystem 쓰기 시도 (실패)
kubectl exec hardened-pod -- touch /etc/test 2>&1
```

```text
touch: /etc/test: Read-only file system
```

```bash
# /tmp (emptyDir)에는 쓰기 가능
kubectl exec hardened-pod -- touch /tmp/test && echo "OK"
```

```text
OK
```

```bash
# capabilities 확인
kubectl exec hardened-pod -- cat /proc/1/status | grep Cap
```

```text
CapInh: 0000000000000000
CapPrm: 0000000000000000
CapEff: 0000000000000000
CapBnd: 0000000000000000
CapAmb: 0000000000000000
```

모든 capability가 0으로 제거되었다.

</details>

---

**문제 23.** LimitRange와 ResourceQuota를 동시에 설정한 네임스페이스에서, requests/limits를 지정하지 않은 Pod를 생성하라. LimitRange가 기본값을 주입하는지 확인하라.

<details><summary>풀이 확인</summary>

**등장 배경:**

ResourceQuota가 설정된 네임스페이스에서 requests가 없는 Pod를 생성하면 `"must specify requests"` 오류가 발생한다. LimitRange의 `defaultRequest`와 `default`가 이 문제를 해결한다.

```bash
kubectl create namespace quota-test

cat <<'EOF' | kubectl apply -n quota-test -f -
apiVersion: v1
kind: LimitRange
metadata:
  name: defaults
spec:
  limits:
    - type: Container
      default:
        cpu: 200m
        memory: 256Mi
      defaultRequest:
        cpu: 100m
        memory: 128Mi
---
apiVersion: v1
kind: ResourceQuota
metadata:
  name: quota
spec:
  hard:
    requests.cpu: "2"
    requests.memory: 4Gi
    limits.cpu: "4"
    limits.memory: 8Gi
    pods: "10"
EOF
```

**검증**

```bash
# requests 없이 Pod 생성
kubectl run test --image=busybox:1.36 -n quota-test --restart=Never -- sleep 3600

# LimitRange가 주입한 기본값 확인
kubectl get pod test -n quota-test -o jsonpath='{.spec.containers[0].resources}' | jq .
```

```text
{
  "limits": {
    "cpu": "200m",
    "memory": "256Mi"
  },
  "requests": {
    "cpu": "100m",
    "memory": "128Mi"
  }
}
```

```bash
# ResourceQuota 사용량 확인
kubectl describe resourcequota quota -n quota-test | grep -E "cpu|memory|pods"
```

```text
  limits.cpu       200m  4
  limits.memory    256Mi  8Gi
  pods             1     10
  requests.cpu     100m  2
  requests.memory  128Mi  4Gi
```

</details>

---

**문제 24.** ServiceAccount를 생성하고, 해당 SA에 Pod 목록 조회 권한만 부여하는 Role/RoleBinding을 설정하라. Pod에서 API를 호출하여 권한을 검증하라.

<details><summary>풀이 확인</summary>

**등장 배경:**

기본 ServiceAccount는 대부분의 API 접근 권한이 없다. 애플리케이션이 쿠버네티스 API를 호출해야 하는 경우(예: 설정 자동 검색), 필요한 최소 권한만 부여하는 것이 보안 모범 사례이다.

```bash
kubectl create serviceaccount pod-reader -n demo
kubectl create role pod-list --verb=get,list --resource=pods -n demo
kubectl create rolebinding pod-reader-binding --role=pod-list --serviceaccount=demo:pod-reader -n demo

cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: v1
kind: Pod
metadata:
  name: api-test
spec:
  serviceAccountName: pod-reader
  containers:
    - name: curl
      image: curlimages/curl:8.5.0
      command: ["sh", "-c", "sleep 3600"]
EOF
```

**검증**

```bash
# Pod 목록 조회 (성공해야 함)
kubectl exec api-test -n demo -- curl -s \
  --cacert /var/run/secrets/kubernetes.io/serviceaccount/ca.crt \
  -H "Authorization: Bearer $(kubectl exec api-test -n demo -- cat /var/run/secrets/kubernetes.io/serviceaccount/token)" \
  https://kubernetes.default.svc/api/v1/namespaces/demo/pods | head -5
```

```text
{
  "kind": "PodList",
  "apiVersion": "v1",
  "metadata": {
    "resourceVersion": "12345"
```

```bash
# Pod 삭제 시도 (실패해야 함)
kubectl auth can-i delete pods -n demo --as=system:serviceaccount:demo:pod-reader
```

```text
no
```

</details>

---

**문제 25.** Pod의 QoS 클래스를 결정하는 규칙을 설명하고, Guaranteed, Burstable, BestEffort 각각에 해당하는 Pod를 생성하여 QoS 클래스를 확인하라.

<details><summary>풀이 확인</summary>

**등장 배경:**

QoS 클래스는 노드 리소스 부족(memory pressure) 시 어떤 Pod를 먼저 퇴출할지 결정하는 기준이다. OOM 발생 시 커널은 OOM score가 높은 프로세스부터 종료한다.

**QoS 결정 규칙:**

| QoS | 조건 | OOM Score |
|-----|------|-----------|
| Guaranteed | 모든 컨테이너에 CPU/Memory requests = limits | -997 (최후에 종료) |
| Burstable | requests/limits가 설정되었지만 Guaranteed 조건 불충족 | 2~999 |
| BestEffort | requests/limits가 전혀 미설정 | 1000 (최우선 종료) |

```bash
# Guaranteed
kubectl run qos-g --image=busybox:1.36 --restart=Never \
  --requests='cpu=100m,memory=128Mi' --limits='cpu=100m,memory=128Mi' -- sleep 3600

# Burstable
kubectl run qos-b --image=busybox:1.36 --restart=Never \
  --requests='cpu=50m,memory=64Mi' --limits='cpu=200m,memory=256Mi' -- sleep 3600

# BestEffort
kubectl run qos-be --image=busybox:1.36 --restart=Never -- sleep 3600
```

**검증**

```bash
for pod in qos-g qos-b qos-be; do
  echo "$pod: $(kubectl get pod $pod -o jsonpath='{.status.qosClass}')"
done
```

```text
qos-g: Guaranteed
qos-b: Burstable
qos-be: BestEffort
```

</details>

---

### Services & Networking (5문항)

---

**문제 26.** NetworkPolicy를 생성하여 `db` Pod로의 Ingress를 `app: api` label을 가진 Pod에서만 TCP 5432 포트로 허용하라. 다른 모든 Ingress는 차단해야 한다.

<details><summary>풀이 확인</summary>

**등장 배경:**

데이터베이스는 인증된 애플리케이션에서만 접근해야 한다. 기본적으로 쿠버네티스의 모든 Pod는 서로 통신할 수 있으므로, NetworkPolicy 없이는 어떤 Pod든 DB에 직접 접근할 수 있다.

**내부 동작 원리:**

NetworkPolicy가 Pod에 적용되면 기본 정책이 "deny all"로 변경된다. 명시적으로 허용된 트래픽만 전달된다. `policyTypes: [Ingress]`를 지정하고 `ingress` 규칙에 조건을 추가하면, 해당 조건에 매칭되는 트래픽만 허용된다.

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: db-policy
  namespace: demo
spec:
  podSelector:
    matchLabels:
      app: db
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: api
      ports:
        - protocol: TCP
          port: 5432
```

**검증**

```bash
kubectl get networkpolicy db-policy -n demo
```

```text
NAME        POD-SELECTOR   AGE
db-policy   app=db         10s
```

```bash
kubectl describe networkpolicy db-policy -n demo | grep -A10 "Allowing ingress"
```

```text
  Allowing ingress traffic:
    To Port: 5432/TCP
    From:
      PodSelector: app=api
  Not affecting egress traffic
```

```bash
# 테스트: api Pod에서 db 접근 (허용)
kubectl run api-pod --image=busybox:1.36 --labels="app=api" --restart=Never -n demo -- sleep 3600
kubectl exec api-pod -n demo -- nc -zv db-svc 5432 -w 3 2>&1
```

```text
db-svc (10.96.xx.xx:5432) open
```

```bash
# 테스트: 무관한 Pod에서 db 접근 (차단)
kubectl run other-pod --image=busybox:1.36 --labels="app=other" --restart=Never -n demo -- sleep 3600
kubectl exec other-pod -n demo -- nc -zv db-svc 5432 -w 3 2>&1
```

```text
nc: db-svc (10.96.xx.xx:5432): Connection timed out
```

</details>

---

**문제 27.** Ingress를 생성하여 `app.example.com/api` 경로는 `api-svc:8080`으로, `app.example.com/web` 경로는 `web-svc:80`으로 라우팅하라. pathType은 Prefix를 사용하라.

<details><summary>풀이 확인</summary>

**등장 배경:**

하나의 도메인에서 경로 기반으로 여러 백엔드 서비스를 분배하면, 서비스마다 별도의 로드밸런서를 생성하지 않아도 되므로 비용이 절감된다.

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: path-routing
  annotations:
    nginx.ingress.kubernetes.io/rewrite-target: /
spec:
  ingressClassName: nginx
  rules:
    - host: app.example.com
      http:
        paths:
          - path: /api
            pathType: Prefix
            backend:
              service:
                name: api-svc
                port:
                  number: 8080
          - path: /web
            pathType: Prefix
            backend:
              service:
                name: web-svc
                port:
                  number: 80
```

**검증**

```bash
kubectl get ingress path-routing
```

```text
NAME           CLASS   HOSTS             ADDRESS        PORTS   AGE
path-routing   nginx   app.example.com   192.168.64.2   80      10s
```

```bash
kubectl describe ingress path-routing | grep -B1 -A3 "Path:"
```

```text
  Host             Path  Backends
  ----             ----  --------
  app.example.com
                   /api   api-svc:8080 (...)
                   /web   web-svc:80 (...)
```

**트러블슈팅:**

`pathType: Exact`는 정확히 해당 경로만 매칭한다 (`/api`만 매칭, `/api/users`는 매칭 안 됨). `Prefix`는 `/api`로 시작하는 모든 경로를 매칭한다.

</details>

---

**문제 28.** Service의 다양한 유형(ClusterIP, NodePort, LoadBalancer, ExternalName)의 차이점을 설명하고, ExternalName Service를 생성하여 외부 도메인에 대한 CNAME 별칭을 만들어라.

<details><summary>풀이 확인</summary>

**등장 배경:**

| 유형 | 접근 범위 | 사용 사례 |
|------|---------|----------|
| ClusterIP | 클러스터 내부만 | 내부 마이크로서비스 통신 |
| NodePort | 노드 IP:포트 | 개발/테스트 환경 외부 접근 |
| LoadBalancer | 외부 로드밸런서 | 프로덕션 외부 트래픽 |
| ExternalName | DNS CNAME | 외부 서비스를 내부 DNS로 접근 |

ExternalName Service는 DNS 레벨에서 CNAME 레코드를 생성한다. 클러스터 내부에서 Service 이름으로 접근하면 CoreDNS가 지정된 외부 도메인의 CNAME을 반환한다.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: external-api
  namespace: demo
spec:
  type: ExternalName
  externalName: api.external-service.com
```

**검증**

```bash
kubectl get svc external-api -n demo
```

```text
NAME           TYPE           CLUSTER-IP   EXTERNAL-IP                  PORT(S)   AGE
external-api   ExternalName   <none>       api.external-service.com     <none>    10s
```

```bash
kubectl run dns-test --image=busybox:1.36 --rm -it --restart=Never -n demo -- nslookup external-api.demo.svc.cluster.local
```

```text
Name:      external-api.demo.svc.cluster.local
Address:   api.external-service.com
```

DNS 응답이 CNAME으로 `api.external-service.com`을 반환한다.

**트러블슈팅:**

ExternalName Service는 포트 매핑을 지원하지 않는다. 외부 서비스의 포트를 변경하려면 ExternalName 대신 selector 없는 Service + 수동 Endpoints를 사용해야 한다.

</details>

---

**문제 29.** Headless Service와 StatefulSet을 조합하여 각 Pod에 고유한 DNS 레코드가 생성되는 것을 확인하라. `nslookup`으로 개별 Pod DNS를 검증하라.

<details><summary>풀이 확인</summary>

**등장 배경:**

일반 ClusterIP Service는 가상 IP 하나만 반환하므로 개별 Pod에 직접 접근할 수 없다. StatefulSet + Headless Service 조합은 각 Pod에 `<pod-name>.<service-name>.<namespace>.svc.cluster.local` 형태의 안정적 DNS를 부여한다.

```bash
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: v1
kind: Service
metadata:
  name: web-headless
spec:
  clusterIP: None
  selector:
    app: web-sts
  ports:
    - port: 80
---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: web-sts
spec:
  serviceName: web-headless
  replicas: 3
  selector:
    matchLabels:
      app: web-sts
  template:
    metadata:
      labels:
        app: web-sts
    spec:
      containers:
        - name: nginx
          image: nginx:1.25-alpine
          ports:
            - containerPort: 80
EOF
```

**검증**

```bash
# Service DNS (모든 Pod IP 반환)
kubectl run dns-test --image=busybox:1.36 --rm -it --restart=Never -n demo -- nslookup web-headless.demo.svc.cluster.local
```

```text
Name:      web-headless.demo.svc.cluster.local
Address:   10.244.1.10
Address:   10.244.1.11
Address:   10.244.2.8
```

```bash
# 개별 Pod DNS
kubectl run dns-test2 --image=busybox:1.36 --rm -it --restart=Never -n demo -- nslookup web-sts-0.web-headless.demo.svc.cluster.local
```

```text
Name:      web-sts-0.web-headless.demo.svc.cluster.local
Address:   10.244.1.10
```

```bash
kubectl run dns-test3 --image=busybox:1.36 --rm -it --restart=Never -n demo -- nslookup web-sts-2.web-headless.demo.svc.cluster.local
```

```text
Name:      web-sts-2.web-headless.demo.svc.cluster.local
Address:   10.244.2.8
```

각 Pod에 고유한 DNS 레코드가 생성되었다. Pod가 재시작되어도 이름이 유지되므로, 다른 Pod에서 특정 인스턴스에 안정적으로 접근할 수 있다.

</details>

---

**문제 30.** NetworkPolicy에서 `from` 배열의 AND 조건과 OR 조건의 차이를 설명하고, 각 조건에 해당하는 YAML 예제를 작성하라.

<details><summary>풀이 확인</summary>

**등장 배경:**

NetworkPolicy의 `from` 배열 문법은 CKAD 시험에서 가장 자주 실수하는 부분이다. 같은 `- from` 항목 내에 `podSelector`와 `namespaceSelector`를 함께 배치하면 AND 조건이고, 별도 `- from` 항목으로 분리하면 OR 조건이다.

**OR 조건 (두 개의 별도 from 항목):**

```yaml
ingress:
  - from:
      - namespaceSelector:          # 조건 A: frontend 네임스페이스의 모든 Pod
          matchLabels:
            purpose: frontend
      - podSelector:                # 조건 B: 같은 네임스페이스의 role=monitoring Pod
          matchLabels:
            role: monitoring
    ports:
      - port: 80
```

의미: `(frontend 네임스페이스의 모든 Pod) OR (같은 네임스페이스의 role=monitoring Pod)` 허용

**AND 조건 (같은 from 항목 내에 두 selector):**

```yaml
ingress:
  - from:
      - namespaceSelector:          # 조건: frontend 네임스페이스의
          matchLabels:
            purpose: frontend
        podSelector:                # AND role=web인 Pod만
          matchLabels:
            role: web
    ports:
      - port: 80
```

의미: `frontend 네임스페이스의 role=web Pod만` 허용

**검증 방법:**

```bash
kubectl describe networkpolicy <name> -n <ns> | grep -A15 "Allowing ingress"
```

OR 조건의 경우:
```text
  Allowing ingress traffic:
    To Port: 80/TCP
    From:
      NamespaceSelector: purpose=frontend
    From:
      PodSelector: role=monitoring
```

AND 조건의 경우:
```text
  Allowing ingress traffic:
    To Port: 80/TCP
    From:
      NamespaceSelector: purpose=frontend
      PodSelector: role=web
```

`From:` 블록이 분리되면 OR, 같은 `From:` 블록이면 AND이다.

**트러블슈팅:**

| 증상 | 원인 | 해결 |
|------|------|------|
| 예상보다 많은 트래픽이 허용됨 | AND 의도인데 OR로 작성 | selector를 같은 `-` 항목에 배치 |
| 예상 트래픽이 차단됨 | OR 의도인데 AND로 작성 | selector를 별도 `-` 항목으로 분리 |

</details>

---

## Part 4: 기출 유형 덤프 문제 (20문항)

> 실제 CKAD 시험과 유사한 환경을 가정한다. 각 문제는 특정 context를 사용하며, 풀이는 step-by-step으로 제공한다. 모든 풀이에 검증 명령어와 기대 출력이 포함되어 있다.
> 각 문제에 등장 배경, 내부 동작 원리, 트러블슈팅 시나리오를 추가하였다.

---

### Q1. Multi-Container Pod + Shared Volume

**Context:** `kubectl config use-context k8s-ckad-q1`

**문제 설명:**

`ckad-multi` 네임스페이스에 Pod `shared-pod`를 생성하라.

**조건:**
- 컨테이너 `writer`: `busybox:1.36` 이미지, 매 3초마다 현재 시각을 `/data/output.log`에 기록한다
- 컨테이너 `reader`: `busybox:1.36` 이미지, `/data/output.log`를 `tail -F`로 출력한다
- 두 컨테이너는 `data-vol`이라는 `emptyDir` 볼륨을 `/data`에 마운트하여 공유한다

**등장 배경:**

Multi-container Pod 패턴은 관심사 분리(Separation of Concerns)를 컨테이너 수준에서 구현한다. 메인 컨테이너는 비즈니스 로직에만 집중하고, 부가 기능(로깅, 프록시, 메트릭 수집)은 별도 컨테이너가 담당한다. emptyDir Volume은 Pod 내 컨테이너 간 데이터를 공유하는 가장 간단한 방법이다. Pod가 삭제되면 emptyDir의 데이터도 함께 사라진다.

<details><summary>풀이 확인</summary>

```bash
kubectl config use-context k8s-ckad-q1
kubectl create namespace ckad-multi
```

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: shared-pod
  namespace: ckad-multi
spec:
  containers:
    - name: writer
      image: busybox:1.36
      command: ["sh", "-c", "while true; do date >> /data/output.log; sleep 3; done"]
      volumeMounts:
        - name: data-vol
          mountPath: /data
    - name: reader
      image: busybox:1.36
      command: ["sh", "-c", "tail -F /data/output.log"]
      volumeMounts:
        - name: data-vol
          mountPath: /data
  volumes:
    - name: data-vol
      emptyDir: {}
```

```bash
kubectl apply -f shared-pod.yaml
```

**검증**

```bash
# 두 컨테이너가 모두 Running인지 확인
kubectl get pod shared-pod -n ckad-multi
```

```text
NAME         READY   STATUS    RESTARTS   AGE
shared-pod   2/2     Running   0          15s
```

```bash
# reader 컨테이너에서 로그가 스트리밍되는지 확인
kubectl logs shared-pod -c reader -n ckad-multi --tail=3
```

```text
Mon Jan 1 00:00:00 UTC 2024
Mon Jan 1 00:00:03 UTC 2024
Mon Jan 1 00:00:06 UTC 2024
```

```bash
# writer가 파일에 기록하고 있는지 확인
kubectl exec shared-pod -c writer -n ckad-multi -- wc -l /data/output.log
```

```text
5 /data/output.log
```

**트러블슈팅:**

- reader가 로그를 출력하지 않으면: writer가 파일을 아직 생성하지 않은 경우이다. `tail -F`(대문자 F)는 파일이 생성될 때까지 대기하므로 잠시 기다리면 된다.
- Pod가 1/2 Ready인 경우: 한 컨테이너의 command에 오류가 있는지 `kubectl describe pod shared-pod -n ckad-multi`로 확인한다.

</details>

---

### Q2. Init Container + ConfigMap 생성

**Context:** `kubectl config use-context k8s-ckad-q2`

**문제 설명:**

`ckad-init` 네임스페이스에 Pod `init-pod`를 생성하라.

**조건:**
- Init Container `setup`: `busybox:1.36` 이미지, ConfigMap `app-settings`의 `config.yaml` 키를 `/config/config.yaml`에 마운트하고, 파일 존재를 확인한 후 종료
- 메인 컨테이너 `app`: `nginx:1.25` 이미지, 동일한 ConfigMap을 `/etc/app/config.yaml`에 마운트

**등장 배경:**

Init Container는 메인 컨테이너 실행 전에 선행 조건을 검증하는 용도로 사용된다. 설정 파일이 올바르게 마운트되었는지, 외부 서비스가 준비되었는지를 확인하여, 메인 컨테이너가 실패하는 것을 방지한다.

<details><summary>풀이 확인</summary>

```bash
kubectl config use-context k8s-ckad-q2
kubectl create namespace ckad-init

kubectl create configmap app-settings -n ckad-init \
  --from-literal=config.yaml="server:\n  port: 8080\n  log_level: info"
```

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: init-pod
  namespace: ckad-init
spec:
  initContainers:
    - name: setup
      image: busybox:1.36
      command: ["sh", "-c", "test -f /config/config.yaml && echo 'Config verified' || exit 1"]
      volumeMounts:
        - name: config-vol
          mountPath: /config
  containers:
    - name: app
      image: nginx:1.25
      volumeMounts:
        - name: config-vol
          mountPath: /etc/app
  volumes:
    - name: config-vol
      configMap:
        name: app-settings
```

**검증**

```bash
kubectl get pod init-pod -n ckad-init
```

```text
NAME       READY   STATUS    RESTARTS   AGE
init-pod   1/1     Running   0          15s
```

```bash
kubectl logs init-pod -c setup -n ckad-init
```

```text
Config verified
```

```bash
kubectl exec init-pod -n ckad-init -- cat /etc/app/config.yaml
```

```text
server:
  port: 8080
  log_level: info
```

**트러블슈팅:**

ConfigMap이 존재하지 않으면 Pod는 `Init:CreateContainerConfigError` 상태가 된다. `kubectl get configmap -n ckad-init`으로 확인한다.

</details>

---

### Q3. CronJob 생성

**Context:** `kubectl config use-context k8s-ckad-q3`

**문제 설명:**

`ckad-batch` 네임스페이스에 CronJob `cleanup-job`을 생성하라.

**조건:**
- 매 시간 30분에 실행 (`30 * * * *`)
- `busybox:1.36` 이미지, `echo "Cleanup at $(date)" && rm -rf /tmp/cache/*` 명령 실행
- `concurrencyPolicy: Replace`, `successfulJobsHistoryLimit: 2`

**등장 배경:**

CronJob은 쿠버네티스 내에서 반복 작업을 스케줄링한다. `concurrencyPolicy: Replace`는 이전 Job이 아직 실행 중이면 삭제하고 새 Job을 시작하므로, 실행 시간이 예측 불가능한 정리 작업에 적합하다.

<details><summary>풀이 확인</summary>

```bash
kubectl config use-context k8s-ckad-q3
kubectl create namespace ckad-batch
```

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: cleanup-job
  namespace: ckad-batch
spec:
  schedule: "30 * * * *"
  concurrencyPolicy: Replace
  successfulJobsHistoryLimit: 2
  failedJobsHistoryLimit: 1
  jobTemplate:
    spec:
      template:
        spec:
          restartPolicy: OnFailure
          containers:
            - name: cleanup
              image: busybox:1.36
              command: ["sh", "-c", "echo 'Cleanup at $(date)' && rm -rf /tmp/cache/*"]
```

**검증**

```bash
kubectl get cronjob cleanup-job -n ckad-batch
```

```text
NAME          SCHEDULE       SUSPEND   ACTIVE   LAST SCHEDULE   AGE
cleanup-job   30 * * * *     False     0        <none>          10s
```

```bash
# 수동 트리거 테스트
kubectl create job --from=cronjob/cleanup-job test-run -n ckad-batch
kubectl logs job/test-run -n ckad-batch
```

```text
Cleanup at Mon Jan 1 00:00:00 UTC 2024
```

</details>

---

### Q4. Rolling Update + Rollback

**Context:** `kubectl config use-context k8s-ckad-q4`

**문제 설명:**

`ckad-deploy` 네임스페이스에 Deployment `api-server`를 생성하고, 이미지를 업데이트한 후 롤백하라.

**조건:**
- 초기 이미지: `nginx:1.24`, replicas: 3
- `maxSurge: 1, maxUnavailable: 0`
- `nginx:1.25`로 업데이트 후, 다시 `nginx:1.24`로 롤백

<details><summary>풀이 확인</summary>

```bash
kubectl config use-context k8s-ckad-q4
kubectl create namespace ckad-deploy

kubectl create deployment api-server --image=nginx:1.24 --replicas=3 -n ckad-deploy
kubectl patch deployment api-server -n ckad-deploy -p '{"spec":{"strategy":{"type":"RollingUpdate","rollingUpdate":{"maxSurge":1,"maxUnavailable":0}}}}'

# 업데이트
kubectl set image deployment/api-server nginx=nginx:1.25 -n ckad-deploy
kubectl rollout status deployment api-server -n ckad-deploy
```

```text
deployment "api-server" successfully rolled out
```

```bash
# 현재 이미지 확인
kubectl get deployment api-server -n ckad-deploy -o jsonpath='{.spec.template.spec.containers[0].image}'
echo ""
```

```text
nginx:1.25
```

```bash
# 롤백
kubectl rollout undo deployment api-server -n ckad-deploy
kubectl rollout status deployment api-server -n ckad-deploy

kubectl get deployment api-server -n ckad-deploy -o jsonpath='{.spec.template.spec.containers[0].image}'
echo ""
```

```text
nginx:1.24
```

</details>

---

### Q5. Secret + Pod 환경변수 주입

**Context:** `kubectl config use-context k8s-ckad-q5`

**문제 설명:**

`ckad-secret` 네임스페이스에 Secret `db-creds`를 생성하고, Pod `db-client`에 환경변수로 주입하라.

**조건:**
- Secret: `username=admin`, `password=P@ssw0rd!`
- Pod: `busybox:1.36` 이미지, 환경변수 `DB_USER`에 username, `DB_PASS`에 password를 매핑

<details><summary>풀이 확인</summary>

```bash
kubectl config use-context k8s-ckad-q5
kubectl create namespace ckad-secret
kubectl create secret generic db-creds -n ckad-secret \
  --from-literal=username=admin --from-literal=password='P@ssw0rd!'
```

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: db-client
  namespace: ckad-secret
spec:
  containers:
    - name: client
      image: busybox:1.36
      command: ["sh", "-c", "echo DB_USER=$DB_USER DB_PASS=$DB_PASS && sleep 3600"]
      env:
        - name: DB_USER
          valueFrom:
            secretKeyRef:
              name: db-creds
              key: username
        - name: DB_PASS
          valueFrom:
            secretKeyRef:
              name: db-creds
              key: password
```

**검증**

```bash
kubectl logs db-client -n ckad-secret
```

```text
DB_USER=admin DB_PASS=P@ssw0rd!
```

```bash
kubectl exec db-client -n ckad-secret -- env | grep DB_
```

```text
DB_USER=admin
DB_PASS=P@ssw0rd!
```

</details>

---

### Q6. SecurityContext — 비root 실행 + readOnlyRootFilesystem

**Context:** `kubectl config use-context k8s-ckad-q6`

**문제 설명:**

`ckad-sec` 네임스페이스에 Pod `secure-app`을 생성하라.

**조건:**
- UID 1001로 실행, readOnlyRootFilesystem=true
- 모든 capabilities 제거, allowPrivilegeEscalation=false
- `/tmp`에 emptyDir 마운트 (쓰기 가능 디렉터리 확보)

<details><summary>풀이 확인</summary>

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: secure-app
  namespace: ckad-sec
spec:
  securityContext:
    runAsUser: 1001
    runAsNonRoot: true
  containers:
    - name: app
      image: busybox:1.36
      command: ["sh", "-c", "id && touch /tmp/ok && echo OK && sleep 3600"]
      securityContext:
        readOnlyRootFilesystem: true
        allowPrivilegeEscalation: false
        capabilities:
          drop: ["ALL"]
      volumeMounts:
        - name: tmp
          mountPath: /tmp
  volumes:
    - name: tmp
      emptyDir: {}
```

**검증**

```bash
kubectl logs secure-app -n ckad-sec
```

```text
uid=1001 gid=0(root)
OK
```

```bash
kubectl exec secure-app -n ckad-sec -- touch /etc/test 2>&1
```

```text
touch: /etc/test: Read-only file system
```

</details>

---

### Q7. NetworkPolicy — Default Deny + 허용 규칙

**Context:** `kubectl config use-context k8s-ckad-q7`

**문제 설명:**

`ckad-netpol` 네임스페이스에 Default Deny Ingress 정책을 적용한 후, `app: frontend` Pod에서 `app: backend` Pod로의 TCP 8080 트래픽만 허용하라.

<details><summary>풀이 확인</summary>

```yaml
# Default Deny
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny
  namespace: ckad-netpol
spec:
  podSelector: {}
  policyTypes:
    - Ingress
---
# frontend -> backend 허용
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-frontend
  namespace: ckad-netpol
spec:
  podSelector:
    matchLabels:
      app: backend
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: frontend
      ports:
        - protocol: TCP
          port: 8080
```

**검증**

```bash
kubectl get networkpolicy -n ckad-netpol
```

```text
NAME              POD-SELECTOR   AGE
default-deny      <none>         10s
allow-frontend    app=backend    10s
```

```bash
# frontend -> backend (허용)
kubectl exec frontend-pod -n ckad-netpol -- wget -qO- --timeout=3 http://backend-svc:8080 | head -1
```

```text
<!DOCTYPE html>
```

```bash
# other -> backend (차단)
kubectl exec other-pod -n ckad-netpol -- wget -qO- --timeout=3 http://backend-svc:8080 2>&1
```

```text
wget: download timed out
```

</details>

---

### Q8. PVC 동적 프로비저닝 + Pod 마운트

**Context:** `kubectl config use-context k8s-ckad-q8`

**문제 설명:**

`ckad-storage` 네임스페이스에 5Gi PVC `data-pvc`를 생성하고, Pod `data-pod`에 `/data`로 마운트하라.

<details><summary>풀이 확인</summary>

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: data-pvc
  namespace: ckad-storage
spec:
  accessModes:
    - ReadWriteOnce
  storageClassName: standard
  resources:
    requests:
      storage: 5Gi
---
apiVersion: v1
kind: Pod
metadata:
  name: data-pod
  namespace: ckad-storage
spec:
  containers:
    - name: app
      image: busybox:1.36
      command: ["sh", "-c", "echo data > /data/test.txt && cat /data/test.txt && sleep 3600"]
      volumeMounts:
        - name: data
          mountPath: /data
  volumes:
    - name: data
      persistentVolumeClaim:
        claimName: data-pvc
```

**검증**

```bash
kubectl get pvc data-pvc -n ckad-storage
```

```text
NAME       STATUS   VOLUME     CAPACITY   ACCESS MODES   STORAGECLASS   AGE
data-pvc   Bound    pv-xxx     5Gi        RWO            standard       10s
```

```bash
kubectl logs data-pod -n ckad-storage
```

```text
data
```

</details>

---

### Q9. ServiceAccount + RBAC

**Context:** `kubectl config use-context k8s-ckad-q9`

**문제 설명:**

`ckad-rbac` 네임스페이스에 ServiceAccount `monitor-sa`를 생성하고, Pod와 Service를 조회할 수 있는 Role과 RoleBinding을 설정하라.

<details><summary>풀이 확인</summary>

```bash
kubectl config use-context k8s-ckad-q9
kubectl create namespace ckad-rbac
kubectl create serviceaccount monitor-sa -n ckad-rbac
kubectl create role monitor-role --verb=get,list,watch --resource=pods,services -n ckad-rbac
kubectl create rolebinding monitor-binding --role=monitor-role --serviceaccount=ckad-rbac:monitor-sa -n ckad-rbac
```

**검증**

```bash
kubectl auth can-i list pods -n ckad-rbac --as=system:serviceaccount:ckad-rbac:monitor-sa
```

```text
yes
```

```bash
kubectl auth can-i delete pods -n ckad-rbac --as=system:serviceaccount:ckad-rbac:monitor-sa
```

```text
no
```

```bash
kubectl auth can-i list services -n ckad-rbac --as=system:serviceaccount:ckad-rbac:monitor-sa
```

```text
yes
```

</details>

---

### Q10. Probes 조합 — Startup + Liveness + Readiness

**Context:** `kubectl config use-context k8s-ckad-q10`

**문제 설명:**

`ckad-probe` 네임스페이스에 Deployment `slow-app`을 생성하라. 초기화에 30초가 걸리는 애플리케이션을 시뮬레이션한다.

**조건:**
- Startup Probe: exec `cat /tmp/started`, periodSeconds=5, failureThreshold=12
- Liveness Probe: httpGet `/`, port 80, periodSeconds=10
- Readiness Probe: httpGet `/`, port 80, periodSeconds=5

<details><summary>풀이 확인</summary>

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: slow-app
  namespace: ckad-probe
spec:
  replicas: 2
  selector:
    matchLabels:
      app: slow-app
  template:
    metadata:
      labels:
        app: slow-app
    spec:
      containers:
        - name: app
          image: nginx:1.25
          ports:
            - containerPort: 80
          startupProbe:
            exec:
              command: ["cat", "/tmp/started"]
            periodSeconds: 5
            failureThreshold: 12
          livenessProbe:
            httpGet:
              path: /
              port: 80
            periodSeconds: 10
            failureThreshold: 3
          readinessProbe:
            httpGet:
              path: /
              port: 80
            periodSeconds: 5
            failureThreshold: 3
          lifecycle:
            postStart:
              exec:
                command: ["sh", "-c", "sleep 30 && touch /tmp/started"]
```

**검증**

```bash
# 초기 30초간: startup probe 실패 중
kubectl get pods -n ckad-probe -l app=slow-app
```

```text
NAME                       READY   STATUS    RESTARTS   AGE
slow-app-xxx-aaa           0/1     Running   0          10s
slow-app-xxx-bbb           0/1     Running   0          10s
```

```bash
# 30초 후: startup probe 성공, Ready
kubectl get pods -n ckad-probe -l app=slow-app
```

```text
NAME                       READY   STATUS    RESTARTS   AGE
slow-app-xxx-aaa           1/1     Running   0          35s
slow-app-xxx-bbb           1/1     Running   0          35s
```

</details>

---

### Q11. Job — 병렬 실행

**Context:** `kubectl config use-context k8s-ckad-q11`

**문제 설명:**

`ckad-job` 네임스페이스에 Job `parallel-job`을 생성하라. completions=6, parallelism=3으로 설정하라.

<details><summary>풀이 확인</summary>

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: parallel-job
  namespace: ckad-job
spec:
  completions: 6
  parallelism: 3
  backoffLimit: 4
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: worker
          image: busybox:1.36
          command: ["sh", "-c", "echo Worker $(hostname) completed && sleep 2"]
```

**검증**

```bash
kubectl get job parallel-job -n ckad-job -w
```

```text
NAME           COMPLETIONS   DURATION   AGE
parallel-job   0/6           2s         2s
parallel-job   3/6           5s         5s
parallel-job   6/6           8s         8s
```

동시에 3개 Pod가 실행되어 2라운드(3+3)에 6개 완료된다.

```bash
kubectl get pods -n ckad-job -l job-name=parallel-job
```

```text
NAME                  READY   STATUS      RESTARTS   AGE
parallel-job-abc12    0/1     Completed   0          8s
parallel-job-def34    0/1     Completed   0          8s
parallel-job-ghi56    0/1     Completed   0          8s
parallel-job-jkl78    0/1     Completed   0          5s
parallel-job-mno90    0/1     Completed   0          5s
parallel-job-pqr12    0/1     Completed   0          5s
```

</details>

---

### Q12. ConfigMap을 Volume으로 마운트 + 자동 갱신

**Context:** `kubectl config use-context k8s-ckad-q12`

**문제 설명:**

ConfigMap `nginx-conf`에 nginx 설정을 저장하고, Pod에 volume으로 마운트하라. ConfigMap을 변경한 후 파일이 자동 갱신되는 것을 확인하라.

<details><summary>풀이 확인</summary>

```bash
kubectl create configmap nginx-conf -n ckad-cm \
  --from-literal=default.conf="server { listen 80; root /usr/share/nginx/html; }"
```

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: nginx-cm
  namespace: ckad-cm
spec:
  containers:
    - name: nginx
      image: nginx:1.25
      volumeMounts:
        - name: conf
          mountPath: /etc/nginx/conf.d
  volumes:
    - name: conf
      configMap:
        name: nginx-conf
```

**검증**

```bash
kubectl exec nginx-cm -n ckad-cm -- cat /etc/nginx/conf.d/default.conf
```

```text
server { listen 80; root /usr/share/nginx/html; }
```

```bash
# ConfigMap 변경
kubectl patch configmap nginx-conf -n ckad-cm -p '{"data":{"default.conf":"server { listen 8080; root /var/www; }"}}'

# 약 60초 후 확인
kubectl exec nginx-cm -n ckad-cm -- cat /etc/nginx/conf.d/default.conf
```

```text
server { listen 8080; root /var/www; }
```

</details>

---

### Q13. LimitRange + ResourceQuota

**Context:** `kubectl config use-context k8s-ckad-q13`

**문제 설명:**

`ckad-quota` 네임스페이스에 LimitRange(기본 cpu=100m, memory=128Mi)와 ResourceQuota(총 cpu requests=1, pods=5)를 설정하라.

<details><summary>풀이 확인</summary>

```bash
kubectl create namespace ckad-quota

cat <<'EOF' | kubectl apply -n ckad-quota -f -
apiVersion: v1
kind: LimitRange
metadata:
  name: defaults
spec:
  limits:
    - type: Container
      default:
        cpu: 200m
        memory: 256Mi
      defaultRequest:
        cpu: 100m
        memory: 128Mi
---
apiVersion: v1
kind: ResourceQuota
metadata:
  name: quota
spec:
  hard:
    requests.cpu: "1"
    pods: "5"
EOF
```

**검증**

```bash
kubectl describe limitrange defaults -n ckad-quota
```

```text
Type        Resource  Min  Max  Default Request  Default Limit
----        --------  ---  ---  ---------------  -------------
Container   cpu       -    -    100m             200m
Container   memory    -    -    128Mi            256Mi
```

```bash
# 6번째 Pod 생성 시도 (거부)
for i in $(seq 1 6); do kubectl run test-$i --image=busybox:1.36 -n ckad-quota --restart=Never -- sleep 3600 2>&1 | tail -1; done
```

```text
pod/test-1 created
pod/test-2 created
pod/test-3 created
pod/test-4 created
pod/test-5 created
Error from server (Forbidden): pods "test-6" is forbidden: exceeded quota: quota
```

</details>

---

### Q14. Ingress — 경로 기반 라우팅

**Context:** `kubectl config use-context k8s-ckad-q14`

**문제 설명:**

`ckad-ingress` 네임스페이스에 Ingress를 생성하여 `/app`은 `app-svc:80`으로, `/api`는 `api-svc:8080`으로 라우팅하라.

<details><summary>풀이 확인</summary>

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: web-ingress
  namespace: ckad-ingress
  annotations:
    nginx.ingress.kubernetes.io/rewrite-target: /
spec:
  ingressClassName: nginx
  rules:
    - host: ckad.example.com
      http:
        paths:
          - path: /app
            pathType: Prefix
            backend:
              service:
                name: app-svc
                port:
                  number: 80
          - path: /api
            pathType: Prefix
            backend:
              service:
                name: api-svc
                port:
                  number: 8080
```

**검증**

```bash
kubectl get ingress web-ingress -n ckad-ingress
```

```text
NAME          CLASS   HOSTS              ADDRESS        PORTS   AGE
web-ingress   nginx   ckad.example.com   192.168.64.2   80      10s
```

```bash
kubectl describe ingress web-ingress -n ckad-ingress | grep -A5 "Rules:"
```

```text
Rules:
  Host              Path  Backends
  ----              ----  --------
  ckad.example.com
                    /app   app-svc:80 (...)
                    /api   api-svc:8080 (...)
```

</details>

---

### Q15. StatefulSet + Headless Service

**Context:** `kubectl config use-context k8s-ckad-q15`

**문제 설명:**

`ckad-sts` 네임스페이스에 StatefulSet `redis`(3 replicas)과 Headless Service `redis-headless`를 생성하라. 각 Pod에 1Gi PVC를 할당하라.

<details><summary>풀이 확인</summary>

```yaml
apiVersion: v1
kind: Service
metadata:
  name: redis-headless
  namespace: ckad-sts
spec:
  clusterIP: None
  selector:
    app: redis
  ports:
    - port: 6379
---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: redis
  namespace: ckad-sts
spec:
  serviceName: redis-headless
  replicas: 3
  selector:
    matchLabels:
      app: redis
  template:
    metadata:
      labels:
        app: redis
    spec:
      containers:
        - name: redis
          image: redis:7-alpine
          ports:
            - containerPort: 6379
          volumeMounts:
            - name: data
              mountPath: /data
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes: ["ReadWriteOnce"]
        storageClassName: standard
        resources:
          requests:
            storage: 1Gi
```

**검증**

```bash
kubectl get sts redis -n ckad-sts
```

```text
NAME    READY   AGE
redis   3/3     60s
```

```bash
kubectl get pvc -n ckad-sts
```

```text
NAME             STATUS   VOLUME    CAPACITY   ACCESS MODES   STORAGECLASS   AGE
data-redis-0     Bound    pv-aaa    1Gi        RWO            standard       60s
data-redis-1     Bound    pv-bbb    1Gi        RWO            standard       45s
data-redis-2     Bound    pv-ccc    1Gi        RWO            standard       30s
```

```bash
kubectl run dns-test --image=busybox:1.36 --rm -it --restart=Never -n ckad-sts -- nslookup redis-0.redis-headless.ckad-sts.svc.cluster.local
```

```text
Name:      redis-0.redis-headless.ckad-sts.svc.cluster.local
Address:   10.244.1.10
```

</details>

---

### Q16. 트러블슈팅 — Pod가 시작되지 않는 원인 진단

**Context:** `kubectl config use-context k8s-ckad-q16`

**문제 설명:**

`ckad-debug` 네임스페이스의 Deployment `broken-app`이 정상 동작하지 않는다. 원인을 찾아 수정하라.

<details><summary>풀이 확인</summary>

**진단 절차:**

```bash
kubectl get pods -n ckad-debug -l app=broken-app
```

```text
NAME                          READY   STATUS                       RESTARTS   AGE
broken-app-xxx-aaa            0/1     CreateContainerConfigError   0          30s
```

```bash
kubectl describe pod -n ckad-debug -l app=broken-app | grep -A3 "Warning"
```

```text
Warning  Failed     5s    kubelet  Error: configmap "missing-config" not found
```

원인: 존재하지 않는 ConfigMap `missing-config`를 참조하고 있다.

```bash
# 해결: ConfigMap 생성
kubectl create configmap missing-config -n ckad-debug --from-literal=APP_MODE=production

# Pod 재시작 (Deployment이므로 자동 재시작)
kubectl delete pod -n ckad-debug -l app=broken-app
```

**검증**

```bash
kubectl get pods -n ckad-debug -l app=broken-app
```

```text
NAME                          READY   STATUS    RESTARTS   AGE
broken-app-yyy-bbb            1/1     Running   0          10s
```

</details>

---

### Q17. HPA 설정

**Context:** `kubectl config use-context k8s-ckad-q17`

**문제 설명:**

`ckad-hpa` 네임스페이스의 Deployment `web-app`에 HPA를 설정하라. CPU 사용률 70% 기준, minReplicas=2, maxReplicas=8.

<details><summary>풀이 확인</summary>

```bash
kubectl autoscale deployment web-app -n ckad-hpa --cpu-percent=70 --min=2 --max=8
```

**검증**

```bash
kubectl get hpa -n ckad-hpa
```

```text
NAME      REFERENCE            TARGETS   MINPODS   MAXPODS   REPLICAS   AGE
web-app   Deployment/web-app   25%/70%   2         8         2          10s
```

```bash
kubectl describe hpa web-app -n ckad-hpa | grep -A2 "ScalingActive"
```

```text
  ScalingActive   True    ValidMetricFound    the HPA was able to successfully calculate a replica count
```

**트러블슈팅:**

TARGETS가 `<unknown>/70%`이면 metrics-server가 설치되지 않았거나, Deployment의 컨테이너에 resource requests가 설정되지 않은 것이다.

</details>

---

### Q18. PDB 설정

**Context:** `kubectl config use-context k8s-ckad-q18`

**문제 설명:**

`ckad-pdb` 네임스페이스의 Deployment `critical-app`(replicas=5)에 PodDisruptionBudget을 생성하라. `minAvailable: 3`으로 설정하라.

<details><summary>풀이 확인</summary>

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: critical-pdb
  namespace: ckad-pdb
spec:
  minAvailable: 3
  selector:
    matchLabels:
      app: critical-app
```

**검증**

```bash
kubectl get pdb critical-pdb -n ckad-pdb
```

```text
NAME           MIN AVAILABLE   MAX UNAVAILABLE   ALLOWED DISRUPTIONS   AGE
critical-pdb   3               N/A               2                     10s
```

replicas=5이고 minAvailable=3이므로 최대 2개 Pod를 동시에 중단할 수 있다.

</details>

---

### Q19. Pod 로그 수집 — 멀티 컨테이너

**Context:** `kubectl config use-context k8s-ckad-q19`

**문제 설명:**

`ckad-log` 네임스페이스에서 Pod `multi-app`의 `sidecar` 컨테이너에서 최근 10줄의 로그를 확인하라. 이전 컨테이너(재시작 전)의 로그도 확인하라.

<details><summary>풀이 확인</summary>

```bash
# 특정 컨테이너의 최근 10줄
kubectl logs multi-app -c sidecar -n ckad-log --tail=10
```

```text
2024-01-01 00:00:50 Processing event
2024-01-01 00:00:51 Processing event
2024-01-01 00:00:52 Processing event
...
```

```bash
# 이전 컨테이너 로그 (재시작 전)
kubectl logs multi-app -c sidecar -n ckad-log --previous --tail=5
```

```text
2024-01-01 00:00:45 Error: connection refused
2024-01-01 00:00:46 Retrying...
2024-01-01 00:00:47 Error: connection refused
2024-01-01 00:00:48 Max retries exceeded
2024-01-01 00:00:48 Exit with error
```

```bash
# 모든 컨테이너의 로그를 동시에 스트리밍
kubectl logs multi-app -n ckad-log --all-containers --prefix --tail=5
```

```text
[app] 2024-01-01 00:00:52 Handling request
[sidecar] 2024-01-01 00:00:52 Processing event
```

</details>

---

### Q20. 애플리케이션 외부 노출 — Service + Ingress

**Context:** `kubectl config use-context k8s-ckad-q20`

**문제 설명:**

`ckad-expose` 네임스페이스에 Deployment `web-app`을 생성하고, ClusterIP Service로 노출한 후, Ingress를 통해 `web.ckad.com`으로 외부 접근을 설정하라.

<details><summary>풀이 확인</summary>

```bash
kubectl create namespace ckad-expose
kubectl create deployment web-app --image=nginx:1.25 --replicas=3 -n ckad-expose
kubectl expose deployment web-app --port=80 --target-port=80 -n ckad-expose
```

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: web-ingress
  namespace: ckad-expose
spec:
  ingressClassName: nginx
  rules:
    - host: web.ckad.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: web-app
                port:
                  number: 80
```

**검증**

```bash
kubectl get svc web-app -n ckad-expose
```

```text
NAME      TYPE        CLUSTER-IP     EXTERNAL-IP   PORT(S)   AGE
web-app   ClusterIP   10.96.78.90    <none>        80/TCP    10s
```

```bash
kubectl get ingress web-ingress -n ckad-expose
```

```text
NAME          CLASS   HOSTS          ADDRESS        PORTS   AGE
web-ingress   nginx   web.ckad.com   192.168.64.2   80      10s
```

```bash
# 클러스터 내부에서 접근 테스트
kubectl run curl-test --image=busybox:1.36 --rm -it --restart=Never -n ckad-expose -- wget -qO- http://web-app:80 | head -3
```

```text
<!DOCTYPE html>
<html>
<head>
```

**트러블슈팅:**

외부에서 접근이 안 되면: (1) Ingress Controller가 설치되어 있는지, (2) DNS가 `web.ckad.com`을 노드 IP로 해석하는지, (3) 노드의 80/443 포트가 열려 있는지 확인한다.

</details>

---

## 부록: 시험 팁

### kubectl 시간 절약 팁

```bash
# alias 설정 (시험 시작 시)
alias k=kubectl
alias kgp='kubectl get pods'
alias kgs='kubectl get svc'
alias kgd='kubectl get deployments'
alias kn='kubectl config set-context --current --namespace'

# 자동 완성 활성화
source <(kubectl completion bash)
complete -o default -F __start_kubectl k

# dry-run으로 YAML 빠르게 생성
k run nginx --image=nginx:1.25 --dry-run=client -o yaml > pod.yaml
k create deployment web --image=nginx --replicas=3 --dry-run=client -o yaml > deploy.yaml
k create service clusterip web-svc --tcp=80:8080 --dry-run=client -o yaml > svc.yaml
k create job myjob --image=busybox --dry-run=client -o yaml -- sh -c "echo hello" > job.yaml
k create cronjob mycron --image=busybox --schedule="*/5 * * * *" --dry-run=client -o yaml -- sh -c "date" > cron.yaml

# context 빠르게 전환
kubectl config use-context <context-name>

# 특정 필드만 빠르게 확인
k get pod mypod -o jsonpath='{.status.phase}'
k get deploy myapp -o jsonpath='{.spec.template.spec.containers[0].image}'
```

### 자주 실수하는 포인트

1. **네임스페이스 지정 누락**: 문제에서 지정한 네임스페이스에 리소스를 생성해야 한다. `-n` 플래그를 잊으면 default 네임스페이스에 생성되어 감점된다.
2. **context 전환 누락**: 각 문제마다 context가 다를 수 있다. `kubectl config use-context`를 반드시 실행한다. context를 전환하지 않으면 다른 클러스터에 리소스가 생성되어 채점이 되지 않는다.
3. **apiVersion 혼동**: Job/CronJob은 `batch/v1`, Ingress는 `networking.k8s.io/v1`, PDB는 `policy/v1`이다. 틀리면 리소스가 생성되지 않는다.
4. **selector 불일치**: Deployment/StatefulSet/DaemonSet의 `selector.matchLabels`와 `template.metadata.labels`가 반드시 일치해야 한다. 불일치하면 생성 자체가 거부된다.
5. **restartPolicy**: Job에서는 `Never` 또는 `OnFailure`만 허용된다. Pod 기본값은 `Always`이다. Job에 `Always`를 지정하면 유효성 검증에서 거부된다.
6. **RBAC apiGroups**: core API 리소스(pods, services 등)의 apiGroup은 빈 문자열 `""`이다. `apps`, `batch` 등을 혼동하면 권한이 적용되지 않는다.
7. **NetworkPolicy from 배열 문법**: 같은 `-` 항목 내의 podSelector와 namespaceSelector는 AND 조건이다. 별도 `-` 항목이면 OR 조건이다. 이 차이를 혼동하면 의도하지 않은 트래픽이 허용되거나 차단된다.

### 검증 습관

시험에서 리소스를 생성한 후 반드시 검증하는 것이 중요하다. 다음 명령어를 습관화해야 한다:

```bash
# 리소스 생성 후 즉시 확인
kubectl get <resource> -n <namespace>

# 상세 정보 확인 (이벤트, 상태 등)
kubectl describe <resource> <name> -n <namespace>

# 특정 필드만 확인 (빠른 검증)
kubectl get <resource> <name> -o jsonpath='{.spec.xxx}'

# Pod 로그 확인
kubectl logs <pod-name> -n <namespace>

# Pod 내부에서 명령 실행
kubectl exec <pod-name> -- <command>
```

### 트러블슈팅 체계적 접근

```
Pod 문제 진단 순서:
1. kubectl get pod — STATUS 확인 (Pending, CrashLoopBackOff, ImagePullBackOff 등)
2. kubectl describe pod — Events 섹션에서 원인 파악
3. kubectl logs [--previous] — 애플리케이션 에러 확인
4. kubectl exec — 컨테이너 내부 상태 확인 (네트워크, 파일, 프로세스)
5. kubectl get events --sort-by=.metadata.creationTimestamp — 클러스터 수준 이벤트 확인
```

### apiVersion 빠른 참조

| 리소스 | apiVersion |
|--------|-----------|
| Pod, Service, ConfigMap, Secret, PVC, ServiceAccount, LimitRange, ResourceQuota | `v1` |
| Deployment, StatefulSet, DaemonSet, ReplicaSet | `apps/v1` |
| Job, CronJob | `batch/v1` |
| Ingress, NetworkPolicy | `networking.k8s.io/v1` |
| Role, RoleBinding, ClusterRole, ClusterRoleBinding | `rbac.authorization.k8s.io/v1` |
| PDB | `policy/v1` |
| HPA | `autoscaling/v2` |
