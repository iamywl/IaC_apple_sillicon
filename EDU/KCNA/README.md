# KCNA (Kubernetes and Cloud Native Associate) 자격증 가이드

## 시험 개요

KCNA(Kubernetes and Cloud Native Associate)는 CNCF(Cloud Native Computing Foundation)와 The Linux Foundation이 공동으로 제공하는 입문 수준의 자격증이다. Kubernetes 및 클라우드 네이티브 생태계에 대한 기초 지식을 검증하는 시험으로, CKA(Certified Kubernetes Administrator)나 CKAD(Certified Kubernetes Application Developer)를 준비하기 전 단계로 적합하다.

| 항목 | 내용 |
|------|------|
| **주관** | CNCF / The Linux Foundation |
| **시험 형식** | 온라인 프록터링(감독) 방식, 객관식(Multiple Choice) |
| **문항 수** | 60문항 |
| **시험 시간** | 90분 |
| **합격 기준** | 75% 이상 (60문항 중 45문항 이상 정답) |
| **시험 언어** | 영어, 일본어, 중국어(간체) |
| **시험 비용** | USD $250 (1회 재시험 포함) |
| **유효 기간** | 3년 |
| **시험 환경** | 웹 브라우저 기반, PSI 플랫폼 사용 |
| **오픈북 여부** | 아니오 (오픈북이 아니다) |

## 합격 기준

- 총 60문항 중 **75% 이상**(45문항 이상)을 맞혀야 합격이다.
- 시험 결과는 시험 종료 후 **24시간 이내**에 이메일로 통보된다.
- 불합격 시 **1회 무료 재시험** 기회가 제공된다(시험 구매 후 12개월 이내 사용 가능).
- 합격 후 자격증은 **3년간 유효**하며, 갱신을 위해서는 재시험에 응시해야 한다.

## 시험 범위

KCNA 시험은 Kubernetes와 클라우드 네이티브 기술 전반에 대한 **개념적 이해**를 평가한다. 실습 기반 시험이 아니라 이론 중심의 객관식 시험이다. 다음과 같은 영역을 다룬다.

- Kubernetes의 핵심 아키텍처와 구성 요소
- 컨테이너 오케스트레이션의 기본 원리
- 클라우드 네이티브 아키텍처의 설계 원칙
- 관측 가능성(Observability)의 개념과 도구
- 클라우드 네이티브 애플리케이션 배포 방법론

## 도메인별 출제 비율

KCNA 시험은 5개 도메인으로 구성되며, 각 도메인의 출제 비율은 다음과 같다.

| 도메인 | 출제 비율 | 예상 문항 수 | 주요 내용 |
|--------|-----------|-------------|-----------|
| **Kubernetes Fundamentals** | 46% | 약 28문항 | K8s 아키텍처, 리소스, API, kubectl |
| **Container Orchestration** | 22% | 약 13문항 | 컨테이너 런타임, 이미지, 스케줄링 |
| **Cloud Native Architecture** | 16% | 약 10문항 | CNCF, 마이크로서비스, 서버리스, 서비스 메시 |
| **Cloud Native Observability** | 8% | 약 5문항 | 모니터링, 로깅, 트레이싱 |
| **Cloud Native Application Delivery** | 8% | 약 5문항 | GitOps, CI/CD, Helm, Kustomize |

### 도메인별 상세 키워드

#### 1. Kubernetes Fundamentals (46%)
- Kubernetes 아키텍처: Control Plane(API Server, etcd, Scheduler, Controller Manager), Worker Node(kubelet, kube-proxy, Container Runtime)
- 핵심 리소스: Pod, Deployment, ReplicaSet, Service, DaemonSet, StatefulSet, Job, CronJob
- 설정 및 스토리지: ConfigMap, Secret, Volume, PersistentVolume(PV), PersistentVolumeClaim(PVC), StorageClass
- 네트워킹: ClusterIP, NodePort, LoadBalancer, Ingress, NetworkPolicy, DNS
- 관리 도구: kubectl 명령어, kubeconfig, RBAC

#### 2. Container Orchestration (22%)
- 컨테이너 기초: OCI(Open Container Initiative), 컨테이너 이미지, 레이어 구조
- 컨테이너 런타임: CRI(Container Runtime Interface), containerd, CRI-O, runc
- 오케스트레이션: 스케줄링, 자동 복구(Self-healing), 서비스 디스커버리, 로드 밸런싱
- 이미지 관리: Dockerfile, 이미지 레지스트리, 이미지 보안 스캐닝

#### 3. Cloud Native Architecture (16%)
- CNCF 생태계: CNCF 소개, CNCF Landscape, Graduated/Incubating/Sandbox 프로젝트
- 아키텍처 패턴: 마이크로서비스, 모놀리식 vs 마이크로서비스, 12-Factor App
- 서버리스: Knative, FaaS(Function as a Service)
- 서비스 메시: Istio, Linkerd, Envoy Proxy
- 오토스케일링: HPA(Horizontal Pod Autoscaler), VPA(Vertical Pod Autoscaler), Cluster Autoscaler

#### 4. Cloud Native Observability (8%)
- 모니터링: Prometheus, Grafana, 메트릭 수집, AlertManager
- 로깅: Fluentd, Fluent Bit, Loki, EFK/ELK 스택
- 트레이싱: Jaeger, OpenTelemetry, 분산 트레이싱 개념
- 관측 가능성의 세 기둥(Three Pillars): 메트릭, 로그, 트레이스

#### 5. Cloud Native Application Delivery (8%)
- GitOps: ArgoCD, Flux, GitOps 원칙
- CI/CD: 지속적 통합(CI), 지속적 배포/전달(CD), 파이프라인 구성
- 패키지 관리: Helm(Chart, Repository, Release), Kustomize
- 배포 전략: Rolling Update, Blue-Green, Canary

## 학습 권장 순서

1. **01-concepts.md** - 도메인별 핵심 개념 정리
2. **02-examples.md** - 실전 YAML 예제 및 kubectl 명령어
3. **03-exam-questions.md** - 모의 시험 문제 40문항 (5개 도메인 비율 반영)
4. **04-tart-infra-practice.md** - tart-infra 환경 활용 실습 가이드

## 시험 준비 팁

- KCNA는 **개념 이해** 중심의 시험이다. 실습 능력보다는 각 기술의 역할과 관계를 정확히 이해하는 것이 중요하다.
- **Kubernetes Fundamentals** 도메인이 46%를 차지하므로, 이 영역에 가장 많은 시간을 투자해야 한다.
- CNCF 공식 프로젝트들의 **이름과 역할**을 정확히 구분할 수 있어야 한다 (예: Prometheus는 모니터링, Fluentd는 로깅, Jaeger는 트레이싱).
- **컨테이너 런타임의 계층 구조**(CRI -> containerd -> runc)를 명확히 이해해야 한다.
- GitOps의 핵심 원칙(선언적 설정, Git을 Single Source of Truth로 사용, 자동 동기화)을 숙지해야 한다.
- Kubernetes 공식 문서(https://kubernetes.io/docs/)를 참고하여 학습하는 것을 권장한다.
