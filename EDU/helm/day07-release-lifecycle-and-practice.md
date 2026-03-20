# Day 7: Release 생명주기와 실전 시나리오

Release 생명주기 관리, 실전 시나리오, Helm 환경 변수 설정, 배포 흐름 상세, 그리고 실습 과제를 다룬다.

---

## 제18장: Release 생명주기

### 18.1 기본 흐름

```
helm install          helm upgrade         helm rollback        helm uninstall
     │                     │                    │                     │
     ▼                     ▼                    ▼                     ▼
 Revision 1  ────►   Revision 2   ────►   Revision 3           Release 삭제
 (최초 설치)        (설정/이미지 변경)   (Revision 1 상태로 복원)  (기본: 이력도 삭제)
```

- `helm rollback`은 새로운 Revision을 생성한다 (이전 Revision의 상태를 복제)
- `helm uninstall --keep-history`를 사용하면 Release 이력을 보존한다 (이후 `helm rollback`으로 복구 가능)

### 18.2 Release 상태

| 상태 | 설명 |
|------|------|
| `deployed` | 정상적으로 배포된 상태이다 |
| `superseded` | 이전 Revision이다 (새 Revision이 deployed 상태) |
| `failed` | 설치/업그레이드가 실패한 상태이다 |
| `uninstalling` | 삭제 중인 상태이다 |
| `pending-install` | 설치가 진행 중인 상태이다 |
| `pending-upgrade` | 업그레이드가 진행 중인 상태이다 |
| `pending-rollback` | 롤백이 진행 중인 상태이다 |
| `uninstalled` | 삭제되었지만 이력이 보존된 상태이다 (--keep-history) |

### 18.3 주요 배포 플래그

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
| `--reset-values` | 이전 values를 무시하고 Chart 기본값 + 새 값만 사용한다 |
| `--reuse-values` | 이전 values를 유지하고, 새 값으로만 오버라이드한다 |
| `--history-max` | 유지할 최대 Revision 수이다 (기본: 10) |

```bash
# 프로덕션 권장 설치 방법
helm upgrade --install my-app ./chart \
  -f values-prod.yaml \
  -n production \
  --create-namespace \
  --atomic \
  --timeout 10m

# tart-infra 프로젝트 패턴 (Terraform)
# wait    = true     → --wait
# timeout = 600      → --timeout 10m
# create_namespace = true → --create-namespace
```

`helm upgrade --install`은 Release가 없으면 install, 있으면 upgrade를 수행하는 멱등(idempotent) 명령이다. CI/CD에서 권장된다.

### 18.4 --reuse-values vs --reset-values

이 두 플래그는 `helm upgrade` 시 values 처리 방식을 결정한다:

| 플래그 | 동작 | 사용 시나리오 |
|--------|------|-------------|
| `--reuse-values` | 이전 Release의 values를 기반으로, 새로 지정한 값만 오버라이드한다 | 기존 설정을 유지하면서 일부만 변경할 때 |
| `--reset-values` | 이전 values를 무시하고, Chart 기본값 + 새로 지정한 값만 사용한다 | Chart 버전 업그레이드 시 새 기본값을 반영할 때 |
| (둘 다 미지정) | Helm 3.14+에서는 `--reset-values`가 기본 동작이다 | 일반적인 경우 |

> 주의: `--reuse-values`는 Chart 업그레이드 시 새 values.yaml에 추가된 필드를 무시한다. Chart 메이저 버전 업그레이드 시에는 사용을 피한다.

---

## 제19장: 실전 시나리오

### 19.1 Umbrella Chart

Umbrella Chart는 여러 서브차트를 묶어 하나의 플랫폼을 배포하는 패턴이다. tart-infra의 kube-prometheus-stack이 대표적인 Umbrella Chart이다.

```yaml
# platform-stack/Chart.yaml
apiVersion: v2
name: platform-stack
version: 1.0.0
type: application
description: Platform infrastructure stack for tart-infra

dependencies:
  # 모니터링
  - name: kube-prometheus-stack
    version: "55.x.x"
    repository: https://prometheus-community.github.io/helm-charts
    condition: monitoring.enabled

  - name: loki-stack
    version: "2.10.x"
    repository: https://grafana.github.io/helm-charts
    condition: logging.enabled

  # CI/CD
  - name: argo-cd
    version: "5.x.x"
    repository: https://argoproj.github.io/argo-helm
    condition: argocd.enabled
    alias: argocd

  - name: jenkins
    version: "4.x.x"
    repository: https://charts.jenkins.io
    condition: jenkins.enabled
```

```yaml
# platform-stack/values.yaml
monitoring:
  enabled: true

logging:
  enabled: true

argocd:
  enabled: true

jenkins:
  enabled: true

# 서브차트별 values
kube-prometheus-stack:
  grafana:
    enabled: true
    service:
      type: NodePort
      nodePort: 30300

loki-stack:
  grafana:
    enabled: false

argocd:
  server:
    service:
      type: NodePort
      nodePortHttp: 30800

jenkins:
  controller:
    serviceType: NodePort
    nodePort: 30900
```

Umbrella Chart의 장점:
1. 하나의 `helm install`로 전체 플랫폼을 배포한다
2. 컴포넌트 간 의존성을 Chart.yaml로 관리한다
3. condition/tags로 선택적 배포가 가능하다
4. 버전을 통합 관리할 수 있다

Umbrella Chart의 주의점:
1. Helm의 Release Secret 크기 제한 (1MB)에 주의한다. 서브차트가 많으면 제한을 초과할 수 있다
2. 단일 Release이므로 부분 업그레이드가 어렵다 (서브차트 하나만 업그레이드해도 전체가 재평가됨)
3. 큰 Umbrella Chart는 `--timeout`을 충분히 설정해야 한다

### 19.2 Multi-Environment Deployment

#### 구조

```
my-app/
├── Chart.yaml
├── values.yaml                  # 공통 기본값
├── values-dev.yaml              # 개발 환경 오버라이드
├── values-staging.yaml          # 스테이징 환경 오버라이드
├── values-prod.yaml             # 프로덕션 환경 오버라이드
└── templates/
    ├── deployment.yaml
    ├── service.yaml
    └── _helpers.tpl
```

```yaml
# values.yaml (공통 기본값)
replicaCount: 1
image:
  repository: myapp
  tag: latest
  pullPolicy: IfNotPresent
resources:
  requests:
    cpu: 100m
    memory: 128Mi

# values-dev.yaml
replicaCount: 1
image:
  tag: dev-latest
  pullPolicy: Always
resources:
  requests:
    cpu: 50m
    memory: 64Mi

# values-staging.yaml
replicaCount: 2
image:
  tag: "1.2.3-rc1"
resources:
  requests:
    cpu: 200m
    memory: 256Mi
  limits:
    cpu: 500m
    memory: 512Mi

# values-prod.yaml
replicaCount: 3
image:
  tag: "1.2.3"
  pullPolicy: IfNotPresent
resources:
  requests:
    cpu: 500m
    memory: 512Mi
  limits:
    cpu: "1"
    memory: 1Gi
autoscaling:
  enabled: true
  minReplicas: 3
  maxReplicas: 10
  targetCPUUtilizationPercentage: 70
```

tart-infra 프로젝트에서의 멀티 환경 배포:

```bash
# tart-infra는 4개 클러스터를 kubeconfig로 구분한다
# platform: kubeconfig/platform.yaml
# dev:      kubeconfig/dev.yaml
# staging:  kubeconfig/staging.yaml
# prod:     kubeconfig/prod.yaml

# 환경별 배포 (upgrade --install로 멱등성 확보)
KUBECONFIG=kubeconfig/dev.yaml \
  helm upgrade --install my-app ./my-app -f values-dev.yaml -n dev --create-namespace --atomic

KUBECONFIG=kubeconfig/staging.yaml \
  helm upgrade --install my-app ./my-app -f values-staging.yaml -n staging --create-namespace --atomic

KUBECONFIG=kubeconfig/prod.yaml \
  helm upgrade --install my-app ./my-app -f values-prod.yaml -n prod --create-namespace --atomic
```

### 19.3 Operator Chart 패턴

Operator는 CRD와 Controller로 구성된다. Operator Chart는 일반적으로 두 단계로 배포된다:

```
1단계: Operator 설치 (CRD + Controller Deployment)
    └── helm install cert-manager jetstack/cert-manager --set installCRDs=true

2단계: Custom Resource 생성 (Operator가 처리)
    └── kubectl apply -f certificate.yaml
```

```yaml
# Operator Chart의 일반적 구조
my-operator/
├── Chart.yaml
├── values.yaml
├── crds/                          # CRD 정의 (설치 시 자동 적용)
│   ├── myresource-crd.yaml
│   └── myconfig-crd.yaml
├── templates/
│   ├── deployment.yaml            # Operator Controller
│   ├── serviceaccount.yaml
│   ├── clusterrole.yaml           # RBAC (CRD 관리 권한)
│   ├── clusterrolebinding.yaml
│   ├── _helpers.tpl
│   └── NOTES.txt
```

### 19.4 StatefulSet Chart 패턴

```yaml
# templates/statefulset.yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: {{ include "my-db.fullname" . }}
spec:
  serviceName: {{ include "my-db.fullname" . }}-headless
  replicas: {{ .Values.replicaCount }}
  selector:
    matchLabels:
      {{- include "my-db.selectorLabels" . | nindent 6 }}
  template:
    metadata:
      labels:
        {{- include "my-db.selectorLabels" . | nindent 8 }}
    spec:
      containers:
        - name: {{ .Chart.Name }}
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
          ports:
            - containerPort: {{ .Values.service.port }}
          volumeMounts:
            - name: data
              mountPath: /var/lib/data
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes: ["ReadWriteOnce"]
        {{- if .Values.persistence.storageClass }}
        storageClassName: {{ .Values.persistence.storageClass | quote }}
        {{- end }}
        resources:
          requests:
            storage: {{ .Values.persistence.size }}

---
# Headless Service (StatefulSet에 필수)
apiVersion: v1
kind: Service
metadata:
  name: {{ include "my-db.fullname" . }}-headless
spec:
  type: ClusterIP
  clusterIP: None
  ports:
    - port: {{ .Values.service.port }}
  selector:
    {{- include "my-db.selectorLabels" . | nindent 4 }}
```

### 19.5 Multi-Container (Sidecar) 패턴

```yaml
# values.yaml
sidecar:
  enabled: false
  image:
    repository: fluent/fluent-bit
    tag: latest
  resources:
    requests:
      cpu: 50m
      memory: 64Mi

# templates/deployment.yaml
spec:
  template:
    spec:
      containers:
        - name: {{ .Chart.Name }}
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
          # ... 메인 컨테이너

        {{- if .Values.sidecar.enabled }}
        - name: sidecar
          image: "{{ .Values.sidecar.image.repository }}:{{ .Values.sidecar.image.tag }}"
          {{- with .Values.sidecar.resources }}
          resources:
            {{- toYaml . | nindent 12 }}
          {{- end }}
          volumeMounts:
            - name: shared-logs
              mountPath: /var/log/app
        {{- end }}

      volumes:
        {{- if .Values.sidecar.enabled }}
        - name: shared-logs
          emptyDir: {}
        {{- end }}
```

---

## 제20장: Helm 환경 변수와 설정

### 20.1 주요 환경 변수

| 환경변수 | 설명 | 기본값 |
|----------|------|--------|
| `HELM_CACHE_HOME` | 캐시 디렉토리이다 | `$HOME/.cache/helm` |
| `HELM_CONFIG_HOME` | 설정 디렉토리이다 | `$HOME/.config/helm` |
| `HELM_DATA_HOME` | 데이터 디렉토리이다 | `$HOME/.local/share/helm` |
| `HELM_DRIVER` | Release 저장 드라이버이다 | `secret` |
| `HELM_NAMESPACE` | 기본 네임스페이스이다 | `default` |
| `HELM_MAX_HISTORY` | 기본 최대 이력 수이다 | `10` |
| `HELM_KUBECONTEXT` | 사용할 kubeconfig context이다 | 현재 context |
| `HELM_DEBUG` | 디버그 모드 활성화이다 | `false` |
| `KUBECONFIG` | kubeconfig 파일 경로이다 | `$HOME/.kube/config` |

### 20.2 Helm 디렉토리 구조

```
$HOME/
├── .cache/helm/
│   └── repository/         # helm repo update 시 다운로드된 index 캐시
├── .config/helm/
│   ├── registry/           # OCI 레지스트리 인증 정보
│   │   └── config.json
│   └── repositories.yaml   # helm repo add로 추가된 Repository 목록
└── .local/share/helm/
    └── plugins/            # 설치된 플러그인
```

---

## 제21장: 배포 흐름 상세

### 21.1 전체 렌더링 파이프라인

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

### 21.2 helm install 상세 흐름

```
1. Chart 로드
   └── 디렉토리 또는 .tgz 또는 Repository에서 다운로드

2. values.yaml 병합
   └── Chart values → parent values → -f 파일 → --set 값

3. JSON Schema 검증 (values.schema.json이 있는 경우)
   └── 실패 시 즉시 에러 반환

4. 의존성 확인 (Chart.yaml dependencies)
   └── charts/ 디렉토리에 필요한 서브차트가 있는지 확인

5. CRD 설치 (crds/ 디렉토리)
   └── 다른 리소스보다 먼저 CRD를 적용

6. Template 렌더링
   └── Go template 엔진으로 templates/ 디렉토리의 모든 파일 렌더링
   └── _로 시작하는 파일은 렌더링하지 않음 (named template only)

7. Hook 분류
   └── helm.sh/hook annotation이 있는 리소스를 분리

8. pre-install Hook 실행
   └── weight 순서대로 생성, 완료 대기

9. 일반 리소스 생성
   └── 렌더링된 매니페스트를 API Server에 전송

10. post-install Hook 실행
    └── weight 순서대로 생성, 완료 대기

11. Release Secret 저장
    └── sh.helm.release.v1.<name>.v1 Secret 생성

12. --wait (지정 시)
    └── 모든 리소스가 Ready 상태가 될 때까지 대기

13. NOTES.txt 렌더링 & 출력
```

---

## 제22장: 실습

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
ls manifests/*.yaml

# Cilium values 분석
cat manifests/cilium-values.yaml

# Prometheus values 분석
cat manifests/monitoring-values.yaml

# ArgoCD values 분석
cat manifests/argocd-values.yaml

# Jenkins values 분석
cat manifests/jenkins-values.yaml

# Loki values 분석
cat manifests/loki-values.yaml

# Terraform Helm 모듈 분석
cat terraform/modules/helm-releases/main.tf
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

### 실습 7: Chart 만들기

```bash
# Chart 스캐폴딩
helm create my-app

# 구조 확인
tree my-app/

# 린트
helm lint my-app/ --strict

# 로컬 렌더링
helm template test-release my-app/

# 패키징
helm package my-app/

# 결과: my-app-0.1.0.tgz
```

### 실습 8: 프로젝트 Release 분석

```bash
# platform 클러스터 연결
export KUBECONFIG=kubeconfig/platform.yaml

# 설치된 Release 확인
helm list -A

# kube-prometheus-stack 상세 분석
helm get values kube-prometheus-stack -n monitoring
helm get values kube-prometheus-stack -n monitoring --all | head -50
helm get manifest kube-prometheus-stack -n monitoring | grep "kind:" | sort | uniq -c
helm history kube-prometheus-stack -n monitoring

# ArgoCD 분석
helm get values argocd -n argocd
helm get manifest argocd -n argocd | grep "kind:" | sort | uniq -c

# Jenkins 분석
helm get values jenkins -n jenkins

# Release Secret 구조 확인
kubectl get secrets -l owner=helm -A
kubectl get secret sh.helm.release.v1.argocd.v1 -n argocd -o yaml | head -20
```

### 실습 9: helm-diff로 변경 사항 미리보기

```bash
# helm-diff 플러그인 설치
helm plugin install https://github.com/databus23/helm-diff

# monitoring-values.yaml 수정 후 diff 확인
helm diff upgrade kube-prometheus-stack prometheus-community/kube-prometheus-stack \
  -n monitoring \
  -f manifests/monitoring-values.yaml

# 특정 값만 변경하여 diff 확인
helm diff upgrade kube-prometheus-stack prometheus-community/kube-prometheus-stack \
  -n monitoring \
  -f manifests/monitoring-values.yaml \
  --set grafana.service.nodePort=30301
```

### 실습 10: OCI Registry 체험

```bash
# 차트 패키징
helm create oci-test-chart
helm package oci-test-chart/

# GitHub Container Registry에 Push (로그인 필요)
echo $GITHUB_TOKEN | helm registry login ghcr.io --username $GITHUB_USER --password-stdin
helm push oci-test-chart-0.1.0.tgz oci://ghcr.io/$GITHUB_USER/charts

# Pull & 설치
helm pull oci://ghcr.io/$GITHUB_USER/charts/oci-test-chart --version 0.1.0
helm install test-release oci://ghcr.io/$GITHUB_USER/charts/oci-test-chart --version 0.1.0
```

---

