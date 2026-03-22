# 03. 오픈소스 도구 분석

이 프로젝트에서 사용된 16개 오픈소스 도구를 **역할별로 분류**하고, 각각 왜 선택했는지 설명합니다.

---

## 도구 간 관계도

```
┌─────────────────────────────────────────────────────────────────┐
│                        Mac (호스트)                               │
│                                                                 │
│  ┌─────────┐  ┌───────────┐  ┌──────────────────────────────┐  │
│  │  Tart   │  │ Terraform │  │      Helm v3                 │  │
│  │ (VM런타임)│  │  (IaC)    │  │   (K8s 패키지 매니저)          │  │
│  └────┬────┘  └─────┬─────┘  └──────────┬───────────────────┘  │
│       │             │                    │                      │
│  ┌────▼──────────────▼────────────────────▼──────────────────┐  │
│  │              Kubernetes v1.31 (kubeadm)                   │  │
│  │                                                           │  │
│  │  ┌──────────────┐  ┌──────────────────────────────────┐  │  │
│  │  │ containerd   │  │  Cilium (eBPF CNI)               │  │  │
│  │  │ (컨테이너런타임)│  │   ├── kube-proxy 대체             │  │  │
│  │  └──────────────┘  │   └── Hubble (네트워크 옵저버빌리티) │  │  │
│  │                    └──────────────────────────────────┘  │  │
│  │                                                           │  │
│  │  ┌── 모니터링 ────────────────────────────────────────┐  │  │
│  │  │  Prometheus ──→ Grafana (시각화)                    │  │  │
│  │  │  Loki + Promtail ──→ Grafana (로그)                │  │  │
│  │  │  AlertManager ──→ webhook-logger (알림)            │  │  │
│  │  │  metrics-server ──→ HPA (오토스케일링)              │  │  │
│  │  └────────────────────────────────────────────────────┘  │  │
│  │                                                           │  │
│  │  ┌── CI/CD ──────────┐  ┌── 서비스 메시 ──────────────┐  │  │
│  │  │  ArgoCD (GitOps)  │  │  Istio + Envoy              │  │  │
│  │  │  Jenkins (CI)     │  │  (mTLS, 카나리, 서킷브레이커) │  │  │
│  │  └───────────────────┘  └─────────────────────────────┘  │  │
│  │                                                           │  │
│  │  ┌── 테스팅 ─────────┐                                    │  │
│  │  │  k6 (HTTP 부하)   │                                    │  │
│  │  │  stress-ng (시스템)│                                    │  │
│  │  └───────────────────┘                                    │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 1. 인프라 계층

### Tart — VM 런타임

| 항목 | 내용 |
|------|------|
| **한 줄 설명** | Apple Silicon Mac에서 ARM64 Linux VM을 네이티브로 실행하는 도구 |
| **선택 이유** | Apple Hypervisor.framework 직접 사용, CLI 자동화 친화적, softnet 네트워킹 지원 |
| **대안** | Lima (QEMU 기반, 느림), UTM (GUI 중심, 자동화 어려움), Vagrant+VirtualBox (ARM 미지원) |
| **프로젝트 내 위치** | `scripts/lib/vm.sh` (VM 수명주기 함수), `terraform/modules/tart-vm/` |
| **주요 명령어** | `tart clone`, `tart set`, `tart run --net-softnet-allow`, `tart ip`, `tart stop` |

### containerd — 컨테이너 런타임

| 항목 | 내용 |
|------|------|
| **한 줄 설명** | Kubernetes가 컨테이너를 실행할 때 사용하는 CRI(Container Runtime Interface) 구현체 |
| **선택 이유** | Kubernetes 1.24부터 Docker 지원 제거, containerd가 사실상 표준. CNCF 졸업 프로젝트 |
| **대안** | CRI-O (Red Hat 계열에서 주로 사용), Docker (dockershim 제거됨) |
| **프로젝트 내 위치** | `scripts/lib/k8s.sh` → `install_containerd()` |
| **핵심 설정** | `SystemdCgroup = true` (kubelet과 cgroup 드라이버 일치 필수) |

### Kubernetes (kubeadm) — 컨테이너 오케스트레이션

| 항목 | 내용 |
|------|------|
| **한 줄 설명** | 컨테이너화된 애플리케이션의 배포, 확장, 관리를 자동화하는 플랫폼 |
| **버전** | v1.31 |
| **선택 이유** | 사실상 업계 표준. kubeadm은 Kubernetes 공식 클러스터 부트스트래핑 도구 |
| **대안** | k3s (경량, 내부 동작 숨김), kind (테스트 전용), EKS/GKE (클라우드 종속) |
| **프로젝트 내 위치** | `scripts/lib/k8s.sh` → `install_kubeadm()`, `init_cluster()` |

### Terraform — Infrastructure as Code

| 항목 | 내용 |
|------|------|
| **한 줄 설명** | 인프라를 코드로 정의하고 선언적으로 관리하는 도구 |
| **버전** | >= 1.5 |
| **선택 이유** | 상태 파일로 현재 인프라 추적, `plan`으로 변경 사항 미리 확인, 의존성 자동 해결 |
| **대안** | Pulumi (프로그래밍 언어 사용), Ansible (구성 관리 중심), CloudFormation (AWS 전용) |
| **프로젝트 내 위치** | `terraform/` 디렉토리 전체 |
| **특이사항** | Tart용 공식 Provider가 없어서 `null_resource` + `local-exec`로 CLI 래핑 |

### Helm — Kubernetes 패키지 매니저

| 항목 | 내용 |
|------|------|
| **한 줄 설명** | Kubernetes 애플리케이션을 패키지(차트)로 만들어 설치/업그레이드/삭제하는 도구 |
| **선택 이유** | 복잡한 K8s 매니페스트를 values.yaml 하나로 커스터마이징. 모든 CNCF 프로젝트가 Helm 차트 제공 |
| **대안** | Kustomize (패치 기반, 차트 없음), 직접 kubectl apply (관리 어려움) |
| **프로젝트 내 위치** | `manifests/*.yaml` (values 파일), `scripts/lib/k8s.sh` (helm 명령), `terraform/modules/helm-releases/` |

---

## 2. 네트워킹 계층

### Cilium — CNI + kube-proxy 대체

| 항목 | 내용 |
|------|------|
| **한 줄 설명** | eBPF 기반 네트워킹, 보안, 옵저버빌리티를 통합 제공하는 Kubernetes CNI |
| **선택 이유** | kube-proxy까지 대체 (eBPF로 iptables 제거), L7 네트워크 정책, Hubble 내장 |
| **대안** | Calico (iptables/BGP 기반, L7 미지원), Flannel (단순 오버레이, 정책 미지원), Weave (성능 낮음) |
| **프로젝트 내 위치** | `manifests/cilium-values.yaml`, `scripts/lib/k8s.sh` → `install_cilium()` |
| **핵심 설정** | `kubeProxyReplacement: true`, `ipam.mode: cluster-pool` |
| **CNCF 등급** | Graduated (졸업) — 프로덕션 준비 완료 |

### Hubble — 네트워크 옵저버빌리티

| 항목 | 내용 |
|------|------|
| **한 줄 설명** | Cilium 위에서 동작하는 네트워크 흐름 관찰 도구. DNS, TCP, HTTP 레벨 메트릭 제공 |
| **선택 이유** | Cilium에 내장 (추가 설치 불필요), relay+UI로 시각화, 대시보드에서 트래픽 맵에 활용 |
| **대안** | Weave Scope (단종), Pixie (무거움), 직접 tcpdump (비현실적) |
| **프로젝트 내 위치** | `manifests/hubble-values.yaml`, `scripts/lib/k8s.sh` → `install_hubble()` |
| **핵심 설정** | relay + UI 활성화, NodePort 31235, 메트릭: dns/drop/tcp/flow/icmp/http |

### Istio (+ Envoy) — 서비스 메시

| 항목 | 내용 |
|------|------|
| **한 줄 설명** | 마이크로서비스 간 통신을 제어하는 서비스 메시. 사이드카 프록시(Envoy)로 트래픽 관리 |
| **선택 이유** | mTLS 자동 암호화, 카나리 배포(트래픽 분할), 서킷 브레이커 패턴 구현 |
| **대안** | Linkerd (경량, 기능 적음), Cilium Service Mesh (아직 성숙하지 않음), Consul Connect (HashiCorp) |
| **프로젝트 내 위치** | `manifests/istio/` (7개 매니페스트), `scripts/install/12-install-istio.sh` |
| **적용 범위** | dev 클러스터의 demo 네임스페이스에만 적용 (실험적) |
| **핵심 기능** | 카나리: v1 80% / v2 20% 트래픽 분할, 서킷 브레이커: 5xx 3번 → 30초 차단 |

---

## 3. 모니터링 계층

### Prometheus — 메트릭 수집/저장

| 항목 | 내용 |
|------|------|
| **한 줄 설명** | Pull 방식으로 메트릭을 수집하고 시계열 DB에 저장하는 모니터링 시스템 |
| **선택 이유** | Kubernetes 모니터링의 사실상 표준. CNCF 졸업 프로젝트. kube-prometheus-stack으로 한 번에 설치 |
| **대안** | Datadog/New Relic (유료 SaaS), Victoria Metrics (호환 대안), Thanos (장기 저장) |
| **프로젝트 내 위치** | `manifests/monitoring-values.yaml`, `scripts/install/07-install-monitoring.sh` |
| **핵심 설정** | 7일 보존, 10Gi 스토리지, NodePort 30903 |
| **CNCF 등급** | Graduated |

### Grafana — 시각화 대시보드

| 항목 | 내용 |
|------|------|
| **한 줄 설명** | 메트릭과 로그를 시각화하는 대시보드 플랫폼 |
| **선택 이유** | Prometheus/Loki와 네이티브 통합, 3개 프리셋 대시보드 자동 프로비저닝 |
| **대안** | Kibana (Elasticsearch 전용), Chronograf (InfluxDB 전용) |
| **프로젝트 내 위치** | `manifests/monitoring-values.yaml` 내 grafana 섹션 |
| **접속** | NodePort 30300, ID/PW: admin/admin |
| **프로비저닝된 대시보드** | Kubernetes Cluster, Node Exporter, Pod Monitoring |

### Loki + Promtail — 로그 수집

| 항목 | 내용 |
|------|------|
| **한 줄 설명** | "Prometheus처럼 동작하는 로그 수집 시스템". Promtail이 로그를 수집하고 Loki가 저장 |
| **선택 이유** | Grafana에서 메트릭(Prometheus)과 로그(Loki)를 하나의 UI에서 볼 수 있음 |
| **대안** | ELK Stack (Elasticsearch+Logstash+Kibana — 무겁고 리소스 많이 필요), Fluentd |
| **프로젝트 내 위치** | `manifests/loki-values.yaml`, `scripts/install/07-install-monitoring.sh` |
| **핵심 설정** | persistence 없음 (학습 환경이므로 재시작 시 로그 손실 허용) |

### AlertManager — 알림 라우팅

| 항목 | 내용 |
|------|------|
| **한 줄 설명** | Prometheus가 발생시킨 알림을 그룹화, 중복 제거, 라우팅하는 도구 |
| **선택 이유** | kube-prometheus-stack에 포함. webhook으로 알림 로깅 |
| **프로젝트 내 위치** | `manifests/monitoring-values.yaml`, `manifests/alerting/` |
| **설정된 알림 규칙** | CPU >80%, 메모리 >85%, 노드 NotReady, Pod CrashLooping, OOMKilled 등 8개 |

### metrics-server — HPA 메트릭 소스

| 항목 | 내용 |
|------|------|
| **한 줄 설명** | Pod의 CPU/메모리 사용량을 수집하여 HPA(Horizontal Pod Autoscaler)에 제공 |
| **선택 이유** | HPA가 스케일 결정을 내리려면 이 컴포넌트가 필수 |
| **대안** | Prometheus Adapter (커스텀 메트릭 지원, 설정 복잡) |
| **프로젝트 내 위치** | `manifests/metrics-server-values.yaml`, `scripts/install/11-install-hpa.sh` |
| **적용 범위** | dev, staging 클러스터 |

---

## 4. CI/CD 계층

### ArgoCD — GitOps 배포

| 항목 | 내용 |
|------|------|
| **한 줄 설명** | Git 저장소의 매니페스트와 클러스터 상태를 자동으로 동기화하는 GitOps 도구 |
| **선택 이유** | 선언적 배포 (Git이 Single Source of Truth), UI로 동기화 상태 시각화, CNCF 졸업 |
| **대안** | Flux (CLI 중심, UI 없음), Spinnaker (무거움, 기업용), Jenkins GitOps (수동 구성 필요) |
| **프로젝트 내 위치** | `manifests/argocd-values.yaml`, `scripts/install/08-install-cicd.sh` |
| **접속** | NodePort 30800, insecure 모드 |
| **CNCF 등급** | Graduated |

### Jenkins — CI 파이프라인

| 항목 | 내용 |
|------|------|
| **한 줄 설명** | 코드 빌드, 테스트, 배포를 자동화하는 CI 서버 |
| **선택 이유** | 기업 현장에서 여전히 가장 많이 사용되는 CI 도구. 플러그인 생태계 방대 |
| **대안** | GitHub Actions (SaaS), GitLab CI (GitLab 필요), Tekton (K8s 네이티브, 학습 곡선 높음) |
| **프로젝트 내 위치** | `manifests/jenkins-values.yaml`, `scripts/install/08-install-cicd.sh` |
| **접속** | NodePort 30900, 5Gi PVC (local-path-provisioner 사용) |
| **설치된 플러그인** | kubernetes, workflow, git, configuration-as-code, blueocean |

---

## 5. 테스팅 도구

### k6 — HTTP 부하 테스트

| 항목 | 내용 |
|------|------|
| **한 줄 설명** | JavaScript로 시나리오를 작성하는 HTTP 부하 테스트 도구 (Grafana Labs 개발) |
| **선택 이유** | 가볍고 빠름, K8s Job으로 실행 가능, 결과를 파싱하기 쉬운 출력 형식 |
| **대안** | JMeter (Java 기반, 무거움), Locust (Python 기반), wrk (단순, 시나리오 없음) |
| **프로젝트 내 위치** | `manifests/demo/k6-loadtest.yaml` (ConfigMap + Job) |
| **사용 방식** | 대시보드 Testing 페이지에서 K8s Job으로 생성, 결과를 파싱하여 p95/p99/RPS 표시 |

### stress-ng — 시스템 스트레스 테스트

| 항목 | 내용 |
|------|------|
| **한 줄 설명** | CPU, 메모리, I/O 등 시스템 리소스에 인위적 부하를 가하는 도구 |
| **선택 이유** | HPA 트리거 테스트 (CPU 부하 → Pod 자동 증가 관찰), 간단한 옵션 |
| **대안** | sysbench (DB 벤치마크 포함), fio (I/O 전문) |
| **프로젝트 내 위치** | `manifests/demo/stress-test.yaml` (CPU + Memory 스트레스 Job) |

---

## 도구 선택 기준 요약

이 프로젝트에서 도구를 선택할 때 적용된 기준:

| 기준 | 설명 |
|------|------|
| **CNCF 등급** | Graduated(졸업) 또는 Incubating(인큐베이팅) 프로젝트 우선 |
| **업계 표준** | 실제 기업에서 가장 많이 사용되는 도구 (채용 공고 기준) |
| **통합성** | 서로 잘 연동되는 도구 조합 (Prometheus+Grafana+Loki, Cilium+Hubble) |
| **학습 가치** | 내부 동작을 이해할 수 있는 도구 (kubeadm > k3s, Cilium > Flannel) |
| **Helm 차트 제공** | 자동화된 설치/업그레이드 가능 |

---

## CNCF Landscape 기준 분류

```
CNCF Graduated (프로덕션 검증 완료):
  ├── Kubernetes       (오케스트레이션)
  ├── containerd       (컨테이너 런타임)
  ├── Cilium           (네트워킹)
  ├── Prometheus       (모니터링)
  ├── ArgoCD           (GitOps)
  └── Helm             (패키지 관리)

CNCF Incubating (성장 중):
  ├── Istio            (서비스 메시)
  └── Loki             (로그 수집)

CNCF 외부 (널리 사용되는 오픈소스):
  ├── Grafana          (시각화)
  ├── Jenkins          (CI)
  ├── Terraform        (IaC)
  ├── Tart             (VM 런타임)
  ├── k6               (부하 테스트)
  └── stress-ng        (시스템 스트레스)
```

---

## 다음 문서

실제로 코드를 수정해야 할 때 어디부터 봐야 하는지 알고 싶다면 → [04-code-navigation-guide.md](04-code-navigation-guide.md)
