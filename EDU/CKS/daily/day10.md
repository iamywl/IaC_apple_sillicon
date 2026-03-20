# CKS Day 10: Supply Chain Security (2/2) - 시험 패턴, 실전 문제, 심화 학습

> 학습 목표 | CKS 도메인: Supply Chain Security (20%) | 예상 소요 시간: 2시간

---

## 오늘의 학습 목표

- Supply Chain Security 도메인의 CKS 시험 출제 패턴을 분석한다
- Trivy, ImagePolicyWebhook, 이미지 다이제스트 관련 실전 문제 11개를 풀어본다
- tart-infra 환경에서 이미지 보안 실습을 수행한다
- 심화 주제를 학습하여 이해를 깊게 한다

---


## 7. 이 주제가 시험에서 어떻게 나오는가

### 7.1 출제 패턴

```
Supply Chain Security 출제 패턴 (20%)
═════════════════════════════════════

1. Trivy 이미지 스캔 (매우 빈출)
   - "여러 이미지를 스캔하고 CRITICAL 취약점이 있는 Pod를 삭제하라"
   - "특정 네임스페이스의 이미지 중 가장 적은 취약점을 가진 것을 사용하라"
   의도: Trivy 사용법과 결과 해석 능력

2. ImagePolicyWebhook 설정 (빈출, 배점 높음)
   - "ImagePolicyWebhook을 활성화하고 defaultAllow=false로 설정하라"
   - "설정 파일이 주어지고, API Server에 적용하라"
   의도: Admission Controller 설정 능력

3. Dockerfile 보안 수정 (빈출)
   - "Dockerfile의 보안 문제를 식별하고 수정하라"
   의도: 보안 모범 사례 이해도

4. 이미지 다이제스트 (가끔 출제)
   - "태그 대신 다이제스트를 사용하도록 수정하라"
   의도: 이미지 불변성 이해도

5. kubesec 정적 분석 (가끔 출제)
   - "매니페스트의 보안 점수를 높이도록 수정하라"
```

### 7.2 실전 문제 (10개 이상)

### 문제 1. Trivy 이미지 스캔

다음 이미지 중 CRITICAL 취약점이 있는 이미지를 사용하는 Pod를 삭제하라: `nginx:1.19`, `nginx:1.25`, `redis:6`, `redis:7`

<details>
<summary>풀이</summary>

```bash
trivy image --severity CRITICAL nginx:1.19 2>/dev/null | grep -E "Total:|CRITICAL"
trivy image --severity CRITICAL nginx:1.25 2>/dev/null | grep -E "Total:|CRITICAL"
trivy image --severity CRITICAL redis:6 2>/dev/null | grep -E "Total:|CRITICAL"
trivy image --severity CRITICAL redis:7 2>/dev/null | grep -E "Total:|CRITICAL"

# CRITICAL이 있는 이미지의 Pod 찾기
kubectl get pods -n scan-ns -o jsonpath='{range .items[*]}{.metadata.name}: {.spec.containers[0].image}{"\n"}{end}'

# CRITICAL이 있는 Pod 삭제
kubectl delete pod web1 -n scan-ns     # nginx:1.19 (구버전)
kubectl delete pod cache1 -n scan-ns   # redis:6 (구버전)
```

</details>

### 문제 2. ImagePolicyWebhook 설정

ImagePolicyWebhook Admission Controller를 활성화하라. 설정 파일은 `/etc/kubernetes/admission-control/`에 있다. `defaultAllow`를 `false`로 설정하라.

<details>
<summary>풀이</summary>

```bash
# 설정 확인 및 수정
cat /etc/kubernetes/admission-control/admission-config.yaml
# defaultAllow: false 확인 (아니면 수정)

# API Server 매니페스트 수정
cp /etc/kubernetes/manifests/kube-apiserver.yaml /tmp/kube-apiserver.yaml.bak
vi /etc/kubernetes/manifests/kube-apiserver.yaml
```

추가할 내용:
```yaml
- --enable-admission-plugins=NodeRestriction,ImagePolicyWebhook
- --admission-control-config-file=/etc/kubernetes/admission-control/admission-config.yaml

volumeMounts:
- name: admission-control
  mountPath: /etc/kubernetes/admission-control/
  readOnly: true

volumes:
- name: admission-control
  hostPath:
    path: /etc/kubernetes/admission-control/
    type: DirectoryOrCreate
```

```bash
watch crictl ps | grep kube-apiserver
kubectl get nodes
```

</details>

### 문제 3. Dockerfile 보안 수정

다음 Dockerfile의 보안 문제를 식별하고 수정하라:

```dockerfile
FROM ubuntu:latest
RUN apt-get update && apt-get install -y curl vim netcat python3
ADD . /app
WORKDIR /app
CMD ["python3", "app.py"]
```

<details>
<summary>풀이</summary>

```dockerfile
FROM python:3.12-slim AS builder
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir --user -r requirements.txt
COPY . .

FROM gcr.io/distroless/python3-debian12:nonroot
WORKDIR /app
COPY --from=builder /root/.local /home/nonroot/.local
COPY --from=builder /app .
USER 65532:65532
EXPOSE 8080
ENTRYPOINT ["python3", "app.py"]
```

수정 사항:
1. `FROM ubuntu:latest` → 특정 버전 + distroless
2. `USER` 추가 (non-root)
3. 불필요한 패키지(vim, netcat, curl) 제거
4. `ADD` → `COPY` 변경
5. 멀티스테이지 빌드 적용

</details>

### 문제 4. 이미지 다이제스트 적용

`production` 네임스페이스의 `web-app` Deployment가 `nginx:latest`를 사용하고 있다. 다이제스트로 변경하라.

<details>
<summary>풀이</summary>

```bash
# 현재 이미지의 다이제스트 확인
kubectl get pod -n production -l app=web-app \
  -o jsonpath='{.items[0].status.containerStatuses[0].imageID}'

# Deployment 이미지 변경
kubectl set image deployment/web-app -n production \
  nginx=nginx@sha256:6af79ae5de407283dcea8b00d5c37ace95441fd58a8b1d2aa1ed93f5511bb18c

# 확인
kubectl get deployment web-app -n production \
  -o jsonpath='{.spec.template.spec.containers[0].image}'
```

</details>

### 문제 5. kubesec 정적 분석

주어진 Pod YAML의 보안 점수를 높이기 위한 수정사항을 적용하라.

<details>
<summary>풀이</summary>

```bash
kubesec scan pod.yaml
# 또는
curl -sSX POST --data-binary @pod.yaml https://v2.kubesec.io/scan | jq .
```

보안 강화:
```yaml
apiVersion: v1
kind: Pod
metadata:
  name: secure-pod
spec:
  serviceAccountName: dedicated-sa
  automountServiceAccountToken: false
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
    resources:
      limits:
        cpu: "200m"
        memory: "128Mi"
```

</details>

### 문제 6. Trivy 클러스터 스캔

dev 클러스터의 demo 네임스페이스에서 실행 중인 모든 이미지를 스캔하고, CRITICAL 취약점이 없는 이미지만 남겨라.

<details>
<summary>풀이</summary>

```bash
# 모든 이미지 확인
kubectl get pods -n demo -o jsonpath='{range .items[*]}{.metadata.name}: {range .spec.containers[*]}{.image}{" "}{end}{"\n"}{end}'

# 각 이미지 스캔
for img in $(kubectl get pods -n demo -o jsonpath='{range .items[*]}{range .spec.containers[*]}{.image}{"\n"}{end}{end}' | sort -u); do
  echo "=== $img ==="
  COUNT=$(trivy image --severity CRITICAL --format json "$img" 2>/dev/null | jq '[.Results[].Vulnerabilities // [] | .[] | select(.Severity == "CRITICAL")] | length')
  echo "CRITICAL 취약점: $COUNT"
  if [ "$COUNT" -gt 0 ]; then
    echo "*** 삭제 대상! ***"
    # 해당 이미지를 사용하는 Pod 찾기
    kubectl get pods -n demo -o jsonpath="{range .items[*]}{range .spec.containers[*]}{.image}{'\t'}{end}{.metadata.name}{'\n'}{end}" | grep "$img"
  fi
done

# CRITICAL이 있는 Pod 삭제
kubectl delete pod <pod-name> -n demo
```

</details>

### 문제 7. SBOM 생성

nginx:1.25 이미지의 SBOM(Software Bill of Materials)을 CycloneDX 형식으로 생성하라.

<details>
<summary>풀이</summary>

```bash
trivy image --format cyclonedx -o /tmp/nginx-sbom.cdx.json nginx:1.25

# SBOM 분석
cat /tmp/nginx-sbom.cdx.json | jq '.components | length'
# 총 컴포넌트 수

cat /tmp/nginx-sbom.cdx.json | jq '.components[] | {name, version, type}' | head -30
# 각 컴포넌트 정보
```

</details>

### 문제 8. ValidatingWebhookConfiguration 작성

이미지 검증을 위한 ValidatingWebhookConfiguration을 작성하라. Pod 생성 시 `image-validator` 서비스(security 네임스페이스)를 호출하도록 설정하라.

<details>
<summary>풀이</summary>

```yaml
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingWebhookConfiguration
metadata:
  name: image-validation
webhooks:
- name: validate-image.example.com
  admissionReviewVersions: ["v1"]
  sideEffects: None
  clientConfig:
    service:
      name: image-validator
      namespace: security
      path: "/validate"
    caBundle: <base64-encoded-ca>
  rules:
  - operations: ["CREATE", "UPDATE"]
    apiGroups: [""]
    apiVersions: ["v1"]
    resources: ["pods"]
  failurePolicy: Fail
  namespaceSelector:
    matchExpressions:
    - key: kubernetes.io/metadata.name
      operator: NotIn
      values: ["kube-system"]
```

</details>

### 문제 9. Trivy 설정 파일 스캔

K8s 매니페스트 파일을 Trivy로 스캔하여 보안 설정 문제를 찾아라.

<details>
<summary>풀이</summary>

```bash
# 매니페스트 보안 스캔
trivy config /path/to/manifests/

# 또는 특정 파일
trivy config deployment.yaml

# 결과에서 CRITICAL, HIGH 문제 확인
# - privileged container
# - runAsNonRoot missing
# - capabilities not dropped
# - readOnlyRootFilesystem missing
```

</details>

### 문제 10. 이미지 서명 검증 (개념)

Cosign을 사용하여 이미지의 서명을 검증하는 명령어를 작성하라.

<details>
<summary>풀이</summary>

```bash
# 키 기반 검증
cosign verify --key cosign.pub docker.io/myrepo/myimage:v1.0

# Keyless 검증
cosign verify \
  --certificate-identity=builder@company.com \
  --certificate-oidc-issuer=https://token.actions.githubusercontent.com \
  docker.io/myrepo/myimage:v1.0

# 서명이 없는 경우
# Error: no matching signatures
```

</details>

### 문제 11. 복합 문제 - Supply Chain 전체 보안

다음을 모두 수행하라:
1. `web-app` Deployment의 이미지를 Trivy로 스캔
2. CRITICAL 취약점이 없는 버전으로 교체
3. 이미지를 다이제스트로 지정
4. Pod Security Restricted 준수하도록 SecurityContext 추가

<details>
<summary>풀이</summary>

```bash
# 1. 현재 이미지 확인 및 스캔
kubectl get deploy web-app -n production -o jsonpath='{.spec.template.spec.containers[0].image}'
trivy image --severity CRITICAL nginx:1.19

# 2. 취약점 없는 버전 확인
trivy image --severity CRITICAL nginx:1.25
# CRITICAL 없음

# 3. 다이제스트 확인
crane digest nginx:1.25

# 4. Deployment 수정
kubectl edit deploy web-app -n production
```

```yaml
spec:
  template:
    spec:
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
        seccompProfile:
          type: RuntimeDefault
      containers:
      - name: web
        image: nginx@sha256:6af79ae5de...  # 다이제스트
        securityContext:
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

---

## 8. 복습 체크리스트

- [ ] Trivy의 기본 사용법과 주요 옵션을 아는가?
- [ ] `--severity`, `--exit-code`, `--ignore-unfixed` 옵션을 활용할 수 있는가?
- [ ] CRITICAL 취약점이 있는 이미지를 식별하고 해당 Pod를 삭제할 수 있는가?
- [ ] ImagePolicyWebhook의 설정 구성 요소를 아는가?
- [ ] `defaultAllow: false` (fail-closed)의 의미를 설명할 수 있는가?
- [ ] API Server에 ImagePolicyWebhook을 적용할 수 있는가?
- [ ] Dockerfile의 보안 문제를 식별하고 수정할 수 있는가?
- [ ] 멀티스테이지 빌드, distroless, non-root USER의 의미를 아는가?
- [ ] 이미지 태그 대신 다이제스트를 사용하는 이유를 설명할 수 있는가?
- [ ] Cosign 이미지 서명/검증의 개념을 이해하는가?
- [ ] kubesec으로 매니페스트 보안을 분석할 수 있는가?
- [ ] SBOM의 개념과 Trivy로 생성하는 방법을 아는가?

---

> **내일 예고:** Day 11에서는 Monitoring, Logging & Runtime Security 도메인(20%)의 Falco, Audit Log, Sysdig, 컨테이너 불변성을 학습한다.

---

## tart-infra 실습

### 실습 환경 설정

```bash
# dev 클러스터에 접속
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/dev.yaml
kubectl get nodes
```

### 실습 1: 이미지 취약점 점검

```bash
# demo 네임스페이스에서 사용 중인 이미지 목록 추출
kubectl get pods -n demo -o jsonpath='{range .items[*]}{range .spec.containers[*]}{.image}{"\n"}{end}{end}' | sort -u
```

**예상 출력:**
```
docker.io/istio/proxyv2:1.x.x
docker.io/kennethreitz/httpbin
nginx:1.25
postgres:15
rabbitmq:3-management
redis:7
docker.io/jboss/keycloak:latest
```

**동작 원리:** 이미지 보안 점검 순서:
1. 사용 중인 이미지 목록을 추출한다
2. `trivy image <image>` 명령으로 각 이미지의 취약점을 스캔한다
3. CRITICAL, HIGH 취약점이 있는 이미지를 패치된 버전으로 교체한다
4. `:latest` 태그는 버전이 고정되지 않아 위험하다 — 다이제스트(`@sha256:...`) 사용 권장

```bash
# Trivy로 이미지 스캔 (trivy 설치 필요)
# trivy image nginx:1.25 --severity CRITICAL,HIGH
# trivy image postgres:15 --severity CRITICAL,HIGH
```

### 실습 2: 이미지 다이제스트 확인

```bash
# 실행 중인 Pod의 이미지 다이제스트 확인
kubectl get pods -n demo -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{range .status.containerStatuses[*]}{.imageID}{"\n"}{end}{end}'
```

**동작 원리:** 이미지 태그 vs 다이제스트:
1. 태그(`nginx:1.25`): 같은 태그에 다른 이미지가 푸시될 수 있다 (변경 가능)
2. 다이제스트(`nginx@sha256:abc...`): 이미지 내용의 해시 — 불변이다
3. 보안 중요 환경에서는 다이제스트를 사용하여 이미지 무결성을 보장한다
4. `containerStatuses[].imageID`에서 실제 실행 중인 이미지의 다이제스트를 확인할 수 있다

### 실습 3: Admission Controller 확인

```bash
# API Server에 활성화된 Admission Controller 확인
kubectl get pod kube-apiserver-dev-master -n kube-system -o yaml | grep "enable-admission-plugins"
```

**예상 출력:**
```
    - --enable-admission-plugins=NodeRestriction
```

**동작 원리:** Admission Controller의 역할:
1. API 요청이 인증/인가를 통과한 후 etcd에 저장되기 전에 실행된다
2. **Mutating**: 요청을 수정한다 (예: Istio sidecar injection, default SA 설정)
3. **Validating**: 요청을 검증한다 (예: Pod Security Admission, ResourceQuota)
4. 실행 순서: Mutating → Validating → etcd 저장
5. ImagePolicyWebhook: 외부 웹훅으로 이미지 정책을 검증하는 Admission Controller

### 실습 4: Dockerfile 보안 패턴 확인

```bash
# tart-infra 매니페스트의 이미지 사용 패턴 분석
echo "=== 보안 양호: 버전 태그 사용 ==="
kubectl get pods -n demo -o jsonpath='{range .items[*]}{range .spec.containers[*]}{.image}{"\n"}{end}{end}' | grep -v latest

echo ""
echo "=== 보안 위험: latest 태그 사용 ==="
kubectl get pods -n demo -o jsonpath='{range .items[*]}{range .spec.containers[*]}{.image}{"\n"}{end}{end}' | grep latest
```

**동작 원리:** Dockerfile 보안 모범 사례:
1. 멀티스테이지 빌드: 빌드 도구가 최종 이미지에 포함되지 않도록 한다
2. distroless/scratch 기반 이미지: 패키지 관리자, 셸이 없어 공격 표면이 최소화된다
3. `USER <non-root>`: root가 아닌 사용자로 실행한다
4. `COPY --chown=<user>`: 파일 소유권을 non-root 사용자로 설정한다
5. `.dockerignore`: 불필요한 파일(secret, .git 등)이 이미지에 포함되지 않도록 한다

---

## 추가 심화 학습: Supply Chain Security 고급 패턴

### Trivy 이미지 스캔 상세 사용법

```bash
# Trivy 기본 이미지 스캔
trivy image nginx:1.25

# 심각도 필터링: CRITICAL과 HIGH만 표시
trivy image nginx:1.25 --severity CRITICAL,HIGH

# JSON 형식 출력 (CI/CD 파이프라인에서 파싱용)
trivy image nginx:1.25 --format json --output result.json

# 특정 취약점 무시 (오탐 또는 수용 가능한 취약점)
trivy image nginx:1.25 --ignorefile .trivyignore

# 이미지가 아닌 파일시스템 스캔 (Dockerfile 빌드 전)
trivy fs --security-checks vuln,secret,config ./

# Kubernetes 클러스터 전체 스캔
trivy k8s --report summary cluster
```

**동작 원리:** Trivy 스캔 과정:
1. 이미지의 레이어를 분석하여 설치된 패키지 목록을 추출한다
2. 추출된 패키지를 CVE(Common Vulnerabilities and Exposures) 데이터베이스와 대조한다
3. 각 취약점에 CVSS 점수 기반으로 심각도(CRITICAL/HIGH/MEDIUM/LOW)를 부여한다
4. `--exit-code 1`을 사용하면 취약점 발견 시 CI 파이프라인을 실패시킬 수 있다

### Trivy 스캔 결과 분석 예제

```
스캔 결과 읽는 법
═══════════════

nginx:1.25 (debian 12.4)
Total: 142 (CRITICAL: 3, HIGH: 15, MEDIUM: 89, LOW: 35)

┌──────────────┬────────────────┬──────────┬────────────────┬───────────────┐
│   Library    │ Vulnerability  │ Severity │ Installed Ver  │  Fixed Ver    │
├──────────────┼────────────────┼──────────┼────────────────┼───────────────┤
│ libssl3      │ CVE-2024-XXXXX │ CRITICAL │ 3.0.11-1       │ 3.0.13-1      │
│ libcurl4     │ CVE-2024-YYYYY │ HIGH     │ 7.88.1-10      │ 7.88.1-10+deb│
│ zlib1g       │ CVE-2023-ZZZZZ │ MEDIUM   │ 1:1.2.13       │              │
└──────────────┴────────────────┴──────────┴────────────────┴───────────────┘

해석:
  - Library: 취약한 패키지 이름
  - Vulnerability: CVE 식별자 (cve.mitre.org에서 상세 확인)
  - Fixed Ver: 패치된 버전 (빈칸 = 아직 패치 없음)
  - CRITICAL/HIGH는 즉시 조치, MEDIUM은 계획 수립, LOW는 모니터링
```

### ImagePolicyWebhook 설정 상세

```yaml
# ImagePolicyWebhook 설정 파일
# 위치: /etc/kubernetes/admission-control/image-policy.yaml
apiVersion: apiserver.config.k8s.io/v1
kind: AdmissionConfiguration
plugins:
  - name: ImagePolicyWebhook
    configuration:
      imagePolicy:
        kubeConfigFile: /etc/kubernetes/admission-control/admission-kubeconfig.yaml
        allowTTL: 50              # 허용 결과 캐시 시간 (초)
        denyTTL: 50               # 거부 결과 캐시 시간 (초)
        retryBackoff: 500         # 웹훅 재시도 간격 (밀리초)
        defaultAllow: false       # 웹훅 장애 시 기본 거부! (보안 우선)
```

```yaml
# ImagePolicyWebhook의 kubeconfig
# 위치: /etc/kubernetes/admission-control/admission-kubeconfig.yaml
apiVersion: v1
kind: Config
clusters:
  - cluster:
      certificate-authority: /etc/kubernetes/admission-control/ca.crt
      server: https://image-policy-webhook.security:8443/validate  # 외부 웹훅 URL
    name: image-policy-webhook
contexts:
  - context:
      cluster: image-policy-webhook
      user: api-server
    name: image-policy-webhook
current-context: image-policy-webhook
users:
  - name: api-server
    user:
      client-certificate: /etc/kubernetes/admission-control/client.crt
      client-key: /etc/kubernetes/admission-control/client.key
```

**동작 원리:** ImagePolicyWebhook 흐름:
1. 사용자가 Pod 생성 요청 → API Server
2. API Server가 이미지 정보를 ImagePolicyWebhook에 전송
3. 외부 웹훅 서버가 이미지 레지스트리, 서명, 취약점 정보를 확인
4. 허용/거부 응답을 API Server에 반환
5. `defaultAllow: false`로 설정하면 웹훅 장애 시에도 이미지 거부 (fail-close)

### Dockerfile 보안 문제 식별과 수정

```dockerfile
# ── 보안 취약 Dockerfile (문제점 포함) ──
FROM ubuntu:latest                 # ❌ latest 태그 사용
RUN apt-get update && apt-get install -y curl wget  # ❌ 불필요한 도구 포함
COPY . /app                        # ❌ 모든 파일 복사 (secret 포함 가능)
RUN chmod 777 /app                 # ❌ 과도한 권한
USER root                          # ❌ root 사용자로 실행
EXPOSE 80
CMD ["./app"]

# ── 보안 강화 Dockerfile (수정 후) ──
# Stage 1: 빌드 스테이지
FROM golang:1.22-alpine AS builder # ✅ 버전 태그 명시, alpine 사용
WORKDIR /build
COPY go.mod go.sum ./              # ✅ 의존성 파일만 먼저 복사
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o app  # ✅ 정적 바이너리 빌드

# Stage 2: 실행 스테이지
FROM gcr.io/distroless/static:nonroot  # ✅ distroless + nonroot 기반
COPY --from=builder /build/app /app    # ✅ 빌드 결과물만 복사
USER 65534:65534                       # ✅ nonroot UID/GID (nobody)
EXPOSE 8080
ENTRYPOINT ["/app"]                    # ✅ ENTRYPOINT 사용
```

**동작 원리:** Dockerfile 보안 체크리스트:
1. `FROM`: 버전 태그 명시 + 최소 이미지(alpine/distroless/scratch) 사용
2. `COPY`: 필요한 파일만 선택적으로 복사 + `.dockerignore` 활용
3. `USER`: 반드시 non-root 사용자로 설정
4. 멀티스테이지 빌드: 빌드 도구가 최종 이미지에 포함되지 않도록
5. `RUN`: 불필요한 패키지 설치 금지, 캐시 삭제 (`apt-get clean`)

### kubesec을 활용한 YAML 정적 분석

```bash
# kubesec: Kubernetes YAML의 보안 점수를 매기는 도구

# Pod YAML 보안 점수 확인
kubesec scan pod.yaml

# 결과 예시:
# [
#   {
#     "object": "Pod/insecure-pod.default",
#     "valid": true,
#     "score": -30,         ← 음수 = 보안 취약!
#     "scoring": {
#       "critical": [
#         { "id": "Privileged",
#           "reason": "Privileged containers can allow almost completely unrestricted host access" },
#         { "id": "RunAsRoot",
#           "reason": "Running as root gives full control of host" }
#       ],
#       "advise": [
#         { "id": "ReadOnlyRootFilesystem",
#           "reason": "An immutable root filesystem prevents..." },
#         { "id": "LimitsCPU",
#           "reason": "Enforcing CPU limits prevents..." }
#       ]
#     }
#   }
# ]
```

**동작 원리:** kubesec 점수 체계:
1. `critical` (감점): 즉시 수정해야 하는 보안 문제 (privileged, runAsRoot)
2. `advise` (가점 기회): 적용하면 보안이 강화되는 설정 (readOnlyRootFilesystem)
3. 점수가 0 이상이면 기본적으로 안전, 음수이면 심각한 문제 존재
4. CI/CD 파이프라인에서 `--exit-code`와 함께 사용하여 배포 차단 가능

### 이미지 서명 및 검증 (Cosign)

```bash
# Cosign을 사용한 이미지 서명/검증 워크플로

# Step 1: 키 쌍 생성
cosign generate-key-pair
# 결과: cosign.key (개인키), cosign.pub (공개키)

# Step 2: 이미지 서명
cosign sign --key cosign.key myregistry.io/myapp:1.0

# Step 3: 이미지 서명 검증
cosign verify --key cosign.pub myregistry.io/myapp:1.0
```

```
이미지 서명 흐름 (비대칭 키 기반 디지털 서명)
══════════════════════════════════════════════

개발자가 이미지를 빌드 → 개인키로 서명 → 레지스트리에 푸시
                             │
                      서명 = "이 이미지는 내가 만들었다"의 디지털 증명
                             │
배포 시 ← 공개키로 검증 ← 레지스트리에서 서명 확인
  │
  └─ 검증 성공: 배포 허용
  └─ 검증 실패: 배포 차단 (이미지가 변조되었을 수 있음!)
```

**동작 원리:** 이미지 서명의 필요성:
1. 레지스트리에 악의적으로 변조된 이미지가 푸시될 수 있다
2. 서명으로 이미지의 무결성(변조 없음)과 출처(누가 만들었는지)를 보장한다
3. Admission Controller와 연동하여 서명되지 않은 이미지의 배포를 차단한다
4. CKS 시험에서는 개념 이해가 중요 (실제 Cosign 설정보다 원리 질문)

### 연습 문제: Supply Chain Security 시나리오

**문제 1:** 아래 Dockerfile의 보안 문제를 5가지 이상 식별하시오.

```dockerfile
FROM node:latest
WORKDIR /app
COPY . .
RUN npm install
RUN chmod 777 /app/node_modules
USER root
EXPOSE 3000
CMD ["node", "server.js"]
```

**정답:**
1. `FROM node:latest` → 태그 불명확, 최신 버전이 변경될 수 있음 → `node:20-alpine`
2. `COPY . .` → .git, .env, node_modules 등 불필요한 파일 포함 → `.dockerignore` 필요
3. `RUN npm install` → devDependencies 포함 → `RUN npm ci --only=production`
4. `chmod 777` → 과도한 파일 권한 → `chmod 755` 또는 최소 권한
5. `USER root` → root 실행 → `USER node` (node 이미지에 내장된 non-root 유저)
6. 멀티스테이지 빌드 미사용 → 빌드 도구가 최종 이미지에 포함됨
7. 헬스체크 미설정 → `HEALTHCHECK CMD curl -f http://localhost:3000/ || exit 1`

**문제 2:** Pod에서 이미지 다이제스트를 사용하도록 변경하시오.

```yaml
# 수정 전
spec:
  containers:
    - name: nginx
      image: nginx:1.25         # 태그 방식 (변경 가능)

# 수정 후
spec:
  containers:
    - name: nginx
      image: nginx@sha256:abc123def456...  # 다이제스트 방식 (불변)

# 다이제스트 확인 방법:
# docker inspect nginx:1.25 | jq '.[0].RepoDigests'
# 또는: crane digest nginx:1.25
```

**문제 3:** API Server에 ImagePolicyWebhook을 활성화하시오.

```bash
# Step 1: API Server 매니페스트 수정
# /etc/kubernetes/manifests/kube-apiserver.yaml

# --enable-admission-plugins에 ImagePolicyWebhook 추가:
#   --enable-admission-plugins=NodeRestriction,ImagePolicyWebhook

# --admission-control-config-file 플래그 추가:
#   --admission-control-config-file=/etc/kubernetes/admission-control/image-policy.yaml

# Step 2: 볼륨 마운트 추가
# volumes:
#   - hostPath:
#       path: /etc/kubernetes/admission-control
#     name: admission-control
# volumeMounts:
#   - mountPath: /etc/kubernetes/admission-control
#     name: admission-control
#     readOnly: true

# Step 3: API Server 재시작 확인
# crictl ps | grep kube-apiserver
```

### CKS 시험 팁: Supply Chain Security 빠른 풀이

```
Supply Chain Security 체크리스트
═══════════════════════════════

1. Trivy 스캔 문제:
   trivy image <이미지명> --severity CRITICAL,HIGH
   → 결과에서 CRITICAL 취약점 식별하고 패치된 버전으로 업데이트

2. Dockerfile 수정 문제:
   □ FROM: 버전 태그 + 최소 이미지
   □ USER: non-root
   □ COPY: 선택적 복사 + .dockerignore
   □ 멀티스테이지 빌드
   □ capabilities 제거

3. ImagePolicyWebhook 문제:
   □ admission-control-config-file 설정
   □ enable-admission-plugins에 추가
   □ 볼륨 마운트 (hostPath)
   □ defaultAllow: false (보안 우선)

4. 이미지 다이제스트 문제:
   □ 태그 → sha256 다이제스트로 변경
   □ imagePullPolicy: Always 확인
```

### Static Analysis 도구 상세: conftest

```bash
# conftest: OPA Rego로 YAML/Dockerfile/Terraform 등을 검증하는 도구

# Dockerfile 정책 검증
conftest test Dockerfile --policy policy/

# Kubernetes YAML 정책 검증
conftest test deployment.yaml --policy policy/

# 정책 파일 예시 (policy/base.rego)
# package main
#
# deny[msg] {
#   input.kind == "Deployment"
#   not input.spec.template.spec.securityContext.runAsNonRoot
#   msg := "Deployment must set runAsNonRoot to true"
# }
#
# deny[msg] {
#   input.kind == "Deployment"
#   container := input.spec.template.spec.containers[_]
#   not container.resources.limits
#   msg := sprintf("Container '%s' must have resource limits", [container.name])
# }
```

**동작 원리:** conftest vs kubesec:
1. **kubesec**: K8s YAML 전용, 기본 규칙으로 빠르게 보안 점수 확인
2. **conftest**: 범용, Rego로 커스텀 정책 작성 가능, CI/CD 연동 용이
3. CKS 시험에서는 kubesec의 출력 해석과 conftest의 기본 사용법을 이해하면 충분

### Private Registry 접근 설정

```yaml
# Private Registry 인증 Secret 생성
# kubectl create secret docker-registry my-registry-cred \
#   --docker-server=registry.example.com \
#   --docker-username=admin \
#   --docker-password=secret123 \
#   --docker-email=admin@example.com

# Pod에서 Private Registry 이미지 사용
apiVersion: v1
kind: Pod
metadata:
  name: private-image-pod
spec:
  imagePullSecrets:                          # 레지스트리 인증 정보
    - name: my-registry-cred                 # 위에서 생성한 Secret 이름
  containers:
    - name: app
      image: registry.example.com/myapp:1.0  # Private Registry 이미지
      imagePullPolicy: Always                # 항상 최신 이미지 확인
```

**동작 원리:** imagePullPolicy 옵션:
1. `Always`: 매번 레지스트리에서 이미지를 확인 (다이제스트 비교)
2. `IfNotPresent`: 로컬에 이미지가 없을 때만 다운로드 (기본값)
3. `Never`: 로컬 이미지만 사용 (다운로드 안 함)
4. `:latest` 태그를 사용하면 자동으로 `Always`가 적용된다

### Admission Controller 종류와 순서

```
Admission Controller 실행 순서
═════════════════════════════

클라이언트 요청 → 인증(Authentication) → 인가(Authorization)
    │
    ▼
┌──────────────────────────────────┐
│ Mutating Admission Webhooks      │  ← 요청을 수정한다
│ (순서대로 실행)                    │
│ - Istio sidecar injection        │
│ - Default ServiceAccount 설정     │
│ - Default StorageClass 설정       │
└──────────────┬───────────────────┘
               │
               ▼
┌──────────────────────────────────┐
│ Object Schema Validation         │  ← YAML 스키마 검증
└──────────────┬───────────────────┘
               │
               ▼
┌──────────────────────────────────┐
│ Validating Admission Webhooks    │  ← 요청을 검증한다 (거부 가능)
│ (병렬 실행 가능)                   │
│ - Pod Security Admission         │
│ - ResourceQuota                  │
│ - OPA Gatekeeper                 │
│ - ImagePolicyWebhook             │
└──────────────┬───────────────────┘
               │
               ▼
         etcd에 저장

CKS 시험에서 중요한 Admission Controller:
  - NodeRestriction: kubelet이 자신의 노드/Pod만 수정 가능
  - PodSecurity: Pod Security Standards 적용
  - ImagePolicyWebhook: 이미지 정책 검증
  - EventRateLimit: API 요청 속도 제한
```

### 연습 문제: 추가 Supply Chain 시나리오

**문제 4:** Admission Controller에서 ImagePolicyWebhook의 `defaultAllow` 옵션의 의미를 설명하시오.

**정답:**
- `defaultAllow: true` (fail-open): 웹훅 장애 시 이미지 허용 → 가용성 우선
- `defaultAllow: false` (fail-close): 웹훅 장애 시 이미지 거부 → 보안 우선
- CKS 시험에서는 보안 우선이므로 `defaultAllow: false`가 정답인 경우가 많다

**문제 5:** 다음 Dockerfile을 보안 관점에서 개선하시오.

```dockerfile
# 수정 전
FROM python:3.11
WORKDIR /app
COPY . .
RUN pip install -r requirements.txt
EXPOSE 5000
CMD ["python", "app.py"]
```

```dockerfile
# 수정 후
FROM python:3.11-slim AS builder        # slim 이미지 사용
WORKDIR /app
COPY requirements.txt .                  # 의존성 파일만 먼저 복사
RUN pip install --no-cache-dir --user -r requirements.txt  # 캐시 제거

FROM python:3.11-slim                    # 멀티스테이지
WORKDIR /app
COPY --from=builder /root/.local /root/.local  # 의존성만 복사
COPY . .
RUN useradd -m appuser                   # non-root 유저 생성
USER appuser                             # non-root로 실행
ENV PATH=/root/.local/bin:$PATH
EXPOSE 5000
HEALTHCHECK CMD curl -f http://localhost:5000/ || exit 1  # 헬스체크 추가
CMD ["python", "app.py"]
```
