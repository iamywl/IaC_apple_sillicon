# 학습용 기술 문서(Learning Technical Guide)

Tart Multi-Cluster K8s(Kubernetes) Infrastructure 프로젝트의 **소프트웨어 공학적(Software Engineering) 관점** 학습 자료.

---

## 문서 목차(Table of Contents)

### 1. [아키텍처 설계(Architecture Design)](architecture.md)
- 시스템 계층 구조(Layered Architecture) — 8 레이어(Layers)
- 멀티클러스터(Multi-cluster) 설계 원칙
- 네트워크 격리(Network Isolation) — CIDR 설계
- Single Source of Truth (clusters.json)
- 스크립트 모듈 설계(Modular Script Design) — Facade, Strategy, Template Method 패턴(Patterns)
- 리소스 관리 전략(Resource Management Strategy) — CPU 오버커밋(Overcommit), 메모리(Memory) 고정
- 보안 설계(Security Design) — Zero Trust, 4계층 방어(4-layer Defense)
- ADR(Architecture Decision Records) 5건

### 2. [네트워크 심화(Advanced Networking) — CNI, NetworkPolicy, Service Mesh](networking.md)
- Tart VM 네트워크(Network) — NAT vs Softnet
- Cilium CNI 동작 원리(Operation Principle) — eBPF(extended Berkeley Packet Filter) vs iptables
- kubeProxyReplacement과 부트스트랩(Bootstrap) 문제
- CiliumNetworkPolicy — L7 HTTP 필터링(Filtering)
- Hubble 네트워크 관측(Network Observation)
- Istio Service Mesh — mTLS(Mutual TLS), 카나리(Canary), 서킷브레이커(Circuit Breaker)
- Cilium + Istio 공존 원리(Coexistence Principle)
- 패킷의 전체 여정(Full Packet Journey) — 9단계

### 3. [IaC(Infrastructure as Code)와 자동화 파이프라인(Automation Pipeline)](iac-automation.md)
- 명령형(Imperative, Bash) vs 선언형(Declarative, Terraform) 비교
- Bash 스크립트 아키텍처(Script Architecture) — Phase 1~12
- 함수 라이브러리 설계(Function Library Design) — common, vm, ssh, k8s
- 멱등성 패턴(Idempotency Pattern)
- Terraform 모듈 구조(Module Structure)
- Tart CLI를 Terraform으로 래핑(Wrapping) — null_resource
- DHCP IP 문제 해결 패턴(Resolution Pattern)
- CI/CD: Jenkins + ArgoCD (GitOps)
- Helm 차트(Chart) 관리
- 자동화 수준 분류(Automation Level Classification) — Day 0/1/2

### 4. [모니터링(Monitoring)과 옵저버빌리티(Observability)](monitoring.md)
- 옵저버빌리티의 세 기둥(Three Pillars) — Metrics, Logs, Traces
- Prometheus Pull 모델(Model)과 TSDB(Time Series Database)
- Grafana 대시보드 프로비저닝(Dashboard Provisioning) — 코드로 관리(as Code)
- Loki 로그 수집(Log Collection) + LogQL
- AlertManager 알림 흐름(Alert Flow) — 그룹핑(Grouping), 억제(Inhibition), 라우팅(Routing)
- PrometheusRule 설계 원칙(Design Principles) — 8개 규칙(Rules)
- HPA(Horizontal Pod Autoscaler) 자동 확장 공식(Scaling Formula)과 동작 원리
- PDB(Pod Disruption Budget)
- 커스텀 대시보드(Custom Dashboard) 아키텍처 — SSH Pool, Graceful Degradation
- k6 부하 테스트(Load Testing)

### 5. [트러블슈팅 가이드(Troubleshooting Guide)](troubleshooting.md)
- 트러블슈팅 프레임워크(Framework) — 6단계
- 레이어별 디버깅 체크리스트(Debugging Checklist) — VM → SSH → K8s → Pod → Service
- 실제 발생한 버그(Bugs) 7건의 디버깅 과정
- K8s 기본 진단 명령어(Diagnostic Commands)
- Helm/Cilium/Istio 디버깅(Debugging)
- 성능 트러블슈팅(Performance Troubleshooting) — CPU, 메모리(Memory), 네트워크(Network)
- 재해 복구 절차(Disaster Recovery Procedure)

---

## 학습 순서 추천(Recommended Learning Order)

```
1일차(Day 1): architecture.md     → 전체 그림 이해(Understanding the Big Picture)
2일차(Day 2): networking.md       → 네트워크가 어떻게 동작하는지(How Networking Works)
3일차(Day 3): iac-automation.md   → 자동화가 어떻게 구성되는지(How Automation is Structured)
4일차(Day 4): monitoring.md       → 관측(Observation)과 자동 대응(Auto Response)
5일차(Day 5): troubleshooting.md  → 문제 해결 능력(Problem Solving Skills)
```

## 관련 프로젝트 문서(Related Project Documents)

| 문서(Document) | 설명(Description) |
|------|------|
| [README.md](../../README.md) | 프로젝트 개요(Project Overview), 사용법(Usage) |
| [dashboard.md](../dashboard.md) | 커스텀 대시보드 상세(Custom Dashboard Details) |
| [bug-reports/](../bug-reports/) | 버그 리포트(Bug Reports) — 타임스탬프(Timestamp) 기반 관리 |
| [tart.md](../tart.md) | Tart VM 런타임(Runtime) 소개 |
