# CKS 실전 예제 및 핸즈온 실습

CKS는 쿠버네티스 자격증 중 가장 높은 난이도의 실기 시험이다. 이 문서에서는 시험에서 자주 출제되는 실전 예제를 도메인별로 정리한다. 모든 예제는 실제 클러스터에서 직접 실습할 수 있도록 작성되었다.

---

## 1. NetworkPolicy 고급 예제

### 1.1 기본 거부 정책 (Default Deny All)

모든 Ingress와 Egress 트래픽을 기본적으로 차단하는 정책이다. 이 정책을 먼저 적용한 후, 필요한 트래픽만 허용하는 추가 정책을 생성하는 것이 보안 모범 사례이다.

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
  namespace: production
spec:
  podSelector: {}          # 네임스페이스 내 모든 Pod에 적용
  policyTypes:
  - Ingress
  - Egress
```

### 1.2 DNS 허용과 함께 Egress 제어

기본 거부 정책 적용 후, DNS 조회(kube-dns)와 특정 서비스로의 트래픽만 허용하는 정책이다.

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-dns-and-api
  namespace: production
spec:
  podSelector:
    matchLabels:
      app: frontend
  policyTypes:
  - Egress
  egress:
  # DNS 허용 (kube-dns)
  - to:
    - namespaceSelector: {}
      podSelector:
        matchLabels:
          k8s-app: kube-dns
    ports:
    - protocol: UDP
      port: 53
    - protocol: TCP
      port: 53
  # backend 서비스로의 통신 허용
  - to:
    - podSelector:
        matchLabels:
          app: backend
    ports:
    - protocol: TCP
      port: 8080
```

### 1.3 CIDR 기반 Egress 제어

외부 API 서버로의 통신은 허용하되, 클라우드 메타데이터 서비스(169.254.169.254)로의 접근은 차단하는 정책이다.

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: restrict-egress-cidr
  namespace: production
spec:
  podSelector:
    matchLabels:
      app: webapp
  policyTypes:
  - Egress
  egress:
  # DNS 허용
  - to:
    - namespaceSelector: {}
      podSelector:
        matchLabels:
          k8s-app: kube-dns
    ports:
    - protocol: UDP
      port: 53
  # 외부 통신 허용 (메타데이터 서비스 제외)
  - to:
    - ipBlock:
        cidr: 0.0.0.0/0
        except:
        - 169.254.169.254/32    # 클라우드 메타데이터 차단
        - 10.0.0.0/8            # 내부 네트워크 차단 (필요시)
    ports:
    - protocol: TCP
      port: 443
```

### 1.4 다중 규칙 (여러 소스에서 Ingress 허용)

여러 네임스페이스와 외부 IP에서의 Ingress 트래픽을 허용하는 복합 정책이다.

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-multi-source-ingress
  namespace: production
spec:
  podSelector:
    matchLabels:
      app: api-server
  policyTypes:
  - Ingress
  ingress:
  # 같은 네임스페이스의 frontend Pod에서 8080 포트 허용
  - from:
    - podSelector:
        matchLabels:
          app: frontend
    ports:
    - protocol: TCP
      port: 8080
  # monitoring 네임스페이스에서 메트릭 포트 허용
  - from:
    - namespaceSelector:
        matchLabels:
          purpose: monitoring
    ports:
    - protocol: TCP
      port: 9090
  # 외부 로드밸런서 IP 범위에서 HTTPS 허용
  - from:
    - ipBlock:
        cidr: 203.0.113.0/24
    ports:
    - protocol: TCP
      port: 443
```

### 1.5 namespaceSelector와 podSelector 조합

`namespaceSelector`와 `podSelector`를 함께 사용할 때 AND와 OR의 차이를 이해하는 것이 중요하다.

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: and-vs-or-example
  namespace: production
spec:
  podSelector:
    matchLabels:
      app: database
  policyTypes:
  - Ingress
  ingress:
  # AND 조건: backend 네임스페이스의 api Pod만 허용
  # (하나의 from 항목에 namespaceSelector와 podSelector를 함께 지정)
  - from:
    - namespaceSelector:
        matchLabels:
          name: backend
      podSelector:
        matchLabels:
          role: api
    ports:
    - protocol: TCP
      port: 5432
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: or-example
  namespace: production
spec:
  podSelector:
    matchLabels:
      app: database
  policyTypes:
  - Ingress
  ingress:
  # OR 조건: backend 네임스페이스의 모든 Pod 또는 모든 네임스페이스의 api Pod 허용
  # (별도의 from 항목으로 분리)
  - from:
    - namespaceSelector:
        matchLabels:
          name: backend
    - podSelector:
        matchLabels:
          role: api
    ports:
    - protocol: TCP
      port: 5432
```

> 중요: `-` (하이픈)의 위치에 따라 AND와 OR 조건이 결정된다. 같은 `-` 아래에 있으면 AND, 별도의 `-`이면 OR이다.

---

## 2. RBAC 최소 권한 설정 예제

### 2.1 네임스페이스 한정 읽기 전용 Role

특정 네임스페이스에서 Pod와 Service만 조회할 수 있는 Role이다.

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  namespace: production
  name: pod-reader
rules:
- apiGroups: [""]
  resources: ["pods", "pods/log"]
  verbs: ["get", "list", "watch"]
- apiGroups: [""]
  resources: ["services"]
  verbs: ["get", "list"]
```

### 2.2 Deployment 관리자 Role

Deployment의 생성, 수정, 삭제를 허용하되, 다른 리소스에는 접근할 수 없는 Role이다.

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  namespace: development
  name: deployment-manager
rules:
- apiGroups: ["apps"]
  resources: ["deployments"]
  verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
- apiGroups: ["apps"]
  resources: ["replicasets"]
  verbs: ["get", "list", "watch"]
- apiGroups: [""]
  resources: ["pods"]
  verbs: ["get", "list", "watch"]
```

### 2.3 RoleBinding으로 ServiceAccount에 Role 바인딩

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: deployment-manager-binding
  namespace: development
subjects:
- kind: ServiceAccount
  name: deploy-sa
  namespace: development
roleRef:
  kind: Role
  name: deployment-manager
  apiGroup: rbac.authorization.k8s.io
```

### 2.4 특정 리소스 이름으로 접근 제한

특정 이름의 ConfigMap만 접근할 수 있도록 제한하는 Role이다.

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  namespace: production
  name: specific-configmap-reader
rules:
- apiGroups: [""]
  resources: ["configmaps"]
  resourceNames: ["app-config", "feature-flags"]
  verbs: ["get"]
```

### 2.5 위험한 RBAC 설정 식별 및 수정

다음은 보안 취약점이 있는 ClusterRole의 예시이다.

```yaml
# 위험: 과도한 권한
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: overly-permissive
rules:
- apiGroups: ["*"]         # 모든 API 그룹
  resources: ["*"]         # 모든 리소스
  verbs: ["*"]             # 모든 동작
```

위 설정을 최소 권한으로 수정한 예시이다.

```yaml
# 수정: 필요한 권한만 부여
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: minimal-monitoring
rules:
- apiGroups: [""]
  resources: ["pods", "nodes"]
  verbs: ["get", "list", "watch"]
- apiGroups: ["metrics.k8s.io"]
  resources: ["pods", "nodes"]
  verbs: ["get", "list"]
```

### 2.6 RBAC 권한 확인 명령어 모음

```bash
# 현재 사용자의 권한 확인
kubectl auth can-i --list

# 특정 사용자로 권한 확인
kubectl auth can-i create pods --as=system:serviceaccount:dev:deploy-sa

# 특정 사용자의 전체 권한 목록
kubectl auth can-i --list --as=system:serviceaccount:dev:deploy-sa -n dev

# 특정 사용자가 Secret을 읽을 수 있는지 확인
kubectl auth can-i get secrets --as=user1 -n production

# ClusterRole의 상세 내용 확인
kubectl describe clusterrole admin

# 특정 ServiceAccount에 바인딩된 Role 확인
kubectl get rolebindings -n dev -o wide | grep deploy-sa
kubectl get clusterrolebindings -o wide | grep deploy-sa
```

---

## 3. AppArmor 프로파일 작성 및 Pod 적용

### 3.1 커스텀 AppArmor 프로파일 작성

파일 쓰기와 네트워크 접근을 제한하는 AppArmor 프로파일이다.

```
# /etc/apparmor.d/k8s-deny-write
#include <tunables/global>

profile k8s-deny-write flags=(attach_disconnected,mediate_deleted) {
  #include <abstractions/base>

  # 파일 읽기 허용
  file,

  # /proc, /sys 읽기 허용
  /proc/** r,
  /sys/** r,

  # 특정 디렉토리 쓰기 금지
  deny /etc/** w,
  deny /usr/** w,
  deny /bin/** w,
  deny /sbin/** w,

  # /tmp 쓰기는 허용
  /tmp/** rw,

  # 네트워크 접근 제한 (TCP만 허용)
  network tcp,
  deny network udp,
  deny network raw,
}
```

### 3.2 AppArmor 프로파일 노드에 로드

```bash
# 프로파일 로드 (enforce 모드)
sudo apparmor_parser -r /etc/apparmor.d/k8s-deny-write

# 프로파일 상태 확인
sudo aa-status | grep k8s-deny-write

# 프로파일 complain 모드로 변경 (테스트용)
sudo aa-complain /etc/apparmor.d/k8s-deny-write

# 프로파일 enforce 모드로 변경
sudo aa-enforce /etc/apparmor.d/k8s-deny-write
```

### 3.3 Pod에 AppArmor 프로파일 적용 (쿠버네티스 1.30+)

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: apparmor-pod
spec:
  containers:
  - name: app
    image: nginx:1.25
    securityContext:
      appArmorProfile:
        type: Localhost
        localhostProfile: k8s-deny-write
```

### 3.4 Pod에 AppArmor 프로파일 적용 (이전 버전, 어노테이션 방식)

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
```

### 3.5 AppArmor 동작 확인

```bash
# Pod 생성
kubectl apply -f apparmor-pod.yaml

# Pod 상태 확인 (AppArmor 프로파일이 노드에 없으면 Pod가 시작되지 않음)
kubectl get pod apparmor-pod

# Pod 내부에서 쓰기 시도 (차단되는지 확인)
kubectl exec apparmor-pod -- sh -c "echo test > /etc/test.txt"
# Expected: Permission denied

# Pod 내부에서 /tmp 쓰기 시도 (허용되는지 확인)
kubectl exec apparmor-pod -- sh -c "echo test > /tmp/test.txt"
# Expected: Success
```

---

## 4. seccomp 프로파일 설정 및 Pod 적용

### 4.1 커스텀 seccomp 프로파일 작성

허용할 시스템 콜만 명시적으로 지정하는 화이트리스트 방식의 seccomp 프로파일이다.

```json
{
  "defaultAction": "SCMP_ACT_ERRNO",
  "architectures": [
    "SCMP_ARCH_X86_64",
    "SCMP_ARCH_X86",
    "SCMP_ARCH_X32"
  ],
  "syscalls": [
    {
      "names": [
        "accept4", "access", "arch_prctl", "bind", "brk",
        "capget", "capset", "chdir", "clone", "close",
        "connect", "dup", "dup2", "epoll_create1", "epoll_ctl",
        "epoll_wait", "execve", "exit", "exit_group", "fchown",
        "fcntl", "fstat", "fstatfs", "futex", "getcwd",
        "getdents64", "getegid", "geteuid", "getgid", "getpgrp",
        "getpid", "getppid", "getrlimit", "getuid", "ioctl",
        "listen", "lseek", "madvise", "mmap", "mprotect",
        "munmap", "nanosleep", "newfstatat", "open", "openat",
        "pipe", "prctl", "pread64", "pwrite64", "read",
        "recvfrom", "recvmsg", "rt_sigaction", "rt_sigprocmask",
        "rt_sigreturn", "sched_getaffinity", "sched_yield",
        "sendfile", "sendmsg", "sendto", "set_robust_list",
        "set_tid_address", "setgid", "setgroups", "setuid",
        "sigaltstack", "socket", "stat", "statfs", "sysinfo",
        "umask", "uname", "unlink", "wait4", "write",
        "writev"
      ],
      "action": "SCMP_ACT_ALLOW"
    }
  ]
}
```

### 4.2 seccomp 프로파일 노드에 배치

```bash
# seccomp 프로파일 디렉토리 생성 (kubelet 기본 경로)
sudo mkdir -p /var/lib/kubelet/seccomp/profiles

# 프로파일 복사
sudo cp custom-seccomp.json /var/lib/kubelet/seccomp/profiles/custom-seccomp.json

# 권한 설정
sudo chmod 644 /var/lib/kubelet/seccomp/profiles/custom-seccomp.json
```

### 4.3 RuntimeDefault seccomp 프로파일 적용

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: seccomp-default-pod
spec:
  securityContext:
    seccompProfile:
      type: RuntimeDefault
  containers:
  - name: app
    image: nginx:1.25
    securityContext:
      allowPrivilegeEscalation: false
```

### 4.4 커스텀 seccomp 프로파일 적용

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: seccomp-custom-pod
spec:
  securityContext:
    seccompProfile:
      type: Localhost
      localhostProfile: profiles/custom-seccomp.json
  containers:
  - name: app
    image: nginx:1.25
    securityContext:
      allowPrivilegeEscalation: false
```

### 4.5 seccomp 로깅 프로파일 (디버깅용)

차단하지 않고 로그만 기록하는 프로파일이다. 어떤 시스템 콜이 필요한지 파악할 때 사용한다.

```json
{
  "defaultAction": "SCMP_ACT_LOG",
  "architectures": [
    "SCMP_ARCH_X86_64"
  ],
  "syscalls": [
    {
      "names": [
        "accept4", "access", "arch_prctl", "bind", "brk",
        "clone", "close", "connect", "epoll_ctl", "execve",
        "exit", "exit_group", "fcntl", "fstat", "futex",
        "getdents64", "getpid", "getuid", "ioctl", "listen",
        "mmap", "mprotect", "munmap", "nanosleep", "open",
        "openat", "read", "recvfrom", "rt_sigaction",
        "rt_sigprocmask", "sendto", "set_tid_address",
        "socket", "stat", "write"
      ],
      "action": "SCMP_ACT_ALLOW"
    }
  ]
}
```

```bash
# 로그 확인 (시스템 콜 차단/로그 이벤트)
sudo journalctl -f | grep seccomp
# 또는
sudo dmesg | grep seccomp
```

---

## 5. Pod Security Admission 네임스페이스 설정

### 5.1 Restricted 정책 적용

```bash
# 네임스페이스 생성
kubectl create namespace secure-ns

# Restricted 정책 적용 (enforce + warn + audit)
kubectl label namespace secure-ns \
  pod-security.kubernetes.io/enforce=restricted \
  pod-security.kubernetes.io/enforce-version=latest \
  pod-security.kubernetes.io/warn=restricted \
  pod-security.kubernetes.io/warn-version=latest \
  pod-security.kubernetes.io/audit=restricted \
  pod-security.kubernetes.io/audit-version=latest
```

### 5.2 Restricted 정책을 준수하는 Pod

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: compliant-pod
  namespace: secure-ns
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
      readOnlyRootFilesystem: true
      runAsUser: 1000
      runAsGroup: 3000
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

### 5.3 정책 위반 Pod (거부되는 예시)

```yaml
# 이 Pod는 restricted 네임스페이스에서 거부된다
apiVersion: v1
kind: Pod
metadata:
  name: violation-pod
  namespace: secure-ns
spec:
  containers:
  - name: app
    image: nginx:1.25
    securityContext:
      privileged: true              # 위반: privileged
      runAsUser: 0                  # 위반: root 실행
      allowPrivilegeEscalation: true # 위반: 권한 상승 허용
```

```bash
# 적용 시도 시 에러 메시지 예시
# Error from server (Forbidden): error when creating "violation-pod.yaml":
# pods "violation-pod" is forbidden: violates PodSecurity "restricted:latest":
# privileged (container "app" must not set securityContext.privileged=true),
# allowPrivilegeEscalation != false (container "app" must set
# securityContext.allowPrivilegeEscalation=false),
# runAsNonRoot != true (pod or container "app" must set
# securityContext.runAsNonRoot=true)
```

### 5.4 Baseline 정책 적용 (단계적 마이그레이션)

```bash
# 기존 네임스페이스에 단계적으로 적용
# 1단계: warn만 적용하여 위반 사항 파악
kubectl label namespace my-ns \
  pod-security.kubernetes.io/warn=baseline \
  pod-security.kubernetes.io/warn-version=latest

# 2단계: audit 추가하여 감사 로그 기록
kubectl label namespace my-ns \
  pod-security.kubernetes.io/audit=baseline \
  pod-security.kubernetes.io/audit-version=latest

# 3단계: 모든 위반 Pod 수정 후 enforce 적용
kubectl label namespace my-ns \
  pod-security.kubernetes.io/enforce=baseline \
  pod-security.kubernetes.io/enforce-version=latest
```

---

## 6. OPA Gatekeeper ConstraintTemplate 예제

### 6.1 허용된 레지스트리만 사용 강제

#### ConstraintTemplate

```yaml
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
        not startswith(container.image, input.parameters.repos[_])
        msg := sprintf(
          "container <%v> has an invalid image repo <%v>, allowed repos are %v",
          [container.name, container.image, input.parameters.repos]
        )
      }

      violation[{"msg": msg}] {
        container := input.review.object.spec.initContainers[_]
        not startswith(container.image, input.parameters.repos[_])
        msg := sprintf(
          "initContainer <%v> has an invalid image repo <%v>, allowed repos are %v",
          [container.name, container.image, input.parameters.repos]
        )
      }
```

#### Constraint

```yaml
apiVersion: constraints.gatekeeper.sh/v1beta1
kind: K8sAllowedRepos
metadata:
  name: require-trusted-registry
spec:
  match:
    kinds:
    - apiGroups: [""]
      kinds: ["Pod"]
    namespaces:
    - production
    - staging
  parameters:
    repos:
    - "registry.internal.company.com/"
    - "gcr.io/my-project/"
```

### 6.2 필수 라벨 강제

#### ConstraintTemplate

```yaml
apiVersion: templates.gatekeeper.sh/v1
kind: ConstraintTemplate
metadata:
  name: k8srequiredlabels
spec:
  crd:
    spec:
      names:
        kind: K8sRequiredLabels
      validation:
        openAPIV3Schema:
          type: object
          properties:
            labels:
              type: array
              items:
                type: string
  targets:
  - target: admission.k8s.gatekeeper.sh
    rego: |
      package k8srequiredlabels

      violation[{"msg": msg}] {
        provided := {label | input.review.object.metadata.labels[label]}
        required := {label | label := input.parameters.labels[_]}
        missing := required - provided
        count(missing) > 0
        msg := sprintf(
          "you must provide labels: %v",
          [missing]
        )
      }
```

#### Constraint

```yaml
apiVersion: constraints.gatekeeper.sh/v1beta1
kind: K8sRequiredLabels
metadata:
  name: require-team-label
spec:
  match:
    kinds:
    - apiGroups: ["apps"]
      kinds: ["Deployment"]
  parameters:
    labels:
    - "team"
    - "env"
```

### 6.3 Privileged 컨테이너 금지

#### ConstraintTemplate

```yaml
apiVersion: templates.gatekeeper.sh/v1
kind: ConstraintTemplate
metadata:
  name: k8sdenyprivileged
spec:
  crd:
    spec:
      names:
        kind: K8sDenyPrivileged
  targets:
  - target: admission.k8s.gatekeeper.sh
    rego: |
      package k8sdenyprivileged

      violation[{"msg": msg}] {
        container := input.review.object.spec.containers[_]
        container.securityContext.privileged == true
        msg := sprintf(
          "Privileged container is not allowed: %v",
          [container.name]
        )
      }

      violation[{"msg": msg}] {
        container := input.review.object.spec.initContainers[_]
        container.securityContext.privileged == true
        msg := sprintf(
          "Privileged init container is not allowed: %v",
          [container.name]
        )
      }
```

#### Constraint

```yaml
apiVersion: constraints.gatekeeper.sh/v1beta1
kind: K8sDenyPrivileged
metadata:
  name: deny-privileged-containers
spec:
  match:
    kinds:
    - apiGroups: [""]
      kinds: ["Pod"]
    excludedNamespaces:
    - kube-system
```

### 6.4 Gatekeeper 동작 확인

```bash
# Gatekeeper 설치
kubectl apply -f https://raw.githubusercontent.com/open-policy-agent/gatekeeper/release-3.15/deploy/gatekeeper.yaml

# ConstraintTemplate 적용
kubectl apply -f constraint-template.yaml

# Constraint 적용
kubectl apply -f constraint.yaml

# 위반 Pod 생성 시도 (거부되어야 함)
kubectl run test --image=docker.io/nginx -n production
# Error: admission webhook "validation.gatekeeper.sh" denied the request

# 허용 Pod 생성 시도
kubectl run test --image=registry.internal.company.com/nginx -n production
# pod/test created

# Constraint 위반 현황 확인
kubectl get k8sallowedrepos require-trusted-registry -o yaml
```

---

## 7. Trivy 이미지 스캔 명령어

### 7.1 기본 이미지 스캔

```bash
# 이미지 취약점 스캔
trivy image nginx:1.25

# 출력 예시:
# nginx:1.25 (debian 12.4)
# =============================
# Total: 142 (UNKNOWN: 2, LOW: 80, MEDIUM: 42, HIGH: 15, CRITICAL: 3)
#
# ┌──────────────────┬────────────────┬──────────┬────────────────────────┐
# │     Library      │ Vulnerability  │ Severity │   Installed Version    │
# ├──────────────────┼────────────────┼──────────┼────────────────────────┤
# │ libssl3          │ CVE-2024-XXXX  │ CRITICAL │ 3.0.11-1~deb12u2       │
# │ curl             │ CVE-2024-XXXX  │ HIGH     │ 7.88.1-10+deb12u5      │
# └──────────────────┴────────────────┴──────────┴────────────────────────┘
```

### 7.2 심각도 필터링

```bash
# HIGH와 CRITICAL 취약점만 표시
trivy image --severity HIGH,CRITICAL nginx:1.25

# CRITICAL만 표시
trivy image --severity CRITICAL nginx:1.25
```

### 7.3 CI/CD 파이프라인에서 사용

```bash
# CRITICAL 취약점이 있으면 종료 코드 1 반환 (빌드 실패)
trivy image --exit-code 1 --severity CRITICAL nginx:1.25

# HIGH 이상 취약점이 있으면 종료 코드 1 반환
trivy image --exit-code 1 --severity HIGH,CRITICAL nginx:1.25
```

### 7.4 다양한 출력 형식

```bash
# JSON 형식으로 파일에 저장
trivy image --format json -o results.json nginx:1.25

# 테이블 형식 (기본)
trivy image --format table nginx:1.25

# SARIF 형식 (GitHub Security와 연동 가능)
trivy image --format sarif -o results.sarif nginx:1.25
```

### 7.5 파일 시스템 및 설정 스캔

```bash
# 파일 시스템 스캔 (프로젝트 디렉토리의 의존성 취약점)
trivy fs /path/to/project

# Kubernetes 매니페스트 설정 오류 스캔
trivy config /path/to/k8s-manifests/

# Dockerfile 스캔
trivy config Dockerfile

# 실행 중인 컨테이너의 루트 파일시스템 스캔
trivy rootfs /
```

### 7.6 취약점 무시 (알려진 취약점 예외 처리)

```bash
# .trivyignore 파일 생성
cat > .trivyignore << 'EOF'
# 수정 불가한 알려진 취약점
CVE-2024-12345
CVE-2024-67890
EOF

# .trivyignore를 사용한 스캔
trivy image --ignorefile .trivyignore nginx:1.25
```

---

## 8. Falco 룰 작성 예제

### 8.1 컨테이너 내 셸 실행 탐지

```yaml
- rule: Shell in Container
  desc: Detect a shell being spawned inside a container
  condition: >
    spawned_process and container and
    proc.name in (bash, sh, zsh, csh, ksh, dash) and
    not proc.pname in (healthcheck)
  output: >
    Shell spawned in container
    (user=%user.name user_loginuid=%user.loginuid
     container_id=%container.id container_name=%container.name
     shell=%proc.name parent=%proc.pname cmdline=%proc.cmdline
     terminal=%proc.tty container_image=%container.image.repository
     k8s_ns=%k8s.ns.name k8s_pod=%k8s.pod.name)
  priority: WARNING
  tags: [container, shell, mitre_execution]
```

### 8.2 민감한 파일 접근 탐지

```yaml
- list: sensitive_file_paths
  items:
  - /etc/shadow
  - /etc/passwd
  - /etc/kubernetes/pki
  - /var/run/secrets/kubernetes.io/serviceaccount

- macro: sensitive_files
  condition: fd.name startswith /etc/shadow or
             fd.name startswith /etc/kubernetes/pki or
             fd.name startswith /var/run/secrets/kubernetes.io/serviceaccount

- rule: Read Sensitive File in Container
  desc: Detect reading of sensitive files inside a container
  condition: >
    open_read and container and sensitive_files and
    not proc.name in (kubelet, kube-proxy)
  output: >
    Sensitive file opened for reading in container
    (user=%user.name file=%fd.name container=%container.name
     image=%container.image.repository command=%proc.cmdline
     k8s_ns=%k8s.ns.name k8s_pod=%k8s.pod.name)
  priority: WARNING
  tags: [filesystem, mitre_credential_access]
```

### 8.3 컨테이너 내 패키지 관리자 실행 탐지

```yaml
- list: package_mgmt_binaries
  items: [apt, apt-get, aptitude, dpkg, yum, rpm, dnf, apk, pip, pip3, npm, gem]

- macro: package_mgmt_procs
  condition: proc.name in (package_mgmt_binaries)

- rule: Package Manager in Container
  desc: Package manager process was launched inside a container
  condition: >
    spawned_process and container and package_mgmt_procs
  output: >
    Package management process launched in container
    (user=%user.name command=%proc.cmdline container=%container.name
     image=%container.image.repository
     k8s_ns=%k8s.ns.name k8s_pod=%k8s.pod.name)
  priority: ERROR
  tags: [process, software_mgmt, mitre_persistence]
```

### 8.4 컨테이너에서 외부 네트워크 연결 시도 탐지

```yaml
- rule: Unexpected Outbound Connection from Container
  desc: Detect unexpected outbound network connections from a container
  condition: >
    evt.type=connect and evt.dir=< and container and
    fd.typechar=4 and fd.ip != "0.0.0.0" and
    not fd.snet in (rfc_1918_addresses) and
    not k8s.ns.name in (kube-system, istio-system)
  output: >
    Unexpected outbound connection from container
    (command=%proc.cmdline connection=%fd.name
     container=%container.name image=%container.image.repository
     k8s_ns=%k8s.ns.name k8s_pod=%k8s.pod.name)
  priority: NOTICE
  tags: [network, mitre_command_and_control]
```

### 8.5 컨테이너 내 바이너리 다운로드 및 실행 탐지

```yaml
- rule: Container Drift - Binary Downloaded and Executed
  desc: Detect binary downloaded and then executed in a container
  condition: >
    spawned_process and container and
    proc.is_exe_upper_layer=true and
    not proc.pname in (docker-entrypoint, entrypoint.sh)
  output: >
    Binary not part of original image executed in container
    (user=%user.name command=%proc.cmdline
     container=%container.name image=%container.image.repository
     k8s_ns=%k8s.ns.name k8s_pod=%k8s.pod.name)
  priority: CRITICAL
  tags: [container, mitre_execution, mitre_persistence]
```

### 8.6 Falco 설치 및 설정 확인

```bash
# Falco 설치 (Helm)
helm repo add falcosecurity https://falcosecurity.github.io/charts
helm install falco falcosecurity/falco \
  --namespace falco --create-namespace \
  --set falcosidekick.enabled=true

# Falco 로그 확인
kubectl logs -n falco -l app.kubernetes.io/name=falco -f

# Falco 룰 파일 위치 (DaemonSet 내부)
# /etc/falco/falco_rules.yaml        # 기본 룰
# /etc/falco/falco_rules.local.yaml  # 커스텀 룰

# 커스텀 룰 적용 (ConfigMap으로 관리)
kubectl create configmap falco-custom-rules \
  --from-file=custom-rules.yaml \
  -n falco
```

---

## 9. Audit Policy YAML 예제

### 9.1 종합 Audit Policy

```yaml
apiVersion: audit.k8s.io/v1
kind: Policy
# RequestReceived 단계에서는 로그를 생성하지 않음
omitStages:
- "RequestReceived"

rules:
  # Secret에 대한 모든 변경은 RequestResponse 레벨로 기록
  - level: RequestResponse
    resources:
    - group: ""
      resources: ["secrets"]
    verbs: ["create", "update", "patch", "delete"]

  # Secret 읽기는 Metadata 레벨로 기록
  - level: Metadata
    resources:
    - group: ""
      resources: ["secrets"]
    verbs: ["get", "list", "watch"]

  # ConfigMap 변경은 Request 레벨로 기록
  - level: Request
    resources:
    - group: ""
      resources: ["configmaps"]
    verbs: ["create", "update", "patch", "delete"]

  # RBAC 리소스 변경은 RequestResponse 레벨로 기록
  - level: RequestResponse
    resources:
    - group: "rbac.authorization.k8s.io"
      resources: ["roles", "rolebindings", "clusterroles", "clusterrolebindings"]

  # 인증/인가 관련 이벤트
  - level: Metadata
    nonResourceURLs:
    - "/api*"
    - "/healthz*"

  # Pod 실행 (exec, attach, port-forward)
  - level: RequestResponse
    resources:
    - group: ""
      resources: ["pods/exec", "pods/attach", "pods/portforward"]

  # 서비스 계정 토큰 요청
  - level: Metadata
    resources:
    - group: ""
      resources: ["serviceaccounts/token"]

  # 노드, 네임스페이스 변경
  - level: RequestResponse
    resources:
    - group: ""
      resources: ["nodes", "namespaces"]
    verbs: ["create", "update", "patch", "delete"]

  # kube-system의 일상적인 요청은 None으로 (노이즈 제거)
  - level: None
    users:
    - "system:kube-scheduler"
    - "system:kube-proxy"
    resources:
    - group: ""
      resources: ["endpoints", "services", "services/status"]

  # 읽기 전용 요청은 Metadata로 기록
  - level: Metadata
    verbs: ["get", "list", "watch"]

  # 나머지는 Request 레벨로 기록
  - level: Request
```

### 9.2 API Server에 Audit Policy 적용

```bash
# 1. Audit Policy 파일 저장
sudo mkdir -p /etc/kubernetes/audit
sudo cp audit-policy.yaml /etc/kubernetes/audit/policy.yaml

# 2. Audit 로그 디렉토리 생성
sudo mkdir -p /var/log/kubernetes/audit

# 3. kube-apiserver 매니페스트 수정
sudo vi /etc/kubernetes/manifests/kube-apiserver.yaml
```

kube-apiserver.yaml에 추가할 내용이다.

```yaml
spec:
  containers:
  - command:
    - kube-apiserver
    # 기존 플래그들...
    - --audit-policy-file=/etc/kubernetes/audit/policy.yaml
    - --audit-log-path=/var/log/kubernetes/audit/audit.log
    - --audit-log-maxage=30
    - --audit-log-maxbackup=10
    - --audit-log-maxsize=100
    volumeMounts:
    # 기존 볼륨 마운트들...
    - mountPath: /etc/kubernetes/audit
      name: audit-policy
      readOnly: true
    - mountPath: /var/log/kubernetes/audit
      name: audit-log
  volumes:
  # 기존 볼륨들...
  - name: audit-policy
    hostPath:
      path: /etc/kubernetes/audit
      type: DirectoryOrCreate
  - name: audit-log
    hostPath:
      path: /var/log/kubernetes/audit
      type: DirectoryOrCreate
```

### 9.3 Audit 로그 조회

```bash
# 전체 로그 확인
cat /var/log/kubernetes/audit/audit.log | jq .

# Secret 관련 이벤트 필터링
cat /var/log/kubernetes/audit/audit.log | jq 'select(.objectRef.resource == "secrets")'

# 특정 사용자의 활동 필터링
cat /var/log/kubernetes/audit/audit.log | jq 'select(.user.username == "admin")'

# 특정 네임스페이스의 이벤트 필터링
cat /var/log/kubernetes/audit/audit.log | jq 'select(.objectRef.namespace == "production")'

# 실패한 요청 필터링
cat /var/log/kubernetes/audit/audit.log | jq 'select(.responseStatus.code >= 400)'

# Pod exec 이벤트 필터링
cat /var/log/kubernetes/audit/audit.log | jq 'select(.objectRef.subresource == "exec")'
```

---

## 10. Secret Encryption at Rest 설정

### 10.1 암호화 키 생성

```bash
# 32바이트 랜덤 키 생성 (base64 인코딩)
ENCRYPTION_KEY=$(head -c 32 /dev/urandom | base64)
echo $ENCRYPTION_KEY
```

### 10.2 EncryptionConfiguration 작성

```yaml
# /etc/kubernetes/encryption-config.yaml
apiVersion: apiserver.config.k8s.io/v1
kind: EncryptionConfiguration
resources:
  - resources:
    - secrets
    providers:
    # aescbc 암호화를 첫 번째 프로바이더로 설정 (새 Secret 암호화에 사용)
    - aescbc:
        keys:
        - name: key1
          secret: <위에서 생성한 ENCRYPTION_KEY>
    # identity는 기존 암호화되지 않은 Secret을 읽기 위해 필요
    - identity: {}
```

### 10.3 API Server에 적용

```bash
# kube-apiserver 매니페스트에 추가
sudo vi /etc/kubernetes/manifests/kube-apiserver.yaml
```

```yaml
spec:
  containers:
  - command:
    - kube-apiserver
    # 기존 플래그들...
    - --encryption-provider-config=/etc/kubernetes/encryption-config.yaml
    volumeMounts:
    # 기존 볼륨 마운트들...
    - mountPath: /etc/kubernetes/encryption-config.yaml
      name: encryption-config
      readOnly: true
  volumes:
  # 기존 볼륨들...
  - name: encryption-config
    hostPath:
      path: /etc/kubernetes/encryption-config.yaml
      type: File
```

### 10.4 기존 Secret 재암호화

```bash
# API Server 재시작 후, 기존 Secret을 모두 재생성하여 암호화 적용
kubectl get secrets -A -o json | kubectl replace -f -
```

### 10.5 암호화 확인

```bash
# etcd에서 Secret 직접 조회하여 암호화 확인
ETCDCTL_API=3 etcdctl \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key \
  get /registry/secrets/default/my-secret | hexdump -C

# 암호화되어 있으면 "k8s:enc:aescbc:v1:key1" 접두사가 보임
# 암호화되지 않았으면 Secret 내용이 평문으로 보임
```

---

## 11. RuntimeClass (gVisor) 설정 예제

### 11.1 containerd에 gVisor 런타임 설정

```bash
# gVisor(runsc) 설치
wget https://storage.googleapis.com/gvisor/releases/release/latest/x86_64/runsc
chmod +x runsc
sudo mv runsc /usr/local/bin/

# containerd 설정에 runsc 런타임 추가
sudo vi /etc/containerd/config.toml
```

containerd 설정에 추가할 내용이다.

```toml
[plugins."io.containerd.grpc.v1.cri".containerd.runtimes.runsc]
  runtime_type = "io.containerd.runsc.v1"
```

```bash
# containerd 재시작
sudo systemctl restart containerd
```

### 11.2 RuntimeClass 생성

```yaml
apiVersion: node.k8s.io/v1
kind: RuntimeClass
metadata:
  name: gvisor
handler: runsc
# 선택사항: 스케줄링 설정
scheduling:
  nodeSelector:
    runtime: gvisor
```

### 11.3 gVisor RuntimeClass를 사용하는 Pod

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: gvisor-sandbox-pod
spec:
  runtimeClassName: gvisor
  containers:
  - name: app
    image: nginx:1.25
    resources:
      limits:
        cpu: "500m"
        memory: "128Mi"
      requests:
        cpu: "250m"
        memory: "64Mi"
```

### 11.4 gVisor 동작 확인

```bash
# Pod 생성
kubectl apply -f gvisor-sandbox-pod.yaml

# Pod 상태 확인
kubectl get pod gvisor-sandbox-pod

# Pod 내부에서 커널 확인 (gVisor 커널이 보여야 함)
kubectl exec gvisor-sandbox-pod -- uname -r
# 출력 예: 4.4.0 (gVisor 커널)

# Pod 내부에서 dmesg 확인 (gVisor가 시스템 콜을 가로채는 것을 확인)
kubectl exec gvisor-sandbox-pod -- dmesg | head
# 출력 예: Starting gVisor...
```

---

## 12. kube-bench 실행 및 결과 해석

### 12.1 kube-bench 실행 방법

#### Job으로 실행

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: kube-bench
spec:
  template:
    spec:
      hostPID: true
      containers:
      - name: kube-bench
        image: aquasec/kube-bench:latest
        command: ["kube-bench", "run", "--targets", "master"]
        volumeMounts:
        - name: var-lib-etcd
          mountPath: /var/lib/etcd
          readOnly: true
        - name: var-lib-kubelet
          mountPath: /var/lib/kubelet
          readOnly: true
        - name: etc-systemd
          mountPath: /etc/systemd
          readOnly: true
        - name: lib-systemd
          mountPath: /lib/systemd/
          readOnly: true
        - name: etc-kubernetes
          mountPath: /etc/kubernetes
          readOnly: true
        - name: usr-bin
          mountPath: /usr/local/mount-from-host/bin
          readOnly: true
      restartPolicy: Never
      volumes:
      - name: var-lib-etcd
        hostPath:
          path: /var/lib/etcd
      - name: var-lib-kubelet
        hostPath:
          path: /var/lib/kubelet
      - name: etc-systemd
        hostPath:
          path: /etc/systemd
      - name: lib-systemd
        hostPath:
          path: /lib/systemd
      - name: etc-kubernetes
        hostPath:
          path: /etc/kubernetes
      - name: usr-bin
        hostPath:
          path: /usr/bin
```

#### 바이너리로 직접 실행

```bash
# kube-bench 설치
curl -L https://github.com/aquasecurity/kube-bench/releases/download/v0.7.3/kube-bench_0.7.3_linux_amd64.tar.gz -o kube-bench.tar.gz
tar xzf kube-bench.tar.gz

# 전체 검사
./kube-bench run

# 마스터 노드만 검사
./kube-bench run --targets=master

# 워커 노드만 검사
./kube-bench run --targets=node

# etcd만 검사
./kube-bench run --targets=etcd

# JSON 형식 출력
./kube-bench run --json

# 특정 검사 항목만 실행
./kube-bench run --targets=master --check=1.2.1,1.2.2,1.2.3
```

### 12.2 결과 해석 및 조치

```
[INFO] 1 Master Node Security Configuration
[INFO] 1.1 Master Node Configuration Files
[PASS] 1.1.1 Ensure that the API server pod specification file permissions are set to 644 or more restrictive
[PASS] 1.1.2 Ensure that the API server pod specification file ownership is set to root:root
[FAIL] 1.1.3 Ensure that the controller manager pod specification file permissions are set to 644 or more restrictive

== Remediations master ==
1.1.3 Run the below command (based on the file location on your system) on the master node.
chmod 644 /etc/kubernetes/manifests/kube-controller-manager.yaml
```

조치 방법이다.

```bash
# FAIL 항목 조치: 파일 권한 수정
chmod 644 /etc/kubernetes/manifests/kube-controller-manager.yaml

# 조치 후 재검사
./kube-bench run --targets=master --check=1.1.3

# API Server 보안 설정 관련 FAIL 항목 예시와 조치
# FAIL: 1.2.1 Ensure that the --anonymous-auth argument is set to false
# 조치: /etc/kubernetes/manifests/kube-apiserver.yaml에 --anonymous-auth=false 추가

# FAIL: 1.2.6 Ensure that the --profiling argument is set to false
# 조치: /etc/kubernetes/manifests/kube-apiserver.yaml에 --profiling=false 추가

# FAIL: 1.2.16 Ensure that the admission control plugin NodeRestriction is set
# 조치: --enable-admission-plugins에 NodeRestriction 추가
```

---

## 13. ImagePolicyWebhook 설정 예제

### 13.1 Admission Configuration 파일

```yaml
# /etc/kubernetes/admission/admission-config.yaml
apiVersion: apiserver.config.k8s.io/v1
kind: AdmissionConfiguration
plugins:
- name: ImagePolicyWebhook
  configuration:
    imagePolicy:
      kubeConfigFile: /etc/kubernetes/admission/webhook-kubeconfig.yaml
      allowTTL: 50
      denyTTL: 50
      retryBackoff: 500
      defaultAllow: false   # 웹훅 실패 시 기본 거부 (보안 강화)
```

### 13.2 Webhook kubeconfig 파일

```yaml
# /etc/kubernetes/admission/webhook-kubeconfig.yaml
apiVersion: v1
kind: Config
clusters:
- cluster:
    certificate-authority: /etc/kubernetes/admission/webhook-ca.crt
    server: https://image-policy-webhook.kube-system.svc:443/check
  name: image-policy-webhook
contexts:
- context:
    cluster: image-policy-webhook
    user: api-server
  name: default
current-context: default
users:
- name: api-server
  user:
    client-certificate: /etc/kubernetes/admission/apiserver-client.crt
    client-key: /etc/kubernetes/admission/apiserver-client.key
```

### 13.3 API Server 설정

```bash
sudo vi /etc/kubernetes/manifests/kube-apiserver.yaml
```

```yaml
spec:
  containers:
  - command:
    - kube-apiserver
    # 기존 플래그들...
    - --enable-admission-plugins=NodeRestriction,ImagePolicyWebhook
    - --admission-control-config-file=/etc/kubernetes/admission/admission-config.yaml
    volumeMounts:
    # 기존 볼륨 마운트들...
    - mountPath: /etc/kubernetes/admission
      name: admission-config
      readOnly: true
  volumes:
  # 기존 볼륨들...
  - name: admission-config
    hostPath:
      path: /etc/kubernetes/admission
      type: DirectoryOrCreate
```

### 13.4 동작 확인

```bash
# API Server 재시작 확인
kubectl get pods -n kube-system | grep apiserver

# 허용되지 않은 이미지로 Pod 생성 시도 (거부되어야 함)
kubectl run test --image=malicious-registry.io/evil:latest
# Error from server (Forbidden): pods "test" is forbidden:
# image policy webhook backend denied one or more images

# 허용된 이미지로 Pod 생성 시도
kubectl run test --image=registry.approved.com/nginx:1.25
# pod/test created
```

---

## 실습 환경 구축 팁

### kubeadm으로 CKS 실습 클러스터 구축

```bash
# 1. kubeadm 클러스터 초기화
sudo kubeadm init --pod-network-cidr=192.168.0.0/16

# 2. Calico CNI 설치 (NetworkPolicy 지원)
kubectl apply -f https://raw.githubusercontent.com/projectcalico/calico/v3.27.0/manifests/calico.yaml

# 3. 워커 노드 조인
kubeadm join <master-ip>:6443 --token <token> --discovery-token-ca-cert-hash sha256:<hash>
```

### 필수 도구 설치

```bash
# Trivy
sudo apt-get install wget apt-transport-https gnupg lsb-release
wget -qO - https://aquasecurity.github.io/trivy-repo/deb/public.key | sudo apt-key add -
echo "deb https://aquasecurity.github.io/trivy-repo/deb $(lsb_release -sc) main" | sudo tee /etc/apt/sources.list.d/trivy.list
sudo apt-get update && sudo apt-get install trivy

# kube-bench
curl -L https://github.com/aquasecurity/kube-bench/releases/download/v0.7.3/kube-bench_0.7.3_linux_amd64.tar.gz | tar xz

# kubesec (HTTP API 사용 가능)
wget https://github.com/controlplaneio/kubesec/releases/download/v2.14.0/kubesec_linux_amd64.tar.gz
tar xzf kubesec_linux_amd64.tar.gz

# Falco (Helm)
helm repo add falcosecurity https://falcosecurity.github.io/charts
helm install falco falcosecurity/falco -n falco --create-namespace

# OPA Gatekeeper
kubectl apply -f https://raw.githubusercontent.com/open-policy-agent/gatekeeper/release-3.15/deploy/gatekeeper.yaml
```
