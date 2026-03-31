# CKS (Certified Kubernetes Security Specialist)

## 시험 개요

CKS(Certified Kubernetes Security Specialist)는 CNCF(Cloud Native Computing Foundation)에서 주관하는 쿠버네티스 보안 전문가 자격증이다. CKA(Certified Kubernetes Administrator) 자격증을 보유한 사람만 응시할 수 있으며, 쿠버네티스 클러스터의 보안을 설계, 구축, 운영하는 능력을 검증하는 시험이다.

CKS는 CKA, CKAD와 달리 보안에 특화된 시험으로, 쿠버네티스 생태계의 다양한 보안 도구(Falco, Trivy, OPA Gatekeeper, AppArmor, seccomp 등)에 대한 실무 지식을 요구한다. 단순히 쿠버네티스 리소스를 생성하는 것을 넘어, 보안 위협을 식별하고 대응하는 실전 능력이 핵심이다.

| 항목 | 내용 |
|------|------|
| 시험 형태 | 실기 시험 (Performance-based, 커맨드라인 기반) |
| 시험 시간 | **2시간** |
| 합격 기준 | **67%** (100점 만점 중 67점 이상) |
| 선수 조건 | **CKA 자격증 보유 필수** (유효 기간 내) |
| 시험 환경 | 원격 프록터 감독 하에 진행 |
| 유효 기간 | 합격일로부터 **2년** |
| 재시험 | 1회 무료 재시험 기회 포함 |
| 시험 비용 | $395 USD |
| K8s 버전 | 시험 시점 기준 최신 마이너 버전 -2 |
| 문제 수 | 15~20문제 (가변적) |

## 선수 조건: CKA 필수

CKS 시험에 응시하려면 반드시 유효한 CKA 자격증을 보유하고 있어야 한다. CKA 없이는 CKS 시험을 예약할 수 없다. CKA에서 다루는 클러스터 관리, 네트워킹, 스토리지, 트러블슈팅 등의 기본 역량 위에 보안 지식을 쌓는 구조이다.

- CKA를 먼저 취득한 후 CKS를 준비하는 것이 정석적인 경로이다
- CKA에서 배운 kubeadm, etcd, API server 설정 등의 지식이 CKS에서 그대로 활용된다
- CKA 유효 기간이 만료되면 CKS 응시 자격도 상실된다
- CKAD는 CKS의 선수 조건이 아니다. CKA만 있으면 된다

## 도메인별 출제 비율

| 도메인 | 비율 | 주요 내용 |
|--------|------|-----------|
| **Cluster Setup** | 10% | NetworkPolicy, CIS Benchmark, Ingress TLS, 노드 메타데이터 보호, GUI 보안, 바이너리 검증 |
| **Cluster Hardening** | 15% | RBAC, ServiceAccount 보안, API Server 접근 제한, 업그레이드, kubeconfig 관리 |
| **System Hardening** | 15% | AppArmor, seccomp, OS 최소화, IAM 역할 관리 |
| **Minimize Microservice Vulnerabilities** | 20% | Pod Security Standards, OPA Gatekeeper, Secret 관리, RuntimeClass, mTLS |
| **Supply Chain Security** | 20% | 이미지 스캔(Trivy), ImagePolicyWebhook, 이미지 서명, Dockerfile 보안, SBOM |
| **Monitoring, Logging and Runtime Security** | 20% | Audit Policy, Falco, 컨테이너 불변성, 런타임 이상 탐지 |

> **핵심 포인트**: Minimize Microservice Vulnerabilities, Supply Chain Security, Monitoring/Logging/Runtime Security 세 도메인이 각각 20%로 전체의 **60%**를 차지한다. 이 세 영역을 확실히 준비해야 합격 가능성이 높아진다.

## 시험 환경

### 시험 플랫폼
- PSI Bridge 기반의 원격 프록터 시험이다
- 브라우저 내장 터미널을 통해 여러 쿠버네티스 클러스터에 접속하여 문제를 푼다
- 각 문제마다 `kubectl config use-context <context-name>` 명령으로 적절한 클러스터로 전환해야 한다
- 터미널은 단일 탭만 사용 가능하며, 화면 분할은 지원되지 않는다
- 복사/붙여넣기가 가능하지만, 호스트 OS와의 클립보드 공유는 제한적이다

### 허용 리소스
- 시험 중 **공식 쿠버네티스 문서**(kubernetes.io/docs, kubernetes.io/blog)만 참조 가능하다
- 추가로 다음 도구들의 공식 문서도 참조 가능하다:
  - Falco: falco.org/docs
  - Trivy: aquasecurity.github.io/trivy
  - AppArmor: gitlab.com/apparmor/apparmor/-/wikis/Documentation
  - 기타 시험 범위 내 도구의 공식 문서
- 개인 노트, 블로그, ChatGPT, Stack Overflow 등은 사용 불가이다
- 브라우저에서 허용된 문서 외의 탭을 열면 시험이 종료될 수 있다

### 시험 환경 구성
- 복수의 쿠버네티스 클러스터가 미리 구성되어 있다
- 각 클러스터는 kubeadm으로 구축되어 있다
- SSH를 통해 노드에 직접 접속하여 작업하는 문제가 다수 출제된다
- systemctl, journalctl, crictl 등 시스템 명령어를 자유롭게 사용해야 한다
- containerd가 기본 컨테이너 런타임이다 (Docker는 더 이상 사용되지 않는다)

## CKA/CKAD와의 난이도 차이

### 왜 CKS가 가장 어려운가

| 구분 | CKA | CKAD | CKS |
|------|-----|------|-----|
| 합격 기준 | 66% | 66% | **67%** |
| 시험 시간 | 2시간 | 2시간 | 2시간 |
| 난이도 | 중급 | 중급 | **고급 (최상)** |
| 선수 조건 | 없음 | 없음 | **CKA 필수** |
| 다루는 범위 | K8s 관리 | K8s 개발 | **K8s + 보안 도구 생태계 전체** |
| 외부 도구 | 거의 없음 | 거의 없음 | **Falco, Trivy, OPA, AppArmor, seccomp 등** |
| 시스템 레벨 | 부분적 | 거의 없음 | **리눅스 커널 보안까지** |

1. **K8s 외부 도구 지식 필수**: CKA/CKAD는 쿠버네티스 자체만 알면 되지만, CKS는 Falco, Trivy, AppArmor, seccomp, OPA Gatekeeper, kube-bench 등 별도의 보안 도구들을 모두 다룰 수 있어야 한다
2. **시스템 레벨 이해 필요**: 리눅스 커널 보안(seccomp, AppArmor), 시스템콜, 프로세스 격리 등 OS 수준의 보안 이해가 요구된다
3. **복합적 문제 해결**: 하나의 문제가 여러 보안 개념을 조합하여 출제된다. 예를 들어 "NetworkPolicy를 설정하고, RBAC를 수정하고, Audit Policy를 적용하라"와 같은 문제가 나올 수 있다
4. **설정 파일 직접 수정**: API server, kubelet, etcd 등의 매니페스트 파일을 직접 수정하고 서비스를 재시작하는 작업이 빈번하다. 잘못 수정하면 클러스터가 망가진다
5. **시간 압박이 극심**: 2시간 안에 15~20문제를 풀어야 하며, 각 문제의 난이도가 높아 시간 관리가 매우 중요하다
6. **정답 검증이 어려움**: 보안 설정은 "적용 후 확인"이 어려운 경우가 많다. Audit Policy가 제대로 동작하는지, Falco 룰이 올바른지 즉시 확인하기 어렵다

### 체감 난이도 비교
```
CKAD ██████░░░░ (패턴 반복, 속도 승부)
CKA  ████████░░ (인프라 관리 + 트러블슈팅)
CKS  ██████████ (보안 도구 + 시스템 레벨 + 시간 압박 + 복합 문제)
```

## 준비 팁

### 1. CKA 지식을 탄탄히 하라
- CKS는 CKA 위에 쌓는 시험이다. kubeadm 클러스터 관리, etcd 백업/복원, API server 설정 변경 등 CKA 핵심 역량이 CKS에서 그대로 활용된다
- 특히 `/etc/kubernetes/manifests/` 아래의 static pod 매니페스트를 수정하고 API server를 재시작하는 작업에 익숙해야 한다
- kubelet 설정 파일(`/var/lib/kubelet/config.yaml`)을 수정하고 `systemctl restart kubelet`을 실행하는 워크플로우를 체화하라

### 2. 보안 도구를 직접 사용해 보라
- **Falco**: 룰 문법(condition, output, priority)을 이해하고, 커스텀 룰을 작성할 수 있어야 한다. `falco_rules.local.yaml`에 룰을 추가하고 Falco를 재시작하는 흐름을 반복 연습하라
- **Trivy**: 이미지 스캔, 심각도 필터링(`--severity CRITICAL,HIGH`), exit code 설정(`--exit-code 1`)을 연습하라
- **kube-bench**: CIS Benchmark 점검 실행(`kube-bench run --targets master`) 및 결과 해석, 실패 항목 수정을 반복하라
- **OPA Gatekeeper**: ConstraintTemplate과 Constraint를 Rego로 작성하는 연습을 충분히 하라. Rego 문법에 익숙하지 않으면 시험에서 당황할 수 있다

### 3. 시간 관리 전략
- 각 문제의 배점과 난이도를 빠르게 파악하고, **배점이 높은 문제를 먼저** 풀어라
- 모르는 문제에 매달리지 말고 **플래그(flag)** 해두고 넘어가라
- NetworkPolicy, RBAC, Audit Policy 등 자주 나오는 유형은 반복 연습으로 속도를 올려라
- 마지막 15분은 반드시 검증 시간으로 확보하라
- 문제를 읽자마자 "이건 몇 분짜리 문제인가"를 판단하는 습관을 들여라. 평균적으로 문제당 6~8분을 넘기면 안 된다

### 4. YAML을 빠르게 작성하라
- `kubectl create` 명령으로 기본 YAML 골격을 생성하는 습관을 들여라:
  ```bash
  kubectl run nginx --image=nginx --dry-run=client -o yaml > pod.yaml
  kubectl create role viewer --verb=get,list --resource=pods --dry-run=client -o yaml
  kubectl create rolebinding viewer-binding --role=viewer --serviceaccount=default:mysa --dry-run=client -o yaml
  kubectl create clusterrole node-reader --verb=get,list --resource=nodes --dry-run=client -o yaml
  ```
- vi/vim 에디터에 익숙해져야 한다 (시험 환경에서 기본 에디터)
- `.vimrc`에 `set tabstop=2 shiftwidth=2 expandtab`을 설정하면 YAML 편집이 편해진다

### 5. 공식 문서 북마크를 준비하라
- 시험 중 참조할 수 있는 공식 문서의 핵심 페이지를 미리 파악하라
- 특히 다음 페이지를 북마크해 두어라:
  - NetworkPolicy: kubernetes.io/docs/concepts/services-networking/network-policies/
  - RBAC: kubernetes.io/docs/reference/access-authn-authz/rbac/
  - Audit Policy: kubernetes.io/docs/tasks/debug/debug-cluster/audit/
  - Pod Security Standards: kubernetes.io/docs/concepts/security/pod-security-standards/
  - Pod Security Admission: kubernetes.io/docs/concepts/security/pod-security-admission/
  - Admission Controllers: kubernetes.io/docs/reference/access-authn-authz/admission-controllers/
  - Encrypting Secret Data at Rest: kubernetes.io/docs/tasks/administer-cluster/encrypt-data/
  - RuntimeClass: kubernetes.io/docs/concepts/containers/runtime-class/
  - Falco: falco.org/docs/rules/
  - Trivy: aquasecurity.github.io/trivy/latest/

### 6. 실습 환경을 구축하라
- **killer.sh**: CKS 구매 시 제공되는 시뮬레이터로, 실제 시험과 가장 유사한 환경이다. 반드시 2회 세션을 모두 활용하라. killer.sh의 난이도가 실제 시험보다 약간 높으므로, 여기서 70% 이상 맞으면 실제 시험은 합격할 가능성이 높다
- **kubeadm**으로 직접 클러스터를 구축하고 보안 설정을 변경하는 연습을 하라
- Kind, Minikube는 CKS 실습에는 제한적이다. 가능하면 VM 기반(Vagrant, Multipass, 클라우드 VM) 클러스터를 사용하라
- tart VM을 활용하면 macOS에서도 손쉽게 다중 노드 클러스터를 구성할 수 있다

### 7. 핵심 파일 경로를 암기하라

| 경로 | 용도 |
|------|------|
| `/etc/kubernetes/manifests/kube-apiserver.yaml` | API Server static pod 매니페스트 |
| `/etc/kubernetes/manifests/etcd.yaml` | etcd static pod 매니페스트 |
| `/etc/kubernetes/manifests/kube-controller-manager.yaml` | Controller Manager 매니페스트 |
| `/etc/kubernetes/manifests/kube-scheduler.yaml` | Scheduler 매니페스트 |
| `/etc/kubernetes/pki/` | 인증서 디렉토리 |
| `/etc/kubernetes/pki/etcd/` | etcd 인증서 디렉토리 |
| `/etc/kubernetes/audit-policy.yaml` | Audit Policy 파일 (일반적 경로) |
| `/var/log/kubernetes/audit/audit.log` | Audit 로그 저장 경로 (일반적) |
| `/etc/apparmor.d/` | AppArmor 프로파일 디렉토리 |
| `/var/lib/kubelet/seccomp/` | seccomp 프로파일 디렉토리 |
| `/var/lib/kubelet/config.yaml` | kubelet 설정 파일 |
| `/etc/falco/falco_rules.yaml` | Falco 기본 룰 파일 |
| `/etc/falco/falco_rules.local.yaml` | Falco 커스텀 룰 파일 |
| `/etc/falco/falco.yaml` | Falco 메인 설정 파일 |
| `/etc/kubernetes/encryption-config.yaml` | Secret 암호화 설정 (일반적 경로) |
| `/etc/kubernetes/admission-control/` | Admission 관련 설정 (일반적 경로) |

### 8. 실패 시나리오도 연습하라
- API server 설정을 잘못 수정하면 API server가 기동되지 않는다. 이때 `crictl ps`, `crictl logs`, `journalctl -u kubelet` 등으로 문제를 진단하는 능력이 필요하다
- 시험 중 API server를 죽이면 그 문제뿐만 아니라 이후 문제에도 영향을 준다. 설정 변경 전 반드시 백업하는 습관을 들여라:
  ```bash
  cp /etc/kubernetes/manifests/kube-apiserver.yaml /tmp/kube-apiserver.yaml.bak
  ```
- 백업 후에도 API server가 복구되지 않으면 백업 파일로 즉시 원복하라:
  ```bash
  cp /tmp/kube-apiserver.yaml.bak /etc/kubernetes/manifests/kube-apiserver.yaml
  ```
- static pod는 매니페스트 파일이 변경되면 kubelet이 자동으로 재시작한다. `kubectl delete pod`로 직접 삭제할 필요 없이, 파일을 수정하면 kubelet이 감지하여 새 설정으로 Pod를 재생성한다

### 9. 자주 하는 실수를 피하라
- **YAML 들여쓰기 오류**: YAML은 공백 기반 들여쓰기만 허용한다. 탭을 사용하면 파싱 에러가 발생한다
- **context 전환 미수행**: 문제마다 `kubectl config use-context`를 실행해야 한다. 잊으면 엉뚱한 클러스터에 작업하게 된다
- **네임스페이스 지정 누락**: `-n <namespace>`를 빠뜨리면 default 네임스페이스에 리소스가 생성된다
- **API server 재시작 대기 미수행**: 매니페스트 수정 후 API server가 완전히 재시작될 때까지 기다려야 한다. `watch crictl ps`로 컨테이너 상태를 모니터링하라
- **Falco 룰 문법 오류**: Falco 룰의 condition에서 and/or 연산자 우선순위를 혼동하면 예상과 다른 결과가 나온다

## 참고 자료

| 자료 | 설명 |
|------|------|
| [CKS 공식 커리큘럼](https://github.com/cncf/curriculum) | CNCF 공식 시험 범위 문서 |
| [killer.sh CKS](https://killer.sh/cks) | 공식 시험 시뮬레이터 (구매 시 2회 세션 제공) |
| [Kubernetes Security 공식 문서](https://kubernetes.io/docs/concepts/security/) | K8s 보안 개념 공식 문서 |
| [Falco 공식 문서](https://falco.org/docs/) | 런타임 보안 모니터링 도구 |
| [Trivy 공식 문서](https://aquasecurity.github.io/trivy/) | 이미지 취약점 스캔 도구 |
| [CIS Kubernetes Benchmark](https://www.cisecurity.org/benchmark/kubernetes) | 쿠버네티스 보안 벤치마크 |
| [OPA Gatekeeper](https://open-policy-agent.github.io/gatekeeper/) | 정책 기반 Admission Controller |
| [Kubernetes Security Checklist](https://kubernetes.io/docs/concepts/security/security-checklist/) | K8s 공식 보안 체크리스트 |
