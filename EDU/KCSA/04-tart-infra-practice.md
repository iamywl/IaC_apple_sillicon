# KCSA 실습 가이드 — tart-infra 환경 활용

> KCSA(Kubernetes and Cloud Native Security Associate) 시험 범위에 맞춰 tart-infra 실제 인프라를 활용하는 보안 실습 가이드이다.
> 4개 클러스터(platform, dev, staging, prod) 중 **dev 클러스터**의 demo 네임스페이스를 주로 활용한다.

---

## 인프라 보안 개요

| 클러스터 | 용도 | 보안 구성 |
|---------|------|----------|
| platform | 공통 인프라 | Prometheus + Grafana + Loki (monitoring ns) |
| dev | 개발/실습 | Istio mTLS + Cilium CNP 11개 + demo 앱 |
| staging | 스테이징 | 프로덕션 사전 검증 |
| prod | 프로덕션 | 운영 환경 |

### dev 클러스터 보안 구성 요약

| 구성요소 | 보안 기능 | 상세 |
|---------|----------|------|
| Cilium CNI | NetworkPolicy 11개 | default-deny + L7 GET only 규칙 |
| Istio | mTLS STRICT | PeerAuthentication 전체 적용 |
| RBAC | 역할 기반 접근 제어 | ClusterRole/Role 바인딩 |
| Secret | 민감정보 관리 | postgres pw=demo123, rabbitmq user=demo |
| ArgoCD | GitOps 배포 | auto-sync, github.com/iamywl/IaC_apple_sillicon.git |

---

## 사전 준비

```bash
# dev 클러스터 접근
export KUBECONFIG=kubeconfig/dev-kubeconfig
kubectl get nodes
kubectl get pods -n demo
```

---

## 1. Overview of Cloud Native Security (14%) 실습

### 실습 1.1: 4C 보안 모델 매핑 [난이도: ★☆☆]

**학습 목표:** Cloud Native Security의 4C(Cloud, Cluster, Container, Code) 모델을 tart-infra에 매핑하여 이해한다.

```bash
# === Cloud 레이어 ===
# Tart VM 기반 호스트 격리 확인
# 각 VM은 독립된 Ubuntu 인스턴스로 물리적 격리를 제공한다

# === Cluster 레이어 ===
# RBAC 확인
kubectl get clusterrole | wc -l
kubectl get clusterrolebinding | wc -l

# NetworkPolicy 확인
kubectl get ciliumnetworkpolicy -n demo | wc -l
# 예상 결과: 11개 CiliumNetworkPolicy

# === Container 레이어 ===
# 컨테이너 런타임 확인
ssh admin@<dev-master-ip> 'sudo crictl info | head -5'

# 컨테이너 이미지 목록
kubectl get pods -n demo -o jsonpath='{range .items[*]}{.spec.containers[*].image}{"\n"}{end}' | sort -u

# SecurityContext 확인
kubectl get pods -n demo -o jsonpath='{range .items[*]}{.metadata.name}: {.spec.containers[0].securityContext}{"\n"}{end}'

# === Code 레이어 ===
# 애플리케이션 포트 확인
kubectl get svc -n demo
# nginx-web: 80 (NodePort 30080)
# keycloak: 8080 (NodePort 30880)
```

**4C 매핑 정리:**

| 레이어 | tart-infra 구현 | 보안 통제 |
|--------|----------------|----------|
| Cloud | Tart VM (Apple Silicon) | 호스트 격리, SSH 접근 제어 |
| Cluster | kubeadm K8s | RBAC, NetworkPolicy, Admission Control |
| Container | containerd | SecurityContext, 이미지 격리 |
| Code | demo 앱 (nginx, httpbin 등) | 포트 제한, 환경변수 관리 |

**자기 점검:**
- [ ] 4C 각 레이어에서 보안 통제를 1개 이상 식별할 수 있는가?
- [ ] 각 레이어의 책임 범위를 설명할 수 있는가?

**관련 시험 주제:** 4C's of Cloud Native Security

---

### 실습 1.2: Attack Surface 분석 [난이도: ★★☆]

**학습 목표:** dev 클러스터의 공격 표면을 식별하고 위험도를 평가한다.

```bash
# 1. 외부 노출 서비스 식별
kubectl get svc -n demo --no-headers | grep NodePort
# 예상: nginx-web 30080, keycloak 30880

# 2. 전체 클러스터 외부 노출 포트 확인
kubectl get svc -A --no-headers | grep NodePort

# 3. 외부 접근 가능한 엔드포인트 테스트
# nginx-web 접근
curl -s http://<dev-node-ip>:30080 | head -5

# keycloak 접근
curl -s http://<dev-node-ip>:30880 | head -5

# 4. ClusterIP 서비스 (내부 전용)
kubectl get svc -n demo --no-headers | grep ClusterIP
# httpbin, redis, postgres, rabbitmq — 외부 접근 불가

# 5. API Server 포트 확인
kubectl cluster-info
# API 서버가 6443 포트에서 수신 대기

# 6. kubelet 포트 확인
ssh admin@<dev-master-ip> 'ss -tlnp | grep -E "10250|10255"'
# 10250: kubelet HTTPS (인증 필요)
# 10255: kubelet read-only (비활성화 권장)
```

**Attack Surface 분석표:**

| 대상 | 포트 | 프로토콜 | 위험도 | 비고 |
|------|------|---------|--------|------|
| nginx-web | 30080 | HTTP | 중 | 인증 없음 |
| keycloak | 30880 | HTTP | 고 | 관리 콘솔 노출 |
| API Server | 6443 | HTTPS | 고 | 인증 필수 |
| kubelet | 10250 | HTTPS | 고 | 인증 필수 |
| etcd | 2379 | gRPC | 최고 | TLS 클라이언트 인증 |

**자기 점검:**
- [ ] NodePort 서비스가 몇 개인지 확인했는가?
- [ ] 각 노출 포인트의 위험도를 평가할 수 있는가?
- [ ] 불필요한 노출을 줄이는 방법을 제안할 수 있는가?

**관련 시험 주제:** Attack Surface Analysis, Threat Vectors

---

### 실습 1.3: Defense in Depth 검증 [난이도: ★★☆]

**학습 목표:** 심층 방어(Defense in Depth) 원칙이 tart-infra에 어떻게 적용되었는지 검증한다.

```bash
# 레이어 1: 네트워크 격리 (Cilium NetworkPolicy)
kubectl get ciliumnetworkpolicy -n demo
# default-deny-ingress, default-deny-egress → 기본 차단 후 허용

# 레이어 2: 전송 암호화 (Istio mTLS)
kubectl get peerauthentication -n demo -o yaml | grep mode
# 예상: STRICT

# 레이어 3: 인증/인가 (RBAC)
kubectl auth can-i --list --as=system:serviceaccount:demo:default -n demo

# 레이어 4: Pod 보안 (SecurityContext)
kubectl get pods -n demo -o jsonpath='{range .items[*]}{.metadata.name}: runAsNonRoot={.spec.containers[0].securityContext.runAsNonRoot}{"\n"}{end}'

# 레이어 5: 모니터링 (Prometheus AlertRules)
kubectl get prometheusrule -n monitoring --kubeconfig kubeconfig/platform-kubeconfig
# 8개 PrometheusRule → 이상 탐지
```

**Defense in Depth 체크리스트:**

| 레이어 | 구현 | 상태 |
|--------|------|------|
| 네트워크 격리 | CiliumNetworkPolicy 11개 | ✅ |
| 전송 암호화 | Istio mTLS STRICT | ✅ |
| 인증/인가 | K8s RBAC | ✅ |
| Pod 보안 | SecurityContext | 부분 |
| 모니터링 | Prometheus + Grafana | ✅ |
| 감사 로깅 | Audit Log | 확인 필요 |

**자기 점검:**
- [ ] 5개 이상의 방어 레이어를 식별할 수 있는가?
- [ ] 각 레이어가 실패했을 때의 영향을 설명할 수 있는가?

**관련 시험 주제:** Defense in Depth, Security Layers

---

### 실습 1.4: Zero Trust 네트워크 확인 [난이도: ★★★]

**학습 목표:** tart-infra에서 Zero Trust 원칙이 어떻게 구현되었는지 확인한다.

```bash
# 1. Default Deny — 신뢰하지 않음
kubectl get ciliumnetworkpolicy default-deny-ingress -n demo -o yaml
kubectl get ciliumnetworkpolicy default-deny-egress -n demo -o yaml
# 모든 트래픽이 기본 차단 → 명시적 허용만 통과

# 2. Explicit Allow — 명시적 허용
kubectl get ciliumnetworkpolicy -n demo -o name | grep allow
# allow-nginx-to-httpbin, allow-httpbin-to-redis 등 필요한 경로만 허용

# 3. mTLS — 상호 인증
kubectl get peerauthentication -A -o yaml | grep -A 2 "mode"
# 모든 Pod 간 통신이 상호 TLS 인증

# 4. L7 정책 — 최소 권한
kubectl get ciliumnetworkpolicy allow-nginx-to-httpbin -n demo -o yaml
# HTTP GET만 허용 → POST, PUT, DELETE 차단

# 5. Zero Trust 위반 테스트
# nginx에서 httpbin으로 POST 시도 (차단되어야 함)
NGINX_POD=$(kubectl get pods -n demo -l app=nginx-web -o jsonpath='{.items[0].metadata.name}')
kubectl exec $NGINX_POD -n demo -- curl -s -X POST http://httpbin:8080/post -w "\n%{http_code}"
# 예상: 403 Forbidden 또는 연결 거부

# nginx에서 httpbin으로 GET 시도 (허용되어야 함)
kubectl exec $NGINX_POD -n demo -- curl -s http://httpbin:8080/get -w "\n%{http_code}"
# 예상: 200 OK
```

**자기 점검:**
- [ ] Default Deny + Explicit Allow 패턴을 설명할 수 있는가?
- [ ] L7 정책이 L3/L4 정책과 어떻게 다른지 설명할 수 있는가?
- [ ] mTLS가 Zero Trust에서 어떤 역할을 하는지 설명할 수 있는가?

**관련 시험 주제:** Zero Trust Architecture, Least Privilege

---

## 2. Kubernetes Cluster Component Security (22%) 실습

### 실습 2.1: API Server 보안 감사 [난이도: ★★★]

**학습 목표:** kube-apiserver의 보안 설정을 감사하고 취약점을 식별한다.

```bash
# 1. API Server 매니페스트 확인
ssh admin@<dev-master-ip> 'sudo cat /etc/kubernetes/manifests/kube-apiserver.yaml'

# 2. 핵심 보안 설정 추출
ssh admin@<dev-master-ip> 'sudo cat /etc/kubernetes/manifests/kube-apiserver.yaml' | grep -E \
  "authorization-mode|enable-admission|anonymous-auth|audit|encryption-provider|insecure-port|profiling|token-auth"

# 주요 확인 항목:
# --authorization-mode=Node,RBAC (ABAC 사용 금지)
# --anonymous-auth=false (익명 접근 차단)
# --enable-admission-plugins=NodeRestriction,... (Admission Controller 활성화)
# --insecure-port=0 (비암호화 포트 비활성화)
# --profiling=false (프로파일링 비활성화)

# 3. API Server 인증서 확인
ssh admin@<dev-master-ip> 'sudo ls -la /etc/kubernetes/pki/'
# ca.crt, ca.key — CA 인증서
# apiserver.crt, apiserver.key — API Server TLS
# apiserver-kubelet-client.crt — kubelet 클라이언트 인증서
# sa.key, sa.pub — ServiceAccount 서명 키

# 4. 인증서 유효기간 확인
ssh admin@<dev-master-ip> 'sudo openssl x509 -in /etc/kubernetes/pki/apiserver.crt -noout -dates'

# 5. API Server 접근 테스트
# 인증 없이 접근 시도 (차단되어야 함)
curl -k https://<dev-master-ip>:6443/api/v1/namespaces
# 예상: 401 Unauthorized

# 인증서를 사용한 접근
kubectl --kubeconfig kubeconfig/dev-kubeconfig get ns
# 예상: 정상 응답
```

**자기 점검:**
- [ ] authorization-mode에 RBAC이 포함되어 있는가?
- [ ] anonymous-auth가 비활성화되어 있는가?
- [ ] insecure-port가 0인가?
- [ ] 인증서 유효기간이 충분한가?

**관련 시험 주제:** API Server Authentication, Authorization, Admission Control

---

### 실습 2.2: etcd 보안 점검 [난이도: ★★★]

**학습 목표:** etcd의 보안 설정을 점검하고 데이터 보호 상태를 확인한다.

```bash
# 1. etcd 매니페스트 확인
ssh admin@<dev-master-ip> 'sudo cat /etc/kubernetes/manifests/etcd.yaml'

# 2. TLS 설정 확인
ssh admin@<dev-master-ip> 'sudo cat /etc/kubernetes/manifests/etcd.yaml' | grep -E \
  "cert-file|key-file|trusted-ca-file|client-cert-auth|peer"

# 핵심 확인 항목:
# --cert-file, --key-file — 서버 TLS 인증서
# --trusted-ca-file — CA 인증서
# --client-cert-auth=true — 클라이언트 인증서 필수
# --peer-cert-file, --peer-key-file — Peer 간 TLS

# 3. etcd 인증서 확인
ssh admin@<dev-master-ip> 'sudo ls -la /etc/kubernetes/pki/etcd/'
# ca.crt, ca.key — etcd CA
# server.crt, server.key — etcd 서버 인증서
# peer.crt, peer.key — Peer 통신 인증서
# healthcheck-client.crt — 헬스체크 클라이언트

# 4. etcd 데이터 디렉토리 권한 확인
ssh admin@<dev-master-ip> 'sudo ls -la /var/lib/etcd/'
# 권한이 700이어야 함 (소유자만 접근)

# 5. etcd에서 Secret 데이터 직접 읽기 (암호화 확인)
ssh admin@<dev-master-ip> 'sudo ETCDCTL_API=3 etcdctl \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key \
  get /registry/secrets/demo/ --prefix --keys-only | head -10'

# 6. encryption-provider-config 확인
ssh admin@<dev-master-ip> 'sudo cat /etc/kubernetes/manifests/kube-apiserver.yaml' | grep encryption
# encryption-provider-config가 설정되어 있으면 Secret이 암호화됨
```

**자기 점검:**
- [ ] etcd가 TLS로 보호되고 있는가?
- [ ] client-cert-auth가 활성화되어 있는가?
- [ ] etcd 데이터 디렉토리 권한이 적절한가?
- [ ] Secret at rest 암호화가 설정되어 있는가?

**관련 시험 주제:** etcd Security, Encryption at Rest

---

### 실습 2.3: kubelet 보안 설정 [난이도: ★★☆]

**학습 목표:** kubelet의 보안 설정을 확인하고 취약점을 식별한다.

```bash
# 1. kubelet 설정 파일 확인
ssh admin@<dev-master-ip> 'sudo cat /var/lib/kubelet/config.yaml'

# 2. 핵심 보안 설정 추출
ssh admin@<dev-master-ip> 'sudo cat /var/lib/kubelet/config.yaml' | grep -E \
  "authorization|anonymous|authentication|readOnlyPort|rotateCertificates|protectKernelDefaults"

# 확인 항목:
# authentication.anonymous.enabled: false
# authentication.webhook.enabled: true
# authorization.mode: Webhook
# readOnlyPort: 0 (비활성화)
# rotateCertificates: true (자동 인증서 갱신)

# 3. kubelet 포트 확인
ssh admin@<dev-master-ip> 'ss -tlnp | grep kubelet'
# 10250 (HTTPS) — 인증 필요
# 10255 — 비활성화 확인

# 4. kubelet API 직접 접근 테스트
# 인증 없이 접근 (차단되어야 함)
curl -sk https://<dev-master-ip>:10250/pods
# 예상: 401 Unauthorized

# 5. kubelet 인증서 확인
ssh admin@<dev-master-ip> 'sudo ls /var/lib/kubelet/pki/'
```

**자기 점검:**
- [ ] anonymous 인증이 비활성화되어 있는가?
- [ ] readOnlyPort가 0인가?
- [ ] authorization mode가 Webhook인가?

**관련 시험 주제:** kubelet Security Configuration

---

### 실습 2.4: Control Plane TLS 통신 검증 [난이도: ★★☆]

**학습 목표:** Control Plane 구성요소 간 TLS 통신을 검증한다.

```bash
# 1. 모든 PKI 인증서 목록
ssh admin@<dev-master-ip> 'sudo ls -la /etc/kubernetes/pki/ /etc/kubernetes/pki/etcd/'

# 2. 인증서 체인 확인
ssh admin@<dev-master-ip> 'sudo openssl x509 -in /etc/kubernetes/pki/apiserver.crt -noout -subject -issuer'
# subject: API Server
# issuer: kubernetes CA

# 3. kubeconfig 파일의 인증서 확인
ssh admin@<dev-master-ip> 'sudo cat /etc/kubernetes/admin.conf' | grep -E "certificate-authority|client-certificate"

# 4. scheduler와 controller-manager TLS 확인
ssh admin@<dev-master-ip> 'sudo cat /etc/kubernetes/manifests/kube-scheduler.yaml' | grep -E "kubeconfig|tls"
ssh admin@<dev-master-ip> 'sudo cat /etc/kubernetes/manifests/kube-controller-manager.yaml' | grep -E "kubeconfig|tls|root-ca"

# 5. 인증서 만료 일괄 확인
ssh admin@<dev-master-ip> 'sudo kubeadm certs check-expiration'
```

**자기 점검:**
- [ ] 모든 Control Plane 구성요소가 TLS를 사용하는가?
- [ ] 인증서 만료 일자를 확인했는가?
- [ ] CA 체인이 올바른가?

**관련 시험 주제:** Control Plane TLS, Certificate Management

---

### 실습 2.5: Admission Controller 확인 [난이도: ★★☆]

**학습 목표:** 활성화된 Admission Controller를 확인하고 보안 관련 컨트롤러를 이해한다.

```bash
# 1. 활성화된 Admission Controller 확인
ssh admin@<dev-master-ip> 'sudo cat /etc/kubernetes/manifests/kube-apiserver.yaml' | grep enable-admission

# 보안 관련 Admission Controller:
# NodeRestriction — kubelet이 자신의 Node와 Pod만 수정 가능
# PodSecurity — Pod Security Standards 적용
# AlwaysPullImages — 이미지를 항상 Pull (캐시된 이미지 사용 방지)

# 2. Pod Security Admission 동작 테스트
# restricted 레벨 네임스페이스 생성
kubectl create ns psa-test
kubectl label ns psa-test \
  pod-security.kubernetes.io/enforce=restricted \
  pod-security.kubernetes.io/warn=restricted

# privileged Pod 생성 시도 (거부되어야 함)
kubectl run test-priv --image=nginx --restart=Never -n psa-test \
  --overrides='{"spec":{"containers":[{"name":"nginx","image":"nginx","securityContext":{"privileged":true}}]}}'
# 예상: Error — 위반 메시지 출력

# 정리
kubectl delete ns psa-test
```

**자기 점검:**
- [ ] NodeRestriction Admission Controller의 역할을 설명할 수 있는가?
- [ ] Pod Security Standards의 3개 레벨(privileged, baseline, restricted)을 구분할 수 있는가?

**관련 시험 주제:** Admission Controllers, Pod Security Standards

---

## 3. Kubernetes Security Fundamentals (22%) 실습

### 실습 3.1: RBAC 심층 분석 [난이도: ★★☆]

**학습 목표:** RBAC 정책을 분석하고 최소 권한 원칙 준수 여부를 확인한다.

```bash
# 1. ClusterRole 목록
kubectl get clusterrole | head -20
kubectl get clusterrole | wc -l

# 2. 위험한 ClusterRole 식별
# cluster-admin 바인딩 확인
kubectl get clusterrolebinding -o json | jq '.items[] | select(.roleRef.name=="cluster-admin") | .subjects'

# 3. demo 네임스페이스의 Role 확인
kubectl get role -n demo
kubectl get rolebinding -n demo

# 4. ServiceAccount 권한 확인
kubectl auth can-i --list --as=system:serviceaccount:demo:default -n demo
# default SA의 권한이 최소한인지 확인

# 5. 특정 작업 권한 확인
kubectl auth can-i create pods --as=system:serviceaccount:demo:default -n demo
kubectl auth can-i delete secrets --as=system:serviceaccount:demo:default -n demo
kubectl auth can-i get secrets --as=system:serviceaccount:demo:default -n demo

# 6. 과도한 권한을 가진 ClusterRole 찾기
kubectl get clusterrole -o json | jq '.items[] | select(.rules[].resources[] == "*") | .metadata.name'

# 7. 커스텀 Role 생성 실습 (최소 권한)
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: pod-reader
rules:
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list", "watch"]
EOF

cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: read-pods
subjects:
  - kind: ServiceAccount
    name: default
    namespace: demo
roleRef:
  kind: Role
  name: pod-reader
  apiGroup: rbac.authorization.k8s.io
EOF

# 확인
kubectl auth can-i list pods --as=system:serviceaccount:demo:default -n demo
# 예상: yes

# 정리
kubectl delete role pod-reader -n demo
kubectl delete rolebinding read-pods -n demo
```

**자기 점검:**
- [ ] Role과 ClusterRole의 차이를 설명할 수 있는가?
- [ ] cluster-admin 바인딩이 최소한으로 유지되고 있는가?
- [ ] 최소 권한 원칙에 맞는 Role을 직접 작성할 수 있는가?

**관련 시험 주제:** RBAC, Role, ClusterRole, RoleBinding, ClusterRoleBinding

---

### 실습 3.2: CiliumNetworkPolicy 심층 분석 [난이도: ★★★]

**학습 목표:** 11개 CiliumNetworkPolicy를 분석하고 L3/L4/L7 규칙을 이해한다.

```bash
# 1. 전체 정책 목록
kubectl get ciliumnetworkpolicy -n demo
# 예상: 11개 정책

# 2. Default Deny 정책 분석
kubectl get ciliumnetworkpolicy default-deny-ingress -n demo -o yaml
kubectl get ciliumnetworkpolicy default-deny-egress -n demo -o yaml
# 모든 ingress/egress 트래픽을 기본 차단

# 3. Allow 정책 분석
kubectl get ciliumnetworkpolicy -n demo -o yaml | grep -B 5 -A 20 "endpointSelector"

# 4. L7 규칙 확인 (HTTP GET only)
kubectl get ciliumnetworkpolicy allow-nginx-to-httpbin -n demo -o yaml
# spec.egress[].toPorts[].rules.http[].method: GET
# HTTP GET만 허용, POST/PUT/DELETE 차단

# 5. L7 정책 테스트
NGINX_POD=$(kubectl get pods -n demo -l app=nginx-web -o jsonpath='{.items[0].metadata.name}')

# GET 요청 (허용)
kubectl exec $NGINX_POD -n demo -- curl -s -o /dev/null -w "%{http_code}" http://httpbin:8080/get
# 예상: 200

# POST 요청 (차단)
kubectl exec $NGINX_POD -n demo -- curl -s -o /dev/null -w "%{http_code}" -X POST http://httpbin:8080/post
# 예상: 403

# PUT 요청 (차단)
kubectl exec $NGINX_POD -n demo -- curl -s -o /dev/null -w "%{http_code}" -X PUT http://httpbin:8080/put
# 예상: 403

# DELETE 요청 (차단)
kubectl exec $NGINX_POD -n demo -- curl -s -o /dev/null -w "%{http_code}" -X DELETE http://httpbin:8080/delete
# 예상: 403

# 6. 허용되지 않은 Pod에서 접근 시도
REDIS_POD=$(kubectl get pods -n demo -l app=redis -o jsonpath='{.items[0].metadata.name}')
kubectl exec $REDIS_POD -n demo -- curl -s -o /dev/null -w "%{http_code}" http://httpbin:8080/get 2>/dev/null
# 예상: 연결 거부 또는 타임아웃

# 7. Cilium 정책 상태 확인
kubectl get ciliumnetworkpolicy -n demo -o jsonpath='{range .items[*]}{.metadata.name}: {.status.conditions[0].type}={.status.conditions[0].status}{"\n"}{end}'
```

**NetworkPolicy 요약표:**

| 정책명 | 유형 | L3/L4/L7 | 설명 |
|--------|------|---------|------|
| default-deny-ingress | Ingress | L3 | 모든 인바운드 차단 |
| default-deny-egress | Egress | L3 | 모든 아웃바운드 차단 |
| allow-nginx-to-httpbin | Egress | L7 | GET만 허용 |
| allow-dns | Egress | L4 | DNS(53) 허용 |
| 기타 allow-* | 양방향 | L3/L4 | 서비스 간 통신 허용 |

**자기 점검:**
- [ ] L3, L4, L7 정책의 차이를 설명할 수 있는가?
- [ ] Default Deny + Explicit Allow 패턴을 구현할 수 있는가?
- [ ] CiliumNetworkPolicy와 표준 NetworkPolicy의 차이를 설명할 수 있는가?

**관련 시험 주제:** NetworkPolicy, Network Segmentation, Microsegmentation

---

### 실습 3.3: ServiceAccount 보안 [난이도: ★★☆]

**학습 목표:** ServiceAccount의 보안 설정을 확인하고 강화 방법을 이해한다.

```bash
# 1. demo 네임스페이스 ServiceAccount 목록
kubectl get sa -n demo

# 2. Pod에 연결된 ServiceAccount 확인
kubectl get pods -n demo -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.serviceAccountName}{"\n"}{end}'

# 3. automountServiceAccountToken 확인
kubectl get pods -n demo -o jsonpath='{range .items[*]}{.metadata.name}: automount={.spec.automountServiceAccountToken}{"\n"}{end}'
# false로 설정되어야 불필요한 토큰 마운트를 방지함

# 4. ServiceAccount 토큰이 마운트된 경로 확인
NGINX_POD=$(kubectl get pods -n demo -l app=nginx-web -o jsonpath='{.items[0].metadata.name}')
kubectl exec $NGINX_POD -n demo -- ls /var/run/secrets/kubernetes.io/serviceaccount/ 2>/dev/null
# ca.crt, namespace, token — 토큰이 마운트되어 있으면 보안 위험

# 5. 토큰으로 API 접근 시도 (컨테이너 내부에서)
kubectl exec $NGINX_POD -n demo -- sh -c '
TOKEN=$(cat /var/run/secrets/kubernetes.io/serviceaccount/token)
curl -sk -H "Authorization: Bearer $TOKEN" https://kubernetes.default.svc/api/v1/namespaces/demo/pods
' 2>/dev/null | head -5
# RBAC에 의해 제한되어야 함

# 6. 보안 강화된 ServiceAccount 생성
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: v1
kind: ServiceAccount
metadata:
  name: secure-sa
automountServiceAccountToken: false
EOF

# 7. 보안 강화된 SA를 사용하는 Pod 생성
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: v1
kind: Pod
metadata:
  name: secure-pod
spec:
  serviceAccountName: secure-sa
  automountServiceAccountToken: false
  containers:
    - name: app
      image: busybox:1.36
      command: ["sh", "-c", "sleep 3600"]
EOF

# 토큰 마운트 확인 (마운트되지 않아야 함)
kubectl exec secure-pod -n demo -- ls /var/run/secrets/kubernetes.io/serviceaccount/ 2>/dev/null
# 예상: 디렉토리 없음

# 정리
kubectl delete pod secure-pod -n demo
kubectl delete sa secure-sa -n demo
```

**자기 점검:**
- [ ] automountServiceAccountToken의 역할을 설명할 수 있는가?
- [ ] ServiceAccount 토큰 탈취 시 발생할 수 있는 위험을 설명할 수 있는가?

**관련 시험 주제:** ServiceAccount Security, Token Management

---

### 실습 3.4: Secret 관리 및 보안 [난이도: ★★☆]

**학습 목표:** Secret의 보안 취약점을 이해하고 강화 방법을 학습한다.

```bash
# 1. demo 네임스페이스 Secret 목록
kubectl get secret -n demo
kubectl get secret -n demo -o custom-columns='NAME:.metadata.name,TYPE:.type'

# 2. Secret 데이터 디코딩 (base64는 암호화가 아님!)
kubectl get secret -n demo -o json | jq '.items[] | select(.type=="Opaque") | {name: .metadata.name, data: (.data | to_entries | map({key: .key, value: (.value | @base64d)}) | from_entries)}'

# postgres Secret 확인
kubectl get secret -n demo -l app=postgres -o jsonpath='{.items[0].data.POSTGRES_PASSWORD}' | base64 -d
# 예상: demo123

# 3. Secret이 환경변수로 주입된 Pod 확인
kubectl get pod -n demo -o jsonpath='{range .items[*]}{.metadata.name}: {range .spec.containers[*].env[*]}{.name}={.valueFrom.secretKeyRef.name}/{.valueFrom.secretKeyRef.key} {end}{"\n"}{end}' | grep -v "^$"

# 4. etcd에서 Secret 암호화 상태 확인
ssh admin@<dev-master-ip> 'sudo cat /etc/kubernetes/manifests/kube-apiserver.yaml' | grep encryption-provider
# encryption-provider-config가 없으면 Secret이 평문으로 etcd에 저장됨

# 5. EncryptionConfiguration 생성 실습 (참고)
cat <<'EOF'
# /etc/kubernetes/enc/encryption-config.yaml
apiVersion: apiserver.config.k8s.io/v1
kind: EncryptionConfiguration
resources:
  - resources:
      - secrets
    providers:
      - aescbc:
          keys:
            - name: key1
              secret: <base64-encoded-32-byte-key>
      - identity: {}
EOF
```

**보안 위험 분석:**

| 위험 | 설명 | 완화 방법 |
|------|------|----------|
| base64 디코딩 | Secret은 base64일 뿐 암호화 아님 | RBAC으로 Secret 접근 제한 |
| etcd 평문 저장 | 디스크에 평문으로 저장 | EncryptionConfiguration 적용 |
| 환경변수 노출 | env로 주입 시 프로세스 환경에 노출 | volume mount 방식 사용 |

**자기 점검:**
- [ ] base64 인코딩과 암호화의 차이를 설명할 수 있는가?
- [ ] Secret at rest 암호화를 설정할 수 있는가?
- [ ] Secret을 안전하게 관리하는 3가지 방법을 나열할 수 있는가?

**관련 시험 주제:** Secret Management, Encryption at Rest

---

### 실습 3.5: Pod Security Standards 실습 [난이도: ★★★]

**학습 목표:** Pod Security Admission으로 Pod Security Standards를 적용하고 테스트한다.

```bash
# 1. 현재 네임스페이스의 PSA 라벨 확인
kubectl get ns demo -o yaml | grep pod-security

# 2. baseline 레벨 네임스페이스 생성
kubectl create ns psa-baseline
kubectl label ns psa-baseline \
  pod-security.kubernetes.io/enforce=baseline \
  pod-security.kubernetes.io/warn=baseline \
  pod-security.kubernetes.io/audit=baseline

# 3. baseline 위반 테스트 — privileged Pod
cat <<'EOF' | kubectl apply -n psa-baseline -f - 2>&1
apiVersion: v1
kind: Pod
metadata:
  name: privileged-test
spec:
  containers:
    - name: nginx
      image: nginx:alpine
      securityContext:
        privileged: true
EOF
# 예상: Error — privileged 컨테이너 차단

# 4. baseline 준수 Pod
cat <<'EOF' | kubectl apply -n psa-baseline -f -
apiVersion: v1
kind: Pod
metadata:
  name: baseline-ok
spec:
  containers:
    - name: nginx
      image: nginx:alpine
EOF
# 예상: 생성 성공

# 5. restricted 레벨 네임스페이스 생성
kubectl create ns psa-restricted
kubectl label ns psa-restricted \
  pod-security.kubernetes.io/enforce=restricted \
  pod-security.kubernetes.io/warn=restricted

# 6. restricted 위반 테스트 — root 사용자
cat <<'EOF' | kubectl apply -n psa-restricted -f - 2>&1
apiVersion: v1
kind: Pod
metadata:
  name: root-test
spec:
  containers:
    - name: nginx
      image: nginx:alpine
EOF
# 예상: Warning — runAsNonRoot, seccompProfile 등 미설정

# 7. restricted 준수 Pod
cat <<'EOF' | kubectl apply -n psa-restricted -f -
apiVersion: v1
kind: Pod
metadata:
  name: restricted-ok
spec:
  securityContext:
    runAsNonRoot: true
    runAsUser: 1000
    seccompProfile:
      type: RuntimeDefault
  containers:
    - name: app
      image: busybox:1.36
      command: ["sh", "-c", "sleep 3600"]
      securityContext:
        allowPrivilegeEscalation: false
        capabilities:
          drop: ["ALL"]
EOF
# 예상: 생성 성공

# 정리
kubectl delete ns psa-baseline psa-restricted
```

**Pod Security Standards 비교:**

| 레벨 | 제한 사항 | 사용 시나리오 |
|------|----------|-------------|
| privileged | 제한 없음 | 시스템 컴포넌트 |
| baseline | hostNetwork, privileged 차단 | 일반 워크로드 |
| restricted | non-root, drop ALL capabilities | 보안 중요 워크로드 |

**자기 점검:**
- [ ] 3개 레벨의 차이를 설명할 수 있는가?
- [ ] restricted 레벨 Pod 스펙을 작성할 수 있는가?

**관련 시험 주제:** Pod Security Standards, Pod Security Admission

---

### 실습 3.6: NetworkPolicy 직접 작성 [난이도: ★★★]

**학습 목표:** 표준 Kubernetes NetworkPolicy를 직접 작성하고 테스트한다.

```bash
# 1. 테스트 네임스페이스 생성
kubectl create ns netpol-test

# 2. 테스트 Pod 배포
kubectl run web --image=nginx:alpine --port=80 -n netpol-test
kubectl run client --image=busybox:1.36 --restart=Never -n netpol-test -- sleep 3600
kubectl run blocked --image=busybox:1.36 --restart=Never -n netpol-test --labels="role=blocked" -- sleep 3600

# 대기
kubectl wait --for=condition=ready pod/web pod/client pod/blocked -n netpol-test --timeout=60s

# 3. 정책 적용 전 — 모든 접근 가능
kubectl exec client -n netpol-test -- wget -qO- --timeout=3 http://web
# 예상: nginx 기본 페이지

kubectl exec blocked -n netpol-test -- wget -qO- --timeout=3 http://web
# 예상: nginx 기본 페이지

# 4. Default Deny Ingress 정책 적용
cat <<'EOF' | kubectl apply -n netpol-test -f -
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-ingress
spec:
  podSelector: {}
  policyTypes:
    - Ingress
EOF

# 5. 정책 적용 후 — 모든 접근 차단
kubectl exec client -n netpol-test -- wget -qO- --timeout=3 http://web 2>&1
# 예상: 타임아웃

# 6. 선택적 허용 정책 추가
cat <<'EOF' | kubectl apply -n netpol-test -f -
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-client-to-web
spec:
  podSelector:
    matchLabels:
      run: web
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              run: client
      ports:
        - protocol: TCP
          port: 80
EOF

# 7. client에서 접근 (허용)
kubectl exec client -n netpol-test -- wget -qO- --timeout=3 http://web
# 예상: nginx 기본 페이지

# 8. blocked에서 접근 (차단)
kubectl exec blocked -n netpol-test -- wget -qO- --timeout=3 http://web 2>&1
# 예상: 타임아웃

# 정리
kubectl delete ns netpol-test
```

**자기 점검:**
- [ ] podSelector와 namespaceSelector를 조합하여 정책을 작성할 수 있는가?
- [ ] ingress와 egress 규칙의 차이를 설명할 수 있는가?

**관련 시험 주제:** NetworkPolicy, Pod-to-Pod Network Security

---

## 4. Kubernetes Threat Model (16%) 실습

### 실습 4.1: STRIDE 위협 모델링 [난이도: ★★☆]

**학습 목표:** STRIDE 프레임워크를 demo 앱에 적용하여 위협을 식별한다.

```bash
# === Spoofing (신원 위장) ===
# ServiceAccount 토큰 탈취 가능성 확인
NGINX_POD=$(kubectl get pods -n demo -l app=nginx-web -o jsonpath='{.items[0].metadata.name}')
kubectl exec $NGINX_POD -n demo -- cat /var/run/secrets/kubernetes.io/serviceaccount/token 2>/dev/null | head -c 50
# 토큰이 존재하면 → automountServiceAccountToken: false 필요

# === Tampering (변조) ===
# 이미지 다이제스트 사용 여부 확인
kubectl get pods -n demo -o jsonpath='{range .items[*]}{.spec.containers[*].image}{"\n"}{end}' | sort -u
# nginx:alpine (태그) vs nginx@sha256:... (다이제스트)
# 태그 사용 시 → 이미지 변조 가능성

# readOnlyRootFilesystem 확인
kubectl get pods -n demo -o jsonpath='{range .items[*]}{.metadata.name}: readOnly={.spec.containers[0].securityContext.readOnlyRootFilesystem}{"\n"}{end}'

# === Repudiation (부인) ===
# Audit Log 확인
ssh admin@<dev-master-ip> 'sudo ls /var/log/kubernetes/audit/ 2>/dev/null || echo "audit log not configured"'

# === Information Disclosure (정보 노출) ===
# Secret base64 디코딩
kubectl get secret -n demo -o jsonpath='{range .items[*]}{.metadata.name}: {.type}{"\n"}{end}'
# Opaque Secret은 base64 → 쉽게 디코딩 가능

# 환경변수로 주입된 Secret 확인
kubectl exec $NGINX_POD -n demo -- env 2>/dev/null | grep -i pass

# === Denial of Service (서비스 거부) ===
# Resource Limits 확인
kubectl get pods -n demo -o jsonpath='{range .items[*]}{.metadata.name}: limits={.spec.containers[0].resources.limits}{"\n"}{end}'
# limits 미설정 시 → 리소스 고갈 공격 가능

# HPA 확인 (자동 스케일링으로 DoS 완화)
kubectl get hpa -n demo
# nginx-web: 3→10, httpbin: 2→6

# === Elevation of Privilege (권한 상승) ===
# SecurityContext 확인
kubectl get pods -n demo -o jsonpath='{range .items[*]}{.metadata.name}: privileged={.spec.containers[0].securityContext.privileged}, runAsRoot={.spec.containers[0].securityContext.runAsNonRoot}{"\n"}{end}'

# capabilities 확인
kubectl get pods -n demo -o jsonpath='{range .items[*]}{.metadata.name}: capabilities={.spec.containers[0].securityContext.capabilities}{"\n"}{end}'
```

**STRIDE 분석 결과표:**

| 위협 | 대상 | 현재 상태 | 완화 방법 |
|------|------|----------|----------|
| Spoofing | SA 토큰 | 마운트됨 | automountServiceAccountToken: false |
| Tampering | 이미지 태그 | 태그 사용 | 다이제스트 사용 |
| Repudiation | Audit Log | 미확인 | Audit Policy 설정 |
| Info Disclosure | Secret | base64 | Encryption at Rest |
| DoS | 리소스 | HPA 설정됨 | Resource Limits 확인 |
| EoP | 컨테이너 | 부분 설정 | restricted SecurityContext |

**자기 점검:**
- [ ] STRIDE 각 항목을 demo 앱에 매핑할 수 있는가?
- [ ] 각 위협의 완화 방법을 1개 이상 제시할 수 있는가?

**관련 시험 주제:** STRIDE, Threat Modeling

---

### 실습 4.2: 공급망 보안 분석 [난이도: ★★☆]

**학습 목표:** 컨테이너 이미지 공급망의 보안을 분석한다.

```bash
# 1. 사용 중인 이미지 목록
kubectl get pods -n demo -o jsonpath='{range .items[*]}{.spec.containers[*].image}{"\n"}{end}' | sort -u
# 예상:
# nginx:alpine
# kong/httpbin (또는 유사)
# redis:7-alpine
# postgres:16-alpine
# rabbitmq:3-management-alpine
# quay.io/keycloak/keycloak
# istio/proxyv2 (sidecar)

# 2. 이미지 레지스트리 분석
# docker.io (기본) — nginx, redis, postgres, rabbitmq
# quay.io — keycloak
# gcr.io/istio — istio proxy

# 3. 이미지 태그 vs 다이제스트
# 태그 사용 시 위험: 같은 태그에 다른 이미지가 push될 수 있음
# 다이제스트 사용 권장: nginx@sha256:abc123...

# 4. 이미지 취약점 스캔 (Trivy 설치 필요)
# trivy image nginx:alpine
# trivy image postgres:16-alpine
# trivy image --severity CRITICAL,HIGH nginx:alpine

# 5. 베이스 이미지 분석
# alpine 기반 이미지가 많음 → 최소 이미지 원칙 준수
# 확인: 각 이미지의 OS 패키지 수
# docker run --rm nginx:alpine apk list --installed | wc -l

# 6. ImagePullPolicy 확인
kubectl get pods -n demo -o jsonpath='{range .items[*]}{.metadata.name}: {.spec.containers[0].imagePullPolicy}{"\n"}{end}'
# Always — 항상 최신 이미지 Pull (권장)
# IfNotPresent — 캐시된 이미지 사용 (보안 위험)
```

**자기 점검:**
- [ ] 이미지 태그와 다이제스트의 보안 차이를 설명할 수 있는가?
- [ ] 이미지 취약점 스캔 도구를 1개 이상 나열할 수 있는가?
- [ ] 최소 베이스 이미지의 장점을 설명할 수 있는가?

**관련 시험 주제:** Supply Chain Security, Image Security

---

### 실습 4.3: 컨테이너 격리 수준 분석 [난이도: ★★★]

**학습 목표:** 컨테이너 런타임의 격리 메커니즘을 이해하고 취약점을 식별한다.

```bash
# 1. 컨테이너 런타임 확인
ssh admin@<dev-master-ip> 'sudo crictl info | grep -E "runtimeType|runtimeVersion"'
# containerd 사용

# 2. 컨테이너 프로세스 격리 확인 (namespace)
NGINX_POD=$(kubectl get pods -n demo -l app=nginx-web -o jsonpath='{.items[0].metadata.name}')

# PID namespace 격리
kubectl exec $NGINX_POD -n demo -- ps aux
# 컨테이너 내부에서는 자신의 프로세스만 보임

# 3. 네트워크 namespace 격리
kubectl exec $NGINX_POD -n demo -- ip addr
# 컨테이너 고유의 네트워크 인터페이스

# 4. 파일시스템 격리
kubectl exec $NGINX_POD -n demo -- df -h
# 컨테이너 고유의 파일시스템

# 5. 사용자 확인
kubectl exec $NGINX_POD -n demo -- id
# root(0) vs non-root 확인

# 6. 커널 capabilities 확인
kubectl exec $NGINX_POD -n demo -- cat /proc/1/status | grep -i cap
# CapBnd (Bounding set) — 컨테이너에 허용된 capabilities

# 7. seccomp 프로파일 확인
kubectl get pod $NGINX_POD -n demo -o jsonpath='{.spec.containers[0].securityContext.seccompProfile}'
# RuntimeDefault 또는 미설정
```

**자기 점검:**
- [ ] Linux namespace의 종류(PID, Network, Mount, UTS, IPC, User)를 설명할 수 있는가?
- [ ] capabilities drop의 보안 효과를 설명할 수 있는가?

**관련 시험 주제:** Container Isolation, Linux Namespaces, Capabilities

---

### 실습 4.4: Kubernetes 공격 벡터 시뮬레이션 [난이도: ★★★]

**학습 목표:** 일반적인 K8s 공격 벡터를 시뮬레이션하고 방어 메커니즘을 확인한다.

```bash
# 공격 벡터 1: 컨테이너 탈출 시도
# privileged 컨테이너 생성 시도
cat <<'EOF' | kubectl apply -n demo -f - 2>&1
apiVersion: v1
kind: Pod
metadata:
  name: escape-test
spec:
  containers:
    - name: attacker
      image: busybox:1.36
      command: ["sh", "-c", "sleep 3600"]
      securityContext:
        privileged: true
EOF
# PSA 정책에 따라 거부될 수 있음

# 공격 벡터 2: 메타데이터 서비스 접근
NGINX_POD=$(kubectl get pods -n demo -l app=nginx-web -o jsonpath='{.items[0].metadata.name}')
kubectl exec $NGINX_POD -n demo -- curl -s --connect-timeout 3 http://169.254.169.254/latest/meta-data/ 2>/dev/null
# 클라우드 환경이 아니므로 접근 불가하지만, 클라우드에서는 NetworkPolicy로 차단 필요

# 공격 벡터 3: 다른 네임스페이스 접근 시도
kubectl exec $NGINX_POD -n demo -- curl -s --connect-timeout 3 http://kubernetes.default.svc:443 2>/dev/null
# NetworkPolicy에 의해 차단될 수 있음

# 공격 벡터 4: DNS exfiltration 시도
kubectl exec $NGINX_POD -n demo -- nslookup test.attacker.example.com 2>/dev/null
# Egress NetworkPolicy에 의해 DNS가 허용된 경우만 동작

# 공격 벡터 5: 호스트 경로 마운트 시도
cat <<'EOF' | kubectl apply -n demo -f - 2>&1
apiVersion: v1
kind: Pod
metadata:
  name: hostpath-test
spec:
  containers:
    - name: attacker
      image: busybox:1.36
      command: ["sh", "-c", "sleep 3600"]
      volumeMounts:
        - name: host-root
          mountPath: /host
  volumes:
    - name: host-root
      hostPath:
        path: /
EOF
# PSA restricted 레벨에서는 거부됨

# 정리
kubectl delete pod escape-test hostpath-test -n demo --ignore-not-found
```

**자기 점검:**
- [ ] 5가지 공격 벡터를 나열하고 각각의 방어 방법을 설명할 수 있는가?
- [ ] privileged 컨테이너의 위험성을 설명할 수 있는가?

**관련 시험 주제:** Attack Vectors, Container Escape, Privilege Escalation

---

## 5. Platform Security (16%) 실습

### 실습 5.1: Istio mTLS 검증 [난이도: ★★☆]

**학습 목표:** Istio mTLS가 올바르게 동작하는지 검증한다.

```bash
# 1. PeerAuthentication 확인
kubectl get peerauthentication -n demo -o yaml
# 예상: mode: STRICT

kubectl get peerauthentication -n istio-system -o yaml
# mesh-wide 설정 확인

# 2. mTLS 상태 확인 (istioctl 사용 가능 시)
# istioctl authn tls-check <pod-name>.demo

# 3. Istio 프록시에서 TLS 인증서 확인
NGINX_POD=$(kubectl get pods -n demo -l app=nginx-web -o jsonpath='{.items[0].metadata.name}')
kubectl exec $NGINX_POD -c istio-proxy -n demo -- ls /etc/certs/ 2>/dev/null || \
kubectl exec $NGINX_POD -c istio-proxy -n demo -- ls /var/run/secrets/istio/ 2>/dev/null

# 4. mTLS 통신 관찰 (istio-proxy 로그)
kubectl logs $NGINX_POD -c istio-proxy -n demo --tail=10
# TLS 핸드셰이크 정보 확인

# 5. STRICT 모드에서 비-mesh 트래픽 차단 확인
# Istio sidecar 없는 Pod에서 demo 서비스 접근 시도
kubectl create ns no-mesh
kubectl run curl-test --image=busybox:1.36 --restart=Never -n no-mesh -- \
  sh -c 'wget -qO- --timeout=5 http://httpbin.demo.svc:8080/get 2>&1; echo "exit: $?"'
sleep 5
kubectl logs curl-test -n no-mesh
# STRICT mTLS에서는 실패해야 함 (mTLS 인증서 없으므로)

# 정리
kubectl delete ns no-mesh
```

**자기 점검:**
- [ ] mTLS STRICT와 PERMISSIVE의 차이를 설명할 수 있는가?
- [ ] PeerAuthentication의 적용 범위(mesh-wide, namespace, workload)를 구분할 수 있는가?

**관련 시험 주제:** Service Mesh Security, mTLS

---

### 실습 5.2: Cilium L7 보안 정책 심화 [난이도: ★★★]

**학습 목표:** Cilium의 L7 보안 정책을 심층 분석하고 커스텀 정책을 작성한다.

```bash
# 1. L7 HTTP 정책 상세 분석
kubectl get ciliumnetworkpolicy allow-nginx-to-httpbin -n demo -o yaml
# HTTP method, path 기반 필터링 확인

# 2. L7 정책 테스트 매트릭스
NGINX_POD=$(kubectl get pods -n demo -l app=nginx-web -o jsonpath='{.items[0].metadata.name}')

echo "=== GET /get (허용) ==="
kubectl exec $NGINX_POD -n demo -- curl -s -o /dev/null -w "%{http_code}" http://httpbin:8080/get

echo "=== GET /headers (허용) ==="
kubectl exec $NGINX_POD -n demo -- curl -s -o /dev/null -w "%{http_code}" http://httpbin:8080/headers

echo "=== POST /post (차단) ==="
kubectl exec $NGINX_POD -n demo -- curl -s -o /dev/null -w "%{http_code}" -X POST http://httpbin:8080/post

echo "=== PUT /put (차단) ==="
kubectl exec $NGINX_POD -n demo -- curl -s -o /dev/null -w "%{http_code}" -X PUT http://httpbin:8080/put

echo "=== DELETE /delete (차단) ==="
kubectl exec $NGINX_POD -n demo -- curl -s -o /dev/null -w "%{http_code}" -X DELETE http://httpbin:8080/delete

# 3. Cilium 정책 적용 상태 확인
kubectl get ciliumendpoint -n demo -o jsonpath='{range .items[*]}{.metadata.name}: policy={.status.policy.realized.allowed-egress-identities}{"\n"}{end}'

# 4. 커스텀 L7 정책 작성 (예: /api/* 경로만 허용)
cat <<'EOF'
# 참고: 아래 정책은 /api/ 하위 경로의 GET만 허용하는 예제
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: custom-l7-policy
  namespace: demo
spec:
  endpointSelector:
    matchLabels:
      app: httpbin
  ingress:
    - fromEndpoints:
        - matchLabels:
            app: nginx-web
      toPorts:
        - ports:
            - port: "8080"
              protocol: TCP
          rules:
            http:
              - method: GET
                path: "/api/.*"
EOF
```

**자기 점검:**
- [ ] L7 정책에서 HTTP method와 path 필터링을 설정할 수 있는가?
- [ ] L7 정책의 성능 영향을 설명할 수 있는가?

**관련 시험 주제:** Network Security, CNI, Layer 7 Policy

---

### 실습 5.3: ArgoCD GitOps 보안 [난이도: ★★☆]

**학습 목표:** ArgoCD를 통한 GitOps 배포의 보안 측면을 이해한다.

```bash
# 1. ArgoCD Application 확인
kubectl get application -n argocd --kubeconfig kubeconfig/dev-kubeconfig
# auto-sync 활성화 — Git 변경이 자동으로 클러스터에 반영

# 2. ArgoCD 프로젝트 확인
kubectl get appproject -n argocd --kubeconfig kubeconfig/dev-kubeconfig -o yaml

# 3. ArgoCD RBAC 확인
kubectl get configmap argocd-rbac-cm -n argocd --kubeconfig kubeconfig/dev-kubeconfig -o yaml

# 4. Git 리포지토리 접근 보안
kubectl get secret -n argocd --kubeconfig kubeconfig/dev-kubeconfig | grep repo
# Git credentials가 Secret으로 저장됨

# 5. 동기화 정책 확인
kubectl get application -n argocd --kubeconfig kubeconfig/dev-kubeconfig -o jsonpath='{range .items[*]}{.metadata.name}: syncPolicy={.spec.syncPolicy}{"\n"}{end}'
# auto-sync: Git→Cluster 자동 동기화
# prune: Git에서 삭제된 리소스 자동 제거
```

**GitOps 보안 체크리스트:**

| 항목 | 설명 | 확인 |
|------|------|------|
| Git 저장소 접근 | SSH 키 또는 토큰 사용 | [ ] |
| RBAC | 최소 권한 프로젝트 설정 | [ ] |
| 동기화 정책 | auto-prune 주의 | [ ] |
| Secret 관리 | Git에 Secret 평문 저장 금지 | [ ] |
| 감사 | ArgoCD 변경 이력 확인 | [ ] |

**자기 점검:**
- [ ] GitOps에서 Git 저장소가 "single source of truth"인 이유를 설명할 수 있는가?
- [ ] auto-sync의 보안 위험을 설명할 수 있는가?

**관련 시험 주제:** GitOps Security, CI/CD Security

---

### 실습 5.4: 런타임 보안 — Falco 설치 및 활용 [난이도: ★★★]

**학습 목표:** Falco를 설치하고 런타임 위협을 탐지한다.

```bash
# 1. Falco 설치 (Helm)
helm repo add falcosecurity https://falcosecurity.github.io/charts
helm repo update

helm install falco falcosecurity/falco \
  --namespace falco --create-namespace \
  --set falcosidekick.enabled=true \
  --kubeconfig kubeconfig/dev-kubeconfig

# 설치 확인
kubectl get pods -n falco --kubeconfig kubeconfig/dev-kubeconfig

# 2. Falco 규칙 확인
kubectl get configmap falco -n falco --kubeconfig kubeconfig/dev-kubeconfig -o yaml | head -50

# 3. 의심스러운 활동 시뮬레이션

# 시뮬레이션 1: 컨테이너 내 셸 실행
NGINX_POD=$(kubectl get pods -n demo -l app=nginx-web -o jsonpath='{.items[0].metadata.name}')
kubectl exec -it $NGINX_POD -n demo -- /bin/sh -c 'echo "shell access test"'

# 시뮬레이션 2: 민감 파일 읽기
kubectl exec $NGINX_POD -n demo -- cat /etc/shadow 2>/dev/null

# 시뮬레이션 3: 패키지 설치 시도
kubectl exec $NGINX_POD -n demo -- apk add curl 2>/dev/null

# 4. Falco 로그 확인
kubectl logs -l app.kubernetes.io/name=falco -n falco --kubeconfig kubeconfig/dev-kubeconfig --tail=20
# "Terminal shell in container" 등의 알림 확인

# 5. 정리 (선택)
# helm uninstall falco -n falco --kubeconfig kubeconfig/dev-kubeconfig
# kubectl delete ns falco --kubeconfig kubeconfig/dev-kubeconfig
```

**Falco 탐지 규칙 예시:**

| 규칙 | 심각도 | 탐지 대상 |
|------|--------|----------|
| Terminal shell in container | WARNING | 컨테이너 내 셸 실행 |
| Read sensitive file | WARNING | /etc/shadow 등 읽기 |
| Launch package management | ERROR | apt/apk/yum 실행 |
| Write below /etc | WARNING | /etc 하위 파일 변경 |

**자기 점검:**
- [ ] Falco가 탐지하는 행위 유형을 3개 이상 나열할 수 있는가?
- [ ] 런타임 보안의 필요성을 설명할 수 있는가?

**관련 시험 주제:** Runtime Security, Behavioral Detection

---

### 실습 5.5: OPA Gatekeeper 정책 [난이도: ★★★]

**학습 목표:** OPA Gatekeeper를 설치하고 정책을 적용한다.

```bash
# 1. Gatekeeper 설치
kubectl apply -f https://raw.githubusercontent.com/open-policy-agent/gatekeeper/release-3.14/deploy/gatekeeper.yaml \
  --kubeconfig kubeconfig/dev-kubeconfig

# 설치 확인
kubectl get pods -n gatekeeper-system --kubeconfig kubeconfig/dev-kubeconfig

# 2. ConstraintTemplate 생성 — 특정 레이블 필수
cat <<'EOF' | kubectl apply --kubeconfig kubeconfig/dev-kubeconfig -f -
apiVersion: templates.gatekeeper.sh/v1
kind: ConstraintTemplate
metadata:
  name: k8srequiredlabels
spec:
  crd:
    spec:
      names:
        kind: K8sRequiredLabels
      validation:
        openAPIV3Schema:
          type: object
          properties:
            labels:
              type: array
              items:
                type: string
  targets:
    - target: admission.k8s.gatekeeper.sh
      rego: |
        package k8srequiredlabels
        violation[{"msg": msg}] {
          provided := {label | input.review.object.metadata.labels[label]}
          required := {label | label := input.parameters.labels[_]}
          missing := required - provided
          count(missing) > 0
          msg := sprintf("missing required labels: %v", [missing])
        }
EOF

# 3. Constraint 생성 — "team" 라벨 필수
cat <<'EOF' | kubectl apply --kubeconfig kubeconfig/dev-kubeconfig -f -
apiVersion: constraints.gatekeeper.sh/v1beta1
kind: K8sRequiredLabels
metadata:
  name: require-team-label
spec:
  match:
    kinds:
      - apiGroups: [""]
        kinds: ["Pod"]
    namespaces: ["gatekeeper-test"]
  parameters:
    labels: ["team"]
EOF

# 4. 테스트
kubectl create ns gatekeeper-test --kubeconfig kubeconfig/dev-kubeconfig

# 라벨 없는 Pod (거부되어야 함)
kubectl run no-label --image=nginx --restart=Never -n gatekeeper-test --kubeconfig kubeconfig/dev-kubeconfig 2>&1
# 예상: denied by require-team-label

# 라벨 있는 Pod (허용)
kubectl run with-label --image=nginx --restart=Never -n gatekeeper-test --kubeconfig kubeconfig/dev-kubeconfig --labels="team=demo" 2>&1
# 예상: 생성 성공

# 5. 정리
kubectl delete ns gatekeeper-test --kubeconfig kubeconfig/dev-kubeconfig
kubectl delete k8srequiredlabels require-team-label --kubeconfig kubeconfig/dev-kubeconfig
kubectl delete constrainttemplate k8srequiredlabels --kubeconfig kubeconfig/dev-kubeconfig
```

**자기 점검:**
- [ ] OPA와 Gatekeeper의 관계를 설명할 수 있는가?
- [ ] ConstraintTemplate과 Constraint의 차이를 설명할 수 있는가?

**관련 시험 주제:** Policy Engine, OPA, Admission Control

---

## 6. Compliance and Security Frameworks (10%) 실습

### 실습 6.1: CIS Kubernetes Benchmark [난이도: ★★★]

**학습 목표:** kube-bench로 CIS Benchmark를 실행하고 결과를 분석한다.

```bash
# 1. kube-bench Job 실행
cat <<'EOF' | kubectl apply --kubeconfig kubeconfig/dev-kubeconfig -f -
apiVersion: batch/v1
kind: Job
metadata:
  name: kube-bench
spec:
  template:
    spec:
      hostPID: true
      containers:
        - name: kube-bench
          image: aquasec/kube-bench:latest
          command: ["kube-bench", "run", "--targets", "master"]
          volumeMounts:
            - name: var-lib-kubelet
              mountPath: /var/lib/kubelet
              readOnly: true
            - name: etc-kubernetes
              mountPath: /etc/kubernetes
              readOnly: true
      volumes:
        - name: var-lib-kubelet
          hostPath:
            path: /var/lib/kubelet
        - name: etc-kubernetes
          hostPath:
            path: /etc/kubernetes
      restartPolicy: Never
      nodeSelector:
        node-role.kubernetes.io/control-plane: ""
      tolerations:
        - key: node-role.kubernetes.io/control-plane
          effect: NoSchedule
EOF

# 2. 결과 확인
kubectl wait --for=condition=complete job/kube-bench --timeout=300s --kubeconfig kubeconfig/dev-kubeconfig
kubectl logs job/kube-bench --kubeconfig kubeconfig/dev-kubeconfig

# 3. 결과 분석
kubectl logs job/kube-bench --kubeconfig kubeconfig/dev-kubeconfig | grep -E "PASS|FAIL|WARN" | sort | uniq -c

# 4. FAIL 항목 상세 확인
kubectl logs job/kube-bench --kubeconfig kubeconfig/dev-kubeconfig | grep -A 5 "FAIL"

# 5. 정리
kubectl delete job kube-bench --kubeconfig kubeconfig/dev-kubeconfig
```

**CIS Benchmark 주요 항목:**

| 섹션 | 항목 | 설명 |
|------|------|------|
| 1.1 | API Server | 인증, 인가, 암호화 |
| 1.2 | Controller Manager | 인증서, SA 토큰 |
| 1.3 | Scheduler | 인증 설정 |
| 1.4 | etcd | TLS, 데이터 보호 |
| 4.1 | Worker | kubelet 보안 |

**자기 점검:**
- [ ] CIS Benchmark의 Pass/Fail/Warn 결과를 해석할 수 있는가?
- [ ] FAIL 항목의 수정 방법을 찾을 수 있는가?

**관련 시험 주제:** CIS Benchmarks, Compliance

---

### 실습 6.2: Audit Logging 설정 [난이도: ★★★]

**학습 목표:** Kubernetes Audit Logging을 설정하고 활용한다.

```bash
# 1. 현재 Audit 설정 확인
ssh admin@<dev-master-ip> 'sudo cat /etc/kubernetes/manifests/kube-apiserver.yaml' | grep audit

# 2. Audit Policy 파일 확인 (있는 경우)
ssh admin@<dev-master-ip> 'sudo cat /etc/kubernetes/audit-policy.yaml 2>/dev/null || echo "not configured"'

# 3. Audit Policy 예제 (참고)
cat <<'EOF'
# /etc/kubernetes/audit-policy.yaml
apiVersion: audit.k8s.io/v1
kind: Policy
rules:
  # Secret 접근 로깅
  - level: Metadata
    resources:
      - group: ""
        resources: ["secrets"]

  # Pod 생성/삭제 로깅
  - level: RequestResponse
    resources:
      - group: ""
        resources: ["pods"]
    verbs: ["create", "delete"]

  # 기타 요청
  - level: Metadata
    omitStages:
      - RequestReceived
EOF

# 4. Audit Log 레벨 설명:
# None — 로깅하지 않음
# Metadata — 요청 메타데이터만 (사용자, 타임스탬프, 리소스)
# Request — 메타데이터 + 요청 본문
# RequestResponse — 메타데이터 + 요청 + 응답 본문

# 5. Audit Log 확인 (설정된 경우)
ssh admin@<dev-master-ip> 'sudo ls -la /var/log/kubernetes/audit/ 2>/dev/null'
ssh admin@<dev-master-ip> 'sudo tail -5 /var/log/kubernetes/audit/audit.log 2>/dev/null | jq .'
```

**자기 점검:**
- [ ] Audit Policy의 4개 레벨을 설명할 수 있는가?
- [ ] Secret 접근을 감사 로깅하는 정책을 작성할 수 있는가?

**관련 시험 주제:** Audit Logging, Compliance

---

### 실습 6.3: Prometheus 보안 모니터링 [난이도: ★★☆]

**학습 목표:** Prometheus로 보안 관련 메트릭을 모니터링한다.

```bash
# 1. PrometheusRule 목록 확인
kubectl get prometheusrule -n monitoring --kubeconfig kubeconfig/platform-kubeconfig

# 2. 보안 관련 Alert Rule 확인
kubectl get prometheusrule -n monitoring --kubeconfig kubeconfig/platform-kubeconfig -o yaml | grep -B 2 -A 10 "alert:"
# PodCrashLooping — Pod 반복 크래시 (침입 시도 가능)
# PodOOMKilled — 메모리 초과 (DoS 가능)
# HighCPUUsage — CPU 과사용 (크립토마이닝 가능)

# 3. 현재 Alert 상태 확인
# Prometheus UI: http://<platform-node-ip>:30090/alerts
# Grafana: http://<platform-node-ip>:30300

# 4. 보안 관련 메트릭 쿼리 (Prometheus UI에서)
# Pod 재시작 횟수
# kube_pod_container_status_restarts_total > 5
#
# 실패한 인증 시도
# apiserver_authentication_attempts{result="failure"}
#
# 권한 거부 수
# apiserver_audit_event_total{verb="create",code="403"}

# 5. Loki 로그 쿼리 (Grafana에서)
# {namespace="demo"} |= "error"
# {namespace="demo"} |= "denied"
# {namespace="demo"} |= "unauthorized"
```

**자기 점검:**
- [ ] 보안 관련 Prometheus 메트릭을 3개 이상 나열할 수 있는가?
- [ ] Alert Rule에서 보안 이벤트를 탐지하는 방법을 설명할 수 있는가?

**관련 시험 주제:** Security Monitoring, Observability

---

## 종합 보안 시나리오

### 시나리오 A: 보안 침해 대응 시뮬레이션

**상황:** demo 네임스페이스의 nginx-web Pod에서 의심스러운 활동이 감지되었다.

```bash
# 1단계: 상황 파악
kubectl get pods -n demo -o wide | grep nginx
kubectl describe pod -n demo -l app=nginx-web | tail -20

# 2단계: 로그 분석
NGINX_POD=$(kubectl get pods -n demo -l app=nginx-web -o jsonpath='{.items[0].metadata.name}')
kubectl logs $NGINX_POD -n demo --tail=50
kubectl logs $NGINX_POD -c istio-proxy -n demo --tail=50

# 3단계: 프로세스 확인 (의심스러운 프로세스)
kubectl exec $NGINX_POD -n demo -- ps aux
kubectl exec $NGINX_POD -n demo -- netstat -tlnp 2>/dev/null || \
kubectl exec $NGINX_POD -n demo -- ss -tlnp

# 4단계: 네트워크 연결 확인
kubectl exec $NGINX_POD -n demo -- netstat -an 2>/dev/null || \
kubectl exec $NGINX_POD -n demo -- ss -an

# 5단계: NetworkPolicy로 격리
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: isolate-nginx
spec:
  podSelector:
    matchLabels:
      app: nginx-web
  policyTypes:
    - Ingress
    - Egress
  # 빈 ingress/egress → 모든 트래픽 차단
EOF

# 6단계: 격리 확인
kubectl exec $NGINX_POD -n demo -- curl -s --connect-timeout 3 http://httpbin:8080/get 2>&1
# 예상: 타임아웃 (격리됨)

# 7단계: 증거 수집
kubectl get pod $NGINX_POD -n demo -o yaml > /tmp/incident-pod.yaml
kubectl logs $NGINX_POD -n demo --all-containers > /tmp/incident-logs.txt

# 8단계: 정리 (격리 해제)
kubectl delete networkpolicy isolate-nginx -n demo
```

---

### 시나리오 B: 보안 강화 프로젝트

**목표:** demo 네임스페이스의 보안을 CIS Benchmark 기준으로 강화한다.

```bash
# 1단계: 현재 보안 상태 감사
echo "=== 1. SecurityContext 확인 ==="
kubectl get pods -n demo -o jsonpath='{range .items[*]}{.metadata.name}: privileged={.spec.containers[0].securityContext.privileged}, runAsNonRoot={.spec.containers[0].securityContext.runAsNonRoot}, readOnlyFS={.spec.containers[0].securityContext.readOnlyRootFilesystem}{"\n"}{end}'

echo "=== 2. Resource Limits 확인 ==="
kubectl get pods -n demo -o jsonpath='{range .items[*]}{.metadata.name}: limits={.spec.containers[0].resources.limits}{"\n"}{end}'

echo "=== 3. automountServiceAccountToken 확인 ==="
kubectl get pods -n demo -o jsonpath='{range .items[*]}{.metadata.name}: automount={.spec.automountServiceAccountToken}{"\n"}{end}'

echo "=== 4. 이미지 태그 확인 ==="
kubectl get pods -n demo -o jsonpath='{range .items[*]}{.spec.containers[*].image}{"\n"}{end}' | sort -u

echo "=== 5. NetworkPolicy 확인 ==="
kubectl get ciliumnetworkpolicy -n demo | wc -l

# 2단계: 보안 강화 적용 (예: 새 Deployment에 적용)
cat <<'EOF' | kubectl apply -n demo -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: secure-app
spec:
  replicas: 1
  selector:
    matchLabels:
      app: secure-app
  template:
    metadata:
      labels:
        app: secure-app
    spec:
      automountServiceAccountToken: false
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
        fsGroup: 1000
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: app
          image: busybox:1.36
          command: ["sh", "-c", "sleep 3600"]
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: ["ALL"]
          resources:
            requests:
              cpu: 50m
              memory: 64Mi
            limits:
              cpu: 100m
              memory: 128Mi
          volumeMounts:
            - name: tmp
              mountPath: /tmp
      volumes:
        - name: tmp
          emptyDir:
            sizeLimit: 10Mi
EOF

# 3단계: 보안 상태 재확인
kubectl get pod -n demo -l app=secure-app -o jsonpath='{.items[0].spec}' | jq '.securityContext, .containers[0].securityContext'

# 정리
kubectl delete deployment secure-app -n demo
```

---

### 시나리오 C: 멀티 클러스터 보안 감사

**목표:** 4개 클러스터의 보안 설정을 일괄 감사한다.

```bash
# 모든 클러스터에 대해 보안 감사 실행
for cluster in platform dev staging prod; do
  echo "============================================"
  echo "=== 클러스터: $cluster ==="
  echo "============================================"

  export KUBECONFIG=kubeconfig/${cluster}-kubeconfig

  echo "--- Node 수 ---"
  kubectl get nodes --no-headers | wc -l

  echo "--- NodePort 서비스 (외부 노출) ---"
  kubectl get svc -A --no-headers | grep NodePort

  echo "--- NetworkPolicy 수 ---"
  kubectl get networkpolicy -A --no-headers 2>/dev/null | wc -l
  kubectl get ciliumnetworkpolicy -A --no-headers 2>/dev/null | wc -l

  echo "--- Secret 수 ---"
  kubectl get secret -A --no-headers | wc -l

  echo "--- Pod Security 위반 ---"
  kubectl get pods -A -o jsonpath='{range .items[*]}{.metadata.namespace}/{.metadata.name}: privileged={.spec.containers[0].securityContext.privileged}{"\n"}{end}' | grep "privileged=true"

  echo ""
done
```

---

### 시나리오 D: CI/CD 파이프라인 보안 점검

**목표:** Jenkins 7-stage 파이프라인의 보안을 분석한다.

```bash
# 1. Jenkins 파이프라인 단계 확인
# 1) Checkout → 2) Build → 3) Test → 4) Security Scan → 5) Docker Build → 6) Push → 7) Deploy

# 2. 각 단계의 보안 점검 사항

# Stage 1: Checkout — Git 인증 보안
kubectl get secret -n jenkins --kubeconfig kubeconfig/dev-kubeconfig | grep git

# Stage 4: Security Scan — 취약점 스캔 확인
# Trivy, Snyk 등의 이미지 스캔 도구 사용 여부

# Stage 5: Docker Build — Dockerfile 보안 확인
# FROM alpine (최소 이미지), USER non-root, COPY --chown

# Stage 6: Push — 레지스트리 접근 보안
kubectl get secret -n jenkins --kubeconfig kubeconfig/dev-kubeconfig | grep registry

# Stage 7: Deploy — ArgoCD 연동 보안
# Git commit → ArgoCD auto-sync → 클러스터 배포

# 3. 파이프라인 보안 강화 권장사항
echo "Pipeline Security Checklist:"
echo "[ ] Git webhook에 secret token 설정"
echo "[ ] 빌드 환경에서 Secret 주입 방식 확인"
echo "[ ] 이미지 취약점 스캔 단계 필수화"
echo "[ ] 이미지 서명 (cosign) 적용"
echo "[ ] ArgoCD sync 정책 검토"
echo "[ ] RBAC으로 배포 권한 제한"
```

---

### 시나리오 E: 보안 사고 포렌식

**목표:** 보안 사고 발생 시 포렌식 절차를 실습한다.

```bash
# 1. 타임라인 구성 — 최근 이벤트 확인
kubectl get events -n demo --sort-by=.metadata.creationTimestamp | tail -30

# 2. Pod 변경 이력 확인
kubectl get pod -n demo -o jsonpath='{range .items[*]}{.metadata.name}: created={.metadata.creationTimestamp}, restarts={.status.containerStatuses[0].restartCount}{"\n"}{end}'

# 3. Deployment 변경 이력
kubectl rollout history deployment/nginx-web -n demo

# 4. RBAC 이벤트 (API Server audit log)
ssh admin@<dev-master-ip> 'sudo grep "403" /var/log/kubernetes/audit/audit.log 2>/dev/null | tail -5'

# 5. 네트워크 이벤트 (Cilium)
kubectl logs -n kube-system -l k8s-app=cilium --tail=20 | grep -i "denied\|dropped"

# 6. 이미지 변경 확인
kubectl get pods -n demo -o jsonpath='{range .items[*]}{.metadata.name}: image={.spec.containers[0].image}, imageID={.status.containerStatuses[0].imageID}{"\n"}{end}'

# 7. 증거 보존
kubectl get pods -n demo -o yaml > /tmp/forensics-pods.yaml
kubectl get events -n demo -o yaml > /tmp/forensics-events.yaml
kubectl get ciliumnetworkpolicy -n demo -o yaml > /tmp/forensics-netpol.yaml
```

---

## KCSA 보안 체크리스트

실습 완료 후 체크한다.

### 1. Overview of Cloud Native Security (14%)

| 실습 | 주제 | 난이도 | 완료 |
|------|------|--------|------|
| 1.1 | 4C 보안 모델 매핑 | ★☆☆ | [ ] |
| 1.2 | Attack Surface 분석 | ★★☆ | [ ] |
| 1.3 | Defense in Depth 검증 | ★★☆ | [ ] |
| 1.4 | Zero Trust 네트워크 확인 | ★★★ | [ ] |

### 2. Kubernetes Cluster Component Security (22%)

| 실습 | 주제 | 난이도 | 완료 |
|------|------|--------|------|
| 2.1 | API Server 보안 감사 | ★★★ | [ ] |
| 2.2 | etcd 보안 점검 | ★★★ | [ ] |
| 2.3 | kubelet 보안 설정 | ★★☆ | [ ] |
| 2.4 | Control Plane TLS 검증 | ★★☆ | [ ] |
| 2.5 | Admission Controller 확인 | ★★☆ | [ ] |

### 3. Kubernetes Security Fundamentals (22%)

| 실습 | 주제 | 난이도 | 완료 |
|------|------|--------|------|
| 3.1 | RBAC 심층 분석 | ★★☆ | [ ] |
| 3.2 | CiliumNetworkPolicy 분석 | ★★★ | [ ] |
| 3.3 | ServiceAccount 보안 | ★★☆ | [ ] |
| 3.4 | Secret 관리 및 보안 | ★★☆ | [ ] |
| 3.5 | Pod Security Standards | ★★★ | [ ] |
| 3.6 | NetworkPolicy 직접 작성 | ★★★ | [ ] |

### 4. Kubernetes Threat Model (16%)

| 실습 | 주제 | 난이도 | 완료 |
|------|------|--------|------|
| 4.1 | STRIDE 위협 모델링 | ★★☆ | [ ] |
| 4.2 | 공급망 보안 분석 | ★★☆ | [ ] |
| 4.3 | 컨테이너 격리 수준 분석 | ★★★ | [ ] |
| 4.4 | 공격 벡터 시뮬레이션 | ★★★ | [ ] |

### 5. Platform Security (16%)

| 실습 | 주제 | 난이도 | 완료 |
|------|------|--------|------|
| 5.1 | Istio mTLS 검증 | ★★☆ | [ ] |
| 5.2 | Cilium L7 보안 정책 심화 | ★★★ | [ ] |
| 5.3 | ArgoCD GitOps 보안 | ★★☆ | [ ] |
| 5.4 | Falco 런타임 보안 | ★★★ | [ ] |
| 5.5 | OPA Gatekeeper 정책 | ★★★ | [ ] |

### 6. Compliance and Security Frameworks (10%)

| 실습 | 주제 | 난이도 | 완료 |
|------|------|--------|------|
| 6.1 | CIS Benchmark | ★★★ | [ ] |
| 6.2 | Audit Logging | ★★★ | [ ] |
| 6.3 | Prometheus 보안 모니터링 | ★★☆ | [ ] |

### 종합 시나리오

| 시나리오 | 주제 | 완료 |
|---------|------|------|
| A | 보안 침해 대응 시뮬레이션 | [ ] |
| B | 보안 강화 프로젝트 | [ ] |
| C | 멀티 클러스터 보안 감사 | [ ] |
| D | CI/CD 파이프라인 보안 점검 | [ ] |
| E | 보안 사고 포렌식 | [ ] |

---

## 참고: 클러스터 접근 방법

```bash
# dev 클러스터 접근
export KUBECONFIG=kubeconfig/dev-kubeconfig

# platform 클러스터 접근 (Prometheus/Grafana)
export KUBECONFIG=kubeconfig/platform-kubeconfig

# staging 클러스터 접근
export KUBECONFIG=kubeconfig/staging-kubeconfig

# prod 클러스터 접근
export KUBECONFIG=kubeconfig/prod-kubeconfig
```
