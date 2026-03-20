# Day 6: CI/CD, 베스트 프랙티스, Library Charts, 성능

CI/CD 파이프라인에서의 Helm 활용, Chart 개발 베스트 프랙티스, Library Chart 패턴, 그리고 성능 최적화와 트러블슈팅을 다룬다.

---

## 제14장: Helm in CI/CD

### 14.1 Helmfile

Helmfile은 여러 Helm Release를 선언적으로 관리하는 도구이다. 단일 `helmfile.yaml`로 여러 Release의 설치, 업그레이드, 삭제를 일괄 처리한다.

```yaml
# helmfile.yaml
repositories:
  - name: prometheus-community
    url: https://prometheus-community.github.io/helm-charts
  - name: grafana
    url: https://grafana.github.io/helm-charts
  - name: argo
    url: https://argoproj.github.io/argo-helm
  - name: jenkins
    url: https://charts.jenkins.io

# tart-infra platform 클러스터를 Helmfile로 관리한다면
releases:
  - name: kube-prometheus-stack
    namespace: monitoring
    chart: prometheus-community/kube-prometheus-stack
    version: 55.5.0
    values:
      - manifests/monitoring-values.yaml
    wait: true
    timeout: 600
    createNamespace: true

  - name: loki
    namespace: monitoring
    chart: grafana/loki-stack
    version: 2.10.0
    values:
      - manifests/loki-values.yaml
    wait: true
    timeout: 300
    needs:
      - monitoring/kube-prometheus-stack    # 의존성 순서

  - name: argocd
    namespace: argocd
    chart: argo/argo-cd
    version: 5.51.0
    values:
      - manifests/argocd-values.yaml
    wait: true
    timeout: 600
    createNamespace: true

  - name: jenkins
    namespace: jenkins
    chart: jenkins/jenkins
    version: 4.9.0
    values:
      - manifests/jenkins-values.yaml
    wait: true
    timeout: 600
    createNamespace: true

# 환경별 오버라이드
environments:
  default:
    values:
      - defaults.yaml
  production:
    values:
      - production.yaml
```

```bash
# Helmfile 명령
helmfile sync              # 모든 Release를 선언 상태로 동기화
helmfile diff              # 변경될 내용을 diff로 확인
helmfile apply             # diff 후 적용
helmfile destroy           # 모든 Release 삭제
helmfile list              # Release 목록

# 특정 Release만 적용
helmfile -l name=argocd sync

# 환경 지정
helmfile -e production sync
```

Helmfile과 Terraform helm_release의 비교:

| 항목 | Helmfile | Terraform helm_release |
|------|----------|----------------------|
| 도구 의존성 | Helmfile CLI | Terraform + Helm Provider |
| 상태 관리 | Helm Release Secret | Terraform State |
| 의존성 표현 | `needs:` 키워드 | `depends_on` 메타인수 |
| 환경 분리 | `environments:` | Terraform workspace 또는 변수 |
| 다른 리소스 관리 | Helm Release만 | 모든 인프라 (VM, Network 등) |

tart-infra 프로젝트에서는 VM, 클러스터, Helm Release를 모두 Terraform으로 관리하므로 Terraform helm_release를 사용한다. Helm Release만 관리한다면 Helmfile이 더 간결한 선택이 될 수 있다.

### 14.2 ArgoCD 통합

ArgoCD는 GitOps 기반 CD 도구로, Git Repository의 Helm Chart를 자동으로 클러스터에 배포한다.

```yaml
# ArgoCD Application 리소스로 Helm Chart 배포
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: kube-prometheus-stack
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://prometheus-community.github.io/helm-charts
    targetRevision: 55.5.0
    chart: kube-prometheus-stack
    helm:
      releaseName: kube-prometheus-stack
      valueFiles:
        - values.yaml
      values: |
        grafana:
          enabled: true
          service:
            type: NodePort
            nodePort: 30300
  destination:
    server: https://kubernetes.default.svc
    namespace: monitoring
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
```

ArgoCD의 Helm 관련 설정 옵션:

| 옵션 | 설명 |
|------|------|
| `source.chart` | Helm Chart 이름이다 |
| `source.targetRevision` | Chart 버전이다 |
| `source.helm.releaseName` | Helm Release 이름이다 |
| `source.helm.valueFiles` | values 파일 경로 (Git repo 기준)이다 |
| `source.helm.values` | 인라인 values YAML이다 |
| `source.helm.parameters` | 개별 값 설정 (--set과 동일)이다 |
| `source.helm.skipCrds` | CRD 설치를 건너뛴다 |
| `syncPolicy.automated` | 자동 동기화를 활성화한다 |

tart-infra 프로젝트에서 ArgoCD는 `argocd` 네임스페이스에 배포되어 있으며, dev/staging/prod 클러스터에 애플리케이션을 배포하는 용도로 사용된다.

### 14.3 Flux (Flux CD)

Flux는 또 다른 GitOps 도구로, HelmRelease CRD를 사용하여 Helm Chart를 관리한다.

```yaml
# HelmRepository
apiVersion: source.toolkit.fluxcd.io/v1beta2
kind: HelmRepository
metadata:
  name: prometheus-community
  namespace: flux-system
spec:
  interval: 1h
  url: https://prometheus-community.github.io/helm-charts

---
# HelmRelease
apiVersion: helm.toolkit.fluxcd.io/v2beta2
kind: HelmRelease
metadata:
  name: kube-prometheus-stack
  namespace: monitoring
spec:
  interval: 5m
  chart:
    spec:
      chart: kube-prometheus-stack
      version: "55.x"
      sourceRef:
        kind: HelmRepository
        name: prometheus-community
        namespace: flux-system
  values:
    grafana:
      enabled: true
  valuesFrom:
    - kind: ConfigMap
      name: monitoring-values
      valuesKey: values.yaml
```

### 14.4 GitOps 패턴

GitOps에서 Helm Chart를 관리하는 두 가지 패턴이 있다:

#### 패턴 1: Chart Repository 참조

```
Git Repository (Application Config)
├── apps/
│   ├── monitoring/
│   │   ├── kustomization.yaml
│   │   ├── helmrelease.yaml    # Chart Repository URL + version 참조
│   │   └── values.yaml
│   └── argocd/
│       ├── application.yaml    # ArgoCD Application
│       └── values.yaml
```

#### 패턴 2: Chart를 Git에 직접 포함

```
Git Repository (Monorepo)
├── charts/
│   ├── my-app/
│   │   ├── Chart.yaml
│   │   ├── values.yaml
│   │   └── templates/
│   └── my-lib/
│       ├── Chart.yaml
│       └── templates/
├── environments/
│   ├── dev/
│   │   └── values.yaml
│   ├── staging/
│   │   └── values.yaml
│   └── prod/
│       └── values.yaml
```

### 14.5 CI 파이프라인 예시

```yaml
# GitHub Actions: Helm Chart CI
name: Helm Chart CI
on:
  push:
    paths:
      - 'charts/**'

jobs:
  lint-and-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Set up Helm
        uses: azure/setup-helm@v3
        with:
          version: 'v3.14.0'

      - name: Lint charts
        run: |
          helm lint charts/my-app --strict
          helm lint charts/my-app -f charts/my-app/ci/values-test.yaml --strict

      - name: Template charts
        run: |
          helm template test-release charts/my-app -f charts/my-app/ci/values-test.yaml \
            | kubectl apply --dry-run=client -f -

      - name: Run unit tests
        run: |
          helm plugin install https://github.com/helm-unittest/helm-unittest
          helm unittest charts/my-app

      - name: Package and push (on tag)
        if: startsWith(github.ref, 'refs/tags/')
        run: |
          helm package charts/my-app
          helm push my-app-*.tgz oci://ghcr.io/${{ github.repository_owner }}/charts
        env:
          HELM_REGISTRY_CONFIG: ~/.config/helm/registry/config.json
```

---

## 제15장: Chart 개발 베스트 프랙티스

### 15.1 네이밍 컨벤션

| 항목 | 규칙 | 예시 |
|------|------|------|
| Chart 이름 | 소문자, 하이픈 구분 | `my-web-app` |
| Template 이름 | `<차트이름>.<기능>` | `my-web-app.fullname` |
| values 키 | camelCase | `replicaCount`, `serviceAccount` |
| K8s 리소스 이름 | 63자 이하, DNS 호환 | `{{ include "my-app.fullname" . }}` |
| 디렉토리 이름 | 소문자 | `templates/`, `charts/` |

### 15.2 라벨 표준

Kubernetes 권장 라벨(app.kubernetes.io)을 사용한다:

```yaml
# 모든 리소스에 적용해야 하는 라벨
labels:
  app.kubernetes.io/name: {{ include "my-app.name" . }}
  app.kubernetes.io/instance: {{ .Release.Name }}
  app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
  app.kubernetes.io/component: frontend    # 컴포넌트별 구분
  app.kubernetes.io/part-of: my-platform   # 상위 시스템
  app.kubernetes.io/managed-by: {{ .Release.Service }}
  helm.sh/chart: {{ include "my-app.chart" . }}

# Selector 라벨 (immutable — name + instance만 사용)
selectorLabels:
  app.kubernetes.io/name: {{ include "my-app.name" . }}
  app.kubernetes.io/instance: {{ .Release.Name }}
```

> 중요: `spec.selector.matchLabels`는 Deployment 생성 후 변경할 수 없다 (immutable). 따라서 Selector 라벨에는 `version`, `chart` 등 변경될 수 있는 값을 포함하지 않는다.

### 15.3 Annotations 활용

```yaml
# 일반적인 annotation 패턴
metadata:
  annotations:
    # ConfigMap 변경 시 Pod 재시작
    checksum/config: {{ include (print $.Template.BasePath "/configmap.yaml") . | sha256sum }}

    # Prometheus scraping
    prometheus.io/scrape: "true"
    prometheus.io/port: "{{ .Values.metrics.port }}"
    prometheus.io/path: "/metrics"

    # 사용자 정의 annotation 지원
    {{- with .Values.podAnnotations }}
    {{- toYaml . | nindent 4 }}
    {{- end }}
```

### 15.4 리소스 관리

```yaml
# values.yaml에서 리소스를 빈 맵으로 기본 제공
resources: {}

# templates/deployment.yaml
{{- with .Values.resources }}
resources:
  {{- toYaml . | nindent 12 }}
{{- end }}
```

리소스를 빈 맵(`{}`)으로 기본 제공하는 이유:
1. 개발 환경에서는 리소스 제한 없이 편하게 사용할 수 있다
2. 프로덕션에서는 반드시 values로 리소스를 명시하도록 유도한다
3. `required` 함수와 조합하면 프로덕션 values에서 리소스 미설정을 방지할 수 있다

tart-infra 프로젝트에서는 모든 컴포넌트에 리소스 제한이 명시되어 있다:

```yaml
# 프로젝트 리소스 할당 요약
# Prometheus:   requests 200m/512Mi, limits 2Gi
# Grafana:      기본값 사용
# Alertmanager: requests 50m/64Mi,  limits 256Mi
# Loki:         requests 100m/128Mi, limits 512Mi
# Promtail:     requests 50m/64Mi,  limits 256Mi
# ArgoCD ctrl:  requests 100m/256Mi, limits 1Gi
# ArgoCD repo:  requests 50m/128Mi,  limits 512Mi
# Jenkins ctrl: requests 200m/512Mi, limits 2Gi
# Jenkins agent: requests 100m/256Mi, limits 512Mi
# Cilium:       requests 100m/128Mi, limits 512Mi
# metrics-server: requests 50m/64Mi, limits 256Mi
```

### 15.5 업그레이드 전략

```yaml
# Deployment 업그레이드 전략
spec:
  strategy:
    {{- if eq .Values.updateStrategy "RollingUpdate" }}
    type: RollingUpdate
    rollingUpdate:
      maxSurge: {{ .Values.maxSurge | default "25%" }}
      maxUnavailable: {{ .Values.maxUnavailable | default "25%" }}
    {{- else }}
    type: Recreate
    {{- end }}
```

### 15.6 선택적 리소스 생성 패턴

```yaml
# values.yaml
serviceAccount:
  create: true
  name: ""

ingress:
  enabled: false

autoscaling:
  enabled: false

# templates/serviceaccount.yaml
{{- if .Values.serviceAccount.create -}}
apiVersion: v1
kind: ServiceAccount
metadata:
  name: {{ include "my-app.serviceAccountName" . }}
  labels:
    {{- include "my-app.labels" . | nindent 4 }}
  {{- with .Values.serviceAccount.annotations }}
  annotations:
    {{- toYaml . | nindent 4 }}
  {{- end }}
{{- end }}

# templates/hpa.yaml
{{- if .Values.autoscaling.enabled }}
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: {{ include "my-app.fullname" . }}
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: {{ include "my-app.fullname" . }}
  minReplicas: {{ .Values.autoscaling.minReplicas }}
  maxReplicas: {{ .Values.autoscaling.maxReplicas }}
  metrics:
    {{- if .Values.autoscaling.targetCPUUtilizationPercentage }}
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: {{ .Values.autoscaling.targetCPUUtilizationPercentage }}
    {{- end }}
{{- end }}
```

### 15.7 PodDisruptionBudget (PDB)

```yaml
# templates/pdb.yaml
{{- if .Values.podDisruptionBudget.enabled }}
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: {{ include "my-app.fullname" . }}
  labels:
    {{- include "my-app.labels" . | nindent 4 }}
spec:
  {{- if .Values.podDisruptionBudget.minAvailable }}
  minAvailable: {{ .Values.podDisruptionBudget.minAvailable }}
  {{- else }}
  maxUnavailable: {{ .Values.podDisruptionBudget.maxUnavailable | default 1 }}
  {{- end }}
  selector:
    matchLabels:
      {{- include "my-app.selectorLabels" . | nindent 6 }}
{{- end }}
```

---

## 제16장: Library Charts

### 16.1 Library Chart의 개념

Library Chart는 `type: library`로 설정된 Chart이다. 직접 설치할 수 없고, 다른 Chart의 의존성으로만 사용된다. 여러 Chart에서 공통으로 사용하는 named template을 제공한다.

### 16.2 Library Chart 구조

```
common-lib/
├── Chart.yaml
├── templates/
│   ├── _labels.tpl
│   ├── _names.tpl
│   ├── _resources.tpl
│   ├── _tplvalues.tpl
│   └── _validation.tpl
└── values.yaml
```

```yaml
# Chart.yaml
apiVersion: v2
name: common-lib
version: 1.0.0
type: library    # library 타입
description: Common templates for Helm charts
```

### 16.3 공통 패턴 예시

```yaml
# templates/_labels.tpl
{{- define "common-lib.labels.standard" -}}
app.kubernetes.io/name: {{ include "common-lib.names.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ include "common-lib.names.chart" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
{{- end }}

# templates/_resources.tpl
{{- define "common-lib.resources.preset" -}}
{{- $preset := . -}}
{{- if eq $preset "nano" }}
resources:
  requests:
    cpu: 50m
    memory: 64Mi
  limits:
    memory: 128Mi
{{- else if eq $preset "small" }}
resources:
  requests:
    cpu: 100m
    memory: 128Mi
  limits:
    memory: 256Mi
{{- else if eq $preset "medium" }}
resources:
  requests:
    cpu: 250m
    memory: 256Mi
  limits:
    memory: 512Mi
{{- else if eq $preset "large" }}
resources:
  requests:
    cpu: 500m
    memory: 512Mi
  limits:
    memory: 1Gi
{{- end }}
{{- end }}

# templates/_validation.tpl
{{- define "common-lib.validate.values" -}}
{{- if not .Values.image.repository }}
  {{- fail "image.repository is required" }}
{{- end }}
{{- if and .Values.autoscaling.enabled (not .Values.autoscaling.minReplicas) }}
  {{- fail "autoscaling.minReplicas is required when autoscaling is enabled" }}
{{- end }}
{{- end }}
```

### 16.4 Library Chart 사용

```yaml
# my-app/Chart.yaml
apiVersion: v2
name: my-app
version: 1.0.0
type: application
dependencies:
  - name: common-lib
    version: "1.x.x"
    repository: "file://../common-lib"   # 또는 OCI/HTTP URL

# my-app/templates/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "common-lib.names.fullname" . }}
  labels:
    {{- include "common-lib.labels.standard" . | nindent 4 }}
spec:
  template:
    spec:
      containers:
        - name: {{ .Chart.Name }}
          {{- include "common-lib.resources.preset" .Values.resourcePreset | nindent 10 }}
```

### 16.5 Bitnami common Library Chart

실무에서 가장 널리 사용되는 Library Chart는 Bitnami의 `common`이다. 100개 이상의 Bitnami Chart가 이 라이브러리를 공유한다.

```yaml
# Bitnami common이 제공하는 주요 template
# - common.names.fullname
# - common.labels.standard
# - common.tplvalues.render      (tpl의 안전한 래퍼)
# - common.images.image          (이미지 경로 조합)
# - common.secrets.passwords.manage  (시크릿 관리)
# - common.capabilities.kubeVersion  (K8s 버전 호환성)
# - common.affinities.pods       (Pod Anti-Affinity)
# - common.warnings.rollingTag   (:latest 태그 경고)
```

---

## 제17장: 성능 및 트러블슈팅

### 17.1 Release History 관리

```bash
# Release 이력 확인
helm history my-release
# REVISION  UPDATED                   STATUS      CHART              APP VERSION  DESCRIPTION
# 1         Mon Jan 15 10:00:00 2024  superseded  my-app-1.0.0       1.0.0        Install complete
# 2         Tue Jan 16 14:00:00 2024  superseded  my-app-1.0.1       1.0.1        Upgrade complete
# 3         Wed Jan 17 09:00:00 2024  deployed    my-app-1.1.0       1.1.0        Upgrade complete

# 최대 이력 수 설정 (기본값: 10)
helm upgrade my-release ./chart --history-max 5

# Terraform helm_release에서도 설정 가능
# max_history = 5
```

Release 이력이 너무 많으면 Release Secret이 많아져 etcd 공간을 차지한다. `--history-max`를 적절히 설정하여 이력을 제한한다.

### 17.2 Rollback

```bash
# 특정 Revision으로 롤백 (새로운 Revision이 생성됨)
helm rollback my-release 1

# 이전 Revision으로 롤백 (직전 버전)
helm rollback my-release

# 롤백 전 diff 확인 (helm-diff 플러그인)
helm diff rollback my-release 1

# --wait 플래그로 롤백 완료 대기
helm rollback my-release 1 --wait --timeout 5m
```

> 주의: `helm rollback`은 새로운 Revision을 생성한다. Revision 3에서 Revision 1로 롤백하면 Revision 4가 생성되며, Revision 4의 내용은 Revision 1과 동일하다.

### 17.3 디버깅 템플릿

#### --dry-run

```bash
# 클라이언트 측 dry-run (API Server에 요청하지 않음)
helm install my-app ./chart --dry-run --debug

# 서버 측 dry-run (API Server가 검증까지 수행 — 더 정확함)
helm install my-app ./chart --dry-run=server --debug

# upgrade dry-run
helm upgrade my-app ./chart --dry-run --debug -f values-prod.yaml
```

클라이언트 측 vs 서버 측 dry-run:

| 항목 | `--dry-run` (client) | `--dry-run=server` |
|------|---------------------|-------------------|
| API Server 접근 | 불필요 | 필요 |
| Schema 검증 | 없음 | API Server가 검증 |
| Admission Webhook | 실행 안 됨 | 실행됨 |
| `lookup` 함수 | 빈 값 반환 | 실제 값 반환 |
| 속도 | 빠름 | 느림 |
| 용도 | 템플릿 문법 확인 | 최종 검증 |

#### helm template

```bash
# 전체 렌더링 (클러스터 접근 불필요)
helm template my-release ./chart -f values-prod.yaml

# 특정 템플릿만 렌더링
helm template my-release ./chart -s templates/deployment.yaml

# 결과를 kubectl로 검증
helm template my-release ./chart | kubectl apply --dry-run=server -f -

# 결과를 파일로 저장
helm template my-release ./chart -f values-prod.yaml > rendered-manifests.yaml
```

#### helm get 하위 명령

```bash
# 설치된 Release의 실제 매니페스트 확인
helm get manifest my-release

# 사용된 values 확인 (사용자가 오버라이드한 값만)
helm get values my-release

# 모든 values (기본값 포함) 확인
helm get values my-release --all

# Hook 확인
helm get hooks my-release

# Release 메모(NOTES.txt 렌더링 결과) 확인
helm get notes my-release

# 모든 정보 한번에 확인
helm get all my-release

# 특정 Revision의 정보 확인
helm get manifest my-release --revision 2
helm get values my-release --revision 1
```

### 17.4 일반적인 오류와 해결

#### 오류 1: YAML 파싱 에러

```
Error: YAML parse error on my-app/templates/deployment.yaml:
  error converting YAML to JSON: yaml: line 15: did not find expected key
```

**원인**: 들여쓰기 오류 또는 공백 제어 누락
**해결**: `helm template` 결과를 확인하고, `{{-` / `-}}` 공백 제어를 조정한다

#### 오류 2: Release 이름 충돌

```
Error: cannot re-use a name that is still in use
```

**원인**: 동일한 이름의 Release가 이미 존재한다
**해결**: `helm list -A`로 확인 후, 다른 이름을 사용하거나 기존 Release를 삭제한다

#### 오류 3: UPGRADE FAILED: another operation is in progress

```
Error: UPGRADE FAILED: another operation (install/upgrade/rollback)
on release "my-app" is in progress
```

**원인**: 이전 작업이 중단되어 Release가 pending 상태이다
**해결**:
```bash
# Release 상태 확인
helm history my-release

# pending 상태인 경우 rollback으로 해결
helm rollback my-release <이전-정상-revision>
```

#### 오류 4: Timeout 에러

```
Error: timed out waiting for the condition
```

**원인**: Pod이 Ready 상태에 도달하지 못했다 (이미지 풀 실패, 리소스 부족 등)
**해결**:
```bash
# Pod 상태 확인
kubectl get pods -n <namespace>
kubectl describe pod <pod-name> -n <namespace>
kubectl logs <pod-name> -n <namespace>

# timeout 늘리기
helm upgrade --install my-app ./chart --wait --timeout 15m
```

#### 오류 5: Resource 이미 존재

```
Error: rendered manifests contain a resource that already exists.
Unable to continue with install
```

**원인**: Chart가 생성하려는 리소스가 이미 클러스터에 존재한다
**해결**:
```bash
# 기존 리소스에 Helm 라벨 추가 (소유권 이전)
kubectl annotate <resource> meta.helm.sh/release-name=<release-name>
kubectl annotate <resource> meta.helm.sh/release-namespace=<namespace>
kubectl label <resource> app.kubernetes.io/managed-by=Helm
```

### 17.5 디버깅 체크리스트

1. `helm lint ./chart` — 차트 구문 오류를 확인한다
2. `helm template my-release ./chart --debug` — 렌더링 결과를 확인한다
3. `helm install ... --dry-run=server --debug` — API Server 검증을 수행한다
4. `helm get manifest my-release` — 배포된 실제 매니페스트를 확인한다
5. `kubectl describe` / `kubectl logs` — Pod 레벨 문제를 확인한다
6. `helm history my-release` — Revision 이력과 상태를 확인한다
7. `helm diff upgrade` — 업그레이드 전 변경 사항을 확인한다 (helm-diff 플러그인)

---

