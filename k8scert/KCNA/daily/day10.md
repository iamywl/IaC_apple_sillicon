# KCNA Day 10: 최종 정리 & 시험 전략

## 학습 목표

- 5개 도메인 핵심 암기 카드로 빠른 복습 완료
- CNCF Graduated / Incubating 프로젝트 마스터 리스트 확인
- 시험 당일 전략(시간 관리, 문제 풀이 기법) 숙지
- 최종 20문 빠른 점검으로 약점 확인
- 시험 환경 체크리스트 준비

---

## 0. 등장 배경

KCNA 시험은 CKA/CKAD/CKS 같은 실습 기반 시험과 달리 개념 이해를 평가하는 객관식 시험이다. Cloud Native 생태계가 급격히 확장되면서, Kubernetes 뿐만 아니라 CNCF 프로젝트 분류, 관측성 아키텍처, GitOps 원칙, 컨테이너 런타임 표준 등 넓은 범위의 지식이 요구된다. 이 시험은 "실무에서 Kubernetes를 운영할 수 있는가?"보다 "Cloud Native 전체 맥락에서 각 기술의 역할과 관계를 이해하는가?"를 측정한다. 따라서 개별 도구의 사용법보다 아키텍처 원칙(선언적, Reconciliation, Hub-and-Spoke, Pull 기반)과 CNCF 생태계 분류를 정확히 파악하는 것이 합격의 핵심이다.

---

## 1. 도메인별 핵심 암기 카드

### 1-1. Kubernetes Fundamentals (46 %)

| # | 항목 | 암기 포인트 |
|---|------|------------|
| 1 | Control Plane 구성 | API Server, etcd, Scheduler, Controller Manager |
| 2 | API Server 역할 | 유일한 etcd 접근 컴포넌트, 인증/인가/Admission Control |
| 3 | etcd 특성 | key-value store, Raft 합의, --snapshot-count로 스냅샷 |
| 4 | Scheduler 프로세스 | Filtering → Scoring → Binding |
| 5 | Controller Manager | Desired State ↔ Current State 루프 (Reconciliation) |
| 6 | kubelet | Node 에이전트, Pod spec 수신 → Container Runtime 호출 |
| 7 | kube-proxy | Service → Endpoint 매핑, iptables / IPVS 모드 |
| 8 | Pod 특성 | 최소 배포 단위, 같은 Network Namespace 공유 |
| 9 | Deployment | ReplicaSet 관리, Rolling Update / Rollback |
| 10 | Service 타입 | ClusterIP(내부) → NodePort(외부) → LoadBalancer(클라우드) |
| 11 | DaemonSet | 모든(또는 선택) 노드에 정확히 1개 Pod |
| 12 | StatefulSet | 고정 이름(pod-0), 순차 시작/종료, headless Service 필요 |
| 13 | ConfigMap vs Secret | ConfigMap=평문, Secret=base64(암호화 아님) |
| 14 | Namespace 기본 4개 | default, kube-system, kube-public, kube-node-lease |
| 15 | RBAC 4대 리소스 | Role, ClusterRole, RoleBinding, ClusterRoleBinding |
| 16 | Ingress | L7 라우팅, Ingress Controller 별도 설치 필요 |
| 17 | PV 회수 정책 | Retain(보존), Delete(삭제), Recycle(deprecated) |
| 18 | StorageClass | Dynamic Provisioning, volumeBindingMode: WaitForFirstConsumer |
| 19 | Label vs Annotation | Label=선택용(selector), Annotation=메타데이터 저장 |
| 20 | Job vs CronJob | Job=1회 배치, CronJob=스케줄 반복 |

### 1-2. Container Orchestration (22 %)

| # | 항목 | 암기 포인트 |
|---|------|------------|
| 1 | Container vs VM | Container: OS 커널 공유, 프로세스 격리 / VM: 하이퍼바이저, 전체 OS |
| 2 | Linux Namespace | PID, NET, MNT, UTS, IPC, USER → 격리 담당 |
| 3 | Linux cgroups | CPU, Memory, I/O 등 자원 제한 담당 |
| 4 | OCI 3대 Spec | Runtime Spec, Image Spec, Distribution Spec |
| 5 | CRI | Container Runtime Interface - kubelet ↔ Runtime 통신 |
| 6 | CNI | Container Network Interface - Pod 네트워크 플러그인 |
| 7 | CSI | Container Storage Interface - 스토리지 플러그인 |
| 8 | Dockerfile CMD vs ENTRYPOINT | ENTRYPOINT=고정 명령, CMD=기본 인자(덮어쓰기 가능) |
| 9 | Multi-stage Build | 빌드 환경과 실행 환경 분리 → 이미지 크기 감소 |
| 10 | Tag vs Digest | Tag=mutable(latest 변경 가능), Digest(sha256)=immutable |
| 11 | Container Registry | Harbor(private), Docker Hub(public), ECR/GCR/ACR |
| 12 | CoreDNS | K8s 기본 DNS, Service 이름 → ClusterIP 해석 |

### 1-3. Cloud Native Architecture (16 %)

| # | 항목 | 암기 포인트 |
|---|------|------------|
| 1 | CNCF 성숙도 | Sandbox → Incubating → Graduated |
| 2 | Graduated 조건 | 프로덕션 검증, 보안 감사, 거버넌스 완비 |
| 3 | Cloud Native 5요소 | 컨테이너화, 동적 오케스트레이션, 마이크로서비스, 선언적 API, 자동화 |
| 4 | Immutable Infra | 서버 수정 X → 새 이미지로 교체 (Pets vs Cattle) |
| 5 | Microservices 장점 | 독립 배포, 기술 이기종, 장애 격리 |
| 6 | Microservices 단점 | 네트워크 복잡성, 분산 트랜잭션, 디버깅 어려움 |
| 7 | 12-Factor App | 코드베이스, 의존성, 설정, 백엔드 서비스 등 12개 원칙 |
| 8 | Service Mesh 구조 | Data Plane(sidecar proxy) + Control Plane |
| 9 | Istio vs Linkerd | Istio=Envoy 기반/기능 풍부, Linkerd=경량/Rust proxy |
| 10 | HPA | CPU/Memory 기반 Pod 수 자동 조절 |
| 11 | VPA | Pod 리소스 request/limit 자동 조절 |
| 12 | Cluster Autoscaler | 노드 수 자동 조절 (Pending Pod 발생 시 확장) |

### 1-4. Cloud Native Observability (8 %)

| # | 항목 | 암기 포인트 |
|---|------|------------|
| 1 | 3 Pillars | Metrics(수치), Logs(이벤트), Traces(요청 흐름) |
| 2 | Prometheus 방식 | Pull-based scraping, /metrics 엔드포인트 |
| 3 | Metric 4타입 | Counter(증가), Gauge(변동), Histogram(분포), Summary(분위수) |
| 4 | PromQL 핵심 | rate(), increase(), histogram_quantile() |
| 5 | Grafana 역할 | 시각화 대시보드, 다중 데이터소스 지원 |
| 6 | Loki 특징 | 로그 내용 인덱싱 안함, Label만 인덱싱 → 저비용 |
| 7 | Jaeger / Zipkin | 분산 트레이싱 도구, Span → Trace 구성 |
| 8 | OpenTelemetry | 벤더 중립 관측 프레임워크, Metrics+Logs+Traces 통합 |
| 9 | Fluentd vs Fluent Bit | Fluentd=풍부한 플러그인, Fluent Bit=경량/엣지 |
| 10 | ResourceQuota | Namespace 단위 총 리소스 제한 |
| 11 | LimitRange | Pod/Container 단위 기본값 및 최대/최소 설정 |

### 1-5. Application Delivery (8 %)

| # | 항목 | 암기 포인트 |
|---|------|------------|
| 1 | GitOps 4원칙 | 선언적, 버전 관리, 자동 적용, 지속적 조정(Reconciliation) |
| 2 | ArgoCD | Pull 모델, Web UI, ApplicationSet, K8s CRD 기반 |
| 3 | Flux | Pull 모델, CLI 중심, Kustomize Controller 내장 |
| 4 | CI vs CD | CI=빌드+테스트 자동화, CD=배포 자동화 |
| 5 | Rolling Update | 점진적 교체, maxSurge/maxUnavailable |
| 6 | Blue-Green | 두 환경 전환, 즉시 롤백 가능, 2배 리소스 |
| 7 | Canary | 소수 트래픽 먼저 전환, 검증 후 전체 적용 |
| 8 | Helm 3요소 | Chart(패키지), Release(인스턴스), Repository(저장소) |
| 9 | Helm v3 변경 | Tiller 제거 → 클라이언트만으로 동작 |
| 10 | Kustomize | base + overlay 구조, 패치 기반 커스터마이징 |
| 11 | IaC 도구 | Terraform(HCL), Crossplane(K8s CRD 기반) |

---

## 2. CNCF 프로젝트 마스터 리스트

### 2-1. Graduated 프로젝트 (시험 빈출)

| 카테고리 | 프로젝트 | 한줄 설명 |
|----------|---------|-----------|
| 오케스트레이션 | **Kubernetes** | 컨테이너 오케스트레이션 표준 |
| 컨테이너 런타임 | **containerd** | 산업 표준 컨테이너 런타임 |
| 모니터링 | **Prometheus** | Pull 기반 메트릭 수집 및 알림 |
| 시각화 | **Grafana** (참조) | 다중 데이터소스 대시보드 (CNCF 외부이나 시험 출제) |
| 서비스 메시 | **Linkerd** | 경량 서비스 메시 |
| 서비스 프록시 | **Envoy** | L4/L7 고성능 프록시 |
| 네트워크 | **Cilium** | eBPF 기반 네트워킹/보안/관측 |
| CI/CD | **Argo** | GitOps CD, Workflows, Events, Rollouts |
| CI/CD | **Flux** | GitOps 지속적 배포 도구 |
| 패키지 관리 | **Helm** | K8s 패키지 매니저 |
| 로깅 | **Fluentd** | 통합 로그 수집기 |
| 트레이싱 | **Jaeger** | 분산 트레이싱 시스템 |
| 관측 | **OpenTelemetry** | 벤더 중립 관측 프레임워크 |
| 보안 | **Falco** | 런타임 보안 위협 탐지 |
| 보안 | **OPA** | 범용 정책 엔진 (Rego 언어) |
| 보안 | **TUF** | 소프트웨어 업데이트 보안 프레임워크 |
| 레지스트리 | **Harbor** | 엔터프라이즈 컨테이너 레지스트리 |
| 스토리지 | **Rook** | K8s 스토리지 오케스트레이션 (Ceph) |
| 스토리지 | **Longhorn** | 경량 분산 블록 스토리지 |
| DNS | **CoreDNS** | K8s 기본 DNS 서버 |
| API Gateway | **Emissary-ingress** | K8s 네이티브 API Gateway |
| Key/Value | **etcd** | 분산 key-value 저장소 |
| 스케줄링 | **Volcano** | 배치 작업 스케줄러 |
| 빌드 | **Buildpacks** | 소스코드 → OCI 이미지 자동 빌드 |

### 2-2. 주요 Incubating 프로젝트

| 카테고리 | 프로젝트 | 한줄 설명 |
|----------|---------|-----------|
| 서비스 메시 | **Istio** | Envoy 기반 서비스 메시 |
| 네트워크 | **Calico** (참조) | BGP 기반 네트워크 정책 (CNCF 외) |
| 보안 | **cert-manager** | X.509 인증서 자동 관리 |
| 보안 | **Kyverno** | K8s 네이티브 정책 엔진 |
| 런타임 | **CRI-O** | K8s 전용 경량 컨테이너 런타임 |
| Serverless | **Knative** | K8s 서버리스 프레임워크 |
| 관측 | **Thanos** | Prometheus 장기 저장 / 고가용성 |
| 관측 | **Cortex** | 멀티테넌트 Prometheus |
| GitOps | **Backstage** | 개발자 포털 / 서비스 카탈로그 |
| 빌드 | **Tekton** | K8s 네이티브 CI/CD 파이프라인 |

> **시험 팁:** Graduated 프로젝트 이름과 카테고리를 정확히 매칭할 수 있어야 한다. "다음 중 CNCF Graduated 프로젝트는?" 형태 빈출.

---

## 3. 시험 당일 전략

### 3-1. 시험 개요 재확인

| 항목 | 내용 |
|------|------|
| 시험 코드 | KCNA (Kubernetes and Cloud Native Associate) |
| 문항 수 | 60문항 (객관식 + 일부 복수선택) |
| 시간 | 90분 |
| 합격 점수 | 75% (45/60) |
| 시험 방식 | 온라인 감독 (PSI) |
| 유효 기간 | 3년 |
| 재시험 | 1회 무료 재응시 포함 |

### 3-2. 시간 관리 전략

```
총 90분 / 60문항 = 문항당 약 1.5분

[Phase 1] 빠른 1차 풀이 (50분)
├── 확실한 문제 → 즉시 답 선택 (30초 이내)
├── 애매한 문제 → 최선 답 선택 + Flag 표시
└── 모르는 문제 → 아무 답이나 선택 + Flag 표시

[Phase 2] Flag 문제 재검토 (25분)
├── Flag 문제 순서대로 재확인
├── 2개로 좁혀진 문제 → 신중하게 선택
└── 완전 모르는 문제 → 소거법 적용

[Phase 3] 최종 점검 (15분)
├── 전체 답안 누락 확인
├── 복수선택 문항 개수 확인
└── 변경 시 확실한 근거가 있을 때만
```

### 3-3. 문제 풀이 기법

**소거법 우선 전략:**

```
4지선다 기준:
- 명백한 오답 1개 제거 → 33% 확률
- 명백한 오답 2개 제거 → 50% 확률
- 3개 제거 → 정답
```

**키워드 매칭 전략:**

| 문제 키워드 | 정답 방향 |
|-------------|-----------|
| "Pull-based monitoring" | Prometheus |
| "sidecar proxy" | Service Mesh (Istio, Linkerd) |
| "desired state" | Controller, Reconciliation |
| "eBPF" | Cilium, Falco |
| "immutable" | Container image digest, Immutable Infrastructure |
| "declarative" | YAML manifest, GitOps |
| "vendor-neutral observability" | OpenTelemetry |
| "lightweight runtime" | containerd, CRI-O |
| "policy engine" | OPA (Rego), Kyverno |
| "runtime security" | Falco |
| "certificate management" | cert-manager |
| "package manager" | Helm |
| "overlay customization" | Kustomize |
| "graduated project" | 목록 암기 필수 |

**오답 함정 패턴:**

| 함정 유형 | 예시 | 올바른 판단 |
|-----------|------|-------------|
| 비슷한 이름 | "Prometheus는 Push 방식이다" | X - Pull 방식 |
| 범위 혼동 | "Role은 클러스터 전체에 적용된다" | X - Namespace 범위 (ClusterRole이 전체) |
| 버전 혼동 | "Helm v3는 Tiller를 사용한다" | X - v2에서 사용, v3에서 제거 |
| 기능 뒤바꿈 | "Namespace는 자원을 제한한다" | X - ResourceQuota가 제한 (Namespace는 격리) |
| 과장 표현 | "Secret은 데이터를 암호화한다" | X - base64 인코딩일 뿐 (EncryptionConfiguration 별도) |
| 절대적 표현 | "항상", "반드시", "유일하게" | 주의 - 대부분 오답 |

### 3-4. 도메인별 출제 비중 & 목표

```
도메인                    비중    문항수(추정)  목표정답
─────────────────────────────────────────────────
Kubernetes Fundamentals   46%     ~28문항      24개 이상
Container Orchestration   22%     ~13문항      10개 이상
Cloud Native Architecture 16%     ~10문항       8개 이상
Cloud Native Observability 8%      ~5문항       4개 이상
Application Delivery       8%      ~4문항       3개 이상
─────────────────────────────────────────────────
합계                     100%      60문항      49개 (82%)
```

> 합격선 75%(45개)보다 여유 있게 49개(82%)를 목표로 한다.

---

## 4. 최종 20문 빠른 점검

아래 문제를 3초 이내에 답할 수 있으면 해당 개념은 충분히 암기된 것이다.

| # | 질문 | 정답 |
|---|------|------|
| 1 | etcd에 직접 접근하는 유일한 컴포넌트는? | API Server |
| 2 | Scheduler의 3단계 프로세스는? | Filtering → Scoring → Binding |
| 3 | kube-proxy의 두 가지 모드는? | iptables, IPVS |
| 4 | StatefulSet에 필요한 Service 타입은? | Headless Service (clusterIP: None) |
| 5 | Secret의 인코딩 방식은? | base64 (암호화 아님) |
| 6 | 기본 Namespace 4개를 나열하라 | default, kube-system, kube-public, kube-node-lease |
| 7 | ClusterRole과 Role의 차이는? | ClusterRole=클러스터 범위, Role=Namespace 범위 |
| 8 | PV 회수 정책 3가지는? | Retain, Delete, Recycle(deprecated) |
| 9 | Container 격리를 담당하는 Linux 기술은? | Namespace(격리) + cgroups(자원제한) |
| 10 | OCI 3대 스펙은? | Runtime Spec, Image Spec, Distribution Spec |
| 11 | CRI / CNI / CSI 각각 무엇의 약자? | Container Runtime / Network / Storage Interface |
| 12 | CNCF 프로젝트 성숙도 3단계는? | Sandbox → Incubating → Graduated |
| 13 | Prometheus의 메트릭 수집 방식은? | Pull-based (HTTP scraping) |
| 14 | Observability 3 Pillars는? | Metrics, Logs, Traces |
| 15 | OpenTelemetry의 핵심 특징은? | 벤더 중립 관측 프레임워크 (Metrics+Logs+Traces) |
| 16 | GitOps의 Single Source of Truth는? | Git Repository |
| 17 | Helm v3에서 제거된 서버 측 컴포넌트는? | Tiller |
| 18 | Kustomize의 구조 패턴은? | base + overlay |
| 19 | Blue-Green 배포의 단점은? | 2배 리소스 필요 |
| 20 | Canary 배포의 핵심 원리는? | 소수 트래픽으로 먼저 검증 후 전체 적용 |

**자가 채점:**
- 18-20개 정답: 시험 준비 완료
- 15-17개 정답: 틀린 영역 Day 자료 재학습
- 15개 미만: 해당 도메인 처음부터 재학습

---

## 5. 시험 환경 체크리스트

### 5-1. 시험 전날

```
[ ] PSI 계정 로그인 확인 및 시험 예약 재확인
[ ] 시스템 요구사항 확인 (PSI Secure Browser 설치)
    - Windows 10+ 또는 macOS 12+
    - 웹캠, 마이크 필수
    - 안정적 인터넷 연결 (최소 1 Mbps)
[ ] 여권 또는 정부 발행 영문 신분증 준비
    - 이름이 시험 등록 이름과 정확히 일치해야 함
[ ] 조용한 시험 공간 확보
    - 책상 위 정리 (모니터, 키보드, 마우스만)
    - 문 닫기 가능한 개인 공간
[ ] PSI 호환성 테스트 실행
    - https://syscheck.bridge.psiexams.com/
[ ] 충전기 연결 확인 (노트북 사용 시)
```

### 5-2. 시험 당일

```
[ ] 시험 시작 30분 전 PSI Secure Browser 실행
[ ] 신분증 웹캠으로 촬영
[ ] 방 360도 촬영 (감독관 요청 시)
[ ] 책상 위/아래 촬영
[ ] 감독관 채팅 연결 확인
[ ] 시험 시작 후 바로 문제 풀기 (튜토리얼은 빠르게 넘기기)
```

### 5-3. 주의사항

```
[ ] 시험 중 금지 행위:
    - 입으로 문제 읽기 (lip movement 감지)
    - 시선 이동 과다 (화면 밖 응시)
    - 다른 앱/탭 열기 (PSI Browser가 차단)
    - 메모 작성 (외부 메모 금지, 시험 내 메모 기능 없음)
    - 이어폰/헤드폰 착용
[ ] 문제 수 확인: 60문항 모두 답안 선택했는지 최종 확인
[ ] 복수선택 문항: "Select TWO" 등 지시문 주의
```

---

## 6. 도메인별 최다빈출 키워드 정리

### 6-1. Fundamentals 최다빈출

```
1. API Server        → 모든 통신의 중심, 유일한 etcd 접근점
2. etcd              → Raft 합의, 클러스터 상태 저장
3. Pod               → 최소 단위, sidecar 패턴
4. Deployment        → ReplicaSet 관리, rollout/rollback
5. Service           → ClusterIP < NodePort < LoadBalancer
6. RBAC              → 최소 권한 원칙, ServiceAccount
7. ConfigMap/Secret  → 설정 분리, Secret≠암호화
8. PV/PVC            → StorageClass, Dynamic Provisioning
9. Namespace         → 리소스 격리(제한 아님), 4개 기본
10. Ingress          → L7 라우팅, Controller 필수
```

### 6-2. Orchestration 최다빈출

```
1. Container vs VM   → 커널 공유 vs 하이퍼바이저
2. OCI               → 3대 Spec (Runtime, Image, Distribution)
3. CRI/CNI/CSI       → 플러그인 인터페이스 삼총사
4. containerd        → 산업 표준 런타임 (Graduated)
5. Image Layers      → Union filesystem, 읽기 전용 + RW 레이어
```

### 6-3. Architecture 최다빈출

```
1. CNCF 성숙도       → Sandbox → Incubating → Graduated
2. Microservices     → 독립 배포, API 통신, 장애 격리
3. Service Mesh      → Sidecar proxy, Data Plane + Control Plane
4. Autoscaling       → HPA(Pod수), VPA(리소스), CA(노드수)
5. 12-Factor App     → 클라우드 네이티브 앱 설계 원칙
```

### 6-4. Observability 최다빈출

```
1. Prometheus        → Pull-based, 4 metric types
2. 3 Pillars         → Metrics, Logs, Traces
3. OpenTelemetry     → 벤더 중립, CNCF Graduated
4. Grafana           → 시각화, 다중 데이터소스
5. Loki              → Label 인덱싱만, 저비용 로그 시스템
```

### 6-5. Delivery 최다빈출

```
1. GitOps            → Git = Single Source of Truth
2. ArgoCD/Flux       → Pull 모델 CD 도구 (둘 다 Graduated)
3. Helm              → Chart/Release/Repository, v3 Tiller 제거
4. 배포 전략          → Rolling / Blue-Green / Canary
5. Kustomize         → base + overlay, 패치 기반
```

---

## 7. 헷갈리기 쉬운 비교 정리

### 7-1. 자주 혼동되는 쌍

| 비교 대상 | A | B | 핵심 차이 |
|-----------|---|---|-----------|
| Role vs ClusterRole | Namespace 범위 | 클러스터 범위 | 적용 범위 |
| ConfigMap vs Secret | 평문 저장 | base64 인코딩 | 민감도 수준 |
| DaemonSet vs Deployment | 노드당 1개 | replicas로 지정 | 배포 패턴 |
| HPA vs VPA | Pod 수 조절 | Pod 리소스 조절 | 스케일 방향 |
| Ingress vs Service | L7(HTTP 경로) | L4(IP:Port) | OSI 계층 |
| Helm vs Kustomize | 템플릿 엔진 | 패치/오버레이 | 커스터마이징 방식 |
| ArgoCD vs Flux | Web UI, ApplicationSet | CLI 중심, Kustomize 내장 | UX 차이 |
| Prometheus vs Loki | 메트릭 수집 | 로그 수집 | 데이터 유형 |
| Namespace vs cgroups | 프로세스 격리 | 자원 제한 | 격리 대상 |
| PV vs PVC | 관리자가 생성 | 사용자가 요청 | 생성 주체 |
| Jaeger vs Prometheus | 트레이스 | 메트릭 | 관측 유형 |
| OPA vs Kyverno | Rego 언어, 범용 | K8s YAML, K8s 전용 | 정책 표현 |

### 7-2. "~는 ~가 아니다" 필수 암기

```
1. Secret은 암호화가 아니다 (base64 인코딩)
2. Namespace는 자원 제한이 아니다 (ResourceQuota가 제한)
3. kube-proxy는 실제 트래픽을 프록시하지 않는다 (iptables 규칙만 관리)
4. Ingress는 자체적으로 동작하지 않는다 (Controller 필요)
5. Pod는 영구적이지 않다 (ephemeral, 언제든 재생성)
6. Label은 메타데이터 저장용이 아니다 (Annotation이 저장용)
7. Helm v3는 서버 컴포넌트가 없다 (Tiller 제거됨)
8. CNCF Sandbox는 프로덕션 검증을 의미하지 않는다 (실험 단계)
9. Loki는 로그 내용을 인덱싱하지 않는다 (Label만 인덱싱)
10. Prometheus는 장기 저장에 적합하지 않다 (Thanos/Cortex 필요)
```

---

## 8. 시험에서 자주 나오는 트러블슈팅 시나리오

시험 문제에서 장애 시나리오를 설명하고 원인 또는 해결 방법을 묻는 패턴이 자주 출제된다.

```
시나리오 1: Pod가 Pending 상태
  → Scheduler가 적합한 노드를 찾지 못했다
  → 원인: 리소스 부족, Taint 불일치, nodeSelector 불일치, PVC 미바인딩

시나리오 2: Pod가 CrashLoopBackOff 상태
  → 컨테이너가 시작 후 즉시 종료되고 반복 재시작된다
  → 원인: 앱 코드 오류, 설정 누락, 메모리 초과(OOMKilled), 잘못된 command

시나리오 3: Service에 접근해도 응답 없음
  → Endpoints가 비어 있다
  → 원인: Service selector와 Pod labels 불일치, Pod가 Ready 상태가 아님

시나리오 4: kubectl 명령이 Forbidden
  → RBAC 권한 부족이다
  → 원인: 사용자에게 해당 리소스에 대한 Role/RoleBinding이 없다

시나리오 5: 이미지를 가져올 수 없음 (ImagePullBackOff)
  → 원인: 이미지 이름/태그 오타, 프라이빗 레지스트리 인증 실패, 네트워크 문제

시나리오 6: Deployment 업데이트 후 롤백 필요
  → kubectl rollout undo deployment/<name>
  → Deployment가 이전 ReplicaSet을 보관하고 있으므로 가능하다

시나리오 7: HPA가 동작하지 않음 (TARGETS: <unknown>)
  → metrics-server 미설치 또는 Pod에 resources.requests 미설정

시나리오 8: Ingress가 동작하지 않음
  → Ingress Controller가 설치되어 있지 않다
  → Ingress 리소스만으로는 아무 동작도 하지 않는다
```

---

## 9. 합격 후 다음 단계

### 9-1. 인증 로드맵

```
KCNA (Associate) ← 현재
    │
    ├── KCSA (Security Associate)  ← 보안 관심 시
    │
    ├── CKA (Administrator)        ← K8s 관리 실무
    │   └── CKS (Security Specialist) ← CKA 합격 후
    │
    └── CKAD (Developer)           ← K8s 개발 실무
```

### 9-2. 추천 학습 경로

| 순서 | 인증 | 특징 | 준비 기간 |
|------|------|------|-----------|
| 1 | KCNA | 이론 중심, 객관식 | 2-3주 |
| 2 | CKA | 실습 중심, 터미널 시험 | 4-6주 |
| 3 | CKAD | 앱 개발 중심, 터미널 시험 | 3-4주 |
| 4 | CKS | 보안 중심, CKA 필수 선수 | 4-6주 |
| 5 | KCSA | 보안 이론, 객관식 | 2-3주 |

### 8-3. tart-infra 실습 확장

```bash
# KCNA 합격 후 CKA 실습 환경 구축
cd ~/sideproejct/tart-infra

# tart VM으로 multi-node 클러스터 구성
tart create k8s-master --from-ipsw latest
tart create k8s-worker1 --from-ipsw latest
tart create k8s-worker2 --from-ipsw latest

# kubeadm으로 클러스터 부트스트랩
kubeadm init --pod-network-cidr=10.244.0.0/16
kubeadm join <master-ip>:6443 --token <token> --discovery-token-ca-cert-hash <hash>

# CKA 실습 시나리오 연습
kubectl run nginx --image=nginx --dry-run=client -o yaml > pod.yaml
kubectl create deployment web --image=nginx --replicas=3
kubectl expose deployment web --port=80 --type=NodePort
```

---

## 9. 학습 완료 자가 평가

### 9-1. 도메인별 준비도 체크

각 항목에 대해 스스로 점수를 매겨본다 (1-5점).

```
Kubernetes Fundamentals (46%)
[ ] Control Plane 4대 컴포넌트 역할 설명 가능     ___/5
[ ] Worker Node 컴포넌트 역할 설명 가능            ___/5
[ ] 핵심 오브젝트 10개 이상 YAML 구조 이해          ___/5
[ ] RBAC, Namespace, Label 개념 정확히 구분         ___/5
[ ] PV/PVC/StorageClass 관계 설명 가능             ___/5

Container Orchestration (22%)
[ ] Container vs VM 차이 5가지 이상 설명 가능       ___/5
[ ] Linux Namespace vs cgroups 구분 가능           ___/5
[ ] OCI, CRI, CNI, CSI 설명 가능                   ___/5

Cloud Native Architecture (16%)
[ ] CNCF 성숙도 3단계와 Graduated 프로젝트 10개     ___/5
[ ] Service Mesh 구조와 대표 도구 설명 가능          ___/5
[ ] HPA/VPA/Cluster Autoscaler 차이 설명 가능       ___/5

Cloud Native Observability (8%)
[ ] 3 Pillars 각각 대표 도구 연결 가능              ___/5
[ ] Prometheus Pull 방식과 4 metric types           ___/5

Application Delivery (8%)
[ ] GitOps 4원칙 나열 가능                         ___/5
[ ] Helm vs Kustomize 차이 설명 가능               ___/5
[ ] 3대 배포 전략 비교 설명 가능                     ___/5
```

### 9-2. 최종 판정

```
총점 80점 만점 기준:
- 70점 이상 (88%+) : 시험 응시 권장 → 합격 확률 높음
- 55점 이상 (69%+) : 약점 도메인 보충 후 응시
- 55점 미만         : Day 1부터 재학습 권장
```

---

## 10. Day 1-10 전체 커리큘럼 요약

| Day | 주제 | 도메인 | 핵심 키워드 |
|-----|------|--------|------------|
| 1 | K8s 아키텍처 - Control Plane & Worker Node | Fundamentals | API Server, etcd, Scheduler, kubelet |
| 2 | K8s 아키텍처 - 통신 흐름 & Static Pod | Fundamentals | kubectl → API Server → kubelet 흐름 |
| 3 | 핵심 오브젝트 Part 1 | Fundamentals | Pod, Deployment, Service, DaemonSet, StatefulSet, Job |
| 4 | 핵심 오브젝트 Part 2 | Fundamentals | ConfigMap, Secret, RBAC, Ingress, PV/PVC |
| 5 | 컨테이너 오케스트레이션 & 컨테이너 기술 | Orchestration | Namespace, cgroups, OCI, CRI/CNI/CSI |
| 6 | 클라우드 네이티브 아키텍처 | Architecture | CNCF, Microservices, Service Mesh, Autoscaling |
| 7 | 클라우드 네이티브 관측성 | Observability | Prometheus, 3 Pillars, OpenTelemetry |
| 8 | 애플리케이션 전달 | Delivery | GitOps, ArgoCD, Helm, Kustomize, 배포 전략 |
| 9 | 모의시험 50문 | 전체 | 도메인별 비중 반영, 오답 분석 |
| 10 | 최종 정리 & 시험 전략 | 전체 | 암기 카드, CNCF 리스트, 시험 전략 |

---

**KCNA 10일 학습 과정을 모두 완료했다. 시험에서 좋은 결과를 거두기 바란다.**
