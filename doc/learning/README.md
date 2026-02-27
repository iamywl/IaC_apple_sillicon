# 학습용 기술 문서 (Learning Guide)

Tart Multi-Cluster K8s Infrastructure 프로젝트의 **소프트웨어 공학적 관점** 학습 자료.

---

## 문서 목차

### 1. [아키텍처 설계](architecture.md)
- 시스템 계층 구조 (8 레이어)
- 멀티클러스터 설계 원칙
- 네트워크 격리 (CIDR 설계)
- Single Source of Truth (clusters.json)
- 스크립트 모듈 설계 (Facade, Strategy, Template Method 패턴)
- 리소스 관리 전략 (CPU 오버커밋, 메모리 고정)
- 보안 설계 (Zero Trust, 4계층 방어)
- ADR (Architecture Decision Records) 5건

### 2. [네트워크 심화 — CNI, NetworkPolicy, Service Mesh](networking.md)
- Tart VM 네트워크 (NAT vs Softnet)
- Cilium CNI 동작 원리 (eBPF vs iptables)
- kubeProxyReplacement과 부트스트랩 문제
- CiliumNetworkPolicy — L7 HTTP 필터링
- Hubble 네트워크 관측
- Istio Service Mesh (mTLS, 카나리, 서킷브레이커)
- Cilium + Istio 공존 원리
- 패킷의 전체 여정 (9단계)

### 3. [IaC와 자동화 파이프라인](iac-automation.md)
- 명령형(Bash) vs 선언형(Terraform) 비교
- Bash 스크립트 아키텍처 (Phase 1~12)
- 함수 라이브러리 설계 (common, vm, ssh, k8s)
- 멱등성 패턴
- Terraform 모듈 구조
- Tart CLI를 Terraform으로 래핑 (null_resource)
- DHCP IP 문제 해결 패턴
- CI/CD: Jenkins + ArgoCD (GitOps)
- Helm 차트 관리
- 자동화 수준 분류 (Day 0/1/2)

### 4. [모니터링과 옵저버빌리티](monitoring.md)
- 옵저버빌리티의 세 기둥 (Metrics, Logs, Traces)
- Prometheus Pull 모델과 TSDB
- Grafana 대시보드 프로비저닝 (코드로 관리)
- Loki 로그 수집 + LogQL
- AlertManager 알림 흐름 (그룹핑, 억제, 라우팅)
- PrometheusRule 설계 원칙 (8개 규칙)
- HPA 자동 확장 공식과 동작 원리
- PDB (PodDisruptionBudget)
- 커스텀 대시보드 아키텍처 (SSH Pool, Graceful Degradation)
- k6 부하테스트

### 5. [트러블슈팅 가이드](troubleshooting.md)
- 트러블슈팅 프레임워크 (6단계)
- 레이어별 디버깅 체크리스트 (VM → SSH → K8s → Pod → Service)
- 실제 발생한 버그 7건의 디버깅 과정
- K8s 기본 진단 명령어
- Helm/Cilium/Istio 디버깅
- 성능 트러블슈팅 (CPU, 메모리, 네트워크)
- 재해 복구 절차

---

## 학습 순서 추천

```
1일차: architecture.md     → 전체 그림 이해
2일차: networking.md       → 네트워크가 어떻게 동작하는지
3일차: iac-automation.md   → 자동화가 어떻게 구성되는지
4일차: monitoring.md       → 관측과 자동 대응
5일차: troubleshooting.md  → 문제 해결 능력
```

## 관련 프로젝트 문서

| 문서 | 설명 |
|------|------|
| [README.md](../../README.md) | 프로젝트 개요, 사용법 |
| [dashboard.md](../dashboard.md) | 커스텀 대시보드 상세 |
| [bug_report.md](../20260227_010000_bug_report.md) | 실제 버그 리포트 (타임스탬프) |
| [tart.md](../tart.md) | Tart VM 런타임 소개 |
