# CKS 실전 보안 실습 예제 모음

CKS는 쿠버네티스 자격증 중 가장 어려운 실기 시험이다. 이 문서에서는 시험에서 자주 출제되는 실전 예제를 도메인별로 정리한다. 모든 예제는 실제 클러스터에서 직접 실습할 수 있도록 완전한 YAML과 명령어를 포함한다.

---

## 1. NetworkPolicy 고급 예제

### 1.1 Default Deny All (Ingress + Egress)

모든 트래픽을 기본적으로 차단하는 정책이다. 이것이 보안의 출발점이다.

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
  namespace: secure-ns
spec:
  podSelector: {}  # 네임스페이스의 모든 Pod에 적용
  policyTypes:
  - Ingress
  - Egress
```

```bash
# 네임스페이스 생성
kubectl create namespace secure-ns

# 정책 적용
kubectl apply -f default-deny-all.yaml

# 검증: Pod 간 통신이 차단되는지 확인
kubectl -n secure-ns run test --image=busybox --rm -it -- wget -qO- --timeout=2 http://nginx-svc 2>&1
# 결과: wget: download timed out
```

### 1.2 DNS 허용 + 특정 서비스만 Egress 허용

Default deny 후 DNS와 특정 서비스만 허용하는 패턴이다.

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-dns-and-api
  namespace: secure-ns
spec:
  podSelector:
    matchLabels:
      app: frontend
  policyTypes:
  - Egress
  egress:
  # DNS 허용 (TCP/UDP 53)
  - to: []
    ports:
    - protocol: UDP
      port: 53
    - protocol: TCP
      port: 53
  # backend 서비스만 허용
  - to:
    - podSelector:
        matchLabels:
          app: backend
    ports:
    - protocol: TCP
      port: 8080
```

### 1.3 Egress CIDR 기반 제한 (메타데이터 API 차단)

클라우드 인스턴스 메타데이터 API(169.254.169.254)로의 접근을 차단하는 정책이다.

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: deny-metadata-access
  namespace: secure-ns
spec:
  podSelector: {}
  policyTypes:
  - Egress
  egress:
  # 모든 트래픽 허용하되 메타데이터 IP만 차단
  - to:
    - ipBlock:
        cidr: 0.0.0.0/0
        except:
        - 169.254.169.254/32
```

### 1.4 Namespace 기반 Ingress 허용

특정 네임스페이스의 Pod에서만 인바운드 트래픽을 허용하는 정책이다.

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-from-monitoring
  namespace: production
spec:
  podSelector:
    matchLabels:
      app: api-server
  policyTypes:
  - Ingress
  ingress:
  - from:
    # monitoring 네임스페이스의 prometheus Pod만 허용
    - namespaceSelector:
        matchLabels:
          kubernetes.io/metadata.name: monitoring
      podSelector:
        matchLabels:
          app: prometheus
    ports:
    - protocol: TCP
      port: 9090
```

> **주의**: `namespaceSelector`와 `podSelector`가 같은 `- from` 항목에 있으면 AND 조건이다. 별도의 `- from` 항목으로 분리하면 OR 조건이 된다.

### 1.5 복합 NetworkPolicy: 다중 규칙 조합

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: api-server-policy
  namespace: production
spec:
  podSelector:
    matchLabels:
      app: api-server
  policyTypes:
  - Ingress
  - Egress
  ingress:
  # 프론트엔드에서 HTTP 트래픽 허용
  - from:
    - podSelector:
        matchLabels:
          app: frontend
    ports:
    - protocol: TCP
      port: 443
  # 모니터링 네임스페이스에서 메트릭 수집 허용
  - from:
    - namespaceSelector:
        matchLabels:
          purpose: monitoring
    ports:
    - protocol: TCP
      port: 9090
  egress:
  # DNS 허용
  - to: []
    ports:
    - protocol: UDP
      port: 53
    - protocol: TCP
      port: 53
  # 데이터베이스 Pod로만 egress 허용
  - to:
    - podSelector:
        matchLabels:
          app: database
    ports:
    - protocol: TCP
      port: 5432
  # 외부 API 서버 허용 (특정 CIDR)
  - to:
    - ipBlock:
        cidr: 10.100.0.0/16
    ports:
    - protocol: TCP
      port: 443
```

---

## 2. RBAC 최소 권한 설정

### 2.1 View-Only Role (읽기 전용)

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  namespace: production
  name: pod-viewer
rules:
- apiGroups: [""]
  resources: ["pods", "pods/log"]
  verbs: ["get", "list", "watch"]
- apiGroups: [""]
  resources: ["services", "endpoints"]
  verbs: ["get", "list"]
```

### 2.2 특정 Verb/Resource만 허용

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  namespace: production
  name: deployment-manager
rules:
- apiGroups: ["apps"]
  resources: ["deployments"]
  verbs: ["get", "list", "watch", "create", "update", "patch"]
  # delete는 허용하지 않음
- apiGroups: [""]
  resources: ["configmaps"]
  verbs: ["get", "list"]
  resourceNames: ["app-config", "db-config"]  # 특정 리소스만 허용
```

### 2.3 ServiceAccount에 Role 바인딩

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: app-sa
  namespace: production
automountServiceAccountToken: false  # 토큰 자동 마운트 비활성화
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: app-sa-binding
  namespace: production
subjects:
- kind: ServiceAccount
  name: app-sa
  namespace: production
roleRef:
  kind: Role
  name: pod-viewer
  apiGroup: rbac.authorization.k8s.io
```

### 2.4 ClusterRole을 네임스페이스 범위로 제한 (RoleBinding으로 바인딩)

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: secret-reader
rules:
- apiGroups: [""]
  resources: ["secrets"]
  verbs: ["get", "list"]
---
# ClusterRole을 RoleBinding으로 바인딩하면 특정 네임스페이스로 범위가 제한된다
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: read-secrets-in-production
  namespace: production
subjects:
- kind: User
  name: jane
  apiGroup: rbac.authorization.k8s.io
roleRef:
  kind: ClusterRole
  name: secret-reader
  apiGroup: rbac.authorization.k8s.io
```

```bash
# RBAC 관련 유용한 명령어

# 특정 사용자의 권한 확인
kubectl auth can-i get pods --as=jane -n production
# yes

kubectl auth can-i delete pods --as=jane -n production
# no

# ServiceAccount의 권한 확인
kubectl auth can-i get secrets --as=system:serviceaccount:production:app-sa -n production

# 모든 권한 나열
kubectl auth can-i --list --as=jane -n production

# Role/ClusterRole 생성 (dry-run)
kubectl create role pod-reader --verb=get,list,watch --resource=pods -n production --dry-run=client -o yaml

# RoleBinding 생성 (dry-run)
kubectl create rolebinding pod-reader-binding --role=pod-reader --serviceaccount=production:app-sa -n production --dry-run=client -o yaml

# 과도한 권한이 있는 ClusterRoleBinding 찾기
kubectl get clusterrolebindings -o json | \
  jq '.items[] | select(.roleRef.name == "cluster-admin") | .metadata.name'
```

---

## 3. AppArmor 프로파일 작성 + Pod 적용

### 3.1 AppArmor 프로파일 작성

파일: `/etc/apparmor.d/k8s-deny-write`
```
#include <tunables/global>

profile k8s-deny-write flags=(attach_disconnected,mediate_deleted) {
  #include <abstractions/base>

  # 기본적으로 파일 읽기 허용
  file,

  # 모든 경로에 대한 쓰기 거부
  deny /** w,

  # /tmp 디렉토리에는 쓰기 허용 (애플리케이션이 필요로 할 수 있음)
  /tmp/** rw,
  /var/tmp/** rw,

  # /proc, /sys 접근 제한
  deny /proc/** w,
  deny /sys/** w,
}
```

파일: `/etc/apparmor.d/k8s-restrict-network`
```
#include <tunables/global>

profile k8s-restrict-network flags=(attach_disconnected,mediate_deleted) {
  #include <abstractions/base>

  file,

  # 네트워크 접근 제한: TCP만 허용, raw 소켓 차단
  network tcp,
  network udp,
  deny network raw,
  deny network packet,
}
```

### 3.2 프로파일 로드 및 확인

```bash
# 프로파일을 enforce 모드로 로드
apparmor_parser -r /etc/apparmor.d/k8s-deny-write
apparmor_parser -r /etc/apparmor.d/k8s-restrict-network

# 로드된 프로파일 확인
aa-status | grep k8s

# 출력 예시:
#    k8s-deny-write (enforce)
#    k8s-restrict-network (enforce)

# complain 모드로 로드 (디버깅용)
apparmor_parser -C /etc/apparmor.d/k8s-deny-write
```

### 3.3 Pod에 AppArmor 적용 (annotation 방식, K8s 1.29 이하)

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: secure-app
  annotations:
    # 형식: container.apparmor.security.beta.kubernetes.io/<container-name>: localhost/<profile-name>
    container.apparmor.security.beta.kubernetes.io/app: localhost/k8s-deny-write
spec:
  containers:
  - name: app
    image: nginx:1.25
    volumeMounts:
    - name: tmp
      mountPath: /tmp
  volumes:
  - name: tmp
    emptyDir: {}
```

### 3.4 Pod에 AppArmor 적용 (securityContext 방식, K8s 1.30+)

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: secure-app
spec:
  containers:
  - name: app
    image: nginx:1.25
    securityContext:
      appArmorProfile:
        type: Localhost
        localhostProfile: k8s-deny-write
    volumeMounts:
    - name: tmp
      mountPath: /tmp
  volumes:
  - name: tmp
    emptyDir: {}
```

```bash
# 검증: 파일 쓰기가 차단되는지 확인
kubectl exec secure-app -- touch /root/test.txt
# touch: cannot touch '/root/test.txt': Permission denied

# /tmp에는 쓰기 가능
kubectl exec secure-app -- touch /tmp/test.txt
# (성공)
```

---

## 4. seccomp 프로파일 적용

### 4.1 커스텀 seccomp 프로파일 (JSON)

파일: `/var/lib/kubelet/seccomp/profiles/restricted.json`
```json
{
  "defaultAction": "SCMP_ACT_ERRNO",
  "architectures": [
    "SCMP_ARCH_X86_64",
    "SCMP_ARCH_X86",
    "SCMP_ARCH_AARCH64"
  ],
  "syscalls": [
    {
      "names": [
        "accept4",
        "access",
        "arch_prctl",
        "bind",
        "brk",
        "capget",
        "capset",
        "chdir",
        "clone",
        "close",
        "connect",
        "dup",
        "dup2",
        "dup3",
        "epoll_create",
        "epoll_create1",
        "epoll_ctl",
        "epoll_wait",
        "epoll_pwait",
        "execve",
        "exit",
        "exit_group",
        "faccessat",
        "faccessat2",
        "fchmod",
        "fchmodat",
        "fchown",
        "fchownat",
        "fcntl",
        "fstat",
        "fstatfs",
        "futex",
        "getcwd",
        "getdents64",
        "getegid",
        "geteuid",
        "getgid",
        "getpeername",
        "getpgrp",
        "getpid",
        "getppid",
        "getrandom",
        "getsockname",
        "getsockopt",
        "getuid",
        "ioctl",
        "listen",
        "lseek",
        "madvise",
        "memfd_create",
        "mmap",
        "mprotect",
        "munmap",
        "nanosleep",
        "newfstatat",
        "open",
        "openat",
        "pipe",
        "pipe2",
        "poll",
        "ppoll",
        "prctl",
        "pread64",
        "prlimit64",
        "pwrite64",
        "read",
        "readlink",
        "readlinkat",
        "recvfrom",
        "recvmsg",
        "rename",
        "renameat",
        "renameat2",
        "rt_sigaction",
        "rt_sigprocmask",
        "rt_sigreturn",
        "select",
        "sendfile",
        "sendmsg",
        "sendto",
        "set_robust_list",
        "set_tid_address",
        "setgid",
        "setgroups",
        "setsockopt",
        "setuid",
        "sigaltstack",
        "socket",
        "socketpair",
        "stat",
        "statfs",
        "statx",
        "sysinfo",
        "tgkill",
        "uname",
        "unlink",
        "unlinkat",
        "wait4",
        "write",
        "writev"
      ],
      "action": "SCMP_ACT_ALLOW"
    }
  ]
}
```

### 4.2 RuntimeDefault seccomp 적용 (Pod 레벨)

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: seccomp-default
spec:
  securityContext:
    seccompProfile:
      type: RuntimeDefault
  containers:
  - name: app
    image: nginx:1.25
    securityContext:
      allowPrivilegeEscalation: false
      runAsNonRoot: true
      runAsUser: 1000
```

### 4.3 Localhost 커스텀 seccomp 프로파일 적용

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: seccomp-custom
spec:
  securityContext:
    seccompProfile:
      type: Localhost
      localhostProfile: profiles/restricted.json
  containers:
  - name: app
    image: nginx:1.25
    securityContext:
      allowPrivilegeEscalation: false
```

```bash
# seccomp 프로파일 파일이 노드에 존재하는지 확인
ssh node01 ls /var/lib/kubelet/seccomp/profiles/restricted.json

# Pod가 정상적으로 실행되는지 확인
kubectl get pod seccomp-custom
kubectl describe pod seccomp-custom

# 차단된 시스템콜 확인 (컨테이너 내부에서)
kubectl exec seccomp-custom -- unshare --user /bin/sh
# 결과: Operation not permitted (unshare syscall이 차단됨)
```

---

## 5. Pod Security Admission

### 5.1 네임스페이스에 라벨로 적용

```bash
# Restricted 레벨을 enforce로 적용
kubectl label namespace production \
  pod-security.kubernetes.io/enforce=restricted \
  pod-security.kubernetes.io/enforce-version=latest \
  pod-security.kubernetes.io/audit=restricted \
  pod-security.kubernetes.io/warn=restricted

# 적용된 라벨 확인
kubectl get namespace production -o yaml
```

```yaml
# YAML로 직접 적용
apiVersion: v1
kind: Namespace
metadata:
  name: production
  labels:
    pod-security.kubernetes.io/enforce: restricted
    pod-security.kubernetes.io/enforce-version: latest
    pod-security.kubernetes.io/audit: restricted
    pod-security.kubernetes.io/audit-version: latest
    pod-security.kubernetes.io/warn: restricted
    pod-security.kubernetes.io/warn-version: latest
```

### 5.2 Restricted 네임스페이스에서 실행 가능한 Pod 예시

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: compliant-pod
  namespace: production
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
      runAsUser: 1000
      runAsGroup: 3000
      capabilities:
        drop: ["ALL"]
      readOnlyRootFilesystem: true
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

### 5.3 위반하는 Pod 예시 (거부됨)

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: non-compliant-pod
  namespace: production
spec:
  containers:
  - name: app
    image: nginx:1.25
    securityContext:
      privileged: true  # Restricted 위반
      runAsUser: 0      # root 실행, Restricted 위반
```

```bash
# 적용 시도
kubectl apply -f non-compliant-pod.yaml
# Error from server (Forbidden): pods "non-compliant-pod" is forbidden:
# violates PodSecurity "restricted:latest": privileged
# (container "app" must not set securityContext.privileged=true),
# runAsNonRoot != true (container "app" must not set runAsUser=0)
```

### 5.4 Baseline에서 Restricted로 점진적 전환

```bash
# 1단계: Baseline enforce + Restricted warn
kubectl label namespace production \
  pod-security.kubernetes.io/enforce=baseline \
  pod-security.kubernetes.io/warn=restricted

# 2단계: 경고를 확인하고 Pod를 수정

# 3단계: Restricted enforce로 전환
kubectl label namespace production \
  pod-security.kubernetes.io/enforce=restricted --overwrite
```

---

## 6. OPA Gatekeeper

### 6.1 Required Labels (필수 라벨 검증)

```yaml
# ConstraintTemplate 정의
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

      violation[{"msg": msg, "details": {"missing_labels": missing}}] {
        provided := {label | input.review.object.metadata.labels[label]}
        required := {label | label := input.parameters.labels[_]}
        missing := required - provided
        count(missing) > 0
        msg := sprintf("다음 필수 라벨이 누락되었습니다: %v", [missing])
      }
---
# Constraint 정의 (정책 인스턴스)
apiVersion: constraints.gatekeeper.sh/v1beta1
kind: K8sRequiredLabels
metadata:
  name: require-team-label
spec:
  match:
    kinds:
    - apiGroups: [""]
      kinds: ["Namespace"]
    - apiGroups: ["apps"]
      kinds: ["Deployment"]
  parameters:
    labels:
    - "team"
    - "environment"
```

```bash
# 검증: 필수 라벨 없이 Namespace 생성 시도
kubectl create namespace test-ns
# Error: 다음 필수 라벨이 누락되었습니다: {"environment", "team"}

# 필수 라벨을 포함하면 성공
kubectl create namespace test-ns --dry-run=client -o yaml | \
  kubectl label --local -f - team=backend environment=dev -o yaml | \
  kubectl apply -f -
```

### 6.2 Allowed Repos (허용된 레지스트리만 허용)

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
        not startswith_any(container.image, input.parameters.repos)
        msg := sprintf("컨테이너 '%v'의 이미지 '%v'는 허용된 레지스트리에 속하지 않습니다. 허용된 레지스트리: %v", [container.name, container.image, input.parameters.repos])
      }

      violation[{"msg": msg}] {
        container := input.review.object.spec.initContainers[_]
        not startswith_any(container.image, input.parameters.repos)
        msg := sprintf("initContainer '%v'의 이미지 '%v'는 허용된 레지스트리에 속하지 않습니다. 허용된 레지스트리: %v", [container.name, container.image, input.parameters.repos])
      }

      startswith_any(str, prefixes) {
        prefix := prefixes[_]
        startswith(str, prefix)
      }
---
apiVersion: constraints.gatekeeper.sh/v1beta1
kind: K8sAllowedRepos
metadata:
  name: allowed-repos
spec:
  match:
    kinds:
    - apiGroups: [""]
      kinds: ["Pod"]
    - apiGroups: ["apps"]
      kinds: ["Deployment", "StatefulSet", "DaemonSet"]
  parameters:
    repos:
    - "gcr.io/my-company/"
    - "docker.io/library/"
    - "registry.internal.company.com/"
```

```bash
# 검증: 허용되지 않은 레지스트리의 이미지 사용 시도
kubectl run test --image=quay.io/malicious/app
# Error: 컨테이너 'test'의 이미지 'quay.io/malicious/app'는 허용된 레지스트리에 속하지 않습니다

# 허용된 레지스트리의 이미지는 성공
kubectl run test --image=docker.io/library/nginx:1.25
```

### 6.3 Gatekeeper 상태 확인 명령어

```bash
# Gatekeeper 설치 확인
kubectl get pods -n gatekeeper-system

# ConstraintTemplate 목록
kubectl get constrainttemplates

# Constraint 목록 (특정 종류)
kubectl get k8srequiredlabels
kubectl get k8sallowedrepos

# Constraint 위반 현황 확인
kubectl describe k8srequiredlabels require-team-label
# Status > Violations 섹션에서 현재 위반 중인 리소스를 확인할 수 있다

# 모든 Constraint 종류 나열
kubectl get constraints
```

---

## 7. Trivy 이미지 스캔

```bash
# 기본 이미지 스캔
trivy image nginx:1.21
# 취약점 목록과 심각도, CVE ID, 설명이 출력된다

# CRITICAL과 HIGH 심각도만 표시
trivy image --severity CRITICAL,HIGH nginx:1.21

# 취약점이 있으면 exit code 1 반환 (CI/CD 용)
trivy image --exit-code 1 --severity CRITICAL nginx:1.21

# 수정 가능한 취약점만 표시 (패치된 버전이 있는 것만)
trivy image --ignore-unfixed nginx:1.21

# 테이블 형식 출력 (기본값)
trivy image --format table nginx:1.21

# JSON 형식으로 파일 저장
trivy image --format json -o result.json nginx:1.21

# 여러 이미지 스캔 (스크립트)
for img in nginx:1.21 redis:6 postgres:13; do
  echo "=== Scanning $img ==="
  trivy image --severity CRITICAL --exit-code 0 "$img"
done

# 로컬 이미지 스캔 (Docker 빌드 후)
docker build -t myapp:latest .
trivy image myapp:latest

# 특정 취약점 무시 (.trivyignore 파일)
cat > .trivyignore << 'EOF'
CVE-2023-44487
CVE-2023-39325
EOF
trivy image --ignorefile .trivyignore nginx:1.21

# SBOM 생성
trivy image --format cyclonedx -o sbom.cdx.json nginx:1.21

# 파일시스템 스캔 (Dockerfile 프로젝트)
trivy fs --severity HIGH,CRITICAL /path/to/project

# K8s 클러스터 스캔
trivy k8s --report summary cluster
```

---

## 8. Falco 커스텀 룰 작성 예제

### 8.1 컨테이너 내 셸 실행 탐지

파일: `/etc/falco/falco_rules.local.yaml`
```yaml
- rule: Shell Spawned in Container
  desc: 컨테이너 내에서 셸 프로세스가 실행되면 탐지한다
  condition: >
    spawned_process and
    container and
    proc.name in (bash, sh, zsh, ksh, csh, dash)
  output: >
    셸이 컨테이너에서 실행됨
    (user=%user.name user_loginuid=%user.loginuid
    container_id=%container.id container_name=%container.name
    shell=%proc.name parent=%proc.pname cmdline=%proc.cmdline
    image=%container.image.repository:%container.image.tag
    pod=%k8s.pod.name ns=%k8s.ns.name)
  priority: WARNING
  tags: [container, shell, mitre_execution]
```

### 8.2 민감한 파일 읽기 탐지

```yaml
- rule: Read Sensitive File in Container
  desc: 컨테이너에서 /etc/shadow, /etc/passwd 등 민감한 파일을 읽으면 탐지한다
  condition: >
    open_read and
    container and
    (fd.name startswith /etc/shadow or
     fd.name startswith /etc/passwd or
     fd.name startswith /etc/pam.d or
     fd.name = /etc/kubernetes/admin.conf or
     fd.name startswith /root/.kube)
  output: >
    민감한 파일이 컨테이너에서 읽힘
    (user=%user.name file=%fd.name
    container_id=%container.id container_name=%container.name
    image=%container.image.repository
    pod=%k8s.pod.name ns=%k8s.ns.name
    cmdline=%proc.cmdline)
  priority: CRITICAL
  tags: [filesystem, sensitive_file, mitre_credential_access]
```

### 8.3 컨테이너에서 패키지 설치 탐지

```yaml
- rule: Package Management in Container
  desc: 컨테이너 내에서 패키지 매니저가 실행되면 탐지한다 (불변성 위반)
  condition: >
    spawned_process and
    container and
    proc.name in (apt, apt-get, yum, dnf, apk, pip, pip3, npm, gem)
  output: >
    패키지 매니저가 컨테이너에서 실행됨 (불변성 위반)
    (user=%user.name package_mgr=%proc.name cmdline=%proc.cmdline
    container_id=%container.id container_name=%container.name
    image=%container.image.repository
    pod=%k8s.pod.name ns=%k8s.ns.name)
  priority: ERROR
  tags: [container, package_management, mitre_persistence]
```

### 8.4 예상하지 않은 네트워크 연결 탐지

```yaml
- rule: Unexpected Outbound Connection from Container
  desc: 컨테이너에서 예상하지 않은 외부 네트워크 연결이 발생하면 탐지한다
  condition: >
    evt.type = connect and
    evt.dir = < and
    container and
    fd.typechar = 4 and
    fd.ip != "0.0.0.0" and
    not fd.snet in (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 127.0.0.0/8)
  output: >
    컨테이너에서 외부 네트워크 연결 발생
    (user=%user.name connection=%fd.name
    container_id=%container.id container_name=%container.name
    image=%container.image.repository
    pod=%k8s.pod.name ns=%k8s.ns.name)
  priority: WARNING
  tags: [network, container, mitre_command_and_control]
```

### 8.5 컨테이너 내 바이너리 실행 파일 생성 탐지

```yaml
- rule: New Executable Written to Container
  desc: 컨테이너 내에서 새로운 실행 파일이 생성되면 탐지한다
  condition: >
    evt.type in (open, openat) and
    evt.dir = < and
    container and
    fd.typechar = f and
    evt.arg.flags contains O_CREAT and
    (fd.name endswith .sh or
     fd.name endswith .py or
     fd.directory = /usr/bin or
     fd.directory = /usr/local/bin or
     fd.directory = /bin or
     fd.directory = /sbin)
  output: >
    새로운 실행 파일이 컨테이너에서 생성됨
    (user=%user.name file=%fd.name
    container_id=%container.id container_name=%container.name
    image=%container.image.repository
    pod=%k8s.pod.name ns=%k8s.ns.name)
  priority: ERROR
  tags: [filesystem, container, mitre_persistence]
```

```bash
# Falco 재시작 (systemd 방식)
systemctl restart falco

# Falco 로그 확인
journalctl -u falco -f

# Falco 수동 실행 (디버깅)
falco -r /etc/falco/falco_rules.local.yaml --dry-run

# 검증: 컨테이너에서 셸 실행
kubectl exec -it nginx-pod -- /bin/bash
# Falco 로그에 경고가 출력된다
```

---

## 9. Audit Policy YAML 예제

### 9.1 기본 Audit Policy

파일: `/etc/kubernetes/audit-policy.yaml`
```yaml
apiVersion: audit.k8s.io/v1
kind: Policy
rules:
  # RequestResponse 레벨: Secret 접근 기록 (요청+응답 본문 포함)
  - level: RequestResponse
    resources:
    - group: ""
      resources: ["secrets"]

  # Request 레벨: ConfigMap 변경 기록
  - level: Request
    resources:
    - group: ""
      resources: ["configmaps"]
    verbs: ["create", "update", "patch", "delete"]

  # Metadata 레벨: Pod 관련 모든 작업 기록
  - level: Metadata
    resources:
    - group: ""
      resources: ["pods", "pods/log", "pods/exec"]

  # Metadata 레벨: RBAC 관련 변경 기록
  - level: Metadata
    resources:
    - group: "rbac.authorization.k8s.io"
      resources: ["roles", "rolebindings", "clusterroles", "clusterrolebindings"]

  # None: 시스템 컴포넌트의 반복적인 요청 제외 (로그 볼륨 감소)
  - level: None
    users:
    - "system:kube-scheduler"
    - "system:kube-proxy"
    - "system:apiserver"
    verbs: ["get", "list", "watch"]

  # None: 헬스 체크 엔드포인트 제외
  - level: None
    nonResourceURLs:
    - "/healthz*"
    - "/livez*"
    - "/readyz*"
    - "/version"

  # None: 이벤트 리소스 제외 (로그 볼륨 매우 큼)
  - level: None
    resources:
    - group: ""
      resources: ["events"]

  # 기본 catch-all: 나머지 모든 요청은 Metadata 레벨로 기록
  - level: Metadata
    omitStages:
    - "RequestReceived"
```

### 9.2 API Server에 Audit 설정 적용

```bash
# 1. audit-policy.yaml 파일을 노드에 저장
sudo vi /etc/kubernetes/audit-policy.yaml

# 2. 로그 디렉토리 생성
sudo mkdir -p /var/log/kubernetes/audit/

# 3. API server 매니페스트 수정
sudo vi /etc/kubernetes/manifests/kube-apiserver.yaml
```

API server 매니페스트에 추가할 내용:
```yaml
spec:
  containers:
  - command:
    - kube-apiserver
    # 기존 플래그들...
    - --audit-policy-file=/etc/kubernetes/audit-policy.yaml
    - --audit-log-path=/var/log/kubernetes/audit/audit.log
    - --audit-log-maxage=30
    - --audit-log-maxbackup=10
    - --audit-log-maxsize=100
    volumeMounts:
    # 기존 volumeMounts...
    - name: audit-policy
      mountPath: /etc/kubernetes/audit-policy.yaml
      readOnly: true
    - name: audit-log
      mountPath: /var/log/kubernetes/audit/
  volumes:
  # 기존 volumes...
  - name: audit-policy
    hostPath:
      path: /etc/kubernetes/audit-policy.yaml
      type: File
  - name: audit-log
    hostPath:
      path: /var/log/kubernetes/audit/
      type: DirectoryOrCreate
```

```bash
# 4. API server 재시작 대기 및 확인
watch crictl ps | grep kube-apiserver

# 5. 감사 로그 확인
tail -f /var/log/kubernetes/audit/audit.log | jq .

# 6. 특정 리소스에 대한 로그 필터링
cat /var/log/kubernetes/audit/audit.log | jq 'select(.objectRef.resource == "secrets")'

# 7. 특정 사용자의 활동 필터링
cat /var/log/kubernetes/audit/audit.log | jq 'select(.user.username == "jane")'
```

---

## 10. Secret Encryption at Rest

### 10.1 EncryptionConfiguration YAML

파일: `/etc/kubernetes/encryption-config.yaml`
```yaml
apiVersion: apiserver.config.k8s.io/v1
kind: EncryptionConfiguration
resources:
  - resources:
    - secrets
    providers:
    # aescbc 암호화 (권장)
    - aescbc:
        keys:
        - name: key1
          # 32바이트 랜덤 키 (base64 인코딩)
          secret: dGhpcyBpcyBhIDMyIGJ5dGUga2V5IGZvciBhZXNjYmM=
    # identity는 암호화하지 않음 (기존 데이터 읽기용, 맨 마지막에 위치)
    - identity: {}
```

### 10.2 랜덤 암호화 키 생성

```bash
# 32바이트 랜덤 키 생성 (base64 인코딩)
head -c 32 /dev/urandom | base64
# 출력 예: aTU0RnE1aEpzMWRRYnhZdDhLUjdYS2JkTXRPeGprWno=
```

### 10.3 API Server에 적용

```bash
# 1. 암호화 설정 파일 저장
sudo vi /etc/kubernetes/encryption-config.yaml

# 2. API server 매니페스트 수정
sudo vi /etc/kubernetes/manifests/kube-apiserver.yaml
```

API server 매니페스트에 추가:
```yaml
spec:
  containers:
  - command:
    - kube-apiserver
    # 기존 플래그들...
    - --encryption-provider-config=/etc/kubernetes/encryption-config.yaml
    volumeMounts:
    # 기존 volumeMounts...
    - name: encryption-config
      mountPath: /etc/kubernetes/encryption-config.yaml
      readOnly: true
  volumes:
  # 기존 volumes...
  - name: encryption-config
    hostPath:
      path: /etc/kubernetes/encryption-config.yaml
      type: File
```

```bash
# 3. API server 재시작 대기
watch crictl ps | grep kube-apiserver

# 4. 기존 Secret 재암호화 (모든 Secret을 다시 쓰기)
kubectl get secrets --all-namespaces -o json | kubectl replace -f -

# 5. etcd에서 Secret이 암호화되어 저장되었는지 확인
ETCDCTL_API=3 etcdctl \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key \
  get /registry/secrets/default/my-secret | hexdump -C

# 암호화 전: 평문으로 보임 (k8s:enc:identity)
# 암호화 후: 암호화된 데이터로 보임 (k8s:enc:aescbc:v1:key1)
```

---

## 11. RuntimeClass (gVisor)

### 11.1 RuntimeClass 생성

```yaml
apiVersion: node.k8s.io/v1
kind: RuntimeClass
metadata:
  name: gvisor
# handler는 containerd 설정에 정의된 런타임 핸들러 이름과 일치해야 한다
handler: runsc
```

### 11.2 containerd 설정 확인 (노드에서)

```bash
# containerd 설정에서 runsc 핸들러 확인
cat /etc/containerd/config.toml
```

containerd 설정 예시:
```toml
[plugins."io.containerd.grpc.v1.cri".containerd.runtimes.runsc]
  runtime_type = "io.containerd.runsc.v1"
```

### 11.3 Pod에서 RuntimeClass 사용

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: sandboxed-app
spec:
  runtimeClassName: gvisor  # RuntimeClass 이름 지정
  containers:
  - name: app
    image: nginx:1.25
    ports:
    - containerPort: 80
    securityContext:
      allowPrivilegeEscalation: false
      runAsNonRoot: true
      runAsUser: 1000
```

### 11.4 Kata Containers RuntimeClass

```yaml
apiVersion: node.k8s.io/v1
kind: RuntimeClass
metadata:
  name: kata
handler: kata
---
apiVersion: v1
kind: Pod
metadata:
  name: kata-pod
spec:
  runtimeClassName: kata
  containers:
  - name: app
    image: nginx:1.25
```

```bash
# RuntimeClass 적용 확인
kubectl get runtimeclass
kubectl describe pod sandboxed-app | grep "Runtime Class"

# gVisor(runsc)로 실행 중인지 확인 (컨테이너 내부에서)
kubectl exec sandboxed-app -- dmesg | head
# 출력에 "Starting gVisor" 또는 유사한 메시지가 보인다
```

---

## 12. kube-bench 실행 및 결과 해석

```bash
# kube-bench 실행 (마스터 노드)
kube-bench run --targets master

# 결과 예시:
# [INFO] 1 Master Node Security Configuration
# [INFO] 1.1 Master Node Configuration Files
# [PASS] 1.1.1 Ensure that the API server pod specification file permissions are set to 644 or more restrictive
# [PASS] 1.1.2 Ensure that the API server pod specification file ownership is set to root:root
# [FAIL] 1.2.1 Ensure that the --anonymous-auth argument is set to false
# [PASS] 1.2.2 Ensure that the --token-auth-file parameter is not set
# ...
# == Summary total ==
# 42 checks PASS
# 10 checks FAIL
# 12 checks WARN
# 0 checks INFO

# 실패한 항목만 확인
kube-bench run --targets master 2>&1 | grep "\[FAIL\]"

# 특정 항목만 점검
kube-bench run --targets master --check 1.2.1

# 워커 노드 점검
kube-bench run --targets node

# 실패 항목 수정 예시: anonymous-auth 비활성화
# /etc/kubernetes/manifests/kube-apiserver.yaml 수정
# --anonymous-auth=false 추가

# 수정 후 재점검
kube-bench run --targets master --check 1.2.1
# [PASS] 1.2.1 Ensure that the --anonymous-auth argument is set to false

# kube-bench를 Job으로 실행
kubectl apply -f https://raw.githubusercontent.com/aquasecurity/kube-bench/main/job-master.yaml
kubectl logs job/kube-bench
```

---

## 13. ImagePolicyWebhook

### 13.1 AdmissionConfiguration

파일: `/etc/kubernetes/admission-control/admission-config.yaml`
```yaml
apiVersion: apiserver.config.k8s.io/v1
kind: AdmissionConfiguration
plugins:
- name: ImagePolicyWebhook
  configuration:
    imagePolicy:
      kubeConfigFile: /etc/kubernetes/admission-control/image-policy-webhook.kubeconfig
      allowTTL: 50
      denyTTL: 50
      retryBackoff: 500
      defaultAllow: false  # fail-closed: 웹훅 실패 시 이미지 거부
```

### 13.2 Webhook kubeconfig

파일: `/etc/kubernetes/admission-control/image-policy-webhook.kubeconfig`
```yaml
apiVersion: v1
kind: Config
clusters:
- name: image-policy-webhook
  cluster:
    server: https://image-policy-webhook.default.svc:8443/image-policy
    certificate-authority: /etc/kubernetes/admission-control/webhook-ca.crt
contexts:
- name: image-policy-webhook
  context:
    cluster: image-policy-webhook
    user: api-server
current-context: image-policy-webhook
users:
- name: api-server
  user:
    client-certificate: /etc/kubernetes/pki/apiserver.crt
    client-key: /etc/kubernetes/pki/apiserver.key
```

### 13.3 API Server 설정

```yaml
# /etc/kubernetes/manifests/kube-apiserver.yaml
spec:
  containers:
  - command:
    - kube-apiserver
    # 기존 플래그들...
    - --enable-admission-plugins=NodeRestriction,ImagePolicyWebhook
    - --admission-control-config-file=/etc/kubernetes/admission-control/admission-config.yaml
    volumeMounts:
    # 기존 volumeMounts...
    - name: admission-control
      mountPath: /etc/kubernetes/admission-control/
      readOnly: true
  volumes:
  # 기존 volumes...
  - name: admission-control
    hostPath:
      path: /etc/kubernetes/admission-control/
      type: DirectoryOrCreate
```

```bash
# 적용 후 API server 재시작 대기
watch crictl ps | grep kube-apiserver

# 검증: 이미지 정책 검증이 동작하는지 확인
kubectl run test --image=untrusted-registry.com/malicious:latest
# 웹훅이 거부하면: Error from server (Forbidden): ...image policy webhook denied
```

---

## 14. Dockerfile 보안 예제

### 14.1 보안에 취약한 Dockerfile (BAD)

```dockerfile
# BAD: 큰 베이스 이미지, root 실행, 불필요한 패키지
FROM ubuntu:latest
RUN apt-get update && apt-get install -y curl wget vim netcat
COPY . /app
WORKDIR /app
RUN pip install -r requirements.txt
EXPOSE 8080
CMD ["python", "app.py"]
```

**문제점:**
- `latest` 태그 사용 (재현성 없음)
- `ubuntu` 베이스 이미지 (공격 표면 큼)
- root 사용자로 실행 (USER 미지정)
- 불필요한 패키지 설치 (vim, netcat 등 디버깅 도구)
- 멀티스테이지 빌드 미사용
- HEALTHCHECK 없음

### 14.2 보안이 강화된 Dockerfile (GOOD)

```dockerfile
# GOOD: distroless 베이스, non-root, 멀티스테이지
# Stage 1: 빌드
FROM python:3.12-slim AS builder
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir --user -r requirements.txt
COPY . .

# Stage 2: 실행 (최소 이미지)
FROM gcr.io/distroless/python3-debian12:nonroot
WORKDIR /app
COPY --from=builder /root/.local /home/nonroot/.local
COPY --from=builder /app .

# non-root 사용자 (distroless의 기본 nonroot 사용자)
USER 65532:65532

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD ["/app/healthcheck.py"]

ENTRYPOINT ["python", "app.py"]
```

### 14.3 Go 애플리케이션 보안 Dockerfile

```dockerfile
# scratch 베이스 이미지 (최소 공격 표면)
FROM golang:1.22-alpine AS builder
RUN apk add --no-cache git ca-certificates
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o /app/server .

FROM scratch
# CA 인증서 복사 (HTTPS 통신에 필요)
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
# 실행 파일만 복사
COPY --from=builder /app/server /server
# non-root UID
USER 65534:65534
EXPOSE 8080
ENTRYPOINT ["/server"]
```

### 14.4 CKS 시험에서 Dockerfile 수정 예시

주어진 Dockerfile에서 보안 문제를 수정하라는 문제가 출제될 수 있다:

```bash
# 문제에서 주어진 Dockerfile 확인
cat /path/to/Dockerfile

# 수정 포인트:
# 1. FROM ubuntu:latest → FROM ubuntu:22.04 (또는 alpine, distroless)
# 2. USER root → USER 1000:1000 (또는 appuser)
# 3. 불필요한 패키지 제거 (vim, curl, wget 등)
# 4. ADD → COPY 변경
# 5. COPY . . → .dockerignore로 민감한 파일 제외

# 수정 후 이미지 빌드 및 스캔
docker build -t myapp:secure .
trivy image myapp:secure
```

---

## 15. Ingress TLS 설정 예제

### 15.1 TLS Secret 생성

```bash
# 자체 서명 인증서 생성 (시험에서는 보통 인증서가 제공됨)
openssl req -x509 -nodes -days 365 \
  -newkey rsa:2048 \
  -keyout tls.key \
  -out tls.crt \
  -subj "/CN=myapp.example.com"

# TLS Secret 생성
kubectl create secret tls myapp-tls \
  --cert=tls.crt \
  --key=tls.key \
  -n production
```

### 15.2 Ingress with TLS

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: myapp-ingress
  namespace: production
  annotations:
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
spec:
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
              number: 443
```

```bash
# 검증
kubectl get ingress -n production
kubectl describe ingress myapp-ingress -n production

# TLS 인증서 확인
kubectl get secret myapp-tls -n production -o jsonpath='{.data.tls\.crt}' | base64 -d | openssl x509 -text -noout
```

---

## 16. ServiceAccount 보안 설정

### 16.1 automountServiceAccountToken 비활성화

```yaml
# ServiceAccount에서 설정
apiVersion: v1
kind: ServiceAccount
metadata:
  name: secure-sa
  namespace: production
automountServiceAccountToken: false
---
# Pod에서도 설정 가능 (Pod 설정이 우선)
apiVersion: v1
kind: Pod
metadata:
  name: secure-pod
  namespace: production
spec:
  serviceAccountName: secure-sa
  automountServiceAccountToken: false
  containers:
  - name: app
    image: nginx:1.25
```

```bash
# 검증: 토큰이 마운트되지 않았는지 확인
kubectl exec secure-pod -- ls /var/run/secrets/kubernetes.io/serviceaccount/
# ls: /var/run/secrets/kubernetes.io/serviceaccount/: No such file or directory

# API server 접근 불가 확인
kubectl exec secure-pod -- cat /var/run/secrets/kubernetes.io/serviceaccount/token
# cat: /var/run/secrets/kubernetes.io/serviceaccount/token: No such file or directory
```

---

## 17. 컨테이너 불변성 (Immutable Container) 설정

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: immutable-pod
spec:
  securityContext:
    runAsNonRoot: true
    runAsUser: 1000
    runAsGroup: 3000
    fsGroup: 2000
    seccompProfile:
      type: RuntimeDefault
  containers:
  - name: app
    image: nginx:1.25
    securityContext:
      readOnlyRootFilesystem: true
      allowPrivilegeEscalation: false
      capabilities:
        drop: ["ALL"]
    resources:
      limits:
        cpu: "200m"
        memory: "128Mi"
      requests:
        cpu: "100m"
        memory: "64Mi"
    volumeMounts:
    # 쓰기가 필요한 디렉토리만 emptyDir로 마운트
    - name: tmp
      mountPath: /tmp
    - name: var-cache
      mountPath: /var/cache/nginx
    - name: var-run
      mountPath: /var/run
  volumes:
  - name: tmp
    emptyDir:
      sizeLimit: 100Mi
  - name: var-cache
    emptyDir:
      sizeLimit: 50Mi
  - name: var-run
    emptyDir:
      sizeLimit: 10Mi
```

```bash
# 검증: 루트 파일시스템에 쓰기 불가
kubectl exec immutable-pod -- touch /root/test.txt
# touch: cannot touch '/root/test.txt': Read-only file system

# /tmp에는 쓰기 가능
kubectl exec immutable-pod -- touch /tmp/test.txt
# (성공)
```
