# Day 5: Tests, Repository, Plugins, 보안

Helm Chart 테스트 작성, Chart Repository와 OCI Registry 운영, Helm 플러그인 활용, 그리고 Chart 보안 관련 내용을 다룬다.

---

## 제10장: Tests

### 10.1 helm test

`helm test`는 Release에 포함된 test Hook Pod를 실행하여 배포 상태를 검증한다.

```yaml
# templates/tests/test-connection.yaml
apiVersion: v1
kind: Pod
metadata:
  name: {{ include "my-app.fullname" . }}-test-connection
  labels:
    {{- include "my-app.labels" . | nindent 4 }}
  annotations:
    "helm.sh/hook": test
spec:
  containers:
    - name: wget
      image: busybox
      command: ['wget']
      args: ['{{ include "my-app.fullname" . }}:{{ .Values.service.port }}']
  restartPolicy: Never
```

```bash
# 테스트 실행
helm test my-release

# 테스트 로그 확인
helm test my-release --logs

# 특정 필터로 테스트 (Helm 3.13+)
helm test my-release --filter name=my-app-test-connection
```

### 10.2 고급 테스트 패턴

#### 데이터베이스 연결 테스트

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: {{ include "my-app.fullname" . }}-test-db
  annotations:
    "helm.sh/hook": test
    "helm.sh/hook-delete-policy": before-hook-creation,hook-succeeded
spec:
  containers:
    - name: pg-test
      image: postgres:15-alpine
      env:
        - name: PGPASSWORD
          valueFrom:
            secretKeyRef:
              name: {{ include "my-app.fullname" . }}-db
              key: password
      command:
        - sh
        - -c
        - |
          pg_isready -h {{ include "my-app.fullname" . }}-postgresql -p 5432 -U myuser
          psql -h {{ include "my-app.fullname" . }}-postgresql -p 5432 -U myuser -d mydb \
            -c "SELECT 1 AS health_check;"
  restartPolicy: Never
```

#### API 응답 검증 테스트

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: {{ include "my-app.fullname" . }}-test-api
  annotations:
    "helm.sh/hook": test
    "helm.sh/hook-weight": "5"
    "helm.sh/hook-delete-policy": before-hook-creation,hook-succeeded
spec:
  containers:
    - name: api-test
      image: curlimages/curl:latest
      command:
        - sh
        - -c
        - |
          # 서비스 응답 확인
          HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
            http://{{ include "my-app.fullname" . }}:{{ .Values.service.port }}/healthz)
          if [ "$HTTP_CODE" != "200" ]; then
            echo "Health check failed with HTTP $HTTP_CODE"
            exit 1
          fi
          echo "Health check passed"

          # API 응답 내용 확인
          RESPONSE=$(curl -s http://{{ include "my-app.fullname" . }}:{{ .Values.service.port }}/api/v1/status)
          echo "API Response: $RESPONSE"
          echo "$RESPONSE" | grep -q '"status":"ok"' || exit 1
  restartPolicy: Never
```

### 10.3 helm lint

차트의 구문 오류와 모범 사례 위반을 검사한다.

```bash
# 기본 린트
helm lint ./mychart

# 특정 values로 린트
helm lint ./mychart -f values-prod.yaml

# strict 모드 (경고도 에러로 처리)
helm lint ./mychart --strict

# 여러 values 파일 조합 테스트
helm lint ./mychart -f values-base.yaml -f values-prod.yaml --strict
```

### 10.4 chart-testing (ct) 도구

Helm 차트의 CI/CD를 위한 전용 도구이다. Git diff를 기반으로 변경된 차트만 테스트한다.

```bash
# 설치
brew install chart-testing

# 변경된 차트 린트
ct lint --config ct.yaml

# 변경된 차트 설치 테스트 (실제 클러스터 필요)
ct install --config ct.yaml
```

```yaml
# ct.yaml 설정 예시
remote: origin
target-branch: main
chart-dirs:
  - charts
helm-extra-args: --timeout 600s
validate-maintainers: false
```

### 10.5 helm-unittest

단위 테스트 플러그인으로, 클러스터 없이 템플릿 렌더링 결과를 검증한다.

```bash
# 플러그인 설치
helm plugin install https://github.com/helm-unittest/helm-unittest

# 테스트 실행
helm unittest ./mychart
```

```yaml
# tests/deployment_test.yaml
suite: Deployment tests
templates:
  - deployment.yaml
tests:
  - it: should create deployment with correct replicas
    set:
      replicaCount: 3
    asserts:
      - isKind:
          of: Deployment
      - equal:
          path: spec.replicas
          value: 3

  - it: should use correct image
    set:
      image:
        repository: nginx
        tag: "1.25"
    asserts:
      - equal:
          path: spec.template.spec.containers[0].image
          value: "nginx:1.25"

  - it: should set resource limits when specified
    set:
      resources:
        limits:
          cpu: 100m
          memory: 128Mi
    asserts:
      - equal:
          path: spec.template.spec.containers[0].resources.limits.cpu
          value: 100m

  - it: should fail without required values
    set:
      image.repository: ""
    asserts:
      - failedTemplate: {}
```

---

## 제11장: Chart Repository

### 11.1 전통적 Chart Repository (HTTP 기반)

Helm Chart Repository는 `index.yaml` 파일과 `.tgz` Chart 파일을 제공하는 HTTP 서버이다.

```bash
# 리포지토리 추가
helm repo add bitnami https://charts.bitnami.com/bitnami
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo add grafana https://grafana.github.io/helm-charts
helm repo add argo https://argoproj.github.io/argo-helm
helm repo add jenkins https://charts.jenkins.io

# 리포지토리 업데이트
helm repo update

# 차트 검색
helm search repo nginx
helm search repo prometheus --versions  # 모든 버전 표시

# 리포지토리 목록
helm repo list

# 리포지토리 제거
helm repo remove bitnami
```

tart-infra 프로젝트에서 사용하는 Repository 목록:

| Repository 이름 | URL | 사용 Chart |
|----------------|-----|-----------|
| prometheus-community | `https://prometheus-community.github.io/helm-charts` | kube-prometheus-stack |
| grafana | `https://grafana.github.io/helm-charts` | loki-stack |
| argo | `https://argoproj.github.io/argo-helm` | argo-cd |
| jenkins | `https://charts.jenkins.io` | jenkins |

### 11.2 OCI Registry 지원

Helm 3.8부터 OCI (Open Container Initiative) Registry를 차트 저장소로 사용할 수 있다. Docker Hub, GitHub Container Registry (ghcr.io), AWS ECR, Harbor 등을 지원한다.

```bash
# OCI 레지스트리 로그인
helm registry login ghcr.io -u USERNAME
helm registry login registry.example.com -u USERNAME -p PASSWORD

# 차트를 OCI 레지스트리에 Push
helm package ./mychart                        # mychart-1.0.0.tgz 생성
helm push mychart-1.0.0.tgz oci://ghcr.io/myorg/charts

# OCI 레지스트리에서 차트 Pull
helm pull oci://ghcr.io/myorg/charts/mychart --version 1.0.0

# OCI 레지스트리에서 직접 설치
helm install my-release oci://ghcr.io/myorg/charts/mychart --version 1.0.0

# 차트 정보 확인
helm show chart oci://ghcr.io/myorg/charts/mychart --version 1.0.0
helm show values oci://ghcr.io/myorg/charts/mychart --version 1.0.0
```

OCI vs 전통적 Repository 비교:

| 항목 | 전통적 Repository | OCI Registry |
|------|-------------------|--------------|
| 프로토콜 | HTTP/HTTPS | OCI (HTTPS) |
| `helm repo add` | 필요 | 불필요 (`oci://` 직접 접근) |
| `helm search` | 지원 | 미지원 (웹 UI/API 사용) |
| 인증 | Basic Auth / Token | Docker Registry 인증 |
| 서명 | Provenance 파일 | OCI Artifact Signature (Cosign) |
| Chart.yaml | dependencies.repository에 URL | `oci://` 프로토콜 URL |
| 인프라 | 별도 서버 (ChartMuseum 등) | 기존 컨테이너 레지스트리 활용 |

### 11.3 GitHub Pages로 Chart Repository 만들기

```bash
# 1. Chart 패키징
helm package ./my-chart

# 2. index.yaml 생성/업데이트
helm repo index . --url https://username.github.io/helm-charts

# 3. GitHub Pages에 배포 (gh-pages 브랜치)
git checkout gh-pages
mv my-chart-1.0.0.tgz ./
git add .
git commit -m "Add my-chart 1.0.0"
git push origin gh-pages

# 4. 사용자가 Repository 추가
helm repo add myrepo https://username.github.io/helm-charts
helm install my-app myrepo/my-chart
```

### 11.4 ChartMuseum

ChartMuseum은 Helm Chart 전용 Repository 서버이다.

```bash
# 설치
helm repo add chartmuseum https://chartmuseum.github.io/charts
helm install chartmuseum chartmuseum/chartmuseum \
  --set env.open.DISABLE_API=false \
  --set persistence.enabled=true

# Chart 업로드
curl --data-binary "@my-chart-1.0.0.tgz" \
  http://chartmuseum.example.com/api/charts

# 또는 helm-push 플러그인 사용
helm plugin install https://github.com/chartmuseum/helm-push
helm cm-push ./my-chart chartmuseum-repo
```

### 11.5 Harbor

Harbor는 컨테이너 이미지 레지스트리이면서 Helm Chart Repository 기능도 제공한다. RBAC, 취약점 스캔, 이미지 복제 등의 엔터프라이즈 기능을 지원한다.

```bash
# Harbor에 OCI 방식으로 Chart Push
helm registry login harbor.example.com
helm push my-chart-1.0.0.tgz oci://harbor.example.com/my-project/charts

# Harbor에서 Chart 설치
helm install my-app oci://harbor.example.com/my-project/charts/my-chart --version 1.0.0
```

---

## 제12장: Helm Plugins

### 12.1 helm-diff

Release를 업그레이드하기 전에 변경될 내용을 diff 형식으로 보여준다.

```bash
# 설치
helm plugin install https://github.com/databus23/helm-diff

# 업그레이드 전 변경 사항 미리보기
helm diff upgrade my-release ./chart -f values-prod.yaml

# Revision 간 비교
helm diff revision my-release 1 2

# 롤백 시 변경 사항 미리보기
helm diff rollback my-release 1

# 특정 리소스만 비교
helm diff upgrade my-release ./chart --set replicaCount=5

# 출력 예시:
# monitoring, kube-prometheus-stack-grafana, Deployment (apps) has changed:
# -   replicas: 1
# +   replicas: 3
```

tart-infra 프로젝트에서 특히 유용한 시나리오:

```bash
# monitoring-values.yaml 변경 전 diff 확인
helm diff upgrade kube-prometheus-stack prometheus-community/kube-prometheus-stack \
  -n monitoring \
  -f manifests/monitoring-values.yaml
```

### 12.2 helm-secrets

SOPS(Mozilla SOPS)를 사용하여 values 파일을 암호화한다.

```bash
# 설치
helm plugin install https://github.com/jkroepke/helm-secrets

# values 파일 암호화 (SOPS 설정 필요)
helm secrets encrypt values-secret.yaml > values-secret.enc.yaml

# 암호화된 values로 설치
helm secrets install my-app ./chart -f values-secret.enc.yaml

# 암호화된 values 편집
helm secrets edit values-secret.enc.yaml

# 암호화된 values 복호화 (stdout)
helm secrets decrypt values-secret.enc.yaml
```

```yaml
# .sops.yaml (SOPS 설정)
creation_rules:
  - path_regex: \.enc\.yaml$
    age: age1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
  - path_regex: \.enc\.yaml$
    kms: arn:aws:kms:ap-northeast-2:123456789:key/xxxxxxxx-xxxx-xxxx
```

### 12.3 helm-unittest

10장에서 상세히 다루었다. 클러스터 없이 Chart 템플릿의 단위 테스트를 실행한다.

```bash
# 설치
helm plugin install https://github.com/helm-unittest/helm-unittest

# 테스트 실행
helm unittest ./mychart

# 출력 포맷 지정
helm unittest ./mychart -o JUnit -f test-results.xml
```

### 12.4 helm-dashboard

웹 UI로 Helm Release를 관리한다.

```bash
# 설치
helm plugin install https://github.com/komodorio/helm-dashboard

# 실행 (로컬 브라우저에서 열림)
helm dashboard

# 포트 지정
helm dashboard --port 8080
```

### 12.5 기타 유용한 플러그인

| 플러그인 | 설명 | 설치 명령 |
|----------|------|----------|
| helm-mapkubeapis | 폐기된 API 버전을 자동 마이그레이션한다 | `helm plugin install https://github.com/helm/helm-mapkubeapis` |
| helm-cm-push | ChartMuseum에 Chart를 push한다 | `helm plugin install https://github.com/chartmuseum/helm-push` |
| helm-s3 | AWS S3를 Chart Repository로 사용한다 | `helm plugin install https://github.com/hypnoglow/helm-s3` |
| helm-git | Git Repository를 Chart Repository로 사용한다 | `helm plugin install https://github.com/aslafy-z/helm-git` |

```bash
# 플러그인 관리
helm plugin list
helm plugin update <name>
helm plugin uninstall <name>
```

---

## 제13장: 보안

### 13.1 Chart 서명과 검증

Helm은 Chart의 무결성과 출처를 보장하기 위해 PGP(Pretty Good Privacy) 서명을 지원한다.

```bash
# 1. GPG 키 생성
gpg --gen-key

# 2. Chart 패키징 + 서명 (.prov 파일 생성)
helm package --sign --key 'John Doe' --keyring ~/.gnupg/secring.gpg ./mychart
# 출력: mychart-1.0.0.tgz, mychart-1.0.0.tgz.prov

# 3. Chart 검증
helm verify ./mychart-1.0.0.tgz --keyring ~/.gnupg/pubring.gpg

# 4. 검증과 함께 설치
helm install my-app ./mychart-1.0.0.tgz --verify --keyring ~/.gnupg/pubring.gpg
```

#### Provenance (.prov) 파일

`.prov` 파일은 다음 정보를 포함한다:

- Chart.yaml의 내용
- Chart 패키지의 SHA-256 해시
- PGP 서명

### 13.2 Sigstore (Cosign)

Sigstore는 차세대 소프트웨어 서명 프레임워크이다. OCI 기반 Chart 배포 시 Cosign으로 서명할 수 있다.

```bash
# Cosign 설치
brew install cosign

# Chart를 OCI Push 후 서명
helm push mychart-1.0.0.tgz oci://ghcr.io/myorg/charts
cosign sign ghcr.io/myorg/charts/mychart:1.0.0

# 서명 검증
cosign verify ghcr.io/myorg/charts/mychart:1.0.0 --key cosign.pub
```

### 13.3 Secrets 관리 with SOPS

SOPS(Secrets OPerationS)는 Mozilla에서 개발한 시크릿 파일 암호화 도구이다. helm-secrets 플러그인과 함께 사용하면 Git에 암호화된 values를 안전하게 저장할 수 있다.

```bash
# SOPS 설치
brew install sops

# Age 키 생성 (SOPS가 지원하는 키 유형 중 하나)
age-keygen -o key.txt
# 출력: age1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# 환경변수 설정
export SOPS_AGE_KEY_FILE=/path/to/key.txt

# SOPS로 파일 암호화
sops --encrypt --age age1xxxx... values-secret.yaml > values-secret.enc.yaml

# 암호화된 파일 편집
sops values-secret.enc.yaml

# helm-secrets와 함께 사용
helm secrets install my-app ./chart \
  -f values.yaml \
  -f values-secret.enc.yaml
```

### 13.4 보안 모범 사례

1. **values에 민감 정보를 평문으로 저장하지 않는다**: SOPS, Sealed Secrets, External Secrets Operator를 사용한다
2. **Chart 서명을 검증한다**: 프로덕션에서는 `--verify` 플래그를 사용한다
3. **Chart 버전을 고정한다**: `version:` 필드를 명시하여 예상치 못한 업그레이드를 방지한다
4. **RBAC을 활용한다**: Helm은 kubeconfig의 권한을 사용하므로, 최소 권한 원칙을 적용한다
5. **SecurityContext를 설정한다**: Chart의 values에서 `securityContext`, `podSecurityContext`를 설정한다
6. **이미지 태그를 고정한다**: `:latest` 대신 구체적인 태그(`:1.25.3`)를 사용한다
7. **네트워크 정책을 적용한다**: NetworkPolicy를 Chart에 포함한다

```yaml
# 보안 강화된 values 예시
securityContext:
  runAsNonRoot: true
  runAsUser: 1000
  readOnlyRootFilesystem: true
  allowPrivilegeEscalation: false
  capabilities:
    drop:
      - ALL

podSecurityContext:
  fsGroup: 1000
  seccompProfile:
    type: RuntimeDefault
```

tart-infra 프로젝트에서의 보안 관련 설정 참고:

```yaml
# manifests/argocd-values.yaml — 학습 환경이므로 --insecure 사용
server:
  extraArgs:
    - --insecure    # 프로덕션에서는 절대 사용하지 않는다

# manifests/jenkins-values.yaml — 학습 환경이므로 평문 패스워드 사용
controller:
  admin:
    password: admin  # 프로덕션에서는 SOPS나 External Secrets를 사용한다
```

---

