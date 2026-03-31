# CKA (Certified Kubernetes Administrator) 시험 가이드

## 시험 개요

CKA(Certified Kubernetes Administrator)는 CNCF(Cloud Native Computing Foundation)와 Linux Foundation이 공동으로 주관하는 쿠버네티스 관리자 공인 자격증이다. 이 시험은 쿠버네티스 클러스터를 설치, 구성, 관리하는 실무 능력을 검증하는 것을 목적으로 한다.

CKA는 이론 시험이 아닌 **실기(Performance-based) 시험**이다. 실제 터미널 환경에서 쿠버네티스 클러스터를 조작하여 주어진 과제를 해결해야 한다. 객관식 문제는 출제되지 않으며, 모든 문제는 kubectl 명령어와 YAML 매니페스트를 사용하여 직접 작업을 수행하는 방식이다.

## 시험 기본 정보

| 항목 | 내용 |
|------|------|
| **시험 형식** | 실기 시험 (Performance-based, Hands-on) |
| **시험 시간** | 2시간 (120분) |
| **합격 기준** | 66% 이상 |
| **문제 수** | 15~20문제 (변동 가능) |
| **시험 환경** | 원격 프록터 감독 하에 브라우저 기반 터미널 |
| **시험 언어** | 영어, 일본어, 중국어 (한국어 미지원) |
| **자격 유효기간** | 3년 |
| **재시험** | 1회 무료 재시험 기회 포함 |
| **시험 비용** | $395 USD |
| **쿠버네티스 버전** | 시험 시점의 최신 마이너 버전 기준 (보통 최근 2개 버전) |

## 도메인별 출제 비율

CKA 시험은 다음 5개 도메인으로 구성되며, 각 도메인의 출제 비율은 다음과 같다.

| 도메인 | 비율 | 주요 내용 |
|--------|------|-----------|
| **Cluster Architecture, Installation & Configuration** | 25% | kubeadm 클러스터 설치/업그레이드, etcd 백업/복구, RBAC, HA 구성 |
| **Workloads & Scheduling** | 15% | Deployment, Pod 스케줄링, Resource 관리, DaemonSet, StatefulSet |
| **Services & Networking** | 20% | Service 유형, Ingress, NetworkPolicy, DNS, CNI |
| **Storage** | 10% | PV/PVC, StorageClass, Volume 종류, Access Modes |
| **Troubleshooting** | 30% | 노드/Pod/네트워크/클러스터 컴포넌트 트러블슈팅 |

> **참고**: Troubleshooting이 30%로 가장 높은 비율을 차지한다. 문제 해결 능력이 CKA 합격의 핵심이다.

## 시험 환경 상세

### 접속 환경

- 시험은 PSI 플랫폼에서 온라인 감독관 방식으로 진행된다.
- 브라우저 기반의 리눅스 터미널이 제공된다.
- 시험 중 여러 개의 쿠버네티스 클러스터가 제공되며, 문제마다 사용할 클러스터가 지정된다.
- 각 문제 시작 시 `kubectl config use-context <context-name>` 명령어가 제공되므로 반드시 실행한 후 작업을 시작해야 한다.

### 시험 중 허용 사항

- **쿠버네티스 공식 문서** 접근이 허용된다 (kubernetes.io/docs, kubernetes.io/blog, github.com/kubernetes).
- 별도의 브라우저 탭 1개를 열어 공식 문서를 참조할 수 있다.
- 터미널에서 `kubectl`, `vim`, `nano` 등의 기본 도구를 사용할 수 있다.
- 시험 환경의 클립보드 기능을 사용할 수 있다.

### 시험 중 금지 사항

- 공식 문서 외의 웹사이트 접근은 금지이다.
- 별도의 메모, 노트, 참고 자료 사용이 금지이다.
- 다른 사람과의 소통이 금지이다.
- 시험 환경 외의 터미널이나 애플리케이션 사용이 금지이다.

### 시험 환경 팁

1. **자동완성 설정**: 시험 시작 시 bash 자동완성을 활성화하면 효율적이다.
   ```bash
   source <(kubectl completion bash)
   alias k=kubectl
   complete -o default -F __start_kubectl k
   ```

2. **컨텍스트 확인**: 매 문제마다 올바른 클러스터 컨텍스트로 전환했는지 반드시 확인해야 한다.
   ```bash
   kubectl config current-context
   ```

3. **시간 관리**: 2시간 안에 15~20문제를 풀어야 하므로, 한 문제에 너무 오래 매달리지 않는 것이 중요하다. 어려운 문제는 표시(flag)하고 넘어간 후 나중에 돌아오는 전략이 효과적이다.

4. **imperative 명령어 활용**: 시간 절약을 위해 YAML을 직접 작성하기보다 `kubectl run`, `kubectl create`, `kubectl expose` 등의 imperative 명령어를 적극 활용하는 것이 좋다.

5. **dry-run 활용**: YAML 템플릿이 필요할 때 `--dry-run=client -o yaml` 옵션을 사용하여 빠르게 생성할 수 있다.
   ```bash
   kubectl run nginx --image=nginx --dry-run=client -o yaml > pod.yaml
   ```

## 학습 로드맵

### 1단계: 핵심 개념 학습 (1~2주)

- [01-concepts.md](./01-concepts.md) 파일을 통해 5개 도메인의 핵심 개념을 학습한다.
- 각 도메인의 주요 오브젝트와 동작 원리를 이해한다.

### 2단계: 실습 (2~3주)

- [02-examples.md](./02-examples.md) 파일의 실습 예제를 직접 수행한다.
- kubeadm으로 클러스터를 직접 구축해 보는 것을 권장한다.
- Killer.sh 등의 시뮬레이터를 활용하여 시험 환경에 익숙해진다.

### 3단계: 모의시험 (1~2주)

- [03-exam-questions.md](./03-exam-questions.md) 파일의 모의 문제를 풀어본다.
- 시간을 재고 풀어보며 실전 감각을 키운다.
- 틀린 문제는 반드시 복습하고, 관련 개념을 다시 학습한다.

### 4단계: 최종 점검 (시험 전 3~5일)

- 약점 도메인을 집중적으로 복습한다.
- kubectl 치트시트를 반복 학습한다.
- Killer.sh 시뮬레이터(시험 등록 시 2회 무료 제공)를 반드시 풀어본다.

## 참고 리소스

| 리소스 | 설명 |
|--------|------|
| [쿠버네티스 공식 문서](https://kubernetes.io/docs/) | 시험 중 유일하게 참조 가능한 자료 |
| [Killer.sh](https://killer.sh/) | CKA 시뮬레이터 (시험 등록 시 2회 무료) |
| [쿠버네티스 GitHub](https://github.com/kubernetes/kubernetes) | 소스 코드 및 이슈 트래커 |
| [CNCF CKA 페이지](https://www.cncf.io/certification/cka/) | 공식 시험 정보 |
| [kubectl 치트시트](https://kubernetes.io/docs/reference/kubectl/cheatsheet/) | 필수 명령어 정리 |

## 파일 구성

```
CERT/CKA/
├── README.md                  # 시험 개요 및 가이드 (본 문서)
├── 01-concepts.md             # 도메인별 핵심 개념 정리
├── 02-examples.md             # 실습 예제 모음
├── 03-exam-questions.md       # 모의 시험 문제 및 풀이
├── 04-tart-infra-practice.md  # tart-infra 환경 활용 실습 가이드
└── daily/                     # 일별 학습 기록 (day01~day20)
```
