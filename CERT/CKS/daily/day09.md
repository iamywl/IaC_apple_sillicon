# CKS Day 9: Supply Chain Security (1/2) - Trivy, Cosign, ImagePolicyWebhook, Dockerfile 보안

> 학습 목표 | CKS 도메인: Supply Chain Security (20%) | 예상 소요 시간: 2시간

---

## 오늘의 학습 목표

- Trivy를 사용하여 컨테이너 이미지 취약점을 스캔할 수 있다
- 이미지 서명 및 검증(Cosign)의 개념을 이해한다
- ImagePolicyWebhook Admission Controller를 설정할 수 있다
- 이미지 다이제스트 사용으로 이미지 무결성을 보장한다
- Dockerfile 보안 문제를 식별하고 수정할 수 있다
- Static Analysis 도구(kubesec, conftest)를 사용할 수 있다

---

## 1. 이미지 취약점 스캐닝 (Trivy)

### 1.1 컨테이너 이미지 취약점 분석 개요

```
이미지 취약점 스캐닝 - Software Composition Analysis(SCA)
═══════════════════════════════════════════════════════════

컨테이너 이미지는 base image, OS 패키지, 언어별 라이브러리 등 다수의
소프트웨어 컴포넌트를 포함한다. 각 컴포넌트에 공개된 취약점(CVE - Common
Vulnerabilities and Exposures)이 존재할 수 있으며, 이미지를 통해 배포된
모든 워크로드가 해당 취약점에 노출된다.

예: nginx:1.21 이미지에 포함된 OpenSSL 라이브러리에 CVE-2023-44487이 존재하면
  → 해당 이미지를 사용하는 모든 Pod가 취약점에 노출
  → CVSS 점수에 따라 원격 코드 실행(RCE), 서비스 거부(DoS) 등의 위험 존재

Trivy는 Aqua Security가 개발한 SCA(Software Composition Analysis) 도구로,
이미지 레이어를 언패킹하여 패키지 매니저 DB(dpkg, apk, rpm)와 언어별
의존성 파일(package-lock.json, go.sum 등)을 파싱한 뒤, NVD/GitHub Advisory
DB와 대조하여 알려진 CVE를 탐지한다.
```

### 1.2 Trivy 동작 원리

```
Trivy 스캔 흐름
═══════════════

1. 이미지 레이어 분석
   └─ 각 레이어의 파일시스템 검사
   │
   ▼
2. 패키지/라이브러리 식별
   ├─ OS 패키지: apt, yum, apk으로 설치된 것
   └─ 언어별 패키지: pip, npm, gem, go modules 등
   │
   ▼
3. 취약점 DB와 비교
   ├─ NVD (National Vulnerability Database)
   ├─ GitHub Advisory Database
   └─ 각 OS/언어별 보안 권고
   │
   ▼
4. 결과 출력
   ├─ 취약점 ID (CVE-XXXX-XXXXX)
   ├─ 심각도 (CRITICAL/HIGH/MEDIUM/LOW)
   ├─ 영향받는 패키지 이름/버전
   └─ 수정된 버전 (있는 경우)
```

### 1.3 Trivy 명령어 완전 가이드

```bash
# ═══ 기본 이미지 스캔 ═══
trivy image nginx:1.21
# 모든 심각도의 취약점을 표로 출력

# ═══ 심각도 필터링 (시험에서 가장 많이 사용) ═══
trivy image --severity CRITICAL,HIGH nginx:1.21
# CRITICAL과 HIGH 취약점만 표시
# 시험에서는 보통 "CRITICAL 취약점이 있는 이미지를 찾아라"

# ═══ CI/CD용: 취약점 발견 시 실패 ═══
trivy image --exit-code 1 --severity CRITICAL nginx:1.21
# exit code 1 = CRITICAL 취약점이 있으면 실패
# exit code 0 = 취약점 없음

# ═══ 수정 가능한 취약점만 표시 ═══
trivy image --ignore-unfixed nginx:1.21
# 패치가 존재하는 취약점만 표시 (업그레이드로 해결 가능한 것)

# ═══ 출력 형식 ═══
trivy image --format json -o result.json nginx:1.21       # JSON
trivy image --format table nginx:1.21                      # 테이블 (기본)
trivy image --format template --template "@html.tpl" nginx:1.21  # HTML

# ═══ 파일시스템 스캔 ═══
trivy fs /path/to/project
# 소스코드 디렉토리의 의존성 취약점 검사

# ═══ K8s 클러스터 스캔 ═══
trivy k8s --report summary cluster
# 클러스터 내 모든 이미지의 취약점 요약

# ═══ 설정 파일 스캔 ═══
trivy config /path/to/kubernetes-manifests/
# K8s 매니페스트의 보안 설정 검사

# ═══ SBOM 생성 ═══
trivy image --format cyclonedx -o sbom.cdx.json nginx:1.21   # CycloneDX
trivy image --format spdx-json -o sbom.spdx.json nginx:1.21  # SPDX

# ═══ 특정 취약점 무시 ═══
cat > .trivyignore << 'EOF'
CVE-2023-44487
CVE-2023-39325
EOF
trivy image --ignorefile .trivyignore nginx:1.21
```

### 1.4 심각도 레벨

```
취약점 심각도 레벨
═══════════════════

레벨      | CVSS 점수  | 설명                    | 조치
──────────┼───────────┼────────────────────────┼──────────────
CRITICAL  | 9.0-10.0  | 원격 코드 실행 등        | 즉시 수정 필수
HIGH      | 7.0-8.9   | 정보 유출, 서비스 거부    | 빠른 수정 필요
MEDIUM    | 4.0-6.9   | 제한된 영향              | 계획된 업데이트
LOW       | 0.1-3.9   | 위험도 낮음              | 다음 업데이트
UNKNOWN   | -         | 심각도 미분류             | 수동 평가

CKS 시험에서:
  "CRITICAL 취약점이 있는 이미지를 사용하는 Pod를 삭제하라"
  → trivy image --severity CRITICAL <이미지>로 스캔
  → CRITICAL이 있는 이미지의 Pod를 삭제
```

### 1.5 여러 이미지 일괄 스캔

```bash
# 클러스터의 모든 이미지 스캔
for img in $(kubectl get pods --all-namespaces -o \
  jsonpath='{range .items[*]}{range .spec.containers[*]}{.image}{"\n"}{end}{end}' | \
  sort -u); do
  echo "=========================================="
  echo "Scanning: $img"
  echo "=========================================="
  RESULT=$(trivy image --severity CRITICAL --exit-code 0 "$img" 2>/dev/null | \
    grep -E "Total:|CRITICAL")
  if echo "$RESULT" | grep -q "CRITICAL"; then
    echo "*** CRITICAL 취약점 발견! ***"
  else
    echo "CRITICAL 취약점 없음"
  fi
  echo ""
done
```

---

## 2. 이미지 서명 및 검증

### 2.1 이미지 서명이 필요한 이유

```
이미지 서명 - 디지털 서명 기반 공급망 보안(Supply Chain Security)
══════════════════════════════════════════════════════════════════

이미지 서명은 비대칭 암호화(asymmetric cryptography)를 활용하여
이미지의 출처(provenance)와 무결성(integrity)을 검증하는 메커니즘이다.

공급망 공격(Supply Chain Attack) 시나리오:
1. 공격자가 레지스트리에 악성 이미지를 정상 태그(nginx:1.25)로 푸시
2. 개발자가 해당 태그의 이미지를 pull하여 프로덕션에 배포
3. 악성 페이로드가 런타임에 실행 → 데이터 유출, lateral movement

디지털 서명 검증 흐름:
1. 빌드 파이프라인에서 이미지 다이제스트에 대해 개인 키(private key)로 서명 생성
2. 서명은 OCI 레지스트리에 이미지와 함께 저장 (Cosign은 서명을 별도 태그로 저장)
3. 배포 시 Admission Controller가 공개 키(public key)로 서명의 유효성을 검증
4. 서명 검증 실패 시 Admission DENY → 변조되거나 미서명 이미지의 배포를 차단
```

### 2.2 Cosign (Sigstore 프로젝트)

```bash
# ═══ 키 쌍 생성 ═══
cosign generate-key-pair
# cosign.key (개인 키 - 서명용, 안전하게 보관!)
# cosign.pub (공개 키 - 검증용, 공유 가능)

# ═══ 이미지 서명 ═══
cosign sign --key cosign.key docker.io/myrepo/myimage:v1.0
# 개인 키로 이미지 서명 → 서명이 레지스트리에 저장됨

# ═══ 서명 검증 ═══
cosign verify --key cosign.pub docker.io/myrepo/myimage:v1.0
# 공개 키로 서명 검증
# 유효: 이미지 정보 출력
# 무효: 에러

# ═══ 키 없는 서명 (Keyless Signing, OIDC 기반) ═══
cosign sign docker.io/myrepo/myimage:v1.0
# OIDC 프로바이더(Google, GitHub)로 인증 → Fulcio CA가 임시 인증서 발급
# Rekor 투명성 로그에 기록

cosign verify \
  --certificate-identity=user@company.com \
  --certificate-oidc-issuer=https://accounts.google.com \
  docker.io/myrepo/myimage:v1.0
```

### 2.3 Docker Content Trust (DCT)

```bash
# DCT 활성화
export DOCKER_CONTENT_TRUST=1

# 서명된 이미지만 pull 가능
docker pull nginx:1.25
# 서명이 없으면 pull 실패

# DCT 비활성화
export DOCKER_CONTENT_TRUST=0
```

---

## 3. ImagePolicyWebhook Admission Controller

### 3.1 ImagePolicyWebhook 동작 원리

```
ImagePolicyWebhook 흐름도
═════════════════════════

Pod 생성 요청
     │
     ▼
API Server
     │
     ├─ 인증 → 인가 → Mutating Admission
     │
     ▼
ImagePolicyWebhook (Validating Admission)
     │
     ├─ Pod의 이미지 정보를 추출
     │
     ▼
외부 웹훅 서비스에 이미지 검증 요청
     │
     ├─ 웹훅 서비스가 이미지 검증 (서명, 취약점, 레지스트리 등)
     │
     ├─ 허용(allowed: true): Pod 생성 진행
     ├─ 거부(allowed: false): Pod 생성 거부
     └─ 웹훅 실패:
         ├─ defaultAllow: true  → Pod 생성 허용 (fail-open)
         └─ defaultAllow: false → Pod 생성 거부 (fail-closed, 보안 권장!)
```

### 3.2 ImagePolicyWebhook 설정 구성

```yaml
# ═══════════════════════════════════════════
# 1. AdmissionConfiguration
# 파일: /etc/kubernetes/admission-control/admission-config.yaml
# ═══════════════════════════════════════════
apiVersion: apiserver.config.k8s.io/v1
kind: AdmissionConfiguration
plugins:
- name: ImagePolicyWebhook
  configuration:
    imagePolicy:
      kubeConfigFile: /etc/kubernetes/admission-control/image-policy-webhook.kubeconfig
      # ↑ 웹훅 서비스 연결 정보가 담긴 kubeconfig 파일
      allowTTL: 50                     # 허용 결과 캐시 시간 (초)
      denyTTL: 50                      # 거부 결과 캐시 시간 (초)
      retryBackoff: 500                # 재시도 대기 시간 (밀리초)
      defaultAllow: false              # *** 핵심 설정 ***
      # false = fail-closed: 웹훅 실패/불능 시 이미지 거부 (보안 권장!)
      # true  = fail-open:   웹훅 실패/불능 시 이미지 허용 (위험!)
```

```yaml
# ═══════════════════════════════════════════
# 2. Webhook kubeconfig
# 파일: /etc/kubernetes/admission-control/image-policy-webhook.kubeconfig
# ═══════════════════════════════════════════
apiVersion: v1
kind: Config
clusters:
- name: image-policy-webhook
  cluster:
    server: https://image-policy-webhook.default.svc:8443/image-policy
    # ↑ 웹훅 서비스 URL
    certificate-authority: /etc/kubernetes/admission-control/webhook-ca.crt
    # ↑ 웹훅 서비스의 CA 인증서
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
    # ↑ API Server의 클라이언트 인증서 (mTLS)
    client-key: /etc/kubernetes/pki/apiserver.key
```

### 3.3 API Server에 적용

```yaml
# /etc/kubernetes/manifests/kube-apiserver.yaml에 추가
spec:
  containers:
  - command:
    - kube-apiserver
    # === Admission Plugin 추가 ===
    - --enable-admission-plugins=NodeRestriction,ImagePolicyWebhook
    # ↑ ImagePolicyWebhook을 추가
    - --admission-control-config-file=/etc/kubernetes/admission-control/admission-config.yaml
    # ↑ AdmissionConfiguration 파일 경로

    # === 볼륨 마운트 추가 ===
    volumeMounts:
    - name: admission-control
      mountPath: /etc/kubernetes/admission-control/
      readOnly: true                     # 읽기 전용 (보안)

  # === 볼륨 추가 ===
  volumes:
  - name: admission-control
    hostPath:
      path: /etc/kubernetes/admission-control/
      type: DirectoryOrCreate
```

```bash
# 적용 후 확인
watch crictl ps | grep kube-apiserver
kubectl get nodes  # 정상 동작 확인
```

### 3.4 ValidatingWebhookConfiguration

```yaml
# ═══════════════════════════════════════════
# ValidatingWebhookConfiguration
# ImagePolicyWebhook의 대안으로 사용 가능
# ═══════════════════════════════════════════
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingWebhookConfiguration
metadata:
  name: image-validation
webhooks:
- name: validate-image.example.com
  admissionReviewVersions: ["v1"]        # Admission Review API 버전
  sideEffects: None                      # 부수 효과 없음
  clientConfig:
    service:
      name: image-validator              # 웹훅 서비스 이름
      namespace: security                # 웹훅 서비스 네임스페이스
      path: "/validate"                  # 웹훅 엔드포인트 경로
    caBundle: <base64-encoded-ca>        # 웹훅 서비스 CA 인증서
  rules:
  - operations: ["CREATE", "UPDATE"]     # Pod 생성/수정 시 검사
    apiGroups: [""]
    apiVersions: ["v1"]
    resources: ["pods"]
  failurePolicy: Fail                    # fail-closed (보안 권장)
                                         # Ignore = fail-open
  namespaceSelector:                     # 검사할 네임스페이스 선택
    matchExpressions:
    - key: kubernetes.io/metadata.name
      operator: NotIn
      values: ["kube-system"]            # kube-system 제외
```

---

## 4. 이미지 다이제스트 사용

### 4.1 태그 vs 다이제스트

```
이미지 태그 vs 다이제스트 - 가변 참조 vs 내용 주소 지정(Content Addressable)
═══════════════════════════════════════════════════════════════════════════════

태그(tag) = 가변 포인터(mutable reference)
  - 태그는 이미지 매니페스트에 대한 심볼릭 참조로, 동일 태그가 다른 매니페스트를 가리킬 수 있다
  - nginx:1.25는 레지스트리에서 태그를 재할당하면 다른 이미지를 가리키게 된다
  - 공격자가 레지스트리 접근 권한을 획득하면 태그를 악성 이미지로 재할당할 수 있다

다이제스트(digest) = 내용 주소 지정(content-addressable identifier)
  - 이미지 매니페스트의 SHA-256 해시값으로, 내용이 1비트라도 변경되면 다이제스트가 변경된다
  - 암호학적 해시 함수의 제2역상 저항성(second preimage resistance)에 의해 변조 불가능
  - 이미지의 불변성(immutability)을 보장하는 유일한 참조 방식

nginx:1.25                              → 태그 (가변, 재할당 가능)
nginx@sha256:abc123def456...            → 다이제스트 (불변, 내용 기반)
```

### 4.2 다이제스트 확인 및 사용

```bash
# ═══ 이미지 다이제스트 확인 방법 ═══

# 방법 1: docker inspect
docker inspect --format='{{index .RepoDigests 0}}' nginx:1.25
# nginx@sha256:abc123...

# 방법 2: crane (경량 이미지 도구)
crane digest nginx:1.25
# sha256:abc123...

# 방법 3: kubectl에서 실행 중인 Pod의 다이제스트 확인
kubectl get pod my-pod -o jsonpath='{.status.containerStatuses[0].imageID}'
# docker-pullable://nginx@sha256:abc123...

# 방법 4: skopeo
skopeo inspect docker://nginx:1.25 | jq .Digest
```

```yaml
# ═══════════════════════════════════════════
# 다이제스트로 이미지 지정 (권장)
# ═══════════════════════════════════════════
apiVersion: v1
kind: Pod
metadata:
  name: secure-pod
spec:
  containers:
  - name: app
    image: nginx@sha256:6af79ae5de407283dcea8b00d5c37ace95441fd58a8b1d2aa1ed93f5511bb18c
    # ↑ 다이제스트 지정: 이 해시값의 이미지만 사용
    # 태그가 변경되어도 같은 이미지를 보장
    # 공급망 공격(태그 변조)을 방지

# ═══ BAD: 태그 사용 (비권장) ═══
# - name: app
#   image: nginx:latest   # 매번 다른 이미지일 수 있음!
#   image: nginx:1.25     # 변조될 수 있음!
```

---

## 5. Dockerfile 보안

### 5.1 보안 취약 Dockerfile vs 강화된 Dockerfile

```dockerfile
# ═══════════════════════════════════════════
# BAD: 보안에 취약한 Dockerfile
# CKS에서 "이 Dockerfile의 보안 문제를 찾아 수정하라"로 출제
# ═══════════════════════════════════════════
FROM ubuntu:latest
# 문제 1: latest 태그 → 버전 고정 필요
# 문제 2: ubuntu(큰 이미지) → alpine 또는 distroless 사용

RUN apt-get update && apt-get install -y curl wget vim netcat python3
# 문제 3: 불필요한 패키지(vim, netcat, wget) → 공격 도구가 될 수 있음

ADD . /app
# 문제 4: ADD → COPY 사용 (ADD는 URL 다운로드, tar 자동 압축해제 등 예상치 못한 동작)

WORKDIR /app
RUN pip install -r requirements.txt

EXPOSE 8080
CMD ["python3", "app.py"]
# 문제 5: USER 미지정 → root로 실행됨!
# 문제 6: 멀티스테이지 빌드 미사용 → 빌드 도구가 최종 이미지에 포함
# 문제 7: HEALTHCHECK 없음
```

```dockerfile
# ═══════════════════════════════════════════
# GOOD: 보안이 강화된 Dockerfile
# ═══════════════════════════════════════════

# 1단계: 빌드 스테이지
FROM python:3.12-slim AS builder
# ↑ 특정 버전 태그 고정
# ↑ slim 이미지 (불필요한 패키지 없음)

WORKDIR /app

COPY requirements.txt .
# ↑ ADD 대신 COPY 사용

RUN pip install --no-cache-dir --user -r requirements.txt
# ↑ --no-cache-dir: 캐시 제거로 이미지 크기 줄이기

COPY . .
# ↑ 소스코드 복사 (requirements 먼저 복사하여 캐시 활용)

# 2단계: 프로덕션 스테이지
FROM gcr.io/distroless/python3-debian12:nonroot
# ↑ distroless: 셸 없음, 패키지 매니저 없음 → 공격 표면 최소화
# ↑ nonroot: 기본적으로 non-root 사용자

WORKDIR /app

COPY --from=builder /root/.local /home/nonroot/.local
COPY --from=builder /app .
# ↑ 빌드 스테이지에서 필요한 파일만 복사
# 빌드 도구, 소스코드는 최종 이미지에 포함되지 않음

USER 65532:65532
# ↑ non-root 사용자로 실행 (UID 65532 = nonroot)

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s \
  CMD ["python3", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8080/health')"]
# ↑ 헬스체크 추가

ENTRYPOINT ["python3", "app.py"]
# ↑ CMD 대신 ENTRYPOINT (오버라이드 방지)
```

### 5.2 CKS에서의 Dockerfile 수정 포인트

```
Dockerfile 수정 체크리스트 (CKS 시험)
════════════════════════════════════

1. FROM ubuntu:latest → FROM ubuntu:22.04 또는 alpine, distroless
   → 태그 고정 + 최소 이미지

2. USER 미지정 → USER 1000:1000 또는 USER nonroot
   → non-root 실행

3. 불필요한 패키지 (vim, curl, wget, netcat, nmap)
   → 제거

4. ADD → COPY
   → ADD는 URL 다운로드, tar 자동 해제 등 예측 불가능한 동작

5. 멀티스테이지 빌드 미사용 → 멀티스테이지 적용
   → 빌드 도구가 최종 이미지에 포함되지 않게

6. 민감한 정보 하드코딩 (ENV PASSWORD=secret)
   → Secret이나 환경변수로 주입

7. .dockerignore 없음
   → .git, .env, 테스트 파일 등 제외

8. 루트 파일시스템에 쓰기 가능
   → 읽기 전용으로 설정 (K8s SecurityContext에서)
```

---

## 6. Static Analysis 도구

### 6.1 kubesec - 매니페스트 보안 점수

```bash
# 로컬 스캔
kubesec scan pod.yaml

# 온라인 API 스캔
curl -sSX POST --data-binary @pod.yaml https://v2.kubesec.io/scan | jq .

# 결과 예시:
# {
#   "score": 3,
#   "scoring": {
#     "passed": [
#       { "id": "RunAsNonRoot", "selector": ".spec.securityContext.runAsNonRoot" },
#       { "id": "ReadOnlyRootFilesystem", "selector": ".spec.containers[].securityContext.readOnlyRootFilesystem" }
#     ],
#     "advise": [
#       { "id": "LimitsCPU", "reason": "CPU 제한이 없으면 DoS 공격에 취약" },
#       { "id": "CapDropAll", "reason": "capabilities를 drop하지 않으면 권한 상승 가능" }
#     ]
#   }
# }
```

### 6.2 conftest - OPA 기반 정책 테스트

```bash
# 정책 파일 작성
mkdir -p policy

cat > policy/deny.rego <<'EOF'
package main

deny[msg] {
  input.kind == "Deployment"
  not input.spec.template.spec.securityContext.runAsNonRoot
  msg := "Deployment는 runAsNonRoot: true가 필요합니다"
}

deny[msg] {
  input.kind == "Pod"
  container := input.spec.containers[_]
  container.image == "nginx:latest"
  msg := "latest 태그 사용 금지"
}
EOF

# 스캔 실행
conftest test deployment.yaml --policy policy/
# FAIL - deployment.yaml - Deployment는 runAsNonRoot: true가 필요합니다
```

---

---

## tart-infra 실습

### 실습 환경 설정

```bash
# dev 클러스터 접속
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/dev.yaml
kubectl config current-context
# dev

# demo 네임스페이스의 Pod와 이미지 확인
kubectl get pods -n demo -o custom-columns='NAME:.metadata.name,IMAGE:.spec.containers[*].image'
# NAME                        IMAGE
# nginx-xxxx                  nginx:1.25
# httpbin-v1-xxxx             kennethreitz/httpbin
# httpbin-v2-xxxx             kennethreitz/httpbin
# postgresql-xxxx             postgres:15
# redis-xxxx                  redis:7
# rabbitmq-xxxx               rabbitmq:3-management
# keycloak-xxxx               quay.io/keycloak/keycloak:...
```

---

### 실습 1: demo 네임스페이스 이미지 취약점 스캔

demo 네임스페이스에서 사용 중인 모든 컨테이너 이미지를 Trivy로 스캔하여 CRITICAL/HIGH 취약점을 식별한다.

```bash
# demo 네임스페이스의 모든 고유 이미지 추출
IMAGES=$(kubectl get pods -n demo -o jsonpath='{range .items[*]}{range .spec.containers[*]}{.image}{"\n"}{end}{end}' | sort -u)

echo "$IMAGES"
# kennethreitz/httpbin
# nginx:1.25
# postgres:15
# quay.io/keycloak/keycloak:...
# rabbitmq:3-management
# redis:7

# 각 이미지에 대해 CRITICAL 취약점 스캔
for img in $IMAGES; do
  echo "=========================================="
  echo "Scanning: $img"
  echo "=========================================="
  trivy image --severity CRITICAL --no-progress "$img" 2>/dev/null | tail -20
  echo ""
done
```

예상 출력 (일부):
```
==========================================
Scanning: nginx:1.25
==========================================
nginx:1.25 (debian 12.2)
Total: 2 (CRITICAL: 2)

┌──────────────┬──────────────────┬──────────┬────────────┬──────────────┐
│   Library    │  Vulnerability   │ Severity │  Installed │    Fixed     │
├──────────────┼──────────────────┼──────────┼────────────┼──────────────┤
│ libssl3      │ CVE-2024-XXXXX   │ CRITICAL │ 3.0.11-1   │ 3.0.13-1    │
│ libcurl4     │ CVE-2024-YYYYY   │ CRITICAL │ 7.88.1-10  │ 7.88.1-12   │
└──────────────┴──────────────────┴──────────┴────────────┴──────────────┘
```

```bash
# CRITICAL 취약점이 있는 이미지를 사용하는 Pod 식별
for img in $IMAGES; do
  COUNT=$(trivy image --severity CRITICAL --exit-code 0 --quiet "$img" 2>/dev/null | grep -c "CRITICAL")
  if [ "$COUNT" -gt 0 ]; then
    echo "[CRITICAL] $img → 사용 중인 Pod:"
    kubectl get pods -n demo -o jsonpath="{range .items[*]}{range .spec.containers[*]}{.image}{'\t'}{end}{.metadata.name}{'\n'}{end}" | grep "$img"
  fi
done
```

**동작 원리:**
- Trivy는 이미지의 각 레이어를 분석하여 OS 패키지(dpkg, apk, rpm)와 언어별 의존성을 파싱한다
- NVD, GitHub Advisory DB 등과 대조하여 알려진 CVE를 매칭한다
- `--severity CRITICAL`은 CVSS 9.0 이상의 취약점만 필터링한다
- CKS 시험에서는 "CRITICAL 취약점이 있는 이미지를 사용하는 Pod를 삭제하라"는 문제가 빈번하게 출제된다

---

### 실습 2: 이미지 다이제스트 기반 무결성 확인

demo 네임스페이스에서 실행 중인 Pod의 이미지가 태그 기반인지 다이제스트 기반인지 확인하고, 다이제스트를 추출한다.

```bash
# 실행 중인 Pod의 이미지 다이제스트 확인
kubectl get pods -n demo -o jsonpath='{range .items[*]}
Pod: {.metadata.name}
  spec.image: {.spec.containers[0].image}
  status.imageID: {.status.containerStatuses[0].imageID}
{end}'
```

예상 출력:
```
Pod: nginx-xxxx
  spec.image: nginx:1.25
  status.imageID: docker-pullable://nginx@sha256:6af79ae5de407283dcea8b00d5c37ace95441fd58...

Pod: redis-xxxx
  spec.image: redis:7
  status.imageID: docker-pullable://redis@sha256:e422889e156278e...
```

```bash
# 태그 기반 이미지 사용 Pod 식별 (다이제스트 미사용 = 보안 위험)
kubectl get pods -n demo -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.containers[0].image}{"\n"}{end}' | \
  grep -v "@sha256:"
# nginx-xxxx    nginx:1.25
# redis-xxxx    redis:7
# → 모든 Pod가 태그 기반 → 태그 변조 공격에 취약
```

**동작 원리:**
- `spec.containers[].image`에는 매니페스트에 지정한 이미지 참조(태그 또는 다이제스트)가 기록된다
- `status.containerStatuses[].imageID`에는 실제 pull된 이미지의 다이제스트가 기록된다
- 태그는 레지스트리에서 재할당 가능한 가변 참조이므로, 공급망 공격 시 동일 태그로 악성 이미지를 배포할 수 있다
- 다이제스트(SHA-256)는 이미지 매니페스트의 해시값으로, 내용이 변경되면 다이제스트도 변경되어 변조를 탐지할 수 있다

---

### 실습 3: Dockerfile 보안 점검 체크리스트 적용

platform 클러스터의 Jenkins 파이프라인에서 사용할 이미지 빌드 시 적용해야 할 보안 체크리스트를 demo 네임스페이스 이미지에 대입하여 검토한다.

```bash
# platform 클러스터에서 Jenkins 확인
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/platform.yaml

kubectl get pods -n jenkins -o wide
# Jenkins가 CI/CD 파이프라인에서 이미지 빌드를 수행

# dev 클러스터로 복귀
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/dev.yaml

# demo 네임스페이스 이미지의 USER 설정 확인 (non-root 여부)
for img in $(kubectl get pods -n demo -o jsonpath='{range .items[*]}{.spec.containers[0].image}{"\n"}{end}' | sort -u); do
  USER_INFO=$(trivy image --format json "$img" 2>/dev/null | jq -r '.Results[0].Target // "N/A"')
  echo "Image: $img → Base: $USER_INFO"
done
```

```bash
# 이미지 레이어 수 및 크기 확인 (최소 이미지 사용 여부)
for img in $(kubectl get pods -n demo -o jsonpath='{range .items[*]}{.spec.containers[0].image}{"\n"}{end}' | sort -u); do
  echo "=== $img ==="
  trivy image --list-all-pkgs --format json "$img" 2>/dev/null | \
    jq '{target: .Results[0].Target, packages: (.Results[0].Packages // [] | length)}'
done
```

예상 출력:
```
=== nginx:1.25 ===
{
  "target": "nginx:1.25 (debian 12.2)",
  "packages": 142
}
=== redis:7 ===
{
  "target": "redis:7 (debian 12.2)",
  "packages": 98
}
```

**동작 원리:**
- 패키지 수가 많을수록 공격 표면(attack surface)이 넓어진다
- distroless 또는 alpine 기반 이미지는 패키지 수가 적어 취약점 노출을 최소화한다
- CKS 시험에서 Dockerfile 보안 문제를 식별하는 문제가 출제되며, latest 태그 사용, USER 미지정, 불필요한 패키지 설치, ADD 대신 COPY 사용 등의 포인트를 점검해야 한다
- Jenkins 파이프라인에 Trivy 스캔을 통합하면 CI 단계에서 취약한 이미지의 빌드를 자동 차단할 수 있다

> **내일 예고:** Day 10에서는 Supply Chain Security 도메인의 시험 출제 패턴, 실전 문제 11개, tart-infra 실습을 다룬다.
