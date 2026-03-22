# KCNA Day 6: Cloud Native Architecture - CNCF, 마이크로서비스, 서비스 메시, 오토스케일링

> 학습 목표: CNCF 생태계, 클라우드 네이티브 설계 원칙, 서비스 메시, 오토스케일링을 이해한다.
> 예상 소요 시간: 60분 (개념 40분 + 문제 20분)
> 시험 도메인: Cloud Native Architecture (16%)
> 난이도: ★★★★☆

---

## 오늘의 학습 목표

- CNCF 프로젝트 성숙도(Sandbox/Incubating/Graduated)를 안다
- Cloud Native의 핵심 5대 요소를 나열할 수 있다
- 마이크로서비스와 모놀리식 아키텍처의 차이를 설명한다
- 서비스 메시(Istio, Linkerd)의 Control/Data Plane을 이해한다
- HPA, VPA, Cluster Autoscaler를 구분한다
- 12-Factor App의 핵심 원칙을 안다

---

## 1. CNCF (Cloud Native Computing Foundation)

### 1.1 CNCF 프로젝트 성숙도 (시험 빈출!)

```
CNCF 프로젝트 성숙도 단계
============================================================

Sandbox (샌드박스) → 초기 실험 단계
  - 개념 증명 수준
  - 프로덕션 사용 권장하지 않음
  - 최소 2명의 TOC 스폰서 필요

     ↓

Incubating (인큐베이팅) → 성장 단계
  - 실제 환경에서 사용되기 시작
  - 활발한 커뮤니티
  - 프로덕션 사용 일부 가능

     ↓

Graduated (졸업) → 성숙 단계
  - 프로덕션 준비 완료
  - 보안 감사(Security Audit) 완료 필수!
  - 대규모 프로덕션 환경에서 검증됨

시험 포인트:
- Graduated 필수 조건 = 보안 감사(Security Audit) 완료
- 순서: Sandbox → Incubating → Graduated
```

### 1.2 주요 CNCF 졸업 프로젝트

| 프로젝트 | 카테고리 | 핵심 한 줄 |
|----------|---------|-----------|
| Kubernetes | 오케스트레이션 | 컨테이너 오케스트레이션 플랫폼 |
| Prometheus | 모니터링 | Pull 기반 메트릭 수집 |
| Envoy | 프록시 | Istio의 사이드카, L7 프록시 |
| CoreDNS | DNS | K8s 기본 DNS 서버 |
| containerd | 런타임 | 고수준 컨테이너 런타임 |
| etcd | 저장소 | 분산 키-값 저장소, Raft |
| Fluentd | 로깅 | 통합 로깅 계층 |
| Fluent Bit | 로깅 | Fluentd 경량 버전 |
| Helm | 패키지 | K8s 패키지 매니저 |
| Harbor | 레지스트리 | 프라이빗 컨테이너 레지스트리 |
| Jaeger | 트레이싱 | 분산 트레이싱 (Uber) |
| Linkerd | 서비스 메시 | 경량 서비스 메시 |
| ArgoCD | CI/CD | GitOps CD |
| Flux | CI/CD | GitOps CD |
| Cilium | 네트워킹 | eBPF 기반 CNI |
| Falco | 보안 | 런타임 보안 모니터링 |
| Istio | 서비스 메시 | 가장 유명한 서비스 메시 |

### 1.3 주요 CNCF 인큐베이팅 프로젝트

| 프로젝트 | 카테고리 |
|----------|---------|
| OpenTelemetry | 관측성 통합 프레임워크 |
| CRI-O | K8s 전용 컨테이너 런타임 |
| Crossplane | K8s 기반 클라우드 인프라 관리 |
| Knative | 서버리스 플랫폼 |

---

## 2. Cloud Native 핵심 개념

### 2.1 Cloud Native 5대 요소

```
Cloud Native 정의 (CNCF)
============================================================

CNCF가 정의하는 Cloud Native의 핵심 요소:

1. 컨테이너 (Containers)
   - 앱과 의존성을 패키징하는 표준 단위

2. 서비스 메시 (Service Mesh)
   - 서비스 간 통신을 관리하는 인프라 계층

3. 마이크로서비스 (Microservices)
   - 독립적으로 배포/확장 가능한 작은 서비스들

4. 불변 인프라 (Immutable Infrastructure)
   - 수정하지 않고 교체하는 인프라 관리 방식

5. 선언적 API (Declarative APIs)
   - "무엇을" 원하는지 선언 (K8s YAML)

핵심: "모놀리식 아키텍처"는 Cloud Native가 아니다!
```

### 2.2 불변 인프라 (Immutable Infrastructure)

```
불변 인프라 원칙
============================================================

전통적 방식 (Mutable):
  서버 설치 → 패치 적용 → 설정 변경 → 업데이트
  문제: 환경 불일치(snowflake server), 재현 불가

불변 인프라 (Immutable):
  이미지 빌드 → 배포 → 변경 필요 시 새 이미지로 교체
  장점: 일관성, 재현 가능, 롤백 용이

예시:
  - 컨테이너 이미지 = 불변
  - kubectl 직접 수정 금지 → YAML 변경 후 apply
  - 서버에 SSH 접속하여 수정 금지
```

---

## 3. 마이크로서비스 vs 모놀리식

### 3.1 비교

```
마이크로서비스 vs 모놀리식 비교
============================================================

모놀리식 아키텍처 (Monolithic):
  +-------------------------------------+
  |         하나의 배포 단위               |
  |  [사용자 모듈] [주문 모듈] [결제 모듈] |
  |  [재고 모듈] [알림 모듈] [인증 모듈]  |
  +-------------------------------------+
  장점: 단일 배포, 간단한 트랜잭션, 낮은 지연
  단점: 전체 배포, 단일 장애점, 전체 스케일링

마이크로서비스 아키텍처 (Microservices):
  [사용자] [주문] [결제] [재고] [알림] [인증]
     ↕       ↕       ↕       ↕       ↕       ↕
  독립 배포 / 독립 확장 / 독립 기술 스택
  장점: 독립 배포, 장애 격리, 서비스별 스케일링
  단점: 분산 복잡성, 네트워크 지연, 분산 트랜잭션
```

### 3.2 12-Factor App

> **12-Factor App**이란?
> 클라우드 환경에 적합한 SaaS(Software as a Service) 앱을 개발하기 위한 방법론이다.

```
12-Factor App 핵심 원칙 (KCNA에서 자주 나오는 것들)
============================================================

1. Codebase: 하나의 코드베이스, 여러 배포
2. Dependencies: 명시적 의존성 선언
3. Config: 설정을 환경 변수로 외부화 (ConfigMap!)
4. Backing Services: 부착된 리소스로 취급 (DB, 캐시)
5. Build, Release, Run: 빌드와 실행을 엄격히 분리
6. Processes: 무상태(Stateless) 프로세스로 실행
7. Port Binding: 포트 바인딩으로 서비스 노출
8. Concurrency: 프로세스 모델로 수평 확장 (HPA!)
9. Disposability: 빠른 시작과 우아한 종료
10. Dev/Prod Parity: 개발/프로덕션 환경 일치
11. Logs: 이벤트 스트림으로 로그 처리 (stdout)
12. Admin Processes: 관리 작업을 일회성 프로세스로 실행
```

---

## 4. 서비스 메시 (Service Mesh)

### 4.1 서비스 메시 개념

> **서비스 메시**란?
> 마이크로서비스 간 **네트워크 통신을 관리, 보호, 관찰**하는 전용 인프라 계층이다. 애플리케이션 코드 변경 없이 트래픽 관리, mTLS 보안, 관측성을 제공한다.

### 4.2 Control Plane vs Data Plane (시험 빈출!)

```
서비스 메시 아키텍처
============================================================

Control Plane (제어부):
  +------------------+
  | istiod (Istio)   |  ← 설정/정책 관리
  | 또는              |     인증서 발급
  | linkerd-control  |     서비스 디스커버리
  +--------+---------+
           |
           | 설정 전파 (xDS API)
           |
Data Plane (데이터부):
  +--------v---------+     +---------+---------+
  | Pod A            |     | Pod B             |
  | +------+ +-----+ |     | +------+ +-----+  |
  | | App  | |Proxy| |<--->| | App  | |Proxy|  |
  | +------+ +-----+ |     | +------+ +-----+  |
  +------------------+     +-------------------+
     사이드카 프록시가          사이드카 프록시가
     모든 트래픽을 가로챔       모든 트래픽을 가로챔

핵심:
  Control Plane = 설정/정책 관리 (두뇌)
  Data Plane = 사이드카 프록시가 트래픽 처리 (실행)
```

### 4.3 Istio vs Linkerd

| 항목 | Istio | Linkerd |
|------|-------|---------|
| **Data Plane** | **Envoy** (CNCF 졸업) | linkerd2-proxy (Rust) |
| **복잡성** | 높음 (기능 풍부) | 낮음 (경량) |
| **리소스** | 더 많은 리소스 | 더 적은 리소스 |
| **기능** | 매우 풍부 | 핵심에 집중 |
| **CNCF** | **졸업** | **졸업** |

**시험 포인트:**
- Istio의 사이드카 프록시 = **Envoy**
- Envoy = CNCF **졸업** 프로젝트
- Control Plane = 설정, Data Plane = 트래픽

---

## 5. 오토스케일링

### 5.1 3가지 오토스케일러

```
K8s 오토스케일링 3종류
============================================================

1. HPA (Horizontal Pod Autoscaler) = Pod 수 조절
   CPU/메모리 사용률 → Pod 수를 늘리거나 줄임
   필수 조건: metrics-server + resources.requests 설정

2. VPA (Vertical Pod Autoscaler) = 리소스 조절
   Pod의 requests/limits를 자동으로 조절
   Pod 재시작이 필요할 수 있음

3. Cluster Autoscaler = 노드 수 조절
   Pending Pod 발생 → 클라우드에 노드 추가
   노드 활용도 낮음 → 노드 제거

핵심:
  HPA = Pod 수 (수평)
  VPA = 리소스 (수직)
  Cluster Autoscaler = 노드 수
```

### 5.2 HPA YAML 예제

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: web-hpa
  namespace: demo
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: web-app
  minReplicas: 2                   # 최소 Pod 수
  maxReplicas: 10                  # 최대 Pod 수
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70     # CPU 70% 초과 시 스케일 아웃
```

### 5.3 서버리스 & Knative

> **서버리스(Serverless)**란?
> 서버 관리 없이 코드만 배포하여 실행하는 컴퓨팅 모델이다. 요청이 없으면 리소스를 0으로 줄일 수 있다.

> **Knative**란?
> K8s 기반 **서버리스 플랫폼**으로, CNCF **인큐베이팅** 프로젝트이다. Scale-to-Zero(요청 없으면 Pod 0개)를 지원한다.

---

## 6. KCNA 실전 모의 문제 (12문제)

### 문제 1.
CNCF 프로젝트의 성숙도 단계를 올바른 순서대로 나열한 것은?

A) Incubating → Sandbox → Graduated
B) Sandbox → Graduated → Incubating
C) Sandbox → Incubating → Graduated
D) Graduated → Incubating → Sandbox

<details><summary>정답 확인</summary>

**정답: C) Sandbox → Incubating → Graduated**

Sandbox(초기) → Incubating(성장) → Graduated(성숙). Graduated는 보안 감사 완료 필수이다.
</details>

---

### 문제 2.
CNCF 프로젝트가 Graduated에 도달하기 위해 반드시 완료해야 하는 것은?

A) 100만 다운로드 달성
B) 보안 감사(Security Audit) 완료
C) 3년 이상 운영
D) 5개 이상 클라우드 제공업체 지원

<details><summary>정답 확인</summary>

**정답: B) 보안 감사(Security Audit) 완료**

CNCF Graduated 프로젝트가 되려면 독립적인 보안 감사를 통과해야 한다.
</details>

---

### 문제 3.
Cloud Native의 핵심 개념에 해당하지 않는 것은?

A) 컨테이너
B) 마이크로서비스
C) 모놀리식 아키텍처
D) 선언적 API

<details><summary>정답 확인</summary>

**정답: C) 모놀리식 아키텍처**

Cloud Native 핵심: 컨테이너, 서비스 메시, 마이크로서비스, 불변 인프라, 선언적 API. 모놀리식은 Cloud Native와 대비되는 전통적 아키텍처이다.
</details>

---

### 문제 4.
Istio 서비스 메시에서 사이드카 프록시로 사용되는 것은?

A) HAProxy
B) NGINX
C) Envoy
D) Traefik

<details><summary>정답 확인</summary>

**정답: C) Envoy**

Istio는 **Envoy**를 사이드카 프록시(Data Plane)로 사용한다. Envoy는 CNCF 졸업 프로젝트이다.
</details>

---

### 문제 5.
VPA(Vertical Pod Autoscaler)가 조정하는 것은?

A) Pod의 수
B) Pod의 리소스 requests와 limits
C) 노드의 수
D) Service의 엔드포인트 수

<details><summary>정답 확인</summary>

**정답: B) Pod의 리소스 requests와 limits**

HPA = Pod 수, VPA = 리소스, Cluster Autoscaler = 노드 수.
</details>

---

### 문제 6.
불변 인프라(Immutable Infrastructure)의 핵심 원칙은?

A) SSH로 서버에 접속하여 직접 수정한다
B) 변경이 필요하면 새로 빌드하여 교체한다
C) 설정 파일을 수동으로 편집한다
D) 운영 중인 서버에 패치를 적용한다

<details><summary>정답 확인</summary>

**정답: B) 변경이 필요하면 새로 빌드하여 교체한다**

불변 인프라는 배포된 인프라를 수정하지 않고 새로 빌드하여 교체하는 원칙이다.
</details>

---

### 문제 7.
HPA(Horizontal Pod Autoscaler)가 동작하기 위해 반드시 필요한 것은?

A) Ingress Controller와 NetworkPolicy
B) metrics-server와 Pod의 resources.requests 설정
C) VPA와 Cluster Autoscaler
D) Prometheus와 Grafana

<details><summary>정답 확인</summary>

**정답: B) metrics-server와 Pod의 resources.requests 설정**

HPA 필수: (1) metrics-server 설치 (2) Pod에 resources.requests 설정.
</details>

---

### 문제 8.
서비스 메시에서 Control Plane과 Data Plane의 역할로 올바른 것은?

A) Control Plane이 트래픽을 직접 처리한다
B) Control Plane이 설정/정책을 관리하고, Data Plane(사이드카 프록시)이 트래픽을 처리한다
C) 둘 다 트래픽을 처리한다
D) 둘 다 설정만 관리한다

<details><summary>정답 확인</summary>

**정답: B) Control Plane이 설정/정책을 관리하고, Data Plane(사이드카 프록시)이 트래픽을 처리한다**

Control Plane = 설정, Data Plane = 트래픽 처리.
</details>

---

### 문제 9.
마이크로서비스 아키텍처의 단점이 아닌 것은?

A) 분산 트랜잭션 복잡성
B) 네트워크 지연
C) 독립적인 배포
D) 서비스 디스커버리 필요

<details><summary>정답 확인</summary>

**정답: C) 독립적인 배포**

독립적인 배포는 마이크로서비스의 **장점**이다. 분산 트랜잭션, 네트워크 지연, 서비스 디스커버리 필요성은 단점이다.
</details>

---

### 문제 10.
12-Factor App에서 설정(Config)을 관리하는 올바른 방법은?

A) 소스 코드에 하드코딩한다
B) 환경 변수로 외부화한다
C) 컨테이너 이미지에 포함한다
D) 데이터베이스에 저장한다

<details><summary>정답 확인</summary>

**정답: B) 환경 변수로 외부화한다**

12-Factor App의 Config 원칙: 설정은 코드와 분리하여 환경 변수로 관리한다. K8s의 ConfigMap이 이 원칙을 구현한다.
</details>

---

### 문제 11.
Knative에 대한 설명으로 올바른 것은?

A) 컨테이너 런타임이다
B) K8s 기반 서버리스 플랫폼으로, Scale-to-Zero를 지원한다
C) 분산 데이터베이스이다
D) CI 도구이다

<details><summary>정답 확인</summary>

**정답: B) K8s 기반 서버리스 플랫폼으로, Scale-to-Zero를 지원한다**

Knative는 CNCF 인큐베이팅 프로젝트이며 서버리스 워크로드를 K8s에서 실행한다.
</details>

---

### 문제 12.
Falco에 대한 설명으로 올바른 것은?

A) 컨테이너 네트워크 플러그인이다
B) CNCF 졸업 프로젝트인 런타임 보안 모니터링 도구이다
C) K8s 패키지 매니저이다
D) 서비스 메시 도구이다

<details><summary>정답 확인</summary>

**정답: B) CNCF 졸업 프로젝트인 런타임 보안 모니터링 도구이다**

Falco는 컨테이너 런타임에서 비정상적인 활동(셸 접속, 파일 변경 등)을 실시간으로 감지하는 보안 도구이다.
</details>

---

## tart-infra 실습

### 실습 환경 설정

```bash
# dev 클러스터 접속 (서비스 메시, 오토스케일링 확인용)
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/dev.yaml

# 클러스터 상태 확인
kubectl get nodes
```

### 실습 1: CNCF 졸업 프로젝트 확인

tart-infra에 설치된 CNCF 프로젝트들의 성숙도 단계를 직접 확인한다.

```bash
# platform 클러스터의 CNCF 프로젝트 확인
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/platform.yaml

# Prometheus (Graduated) - 모니터링
kubectl get pods -n monitoring -l app.kubernetes.io/name=prometheus

# Grafana (Graduated가 아님, 주의!) - 대시보드
kubectl get svc -n monitoring | grep grafana
# → Grafana는 CNCF 프로젝트가 아닌 독립 오픈소스 (시험 주의!)

# ArgoCD (Graduated) - GitOps CD
kubectl get pods -n argocd

# dev 클러스터의 CNCF 프로젝트 확인
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/dev.yaml

# Cilium (Graduated) - CNI/서비스 메시
kubectl get pods -n kube-system -l k8s-app=cilium

# Istio (Graduated) - 서비스 메시
kubectl get pods -n istio-system
```

**동작 원리:** CNCF Graduated 프로젝트는 보안 감사를 완료하고 대규모 프로덕션에서 검증된 프로젝트이다. tart-infra에서 사용 중인 Prometheus, ArgoCD, Cilium, Istio 모두 Graduated 단계이다.

### 실습 2: 서비스 메시(Istio) Control Plane / Data Plane 확인

```bash
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/dev.yaml

# Control Plane: istiod (Pilot+Citadel+Galley 통합)
kubectl get pods -n istio-system -l app=istiod

# Data Plane: Envoy sidecar 주입 확인
kubectl get pods -n demo -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{range .spec.containers[*]}{.name}{" "}{end}{"\n"}{end}'

# 예상 출력 (sidecar 주입된 경우):
# nginx-xxx    nginx istio-proxy
# httpbin-xxx  httpbin istio-proxy
```

**동작 원리:** 서비스 메시는 Control Plane(istiod: 설정 배포, 인증서 관리)과 Data Plane(Envoy 사이드카: 실제 트래픽 처리)으로 구성된다. 각 Pod에 istio-proxy(Envoy) 컨테이너가 자동 주입되어 트래픽 관리, mTLS, 관측성을 앱 코드 수정 없이 제공한다.

### 실습 3: HPA(Horizontal Pod Autoscaler) 확인

```bash
# HPA 상태 확인
kubectl get hpa -n demo

# 예상 출력:
# NAME    REFERENCE          TARGETS   MINPODS   MAXPODS   REPLICAS   AGE
# nginx   Deployment/nginx   10%/80%   1         5         1          7d

# metrics-server 동작 확인 (HPA 필수 조건!)
kubectl top pods -n demo
kubectl top nodes
```

**동작 원리:** HPA는 metrics-server로부터 CPU/메모리 사용률을 수집하여 Pod 수를 자동 조절한다. `resources.requests`가 설정되어 있어야 사용률(%)을 계산할 수 있다. HPA = Pod 수 조절, VPA = Pod 리소스 조절, Cluster Autoscaler = 노드 수 조절이다.

---

## 복습 체크리스트

- [ ] CNCF 성숙도: Sandbox → Incubating → Graduated
- [ ] Graduated 조건: 보안 감사(Security Audit) 완료
- [ ] Cloud Native 5요소: 컨테이너, 서비스 메시, 마이크로서비스, 불변 인프라, 선언적 API
- [ ] 마이크로서비스 장점: 독립 배포, 장애 격리, 서비스별 스케일링
- [ ] 마이크로서비스 단점: 분산 복잡성, 네트워크 지연, 분산 트랜잭션
- [ ] 서비스 메시: Control Plane(설정) + Data Plane(트래픽)
- [ ] Istio = Envoy(프록시), Linkerd = linkerd2-proxy(Rust), 둘 다 졸업
- [ ] HPA = Pod 수, VPA = 리소스, Cluster Autoscaler = 노드 수
- [ ] HPA 필수: metrics-server + resources.requests
- [ ] 12-Factor App: 설정 외부화, 무상태, 개발=프로덕션 일치
- [ ] Knative = Scale-to-Zero 서버리스 (CNCF 인큐베이팅)
- [ ] 불변 인프라 = 수정 대신 교체

---

## 내일 학습 예고

> Day 7에서는 Cloud Native Observability를 학습한다. 관측성의 3대 축(Metrics, Logs, Traces)과 Prometheus, Grafana, Loki, Jaeger, OpenTelemetry를 다룬다.
