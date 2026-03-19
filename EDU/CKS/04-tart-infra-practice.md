# CKS 실습 가이드 — tart-infra 활용

이 가이드는 tart-infra 환경을 활용하여 CKS 시험 범위의 보안 실습을 진행하는 방법을 안내한다.

## 사전 준비

```bash
export KUBECONFIG=kubeconfig/dev-kubeconfig
kubectl get nodes
```

## 1. Cluster Setup (10%) 실습

### 실습 1.1: NetworkPolicy 분석 [난이도: ★★☆]
dev 클러스터의 CiliumNetworkPolicy를 분석한다.
```bash
kubectl get cnp -n demo
kubectl get cnp default-deny -n demo -o yaml  # default deny 정책
kubectl get cnp allow-nginx-to-httpbin -n demo -o yaml  # L7 GET only
```
- **시험 주제**: NetworkPolicy를 사용한 클러스터 접근 제어

### 실습 1.2: CIS Benchmark [난이도: ★★★]
kube-bench를 dev-master에서 실행한다.
```bash
kubectl apply -f https://raw.githubusercontent.com/aquasecurity/kube-bench/main/job.yaml
kubectl logs job/kube-bench
```
- **시험 주제**: CIS Kubernetes Benchmark 적용

### 실습 1.3: 바이너리 검증 [난이도: ★☆☆]
```bash
ssh admin@<master-ip> 'sha512sum /usr/bin/kubelet'
# 공식 릴리스 체크섬과 비교
```

## 2. Cluster Hardening (15%) 실습

### 실습 2.1: RBAC 분석 [난이도: ★★☆]
```bash
kubectl get clusterrole | head -20
kubectl get clusterrolebinding | head -20
kubectl auth can-i --list --as=system:serviceaccount:demo:default -n demo
```
- **시험 주제**: RBAC 최소 권한 원칙

### 실습 2.2: ServiceAccount 보안 [난이도: ★★☆]
```bash
kubectl get sa -n demo
kubectl get pod <pod> -n demo -o jsonpath='{.spec.automountServiceAccountToken}'
```

### 실습 2.3: API Server 설정 확인 [난이도: ★★★]
```bash
ssh admin@<master-ip> 'sudo cat /etc/kubernetes/manifests/kube-apiserver.yaml' | grep -E "authorization-mode|enable-admission|anonymous-auth"
```

## 3. System Hardening (15%) 실습

### 실습 3.1: AppArmor 실습 [난이도: ★★★]
dev-worker1에 AppArmor 프로파일을 로드하고 Pod에 적용한다.
```bash
ssh admin@<worker-ip> 'sudo apparmor_parser -r /etc/apparmor.d/custom-nginx-profile'
# Pod에 annotation 추가: container.apparmor.security.beta.kubernetes.io/nginx: localhost/custom-nginx-profile
```

### 실습 3.2: seccomp 실습 [난이도: ★★☆]
RuntimeDefault seccomp 프로파일로 Pod를 생성한다.
```yaml
securityContext:
  seccompProfile:
    type: RuntimeDefault
```

### 실습 3.3: OS 서비스 점검 [난이도: ★☆☆]
```bash
ssh admin@<vm-ip> 'systemctl list-unit-files --state=enabled'
```

## 4. Minimize Microservice Vulnerabilities (20%) 실습

### 실습 4.1: Pod Security Admission [난이도: ★★★]
restricted 레벨의 네임스페이스를 생성하고 위반 Pod를 배포한다.
```bash
kubectl create ns psa-test
kubectl label ns psa-test pod-security.kubernetes.io/enforce=restricted
kubectl run test --image=nginx -n psa-test  # 실패 확인
```

### 실습 4.2: mTLS 확인 [난이도: ★★☆]
```bash
kubectl get peerauthentication -n demo -o yaml  # STRICT 모드
kubectl exec <pod> -c istio-proxy -n demo -- openssl s_client -connect httpbin:80
```

### 실습 4.3: Secret 보안 분석 [난이도: ★★☆]
```bash
kubectl get secret -n demo -o yaml | grep -A 1 "data:"  # base64 확인
echo "<base64값>" | base64 -d  # 쉽게 디코딩됨 → 보안 취약점
```

## 5. Supply Chain Security (20%) 실습

### 실습 5.1: Trivy 이미지 스캔 [난이도: ★★☆]
```bash
trivy image nginx:alpine
trivy image postgres:16-alpine
trivy image --severity CRITICAL,HIGH nginx:alpine
```

### 실습 5.2: 이미지 출처 확인 [난이도: ★☆☆]
```bash
kubectl get pods -n demo -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{range .spec.containers[*]}{.image}{", "}{end}{"\n"}{end}'
```

### 실습 5.3: Dockerfile 보안 분석 [난이도: ★★☆]
demo 앱 이미지의 USER, 베이스 이미지를 확인한다.

## 6. Monitoring, Logging and Runtime Security (20%) 실습

### 실습 6.1: Audit Policy 설정 [난이도: ★★★]
```bash
ssh admin@<master-ip> 'sudo cat /etc/kubernetes/audit-policy.yaml'  # 없으면 생성 실습
```

### 실습 6.2: Falco 설치 [난이도: ★★★]
dev 클러스터에 Falco DaemonSet을 배포하고 컨테이너 내 shell 실행을 탐지한다.
```bash
helm repo add falcosecurity https://falcosecurity.github.io/charts
helm install falco falcosecurity/falco --namespace falco --create-namespace
kubectl exec <nginx-pod> -n demo -- sh  # Falco 알림 확인
```

### 실습 6.3: 컨테이너 불변성 [난이도: ★★☆]
readOnlyRootFilesystem Pod를 생성하고 파일 쓰기를 시도한다.
```yaml
securityContext:
  readOnlyRootFilesystem: true
```

### 실습 6.4: AlertManager 보안 규칙 [난이도: ★☆☆]
```bash
kubectl get prometheusrule -n monitoring --kubeconfig kubeconfig/platform-kubeconfig
```
PodCrashLooping, PodOOMKilled 등 보안 관련 알림 규칙을 분석한다.
