# KCSA 실전 보안 예제 모음

> Kubernetes 보안 설정을 위한 실전 YAML 예제 모음이다. 모든 예제는 프로덕션 환경에서 활용할 수 있도록 작성되었다.

---

## 1. RBAC (Role-Based Access Control)

### 1.1 Role - 네임스페이스 범위 권한

특정 네임스페이스 내에서 Pod 조회와 로그 확인만 허용하는 Role이다.

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  namespace: production
  name: pod-reader
rules:
  # Pod 읽기 권한
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list", "watch"]
  # Pod 로그 조회 권한
  - apiGroups: [""]
    resources: ["pods/log"]
    verbs: ["get"]
```

Deployment와 Service를 관리할 수 있는 Role이다.

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  namespace: development
  name: app-manager
rules:
  - apiGroups: ["apps"]
    resources: ["deployments", "replicasets"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  - apiGroups: [""]
    resources: ["services", "configmaps"]
    verbs: ["get", "list", "watch", "create", "update", "patch"]
  # Secret은 읽기만 허용한다
  - apiGroups: [""]
    resources: ["secrets"]
    verbs: ["get", "list"]
```

### 1.2 ClusterRole - 클러스터 전체 범위 권한

노드와 PersistentVolume을 읽을 수 있는 ClusterRole이다. 이 리소스들은 네임스페이스에 속하지 않으므로 ClusterRole이 필요하다.

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: node-viewer
rules:
  - apiGroups: [""]
    resources: ["nodes"]
    verbs: ["get", "list", "watch"]
  - apiGroups: [""]
    resources: ["persistentvolumes"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["storage.k8s.io"]
    resources: ["storageclasses"]
    verbs: ["get", "list", "watch"]
```

보안 감사를 위한 읽기 전용 ClusterRole이다.

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: security-auditor
rules:
  # 모든 리소스 읽기 (Secret 제외)
  - apiGroups: [""]
    resources: ["pods", "services", "configmaps", "serviceaccounts", "namespaces", "endpoints"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["apps"]
    resources: ["deployments", "daemonsets", "statefulsets", "replicasets"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["networking.k8s.io"]
    resources: ["networkpolicies"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["rbac.authorization.k8s.io"]
    resources: ["roles", "rolebindings", "clusterroles", "clusterrolebindings"]
    verbs: ["get", "list", "watch"]
  # Pod Security 관련
  - apiGroups: ["policy"]
    resources: ["podsecuritypolicies"]
    verbs: ["get", "list", "watch"]
```

### 1.3 RoleBinding - 네임스페이스 범위 바인딩

사용자 `jane`에게 `production` 네임스페이스의 `pod-reader` Role을 바인딩하는 예제이다.

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: read-pods-binding
  namespace: production
subjects:
  # 사용자에게 바인딩
  - kind: User
    name: jane
    apiGroup: rbac.authorization.k8s.io
roleRef:
  kind: Role
  name: pod-reader
  apiGroup: rbac.authorization.k8s.io
```

ServiceAccount에 Role을 바인딩하는 예제이다.

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: app-manager-binding
  namespace: development
subjects:
  # ServiceAccount에 바인딩
  - kind: ServiceAccount
    name: ci-deployer
    namespace: development
roleRef:
  kind: Role
  name: app-manager
  apiGroup: rbac.authorization.k8s.io
```

ClusterRole을 RoleBinding으로 특정 네임스페이스에만 바인딩하는 예제이다. ClusterRole의 권한을 네임스페이스 범위로 제한할 때 유용하다.

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: auditor-dev-binding
  namespace: development
subjects:
  - kind: Group
    name: security-team
    apiGroup: rbac.authorization.k8s.io
roleRef:
  # ClusterRole이지만 RoleBinding이므로 development 네임스페이스에서만 유효하다
  kind: ClusterRole
  name: security-auditor
  apiGroup: rbac.authorization.k8s.io
```

### 1.4 ClusterRoleBinding - 클러스터 전체 범위 바인딩

그룹에 ClusterRole을 바인딩하는 예제이다. 클러스터 전체에서 유효하다.

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: node-viewer-binding
subjects:
  # 그룹에 바인딩
  - kind: Group
    name: ops-team
    apiGroup: rbac.authorization.k8s.io
roleRef:
  kind: ClusterRole
  name: node-viewer
  apiGroup: rbac.authorization.k8s.io
```

여러 주체에 동시에 바인딩하는 예제이다.

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: security-audit-binding
subjects:
  - kind: User
    name: alice
    apiGroup: rbac.authorization.k8s.io
  - kind: Group
    name: security-team
    apiGroup: rbac.authorization.k8s.io
  - kind: ServiceAccount
    name: audit-bot
    namespace: security
roleRef:
  kind: ClusterRole
  name: security-auditor
  apiGroup: rbac.authorization.k8s.io
```

---

## 2. NetworkPolicy

### 2.1 Default Deny - 모든 트래픽 차단

네임스페이스의 모든 ingress 트래픽을 차단하는 기본 거부 정책이다. 모든 네임스페이스에 우선 적용하는 것을 권장한다.

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-ingress
  namespace: production
spec:
  podSelector: {}  # 빈 셀렉터 = 네임스페이스의 모든 Pod에 적용
  policyTypes:
    - Ingress
  # ingress 규칙이 없으므로 모든 인바운드 트래픽이 차단된다
```

모든 egress 트래픽을 차단하는 기본 거부 정책이다.

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-egress
  namespace: production
spec:
  podSelector: {}
  policyTypes:
    - Egress
  # egress 규칙이 없으므로 모든 아웃바운드 트래픽이 차단된다
```

모든 ingress와 egress를 동시에 차단하는 정책이다.

```yaml
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
```

### 2.2 Ingress 규칙 - 특정 트래픽만 허용

`app: web` 라벨이 있는 Pod에 대해 `app: frontend` Pod에서 오는 80 포트 트래픽만 허용하는 정책이다.

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-frontend-to-web
  namespace: production
spec:
  podSelector:
    matchLabels:
      app: web
  policyTypes:
    - Ingress
  ingress:
    - from:
        # 같은 네임스페이스의 app=frontend Pod에서만 허용
        - podSelector:
            matchLabels:
              app: frontend
      ports:
        - protocol: TCP
          port: 80
        - protocol: TCP
          port: 443
```

다른 네임스페이스에서의 접근을 허용하는 정책이다. `podSelector`와 `namespaceSelector`가 같은 `from` 항목에 있으므로 AND 관계이다.

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-monitoring
  namespace: production
spec:
  podSelector:
    matchLabels:
      app: web
  policyTypes:
    - Ingress
  ingress:
    - from:
        # monitoring 네임스페이스의 app=prometheus Pod에서만 허용 (AND 관계)
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

### 2.3 Egress 규칙 - 아웃바운드 트래픽 제어

`app: web` Pod가 `app: database` Pod의 5432 포트와 DNS(53 포트)에만 접근할 수 있도록 제한하는 정책이다.

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: web-egress-policy
  namespace: production
spec:
  podSelector:
    matchLabels:
      app: web
  policyTypes:
    - Egress
  egress:
    # 데이터베이스 접근 허용
    - to:
        - podSelector:
            matchLabels:
              app: database
      ports:
        - protocol: TCP
          port: 5432
    # DNS 조회 허용 (kube-system 네임스페이스의 DNS)
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: kube-system
          podSelector:
            matchLabels:
              k8s-app: kube-dns
      ports:
        - protocol: UDP
          port: 53
        - protocol: TCP
          port: 53
```

### 2.4 다중 규칙 - OR 관계와 AND 관계

여러 소스에서의 접근을 OR 관계로 허용하는 예제이다.

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: multi-source-ingress
  namespace: production
spec:
  podSelector:
    matchLabels:
      app: api-server
  policyTypes:
    - Ingress
  ingress:
    - from:
        # 아래 3개 조건 중 하나라도 만족하면 허용 (OR 관계)

        # 1) 같은 네임스페이스의 app=web Pod
        - podSelector:
            matchLabels:
              app: web

        # 2) staging 네임스페이스의 모든 Pod
        - namespaceSelector:
            matchLabels:
              environment: staging

        # 3) 특정 외부 IP 대역
        - ipBlock:
            cidr: 10.0.0.0/8
            except:
              - 10.0.1.0/24  # 이 대역은 제외
      ports:
        - protocol: TCP
          port: 8080
```

### 2.5 복합 정책 - Ingress + Egress

`app: backend` Pod에 대해 ingress와 egress를 모두 제어하는 복합 정책이다.

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: backend-full-policy
  namespace: production
spec:
  podSelector:
    matchLabels:
      app: backend
  policyTypes:
    - Ingress
    - Egress
  ingress:
    # frontend에서만 8080 포트로 접근 허용
    - from:
        - podSelector:
            matchLabels:
              app: frontend
      ports:
        - protocol: TCP
          port: 8080
    # 모니터링에서 메트릭 포트 접근 허용
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: monitoring
      ports:
        - protocol: TCP
          port: 9090
  egress:
    # 데이터베이스 접근
    - to:
        - podSelector:
            matchLabels:
              app: postgres
      ports:
        - protocol: TCP
          port: 5432
    # Redis 접근
    - to:
        - podSelector:
            matchLabels:
              app: redis
      ports:
        - protocol: TCP
          port: 6379
    # DNS 허용
    - to: []
      ports:
        - protocol: UDP
          port: 53
        - protocol: TCP
          port: 53
```

---

## 3. Pod Security Standards (PSA) 적용

### 3.1 네임스페이스에 PSA 라벨 적용

`restricted` 레벨을 적용하는 네임스페이스이다. enforce, audit, warn을 모두 설정하는 것이 권장된다.

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: secure-apps
  labels:
    # enforce: 위반하는 Pod 생성을 거부한다
    pod-security.kubernetes.io/enforce: restricted
    pod-security.kubernetes.io/enforce-version: latest
    # audit: 위반 사항을 감사 로그에 기록한다
    pod-security.kubernetes.io/audit: restricted
    pod-security.kubernetes.io/audit-version: latest
    # warn: 사용자에게 경고 메시지를 표시한다
    pod-security.kubernetes.io/warn: restricted
    pod-security.kubernetes.io/warn-version: latest
```

`baseline` 레벨로 enforce하고 `restricted`로 warn/audit하는 점진적 적용 예제이다.

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: general-apps
  labels:
    # 현재는 baseline으로 enforce
    pod-security.kubernetes.io/enforce: baseline
    pod-security.kubernetes.io/enforce-version: latest
    # restricted 위반은 경고와 감사 로그로 기록 (향후 전환 준비)
    pod-security.kubernetes.io/audit: restricted
    pod-security.kubernetes.io/audit-version: latest
    pod-security.kubernetes.io/warn: restricted
    pod-security.kubernetes.io/warn-version: latest
```

### 3.2 Restricted 레벨을 만족하는 Pod 예제

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: secure-pod
  namespace: secure-apps
spec:
  # API Server 접근이 불필요하면 토큰 마운트를 비활성화한다
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
      image: registry.example.com/app:v1.2.3
      ports:
        - containerPort: 8080
      securityContext:
        allowPrivilegeEscalation: false
        readOnlyRootFilesystem: true
        capabilities:
          drop:
            - ALL
      resources:
        requests:
          memory: "64Mi"
          cpu: "100m"
        limits:
          memory: "128Mi"
          cpu: "200m"
      volumeMounts:
        - name: tmp
          mountPath: /tmp
        - name: config
          mountPath: /etc/app/config
          readOnly: true
  volumes:
    - name: tmp
      emptyDir: {}
    - name: config
      configMap:
        name: app-config
```

---

## 4. Secret Encryption at Rest

### 4.1 EncryptionConfiguration

API Server의 `--encryption-provider-config` 플래그로 지정하는 설정 파일이다.

#### AES-CBC 방식

```yaml
apiVersion: apiserver.config.k8s.io/v1
kind: EncryptionConfiguration
resources:
  - resources:
      - secrets
      - configmaps
    providers:
      # 첫 번째 프로바이더가 새로운 데이터 암호화에 사용된다
      - aescbc:
          keys:
            - name: key-2024
              secret: c2VjcmV0LWtleS0xMjM0NTY3ODkwMTIzNDU2  # 32바이트 Base64 인코딩 키
      # 이전 키 (키 로테이션 시 기존 데이터 복호화용)
      - aescbc:
          keys:
            - name: key-2023
              secret: b2xkLXNlY3JldC1rZXktMTIzNDU2Nzg5MDEy
      # identity는 암호화되지 않은 데이터를 읽기 위한 폴백이다
      - identity: {}
```

#### KMS v2 방식 (프로덕션 권장)

```yaml
apiVersion: apiserver.config.k8s.io/v1
kind: EncryptionConfiguration
resources:
  - resources:
      - secrets
      - configmaps
    providers:
      - kms:
          apiVersion: v2
          name: my-kms-provider
          endpoint: unix:///var/run/kms-provider.sock
          timeout: 3s
      - identity: {}
```

#### secretbox 방식

```yaml
apiVersion: apiserver.config.k8s.io/v1
kind: EncryptionConfiguration
resources:
  - resources:
      - secrets
    providers:
      - secretbox:
          keys:
            - name: key-2024
              secret: YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY=  # 32바이트 Base64 인코딩 키
      - identity: {}
```

> 키 로테이션 절차:
> 1. 새 키를 목록의 첫 번째 위치에 추가한다.
> 2. API Server를 재시작한다.
> 3. `kubectl get secrets --all-namespaces -o json | kubectl replace -f -` 명령으로 모든 Secret을 새 키로 재암호화한다.
> 4. 모든 데이터가 재암호화되면 이전 키를 제거한다.

---

## 5. Audit Policy

### 5.1 종합 Audit Policy 예제

API Server의 `--audit-policy-file` 플래그로 지정하는 정책 파일이다.

```yaml
apiVersion: audit.k8s.io/v1
kind: Policy
# 모든 요청에 기본 적용되는 레벨이다. 규칙에 매칭되지 않으면 이 레벨이 적용된다.
omitStages:
  - "RequestReceived"
rules:
  # -----------------------------------------------
  # 레벨: None - 기록하지 않는 요청
  # -----------------------------------------------

  # 헬스 체크 및 readiness 체크는 기록하지 않는다 (노이즈 방지)
  - level: None
    users: ["system:kube-proxy"]
    verbs: ["watch"]
    resources:
      - group: ""
        resources: ["endpoints", "services", "services/status"]

  - level: None
    nonResourceURLs:
      - "/healthz*"
      - "/version"
      - "/readyz*"
      - "/livez*"
      - "/openapi/*"

  # system:apiserver 사용자의 이벤트 기록을 제외한다
  - level: None
    users: ["system:apiserver"]
    verbs: ["get"]
    resources:
      - group: ""
        resources: ["namespaces", "namespaces/status", "namespaces/finalize"]

  # 자동 생성되는 높은 빈도의 이벤트를 제외한다
  - level: None
    resources:
      - group: ""
        resources: ["events"]

  # -----------------------------------------------
  # 레벨: Metadata - 메타데이터만 기록
  # -----------------------------------------------

  # Secret 접근은 메타데이터만 기록한다 (데이터 노출 방지)
  - level: Metadata
    resources:
      - group: ""
        resources: ["secrets", "configmaps"]
      - group: ""
        resources: ["tokenreviews"]

  # 읽기 전용 요청은 메타데이터만 기록한다
  - level: Metadata
    verbs: ["get", "list", "watch"]

  # -----------------------------------------------
  # 레벨: Request - 요청 본문까지 기록
  # -----------------------------------------------

  # RBAC 변경은 요청 본문까지 기록한다
  - level: Request
    resources:
      - group: "rbac.authorization.k8s.io"
        resources: ["roles", "rolebindings", "clusterroles", "clusterrolebindings"]

  # 네임스페이스 생성/삭제는 요청 본문까지 기록한다
  - level: Request
    resources:
      - group: ""
        resources: ["namespaces"]
    verbs: ["create", "delete"]

  # -----------------------------------------------
  # 레벨: RequestResponse - 요청과 응답 본문 모두 기록
  # -----------------------------------------------

  # Pod exec, attach, port-forward는 전체 기록한다 (보안 감사용)
  - level: RequestResponse
    resources:
      - group: ""
        resources: ["pods/exec", "pods/attach", "pods/portforward"]

  # ServiceAccount 토큰 요청은 전체 기록한다
  - level: RequestResponse
    resources:
      - group: ""
        resources: ["serviceaccounts/token"]

  # -----------------------------------------------
  # 기본 규칙: 위의 규칙에 매칭되지 않는 모든 요청
  # -----------------------------------------------

  # 변경 요청은 Request 레벨로 기록한다
  - level: Request
    verbs: ["create", "update", "patch", "delete", "deletecollection"]

  # 나머지는 Metadata 레벨로 기록한다
  - level: Metadata
```

### 5.2 Audit 관련 API Server 플래그

```
# API Server 매니페스트에 추가하는 플래그 예시
--audit-policy-file=/etc/kubernetes/audit/audit-policy.yaml
--audit-log-path=/var/log/kubernetes/audit/audit.log
--audit-log-maxage=30            # 로그 보존 기간 (일)
--audit-log-maxbackup=10         # 최대 백업 파일 수
--audit-log-maxsize=100          # 최대 파일 크기 (MB)

# Webhook 백엔드 사용 시
--audit-webhook-config-file=/etc/kubernetes/audit/webhook-config.yaml
--audit-webhook-initial-backoff=5s
```

---

## 6. seccomp 프로파일

### 6.1 RuntimeDefault 프로파일 적용

가장 간단한 seccomp 적용 방법이다. 컨테이너 런타임이 제공하는 기본 프로파일을 사용한다.

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: seccomp-runtime-default
spec:
  securityContext:
    seccompProfile:
      type: RuntimeDefault
  containers:
    - name: app
      image: nginx:1.27
      securityContext:
        allowPrivilegeEscalation: false
        capabilities:
          drop:
            - ALL
```

### 6.2 커스텀 Localhost 프로파일 적용

노드의 `/var/lib/kubelet/seccomp/profiles/` 디렉토리에 저장된 커스텀 프로파일을 사용하는 예제이다.

커스텀 seccomp 프로파일 (`/var/lib/kubelet/seccomp/profiles/restricted.json`):

```json
{
  "defaultAction": "SCMP_ACT_ERRNO",
  "archMap": [
    {
      "architecture": "SCMP_ARCH_X86_64",
      "subArchitectures": [
        "SCMP_ARCH_X86",
        "SCMP_ARCH_X32"
      ]
    }
  ],
  "syscalls": [
    {
      "names": [
        "accept4",
        "arch_prctl",
        "bind",
        "brk",
        "clone",
        "close",
        "connect",
        "epoll_create1",
        "epoll_ctl",
        "epoll_wait",
        "exit",
        "exit_group",
        "fcntl",
        "fstat",
        "futex",
        "getpid",
        "getsockname",
        "getsockopt",
        "listen",
        "mmap",
        "mprotect",
        "munmap",
        "nanosleep",
        "openat",
        "read",
        "recvfrom",
        "rt_sigaction",
        "rt_sigprocmask",
        "sendto",
        "setsockopt",
        "socket",
        "write",
        "writev"
      ],
      "action": "SCMP_ACT_ALLOW"
    }
  ]
}
```

Pod에서 커스텀 프로파일 사용:

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
      image: registry.example.com/app:v1.0.0
      securityContext:
        allowPrivilegeEscalation: false
        runAsNonRoot: true
        runAsUser: 1000
        capabilities:
          drop:
            - ALL
```

### 6.3 Pod 레벨 vs Container 레벨 seccomp

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: seccomp-mixed
spec:
  # Pod 레벨 seccomp: 모든 컨테이너에 기본 적용된다
  securityContext:
    seccompProfile:
      type: RuntimeDefault
  containers:
    - name: app
      image: registry.example.com/app:v1.0.0
      # Container 레벨 seccomp이 설정되지 않으면 Pod 레벨 설정이 적용된다
    - name: sidecar
      image: registry.example.com/sidecar:v1.0.0
      securityContext:
        # Container 레벨에서 별도 프로파일 지정 (Pod 레벨 설정을 오버라이드한다)
        seccompProfile:
          type: Localhost
          localhostProfile: profiles/sidecar-restricted.json
```

---

## 7. AppArmor 프로파일

### 7.1 Kubernetes 1.30+ (securityContext 방식)

Kubernetes 1.30부터 GA가 된 `securityContext.appArmorProfile` 필드를 사용하는 방식이다.

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: apparmor-pod
spec:
  containers:
    - name: app
      image: nginx:1.27
      securityContext:
        appArmorProfile:
          type: RuntimeDefault
        allowPrivilegeEscalation: false
        capabilities:
          drop:
            - ALL
```

Localhost 프로파일 사용:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: apparmor-localhost
spec:
  # 노드에 해당 AppArmor 프로파일이 로드되어 있어야 한다
  # aa-status 명령으로 확인 가능
  containers:
    - name: app
      image: registry.example.com/app:v1.0.0
      securityContext:
        appArmorProfile:
          type: Localhost
          localhostProfile: k8s-app-restrict
        allowPrivilegeEscalation: false
        runAsNonRoot: true
        capabilities:
          drop:
            - ALL
```

### 7.2 Kubernetes 1.30 미만 (어노테이션 방식)

이전 버전에서는 어노테이션을 사용한다. 어노테이션 키에 컨테이너 이름이 포함된다.

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: apparmor-annotation
  annotations:
    # 형식: container.apparmor.security.beta.kubernetes.io/<container-name>: <profile>
    container.apparmor.security.beta.kubernetes.io/app: runtime/default
    container.apparmor.security.beta.kubernetes.io/sidecar: localhost/k8s-sidecar-restrict
spec:
  containers:
    - name: app
      image: nginx:1.27
    - name: sidecar
      image: registry.example.com/sidecar:v1.0.0
```

### 7.3 AppArmor 프로파일 예시

노드에 로드되는 AppArmor 프로파일 예시 (`/etc/apparmor.d/k8s-app-restrict`):

```
#include <tunables/global>

profile k8s-app-restrict flags=(attach_disconnected,mediate_deleted) {
  #include <abstractions/base>

  # 네트워크 접근 허용
  network inet tcp,
  network inet udp,
  network inet icmp,

  # 파일 접근 제한
  deny /etc/shadow r,
  deny /etc/passwd w,
  deny /proc/*/mem rw,

  # 실행 허용 경로
  /usr/bin/** ix,
  /app/** ix,

  # 읽기 허용 경로
  /etc/app/** r,
  /tmp/** rw,

  # 쓰기 허용 경로
  /var/log/app/** w,

  # 나머지는 거부
  deny /** w,
}
```

---

## 8. OPA Gatekeeper

### 8.1 ConstraintTemplate + Constraint: Required Labels

네임스페이스에 특정 라벨이 필수로 존재해야 하는 정책이다.

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
              description: "필수 라벨 목록이다."
            message:
              type: string
              description: "위반 시 표시할 메시지이다."
  targets:
    - target: admission.k8s.gatekeeper.sh
      rego: |
        package k8srequiredlabels

        violation[{"msg": msg}] {
          provided := {label | input.review.object.metadata.labels[label]}
          required := {label | label := input.parameters.labels[_]}
          missing := required - provided
          count(missing) > 0
          def_msg := sprintf("필수 라벨이 누락되었습니다: %v", [missing])
          msg := object.get(input.parameters, "message", def_msg)
        }
```

#### Constraint

```yaml
apiVersion: constraints.gatekeeper.sh/v1beta1
kind: K8sRequiredLabels
metadata:
  name: require-team-label
spec:
  enforcementAction: deny  # deny, dryrun, warn 중 선택
  match:
    kinds:
      - apiGroups: [""]
        kinds: ["Namespace"]
      - apiGroups: ["apps"]
        kinds: ["Deployment"]
    excludedNamespaces:
      - kube-system
      - kube-public
      - gatekeeper-system
  parameters:
    labels:
      - "team"
      - "environment"
    message: "모든 Namespace와 Deployment에는 'team'과 'environment' 라벨이 필요합니다."
```

### 8.2 ConstraintTemplate + Constraint: Allowed Repos

허용된 컨테이너 이미지 레지스트리만 사용하도록 강제하는 정책이다.

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
              description: "허용된 이미지 레지스트리 접두사 목록이다."
  targets:
    - target: admission.k8s.gatekeeper.sh
      rego: |
        package k8sallowedrepos

        violation[{"msg": msg}] {
          container := input.review.object.spec.containers[_]
          not image_allowed(container.image)
          msg := sprintf("컨테이너 '%v'의 이미지 '%v'는 허용된 레지스트리에서 가져온 것이 아닙니다. 허용된 레지스트리: %v", [container.name, container.image, input.parameters.repos])
        }

        violation[{"msg": msg}] {
          container := input.review.object.spec.initContainers[_]
          not image_allowed(container.image)
          msg := sprintf("initContainer '%v'의 이미지 '%v'는 허용된 레지스트리에서 가져온 것이 아닙니다. 허용된 레지스트리: %v", [container.name, container.image, input.parameters.repos])
        }

        violation[{"msg": msg}] {
          container := input.review.object.spec.ephemeralContainers[_]
          not image_allowed(container.image)
          msg := sprintf("ephemeralContainer '%v'의 이미지 '%v'는 허용된 레지스트리에서 가져온 것이 아닙니다. 허용된 레지스트리: %v", [container.name, container.image, input.parameters.repos])
        }

        image_allowed(image) {
          repo := input.parameters.repos[_]
          startswith(image, repo)
        }
```

#### Constraint

```yaml
apiVersion: constraints.gatekeeper.sh/v1beta1
kind: K8sAllowedRepos
metadata:
  name: allowed-repos
spec:
  enforcementAction: deny
  match:
    kinds:
      - apiGroups: [""]
        kinds: ["Pod"]
      - apiGroups: ["apps"]
        kinds: ["Deployment", "StatefulSet", "DaemonSet"]
    excludedNamespaces:
      - kube-system
      - kube-public
      - gatekeeper-system
  parameters:
    repos:
      - "registry.example.com/"
      - "gcr.io/my-project/"
      - "docker.io/library/"
```

### 8.3 ConstraintTemplate + Constraint: 컨테이너 리소스 제한 필수

모든 컨테이너에 리소스 limits가 설정되어 있어야 하는 정책이다.

#### ConstraintTemplate

```yaml
apiVersion: templates.gatekeeper.sh/v1
kind: ConstraintTemplate
metadata:
  name: k8scontainerresourcelimits
spec:
  crd:
    spec:
      names:
        kind: K8sContainerResourceLimits
      validation:
        openAPIV3Schema:
          type: object
          properties:
            requiredLimits:
              type: array
              items:
                type: string
              description: "필수 리소스 제한 목록이다 (cpu, memory)."
  targets:
    - target: admission.k8s.gatekeeper.sh
      rego: |
        package k8scontainerresourcelimits

        violation[{"msg": msg}] {
          container := input.review.object.spec.containers[_]
          required := input.parameters.requiredLimits[_]
          not container.resources.limits[required]
          msg := sprintf("컨테이너 '%v'에 리소스 limits.%v가 설정되어 있지 않습니다.", [container.name, required])
        }
```

#### Constraint

```yaml
apiVersion: constraints.gatekeeper.sh/v1beta1
kind: K8sContainerResourceLimits
metadata:
  name: require-resource-limits
spec:
  enforcementAction: deny
  match:
    kinds:
      - apiGroups: [""]
        kinds: ["Pod"]
    excludedNamespaces:
      - kube-system
  parameters:
    requiredLimits:
      - "cpu"
      - "memory"
```

---

## 9. ServiceAccount 보안 설정

### 9.1 전용 ServiceAccount 생성 및 토큰 마운트 비활성화

```yaml
# 전용 ServiceAccount 생성
apiVersion: v1
kind: ServiceAccount
metadata:
  name: app-sa
  namespace: production
automountServiceAccountToken: false  # SA 레벨에서 토큰 마운트 비활성화
---
# Pod에서 전용 ServiceAccount 사용
apiVersion: v1
kind: Pod
metadata:
  name: secure-app
  namespace: production
spec:
  serviceAccountName: app-sa
  automountServiceAccountToken: false  # Pod 레벨에서도 명시적으로 비활성화
  containers:
    - name: app
      image: registry.example.com/app:v1.0.0
```

### 9.2 TokenRequest API를 통한 시간 제한 토큰

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: app-with-token
  namespace: production
spec:
  serviceAccountName: app-sa
  containers:
    - name: app
      image: registry.example.com/app:v1.0.0
      volumeMounts:
        - name: sa-token
          mountPath: /var/run/secrets/tokens
          readOnly: true
  volumes:
    - name: sa-token
      projected:
        sources:
          - serviceAccountToken:
              audience: api         # 토큰 대상
              expirationSeconds: 3600  # 1시간 후 만료
              path: token
```

---

## 10. Falco 규칙 예제

### 10.1 커스텀 Falco 규칙

```yaml
# /etc/falco/rules.d/custom-rules.yaml

# 컨테이너 내에서 쉘이 실행되면 감지한다
- rule: Shell in Container
  desc: 컨테이너 내에서 쉘이 실행되었다
  condition: >
    spawned_process and
    container and
    proc.name in (bash, sh, zsh, dash, ksh) and
    not proc.pname in (cron, crond)
  output: >
    컨테이너에서 쉘이 실행됨
    (user=%user.name container_id=%container.id container_name=%container.name
     shell=%proc.name parent=%proc.pname cmdline=%proc.cmdline
     image=%container.image.repository:%container.image.tag)
  priority: WARNING
  tags: [container, shell, mitre_execution]

# 민감한 파일 접근 감지
- rule: Read Sensitive File in Container
  desc: 컨테이너 내에서 민감한 파일이 읽혔다
  condition: >
    open_read and
    container and
    fd.name in (/etc/shadow, /etc/sudoers, /etc/pam.conf) and
    not proc.name in (systemd, sshd)
  output: >
    민감한 파일 접근 감지
    (user=%user.name file=%fd.name container=%container.name
     image=%container.image.repository)
  priority: CRITICAL
  tags: [container, filesystem, mitre_credential_access]

# 예상치 못한 아웃바운드 네트워크 연결 감지
- rule: Unexpected Outbound Connection
  desc: 컨테이너에서 예상치 못한 외부 연결이 발생했다
  condition: >
    outbound and
    container and
    not fd.sip.name in (dns_servers) and
    not k8s.ns.name in (kube-system, monitoring)
  output: >
    예상치 못한 아웃바운드 연결
    (command=%proc.cmdline connection=%fd.name container=%container.name
     namespace=%k8s.ns.name pod=%k8s.pod.name)
  priority: NOTICE
  tags: [container, network, mitre_command_and_control]
```

---

## 참고

- 모든 YAML 예제는 실제 클러스터에 적용하기 전에 검증 환경에서 테스트하는 것을 권장한다.
- `kubectl apply --dry-run=server -f <file>` 명령으로 적용 전 검증이 가능하다.
- OPA Gatekeeper는 별도 설치가 필요하다(`kubectl apply -f https://raw.githubusercontent.com/open-policy-agent/gatekeeper/master/deploy/gatekeeper.yaml`).
