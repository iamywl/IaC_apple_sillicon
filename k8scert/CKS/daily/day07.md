# CKS Day 7: Minimize Microservice Vulnerabilities (1/2) - PSS, SecurityContext, Gatekeeper, Encryption, RuntimeClass, mTLS

> 학습 목표 | CKS 도메인: Minimize Microservice Vulnerabilities (20%) | 예상 소요 시간: 2시간

---

## 오늘의 학습 목표

- Pod Security Standards (Privileged/Baseline/Restricted)를 이해하고 네임스페이스에 적용한다
- SecurityContext 심화 설정을 마스터한다
- OPA Gatekeeper와 Kyverno 정책 엔진을 이해한다
- Secret 관리와 Encryption at Rest를 설정한다
- RuntimeClass(gVisor/Kata)를 이해하고 적용한다
- Istio mTLS를 이해한다

---

## 1. Pod Security Standards 완전 정복

### 1.0 PSS 등장 배경

```
PodSecurityPolicy(PSP)의 한계와 PSS로의 전환
═════════════════════════════════════════════

K8s v1.0~v1.24: PodSecurityPolicy(PSP) Admission Controller
  한계:
  - PSP는 RBAC와 결합된 복잡한 인가 모델이었다
  - 어떤 PSP가 적용되는지 예측하기 어려웠다 (다중 PSP 우선순위 문제)
  - 정책 위반 시 에러 메시지가 불친절했다
  - dry-run/warn 모드가 없어 점진적 도입이 불가능했다
  - v1.21에서 deprecated, v1.25에서 완전 제거되었다

K8s v1.22+: Pod Security Admission(PSA)
  개선점:
  - 네임스페이스 라벨 기반의 직관적 정책 모델이다
  - enforce/audit/warn 3가지 모드로 점진적 도입이 가능하다
  - 3단계 보안 레벨(Privileged/Baseline/Restricted)로 표준화되었다
  - 빌트인 Admission Controller로 별도 설치가 불필요하다

공격-방어 매핑:
  공격 벡터                         → PSS 방어
  ──────────────────────────────── → ──────────────────────────────
  privileged 컨테이너로 호스트 접근  → Baseline에서 차단
  hostPID로 호스트 프로세스 접근     → Baseline에서 차단
  setuid로 root 권한 획득          → Restricted에서 차단
  root UID로 컨테이너 실행          → Restricted(runAsNonRoot)에서 차단
  모든 capability로 커널 조작       → Restricted(drop ALL)에서 차단
```

### 1.1 Pod Security Standards 정책 모델

```
Pod Security Standards(PSS) - 빌트인 Admission 기반 보안 정책
═══════════════════════════════════════════════════════════════

PSS는 Kubernetes에서 정의한 3단계 보안 프로파일로, Pod의 securityContext 필드에
대한 유효성 검증 규칙을 표준화한 것이다. Pod Security Admission 컨트롤러가
네임스페이스 레이블을 기반으로 이 규칙을 enforce/audit/warn 모드로 적용한다.

3단계 보안 레벨:
  - Privileged: 제한 없음. hostNetwork, hostPID, privileged: true 등 모두 허용.
    → 시스템 데몬, CNI 플러그인 등 호스트 수준 접근이 필수인 워크로드에 사용
  - Baseline: 알려진 권한 상승 경로를 차단. hostNetwork=false, privileged=false 강제.
    → 일반 워크로드의 기본 정책. 대부분의 컨테이너화된 애플리케이션과 호환
  - Restricted: 최소 권한 원칙(PoLP) 적용. runAsNonRoot, drop ALL capabilities,
    readOnlyRootFilesystem, seccomp RuntimeDefault 강제.
    → 보안 민감 프로덕션 워크로드에 적용

K8s 1.25 이전: PodSecurityPolicy(PSP) Admission Controller → v1.25에서 제거
K8s 1.25+: Pod Security Admission(빌트인 Admission Controller)으로 대체
```

### 1.2 세 가지 보안 레벨 상세

```
Privileged 레벨
═══════════════
제한: 없음 (모든 것 허용)
사용 사례: kube-system, CNI 플러그인, 모니터링 에이전트

Baseline 레벨
═════════════
차단하는 항목:
  - hostNetwork: true     → 호스트 네트워크 스택 직접 사용
  - hostPID: true         → 호스트 PID 네임스페이스 공유
  - hostIPC: true         → 호스트 IPC 네임스페이스 공유
  - privileged: true      → 모든 권한을 가진 특권 컨테이너
  - hostPath 볼륨         → 호스트 파일시스템 직접 마운트
  - hostPort 사용         → 호스트 포트 직접 바인딩
  - 위험한 capabilities:
    - SYS_ADMIN, NET_ADMIN, SYS_PTRACE 등
    - NET_RAW는 Baseline에서 허용 (Restricted에서 차단)

Restricted 레벨 (CKS에서 가장 중요)
═══════════════════════════════════
Baseline의 모든 제한 + 추가 요구사항:
  - runAsNonRoot: true 필수         → root로 실행 금지
  - allowPrivilegeEscalation: false → 권한 상승 금지
  - seccompProfile: RuntimeDefault 또는 Localhost 필수
  - capabilities: ALL drop 후 필요한 것만 add
  - 볼륨 타입 제한 (configMap, emptyDir, secret, projected만 허용)
  - readOnlyRootFilesystem 권장 (필수는 아님)
```

### 1.3 Pod Security Admission - 세 가지 모드

```
Pod Security Admission 모드
════════════════════════════

모드      | 동작                     | 사용 시기
──────────┼─────────────────────────┼──────────────────
enforce   | 위반 Pod 생성 거부       | 프로덕션 (강제 적용)
audit     | 감사 로그에 기록          | 모니터링 (Pod는 생성됨)
warn      | 경고 메시지 표시          | 마이그레이션 (Pod는 생성됨)

점진적 전환 전략:
  1단계: enforce=baseline + warn=restricted
         → 기본 보안 적용, Restricted 위반 시 경고
  2단계: 경고 내용 확인 후 Pod 수정
  3단계: enforce=restricted
         → 최고 보안 적용
```

### 1.4 네임스페이스에 Pod Security 적용

```bash
# 방법 1: kubectl label (imperative - 시험에서 빠름)
kubectl label namespace production \
  pod-security.kubernetes.io/enforce=restricted \
  pod-security.kubernetes.io/enforce-version=latest \
  pod-security.kubernetes.io/audit=restricted \
  pod-security.kubernetes.io/warn=restricted
```

```yaml
# 방법 2: YAML (declarative)
apiVersion: v1
kind: Namespace
metadata:
  name: production
  labels:
    pod-security.kubernetes.io/enforce: restricted
    # ↑ enforce 모드: Restricted 레벨 강제 적용
    # 위반하는 Pod는 생성이 거부된다
    pod-security.kubernetes.io/enforce-version: latest
    # ↑ 버전: latest = 클러스터의 K8s 버전에 맞는 최신 정책
    # 특정 버전 고정도 가능: v1.28, v1.31 등
    pod-security.kubernetes.io/audit: restricted
    # ↑ audit 모드: 감사 로그에 기록
    pod-security.kubernetes.io/warn: restricted
    # ↑ warn 모드: kubectl 출력에 경고 표시
```

### 1.5 Restricted 준수 Pod YAML (시험 필수 암기)

```yaml
# ═══════════════════════════════════════════
# Restricted 레벨을 준수하는 완전한 Pod YAML
# CKS 시험에서 이 패턴을 외워야 한다!
# ═══════════════════════════════════════════
apiVersion: v1
kind: Pod
metadata:
  name: compliant-pod
  namespace: production                  # Restricted가 적용된 네임스페이스
spec:
  securityContext:                       # Pod 레벨 보안 설정
    runAsNonRoot: true                   # [필수] root 실행 금지
    runAsUser: 1000                      # [권장] 실행 UID 명시
    runAsGroup: 3000                     # [권장] 실행 GID 명시
    fsGroup: 2000                        # [권장] 파일시스템 GID
    seccompProfile:
      type: RuntimeDefault              # [필수] seccomp 프로파일
                                         # RuntimeDefault 또는 Localhost
  containers:
  - name: app
    image: nginx:1.25                    # [권장] latest 태그 사용 금지
    securityContext:                     # 컨테이너 레벨 보안 설정
      allowPrivilegeEscalation: false    # [필수] 권한 상승 금지
                                         # setuid 바이너리로 root 획득 방지
      readOnlyRootFilesystem: true       # [권장] 루트 FS 읽기 전용
                                         # 악성코드가 파일시스템 수정 불가
      capabilities:
        drop: ["ALL"]                    # [필수] 모든 capability 제거
        add: ["NET_BIND_SERVICE"]        # [선택] 필요한 것만 추가
                                         # 80번 포트 바인딩에 필요
    resources:                           # [권장] 리소스 제한
      limits:
        cpu: "200m"
        memory: "128Mi"
      requests:
        cpu: "100m"
        memory: "64Mi"
    volumeMounts:                        # 쓰기 가능한 경로 마운트
    - name: tmp
      mountPath: /tmp                    # readOnlyRootFS에서 쓰기 필요한 곳
    - name: cache
      mountPath: /var/cache/nginx        # nginx 캐시 디렉토리
    - name: run
      mountPath: /var/run                # nginx PID 파일
  volumes:                               # [제한] 허용된 볼륨 타입만 사용
  - name: tmp
    emptyDir: {}                         # emptyDir: 허용됨
  - name: cache
    emptyDir:
      sizeLimit: 50Mi                    # 크기 제한 (선택)
  - name: run
    emptyDir: {}
  # hostPath: 허용 안 됨! (Restricted에서 차단)
```

### 1.6 PSA 실습 검증

```bash
# 1. 네임스페이스에 Restricted 레벨 적용
kubectl label namespace production \
  pod-security.kubernetes.io/enforce=restricted \
  pod-security.kubernetes.io/enforce-version=latest

# 2. 라벨이 적용되었는지 확인
kubectl get ns production --show-labels | grep pod-security
```

```text
production   Active   30d   pod-security.kubernetes.io/enforce=restricted,pod-security.kubernetes.io/enforce-version=latest
```

```bash
# 3. Restricted 위반 Pod 생성 시도
kubectl run bad-pod --image=nginx:alpine -n production 2>&1
```

```text
Error from server (Forbidden): pods "bad-pod" is forbidden: violates PodSecurity "restricted:latest": allowPrivilegeEscalation != false (container "bad-pod" must set securityContext.allowPrivilegeEscalation=false), unrestricted capabilities (container "bad-pod" must set securityContext.capabilities.drop=["ALL"]), runAsNonRoot != true (pod or container "bad-pod" must set securityContext.runAsNonRoot=true), seccompProfile (pod or container "bad-pod" must set securityContext.seccompProfile.type to "RuntimeDefault" or "Localhost")
```

에러 메시지에서 위반 항목(allowPrivilegeEscalation, capabilities, runAsNonRoot, seccompProfile)을 정확히 알려준다. 각 항목을 수정하여 재시도한다.

```bash
# 4. warn 모드로 기존 워크로드 위반 확인 (적용 전 사전 점검)
kubectl label namespace staging \
  pod-security.kubernetes.io/warn=restricted --dry-run=server -o yaml 2>&1
```

경고 메시지가 출력되면 해당 Pod들이 Restricted를 위반하는 것이다. enforce 전에 warn으로 먼저 점검하는 것이 안전하다.


# → 어떤 필드가 위반인지 에러 메시지에 표시된다
# → 해당 필드를 수정하여 다시 시도
```

---

## 2. SecurityContext 심화

### 2.1 SecurityContext 필드 전체 정리

```yaml
# ═══════════════════════════════════════════
# SecurityContext 전체 필드 상세 설명
# ═══════════════════════════════════════════
apiVersion: v1
kind: Pod
metadata:
  name: security-context-demo
spec:
  # === Pod 레벨 SecurityContext ===
  securityContext:
    runAsNonRoot: true               # root(UID 0)로 실행 금지
                                     # 이미지의 USER가 root이면 Pod 시작 실패
    runAsUser: 1000                  # 모든 컨테이너의 실행 UID
    runAsGroup: 3000                 # 모든 컨테이너의 실행 GID
    fsGroup: 2000                    # 볼륨의 파일 GID
                                     # emptyDir, PVC 등의 파일 소유 그룹
    supplementalGroups: [4000, 5000] # 추가 그룹 ID
    seccompProfile:
      type: RuntimeDefault           # seccomp 프로파일 (Pod 레벨)
    # sysctls:                       # 커널 파라미터 (safe sysctl만)
    # - name: net.ipv4.ip_unprivileged_port_start
    #   value: "0"

  containers:
  - name: app
    image: nginx:1.25
    # === 컨테이너 레벨 SecurityContext ===
    securityContext:
      runAsNonRoot: true             # 컨테이너별 설정 (Pod 설정 오버라이드)
      runAsUser: 1001                # 컨테이너별 UID (Pod 설정 오버라이드)
      runAsGroup: 3001               # 컨테이너별 GID
      readOnlyRootFilesystem: true   # 루트 파일시스템 읽기 전용
                                     # 쓰기: emptyDir 마운트 경로에서만 가능
      allowPrivilegeEscalation: false # 권한 상승 방지
                                     # setuid 비트 바이너리 실행 불가
                                     # no_new_privs 커널 플래그 설정
      privileged: false              # 특권 컨테이너 비활성화
                                     # true이면 호스트의 모든 장치에 접근 가능
      capabilities:
        drop: ["ALL"]                # 모든 리눅스 capability 제거
        add: ["NET_BIND_SERVICE"]    # 필요한 capability만 추가
      seccompProfile:                # 컨테이너별 seccomp (Pod 설정 오버라이드)
        type: RuntimeDefault
      appArmorProfile:               # AppArmor 프로파일 (K8s 1.30+)
        type: Localhost
        localhostProfile: k8s-deny-write
```

### 2.2 불변 컨테이너(Immutable Container) 패턴

```
불변 컨테이너(Immutable Container) - 파일시스템 무결성 보장 패턴
══════════════════════════════════════════════════════════════════

불변 컨테이너는 런타임에 컨테이너 파일시스템에 대한 쓰기 작업을 차단하여,
공격자가 악성 바이너리 주입, 설정 파일 변조, 웹셸 업로드 등의
post-exploitation 활동을 수행하는 것을 방지하는 보안 패턴이다.

구현 메커니즘:
  1. readOnlyRootFilesystem: true → 컨테이너의 rootfs를 read-only로 마운트
  2. emptyDir 볼륨으로 /tmp, /var/cache 등 쓰기 필수 경로만 선택적 마운트
  3. capabilities.drop: ["ALL"] → effective/permitted capability 셋 전체 제거
  4. allowPrivilegeEscalation: false → no_new_privs 비트 설정으로 SUID/SGID 실행 차단
```

```yaml
# 불변 컨테이너 완전한 예제
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
      readOnlyRootFilesystem: true     # 핵심: 루트 FS 읽기 전용
      allowPrivilegeEscalation: false
      capabilities:
        drop: ["ALL"]
    resources:
      limits:
        cpu: "200m"
        memory: "128Mi"
    volumeMounts:
    - name: tmp                        # nginx가 쓰기 필요한 경로들
      mountPath: /tmp
    - name: var-cache                  # 캐시 디렉토리
      mountPath: /var/cache/nginx
    - name: var-run                    # PID 파일
      mountPath: /var/run
    - name: var-log                    # 로그 디렉토리
      mountPath: /var/log/nginx
  volumes:
  - name: tmp
    emptyDir:
      sizeLimit: 100Mi                 # 크기 제한으로 디스크 채우기 공격 방지
  - name: var-cache
    emptyDir:
      sizeLimit: 50Mi
  - name: var-run
    emptyDir:
      sizeLimit: 10Mi
  - name: var-log
    emptyDir:
      sizeLimit: 100Mi
```

---

## 3. OPA Gatekeeper

### 3.1 OPA Gatekeeper란

```
OPA Gatekeeper - ValidatingAdmissionWebhook 기반 정책 엔진
══════════════════════════════════════════════════════════════

OPA Gatekeeper는 Kubernetes ValidatingAdmissionWebhook으로 등록되어,
kube-apiserver의 Admission Control 단계에서 리소스 생성/수정/삭제 요청을
가로채어 OPA(Open Policy Agent)의 Rego 언어로 작성된 정책을 평가한다.
정책 위반 시 해당 API 요청을 DENY하여 클러스터에 반영되지 않도록 한다.

아키텍처:
  kube-apiserver → ValidatingWebhook 호출 → Gatekeeper Controller
    → OPA 엔진이 Rego 정책 평가 → ALLOW/DENY 응답 반환

CRD 구조:
  ConstraintTemplate: Rego로 정책 로직을 정의하는 템플릿 CRD.
    spec.targets[].rego 필드에 violation[] 규칙을 작성한다.
  Constraint: ConstraintTemplate의 인스턴스 CRD.
    spec.match로 적용 대상(kinds, namespaces)을 지정하고,
    spec.parameters로 정책 파라미터 값을 주입한다.
```

### 3.2 ConstraintTemplate 작성

```yaml
# ═══════════════════════════════════════════
# 허용된 이미지 레지스트리만 허용하는 정책 템플릿
# ═══════════════════════════════════════════
apiVersion: templates.gatekeeper.sh/v1
kind: ConstraintTemplate
metadata:
  name: k8sallowedrepos                   # 반드시 소문자
spec:
  crd:
    spec:
      names:
        kind: K8sAllowedRepos              # Constraint에서 사용할 kind 이름
      validation:
        openAPIV3Schema:                   # 파라미터 스키마 정의
          type: object
          properties:
            repos:                         # 허용할 레지스트리 목록
              type: array
              items:
                type: string
  targets:
  - target: admission.k8s.gatekeeper.sh   # Admission webhook 타겟
    rego: |
      # Rego 언어로 정책 로직 작성
      package k8sallowedrepos

      # violation 규칙: 위반 조건과 메시지 정의
      violation[{"msg": msg}] {
        container := input.review.object.spec.containers[_]
        # ↑ 모든 컨테이너를 순회
        not startswith_any(container.image, input.parameters.repos)
        # ↑ 이미지가 허용된 레지스트리로 시작하지 않으면 위반
        msg := sprintf("이미지 '%v'는 허용된 레지스트리에 없습니다. 허용: %v",
          [container.image, input.parameters.repos])
      }

      # initContainer도 검사
      violation[{"msg": msg}] {
        container := input.review.object.spec.initContainers[_]
        not startswith_any(container.image, input.parameters.repos)
        msg := sprintf("initContainer 이미지 '%v'는 허용되지 않습니다",
          [container.image])
      }

      # 헬퍼 함수: 문자열이 주어진 접두사 중 하나로 시작하는지 확인
      startswith_any(str, prefixes) {
        prefix := prefixes[_]
        startswith(str, prefix)
      }
```

### 3.3 Constraint 작성

```yaml
# ═══════════════════════════════════════════
# 허용된 레지스트리 정책 인스턴스
# ═══════════════════════════════════════════
apiVersion: constraints.gatekeeper.sh/v1beta1
kind: K8sAllowedRepos                       # ConstraintTemplate의 kind
metadata:
  name: allowed-repos
spec:
  enforcementAction: deny                   # deny: 위반 시 거부
                                            # dryrun: 로그만 기록
                                            # warn: 경고만
  match:
    kinds:
    - apiGroups: [""]
      kinds: ["Pod"]                        # Pod 생성 시 검사
    - apiGroups: ["apps"]
      kinds: ["Deployment", "StatefulSet"]  # Deployment, StatefulSet도 검사
    namespaces: ["production", "staging"]   # 특정 네임스페이스만
    excludedNamespaces: ["kube-system"]     # 제외할 네임스페이스
  parameters:
    repos:
    - "docker.io/library/"                  # Docker Hub 공식 이미지
    - "gcr.io/my-company/"                  # 회사 GCR
    - "registry.internal.company.com/"       # 사내 레지스트리
```

### 3.4 필수 라벨 강제 정책

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
        msg := sprintf("필수 라벨 누락: %v", [missing])
      }
---
apiVersion: constraints.gatekeeper.sh/v1beta1
kind: K8sRequiredLabels
metadata:
  name: require-team-label
spec:
  match:
    kinds:
    - apiGroups: [""]
      kinds: ["Namespace"]
  parameters:
    labels:
    - "team"
    - "environment"
```

---

## 4. Secret 관리와 Encryption at Rest

### 4.1 Secret 보안의 중요성

```
Secret Encryption at Rest - etcd 저장 시 암호화 메커니즘
═══════════════════════════════════════════════════════════

Kubernetes Secret은 기밀 데이터(credential, API key, TLS 인증서)를 저장하는 리소스이다.

기본 상태의 저장 방식:
  - etcd에 base64 인코딩된 형태로 저장 (인코딩은 암호화가 아니다)
  - base64는 가역적 인코딩이므로, etcd에 직접 접근하면 모든 Secret 원문을 복원할 수 있다
  - etcd 데이터 디렉토리 또는 etcd API를 통한 비인가 접근이 직접적 위협이 된다

Encryption at Rest 메커니즘:
  - kube-apiserver의 --encryption-provider-config 플래그로 EncryptionConfiguration을 지정
  - etcd에 쓰기 전에 지정된 프로바이더(aescbc, aesgcm, secretbox 등)로 암호화
  - etcd에서 읽을 때 kube-apiserver가 복호화 → etcd 직접 접근 시 암호문만 노출
  - 암호화 키는 EncryptionConfiguration의 secret 필드 또는 KMS 프로바이더를 통해 관리
```

### 4.2 EncryptionConfiguration 작성

```yaml
# /etc/kubernetes/encryption-config.yaml
# ─────────────────────────────────────
apiVersion: apiserver.config.k8s.io/v1
kind: EncryptionConfiguration
resources:
  - resources:
    - secrets                            # Secret 리소스를 암호화
    providers:                           # 암호화 프로바이더 (순서 중요!)
    - aescbc:                            # AES-CBC 암호화 (CKS에서 주로 출제)
        keys:
        - name: key1                     # 키 이름
          secret: dGhpcyBpcyBhIDMyIGJ5dGUga2V5IGZvciBhZXNjYmM=
          # ↑ 32바이트 랜덤 키를 base64 인코딩한 값
          # 생성: head -c 32 /dev/urandom | base64
    - identity: {}                       # 암호화하지 않는 프로바이더
                                         # 마지막에 두어야 기존 데이터 읽기 가능!
                                         # 새 데이터: aescbc로 암호화
                                         # 기존 데이터: identity로 읽기 (평문)
```

```
프로바이더 순서의 의미:
═══════════════════════

providers 목록에서:
  - 첫 번째 프로바이더 = 새 데이터를 쓸 때 사용하는 암호화 방식
  - 나머지 프로바이더 = 기존 데이터를 읽을 때 시도하는 방식

[aescbc, identity] 순서:
  - 새 Secret 생성 → aescbc로 암호화하여 etcd에 저장
  - 기존 Secret 읽기 → aescbc로 시도, 실패하면 identity(평문)로 시도

[identity, aescbc] 순서:
  - 새 Secret 생성 → 평문으로 etcd에 저장 (암호화 안 됨!)
  - → 순서 바뀌면 암호화가 작동하지 않는다!
```

### 4.3 API Server에 적용

```bash
# 1. 암호화 키 생성
ENCRYPTION_KEY=$(head -c 32 /dev/urandom | base64)
echo $ENCRYPTION_KEY

# 2. EncryptionConfiguration 파일 작성
sudo tee /etc/kubernetes/encryption-config.yaml > /dev/null <<EOF
apiVersion: apiserver.config.k8s.io/v1
kind: EncryptionConfiguration
resources:
  - resources:
    - secrets
    providers:
    - aescbc:
        keys:
        - name: key1
          secret: ${ENCRYPTION_KEY}
    - identity: {}
EOF

# 3. API Server 매니페스트에 추가
# --encryption-provider-config=/etc/kubernetes/encryption-config.yaml
# + volumeMounts + volumes 추가

# 4. API Server 재시작 대기
watch crictl ps | grep kube-apiserver

# 5. 기존 Secret 재암호화 (중요!)
kubectl get secrets --all-namespaces -o json | kubectl replace -f -

# 6. 암호화 검증
ETCDCTL_API=3 etcdctl \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key \
  get /registry/secrets/default/my-secret | hexdump -C
```

암호화 성공 시 기대 출력:
```text
00000000  2f 72 65 67 69 73 74 72  79 2f 73 65 63 72 65 74  |/registry/secret|
00000010  73 2f 64 65 66 61 75 6c  74 2f 6d 79 2d 73 65 63  |s/default/my-sec|
00000020  72 65 74 0a 6b 38 73 3a  65 6e 63 3a 61 65 73 63  |ret.k8s:enc:aesc|
00000030  62 63 3a 76 31 3a 6b 65  79 31 3a ...              |bc:v1:key1:...|
```

`k8s:enc:aescbc:v1:key1` 접두사가 보이면 암호화가 적용된 것이다. 이후 바이트는 AES-CBC 암호문이다.

암호화 미적용 시(평문 저장):
```text
00000000  ...  70 61 73 73 77 6f 72 64  |...password|
```

평문이 그대로 보이면 Encryption at Rest가 적용되지 않은 것이다.

### 4.4 Encryption at Rest 트러블슈팅

```
Secret 암호화 장애 시나리오
══════════════════════════

시나리오 1: EncryptionConfiguration 적용 후 API Server가 시작되지 않는다
  원인: encryption-config.yaml 경로 오류, YAML 문법 오류, secret 키가 유효한 base64가 아니다
  디버깅:
    crictl logs <apiserver-container-id> 2>&1 | grep "encryption"
    echo <secret-value> | base64 -d | wc -c  # 32바이트인지 확인 (aescbc)
  해결: 32바이트 랜덤 키를 base64 인코딩하여 사용한다: head -c 32 /dev/urandom | base64

시나리오 2: 기존 Secret이 여전히 평문으로 etcd에 저장되어 있다
  원인: EncryptionConfiguration은 새로 생성/수정되는 Secret에만 적용된다
  디버깅:
    etcdctl get /registry/secrets/default/<old-secret> | hexdump -C  # k8s:enc 접두사 없음
  해결: kubectl get secrets -A -o json | kubectl replace -f - 로 모든 Secret을 재암호화한다

시나리오 3: providers 순서가 [identity, aescbc]로 되어 있다
  원인: 첫 번째 프로바이더가 쓰기에 사용되므로, identity가 먼저면 평문 저장이다
  해결: [aescbc, identity] 순서로 변경하여 새 데이터는 aescbc로 암호화한다
```

---

## 5. RuntimeClass (gVisor/Kata Containers)

### 5.1 RuntimeClass란

```
RuntimeClass - OCI 런타임 수준의 워크로드 격리 메커니즘
══════════════════════════════════════════════════════════

runc (기본 OCI 런타임):
  → Linux namespace + cgroup으로 프로세스를 격리하지만, 호스트 커널을 직접 공유
  → 컨테이너 프로세스의 시스템콜이 호스트 커널로 직접 전달된다
  → 커널 취약점을 통한 컨테이너 이스케이프 시 호스트에 직접 접근 가능

gVisor (runsc):
  → 사용자 공간(user-space)에서 Linux 커널 인터페이스를 재구현한 샌드박스 런타임
  → Sentry 컴포넌트가 컨테이너의 시스템콜을 인터셉트하여 처리 (호스트 커널에 직접 전달하지 않음)
  → 호스트 커널 공격 표면을 대폭 축소하지만, 시스템콜 에뮬레이션으로 인한 성능 오버헤드 발생

Kata Containers:
  → 경량 가상 머신(microVM) 내에서 컨테이너를 실행하는 하드웨어 가상화 기반 런타임
  → QEMU/Firecracker 등 VMM 위에서 전용 게스트 커널을 구동하여 완전한 커널 격리 제공
  → 가장 강력한 격리 수준이지만 VM 부트 시간과 메모리 오버헤드가 존재
```

### 5.2 커널 수준 격리 비교

```
컨테이너 런타임별 커널 격리 수준
═══════════════════════════════

runc (기본):
  프로세스 → 시스템콜 → [호스트 커널] → 하드웨어
  격리: Linux namespace(pid, net, mnt, uts, ipc, user) + cgroup
  공격 표면: 호스트 커널의 전체 시스템콜 인터페이스(~400개)
  위험: 커널 취약점(예: CVE-2022-0185 fsconfig exploit)으로 컨테이너 이스케이프 가능

gVisor (runsc):
  프로세스 → 시스템콜 → [Sentry(사용자공간 커널)] → 제한된 시스템콜 → [호스트 커널]
  격리: Sentry가 시스템콜을 인터셉트하여 약 200개만 에뮬레이션
  공격 표면: 호스트 커널에 전달되는 시스템콜이 약 70개로 축소
  성능: 시스템콜 에뮬레이션으로 10-30% 오버헤드 (I/O 집약 워크로드에서 더 큼)

Kata Containers:
  프로세스 → 시스템콜 → [게스트 커널(microVM)] → VMM → [호스트 커널]
  격리: 하드웨어 가상화(VT-x/AMD-V)로 커널 완전 분리
  공격 표면: VM 탈출은 커널 exploit보다 훨씬 어렵다 (하이퍼바이저 공격 필요)
  성능: VM 부트 시간(~100ms), 메모리 오버헤드(~30MB)
```

### 5.3 RuntimeClass 적용

```yaml
# RuntimeClass 정의
apiVersion: node.k8s.io/v1
kind: RuntimeClass
metadata:
  name: gvisor                           # RuntimeClass 이름
handler: runsc                           # 컨테이너 런타임 핸들러 이름
                                         # containerd 설정에 정의된 이름과 일치해야!
# scheduling:                            # 선택: 이 런타임을 지원하는 노드 선택
#   nodeSelector:
#     runtime: gvisor
# overhead:                              # 선택: 런타임 오버헤드
#   podFixed:
#     memory: "64Mi"
---
# Pod에 RuntimeClass 적용
apiVersion: v1
kind: Pod
metadata:
  name: sandboxed-pod
spec:
  runtimeClassName: gvisor               # RuntimeClass 이름 지정
  containers:
  - name: app
    image: nginx:1.25
    securityContext:
      allowPrivilegeEscalation: false
      runAsNonRoot: true
      runAsUser: 1000
```

---

## 6. Istio mTLS

### 6.1 mTLS란

```
mTLS(Mutual TLS) - 양방향 X.509 인증서 기반 인증 및 암호화
══════════════════════════════════════════════════════════════

일반 TLS(단방향): 클라이언트가 서버의 X.509 인증서를 검증하여 서버 인증만 수행.
  → 서버 인증서의 Subject/SAN을 CA 체인으로 검증하고 TLS handshake를 완료한다.

mTLS(양방향): TLS handshake 과정에서 서버가 클라이언트에게도 인증서를 요구한다.
  → 서버 → 클라이언트: CertificateRequest 메시지 전송
  → 클라이언트 → 서버: 자신의 X.509 인증서 + CertificateVerify 서명 전송
  → 양측 모두 상대방의 인증서를 CA 체인으로 검증 → 상호 인증 + 채널 암호화

Istio 서비스 메시의 mTLS 구현:
  - Istiod(citadel)가 각 워크로드에 SPIFFE 형식의 X.509 SVID 인증서를 자동 발급
  - 사이드카 프록시(Envoy)가 애플리케이션 트래픽을 인터셉트하여 mTLS handshake 수행
  - 애플리케이션 코드 수정 없이 Pod 간 통신의 인증 + 기밀성 + 무결성을 보장
```

### 6.2 PeerAuthentication 설정

```yaml
# 전역 STRICT mTLS (모든 네임스페이스에 적용)
apiVersion: security.istio.io/v1beta1
kind: PeerAuthentication
metadata:
  name: default
  namespace: istio-system               # istio-system에 두면 전역 적용
spec:
  mtls:
    mode: STRICT                         # mTLS만 허용, 평문 거부!
---
# 네임스페이스별 적용
apiVersion: security.istio.io/v1beta1
kind: PeerAuthentication
metadata:
  name: default
  namespace: demo                        # 특정 네임스페이스에 적용
spec:
  mtls:
    mode: STRICT
---
# 특정 워크로드에만 PERMISSIVE 적용 (마이그레이션용)
apiVersion: security.istio.io/v1beta1
kind: PeerAuthentication
metadata:
  name: legacy-service
  namespace: demo
spec:
  selector:
    matchLabels:
      app: legacy-app                    # 레거시 앱만 PERMISSIVE
  mtls:
    mode: PERMISSIVE                     # mTLS + 평문 모두 허용
```

```
mTLS 모드:
══════════

STRICT:     mTLS만 허용. 사이드카 없는 Pod에서의 접근 차단
PERMISSIVE: mTLS + 평문 모두 허용 (마이그레이션 단계)
DISABLE:    mTLS 비활성화 (비권장)

CKS 시험에서:
  - PeerAuthentication의 mode를 확인/변경하는 문제
  - STRICT로 설정하라는 문제가 자주 나옴
```

### 6.3 mTLS 실습 검증

```bash
# PeerAuthentication 설정 확인
kubectl get peerauthentication -A
```

```text
NAMESPACE      NAME      MODE     AGE
istio-system   default   STRICT   30d
```

```bash
# STRICT 모드에서 사이드카 없는 Pod로 접근 시도
kubectl run no-sidecar --image=busybox --restart=Never -n default \
  --labels="sidecar.istio.io/inject=false" -- wget -qO- --timeout=3 http://httpbin.demo:8000/get 2>&1
```

```text
wget: error getting response: Connection reset by peer
```

사이드카가 없는 Pod에서 보낸 평문 요청은 Envoy가 mTLS handshake 실패로 거부한다.

```bash
# 사이드카가 있는 Pod에서 접근 (성공해야 한다)
kubectl exec -n demo deploy/nginx -c app -- curl -s http://httpbin:8000/get | head -5
```

```text
{
  "args": {},
  "headers": {
    "Host": "httpbin:8000",
    "X-Forwarded-Client-Cert": "By=spiffe://cluster.local/ns/demo/sa/httpbin;..."
```

X-Forwarded-Client-Cert 헤더에 SPIFFE URI가 포함되어 있으면 mTLS가 정상 동작하는 것이다.

### 6.4 Microservice Vulnerabilities 트러블슈팅

```
Minimize Microservice Vulnerabilities 장애 시나리오
════════════════════════════════════════════════════

시나리오 1: Restricted 네임스페이스에서 기존 Deployment가 업데이트 안 된다
  에러: "violates PodSecurity restricted: ..."
  원인: 기존 Pod는 enforce 적용 전에 생성되어 실행 중이지만, 새 Pod 생성 시 PSA가 검증한다
  해결: Pod template의 securityContext를 Restricted 준수하도록 수정한다

시나리오 2: readOnlyRootFilesystem: true 설정 후 애플리케이션이 크래시한다
  원인: 애플리케이션이 /tmp, /var/cache 등에 임시 파일을 쓰려고 하는데 읽기 전용이다
  디버깅:
    kubectl logs <pod>  # "Read-only file system" 에러 확인
  해결: 쓰기가 필요한 경로에 emptyDir 볼륨을 마운트한다

시나리오 3: OPA Gatekeeper 정책이 적용되지 않는다
  원인: ConstraintTemplate은 있지만 Constraint 인스턴스가 없다
  디버깅:
    kubectl get constrainttemplates  # 템플릿 확인
    kubectl get constraints          # 인스턴스 확인 (비어 있으면 미적용)
  해결: Constraint를 생성하여 match 조건과 parameters를 지정한다

시나리오 4: RuntimeClass gvisor를 지정했는데 Pod가 Pending 상태이다
  원인: 노드에 runsc 핸들러가 설치/설정되어 있지 않다
  디버깅:
    kubectl describe pod <pod>  # Events에서 "handler not found" 확인
  해결: containerd config.toml에 runsc 핸들러를 등록하고 containerd를 재시작한다
```

---

---

## tart-infra 실습

### 실습 환경 설정

```bash
# dev 클러스터 접속 (Istio mTLS STRICT + CiliumNetworkPolicy 적용)
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/dev.yaml
kubectl config current-context
# dev

kubectl get ns demo
# NAME   STATUS   AGE
# demo   Active   ...
```

---

### 실습 1: demo 네임스페이스 Pod의 SecurityContext 보안 감사

demo 네임스페이스의 모든 Pod에 적용된 SecurityContext 설정을 점검하고, Restricted 레벨 준수 여부를 확인한다.

```bash
# 모든 Pod의 SecurityContext 설정 확인
kubectl get pods -n demo -o jsonpath='{range .items[*]}
Pod: {.metadata.name}
  runAsNonRoot: {.spec.securityContext.runAsNonRoot}
  runAsUser: {.spec.securityContext.runAsUser}
  seccomp: {.spec.securityContext.seccompProfile.type}
{range .spec.containers[*]}  Container: {.name}
    allowPrivilegeEscalation: {.securityContext.allowPrivilegeEscalation}
    readOnlyRootFilesystem: {.securityContext.readOnlyRootFilesystem}
    capabilities.drop: {.securityContext.capabilities.drop}
{end}{end}'
```

예상 출력 (일부):
```
Pod: nginx-xxxx
  runAsNonRoot: true
  runAsUser: 1000
  seccomp: RuntimeDefault
  Container: nginx
    allowPrivilegeEscalation: false
    readOnlyRootFilesystem: true
    capabilities.drop: ["ALL"]
```

```bash
# Restricted 레벨 위반 여부를 PSA dry-run으로 검증
kubectl label ns demo pod-security.kubernetes.io/warn=restricted --dry-run=server -o yaml
```

**동작 원리:**
- `--dry-run=server`는 실제로 라벨을 적용하지 않으면서 서버 측 검증을 수행한다
- 경고 메시지가 출력되면 해당 Pod가 Restricted 레벨을 위반하는 것이다
- demo 네임스페이스의 Pod들은 SecurityContext가 설정되어 있으므로, 어떤 필드가 Restricted를 준수하고 어떤 필드가 부족한지 확인할 수 있다

---

### 실습 2: Istio mTLS PeerAuthentication STRICT 모드 확인

dev 클러스터에 적용된 Istio mTLS STRICT 설정을 확인하고, 사이드카 없는 Pod에서의 접근이 차단되는지 검증한다.

```bash
# PeerAuthentication 정책 확인
kubectl get peerauthentication -A
# NAMESPACE      NAME      MODE     AGE
# istio-system   default   STRICT   ...

# PeerAuthentication 상세 내용 확인
kubectl get peerauthentication default -n istio-system -o yaml
```

예상 출력:
```yaml
apiVersion: security.istio.io/v1beta1
kind: PeerAuthentication
metadata:
  name: default
  namespace: istio-system
spec:
  mtls:
    mode: STRICT
```

```bash
# mTLS 인증서 정보 확인 (사이드카가 있는 Pod에서)
kubectl exec -n demo deploy/nginx -c istio-proxy -- \
  openssl s_client -connect httpbin:8000 -showcerts 2>/dev/null | \
  openssl x509 -noout -subject -issuer 2>/dev/null
# subject=O = cluster.local (SPIFFE 인증서)
```

**동작 원리:**
- `PeerAuthentication`이 istio-system에 STRICT로 설정되면 전역 적용된다
- STRICT 모드에서는 Envoy 사이드카가 모든 인바운드 트래픽에 대해 클라이언트 인증서를 요구한다
- Istiod(citadel)가 각 워크로드에 SPIFFE 형식의 X.509 SVID 인증서를 자동 발급하고 주기적으로 갱신한다
- 사이드카가 없는 Pod에서 보내는 평문 요청은 mTLS handshake에 실패하여 연결이 거부된다

---

### 실습 3: CiliumNetworkPolicy Zero Trust L7 정책 확인

dev 클러스터에 적용된 11개 CiliumNetworkPolicy의 L3/L4/L7 규칙을 분석하여 Zero Trust 네트워크 보안 체계를 이해한다.

```bash
# CiliumNetworkPolicy 전체 목록 확인
kubectl get ciliumnetworkpolicy -n demo
# NAME                    AGE
# allow-dns               ...
# allow-nginx-ingress     ...
# allow-httpbin-internal  ...
# ...  (총 11개)

# L7 HTTP 규칙이 포함된 정책 확인
kubectl get ciliumnetworkpolicy -n demo -o jsonpath='{range .items[*]}
Policy: {.metadata.name}
  Endpoint Selector: {.spec.endpointSelector}
  Ingress Rules: {.spec.ingress}
  Egress Rules: {.spec.egress}
---{end}'
```

```bash
# 특정 정책의 L7 규칙 상세 확인
kubectl get ciliumnetworkpolicy allow-httpbin-internal -n demo -o yaml | \
  grep -A 20 "rules:"
```

예상 출력 (예시):
```yaml
rules:
  http:
  - method: GET
    path: "/status/.*"
  - method: GET
    path: "/headers"
```

**동작 원리:**
- CiliumNetworkPolicy는 Kubernetes 기본 NetworkPolicy와 달리 L7(HTTP method, path) 수준의 필터링을 지원한다
- eBPF 데이터플레인에서 패킷을 직접 검사하므로 별도의 프록시 없이 L7 필터링이 가능하다
- Zero Trust 원칙에 따라 기본 차단(Default Deny) 후 명시적으로 허용한 트래픽만 통과시킨다
- dev 클러스터의 11개 정책은 demo 네임스페이스의 각 서비스(nginx, httpbin, PostgreSQL, Redis, RabbitMQ, Keycloak) 간 통신을 최소 권한으로 제어한다

> **내일 예고:** Day 8에서는 Minimize Microservice Vulnerabilities 도메인의 시험 출제 패턴, 실전 문제 10개, tart-infra 실습을 다룬다.
