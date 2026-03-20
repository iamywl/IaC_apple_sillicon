# Day 4: Values 관리, Dependencies, Hooks

Values 파일의 계층적 관리와 병합 규칙, Chart 간 의존성 관리, 그리고 Helm Hook을 활용한 배포 생명주기 제어를 다룬다.

---

## 제7장: Values 관리

### 7.1 Values 병합 우선순위

Values는 다음 순서로 병합되며, 뒤의 것이 앞의 것을 덮어쓴다:

```
values.yaml (차트 기본값) — 가장 낮은 우선순위
    ↓ 덮어쓰기
부모 차트의 values.yaml (서브차트인 경우)
    ↓ 덮어쓰기
-f / --values 파일 (여러 개 지정 시 뒤의 파일이 우선)
    ↓ 덮어쓰기
--set / --set-string / --set-file / --set-json — 가장 높은 우선순위
```

### 7.2 --set 계열 옵션 상세

```bash
# --set: 기본 값 설정
helm install my-app ./chart --set replicaCount=3

# 중첩 키 (점 표기법)
helm install my-app ./chart --set image.repository=nginx,image.tag=alpine

# 리스트 설정
helm install my-app ./chart --set 'env[0].name=FOO,env[0].value=bar'

# 문자열에 쉼표가 포함된 경우 이스케이프
helm install my-app ./chart --set 'config=a\,b\,c'

# 문자열에 점이 포함된 경우
helm install my-app ./chart --set 'nodeSelector.kubernetes\.io/os=linux'

# --set-string: 값을 항상 문자열로 처리한다
helm install my-app ./chart --set-string enabled=true  # "true" (문자열)
# 비교: --set enabled=true → true (불리언)

# --set-file: 파일 내용을 값으로 사용한다
helm install my-app ./chart --set-file sslCert=./cert.pem

# --set-json: JSON 형식의 값을 설정한다
helm install my-app ./chart --set-json 'resources={"limits":{"cpu":"500m","memory":"512Mi"}}'

# 여러 values 파일: 뒤의 파일이 앞의 파일을 덮어쓴다
helm install my-app ./chart \
  -f values-base.yaml \
  -f values-prod.yaml        # values-prod.yaml이 우선

# --set은 모든 파일보다 우선한다
helm install my-app ./chart \
  -f values-prod.yaml \
  --set replicaCount=10      # replicaCount는 10이 된다
```

### 7.3 Deep Merge 동작

YAML 맵(dict)과 리스트(array)의 병합 동작은 다르다:

```yaml
# === 맵(Dict)은 재귀적으로 Deep Merge된다 ===

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

# 결과:
# resources:
#   limits:
#     cpu: 500m       ← 오버라이드됨
#     memory: 128Mi   ← 기본값 유지 (deep merge)
#   requests:
#     cpu: 50m        ← 기본값 유지

# === 리스트(Array)는 전체가 교체된다 ===

# values.yaml
env:
  - name: FOO
    value: bar
  - name: BAZ
    value: qux

# values-prod.yaml
env:
  - name: ONLY_THIS
    value: remains

# 결과:
# env:
#   - name: ONLY_THIS    ← 기존 리스트 전체가 교체됨
#     value: remains
```

이 동작을 이해하는 것이 중요한 이유는 tart-infra 프로젝트에서도 동일한 패턴이 사용되기 때문이다. 예를 들어 `monitoring-values.yaml`에서 `grafana.dashboards.default`는 맵이므로 추가 대시보드를 오버라이드 파일에서 merge할 수 있지만, `jenkins-values.yaml`의 `controller.installPlugins`는 리스트이므로 오버라이드하면 기존 플러그인 목록이 전체 교체된다.

### 7.4 Global Values

global values는 모든 서브차트에서 동일한 이름으로 접근할 수 있는 값이다.

```yaml
# 부모 Chart의 values.yaml
global:
  imageRegistry: "registry.example.com"
  imagePullSecrets:
    - name: regcred
  storageClass: "fast-ssd"

# 어떤 서브차트에서든 접근 가능
image: "{{ .Values.global.imageRegistry }}/my-app:{{ .Values.image.tag }}"
```

global values의 특징:
- 부모 Chart에서 `global:` 키 아래 정의한다
- 모든 서브차트에서 `.Values.global.*`로 접근할 수 있다
- 서브차트가 자체 `global:` 키를 정의하면 부모의 값과 deep merge된다
- 서브차트의 서브차트(손자)에도 전파된다

### 7.5 서브차트 Values 전달

부모 Chart에서 서브차트로 값을 전달하는 방법이다:

```yaml
# 부모 Chart의 values.yaml

# 방법 1: 서브차트 이름을 키로 사용 (가장 일반적)
postgresql:
  auth:
    postgresPassword: mypassword
    database: myapp
  primary:
    resources:
      limits:
        memory: 256Mi

# 방법 2: alias가 설정된 경우 alias를 키로 사용
db:   # Chart.yaml에서 alias: db로 지정된 postgresql
  auth:
    postgresPassword: mypassword

# 방법 3: global values (모든 서브차트에 전파)
global:
  storageClass: "fast-ssd"
```

tart-infra 프로젝트에서 이 패턴의 실제 사용 예시:

```yaml
# manifests/monitoring-values.yaml
# kube-prometheus-stack은 Umbrella Chart로, grafana, prometheus, alertmanager가 서브차트이다

grafana:           # grafana 서브차트에 전달
  enabled: true
  adminPassword: admin
  service:
    type: NodePort
    nodePort: 30300

prometheus:        # prometheus 서브차트에 전달
  prometheusSpec:
    retention: 7d

alertmanager:      # alertmanager 서브차트에 전달
  enabled: true
```

---

## 제8장: Dependencies 관리

### 8.1 Chart.yaml dependencies

```yaml
# Chart.yaml
apiVersion: v2
name: my-fullstack-app
version: 1.0.0
dependencies:
  - name: postgresql           # 차트 이름 (필수)
    version: "12.x.x"          # 버전 범위 (필수). SemVer 제약 문법
    repository: https://charts.bitnami.com/bitnami  # 차트 레포지토리 (필수)
    condition: postgresql.enabled    # values에서 활성화/비활성화 (선택)
    tags:                            # 태그 기반 그룹 활성화/비활성화 (선택)
      - database
    alias: db                        # 이름 별칭 (선택)
    import-values:                   # 서브차트 values를 부모로 가져오기 (선택)
      - data
      - child: defaults.config       # 서브차트의 특정 경로
        parent: appConfig            # 부모에서의 경로
```

### 8.2 version 범위 문법

| 표기 | 의미 | 예시 |
|------|------|------|
| 정확한 버전 | 해당 버전만 | `"1.2.3"` |
| 범위 | 이상/이하 | `">= 1.2.0, < 2.0.0"` |
| 틸드 범위 | 패치 버전만 변동 | `"~1.2.3"` = `>= 1.2.3, < 1.3.0` |
| 캐럿 범위 | 마이너 버전까지 변동 | `"^1.2.3"` = `>= 1.2.3, < 2.0.0` |
| 와일드카드 | 해당 위치 자유 | `"1.2.x"` 또는 `"1.2.*"` |
| 하이픈 범위 | 범위 지정 | `"1.0.0 - 2.0.0"` |

### 8.3 condition vs tags

```yaml
# Chart.yaml
dependencies:
  - name: postgresql
    version: "12.x.x"
    repository: https://charts.bitnami.com/bitnami
    condition: postgresql.enabled
    tags:
      - database
  - name: redis
    version: "17.x.x"
    repository: https://charts.bitnami.com/bitnami
    condition: redis.enabled
    tags:
      - cache
      - database

# values.yaml
postgresql:
  enabled: true     # condition으로 개별 제어

redis:
  enabled: false    # condition으로 개별 제어

tags:
  database: true    # 태그로 그룹 제어
  cache: false
```

**condition은 tags보다 우선한다**. `condition`이 설정된 경우 해당 값이 tags 설정을 덮어쓴다. 위 예시에서 redis의 `tags.database`가 `true`이지만 `redis.enabled: false`이므로 redis는 비활성화된다.

### 8.4 alias

alias를 사용하면 같은 Chart를 여러 번 다른 이름으로 설치할 수 있다:

```yaml
# Chart.yaml
dependencies:
  - name: postgresql
    version: "12.x.x"
    repository: https://charts.bitnami.com/bitnami
    alias: primary-db           # 첫 번째 PostgreSQL 인스턴스
  - name: postgresql
    version: "12.x.x"
    repository: https://charts.bitnami.com/bitnami
    alias: replica-db           # 두 번째 PostgreSQL 인스턴스

# values.yaml
primary-db:
  auth:
    postgresPassword: primary-password
  primary:
    resources:
      limits:
        memory: 512Mi

replica-db:
  auth:
    postgresPassword: replica-password
  primary:
    resources:
      limits:
        memory: 256Mi
```

### 8.5 import-values

서브차트의 values를 부모 Chart의 values로 가져올 수 있다:

```yaml
# Chart.yaml
dependencies:
  - name: postgresql
    version: "12.x.x"
    repository: https://charts.bitnami.com/bitnami
    import-values:
      - child: primary.service    # 서브차트의 primary.service
        parent: dbService         # 부모의 dbService로 매핑

# 이후 부모 Chart에서 .Values.dbService.port 등으로 접근 가능
```

### 8.6 의존성 관리 명령

```bash
# 의존성 다운로드 (charts/ 디렉토리에 .tgz로 저장)
helm dependency update ./mychart

# 의존성 목록 확인
helm dependency list ./mychart

# 의존성 빌드 (Chart.lock 기반으로 정확한 버전 다운로드)
helm dependency build ./mychart
```

`helm dependency update`와 `helm dependency build`의 차이:

| 명령 | 동작 |
|------|------|
| `update` | Chart.yaml의 dependencies를 읽고, 최신 호환 버전을 다운로드하여 Chart.lock을 생성/갱신한다 |
| `build` | Chart.lock을 읽고, 정확히 잠긴 버전을 다운로드한다. Chart.lock이 없으면 실패한다 |

CI/CD에서는 `build`를 사용하여 재현 가능한 빌드를 보장한다.

### 8.7 로컬 의존성

```yaml
# Chart.yaml — 파일 시스템 경로로 의존성 참조
dependencies:
  - name: common-lib
    version: "1.0.0"
    repository: "file://../common-lib"   # 로컬 경로
```

이 패턴은 모노레포에서 공통 Library Chart를 여러 Application Chart에서 공유할 때 유용하다.

---

## 제9장: Hooks

Helm Hook은 Release 생명주기의 특정 시점에 실행되는 리소스이다. `helm.sh/hook` annotation으로 지정한다.

### 9.1 Hook 종류

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

### 9.2 Hook 실행 흐름

```
helm install 실행
    │
    ▼
┌─────────────────┐
│ 1. Chart 로드    │
│ 2. Values 병합   │
│ 3. Template 렌더링│
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ pre-install     │  ← Hook 리소스 생성 & 완료 대기
│ Hooks 실행       │     (Job이면 Complete, Pod이면 Succeeded)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ K8s 리소스 생성  │  ← 일반 리소스 (Deployment, Service 등)
│ (kubectl apply)  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ post-install    │  ← Hook 리소스 생성 & 완료 대기
│ Hooks 실행       │
└────────┬────────┘
         │
         ▼
    Release 완료
```

### 9.3 Hook 예시: DB 마이그레이션

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
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: {{ include "my-app.fullname" . }}-db
                  key: url
      restartPolicy: Never
  backoffLimit: 3
```

### 9.4 Hook 삭제 정책 (hook-delete-policy)

| 정책 | 설명 |
|------|------|
| `hook-succeeded` | Hook 실행 성공 시 리소스를 삭제한다 |
| `hook-failed` | Hook 실행 실패 시 리소스를 삭제한다 |
| `before-hook-creation` | 새로운 Hook 실행 전에 이전 Hook 리소스를 삭제한다 (기본값) |

여러 정책을 동시에 지정할 수 있다:

```yaml
annotations:
  "helm.sh/hook-delete-policy": hook-succeeded,hook-failed
```

`before-hook-creation`이 기본값인 이유는 이전 Hook Job이 남아있으면 동일한 이름의 새 Job을 생성할 수 없기 때문이다. 삭제 정책을 지정하지 않으면 이전 Hook 리소스가 남아있어 `helm upgrade` 시 오류가 발생할 수 있다.

### 9.5 Hook Weight

- Hook이 여러 개일 때 실행 순서를 제어한다
- 문자열 형식의 정수를 사용한다 (예: `"-5"`, `"0"`, `"10"`)
- 낮은 숫자가 먼저 실행되며, 같은 weight의 Hook은 Kind 순서 → 이름순으로 정렬된다

```yaml
# 1번째 실행: 스키마 생성
annotations:
  "helm.sh/hook": pre-install
  "helm.sh/hook-weight": "-10"

# 2번째 실행: 초기 데이터 삽입
annotations:
  "helm.sh/hook": pre-install
  "helm.sh/hook-weight": "-5"

# 3번째 실행: 캐시 워밍업
annotations:
  "helm.sh/hook": pre-install
  "helm.sh/hook-weight": "0"
```

### 9.6 Hook 주의사항

1. Hook 리소스는 Release의 일부로 관리되지 않는다. `helm uninstall` 시 Hook 리소스는 삭제되지 않을 수 있다
2. Hook이 실패하면 전체 Release 작업이 실패한다. `--atomic` 플래그와 함께 사용하면 실패 시 자동 롤백된다
3. `--wait` 플래그는 Hook에도 적용된다. Hook Job이 Complete 상태가 될 때까지 대기한다
4. Hook 리소스에도 일반 템플릿 문법 (`.Values`, `.Release` 등)을 사용할 수 있다

---

