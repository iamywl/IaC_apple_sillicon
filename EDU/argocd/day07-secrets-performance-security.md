# Day 7: Secrets 관리, 성능 최적화, 보안 강화

Sealed Secrets, External Secrets Operator, Vault 연동, ArgoCD 성능 최적화(캐싱, Sharding, Redis 튜닝), 그리고 보안 강화(네트워크 정책, TLS, RBAC, 감사 로그)를 다룬다.

---

## 12장: Secrets 관리

### 개요

Kubernetes Secret을 Git에 평문으로 저장할 수 없으므로, GitOps 환경에서 Secret 관리는 별도 도구가 필요하다. 주요 접근 방식은 다음과 같다:

```
┌──────────────────────────────────────────────────────────────┐
│                  Secret 관리 접근 방식                        │
│                                                               │
│  1. Sealed Secrets                                            │
│     - 암호화된 Secret을 Git에 저장한다                        │
│     - 클러스터 내 controller가 복호화한다                     │
│     - 단순하고 Kubernetes native이다                          │
│                                                               │
│  2. External Secrets Operator (ESO)                           │
│     - 외부 Secret Manager에서 값을 가져온다                   │
│     - AWS Secrets Manager, Vault, GCP Secret Manager 등       │
│     - Git에 Secret 값이 전혀 없다 (참조만 저장)               │
│                                                               │
│  3. argocd-vault-plugin (AVP)                                 │
│     - ArgoCD CMP로 동작한다                                   │
│     - 매니페스트 내 placeholder를 실제 값으로 치환한다        │
│     - HashiCorp Vault, AWS SM 등에서 값을 가져온다            │
│                                                               │
│  4. SOPS (Secrets OPerationS)                                 │
│     - Mozilla에서 개발한 암호화 도구이다                      │
│     - YAML/JSON 파일의 값만 선택적으로 암호화한다             │
│     - 키는 평문으로 유지하여 diff가 가능하다                  │
└──────────────────────────────────────────────────────────────┘
```

### Sealed Secrets

```yaml
# 1. kubeseal CLI로 암호화
# kubeseal --format=yaml --cert=<cert> < secret.yaml > sealed-secret.yaml

# 원본 Secret
apiVersion: v1
kind: Secret
metadata:
  name: my-secret
  namespace: my-app
type: Opaque
data:
  password: cGFzc3dvcmQxMjM=

# 암호화된 SealedSecret (Git에 저장 가능)
apiVersion: bitnami.com/v1alpha1
kind: SealedSecret
metadata:
  name: my-secret
  namespace: my-app
spec:
  encryptedData:
    password: AgBy3i4OJSWK+PiTySYZZA9rO...  # 암호화된 값

# 장점: Git에 안전하게 저장할 수 있다
# 단점: 클러스터 키 쌍에 종속적이다 (키를 분실하면 복구 불가)
# 단점: 암호화된 값은 diff로 변경 내용을 확인할 수 없다
```

### External Secrets Operator (ESO)

```yaml
# SecretStore: Secret Manager 연결 설정
apiVersion: external-secrets.io/v1beta1
kind: SecretStore
metadata:
  name: aws-secrets-manager
  namespace: my-app
spec:
  provider:
    aws:
      service: SecretsManager
      region: ap-northeast-2
      auth:
        jwt:
          serviceAccountRef:
            name: external-secrets-sa

---
# ExternalSecret: 외부 Secret을 Kubernetes Secret으로 동기화
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: my-app-secrets
  namespace: my-app
spec:
  refreshInterval: 1h                    # 동기화 주기
  secretStoreRef:
    name: aws-secrets-manager
    kind: SecretStore
  target:
    name: my-app-secrets                 # 생성될 Kubernetes Secret 이름
    creationPolicy: Owner
  data:
    - secretKey: database-password       # Kubernetes Secret의 키
      remoteRef:
        key: prod/my-app/database        # Secret Manager의 키
        property: password               # Secret Manager 내 속성

---
# 장점: Git에 Secret 값이 전혀 없다 (참조만 저장)
# 장점: Secret 로테이션을 자동화할 수 있다
# 장점: 다양한 Secret Manager를 지원한다
# 단점: 외부 Secret Manager에 대한 의존성이 생긴다
```

### argocd-vault-plugin (AVP)

```yaml
# 매니페스트에 placeholder를 사용한다
apiVersion: v1
kind: Secret
metadata:
  name: my-secret
  namespace: my-app
  annotations:
    avp.kubernetes.io/path: "secret/data/my-app"
type: Opaque
stringData:
  password: <password>          # Vault에서 가져올 키 이름
  api-key: <api-key>

# ArgoCD가 이 매니페스트를 렌더링할 때 AVP가 placeholder를 실제 값으로 치환한다
```

AVP를 CMP sidecar로 설정하는 방법:

```yaml
# argocd-repo-server에 sidecar 추가
apiVersion: apps/v1
kind: Deployment
metadata:
  name: argocd-repo-server
  namespace: argocd
spec:
  template:
    spec:
      containers:
        # 기존 repo-server 컨테이너는 유지
        # ...
      # CMP sidecar
      initContainers:
        - name: download-tools
          image: registry.example.com/argocd-vault-plugin:1.17.0
          command: [sh, -c]
          args:
            - cp /usr/local/bin/argocd-vault-plugin /custom-tools/
          volumeMounts:
            - mountPath: /custom-tools
              name: custom-tools
      volumes:
        - name: custom-tools
          emptyDir: {}
        - name: cmp-plugin
          configMap:
            name: cmp-plugin
```

### SOPS (Secrets OPerationS)

```yaml
# SOPS로 암호화된 파일 (.sops.yaml 설정 필요)
# 키(key)는 평문, 값(value)만 암호화된다
apiVersion: v1
kind: Secret
metadata:
  name: my-secret
type: Opaque
stringData:
  password: ENC[AES256_GCM,data:9sX3...,iv:abc...,tag:def...]
  api-key: ENC[AES256_GCM,data:7kY2...,iv:ghi...,tag:jkl...]
sops:
  kms:
    - arn: arn:aws:kms:ap-northeast-2:123456789:key/xxx
  gcp_kms: []
  azure_kv: []
  lastmodified: "2024-01-15T10:00:00Z"
  version: 3.8.0

# 장점: 키 이름이 평문이므로 diff로 어떤 값이 변경되었는지 확인 가능
# 장점: 다양한 KMS 백엔드를 지원한다 (AWS KMS, GCP KMS, Azure Key Vault, age, PGP)
# 단점: SOPS가 설치된 환경에서만 복호화 가능
# ArgoCD에서는 KSOPS(Kustomize + SOPS) 플러그인과 함께 사용한다
```

### Secret 관리 도구 비교

| 항목 | Sealed Secrets | ESO | AVP | SOPS |
|------|---------------|-----|-----|------|
| Git에 저장되는 것 | 암호화된 값 | 참조(경로)만 | placeholder | 암호화된 값 |
| 외부 의존성 | 없음 (클러스터 내) | Secret Manager 필요 | Vault 등 필요 | KMS 필요 |
| Secret 로테이션 | 수동 재암호화 | 자동 (refreshInterval) | 매 Sync 시 | 수동 재암호화 |
| diff 가독성 | 불가 | 좋음 (경로만 변경) | 좋음 (키만 변경) | 키 이름은 가능 |
| 설정 복잡도 | 낮음 | 중간 | 높음 | 중간 |
| ArgoCD 통합 | 자연스러움 | 자연스러움 | CMP 설정 필요 | CMP 설정 필요 |

---

## 13장: 성능 최적화

### Repo Server 캐싱 최적화

```yaml
# argocd-cmd-params-cm ConfigMap (ArgoCD 2.4+)
# 또는 Deployment의 환경변수로 설정

# Repo Server 캐싱 설정
ARGOCD_REPO_SERVER_PARALLELISM_LIMIT: "10"      # 동시 매니페스트 생성 요청 수
ARGOCD_GIT_ATTEMPTS_COUNT: "3"                   # Git 작업 재시도 횟수
ARGOCD_EXEC_TIMEOUT: "180"                       # 외부 도구 실행 타임아웃 (초)

# 매니페스트 캐시 TTL (기본 24시간)
ARGOCD_REPO_SERVER_MANIFEST_CACHE_TTL: "24h"

# Git 리포지토리 캐시 설정
ARGOCD_GIT_MODULES_ENABLED: "false"              # submodules 비활성화 (불필요하면)
ARGOCD_GIT_LS_REMOTE_PARALLELISM_LIMIT: "10"     # ls-remote 병렬 처리 수
```

### Application Controller 최적화

```yaml
# controller 환경변수

# 상태 처리 worker 수 (기본 20)
# Application 수에 비례하여 늘린다
ARGOCD_CONTROLLER_STATUS_PROCESSORS: "50"

# 작업 처리 worker 수 (기본 10)
# 동시 Sync 수를 늘리려면 이 값을 증가시킨다
ARGOCD_CONTROLLER_OPERATION_PROCESSORS: "25"

# Reconciliation 주기 (기본 180초 = 3분)
# 줄이면 더 빠르게 변경을 감지하지만 API Server 부하가 증가한다
# argocd-cm: timeout.reconciliation: "180"

# kubectl 실행 병렬도
ARGOCD_CONTROLLER_KUBECTL_PARALLELISM_LIMIT: "20"

# 리소스 캐시 크기 제한
ARGOCD_CONTROLLER_RESOURCE_CACHE_EXPIRATION: "1h"
```

### Controller Sharding (대규모 환경)

많은 Application을 관리할 때 여러 controller 인스턴스로 부하를 분산할 수 있다:

```yaml
# controller를 3개 인스턴스로 sharding
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: argocd-application-controller
  namespace: argocd
spec:
  replicas: 3            # shard 수
  template:
    spec:
      containers:
        - name: argocd-application-controller
          env:
            - name: ARGOCD_CONTROLLER_REPLICAS
              value: "3"  # 전체 replica 수
```

Sharding 방식:
- **round-robin (기본값)**: Application을 ID 기반으로 균등 분배한다
- **legacy**: 이전 방식의 해시 기반 분배이다
- 각 shard는 자신에게 할당된 Application만 관리한다

### Resource Inclusion/Exclusion

ArgoCD가 감시하는 리소스 종류를 제한하여 API Server 부하를 줄인다:

```yaml
# argocd-cm ConfigMap
data:
  # 특정 리소스만 포함 (whitelist)
  resource.inclusions: |
    - apiGroups:
        - "*"
      kinds:
        - Deployment
        - Service
        - ConfigMap
        - Secret
        - Ingress
        - StatefulSet
        - DaemonSet
        - Job
        - CronJob
        - PersistentVolumeClaim
        - HorizontalPodAutoscaler
      clusters:
        - "*"

  # 특정 리소스 제외 (blacklist)
  resource.exclusions: |
    - apiGroups:
        - "events.k8s.io"
      kinds:
        - Event
      clusters:
        - "*"
    - apiGroups:
        - "cilium.io"
      kinds:
        - CiliumIdentity
      clusters:
        - "*"
    - apiGroups:
        - "metrics.k8s.io"
      kinds:
        - "*"
      clusters:
        - "*"
```

### Redis 최적화

```yaml
# Redis 메모리 제한 증가 (대규모 환경)
redis:
  resources:
    limits:
      memory: 1Gi         # 기본 256Mi에서 증가

# Redis 설정 커스터마이징
redis:
  config:
    maxmemory-policy: allkeys-lru    # 메모리 부족 시 LRU 정책
    save: ""                         # RDB 스냅샷 비활성화 (캐시 전용)

# HA 환경에서 Redis Sentinel 사용
redis-ha:
  enabled: true
  haproxy:
    enabled: true
```

### 대규모 환경 권장 설정

```
Application 수별 권장 설정:

~50 Applications:
  - controller.statusProcessors: 20 (기본값)
  - controller.operationProcessors: 10 (기본값)
  - controller.memory: 1Gi
  - redis.memory: 256Mi

50~200 Applications:
  - controller.statusProcessors: 50
  - controller.operationProcessors: 25
  - controller.memory: 2Gi
  - redis.memory: 512Mi

200~1000 Applications:
  - controller.statusProcessors: 100
  - controller.operationProcessors: 50
  - controller.memory: 4Gi
  - redis.memory: 1Gi
  - controller sharding: 3 replicas

1000+ Applications:
  - controller.statusProcessors: 200
  - controller.operationProcessors: 100
  - controller.memory: 8Gi
  - redis.memory: 2Gi
  - controller sharding: 5+ replicas
  - repo-server replicas: 3+
  - resource.exclusions 적극 활용
```

---

## 14장: 보안 강화

### Network Policies

ArgoCD 컴포넌트 간 통신을 제한하는 NetworkPolicy를 설정한다:

```yaml
# API Server: 외부 접근만 허용
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: argocd-server-network-policy
  namespace: argocd
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/name: argocd-server
  policyTypes:
    - Ingress
  ingress:
    # 외부 클라이언트 (Web UI, CLI)
    - ports:
        - port: 8080
          protocol: TCP
        - port: 8083
          protocol: TCP
    # Repo Server, Redis만 접근 허용
    - from:
        - podSelector:
            matchLabels:
              app.kubernetes.io/part-of: argocd

---
# Repo Server: ArgoCD 컴포넌트에서만 접근 허용
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: argocd-repo-server-network-policy
  namespace: argocd
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/name: argocd-repo-server
  policyTypes:
    - Ingress
    - Egress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app.kubernetes.io/part-of: argocd
      ports:
        - port: 8081
          protocol: TCP
  egress:
    # Git 서버로의 아웃바운드만 허용
    - ports:
        - port: 443
          protocol: TCP
        - port: 22
          protocol: TCP
    # DNS
    - ports:
        - port: 53
          protocol: UDP
        - port: 53
          protocol: TCP
```

### TLS 설정

프로덕션 환경에서는 반드시 TLS를 활성화해야 한다:

```yaml
# Ingress로 TLS 종료
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: argocd-server-ingress
  namespace: argocd
  annotations:
    nginx.ingress.kubernetes.io/force-ssl-redirect: "true"
    nginx.ingress.kubernetes.io/ssl-passthrough: "true"
    nginx.ingress.kubernetes.io/backend-protocol: "HTTPS"
spec:
  tls:
    - hosts:
        - argocd.example.com
      secretName: argocd-server-tls
  rules:
    - host: argocd.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: argocd-server
                port:
                  number: 443
```

이 프로젝트에서는 개발 환경이므로 `--insecure` 플래그로 TLS 없이 HTTP를 사용한다. 프로덕션에서는 반드시 TLS를 활성화해야 한다.

### RBAC 강화

```yaml
# argocd-rbac-cm ConfigMap
apiVersion: v1
kind: ConfigMap
metadata:
  name: argocd-rbac-cm
  namespace: argocd
data:
  # 기본 정책: 인증된 사용자에게 아무 권한도 부여하지 않는다
  policy.default: ""

  # 또는 최소 읽기 권한만 부여
  # policy.default: role:readonly

  # CSV 형식의 정책
  policy.csv: |
    # 관리자
    p, role:admin, *, *, */*, allow
    g, admin, role:admin

    # 개발자: 특정 프로젝트의 Application만 조회/Sync 가능
    p, role:developer, applications, get, team-*/*, allow
    p, role:developer, applications, sync, team-*/*, allow
    p, role:developer, logs, get, team-*/*, allow
    p, role:developer, exec, create, */*, deny
    g, my-org:developers, role:developer

    # 뷰어: 조회만 가능
    p, role:viewer, applications, get, */*, allow
    p, role:viewer, clusters, get, *, allow
    p, role:viewer, repositories, get, *, allow
    p, role:viewer, projects, get, *, allow
    g, my-org:viewers, role:viewer

  # 스코프 설정 (그룹 매핑에 사용할 OIDC 클레임)
  scopes: "[groups, email]"
```

### Audit Logging

ArgoCD는 모든 API 호출과 Sync 작업을 로그로 기록한다:

```bash
# API Server 로그에서 감사 이벤트 확인
kubectl logs -n argocd deployment/argocd-server | grep "admin"

# Application Controller 로그에서 Sync 이벤트 확인
kubectl logs -n argocd statefulset/argocd-application-controller | grep "sync"

# 감사 로그 예시:
# level=info msg="admin logged in" method=POST path=/api/v1/session
# level=info msg="sync initiated" app=my-app user=admin
# level=info msg="application created" app=new-app user=admin
```

외부 로그 수집 시스템(EFK, Loki 등)으로 ArgoCD 로그를 전송하여 장기 보관하고 분석할 수 있다.

### AppProject 제한 강화

```yaml
apiVersion: argoproj.io/v1alpha1
kind: AppProject
metadata:
  name: restricted
  namespace: argocd
spec:
  # 소스 리포지토리 제한
  sourceRepos:
    - "https://github.com/org/approved-*"

  # 대상 클러스터/네임스페이스 제한
  destinations:
    - server: "https://kubernetes.default.svc"
      namespace: "team-backend-*"

  # 클러스터 스코프 리소스 완전 차단
  clusterResourceWhitelist: []

  # 위험한 네임스페이스 리소스 차단
  namespaceResourceBlacklist:
    - group: ""
      kind: ResourceQuota
    - group: ""
      kind: LimitRange
    - group: "networking.k8s.io"
      kind: NetworkPolicy     # 팀이 네트워크 정책을 변경할 수 없도록 차단

  # Orphaned Resource 모니터링
  orphanedResources:
    warn: true                # ArgoCD가 관리하지 않는 리소스 경고 표시

  # 소스 네임스페이스 제한 (ArgoCD 2.5+)
  sourceNamespaces:
    - "team-backend-*"
```

### 초기 Admin 비밀번호 관리

```bash
# 설치 후 즉시 비밀번호 변경
argocd account update-password \
  --current-password $(kubectl -n argocd get secret argocd-initial-admin-secret \
    -o jsonpath='{.data.password}' | base64 -d) \
  --new-password <새-비밀번호>

# 초기 비밀번호 Secret 삭제
kubectl -n argocd delete secret argocd-initial-admin-secret

# admin 계정 비활성화 (SSO 설정 후)
# argocd-cm ConfigMap:
# data:
#   admin.enabled: "false"
```

---

