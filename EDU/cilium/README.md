# Cilium - eBPF 기반 CNI

## 학습 가이드

Cilium의 핵심 개념부터 실전 운영까지 7일 과정으로 구성된 학습 가이드이다. 각 Day 문서는 논리적으로 연관된 주제를 묶어 체계적으로 학습할 수 있도록 구성하였다.

### 학습 일정

| Day | 주제 | 파일 | 핵심 내용 |
|-----|------|------|----------|
| 1 | 개념 및 eBPF 기초 심화 | [day01-ebpf-fundamentals.md](day01-ebpf-fundamentals.md) | Cilium 개요, eBPF 가상 머신, 레지스터/명령어, 프로그램 타입, Map, Verifier |
| 2 | Cilium 아키텍처 및 네트워킹 심화 | [day02-architecture-networking.md](day02-architecture-networking.md) | Agent/Operator/CNI Plugin, Overlay/Direct Routing, IPAM, VXLAN/Geneve |
| 3 | Datapath 및 Network Policy 심화 | [day03-datapath-network-policy.md](day03-datapath-network-policy.md) | eBPF Datapath 처리 흐름, L3/L4/L7 Network Policy, FQDN/DNS Policy |
| 4 | kube-proxy 대체, 암호화, Cluster Mesh, BGP | [day04-services-encryption-mesh-bgp.md](day04-services-encryption-mesh-bgp.md) | Socket-Level LB, DSR, Maglev, WireGuard/IPsec, Cluster Mesh, BGP, Bandwidth Manager |
| 5 | Tetragon, 관찰성, 성능 튜닝 | [day05-tetragon-observability-tuning.md](day05-tetragon-observability-tuning.md) | Tetragon Runtime Security, Hubble, Prometheus 메트릭, 성능 최적화 |
| 6 | 보안 심화 및 트러블슈팅 | [day06-security-troubleshooting.md](day06-security-troubleshooting.md) | SPIFFE, mTLS, Network Policy 디버깅, cilium status/monitor, connectivity test |
| 7 | 실전 시나리오, 실습, 예제, 자가 점검 | [day07-scenarios-labs-review.md](day07-scenarios-labs-review.md) | 마이그레이션, Service Mesh, 핵심 요약, 실습 과제, 예제 매니페스트, 자가 점검 |

### 학습 방법

1. Day 1부터 순서대로 학습하는 것을 권장한다. 각 Day는 이전 Day의 내용을 기반으로 한다.
2. 각 Day 문서의 코드 블록과 다이어그램을 직접 실행/분석하며 학습한다.
3. Day 7의 자가 점검 문항으로 전체 학습 내용을 복습한다.

### 전체 구성

- **Day 1~2**: 기초 이론 (eBPF, Cilium 아키텍처)
- **Day 3~4**: 핵심 기능 (Datapath, Policy, Service, 암호화, Mesh)
- **Day 5~6**: 운영 (보안, 관찰성, 성능, 트러블슈팅)
- **Day 7**: 종합 (실전 시나리오, 실습, 자가 점검)
