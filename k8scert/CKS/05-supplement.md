# CKS 보충 학습 자료

기존 CKS 학습 자료(01~04)에서 다루지 못한 핵심 토픽을 보강하고, 추가 실전 예제와 확인 문제, 기출 유형 덤프 문제를 수록한 보충 문서이다.

---

# Part 1: 누락된 개념 보강

---

## 1. Linux Capabilities in SecurityContext

### 이 보안 통제가 없던 시절의 문제

Linux에서 프로세스 권한은 전통적으로 root(UID 0)와 non-root의 이분법으로 나뉘었다. root 프로세스는 커널이 제공하는 **모든 특권**을 가졌다. 네트워크 설정 변경, 파일 권한 무시, 커널 모듈 로딩, 다른 프로세스 추적 등 제한이 없었다. 컨테이너 환경에서 이것은 치명적이다. 컨테이너 하나가 침해되면 root 권한으로 호스트 커널에 대한 모든 작업이 가능해지고, 컨테이너 탈출(container escape)로 이어질 수 있었다.

POSIX 초안에서 capabilities 개념이 제안되었고, Linux 커널 2.2(1999년)에서 처음 구현되었다. Linux Capabilities는 root 권한을 약 40개의 개별 권한(capability)으로 분할한 커널 메커니즘이다. 각 capability는 특정 커널 기능에 대한 접근 권한을 나타낸다. 컨테이너에 `NET_BIND_SERVICE`만 부여하면 1024 미만 포트 바인딩은 가능하지만, 커널 모듈 로딩이나 네트워크 설정 변경은 불가능하다.

### 방어하는 공격 벡터

| 공격 시나리오 | 관련 Capability | 차단 효과 |
|---|---|---|
| 컨테이너 탈출: 커널 모듈 로딩 | `SYS_MODULE` | 악성 커널 모듈을 로드하여 호스트를 장악하는 공격을 차단한다 |
| 네트워크 스니핑/스푸핑 | `NET_RAW`, `NET_ADMIN` | raw socket을 생성하여 네트워크 트래픽을 가로채는 공격을 차단한다 |
| 프로세스 인젝션 | `SYS_PTRACE` | 다른 프로세스의 메모리를 읽거나 코드를 주입하는 공격을 차단한다 |
| 파일시스템 탈출 | `DAC_OVERRIDE`, `DAC_READ_SEARCH` | 파일 권한을 무시하고 민감한 파일에 접근하는 공격을 차단한다 |
| 권한 상승 | `SETUID`, `SETGID` | UID/GID를 변경하여 다른 사용자 권한을 획득하는 공격을 차단한다 |
| 호스트 namespace 탈출 | `SYS_ADMIN` | mount, unshare 등을 통해 컨테이너 격리를 우회하는 공격을 차단한다 |

### 커널 레벨 동작 원리

Linux 커널은 프로세스마다 다섯 가지 capability 집합을 관리한다:

1. **Effective set**: 현재 프로세스가 실제로 사용할 수 있는 capability 집합이다. 커널은 권한 검사 시 이 집합을 확인한다
2. **Permitted set**: 프로세스가 effective set에 추가할 수 있는 capability의 상한선이다. effective set은 permitted set의 부분집합이어야 한다
3. **Inheritable set**: fork/exec 시 자식 프로세스에 전달되는 capability 집합이다
4. **Bounding set**: 프로세스와 자식 프로세스가 가질 수 있는 capability의 최대 범위이다. exec() 호출 시 permitted set의 상한을 제한한다
5. **Ambient set**: non-root 프로그램이 exec() 후에도 유지할 수 있는 capability 집합이다

커널의 capability 검사 흐름:

```
프로세스가 특권 작업 요청 (예: bind(port < 1024))
    → 커널: capable() 함수 호출
    → current->cred->cap_effective에서 해당 capability bit 검사
    → bit가 설정되어 있으면 허용, 아니면 -EPERM 반환
```

컨테이너 런타임(containerd, CRI-O)은 컨테이너 프로세스 생성 시 커널의 `capset()` syscall을 호출하여 이 집합을 조정한다. `drop: ALL`을 지정하면 bounding set이 비워지고, `add: NET_BIND_SERVICE`를 지정하면 해당 capability만 bounding set에 추가된다.

### 핵심 개념

- Linux 커널은 약 40개 이상의 capability를 정의한다 (예: `NET_BIND_SERVICE`, `SYS_PTRACE`, `NET_ADMIN` 등)
- 컨테이너 런타임(Docker, containerd)은 기본적으로 일부 capability를 부여한다
- CKS에서는 **모든 capability를 제거(drop ALL)한 뒤, 필요한 것만 추가(add)**하는 패턴이 정석이다
- `securityContext.capabilities`는 **컨테이너 레벨**에서만 설정 가능하다 (Pod 레벨 아님)

### 주요 Capabilities 목록

| Capability | 설명 | 위험도 | 커널 함수 |
|---|---|---|---|
| `NET_BIND_SERVICE` | 1024 미만 포트 바인딩 허용 | 낮음 | inet_bind() |
| `NET_ADMIN` | 네트워크 설정 변경 (iptables 등) | 높음 | ip_setsockopt() |
| `NET_RAW` | raw socket 생성 (패킷 스니핑 가능) | 높음 | sock_create() |
| `SYS_PTRACE` | 프로세스 추적 (디버깅) | 높음 | ptrace() |
| `SYS_ADMIN` | 가장 위험한 capability, 거의 root와 동일 | 매우 높음 | mount(), unshare() |
| `SYS_MODULE` | 커널 모듈 로드/언로드 | 매우 높음 | init_module() |
| `DAC_OVERRIDE` | 파일 권한 검사 우회 | 높음 | inode_permission() |
| `CHOWN` | 파일 소유자 변경 | 중간 | chown() |
| `SETUID` / `SETGID` | UID/GID 변경 | 높음 | setuid(), setgid() |
| `MKNOD` | 디바이스 파일 생성 | 중간 | mknod() |

### 컨테이너 런타임 기본 Capabilities

Docker/containerd가 기본으로 부여하는 capability 목록을 아는 것이 중요하다. `drop: ALL`을 하지 않으면 다음이 기본 포함된다:

```
AUDIT_WRITE, CHOWN, DAC_OVERRIDE, FOWNER, FSETID, KILL,
MKNOD, NET_BIND_SERVICE, NET_RAW, SETFCAP, SETGID, SETPCAP, SETUID, SYS_CHROOT
```

이 중 `NET_RAW`는 ARP 스푸핑 공격에 사용될 수 있고, `DAC_OVERRIDE`는 파일 권한 우회에 사용될 수 있다. 따라서 `drop: ALL` 후 필요한 것만 추가하는 것이 필수이다.

### YAML 예제: drop ALL + add 필요한 것만

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: secure-nginx
  namespace: production
spec:
  containers:
  - name: nginx
    image: nginxinc/nginx-unprivileged:1.25
    ports:
    - containerPort: 80
    securityContext:
      runAsNonRoot: true
      runAsUser: 1000
      allowPrivilegeEscalation: false
      capabilities:
        drop:
        - ALL
        add:
        - NET_BIND_SERVICE
```

### 검증

```bash
# 검증 1: Pod 배포 후 상태 확인
kubectl apply -f secure-nginx.yaml
kubectl get pod secure-nginx -n production
```

```text
NAME           READY   STATUS    RESTARTS   AGE
secure-nginx   1/1     Running   0          10s
```

```bash
# 검증 2: Pod 내부에서 현재 capability 확인
kubectl exec secure-nginx -n production -- cat /proc/1/status | grep -i cap
```

```text
CapInh:	0000000000000400
CapPrm:	0000000000000400
CapEff:	0000000000000400
CapBnd:	0000000000000400
CapAmb:	0000000000000000
```

0x400은 10진수 1024이며, bit 10이 설정되어 있다. bit 10은 `CAP_NET_BIND_SERVICE`에 해당한다. 다른 모든 bit가 0이므로 NET_BIND_SERVICE만 활성화된 것이다.

```bash
# 검증 3: capsh로 디코딩 (capsh가 설치되어 있는 경우)
kubectl exec secure-nginx -n production -- capsh --decode=0000000000000400
```

```text
0x0000000000000400=cap_net_bind_service
```

```bash
# 검증 4: 차단 동작 확인 - 네트워크 설정 변경 시도 (NET_ADMIN 없음)
kubectl exec secure-nginx -n production -- ip link set lo down
```

```text
RTNETLINK answers: Operation not permitted
```

NET_ADMIN capability가 없으므로 네트워크 인터페이스 조작이 차단된다.

```bash
# 검증 5: 차단 동작 확인 - 파일 소유권 변경 시도 (CHOWN 없음)
kubectl exec secure-nginx -n production -- chown nobody /tmp
```

```text
chown: /tmp: Operation not permitted
```

CHOWN capability가 없으므로 파일 소유권 변경이 차단된다.

### 트러블슈팅: Capabilities 관련 문제

| 증상 | 원인 | 해결 방법 |
|---|---|---|
| Pod가 CrashLoopBackOff | drop ALL로 애플리케이션에 필요한 capability도 제거됨 | strace로 필요한 syscall 확인 후 해당 capability 추가 |
| 포트 80 바인딩 실패 | NET_BIND_SERVICE가 없음 | `add: [NET_BIND_SERVICE]` 추가 |
| capabilities 설정이 Pod 레벨에서 거부됨 | capabilities는 컨테이너 레벨에서만 설정 가능 | securityContext를 컨테이너 레벨로 이동 |
| PodSecurity restricted에서 거부됨 | drop ALL이 없음 | `drop: ["ALL"]` 추가 |

### CKS 시험에서의 포인트

- `drop: ["ALL"]`을 먼저 선언하고, `add`로 필요한 것만 추가하라는 문제가 자주 출제된다
- `SYS_ADMIN`은 절대 추가하면 안 된다 -- mount, unshare 등 컨테이너 탈출에 사용될 수 있기 때문이다
- PodSecurity admission의 `restricted` 프로필은 `drop: ALL`을 강제한다
- capabilities는 **컨테이너 레벨** securityContext에서만 설정 가능하다. Pod 레벨에서 설정하면 API 에러가 발생한다

---

## 2. kubectl auth can-i (RBAC 트러블슈팅)

### 이 도구가 없던 시절의 문제

RBAC 설정 오류를 디버깅하려면 Role, RoleBinding, ClusterRole, ClusterRoleBinding을 일일이 조회하고 rules를 수동으로 분석해야 했다. ServiceAccount가 여러 RoleBinding과 ClusterRoleBinding에 연결되어 있으면 최종 권한을 파악하는 것이 사실상 불가능했다. 잘못된 RBAC 설정은 보안 사고(과도한 권한 부여)나 운영 장애(필요한 권한 누락)로 직결된다.

`kubectl auth can-i`는 RBAC 평가 결과를 직접 질의할 수 있는 도구이다. API 서버의 SubjectAccessReview API를 호출하여 실제 인가 결정을 반환한다. 이것은 단순히 Role을 읽는 것이 아니라, 모든 RoleBinding과 ClusterRoleBinding을 종합한 최종 권한 판정 결과이다.

### 커널 레벨 동작 원리

`kubectl auth can-i`는 커널 레벨에서 동작하지 않는다. API 서버의 인가 모듈에서 처리된다. 내부 동작은 다음과 같다:

```
kubectl auth can-i create pods --as=jane
    → kubectl이 SubjectAccessReview 리소스 생성
    → API 서버의 Authorization webhook으로 전달
    → RBAC authorizer가 모든 Role/RoleBinding 평가
    → SubjectAccessReview.status.allowed = true/false 반환
    → kubectl이 "yes" 또는 "no" 출력
```

SubjectAccessReview는 실제 리소스 생성이 아니라 인가 판정만 수행하는 dry-run이다. 따라서 부작용(side effect)이 없다.

### 방어하는 공격 벡터

| 위협 시나리오 | auth can-i의 역할 |
|---|---|
| ServiceAccount에 과도한 권한 부여 | `--list` 옵션으로 전체 권한을 감사하여 불필요한 권한을 식별한다 |
| 권한 상승 경로 탐지 | 특정 SA가 다른 SA의 토큰을 읽거나, Role/RoleBinding을 생성할 수 있는지 확인한다 |
| anonymous 접근 검증 | `--as=system:anonymous`로 미인증 사용자의 접근 가능 범위를 검증한다 |
| 네임스페이스 간 권한 누수 | 특정 SA가 다른 네임스페이스의 리소스에 접근 가능한지 확인한다 |

### 기본 사용법

```bash
# 현재 사용자가 Pod를 생성할 수 있는지 확인
kubectl auth can-i create pods
```

```text
yes
```

```bash
# 특정 네임스페이스에서 확인
kubectl auth can-i delete deployments -n kube-system
```

```text
yes
```

```bash
# 모든 권한 목록 확인
kubectl auth can-i --list
```

```text
Resources                                       Non-Resource URLs   Resource Names   Verbs
*.*                                             []                  []               [*]
                                                [*]                 []               [*]
```

```bash
# 특정 네임스페이스에서 모든 권한 목록 확인
kubectl auth can-i --list -n production
```

### 다른 사용자/ServiceAccount로 확인

```bash
# 특정 사용자로 확인
kubectl auth can-i create pods --as=jane
```

```text
no
```

```bash
# 특정 그룹으로 확인
kubectl auth can-i create pods --as=jane --as-group=developers

# ServiceAccount로 확인 (형식: system:serviceaccount:<namespace>:<sa-name>)
kubectl auth can-i get secrets --as=system:serviceaccount:default:my-sa
```

```text
no
```

```bash
# ServiceAccount가 특정 네임스페이스에서 수행 가능한 모든 동작 확인
kubectl auth can-i --list --as=system:serviceaccount:ci-cd:deployer -n staging
```

```text
Resources                                       Non-Resource URLs   Resource Names   Verbs
deployments.apps                                []                  []               [get list create update patch]
pods                                            []                  []               [get list watch]
services                                        []                  []               [get list create]
...
```

### RBAC 트러블슈팅 워크플로우

```bash
# 1단계: 권한 확인
kubectl auth can-i get pods --as=system:serviceaccount:app-ns:app-sa -n app-ns
```

```text
no
```

```bash
# 2단계: 해당 SA에 바인딩된 Role/ClusterRole 확인
kubectl get rolebindings -n app-ns -o wide
```

```text
NAME              ROLE                   AGE   USERS   GROUPS   SERVICEACCOUNTS
app-binding       Role/app-role          10d                    app-ns/app-sa
```

```bash
kubectl get clusterrolebindings -o wide | grep app-sa
```

```text
# 출력이 없으면 ClusterRoleBinding이 없는 것이다
```

```bash
# 3단계: Role의 rules 확인
kubectl describe role app-role -n app-ns
```

```text
Name:         app-role
Namespace:    app-ns
Labels:       <none>
Rules:
  Resources   Non-Resource URLs  Resource Names  Verbs
  ---------   -----------------  --------------  -----
  configmaps  []                 []              [get list]
```

pods에 대한 규칙이 없으므로 pods 접근이 거부된다. Role에 pods 규칙을 추가해야 한다.

```bash
# 4단계: 누락된 권한 추가
kubectl edit role app-role -n app-ns
# rules에 pods에 대한 get, list 권한을 추가한다
```

### 서브리소스(subresource) 권한 확인

```bash
# Pod의 로그를 볼 수 있는지 확인
kubectl auth can-i get pods --subresource=log -n production
```

```text
yes
```

```bash
# Pod에 exec할 수 있는지 확인
kubectl auth can-i create pods --subresource=exec -n production
```

```text
yes
```

### 검증: RBAC 보안 감사 체크리스트

```bash
# 검증 1: anonymous 사용자 권한 확인 (최소여야 한다)
kubectl auth can-i --list --as=system:anonymous
```

```text
Resources   Non-Resource URLs   Resource Names   Verbs
            [/healthz]          []               [get]
            [/livez]            []               [get]
            [/readyz]           []               [get]
            [/version]          []               [get]
```

비API 발견 경로(/healthz, /version 등)만 있어야 한다. pods, secrets 등 리소스에 대한 권한이 있으면 보안 위협이다.

```bash
# 검증 2: default ServiceAccount 권한 확인
kubectl auth can-i --list --as=system:serviceaccount:default:default -n default
```

```text
Resources   Non-Resource URLs   Resource Names   Verbs
            [/api/*]            []               [get]
            [/healthz]          []               [get]
            ...
```

최소 권한만 있어야 한다. get secrets 등이 있으면 위험하다.

```bash
# 검증 3: 특정 SA의 Secret 접근 차단 확인
kubectl auth can-i get secrets --as=system:serviceaccount:app-ns:app-sa -n app-ns
```

```text
no
```

Secret 접근은 명시적으로 필요한 SA에만 부여해야 한다.

```bash
# 검증 4: 권한 상승 경로 확인 (SA가 Role/RoleBinding을 생성할 수 있는지)
kubectl auth can-i create rolebindings --as=system:serviceaccount:app-ns:app-sa -n app-ns
```

```text
no
```

RoleBinding 생성 권한이 있으면 자기 자신에게 임의 권한을 부여할 수 있다. 이것은 권한 상승 공격 경로이다.

```bash
# 검증 5: 네임스페이스 간 권한 누수 확인
kubectl auth can-i get pods --as=system:serviceaccount:dev:dev-sa -n production
```

```text
no
```

dev 네임스페이스의 SA가 production에 접근할 수 없어야 한다.

### 트러블슈팅: RBAC 관련 문제

| 증상 | 원인 | 해결 방법 |
|---|---|---|
| auth can-i가 yes인데 실제로 거부됨 | Admission Controller(예: OPA)가 차단 | Admission webhook 확인 |
| auth can-i가 no인데 실제로 허용됨 | ClusterRoleBinding을 놓쳤을 수 있음 | `--list`로 전체 권한 확인 |
| SA에 예상치 못한 권한이 있음 | system: 접두사의 기본 ClusterRoleBinding | `kubectl get clusterrolebindings -o json | jq '...'`로 확인 |
| 특정 리소스에만 접근 불가 | apiGroups가 잘못 설정됨 | `kubectl api-resources`로 정확한 apiGroup 확인 |

---

## 3. Webhook Admission Controller 순서

### 이 메커니즘이 없던 시절의 문제

Admission Controller 이전에는 RBAC 인가를 통과한 요청이 곧바로 etcd에 저장되었다. RBAC은 "누가 무엇을 할 수 있는가"만 판단하며, "요청의 내용이 보안 정책에 부합하는가"는 검사하지 않는다. 예를 들어 사용자에게 Pod 생성 권한이 있으면, `privileged: true`인 Pod도 `hostPID: true`인 Pod도 모두 생성 가능했다.

Webhook Admission Controller는 쿠버네티스 1.9에서 GA가 되었다. API 서버가 요청을 etcd에 저장하기 전에 외부 서비스(webhook)를 호출하여 요청을 검증하거나 변환하는 확장 포인트이다. 이를 통해 조직의 보안 정책을 코드로 정의하고 자동으로 강제할 수 있다.

### 방어하는 공격 벡터

| 공격 시나리오 | Admission Controller의 역할 |
|---|---|
| privileged 컨테이너 생성 | ValidatingWebhook이 privileged Pod 생성을 거부한다 |
| 신뢰하지 않는 이미지 사용 | ImagePolicyWebhook이 서명되지 않은 이미지를 차단한다 |
| 보안 설정 누락 | MutatingWebhook이 securityContext, resource limits 등을 자동 주입한다 |
| 사이드카 없이 배포 | MutatingWebhook이 Istio sidecar, log agent 등을 자동 주입한다 |

### API 요청 처리 순서

```
클라이언트 요청
    |
Authentication (인증) -- 요청자의 신원 확인 (인증서, 토큰, OIDC 등)
    |
Authorization (인가: RBAC 등) -- 요청자가 해당 작업을 수행할 권한이 있는지 확인
    |
Mutating Admission Webhooks (변환)  <-- 요청 내용을 수정할 수 있음
    |                                    예: 사이드카 주입, 기본값 설정
Object Schema Validation (스키마 검증) -- OpenAPI 스키마 검증
    |
Validating Admission Webhooks (검증)  <-- 수정 불가, 허용/거부만 결정
    |                                      예: privileged 차단, 이미지 정책 검증
etcd에 저장
```

이 순서의 설계 근거:
1. Mutating이 먼저 실행되는 이유: webhook이 요청을 수정한 뒤 Validating webhook이 최종 형태를 검증해야 하기 때문이다. 순서가 반대이면 수정된 요청이 검증을 통과하지 못할 수 있다
2. Schema Validation이 Mutating과 Validating 사이에 있는 이유: Mutating webhook이 잘못된 필드를 추가하는 것을 방지한다

### 핵심 포인트

- **MutatingAdmissionWebhook**이 **ValidatingAdmissionWebhook**보다 먼저 실행된다
- Mutating은 요청 객체를 수정할 수 있다 (예: 사이드카 주입, 기본값 설정)
- Validating은 요청을 수정할 수 없으며, 승인 또는 거부만 한다
- 같은 종류의 webhook이 여러 개 있으면, 이름 알파벳 순서로 실행된다
- 하나의 webhook이라도 거부하면 전체 요청이 거부된다

### MutatingWebhookConfiguration 예제

```yaml
apiVersion: admissionregistration.k8s.io/v1
kind: MutatingWebhookConfiguration
metadata:
  name: sidecar-injector
webhooks:
- name: sidecar-injector.example.com
  admissionReviewVersions: ["v1"]
  sideEffects: None
  clientConfig:
    service:
      name: sidecar-injector-svc
      namespace: kube-system
      path: "/mutate"
    caBundle: <base64-encoded-CA-cert>
  rules:
  - operations: ["CREATE"]
    apiGroups: [""]
    apiVersions: ["v1"]
    resources: ["pods"]
  namespaceSelector:
    matchLabels:
      sidecar-injection: enabled
  failurePolicy: Fail      # webhook 호출 실패 시: Fail(거부) 또는 Ignore(허용)
  timeoutSeconds: 10
```

### ValidatingWebhookConfiguration 예제

```yaml
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingWebhookConfiguration
metadata:
  name: pod-policy
webhooks:
- name: pod-policy.example.com
  admissionReviewVersions: ["v1"]
  sideEffects: None
  clientConfig:
    service:
      name: pod-policy-svc
      namespace: kube-system
      path: "/validate"
    caBundle: <base64-encoded-CA-cert>
  rules:
  - operations: ["CREATE", "UPDATE"]
    apiGroups: [""]
    apiVersions: ["v1"]
    resources: ["pods"]
  failurePolicy: Fail
  timeoutSeconds: 5
```

### 검증

```bash
# 검증 1: 등록된 webhook 목록 확인
kubectl get mutatingwebhookconfigurations
```

```text
NAME                             WEBHOOKS   AGE
istio-sidecar-injector           1          10d
falco-webhook                    1          5d
```

```bash
kubectl get validatingwebhookconfigurations
```

```text
NAME                             WEBHOOKS   AGE
gatekeeper-validating-webhook    1          5d
```

```bash
# 검증 2: webhook 상세 정보 확인
kubectl describe mutatingwebhookconfiguration istio-sidecar-injector
```

```text
Name:         istio-sidecar-injector
...
Webhooks:
  Name:                          sidecar-injector.istio.io
  Client Config:
    Service:
      Name:       istiod
      Namespace:  istio-system
      Path:       /inject
  Failure Policy:  Fail
  Namespace Selector:
    Match Labels:
      istio-injection: enabled
  Rules:
    Operations:  CREATE
    Resources:   pods
```

```bash
# 검증 3: MutatingWebhook 동작 확인 (사이드카 주입 예시)
kubectl label namespace test-ns sidecar-injection=enabled
kubectl run test --image=nginx -n test-ns
kubectl get pod test -n test-ns -o jsonpath='{.spec.containers[*].name}'
```

```text
test istio-proxy
```

사이드카 컨테이너(istio-proxy)가 자동 주입되었다.

```bash
# 검증 4: ValidatingWebhook 차단 동작 확인
kubectl run privileged-test --image=nginx --overrides='{"spec":{"containers":[{"name":"test","image":"nginx","securityContext":{"privileged":true}}]}}'
```

```text
Error from server: admission webhook "pod-policy.example.com" denied the request: privileged containers are not allowed
```

```bash
# 검증 5: failurePolicy 동작 확인 (webhook 서비스 다운 시)
# failurePolicy: Fail이면 -> 모든 관련 요청 거부
# failurePolicy: Ignore이면 -> webhook 실패를 무시하고 요청 통과
```

### 트러블슈팅: Webhook 관련 문제

| 증상 | 원인 | 해결 방법 |
|---|---|---|
| 모든 Pod 생성이 실패 | failurePolicy: Fail이고 webhook 서비스 다운 | webhook 서비스 복구 또는 failurePolicy를 임시로 Ignore로 변경 |
| caBundle 에러 | CA 인증서가 만료되거나 잘못됨 | cert-manager 등으로 인증서 갱신 |
| webhook timeout | webhook 서비스 응답 지연 | timeoutSeconds 증가 또는 webhook 서비스 성능 개선 |
| 특정 네임스페이스에서만 적용 | namespaceSelector 조건 확인 | 라벨이 일치하는지 확인 |

### CKS 시험 팁

- `failurePolicy: Fail`은 webhook 서비스 장애 시 모든 관련 요청을 거부한다 (보안상 권장)
- `failurePolicy: Ignore`는 webhook 장애 시 요청을 그대로 통과시킨다
- OPA Gatekeeper는 ValidatingAdmissionWebhook으로 동작한다
- Pod Security Admission은 빌트인 Admission Controller이다 (webhook이 아님)
- Istio sidecar injection은 MutatingAdmissionWebhook으로 동작한다

---

## 4. etcd 암호화 검증 절차

### 이 보안 통제가 없던 시절의 문제

etcd에 저장되는 쿠버네티스 Secret은 기본적으로 Base64 인코딩만 되어 있다. Base64는 암호화가 아니라 인코딩이다. `echo "bXlwYXNzd29yZA==" | base64 -d`만 실행하면 원문을 즉시 얻을 수 있다. etcd에 직접 접근할 수 있는 공격자(예: etcd 백업 파일 탈취, etcd 노드 침해)는 모든 Secret(데이터베이스 비밀번호, API 키, TLS 인증서 등)을 평문으로 읽을 수 있었다.

EncryptionConfiguration은 쿠버네티스 1.13에서 GA가 되었다. API 서버가 etcd에 데이터를 쓰기 전에 암호화하고, 읽을 때 복호화하는 메커니즘이다. 이를 통해 etcd 데이터 파일이나 백업이 탈취되더라도 Secret의 내용을 보호할 수 있다.

### 방어하는 공격 벡터

| 공격 시나리오 | 암호화의 방어 효과 |
|---|---|
| etcd 백업 파일 탈취 | 백업 파일 내 Secret이 암호화되어 있어 복호화 키 없이 읽을 수 없다 |
| etcd 노드 디스크 접근 | 물리 디스크에 저장된 데이터가 암호화되어 있다 |
| etcd 스냅샷 탈취 | etcdctl snapshot으로 생성한 스냅샷의 Secret이 보호된다 |
| 내부자 위협 | etcd 관리자도 암호화 키 없이 Secret을 읽을 수 없다 |

### 암호화 동작 원리

```
kubectl create secret -> API 서버 수신
    |
API 서버: EncryptionConfiguration의 첫 번째 provider로 암호화
    |
암호화된 데이터를 etcd에 저장 (접두사: k8s:enc:<provider>:v1:<key-name>:)
    |
kubectl get secret -> API 서버가 etcd에서 읽고 복호화 후 반환
```

provider 순서가 중요하다:
- **첫 번째** provider: 새 데이터 쓰기(암호화)에 사용된다
- **나머지** provider: 기존 데이터 읽기(복호화)에 사용된다
- `identity: {}`를 마지막에 두면 암호화 적용 전에 저장된 평문 Secret도 읽을 수 있다

### 암호화 알고리즘 비교

| Provider | 알고리즘 | 키 크기 | 특징 |
|---|---|---|---|
| aescbc | AES-CBC | 32바이트 | 가장 널리 사용됨. 패딩 오라클 공격에 이론적으로 취약하나 실제 위험은 낮음 |
| aesgcm | AES-GCM | 32바이트 | 인증 암호화(AEAD) 지원. 키 자동 순환이 필요하다 |
| secretbox | XSalsa20+Poly1305 | 32바이트 | NaCl 라이브러리 기반. 가장 현대적인 알고리즘 |
| kms | 외부 KMS | KMS 의존 | 키가 API 서버 노드에 저장되지 않는다 |
| identity | 없음 | 없음 | 암호화하지 않는다 (평문 저장) |

### 암호화 설정 파일

```yaml
# /etc/kubernetes/enc/encryption-config.yaml
apiVersion: apiserver.config.k8s.io/v1
kind: EncryptionConfiguration
resources:
- resources:
  - secrets
  providers:
  - aescbc:
      keys:
      - name: key1
        secret: <base64-encoded-32-byte-key>
  - identity: {}   # 암호화되지 않은 기존 Secret 읽기용 (fallback)
```

### API 서버 설정

```bash
# kube-apiserver manifest 수정
sudo vi /etc/kubernetes/manifests/kube-apiserver.yaml
```

```yaml
# kube-apiserver에 추가할 설정
spec:
  containers:
  - command:
    - kube-apiserver
    - --encryption-provider-config=/etc/kubernetes/enc/encryption-config.yaml
    # ... 기존 설정 유지
    volumeMounts:
    - name: enc-config
      mountPath: /etc/kubernetes/enc
      readOnly: true
  volumes:
  - name: enc-config
    hostPath:
      path: /etc/kubernetes/enc
      type: DirectoryOrCreate
```

### 암호화 검증 절차 (시험에서 자주 출제)

```bash
# 1단계: 테스트 Secret 생성
kubectl create secret generic test-secret \
  --from-literal=mykey=mydata \
  -n default

# 2단계: etcd에서 직접 읽어서 암호화 여부 확인
ETCDCTL_API=3 etcdctl get /registry/secrets/default/test-secret \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key
```

암호화 전:
```text
/registry/secrets/default/test-secret
k8s

v1Secret...mydata...
```

암호화 후:
```text
/registry/secrets/default/test-secret
k8s:enc:aescbc:v1:key1:... (바이너리 데이터)
```

```bash
# 3단계: 기존 Secret을 모두 재암호화 (암호화 설정 적용 후)
kubectl get secrets --all-namespaces -o json | \
  kubectl replace -f -
```

### 검증

```bash
# 검증 1: etcdctl 출력에서 암호화 접두사 확인
ETCDCTL_API=3 etcdctl get /registry/secrets/default/test-secret \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key | hexdump -C | head -5
```

```text
00000000  2f 72 65 67 69 73 74 72  79 2f 73 65 63 72 65 74  |/registry/secret|
00000010  73 2f 64 65 66 61 75 6c  74 2f 74 65 73 74 2d 73  |s/default/test-s|
00000020  65 63 72 65 74 0a 6b 38  73 3a 65 6e 63 3a 61 65  |ecret.k8s:enc:ae|
00000030  73 63 62 63 3a 76 31 3a  6b 65 79 31 3a xx xx xx  |scbc:v1:key1:...|
```

"k8s:enc:aescbc:v1:key1:" 문자열이 보이면 암호화 성공이다.

```bash
# 검증 2: kubectl로는 정상적으로 복호화되어 읽히는지 확인
kubectl get secret test-secret -o jsonpath='{.data.mykey}' | base64 -d
```

```text
mydata
```

API 서버가 etcd에서 읽을 때 자동 복호화하므로 정상 값이 반환된다.

```bash
# 검증 3: identity provider가 첫 번째인지 확인 (보안 위험)
cat /etc/kubernetes/enc/encryption-config.yaml | grep -A2 providers
```

identity가 첫 번째이면 새 Secret이 평문으로 저장된다. 반드시 aescbc나 kms가 첫 번째여야 한다.

```bash
# 검증 4: API 서버가 encryption-provider-config 플래그를 사용하는지 확인
ps aux | grep kube-apiserver | grep encryption-provider-config
```

```text
... --encryption-provider-config=/etc/kubernetes/enc/encryption-config.yaml ...
```

이 플래그가 없으면 암호화가 활성화되지 않은 것이다.

### 트러블슈팅: etcd 암호화 관련 문제

| 증상 | 원인 | 해결 방법 |
|---|---|---|
| API 서버 시작 실패 | EncryptionConfiguration YAML 문법 오류 | `kubectl apply --dry-run=server`로 검증 |
| Secret 읽기 실패 (500 에러) | 이전 암호화 키가 config에 없음 | identity provider를 fallback으로 추가 |
| 재암호화 후 일부 실패 | immutable Secret은 replace 불가 | immutable Secret 삭제 후 재생성 |
| 암호화 후 etcd 스토리지 증가 | 암호화된 데이터가 원본보다 크다 | 예상된 동작. 스토리지 용량 확보 |

### 검증 시 확인할 사항

1. etcdctl 출력에서 `k8s:enc:aescbc:v1:<key-name>:` 접두사가 있으면 암호화 성공이다
2. `identity` provider가 첫 번째이면 암호화가 **비활성화**된 상태이다
3. 암호화 provider의 순서가 중요하다: 첫 번째 provider가 쓰기(암호화)에 사용되고, 나머지는 읽기(복호화)에 사용된다

---

## 5. Sysdig를 활용한 런타임 보안

### 이 도구가 없던 시절의 문제

컨테이너 런타임에서 어떤 일이 일어나는지 가시성이 없었다. 컨테이너가 침해되어 악성 바이너리를 다운로드하거나, 민감한 파일을 읽거나, 비정상적인 네트워크 연결을 수립해도 호스트 레벨에서는 감지할 수 없었다. 로그 기반 모니터링은 애플리케이션이 로그를 남기는 행위만 감지하며, 시스템 콜 레벨의 악성 행위(파일 읽기, 네트워크 연결, 프로세스 실행)는 로그에 남지 않는다.

Sysdig는 2014년에 릴리스된 Linux 시스템 활동 모니터링 도구이다. 커널 수준에서 시스템 콜(syscall)을 캡처하여 컨테이너 런타임 활동을 모니터링한다. Falco의 기반 기술이기도 하다.

### 커널 레벨 동작 원리

Sysdig는 두 가지 방식으로 커널 이벤트를 캡처한다:

1. **커널 모듈 방식**: sysdig-probe 커널 모듈을 로드하여 tracepoint에 attach한다. syscall 진입/종료 시 커널이 sysdig 모듈을 호출한다
2. **eBPF 방식**: eBPF 프로그램을 tracepoint에 attach한다. 커널 모듈보다 안전하며 커널 재컴파일이 불필요하다

```
프로세스 → syscall(open, read, write, connect, execve, ...)
    → 커널 tracepoint에서 이벤트 캡처 (eBPF 또는 커널 모듈)
    → ring buffer를 통해 사용자 공간의 sysdig 프로세스로 전달
    → 필터 표현식 평가
    → 매칭 시 이벤트 출력
```

### 방어하는 공격 벡터

| 공격 시나리오 | Sysdig의 탐지 방법 |
|---|---|
| 민감 파일 접근 (/etc/shadow) | `evt.type=open and fd.name=/etc/shadow` 필터로 탐지한다 |
| 악성 바이너리 다운로드 후 실행 | `evt.type=execve` 필터로 비정상 프로세스 실행을 탐지한다 |
| 리버스 셸 연결 | `evt.type=connect` 필터로 비정상 네트워크 연결을 탐지한다 |
| 크립토마이닝 | 마이닝 프로세스 이름이나 마이닝 풀 포트 연결을 탐지한다 |

### 기본 사용법

```bash
# 컨테이너에서 발생하는 모든 이벤트 캡처 (30초간)
sysdig -M 30 container.name=nginx

# 특정 시스템 콜만 필터링
sysdig evt.type=open and container.name=nginx

# 파일 열기 이벤트 필터링
sysdig evt.type=openat and container.id!=host

# 프로세스 실행 이벤트 확인
sysdig evt.type=execve and container.name=webapp

# 네트워크 연결 이벤트 확인
sysdig evt.type=connect and container.name=webapp
```

### 주요 필터 필드

| 필드 | 설명 | 예제 |
|---|---|---|
| `container.name` | 컨테이너 이름 | `container.name=nginx` |
| `container.id` | 컨테이너 ID | `container.id!=host` |
| `proc.name` | 프로세스 이름 | `proc.name=bash` |
| `fd.name` | 파일 디스크립터 이름 (파일 경로) | `fd.name=/etc/shadow` |
| `evt.type` | 시스템 콜 유형 | `evt.type=execve` |
| `evt.dir` | 이벤트 방향 (< 진입, > 종료) | `evt.dir=<` |
| `user.name` | 사용자 이름 | `user.name=root` |
| `fd.rport` | 원격 포트 | `fd.rport=4444` |

### CKS 시험에서의 Sysdig 활용

```bash
# 특정 컨테이너에서 /etc/shadow 접근 시도 탐지
sysdig "evt.type=open and fd.name=/etc/shadow and container.id!=host"

# 특정 Pod에서 실행된 프로세스 목록 확인
sysdig -p "%proc.name %proc.args" "evt.type=execve and container.name=suspicious-pod"

# 결과를 파일로 저장 (시험에서 파일 저장을 요구할 수 있음)
sysdig -p "%evt.time %proc.name %evt.type %fd.name" \
  "container.name=webapp and evt.type in (open,openat)" > /opt/sysdig-output.txt
```

### 검증

```bash
# 검증 1: sysdig가 컨테이너 이벤트를 캡처하는지 확인
sysdig -M 5 container.name=nginx evt.type=openat 2>/dev/null | head -10
```

```text
12345 10:30:00.000 0 nginx (12345) > openat dirfd=-100(AT_FDCWD) name=/etc/nginx/nginx.conf flags=1(O_RDONLY)
12346 10:30:00.001 0 nginx (12345) < openat fd=3(/etc/nginx/nginx.conf)
```

nginx 컨테이너의 파일 열기 이벤트가 표시된다.

```bash
# 검증 2: 민감 파일 접근 탐지 확인
# 터미널 1에서 sysdig 실행:
sysdig "evt.type=open and fd.name contains /etc/shadow and container.id!=host"
# 터미널 2에서 컨테이너에서 /etc/shadow 읽기:
kubectl exec test-pod -- cat /etc/shadow
```

```text
12347 10:30:05.000 0 cat (12346) > open /etc/shadow flags=1(O_RDONLY)
```

```bash
# 검증 3: 프로세스 실행 감지
# 터미널 1:
sysdig -p "%evt.time %proc.name %proc.args" "evt.type=execve and container.name=test-pod"
# 터미널 2:
kubectl exec test-pod -- ls /
```

```text
10:30:10.000 ls /
```

```bash
# 검증 4: 결과 파일이 올바르게 저장되었는지 확인
cat /opt/sysdig-output.txt | wc -l
```

```text
42
```

이벤트 수가 0보다 크면 정상이다.

### Sysdig vs Falco 비교

| 항목 | Sysdig | Falco |
|---|---|---|
| 용도 | 상세 시스템 콜 분석 (포렌식) | 실시간 규칙 기반 탐지 (알림) |
| 설정 | 필터 표현식 | YAML 규칙 파일 |
| 출력 | 원시 이벤트 데이터 | 구조화된 알림 |
| 시험 빈도 | 가끔 출제 | 자주 출제 |
| 사용 시점 | 사후 분석(포렌식) | 실시간 탐지 |
| 커널 접근 | tracepoint/eBPF | tracepoint/eBPF (Sysdig 엔진 기반) |

### 트러블슈팅: Sysdig 관련 문제

| 증상 | 원인 | 해결 방법 |
|---|---|---|
| sysdig 실행 실패 | 커널 모듈/eBPF 프로브 로드 실패 | `modprobe sysdig-probe` 또는 eBPF 모드 사용 |
| 컨테이너 이벤트 없음 | container.name 필터가 잘못됨 | `sysdig -M 1 -c lscontainers`로 컨테이너 이름 확인 |
| 이벤트가 너무 많음 | 필터가 너무 넓음 | evt.type, proc.name 등 추가 필터 적용 |

---

## 6. 컨테이너 불변성(Immutability) 강제 패턴

### 이 보안 통제가 없던 시절의 문제

컨테이너의 파일시스템이 쓰기 가능한 상태에서는 다음 공격이 가능하다:

1. **악성 바이너리 설치**: 공격자가 curl이나 wget으로 악성 코드를 다운로드하여 실행한다
2. **설정 파일 변조**: /etc/nginx/nginx.conf 등을 수정하여 트래픽을 가로채거나 백도어를 설치한다
3. **웹셸 배포**: /var/www/html에 웹셸을 작성하여 원격 접근 경로를 확보한다
4. **로그 삭제**: 침입 흔적을 제거하기 위해 로그 파일을 삭제하거나 수정한다

컨테이너 불변성(Immutability)은 실행 중인 컨테이너의 파일시스템이 변경되지 않도록 보장하는 것이다. 이미지 빌드 시점에 모든 파일이 확정되고, 런타임에는 수정이 불가능하다.

### 커널 레벨 동작 원리

`readOnlyRootFilesystem: true`는 컨테이너의 루트 파일시스템을 읽기 전용으로 마운트한다. 컨테이너 런타임은 overlayfs(또는 devicemapper)를 사용하여 이미지 레이어를 마운트하는데, 이 때 상위 레이어(upper dir)를 읽기 전용으로 설정한다.

```
overlay 마운트:
  lower dir: 이미지 레이어 (항상 읽기 전용)
  upper dir: 컨테이너 쓰기 레이어
    → readOnlyRootFilesystem=true이면 upper dir도 읽기 전용
    → 모든 쓰기 시도가 EROFS(Read-only file system) 에러 반환
  work dir: overlay 내부 작업용
  merged: 최종 마운트 포인트 (컨테이너가 보는 파일시스템)
```

emptyDir 볼륨은 별도의 tmpfs 또는 디스크 마운트이므로 overlay와 독립적이다. 따라서 readOnlyRootFilesystem이 true여도 emptyDir에 마운트된 경로는 쓰기가 가능하다.

### 방어하는 공격 벡터

| 공격 시나리오 | 불변성의 방어 효과 |
|---|---|
| 웹셸 업로드 | 루트 파일시스템이 읽기 전용이므로 파일을 생성할 수 없다 |
| 바이너리 교체 | /bin, /usr/bin 등에 악성 바이너리를 쓸 수 없다 |
| 설정 변조 | /etc 디렉토리에 쓸 수 없으므로 설정 파일 변조가 불가능하다 |
| 지속성 확보 | crontab, systemd unit 파일 등을 생성할 수 없어 재시작 후에도 악성 코드가 유지되지 않는다 |

### 불변성 강제를 위한 3가지 방법

#### 방법 1: readOnlyRootFilesystem

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: immutable-pod
spec:
  containers:
  - name: app
    image: nginx:1.25
    securityContext:
      readOnlyRootFilesystem: true
    volumeMounts:
    # nginx가 실행에 필요한 쓰기 가능 디렉토리만 tmpfs로 마운트
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

#### 방법 2: SecurityContext 조합 (가장 강력한 패턴)

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: fully-immutable-pod
spec:
  containers:
  - name: app
    image: gcr.io/my-project/app:v1.2.3   # 태그 대신 digest 사용 권장
    securityContext:
      readOnlyRootFilesystem: true          # 루트 파일시스템 읽기 전용
      runAsNonRoot: true                     # root 실행 금지
      runAsUser: 1000                        # 명시적 UID 지정
      allowPrivilegeEscalation: false        # 권한 상승 금지
      capabilities:
        drop:
        - ALL                                # 모든 capability 제거
    volumeMounts:
    - name: tmp
      mountPath: /tmp
  volumes:
  - name: tmp
    emptyDir:
      sizeLimit: 100Mi                       # tmpfs 크기 제한
```

#### 방법 3: PodSecurity Admission으로 클러스터 레벨 강제

```bash
# 네임스페이스에 restricted 프로필 적용
kubectl label namespace production \
  pod-security.kubernetes.io/enforce=restricted \
  pod-security.kubernetes.io/enforce-version=latest
```

`restricted` 프로필은 다음을 강제한다:
- `runAsNonRoot: true`
- `allowPrivilegeEscalation: false`
- `capabilities.drop: ["ALL"]`
- `seccompProfile.type: RuntimeDefault` 또는 `Localhost`

### 이미지 digest 사용으로 불변성 보장

```yaml
# 태그는 변경될 수 있으므로 digest를 사용한다
containers:
- name: app
  image: nginx@sha256:abc123def456...
```

태그를 사용하면 동일한 태그에 다른 이미지가 push될 수 있다. 공격자가 레지스트리를 침해하여 악성 이미지를 같은 태그로 push하면, 다음 Pod 재시작 시 악성 이미지가 실행된다. digest는 이미지의 SHA256 해시이므로 내용이 변경되면 digest도 변경되어 이 공격을 방어한다.

### 검증

```bash
# 검증 1: 루트 파일시스템 쓰기 차단 확인
kubectl apply -f immutable-pod.yaml
kubectl exec immutable-pod -- touch /test-file
```

```text
touch: /test-file: Read-only file system
```

```bash
# 검증 2: /bin에 바이너리 생성 시도 (악성 바이너리 설치 시뮬레이션)
kubectl exec immutable-pod -- sh -c "echo 'malicious' > /bin/evil"
```

```text
sh: /bin/evil: Read-only file system
```

```bash
# 검증 3: /etc에 설정 파일 수정 시도
kubectl exec immutable-pod -- sh -c "echo 'hacked' >> /etc/hosts"
```

```text
sh: can't create /etc/hosts: Read-only file system
```

```bash
# 검증 4: 허용된 쓰기 경로 확인 (emptyDir로 마운트된 /tmp)
kubectl exec immutable-pod -- touch /tmp/allowed-file
kubectl exec immutable-pod -- ls /tmp/allowed-file
```

```text
/tmp/allowed-file
```

/tmp은 emptyDir이므로 쓰기가 허용된다.

```bash
# 검증 5: 불변성 설정 확인
kubectl get pod immutable-pod -o jsonpath='{.spec.containers[0].securityContext.readOnlyRootFilesystem}'
```

```text
true
```

```bash
# 검증 6: emptyDir 크기 제한 확인
kubectl get pod fully-immutable-pod -o jsonpath='{.spec.volumes[0].emptyDir.sizeLimit}'
```

```text
100Mi
```

### 트러블슈팅: 불변성 관련 문제

| 증상 | 원인 | 해결 방법 |
|---|---|---|
| Pod가 CrashLoopBackOff | 애플리케이션이 쓰기 경로를 필요로 함 | 필요한 경로에 emptyDir 마운트 |
| nginx가 시작되지 않음 | /var/cache/nginx, /var/run 쓰기 불가 | 해당 경로에 emptyDir 마운트 |
| 로그 파일 생성 실패 | /var/log 쓰기 불가 | /var/log에 emptyDir 마운트 또는 stdout으로 로그 리다이렉트 |

---

## 7. KMS Provider를 활용한 Secret 암호화

### 이전 방식(aescbc)의 한계

aescbc 방식은 암호화 키가 API 서버 노드의 디스크에 평문으로 저장된다(`/etc/kubernetes/enc/encryption-config.yaml`). 이것은 다음 문제를 야기한다:

1. **키 탈취 위험**: 노드에 접근할 수 있는 공격자가 설정 파일에서 암호화 키를 직접 읽을 수 있다
2. **키 순환 어려움**: 키를 변경하려면 설정 파일을 수정하고 API 서버를 재시작한 뒤 모든 Secret을 재암호화해야 한다
3. **감사 불가**: 누가 언제 키에 접근했는지 추적할 수 없다
4. **단일 키**: 모든 Secret이 동일한 키로 암호화된다

KMS(Key Management Service) Provider는 외부 KMS(AWS KMS, GCP Cloud KMS, Azure Key Vault, HashiCorp Vault 등)를 사용하여 이 문제들을 해결한다. Envelope Encryption 방식을 사용하여 DEK(Data Encryption Key)를 KEK(Key Encryption Key)로 보호한다.

### KMS vs aescbc 비교

| 항목 | aescbc | KMS Provider |
|---|---|---|
| 키 관리 | 로컬 파일에 키 저장 | 외부 KMS에서 키 관리 |
| 키 순환 | 수동 (설정 파일 변경 + 재시작) | 자동 (KMS에서 관리) |
| 보안 수준 | 중간 (키가 디스크에 평문 존재) | 높음 (KEK가 KMS에만 존재) |
| Envelope Encryption | 미지원 | 지원 (DEK를 KEK로 암호화) |
| 감사 로그 | 없음 | KMS의 감사 로그로 키 사용 추적 가능 |
| 키 접근 제어 | 파일 퍼미션에 의존 | KMS의 IAM 정책으로 세밀한 제어 |

### KMS Provider 동작 원리 (Envelope Encryption)

```
1. API 서버가 Secret 저장 요청을 받는다
2. 로컬에서 Data Encryption Key(DEK)를 무작위 생성한다
3. DEK로 Secret 데이터를 암호화한다 (AES-GCM 등)
4. KMS에 DEK를 보내 Key Encryption Key(KEK)로 암호화한다
5. 암호화된 DEK(wrapped DEK) + 암호화된 Secret을 etcd에 저장한다
6. 읽을 때는 역순: etcd에서 wrapped DEK 추출 → KMS에서 DEK 복호화 → DEK로 Secret 복호화
```

이 구조의 장점은 KEK가 KMS를 떠나지 않는다는 것이다. API 서버 노드가 침해되어도 DEK만 노출되며, DEK를 복호화하려면 KMS에 접근해야 한다.

### EncryptionConfiguration (KMS v2)

```yaml
apiVersion: apiserver.config.k8s.io/v1
kind: EncryptionConfiguration
resources:
- resources:
  - secrets
  providers:
  - kms:
      apiVersion: v2
      name: my-kms-provider
      endpoint: unix:///var/run/kms-provider.sock
      timeout: 3s
  - identity: {}
```

### API 서버 설정

```yaml
# /etc/kubernetes/manifests/kube-apiserver.yaml
spec:
  containers:
  - command:
    - kube-apiserver
    - --encryption-provider-config=/etc/kubernetes/enc/encryption-config.yaml
    volumeMounts:
    - name: enc-config
      mountPath: /etc/kubernetes/enc
      readOnly: true
    - name: kms-sock
      mountPath: /var/run/kms-provider.sock
  volumes:
  - name: enc-config
    hostPath:
      path: /etc/kubernetes/enc
  - name: kms-sock
    hostPath:
      path: /var/run/kms-provider.sock
      type: Socket
```

### 검증

```bash
# 검증 1: KMS provider 상태 확인
kubectl get --raw /healthz/kms-providers
```

```text
ok
```

"ok"이 아니면 KMS provider 소켓 연결에 문제가 있는 것이다.

```bash
# 검증 2: etcd에서 암호화 확인 (KMS 사용 시 접두사)
ETCDCTL_API=3 etcdctl get /registry/secrets/default/test-secret \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key | hexdump -C | head -5
```

```text
00000000  ... 6b 38 73 3a 65 6e 63 3a  6b 6d 73 3a 76 32 3a ...  |...k8s:enc:kms:v2:...|
```

"k8s:enc:kms:v2:<provider-name>:" 접두사가 있으면 KMS 암호화 성공이다.

```bash
# 검증 3: kubectl로 복호화 확인
kubectl get secret test-secret -o jsonpath='{.data.mykey}' | base64 -d
```

```text
mydata
```

원래 Secret 값이 정상적으로 반환되어야 한다.

```bash
# 검증 4: KMS 소켓 파일 존재 확인
ls -la /var/run/kms-provider.sock
```

```text
srwxr-xr-x 1 root root 0 ... /var/run/kms-provider.sock
```

소켓 파일이 없으면 KMS provider가 실행되지 않은 것이다.

```bash
# 검증 5: API 서버 로그에서 KMS 관련 에러 확인
kubectl logs kube-apiserver-master -n kube-system | grep -i kms | tail -5
```

```text
# 에러 메시지가 없어야 한다
```

### 트러블슈팅: KMS 관련 문제

| 증상 | 원인 | 해결 방법 |
|---|---|---|
| /healthz/kms-providers가 실패 | 소켓 파일이 없거나 KMS provider 프로세스 다운 | KMS provider 서비스 재시작 |
| API 서버 시작 실패 | 소켓 타임아웃 | timeout 값 증가 또는 KMS provider 응답 시간 확인 |
| Secret 읽기 실패 | KMS provider가 DEK 복호화에 실패 | KMS 서비스 접근 권한 및 키 상태 확인 |

---

# Part 2: 추가 실전 예제

---

## 예제 1. NetworkPolicy: Default Deny All + Monitoring 네임스페이스만 허용

### 이전 상태의 문제

NetworkPolicy가 없으면 쿠버네티스 클러스터 내 모든 Pod는 서로 자유롭게 통신할 수 있다. 이것은 **flat network** 구조이다. 하나의 Pod가 침해되면 공격자는 lateral movement로 클러스터 내 다른 모든 서비스에 접근할 수 있다. 데이터베이스, 내부 API, 관리 도구 등에 대한 네트워크 레벨 격리가 없다.

NetworkPolicy는 쿠버네티스의 L3/L4 방화벽이다. Pod 레벨에서 Ingress(들어오는 트래픽)와 Egress(나가는 트래픽)를 제어한다. CNI 플러그인(Calico, Cilium, Weave Net 등)이 iptables/eBPF 규칙으로 이를 실제 커널에서 강제한다.

`production` 네임스페이스에서 모든 트래픽을 차단하되, `monitoring` 네임스페이스의 Prometheus가 메트릭을 수집할 수 있도록 Ingress를 허용한다.

```yaml
# 1. Default Deny All
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
---
# 2. DNS Egress 허용 (서비스 디스커버리용)
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-dns
  namespace: production
spec:
  podSelector: {}
  policyTypes:
  - Egress
  egress:
  - to:
    - namespaceSelector: {}
    ports:
    - protocol: UDP
      port: 53
    - protocol: TCP
      port: 53
---
# 3. monitoring 네임스페이스에서만 Ingress 허용
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-monitoring-ingress
  namespace: production
spec:
  podSelector: {}
  policyTypes:
  - Ingress
  ingress:
  - from:
    - namespaceSelector:
        matchLabels:
          kubernetes.io/metadata.name: monitoring
    ports:
    - protocol: TCP
      port: 9090
    - protocol: TCP
      port: 8080
```

### 검증

```bash
# monitoring 네임스페이스에 라벨 확인
kubectl get namespace monitoring --show-labels
```

```text
NAME         STATUS   AGE   LABELS
monitoring   Active   10d   kubernetes.io/metadata.name=monitoring,...
```

```bash
# 정책 적용
kubectl apply -f networkpolicy-production.yaml

# 검증 1: monitoring에서 production Pod로 접근 가능
kubectl -n monitoring run test --image=busybox --rm -it -- \
  wget -qO- --timeout=3 http://app-svc.production.svc:8080
```

```text
<!DOCTYPE html>...
```

monitoring에서의 접근이 허용된다.

```bash
# 검증 2: 다른 네임스페이스에서는 차단됨
kubectl -n default run test --image=busybox --rm -it -- \
  wget -qO- --timeout=3 http://app-svc.production.svc:8080
```

```text
wget: download timed out
```

default 네임스페이스에서의 접근이 차단된다.

```bash
# 검증 3: production 내부 Pod 간 통신도 차단됨 (default deny)
kubectl -n production exec app-pod-1 -- wget -qO- --timeout=3 http://app-pod-2:8080
```

```text
wget: download timed out
```

```bash
# 검증 4: DNS는 정상 동작 (allow-dns 정책)
kubectl -n production exec app-pod-1 -- nslookup kubernetes.default.svc
```

```text
Server:    10.96.0.10
Address:   10.96.0.10:53
Name:      kubernetes.default.svc.cluster.local
Address:   10.96.0.1
```

```bash
# 검증 5: NetworkPolicy 목록 확인
kubectl get networkpolicy -n production
```

```text
NAME                        POD-SELECTOR   AGE
default-deny-all            <none>         2m
allow-dns                   <none>         2m
allow-monitoring-ingress    <none>         2m
```

---

## 예제 2. kube-bench 실행 및 CIS 실패 항목 수정

### 이전 상태의 문제

쿠버네티스 기본 설치는 보안 설정이 최적화되어 있지 않다. CIS(Center for Internet Security) Benchmark는 쿠버네티스 보안 구성을 위한 업계 표준 가이드라인이다. kube-bench는 이 벤치마크에 대한 자동화된 점검 도구이다. CIS 벤치마크를 수동으로 점검하는 것은 수백 개의 항목을 일일이 확인해야 하므로 비현실적이다.

kube-bench를 실행하여 CIS Benchmark 실패 항목을 식별하고 수정한다.

```bash
# kube-bench 실행
kube-bench run --targets master --check 1.2.6,1.2.7,1.2.8

# 또는 Job으로 실행
kubectl apply -f https://raw.githubusercontent.com/aquasecurity/kube-bench/main/job.yaml
kubectl logs job/kube-bench
```

### CIS 1.2.6 수정: kubelet-certificate-authority 설정

```bash
# /etc/kubernetes/manifests/kube-apiserver.yaml 수정
sudo vi /etc/kubernetes/manifests/kube-apiserver.yaml
```

```yaml
spec:
  containers:
  - command:
    - kube-apiserver
    - --kubelet-certificate-authority=/etc/kubernetes/pki/ca.crt   # 추가
    - --kubelet-client-certificate=/etc/kubernetes/pki/apiserver-kubelet-client.crt
    - --kubelet-client-key=/etc/kubernetes/pki/apiserver-kubelet-client.key
    # ... 기존 설정 유지
```

### CIS 1.2.16 수정: admission-control 플러그인 활성화

```yaml
spec:
  containers:
  - command:
    - kube-apiserver
    - --enable-admission-plugins=NodeRestriction,PodSecurity   # PodSecurity 추가
```

### CIS 4.2.6 수정: kubelet protectKernelDefaults

```bash
# /var/lib/kubelet/config.yaml 수정
sudo vi /var/lib/kubelet/config.yaml
```

```yaml
protectKernelDefaults: true
```

```bash
# kubelet 재시작
sudo systemctl restart kubelet
```

### 검증

```bash
# 검증 1: 수정 후 kube-bench 재검증
kube-bench run --targets master --check 1.2.6
```

```text
[PASS] 1.2.6 Ensure that the --kubelet-certificate-authority argument is set (Automated)
```

```bash
# 검증 2: API 서버 플래그 확인
ps aux | grep kube-apiserver | grep kubelet-certificate-authority
```

```text
... --kubelet-certificate-authority=/etc/kubernetes/pki/ca.crt ...
```

```bash
# 검증 3: PodSecurity admission 활성화 확인
kubectl describe pod kube-apiserver-master -n kube-system | grep enable-admission
```

```text
      --enable-admission-plugins=NodeRestriction,PodSecurity
```

```bash
# 검증 4: kubelet protectKernelDefaults 확인
cat /var/lib/kubelet/config.yaml | grep protectKernelDefaults
```

```text
protectKernelDefaults: true
```

```bash
# 검증 5: kubelet이 정상 재시작되었는지 확인
systemctl status kubelet
```

```text
● kubelet.service - kubelet: The Kubernetes Node Agent
     Active: active (running) since ...
```

---

나머지 예제(3~10)와 Part 3(확인 문제 30문항), Part 4(기출 유형 덤프 문제 20문항)는 기존 내용과 동일한 구조를 유지한다. 아래에 각 예제의 핵심 검증 블록만 보강하여 수록한다.

---

## 예제 3. AppArmor 프로파일 생성 및 Pod 적용

### 이전 상태의 문제

컨테이너 프로세스는 기본적으로 컨테이너 내 모든 파일에 대한 읽기/쓰기가 가능하다. `readOnlyRootFilesystem`은 전체 루트 파일시스템을 읽기 전용으로 만들지만, 특정 경로에 대한 세밀한 접근 제어는 불가능하다. 예를 들어 "/tmp에는 쓰기를 허용하되 /etc에는 쓰기를 금지"하는 것은 `readOnlyRootFilesystem`만으로는 불가능하다 (emptyDir을 마운트하면 가능하지만, 경로가 많아지면 관리가 복잡해진다).

AppArmor는 Linux 커널의 LSM(Linux Security Modules) 프레임워크를 사용하는 MAC(Mandatory Access Control) 시스템이다. 프로세스별로 파일 접근, 네트워크 접근, capability 사용 등을 세밀하게 제어한다. 커널이 프로세스의 syscall을 가로채서 AppArmor 프로파일과 대조하고, 위반 시 거부한다.

### 커널 레벨 동작 원리 (보강)

AppArmor는 LSM 보안 훅을 통해 동작한다. 프로세스가 `open()`, `connect()`, `exec()` 등의 syscall을 호출하면 커널이 해당 LSM 훅을 실행한다. AppArmor 모듈은 프로세스의 security context에서 할당된 프로파일을 조회하고, 규칙과 대조한다.

```
프로세스 → open("/etc/shadow", O_RDONLY)
    → 커널 VFS 레이어 → security_file_open() LSM 훅
    → AppArmor: 프로파일 "k8s-deny-write" 조회
    → 규칙: "deny /etc/shadow r" → DENIED
    → 커널: -EACCES 반환 + dmesg에 audit 로그 기록
```

### AppArmor 프로파일 작성

```bash
# 프로파일 파일 생성
cat > /etc/apparmor.d/k8s-deny-write << 'EOF'
#include <tunables/global>

profile k8s-deny-write flags=(attach_disconnected,mediate_deleted) {
  #include <abstractions/base>

  # 기본 파일 접근 허용 (deny 규칙으로 쓰기 제한)
  file,

  # 모든 네트워크 접근 허용
  network,

  # /proc 파일시스템 읽기 허용
  /proc/** r,

  # 쓰기 거부 (특정 경로 제외)
  deny /bin/** w,
  deny /sbin/** w,
  deny /usr/** w,
  deny /etc/** w,

  # /tmp은 쓰기 허용
  /tmp/** rw,
  /var/tmp/** rw,
}
EOF

# 프로파일 로드
sudo apparmor_parser -r /etc/apparmor.d/k8s-deny-write

# 프로파일 상태 확인
sudo aa-status | grep k8s-deny-write
```

### Pod에 AppArmor 프로파일 적용

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: apparmor-pod
  annotations:
    container.apparmor.security.beta.kubernetes.io/app: localhost/k8s-deny-write
spec:
  containers:
  - name: app
    image: nginx:1.25
    securityContext:
      allowPrivilegeEscalation: false
```

> **참고:** Kubernetes 1.30+에서는 annotation 대신 `securityContext.appArmorProfile` 필드를 사용할 수 있다.

```yaml
# Kubernetes 1.30+ 방식
apiVersion: v1
kind: Pod
metadata:
  name: apparmor-pod-v2
spec:
  containers:
  - name: app
    image: nginx:1.25
    securityContext:
      appArmorProfile:
        type: Localhost
        localhostProfile: k8s-deny-write
```

### 검증

```bash
# 검증 1: 프로파일이 노드에 로드되었는지 확인
sudo aa-status | grep k8s-deny-write
```

```text
   k8s-deny-write (enforce)
```

```bash
# 검증 2: Pod 생성 후 AppArmor annotation 확인
kubectl apply -f apparmor-pod.yaml
kubectl get pod apparmor-pod -o jsonpath='{.metadata.annotations}'
```

```text
{"container.apparmor.security.beta.kubernetes.io/app":"localhost/k8s-deny-write"}
```

```bash
# 검증 3: /usr에 쓰기 시도 (차단되어야 함)
kubectl exec apparmor-pod -- touch /usr/test
```

```text
touch: /usr/test: Permission denied
```

AppArmor가 /usr/** 경로에 대한 쓰기를 차단하고 있다.

```bash
# 검증 4: /etc에 쓰기 시도 (차단되어야 함)
kubectl exec apparmor-pod -- sh -c "echo test >> /etc/hosts"
```

```text
sh: can't create /etc/hosts: Permission denied
```

```bash
# 검증 5: /tmp에 쓰기 시도 (허용되어야 함)
kubectl exec apparmor-pod -- touch /tmp/test
kubectl exec apparmor-pod -- ls /tmp/test
```

```text
/tmp/test
```

/tmp은 프로파일에서 rw로 허용되어 있다.

```bash
# 검증 6: 읽기는 정상 동작
kubectl exec apparmor-pod -- cat /etc/hostname
```

```text
apparmor-pod
```

읽기는 허용되어 있다.

```bash
# 검증 7: AppArmor 거부 로그 확인 (호스트에서)
sudo dmesg | grep apparmor | tail -5
```

```text
[xxxxx.xxxxxx] audit: type=1400 audit(...): apparmor="DENIED" operation="mknod" profile="k8s-deny-write" name="/usr/test" pid=12345 comm="touch" ...
```

---

## 예제 4. Seccomp 커스텀 프로파일로 위험한 Syscall 차단

### 이전 상태의 문제

seccomp(Secure Computing Mode) 없이 컨테이너는 Linux 커널의 모든 시스템 콜(약 300개 이상)을 호출할 수 있다. 이 중 상당수는 컨테이너 탈출에 사용될 수 있다:

- `ptrace`: 다른 프로세스의 메모리를 읽고 쓸 수 있다
- `mount`/`umount2`: 파일시스템을 마운트하여 호스트 파일에 접근할 수 있다
- `unshare`: 새로운 namespace를 생성하여 격리를 우회할 수 있다
- `reboot`: 호스트를 재부팅시킬 수 있다
- `init_module`/`finit_module`: 커널 모듈을 로드하여 호스트 커널을 장악할 수 있다

seccomp은 커널 레벨에서 프로세스가 호출할 수 있는 syscall 목록을 제한하는 메커니즘이다. BPF(Berkeley Packet Filter) 프로그램으로 구현되며, 허용되지 않은 syscall 호출 시 EPERM 에러를 반환하거나 프로세스를 종료한다.

### 커스텀 seccomp 프로파일 생성

```bash
sudo mkdir -p /var/lib/kubelet/seccomp/profiles

cat > /var/lib/kubelet/seccomp/profiles/block-dangerous.json << 'EOF'
{
  "defaultAction": "SCMP_ACT_ALLOW",
  "architectures": ["SCMP_ARCH_X86_64", "SCMP_ARCH_AARCH64"],
  "syscalls": [
    {
      "names": [
        "unshare", "mount", "umount2", "ptrace", "reboot",
        "sethostname", "setdomainname", "init_module",
        "finit_module", "delete_module", "kexec_load", "kexec_file_load"
      ],
      "action": "SCMP_ACT_ERRNO",
      "errnoRet": 1
    }
  ]
}
EOF
```

### Pod에 seccomp 프로파일 적용

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: seccomp-pod
spec:
  securityContext:
    seccompProfile:
      type: Localhost
      localhostProfile: profiles/block-dangerous.json
  containers:
  - name: app
    image: nginx:1.25
    securityContext:
      allowPrivilegeEscalation: false
```

### 검증

```bash
# 검증 1: seccomp 프로파일 확인
kubectl apply -f seccomp-pod.yaml
kubectl get pod seccomp-pod -o jsonpath='{.spec.securityContext.seccompProfile}'
```

```text
{"type":"Localhost","localhostProfile":"profiles/block-dangerous.json"}
```

```bash
# 검증 2: 차단된 syscall 테스트 - unshare
kubectl exec seccomp-pod -- unshare --user --pid --fork --mount-proc /bin/sh -c "id"
```

```text
unshare: unshare(0x10000000): Operation not permitted
```

```bash
# 검증 3: 허용된 syscall은 정상 동작
kubectl exec seccomp-pod -- ls /
kubectl exec seccomp-pod -- cat /etc/hostname
```

```text
bin  boot  dev  etc  home  lib  ...
seccomp-pod
```

---

## 예제 5. OPA Gatekeeper: Privileged 컨테이너 차단

### 이전 상태의 문제

PodSecurity Admission이 도입되기 전, privileged 컨테이너 생성을 클러스터 전체에서 차단하는 표준 방법이 없었다. OPA Gatekeeper는 Rego 정책 언어를 사용하여 임의의 정책을 정의할 수 있는 범용 정책 엔진이다. ValidatingAdmissionWebhook으로 동작한다.

### ConstraintTemplate 생성

```yaml
apiVersion: templates.gatekeeper.sh/v1
kind: ConstraintTemplate
metadata:
  name: k8spspprivilegedcontainer
spec:
  crd:
    spec:
      names:
        kind: K8sPSPPrivilegedContainer
  targets:
  - target: admission.k8s.gatekeeper.sh
    rego: |
      package k8spspprivilegedcontainer
      violation[{"msg": msg}] {
        container := input.review.object.spec.containers[_]
        container.securityContext.privileged == true
        msg := sprintf("Privileged container is not allowed: %v", [container.name])
      }
      violation[{"msg": msg}] {
        container := input.review.object.spec.initContainers[_]
        container.securityContext.privileged == true
        msg := sprintf("Privileged init container is not allowed: %v", [container.name])
      }
```

### Constraint 생성

```yaml
apiVersion: constraints.gatekeeper.sh/v1beta1
kind: K8sPSPPrivilegedContainer
metadata:
  name: deny-privileged-containers
spec:
  match:
    kinds:
    - apiGroups: [""]
      kinds: ["Pod"]
    excludedNamespaces:
    - kube-system
    - gatekeeper-system
  parameters: {}
```

### 검증

```bash
kubectl apply -f constraint-template.yaml
kubectl apply -f constraint.yaml

# 검증 1: privileged Pod 생성 시도 (거부)
kubectl run test --image=nginx --overrides='{
  "spec": {
    "containers": [{
      "name": "test",
      "image": "nginx",
      "securityContext": {"privileged": true}
    }]
  }
}'
```

```text
Error from server (Forbidden): admission webhook "validation.gatekeeper.sh" denied the request: [deny-privileged-containers] Privileged container is not allowed: test
```

```bash
# 검증 2: 일반 Pod 생성 (허용)
kubectl run test-normal --image=nginx
```

```text
pod/test-normal created
```

---

## 예제 6. Trivy 이미지 스캔 및 안전한 이미지로 Pod 생성

### 이전 상태의 문제

컨테이너 이미지에 알려진 취약점(CVE)이 존재할 수 있다. Trivy는 CVE 데이터베이스와 대조하여 알려진 취약점을 식별하고 심각도를 분류한다.

```bash
# 이미지 스캔
trivy image --severity CRITICAL,HIGH nginx:1.25

# exit code를 이용한 CI/CD 게이트
trivy image --severity CRITICAL --exit-code 1 nginx:1.25
```

### 검증

```bash
# 검증 1: CRITICAL 취약점 유무 확인
trivy image --severity CRITICAL --exit-code 1 nginxinc/nginx-unprivileged:1.25-alpine
echo "Exit code: $?"
```

```text
Exit code: 0
```

Exit code 0은 CRITICAL 취약점이 없다는 의미이다.

---

## 예제 7. Falco 커스텀 규칙: 크립토마이닝 탐지

### 이전 상태의 문제

컨테이너 침해 후 가장 흔한 악용 사례 중 하나가 크립토마이닝이다. Falco는 syscall 레벨에서 프로세스 실행과 네트워크 활동을 감시하여 알려진 마이닝 도구의 실행을 실시간으로 탐지한다.

```yaml
# /etc/falco/falco_rules.local.yaml
- rule: Detect Crypto Mining Activity
  desc: 컨테이너 내에서 크립토마이닝 관련 프로세스를 탐지한다.
  condition: >
    spawned_process and container and
    (proc.name in (xmrig, minerd, minergate, cpuminer, ethminer) or
     proc.cmdline contains "stratum+tcp" or
     proc.cmdline contains "--donate-level")
  output: >
    Crypto mining detected (user=%user.name command=%proc.cmdline
    container=%container.name pod=%k8s.pod.name ns=%k8s.ns.name)
  priority: CRITICAL
  tags: [cryptomining, mitre_execution]
```

### 검증

```bash
# 검증 1: Falco 규칙 문법 검증
falco --validate /etc/falco/falco_rules.local.yaml
```

```text
/etc/falco/falco_rules.local.yaml: Ok
```

---

## 예제 8. Audit Policy: Secret 접근 로깅

### 이전 상태의 문제

Audit 로깅이 비활성화된 상태에서는 누가 언제 어떤 리소스에 접근했는지 추적할 수 없다.

### Audit Policy 파일 작성

```yaml
# /etc/kubernetes/audit/audit-policy.yaml
apiVersion: audit.k8s.io/v1
kind: Policy
rules:
- level: RequestResponse
  resources:
  - group: ""
    resources: ["secrets"]
- level: Metadata
  resources:
  - group: ""
    resources: ["configmaps"]
  verbs: ["get", "list", "watch"]
- level: None
  users: ["system:kube-proxy"]
  verbs: ["watch"]
  resources:
  - group: ""
    resources: ["endpoints", "services", "services/status"]
- level: Metadata
  omitStages:
  - RequestReceived
```

### 검증

```bash
# 검증 1: Audit 로그 파일 존재 확인
ls -la /var/log/kubernetes/audit/audit.log
```

```text
-rw------- 1 root root XXXXXX ... audit.log
```

```bash
# 검증 2: Secret 접근 후 Audit 로그에서 확인
kubectl get secret -n default
cat /var/log/kubernetes/audit/audit.log | jq 'select(.objectRef.resource=="secrets")' | tail -5
```

```text
{
  "kind": "Event",
  "verb": "list",
  "objectRef": {
    "resource": "secrets",
    "namespace": "default"
  },
  ...
}
```

---

## 예제 9. Secret Encryption at Rest (aescbc Provider)

### 이전 상태의 문제

이 예제는 etcd 암호화를 처음부터 끝까지 수행하는 실습이다.

```bash
# 32바이트 암호화 키 생성
head -c 32 /dev/urandom | base64
```

### EncryptionConfiguration 작성

```yaml
apiVersion: apiserver.config.k8s.io/v1
kind: EncryptionConfiguration
resources:
- resources:
  - secrets
  providers:
  - aescbc:
      keys:
      - name: key1
        secret: <generated-key>
  - identity: {}
```

### 검증

```bash
# 검증 1: 테스트 Secret 생성
kubectl create secret generic enc-test --from-literal=password=supersecret

# 검증 2: etcd에서 직접 확인
ETCDCTL_API=3 etcdctl get /registry/secrets/default/enc-test \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key | hexdump -C | head -5
```

```text
00000000  ... 6b 38 73 3a 65 6e 63 3a 61 65 73 63 62 63 3a  |...k8s:enc:aescbc:|
00000010  76 31 3a 6b 65 79 31 3a ...                        |v1:key1:...|
```

"k8s:enc:aescbc:v1:key1:" 접두사가 보이면 암호화 성공이다.

```bash
# 검증 3: kubectl로 정상 읽기
kubectl get secret enc-test -o jsonpath='{.data.password}' | base64 -d
```

```text
supersecret
```

---

## 예제 10. RuntimeClass: gVisor (runsc) 핸들러 사용

### 이전 상태의 문제

표준 컨테이너 런타임(runc)은 호스트 커널을 직접 공유한다. 커널 취약점이 발견되면 컨테이너에서 호스트로 탈출할 수 있다. gVisor(runsc)는 사용자 공간 커널로, 컨테이너의 syscall을 호스트 커널에 직접 전달하지 않고 자체적으로 처리한다.

### RuntimeClass 생성

```yaml
apiVersion: node.k8s.io/v1
kind: RuntimeClass
metadata:
  name: gvisor
handler: runsc
scheduling:
  nodeSelector:
    runtime: gvisor
```

### 검증

```bash
# 검증 1: RuntimeClass 확인
kubectl get runtimeclass gvisor
```

```text
NAME     HANDLER   AGE
gvisor   runsc     10s
```

```bash
# 검증 2: gVisor Pod 내부에서 커널 확인
kubectl exec sandboxed-pod -- uname -r
```

```text
4.4.0
```

gVisor 커널 버전이 출력된다. 호스트 커널 버전과 다르면 gVisor가 동작하고 있는 것이다.

---

# Part 3: 개념별 확인 문제 (30문항)

---

## Cluster Setup (5문항)

### 문제 1. NetworkPolicy Default Deny

`secure-app` 네임스페이스에서 모든 Pod의 Ingress 트래픽을 차단하되, `app=nginx` 라벨을 가진 Pod만 포트 443에서 트래픽을 받을 수 있도록 하라. DNS Egress도 허용해야 한다.

<details>
<summary>풀이 확인</summary>

```yaml
# 1. Default Deny All Ingress
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-ingress
  namespace: secure-app
spec:
  podSelector: {}
  policyTypes:
  - Ingress
---
# 2. nginx Pod에 대한 Ingress 허용
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-nginx-ingress
  namespace: secure-app
spec:
  podSelector:
    matchLabels:
      app: nginx
  policyTypes:
  - Ingress
  ingress:
  - ports:
    - protocol: TCP
      port: 443
---
# 3. DNS Egress 허용
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-dns-egress
  namespace: secure-app
spec:
  podSelector: {}
  policyTypes:
  - Egress
  egress:
  - to:
    - namespaceSelector: {}
    ports:
    - protocol: UDP
      port: 53
    - protocol: TCP
      port: 53
```

```bash
kubectl apply -f netpol.yaml

# 검증 1: NetworkPolicy 목록 확인
kubectl get networkpolicy -n secure-app
```

```text
NAME                    POD-SELECTOR   AGE
default-deny-ingress    <none>         30s
allow-nginx-ingress     app=nginx      30s
allow-dns-egress        <none>         30s
```

```bash
# 검증 2: DNS 정상 동작
kubectl -n secure-app exec nginx-pod -- nslookup kubernetes.default.svc
```

```text
Name:      kubernetes.default.svc.cluster.local
Address:   10.96.0.1
```

</details>

---

### 문제 2. kube-bench CIS Benchmark 점검 및 수정

마스터 노드에서 kube-bench를 실행하여 CIS 1.2 섹션(API Server)의 FAIL 항목을 확인하고, `--profiling=false`와 `--enable-admission-plugins=NodeRestriction,PodSecurity`를 수정하라.

<details>
<summary>풀이 확인</summary>

#### 등장 배경과 기존 한계점

CIS Kubernetes Benchmark는 수백 개의 보안 설정 항목을 체계적으로 점검하는 산업 표준이다. 수동으로 각 컴포넌트의 설정 파일과 프로세스 인수를 검사하는 것은 비현실적이며 누락이 발생한다. kube-bench는 이를 자동화하여 PASS/FAIL/WARN 결과를 제공한다. profiling이 활성화되면 API 서버의 내부 동작 정보가 외부에 노출될 수 있다.

```bash
# 1. kube-bench 실행
ssh admin@<master-ip> 'sudo kube-bench run --targets master --check 1.2 2>/dev/null' | grep -E "FAIL|PASS" | head -20
```

```text
[FAIL] 1.2.1 Ensure that the --profiling argument is set to false
[PASS] 1.2.2 Ensure that the --audit-log-path argument is set
...
[FAIL] 1.2.16 Ensure that the admission control plugin PodSecurity is set
...
```

```bash
# 2. kube-apiserver.yaml 수정
ssh admin@<master-ip> 'sudo vi /etc/kubernetes/manifests/kube-apiserver.yaml'
# 다음 플래그 추가/수정:
#   - --profiling=false
#   - --enable-admission-plugins=NodeRestriction,PodSecurity
```

```bash
# 검증 1: API 서버 재시작 대기
ssh admin@<master-ip> 'sudo crictl ps | grep kube-apiserver'
```

```text
CONTAINER           IMAGE               CREATED         STATE    NAME              ...
abc123def456        ...                 10 seconds ago  Running  kube-apiserver    ...
```

```bash
# 검증 2: 수정된 항목 재점검
ssh admin@<master-ip> 'sudo kube-bench run --targets master --check 1.2.1,1.2.16 2>/dev/null'
```

```text
[PASS] 1.2.1 Ensure that the --profiling argument is set to false
[PASS] 1.2.16 Ensure that the admission control plugin PodSecurity is set
```

**트러블슈팅:**
- kube-apiserver.yaml 수정 후 API 서버가 시작되지 않으면 `sudo crictl logs $(sudo crictl ps -a --name kube-apiserver -q | head -1)`로 에러 로그를 확인한다.
- YAML 문법 오류가 가장 흔한 실패 원인이다. 수정 전에 반드시 `sudo cp kube-apiserver.yaml kube-apiserver.yaml.bak`으로 백업한다.

</details>

---

### 문제 3. Ingress TLS 설정

`web-app` 네임스페이스에 TLS가 적용된 Ingress를 생성하라. TLS 인증서는 Secret으로 저장하고, HTTP 요청을 HTTPS로 리다이렉트하라.

<details>
<summary>풀이 확인</summary>

#### 등장 배경과 기존 한계점

평문 HTTP 트래픽은 네트워크 스니핑으로 인증 정보(쿠키, 토큰)가 노출된다. TLS를 적용하지 않으면 MITM(중간자) 공격에 취약하다. Ingress 리소스에 TLS를 설정하면 클라이언트-Ingress 구간이 암호화된다. HTTP-to-HTTPS 리다이렉트로 평문 통신을 원천 차단해야 한다.

```bash
# 1. 자체 서명 인증서 생성
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout tls.key -out tls.crt \
  -subj "/CN=web-app.example.com/O=web-app"

# 2. TLS Secret 생성
kubectl create secret tls web-app-tls \
  --cert=tls.crt --key=tls.key -n web-app
```

```yaml
# 3. Ingress 리소스
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: web-app-ingress
  namespace: web-app
  annotations:
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
    nginx.ingress.kubernetes.io/force-ssl-redirect: "true"
spec:
  ingressClassName: nginx
  tls:
  - hosts:
    - web-app.example.com
    secretName: web-app-tls
  rules:
  - host: web-app.example.com
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

```bash
# 검증 1: TLS Secret 확인
kubectl get secret web-app-tls -n web-app
```

```text
NAME          TYPE                DATA   AGE
web-app-tls   kubernetes.io/tls   2      10s
```

```bash
# 검증 2: Ingress 리소스 확인
kubectl get ingress web-app-ingress -n web-app
```

```text
NAME              CLASS   HOSTS                  ADDRESS         PORTS     AGE
web-app-ingress   nginx   web-app.example.com    192.168.64.X    80, 443   15s
```

```bash
# 검증 3: HTTPS 접근 테스트
curl -sk https://web-app.example.com --resolve web-app.example.com:443:<ingress-ip> | head -5
```

```text
<!DOCTYPE html>
...
```

```bash
# 검증 4: HTTP -> HTTPS 리다이렉트 확인
curl -s -o /dev/null -w "%{http_code}" http://web-app.example.com --resolve web-app.example.com:80:<ingress-ip>
```

```text
308
```

308 Permanent Redirect가 반환되면 HTTPS 리다이렉트가 동작하는 것이다.

```bash
# 정리
rm -f tls.key tls.crt
```

**트러블슈팅:**
- Ingress Controller가 설치되지 않으면 Ingress 리소스가 ADDRESS를 할당받지 못한다. `kubectl get pods -n ingress-nginx`로 컨트롤러 상태를 확인한다.
- Secret의 type이 `kubernetes.io/tls`가 아니면 Ingress에서 인식하지 못한다. `kubectl create secret tls` 명령이 자동으로 올바른 type을 설정한다.

</details>

---

### 문제 4. 바이너리 해시 검증

kubelet 바이너리가 공식 릴리스와 일치하는지 SHA-512 해시로 검증하라.

<details>
<summary>풀이 확인</summary>

#### 등장 배경과 기존 한계점

공급망 공격(Supply Chain Attack)에서 공격자가 쿠버네티스 바이너리를 변조된 버전으로 교체할 수 있다. 변조된 kubelet은 백도어를 포함하여 노드에서 실행되는 모든 컨테이너를 감시하거나 조작할 수 있다. 바이너리 해시를 공식 릴리스 체크섬과 대조하면 변조 여부를 탐지할 수 있다.

```bash
# 1. kubelet 버전 확인
KVER=$(ssh admin@<node-ip> 'kubelet --version' | awk '{print $2}')
echo $KVER
```

```text
v1.29.X
```

```bash
# 2. 공식 체크섬 다운로드
curl -sL "https://dl.k8s.io/${KVER}/bin/linux/arm64/kubelet.sha512"
```

```text
abcdef1234567890...  kubelet
```

```bash
# 3. 노드의 kubelet 바이너리 해시 계산
ssh admin@<node-ip> 'sha512sum /usr/bin/kubelet'
```

```text
abcdef1234567890...  /usr/bin/kubelet
```

```bash
# 4. 해시 비교 (자동화)
OFFICIAL=$(curl -sL "https://dl.k8s.io/${KVER}/bin/linux/arm64/kubelet.sha512" | awk '{print $1}')
ACTUAL=$(ssh admin@<node-ip> 'sha512sum /usr/bin/kubelet' | awk '{print $1}')
if [ "$OFFICIAL" = "$ACTUAL" ]; then
  echo "PASS: kubelet 바이너리 무결성 검증 성공"
else
  echo "FAIL: kubelet 바이너리가 변조되었을 수 있다"
fi
```

```text
PASS: kubelet 바이너리 무결성 검증 성공
```

**트러블슈팅:**
- 아키텍처(amd64/arm64)가 일치해야 한다. tart-infra는 Apple Silicon이므로 arm64 바이너리를 다운로드해야 한다.
- kubelet 경로가 `/usr/bin/kubelet`이 아닐 수 있다. `which kubelet`으로 실제 경로를 확인한다.
- 해시가 불일치하면 즉시 해당 노드를 cordon/drain하고 조사한다.

</details>

---

### 문제 5. API 서버 접근 제한

API 서버의 익명 인증을 비활성화하고, NodeRestriction Admission Plugin이 활성화되어 있는지 확인하라.

<details>
<summary>풀이 확인</summary>

#### 등장 배경과 기존 한계점

익명 인증(anonymous-auth)이 활성화되면 인증 정보 없이 API 서버에 접근할 수 있다. RBAC이 적절히 설정되지 않으면 클러스터 정보가 노출된다. NodeRestriction Admission Plugin은 kubelet이 자신의 노드에 속한 Pod만 수정할 수 있도록 제한한다. 이 플러그인 없이는 침해된 노드의 kubelet이 다른 노드의 Pod를 조작할 수 있다.

```bash
# 1. 현재 설정 확인
ssh admin@<master-ip> 'sudo cat /etc/kubernetes/manifests/kube-apiserver.yaml' | \
  grep -E "anonymous-auth|enable-admission"
```

```text
    - --anonymous-auth=false
    - --enable-admission-plugins=NodeRestriction,PodSecurity
```

```bash
# 검증 1: 익명 접근 테스트 (차단)
curl -sk https://<master-ip>:6443/api 2>&1
```

```text
{
  "kind": "Status",
  "apiVersion": "v1",
  "status": "Failure",
  "message": "Unauthorized",
  "code": 401
}
```

```bash
# 검증 2: NodeRestriction 동작 확인 (kubelet이 다른 노드의 Pod 수정 불가)
# 이론적 확인: Admission Plugin 목록 조회
ssh admin@<master-ip> 'ps aux | grep kube-apiserver' | tr ' ' '\n' | grep admission
```

```text
--enable-admission-plugins=NodeRestriction,PodSecurity
```

**수정이 필요한 경우:**

```yaml
# /etc/kubernetes/manifests/kube-apiserver.yaml
spec:
  containers:
  - command:
    - kube-apiserver
    - --anonymous-auth=false
    - --enable-admission-plugins=NodeRestriction,PodSecurity
```

```bash
# 검증 3: 수정 후 API 서버 재시작 확인
ssh admin@<master-ip> 'sudo crictl ps | grep kube-apiserver'
```

```text
CONTAINER    IMAGE    CREATED          STATE    NAME              ...
abc123...    ...      10 seconds ago   Running  kube-apiserver    ...
```

**트러블슈팅:**
- anonymous-auth를 false로 설정하면 health check 프로브가 실패할 수 있다. livenessProbe가 /healthz를 호출하는 경우 `--authentication-token-webhook-config-file`이나 서비스 계정 토큰을 사용해야 한다.
- enable-admission-plugins에서 기존 플러그인을 제거하지 않도록 주의한다. 기존 목록에 추가하는 형태로 수정한다.

</details>

---

## Cluster Hardening (5문항)

### 문제 6. 최소 권한 ServiceAccount RBAC

`ci-cd` 네임스페이스에 `deployer`라는 ServiceAccount를 만들고, `staging` 네임스페이스의 Deployment만 생성/업데이트/조회할 수 있는 Role과 RoleBinding을 설정하라.

<details>
<summary>풀이 확인</summary>

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: deployer-role
  namespace: staging
rules:
- apiGroups: ["apps"]
  resources: ["deployments"]
  verbs: ["get", "list", "create", "update", "patch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: deployer-binding
  namespace: staging
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: deployer-role
subjects:
- kind: ServiceAccount
  name: deployer
  namespace: ci-cd
```

```bash
# 검증 1: Deployment 생성 권한 (허용)
kubectl auth can-i create deployments \
  --as=system:serviceaccount:ci-cd:deployer -n staging
```

```text
yes
```

```bash
# 검증 2: Secret 접근 권한 (차단)
kubectl auth can-i get secrets \
  --as=system:serviceaccount:ci-cd:deployer -n staging
```

```text
no
```

</details>

---

### 문제 7. ServiceAccount 토큰 자동 마운트 비활성화

`payment` 네임스페이스의 모든 Pod에서 ServiceAccount 토큰이 자동 마운트되지 않도록 설정하라.

<details>
<summary>풀이 확인</summary>

#### 등장 배경과 기존 한계점

쿠버네티스는 기본적으로 모든 Pod에 ServiceAccount 토큰을 자동 마운트한다(`/var/run/secrets/kubernetes.io/serviceaccount/token`). 이 토큰은 K8s API에 인증하는 데 사용된다. Pod가 K8s API를 호출할 필요가 없는 일반 워크로드(웹 서버, DB 등)에서도 토큰이 마운트되므로, 컨테이너가 침해되면 공격자가 이 토큰으로 API 서버에 접근하여 클러스터 정보를 수집하거나 추가 공격을 수행할 수 있다.

```bash
# 방법 1: ServiceAccount 레벨에서 비활성화
kubectl patch serviceaccount default -n payment \
  -p '{"automountServiceAccountToken": false}'

# 방법 2: Pod spec 레벨에서 비활성화 (우선순위가 더 높다)
```

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: no-token-pod
  namespace: payment
spec:
  automountServiceAccountToken: false
  containers:
  - name: app
    image: nginx:alpine
```

```bash
# 검증 1: ServiceAccount 설정 확인
kubectl get serviceaccount default -n payment -o jsonpath='{.automountServiceAccountToken}'
```

```text
false
```

```bash
# 검증 2: 새 Pod 생성 후 토큰 부재 확인
kubectl run token-test --image=busybox:1.36 -n payment \
  --command -- sleep 3600
kubectl exec token-test -n payment -- \
  ls /var/run/secrets/kubernetes.io/serviceaccount/ 2>&1
```

```text
ls: /var/run/secrets/kubernetes.io/serviceaccount/: No such file or directory
```

```bash
# 검증 3: API 서버 접근 불가 확인
kubectl exec token-test -n payment -- \
  wget -qO- --timeout=3 https://kubernetes.default.svc/api 2>&1
```

```text
wget: error getting response: Connection refused
```

```bash
# 정리
kubectl delete pod token-test -n payment
```

**트러블슈팅:**
- Pod spec의 `automountServiceAccountToken`이 ServiceAccount의 설정보다 우선한다. 둘 다 설정된 경우 Pod spec이 적용된다.
- Istio sidecar 등 일부 서비스 메시는 ServiceAccount 토큰을 사용한다. 이 경우 토큰을 비활성화하면 mTLS가 동작하지 않을 수 있다.

</details>

---

### 문제 8. kubeadm 보안 업그레이드

kubeadm을 사용하여 클러스터를 마이너 버전 업그레이드하라. 업그레이드 전후로 보안 관련 설정이 유지되는지 확인하라.

<details>
<summary>풀이 확인</summary>

#### 등장 배경과 기존 한계점

쿠버네티스 보안 패치는 마이너/패치 릴리스에 포함된다. CVE가 공개된 후 패치를 적용하지 않으면 알려진 취약점에 노출된다. kubeadm upgrade는 컨트롤 플레인 컴포넌트(API Server, Controller Manager, Scheduler, etcd)를 순차적으로 업그레이드한다. 업그레이드 과정에서 커스텀 Admission Plugin, Audit Policy, EncryptionConfiguration 등 보안 설정이 초기화될 수 있으므로 반드시 사전 백업과 사후 검증이 필요하다.

```bash
# 1. 현재 버전 확인
kubectl version --short
kubeadm version
```

```text
Client Version: v1.29.X
Server Version: v1.29.X
```

```bash
# 2. 업그레이드 가능 버전 확인
sudo kubeadm upgrade plan
```

```text
Components that must be upgraded manually:
COMPONENT   CURRENT       TARGET
kubelet     v1.29.X       v1.29.Y

Upgrade to the latest stable version:
COMPONENT                CURRENT    TARGET
kube-apiserver           v1.29.X    v1.29.Y
kube-controller-manager  v1.29.X    v1.29.Y
kube-scheduler           v1.29.X    v1.29.Y
...
```

```bash
# 3. 보안 설정 백업
sudo cp /etc/kubernetes/manifests/kube-apiserver.yaml /tmp/kube-apiserver.yaml.bak
sudo cp /etc/kubernetes/audit/policy.yaml /tmp/audit-policy.yaml.bak 2>/dev/null
sudo cp /etc/kubernetes/enc/enc.yaml /tmp/enc.yaml.bak 2>/dev/null

# 4. kubeadm 업그레이드 수행
sudo apt-get update && sudo apt-get install -y kubeadm=1.29.Y-*
sudo kubeadm upgrade apply v1.29.Y

# 5. kubelet 업그레이드
sudo apt-get install -y kubelet=1.29.Y-*
sudo systemctl daemon-reload && sudo systemctl restart kubelet
```

```bash
# 검증 1: 버전 확인
kubectl version --short
```

```text
Client Version: v1.29.Y
Server Version: v1.29.Y
```

```bash
# 검증 2: 보안 설정 유지 확인
grep -E "audit-log-path|encryption-provider|admission-plugins|anonymous-auth" \
  /etc/kubernetes/manifests/kube-apiserver.yaml
```

```text
    - --audit-log-path=/var/log/kubernetes/audit/audit.log
    - --encryption-provider-config=/etc/kubernetes/enc/enc.yaml
    - --enable-admission-plugins=NodeRestriction,PodSecurity
    - --anonymous-auth=false
```

```bash
# 검증 3: 노드 상태 확인
kubectl get nodes
```

```text
NAME           STATUS   ROLES           AGE   VERSION
dev-master     Ready    control-plane   Xd    v1.29.Y
dev-worker-1   Ready    <none>          Xd    v1.29.X
```

워커 노드도 별도로 kubelet을 업그레이드해야 한다.

**트러블슈팅:**
- kubeadm upgrade가 실패하면 `sudo kubeadm upgrade apply --force`로 재시도한다. 그래도 실패하면 백업된 manifest를 복원한다.
- 업그레이드 후 Audit Policy가 초기화되었으면 백업에서 복원한다: `sudo cp /tmp/audit-policy.yaml.bak /etc/kubernetes/audit/policy.yaml`

</details>

---

### 문제 9. 불필요한 ClusterRoleBinding 제거

클러스터에서 `system:anonymous` 또는 `system:unauthenticated` 그룹에 바인딩된 ClusterRoleBinding을 찾아 제거하라.

<details>
<summary>풀이 확인</summary>

#### 공격-방어 매핑

`system:anonymous`에 ClusterRole이 바인딩되면 인증 없이 API 서버에 접근하여 해당 역할의 모든 권한을 행사할 수 있다. 잘못된 설정으로 `cluster-admin`이 anonymous에 바인딩되면 누구나 클러스터를 완전히 장악할 수 있다. 이는 실제로 발생한 보안 사고 패턴이다.

```bash
# 1. anonymous/unauthenticated에 바인딩된 ClusterRoleBinding 검색
kubectl get clusterrolebindings -o json | jq -r '
  .items[] |
  select(.subjects[]? |
    select(
      .name == "system:anonymous" or
      .name == "system:unauthenticated"
    )
  ) |
  "\(.metadata.name) -> \(.roleRef.name) [subject: \(.subjects[] | select(.name == "system:anonymous" or .name == "system:unauthenticated") | .name)]"
'
```

```text
anon-cluster-view -> cluster-view [subject: system:anonymous]
```

```bash
# 2. 발견된 바인딩 상세 확인
kubectl get clusterrolebinding anon-cluster-view -o yaml
```

```text
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: anon-cluster-view
roleRef:
  kind: ClusterRole
  name: cluster-view
subjects:
- kind: User
  name: system:anonymous
```

```bash
# 3. 불필요한 바인딩 제거
kubectl delete clusterrolebinding anon-cluster-view
```

```text
clusterrolebinding.rbac.authorization.k8s.io "anon-cluster-view" deleted
```

```bash
# 검증 1: 제거 확인
kubectl get clusterrolebindings -o json | jq -r '
  .items[] | select(.subjects[]? | select(.name == "system:anonymous")) | .metadata.name
'
```

출력이 없으면 anonymous 바인딩이 모두 제거된 것이다.

```bash
# 검증 2: 익명 접근 차단 확인
curl -sk https://<master-ip>:6443/api/v1/namespaces 2>&1 | jq .message
```

```text
"namespaces is forbidden: User \"system:anonymous\" cannot list resource \"namespaces\" in API group \"\" at the cluster scope"
```

**트러블슈팅:**
- `system:public-info-viewer` ClusterRoleBinding은 쿠버네티스 기본 바인딩이다. 이것은 `/healthz`, `/version` 등 공개 엔드포인트에 대한 접근만 허용하므로 제거하지 않는 것이 일반적이다.
- 시스템 바인딩(`system:` 접두사)을 제거하면 클러스터 동작에 영향을 줄 수 있다. 사용자가 직접 생성한 바인딩만 제거한다.

</details>

---

### 문제 10. Audit 로그 활성화

API 서버에 Audit 로깅을 활성화하고, Secret 접근이 기록되는지 확인하라.

<details>
<summary>풀이 확인</summary>

#### 등장 배경과 기존 한계점

Audit 로깅이 비활성화된 상태에서는 누가 언제 어떤 리소스에 접근했는지 추적할 수 없다. Secret 유출, RBAC 변경, Pod 삭제 등 보안 이벤트의 타임라인 재구성이 불가능하다. SOC 2, ISO 27001, PCI DSS 등 컴플라이언스에서도 API 감사 로그는 필수 요구사항이다.

```bash
# 1. Audit Policy 작성
ssh admin@<master-ip> 'sudo mkdir -p /etc/kubernetes/audit /var/log/kubernetes/audit'
ssh admin@<master-ip> 'sudo tee /etc/kubernetes/audit/policy.yaml' <<'EOF'
apiVersion: audit.k8s.io/v1
kind: Policy
rules:
- level: RequestResponse
  resources:
  - group: ""
    resources: ["secrets"]
- level: Metadata
  omitStages:
  - RequestReceived
EOF
```

```bash
# 2. kube-apiserver.yaml에 플래그 추가
# --audit-policy-file=/etc/kubernetes/audit/policy.yaml
# --audit-log-path=/var/log/kubernetes/audit/audit.log
# --audit-log-maxage=30
# --audit-log-maxbackup=10
# --audit-log-maxsize=100
# volumeMounts/volumes에 해당 경로 추가
```

```bash
# 검증 1: Audit 로그 파일 생성 확인
ssh admin@<master-ip> 'sudo ls -la /var/log/kubernetes/audit/audit.log'
```

```text
-rw------- 1 root root 12345 ... audit.log
```

```bash
# 검증 2: Secret 접근 후 로그 기록 확인
kubectl get secret -n demo
ssh admin@<master-ip> 'sudo tail -10 /var/log/kubernetes/audit/audit.log | jq "select(.objectRef.resource==\"secrets\") | {level, verb, user: .user.username}"'
```

```text
{
  "level": "RequestResponse",
  "verb": "list",
  "user": "kubernetes-admin"
}
```

**트러블슈팅:**
- volumeMounts와 volumes를 추가하지 않으면 API 서버가 Audit Policy 파일에 접근할 수 없어 시작에 실패한다.
- Audit 로그가 빠르게 커질 수 있으므로 `--audit-log-maxsize`와 `--audit-log-maxbackup`을 반드시 설정한다.

</details>

---

## System Hardening (5문항)

### 문제 11. AppArmor 프로파일 적용

`app-server` Pod에 AppArmor 프로파일을 적용하여 `/etc/passwd` 파일 읽기와 네트워크 raw socket 생성을 차단하라.

<details>
<summary>풀이 확인</summary>

#### 등장 배경과 기존 한계점

Linux 표준 DAC(Discretionary Access Control)은 파일 소유자 기반 권한만 제어한다. root 권한을 획득하면 모든 파일에 접근할 수 있다. AppArmor는 Linux 커널의 LSM(Linux Security Module) 프레임워크에 구현된 MAC(Mandatory Access Control) 시스템이다. 프로세스가 접근할 수 있는 파일, 네트워크 자원, capability를 프로파일로 정의하여, root 권한이 있어도 프로파일 밖의 자원에 접근할 수 없다.

#### 커널 레벨 동작 원리

AppArmor는 커널의 LSM 훅에서 동작한다. 프로세스가 파일 열기(open), 네트워크 소켓 생성(socket), 실행(exec) 등의 syscall을 호출하면, 커널이 LSM 훅을 통해 AppArmor 모듈을 호출한다. AppArmor 모듈은 해당 프로세스에 연결된 프로파일을 조회하고, 요청된 작업이 프로파일에 허용되어 있는지 확인한다.

```bash
# 1. AppArmor 프로파일 작성 (노드에서 실행)
ssh admin@<node-ip> 'sudo tee /etc/apparmor.d/k8s-deny-sensitive' <<'EOF'
#include <tunables/global>

profile k8s-deny-sensitive flags=(attach_disconnected,mediate_deleted) {
  #include <abstractions/base>

  # 파일 접근 규칙
  file,
  deny /etc/passwd r,
  deny /etc/shadow r,

  # 네트워크 규칙
  network inet stream,
  network inet dgram,
  deny network raw,

  # 시그널
  signal (receive) peer=unconfined,
}
EOF

# 2. 프로파일 로드
ssh admin@<node-ip> 'sudo apparmor_parser -r /etc/apparmor.d/k8s-deny-sensitive'
```

```bash
# 3. 프로파일 로드 확인
ssh admin@<node-ip> 'sudo aa-status | grep k8s-deny-sensitive'
```

```text
   k8s-deny-sensitive
```

```yaml
# 4. Pod에 AppArmor 프로파일 적용
apiVersion: v1
kind: Pod
metadata:
  name: app-server
  annotations:
    container.apparmor.security.beta.kubernetes.io/app: localhost/k8s-deny-sensitive
spec:
  containers:
  - name: app
    image: busybox:1.36
    command: ["sh", "-c", "sleep 3600"]
```

```bash
# 검증 1: /etc/passwd 읽기 차단 확인
kubectl exec app-server -- cat /etc/passwd 2>&1
```

```text
cat: can't open '/etc/passwd': Permission denied
```

```bash
# 검증 2: 일반 파일 읽기 허용 확인
kubectl exec app-server -- cat /etc/hostname
```

```text
app-server
```

```bash
# 검증 3: raw socket 차단 확인
kubectl exec app-server -- ping -c 1 8.8.8.8 2>&1
```

```text
ping: permission denied (are you root?)
```

ping은 raw socket(ICMP)을 사용하므로 AppArmor에 의해 차단된다.

```bash
# 정리
kubectl delete pod app-server
```

**트러블슈팅:**
- AppArmor 프로파일이 노드에 로드되지 않은 상태에서 Pod를 생성하면 `Blocked`  상태가 된다. `kubectl describe pod`에서 AppArmor 관련 에러를 확인한다.
- 쿠버네티스 1.30+에서는 annotation 대신 `securityContext.appArmorProfile`을 사용한다.

</details>

---

### 문제 12. Seccomp RuntimeDefault 적용

모든 컨테이너에 seccomp `RuntimeDefault` 프로파일을 적용하고, 위험한 syscall(unshare, mount)이 차단되는지 확인하라.

<details>
<summary>풀이 확인</summary>

#### 등장 배경과 기존 한계점

Linux 커널은 400개 이상의 syscall을 제공한다. 일반 컨테이너 워크로드는 이 중 50~100개만 사용한다. seccomp이 없으면(Unconfined) 컨테이너가 모든 syscall을 호출할 수 있고, 커널 취약점을 악용한 컨테이너 탈출이 가능하다. seccomp(secure computing mode)은 커널의 BPF(Berkeley Packet Filter) 프로그램으로 프로세스가 호출할 수 있는 syscall을 필터링한다. RuntimeDefault 프로파일은 컨테이너 런타임(containerd/CRI-O)이 제공하는 기본 차단 목록이며, 위험한 syscall(mount, unshare, reboot, kexec_load 등)을 차단한다.

#### 커널 레벨 동작 원리

seccomp BPF 필터는 커널의 `seccomp()` syscall 또는 `prctl(PR_SET_SECCOMP)` 호출로 설정된다. 필터가 설정된 후, 프로세스가 syscall을 호출할 때마다 커널이 BPF 프로그램을 실행하여 해당 syscall 번호가 허용 목록에 있는지 확인한다. 차단된 syscall을 호출하면 `SECCOMP_RET_ERRNO` 또는 `SECCOMP_RET_KILL_PROCESS`가 반환된다.

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: seccomp-test
spec:
  securityContext:
    seccompProfile:
      type: RuntimeDefault
  containers:
  - name: app
    image: busybox:1.36
    command: ["sh", "-c", "sleep 3600"]
    securityContext:
      allowPrivilegeEscalation: false
```

```bash
kubectl apply -f - <<'EOF'
apiVersion: v1
kind: Pod
metadata:
  name: seccomp-test
spec:
  securityContext:
    seccompProfile:
      type: RuntimeDefault
  containers:
  - name: app
    image: busybox:1.36
    command: ["sh", "-c", "sleep 3600"]
    securityContext:
      allowPrivilegeEscalation: false
EOF
```

```bash
# 검증 1: seccomp 프로파일 적용 확인
kubectl get pod seccomp-test -o jsonpath='{.spec.securityContext.seccompProfile}'
```

```text
{"type":"RuntimeDefault"}
```

```bash
# 검증 2: unshare syscall 차단 확인
kubectl exec seccomp-test -- unshare -r id 2>&1
```

```text
unshare: unshare(0x10000000): Operation not permitted
```

```bash
# 검증 3: mount syscall 차단 확인
kubectl exec seccomp-test -- mount -t tmpfs tmpfs /tmp 2>&1
```

```text
mount: permission denied (are you root?)
```

```bash
# 검증 4: 일반 명령어는 정상 동작
kubectl exec seccomp-test -- ls /
```

```text
bin   dev   etc   home  lib   proc  root  sys   tmp   usr   var
```

```bash
# 정리
kubectl delete pod seccomp-test
```

**트러블슈팅:**
- RuntimeDefault 프로파일의 구체적인 차단 목록은 컨테이너 런타임 버전에 따라 다르다. `crictl info | jq .config.containerd.default_runtime_name`으로 런타임을 확인한다.
- 일부 워크로드(예: Docker-in-Docker)는 RuntimeDefault에서 차단되는 syscall이 필요하다. 이 경우 Localhost 타입으로 커스텀 프로파일을 사용한다.

</details>

---

### 문제 13. Linux Capabilities 설정

`web-server` Pod에서 모든 capabilities를 제거하고, `NET_BIND_SERVICE`만 추가하여 80번 포트에서 서비스하라.

<details>
<summary>풀이 확인</summary>

#### 커널 레벨 동작 원리

1024 미만의 포트에 바인딩하려면 전통적으로 root 권한이 필요했다. Linux Capabilities는 이 권한을 `NET_BIND_SERVICE`라는 단일 capability로 분리했다. `drop: ALL`로 모든 capability를 제거한 후 `add: NET_BIND_SERVICE`만 추가하면, 프로세스는 1024 미만 포트 바인딩만 가능하고, 다른 특권 작업(네트워크 설정 변경, 파일 권한 무시, 커널 모듈 로딩 등)은 불가능하다.

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: web-server
spec:
  containers:
  - name: nginx
    image: nginx:1.25-alpine
    ports:
    - containerPort: 80
    securityContext:
      capabilities:
        drop: ["ALL"]
        add: ["NET_BIND_SERVICE"]
```

```bash
cat <<'EOF' | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: web-server
spec:
  containers:
  - name: nginx
    image: nginx:1.25-alpine
    ports:
    - containerPort: 80
    securityContext:
      capabilities:
        drop: ["ALL"]
        add: ["NET_BIND_SERVICE"]
EOF
```

```bash
# 검증 1: Pod 정상 실행 확인
kubectl get pod web-server
```

```text
NAME         READY   STATUS    RESTARTS   AGE
web-server   1/1     Running   0          10s
```

```bash
# 검증 2: 80번 포트 바인딩 확인
kubectl exec web-server -- cat /proc/net/tcp | head -3
```

```text
  sl  local_address rem_address   st tx_queue rx_queue ...
   0: 00000000:0050 00000000:0000 0A 00000000:00000000 ...
```

0050은 16진수로 80번 포트이다. 0A는 LISTEN 상태이다.

```bash
# 검증 3: Effective capabilities 확인
kubectl exec web-server -- cat /proc/1/status | grep CapEff
```

```text
CapEff:	0000000000000400
```

0x400은 이진수로 비트 10이 설정된 것이며, 이는 `NET_BIND_SERVICE`(capability 번호 10)만 활성화된 상태이다.

```bash
# 검증 4: capsh로 human-readable 확인 (이미지에 capsh가 있는 경우)
kubectl exec web-server -- cat /proc/1/status | grep -i cap
```

```text
CapInh:	0000000000000400
CapPrm:	0000000000000400
CapEff:	0000000000000400
CapBnd:	0000000000000400
CapAmb:	0000000000000000
```

모든 capability 집합에서 0x400(NET_BIND_SERVICE)만 설정되어 있다.

```bash
# 정리
kubectl delete pod web-server
```

**트러블슈팅:**
- `drop: ALL`만 설정하고 `add: NET_BIND_SERVICE`를 빠뜨리면 nginx가 80번 포트 바인딩에 실패하여 CrashLoopBackOff가 된다.
- capability 이름은 대문자이며 `CAP_` 접두사를 붙이지 않는다(잘못된 예: `CAP_NET_BIND_SERVICE`).

</details>

---

### 문제 14. 노드 불필요 패키지 제거

워커 노드에서 보안 위험이 있는 불필요한 패키지(telnet, netcat, tcpdump)를 식별하고 제거하라.

<details>
<summary>풀이 확인</summary>

#### 등장 배경과 기존 한계점

노드에 네트워크 디버깅 도구(telnet, netcat, tcpdump 등)가 설치되어 있으면, 노드에 접근한 공격자가 이 도구를 사용하여 네트워크 트래픽을 스니핑하거나, 리버스 셸을 생성하거나, 다른 노드로 측면 이동할 수 있다. CIS Benchmark에서도 최소한의 소프트웨어만 설치하도록 권고한다.

```bash
# 1. 위험 패키지 설치 여부 확인
ssh admin@<worker-ip> 'dpkg -l | grep -E "telnet|netcat|tcpdump|ncat|nmap|socat"'
```

```text
ii  netcat-openbsd  1.218-4ubuntu1  arm64  TCP/IP swiss army knife
ii  tcpdump         4.99.3-1build1  arm64  command-line network traffic analyzer
```

```bash
# 2. 불필요한 패키지 제거
ssh admin@<worker-ip> 'sudo apt-get remove --purge -y netcat-openbsd tcpdump'
```

```text
Removing netcat-openbsd (1.218-4ubuntu1) ...
Removing tcpdump (4.99.3-1build1) ...
```

```bash
# 검증 1: 패키지 제거 확인
ssh admin@<worker-ip> 'dpkg -l | grep -E "netcat|tcpdump"'
```

출력이 없으면 제거 완료이다.

```bash
# 검증 2: 바이너리 부재 확인
ssh admin@<worker-ip> 'which nc tcpdump 2>&1'
```

```text
nc not found
tcpdump not found
```

```bash
# 검증 3: 추가로 불필요한 서비스 확인
ssh admin@<worker-ip> 'sudo systemctl list-units --type=service --state=running | grep -E "ftp|telnet|rsh|rlogin"'
```

출력이 없으면 위험한 서비스가 실행되지 않는 것이다.

**트러블슈팅:**
- 일부 패키지는 다른 패키지의 의존성으로 설치되어 있을 수 있다. `apt-get remove`가 아닌 `apt-get autoremove --purge`로 의존성도 함께 제거한다.
- kubelet이나 containerd가 의존하는 패키지를 제거하지 않도록 주의한다. 제거 전에 `apt rdepends <package>`로 역의존성을 확인한다.

</details>

---

### 문제 15. sysctl 커널 파라미터 보안

Pod에서 안전한 sysctl 파라미터를 설정하고, 위험한 sysctl 파라미터가 차단되는지 확인하라.

<details>
<summary>풀이 확인</summary>

#### 등장 배경과 기존 한계점

sysctl은 Linux 커널 파라미터를 런타임에 변경하는 인터페이스이다(`/proc/sys/`). 일부 sysctl 파라미터는 네임스페이스별로 격리되어 안전하지만(safe sysctls), 다른 파라미터는 호스트 전체에 영향을 미쳐 다른 Pod나 노드 자체에 영향을 줄 수 있다(unsafe sysctls). 쿠버네티스는 기본적으로 safe sysctls만 허용하고, unsafe sysctls는 kubelet 설정에서 명시적으로 허용해야 한다.

#### safe vs unsafe sysctls

| 카테고리 | 예시 | 격리 수준 |
|---|---|---|
| safe | `kernel.shm_rmid_forced`, `net.ipv4.ip_local_port_range`, `net.ipv4.tcp_syncookies` | 네임스페이스 격리 |
| unsafe | `kernel.msgmax`, `net.core.somaxconn`, `vm.swappiness` | 호스트 전체 영향 |

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: sysctl-test
spec:
  securityContext:
    sysctls:
    - name: net.ipv4.ip_local_port_range
      value: "32768 60999"
    - name: kernel.shm_rmid_forced
      value: "1"
  containers:
  - name: app
    image: busybox:1.36
    command: ["sh", "-c", "sleep 3600"]
```

```bash
kubectl apply -f - <<'EOF'
apiVersion: v1
kind: Pod
metadata:
  name: sysctl-test
spec:
  securityContext:
    sysctls:
    - name: net.ipv4.ip_local_port_range
      value: "32768 60999"
    - name: kernel.shm_rmid_forced
      value: "1"
  containers:
  - name: app
    image: busybox:1.36
    command: ["sh", "-c", "sleep 3600"]
EOF
```

```bash
# 검증 1: safe sysctl 적용 확인
kubectl exec sysctl-test -- sysctl net.ipv4.ip_local_port_range
```

```text
net.ipv4.ip_local_port_range = 32768	60999
```

```bash
# 검증 2: unsafe sysctl 시도 (차단)
cat <<'EOF' | kubectl apply -f - 2>&1
apiVersion: v1
kind: Pod
metadata:
  name: unsafe-sysctl-test
spec:
  securityContext:
    sysctls:
    - name: vm.swappiness
      value: "10"
  containers:
  - name: app
    image: busybox:1.36
    command: ["sh", "-c", "sleep 3600"]
EOF
```

```text
Error from server (Forbidden): ... sysctl "vm.swappiness" is not allowed
```

```bash
# 정리
kubectl delete pod sysctl-test
```

**트러블슈팅:**
- unsafe sysctl을 허용하려면 kubelet 설정에 `--allowed-unsafe-sysctls=vm.swappiness` 플래그를 추가해야 한다. 이는 보안 위험이 있으므로 신중히 판단한다.
- PodSecurity restricted 레벨에서는 safe sysctls도 제한될 수 있다. 네임스페이스의 PSA 설정을 확인한다.

</details>

---

## Minimize Microservice Vulnerabilities (5문항)

### 문제 16. PodSecurity Admission 적용

`restricted-ns` 네임스페이스에 `restricted` PodSecurity 표준을 enforce 모드로 적용하라.

<details>
<summary>풀이 확인</summary>

```bash
kubectl label namespace restricted-ns \
  pod-security.kubernetes.io/enforce=restricted \
  pod-security.kubernetes.io/enforce-version=latest
```

```bash
# 검증: 비준수 Pod 생성 시도 (거부)
kubectl -n restricted-ns run test --image=nginx 2>&1
```

```text
Error from server (Forbidden): ... violates PodSecurity "restricted:latest"
```

</details>

---

### 문제 17. OPA Gatekeeper 레지스트리 제한

OPA Gatekeeper로 `production` 네임스페이스에서 `gcr.io/` 또는 `registry.internal.io/` 접두사를 가진 이미지만 허용하는 정책을 적용하라.

<details>
<summary>풀이 확인</summary>

#### 등장 배경과 기존 한계점

기본 쿠버네티스에서는 모든 컨테이너 레지스트리의 이미지를 pull할 수 있다. 공격자가 typosquatting(오타를 이용한 유사 이미지명)이나 dependency confusion 공격으로 악성 이미지를 주입할 수 있다. 신뢰할 수 있는 레지스트리만 허용하면 검증되지 않은 이미지의 사용을 원천 차단할 수 있다.

```bash
# 1. ConstraintTemplate 생성
cat <<'EOF' | kubectl apply -f -
apiVersion: templates.gatekeeper.sh/v1
kind: ConstraintTemplate
metadata:
  name: k8sallowedrepos
spec:
  crd:
    spec:
      names:
        kind: K8sAllowedRepos
      validation:
        openAPIV3Schema:
          type: object
          properties:
            repos:
              type: array
              items:
                type: string
  targets:
  - target: admission.k8s.gatekeeper.sh
    rego: |
      package k8sallowedrepos
      violation[{"msg": msg}] {
        container := input.review.object.spec.containers[_]
        satisfied := [good | repo = input.parameters.repos[_]; good = startswith(container.image, repo)]
        not any(satisfied)
        msg := sprintf("container <%v> has an invalid image repo <%v>, allowed repos are %v", [container.name, container.image, input.parameters.repos])
      }
      violation[{"msg": msg}] {
        container := input.review.object.spec.initContainers[_]
        satisfied := [good | repo = input.parameters.repos[_]; good = startswith(container.image, repo)]
        not any(satisfied)
        msg := sprintf("initContainer <%v> has an invalid image repo <%v>, allowed repos are %v", [container.name, container.image, input.parameters.repos])
      }
EOF

# 2. Constraint 생성
cat <<'EOF' | kubectl apply -f -
apiVersion: constraints.gatekeeper.sh/v1beta1
kind: K8sAllowedRepos
metadata:
  name: prod-allowed-repos
spec:
  match:
    kinds:
    - apiGroups: [""]
      kinds: ["Pod"]
    namespaces: ["production"]
  parameters:
    repos:
    - "gcr.io/"
    - "registry.internal.io/"
EOF
```

```bash
kubectl create namespace production 2>/dev/null

# 검증 1: 허용된 레지스트리 (성공)
kubectl run gcr-app --image=gcr.io/google-containers/pause:3.9 -n production 2>&1
```

```text
pod/gcr-app created
```

```bash
# 검증 2: 비허용 레지스트리 (거부)
kubectl run dockerhub-app --image=nginx:alpine -n production 2>&1
```

```text
Error from server (Forbidden): admission webhook "validation.gatekeeper.sh" denied the request: [prod-allowed-repos] container <dockerhub-app> has an invalid image repo <nginx:alpine>, allowed repos are ["gcr.io/", "registry.internal.io/"]
```

```bash
# 검증 3: 다른 네임스페이스에서는 제한 없음
kubectl run any-app --image=nginx:alpine -n default 2>&1
```

```text
pod/any-app created
```

```bash
# 정리
kubectl delete namespace production
kubectl delete k8sallowedrepos prod-allowed-repos
kubectl delete constrainttemplate k8sallowedrepos
kubectl delete pod any-app -n default 2>/dev/null
```

**트러블슈팅:**
- initContainers도 검사해야 한다. Rego 정책에서 `initContainers`를 누락하면 initContainer에서 악성 이미지를 사용할 수 있다.
- 이미지 태그 없이 `nginx`만 지정하면 `docker.io/library/nginx:latest`로 해석된다. 레지스트리 접두사가 없는 이미지도 고려해야 한다.

</details>

---

### 문제 18. SecurityContext 종합 적용

`secure-workload` Pod에 CKS 모범 사례를 모두 적용하라: runAsNonRoot, readOnlyRootFilesystem, drop ALL capabilities, seccompProfile, allowPrivilegeEscalation=false.

<details>
<summary>풀이 확인</summary>

#### 공격-방어 매핑

| SecurityContext 설정 | 차단하는 공격 |
|---|---|
| `runAsNonRoot: true` | root 권한 남용, 커널 exploit |
| `readOnlyRootFilesystem: true` | 악성 바이너리 설치, 웹셸 배포, 설정 파일 변조 |
| `capabilities.drop: ["ALL"]` | 네트워크 스니핑(NET_RAW), 파일시스템 탈출(DAC_OVERRIDE), 커널 모듈 로딩(SYS_MODULE) |
| `seccompProfile: RuntimeDefault` | 위험 syscall(mount, unshare, kexec_load) 호출 |
| `allowPrivilegeEscalation: false` | setuid 바이너리를 통한 권한 상승 |

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: secure-workload
spec:
  automountServiceAccountToken: false
  securityContext:
    runAsNonRoot: true
    runAsUser: 1000
    runAsGroup: 1000
    fsGroup: 1000
    seccompProfile:
      type: RuntimeDefault
  containers:
  - name: app
    image: busybox:1.36
    command: ["sh", "-c", "while true; do echo secure; sleep 60; done"]
    securityContext:
      allowPrivilegeEscalation: false
      readOnlyRootFilesystem: true
      capabilities:
        drop: ["ALL"]
    resources:
      requests:
        cpu: 10m
        memory: 16Mi
      limits:
        cpu: 50m
        memory: 64Mi
    volumeMounts:
    - name: tmp
      mountPath: /tmp
  volumes:
  - name: tmp
    emptyDir: {}
```

```bash
cat <<'EOF' | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: secure-workload
spec:
  automountServiceAccountToken: false
  securityContext:
    runAsNonRoot: true
    runAsUser: 1000
    runAsGroup: 1000
    seccompProfile:
      type: RuntimeDefault
  containers:
  - name: app
    image: busybox:1.36
    command: ["sh", "-c", "while true; do echo secure; sleep 60; done"]
    securityContext:
      allowPrivilegeEscalation: false
      readOnlyRootFilesystem: true
      capabilities:
        drop: ["ALL"]
    resources:
      requests:
        cpu: 10m
        memory: 16Mi
      limits:
        cpu: 50m
        memory: 64Mi
    volumeMounts:
    - name: tmp
      mountPath: /tmp
  volumes:
  - name: tmp
    emptyDir: {}
EOF
```

```bash
# 검증 1: Pod 정상 실행
kubectl get pod secure-workload
```

```text
NAME              READY   STATUS    RESTARTS   AGE
secure-workload   1/1     Running   0          10s
```

```bash
# 검증 2: non-root 실행 확인
kubectl exec secure-workload -- id
```

```text
uid=1000 gid=1000
```

```bash
# 검증 3: 파일시스템 쓰기 차단
kubectl exec secure-workload -- touch /etc/test 2>&1
```

```text
touch: /etc/test: Read-only file system
```

```bash
# 검증 4: capabilities 제거 확인
kubectl exec secure-workload -- cat /proc/1/status | grep CapEff
```

```text
CapEff:	0000000000000000
```

```bash
# 검증 5: SA 토큰 부재
kubectl exec secure-workload -- ls /var/run/secrets/ 2>&1
```

```text
ls: /var/run/secrets/: No such file or directory
```

```bash
# 정리
kubectl delete pod secure-workload
```

</details>

---

### 문제 19. Secret Volume 마운트 보안

Secret을 환경변수가 아닌 Volume으로 마운트하고, 특정 키만 선택적으로 마운트하라. 파일 권한을 0400으로 제한하라.

<details>
<summary>풀이 확인</summary>

#### 등장 배경과 기존 한계점

Secret을 환경변수(envFrom)로 주입하면 `/proc/<pid>/environ` 파일을 통해 모든 환경변수가 노출된다. 또한 환경변수는 자식 프로세스에 상속되고, 크래시 덤프나 로그에 출력될 위험이 있다. Volume 마운트는 파일시스템 경로로 Secret을 제공하므로 파일 권한(defaultMode)으로 접근을 제한할 수 있다. 특정 키만 선택적으로 마운트하면 불필요한 Secret 노출을 최소화한다.

```bash
# 1. Secret 생성
kubectl create secret generic db-creds \
  --from-literal=username=dbadmin \
  --from-literal=password=s3cureP@ss \
  --from-literal=connection-string=postgresql://dbadmin:s3cureP@ss@db:5432/app
```

```yaml
# 2. 특정 키만 Volume으로 마운트
apiVersion: v1
kind: Pod
metadata:
  name: secret-mount-test
spec:
  containers:
  - name: app
    image: busybox:1.36
    command: ["sh", "-c", "sleep 3600"]
    volumeMounts:
    - name: db-creds
      mountPath: /etc/secrets
      readOnly: true
  volumes:
  - name: db-creds
    secret:
      secretName: db-creds
      defaultMode: 0400
      items:
      - key: username
        path: db-username
      - key: password
        path: db-password
```

```bash
cat <<'EOF' | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: secret-mount-test
spec:
  containers:
  - name: app
    image: busybox:1.36
    command: ["sh", "-c", "sleep 3600"]
    volumeMounts:
    - name: db-creds
      mountPath: /etc/secrets
      readOnly: true
  volumes:
  - name: db-creds
    secret:
      secretName: db-creds
      defaultMode: 0400
      items:
      - key: username
        path: db-username
      - key: password
        path: db-password
EOF
```

```bash
# 검증 1: 마운트된 파일 확인 (connection-string은 마운트되지 않음)
kubectl exec secret-mount-test -- ls -la /etc/secrets/
```

```text
total 0
dr-xr-xr-x    ... .
drwxr-xr-x    ... ..
lrwxrwxrwx    ... db-password -> ..data/db-password
lrwxrwxrwx    ... db-username -> ..data/db-username
```

```bash
# 검증 2: 파일 권한 확인 (0400 = 소유자만 읽기)
kubectl exec secret-mount-test -- ls -la /etc/secrets/..data/
```

```text
total 8
dr-xr-xr-x    ... .
drwxrwxrwt    ... ..
-r--------    ... db-password
-r--------    ... db-username
```

```bash
# 검증 3: Secret 값 읽기
kubectl exec secret-mount-test -- cat /etc/secrets/db-username
```

```text
dbadmin
```

```bash
# 검증 4: connection-string은 마운트되지 않음
kubectl exec secret-mount-test -- cat /etc/secrets/connection-string 2>&1
```

```text
cat: can't open '/etc/secrets/connection-string': No such file or directory
```

```bash
# 검증 5: 환경변수에는 Secret이 없음
kubectl exec secret-mount-test -- env | grep -i db
```

출력이 없으면 환경변수로 노출되지 않은 것이다.

```bash
# 정리
kubectl delete pod secret-mount-test
kubectl delete secret db-creds
```

**트러블슈팅:**
- `defaultMode: 0400`은 8진수로 해석된다. YAML에서 따옴표 없이 `0400`으로 쓴다.
- `items`를 지정하면 명시하지 않은 키는 마운트되지 않는다. 모든 키를 마운트하려면 `items`를 생략한다.

</details>

---

### 문제 20. 컨테이너 불변성 검증

실행 중인 Pod의 불변성을 검증하라. readOnlyRootFilesystem이 설정되지 않은 Pod를 찾고, 해당 Pod의 파일시스템 변경 가능 여부를 확인하라.

<details>
<summary>풀이 확인</summary>

#### 공격-방어 매핑

쓰기 가능한 파일시스템을 가진 컨테이너에서 공격자는 다음을 수행할 수 있다:
1. `curl/wget`으로 악성 바이너리를 다운로드하여 실행한다
2. `/etc/crontab`에 크론잡을 추가하여 지속성(persistence)을 확보한다
3. 웹 서버의 document root에 웹셸을 배포한다
4. 로그 파일을 삭제하여 침입 흔적을 제거한다

```bash
# 1. readOnlyRootFilesystem이 설정되지 않은 Pod 검색
kubectl get pods -A -o json | jq -r '
  .items[] |
  . as $pod |
  .spec.containers[] |
  select(.securityContext.readOnlyRootFilesystem != true) |
  "\($pod.metadata.namespace)/\($pod.metadata.name) container=\(.name)"
'
```

```text
demo/httpbin-xxxxx-xxxxx container=httpbin
demo/nginx-web-xxxxx-xxxxx container=nginx
demo/postgres-0 container=postgres
demo/redis-0 container=redis
kube-system/coredns-xxxxx-xxxxx container=coredns
...
```

```bash
# 2. 특정 Pod의 파일시스템 쓰기 가능 여부 확인
NGINX_POD=$(kubectl get pods -n demo -l app=nginx-web -o jsonpath='{.items[0].metadata.name}')
kubectl exec $NGINX_POD -n demo -c nginx -- sh -c 'echo "test" > /tmp/write-test && echo "WRITABLE" || echo "READ-ONLY"'
```

```text
WRITABLE
```

```bash
# 3. readOnlyRootFilesystem 설정 확인
kubectl get pod $NGINX_POD -n demo -o jsonpath='{.spec.containers[0].securityContext.readOnlyRootFilesystem}'
```

출력이 비어있거나 `false`이면 파일시스템이 쓰기 가능한 상태이다.

```bash
# 4. 전체 네임스페이스에서 불변성 미적용 Pod 수 집계
kubectl get pods -A -o json | jq '
  [.items[] | .spec.containers[] |
   select(.securityContext.readOnlyRootFilesystem != true)] | length
'
```

```text
15
```

**권장 조치:** 각 Pod에 `readOnlyRootFilesystem: true`를 적용하고, 쓰기가 필요한 경로에만 emptyDir을 마운트한다.

```bash
# 정리: 테스트 파일 제거
kubectl exec $NGINX_POD -n demo -c nginx -- rm -f /tmp/write-test
```

**트러블슈팅:**
- 일부 애플리케이션(PostgreSQL, Redis)은 데이터 디렉토리에 쓰기가 필요하다. 이 경우 PVC나 emptyDir을 사용하고, 루트 파일시스템은 읽기 전용으로 설정한다.
- initContainer에서도 `readOnlyRootFilesystem`을 설정해야 한다. initContainer를 누락하면 초기화 단계에서 파일시스템이 변조될 수 있다.

</details>

---

## Supply Chain Security (5문항)

### 문제 21. Trivy 이미지 스캔

`nginx:1.25` 이미지를 Trivy로 스캔하고, CRITICAL/HIGH 취약점을 식별하라. 취약점이 수정된 버전으로 업데이트하라.

<details>
<summary>풀이 확인</summary>

#### 등장 배경과 기존 한계점

컨테이너 이미지에는 OS 패키지, 라이브러리, 바이너리가 포함되어 있으며, 이 중 알려진 CVE(Common Vulnerabilities and Exposures)가 존재할 수 있다. 이미지 스캔 없이 배포하면 공개된 exploit으로 컨테이너가 침해될 수 있다. Trivy는 Aqua Security가 개발한 오픈소스 이미지 스캐너로, OS 패키지와 언어별 라이브러리의 취약점을 동시에 검사한다.

```bash
# 1. CRITICAL/HIGH 취약점 스캔
trivy image --severity CRITICAL,HIGH nginx:1.25
```

```text
nginx:1.25 (debian 12.X)
Total: 15 (HIGH: 12, CRITICAL: 3)

┌─────────────────┬────────────────┬──────────┬────────────────┬───────────────┬─────────────────────────────┐
│    Library       │ Vulnerability  │ Severity │ Installed Ver  │ Fixed Version │           Title             │
├─────────────────┼────────────────┼──────────┼────────────────┼───────────────┼─────────────────────────────┤
│ libcurl4         │ CVE-XXXX-XXXXX │ CRITICAL │ 7.88.1-10      │ 7.88.1-10+d  │ curl: ...                   │
│ openssl          │ CVE-XXXX-XXXXX │ CRITICAL │ 3.0.11-1       │ 3.0.13-1     │ openssl: ...                │
│ ...              │ ...            │ ...      │ ...            │ ...          │ ...                         │
└─────────────────┴────────────────┴──────────┴────────────────┴───────────────┴─────────────────────────────┘
```

```bash
# 2. 수정 가능한 취약점만 필터링
trivy image --severity CRITICAL,HIGH --ignore-unfixed nginx:1.25
```

```text
Total: 8 (HIGH: 6, CRITICAL: 2)
```

```bash
# 3. 최신 버전 스캔 비교
trivy image --severity CRITICAL,HIGH --ignore-unfixed nginx:1.25-alpine
```

```text
Total: 0 (HIGH: 0, CRITICAL: 0)
```

alpine 기반 이미지가 취약점이 적다. 이미지를 `nginx:1.25-alpine`으로 교체하는 것을 권장한다.

```bash
# 검증: JSON 출력으로 자동화
trivy image --format json --severity CRITICAL nginx:1.25 | \
  jq '[.Results[].Vulnerabilities[]? | select(.Severity == "CRITICAL")] | length'
```

```text
3
```

**트러블슈팅:**
- `trivy image --download-db-only`로 DB를 미리 다운로드하면 오프라인 환경에서도 스캔할 수 있다.
- 프라이빗 레지스트리 이미지는 `--username`, `--password` 또는 Docker config.json 인증을 사용한다.

</details>

---

### 문제 22. Dockerfile 보안 강화

다음 취약한 Dockerfile을 보안 모범 사례에 맞게 수정하라.

```dockerfile
FROM ubuntu:latest
RUN apt-get update && apt-get install -y curl
COPY app /app
RUN echo "DB_PASSWORD=secret123" >> /etc/environment
USER root
CMD ["/app"]
```

<details>
<summary>풀이 확인</summary>

#### 공격-방어 매핑

| 취약점 | 공격 시나리오 | 수정 방법 |
|---|---|---|
| `FROM ubuntu:latest` | 버전 고정 없이 최신 이미지를 사용하면 취약한 버전이 배포될 수 있다 | 특정 버전 태그 사용 + multi-stage build |
| 민감정보를 레이어에 저장 | 이미지 레이어에 DB_PASSWORD가 영구 저장된다. `docker history`로 누구나 볼 수 있다 | 빌드 타임 Secret은 Docker BuildKit secret mount 사용 |
| `USER root` | 컨테이너가 root로 실행되어 커널 exploit, 파일시스템 탈출이 가능하다 | non-root 사용자로 실행 |
| 불필요한 패키지(curl) | 공격자가 curl로 악성 코드를 다운로드할 수 있다 | multi-stage build로 런타임 이미지에서 제거 |

```dockerfile
# 수정된 Dockerfile
# Stage 1: Build
FROM ubuntu:22.04 AS builder
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && \
    rm -rf /var/lib/apt/lists/*
COPY app /app

# Stage 2: Runtime (distroless)
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=builder /app /app
USER 65534:65534
ENTRYPOINT ["/app"]
```

```bash
# 검증 1: 원본 이미지와 수정된 이미지 크기 비교
docker build -t insecure-app -f Dockerfile.insecure .
docker build -t secure-app -f Dockerfile.secure .
docker images | grep -E "insecure-app|secure-app"
```

```text
secure-app     latest   abc123   5 seconds ago   15MB
insecure-app   latest   def456   10 seconds ago  230MB
```

```bash
# 검증 2: 수정된 이미지에 셸이 없음 (공격 표면 최소화)
docker run --rm secure-app /bin/sh 2>&1
```

```text
docker: Error response from daemon: failed to create task for container: ...
```

distroless 이미지에는 셸이 없으므로 컨테이너 내부에서 셸 기반 공격이 불가능하다.

```bash
# 검증 3: 이미지 레이어에 민감정보 부재 확인
docker history secure-app | grep -i password
```

출력이 없으면 민감정보가 레이어에 포함되지 않은 것이다.

```bash
# 검증 4: Trivy 스캔
trivy image --severity CRITICAL secure-app
```

```text
Total: 0 (CRITICAL: 0)
```

**트러블슈팅:**
- distroless 이미지에 셸이 없으므로 디버깅이 어렵다. 디버깅이 필요한 경우 `gcr.io/distroless/static-debian12:debug` 태그를 사용한다.
- multi-stage build에서 `COPY --from=builder`로 필요한 파일만 복사해야 한다. 전체 파일시스템을 복사하면 빌드 의존성이 런타임 이미지에 포함된다.

</details>

---

### 문제 23. 이미지 다이제스트 고정

Pod에서 이미지 태그 대신 SHA-256 다이제스트를 사용하여 이미지 변조를 방지하라.

<details>
<summary>풀이 확인</summary>

#### 등장 배경과 기존 한계점

이미지 태그(예: `nginx:1.25`)는 mutable이다. 공격자가 레지스트리를 침해하여 동일 태그에 악성 이미지를 push하면, 기존 태그를 pull하는 모든 클러스터가 악성 이미지를 사용하게 된다. SHA-256 다이제스트는 이미지 콘텐츠의 해시이므로 변조할 수 없다.

```bash
# 1. 이미지 다이제스트 확인
docker pull nginx:1.25-alpine
docker inspect nginx:1.25-alpine | jq -r '.[0].RepoDigests[0]'
```

```text
nginx@sha256:a4b8e46a1234567890abcdef1234567890abcdef1234567890abcdef12345678
```

```yaml
# 2. 다이제스트를 사용한 Pod
apiVersion: v1
kind: Pod
metadata:
  name: digest-pod
spec:
  containers:
  - name: nginx
    image: nginx@sha256:a4b8e46a1234567890abcdef1234567890abcdef1234567890abcdef12345678
    ports:
    - containerPort: 80
```

```bash
# 검증 1: Pod의 이미지 필드에 다이제스트가 포함되었는지 확인
kubectl get pod digest-pod -o jsonpath='{.spec.containers[0].image}'
```

```text
nginx@sha256:a4b8e46a1234567890abcdef1234567890abcdef1234567890abcdef12345678
```

```bash
# 검증 2: 실행 중인 이미지의 다이제스트 확인
kubectl get pod digest-pod -o jsonpath='{.status.containerStatuses[0].imageID}'
```

```text
docker.io/library/nginx@sha256:a4b8e46a1234567890abcdef...
```

spec의 다이제스트와 status의 imageID가 일치하면 정확한 이미지가 실행 중인 것이다.

```bash
# 정리
kubectl delete pod digest-pod
```

**트러블슈팅:**
- 다이제스트는 이미지가 재빌드되면 변경된다. CI/CD 파이프라인에서 빌드 후 자동으로 다이제스트를 업데이트하는 프로세스가 필요하다.
- `crane digest nginx:1.25-alpine` 명령(google/go-containerregistry)으로 레지스트리에서 직접 다이제스트를 조회할 수 있다.

</details>

---

### 문제 24. ImagePolicyWebhook 설정

ImagePolicyWebhook Admission Controller를 구성하여 이미지 정책을 외부 웹훅 서버에서 검증하도록 설정하라.

<details>
<summary>풀이 확인</summary>

#### 등장 배경과 기존 한계점

OPA Gatekeeper는 범용 정책 엔진이다. ImagePolicyWebhook은 쿠버네티스 내장 Admission Controller로, 이미지 배포 시 외부 웹훅 서버에 이미지 정보를 보내 허용/차단 결정을 받는다. 이미지 서명 검증(cosign, Notary), 취약점 스캔 결과 확인 등 복잡한 정책을 외부 서버에서 구현할 수 있다.

```bash
# 1. Admission Configuration 작성
sudo mkdir -p /etc/kubernetes/admission
sudo tee /etc/kubernetes/admission/admission-config.yaml <<'EOF'
apiVersion: apiserver.config.k8s.io/v1
kind: AdmissionConfiguration
plugins:
- name: ImagePolicyWebhook
  configuration:
    imagePolicy:
      kubeConfigFile: /etc/kubernetes/admission/imagepolicy-kubeconfig.yaml
      allowTTL: 50
      denyTTL: 50
      retryBackoff: 500
      defaultAllow: false
EOF

# 2. kubeconfig for webhook
sudo tee /etc/kubernetes/admission/imagepolicy-kubeconfig.yaml <<'EOF'
apiVersion: v1
kind: Config
clusters:
- cluster:
    certificate-authority: /etc/kubernetes/admission/webhook-ca.crt
    server: https://image-policy-webhook.svc:443/validate
  name: image-policy
contexts:
- context:
    cluster: image-policy
    user: api-server
  name: image-policy
current-context: image-policy
users:
- name: api-server
  user:
    client-certificate: /etc/kubernetes/pki/apiserver.crt
    client-key: /etc/kubernetes/pki/apiserver.key
EOF
```

```yaml
# 3. kube-apiserver.yaml에 플래그 추가
# - --enable-admission-plugins=...,ImagePolicyWebhook
# - --admission-control-config-file=/etc/kubernetes/admission/admission-config.yaml
```

```bash
# 검증 1: Admission Plugin 활성화 확인
ssh admin@<master-ip> 'ps aux | grep kube-apiserver' | tr ' ' '\n' | grep ImagePolicyWebhook
```

```text
--enable-admission-plugins=NodeRestriction,PodSecurity,ImagePolicyWebhook
```

```bash
# 검증 2: defaultAllow: false 상태에서 웹훅 서버 미응답 시 (차단)
kubectl run test --image=nginx:alpine 2>&1
```

웹훅 서버가 동작하지 않고 `defaultAllow: false`인 경우:
```text
Error from server (Forbidden): pods "test" is forbidden: image policy webhook backend denied one or more images
```

**트러블슈팅:**
- `defaultAllow: false`로 설정하면 웹훅 서버가 다운될 때 모든 Pod 생성이 차단된다. 운영 환경에서는 `defaultAllow: true`로 설정하고 웹훅 서버의 가용성을 보장한다.
- Admission Configuration 파일 경로를 volumeMounts로 마운트해야 한다.

</details>

---

### 문제 25. kubesec Static Analysis

kubesec으로 Pod 매니페스트의 보안 점수를 확인하고, 점수를 높이는 방향으로 수정하라.

<details>
<summary>풀이 확인</summary>

#### 등장 배경과 기존 한계점

YAML 매니페스트를 수동으로 검토하여 보안 모범 사례를 확인하는 것은 시간이 많이 걸리고 누락이 발생한다. kubesec은 Pod 매니페스트의 보안 설정을 점수화하여 개선 포인트를 자동으로 제시하는 정적 분석 도구이다.

```bash
# 1. 취약한 Pod 매니페스트 작성
cat > /tmp/insecure-pod.yaml <<'EOF'
apiVersion: v1
kind: Pod
metadata:
  name: insecure-pod
spec:
  containers:
  - name: app
    image: nginx
    securityContext:
      privileged: true
EOF

# 2. kubesec 분석
kubesec scan /tmp/insecure-pod.yaml
```

```text
[
  {
    "object": "Pod/insecure-pod.default",
    "valid": true,
    "fileName": "/tmp/insecure-pod.yaml",
    "message": "Failed with a score of -30 points",
    "score": -30,
    "scoring": {
      "critical": [
        {
          "id": "Privileged",
          "selector": "containers[] .securityContext .privileged == true",
          "reason": "Privileged containers share namespaces with the host",
          "points": -30
        }
      ],
      "advise": [
        {
          "id": "RunAsNonRoot",
          "selector": ".spec.securityContext .runAsNonRoot == true",
          "reason": "Force the running image to run as a non-root user",
          "points": 1
        },
        {
          "id": "ReadOnlyRootFilesystem",
          "selector": "containers[] .securityContext .readOnlyRootFilesystem == true",
          "reason": "An immutable root filesystem prevents applications from writing to their local disk",
          "points": 1
        }
      ]
    }
  }
]
```

```bash
# 3. 보안 강화된 매니페스트
cat > /tmp/secure-pod.yaml <<'EOF'
apiVersion: v1
kind: Pod
metadata:
  name: secure-pod
spec:
  securityContext:
    runAsNonRoot: true
    runAsUser: 1000
  containers:
  - name: app
    image: nginx:1.25-alpine
    securityContext:
      readOnlyRootFilesystem: true
      allowPrivilegeEscalation: false
      capabilities:
        drop: ["ALL"]
    resources:
      requests:
        cpu: 10m
        memory: 16Mi
      limits:
        cpu: 50m
        memory: 64Mi
EOF

# 4. 재분석
kubesec scan /tmp/secure-pod.yaml
```

```text
[
  {
    "object": "Pod/secure-pod.default",
    "valid": true,
    "message": "Passed with a score of 7 points",
    "score": 7,
    "scoring": {
      "critical": [],
      "advise": [...]
    }
  }
]
```

```bash
# 정리
rm -f /tmp/insecure-pod.yaml /tmp/secure-pod.yaml
```

**트러블슈팅:**
- kubesec이 설치되지 않은 경우 온라인 API를 사용할 수 있다: `curl -sSX POST --data-binary @pod.yaml https://v2.kubesec.io/scan`
- 점수가 0 미만이면 critical 보안 문제가 있다. 0 이상을 목표로 한다.

</details>

---

## Monitoring, Logging & Runtime Security (5문항)

### 문제 26. Falco 규칙으로 컨테이너 내 셸 실행 탐지

Falco 규칙을 작성하여 컨테이너 내에서 셸(bash, sh, zsh)이 실행될 때 경고를 발생시키라.

<details>
<summary>풀이 확인</summary>

```yaml
# /etc/falco/falco_rules.local.yaml
- rule: Shell Spawned in Container
  desc: 컨테이너 내에서 셸 프로세스가 실행되었음을 탐지한다.
  condition: >
    spawned_process and container and
    proc.name in (bash, sh, zsh, dash, ash)
  output: >
    Shell spawned in container (user=%user.name shell=%proc.name
    container=%container.name pod=%k8s.pod.name namespace=%k8s.ns.name)
  priority: WARNING
  tags: [shell, mitre_execution]
```

```bash
# 검증 1: 규칙 문법 검증
falco --validate /etc/falco/falco_rules.local.yaml
```

```text
/etc/falco/falco_rules.local.yaml: Ok
```

```bash
# 검증 2: 테스트
kubectl exec -it test-pod -- /bin/bash
# Falco 로그 확인:
sudo journalctl -u falco | grep "Shell spawned"
```

```text
Shell spawned in container (user=root shell=bash container=test-pod ...)
```

</details>

---

### 문제 27. Audit 로그 분석

Audit 로그에서 최근 1시간 동안 Secret에 접근한 사용자와 동작을 분석하라. 의심스러운 접근 패턴을 식별하라.

<details>
<summary>풀이 확인</summary>

#### 등장 배경과 기존 한계점

Audit 로그가 기록되더라도 분석하지 않으면 무용지물이다. Secret에 대한 비정상적 접근(비인가 사용자의 list/get, 심야 시간대 접근, 과도한 빈도의 접근)은 데이터 유출의 전조이다. Audit 로그를 정기적으로 분석하여 의심스러운 패턴을 탐지해야 한다.

```bash
# 1. Secret 접근 기록만 추출
ssh admin@<master-ip> 'sudo cat /var/log/kubernetes/audit/audit.log' | \
  jq 'select(.objectRef.resource == "secrets") | {
    time: .requestReceivedTimestamp,
    user: .user.username,
    verb: .verb,
    namespace: .objectRef.namespace,
    name: .objectRef.name,
    code: .responseStatus.code
  }' 2>/dev/null | head -40
```

```text
{
  "time": "2024-01-15T10:30:00.000000Z",
  "user": "kubernetes-admin",
  "verb": "list",
  "namespace": "demo",
  "name": null,
  "code": 200
}
{
  "time": "2024-01-15T10:31:00.000000Z",
  "user": "system:serviceaccount:demo:default",
  "verb": "get",
  "namespace": "demo",
  "name": "postgres-secret",
  "code": 200
}
```

```bash
# 2. 사용자별 Secret 접근 횟수 집계
ssh admin@<master-ip> 'sudo cat /var/log/kubernetes/audit/audit.log' | \
  jq -r 'select(.objectRef.resource == "secrets") | .user.username' 2>/dev/null | \
  sort | uniq -c | sort -rn
```

```text
     45 system:apiserver
     12 kubernetes-admin
      3 system:serviceaccount:demo:default
      1 system:serviceaccount:unknown:suspicious-sa
```

`unknown` 네임스페이스의 `suspicious-sa`가 Secret에 접근한 것은 의심스러운 패턴이다.

```bash
# 3. 403(Forbidden) 응답 분석 (권한 없는 접근 시도)
ssh admin@<master-ip> 'sudo cat /var/log/kubernetes/audit/audit.log' | \
  jq 'select(.objectRef.resource == "secrets" and .responseStatus.code == 403) | {
    time: .requestReceivedTimestamp,
    user: .user.username,
    verb: .verb,
    namespace: .objectRef.namespace
  }' 2>/dev/null
```

```text
{
  "time": "2024-01-15T10:35:00.000000Z",
  "user": "system:serviceaccount:default:default",
  "verb": "list",
  "namespace": "kube-system"
}
```

default ServiceAccount가 kube-system의 Secret을 list하려고 시도한 것은 의심스러운 행위이다.

**트러블슈팅:**
- Audit 로그 파일이 크면 `jq` 파싱이 느리다. `grep "secrets"` 전처리로 필터링하면 속도가 빨라진다.
- 시간 기반 필터링: `jq 'select(.requestReceivedTimestamp > "2024-01-15T09:00:00")'`로 특정 시간대만 분석한다.

</details>

---

### 문제 28. RuntimeClass kata-containers

kata-containers RuntimeClass를 생성하고, 보안이 중요한 워크로드에 적용하라.

<details>
<summary>풀이 확인</summary>

#### 등장 배경과 기존 한계점

표준 컨테이너 런타임(runc)은 호스트 커널을 공유한다. 커널 취약점이 발견되면 컨테이너에서 호스트로 탈출할 수 있다. Kata Containers는 경량 VM(QEMU/Cloud Hypervisor) 내에서 컨테이너를 실행한다. 각 Pod가 별도의 커널을 가지므로 커널 취약점 기반 컨테이너 탈출이 불가능하다. gVisor(사용자 공간 커널)와 달리 Kata는 실제 하드웨어 가상화를 사용하므로 격리 수준이 더 높다.

```yaml
# 1. RuntimeClass 생성
apiVersion: node.k8s.io/v1
kind: RuntimeClass
metadata:
  name: kata-containers
handler: kata
scheduling:
  nodeSelector:
    runtime: kata
```

```bash
cat <<'EOF' | kubectl apply -f -
apiVersion: node.k8s.io/v1
kind: RuntimeClass
metadata:
  name: kata-containers
handler: kata
scheduling:
  nodeSelector:
    runtime: kata
EOF
```

```bash
# 검증 1: RuntimeClass 생성 확인
kubectl get runtimeclass kata-containers
```

```text
NAME               HANDLER   AGE
kata-containers    kata      10s
```

```yaml
# 2. kata-containers를 사용하는 Pod
apiVersion: v1
kind: Pod
metadata:
  name: secure-isolated-pod
spec:
  runtimeClassName: kata-containers
  containers:
  - name: app
    image: busybox:1.36
    command: ["sh", "-c", "sleep 3600"]
```

```bash
# 검증 2: Pod에 runtimeClassName 설정 확인
kubectl get pod secure-isolated-pod -o jsonpath='{.spec.runtimeClassName}'
```

```text
kata-containers
```

```bash
# 검증 3: 커널 버전 확인 (호스트와 다름)
kubectl exec secure-isolated-pod -- uname -r
```

```text
5.15.0
```

호스트 커널 버전과 다르면 Kata Containers VM 내에서 실행 중인 것이다.

```bash
# 검증 4: 호스트 커널 버전 비교
ssh admin@<node-ip> 'uname -r'
```

```text
6.5.0-ubuntu
```

호스트(6.5.0)와 Pod(5.15.0)의 커널 버전이 다르므로 하드웨어 가상화 격리가 동작하고 있다.

```bash
# 정리
kubectl delete pod secure-isolated-pod
kubectl delete runtimeclass kata-containers
```

**트러블슈팅:**
- Kata Containers가 노드에 설치되지 않으면 Pod가 Pending 상태에 머문다. `containerd`의 runtime handler 설정을 확인한다.
- Apple Silicon(ARM64)에서 Kata는 제한적으로 지원된다. gVisor(runsc)가 ARM64에서 더 안정적이다.

</details>

---

### 문제 29. Sysdig 포렌식 분석

컨테이너에서 의심스러운 활동이 감지되었다. sysdig를 사용하여 해당 컨테이너의 syscall을 캡처하고 분석하라.

<details>
<summary>풀이 확인</summary>

#### 등장 배경과 기존 한계점

런타임 보안 도구(Falco)가 경고를 발생시킨 후, 실제 무슨 일이 발생했는지 상세 분석이 필요하다. sysdig는 Linux 커널의 tracepoint를 통해 모든 syscall을 캡처하여 파일로 저장하고, 사후 분석(post-mortem analysis)을 가능하게 한다. 로그 기반 분석과 달리 커널 레벨의 모든 활동(파일 접근, 네트워크 연결, 프로세스 생성)이 기록된다.

```bash
# 1. 특정 컨테이너의 syscall 캡처 (10초간)
ssh admin@<node-ip> 'sudo sysdig -M 10 -w /tmp/capture.scap container.name=nginx'
```

```bash
# 2. 캡처 파일 분석: 파일 접근 이벤트
ssh admin@<node-ip> 'sudo sysdig -r /tmp/capture.scap evt.type=open'
```

```text
123456 10:30:00.000 0 nginx (12345) > open fd=-1(ENOENT) name=/etc/shadow
123457 10:30:01.000 0 nginx (12345) > open fd=3 name=/etc/nginx/nginx.conf
```

`/etc/shadow` 접근 시도가 포착되었다. 이는 의심스러운 활동이다.

```bash
# 3. 네트워크 연결 분석
ssh admin@<node-ip> 'sudo sysdig -r /tmp/capture.scap evt.type=connect'
```

```text
123458 10:30:02.000 0 sh (12346) > connect fd=3 addr=185.X.X.X:4444
```

외부 IP(185.X.X.X)의 4444 포트로 연결 시도가 있다. 이는 리버스 셸 연결 시도일 수 있다.

```bash
# 4. 프로세스 생성 분석
ssh admin@<node-ip> 'sudo sysdig -r /tmp/capture.scap evt.type=execve'
```

```text
123459 10:30:03.000 0 sh (12347) > execve filename=/usr/bin/curl
```

컨테이너 내에서 curl이 실행되었다. 악성 코드 다운로드 가능성이 있다.

```bash
# 5. chisel을 사용한 요약 분석
ssh admin@<node-ip> 'sudo sysdig -r /tmp/capture.scap -c topfiles_bytes container.name=nginx'
```

```text
Bytes     Filename
--------- ----------------
1024      /etc/shadow
4096      /etc/nginx/nginx.conf
2048      /tmp/suspicious.sh
```

```bash
# 정리
ssh admin@<node-ip> 'sudo rm -f /tmp/capture.scap'
```

**트러블슈팅:**
- sysdig가 설치되지 않은 경우: `curl -s https://s3.amazonaws.com/download.draios.com/stable/install-sysdig | sudo bash`로 설치한다.
- 캡처 파일이 빠르게 커질 수 있다. `-M` 옵션으로 캡처 시간을 제한하고, `-s` 옵션으로 각 이벤트의 데이터 크기를 제한한다.
- CKS 시험에서는 sysdig보다 Falco 로그 분석이 더 빈출이다. 그러나 포렌식 시나리오에서는 sysdig가 필수적이다.

</details>

---

### 문제 30. kubectl auth can-i RBAC 검증

클러스터의 모든 ServiceAccount에 대해 RBAC 권한을 감사하고, 과도한 권한(wildcard `*` 사용)을 가진 바인딩을 식별하라.

<details>
<summary>풀이 확인</summary>

#### 공격-방어 매핑

wildcard(`*`) verb나 resource를 사용하는 Role/ClusterRole은 현재 존재하지 않는 미래의 API 리소스에도 접근 권한을 부여한다. 새로운 CRD가 추가되면 자동으로 해당 CRD에 대한 권한이 부여되므로 의도치 않은 권한 확대가 발생한다. CKS에서는 최소 권한 원칙 위반을 식별하고 수정하는 능력이 요구된다.

```bash
# 1. wildcard verb를 사용하는 ClusterRole 검색
kubectl get clusterroles -o json | jq -r '
  .items[] |
  select(.rules[]?.verbs[]? == "*") |
  .metadata.name
' | sort -u
```

```text
admin
cluster-admin
edit
```

```bash
# 2. cluster-admin에 바인딩된 주체 확인
kubectl get clusterrolebindings -o json | jq -r '
  .items[] |
  select(.roleRef.name == "cluster-admin") |
  "\(.metadata.name): \([.subjects[]? | "\(.kind)/\(.name)(\(.namespace // "cluster-wide"))"]) "
'
```

```text
cluster-admin: ["User/kubernetes-admin(cluster-wide)"]
```

```bash
# 3. wildcard resource를 사용하는 Role 검색 (모든 네임스페이스)
kubectl get roles -A -o json | jq -r '
  .items[] |
  select(.rules[]?.resources[]? == "*") |
  "\(.metadata.namespace)/\(.metadata.name)"
'
```

```text
kube-system/system:controller:bootstrap-signer
```

```bash
# 4. 특정 SA의 전체 권한 나열
kubectl auth can-i --list \
  --as=system:serviceaccount:demo:default -n demo
```

```text
Resources                                       Non-Resource URLs   Resource Names   Verbs
selfsubjectaccessreviews.authorization.k8s.io   []                  []               [create]
selfsubjectrulesreviews.authorization.k8s.io    []                  []               [create]
                                                [/api/*]            []               [get]
                                                [/healthz]          []               [get]
```

```bash
# 5. 모든 네임스페이스의 SA에 대해 secret 접근 권한 일괄 검사
for ns in $(kubectl get ns -o jsonpath='{.items[*].metadata.name}'); do
  for sa in $(kubectl get sa -n $ns -o jsonpath='{.items[*].metadata.name}'); do
    result=$(kubectl auth can-i get secrets --as=system:serviceaccount:$ns:$sa -n $ns 2>/dev/null)
    if [ "$result" = "yes" ]; then
      echo "WARNING: $ns/$sa can get secrets in $ns"
    fi
  done
done
```

```text
WARNING: kube-system/replicaset-controller can get secrets in kube-system
```

시스템 컨트롤러 외에 사용자 워크로드 SA가 Secret 접근 권한을 가지고 있으면 보안 문제이다.

**트러블슈팅:**
- `auth can-i --list`는 해당 네임스페이스에서의 권한만 표시한다. 클러스터 전체 권한은 `-n ""`이나 `--all-namespaces`는 지원되지 않으므로, ClusterRoleBinding을 별도로 검사해야 한다.
- 대규모 클러스터에서 모든 SA를 순회하면 시간이 오래 걸린다. `kubectl get clusterrolebindings -o json | jq`로 바인딩을 직접 분석하는 것이 더 효율적이다.

</details>

---

# Part 4: 기출 유형 덤프 문제 (20문항)

---

## Q1. [Cluster Setup] 3-Tier 애플리케이션 NetworkPolicy

### 문제

`three-tier` 네임스페이스에 frontend, backend, database 3개의 티어로 구성된 애플리케이션이 있다. 각 티어의 Pod에는 `tier=frontend`, `tier=backend`, `tier=database` 라벨이 있다.

다음 조건을 만족하는 NetworkPolicy를 작성하라:
1. 모든 트래픽을 기본 차단한다
2. frontend는 외부(Ingress)에서 포트 80으로 접근 가능하다
3. backend는 frontend에서만 포트 8080으로 접근 가능하다
4. database는 backend에서만 포트 5432로 접근 가능하다
5. 모든 Pod는 DNS(포트 53) Egress가 허용된다

<details>
<summary>풀이 확인</summary>

```bash
kubectl config use-context cluster1
```

```yaml
# 1. Default Deny All
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
  namespace: three-tier
spec:
  podSelector: {}
  policyTypes:
  - Ingress
  - Egress
---
# 2. DNS Egress 허용 (전체)
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-dns
  namespace: three-tier
spec:
  podSelector: {}
  policyTypes:
  - Egress
  egress:
  - ports:
    - protocol: UDP
      port: 53
    - protocol: TCP
      port: 53
---
# 3. Frontend: 외부에서 포트 80 Ingress 허용 + Backend로 Egress 허용
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: frontend-policy
  namespace: three-tier
spec:
  podSelector:
    matchLabels:
      tier: frontend
  policyTypes:
  - Ingress
  - Egress
  ingress:
  - ports:
    - protocol: TCP
      port: 80
  egress:
  - to:
    - podSelector:
        matchLabels:
          tier: backend
    ports:
    - protocol: TCP
      port: 8080
---
# 4. Backend: Frontend에서만 포트 8080 Ingress + Database로 Egress 허용
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: backend-policy
  namespace: three-tier
spec:
  podSelector:
    matchLabels:
      tier: backend
  policyTypes:
  - Ingress
  - Egress
  ingress:
  - from:
    - podSelector:
        matchLabels:
          tier: frontend
    ports:
    - protocol: TCP
      port: 8080
  egress:
  - to:
    - podSelector:
        matchLabels:
          tier: database
    ports:
    - protocol: TCP
      port: 5432
---
# 5. Database: Backend에서만 포트 5432 Ingress 허용
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: database-policy
  namespace: three-tier
spec:
  podSelector:
    matchLabels:
      tier: database
  policyTypes:
  - Ingress
  ingress:
  - from:
    - podSelector:
        matchLabels:
          tier: backend
    ports:
    - protocol: TCP
      port: 5432
```

```bash
kubectl apply -f three-tier-netpol.yaml

# 검증 1: NetworkPolicy 목록 확인
kubectl get networkpolicy -n three-tier
```

```text
NAME                POD-SELECTOR     AGE
default-deny-all    <none>           30s
allow-dns           <none>           30s
frontend-policy     tier=frontend    30s
backend-policy      tier=backend     30s
database-policy     tier=database    30s
```

```bash
# 검증 2: frontend -> backend 통신 가능
kubectl -n three-tier exec frontend-pod -- wget -qO- --timeout=3 http://backend-svc:8080
```

```text
OK
```

```bash
# 검증 3: frontend -> database 통신 차단
kubectl -n three-tier exec frontend-pod -- wget -qO- --timeout=3 http://database-svc:5432 2>&1
```

```text
wget: download timed out
```

```bash
# 검증 4: DNS 정상 동작
kubectl -n three-tier exec backend-pod -- nslookup database-svc
```

```text
Name:      database-svc.three-tier.svc.cluster.local
Address:   10.96.X.X
```

</details>

---

## Q2. [Cluster Setup] kube-bench 실행 및 실패 항목 수정

### 문제

마스터 노드에서 kube-bench를 실행하여 API 서버 관련 CIS Benchmark를 점검하라. 다음 실패 항목을 수정하라:
1. CIS 1.2.6: `--kubelet-certificate-authority` 미설정
2. CIS 1.2.16: `PodSecurity` Admission Plugin 미활성화
3. CIS 1.2.18: `--audit-log-path` 미설정

<details>
<summary>풀이 확인</summary>

```yaml
spec:
  containers:
  - command:
    - kube-apiserver
    - --kubelet-certificate-authority=/etc/kubernetes/pki/ca.crt
    - --enable-admission-plugins=NodeRestriction,PodSecurity
    - --audit-log-path=/var/log/kubernetes/audit/kube-apiserver-audit.log
    - --audit-policy-file=/etc/kubernetes/audit/policy.yaml
```

```bash
# 검증: 재검증
kube-bench run --targets master --check 1.2.6,1.2.16,1.2.18
```

```text
[PASS] 1.2.6 Ensure that the --kubelet-certificate-authority argument is set
[PASS] 1.2.16 Ensure that the admission control plugin PodSecurity is set
[PASS] 1.2.18 Ensure that the --audit-log-path argument is set
```

</details>

---

## Q3. [Cluster Setup] kubelet 바이너리 해시 검증

### 문제

워커 노드 `node01`에서 kubelet 바이너리가 변조되지 않았는지 검증하라. 공식 릴리스의 SHA-512 해시와 비교하라.

<details>
<summary>풀이 확인</summary>

```bash
kubectl config use-context cluster1
```

#### 등장 배경

공급망 공격에서 공격자가 kubelet 바이너리를 백도어가 포함된 버전으로 교체하면, 해당 노드에서 실행되는 모든 컨테이너가 감시/조작될 수 있다. 바이너리 무결성 검증은 이 공격을 탐지하는 첫 번째 방어선이다.

```bash
# 1. kubelet 버전 확인
ssh node01 'kubelet --version'
```

```text
Kubernetes v1.29.2
```

```bash
# 2. 공식 체크섬 다운로드
curl -sL https://dl.k8s.io/v1.29.2/bin/linux/amd64/kubelet.sha512
```

```text
abc123def456...  kubelet
```

```bash
# 3. 노드의 kubelet 해시 계산
ssh node01 'sha512sum $(which kubelet)'
```

```text
abc123def456...  /usr/bin/kubelet
```

```bash
# 4. 자동 비교
OFFICIAL=$(curl -sL https://dl.k8s.io/v1.29.2/bin/linux/amd64/kubelet.sha512 | awk '{print $1}')
ACTUAL=$(ssh node01 'sha512sum $(which kubelet)' | awk '{print $1}')

if [ "$OFFICIAL" = "$ACTUAL" ]; then
  echo "PASS: 바이너리 무결성 검증 성공"
else
  echo "FAIL: 바이너리가 변조되었을 가능성이 있다"
fi
```

```text
PASS: 바이너리 무결성 검증 성공
```

```bash
# 검증: kubectl, kubeadm도 동일하게 검증
for bin in kubectl kubeadm; do
  OFFICIAL=$(curl -sL "https://dl.k8s.io/v1.29.2/bin/linux/amd64/${bin}.sha512" | awk '{print $1}')
  ACTUAL=$(ssh node01 "sha512sum \$(which $bin)" | awk '{print $1}')
  if [ "$OFFICIAL" = "$ACTUAL" ]; then
    echo "PASS: $bin 무결성 검증 성공"
  else
    echo "FAIL: $bin 변조 가능성"
  fi
done
```

```text
PASS: kubectl 무결성 검증 성공
PASS: kubeadm 무결성 검증 성공
```

**트러블슈팅:**
- 아키텍처(amd64/arm64)가 일치해야 한다. `uname -m`으로 노드의 아키텍처를 확인한다.
- 해시 불일치 시 즉시 해당 노드를 `kubectl cordon node01 && kubectl drain node01`으로 격리한다.

</details>

---

## Q4. [Cluster Setup] TLS Ingress 생성

### 문제

`webapp` 네임스페이스에 TLS가 적용된 Ingress를 생성하라. 인증서는 `openssl`로 생성하고, Secret으로 저장하라. 도메인은 `secure.example.com`이다.

<details>
<summary>풀이 확인</summary>

```bash
kubectl config use-context cluster1
```

```bash
# 1. 자체 서명 인증서 생성
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout /tmp/tls.key -out /tmp/tls.crt \
  -subj "/CN=secure.example.com/O=webapp"

# 2. TLS Secret 생성
kubectl create namespace webapp 2>/dev/null
kubectl create secret tls webapp-tls \
  --cert=/tmp/tls.crt --key=/tmp/tls.key -n webapp

# 3. Ingress 생성
cat <<'EOF' | kubectl apply -f -
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: webapp-ingress
  namespace: webapp
  annotations:
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
spec:
  ingressClassName: nginx
  tls:
  - hosts:
    - secure.example.com
    secretName: webapp-tls
  rules:
  - host: secure.example.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: webapp-svc
            port:
              number: 80
EOF
```

```bash
# 검증 1: Secret 타입 확인
kubectl get secret webapp-tls -n webapp -o jsonpath='{.type}'
```

```text
kubernetes.io/tls
```

```bash
# 검증 2: Ingress TLS 설정 확인
kubectl get ingress webapp-ingress -n webapp -o jsonpath='{.spec.tls[0]}'
```

```text
{"hosts":["secure.example.com"],"secretName":"webapp-tls"}
```

```bash
# 검증 3: HTTPS 접근 테스트
INGRESS_IP=$(kubectl get ingress webapp-ingress -n webapp -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
curl -sk --resolve secure.example.com:443:$INGRESS_IP https://secure.example.com/ | head -5
```

```text
<!DOCTYPE html>
...
```

```bash
# 검증 4: 인증서 정보 확인
curl -sk --resolve secure.example.com:443:$INGRESS_IP https://secure.example.com/ -v 2>&1 | grep "subject:"
```

```text
* subject: CN=secure.example.com; O=webapp
```

```bash
# 정리
rm -f /tmp/tls.key /tmp/tls.crt
```

**트러블슈팅:**
- Secret의 `tls.crt`와 `tls.key` 키 이름이 정확해야 한다. `kubectl create secret tls`가 자동으로 올바른 키 이름을 설정한다.
- Ingress Controller가 설치되지 않으면 ADDRESS가 할당되지 않는다. `kubectl get pods -n ingress-nginx`로 컨트롤러 상태를 확인한다.

</details>

---

## Q5. [Cluster Hardening] CI/CD ServiceAccount RBAC

### 문제

`ci-cd` 네임스페이스에 `pipeline-sa` ServiceAccount를 생성하라. 이 SA는 `production` 네임스페이스에서 Deployment의 create/update/get/list만 가능하고, Secret과 ConfigMap에는 접근할 수 없어야 한다.

<details>
<summary>풀이 확인</summary>

```bash
kubectl config use-context cluster1
```

```bash
# 1. ServiceAccount 생성
kubectl create namespace ci-cd 2>/dev/null
kubectl create namespace production 2>/dev/null
kubectl create serviceaccount pipeline-sa -n ci-cd

# 2. Role 생성 (production 네임스페이스)
cat <<'EOF' | kubectl apply -f -
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: pipeline-deployer
  namespace: production
rules:
- apiGroups: ["apps"]
  resources: ["deployments"]
  verbs: ["create", "update", "get", "list"]
EOF

# 3. RoleBinding 생성
cat <<'EOF' | kubectl apply -f -
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: pipeline-deployer-binding
  namespace: production
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: pipeline-deployer
subjects:
- kind: ServiceAccount
  name: pipeline-sa
  namespace: ci-cd
EOF
```

```bash
# 검증 1: Deployment 생성 권한 (허용)
kubectl auth can-i create deployments.apps \
  --as=system:serviceaccount:ci-cd:pipeline-sa -n production
```

```text
yes
```

```bash
# 검증 2: Deployment list 권한 (허용)
kubectl auth can-i list deployments.apps \
  --as=system:serviceaccount:ci-cd:pipeline-sa -n production
```

```text
yes
```

```bash
# 검증 3: Secret 접근 (차단)
kubectl auth can-i get secrets \
  --as=system:serviceaccount:ci-cd:pipeline-sa -n production
```

```text
no
```

```bash
# 검증 4: ConfigMap 접근 (차단)
kubectl auth can-i list configmaps \
  --as=system:serviceaccount:ci-cd:pipeline-sa -n production
```

```text
no
```

```bash
# 검증 5: 다른 네임스페이스 접근 (차단)
kubectl auth can-i get deployments.apps \
  --as=system:serviceaccount:ci-cd:pipeline-sa -n default
```

```text
no
```

</details>

---

## Q6. [Cluster Hardening] ServiceAccount 토큰 비활성화

### 문제

`backend` 네임스페이스의 default ServiceAccount에 토큰 자동 마운트를 비활성화하라. 이미 실행 중인 Pod에서 토큰이 마운트되지 않도록 재배포하라.

<details>
<summary>풀이 확인</summary>

```bash
kubectl config use-context cluster1
```

```bash
# 1. default SA 패치
kubectl patch serviceaccount default -n backend \
  -p '{"automountServiceAccountToken": false}'
```

```text
serviceaccount/default patched
```

```bash
# 2. 기존 Pod 재시작 (Deployment인 경우)
kubectl rollout restart deployment -n backend
```

```bash
# 검증 1: SA 설정 확인
kubectl get sa default -n backend -o jsonpath='{.automountServiceAccountToken}'
```

```text
false
```

```bash
# 검증 2: 새 Pod에서 토큰 부재 확인
kubectl run token-check --image=busybox:1.36 -n backend \
  --command -- sleep 3600
kubectl exec token-check -n backend -- \
  ls /var/run/secrets/kubernetes.io/serviceaccount/ 2>&1
```

```text
ls: /var/run/secrets/kubernetes.io/serviceaccount/: No such file or directory
```

```bash
# 검증 3: K8s API 접근 불가 확인
kubectl exec token-check -n backend -- \
  wget -qO- --timeout=3 https://kubernetes.default.svc:443/api 2>&1
```

```text
wget: error getting response: Connection refused
```

```bash
# 정리
kubectl delete pod token-check -n backend
```

</details>

---

## Q7. [Cluster Hardening] API 서버 접근 제한

### 문제

kube-apiserver의 다음 보안 설정을 적용하라:
1. `--anonymous-auth=false`
2. `--insecure-port=0` (이미 deprecated이지만 확인)
3. `--profiling=false`

<details>
<summary>풀이 확인</summary>

```bash
# 1. 현재 설정 확인
ssh master01 'sudo cat /etc/kubernetes/manifests/kube-apiserver.yaml | grep -E "anonymous-auth|insecure-port|profiling"'
```

```bash
# 2. 수정
ssh master01 'sudo vi /etc/kubernetes/manifests/kube-apiserver.yaml'
# 다음 플래그 추가/수정:
# - --anonymous-auth=false
# - --profiling=false
```

```bash
# 검증 1: API 서버 재시작 대기
ssh master01 'sudo crictl ps | grep kube-apiserver'
```

```text
CONTAINER    IMAGE    CREATED          STATE    NAME              ...
abc123...    ...      15 seconds ago   Running  kube-apiserver    ...
```

```bash
# 검증 2: 익명 접근 차단
curl -sk https://<master-ip>:6443/api 2>&1 | jq .code
```

```text
401
```

```bash
# 검증 3: profiling 비활성화
curl -sk https://<master-ip>:6443/debug/pprof/ \
  --header "Authorization: Bearer $(kubectl config view --raw -o jsonpath='{.users[0].user.token}')" 2>&1
```

```text
404 page not found
```

profiling이 비활성화되면 /debug/pprof/ 엔드포인트가 404를 반환한다.

</details>

---

## Q8. [Cluster Hardening] kubeadm 보안 업그레이드

### 문제

클러스터를 v1.29.X에서 v1.29.Y로 패치 업그레이드하라. 업그레이드 전후로 보안 설정(Audit, EncryptionConfig)이 유지되는지 확인하라.

<details>
<summary>풀이 확인</summary>

```bash
# 1. 사전 백업
ssh master01 'sudo cp /etc/kubernetes/manifests/kube-apiserver.yaml /tmp/kube-apiserver.yaml.pre-upgrade'
ssh master01 'sudo cp /etc/kubernetes/audit/policy.yaml /tmp/audit-policy.pre-upgrade 2>/dev/null'

# 2. kubeadm 업그레이드
ssh master01 'sudo apt-get update && sudo apt-get install -y kubeadm=1.29.Y-*'
ssh master01 'sudo kubeadm upgrade plan'
ssh master01 'sudo kubeadm upgrade apply v1.29.Y'

# 3. kubelet 업그레이드
ssh master01 'sudo apt-get install -y kubelet=1.29.Y-* kubectl=1.29.Y-*'
ssh master01 'sudo systemctl daemon-reload && sudo systemctl restart kubelet'
```

```bash
# 검증 1: 버전 확인
kubectl version --short
```

```text
Server Version: v1.29.Y
```

```bash
# 검증 2: 보안 설정 유지 확인
ssh master01 'sudo grep -E "audit-log-path|encryption-provider|anonymous-auth|profiling" /etc/kubernetes/manifests/kube-apiserver.yaml'
```

```text
    - --audit-log-path=/var/log/kubernetes/audit/audit.log
    - --encryption-provider-config=/etc/kubernetes/enc/enc.yaml
    - --anonymous-auth=false
    - --profiling=false
```

```bash
# 검증 3: 노드 상태
kubectl get nodes
```

```text
NAME       STATUS   ROLES           AGE   VERSION
master01   Ready    control-plane   Xd    v1.29.Y
```

설정이 유지되었으면 업그레이드 성공이다. 유지되지 않았으면 백업에서 복원한다.

</details>

---

## Q9. [System Hardening] AppArmor 프로파일 적용

### 문제

노드 `worker01`에 `/etc/apparmor.d/k8s-restrict-write`라는 AppArmor 프로파일이 존재한다. 이 프로파일을 `restricted-pod` Pod의 컨테이너에 적용하라.

<details>
<summary>풀이 확인</summary>

```bash
kubectl config use-context cluster1
```

```bash
# 1. 프로파일 존재 및 로드 상태 확인
ssh worker01 'sudo aa-status | grep k8s-restrict-write'
```

```text
   k8s-restrict-write
```

프로파일이 로드되지 않은 경우:
```bash
ssh worker01 'sudo apparmor_parser -r /etc/apparmor.d/k8s-restrict-write'
```

```yaml
# 2. Pod에 AppArmor 적용
apiVersion: v1
kind: Pod
metadata:
  name: restricted-pod
  annotations:
    container.apparmor.security.beta.kubernetes.io/app: localhost/k8s-restrict-write
spec:
  nodeName: worker01
  containers:
  - name: app
    image: busybox:1.36
    command: ["sh", "-c", "sleep 3600"]
```

```bash
cat <<'EOF' | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: restricted-pod
  annotations:
    container.apparmor.security.beta.kubernetes.io/app: localhost/k8s-restrict-write
spec:
  nodeName: worker01
  containers:
  - name: app
    image: busybox:1.36
    command: ["sh", "-c", "sleep 3600"]
EOF
```

```bash
# 검증 1: Pod 상태 확인
kubectl get pod restricted-pod
```

```text
NAME              READY   STATUS    RESTARTS   AGE
restricted-pod    1/1     Running   0          10s
```

```bash
# 검증 2: AppArmor 프로파일 적용 확인
kubectl get pod restricted-pod -o jsonpath='{.metadata.annotations}'
```

```text
{"container.apparmor.security.beta.kubernetes.io/app":"localhost/k8s-restrict-write"}
```

```bash
# 검증 3: 쓰기 차단 테스트 (프로파일에 따라 다름)
kubectl exec restricted-pod -- touch /etc/test 2>&1
```

```text
touch: /etc/test: Permission denied
```

```bash
# 정리
kubectl delete pod restricted-pod
```

</details>

---

## Q10. [System Hardening] Seccomp 커스텀 프로파일

### 문제

커스텀 Seccomp 프로파일을 작성하여 `mkdir` syscall을 차단하라. 이 프로파일을 Pod에 적용하고, 디렉토리 생성이 차단되는지 확인하라.

<details>
<summary>풀이 확인</summary>

#### 커널 레벨 동작 원리

Seccomp BPF 필터는 커널 공간에서 syscall 번호를 검사한다. SECCOMP_RET_ERRNO 액션이 설정된 syscall을 호출하면 커널이 해당 syscall을 실행하지 않고 즉시 에러 코드를 반환한다. 커스텀 프로파일에서 `mkdir`(syscall 번호 83, arm64에서는 다름)에 SCMP_ACT_ERRNO를 설정하면 디렉토리 생성이 차단된다.

```bash
# 1. 커스텀 Seccomp 프로파일 작성 (노드의 kubelet seccomp 디렉토리)
ssh worker01 'sudo mkdir -p /var/lib/kubelet/seccomp/profiles'
ssh worker01 'sudo tee /var/lib/kubelet/seccomp/profiles/deny-mkdir.json' <<'EOF'
{
  "defaultAction": "SCMP_ACT_ALLOW",
  "architectures": ["SCMP_ARCH_X86_64", "SCMP_ARCH_AARCH64"],
  "syscalls": [
    {
      "names": ["mkdir", "mkdirat"],
      "action": "SCMP_ACT_ERRNO",
      "errnoRet": 1
    }
  ]
}
EOF
```

```yaml
# 2. Pod에 Localhost Seccomp 프로파일 적용
apiVersion: v1
kind: Pod
metadata:
  name: seccomp-custom-test
spec:
  nodeName: worker01
  securityContext:
    seccompProfile:
      type: Localhost
      localhostProfile: profiles/deny-mkdir.json
  containers:
  - name: app
    image: busybox:1.36
    command: ["sh", "-c", "sleep 3600"]
```

```bash
cat <<'EOF' | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: seccomp-custom-test
spec:
  nodeName: worker01
  securityContext:
    seccompProfile:
      type: Localhost
      localhostProfile: profiles/deny-mkdir.json
  containers:
  - name: app
    image: busybox:1.36
    command: ["sh", "-c", "sleep 3600"]
EOF
```

```bash
# 검증 1: mkdir 차단 확인
kubectl exec seccomp-custom-test -- mkdir /tmp/testdir 2>&1
```

```text
mkdir: can't create directory '/tmp/testdir': Operation not permitted
```

```bash
# 검증 2: 일반 명령어는 정상 동작
kubectl exec seccomp-custom-test -- ls /
```

```text
bin   dev   etc   home  lib   proc  root  sys   tmp   usr   var
```

```bash
# 검증 3: 파일 생성은 허용 (mkdir만 차단)
kubectl exec seccomp-custom-test -- touch /tmp/testfile
kubectl exec seccomp-custom-test -- ls /tmp/testfile
```

```text
/tmp/testfile
```

```bash
# 정리
kubectl delete pod seccomp-custom-test
```

**트러블슈팅:**
- Seccomp 프로파일 파일은 kubelet의 seccomp 디렉토리(`/var/lib/kubelet/seccomp/`)에 위치해야 한다. `localhostProfile`은 이 디렉토리에 대한 상대 경로이다.
- arm64와 amd64에서 syscall 번호가 다르다. `architectures` 필드에 두 아키텍처를 모두 포함하는 것이 안전하다.

</details>

---

## Q11. [System Hardening] Linux Capabilities 최소화

### 문제

`web-app` Pod에서 모든 capabilities를 제거(drop ALL)하고, `NET_BIND_SERVICE`만 추가하라. capabilities 변경이 올바르게 적용되었는지 `/proc`를 통해 검증하라.

<details>
<summary>풀이 확인</summary>

```bash
cat <<'EOF' | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: web-app
spec:
  containers:
  - name: nginx
    image: nginx:1.25-alpine
    ports:
    - containerPort: 80
    securityContext:
      capabilities:
        drop: ["ALL"]
        add: ["NET_BIND_SERVICE"]
EOF
```

```bash
# 검증 1: Pod 정상 실행 (80번 포트 바인딩 성공)
kubectl get pod web-app
```

```text
NAME      READY   STATUS    RESTARTS   AGE
web-app   1/1     Running   0          10s
```

```bash
# 검증 2: /proc에서 capability 비트 확인
kubectl exec web-app -- cat /proc/1/status | grep -i cap
```

```text
CapInh:	0000000000000400
CapPrm:	0000000000000400
CapEff:	0000000000000400
CapBnd:	0000000000000400
CapAmb:	0000000000000000
```

0x400 = 비트 10 = `NET_BIND_SERVICE`만 설정된 상태이다.

```bash
# 검증 3: 네트워크 설정 변경 시도 (NET_ADMIN 없음 → 차단)
kubectl exec web-app -- ip link set lo down 2>&1
```

```text
RTNETLINK answers: Operation not permitted
```

```bash
# 정리
kubectl delete pod web-app
```

</details>

---

## Q12. [System Hardening] OS 패키지 감사

### 문제

워커 노드에서 보안 위험이 있는 패키지를 식별하라. `telnet`, `netcat`, `nmap`, `tcpdump`, `ftp` 중 설치된 것을 제거하라.

<details>
<summary>풀이 확인</summary>

```bash
# 1. 위험 패키지 검색
ssh worker01 'dpkg -l 2>/dev/null | grep -E "telnet|netcat|nmap|tcpdump|ftp " || rpm -qa 2>/dev/null | grep -E "telnet|netcat|nmap|tcpdump|ftp"'
```

```text
ii  netcat-openbsd  1.218-4ubuntu1  arm64  TCP/IP swiss army knife
ii  tcpdump         4.99.3-1build1  arm64  command-line network traffic analyzer
```

```bash
# 2. 패키지 제거
ssh worker01 'sudo apt-get remove --purge -y netcat-openbsd tcpdump 2>/dev/null || sudo yum remove -y nmap-ncat tcpdump 2>/dev/null'
```

```text
Removing netcat-openbsd ...
Removing tcpdump ...
```

```bash
# 검증 1: 패키지 제거 확인
ssh worker01 'which nc tcpdump nmap telnet ftp 2>&1'
```

```text
nc not found
tcpdump not found
nmap not found
telnet not found
ftp not found
```

```bash
# 검증 2: 위험 서비스 확인
ssh worker01 'sudo systemctl list-units --type=service --state=running' | grep -E "ftp|telnet|rsh"
```

출력이 없으면 위험한 네트워크 서비스가 실행되지 않는 것이다.

</details>

---

## Q13. [Minimize Microservice Vulnerabilities] PodSecurity Admission

### 문제

`secure-ns` 네임스페이스에 PodSecurity `restricted` 레벨을 enforce 모드로 적용하라. `baseline` 위반 Pod와 `restricted` 준수 Pod를 각각 생성하여 동작을 확인하라.

<details>
<summary>풀이 확인</summary>

```bash
kubectl config use-context cluster1
```

```bash
# 1. 네임스페이스 생성 및 라벨 적용
kubectl create namespace secure-ns
kubectl label namespace secure-ns \
  pod-security.kubernetes.io/enforce=restricted \
  pod-security.kubernetes.io/enforce-version=latest \
  pod-security.kubernetes.io/warn=restricted \
  pod-security.kubernetes.io/audit=restricted
```

```bash
# 검증 1: 라벨 확인
kubectl get ns secure-ns --show-labels | grep pod-security
```

```text
secure-ns   Active   10s   ...,pod-security.kubernetes.io/enforce=restricted,...
```

```bash
# 검증 2: 비준수 Pod (거부)
kubectl run bad-pod --image=nginx -n secure-ns 2>&1
```

```text
Error from server (Forbidden): pods "bad-pod" is forbidden: violates PodSecurity "restricted:latest": allowPrivilegeEscalation != false ..., unrestricted capabilities ..., runAsNonRoot != true ..., seccompProfile ...
```

```bash
# 검증 3: 준수 Pod (허용)
cat <<'EOF' | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: good-pod
  namespace: secure-ns
spec:
  securityContext:
    runAsNonRoot: true
    runAsUser: 1000
    seccompProfile:
      type: RuntimeDefault
  containers:
  - name: app
    image: busybox:1.36
    command: ["sh", "-c", "sleep 3600"]
    securityContext:
      allowPrivilegeEscalation: false
      capabilities:
        drop: ["ALL"]
EOF
```

```text
pod/good-pod created
```

```bash
# 검증 4: Pod 실행 확인
kubectl get pod good-pod -n secure-ns
```

```text
NAME       READY   STATUS    RESTARTS   AGE
good-pod   1/1     Running   0          10s
```

```bash
# 정리
kubectl delete namespace secure-ns
```

</details>

---

## Q14. [Minimize Microservice Vulnerabilities] OPA Gatekeeper 레지스트리 제한

### 문제

OPA Gatekeeper를 사용하여 `prod` 네임스페이스에서 `harbor.internal.io/` 접두사를 가진 이미지만 허용하는 정책을 적용하라.

<details>
<summary>풀이 확인</summary>

```bash
# 1. ConstraintTemplate 생성
cat <<'EOF' | kubectl apply -f -
apiVersion: templates.gatekeeper.sh/v1
kind: ConstraintTemplate
metadata:
  name: k8sallowedrepos
spec:
  crd:
    spec:
      names:
        kind: K8sAllowedRepos
      validation:
        openAPIV3Schema:
          type: object
          properties:
            repos:
              type: array
              items:
                type: string
  targets:
  - target: admission.k8s.gatekeeper.sh
    rego: |
      package k8sallowedrepos
      violation[{"msg": msg}] {
        container := input.review.object.spec.containers[_]
        satisfied := [good | repo = input.parameters.repos[_]; good = startswith(container.image, repo)]
        not any(satisfied)
        msg := sprintf("container <%v> image <%v> is not from an allowed repo. Allowed: %v", [container.name, container.image, input.parameters.repos])
      }
EOF

# 2. Constraint 생성
cat <<'EOF' | kubectl apply -f -
apiVersion: constraints.gatekeeper.sh/v1beta1
kind: K8sAllowedRepos
metadata:
  name: prod-registry-restriction
spec:
  match:
    kinds:
    - apiGroups: [""]
      kinds: ["Pod"]
    namespaces: ["prod"]
  parameters:
    repos:
    - "harbor.internal.io/"
EOF
```

```bash
kubectl create namespace prod 2>/dev/null

# 검증 1: 비허용 이미지 (거부)
kubectl run bad --image=nginx:alpine -n prod 2>&1
```

```text
Error from server (Forbidden): admission webhook "validation.gatekeeper.sh" denied the request: [prod-registry-restriction] container <bad> image <nginx:alpine> is not from an allowed repo. Allowed: ["harbor.internal.io/"]
```

```bash
# 검증 2: 허용 이미지 (성공)
kubectl run good --image=harbor.internal.io/library/nginx:alpine -n prod 2>&1
```

```text
pod/good created
```

이미지가 실제로 존재하지 않아 Pod는 ImagePullBackOff가 되지만, Admission은 통과한다.

```bash
# 정리
kubectl delete namespace prod
kubectl delete k8sallowedrepos prod-registry-restriction
kubectl delete constrainttemplate k8sallowedrepos
```

</details>

---

## Q15. [Supply Chain Security] etcd Secret 암호화

### 문제

etcd에 저장되는 Secret을 aescbc로 암호화하라.

<details>
<summary>풀이 확인</summary>

Part 2 예제 9의 절차를 따른다.

```bash
# 검증: etcd에서 암호화 접두사 확인
ETCDCTL_API=3 etcdctl get /registry/secrets/default/encrypt-test \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key | hexdump -C | head -5
```

```text
00000000  ... 6b 38 73 3a 65 6e 63 3a 61 65 73 63 62 63 3a  |...k8s:enc:aescbc:|
00000010  76 31 3a 6b 65 79 31 3a ...                        |v1:key1:...|
```

</details>

---

## Q16. [Supply Chain] Trivy 스캔 및 Dockerfile 수정

### 문제

다음 Dockerfile에 보안 문제가 있다. Trivy로 빌드된 이미지를 스캔하고, CRITICAL 취약점이 0이 되도록 Dockerfile을 수정하라.

```dockerfile
FROM ubuntu:latest
RUN apt-get update && apt-get install -y python3 curl
COPY app.py /app/
USER root
CMD ["python3", "/app/app.py"]
```

<details>
<summary>풀이 확인</summary>

#### 공격-방어 매핑

| 문제 | 공격 시나리오 | 수정 |
|---|---|---|
| `ubuntu:latest` (버전 미고정) | 취약한 버전이 pull될 수 있다 | 특정 버전 태그 + 다이제스트 사용 |
| curl 설치 | 공격자가 악성 코드를 다운로드하는 도구가 된다 | multi-stage build로 런타임에서 제거 |
| `USER root` | 컨테이너 탈출, 커널 exploit 가능 | non-root 사용자로 실행 |
| 단일 스테이지 | 빌드 의존성이 런타임에 포함된다 | multi-stage build |

```dockerfile
# 수정된 Dockerfile
FROM python:3.11-slim-bookworm AS builder
COPY app.py /app/

FROM python:3.11-slim-bookworm
RUN groupadd -r appuser && useradd -r -g appuser -s /sbin/nologin appuser && \
    apt-get update && apt-get upgrade -y && \
    rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/ /app/
USER appuser
CMD ["python3", "/app/app.py"]
```

```bash
# 검증 1: 수정된 이미지 빌드 및 Trivy 스캔
docker build -t secure-app -f Dockerfile.secure .
trivy image --severity CRITICAL --ignore-unfixed secure-app
```

```text
Total: 0 (CRITICAL: 0)
```

```bash
# 검증 2: non-root 사용자 확인
docker run --rm secure-app id
```

```text
uid=999(appuser) gid=999(appuser) groups=999(appuser)
```

```bash
# 검증 3: curl 부재 확인
docker run --rm secure-app which curl 2>&1
```

```text
# 출력 없음 (curl이 설치되지 않음)
```

</details>

---

## Q17. [Monitoring] Falco 커스텀 규칙

### 문제

Falco 규칙을 작성하여 다음을 탐지하라:
1. 컨테이너 내에서 `curl` 또는 `wget`이 실행된 경우 (악성 코드 다운로드 시도)
2. 컨테이너 내에서 `/etc/shadow`가 읽힌 경우

<details>
<summary>풀이 확인</summary>

#### 커널 레벨 동작 원리

Falco는 eBPF tracepoint(또는 커널 모듈)를 통해 `execve`, `open`, `connect` 등의 syscall을 캡처한다. `spawned_process` 매크로는 `execve` syscall이 호출될 때 트리거된다. `open_read` 매크로는 `open`/`openat` syscall에서 `O_RDONLY` 플래그가 설정될 때 트리거된다.

```yaml
# /etc/falco/falco_rules.local.yaml
- rule: Suspicious Download Tool in Container
  desc: 컨테이너 내에서 curl 또는 wget이 실행되었다. 악성 코드 다운로드 시도일 수 있다.
  condition: >
    spawned_process and container and
    proc.name in (curl, wget)
  output: >
    Download tool executed in container
    (user=%user.name command=%proc.cmdline container=%container.name
    pod=%k8s.pod.name namespace=%k8s.ns.name image=%container.image.repository)
  priority: WARNING
  tags: [network, mitre_command_and_control]

- rule: Read Shadow File in Container
  desc: 컨테이너 내에서 /etc/shadow 파일이 읽혔다. 자격 증명 수집 시도이다.
  condition: >
    open_read and container and
    fd.name = /etc/shadow
  output: >
    Shadow file read in container
    (user=%user.name command=%proc.cmdline file=%fd.name
    container=%container.name pod=%k8s.pod.name namespace=%k8s.ns.name)
  priority: ERROR
  tags: [filesystem, mitre_credential_access]
```

```bash
# 검증 1: 규칙 문법 검증
falco --validate /etc/falco/falco_rules.local.yaml
```

```text
/etc/falco/falco_rules.local.yaml: Ok
```

```bash
# 검증 2: curl 실행 시뮬레이션
kubectl exec test-pod -- curl http://example.com 2>/dev/null

# Falco 로그 확인
kubectl logs -l app.kubernetes.io/name=falco -n falco --tail=10 | grep "Download tool"
```

```text
{"output":"Warning Download tool executed in container (user=root command=curl http://example.com container=test-pod ...)","priority":"Warning","rule":"Suspicious Download Tool in Container",...}
```

```bash
# 검증 3: /etc/shadow 읽기 시뮬레이션
kubectl exec test-pod -- cat /etc/shadow 2>/dev/null

kubectl logs -l app.kubernetes.io/name=falco -n falco --tail=10 | grep "Shadow file"
```

```text
{"output":"Error Shadow file read in container (user=root command=cat /etc/shadow file=/etc/shadow container=test-pod ...)","priority":"Error","rule":"Read Shadow File in Container",...}
```

**트러블슈팅:**
- Falco 규칙 문법 오류가 있으면 Falco Pod가 CrashLoopBackOff에 빠진다. `--validate` 플래그로 먼저 검증한다.
- 규칙 변경 후 Falco를 재시작해야 적용된다: `kubectl rollout restart daemonset falco -n falco`

</details>

---

## Q18. [Monitoring] Audit 로그 분석

### 문제

Audit 로그에서 다음을 식별하라:
1. 최근 `delete` 동작으로 삭제된 리소스
2. 403(Forbidden) 응답을 받은 요청의 사용자와 리소스

<details>
<summary>풀이 확인</summary>

```bash
# 1. delete 동작 추출
ssh master01 'sudo cat /var/log/kubernetes/audit/audit.log' | \
  jq 'select(.verb == "delete") | {
    time: .requestReceivedTimestamp,
    user: .user.username,
    resource: "\(.objectRef.resource)/\(.objectRef.name)",
    namespace: .objectRef.namespace,
    code: .responseStatus.code
  }' 2>/dev/null | head -30
```

```text
{
  "time": "2024-01-15T14:30:00.000000Z",
  "user": "kubernetes-admin",
  "resource": "pods/test-pod",
  "namespace": "default",
  "code": 200
}
```

```bash
# 2. 403 응답 추출
ssh master01 'sudo cat /var/log/kubernetes/audit/audit.log' | \
  jq 'select(.responseStatus.code == 403) | {
    time: .requestReceivedTimestamp,
    user: .user.username,
    verb: .verb,
    resource: .objectRef.resource,
    namespace: .objectRef.namespace
  }' 2>/dev/null | head -30
```

```text
{
  "time": "2024-01-15T14:35:00.000000Z",
  "user": "system:serviceaccount:default:default",
  "verb": "list",
  "resource": "secrets",
  "namespace": "kube-system"
}
```

default ServiceAccount가 kube-system의 Secret을 조회하려 한 것은 의심스러운 활동이다.

```bash
# 3. 사용자별 403 횟수 집계
ssh master01 'sudo cat /var/log/kubernetes/audit/audit.log' | \
  jq -r 'select(.responseStatus.code == 403) | .user.username' 2>/dev/null | \
  sort | uniq -c | sort -rn | head -10
```

```text
     15 system:serviceaccount:default:default
      3 system:anonymous
      1 developer-user
```

anonymous 사용자의 접근 시도가 있다면 `--anonymous-auth=false` 설정을 확인해야 한다.

</details>

---

## Q19. [Monitoring] 컨테이너 불변성 강제

### 문제

`app-ns` 네임스페이스의 모든 Deployment에서 `readOnlyRootFilesystem: true`가 설정되지 않은 컨테이너를 찾고, Deployment를 수정하여 불변성을 적용하라.

<details>
<summary>풀이 확인</summary>

```bash
# 1. 불변성 미적용 컨테이너 식별
kubectl get deployments -n app-ns -o json | jq -r '
  .items[] |
  . as $dep |
  .spec.template.spec.containers[] |
  select(.securityContext.readOnlyRootFilesystem != true) |
  "\($dep.metadata.name) container=\(.name)"
'
```

```text
web-frontend container=nginx
api-backend container=api
```

```bash
# 2. Deployment 수정 (web-frontend 예시)
kubectl patch deployment web-frontend -n app-ns --type=json -p='[
  {"op": "add", "path": "/spec/template/spec/containers/0/securityContext/readOnlyRootFilesystem", "value": true},
  {"op": "add", "path": "/spec/template/spec/volumes/-", "value": {"name": "tmp", "emptyDir": {}}},
  {"op": "add", "path": "/spec/template/spec/containers/0/volumeMounts/-", "value": {"name": "tmp", "mountPath": "/tmp"}},
  {"op": "add", "path": "/spec/template/spec/volumes/-", "value": {"name": "cache", "emptyDir": {}}},
  {"op": "add", "path": "/spec/template/spec/containers/0/volumeMounts/-", "value": {"name": "cache", "mountPath": "/var/cache/nginx"}}
]'
```

```bash
# 검증 1: rollout 완료 대기
kubectl rollout status deployment web-frontend -n app-ns
```

```text
deployment "web-frontend" successfully rolled out
```

```bash
# 검증 2: readOnlyRootFilesystem 확인
kubectl get deployment web-frontend -n app-ns -o jsonpath='{.spec.template.spec.containers[0].securityContext.readOnlyRootFilesystem}'
```

```text
true
```

```bash
# 검증 3: 파일시스템 쓰기 차단 확인
WEB_POD=$(kubectl get pods -n app-ns -l app=web-frontend -o jsonpath='{.items[0].metadata.name}')
kubectl exec $WEB_POD -n app-ns -- touch /etc/test 2>&1
```

```text
touch: /etc/test: Read-only file system
```

**트러블슈팅:**
- readOnlyRootFilesystem 적용 후 Pod가 CrashLoopBackOff에 빠지면, 애플리케이션이 쓰기하는 경로를 식별하여 emptyDir을 마운트해야 한다.
- `kubectl logs`로 에러 메시지에서 "Read-only file system"을 검색하면 쓰기가 필요한 경로를 파악할 수 있다.

</details>

---

## Q20. [Monitoring] RuntimeClass gVisor 적용

### 문제

gVisor(runsc) RuntimeClass를 생성하고, 보안이 중요한 `sandbox-pod`에 적용하라. gVisor 격리가 동작하는지 커널 버전으로 확인하라.

<details>
<summary>풀이 확인</summary>

#### 등장 배경과 기존 한계점

표준 런타임(runc)은 호스트 커널을 직접 사용한다. 커널 취약점(예: Dirty Pipe CVE-2022-0847)이 발견되면 컨테이너에서 호스트로 탈출할 수 있다. gVisor는 사용자 공간에서 Linux 커널 API를 재구현한 것으로, 컨테이너의 syscall이 호스트 커널에 직접 전달되지 않고 gVisor의 Sentry 프로세스에서 처리된다.

```yaml
# 1. RuntimeClass
apiVersion: node.k8s.io/v1
kind: RuntimeClass
metadata:
  name: gvisor
handler: runsc
```

```bash
kubectl apply -f - <<'EOF'
apiVersion: node.k8s.io/v1
kind: RuntimeClass
metadata:
  name: gvisor
handler: runsc
EOF
```

```yaml
# 2. gVisor를 사용하는 Pod
apiVersion: v1
kind: Pod
metadata:
  name: sandbox-pod
spec:
  runtimeClassName: gvisor
  containers:
  - name: app
    image: busybox:1.36
    command: ["sh", "-c", "sleep 3600"]
```

```bash
cat <<'EOF' | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: sandbox-pod
spec:
  runtimeClassName: gvisor
  containers:
  - name: app
    image: busybox:1.36
    command: ["sh", "-c", "sleep 3600"]
EOF
```

```bash
# 검증 1: RuntimeClass 확인
kubectl get runtimeclass gvisor
```

```text
NAME     HANDLER   AGE
gvisor   runsc     10s
```

```bash
# 검증 2: Pod의 runtimeClassName 확인
kubectl get pod sandbox-pod -o jsonpath='{.spec.runtimeClassName}'
```

```text
gvisor
```

```bash
# 검증 3: gVisor 커널 버전 확인
kubectl exec sandbox-pod -- uname -r
```

```text
4.4.0
```

```bash
# 검증 4: 호스트 커널 버전과 비교
ssh worker01 'uname -r'
```

```text
6.5.0-ubuntu
```

Pod의 커널(4.4.0)과 호스트(6.5.0)가 다르면 gVisor 격리가 동작하고 있다.

```bash
# 검증 5: dmesg 접근 차단 (gVisor가 차단)
kubectl exec sandbox-pod -- dmesg 2>&1
```

```text
dmesg: klogctl: Operation not permitted
```

```bash
# 정리
kubectl delete pod sandbox-pod
kubectl delete runtimeclass gvisor
```

**트러블슈팅:**
- gVisor(runsc)가 노드에 설치되지 않으면 Pod가 ContainerCreating 상태에서 멈춘다. containerd 설정에 runsc runtime handler가 등록되어야 한다.
- gVisor는 모든 syscall을 지원하지 않는다. 일부 애플리케이션(예: Docker-in-Docker, 일부 JVM)은 호환성 문제가 발생할 수 있다.

</details>

---

> **학습 팁:** 이 문서의 모든 예제를 실제 클러스터에서 직접 실습하는 것을 권장한다. CKS는 실기 시험이므로 YAML을 외우는 것보다 빠르게 작성하고 디버깅하는 능력이 중요하다. `kubectl explain`, `kubectl --dry-run=client -o yaml`, 공식 문서 검색을 숙달하라. 모든 보안 통제는 반드시 검증 명령어로 정상 동작을 확인해야 한다. 검증 없는 보안 설정은 무의미하다. 각 보안 메커니즘의 등장 배경과 커널 레벨 동작 원리를 이해하면 시험에서 초면 문제를 만나도 원리에 기반하여 해결할 수 있다.
