# CKAD Day 7: Helm 패키지 매니저 기초

> CKAD 도메인: Application Deployment (20%) - Part 2a | 예상 소요 시간: 1시간

---

## 오늘의 학습 목표

- [ ] Helm의 개념과 아키텍처를 이해한다
- [ ] Chart 구조(Chart.yaml, values.yaml, templates/)를 학습한다
- [ ] helm install/upgrade/rollback 명령을 숙지한다
- [ ] Go 템플릿 기초 문법({{ .Values }}, {{ .Release }})을 이해한다

---

## 1. Helm (헬름) - 쿠버네티스 패키지 매니저

### 1.1 Helm이란?

**등장 배경:**
쿠버네티스에 앱을 배포하려면 Deployment, Service, ConfigMap, Secret, Ingress 등 여러 YAML 파일을 작성해야 한다. 환경별(dev, staging, prod)로 값만 다른 YAML을 중복 관리하면 유지보수가 어렵고, 여러 리소스를 한 번에 설치/삭제하기 불편하다. Helm은 이 문제를 해결하기 위해 "Chart"라는 패키지 단위로 리소스를 템플릿화하고, values 파일로 환경별 값을 분리한다. Linux의 apt/yum과 유사한 역할을 쿠버네티스에서 수행한다.

**공학적 정의:**
Helm은 쿠버네티스 리소스 매니페스트를 Chart라는 패키지 단위로 템플릿화하여 관리하는 패키지 매니저이다. Go 템플릿 엔진을 사용하여 values.yaml의 파라미터를 templates/ 디렉토리의 YAML 매니페스트에 주입하고, Release 단위로 설치/업그레이드/롤백을 관리한다. Helm 3는 Tiller를 제거하고 클라이언트 사이드에서 직접 쿠버네티스 API Server와 통신하며, Release 정보를 해당 네임스페이스의 Secret으로 저장한다.

**내부 동작 원리 심화:**
`helm install` 실행 시 Helm CLI는 다음 순서로 동작한다. (1) Chart를 로드하고 values.yaml, -f 파일, --set 값을 우선순위에 따라 병합한다(--set > -f > values.yaml). (2) Go 템플릿 엔진으로 templates/ 디렉토리의 파일을 렌더링한다. (3) 렌더링된 매니페스트를 쿠버네티스 API Server에 전송한다. (4) Release 정보(revision, values, manifest)를 해당 네임스페이스에 Secret(`sh.helm.release.v1.<name>.v<revision>`)으로 저장한다. 이 Secret에 이전 상태가 기록되므로 `helm rollback`이 가능하다.

**핵심 개념:**

```
[Chart]                [Release]               [Repository]
템플릿 + 기본값         Chart의 설치 인스턴스      Chart 저장소
  |                      |                       |
  v                      v                       v
nginx/                  my-nginx (revision 1)   https://charts.bitnami.com
├── Chart.yaml          my-nginx (revision 2)   https://prometheus-community.github.io
├── values.yaml         my-nginx (revision 3)
└── templates/
    ├── deployment.yaml
    ├── service.yaml
    └── ingress.yaml
```

**왜 Helm이 필요한가?**
- 여러 YAML 파일을 하나의 패키지로 관리
- 환경별 설정(dev, staging, prod)을 values 파일로 분리
- 배포 이력 관리와 롤백
- 커뮤니티 Chart로 복잡한 애플리케이션을 쉽게 설치

### 1.2 Helm 아키텍처 (v3)

```
[Helm CLI (클라이언트)]
    |
    ├── Chart 로드 (로컬 또는 리포지토리에서 다운로드)
    |
    ├── values.yaml + --set 옵션 병합
    |
    ├── Go 템플릿 렌더링 (templates/ + values -> 최종 YAML)
    |
    ├── 쿠버네티스 API Server에 직접 전송
    |   (Helm v2의 Tiller 서버 제거 -> 보안 향상)
    |
    └── Release 정보를 해당 네임스페이스의 Secret에 저장
        (sh.helm.release.v1.<release-name>.v<revision>)

[Helm v2 vs v3]
v2: Client -> Tiller(Pod) -> API Server (보안 문제)
v3: Client -> API Server (직접 통신, Tiller 제거)
```

### 1.3 Chart 구조

```
mychart/
├── Chart.yaml           # Chart 메타데이터 (이름, 버전, 설명)
├── Chart.lock           # 의존성 잠금 파일
├── values.yaml          # 기본 설정값
├── values-dev.yaml      # 환경별 오버라이드 (선택)
├── values-prod.yaml     # 환경별 오버라이드 (선택)
├── charts/              # 의존성 Chart
├── templates/           # 쿠버네티스 매니페스트 템플릿
│   ├── NOTES.txt        # 설치 후 출력 메시지
│   ├── _helpers.tpl     # 공통 템플릿 함수
│   ├── deployment.yaml
│   ├── service.yaml
│   ├── ingress.yaml
│   ├── configmap.yaml
│   ├── secret.yaml
│   ├── hpa.yaml
│   └── tests/           # helm test 스크립트
│       └── test-connection.yaml
└── .helmignore          # 패키징 시 제외 파일
```

### 1.4 Chart.yaml 상세

```yaml
apiVersion: v2                    # Helm 3는 v2 사용
name: myapp                       # Chart 이름
version: 1.2.0                    # Chart 버전 (SemVer)
appVersion: "2.0.0"               # 애플리케이션 버전
description: My Web Application   # Chart 설명
type: application                 # application 또는 library
keywords:
  - web
  - nginx
maintainers:
  - name: devops-team
    email: devops@example.com
dependencies:                     # 의존성 Chart
  - name: postgresql
    version: "12.x.x"
    repository: "https://charts.bitnami.com/bitnami"
    condition: postgresql.enabled  # values에서 활성화/비활성화
```

### 1.5 values.yaml 상세

```yaml
# 이미지 설정
image:
  repository: nginx
  tag: "1.25"
  pullPolicy: IfNotPresent

# 레플리카 수
replicaCount: 3

# 서비스 설정
service:
  type: ClusterIP
  port: 80
  targetPort: 8080

# Ingress 설정
ingress:
  enabled: true
  className: nginx
  hosts:
    - host: app.example.com
      paths:
        - path: /
          pathType: Prefix

# 리소스 설정
resources:
  requests:
    cpu: 100m
    memory: 128Mi
  limits:
    cpu: 200m
    memory: 256Mi

# 환경 변수
env:
  APP_ENV: production
  LOG_LEVEL: info

# ConfigMap 데이터
config:
  database:
    host: postgres
    port: "5432"
```

---

## 2. Helm 핵심 명령어

### 2.1 리포지토리 관리

```bash
# 리포지토리 추가
helm repo add bitnami https://charts.bitnami.com/bitnami
```

검증:
```text
"bitnami" has been added to your repositories
```

```bash
# 리포지토리 목록
helm repo list
```

검증:
```text
NAME      URL
bitnami   https://charts.bitnami.com/bitnami
```

```bash
# 리포지토리 업데이트 (최신 Chart 정보 갱신)
helm repo update
```

검증:
```text
Hang tight while we grab the latest from your chart repositories...
...Successfully got an update from the "bitnami" chart repository
Update Complete. ⎈Happy Helming!⎈
```

```bash
# Chart 검색
helm search repo nginx                  # 리포지토리에서 검색
```

검증:
```text
NAME            CHART VERSION   APP VERSION   DESCRIPTION
bitnami/nginx   x.x.x           x.x.x        NGINX Open Source is a web server...
```

### 2.2 Chart 설치/관리

```bash
# === 설치 ===
helm install <release-name> <chart> [options]

# 기본 설치
helm install my-nginx bitnami/nginx

# 네임스페이스 지정 + 네임스페이스 생성
helm install my-nginx bitnami/nginx -n web --create-namespace

# values 파일로 설정 오버라이드
helm install my-nginx bitnami/nginx -f values-prod.yaml

# --set으로 개별 값 오버라이드
helm install my-nginx bitnami/nginx \
  --set replicaCount=3 \
  --set service.type=NodePort \
  --set image.tag=1.25

# dry-run (실제 설치 없이 렌더링 결과 확인)
helm install my-nginx bitnami/nginx --dry-run --debug

# === 업그레이드 ===
helm upgrade my-nginx bitnami/nginx --set replicaCount=5
helm upgrade my-nginx bitnami/nginx -f values-prod.yaml
helm upgrade --install my-nginx bitnami/nginx  # 없으면 설치, 있으면 업그레이드

# === 롤백 ===
helm rollback my-nginx 1              # revision 1로 롤백
helm rollback my-nginx                # 이전 revision으로 롤백

# === 삭제 ===
helm uninstall my-nginx
helm uninstall my-nginx -n web        # 네임스페이스 지정
```

### 2.3 Release 관리

```bash
# Release 목록
helm list -A
```

검증:
```text
NAME       NAMESPACE   REVISION   UPDATED                    STATUS     CHART           APP VERSION
my-nginx   demo        1          2026-03-30 00:00:00 +0900  deployed   nginx-x.x.x     x.x.x
```

```bash
# Release 히스토리 (revision 목록)
helm history my-nginx
```

검증:
```text
REVISION   UPDATED                    STATUS     CHART         APP VERSION   DESCRIPTION
1          Mon Mar 30 00:00:00 2026   deployed   nginx-x.x.x  x.x.x         Install complete
```

```bash
# Release의 현재 values 확인
helm get values my-nginx
```

검증:
```text
USER-SUPPLIED VALUES:
replicaCount: 3
service:
  type: ClusterIP
```

```bash
# Release가 생성한 매니페스트 확인
helm get manifest my-nginx
```

### 2.4 Chart 정보 확인

```bash
# Chart 기본값 확인
helm show values bitnami/nginx         # values.yaml 내용
helm show chart bitnami/nginx          # Chart.yaml 내용
helm show readme bitnami/nginx         # README 내용
helm show all bitnami/nginx            # 모든 정보

# Chart 다운로드 (설치 없이)
helm pull bitnami/nginx                # .tgz 다운로드
helm pull bitnami/nginx --untar        # 압축 해제
```

### 2.5 템플릿 렌더링 (디버깅)

```bash
# 로컬 Chart 렌더링 (설치 없이 최종 YAML 확인)
helm template my-release ./mychart
helm template my-release ./mychart -f values-prod.yaml
helm template my-release ./mychart --set image.tag=1.26

# 특정 템플릿만 렌더링
helm template my-release ./mychart -s templates/deployment.yaml

# 린트 (문법 검사)
helm lint ./mychart
```

---

## 3. Go 템플릿 기초

### 3.1 내장 객체

```yaml
# templates/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  # .Release: Release 정보
  name: {{ .Release.Name }}-deploy      # Release 이름
  namespace: {{ .Release.Namespace }}    # 설치된 네임스페이스
  labels:
    # .Chart: Chart.yaml 정보
    chart: {{ .Chart.Name }}-{{ .Chart.Version }}
    app.kubernetes.io/managed-by: {{ .Release.Service }}
spec:
  # .Values: values.yaml + --set 값
  replicas: {{ .Values.replicaCount }}
  selector:
    matchLabels:
      app: {{ .Release.Name }}
  template:
    metadata:
      labels:
        app: {{ .Release.Name }}
    spec:
      containers:
        - name: {{ .Chart.Name }}
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
          imagePullPolicy: {{ .Values.image.pullPolicy }}
          ports:
            - containerPort: {{ .Values.service.targetPort }}
```

### 3.2 주요 템플릿 함수

```yaml
# 기본값 설정
image: "{{ .Values.image.repository }}:{{ .Values.image.tag | default "latest" }}"
# tag가 없으면 "latest" 사용

# 문자열 따옴표
name: {{ .Values.name | quote }}       # "my-app" (큰따옴표)

# 들여쓰기
{{ .Values.resources | toYaml | nindent 12 }}
# values의 resources 블록을 YAML로 변환하고 12칸 들여쓰기

# 조건문
{{- if .Values.ingress.enabled }}
apiVersion: networking.k8s.io/v1
kind: Ingress
...
{{- end }}

# 반복문
{{- range .Values.env }}
  - name: {{ .name }}
    value: {{ .value | quote }}
{{- end }}

# 필수값 검증
{{ required "image.repository is required" .Values.image.repository }}
```

### 3.3 _helpers.tpl (명명된 템플릿)

```yaml
# templates/_helpers.tpl
{{- define "mychart.fullname" -}}
{{ .Release.Name }}-{{ .Chart.Name }}
{{- end -}}

{{- define "mychart.labels" -}}
app.kubernetes.io/name: {{ .Chart.Name }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

# templates/deployment.yaml에서 사용
metadata:
  name: {{ include "mychart.fullname" . }}
  labels:
    {{- include "mychart.labels" . | nindent 4 }}
```

---

## 4. CKAD에서의 Helm 출제 범위

CKAD 시험에서 Helm은 다음 수준으로 출제된다:

```
1. helm install/upgrade/rollback 명령어 사용
2. --set으로 값 오버라이드
3. -f로 values 파일 지정
4. helm list, helm status, helm history로 Release 확인
5. helm uninstall로 삭제
6. Chart 구조 이해 (Chart.yaml, values.yaml, templates/)
7. 기본적인 Go 템플릿 이해 ({{ .Values.xxx }})
```

**시험 팁:**
```bash
# 자주 사용하는 Helm 명령 패턴
helm install <name> <chart> -n <ns> --create-namespace
helm upgrade <name> <chart> --set key=value
helm rollback <name> <revision>
helm list -A
helm history <name>
helm get values <name>
helm uninstall <name> -n <ns>
```

---

## 5. 트러블슈팅

### 5.1 helm install 실패

**증상:** `helm install`이 에러로 종료된다.

```bash
helm install my-release ./mychart 2>&1
```

```text
Error: INSTALLATION FAILED: cannot re-use a name that is still in use
```

원인: 동일한 Release 이름이 이미 존재한다.

해결:
```bash
# 기존 Release 확인
helm list -A | grep my-release

# 삭제 후 재설치
helm uninstall my-release
helm install my-release ./mychart

# 또는 upgrade --install 사용 (없으면 설치, 있으면 업그레이드)
helm upgrade --install my-release ./mychart
```

### 5.2 템플릿 렌더링 오류

**증상:** 설치 시 YAML 문법 오류가 발생한다.

```bash
helm template my-release ./mychart --debug
```

```text
Error: YAML parse error on mychart/templates/deployment.yaml: error converting YAML to JSON
```

디버깅 순서:
1. `helm lint ./mychart`로 기본 문법 검사를 수행한다.
2. `helm template ./mychart --debug`로 렌더링 결과를 확인한다.
3. 주로 `nindent` 값 오류(들여쓰기 불일치), 닫히지 않은 `{{ }}` 구문, `toYaml` 파이프라인 누락이 원인이다.

### 5.3 Release가 pending-install 상태에 걸린 경우

```bash
helm list -A
```

```text
NAME        NAMESPACE   REVISION   STATUS           CHART
my-release  demo        1          pending-install   mychart-1.0.0
```

원인: 설치 중 타임아웃 또는 리소스 생성 실패로 Release가 불완전한 상태이다.

해결:
```bash
# 강제 삭제
helm uninstall my-release

# 남은 리소스 확인 및 수동 정리
kubectl get all -n demo -l app.kubernetes.io/instance=my-release
```

---

## 6. 복습 체크리스트

- [ ] Helm의 핵심 개념(Chart, Release, Repository)을 설명할 수 있다
- [ ] Chart 구조(Chart.yaml, values.yaml, templates/)를 안다
- [ ] `helm install/upgrade/rollback/uninstall` 명령을 사용할 수 있다
- [ ] `--set`과 `-f`로 values를 오버라이드할 수 있다
- [ ] `helm list/history/get values` 명령으로 Release를 관리할 수 있다
- [ ] Go 템플릿 기본 문법(`{{ .Values }}`, `{{ .Release }}`)을 이해한다

---

## tart-infra 실습

### 실습 환경 설정

```bash
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/platform.yaml
kubectl get nodes
```

검증:
```text
NAME              STATUS   ROLES                  AGE   VERSION
platform-node-1   Ready    control-plane,master   xxd   v1.xx.x
```

### 실습 1: platform 클러스터의 Helm Release 관리

platform 클러스터에 설치된 Helm Release를 확인하고 관리한다.

```bash
# 전체 네임스페이스의 Helm Release 확인
helm list -A

# 특정 Release의 상세 정보
helm history prometheus -n monitoring 2>/dev/null || echo "Release 이름을 helm list로 확인한다"

# Release에 적용된 values 확인
helm get values prometheus -n monitoring 2>/dev/null || helm list -A | head -10
```

**예상 출력 (helm list -A):**
```
NAME            NAMESPACE       REVISION    STATUS      CHART                   APP VERSION
prometheus      monitoring      1           deployed    kube-prometheus-stack-x  x.x.x
grafana         monitoring      1           deployed    grafana-x.x.x           x.x.x
argocd          argocd          1           deployed    argo-cd-x.x.x           x.x.x
```

**동작 원리:** `helm list -A`는 모든 네임스페이스의 Release를 조회한다. Helm 3는 Release 정보를 해당 네임스페이스의 Secret(type: helm.sh/release.v1)으로 저장한다. `helm history`로 revision 이력을 확인하고, `helm get values`로 사용자가 커스텀한 값을 확인할 수 있다.

### 실습 2: dev 클러스터에서 Helm Chart 설치/업그레이드/롤백

```bash
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/dev.yaml

# 테스트용 Chart 설치
helm repo add bitnami https://charts.bitnami.com/bitnami 2>/dev/null
helm repo update

# nginx Chart 설치 (dry-run으로 확인)
helm install test-nginx bitnami/nginx -n demo \
  --set service.type=ClusterIP \
  --dry-run

# 실제 설치
helm install test-nginx bitnami/nginx -n demo \
  --set service.type=ClusterIP

# Release 확인
helm list -n demo
```

검증:
```text
NAME         NAMESPACE   REVISION   UPDATED                    STATUS     CHART           APP VERSION
test-nginx   demo        1          2026-03-30 00:00:00 +0900  deployed   nginx-x.x.x     x.x.x
```

```bash
helm get values test-nginx -n demo
```

검증:
```text
USER-SUPPLIED VALUES:
service:
  type: ClusterIP
```

**동작 원리:** `--dry-run`은 서버에 매니페스트를 보내지 않고 렌더링 결과만 출력한다. `--set`으로 values.yaml의 기본값을 오버라이드할 수 있다. CKAD 시험에서는 `helm install`, `helm upgrade --set`, `helm rollback` 흐름을 숙지해야 한다.

### 정리

```bash
helm uninstall test-nginx -n demo
```

검증:
```text
release "test-nginx" uninstalled
```

```bash
# Release가 삭제되었는지 확인
helm list -n demo
```

검증:
```text
NAME   NAMESPACE   REVISION   UPDATED   STATUS   CHART   APP VERSION
```
