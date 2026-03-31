# CKA 보충 학습 자료

> 이 문서는 기존 CKA 학습 자료(01~04)에서 다루지 않은 핵심 토픽을 보강하고, 추가 실전 예제와 확인 문제를 제공한다. 모든 명령어와 YAML은 시험 환경에서 즉시 사용 가능한 형태로 작성한다. 각 개념에는 등장 배경, 기존 한계점, 내부 동작 원리, 장애 시나리오, 검증 방법이 포함되어 있다.

### 이 문서의 구성 원칙

1. **등장 배경**: 각 기술이 왜 필요했는지, 기존 방식의 어떤 한계를 해결하기 위해 도입되었는지 기술한다.
2. **내부 동작 원리**: API 호출부터 커널 수준까지 가능한 범위에서 구체적 동작 메커니즘을 기술한다.
3. **검증 방법**: 모든 실습에 검증 명령어와 기대 출력(`text` 블록)을 포함한다.
4. **트러블슈팅**: 장애 시나리오, 오류 메시지, 해결 방법을 표로 정리한다.
5. **문체**: "~이다/한다/된다" 체를 사용한다. 경어체를 사용하지 않는다.

---

## Part 1: 누락된 개념 보강

---

### 1.1 Pod Security Standards (PSS) / Pod Security Admission (PSA)

#### 배경

기존에는 PodSecurityPolicy(PSP)로 Pod 보안을 제어했다. PSP의 문제점은 다음과 같다:

- PSP는 RBAC과 바인딩이 필요하여 설정이 복잡하다. PSP 리소스를 생성한 후 별도의 ClusterRole과 ClusterRoleBinding을 만들어 사용자 또는 ServiceAccount에 연결해야 한다.
- 여러 PSP가 존재할 때 어떤 PSP가 특정 Pod에 적용되는지 디버깅이 매우 어렵다. PSP 선택 로직이 알파벳 순서, mutating 여부 등 복합적인 기준으로 동작하기 때문이다.
- Dry-run 모드가 없어 정책 변경의 영향을 사전에 확인할 수 없다. 프로덕션 클러스터에서 PSP를 변경하면 기존 워크로드가 갑자기 차단될 위험이 있다.
- PSP는 클러스터 범위(cluster-scoped) 리소스이므로 네임스페이스 단위의 세밀한 제어가 어렵다.

Kubernetes 1.21에서 PSP가 deprecated 되었고, 1.25에서 완전히 제거되었다. Pod Security Admission(PSA)이 대체 기능으로 도입되었다.

#### PSA가 선택된 이유

PSA가 PSP의 대안으로 채택된 이유는 다음과 같다:

- **빌트인 Admission Controller이다.** 별도의 CRD나 웹훅 설치가 필요 없다. kube-apiserver에 기본 탑재되어 있다.
- **네임스페이스 레이블 기반이다.** 네임스페이스별로 독립적인 보안 수준을 적용할 수 있다. RBAC 바인딩이 불필요하다.
- **3가지 프로파일(Privileged, Baseline, Restricted)과 3가지 모드(enforce, audit, warn)로 단순하다.** 조합이 명확하여 디버깅이 용이하다.
- **warn 모드와 audit 모드가 있어 dry-run이 가능하다.** 정책을 enforce하기 전에 warn으로 먼저 적용하여 영향 범위를 파악할 수 있다.

#### 내부 동작 원리

PSA의 동작 원리는 다음과 같다:

1. 사용자가 Pod 또는 Pod를 포함하는 리소스(Deployment, ReplicaSet 등)를 생성 요청한다.
2. kube-apiserver의 Admission 단계에서 PSA Admission Controller가 요청을 가로챈다.
3. PSA는 해당 Pod가 생성될 네임스페이스의 레이블을 확인한다.
4. `pod-security.kubernetes.io/<mode>=<profile>` 레이블에 따라 Pod의 `securityContext` 필드를 프로파일 규칙과 비교한다.
5. enforce 모드에서 위반이 발견되면 요청을 거부(403 Forbidden)한다. audit/warn 모드에서는 로그 기록 또는 경고 메시지만 반환한다.

PSS는 세 가지 보안 수준(Profile)을 정의한다:

| Profile | 설명 |
|---|---|
| **Privileged** | 제한 없음. 시스템 수준의 워크로드에 사용한다. |
| **Baseline** | 알려진 권한 상승(privilege escalation)을 방지한다. 최소한의 제한을 적용한다. `hostNetwork`, `hostPID`, `hostIPC`, `privileged` 컨테이너 등을 금지한다. |
| **Restricted** | 최대한 엄격한 보안 정책이다. Pod hardening 모범 사례를 강제한다. `runAsNonRoot`, `drop ALL capabilities`, `seccompProfile` 등을 요구한다. |

#### PSA 모드

각 Profile은 세 가지 모드로 적용할 수 있다:

| 모드 | 동작 |
|---|---|
| **enforce** | 정책을 위반하는 Pod 생성을 **거부**한다. |
| **audit** | 정책 위반을 감사 로그(audit log)에 **기록**한다. Pod 생성은 허용한다. |
| **warn** | 정책 위반 시 사용자에게 **경고 메시지**를 표시한다. Pod 생성은 허용한다. |

#### 네임스페이스에 PSA 적용하기

```bash
# baseline 프로파일을 enforce 모드로 적용 (버전 v1.30 기준)
kubectl label namespace my-app \
  pod-security.kubernetes.io/enforce=baseline \
  pod-security.kubernetes.io/enforce-version=v1.30
```

```bash
# restricted 프로파일을 enforce + warn 모드로 동시 적용
kubectl label namespace production \
  pod-security.kubernetes.io/enforce=restricted \
  pod-security.kubernetes.io/enforce-version=latest \
  pod-security.kubernetes.io/warn=restricted \
  pod-security.kubernetes.io/warn-version=latest
```

#### 검증

```bash
# 적용 확인: 네임스페이스 레이블 조회
kubectl get namespace my-app --show-labels
# 예상 출력:
# NAME     STATUS   AGE   LABELS
# my-app   Active   5m    pod-security.kubernetes.io/enforce=baseline,pod-security.kubernetes.io/enforce-version=v1.30

# 정책 위반 테스트: privileged 컨테이너 생성 시도 (baseline enforce 네임스페이스에서)
kubectl run priv-test --image=nginx:1.25 -n my-app --overrides='{"spec":{"containers":[{"name":"priv-test","image":"nginx:1.25","securityContext":{"privileged":true}}]}}'
# 예상 출력:
# Error from server (Forbidden): pods "priv-test" is forbidden: violates PodSecurity "baseline:v1.30": privileged (container "priv-test" must not set securityContext.privileged=true)

# 정상 Pod 생성 확인
kubectl run normal-test --image=nginx:1.25 -n my-app
# 예상 출력:
# pod/normal-test created
```

#### 네임스페이스 YAML에서 PSA 설정

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: secure-app
  labels:
    pod-security.kubernetes.io/enforce: restricted
    pod-security.kubernetes.io/enforce-version: latest
    pod-security.kubernetes.io/audit: restricted
    pod-security.kubernetes.io/audit-version: latest
    pod-security.kubernetes.io/warn: restricted
    pod-security.kubernetes.io/warn-version: latest
```

#### 검증

```bash
# 적용
kubectl apply -f secure-app-ns.yaml

# 검증 1: 네임스페이스 생성 확인
kubectl get namespace secure-app --show-labels
# 예상 출력:
# NAME         STATUS   AGE   LABELS
# secure-app   Active   3s    pod-security.kubernetes.io/audit=restricted,...

# 검증 2: restricted 프로파일 위반 Pod 생성 시도
kubectl run test-pod --image=nginx:1.25 -n secure-app
# 예상 출력:
# Error from server (Forbidden): pods "test-pod" is forbidden: violates PodSecurity "restricted:latest":
#   allowPrivilegeEscalation != false (container "test-pod" must set securityContext.allowPrivilegeEscalation=false),
#   unrestricted capabilities (container "test-pod" must set securityContext.capabilities.drop=["ALL"]),
#   runAsNonRoot != true (pod or container "test-pod" must set securityContext.runAsNonRoot=true),
#   seccompProfile (pod or container "test-pod" must set securityContext.seccompProfile.type to "RuntimeDefault" or "Localhost")
```

#### restricted 프로파일을 만족하는 Pod 예시

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: restricted-pod
  namespace: secure-app
spec:
  securityContext:
    runAsNonRoot: true
    seccompProfile:
      type: RuntimeDefault
  containers:
  - name: app
    image: nginx:1.25
    securityContext:
      allowPrivilegeEscalation: false
      capabilities:
        drop:
        - ALL
      runAsUser: 1000
    ports:
    - containerPort: 8080
```

#### 검증

```bash
# 적용
kubectl apply -f restricted-pod.yaml

# 검증 1: Pod 생성 확인
kubectl get pod restricted-pod -n secure-app
# 예상 출력:
# NAME              READY   STATUS    RESTARTS   AGE
# restricted-pod    1/1     Running   0          10s

# 검증 2: securityContext 적용 확인
kubectl exec restricted-pod -n secure-app -- id
# 예상 출력:
# uid=1000 gid=0(root) groups=0(root)

# 검증 3: 권한 상승 불가 확인
kubectl exec restricted-pod -n secure-app -- cat /proc/1/status | grep -i seccomp
# 예상 출력:
# Seccomp:	2    (2 = SECCOMP_MODE_FILTER, RuntimeDefault가 적용된 상태이다)
```

#### 트러블슈팅: PSA 관련 장애 시나리오

| 증상 | 원인 | 해결 방법 |
|---|---|---|
| Deployment 생성은 성공하지만 Pod가 생성되지 않음 | enforce 모드에서 Pod spec이 프로파일을 위반한다 | `kubectl get events -n <ns>`에서 `violates PodSecurity` 메시지 확인 후 Pod spec 수정 |
| 경고 메시지만 표시되고 Pod는 정상 생성됨 | warn 모드만 적용되어 있다 | 의도된 동작이다. enforce 모드로 전환하면 Pod 생성이 차단된다 |
| kube-system의 Pod가 생성되지 않음 | kube-system에 restricted 프로파일이 적용되었다 | kube-system의 PSA 레이블을 제거한다. 시스템 컴포넌트는 privileged 권한이 필요하다 |

#### 주의 사항 및 엣지 케이스

- `enforce-version`을 `latest`로 설정하면 클러스터 버전에 맞는 최신 프로파일이 적용된다. 클러스터 업그레이드 시 프로파일 규칙이 변경될 수 있으므로, 프로덕션에서는 특정 버전(예: `v1.30`)을 명시하는 것이 안전하다.
- PSA는 Pod를 직접 생성하는 요청뿐 아니라 Deployment, ReplicaSet 등 Pod 템플릿을 포함하는 리소스에도 적용된다. 단, warn/audit 모드에서만 상위 리소스 생성 시 경고가 표시된다. enforce는 실제 Pod 생성 시점에 적용된다.
- kube-system 네임스페이스에는 PSA를 적용하지 않는 것이 권장된다. 시스템 컴포넌트가 privileged 권한을 필요로 하기 때문이다.

#### PSA 단계적 적용 전략 (프로덕션)

프로덕션 환경에서 PSA를 안전하게 적용하는 단계:

1. **warn 모드 적용**: 먼저 warn 모드로 적용하여 영향 범위를 파악한다. `kubectl label namespace <ns> pod-security.kubernetes.io/warn=restricted`. Pod 생성 시 경고 메시지가 표시되지만 차단되지 않는다.
2. **audit 모드 추가**: audit 모드를 추가하여 감사 로그에 위반 사항을 기록한다. `pod-security.kubernetes.io/audit=restricted`. kube-apiserver의 audit log에서 위반 내역을 확인한다.
3. **위반 워크로드 수정**: 경고/감사 결과를 바탕으로 위반하는 워크로드의 securityContext를 수정한다. `runAsNonRoot: true`, `allowPrivilegeEscalation: false`, `capabilities.drop: ALL` 등을 추가한다.
4. **enforce 모드 전환**: 모든 워크로드가 프로파일을 준수하면 enforce 모드를 적용한다. `pod-security.kubernetes.io/enforce=restricted`. 이후 위반하는 Pod 생성이 차단된다.

이 단계적 접근법을 통해 기존 워크로드의 중단 없이 보안 정책을 강화할 수 있다.

---

### 1.2 Init Containers

#### 배경

Kubernetes 초기에는 앱 컨테이너 하나만 Pod에 포함할 수 있었고, 사전 작업이 필요한 경우 컨테이너의 엔트리포인트 스크립트에 모든 로직을 포함해야 했다. 이 방식의 문제점은 다음과 같다:

- 사전 작업 로직과 애플리케이션 로직이 하나의 컨테이너 이미지에 혼재되어 관심사 분리(separation of concerns)가 불가능하다.
- 사전 작업에 필요한 도구(curl, mysql-client 등)를 앱 이미지에 포함해야 하므로 이미지 크기가 증가하고 보안 취약점이 늘어난다.
- 사전 작업의 성공/실패를 명확하게 구분할 수 없다. 엔트리포인트 스크립트에서 오류가 발생해도 컨테이너가 계속 실행될 수 있다.

Init Container는 이 문제를 해결하기 위해 도입되었다. Init Container는 앱 컨테이너와 독립적인 이미지를 사용할 수 있고, 완료될 때까지 다음 단계로 진행하지 않는다.

#### 내부 동작 원리

Init Container의 실행 메커니즘은 다음과 같다:

1. kubelet이 Pod 생성 요청을 받으면 `initContainers` 배열을 순서대로 실행한다.
2. 각 Init Container는 반드시 **종료 코드 0(성공)**으로 완료되어야 한다. 0이 아닌 종료 코드가 반환되면 kubelet은 Pod의 `restartPolicy`에 따라 해당 Init Container를 재시작한다.
3. 이전 Init Container가 성공하기 전까지 다음 Init Container는 시작되지 않는다.
4. 모든 Init Container가 성공적으로 완료된 후에야 앱 컨테이너(containers 배열)가 시작된다.
5. Init Container가 실행되는 동안 Pod의 STATUS는 `Init:N/M` 형태로 표시된다 (N: 완료된 Init Container 수, M: 전체 Init Container 수).

#### 핵심 특성

1. Init Container는 **순서대로** 하나씩 실행된다.
2. 하나의 Init Container가 실패하면 kubelet은 성공할 때까지 **재시도**한다 (`restartPolicy`에 따라).
3. Init Container는 앱 컨테이너와 **동일한 Volume**을 공유할 수 있다.
4. Init Container에도 리소스 요청/제한을 설정할 수 있다. 스케줄러는 Init Container와 앱 컨테이너의 리소스 요청 중 **더 큰 값**을 기준으로 스케줄링한다.

#### Init Container YAML 예시

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: myapp-pod
spec:
  initContainers:
  - name: init-db-check
    image: busybox:1.36
    command:
    - sh
    - -c
    - |
      until nslookup mydb-service.default.svc.cluster.local; do
        echo "DB 서비스 대기 중..."
        sleep 2
      done
      echo "DB 서비스 준비 완료"
  - name: init-config
    image: busybox:1.36
    command:
    - sh
    - -c
    - |
      echo '{"db_host":"mydb-service","db_port":"5432"}' > /config/app.json
    volumeMounts:
    - name: config-volume
      mountPath: /config
  containers:
  - name: myapp
    image: myapp:1.0
    ports:
    - containerPort: 8080
    volumeMounts:
    - name: config-volume
      mountPath: /config
      readOnly: true
  volumes:
  - name: config-volume
    emptyDir: {}
```

#### 검증

```bash
# 적용
kubectl apply -f myapp-pod.yaml

# 검증 1: Init Container 진행 상태 확인
kubectl get pod myapp-pod
# 예상 출력 (Init Container 진행 중):
# NAME        READY   STATUS     RESTARTS   AGE
# myapp-pod   0/1     Init:0/2   0          3s

# 예상 출력 (첫 번째 Init Container 완료):
# NAME        READY   STATUS     RESTARTS   AGE
# myapp-pod   0/1     Init:1/2   0          10s

# 예상 출력 (모든 Init Container 완료, 앱 시작):
# NAME        READY   STATUS    RESTARTS   AGE
# myapp-pod   1/1     Running   0          20s

# 검증 2: Init Container 로그 확인
kubectl logs myapp-pod -c init-db-check
# 예상 출력:
# Server:    10.96.0.10
# Address 1: 10.96.0.10 kube-dns.kube-system.svc.cluster.local
# Name:      mydb-service.default.svc.cluster.local
# Address 1: 10.96.x.x mydb-service.default.svc.cluster.local
# DB 서비스 준비 완료

kubectl logs myapp-pod -c init-config
# (출력 없음 — echo는 파일로 리다이렉트 되었으므로 stdout 출력 없음)

# 검증 3: Volume 공유 확인 (앱 컨테이너에서 Init Container가 생성한 파일 읽기)
kubectl exec myapp-pod -- cat /config/app.json
# 예상 출력:
# {"db_host":"mydb-service","db_port":"5432"}

# 검증 4: Pod 상세 정보에서 Init Container 이벤트 확인
kubectl describe pod myapp-pod
# Init Containers 섹션에서 각 컨테이너의 State: Terminated, Reason: Completed 확인
```

#### 트러블슈팅: Init Container 장애

| 증상 | 원인 | 해결 방법 |
|---|---|---|
| Pod 상태가 `Init:0/2`에서 진행되지 않음 | 첫 번째 Init Container가 완료되지 않는다 | `kubectl logs <pod> -c <init-container-name>`으로 로그 확인 |
| Pod 상태가 `Init:CrashLoopBackOff` | Init Container가 비정상 종료를 반복한다 | `kubectl logs <pod> -c <init-container-name> --previous`로 이전 크래시 로그 확인 |
| Init Container가 성공했지만 앱 컨테이너가 시작되지 않음 | Init Container가 생성해야 할 파일이 없거나 Volume 마운트 문제 | Volume 공유 설정과 마운트 경로 확인 |

#### Init Container 활용 패턴

| 패턴 | 설명 | 예시 |
|---|---|---|
| **의존성 대기** | 필요한 서비스가 준비될 때까지 대기 | DB 서비스의 DNS 해석이 성공할 때까지 `nslookup` 반복 |
| **설정 파일 생성** | 동적으로 설정 파일을 생성하여 앱 컨테이너에 전달 | JSON 설정 파일 생성 후 emptyDir Volume에 저장 |
| **데이터 초기화** | 첫 실행 시 필요한 데이터를 다운로드/복사 | 원격 저장소에서 초기 데이터 다운로드 |
| **권한 설정** | 볼륨의 파일 권한을 앱 컨테이너의 사용자에 맞게 조정 | `chown`/`chmod` 명령으로 파일 소유권 변경 |

#### Sidecar Container와의 차이 (Kubernetes 1.28+)

Kubernetes 1.28에서 sidecar 패턴이 공식 지원되었다. `restartPolicy: Always`를 가진 Init Container는 앱 컨테이너와 **동시에** 실행된다. 기존 Init Container는 "완료 후 종료"되지만, sidecar Init Container는 Pod 전체 수명 동안 실행된다. 이를 통해 로그 수집, 프록시, 모니터링 에이전트 등의 사이드카 패턴을 Init Container 섹션에서 구현할 수 있다.

```yaml
# Sidecar Init Container 예시 (Kubernetes 1.28+)
initContainers:
- name: log-collector
  image: fluentd:latest
  restartPolicy: Always  # 이 설정이 sidecar를 만든다
  volumeMounts:
  - name: logs
    mountPath: /var/log/app
```

CKA 시험에서는 기본 Init Container(완료 후 종료)가 주로 출제된다. sidecar 패턴은 아직 GA(General Availability)가 아닌 버전에서는 출제되지 않을 수 있다.

#### 주의 사항 및 엣지 케이스

- Init Container가 무한 루프에 빠지면 Pod는 영원히 `Init:N/M` 상태에 머무른다. `kubectl describe pod`의 Events 섹션에서 Init Container의 재시작 횟수를 확인해야 한다.
- Init Container에는 readinessProbe를 설정할 수 없다. Init Container는 "완료"되어야 하는 일회성 작업이므로, livenessProbe만 설정 가능하다 (Kubernetes 1.28+에서 sidecar 패턴의 `restartPolicy: Always`를 가진 Init Container는 예외이다).
- Pod가 재시작되면 모든 Init Container가 다시 실행된다. 이를 방지하려면 Init Container의 작업이 멱등(idempotent)하도록 설계해야 한다.
- Init Container의 리소스 요청은 스케줄링에 영향을 준다. 스케줄러는 Init Container와 앱 컨테이너의 리소스 요청 중 더 큰 값을 기준으로 노드를 선택한다.

---

### 1.3 Pod Priority and Preemption (PriorityClass)

#### 배경

Kubernetes 초기에는 모든 Pod가 동일한 우선순위를 가졌다. 클러스터 리소스가 부족할 때 발생하는 문제는 다음과 같았다:

- 중요한 프로덕션 워크로드와 배치 작업이 동일한 우선순위로 스케줄링되어, 리소스 부족 시 프로덕션 Pod가 Pending 상태에 빠질 수 있다.
- 스케줄러가 "어떤 Pod가 더 중요한지" 판단할 기준이 없다.
- 수동으로 불필요한 Pod를 삭제하여 리소스를 확보해야 했다.

PriorityClass는 이 문제를 해결하기 위해 도입되었다. Pod에 정수값 우선순위를 부여하여 스케줄러가 자동으로 우선순위 기반 스케줄링과 선점(Preemption)을 수행한다.

#### 내부 동작 원리

Priority와 Preemption의 동작 메커니즘은 다음과 같다:

1. Pod 생성 시 `priorityClassName`이 지정되면, kube-apiserver가 해당 PriorityClass의 `value` 값을 Pod의 `spec.priority` 필드에 주입한다.
2. 스케줄러는 Pending 상태의 Pod를 우선순위 순으로 정렬한다.
3. 높은 우선순위의 Pod가 스케줄링될 노드가 없을 때, 스케줄러는 낮은 우선순위의 Pod를 축출(evict)하여 리소스를 확보한다. 이를 Preemption이라 한다.
4. `preemptionPolicy: Never`로 설정된 PriorityClass의 Pod는 다른 Pod를 축출하지 않고, 리소스가 자연스럽게 확보될 때까지 대기한다.

#### PriorityClass 생성

```yaml
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: high-priority
value: 1000000
globalDefault: false
preemptionPolicy: PreemptLowerPriority
description: "프로덕션 워크로드용 높은 우선순위 클래스"
```

```yaml
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: low-priority
value: 100
globalDefault: false
preemptionPolicy: Never
description: "배치 작업용 낮은 우선순위 (선점하지 않음)"
```

| 필드 | 설명 |
|---|---|
| `value` | 정수값이다. 값이 높을수록 우선순위가 높다. 시스템 기본값은 0이다. 사용자 정의 값은 1,000,000,000 이하로 설정해야 한다. |
| `globalDefault` | `true`로 설정하면 `priorityClassName`을 지정하지 않은 모든 Pod에 이 클래스가 적용된다. 클러스터에 하나만 존재해야 한다. |
| `preemptionPolicy` | `PreemptLowerPriority`(기본값): 낮은 우선순위 Pod를 축출한다. `Never`: 선점하지 않고 리소스가 확보될 때까지 대기한다. |

#### Pod에 PriorityClass 적용

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: critical-app
spec:
  priorityClassName: high-priority
  containers:
  - name: app
    image: nginx:1.25
    resources:
      requests:
        cpu: 500m
        memory: 256Mi
```

#### 검증

```bash
# 적용
kubectl apply -f priorityclass-high.yaml
kubectl apply -f priorityclass-low.yaml
kubectl apply -f critical-app.yaml

# 검증 1: PriorityClass 목록 확인
kubectl get priorityclass
# 예상 출력:
# NAME                      VALUE        GLOBAL-DEFAULT   AGE
# high-priority             1000000      false            10s
# low-priority              100          false            10s
# system-cluster-critical   2000000000   false            30d
# system-node-critical      2000001000   false            30d

# 검증 2: Pod에 적용된 priority 값 확인
kubectl get pod critical-app -o jsonpath='{.spec.priority}'
# 예상 출력:
# 1000000

kubectl get pod critical-app -o jsonpath='{.spec.priorityClassName}'
# 예상 출력:
# high-priority

# 검증 3: 시스템 기본 PriorityClass 확인
kubectl get priorityclass system-cluster-critical -o yaml
# system-cluster-critical (2000000000) — kube-apiserver, etcd 등 클러스터 핵심 컴포넌트가 사용한다
# system-node-critical (2000001000) — kube-proxy 등 노드 핵심 컴포넌트가 사용한다
```

#### Preemption 내부 동작 상세

Preemption(선점)은 높은 우선순위의 Pod가 스케줄링 될 노드가 없을 때 발생한다:

1. 스케줄러의 필터링 단계에서 모든 노드가 리소스 부족으로 제거된다.
2. 스케줄러는 각 노드에서 낮은 우선순위 Pod를 제거했을 때 충분한 리소스가 확보되는지 계산한다.
3. 최소한의 Pod 축출로 리소스를 확보할 수 있는 노드를 선택한다.
4. 선택된 노드의 축출 대상 Pod에 `Preempted` 조건이 설정되고, graceful 종료 과정이 시작된다.
5. 축출된 Pod가 종료되면 높은 우선순위 Pod가 해당 노드에 스케줄링된다.

Preemption은 PDB를 존중하려 시도하지만, 높은 우선순위 Pod가 클러스터의 핵심 서비스인 경우 PDB를 위반할 수도 있다. 이 동작은 `preemptionPolicy` 필드로 제어할 수 있다.

#### PriorityClass 설계 가이드라인

| 우선순위 범위 | 용도 | 예시 |
|---|---|---|
| 2,000,000,000+ | 시스템 예약 (사용 금지) | system-cluster-critical, system-node-critical |
| 1,000,000 ~ 999,999,999 | 프로덕션 핵심 워크로드 | 고가용성 API 서버, 데이터베이스 |
| 100,000 ~ 999,999 | 프로덕션 일반 워크로드 | 웹 서버, 마이크로서비스 |
| 1,000 ~ 99,999 | 개발/스테이징 워크로드 | 테스트 환경 |
| 0 ~ 999 | 배치 작업, 비필수 워크로드 | 로그 분석, 데이터 처리 |
| 음수값 | 최저 우선순위 | 가장 먼저 축출되어야 하는 워크로드 |

#### 주의 사항 및 엣지 케이스

- PriorityClass를 삭제해도 기존에 생성된 Pod의 priority 값은 변경되지 않는다. 새로 생성되는 Pod만 영향을 받는다.
- Preemption 시 스케줄러는 최소한의 Pod만 축출한다. 가능하면 PDB(PodDisruptionBudget)를 존중하지만, 높은 우선순위 Pod를 스케줄링하기 위해 PDB를 위반할 수도 있다.
- `value` 값이 10억(1,000,000,000)을 초과하면 시스템 PriorityClass와 충돌할 수 있으므로 사용하지 않아야 한다.
- `preemptionPolicy: Never`는 다른 Pod를 축출하지 않고 리소스가 자연스럽게 확보될 때까지 대기한다. 배치 작업에 적합하다.

---

### 1.4 SecurityContext (runAsUser, privileged, capabilities)

#### 배경

컨테이너는 기본적으로 root(UID 0)로 실행된다. 이는 다음과 같은 보안 문제를 야기한다:

- 컨테이너 런타임 취약점이 발생하면 root 권한으로 호스트에 접근할 수 있다(container escape).
- 컨테이너 내의 프로세스가 불필요한 Linux capabilities(예: `NET_RAW`, `SYS_ADMIN`)를 가지고 있어 공격 표면이 넓어진다.
- 마운트된 Volume의 파일 소유권이 root로 설정되어 비root 프로세스에서 접근 문제가 발생한다.

SecurityContext는 이 문제를 해결하기 위해 도입되었다. Pod 또는 컨테이너 수준에서 프로세스의 UID, GID, capabilities, 파일시스템 권한 등을 세밀하게 제어한다.

#### 내부 동작 원리

SecurityContext의 동작 메커니즘은 다음과 같다:

1. kubelet이 Pod를 생성할 때, `securityContext` 필드의 설정을 컨테이너 런타임(containerd)에 전달한다.
2. 컨테이너 런타임은 OCI 런타임 스펙(config.json)에 해당 보안 설정을 반영한다.
3. `runAsUser`는 컨테이너 프로세스의 UID를 설정하고, `runAsGroup`은 GID를 설정한다.
4. `capabilities`는 Linux 커널의 capability 시스템을 활용한다. `drop: ALL`은 모든 capabilities를 제거하고, `add`로 필요한 것만 추가한다.
5. `readOnlyRootFilesystem`은 컨테이너의 루트 파일시스템을 읽기 전용으로 마운트하여, 악성 코드가 파일시스템을 변조하는 것을 방지한다.
6. Pod 수준의 `securityContext`는 모든 컨테이너에 적용되고, 컨테이너 수준 설정은 해당 컨테이너에만 적용된다. 컨테이너 수준 설정이 Pod 수준 설정을 **오버라이드**한다.

#### 주요 필드

| 필드 | 수준 | 설명 |
|---|---|---|
| `runAsUser` | Pod / Container | 컨테이너 프로세스를 실행할 UID를 지정한다. |
| `runAsGroup` | Pod / Container | 컨테이너 프로세스의 GID를 지정한다. |
| `runAsNonRoot` | Pod / Container | `true`이면 root(UID 0)로 실행되는 것을 방지한다. |
| `fsGroup` | Pod | 마운트된 Volume의 그룹 소유권을 지정한다. |
| `privileged` | Container | `true`이면 호스트의 모든 장치에 접근 가능하다. 매우 위험하다. |
| `allowPrivilegeEscalation` | Container | `false`이면 자식 프로세스가 부모보다 높은 권한을 얻지 못한다. |
| `capabilities` | Container | Linux capabilities를 추가하거나 제거한다. |
| `readOnlyRootFilesystem` | Container | `true`이면 컨테이너의 루트 파일시스템을 읽기 전용으로 설정한다. |
| `seccompProfile` | Pod / Container | Seccomp 프로파일을 설정한다. |

#### 종합 예시

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: secure-pod
spec:
  securityContext:
    runAsUser: 1000
    runAsGroup: 3000
    fsGroup: 2000
    runAsNonRoot: true
    seccompProfile:
      type: RuntimeDefault
  containers:
  - name: app
    image: nginx:1.25
    securityContext:
      allowPrivilegeEscalation: false
      readOnlyRootFilesystem: true
      capabilities:
        drop:
        - ALL
        add:
        - NET_BIND_SERVICE
    volumeMounts:
    - name: tmp
      mountPath: /tmp
    - name: cache
      mountPath: /var/cache/nginx
    - name: run
      mountPath: /var/run
  volumes:
  - name: tmp
    emptyDir: {}
  - name: cache
    emptyDir: {}
  - name: run
    emptyDir: {}
```

#### 검증

```bash
# 적용
kubectl apply -f secure-pod.yaml

# 검증 1: Pod 생성 확인
kubectl get pod secure-pod
# 예상 출력:
# NAME         READY   STATUS    RESTARTS   AGE
# secure-pod   1/1     Running   0          10s

# 검증 2: UID/GID 확인
kubectl exec secure-pod -- id
# 예상 출력:
# uid=1000 gid=3000 groups=2000

# 검증 3: 파일시스템 그룹 확인
kubectl exec secure-pod -- ls -la /tmp
# 예상 출력:
# drwxrwsrwx 2 root 2000 ... .
# fsGroup=2000이 적용되어 /tmp의 그룹이 2000이다

# 검증 4: 읽기 전용 루트 파일시스템 확인
kubectl exec secure-pod -- touch /test-file
# 예상 출력:
# touch: /test-file: Read-only file system
# readOnlyRootFilesystem이 정상 동작하고 있다

# 검증 5: 쓰기 가능한 emptyDir 확인
kubectl exec secure-pod -- touch /tmp/test-file
# (성공 — emptyDir은 쓰기 가능하다)

# 검증 6: capabilities 확인
kubectl exec secure-pod -- cat /proc/1/status | grep Cap
# CapBnd 값에서 NET_BIND_SERVICE만 포함되어 있는지 확인한다
```

#### capabilities 주요 값

| Capability | 설명 |
|---|---|
| `NET_BIND_SERVICE` | 1024 미만의 포트에 바인딩할 수 있다. |
| `NET_ADMIN` | 네트워크 설정을 변경할 수 있다 (iptables 등). |
| `SYS_TIME` | 시스템 시간을 변경할 수 있다. |
| `SYS_PTRACE` | 다른 프로세스를 추적(trace)할 수 있다. |
| `ALL` | 모든 capability를 의미한다. `drop: ALL`로 전체 제거 후 필요한 것만 추가하는 것이 모범 사례이다. |

#### SecurityContext 트러블슈팅

| 증상 | 원인 | 해결 방법 |
|---|---|---|
| `Error: container has runAsNonRoot and image will run as root` | `runAsNonRoot: true`이지만 이미지가 root(UID 0)로 실행된다 | `runAsUser: 1000` 등 non-root UID를 명시한다 |
| `Error: failed to create containerd task: failed to start shim task: OCI runtime create failed: cannot set uid to 1000` | 이미지에 해당 UID의 사용자가 없다 | UID만 있으면 사용자 항목 없이도 동작한다. 다른 원인을 확인한다 |
| 앱이 `Permission denied`로 실패 | `readOnlyRootFilesystem: true`인데 앱이 파일시스템에 쓰기를 시도한다 | 쓰기가 필요한 디렉토리에 emptyDir Volume을 마운트한다 |
| 볼륨의 파일에 접근 불가 | `fsGroup`이 설정되지 않아 파일 소유권이 root이다 | Pod 수준 securityContext에 `fsGroup: <gid>`를 설정한다 |
| `NET_BIND_SERVICE`를 drop했지만 80번 포트 바인딩 필요 | capabilities에서 NET_BIND_SERVICE가 제거되었다 | `capabilities.add: ["NET_BIND_SERVICE"]`를 추가하거나 1024 이상의 포트를 사용한다 |

#### SecurityContext 적용 모범 사례

프로덕션 환경에서 권장되는 SecurityContext 설정:

```yaml
securityContext:
  runAsNonRoot: true            # root 실행 금지
  runAsUser: 1000               # 비root UID 명시
  runAsGroup: 3000              # GID 명시
  fsGroup: 2000                 # 볼륨 그룹 소유권
  seccompProfile:
    type: RuntimeDefault        # seccomp 프로파일 적용
containers:
- name: app
  securityContext:
    allowPrivilegeEscalation: false   # 권한 상승 금지
    readOnlyRootFilesystem: true      # 루트 파일시스템 읽기 전용
    capabilities:
      drop:
      - ALL                           # 모든 capability 제거
      add:
      - NET_BIND_SERVICE              # 필요한 것만 추가
```

이 설정은 PSA restricted 프로파일의 요구사항을 모두 충족한다.

#### 주의 사항 및 엣지 케이스

- `runAsNonRoot: true`를 설정했는데 이미지의 Dockerfile에서 `USER root`가 지정되어 있으면, Pod 생성 시 `Error: container has runAsNonRoot and image will run as root` 오류가 발생한다. 반드시 `runAsUser`로 non-root UID를 명시해야 한다.
- `readOnlyRootFilesystem: true`를 사용하면 nginx, redis 등 임시 파일을 쓰는 애플리케이션이 실패할 수 있다. nginx의 경우 `/tmp`, `/var/cache/nginx`, `/var/run` 디렉토리에 emptyDir Volume을 마운트하여 해결한다.
- `fsGroup`은 Volume이 처음 마운트될 때만 적용된다. 기존 데이터가 있는 PV의 파일 소유권은 자동으로 변경되지 않을 수 있다.
- Pod 수준의 `securityContext`는 모든 컨테이너에 적용되고, 컨테이너 수준 설정은 해당 컨테이너에만 적용된다. 컨테이너 수준 설정이 Pod 수준 설정을 오버라이드한다. `runAsUser`를 Pod 수준에서 1000으로, 특정 컨테이너에서 2000으로 설정하면 해당 컨테이너는 UID 2000으로 실행된다.

---

### 1.5 Resource Metrics (metrics-server, kubectl top, Custom Metrics for HPA)

#### 배경

Kubernetes 초기에는 클러스터 내 리소스 사용량을 확인하려면 cAdvisor API를 직접 호출하거나 Heapster를 설치해야 했다. Heapster의 문제점은 다음과 같았다:

- Heapster는 모놀리식 아키텍처로, 메트릭 수집과 저장이 결합되어 있어 확장성이 떨어졌다.
- Kubernetes의 Metrics API 표준이 없어 HPA 등 다른 컴포넌트와의 통합이 일관되지 않았다.
- Heapster는 Kubernetes 1.11에서 deprecated 되었다.

metrics-server는 Heapster를 대체하기 위해 도입되었다. Kubernetes Metrics API(`metrics.k8s.io`)를 구현하는 경량 인메모리 메트릭 수집기이다.

#### 내부 동작 원리

metrics-server의 동작 메커니즘은 다음과 같다:

1. metrics-server는 각 노드의 kubelet에 내장된 Summary API(`/metrics/resource`)를 주기적(기본 60초)으로 호출하여 CPU/메모리 사용량을 수집한다.
2. kubelet은 컨테이너 런타임(containerd)에서 cgroup 통계를 읽어 반환한다.
3. 수집된 메트릭은 메모리에 저장된다 (디스크에 저장하지 않는다. 과거 데이터는 유지되지 않는다).
4. kube-apiserver는 metrics-server를 APIService로 등록하여 `kubectl top` 명령과 HPA 컨트롤러가 `metrics.k8s.io/v1beta1` API를 통해 메트릭을 조회할 수 있게 한다.

#### metrics-server 설치 및 확인

```bash
# metrics-server 설치 확인
kubectl get deployment metrics-server -n kube-system

# metrics-server 설치 (시험 환경에서는 보통 설치되어 있다)
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
```

> **주의:** Apple Silicon(ARM64) 또는 자체 서명 인증서 환경에서는 `--kubelet-insecure-tls` 플래그가 필요할 수 있다.

#### 검증

```bash
# 검증 1: metrics-server Pod 상태 확인
kubectl get pods -n kube-system -l k8s-app=metrics-server
# 예상 출력:
# NAME                              READY   STATUS    RESTARTS   AGE
# metrics-server-6d94bc8694-xxxxx   1/1     Running   0          5m

# 검증 2: Metrics API 가용성 확인
kubectl get apiservice v1beta1.metrics.k8s.io
# 예상 출력:
# NAME                         SERVICE                      AVAILABLE   AGE
# v1beta1.metrics.k8s.io       kube-system/metrics-server   True        5m
# AVAILABLE이 True여야 한다. False이면 metrics-server가 정상 동작하지 않는 것이다.

# 검증 3: kubectl top 동작 확인
kubectl top nodes
# 예상 출력:
# NAME           CPU(cores)   CPU%   MEMORY(bytes)   MEMORY%
# controlplane   250m         12%    1024Mi          26%
# worker-1       100m         5%     512Mi           13%
```

#### kubectl top

```bash
# 노드별 리소스 사용량 확인
kubectl top nodes

# 전체 Pod 리소스 사용량 확인
kubectl top pods -A

# 특정 네임스페이스의 Pod 리소스 사용량
kubectl top pods -n kube-system

# CPU 사용량 기준 정렬
kubectl top pods --sort-by=cpu

# 메모리 사용량 기준 정렬
kubectl top pods --sort-by=memory

# 컨테이너별 리소스 사용량 확인
kubectl top pods --containers
```

#### HPA에서의 메트릭 활용

HPA는 기본적으로 metrics-server가 제공하는 CPU/메모리 메트릭을 사용한다.

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: myapp-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: myapp
  minReplicas: 2
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
```

#### 검증

```bash
# 적용
kubectl apply -f myapp-hpa.yaml

# 검증 1: HPA 상태 확인
kubectl get hpa myapp-hpa
# 예상 출력:
# NAME        REFERENCE          TARGETS           MINPODS   MAXPODS   REPLICAS   AGE
# myapp-hpa   Deployment/myapp   10%/70%, 5%/80%   2         10        2          30s
# TARGETS 컬럼에 <unknown>/70%가 표시되면 metrics-server가 아직 메트릭을 수집하지 못한 것이다.
# 1~2분 후 다시 확인한다.

# 검증 2: HPA 상세 상태 확인
kubectl describe hpa myapp-hpa
# Conditions 섹션에서 AbleToScale, ScalingActive 등의 상태를 확인한다.

# HPA 빠른 생성 (imperative)
kubectl autoscale deployment myapp --cpu-percent=70 --min=2 --max=10
```

#### Custom Metrics (커스텀 메트릭)

HPA에서 CPU/메모리 외의 메트릭(예: 초당 요청 수, 큐 길이 등)을 사용하려면 **Custom Metrics API**를 구현하는 어댑터가 필요하다 (예: Prometheus Adapter).

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: myapp-custom-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: myapp
  minReplicas: 2
  maxReplicas: 20
  metrics:
  - type: Pods
    pods:
      metric:
        name: http_requests_per_second
      target:
        type: AverageValue
        averageValue: "100"
```

> **CKA 시험에서는** Custom Metrics 설정은 거의 출제되지 않지만, `autoscaling/v2` API와 `metrics` 필드 구조는 숙지해야 한다.

#### 트러블슈팅: metrics-server 관련 장애

| 증상 | 원인 | 해결 방법 |
|---|---|---|
| `error: Metrics not available for pod` | metrics-server가 아직 메트릭을 수집하지 못했다 | metrics-server Pod 상태 확인, 1~2분 대기 후 재시도 |
| `kubectl top pods`에서 일부 Pod만 표시됨 | 해당 Pod가 생성된 지 1분 미만이다 | metrics-server의 수집 주기(기본 60초) 이후 재시도 |
| metrics-server Pod가 CrashLoopBackOff | kubelet TLS 인증서 검증 실패 | Deployment에 `--kubelet-insecure-tls` 인자 추가 (자체 서명 인증서 환경) |
| HPA TARGETS에 `<unknown>` 표시 | metrics-server가 동작하지 않거나, Pod에 requests가 미설정이다 | `kubectl get apiservice v1beta1.metrics.k8s.io` 확인, Pod에 resources.requests 추가 |

```bash
# metrics-server 장애 진단 명령
kubectl get apiservice v1beta1.metrics.k8s.io
```

검증 (정상):

```text
NAME                         SERVICE                      AVAILABLE   AGE
v1beta1.metrics.k8s.io       kube-system/metrics-server   True        5m
```

검증 (비정상):

```text
NAME                         SERVICE                      AVAILABLE   AGE
v1beta1.metrics.k8s.io       kube-system/metrics-server   False       5m
```

AVAILABLE이 False이면 metrics-server Pod 상태를 확인한다: `kubectl get pods -n kube-system -l k8s-app=metrics-server`.

#### 주의 사항 및 엣지 케이스

- `kubectl top`은 metrics-server 설치 후 약 1~2분이 지나야 데이터가 표시된다. `error: Metrics not available for pod` 오류가 발생하면 시간을 두고 재시도한다.
- HPA에서 `averageUtilization`을 사용하려면 해당 리소스의 `requests`가 반드시 Pod에 설정되어 있어야 한다. requests가 없으면 HPA가 "target utilization"을 계산할 수 없다. 이것이 tart-infra의 HPA 대상 Deployment에 모두 resources.requests가 설정되어 있는 이유이다.
- metrics-server는 인메모리 저장소를 사용하므로, Pod가 재시작되면 과거 메트릭이 소실된다. 장기 보관이 필요하면 Prometheus 등 별도 모니터링 시스템을 사용해야 한다.
- metrics-server는 CPU/메모리 사용량만 제공한다. 네트워크 트래픽, 디스크 I/O, 커스텀 메트릭(HTTP 요청 수 등)은 Prometheus + Custom Metrics API를 사용해야 한다.

---

## Part 2: 추가 실전 예제

> 이 파트의 각 예제는 CKA 시험에서 자주 출제되는 시나리오를 기반으로 작성한다. 각 예제에는 등장 배경, 내부 동작 원리, 장애 시나리오가 포함되어 있다.

---

### 예제 1. etcd 백업/복원 원라이너

#### 배경

etcd는 Kubernetes 클러스터의 모든 상태(오브젝트 정의, 설정 등)를 저장하는 분산 키-값 저장소이다. etcd 데이터가 손실되면 클러스터 전체가 복구 불가능해진다. 따라서 주기적인 백업과 검증된 복원 절차가 필수이다.

#### 내부 동작 원리: etcd의 데이터 저장 구조

etcd는 boltdb(bbolt) 기반의 B+ 트리 구조로 데이터를 저장한다. 각 Kubernetes 리소스는 etcd의 키-값 쌍으로 저장된다:

- 키: `/registry/<api-group>/<resource-type>/<namespace>/<name>` (예: `/registry/pods/demo/nginx-web-xxxx`)
- 값: protobuf 형식으로 직렬화된 리소스 정의

etcd의 데이터 구성 요소:
- **boltdb 파일**: `/var/lib/etcd/member/snap/db` — 실제 키-값 데이터가 저장되는 파일.
- **WAL(Write-Ahead Log)**: `/var/lib/etcd/member/wal/` — 트랜잭션 로그. 모든 쓰기 작업이 먼저 WAL에 기록된 후 boltdb에 적용된다. 장애 복구 시 WAL을 재생(replay)하여 일관성을 보장한다.
- **스냅샷**: `/var/lib/etcd/member/snap/` — WAL이 일정 크기를 초과하면 스냅샷을 생성하고 이전 WAL을 정리한다.

`etcdctl snapshot save`는 현재 boltdb의 consistent snapshot을 생성한다. 스냅샷 생성 중에도 etcd는 읽기/쓰기를 계속 처리하며, copy-on-write 메커니즘에 의해 스냅샷 일관성이 보장된다.

etcd 백업/복원에서 주의할 점은 다음과 같다:
- `ETCDCTL_API=3`을 반드시 지정해야 한다. API v2는 Kubernetes에서 사용하지 않는다.
- mTLS 인증서(CA, server cert, server key)가 필요하다. 잘못된 인증서를 사용하면 접속이 거부된다.
- 복원 시 반드시 기존과 **다른** 데이터 디렉토리를 사용해야 한다. 기존 디렉토리를 덮어쓰면 클러스터 ID 충돌이 발생할 수 있다.

#### 백업

```bash
# etcd 엔드포인트와 인증서 경로 확인
kubectl -n kube-system describe pod etcd-controlplane | grep -E '(--listen-client|--cert-file|--key-file|--trusted-ca-file)'

# 스냅샷 백업 (한 줄 명령)
ETCDCTL_API=3 etcdctl snapshot save /opt/etcd-backup.db \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key
```

#### 검증 (백업)

```bash
# 검증 1: 백업 파일 존재 확인
ls -la /opt/etcd-backup.db
# 예상 출력:
# -rw------- 1 root root 20971552 Mar 30 10:00 /opt/etcd-backup.db

# 검증 2: 스냅샷 무결성 확인
ETCDCTL_API=3 etcdctl snapshot status /opt/etcd-backup.db --write-out=table
# 예상 출력:
# +----------+----------+------------+------------+
# |   HASH   | REVISION | TOTAL KEYS | TOTAL SIZE |
# +----------+----------+------------+------------+
# | 3e5a0c80 |    15234 |       1053 |    20 MB   |
# +----------+----------+------------+------------+
# HASH 값이 표시되면 스냅샷이 정상이다. 손상된 경우 오류가 발생한다.
```

#### 복원

```bash
# 1. 기존 etcd 데이터 디렉토리 확인
cat /etc/kubernetes/manifests/etcd.yaml | grep data-dir
# --data-dir=/var/lib/etcd

# 2. 스냅샷 복원 (새 디렉토리로)
ETCDCTL_API=3 etcdctl snapshot restore /opt/etcd-backup.db \
  --data-dir=/var/lib/etcd-restored

# 3. etcd 매니페스트에서 data-dir 경로 변경
# 주의: 이 sed 명령은 --data-dir 인자와 hostPath 볼륨 경로를 모두 변경한다.
# etcd.yaml 안에서 두 곳(command의 --data-dir 값, volumes.hostPath.path 값)이
# 모두 새 경로로 바뀌어야 복원이 정상 동작한다.
sudo sed -i 's|/var/lib/etcd|/var/lib/etcd-restored|g' /etc/kubernetes/manifests/etcd.yaml

# 4. etcd Pod가 재시작될 때까지 대기 (Static Pod이므로 자동 재시작)
watch kubectl get pods -n kube-system -l component=etcd
```

#### 검증 (복원)

```bash
# 검증 1: etcd Pod Running 상태 확인
kubectl get pods -n kube-system -l component=etcd
# 예상 출력:
# NAME                    READY   STATUS    RESTARTS   AGE
# etcd-controlplane       1/1     Running   0          30s

# 검증 2: 클러스터 상태 확인
kubectl get nodes
# 예상 출력:
# NAME           STATUS   ROLES           AGE   VERSION
# controlplane   Ready    control-plane   30d   v1.30.0

# 검증 3: 기존 리소스가 복원되었는지 확인
kubectl get pods -A
kubectl get deployments -A
# 백업 시점의 리소스가 존재하는지 확인한다

# 검증 4: etcd 엔드포인트 헬스 체크
ETCDCTL_API=3 etcdctl endpoint health \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key
# 예상 출력:
# https://127.0.0.1:2379 is healthy: successfully committed proposal: took = 2.5ms
```

---

### 예제 2. kubeadm 업그레이드 (v1.30 -> v1.31)

#### 배경

Kubernetes 클러스터 업그레이드는 다음 규칙을 준수해야 한다:

- **한 번에 하나의 마이너 버전만** 업그레이드할 수 있다 (예: 1.30 -> 1.31). 1.30에서 1.32로 직접 업그레이드는 지원되지 않는다.
- **Control Plane을 먼저** 업그레이드하고, 그 다음 Worker 노드를 업그레이드해야 한다.
- kubelet 버전은 kube-apiserver 버전보다 **최대 2 마이너 버전 낮을 수 있다** (version skew policy). 이를 통해 점진적 업그레이드가 가능하다.

#### Control Plane 노드 업그레이드

```bash
# 1. 사용 가능한 kubeadm 버전 확인
apt-cache madison kubeadm | grep 1.31

# 2. kubeadm 업그레이드
sudo apt-mark unhold kubeadm
sudo apt-get update && sudo apt-get install -y kubeadm=1.31.0-1.1
sudo apt-mark hold kubeadm

# 3. 업그레이드 계획 확인
sudo kubeadm upgrade plan

# 4. 업그레이드 적용
sudo kubeadm upgrade apply v1.31.0

# 5. 노드 drain
kubectl drain controlplane --ignore-daemonsets --delete-emptydir-data

# 6. kubelet, kubectl 업그레이드
sudo apt-mark unhold kubelet kubectl
sudo apt-get install -y kubelet=1.31.0-1.1 kubectl=1.31.0-1.1
sudo apt-mark hold kubelet kubectl

# 7. kubelet 재시작
sudo systemctl daemon-reload
sudo systemctl restart kubelet

# 8. 노드 uncordon
kubectl uncordon controlplane
```

#### 검증 (Control Plane)

```bash
# 검증 1: 노드 버전 확인
kubectl get nodes
# 예상 출력:
# NAME           STATUS   ROLES           AGE   VERSION
# controlplane   Ready    control-plane   30d   v1.31.0
# worker-1       Ready    <none>          30d   v1.30.0

# 검증 2: kubeadm 버전 확인
kubeadm version
# 예상 출력:
# kubeadm version: &version.Info{Major:"1", Minor:"31", ...}

# 검증 3: Control Plane 컴포넌트 버전 확인
kubectl get pods -n kube-system -o custom-columns=NAME:.metadata.name,IMAGE:.spec.containers[0].image | grep -E '(apiserver|controller|scheduler|etcd)'
# 예상 출력:
# kube-apiserver-controlplane            registry.k8s.io/kube-apiserver:v1.31.0
# kube-controller-manager-controlplane   registry.k8s.io/kube-controller-manager:v1.31.0
# kube-scheduler-controlplane            registry.k8s.io/kube-scheduler:v1.31.0
```

#### Worker 노드 업그레이드

```bash
# Worker 노드에 SSH 접속
ssh worker-1

# 1. kubeadm 업그레이드
sudo apt-mark unhold kubeadm
sudo apt-get update && sudo apt-get install -y kubeadm=1.31.0-1.1
sudo apt-mark hold kubeadm

# 2. kubeadm 업그레이드 적용 (Worker는 upgrade node)
sudo kubeadm upgrade node

# 3. Control Plane에서 drain
# (Control Plane 터미널에서 실행)
kubectl drain worker-1 --ignore-daemonsets --delete-emptydir-data

# 4. kubelet, kubectl 업그레이드 (Worker 터미널에서)
sudo apt-mark unhold kubelet kubectl
sudo apt-get install -y kubelet=1.31.0-1.1 kubectl=1.31.0-1.1
sudo apt-mark hold kubelet kubectl

sudo systemctl daemon-reload
sudo systemctl restart kubelet

# 5. Control Plane에서 uncordon
kubectl uncordon worker-1
```

#### 검증 (Worker)

```bash
# 검증 1: 전체 노드 버전 확인
kubectl get nodes
# 예상 출력:
# NAME           STATUS   ROLES           AGE   VERSION
# controlplane   Ready    control-plane   30d   v1.31.0
# worker-1       Ready    <none>          30d   v1.31.0

# 검증 2: 노드의 kubelet 버전 확인
kubectl get node worker-1 -o jsonpath='{.status.nodeInfo.kubeletVersion}'
# 예상 출력:
# v1.31.0

# 검증 3: 기존 워크로드가 정상 동작하는지 확인
kubectl get pods -A -o wide | grep worker-1
# worker-1에 Pod가 다시 스케줄링되었는지 확인한다
```

---

### 예제 3. NetworkPolicy -- 특정 네임스페이스 트래픽만 허용

#### 배경

Kubernetes의 기본 네트워킹 모델에서는 모든 Pod가 다른 모든 Pod와 통신할 수 있다. 이를 "flat network"라 한다. 이 모델의 문제점은 다음과 같다:

- 보안 경계가 없어, 하나의 Pod가 침해되면 클러스터 내 모든 Pod에 접근할 수 있다 (lateral movement).
- 네임스페이스 간 격리가 제공되지 않아, dev 환경에서 production 환경으로의 트래픽이 차단되지 않는다.

NetworkPolicy는 이 문제를 해결한다. NetworkPolicy가 하나라도 적용되면 해당 Pod는 **명시적으로 허용된 트래픽만** 수신/발신할 수 있다. NetworkPolicy가 없는 Pod는 기존과 동일하게 모든 트래픽이 허용된다.

NetworkPolicy는 CNI 플러그인에 의해 구현된다. Calico, Cilium, Weave Net 등이 NetworkPolicy를 지원한다. **Flannel은 NetworkPolicy를 지원하지 않는다.**

```yaml
# 먼저 네임스페이스 레이블 설정
# kubectl label namespace frontend team=frontend
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-from-frontend-ns
  namespace: backend
spec:
  podSelector: {}              # backend 네임스페이스의 모든 Pod에 적용
  policyTypes:
  - Ingress
  ingress:
  - from:
    - namespaceSelector:
        matchLabels:
          team: frontend       # team=frontend 레이블이 있는 네임스페이스에서만 허용
    ports:
    - protocol: TCP
      port: 8080
```

#### 검증

```bash
# 사전 준비
kubectl create namespace frontend
kubectl create namespace backend
kubectl label namespace frontend team=frontend

# backend 네임스페이스에 테스트 Pod와 Service 생성
kubectl run backend-pod --image=nginx:1.25 -n backend --port=8080
kubectl expose pod backend-pod --port=8080 --name=backend-svc -n backend

# NetworkPolicy 적용
kubectl apply -f allow-from-frontend-ns.yaml

# 검증 1: NetworkPolicy 생성 확인
kubectl get networkpolicy -n backend
# 예상 출력:
# NAME                     POD-SELECTOR   AGE
# allow-from-frontend-ns   <none>         5s

kubectl describe networkpolicy allow-from-frontend-ns -n backend
# 예상 출력:
# Spec:
#   PodSelector:     <none> (Allowing the specific traffic to all pods in this namespace)
#   Allowing ingress traffic:
#     To Port: 8080/TCP
#     From:
#       NamespaceSelector: team=frontend
#   Not affecting egress traffic

# 검증 2: frontend 네임스페이스에서 접근 - 성공해야 한다
kubectl run test --rm -it --image=busybox -n frontend -- wget -qO- --timeout=3 http://backend-svc.backend:8080
# 예상 출력:
# <!DOCTYPE html>
# <html>
# <head><title>Welcome to nginx!</title>...

# 검증 3: default 네임스페이스에서 접근 - 실패해야 한다
kubectl run test --rm -it --image=busybox -n default -- wget -qO- --timeout=3 http://backend-svc.backend:8080
# 예상 출력:
# wget: download timed out
# NetworkPolicy가 정상적으로 차단하고 있다
```

---

### 예제 4. RBAC -- 특정 네임스페이스에서 Pod 조회만 가능한 사용자

#### 배경

Kubernetes의 인증(Authentication)과 인가(Authorization)는 분리되어 있다. 인증은 "누구인지" 확인하고, 인가는 "무엇을 할 수 있는지" 결정한다. RBAC(Role-Based Access Control)은 Kubernetes의 기본 인가 방식이다.

RBAC 이전에는 ABAC(Attribute-Based Access Control)이 사용되었으나, 정책 파일을 수정하려면 kube-apiserver를 재시작해야 했다. RBAC은 Kubernetes API를 통해 동적으로 권한을 관리할 수 있어 ABAC을 대체했다.

RBAC의 네 가지 리소스는 다음과 같다:
- **Role**: 네임스페이스 범위의 권한 정의이다.
- **ClusterRole**: 클러스터 범위의 권한 정의이다. 네임스페이스에 속하지 않는 리소스(Node, PV 등)에도 사용한다.
- **RoleBinding**: Role을 사용자/그룹/ServiceAccount에 연결한다. 특정 네임스페이스에서만 유효하다.
- **ClusterRoleBinding**: ClusterRole을 사용자/그룹/ServiceAccount에 연결한다. 모든 네임스페이스에서 유효하다.

```bash
# 1. 네임스페이스 생성
kubectl create namespace dev-team

# 2. Role 생성 (dev-team 네임스페이스에서 Pod 조회만 허용)
kubectl create role pod-reader \
  --verb=get,list,watch \
  --resource=pods \
  -n dev-team

# 3. RoleBinding 생성 (사용자 dev-user에 연결)
kubectl create rolebinding dev-user-pod-reader \
  --role=pod-reader \
  --user=dev-user \
  -n dev-team
```

YAML로 작성하면 다음과 같다:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: pod-reader
  namespace: dev-team
rules:
- apiGroups: [""]
  resources: ["pods"]
  verbs: ["get", "list", "watch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: dev-user-pod-reader
  namespace: dev-team
subjects:
- kind: User
  name: dev-user
  apiGroup: rbac.authorization.k8s.io
roleRef:
  kind: Role
  name: pod-reader
  apiGroup: rbac.authorization.k8s.io
```

#### 검증

```bash
# 적용
kubectl apply -f rbac.yaml

# 검증 1: Role 생성 확인
kubectl get role pod-reader -n dev-team
# 예상 출력:
# NAME         CREATED AT
# pod-reader   2026-03-30T10:00:00Z

kubectl describe role pod-reader -n dev-team
# 예상 출력:
# PolicyRule:
#   Resources  Non-Resource URLs  Resource Names  Verbs
#   ---------  -----------------  --------------  -----
#   pods       []                 []              [get list watch]

# 검증 2: RoleBinding 확인
kubectl get rolebinding dev-user-pod-reader -n dev-team
# 예상 출력:
# NAME                   ROLE              AGE
# dev-user-pod-reader    Role/pod-reader   10s

# 검증 3: 권한 테스트 - 허용된 동작
kubectl auth can-i get pods -n dev-team --as=dev-user
# 예상 출력: yes

kubectl auth can-i list pods -n dev-team --as=dev-user
# 예상 출력: yes

# 검증 4: 권한 테스트 - 금지된 동작
kubectl auth can-i delete pods -n dev-team --as=dev-user
# 예상 출력: no

kubectl auth can-i get pods -n default --as=dev-user
# 예상 출력: no

kubectl auth can-i create deployments -n dev-team --as=dev-user
# 예상 출력: no
```

---

### 예제 5. CrashLoopBackOff 트러블슈팅

#### 배경

CrashLoopBackOff는 컨테이너가 반복적으로 시작되었다가 종료되는 상태이다. kubelet은 실패한 컨테이너를 지수적 백오프(exponential backoff)로 재시작한다: 10초 -> 20초 -> 40초 -> ... 최대 5분까지 대기 시간이 증가한다.

이 상태는 Pod 자체의 문제가 아니라 **컨테이너 프로세스**의 문제이다. kubelet은 컨테이너를 정상적으로 시작하지만, 컨테이너 내부의 프로세스가 비정상 종료하는 것이다.

#### 일반적인 원인과 디버깅 절차

```bash
# 1. Pod 상태 확인
kubectl get pod crashed-pod -o wide

# 2. 이벤트 확인 (가장 먼저 확인해야 할 것)
kubectl describe pod crashed-pod
# Events 섹션에서 오류 메시지 확인

# 3. 컨테이너 로그 확인 (현재 + 이전 로그)
kubectl logs crashed-pod
kubectl logs crashed-pod --previous    # 이전 크래시의 로그

# 4. 컨테이너 상태 상세 확인
kubectl get pod crashed-pod -o jsonpath='{.status.containerStatuses[0].state}'
kubectl get pod crashed-pod -o jsonpath='{.status.containerStatuses[0].lastState}'
```

#### 검증 (원인 진단)

```bash
# 검증 1: 종료 코드 확인
kubectl get pod crashed-pod -o jsonpath='{.status.containerStatuses[0].lastState.terminated.exitCode}'
# 예상 출력 예시:
# 1     — 일반적인 애플리케이션 오류이다
# 137   — OOMKilled (128 + 9 = SIGKILL)이다
# 139   — Segfault (128 + 11 = SIGSEGV)이다
# 143   — SIGTERM으로 종료되었다 (128 + 15)

# 검증 2: 종료 사유 확인
kubectl get pod crashed-pod -o jsonpath='{.status.containerStatuses[0].lastState.terminated.reason}'
# 예상 출력 예시:
# OOMKilled — memory limits를 증가해야 한다
# Error — command/args 또는 환경 변수 설정을 확인해야 한다
# Completed — 컨테이너가 정상 종료 되었지만 restartPolicy에 의해 재시작되는 것이다
```

#### 흔한 원인별 해결

```bash
# 원인 1: 잘못된 command/args
# -> describe에서 "Error" exit code 확인 -> YAML에서 command 수정
kubectl get pod crashed-pod -o yaml > fix.yaml
kubectl delete pod crashed-pod
# fix.yaml에서 command/args 수정
kubectl apply -f fix.yaml

# 원인 2: 환경 변수 누락 또는 잘못된 ConfigMap/Secret 참조
# -> describe에서 "CreateContainerConfigError" 확인

# 원인 3: 리소스 부족 (OOMKilled)
kubectl get pod crashed-pod -o jsonpath='{.status.containerStatuses[0].lastState.terminated.reason}'
# "OOMKilled" -> memory limits 증가

# 원인 4: Liveness Probe 실패
# -> describe에서 "Liveness probe failed" 확인 -> probe 설정 조정
```

---

### 예제 6. PV + PVC + Pod 구성

#### 배경

Kubernetes의 스토리지 모델은 "관심사 분리" 원칙에 기반한다. 클러스터 관리자가 PV(PersistentVolume)를 프로비저닝하고, 개발자가 PVC(PersistentVolumeClaim)를 통해 스토리지를 요청한다. 이를 통해 개발자는 실제 스토리지 인프라(NFS, AWS EBS, GCE PD 등)의 상세를 알 필요가 없다.

PV-PVC 바인딩은 다음 조건이 모두 일치할 때 성립한다:
- `storageClassName`이 일치해야 한다.
- PV의 `capacity`가 PVC의 `requests.storage` 이상이어야 한다.
- `accessModes`가 호환되어야 한다.

```yaml
# PersistentVolume (hostPath 유형)
apiVersion: v1
kind: PersistentVolume
metadata:
  name: task-pv
spec:
  capacity:
    storage: 1Gi
  accessModes:
  - ReadWriteOnce
  persistentVolumeReclaimPolicy: Retain
  storageClassName: manual
  hostPath:
    path: /mnt/data
---
# PersistentVolumeClaim
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: task-pvc
  namespace: default
spec:
  accessModes:
  - ReadWriteOnce
  resources:
    requests:
      storage: 500Mi
  storageClassName: manual
---
# Pod에서 PVC 사용
apiVersion: v1
kind: Pod
metadata:
  name: task-pod
spec:
  containers:
  - name: app
    image: nginx:1.25
    volumeMounts:
    - name: task-storage
      mountPath: /usr/share/nginx/html
  volumes:
  - name: task-storage
    persistentVolumeClaim:
      claimName: task-pvc
```

#### 검증

```bash
# 적용
kubectl apply -f pv-pvc-pod.yaml

# 검증 1: PV 상태 확인
kubectl get pv task-pv
# 예상 출력:
# NAME      CAPACITY   ACCESS MODES   RECLAIM POLICY   STATUS   CLAIM              STORAGECLASS   AGE
# task-pv   1Gi        RWO            Retain           Bound    default/task-pvc   manual         5s

# 검증 2: PVC 상태 확인
kubectl get pvc task-pvc
# 예상 출력:
# NAME       STATUS   VOLUME    CAPACITY   ACCESS MODES   STORAGECLASS   AGE
# task-pvc   Bound    task-pv   1Gi        RWO            manual         5s
# STATUS가 Bound여야 한다. Pending이면 일치하는 PV가 없는 것이다.

# 검증 3: Pod Running 확인
kubectl get pod task-pod
# 예상 출력:
# NAME       READY   STATUS    RESTARTS   AGE
# task-pod   1/1     Running   0          10s

# 검증 4: 데이터 쓰기/읽기 테스트
kubectl exec task-pod -- sh -c 'echo "Hello PV" > /usr/share/nginx/html/index.html'
kubectl exec task-pod -- cat /usr/share/nginx/html/index.html
# 예상 출력:
# Hello PV

# 검증 5: Pod 재시작 후에도 데이터 유지 확인
kubectl delete pod task-pod
kubectl apply -f task-pod.yaml  # 동일 PVC를 사용하는 Pod 재생성
kubectl exec task-pod -- cat /usr/share/nginx/html/index.html
# 예상 출력:
# Hello PV
# PersistentVolume이므로 데이터가 유지된다
```

---

### 예제 7. StatefulSet + Headless Service

#### 배경

Deployment는 stateless 워크로드에 적합하다. Deployment의 한계를 이해하면 StatefulSet이 왜 필요한지 명확해진다.

Deployment의 한계:
- **Pod 이름**: 랜덤 해시 접미사(예: web-7b4c5b9f8d-x2kl7)가 부여되며, Pod 재생성 시 이름이 변경된다.
- **스토리지**: 모든 Pod가 동일한 PVC를 공유하거나, 각 Pod에 독립 PVC를 할당할 수 없다.
- **순서 보장 없음**: Pod가 병렬로 생성/삭제되므로, 데이터베이스 클러스터의 마스터-슬레이브 초기화 순서를 보장할 수 없다.
- **네트워크 ID**: Pod 재생성 시 IP가 변경되므로, 다른 컴포넌트가 특정 Pod를 안정적으로 참조할 수 없다.

StatefulSet은 이 모든 한계를 해결한다.

#### 내부 동작 원리

StatefulSet 컨트롤러의 동작 메커니즘:

1. **순서 보장**: Pod는 0, 1, 2 순서로 생성된다. 이전 Pod가 Ready 상태가 되어야 다음 Pod가 생성된다. 삭제는 역순(2, 1, 0)으로 진행된다.
2. **안정적 이름**: 각 Pod에 `<statefulset-name>-<ordinal>` 형태의 고정 이름이 부여된다 (예: web-0, web-1, web-2). Pod가 재생성되어도 동일한 이름이 유지된다.
3. **안정적 스토리지**: `volumeClaimTemplates`에 의해 각 Pod에 독립적인 PVC가 자동 생성된다 (예: www-web-0, www-web-1, www-web-2). Pod가 재생성되어도 동일한 PVC에 연결되어 데이터가 보존된다.
4. **안정적 네트워크 ID**: Headless Service와 결합하면 각 Pod에 `<pod-name>.<service-name>.<namespace>.svc.cluster.local` 형태의 고유 DNS 이름이 할당된다.

StatefulSet 삭제 시 PVC는 자동 삭제되지 않는다. 이는 데이터 보호를 위한 설계이다. PVC를 삭제하려면 수동으로 `kubectl delete pvc <name>` 을 실행해야 한다.

#### StatefulSet과 Headless Service의 관계

StatefulSet은 반드시 `serviceName` 필드에 Headless Service의 이름을 지정해야 한다. 이 Service는 `clusterIP: None`으로 설정되어, DNS 조회 시 ClusterIP 대신 각 Pod의 IP를 직접 반환한다. 이를 통해 다음과 같은 DNS 레코드가 자동 생성된다:

```
# Headless Service DNS → 모든 Pod IP 반환
web.nginx-headless.default.svc.cluster.local → [10.244.1.5, 10.244.2.6, 10.244.3.7]

# 개별 Pod DNS → 해당 Pod IP만 반환
web-0.nginx-headless.default.svc.cluster.local → 10.244.1.5
web-1.nginx-headless.default.svc.cluster.local → 10.244.2.6
web-2.nginx-headless.default.svc.cluster.local → 10.244.3.7
```

그러나 다음과 같은 요구사항을 가진 stateful 워크로드에는 적합하지 않다:

- **안정적인 네트워크 ID**: 각 Pod에 고유하고 예측 가능한 DNS 이름이 필요하다 (예: db-0, db-1, db-2).
- **순서가 보장되는 배포/삭제**: Pod가 0, 1, 2 순서로 생성되고 2, 1, 0 순서로 삭제되어야 한다.
- **Pod별 고유 스토리지**: 각 Pod에 독립적인 PVC가 할당되어야 한다. Pod가 재시작되어도 동일한 PVC에 연결되어야 한다.

StatefulSet은 이 요구사항을 해결한다. Headless Service(`clusterIP: None`)와 함께 사용하여 각 Pod에 `<pod-name>.<service-name>.<namespace>.svc.cluster.local` 형태의 안정적인 DNS 이름을 제공한다.

```yaml
# Headless Service (clusterIP: None)
apiVersion: v1
kind: Service
metadata:
  name: nginx-headless
  labels:
    app: nginx
spec:
  ports:
  - port: 80
    name: web
  clusterIP: None
  selector:
    app: nginx
---
# StatefulSet
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: web
spec:
  serviceName: nginx-headless
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
        image: nginx:1.25
        ports:
        - containerPort: 80
          name: web
        volumeMounts:
        - name: www
          mountPath: /usr/share/nginx/html
  volumeClaimTemplates:
  - metadata:
      name: www
    spec:
      accessModes: ["ReadWriteOnce"]
      storageClassName: standard
      resources:
        requests:
          storage: 1Gi
```

#### 검증

```bash
# 적용
kubectl apply -f statefulset.yaml

# 검증 1: Pod 순서대로 생성 확인
kubectl get pods -l app=nginx -w
# 예상 출력 (순서대로 생성됨):
# NAME    READY   STATUS    RESTARTS   AGE
# web-0   1/1     Running   0          30s
# web-1   1/1     Running   0          20s
# web-2   1/1     Running   0          10s

# 검증 2: 각 Pod의 고유 PVC 확인
kubectl get pvc
# 예상 출력:
# NAME        STATUS   VOLUME                                     CAPACITY   ACCESS MODES   STORAGECLASS
# www-web-0   Bound    pvc-xxx-xxx-xxx                            1Gi        RWO            standard
# www-web-1   Bound    pvc-yyy-yyy-yyy                            1Gi        RWO            standard
# www-web-2   Bound    pvc-zzz-zzz-zzz                            1Gi        RWO            standard

# 검증 3: Headless Service 확인 (ClusterIP가 None)
kubectl get svc nginx-headless
# 예상 출력:
# NAME             TYPE        CLUSTER-IP   EXTERNAL-IP   PORT(S)   AGE
# nginx-headless   ClusterIP   None         <none>        80/TCP    30s

# 검증 4: DNS 이름 확인
kubectl run dns-test --rm -it --image=busybox:1.36 -- nslookup web-0.nginx-headless.default.svc.cluster.local
# 예상 출력:
# Server:    10.96.0.10
# Address 1: 10.96.0.10 kube-dns.kube-system.svc.cluster.local
# Name:      web-0.nginx-headless.default.svc.cluster.local
# Address 1: 10.244.1.5 web-0.nginx-headless.default.svc.cluster.local

# 각 Pod의 고유 DNS 이름:
# web-0.nginx-headless.default.svc.cluster.local
# web-1.nginx-headless.default.svc.cluster.local
# web-2.nginx-headless.default.svc.cluster.local
```

---

### 예제 8. HPA 구성

#### 배경

수동으로 Pod 레플리카 수를 조정하는 것은 다음 문제가 있다:

- 트래픽 변동에 실시간 대응이 불가능하다.
- 과도한 프로비저닝은 리소스 낭비이고, 부족한 프로비저닝은 서비스 장애를 유발한다.

HPA(Horizontal Pod Autoscaler)는 메트릭 기반으로 자동 스케일링을 수행한다. 기본적으로 CPU/메모리 사용률을 기준으로 레플리카 수를 조정한다.

HPA의 내부 동작은 다음과 같다:
1. HPA 컨트롤러가 15초 간격(기본값)으로 메트릭을 조회한다.
2. `desiredReplicas = ceil(currentReplicas * (currentMetricValue / desiredMetricValue))`로 목표 레플리카 수를 계산한다.
3. 계산된 값이 현재 레플리카 수와 다르면 Deployment의 `.spec.replicas`를 변경한다.

```yaml
# Deployment (반드시 resources.requests를 설정해야 HPA가 동작한다)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: php-apache
spec:
  replicas: 1
  selector:
    matchLabels:
      app: php-apache
  template:
    metadata:
      labels:
        app: php-apache
    spec:
      containers:
      - name: php-apache
        image: registry.k8s.io/hpa-example
        ports:
        - containerPort: 80
        resources:
          requests:
            cpu: 200m
          limits:
            cpu: 500m
---
# Service
apiVersion: v1
kind: Service
metadata:
  name: php-apache
spec:
  ports:
  - port: 80
  selector:
    app: php-apache
---
# HPA
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: php-apache-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: php-apache
  minReplicas: 1
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 50
  behavior:
    scaleDown:
      stabilizationWindowSeconds: 60
```

#### 검증

```bash
# 적용
kubectl apply -f hpa.yaml

# 검증 1: HPA 상태 확인
kubectl get hpa php-apache-hpa
# 예상 출력:
# NAME             REFERENCE               TARGETS   MINPODS   MAXPODS   REPLICAS   AGE
# php-apache-hpa   Deployment/php-apache   0%/50%    1         10        1          30s

# 검증 2: 부하 생성 (별도 터미널)
kubectl run load-generator --rm -it --image=busybox:1.36 -- /bin/sh -c \
  "while true; do wget -q -O- http://php-apache; done"

# 검증 3: HPA 스케일링 모니터링
kubectl get hpa -w
# 예상 출력 (부하 증가에 따라):
# NAME             REFERENCE               TARGETS    MINPODS   MAXPODS   REPLICAS   AGE
# php-apache-hpa   Deployment/php-apache   0%/50%     1         10        1          1m
# php-apache-hpa   Deployment/php-apache   150%/50%   1         10        1          2m
# php-apache-hpa   Deployment/php-apache   150%/50%   1         10        3          2m30s
# php-apache-hpa   Deployment/php-apache   75%/50%    1         10        4          3m

# 검증 4: 부하 중단 후 스케일 다운 확인 (stabilizationWindowSeconds 이후)
# load-generator를 Ctrl+C로 중단
kubectl get hpa -w
# 약 60초(stabilizationWindowSeconds) 후 레플리카 수가 감소하기 시작한다

# imperative 방식으로 HPA 생성
kubectl autoscale deployment php-apache --cpu-percent=50 --min=1 --max=10
```

---

### 예제 9. Ingress with TLS Termination

#### 배경

Ingress는 클러스터 외부에서 내부 Service로의 HTTP/HTTPS 트래픽을 라우팅하는 리소스이다. TLS Termination은 Ingress Controller(예: nginx)가 HTTPS 연결을 처리하고, 백엔드 Service에는 HTTP로 전달하는 방식이다.

Ingress를 사용하지 않으면, 각 Service에 NodePort 또는 LoadBalancer를 할당해야 한다. 이 방식의 문제점은 다음과 같다:
- NodePort는 포트 번호가 30000~32767로 제한되어 표준 HTTP/HTTPS 포트(80/443)를 사용할 수 없다.
- LoadBalancer는 Service마다 별도의 외부 IP가 필요하여 비용이 증가한다.
- TLS 인증서를 각 서비스마다 개별 관리해야 한다.

Ingress는 하나의 외부 IP로 여러 Service를 호스트/경로 기반으로 라우팅할 수 있어 이 문제를 해결한다.

```bash
# 1. TLS 시크릿 생성
# 자체 서명 인증서 생성 (시험에서는 인증서가 제공된다)
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout tls.key -out tls.crt \
  -subj "/CN=myapp.example.com"

# Secret으로 등록
kubectl create secret tls myapp-tls \
  --cert=tls.crt \
  --key=tls.key
```

```yaml
# Ingress with TLS
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: myapp-ingress
  annotations:
    nginx.ingress.kubernetes.io/rewrite-target: /
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
      - path: /
        pathType: Prefix
        backend:
          service:
            name: myapp-svc
            port:
              number: 80
```

#### 검증

```bash
# 적용
kubectl apply -f myapp-ingress.yaml

# 검증 1: Ingress 생성 확인
kubectl get ingress myapp-ingress
# 예상 출력:
# NAME             CLASS   HOSTS               ADDRESS        PORTS     AGE
# myapp-ingress    nginx   myapp.example.com   10.96.x.x     80, 443   10s
# PORTS에 443이 포함되어 있으면 TLS가 설정된 것이다

# 검증 2: Ingress 상세 정보 확인
kubectl describe ingress myapp-ingress
# 예상 출력:
# TLS:
#   myapp-tls terminates myapp.example.com
# Rules:
#   Host               Path  Backends
#   ----               ----  --------
#   myapp.example.com  /     myapp-svc:80

# 검증 3: TLS 인증서 확인
kubectl get secret myapp-tls -o jsonpath='{.data.tls\.crt}' | base64 -d | openssl x509 -noout -subject -enddate
# 예상 출력:
# subject=CN = myapp.example.com
# notAfter=Mar 30 10:00:00 2027 GMT

# 검증 4: HTTPS 접근 테스트 (클러스터 내에서)
kubectl run curl-test --rm -it --image=curlimages/curl -- curl -k https://myapp.example.com --resolve myapp.example.com:443:<ingress-controller-ip>
# -k 옵션은 자체 서명 인증서의 검증을 건너뛴다
```

---

### 예제 10. Node 유지보수 (drain / cordon / uncordon)

#### 배경

노드 유지보수(OS 패치, 커널 업데이트, 하드웨어 교체 등)가 필요할 때, 해당 노드의 워크로드를 안전하게 다른 노드로 이동시켜야 한다. Kubernetes는 이를 위해 cordon/drain/uncordon 메커니즘을 제공한다.

내부 동작 원리는 다음과 같다:

1. `kubectl cordon`: 노드에 `node.kubernetes.io/unschedulable` taint를 추가한다. 기존 Pod는 영향을 받지 않으나, 새로운 Pod는 이 노드에 스케줄링되지 않는다.
2. `kubectl drain`: cordon + 기존 Pod 축출을 수행한다. 각 Pod를 graceful하게 삭제하고, ReplicaSet/Deployment가 다른 노드에 대체 Pod를 생성한다.
3. `kubectl uncordon`: `node.kubernetes.io/unschedulable` taint를 제거하여 노드를 다시 스케줄링 가능 상태로 전환한다.

```bash
# 1. 노드 상태 확인
kubectl get nodes

# 2. cordon -- 노드에 새로운 Pod 스케줄링을 금지한다 (기존 Pod는 유지)
kubectl cordon worker-1
# worker-1이 SchedulingDisabled 상태가 된다

# 3. drain -- 노드의 모든 Pod를 다른 노드로 이동시킨다
kubectl drain worker-1 \
  --ignore-daemonsets \
  --delete-emptydir-data \
  --force
# --ignore-daemonsets: DaemonSet Pod는 무시 (삭제하지 않음)
# --delete-emptydir-data: emptyDir 볼륨 데이터 삭제 허용
# --force: ReplicaSet 등에 의해 관리되지 않는 Pod도 강제 삭제

# 4. 유지보수 작업 수행 (OS 패치, 커널 업데이트 등)

# 5. uncordon -- 노드를 다시 스케줄링 가능 상태로 전환한다
kubectl uncordon worker-1
```

#### 검증

```bash
# 검증 1: cordon 후 상태 확인
kubectl get nodes
# 예상 출력:
# NAME           STATUS                     ROLES           AGE   VERSION
# controlplane   Ready                      control-plane   30d   v1.30.0
# worker-1       Ready,SchedulingDisabled   <none>          30d   v1.30.0

# 검증 2: drain 후 Pod 이동 확인
kubectl get pods -o wide
# worker-1에 있던 Pod가 다른 노드로 이동했는지 확인한다.
# DaemonSet Pod만 worker-1에 남아 있어야 한다.

# 검증 3: uncordon 후 상태 확인
kubectl get nodes
# 예상 출력:
# NAME           STATUS   ROLES           AGE   VERSION
# controlplane   Ready    control-plane   30d   v1.30.0
# worker-1       Ready    <none>          30d   v1.30.0
# SchedulingDisabled이 사라졌다

# 검증 4: 새 Pod가 worker-1에 스케줄링되는지 확인
kubectl run test-schedule --image=nginx:1.25
kubectl get pod test-schedule -o wide
# NODE 컬럼에 worker-1이 표시될 수 있다 (스케줄러 판단에 따라)
```

> **주의:** `kubectl drain`은 PodDisruptionBudget(PDB)를 존중한다. PDB가 설정되어 있으면 최소 가용 Pod 수를 유지하면서 drain이 진행된다. PDB 조건을 만족시킬 수 없으면 drain이 중단되며, `--force` 플래그로도 PDB를 무시할 수 없다. PDB를 우회하려면 `--disable-eviction` 플래그를 사용해야 한다.

#### 내부 동작 원리: drain의 축출 과정

`kubectl drain`의 내부 동작은 다음 순서로 진행된다:

1. 노드에 `node.kubernetes.io/unschedulable` Taint를 추가한다 (cordon 동작).
2. 노드에서 실행 중인 Pod 목록을 조회한다.
3. DaemonSet Pod를 제외한다 (`--ignore-daemonsets` 플래그 사용 시).
4. 각 Pod에 대해 Eviction API(`POST /api/v1/namespaces/<ns>/pods/<name>/eviction`)를 호출한다.
5. Eviction API는 PDB를 확인한다. PDB 조건을 위반하면 eviction이 거부(429 Too Many Requests)된다.
6. Eviction이 허용되면 Pod에 SIGTERM이 전송되고, `terminationGracePeriodSeconds`(기본 30초) 동안 graceful shutdown을 기다린다.
7. grace period가 지나면 SIGKILL로 강제 종료한다.
8. ReplicaSet/Deployment 컨트롤러가 다른 노드에 대체 Pod를 생성한다.

#### 트러블슈팅: drain 실패 시나리오

| 증상 | 원인 | 해결 방법 |
|---|---|---|
| `Cannot evict pod as it would violate the pod's disruption budget` | PDB 조건을 충족할 수 없다 | PDB의 minAvailable를 줄이거나, 다른 노드의 Pod를 먼저 스케일 업한다 |
| `error when evicting pods: pods "xxx" not found` | Pod가 이미 삭제되었다 | 정상 동작이다. drain이 계속 진행된다 |
| drain이 무한 대기 | PDB 위반 또는 Pod가 Terminating 상태에서 멈춤 | `--timeout` 플래그를 설정하거나, 문제 Pod를 수동으로 삭제한다 |
| `DaemonSet-managed Pods (use --ignore-daemonsets to ignore)` | DaemonSet Pod가 존재한다 | `--ignore-daemonsets` 플래그를 추가한다 |
| `pods with local storage (use --delete-emptydir-data to override)` | emptyDir 볼륨을 사용하는 Pod가 존재한다 | `--delete-emptydir-data` 플래그를 추가한다 (데이터 손실 동의) |

---

## Part 3: 개념별 확인 문제 (30문항)

> 각 문제를 읽고 답을 생각한 후 `<details>` 블록을 열어 풀이를 확인한다.

---

### Cluster Architecture, Installation & Configuration (8문항)

#### 문제 1. etcd 스냅샷 백업 경로 확인

etcd의 인증서 파일 경로와 엔드포인트를 확인하는 명령어를 작성하라.

<details>
<summary>풀이</summary>

```bash
# 방법 1: etcd Pod의 명령줄 인자에서 확인
kubectl -n kube-system describe pod etcd-controlplane

# 방법 2: etcd 매니페스트 파일에서 직접 확인
cat /etc/kubernetes/manifests/etcd.yaml | grep -E '(--listen-client|--cert-file|--key-file|--trusted-ca-file|--data-dir)'
```

주요 경로:
- `--cert-file=/etc/kubernetes/pki/etcd/server.crt`
- `--key-file=/etc/kubernetes/pki/etcd/server.key`
- `--trusted-ca-file=/etc/kubernetes/pki/etcd/ca.crt`
- `--listen-client-urls=https://127.0.0.1:2379`

#### 검증

```bash
# 검증: 인증서 파일 존재 확인
ls -la /etc/kubernetes/pki/etcd/
# 예상 출력:
# -rw-r--r-- 1 root root 1058 ... ca.crt
# -rw------- 1 root root 1675 ... ca.key
# -rw-r--r-- 1 root root 1139 ... server.crt
# -rw------- 1 root root 1675 ... server.key
# ...

# 검증: etcd 연결 테스트
ETCDCTL_API=3 etcdctl endpoint health \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key
# 예상 출력:
# https://127.0.0.1:2379 is healthy: successfully committed proposal: took = 2.1ms
```

</details>

---

#### 문제 2. kubeadm 인증서 만료 확인

클러스터의 모든 인증서 만료일을 확인하는 명령어를 작성하라.

<details>
<summary>풀이</summary>

```bash
# 모든 인증서 만료 정보 확인
sudo kubeadm certs check-expiration

# 특정 인증서 파일의 만료일 직접 확인
openssl x509 -in /etc/kubernetes/pki/apiserver.crt -noout -enddate
```

인증서 갱신이 필요한 경우:
```bash
sudo kubeadm certs renew all
sudo systemctl restart kubelet
```

#### 검증

```bash
# 검증 1: 갱신 후 만료일 변경 확인
sudo kubeadm certs check-expiration
# 예상 출력:
# CERTIFICATE                EXPIRES                  RESIDUAL TIME   ...   EXTERNALLY MANAGED
# admin.conf                 Mar 30, 2027 10:00 UTC   364d            ...   no
# apiserver                  Mar 30, 2027 10:00 UTC   364d            ...   no
# ...
# RESIDUAL TIME이 갱신 후 약 1년으로 표시되어야 한다

# 검증 2: API 서버 정상 동작 확인
kubectl get nodes
# 인증서 갱신 후 API 호출이 정상이면 갱신이 성공한 것이다
```

</details>

---

#### 문제 3. Static Pod 생성

`worker-1` 노드에 이름이 `static-web`인 Static Pod를 생성하라. 이미지는 `nginx:1.25`이다.

<details>
<summary>풀이</summary>

```bash
# 1. worker-1에 SSH 접속
ssh worker-1

# 2. kubelet의 staticPodPath 확인
cat /var/lib/kubelet/config.yaml | grep staticPodPath
# staticPodPath: /etc/kubernetes/manifests

# 3. Static Pod 매니페스트 작성
cat <<EOF > /etc/kubernetes/manifests/static-web.yaml
apiVersion: v1
kind: Pod
metadata:
  name: static-web
spec:
  containers:
  - name: web
    image: nginx:1.25
    ports:
    - containerPort: 80
EOF
```

Static Pod는 kubelet이 직접 관리하며, API 서버를 통해 삭제할 수 없다. 매니페스트 파일을 삭제해야 Pod가 제거된다.

#### 검증

```bash
# 검증 1: Control Plane에서 Static Pod 확인
kubectl get pods -A | grep static-web
# 예상 출력:
# default       static-web-worker-1       1/1     Running   0          10s
# Pod 이름이 "static-web-worker-1" 형태이다 (노드명이 접미사로 붙는다)

# 검증 2: Static Pod는 API를 통한 삭제가 불가능함을 확인
kubectl delete pod static-web-worker-1
# Pod가 삭제되어도 kubelet이 즉시 재생성한다
kubectl get pods | grep static-web
# 예상 출력: static-web-worker-1이 다시 Running 상태이다

# 검증 3: 매니페스트 파일 삭제로 Static Pod 제거 (worker-1에서)
ssh worker-1
rm /etc/kubernetes/manifests/static-web.yaml
exit
kubectl get pods | grep static-web
# 예상 출력: (없음 -- Pod가 완전히 제거되었다)
```

</details>

---

#### 문제 4. RBAC ClusterRole과 Role의 차이

다음 상황에서 Role과 ClusterRole 중 무엇을 사용해야 하는지 답하라:
- (A) 특정 네임스페이스의 Deployment를 관리
- (B) 모든 네임스페이스의 Node를 조회
- (C) PersistentVolume을 생성

<details>
<summary>풀이</summary>

- **(A) Role** -- 특정 네임스페이스에 한정된 권한이므로 Role + RoleBinding을 사용한다.
- **(B) ClusterRole + ClusterRoleBinding** -- Node는 네임스페이스에 속하지 않는 클러스터 범위(cluster-scoped) 리소스이다.
- **(C) ClusterRole + ClusterRoleBinding** -- PersistentVolume도 클러스터 범위 리소스이다.

#### 검증

```bash
# 검증: 클러스터 범위 리소스 확인
kubectl api-resources --namespaced=false
# 예상 출력 (일부):
# NAME                  SHORTNAMES   APIVERSION   NAMESPACED   KIND
# nodes                 no           v1           false        Node
# persistentvolumes     pv           v1           false        PersistentVolume
# clusterroles                       rbac...      false        ClusterRole
# clusterrolebindings                rbac...      false        ClusterRoleBinding

# 검증: 네임스페이스 범위 리소스 확인
kubectl api-resources --namespaced=true
# 예상 출력 (일부):
# NAME         SHORTNAMES   APIVERSION   NAMESPACED   KIND
# pods         po           v1           true         Pod
# deployments  deploy       apps/v1      true         Deployment
# services     svc          v1           true         Service
```

</details>

---

#### 문제 5. ServiceAccount에 토큰 마운트 비활성화

Pod가 API 서버에 접근하지 못하도록 ServiceAccount 토큰 자동 마운트를 비활성화하는 Pod YAML을 작성하라.

<details>
<summary>풀이</summary>

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: no-token-pod
spec:
  automountServiceAccountToken: false
  containers:
  - name: app
    image: nginx:1.25
```

또는 ServiceAccount 자체에서 비활성화할 수도 있다:

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: no-auto-mount-sa
automountServiceAccountToken: false
```

#### 검증

```bash
# 적용
kubectl apply -f no-token-pod.yaml

# 검증 1: Pod 생성 확인
kubectl get pod no-token-pod
# 예상 출력:
# NAME            READY   STATUS    RESTARTS   AGE
# no-token-pod    1/1     Running   0          5s

# 검증 2: 토큰 디렉토리 부재 확인
kubectl exec no-token-pod -- ls /var/run/secrets/kubernetes.io/serviceaccount/
# 예상 출력:
# ls: /var/run/secrets/kubernetes.io/serviceaccount/: No such file or directory
# 토큰 디렉토리가 존재하지 않아야 한다

# 검증 3: API 서버 접근 불가 확인
kubectl exec no-token-pod -- sh -c 'curl -s -k https://kubernetes.default.svc/api/v1/namespaces'
# 예상 출력:
# curl: (6) Could not resolve host: kubernetes.default.svc
# 또는 인증 오류가 발생한다. 토큰이 없으므로 API 접근이 불가능하다.
```

</details>

---

#### 문제 6. kube-apiserver에 Admission Controller 확인

현재 kube-apiserver에 활성화된 Admission Controller 목록을 확인하는 방법을 작성하라.

<details>
<summary>풀이</summary>

```bash
# 방법 1: kube-apiserver 매니페스트에서 확인
cat /etc/kubernetes/manifests/kube-apiserver.yaml | grep enable-admission-plugins

# 방법 2: 실행 중인 프로세스에서 확인
ps aux | grep kube-apiserver | grep admission-plugins

# 방법 3: kubectl로 Pod 정보에서 확인
kubectl -n kube-system describe pod kube-apiserver-controlplane | grep admission
```

주요 Admission Controller:
- `NamespaceLifecycle`: 삭제 중인 네임스페이스에 새 리소스 생성을 방지한다.
- `NodeRestriction`: kubelet이 자신의 Node/Pod만 수정하도록 제한한다.
- `PodSecurity`: PSA(Pod Security Admission)를 적용한다.

#### 검증

```bash
# 검증: Admission Controller가 실제로 동작하는지 확인
# 존재하지 않는 네임스페이스에 리소스 생성 시도 (NamespaceLifecycle 확인)
kubectl run test --image=nginx:1.25 -n nonexistent-ns
# 예상 출력:
# Error from server (NotFound): namespaces "nonexistent-ns" not found
# NamespaceLifecycle Admission Controller가 동작하고 있는 것이다
```

</details>

---

#### 문제 7. kubeconfig 파일 구조

현재 kubeconfig에 정의된 모든 context를 나열하고, 특정 context로 전환하는 명령어를 작성하라.

<details>
<summary>풀이</summary>

```bash
# 모든 context 나열
kubectl config get-contexts

# 현재 context 확인
kubectl config current-context

# context 전환
kubectl config use-context k8s-cluster2

# kubeconfig 파일 직접 확인
kubectl config view
# 또는
cat ~/.kube/config
```

kubeconfig는 세 가지 섹션으로 구성된다:
1. **clusters**: API 서버 주소와 CA 인증서
2. **users**: 인증 정보 (인증서, 토큰 등)
3. **contexts**: cluster + user 조합

#### 검증

```bash
# 검증 1: context 목록 확인
kubectl config get-contexts
# 예상 출력:
# CURRENT   NAME            CLUSTER         AUTHINFO        NAMESPACE
# *         k8s-cluster1    k8s-cluster1    k8s-admin       default
#           k8s-cluster2    k8s-cluster2    k8s-admin       default

# 검증 2: context 전환 후 확인
kubectl config use-context k8s-cluster2
# 예상 출력:
# Switched to context "k8s-cluster2".

kubectl config current-context
# 예상 출력:
# k8s-cluster2
```

</details>

---

#### 문제 8. etcd 클러스터 멤버 목록 확인

etcd 클러스터의 멤버 목록을 확인하는 명령어를 작성하라.

<details>
<summary>풀이</summary>

```bash
ETCDCTL_API=3 etcdctl member list \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key

# 테이블 형식으로 출력
ETCDCTL_API=3 etcdctl member list \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key \
  --write-out=table
```

#### 검증

```bash
# 검증 1: 멤버 목록 확인
# 예상 출력 (테이블 형식):
# +------------------+---------+-------+----------------------------+----------------------------+------------+
# |        ID        | STATUS  | NAME  |         PEER ADDRS         |        CLIENT ADDRS        | IS LEARNER |
# +------------------+---------+-------+----------------------------+----------------------------+------------+
# | 8e9e05c52164694d | started | etcd  | https://192.168.1.10:2380  | https://192.168.1.10:2379  | false      |
# +------------------+---------+-------+----------------------------+----------------------------+------------+

# 검증 2: etcd 엔드포인트 상태 확인
ETCDCTL_API=3 etcdctl endpoint health \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key
# 예상 출력:
# https://127.0.0.1:2379 is healthy: successfully committed proposal: took = 2.5ms
```

</details>

---

### Workloads & Scheduling (5문항)

#### 문제 9. nodeSelector를 사용한 Pod 스케줄링

`disk=ssd` 레이블이 있는 노드에만 Pod를 배치하는 YAML을 작성하라.

<details>
<summary>풀이</summary>

```bash
# 노드에 레이블 부여
kubectl label node worker-1 disk=ssd
```

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: ssd-pod
spec:
  nodeSelector:
    disk: ssd
  containers:
  - name: app
    image: nginx:1.25
```

#### 검증

```bash
# 적용
kubectl apply -f ssd-pod.yaml

# 검증 1: 노드 레이블 확인
kubectl get nodes -l disk=ssd
# 예상 출력:
# NAME       STATUS   ROLES    AGE   VERSION
# worker-1   Ready    <none>   30d   v1.30.0

# 검증 2: Pod가 올바른 노드에 배치되었는지 확인
kubectl get pod ssd-pod -o wide
# 예상 출력:
# NAME      READY   STATUS    RESTARTS   AGE   IP           NODE       ...
# ssd-pod   1/1     Running   0          10s   10.244.1.5   worker-1   ...
# NODE 컬럼이 worker-1(disk=ssd 레이블이 있는 노드)이어야 한다

# 검증 3: disk=ssd 레이블이 없는 노드에는 배치되지 않음을 확인
kubectl get nodes --show-labels | grep disk
# disk=ssd가 없는 노드에 Pod가 배치되지 않았는지 확인한다
```

</details>

---

#### 문제 10. Taint와 Toleration

`worker-2` 노드에 `env=production:NoSchedule` taint를 추가하고, 이를 tolerate하는 Pod를 작성하라.

<details>
<summary>풀이</summary>

```bash
# Taint 추가
kubectl taint nodes worker-2 env=production:NoSchedule

# Taint 확인
kubectl describe node worker-2 | grep Taints
```

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: prod-pod
spec:
  tolerations:
  - key: "env"
    operator: "Equal"
    value: "production"
    effect: "NoSchedule"
  containers:
  - name: app
    image: nginx:1.25
```

#### 검증

```bash
# 적용
kubectl apply -f prod-pod.yaml

# 검증 1: Taint가 설정되었는지 확인
kubectl describe node worker-2 | grep Taints
# 예상 출력:
# Taints:             env=production:NoSchedule

# 검증 2: Toleration 없는 Pod가 해당 노드에 스케줄링되지 않음을 확인
kubectl run no-toleration --image=nginx:1.25
kubectl get pod no-toleration -o wide
# NODE 컬럼이 worker-2가 아니어야 한다

# 검증 3: Toleration 있는 Pod는 스케줄링 가능
kubectl get pod prod-pod -o wide
# NODE 컬럼에 worker-2가 표시될 수 있다 (스케줄러 판단에 따라)

# Taint 제거 (키 뒤에 - 붙임)
kubectl taint nodes worker-2 env=production:NoSchedule-
# 예상 출력:
# node/worker-2 untainted
```

</details>

---

#### 문제 11. Pod에 Init Container 추가

Pod `myapp`에 Init Container를 추가하라. Init Container는 `/work-dir/index.html` 파일에 "Hello Init"을 작성하고, 앱 컨테이너(nginx)가 이 파일을 서빙해야 한다.

<details>
<summary>풀이</summary>

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: myapp
spec:
  initContainers:
  - name: init-writer
    image: busybox:1.36
    command:
    - sh
    - -c
    - echo "Hello Init" > /work-dir/index.html
    volumeMounts:
    - name: workdir
      mountPath: /work-dir
  containers:
  - name: nginx
    image: nginx:1.25
    volumeMounts:
    - name: workdir
      mountPath: /usr/share/nginx/html
  volumes:
  - name: workdir
    emptyDir: {}
```

#### 검증

```bash
# 적용
kubectl apply -f myapp.yaml

# 검증 1: Pod 상태 확인 (Init Container 완료 후 Running)
kubectl get pod myapp
# 예상 출력:
# NAME    READY   STATUS    RESTARTS   AGE
# myapp   1/1     Running   0          10s

# 검증 2: Init Container가 생성한 파일 확인
kubectl exec myapp -- cat /usr/share/nginx/html/index.html
# 예상 출력:
# Hello Init

# 검증 3: nginx가 파일을 서빙하는지 확인
kubectl exec myapp -- curl -s localhost
# 예상 출력:
# Hello Init

# 검증 4: Init Container 상태 확인
kubectl describe pod myapp | grep -A 5 "Init Containers"
# 예상 출력:
# Init Containers:
#   init-writer:
#     ...
#     State:          Terminated
#       Reason:       Completed
#       Exit Code:    0
```

</details>

---

#### 문제 12. PodDisruptionBudget 생성

`app=web` 레이블을 가진 Pod에 대해 최소 2개가 항상 가용하도록 PDB를 생성하라.

<details>
<summary>풀이</summary>

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: web-pdb
spec:
  minAvailable: 2
  selector:
    matchLabels:
      app: web
```

또는 `maxUnavailable`을 사용할 수도 있다:

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: web-pdb
spec:
  maxUnavailable: 1
  selector:
    matchLabels:
      app: web
```

#### 검증

```bash
# 적용
kubectl apply -f web-pdb.yaml

# 검증 1: PDB 상태 확인
kubectl get pdb web-pdb
# 예상 출력:
# NAME      MIN AVAILABLE   MAX UNAVAILABLE   ALLOWED DISRUPTIONS   AGE
# web-pdb   2               N/A               1                     10s
# ALLOWED DISRUPTIONS가 현재 레플리카 수에서 minAvailable을 뺀 값이다

# 검증 2: PDB 상세 정보 확인
kubectl describe pdb web-pdb
# 예상 출력:
# Min Available:    2
# Selector:         app=web
# Status:
#   Current Healthy:    3
#   Desired Healthy:    2
#   Disruptions Allowed: 1

# 검증 3: drain 시 PDB 존중 확인
# 3개의 web Pod가 있고 minAvailable=2일 때, drain은 한 번에 1개씩만 축출한다
kubectl drain worker-1 --ignore-daemonsets
# PDB가 위반되면 다음 메시지가 표시된다:
# error when evicting pods/xxx: Cannot evict pod as it would violate the pod's disruption budget
```

</details>

---

#### 문제 13. SecurityContext로 non-root 실행

UID 1000, GID 3000으로 실행되고, 권한 상승이 불가능한 Pod를 작성하라.

<details>
<summary>풀이</summary>

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: nonroot-pod
spec:
  securityContext:
    runAsUser: 1000
    runAsGroup: 3000
    runAsNonRoot: true
  containers:
  - name: app
    image: busybox:1.36
    command: ["sh", "-c", "sleep 3600"]
    securityContext:
      allowPrivilegeEscalation: false
      capabilities:
        drop:
        - ALL
```

#### 검증

```bash
# 적용
kubectl apply -f nonroot-pod.yaml

# 검증 1: Pod Running 확인
kubectl get pod nonroot-pod
# 예상 출력:
# NAME          READY   STATUS    RESTARTS   AGE
# nonroot-pod   1/1     Running   0          5s

# 검증 2: UID/GID 확인
kubectl exec nonroot-pod -- id
# 예상 출력:
# uid=1000 gid=3000 groups=3000

# 검증 3: root로 실행 불가 확인
kubectl exec nonroot-pod -- whoami
# 예상 출력:
# whoami: unknown uid 1000
# (또는 /etc/passwd에 해당 UID가 없으므로 오류가 발생할 수 있다)

# 검증 4: 권한 상승 불가 확인 (su 명령 불가)
kubectl exec nonroot-pod -- su -
# 예상 출력:
# su: must be suid to work properly
# allowPrivilegeEscalation: false가 적용되어 있다
```

</details>

---

### Services & Networking (7문항)

#### 문제 14. ClusterIP / NodePort / LoadBalancer 차이

각 Service 유형의 접근 범위를 설명하라.

<details>
<summary>풀이</summary>

| 유형 | 접근 범위 | 포트 |
|---|---|---|
| **ClusterIP** | 클러스터 **내부**에서만 접근 가능하다. | Service에 할당된 가상 IP |
| **NodePort** | 클러스터 **외부**에서 `<NodeIP>:<NodePort>`로 접근 가능하다. | 30000-32767 범위 |
| **LoadBalancer** | 클라우드 프로바이더의 **외부 로드밸런서**를 통해 접근 가능하다. | 프로바이더가 할당 |

```bash
# ClusterIP Service 생성
kubectl expose deployment myapp --port=80 --target-port=8080 --type=ClusterIP

# NodePort Service 생성
kubectl expose deployment myapp --port=80 --target-port=8080 --type=NodePort

# 특정 NodePort 지정
kubectl expose deployment myapp --port=80 --target-port=8080 --type=NodePort --overrides='{"spec":{"ports":[{"port":80,"targetPort":8080,"nodePort":30080}]}}'
```

#### 검증

```bash
# 검증 1: ClusterIP Service 확인
kubectl get svc myapp-clusterip
# 예상 출력:
# NAME              TYPE        CLUSTER-IP    EXTERNAL-IP   PORT(S)   AGE
# myapp-clusterip   ClusterIP   10.96.0.100   <none>        80/TCP    5s

# 검증 2: 클러스터 내부에서 접근
kubectl run test --rm -it --image=busybox -- wget -qO- http://10.96.0.100
# 예상 출력: (앱의 응답)

# 검증 3: NodePort Service 확인
kubectl get svc myapp-nodeport
# 예상 출력:
# NAME             TYPE       CLUSTER-IP    EXTERNAL-IP   PORT(S)        AGE
# myapp-nodeport   NodePort   10.96.0.101   <none>        80:30080/TCP   5s
# 클러스터 외부에서 <NodeIP>:30080으로 접근 가능하다
```

</details>

---

#### 문제 15. DNS 이름 규칙

다음 리소스의 클러스터 내 DNS 이름을 작성하라:
- `default` 네임스페이스의 `web-svc` Service
- `prod` 네임스페이스의 `api-svc` Service
- StatefulSet `db`의 첫 번째 Pod (서비스명: `db-headless`, 네임스페이스: `prod`)

<details>
<summary>풀이</summary>

```
# Service DNS 이름 형식: <service>.<namespace>.svc.cluster.local

# default 네임스페이스의 web-svc
web-svc.default.svc.cluster.local

# prod 네임스페이스의 api-svc
api-svc.prod.svc.cluster.local

# StatefulSet Pod DNS 형식: <pod-name>.<service>.<namespace>.svc.cluster.local
db-0.db-headless.prod.svc.cluster.local
```

같은 네임스페이스 내에서는 짧은 이름(예: `web-svc`)만으로도 접근 가능하다.

#### 검증

```bash
# 검증 1: Service DNS 해석 확인
kubectl run dns-test --rm -it --image=busybox:1.36 -- nslookup web-svc.default.svc.cluster.local
# 예상 출력:
# Server:    10.96.0.10
# Address 1: 10.96.0.10 kube-dns.kube-system.svc.cluster.local
# Name:      web-svc.default.svc.cluster.local
# Address 1: 10.96.0.100

# 검증 2: StatefulSet Pod DNS 해석 확인
kubectl run dns-test --rm -it --image=busybox:1.36 -- nslookup db-0.db-headless.prod.svc.cluster.local
# 예상 출력:
# Name:      db-0.db-headless.prod.svc.cluster.local
# Address 1: 10.244.2.5 db-0.db-headless.prod.svc.cluster.local

# 검증 3: 짧은 이름으로 접근 (같은 네임스페이스 내)
kubectl run dns-test --rm -it --image=busybox:1.36 -- nslookup web-svc
# 예상 출력:
# Name:      web-svc
# Address 1: 10.96.0.100 web-svc.default.svc.cluster.local
```

</details>

---

#### 문제 16. NetworkPolicy -- 모든 Ingress 트래픽 차단

`secure` 네임스페이스의 모든 Pod에 대해 모든 인바운드 트래픽을 차단하는 NetworkPolicy를 작성하라.

<details>
<summary>풀이</summary>

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: deny-all-ingress
  namespace: secure
spec:
  podSelector: {}       # 모든 Pod에 적용
  policyTypes:
  - Ingress
  # ingress 필드를 비우면 모든 인바운드 차단
```

`policyTypes`에 `Ingress`를 명시하고 `ingress` 규칙을 비워두면 모든 인바운드 트래픽이 차단된다. Egress는 영향받지 않는다.

#### 검증

```bash
# 적용
kubectl apply -f deny-all-ingress.yaml

# 검증 1: NetworkPolicy 생성 확인
kubectl get networkpolicy -n secure
# 예상 출력:
# NAME                POD-SELECTOR   AGE
# deny-all-ingress    <none>         5s

# 검증 2: secure 네임스페이스 내 Pod 간 통신도 차단됨을 확인
kubectl run test-target --image=nginx:1.25 -n secure --port=80
kubectl run test-source --rm -it --image=busybox -n secure -- wget -qO- --timeout=3 http://test-target
# 예상 출력:
# wget: download timed out
# 같은 네임스페이스 내에서도 Ingress가 차단된다

# 검증 3: Egress는 영향받지 않음을 확인
kubectl exec test-target -n secure -- wget -qO- --timeout=3 http://kubernetes.default.svc
# 예상 출력: (API 서버 응답) -- Egress는 차단되지 않는다

# 검증 4: NetworkPolicy 상세 확인
kubectl describe networkpolicy deny-all-ingress -n secure
# 예상 출력:
# Spec:
#   PodSelector:     <none> (Allowing the specific traffic to all pods in this namespace)
#   Allowing ingress traffic:
#     <none> (Selected pods are isolated for ingress connectivity)
#   Not affecting egress traffic
```

</details>

---

#### 문제 17. NetworkPolicy -- Egress 제한

`app=frontend` Pod가 DNS(UDP 53) 트래픽과 `app=backend` Pod의 8080 포트로만 통신할 수 있도록 제한하라.

<details>
<summary>풀이</summary>

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: frontend-egress
  namespace: default
spec:
  podSelector:
    matchLabels:
      app: frontend
  policyTypes:
  - Egress
  egress:
  - to:                         # DNS 허용
    - namespaceSelector: {}     # 모든 네임스페이스
    ports:
    - protocol: UDP
      port: 53
    - protocol: TCP
      port: 53
  - to:                         # backend Pod 허용
    - podSelector:
        matchLabels:
          app: backend
    ports:
    - protocol: TCP
      port: 8080
```

#### 검증

```bash
# 적용
kubectl apply -f frontend-egress.yaml

# 검증 1: NetworkPolicy 생성 확인
kubectl describe networkpolicy frontend-egress
# 예상 출력:
# Spec:
#   PodSelector:     app=frontend
#   Allowing egress traffic:
#     To Port: 53/UDP, 53/TCP
#     To: NamespaceSelector: <none>
#     ----------
#     To Port: 8080/TCP
#     To: PodSelector: app=backend

# 검증 2: DNS 해석 가능 확인 (허용됨)
kubectl exec frontend-pod -- nslookup backend-svc
# 예상 출력: (정상 해석)

# 검증 3: backend Pod 8080 포트 접근 가능 확인 (허용됨)
kubectl exec frontend-pod -- wget -qO- --timeout=3 http://backend-svc:8080
# 예상 출력: (backend 응답)

# 검증 4: 다른 서비스 접근 차단 확인 (금지됨)
kubectl exec frontend-pod -- wget -qO- --timeout=3 http://other-svc:80
# 예상 출력:
# wget: download timed out
# Egress 정책에 의해 차단된다
```

</details>

---

#### 문제 18. Ingress 경로 기반 라우팅

하나의 Ingress에서 `/api`는 `api-svc:8080`으로, `/web`은 `web-svc:80`으로 라우팅하라.

<details>
<summary>풀이</summary>

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: path-ingress
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

#### 검증

```bash
# 적용
kubectl apply -f path-ingress.yaml

# 검증 1: Ingress 생성 확인
kubectl get ingress path-ingress
# 예상 출력:
# NAME           CLASS   HOSTS               ADDRESS      PORTS   AGE
# path-ingress   nginx   myapp.example.com   10.96.x.x   80      5s

# 검증 2: 경로 라우팅 규칙 확인
kubectl describe ingress path-ingress
# 예상 출력:
# Rules:
#   Host               Path  Backends
#   ----               ----  --------
#   myapp.example.com
#                      /api   api-svc:8080
#                      /web   web-svc:80

# 검증 3: 접근 테스트
# /api 경로 -> api-svc:8080으로 라우팅
curl -H "Host: myapp.example.com" http://<ingress-ip>/api
# /web 경로 -> web-svc:80으로 라우팅
curl -H "Host: myapp.example.com" http://<ingress-ip>/web
```

</details>

---

#### 문제 19. CoreDNS 트러블슈팅

클러스터 내 DNS 해석이 실패할 때 확인해야 할 항목을 나열하라.

<details>
<summary>풀이</summary>

```bash
# 1. CoreDNS Pod 상태 확인
kubectl get pods -n kube-system -l k8s-app=kube-dns

# 2. CoreDNS 로그 확인
kubectl logs -n kube-system -l k8s-app=kube-dns

# 3. kube-dns Service 확인
kubectl get svc kube-dns -n kube-system
# ClusterIP가 정상인지, Endpoints가 있는지 확인

kubectl get endpoints kube-dns -n kube-system

# 4. CoreDNS ConfigMap 확인
kubectl get configmap coredns -n kube-system -o yaml

# 5. Pod의 DNS 설정 확인
kubectl exec <pod-name> -- cat /etc/resolv.conf
# nameserver가 kube-dns의 ClusterIP여야 한다

# 6. DNS 해석 테스트
kubectl run dns-debug --rm -it --image=busybox:1.36 -- nslookup kubernetes.default.svc.cluster.local
```

흔한 원인:
- CoreDNS Pod가 CrashLoopBackOff 상태
- CoreDNS ConfigMap의 Corefile에 오류가 있음
- kube-dns Service의 Endpoints가 비어 있음
- Pod의 `dnsPolicy`가 잘못 설정되어 있음

#### 검증

```bash
# 검증 1: CoreDNS Pod 상태 확인
kubectl get pods -n kube-system -l k8s-app=kube-dns
# 예상 출력 (정상):
# NAME                       READY   STATUS    RESTARTS   AGE
# coredns-xxx-yyy            1/1     Running   0          30d
# coredns-xxx-zzz            1/1     Running   0          30d

# 검증 2: kube-dns Endpoints 확인
kubectl get endpoints kube-dns -n kube-system
# 예상 출력 (정상):
# NAME       ENDPOINTS                         AGE
# kube-dns   10.244.0.2:53,10.244.0.3:53,...   30d
# Endpoints가 비어 있으면 CoreDNS Pod가 Ready가 아닌 것이다

# 검증 3: DNS 해석 테스트
kubectl run dns-debug --rm -it --image=busybox:1.36 -- nslookup kubernetes.default.svc.cluster.local
# 예상 출력 (정상):
# Server:    10.96.0.10
# Address 1: 10.96.0.10 kube-dns.kube-system.svc.cluster.local
# Name:      kubernetes.default.svc.cluster.local
# Address 1: 10.96.0.1 kubernetes.default.svc.cluster.local

# 검증 4: 해석 실패 시 출력
# 예상 출력 (실패):
# ;; connection timed out; no servers could be reached
# 이 경우 CoreDNS Pod 또는 kube-dns Service를 확인해야 한다
```

</details>

---

#### 문제 20. Service의 Endpoints 수동 확인

`web-svc` Service의 백엔드 Pod Endpoints를 확인하고, Endpoints가 비어 있을 때의 원인을 진단하라.

<details>
<summary>풀이</summary>

```bash
# Endpoints 확인
kubectl get endpoints web-svc
kubectl describe endpoints web-svc

# Service의 selector 확인
kubectl get svc web-svc -o jsonpath='{.spec.selector}'

# selector에 매칭되는 Pod 확인
kubectl get pods -l app=web

# Pod가 있지만 Endpoints에 없는 경우 -> Pod가 Ready가 아닐 수 있음
kubectl get pods -l app=web -o wide
kubectl describe pod <pod-name>  # readinessProbe 확인
```

Endpoints가 비어 있는 흔한 원인:
1. Service의 `selector` 레이블이 Pod의 레이블과 일치하지 않음
2. Pod가 `Ready` 상태가 아님 (readinessProbe 실패)
3. Pod의 `targetPort`와 컨테이너의 실제 포트가 불일치
4. Pod가 아직 생성되지 않음

#### 검증

```bash
# 검증 1: Endpoints 정상 확인
kubectl get endpoints web-svc
# 예상 출력 (정상):
# NAME      ENDPOINTS                                AGE
# web-svc   10.244.1.5:80,10.244.2.6:80              5m

# 예상 출력 (비정상):
# NAME      ENDPOINTS   AGE
# web-svc   <none>      5m
# Endpoints가 <none>이면 selector 일치 또는 Pod Ready 상태를 확인한다

# 검증 2: Service selector와 Pod 레이블 비교
kubectl get svc web-svc -o jsonpath='{.spec.selector}' && echo
# 예상 출력: {"app":"web"}
kubectl get pods --show-labels | grep web
# Pod의 레이블이 {"app":"web"}과 일치하는지 확인한다

# 검증 3: Pod Ready 상태 확인
kubectl get pods -l app=web
# READY 컬럼이 1/1이 아닌 0/1이면 readinessProbe 실패이다
# kubectl describe pod <pod-name>에서 Readiness 이벤트를 확인한다
```

</details>

---

### Storage (4문항)

#### 문제 21. StorageClass와 동적 프로비저닝

`WaitForFirstConsumer` 바인딩 모드를 사용하는 StorageClass를 생성하라.

<details>
<summary>풀이</summary>

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: delayed-binding
provisioner: kubernetes.io/no-provisioner
volumeBindingMode: WaitForFirstConsumer
```

| 바인딩 모드 | 동작 |
|---|---|
| `Immediate` | PVC 생성 즉시 PV에 바인딩된다. |
| `WaitForFirstConsumer` | PVC를 사용하는 Pod가 스케줄링될 때까지 바인딩을 지연한다. 노드 어피니티를 고려할 수 있다. |

#### 검증

```bash
# 적용
kubectl apply -f delayed-binding-sc.yaml

# 검증 1: StorageClass 생성 확인
kubectl get sc delayed-binding
# 예상 출력:
# NAME              PROVISIONER                    RECLAIMPOLICY   VOLUMEBINDINGMODE      ALLOWVOLUMEEXPANSION   AGE
# delayed-binding   kubernetes.io/no-provisioner   Delete          WaitForFirstConsumer   false                  5s

# 검증 2: WaitForFirstConsumer 동작 확인
# PVC 생성
kubectl apply -f - <<EOF
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: test-delayed-pvc
spec:
  accessModes: ["ReadWriteOnce"]
  storageClassName: delayed-binding
  resources:
    requests:
      storage: 1Gi
EOF

kubectl get pvc test-delayed-pvc
# 예상 출력:
# NAME               STATUS    VOLUME   CAPACITY   ACCESS MODES   STORAGECLASS      AGE
# test-delayed-pvc   Pending                                      delayed-binding   5s
# STATUS가 Pending이다 -- Pod가 사용하기 전까지 바인딩되지 않는다
```

</details>

---

#### 문제 22. PVC 용량 확장

기존 PVC `data-pvc`의 용량을 5Gi에서 10Gi로 확장하라.

<details>
<summary>풀이</summary>

```bash
# 1. StorageClass에서 allowVolumeExpansion 확인
kubectl get sc <storageclass-name> -o jsonpath='{.allowVolumeExpansion}'
# true여야 확장 가능

# 2. PVC 편집
kubectl edit pvc data-pvc
# spec.resources.requests.storage를 10Gi로 변경
```

또는 patch 명령:
```bash
kubectl patch pvc data-pvc -p '{"spec":{"resources":{"requests":{"storage":"10Gi"}}}}'
```

StorageClass에 `allowVolumeExpansion: true`가 설정되어 있어야 한다:
```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: expandable-sc
provisioner: kubernetes.io/aws-ebs
allowVolumeExpansion: true
```

#### 검증

```bash
# 검증 1: PVC 용량 확인
kubectl get pvc data-pvc
# 예상 출력 (확장 완료):
# NAME       STATUS   VOLUME    CAPACITY   ACCESS MODES   STORAGECLASS   AGE
# data-pvc   Bound    pv-xxx    10Gi       RWO            expandable-sc  10m

# 검증 2: 파일시스템 리사이즈 상태 확인
kubectl get pvc data-pvc -o jsonpath='{.status.conditions}'
# FileSystemResizePending이 나타나면 Pod 재시작이 필요하다
# 예상 출력 (리사이즈 필요):
# [{"type":"FileSystemResizePending","status":"True",...}]

# 검증 3: Pod 재시작 후 실제 용량 확인
kubectl exec <pod-name> -- df -h /data
# 예상 출력:
# Filesystem      Size  Used  Avail  Use%  Mounted on
# /dev/sdb        10G   100M  9.9G   1%    /data
```

</details>

---

#### 문제 23. ConfigMap을 Volume으로 마운트

ConfigMap `app-config`의 내용을 Pod의 `/etc/config` 경로에 파일로 마운트하라.

<details>
<summary>풀이</summary>

```bash
# ConfigMap 생성
kubectl create configmap app-config \
  --from-literal=database_url=postgres://db:5432/myapp \
  --from-literal=log_level=info
```

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: config-pod
spec:
  containers:
  - name: app
    image: busybox:1.36
    command: ["sh", "-c", "cat /etc/config/database_url && sleep 3600"]
    volumeMounts:
    - name: config-volume
      mountPath: /etc/config
      readOnly: true
  volumes:
  - name: config-volume
    configMap:
      name: app-config
```

#### 검증

```bash
# 적용
kubectl apply -f config-pod.yaml

# 검증 1: Pod Running 확인
kubectl get pod config-pod
# 예상 출력:
# NAME         READY   STATUS    RESTARTS   AGE
# config-pod   1/1     Running   0          5s

# 검증 2: 각 키가 파일로 마운트되었는지 확인
kubectl exec config-pod -- ls /etc/config/
# 예상 출력:
# database_url
# log_level

# 검증 3: 파일 내용 확인
kubectl exec config-pod -- cat /etc/config/database_url
# 예상 출력:
# postgres://db:5432/myapp

kubectl exec config-pod -- cat /etc/config/log_level
# 예상 출력:
# info
```

</details>

---

#### 문제 24. Secret을 환경 변수로 주입

Secret `db-secret`의 `password` 키를 Pod의 환경 변수 `DB_PASSWORD`로 주입하라.

<details>
<summary>풀이</summary>

```bash
# Secret 생성
kubectl create secret generic db-secret --from-literal=password=myS3cretP@ss
```

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: secret-pod
spec:
  containers:
  - name: app
    image: busybox:1.36
    command: ["sh", "-c", "echo $DB_PASSWORD && sleep 3600"]
    env:
    - name: DB_PASSWORD
      valueFrom:
        secretKeyRef:
          name: db-secret
          key: password
```

#### 검증

```bash
# 적용
kubectl apply -f secret-pod.yaml

# 검증 1: Pod Running 확인
kubectl get pod secret-pod
# 예상 출력:
# NAME         READY   STATUS    RESTARTS   AGE
# secret-pod   1/1     Running   0          5s

# 검증 2: 환경 변수 주입 확인
kubectl exec secret-pod -- env | grep DB_PASSWORD
# 예상 출력:
# DB_PASSWORD=myS3cretP@ss

# 검증 3: Secret이 base64로 저장되어 있는지 확인
kubectl get secret db-secret -o jsonpath='{.data.password}'
# 예상 출력:
# bXlTM2NyZXRQQHNz
# (base64 인코딩된 값이다. echo 'bXlTM2NyZXRQQHNz' | base64 -d로 디코딩하면 myS3cretP@ss이다)
```

</details>

---

### Troubleshooting (6문항)

#### 문제 25. 노드 NotReady 상태 진단

노드가 `NotReady` 상태일 때 확인해야 할 항목과 복구 절차를 작성하라.

<details>
<summary>풀이</summary>

```bash
# 1. 노드 상태 확인
kubectl get nodes
kubectl describe node <node-name>
# Conditions 섹션에서 원인 확인 (MemoryPressure, DiskPressure, PIDPressure 등)

# 2. 해당 노드에 SSH 접속
ssh <node-name>

# 3. kubelet 상태 확인
sudo systemctl status kubelet
sudo journalctl -u kubelet -f --no-pager | tail -50

# 4. 컨테이너 런타임 상태 확인
sudo systemctl status containerd
# 또는
sudo systemctl status docker

# 5. 흔한 해결 방법
# kubelet이 중지된 경우
sudo systemctl start kubelet
sudo systemctl enable kubelet

# kubelet 설정 오류인 경우
sudo journalctl -u kubelet | grep error
# 설정 파일 확인: /var/lib/kubelet/config.yaml

# 인증서 만료인 경우
openssl x509 -in /var/lib/kubelet/pki/kubelet-client-current.pem -noout -enddate
```

#### 검증

```bash
# 검증 1: 복구 후 노드 상태 확인
kubectl get nodes
# 예상 출력:
# NAME           STATUS   ROLES           AGE   VERSION
# <node-name>    Ready    <none>          30d   v1.30.0
# STATUS가 Ready로 변경되어야 한다

# 검증 2: 노드의 Conditions 확인
kubectl describe node <node-name> | grep -A 10 Conditions
# 예상 출력:
# Conditions:
#   Type             Status  ...  Reason                       Message
#   ----             ------  ...  ------                       -------
#   MemoryPressure   False   ...  KubeletHasSufficientMemory   kubelet has sufficient memory available
#   DiskPressure     False   ...  KubeletHasNoDiskPressure     kubelet has no disk pressure
#   PIDPressure      False   ...  KubeletHasSufficientPID      kubelet has sufficient PID available
#   Ready            True    ...  KubeletReady                 kubelet is posting ready status

# 검증 3: 해당 노드에 Pod가 스케줄링되는지 확인
kubectl run test-schedule --image=nginx:1.25
kubectl get pod test-schedule -o wide
# NODE 컬럼에 해당 노드가 나타날 수 있다
```

</details>

---

#### 문제 26. kubectl로 클러스터 컴포넌트 상태 확인

Control Plane 컴포넌트들의 상태를 확인하는 방법을 작성하라.

<details>
<summary>풀이</summary>

```bash
# 1. Control Plane Pod 상태 확인
kubectl get pods -n kube-system

# 2. 각 컴포넌트 로그 확인
kubectl logs -n kube-system kube-apiserver-controlplane
kubectl logs -n kube-system kube-controller-manager-controlplane
kubectl logs -n kube-system kube-scheduler-controlplane
kubectl logs -n kube-system etcd-controlplane

# 3. 컴포넌트 상태 확인 (deprecated이지만 여전히 유용)
kubectl get componentstatuses
# 또는 줄여서
kubectl get cs

# 4. Static Pod 매니페스트 확인
ls /etc/kubernetes/manifests/
# etcd.yaml
# kube-apiserver.yaml
# kube-controller-manager.yaml
# kube-scheduler.yaml

# 5. systemd 서비스 확인 (노드에서)
sudo systemctl status kubelet
sudo systemctl status containerd
```

#### 검증

```bash
# 검증 1: Control Plane Pod 정상 확인
kubectl get pods -n kube-system
# 예상 출력:
# NAME                                   READY   STATUS    RESTARTS   AGE
# coredns-xxx-yyy                        1/1     Running   0          30d
# coredns-xxx-zzz                        1/1     Running   0          30d
# etcd-controlplane                      1/1     Running   0          30d
# kube-apiserver-controlplane            1/1     Running   0          30d
# kube-controller-manager-controlplane   1/1     Running   0          30d
# kube-proxy-xxxxx                       1/1     Running   0          30d
# kube-scheduler-controlplane            1/1     Running   0          30d
# 모든 Pod가 Running/1/1이어야 한다

# 검증 2: componentstatuses 확인
kubectl get cs
# 예상 출력:
# NAME                 STATUS    MESSAGE   ERROR
# controller-manager   Healthy   ok
# scheduler            Healthy   ok
# etcd-0               Healthy   ok
```

</details>

---

#### 문제 27. Pod가 Pending 상태인 원인 진단

Pod가 `Pending` 상태에서 벗어나지 못할 때의 확인 절차를 작성하라.

<details>
<summary>풀이</summary>

```bash
# 1. Pod 이벤트 확인
kubectl describe pod <pod-name>
# Events 섹션 확인
```

주요 원인별 메시지:

| 원인 | Events 메시지 |
|---|---|
| 리소스 부족 | `Insufficient cpu` / `Insufficient memory` |
| nodeSelector 불일치 | `didn't match Pod's node affinity/selector` |
| Taint 미허용 | `had taint {key=value:NoSchedule}, that the pod didn't tolerate` |
| PVC 미바인딩 | `persistentvolumeclaim "xxx" not found` 또는 `unbound immediate PersistentVolumeClaims` |
| 스케줄러 없음 | `no events` (스케줄러가 동작하지 않음) |

```bash
# 2. 노드 리소스 확인
kubectl describe nodes | grep -A 5 "Allocated resources"

# 3. PVC 상태 확인 (스토리지 관련)
kubectl get pvc

# 4. 스케줄러 로그 확인
kubectl logs -n kube-system kube-scheduler-controlplane
```

#### 검증

```bash
# 검증: 원인 해결 후 Pod 상태 확인
kubectl get pod <pod-name>
# 예상 출력 (해결 후):
# NAME         READY   STATUS    RESTARTS   AGE
# <pod-name>   1/1     Running   0          10s
# STATUS가 Pending에서 Running으로 변경되어야 한다

# 검증: 리소스 부족이 원인인 경우 노드 리소스 확인
kubectl describe nodes | grep -A 5 "Allocated resources"
# 예상 출력:
# Allocated resources:
#   (Total limits may be over 100 percent, i.e., overcommitted.)
#   Resource           Requests     Limits
#   --------           --------     ------
#   cpu                1500m (75%)  2000m (100%)
#   memory             1Gi (50%)    2Gi (100%)
# CPU/Memory Requests가 노드 용량에 근접하면 리소스 부족이다
```

</details>

---

#### 문제 28. 애플리케이션 로그 수집

멀티 컨테이너 Pod에서 특정 컨테이너의 로그를 확인하는 방법과 로그 필터링 방법을 작성하라.

<details>
<summary>풀이</summary>

```bash
# 특정 컨테이너 로그
kubectl logs <pod-name> -c <container-name>

# 이전 크래시의 로그
kubectl logs <pod-name> -c <container-name> --previous

# 실시간 로그 스트리밍
kubectl logs <pod-name> -c <container-name> -f

# 최근 N줄만 출력
kubectl logs <pod-name> --tail=100

# 최근 1시간의 로그만 출력
kubectl logs <pod-name> --since=1h

# 특정 시간 이후 로그
kubectl logs <pod-name> --since-time="2024-01-01T00:00:00Z"

# 레이블로 여러 Pod의 로그 동시 확인
kubectl logs -l app=web --all-containers=true

# 로그를 파일로 저장
kubectl logs <pod-name> > /opt/pod-logs.txt
```

#### 검증

```bash
# 검증 1: 멀티 컨테이너 Pod에서 컨테이너 목록 확인
kubectl get pod <pod-name> -o jsonpath='{.spec.containers[*].name}'
# 예상 출력:
# app sidecar

# 검증 2: 특정 컨테이너 로그 확인
kubectl logs <pod-name> -c sidecar --tail=5
# 예상 출력:
# 2026-03-30T10:00:00Z INFO Processing request...
# 2026-03-30T10:00:01Z INFO Request completed
# ...

# 검증 3: 로그 파일 저장 확인
kubectl logs <pod-name> > /opt/pod-logs.txt
cat /opt/pod-logs.txt | wc -l
# 예상 출력: (줄 수) -- 파일이 정상 생성되었다
```

</details>

---

#### 문제 29. kube-proxy 모드 확인 및 트러블슈팅

kube-proxy의 동작 모드를 확인하고, Service에 접근이 안 될 때의 진단 절차를 작성하라.

<details>
<summary>풀이</summary>

```bash
# 1. kube-proxy 모드 확인
kubectl get configmap kube-proxy -n kube-system -o yaml | grep mode
# mode: "iptables" 또는 mode: "ipvs"

# 2. kube-proxy 로그 확인
kubectl logs -n kube-system -l k8s-app=kube-proxy

# 3. kube-proxy DaemonSet 상태 확인
kubectl get daemonset kube-proxy -n kube-system

# 4. iptables 규칙 확인 (노드에서)
sudo iptables -t nat -L KUBE-SERVICES | grep <service-name>

# 5. Service와 Endpoints 확인
kubectl get svc <service-name>
kubectl get endpoints <service-name>
# Endpoints가 비어 있으면 -> selector 또는 Pod 상태 확인
```

#### 검증

```bash
# 검증 1: kube-proxy DaemonSet 정상 확인
kubectl get daemonset kube-proxy -n kube-system
# 예상 출력:
# NAME         DESIRED   CURRENT   READY   UP-TO-DATE   AVAILABLE   NODE SELECTOR   AGE
# kube-proxy   3         3         3       3            3           <none>          30d
# DESIRED, CURRENT, READY 값이 모두 동일해야 한다

# 검증 2: kube-proxy 모드 확인
kubectl get configmap kube-proxy -n kube-system -o yaml | grep mode
# 예상 출력:
# mode: "iptables"

# 검증 3: Service 접근 테스트
kubectl run test --rm -it --image=busybox -- wget -qO- --timeout=3 http://<service-cluster-ip>:<port>
# 예상 출력 (정상): (서비스 응답)
# 예상 출력 (실패): wget: download timed out
# 실패 시 Endpoints와 Pod 상태를 확인한다
```

</details>

---

#### 문제 30. kubelet 로그 분석

kubelet이 정상 동작하지 않을 때의 디버깅 절차를 작성하라.

<details>
<summary>풀이</summary>

```bash
# 1. kubelet 서비스 상태 확인
sudo systemctl status kubelet

# 2. kubelet 로그 확인 (최근 로그)
sudo journalctl -u kubelet --no-pager | tail -50

# 실시간 로그
sudo journalctl -u kubelet -f

# 오류만 필터링
sudo journalctl -u kubelet | grep -i error | tail -20

# 3. kubelet 설정 파일 확인
cat /var/lib/kubelet/config.yaml

# 4. kubelet 시작 옵션 확인
cat /etc/systemd/system/kubelet.service.d/10-kubeadm.conf

# 5. 흔한 문제와 해결
# 인증서 문제 -> 인증서 갱신
# 설정 파일 오류 -> config.yaml 수정
# 컨테이너 런타임 연결 실패 -> containerd 재시작
sudo systemctl restart containerd

# 6. kubelet 재시작
sudo systemctl daemon-reload
sudo systemctl restart kubelet
```

#### 검증

```bash
# 검증 1: kubelet 서비스 상태 확인
sudo systemctl status kubelet
# 예상 출력 (정상):
# ● kubelet.service - kubelet: The Kubernetes Node Agent
#      Loaded: loaded (/etc/systemd/system/kubelet.service; enabled; ...)
#      Active: active (running) since Mon 2026-03-30 10:00:00 UTC; 5s ago
# Active: active (running)이어야 한다

# 검증 2: 노드 상태 확인 (Control Plane에서)
kubectl get nodes
# 예상 출력:
# NAME           STATUS   ROLES    AGE   VERSION
# <node-name>    Ready    <none>   30d   v1.30.0
# kubelet 복구 후 STATUS가 Ready로 변경되어야 한다

# 검증 3: kubelet 로그에서 오류 없음 확인
sudo journalctl -u kubelet --no-pager | tail -10
# 예상 출력:
# Mar 30 10:00:05 node kubelet[1234]: I0330 10:00:05.123456   1234 server.go:xxx] ...
# ERROR 레벨의 로그가 없어야 정상이다
```

</details>

---

## Part 4: 기출 유형 덤프 문제 (20문항)

> 실제 CKA 시험은 2시간 동안 15~20문제를 풀어야 한다. 아래 문제는 실제 시험에서 자주 보고된 유형을 기반으로 작성되었다. 각 문제의 context 전환 명령을 반드시 먼저 실행해야 한다.

---

### Q1. etcd 스냅샷 저장

`kubectl config use-context k8s-etcd`

**문제:** etcd의 스냅샷을 `/opt/etcd-snapshot.db` 경로에 저장하라.

**조건:**
- etcd는 `https://127.0.0.1:2379`에서 실행 중이다.
- 인증서 파일 경로:
  - CA: `/etc/kubernetes/pki/etcd/ca.crt`
  - Cert: `/etc/kubernetes/pki/etcd/server.crt`
  - Key: `/etc/kubernetes/pki/etcd/server.key`

<details>
<summary>풀이</summary>

```bash
ETCDCTL_API=3 etcdctl snapshot save /opt/etcd-snapshot.db \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key
```

#### 검증

```bash
# 검증 1: 파일 존재 확인
ls -la /opt/etcd-snapshot.db
# 예상 출력:
# -rw------- 1 root root 20971552 ... /opt/etcd-snapshot.db

# 검증 2: 스냅샷 무결성 확인
ETCDCTL_API=3 etcdctl snapshot status /opt/etcd-snapshot.db --write-out=table
# 예상 출력:
# +----------+----------+------------+------------+
# |   HASH   | REVISION | TOTAL KEYS | TOTAL SIZE |
# +----------+----------+------------+------------+
# | 3e5a0c80 |    15234 |       1053 |    20 MB   |
# +----------+----------+------------+------------+
```

**핵심 포인트:** `ETCDCTL_API=3`을 반드시 지정해야 한다. 인증서 경로는 문제에서 제공되지만, 제공되지 않는 경우 `describe pod etcd-controlplane -n kube-system` 또는 `/etc/kubernetes/manifests/etcd.yaml`에서 확인한다.

</details>

---

### Q2. etcd 스냅샷 복원

`kubectl config use-context k8s-etcd`

**문제:** `/opt/etcd-snapshot-previous.db` 스냅샷을 사용하여 etcd를 복원하라.

**조건:**
- 복원 데이터 디렉토리: `/var/lib/etcd-restored`

<details>
<summary>풀이</summary>

```bash
# 1. 스냅샷 복원
ETCDCTL_API=3 etcdctl snapshot restore /opt/etcd-snapshot-previous.db \
  --data-dir=/var/lib/etcd-restored

# 2. etcd 매니페스트의 data-dir 수정
sudo vi /etc/kubernetes/manifests/etcd.yaml
```

etcd.yaml에서 수정할 부분:

spec.containers.command에서:
```yaml
    - --data-dir=/var/lib/etcd-restored
```

spec.volumes에서 hostPath 경로 변경:
```yaml
  volumes:
  - hostPath:
      path: /var/lib/etcd-restored
      type: DirectoryOrCreate
    name: etcd-data
```

```bash
# 3. etcd Pod 재시작 대기 (Static Pod이므로 자동)
watch kubectl get pods -n kube-system -l component=etcd
```

#### 검증

```bash
# 검증 1: etcd Pod Running 확인
kubectl get pods -n kube-system -l component=etcd
# 예상 출력:
# NAME                    READY   STATUS    RESTARTS   AGE
# etcd-controlplane       1/1     Running   0          30s

# 검증 2: 클러스터 상태 확인
kubectl get nodes
# 예상 출력:
# NAME           STATUS   ROLES           AGE   VERSION
# controlplane   Ready    control-plane   30d   v1.30.0

# 검증 3: 기존 리소스 복원 확인
kubectl get pods -A
kubectl get deployments -A
# 백업 시점의 리소스가 존재하는지 확인한다

# 검증 4: etcd 데이터 디렉토리 확인
ls /var/lib/etcd-restored/member/
# 예상 출력:
# snap  wal
```

**핵심 포인트:** `--data-dir`은 기존과 **다른** 경로를 사용해야 한다. 매니페스트에서 `--data-dir` 인자와 `hostPath` 볼륨 경로 **모두** 변경해야 한다.

</details>

---

### Q3. RBAC 생성 -- ServiceAccount 권한 부여

`kubectl config use-context k8s-rbac`

**문제:** 네임스페이스 `apps`에 ServiceAccount `deploy-sa`를 생성하고, 해당 네임스페이스에서 Deployment를 생성, 조회, 삭제할 수 있는 권한을 부여하라.

**조건:**
- Role 이름: `deploy-manager`
- RoleBinding 이름: `deploy-sa-binding`

<details>
<summary>풀이</summary>

```bash
# 1. 네임스페이스 생성 (없는 경우)
kubectl create namespace apps

# 2. ServiceAccount 생성
kubectl create serviceaccount deploy-sa -n apps

# 3. Role 생성
kubectl create role deploy-manager \
  --verb=create,get,list,delete \
  --resource=deployments \
  -n apps

# 4. RoleBinding 생성
kubectl create rolebinding deploy-sa-binding \
  --role=deploy-manager \
  --serviceaccount=apps:deploy-sa \
  -n apps
```

#### 검증

```bash
# 검증 1: ServiceAccount 생성 확인
kubectl get serviceaccount deploy-sa -n apps
# 예상 출력:
# NAME        SECRETS   AGE
# deploy-sa   0         5s

# 검증 2: Role 생성 확인
kubectl describe role deploy-manager -n apps
# 예상 출력:
# PolicyRule:
#   Resources    Non-Resource URLs  Resource Names  Verbs
#   ---------    -----------------  --------------  -----
#   deployments  []                 []              [create get list delete]

# 검증 3: 허용된 권한 확인
kubectl auth can-i create deployments -n apps --as=system:serviceaccount:apps:deploy-sa
# 예상 출력: yes

kubectl auth can-i get deployments -n apps --as=system:serviceaccount:apps:deploy-sa
# 예상 출력: yes

# 검증 4: 금지된 권한 확인
kubectl auth can-i delete pods -n apps --as=system:serviceaccount:apps:deploy-sa
# 예상 출력: no

kubectl auth can-i create deployments -n default --as=system:serviceaccount:apps:deploy-sa
# 예상 출력: no
```

**핵심 포인트:** `--serviceaccount` 형식은 `<namespace>:<name>`이다. `--user`와 혼동하지 않아야 한다.

</details>

---

### Q4. 인증서 갱신

`kubectl config use-context k8s-certs`

**문제:** Control Plane 노드 `controlplane`의 API 서버 인증서를 갱신하라.

**조건:**
- kubeadm을 사용하라.
- 갱신 후 API 서버가 정상 동작하는지 확인하라.

<details>
<summary>풀이</summary>

```bash
# 1. 현재 인증서 만료일 확인
sudo kubeadm certs check-expiration

# 2. API 서버 인증서 갱신
sudo kubeadm certs renew apiserver

# 3. 모든 인증서를 한 번에 갱신하려면:
# sudo kubeadm certs renew all

# 4. kube-apiserver 재시작 (Static Pod 매니페스트 수정으로 트리거)
# 방법 A: 매니페스트 파일을 임시로 이동했다가 복원
sudo mv /etc/kubernetes/manifests/kube-apiserver.yaml /tmp/
sleep 5
sudo mv /tmp/kube-apiserver.yaml /etc/kubernetes/manifests/

# 방법 B: kubelet 재시작
sudo systemctl restart kubelet
```

#### 검증

```bash
# 검증 1: 갱신 후 만료일 확인
sudo kubeadm certs check-expiration | grep apiserver
# 예상 출력:
# apiserver                  Mar 30, 2027 10:00 UTC   364d   ca     no
# RESIDUAL TIME이 약 1년으로 표시되어야 한다

# 검증 2: API 서버 정상 동작 확인
kubectl get nodes
# 예상 출력:
# NAME           STATUS   ROLES           AGE   VERSION
# controlplane   Ready    control-plane   30d   v1.30.0
# API 호출이 성공하면 인증서 갱신이 완료된 것이다

# 검증 3: kube-apiserver Pod 상태 확인
kubectl get pods -n kube-system -l component=kube-apiserver
# 예상 출력:
# NAME                            READY   STATUS    RESTARTS   AGE
# kube-apiserver-controlplane     1/1     Running   0          30s
# RESTARTS가 1 이상일 수 있다 (재시작되었으므로)
```

**핵심 포인트:** 인증서 갱신 후 API 서버를 재시작해야 새 인증서가 적용된다.

</details>

---

### Q5. 특정 Rolling Update 전략의 Deployment 생성

`kubectl config use-context k8s-workloads`

**문제:** 다음 조건을 만족하는 Deployment `web-deploy`를 네임스페이스 `default`에 생성하라.

**조건:**
- 이미지: `nginx:1.25`
- 레플리카: 4
- Rolling Update 전략: `maxSurge=2`, `maxUnavailable=1`
- 레이블: `app=web`

<details>
<summary>풀이</summary>

```bash
# 기본 Deployment 생성 후 수정
kubectl create deployment web-deploy --image=nginx:1.25 --replicas=4 --dry-run=client -o yaml > /tmp/web-deploy.yaml
```

`/tmp/web-deploy.yaml`을 편집:
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web-deploy
  labels:
    app: web
spec:
  replicas: 4
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 2
      maxUnavailable: 1
  selector:
    matchLabels:
      app: web
  template:
    metadata:
      labels:
        app: web
    spec:
      containers:
      - name: nginx
        image: nginx:1.25
```

```bash
kubectl apply -f /tmp/web-deploy.yaml
```

#### 검증

```bash
# 검증 1: Deployment 생성 확인
kubectl get deployment web-deploy
# 예상 출력:
# NAME         READY   UP-TO-DATE   AVAILABLE   AGE
# web-deploy   4/4     4            4           10s

# 검증 2: Rolling Update 전략 확인
kubectl get deployment web-deploy -o jsonpath='{.spec.strategy}'
# 예상 출력:
# {"rollingUpdate":{"maxSurge":2,"maxUnavailable":1},"type":"RollingUpdate"}

# 검증 3: Rollout 상태 확인
kubectl rollout status deployment web-deploy
# 예상 출력:
# deployment "web-deploy" successfully rolled out

# 검증 4: Pod 레이블 확인
kubectl get pods -l app=web
# 예상 출력:
# NAME                          READY   STATUS    RESTARTS   AGE
# web-deploy-xxx-yyy            1/1     Running   0          10s
# web-deploy-xxx-zzz            1/1     Running   0          10s
# web-deploy-xxx-aaa            1/1     Running   0          10s
# web-deploy-xxx-bbb            1/1     Running   0          10s
# 4개의 Pod가 Running 상태여야 한다
```

</details>

---

### Q6. 특정 노드에 Pod 스케줄링

`kubectl config use-context k8s-scheduling`

**문제:** `node01`에만 실행되는 Pod `node-specific`을 생성하라.

**조건:**
- 이미지: `nginx:1.25`
- `nodeName` 필드를 사용하지 말고, `nodeSelector` 또는 `nodeAffinity`를 사용하라.
- 노드에 필요한 레이블은 직접 부여하라.

<details>
<summary>풀이</summary>

방법 1: nodeSelector 사용
```bash
# 노드에 레이블 부여
kubectl label node node01 target=node01
```

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: node-specific
spec:
  nodeSelector:
    target: node01
  containers:
  - name: nginx
    image: nginx:1.25
```

방법 2: nodeAffinity 사용
```yaml
apiVersion: v1
kind: Pod
metadata:
  name: node-specific
spec:
  affinity:
    nodeAffinity:
      requiredDuringSchedulingIgnoredDuringExecution:
        nodeSelectorTerms:
        - matchExpressions:
          - key: kubernetes.io/hostname
            operator: In
            values:
            - node01
  containers:
  - name: nginx
    image: nginx:1.25
```

#### 검증

```bash
# 적용
kubectl apply -f /tmp/node-specific.yaml

# 검증 1: Pod가 node01에 배치되었는지 확인
kubectl get pod node-specific -o wide
# 예상 출력:
# NAME            READY   STATUS    RESTARTS   AGE   IP           NODE     ...
# node-specific   1/1     Running   0          10s   10.244.1.5   node01   ...
# NODE 컬럼이 node01이어야 한다

# 검증 2: 노드 레이블 확인 (방법 1 사용 시)
kubectl get node node01 --show-labels | grep target
# 예상 출력: target=node01이 레이블 목록에 포함되어야 한다

# 검증 3: Pod의 nodeSelector 또는 affinity 확인
kubectl get pod node-specific -o jsonpath='{.spec.nodeSelector}'
# 예상 출력: {"target":"node01"}
# 또는
kubectl get pod node-specific -o jsonpath='{.spec.affinity}'
```

**핵심 포인트:** `kubernetes.io/hostname` 레이블은 모든 노드에 자동 부여되므로 별도 레이블 없이 nodeAffinity만으로 해결할 수 있다.

</details>

---

### Q7. PodDisruptionBudget 생성

`kubectl config use-context k8s-workloads`

**문제:** Deployment `critical-app`(레이블: `app=critical`)에 대한 PDB를 생성하라.

**조건:**
- PDB 이름: `critical-pdb`
- 최소 가용 Pod: 3

<details>
<summary>풀이</summary>

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: critical-pdb
spec:
  minAvailable: 3
  selector:
    matchLabels:
      app: critical
```

#### 검증

```bash
# 적용
kubectl apply -f /tmp/critical-pdb.yaml

# 검증 1: PDB 생성 확인
kubectl get pdb critical-pdb
# 예상 출력:
# NAME           MIN AVAILABLE   MAX UNAVAILABLE   ALLOWED DISRUPTIONS   AGE
# critical-pdb   3               N/A               ...                   5s

# 검증 2: PDB 상세 정보 확인
kubectl describe pdb critical-pdb
# 예상 출력:
# Min Available:       3
# Selector:            app=critical
# Status:
#   Current Healthy:   5
#   Desired Healthy:   3
#   Disruptions Allowed: 2

# 검증 3: PDB가 drain 시 존중되는지 확인
kubectl drain <node-name> --ignore-daemonsets
# minAvailable 조건을 위반하는 축출은 거부된다
# 예상 출력 (위반 시):
# error when evicting pods/"critical-app-xxx" -n "default" (will retry after 5s):
# Cannot evict pod as it would violate the pod's disruption budget.
```

**핵심 포인트:** PDB의 `selector`는 Deployment의 Pod 레이블과 일치해야 한다. `minAvailable`과 `maxUnavailable`은 동시에 설정할 수 없다.

</details>

---

### Q8. kubelet 오류 수정

`kubectl config use-context k8s-troubleshoot`

**문제:** `node02` 노드가 `NotReady` 상태이다. 원인을 파악하고 수정하여 `Ready` 상태로 복구하라.

<details>
<summary>풀이</summary>

```bash
# 1. 노드 상태 확인
kubectl get nodes
kubectl describe node node02

# 2. node02에 SSH 접속
ssh node02

# 3. kubelet 상태 확인
sudo systemctl status kubelet
# Active: inactive (dead) 또는 에러 메시지 확인

# 4. kubelet 로그 확인
sudo journalctl -u kubelet --no-pager | tail -30

# 흔한 시나리오와 해결:

# 시나리오 A: kubelet이 중지됨
sudo systemctl start kubelet
sudo systemctl enable kubelet

# 시나리오 B: kubelet 설정 오류
sudo journalctl -u kubelet | grep error
# 설정 파일 수정
sudo vi /var/lib/kubelet/config.yaml
sudo systemctl daemon-reload
sudo systemctl restart kubelet

# 시나리오 C: 컨테이너 런타임이 중지됨
sudo systemctl status containerd
sudo systemctl start containerd
sudo systemctl restart kubelet

# 시나리오 D: kubelet 바이너리 경로 오류 (/usr/bin/kubelet 없음)
which kubelet
# /usr/local/bin/kubelet인 경우 서비스 파일 수정
```

#### 검증

```bash
# 검증 1: node02에서 kubelet 상태 확인
sudo systemctl status kubelet
# 예상 출력:
# ● kubelet.service - kubelet: The Kubernetes Node Agent
#      Active: active (running) since ...

# 검증 2: Control Plane에서 노드 상태 확인
exit
kubectl get nodes
# 예상 출력:
# NAME           STATUS   ROLES           AGE   VERSION
# controlplane   Ready    control-plane   30d   v1.30.0
# node02         Ready    <none>          30d   v1.30.0
# node02가 Ready 상태로 복귀해야 한다

# 검증 3: node02에서 Pod가 정상 실행되는지 확인
kubectl run test-node02 --image=nginx:1.25 --overrides='{"spec":{"nodeSelector":{"kubernetes.io/hostname":"node02"}}}'
kubectl get pod test-node02 -o wide
# 예상 출력:
# NAME           READY   STATUS    RESTARTS   AGE   IP           NODE     ...
# test-node02    1/1     Running   0          10s   10.244.2.5   node02   ...
```

**핵심 포인트:** 순서대로 확인한다: (1) kubelet 서비스 상태 -> (2) kubelet 로그 -> (3) 컨테이너 런타임 상태 -> (4) 설정 파일.

</details>

---

### Q9. Service와 Ingress 생성

`kubectl config use-context k8s-networking`

**문제:** 기존 Deployment `web-app`(포트 80)을 외부에 노출하라.

**조건:**
- ClusterIP Service 이름: `web-app-svc`, 포트: 80
- Ingress 이름: `web-app-ingress`
- 호스트: `web.example.com`
- 경로: `/` (Prefix)
- Ingress Class: `nginx`

<details>
<summary>풀이</summary>

```bash
# 1. Service 생성
kubectl expose deployment web-app \
  --name=web-app-svc \
  --port=80 \
  --target-port=80
```

```yaml
# 2. Ingress 생성
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: web-app-ingress
spec:
  ingressClassName: nginx
  rules:
  - host: web.example.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: web-app-svc
            port:
              number: 80
```

#### 검증

```bash
# 적용
kubectl apply -f /tmp/web-app-ingress.yaml

# 검증 1: Service 생성 확인
kubectl get svc web-app-svc
# 예상 출력:
# NAME          TYPE        CLUSTER-IP    EXTERNAL-IP   PORT(S)   AGE
# web-app-svc   ClusterIP   10.96.0.100   <none>        80/TCP    5s

# 검증 2: Service Endpoints 확인
kubectl get endpoints web-app-svc
# 예상 출력:
# NAME          ENDPOINTS                         AGE
# web-app-svc   10.244.1.5:80,10.244.2.6:80       5s
# Endpoints에 Pod IP가 있어야 한다

# 검증 3: Ingress 생성 확인
kubectl get ingress web-app-ingress
# 예상 출력:
# NAME              CLASS   HOSTS             ADDRESS      PORTS   AGE
# web-app-ingress   nginx   web.example.com   10.96.x.x   80      5s

# 검증 4: Ingress 상세 확인
kubectl describe ingress web-app-ingress
# 예상 출력:
# Rules:
#   Host             Path  Backends
#   ----             ----  --------
#   web.example.com  /     web-app-svc:80
```

</details>

---

### Q10. NetworkPolicy -- deny all + allow specific

`kubectl config use-context k8s-netpol`

**문제:** 네임스페이스 `production`에서 다음 조건의 NetworkPolicy를 생성하라.

**조건:**
1. 기본적으로 모든 Ingress 트래픽을 차단한다 (이름: `deny-all`)
2. `app=api` Pod에 대해 `app=frontend` Pod에서 오는 TCP 443 트래픽만 허용한다 (이름: `allow-frontend`)

<details>
<summary>풀이</summary>

```yaml
# 1. 모든 Ingress 차단
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: deny-all
  namespace: production
spec:
  podSelector: {}
  policyTypes:
  - Ingress
---
# 2. frontend -> api 허용
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-frontend
  namespace: production
spec:
  podSelector:
    matchLabels:
      app: api
  policyTypes:
  - Ingress
  ingress:
  - from:
    - podSelector:
        matchLabels:
          app: frontend
    ports:
    - protocol: TCP
      port: 443
```

#### 검증

```bash
# 적용
kubectl apply -f /tmp/netpol.yaml

# 검증 1: NetworkPolicy 생성 확인
kubectl get networkpolicy -n production
# 예상 출력:
# NAME             POD-SELECTOR   AGE
# deny-all         <none>         5s
# allow-frontend   app=api        5s

# 검증 2: allow-frontend 정책 상세 확인
kubectl describe networkpolicy allow-frontend -n production
# 예상 출력:
# Spec:
#   PodSelector:     app=api
#   Allowing ingress traffic:
#     To Port: 443/TCP
#     From:
#       PodSelector: app=frontend

# 검증 3: frontend -> api 443 접근 테스트 (허용됨)
kubectl exec frontend-pod -n production -- curl -sk --connect-timeout 3 https://api-svc:443
# 예상 출력: (api 서비스 응답)

# 검증 4: 다른 Pod -> api 접근 테스트 (차단됨)
kubectl run test --rm -it --image=busybox -n production -- wget -qO- --timeout=3 http://api-svc:443
# 예상 출력:
# wget: download timed out
# deny-all에 의해 차단된다

# 검증 5: frontend -> api 다른 포트 접근 테스트 (차단됨)
kubectl exec frontend-pod -n production -- curl -s --connect-timeout 3 http://api-svc:80
# 예상 출력:
# curl: (28) Connection timed out
# 443 포트만 허용되므로 80 포트는 차단된다
```

**핵심 포인트:** NetworkPolicy는 **추가적(additive)** 이다. `deny-all`로 전체 차단 후 `allow-frontend`로 특정 트래픽을 허용하면, `app=api` Pod는 `app=frontend`에서 오는 443 트래픽만 받을 수 있다.

</details>

---

### Q11. DNS 트러블슈팅

`kubectl config use-context k8s-dns`

**문제:** Pod `web-pod`에서 `nginx-service.default.svc.cluster.local`로 DNS 해석이 실패한다. 원인을 파악하고 수정하라.

<details>
<summary>풀이</summary>

```bash
# 1. 문제 확인
kubectl exec web-pod -- nslookup nginx-service.default.svc.cluster.local
# 실패하는 경우

# 2. CoreDNS 상태 확인
kubectl get pods -n kube-system -l k8s-app=kube-dns
kubectl get svc kube-dns -n kube-system

# 3. CoreDNS 로그 확인
kubectl logs -n kube-system -l k8s-app=kube-dns

# 4. Pod의 DNS 설정 확인
kubectl exec web-pod -- cat /etc/resolv.conf
# nameserver가 kube-dns ClusterIP와 일치하는지 확인

# 5. CoreDNS ConfigMap 확인
kubectl get configmap coredns -n kube-system -o yaml

# 흔한 원인과 해결:

# 원인 A: CoreDNS Pod가 Crash 상태
kubectl delete pod -n kube-system -l k8s-app=kube-dns
# Pod 재생성 대기

# 원인 B: CoreDNS ConfigMap의 Corefile 오류
kubectl edit configmap coredns -n kube-system
# 문법 오류 수정 후 CoreDNS Pod 재시작
kubectl rollout restart deployment coredns -n kube-system

# 원인 C: kube-dns Service의 Endpoints 누락
kubectl get endpoints kube-dns -n kube-system
# Endpoints가 비어 있으면 CoreDNS Pod가 Ready가 아닌 것

# 6. Service 존재 확인
kubectl get svc nginx-service
# Service가 없으면 DNS 해석 자체가 불가
```

#### 검증

```bash
# 검증 1: DNS 해석 성공 확인
kubectl exec web-pod -- nslookup nginx-service.default.svc.cluster.local
# 예상 출력 (수정 후):
# Server:    10.96.0.10
# Address 1: 10.96.0.10 kube-dns.kube-system.svc.cluster.local
# Name:      nginx-service.default.svc.cluster.local
# Address 1: 10.96.0.xxx nginx-service.default.svc.cluster.local

# 검증 2: CoreDNS Pod 정상 확인
kubectl get pods -n kube-system -l k8s-app=kube-dns
# 예상 출력:
# NAME                       READY   STATUS    RESTARTS   AGE
# coredns-xxx-yyy            1/1     Running   0          30s
# coredns-xxx-zzz            1/1     Running   0          30s

# 검증 3: 실제 서비스 접근 확인
kubectl exec web-pod -- wget -qO- --timeout=3 http://nginx-service
# 예상 출력: (nginx 기본 페이지)
```

</details>

---

### Q12. NodePort로 애플리케이션 노출

`kubectl config use-context k8s-expose`

**문제:** Deployment `backend`(컨테이너 포트 8080)를 NodePort Service로 노출하라.

**조건:**
- Service 이름: `backend-np`
- Service 포트: 80
- Target 포트: 8080
- NodePort: 30088

<details>
<summary>풀이</summary>

```yaml
apiVersion: v1
kind: Service
metadata:
  name: backend-np
spec:
  type: NodePort
  selector:
    app: backend    # Deployment의 Pod 레이블과 일치해야 함
  ports:
  - port: 80
    targetPort: 8080
    nodePort: 30088
```

```bash
# 또는 imperative 방식 (nodePort 지정은 YAML 필요)
kubectl expose deployment backend \
  --name=backend-np \
  --type=NodePort \
  --port=80 \
  --target-port=8080 \
  --dry-run=client -o yaml > /tmp/backend-np.yaml
# /tmp/backend-np.yaml을 편집하여 nodePort: 30088 추가
kubectl apply -f /tmp/backend-np.yaml
```

#### 검증

```bash
# 검증 1: Service 생성 확인
kubectl get svc backend-np
# 예상 출력:
# NAME         TYPE       CLUSTER-IP    EXTERNAL-IP   PORT(S)        AGE
# backend-np   NodePort   10.96.x.x    <none>        80:30088/TCP   5s
# PORT(S)에 80:30088이 표시되어야 한다

# 검증 2: Endpoints 확인
kubectl get endpoints backend-np
# 예상 출력:
# NAME         ENDPOINTS                         AGE
# backend-np   10.244.1.5:8080,10.244.2.6:8080   5s

# 검증 3: 클러스터 내부에서 Service IP로 접근
kubectl run test --rm -it --image=busybox -- wget -qO- --timeout=3 http://backend-np:80
# 예상 출력: (backend 응답)

# 검증 4: NodePort로 접근
curl <node-ip>:30088
# 예상 출력: (backend 응답)

# 검증 5: Deployment의 Pod 레이블 확인 (selector 불일치 방지)
kubectl get deployment backend -o jsonpath='{.spec.selector.matchLabels}'
# 예상 출력: {"app":"backend"}
```

**핵심 포인트:** Deployment의 Pod 레이블을 반드시 확인해야 한다. `kubectl get deployment backend -o jsonpath='{.spec.selector.matchLabels}'`로 레이블을 확인한다.

</details>

---

### Q13. 특정 용량의 PersistentVolume 생성

`kubectl config use-context k8s-storage`

**문제:** 다음 조건의 PersistentVolume을 생성하라.

**조건:**
- 이름: `app-pv`
- 용량: 2Gi
- accessModes: `ReadWriteOnce`
- hostPath: `/mnt/app-data`
- storageClassName: `app-storage`
- Reclaim Policy: `Retain`

<details>
<summary>풀이</summary>

```yaml
apiVersion: v1
kind: PersistentVolume
metadata:
  name: app-pv
spec:
  capacity:
    storage: 2Gi
  accessModes:
  - ReadWriteOnce
  persistentVolumeReclaimPolicy: Retain
  storageClassName: app-storage
  hostPath:
    path: /mnt/app-data
```

#### 검증

```bash
# 적용
kubectl apply -f /tmp/app-pv.yaml

# 검증 1: PV 생성 확인
kubectl get pv app-pv
# 예상 출력:
# NAME     CAPACITY   ACCESS MODES   RECLAIM POLICY   STATUS      CLAIM   STORAGECLASS   AGE
# app-pv   2Gi        RWO            Retain           Available           app-storage    5s
# STATUS가 Available이어야 한다 (아직 PVC에 바인딩되지 않은 상태)

# 검증 2: PV 상세 정보 확인
kubectl describe pv app-pv
# 예상 출력:
# Capacity:      2Gi
# Access Modes:  RWO
# Reclaim Policy: Retain
# Status:        Available
# StorageClass:  app-storage
# Source:
#   Type: HostPath
#   Path: /mnt/app-data

# 검증 3: PVC 생성 후 바인딩 확인
kubectl apply -f - <<EOF
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: app-pvc
spec:
  accessModes: ["ReadWriteOnce"]
  storageClassName: app-storage
  resources:
    requests:
      storage: 1Gi
EOF
kubectl get pv app-pv
# 예상 출력:
# NAME     CAPACITY   ACCESS MODES   RECLAIM POLICY   STATUS   CLAIM              STORAGECLASS   AGE
# app-pv   2Gi        RWO            Retain           Bound    default/app-pvc    app-storage    30s
# STATUS가 Bound로 변경되어야 한다
```

**핵심 포인트:** `persistentVolumeReclaimPolicy` 값은 `Retain`, `Recycle`, `Delete` 중 하나이다. PV 문서를 참조: `kubectl explain pv.spec`.

> **참고:** `Recycle`는 Kubernetes 1.15부터 deprecated 되었으며 현재는 사용하지 않는다. 실질적으로 `Retain`과 `Delete`만 사용한다.

</details>

---

### Q14. PVC 용량 확장

`kubectl config use-context k8s-storage`

**문제:** 네임스페이스 `default`의 PVC `data-claim`의 용량을 현재 1Gi에서 5Gi로 확장하라.

**조건:**
- StorageClass에 `allowVolumeExpansion: true`가 이미 설정되어 있다.

<details>
<summary>풀이</summary>

```bash
# 1. 현재 상태 확인
kubectl get pvc data-claim

# 2. PVC 용량 확장
kubectl patch pvc data-claim -p '{"spec":{"resources":{"requests":{"storage":"5Gi"}}}}'

# 또는 edit으로 수정
kubectl edit pvc data-claim
# spec.resources.requests.storage를 5Gi로 변경
```

#### 검증

```bash
# 검증 1: PVC 용량 변경 확인
kubectl get pvc data-claim
# 예상 출력:
# NAME         STATUS   VOLUME    CAPACITY   ACCESS MODES   STORAGECLASS   AGE
# data-claim   Bound    pv-xxx    5Gi        RWO            expandable     10m
# CAPACITY가 5Gi로 변경되어야 한다

# 검증 2: 파일시스템 리사이즈 상태 확인
kubectl get pvc data-claim -o jsonpath='{.status.conditions}'
# FileSystemResizePending이면 Pod 재시작 필요

# 검증 3: Pod 내에서 실제 용량 확인
kubectl exec <pod-name> -- df -h /data
# 예상 출력:
# Filesystem      Size  Used  Avail  Use%  Mounted on
# /dev/sdb        5.0G  100M  4.9G   2%    /data
```

**핵심 포인트:** PVC 용량은 **확장만** 가능하고 **축소는** 불가능하다. StorageClass에 `allowVolumeExpansion: true`가 설정되어 있어야 한다.

</details>

---

### Q15. WaitForFirstConsumer StorageClass 생성

`kubectl config use-context k8s-storage`

**문제:** 다음 조건의 StorageClass를 생성하라.

**조건:**
- 이름: `delayed-sc`
- Provisioner: `kubernetes.io/no-provisioner`
- Volume Binding Mode: `WaitForFirstConsumer`

<details>
<summary>풀이</summary>

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: delayed-sc
provisioner: kubernetes.io/no-provisioner
volumeBindingMode: WaitForFirstConsumer
```

#### 검증

```bash
# 적용
kubectl apply -f /tmp/delayed-sc.yaml

# 검증 1: StorageClass 생성 확인
kubectl get sc delayed-sc
# 예상 출력:
# NAME         PROVISIONER                    RECLAIMPOLICY   VOLUMEBINDINGMODE      ALLOWVOLUMEEXPANSION   AGE
# delayed-sc   kubernetes.io/no-provisioner   Delete          WaitForFirstConsumer   false                  5s

# 검증 2: StorageClass 상세 확인
kubectl describe sc delayed-sc
# 예상 출력:
# Name:            delayed-sc
# Provisioner:     kubernetes.io/no-provisioner
# VolumeBindingMode: WaitForFirstConsumer

# 검증 3: WaitForFirstConsumer 동작 확인
# PVC를 생성하면 STATUS가 Pending으로 유지된다
kubectl apply -f - <<EOF
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: test-wffc
spec:
  accessModes: ["ReadWriteOnce"]
  storageClassName: delayed-sc
  resources:
    requests:
      storage: 1Gi
EOF

kubectl get pvc test-wffc
# 예상 출력:
# NAME        STATUS    VOLUME   CAPACITY   ACCESS MODES   STORAGECLASS   AGE
# test-wffc   Pending                                      delayed-sc     5s
# Pod가 해당 PVC를 사용하면 그때 바인딩된다
```

**핵심 포인트:** `WaitForFirstConsumer`는 PVC를 사용하는 Pod가 스케줄링될 때까지 PV-PVC 바인딩을 지연한다. 이를 통해 Pod의 노드 제약 조건을 고려한 최적의 바인딩이 가능하다.

</details>

---

### Q16. ConfigMap을 Volume으로 마운트

`kubectl config use-context k8s-storage`

**문제:** ConfigMap `nginx-conf`를 Pod의 `/etc/nginx/conf.d`에 마운트하는 Pod를 생성하라.

**조건:**
- ConfigMap 내용: `default.conf` 키에 nginx 설정 파일
- Pod 이름: `nginx-custom`
- 이미지: `nginx:1.25`

<details>
<summary>풀이</summary>

```bash
# 1. ConfigMap 생성
kubectl create configmap nginx-conf --from-literal=default.conf='
server {
    listen 80;
    server_name localhost;
    location / {
        return 200 "Hello from custom config\n";
    }
}'
```

```yaml
# 2. Pod 생성
apiVersion: v1
kind: Pod
metadata:
  name: nginx-custom
spec:
  containers:
  - name: nginx
    image: nginx:1.25
    ports:
    - containerPort: 80
    volumeMounts:
    - name: nginx-config
      mountPath: /etc/nginx/conf.d
  volumes:
  - name: nginx-config
    configMap:
      name: nginx-conf
```

#### 검증

```bash
# 적용
kubectl apply -f /tmp/nginx-custom.yaml

# 검증 1: Pod Running 확인
kubectl get pod nginx-custom
# 예상 출력:
# NAME           READY   STATUS    RESTARTS   AGE
# nginx-custom   1/1     Running   0          10s

# 검증 2: ConfigMap 파일 마운트 확인
kubectl exec nginx-custom -- ls /etc/nginx/conf.d/
# 예상 출력:
# default.conf

# 검증 3: 파일 내용 확인
kubectl exec nginx-custom -- cat /etc/nginx/conf.d/default.conf
# 예상 출력:
# server {
#     listen 80;
#     server_name localhost;
#     location / {
#         return 200 "Hello from custom config\n";
#     }
# }

# 검증 4: nginx가 커스텀 설정으로 동작하는지 확인
kubectl exec nginx-custom -- curl -s localhost
# 예상 출력:
# Hello from custom config
```

**핵심 포인트:** ConfigMap의 각 키가 마운트 경로 내의 파일명이 된다. `subPath`를 사용하면 기존 디렉토리의 다른 파일을 덮어쓰지 않고 특정 파일만 마운트할 수 있다.

</details>

---

### Q17. 가장 CPU를 많이 사용하는 Pod 찾기

`kubectl config use-context k8s-metrics`

**문제:** 네임스페이스 `monitoring`에서 CPU를 가장 많이 사용하는 Pod의 이름을 `/opt/high-cpu-pod.txt`에 기록하라.

<details>
<summary>풀이</summary>

```bash
# 1. CPU 사용량 기준 정렬
kubectl top pods -n monitoring --sort-by=cpu

# 2. 가장 높은 Pod 이름을 파일에 기록 (첫 번째 결과)
kubectl top pods -n monitoring --sort-by=cpu --no-headers | head -1 | awk '{print $1}' > /opt/high-cpu-pod.txt
```

#### 검증

```bash
# 검증 1: 파일 내용 확인
cat /opt/high-cpu-pod.txt
# 예상 출력:
# high-cpu-app-xxx
# (CPU 사용량이 가장 높은 Pod 이름이 기록되어 있어야 한다)

# 검증 2: kubectl top으로 교차 확인
kubectl top pods -n monitoring --sort-by=cpu
# 예상 출력:
# NAME                  CPU(cores)   MEMORY(bytes)
# high-cpu-app-xxx      350m         128Mi
# normal-app-yyy        50m          64Mi
# low-cpu-app-zzz       10m          32Mi
# 첫 번째 행의 Pod 이름이 파일에 기록된 값과 일치해야 한다
```

**핵심 포인트:** `kubectl top`은 **metrics-server**가 설치되어 있어야 동작한다. `--sort-by=cpu`는 CPU 사용량 기준, `--sort-by=memory`는 메모리 사용량 기준이다. `--no-headers`를 사용하면 헤더 행을 제외한다.

</details>

---

### Q18. CrashLoopBackOff Pod 수정

`kubectl config use-context k8s-troubleshoot`

**문제:** 네임스페이스 `dev`의 Pod `broken-app`이 CrashLoopBackOff 상태이다. 원인을 파악하고 수정하라.

<details>
<summary>풀이</summary>

```bash
# 1. Pod 상태 확인
kubectl get pod broken-app -n dev

# 2. 이벤트 확인
kubectl describe pod broken-app -n dev

# 3. 로그 확인
kubectl logs broken-app -n dev
kubectl logs broken-app -n dev --previous

# 4. 흔한 원인과 해결:

# 원인 A: 잘못된 command/args
kubectl get pod broken-app -n dev -o yaml | grep -A 5 command
# 수정: YAML 추출 -> 수정 -> 재생성
kubectl get pod broken-app -n dev -o yaml > /tmp/broken-app.yaml
# /tmp/broken-app.yaml에서 command/args 수정
kubectl delete pod broken-app -n dev
kubectl apply -f /tmp/broken-app.yaml

# 원인 B: 존재하지 않는 ConfigMap/Secret 참조
kubectl describe pod broken-app -n dev | grep -A 3 "Warning"
# 누락된 ConfigMap/Secret 생성

# 원인 C: OOMKilled (메모리 부족)
kubectl get pod broken-app -n dev -o jsonpath='{.status.containerStatuses[0].lastState.terminated.reason}'
# OOMKilled이면 -> memory limits 증가

# 원인 D: Liveness Probe 실패
kubectl describe pod broken-app -n dev | grep -i liveness
# probe 설정 조정 (initialDelaySeconds 증가 등)
```

#### 검증

```bash
# 검증 1: 수정 후 Pod 상태 확인
kubectl get pod broken-app -n dev
# 예상 출력:
# NAME         READY   STATUS    RESTARTS   AGE
# broken-app   1/1     Running   0          10s
# STATUS가 Running이어야 한다

# 검증 2: Pod 로그에서 정상 동작 확인
kubectl logs broken-app -n dev
# 예상 출력: (애플리케이션 정상 시작 로그)
# 오류 메시지가 없어야 한다

# 검증 3: Pod 이벤트에서 오류 없음 확인
kubectl describe pod broken-app -n dev | tail -10
# Events 섹션에 Warning이 없어야 한다
```

**핵심 포인트:** 디버깅 순서는 항상 `describe` -> `logs` -> `logs --previous`이다. Pod를 수정할 수 없으면 YAML을 추출(`-o yaml`)하여 수정 후 재생성한다.

</details>

---

### Q19. Node NotReady 트러블슈팅

`kubectl config use-context k8s-troubleshoot`

**문제:** `node03`이 `NotReady` 상태이다. 원인을 파악하고 `Ready` 상태로 복구하라. kubelet 설정 파일 또는 서비스에 문제가 있을 수 있다.

<details>
<summary>풀이</summary>

```bash
# 1. 노드 상태 확인
kubectl get nodes
kubectl describe node node03

# 2. node03에 SSH 접속
ssh node03

# 3. kubelet 상태 확인
sudo systemctl status kubelet
# 출력에서 Active 상태와 에러 메시지 확인

# 4. kubelet 로그 확인
sudo journalctl -u kubelet --no-pager | tail -50

# 5. 원인별 해결:

# 원인 A: kubelet 서비스가 중지됨
sudo systemctl start kubelet
sudo systemctl enable kubelet

# 원인 B: kubelet.conf 또는 config.yaml 오류
# 로그에서 파일 경로와 오류 메시지 확인
sudo cat /var/lib/kubelet/config.yaml
# 오류 수정 후:
sudo systemctl daemon-reload
sudo systemctl restart kubelet

# 원인 C: containerd가 중지됨
sudo systemctl status containerd
sudo systemctl start containerd
sudo systemctl restart kubelet

# 원인 D: kubelet 서비스 파일에 잘못된 경로
cat /etc/systemd/system/kubelet.service.d/10-kubeadm.conf
# ExecStart 경로 확인
which kubelet
# 경로 불일치 시 수정 후:
sudo systemctl daemon-reload
sudo systemctl restart kubelet
```

#### 검증

```bash
# 검증 1: kubelet 서비스 상태 확인 (node03에서)
sudo systemctl status kubelet
# 예상 출력:
# ● kubelet.service - kubelet: The Kubernetes Node Agent
#      Active: active (running) since ...

# 검증 2: Control Plane에서 노드 상태 확인
exit
kubectl get nodes
# 예상 출력:
# NAME           STATUS   ROLES           AGE   VERSION
# controlplane   Ready    control-plane   30d   v1.30.0
# node03         Ready    <none>          30d   v1.30.0
# node03이 Ready 상태로 복귀해야 한다

# 검증 3: node03에서 Pod 스케줄링 테스트
kubectl run test-node03 --image=nginx:1.25
kubectl get pod test-node03 -o wide
# node03에도 Pod가 스케줄링 가능해야 한다
```

**핵심 포인트:** `journalctl -u kubelet`의 로그 메시지를 정확히 읽는 것이 핵심이다. 대부분의 문제는 (1) 서비스 중지, (2) 설정 파일 오류, (3) 인증서 만료, (4) 컨테이너 런타임 문제 중 하나이다.

</details>

---

### Q20. 클러스터 컴포넌트 로그 분석

`kubectl config use-context k8s-troubleshoot`

**문제:** 클러스터에서 Deployment 생성이 실패한다. Control Plane 컴포넌트 로그를 분석하여 원인을 파악하고 수정하라.

**조건:**
- 문제의 원인은 Control Plane 컴포넌트 중 하나에 있다.
- `/etc/kubernetes/manifests/`의 Static Pod 매니페스트를 확인하라.

<details>
<summary>풀이</summary>

```bash
# 1. Control Plane Pod 상태 확인
kubectl get pods -n kube-system

# 2. 각 컴포넌트 상태 확인
kubectl get pods -n kube-system -o wide

# 3. 비정상 컴포넌트 로그 확인
# kube-controller-manager가 문제인 경우 (Deployment 생성 실패의 흔한 원인):
kubectl logs -n kube-system kube-controller-manager-controlplane

# kube-scheduler가 문제인 경우 (Pod가 Pending 상태):
kubectl logs -n kube-system kube-scheduler-controlplane

# kube-apiserver가 문제인 경우 (API 호출 실패):
kubectl logs -n kube-system kube-apiserver-controlplane

# 4. Static Pod 매니페스트 확인
ls /etc/kubernetes/manifests/
cat /etc/kubernetes/manifests/kube-controller-manager.yaml
cat /etc/kubernetes/manifests/kube-scheduler.yaml

# 5. 흔한 오류:
# - 매니페스트에서 잘못된 인증서 경로
# - --kubeconfig 경로 오류
# - command 인자 오타 (예: --master가 아닌 --kubeconfig)
# - 잘못된 이미지 태그

# 6. 매니페스트 수정 (예: kube-controller-manager)
sudo vi /etc/kubernetes/manifests/kube-controller-manager.yaml
# 오류 수정 후 저장 -> Static Pod가 자동 재시작
```

#### 검증

```bash
# 검증 1: 수정 후 Control Plane Pod 상태 확인
kubectl get pods -n kube-system
# 예상 출력:
# NAME                                   READY   STATUS    RESTARTS   AGE
# etcd-controlplane                      1/1     Running   0          30d
# kube-apiserver-controlplane            1/1     Running   0          30d
# kube-controller-manager-controlplane   1/1     Running   0          30s
# kube-scheduler-controlplane            1/1     Running   0          30d
# 문제 컴포넌트가 Running/1/1 상태여야 한다

# 검증 2: Deployment 생성 테스트
kubectl create deployment test --image=nginx:1.25
kubectl get deployment test
# 예상 출력:
# NAME   READY   UP-TO-DATE   AVAILABLE   AGE
# test   1/1     1            1           10s

# 검증 3: dry-run으로 API 접근 확인
kubectl create deployment test2 --image=nginx:1.25 --dry-run=server
# 예상 출력:
# deployment.apps/test2 created (server dry run)
# 오류 없이 성공하면 Control Plane이 정상이다

# 검증 4: 컴포넌트 로그에서 오류 없음 확인
kubectl logs -n kube-system kube-controller-manager-controlplane --tail=5
# ERROR 레벨의 로그가 없어야 한다
```

**핵심 포인트:**
- `kubectl get pods -n kube-system`으로 어떤 컴포넌트가 비정상인지 빠르게 파악한다.
- Static Pod 매니페스트 수정 시 별도의 재시작 명령이 필요 없다. kubelet이 파일 변경을 감지하여 자동으로 Pod를 재생성한다.
- 컴포넌트가 아예 시작되지 않으면 `crictl ps -a`로 컨테이너 상태를 확인한다.

</details>

---

---

## Part 5: CKA 시험 핵심 개념 요약

### Kubernetes 아키텍처 핵심 컴포넌트 요약

| 컴포넌트 | 위치 | 역할 | 실행 방식 |
|---|---|---|---|
| **kube-apiserver** | Control Plane | 모든 API 요청의 진입점. 인증, 인가, Admission 처리 | Static Pod |
| **kube-controller-manager** | Control Plane | 선언적 상태를 유지하는 컨트롤러 루프 실행 (Deployment, ReplicaSet, Node, Endpoint 컨트롤러 등) | Static Pod |
| **kube-scheduler** | Control Plane | Pending Pod를 최적의 노드에 배치 (필터링 → 스코어링 → 바인딩) | Static Pod |
| **etcd** | Control Plane | 모든 클러스터 상태를 저장하는 분산 키-값 저장소 | Static Pod |
| **kubelet** | 모든 노드 | Pod의 생성/삭제/모니터링, Static Pod 관리, 노드 상태 보고 | systemd 서비스 |
| **kube-proxy** | 모든 노드 | Service의 네트워크 규칙(iptables/IPVS) 관리 (Cilium이 대체하는 경우 설치 안 됨) | DaemonSet |
| **CoreDNS** | Control Plane | 클러스터 내부 DNS 해석 (Service, Pod DNS) | Deployment |
| **containerd** | 모든 노드 | 컨테이너 런타임 (이미지 pull, 컨테이너 생성/삭제) | systemd 서비스 |

### API 요청 처리 흐름

kubectl 명령이 실행되면 다음 순서로 처리된다:

```
kubectl → kube-apiserver → Authentication → Authorization(RBAC) → Admission Control → etcd 저장
                                                                                       ↓
kube-controller-manager ← Watch API ← kube-apiserver ← etcd 변경 알림
                                                                                       ↓
kube-scheduler ← Watch API (Pending Pod 감지) → 노드 선택 → Binding (Pod → Node)
                                                                                       ↓
kubelet ← Watch API (자신의 노드에 바인딩된 Pod 감지) → containerd에 컨테이너 생성 요청
```

### CKA 시험 빈출 주제 우선순위

| 순위 | 주제 | 출제 빈도 | 핵심 명령어 |
|---|---|---|---|
| 1 | etcd 백업/복구 | 거의 매회 출제 | `etcdctl snapshot save/restore` |
| 2 | NetworkPolicy | 매회 1~2문제 | `kubectl apply -f networkpolicy.yaml` |
| 3 | RBAC (Role/RoleBinding) | 매회 1~2문제 | `kubectl create role/rolebinding` |
| 4 | Pod 트러블슈팅 | 매회 2~3문제 | `kubectl describe/logs/get events` |
| 5 | kubelet 트러블슈팅 | 매회 1문제 | `systemctl status kubelet`, `journalctl -u kubelet` |
| 6 | 클러스터 업그레이드 | 2~3회에 1회 | `kubeadm upgrade plan/apply` |
| 7 | PV/PVC 생성 | 매회 1문제 | `kubectl apply -f pv.yaml pvc.yaml` |
| 8 | Ingress 생성 | 2~3회에 1회 | `kubectl create ingress` 또는 YAML |
| 9 | Service 생성/수정 | 매회 1문제 | `kubectl expose` |
| 10 | kubeconfig/컨텍스트 관리 | 매회 (모든 문제에서 컨텍스트 전환 필요) | `kubectl config use-context` |

### 시험 중 자주 범하는 실수와 예방법

| 실수 | 결과 | 예방법 |
|---|---|---|
| 컨텍스트 전환 잊음 | 다른 클러스터에서 작업하여 0점 | 문제 상단의 `kubectl config use-context` 명령을 반드시 먼저 실행 |
| 네임스페이스 미지정 | default 네임스페이스에 리소스 생성 | `-n <namespace>`를 항상 확인하고 지정 |
| YAML 들여쓰기 오류 | `kubectl apply` 실패 | `--dry-run=client -o yaml`로 기본 템플릿 생성 후 수정 |
| 검증 안 함 | 부분 완성으로 감점 | 작업 후 `kubectl get/describe`로 결과 확인 |
| etcd 백업 시 ETCDCTL_API=3 누락 | 빈 스냅샷 생성 | 반드시 `ETCDCTL_API=3`을 명령 앞에 추가 |
| etcd 복원 후 매니페스트 미수정 | etcd Pod CrashLoopBackOff | `--data-dir`과 etcd.yaml의 `hostPath` 두 곳 모두 변경 |
| NetworkPolicy에서 DNS Egress 누락 | Service 이름 해석 불가 | Default Deny Egress 적용 시 DNS(UDP/TCP 53) Egress를 항상 허용 |

---

## 부록: 시험 팁 요약

### kubectl 시간 절약 팁

```bash
# 자동 완성 활성화 (시험 시작 시 설정)
source <(kubectl completion bash)
alias k=kubectl
complete -o default -F __start_kubectl k

# dry-run으로 YAML 생성
kubectl run nginx --image=nginx:1.25 --dry-run=client -o yaml > pod.yaml
kubectl create deployment web --image=nginx:1.25 --dry-run=client -o yaml > deploy.yaml
kubectl expose deployment web --port=80 --dry-run=client -o yaml > svc.yaml

# kubectl explain으로 필드 확인
kubectl explain pod.spec.containers.securityContext
kubectl explain pv.spec --recursive | grep -i capacity

# 빠른 리소스 확인
kubectl api-resources | grep -i storage
kubectl api-resources --namespaced=false
```

### 시험 중 시간 관리

1. **쉬운 문제 먼저** 풀고 어려운 문제는 나중에 돌아온다.
2. 문제마다 **context 전환**을 잊지 않는다.
3. `kubectl explain`과 공식 문서(`kubernetes.io/docs`)를 적극 활용한다.
4. YAML 작성 시 `--dry-run=client -o yaml`로 기본 템플릿을 생성한 후 수정한다.
5. 문제를 풀고 나면 **검증 명령**(`kubectl get`, `kubectl describe`)으로 결과를 확인한다.

### 검증 습관화

모든 문제를 풀고 나서 반드시 다음 검증 루틴을 수행한다:

```bash
# 리소스 생성 확인
kubectl get <resource-type> <resource-name> -n <namespace>

# 상세 정보 확인
kubectl describe <resource-type> <resource-name> -n <namespace>

# 동작 확인 (Pod 관련)
kubectl exec <pod-name> -- <command>

# 로그 확인 (문제 발생 시)
kubectl logs <pod-name> -n <namespace>
```

이 루틴을 습관화하면 실수를 조기에 발견할 수 있고, 부분 점수를 확보할 수 있다.

---

## Part 6: 심화 트러블슈팅 레퍼런스

### 컨트롤 플레인 컴포넌트별 장애 진단 가이드

#### kube-apiserver 장애

kube-apiserver가 비정상이면 모든 kubectl 명령이 실패한다. 진단 순서:

```bash
# 1. SSH로 마스터 노드 접속
ssh <master-node>

# 2. Static Pod 매니페스트 존재 확인
ls -la /etc/kubernetes/manifests/kube-apiserver.yaml

# 3. 컨테이너 상태 확인
sudo crictl ps -a | grep apiserver

# 4. 컨테이너 로그 확인 (컨테이너 ID 사용)
sudo crictl logs <container-id> --tail=50

# 5. kubelet 로그에서 apiserver 관련 오류 확인
sudo journalctl -u kubelet | grep apiserver | tail -20
```

일반적인 kube-apiserver 장애 원인:

| 원인 | 로그 패턴 | 해결 방법 |
|---|---|---|
| etcd 연결 실패 | `connection error: desc = "transport: Error while dialing: dial tcp 127.0.0.1:2379"` | etcd Pod 상태 확인, etcd 인증서 확인 |
| 인증서 만료 | `x509: certificate has expired` | `kubeadm certs renew apiserver` |
| 포트 충돌 | `listen tcp :6443: bind: address already in use` | 6443 포트를 사용하는 다른 프로세스 확인 (`ss -tlnp \| grep 6443`) |
| 매니페스트 문법 오류 | `could not parse YAML` (kubelet 로그) | `/etc/kubernetes/manifests/kube-apiserver.yaml` YAML 문법 확인 |
| 잘못된 플래그 | `unknown flag: --xxx` | 매니페스트의 command 인자 확인 |

#### kube-controller-manager 장애

kube-controller-manager가 비정상이면 다음 증상이 나타난다:
- Deployment를 생성해도 Pod가 생성되지 않는다 (ReplicaSet 컨트롤러 미동작).
- Node가 NotReady가 되어도 Pod가 재스케줄링되지 않는다 (Node 컨트롤러 미동작).
- PVC를 생성해도 PV에 바인딩되지 않는다 (PV 컨트롤러 미동작).

```bash
# kube-controller-manager 로그 확인
kubectl logs -n kube-system kube-controller-manager-<master-node> --tail=30

# 또는 SSH 접속 후
sudo crictl logs $(sudo crictl ps | grep controller-manager | awk '{print $1}') --tail=30
```

검증 (정상 동작):

```text
I0330 10:00:00.000000       1 controllermanager.go:165] Version: v1.31.0
I0330 10:00:00.000000       1 leaderelection.go:250] attempting to acquire leader lease kube-system/kube-controller-manager...
I0330 10:00:00.000000       1 leaderelection.go:260] successfully acquired lease kube-system/kube-controller-manager
```

검증 (비정상 - 인증서 오류):

```text
E0330 10:00:00.000000       1 authentication.go:67] Unable to authenticate the request due to an error: x509: certificate signed by unknown authority
```

#### kube-scheduler 장애

kube-scheduler가 비정상이면 새 Pod가 Pending 상태에 머문다 (노드에 바인딩되지 않음).

```bash
# kube-scheduler 상태 확인
kubectl get pods -n kube-system -l component=kube-scheduler

# Pod가 Running이지만 스케줄링이 안 되는 경우 로그 확인
kubectl logs -n kube-system kube-scheduler-<master-node> --tail=30
```

검증 (정상):

```text
I0330 10:00:00.000000       1 server.go:154] "Starting Kubernetes Scheduler" version="v1.31.0"
I0330 10:00:00.000000       1 leaderelection.go:260] successfully acquired lease kube-system/kube-scheduler
```

검증 (비정상 - 리더 선출 실패):

```text
E0330 10:00:00.000000       1 leaderelection.go:340] error retrieving resource lock kube-system/kube-scheduler: Get "https://127.0.0.1:6443/...": dial tcp 127.0.0.1:6443: connect: connection refused
```

이 경우 kube-apiserver가 먼저 정상인지 확인해야 한다. kube-scheduler는 kube-apiserver에 의존하기 때문이다.

### kubelet 장애 유형별 복구 체크리스트

kubelet 장애는 CKA 시험에서 가장 자주 출제되는 트러블슈팅 유형이다.

```bash
# 체계적 진단 절차 (SSH 접속 후)
# Step 1: kubelet 서비스 상태 확인
sudo systemctl status kubelet
# Active: active (running) → 정상
# Active: inactive (dead) → 서비스 중지됨
# Active: activating (auto-restart) → 재시작 반복 중

# Step 2: kubelet 로그에서 오류 확인
sudo journalctl -u kubelet --no-pager -p err | tail -20

# Step 3: kubelet 설정 파일 확인
sudo cat /var/lib/kubelet/config.yaml | head -20

# Step 4: kubelet systemd 서비스 파일 확인
sudo cat /etc/systemd/system/kubelet.service.d/10-kubeadm.conf

# Step 5: containerd 상태 확인
sudo systemctl status containerd
```

#### kubelet 복구 명령 패턴

```bash
# 패턴 A: kubelet이 중지된 경우
sudo systemctl start kubelet
sudo systemctl enable kubelet

# 패턴 B: kubelet 설정 변경 후
sudo systemctl daemon-reload
sudo systemctl restart kubelet

# 패턴 C: containerd 재시작 필요 시
sudo systemctl restart containerd
sudo systemctl restart kubelet

# 패턴 D: swap 비활성화
sudo swapoff -a
sudo sed -i '/ swap / s/^/#/' /etc/fstab
sudo systemctl restart kubelet
```

### CoreDNS 장애 복구 체크리스트

CoreDNS 장애는 클러스터 내 모든 DNS 해석을 중단시키므로 영향 범위가 크다.

```bash
# Step 1: CoreDNS Pod 상태 확인
kubectl get pods -n kube-system -l k8s-app=kube-dns -o wide
```

검증 (정상):

```text
NAME                       READY   STATUS    RESTARTS   AGE   IP           NODE
coredns-5dd5756b68-abc12   1/1     Running   0          30d   10.244.0.2   controlplane
coredns-5dd5756b68-def34   1/1     Running   0          30d   10.244.0.3   controlplane
```

```bash
# Step 2: kube-dns Endpoints 확인
kubectl get endpoints kube-dns -n kube-system
```

검증 (정상):

```text
NAME       ENDPOINTS                                         AGE
kube-dns   10.244.0.2:53,10.244.0.3:53,10.244.0.2:53 + 3 more...   30d
```

검증 (비정상):

```text
NAME       ENDPOINTS   AGE
kube-dns   <none>      30d
```

Endpoints가 비어 있으면 CoreDNS Pod가 Ready가 아닌 것이다.

```bash
# Step 3: CoreDNS 로그 확인
kubectl logs -n kube-system -l k8s-app=kube-dns --tail=20

# Step 4: Corefile(ConfigMap) 확인
kubectl get configmap coredns -n kube-system -o yaml

# Step 5: DNS 해석 테스트
kubectl run dns-test --rm -it --image=busybox:1.36 -- nslookup kubernetes.default

# Step 6: CoreDNS 재시작
kubectl rollout restart deployment coredns -n kube-system
kubectl rollout status deployment coredns -n kube-system
```

### etcd 장애 복구 체크리스트

etcd 장애는 클러스터 전체를 마비시키므로 가장 심각한 장애이다.

```bash
# Step 1: etcd Pod 상태 확인
kubectl get pods -n kube-system -l component=etcd
# kubectl이 동작하지 않으면 SSH 접속 후 crictl 사용
sudo crictl ps -a | grep etcd

# Step 2: etcd 로그 확인
sudo crictl logs $(sudo crictl ps -a | grep etcd | head -1 | awk '{print $1}') --tail=30

# Step 3: etcd 매니페스트 확인
sudo cat /etc/kubernetes/manifests/etcd.yaml

# Step 4: etcd 데이터 디렉토리 확인
sudo ls -la /var/lib/etcd/member/

# Step 5: etcd 건강 상태 확인
ETCDCTL_API=3 etcdctl endpoint health \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key
```

검증 (정상):

```text
https://127.0.0.1:2379 is healthy: successfully committed proposal: took = 2.5ms
```

검증 (비정상):

```text
{"level":"warn","ts":"2026-03-30T10:00:00.000Z","caller":"clientv3/retry_interceptor.go:62","msg":"retrying of unary invoker failed","target":"endpoint://client-xxx/127.0.0.1:2379","attempt":0,"error":"rpc error: code = DeadlineExceeded desc = context deadline exceeded"}
```

etcd 장애 시 스냅샷이 있으면 복원한다:

```bash
ETCDCTL_API=3 etcdctl snapshot restore /opt/etcd-backup.db \
  --data-dir=/var/lib/etcd-restored

sudo sed -i 's|/var/lib/etcd|/var/lib/etcd-restored|g' /etc/kubernetes/manifests/etcd.yaml
# etcd Pod 자동 재시작 대기
```

### 네트워크 장애 체계적 진단 (OSI 계층별)

Pod 간 통신 불가 시 OSI 계층별로 진단한다:

| 계층 | 진단 명령 | 정상 출력 | 비정상 시 원인 |
|---|---|---|---|
| **L3 (IP)** | `ping -c 3 <pod-ip>` | `64 bytes from ...` | CNI 장애, 라우팅 문제 |
| **L4 (TCP)** | `nc -zv <pod-ip> <port>` | `Connection succeeded` | 컨테이너 미실행, 포트 미오픈 |
| **L7 (HTTP)** | `curl -s http://<service>` | HTTP 응답 | 애플리케이션 오류, 인증 문제 |
| **DNS** | `nslookup <service>` | IP 주소 반환 | CoreDNS 장애, resolv.conf 문제 |
| **Endpoint** | `kubectl get endpoints <svc>` | Pod IP 목록 | selector 불일치, Pod NotReady |
| **NetworkPolicy** | `kubectl get networkpolicies` | 정책 목록 | 트래픽 차단 정책 존재 |
