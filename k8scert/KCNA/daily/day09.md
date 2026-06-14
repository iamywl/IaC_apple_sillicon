# KCNA Day 9: 전체 도메인 모의시험 (50문제)

> 학습 목표: 전 도메인을 포괄하는 모의시험으로 실전 감각을 익히고, 취약 도메인을 집중 복습한다.
> 예상 소요 시간: 110분 (모의시험 75분 + 오답노트 35분)
> 시험 도메인: 전체 (Fundamentals 46% + Orchestration 22% + Architecture 16% + Observability 8% + Delivery 8%)
> 난이도: ★★★★★ (실전 모의시험)

---

## 오늘의 학습 목표 (체크리스트)

Day 1~8에서 학습한 전 도메인을 모의시험 형식으로 점검한다. 아래 항목을 모두 체크할 수 있으면 Day 9를 완료한 것이다.

- [ ] KCNA 5개 도메인(Fundamentals·Orchestration·Architecture·Observability·Delivery)의 핵심 개념을 선지 구분 수준으로 설명할 수 있다
- [ ] etcd Raft 합의, Scheduler 필터링/스코어링, API Server 인증→인가→어드미션 순서를 틀리지 않고 나열할 수 있다
- [ ] PV Reclaim Policy 3종(Retain/Delete/Recycle)의 차이와 Recycle deprecated 이유를 설명할 수 있다
- [ ] RBAC Role/ClusterRole/RoleBinding/ClusterRoleBinding의 범위 차이를 도식으로 그릴 수 있다
- [ ] Probe 3종(Liveness/Readiness/Startup)의 실패 동작이 각각 다름을 설명할 수 있다
- [ ] Harbor가 CNCF Graduated이고 Quay가 CNCF 비소속임을 이유와 함께 설명할 수 있다
- [ ] 불변 인프라의 문제 의식(설정 드리프트)과 해결 방식을 한 단락으로 설명할 수 있다
- [ ] 모의시험 50문제를 75분 내에 풀고 75%(38/50) 이상 득점한다

---

## 0. 등장 배경과 시험 전략

KCNA 시험은 CNCF가 Cloud Native 생태계의 기본 소양을 검증하기 위해 만든 자격증이다. CKA/CKAD/CKS와 달리 실습(Performance-based)이 아닌 객관식(Multiple Choice) 형태이다. 이 시험은 "Kubernetes를 운영할 수 있는가?"를 측정하는 것이 아니라 "Cloud Native 아키텍처의 개념과 생태계를 이해하고 있는가?"를 측정한다. 따라서 kubectl 명령 암기보다 컴포넌트 역할, CNCF 프로젝트 분류, 아키텍처 원칙(선언적, Reconciliation, Pull 기반)을 정확히 이해하는 것이 핵심이다.

KCNA가 Performance-based가 아닌 이유는 시험 목적에 있다. CKA/CKAD는 "실제 클러스터에서 문제를 해결할 수 있는가?"를 검증하는 실기 시험이고, KCNA는 "Cloud Native 생태계 전반의 개념·아키텍처·도구 선택 이유를 이해하는가?"를 검증하는 이론 시험이다. Kubernetes 운영자를 뽑는 자리에는 CKA가 더 적합하고, Cloud Native 전환 방향을 논의하는 자리(아키텍트·팀 리드·비개발 직군 등)에는 KCNA가 더 적합하다. 이 역할 분리 덕분에 KCNA는 클러스터 환경 없이 개념 이해만으로 취득할 수 있으며, CKA 준비 전 필수 개념을 점검하는 용도로도 쓰인다.

### 선수 과정 점검

이 모의시험은 Day 1~8의 내용을 모두 학습한 후에 푼다. 시작 전 아래 표를 10분 내로 훑어 핵심 개념이 머릿속에 있는지 확인한다.

| Day | 주요 개념 | 핵심 체크 포인트 |
|-----|----------|----------------|
| Day 1 | etcd, kubelet, kube-apiserver | etcd와 직접 통신하는 컴포넌트는 API Server 하나뿐 |
| Day 2 | Scheduler, Controller Manager | 필터링 → 스코어링 2단계, Reconciliation Loop |
| Day 3 | Pod, Namespace, RBAC | ClusterRole vs Role, RoleBinding 범위 |
| Day 4 | Secret, ConfigMap, Probe | Base64 ≠ 암호화, 볼륨은 자동 반영·환경변수는 재시작 필요 |
| Day 5 | Container, OCI, RuntimeClass | namespace(격리) vs cgroups(제한), runc = 저수준 런타임 |
| Day 6 | Istio, HPA/VPA, GitOps | Control Plane = 정책 관리, Data Plane = 트래픽 처리 |
| Day 7 | Prometheus, Loki, Tracing | 메트릭·로그·트레이스 = 관측성 3대 축, Pull 방식 |
| Day 8 | Helm, ArgoCD, Flux | Tiller 제거(v3), GitOps = Git이 Single Source of Truth |

자신 없는 개념이 있으면 해당 Day 자료를 먼저 복습한 뒤 모의시험을 시작한다.

```
실전 디버깅 마인드셋:
  - "etcd에 직접 접근" → API Server만 가능
  - "Pull 기반 모니터링" → Prometheus (Push가 아니다)
  - "Tiller 사용" → Helm v2 (v3에서 제거됨)
  - "Secret 암호화" → Base64는 암호화가 아니다
  - "Orchestration Spec" → OCI에 없다 (Runtime/Image/Distribution만)
  - 절대적 표현("항상", "유일하게", "반드시")이 포함된 선지는 의심한다
```

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

직관적으로 이해하면: ① 필터링(Filtering) — "이 Pod를 올릴 수 없는 노드"를 탈락시킨다(CPU/메모리 부족, Taint, NodeAffinity 불일치 등). ② 스코어링(Scoring) — 남은 노드에 점수를 매겨 가장 점수 높은 노드를 선택한다(이미지 캐시 여부, 리소스 여유 등). 스케줄러가 선택을 완료하면 etcd에 노드 배정 정보를 기록하고, 해당 노드의 kubelet이 이를 감지해 실제 컨테이너를 기동한다.
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

Raft는 분산된 여러 서버가 동일한 데이터 상태를 유지하기 위해 "리더 선출 + 다수결 투표"로 합의하는 알고리즘이다. etcd는 Raft를 통해 마스터(리더) 1대 + 팔로워 N대 구조로 고가용성을 확보한다. 쓰기는 리더만 처리하고, 팔로워들이 복제를 완료해 과반수가 승인하면 커밋된다. 이 때문에 노드 수가 짝수이면 동수 투표로 합의 불가 상태가 생길 수 있어, 3·5·7 등 홀수 노드 운영이 권장된다.
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

내부 동작: Pod가 생성될 때 "pause(infra) 컨테이너"가 먼저 기동되어 네트워크 네임스페이스와 IPC 네임스페이스를 초기화한다. 이후 같은 Pod의 모든 컨테이너가 이 pause 컨테이너의 네임스페이스에 합류하므로 동일 IP와 포트 공간을 갖는다. 프로세스 ID(PID) 네임스페이스는 기본적으로 공유되지 않으므로 컨테이너마다 독립된 PID 1번 프로세스가 존재한다(shareProcessNamespace: true 설정 시 예외).
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

Ambassador(대사)는 메인 컨테이너를 대신해 외부 서비스(데이터베이스·외부 API 등)와의 네트워크 연결을 처리한다. 메인 컨테이너는 항상 `localhost`에 연결하고, Ambassador 컨테이너가 실제 목적지를 결정한다.

**오답 선지 이유:**
- A) Sidecar — 메인 컨테이너의 기능을 *보조*하는 범용 패턴이다(로그 수집·설정 리로드 등). 네트워크 연결 대리가 주목적이 아니다.
- C) Adapter — 메인 컨테이너의 *출력 형식*을 표준화한다(예: 독자적 로그 포맷 → 공통 포맷 변환). 네트워크 대리가 아니다.
- D) Init Container — Pod 내 다른 컨테이너가 기동하기 전 초기화 작업(DB 마이그레이션·설정 파일 다운로드)을 수행하고 종료된다. 메인 컨테이너와 동시에 실행되지 않는다.
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

전략별 비교: RollingUpdate는 구버전 Pod를 하나씩 교체하므로 서비스가 유지되지만 구버전·신버전이 동시에 트래픽을 받는 순간이 생긴다(데이터베이스 스키마 변경처럼 하위 호환성이 없는 경우 문제). Recreate는 구버전을 모두 내린 뒤 신버전을 올려 스키마 불일치를 방지하지만, 그 간격 동안 서비스가 중단된다. BlueGreen은 두 환경을 모두 유지하다 트래픽을 한 번에 전환해 다운타임 없이 롤백도 즉시 가능하지만, 리소스가 두 배 필요하다. Canary는 신버전에 소량(예: 5%)의 트래픽만 먼저 보내 검증한 뒤 점진적으로 늘린다.
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

CoreDNS가 이 형식을 강제하는 이유는 도메인 계층(zone)을 통해 클러스터 내부 주소임을 명확히 구분하기 위해서다. `svc`는 Service 오브젝트임을 나타내며, `cluster.local`은 클러스터 내부 DNS 존이다. Pod의 FQDN은 별도 형식(`<Pod-IP-대시>.네임스페이스.pod.cluster.local`)을 사용한다.

**오답 선지 이유:**
- A) `<Pod명>.<네임스페이스>.pod.cluster.local` — Pod 이름 기반 DNS가 아니다. Pod IP 기반이며, Headless Service를 사용하는 StatefulSet Pod에 한해 `<pod명>.<service명>.<ns>.svc.cluster.local` 형식이 적용된다.
- C) `<서비스명>.<클러스터명>.k8s.local` — K8s DNS 표준에 없는 형식이다. 클러스터 이름은 FQDN에 포함되지 않는다.
- D) `<네임스페이스>.<서비스명>.dns.local` — 순서와 도메인 모두 잘못됐다. 서비스명이 네임스페이스보다 앞에 온다.
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

등장 배경과 메커니즘: 일반 ClusterIP Service는 Pod 집합에 단일 가상 IP를 부여하고 로드밸런싱으로 무작위 Pod를 선택한다. DB 복제(Primary-Secondary) 같은 구조에서는 "mysql-0(Primary)에만 쓰기"를 보내야 하는데, 일반 Service는 어느 Pod로 갈지 보장하지 않는다. Headless Service(clusterIP: None)는 가상 IP 없이 각 Pod에 직접 DNS 레코드를 생성한다. 예를 들어 `mysql-0.mysql-headless.default.svc.cluster.local`, `mysql-1.mysql-headless.default.svc.cluster.local` 형태로 Pod를 개별 주소로 지정할 수 있다. StatefulSet은 Pod를 순서대로(mysql-0 → mysql-1 → ...) 기동·종료하여 순서 의존적 초기화(복제 설정 등)를 보장한다.
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

**오답 선지 이유:**
- A) Delete — PVC 삭제 즉시 PV와 백엔드 스토리지(예: AWS EBS 볼륨, GCE 디스크)까지 자동 삭제된다. 운영 실수로 데이터 영구 소실 위험이 있으므로 주의가 필요하다.
- C) Recycle — `rm -rf /volume/*` 명령으로 데이터를 지운 뒤 PV를 재활용하는 방식이었으나, K8s 1.11부터 deprecated되어 동작 보장이 없다. 현재는 Dynamic Provisioning이 그 역할을 대체한다.
- D) Archive — K8s에 존재하지 않는 선지다.

**핵심 동작 원리:** Retain 정책이 적용된 PV는 PVC가 삭제되면 `Released` 상태로 전환된다. `Released` 상태의 PV는 이전 클레임 정보(claimRef)가 남아 있어 새 PVC가 자동으로 바인딩되지 않는다. 관리자가 수동으로 PV를 정리(`kubectl delete pv`)하거나 `spec.claimRef`를 지워야 재사용할 수 있다. 즉 "데이터를 보존하되 재사용은 수동"이 Retain의 트레이드오프다.
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

NetworkPolicy는 Pod 간 통신을 IP/포트 기준으로 제어하는 선언적 방화벽 규칙이다(CNI 플러그인이 실제 규칙을 구현한다). L3(IP 계층) 라우팅만 제공하는 Flannel은 NetworkPolicy 오브젝트를 인식하더라도 실제 트래픽 차단 규칙을 적용하지 않는다. Calico는 iptables/eBPF로, Cilium은 eBPF로, Weave는 자체 방식으로 NetworkPolicy를 구현한다. eBPF(extended Berkeley Packet Filter)는 리눅스 커널 내에서 실행되는 샌드박스 프로그램으로, iptables보다 성능이 높고 L4를 넘어 L7 필터링도 가능하다.
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

**오답 선지 이유:**
- A) Role — 특정 네임스페이스에만 권한을 부여한다. `kubectl create role` 시 반드시 `-n <namespace>`를 지정해야 한다.
- C) RoleBinding — 권한을 *정의*하는 것이 아니라, 이미 정의된 Role 또는 ClusterRole을 특정 주체(User·ServiceAccount·Group)에 *연결*한다.
- D) ServiceAccount — 파드가 API Server에 요청할 때 쓰는 신원(Identity)이다. 권한 정의가 아니라 인증 주체다.

**핵심 동작 원리:** ClusterRole은 네임스페이스 개념이 없는 클러스터 수준 리소스(Node·PersistentVolume·Namespace 등)에 권한을 부여하거나, 여러 네임스페이스에 동일 권한을 반복 적용할 때 사용한다. ClusterRole + ClusterRoleBinding = 클러스터 전체에 적용, ClusterRole + RoleBinding = 특정 네임스페이스에만 적용(재사용 패턴)이다.
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

**오답 선지 이유:**
- A) Ingress 리소스만 생성하면 자동 동작 — Ingress 오브젝트는 *규칙 선언*일 뿐이다. nginx-ingress·Traefik 등 Controller가 없으면 아무 동작도 하지 않는다.
- B) TCP/UDP 트래픽 모두 라우팅 — 기본 Ingress는 HTTP/HTTPS(L7) 라우팅만 지원한다. TCP/UDP는 별도 `ConfigMap` 설정 또는 다른 메커니즘이 필요하다.
- D) 서비스마다 별도 IP 할당 — Ingress의 핵심 목적이 단일 외부 IP/포트로 여러 서비스를 Host·Path 기반으로 분기하는 것이다. 서비스마다 IP를 주는 것은 LoadBalancer 타입 Service의 특성이다.

**핵심 동작 원리:** Ingress Controller(예: nginx-ingress)는 Ingress 오브젝트를 Watch하다가 변경이 감지되면 자신의 리버스 프록시 설정(nginx.conf 등)을 자동 재생성한다. 그 결과 `host: app.example.com / path: /api` → `service-a:80` 같은 라우팅 규칙이 실제 L7 프록시에 적용된다.
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

**오답 선지 이유:**
- A) Allow — 이전 Job이 아직 실행 중이어도 새 Job을 추가로 시작한다. 동시에 여러 Job이 실행될 수 있어, 중복 실행이 허용되는 배치 작업에만 적합하다.
- C) Replace — 이전 Job을 즉시 종료(삭제)하고 새 Job으로 교체한다. "항상 최신 실행만 유지"가 목적인 경우에 쓴다.
- D) Skip — K8s CronJob spec에 존재하지 않는 선지다.

**핵심 동작 원리:** CronJob은 지정된 스케줄에 따라 Job 오브젝트를 생성한다. `Forbid` 정책에서는 이전 Job이 아직 Running 상태이면 새 스케줄 시각이 돼도 Job을 생성하지 않고 건너뛴다(`MISSED` 이벤트 기록). DB 백업처럼 "동시에 두 번 실행되면 충돌하는" 작업에 사용한다. `startingDeadlineSeconds`를 함께 설정하면 놓친 실행이 누적되는 기간을 제한할 수 있다.
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

**오답 선지 이유:**
- A) kubectl describe — 특정 리소스 *인스턴스*의 상태, 이벤트, 메타데이터를 사람이 읽기 좋은 형식으로 보여준다(예: `kubectl describe pod my-pod`). 필드 문서가 아니라 실제 오브젝트 상태 조회다.
- B) kubectl get -o yaml — 특정 리소스 인스턴스의 현재 스펙을 YAML로 출력한다. 역시 인스턴스 조회이며 필드 설명이 없다.
- D) kubectl inspect — K8s에 존재하지 않는 명령이다.

**핵심 동작 원리:** `kubectl explain <리소스>` 또는 `kubectl explain <리소스>.<필드경로>`는 API Server에서 OpenAPI 스펙을 조회해 해당 리소스·필드의 타입, 설명, 하위 필드를 출력한다. 예를 들어 `kubectl explain pod.spec.containers.livenessProbe`는 livenessProbe의 모든 필드와 설명을 보여준다. `--recursive` 옵션으로 전체 필드 트리를 한 번에 볼 수도 있다.
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

네임스페이스가 없는(non-namespaced) 리소스는 `kubectl api-resources --namespaced=false`로 확인할 수 있으며, Node·PersistentVolume·Namespace·ClusterRole·ClusterRoleBinding·StorageClass 등이 해당한다. 이들은 클러스터 전체에 단 하나의 이름 공간을 공유하므로 `-n <namespace>` 플래그를 붙여도 무시된다. 반면 Deployment·Pod·Service·ConfigMap·Secret 등은 네임스페이스에 속하므로 같은 이름이 다른 네임스페이스에 공존할 수 있다.
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

**오답 선지 이유:**
- A) Never — 컨테이너가 종료되어도 절대 재시작하지 않는다. 작업이 끝나면 그 상태를 유지해야 하는 Job/CronJob의 컨테이너에 사용된다.
- B) OnFailure — 컨테이너가 비정상 종료(exit code != 0)일 때만 재시작한다. Job처럼 "성공하면 종료, 실패하면 재시도"가 필요한 경우에 적합하다.
- D) Unless-Stopped — Docker에서 사용하는 재시작 정책이며 Kubernetes에는 존재하지 않는다.

**핵심 동작 원리:** `restartPolicy: Always`(기본값)는 컨테이너가 정상 종료(exit 0)되어도 kubelet이 재시작한다. 이 설정은 Deployment·ReplicaSet·DaemonSet 같이 "항상 실행 중이어야 하는" 워크로드에 적합하다. Job/CronJob은 작업 완료 후 재시작이 불필요하므로 `OnFailure` 또는 `Never`를 사용한다.
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

`WaitForFirstConsumer`는 다중 가용 영역(Multi-AZ) 환경에서 반드시 필요한 설정이다. 기본값(`Immediate`)으로 PVC를 생성하면 Pod 스케줄 위치와 무관하게 PV가 먼저 특정 AZ의 스토리지에 프로비저닝된다. 이후 Pod가 다른 AZ의 노드에 스케줄링되면 볼륨 접근 불가 오류가 발생한다(EBS 볼륨은 동일 AZ에 있는 노드에서만 마운트 가능). `WaitForFirstConsumer`는 Pod가 특정 노드에 스케줄링된 것을 확인한 뒤, 그 노드가 속한 AZ에 PV를 프로비저닝하여 이 문제를 해결한다.

**오답 선지 이유:**
- A) PVC 생성 즉시 PV에 바인딩 — `Immediate` 모드의 동작이다.
- C) PV를 수동으로 생성해야 바인딩 — `volumeBindingMode`와 무관한 설명이다. 수동 PV는 Dynamic Provisioning이 없는 환경에서 관리자가 생성하는 것이다.
- D) 바인딩이 불가능 — 잘못됐다. 지연될 뿐 결국 바인딩된다.
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

**오답 선지 이유:**
- A) Label은 크기 제한이 없다 — Label의 키는 63자(prefix 포함 시 253자), 값은 63자로 제한된다. 크기 제한이 없는 것은 Annotation이다.
- C) Annotation은 오브젝트를 그룹화하는 데 사용된다 — 그룹화(선택·필터링)는 Label의 역할이다. Annotation은 셀렉터로 사용할 수 없다.
- D) Label과 Annotation은 동일하다 — 저장 위치(둘 다 metadata)는 같지만 목적과 크기 제한이 다르다.

**핵심 동작 원리:**
- **Label**: 키=63자, 값=63자 제한. `kubectl get pods -l app=nginx` 처럼 셀렉터로 오브젝트 집합을 선택할 수 있다. Service·Deployment·NetworkPolicy 등이 Pod를 지정할 때 Label Selector를 사용한다.
- **Annotation**: 크기 제한이 없는(최대 수십 KB) 비식별 메타데이터 저장소다. 도구 힌트(예: `kubectl.kubernetes.io/last-applied-configuration`), 외부 시스템 참조 ID, 빌드 정보 등 셀렉터 없이 참고용 정보를 저장하는 데 쓴다.
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

Base64는 바이너리 데이터를 텍스트로 표현하는 인코딩 방식으로, `echo "password" | base64`로 인코딩하고 `echo "cGFzc3dvcmQ=" | base64 -d`로 누구나 복원할 수 있다. 암호화(Encryption)는 키 없이는 복원할 수 없어야 하는데, Base64에는 키가 없다. etcd에 저장된 Secret 데이터를 진짜 암호화하려면 별도로 Encryption at Rest 설정(`EncryptionConfiguration`)이 필요하다.

**오답 선지 이유:**
- A) AES-256으로 암호화 — 기본 설정에서는 해당하지 않는다. `EncryptionConfiguration`으로 AES-GCM·AES-CBC 등을 명시적으로 설정해야 etcd에 암호화 저장된다.
- C) 볼륨으로 마운트할 수 없다 — 틀렸다. Secret은 `secretRef`로 환경 변수에 주입하거나 볼륨으로 마운트할 수 있다. 볼륨 마운트 시 파일로 노출된다.
- D) 최대 크기는 10MiB — 틀렸다. Secret의 최대 크기는 **1MiB**(1048576바이트)이다.
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

볼륨 마운트 방식에서는 kubelet이 일정 주기(기본 60초, `--sync-frequency`)로 ConfigMap 변경을 감지해 마운트된 파일을 업데이트한다. 이 메커니즘은 kubelet이 API Server에 주기적으로 폴링(polling)하거나 watch를 유지해 변경을 감지하는 방식이다. 반면 환경 변수는 Pod 기동 시 한 번만 주입되는 값으로 컨테이너 프로세스의 환경 변수 테이블에 고정된다. 실행 중인 프로세스의 환경 변수를 외부에서 변경하는 것은 OS 수준에서 불가능하므로 Pod를 재시작해야 새 값이 반영된다.

**오답 선지 이유:**
- A) 환경 변수와 볼륨 모두 자동 반영 — 환경 변수는 자동 반영되지 않는다.
- C) 환경 변수는 자동 반영되지만, 볼륨은 Pod 재시작 필요 — B와 정반대로 틀렸다.
- D) 둘 다 Pod 재시작 필요 — 볼륨은 재시작 없이 자동 반영된다.
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

**오답 선지 이유:**
- A) Service 엔드포인트에서 제거 — Readiness Probe 실패 시의 동작이다. 재시작하지 않고 트래픽만 차단한다.
- C) Pod를 다른 노드로 이동 — K8s는 기본적으로 실행 중인 Pod를 다른 노드로 이동하지 않는다. Node가 NotReady가 되면 Eviction이 발생하지만, 이는 별개 메커니즘이다.
- D) 알림만 발생 — 어떤 기본 Probe도 알림만 발생하지는 않는다. 실패 시 명확한 동작(재시작 또는 엔드포인트 제거)이 따른다.

**Probe 3종 비교:**

| Probe | 실패 시 동작 | 주요 용도 |
|-------|------------|---------|
| Liveness | kubelet이 컨테이너 재시작 | 데드락·무한루프 등 내부 비정상 상태 탐지 |
| Readiness | Service 엔드포인트에서 제거(트래픽 차단) | 초기화 중이거나 일시적으로 트래픽 받을 수 없는 상태 표시 |
| Startup | 성공 전까지 Liveness/Readiness 비활성화 | 기동 시간이 긴 컨테이너(JVM 앱 등)에서 Liveness가 너무 이른 재시작을 유발하는 것 방지 |
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

K8s 클러스터 생성 시 기본으로 존재하는 네임스페이스는 `default`, `kube-system`, `kube-public`, `kube-node-lease` 네 가지이다. 각각의 역할은 다음과 같다.
- `default`: 네임스페이스를 지정하지 않고 생성한 리소스가 들어가는 기본 공간이다.
- `kube-system`: API Server·Scheduler·Controller Manager·CoreDNS·CNI 플러그인 등 K8s 핵심 컴포넌트가 위치한다. 임의로 리소스를 올려서는 안 된다.
- `kube-public`: 인증 없이 읽기 허용되는 공개 네임스페이스다. `kubectl cluster-info`가 조회하는 클러스터 정보 ConfigMap이 이곳에 있다.
- `kube-node-lease`: 각 노드마다 Lease 오브젝트를 두어 노드 하트비트를 처리한다. K8s v1.14 이전에는 노드 상태를 etcd에 직접 기록했는데, 노드 수가 많으면 etcd 쓰기 부하가 과도해지는 문제가 있었다. Lease 오브젝트를 별도 네임스페이스에 분리해 kubelet이 주기적으로 갱신하고 Node Controller가 이를 읽어 노드 생존 여부를 판단하는 방식으로 etcd 부하를 줄였다.
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

API Server는 요청을 3단계로 검증한다.
- ① 인증(Authentication): "이 요청을 보낸 사람이 누구인가?" — 인증서(X.509), Bearer 토큰, OIDC 등을 확인해 신원을 확정한다.
- ② 인가(Authorization): "이 사람이 이 동작을 할 권한이 있는가?" — RBAC 정책(Role + RoleBinding)을 조회해 허용/거부를 결정한다.
- ③ 어드미션 컨트롤(Admission Control): "요청 내용이 클러스터 정책에 맞는가?" — Mutating Admission(요청 내용 자동 수정, 예: 기본 리소스 제한 주입)과 Validating Admission(정책 위반 검사, 예: internal registry 이미지만 허용, CPU 요청 2코어 초과 금지)을 순서대로 실행한다. 어드미션은 신원과 권한이 확인된 후에야 의미가 있으므로 반드시 마지막에 위치한다.
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

VM은 하이퍼바이저(KVM·VMware 등) 위에 게스트 OS를 통째로 올리므로 수 GB의 OS 이미지·커널·드라이버가 필요하고 기동에 수십 초~수 분이 걸린다. 컨테이너는 호스트 커널을 Linux namespace(프로세스 격리)와 cgroups(리소스 제한)로 공유하므로 추가 OS가 없어 이미지가 수 MB~수백 MB이고 기동이 수 밀리초~수 초에 끝난다.

**격리 강도 트레이드오프:** 보안 격리 측면에서는 VM이 더 강하다. 컨테이너는 호스트 커널을 공유하므로 커널 취약점이 발생하면 같은 호스트의 모든 컨테이너가 영향받는다. VM은 별도 커널이 있어 게스트 OS가 침해당해도 하이퍼바이저가 격리한다.

**오답 선지 이유:**
- A) 컨테이너가 보안 격리가 더 강하다 — 반대다. 보안 격리는 VM이 더 강하다.
- C) VM이 시작 시간이 더 빠르다 — 반대다. VM은 게스트 OS 부팅이 필요해 더 느리다.
- D) 컨테이너는 독립된 게스트 OS를 포함한다 — VM의 특성이다. 컨테이너는 호스트 OS 커널을 공유한다.
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

OCI(Open Container Initiative)는 Linux Foundation 산하 조직으로, 컨테이너 생태계의 이식성을 위해 세 가지 표준을 정의한다. Runtime Spec(컨테이너 실행 방법), Image Spec(이미지 레이어 구조·메타데이터), Distribution Spec(레지스트리 API — 이미지 push/pull 프로토콜)이다. Orchestration(여러 컨테이너의 배치·스케줄링·복구)은 OCI 범위 밖이며 Kubernetes 같은 오케스트레이터가 담당한다.

**오답 선지 이유:**
- A) Runtime Specification — OCI Runtime Spec으로 존재한다. runc가 참조 구현체다.
- B) Image Specification — OCI Image Spec으로 존재한다. 이미지 레이어(layer)와 매니페스트 형식을 정의한다.
- C) Distribution Specification — OCI Distribution Spec으로 존재한다. Docker Registry HTTP API V2를 표준화한 것이다.
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

Docker의 설계 의도: ENTRYPOINT는 "이 이미지가 무엇을 실행하는 컨테이너인가"를 정의하는 진짜 실행 파일이다. CMD는 "기본 매개변수"로, 사용자가 `docker run <image> <args>` 형태로 실행할 때 `<args>`로 덮어쓸 수 있다. 예를 들어 `ENTRYPOINT ["python3"]`, `CMD ["app.py"]`로 설정하면 `docker run myimage`는 `python3 app.py`를 실행하고, `docker run myimage debug.py`는 `python3 debug.py`를 실행한다. ENTRYPOINT를 덮어쓰려면 `--entrypoint` 플래그가 필요하다. Kubernetes에서는 `command`가 ENTRYPOINT, `args`가 CMD에 대응한다.
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

CoreDNS는 CNCF 졸업(Graduated) 프로젝트이다. CNCF 성숙도 단계는 Sandbox → Incubating → Graduated 순이며, Graduated는 프로덕션 사용 검증 + 보안 감사 완료를 뜻한다. K8s v1.13부터 kube-dns를 대체해 기본 클러스터 DNS로 채택됐다.
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

멀티스테이지 빌드(Multi-stage build)는 Dockerfile 안에 여러 `FROM` 구문을 사용해 빌드 단계와 실행 단계를 분리한다. 예를 들어 Go 앱을 빌드하려면 Go 컴파일러(~300MB)가 필요하지만, 최종 바이너리만 실행하는 데는 컴파일러가 필요 없다. 첫 번째 스테이지(`FROM golang:1.21 AS builder`)에서 소스를 컴파일하고, 두 번째 스테이지(`FROM scratch` 또는 `FROM alpine`)에서 빌드 산출물만 `COPY --from=builder`로 복사하면 최종 이미지에는 실행 바이너리만 포함되어 수십~수백 MB가 절감된다.

**오답 선지 이유:**
- A) 빌드 속도 향상 — 멀티스테이지 자체가 빌드를 빠르게 하지는 않는다. 빌드 캐시 활용이나 병렬 빌드가 속도와 관련된다.
- C) 여러 OS 지원 — 멀티 아키텍처(multi-arch) 이미지는 `docker buildx`와 `--platform` 플래그로 지원하며, 멀티스테이지 빌드와는 별개 개념이다.
- D) 보안 취약점 자동 수정 — 멀티스테이지는 불필요한 빌드 도구를 최종 이미지에서 제외해 공격 표면을 *줄이는* 효과가 있으나, 취약점을 자동 수정하지는 않는다.
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

**오답 선지 이유:**
- A) Readiness Probe — 실패 시 Pod를 Service 엔드포인트 목록에서 제거해 트래픽을 차단하지만, 컨테이너를 재시작하지는 않는다. Pod는 계속 실행 중이다.
- C) Startup Probe — 컨테이너가 기동 완료를 알릴 때까지 Liveness/Readiness Probe를 일시 중단시키는 역할이다. 그 자체가 재시작을 트리거하지는 않는다(실패 시에는 Liveness처럼 재시작할 수 있으나, 목적은 기동 시간 보장이다).
- D) Health Probe — K8s Probe 타입에 존재하지 않는 선지다.

이 문제는 Q21과 짝을 이루는 반복 확인 문제다. Probe 3종 비교(Liveness=재시작, Readiness=트래픽 차단, Startup=Liveness 비활성화)를 떠올리지 못했다면 Day 4 자료를 재학습한다.
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

**오답 선지 이유:**
- A) Tag — 사람이 읽기 쉬운 가변 포인터(예: `v1.2.3`, `latest`)로, 같은 태그를 가리키는 이미지 내용이 언제든 바뀔 수 있다. `latest`가 가장 흔한 예다.
- C) Label — 오브젝트에 붙이는 키-값 메타데이터이다. 이미지 자체를 식별하는 용도가 아니다.
- D) Version — K8s 이미지 스펙에 존재하지 않는 필드다.

**핵심 동작 원리:** Digest(예: `sha256:abc123...`)는 이미지 레이어 전체를 해시한 고유 식별자로, 내용이 변하면 반드시 달라진다. `image: nginx@sha256:abc123` 형식으로 고정하면 태그가 덮어써져도 항상 동일한 이미지 버전이 사용됨을 보장할 수 있다. 보안과 재현성이 중요한 프로덕션 환경에서는 Tag 대신 Digest 고정이 권장된다.
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

**오답 선지 이유:**
- A) Docker Hub — Docker Inc.(현 Docker)가 운영하는 퍼블릭 레지스트리로, CNCF 소속이 아니다.
- B) Quay — Red Hat이 오픈소스로 제공하는 레지스트리(`quay.io`, Project Quay)이며, CNCF 프로젝트가 아니다.
- D) Nexus — Sonatype이 만든 범용 아티팩트 저장소(Maven·npm·Docker 등)로, CNCF와 무관하다.

**Harbor 등장 배경:** 기업 환경에서 이미지를 퍼블릭 레지스트리에 올리지 못하고 사내에 프라이빗 레지스트리를 운영해야 하는 요구가 증가했다. Harbor는 VMware가 오픈소스로 공개한 후 CNCF에 기증해 2020년 Graduated 단계에 올랐다. 단순한 이미지 저장소를 넘어 취약점 스캔(Trivy·Clair 통합), RBAC(프로젝트/사용자 권한), 이미지 복제(멀티 레지스트리 동기화), 컨텐츠 신뢰(Notary 연동)를 제공한다는 점에서 Quay와 기능적으로 유사하지만, Harbor만이 CNCF Graduated 지위를 갖는다.
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

각 단계의 의미는 다음과 같다. **Sandbox**: 아이디어 단계로 CNCF가 초기 개발을 지원한다. 실험적이며 API·동작이 크게 바뀔 수 있다. 프로덕션 사용은 권장되지 않는다. **Incubating**: 실제 사용 사례(Adopter)가 생겼고 커뮤니티가 활성화됐으나 아직 보안 감사 등 Graduated 조건을 충족하지 못한 단계다. 조심스럽게 프로덕션 사용이 가능하다. **Graduated**: 다수의 프로덕션 사용 사례, 독립 보안 감사 완료, 활성 커뮤니티를 갖춘 성숙 단계다. 기업 프로덕션 환경에서 안정적으로 사용할 수 있다고 CNCF TOC가 인증한 상태다.

**오답 선지 이유:**
- A) Incubating → Sandbox → Graduated — 순서가 틀렸다. Sandbox가 시작이다.
- B) Sandbox → Graduated → Incubating — Incubating과 Graduated 순서가 바뀌었다.
- D) Graduated → Incubating → Sandbox — 전체가 역방향이다.
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

**오답 선지 이유:**
- A) 100만 다운로드 — CNCF Due Diligence 기준에 다운로드 수 기준은 없다. 실제 프로덕션 사용 *사례 수*가 기준이다.
- C) 3년 이상 운영 — 시간 기준이 아니라 성숙도(프로덕션 채택 규모, 커뮤니티 건강성) 기준이다.
- D) 5개 이상 클라우드 지원 — 클라우드 공급자 지원 수는 Graduated 조건이 아니다.

**Graduated 기준 상세:** CNCF TOC(Technical Oversight Committee)가 심사하는 Graduated 필수 조건은 다음과 같다. ① 독립 기관에 의한 보안 감사(Security Audit) 완료 및 결과 공개, ② 3개 이상의 독립된 조직이 프로덕션에서 사용하는 실제 사례(Adopter), ③ 활성 기여자 커뮤니티(커미터·유지관리자가 단일 조직에 집중되지 않을 것), ④ Incubating 단계에서의 성숙도 증명. Sandbox → Incubating → Graduated 순서이며, 각 단계 승급에는 TOC 투표가 필요하다. K8s 생태계 주요 Graduated 프로젝트: Kubernetes, Prometheus, Envoy, Jaeger, Fluentd, Vitess, ArgoCD, Flux, Harbor, CoreDNS 등.
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

Cloud Native는 CNCF 정의에 따르면 "컨테이너·마이크로서비스·불변 인프라·선언적 API를 통해 탄력적이고 관리 가능하며 관측 가능한 느슨하게 결합된 시스템을 구축"하는 것이다. 모놀리식 아키텍처는 모든 기능이 하나의 프로세스에 묶인 구조로, Cloud Native가 해결하려는 문제(배포 독립성 부재, 단일 장애점, 기술 스택 경직성)의 원인이다.

**오답 선지 이유:**
- A) 컨테이너 — Cloud Native의 핵심 패키징 단위다.
- B) 마이크로서비스 — 기능을 독립 배포 가능한 서비스로 분리하는 아키텍처로, Cloud Native의 핵심이다.
- D) 선언적 API — "원하는 상태를 선언하고 시스템이 맞춰 수렴"하는 방식으로, Kubernetes 전체 설계의 근간이다.
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

등장 배경: 마이크로서비스 아키텍처에서 서비스 수가 수십~수백 개로 늘어나면 각 서비스가 재시도·타임아웃·서킷 브레이커·암호화 등을 개별 구현해야 했다. Istio는 이 공통 네트워킹 기능을 애플리케이션 코드 밖으로 분리하기 위해 Pod마다 Envoy 프록시를 사이드카(Sidecar)로 자동 주입하는 방식을 채택했다. 사이드카는 메인 컨테이너와 동일 Pod 안에서 실행되는 보조 컨테이너로, 같은 네트워크 네임스페이스를 공유하므로 모든 인바운드/아웃바운드 트래픽을 가로채 라우팅 규칙·재시도·서킷 브레이커·mTLS 암호화를 투명하게 적용한다. mTLS(mutual TLS)는 클라이언트와 서버 양쪽이 모두 인증서로 신원을 증명하는 상호 인증 방식이다. 트레이드오프: Pod마다 Envoy 컨테이너가 추가되어 메모리(수십 MB)와 레이턴시 오버헤드가 발생한다.
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

**오답 선지 이유:**
- A) Pod의 수 — HPA(Horizontal Pod Autoscaler)가 하는 일이다. HPA는 Pod 수를 늘리거나 줄인다.
- C) 노드의 수 — Cluster Autoscaler가 하는 일이다. 노드 자체를 추가하거나 제거한다.
- D) Service 엔드포인트 수 — 엔드포인트는 Endpoints 컨트롤러가 자동 관리하며 VPA와 무관하다.

**핵심 동작 원리:** VPA(Vertical Pod Autoscaler)는 과거 리소스 사용 이력을 분석해 각 컨테이너에 적합한 `requests`와 `limits` 값을 추천(Recommender 모드) 또는 자동 적용(Auto 모드)한다. Auto 모드에서는 값 변경 시 기존 Pod를 재생성(재시작)해야 하므로 다운타임이 발생할 수 있다. HPA와 VPA를 CPU 기준으로 동시에 사용하면 서로 충돌(HPA가 Pod를 늘리는 동시에 VPA가 requests를 올려 스케줄링 실패 가능)하므로, 보통 HPA는 CPU/메모리 메트릭 외(custom metrics), VPA는 CPU/메모리 튜닝 전용으로 역할을 분리한다.
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

**오답 선지 이유:**
- A) SSH로 직접 수정 — 가변(Mutable) 인프라 방식이다. 여러 서버를 다른 시점에 다르게 수동 변경하면 각 서버의 실제 상태가 조금씩 달라지는 "설정 드리프트(Configuration Drift)"가 발생한다.
- C) 설정 파일을 수동 편집 — SSH 직접 수정과 마찬가지로 가변 인프라의 대표 안티패턴이다.
- D) 운영 중 패치 적용 — OS 패치나 라이브러리 업데이트를 실행 중인 서버에 직접 적용하면, 패치 전후 상태를 재현하기 어렵고 장애 시 원인을 추적하기 힘들어진다.

**불변 인프라 등장 배경:** 전통적인 가변 인프라에서는 서버가 오래 운영될수록 수동 패치·설정 변경이 쌓여 처음 배포한 상태와 달라진다(드리프트). 이 상태는 문서화되지 않아 "이 서버에서는 왜 그 서버와 다르게 동작하지?"라는 재현 불가 문제가 발생한다. 불변 인프라는 변경이 필요할 때 기존 서버를 수정하는 대신 새 이미지를 빌드하고 새 인스턴스로 교체하는 원칙이다. 모든 상태가 Git + 이미지 레지스트리에 버전으로 남아 완전한 재현성과 롤백이 가능해진다. 컨테이너 이미지 자체가 불변 인프라의 구체적 구현체이며, GitOps(ArgoCD·Flux)는 이 원칙을 클러스터 수준으로 확장한 것이다.
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

HPA(Horizontal Pod Autoscaler)는 현재 CPU/메모리 사용률을 `requests` 대비 비율로 계산해 Pod 수를 결정한다. 예를 들어 `targetCPUUtilizationPercentage: 50`이면, Pod의 현재 CPU 사용량이 `requests`의 50%를 넘을 때 스케일 아웃한다. 이 계산에는 두 가지가 반드시 필요하다. ① `resources.requests` — 분모(목표 대비 기준값). requests가 없으면 비율 계산 자체가 불가능하다. ② `metrics-server` — 현재 CPU/메모리 사용량(분자)을 수집해 Kubernetes Metrics API(`metrics.k8s.io`)로 노출한다. HPA는 이 API를 주기적으로 조회해 스케일 결정을 내린다. metrics-server가 없으면 HPA 오브젝트가 생성되더라도 `<unknown>/50%` 상태로 멈춰 동작하지 않는다.

**오답 선지 이유:**
- A) Ingress Controller와 NetworkPolicy — HPA와 무관하다.
- C) VPA와 Cluster Autoscaler — VPA는 Pod의 requests를 조정하고, Cluster Autoscaler는 노드 수를 조정하며, HPA와는 다른 계층의 도구다.
- D) Prometheus와 Grafana — Prometheus를 메트릭 소스로 Custom Metrics API를 통해 HPA와 연동할 수 있지만, 기본 CPU/메모리 기반 HPA는 metrics-server만 필요하다.
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

서비스 메시 구조 설명: Control Plane(Istio에서는 istiod)은 트래픽을 직접 처리하지 않는다. 대신 라우팅 규칙, 보안 정책, mTLS 인증서를 생성해 각 Pod의 Envoy 프록시(Data Plane)에 배포한다. Data Plane = 실제 서비스 트래픽이 흐르는 계층으로, 각 Pod에 주입된 Envoy 프록시가 그 역할을 한다. Control Plane이 다운되어도 이미 배포된 설정대로 Envoy가 계속 트래픽을 처리하므로 서비스가 즉시 중단되지는 않는다(단, 새 정책 변경은 반영되지 않는다).
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

선지 C는 Prometheus·Grafana·Jaeger라는 도구 이름이며, 관측성의 축(Pillar)은 도구가 아니라 데이터 유형(Metrics·Logs·Traces)을 가리킨다. 도구는 교체 가능하지만 축은 무엇을 측정하는가의 분류 개념이다. 예를 들어 Prometheus 대신 Datadog을, Jaeger 대신 Zipkin을 써도 관측성의 세 축은 변하지 않는다.
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

Prometheus 서버가 스크래핑 대상(타겟)의 HTTP `/metrics` 엔드포인트를 주기적으로 직접 조회해 메트릭을 가져온다. 타겟은 별도 에이전트 없이 `/metrics` 경로를 열어두기만 하면 된다. Push 방식(에이전트가 서버로 데이터를 전송)과의 차이: Pull 방식에서는 Prometheus가 타겟에 연결을 시도하다 실패하면 그 자체가 "타겟 다운" 신호가 되어 별도 헬스체크 없이 장애를 감지할 수 있다. 단기 배치 작업처럼 Prometheus 스크래핑 전에 종료될 수 있는 타겟은 Pushgateway를 경유해 메트릭을 Push한다(예외 케이스).

**오답 선지 이유:**
- A) Push 기반 — Prometheus의 기본 수집 방식이 아니다. InfluxDB·Graphite 같은 시스템이 Push 방식을 사용한다.
- C) 메시지 큐 기반 — Kafka·RabbitMQ 같은 메시지 브로커를 경유하는 방식이며, Prometheus는 사용하지 않는다.
- D) 파일 기반 — Prometheus에서 타겟 목록을 파일로 관리(`file_sd_config`)할 수 있지만, 메트릭 수집 자체가 파일 기반은 아니다.
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

GitOps는 Git 저장소를 Single Source of Truth로 사용하고 에이전트(ArgoCD·Flux)가 클러스터 상태를 Git 선언 상태에 자동 동기화하는 방식이다. SSH로 서버에 직접 접속해 수동으로 변경하면 Git 상태와 클러스터 실제 상태가 달라지는 드리프트가 발생하며, 이는 GitOps가 해결하려는 문제의 원인 자체이다.

**오답 선지 이유:**
- A) 선언적 설정 — GitOps의 핵심 원칙이다. "무엇을 원하는가"를 YAML로 선언하면 에이전트가 실현한다.
- B) Git을 단일 진실 소스로 사용 — GitOps의 핵심 원칙이다. 모든 변경은 Git PR/커밋을 통해야 한다.
- D) 에이전트에 의한 지속적 조정 — GitOps의 핵심 원칙이다. ArgoCD/Flux가 Reconciliation Loop를 실행해 드리프트를 자동 복원한다.
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

Helm v2에서는 Tiller라는 서버 컴포넌트가 클러스터 안에서 실행되며 Helm 클라이언트의 명령을 받아 K8s API를 호출했다. Tiller는 클러스터 전체 관리자(cluster-admin) 권한을 가져야 했으므로 보안 취약점이 됐다. Helm v3에서는 Tiller를 완전히 제거하고 클라이언트가 직접 kubeconfig 권한으로 K8s API를 호출한다. 이로써 최소 권한 원칙(Principle of Least Privilege)을 준수할 수 있게 됐다.

**오답 선지 이유:**
- A) JSON으로 변경 — Helm chart는 여전히 YAML을 사용한다.
- C) K8s 1.20 이상만 — Helm v3에 이런 버전 제한은 없다.
- D) Python으로 재작성 — Helm은 Go로 작성되어 있으며 변경되지 않았다.
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

블루/그린 배포는 구버전(Blue) 환경을 그대로 유지한 상태에서 신버전(Green) 환경을 별도로 준비한 뒤, 로드밸런서 또는 Service 셀렉터를 한 번에 전환해 트래픽을 넘기는 방식이다. 두 환경을 동시에 유지하므로 신버전에 문제가 생기면 셀렉터를 다시 Blue로 전환해 즉시 롤백할 수 있다.

**오답 선지 이유:**
- A) 롤링 업데이트 — 구버전 Pod를 하나씩 신버전으로 교체하는 방식이다. 두 버전이 동시에 실행되는 순간이 생기므로 "두 환경을 유지하고 한 번에 전환"이 아니다.
- C) 카나리 — 신버전에 일부 트래픽(예: 5~10%)만 먼저 보내 검증한 뒤 점진적으로 늘린다. 완전한 환경 전환이 아니다.
- D) Recreate — 구버전을 모두 종료한 뒤 신버전을 기동하는 방식으로, 두 환경을 동시에 유지하지 않는다.
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

> **정답 분포 주의:** 본 모의시험은 개념 학습 목적으로 설계되었으며 실제 시험의 정답 분포와 다르다. 특정 선지(B)가 상대적으로 많은 것은 핵심 개념(필터링→스코어링, Pull 방식, ClusterRole 등)이 B로 배치된 설계 때문이다. 실제 시험에서는 정답이 고르게 분포한다. 특정 선지를 찍는 전략으로 점수를 올리려 하지 말고, 각 선지가 왜 정답인지 이해하는 데 집중한다.

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

### 실습 전제 조건

실습을 시작하기 전 아래 사항을 모두 충족했는지 확인한다.

| 전제 조건 | 확인 방법 |
|----------|----------|
| 4개 tart VM이 모두 가동 중 | `./scripts/status.sh` 출력에서 모든 노드 `Ready` 확인 |
| IP 드리프트 복구 완료(재부팅 후) | `./scripts/fix-cluster-ip-drift.sh dev` 실행 후 `kubectl get nodes` 전부 Ready |
| kubeconfig 파일 4개 존재 | `ls ~/sideproejct/IaC_apple_sillicon/kubeconfig/` |
| SSH 별칭 동작 | `ssh dev-master hostname` 이 응답하면 정상 |

kubeconfig 경로는 `~/sideproejct/IaC_apple_sillicon/kubeconfig/<클러스터>.yaml`이며, 실습 3의 dev 클러스터에는 아래 선행 명령으로 demo 네임스페이스와 기본 리소스를 준비한다.

```bash
export KUBECONFIG=~/sideproejct/IaC_apple_sillicon/kubeconfig/dev.yaml
kubectl get namespace demo 2>/dev/null || kubectl create namespace demo
```

### 실습 환경 설정

```bash
# 4개 클러스터 kubeconfig 경로 확인
ls ~/sideproejct/IaC_apple_sillicon/kubeconfig/
# platform.yaml  dev.yaml  staging.yaml  prod.yaml
```

### 실습 1: 전체 클러스터 아키텍처 점검 (Fundamentals)

Day 1~2에서 학습한 컨테이너 런타임(runc·containerd)과 K8s 버전 개념을 실제 클러스터에서 확인한다. 4개 클러스터의 구성을 빠르게 확인하여 K8s 아키텍처 개념을 종합 복습한다.

```bash
# 각 클러스터 노드/버전 확인
for cluster in platform dev staging prod; do
  echo "=== $cluster ==="
  KUBECONFIG=~/sideproejct/IaC_apple_sillicon/kubeconfig/${cluster}.yaml kubectl get nodes -o custom-columns=NAME:.metadata.name,VERSION:.status.nodeInfo.kubeletVersion,RUNTIME:.status.nodeInfo.containerRuntimeVersion
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

검증 포인트:
- RUNTIME 컬럼에 `containerd://`가 표시되는지 확인한다. `docker://`가 표시되면 아직 dockershim을 사용하는 것이다.
- K8s v1.24 이상에서는 반드시 containerd 또는 CRI-O가 표시되어야 한다.

**동작 원리:** 모든 클러스터가 containerd 런타임을 사용한다(dockershim 제거, K8s v1.24+). kubeconfig 파일은 API Server 엔드포인트, 인증 정보, 컨텍스트를 포함하며, KUBECONFIG 환경 변수로 대상 클러스터를 전환한다.

### 실습 2: CNCF 프로젝트 & 관측성 스택 확인 (Architecture + Observability)

Day 7에서 학습한 Prometheus Pull 방식·Loki·OpenTelemetry 개념이 실제 platform 클러스터에 어떻게 배포되어 있는지 확인한다.

```bash
# platform 클러스터: 관측성 스택 확인
export KUBECONFIG=~/sideproejct/IaC_apple_sillicon/kubeconfig/platform.yaml

# Prometheus(Graduated) + Grafana + Loki 확인
kubectl get pods -n monitoring --no-headers | awk '{print $1}' | head -10

# Grafana 대시보드: http://localhost:30300
# → Prometheus 메트릭(Metrics), Loki 로그(Logs) 데이터소스 확인 가능

# dev 클러스터: Hubble(Cilium 관측성) 확인
export KUBECONFIG=~/sideproejct/IaC_apple_sillicon/kubeconfig/dev.yaml
kubectl get pods -n kube-system -l k8s-app=hubble-relay
```

**동작 원리:** 관측성의 3대 축은 Metrics(Prometheus), Logs(Loki), Traces(Jaeger)이다. platform 클러스터에 중앙 모니터링 스택을 배치하고, dev 클러스터에서 Hubble로 네트워크 플로우를 관측하는 구조이다.

**Prometheus Pull 방식:** Prometheus 서버가 각 타겟(노드 kubelet의 10250 포트 `/metrics` 엔드포인트, Pod에 붙은 exporter)을 주기적으로 직접 긁어(스크래핑) 메트릭을 수집한다. Push 방식(에이전트가 서버로 데이터를 보내는 방식)과 달리, 스크래핑 실패 자체가 "타겟 다운" 신호가 되므로 에이전트가 멈춰도 모니터링 누락을 자동으로 감지할 수 있다. 타겟 목록은 `ServiceMonitor`(Prometheus Operator CRD)로 선언적으로 관리한다. `kubectl get pods -n monitoring` 명령으로 prometheus-server, grafana, loki 파드가 Running 상태인지 확인할 수 있다. (실행 결과 - 미캡처)

**OpenTelemetry 역할:** OpenTelemetry(CNCF 인큐베이팅 단계 — Sandbox → Incubating → Graduated 중 두 번째)는 벤더 중립적 표준 SDK/API로, 메트릭·로그·트레이스를 단일 계측 코드로 수집한다. 수집한 데이터는 OpenTelemetry Collector를 통해 Prometheus(메트릭), Jaeger(트레이스), Grafana Loki(로그) 등 다양한 백엔드로 내보낼 수 있다. Prometheus처럼 특정 백엔드에 종속되지 않고 계측 코드를 한 번만 작성해 여러 백엔드를 교체할 수 있다는 점이 핵심이다.

### 실습 3: GitOps & Application Delivery 종합 확인 (Delivery)

Day 8에서 학습한 Helm v3(Tiller 제거)·ArgoCD·GitOps 원칙이 실제 클러스터에서 어떻게 동작하는지 확인한다.

```bash
# ArgoCD + Helm + 배포 전략 종합 확인
export KUBECONFIG=~/sideproejct/IaC_apple_sillicon/kubeconfig/platform.yaml

# ArgoCD Application 상태 요약
kubectl get applications -n argocd -o custom-columns=NAME:.metadata.name,SYNC:.status.sync.status,HEALTH:.status.health.status 2>/dev/null || echo "ArgoCD applications not found"

# Helm Release 전체 현황
helm list -A --output table 2>/dev/null | head -10

# dev 클러스터의 워크로드 종합 현황
export KUBECONFIG=~/sideproejct/IaC_apple_sillicon/kubeconfig/dev.yaml
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

---

## 시험 팁

1. **절대적 표현은 의심한다.** "항상", "유일하게", "반드시", "절대" 같은 표현이 포함된 선지는 반례가 있을 가능성이 높다. 예를 들어 "Liveness Probe는 항상 컨테이너를 재시작한다"는 틀렸다(Startup Probe가 아직 성공 전이면 Liveness가 비활성화된다).
2. **도구 이름과 개념(축·계층)을 혼동하지 않는다.** "관측성의 세 기둥"은 Metrics·Logs·Traces(개념)이지 Prometheus·Loki·Jaeger(도구)가 아니다. 시험은 종종 도구를 개념처럼 제시하는 선지를 오답으로 낸다.
3. **CNCF 성숙도 단계 암기 필수.** Sandbox → Incubating → Graduated 순서, Graduated 조건(보안 감사 완료·다수 프로덕션 사례·활성 커뮤니티)을 정확히 기억한다. CoreDNS·Prometheus·ArgoCD·Flux·Harbor 등 주요 Graduated 프로젝트 목록을 확인한다.
4. **"어떤 컴포넌트가 X를 하는가" 유형.** etcd와 직접 통신하는 것은 API Server만, 실제 컨테이너를 기동하는 것은 kubelet, 노드를 선택하는 것은 Scheduler, Reconciliation Loop를 돌리는 것은 Controller Manager다. 이 역할 분리를 표로 암기한다.
5. **오답 노트를 작성한다.** 틀린 문제는 선지를 고른 *이유*까지 기록해야 실전에서 같은 실수를 반복하지 않는다. 정답만 확인하면 비슷한 선지에서 또 틀린다.

---

## 더 읽을거리

- [CNCF 프로젝트 성숙도 전체 목록](https://www.cncf.io/projects/) — Graduated/Incubating/Sandbox 현황 공식 페이지
- [CNCF Due Diligence 기준(Graduation Criteria)](https://github.com/cncf/toc/blob/main/process/graduation_criteria.md) — TOC가 사용하는 심사 기준 원문
- [Kubernetes 공식 문서 — Persistent Volumes](https://kubernetes.io/docs/concepts/storage/persistent-volumes/#reclaiming) — Retain·Delete·Recycle 정책 상세
- [Kubernetes 공식 문서 — Configure Liveness, Readiness and Startup Probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/) — Probe 3종 동작 원리
- [Harbor 공식 문서](https://goharbor.io/docs/) — CNCF Graduated 프라이빗 레지스트리 공식 문서
- 이전 학습: [Day 8 — Helm·ArgoCD·GitOps](day08.md) | 다음 학습: [Day 10 — 최종 암기 카드 및 시험 전략](day10.md)
