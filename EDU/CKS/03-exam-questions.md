# CKS 모의 실기 문제

> CKS(Certified Kubernetes Security Specialist) 시험 대비 실전 문제 40선이다.
> 각 문제는 실제 시험과 유사한 시나리오 기반으로 구성되어 있다.

| 도메인 | 비중 | 문제 수 |
|--------|------|---------|
| Cluster Setup & Configuration | 15% | 4 |
| Cluster Hardening | 15% | 6 |
| System Hardening | 15% | 6 |
| Minimize Microservice Vulnerabilities | 20% | 8 |
| Supply Chain Security | 20% | 8 |
| Monitoring, Logging & Runtime Security | 15% | 8 |

---

## Cluster Setup & Configuration

### 문제 1. [Cluster Setup] NetworkPolicy 기본 거부 및 허용 규칙

`secure-ns` 네임스페이스에 **기본 거부(default deny)** NetworkPolicy를 생성하라. 모든 인그레스 트래픽을 차단하되, 레이블 `role=frontend`인 Pod에서 레이블 `role=backend`인 Pod의 포트 8080으로 향하는 트래픽만 허용하라.

<details><summary>풀이 확인</summary>

**풀이:**

```bash
kubectl create namespace secure-ns
```

```yaml
# default-deny.yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-ingress
  namespace: secure-ns
spec:
  podSelector: {}
  policyTypes:
    - Ingress
---
# allow-frontend-to-backend.yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-frontend-to-backend
  namespace: secure-ns
spec:
  podSelector:
    matchLabels:
      role: backend
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              role: frontend
      ports:
        - protocol: TCP
          port: 8080
```

```bash
kubectl apply -f default-deny.yaml
kubectl apply -f allow-frontend-to-backend.yaml
kubectl get networkpolicy -n secure-ns
```

**설명:** NetworkPolicy는 네임스페이스 수준에서 Pod 간 트래픽을 제어한다. `podSelector: {}`는 해당 네임스페이스의 모든 Pod에 적용된다. 기본 거부 정책을 먼저 적용한 후, 필요한 트래픽만 명시적으로 허용하는 것이 보안 모범 사례이다. CKS 시험에서 자주 출제되는 유형이다.

</details>

---

### 문제 2. [Cluster Setup] kube-bench를 이용한 CIS 벤치마크 점검

`kube-bench`를 사용하여 **컨트롤 플레인 노드**의 CIS Kubernetes Benchmark를 실행하라. 결과 중 `FAIL` 항목을 확인하고, API Server 관련 실패 항목 중 `--anonymous-auth` 설정을 수정하라.

<details><summary>풀이 확인</summary>

**풀이:**

```bash
# kube-bench 실행 (컨트롤 플레인 노드에서)
kube-bench run --targets master --check 1.2

# 또는 Job으로 실행
kubectl apply -f https://raw.githubusercontent.com/aquasecurity/kube-bench/main/job-master.yaml
kubectl logs job/kube-bench
```

```bash
# API Server 매니페스트 수정
sudo vi /etc/kubernetes/manifests/kube-apiserver.yaml
```

```yaml
# kube-apiserver.yaml 수정 사항
spec:
  containers:
    - command:
        - kube-apiserver
        - --anonymous-auth=false
        - --authorization-mode=Node,RBAC
        - --audit-log-path=/var/log/kubernetes/audit.log
        - --audit-log-maxage=30
        - --audit-log-maxbackup=10
        - --audit-log-maxsize=100
```

```bash
# 변경 후 API Server Pod 재시작 확인
crictl ps | grep kube-apiserver
# kube-bench 재실행하여 수정 확인
kube-bench run --targets master --check 1.2.1
```

**설명:** kube-bench는 CIS Kubernetes Benchmark에 따라 클러스터 구성을 점검하는 도구이다. `--anonymous-auth=false`는 인증되지 않은 요청을 거부한다. Static Pod 매니페스트(`/etc/kubernetes/manifests/`)를 수정하면 kubelet이 자동으로 Pod를 재시작한다. FAIL 항목을 하나씩 수정하고 재실행하여 PASS로 바뀌는 것을 확인해야 한다.

</details>

---

### 문제 3. [Cluster Setup] Ingress TLS 설정

`webapp` 네임스페이스에 배포된 서비스 `web-svc`(포트 80)에 대해 TLS를 적용한 Ingress를 생성하라. 인증서는 `/cks/tls/server.crt`와 `/cks/tls/server.key`에 있다. 호스트명은 `secure.example.com`으로 설정하라.

<details><summary>풀이 확인</summary>

**풀이:**

```bash
# TLS Secret 생성
kubectl create secret tls web-tls-secret \
  --cert=/cks/tls/server.crt \
  --key=/cks/tls/server.key \
  -n webapp
```

```yaml
# ingress-tls.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: web-ingress
  namespace: webapp
  annotations:
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
spec:
  tls:
    - hosts:
        - secure.example.com
      secretName: web-tls-secret
  rules:
    - host: secure.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: web-svc
                port:
                  number: 80
```

```bash
kubectl apply -f ingress-tls.yaml
kubectl get ingress -n webapp
kubectl describe ingress web-ingress -n webapp
```

**설명:** Ingress에 TLS를 적용하면 클라이언트와 Ingress Controller 사이의 통신이 암호화된다. TLS Secret은 `tls.crt`와 `tls.key` 키를 포함하며, Ingress 리소스의 `spec.tls`에서 참조한다. `ssl-redirect` 어노테이션은 HTTP 요청을 HTTPS로 자동 리다이렉트한다.

</details>

---

### 문제 4. [Cluster Setup] API Server 접근 제한 및 NodeRestriction

API Server에 대한 접근을 특정 IP 대역(`10.0.0.0/16`)으로만 제한하라. 또한 `NodeRestriction` Admission Plugin이 활성화되어 있는지 확인하고, 비활성 상태이면 활성화하라.

<details><summary>풀이 확인</summary>

**풀이:**

```bash
sudo vi /etc/kubernetes/manifests/kube-apiserver.yaml
```

```yaml
spec:
  containers:
    - command:
        - kube-apiserver
        - --advertise-address=10.0.0.10
        - --service-node-port-range=30000-32767
        - --enable-admission-plugins=NodeRestriction
```

```bash
# iptables로 API Server 포트(6443) 접근 제한
sudo iptables -A INPUT -p tcp --dport 6443 -s 10.0.0.0/16 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 6443 -j DROP

# 적용 후 확인
kubectl cluster-info
curl -k https://$(hostname -I | awk '{print $1}'):6443/healthz
```

**설명:** API Server 접근 제한은 클러스터 보안의 핵심이다. `NodeRestriction` Admission Plugin은 kubelet이 자신의 Node 오브젝트와 해당 Node에 스케줄된 Pod만 수정할 수 있도록 제한한다. 네트워크 수준(iptables, firewall)의 접근 제어와 함께 사용하면 방어 심층(Defense in Depth)을 구현할 수 있다.

</details>

---

## Cluster Hardening

### 문제 5. [Cluster Hardening] RBAC 최소 권한 원칙 적용

`dev-team` 네임스페이스에서 `developer` ServiceAccount가 **Deployment, Pod, Service만 조회(get, list, watch)**할 수 있도록 Role과 RoleBinding을 생성하라. 다른 리소스에 대한 접근은 불가해야 한다.

<details><summary>풀이 확인</summary>

**풀이:**

```bash
kubectl create namespace dev-team
kubectl create serviceaccount developer -n dev-team
```

```yaml
# role-developer.yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: developer-role
  namespace: dev-team
rules:
  - apiGroups: [""]
    resources: ["pods", "services"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["apps"]
    resources: ["deployments"]
    verbs: ["get", "list", "watch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: developer-rolebinding
  namespace: dev-team
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: developer-role
subjects:
  - kind: ServiceAccount
    name: developer
    namespace: dev-team
```

```bash
kubectl apply -f role-developer.yaml
# 권한 검증
kubectl auth can-i get pods --as=system:serviceaccount:dev-team:developer -n dev-team
# yes
kubectl auth can-i create pods --as=system:serviceaccount:dev-team:developer -n dev-team
# no
kubectl auth can-i get secrets --as=system:serviceaccount:dev-team:developer -n dev-team
# no
```

**설명:** RBAC 최소 권한 원칙은 사용자 또는 ServiceAccount에 필요한 최소한의 권한만 부여하는 것이다. Role은 네임스페이스 범위, ClusterRole은 클러스터 범위로 동작한다. `kubectl auth can-i` 명령으로 권한을 검증할 수 있다. Deployment는 `apps` apiGroup에 속하므로 별도로 지정해야 한다.

</details>

---

### 문제 6. [Cluster Hardening] ServiceAccount 토큰 자동 마운트 비활성화

`restricted-ns` 네임스페이스에 `app-sa`라는 ServiceAccount를 생성하되, **토큰 자동 마운트를 비활성화**하라. 이 ServiceAccount를 사용하는 Pod `restricted-pod`를 생성하고, 토큰이 마운트되지 않았는지 확인하라.

<details><summary>풀이 확인</summary>

**풀이:**

```bash
kubectl create namespace restricted-ns
```

```yaml
# sa-no-automount.yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: app-sa
  namespace: restricted-ns
automountServiceAccountToken: false
---
apiVersion: v1
kind: Pod
metadata:
  name: restricted-pod
  namespace: restricted-ns
spec:
  serviceAccountName: app-sa
  containers:
    - name: app
      image: nginx:1.25
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
```

```bash
kubectl apply -f sa-no-automount.yaml
# 토큰 마운트 확인
kubectl exec restricted-pod -n restricted-ns -- ls /var/run/secrets/kubernetes.io/serviceaccount/
# ls: cannot access '/var/run/secrets/kubernetes.io/serviceaccount/': No such file or directory
```

**설명:** ServiceAccount 토큰이 자동 마운트되면 공격자가 컨테이너에 침입했을 때 API Server에 접근할 수 있다. `automountServiceAccountToken: false`를 설정하면 토큰이 Pod에 마운트되지 않는다. API 접근이 필요 없는 워크로드에는 반드시 비활성화해야 한다. Pod 레벨에서도 동일 필드를 설정할 수 있으며, Pod 설정이 SA 설정보다 우선한다.

</details>

---

### 문제 7. [Cluster Hardening] 과도한 권한의 ClusterRoleBinding 감사

클러스터에서 **과도한 권한**을 가진 ClusterRoleBinding을 찾아라. 특히 `system:anonymous` 사용자에게 바인딩된 ClusterRole이 있는지 확인하고, 불필요한 바인딩을 삭제하라.

<details><summary>풀이 확인</summary>

**풀이:**

```bash
# system:anonymous에 바인딩된 ClusterRoleBinding 찾기
kubectl get clusterrolebindings -o json | \
  jq -r '.items[] | select(.subjects[]? // empty | .name == "system:anonymous") | .metadata.name'

# cluster-admin 권한을 가진 모든 바인딩 확인
kubectl get clusterrolebindings -o json | \
  jq -r '.items[] | select(.roleRef.name == "cluster-admin") |
    .metadata.name + " -> " + (.subjects[]?.name // "unknown")'

# 불필요한 바인딩 삭제
kubectl delete clusterrolebinding <suspicious-binding-name>

# 기본 ServiceAccount에 바인딩된 역할 확인
kubectl get rolebindings,clusterrolebindings --all-namespaces -o json | \
  jq -r '.items[] | select(.subjects[]? // empty |
    .name == "default" and .kind == "ServiceAccount") | .metadata.name'
```

**설명:** `system:anonymous`에 ClusterRole이 바인딩되면 인증 없이 API Server에 접근할 수 있어 심각한 보안 위협이 된다. `cluster-admin` 역할의 바인딩은 특히 주의 깊게 관리해야 한다. 정기적으로 ClusterRoleBinding을 감사하여 불필요한 권한을 제거하는 것이 보안 운영의 기본이다.

</details>

---

### 문제 8. [Cluster Hardening] Audit Policy 설정

API Server에 **Audit Policy**를 설정하라. 다음 규칙을 적용하라:
- Secret 리소스의 모든 접근은 `RequestResponse` 레벨로 기록
- `kube-system` 네임스페이스의 ConfigMap 변경은 `Metadata` 레벨로 기록
- 그 외 모든 요청은 `Request` 레벨로 기록

<details><summary>풀이 확인</summary>

**풀이:**

```yaml
# /etc/kubernetes/audit/audit-policy.yaml
apiVersion: audit.k8s.io/v1
kind: Policy
rules:
  - level: RequestResponse
    resources:
      - group: ""
        resources: ["secrets"]
  - level: Metadata
    namespaces: ["kube-system"]
    resources:
      - group: ""
        resources: ["configmaps"]
    verbs: ["update", "patch", "delete"]
  - level: Request
    resources:
      - group: ""
        resources: ["*"]
  - level: Metadata
    omitStages:
      - RequestReceived
```

```bash
sudo mkdir -p /etc/kubernetes/audit
sudo vi /etc/kubernetes/manifests/kube-apiserver.yaml
```

```yaml
# kube-apiserver.yaml에 추가
spec:
  containers:
    - command:
        - kube-apiserver
        - --audit-policy-file=/etc/kubernetes/audit/audit-policy.yaml
        - --audit-log-path=/var/log/kubernetes/audit/audit.log
        - --audit-log-maxage=30
        - --audit-log-maxbackup=10
        - --audit-log-maxsize=100
      volumeMounts:
        - name: audit-policy
          mountPath: /etc/kubernetes/audit
          readOnly: true
        - name: audit-log
          mountPath: /var/log/kubernetes/audit
  volumes:
    - name: audit-policy
      hostPath:
        path: /etc/kubernetes/audit
        type: DirectoryOrCreate
    - name: audit-log
      hostPath:
        path: /var/log/kubernetes/audit
        type: DirectoryOrCreate
```

```bash
# API Server 재시작 확인
crictl ps | grep kube-apiserver
# 감사 로그 확인
sudo tail -f /var/log/kubernetes/audit/audit.log | jq .
```

**설명:** Audit Policy는 API Server에 대한 모든 요청을 기록하는 정책이다. `Metadata` 레벨은 요청 메타데이터만, `Request`는 요청 본문도, `RequestResponse`는 응답 본문까지 기록한다. 규칙은 위에서 아래로 매칭되므로 순서가 중요하다. Secret은 민감 정보이므로 가장 상세한 레벨로 기록하는 것이 권장된다. Volume 마운트를 잊지 않아야 한다.

</details>

---

### 문제 9. [Cluster Hardening] Kubernetes 버전 업그레이드

현재 클러스터가 `v1.29.0`이다. **컨트롤 플레인 노드를 v1.30.0으로 업그레이드**하라. 워커 노드는 업그레이드하지 않아도 된다.

<details><summary>풀이 확인</summary>

**풀이:**

```bash
# 현재 버전 확인
kubectl get nodes
kubeadm version

# 패키지 저장소에서 사용 가능한 버전 확인
apt-cache madison kubeadm | grep 1.30

# kubeadm 업그레이드
sudo apt-mark unhold kubeadm
sudo apt-get update && sudo apt-get install -y kubeadm=1.30.0-1.1
sudo apt-mark hold kubeadm

# 업그레이드 계획 확인
sudo kubeadm upgrade plan

# 컨트롤 플레인 업그레이드 실행
sudo kubeadm upgrade apply v1.30.0

# 노드 드레인
kubectl drain <control-plane-node> --ignore-daemonsets --delete-emptydir-data

# kubelet, kubectl 업그레이드
sudo apt-mark unhold kubelet kubectl
sudo apt-get install -y kubelet=1.30.0-1.1 kubectl=1.30.0-1.1
sudo apt-mark hold kubelet kubectl

# kubelet 재시작
sudo systemctl daemon-reload
sudo systemctl restart kubelet

# 노드 uncordon
kubectl uncordon <control-plane-node>

# 업그레이드 확인
kubectl get nodes
```

**설명:** Kubernetes 버전 업그레이드는 보안 패치를 적용하기 위해 필수적이다. 반드시 kubeadm을 먼저 업그레이드한 후, kubelet과 kubectl을 업그레이드하는 순서를 따라야 한다. 컨트롤 플레인을 먼저 업그레이드하고, 워커 노드를 순차적으로 업그레이드한다. 드레인 과정에서 DaemonSet과 emptyDir 관련 옵션을 지정해야 한다.

</details>

---

### 문제 10. [Cluster Hardening] etcd 데이터 암호화(EncryptionConfiguration)

etcd에 저장되는 **Secret 데이터를 암호화**하라. `aescbc` 프로바이더를 사용하고, 암호화 키는 32바이트 base64 인코딩 값을 사용하라. 기존 Secret도 재암호화하라.

<details><summary>풀이 확인</summary>

**풀이:**

```bash
# 암호화 키 생성
head -c 32 /dev/urandom | base64
```

```yaml
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
              secret: <위에서 생성한 base64 값>
      - identity: {}
```

```bash
sudo mkdir -p /etc/kubernetes/enc
sudo vi /etc/kubernetes/manifests/kube-apiserver.yaml
```

```yaml
# kube-apiserver.yaml에 추가
spec:
  containers:
    - command:
        - kube-apiserver
        - --encryption-provider-config=/etc/kubernetes/enc/encryption-config.yaml
      volumeMounts:
        - name: enc-config
          mountPath: /etc/kubernetes/enc
          readOnly: true
  volumes:
    - name: enc-config
      hostPath:
        path: /etc/kubernetes/enc
        type: DirectoryOrCreate
```

```bash
# API Server 재시작 확인
crictl ps | grep kube-apiserver

# 기존 Secret 재암호화
kubectl get secrets --all-namespaces -o json | kubectl replace -f -

# 암호화 확인 (etcd에서 직접 확인)
ETCDCTL_API=3 etcdctl get /registry/secrets/default/my-secret \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key | hexdump -C | head -20
# "k8s:enc:aescbc:v1:key1"로 시작하면 암호화 성공
```

**설명:** 기본적으로 etcd의 Secret은 base64 인코딩만 적용되어 평문과 다름없다. `EncryptionConfiguration`을 설정하면 etcd에 저장되기 전에 데이터가 암호화된다. `identity` 프로바이더를 마지막에 두면 암호화되지 않은 기존 데이터도 읽을 수 있다. 기존 Secret은 `kubectl replace`로 재암호화해야 한다.

</details>

---

## System Hardening

### 문제 11. [System Hardening] AppArmor 프로파일 적용

`apparmor-ns` 네임스페이스에 Pod `apparmor-pod`를 생성하라. 이 Pod에 **AppArmor 프로파일 `k8s-deny-write`**를 적용하여 파일 쓰기를 차단하라. 프로파일은 노드에 이미 로드되어 있다고 가정한다.

<details><summary>풀이 확인</summary>

**풀이:**

```bash
# 노드에서 AppArmor 프로파일 확인
sudo aa-status | grep k8s-deny-write

# 프로파일이 없으면 생성 및 로드
cat <<'PROFILE' | sudo tee /etc/apparmor.d/k8s-deny-write
#include <tunables/global>
profile k8s-deny-write flags=(attach_disconnected) {
  #include <abstractions/base>
  file,
  deny /** w,
}
PROFILE
sudo apparmor_parser -r /etc/apparmor.d/k8s-deny-write
```

```yaml
# apparmor-pod.yaml (Kubernetes 1.30+)
apiVersion: v1
kind: Pod
metadata:
  name: apparmor-pod
  namespace: apparmor-ns
spec:
  containers:
    - name: app
      image: nginx:1.25
      securityContext:
        appArmorProfile:
          type: Localhost
          localhostProfile: k8s-deny-write
```

```yaml
# Kubernetes 1.29 이하 버전 (어노테이션 방식)
apiVersion: v1
kind: Pod
metadata:
  name: apparmor-pod
  namespace: apparmor-ns
  annotations:
    container.apparmor.security.beta.kubernetes.io/app: localhost/k8s-deny-write
spec:
  containers:
    - name: app
      image: nginx:1.25
```

```bash
kubectl create namespace apparmor-ns
kubectl apply -f apparmor-pod.yaml

# 쓰기 차단 확인
kubectl exec apparmor-pod -n apparmor-ns -- touch /tmp/testfile
# touch: cannot touch '/tmp/testfile': Permission denied
```

**설명:** AppArmor는 Linux 커널 보안 모듈로, 프로세스가 접근할 수 있는 리소스를 제한한다. Kubernetes 1.30부터 `securityContext.appArmorProfile` 필드를 사용한다. 이전 버전에서는 어노테이션을 사용한다. CKS 시험에서는 두 가지 방식 모두 알고 있어야 한다.

</details>

---

### 문제 12. [System Hardening] seccomp 프로파일 적용

Pod에 **커스텀 seccomp 프로파일**을 적용하여 `mkdir`, `chmod` 시스템 콜을 차단하라. 프로파일 파일을 작성하고 Pod에 적용하라.

<details><summary>풀이 확인</summary>

**풀이:**

```bash
# seccomp 프로파일 디렉토리 생성
sudo mkdir -p /var/lib/kubelet/seccomp/profiles
```

```bash
# 프로파일 파일 작성
sudo tee /var/lib/kubelet/seccomp/profiles/deny-mkdir-chmod.json << 'EOF'
{
  "defaultAction": "SCMP_ACT_ALLOW",
  "architectures": ["SCMP_ARCH_X86_64", "SCMP_ARCH_AARCH64"],
  "syscalls": [
    {
      "names": ["mkdir", "mkdirat", "chmod", "fchmod", "fchmodat"],
      "action": "SCMP_ACT_ERRNO",
      "errnoRet": 1
    }
  ]
}
EOF
```

```yaml
# seccomp-pod.yaml
apiVersion: v1
kind: Pod
metadata:
  name: seccomp-pod
spec:
  securityContext:
    seccompProfile:
      type: Localhost
      localhostProfile: profiles/deny-mkdir-chmod.json
  containers:
    - name: app
      image: nginx:1.25
```

```bash
kubectl apply -f seccomp-pod.yaml
# 검증
kubectl exec seccomp-pod -- mkdir /tmp/testdir
# mkdir: cannot create directory '/tmp/testdir': Operation not permitted
kubectl exec seccomp-pod -- chmod 777 /etc/hostname
# chmod: changing permissions of '/etc/hostname': Operation not permitted
```

**설명:** seccomp(Secure Computing Mode)은 컨테이너가 호출할 수 있는 시스템 콜을 제한한다. `SCMP_ACT_ALLOW`를 기본 액션으로 설정하고 특정 시스템 콜만 차단하는 블랙리스트 방식이다. 프로덕션에서는 `SCMP_ACT_ERRNO`를 기본으로 설정하고 필요한 시스템 콜만 허용하는 화이트리스트 방식이 더 안전하다. 프로파일 경로는 kubelet의 seccomp 디렉토리(`/var/lib/kubelet/seccomp/`) 기준 상대 경로이다.

</details>

---

### 문제 13. [System Hardening] 불필요한 서비스 비활성화 및 포트 점검

워커 노드에서 **불필요한 서비스를 찾아 비활성화**하라. 열린 포트를 점검하고, 불필요한 커널 모듈을 블랙리스트에 등록하라.

<details><summary>풀이 확인</summary>

**풀이:**

```bash
# 열린 포트 확인
ss -tlnp
netstat -tlnp

# 실행 중인 서비스 확인
systemctl list-units --type=service --state=running

# 불필요한 서비스 비활성화
sudo systemctl stop snapd
sudo systemctl disable snapd
sudo systemctl mask snapd

# 불필요한 커널 모듈 블랙리스트
cat <<EOF | sudo tee /etc/modprobe.d/k8s-hardening.conf
blacklist dccp
blacklist sctp
blacklist rds
blacklist tipc
EOF

sudo modprobe -r dccp 2>/dev/null
sudo modprobe -r sctp 2>/dev/null

# UFW로 필요한 포트만 허용
sudo ufw default deny incoming
sudo ufw allow 10250/tcp   # kubelet
sudo ufw allow 30000:32767/tcp  # NodePort
sudo ufw enable

# 확인
sudo ufw status verbose
ss -tlnp
```

**설명:** 노드의 공격 표면을 줄이기 위해 불필요한 서비스와 커널 모듈을 비활성화해야 한다. `systemctl mask`는 `disable`보다 강력하게 서비스 시작을 방지한다. 커널 모듈 블랙리스트는 네트워크 프로토콜 관련 공격 벡터를 제거한다. CKS 시험에서는 `ss -tlnp`로 열린 포트를 빠르게 확인하는 것이 중요하다.

</details>

---

### 문제 14. [System Hardening] kubelet 보안 설정 강화

워커 노드의 **kubelet 설정을 강화**하라:
- 익명 인증 비활성화
- 읽기 전용 포트(10255) 비활성화
- Webhook 인증/인가 활성화
- 보호 커널 기본값 적용

<details><summary>풀이 확인</summary>

**풀이:**

```bash
sudo vi /var/lib/kubelet/config.yaml
```

```yaml
# /var/lib/kubelet/config.yaml
apiVersion: kubelet.config.k8s.io/v1beta1
kind: KubeletConfiguration
authentication:
  anonymous:
    enabled: false
  webhook:
    enabled: true
    cacheTTL: 2m0s
  x509:
    clientCAFile: /etc/kubernetes/pki/ca.crt
authorization:
  mode: Webhook
  webhook:
    cacheAuthorizedTTL: 5m0s
    cacheUnauthorizedTTL: 30s
readOnlyPort: 0
protectKernelDefaults: true
tlsCertFile: /var/lib/kubelet/pki/kubelet.crt
tlsPrivateKeyFile: /var/lib/kubelet/pki/kubelet.key
```

```bash
# kubelet 재시작
sudo systemctl daemon-reload
sudo systemctl restart kubelet
sudo systemctl status kubelet

# 익명 접근 테스트
curl -sk https://localhost:10250/pods
# 401 Unauthorized

# 읽기 전용 포트 테스트
curl -s http://localhost:10255/healthz
# connection refused
```

**설명:** kubelet은 각 노드에서 컨테이너를 관리하는 에이전트이다. 기본 설정에서는 익명 인증이 허용되고, 읽기 전용 포트(10255)가 인증 없이 노드 정보를 노출할 수 있다. `readOnlyPort: 0`으로 비활성화하고, Webhook 인증/인가를 활성화하면 kubelet API 접근 시 API Server를 통해 인증/인가를 수행한다.

</details>

---

### 문제 15. [System Hardening] 호스트 네임스페이스 사용 제한 (PSA)

`restricted-ns` 네임스페이스에서 **호스트 네트워크, 호스트 PID, 호스트 IPC를 사용하는 Pod를 찾아** 제거하라. 이후 Pod Security Admission으로 이러한 Pod 생성을 방지하라.

<details><summary>풀이 확인</summary>

**풀이:**

```bash
# 호스트 네임스페이스를 사용하는 Pod 찾기
kubectl get pods -n restricted-ns -o json | \
  jq -r '.items[] | select(.spec.hostNetwork == true or .spec.hostPID == true or .spec.hostIPC == true) | .metadata.name'

# 해당 Pod 삭제
kubectl delete pod <pod-name> -n restricted-ns
```

```bash
# PSA restricted 정책 적용
kubectl label namespace restricted-ns \
  pod-security.kubernetes.io/enforce=restricted \
  pod-security.kubernetes.io/enforce-version=latest \
  pod-security.kubernetes.io/warn=restricted \
  pod-security.kubernetes.io/audit=restricted \
  --overwrite

# 테스트 - hostNetwork Pod 생성 시도
kubectl run test-host --image=nginx --namespace=restricted-ns \
  --overrides='{"spec":{"hostNetwork":true}}'
# Error: violates PodSecurity "restricted:latest"
```

**설명:** 호스트 네임스페이스(Network, PID, IPC)를 사용하면 컨테이너가 호스트 시스템의 네트워크 스택, 프로세스 목록, IPC 자원에 직접 접근할 수 있어 보안 위험이 크다. Pod Security Admission(PSA)은 PodSecurityPolicy(PSP, v1.25에서 제거됨)의 후속 기능으로, 네임스페이스 레이블을 통해 보안 정책을 적용한다.

</details>

---

### 문제 16. [System Hardening] 커널 파라미터(sysctl) 보안 설정

워커 노드에서 다음 **커널 파라미터를 설정**하여 보안을 강화하라:
- ICMP 리다이렉트 수락 차단
- SYN 플러드 보호 활성화
- 소스 라우팅 차단

또한 Pod 레벨에서 안전한 sysctl 파라미터를 설정하는 방법을 보여라.

<details><summary>풀이 확인</summary>

**풀이:**

```bash
# 노드 수준 커널 파라미터 설정
cat <<EOF | sudo tee /etc/sysctl.d/99-kubernetes-hardening.conf
net.ipv4.ip_forward = 1
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.default.accept_redirects = 0
net.ipv4.conf.all.send_redirects = 0
net.ipv4.tcp_syncookies = 1
net.ipv4.conf.all.accept_source_route = 0
net.ipv4.conf.default.accept_source_route = 0
EOF

sudo sysctl --system
```

```yaml
# Pod 레벨 sysctl 설정
apiVersion: v1
kind: Pod
metadata:
  name: sysctl-pod
spec:
  securityContext:
    sysctls:
      - name: net.ipv4.ping_group_range
        value: "0 65535"
      - name: net.ipv4.ip_unprivileged_port_start
        value: "0"
  containers:
    - name: app
      image: nginx:1.25
```

**설명:** 커널 파라미터(sysctl)는 OS 수준에서 네트워크 보안을 강화하는 데 사용된다. `ip_forward = 1`은 Kubernetes 네트워킹에 필수이므로 유지해야 한다. Kubernetes에서는 `safe` sysctl(네임스페이스에 격리된 것)과 `unsafe` sysctl을 구분한다. Pod 레벨에서 unsafe sysctl을 사용하려면 kubelet의 `allowedUnsafeSysctls` 설정이 필요하다.

</details>

---

## Minimize Microservice Vulnerabilities

### 문제 17. [Microservice Vulnerabilities] Pod Security Admission — restricted 적용

`production` 네임스페이스에 **PSA `restricted` 정책을 enforce 모드로** 적용하라. 이 정책을 준수하는 Deployment를 생성하라.

<details><summary>풀이 확인</summary>

**풀이:**

```bash
kubectl label namespace production \
  pod-security.kubernetes.io/enforce=restricted \
  pod-security.kubernetes.io/enforce-version=latest \
  pod-security.kubernetes.io/warn=restricted \
  pod-security.kubernetes.io/audit=restricted \
  --overwrite
```

```yaml
# compliant-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: secure-app
  namespace: production
spec:
  replicas: 2
  selector:
    matchLabels:
      app: secure-app
  template:
    metadata:
      labels:
        app: secure-app
    spec:
      securityContext:
        runAsNonRoot: true
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: app
          image: nginx:1.25
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            runAsUser: 1000
            capabilities:
              drop:
                - ALL
          volumeMounts:
            - name: tmp
              mountPath: /tmp
            - name: cache
              mountPath: /var/cache/nginx
            - name: run
              mountPath: /var/run
      volumes:
        - name: tmp
          emptyDir: {}
        - name: cache
          emptyDir: {}
        - name: run
          emptyDir: {}
```

```bash
kubectl apply -f compliant-deployment.yaml
kubectl get pods -n production
```

**설명:** PSA의 `restricted` 정책은 가장 엄격한 보안 수준으로, 다음을 요구한다: `runAsNonRoot: true`, `allowPrivilegeEscalation: false`, `seccompProfile` 설정, 모든 capability 드롭. `readOnlyRootFilesystem`을 사용할 경우 nginx처럼 임시 파일이 필요한 애플리케이션에는 emptyDir 볼륨을 마운트해야 한다.

</details>

---

### 문제 18. [Microservice Vulnerabilities] OPA Gatekeeper — 리소스 제한 강제

OPA Gatekeeper를 사용하여 **모든 Pod에 CPU/Memory limits가 설정되어야 한다**는 정책을 생성하라. ConstraintTemplate과 Constraint를 작성하라.

<details><summary>풀이 확인</summary>

**풀이:**

```yaml
# constraint-template.yaml
apiVersion: templates.gatekeeper.sh/v1
kind: ConstraintTemplate
metadata:
  name: k8srequiredresources
spec:
  crd:
    spec:
      names:
        kind: K8sRequiredResources
  targets:
    - target: admission.k8s.gatekeeper.sh
      rego: |
        package k8srequiredresources

        violation[{"msg": msg}] {
          container := input.review.object.spec.containers[_]
          not container.resources.limits.cpu
          msg := sprintf("Container '%v' has no CPU limit", [container.name])
        }

        violation[{"msg": msg}] {
          container := input.review.object.spec.containers[_]
          not container.resources.limits.memory
          msg := sprintf("Container '%v' has no memory limit", [container.name])
        }
---
# constraint.yaml
apiVersion: constraints.gatekeeper.sh/v1beta1
kind: K8sRequiredResources
metadata:
  name: require-resource-limits
spec:
  match:
    kinds:
      - apiGroups: [""]
        kinds: ["Pod"]
    excludedNamespaces:
      - kube-system
      - gatekeeper-system
```

```bash
kubectl apply -f constraint-template.yaml
kubectl apply -f constraint.yaml

# 테스트 — 리소스 제한 없는 Pod
kubectl run test-no-limits --image=nginx
# Error: Container 'test-no-limits' has no CPU limit

# 리소스 제한 있는 Pod
kubectl run test-ok --image=nginx \
  --overrides='{"spec":{"containers":[{"name":"test","image":"nginx","resources":{"limits":{"cpu":"100m","memory":"128Mi"}}}]}}'
# 성공
```

**설명:** OPA Gatekeeper는 Kubernetes의 Admission Controller로, Rego 언어로 작성된 정책을 통해 리소스 생성을 제어한다. ConstraintTemplate은 정책 로직을 정의하고, Constraint는 해당 템플릿의 인스턴스로 적용 범위를 지정한다. `kube-system` 등 시스템 네임스페이스는 제외하는 것이 일반적이다.

</details>

---

### 문제 19. [Microservice Vulnerabilities] RuntimeClass와 gVisor 적용

**gVisor(runsc) 런타임**을 사용하는 RuntimeClass를 생성하고, `sandbox-ns` 네임스페이스의 Pod에 적용하라. gVisor 런타임이 정상 동작하는지 확인하라.

<details><summary>풀이 확인</summary>

**풀이:**

```yaml
# runtimeclass-gvisor.yaml
apiVersion: node.k8s.io/v1
kind: RuntimeClass
metadata:
  name: gvisor
handler: runsc
---
# gvisor-pod.yaml
apiVersion: v1
kind: Pod
metadata:
  name: gvisor-pod
  namespace: sandbox-ns
spec:
  runtimeClassName: gvisor
  containers:
    - name: app
      image: nginx:1.25
      resources:
        limits:
          cpu: "100m"
          memory: "128Mi"
```

```bash
kubectl create namespace sandbox-ns
kubectl apply -f runtimeclass-gvisor.yaml
kubectl apply -f gvisor-pod.yaml

# gVisor 런타임 확인
kubectl exec gvisor-pod -n sandbox-ns -- dmesg | head -5
# gVisor 환경에서는 "Starting gVisor" 유사 메시지 출력

kubectl exec gvisor-pod -n sandbox-ns -- uname -r
# gVisor 커널 버전이 출력됨 (호스트와 다름)
```

**설명:** gVisor는 Google이 개발한 컨테이너 런타임 샌드박스이다. 컨테이너와 호스트 커널 사이에 추가적인 격리 계층을 제공하여 컨테이너 탈출 공격을 방지한다. RuntimeClass를 통해 특정 Pod에만 gVisor를 적용할 수 있다. 성능 오버헤드가 있으므로 보안이 특히 중요한 워크로드에 선택적으로 적용한다.

</details>

---

### 문제 20. [Microservice Vulnerabilities] readOnlyRootFilesystem 적용

`secure-ns` 네임스페이스의 모든 컨테이너에 `readOnlyRootFilesystem: true`를 설정하라. 애플리케이션이 `/tmp`와 `/var/log`에 쓰기가 필요한 경우를 emptyDir로 처리하라.

<details><summary>풀이 확인</summary>

**풀이:**

```yaml
# readonly-pod.yaml
apiVersion: v1
kind: Pod
metadata:
  name: readonly-app
  namespace: secure-ns
spec:
  securityContext:
    runAsNonRoot: true
    runAsUser: 1000
  containers:
    - name: app
      image: python:3.12-slim
      command: ["python3", "-m", "http.server", "8080"]
      securityContext:
        readOnlyRootFilesystem: true
        allowPrivilegeEscalation: false
        capabilities:
          drop:
            - ALL
      volumeMounts:
        - name: tmp
          mountPath: /tmp
        - name: log
          mountPath: /var/log
  volumes:
    - name: tmp
      emptyDir:
        sizeLimit: 100Mi
    - name: log
      emptyDir:
        sizeLimit: 50Mi
```

```bash
kubectl apply -f readonly-pod.yaml

# 루트 파일시스템 쓰기 차단 확인
kubectl exec readonly-app -n secure-ns -- touch /etc/test
# touch: cannot touch '/etc/test': Read-only file system

# 허용된 경로에 쓰기 확인
kubectl exec readonly-app -n secure-ns -- touch /tmp/test
# 성공
```

**설명:** `readOnlyRootFilesystem: true`는 컨테이너의 루트 파일시스템을 읽기 전용으로 마운트한다. 공격자가 컨테이너에 침입하더라도 악성 바이너리를 설치하거나 설정 파일을 변조할 수 없다. 쓰기가 필요한 디렉토리에는 `emptyDir`을 마운트하되, `sizeLimit`로 크기를 제한하는 것이 권장된다.

</details>

---

### 문제 21. [Microservice Vulnerabilities] Secret을 볼륨으로 마운트

`webapp` 네임스페이스에서 Secret `db-credentials`를 **환경변수가 아닌 볼륨으로 마운트**하여 사용하는 Pod를 생성하라. 파일 권한은 `0400`으로 설정하라.

<details><summary>풀이 확인</summary>

**풀이:**

```bash
kubectl create secret generic db-credentials \
  --from-literal=username=admin \
  --from-literal=password='S3cur3P@ss!' \
  -n webapp
```

```yaml
# secret-volume-pod.yaml
apiVersion: v1
kind: Pod
metadata:
  name: webapp-pod
  namespace: webapp
spec:
  containers:
    - name: webapp
      image: nginx:1.25
      volumeMounts:
        - name: db-creds
          mountPath: /etc/secrets/db
          readOnly: true
      securityContext:
        readOnlyRootFilesystem: true
        allowPrivilegeEscalation: false
  volumes:
    - name: db-creds
      secret:
        secretName: db-credentials
        defaultMode: 0400
        items:
          - key: username
            path: username
          - key: password
            path: password
```

```bash
kubectl apply -f secret-volume-pod.yaml

# 마운트 확인
kubectl exec webapp-pod -n webapp -- ls -la /etc/secrets/db/
# -r--------  1 root root  5 ... username
# -r--------  1 root root 11 ... password

# 환경변수에는 노출되지 않음
kubectl exec webapp-pod -n webapp -- env | grep -i password
# (없음)
```

**설명:** Secret을 환경변수로 전달하면 `kubectl exec -- env`나 로그에 노출될 수 있다. 볼륨으로 마운트하면 파일 권한을 제어할 수 있고, Secret 업데이트 시 자동으로 반영된다. `defaultMode: 0400`은 소유자만 읽기 가능하도록 설정한다. `items` 필드로 특정 키만 선택적으로 마운트할 수도 있다.

</details>

---

### 문제 22. [Microservice Vulnerabilities] NetworkPolicy 이그레스 제한

`payment-ns` 네임스페이스의 `payment-api` Pod에서 **외부 인터넷 접근을 차단**하고, `database-ns`의 `postgres` Pod(포트 5432)와 CoreDNS(포트 53)만 허용하라.

<details><summary>풀이 확인</summary>

**풀이:**

```yaml
# egress-policy.yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: payment-api-egress
  namespace: payment-ns
spec:
  podSelector:
    matchLabels:
      app: payment-api
  policyTypes:
    - Egress
  egress:
    - to:
        - namespaceSelector: {}
          podSelector:
            matchLabels:
              k8s-app: kube-dns
      ports:
        - protocol: UDP
          port: 53
        - protocol: TCP
          port: 53
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: database-ns
          podSelector:
            matchLabels:
              app: postgres
      ports:
        - protocol: TCP
          port: 5432
```

```bash
kubectl apply -f egress-policy.yaml

# 외부 접근 차단 확인
kubectl exec payment-api -n payment-ns -- curl -s --connect-timeout 3 https://example.com
# 타임아웃

# DNS 확인
kubectl exec payment-api -n payment-ns -- nslookup postgres.database-ns.svc.cluster.local
# 정상 응답
```

**설명:** 이그레스 NetworkPolicy는 Pod에서 나가는 트래픽을 제어한다. DNS(포트 53)를 반드시 허용해야 서비스 이름 기반 접근이 가능하다. `namespaceSelector`와 `podSelector`를 함께 사용하면 특정 네임스페이스의 특정 Pod로의 트래픽만 정밀하게 허용할 수 있다. CKS 시험에서 이그레스 정책은 자주 출제되는 유형이다.

</details>

---

### 문제 23. [Microservice Vulnerabilities] OPA Gatekeeper — 특권 컨테이너 차단

OPA Gatekeeper를 사용하여 **특권(privileged) 컨테이너 생성을 차단**하는 정책을 작성하라. `kube-system` 네임스페이스는 예외로 한다. initContainers도 검사 대상에 포함하라.

<details><summary>풀이 확인</summary>

**풀이:**

```yaml
# deny-privileged-template.yaml
apiVersion: templates.gatekeeper.sh/v1
kind: ConstraintTemplate
metadata:
  name: k8sdenyprivileged
spec:
  crd:
    spec:
      names:
        kind: K8sDenyPrivileged
  targets:
    - target: admission.k8s.gatekeeper.sh
      rego: |
        package k8sdenyprivileged

        violation[{"msg": msg}] {
          container := input.review.object.spec.containers[_]
          container.securityContext.privileged == true
          msg := sprintf("Privileged container '%v' is not allowed", [container.name])
        }

        violation[{"msg": msg}] {
          container := input.review.object.spec.initContainers[_]
          container.securityContext.privileged == true
          msg := sprintf("Privileged init container '%v' is not allowed", [container.name])
        }
---
apiVersion: constraints.gatekeeper.sh/v1beta1
kind: K8sDenyPrivileged
metadata:
  name: deny-privileged-containers
spec:
  match:
    kinds:
      - apiGroups: [""]
        kinds: ["Pod"]
    excludedNamespaces:
      - kube-system
      - gatekeeper-system
```

```bash
kubectl apply -f deny-privileged-template.yaml

# 테스트
kubectl run priv-test --image=nginx \
  --overrides='{"spec":{"containers":[{"name":"priv","image":"nginx","securityContext":{"privileged":true}}]}}'
# Error: Privileged container 'priv' is not allowed
```

**설명:** 특권 컨테이너는 호스트의 모든 커널 기능에 접근할 수 있어, 컨테이너 격리를 완전히 무력화한다. OPA Gatekeeper로 Admission Controller 수준에서 차단하면 RBAC만으로는 방지할 수 없는 보안 위협을 제거할 수 있다. `initContainers`도 반드시 검사해야 한다. 이는 CKS 시험에서 빈출되는 유형이다.

</details>

---

### 문제 24. [Microservice Vulnerabilities] mTLS 통신 설정

`mtls-ns` 네임스페이스에 두 개의 Pod를 생성하고, **수동으로 인증서를 생성하여 mTLS 통신**을 구성하라.

<details><summary>풀이 확인</summary>

**풀이:**

```bash
# CA 및 서버/클라이언트 인증서 생성
openssl req -x509 -newkey rsa:2048 -days 365 -nodes \
  -keyout ca.key -out ca.crt -subj "/CN=mtls-ca"

openssl req -newkey rsa:2048 -nodes \
  -keyout server.key -out server.csr -subj "/CN=server.mtls-ns.svc"
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key \
  -CAcreateserial -out server.crt -days 365

openssl req -newkey rsa:2048 -nodes \
  -keyout client.key -out client.csr -subj "/CN=client.mtls-ns.svc"
openssl x509 -req -in client.csr -CA ca.crt -CAkey ca.key \
  -CAcreateserial -out client.crt -days 365

# Secret 생성
kubectl create namespace mtls-ns
kubectl create secret generic mtls-server-certs \
  --from-file=ca.crt --from-file=tls.crt=server.crt --from-file=tls.key=server.key \
  -n mtls-ns
kubectl create secret generic mtls-client-certs \
  --from-file=ca.crt --from-file=tls.crt=client.crt --from-file=tls.key=client.key \
  -n mtls-ns
```

```yaml
# server-pod.yaml
apiVersion: v1
kind: Pod
metadata:
  name: mtls-server
  namespace: mtls-ns
  labels:
    app: mtls-server
spec:
  containers:
    - name: nginx
      image: nginx:1.25
      volumeMounts:
        - name: certs
          mountPath: /etc/nginx/certs
          readOnly: true
        - name: config
          mountPath: /etc/nginx/conf.d
  volumes:
    - name: certs
      secret:
        secretName: mtls-server-certs
    - name: config
      configMap:
        name: nginx-mtls-config
```

```bash
kubectl create configmap nginx-mtls-config -n mtls-ns --from-literal=default.conf='
server {
    listen 443 ssl;
    ssl_certificate /etc/nginx/certs/tls.crt;
    ssl_certificate_key /etc/nginx/certs/tls.key;
    ssl_client_certificate /etc/nginx/certs/ca.crt;
    ssl_verify_client on;
    location / { return 200 "mTLS OK\n"; }
}'
kubectl apply -f server-pod.yaml
```

**설명:** mTLS(상호 TLS)는 서버와 클라이언트가 서로의 인증서를 검증하는 방식이다. 마이크로서비스 환경에서 Pod 간 통신 보안의 핵심이다. 실제 운영에서는 Istio, Linkerd 같은 서비스 메시를 사용하면 사이드카 프록시가 자동으로 mTLS를 처리하므로 애플리케이션 코드 수정이 불필요하다.

</details>

---

## Supply Chain Security

### 문제 25. [Supply Chain] Trivy를 이용한 이미지 취약점 스캔

`production` 네임스페이스에 배포된 모든 이미지를 **Trivy로 스캔**하라. CRITICAL 또는 HIGH 취약점이 있는 이미지를 사용하는 Pod를 식별하고, 안전한 버전으로 교체하라.

<details><summary>풀이 확인</summary>

**풀이:**

```bash
# production 네임스페이스의 모든 이미지 추출
kubectl get pods -n production \
  -o jsonpath='{range .items[*]}{.spec.containers[*].image}{"\n"}{end}' | sort -u

# 각 이미지를 Trivy로 스캔
trivy image --severity CRITICAL,HIGH nginx:1.21
trivy image --severity CRITICAL,HIGH python:3.9

# 결과를 JSON으로 저장
trivy image --severity CRITICAL,HIGH --format json -o scan-result.json nginx:1.21

# 취약한 이미지를 사용하는 Deployment 업데이트
kubectl set image deployment/web-app \
  web=nginx:1.25-alpine \
  -n production

# 재스캔으로 확인
trivy image --severity CRITICAL,HIGH nginx:1.25-alpine
```

**설명:** Trivy는 컨테이너 이미지의 OS 패키지와 애플리케이션 의존성에서 취약점을 탐지한다. `--severity` 플래그로 심각도 필터링이 가능하다. Alpine 기반 이미지는 패키지가 적어 취약점이 적은 경향이 있다. CI/CD 파이프라인에 통합하여 빌드 시점에 스캔하는 것이 권장된다.

</details>

---

### 문제 26. [Supply Chain] ImagePolicyWebhook 설정

**ImagePolicyWebhook** Admission Controller를 설정하여, 승인된 레지스트리(`registry.example.com`)의 이미지만 사용할 수 있도록 제한하라.

<details><summary>풀이 확인</summary>

**풀이:**

```yaml
# /etc/kubernetes/admission/admission-config.yaml
apiVersion: apiserver.config.k8s.io/v1
kind: AdmissionConfiguration
plugins:
  - name: ImagePolicyWebhook
    configuration:
      imagePolicy:
        kubeConfigFile: /etc/kubernetes/admission/imagepolicy-kubeconfig.yaml
        allowTTL: 50
        denyTTL: 50
        retryBackoff: 500
        defaultAllow: false
```

```yaml
# /etc/kubernetes/admission/imagepolicy-kubeconfig.yaml
apiVersion: v1
kind: Config
clusters:
  - name: image-checker
    cluster:
      certificate-authority: /etc/kubernetes/admission/webhook-ca.crt
      server: https://image-checker.default.svc:8443/image-policy
contexts:
  - name: image-checker
    context:
      cluster: image-checker
      user: api-server
current-context: image-checker
users:
  - name: api-server
    user:
      client-certificate: /etc/kubernetes/admission/apiserver-client.crt
      client-key: /etc/kubernetes/admission/apiserver-client.key
```

```bash
sudo vi /etc/kubernetes/manifests/kube-apiserver.yaml
```

```yaml
# kube-apiserver.yaml에 추가
spec:
  containers:
    - command:
        - kube-apiserver
        - --enable-admission-plugins=NodeRestriction,ImagePolicyWebhook
        - --admission-control-config-file=/etc/kubernetes/admission/admission-config.yaml
      volumeMounts:
        - name: admission-config
          mountPath: /etc/kubernetes/admission
          readOnly: true
  volumes:
    - name: admission-config
      hostPath:
        path: /etc/kubernetes/admission
        type: DirectoryOrCreate
```

```bash
# 테스트
kubectl run test --image=docker.io/nginx
# Error: image policy webhook denied the request

kubectl run test --image=registry.example.com/nginx:1.25
# 성공
```

**설명:** ImagePolicyWebhook은 외부 웹훅 서비스와 연동하여 이미지 사용을 제어하는 Admission Controller이다. `defaultAllow: false`로 설정하면 웹훅 서비스가 응답하지 않을 때 모든 이미지를 거부한다(fail-closed). 승인된 레지스트리만 허용함으로써 신뢰할 수 없는 이미지의 배포를 방지한다.

</details>

---

### 문제 27. [Supply Chain] Dockerfile 보안 모범 사례 적용

다음 **취약한 Dockerfile을 보안 모범 사례에 따라 수정**하라:

```dockerfile
FROM ubuntu:latest
RUN apt-get update && apt-get install -y curl wget
COPY . /app
RUN chmod 777 /app
USER root
EXPOSE 8080
CMD ["python3", "/app/main.py"]
```

<details><summary>풀이 확인</summary>

**풀이:**

```dockerfile
# 수정된 Dockerfile
FROM python:3.12-slim AS builder
WORKDIR /build
COPY requirements.txt .
RUN pip install --no-cache-dir --user -r requirements.txt

FROM python:3.12-slim
RUN groupadd -r appgroup && useradd -r -g appgroup -d /app -s /sbin/nologin appuser
WORKDIR /app

COPY --from=builder /root/.local /home/appuser/.local
COPY --chown=appuser:appgroup main.py .
RUN chmod 500 /app/main.py

USER appuser
ENV PATH=/home/appuser/.local/bin:$PATH

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s \
  CMD python3 -c "import urllib.request; urllib.request.urlopen('http://localhost:8080/health')" || exit 1

CMD ["python3", "/app/main.py"]
```

```bash
# .dockerignore
cat <<EOF > .dockerignore
.git
.env
*.md
Dockerfile
__pycache__
*.pyc
EOF

# 빌드 및 스캔
docker build -t secure-app:v1 .
trivy image secure-app:v1
```

**설명:** 주요 수정 사항: (1) `latest` 대신 특정 버전 태그 사용, (2) slim 이미지로 공격 표면 축소, (3) 멀티스테이지 빌드로 불필요한 빌드 도구 제거, (4) 비root 사용자 실행, (5) `chmod 777` 대신 최소 권한 설정, (6) `.dockerignore`로 민감 파일 제외, (7) 불필요한 패키지(curl, wget) 제거.

</details>

---

### 문제 28. [Supply Chain] 이미지 다이제스트 기반 배포

Deployment에서 이미지 태그 대신 **다이제스트(SHA256)**를 사용하도록 수정하라. 이미지 `nginx:1.25`의 다이제스트를 확인하고 적용하라.

<details><summary>풀이 확인</summary>

**풀이:**

```bash
# 이미지 다이제스트 확인
docker inspect --format='{{index .RepoDigests 0}}' nginx:1.25
# 또는
crane digest nginx:1.25
# 또는
skopeo inspect docker://nginx:1.25 | jq -r '.Digest'
```

```yaml
# digest-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web-app
  namespace: production
spec:
  replicas: 3
  selector:
    matchLabels:
      app: web-app
  template:
    metadata:
      labels:
        app: web-app
    spec:
      containers:
        - name: nginx
          image: nginx@sha256:6a40we...실제다이제스트값...
          ports:
            - containerPort: 80
```

```bash
kubectl apply -f digest-deployment.yaml

# 배포된 이미지 다이제스트 확인
kubectl get pods -n production \
  -o jsonpath='{range .items[*]}{.status.containerStatuses[*].imageID}{"\n"}{end}'
```

**설명:** 이미지 태그는 변경 가능(mutable)하므로 동일 태그에 다른 이미지가 푸시될 수 있다. 다이제스트(SHA256 해시)를 사용하면 정확히 동일한 이미지를 보장할 수 있어 공급망 공격을 방지한다. CI/CD 파이프라인에서 빌드 후 다이제스트를 자동으로 기록하는 것이 권장된다.

</details>

---

### 문제 29. [Supply Chain] 프라이빗 레지스트리 ImagePullSecret 설정

**프라이빗 컨테이너 레지스트리**(`registry.example.com`)에 접근하기 위한 ImagePullSecret을 생성하고, ServiceAccount에 연결하라.

<details><summary>풀이 확인</summary>

**풀이:**

```bash
# ImagePullSecret 생성
kubectl create secret docker-registry registry-cred \
  --docker-server=registry.example.com \
  --docker-username=deploy-user \
  --docker-password='P@ssw0rd!' \
  --docker-email=deploy@example.com \
  -n production

# ServiceAccount에 연결
kubectl patch serviceaccount default -n production \
  -p '{"imagePullSecrets": [{"name": "registry-cred"}]}'
```

```yaml
# 또는 Pod에 직접 지정
apiVersion: v1
kind: Pod
metadata:
  name: private-app
  namespace: production
spec:
  imagePullSecrets:
    - name: registry-cred
  containers:
    - name: app
      image: registry.example.com/my-app:v1.0
```

```bash
kubectl get serviceaccount default -n production -o yaml
```

**설명:** 프라이빗 레지스트리의 이미지를 풀하려면 인증 정보가 필요하다. `docker-registry` 타입의 Secret을 생성하고 Pod의 `imagePullSecrets` 또는 ServiceAccount에 연결한다. ServiceAccount에 연결하면 해당 SA를 사용하는 모든 Pod에 자동 적용되어 관리가 편리하다.

</details>

---

### 문제 30. [Supply Chain] Cosign을 이용한 이미지 서명 및 검증

`cosign`을 사용하여 컨테이너 이미지에 **서명하고 검증**하라. Kyverno를 사용하여 서명된 이미지만 배포할 수 있도록 정책을 설정하라.

<details><summary>풀이 확인</summary>

**풀이:**

```bash
# cosign 키페어 생성
cosign generate-key-pair

# 이미지 서명
cosign sign --key cosign.key registry.example.com/my-app:v1.0

# 서명 검증
cosign verify --key cosign.pub registry.example.com/my-app:v1.0
```

```yaml
# kyverno-verify-image.yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: verify-image-signature
spec:
  validationFailureAction: Enforce
  background: false
  rules:
    - name: verify-cosign-signature
      match:
        any:
          - resources:
              kinds:
                - Pod
      verifyImages:
        - imageReferences:
            - "registry.example.com/*"
          attestors:
            - count: 1
              entries:
                - keys:
                    publicKeys: |-
                      -----BEGIN PUBLIC KEY-----
                      MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE...
                      -----END PUBLIC KEY-----
```

```bash
kubectl apply -f kyverno-verify-image.yaml

# 서명되지 않은 이미지 배포 시도
kubectl run unsigned --image=registry.example.com/unverified:latest
# Error: image signature verification failed

# 서명된 이미지 배포
kubectl run signed --image=registry.example.com/my-app:v1.0
# 성공
```

**설명:** Cosign은 Sigstore 프로젝트의 이미지 서명 도구이다. 이미지 빌드 후 서명하고, 배포 시 검증함으로써 변조되지 않은 이미지만 실행되도록 보장한다. Kyverno 또는 Connaisseur 같은 Admission Controller 도구로 서명 검증을 자동화할 수 있다.

</details>

---

### 문제 31. [Supply Chain] kubesec/kube-linter로 매니페스트 정적 분석

`kubesec`와 `kube-linter`를 사용하여 **Kubernetes 매니페스트의 보안 취약점을 검사**하고, 발견된 문제를 수정하라.

<details><summary>풀이 확인</summary>

**풀이:**

```bash
# kubesec으로 보안 점수 확인
kubesec scan deployment.yaml
# 또는 온라인 API 사용
curl -sSX POST --data-binary @deployment.yaml https://v2.kubesec.io/scan

# kube-linter로 린팅
kube-linter lint deployment.yaml
```

```yaml
# 보안 강화 전 (점수 낮음)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: insecure-app
spec:
  replicas: 1
  selector:
    matchLabels:
      app: insecure-app
  template:
    metadata:
      labels:
        app: insecure-app
    spec:
      containers:
        - name: app
          image: nginx
---
# 보안 강화 후 (점수 높음)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: secure-app
spec:
  replicas: 2
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
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: app
          image: nginx:1.25-alpine
          securityContext:
            readOnlyRootFilesystem: true
            allowPrivilegeEscalation: false
            capabilities:
              drop:
                - ALL
          resources:
            requests:
              cpu: 50m
              memory: 64Mi
            limits:
              cpu: 100m
              memory: 128Mi
          livenessProbe:
            httpGet:
              path: /
              port: 80
          readinessProbe:
            httpGet:
              path: /
              port: 80
```

```bash
# 수정 후 재스캔
kubesec scan secure-deployment.yaml
# Score 대폭 개선
```

**설명:** 정적 분석 도구는 배포 전에 매니페스트의 보안 문제를 탐지한다. kubesec은 보안 점수와 개선 권고를 제공하고, kube-linter는 모범 사례 위반을 체크한다. CI/CD 파이프라인에 통합하여 PR 단계에서 보안 검사를 수행하는 것이 권장된다.

</details>

---

### 문제 32. [Supply Chain] latest 태그 사용 금지 정책

**latest 태그 사용을 금지**하는 OPA Gatekeeper 정책을 작성하라. 태그가 없는 이미지(기본 latest)도 차단하라.

<details><summary>풀이 확인</summary>

**풀이:**

```yaml
# disallowed-tags.yaml
apiVersion: templates.gatekeeper.sh/v1
kind: ConstraintTemplate
metadata:
  name: k8sdisallowedtags
spec:
  crd:
    spec:
      names:
        kind: K8sDisallowedTags
      validation:
        openAPIV3Schema:
          type: object
          properties:
            tags:
              type: array
              items:
                type: string
  targets:
    - target: admission.k8s.gatekeeper.sh
      rego: |
        package k8sdisallowedtags

        violation[{"msg": msg}] {
          container := input.review.object.spec.containers[_]
          tag := split(container.image, ":")
          count(tag) == 1
          msg := sprintf("Container '%v' has no tag (defaults to latest)", [container.name])
        }

        violation[{"msg": msg}] {
          container := input.review.object.spec.containers[_]
          tag := split(container.image, ":")
          count(tag) == 2
          disallowed := input.parameters.tags[_]
          tag[1] == disallowed
          msg := sprintf("Container '%v' uses disallowed tag '%v'", [container.name, disallowed])
        }
---
apiVersion: constraints.gatekeeper.sh/v1beta1
kind: K8sDisallowedTags
metadata:
  name: no-latest-tag
spec:
  match:
    kinds:
      - apiGroups: [""]
        kinds: ["Pod"]
    excludedNamespaces:
      - kube-system
  parameters:
    tags:
      - "latest"
```

```bash
kubectl apply -f disallowed-tags.yaml

kubectl run test --image=nginx
# Error: Container 'test' has no tag (defaults to latest)

kubectl run test --image=nginx:latest
# Error: Container 'test' uses disallowed tag 'latest'

kubectl run test --image=nginx:1.25
# 성공
```

**설명:** `latest` 태그는 어떤 버전의 이미지가 실행될지 예측할 수 없어 보안 및 안정성 문제를 야기한다. 태그 없이 이미지를 지정하면 자동으로 `latest`가 사용되므로, 태그가 없는 경우도 함께 차단해야 한다.

</details>

---

## Monitoring, Logging & Runtime Security

### 문제 33. [Runtime Security] Falco 설치 및 커스텀 규칙 작성

**Falco를 설치하고**, 다음 이벤트를 탐지하는 커스텀 규칙을 작성하라:
- 컨테이너 내에서 셸(`bash`, `sh`) 실행
- `/etc` 디렉토리의 파일 수정
- 민감한 파일(`/etc/shadow`, `/etc/passwd`) 읽기

<details><summary>풀이 확인</summary>

**풀이:**

```bash
# Falco 설치 (Helm)
helm repo add falcosecurity https://falcosecurity.github.io/charts
helm install falco falcosecurity/falco \
  --namespace falco-system --create-namespace \
  --set falcosidekick.enabled=true
```

```yaml
# /etc/falco/rules.d/custom-rules.yaml
- rule: Shell Spawned in Container
  desc: Detect shell execution inside a container
  condition: >
    spawned_process and container and
    proc.name in (bash, sh, zsh, ash) and
    not proc.pname in (cron, crond)
  output: >
    Shell spawned in container
    (user=%user.name container=%container.name
    shell=%proc.name parent=%proc.pname
    cmdline=%proc.cmdline image=%container.image.repository)
  priority: WARNING
  tags: [shell, container]

- rule: Modify Files Under /etc
  desc: Detect modification of files under /etc in a container
  condition: >
    open_write and container and
    fd.name startswith /etc/
  output: >
    File under /etc modified in container
    (user=%user.name file=%fd.name
    container=%container.name image=%container.image.repository)
  priority: ERROR
  tags: [filesystem, container]

- rule: Read Sensitive Files
  desc: Detect reading of sensitive files
  condition: >
    open_read and container and
    fd.name in (/etc/shadow, /etc/passwd, /etc/sudoers)
  output: >
    Sensitive file read in container
    (user=%user.name file=%fd.name
    container=%container.name command=%proc.cmdline)
  priority: WARNING
  tags: [sensitive_files, container]
```

```bash
# 규칙 적용
sudo systemctl restart falco

# 테스트
kubectl exec -it test-pod -- /bin/bash

# Falco 로그 확인
kubectl logs -l app.kubernetes.io/name=falco -n falco-system --tail=20
```

**설명:** Falco는 CNCF 프로젝트로, 커널 시스템 콜을 실시간으로 모니터링하여 비정상적인 런타임 활동을 탐지한다. eBPF 또는 커널 모듈 기반으로 동작하며, 사용자 정의 규칙으로 탐지 범위를 확장할 수 있다. CKS 시험에서 Falco 규칙 작성 및 로그 분석은 핵심 출제 영역이다.

</details>

---

### 문제 34. [Runtime Security] Falco 출력 필터링 및 로그 설정

Falco의 출력에서 **`kube-system` 네임스페이스 이벤트를 제외**하고, `priority >= ERROR` 이벤트만 출력하도록 설정하라. 파일과 syslog에 동시에 기록하라.

<details><summary>풀이 확인</summary>

**풀이:**

```yaml
# /etc/falco/falco.yaml 수정
priority: error

stdout_output:
  enabled: true

file_output:
  enabled: true
  keep_alive: false
  filename: /var/log/falco/events.log

syslog_output:
  enabled: true
```

```yaml
# /etc/falco/rules.d/exclusions.yaml
- macro: allowed_namespaces
  condition: >
    k8s.ns.name in (kube-system, falco-system, gatekeeper-system)

- rule: Shell Spawned in Container
  desc: Detect shell execution (excluding system namespaces)
  condition: >
    spawned_process and container and
    proc.name in (bash, sh, zsh, ash) and
    not allowed_namespaces
  output: >
    Shell spawned in container
    (ns=%k8s.ns.name pod=%k8s.pod.name shell=%proc.name cmdline=%proc.cmdline)
  priority: ERROR
  tags: [shell, container]
```

```bash
sudo systemctl restart falco
sudo tail -f /var/log/falco/events.log
journalctl -u falco -f
```

**설명:** Falco의 `priority` 설정으로 출력 레벨을 제어할 수 있다. `error`로 설정하면 ERROR 이상만 출력한다. 매크로를 사용하여 시스템 네임스페이스의 이벤트를 제외하면 노이즈를 줄일 수 있다. 파일과 syslog 출력을 동시에 활성화하여 로그 수집 시스템과 연동할 수 있다.

</details>

---

### 문제 35. [Runtime Security] Audit 로그 분석

Kubernetes Audit 로그에서 다음을 분석하라:
- 최근 **Secret에 접근한 사용자** 목록
- **403 Forbidden** 응답을 받은 요청
- 비정상적인 시간대(새벽 2-5시)의 API 호출

<details><summary>풀이 확인</summary>

**풀이:**

```bash
# Secret 접근 사용자 추출
sudo cat /var/log/kubernetes/audit/audit.log | \
  jq -r 'select(.objectRef.resource == "secrets") |
    "\(.user.username) -> \(.objectRef.namespace)/\(.objectRef.name) [\(.verb)]"' | \
  sort | uniq -c | sort -rn | head -20

# 403 Forbidden 응답 분석
sudo cat /var/log/kubernetes/audit/audit.log | \
  jq -r 'select(.responseStatus.code == 403) |
    "\(.requestReceivedTimestamp) \(.user.username) \(.verb) \(.objectRef.resource)/\(.objectRef.name)"' | \
  tail -50

# 비정상 시간대 접근 (새벽 2-5시)
sudo cat /var/log/kubernetes/audit/audit.log | \
  jq -r 'select(
    (.requestReceivedTimestamp | split("T")[1] | split(":")[0] | tonumber) >= 2 and
    (.requestReceivedTimestamp | split("T")[1] | split(":")[0] | tonumber) <= 5
  ) | "\(.requestReceivedTimestamp) \(.user.username) \(.verb) \(.objectRef.resource)"' | \
  head -30

# 특정 사용자의 활동 추적
sudo cat /var/log/kubernetes/audit/audit.log | \
  jq -r 'select(.user.username == "suspicious-user") |
    "\(.requestReceivedTimestamp) \(.verb) \(.objectRef.resource) -> \(.responseStatus.code)"'
```

**설명:** Audit 로그는 Kubernetes API Server에 대한 모든 요청을 기록한다. Secret 접근 패턴 분석, 인가 실패(403) 추적, 비정상 시간대 접근 탐지를 통해 보안 사고를 조기에 발견할 수 있다. 운영 환경에서는 Elasticsearch나 Splunk에 Audit 로그를 전송하여 실시간 모니터링하는 것이 권장된다.

</details>

---

### 문제 36. [Runtime Security] 컨테이너 불변성(Immutability) 보장

실행 중인 Pod에서 **컨테이너 불변성**을 보장하라. distroless 이미지, readOnlyRootFilesystem, capability 드롭을 조합하라.

<details><summary>풀이 확인</summary>

**풀이:**

```yaml
# immutable-pod.yaml
apiVersion: v1
kind: Pod
metadata:
  name: immutable-app
  namespace: secure-ns
spec:
  securityContext:
    runAsNonRoot: true
    runAsUser: 1000
    runAsGroup: 1000
    seccompProfile:
      type: RuntimeDefault
  containers:
    - name: app
      image: gcr.io/distroless/python3-debian12:nonroot
      command: ["python3", "/app/main.py"]
      securityContext:
        readOnlyRootFilesystem: true
        allowPrivilegeEscalation: false
        capabilities:
          drop:
            - ALL
      volumeMounts:
        - name: tmp
          mountPath: /tmp
      resources:
        limits:
          cpu: "200m"
          memory: "256Mi"
  volumes:
    - name: tmp
      emptyDir:
        sizeLimit: 50Mi
```

```bash
kubectl apply -f immutable-pod.yaml

# 불변성 확인
kubectl exec immutable-app -n secure-ns -- touch /test
# Read-only file system

kubectl exec immutable-app -n secure-ns -- apt-get update
# sh: apt-get: not found (distroless 이미지)
```

**설명:** 컨테이너 불변성은 런타임에 컨테이너 내용이 변경되지 않도록 보장하는 보안 원칙이다. `readOnlyRootFilesystem`, distroless 이미지(패키지 매니저와 셸 없음), 모든 capability 드롭을 조합하면 강력한 불변성을 달성할 수 있다. 공격자가 컨테이너에 침입하더라도 악성 도구 설치나 바이너리 변조가 불가능하다.

</details>

---

### 문제 37. [Runtime Security] 보안 사고 대응 — 의심스러운 Pod 조사

`compromised-ns` 네임스페이스의 `web-pod`에서 **의심스러운 프로세스가 실행 중**이라는 Falco 알림을 받았다. 해당 Pod를 조사하고 격리, 포렌식, 복구 과정을 수행하라.

<details><summary>풀이 확인</summary>

**풀이:**

```bash
# 1. 실행 중인 프로세스 확인
kubectl exec web-pod -n compromised-ns -- ps aux

# 2. 네트워크 연결 확인
kubectl exec web-pod -n compromised-ns -- netstat -tlnp

# 3. 파일시스템 변경 확인
kubectl exec web-pod -n compromised-ns -- find / -newer /app/main.py -type f 2>/dev/null

# 4. Pod를 격리 (NetworkPolicy로 모든 트래픽 차단)
kubectl apply -f - <<EOF
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: isolate-compromised
  namespace: compromised-ns
spec:
  podSelector:
    matchLabels:
      app: web-pod
  policyTypes:
    - Ingress
    - Egress
EOF

# 5. 포렌식을 위해 Pod 상태 저장
kubectl get pod web-pod -n compromised-ns -o yaml > pod-forensics.yaml
kubectl logs web-pod -n compromised-ns > pod-logs.txt
kubectl logs web-pod -n compromised-ns --previous > pod-previous-logs.txt 2>/dev/null

# 6. Pod 삭제 및 재생성
kubectl delete pod web-pod -n compromised-ns

# 7. Falco 로그에서 관련 이벤트 확인
kubectl logs -l app.kubernetes.io/name=falco -n falco-system | \
  grep "compromised-ns" | tail -30
```

**설명:** 보안 사고 대응 절차: (1) 탐지 — 비정상 프로세스, 네트워크 연결, 파일 변경 확인, (2) 격리 — NetworkPolicy로 트래픽 차단하여 추가 피해 방지, (3) 포렌식 — 로그 및 Pod 상태 보존, (4) 제거 — 감염된 Pod 삭제, (5) 복구 — 클린 이미지로 재배포, (6) 교훈 — 침입 경로 분석 및 보안 정책 강화.

</details>

---

### 문제 38. [Runtime Security] Linux Capabilities 최소화

Pod에서 **필요한 최소한의 Linux Capabilities만 허용**하라. 비root 사용자로 1024 이상 포트를 사용하여 `NET_BIND_SERVICE` capability도 불필요하게 만들어라.

<details><summary>풀이 확인</summary>

**풀이:**

```yaml
# capabilities-pod.yaml
apiVersion: v1
kind: Pod
metadata:
  name: web-minimal-caps
  namespace: secure-ns
spec:
  securityContext:
    runAsNonRoot: true
    runAsUser: 1000
    seccompProfile:
      type: RuntimeDefault
  containers:
    - name: web
      image: nginx:1.25-alpine
      ports:
        - containerPort: 8080
      securityContext:
        allowPrivilegeEscalation: false
        readOnlyRootFilesystem: true
        capabilities:
          drop:
            - ALL
      volumeMounts:
        - name: tmp
          mountPath: /tmp
        - name: cache
          mountPath: /var/cache/nginx
        - name: run
          mountPath: /var/run
        - name: config
          mountPath: /etc/nginx/conf.d
  volumes:
    - name: tmp
      emptyDir: {}
    - name: cache
      emptyDir: {}
    - name: run
      emptyDir: {}
    - name: config
      configMap:
        name: nginx-8080-config
```

```bash
kubectl create configmap nginx-8080-config -n secure-ns \
  --from-literal=default.conf='server { listen 8080; location / { root /usr/share/nginx/html; } }'
kubectl apply -f capabilities-pod.yaml

# capabilities 확인
kubectl exec web-minimal-caps -n secure-ns -- cat /proc/1/status | grep -i cap
```

**설명:** Linux Capabilities는 root 권한을 세분화한 것이다. 모든 capability를 드롭하고 필요한 것만 추가하는 것이 보안 모범 사례이다. `NET_BIND_SERVICE`는 1024 미만 포트에 바인딩할 때만 필요하다. 비root 사용자로 8080 같은 1024 이상 포트를 사용하면 이 capability도 불필요하다.

</details>

---

### 문제 39. [Runtime Security] Pod Security Admission 적용 현황 점검

클러스터의 모든 네임스페이스에 대해 **PSA 적용 현황을 점검**하라. 레이블이 없는 네임스페이스를 식별하고, 용도에 맞는 정책을 적용하라.

<details><summary>풀이 확인</summary>

**풀이:**

```bash
# 모든 네임스페이스의 PSA 레이블 확인
kubectl get namespaces -o json | \
  jq -r '.items[] |
    "\(.metadata.name)\t" +
    "enforce=" + (.metadata.labels["pod-security.kubernetes.io/enforce"] // "없음") + "\t" +
    "warn=" + (.metadata.labels["pod-security.kubernetes.io/warn"] // "없음")'

# PSA 레이블이 없는 네임스페이스 식별
kubectl get namespaces -o json | \
  jq -r '.items[] |
    select(.metadata.labels["pod-security.kubernetes.io/enforce"] == null) |
    .metadata.name' | grep -v "^kube-"

# 프로덕션: restricted
kubectl label namespace production \
  pod-security.kubernetes.io/enforce=restricted \
  pod-security.kubernetes.io/warn=restricted \
  pod-security.kubernetes.io/audit=restricted

# 개발: baseline enforce + restricted warn
kubectl label namespace development \
  pod-security.kubernetes.io/enforce=baseline \
  pod-security.kubernetes.io/warn=restricted \
  pod-security.kubernetes.io/audit=restricted

# dry-run으로 기존 워크로드 호환성 확인
kubectl label namespace production \
  pod-security.kubernetes.io/enforce=restricted \
  --dry-run=server --overwrite
```

**설명:** PSA는 `privileged`(제한 없음), `baseline`(기본 보안), `restricted`(최대 보안) 세 가지 수준을 제공한다. `enforce`는 정책 위반 Pod 생성을 차단하고, `warn`은 경고만 표시하며, `audit`는 감사 로그에 기록한다. 프로덕션에는 `restricted`, 개발 환경에는 `baseline enforce + restricted warn`을 적용하는 것이 일반적이다.

</details>

---

### 문제 40. [Runtime Security] 종합 보안 점검 스크립트 작성

클러스터 전체에 대해 **종합 보안 점검**을 수행하는 스크립트를 작성하고 실행하라. RBAC, NetworkPolicy, Pod 보안, Secret 관리, 이미지 보안, PSA를 점검하라.

<details><summary>풀이 확인</summary>

**풀이:**

```bash
#!/bin/bash
echo "=== CKS 종합 보안 점검 ==="

echo ""
echo "[ 1. RBAC 점검 ]"
echo "-- cluster-admin 바인딩:"
kubectl get clusterrolebindings -o json | \
  jq -r '.items[] | select(.roleRef.name == "cluster-admin") |
    .metadata.name + " -> " + (.subjects[0].name // "unknown")'

echo "-- 와일드카드(*) 권한을 가진 ClusterRole:"
kubectl get clusterroles -o json | \
  jq -r '.items[] | select(.rules[]? | .verbs[]? == "*" or .resources[]? == "*") |
    .metadata.name' | grep -v "^system:" | head -10

echo ""
echo "[ 2. NetworkPolicy 점검 ]"
echo "-- NetworkPolicy가 없는 네임스페이스:"
for ns in $(kubectl get ns -o jsonpath='{.items[*].metadata.name}'); do
  count=$(kubectl get networkpolicy -n "$ns" --no-headers 2>/dev/null | wc -l)
  if [ "$count" -eq 0 ]; then echo "  $ns (정책 없음)"; fi
done

echo ""
echo "[ 3. Pod 보안 점검 ]"
echo "-- 특권 컨테이너:"
kubectl get pods --all-namespaces -o json | \
  jq -r '.items[] | select(.spec.containers[]?.securityContext?.privileged == true) |
    .metadata.namespace + "/" + .metadata.name'

echo "-- root로 실행 중인 Pod (runAsNonRoot 미설정):"
kubectl get pods --all-namespaces -o json | \
  jq -r '.items[] | select(.spec.securityContext?.runAsNonRoot != true) |
    .metadata.namespace + "/" + .metadata.name' | head -10

echo ""
echo "[ 4. Secret 점검 ]"
echo "-- 환경변수로 노출된 Secret:"
kubectl get pods --all-namespaces -o json | \
  jq -r '.items[] | select(.spec.containers[]?.env[]?.valueFrom?.secretKeyRef != null) |
    .metadata.namespace + "/" + .metadata.name'

echo ""
echo "[ 5. 이미지 점검 ]"
echo "-- latest 태그 또는 태그 없는 이미지:"
kubectl get pods --all-namespaces -o json | \
  jq -r '.items[] | .spec.containers[] |
    select(.image | test(":latest$") or (test(":") | not)) | .image' | sort -u

echo ""
echo "[ 6. PSA 점검 ]"
echo "-- PSA enforce 레이블이 없는 네임스페이스:"
kubectl get ns -o json | \
  jq -r '.items[] | select(.metadata.labels["pod-security.kubernetes.io/enforce"] == null) |
    .metadata.name' | grep -v "^kube-"

echo ""
echo "=== 점검 완료 ==="
```

```bash
chmod +x security-audit.sh
./security-audit.sh
```

**설명:** 종합 보안 점검은 정기적으로 수행해야 하며, 자동화 스크립트를 통해 일관된 점검이 가능하다. 주요 확인 항목: (1) RBAC 과다 권한, (2) NetworkPolicy 부재, (3) 특권/root 컨테이너, (4) Secret 환경변수 노출, (5) 이미지 태그 관리, (6) PSA 적용 현황. CronJob으로 스케줄링하여 정기 감사를 구현할 수도 있다.

</details>

---

## 학습 참고

| 리소스 | 링크 |
|--------|------|
| CKS 공식 커리큘럼 | https://github.com/cncf/curriculum |
| Kubernetes 보안 문서 | https://kubernetes.io/docs/concepts/security/ |
| Falco 공식 문서 | https://falco.org/docs/ |
| OPA Gatekeeper | https://open-policy-agent.github.io/gatekeeper/ |
| kube-bench | https://github.com/aquasecurity/kube-bench |
| Trivy | https://aquasecurity.github.io/trivy/ |
| CIS Kubernetes Benchmark | https://www.cisecurity.org/benchmark/kubernetes |
