# CKAD (Certified Kubernetes Application Developer)

## 시험 개요

CKAD(Certified Kubernetes Application Developer)는 CNCF(Cloud Native Computing Foundation)와 Linux Foundation이 공동 운영하는 Kubernetes 공식 자격증이다. 이 시험은 Kubernetes 환경에서 애플리케이션을 설계, 빌드, 배포, 운영하는 능력을 검증하는 **실기(Performance-Based) 시험**이다.

| 항목 | 내용 |
|------|------|
| **주관** | CNCF / Linux Foundation |
| **시험 형태** | 실기 시험 (Performance-Based Exam) |
| **시험 시간** | 2시간 (120분) |
| **합격 기준** | 66% 이상 |
| **시험 비용** | $395 USD (재시험 1회 포함) |
| **유효 기간** | 취득일로부터 3년 |
| **Kubernetes 버전** | 시험 시점의 최신 마이너 버전 기준 |
| **시험 환경** | 원격 프록터 감독 하 온라인 시험 |

---

## CKA와의 차이점

CKAD와 CKA는 모두 Kubernetes 공식 자격증이지만, 초점이 다르다.

| 구분 | CKAD | CKA |
|------|------|-----|
| **대상** | 애플리케이션 개발자 | 클러스터 관리자 |
| **초점** | 앱 설계, 빌드, 배포, 설정 | 클러스터 설치, 관리, 트러블슈팅 |
| **클러스터 관리** | 다루지 않음 | kubeadm, etcd 백업/복원 등 포함 |
| **네트워킹** | Service, Ingress, NetworkPolicy | CNI 플러그인, DNS, 클러스터 네트워크 |
| **보안** | SecurityContext, ServiceAccount | RBAC, 인증서 관리, 감사 로그 |
| **Helm/Kustomize** | 포함 | 포함 |
| **난이도** | 앱 개발 중심 (비교적 좁은 범위) | 인프라 관리 중심 (넓은 범위) |
| **합격 기준** | 66% | 66% |

CKAD는 클러스터가 이미 구축되어 있다고 가정하고, 그 위에서 애플리케이션을 운영하는 역량에 집중한다. 반면 CKA는 클러스터 자체를 구축하고 유지보수하는 역량을 평가한다.

---

## 도메인별 출제 비율

| 도메인 | 비율 | 주요 내용 |
|--------|------|-----------|
| **Application Design and Build** | 20% | Dockerfile, Init/Sidecar Container, Volume, Multi-container Pod 패턴 |
| **Application Deployment** | 20% | Deployment 전략, Blue-Green/Canary, Helm, Kustomize |
| **Application Observability and Maintenance** | 15% | Probe, 로깅, 디버깅, 모니터링 |
| **Application Environment, Configuration and Security** | 25% | ConfigMap, Secret, ServiceAccount, SecurityContext, Resource 관리 |
| **Services and Networking** | 20% | Service, Ingress, NetworkPolicy, DNS |

**가장 비중이 높은 도메인은 "Application Environment, Configuration and Security"(25%)이다.** ConfigMap, Secret, SecurityContext 등의 YAML 작성을 확실히 숙달해야 한다.

---

## 시험 환경

### 접근 가능한 리소스
- **kubernetes.io/docs** 공식 문서 접근이 가능하다
- **kubernetes.io/blog** 접근이 가능하다
- **helm.sh/docs** 접근이 가능하다
- 그 외 외부 사이트(Google, Stack Overflow 등)는 접근이 **불가능**하다

### 시험 환경 특징
- **복수 클러스터 환경**: 여러 개의 Kubernetes 클러스터가 제공되며, 문제마다 사용할 클러스터가 지정된다
- 문제 상단에 `kubectl config use-context <context-name>` 명령어가 제시되므로 반드시 컨텍스트를 전환한 후 풀어야 한다
- **Linux 터미널 기반**: 웹 기반 터미널에서 직접 명령어를 입력하여 문제를 해결한다
- **PSI Secure Browser** 사용: 시험 전용 브라우저를 설치해야 한다
- **웹캠 감독**: 원격 프록터가 웹캠을 통해 시험 과정을 감독한다
- 시험 중 메모장, 보조 모니터, 이어폰 등은 사용할 수 없다
- 투명한 물병만 허용된다

### 기본 제공 도구
- `kubectl` (자동완성 설정 가능)
- `vim`, `nano` 등 텍스트 에디터
- `tmux` 사용 가능
- `jq`, `yq` 사용 가능

---

## 준비 팁

### 1. 시간 관리가 핵심이다
- 2시간 동안 15~20문제를 풀어야 한다
- 한 문제에 너무 오래 머물지 말고, 어려운 문제는 **플래그(flag)**를 걸어두고 나중에 돌아와야 한다
- 배점이 높은 문제를 먼저 풀면 효율적이다
- 각 문제의 배점(weight)이 표시되므로 이를 참고하여 시간을 배분해야 한다

### 2. kubectl 명령어 숙달이 필수이다
```bash
# 자동완성 설정 (시험 시작 시 반드시 설정)
source <(kubectl completion bash)
alias k=kubectl
complete -o default -F __start_kubectl k

# 리소스 빠르게 생성하는 dry-run 패턴
kubectl run nginx --image=nginx --dry-run=client -o yaml > pod.yaml
kubectl create deployment nginx --image=nginx --dry-run=client -o yaml > deploy.yaml
kubectl create service clusterip my-svc --tcp=80:80 --dry-run=client -o yaml > svc.yaml
kubectl create configmap my-config --from-literal=key=value --dry-run=client -o yaml > cm.yaml
kubectl create secret generic my-secret --from-literal=password=pass123 --dry-run=client -o yaml > secret.yaml

# YAML 필드 확인
kubectl explain pod.spec.containers.livenessProbe
kubectl explain deployment.spec.strategy --recursive
```

### 3. YAML 작성 연습을 충분히 해야 한다
- `--dry-run=client -o yaml`로 기본 YAML을 생성한 뒤, 필요한 필드를 추가하는 방식이 가장 빠르다
- `kubectl explain` 명령어를 적극 활용하여 필드명과 구조를 확인해야 한다
- 시험에서는 공식 문서의 YAML 예제를 복사하여 수정하는 것이 효율적이다

### 4. vim 기본 조작을 숙지해야 한다
```
:set number          # 줄 번호 표시
:set tabstop=2       # 탭 크기 2로 설정
:set expandtab       # 탭을 스페이스로 변환
:set shiftwidth=2    # 들여쓰기 크기 2로 설정
:%s/old/new/g        # 전체 치환
dd                   # 한 줄 삭제
yy                   # 한 줄 복사
p                    # 붙여넣기
u                    # 실행 취소
```

시험 시작 시 `~/.vimrc`에 아래 설정을 저장하면 YAML 편집이 편해진다:
```bash
cat <<EOF > ~/.vimrc
set number
set tabstop=2
set expandtab
set shiftwidth=2
set autoindent
EOF
```

### 5. 공식 문서 북마크를 준비해야 한다
시험 중 kubernetes.io/docs에 접근 가능하므로, 자주 참조하는 페이지를 미리 북마크해 두면 시간을 절약할 수 있다:
- Pod 스펙 레퍼런스
- Deployment 전략
- ConfigMap / Secret
- SecurityContext
- NetworkPolicy
- Ingress
- Probe 설정
- Helm 명령어

### 6. 컨텍스트 전환을 잊지 말아야 한다
```bash
# 반드시 문제에서 지정한 컨텍스트로 전환
kubectl config use-context <context-name>

# 현재 컨텍스트 확인
kubectl config current-context
```
컨텍스트 전환을 잊으면 다른 클러스터에서 작업하게 되어 점수를 잃는다. 이는 가장 흔한 실수 중 하나이다.

### 7. 실습 환경에서 반복 연습해야 한다
- **killer.sh**: 시험 등록 시 2회 무료 모의 시험이 제공된다. 실제 시험보다 난이도가 높으므로 좋은 연습이 된다
- **Kodekloud**: CKAD 실습 환경을 제공하는 학습 플랫폼이다
- **로컬 환경**: minikube, kind, k3s 등을 활용하여 직접 클러스터를 구성하고 연습할 수 있다

### 8. 자주 실수하는 부분을 체크해야 한다
- namespace 지정 누락 (`-n <namespace>`)
- 컨텍스트 전환 누락
- YAML 들여쓰기 오류
- label/selector 불일치
- containerPort와 Service port 매핑 오류
- NetworkPolicy의 podSelector vs namespaceSelector 혼동
