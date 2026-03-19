# Helm - Kubernetes 패키지 매니저

## 개념

### Helm이란?
- Kubernetes의 패키지 매니저이다 (CNCF Graduated)
- Chart라는 패키지 형식으로 K8s 리소스를 관리한다
- Values 파일로 환경별 설정을 분리할 수 있다
- 배포의 버전 관리와 롤백을 지원한다
- Helm 3부터 Tiller(서버 컴포넌트)가 제거되었으며, 클라이언트 전용 아키텍처로 동작한다

### Helm 3 아키텍처
- Helm 2에서는 클러스터 내에 Tiller라는 서버 컴포넌트가 존재했다
- Tiller는 cluster-admin 권한으로 동작하여 보안 문제가 있었다
- Helm 3에서 Tiller가 완전히 제거되었고, Helm CLI가 직접 Kubernetes API Server와 통신한다
- Release 정보는 해당 Release가 설치된 **네임스페이스의 Secret** (기본값) 또는 ConfigMap에 저장된다
- 저장 드라이버는 `HELM_DRIVER` 환경변수로 변경할 수 있다 (`secret`, `configmap`, `sql`, `memory`)

```
┌──────────────┐         ┌───────────────────┐
│  Helm CLI    │────────►│ Kubernetes        │
│  (Client)    │  HTTPS  │ API Server        │
└──────┬───────┘         └────────┬──────────┘
       │                          │
       │ Chart + Values           │ Release 정보
       │ 로드 & 렌더링             │ Secret으로 저장
       │                          │
       ▼                          ▼
┌──────────────┐         ┌───────────────────┐
│  Chart Repo  │         │ Namespace         │
│  / OCI Reg   │         │ ├─ Secret         │
│              │         │ │  (sh.helm.*)    │
└──────────────┘         │ ├─ Deployment     │
                         │ ├─ Service        │
                         │ └─ ...            │
                         └───────────────────┘
```

Release Secret의 이름은 `sh.helm.release.v1.<release-name>.v<revision>` 형식이다. `kubectl get secrets -l owner=helm` 명령으로 확인할 수 있다.

### 핵심 개념
| 개념 | 설명 |
|------|------|
| Chart | K8s 리소스를 패키징한 단위 (디렉토리 또는 .tgz)이다 |
| Release | Chart를 클러스터에 설치한 인스턴스이다 |
| Revision | Release의 배포 이력 번호이다. 매 upgrade/rollback마다 증가한다 |
| Values | Chart의 설정을 커스터마이징하는 YAML 파일이다 |
| Repository | Chart를 저장하고 공유하는 저장소이다 (HTTP 서버 또는 OCI Registry) |
| Template | Go template 엔진으로 동적 K8s 매니페스트를 생성한다 |

### Chart 구조
```
mychart/
├── Chart.yaml          # 차트 메타데이터 (이름, 버전, 의존성)
├── Chart.lock          # 의존성 잠금 파일 (helm dependency update 시 생성)
├── values.yaml         # 기본 설정값
├── values.schema.json  # (선택) values의 JSON Schema 검증
├── charts/             # 의존성 차트 (.tgz 파일 또는 서브디렉토리)
├── crds/               # Custom Resource Definitions (설치 시 자동 적용)
├── templates/          # K8s 매니페스트 템플릿
│   ├── deployment.yaml
│   ├── service.yaml
│   ├── ingress.yaml
│   ├── _helpers.tpl    # 공통 헬퍼 함수 (named templates)
│   ├── NOTES.txt       # 설치 후 안내 메시지 (Go template 사용 가능)
│   └── tests/          # Helm test Pod 정의
│       └── test-connection.yaml
└── .helmignore         # 패키징 제외 파일
```

---

### 이 프로젝트에서의 실습 환경

이 프로젝트에서 Helm은 platform 클러스터에 모니터링/CI-CD 스택을 배포하는 데 사용된다.

- Terraform 모듈: `terraform/modules/helm-releases/main.tf`
- 실습 대상 클러스터: platform (`kubeconfig/platform.yaml`)

배포된 Helm Release 목록:
| Release | Chart | 네임스페이스 | NodePort |
|---------|-------|-------------|----------|
| kube-prometheus-stack | prometheus-community | monitoring | Grafana 30300 |
| loki-stack | grafana/loki-stack | monitoring | — |
| argocd | argo/argo-cd | argocd | 30800 |
| jenkins | jenkins/jenkins | jenkins | 30900 |

```bash
# platform 클러스터에서 Helm Release 확인
export KUBECONFIG=kubeconfig/platform.yaml
helm list -A
helm get values kube-prometheus-stack -n monitoring
```

---

## Chart.yaml 심화

### 주요 필드
```yaml
apiVersion: v2              # Helm 3 차트는 반드시 v2이다 (Helm 2는 v1)
name: my-app                # 차트 이름 (필수)
version: 1.2.3              # 차트 버전 (SemVer, 필수). 차트 자체의 버전이다
appVersion: "4.5.6"         # 애플리케이션 버전 (선택). 배포 대상 앱의 버전이다
description: My application
type: application           # application (기본값) 또는 library
kubeVersion: ">=1.22.0"     # 호환 가능한 K8s 버전 제약조건 (선택)
keywords:
  - web
  - nginx
home: https://example.com
sources:
  - https://github.com/example/my-app
maintainers:
  - name: John
    email: john@example.com
icon: https://example.com/icon.png
```

### version vs appVersion
| 항목 | version | appVersion |
|------|---------|------------|
| 의미 | 차트 패키지 자체의 버전이다 | 차트가 배포하는 애플리케이션의 버전이다 |
| 필수 여부 | 필수이다 | 선택이다 |
| 형식 | 반드시 SemVer 2를 따라야 한다 | 자유 형식 문자열이다 |
| 예시 | Chart 템플릿 변경 시 증가한다 | nginx 1.25 → 1.26 업그레이드 시 변경한다 |

### type: application vs library
| 항목 | application | library |
|------|-------------|---------|
| 설치 가능 여부 | `helm install`로 설치할 수 있다 | 단독 설치가 불가능하다 |
| templates/ | K8s 리소스를 렌더링한다 | templates/는 무시된다 |
| 용도 | 실제 배포 대상이다 | 공통 헬퍼/유틸리티를 다른 차트에 제공한다 |

### 의존성 선언 (dependencies)
```yaml
# Chart.yaml
dependencies:
  - name: postgresql
    version: "12.x.x"           # 버전 범위 지정 가능
    repository: https://charts.bitnami.com/bitnami
    condition: postgresql.enabled  # values에서 활성화/비활성화 제어
    tags:
      - database                  # 태그로 그룹 단위 활성화/비활성화 가능
    alias: db                     # 차트 이름 대신 별칭 사용
    import-values:                # 서브차트 values를 부모로 가져오기
      - data
```

```bash
# 의존성 다운로드 (charts/ 디렉토리에 .tgz로 저장)
helm dependency update ./mychart

# 의존성 목록 확인
helm dependency list ./mychart
```

`condition`은 `tags`보다 우선한다. `condition`이 설정된 경우 해당 값이 tags 설정을 덮어쓴다.

---

## Template 엔진 심화

Helm은 Go의 `text/template` 패키지를 기반으로 하며, Sprig 함수 라이브러리를 추가로 제공한다.

### Built-in Objects

Helm 템플릿에서 사용할 수 있는 최상위 객체이다.

| 객체 | 설명 |
|------|------|
| `.Values` | `values.yaml` 및 사용자 제공 값에 접근한다 |
| `.Release` | Release 메타데이터이다 (`.Release.Name`, `.Release.Namespace`, `.Release.Revision`, `.Release.IsUpgrade`, `.Release.IsInstall`) |
| `.Chart` | `Chart.yaml` 내용에 접근한다 (`.Chart.Name`, `.Chart.Version`, `.Chart.AppVersion`) |
| `.Capabilities` | 클러스터 정보이다 (`.Capabilities.KubeVersion`, `.Capabilities.APIVersions.Has "batch/v1"`) |
| `.Template` | 현재 템플릿 정보이다 (`.Template.Name`, `.Template.BasePath`) |
| `.Files` | 차트 내 비템플릿 파일에 접근한다 (`.Files.Get "config.ini"`, `.Files.AsConfig`, `.Files.AsSecrets`) |

### 제어 구조

#### if / else
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
{{- end }}
```

조건문에서 `false`, `0`, `""` (빈 문자열), `nil`, 빈 collection(`[]`, `{}`)은 모두 falsy로 평가된다.

#### range (반복)
```yaml
{{- range .Values.env }}
- name: {{ .name }}
  value: {{ .value | quote }}
{{- end }}

# Map 순회
{{- range $key, $value := .Values.configData }}
{{ $key }}: {{ $value | quote }}
{{- end }}
```

#### with (스코프 변경)
```yaml
{{- with .Values.nodeSelector }}
nodeSelector:
  {{- toYaml . | nindent 2 }}
{{- end }}
```

`with` 블록 내에서 `.`은 `.Values.nodeSelector`로 바뀐다. 상위 스코프에 접근하려면 `$`를 사용한다 (`$.Release.Name` 등).

### 주요 Template 함수

| 함수 | 용도 | 예시 |
|------|------|------|
| `include` | named template을 호출하고 결과를 파이프라인에 전달한다 | `{{ include "my-app.labels" . \| nindent 4 }}` |
| `template` | named template을 호출한다 (파이프라인 불가) | `{{ template "my-app.name" . }}` |
| `tpl` | 문자열을 템플릿으로 렌더링한다 | `{{ tpl .Values.customTemplate . }}` |
| `required` | 값이 없으면 렌더링 실패시킨다 | `{{ required "image.tag is required" .Values.image.tag }}` |
| `default` | 기본값을 설정한다 | `{{ .Values.port \| default 8080 }}` |
| `toYaml` | Go 객체를 YAML 문자열로 변환한다 | `{{ toYaml .Values.resources }}` |
| `nindent` | 줄바꿈 후 지정한 칸만큼 들여쓴다 | `{{ toYaml .Values.resources \| nindent 6 }}` |
| `indent` | 줄바꿈 없이 들여쓴다 | `{{ toYaml .Values.annotations \| indent 4 }}` |
| `quote` | 값을 큰따옴표로 감싼다 | `{{ .Values.name \| quote }}` |
| `lookup` | 클러스터에서 기존 리소스를 조회한다 | `{{ lookup "v1" "Secret" "ns" "name" }}` |
| `toJson` | JSON 문자열로 변환한다 | `{{ .Values.config \| toJson }}` |
| `b64enc` | Base64 인코딩한다 | `{{ .Values.password \| b64enc }}` |
| `trim` | 앞뒤 공백을 제거한다 | `{{ .Values.name \| trim }}` |
| `upper` / `lower` | 대소문자를 변환한다 | `{{ .Values.name \| upper }}` |
| `contains` | 문자열 포함 여부를 확인한다 | `{{ if contains "https" .Values.url }}` |
| `hasKey` | Map에 키가 존재하는지 확인한다 | `{{ if hasKey .Values "optionalField" }}` |

> `include`와 `template`의 핵심 차이: `include`는 결과를 파이프라인으로 전달할 수 있어 `nindent` 등과 함께 사용할 수 있다. `template`은 결과를 직접 출력하므로 후처리가 불가능하다. 실무에서는 거의 항상 `include`를 사용한다.

### 공백 제어
- `{{-`는 왼쪽 공백(줄바꿈 포함)을 제거한다
- `-}}`는 오른쪽 공백(줄바꿈 포함)을 제거한다
- YAML 들여쓰기 문제의 대부분은 공백 제어 누락에서 발생한다

```yaml
# 공백 제거 전
metadata:
  labels:
    {{ include "my-app.labels" . }}      # 들여쓰기 깨짐

# 공백 제어 적용 후
metadata:
  labels:
    {{- include "my-app.labels" . | nindent 4 }}  # 정상
```

---

## _helpers.tpl 심화

`_helpers.tpl`은 named template(정의 템플릿)을 모아두는 파일이다. 파일명 앞의 `_`(언더스코어)는 Helm에게 이 파일이 K8s 매니페스트를 생성하지 않음을 알려준다.

### named template 정의와 호출
```yaml
# templates/_helpers.tpl

# 차트 이름
{{- define "my-app.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

# 전체 이름 (release name 포함)
{{- define "my-app.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

# 공통 레이블
{{- define "my-app.labels" -}}
helm.sh/chart: {{ include "my-app.chart" . }}
app.kubernetes.io/name: {{ include "my-app.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
{{- end }}

# Selector 레이블
{{- define "my-app.selectorLabels" -}}
app.kubernetes.io/name: {{ include "my-app.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}
```

### 네이밍 컨벤션 모범 사례
- named template 이름은 `<차트이름>.<기능>` 형식을 사용한다 (예: `my-app.fullname`, `my-app.labels`)
- 차트 이름을 접두사로 붙이는 이유는 서브차트와의 이름 충돌을 방지하기 위해서이다
- Kubernetes 리소스 이름은 63자를 초과할 수 없으므로 `trunc 63`을 적용한다

---

## Values 병합 (Merging) 심화

### 우선순위 (낮음 → 높음)
```
values.yaml (차트 기본값)
    ↓ 덮어쓰기
부모 차트의 values.yaml (서브차트인 경우)
    ↓ 덮어쓰기
-f / --values 파일 (여러 개 지정 시 뒤의 파일이 우선)
    ↓ 덮어쓰기
--set / --set-string / --set-file (가장 높은 우선순위)
```

### 병합 동작
```bash
# 여러 values 파일: 뒤의 파일이 앞의 파일을 덮어쓴다
helm install my-app ./chart \
  -f values-base.yaml \
  -f values-prod.yaml        # values-prod.yaml이 우선

# --set은 모든 파일보다 우선한다
helm install my-app ./chart \
  -f values-prod.yaml \
  --set replicaCount=10      # replicaCount는 10이 된다

# --set-string은 값을 항상 문자열로 처리한다
helm install my-app ./chart --set-string enabled=true  # "true" (문자열)

# --set-file은 파일 내용을 값으로 사용한다
helm install my-app ./chart --set-file sslCert=./cert.pem
```

### Deep Merge 동작
- YAML 맵(dict)은 재귀적으로 deep merge된다
- YAML 리스트(array)는 deep merge되지 않고, 전체가 교체된다

```yaml
# values.yaml (기본)
resources:
  limits:
    cpu: 100m
    memory: 128Mi
  requests:
    cpu: 50m

# values-prod.yaml (오버라이드)
resources:
  limits:
    cpu: 500m
    # memory는 기본값 128Mi가 유지된다 (deep merge)
```

```yaml
# 리스트는 교체된다
# values.yaml
env:
  - name: FOO
    value: bar
  - name: BAZ
    value: qux

# values-prod.yaml
env:
  - name: ONLY_THIS    # 기존 리스트 전체가 이것으로 교체된다
    value: remains
```

---

## Hooks 심화

Helm Hook은 Release 생명주기의 특정 시점에 실행되는 리소스이다. `helm.sh/hook` annotation으로 지정한다.

### Hook 종류
| Hook | 실행 시점 |
|------|----------|
| `pre-install` | 템플릿 렌더링 후, K8s 리소스 생성 전에 실행한다 |
| `post-install` | 모든 K8s 리소스 생성 후 실행한다 |
| `pre-upgrade` | 템플릿 렌더링 후, 리소스 업데이트 전에 실행한다 |
| `post-upgrade` | 리소스 업데이트 후 실행한다 |
| `pre-delete` | Release 삭제 요청 시, K8s 리소스 삭제 전에 실행한다 |
| `post-delete` | Release의 모든 리소스 삭제 후 실행한다 |
| `pre-rollback` | 롤백 요청 시, 리소스 복원 전에 실행한다 |
| `post-rollback` | 리소스 복원 후 실행한다 |
| `test` | `helm test` 실행 시 동작한다 |

### Hook 예시
```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: {{ include "my-app.fullname" . }}-db-migrate
  annotations:
    "helm.sh/hook": pre-upgrade,pre-install
    "helm.sh/hook-weight": "-5"            # 낮은 숫자가 먼저 실행된다 (기본값 0)
    "helm.sh/hook-delete-policy": hook-succeeded  # 성공 시 리소스 삭제
spec:
  template:
    spec:
      containers:
        - name: migrate
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
          command: ["python", "manage.py", "migrate"]
      restartPolicy: Never
  backoffLimit: 3
```

### Hook 삭제 정책 (hook-delete-policy)
| 정책 | 설명 |
|------|------|
| `hook-succeeded` | Hook 실행 성공 시 리소스를 삭제한다 |
| `hook-failed` | Hook 실행 실패 시 리소스를 삭제한다 |
| `before-hook-creation` | 새로운 Hook 실행 전에 이전 Hook 리소스를 삭제한다 (기본값) |

### Hook Weight
- Hook이 여러 개일 때 실행 순서를 제어한다
- 문자열 형식의 정수를 사용한다 (예: `"-5"`, `"0"`, `"10"`)
- 낮은 숫자가 먼저 실행되며, 같은 weight의 Hook은 이름순으로 정렬된다

---

## Release 생명주기

### 기본 흐름
```
helm install          helm upgrade         helm rollback        helm uninstall
     │                     │                    │                     │
     ▼                     ▼                    ▼                     ▼
 Revision 1  ────►   Revision 2   ────►   Revision 3           Release 삭제
 (최초 설치)        (설정/이미지 변경)   (Revision 1 상태로 복원)  (기본: 이력도 삭제)
```

- `helm rollback`은 새로운 Revision을 생성한다 (이전 Revision의 상태를 복제)
- `helm uninstall --keep-history`를 사용하면 Release 이력을 보존한다 (이후 `helm rollback`으로 복구 가능)

### 주요 배포 플래그
| 플래그 | 설명 |
|--------|------|
| `--atomic` | 실패 시 자동으로 롤백한다. `--wait`을 암시적으로 포함한다 |
| `--wait` | 모든 리소스가 Ready 상태가 될 때까지 대기한다 |
| `--timeout` | `--wait`의 대기 시간을 설정한다 (기본값: 5m0s) |
| `--dry-run` | 실제 설치하지 않고 렌더링 결과만 출력한다 |
| `--debug` | 디버그 정보를 상세하게 출력한다 |
| `--create-namespace` | 네임스페이스가 없으면 자동 생성한다 |
| `--force` | delete + recreate 방식으로 리소스를 교체한다 |
| `--cleanup-on-fail` | 실패 시 이번 Revision에서 생성한 리소스를 정리한다 |

```bash
# 프로덕션 권장 설치 방법
helm upgrade --install my-app ./chart \
  -f values-prod.yaml \
  -n production \
  --create-namespace \
  --atomic \
  --timeout 10m
```

`helm upgrade --install`은 Release가 없으면 install, 있으면 upgrade를 수행하는 멱등(idempotent) 명령이다. CI/CD에서 권장된다.

---

## OCI Registry 지원

Helm 3.8부터 OCI (Open Container Initiative) Registry를 차트 저장소로 사용할 수 있다. Docker Hub, GitHub Container Registry (ghcr.io), AWS ECR, Harbor 등을 지원한다.

```bash
# OCI 레지스트리 로그인
helm registry login ghcr.io -u USERNAME

# 차트를 OCI 레지스트리에 Push
helm package ./mychart                        # mychart-1.0.0.tgz 생성
helm push mychart-1.0.0.tgz oci://ghcr.io/myorg/charts

# OCI 레지스트리에서 차트 Pull
helm pull oci://ghcr.io/myorg/charts/mychart --version 1.0.0

# OCI 레지스트리에서 직접 설치
helm install my-release oci://ghcr.io/myorg/charts/mychart --version 1.0.0

# 차트 정보 확인
helm show chart oci://ghcr.io/myorg/charts/mychart --version 1.0.0
```

OCI 기반 저장소는 기존 `helm repo add`가 필요 없으며, `oci://` 프로토콜로 직접 접근한다. `helm search`는 OCI 레지스트리를 지원하지 않으므로 레지스트리의 웹 UI나 API를 사용해야 한다.

---

## Chart 테스트

### helm test
`helm test`는 Release에 포함된 test Hook Pod를 실행하여 배포 상태를 검증한다.

```yaml
# templates/tests/test-connection.yaml
apiVersion: v1
kind: Pod
metadata:
  name: {{ include "my-app.fullname" . }}-test
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
```

### helm lint
차트의 구문 오류와 모범 사례 위반을 검사한다.

```bash
# 기본 린트
helm lint ./mychart

# 특정 values로 린트
helm lint ./mychart -f values-prod.yaml

# strict 모드 (경고도 에러로 처리)
helm lint ./mychart --strict
```

### chart-testing (ct) 도구
Helm 차트의 CI/CD를 위한 전용 도구이다. Git diff를 기반으로 변경된 차트만 테스트한다.

```bash
# 설치
brew install chart-testing

# 변경된 차트 린트
ct lint --config ct.yaml

# 변경된 차트 설치 테스트 (실제 클러스터 필요)
ct install --config ct.yaml
```

---

## 디버깅

### --debug 플래그
`--debug` 플래그를 사용하면 Helm이 상세한 디버그 정보를 출력한다. `--dry-run`과 함께 사용하면 실제 배포 없이 렌더링 결과를 확인할 수 있다.

```bash
# dry-run + debug: 렌더링 결과와 디버그 정보 출력
helm install my-app ./chart --dry-run --debug

# 이미 서버측 검증도 수행하는 dry-run (API Server에 요청을 보냄)
helm install my-app ./chart --dry-run=server --debug
```

### helm get 하위 명령
```bash
# 설치된 Release의 실제 매니페스트 확인
helm get manifest my-release

# 사용된 values 확인
helm get values my-release

# 모든 values (기본값 포함) 확인
helm get values my-release --all

# Hook 확인
helm get hooks my-release

# Release 메모(NOTES.txt 렌더링 결과) 확인
helm get notes my-release

# 모든 정보 한번에 확인
helm get all my-release
```

### helm template
클러스터 접근 없이 로컬에서 템플릿을 렌더링한다. CI/CD 파이프라인에서 매니페스트 검증에 유용하다.

```bash
# 전체 렌더링
helm template my-release ./chart -f values-prod.yaml

# 특정 템플릿만 렌더링
helm template my-release ./chart -s templates/deployment.yaml

# 결과를 kubectl로 검증
helm template my-release ./chart | kubectl apply --dry-run=server -f -
```

### NOTES.txt
`templates/NOTES.txt`는 `helm install` 또는 `helm upgrade` 성공 후 사용자에게 표시되는 메시지이다. Go template을 사용할 수 있다.

```
{{- if contains "NodePort" .Values.service.type }}
  export NODE_PORT=$(kubectl get --namespace {{ .Release.Namespace }} \
    -o jsonpath="{.spec.ports[0].nodePort}" services {{ include "my-app.fullname" . }})
  echo "Visit http://$NODE_IP:$NODE_PORT"
{{- else if contains "ClusterIP" .Values.service.type }}
  kubectl port-forward svc/{{ include "my-app.fullname" . }} 8080:{{ .Values.service.port }} \
    --namespace {{ .Release.Namespace }}
  echo "Visit http://127.0.0.1:8080"
{{- end }}
```

### 일반적인 디버깅 체크리스트
1. `helm lint ./chart` — 차트 구문 오류를 확인한다
2. `helm template my-release ./chart --debug` — 렌더링 결과를 확인한다
3. `helm install ... --dry-run=server --debug` — API Server 검증을 수행한다
4. `helm get manifest my-release` — 배포된 실제 매니페스트를 확인한다
5. `kubectl describe` / `kubectl logs` — Pod 레벨 문제를 확인한다
6. `helm history my-release` — Revision 이력과 상태를 확인한다

---

## 배포 흐름
```
values.yaml + templates/
         │
    ┌────▼─────┐
    │  Helm    │
    │ Template │  ← Go template 렌더링 (Sprig 함수 포함)
    │ Engine   │
    └────┬─────┘
         │
    ┌────▼──────────┐
    │  K8s Manifests│  ← 완성된 YAML
    └────┬──────────┘
         │
    ┌────▼──────────┐
    │  Kubernetes   │  ← API Server를 통해 적용
    │  API Server   │
    └───────────────┘
```

---

## 실습

### 실습 1: Helm 기본 명령어
```bash
# Helm 설치
brew install helm

# 버전 확인
helm version

# 리포지토리 추가
helm repo add bitnami https://charts.bitnami.com/bitnami
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update

# 차트 검색
helm search repo nginx
helm search repo prometheus

# 특정 버전 검색 (모든 버전 표시)
helm search repo bitnami/nginx --versions
```

### 실습 2: Chart 설치 및 관리
```bash
# Chart 설치
helm install my-nginx bitnami/nginx -n default

# Release 목록 확인
helm list -A

# Release 상태 확인
helm status my-nginx

# Values 확인 (설치된 Release의 값)
helm get values my-nginx

# 모든 설정 확인
helm get all my-nginx

# Revision 이력 확인
helm history my-nginx

# Release 삭제
helm uninstall my-nginx

# Release 삭제 (이력 보존)
helm uninstall my-nginx --keep-history
```

### 실습 3: Values로 커스터마이징
```bash
# 기본 values 확인
helm show values bitnami/nginx > nginx-values.yaml

# 커스텀 values로 설치
helm install my-nginx bitnami/nginx \
  --set replicaCount=3 \
  --set service.type=ClusterIP

# 또는 values 파일 사용
helm install my-nginx bitnami/nginx -f custom-values.yaml

# 업그레이드 (값 변경)
helm upgrade my-nginx bitnami/nginx --set replicaCount=5

# 롤백
helm rollback my-nginx 1  # revision 1로 롤백

# Revision 비교 (어떤 값이 변경되었는지 확인)
helm diff revision my-nginx 1 2  # helm-diff 플러그인 필요
```

### 실습 4: 프로젝트 Helm 설정 분석
```bash
# 프로젝트에서 사용하는 Helm values 파일 확인
ls ../../manifests/helm-values/

# Cilium values 분석
cat ../../manifests/helm-values/cilium-values.yaml

# Prometheus values 분석
cat ../../manifests/helm-values/prometheus-values.yaml
```

### 실습 5: Template 렌더링 및 디버깅
```bash
# 설치하지 않고 렌더링된 매니페스트만 확인
helm template my-nginx bitnami/nginx -f custom-values.yaml

# dry-run으로 설치 시뮬레이션 (API Server 검증 포함)
helm install my-nginx bitnami/nginx --dry-run=server --debug

# 특정 템플릿 파일만 렌더링
helm template my-nginx bitnami/nginx -s templates/deployment.yaml

# Release Secret 확인 (Helm이 릴리스 정보를 저장하는 방식)
kubectl get secrets -l owner=helm -A
```

### 실습 6: Hook 동작 확인
```bash
# Hook이 포함된 차트 생성 후 설치
helm install my-app ./my-app --debug

# Hook 확인
helm get hooks my-app

# test Hook 실행
helm test my-app --logs
```

---

## 예제

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

---

## 자가 점검
- [ ] Helm 3에서 Tiller가 제거된 이유와 Release 정보 저장 방식을 설명할 수 있는가?
- [ ] Chart.yaml의 `version`과 `appVersion`의 차이를 설명할 수 있는가?
- [ ] `application` type과 `library` type Chart의 차이를 설명할 수 있는가?
- [ ] Helm 템플릿의 built-in object 5가지를 나열하고 각 용도를 설명할 수 있는가?
- [ ] `include`와 `template`의 차이를 설명할 수 있는가?
- [ ] `_helpers.tpl`에서 named template의 네이밍 컨벤션을 따를 수 있는가?
- [ ] Values 병합 우선순위(values.yaml → -f 파일 → --set)를 설명할 수 있는가?
- [ ] Deep merge에서 Map과 List의 동작 차이를 설명할 수 있는가?
- [ ] Helm Hook의 종류와 실행 시점을 설명할 수 있는가?
- [ ] `--atomic` 플래그와 `--wait` 플래그의 관계를 설명할 수 있는가?
- [ ] `helm template`과 `helm install --dry-run`의 차이를 설명할 수 있는가?
- [ ] OCI Registry에 차트를 push/pull할 수 있는가?
- [ ] 환경별 Values 파일을 분리하여 배포할 수 있는가?
- [ ] Helm 디버깅 체크리스트에 따라 문제를 진단할 수 있는가?
- [ ] `helm test`를 사용하여 Release 상태를 검증할 수 있는가?

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
- Helm OCI Support: https://helm.sh/docs/topics/registries/
