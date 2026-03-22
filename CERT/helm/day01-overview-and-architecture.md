# Day 1: Helm 개요와 아키텍처

Helm의 기본 개념, Helm 2에서 3으로의 아키텍처 변화, Release 저장 메커니즘, 3-Way Merge, 그리고 tart-infra 프로젝트에서의 Helm 실습 환경을 다룬다.

---

## 제1장: Helm 개요와 아키텍처

### 1.1 Helm이란?

Helm은 Kubernetes의 공식 패키지 매니저이다 (CNCF Graduated 프로젝트). Linux에서 apt나 yum이 패키지를 관리하듯, Helm은 Kubernetes 애플리케이션을 Chart라는 패키지 형식으로 정의, 설치, 업그레이드한다. 복잡한 마이크로서비스 아키텍처에서 수십 개의 YAML 매니페스트를 일일이 관리하는 대신, 하나의 Chart로 묶어 버전 관리와 재사용이 가능하게 해준다.

Helm의 핵심 가치는 다음과 같다:

- **패키징**: 여러 Kubernetes 리소스(Deployment, Service, ConfigMap, Secret 등)를 하나의 Chart로 묶는다
- **템플릿화**: Go template 엔진으로 동적 매니페스트를 생성하여, 환경별 설정을 values 파일 하나로 제어한다
- **버전 관리**: Release 단위로 배포 이력을 추적하고, 문제 발생 시 이전 Revision으로 롤백한다
- **의존성 관리**: Chart 간 의존성을 선언적으로 관리하여 복잡한 스택을 한 번에 배포한다
- **공유**: Chart Repository 또는 OCI Registry를 통해 조직 내외부에서 Chart를 공유한다

### 1.2 Helm 2 vs Helm 3: 아키텍처 변화

#### Helm 2 아키텍처 (레거시)

Helm 2는 Client-Server 아키텍처였다. 클러스터 내부에 **Tiller**라는 서버 컴포넌트가 Pod으로 실행되었다.

```
┌──────────────┐         ┌───────────────────┐
│  Helm CLI    │────────►│     Tiller        │
│  (Client)    │  gRPC   │  (kube-system)    │
└──────────────┘         └────────┬──────────┘
                                  │ cluster-admin
                                  │ 권한으로 동작
                                  ▼
                         ┌───────────────────┐
                         │ Kubernetes        │
                         │ API Server        │
                         └───────────────────┘
```

Helm 2의 Tiller가 가진 문제점은 다음과 같다:

| 문제 | 설명 |
|------|------|
| **보안 위험** | Tiller는 기본적으로 cluster-admin 권한으로 동작했다. 누구든 Tiller에 접근할 수 있으면 클러스터 전체를 제어할 수 있었다 |
| **멀티테넌시 부재** | 네임스페이스 단위의 권한 분리가 불가능했다. Tiller 하나가 모든 네임스페이스에 리소스를 생성했다 |
| **릴리스 저장 위치** | Release 정보가 Tiller가 실행되는 kube-system 네임스페이스의 ConfigMap에 저장되었다. 릴리스가 설치된 네임스페이스와 분리되어 관리가 어려웠다 |
| **gRPC 포트 노출** | Tiller의 gRPC 포트(44134)가 클러스터 내부에 노출되어 공격 벡터가 되었다 |
| **RBAC 통합 미흡** | Kubernetes의 RBAC과 별도로 동작하여, 기존 보안 정책을 우회하는 경로가 되었다 |

#### Helm 3 아키텍처 (현재)

Helm 3에서 Tiller가 완전히 제거되었다. Helm CLI가 kubeconfig의 인증 정보를 사용하여 직접 Kubernetes API Server와 통신한다. 이는 `kubectl`과 동일한 인증/인가 경로를 사용한다는 의미이다.

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

Helm 3의 핵심 변경 사항을 요약하면 다음과 같다:

| 항목 | Helm 2 | Helm 3 |
|------|--------|--------|
| 서버 컴포넌트 | Tiller (kube-system에 배포) | 없음 (클라이언트만) |
| 인증 방식 | Tiller의 ServiceAccount | kubeconfig (kubectl과 동일) |
| Release 저장 위치 | kube-system의 ConfigMap | 릴리스 네임스페이스의 Secret |
| Release 이름 범위 | 클러스터 전체에서 고유 | 네임스페이스 내에서 고유 |
| Chart apiVersion | v1 | v2 |
| 업그레이드 전략 | 2-way strategic merge | 3-way strategic merge |
| CRD 처리 | crd-install hook | crds/ 디렉토리 |
| Lua/JSON Schema | 미지원 | JSON Schema 검증 지원 |
| Library Chart | 미지원 | type: library 지원 |

### 1.3 Release 저장 메커니즘

Helm 3에서 Release 정보는 해당 Release가 설치된 **네임스페이스의 Secret** (기본값) 또는 ConfigMap에 저장된다. 저장 드라이버는 `HELM_DRIVER` 환경변수로 변경할 수 있다.

| 드라이버 | 환경변수 값 | 설명 |
|----------|------------|------|
| Secret | `secret` (기본값) | 네임스페이스의 Secret으로 저장한다. Base64 인코딩 + gzip 압축된다 |
| ConfigMap | `configmap` | ConfigMap으로 저장한다. etcd 암호화가 설정되지 않으면 평문으로 노출될 수 있다 |
| SQL | `sql` | PostgreSQL 등 외부 SQL 데이터베이스에 저장한다 |
| Memory | `memory` | 메모리에만 저장한다. 테스트 용도로만 사용한다 |

Release Secret의 이름은 `sh.helm.release.v1.<release-name>.v<revision>` 형식이다. `kubectl get secrets -l owner=helm` 명령으로 확인할 수 있다.

```bash
# Release Secret 확인 (tart-infra platform 클러스터)
export KUBECONFIG=kubeconfig/platform.yaml

# 모든 네임스페이스에서 Helm 관리 Secret 조회
kubectl get secrets -l owner=helm -A

# 출력 예시:
# NAMESPACE    NAME                                                TYPE    DATA   AGE
# monitoring   sh.helm.release.v1.kube-prometheus-stack.v1        helm.sh/release.v1   1   5d
# monitoring   sh.helm.release.v1.loki.v1                         helm.sh/release.v1   1   5d
# argocd       sh.helm.release.v1.argocd.v1                      helm.sh/release.v1   1   5d
# jenkins      sh.helm.release.v1.jenkins.v1                     helm.sh/release.v1   1   5d

# Secret 내용 디코딩 (gzip + base64)
kubectl get secret sh.helm.release.v1.argocd.v1 -n argocd -o jsonpath='{.data.release}' \
  | base64 -d | base64 -d | gzip -d | jq .
```

Release Secret에는 다음 정보가 포함된다:

- **Chart 메타데이터**: 차트 이름, 버전, appVersion
- **Config (Values)**: 사용자가 제공한 values (기본값과 오버라이드 병합 결과)
- **Manifest**: 렌더링된 최종 Kubernetes YAML 매니페스트
- **Hooks**: 정의된 Hook 리소스
- **Info**: Release 상태 (deployed, superseded, failed 등), 설치 시각, 설명

### 1.4 3-Way Strategic Merge Patch

Helm 2에서는 **2-way merge**를 사용했다. 이전 Chart 버전의 매니페스트와 새 Chart 버전의 매니페스트만 비교하여 변경을 적용했다. 이로 인해 `kubectl edit`이나 `kubectl patch`로 직접 수정한 변경 사항이 무시되는 문제가 있었다.

Helm 3에서는 **3-way strategic merge patch**를 사용한다. 세 가지를 비교한다:

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  Old Manifest    │     │  Live State      │     │  New Manifest    │
│  (이전 Chart     │     │  (현재 클러스터   │     │  (새 Chart       │
│   렌더링 결과)    │     │   실제 상태)      │     │   렌더링 결과)    │
└────────┬─────────┘     └────────┬─────────┘     └────────┬─────────┘
         │                        │                         │
         └────────────────┬───────┘─────────────────────────┘
                          │
                   3-Way Merge
                          │
                          ▼
              ┌───────────────────┐
              │  Merged Patch     │
              │  (최종 적용 결과)  │
              └───────────────────┘
```

3-way merge의 동작 방식은 다음과 같다:

1. **Old Manifest에 있고, New Manifest에 없는 필드**: 삭제한다 (Chart에서 의도적으로 제거한 것)
2. **Old Manifest에 없고, New Manifest에 있는 필드**: 추가한다
3. **Old Manifest와 New Manifest에서 값이 다른 필드**: New Manifest 값으로 변경한다
4. **Live State에서 수동으로 변경된 필드 (Old와 다르지만 New에도 없는 필드)**: 보존한다

이 방식의 핵심 장점은 `kubectl`로 직접 수정한 변경 사항이 `helm upgrade` 시 유실되지 않는다는 것이다 (단, Chart에서 해당 필드를 명시적으로 변경하는 경우는 제외).

```bash
# 예시: kubectl로 replicas를 수동 변경
kubectl scale deployment my-app --replicas=5

# helm upgrade 시 Chart의 replicas 값이 변경되지 않았다면
# 수동으로 설정한 5개가 유지된다 (3-way merge)
helm upgrade my-app ./chart -f values.yaml
```

### 1.5 핵심 개념

| 개념 | 설명 |
|------|------|
| Chart | K8s 리소스를 패키징한 단위 (디렉토리 또는 .tgz)이다 |
| Release | Chart를 클러스터에 설치한 인스턴스이다 |
| Revision | Release의 배포 이력 번호이다. 매 upgrade/rollback마다 증가한다 |
| Values | Chart의 설정을 커스터마이징하는 YAML 파일이다 |
| Repository | Chart를 저장하고 공유하는 저장소이다 (HTTP 서버 또는 OCI Registry) |
| Template | Go template 엔진으로 동적 K8s 매니페스트를 생성한다 |

---

## 제2장: 이 프로젝트에서의 실습 환경

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

### 2.1 클러스터 구성과 Helm Release 매핑

tart-infra 프로젝트는 4개의 Kubernetes 클러스터를 운영한다. 각 클러스터별 Helm Release 배치는 다음과 같다:

```
┌─────────────────────────────────────────────────────────┐
│                    tart-infra 클러스터 구조               │
├──────────────┬──────────────┬─────────────┬─────────────┤
│  platform    │    dev       │   staging   │    prod     │
│  (관리 클러스터)│  (개발)     │   (스테이징) │   (프로덕션) │
├──────────────┼──────────────┼─────────────┼─────────────┤
│ Helm Releases│ Helm Releases│Helm Releases│Helm Releases│
│ ─────────────│ ─────────────│─────────────│─────────────│
│ cilium       │ cilium       │ cilium      │ cilium      │
│ kube-prom..  │ metrics-     │ metrics-    │ metrics-    │
│ loki-stack   │   server     │   server    │   server    │
│ argocd       │              │             │             │
│ jenkins      │              │             │             │
└──────────────┴──────────────┴─────────────┴─────────────┘
```

### 2.2 Terraform helm_release 리소스 분석

이 프로젝트에서 Helm Release는 Terraform의 `helm_release` 리소스로 선언적으로 관리된다. `terraform/modules/helm-releases/main.tf`의 구조를 분석한다.

```hcl
# terraform/modules/helm-releases/main.tf

# ===== Platform Cluster: Monitoring =====
resource "helm_release" "kube_prometheus_stack" {
  name       = "kube-prometheus-stack"
  repository = "https://prometheus-community.github.io/helm-charts"
  chart      = "kube-prometheus-stack"
  namespace  = "monitoring"

  create_namespace = true    # 네임스페이스 자동 생성
  wait             = true    # 모든 리소스 Ready 대기
  timeout          = 600     # 10분 타임아웃

  values = [file("${var.project_root}/manifests/monitoring-values.yaml")]
}

resource "helm_release" "loki" {
  depends_on = [helm_release.kube_prometheus_stack]  # 의존성 순서 보장

  name       = "loki"
  repository = "https://grafana.github.io/helm-charts"
  chart      = "loki-stack"
  namespace  = "monitoring"
  wait       = true
  timeout    = 300

  values = [file("${var.project_root}/manifests/loki-values.yaml")]
}

# ===== Platform Cluster: CI/CD =====
resource "helm_release" "argocd" {
  name       = "argocd"
  repository = "https://argoproj.github.io/argo-helm"
  chart      = "argo-cd"
  namespace  = "argocd"

  create_namespace = true
  wait             = true
  timeout          = 600

  values = [file("${var.project_root}/manifests/argocd-values.yaml")]
}

resource "helm_release" "jenkins" {
  name       = "jenkins"
  repository = "https://charts.jenkins.io"
  chart      = "jenkins"
  namespace  = "jenkins"

  create_namespace = true
  wait             = true
  timeout          = 600

  values = [file("${var.project_root}/manifests/jenkins-values.yaml")]
}
```

Terraform `helm_release` 리소스의 핵심 속성은 다음과 같다:

| 속성 | 설명 | 프로젝트 사용 예 |
|------|------|-----------------|
| `name` | Release 이름이다 | `kube-prometheus-stack`, `argocd` |
| `repository` | Chart Repository URL이다 | `https://prometheus-community.github.io/helm-charts` |
| `chart` | Chart 이름이다 | `kube-prometheus-stack`, `argo-cd` |
| `namespace` | 설치할 네임스페이스이다 | `monitoring`, `argocd`, `jenkins` |
| `create_namespace` | 네임스페이스 자동 생성 여부이다 | `true` |
| `wait` | 모든 리소스 Ready 대기이다 (`--wait` 플래그와 동일) | `true` |
| `timeout` | 타임아웃(초)이다 | `600` (10분) |
| `values` | values YAML 내용 리스트이다 | `[file("...yaml")]` |
| `depends_on` | 리소스 간 의존성을 명시한다 | `[helm_release.kube_prometheus_stack]` |
| `set` | 개별 값을 인라인으로 설정한다 | (이 프로젝트에서는 파일 기반 사용) |
| `version` | Chart 버전을 고정한다 | (미지정 시 최신) |

### 2.3 프로젝트 Values 파일 분석

#### Cilium Values (`manifests/cilium-values.yaml`)

Cilium은 모든 클러스터에서 CNI(Container Network Interface)로 사용된다. kube-proxy를 완전히 대체하는 설정이다.

```yaml
kubeProxyReplacement: true          # kube-proxy 완전 대체

ipam:
  mode: cluster-pool
  operator:
    clusterPoolIPv4PodCIDRList: []  # 클러스터별 오버라이드

operator:
  replicas: 1

resources:
  requests:
    cpu: 100m
    memory: 128Mi
  limits:
    memory: 512Mi
```

주목할 점은 `clusterPoolIPv4PodCIDRList`가 빈 리스트로 되어 있고, 각 클러스터 설치 스크립트에서 실제 CIDR을 `--set`으로 오버라이드한다는 것이다. 이는 동일한 values 파일을 공유하면서 클러스터별 차이만 `--set`으로 주입하는 패턴이다.

#### Monitoring Values (`manifests/monitoring-values.yaml`)

kube-prometheus-stack은 Prometheus, Grafana, Alertmanager, node-exporter, kube-state-metrics를 하나의 Umbrella Chart로 묶어 배포한다.

```yaml
grafana:
  enabled: true
  adminPassword: admin
  service:
    type: NodePort
    nodePort: 30300
  dashboardProviders:                    # 대시보드 프로비저너 설정
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
        gnetId: 7249                     # Grafana.com 대시보드 ID
        revision: 1
        datasource: Prometheus
      node-exporter:
        gnetId: 1860
        revision: 37
        datasource: Prometheus

prometheus:
  prometheusSpec:
    retention: 7d                        # 메트릭 보존 기간
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
              storage: 10Gi              # PersistentVolume 10Gi

alertmanager:
  enabled: true
  service:
    type: NodePort
    nodePort: 30903
```

이 Values 파일에서 볼 수 있는 Helm values 설계 패턴은 다음과 같다:

1. **서브차트 값 전달**: `grafana:`, `prometheus:`, `alertmanager:` 키가 각각 서브차트 이름이다. 부모 Chart의 values에서 서브차트 이름을 키로 사용하면 해당 서브차트에 값이 전달된다
2. **enabled 패턴**: `grafana.enabled: true`로 서브차트를 활성화/비활성화한다
3. **NodePort 노출**: 학습 환경이므로 Ingress 대신 NodePort로 직접 접근한다
4. **리소스 제한**: 모든 컴포넌트에 `resources.requests`와 `resources.limits`를 명시한다

#### Loki Values (`manifests/loki-values.yaml`)

Loki는 로그 수집 스택이다. loki-stack Chart는 Loki 본체와 Promtail(로그 수집기)을 함께 배포한다.

```yaml
loki:
  enabled: true
  persistence:
    enabled: false           # 학습 환경이므로 PV 미사용
grafana:
  enabled: false             # Grafana는 kube-prometheus-stack에서 이미 배포되므로 비활성화
  sidecar:
    datasources:
      enabled: true          # datasource 자동 등록은 활성화
promtail:
  enabled: true
```

`grafana.enabled: false`가 핵심이다. loki-stack Chart도 Grafana를 서브차트로 포함하지만, kube-prometheus-stack에서 이미 Grafana를 배포했으므로 중복을 방지하기 위해 비활성화한다. 이것이 Helm `condition` 패턴의 실전 활용이다.

#### ArgoCD Values (`manifests/argocd-values.yaml`)

```yaml
server:
  service:
    type: NodePort
    nodePortHttp: 30800
  extraArgs:
    - --insecure               # TLS 비활성화 (학습 환경)

dex:
  enabled: false               # 외부 인증 비활성화
```

`dex.enabled: false`는 ArgoCD의 외부 인증 서브차트를 비활성화한다. 학습 환경에서는 admin 계정으로 충분하기 때문이다.

#### Jenkins Values (`manifests/jenkins-values.yaml`)

```yaml
controller:
  admin:
    password: admin
  serviceType: NodePort
  nodePort: 30900
  installPlugins:              # 설치 시 자동으로 플러그인 설치
    - kubernetes:latest
    - workflow-aggregator:latest
    - git:latest
    - configuration-as-code:latest
    - pipeline-stage-view:latest
    - blueocean:latest

persistence:
  enabled: true
  size: 5Gi                    # Jenkins 데이터 영속화
```

Jenkins Chart의 `installPlugins`는 values에서 배열로 플러그인 목록을 전달하는 예시이다. Chart 내부에서 이 배열을 `range`로 순회하여 플러그인 설치 스크립트를 생성한다.

---

