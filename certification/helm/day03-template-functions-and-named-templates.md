# Day 3: Template 함수와 Named Templates

Helm에서 사용할 수 있는 Template 함수 레퍼런스와 Named Templates(_helpers.tpl)를 활용한 재사용 가능한 템플릿 패턴을 다룬다.

---

## 제5장: Template 함수 레퍼런스

Helm은 Go 내장 함수 외에 Sprig 라이브러리의 70개 이상의 함수와 Helm 전용 함수를 제공한다. 주요 카테고리별로 정리한다.

### 5.1 Helm 전용 함수

| 함수 | 용도 | 예시 |
|------|------|------|
| `include` | named template을 호출하고 결과를 파이프라인에 전달한다 | `{{ include "my-app.labels" . \| nindent 4 }}` |
| `template` | named template을 호출한다 (파이프라인 불가) | `{{ template "my-app.name" . }}` |
| `tpl` | 문자열을 템플릿으로 렌더링한다 | `{{ tpl .Values.customTemplate . }}` |
| `required` | 값이 없으면 렌더링 실패시킨다 | `{{ required "image.tag is required" .Values.image.tag }}` |
| `toYaml` | Go 객체를 YAML 문자열로 변환한다 | `{{ toYaml .Values.resources }}` |
| `toJson` | JSON 문자열로 변환한다 | `{{ .Values.config \| toJson }}` |
| `toToml` | TOML 문자열로 변환한다 | `{{ .Values.config \| toToml }}` |
| `fromYaml` | YAML 문자열을 Go 객체로 파싱한다 | `{{ .Files.Get "config.yaml" \| fromYaml }}` |
| `fromJson` | JSON 문자열을 Go 객체로 파싱한다 | `{{ .Files.Get "config.json" \| fromJson }}` |
| `lookup` | 클러스터에서 기존 리소스를 조회한다 | `{{ lookup "v1" "Secret" "ns" "name" }}` |

#### include vs template

`include`와 `template`의 핵심 차이: `include`는 결과를 파이프라인으로 전달할 수 있어 `nindent` 등과 함께 사용할 수 있다. `template`은 결과를 직접 출력하므로 후처리가 불가능하다. 실무에서는 거의 항상 `include`를 사용한다.

```yaml
# template (파이프라인 불가 — 들여쓰기 제어 불가)
metadata:
  labels:
    {{ template "my-app.labels" . }}
    # 들여쓰기가 깨진다 — 위험하다

# include (파이프라인 가능 — 들여쓰기 제어 가능)
metadata:
  labels:
    {{- include "my-app.labels" . | nindent 4 }}
    # 정상적으로 들여쓰기된다
```

#### tpl 함수

`tpl`은 문자열을 Go template으로 렌더링한다. values에 템플릿 문법을 포함시킬 수 있어, 동적 설정에 유용하다.

```yaml
# values.yaml
configTemplate: |
  server.name={{ .Release.Name }}
  server.namespace={{ .Release.Namespace }}
  server.url=http://{{ .Release.Name }}.{{ .Release.Namespace }}.svc.cluster.local

# templates/configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: {{ include "my-app.fullname" . }}
data:
  config.properties: |
    {{- tpl .Values.configTemplate . | nindent 4 }}
```

> 주의: `tpl`은 values에 임의의 Go template 코드 실행을 허용한다. 신뢰할 수 없는 values를 `tpl`로 렌더링하면 보안 위험이 있다.

#### lookup 함수

`lookup`은 실행 중인 클러스터에서 기존 리소스를 조회한다. `helm template`이나 `--dry-run` 시에는 빈 값을 반환한다.

```yaml
# lookup 함수 시그니처: lookup "apiVersion" "kind" "namespace" "name"

# 특정 Secret 존재 여부 확인
{{- $secret := lookup "v1" "Secret" .Release.Namespace "my-secret" }}
{{- if $secret }}
# Secret이 이미 존재하면 기존 값을 재사용
data:
  password: {{ $secret.data.password }}
{{- else }}
# Secret이 없으면 새로 생성
data:
  password: {{ randAlphaNum 16 | b64enc }}
{{- end }}

# 빈 namespace/name으로 목록 조회
# lookup "v1" "Namespace" "" ""         → 모든 Namespace 목록
# lookup "v1" "Pod" "default" ""        → default 네임스페이스의 모든 Pod
# lookup "v1" "Secret" "myns" "mysec"  → 특정 Secret
```

### 5.2 String 함수

| 함수 | 설명 | 예시 | 결과 |
|------|------|------|------|
| `quote` | 큰따옴표로 감싼다 | `{{ "hello" \| quote }}` | `"hello"` |
| `squote` | 작은따옴표로 감싼다 | `{{ "hello" \| squote }}` | `'hello'` |
| `upper` | 대문자로 변환한다 | `{{ "hello" \| upper }}` | `HELLO` |
| `lower` | 소문자로 변환한다 | `{{ "HELLO" \| lower }}` | `hello` |
| `title` | 각 단어 첫 글자를 대문자로 변환한다 | `{{ "hello world" \| title }}` | `Hello World` |
| `trim` | 앞뒤 공백을 제거한다 | `{{ " hello " \| trim }}` | `hello` |
| `trimPrefix` | 접두사를 제거한다 | `{{ "hello" \| trimPrefix "hel" }}` | `lo` |
| `trimSuffix` | 접미사를 제거한다 | `{{ "hello-" \| trimSuffix "-" }}` | `hello` |
| `trunc` | 지정한 길이로 자른다 | `{{ "hello world" \| trunc 5 }}` | `hello` |
| `contains` | 포함 여부를 확인한다 | `{{ if contains "lo" "hello" }}` | `true` |
| `hasPrefix` | 접두사 확인한다 | `{{ if hasPrefix "hel" "hello" }}` | `true` |
| `hasSuffix` | 접미사 확인한다 | `{{ if hasSuffix "llo" "hello" }}` | `true` |
| `replace` | 문자열을 치환한다 | `{{ "foo" \| replace "o" "0" }}` | `f00` |
| `repeat` | 문자열을 반복한다 | `{{ "ha" \| repeat 3 }}` | `hahaha` |
| `substr` | 부분 문자열을 추출한다 | `{{ substr 0 3 "hello" }}` | `hel` |
| `nospace` | 모든 공백을 제거한다 | `{{ "he l lo" \| nospace }}` | `hello` |
| `abbrev` | 줄임표로 축약한다 | `{{ abbrev 5 "hello world" }}` | `he...` |
| `snakecase` | snake_case로 변환한다 | `{{ snakecase "MyApp" }}` | `my_app` |
| `camelcase` | CamelCase로 변환한다 | `{{ camelcase "my-app" }}` | `MyApp` |
| `kebabcase` | kebab-case로 변환한다 | `{{ kebabcase "MyApp" }}` | `my-app` |
| `indent` | 들여쓰기를 추가한다 | `{{ indent 4 "line" }}` | `    line` |
| `nindent` | 줄바꿈 후 들여쓰기를 추가한다 | `{{ nindent 4 "line" }}` | `\n    line` |
| `printf` | 포맷 문자열이다 | `{{ printf "%s-%s" "a" "b" }}` | `a-b` |
| `wrap` | 지정 너비에서 줄바꿈한다 | `{{ wrap 10 "long text here" }}` | 줄바꿈됨 |

### 5.3 Math 함수

| 함수 | 설명 | 예시 | 결과 |
|------|------|------|------|
| `add` | 더하기 | `{{ add 1 2 }}` | `3` |
| `sub` | 빼기 | `{{ sub 5 3 }}` | `2` |
| `mul` | 곱하기 | `{{ mul 2 3 }}` | `6` |
| `div` | 나누기 (정수) | `{{ div 10 3 }}` | `3` |
| `mod` | 나머지 | `{{ mod 10 3 }}` | `1` |
| `max` | 최대값 | `{{ max 1 2 3 }}` | `3` |
| `min` | 최소값 | `{{ min 1 2 3 }}` | `1` |
| `ceil` | 올림 | `{{ ceil 1.2 }}` | `2` |
| `floor` | 내림 | `{{ floor 1.8 }}` | `1` |
| `round` | 반올림 | `{{ round 1.5 0 }}` | `2` |
| `int` | 정수로 변환 | `{{ int "42" }}` | `42` |
| `int64` | int64로 변환 | `{{ int64 "42" }}` | `42` |
| `float64` | float64로 변환 | `{{ float64 "3.14" }}` | `3.14` |

### 5.4 Date 함수

| 함수 | 설명 | 예시 |
|------|------|------|
| `now` | 현재 시각을 반환한다 | `{{ now }}` |
| `date` | 날짜를 포맷팅한다 (Go 레이아웃) | `{{ now \| date "2006-01-02" }}` |
| `dateInZone` | 타임존 지정 포맷팅이다 | `{{ dateInZone "2006-01-02" (now) "Asia/Seoul" }}` |
| `dateModify` | 날짜를 수정한다 | `{{ now \| dateModify "-24h" }}` |
| `toDate` | 문자열을 날짜로 파싱한다 | `{{ toDate "2006-01-02" "2024-03-15" }}` |
| `unixEpoch` | Unix 타임스탬프를 반환한다 | `{{ now \| unixEpoch }}` |
| `htmlDate` | HTML date 포맷이다 | `{{ now \| htmlDate }}` |

> Go의 날짜 포맷 레이아웃은 `2006-01-02 15:04:05` (Go 탄생 시간)을 사용한다. `YYYY-MM-DD` 형식이 아님에 주의한다.

### 5.5 List 함수

| 함수 | 설명 | 예시 |
|------|------|------|
| `list` | 리스트를 생성한다 | `{{ list "a" "b" "c" }}` |
| `first` | 첫 번째 요소를 반환한다 | `{{ first (list "a" "b") }}` → `a` |
| `last` | 마지막 요소를 반환한다 | `{{ last (list "a" "b") }}` → `b` |
| `rest` | 첫 번째를 제외한 나머지를 반환한다 | `{{ rest (list "a" "b" "c") }}` → `[b c]` |
| `initial` | 마지막을 제외한 나머지를 반환한다 | `{{ initial (list "a" "b" "c") }}` → `[a b]` |
| `append` | 요소를 추가한다 | `{{ append (list "a") "b" }}` → `[a b]` |
| `prepend` | 앞에 요소를 추가한다 | `{{ prepend (list "b") "a" }}` → `[a b]` |
| `concat` | 리스트를 연결한다 | `{{ concat (list "a") (list "b") }}` → `[a b]` |
| `has` | 요소 포함 여부를 확인한다 | `{{ has "a" (list "a" "b") }}` → `true` |
| `without` | 특정 요소를 제거한다 | `{{ without (list "a" "b" "c") "b" }}` → `[a c]` |
| `uniq` | 중복을 제거한다 | `{{ list "a" "a" "b" \| uniq }}` → `[a b]` |
| `sortAlpha` | 문자열 정렬한다 | `{{ sortAlpha (list "c" "a" "b") }}` → `[a b c]` |
| `reverse` | 순서를 반전한다 | `{{ reverse (list "a" "b") }}` → `[b a]` |
| `compact` | nil/빈 문자열을 제거한다 | `{{ compact (list "a" "" "b") }}` → `[a b]` |
| `until` | 0부터 n-1까지 리스트를 생성한다 | `{{ until 3 }}` → `[0 1 2]` |
| `untilStep` | 시작/끝/스텝 리스트를 생성한다 | `{{ untilStep 0 10 2 }}` → `[0 2 4 6 8]` |
| `seq` | 숫자 시퀀스를 생성한다 | `{{ seq 1 5 }}` → `[1 2 3 4 5]` |

### 5.6 Dict (Map) 함수

| 함수 | 설명 | 예시 |
|------|------|------|
| `dict` | 딕셔너리를 생성한다 | `{{ dict "key1" "val1" "key2" "val2" }}` |
| `get` | 값을 가져온다 | `{{ get $myDict "key1" }}` |
| `set` | 값을 설정한다 | `{{ $_ := set $myDict "key" "val" }}` |
| `unset` | 키를 삭제한다 | `{{ $_ := unset $myDict "key" }}` |
| `hasKey` | 키 존재 여부를 확인한다 | `{{ if hasKey .Values "optionalField" }}` |
| `keys` | 모든 키를 반환한다 | `{{ keys $myDict }}` |
| `values` | 모든 값을 반환한다 | `{{ values $myDict }}` |
| `pluck` | 여러 맵에서 같은 키의 값을 추출한다 | `{{ pluck "name" $dict1 $dict2 }}` |
| `pick` | 지정한 키만 추출한다 | `{{ pick $myDict "key1" "key2" }}` |
| `omit` | 지정한 키를 제외한다 | `{{ omit $myDict "key1" }}` |
| `merge` | 맵을 병합한다 (첫 번째 우선) | `{{ merge $dest $src1 $src2 }}` |
| `mergeOverwrite` | 맵을 병합한다 (마지막 우선) | `{{ mergeOverwrite $dest $src }}` |
| `deepCopy` | 맵을 깊은 복사한다 | `{{ deepCopy .Values.config }}` |

```yaml
# dict 실전 활용: 동적 라벨 생성
{{- $labels := dict
  "app.kubernetes.io/name" (include "my-app.name" .)
  "app.kubernetes.io/instance" .Release.Name
  "app.kubernetes.io/managed-by" .Release.Service
}}
{{- if .Chart.AppVersion }}
  {{- $_ := set $labels "app.kubernetes.io/version" .Chart.AppVersion }}
{{- end }}
metadata:
  labels:
    {{- toYaml $labels | nindent 4 }}
```

### 5.7 Type 함수

| 함수 | 설명 | 예시 |
|------|------|------|
| `kindOf` | Go 타입 이름을 반환한다 | `{{ kindOf "hello" }}` → `string` |
| `kindIs` | 타입 일치 여부를 확인한다 | `{{ kindIs "string" "hello" }}` → `true` |
| `typeOf` | 상세 타입 이름을 반환한다 | `{{ typeOf .Values.count }}` |
| `typeIs` | 상세 타입 일치 여부를 확인한다 | `{{ typeIs "int" .Values.count }}` |
| `default` | nil이면 기본값을 사용한다 | `{{ .Values.port \| default 8080 }}` |
| `empty` | 빈 값 여부를 확인한다 | `{{ if empty .Values.name }}` |
| `coalesce` | 첫 번째 비어있지 않은 값을 반환한다 | `{{ coalesce .Values.a .Values.b "default" }}` |
| `ternary` | 삼항 연산자이다 | `{{ ternary "yes" "no" true }}` → `yes` |
| `deepEqual` | 깊은 비교이다 | `{{ deepEqual .Values.a .Values.b }}` |

`default` 함수의 동작을 정확히 이해하는 것이 중요하다:

```yaml
# default는 값이 "빈 값"일 때 기본값을 사용한다
# 빈 값: false, 0, "", nil, [], {}

{{ .Values.port | default 8080 }}
# .Values.port가 0이면 → 8080 (0은 빈 값)
# .Values.port가 설정되지 않으면 → 8080

# 0을 유효한 값으로 허용하려면 hasKey 사용
{{- if hasKey .Values "port" }}
port: {{ .Values.port }}
{{- else }}
port: 8080
{{- end }}
```

### 5.8 Crypto 함수

| 함수 | 설명 | 예시 |
|------|------|------|
| `sha1sum` | SHA-1 해시이다 | `{{ sha1sum "hello" }}` |
| `sha256sum` | SHA-256 해시이다 | `{{ sha256sum "hello" }}` |
| `adler32sum` | Adler-32 체크섬이다 | `{{ adler32sum "hello" }}` |
| `htpasswd` | Apache htpasswd 해시를 생성한다 | `{{ htpasswd "user" "pass" }}` |
| `genPrivateKey` | 개인키를 생성한다 | `{{ genPrivateKey "rsa" }}` |
| `genCA` | CA 인증서를 생성한다 | `{{ genCA "my-ca" 365 }}` |
| `genSelfSignedCert` | 자체 서명 인증서를 생성한다 | 하단 예시 참조 |
| `genSignedCert` | CA로 서명된 인증서를 생성한다 | 하단 예시 참조 |
| `randAlphaNum` | 랜덤 영숫자 문자열을 생성한다 | `{{ randAlphaNum 16 }}` |
| `randAlpha` | 랜덤 영문 문자열을 생성한다 | `{{ randAlpha 8 }}` |
| `randNumeric` | 랜덤 숫자 문자열을 생성한다 | `{{ randNumeric 6 }}` |
| `randAscii` | 랜덤 ASCII 문자열을 생성한다 | `{{ randAscii 16 }}` |

```yaml
# 자체 서명 인증서 생성 예시
{{- $ca := genCA "my-app-ca" 3650 }}
{{- $cert := genSignedCert "my-app" nil (list "my-app.default.svc") 365 $ca }}
apiVersion: v1
kind: Secret
metadata:
  name: {{ include "my-app.fullname" . }}-tls
type: kubernetes.io/tls
data:
  ca.crt: {{ $ca.Cert | b64enc }}
  tls.crt: {{ $cert.Cert | b64enc }}
  tls.key: {{ $cert.Key | b64enc }}
```

> 주의: `randAlphaNum` 등의 랜덤 함수는 매 렌더링 시 새로운 값을 생성한다. `helm upgrade`마다 Secret이 변경되어 Pod이 재시작될 수 있다. 이를 방지하려면 `lookup` 함수로 기존 값을 확인하는 패턴을 사용한다.

### 5.9 Encoding 함수

| 함수 | 설명 | 예시 |
|------|------|------|
| `b64enc` | Base64 인코딩한다 | `{{ "hello" \| b64enc }}` → `aGVsbG8=` |
| `b64dec` | Base64 디코딩한다 | `{{ "aGVsbG8=" \| b64dec }}` → `hello` |
| `toJson` | JSON으로 변환한다 | `{{ .Values.config \| toJson }}` |
| `toPrettyJson` | 들여쓰기된 JSON으로 변환한다 | `{{ .Values.config \| toPrettyJson }}` |
| `fromJson` | JSON을 파싱한다 | `{{ "..." \| fromJson }}` |
| `toYaml` | YAML로 변환한다 | `{{ .Values.resources \| toYaml }}` |
| `fromYaml` | YAML을 파싱한다 | `{{ .Files.Get "x.yaml" \| fromYaml }}` |

### 5.10 Flow Control 함수

| 함수 | 설명 | 예시 |
|------|------|------|
| `fail` | 렌더링을 강제 실패시킨다 | `{{ fail "message" }}` |
| `required` | 값이 없으면 실패시킨다 | `{{ required "msg" .Values.x }}` |

```yaml
# required를 사용한 필수 값 검증
image:
  repository: {{ required "image.repository is required!" .Values.image.repository }}
  tag: {{ required "image.tag is required! Set it or use appVersion." .Values.image.tag }}

# fail을 사용한 커스텀 유효성 검증
{{- if and .Values.autoscaling.enabled (lt (int .Values.autoscaling.minReplicas) 1) }}
  {{- fail "autoscaling.minReplicas must be at least 1" }}
{{- end }}
```

---

## 제6장: Named Templates & Partials

### 6.1 _helpers.tpl 개요

`_helpers.tpl`은 named template(정의 템플릿)을 모아두는 파일이다. 파일명 앞의 `_`(언더스코어)는 Helm에게 이 파일이 K8s 매니페스트를 생성하지 않음을 알려준다. `_`로 시작하는 모든 파일이 동일하게 처리된다 (예: `_common.tpl`, `_validation.tpl`).

### 6.2 define / template / include

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

# Chart 라벨 (chart 이름 + 버전)
{{- define "my-app.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
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

# Selector 레이블 (immutable — Deployment 생성 후 변경 불가)
{{- define "my-app.selectorLabels" -}}
app.kubernetes.io/name: {{ include "my-app.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

# ServiceAccount 이름
{{- define "my-app.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "my-app.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

# 이미지 전체 경로
{{- define "my-app.image" -}}
{{- $tag := .Values.image.tag | default .Chart.AppVersion }}
{{- printf "%s:%s" .Values.image.repository $tag }}
{{- end }}
```

### 6.3 스코프와 Context

named template은 호출 시 전달받은 context(`.`)만 접근할 수 있다. 가장 흔한 실수는 context를 전달하지 않는 것이다.

```yaml
# 잘못된 사용: context를 전달하지 않음
{{ include "my-app.labels" }}
# 에러: .Chart, .Release 등에 접근할 수 없다

# 올바른 사용: 현재 스코프(.)를 전달
{{ include "my-app.labels" . }}

# 특정 하위 context만 전달
{{- define "my-app.renderEnv" -}}
{{- range . }}
- name: {{ .name }}
  value: {{ .value | quote }}
{{- end }}
{{- end }}

# 호출 시 .Values.env만 전달
env:
  {{- include "my-app.renderEnv" .Values.env | nindent 2 }}
```

여러 값을 named template에 전달해야 하는 경우 `dict`를 사용한다:

```yaml
# 여러 값을 전달하는 패턴
{{- define "my-app.renderResource" -}}
metadata:
  name: {{ .name }}
  namespace: {{ .namespace }}
  labels:
    {{- include "my-app.labels" .root | nindent 4 }}
{{- end }}

# 호출
{{- include "my-app.renderResource" (dict
  "name" (include "my-app.fullname" .)
  "namespace" .Release.Namespace
  "root" .
) | nindent 0 }}
```

### 6.4 네이밍 컨벤션 모범 사례

- named template 이름은 `<차트이름>.<기능>` 형식을 사용한다 (예: `my-app.fullname`, `my-app.labels`)
- 차트 이름을 접두사로 붙이는 이유는 서브차트와의 이름 충돌을 방지하기 위해서이다
- Kubernetes 리소스 이름은 63자를 초과할 수 없으므로 `trunc 63`을 적용한다
- DNS 호환 이름은 `trimSuffix "-"`로 마지막 하이픈을 제거한다

### 6.5 ConfigMap/Secret checksum 패턴

ConfigMap이나 Secret이 변경되었을 때 Pod을 자동으로 재시작하는 패턴이다.

```yaml
# templates/deployment.yaml
spec:
  template:
    metadata:
      annotations:
        # ConfigMap 내용이 변경되면 checksum이 달라져서 Pod이 재생성된다
        checksum/config: {{ include (print $.Template.BasePath "/configmap.yaml") . | sha256sum }}
        checksum/secret: {{ include (print $.Template.BasePath "/secret.yaml") . | sha256sum }}
```

---

