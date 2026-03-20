# Day 2: Chart 구조와 Go Template

Helm Chart의 디렉토리 구조, Chart.yaml과 values.yaml의 상세 구조, 그리고 Go Template 엔진의 심화 문법을 다룬다.

---

## 제3장: Chart 구조 완전 가이드

### 3.1 Chart 디렉토리 구조

```
mychart/
├── Chart.yaml            # [필수] 차트 메타데이터 (이름, 버전, 의존성)
├── Chart.lock            # [자동생성] 의존성 잠금 파일
├── values.yaml           # [권장] 기본 설정값
├── values.schema.json    # [선택] values의 JSON Schema 검증
├── charts/               # [자동생성] 의존성 차트 (.tgz 파일 또는 서브디렉토리)
├── crds/                 # [선택] Custom Resource Definitions
├── templates/            # [필수*] K8s 매니페스트 템플릿
│   ├── deployment.yaml
│   ├── service.yaml
│   ├── ingress.yaml
│   ├── configmap.yaml
│   ├── secret.yaml
│   ├── serviceaccount.yaml
│   ├── hpa.yaml
│   ├── pdb.yaml
│   ├── _helpers.tpl      # 공통 헬퍼 함수 (named templates)
│   ├── NOTES.txt          # 설치 후 안내 메시지
│   └── tests/             # Helm test Pod 정의
│       └── test-connection.yaml
├── .helmignore            # [선택] 패키징 제외 파일
└── LICENSE                # [선택] 라이선스
```

> `*` library 타입 차트는 templates/가 렌더링되지 않지만, _helpers.tpl 등의 named template은 다른 차트에서 사용할 수 있다.

### 3.2 Chart.yaml 완전 레퍼런스

```yaml
# === 필수 필드 ===
apiVersion: v2              # Helm 3 차트는 반드시 v2이다 (Helm 2는 v1)
name: my-app                # 차트 이름. 소문자, 하이픈 허용. 언더스코어/대문자 비권장
version: 1.2.3              # 차트 버전 (SemVer 2 필수). 차트 구조/템플릿 변경 시 증가

# === 권장 필드 ===
appVersion: "4.5.6"         # 배포 대상 앱의 버전. 자유 형식 문자열
description: "My web application chart"
type: application           # application (기본값) 또는 library

# === 선택 필드 ===
kubeVersion: ">=1.22.0-0"   # 호환 가능한 K8s 버전 제약조건
                             # SemVer 제약 문법: >=, <=, !=, ~, ^, - (범위), || (OR)

keywords:                    # Artifact Hub 등에서 검색에 사용
  - web
  - nginx
  - proxy

home: https://example.com    # 프로젝트 홈페이지
icon: https://example.com/icon.png  # 아이콘 URL (SVG 또는 PNG)

sources:                     # 소스코드 URL 목록
  - https://github.com/example/my-app
  - https://github.com/example/my-app-chart

maintainers:                 # 유지보수자 목록
  - name: John Doe
    email: john@example.com
    url: https://johndoe.dev
  - name: Jane Smith
    email: jane@example.com

annotations:                 # 임의의 주석 (Artifact Hub 등에서 활용)
  category: WebApplication
  artifacthub.io/changes: |
    - Added support for HPA
    - Fixed ingress TLS configuration

deprecated: false            # 폐기 여부

# === 의존성 ===
dependencies:
  - name: postgresql
    version: "12.x.x"
    repository: https://charts.bitnami.com/bitnami
    condition: postgresql.enabled
    tags:
      - database
    alias: db
    import-values:
      - data
```

### 3.3 version vs appVersion

| 항목 | version | appVersion |
|------|---------|------------|
| 의미 | 차트 패키지 자체의 버전이다 | 차트가 배포하는 애플리케이션의 버전이다 |
| 필수 여부 | 필수이다 | 선택이다 |
| 형식 | 반드시 SemVer 2를 따라야 한다 | 자유 형식 문자열이다 |
| 예시 | Chart 템플릿 변경 시 증가한다 | nginx 1.25 → 1.26 업그레이드 시 변경한다 |
| 영향 | `helm search`에서 사용. Repository index에 포함 | `.Chart.AppVersion`으로 템플릿에서 참조 가능 |

실무에서 version과 appVersion을 어떻게 관리해야 하는지 자주 혼동된다. 핵심 규칙은 다음과 같다:

- **version (차트 버전)**: 차트의 템플릿, values 구조, 의존성이 변경되면 반드시 증가한다
- **appVersion (앱 버전)**: 배포하는 컨테이너 이미지 태그가 변경되면 변경한다. 차트 구조가 동일해도 앱 버전만 바뀔 수 있다
- 두 버전은 독립적이다. appVersion이 바뀌어도 version이 반드시 바뀔 필요는 없다 (단, 모범 사례로는 함께 변경을 권장)

### 3.4 type: application vs library

| 항목 | application | library |
|------|-------------|---------|
| 설치 가능 여부 | `helm install`로 설치할 수 있다 | 단독 설치가 불가능하다 |
| templates/ | K8s 리소스를 렌더링한다 | templates/는 무시된다 (named template만 유효) |
| 용도 | 실제 배포 대상이다 | 공통 헬퍼/유틸리티를 다른 차트에 제공한다 |
| 패키징 | `.tgz`로 패키징되어 Repository에 배포된다 | 다른 차트의 `dependencies`에서 참조된다 |
| 예시 | nginx chart, prometheus chart | Bitnami common library chart |

### 3.5 values.yaml

`values.yaml`은 Chart의 기본 설정을 정의한다. 이 파일의 모든 값은 `.Values` 객체를 통해 템플릿에서 접근할 수 있다.

```yaml
# values.yaml 설계 모범 사례

# 최상위 키는 기능 영역별로 그룹핑한다
replicaCount: 1

image:
  repository: nginx
  tag: ""                    # 빈 문자열이면 Chart.AppVersion 사용
  pullPolicy: IfNotPresent

imagePullSecrets: []         # 빈 리스트를 기본값으로 제공
nameOverride: ""
fullnameOverride: ""

serviceAccount:
  create: true               # 불리언은 true/false (문자열 아님)
  annotations: {}            # 빈 맵을 기본값으로 제공
  name: ""

podAnnotations: {}
podSecurityContext: {}
securityContext: {}

service:
  type: ClusterIP
  port: 80

ingress:
  enabled: false             # enabled 패턴: 리소스 생성 여부를 제어
  className: ""
  annotations: {}
  hosts:
    - host: chart-example.local
      paths:
        - path: /
          pathType: ImplementationSpecific
  tls: []

resources: {}                # 기본값은 빈 맵 (사용자가 명시적으로 설정하도록 유도)
  # limits:
  #   cpu: 100m
  #   memory: 128Mi
  # requests:
  #   cpu: 100m
  #   memory: 128Mi

autoscaling:
  enabled: false
  minReplicas: 1
  maxReplicas: 100
  targetCPUUtilizationPercentage: 80

nodeSelector: {}
tolerations: []
affinity: {}
```

### 3.6 values.schema.json

JSON Schema를 사용하여 values의 타입과 제약조건을 검증한다. `helm install`, `helm upgrade`, `helm lint` 시 자동으로 검증된다.

```json
{
  "$schema": "https://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["replicaCount", "image"],
  "properties": {
    "replicaCount": {
      "type": "integer",
      "minimum": 1,
      "maximum": 100,
      "description": "Number of pod replicas"
    },
    "image": {
      "type": "object",
      "required": ["repository"],
      "properties": {
        "repository": {
          "type": "string",
          "minLength": 1
        },
        "tag": {
          "type": "string"
        },
        "pullPolicy": {
          "type": "string",
          "enum": ["Always", "IfNotPresent", "Never"]
        }
      }
    },
    "service": {
      "type": "object",
      "properties": {
        "type": {
          "type": "string",
          "enum": ["ClusterIP", "NodePort", "LoadBalancer"]
        },
        "port": {
          "type": "integer",
          "minimum": 1,
          "maximum": 65535
        }
      }
    }
  }
}
```

### 3.7 crds/ 디렉토리

`crds/` 디렉토리에 CRD(Custom Resource Definition) YAML 파일을 배치하면, Chart 설치 시 다른 모든 리소스보다 먼저 CRD가 적용된다.

CRD 관리의 제약사항:

| 동작 | 지원 여부 | 설명 |
|------|----------|------|
| 설치 (Install) | 지원 | Chart 설치 시 crds/ 파일이 자동 적용된다 |
| 업그레이드 (Upgrade) | 미지원 | `helm upgrade` 시 CRD는 업데이트되지 않는다 |
| 삭제 (Uninstall) | 미지원 | `helm uninstall` 시 CRD는 삭제되지 않는다 |
| 템플릿화 | 미지원 | Go template 문법을 사용할 수 없다 |

CRD를 업그레이드해야 하는 경우, `kubectl apply -f crds/`를 수동으로 실행하거나 별도의 CRD 관리 Chart를 만들어야 한다. Prometheus Operator, Cert-Manager 등 많은 프로젝트가 이 이유로 CRD 전용 Chart를 별도로 제공한다.

### 3.8 .helmignore

`.helmignore`는 `.gitignore`와 동일한 문법으로, `helm package` 시 포함하지 않을 파일을 지정한다.

```
# .helmignore 예시

# 일반적인 VCS 파일
.git/
.gitignore
.bzr/
.bzrignore
.hg/
.hgignore
.svn/

# 에디터 임시 파일
*.swp
*.bak
*.tmp
*~

# OS 관련
.DS_Store

# CI/CD
.github/
.gitlab-ci.yml
Jenkinsfile
Makefile

# 테스트/문서
tests/
README.md
CONTRIBUTING.md
LICENSE

# 개발 의존성
node_modules/
vendor/

# 기타
*.orig
```

### 3.9 NOTES.txt

`templates/NOTES.txt`는 `helm install` 또는 `helm upgrade` 성공 후 사용자에게 표시되는 메시지이다. Go template을 사용할 수 있어 동적 안내 메시지를 생성한다.

```
{{- if contains "NodePort" .Values.service.type }}
  Get the application URL by running these commands:
  export NODE_PORT=$(kubectl get --namespace {{ .Release.Namespace }} \
    -o jsonpath="{.spec.ports[0].nodePort}" services {{ include "my-app.fullname" . }})
  export NODE_IP=$(kubectl get nodes --namespace {{ .Release.Namespace }} \
    -o jsonpath="{.items[0].status.addresses[0].address}")
  echo http://$NODE_IP:$NODE_PORT
{{- else if contains "LoadBalancer" .Values.service.type }}
  NOTE: It may take a few minutes for the LoadBalancer IP to be available.
  You can watch the status by running:
  kubectl get --namespace {{ .Release.Namespace }} svc -w {{ include "my-app.fullname" . }}
{{- else if contains "ClusterIP" .Values.service.type }}
  kubectl port-forward svc/{{ include "my-app.fullname" . }} 8080:{{ .Values.service.port }} \
    --namespace {{ .Release.Namespace }}
  echo "Visit http://127.0.0.1:8080"
{{- end }}
```

---

## 제4장: Go Template 심화

Helm은 Go의 `text/template` 패키지를 기반으로 하며, Sprig 함수 라이브러리를 추가로 제공한다. 이 장에서는 템플릿 엔진의 동작 원리와 실전 패턴을 깊이 있게 다룬다.

### 4.1 Template 렌더링 프로세스

```
┌────────────┐     ┌──────────────┐     ┌────────────────┐     ┌─────────────┐
│ Chart 로드  │────►│ Values 병합   │────►│ Template 렌더링 │────►│ YAML 검증    │
│ (tgz/dir)  │     │ (Merge)      │     │ (Go template)  │     │ (K8s Apply) │
└────────────┘     └──────────────┘     └────────────────┘     └─────────────┘
```

1. Chart를 로드한다 (디렉토리 또는 .tgz)
2. values.yaml, -f 파일, --set 값을 병합한다
3. 병합된 values와 Built-in Objects를 context로 Go template 엔진에 전달한다
4. 렌더링된 YAML을 `---` 구분자로 분리한다
5. 각 YAML 문서를 Kubernetes API Server에 전송한다

### 4.2 Built-in Objects

Helm 템플릿에서 사용할 수 있는 최상위 객체이다.

| 객체 | 설명 |
|------|------|
| `.Values` | `values.yaml` 및 사용자 제공 값에 접근한다 |
| `.Release` | Release 메타데이터이다 (`.Release.Name`, `.Release.Namespace`, `.Release.Revision`, `.Release.IsUpgrade`, `.Release.IsInstall`) |
| `.Chart` | `Chart.yaml` 내용에 접근한다 (`.Chart.Name`, `.Chart.Version`, `.Chart.AppVersion`) |
| `.Capabilities` | 클러스터 정보이다 (`.Capabilities.KubeVersion`, `.Capabilities.APIVersions.Has "batch/v1"`) |
| `.Template` | 현재 템플릿 정보이다 (`.Template.Name`, `.Template.BasePath`) |
| `.Files` | 차트 내 비템플릿 파일에 접근한다 (`.Files.Get "config.ini"`, `.Files.AsConfig`, `.Files.AsSecrets`) |

#### .Release 객체 상세

```yaml
# .Release 객체의 모든 필드
metadata:
  labels:
    release-name: {{ .Release.Name }}           # Release 이름 (helm install <name>)
    release-namespace: {{ .Release.Namespace }}  # 설치된 네임스페이스
    revision: {{ .Release.Revision | quote }}    # 현재 Revision 번호 (정수)
    is-upgrade: {{ .Release.IsUpgrade | quote }} # upgrade 작업인지 여부 (bool)
    is-install: {{ .Release.IsInstall | quote }} # install 작업인지 여부 (bool)
    service: {{ .Release.Service }}              # 항상 "Helm"
```

#### .Capabilities 객체 상세

```yaml
# Kubernetes API 버전에 따라 조건부 리소스 생성
{{- if .Capabilities.APIVersions.Has "autoscaling/v2" }}
apiVersion: autoscaling/v2
{{- else }}
apiVersion: autoscaling/v2beta2
{{- end }}
kind: HorizontalPodAutoscaler

# Kubernetes 버전에 따른 분기
{{- if semverCompare ">=1.25-0" .Capabilities.KubeVersion.GitVersion }}
# Kubernetes 1.25 이상에서만 사용할 수 있는 기능
{{- end }}
```

#### .Files 객체 상세

```yaml
# 차트 디렉토리에 포함된 비템플릿 파일을 읽는다
# 주의: templates/ 디렉토리의 파일은 .Files로 접근할 수 없다

# 파일 내용을 ConfigMap으로 만들기
apiVersion: v1
kind: ConfigMap
metadata:
  name: {{ include "my-app.fullname" . }}-config
data:
  # 단일 파일 읽기
  nginx.conf: |-
    {{ .Files.Get "files/nginx.conf" | indent 4 }}

  # 여러 파일을 한 번에 ConfigMap data로 변환
  {{- (.Files.Glob "files/config/*.yaml").AsConfig | nindent 2 }}

---
# 파일 내용을 Secret으로 만들기 (Base64 인코딩 자동 적용)
apiVersion: v1
kind: Secret
metadata:
  name: {{ include "my-app.fullname" . }}-certs
type: Opaque
data:
  {{- (.Files.Glob "certs/*").AsSecrets | nindent 2 }}

---
# 파일 목록을 순회
{{- range $path, $content := .Files.Glob "scripts/*.sh" }}
  {{ $path }}: |
    {{ $content | toString | indent 4 }}
{{- end }}
```

### 4.3 제어 구조

#### if / else if / else

```yaml
{{- if .Values.ingress.enabled }}
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: {{ include "my-app.fullname" . }}
  {{- if .Values.ingress.annotations }}
  annotations:
    {{- toYaml .Values.ingress.annotations | nindent 4 }}
  {{- end }}
spec:
  {{- if .Values.ingress.className }}
  ingressClassName: {{ .Values.ingress.className }}
  {{- end }}
  rules:
    {{- range .Values.ingress.hosts }}
    - host: {{ .host | quote }}
      http:
        paths:
          {{- range .paths }}
          - path: {{ .path }}
            pathType: {{ .pathType }}
            backend:
              service:
                name: {{ include "my-app.fullname" $ }}
                port:
                  number: {{ $.Values.service.port }}
          {{- end }}
    {{- end }}
{{- end }}
```

조건문에서 falsy로 평가되는 값:

| 타입 | falsy 값 |
|------|----------|
| Boolean | `false` |
| 숫자 | `0` |
| 문자열 | `""` (빈 문자열) |
| Nil | `nil` |
| 빈 컬렉션 | `[]` (빈 리스트), `{}` (빈 맵) |

> 주의: 문자열 `"false"`는 truthy이다. `--set enabled=false`는 불리언 false를 전달하지만, `--set-string enabled=false`는 문자열 `"false"`를 전달하여 truthy가 된다.

#### range (반복)

```yaml
# 리스트 순회
{{- range .Values.env }}
- name: {{ .name }}
  value: {{ .value | quote }}
{{- end }}

# 인덱스와 함께 순회
{{- range $index, $item := .Values.env }}
# {{ $index }}번째 환경변수
- name: {{ $item.name }}
  value: {{ $item.value | quote }}
{{- end }}

# Map 순회 (키-값)
{{- range $key, $value := .Values.configData }}
{{ $key }}: {{ $value | quote }}
{{- end }}

# 숫자 범위 (0부터 n-1까지)
{{- range $i := until 3 }}
- name: worker-{{ $i }}    # worker-0, worker-1, worker-2
{{- end }}

# range 내에서 상위 스코프 접근
{{- range .Values.servers }}
- name: {{ .name }}
  release: {{ $.Release.Name }}    # $ = 루트 스코프
{{- end }}
```

> `range` 블록 내에서 `.`(dot)은 현재 반복 요소로 변경된다. 상위 스코프(Release, Chart 등)에 접근하려면 `$` 접두사를 사용한다.

#### with (스코프 변경)

```yaml
{{- with .Values.nodeSelector }}
nodeSelector:
  {{- toYaml . | nindent 2 }}
{{- end }}

# with + else (값이 없을 때 기본값)
{{- with .Values.customConfig }}
config:
  {{- toYaml . | nindent 2 }}
{{- else }}
config:
  default: "value"
{{- end }}

# with 내에서 상위 스코프 접근
{{- with .Values.persistence }}
volumes:
  - name: data
    persistentVolumeClaim:
      claimName: {{ $.Release.Name }}-data    # $ 사용
{{- end }}
```

`with` 블록 내에서 `.`은 `.Values.nodeSelector`로 바뀐다. 상위 스코프에 접근하려면 `$`를 사용한다 (`$.Release.Name` 등).

#### 변수 선언

```yaml
# 변수 선언
{{- $fullName := include "my-app.fullname" . }}
{{- $svcPort := .Values.service.port }}
{{- $releaseName := .Release.Name }}

# 사용
metadata:
  name: {{ $fullName }}
  annotations:
    service-port: {{ $svcPort | quote }}

# 조건부 변수
{{- $tag := .Values.image.tag | default .Chart.AppVersion }}
image: "{{ .Values.image.repository }}:{{ $tag }}"
```

### 4.4 공백 제어 (Whitespace Control)

Helm 템플릿의 가장 흔한 문제가 공백 제어이다. YAML은 들여쓰기에 민감하므로, 불필요한 빈 줄이나 공백이 유효하지 않은 YAML을 생성할 수 있다.

- `{{-`는 왼쪽 공백(줄바꿈 포함)을 제거한다
- `-}}`는 오른쪽 공백(줄바꿈 포함)을 제거한다

```yaml
# 문제: 빈 줄이 생성됨
metadata:
  labels:
{{ include "my-app.labels" . }}      # 들여쓰기 없음, 빈 줄 발생

# 해결: 공백 제어 + nindent
metadata:
  labels:
    {{- include "my-app.labels" . | nindent 4 }}  # 정상

# 주석도 공백에 영향을 준다
spec:
  {{- /* 이 주석은 공백을 생성하지 않는다 */ -}}
  replicas: {{ .Values.replicaCount }}
```

`indent`와 `nindent`의 차이:

```yaml
# indent: 현재 위치에서 들여쓰기 적용 (줄바꿈 없음)
annotations:
  checksum: {{ include "my-app.config" . | sha256sum | indent 0 }}

# nindent: 줄바꿈(newline) 후 들여쓰기 적용
  labels:
    {{- include "my-app.labels" . | nindent 4 }}
    # 결과:
    # labels:
    #     app: my-app
    #     version: "1.0"
```

### 4.5 Pipelines

Go template의 파이프라인(`|`)은 Unix 파이프와 유사하게, 왼쪽 표현식의 결과를 오른쪽 함수의 마지막 인수로 전달한다.

```yaml
# 기본 파이프라인
{{ .Values.name | quote }}
# = {{ quote .Values.name }}

# 다단계 파이프라인
{{ .Values.name | upper | quote }}
# = {{ quote (upper .Values.name) }}

# 실전 패턴: default → trunc → trimSuffix
{{ default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}

# 복잡한 파이프라인 예시
{{ .Values.annotations | toYaml | nindent 4 }}
```

---

