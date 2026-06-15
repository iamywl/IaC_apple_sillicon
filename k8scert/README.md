# k8scert — Kubernetes 자격증

> Kubernetes 자격증 학습을 위한 참고 자료이다.
> 기술별 심화 학습은 [certification/](../certification/) 디렉토리를 참고한다.
> 프로젝트 학습은 [LEARN/](../LEARN/) 디렉토리를 참고한다.

---

## 자격증 개요

| 자격증 | 유형 | 문항/시간 | 합격 기준 | 비용 | 유효기간 | 선수조건 | 디렉토리 |
|--------|------|-----------|-----------|------|----------|----------|----------|
| KCNA | 이론 (객관식) | 60문항 / 90분 | 75% | $250 | 3년 | 없음 | [KCNA/](KCNA/) |
| KCSA | 이론 (객관식) | 60문항 / 90분 | 67% | $250 | 3년 | 없음 | [KCSA/](KCSA/) |
| CKA | 실기 (hands-on) | 15~20문항 / 120분 | 66% | $395 | 3년 | 없음 | [CKA/](CKA/) |
| CKAD | 실기 (hands-on) | 15~20문항 / 120분 | 66% | $395 | 3년 | 없음 | [CKAD/](CKAD/) |
| CKS | 실기 (hands-on) | 15~20문항 / 120분 | 67% | $395 | 2년 | CKA 필수 | [CKS/](CKS/) |

> 모든 시험에 **1회 무료 재응시(Retake)** 포함. PSI 플랫폼에서 온라인 감독관 방식으로 진행.

---

## 추천 취득 순서

```
Phase 1 (입문)          Phase 2 (실기)           Phase 3 (보안)
┌──────┐               ┌──────┐  ┌──────┐       ┌──────┐  ┌──────┐
│ KCNA │ ──────────────▶│ CKA  │──│ CKAD │──────▶│ KCSA │──│ CKS  │
└──────┘               └──────┘  └──────┘       └──────┘  └──────┘
 K8s 기초 이해          클러스터 관리  앱 개발     보안 이론   보안 실기
```

- **KCNA → CKA → CKAD → KCSA → CKS** 순서를 권장한다.
- CKA와 CKAD는 70% 이상 내용이 겹치므로 연속 취득이 효율적이다.
- CKS는 CKA 자격이 필수 선수조건이다.

---

## 통합 공부 스케줄 (12주)

> 하루 **3~4시간** 기준. 주말은 복습 + 모의시험. 실제 시험 일정에 맞춰 조정 가능.

### Phase 1: KCNA (1~2주)

| 주차 | 일 | 학습 내용 | 학습 자료 |
|------|-----|----------|-----------|
| 1주 | Day 1 | K8s 아키텍처 — Control Plane, Worker Node 구성 요소 | [KCNA/daily/day01](KCNA/daily/day01.md) |
| | Day 2 | K8s 아키텍처 — 통신 흐름, Static Pod, 포트 번호 | [KCNA/daily/day02](KCNA/daily/day02.md) |
| | Day 3 | 핵심 오브젝트 ① — Pod, Deployment, Service, DaemonSet, StatefulSet | [KCNA/daily/day03](KCNA/daily/day03.md) |
| | Day 4 | 핵심 오브젝트 ② — ConfigMap, Secret, RBAC, Ingress, PV/PVC | [KCNA/daily/day04](KCNA/daily/day04.md) |
| | Day 5 | 컨테이너 오케스트레이션 — namespace, cgroup, OCI, CRI/CNI/CSI | [KCNA/daily/day05](KCNA/daily/day05.md) |
| 2주 | Day 6 | 클라우드 네이티브 아키텍처 — CNCF, 마이크로서비스, 서비스 메시 | [KCNA/daily/day06](KCNA/daily/day06.md) |
| | Day 7 | Observability — Prometheus, Grafana, Loki, Jaeger | [KCNA/daily/day07](KCNA/daily/day07.md) |
| | Day 8 | App Delivery — GitOps, Helm, Kustomize, CI/CD | [KCNA/daily/day08](KCNA/daily/day08.md) |
| | Day 9 | **모의시험 50문항** + 오답 분석 | [KCNA/daily/day09](KCNA/daily/day09.md) |
| | Day 10 | 최종 복습 + 시험 전략 + 빠른 복습 퀴즈 | [KCNA/daily/day10](KCNA/daily/day10.md) |

### Phase 2: CKA (3~6주)

| 주차 | 일 | 학습 내용 | 학습 자료 |
|------|-----|----------|-----------|
| 3주 | Day 1 | 클러스터 아키텍처 — 컴포넌트, Static Pod | [CKA/daily/day01](CKA/daily/day01.md) |
| | Day 2 | etcd — 백업/복원, 스냅샷, HA 구성 | [CKA/daily/day02](CKA/daily/day02.md) |
| | Day 3 | kubeadm — init, join, 인증서 관리 | [CKA/daily/day03](CKA/daily/day03.md) |
| | Day 4 | 클러스터 업그레이드 — kubeadm upgrade 워크플로 | [CKA/daily/day04](CKA/daily/day04.md) |
| | Day 5 | RBAC ① — Role, ClusterRole, RoleBinding | [CKA/daily/day05](CKA/daily/day05.md) |
| 4주 | Day 6 | RBAC ② — ServiceAccount, kubeconfig 관리 | [CKA/daily/day06](CKA/daily/day06.md) |
| | Day 7 | 워크로드 — Deployment, RollingUpdate, Rollback | [CKA/daily/day07](CKA/daily/day07.md) |
| | Day 8 | 스케줄링 — nodeSelector, Affinity, Taint/Toleration | [CKA/daily/day08](CKA/daily/day08.md) |
| | Day 9 | 리소스 관리 — requests/limits, LimitRange, ResourceQuota | [CKA/daily/day09](CKA/daily/day09.md) |
| | Day 10 | 고급 워크로드 — DaemonSet, StatefulSet, Job, CronJob, HPA | [CKA/daily/day10](CKA/daily/day10.md) |
| 5주 | Day 11 | 서비스 — ClusterIP, NodePort, LB, Headless, DNS | [CKA/daily/day11](CKA/daily/day11.md) |
| | Day 12 | 네트워킹 — Ingress, NetworkPolicy, CNI | [CKA/daily/day12](CKA/daily/day12.md) |
| | Day 13 | 네트워킹 심화 — CoreDNS, kube-proxy, IPVS | [CKA/daily/day13](CKA/daily/day13.md) |
| | Day 14 | 네트워킹 실전 — 멀티클러스터 통신, 트러블슈팅 | [CKA/daily/day14](CKA/daily/day14.md) |
| | Day 15 | 스토리지 ① — Volume, PV, PVC, StorageClass | [CKA/daily/day15](CKA/daily/day15.md) |
| 6주 | Day 16 | 스토리지 ② — Dynamic Provisioning, 볼륨 확장 | [CKA/daily/day16](CKA/daily/day16.md) |
| | Day 17 | 트러블슈팅 ① — Pod, Node, Control Plane 진단 | [CKA/daily/day17](CKA/daily/day17.md) |
| | Day 18 | 트러블슈팅 ② — DNS, 인증서, 네트워크 디버깅 | [CKA/daily/day18](CKA/daily/day18.md) |
| | Day 19 | **모의시험 ①** — 전 도메인 종합 | [CKA/daily/day19](CKA/daily/day19.md) |
| | Day 20 | **모의시험 ②** + 오답 분석 + 시험 전략 | [CKA/daily/day20](CKA/daily/day20.md) |

### Phase 3: CKAD (7~8주)

| 주차 | 일 | 학습 내용 | 학습 자료 |
|------|-----|----------|-----------|
| 7주 | Day 1 | Pod 설계 — YAML 구조, 멀티컨테이너 패턴 | [CKAD/daily/day01](CKAD/daily/day01.md) |
| | Day 2 | 컨테이너 — Dockerfile, Init Container | [CKAD/daily/day02](CKAD/daily/day02.md) |
| | Day 3 | 볼륨 & Job — emptyDir, PVC, Job, CronJob | [CKAD/daily/day03](CKAD/daily/day03.md) |
| | Day 4 | 멀티컨테이너 — Sidecar, Ambassador, Adapter | [CKAD/daily/day04](CKAD/daily/day04.md) |
| | Day 5 | Deployment — RollingUpdate, Blue-Green, Canary | [CKAD/daily/day05](CKAD/daily/day05.md) |
| 8주 | Day 6 | 배포 도구 — Helm, Kustomize | [CKAD/daily/day06](CKAD/daily/day06.md) |
| | Day 7 | Rollout 관리 — history, undo, pause/resume | [CKAD/daily/day07](CKAD/daily/day07.md) |
| | Day 8 | Probe — Liveness, Readiness, Startup | [CKAD/daily/day08](CKAD/daily/day08.md) |
| | Day 9 | 로깅 & 디버깅 — logs, exec, top | [CKAD/daily/day09](CKAD/daily/day09.md) |
| | Day 10 | 모니터링 실전 — 사이드카 로깅, 리소스 모니터링 | [CKAD/daily/day10](CKAD/daily/day10.md) |
| | Day 11 | ConfigMap & Secret — 생성, 마운트, 환경변수 | [CKAD/daily/day11](CKAD/daily/day11.md) |
| | Day 12 | 보안 — SecurityContext, ServiceAccount, RBAC | [CKAD/daily/day12](CKAD/daily/day12.md) |
| | Day 13 | 네트워킹 — Service, Ingress, NetworkPolicy | [CKAD/daily/day13](CKAD/daily/day13.md) |
| | Day 14 | **모의시험** + 종합 복습 | [CKAD/daily/day14](CKAD/daily/day14.md) |

### Phase 4: KCSA (9~10주)

| 주차 | 일 | 학습 내용 | 학습 자료 |
|------|-----|----------|-----------|
| 9주 | Day 1 | 클라우드 네이티브 보안 개요 — 4C 모델, Defense in Depth | [KCSA/daily/day01](KCSA/daily/day01.md) |
| | Day 2 | 공급망 보안 — SBOM, 이미지 서명, SLSA, Trivy | [KCSA/daily/day02](KCSA/daily/day02.md) |
| | Day 3 | API Server 보안 — 인증, 인가, Admission Control | [KCSA/daily/day03](KCSA/daily/day03.md) |
| | Day 4 | CIS Benchmark — kube-bench, Static Pod, 보안 YAML | [KCSA/daily/day04](KCSA/daily/day04.md) |
| | Day 5 | RBAC 심화 — 4 리소스, 위험 verb, best practice | [KCSA/daily/day05](KCSA/daily/day05.md) |
| 10주 | Day 6 | NetworkPolicy & Secret — AND/OR 규칙, 암호화 | [KCSA/daily/day06](KCSA/daily/day06.md) |
| | Day 7 | MITRE ATT&CK & 런타임 보안 — Falco, 공급망 파이프라인 | [KCSA/daily/day07](KCSA/daily/day07.md) |
| | Day 8 | 네트워크 보안 — mTLS, 서비스 메시, 노드 하드닝 | [KCSA/daily/day08](KCSA/daily/day08.md) |
| | Day 9 | 감사 로깅 & 컴플라이언스 — Audit Policy, CIS, NIST | [KCSA/daily/day09](KCSA/daily/day09.md) |
| | Day 10 | **모의시험 50문항** + 최종 복습 | [KCSA/daily/day10](KCSA/daily/day10.md) |

### Phase 5: CKS (11~12주)

| 주차 | 일 | 학습 내용 | 학습 자료 |
|------|-----|----------|-----------|
| 11주 | Day 1 | Cluster Setup ① — NetworkPolicy 심화 | [CKS/daily/day01](CKS/daily/day01.md) |
| | Day 2 | Cluster Setup ② — kube-bench, TLS, 바이너리 검증 | [CKS/daily/day02](CKS/daily/day02.md) |
| | Day 3 | Cluster Hardening ① — RBAC, ServiceAccount 보안 | [CKS/daily/day03](CKS/daily/day03.md) |
| | Day 4 | Cluster Hardening ② — Audit Policy, kubeadm 업그레이드 | [CKS/daily/day04](CKS/daily/day04.md) |
| | Day 5 | System Hardening ① — AppArmor, seccomp | [CKS/daily/day05](CKS/daily/day05.md) |
| 12주 | Day 6 | System Hardening ② — Syscall, Capabilities, OS 최소화 | [CKS/daily/day06](CKS/daily/day06.md) |
| | Day 7 | Microservice 보안 ① — PSS, SecurityContext, OPA | [CKS/daily/day07](CKS/daily/day07.md) |
| | Day 8 | Microservice 보안 ② — Secret 암호화, RuntimeClass | [CKS/daily/day08](CKS/daily/day08.md) |
| | Day 9 | Supply Chain ① — Trivy, 이미지 스캐닝 | [CKS/daily/day09](CKS/daily/day09.md) |
| | Day 10 | Supply Chain ② — ImagePolicyWebhook, Dockerfile 보안 | [CKS/daily/day10](CKS/daily/day10.md) |
| | Day 11 | Runtime Security ① — Falco 아키텍처, 룰 작성 | [CKS/daily/day11](CKS/daily/day11.md) |
| | Day 12 | Runtime Security ② — Audit 로그 분석, 인시던트 대응 | [CKS/daily/day12](CKS/daily/day12.md) |
| | Day 13 | **모의시험 ①** — 12문항 종합 | [CKS/daily/day13](CKS/daily/day13.md) |
| | Day 14 | **모의시험 ②** + 시험 전략 | [CKS/daily/day14](CKS/daily/day14.md) |

---

## 자격증별 도메인 비중

### CKA — Certified Kubernetes Administrator

| 도메인 | 비중 | 핵심 키워드 |
|--------|------|-------------|
| Cluster Architecture, Installation & Configuration | 25% | kubeadm, etcd, RBAC, 업그레이드 |
| Workloads & Scheduling | 15% | Deployment, DaemonSet, Affinity, Taint |
| Services & Networking | 20% | Service, Ingress, NetworkPolicy, DNS |
| Storage | 10% | PV, PVC, StorageClass |
| Troubleshooting | 30% | Pod 디버깅, Node 진단, 로그 분석 |

### CKAD — Certified Kubernetes Application Developer

| 도메인 | 비중 | 핵심 키워드 |
|--------|------|-------------|
| Application Design and Build | 20% | Pod, Init Container, Sidecar, Job |
| Application Deployment | 20% | Deployment, Helm, Kustomize, Canary |
| Application Observability and Maintenance | 15% | Probe, 로깅, 디버깅 |
| Application Environment, Configuration and Security | 25% | ConfigMap, Secret, RBAC, SecurityContext |
| Services & Networking | 20% | Service, Ingress, NetworkPolicy |

### CKS — Certified Kubernetes Security Specialist

| 도메인 | 비중 | 핵심 키워드 |
|--------|------|-------------|
| Cluster Setup | 10% | NetworkPolicy, kube-bench, TLS |
| Cluster Hardening | 15% | RBAC, ServiceAccount, API Server |
| System Hardening | 15% | AppArmor, seccomp, OS 최소화 |
| Minimize Microservice Vulnerabilities | 20% | PSS/PSA, OPA, Secret 암호화, RuntimeClass |
| Supply Chain Security | 20% | Trivy, ImagePolicy, Dockerfile |
| Monitoring, Logging & Runtime Security | 20% | Falco, Audit Policy, 컨테이너 불변성 |

### KCNA — Kubernetes and Cloud Native Associate

| 도메인 | 비중 | 핵심 키워드 |
|--------|------|-------------|
| Kubernetes Fundamentals | 46% | 아키텍처, 오브젝트, Service, RBAC |
| Container Orchestration | 22% | namespace, cgroup, OCI, CRI |
| Cloud Native Architecture | 16% | CNCF, 마이크로서비스, 서비스 메시 |
| Cloud Native Observability | 8% | Prometheus, Grafana, Loki |
| Cloud Native Application Delivery | 8% | GitOps, Helm, Kustomize |

### KCSA — Kubernetes and Cloud Native Security Associate

| 도메인 | 비중 | 핵심 키워드 |
|--------|------|-------------|
| Overview of Cloud Native Security | 14% | 4C 모델, STRIDE |
| Kubernetes Cluster Component Security | 22% | API Server, etcd, kubelet |
| Kubernetes Security Fundamentals | 22% | PSS/PSA, RBAC, NetworkPolicy |
| Kubernetes Threat Model | 16% | MITRE ATT&CK, 공급망 보안 |
| Platform Security | 16% | Falco, seccomp, AppArmor, CNI |
| Compliance and Security Frameworks | 10% | CIS Benchmark, NIST, SOC 2 |

---

## 각 자격증 디렉토리 구조

```
{자격증}/
├── README.md                   ← 시험 개요, 도메인, 팁
├── 01-concepts.md              ← 개념 정리 (이론)
├── 02-examples.md              ← YAML 예제 + 명령어 모음
├── 03-exam-questions.md        ← 모의시험 문제 + 풀이
├── 04-tart-infra-practice.md   ← tart-infra 환경 실습
├── 05-supplement.md            ← 보충 자료 (트러블슈팅·심화)
└── daily/
    └── day01~dayNN.md          ← 일별 학습 가이드
```

### 무엇을 어디서 찾는가 (개념·예제·실행·기출)

각 자격증 폴더의 5개 파일은 **하나의 실습 루프**를 이룬다. "개념을 읽고 → 예제 YAML을 보고 → 클러스터에서 실행해 출력을 확인하고 → 기출로 점검한다."

| 원하는 것 | 보는 파일 | 내용 |
|-----------|-----------|------|
| **개념 설명** (왜 등장했나·내부 동작) | `01-concepts.md` | 컴포넌트·오브젝트 원리, 커널/OS 레벨 메커니즘 |
| **YAML 파일 / 명령어 예제** | `02-examples.md` | 복붙 가능한 매니페스트 + `kubectl` 명령 모음 |
| **실행 방법 / 실측 출력(스샷)** | `04-tart-infra-practice.md` | tart 클러스터에서 직접 실행하는 시나리오 + 기대 출력(```text 블록) |
| **기출 / 모의시험 문제** | `03-exam-questions.md` | 시험 유형 문제 + 단계별 풀이 |
| **트러블슈팅 / 심화** | `05-supplement.md` | 장애 시나리오·복구·추가 주제 |
| **하루치 학습 코스** | `daily/dayNN.md` | 위 내용을 날짜별로 묶은 가이드 |

### 실습 빠른 시작 (5분)

```bash
# 0) 노드 SSH 키 배포(최초 1회) — CKA/CKS 노드 실습용
./scripts/setup-ssh-keys.sh dev

# 1) 클러스터 기동 + 상태 확인
./scripts/boot.sh
./scripts/status.sh

# 2) kubeconfig 지정 후 실습 (예: dev 클러스터)
export KUBECONFIG=$(pwd)/kubeconfig/dev.yaml
kubectl get nodes
```
> 검증 기준: 모든 노드의 `STATUS`가 `Ready`이고 `dev-master`는 `control-plane`, `dev-worker1`은 `<none>` 역할로 표시되면 정상이다. 실제 출력 화면은 각 자격증 문서의 실측 터미널 캡처(§4①)로 확인한다.
```bash
# 3) 예제 적용 → 4) 검증 → 5) 정리
kubectl create deploy web --image=nginx --replicas=2
kubectl get pods -o wide        # 실측 출력 확인(=스샷 대용 증거)
kubectl delete deploy web
```

> 권장 루프: `01-concepts`로 개념 → `02-examples`의 YAML을 dev/staging에서 `kubectl apply` → `04-tart-infra-practice` 시나리오로 손에 익히기 → `03-exam-questions`로 점검. **파괴적 실습은 dev/staging에서만** 한다(platform/prod는 읽기 위주).

---

## 실습 환경 구성

이 프로젝트의 tart-infra를 활용하면 로컬 Mac에서 실제 멀티클러스터 K8s 환경으로 실습할 수 있다.

### 공부할 때 매번 하는 일 (요약 — 먼저 읽기)

헷갈리기 쉬운 점: **"설치"와 "기동"은 다르다. 공부할 때마다 클러스터를 새로 세팅하지 않는다.**

| 상황 | 명령 | 빈도 |
|------|------|------|
| 최초 환경 구축(설치) | `./scripts/install.sh` (VM 생성 + kubeadm + CNI) | **딱 1회** |
| 공부 시작 — VM이 꺼져 있을 때 | `./scripts/boot.sh` (기동 + IP 드리프트 자동 복구) | VM이 꺼졌을 때만 |
| VM을 안 껐을 때 | (아무것도 안 함) 바로 `kubectl` | — |
| 깨졌을 때 깨끗이 다시 | `./scripts/reset-cluster.sh <클러스터>` | 필요 시 |

- **설치는 최초 1회뿐**이다. 이후엔 클러스터를 다시 만들 필요가 없다.
- VM은 Mac을 재부팅/로그아웃하거나 `shutdown-all.sh`를 돌리면 꺼진다. 그때만 **`boot.sh` 한 번**이면 IP 드리프트 복구까지 끝난다.
- 즉 일상 루틴은 **"꺼져 있으면 `boot.sh`, 켜져 있으면 바로 `kubectl`"** 이다.

### 이 환경의 동작 방식 (먼저 읽기)

- **전부 tart 기반이다.** 별도 도구(Docker/kind) 없이, tart VM 12대(`platform`·`dev`·`staging`·`prod`·`cks`)가 곧 실습용 K8s 노드다. 생성·기동·종료·IP 조회 모두 `tart` 명령을 감싼 `scripts/`로 한다. SSH 접속도 `ssh dev-master`의 `ProxyCommand`가 접속 시점에 `tart ip`로 IP를 조회하므로, **재부팅으로 IP가 바뀌어도 그대로 동작한다.**
- **재부팅 후에는 반드시 `./scripts/boot.sh`로 올린다.** kubeadm 클러스터는 최초 init 시점 IP에 묶여 있는데 tart는 재부팅마다 IP를 바꾼다(IP 드리프트). `boot.sh`는 VM 기동 후 **IP 드리프트를 자동 복구**한다 — apiserver 인증서·kubeconfig 재생성(`boot/02-wait-clusters.sh`)에 더해, `boot/`에 빠져 있던 나머지 결함까지 `fix-cluster-ip-drift.sh`(Phase 2.5)가 멱등 교정한다. `tart run`으로 VM만 켜면 복구가 안 돼 `kubectl`이 `i/o timeout` 난다.

  ```bash
  ./scripts/boot.sh        # VM 기동 + IP 드리프트 전체 자동 복구 + kubeconfig 갱신
  ./scripts/status.sh      # 노드/서비스 상태 확인
  ```
- **메모리에 주의한다.** 4개 클러스터를 동시에 띄우면 요청 메모리 합이 약 **68GB**다(이 Mac 128GB). 자격증 하나만 실습할 때는 전부 띄울 필요가 없다.

  ```bash
  ./scripts/shutdown-all.sh          # 전체 VM 종료(데이터는 유지)

  # 필요한 클러스터만 골라서 사용 (예: dev 2노드 = 12GB)
  tart run dev-master  --no-graphics &
  tart run dev-worker1 --no-graphics &
  ./scripts/setup-ssh-keys.sh --no-boot dev   # 켜진 노드에 SSH 키/별칭만 갱신
  # ※ 단일 클러스터 기동 후에도 IP 드리프트 복구가 필요하면 ./scripts/boot.sh 를 한 번 돌린다.
  ```
- **파괴적 실습은 `dev`/`staging`에서만.** `platform`(Prometheus·Grafana·ArgoCD·Jenkins 상주)·`prod`는 읽기 위주로 둔다.
- **`cks`는 CKS/KCSA 보안 실습 전용 랩이다.** Falco·Kyverno·Trivy·gVisor 같은 보안 도구를 설치해 두고 마음껏 부수는 용도로, 다른 4개 클러스터와 분리돼 있어 일반 실습에 영향을 주지 않는다. 처음 만들 때는 `./scripts/reset-cluster.sh --yes cks`(이후 `boot.sh`가 함께 기동). 노드는 `cks-master`·`cks-worker1`, kubeconfig는 `kubeconfig/cks.yaml`.

### 클러스터가 깨졌을 때 — 복구 또는 재생성

재부팅 후 `kubectl`이 `i/o timeout` 나거나, 노드는 `Ready`인데 파드가 `ContainerCreating`/DNS가 안 되면 IP 드리프트가 원인이다. 두 가지 방법이 있다.

| 명령 | 하는 일 | 데이터 | 소요 | 언제 |
|------|---------|--------|------|------|
| `./scripts/boot.sh` | VM 기동 + IP 드리프트 **자동 복구** | 보존 | 수 분 | 평소 재부팅 후 항상 |
| `./scripts/fix-cluster-ip-drift.sh [클러스터]` | 켜져 있는 클러스터만 드리프트 **복구**(데이터 유지) | 보존 | 1~2분/클러스터 | VM은 떠 있는데 깨졌을 때 |
| `./scripts/reset-cluster.sh [클러스터]` | VM째 **완전 삭제 후 새로 생성**(현재 IP로 fresh init → 드리프트 원천 차단) | **삭제** | 5~8분/노드 | 복구가 꼬이거나 깨끗이 다시 시작할 때 **(가장 단순·확실)** |

```bash
# 권장: 자격증 실습은 한 클러스터면 충분. 깨졌으면 그냥 깨끗하게 다시 만든다.
./scripts/reset-cluster.sh dev          # dev 완전 재생성(확인 프롬프트)
./scripts/reset-cluster.sh --yes dev    # 확인 없이
./scripts/reset-cluster.sh all          # 전체(오래 걸림)

# 데이터를 살리고 싶으면 복구만
./scripts/fix-cluster-ip-drift.sh dev
```

> `reset-cluster.sh`는 모니터링/CI 같은 무거운 스택 없이 **K8s + CNI(Cilium)만** 깔아 빠르다. `kubeadm init`·Cilium 설치가 모두 *현재 IP*로 수행되므로 새로 만든 클러스터는 IP 드리프트가 발생하지 않는다. 재생성 후 노드 SSH가 필요하면 `./scripts/setup-ssh-keys.sh --no-boot dev`.

#### IP 드리프트가 깨뜨리는 4가지 (참고)

`boot.sh`/`fix-cluster-ip-drift.sh`가 자동 교정하는 항목이다. 수동 디버깅 시 참고:

1. **apiserver 인증서 SAN** — 실제 service-CIDR의 kubernetes SVC IP(dev `10.97.0.1`, staging `10.98.0.1`, prod `10.99.0.1`)가 빠지면 CoreDNS가 API 인증서 검증에 실패해 `Ready`가 안 된다.
2. **control-plane 정적 파드** — `controller-manager`/`scheduler`가 옛 IP로 리더 선출을 시도하면 DaemonSet/Deployment가 reconcile되지 않는다(재기동 필요).
3. **worker `kubelet.conf`** — 옛 master IP를 가리키면 worker가 `NotReady`.
4. **Cilium `KUBERNETES_SERVICE_HOST`** — 옛 master IP가 하드코딩되면(kube-proxy 대체 모드) CNI가 죽어 파드가 안 뜬다.

### 방법 1: tart-infra 환경 (권장)

이 프로젝트 자체가 4개 K8s 클러스터를 자동 구축한다. CKA/CKAD/CKS 실기 시험과 동일한 환경이다.

```bash
# 1. 전체 인프라 설치 (10대 VM + 4개 클러스터 + 모니터링 + CI/CD)
./scripts/install.sh

# 2. 클러스터 상태 확인
./scripts/status.sh

# 3. kubeconfig 설정 — 4개 클러스터 전환 가능
export KUBECONFIG=$(pwd)/kubeconfig/platform.yaml
kubectl get nodes

# 4. 다른 클러스터로 전환 (시험처럼 context 전환 연습)
export KUBECONFIG=$(pwd)/kubeconfig/dev.yaml
kubectl get nodes
```

| 클러스터 | 노드 수 | 용도 | kubeconfig |
|----------|---------|------|------------|
| platform | 3 (1M+2W) | Prometheus, Grafana, Jenkins, ArgoCD | `kubeconfig/platform.yaml` |
| dev | 2 (1M+1W) | 데모 앱, Canary 배포, HPA 실습 | `kubeconfig/dev.yaml` |
| staging | 2 (1M+1W) | NetworkPolicy, RBAC 실습 | `kubeconfig/staging.yaml` |
| prod | 3 (1M+2W) | StatefulSet, PDB, 트러블슈팅 실습 | `kubeconfig/prod.yaml` |

```bash
# 실습 후 인프라 종료 (VM은 유지, 리소스만 해제)
./scripts/shutdown-all.sh

# 다시 시작
./scripts/boot.sh

# 완전 삭제 (VM 포함)
./scripts/destroy.sh
```

각 자격증 디렉토리의 `04-tart-infra-practice.md`에 클러스터별 실습 시나리오가 정리되어 있다.

#### SSH 키 배포 및 노드 접속 (CKA·CKS 노드 레벨 실습용)

CKA의 etcd 백업/복구·kubeadm 업그레이드, CKS의 AppArmor·seccomp·Falco 실습은 노드에 직접 SSH로 들어가야 한다. 기본 인증은 `admin/admin` 비밀번호이지만, 매번 비밀번호를 입력하지 않도록 **전용 SSH 키를 전 노드에 배포**하는 스크립트를 제공한다.

```bash
# 전용 키 생성 + 전 노드(authorized_keys)에 배포 + ~/.ssh/config 자동 등록
./scripts/setup-ssh-keys.sh                 # 모든 클러스터(platform/dev/staging/prod)
./scripts/setup-ssh-keys.sh dev staging     # 지정 클러스터만
./scripts/setup-ssh-keys.sh --no-boot dev   # 이미 켜진 노드만(부팅 안 함)

# 배포 후: 비밀번호 없이 VM 이름으로 바로 접속
ssh dev-master
ssh staging-worker1
```

검증: `ssh -o BatchMode=yes dev-master 'hostname; whoami'`가 비밀번호 프롬프트 없이 실행되어 노드 hostname(`dev-master`)과 사용자(`admin`)를 출력하면 키 배포가 정상이다. `BatchMode=yes`는 키 인증이 실패하면 즉시 종료하므로(비밀번호로 fallback 하지 않음) 키 기반 접속 여부를 명확히 가린다.

**SSH 키 ↔ 호스트 매핑.** 노드는 전부 **하나의 전용 키**(`~/.ssh/tart_k8scert`)를 공유하며, `~/.ssh/config`의 관리 블록에 VM 이름이 그대로 Host 별칭으로 등록된다. IP는 `ProxyCommand`가 접속 시점에 `tart ip <vm>`로 조회하므로 **재부팅으로 IP가 바뀌어도 재설정이 필요 없다**.

| Host 별칭 (`ssh <별칭>`) | 클러스터 | 역할 | 사용자 | 개인키 파일 |
|--------------------------|----------|------|--------|-------------|
| `platform-master` | platform | master | admin | `~/.ssh/tart_k8scert` |
| `platform-worker1` / `platform-worker2` | platform | worker | admin | `~/.ssh/tart_k8scert` |
| `dev-master` | dev | master | admin | `~/.ssh/tart_k8scert` |
| `dev-worker1` | dev | worker | admin | `~/.ssh/tart_k8scert` |
| `staging-master` | staging | master | admin | `~/.ssh/tart_k8scert` |
| `staging-worker1` | staging | worker | admin | `~/.ssh/tart_k8scert` |
| `prod-master` | prod | master | admin | `~/.ssh/tart_k8scert` |
| `prod-worker1` / `prod-worker2` | prod | worker | admin | `~/.ssh/tart_k8scert` |

| 파일 | 용도 |
|------|------|
| `~/.ssh/tart_k8scert` | 전 노드 공용 **개인키**(SSH 접속 시 사용) |
| `~/.ssh/tart_k8scert.pub` | 전 노드 `authorized_keys`에 배포되는 **공개키** |
| `~/.ssh/config` (관리 블록 `>>> tart-k8scert managed >>>`) | Host 별칭 + ProxyCommand 정의. 스크립트가 자동 갱신(이전 내용은 `~/.ssh/config.bak.tart`로 백업) |

> 참고: 인프라 설치 자동화(`scripts/install/*`)는 그대로 `admin/admin` 비밀번호(`sshpass`)를 쓴다. SSH 키는 **수동 실습 접속 편의용**이며 자동화 동작을 바꾸지 않는다.

### 방법 2: kind (간단 실습)

단일 노드로 빠르게 실습하고 싶은 경우 kind를 사용한다.

```bash
# kind 설치
brew install kind

# 클러스터 생성 (단일 노드)
kind create cluster --name cka-practice

# 멀티 노드 (CKA 스케줄링, Taint/Toleration 실습용)
cat <<EOF | kind create cluster --name cka-multi --config=-
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
nodes:
- role: control-plane
- role: worker
- role: worker
- role: worker
EOF

# 검증
kubectl get nodes
# 예상 출력:
# NAME                      STATUS   ROLES           AGE   VERSION
# cka-multi-control-plane   Ready    control-plane   60s   v1.31.0
# cka-multi-worker          Ready    <none>          30s   v1.31.0
# cka-multi-worker2         Ready    <none>          30s   v1.31.0
# cka-multi-worker3         Ready    <none>          30s   v1.31.0

# 삭제
kind delete cluster --name cka-practice
kind delete cluster --name cka-multi
```

### 방법 3: killer.sh (시험 직전 필수)

시험 구매 시 killer.sh 모의시험 2회가 무료 제공된다. 실제 시험과 동일한 PSI 브라우저 환경에서 연습할 수 있다.

- 시험 36시간 전 활성화 가능하다.
- 실제 시험보다 난이도가 높으므로 killer.sh에서 70% 이상이면 실제 시험은 합격권이다.
- CKA, CKAD, CKS 각각 별도의 killer.sh 세션이 제공된다.

### 실습 시 필수 셸 설정

시험 환경과 동일하게 미리 손에 익혀야 하는 설정이다.

```bash
# ~/.bashrc 또는 ~/.zshrc에 추가
alias k=kubectl
alias kn='kubectl config set-context --current --namespace'
alias kx='kubectl config use-context'

# 자동완성
source <(kubectl completion bash)   # bash
source <(kubectl completion zsh)    # zsh
complete -o default -F __start_kubectl k

# dry-run 단축
export do="--dry-run=client -o yaml"
# 사용법: k run nginx --image=nginx $do > pod.yaml

# 빠른 삭제
export now="--force --grace-period=0"
# 사용법: k delete pod nginx $now
```

```bash
# 검증: alias가 동작하는지 확인
k get nodes
# kubectl get nodes와 동일한 출력이 나오면 정상이다

k run test --image=nginx $do
# YAML이 stdout에 출력되면 정상이다
```

### 자격증별 실습 방법

| 자격증 | 실습 환경 | 실습 파일 | 핵심 실습 내용 |
|--------|-----------|-----------|---------------|
| KCNA | 불필요 (이론) | `04-tart-infra-practice.md` | kubectl 명령어로 구조 확인 |
| KCSA | 불필요 (이론) | `04-tart-infra-practice.md` | RBAC, NetworkPolicy, Audit 설정 확인 |
| CKA | **tart-infra 또는 kind** | `04-tart-infra-practice.md` | etcd 백업/복원, kubeadm 업그레이드, RBAC, 트러블슈팅 |
| CKAD | **tart-infra 또는 kind** | `04-tart-infra-practice.md` | Deployment, Probe, ConfigMap, Ingress, NetworkPolicy |
| CKS | **tart-infra 필수** | `04-tart-infra-practice.md` | AppArmor, seccomp, Falco, OPA, Trivy, Audit Policy |

> CKS는 노드 레벨 보안(AppArmor, seccomp, Falco)을 다루므로 SSH 접근이 가능한 tart-infra 환경이 필수이다.
> kind는 Docker 컨테이너 기반이므로 노드 SSH 접근이 제한된다.

---

## 학습 팁

1. **kubectl 속도가 합격을 결정한다** — `alias k=kubectl`, `--dry-run=client -o yaml` 을 손에 익혀라.
2. **공식 문서(kubernetes.io)가 시험장에서 유일한 참고 자료**다 — 문서 탐색 속도를 연습하라.
3. **killer.sh** 모의시험을 반드시 풀어라 — 시험 구매 시 2회 무료 제공된다.
4. **시간 관리** — 어려운 문제는 플래그 걸고 넘어가라. 쉬운 문제부터 확실하게 풀어라.
5. **context 전환을 잊지 마라** — 문제마다 `kubectl config use-context` 확인이 필수다.
6. **tart-infra로 매일 30분 이상 실습하라** — 이론만으로는 실기 시험에 합격할 수 없다.
