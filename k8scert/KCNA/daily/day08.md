# KCNA Day 8: Cloud Native Application Delivery - GitOps, Helm, Kustomize, CI/CD

> 학습 목표: GitOps, Helm, Kustomize, CI/CD 파이프라인, 배포 전략을 이해한다.
> 예상 소요 시간: 60분 (개념 40분 + 문제 20분)
> 시험 도메인: Cloud Native Application Delivery (8%)
> 난이도: ★★★★☆

---

## 오늘의 학습 목표

- GitOps의 핵심 4대 원칙을 설명할 수 있다
- ArgoCD와 Flux의 차이를 구분한다
- Helm과 Kustomize의 차이를 설명할 수 있다
- CI/CD 파이프라인과 배포 전략(롤링, 블루/그린, 카나리)을 이해한다
- IaC 도구(Terraform, Crossplane)를 안다

---

## 0. 등장 배경

기존 CD(Continuous Delivery) 방식에서는 CI 서버(Jenkins 등)가 kubectl apply를 직접 실행하여 클러스터에 배포했다(Push 모델). 이 방식은 CI 서버에 클러스터 admin 권한을 부여해야 하는 보안 문제가 있었고, 누가 언제 무엇을 배포했는지 추적이 어려웠다. 또한 kubectl로 직접 수정하면 코드와 실제 상태가 불일치(drift)하는 문제가 발생했다. GitOps는 이 문제를 해결하기 위해 Git을 단일 진실 소스로 삼고, 클러스터 내부의 에이전트(ArgoCD, Flux)가 Git 상태를 주기적으로 확인하여 자동 동기화하는 Pull 모델을 채택했다. 이로써 모든 변경 이력이 Git 커밋으로 남고, kubectl 직접 수정은 에이전트가 자동으로 되돌리며, CI 서버에 클러스터 권한을 줄 필요가 없어졌다.

---

## 1. GitOps (시험 빈출!)

### 1.1 GitOps 개념

> **GitOps**란?
> Git 저장소를 **단일 진실 소스(Single Source of Truth)**로 사용하여 인프라와 애플리케이션을 관리하는 방법론이다. Git에 커밋된 선언적 설정이 자동으로 클러스터에 적용된다.

### 1.2 GitOps 4대 원칙

```
GitOps 4대 원칙
============================================================

1. 선언적 설정 (Declarative)
   모든 시스템 상태를 선언적으로 기술
   → K8s YAML, Helm Chart, Kustomize

2. Git = 단일 진실 소스 (Single Source of Truth)
   원하는 상태는 Git에 저장
   → Git 저장소가 "정답"이다

3. 자동 적용 (Automated Application)
   승인된 변경 사항은 자동으로 시스템에 적용
   → PR 승인 → 자동 배포

4. 지속적 조정 (Continuous Reconciliation)
   에이전트가 실제 상태를 감시하고 차이 자동 수정
   → 누군가 kubectl로 직접 변경해도 Git 상태로 되돌림
```

### 1.3 GitOps 동작 흐름

```
GitOps 동작 흐름
============================================================

개발자                  Git 저장소              ArgoCD/Flux
+--------+           +-------------+         +-----------+
| 코드   |  push/PR  | YAML 파일   | watch   | 에이전트   |
| 변경   |---------->| (desired    |-------->| (감시)     |
|        |           |  state)     |         |           |
+--------+           +-------------+         +-----+-----+
                                                   |
                                          비교: Git vs 클러스터
                                                   |
                                          +--------v--------+
                                          | K8s 클러스터      |
                                          | (current state)  |
                                          | 차이 있으면       |
                                          | 자동 동기화       |
                                          +-----------------+

장점:
- 모든 변경 이력 Git에 기록 (감사 추적)
- PR 기반 리뷰 (변경 승인 프로세스)
- 롤백 = git revert (간단!)
- 개발자 친화적 워크플로우
```

---

## 2. ArgoCD & Flux

### 2.1 ArgoCD

> **ArgoCD**란?
> K8s용 **선언적 GitOps CD(Continuous Delivery) 도구**이다. CNCF **졸업** 프로젝트(Argo 프로젝트의 일부)이다.

```yaml
# ArgoCD Application CRD 예제
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: nginx-app
  namespace: argocd
spec:
  project: default

  source:
    repoURL: https://github.com/org/k8s-manifests.git
    targetRevision: main
    path: apps/nginx

  destination:
    server: https://kubernetes.default.svc
    namespace: demo

  syncPolicy:
    automated:
      prune: true                    # Git에서 삭제된 리소스 자동 삭제
      selfHeal: true                 # 수동 변경 시 Git 상태로 자동 복원
    syncOptions:
    - CreateNamespace=true
```

### 2.2 ArgoCD vs Flux 비교

| 항목 | ArgoCD | Flux |
|------|--------|------|
| **UI** | **풍부한 웹 UI** | CLI 중심 (UI는 별도) |
| **아키텍처** | 단일 서버 | **모듈형 컨트롤러** |
| **이미지 자동 업데이트** | 별도 도구 필요 | **내장** |
| **멀티 클러스터** | 지원 | 지원 |
| **CNCF** | **졸업** | **졸업** |

**시험 포인트:**
- ArgoCD와 Flux 모두 **CNCF 졸업** 프로젝트
- 둘 다 GitOps 기반 **CD 도구** (CI 도구가 아님!)
- ArgoCD = 풍부한 웹 UI가 강점
- Flux = 모듈형 컨트롤러, 이미지 자동 업데이트 내장

---

## 3. CI/CD 파이프라인

### 3.1 CI/CD 개념

```
CI/CD 파이프라인 흐름
============================================================

CI (Continuous Integration):
개발자 → 코드 커밋 → 자동 빌드 → 자동 테스트 → 이미지 빌드 → 레지스트리 Push

CD (Continuous Delivery):
레지스트리 → 스테이징 배포 → 통합 테스트 → [수동 승인] → 프로덕션 배포

CD (Continuous Deployment):
레지스트리 → 스테이징 배포 → 통합 테스트 → 자동 프로덕션 배포 (승인 없음)

핵심:
- Continuous Delivery = 수동 승인 가능
- Continuous Deployment = 완전 자동
```

### 3.2 CI 도구 비교

| 도구 | 특징 |
|------|------|
| **Jenkins** | 가장 오래된 오픈소스 CI, 풍부한 플러그인 |
| **GitHub Actions** | GitHub 내장, YAML 워크플로우 |
| **GitLab CI** | GitLab 내장 |
| **Tekton** | **K8s 네이티브** CI/CD, CRD로 파이프라인 정의 |

---

## 4. 배포 전략 (시험 빈출!)

### 4.1 전략 비교

```
배포 전략 비교
============================================================

1. 롤링 업데이트 (Rolling Update) - K8s 기본
  시작:  [v1] [v1] [v1]
  과정:  [v2] [v1] [v1] → [v2] [v2] [v1] → [v2] [v2] [v2]
  특징: 한 번에 하나씩 교체, 다운타임 없음

2. 블루/그린 (Blue/Green)
  Blue:  [v1] [v1] [v1] ← 현재 트래픽
  Green: [v2] [v2] [v2] ← 대기
  전환: 트래픽을 Blue에서 Green으로 한 번에 전환
  장점: 즉시 롤백 가능
  단점: 리소스 2배 필요

3. 카나리 (Canary)
  [v1] [v1] [v1] [v1] [v1] [v1] [v1] [v1] [v1] [v2]
                                               ↑
                              10% 트래픽만 v2로 전송
  → 안정성 확인 후 점진적으로 비율 증가
```

| 전략 | 다운타임 | 리소스 | 롤백 속도 | 사용 시나리오 |
|------|---------|--------|----------|-------------|
| **롤링 업데이트** | 없음 | 약간 추가 | 중간 | 일반적 배포 (K8s 기본) |
| **블루/그린** | 없음 | **2배** | **즉시** | 중요 배포, 즉시 롤백 필요 |
| **카나리** | 없음 | 약간 추가 | 빠름 | 새 버전 점진적 검증 |

---

## 5. Helm - K8s 패키지 매니저

### 5.1 Helm 핵심 개념

> **Helm**이란?
> K8s의 **패키지 매니저**로, CNCF **졸업** 프로젝트이다.

```
Helm 핵심 용어
============================================================

Chart: K8s 리소스를 정의하는 패키지 (Go 템플릿 기반)
Release: Chart를 클러스터에 설치한 인스턴스
Repository: Chart를 저장하고 배포하는 레지스트리
Values: Chart 템플릿에 주입되는 매개변수 값
```

### 5.2 Chart 디렉토리 구조

```
mychart/
├── Chart.yaml          # Chart 메타데이터 (이름, 버전)
├── values.yaml         # 기본 설정 값
├── charts/             # 의존성 Chart
├── templates/          # K8s 매니페스트 템플릿
│   ├── deployment.yaml
│   ├── service.yaml
│   ├── _helpers.tpl    # 템플릿 헬퍼 함수
│   └── NOTES.txt       # 설치 후 메시지
└── .helmignore
```

### 5.3 Helm v3 핵심 변경 (시험 빈출!)

```
Helm v2 vs v3
============================================================

v2:
  Helm Client → Tiller (서버) → K8s API Server
                  ↑
           클러스터 admin 권한! → 보안 문제!

v3:
  Helm Client → K8s API Server (직접 통신!)
  Tiller 제거! ← 시험 매우 빈출!

v3 핵심 변경:
1. Tiller 제거 (보안 문제)
2. 3-way 병합 전략
3. Release가 네임스페이스 범위로 변경
```

---

## 6. Kustomize

### 6.1 Kustomize 개념

> **Kustomize**란?
> K8s 매니페스트를 **템플릿 없이** 커스터마이징하는 도구이다. **kubectl에 내장**되어 있어 `kubectl apply -k`로 사용 가능하다.

### 6.2 Helm vs Kustomize 비교

| 항목 | Helm | Kustomize |
|------|------|-----------|
| **방식** | Go 템플릿으로 생성 | 패치(Patch)로 수정 |
| **설치** | 별도 설치 필요 | **kubectl 내장** |
| **YAML 유효성** | 템플릿이므로 유효하지 않을 수 있음 | **항상 유효한 YAML** |
| **구조** | Chart (templates + values) | base + overlays |
| **복잡한 앱** | 적합 | 단순 오버레이에 적합 |

```
Kustomize 구조
============================================================

kustomize/
├── base/                       # 기본 매니페스트
│   ├── kustomization.yaml
│   ├── deployment.yaml
│   └── service.yaml
├── overlays/
│   ├── dev/                    # 개발 환경
│   │   └── kustomization.yaml
│   ├── staging/                # 스테이징 환경
│   │   └── kustomization.yaml
│   └── prod/                   # 프로덕션 환경
│       └── kustomization.yaml

사용:
$ kubectl apply -k overlays/dev/
$ kubectl apply -k overlays/prod/
```

---

## 7. IaC (Infrastructure as Code)

### 7.1 IaC 도구 비교

| 도구 | 특징 | 언어 | CNCF |
|------|------|------|------|
| **Terraform** | 멀티 클라우드 IaC | **HCL** | - |
| **Pulumi** | 프로그래밍 언어로 인프라 정의 | Python, Go, TS | - |
| **Crossplane** | K8s 기반 클라우드 인프라 관리 | K8s CRD/YAML | **인큐베이팅** |
| **Ansible** | 에이전트리스 설정 관리 | **YAML** (Playbook) | - |

```yaml
# Crossplane 예제: K8s CRD로 AWS RDS 정의
apiVersion: database.aws.crossplane.io/v1beta1
kind: RDSInstance
metadata:
  name: my-database
spec:
  forProvider:
    dbInstanceClass: db.t3.medium
    engine: postgres
    engineVersion: "15"
    masterUsername: admin
    allocatedStorage: 20
  # K8s 리소스처럼 선언적으로 클라우드 인프라 관리!
```

---

## 8. KCNA 실전 모의 문제 (12문제)

### 문제 1.
GitOps의 핵심 원칙이 아닌 것은?

A) 모든 시스템 상태를 선언적으로 기술한다
B) Git을 단일 진실 소스(Single Source of Truth)로 사용한다
C) 변경 사항은 수동으로 서버에 SSH 접속하여 적용한다
D) 에이전트가 실제 상태를 감시하고 차이를 자동 수정한다

<details><summary>정답 확인</summary>

**정답: C) 변경 사항은 수동으로 서버에 SSH 접속하여 적용한다**

GitOps에서 변경은 Git에 커밋되고 에이전트가 **자동으로 적용**한다. SSH 수동 접속은 GitOps 원칙에 위배된다.
</details>

---

### 문제 2.
Helm에 대한 설명으로 올바르지 않은 것은?

A) Kubernetes의 패키지 매니저이다
B) Chart는 여러 K8s 매니페스트를 하나의 패키지로 묶은 것이다
C) Helm v3에서는 클러스터 내에 Tiller를 반드시 설치해야 한다
D) helm install, helm upgrade, helm rollback 명령어를 지원한다

<details><summary>정답 확인</summary>

**정답: C) Helm v3에서는 클러스터 내에 Tiller를 반드시 설치해야 한다**

Helm **v3에서 Tiller가 제거**되었다. 보안 문제(클러스터 admin 권한)로 v3부터 클라이언트만으로 동작한다.
</details>

---

### 문제 3.
ArgoCD와 Flux에 대한 설명으로 올바른 것은?

A) 둘 다 CI(Continuous Integration) 도구이다
B) 둘 다 GitOps 원칙에 따라 Git 저장소의 변경을 K8s 클러스터에 자동 동기화하는 CD 도구이다
C) 둘 다 컨테이너 이미지를 빌드하는 도구이다
D) 둘 다 서비스 메시 도구이다

<details><summary>정답 확인</summary>

**정답: B) 둘 다 GitOps 원칙에 따라 Git 저장소의 변경을 K8s 클러스터에 자동 동기화하는 CD 도구이다**

ArgoCD와 Flux는 모두 CNCF 졸업 프로젝트이며 GitOps 기반 **CD 도구**이다. CI 도구가 아님에 주의!
</details>

---

### 문제 4.
배포 전략 중 일부 트래픽만 새 버전으로 보내어 테스트한 후 점진적으로 확대하는 방식은?

A) 롤링 업데이트
B) 블루/그린
C) 카나리
D) Recreate

<details><summary>정답 확인</summary>

**정답: C) 카나리**

카나리 배포는 소량의 트래픽만 새 버전으로 보내어 안정성을 확인한 후 점진적으로 비율을 늘린다.
</details>

---

### 문제 5.
Kustomize에 대한 설명으로 올바른 것은?

A) Go 템플릿을 사용하여 K8s 매니페스트를 생성한다
B) 별도 설치가 필요하며 kubectl과 호환되지 않는다
C) base와 overlay 구조로 템플릿 없이 매니페스트를 커스터마이징한다
D) Helm Chart만 관리할 수 있다

<details><summary>정답 확인</summary>

**정답: C) base와 overlay 구조로 템플릿 없이 매니페스트를 커스터마이징한다**

Kustomize는 kubectl에 내장되어 있으며 `kubectl apply -k`로 사용 가능하다.
</details>

---

### 문제 6.
CI(Continuous Integration)와 CD(Continuous Delivery)의 차이로 올바른 것은?

A) CI는 코드를 자동 배포하고, CD는 코드를 테스트한다
B) CI는 코드 변경의 자동 빌드/테스트이고, CD는 소프트웨어를 언제든 배포 가능한 상태로 유지하는 것이다
C) CI와 CD는 동일한 개념이다
D) CI는 서버리스 환경에서만 동작한다

<details><summary>정답 확인</summary>

**정답: B) CI는 코드 변경의 자동 빌드/테스트이고, CD는 소프트웨어를 언제든 배포 가능한 상태로 유지하는 것이다**
</details>

---

### 문제 7.
Continuous Delivery와 Continuous Deployment의 차이로 올바른 것은?

A) 둘은 동일한 개념이다
B) Continuous Delivery는 수동 승인 후 배포, Continuous Deployment는 자동 배포
C) Continuous Deployment는 테스트를 건너뛴다
D) Continuous Delivery는 CI를 포함하지 않는다

<details><summary>정답 확인</summary>

**정답: B) Continuous Delivery는 수동 승인 후 배포, Continuous Deployment는 자동 배포**
</details>

---

### 문제 8.
Tekton에 대한 설명으로 올바른 것은?

A) GitOps 도구이다
B) K8s 네이티브 CI/CD 파이프라인 프레임워크이며, CRD로 파이프라인을 정의한다
C) 컨테이너 레지스트리이다
D) 서비스 메시 도구이다

<details><summary>정답 확인</summary>

**정답: B) K8s 네이티브 CI/CD 파이프라인 프레임워크이며, CRD로 파이프라인을 정의한다**
</details>

---

### 문제 9.
Terraform에 대한 설명으로 올바른 것은?

A) K8s 전용 배포 도구이다
B) 에이전트 기반 설정 관리 도구이다
C) 멀티 클라우드 IaC 도구로, HCL 언어를 사용하여 선언적으로 인프라를 정의한다
D) 컨테이너 빌드 도구이다

<details><summary>정답 확인</summary>

**정답: C) 멀티 클라우드 IaC 도구로, HCL 언어를 사용하여 선언적으로 인프라를 정의한다**
</details>

---

### 문제 10.
배포 전략 중 두 개의 동일 환경을 유지하고 트래픽을 한 번에 전환하는 방식은?

A) 롤링 업데이트
B) 블루/그린
C) 카나리
D) Recreate

<details><summary>정답 확인</summary>

**정답: B) 블루/그린**

블루/그린 배포는 두 환경을 유지하고 트래픽을 한 번에 전환한다. 즉시 롤백 가능하지만 리소스 2배 필요.
</details>

---

### 문제 11.
Helm v3의 핵심 변경 사항은?

A) Chart 형식이 JSON으로 변경되었다
B) Tiller 컴포넌트가 제거되었다
C) K8s 1.20 이상에서만 동작한다
D) Go 대신 Python으로 재작성되었다

<details><summary>정답 확인</summary>

**정답: B) Tiller 컴포넌트가 제거되었다**

Helm v3에서 Tiller가 보안 문제(cluster-admin 권한)로 제거되었다.
</details>

---

### 문제 12.
Crossplane에 대한 설명으로 올바른 것은?

A) K8s 패키지 매니저이다
B) K8s CRD를 사용하여 클라우드 인프라를 선언적으로 관리하는 CNCF 인큐베이팅 프로젝트이다
C) 컨테이너 런타임이다
D) 서비스 메시 도구이다

<details><summary>정답 확인</summary>

**정답: B) K8s CRD를 사용하여 클라우드 인프라를 선언적으로 관리하는 CNCF 인큐베이팅 프로젝트이다**
</details>

---

## tart-infra 실습

### 실습 환경 설정

```bash
# platform 클러스터 접속 (ArgoCD, Jenkins 확인용)
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/platform.yaml

# 클러스터 상태 확인
kubectl get nodes
```

### 실습 1: ArgoCD로 GitOps 4대 원칙 확인

ArgoCD의 실제 동작을 통해 GitOps 원칙을 확인한다.

```bash
# ArgoCD 구성요소 확인
kubectl get pods -n argocd
```

검증:

```text
NAME                                  READY   STATUS    RESTARTS   AGE
argocd-application-controller-0       1/1     Running   0          30d
argocd-repo-server-xxx                1/1     Running   0          30d
argocd-server-xxx                     1/1     Running   0          30d
```

```bash
# ArgoCD Application CRD 목록 확인 (선언적 설정)
kubectl get applications -n argocd
```

검증:

```text
NAME       SYNC STATUS   HEALTH STATUS   PROJECT
demo-app   Synced        Healthy         default
```

```bash
# Application의 Sync 상태 확인 (지속적 조정)
kubectl get applications -n argocd -o custom-columns=NAME:.metadata.name,SYNC:.status.sync.status,HEALTH:.status.health.status
```

검증:

```text
NAME       SYNC     HEALTH
demo-app   Synced   Healthy
```

**동작 원리:** ArgoCD는 GitOps 4대 원칙을 구현한다. (1) Application CRD로 선언적 설정, (2) Git 저장소를 Single Source of Truth로 참조, (3) Sync로 자동 적용, (4) Reconciliation Loop로 클러스터 상태를 주기적으로 Git과 비교하여 차이를 감지/수정한다.

### 실습 2: Helm Release 확인

```bash
# dev 클러스터로 전환
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/dev.yaml

# 설치된 Helm Release 목록 확인
helm list -A

# 예상 출력:
# NAME        NAMESPACE     REVISION  STATUS    CHART              APP VERSION
# cilium      kube-system   1         deployed  cilium-1.x.x       1.x.x
# istio-base  istio-system  1         deployed  base-1.x.x         1.x.x

# 특정 Release의 Values 확인 (Chart + Values = 커스터마이즈)
helm get values cilium -n kube-system

# Helm 용어 확인: Chart(패키지), Release(인스턴스), Repository(저장소)
```

**동작 원리:** Helm은 K8s 패키지 매니저이다. Chart(YAML 템플릿 패키지)에 Values(사용자 설정)를 적용하여 Release(클러스터에 설치된 인스턴스)를 생성한다. v3부터 Tiller가 제거되어 클라이언트가 직접 K8s API에 접근한다.

### 실습 3: CI/CD 파이프라인과 배포 전략

```bash
# platform 클러스터의 Jenkins 확인
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/platform.yaml
kubectl get pods -n jenkins

# Jenkins 웹 UI: http://localhost:30900
# ArgoCD 웹 UI: http://localhost:30800
# CI(Jenkins: 빌드/테스트) → CD(ArgoCD: 배포) 파이프라인 구조 확인

# dev 클러스터의 Deployment 배포 전략 확인
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/dev.yaml
kubectl get deployment nginx -n demo -o jsonpath='{.spec.strategy}' | python3 -m json.tool

# 예상 출력:
# {
#     "type": "RollingUpdate",
#     "rollingUpdate": {
#         "maxSurge": "25%",
#         "maxUnavailable": "25%"
#     }
# }
```

**동작 원리:** tart-infra는 CI(Jenkins)와 CD(ArgoCD)를 분리한 구조이다. Jenkins가 코드 빌드/테스트/이미지 푸시를 담당하고, ArgoCD가 Git에 업데이트된 매니페스트를 감지하여 클러스터에 자동 배포한다. RollingUpdate는 K8s 기본 배포 전략으로, maxSurge(초과 허용 Pod)와 maxUnavailable(동시 중단 허용 Pod)로 무중단 배포를 제어한다.

---

## 트러블슈팅

### ArgoCD Application이 OutOfSync 상태일 때

```
증상: ArgoCD Application의 Sync 상태가 OutOfSync이다
  $ kubectl get applications -n argocd
  NAME       SYNC STATUS   HEALTH STATUS
  demo-app   OutOfSync     Healthy

원인 분석:
  1. Git 저장소의 매니페스트와 클러스터의 실제 상태가 불일치한다
  2. 누군가 kubectl로 직접 클러스터를 수정했다
  3. Git에 새로운 커밋이 있지만 아직 동기화되지 않았다

디버깅 순서:
  1. ArgoCD UI에서 Diff 확인 → 어떤 리소스가 불일치하는지 시각적으로 확인
  2. 수동 동기화 실행
     $ argocd app sync demo-app
  3. selfHeal: true 설정이 되어 있는지 확인
     → selfHeal이 true이면 자동으로 Git 상태로 복원한다
  4. 자동 동기화 실패 시 로그 확인
     $ kubectl logs -n argocd -l app.kubernetes.io/name=argocd-application-controller

핵심: GitOps에서 kubectl로 직접 수정하면 ArgoCD가 해당 변경을 되돌린다.
     모든 변경은 Git을 통해야 한다.
```

### Helm 업그레이드 실패

```
증상: helm upgrade가 실패하고 Release가 failed 상태이다
  $ helm list -A
  NAME     NAMESPACE    REVISION  STATUS  ...
  my-app   demo         3         failed  ...

디버깅 순서:
  1. 실패 원인 확인
     $ helm history my-app -n demo
  2. 이전 버전으로 롤백
     $ helm rollback my-app 2 -n demo
  3. 렌더링된 매니페스트 확인 (문법 오류 검증)
     $ helm template my-app ./chart -f values.yaml
  4. dry-run으로 업그레이드 시뮬레이션
     $ helm upgrade my-app ./chart -f values.yaml --dry-run
```

---

## 복습 체크리스트

- [ ] GitOps 4대 원칙: 선언적, Git=진실, 자동 적용, 지속적 조정
- [ ] ArgoCD, Flux = CD 도구 (CI가 아님!), 둘 다 CNCF 졸업
- [ ] ArgoCD = 풍부한 웹 UI, Flux = 모듈형 + 이미지 자동 업데이트
- [ ] Helm v3: Tiller 제거! (보안 문제)
- [ ] Helm 용어: Chart(패키지), Release(인스턴스), Repository(저장소), Values(설정)
- [ ] Kustomize: 템플릿 없이 base + overlay, kubectl 내장
- [ ] 배포 전략: 롤링(K8s 기본), 블루/그린(트래픽 전환, 2배 리소스), 카나리(점진적)
- [ ] CI = 빌드/테스트, CD Delivery = 수동 승인 가능, CD Deployment = 자동
- [ ] Tekton = K8s 네이티브 CI/CD, CRD 사용
- [ ] Terraform = HCL, 멀티 클라우드 IaC
- [ ] Crossplane = K8s CRD로 클라우드 인프라, CNCF 인큐베이팅

---

## 내일 학습 예고

> Day 9에서는 전체 도메인을 포괄하는 50문제 모의시험을 실시하여 실전 감각을 익히고 취약 도메인을 파악한다.
