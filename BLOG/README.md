# 초보자를 위한 인프라 엔지니어링 블로그 시리즈

> Apple Silicon Mac 한 대로 프로덕션급 멀티클러스터 Kubernetes 인프라를 구축하는 과정을,
> **아무것도 모르는 사람도 따라할 수 있게** 하나하나 설명하는 15편의 시리즈입니다.

---

## 시리즈 구성

### Part 1: 기초 — "왜 필요한가"를 이해하기

| # | 제목 | 핵심 키워드 |
|---|------|------------|
| [01](01-introduction.md) | 왜 이 프로젝트를 만들었는가 | IaC, 자동화, 12단계 파이프라인 |
| [02](02-virtualization.md) | 가상화란 무엇인가 — Tart와 Apple Silicon | Hypervisor, VM, Golden Image, clusters.json |
| [03](03-containers-and-kubernetes.md) | 컨테이너와 쿠버네티스 첫걸음 | containerd, Pod, Deployment, kubeadm |

### Part 2: 네트워크와 보안

| # | 제목 | 핵심 키워드 |
|---|------|------------|
| [04](04-networking.md) | 쿠버네티스 네트워킹 — Cilium과 eBPF | CNI, eBPF, Pod CIDR, Hubble |
| [08](08-network-security.md) | 네트워크 보안 — 제로 트러스트와 CiliumNetworkPolicy | Default Deny, L3/L4/L7, Whitelist |
| [10](10-service-mesh.md) | 서비스 메시 — Istio, mTLS, 카나리 배포 | Sidecar, mTLS, Canary, Circuit Breaker |

### Part 3: 운영 인프라

| # | 제목 | 핵심 키워드 |
|---|------|------------|
| [05](05-monitoring.md) | 모니터링과 옵저버빌리티 | Prometheus, Grafana, Loki, AlertManager |
| [06](06-iac-automation.md) | Infrastructure as Code | Bash vs Terraform, 멱등성, SSOT |
| [07](07-cicd-pipeline.md) | CI/CD 파이프라인 — Jenkins와 ArgoCD | 7단계 파이프라인, GitOps, Auto Sync |

### Part 4: 애플리케이션과 스케일링

| # | 제목 | 핵심 키워드 |
|---|------|------------|
| [09](09-autoscaling.md) | 오토스케일링 — HPA와 PDB | metrics-server, HPA 공식, PDB |
| [11](11-demo-apps.md) | 데모 앱 구성 — 3-Tier + Auth + MQ | nginx, httpbin, postgres, redis, rabbitmq, keycloak |
| [12](12-sre-dashboard.md) | SRE 대시보드 — React + Express | 6 Pages, 11 APIs, SSH Pool, 실시간 수집 |

### Part 5: 검증과 마무리

| # | 제목 | 핵심 키워드 |
|---|------|------------|
| [13](13-load-testing.md) | 부하 테스트 — k6와 stress-ng | VU, p95/p99, Cascade, RPS |
| [14](14-troubleshooting.md) | 트러블슈팅 — 문제 해결 가이드 | 6단계 디버깅, 레이어별 체크리스트 |
| [15](15-putting-it-all-together.md) | 전체 정리 — 처음부터 끝까지 한눈에 | Day 0/1/2, 커리어 패스, 치트시트 |

---

## 권장 읽기 순서

초보자는 **01 → 02 → 03 → 04 → 05 → 06** 순서로 기초를 잡은 뒤,
관심 분야에 따라 나머지를 선택적으로 읽으세요.

```
기초          네트워크/보안      운영           앱/스케일링      검증
01 ─→ 02 ─→ 03 ─→ 04 ─→ 05 ─→ 06 ─→ 07 ─→ 08 ─→ 09 ─→ 10
                                                    │
                                              11 ─→ 12 ─→ 13 ─→ 14 ─→ 15
```

## 각 포스트의 공통 구성

모든 포스트는 다음 구조를 따릅니다:

- **개념 설명** — 일상적인 비유로 기술 개념을 설명
- **왜 이게 필요한가?** — 이 기술 없이 어떤 문제가 생기는지
- **실제 프로젝트에서는** — tart-infra 프로젝트의 실제 코드/설정 예시
- **핵심 명령어** — 직접 실행해볼 수 있는 명령어
- **정리** — 핵심 요약과 다음 편 예고
