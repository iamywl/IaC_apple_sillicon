# CKS (Certified Kubernetes Security Specialist) 학습 가이드

## 시험 개요

CKS(Certified Kubernetes Security Specialist)는 CNCF(Cloud Native Computing Foundation)에서 주관하는 쿠버네티스 보안 전문가 자격증이다. 쿠버네티스 클러스터의 보안 설계, 구축, 운영에 대한 심화 역량을 검증하는 시험으로, CKA/CKAD/KCNA/KCSA 중 가장 높은 난이도를 자랑하는 실기 시험이다.

## 시험 정보

| 항목 | 내용 |
|------|------|
| **시험 형식** | 온라인 프록터 실기 시험 (Performance-based) |
| **시험 시간** | 2시간 (120분) |
| **합격 기준** | 67% (100점 만점 중 67점 이상) |
| **문제 수** | 15~20문제 (시험 회차에 따라 변동) |
| **시험 환경** | 실제 쿠버네티스 클러스터에서 CLI 기반 작업 수행 |
| **시험 비용** | $395 USD (1회 재시험 포함) |
| **유효 기간** | 2년 |
| **쿠버네티스 버전** | 시험 시점 기준 최신 안정 버전 (약 2개 마이너 버전 이내) |
| **선수 조건** | CKA (Certified Kubernetes Administrator) 자격증 보유 필수 |
| **허용 리소스** | 시험 중 공식 쿠버네티스 문서 접근 가능 |

## 선수 조건: CKA

CKS 시험에 응시하려면 반드시 CKA(Certified Kubernetes Administrator) 자격증을 보유하고 있어야 한다. CKA 자격증이 유효한 상태(취득 후 2년 이내)여야 CKS 시험 등록이 가능하다. CKS는 CKA에서 다루는 클러스터 관리 역량을 기반으로, 보안에 특화된 심화 내용을 평가하기 때문이다.

## 도메인별 출제 비율

CKS 시험은 총 6개 도메인으로 구성되며, 각 도메인의 출제 비율은 다음과 같다.

```
+-----------------------------------------------+--------+
| 도메인                                         | 비율   |
+-----------------------------------------------+--------+
| 1. Cluster Setup (클러스터 설정)                | 10%    |
| 2. Cluster Hardening (클러스터 강화)            | 15%    |
| 3. System Hardening (시스템 강화)               | 15%    |
| 4. Minimize Microservice Vulnerabilities       | 20%    |
|    (마이크로서비스 취약점 최소화)                  |        |
| 5. Supply Chain Security (공급망 보안)          | 20%    |
| 6. Monitoring, Logging and Runtime Security    | 20%    |
|    (모니터링, 로깅 및 런타임 보안)                |        |
+-----------------------------------------------+--------+
| 합계                                           | 100%   |
+-----------------------------------------------+--------+
```

### 도메인 1: Cluster Setup (10%)

클러스터의 초기 보안 설정에 관한 내용이다. NetworkPolicy를 이용한 네트워크 접근 제어, CIS Benchmark 적용, Ingress TLS 설정, 노드 메타데이터 보호, Dashboard 보안, 바이너리 무결성 검증 등을 포함한다.

### 도메인 2: Cluster Hardening (15%)

클러스터를 강화하는 방법에 관한 내용이다. RBAC 최소 권한 원칙, ServiceAccount 보안, kubeconfig 관리, API Server 접근 제한, 쿠버네티스 업그레이드를 통한 보안 패치 적용 등을 다룬다.

### 도메인 3: System Hardening (15%)

운영체제 및 호스트 레벨의 보안 강화에 관한 내용이다. OS 보안(최소 설치 원칙, 불필요한 서비스 비활성화), AppArmor/seccomp 프로파일 적용, Syscall 제한, IAM 역할 관리 등을 포함한다.

### 도메인 4: Minimize Microservice Vulnerabilities (20%)

마이크로서비스 아키텍처에서 발생할 수 있는 취약점을 최소화하는 방법이다. Pod Security Standards/Admission, OPA Gatekeeper, Secret 관리(HashiCorp Vault, sealed-secrets), RuntimeClass(gVisor, Kata Containers), mTLS(Istio) 등을 다룬다.

### 도메인 5: Supply Chain Security (20%)

소프트웨어 공급망의 보안에 관한 내용이다. 이미지 취약점 스캔(Trivy), ImagePolicyWebhook, 이미지 서명 및 검증(Cosign, Notary), 허용 레지스트리(Allowlist), Dockerfile 보안 모범 사례, 정적 분석(kubesec, conftest) 등을 포함한다.

### 도메인 6: Monitoring, Logging and Runtime Security (20%)

런타임 환경에서의 보안 모니터링 및 위협 탐지에 관한 내용이다. Audit Policy 설정, Falco 룰 작성, 컨테이너 불변성(readOnlyRootFilesystem), 런타임 이상 탐지, Sysdig/Falco를 이용한 위협 탐지 등을 다룬다.

## 시험 준비 전략

### 1. CKA 역량을 기반으로 보안 심화 학습

CKS는 CKA의 연장선에 있다. CKA에서 다루는 클러스터 관리, 네트워킹, 스토리지 등의 기본 역량 위에 보안 계층을 추가로 학습해야 한다.

### 2. 실습 환경 구축

CKS는 100% 실기 시험이므로, 반드시 실제 클러스터 환경에서 실습해야 한다. kubeadm으로 클러스터를 직접 구축하거나, kind/minikube 등의 로컬 환경을 활용할 수 있다. 특히 다음 도구들의 설치와 사용법을 반드시 익혀야 한다.

- kube-bench: CIS Benchmark 검사
- Trivy: 이미지 취약점 스캔
- Falco: 런타임 보안 모니터링
- kubesec: 매니페스트 보안 분석
- AppArmor/seccomp: 시스템 콜 제한

### 3. 시간 관리

2시간 안에 15~20문제를 풀어야 하므로, 문제당 평균 6~8분 내에 해결해야 한다. 어려운 문제는 표시(flag)해 두고 넘어간 뒤, 쉬운 문제를 먼저 풀어 점수를 확보하는 전략이 유효하다.

### 4. 공식 문서 숙달

시험 중 kubernetes.io 공식 문서에 접근할 수 있으므로, 문서의 구조와 보안 관련 페이지의 위치를 미리 숙지해 두어야 한다. 특히 다음 페이지들을 즐겨찾기해 두는 것을 권장한다.

- NetworkPolicy: https://kubernetes.io/docs/concepts/services-networking/network-policies/
- RBAC: https://kubernetes.io/docs/reference/access-authn-authz/rbac/
- Pod Security Standards: https://kubernetes.io/docs/concepts/security/pod-security-standards/
- Audit Policy: https://kubernetes.io/docs/tasks/debug/debug-cluster/audit/
- AppArmor: https://kubernetes.io/docs/tutorials/security/apparmor/
- seccomp: https://kubernetes.io/docs/tutorials/security/seccomp/
- Secrets: https://kubernetes.io/docs/concepts/configuration/secret/
- RuntimeClass: https://kubernetes.io/docs/concepts/containers/runtime-class/

### 5. 핵심 도구 명령어 암기

시험에서 자주 사용하는 명령어들은 반드시 외워 두어야 한다.

```bash
# RBAC 확인
kubectl auth can-i --list --as=system:serviceaccount:namespace:sa-name

# NetworkPolicy 조회
kubectl get networkpolicy -A

# Secret 관리
kubectl create secret generic my-secret --from-literal=key=value

# 이미지 스캔
trivy image nginx:latest

# CIS Benchmark
kube-bench run --targets=master

# Audit 로그 확인
cat /var/log/kubernetes/audit/audit.log | jq .

# Pod Security 라벨
kubectl label namespace my-ns pod-security.kubernetes.io/enforce=restricted
```

## 학습 자료 구성

| 파일 | 내용 |
|------|------|
| [01-concepts.md](./01-concepts.md) | 도메인별 핵심 개념 정리 |
| [02-examples.md](./02-examples.md) | 실전 예제 및 핸즈온 실습 |
| [03-exam-questions.md](./03-exam-questions.md) | 모의 시험 문제 40선 (해설 포함) |

## 시험 당일 체크리스트

- [ ] CKA 자격증이 유효한 상태인지 확인
- [ ] 여권 또는 영문 신분증 준비
- [ ] 웹캠, 마이크 정상 작동 확인
- [ ] 조용하고 깨끗한 시험 환경 확보 (책상 위 물건 정리)
- [ ] PSI Secure Browser 사전 설치 및 테스트
- [ ] 안정적인 인터넷 연결 확인
- [ ] 시험 시작 15분 전 로그인
- [ ] 즐겨찾기에 공식 문서 핵심 페이지 등록
- [ ] kubectl 자동 완성 설정 확인 (`source <(kubectl completion bash)`)
- [ ] alias 설정 (`alias k=kubectl`)
