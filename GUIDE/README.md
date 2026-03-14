# 프로젝트 재연 가이드

이 가이드는 Apple Silicon Mac에서 멀티 클러스터 Kubernetes 인프라를 처음부터 구축하는 과정을 단계별로 설명한다.

4개 클러스터(platform, dev, staging, prod), 10개 VM을 Tart 가상화로 구성하고, Cilium CNI, Prometheus/Grafana 모니터링, ArgoCD/Jenkins CI/CD, Istio 서비스 메시까지 설치하는 전체 과정을 다룬다.

---

## 목차

| 번호 | 제목 | 내용 |
|------|------|------|
| 00 | [사전 준비](00-prerequisites.md) | 필수 도구 설치, 시스템 요구사항 확인 |
| 01 | [아키텍처 이해](01-architecture.md) | 4 클러스터 구조, 네트워크 설계, 컴포넌트 배치 |
| 02 | [빠른 시작](02-quick-start.md) | demo.sh 한 줄로 전체 구축 |
| 03 | [12단계 설치 파이프라인 상세](03-phase-by-phase.md) | 각 Phase 스크립트의 동작 원리 |
| 04 | [클러스터 검증](04-cluster-verification.md) | 노드, Pod, 서비스 정상 동작 확인 |
| 05 | [SRE 대시보드](05-dashboard-guide.md) | 웹 대시보드 설치 및 사용법 |
| 06 | [CI/CD 워크플로우](06-cicd-workflow.md) | Jenkins + ArgoCD 파이프라인 구성 |
| 07 | [테스트 시나리오](07-testing-scenarios.md) | 장애 시뮬레이션, 부하 테스트 |
| 08 | [트러블슈팅](08-troubleshooting.md) | 계층별 문제 진단 및 해결 |
| 09 | [Terraform 대안](09-terraform-alternative.md) | Terraform 모듈로 동일 인프라 구축 |

---

## 예상 소요 시간

| 방식 | 시간 |
|------|------|
| 전체 구축 (베이스 이미지) | 45-60분 |
| 전체 구축 (Golden Image) | 15-20분 |
| 가이드 전체 따라하기 | 2-3시간 |

Golden Image는 `build-golden-image.sh`로 생성한다. containerd, kubeadm, kubelet, kubectl이 사전 설치되어 있어 Phase 2~4를 건너뛸 수 있다.

---

## 요구사항

| 항목 | 최소 | 권장 |
|------|------|------|
| 프로세서 | Apple Silicon (M1) | M1 Pro 이상 |
| RAM | 32GB | 64GB 이상 |
| 디스크 여유 | 100GB | 200GB 이상 |
| macOS | 13.0 (Ventura) | 14.0 (Sonoma) 이상 |

VM 10개가 총 약 60GB 메모리를 사용한다. 64GB RAM에서는 호스트 OS에 약 4GB가 남으므로, 불필요한 애플리케이션을 종료하고 실행하는 것을 권장한다.

---

## 필수 도구

```bash
brew install tart kubectl helm jq sshpass
```

| 도구 | 용도 |
|------|------|
| tart | macOS 네이티브 VM 관리 (Apple Virtualization.framework) |
| kubectl | Kubernetes 클러스터 제어 |
| helm | Kubernetes 패키지 관리 |
| jq | JSON 파싱 (config/clusters.json 처리) |
| sshpass | 비대화형 SSH 인증 |

Terraform 방식을 사용하려면 추가로 설치한다:

```bash
brew install terraform
```

---

## 프로젝트 주요 스크립트

| 스크립트 | 용도 |
|----------|------|
| `demo.sh` | 원스톱 전체 구축 |
| `install.sh` | 12 Phase 순차 실행 |
| `boot.sh` | 모든 VM 시작 |
| `shutdown.sh` | 모든 VM 정지 |
| `destroy.sh` | 모든 VM 삭제 및 정리 |
| `build-golden-image.sh` | Golden Image 생성 |
| `status.sh` | 전체 인프라 상태 확인 |

---

## 빠른 시작

```bash
git clone <repository-url> tart-infra
cd tart-infra
bash scripts/demo.sh
```

상세한 과정은 [02-quick-start.md](02-quick-start.md)를 참고한다.
