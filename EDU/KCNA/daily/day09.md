# KCNA Day 9: 전체 도메인 모의시험 (50문제)

> 학습 목표: 전 도메인을 포괄하는 모의시험으로 실전 감각을 익히고, 취약 도메인을 집중 복습한다.
> 예상 소요 시간: 110분 (모의시험 75분 + 오답노트 35분)
> 시험 도메인: 전체 (Fundamentals 46% + Orchestration 22% + Architecture 16% + Observability 8% + Delivery 8%)
> 난이도: ★★★★★ (실전 모의시험)

---

## 1. 모의시험 안내

### 1.1 시험 정보

| 항목 | 실제 KCNA | 오늘 모의시험 |
|------|----------|-------------|
| 문항 수 | 60문항 | 50문항 |
| 시간 | 90분 | 75분 |
| 합격 기준 | 75% (45/60) | 75% (38/50) |
| 형식 | 객관식 (4지선다) | 객관식 (4지선다) |

### 1.2 도메인별 문항 배분

| 도메인 | 비율 | 문항 수 | 문항 번호 |
|--------|------|---------|----------|
| Kubernetes Fundamentals | 46% | 23 | 1~23 |
| Container Orchestration | 22% | 11 | 24~34 |
| Cloud Native Architecture | 16% | 8 | 35~42 |
| Cloud Native Observability | 8% | 4 | 43~46 |
| Application Delivery | 8% | 4 | 47~50 |

### 1.3 시험 시작 전 준비

- 타이머를 **75분**으로 설정한다
- 모든 학습 자료를 닫는다
- 한 문제에 2분 이상 머물지 않는다 (표시 후 다음)

---

## 2. 모의시험 (75분, 50문제)

### Kubernetes Fundamentals (문제 1~23)

### 문제 1.
Kubernetes 클러스터에서 etcd와 직접 통신하는 유일한 컴포넌트는?

A) kubelet
B) kube-scheduler
C) kube-apiserver
D) kube-controller-manager

<details><summary>정답 확인</summary>

**정답: C) kube-apiserver**

kube-apiserver는 etcd와 직접 통신하는 유일한 컴포넌트이다. 다른 모든 컴포넌트는 API Server를 경유한다.
</details>

---

### 문제 2.
kube-scheduler가 Pod를 노드에 배치할 때 수행하는 2단계 과정의 올바른 순서는?

A) 스코어링 → 필터링
B) 필터링 → 스코어링
C) 할당 → 검증
D) 검증 → 필터링

<details><summary>정답 확인</summary>

**정답: B) 필터링 → 스코어링**

Scheduler는 먼저 필터링으로 부적합 노드를 제외하고, 스코어링으로 최적 노드를 선택한다.
</details>

---

### 문제 3.
etcd의 고가용성 환경에서 합의를 위해 사용하는 알고리즘은?

A) Paxos
B) Raft
C) PBFT
D) ZAB

<details><summary>정답 확인</summary>

**정답: B) Raft**

etcd는 Raft 합의 알고리즘을 사용한다. 홀수 노드 운영이 권장된다.
</details>

---

### 문제 4.
Pod 내 컨테이너 간에 공유되는 것으로 올바른 것은?

A) CPU와 메모리 리소스 제한
B) 컨테이너 이미지
C) 네트워크 네임스페이스(IP, 포트)와 스토리지(Volume)
D) 프로세스 ID 네임스페이스

<details><summary>정답 확인</summary>

**정답: C) 네트워크 네임스페이스(IP, 포트)와 스토리지(Volume)**

같은 Pod 내 컨테이너는 네트워크와 볼륨을 공유한다. localhost로 통신 가능하다.
</details>

---

### 문제 5.
멀티컨테이너 Pod 패턴 중 메인 컨테이너의 네트워크 연결을 대리하는 패턴은?

A) Sidecar
B) Ambassador
C) Adapter
D) Init Container

<details><summary>정답 확인</summary>

**정답: B) Ambassador**

Ambassador = 네트워크 대리, Sidecar = 보조 기능, Adapter = 출력 변환.
</details>

---

### 문제 6.
Deployment 배포 전략 중 일시적 다운타임이 발생하는 전략은?

A) RollingUpdate
B) Recreate
C) BlueGreen
D) Canary

<details><summary>정답 확인</summary>

**정답: B) Recreate**

Recreate는 모든 Pod를 제거 후 새로 생성하여 다운타임이 발생한다.
</details>

---

### 문제 7.
Service의 DNS FQDN 형식으로 올바른 것은?

A) `<Pod명>.<네임스페이스>.pod.cluster.local`
B) `<서비스명>.<네임스페이스>.svc.cluster.local`
C) `<서비스명>.<클러스터명>.k8s.local`
D) `<네임스페이스>.<서비스명>.dns.local`

<details><summary>정답 확인</summary>

**정답: B) `<서비스명>.<네임스페이스>.svc.cluster.local`**
</details>

---

### 문제 8.
StatefulSet과 반드시 함께 사용해야 하는 Service 유형은?

A) ClusterIP
B) NodePort
C) LoadBalancer
D) Headless Service (clusterIP: None)

<details><summary>정답 확인</summary>

**정답: D) Headless Service (clusterIP: None)**

StatefulSet은 각 Pod에 고유 DNS를 부여하기 위해 Headless Service가 필요하다.
</details>

---

### 문제 9.
PersistentVolume의 회수 정책 중 PVC 삭제 시 PV와 데이터를 보존하는 정책은?

A) Delete
B) Retain
C) Recycle
D) Archive

<details><summary>정답 확인</summary>

**정답: B) Retain**

Retain은 PVC 삭제 시 PV와 데이터를 보존한다.
</details>

---

### 문제 10.
NetworkPolicy를 지원하지 않는 CNI는?

A) Calico
B) Cilium
C) Flannel
D) Weave

<details><summary>정답 확인</summary>

**정답: C) Flannel**

Flannel은 단순한 L3 네트워크만 제공하며 NetworkPolicy를 지원하지 않는다.
</details>

---

### 문제 11.
RBAC에서 클러스터 전체에 적용되는 권한을 정의하는 리소스는?

A) Role
B) ClusterRole
C) RoleBinding
D) ServiceAccount

<details><summary>정답 확인</summary>

**정답: B) ClusterRole**
</details>

---

### 문제 12.
Ingress에 대한 설명으로 올바른 것은?

A) Ingress 리소스만 생성하면 자동으로 동작한다
B) TCP/UDP 트래픽을 모두 라우팅할 수 있다
C) Ingress Controller가 반드시 설치되어 있어야 동작한다
D) 각 서비스마다 별도의 IP가 할당된다

<details><summary>정답 확인</summary>

**정답: C) Ingress Controller가 반드시 설치되어 있어야 동작한다**
</details>

---

### 문제 13.
CronJob의 concurrencyPolicy 중 이전 Job 실행 중 새 Job을 건너뛰는 설정은?

A) Allow
B) Forbid
C) Replace
D) Skip

<details><summary>정답 확인</summary>

**정답: B) Forbid**
</details>

---

### 문제 14.
kubectl 명령어 중 리소스의 필드 문서를 조회하는 것은?

A) kubectl describe
B) kubectl get -o yaml
C) kubectl explain
D) kubectl inspect

<details><summary>정답 확인</summary>

**정답: C) kubectl explain**
</details>

---

### 문제 15.
클러스터 수준 리소스가 아닌 것은?

A) Node
B) PersistentVolume
C) Deployment
D) Namespace

<details><summary>정답 확인</summary>

**정답: C) Deployment**

Deployment는 네임스페이스에 속하는 리소스이다.
</details>

---

### 문제 16.
Pod의 restartPolicy 기본값은?

A) Never
B) OnFailure
C) Always
D) Unless-Stopped

<details><summary>정답 확인</summary>

**정답: C) Always**
</details>

---

### 문제 17.
StorageClass의 volumeBindingMode를 WaitForFirstConsumer로 설정하면?

A) PVC 생성 즉시 PV에 바인딩된다
B) PVC를 사용하는 Pod가 스케줄링될 때까지 바인딩을 지연한다
C) PV를 수동으로 생성해야 바인딩된다
D) 바인딩이 불가능하다

<details><summary>정답 확인</summary>

**정답: B) PVC를 사용하는 Pod가 스케줄링될 때까지 바인딩을 지연한다**
</details>

---

### 문제 18.
Label과 Annotation의 차이로 올바른 것은?

A) Label은 크기 제한이 없다
B) Label은 셀렉터로 오브젝트를 선택할 수 있지만, Annotation은 할 수 없다
C) Annotation은 오브젝트를 그룹화하는 데 사용된다
D) Label과 Annotation은 동일하다

<details><summary>정답 확인</summary>

**정답: B) Label은 셀렉터로 오브젝트를 선택할 수 있지만, Annotation은 할 수 없다**
</details>

---

### 문제 19.
Secret에 대한 설명으로 올바른 것은?

A) AES-256으로 암호화되어 저장된다
B) Base64로 인코딩되어 저장되며, 이것만으로는 암호화가 아니다
C) 볼륨으로 마운트할 수 없다
D) 최대 크기는 10MiB이다

<details><summary>정답 확인</summary>

**정답: B) Base64로 인코딩되어 저장되며, 이것만으로는 암호화가 아니다**
</details>

---

### 문제 20.
ConfigMap 변경 시 반영 방식으로 올바른 것은?

A) 환경 변수와 볼륨 모두 자동 반영된다
B) 볼륨은 자동 반영되지만, 환경 변수는 Pod 재시작 필요
C) 환경 변수는 자동 반영되지만, 볼륨은 Pod 재시작 필요
D) 둘 다 Pod 재시작 필요

<details><summary>정답 확인</summary>

**정답: B) 볼륨은 자동 반영되지만, 환경 변수는 Pod 재시작 필요**
</details>

---

### 문제 21.
Liveness Probe가 실패했을 때의 동작은?

A) Service 엔드포인트에서 제거
B) kubelet이 컨테이너를 재시작
C) Pod를 다른 노드로 이동
D) 알림만 발생

<details><summary>정답 확인</summary>

**정답: B) kubelet이 컨테이너를 재시작**
</details>

---

### 문제 22.
K8s 기본 네임스페이스가 아닌 것은?

A) default
B) kube-system
C) kube-apps
D) kube-node-lease

<details><summary>정답 확인</summary>

**정답: C) kube-apps**

기본 NS: default, kube-system, kube-public, kube-node-lease
</details>

---

### 문제 23.
API Server의 요청 처리 순서로 올바른 것은?

A) 인가 → 인증 → 어드미션 컨트롤
B) 어드미션 컨트롤 → 인증 → 인가
C) 인증 → 인가 → 어드미션 컨트롤
D) 인증 → 어드미션 컨트롤 → 인가

<details><summary>정답 확인</summary>

**정답: C) 인증 → 인가 → 어드미션 컨트롤**
</details>

---

### Container Orchestration (문제 24~34)

### 문제 24.
리소스 사용량을 제한하는 Linux 커널 기능은?

A) namespace
B) cgroups
C) seccomp
D) AppArmor

<details><summary>정답 확인</summary>

**정답: B) cgroups**

namespace = 격리, cgroups = 리소스 제한.
</details>

---

### 문제 25.
컨테이너와 VM 비교로 올바른 것은?

A) 컨테이너가 보안 격리가 더 강하다
B) 컨테이너는 호스트 커널을 공유하므로 VM보다 가볍다
C) VM이 시작 시간이 더 빠르다
D) 컨테이너는 독립된 게스트 OS를 포함한다

<details><summary>정답 확인</summary>

**정답: B) 컨테이너는 호스트 커널을 공유하므로 VM보다 가볍다**
</details>

---

### 문제 26.
OCI가 정의하는 사양이 아닌 것은?

A) Runtime Specification
B) Image Specification
C) Distribution Specification
D) Orchestration Specification

<details><summary>정답 확인</summary>

**정답: D) Orchestration Specification**
</details>

---

### 문제 27.
runc에 대한 설명으로 올바른 것은?

A) 고수준 런타임으로 이미지 관리를 담당한다
B) OCI Runtime Spec의 참조 구현체로, 저수준 런타임이다
C) K8s 패키지 매니저이다
D) 네트워크 플러그인이다

<details><summary>정답 확인</summary>

**정답: B) OCI Runtime Spec의 참조 구현체로, 저수준 런타임이다**
</details>

---

### 문제 28.
CMD와 ENTRYPOINT의 차이로 올바른 것은?

A) CMD는 고정이고 ENTRYPOINT는 덮어쓰기 가능
B) CMD는 덮어쓰기 가능하고 ENTRYPOINT는 고정
C) 둘은 동일하다
D) CMD는 빌드 시, ENTRYPOINT는 런타임에 실행

<details><summary>정답 확인</summary>

**정답: B) CMD는 덮어쓰기 가능하고 ENTRYPOINT는 고정**
</details>

---

### 문제 29.
K8s 기본 DNS 서버는?

A) kube-dns
B) CoreDNS
C) PowerDNS
D) BIND

<details><summary>정답 확인</summary>

**정답: B) CoreDNS**

CoreDNS는 CNCF 졸업 프로젝트이다.
</details>

---

### 문제 30.
멀티스테이지 빌드의 주된 목적은?

A) 빌드 속도 향상
B) 빌드와 실행 분리로 최종 이미지 크기 감소
C) 여러 OS 지원
D) 보안 취약점 자동 수정

<details><summary>정답 확인</summary>

**정답: B) 빌드와 실행 분리로 최종 이미지 크기 감소**
</details>

---

### 문제 31.
Pod가 비정상일 때 자동으로 재시작하는 프로브는?

A) Readiness Probe
B) Liveness Probe
C) Startup Probe
D) Health Probe

<details><summary>정답 확인</summary>

**정답: B) Liveness Probe**
</details>

---

### 문제 32.
이미지를 SHA256 해시로 고유하게 식별하는 것은?

A) Tag
B) Digest
C) Label
D) Version

<details><summary>정답 확인</summary>

**정답: B) Digest**
</details>

---

### 문제 33.
CNCF 졸업 프라이빗 컨테이너 레지스트리는?

A) Docker Hub
B) Quay
C) Harbor
D) Nexus

<details><summary>정답 확인</summary>

**정답: C) Harbor**
</details>

---

### 문제 34.
컨테이너 오케스트레이션이 제공하지 않는 기능은?

A) 자동 복구
B) 서비스 디스커버리
C) 소스 코드 컴파일
D) 로드밸런싱

<details><summary>정답 확인</summary>

**정답: C) 소스 코드 컴파일**
</details>

---

### Cloud Native Architecture (문제 35~42)

### 문제 35.
CNCF 성숙도 단계의 올바른 순서는?

A) Incubating → Sandbox → Graduated
B) Sandbox → Graduated → Incubating
C) Sandbox → Incubating → Graduated
D) Graduated → Incubating → Sandbox

<details><summary>정답 확인</summary>

**정답: C) Sandbox → Incubating → Graduated**
</details>

---

### 문제 36.
Graduated 필수 조건은?

A) 100만 다운로드
B) 보안 감사(Security Audit) 완료
C) 3년 이상 운영
D) 5개 이상 클라우드 지원

<details><summary>정답 확인</summary>

**정답: B) 보안 감사(Security Audit) 완료**
</details>

---

### 문제 37.
Cloud Native 핵심 개념이 아닌 것은?

A) 컨테이너
B) 마이크로서비스
C) 모놀리식 아키텍처
D) 선언적 API

<details><summary>정답 확인</summary>

**정답: C) 모놀리식 아키텍처**
</details>

---

### 문제 38.
Istio의 사이드카 프록시는?

A) HAProxy
B) NGINX
C) Envoy
D) Traefik

<details><summary>정답 확인</summary>

**정답: C) Envoy**
</details>

---

### 문제 39.
VPA가 조정하는 것은?

A) Pod의 수
B) Pod의 리소스 requests와 limits
C) 노드의 수
D) Service 엔드포인트 수

<details><summary>정답 확인</summary>

**정답: B) Pod의 리소스 requests와 limits**
</details>

---

### 문제 40.
불변 인프라의 핵심 원칙은?

A) SSH로 직접 수정
B) 변경이 필요하면 새로 빌드하여 교체
C) 설정 파일을 수동 편집
D) 운영 중 패치 적용

<details><summary>정답 확인</summary>

**정답: B) 변경이 필요하면 새로 빌드하여 교체**
</details>

---

### 문제 41.
HPA 동작에 반드시 필요한 것은?

A) Ingress Controller와 NetworkPolicy
B) metrics-server와 resources.requests
C) VPA와 Cluster Autoscaler
D) Prometheus와 Grafana

<details><summary>정답 확인</summary>

**정답: B) metrics-server와 resources.requests**
</details>

---

### 문제 42.
서비스 메시에서 Control Plane과 Data Plane의 역할은?

A) Control Plane이 트래픽을 처리한다
B) Control Plane이 설정/정책 관리, Data Plane이 트래픽 처리
C) 둘 다 트래픽을 처리한다
D) 둘 다 설정만 관리한다

<details><summary>정답 확인</summary>

**정답: B) Control Plane이 설정/정책 관리, Data Plane이 트래픽 처리**
</details>

---

### Cloud Native Observability (문제 43~46)

### 문제 43.
관측성의 세 기둥(Three Pillars)을 올바르게 나열한 것은?

A) 모니터링, 알림, 대시보드
B) 메트릭, 로그, 트레이스
C) Prometheus, Grafana, Jaeger
D) CPU, 메모리, 네트워크

<details><summary>정답 확인</summary>

**정답: B) 메트릭, 로그, 트레이스**

C는 도구 이름이지 축이 아니다!
</details>

---

### 문제 44.
Prometheus의 메트릭 수집 방식은?

A) Push 기반
B) Pull 기반 (타겟의 /metrics를 스크래핑)
C) 메시지 큐 기반
D) 파일 기반

<details><summary>정답 확인</summary>

**정답: B) Pull 기반**
</details>

---

### 문제 45.
Prometheus 메트릭 유형 중 증가/감소 모두 가능한 유형은?

A) Counter
B) Gauge
C) Histogram
D) Summary

<details><summary>정답 확인</summary>

**정답: B) Gauge**

Counter = 증가만, Gauge = 증가/감소 모두 가능.
</details>

---

### 문제 46.
OpenTelemetry에 대한 올바른 설명은?

A) 특정 벤더에 종속된 솔루션이다
B) 벤더 중립적인 관측성 통합 프레임워크이다
C) K8s 전용 로깅 도구이다
D) CNCF 졸업 프로젝트이다

<details><summary>정답 확인</summary>

**정답: B) 벤더 중립적인 관측성 통합 프레임워크이다**

OpenTelemetry는 CNCF **인큐베이팅** (졸업이 아님!)
</details>

---

### Cloud Native Application Delivery (문제 47~50)

### 문제 47.
GitOps의 핵심 원칙이 아닌 것은?

A) 선언적 설정
B) Git을 단일 진실 소스로 사용
C) SSH로 서버에 수동 적용
D) 에이전트에 의한 지속적 조정

<details><summary>정답 확인</summary>

**정답: C) SSH로 서버에 수동 적용**
</details>

---

### 문제 48.
Helm v3의 핵심 변경 사항은?

A) JSON으로 변경
B) Tiller 제거
C) K8s 1.20 이상만
D) Python으로 재작성

<details><summary>정답 확인</summary>

**정답: B) Tiller 제거**
</details>

---

### 문제 49.
두 환경을 유지하고 트래픽을 한 번에 전환하는 배포 전략은?

A) 롤링 업데이트
B) 블루/그린
C) 카나리
D) Recreate

<details><summary>정답 확인</summary>

**정답: B) 블루/그린**
</details>

---

### 문제 50.
ArgoCD와 Flux에 대한 올바른 설명은?

A) 둘 다 CI 도구이다
B) ArgoCD만 CNCF 졸업이다
C) 둘 다 CNCF 졸업 프로젝트이며 GitOps 기반 CD 도구이다
D) 둘 다 이미지 빌드 도구이다

<details><summary>정답 확인</summary>

**정답: C) 둘 다 CNCF 졸업 프로젝트이며 GitOps 기반 CD 도구이다**
</details>

---

## 3. 채점 & 오답 분석

### 3.1 정답표

| 번호 | 정답 | 도메인 | 번호 | 정답 | 도메인 |
|------|------|--------|------|------|--------|
| 1 | C | Fund | 26 | D | Orch |
| 2 | B | Fund | 27 | B | Orch |
| 3 | B | Fund | 28 | B | Orch |
| 4 | C | Fund | 29 | B | Orch |
| 5 | B | Fund | 30 | B | Orch |
| 6 | B | Fund | 31 | B | Orch |
| 7 | B | Fund | 32 | B | Orch |
| 8 | D | Fund | 33 | C | Orch |
| 9 | B | Fund | 34 | C | Orch |
| 10 | C | Fund | 35 | C | Arch |
| 11 | B | Fund | 36 | B | Arch |
| 12 | C | Fund | 37 | C | Arch |
| 13 | B | Fund | 38 | C | Arch |
| 14 | C | Fund | 39 | B | Arch |
| 15 | C | Fund | 40 | B | Arch |
| 16 | C | Fund | 41 | B | Arch |
| 17 | B | Fund | 42 | B | Arch |
| 18 | B | Fund | 43 | B | Obs |
| 19 | B | Fund | 44 | B | Obs |
| 20 | B | Fund | 45 | B | Obs |
| 21 | B | Fund | 46 | B | Obs |
| 22 | C | Fund | 47 | C | Del |
| 23 | C | Fund | 48 | B | Del |
| 24 | B | Orch | 49 | B | Del |
| 25 | B | Orch | 50 | C | Del |

### 3.2 도메인별 점수 계산

| 도메인 | 문항 수 | 정답 수 | 정답률 | 합격 기준 |
|--------|---------|---------|--------|----------|
| Fundamentals (1~23) | 23 | /23 | % | 75% |
| Orchestration (24~34) | 11 | /11 | % | 75% |
| Architecture (35~42) | 8 | /8 | % | 75% |
| Observability (43~46) | 4 | /4 | % | 75% |
| Delivery (47~50) | 4 | /4 | % | 75% |
| **총점** | **50** | **/50** | **%** | **75% (38/50)** |

### 3.3 오답노트 작성 가이드

틀린 문제마다 아래 양식으로 오답노트를 작성한다:

```
문제 번호: __
내가 선택한 답: __
정답: __
틀린 이유: ____________________
핵심 키워드: ____________________
관련 Day 자료: Day __
```

### 3.4 취약 도메인 복습 전략

| 정답률 | 조치 |
|--------|------|
| 90% 이상 | 오답 문제만 확인 |
| 75~90% | 해당 도메인 개념 빠르게 재독 |
| 60~75% | 해당 Day 자료 전체 재학습 |
| 60% 미만 | 처음부터 재학습 |

**도메인별 복습 참조:**
- Fundamentals 취약 → Day 1 + Day 2 + Day 3 + Day 4 재학습
- Orchestration 취약 → Day 5 재학습
- Architecture 취약 → Day 6 재학습
- Observability 취약 → Day 7 재학습
- Delivery 취약 → Day 8 재학습

---

## tart-infra 실습

모의시험에서 학습한 전체 도메인 개념을 tart-infra 환경에서 종합 확인한다.

### 실습 환경 설정

```bash
# 4개 클러스터 kubeconfig 경로 확인
ls ~/sideproejct/tart-infra/kubeconfig/
# platform.yaml  dev.yaml  staging.yaml  prod.yaml
```

### 실습 1: 전체 클러스터 아키텍처 점검 (Fundamentals)

4개 클러스터의 구성을 빠르게 확인하여 K8s 아키텍처 개념을 종합 복습한다.

```bash
# 각 클러스터 노드/버전 확인
for cluster in platform dev staging prod; do
  echo "=== $cluster ==="
  KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/${cluster}.yaml kubectl get nodes -o custom-columns=NAME:.metadata.name,VERSION:.status.nodeInfo.kubeletVersion,RUNTIME:.status.nodeInfo.containerRuntimeVersion
  echo ""
done

# 예상 출력:
# === platform ===
# NAME                      VERSION   RUNTIME
# platform-control-plane    v1.3x.x   containerd://1.7.x
# === dev ===
# NAME                 VERSION   RUNTIME
# dev-control-plane    v1.3x.x   containerd://1.7.x
```

**동작 원리:** 모든 클러스터가 containerd 런타임을 사용한다(dockershim 제거, K8s v1.24+). kubeconfig 파일은 API Server 엔드포인트, 인증 정보, 컨텍스트를 포함하며, KUBECONFIG 환경 변수로 대상 클러스터를 전환한다.

### 실습 2: CNCF 프로젝트 & 관측성 스택 확인 (Architecture + Observability)

```bash
# platform 클러스터: 관측성 스택 확인
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/platform.yaml

# Prometheus(Graduated) + Grafana + Loki 확인
kubectl get pods -n monitoring --no-headers | awk '{print $1}' | head -10

# Grafana 대시보드: http://localhost:30300
# → Prometheus 메트릭(Metrics), Loki 로그(Logs) 데이터소스 확인 가능

# dev 클러스터: Hubble(Cilium 관측성) 확인
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/dev.yaml
kubectl get pods -n kube-system -l k8s-app=hubble-relay
```

**동작 원리:** 관측성의 3대 축은 Metrics(Prometheus), Logs(Loki), Traces(Jaeger)이다. platform 클러스터에 중앙 모니터링 스택을 배치하고, dev 클러스터에서 Hubble로 네트워크 플로우를 관측하는 구조이다.

### 실습 3: GitOps & Application Delivery 종합 확인 (Delivery)

```bash
# ArgoCD + Helm + 배포 전략 종합 확인
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/platform.yaml

# ArgoCD Application 상태 요약
kubectl get applications -n argocd -o custom-columns=NAME:.metadata.name,SYNC:.status.sync.status,HEALTH:.status.health.status 2>/dev/null || echo "ArgoCD applications not found"

# Helm Release 전체 현황
helm list -A --output table 2>/dev/null | head -10

# dev 클러스터의 워크로드 종합 현황
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/dev.yaml
echo "--- Deployments ---"
kubectl get deploy -n demo
echo "--- StatefulSets ---"
kubectl get statefulset -n demo
echo "--- Services ---"
kubectl get svc -n demo
```

**동작 원리:** tart-infra는 GitOps 방식으로 운영된다. Git 저장소가 Single Source of Truth이며, ArgoCD가 Reconciliation Loop를 통해 클러스터 상태를 Git과 동기화한다. Helm으로 패키지를 관리하고, Deployment의 RollingUpdate 전략으로 무중단 배포를 수행한다.

---

## 내일 학습 예고

> Day 10에서는 핵심 암기 카드, CNCF 프로젝트 최종 정리, 시험 당일 전략을 학습하여 최종 점검을 마무리한다.
