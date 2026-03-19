# KCSA 실습 가이드 — tart-infra 활용

이 가이드는 tart-infra 환경을 활용하여 KCSA 시험 범위의 보안 실습을 진행하는 방법을 안내한다.

## 사전 준비
```bash
export KUBECONFIG=kubeconfig/dev-kubeconfig
```

## 1. Overview of Cloud Native Security (14%) 실습

### 실습 1.1: 4C 보안 모델 매핑
tart-infra의 4C 보안 레이어:
- **Cloud**: Tart VM (호스트 격리)
- **Cluster**: kubeadm K8s 클러스터 (RBAC, NetworkPolicy)
- **Container**: containerd (이미지 격리, securityContext)
- **Code**: demo 앱 (nginx, httpbin, keycloak — 코드 수준 보안)
- **관련 시험 주제**: 4C's of Cloud Native Security

### 실습 1.2: Attack Surface 분석
```bash
kubectl get svc -n demo --no-headers | grep NodePort  # 외부 노출 서비스: nginx(30080), keycloak(30880)
kubectl get svc -A --no-headers | grep NodePort  # 전체 클러스터 외부 노출 포트
```
- **관련 시험 주제**: Attack Surface, 위협 모델링

## 2. Kubernetes Cluster Component Security (22%) 실습

### 실습 2.1: API Server 보안 확인
```bash
ssh admin@<dev-master-ip> 'sudo cat /etc/kubernetes/manifests/kube-apiserver.yaml' | grep -E "authorization-mode|enable-admission|anonymous-auth|audit"
```
- **관련 시험 주제**: API Server 인증, 인가, Admission Control

### 실습 2.2: etcd 보안
```bash
ssh admin@<dev-master-ip> 'sudo cat /etc/kubernetes/manifests/etcd.yaml' | grep -E "client-cert|peer-cert|trusted-ca"
```
- **관련 시험 주제**: etcd 암호화, 접근 제어

### 실습 2.3: kubelet 보안
```bash
ssh admin@<dev-master-ip> 'sudo cat /var/lib/kubelet/config.yaml' | grep -E "authorization|anonymous|authentication"
```
- **관련 시험 주제**: kubelet 보안

### 실습 2.4: TLS 통신 확인
```bash
ssh admin@<dev-master-ip> 'ls /etc/kubernetes/pki/'  # 인증서 목록
kubectl get secret -n istio-system  # Istio TLS 인증서
```
- **관련 시험 주제**: Control Plane TLS

## 3. Kubernetes Security Fundamentals (22%) 실습

### 실습 3.1: NetworkPolicy 분석
```bash
kubectl get cnp -n demo  # 11개 CiliumNetworkPolicy
kubectl get cnp default-deny -n demo -o yaml  # Default Deny 정책
kubectl get cnp allow-nginx-to-httpbin -n demo -o yaml  # L7 GET only 필터링
```
- **관련 시험 주제**: NetworkPolicy (ingress/egress)

### 실습 3.2: RBAC 확인
```bash
kubectl get clusterrole | wc -l
kubectl get clusterrolebinding | head -20
kubectl auth can-i --list --as=system:serviceaccount:demo:default -n demo
```
- **관련 시험 주제**: RBAC (Role, ClusterRole, Binding)

### 실습 3.3: ServiceAccount
```bash
kubectl get sa -n demo
kubectl get pod <pod> -n demo -o jsonpath='{.spec.serviceAccountName}'
```
- **관련 시험 주제**: ServiceAccount, Token 관리

### 실습 3.4: Secret 관리
```bash
kubectl get secret -n demo
kubectl get secret <secret-name> -n demo -o jsonpath='{.data}' | base64 -d
# base64는 암호화가 아님 → encryption at rest 필요
```
- **관련 시험 주제**: Secret 관리, encryption at rest

## 4. Kubernetes Threat Model (16%) 실습

### 실습 4.1: STRIDE 위협 모델 적용
demo 앱에 STRIDE를 적용:
- **Spoofing**: ServiceAccount 토큰 탈취 가능성 → automountServiceAccountToken 확인
- **Tampering**: 이미지 무결성 → 이미지 다이제스트 사용 여부
- **Information Disclosure**: Secret base64 디코딩 → encryption at rest 필요
- **Denial of Service**: Resource limits 확인 → OOM 방지
- **Elevation of Privilege**: SecurityContext 확인 → runAsNonRoot
- **관련 시험 주제**: STRIDE, 위협 모델링

### 실습 4.2: 공급망 보안
```bash
kubectl get pods -n demo -o jsonpath='{range .items[*]}{.spec.containers[*].image}{"\n"}{end}' | sort -u
# nginx:alpine, kong/httpbin, redis:7-alpine, postgres:16-alpine, rabbitmq:3-mgmt, quay.io/keycloak/keycloak
```
- 이미지 출처 확인 (docker.io, quay.io)
- **관련 시험 주제**: 공급망 보안, 이미지 서명

## 5. Platform Security (16%) 실습

### 실습 5.1: mTLS 확인
```bash
kubectl get peerauthentication -n demo -o yaml  # STRICT mTLS
kubectl get peerauthentication -n istio-system -o yaml
```
- **관련 시험 주제**: 서비스 메시, mTLS

### 실습 5.2: L7 네트워크 정책
```bash
kubectl get cnp allow-nginx-to-httpbin -n demo -o yaml
# HTTP GET만 허용 → L7 필터링
```
- **관련 시험 주제**: 네트워크 보안, CNI

### 실습 5.3: 런타임 보안 (선택)
Falco를 dev 클러스터에 설치:
```bash
helm repo add falcosecurity https://falcosecurity.github.io/charts
helm install falco falcosecurity/falco -n falco --create-namespace --kubeconfig kubeconfig/dev-kubeconfig
```
- **관련 시험 주제**: 런타임 보안, Falco

## 6. Compliance and Security Frameworks (10%) 실습

### 실습 6.1: CIS Benchmark
```bash
kubectl apply -f https://raw.githubusercontent.com/aquasecurity/kube-bench/main/job.yaml --kubeconfig kubeconfig/dev-kubeconfig
kubectl logs job/kube-bench --kubeconfig kubeconfig/dev-kubeconfig
```
- **관련 시험 주제**: CIS Benchmarks, kube-bench

### 실습 6.2: Audit Logging
```bash
ssh admin@<dev-master-ip> 'sudo ls /var/log/kubernetes/audit/'  # audit log 확인
```
- **관련 시험 주제**: 감사 로깅
