# Day 8: 예제, 자가 점검, 부록

Helm 실전 예제 모음, 자가 점검 문제, Helm 명령어 빠른 참조, tart-infra 프로젝트의 Helm Values 전체 참조, 그리고 참고문헌을 다룬다.

---

## 제23장: 예제

### 예제 1: 간단한 Custom Chart 만들기

```bash
# Chart 스캐폴딩
helm create my-app

# 구조 확인
tree my-app/
```

```yaml
# my-app/values.yaml
replicaCount: 2
image:
  repository: nginx
  tag: alpine
  pullPolicy: IfNotPresent
service:
  type: ClusterIP
  port: 80
resources:
  limits:
    cpu: 100m
    memory: 128Mi
  requests:
    cpu: 50m
    memory: 64Mi
```

```yaml
# my-app/templates/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "my-app.fullname" . }}
spec:
  replicas: {{ .Values.replicaCount }}
  selector:
    matchLabels:
      {{- include "my-app.selectorLabels" . | nindent 6 }}
  template:
    metadata:
      labels:
        {{- include "my-app.selectorLabels" . | nindent 8 }}
    spec:
      containers:
        - name: {{ .Chart.Name }}
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
          ports:
            - containerPort: 80
          resources:
            {{- toYaml .Values.resources | nindent 12 }}
```

### 예제 2: 환경별 Values 분리

```yaml
# values-dev.yaml
replicaCount: 1
resources:
  limits:
    cpu: 100m
    memory: 128Mi

# values-staging.yaml
replicaCount: 2
resources:
  limits:
    cpu: 200m
    memory: 256Mi

# values-prod.yaml
replicaCount: 3
resources:
  limits:
    cpu: 500m
    memory: 512Mi
```

```bash
# 환경별 배포 (upgrade --install로 멱등성 확보)
helm upgrade --install my-app ./my-app -f values-dev.yaml -n dev --create-namespace --atomic
helm upgrade --install my-app ./my-app -f values-staging.yaml -n staging --create-namespace --atomic
helm upgrade --install my-app ./my-app -f values-prod.yaml -n prod --create-namespace --atomic
```

### 예제 3: 의존성이 있는 Chart

```yaml
# Chart.yaml
apiVersion: v2
name: my-fullstack-app
version: 1.0.0
appVersion: "2.0.0"
type: application
dependencies:
  - name: postgresql
    version: "12.x.x"
    repository: https://charts.bitnami.com/bitnami
    condition: postgresql.enabled
    alias: db
  - name: redis
    version: "17.x.x"
    repository: https://charts.bitnami.com/bitnami
    condition: redis.enabled
```

```yaml
# values.yaml
postgresql:
  enabled: true
db:                        # alias를 사용하므로 db로 접근한다
  auth:
    postgresPassword: mypassword
    database: myapp

redis:
  enabled: false           # condition으로 비활성화
```

```bash
# 의존성 다운로드
helm dependency update ./my-fullstack-app

# 설치
helm install my-stack ./my-fullstack-app
```

### 예제 4: OCI Registry 활용

```bash
# 차트 패키징
helm package ./my-app

# OCI 레지스트리에 Push
helm push my-app-1.0.0.tgz oci://ghcr.io/myorg/charts

# 다른 환경에서 Pull & 설치
helm install my-app oci://ghcr.io/myorg/charts/my-app \
  --version 1.0.0 \
  -f values-prod.yaml \
  -n production \
  --create-namespace \
  --atomic
```

### 예제 5: 완전한 프로덕션 Chart 구조

```yaml
# templates/deployment.yaml — 프로덕션 수준의 완전한 예시
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "my-app.fullname" . }}
  labels:
    {{- include "my-app.labels" . | nindent 4 }}
spec:
  {{- if not .Values.autoscaling.enabled }}
  replicas: {{ .Values.replicaCount }}
  {{- end }}
  selector:
    matchLabels:
      {{- include "my-app.selectorLabels" . | nindent 6 }}
  {{- with .Values.updateStrategy }}
  strategy:
    {{- toYaml . | nindent 4 }}
  {{- end }}
  template:
    metadata:
      annotations:
        checksum/config: {{ include (print $.Template.BasePath "/configmap.yaml") . | sha256sum }}
        {{- with .Values.podAnnotations }}
        {{- toYaml . | nindent 8 }}
        {{- end }}
      labels:
        {{- include "my-app.selectorLabels" . | nindent 8 }}
    spec:
      {{- with .Values.imagePullSecrets }}
      imagePullSecrets:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      serviceAccountName: {{ include "my-app.serviceAccountName" . }}
      {{- with .Values.podSecurityContext }}
      securityContext:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- with .Values.initContainers }}
      initContainers:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      containers:
        - name: {{ .Chart.Name }}
          {{- with .Values.securityContext }}
          securityContext:
            {{- toYaml . | nindent 12 }}
          {{- end }}
          image: {{ include "my-app.image" . | quote }}
          imagePullPolicy: {{ .Values.image.pullPolicy }}
          ports:
            - name: http
              containerPort: {{ .Values.containerPort | default 8080 }}
              protocol: TCP
          {{- if .Values.livenessProbe.enabled }}
          livenessProbe:
            httpGet:
              path: {{ .Values.livenessProbe.path | default "/healthz" }}
              port: http
            initialDelaySeconds: {{ .Values.livenessProbe.initialDelaySeconds | default 30 }}
            periodSeconds: {{ .Values.livenessProbe.periodSeconds | default 10 }}
            timeoutSeconds: {{ .Values.livenessProbe.timeoutSeconds | default 5 }}
            failureThreshold: {{ .Values.livenessProbe.failureThreshold | default 3 }}
          {{- end }}
          {{- if .Values.readinessProbe.enabled }}
          readinessProbe:
            httpGet:
              path: {{ .Values.readinessProbe.path | default "/readyz" }}
              port: http
            initialDelaySeconds: {{ .Values.readinessProbe.initialDelaySeconds | default 5 }}
            periodSeconds: {{ .Values.readinessProbe.periodSeconds | default 10 }}
          {{- end }}
          {{- with .Values.env }}
          env:
            {{- toYaml . | nindent 12 }}
          {{- end }}
          {{- with .Values.envFrom }}
          envFrom:
            {{- toYaml . | nindent 12 }}
          {{- end }}
          {{- with .Values.resources }}
          resources:
            {{- toYaml . | nindent 12 }}
          {{- end }}
          {{- with .Values.volumeMounts }}
          volumeMounts:
            {{- toYaml . | nindent 12 }}
          {{- end }}
      {{- with .Values.volumes }}
      volumes:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- with .Values.nodeSelector }}
      nodeSelector:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- with .Values.affinity }}
      affinity:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- with .Values.tolerations }}
      tolerations:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- with .Values.topologySpreadConstraints }}
      topologySpreadConstraints:
        {{- toYaml . | nindent 8 }}
      {{- end }}
```

---

## 제24장: 자가 점검

### 기초 (제1-3장)
- [ ] Helm 3에서 Tiller가 제거된 이유와 Release 정보 저장 방식을 설명할 수 있는가?
- [ ] 3-way strategic merge patch가 2-way와 어떻게 다른지 설명할 수 있는가?
- [ ] Chart.yaml의 `version`과 `appVersion`의 차이를 설명할 수 있는가?
- [ ] `application` type과 `library` type Chart의 차이를 설명할 수 있는가?
- [ ] Chart 디렉토리 구조의 각 파일/디렉토리의 역할을 설명할 수 있는가?
- [ ] crds/ 디렉토리의 제약사항 (업그레이드/삭제 미지원)을 이해하고 있는가?

### Template 엔진 (제4-5장)
- [ ] Helm 템플릿의 built-in object 6가지를 나열하고 각 용도를 설명할 수 있는가?
- [ ] `include`와 `template`의 차이를 설명할 수 있는가?
- [ ] `tpl` 함수의 용도와 보안 주의사항을 이해하고 있는가?
- [ ] `lookup` 함수의 동작과 dry-run 시 제한사항을 설명할 수 있는가?
- [ ] `{{-`와 `-}}`의 공백 제어 동작을 정확히 이해하고 있는가?
- [ ] `range` 블록 내에서 `$`로 루트 스코프에 접근하는 이유를 설명할 수 있는가?
- [ ] `default` 함수에서 `0`이 빈 값으로 처리되는 동작을 이해하고 있는가?
- [ ] 주요 String, List, Dict 함수를 5개 이상 나열할 수 있는가?

### Named Templates (제6장)
- [ ] `_helpers.tpl`에서 named template의 네이밍 컨벤션을 따를 수 있는가?
- [ ] named template에 context를 전달하는 방법과, `dict`를 사용하여 여러 값을 전달하는 패턴을 이해하고 있는가?
- [ ] ConfigMap checksum 패턴으로 Pod 자동 재시작을 구현할 수 있는가?

### Values 관리 (제7장)
- [ ] Values 병합 우선순위(values.yaml → -f 파일 → --set)를 설명할 수 있는가?
- [ ] Deep merge에서 Map과 List의 동작 차이를 설명할 수 있는가?
- [ ] `--set`, `--set-string`, `--set-file`, `--set-json`의 차이를 설명할 수 있는가?
- [ ] global values가 서브차트에 전파되는 방식을 이해하고 있는가?

### Dependencies (제8장)
- [ ] condition과 tags의 우선순위를 설명할 수 있는가?
- [ ] alias를 사용하여 같은 Chart를 여러 번 설치하는 패턴을 이해하고 있는가?
- [ ] `helm dependency update`와 `helm dependency build`의 차이를 설명할 수 있는가?

### Hooks & Tests (제9-10장)
- [ ] Helm Hook의 종류와 실행 시점을 설명할 수 있는가?
- [ ] Hook 삭제 정책 3가지와 기본값을 설명할 수 있는가?
- [ ] `helm test`와 test hook의 관계를 이해하고 있는가?
- [ ] helm-unittest로 클러스터 없이 Chart를 테스트할 수 있는가?

### Repository & Plugins (제11-12장)
- [ ] OCI Registry와 전통적 Chart Repository의 차이를 설명할 수 있는가?
- [ ] helm-diff, helm-secrets 플러그인의 용도를 설명할 수 있는가?

### 보안 & CI/CD (제13-14장)
- [ ] Chart 서명과 검증의 작동 방식을 이해하고 있는가?
- [ ] ArgoCD에서 Helm Chart를 배포하는 Application 리소스를 작성할 수 있는가?
- [ ] Helmfile과 Terraform helm_release의 장단점을 비교할 수 있는가?

### 실전 (제15-19장)
- [ ] `--atomic` 플래그와 `--wait` 플래그의 관계를 설명할 수 있는가?
- [ ] `--reuse-values`와 `--reset-values`의 차이와 사용 시나리오를 설명할 수 있는가?
- [ ] `helm template`과 `helm install --dry-run`의 차이를 설명할 수 있는가?
- [ ] 환경별 Values 파일을 분리하여 배포할 수 있는가?
- [ ] Helm 디버깅 체크리스트에 따라 문제를 진단할 수 있는가?
- [ ] Umbrella Chart 패턴의 장단점을 설명할 수 있는가?
- [ ] tart-infra 프로젝트의 Helm Release 구조를 분석하고 설명할 수 있는가?

---

## 부록 A: Helm 명령어 빠른 참조

### 차트 관리

```bash
helm create <name>                    # 차트 스캐폴딩
helm package <chart-dir>              # 차트 패키징 (.tgz)
helm lint <chart-dir>                 # 차트 린트
helm template <name> <chart>          # 로컬 렌더링
helm show chart <chart>               # Chart.yaml 정보
helm show values <chart>              # values.yaml 출력
helm show readme <chart>              # README 출력
helm show all <chart>                 # 모든 정보
```

### 릴리스 관리

```bash
helm install <name> <chart>           # 설치
helm upgrade <name> <chart>           # 업그레이드
helm upgrade --install <name> <chart> # 멱등 설치/업그레이드
helm rollback <name> [revision]       # 롤백
helm uninstall <name>                 # 삭제
helm list -A                          # 전체 릴리스 목록
helm status <name>                    # 릴리스 상태
helm history <name>                   # 릴리스 이력
helm test <name>                      # 테스트 실행
```

### 릴리스 정보 조회

```bash
helm get manifest <name>              # 배포된 매니페스트
helm get values <name>                # 사용된 values (오버라이드만)
helm get values <name> --all          # 모든 values (기본값 포함)
helm get hooks <name>                 # Hook 리소스
helm get notes <name>                 # NOTES.txt 결과
helm get all <name>                   # 모든 정보
```

### 리포지토리 관리

```bash
helm repo add <name> <url>            # 리포지토리 추가
helm repo update                      # 인덱스 갱신
helm repo list                        # 리포지토리 목록
helm repo remove <name>               # 리포지토리 제거
helm search repo <keyword>            # 차트 검색
helm search repo <chart> --versions   # 모든 버전 검색
```

### OCI 레지스트리

```bash
helm registry login <registry>        # 로그인
helm push <tgz> oci://<registry>      # Push
helm pull oci://<registry>/<chart>    # Pull
```

### 의존성

```bash
helm dependency update <chart>        # 의존성 다운로드 + Chart.lock 갱신
helm dependency build <chart>         # Chart.lock 기반 다운로드
helm dependency list <chart>          # 의존성 목록
```

### 플러그인

```bash
helm plugin install <url>             # 플러그인 설치
helm plugin list                      # 플러그인 목록
helm plugin update <name>             # 플러그인 업데이트
helm plugin uninstall <name>          # 플러그인 제거
```

---

## 부록 B: tart-infra 프로젝트 Helm Values 전체 참조

### Cilium (`manifests/cilium-values.yaml`)

```yaml
kubeProxyReplacement: true
ipam:
  mode: cluster-pool
  operator:
    clusterPoolIPv4PodCIDRList: []
operator:
  replicas: 1
resources:
  requests:
    cpu: 100m
    memory: 128Mi
  limits:
    memory: 512Mi
```

### Hubble (`manifests/hubble-values.yaml`)

```yaml
hubble:
  enabled: true
  relay:
    enabled: true
  ui:
    enabled: true
    service:
      type: NodePort
      nodePort: 31235
  metrics:
    enabled:
      - dns
      - drop
      - tcp
      - flow
      - icmp
      - http
```

### Monitoring (`manifests/monitoring-values.yaml`)

```yaml
grafana:
  enabled: true
  adminPassword: admin
  service:
    type: NodePort
    nodePort: 30300
  dashboardProviders:
    dashboardproviders.yaml:
      apiVersion: 1
      providers:
        - name: default
          orgId: 1
          folder: ''
          type: file
          disableDeletion: false
          editable: true
          options:
            path: /var/lib/grafana/dashboards/default
  dashboards:
    default:
      kubernetes-cluster:
        gnetId: 7249
        revision: 1
        datasource: Prometheus
      node-exporter:
        gnetId: 1860
        revision: 37
        datasource: Prometheus
      kubernetes-pods:
        gnetId: 6417
        revision: 1
        datasource: Prometheus

prometheus:
  prometheusSpec:
    retention: 7d
    resources:
      requests:
        cpu: 200m
        memory: 512Mi
      limits:
        memory: 2Gi
    storageSpec:
      volumeClaimTemplate:
        spec:
          accessModes: ["ReadWriteOnce"]
          resources:
            requests:
              storage: 10Gi

alertmanager:
  enabled: true
  service:
    type: NodePort
    nodePort: 30903
  alertmanagerSpec:
    resources:
      requests:
        cpu: 50m
        memory: 64Mi
      limits:
        memory: 256Mi
  config:
    global:
      resolve_timeout: 5m
    route:
      group_by: ['alertname', 'namespace']
      group_wait: 30s
      group_interval: 5m
      repeat_interval: 12h
      receiver: 'webhook-logger'
    receivers:
      - name: 'webhook-logger'
        webhook_configs:
          - url: 'http://alertmanager-webhook.monitoring.svc.cluster.local:8080/alert'
            send_resolved: true

nodeExporter:
  enabled: true
kubeStateMetrics:
  enabled: true
```

### Loki (`manifests/loki-values.yaml`)

```yaml
loki:
  enabled: true
  persistence:
    enabled: false
  resources:
    requests:
      cpu: 100m
      memory: 128Mi
    limits:
      memory: 512Mi
promtail:
  enabled: true
  resources:
    requests:
      cpu: 50m
      memory: 64Mi
    limits:
      memory: 256Mi
grafana:
  enabled: false
  sidecar:
    datasources:
      enabled: true
      isDefaultDatasource: false
```

### ArgoCD (`manifests/argocd-values.yaml`)

```yaml
server:
  service:
    type: NodePort
    nodePortHttp: 30800
  extraArgs:
    - --insecure
controller:
  resources:
    requests:
      cpu: 100m
      memory: 256Mi
    limits:
      memory: 1Gi
repoServer:
  resources:
    requests:
      cpu: 50m
      memory: 128Mi
    limits:
      memory: 512Mi
redis:
  resources:
    requests:
      cpu: 50m
      memory: 64Mi
    limits:
      memory: 256Mi
dex:
  enabled: false
```

### Jenkins (`manifests/jenkins-values.yaml`)

```yaml
controller:
  admin:
    password: admin
  serviceType: NodePort
  nodePort: 30900
  resources:
    requests:
      cpu: 200m
      memory: 512Mi
    limits:
      memory: 2Gi
  installPlugins:
    - kubernetes:latest
    - workflow-aggregator:latest
    - git:latest
    - configuration-as-code:latest
    - pipeline-stage-view:latest
    - blueocean:latest
agent:
  enabled: true
  resources:
    requests:
      cpu: 100m
      memory: 256Mi
    limits:
      memory: 512Mi
persistence:
  enabled: true
  size: 5Gi
```

### metrics-server (`manifests/metrics-server-values.yaml`)

```yaml
args:
  - --kubelet-insecure-tls
  - --kubelet-preferred-address-types=InternalIP
resources:
  requests:
    cpu: 50m
    memory: 64Mi
  limits:
    memory: 256Mi
metrics:
  enabled: true
```

---

## 참고문헌

- Helm 공식 문서: https://helm.sh/docs/
- Helm GitHub 리포지토리: https://github.com/helm/helm
- Helm Chart Template Guide: https://helm.sh/docs/chart_template_guide/
- Helm Chart Best Practices: https://helm.sh/docs/chart_best_practices/
- Helm Built-in Objects: https://helm.sh/docs/chart_template_guide/builtin_objects/
- Sprig Function Documentation: https://masterminds.github.io/sprig/
- Artifact Hub (Helm 차트 검색): https://artifacthub.io/
- chart-testing (ct) 도구: https://github.com/helm/chart-testing
- helm-diff 플러그인: https://github.com/databus23/helm-diff
- helm-secrets 플러그인: https://github.com/jkroepke/helm-secrets
- helm-unittest 플러그인: https://github.com/helm-unittest/helm-unittest
- Helm OCI Support: https://helm.sh/docs/topics/registries/
- Helmfile: https://github.com/helmfile/helmfile
- SOPS (Secrets OPerationS): https://github.com/getsops/sops
- Sigstore / Cosign: https://github.com/sigstore/cosign
- Bitnami Common Library Chart: https://github.com/bitnami/charts/tree/main/bitnami/common
