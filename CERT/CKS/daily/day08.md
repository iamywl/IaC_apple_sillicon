# CKS Day 8: Minimize Microservice Vulnerabilities (2/2) - 시험 패턴, 실전 문제, 심화 학습

> 학습 목표 | CKS 도메인: Minimize Microservice Vulnerabilities (20%) | 예상 소요 시간: 2시간

---

## 오늘의 학습 목표

- Minimize Microservice Vulnerabilities 도메인의 CKS 시험 출제 패턴을 분석한다
- Pod Security Admission, SecurityContext, OPA Gatekeeper 관련 실전 문제 10개를 풀어본다
- tart-infra 환경에서 실습을 수행한다
- 심화 주제를 학습하여 이해를 깊게 한다

---


## 7. 이 주제가 시험에서 어떻게 나오는가

### 7.1 출제 패턴

```
Minimize Microservice Vulnerabilities 출제 패턴 (20%)
════════════════════════════════════════════════════

1. Pod Security Admission 적용 (매우 빈출)
   - "네임스페이스에 Restricted enforce를 적용하라"
   - "Restricted를 준수하는 Pod를 배포하라"
   의도: Pod 보안 표준 이해도와 YAML 작성 능력

2. SecurityContext 설정 (매우 빈출)
   - "불변 컨테이너를 설정하라"
   - "readOnlyRootFilesystem + emptyDir 패턴"
   의도: SecurityContext 필드 숙지도

3. Secret Encryption at Rest (빈출)
   - "EncryptionConfiguration을 작성하고 API Server에 적용하라"
   의도: etcd 암호화 설정 능력

4. RuntimeClass (가끔 출제)
   - "gVisor RuntimeClass를 생성하고 Pod에 적용하라"
   의도: 샌드박스 런타임 이해도

5. OPA Gatekeeper (개념 이해)
   - "ConstraintTemplate과 Constraint를 작성하라"
   의도: 정책 엔진 이해도
```

### 7.2 실전 문제 (10개 이상)

### 문제 1. Pod Security Admission 적용

`secure-ns` 네임스페이스에 Restricted 레벨의 Pod Security를 enforce 모드로 적용하라. Restricted를 준수하는 Pod를 배포하라.

<details>
<summary>풀이</summary>

```bash
kubectl create ns secure-ns
kubectl label namespace secure-ns \
  pod-security.kubernetes.io/enforce=restricted \
  pod-security.kubernetes.io/enforce-version=latest
```

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: secure-pod
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
      runAsUser: 1000
      capabilities:
        drop: ["ALL"]
      readOnlyRootFilesystem: true
    volumeMounts:
    - name: tmp
      mountPath: /tmp
  volumes:
  - name: tmp
    emptyDir: {}
```

</details>

### 문제 2. 불변 컨테이너 설정

`immutable-app` Pod를 생성하라. readOnlyRootFilesystem, runAsNonRoot, allowPrivilegeEscalation false, capabilities ALL drop을 적용하라. /tmp와 /var/cache에만 쓰기를 허용하라.

<details>
<summary>풀이</summary>

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: immutable-app
spec:
  securityContext:
    runAsNonRoot: true
    runAsUser: 1000
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
    volumeMounts:
    - name: tmp
      mountPath: /tmp
    - name: cache
      mountPath: /var/cache
  volumes:
  - name: tmp
    emptyDir: {}
  - name: cache
    emptyDir: {}
```

</details>

### 문제 3. Secret Encryption at Rest

etcd에 저장되는 Secret을 aescbc 방식으로 암호화하라.

<details>
<summary>풀이</summary>

```bash
# 키 생성
ENCRYPTION_KEY=$(head -c 32 /dev/urandom | base64)
```

```yaml
# /etc/kubernetes/encryption-config.yaml
apiVersion: apiserver.config.k8s.io/v1
kind: EncryptionConfiguration
resources:
  - resources:
    - secrets
    providers:
    - aescbc:
        keys:
        - name: key1
          secret: <ENCRYPTION_KEY>
    - identity: {}
```

API Server에 적용:
```yaml
- --encryption-provider-config=/etc/kubernetes/encryption-config.yaml

volumeMounts:
- name: encryption-config
  mountPath: /etc/kubernetes/encryption-config.yaml
  readOnly: true
volumes:
- name: encryption-config
  hostPath:
    path: /etc/kubernetes/encryption-config.yaml
    type: File
```

```bash
# 기존 Secret 재암호화
kubectl get secrets --all-namespaces -o json | kubectl replace -f -
```

</details>

### 문제 4. RuntimeClass 생성 및 적용

gVisor(runsc) RuntimeClass를 생성하고 `sandboxed-pod`에 적용하라.

<details>
<summary>풀이</summary>

```yaml
apiVersion: node.k8s.io/v1
kind: RuntimeClass
metadata:
  name: gvisor
handler: runsc
---
apiVersion: v1
kind: Pod
metadata:
  name: sandboxed-pod
spec:
  runtimeClassName: gvisor
  containers:
  - name: app
    image: nginx:1.25
    securityContext:
      allowPrivilegeEscalation: false
      runAsNonRoot: true
      runAsUser: 1000
```

</details>

### 문제 5. OPA Gatekeeper - 허용된 레지스트리

ConstraintTemplate과 Constraint를 작성하여 `docker.io/library/`와 `gcr.io/my-company/` 레지스트리의 이미지만 허용하라.

<details>
<summary>풀이</summary>

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
        msg := sprintf("이미지 '%v'는 허용되지 않습니다", [container.image])
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
  parameters:
    repos:
    - "docker.io/library/"
    - "gcr.io/my-company/"
```

</details>

### 문제 6. Istio mTLS 확인 및 설정

demo 네임스페이스에 Istio mTLS STRICT 모드를 적용하라.

<details>
<summary>풀이</summary>

```bash
# 현재 설정 확인
kubectl get peerauthentication -A
kubectl get peerauthentication -n demo -o yaml
```

```yaml
apiVersion: security.istio.io/v1beta1
kind: PeerAuthentication
metadata:
  name: default
  namespace: demo
spec:
  mtls:
    mode: STRICT
```

```bash
kubectl apply -f mtls-strict.yaml
kubectl get peerauthentication -n demo -o jsonpath='{.items[0].spec.mtls.mode}'
# STRICT
```

</details>

### 문제 7. 점진적 Pod Security 전환

`staging` 네임스페이스에 Baseline enforce + Restricted warn을 적용하라. 그 다음 Restricted를 위반하는 Pod를 생성하여 경고 메시지를 확인하라.

<details>
<summary>풀이</summary>

```bash
kubectl create ns staging
kubectl label namespace staging \
  pod-security.kubernetes.io/enforce=baseline \
  pod-security.kubernetes.io/warn=restricted

# Baseline은 통과하지만 Restricted를 위반하는 Pod
kubectl run test-pod --image=nginx:alpine -n staging
# Warning: would violate PodSecurity "restricted:latest":
#   allowPrivilegeEscalation != false,
#   unrestricted capabilities,
#   runAsNonRoot != true,
#   seccompProfile
# Pod는 생성됨 (enforce=baseline이므로 baseline만 강제)
```

</details>

### 문제 8. SecurityContext - privileged 컨테이너 수정

`debug-pod` Pod가 `privileged: true`로 실행되고 있다. 이를 보안에 맞게 수정하라.

<details>
<summary>풀이</summary>

```yaml
# 수정 전 (위험)
# spec:
#   containers:
#   - name: debug
#     image: ubuntu
#     securityContext:
#       privileged: true

# 수정 후 (보안 강화)
apiVersion: v1
kind: Pod
metadata:
  name: debug-pod
spec:
  securityContext:
    runAsNonRoot: true
    runAsUser: 1000
    seccompProfile:
      type: RuntimeDefault
  containers:
  - name: debug
    image: ubuntu:22.04
    securityContext:
      privileged: false
      allowPrivilegeEscalation: false
      readOnlyRootFilesystem: true
      capabilities:
        drop: ["ALL"]
    volumeMounts:
    - name: tmp
      mountPath: /tmp
  volumes:
  - name: tmp
    emptyDir: {}
```

</details>

### 문제 9. Encryption at Rest 검증

이미 EncryptionConfiguration이 적용된 클러스터에서, 새 Secret을 생성하고 etcd에서 암호화가 적용되었는지 확인하라.

<details>
<summary>풀이</summary>

```bash
# 테스트 Secret 생성
kubectl create secret generic test-encryption \
  --from-literal=password=mysecretpassword

# etcd에서 직접 확인
ETCDCTL_API=3 etcdctl \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key \
  get /registry/secrets/default/test-encryption | hexdump -C

# k8s:enc:aescbc:v1:key1 접두사가 보이면 암호화 성공
# "mysecretpassword"가 평문으로 보이면 암호화 실패
```

</details>

### 문제 10. 복합 문제 - 전체 보안 강화

`high-security` 네임스페이스를 생성하고 다음을 모두 적용하라:
1. Restricted enforce
2. Deployment `secure-web` (replicas=2, nginx:1.25)
3. 모든 보안 설정 (readOnlyRootFilesystem, capabilities drop ALL, seccomp RuntimeDefault 등)

<details>
<summary>풀이</summary>

```bash
kubectl create ns high-security
kubectl label namespace high-security \
  pod-security.kubernetes.io/enforce=restricted \
  pod-security.kubernetes.io/enforce-version=latest
```

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: secure-web
  namespace: high-security
spec:
  replicas: 2
  selector:
    matchLabels:
      app: secure-web
  template:
    metadata:
      labels:
        app: secure-web
    spec:
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
        runAsGroup: 3000
        fsGroup: 2000
        seccompProfile:
          type: RuntimeDefault
      containers:
      - name: nginx
        image: nginx:1.25
        ports:
        - containerPort: 8080
        securityContext:
          allowPrivilegeEscalation: false
          readOnlyRootFilesystem: true
          capabilities:
            drop: ["ALL"]
        resources:
          limits:
            cpu: "200m"
            memory: "128Mi"
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

</details>

---

## 8. 복습 체크리스트

- [ ] Privileged, Baseline, Restricted 세 가지 Pod Security 레벨의 차이를 설명할 수 있는가?
- [ ] enforce, audit, warn 세 가지 모드의 차이를 아는가?
- [ ] 네임스페이스에 Pod Security Admission 라벨을 적용할 수 있는가?
- [ ] Restricted를 준수하는 Pod YAML을 빠르게 작성할 수 있는가?
- [ ] SecurityContext의 주요 필드를 모두 알고 있는가?
- [ ] readOnlyRootFilesystem + emptyDir 패턴을 적용할 수 있는가?
- [ ] EncryptionConfiguration을 작성하고 API Server에 적용할 수 있는가?
- [ ] aescbc와 identity 프로바이더의 순서가 왜 중요한지 설명할 수 있는가?
- [ ] RuntimeClass를 생성하고 Pod에 적용할 수 있는가?
- [ ] OPA Gatekeeper의 ConstraintTemplate과 Constraint 구조를 이해하는가?
- [ ] Istio mTLS의 STRICT/PERMISSIVE 모드 차이를 설명할 수 있는가?
- [ ] PeerAuthentication YAML을 작성할 수 있는가?

---

> **내일 예고:** Day 9에서는 Supply Chain Security 도메인(20%)의 Trivy 이미지 스캔, Cosign 서명, ImagePolicyWebhook, Dockerfile 보안을 학습한다.

---

## tart-infra 실습

### 실습 환경 설정

```bash
# dev 클러스터에 접속 (Istio mTLS, SecurityContext가 적용된 환경)
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/dev.yaml
kubectl get nodes
```

### 실습 1: Pod Security Standards 확인

```bash
# 네임스페이스의 Pod Security Admission 라벨 확인
kubectl get namespace demo -o yaml | grep -A5 "labels:" | grep "pod-security"
```

**동작 원리:** Pod Security Standards 3가지 레벨:
1. **Privileged**: 제한 없음 — 모든 Pod 허용 (kube-system에 적합)
2. **Baseline**: 기본 보안 — 특권 컨테이너, hostNetwork 등 차단
3. **Restricted**: 최고 보안 — runAsNonRoot, drop ALL capabilities, seccomp 필수
4. 네임스페이스 라벨로 적용: `pod-security.kubernetes.io/enforce: restricted`

### 실습 2: Istio mTLS 확인

```bash
# PeerAuthentication 정책 확인 (mTLS 설정)
kubectl get peerauthentication -n demo -o yaml 2>/dev/null
```

**예상 출력 (주요 부분):**
```yaml
apiVersion: security.istio.io/v1beta1
kind: PeerAuthentication
metadata:
  name: default
  namespace: demo
spec:
  mtls:
    mode: STRICT
```

**동작 원리:** Istio mTLS(mutual TLS):
1. **STRICT** 모드: 모든 서비스 간 통신에 mTLS를 강제한다 (평문 통신 차단)
2. **PERMISSIVE** 모드: mTLS와 평문 통신 모두 허용한다 (마이그레이션 단계에서 사용)
3. Istio sidecar(envoy)가 자동으로 TLS 핸드셰이크와 인증서 교환을 처리한다
4. 앱 코드 수정 없이 서비스 간 암호화 통신을 구현할 수 있다

```bash
# mTLS 적용 확인: httpbin Pod 간 통신이 암호화되는지 확인
kubectl exec -n demo deploy/nginx-web -c istio-proxy -- curl -s https://httpbin:8000/get --insecure 2>&1 | head -5 || echo "mTLS 통신 확인"
```

### 실습 3: Secret 암호화 확인

```bash
# API Server의 Encryption 설정 확인
kubectl get pod kube-apiserver-dev-master -n kube-system -o yaml | grep "encryption-provider-config" || echo "Encryption at Rest 미설정 — etcd에 Secret이 평문으로 저장됨"
```

**동작 원리:** etcd Secret 암호화:
1. 기본적으로 Secret은 etcd에 Base64 인코딩된 평문으로 저장된다
2. `--encryption-provider-config`를 설정하면 aescbc, aesgcm, kms 등으로 암호화한다
3. EncryptionConfiguration에서 프로바이더 순서가 중요하다 — 첫 번째 프로바이더로 암호화
4. CKS 시험에서 EncryptionConfiguration을 작성하고 API Server에 적용하는 문제가 출제된다

### 실습 4: RuntimeClass 확인

```bash
# RuntimeClass 확인
kubectl get runtimeclass 2>/dev/null || echo "RuntimeClass가 설정되지 않음 (기본 runc 사용)"
```

**동작 원리:** RuntimeClass와 컨테이너 격리:
1. 기본 런타임(runc): Linux namespace + cgroup으로 격리 — 커널을 호스트와 공유
2. gVisor(runsc): 사용자 공간에서 syscall을 인터셉트 — 더 강한 격리
3. Kata Containers: 경량 VM으로 컨테이너를 실행 — 가장 강한 격리
4. RuntimeClass를 Pod에 지정하면 해당 런타임으로 컨테이너가 실행된다:
   ```yaml
   spec:
     runtimeClassName: gvisor
   ```

---

## 추가 심화 학습: Pod 보안 정책과 정책 엔진 고급 패턴

### Pod Security Admission (PSA) 네임스페이스 라벨 상세

```yaml
# Pod Security Standards를 네임스페이스에 적용하는 3가지 모드
apiVersion: v1
kind: Namespace
metadata:
  name: production
  labels:
    # ── enforce: 정책 위반 시 Pod 생성 자체를 거부 ──
    pod-security.kubernetes.io/enforce: restricted
    # enforce 버전 지정 (특정 K8s 버전의 정책 기준 적용)
    pod-security.kubernetes.io/enforce-version: v1.31

    # ── warn: 정책 위반 시 경고 메시지만 표시 (Pod은 생성됨) ──
    pod-security.kubernetes.io/warn: restricted
    pod-security.kubernetes.io/warn-version: v1.31

    # ── audit: 정책 위반을 Audit Log에 기록 (Pod은 생성됨) ──
    pod-security.kubernetes.io/audit: restricted
    pod-security.kubernetes.io/audit-version: v1.31
```

**동작 원리:** PSA 3단계 적용 전략:
1. 먼저 `warn` + `audit`로 설정하여 어떤 Pod이 위반하는지 파악한다
2. 위반하는 Pod의 SecurityContext를 수정한다
3. 모든 Pod이 정책을 통과하면 `enforce`로 전환한다
4. 이 전략은 기존 워크로드를 깨뜨리지 않고 점진적으로 보안을 강화하는 모범 사례

### SecurityContext 필드별 상세 설명

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: secure-pod
  namespace: production
spec:
  # ── Pod 수준 SecurityContext (모든 컨테이너에 적용) ──
  securityContext:
    runAsUser: 1000          # UID 1000으로 프로세스 실행 (root=0 금지)
    runAsGroup: 3000         # GID 3000으로 프로세스 실행
    fsGroup: 2000            # 볼륨 마운트 시 파일 소유 그룹을 2000으로 설정
    runAsNonRoot: true       # root로 실행 시도하면 Pod 시작 실패!
    seccompProfile:          # seccomp 프로파일 (syscall 제한)
      type: RuntimeDefault   # 런타임 기본 프로파일 사용
    supplementalGroups:      # 추가 그룹 ID
      - 4000
      - 5000

  containers:
    - name: app
      image: nginx:1.25
      # ── 컨테이너 수준 SecurityContext (이 컨테이너에만 적용) ──
      securityContext:
        allowPrivilegeEscalation: false  # setuid/setgid 비트로 권한 상승 불가
        readOnlyRootFilesystem: true     # 루트 파일시스템 읽기 전용
        capabilities:
          drop:
            - ALL              # 모든 Linux capabilities 제거
          add:
            - NET_BIND_SERVICE # 1024 이하 포트 바인딩만 허용
        privileged: false      # 특권 모드 비활성화 (호스트 커널 접근 차단)

      # readOnlyRootFilesystem=true일 때 쓰기가 필요한 경로는 emptyDir 사용
      volumeMounts:
        - name: tmp
          mountPath: /tmp       # 임시 파일 쓰기 허용
        - name: cache
          mountPath: /var/cache/nginx  # nginx 캐시 쓰기 허용

  volumes:
    - name: tmp
      emptyDir: {}             # Pod 삭제 시 함께 사라지는 임시 볼륨
    - name: cache
      emptyDir: {}
```

**동작 원리:** 각 SecurityContext 필드의 역할:
1. `runAsNonRoot: true` → 이미지의 USER가 root(UID 0)이면 Pod 시작 실패
2. `readOnlyRootFilesystem: true` → 컨테이너 내 파일 변조 방지 (악성코드 설치 차단)
3. `allowPrivilegeEscalation: false` → setuid 바이너리로 root 획득하는 것을 방지
4. `capabilities.drop: [ALL]` → 불필요한 커널 기능 모두 제거
5. `seccompProfile: RuntimeDefault` → 위험한 syscall(reboot, mount 등) 차단

### OPA Gatekeeper ConstraintTemplate 상세 YAML

```yaml
# Step 1: ConstraintTemplate 정의 (정책 로직)
apiVersion: templates.gatekeeper.sh/v1
kind: ConstraintTemplate
metadata:
  name: k8srequiredlabels        # 템플릿 이름
spec:
  crd:
    spec:
      names:
        kind: K8sRequiredLabels  # 이 템플릿으로 만들 Constraint의 Kind
      validation:
        openAPIV3Schema:
          type: object
          properties:
            labels:              # 파라미터: 필수 라벨 목록
              type: array
              items:
                type: string
  targets:
    - target: admission.k8s.gatekeeper.sh
      rego: |
        # Rego 정책 언어 (OPA의 핵심)
        package k8srequiredlabels

        # 위반 조건 정의
        violation[{"msg": msg}] {
          # input.review.object = 생성/수정되는 K8s 오브젝트
          provided := {label | input.review.object.metadata.labels[label]}
          # input.parameters.labels = Constraint에서 지정한 필수 라벨
          required := {label | label := input.parameters.labels[_]}
          # 누락된 라벨 계산
          missing := required - provided
          # 누락된 라벨이 있으면 위반!
          count(missing) > 0
          msg := sprintf("필수 라벨 누락: %v", [missing])
        }
---
# Step 2: Constraint 생성 (정책 적용)
apiVersion: constraints.gatekeeper.sh/v1beta1
kind: K8sRequiredLabels           # ConstraintTemplate에서 정의한 Kind
metadata:
  name: ns-must-have-team-label
spec:
  match:
    kinds:
      - apiGroups: [""]
        kinds: ["Namespace"]      # Namespace 생성 시 적용
  parameters:
    labels:
      - "team"                    # "team" 라벨 필수!
      - "environment"             # "environment" 라벨 필수!
```

**동작 원리:** Gatekeeper 정책 적용 흐름:
1. ConstraintTemplate = 정책의 "틀" (Rego 코드로 검증 로직 정의)
2. Constraint = 정책의 "적용" (어떤 리소스에 어떤 파라미터로 적용할지)
3. 사용자가 리소스를 생성하면 → API Server → Gatekeeper Webhook → Rego 평가 → 허용/거부
4. CKS 시험에서는 Rego를 작성하기보다 Constraint를 올바르게 적용하는 문제가 출제된다

### Kyverno vs OPA Gatekeeper 비교

```
Kyverno vs OPA Gatekeeper 비교
═══════════════════════════════

항목              Kyverno              OPA Gatekeeper
───────────────────────────────────────────────────────
정책 언어        YAML (K8s 네이티브)   Rego (별도 언어)
학습 곡선        낮음                  높음 (Rego 학습 필요)
Mutating 지원    ✅ (기본 지원)        ❌ (별도 구현 필요)
Generate 지원    ✅ (리소스 자동 생성)  ❌
정책 리포트      ✅ PolicyReport       ⚠️ 별도 설정
CKS 시험 출제    ⚠️ 드물게             ✅ 자주 출제
```

### Kyverno 정책 YAML 예제

```yaml
# Kyverno: 컨테이너 이미지 태그 필수 정책
apiVersion: kyverno.io/v1
kind: ClusterPolicy              # 클러스터 전체에 적용
metadata:
  name: disallow-latest-tag
spec:
  validationFailureAction: Enforce  # 위반 시 거부 (Audit = 경고만)
  background: true                  # 기존 리소스도 검사
  rules:
    - name: require-image-tag       # 규칙 이름
      match:
        any:
          - resources:
              kinds:
                - Pod               # Pod 생성 시 적용
      validate:
        message: "이미지에 :latest 태그를 사용할 수 없습니다. 버전 태그를 명시하세요."
        pattern:
          spec:
            containers:
              - image: "!*:latest"  # latest 태그 패턴 거부
---
# Kyverno: 자동으로 리소스 수정 (Mutating)
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: add-default-resources
spec:
  rules:
    - name: add-resource-limits
      match:
        any:
          - resources:
              kinds:
                - Pod
      mutate:
        patchStrategicMerge:
          spec:
            containers:
              - (name): "*"        # 모든 컨테이너에 적용
                resources:
                  limits:
                    memory: "512Mi"  # 메모리 상한 자동 추가
                    cpu: "500m"      # CPU 상한 자동 추가
                  requests:
                    memory: "128Mi"
                    cpu: "100m"
```

### EncryptionConfiguration YAML 상세

```yaml
# Secret을 etcd에 암호화하여 저장하기 위한 설정
# 파일 위치: /etc/kubernetes/enc/encryption-config.yaml
apiVersion: apiserver.config.k8s.io/v1
kind: EncryptionConfiguration
resources:
  - resources:
      - secrets                      # Secret 리소스만 암호화 대상
    providers:
      # 첫 번째 프로바이더 = 새로운 Secret 암호화에 사용
      - aescbc:                      # AES-CBC 암호화
          keys:
            - name: key1             # 키 이름 (식별용)
              secret: base64encodedkey==  # 32바이트 키를 Base64 인코딩
      # 두 번째 프로바이더 = 기존 암호화되지 않은 Secret 읽기용
      - identity: {}                 # 평문 (암호화 없음)
```

```bash
# 암호화 키 생성 (32바이트 랜덤)
head -c 32 /dev/urandom | base64

# API Server 매니페스트에 추가:
# /etc/kubernetes/manifests/kube-apiserver.yaml
#   --encryption-provider-config=/etc/kubernetes/enc/encryption-config.yaml
# volumes에 enc 디렉터리 마운트 추가

# 기존 Secret을 새로운 암호화 키로 재암호화
kubectl get secrets --all-namespaces -o json | kubectl replace -f -
```

**동작 원리:** EncryptionConfiguration 적용 절차:
1. 암호화 설정 파일을 생성한다
2. API Server 매니페스트에 `--encryption-provider-config` 플래그를 추가한다
3. 설정 파일을 hostPath 볼륨으로 마운트한다
4. API Server가 재시작되면 새로운 Secret이 암호화되어 etcd에 저장된다
5. 기존 Secret은 `kubectl replace`로 재암호화해야 한다

### 연습 문제: Pod 보안 시나리오

**문제 1:** `restricted` 보안 레벨을 `secure-ns` 네임스페이스에 enforce 모드로 적용하시오.

```bash
# 정답:
kubectl create namespace secure-ns
kubectl label namespace secure-ns \
  pod-security.kubernetes.io/enforce=restricted \
  pod-security.kubernetes.io/enforce-version=latest

# 검증: restricted 위반 Pod 생성 시도
kubectl run test-root --image=nginx -n secure-ns
# 결과: Error — violates PodSecurity "restricted"
# (nginx는 root로 실행하므로 restricted 위반)
```

**문제 2:** 아래 Pod YAML의 보안 문제를 모두 수정하시오.

```yaml
# 수정 전 (보안 취약)
apiVersion: v1
kind: Pod
metadata:
  name: insecure-pod
spec:
  containers:
    - name: app
      image: myapp:latest
      securityContext:
        privileged: true
        runAsUser: 0

# 수정 후 (보안 강화)
apiVersion: v1
kind: Pod
metadata:
  name: secure-pod
spec:
  securityContext:
    runAsNonRoot: true               # Pod 수준: root 실행 금지
    seccompProfile:
      type: RuntimeDefault           # seccomp 프로파일 적용
  containers:
    - name: app
      image: myapp:1.0               # 버전 태그 명시 (latest 금지)
      securityContext:
        privileged: false             # 특권 모드 비활성화
        runAsUser: 1000               # non-root UID
        allowPrivilegeEscalation: false  # 권한 상승 차단
        readOnlyRootFilesystem: true     # 루트 FS 읽기 전용
        capabilities:
          drop:
            - ALL                     # 모든 capability 제거
```

### RuntimeClass YAML 상세

```yaml
# gVisor RuntimeClass 정의
apiVersion: node.k8s.io/v1
kind: RuntimeClass
metadata:
  name: gvisor                   # RuntimeClass 이름
handler: runsc                   # 컨테이너 런타임 핸들러 (containerd 설정과 일치해야 함)
overhead:                        # gVisor 사용 시 추가 리소스 오버헤드
  podFixed:
    memory: "128Mi"
    cpu: "100m"
scheduling:                      # gVisor가 설치된 노드에만 스케줄
  nodeSelector:
    runtime: gvisor              # 이 라벨이 있는 노드에만
---
# gVisor를 사용하는 Pod
apiVersion: v1
kind: Pod
metadata:
  name: sandboxed-pod
spec:
  runtimeClassName: gvisor       # RuntimeClass 지정
  containers:
    - name: app
      image: nginx:1.25
```

**동작 원리:** 컨테이너 런타임 격리 수준 비교:
1. **runc** (기본): 호스트 커널 공유 → 빠르지만 격리 약함
2. **gVisor**: 사용자 공간 커널 → syscall 인터셉트, 오버헤드 존재
3. **Kata**: 경량 VM → 가장 강한 격리, 가장 큰 오버헤드
4. CKS 시험에서는 RuntimeClass를 생성하고 Pod에 적용하는 문제가 출제된다
