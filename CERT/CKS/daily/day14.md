# CKS Day 14: 종합 모의시험 (2/2) - 문제 13~20, 채점, 합격 전략, 치트시트

> 학습 목표 | CKS 종합 모의시험 후반부 | 예상 소요 시간: 2시간

---

## 오늘의 학습 목표

- 모의시험 문제 13~20을 풀어본다 (RuntimeClass, Trivy, ImagePolicyWebhook, Dockerfile, Falco, Audit Log, 인시던트 대응)
- 채점 기준으로 자가 평가를 수행한다
- 합격 전략과 시간 관리를 정리한다
- 종합 치트시트로 핵심 내용을 복습한다

---


### 문제 13. [Microservice Vulnerabilities - 4점] RuntimeClass 설정 (gVisor)

**컨텍스트:** `kubectl config use-context dev`

**문제:**
gVisor(runsc)를 사용하는 RuntimeClass `gvisor`를 생성하고, `sandbox-pod`(nginx:1.25)에 적용하라.

<details>
<summary>풀이</summary>

**시험 출제 의도:** RuntimeClass를 생성하고 Pod에 적용하는 과정을 평가한다. gVisor는 컨테이너와 호스트 커널 사이에 추가 격리 계층을 제공한다.

**gVisor 동작 원리:**
```
[일반 컨테이너]
  컨테이너 → 시스템 콜 → 호스트 커널
  (격리 약함: 커널 취약점으로 호스트 침투 가능)

[gVisor 컨테이너]
  컨테이너 → 시스템 콜 → gVisor(Sentry) → 제한된 시스템 콜만 → 호스트 커널
  (추가 격리: gVisor가 시스템 콜을 인터셉트하여 필터링)
```

```yaml
# 1. RuntimeClass 생성
apiVersion: node.k8s.io/v1
kind: RuntimeClass
metadata:
  name: gvisor                   # Pod에서 참조할 이름
handler: runsc                   # containerd의 런타임 핸들러 이름
                                 # /etc/containerd/config.toml에 정의되어 있어야 함
```

```yaml
# 2. Pod에 RuntimeClass 적용
apiVersion: v1
kind: Pod
metadata:
  name: sandbox-pod
spec:
  runtimeClassName: gvisor       # RuntimeClass 이름 참조
  containers:
  - name: app
    image: nginx:1.25
```

```bash
kubectl apply -f runtimeclass.yaml
kubectl apply -f sandbox-pod.yaml

# 확인
kubectl get runtimeclass
kubectl get pod sandbox-pod -o jsonpath='{.spec.runtimeClassName}'
# gvisor

# gVisor 환경에서는 커널 버전이 다르게 나타남
kubectl exec sandbox-pod -- uname -r
# 4.4.0 (gVisor의 가상 커널 버전)
# 호스트 커널 버전과 다르면 gVisor가 작동하는 것
```

**채점 기준:**
- [ ] RuntimeClass가 handler: runsc로 올바르게 생성됨 (2점)
- [ ] Pod에 runtimeClassName: gvisor 적용됨 (2점)

</details>

---

### 문제 14. [Supply Chain Security - 6점] Trivy 이미지 스캔

**컨텍스트:** `kubectl config use-context dev`

**문제:**
dev 클러스터의 `scan-ns` 네임스페이스에 다음 4개의 Pod가 있다: `web1`(nginx:1.19), `web2`(nginx:1.25), `cache1`(redis:6), `cache2`(redis:7).

Trivy를 사용하여 각 이미지를 스캔하고, **CRITICAL 취약점**이 있는 이미지를 사용하는 Pod를 삭제하라. 스캔 결과를 `/tmp/trivy-results.txt`에 저장하라.

<details>
<summary>풀이</summary>

**시험 출제 의도:** Trivy를 사용하여 이미지 취약점을 스캔하고, CRITICAL 취약점이 있는 이미지를 식별하여 적절한 조치를 취할 수 있는지 평가한다.

**Trivy 스캔 흐름:**
```
trivy image nginx:1.19
    │
    ├── 1. 이미지 레이어 다운로드/캐시
    ├── 2. OS 패키지 분석 (apt, apk, yum 등)
    ├── 3. 언어 패키지 분석 (pip, npm, go 등)
    ├── 4. 취약점 DB 매칭
    └── 5. 결과 출력
         ├── CRITICAL  ← 즉시 조치 필요
         ├── HIGH
         ├── MEDIUM
         ├── LOW
         └── UNKNOWN
```

```bash
kubectl config use-context dev

# 각 이미지 스캔 (CRITICAL만 필터링)
trivy image --severity CRITICAL nginx:1.19 2>/dev/null | tee -a /tmp/trivy-results.txt
trivy image --severity CRITICAL nginx:1.25 2>/dev/null | tee -a /tmp/trivy-results.txt
trivy image --severity CRITICAL redis:6 2>/dev/null | tee -a /tmp/trivy-results.txt
trivy image --severity CRITICAL redis:7 2>/dev/null | tee -a /tmp/trivy-results.txt

# 빠른 스캔 (결과 요약만)
trivy image --severity CRITICAL --exit-code 1 nginx:1.19 2>/dev/null
echo "nginx:1.19 exit code: $?"  # 1 = CRITICAL 존재, 0 = 없음

trivy image --severity CRITICAL --exit-code 1 nginx:1.25 2>/dev/null
echo "nginx:1.25 exit code: $?"

trivy image --severity CRITICAL --exit-code 1 redis:6 2>/dev/null
echo "redis:6 exit code: $?"

trivy image --severity CRITICAL --exit-code 1 redis:7 2>/dev/null
echo "redis:7 exit code: $?"

# CRITICAL 취약점이 있는 Pod 삭제
# (일반적으로 구버전에 더 많은 CRITICAL이 있음)
kubectl delete pod web1 -n scan-ns     # nginx:1.19
kubectl delete pod cache1 -n scan-ns   # redis:6

# 남은 Pod 확인
kubectl get pods -n scan-ns
# web2 (nginx:1.25) - Running
# cache2 (redis:7) - Running
```

**Trivy 주요 옵션:**
```bash
# severity 필터링
trivy image --severity CRITICAL,HIGH <image>

# exit-code로 CI/CD 연동
trivy image --severity CRITICAL --exit-code 1 <image>
# exit 1 = 해당 severity 취약점 존재 → CI/CD 파이프라인 실패

# 출력 형식
trivy image --format json <image>        # JSON
trivy image --format table <image>       # 테이블 (기본)

# 특정 취약점 무시
trivy image --ignore-unfixed <image>     # 수정 버전이 없는 취약점 무시

# SBOM (Software Bill of Materials) 생성
trivy image --format spdx-json <image>
```

**채점 기준:**
- [ ] Trivy로 4개 이미지를 모두 스캔 (2점)
- [ ] CRITICAL 취약점이 있는 이미지를 올바르게 식별 (2점)
- [ ] 해당 Pod만 삭제 (취약점 없는 Pod는 유지) (1점)
- [ ] 스캔 결과가 /tmp/trivy-results.txt에 저장됨 (1점)

</details>

---

### 문제 15. [Supply Chain Security - 7점] ImagePolicyWebhook 설정

**컨텍스트:** `kubectl config use-context staging`

**문제:**
ImagePolicyWebhook Admission Controller를 활성화하라.
1. `/etc/kubernetes/admission-control/` 디렉토리에 설정 파일을 확인/수정하라
2. `defaultAllow`를 `false`(fail-closed)로 설정하라
3. API Server에 적용하라
4. 적용 후 허용되지 않은 이미지로 Pod 생성 시도하여 거부되는지 확인하라

<details>
<summary>풀이</summary>

**시험 출제 의도:** ImagePolicyWebhook은 CKS에서 가장 어려운 문제 중 하나다. AdmissionConfiguration, webhook 서비스 설정, API Server 매니페스트 수정을 모두 정확히 해야 한다.

**ImagePolicyWebhook 동작 원리:**
```
Pod 생성 요청 (kubectl apply)
    │
    ▼
[API Server]
    │ enable-admission-plugins에 ImagePolicyWebhook 포함?
    │
    ▼
[AdmissionConfiguration]
    │ admission-config.yaml 로드
    │
    ▼
[ImagePolicyWebhook]
    │ kubeconfig로 외부 webhook 서비스 호출
    │ Pod의 이미지 정보 전송
    │
    ▼
[Webhook 서비스]
    │ 이미지 정책 확인 (허용/거부)
    │
    ├── 허용 → Pod 생성 진행
    ├── 거부 → 에러 반환
    └── Webhook 실패 시:
        ├── defaultAllow: true  → Pod 생성 허용 (fail-open)
        └── defaultAllow: false → Pod 생성 거부 (fail-closed) ← 보안적으로 권장
```

```bash
ssh admin@staging-master

# 1. 설정 파일 확인
ls -la /etc/kubernetes/admission-control/
# admission-config.yaml
# imagepolicy-kubeconfig.yaml
```

**admission-config.yaml (확인/수정):**
```yaml
# /etc/kubernetes/admission-control/admission-config.yaml
apiVersion: apiserver.config.k8s.io/v1
kind: AdmissionConfiguration
plugins:
- name: ImagePolicyWebhook
  configuration:
    imagePolicy:
      kubeConfigFile: /etc/kubernetes/admission-control/imagepolicy-kubeconfig.yaml
      allowTTL: 50               # 허용 결과 캐시 시간(초)
      denyTTL: 50                # 거부 결과 캐시 시간(초)
      retryBackoff: 500          # 재시도 간격(밀리초)
      defaultAllow: false        # ← 반드시 false (fail-closed)!
```

**imagepolicy-kubeconfig.yaml (확인):**
```yaml
# /etc/kubernetes/admission-control/imagepolicy-kubeconfig.yaml
apiVersion: v1
kind: Config
clusters:
- cluster:
    certificate-authority: /etc/kubernetes/admission-control/webhook-ca.crt
    server: https://image-policy-webhook.default.svc:443/image-policy
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
    client-certificate: /etc/kubernetes/admission-control/api-server-client.crt
    client-key: /etc/kubernetes/admission-control/api-server-client.key
```

```bash
# 2. API Server 매니페스트 수정
cp /etc/kubernetes/manifests/kube-apiserver.yaml /tmp/kube-apiserver.yaml.bak
vi /etc/kubernetes/manifests/kube-apiserver.yaml
```

**추가/수정할 내용:**
```yaml
spec:
  containers:
  - command:
    - kube-apiserver
    # ... 기존 플래그 ...
    - --enable-admission-plugins=NodeRestriction,ImagePolicyWebhook
    - --admission-control-config-file=/etc/kubernetes/admission-control/admission-config.yaml
    volumeMounts:
    # ... 기존 mounts ...
    - name: admission-control
      mountPath: /etc/kubernetes/admission-control/
      readOnly: true
  volumes:
  # ... 기존 volumes ...
  - name: admission-control
    hostPath:
      path: /etc/kubernetes/admission-control/
      type: DirectoryOrCreate
```

```bash
# 3. API Server 재시작 대기
watch crictl ps | grep kube-apiserver
kubectl get nodes

# 4. 검증: 허용되지 않은 이미지로 Pod 생성 시도
kubectl run test-image --image=evil-registry.com/malware:latest
# Error from server (Forbidden): ...image policy webhook denied the request
```

**채점 기준:**
- [ ] ImagePolicyWebhook이 enable-admission-plugins에 포함 (1.5점)
- [ ] admission-control-config-file 설정됨 (1점)
- [ ] defaultAllow: false (fail-closed) (1.5점)
- [ ] volume/volumeMount 올바름 (1.5점)
- [ ] API server 정상 동작 (1.5점)

</details>

---

### 문제 16. [Supply Chain Security - 4점] 이미지 다이제스트 강제

**컨텍스트:** `kubectl config use-context prod`

**문제:**
`production` 네임스페이스의 Deployment `web-app`이 `nginx:1.25` 태그를 사용하고 있다. 이를 이미지 다이제스트(@sha256:...)로 변경하라. 실제 다이제스트를 조회하여 적용하라.

<details>
<summary>풀이</summary>

**시험 출제 의도:** 태그는 변경될 수 있어 동일한 태그가 다른 이미지를 가리킬 수 있다. 다이제스트를 사용하면 이미지를 고정하여 supply chain 공격을 방지할 수 있다.

**태그 vs 다이제스트:**
```
[태그 사용 - 위험]
nginx:1.25
  ├── 오늘: sha256:abc123... (정상 이미지)
  └── 내일: sha256:xyz789... (공격자가 변경한 이미지!)
  → 같은 태그인데 다른 이미지가 실행될 수 있음

[다이제스트 사용 - 안전]
nginx@sha256:abc123...
  └── 항상: sha256:abc123... (고정된 이미지)
  → 이미지가 변경되면 pull 실패 → 안전
```

```bash
kubectl config use-context prod

# 1. 현재 이미지 확인
kubectl get deploy web-app -n production -o jsonpath='{.spec.template.spec.containers[0].image}'
# nginx:1.25

# 2. 이미지 다이제스트 조회
# 방법 1: docker/crane으로 조회 (시험 환경에서 사용 가능한 도구 확인)
crane digest nginx:1.25
# sha256:6db391d1c0cfb...

# 방법 2: skopeo로 조회
skopeo inspect docker://docker.io/library/nginx:1.25 | jq -r '.Digest'
# sha256:6db391d1c0cfb...

# 방법 3: 이미 pull된 이미지에서 확인
crictl images | grep nginx
# docker.io/library/nginx   1.25   sha256:6db391d1c0cfb...

# 3. Deployment 이미지를 다이제스트로 변경
kubectl set image deployment/web-app \
  app=nginx@sha256:6db391d1c0cfb30588ba0b5698e6b0e5ddc6fe47fc66e07daad3f2fbb2e2f3e0 \
  -n production

# 또는 kubectl edit 사용
kubectl edit deploy web-app -n production
# image: nginx@sha256:6db391d1c0cfb30588ba0b5698e6b0e5ddc6fe47fc66e07daad3f2fbb2e2f3e0

# 4. 검증
kubectl get deploy web-app -n production -o jsonpath='{.spec.template.spec.containers[0].image}'
# nginx@sha256:6db391d1c0cfb...
```

**채점 기준:**
- [ ] 이미지 다이제스트를 올바르게 조회 (1점)
- [ ] Deployment 이미지가 다이제스트로 변경됨 (2점)
- [ ] Pod가 정상 동작 (1점)

</details>

---

### 문제 17. [Supply Chain Security - 3점] Dockerfile 보안 개선

**컨텍스트:** 해당 없음 (로컬 작업)

**문제:**
아래 Dockerfile의 보안 문제를 찾아 수정하라. 수정된 Dockerfile을 `/tmp/Dockerfile-secure`로 저장하라.

```dockerfile
FROM ubuntu:20.04
RUN apt-get update && apt-get install -y python3 python3-pip curl wget netcat
COPY . /app
WORKDIR /app
RUN pip3 install -r requirements.txt
EXPOSE 8080
CMD ["python3", "app.py"]
```

<details>
<summary>풀이</summary>

**시험 출제 의도:** Dockerfile의 보안 취약점을 식별하고 개선할 수 있는지 평가한다.

**보안 문제 분석:**
```
문제 1: ubuntu 대신 경량 이미지 사용해야 함 → distroless/alpine
문제 2: 불필요한 패키지 설치 (curl, wget, netcat) → 공격 도구
문제 3: root로 실행 → 비root 사용자 필요
문제 4: multi-stage build 미사용 → 빌드 도구가 최종 이미지에 포함
문제 5: COPY . → .dockerignore 없이 모든 파일 복사 (민감 파일 포함 가능)
```

```dockerfile
# /tmp/Dockerfile-secure

# Stage 1: 빌드 단계
FROM python:3.11-slim AS builder
WORKDIR /app
COPY requirements.txt .
RUN pip3 install --no-cache-dir --user -r requirements.txt

# Stage 2: 실행 단계 (경량 이미지)
FROM python:3.11-slim

# 비root 사용자 생성
RUN groupadd -r appgroup && useradd -r -g appgroup -d /app -s /sbin/nologin appuser

# 빌드 단계에서 패키지만 복사
COPY --from=builder /root/.local /home/appuser/.local

# 애플리케이션 코드만 복사
WORKDIR /app
COPY --chown=appuser:appgroup app.py .

# 비root 사용자로 전환
USER appuser

# PATH 설정
ENV PATH=/home/appuser/.local/bin:$PATH

EXPOSE 8080

# 헬스체크 추가
HEALTHCHECK --interval=30s --timeout=3s \
  CMD python3 -c "import urllib.request; urllib.request.urlopen('http://localhost:8080/health')" || exit 1

CMD ["python3", "app.py"]
```

**개선 요약:**
| 항목 | 원본 | 개선 |
|------|------|------|
| 베이스 이미지 | ubuntu:20.04 | python:3.11-slim |
| 불필요 패키지 | curl, wget, netcat | 제거 |
| 실행 사용자 | root (기본값) | appuser (비root) |
| 빌드 방식 | 단일 스테이지 | multi-stage build |
| 파일 복사 | COPY . (전체) | 필요한 파일만 |
| 캐시 | 있음 | --no-cache-dir |

**채점 기준:**
- [ ] 비root 사용자로 실행 (USER 지시어) (1점)
- [ ] 불필요한 패키지 제거 (0.5점)
- [ ] 경량 베이스 이미지 사용 또는 multi-stage build (1점)
- [ ] 파일이 /tmp/Dockerfile-secure에 저장됨 (0.5점)

</details>

---

### 문제 18. [Runtime Security - 7점] Falco 커스텀 룰 작성

**컨텍스트:** `kubectl config use-context dev`

**문제:**
`/etc/falco/falco_rules.local.yaml`에 다음 세 가지 Falco 룰을 추가하라:

1. `Detect Shell in Container`: 컨테이너에서 셸(bash, sh, zsh)이 실행되면 WARNING
2. `Detect Sensitive File Read`: 컨테이너에서 `/etc/shadow`를 읽으면 CRITICAL
3. `Detect Package Management`: 컨테이너에서 패키지 관리자(apt, yum, apk)가 실행되면 ERROR

<details>
<summary>풀이</summary>

**시험 출제 의도:** Falco 룰의 구조(condition, output, priority)를 이해하고, 다양한 탐지 시나리오에 맞는 룰을 작성할 수 있는지 평가한다.

**Falco 룰 구조:**
```
rule: 룰 이름                    ← 고유한 이름
desc: 설명                       ← 룰의 목적
condition: 조건식                 ← 언제 트리거되는가 (Sysdig 필터 문법)
output: 출력 포맷                ← 알림 메시지에 포함할 정보
priority: 우선순위               ← EMERGENCY/ALERT/CRITICAL/ERROR/WARNING/NOTICE/INFO/DEBUG
tags: [태그 목록]                ← 분류용 태그
```

**주요 Falco 매크로/필터:**
```
spawned_process  = 새 프로세스가 생성됨 (evt.type in (execve, execveat))
container        = 컨테이너 환경에서 실행됨 (container.id != host)
open_read        = 파일이 읽기 모드로 열림
proc.name        = 프로세스 이름
fd.name          = 파일 디스크립터 이름 (경로)
user.name        = 사용자 이름
container.name   = 컨테이너 이름
container.image.repository = 이미지 리포지토리
k8s.pod.name     = Pod 이름
k8s.ns.name      = 네임스페이스 이름
```

```yaml
# /etc/falco/falco_rules.local.yaml

# 룰 1: 컨테이너에서 셸 실행 탐지
- rule: Detect Shell in Container
  desc: 컨테이너에서 셸(bash, sh, zsh)이 실행되면 탐지한다
  condition: >
    spawned_process and
    container and
    proc.name in (bash, sh, zsh)
  output: >
    Shell spawned in container
    (user=%user.name
    container=%container.name
    shell=%proc.name
    parent=%proc.pname
    cmdline=%proc.cmdline
    image=%container.image.repository
    pod=%k8s.pod.name
    ns=%k8s.ns.name)
  priority: WARNING
  tags: [container, shell, mitre_execution]

# 룰 2: 민감 파일 읽기 탐지
- rule: Detect Sensitive File Read
  desc: 컨테이너에서 /etc/shadow 파일을 읽으면 탐지한다
  condition: >
    open_read and
    container and
    fd.name = /etc/shadow
  output: >
    Sensitive file read in container
    (user=%user.name
    file=%fd.name
    container=%container.name
    image=%container.image.repository
    pod=%k8s.pod.name
    ns=%k8s.ns.name)
  priority: CRITICAL
  tags: [filesystem, sensitive_file, mitre_credential_access]

# 룰 3: 패키지 관리자 실행 탐지
- rule: Detect Package Management
  desc: 컨테이너에서 패키지 관리자가 실행되면 탐지한다
  condition: >
    spawned_process and
    container and
    proc.name in (apt, apt-get, yum, dnf, apk, pip, pip3, npm)
  output: >
    Package management tool run in container
    (user=%user.name
    command=%proc.cmdline
    container=%container.name
    image=%container.image.repository
    pod=%k8s.pod.name
    ns=%k8s.ns.name)
  priority: ERROR
  tags: [container, package_management, mitre_persistence]
```

```bash
# SSH 접속 (Falco가 설치된 노드)
ssh admin@dev-worker

# 파일 작성
sudo vi /etc/falco/falco_rules.local.yaml
# 위 내용 붙여넣기

# Falco 재시작
sudo systemctl restart falco

# Falco 상태 확인
sudo systemctl status falco
# Active: active (running)

# === 검증 ===
# 다른 터미널에서:

# 테스트 1: 셸 실행
kubectl exec -n demo deploy/nginx -- /bin/sh -c "echo test"

# 테스트 2: /etc/shadow 읽기
kubectl exec -n demo deploy/nginx -- cat /etc/shadow 2>&1

# 테스트 3: 패키지 관리자 실행
kubectl exec -n demo deploy/nginx -- apt-get update 2>&1

# Falco 로그 확인
sudo journalctl -u falco --since "2 minutes ago" | grep -E "Shell|Sensitive|Package"
# WARNING Shell spawned in container (user=root container=nginx shell=sh ...)
# CRITICAL Sensitive file read in container (user=root file=/etc/shadow ...)
# ERROR Package management tool run in container (user=root command=apt-get update ...)
```

**Falco 룰 작성 시 주의사항:**
```
1. condition의 필터 순서: 빈번한 조건을 앞에 배치 (성능)
   좋은 예: spawned_process and container and proc.name in (...)
   나쁜 예: proc.name in (...) and spawned_process and container

2. output에 %k8s.pod.name, %k8s.ns.name 포함 (K8s 환경 식별)

3. 기본 ruleset 파일(falco_rules.yaml) 수정 금지!
   → 항상 falco_rules.local.yaml에 작성

4. 기존 룰 오버라이드 시 append: true 사용
   - rule: <existing rule name>
     append: true
     condition: and not proc.name = my-legitimate-process
```

**채점 기준:**
- [ ] 셸 탐지 룰: condition이 올바른가 (spawned_process, container, proc.name) (2점)
- [ ] /etc/shadow 읽기 탐지: condition이 올바른가 (open_read, fd.name) (2점)
- [ ] 패키지 관리자 탐지: condition이 올바른가 (2점)
- [ ] 각 룰의 priority가 요구사항과 일치 (WARNING, CRITICAL, ERROR) (0.5점)
- [ ] `falco_rules.local.yaml`에 작성 (0.5점)

</details>

---

### 문제 19. [Runtime Security - 5점] Audit Log 분석

**컨텍스트:** `kubectl config use-context platform`

**문제:**
platform 클러스터의 Audit Log(`/var/log/kubernetes/audit/audit.log`)를 분석하여:
1. `kube-system` 네임스페이스에서 **삭제**된 리소스를 찾아라
2. **Secret에 접근**한 비시스템 사용자를 식별하라
3. **403 Forbidden** 응답을 받은 요청을 찾아라

결과를 `/tmp/audit-analysis.txt`에 저장하라.

<details>
<summary>풀이</summary>

**시험 출제 의도:** Audit Log를 jq로 필터링하여 보안 이벤트를 분석할 수 있는지 평가한다. 인시던트 대응의 첫 단계는 증거 수집이며, Audit Log가 핵심 증거 소스이다.

**Audit Log 구조:**
```json
{
  "kind": "Event",
  "apiVersion": "audit.k8s.io/v1",
  "level": "Metadata",              // 감사 레벨
  "stage": "ResponseComplete",      // 단계
  "requestReceivedTimestamp": "...", // 요청 시간
  "verb": "delete",                 // 동작 (get, list, create, update, delete, watch)
  "user": {
    "username": "admin",            // 요청자
    "groups": ["system:masters"]
  },
  "objectRef": {
    "resource": "pods",             // 리소스 종류
    "namespace": "kube-system",     // 네임스페이스
    "name": "coredns-xxx"           // 리소스 이름
  },
  "responseStatus": {
    "code": 200                     // HTTP 응답 코드
  }
}
```

```bash
ssh admin@platform-master

# === 1. kube-system에서 삭제된 리소스 ===
cat /var/log/kubernetes/audit/audit.log | \
  jq -r 'select(
    .verb == "delete" and
    .objectRef.namespace == "kube-system"
  ) | "\(.requestReceivedTimestamp) | \(.user.username) deleted \(.objectRef.resource)/\(.objectRef.name)"' \
  > /tmp/audit-analysis.txt

echo "---" >> /tmp/audit-analysis.txt

# === 2. Secret에 접근한 비시스템 사용자 ===
cat /var/log/kubernetes/audit/audit.log | \
  jq -r 'select(
    .objectRef.resource == "secrets" and
    (.user.username | startswith("system:") | not)
  ) | "\(.requestReceivedTimestamp) | \(.user.username) \(.verb) secret/\(.objectRef.name) in \(.objectRef.namespace)"' \
  >> /tmp/audit-analysis.txt

echo "---" >> /tmp/audit-analysis.txt

# === 3. 403 Forbidden 응답 ===
cat /var/log/kubernetes/audit/audit.log | \
  jq -r 'select(
    .responseStatus.code == 403
  ) | "\(.requestReceivedTimestamp) | \(.user.username) got 403 on \(.verb) \(.objectRef.resource)/\(.objectRef.name)"' \
  >> /tmp/audit-analysis.txt

# 결과 확인
cat /tmp/audit-analysis.txt
```

**자주 사용하는 jq 필터 패턴:**
```bash
# 특정 사용자의 모든 활동
jq 'select(.user.username == "suspicious-user")'

# 특정 시간 이후 이벤트
jq 'select(.requestReceivedTimestamp > "2024-01-01T00:00:00Z")'

# create + delete만 (변경 작업)
jq 'select(.verb | IN("create", "delete", "update", "patch"))'

# 특정 네임스페이스의 모든 이벤트
jq 'select(.objectRef.namespace == "production")'

# 실패한 요청 (4xx, 5xx)
jq 'select(.responseStatus.code >= 400)'
```

**채점 기준:**
- [ ] kube-system 삭제 이벤트를 올바르게 필터링 (2점)
- [ ] 비시스템 사용자의 Secret 접근을 식별 (1.5점)
- [ ] 403 Forbidden 응답 필터링 (1점)
- [ ] 결과가 파일에 저장됨 (0.5점)

</details>

---

### 문제 20. [Runtime Security - 6점] 인시던트 대응

**컨텍스트:** `kubectl config use-context prod`

**문제:**
`production` 네임스페이스의 `compromised-pod` Pod가 침해된 것으로 의심된다.
1. 해당 Pod의 프로세스 목록과 네트워크 연결을 수집하여 `/tmp/incident-evidence.txt`에 저장하라
2. 해당 Pod를 즉시 격리하라 (NetworkPolicy로 모든 트래픽 차단)
3. Pod를 삭제하지 말고 격리 상태로 유지하라 (포렌식 분석용)

<details>
<summary>풀이</summary>

**시험 출제 의도:** 인시던트 대응의 기본 절차(증거 수집 → 격리 → 분석)를 실제로 수행할 수 있는지 평가한다. Pod를 바로 삭제하면 증거가 사라지므로, 격리 후 증거를 보존하는 것이 중요하다.

**인시던트 대응 흐름:**
```
침해 의심 Pod 발견
    │
    ▼
[1단계: 증거 수집] ← 삭제하면 증거 소멸!
    ├── 프로세스 목록 (kubectl exec -- ps aux)
    ├── 네트워크 연결 (kubectl exec -- netstat -tlnp)
    ├── 파일 시스템 변경 확인
    └── 환경 변수 확인
    │
    ▼
[2단계: 격리]
    ├── NetworkPolicy로 모든 트래픽 차단
    ├── 또는 라벨 변경으로 Service에서 제외
    └── Pod는 삭제하지 않음!
    │
    ▼
[3단계: 분석]
    ├── Audit Log 확인 (누가 Pod에 접근했는가)
    ├── Falco 로그 확인 (어떤 의심 활동이 있었는가)
    └── 이미지 분석 (원본 이미지와 비교)
    │
    ▼
[4단계: 제거 및 복구]
    ├── 침해된 Pod 삭제
    ├── 새로운 안전한 Pod 배포
    └── 보안 정책 강화
```

```bash
kubectl config use-context prod

# === 1단계: 증거 수집 ===

# Pod 라벨 확인 (격리에 사용)
kubectl get pod compromised-pod -n production --show-labels > /tmp/incident-evidence.txt

echo "=== Process List ===" >> /tmp/incident-evidence.txt
kubectl exec compromised-pod -n production -- ps aux >> /tmp/incident-evidence.txt 2>&1

echo "=== Network Connections ===" >> /tmp/incident-evidence.txt
kubectl exec compromised-pod -n production -- netstat -tlnp >> /tmp/incident-evidence.txt 2>&1

echo "=== Environment Variables ===" >> /tmp/incident-evidence.txt
kubectl exec compromised-pod -n production -- env >> /tmp/incident-evidence.txt 2>&1

echo "=== Recent Modified Files ===" >> /tmp/incident-evidence.txt
kubectl exec compromised-pod -n production -- find / -mmin -60 -type f 2>/dev/null >> /tmp/incident-evidence.txt

echo "=== DNS Resolv Config ===" >> /tmp/incident-evidence.txt
kubectl exec compromised-pod -n production -- cat /etc/resolv.conf >> /tmp/incident-evidence.txt 2>&1

# Pod 상세 정보 (이미지, 볼륨 등)
echo "=== Pod Description ===" >> /tmp/incident-evidence.txt
kubectl describe pod compromised-pod -n production >> /tmp/incident-evidence.txt
```

```bash
# === 2단계: 격리 (NetworkPolicy) ===

# compromised-pod의 라벨 확인
kubectl get pod compromised-pod -n production -o jsonpath='{.metadata.labels}'
# {"app":"web", "version":"v1"}  (예시)
```

```yaml
# isolate-compromised.yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: isolate-compromised-pod
  namespace: production
spec:
  podSelector:
    matchLabels:
      app: web               # compromised-pod의 라벨과 일치
  policyTypes:
  - Ingress
  - Egress
  # ingress/egress 필드 없음 = 모든 트래픽 차단
```

**주의:** 위 정책은 같은 라벨을 가진 다른 정상 Pod도 격리할 수 있다. 더 정밀하게 격리하려면:

```bash
# 방법 2: compromised-pod에 격리용 라벨 추가
kubectl label pod compromised-pod -n production quarantine=true

# 그 라벨을 타겟으로 NetworkPolicy 생성
```

```yaml
# isolate-quarantine.yaml (더 정밀한 방법)
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: isolate-quarantine
  namespace: production
spec:
  podSelector:
    matchLabels:
      quarantine: "true"      # quarantine 라벨이 있는 Pod만 격리
  policyTypes:
  - Ingress
  - Egress
```

```bash
kubectl apply -f isolate-quarantine.yaml

# 검증: 격리 확인
kubectl exec compromised-pod -n production -- wget -qO- http://kubernetes.default.svc --timeout=3 2>&1
# wget: download timed out  → 격리 성공!

# Pod가 여전히 Running 상태인지 확인 (삭제하지 않음!)
kubectl get pod compromised-pod -n production
# NAME               READY   STATUS    RESTARTS   AGE
# compromised-pod    1/1     Running   0          2h
```

**채점 기준:**
- [ ] 프로세스 목록 수집 (1점)
- [ ] 네트워크 연결 수집 (1점)
- [ ] 증거가 /tmp/incident-evidence.txt에 저장됨 (1점)
- [ ] NetworkPolicy로 Ingress + Egress 모두 차단 (2점)
- [ ] Pod가 삭제되지 않고 Running 유지 (1점)

</details>

---

## 5. 채점 기준 요약

| 문제 | 도메인 | 배점 | 난이도 |
|------|--------|------|--------|
| 1 | Cluster Setup - NetworkPolicy Default Deny | 3점 | 하 |
| 2 | Cluster Setup - NetworkPolicy DNS+Pod | 5점 | 중 |
| 3 | Cluster Setup - kube-bench | 7점 | 상 |
| 4 | Cluster Hardening - RBAC | 6점 | 중 |
| 5 | Cluster Hardening - ServiceAccount | 4점 | 하 |
| 6 | Cluster Hardening - Audit Policy | 7점 | 상 |
| 7 | System Hardening - AppArmor | 6점 | 중 |
| 8 | System Hardening - seccomp + SecurityContext | 4점 | 하 |
| 9 | System Hardening - 서비스/SUID | 5점 | 중 |
| 10 | Microservice Vuln - PSA | 6점 | 중 |
| 11 | Microservice Vuln - OPA Gatekeeper | 5점 | 중 |
| 12 | Microservice Vuln - Secret Encryption | 5점 | 중 |
| 13 | Microservice Vuln - RuntimeClass | 4점 | 하 |
| 14 | Supply Chain - Trivy | 6점 | 중 |
| 15 | Supply Chain - ImagePolicyWebhook | 7점 | 상 |
| 16 | Supply Chain - Image Digest | 4점 | 하 |
| 17 | Supply Chain - Dockerfile | 3점 | 하 |
| 18 | Runtime Security - Falco | 7점 | 상 |
| 19 | Runtime Security - Audit Log | 5점 | 중 |
| 20 | Runtime Security - Incident Response | 6점 | 중 |
| **합계** | | **103점** | |

> 실제 시험은 100점 만점이다. 이 모의시험은 약간의 여유를 두고 103점으로 설정했다.

**합격 기준: 67% = 약 69점 이상 (103점 기준)**

---

## 6. 시험 후 자가 평가

### 6.1 시간 관리 평가

```
[ ] 120분 이내에 모든 문제를 시도했는가?
[ ] 한 문제에 10분 이상 소비한 적이 있는가?
[ ] 쉬운 문제(1, 5, 8, 13, 16, 17)를 먼저 풀었는가?
[ ] 마지막 10분을 검증에 사용했는가?
[ ] 컨텍스트 전환을 잊은 적이 있는가?
```

### 6.2 도메인별 자가 평가

| 도메인 | 문제 번호 | 배점 | 획득 점수 | 정답률 |
|--------|----------|------|----------|--------|
| Cluster Setup (10%) | 1, 2, 3 | 15점 | /15 | % |
| Cluster Hardening (15%) | 4, 5, 6 | 17점 | /17 | % |
| System Hardening (15%) | 7, 8, 9 | 15점 | /15 | % |
| Microservice Vuln (20%) | 10, 11, 12, 13 | 20점 | /20 | % |
| Supply Chain (20%) | 14, 15, 16, 17 | 20점 | /20 | % |
| Runtime Security (20%) | 18, 19, 20 | 18점 | /18 | % |
| **총합** | | **105** | / | % |

### 6.3 취약 영역 분석 가이드

```
정답률 80% 이상 → 해당 도메인은 충분히 준비됨
정답률 60~80%  → 핵심 개념 복습 필요 → 해당 Day 자료 재학습
정답률 60% 미만 → 집중 보완 필요 → 해당 Day 자료 + 실습 반복

도메인별 복습 매핑:
├── Cluster Setup      → Day 1-2 복습 (NetworkPolicy, kube-bench, TLS)
├── Cluster Hardening  → Day 3-4 복습 (RBAC, Audit, ServiceAccount)
├── System Hardening   → Day 5-6 복습 (AppArmor, seccomp, 시스템 강화)
├── Microservice Vuln  → Day 7-8 복습 (PSA, Gatekeeper, Encryption, RuntimeClass)
├── Supply Chain       → Day 9-10 복습 (Trivy, ImagePolicyWebhook, Dockerfile)
└── Runtime Security   → Day 11-12 복습 (Falco, Audit Log, 인시던트 대응)
```

---

## 7. 종합 치트시트

### 7.1 핵심 파일 경로

```bash
# API Server 매니페스트 (Static Pod)
/etc/kubernetes/manifests/kube-apiserver.yaml

# Controller Manager 매니페스트
/etc/kubernetes/manifests/kube-controller-manager.yaml

# Scheduler 매니페스트
/etc/kubernetes/manifests/kube-scheduler.yaml

# etcd 매니페스트
/etc/kubernetes/manifests/etcd.yaml

# kubelet 설정
/var/lib/kubelet/config.yaml

# PKI 인증서
/etc/kubernetes/pki/

# Audit Policy
/etc/kubernetes/audit-policy.yaml

# Audit Log
/var/log/kubernetes/audit/audit.log

# Encryption Configuration
/etc/kubernetes/encryption-config.yaml

# AppArmor 프로파일
/etc/apparmor.d/

# seccomp 프로파일 (kubelet)
/var/lib/kubelet/seccomp/profiles/

# Falco 룰
/etc/falco/falco_rules.yaml          # 기본 룰 (수정 금지)
/etc/falco/falco_rules.local.yaml    # 커스텀 룰 (여기에 작성)
/etc/falco/falco.yaml                # Falco 설정

# Admission Control
/etc/kubernetes/admission-control/
```

### 7.2 핵심 명령어

```bash
# ========== kubectl 기본 ==========
alias k=kubectl
export do="--dry-run=client -o yaml"

# 컨텍스트 전환
kubectl config use-context <context>
kubectl config get-contexts

# ========== NetworkPolicy ==========
kubectl get networkpolicy -n <ns>
kubectl describe networkpolicy <name> -n <ns>

# ========== RBAC ==========
# Role 생성
kubectl create role <name> --verb=get,list,watch --resource=pods -n <ns>

# ClusterRole 생성
kubectl create clusterrole <name> --verb=get,list --resource=nodes

# RoleBinding 생성
kubectl create rolebinding <name> --role=<role> --serviceaccount=<ns>:<sa> -n <ns>

# ClusterRoleBinding 생성
kubectl create clusterrolebinding <name> --clusterrole=<cr> --user=<user>

# 권한 확인
kubectl auth can-i <verb> <resource> --as=<user> -n <ns>
kubectl auth can-i --list --as=<user> -n <ns>

# ========== ServiceAccount ==========
kubectl create sa <name> -n <ns>
kubectl get sa <name> -n <ns> -o yaml

# ========== Pod Security Admission ==========
kubectl label namespace <ns> pod-security.kubernetes.io/enforce=restricted
kubectl label namespace <ns> pod-security.kubernetes.io/enforce-version=latest
kubectl label namespace <ns> pod-security.kubernetes.io/warn=restricted
kubectl label namespace <ns> pod-security.kubernetes.io/audit=restricted

# ========== AppArmor ==========
# 프로파일 로드
sudo apparmor_parser -r /etc/apparmor.d/<profile>

# 프로파일 상태 확인
aa-status
aa-status | grep <profile-name>

# ========== seccomp ==========
# seccomp 프로파일 위치
ls /var/lib/kubelet/seccomp/profiles/

# ========== Trivy ==========
trivy image --severity CRITICAL,HIGH <image>
trivy image --severity CRITICAL --exit-code 1 <image>
trivy image --format json <image>
trivy image --ignore-unfixed <image>

# ========== Falco ==========
sudo systemctl restart falco
sudo systemctl status falco
sudo journalctl -u falco -f
sudo journalctl -u falco --since "5 minutes ago"

# ========== Audit Log ==========
# 기본 필터링
cat audit.log | jq 'select(.verb == "delete")'
cat audit.log | jq 'select(.objectRef.resource == "secrets")'
cat audit.log | jq 'select(.responseStatus.code == 403)'
cat audit.log | jq 'select(.user.username == "<user>")'

# ========== kube-bench ==========
kube-bench run --targets master
kube-bench run --targets master --check 1.2.1
kube-bench run --targets node

# ========== API Server 관련 ==========
# Static Pod 재시작 확인
watch crictl ps | grep kube-apiserver

# API Server 로그
crictl logs $(crictl ps -a | grep kube-apiserver | head -1 | awk '{print $1}')

# ========== etcd ==========
ETCDCTL_API=3 etcdctl \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key \
  get /registry/secrets/<ns>/<name>

# ========== 이미지 다이제스트 ==========
crane digest <image>:<tag>
skopeo inspect docker://<image>:<tag> | jq -r '.Digest'

# ========== 시스템 강화 ==========
# 서비스 비활성화
sudo systemctl stop <service>
sudo systemctl disable <service>

# SUID 바이너리 찾기
find / -perm -4000 -type f 2>/dev/null

# SUID 비트 제거
sudo chmod u-s /path/to/binary

# ========== Secret Encryption 검증 ==========
kubectl get secrets --all-namespaces -o json | kubectl replace -f -
```

### 7.3 주요 YAML 뼈대

```yaml
# === NetworkPolicy: Default Deny ===
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny
  namespace: <ns>
spec:
  podSelector: {}
  policyTypes:
  - Ingress
  - Egress

# === Role ===
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: <name>
  namespace: <ns>
rules:
- apiGroups: [""]
  resources: ["pods"]
  verbs: ["get", "list", "watch"]

# === ServiceAccount + Pod (토큰 비활성화) ===
apiVersion: v1
kind: ServiceAccount
metadata:
  name: <sa-name>
  namespace: <ns>
automountServiceAccountToken: false

# === Restricted-compliant Pod ===
apiVersion: v1
kind: Pod
metadata:
  name: <name>
  namespace: <ns>
spec:
  securityContext:
    runAsNonRoot: true
    runAsUser: 1000
    seccompProfile:
      type: RuntimeDefault
  containers:
  - name: app
    image: <image>
    securityContext:
      allowPrivilegeEscalation: false
      readOnlyRootFilesystem: true
      capabilities:
        drop: ["ALL"]

# === Audit Policy ===
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
      resources: ["pods"]
  - level: None
    users: ["system:kube-scheduler"]
    verbs: ["get", "list", "watch"]
  - level: Metadata

# === EncryptionConfiguration ===
apiVersion: apiserver.config.k8s.io/v1
kind: EncryptionConfiguration
resources:
  - resources:
    - secrets
    providers:
    - aescbc:
        keys:
        - name: key1
          secret: <base64-key>
    - identity: {}

# === RuntimeClass ===
apiVersion: node.k8s.io/v1
kind: RuntimeClass
metadata:
  name: gvisor
handler: runsc

# === Falco Rule ===
- rule: <Rule Name>
  desc: <description>
  condition: >
    spawned_process and
    container and
    proc.name in (bash, sh)
  output: >
    Shell in container (user=%user.name container=%container.name
    pod=%k8s.pod.name ns=%k8s.ns.name)
  priority: WARNING
  tags: [container, shell]
```

### 7.4 apiVersion 참조표

| 리소스 | apiVersion |
|--------|-----------|
| Pod, Service, Secret, ConfigMap, ServiceAccount | v1 |
| Deployment, StatefulSet, DaemonSet, ReplicaSet | apps/v1 |
| NetworkPolicy | networking.k8s.io/v1 |
| Ingress | networking.k8s.io/v1 |
| Role, ClusterRole, RoleBinding, ClusterRoleBinding | rbac.authorization.k8s.io/v1 |
| RuntimeClass | node.k8s.io/v1 |
| PeerAuthentication (Istio) | security.istio.io/v1beta1 |
| ConstraintTemplate (Gatekeeper) | templates.gatekeeper.sh/v1 |
| Constraint (Gatekeeper) | constraints.gatekeeper.sh/v1beta1 |
| Audit Policy | audit.k8s.io/v1 |
| EncryptionConfiguration | apiserver.config.k8s.io/v1 |
| AdmissionConfiguration | apiserver.config.k8s.io/v1 |

---

## 8. 합격 전략 최종 정리

### 8.1 시험 당일 체크리스트

```
시험 전:
[ ] 안정적인 인터넷 연결 확인
[ ] 웹캠, 마이크 정상 작동
[ ] 책상 위 불필요한 물건 제거
[ ] 신분증 준비
[ ] kubernetes.io 북마크 정리

시험 시작 직후 (처음 2분):
[ ] alias k=kubectl 설정
[ ] export do="--dry-run=client -o yaml" 설정
[ ] kubectl config get-contexts로 클러스터 확인
[ ] 문제 전체 빠르게 훑기 (쉬운 문제 파악)

시험 중:
[ ] 매 문제마다 컨텍스트 전환 먼저!
[ ] 한 문제 10분 초과 시 스킵
[ ] API Server 수정 전 반드시 백업
[ ] 각 문제 풀이 후 즉시 검증

시험 종료 10분 전:
[ ] 미완성 문제에 부분 점수 시도 (리소스라도 생성)
[ ] 모든 컨텍스트에서 리소스 존재 확인
[ ] kubectl get으로 최종 검증
```

### 8.2 난이도별 풀이 순서 권장

```
[1순위: 반드시 만점] 예상 소요 15~20분
├── NetworkPolicy Default Deny (3~4분)
├── ServiceAccount 토큰 비활성화 (3~4분)
├── seccomp RuntimeDefault (3~4분)
├── RuntimeClass 생성 (3~4분)
└── Image Digest 변경 (3~4분)

[2순위: 확실히 득점] 예상 소요 40~50분
├── RBAC 수정 (5~7분)
├── Pod Security Admission (5~7분)
├── Trivy 이미지 스캔 (7~8분)
├── Falco 룰 작성 (7~8분)
├── Audit Log 분석 (7~8분)
├── AppArmor 프로파일 (7~8분)
└── 인시던트 대응 (7~8분)

[3순위: 시간이 허락하면] 예상 소요 30~40분
├── Audit Policy 작성 + API Server 적용 (10~12분)
├── kube-bench 수정 (8~10분)
├── Secret Encryption at Rest (8~10분)
└── ImagePolicyWebhook (10~12분)
```

### 8.3 점수 극대화 핵심 원칙

```
1. 쉬운 문제에서 실수하지 말라
   → 하 난이도 문제만 완벽히 풀어도 ~23점 (22% 확보)

2. 중간 난이도 문제를 최대한 많이 풀어라
   → 중 난이도 문제를 70% 풀면 ~37점 추가 확보

3. 어려운 문제는 부분 점수를 노려라
   → ImagePolicyWebhook: volume만 맞아도 부분 점수
   → kube-bench: 플래그 하나만 맞아도 부분 점수

4. 시간 관리가 점수를 결정한다
   → 어려운 문제에 20분 투자 → 쉬운 문제 2개 놓침 → 순손실
```

---

## 9. Day 1~14 복습 맵

```
Day 1-2: Cluster Setup (10%)
├── NetworkPolicy (Default Deny, DNS, AND/OR, ipBlock, metadata API)
├── CIS Benchmark / kube-bench
├── Ingress TLS
└── 바이너리 무결성 (sha512sum)

Day 3-4: Cluster Hardening (15%)
├── RBAC (Role, ClusterRole, RoleBinding, ClusterRoleBinding)
├── ServiceAccount 토큰 관리
├── API Server 보안 플래그
├── Audit Policy (None/Metadata/Request/RequestResponse)
└── kubeadm 업그레이드

Day 5-6: System Hardening (15%)
├── AppArmor (프로파일 작성, 로드, Pod 적용)
├── seccomp (RuntimeDefault, Localhost, 커스텀)
├── Linux capabilities (drop ALL, 필요한 것만 add)
├── 불필요한 서비스 비활성화
└── SUID 바이너리

Day 7-8: Minimize Microservice Vulnerabilities (20%)
├── Pod Security Standards / Admission
├── SecurityContext 완벽 가이드
├── OPA Gatekeeper (ConstraintTemplate, Constraint, Rego)
├── Secret Encryption at Rest
├── RuntimeClass (gVisor, Kata)
└── Istio mTLS (PeerAuthentication)

Day 9-10: Supply Chain Security (20%)
├── Trivy (이미지 스캔, severity, exit-code, SBOM)
├── Cosign / Docker Content Trust
├── ImagePolicyWebhook
├── 이미지 다이제스트 vs 태그
├── Dockerfile 보안 (multi-stage, distroless, non-root)
└── 허용 레지스트리 제한

Day 11-12: Monitoring/Logging/Runtime Security (20%)
├── Falco (룰, 매크로, override, 우선순위)
├── Kubernetes Audit Log 분석 (jq)
├── Sysdig (시스템 콜 캡처)
├── 인시던트 대응 (증거 수집, 격리, 제거)
└── Immutable Container

Day 13-14: 종합 모의시험 (100%)
├── 20문제 실전 모의시험
├── 시간 관리 전략
├── 종합 치트시트
└── 합격 전략
```

---

> **14일간의 CKS 학습 과정을 모두 완료했다.**
> 모의시험에서 67% 이상 득점했다면 실제 시험에 도전할 준비가 된 것이다.
> 취약한 도메인은 해당 Day를 다시 복습하고, 실전 환경에서 반복 연습하라.
>
> **합격의 핵심:**
> 1. 쉬운 문제에서 실수하지 않는다
> 2. YAML 뼈대를 빠르게 작성한다 (imperative → 수정)
> 3. API Server 매니페스트 수정에 자신감을 가진다
> 4. 시간 관리를 철저히 한다 (10분 룰)
> 5. kubernetes.io 문서 검색을 빠르게 한다

---

## tart-infra 실습

### 실습 환경 설정

```bash
# CKS 모의시험은 4개 클러스터를 모두 사용한다
alias kp='export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/platform.yaml'
alias kd='export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/dev.yaml'
alias ks='export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/staging.yaml'
alias kpr='export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/prod.yaml'
```

### 실습 1: 전 도메인 보안 종합 점검

```bash
# [Cluster Setup] NetworkPolicy 확인
kd
echo "=== NetworkPolicy ==="
kubectl get ciliumnetworkpolicies -n demo --no-headers | wc -l
echo "CiliumNetworkPolicy 수"

# [Cluster Hardening] RBAC 점검
echo "=== RBAC ==="
kubectl get clusterrolebindings -o custom-columns=NAME:.metadata.name,ROLE:.roleRef.name | grep cluster-admin

# [System Hardening] SecurityContext 확인
echo "=== SecurityContext ==="
kubectl get pods -n demo -o jsonpath='{range .items[*]}{.metadata.name}{": runAsNonRoot="}{.spec.securityContext.runAsNonRoot}{"\n"}{end}'

# [Microservice Vulnerabilities] mTLS 확인
echo "=== mTLS ==="
kubectl get peerauthentication -n demo 2>/dev/null || echo "PeerAuthentication 미설정"

# [Supply Chain] 이미지 태그 확인
echo "=== Image Tags ==="
kubectl get pods -n demo -o jsonpath='{range .items[*]}{range .spec.containers[*]}{.image}{"\n"}{end}{end}' | sort -u

# [Runtime Security] 이벤트 확인
echo "=== Recent Events ==="
kubectl get events -n demo --field-selector type=Warning --no-headers 2>/dev/null | wc -l
echo "Warning 이벤트 수"
```

### 실습 2: 시험 핵심 스킬 연습

```bash
kd

# 1. NetworkPolicy 빠른 생성 (Default Deny)
cat << 'EOF' > /tmp/default-deny.yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-test
  namespace: default
spec:
  podSelector: {}
  policyTypes:
  - Ingress
  - Egress
EOF
kubectl apply -f /tmp/default-deny.yaml
kubectl delete -f /tmp/default-deny.yaml

# 2. RBAC 빠른 생성
kubectl create role test-role --verb=get,list --resource=pods -n default --dry-run=client -o yaml
kubectl create rolebinding test-rb --role=test-role --serviceaccount=default:default -n default --dry-run=client -o yaml

# 3. 권한 검증
kubectl auth can-i get pods -n default --as=system:serviceaccount:default:default
```

**동작 원리:** CKS 시험 시간 절약 전략:
1. imperative 명령어(`kubectl create role/rolebinding`)로 기본 YAML을 생성한다
2. `--dry-run=client -o yaml`로 파일에 저장하고 필요한 수정을 한다
3. `kubectl auth can-i`로 RBAC 결과를 즉시 검증한다
4. NetworkPolicy는 YAML 외우기보다 패턴을 기억한다 (Default Deny, Allow DNS 등)

### 실습 3: API Server 매니페스트 수정 연습

```bash
# API Server 매니페스트 위치 확인
# tart ssh dev-master
# sudo cat /etc/kubernetes/manifests/kube-apiserver.yaml | head -30

# 시험에서 자주 수정하는 항목:
echo "CKS 시험 API Server 수정 체크리스트:"
echo "1. --enable-admission-plugins 추가 (ImagePolicyWebhook, PodSecurityAdmission)"
echo "2. --encryption-provider-config 설정"
echo "3. --audit-policy-file 설정"
echo "4. --audit-log-path 설정"
echo "5. 볼륨/볼륨마운트 추가 (설정 파일과 로그 경로)"
```

**동작 원리:** API Server 매니페스트 수정 절차:
1. `/etc/kubernetes/manifests/kube-apiserver.yaml`을 직접 편집한다
2. kubelet이 파일 변경을 감지하고 kube-apiserver Pod를 자동으로 재시작한다
3. 재시작에 1~2분 소요 — `kubectl get pods -n kube-system`으로 상태를 확인한다
4. 문법 오류가 있으면 API Server가 시작되지 않는다 — 수정 전 백업 필수!

### 실습 4: 모의시험 시간 관리 연습

```bash
# 실전처럼 시간 측정하며 작업
echo "=== CKS 모의시험 시간 관리 ==="
echo "총 120분, 15~20문제"
echo ""
echo "시간 배분 전략:"
echo "1. 쉬운 문제(NetworkPolicy, RBAC): 5~7분"
echo "2. 중간 문제(SecurityContext, Audit): 7~10분"
echo "3. 어려운 문제(API Server 수정, Falco): 10~15분"
echo ""
echo "클러스터별 작업:"
echo "- platform: 모니터링, Audit, API Server 보안"
echo "- dev: NetworkPolicy, mTLS, SecurityContext, 이미지 보안"
echo "- staging: 기본 보안 설정 연습"
echo "- prod: 최소 구성에서 보안 강화 연습"
```
